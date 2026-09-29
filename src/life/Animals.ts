import * as THREE from 'three';
import { cow, dog, goat } from '../art/lifeModels';
import type { PushResult, Terrain } from '../world/Terrain';
import { InstanceWriter, instanced } from './instancing';
import type { RoadGraph, Wrap } from './RoadGraph';
import type { Body, Spatial } from './Spatial';

interface Species {
  name: 'cow' | 'dog' | 'goat';
  geo: (pose: 0 | 1 | 2) => THREE.BufferGeometry;
  weight: number;
  walk: number;
  run: number;
  r: number;
  /** chance of lying down when idle */
  lie: number;
  /** runs away from fast vehicles */
  skittish: boolean;
  colors: string[];
}

const SPECIES: Species[] = [
  { name: 'cow', geo: cow, weight: 0.4, walk: 0.7, run: 0.7, r: 0.8, lie: 0.45, skittish: false, colors: ['#f2efe6', '#e6dccb', '#c9c0b0', '#8a6a4f', '#b88a5a'] },
  { name: 'dog', geo: dog, weight: 0.45, walk: 1.3, run: 4.5, r: 0.35, lie: 0.5, skittish: true, colors: ['#c89a5c', '#a87444', '#3a2e26', '#e8d8b8', '#6b5140'] },
  { name: 'goat', geo: goat, weight: 0.15, walk: 0.9, run: 3, r: 0.4, lie: 0.2, skittish: true, colors: ['#f4f1ea', '#2e2a26', '#7a5a3e', '#d8c8a8'] },
];

interface Animal {
  sp: Species;
  x: number;
  z: number;
  heading: number;
  tx: number;
  tz: number;
  state: 'idle' | 'walk' | 'lie' | 'flee';
  timer: number;
  phase: number;
  color: THREE.Color;
  body: Body;
}

export class Animals {
  private animals: Animal[] = [];
  private writers: InstanceWriter[][];
  private spawnTimer = 0;

  constructor(scene: THREE.Scene, private max: number, private radius: number, shadows: boolean, private wrap: Wrap, private rand: () => number, private terrain: Terrain) {
    this.writers = SPECIES.map((s) => [0, 1, 2].map((pose) => {
      const m = instanced(s.geo(pose as 0 | 1 | 2), max, shadows);
      scene.add(m);
      return new InstanceWriter(m);
    }));
  }

  bodies(): Body[] {
    return this.animals.map((a) => a.body);
  }

  update(dt: number, graph: RoadGraph, px: number, pz: number, spatial: Spatial, initial: boolean, unseen: (x: number, z: number) => boolean): void {
    this.animals = this.animals.filter((a) => this.wrap.dist(a.x, a.z, px, pz) < this.radius + 40);
    this.spawnTimer -= dt;
    let budget = initial ? this.max : 1;
    while (this.animals.length < this.max && budget-- > 0 && (initial || this.spawnTimer <= 0)) {
      this.spawnTimer = 0.6;
      this.spawn(graph, px, pz, initial ? 15 : 30, initial ? null : unseen);
    }
    for (const a of this.animals) this.think(a, dt, spatial);
  }

  private spawn(graph: RoadGraph, px: number, pz: number, rMin: number, unseen: ((x: number, z: number) => boolean) | null): void {
    const v = graph.randomInRing(px, pz, rMin, this.radius, this.rand);
    if (v < 0 || (unseen && !unseen(graph.xs[v], graph.zs[v]))) return;
    const roll = this.rand();
    let acc = 0, sp = SPECIES[0];
    for (const s of SPECIES) {
      acc += s.weight;
      if (roll <= acc) { sp = s; break; }
    }
    // on the road or just beside it
    const a0 = this.rand() * Math.PI * 2, d0 = this.rand() * 5;
    const x = this.wrap.fx(graph.xs[v] + Math.cos(a0) * d0), z = this.wrap.fz(graph.zs[v] + Math.sin(a0) * d0);
    if (this.terrain.isWater(x, z) || this.terrain.collide(x, z, sp.r, false, false).hit) return;
    const lying = this.rand() < sp.lie;
    const an: Animal = {
      sp, x, z, heading: this.rand() * Math.PI * 2, tx: x, tz: z,
      state: lying ? 'lie' : 'idle', timer: lying ? 20 + this.rand() * 60 : this.rand() * 4, phase: 0,
      color: new THREE.Color(sp.colors[Math.floor(this.rand() * sp.colors.length)]),
      body: { x, z, r: sp.r, kind: 'animal', ref: null },
    };
    an.body.ref = an;
    this.animals.push(an);
  }

