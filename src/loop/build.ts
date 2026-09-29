import * as THREE from 'three';
import { hullOutlineTree } from '../core/outline';
import { PAL } from '../core/palette';
import { rngKit, type Rng } from '../core/rng';
import { cel } from '../core/toon';
import { bend, CIRCUMFERENCE, poseMatrix, R } from '../planet/planet';
import { Batch, ChunkedBatches } from './geo';
import {
  EAST_WALL_Z, FOOTPATH_H, FOOTPATH_OUT, PLATFORM, ROAD_HALF, SOUTH_WALL_Z, START, TRACK_DOWN_Z, TRACK_UP_Z, ZONES, type Zone,
} from './layout';
import { Terrain } from './Terrain';

// ---------------------------------------------------------------------------------------------
// shared bits

const WALLS = PAL.walls;
const ACCENTS = [PAL.saffron, PAL.teal, PAL.red, PAL.signBlue, PAL.green, PAL.marigold, PAL.maroon];
const M4 = new THREE.Matrix4();

function windowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#d9d0c4'; // floor slab line
  g.fillRect(0, s - 5, s, 5);
  g.fillStyle = '#4a5670'; // window
  g.fillRect(17, 13, 30, 27);
  g.fillStyle = '#6a7896';
  g.fillRect(19, 15, 12, 23);
  g.fillStyle = '#5a5560'; // grill bars
  for (let x = 21; x < 47; x += 6) g.fillRect(x, 13, 1.5, 27);
  g.fillStyle = '#ebe3d6'; // sill / chajja
  g.fillRect(14, 10, 36, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Text drawn onto a board face, local-signboard style. */
export function boardTexture(lines: { text: string; size: number; font?: string }[], bg: string, fg: string, w = 512, h = 160, border = true): THREE.Texture {
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
    const font = l.font ?? `system-ui, 'Noto Sans Devanagari', sans-serif`;
    do {
      g.font = `bold ${size}px ${font}`;
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

/** A board on posts, as a group in flat coordinates (to be pinned onto the planet). */
function postBoard(tex: THREE.Texture, w: number, h: number, postH: number, postColor: number): THREE.Group {
  const g = new THREE.Group();
  const face = cel({ map: tex, bands: 'soft3', flat: false });
  const back = cel({ color: 0x8a8f96 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), [back, back, back, back, face, back]);
  board.position.y = postH + h / 2;
  board.castShadow = true;
  g.add(board);
  const postMat = cel({ color: postColor });
  for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, postH + h, 8), postMat);
    p.position.set(x, (postH + h) / 2, -0.06);
    p.castShadow = true;
    g.add(p);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------

export interface LoopWorld {
  terrain: Terrain;
  root: THREE.Group;
}

export function buildLoop(scene: THREE.Scene): LoopWorld {
  const terrain = new Terrain();
  const root = new THREE.Group();
  root.name = 'loop';
  scene.add(root);
  const B = new ChunkedBatches();
  const hero = new Batch(); // outlined landmarks (the taaki)
  const rng = rngKit(20260929);

  // the planet itself
  const ground = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 128), cel({ color: PAL.dust, bands: 3, flat: false }));
  ground.receiveShadow = true;
  root.add(ground);

  // reserved stretches of the north frontage where nothing may be built
  const reserved: [number, number][] = [];
  const reserve = (a: number, b: number) => reserved.push([a, b]);
  const isFree = (a: number, b: number) => !reserved.some(([r0, r1]) => loopOverlap(a, b, r0, r1));

  // --- layout reservations ---
  const road3 = { x0: START.road3X - 2.5, x1: START.road3X + 2.5 };
  const link = { x0: 315.5, x1: 324.5 };
  reserve(road3.x0 - 0.5, road3.x1 + 0.5);
  reserve(START.taaki.x - 8, START.taaki.x + 8);
  reserve(link.x0 - 1, link.x1 + 1);
  reserve(START.corner.x0 - 1, START.corner.x1 + 1);
  terrain.addFootpathGap(road3.x0, road3.x1);
  terrain.addFootpathGap(link.x0, link.x1);

  buildRoad(B, rng, [road3, link]);
  buildFootpaths(B, [road3, link]);
  buildSideRoad(B, road3.x0, road3.x1, 42);
  buildSideRoad(B, link.x0, link.x1, 62);
  buildRailway(B, rng, terrain);
  buildTaaki(hero, terrain);

  for (const z of ZONES) buildFrontage(B, rng, terrain, z, isFree);
  // the corner opposite the bike: a low restaurant, so the Taaki stands clear behind it
  building(B, rng, START.corner.x0, START.corner.x1, FOOTPATH_OUT + 0.5, FOOTPATH_OUT + 9.5, 6.6, { front: -1, shopfront: true, color: 0xf3e3c3, tanks: 1 });
  terrain.addBox(START.corner.x0, START.corner.x1, FOOTPATH_OUT + 0.5, FOOTPATH_OUT + 9.5);
  buildBackRows(B, rng, terrain, isFree);
  buildEastSide(B, rng);
  buildStreetTrees(B, rng, terrain, isFree);

  // bake
  const mats = {
    solid: cel({ vertexColors: true }),
    walls: cel({ vertexColors: true, map: windowTexture() }),
    foliage: cel({ vertexColors: true, bands: 'soft3' }),
    ground: cel({ vertexColors: true, bands: 2 }),
  };
  for (const m of B.bake(mats, { castShadow: (k) => k !== 'ground' })) root.add(m);
  const heroMesh = new THREE.Mesh(bend(hero.toGeometry(), 4), mats.solid);
  heroMesh.castShadow = heroMesh.receiveShadow = true;
  root.add(heroMesh);
  hullOutlineTree(heroMesh, 0.003);

  // boards (rigid, pinned in place)
  const taakiBoard = postBoard(boardTexture([{ text: '3rd Road Taaki', size: 78 }], '#1f5fae', '#ffffff'), 2.6, 0.82, 1.6, 0x5b6068);
  place(taakiBoard, START.board.x, 0.16, START.board.z, Math.PI / 2);
  root.add(taakiBoard);

  const st = ZONES.find((z) => z.id === 'station')!;
  for (const [dx, yaw] of [[-18, 0], [18, 0], [0, Math.PI]] as const) {
    const b = postBoard(
      boardTexture([{ text: 'नाला सोपारा', size: 60 }, { text: 'NALLA SOPARA', size: 58 }], '#f5d23a', '#1a1a1a', 512, 190, false),
      3.4, 1.26, 1.9, 0x2f2a35,
    );
    place(b, st.x + dx, PLATFORM.h, (PLATFORM.z0 + PLATFORM.z1) / 2, yaw);
    root.add(b);
  }
  return { terrain, root };
}

