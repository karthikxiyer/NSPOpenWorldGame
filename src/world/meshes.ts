import * as THREE from 'three';
import type { Building, Rail, Road } from './types';

// ---------- small geometry builder ----------
class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] = [];

  tri(a: number[], b: number[], c: number[], n: number[], color: number[], uva = [0, 0], uvb = [0, 0], uvc = [0, 0]) {
    // flip winding if it disagrees with the intended normal
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      [b, c] = [c, b];
      [uvb, uvc] = [uvc, uvb];
    }
    this.pos.push(...a, ...b, ...c);
    this.nrm.push(...n, ...n, ...n);
    this.col.push(...color, ...color, ...color);
    this.uv.push(...uva, ...uvb, ...uvc);
  }

  quad(a: number[], b: number[], c: number[], d: number[], n: number[], color: number[], uvs?: number[][]) {
    const u = uvs ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.tri(a, b, c, n, color, u[0], u[1], u[2]);
    this.tri(a, c, d, n, color, u[0], u[2], u[3]);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

const UP = [0, 1, 0];
const srgb = (r: number, g: number, b: number) => {
  const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
};

// ---------- buildings ----------
const PASTEL = [
  [236, 228, 208], [240, 220, 180], [214, 226, 232], [236, 210, 206], [222, 232, 214],
  [246, 238, 222], [230, 200, 160], [210, 214, 222], [242, 226, 196], [200, 220, 214],
  [232, 186, 150], [250, 250, 244],
].map(([r, g, b]) => srgb(r, g, b));
const WORSHIP = srgb(250, 244, 230);
const ROOF_SHADE = 0.82;

const FLOOR_H = 3.2;
const BAY_W = 3.0;

export function buildBuildings(list: Building[]): THREE.BufferGeometry | null {
  const gb = new GeoBuilder();
  for (const b of list) {
    const p = b.p;
    const n = p.length / 2;
    if (n < 3) continue;
    const base = b.k === 'worship' ? WORSHIP : PASTEL[b.c % PASTEL.length];
    const h = b.h;
    // signed area (x right, z down) decides which side is outward
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
    const sign = area > 0 ? 1 : -1;
    let u0 = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // outward normal, see scripts: for positive area it is (dz, -dx)
      const nx = (sign * dz) / len, nz = (sign * -dx) / len;
      // subtle directional shading baked into vertex colour keeps it readable without shadows
      const shade = 0.9 + 0.1 * (nx * 0.6 - nz * 0.8);
      const c = [base[0] * shade, base[1] * shade, base[2] * shade];
      const u1 = u0 + len / BAY_W;
      const v1 = h / FLOOR_H;
      gb.quad([ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az], [nx, 0, nz], c, [[u0, 0], [u1, 0], [u1, v1], [u0, v1]]);
      u0 = u1;
    }
    // roof
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const rc = [base[0] * ROOF_SHADE, base[1] * ROOF_SHADE, base[2] * ROOF_SHADE];
    // roof samples the plain corner of the window texture
    const ruv = [0.02, 0.02];
    for (const [a, bIdx, cIdx] of tris) {
      gb.tri([p[a * 2], h, p[a * 2 + 1]], [p[bIdx * 2], h, p[bIdx * 2 + 1]], [p[cIdx * 2], h, p[cIdx * 2 + 1]], UP, rc, ruv, ruv, ruv);
    }
  }
  return gb.build();
}

let windowTex: THREE.Texture | null = null;
export function windowTexture(): THREE.Texture {
  if (windowTex) return windowTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  // floor slab line
  g.fillStyle = '#d8d2c6';
  g.fillRect(0, s - 5, s, 5);
  // window with sill
  g.fillStyle = '#4d5a66';
  g.fillRect(16, 12, 32, 28);
  g.fillStyle = '#6d7c88';
  g.fillRect(18, 14, 13, 24);
  g.fillStyle = '#e9e4da';
  g.fillRect(14, 40, 36, 3);
  windowTex = new THREE.CanvasTexture(c);
  windowTex.wrapS = windowTex.wrapT = THREE.RepeatWrapping;
  windowTex.colorSpace = THREE.SRGBColorSpace;
  windowTex.anisotropy = 4;
  // the texture is repeated per bay/floor; v=0 is the ground, flipY keeps the slab line at the bottom
  return windowTex;
}

// ---------- roads ----------
const ROAD_COLOR: Record<number, number[]> = {
  1: srgb(64, 64, 68),
  2: srgb(70, 70, 74),
  3: srgb(78, 78, 82),
  4: srgb(86, 86, 88),
  5: srgb(96, 95, 94),
  6: srgb(108, 106, 102),
  7: srgb(150, 128, 98),
  8: srgb(160, 150, 138),
  9: srgb(170, 156, 128),
};
const MARK = srgb(236, 236, 228);
const EDGE = srgb(210, 200, 170);

