import type { InputState } from '../input/Input';
import { makeCB350RS, makeHarrierKaziranga, type VehicleModel } from '../art/vehicleModels';
import type { Terrain } from '../loop/Terrain';

export interface VehicleSpec {
  id: 'cb350rs' | 'harrier';
  name: string;
  kind: 'bike' | 'car';
  /** m/s */
  maxSpeed: number;
  accel: number;
  brake: number;
  reverseMax: number;
  wheelbase: number;
  /** max steering angle at standstill / at top speed (radians) */
  steerLow: number;
  steerHigh: number;
  /** collision circles along the length: [offset along forward axis (m), radius] */
  circles: [number, number][];
  cam: { dist: number; height: number; look: number };
  wheelRadius: number;
}

export const CB350RS: VehicleSpec = {
  id: 'cb350rs',
  name: 'Honda CB350RS',
  kind: 'bike',
  maxSpeed: 34, // ~122 km/h
  accel: 6.5,
  brake: 11,
  reverseMax: 1.5,
  wheelbase: 1.44,
  steerLow: 0.6,
  steerHigh: 0.07,
  circles: [[-0.6, 0.45], [0.6, 0.45]],
  cam: { dist: 5.2, height: 1.9, look: 1.2 },
  wheelRadius: 0.32,
};

export const HARRIER: VehicleSpec = {
  id: 'harrier',
  name: 'Tata Harrier Kaziranga',
  kind: 'car',
  maxSpeed: 50, // ~180 km/h
  accel: 5.2,
  brake: 10,
  reverseMax: 7,
  wheelbase: 2.74,
  steerLow: 0.55,
  steerHigh: 0.06,
  circles: [[-1.45, 1.0], [0, 1.0], [1.45, 1.0]],
  cam: { dist: 8.5, height: 3.0, look: 1.5 },
  wheelRadius: 0.37,
};

const G = 9.81;

export class Vehicle {
  readonly model: VehicleModel;
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  steer = 0;
  yawRate = 0;
  private lean = 0;
  private wheelSpin = 0;
  occupied = false;
  /** 0..1 how hard we hit something this frame (for camera shake / sound later) */
  impact = 0;

  constructor(readonly spec: VehicleSpec) {
    this.model = spec.id === 'cb350rs' ? makeCB350RS() : makeHarrierKaziranga();
    for (const w of this.model.wheels) w.rotation.order = 'YXZ';
    if (this.model.frontFork) this.model.frontFork.rotation.order = 'YXZ';
  }

  get forwardX() { return -Math.sin(this.heading); }
  get forwardZ() { return -Math.cos(this.heading); }
  get kmh() { return Math.abs(this.speed) * 3.6; }

  place(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.sync(0);
  }

  update(dt: number, input: InputState | null, world: Terrain, others: Vehicle[]): void {
    if (dt <= 0) return;
    const s = this.spec;
    const v = this.speed;
    const throttle = input?.throttle ?? 0;
    const brake = input?.brake ?? 0;
    const handbrake = input?.alt ?? false;
    const steerIn = input?.x ?? 0;

    // steering: less lock at speed
    const t = Math.min(1, Math.abs(v) / (s.maxSpeed * 0.7));
    const maxSteer = s.steerLow + (s.steerHigh - s.steerLow) * Math.sqrt(t);
    const target = steerIn * maxSteer;
    this.steer += (target - this.steer) * Math.min(1, dt * (s.kind === 'bike' ? 7 : 5));

    // longitudinal
    let a = 0;
    if (throttle > 0) {
      if (v < -0.5) a += s.brake * throttle;
      else a += s.accel * throttle * Math.max(0, 1 - (v / s.maxSpeed) ** 2);
    }
    if (brake > 0) {
      if (v > 0.5) a -= s.brake * brake;
      else if (throttle === 0) a -= s.accel * 0.6 * brake * Math.max(0, 1 - (-v / s.reverseMax) ** 2);
    }
    // rolling resistance + aero drag; the handbrake adds strong braking
    let decel = (0.6 + 0.0022 * v * v) * (throttle === 0 && brake === 0 ? 1 : 0.3);
    if (handbrake) decel += s.brake * 0.8;
    const next = v + a * dt;
    // resistive forces never reverse the direction of travel
    const slowed = Math.abs(next) <= decel * dt ? 0 : next - Math.sign(next) * decel * dt;
    this.speed = a === 0 && Math.sign(slowed) !== Math.sign(v) ? 0 : slowed;

    // yaw from bicycle model, with a little extra slide on the handbrake for the car
    let yawRate = (this.speed * Math.tan(this.steer)) / s.wheelbase;
    if (handbrake && s.kind === 'car' && Math.abs(this.speed) > 6) yawRate *= 1.6;
    this.yawRate = yawRate;
    this.heading -= yawRate * dt;

    // integrate position
    const px = this.x, pz = this.z;
    this.x += this.forwardX * this.speed * dt;
    this.z += this.forwardZ * this.speed * dt;

    // water / edge of the world: stop dead
    const probe = Math.sign(this.speed || 1) * (s.kind === 'car' ? 2.2 : 1.0);
    if (world.isWater(this.x + this.forwardX * probe, this.z + this.forwardZ * probe) || !world.inBounds(this.x, this.z, true)) {
      this.x = px;
      this.z = pz;
      this.impact = Math.min(1, Math.abs(this.speed) / 15);
      this.speed = 0;
    }

    this.collide(world, others);
    this.sync(dt);
  }