function place(obj: THREE.Object3D, x: number, y: number, z: number, yaw: number): void {
  obj.matrixAutoUpdate = false;
  poseMatrix(x, y, z, yaw, obj.matrix);
}

function loopOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  for (const k of [-1, 0, 1]) {
    const o = k * CIRCUMFERENCE;
    if (a0 < b1 + o && a1 > b0 + o) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// road, footpaths, side roads

function buildRoad(B: ChunkedBatches, rng: Rng, mouths: { x0: number; x1: number }[]): void {
  const step = 3;
  for (let x = 0; x < CIRCUMFERENCE; x += step) {
    const x1 = Math.min(CIRCUMFERENCE, x + step);
    B.at(x, 'ground').rect(x, x1, -ROAD_HALF, ROAD_HALF, 0.03, PAL.road);
    // dashed centre line
    if (Math.floor(x / 3) % 2 === 0) B.at(x, 'ground').rect(x, x1, -0.07, 0.07, 0.045, PAL.lineWhite);
    // edge lines (broken at side-road mouths)
    const inMouth = mouths.some((m) => x1 > m.x0 && x < m.x1);
    if (!inMouth) B.at(x, 'ground').rect(x, x1, ROAD_HALF - 0.35, ROAD_HALF - 0.23, 0.045, PAL.lineWhite);
    B.at(x, 'ground').rect(x, x1, -ROAD_HALF + 0.23, -ROAD_HALF + 0.35, 0.045, PAL.lineWhite);
    // patches and repairs
    if (rng.chance(0.18)) {
      const px = x + rng.range(0, 2), pz = rng.range(-3.8, 2.5);
      B.at(x, 'ground').rect(px, px + rng.range(0.8, 2.4), pz, pz + rng.range(0.6, 1.4), 0.036, rng.chance(0.5) ? PAL.roadPatch : PAL.roadWorn);
    }
  }
  // zebra crossings
  for (const xc of [26, 418, 505, 548, 905]) {
    for (let z = -4.1; z < 4.1; z += 0.9) B.at(xc, 'ground').rect(xc - 1.4, xc + 1.4, z, z + 0.5, 0.05, PAL.lineWhite);
  }
  // speed breakers, painted black and yellow
  for (const xb of [-32, 44, 398, 610, 880]) {
    for (let z = -ROAD_HALF; z < ROAD_HALF; z += 0.75) {
      const b = B.at(xb, 'solid');
      b.box(xb - 0.35, xb + 0.35, 0.03, 0.1, z, Math.min(ROAD_HALF, z + 0.75), Math.round((z + ROAD_HALF) / 0.75) % 2 ? PAL.kerbYellow : PAL.kerbBlack);
    }
  }
}

function buildFootpaths(B: ChunkedBatches, gaps: { x0: number; x1: number }[]): void {
  const step = 1;
  for (let x = 0; x < CIRCUMFERENCE; x += step) {
    const stripe = Math.floor(x) % 2 === 0 ? PAL.kerbYellow : PAL.kerbBlack;
    const inGap = gaps.some((g) => x + step > g.x0 && x < g.x1);
    const b = B.at(x, 'solid');
    if (!inGap) {
      b.box(x, x + step, 0, FOOTPATH_H, ROAD_HALF + 0.12, FOOTPATH_OUT, PAL.footpath, { top: Math.floor(x / 2) % 2 ? PAL.paver : PAL.footpath });
      b.box(x, x + step, 0, FOOTPATH_H + 0.02, ROAD_HALF, ROAD_HALF + 0.12, stripe);
    }
    b.box(x, x + step, 0, FOOTPATH_H, -FOOTPATH_OUT, -ROAD_HALF - 0.12, PAL.footpath, { top: Math.floor(x / 2) % 2 ? PAL.paver : PAL.footpath });
    b.box(x, x + step, 0, FOOTPATH_H + 0.02, -ROAD_HALF - 0.12, -ROAD_HALF, stripe);
  }
}

function buildSideRoad(B: ChunkedBatches, x0: number, x1: number, zEnd: number): void {
  for (let z = ROAD_HALF; z < zEnd; z += 3) {
    const b = B.at(x0, 'ground');
    b.rect(x0, x1, z, Math.min(zEnd, z + 3), 0.03, PAL.road);
    if (Math.floor(z / 3) % 2 === 0) b.rect((x0 + x1) / 2 - 0.07, (x0 + x1) / 2 + 0.07, z, z + 1.5, 0.045, PAL.lineWhite);
  }
}

// ---------------------------------------------------------------------------------------------
// railway

function buildRailway(B: ChunkedBatches, rng: Rng, terrain: Terrain): void {
  const st = ZONES.find((z) => z.id === 'station')!;
  const pa = st.x - st.half + 3, pb = st.x + st.half - 3;
  const inStation = (x: number) => x > pa - 1 && x < pb + 1;

  for (let x = 0; x < CIRCUMFERENCE; x += 3) {
    const x1 = x + 3;
    const s = B.at(x, 'solid');
    // compound wall between road and railway
    if (!inStation(x)) {
      s.box(x, x1, 0, 2.0, SOUTH_WALL_Z - 0.3, SOUTH_WALL_Z, PAL.compound, { top: PAL.compoundCap });
      if (Math.round(x / 3) % 2 === 0) s.box(x - 0.15, x + 0.15, 0, 2.2, SOUTH_WALL_Z - 0.38, SOUTH_WALL_Z + 0.08, PAL.compoundCap);
    }
    // east boundary wall
    s.box(x, x1, 0, 2.1, EAST_WALL_Z - 0.3, EAST_WALL_Z, PAL.compound, { top: PAL.compoundCap });
    // ballast bed
    B.at(x, 'ground').box(x, x1, 0, 0.26, TRACK_DOWN_Z - 2.4, TRACK_UP_Z + 2.4, PAL.ballast);
    // rails
    for (const zc of [TRACK_UP_Z, TRACK_DOWN_Z]) {
      for (const off of [-0.76, 0.76]) s.box(x, x1, 0.34, 0.5, zc + off - 0.05, zc + off + 0.05, PAL.railHead);
    }
    // contact wires
    for (const zc of [TRACK_UP_Z, TRACK_DOWN_Z]) s.box(x, x1, 5.55, 5.6, zc - 0.02, zc + 0.02, 0x3a3440);
  }
  // sleepers
  for (let x = 0; x < CIRCUMFERENCE; x += 0.72) {
    for (const zc of [TRACK_UP_Z, TRACK_DOWN_Z]) B.at(x, 'solid').box(x - 0.13, x + 0.13, 0.24, 0.34, zc - 1.3, zc + 1.3, PAL.sleeper);
  }
  // overhead masts with cantilevers
  for (let x = 12; x < CIRCUMFERENCE; x += 42) {
    const s = B.at(x, 'solid');
    s.box(x - 0.14, x + 0.14, 0, 7.2, EAST_WALL_Z + 0.6, EAST_WALL_Z + 0.9, 0x7a7484);
    s.box(x - 0.06, x + 0.06, 6.4, 6.55, EAST_WALL_Z + 0.6, TRACK_UP_Z + 1.2, 0x7a7484);
    s.box(x - 0.04, x + 0.04, 5.6, 6.4, TRACK_UP_Z - 0.04, TRACK_UP_Z + 0.04, 0x7a7484);
    s.box(x - 0.04, x + 0.04, 5.6, 6.4, TRACK_DOWN_Z - 0.04, TRACK_DOWN_Z + 0.04, 0x7a7484);
  }

  // platforms (road side for the UP line, far side for the DOWN line)
  for (let x = pa; x < pb; x += 3) {
    const s = B.at(x, 'solid');
    const x1 = Math.min(pb, x + 3);
    s.box(x, x1, 0, PLATFORM.h, PLATFORM.z0 + 0.45, PLATFORM.z1, PAL.platform);
    s.box(x, x1, 0, PLATFORM.h + 0.01, PLATFORM.z0, PLATFORM.z0 + 0.45, PAL.platformEdge);
    s.box(x, x1, 0, PLATFORM.h, EAST_WALL_Z + 0.1, TRACK_DOWN_Z - 1.75, PAL.platform);
    s.box(x, x1, 0, PLATFORM.h + 0.01, TRACK_DOWN_Z - 2.2, TRACK_DOWN_Z - 1.75, PAL.platformEdge);
  }
  terrain.addBox(pa, pb, PLATFORM.z0, PLATFORM.z1, true);
  // steps up from the footpath
  for (const xs of [st.x - 22, st.x + 22]) {
    for (let i = 0; i < 3; i++) {
      B.at(xs, 'solid').box(xs - 2, xs + 2, 0, FOOTPATH_H + (PLATFORM.h - FOOTPATH_H) * ((i + 1) / 4), PLATFORM.z1 + 0.35 * (2 - i), PLATFORM.z1 + 0.35 * (3 - i), PAL.concrete);
    }
  }
  // shelters
  for (const [z0, z1, cz] of [[PLATFORM.z0 + 0.4, PLATFORM.z1, (PLATFORM.z0 + PLATFORM.z1) / 2], [EAST_WALL_Z + 0.2, TRACK_DOWN_Z - 2.1, (EAST_WALL_Z + TRACK_DOWN_Z - 1.9) / 2]] as const) {
    for (let x = pa + 6; x < pb - 4; x += 8) B.at(x, 'solid').box(x - 0.13, x + 0.13, PLATFORM.h, 4.3, cz - 0.13, cz + 0.13, 0x3f7e86);
    for (let x = pa + 2; x < pb - 2; x += 4) B.at(x, 'solid').box(x, x + 4, 4.3, 4.45, z0, z1, 0xd7d2c8, { top: 0x9aa2a8, bottom: true });
  }
  void rng;
}

// ---------------------------------------------------------------------------------------------
// the taaki: an elevated municipal water tank on a ring of pillars

function buildTaaki(b: Batch, terrain: Terrain): void {
  const { x: tx, z: tz } = START.taaki;
  const ring = 3.6, pillarH = 15.2;
  const m = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    M4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)).clone();
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push([tx + Math.cos(a) * ring, tz + Math.sin(a) * ring]);
  }
  for (const [px, pz] of pts) {
    b.geometry(new THREE.CylinderGeometry(0.34, 0.38, pillarH, 10), m(px, pillarH / 2, pz), PAL.concrete);
    terrain.addCircle(px, pz, 0.45);
  }
  // bracing rings
  for (const y of [5, 10]) {
    for (let i = 0; i < 8; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % 8];
      const len = Math.hypot(bx - ax, bz - az);
      b.geometry(new THREE.BoxGeometry(len, 0.4, 0.34), m((ax + bx) / 2, y, (az + bz) / 2, 0, -Math.atan2(bz - az, bx - ax)), PAL.concreteDark);
    }
  }
  // central staircase shaft
  b.geometry(new THREE.CylinderGeometry(0.95, 0.95, pillarH, 14), m(tx, pillarH / 2, tz), PAL.concreteDark);
  terrain.addCircle(tx, tz, 1.1);
  // flared base, tank, painted band, roof
  b.geometry(new THREE.CylinderGeometry(5.3, 3.9, 1.5, 24), m(tx, pillarH + 0.75, tz), PAL.concrete);
  b.geometry(new THREE.CylinderGeometry(5.3, 5.3, 4.6, 28), m(tx, pillarH + 1.5 + 2.3, tz), PAL.tankPaint);
  b.geometry(new THREE.CylinderGeometry(5.36, 5.36, 0.55, 28), m(tx, pillarH + 5.2, tz), PAL.tankBand);
  b.geometry(new THREE.CylinderGeometry(5.36, 5.36, 0.25, 28), m(tx, pillarH + 2.1, tz), PAL.tankBand);
  b.geometry(new THREE.CylinderGeometry(0.9, 5.4, 1.3, 28), m(tx, pillarH + 6.75, tz), PAL.concreteDark);
  b.geometry(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 10), m(tx, pillarH + 7.6, tz), PAL.concrete);
  // ladder up the shaft
  for (const off of [-0.25, 0.25]) b.geometry(new THREE.BoxGeometry(0.05, pillarH + 1.5, 0.05), m(tx + off, (pillarH + 1.5) / 2, tz + 1.0), 0x5a5560);
  for (let y = 0.5; y < pillarH + 1.4; y += 0.45) b.geometry(new THREE.BoxGeometry(0.5, 0.04, 0.04), m(tx, y, tz + 1.0), 0x5a5560);
  // compound wall with a gate toward Road 3
  const h = 1.5, x0 = tx - 7, x1 = tx + 7, z0 = tz - 7, z1 = tz + 7;
  b.box(x0, x1, 0, h, z0, z0 + 0.25, PAL.compound, { top: PAL.compoundCap });
  b.box(x0, x1, 0, h, z1 - 0.25, z1, PAL.compound, { top: PAL.compoundCap });
  b.box(x0, x0 + 0.25, 0, h, z0, z1, PAL.compound, { top: PAL.compoundCap });
  b.box(x1 - 0.25, x1, 0, h, z0, tz - 1.8, PAL.compound, { top: PAL.compoundCap });
  b.box(x1 - 0.25, x1, 0, h, tz + 1.8, z1, PAL.compound, { top: PAL.compoundCap });
  b.box(x1 - 0.1, x1 + 0.05, 0, 1.3, tz - 1.8, tz + 1.8, 0x3f7e86); // green gate
  terrain.addBox(x0, x1, z0, z0 + 0.25);
  terrain.addBox(x0, x1, z1 - 0.25, z1);
  terrain.addBox(x0, x0 + 0.25, z0, z1);
  terrain.addBox(x1 - 0.25, x1, z0, tz - 1.8);
  terrain.addBox(x1 - 0.25, x1, tz + 1.8, z1);
}

