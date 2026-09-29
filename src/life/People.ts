import * as THREE from 'three';
import { person } from '../art/lifeModels';
import type { Patch } from '../world/patch';
import type { Terrain } from '../world/Terrain';
import { InstanceWriter, instanced } from './instancing';
import type { GEdge, RoadGraph, Wrap } from './RoadGraph';
import type { Body, Spatial } from './Spatial';

const SHIRTS = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#ecf0f1', '#8e44ad', '#e67e22', '#16a085', '#d35400', '#f5b7b1', '#7fb3d5', '#fad7a0', '#1abc9c', '#ffffff'];

interface Ped {
  from: number;
  edge: GEdge;
  t: number;
  speed: number;
  side: 1 | -1;
  x: number;
  z: number;
  y: number;
  heading: number;
  phase: number;
  /** extra sideways displacement when dodging */
  ox: number;
  oz: number;
  idle: number;
  /** waiting on a platform: never walks */
  waiting: boolean;
  color: THREE.Color;
  body: Body;
}

export class People {
  private peds: Ped[] = [];
  private poses: InstanceWriter[];
  private spawnTimer = 0;
  /** busy spots: shopfronts, the station, the depot */
  private hotspots: { x: number; z: number }[] = [];
  private platforms: { p: number[]; minX: number; maxX: number; minZ: number; maxZ: number }[];