/** Offset a polyline to both sides (mitred, clamped). Returns [left..., right...] as [x,z] pairs. */
function offsetLine(p: number[], hw: number): { l: number[][]; r: number[][] } {
  const n = p.length / 2;
  const l: number[][] = [];
  const r: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], z = p[i * 2 + 1];
    let nx = 0, nz = 0;
    if (i > 0) {
      const dx = x - p[i * 2 - 2], dz = z - p[i * 2 - 1];
      const len = Math.hypot(dx, dz) || 1;
      nx += -dz / len; nz += dx / len;
    }
    if (i < n - 1) {
      const dx = p[i * 2 + 2] - x, dz = p[i * 2 + 3] - z;
      const len = Math.hypot(dx, dz) || 1;
      nx += -dz / len; nz += dx / len;
    }
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    // miter scale
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const dx = p[i * 2 + 2] - x, dz = p[i * 2 + 3] - z;
      const len = Math.hypot(dx, dz) || 1;
      const cos = Math.abs(nx * (-dz / len) + nz * (dx / len));
      scale = Math.min(2, 1 / Math.max(cos, 0.3));
    }
    l.push([x + nx * hw * scale, z + nz * hw * scale]);
    r.push([x - nx * hw * scale, z - nz * hw * scale]);
  }
  return { l, r };
}

function extendEnds(p: number[], by: number): number[] {
  const q = p.slice();
  const n = q.length / 2;
  if (n < 2) return q;
  let dx = q[0] - q[2], dz = q[1] - q[3];
  let len = Math.hypot(dx, dz) || 1;
  q[0] += (dx / len) * by; q[1] += (dz / len) * by;
  dx = q[n * 2 - 2] - q[n * 2 - 4]; dz = q[n * 2 - 1] - q[n * 2 - 3];
  len = Math.hypot(dx, dz) || 1;
  q[n * 2 - 2] += (dx / len) * by; q[n * 2 - 1] += (dz / len) * by;
  return q;
}

function ribbon(gb: GeoBuilder, p: number[], hw: number, y: number, color: number[]) {
  const { l, r } = offsetLine(p, hw);
  for (let i = 0; i < l.length - 1; i++) {
    gb.quad([l[i][0], y, l[i][1]], [r[i][0], y, r[i][1]], [r[i + 1][0], y, r[i + 1][1]], [l[i + 1][0], y, l[i + 1][1]], UP, color);
  }
}

function dashes(gb: GeoBuilder, p: number[], y: number, dash: number, gap: number, hw: number, color: number[], offset = 0) {
  let carry = 0;
  for (let i = 0; i < p.length / 2 - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const ox = nx * offset, oz = nz * offset;
    let t = carry;
    while (t < len) {
      const t1 = Math.min(len, t + dash);
      const sx = ax + ux * t + ox, sz = az + uz * t + oz, ex = ax + ux * t1 + ox, ez = az + uz * t1 + oz;
      gb.quad([sx + nx * hw, y, sz + nz * hw], [sx - nx * hw, y, sz - nz * hw], [ex - nx * hw, y, ez - nz * hw], [ex + nx * hw, y, ez + nz * hw], UP, color);
      t += dash + gap;
    }
    carry = t - len;
  }
}

export function buildRoads(list: Road[]): THREE.BufferGeometry | null {
  const gb = new GeoBuilder();
  // draw minor roads first; higher classes sit slightly above to win at junctions
  const sorted = list.slice().sort((a, b) => b.c - a.c);
  for (const r of sorted) {
    const y = 0.04 + (10 - r.c) * 0.012;
    const hw = r.w / 2;
    const p = extendEnds(r.p, Math.min(hw, 3));
    if (r.c <= 4) ribbon(gb, p, hw + 0.6, y - 0.006, EDGE); // kerb/shoulder
    ribbon(gb, p, hw, y, ROAD_COLOR[r.c] ?? ROAD_COLOR[5]);
    if (r.c <= 3) {
      if (r.o) dashes(gb, r.p, y + 0.004, 3, 6, 0.08, MARK);
      else if (r.w >= 10) {
        // divided look: solid double centre line
        ribbon(gb, r.p, 0.1, y + 0.004, srgb(230, 190, 40));
        dashes(gb, r.p, y + 0.004, 3, 6, 0.07, MARK, r.w / 4);
        dashes(gb, r.p, y + 0.004, 3, 6, 0.07, MARK, -r.w / 4);
      } else dashes(gb, r.p, y + 0.004, 3, 6, 0.08, MARK);
    } else if (r.c === 4) dashes(gb, r.p, y + 0.004, 2, 7, 0.07, MARK);
  }
  return gb.build();
}

// ---------- rail ----------
const BALLAST = srgb(120, 108, 96);
const RAIL = srgb(150, 150, 155);
const SLEEPER = srgb(92, 80, 70);

export function buildRail(list: Rail[]): THREE.BufferGeometry | null {
  const gb = new GeoBuilder();
  for (const r of list) {
    ribbon(gb, r.p, 1.7, 0.12, BALLAST);
    dashes(gb, r.p, 0.14, 0.25, 0.45, 1.25, SLEEPER);
    for (const off of [-0.72, 0.72]) {
      const { l } = offsetLine(r.p, off);
      const q = l.flat();
      ribbon(gb, q, 0.05, 0.2, RAIL);
    }
  }
  return gb.build();
}