  private think(a: Animal, dt: number, spatial: Spatial): void {
    const w = this.wrap;
    // skittish animals bolt from anything fast coming close
    if (a.sp.skittish && a.state !== 'flee') {
      spatial.near(a.x, a.z, 9, (b) => {
        if (b.kind !== 'player' && b.kind !== 'car') return;
        const ex = w.dx(b.x, a.x), ez = w.dz(b.z, a.z), l = Math.hypot(ex, ez) || 1;
        if (l > 7) return;
        a.tx = a.x + (ex / l) * 12;
        a.tz = a.z + (ez / l) * 12;
        a.state = 'flee';
        a.timer = 3;
      });
    }
    a.timer -= dt;
    if (a.state === 'idle' || a.state === 'lie') {
      if (a.timer <= 0) {
        if (this.rand() < a.sp.lie * 0.5) { a.state = 'lie'; a.timer = 15 + this.rand() * 40; }
        else {
          const ang = this.rand() * Math.PI * 2, d = 4 + this.rand() * 14;
          a.tx = a.x + Math.cos(ang) * d;
          a.tz = a.z + Math.sin(ang) * d;
          a.state = 'walk';
          a.timer = 20;
        }
      }
    } else {
      const speed = a.state === 'flee' ? a.sp.run : a.sp.walk;
      const ex = w.dx(a.x, a.tx), ez = w.dz(a.z, a.tz);
      const d = Math.hypot(ex, ez);
      if (d < 0.5 || a.timer <= 0) {
        a.state = 'idle';
        a.timer = 2 + this.rand() * 8;
      } else {
        const want = Math.atan2(-ex, -ez);
        let diff = want - a.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        a.heading += diff * Math.min(1, dt * 4);
        const nx = a.x - Math.sin(a.heading) * speed * dt;
        const nz = a.z - Math.cos(a.heading) * speed * dt;
        if (this.terrain.isWater(nx, nz)) {
          a.state = 'idle';
          a.timer = 1;
        } else {
          const res = this.terrain.collide(nx, nz, a.sp.r, false, false);
          a.x = w.fx(res.x);
          a.z = w.fz(res.z);
          if (res.hit) { a.state = 'idle'; a.timer = 1 + this.rand() * 3; }
        }
        a.phase += dt * speed * 4;
      }
    }
    // dogs and goats get shoved by vehicles (cows don't budge: vehicles bounce off them instead)
    if (a.sp.name !== 'cow') {
      spatial.near(a.x, a.z, 3, (b) => {
        if (b.kind !== 'player' && b.kind !== 'car') return;
        const ex = w.dx(b.x, a.x), ez = w.dz(b.z, a.z), d = Math.hypot(ex, ez), min = b.r + a.sp.r;
        if (d < min && d > 1e-3) { a.x = w.fx(a.x + (ex / d) * (min - d)); a.z = w.fz(a.z + (ez / d) * (min - d)); }
      });
    }
    a.body.x = a.x;
    a.body.z = a.z;
  }

  render(fx: number, fz: number): void {
    const w = this.wrap;
    for (const poses of this.writers) for (const wr of poses) wr.begin();
    for (const a of this.animals) {
      const pose = a.state === 'lie' ? 2 : a.state === 'walk' || a.state === 'flee' ? (Math.sin(a.phase) > 0 ? 0 : 1) : 1;
      this.writers[SPECIES.indexOf(a.sp)][pose].add(w.near(a.x, fx, w.W), 0, w.near(a.z, fz, w.H), a.heading, a.color);
    }
    for (const poses of this.writers) for (const wr of poses) wr.end();
  }

  /** Cows are solid: two circles along the body. */
  collide(x: number, z: number, r: number): PushResult | null {
    const w = this.wrap;
    for (const a of this.animals) {
      if (a.sp.name !== 'cow') continue;
      const ox = w.dx(a.x, x), oz = w.dz(a.z, z);
      if (Math.abs(ox) > 4 || Math.abs(oz) > 4) continue;
      for (const off of [-0.5, 0.5]) {
        const ex = ox + Math.sin(a.heading) * off, ez = oz + Math.cos(a.heading) * off;
        const d = Math.hypot(ex, ez), min = r + 0.6;
        if (d < min && d > 1e-4) {
          const nx = ex / d, nz = ez / d;
          return { x: x + nx * (min - d + 0.01), z: z + nz * (min - d + 0.01), hit: true, nx, nz };
        }
      }
    }
    return null;
  }
}
