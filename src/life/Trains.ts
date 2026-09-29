import * as THREE from 'three';
import type { PushResult } from '../world/Collision';
import type { Crossing, TrainRoute } from '../world/types';
import { instanced, tintMaterial } from './mesher';
import { COACH_LEN, emuCab, emuCoach, gateArm, gatePole } from './models';

const VMAX = 22; // ~80 km/h
const ACCEL = 0.9;
const DECEL = 1.0;
const DWELL = 20;
const TURNAROUND = 40;
const HALF_W = 1.83;

interface Route {
  xs: Float64Array;
  zs: Float64Array;
  cum: Float64Array;
  len: number;
  stops: number[];
}

interface Train {
  route: Route;
  /** distance of the front along the route */
  s: number;
  dir: 1 | -1;
  v: number;
  dwell: number;
  reverseAfterDwell: boolean;
  coaches: number;
}

interface Gate {
  c: Crossing;
  root: THREE.Group;
  arms: THREE.Mesh[];
  angle: number;
  closed: boolean;
}

export class Trains {
  private routes: Route[];
  private trains: Train[] = [];
  private coachMesh: THREE.InstancedMesh;
  private motorMesh: THREE.InstancedMesh;
  private cabMesh: THREE.InstancedMesh;
  private gates: Gate[] = [];
  private tmp = new THREE.Object3D();
  /** coach centres & headings this frame, for collision */
  private placed: { x: number; z: number; ux: number; uz: number }[] = [];

  constructor(scene: THREE.Scene, routes: TrainRoute[], crossings: Crossing[]) {
    this.routes = routes.map((r) => {
      const n = r.p.length / 2;
      const xs = new Float64Array(n), zs = new Float64Array(n), cum = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = r.p[i * 2];
        zs[i] = r.p[i * 2 + 1];
        if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      }
      return { xs, zs, cum, len: cum[n - 1], stops: r.stops.map((s) => s.s) };
    });
    routes.forEach((r, i) => {
      const route = this.routes[i];
      const coaches = r.kind === 'wr' ? 12 : 8;
      const starts: [number, 1 | -1][] = r.kind === 'wr' ? [[0.3, 1], [0.78, -1]] : [[0.55, -1]];
      for (const [f, dir] of starts) {
        this.trains.push({ route, s: route.len * f, dir, v: VMAX * 0.6, dwell: 0, reverseAfterDwell: false, coaches });
      }
    });
    const total = this.trains.reduce((n, t) => n + t.coaches, 0);
    this.coachMesh = instanced(emuCoach(false), total);
    this.motorMesh = instanced(emuCoach(true), total);
    this.cabMesh = instanced(emuCab(), this.trains.length * 2);
    scene.add(this.coachMesh, this.motorMesh, this.cabMesh);

