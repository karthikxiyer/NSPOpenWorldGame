/**
 * Real places: signboards from OSM names, the Station Road shopfronts, the station building and
 * footbridges, and the ST Depot bus stand. Placement comes from scripts/build-patch.mjs; this
 * file only draws it.
 *
 * Every sign face is a cell in one canvas atlas, so all the signs in a chunk are a single mesh
 * with one material.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import { Batch, template } from './geo';
import type { Patch, PSign, SignKind } from './patch';
import type { Terrain } from './Terrain';

// ---------------------------------------------------------------------------------------------
// shop names: a type of shop and a common Nalasopara shop-name prefix (shopfronts are procedural;
// only the shops, clinics and banks mapped in OSM carry their real names)

interface ShopType {
  en: string;
  mr: string;
  goods: number[];
}

const SHOP_TYPES: ShopType[] = [
  { en: 'Medical', mr: 'मेडिकल', goods: [0xffffff, 0x2a9d8f, 0xd8433a] },
  { en: 'Kirana Stores', mr: 'किराणा स्टोअर्स', goods: [0xf5b52a, 0xd8433a, 0x7d6356, 0xefe6cf] },
  { en: 'Mobile Shoppe', mr: 'मोबाईल शॉपी', goods: [0x2f2a35, 0x1f5fae, 0xd9d2c7] },
  { en: 'Sweets & Farsan', mr: 'स्वीट्स अँड फरसाण', goods: [0xf5b52a, 0xf08a24, 0xefe6cf] },
  { en: 'Hardware', mr: 'हार्डवेअर', goods: [0x6e6b7a, 0xf2c230, 0x2f8f4e] },
  { en: 'Tailors', mr: 'टेलर्स', goods: [0x1f5fae, 0xf0cfd2, 0xefe6cf] },
  { en: 'Jewellers', mr: 'ज्वेलर्स', goods: [0xf5d23a, 0x8a1f2d, 0xefe6cf] },
  { en: 'Footwear', mr: 'फुटवेअर', goods: [0x7d6356, 0x2f2a35, 0xd8433a] },
  { en: 'Xerox & Stationery', mr: 'झेरॉक्स', goods: [0xffffff, 0x1f5fae, 0xf5b52a] },
  { en: 'Vada Pav Centre', mr: 'वडापाव सेंटर', goods: [0xf5b52a, 0xc2a57c, 0x2a9d8f] },
  { en: 'Chinese Corner', mr: 'चायनीज कॉर्नर', goods: [0xd8433a, 0xf5b52a, 0x2f2a35] },
  { en: 'Electricals', mr: 'इलेक्ट्रिकल्स', goods: [0xffffff, 0xf2c230, 0x6e6b7a] },
  { en: 'Opticians', mr: 'ऑप्टिशियन्स', goods: [0x2f2a35, 0xd7e6e2, 0x1f5fae] },
  { en: 'Dry Fruits', mr: 'ड्राय फ्रुट्स', goods: [0xc2a57c, 0x7d6356, 0xf5b52a] },
  { en: 'Saree Centre', mr: 'साडी सेंटर', goods: [0xd8433a, 0xf08a24, 0x8a1f2d, 0x2a9d8f] },
  { en: 'Hair Saloon', mr: 'हेअर सलून', goods: [0xffffff, 0x2f2a35, 0xe4d9ee] },
  { en: 'Bakery', mr: 'बेकरी', goods: [0xc2a57c, 0xefe6cf, 0xf5b52a] },
  { en: 'Dairy', mr: 'डेअरी', goods: [0xffffff, 0x1f5fae, 0xefe6cf] },
];
const PREFIXES = ['Shree Sai', 'Jai Ambe', 'New', 'Om', 'Laxmi', 'Ganesh', 'Balaji', 'Mahalaxmi', 'Shree Krishna', 'Jai Hind', 'Royal', 'Shiv Shakti', 'Vighnaharta', 'Ekvira', 'Sai Kripa', 'Bombay'];
const SHOP_COLORS: [string, string][] = [
  ['#d8433a', '#fff5d6'], ['#1f5fae', '#ffffff'], ['#f5d23a', '#8a1f2d'], ['#2f8f4e', '#ffffff'], ['#8a1f2d', '#f5d23a'],
  ['#ffffff', '#d8433a'], ['#f08a24', '#ffffff'], ['#2a9d8f', '#ffffff'], ['#2f2a35', '#f5b52a'],
];

function shopOf(id: number): { type: ShopType; name: string; colors: [string, string] } {
  const type = SHOP_TYPES[id % SHOP_TYPES.length];
  const prefix = PREFIXES[Math.floor(id / SHOP_TYPES.length + id * 7) % PREFIXES.length];
  return { type, name: `${prefix} ${type.en}`, colors: SHOP_COLORS[(id * 5 + 3) % SHOP_COLORS.length] };
}

// ---------------------------------------------------------------------------------------------
// the sign atlas: 256x64 cells (4:1, the shape of every sign) in a 2048x2048 canvas

const CW = 256, CH = 64, ATLAS = 2048, COLS = ATLAS / CW, ROWS = ATLAS / CH;
const FONT = "system-ui, 'Noto Sans Devanagari', 'Kohinoor Devanagari', sans-serif";

interface SignStyle {
  bg: string;
  fg: string;
  border?: string;
  icon?: 'cross' | 'bulbs';
}

const STYLES: Record<Exclude<SignKind, 'shop'>, SignStyle> = {
  health: { bg: '#ffffff', fg: '#c62828', border: '#c62828', icon: 'cross' },
  bank: { bg: '#123f7c', fg: '#ffffff' },
  worship: { bg: '#f08a24', fg: '#6b1320' },
  cinema: { bg: '#2b1d3a', fg: '#f5d23a', icon: 'bulbs' },
  school: { bg: '#1f5fae', fg: '#ffffff', border: '#ffffff' },
  park: { bg: '#2f7d45', fg: '#ffffff', border: '#e8f0d8' },
  fuel: { bg: '#f5d23a', fg: '#123f7c' },
  society: { bg: '#3a3040', fg: '#f0d9a0', border: '#b89a5a' },
  street: { bg: '#1f5fae', fg: '#ffffff', border: '#ffffff' },
  platform: { bg: '#1f5fae', fg: '#ffffff' },
  depot: { bg: '#c8322d', fg: '#ffffff', border: '#ffffff' },
  station: { bg: '#f5d23a', fg: '#1a1a1a' },
};

class SignAtlas {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private cells = new Map<string, number[]>();
  private next = 0;

  constructor() {
    this.canvas.width = this.canvas.height = ATLAS;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  /** UV rectangle [u0, v0, u1, v1] for a sign, drawing it on first use. */
  uv(key: string, draw: (g: CanvasRenderingContext2D) => void): number[] {
    const hit = this.cells.get(key);
    if (hit) return hit;
    const i = this.next < COLS * ROWS ? this.next++ : 0; // full: reuse the first cell rather than fail
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(cx, cy, CW, CH);
    g.clip();
    g.translate(cx, cy);
    draw(g);
    g.restore();
    // inset by a pixel so neighbouring cells don't bleed in
    const uv = [(cx + 1) / ATLAS, 1 - (cy + CH - 1) / ATLAS, (cx + CW - 1) / ATLAS, 1 - (cy + 1) / ATLAS];
    this.cells.set(key, uv);
    return uv;
  }
}