  constructor(scene: THREE.Scene, private max: number, private radius: number, shadows: boolean, private wrap: Wrap, private rand: () => number, patch: Patch, private terrain: Terrain) {
    this.poses = [0, 1].map((pose) => {
      const m = instanced(person(pose as 0 | 1), max + 24, shadows);
      scene.add(m);
      return new InstanceWriter(m);
    });
    for (let i = 0; i < patch.shops.length; i += 6) if (patch.shops[i + 5]) this.hotspots.push({ x: patch.shops[i], z: patch.shops[i + 1] });
    for (const s of patch.signs) if (s.k === 'shop' || s.k === 'health' || s.k === 'bank') this.hotspots.push(s);
    if (patch.station) for (let i = 0; i < 12; i++) this.hotspots.push(patch.station);
    if (patch.depot) for (let i = 0; i < 8; i++) this.hotspots.push(patch.depot);
    this.platforms = patch.platforms.map(({ p }) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]); }
      return { p, minX, maxX, minZ, maxZ };
    });
  }

  bodies(): Body[] {
    return this.peds.map((p) => p.body);
  }

  update(dt: number, graph: RoadGraph, px: number, pz: number, spatial: Spatial, initial: boolean, unseen: (x: number, z: number) => boolean): void {
    const w = this.wrap;
    this.peds = this.peds.filter((p) => w.dist(p.x, p.z, px, pz) < this.radius + 40);
    this.spawnTimer -= dt;
    let budget = initial ? this.max : 2;
    while (this.peds.length < this.max && budget-- > 0 && (initial || this.spawnTimer <= 0)) {
      this.spawnTimer = 0.15;
      this.spawn(graph, px, pz, initial ? 8 : 30, initial ? null : unseen);
    }
    // commuters waiting on the platforms whenever you're near the station
    for (const pl of this.platforms) {
      const cx = (pl.minX + pl.maxX) / 2, cz = (pl.minZ + pl.maxZ) / 2;
      if (w.dist(cx, cz, px, pz) > this.radius) continue;
      const have = this.peds.filter((p) => p.waiting && p.x >= pl.minX && p.x <= pl.maxX && p.z >= pl.minZ && p.z <= pl.maxZ).length;
      for (let k = have; k < 8; k++) this.spawnWaiting(graph, pl);
    }
    for (const p of this.peds) this.walk(p, dt, graph, spatial);
  }

  private make(v: number, edge: GEdge): Ped {
    const p: Ped = {
      from: v, edge, t: this.rand() * edge.len, speed: 1.1 + this.rand() * 0.5, side: this.rand() < 0.5 ? 1 : -1,
      x: 0, z: 0, y: 0, heading: 0, phase: this.rand() * 6, ox: 0, oz: 0, idle: 0, waiting: false,
      color: new THREE.Color(SHIRTS[Math.floor(this.rand() * SHIRTS.length)]),
      body: { x: 0, z: 0, r: 0.35, kind: 'ped', ref: null },
    };
    p.body.ref = p;
    return p;
  }

  private spawn(graph: RoadGraph, px: number, pz: number, rMin: number, unseen: ((x: number, z: number) => boolean) | null): void {
    const w = this.wrap;
    let v = -1;
    // half of the people gather round shops, the station and the depot
    if (this.rand() < 0.5 && this.hotspots.length) {
      for (let i = 0; i < 6 && v < 0; i++) {
        const q = this.hotspots[Math.floor(this.rand() * this.hotspots.length)];
        const d = w.dist(q.x, q.z, px, pz);
        if (d < this.radius && d > rMin * 0.8) v = graph.nearest(q.x, q.z, 30);
      }
    }
    if (v < 0) v = graph.randomInRing(px, pz, rMin, this.radius, this.rand);
    if (v < 0 || !graph.adj[v].length || (unseen && !unseen(graph.xs[v], graph.zs[v]))) return;
    const p = this.make(v, graph.adj[v][Math.floor(this.rand() * graph.adj[v].length)]);
    // some stop at a shop for a while
    if (this.rand() < 0.3) p.idle = 3 + this.rand() * 12;
    this.place(p, graph);
    this.peds.push(p);
  }

  private spawnWaiting(graph: RoadGraph, pl: { p: number[]; minX: number; maxX: number; minZ: number; maxZ: number }): void {
    for (let tries = 0; tries < 12; tries++) {
      const x = pl.minX + this.rand() * (pl.maxX - pl.minX), z = pl.minZ + this.rand() * (pl.maxZ - pl.minZ);
      // on the platform, a little in from its edges
      if (this.terrain.heightAt(x, z) < 0.5 || this.terrain.heightAt(x + 1.2, z) < 0.5 || this.terrain.heightAt(x - 1.2, z) < 0.5) continue;
      const v = graph.nearest(x, z, 200);
      if (v < 0 || !graph.adj[v].length) return;
      const p = this.make(v, graph.adj[v][0]);
      p.waiting = true;
      p.x = x; p.z = z; p.y = this.terrain.heightAt(x, z);
      p.heading = this.rand() * Math.PI * 2;
      p.body.x = x; p.body.z = z;
      this.peds.push(p);
      return;
    }
  }

  private walk(p: Ped, dt: number, graph: RoadGraph, spatial: Spatial): void {
    // step aside for vehicles bearing down on us
    spatial.near(p.x, p.z, 4, (b) => {
      if (b.kind !== 'player' && b.kind !== 'car') return;
      const ex = this.wrap.dx(b.x, p.x), ez = this.wrap.dz(b.z, p.z);
      const d = Math.hypot(ex, ez);
      const min = b.r + 0.9;
      if (d < min && d > 1e-3) {
        p.ox += (ex / d) * (min - d);
        p.oz += (ez / d) * (min - d);
      }
    });
    if (p.waiting) {
      p.x += p.ox; p.z += p.oz; p.ox = p.oz = 0;
      p.body.x = p.x; p.body.z = p.z;
      return;
    }
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
        const next = options.length && this.rand() > 0.08 ? options[Math.floor(this.rand() * options.length)] : back ?? options[0];
        if (!next) { p.t = p.edge.len; break; }
        p.from = at;
        p.edge = next;
        // stop and chat now and then
        if (this.rand() < 0.06) p.idle = 2 + this.rand() * 6;
      }
      p.phase += dt * p.speed * 3.2;
    }
    this.place(p, graph);
  }

  private place(p: Ped, graph: RoadGraph): void {
    const w = this.wrap;
    const ax = graph.xs[p.from], az = graph.zs[p.from];
    const dx = p.edge.dx, dz = p.edge.dz;
    const t = Math.min(p.edge.len, p.t);
    // along the edge of the road on our side (footpaths: on the path itself)
    const off = p.edge.c >= 8 ? 0.4 * p.side : (p.edge.w / 2 + 0.8) * p.side;
    p.x = w.fx(ax + dx * t + dz * off + p.ox);
    p.z = w.fz(az + dz * t - dx * off + p.oz);
    p.heading = Math.atan2(-dx, -dz);
    p.body.x = p.x;
    p.body.z = p.z;
  }

  render(fx: number, fz: number): void {
    const w = this.wrap;
    for (const wr of this.poses) wr.begin();
    for (const p of this.peds) {
      const pose = p.idle > 0 || p.waiting ? 1 : Math.sin(p.phase) > 0 ? 0 : 1;
      this.poses[pose].add(w.near(p.x, fx, w.W), p.y, w.near(p.z, fz, w.H), p.heading, p.color);
    }
    for (const wr of this.poses) wr.end();
  }
}