// ---------------------------------------------------------------------------------------------
// buildings

interface BuildingOpts {
  /** which z face looks onto the street: -1 = low z side, +1 = high z side */
  front: -1 | 1;
  balconies?: boolean;
  shopfront?: boolean;
  tanks?: number;
  color?: number;
}

function building(B: ChunkedBatches, rng: Rng, x0: number, x1: number, z0: number, z1: number, h: number, o: BuildingOpts): void {
  const w = B.at(x0, 'walls'), s = B.at(x0, 'solid');
  const color = o.color ?? rng.pick(WALLS);
  const base = o.shopfront ? 3.4 : 0;
  if (o.shopfront) {
    // ground-floor shops: shutters, fascia boards and awnings on the street face
    s.box(x0, x1, 0, base, z0, z1, color, { top: PAL.roofSlab });
    const fz = o.front < 0 ? z0 : z1;
    const out = o.front;
    for (let x = x0 + 0.3; x < x1 - 1.5; x += 3.2) {
      const xe = Math.min(x1 - 0.3, x + 2.9);
      const accent = rng.pick(ACCENTS);
      s.box(x, xe, 0.15, 2.7, fz + out * 0.02, fz + out * 0.08, rng.chance(0.55) ? PAL.shutter : 0x3a3440); // shutter or open shop
      s.box(x, xe, 2.75, 3.3, fz + out * 0.02, fz + out * 0.14, accent); // fascia board
      // awning sloping out from the fascia
      const a0 = fz + out * 0.14, a1 = fz + out * 1.25;
      s.quad([x, 2.72, a0], [xe, 2.72, a0], [xe, 2.45, a1], [x, 2.45, a1], [0, 1, out * 0.3], rng.chance(0.5) ? accent : PAL.cream);
    }
  }
  w.box(x0, x1, base, h, z0, z1, color, { wallUV: true, top: PAL.roofSlab });
  // parapet
  const p = 0.18, ph = 0.9;
  s.box(x0, x1, h, h + ph, z0, z0 + p, PAL.parapet);
  s.box(x0, x1, h, h + ph, z1 - p, z1, PAL.parapet);
  s.box(x0, x0 + p, h, h + ph, z0, z1, PAL.parapet);
  s.box(x1 - p, x1, h, h + ph, z0, z1, PAL.parapet);
  // Sintex tanks on the roof
  for (let i = 0; i < (o.tanks ?? 0); i++) {
    const tx = x0 + 1.2 + rng.range(0, x1 - x0 - 2.4), tz = z0 + 1.2 + rng.range(0, z1 - z0 - 2.4);
    s.geometry(new THREE.CylinderGeometry(0.62, 0.66, 1.3, 10), M4.makeTranslation(tx, h + 0.65, tz), PAL.sintex);
    s.geometry(new THREE.CylinderGeometry(0.2, 0.62, 0.2, 10), M4.makeTranslation(tx, h + 1.4, tz), PAL.sintex);
  }
  // balconies with grills on the street face
  if (o.balconies) {
    const fz = o.front < 0 ? z0 : z1;
    const floors = Math.floor((h - base) / 3.1);
    const bw = (x1 - x0) * 0.62, bx0 = x0 + (x1 - x0 - bw) / 2;
    for (let f = 1; f < floors; f++) {
      const y = base + f * 3.1;
      const za = fz, zb = fz + o.front * 0.75;
      s.box(bx0, bx0 + bw, y - 0.12, y, Math.min(za, zb), Math.max(za, zb), PAL.parapet);
      s.box(bx0, bx0 + bw, y, y + 0.95, Math.min(zb, zb - o.front * 0.06), Math.max(zb, zb - o.front * 0.06), PAL.grill);
    }
  }
}

