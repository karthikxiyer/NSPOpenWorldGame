import { CIRCUMFERENCE, loopDelta, wrapX } from '../planet/planet';
import { FOOTPATH_H, FOOTPATH_OUT, PLATFORM, ROAD_HALF, SOUTH_WALL_Z, ZONES } from './layout';

export interface PushResult {
  x: number;
  z: number;
  hit: boolean;
  nx: number;
  nz: number;
}

interface Box {
  cx: number; // wrapped centre x
  hx: number;
  z0: number;
  z1: number;
  /** only blocks vehicles (e.g. the platform: people can step up, bikes can't) */
  vehicleOnly: boolean;
}

interface Circle {
  x: number;
  z: number;
  r: number;
}

const BUCKET = 20;
const NB = Math.ceil(CIRCUMFERENCE / BUCKET);

const station = ZONES.find((z) => z.id === 'station')!;

/** Collision and ground height on the flat strip; x wraps around the loop. */
export class Terrain {
  private boxes: Box[][] = Array.from({ length: NB }, () => []);
  private circles: Circle[][] = Array.from({ length: NB }, () => []);
  /** stretches of the north footpath that are open (lane mouths), as [x0, x1] */
  private footpathGaps: [number, number][] = [];
  readonly minZ = SOUTH_WALL_Z + 0.25;
  readonly maxZ = 62;

  addBox(x0: number, x1: number, z0: number, z1: number, vehicleOnly = false): void {
    const b: Box = { cx: wrapX((x0 + x1) / 2), hx: Math.abs(x1 - x0) / 2, z0: Math.min(z0, z1), z1: Math.max(z0, z1), vehicleOnly };
    const first = Math.floor((b.cx - b.hx) / BUCKET), last = Math.floor((b.cx + b.hx) / BUCKET);
    for (let i = first; i <= last; i++) this.boxes[((i % NB) + NB) % NB].push(b);
  }

  addCircle(x: number, z: number, r: number): void {
    const c = { x: wrapX(x), z, r };
    const first = Math.floor((c.x - r) / BUCKET), last = Math.floor((c.x + r) / BUCKET);
    for (let i = first; i <= last; i++) this.circles[((i % NB) + NB) % NB].push(c);
  }

  addFootpathGap(x0: number, x1: number): void {
    this.footpathGaps.push([wrapX(x0), wrapX(x1)]);
  }

  isWater(_x: number, _z: number): boolean {
    return false;
  }

  private inStation(x: number): boolean {
    return Math.abs(loopDelta(station.x, x)) < station.half - 3;
  }

  inBounds(x: number, z: number, vehicle = false): boolean {
    const min = !vehicle && this.inStation(x) ? PLATFORM.z0 + 0.35 : this.minZ;
    return z > min && z < this.maxZ;
  }

  heightAt(x: number, z: number): number {
    if (z < PLATFORM.z1 && z > PLATFORM.z0 && this.inStation(x)) return PLATFORM.h;
    const az = Math.abs(z);
    if (az > ROAD_HALF && az < FOOTPATH_OUT) {
      if (z > 0) {
        const w = wrapX(x);
        for (const [a, b] of this.footpathGaps) if (w > a && w < b) return 0;
      }
      return FOOTPATH_H;
    }
    return 0;
  }

  collide(x: number, z: number, r: number, vehicle = false): PushResult {
    const res: PushResult = { x, z, hit: false, nx: 0, nz: 0 };
    const bi = Math.floor(wrapX(x) / BUCKET);
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let d = -1; d <= 1; d++) {
        const k = (((bi + d) % NB) + NB) % NB;
        for (const b of this.boxes[k]) {
          if (b.vehicleOnly && !vehicle) continue;
          const dx = loopDelta(b.cx, res.x);
          // closest point of the box to the circle centre
          const px = Math.max(-b.hx, Math.min(b.hx, dx));
          const pz = Math.max(b.z0, Math.min(b.z1, res.z));
          let ex = dx - px, ez = res.z - pz;
          let dist = Math.hypot(ex, ez);
          if (dist >= r) continue;
          if (dist < 1e-5) {
            // centre inside the box: push out through the nearest side
            const opts = [
              { d: b.hx - dx, nx: 1, nz: 0 }, { d: dx + b.hx, nx: -1, nz: 0 },
              { d: b.z1 - res.z, nx: 0, nz: 1 }, { d: res.z - b.z0, nx: 0, nz: -1 },
            ].sort((a2, b2) => a2.d - b2.d)[0];
            ex = opts.nx;
            ez = opts.nz;
            dist = -opts.d;
          } else {
            ex /= dist;
            ez /= dist;
          }
          const push = r - dist + 0.001;
          res.x += ex * push;
          res.z += ez * push;
          res.nx = ex;
          res.nz = ez;
          res.hit = moved = true;
        }
        for (const c of this.circles[k]) {
          const dx = loopDelta(c.x, res.x), dz = res.z - c.z;
          const dist = Math.hypot(dx, dz), min = r + c.r;
          if (dist >= min || dist < 1e-5) continue;
          res.x += (dx / dist) * (min - dist);
          res.z += (dz / dist) * (min - dist);
          res.nx = dx / dist;
          res.nz = dz / dist;
          res.hit = moved = true;
        }
      }
      if (!moved) break;
    }
    return res;
  }
}
