import type { Patch } from './patch';

export interface PushResult {
  x: number;
  z: number;
  hit: boolean;
  nx: number;
  nz: number;
}

interface Footprint {
  p: number[];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** only blocks vehicles (platforms: people step up, bikes can't) */
  vehicleOnly: boolean;
  height: number;
}

const CELL = 20;
const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

function pointInRing(p: number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Collision and ground height on the real map. The map wraps around: every query is folded into
 * the base patch first (nothing solid stands within 9 m of an edge, so folding is exact).
 */
export class Terrain {
  readonly W: number;
  readonly H: number;
  private cells = new Map<number, Footprint[]>();
  private circles = new Map<number, { x: number; z: number; r: number }[]>();
  private alpha: Uint8Array;

  constructor(private patch: Patch, groundImg: HTMLImageElement) {
    const b = patch.bounds;
    this.W = b.maxX - b.minX;
    this.H = b.maxZ - b.minZ;
    for (const bd of patch.buildings) this.addFootprint(bd.p, false, bd.h);
    for (const pl of patch.platforms) this.addFootprint(pl.p, true, 0.92);
    for (const so of patch.solids ?? []) this.addFootprint(so.p, false, so.h);
    // water mask: the builder marks water pixels with alpha 254
    const c = document.createElement('canvas');
    c.width = groundImg.width;
    c.height = groundImg.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(groundImg, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    this.alpha = new Uint8Array(c.width * c.height);
    for (let i = 0; i < this.alpha.length; i++) this.alpha[i] = d[i * 4 + 3];
  }

  /** Fold a point into the base patch. */
  wrap(x: number, z: number): [number, number] {
    const b = this.patch.bounds;
    return [b.minX + (((x - b.minX) % this.W) + this.W) % this.W, b.minZ + (((z - b.minZ) % this.H) + this.H) % this.H];
  }

  private addFootprint(p: number[], vehicleOnly: boolean, height: number) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]);
    }
    const f: Footprint = { p, minX, minZ, maxX, maxZ, vehicleOnly, height };
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(f);
      }
  }

  addCircle(x: number, z: number, r: number): void {
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    let l = this.circles.get(k);
    if (!l) this.circles.set(k, (l = []));
    l.push({ x, z, r });
  }

  isWater(x: number, z: number): boolean {
    const [wx, wz] = this.wrap(x, z);
    const g = this.patch.ground, b = this.patch.bounds;
    const i = Math.floor((wx - b.minX) / g.px), j = Math.floor((wz - b.minZ) / g.px);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return false;
    return this.alpha[j * g.w + i] < 255;
  }

  inBounds(_x: number, _z: number, _vehicle = false): boolean {
    return true; // the map wraps
  }

  heightAt(x: number, z: number): number {
    const [wx, wz] = this.wrap(x, z);
    for (const f of this.cells.get(key(Math.floor(wx / CELL), Math.floor(wz / CELL))) ?? []) {
      if (f.vehicleOnly && wx > f.minX && wx < f.maxX && wz > f.minZ && wz < f.maxZ && pointInRing(f.p, wx, wz)) return f.height;
    }
    return 0;
  }

  collide(x: number, z: number, r: number, vehicle = false): PushResult {
    const [wx, wz] = this.wrap(x, z);
    const res: PushResult = { x: wx, z: wz, hit: false, nx: 0, nz: 0 };
    const cand = new Set<Footprint>();
    const circ: { x: number; z: number; r: number }[] = [];
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const k = key(Math.floor((wx + dx) / CELL), Math.floor((wz + dz) / CELL));
      for (const f of this.cells.get(k) ?? []) cand.add(f);
      for (const c of this.circles.get(k) ?? []) if (!circ.includes(c)) circ.push(c);
    }
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const f of cand) {
        if (f.vehicleOnly && !vehicle) continue;
        if (res.x + r < f.minX || res.x - r > f.maxX || res.z + r < f.minZ || res.z - r > f.maxZ) continue;
        const p = f.p;
        let best = Infinity, bx = 0, bz = 0;
        for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
          const ax = p[j], az = p[j + 1], ex = p[i] - ax, ez = p[i + 1] - az;
          const l2 = ex * ex + ez * ez || 1;
          const t = Math.max(0, Math.min(1, ((res.x - ax) * ex + (res.z - az) * ez) / l2));
          const cx = ax + ex * t, cz = az + ez * t, d2 = (res.x - cx) ** 2 + (res.z - cz) ** 2;
          if (d2 < best) { best = d2; bx = cx; bz = cz; }
        }
        const inside = pointInRing(p, res.x, res.z);
        const d = Math.sqrt(best);
        if (!inside && d >= r) continue;
        let nx = res.x - bx, nz = res.z - bz;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;
        if (inside) { nx = -nx; nz = -nz; }
        const push = inside ? d + r : r - d;
        res.x += nx * (push + 0.001);
        res.z += nz * (push + 0.001);
        res.hit = moved = true;
        res.nx = nx; res.nz = nz;
      }
      for (const c of circ) {
        const ex = res.x - c.x, ez = res.z - c.z, d = Math.hypot(ex, ez), min = r + c.r;
        if (d >= min || d < 1e-5) continue;
        res.x += (ex / d) * (min - d);
        res.z += (ez / d) * (min - d);
        res.nx = ex / d; res.nz = ez / d;
        res.hit = moved = true;
      }
      if (!moved) break;
    }
    // back to the caller's (unfolded) coordinates
    res.x += x - wx;
    res.z += z - wz;
    return res;
  }
}
