// Building footprints (per tile, in a coarse grid) and the land/water mask from ground.png.

const CELL = 25;

export interface Footprint {
  /** flat [x, z, ...] ring without closing point */
  p: number[];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export class FootprintGrid {
  private cells = new Map<number, Footprint[]>();

  constructor(rings: number[][]) {
    for (const p of rings) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
        minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]);
      }
      const fp: Footprint = { p, minX, minZ, maxX, maxZ };
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const k = key(cx, cz);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(fp);
        }
      }
    }
  }

  query(x: number, z: number, out: Set<Footprint>): void {
    const list = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list) for (const f of list) out.add(f);
  }
}

const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

function pointInRing(p: number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface PushResult {
  x: number;
  z: number;
  hit: boolean;
  /** collision normal (unit) pointing away from the obstacle */
  nx: number;
  nz: number;
}

/** Resolve a circle against building footprints. */
export function resolveCircle(grids: Iterable<FootprintGrid>, x: number, z: number, r: number): PushResult {
  const res: PushResult = { x, z, hit: false, nx: 0, nz: 0 };
  const cand = new Set<Footprint>();
  for (const g of grids) {
    g.query(x - r, z - r, cand);
    g.query(x + r, z - r, cand);
    g.query(x - r, z + r, cand);
    g.query(x + r, z + r, cand);
  }
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const f of cand) {
      if (res.x + r < f.minX || res.x - r > f.maxX || res.z + r < f.minZ || res.z - r > f.maxZ) continue;
      const p = f.p;
      // closest point on the ring
      let best = Infinity, bx = 0, bz = 0;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const ax = p[j], az = p[j + 1], ex = p[i] - ax, ez = p[i + 1] - az;
        const len2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((res.x - ax) * ex + (res.z - az) * ez) / len2));
        const cx = ax + ex * t, cz = az + ez * t;
        const d2 = (res.x - cx) ** 2 + (res.z - cz) ** 2;
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
      res.hit = true;
      res.nx = nx; res.nz = nz;
      moved = true;
    }
    if (!moved) break;
  }
  return res;
}

/** Land/water mask sampled from the alpha channel of ground.png. */
export class WaterMask {
  constructor(
    private alpha: Uint8Array,
    private w: number,
    private h: number,
    private minX: number,
    private minZ: number,
    private px: number,
  ) {}

  static fromImage(img: HTMLImageElement | ImageBitmap, minX: number, minZ: number, px: number): WaterMask {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const a = new Uint8Array(img.width * img.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return new WaterMask(a, img.width, img.height, minX, minZ, px);
  }

  isWater(x: number, z: number): boolean {
    const i = Math.floor((x - this.minX) / this.px);
    const j = Math.floor((z - this.minZ) / this.px);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    return this.alpha[j * this.w + i] < 128;
  }
}