function fitText(g: CanvasRenderingContext2D, text: string, size: number, maxW: number, weight = 'bold'): number {
  let s = size;
  do {
    g.font = `${weight} ${s}px ${FONT}`;
    if (g.measureText(text).width <= maxW) break;
    s -= 1;
  } while (s > 9);
  return s;
}

/** Draw a two-line (or one-line) board: main text large, sub text small. */
function drawBoard(g: CanvasRenderingContext2D, st: SignStyle, main: string, sub?: string) {
  g.fillStyle = st.bg;
  g.fillRect(0, 0, CW, CH);
  let left = 10;
  if (st.border) {
    g.strokeStyle = st.border;
    g.lineWidth = 3;
    g.strokeRect(4, 4, CW - 8, CH - 8);
  }
  if (st.icon === 'cross') {
    g.fillStyle = st.fg;
    g.fillRect(16, 22, 30, 10);
    g.fillRect(26, 12, 10, 30);
    left = 54;
  } else if (st.icon === 'bulbs') {
    g.fillStyle = '#ffe9a8';
    for (let x = 6; x < CW; x += 12) { g.fillRect(x, 3, 4, 4); g.fillRect(x, CH - 7, 4, 4); }
  }
  g.fillStyle = st.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = (left + CW - 10) / 2, maxW = CW - left - 14;
  if (sub) {
    fitText(g, main, 28, maxW);
    g.fillText(main, cx, 24);
    fitText(g, sub, 16, maxW, '600');
    g.fillText(sub, cx, 49);
  } else {
    fitText(g, main, 34, maxW);
    g.fillText(main, cx, CH / 2 + 1);
  }
}