function buildFrontage(B: ChunkedBatches, rng: Rng, terrain: Terrain, zone: Zone, isFree: (a: number, b: number) => boolean): void {
  const xa = zone.x - zone.half, xb = zone.x + zone.half;
  const fz = FOOTPATH_OUT + 0.5; // frontage line
  const add = (x0: number, x1: number, z0: number, z1: number, h: number, o: BuildingOpts) => {
    building(B, rng, x0, x1, z0, z1, h, o);
    terrain.addBox(x0, x1, z0, z1);
  };

  switch (zone.kind) {
    case 'residential': {
      for (let x = xa; x < xb;) {
        const w = rng.range(15, 21);
        if (!isFree(x, x + w)) { x += 2; continue; }
        // society compound wall with a gate, tower set back behind it
        const gate = x + w / 2;
        const s = B.at(x, 'solid');
        s.box(x, gate - 2, 0, 1.5, fz, fz + 0.25, PAL.compound, { top: PAL.compoundCap });
        s.box(gate + 2, x + w, 0, 1.5, fz, fz + 0.25, PAL.compound, { top: PAL.compoundCap });
        terrain.addBox(x, gate - 2, fz, fz + 0.25);
        terrain.addBox(gate + 2, x + w, fz, fz + 0.25);
        const floors = rng.int(5, 8);
        add(x + 1.5, x + w - 1.5, fz + 4, fz + 4 + rng.range(10, 13), floors * 3.1 + 0.6, { front: -1, balconies: true, tanks: rng.int(2, 4) });
        x += w + rng.range(3, 6);
      }
      break;
    }
    case 'parks': {
      const s = B.at(xa, 'ground');
      for (let x = xa + 4; x < xb - 4; x += 3) s.rect(x, Math.min(xb - 4, x + 3), fz, 30, 0.04, PAL.grass);
      for (let x = xa + 4; x < xb - 4; x += 2.5) {
        if (Math.abs(x - zone.x) < 3) continue; // park gate
        B.at(x, 'solid').box(x, x + 0.08, 0, 1.0, fz, fz + 0.08, 0x3f7e86);
        B.at(x, 'solid').box(x, x + 2.5, 0.85, 0.95, fz, fz + 0.06, 0x3f7e86);
      }
      terrain.addBox(xa + 4, zone.x - 3, fz, fz + 0.1);
      terrain.addBox(zone.x + 3, xb - 4, fz, fz + 0.1);
      for (let i = 0; i < 12; i++) {
        const tx = rng.range(xa + 7, xb - 7), tz = rng.range(fz + 4, 28);
        tree(B, rng, terrain, tx, tz, rng.chance(0.6) ? 'gulmohar' : 'neem');
      }
      break;
    }
    case 'cinema': {
      add(zone.x - 26, zone.x + 26, fz + 3, fz + 26, 15, { front: -1, color: PAL.cream, tanks: 2 });
      const s = B.at(zone.x, 'solid');
      s.box(zone.x - 18, zone.x + 18, 4.2, 5.6, fz + 1.2, fz + 3, PAL.maroon); // marquee canopy
      s.box(zone.x - 14, zone.x + 14, 8, 11.5, fz + 2.9, fz + 3.05, PAL.marigold); // big sign board (text in M2)
      for (let x = xa; x < zone.x - 28;) { const w = rng.range(6, 9); add(x, x + w, fz, fz + 10, rng.pick([6.6, 9.7]), { front: -1, shopfront: true, tanks: 1 }); x += w + 0.4; }
      for (let x = zone.x + 28; x < xb - 5;) { const w = rng.range(6, 9); add(x, x + w, fz, fz + 10, rng.pick([6.6, 9.7]), { front: -1, shopfront: true, tanks: 1 }); x += w + 0.4; }
      break;
    }
    case 'junction': {
      // bank building west of the Link Road, petrol pump east of it
      add(xa + 2, 313, fz, fz + 14, 10, { front: -1, shopfront: true, color: 0xeef0f2, tanks: 2 });
      const s = B.at(340, 'solid');
      s.box(329, 352, 5.4, 6.1, fz + 2, fz + 12, 0xf4f4f0, { bottom: true, top: 0xd8d8d8 });
      s.box(329, 352, 5.4, 5.8, fz + 1.98, fz + 2.02, PAL.teal);
      for (const [cx, cz] of [[332, fz + 4], [349, fz + 4], [332, fz + 10], [349, fz + 10]]) {
        s.box(cx - 0.25, cx + 0.25, 0, 5.4, cz - 0.25, cz + 0.25, 0xe0e0e0);
        terrain.addCircle(cx, cz, 0.35);
      }
      for (const cx of [337, 344]) { s.box(cx - 0.5, cx + 0.5, 0, 1.9, fz + 6.3, fz + 7.7, 0xf2f2f2); terrain.addBox(cx - 0.5, cx + 0.5, fz + 6.3, fz + 7.7); }
      add(354, 368, fz + 6, fz + 16, 4, { front: -1, color: 0xf2f2ee });
      break;
    }
    case 'market': {
      for (let x = xa; x < xb;) {
        const w = rng.range(5, 8.5);
        if (!isFree(x, x + w)) { x += 1; continue; }
        add(x, x + w, fz, fz + rng.range(9, 12), rng.pick([6.6, 9.7, 9.7, 12.8]), { front: -1, shopfront: true, balconies: rng.chance(0.4), tanks: rng.int(1, 2) });
        x += w + rng.range(0, 0.5);
      }
      break;
    }
    case 'station': {
      // forecourt, then the booking-office building with arches
      B.at(zone.x, 'ground').rect(xa + 12, xb - 12, fz, fz + 10, 0.025, PAL.paver);
      add(zone.x - 20, zone.x + 20, fz + 10, fz + 20, 7.5, { front: -1, color: 0xe8dcc4, tanks: 1 });
      const s = B.at(zone.x, 'solid');
      for (let x = zone.x - 16; x <= zone.x + 16; x += 8) s.box(x - 1.6, x + 1.6, 0, 3.6, fz + 9.94, fz + 10.02, 0x3a3440);
      s.box(zone.x - 12, zone.x + 12, 5.2, 6.8, fz + 9.8, fz + 9.95, PAL.stationBoard);
      for (let x = xa; x < xa + 11;) { const w = rng.range(5, 7); add(x, x + w, fz, fz + 10, 6.6, { front: -1, shopfront: true }); x += w + 0.3; }
      for (let x = xb - 11; x < xb;) { const w = rng.range(5, 7); add(x, Math.min(xb, x + w), fz, fz + 10, 6.6, { front: -1, shopfront: true }); x += w + 0.3; }
      break;
    }
    case 'depot': {
      const gate = zone.x - 30;
      const s = B.at(zone.x, 'solid');
      s.box(xa, gate - 5, 0, 1.8, fz, fz + 0.25, PAL.compound, { top: PAL.compoundCap });
      s.box(gate + 5, xb, 0, 1.8, fz, fz + 0.25, PAL.compound, { top: PAL.compoundCap });
      terrain.addBox(xa, gate - 5, fz, fz + 0.25);
      terrain.addBox(gate + 5, xb, fz, fz + 0.25);
      B.at(zone.x, 'ground').rect(xa, xb, fz + 0.3, 40, 0.02, PAL.roadWorn);
      // long bus shed
      for (let x = zone.x - 40; x <= zone.x + 40; x += 10) {
        for (const z of [fz + 8, fz + 24]) { s.box(x - 0.2, x + 0.2, 0, 7, z - 0.2, z + 0.2, 0x8a8f96); terrain.addCircle(x, z, 0.3); }
      }
      for (let x = zone.x - 42; x < zone.x + 42; x += 6) s.box(x, x + 6, 7, 7.3, fz + 6, fz + 26, 0xb9bec4, { bottom: true, top: 0x9aa2a8 });
      add(xb - 14, xb - 2, fz + 2, fz + 10, 6.6, { front: -1, color: 0xe7dfc9, tanks: 1 });
      break;
    }
    case 'lanes': {
      // dense chawls with narrow lanes running inland
      for (let x = xa; x < xb;) {
        const n = rng.int(2, 4);
        for (let i = 0; i < n && x < xb; i++) {
          const w = rng.range(6, 10);
          add(x, x + w, fz, fz + rng.range(8, 12), rng.pick([3.4, 6.6, 6.6, 9.7]), { front: -1, balconies: true, tanks: rng.int(0, 2), shopfront: rng.chance(0.3) });
          x += w;
        }
        x += 3; // lane
      }
      break;
    }
  }
}

