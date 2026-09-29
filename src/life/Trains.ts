import * as THREE from 'three';
import { COACH_LEN, emuCab, emuCoach } from '../art/lifeModels';
import type { Patch } from '../world/patch';
import type { PushResult } from '../world/Terrain';
import { InstanceWriter, instanced } from './instancing';
import type { Wrap } from './RoadGraph';

const VMAX = 20; // ~72 km/h through the patch
const ACCEL = 0.9;
const DECEL = 1.0;
const DWELL = 20;
const HALF_W = 1.83;
const COACHES = 12;
const TRAIN_LEN = COACHES * COACH_LEN;

interface Route {
  xs: Float64Array;
  zs: Float64Array;
  cum: Float64Array;
  len: number;
  /** where the train's front stops for the platform, or null for a through line */
  stop: number | null;
  dir: 1 | -1;
}

interface Train {
  route: Route;
  /** distance of the front along the route (may be beyond either end while entering or leaving) */
  s: number;
  v: number;
  dwell: number;
  stopped: boolean;
  /** seconds until the next train on this line */
  gap: number;
  running: boolean;
}

/**
 * Western Railway locals on the four main lines. The tracks cross the patch diagonally, so a
 * train can't wrap: each one runs in from one edge, stops at Nalla Sopara, runs out the other
 * edge, and the next one follows a little later.
 */
export class Trains {
  private trains: Train[] = [];
  private coach: InstanceWriter;
  private motor: InstanceWriter;
  private cab: InstanceWriter;
  /** coach centres and directions this frame, for collision */
  private placed: { x: number; z: number; ux: number; uz: number }[] = [];

