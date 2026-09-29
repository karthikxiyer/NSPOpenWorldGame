import * as THREE from 'three';
import { PAL } from '../core/palette';
import { rngKit, type Rng } from '../core/rng';
import { cel } from '../core/toon';
import { curveTree } from './curve';
import { Batch, template } from './geo';
import type { Patch, PBuilding, PRoad } from './patch';
import { buildPlaces, createSignAtlas } from './places';
import type { Terrain } from './Terrain';

const CHUNK = 200;
const M4 = new THREE.Matrix4();
const UP = [0, 1, 0];

/** A chunk of meshes that is re-positioned to its nearest wrapped copy every frame. */
interface Chunk {
  cx: number;
  cz: number;
  group: THREE.Group;
}

export class WorldView {
  readonly root = new THREE.Group();
  private chunks: Chunk[] = [];

  constructor(private W: number, private H: number) {
    this.root.name = 'world';
  }

  add(group: THREE.Group, cx: number, cz: number): void {
    curveTree(group);
    this.root.add(group);
    this.chunks.push({ cx, cz, group });
  }

  /** Shift every chunk to the copy nearest the focus; hide what is beyond `range`. */
  update(fx: number, fz: number, range: number): void {
    for (const c of this.chunks) {
      const ox = Math.round((fx - c.cx) / this.W) * this.W;
      const oz = Math.round((fz - c.cz) / this.H) * this.H;
      c.group.position.set(ox, 0, oz);
      const d = Math.hypot(c.cx + ox - fx, c.cz + oz - fz);
      c.group.visible = d < range + CHUNK * 0.75;
    }
  }
}

// ---------------------------------------------------------------------------------------------

function windowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#d9d0c4';
  g.fillRect(0, s - 5, s, 5);
  g.fillStyle = '#4a5670';
  g.fillRect(17, 13, 30, 27);
  g.fillStyle = '#6a7896';
  g.fillRect(19, 15, 12, 23);
  g.fillStyle = '#5a5560';
  for (let x = 21; x < 47; x += 6) g.fillRect(x, 13, 1.5, 27);
  g.fillStyle = '#ebe3d6';
  g.fillRect(14, 10, 36, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function boardTexture(lines: { text: string; size: number }[], bg: string, fg: string, w = 512, h = 160, border = true): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = fg;
    g.lineWidth = 7;
    g.strokeRect(10, 10, w - 20, h - 20);
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((s, l) => s + l.size * 1.15, 0);
  let y = h / 2 - total / 2;
  for (const l of lines) {
    let size = l.size;
    do {
      g.font = `bold ${size}px system-ui, 'Noto Sans Devanagari', sans-serif`;
      size -= 2;
    } while (g.measureText(l.text).width > w - 50 && size > 12);
    y += l.size * 0.575;
    g.fillText(l.text, w / 2, y + 2);
    y += l.size * 0.575;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function postBoard(tex: THREE.Texture, w: number, h: number, postH: number): THREE.Group {
  const g = new THREE.Group();
  const face = cel({ map: tex, bands: 'soft3' });
  const back = cel({ color: 0x8a8f96 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), [back, back, back, back, face, back]);
  board.position.y = postH + h / 2;
  g.add(board);
  const post = cel({ color: 0x5b6068 });
  for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, postH + h, 8), post);
    p.position.set(x, (postH + h) / 2, -0.06);
    g.add(p);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------------------------------------
// polyline ribbons

function offsetLine(p: number[], hw: number): { l: number[][]; r: number[][] } {
  const n = p.length / 2, l: number[][] = [], r: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], z = p[i * 2 + 1];
    let nx = 0, nz = 0;
    if (i > 0) { const dx = x - p[i * 2 - 2], dz = z - p[i * 2 - 1], len = Math.hypot(dx, dz) || 1; nx += -dz / len; nz += dx / len; }
    if (i < n - 1) { const dx = p[i * 2 + 2] - x, dz = p[i * 2 + 3] - z, len = Math.hypot(dx, dz) || 1; nx += -dz / len; nz += dx / len; }
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const dx = p[i * 2 + 2] - x, dz = p[i * 2 + 3] - z, len = Math.hypot(dx, dz) || 1;
      scale = Math.min(2, 1 / Math.max(Math.abs(nx * (-dz / len) + nz * (dx / len)), 0.3));
    }
    l.push([x + nx * hw * scale, z + nz * hw * scale]);
    r.push([x - nx * hw * scale, z - nz * hw * scale]);
  }
  return { l, r };
}

