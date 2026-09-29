import * as THREE from 'three';
import { Mesher } from '../art/mesher';
import { PAL } from '../core/palette';
import { InstanceWriter, instanced } from '../life/instancing';
import type { Wrap } from '../life/RoadGraph';
import type { Patch } from './patch';

interface Petal {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  spin: number;
  phase: number;
  /** seconds left lying on the ground (0 while falling) */
  rest: number;
  alive: boolean;
  color: THREE.Color;
}

const COLORS = [PAL.petal, PAL.gulmohar, PAL.gulmoharLight, PAL.gulmoharDeep].map((c) => new THREE.Color(c));

/**
 * Gulmohar petals: from the flowering trees near you they drift down, tumbling and fluttering in
 * the breeze, settle on the ground for a while, and get kicked up again by anything fast.
 */
export class Petals {
  private petals: Petal[] = [];
  private gul: { x: number; z: number }[];
  private writer: InstanceWriter;
  private wind = { x: 0.5, z: 0.2, t: 0 };

  constructor(scene: THREE.Scene, patch: Patch, count: number, private wrap: Wrap) {
    this.gul = patch.trees.filter((t) => t[2] === 0).map(([x, z]) => ({ x, z }));
    const m = new Mesher();
    // a slightly cupped petal, a touch larger than life so it reads at game distance
    m.box(0.18, 0.008, 0.13, '#ffffff', 0, 0, 0, undefined, true);
    m.box(0.08, 0.008, 0.08, '#ffffff', 0, 0.016, -0.045, [0.5, 0, 0], true);
    const mesh = instanced(m.build(), count, false);
    scene.add(mesh);
    this.writer = new InstanceWriter(mesh);
    for (let i = 0; i < count; i++) {
      this.petals.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, spin: 0, phase: 0, rest: 0, alive: false, color: COLORS[i % COLORS.length] });
    }
  }

  /**
   * @param kick a fast vehicle near the ground: petals within ~1.8 m of it fly up
   */
  update(dt: number, fx: number, fz: number, kick: { x: number; z: number; speed: number } | null): void {
    const w = this.wrap;
    // the breeze wanders slowly
    this.wind.t += dt;
    this.wind.x = 0.45 + 0.35 * Math.sin(this.wind.t * 0.13);
    this.wind.z = 0.2 + 0.3 * Math.sin(this.wind.t * 0.071 + 1);
    const near = this.gul.filter((g) => w.dist(g.x, g.z, fx, fz) < 50);
    let spawn = Math.min(8, near.length * 0.9 * dt + Math.random());
    for (const p of this.petals) {
      if (!p.alive) {
        if (spawn >= 1 && near.length) {
          spawn--;
          const g = near[Math.floor(Math.random() * near.length)];
          const a = Math.random() * Math.PI * 2, r = Math.random() * 2.4;
          p.x = g.x + Math.cos(a) * r;
          p.z = g.z + Math.sin(a) * r;
          p.y = 3.6 + Math.random() * 1.4;
          p.vx = p.vz = 0;
          p.vy = -0.2;
          p.yaw = Math.random() * 6.3;
          p.pitch = Math.random() * 6.3;
          p.spin = 2 + Math.random() * 4;
          p.phase = Math.random() * 6.3;
          p.rest = 0;
          p.alive = true;
        }
        continue;
      }
      if (p.rest > 0) {
        p.rest -= dt;
        if (kick && kick.speed > 6 && w.dist(p.x, p.z, kick.x, kick.z) < 1.8) {
          // swept up in the wake
          p.rest = 0;
          p.vy = 1.2 + Math.random() * 1.5;
          const a = Math.random() * 6.3;
          p.vx = Math.cos(a) * 1.5;
          p.vz = Math.sin(a) * 1.5;
        } else {
          if (p.rest <= 0 || w.dist(p.x, p.z, fx, fz) > 70) p.alive = false;
          continue;
        }
      }
      // falling: drag toward a slow terminal speed, carried by the breeze, fluttering side to side
      p.phase += dt * 3.2;
      p.vy += (-0.75 - p.vy) * Math.min(1, dt * 2.5);
      p.vx += (this.wind.x + Math.cos(p.phase) * 0.6 - p.vx) * Math.min(1, dt * 2);
      p.vz += (this.wind.z + Math.sin(p.phase * 0.8) * 0.6 - p.vz) * Math.min(1, dt * 2);
      p.x = w.fx(p.x + p.vx * dt);
      p.z = w.fz(p.z + p.vz * dt);
      p.y += p.vy * dt;
      p.yaw += p.spin * dt * 0.6;
      p.pitch += p.spin * dt;
      if (p.y <= 0.03) {
        p.y = 0.03;
        p.pitch = 0;
        p.rest = 8 + Math.random() * 10;
      }
    }
  }

  render(fx: number, fz: number): void {
    const w = this.wrap;
    this.writer.begin();
    for (const p of this.petals) {
      if (!p.alive) continue;
      this.writer.add(w.near(p.x, fx, w.W), p.y, w.near(p.z, fz, w.H), p.yaw, p.color, p.pitch);
    }
    this.writer.end();
  }
}