  circlesWorld(): { x: number; z: number; r: number }[] {
    return this.spec.circles.map(([off, r]) => ({ x: this.x + this.forwardX * off, z: this.z + this.forwardZ * off, r }));
  }

  private collide(world: Terrain, others: Vehicle[]): void {
    this.impact = 0;
    for (const c of this.circlesWorld()) {
      const res = world.collide(c.x, c.z, c.r, true);
      let dx = res.hit ? res.x - c.x : 0;
      let dz = res.hit ? res.z - c.z : 0;
      let nx = res.nx, nz = res.nz, hit = res.hit;
      // other vehicles
      for (const o of others) {
        if (o === this) continue;
        for (const oc of o.circlesWorld()) {
          const ex = c.x - oc.x, ez = c.z - oc.z;
          const d = Math.hypot(ex, ez);
          const min = c.r + oc.r;
          if (d < min && d > 1e-4) {
            dx += (ex / d) * (min - d);
            dz += (ez / d) * (min - d);
            nx = ex / d; nz = ez / d;
            hit = true;
          }
        }
      }
      if (!hit) continue;
      this.x += dx;
      this.z += dz;
      const along = this.forwardX * nx + this.forwardZ * nz;
      const into = along * Math.sign(this.speed);
      if (into < -0.4) {
        this.impact = Math.max(this.impact, Math.min(1, Math.abs(this.speed) / 15));
        this.speed *= 0.25;
      } else {
        this.speed *= 0.97; // scraping along a wall
      }
    }
  }

  sync(dt: number): void {
    const m = this.model;
    m.root.position.set(this.x, 0, this.z);
    m.root.rotation.y = this.heading;
    // lean (bike) / body roll (car)
    const lat = this.speed * this.yawRate; // lateral acceleration
    if (this.spec.kind === 'bike') {
      const targetLean = Math.max(-0.6, Math.min(0.6, Math.atan(lat / G) * 0.85));
      this.lean += (targetLean - this.lean) * Math.min(1, dt * 8);
      m.body.rotation.z = -this.lean;
      if (m.frontFork) m.frontFork.rotation.y = -this.steer;
      // stand on the side stand when parked and empty
      if (!this.occupied && Math.abs(this.speed) < 0.1) m.body.rotation.z = 0.12;
    } else {
      const roll = Math.max(-0.06, Math.min(0.06, lat * 0.006));
      this.lean += (roll - this.lean) * Math.min(1, dt * 5);
      m.body.rotation.z = this.lean;
      m.wheels[0].rotation.y = -this.steer;
      m.wheels[1].rotation.y = -this.steer;
    }
    this.wheelSpin -= (this.speed / this.spec.wheelRadius) * dt;
    for (const w of m.wheels) w.rotation.x = this.wheelSpin;
  }
}