function extendEnds(p: number[], by: number): number[] {
  const q = p.slice(), n = q.length / 2;
  if (n < 2) return q;
  let dx = q[0] - q[2], dz = q[1] - q[3], len = Math.hypot(dx, dz) || 1;
  q[0] += (dx / len) * by; q[1] += (dz / len) * by;
  dx = q[n * 2 - 2] - q[n * 2 - 4]; dz = q[n * 2 - 1] - q[n * 2 - 3]; len = Math.hypot(dx, dz) || 1;
  q[n * 2 - 2] += (dx / len) * by; q[n * 2 - 1] += (dz / len) * by;
  return q;
}

function ribbon(b: Batch, p: number[], hw: number, y: number, color: number) {
  const { l, r } = offsetLine(p, hw);
  for (let i = 0; i < l.length - 1; i++) b.quad([l[i][0], y, l[i][1]], [r[i][0], y, r[i][1]], [r[i + 1][0], y, r[i + 1][1]], [l[i + 1][0], y, l[i + 1][1]], UP, color);
}

function dashes(b: Batch, p: number[], y: number, dash: number, gap: number, hw: number, color: number, offset = 0) {
  let carry = 0;
  for (let i = 0; i < p.length / 2 - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux, ox = nx * offset, oz = nz * offset;
    let t = carry;
    while (t < len) {
      const t1 = Math.min(len, t + dash);
      const sx = ax + ux * t + ox, sz = az + uz * t + oz, ex = ax + ux * t1 + ox, ez = az + uz * t1 + oz;
      b.quad([sx + nx * hw, y, sz + nz * hw], [sx - nx * hw, y, sz - nz * hw], [ex - nx * hw, y, ez - nz * hw], [ex + nx * hw, y, ez + nz * hw], UP, color);
      t += dash + gap;
    }
    carry = t - len;
  }
}

const ROAD_COLOR: Record<number, number> = { 1: 0x716c7c, 2: 0x76717f, 3: 0x7c7785, 4: 0x827d8c, 5: 0x8c8794, 6: 0x96909a, 7: 0xb49a78, 8: 0xbdb2a4, 9: 0xc4b596 };

function road(b: Batch, r: PRoad) {
  if (r.b && r.c >= 8) return; // footbridges are drawn up in the air (places.ts)
  const y = 0.05 + (10 - r.c) * 0.008;
  const hw = r.w / 2;
  const p = extendEnds(r.p, Math.min(hw, 3));
  if (r.c <= 4) ribbon(b, p, hw + 0.45, y - 0.004, PAL.footpath); // shoulder
  ribbon(b, p, hw, y, ROAD_COLOR[r.c] ?? ROAD_COLOR[5]);
  if (r.c <= 3) {
    if (r.w >= 10 && !r.o) {
      ribbon(b, r.p, 0.1, y + 0.004, PAL.lineYellow);
      dashes(b, r.p, y + 0.004, 3, 6, 0.07, PAL.lineWhite, r.w / 4);
      dashes(b, r.p, y + 0.004, 3, 6, 0.07, PAL.lineWhite, -r.w / 4);
    } else dashes(b, r.p, y + 0.004, 3, 5, 0.08, PAL.lineWhite);
    // painted black-and-yellow kerb lines along the bigger roads
    dashes(b, r.p, y + 0.003, 1, 1, 0.12, PAL.kerbYellow, hw - 0.12);
    dashes(b, r.p, y + 0.003, 1, 1, 0.12, PAL.kerbYellow, -hw + 0.12);
  } else if (r.c === 4) dashes(b, r.p, y + 0.004, 2, 6, 0.07, PAL.lineWhite);
}

// ---------------------------------------------------------------------------------------------
// buildings

