import type * as THREE from 'three';
import type { InputState } from '../input/Input';
import type { World } from '../world/World';
import { animateWalk, makePerson, poseSeated, type PersonModel } from './models';
import type { Vehicle } from './Vehicle';

const WALK = 3.2;
const RUN = 7.5;
const RADIUS = 0.35;

export class Player {
  readonly model: PersonModel = makePerson();
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  vehicle: Vehicle | null = null;
  private phase = 0;

  place(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.sync();
  }

  /** Move on foot relative to the camera yaw. */
  update(dt: number, input: InputState, camYaw: number, world: World, vehicles: Vehicle[]): void {
    if (this.vehicle) return;
    // camera-relative direction: forward = (-sin, -cos), right = (cos, -sin)
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * input.y + rx * input.x;
    let dz = fz * input.y + rz * input.x;
    const mag = Math.min(1, Math.hypot(dx, dz));
    const target = mag > 0.05 ? (input.alt ? RUN : WALK) * mag : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (mag > 0.05) {
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      const want = Math.atan2(-dx, -dz);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 12);
    }
    const nx = this.x - Math.sin(this.heading) * this.speed * dt;
    const nz = this.z - Math.cos(this.heading) * this.speed * dt;
    if (!world.isWater(nx, nz) && world.inBounds(nx, nz)) {
      this.x = nx;
      this.z = nz;
    }
    const res = world.collide(this.x, this.z, RADIUS);
    if (res.hit) { this.x = res.x; this.z = res.z; }
    // don't walk through parked vehicles
    for (const v of vehicles) {
      for (const c of v.circlesWorld()) {
        const ex = this.x - c.x, ez = this.z - c.z;
        const d = Math.hypot(ex, ez), min = c.r + RADIUS;
        if (d < min && d > 1e-4) { this.x += (ex / d) * (min - d); this.z += (ez / d) * (min - d); }
      }
    }
    this.phase += dt * (2.2 + this.speed * 1.6);
    animateWalk(this.model, this.phase, Math.min(1, this.speed / WALK));
    this.sync();
  }

  enter(v: Vehicle): void {
    this.vehicle = v;
    v.occupied = true;
    const m = this.model;
    m.root.removeFromParent();
    v.model.body.add(m.root);
    // seat is the rider's hip position; the person's hip pivot is 0.88 m above its feet
    m.root.position.copy(v.model.seat).setY(v.model.seat.y - 0.88);
    m.root.rotation.set(0, 0, 0);
    poseSeated(m, v.spec.kind);
    m.helmet.visible = v.spec.kind === 'bike';
    // the blob shadow belongs to the vehicle now
    m.root.children[m.root.children.length - 1].visible = false;
    // hide in the car: the tinted glass hides the driver anyway and avoids clipping
    m.root.visible = v.spec.kind === 'bike';
  }

  /** Step off to the left of the vehicle (kerb side in India). */
  exit(scene: THREE.Object3D, world: World): boolean {
    const v = this.vehicle;
    if (!v) return false;
    const side = v.spec.kind === 'car' ? 1.6 : 0.9;
    // left of forward (fx, fz) is (fz, -fx)
    let ex = v.x + v.forwardZ * side, ez = v.z - v.forwardX * side;
    if (world.isWater(ex, ez) || world.collide(ex, ez, RADIUS).hit) {
      ex = v.x - v.forwardZ * side;
      ez = v.z + v.forwardX * side;
    }
    v.occupied = false;
    this.vehicle = null;
    const m = this.model;
    m.root.removeFromParent();
    scene.add(m.root);
    m.root.visible = true;
    m.helmet.visible = false;
    m.root.children[m.root.children.length - 1].visible = true;
    animateWalk(m, 0, 0);
    m.legL.rotation.z = m.legR.rotation.z = 0;
    this.speed = 0;
    this.place(ex, ez, v.heading);
    return true;
  }

  sync(): void {
    if (this.vehicle) return;
    this.model.root.position.set(this.x, 0, this.z);
    this.model.root.rotation.y = this.heading;
  }
}
