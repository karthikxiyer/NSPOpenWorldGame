import * as THREE from 'three';
import type { GEdge, RoadGraph } from '../world/RoadGraph';
import type { Poi } from '../world/types';
import { instanced } from './mesher';
import { person } from './models';
import type { Body, Spatial } from './Spatial';

const SHIRTS = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#ecf0f1', '#8e44ad', '#e67e22', '#16a085', '#d35400', '#f5b7b1', '#7fb3d5', '#fad7a0', '#1abc9c', '#ffffff'];
const BUSY_POIS = new Set(['shop', 'food', 'health', 'bank', 'education', 'worship', 'amenity']);

interface Ped {
  from: number;
  edge: GEdge;
  t: number;
  speed: number;
  side: 1 | -1;
  x: number;
  z: number;
  heading: number;
  phase: number;
  /** extra sideways displacement when dodging */
  ox: number;
  oz: number;
  idle: number;
  color: THREE.Color;
  body: Body;
}

export class People {
  private peds: Ped[] = [];
  private poses: THREE.InstancedMesh[];
  private tmp = new THREE.Object3D();
  private spawnTimer = 0;

  constructor(scene: THREE.Scene, private max: number, private radius: number) {
    this.poses = [instanced(person(0), max), instanced(person(1), max)];
    scene.add(...this.poses);
  }

  bodies(): Body[] {
    return this.peds.map((p) => p.body);
  }

  rebind(graph: RoadGraph, old: RoadGraph | null): void {
    if (!old) return;
    this.peds = this.peds.filter((p) => {
      const from = graph.find(old.xs[p.from], old.zs[p.from]);
      const to = graph.find(old.xs[p.edge.to], old.zs[p.edge.to]);
      if (from === undefined || to === undefined) return false;
      const e = graph.adj[from].find((q) => q.to === to);
      if (!e) return false;
      p.from = from;
      p.edge = e;
      return true;
    });
  }

  update(dt: number, graph: RoadGraph, pois: Poi[], px: number, pz: number, spatial: Spatial, initial = false): void {
    this.peds = this.peds.filter((p) => Math.hypot(p.x - px, p.z - pz) < this.radius + 60);
    this.spawnTimer -= dt;
    let budget = initial ? this.max : 2;
    while (this.peds.length < this.max && budget-- > 0 && (initial || this.spawnTimer <= 0)) {
      this.spawnTimer = 0.2;
      this.spawn(graph, pois, px, pz, initial ? 12 : this.radius * 0.5);
    }
    for (const p of this.peds) this.walk(p, dt, graph, spatial);
    this.render();
  }

  private spawn(graph: RoadGraph, pois: Poi[], px: number, pz: number, rMin: number): void {
    let v = -1;
    // half of the people gather around shops, eateries and stations
    if (Math.random() < 0.5 && pois.length) {
      const near = pois.filter((q) => BUSY_POIS.has(q.k) && Math.hypot(q.x - px, q.z - pz) < this.radius);
      if (near.length) {
        const q = near[Math.floor(Math.random() * near.length)];
        if (Math.hypot(q.x - px, q.z - pz) > rMin * 0.5) v = graph.nearest(q.x, q.z, 60);
      }
    }
    if (v < 0) v = graph.randomInRing(px, pz, rMin, this.radius);
    if (v < 0 || !graph.adj[v].length) return;
    const edge = graph.adj[v][Math.floor(Math.random() * graph.adj[v].length)];
    const p: Ped = {
      from: v, edge, t: Math.random() * edge.len, speed: 1.1 + Math.random() * 0.5, side: Math.random() < 0.5 ? 1 : -1,
      x: 0, z: 0, heading: 0, phase: Math.random() * 6, ox: 0, oz: 0, idle: 0,
      color: new THREE.Color(SHIRTS[Math.floor(Math.random() * SHIRTS.length)]),
      body: { x: 0, z: 0, r: 0.35, kind: 'ped', ref: null },
    };
    p.body.ref = p;
    this.place(p, graph);
    this.peds.push(p);
  }

  private walk(p: Ped, dt: number, graph: RoadGraph, spatial: Spatial): void {
    // dodge vehicles bearing down on us
    spatial.near(p.x, p.z, 4, (b) => {
      if (b.kind !== 'player' && b.kind !== 'car') return;
      const ex = p.x - b.x, ez = p.z - b.z;
      const d = Math.hypot(ex, ez);
      const min = b.r + 0.9;
      if (d < min && d > 1e-3) {
        p.ox += (ex / d) * (min - d);
        p.oz += (ez / d) * (min - d);
      }
    });
    const decay = Math.min(1, dt * 0.5);
    p.ox -= p.ox * decay;
    p.oz -= p.oz * decay;

    if (p.idle > 0) {
      p.idle -= dt;
    } else {
      p.t += p.speed * dt;
      while (p.t >= p.edge.len) {
        p.t -= p.edge.len;
        const at = p.edge.to;
        const options = graph.adj[at].filter((e) => e.to !== p.from);
        const back = graph.adj[at].find((e) => e.to === p.from);
        const next = options.length && Math.random() > 0.08 ? options[Math.floor(Math.random() * options.length)] : back ?? options[0];
        if (!next) { p.t = p.edge.len; break; }
        p.from = at;
        p.edge = next;
        // stop and chat now and then
        if (Math.random() < 0.06) p.idle = 2 + Math.random() * 6;
      }
      p.phase += dt * p.speed * 3.2;
    }
    this.place(p, graph);
  }

  private place(p: Ped, graph: RoadGraph): void {
    const ax = graph.xs[p.from], az = graph.zs[p.from];
    const bx = graph.xs[p.edge.to], bz = graph.zs[p.edge.to];
    const dx = (bx - ax) / p.edge.len, dz = (bz - az) / p.edge.len;
    const k = Math.min(1, p.t / p.edge.len);
    // walk along the edge of the road, on our chosen side
    const off = (p.edge.w / 2 + 0.8) * p.side;
    p.x = ax + (bx - ax) * k + dz * off + p.ox;
    p.z = az + (bz - az) * k - dx * off + p.oz;
    p.heading = Math.atan2(-dx, -dz);
    p.body.x = p.x;
    p.body.z = p.z;
  }

  private render(): void {
    const counts = [0, 0];
    const o = this.tmp;
    for (const p of this.peds) {
      const pose = p.idle > 0 ? 1 : Math.sin(p.phase) > 0 ? 0 : 1;
      const m = this.poses[pose];
      const i = counts[pose]++;
      o.position.set(p.x, 0, p.z);
      o.rotation.set(0, p.heading, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, p.color);
    }
    this.poses.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }
}