function drawShop(g: CanvasRenderingContext2D, id: number) {
  const { type, name, colors } = shopOf(id);
  drawBoard(g, { bg: colors[0], fg: colors[1] }, name, type.mr);
}

function drawPlatform(g: CanvasRenderingContext2D, n: string) {
  const st = STYLES.platform;
  g.fillStyle = st.bg;
  g.fillRect(0, 0, CW, CH);
  g.fillStyle = st.fg;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  fitText(g, 'फलाट', 18, 120, '600');
  g.fillText('फलाट', 16, 22);
  fitText(g, 'PLATFORM', 18, 120);
  g.fillText('PLATFORM', 16, 46);
  g.textAlign = 'center';
  g.font = `bold 50px ${FONT}`;
  g.fillText(n, 200, CH / 2 + 2);
}

// ---------------------------------------------------------------------------------------------
// oriented pieces in a local frame (x along the front, y up, +z out of the front)

const BOX = template(new THREE.BoxGeometry(1, 1, 1));
const CYL = template(new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
const WHEEL = template(new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateZ(Math.PI / 2));
const M = new THREE.Matrix4();
const L = new THREE.Matrix4();

class Frame {
  readonly m = new THREE.Matrix4();
  readonly c: number;
  readonly s: number;
  constructor(readonly x: number, readonly z: number, readonly yaw: number, readonly y = 0) {
    this.m.makeRotationY(yaw).setPosition(x, y, z);
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
  }
  /** local → world */
  p(lx: number, ly: number, lz: number): number[] {
    return [this.x + this.c * lx + this.s * lz, this.y + ly, this.z - this.s * lx + this.c * lz];
  }
  n(lx: number, ly: number, lz: number): number[] {
    return [this.c * lx + this.s * lz, ly, -this.s * lx + this.c * lz];
  }
  box(b: Batch, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number) {
    L.makeScale(x1 - x0, y1 - y0, z1 - z0).setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    b.stamp(BOX, M.multiplyMatrices(this.m, L), color);
  }
  post(b: Batch, lx: number, lz: number, y0: number, y1: number, r: number, color: number) {
    L.makeScale(r * 2, y1 - y0, r * 2).setPosition(lx, (y0 + y1) / 2, lz);
    b.stamp(CYL, M.multiplyMatrices(this.m, L), color);
  }
  wheel(b: Batch, lx: number, ly: number, lz: number, r: number, w: number, color: number) {
    L.makeScale(w, r * 2, r * 2).setPosition(lx, ly, lz);
    b.stamp(WHEEL, M.multiplyMatrices(this.m, L), color);
  }
  quad(b: Batch, a: number[], bb: number[], c: number[], d: number[], n: number[], color: number, uv?: number[][]) {
    b.quad(this.p(a[0], a[1], a[2]), this.p(bb[0], bb[1], bb[2]), this.p(c[0], c[1], c[2]), this.p(d[0], d[1], d[2]), this.n(n[0], n[1], n[2]), color, uv);
  }
  /** a sign face in the local xy plane at depth z, facing +z (or -z when back) */
  face(b: Batch, cx: number, cy: number, z: number, w: number, h: number, uv: number[], back = false) {
    const [u0, v0, u1, v1] = uv;
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    if (!back) this.quad(b, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], 0xffffff, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    else this.quad(b, [x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], [0, 0, -1], 0xffffff, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
}

// ---------------------------------------------------------------------------------------------

export interface PlaceTargets {
  solid: (x: number, z: number) => Batch;
  signs: (x: number, z: number) => Batch;
  terrain: Terrain;
  platforms: { c: number[]; a: number[]; len: number }[];
}

export function createSignAtlas(): SignAtlas {
  return new SignAtlas();
}

function signUV(atlas: SignAtlas, s: PSign): number[] {
  if (s.k === 'platform') return atlas.uv(`platform|${s.n}`, (g) => drawPlatform(g, s.n));
  if (s.k === 'shop') {
    // mapped shops: their real name on a colour picked from the name
    let h = 0;
    for (let i = 0; i < s.n.length; i++) h = (h * 31 + s.n.charCodeAt(i)) >>> 0;
    const colors = SHOP_COLORS[h % SHOP_COLORS.length];
    return atlas.uv(`shop|${s.n}|${s.s ?? ''}`, (g) => drawBoard(g, { bg: colors[0], fg: colors[1] }, s.n, s.s));
  }
  const st = STYLES[s.k];
  return atlas.uv(`${s.k}|${s.n}|${s.s ?? ''}`, (g) => drawBoard(g, st, s.n, s.s));
}

function sign(t: PlaceTargets, atlas: SignAtlas, s: PSign) {
  const f = new Frame(s.x, s.z, s.yaw);
  const sb = t.signs(s.x, s.z), b = t.solid(s.x, s.z);
  const w = s.w, h = w / 4, uv = signUV(atlas, s);
  if (s.post) {
    // a board on two posts
    for (const px of [-w / 2 + 0.18, w / 2 - 0.18]) {
      f.post(b, px, -0.07, 0, s.y + h / 2, 0.055, 0x5b6068);
      const [wx, , wz] = f.p(px, 0, -0.07);
      t.terrain.addCircle(wx, wz, 0.12);
    }
    f.box(b, -w / 2, w / 2, s.y - h / 2, s.y + h / 2, -0.04, 0.03, 0x8a8f96);
    f.face(sb, 0, s.y, 0.035, w, h, uv);
    if (s.k === 'street') f.face(sb, 0, s.y, -0.045, w, h, uv, true);
    return;
  }
  if (s.hang) {
    // hanging from a platform roof on two rods, readable from both ends
    const y = s.y;
    for (const px of [-w / 2 + 0.12, w / 2 - 0.12]) f.post(b, px, 0, y + h / 2, 4.22, 0.02, 0x3f4650);
    f.box(b, -w / 2, w / 2, y - h / 2, y + h / 2, -0.03, 0.03, 0x2f3a4a);
    f.face(sb, 0, y, 0.035, w, h, uv);
    f.face(sb, 0, y, -0.035, w, h, uv, true);
    return;
  }
  // on a wall: a backing board, the face just in front
  f.box(b, -w / 2 - 0.05, w / 2 + 0.05, s.y - h / 2 - 0.05, s.y + h / 2 + 0.05, 0, 0.08, 0x4a4550);
  f.face(sb, 0, s.y, 0.085, w, h, uv);
}

const SHUTTERS = [0x8a8795, 0x9a98a4, 0x7d8290, 0xa39c92];
const AWNINGS = [0x2f6fb3, 0x2f8f4e, 0xf08a24, 0xd8433a, 0x2a9d8f, 0xf5b52a];

/** One shop in a building's ground floor: shutter or open counter, awning, signboard. */
function shopfront(t: PlaceTargets, atlas: SignAtlas, x: number, z: number, yaw: number, w: number, id: number, open: boolean) {
  const f = new Frame(x, z, yaw);
  const b = t.solid(x, z), sb = t.signs(x, z);
  const hw = w / 2;
  // a negative id is a mapped shop: its real-name board is already on the wall above
  const mapped = id < 0;
  if (mapped) id = -1 - id;
  const { type } = shopOf(id);
  const pick = (arr: number[], k: number) => arr[(id * 7 + k * 13 + Math.round(x * 3)) % arr.length];
  // pillars between shops
  for (const px of [-hw + 0.12, hw - 0.12]) f.box(b, px - 0.12, px + 0.12, 0, 2.7, 0, 0.14, PAL.parapet);
  if (open) {
    f.box(b, -hw + 0.24, hw - 0.24, 0, 2.55, 0, 0.03, 0x3b3542); // the dark shop interior
    f.box(b, -hw + 0.4, hw - 0.4, 0, 0.9, 0.03, 0.62, pick(type.goods, 0)); // counter
    // goods on the counter and stacked either side
    const n = Math.max(2, Math.floor((w - 0.8) / 0.7));
    for (let i = 0; i < n; i++) {
      const gx = -hw + 0.6 + (i * (w - 1.2)) / Math.max(1, n - 1);
      f.box(b, gx - 0.22, gx + 0.22, 0.9, 0.9 + 0.2 + ((i * 37 + id) % 3) * 0.1, 0.12, 0.5, pick(type.goods, i + 1));
    }
    f.box(b, -hw + 0.3, -hw + 0.7, 0.9, 2.2, 0.03, 0.35, pick(type.goods, 5));
    f.box(b, hw - 0.7, hw - 0.3, 0.9, 2.2, 0.03, 0.35, pick(type.goods, 6));
    // a tarpaulin awning over the pavement
    if ((id + Math.round(z)) % 3 !== 0) {
      const c = pick(AWNINGS, 2), y0 = 2.62, y1 = 2.3, d = 1.05;
      f.quad(b, [-hw, y0, 0.1], [hw, y0, 0.1], [hw, y1, d], [-hw, y1, d], [0, 0.95, 0.3], c);
      f.quad(b, [-hw, y1, d], [hw, y1, d], [hw, y0, 0.1], [-hw, y0, 0.1], [0, -1, 0], c);
      f.box(b, -hw, hw, y1 - 0.18, y1, d - 0.02, d, c); // valance
    }
  } else {
    // a rolling shutter with its ribs and the box it rolls into
    const c = pick(SHUTTERS, 3);
    f.box(b, -hw + 0.24, hw - 0.24, 0, 2.45, 0, 0.05, c);
    for (let y = 0.4; y < 2.4; y += 0.45) f.box(b, -hw + 0.24, hw - 0.24, y, y + 0.05, 0.05, 0.065, PAL.shutterDark);
    f.box(b, -hw + 0.24, hw - 0.24, 2.45, 2.7, 0, 0.2, PAL.shutterDark);
    f.box(b, -0.12, 0.12, 0.1, 0.22, 0.05, 0.09, 0x3a3740); // padlock
  }
  if (mapped) return;
  // the signboard
  const sw = w - 0.2, sh = sw / 4;
  const y = 2.78 + sh / 2;
  f.box(b, -sw / 2 - 0.04, sw / 2 + 0.04, y - sh / 2 - 0.04, y + sh / 2 + 0.04, 0, 0.1, 0x4a4550);
  f.face(sb, 0, y, 0.105, sw, sh, atlas.uv(`shopfront|${id}`, (g) => drawShop(g, id)));
}

/** MSRTC "Lal Pari": red body, cream band, dark glass, silver roof. Faces +z. */
function bus(b: Batch, x: number, z: number, yaw: number) {
  const f = new Frame(x, z, yaw);
  const red = 0xc8322d, L2 = 5.5;
  f.box(b, -1.25, 1.25, 0.45, 1.5, -L2, L2, red);
  f.box(b, -1.27, 1.27, 1.42, 1.56, -L2 + 0.1, L2 - 0.1, 0xf2e6c8); // cream band
  f.box(b, -1.24, 1.24, 1.56, 2.45, -L2 + 0.25, L2 - 0.2, 0x3d4a5e); // windows
  for (let zz = -L2 + 0.4; zz < L2 - 0.3; zz += 1.35) f.box(b, -1.255, 1.255, 1.56, 2.45, zz, zz + 0.14, red); // pillars
  f.box(b, -1.25, 1.25, 2.45, 2.95, -L2, L2, red);
  f.box(b, -1.12, 1.12, 2.95, 3.05, -L2 + 0.3, L2 - 0.3, 0xdcdad6); // roof
  f.box(b, -1.1, 1.1, 1.6, 2.4, L2 - 0.02, L2 + 0.02, 0x2f3a4a); // windscreen
  f.box(b, -0.9, 0.9, 2.52, 2.86, L2 - 0.02, L2 + 0.04, 0x1d1b22); // route board
  f.box(b, -1.26, 1.26, 0.3, 0.55, L2 - 0.05, L2 + 0.12, 0x6e6b7a); // bumper
  for (const hx of [-0.85, 0.85]) f.box(b, hx - 0.15, hx + 0.15, 0.7, 0.9, L2, L2 + 0.03, 0xfff3c0); // headlamps
  for (const wz of [-3.4, 3.4]) for (const wx of [-1.1, 1.1]) f.wheel(b, wx, 0.5, wz, 0.5, 0.36, 0x2a262c);
}

// ---------------------------------------------------------------------------------------------

export function buildPlaces(patch: Patch, t: PlaceTargets, atlas: SignAtlas): void {
  for (const s of patch.signs ?? []) sign(t, atlas, s);
  const sh = patch.shops ?? [];
  for (let i = 0; i < sh.length; i += 6) shopfront(t, atlas, sh[i], sh[i + 1], sh[i + 2], sh[i + 3], sh[i + 4], sh[i + 5] === 1);
  if (patch.station) stationBuilding(t, atlas, patch.station);
  if (patch.depot) depot(t, patch.depot);
  footbridges(patch, t);
}

function stationBuilding(t: PlaceTargets, atlas: SignAtlas, st: NonNullable<Patch['station']>) {
  const f = new Frame(st.x, st.z, st.yaw);
  const b = t.solid(st.x, st.z), sb = t.signs(st.x, st.z);
  const hw = st.w / 2, hd = st.d / 2, wallH = 5.3;
  const cream = 0xf1e3c0, maroon = 0x8a1f2d, tile = 0xc4623e;
  f.box(b, -hw, hw, 0, 0.35, -hd - 0.6, hd + 0.6, PAL.concrete); // plinth
  f.box(b, -hw, hw, 0.35, wallH, -hd, hd, cream);
  f.box(b, -hw - 0.1, hw + 0.1, wallH, wallH + 0.35, -hd - 0.1, hd + 0.1, maroon);
  // hipped tile roof
  const e = 0.7, y0 = wallH + 0.35, y1 = st.h + 1.2, rx = hw - hd * 0.8;
  const A = [-hw - e, y0, hd + e], B = [hw + e, y0, hd + e], C = [hw + e, y0, -hd - e], D = [-hw - e, y0, -hd - e];
  const R1 = [-rx, y1, 0], R2 = [rx, y1, 0];
  f.quad(b, A, B, R2, R1, [0, 0.8, 0.6], tile);
  f.quad(b, C, D, R1, R2, [0, 0.8, -0.6], tile);
  b.tri(f.p(B[0], B[1], B[2]), f.p(C[0], C[1], C[2]), f.p(R2[0], R2[1], R2[2]), f.n(0.6, 0.8, 0), tile);
  b.tri(f.p(D[0], D[1], D[2]), f.p(A[0], A[1], A[2]), f.p(R1[0], R1[1], R1[2]), f.n(-0.6, 0.8, 0), tile);
  f.quad(b, A, D, C, B, [0, -1, 0], 0xe8dcc4); // eaves underside
  // doors and ticket windows on the front (toward Depot Road)
  for (const dx of [-6, 0, 6]) {
    f.box(b, dx - 1.1, dx + 1.1, 0.35, 2.75, hd, hd + 0.03, 0x4a3b3a);
    f.box(b, dx - 1.3, dx + 1.3, 2.75, 2.95, hd, hd + 0.06, maroon);
  }
  for (const dx of [-10.5, -8.6, 8.6, 10.5]) {
    f.box(b, dx - 0.55, dx + 0.55, 1.2, 2.1, hd, hd + 0.03, 0x33405a);
    f.box(b, dx - 0.65, dx + 0.65, 1.1, 1.2, hd, hd + 0.2, PAL.concreteDark);
  }
  // the station's name over the doors, the booking office sign, and a clock
  f.box(b, -3.9, 3.9, 3.1, 5.0, hd, hd + 0.08, 0x4a4550);
  f.face(sb, 0, 4.05, hd + 0.085, 7.6, 1.9, atlas.uv('station|name', (g) => drawBoard(g, STYLES.station, 'NALLASOPARA', 'नालासोपारा')));
  for (const dx of [-9.55, 9.55]) {
    f.box(b, dx - 1.55, dx + 1.55, 2.35, 3.2, hd, hd + 0.06, 0x4a4550);
    f.face(sb, dx, 2.775, hd + 0.065, 3.2, 0.8, atlas.uv('station|booking', (g) => drawBoard(g, { bg: '#1f5fae', fg: '#ffffff' }, 'BOOKING OFFICE', 'तिकीट घर')));
  }
  L.makeRotationX(Math.PI / 2).setPosition(6.5, 4.2, hd + 0.08);
  L.scale(new THREE.Vector3(1.1, 0.12, 1.1));
  b.stamp(CYL, M.multiplyMatrices(f.m, L), 0xfaf6ea);
  f.box(b, 6.47, 6.53, 4.2, 4.6, hd + 0.15, hd + 0.17, 0x1d1b22);
  f.box(b, 6.5, 6.8, 4.17, 4.23, hd + 0.15, hd + 0.17, 0x1d1b22);
}

function depot(t: PlaceTargets, d: NonNullable<Patch['depot']>) {
  const f = new Frame(d.x, d.z, d.yaw);
  const b = t.solid(d.x, d.z);
  const hw = d.w / 2, hd = d.d / 2, H = 4.3;
  // concrete bay floor, a row of columns, a galvanised roof with red fascia
  f.box(b, -hw, hw, 0, 0.12, -hd, hd, PAL.concrete);
  for (let x = -hw + 1; x <= hw - 1 + 0.01; x += (d.w - 2) / 8) {
    f.box(b, x - 0.15, x + 0.15, 0, H, -0.15, 0.15, 0xe2d8ca);
    const [wx, , wz] = f.p(x, 0, 0);
    t.terrain.addCircle(wx, wz, 0.25);
  }
  f.box(b, -hw, hw, H, H + 0.25, -hd, hd, 0xb8bec6);
  for (const z of [-hd, hd]) f.box(b, -hw, hw, H - 0.3, H + 0.3, z - 0.08, z + 0.08, 0xc8322d);
  // benches down the middle
  for (let x = -hw + 3; x < hw - 2; x += 5) {
    f.box(b, x - 1, x + 1, 0.45, 0.52, -0.9, -0.45, 0x3f7e86);
    f.box(b, x - 1, x + 1, 0.12, 0.45, -0.75, -0.6, 0x5b6068);
  }
  for (const [x, z, yaw] of d.buses) bus(t.solid(x, z), x, z, yaw);
  if (d.shed) {
    const s = d.shed, g = new Frame(s.x, s.z, s.yaw), sb = t.solid(s.x, s.z);
    const sw = s.w / 2, sd = s.d / 2, eave = s.h - 1.4;
    for (let x = -sw; x <= sw + 0.01; x += s.w / 4) for (const z of [-sd, sd]) g.box(sb, x - 0.2, x + 0.2, 0, eave, z - 0.2, z + 0.2, 0x7a8088);
    g.box(sb, -sw, sw, 0, eave, -sd, -sd + 0.2, 0xd9d2c7); // back wall
    const roof = 0x7f8fa0;
    g.quad(sb, [-sw - 0.5, eave, sd + 0.6], [sw + 0.5, eave, sd + 0.6], [sw + 0.5, s.h, 0], [-sw - 0.5, s.h, 0], [0, 0.9, 0.4], roof);
    g.quad(sb, [sw + 0.5, eave, -sd - 0.6], [-sw - 0.5, eave, -sd - 0.6], [-sw - 0.5, s.h, 0], [sw + 0.5, s.h, 0], [0, 0.9, -0.4], roof);
    g.quad(sb, [-sw - 0.5, eave, sd + 0.6], [-sw - 0.5, s.h, 0], [sw + 0.5, s.h, 0], [sw + 0.5, eave, sd + 0.6], [0, -1, 0], 0x5f6a78);
    g.quad(sb, [sw + 0.5, eave, -sd - 0.6], [sw + 0.5, s.h, 0], [-sw - 0.5, s.h, 0], [-sw - 0.5, eave, -sd - 0.6], [0, -1, 0], 0x5f6a78);
    for (const x of [-sw, sw]) sb.tri(g.p(x, eave, -sd), g.p(x, eave, sd), g.p(x, s.h, 0), g.n(Math.sign(x), 0, 0), 0xd9d2c7);
  }
}

// ---------------------------------------------------------------------------------------------
// footbridges over the tracks: a deck on columns with railings, stairs down to each platform

function pointInFlat(p: number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (p[i + 1] > z !== p[j + 1] > z && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  }
  return inside;
}

function footbridges(patch: Patch, t: PlaceTargets) {
  const DECK = 6.6, RAIL = 1.15;
  for (const r of patch.roads) {
    if (!r.b || r.c < 8) continue;
    const p = r.p, n = p.length / 2, hw = Math.max(1.6, r.w / 2 + 0.4);
    const b = t.solid(p[0], p[1]);
    let run = 0, lastStair = -99;
    const stairs: { x: number; z: number; pl: number }[] = [];
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const f = new Frame(ax, az, Math.atan2(bx - ax, bz - az)); // +z along the bridge
      f.box(b, -hw, hw, DECK - 0.35, DECK, 0, len, 0x9aa2a8);
      for (const s of [-1, 1]) {
        f.box(b, s * hw - 0.05, s * hw + 0.05, DECK, DECK + RAIL, 0, len, 0x3f7e86);
        f.box(b, s * hw - 0.08, s * hw + 0.08, DECK + RAIL, DECK + RAIL + 0.08, 0, len, 0x2f5f66);
      }
      // columns every ~14 m, and a stair wherever the bridge passes over a platform
      for (let d = 0; d < len; d += 1) {
        const x = ax + ((bx - ax) * d) / len, z = az + ((bz - az) * d) / len;
        const pl = patch.platforms.findIndex((q) => pointInFlat(q.p, x, z));
        if (pl >= 0 && run + d - lastStair > 12) { stairs.push({ x, z, pl }); lastStair = run + d; }
        if (Math.floor((run + d) / 14) !== Math.floor((run + d - 1) / 14)) {
          const onTrack = patch.rail.some((rl) => {
            for (let k = 0; k < rl.p.length / 2 - 1; k++) {
              const ex = rl.p[k * 2 + 2] - rl.p[k * 2], ez = rl.p[k * 2 + 3] - rl.p[k * 2 + 1], l2 = ex * ex + ez * ez || 1;
              const tt = Math.max(0, Math.min(1, ((x - rl.p[k * 2]) * ex + (z - rl.p[k * 2 + 1]) * ez) / l2));
              if (Math.hypot(rl.p[k * 2] + ex * tt - x, rl.p[k * 2 + 1] + ez * tt - z) < 2.6) return true;
            }
            return false;
          });
          if (!onTrack) {
            f.box(b, -0.3, 0.3, 0, DECK - 0.35, d - 0.3, d + 0.3, 0xd9d2c7);
            t.terrain.addCircle(x, z, 0.45);
          }
        }
      }
      run += len;
    }
    for (const s of stairs) {
      const ax = t.platforms[s.pl];
      if (!ax) continue;
      // down along the platform, toward its middle
      let dx = ax.a[0], dz = ax.a[1];
      if ((ax.c[0] - s.x) * dx + (ax.c[1] - s.z) * dz < 0) { dx = -dx; dz = -dz; }
      const f = new Frame(s.x, s.z, Math.atan2(dx, dz));
      const top = DECK, bot = 0.92, run2 = (top - bot) / 0.62, sw = 1.1;
      const steps = Math.round((top - bot) / 0.3);
      for (let k = 0; k < steps; k++) {
        const y = top - (k + 1) * ((top - bot) / steps), z0 = hw + (k * run2) / steps;
        f.box(b, -sw, sw, y, y + (top - bot) / steps, z0, z0 + run2 / steps + 0.02, k % 2 ? 0xc9c1b6 : 0xd9d2c7);
      }
      f.quad(b, [-sw, bot, hw + run2], [sw, bot, hw + run2], [sw, top, hw], [-sw, top, hw], [0, -0.6, -0.8], 0xb3aba2); // underside
      for (const sx of [-sw - 0.05, sw + 0.05]) {
        f.quad(b, [sx, top + RAIL, hw], [sx, bot + RAIL, hw + run2], [sx, bot, hw + run2], [sx, top - 0.3, hw], [Math.sign(sx), 0, 0], 0x3f7e86);
        f.quad(b, [sx, top - 0.3, hw], [sx, bot, hw + run2], [sx, bot + RAIL, hw + run2], [sx, top + RAIL, hw], [-Math.sign(sx), 0, 0], 0x3f7e86);
      }
      // the stairs are solid below head height: walk round them
      for (let z = hw + run2 * 0.45; z < hw + run2; z += 1.2) {
        const [wx, , wz] = f.p(0, 0, z);
        t.terrain.addCircle(wx, wz, 1.1);
      }
    }
  }
}