function building(walls: Batch, solid: Batch, rng: Rng, bd: PBuilding) {
  const p = bd.p, n = p.length / 2;
  if (n < 3) return;
  const base = new THREE.Color(bd.k === 'worship' ? 0xfaf4e6 : PAL.walls[bd.c % PAL.walls.length]).getHex();
  const h = bd.h, ph = 0.85;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  const sign = area > 0 ? 1 : -1;
  let u0 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = (sign * dz) / len, nz = (sign * -dx) / len;
    const u1 = u0 + len / 3;
    walls.quad([ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az], [nx, 0, nz], base, [[u0, 0], [u1, 0], [u1, h / 3.1], [u0, h / 3.1]]);
    const c = [[0.02, 0.02], [0.02, 0.02], [0.02, 0.02], [0.02, 0.02]];
    walls.quad([ax, h, az], [bx, h, bz], [bx, h + ph, bz], [ax, h + ph, az], [nx, 0, nz], PAL.parapet, c);
    u0 = u1;
  }
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
  const ruv = [0.02, 0.02];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    walls.tri([p[a * 2], h, p[a * 2 + 1]], [p[b * 2], h, p[b * 2 + 1]], [p[c * 2], h, p[c * 2 + 1]], UP, PAL.roofSlab, ruv, ruv, ruv);
  }
  // black Sintex tanks on bigger roofs
  const absArea = Math.abs(area) / 2;
  if (absArea > 90 && h > 5) {
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; }
    cx /= n; cz /= n;
    const k = absArea > 300 ? 3 : absArea > 160 ? 2 : 1;
    for (let i = 0; i < k; i++) {
      const tx = cx + rng.range(-1.8, 1.8), tz = cz + rng.range(-1.8, 1.8);
      solid.stamp(TPL.tankBody, M4.makeTranslation(tx, h + 0.65, tz), PAL.sintex);
      solid.stamp(TPL.tankTop, M4.makeTranslation(tx, h + 1.41, tz), PAL.sintex);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// railway platforms: concrete sides, grey top with a yellow edge band, a roof on columns
//
// The curve bends vertices, not faces: a platform drawn as a few 200 m triangles would sag below
// the ground in the middle. Long faces are split until no edge is longer than FINE metres.

const FINE = 8;

function fineTri(b: Batch, a: number[], c: number[], d: number[], n: number[], color: number) {
  const l0 = Math.hypot(c[0] - a[0], c[2] - a[2]), l1 = Math.hypot(d[0] - c[0], d[2] - c[2]), l2 = Math.hypot(a[0] - d[0], a[2] - d[2]);
  const m = Math.max(l0, l1, l2);
  if (m <= FINE) { b.tri(a, c, d, n, color); return; }
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  if (m === l0) { const e = mid(a, c); fineTri(b, a, e, d, n, color); fineTri(b, e, c, d, n, color); }
  else if (m === l1) { const e = mid(c, d); fineTri(b, a, c, e, n, color); fineTri(b, a, e, d, n, color); }
  else { const e = mid(d, a); fineTri(b, a, c, e, n, color); fineTri(b, e, c, d, n, color); }
}

function fineQuad(b: Batch, a: number[], c: number[], d: number[], e: number[], n: number[], color: number) {
  fineTri(b, a, c, d, n, color);
  fineTri(b, a, d, e, n, color);
}

function platform(b: Batch, p: number[]): { c: number[]; a: number[]; len: number } {
  const n = p.length / 2, h = 0.92;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = (sign * dz) / len, nz = (sign * -dx) / len;
    fineQuad(b, [ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az], [nx, 0, nz], PAL.concrete);
    fineQuad(b, [ax, h, az], [bx, h, bz], [bx - nx * 0.45, h + 0.005, bz - nz * 0.45], [ax - nx * 0.45, h + 0.005, az - nz * 0.45], UP, PAL.platformEdge);
  }
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, c, d] of tris) fineTri(b, [p[a * 2], h, p[a * 2 + 1]], [p[c * 2], h, p[c * 2 + 1]], [p[d * 2], h, p[d * 2 + 1]], UP, PAL.platform);
  // principal axis of the platform
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; }
  cx /= n; cz /= n;
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < n; i++) { const dx = p[i * 2] - cx, dz = p[i * 2 + 1] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ax = [Math.cos(ang), Math.sin(ang)];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const t = (p[i * 2] - cx) * ax[0] + (p[i * 2 + 1] - cz) * ax[1]; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const len = hi - lo, mid = (lo + hi) / 2;
  const c = [cx + ax[0] * mid, cz + ax[1] * mid];
  // roof over the middle two thirds, on a row of columns
  const roofLen = len * 0.66, roofW = 5;
  const nx = -ax[1], nz = ax[0];
  for (let t = -roofLen / 2; t <= roofLen / 2; t += 9) {
    const x = c[0] + ax[0] * t, z = c[1] + ax[1] * t;
    b.box(x - 0.12, x + 0.12, h, h + 3.3, z - 0.12, z + 0.12, 0x3f7e86);
  }
  const corner = (u: number, v: number) => [c[0] + ax[0] * u + nx * v, h + 3.3, c[1] + ax[1] * u + nz * v];
  const q = [corner(-roofLen / 2, -roofW / 2), corner(roofLen / 2, -roofW / 2), corner(roofLen / 2, roofW / 2), corner(-roofLen / 2, roofW / 2)];
  fineQuad(b, q[0], q[1], q[2], q[3], UP, 0x9aa2a8);
  fineQuad(b, q[0], q[3], q[2], q[1], [0, -1, 0], 0xd7d2c8);
  return { c, a: ax, len };
}