  constructor(scene: THREE.Scene, patch: Patch, shadows: boolean, private wrap: Wrap, private rand: () => number) {
    const st = patch.stations[0];
    const lines = patch.rail.filter((r) => r.m).map((r) => {
      let p = r.p;
      // run every line north to south, so s grows toward Mumbai
      if (p[1] > p[p.length - 1]) {
        const q: number[] = [];
        for (let i = p.length - 2; i >= 0; i -= 2) q.push(p[i], p[i + 1]);
        p = q;
      }
      return p;
    });
    // the station sits on all four lines; sort them west to east there
    const xAt = (p: number[]) => {
      let bx = 0, bd = Infinity;
      for (let i = 0; i < p.length; i += 2) { const d = Math.abs(p[i + 1] - (st?.z ?? 0)); if (d < bd) { bd = d; bx = p[i]; } }
      return bx;
    };
    lines.sort((a, b) => xAt(a) - xAt(b));
    lines.forEach((p, i) => {
      const n = p.length / 2;
      const xs = new Float64Array(n), zs = new Float64Array(n), cum = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        xs[k] = p[k * 2];
        zs[k] = p[k * 2 + 1];
        if (k) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
      }
      // pairs of lines run each way: down (to Virar, north) on the west pair, up (to Churchgate) on the east
      const dir: 1 | -1 = i < lines.length / 2 ? -1 : 1;
      const route: Route = { xs, zs, cum, len: cum[n - 1], stop: null, dir };
      if (st) {
        let bs = 0, bd = Infinity;
        for (let k = 0; k < n; k++) { const d = Math.hypot(xs[k] - st.x, zs[k] - st.z); if (d < bd) { bd = d; bs = cum[k]; } }
        // the middle of the train stops at the station
        if (bd < 80) route.stop = bs + dir * TRAIN_LEN / 2;
      }
      // one line starts with a train standing at the platform; the rest come in at intervals
      const t: Train = { route, s: 0, v: 0, dwell: 0, stopped: false, gap: 0, running: false };
      if (i === 0 && route.stop !== null) { this.enter(t); t.s = route.stop; t.v = 0; t.dwell = DWELL; t.stopped = true; }
      else t.gap = 5 + i * 25 + this.rand() * 20;
      this.trains.push(t);
    });
    const n = this.trains.length * COACHES;
    this.coach = new InstanceWriter(instanced(emuCoach(false), n, shadows));
    this.motor = new InstanceWriter(instanced(emuCoach(true), n, shadows));
    this.cab = new InstanceWriter(instanced(emuCab(), this.trains.length * 2, shadows));
    scene.add(this.coach.mesh, this.motor.mesh, this.cab.mesh);
  }

  private enter(t: Train) {
    t.running = true;
    t.stopped = false;
    t.dwell = 0;
    t.v = VMAX * 0.8;
    // the front starts just outside the edge it comes in from
    t.s = t.route.dir === 1 ? -10 : t.route.len + 10;
  }

  /** a point along a route; beyond the ends the line carries straight on */
  private at(r: Route, s: number, out: { x: number; z: number }) {
    const n = r.cum.length;
    let lo = 0, hi = 1;
    if (s <= 0) { lo = 0; hi = 1; }
    else if (s >= r.len) { lo = n - 2; hi = n - 1; }
    else {
      lo = 0; hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (r.cum[mid] <= s) lo = mid;
        else hi = mid;
      }
    }
    const seg = r.cum[hi] - r.cum[lo] || 1;
    const t = (s - r.cum[lo]) / seg;
    out.x = r.xs[lo] + (r.xs[hi] - r.xs[lo]) * t;
    out.z = r.zs[lo] + (r.zs[hi] - r.zs[lo]) * t;
  }

  update(dt: number): void {
    for (const t of this.trains) this.step(t, dt);
    const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
    this.placed.length = 0;
    for (const t of this.trains) {
      if (!t.running) continue;
      const d = t.route.dir;
      for (let i = 0; i < COACHES; i++) {
        const sc = t.s - d * (i * COACH_LEN + COACH_LEN / 2);
        this.at(t.route, sc + d * 7.2, a);
        this.at(t.route, sc - d * 7.2, b);
        const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1;
        this.placed.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, ux: dx / l, uz: dz / l });
      }
    }
  }

  private step(t: Train, dt: number) {
    const r = t.route;
    if (!t.running) {
      t.gap -= dt;
      if (t.gap <= 0) this.enter(t);
      return;
    }
    if (t.dwell > 0) {
      t.dwell -= dt;
      return;
    }
    // gone out the far edge (rear and all): the next train follows after a while
    const rear = t.s - r.dir * TRAIN_LEN;
    if ((r.dir === 1 && rear > r.len + 20) || (r.dir === -1 && rear < -20)) {
      t.running = false;
      t.gap = 40 + this.rand() * 60;
      return;
    }
    let limit = VMAX;
    if (r.stop !== null && !t.stopped) {
      const togo = (r.stop - t.s) * r.dir;
      if (togo <= 0.3) {
        t.stopped = true;
        t.v = 0;
        t.dwell = DWELL;
        return;
      }
      limit = Math.min(limit, Math.sqrt(2 * DECEL * Math.max(0, togo - 0.2)) + 0.3);
    }
    t.v = Math.min(t.v + ACCEL * dt, limit);
    t.s += r.dir * t.v * dt;
  }

  /** Draw every coach that is inside the patch, at the copy nearest the camera's focus. */
  render(fx: number, fz: number, bounds: Patch['bounds']): void {
    const w = this.wrap;
    this.coach.begin();
    this.motor.begin();
    this.cab.begin();
    let k = 0;
    for (const t of this.trains) {
      if (!t.running) continue;
      for (let i = 0; i < COACHES; i++) {
        const c = this.placed[k++];
        if (c.x < bounds.minX || c.x > bounds.maxX || c.z < bounds.minZ || c.z > bounds.maxZ) continue;
        const x = w.near(c.x, fx, w.W), z = w.near(c.z, fz, w.H);
        const yaw = Math.atan2(-c.ux, -c.uz);
        (i % 4 === 1 ? this.motor : this.coach).add(x, 0.2, z, yaw);
        if (i === 0) this.cab.add(x, 0.2, z, yaw);
        if (i === COACHES - 1) this.cab.add(x, 0.2, z, yaw + Math.PI);
      }
    }
    this.coach.end();
    this.motor.end();
    this.cab.end();
  }

  /** Is a train standing at the platform? (for the HUD) */
  get atPlatform(): boolean {
    return this.trains.some((t) => t.running && t.dwell > 0);
  }

  /** Push a circle out of any coach it overlaps. */
  collide(x: number, z: number, r: number): PushResult | null {
    const w = this.wrap;
    for (const c of this.placed) {
      const ex = w.dx(c.x, x), ez = w.dz(c.z, z);
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
