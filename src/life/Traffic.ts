import * as THREE from 'three';
import { autoRickshaw, bus, hatchback, scooter, tempo } from '../art/lifeModels';
import type { PushResult } from '../world/Terrain';
import { InstanceWriter, instanced } from './instancing';
import type { GEdge, RoadGraph, Wrap } from './RoadGraph';
import type { Body, Spatial } from './Spatial';

interface VType {
  name: 'auto' | 'car' | 'scooter' | 'tempo' | 'bus';
  geo: () => THREE.BufferGeometry;
  /** m/s */
  max: number;
  accel: number;
  /** half length, collision radius */
  half: number;
  r: number;
  weight: number;
  /** biggest (least important) road class it will use */
  maxClass: number;
  colors: string[];
}

const TYPES: VType[] = [
  { name: 'auto', geo: autoRickshaw, max: 11, accel: 1.8, half: 1.35, r: 0.8, weight: 0.34, maxClass: 6, colors: ['#ffffff'] },
  { name: 'car', geo: hatchback, max: 14, accel: 2.6, half: 1.9, r: 0.95, weight: 0.26, maxClass: 6,
    colors: ['#f4f4f4', '#c9ccd1', '#9aa0a8', '#b3202a', '#1f3f7a', '#2a2a2e', '#6a1f2b', '#e8e2d0', '#3a6b8a'] },
  { name: 'scooter', geo: scooter, max: 12, accel: 3, half: 0.9, r: 0.5, weight: 0.28, maxClass: 7,
    colors: ['#c0392b', '#2e86c1', '#f5f5f5', '#27ae60', '#8e44ad', '#f39c12', '#34495e'] },
  { name: 'tempo', geo: tempo, max: 10, accel: 1.6, half: 2.0, r: 1.0, weight: 0.08, maxClass: 5, colors: ['#2e7d32', '#1565c0', '#f9a825', '#c62828'] },
  { name: 'bus', geo: bus, max: 11, accel: 1.1, half: 5.5, r: 1.3, weight: 0.04, maxClass: 4, colors: ['#ffffff'] },
];
const AUTO = TYPES[0];

/** cruising speed by road class (m/s): Nalasopara's streets are slow */
const CLASS_SPEED = [0, 20, 14, 12, 11, 8, 6, 5, 3, 3];

/** What a hailed auto is doing. */
export type Job = 'free' | 'pickup' | 'waiting' | 'hired' | 'arrived';

export interface Car {
  type: VType;
  from: number;
  edge: GEdge;
  next: GEdge | null;
  t: number;
  speed: number;
  x: number;
  z: number;
  heading: number;
  stuck: number;
  ghost: number;
  color: THREE.Color;
  body: Body;
  job: Job;
  /** planned edges (pickup or ride), and where we are in it */
  route: { from: number; edge: GEdge }[] | null;
  ri: number;
  /** how far along the ride (m), for the fare */
  odo: number;
  timer: number;
  /** where it was hailed from */
  hx: number;
  hz: number;
}

const carOk = (t: VType) => (e: GEdge) => e.c <= t.maxClass;

export class Traffic {
  cars: Car[] = [];
  private writers: InstanceWriter[];
  private spawnTimer = 0;

  constructor(scene: THREE.Scene, private max: number, private radius: number, shadows: boolean, private wrap: Wrap, private rand: () => number) {
    this.writers = TYPES.map((t) => {
      const m = instanced(t.geo(), max + 2, shadows);
      scene.add(m);
      return new InstanceWriter(m);
    });
  }

  bodies(): Body[] {
    return this.cars.map((c) => c.body);
  }

  update(dt: number, graph: RoadGraph, px: number, pz: number, spatial: Spatial, initial: boolean, unseen: (x: number, z: number) => boolean): void {
    const w = this.wrap;
    // despawn far traffic, but never an auto with a job
    this.cars = this.cars.filter((c) => c.job !== 'free' || w.dist(c.x, c.z, px, pz) < this.radius + 40);
    this.spawnTimer -= dt;
    let budget = initial ? this.max : 2;
    while (this.cars.length < this.max && budget-- > 0 && (initial || this.spawnTimer <= 0)) {
      this.spawnTimer = 0.2;
      // spawn out of sight (behind you or over the horizon), or all round at the start
      this.spawn(graph, px, pz, initial ? 20 : 35, null, initial ? undefined : unseen);
    }
    for (const c of this.cars) this.drive(c, dt, graph, spatial);
  }

  private pickType(): VType {
    const roll = this.rand();
    let acc = 0;
    for (const t of TYPES) {
      acc += t.weight;
      if (roll <= acc) return t;
    }
    return TYPES[0];
  }