// ---------------------------------------------------------------------------------------------
// trees

const TPL = {
  trunk: template(new THREE.CylinderGeometry(0.2, 0.3, 1, 6)),
  palmSeg: template(new THREE.CylinderGeometry(0.17, 0.2, 1, 6)),
  frond: template(new THREE.BoxGeometry(1, 1, 1)),
  crown: template(new THREE.IcosahedronGeometry(1, 0)),
  tankBody: template(new THREE.CylinderGeometry(0.62, 0.66, 1.3, 8)),
  tankTop: template(new THREE.CylinderGeometry(0.2, 0.62, 0.22, 8)),
};

function tree(b: Batch, rng: Rng, x: number, z: number, kind: number) {
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const mat = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    M4.compose(v.set(px, py, pz), q.setFromEuler(e.set(rx, ry, rz)), sc.set(sx, sy, sz));
  if (kind === 2) {
    let px = x, py = 0;
    const lean = rng.range(-0.25, 0.25), segH = 2.2;
    for (let i = 0; i < 5; i++) {
      const tilt = lean * (i + 1) * 0.35;
      b.stamp(TPL.palmSeg, mat(px, py + segH / 2, z, 0, 0, tilt, 1, segH, 1), PAL.trunk);
      px -= Math.sin(tilt) * segH;
      py += Math.cos(tilt) * segH;
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.stamp(TPL.frond, mat(px + Math.cos(a) * 1.5, py - 0.3, z + Math.sin(a) * 1.5, 0, -a, -0.45, 3.4, 0.05, 0.55), PAL.palm);
    }
    return;
  }
  const gul = kind === 0;
  const trunkH = gul ? 3.2 : 3.6;
  b.stamp(TPL.trunk, mat(x, trunkH / 2, z, 0, 0, 0, 1, trunkH, 1), PAL.trunk);
  const colors = gul ? [PAL.gulmohar, PAL.gulmoharLight, PAL.gulmoharDeep, PAL.leafPale] : [PAL.leaf, PAL.leafDeep, PAL.leafPale];
  const count = gul ? 5 : 4, spread = gul ? 2.4 : 1.7;
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : rng.range(0.7, spread), r = rng.range(1.4, 2.1);
    b.stamp(TPL.crown, mat(x + Math.cos(a) * d, trunkH + 0.9 + rng.range(0, 0.8), z + Math.sin(a) * d, rng.range(0, 3), rng.range(0, 3), 0, r, r * (gul ? 0.55 : 0.85), r), rng.pick(colors));
  }
  // fallen gulmohar petals carpet the ground under the tree
  if (gul) {
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 2.8, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const s = rng.range(0.05, 0.09), r = rng.range(0, 3), c = Math.cos(r) * s, sn = Math.sin(r) * s;
      b.quad([px - c + sn, 0.035, pz - sn - c], [px + c + sn, 0.035, pz + sn - c], [px + c - sn, 0.035, pz + sn + c], [px - c - sn, 0.035, pz - sn + c], UP, rng.pick([PAL.petal, PAL.gulmohar, PAL.gulmoharDeep]));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// the 10,000 litre black Sintex-style tank at the end of 3rd Road

function tank(): THREE.Group {
  const g = new THREE.Group();
  const b = new Batch();
  const standH = 0.9, R = 1.3, H = 2.3;
  b.box(-1.55, 1.55, 0, standH, -1.55, 1.55, PAL.concrete, { top: PAL.concreteDark });
  const t = (geo: THREE.BufferGeometry, y: number, color: number) => b.geometry(geo, M4.makeTranslation(0, y, 0), color);
  t(new THREE.CylinderGeometry(R, R * 1.02, H, 28), standH + H / 2, PAL.sintex);
  // moulded ribs round the drum
  for (let y = standH + 0.3; y < standH + H - 0.2; y += 0.42) t(new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.07, 28), y, 0x3a3740);
  t(new THREE.CylinderGeometry(R * 0.55, R, 0.34, 28), standH + H + 0.17, PAL.sintex); // shoulder
  t(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 16), standH + H + 0.42, 0x3a3740); // lid
  // inlet and outlet pipes
  b.geometry(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), M4.makeRotationZ(Math.PI / 2).setPosition(R + 0.7, standH + 0.35, 0), 0xeeeeea);
  b.geometry(new THREE.CylinderGeometry(0.04, 0.04, standH + H, 8), M4.makeTranslation(-R - 0.12, (standH + H) / 2, 0.4), 0xeeeeea);
  const mesh = new THREE.Mesh(b.toGeometry(), cel({ vertexColors: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  return g;
}

// ---------------------------------------------------------------------------------------------

export interface Built {
  view: WorldView;
  /** meshes that deserve hero outlines */
  heroes: THREE.Mesh[];
}

export function buildWorld(patch: Patch, groundImg: HTMLImageElement, terrain: Terrain): Built {
  const b = patch.bounds;
  const W = b.maxX - b.minX, H = b.maxZ - b.minZ;
  const view = new WorldView(W, H);
  const rng = rngKit(20260929);
  const nx = Math.ceil(W / CHUNK), nz = Math.ceil(H / CHUNK);
  const chunkOf = (x: number, z: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - b.minX) / CHUNK)));
    const j = Math.min(nz - 1, Math.max(0, Math.floor((z - b.minZ) / CHUNK)));
    return j * nx + i;
  };
  const solid = Array.from({ length: nx * nz }, () => new Batch());
  const walls = Array.from({ length: nx * nz }, () => new Batch());

  for (const r of patch.roads) road(solid[chunkOf(r.p[0], r.p[1])], r);
  for (const bd of patch.buildings) building(walls[chunkOf(bd.p[0], bd.p[1])], solid[chunkOf(bd.p[0], bd.p[1])], rng, bd);
  for (const rl of patch.rail) {
    const s = solid[chunkOf(rl.p[0], rl.p[1])];
    ribbon(s, rl.p, 1.8, 0.14, 0x6a616e);
    dashes(s, rl.p, 0.17, 0.25, 0.45, 1.3, 0x4f4852);
    for (const off of [-0.72, 0.72]) ribbon(s, offsetLine(rl.p, off).l.flat(), 0.07, 0.26, 0xd8d4dc);
  }
  const platformAxes: { c: number[]; a: number[]; len: number }[] = [];
  for (const pl of patch.platforms) platformAxes.push(platform(solid[chunkOf(pl.p[0], pl.p[1])], pl.p));
  const signs = Array.from({ length: nx * nz }, () => new Batch());
  const atlas = createSignAtlas();
  buildPlaces(patch, {
    solid: (x, z) => solid[chunkOf(x, z)],
    signs: (x, z) => signs[chunkOf(x, z)],
    terrain,
    platforms: platformAxes,
  }, atlas);
  atlas.texture.needsUpdate = true;
  for (const [x, z, k] of patch.trees) {
    tree(solid[chunkOf(x, z)], rng, x, z, k);
    terrain.addCircle(x, z, 0.3);
  }

  // ground: one textured grid per chunk (10 m cells so the curve bends it smoothly)
  const tex = new THREE.Texture(groundImg);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  const groundMat = cel({ map: tex, bands: 2 });
  const wallMat = cel({ vertexColors: true, map: windowTexture() });
  const solidMat = cel({ vertexColors: true });
  const signMat = cel({ vertexColors: true, map: atlas.texture, bands: 'soft3' });
  const gw = patch.ground.w * patch.ground.px, gh = patch.ground.h * patch.ground.px;

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = b.minX + i * CHUNK, z0 = b.minZ + j * CHUNK;
      const x1 = Math.min(b.maxX, x0 + CHUNK), z1 = Math.min(b.maxZ, z0 + CHUNK);
      const group = new THREE.Group();
      const g = groundGrid(x0, x1, z0, z1, 10, (x, z) => [(x - b.minX) / gw, 1 - (z - b.minZ) / gh]);
      const gm = new THREE.Mesh(g, groundMat);
      gm.receiveShadow = true;
      group.add(gm);
      const k = j * nx + i;
      if (!solid[k].empty) {
        const m = new THREE.Mesh(solid[k].toGeometry(), solidMat);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
      }
      if (!signs[k].empty) {
        const m = new THREE.Mesh(signs[k].toGeometry(), signMat);
        m.receiveShadow = true;
        group.add(m);
      }
      if (!walls[k].empty) {
        const m = new THREE.Mesh(walls[k].toGeometry(), wallMat);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
      }
      view.add(group, (x0 + x1) / 2, (z0 + z1) / 2);
    }
  }

  // the tank and its board
  const heroes: THREE.Mesh[] = [];
  const tg = tank();
  tg.position.set(patch.tank.x, 0, patch.tank.z);
  terrain.addCircle(patch.tank.x, patch.tank.z, 1.7);
  heroes.push(tg.children[0] as THREE.Mesh);
  const board = postBoard(boardTexture([{ text: '3rd Road Taaki', size: 78 }], '#1f5fae', '#ffffff'), 2.6, 0.82, 1.6);
  // beside the tank, facing the road
  const fx = -Math.sin(patch.tank.yaw), fz = -Math.cos(patch.tank.yaw);
  board.position.set(patch.tank.x + fz * 2.4 + fx * 0.6, 0, patch.tank.z - fx * 2.4 + fz * 0.6);
  board.rotation.y = patch.tank.yaw;
  const heroGroup = new THREE.Group();
  heroGroup.add(tg, board);
  view.add(heroGroup, patch.tank.x, patch.tank.z);

  // station boards on the platforms, facing across the tracks
  for (const st of patch.stations) {
    const ax = platformAxes.slice().sort((p1, p2) => Math.hypot(p1.c[0] - st.x, p1.c[1] - st.z) - Math.hypot(p2.c[0] - st.x, p2.c[1] - st.z))[0];
    if (!ax) continue;
    for (const t of [-0.3, 0.3]) {
      const sb = postBoard(boardTexture([{ text: st.mr ?? '', size: 60 }, { text: st.n.toUpperCase(), size: 58 }], '#f5d23a', '#1a1a1a', 512, 190, false), 3.4, 1.26, 1.9);
      const x = ax.c[0] + ax.a[0] * ax.len * t, z = ax.c[1] + ax.a[1] * ax.len * t;
      sb.position.set(x, 0.92, z);
      // board plane along the platform so it reads from the track side
      sb.rotation.y = Math.atan2(ax.a[1], -ax.a[0]) + Math.PI / 2;
      const sg = new THREE.Group();
      sg.add(sb);
      view.add(sg, x, z);
    }
  }
  return { view, heroes };
}

function groundGrid(x0: number, x1: number, z0: number, z1: number, cell: number, uv: (x: number, z: number) => number[]): THREE.BufferGeometry {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      pos.push(x, 0, z);
      nrm.push(0, 1, 0);
      uvs.push(...uv(x, z));
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b2 = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b2, b2, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}
