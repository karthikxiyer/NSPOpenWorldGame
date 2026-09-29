import * as THREE from 'three';
import type { RoadGraph } from '../world/RoadGraph';
import type { World } from '../world/World';
import { instanced } from './mesher';
import { cow, dog, goat } from './models';
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
  { name: 'dog', geo: dog, weight: 0.4, walk: 1.3, run: 4.5, r: 0.35, lie: 0.4, skittish: true, colors: ['#c89a5c', '#a87444', '#3a2e26', '#e8d8b8', '#6b5140'] },
  { name: 'goat', geo: goat, weight: 0.2, walk: 0.9, run: 3, r: 0.4, lie: 0.2, skittish: true, colors: ['#f4f1ea', '#2e2a26', '#7a5a3e', '#d8c8a8'] },
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
  private meshes: THREE.InstancedMesh[][];
  private tmp = new THREE.Object3D();
  private spawnTimer = 0;

  constructor(scene: THREE.Scene, private max: number, private radius: number) {
    this.meshes = SPECIES.map((s) => [0, 1, 2].map((pose) => {
      const m = instanced(s.geo(pose as 0 | 1 | 2), max);
      scene.add(m);
      return m;
    }));
  }

  bodies(): Body[] {
    return this.animals.map((a) => a.body);
  }

  update(dt: number, graph: RoadGraph, world: World, px: number, pz: number, spatial: Spatial, initial = false): void {
    this.animals = this.animals.filter((a) => Math.hypot(a.x - px, a.z - pz) < this.radius + 60);
    this.spawnTimer -= dt;
    let budget = initial ? this.max : 1;
    while (this.animals.length < this.max && budget-- > 0 && (initial || this.spawnTimer <= 0)) {
      this.spawnTimer = 0.6;
      this.spawn(graph, world, px, pz, initial ? 15 : this.radius * 0.5);
    }
    for (const a of this.animals) this.think(a, dt, world, spatial);
    this.render();
  }

  private spawn(graph: RoadGraph, world: World, px: number, pz: number, rMin: number): void {
    const v = graph.randomInRing(px, pz, rMin, this.radius);
    if (v < 0) return;
    const roll = Math.random();
    let acc = 0, sp = SPECIES[0];
    for (const s of SPECIES) {
      acc += s.weight;
      if (roll <= acc) { sp = s; break; }
    }
    // on the road or just beside it
    const a0 = Math.random() * Math.PI * 2, d0 = Math.random() * 6;
    const x = graph.xs[v] + Math.cos(a0) * d0, z = graph.zs[v] + Math.sin(a0) * d0;
    if (world.isWater(x, z) || world.collideStatic(x, z, sp.r).hit) return;
    const lying = Math.random() < sp.lie;
    const an: Animal = {
      sp, x, z, heading: Math.random() * Math.PI * 2, tx: x, tz: z,
      state: lying ? 'lie' : 'idle', timer: lying ? 20 + Math.random() * 60 : Math.random() * 4, phase: 0,
      color: new THREE.Color(sp.colors[Math.floor(Math.random() * sp.colors.length)]),
      body: { x, z, r: sp.r, kind: 'animal', ref: null },
    };
    an.body.ref = an;
    this.animals.push(an);
  }

  private think(a: Animal, dt: number, world: World, spatial: Spatial): void {
    // skittish animals bolt from anything fast coming close
    if (a.sp.skittish && a.state !== 'flee') {
      spatial.near(a.x, a.z, 9, (b) => {
        if ((b.kind === 'player' || b.kind === 'car') && Math.hypot(b.x - a.x, b.z - a.z) < 7) {
          const ex = a.x - b.x, ez = a.z - b.z, l = Math.hypot(ex, ez) || 1;
          a.tx = a.x + (ex / l) * 12;
          a.tz = a.z + (ez / l) * 12;
          a.state = 'flee';
          a.timer = 3;
        }
      });
    }
    a.timer -= dt;
    if (a.state === 'idle' || a.state === 'lie') {
      if (a.timer <= 0) {
        if (Math.random() < a.sp.lie * 0.5) { a.state = 'lie'; a.timer = 15 + Math.random() * 40; }
        else {
          const ang = Math.random() * Math.PI * 2, d = 4 + Math.random() * 14;
          a.tx = a.x + Math.cos(ang) * d;
          a.tz = a.z + Math.sin(ang) * d;
          a.state = 'walk';
          a.timer = 20;
        }
      }
    } else {
      const speed = a.state === 'flee' ? a.sp.run : a.sp.walk;
      const ex = a.tx - a.x, ez = a.tz - a.z;
      const d = Math.hypot(ex, ez);
      if (d < 0.5 || a.timer <= 0) {
        a.state = 'idle';
        a.timer = 2 + Math.random() * 8;
      } else {
        const want = Math.atan2(-ex, -ez);
        let diff = want - a.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        a.heading += diff * Math.min(1, dt * 4);
        const nx = a.x - Math.sin(a.heading) * speed * dt;
        const nz = a.z - Math.cos(a.heading) * speed * dt;
        if (world.isWater(nx, nz)) {
          a.state = 'idle';
          a.timer = 1;
        } else {
          const res = world.collideStatic(nx, nz, a.sp.r);
          a.x = res.x;
          a.z = res.z;
          if (res.hit) { a.state = 'idle'; a.timer = 1 + Math.random() * 3; }
        }
        a.phase += dt * speed * 4;
      }
    }
    // get shoved by vehicles (cows don't budge — vehicles bounce off them instead)
    if (a.sp.name !== 'cow') {
      spatial.near(a.x, a.z, 3, (b) => {
        if (b.kind !== 'player' && b.kind !== 'car') return;
        const ex = a.x - b.x, ez = a.z - b.z, d = Math.hypot(ex, ez), min = b.r + a.sp.r;
        if (d < min && d > 1e-3) { a.x += (ex / d) * (min - d); a.z += (ez / d) * (min - d); }
      });
    }
    a.body.x = a.x;
    a.body.z = a.z;
  }

  private render(): void {
    const counts = this.meshes.map(() => [0, 0, 0]);
    const o = this.tmp;
    for (const a of this.animals) {
      const si = SPECIES.indexOf(a.sp);
      const pose = a.state === 'lie' ? 2 : a.state === 'walk' || a.state === 'flee' ? (Math.sin(a.phase) > 0 ? 0 : 1) : 1;
      const m = this.meshes[si][pose];
      const i = counts[si][pose]++;
      o.position.set(a.x, 0, a.z);
      o.rotation.set(0, a.heading, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, a.color);
    }
    this.meshes.forEach((poses, si) => poses.forEach((m, pi) => {
      m.count = counts[si][pi];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }));
  }

  /** Cows are solid obstacles for the player. */
  collide(x: number, z: number, r: number): { x: number; z: number; nx: number; nz: number } | null {
    for (const a of this.animals) {
      if (a.sp.name !== 'cow') continue;
      // a cow is long: two circles along its body
      for (const off of [-0.5, 0.5]) {
        const cx = a.x - Math.sin(a.heading) * off, cz = a.z - Math.cos(a.heading) * off;
        const ex = x - cx, ez = z - cz, d = Math.hypot(ex, ez), min = r + 0.6;
        if (d < min && d > 1e-4) {
          const nx = ex / d, nz = ez / d;
          return { x: cx + nx * (min + 0.01), z: cz + nz * (min + 0.01), nx, nz };
        }
      }
    }
    return null;
  }
}