  private spawn(graph: RoadGraph, px: number, pz: number, rMin: number, force: VType | null, unseen?: (x: number, z: number) => boolean): Car | null {
    const type = force ?? this.pickType();
    const ok = carOk(type);
    const v = graph.randomInRing(px, pz, rMin, force ? rMin + 90 : this.radius, this.rand, ok);
    if (v < 0 || (unseen && !unseen(graph.xs[v], graph.zs[v]))) return null;
    const options = graph.adj[v].filter(ok);
    if (!options.length) return null;
    const edge = options[Math.floor(this.rand() * options.length)];
    for (const o of this.cars) if (this.wrap.dist(o.x, o.z, graph.xs[v], graph.zs[v]) < 10) return null;
    const color = new THREE.Color(type.colors[Math.floor(this.rand() * type.colors.length)]);
    const car: Car = {
      type, from: v, edge, next: null, t: 0, speed: 0, x: graph.xs[v], z: graph.zs[v], heading: 0,
      stuck: 0, ghost: 0, color, body: { x: graph.xs[v], z: graph.zs[v], r: type.r, kind: 'car', ref: null },
      job: 'free', route: null, ri: 0, odo: 0, timer: 0, hx: 0, hz: 0,
    };
    car.body.ref = car;
    car.speed = Math.min(type.max, CLASS_SPEED[edge.c] ?? 6) * 0.6;
    this.place(car, graph, true);
    this.cars.push(car);
    return car;
  }

  private chooseNext(c: Car, graph: RoadGraph): GEdge | null {
    if (c.route) {
      const step = c.route[c.ri + 1];
      return step ? step.edge : null;
    }
    const at = c.edge.to;
    const ok = carOk(c.type);
    const options = graph.adj[at].filter((e) => e.to !== c.from && ok(e));
    if (options.length) {
      // prefer staying on roads of a similar class
      const same = options.filter((e) => Math.abs(e.c - c.edge.c) <= 1);
      const pool = same.length && this.rand() < 0.7 ? same : options;
      return pool[Math.floor(this.rand() * pool.length)];
    }
    // dead end: turn around if we can
    return graph.adj[at].find((e) => e.to === c.from) ?? null;
  }

  private drive(c: Car, dt: number, graph: RoadGraph, spatial: Spatial): void {
    if (c.job === 'waiting' || c.job === 'arrived') {
      c.speed = Math.max(0, c.speed - 6 * dt);
      c.timer -= dt;
      this.place(c, graph, false, dt);
      return;
    }
    const dx = c.edge.dx, dz = c.edge.dz;
    if (!c.next) c.next = this.chooseNext(c, graph);

    // cruise speed (a hired auto hurries a little), slowed for the corner ahead
    let target = Math.min(c.type.max * (c.job === 'hired' ? 1.2 : 1), CLASS_SPEED[c.edge.c] ?? 6);
    const remain = c.edge.len - c.t;
    if (c.next) {
      const cos = dx * c.next.dx + dz * c.next.dz;
      const cornerSpeed = 3 + 9 * Math.max(0, cos);
      if (remain < 25) target = Math.min(target, cornerSpeed + remain * 0.4);
    } else target = Math.min(target, Math.max(0, remain - 0.5) * 0.6);

    // look ahead for anything in our lane
    if (c.ghost > 0) c.ghost -= dt;
    else {
      const look = 6 + c.speed * 1.4 + c.type.half;
      const cx = c.x + dx * look * 0.5, cz = c.z + dz * look * 0.5;
      spatial.near(cx, cz, look * 0.6 + 2, (b) => {
        if (b.ref === c || (b.kind === 'player' && c.job === 'hired')) return;
        const rx = this.wrap.dx(c.x, b.x), rz = this.wrap.dz(c.z, b.z);
        const f = rx * dx + rz * dz;
        if (f <= 0 || f > look) return;
        const lat = Math.abs(rx * -dz + rz * dx);
        if (lat > b.r + c.type.r + 0.4) return;
        const gap = f - c.type.half - b.r - 1.5;
        target = Math.min(target, Math.max(0, gap * 0.7));
      });
    }

    const dv = target - c.speed;
    c.speed += Math.max(-7 * dt, Math.min(c.type.accel * dt, dv));
    if (c.speed < 0) c.speed = 0;
    // gridlock breaker: after sitting still a while, squeeze through for a moment
    if (c.speed < 0.2 && c.next) {
      c.stuck += dt;
      if (c.stuck > 5) { c.ghost = 2.5; c.stuck = 0; }
    } else c.stuck = 0;

    c.t += c.speed * dt;
    if (c.job === 'hired') c.odo += c.speed * dt;
    while (c.t >= c.edge.len) {
      if (!c.next) { c.t = c.edge.len; break; }
      c.t -= c.edge.len;
      c.from = c.edge.to;
      c.edge = c.next;
      if (c.route) c.ri++;
      c.next = this.chooseNext(c, graph);
    }
    // on the way to pick you up: pull in as soon as we're alongside
    if (c.job === 'pickup' && this.wrap.dist(c.x, c.z, c.hx, c.hz) < 7) {
      c.route = null;
      c.next = null;
      c.job = 'waiting';
      c.timer = 45;
    }
    // the end of a planned route: pulled in at the kerb
    if (c.route && !c.next && c.edge.len - c.t < 1.5 && c.speed < 0.6) {
      c.route = null;
      if (c.job === 'pickup') { c.job = 'waiting'; c.timer = 45; }
      else if (c.job === 'hired') c.job = 'arrived';
    }
    this.place(c, graph, false, dt);
  }

