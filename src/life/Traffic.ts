import * as THREE from 'three';
import type { GEdge, RoadGraph } from '../world/RoadGraph';
import { instanced } from './mesher';
import { autoRickshaw, bus, hatchback, scooter, tempo } from './models';
import type { Body, Spatial } from './Spatial';

interface VType {
  name: string;
  geo: () => THREE.BufferGeometry;
  /** m/s */
  max: number;
  accel: number;
  /** half length, collision radius */
  half: number;
  r: number;
  weight: number;
  /** allowed road classes */
  maxClass: number;
  colors: string[];
}

const TYPES: VType[] = [
  { name: 'auto', geo: autoRickshaw, max: 11, accel: 1.8, half: 1.35, r: 0.8, weight: 0.36, maxClass: 6, colors: ['#ffffff'] },
  { name: 'car', geo: hatchback, max: 15, accel: 2.6, half: 1.9, r: 0.95, weight: 0.3, maxClass: 6,
    colors: ['#f4f4f4', '#c9ccd1', '#9aa0a8', '#b3202a', '#1f3f7a', '#2a2a2e', '#6a1f2b', '#e8e2d0', '#3a6b8a'] },
  { name: 'scooter', geo: scooter, max: 13, accel: 3, half: 0.9, r: 0.5, weight: 0.2, maxClass: 7,
    colors: ['#c0392b', '#2e86c1', '#f5f5f5', '#27ae60', '#8e44ad', '#f39c12', '#34495e'] },
  { name: 'tempo', geo: tempo, max: 11, accel: 1.6, half: 2.0, r: 1.0, weight: 0.09, maxClass: 5, colors: ['#2e7d32', '#1565c0', '#f9a825', '#c62828'] },
  { name: 'bus', geo: bus, max: 12, accel: 1.1, half: 5.5, r: 1.3, weight: 0.05, maxClass: 4, colors: ['#ffffff'] },
];

/** cruising speed by road class */
const CLASS_SPEED = [0, 22, 16, 14, 12, 9, 6, 5, 3, 3];

interface Car {
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
}

export class Traffic {
  private cars: Car[] = [];
  private meshes: THREE.InstancedMesh[];
  private tmp = new THREE.Object3D();
  private spawnTimer = 0;

  constructor(scene: THREE.Scene, private max: number, private radius: number) {
    this.meshes = TYPES.map((t) => {
      const m = instanced(t.geo(), max);
      scene.add(m);
      return m;
    });
  }

  get count(): number {
    return this.cars.length;
  }

  bodies(): Body[] {
    return this.cars.map((c) => c.body);
  }

  /** Called when the road graph is rebuilt: re-anchor cars onto the new vertex ids. */
  rebind(graph: RoadGraph, oldGraph: RoadGraph | null): void {
    if (!oldGraph) return;
    this.cars = this.cars.filter((c) => {
      const from = graph.find(oldGraph.xs[c.from], oldGraph.zs[c.from]);
      const to = graph.find(oldGraph.xs[c.edge.to], oldGraph.zs[c.edge.to]);
      if (from === undefined || to === undefined) return false;
      const e = graph.adj[from].find((q) => q.to === to);
      if (!e) return false;
      c.from = from;
      c.edge = e;
      c.next = null;
      return true;
    });
  }

  update(dt: number, graph: RoadGraph, px: number, pz: number, spatial: Spatial, crossingClosed: (x: number, z: number, d: number) => boolean, initial = false): void {
    // despawn far cars
    this.cars = this.cars.filter((c) => Math.hypot(c.x - px, c.z - pz) < this.radius + 80);
    // spawn in a ring around the player, mostly out of sight
    this.spawnTimer -= dt;
    let budget = initial ? this.max : 2;
    while (this.cars.length < this.max && budget-- > 0 && (initial || this.spawnTimer <= 0)) {
      this.spawnTimer = 0.25;
      this.spawn(graph, px, pz, initial ? 25 : this.radius * 0.55);
    }

    for (const c of this.cars) this.drive(c, dt, graph, spatial, crossingClosed);
    this.render();
  }

  private spawn(graph: RoadGraph, px: number, pz: number, rMin: number): void {
    const v = graph.randomInRing(px, pz, rMin, this.radius);
    if (v < 0) return;
    const edges = graph.adj[v];
    const roll = Math.random();
    let acc = 0;
    let type = TYPES[0];
    for (const t of TYPES) {
      acc += t.weight;
      if (roll <= acc) { type = t; break; }
    }
    const options = edges.filter((e) => e.c <= type.maxClass);
    if (!options.length) return;
    const edge = options[Math.floor(Math.random() * options.length)];
    // don't spawn on top of another car
    let blocked = false;
    for (const o of this.cars) if (Math.hypot(o.x - graph.xs[v], o.z - graph.zs[v]) < 10) { blocked = true; break; }
    if (blocked) return;
    const color = new THREE.Color(type.colors[Math.floor(Math.random() * type.colors.length)]);
    const car: Car = {
      type, from: v, edge, next: null, t: 0, speed: 0, x: graph.xs[v], z: graph.zs[v], heading: 0,
      stuck: 0, ghost: 0, color, body: { x: graph.xs[v], z: graph.zs[v], r: type.r, kind: 'car', ref: null },
    };
    car.body.ref = car;
    car.speed = Math.min(type.max, CLASS_SPEED[edge.c]) * 0.6;
    this.place(car, graph, true);
    this.cars.push(car);
  }