    const pole = gatePole();
    const arm = gateArm(6.2);
    for (const c of crossings) {
      const root = new THREE.Group();
      const arms: THREE.Mesh[] = [];
      const nx = -c.dz, nz = c.dx; // normal to the road
      for (const side of [1, -1]) {
        // a boom on the kerb side of each approach, arm swinging across the road
        const px = c.x + c.dx * c.h * side + nx * 4 * side;
        const pz = c.z + c.dz * c.h * side + nz * 4 * side;
        const p = new THREE.Mesh(pole, tintMaterial());
        p.position.set(px, 0, pz);
        const pivot = new THREE.Group();
        pivot.position.set(px, 1.05, pz);
        // local +x of the arm should point across the road, toward -normal*side
        pivot.rotation.y = Math.atan2(nz * side, -nx * side) * 1;
        const a = new THREE.Mesh(arm, tintMaterial());
        pivot.add(a);
        root.add(p, pivot);
        arms.push(a);
      }
      root.visible = false;
      scene.add(root);
      this.gates.push({ c, root, arms, angle: 1.4, closed: false });
    }
  }

  private at(r: Route, s: number, out: { x: number; z: number }) {
    s = Math.max(0, Math.min(r.len, s));
    let lo = 0, hi = r.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (r.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = r.cum[hi] - r.cum[lo] || 1;
    const t = (s - r.cum[lo]) / seg;
    out.x = r.xs[lo] + (r.xs[hi] - r.xs[lo]) * t;
    out.z = r.zs[lo] + (r.zs[hi] - r.zs[lo]) * t;
  }

  update(dt: number, px: number, pz: number): void {
    for (const t of this.trains) this.step(t, dt);

    // place coaches
    const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
    let n0 = 0, n1 = 0, nc = 0;
    this.placed.length = 0;
    const o = this.tmp;
    for (const t of this.trains) {
      for (let i = 0; i < t.coaches; i++) {
        const sc = t.s - t.dir * (i * COACH_LEN + COACH_LEN / 2);
        this.at(t.route, sc + t.dir * 7.2, a);
        this.at(t.route, sc - t.dir * 7.2, b);
        const dx = a.x - b.x, dz = a.z - b.z;
        const l = Math.hypot(dx, dz) || 1;
        const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
        this.placed.push({ x: cx, z: cz, ux: dx / l, uz: dz / l });
        o.position.set(cx, 0.2, cz);
        o.rotation.set(0, Math.atan2(-dx, -dz), 0);
        o.updateMatrix();
        const motor = i % 4 === 1;
        if (motor) this.motorMesh.setMatrixAt(n1++, o.matrix);
        else this.coachMesh.setMatrixAt(n0++, o.matrix);
        if (i === 0) this.cabMesh.setMatrixAt(nc++, o.matrix);
        if (i === t.coaches - 1) {
          o.rotation.y += Math.PI;
          o.updateMatrix();
          this.cabMesh.setMatrixAt(nc++, o.matrix);
        }
      }
    }
    for (const [m, n] of [[this.coachMesh, n0], [this.motorMesh, n1], [this.cabMesh, nc]] as const) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }

    // level crossings
    for (const g of this.gates) {
      const d = Math.hypot(g.c.x - px, g.c.z - pz);
      g.root.visible = d < 900;
      let near = false;
      for (const c of this.placed) {
        if (Math.abs(c.x - g.c.x) < 360 && Math.abs(c.z - g.c.z) < 360 && Math.hypot(c.x - g.c.x, c.z - g.c.z) < 350) { near = true; break; }
      }
      g.closed = near;
      const target = near ? 0 : 1.4;
      g.angle += Math.sign(target - g.angle) * Math.min(Math.abs(target - g.angle), dt * 0.6);
      for (const arm of g.arms) arm.rotation.z = g.angle;
    }
  }

  private step(t: Train, dt: number) {
    const r = t.route;
    if (t.dwell > 0) {
      t.dwell -= dt;
      if (t.dwell <= 0 && t.reverseAfterDwell) {
        // the rear becomes the front
        const trainLen = t.coaches * COACH_LEN;
        t.s = t.s - t.dir * trainLen;
        t.dir = t.dir === 1 ? -1 : 1;
        t.reverseAfterDwell = false;
      }
      return;
    }
    // next stop ahead (station or end of line)
    let target = t.dir === 1 ? r.len - t.s : t.s;
    let atEnd = true;
    for (const st of r.stops) {
      const d = (st - t.s) * t.dir;
      if (d > 0.5 && d < target) { target = d; atEnd = false; }
    }
    if (target < 0.6) {
      t.v = 0;
      t.dwell = atEnd ? TURNAROUND : DWELL;
      t.reverseAfterDwell = atEnd;
      if (!atEnd) t.s += t.dir * 0.6; // nudge past the stop point so it isn't picked again
      return;
    }
    const brake = Math.sqrt(2 * DECEL * Math.max(0, target - 0.3));
    t.v = Math.max(0.4, Math.min(t.v + ACCEL * dt, VMAX, brake));
    t.s += t.dir * Math.min(t.v * dt, target);
  }

  /** Is a closed level crossing within `dist` of this point? */
  closedCrossingNear(x: number, z: number, dist: number): boolean {
    for (const g of this.gates) if (g.closed && Math.hypot(g.c.x - x, g.c.z - z) < dist + g.c.h) return true;
    return false;
  }

  /** Push a circle out of any coach it overlaps. */
  collide(x: number, z: number, r: number): PushResult | null {
    for (const c of this.placed) {
      const ex = x - c.x, ez = z - c.z;
      if (Math.abs(ex) > 14 || Math.abs(ez) > 14) continue;
      const u = ex * c.ux + ez * c.uz; // along the coach
      const v = ex * -c.uz + ez * c.ux; // across
      if (Math.abs(u) < COACH_LEN / 2 + r && Math.abs(v) < HALF_W + r) {
        const s = v >= 0 ? 1 : -1;
        const push = HALF_W + r - Math.abs(v) + 0.01;
        const nx = -c.uz * s, nz = c.ux * s;
        return { x: x + nx * push, z: z + nz * push, hit: true, nx, nz };
      }
    }
    return null;
  }
}