function buildBackRows(B: ChunkedBatches, rng: Rng, terrain: Terrain, isFree: (a: number, b: number) => boolean): void {
  for (const [z0, z1, fMin, fMax, detail] of [[28, 42, 5, 10, true], [46, 60, 7, 14, false]] as const) {
    for (let x = 0; x < CIRCUMFERENCE;) {
      const w = rng.range(14, 24);
      const zone = ZONES.find((z) => Math.abs(z.x - (x + w / 2)) < z.half) ?? ZONES[0];
      const firstRow = z0 === 28;
      const skip = firstRow && (zone.kind === 'parks' || zone.kind === 'cinema' || zone.kind === 'depot');
      const inLink = x + w > 314 && x < 326;
      // the first row also keeps clear of Road 3 and the taaki compound
      if (skip || inLink || !isFree(x, x + w)) { x += 4; continue; }
      const depth = rng.range(10, z1 - z0);
      const h = rng.int(fMin, fMax) * 3.1 + 0.6;
      building(B, rng, x, x + w, z0, z0 + depth, h, { front: -1, balconies: detail, tanks: detail ? rng.int(1, 3) : 0 });
      terrain.addBox(x, x + w, z0, z0 + depth);
      x += w + rng.range(4, 8);
    }
  }
}

function buildEastSide(B: ChunkedBatches, rng: Rng): void {
  // Nalasopara East, across the tracks: a wall of towers facing the railway
  for (const [z1, depth, fMin, fMax] of [[EAST_WALL_Z - 2, 12, 4, 10], [EAST_WALL_Z - 20, 16, 8, 16]] as const) {
    for (let x = 0; x < CIRCUMFERENCE;) {
      const w = rng.range(14, 26);
      building(B, rng, x, x + w, z1 - depth, z1, rng.int(fMin, fMax) * 3.1 + 0.6, { front: 1, balconies: z1 > -30, tanks: rng.int(1, 3) });
      x += w + rng.range(3, 9);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// trees

type TreeKind = 'gulmohar' | 'neem' | 'coconut';

function tree(B: ChunkedBatches, rng: Rng, terrain: Terrain, x: number, z: number, kind: TreeKind, y0 = 0): void {
  const s = B.at(x, 'solid'), f = B.at(x, 'foliage');
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const mat = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    M4.compose(v.set(px, py, pz), q.setFromEuler(e.set(rx, ry, rz)), sc.set(sx, sy, sz));
  terrain.addCircle(x, z, 0.3);
  if (kind === 'coconut') {
    // curved trunk from a few leaning segments, then fronds
    let px = x, py = y0, pz = z;
    const lean = rng.range(-0.25, 0.25), segH = 2.2;
    for (let i = 0; i < 5; i++) {
      const tilt = lean * (i + 1) * 0.35;
      s.geometry(new THREE.CylinderGeometry(0.17, 0.2, segH, 7), mat(px, py + segH / 2, pz, 0, 0, tilt), PAL.trunk);
      px -= Math.sin(tilt) * segH;
      py += Math.cos(tilt) * segH;
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      f.geometry(new THREE.BoxGeometry(3.4, 0.05, 0.55), mat(px + Math.cos(a) * 1.5, py - 0.3, pz + Math.sin(a) * 1.5, 0, -a, -0.45), PAL.palm);
    }
    return;
  }
  const trunkH = kind === 'gulmohar' ? 3.2 : 3.6;
  s.geometry(new THREE.CylinderGeometry(0.2, 0.3, trunkH, 7), mat(x, y0 + trunkH / 2, z), PAL.trunk);
  const colors = kind === 'gulmohar' ? [PAL.gulmohar, PAL.gulmoharLight, PAL.gulmoharDeep, PAL.leafPale] : [PAL.leaf, PAL.leafDeep, PAL.leafPale];
  // gulmohar: a broad flat umbrella; neem: a rounder crown
  const n = kind === 'gulmohar' ? 7 : 5;
  const spread = kind === 'gulmohar' ? 2.6 : 1.8;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : rng.range(0.6, spread);
    const r = rng.range(1.3, 2.0);
    const sy = kind === 'gulmohar' ? 0.55 : 0.85;
    f.geometry(new THREE.IcosahedronGeometry(r, 0), mat(x + Math.cos(a) * d, y0 + trunkH + 0.9 + rng.range(0, 0.8), z + Math.sin(a) * d, rng.range(0, 3), rng.range(0, 3), 0, 1, sy, 1), rng.pick(colors));
  }
}

function buildStreetTrees(B: ChunkedBatches, rng: Rng, terrain: Terrain, isFree: (a: number, b: number) => boolean): void {
  for (let x = 4; x < CIRCUMFERENCE; x += rng.range(16, 28)) {
    const zone = ZONES.find((z) => Math.abs(z.x - x) < z.half || Math.abs(z.x + CIRCUMFERENCE - x) < z.half) ?? ZONES[0];
    if (zone.kind === 'station' || zone.kind === 'market') continue;
    if (!isFree(x - 2, x + 2)) continue;
    if (x < 30 || x > CIRCUMFERENCE - 10) continue; // keep the opening view of the Taaki clear
    const kind: TreeKind = rng.chance(0.55) ? 'gulmohar' : rng.chance(0.5) ? 'coconut' : 'neem';
    tree(B, rng, terrain, x, FOOTPATH_OUT - 0.5, kind, FOOTPATH_H);
  }
  // a few along the railway wall
  for (let x = 20; x < CIRCUMFERENCE; x += rng.range(40, 70)) {
    const zone = ZONES.find((z) => Math.abs(z.x - x) < z.half) ?? ZONES[0];
    if (zone.kind === 'station') continue;
    tree(B, rng, terrain, x, -FOOTPATH_OUT + 0.4, rng.chance(0.6) ? 'gulmohar' : 'neem', FOOTPATH_H);
  }
}