  private chooseNext(c: Car, graph: RoadGraph): GEdge | null {
    const at = c.edge.to;
    const options = graph.adj[at].filter((e) => e.to !== c.from && e.c <= c.type.maxClass);
    if (options.length) {
      // prefer staying on roads of a similar class
      const same = options.filter((e) => Math.abs(e.c - c.edge.c) <= 1);
      const pool = same.length && Math.random() < 0.7 ? same : options;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    // dead end (or edge of the loaded area): turn around if we can
    return graph.adj[at].find((e) => e.to === c.from) ?? null;
  }

  private drive(c: Car, dt: number, graph: RoadGraph, spatial: Spatial, crossingClosed: (x: number, z: number, d: number) => boolean): void {
    const ax = graph.xs[c.from], az = graph.zs[c.from];
    const bx = graph.xs[c.edge.to], bz = graph.zs[c.edge.to];
    const dx = (bx - ax) / c.edge.len, dz = (bz - az) / c.edge.len;
    if (!c.next) c.next = this.chooseNext(c, graph);

    // cruise speed, slowed for the corner ahead
    let target = Math.min(c.type.max, CLASS_SPEED[c.edge.c] ?? 6);
    const remain = c.edge.len - c.t;
    if (c.next) {
      const nx = graph.xs[c.next.to] - bx, nz = graph.zs[c.next.to] - bz;
      const nl = Math.hypot(nx, nz) || 1;
      const cos = (dx * nx + dz * nz) / nl;
      const cornerSpeed = 3 + 9 * Math.max(0, cos);
      if (remain < 25) target = Math.min(target, cornerSpeed + remain * 0.4);
    } else if (remain < 15) target = Math.min(target, remain * 0.5);

    // look ahead for anything in our path
    if (c.ghost > 0) c.ghost -= dt;
    else {
      const look = 6 + c.speed * 1.4 + c.type.half;
      const cx = c.x + dx * look * 0.5, cz = c.z + dz * look * 0.5;
      spatial.near(cx, cz, look * 0.6 + 2, (b) => {
        if (b.ref === c) return;
        const rx = b.x - c.x, rz = b.z - c.z;
        const f = rx * dx + rz * dz;
        if (f <= 0 || f > look) return;
        const lat = Math.abs(rx * -dz + rz * dx);
        if (lat > b.r + c.type.r + 0.4) return;
        // ignore oncoming cars in the other lane
        const gap = f - c.type.half - b.r - 1.5;
        target = Math.min(target, Math.max(0, gap * 0.7));
      });
      if (crossingClosed(c.x + dx * (c.type.half + 8), c.z + dz * (c.type.half + 8), 6)) target = 0;
    }

    const dv = target - c.speed;
    c.speed += Math.max(-7 * dt, Math.min(c.type.accel * dt, dv));
    if (c.speed < 0) c.speed = 0;
    // gridlock breaker: after sitting still a while, squeeze through for a moment
    if (c.speed < 0.2) {
      c.stuck += dt;
      if (c.stuck > 5) { c.ghost = 2.5; c.stuck = 0; }
    } else c.stuck = 0;

    c.t += c.speed * dt;
    while (c.t >= c.edge.len) {
      if (!c.next) { c.t = c.edge.len; c.speed = 0; break; }
      c.t -= c.edge.len;
      c.from = c.edge.to;
      c.edge = c.next;
      c.next = null;
      c.next = this.chooseNext(c, graph);
    }
    this.place(c, graph, false, dt);
  }

  private place(c: Car, graph: RoadGraph, snap: boolean, dt = 0): void {
    const ax = graph.xs[c.from], az = graph.zs[c.from];
    const bx = graph.xs[c.edge.to], bz = graph.zs[c.edge.to];
    const k = c.t / c.edge.len;
    const dx = (bx - ax) / c.edge.len, dz = (bz - az) / c.edge.len;
    // keep left: offset toward the left of the direction of travel
    const lane = Math.min(c.edge.w / 4, 2.2) + (c.type.name === 'scooter' ? 0.8 : 0);
    const tx = ax + (bx - ax) * k + dz * lane;
    const tz = az + (bz - az) * k - dx * lane;
    const heading = Math.atan2(-dx, -dz);
    if (snap) {
      c.x = tx; c.z = tz; c.heading = heading;
    } else {
      const f = Math.min(1, dt * 8);
      c.x += (tx - c.x) * f;
      c.z += (tz - c.z) * f;
      let d = heading - c.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.heading += d * Math.min(1, dt * 6);
    }
    c.body.x = c.x;
    c.body.z = c.z;
  }

  private render(): void {
    const counts = new Array(TYPES.length).fill(0);
    const o = this.tmp;
    for (const c of this.cars) {
      const ti = TYPES.indexOf(c.type);
      const m = this.meshes[ti];
      const i = counts[ti]++;
      o.position.set(c.x, 0, c.z);
      o.rotation.set(0, c.heading, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.color);
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  /** Push a circle out of any traffic vehicle (cars modelled as a row of circles). */
  collide(x: number, z: number, r: number): { x: number; z: number; nx: number; nz: number } | null {
    for (const c of this.cars) {
      if (Math.abs(c.x - x) > 8 || Math.abs(c.z - z) > 8) continue;
      const fx = -Math.sin(c.heading), fz = -Math.cos(c.heading);
      const steps = Math.max(1, Math.round(c.type.half / c.type.r));
      for (let k = -steps; k <= steps; k++) {
        const off = (k / steps) * (c.type.half - c.type.r * 0.6);
        const cx = c.x + fx * off, cz = c.z + fz * off;
        const ex = x - cx, ez = z - cz;
        const d = Math.hypot(ex, ez), min = r + c.type.r;
        if (d < min && d > 1e-4) {
          const nx = ex / d, nz = ez / d;
          return { x: cx + nx * (min + 0.01), z: cz + nz * (min + 0.01), nx, nz };
        }
      }
    }
    return null;
  }
}