  private place(c: Car, graph: RoadGraph, snap: boolean, dt = 0): void {
    const w = this.wrap;
    const ax = graph.xs[c.from], az = graph.zs[c.from];
    const dx = c.edge.dx, dz = c.edge.dz;
    // keep left: offset to the left of the direction of travel; autos with a job pull in to the kerb
    const kerb = c.job === 'waiting' || c.job === 'arrived' || ((c.job === 'pickup' || c.job === 'hired') && !c.next && c.edge.len - c.t < 12);
    const lane = kerb ? Math.max(1, c.edge.w / 2 - 0.9) : Math.min(c.edge.w / 4, 2.2) + (c.type.name === 'scooter' ? 0.8 : 0);
    const tx = w.fx(ax + dx * c.t + dz * lane);
    const tz = w.fz(az + dz * c.t - dx * lane);
    const heading = Math.atan2(-dx, -dz);
    if (snap) {
      c.x = tx; c.z = tz; c.heading = heading;
    } else {
      const f = Math.min(1, dt * 8);
      c.x = w.fx(c.x + w.dx(c.x, tx) * f);
      c.z = w.fz(c.z + w.dz(c.z, tz) * f);
      let d = heading - c.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.heading += d * Math.min(1, dt * 6);
    }
    c.body.x = c.x;
    c.body.z = c.z;
  }

  render(fx: number, fz: number): void {
    const w = this.wrap;
    for (const wr of this.writers) wr.begin();
    for (const c of this.cars) {
      this.writers[TYPES.indexOf(c.type)].add(w.near(c.x, fx, w.W), 0, w.near(c.z, fz, w.H), c.heading, c.color);
    }
    for (const wr of this.writers) wr.end();
  }

  /** Push a circle out of any traffic vehicle (vehicles are a row of circles). */
  collide(x: number, z: number, r: number, skip?: Car): PushResult | null {
    const w = this.wrap;
    for (const c of this.cars) {
      if (c === skip) continue;
      const ox = w.dx(c.x, x), oz = w.dz(c.z, z);
      if (Math.abs(ox) > 8 || Math.abs(oz) > 8) continue;
      const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
      const steps = Math.max(1, Math.round(c.type.half / c.type.r));
      for (let k = -steps; k <= steps; k++) {
        const off = (k / steps) * (c.type.half - c.type.r * 0.6);
        const ex = ox - fx * off, ez = oz - fz * off;
        const d = Math.hypot(ex, ez), min = r + c.type.r;
        if (d < min && d > 1e-4) {
          const nx = ex / d, nz = ez / d;
          return { x: x + nx * (min - d + 0.01), z: z + nz * (min - d + 0.01), hit: true, nx, nz };
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // hailing an auto

  /** Wave down an auto: the nearest free one comes to the kerb beside you (or one turns up). */
  hail(graph: RoadGraph, px: number, pz: number): Car | null {
    const w = this.wrap, ok = carOk(AUTO);
    const target = graph.nearest(px, pz, 40, ok);
    if (target < 0) return null;
    const busy = this.cars.find((c) => c.job !== 'free' && c.type === AUTO);
    if (busy) return busy;
    const hail = (c: Car) => {
      if (!this.dispatch(c, graph, target, 'pickup')) return false;
      c.hx = px;
      c.hz = pz;
      return true;
    };
    const free = this.cars
      .filter((c) => c.type === AUTO && c.job === 'free' && w.dist(c.x, c.z, px, pz) < 220)
      .sort((a, b) => w.dist(a.x, a.z, px, pz) - w.dist(b.x, b.z, px, pz));
    const tries = [...free.slice(0, 3)];
    for (const c of tries) if (hail(c)) return c;
    // nobody near: one comes round the corner
    for (let i = 0; i < 6; i++) {
      const c = this.spawn(graph, px, pz, 50, AUTO);
      if (c && hail(c)) return c;
      if (c) this.cars.splice(this.cars.indexOf(c), 1);
    }
    return null;
  }

  /** Send a car along the shortest path to a vertex. */
  dispatch(c: Car, graph: RoadGraph, to: number, job: Job): boolean {
    const path = graph.path(c.edge.to, to, carOk(c.type));
    if (!path) return false;
    c.route = [{ from: c.from, edge: c.edge }, ...path];
    c.ri = 0;
    c.next = c.route[1]?.edge ?? null;
    c.job = job;
    return true;
  }

  release(c: Car): void {
    c.job = 'free';
    c.route = null;
    c.next = null;
    c.odo = 0;
  }
}
