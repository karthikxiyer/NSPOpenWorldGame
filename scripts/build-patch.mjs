#!/usr/bin/env node
// Cuts a real 1:1 patch of Nallasopara West out of the raw OSM data (data/raw) and writes:
//   public/patch/patch.json — roads, buildings, rail, platforms, trees, labels, the tank and spawn
//   public/patch/ground.png — landcover texture, 2 m per pixel (alpha 0 = water)
//
// Coordinates: metres from the start point (the 3rd Road Taaki), x east, z south.
// The patch wraps around in play, so a ring road is drawn centred on its edges: crossing an edge
// always lands you on the same road on the other side. No buildings are kept near the edges.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { encodePNG } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/patch');

// start point = the tank at the end of 3rd Road
const LAT0 = 19.42335, LON0 = 72.808602;
// Shriprastha (west) to Nalla Sopara station, the ST Depot and a strip of the East side
const BBOX = { S: 19.4145, W: 72.799, N: 19.4285, E: 72.8215 };
const PX = 2; // metres per ground pixel
const EDGE_CLEAR = 9; // no buildings this close to an edge (the ring road is there)

const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110574;
const proj = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const r1 = (v) => Math.round(v * 10) / 10;

const [minX, minZ] = proj(BBOX.N, BBOX.W);
const [maxX, maxZ] = proj(BBOX.S, BBOX.E);
const IW = Math.ceil((maxX - minX) / PX), IH = Math.ceil((maxZ - minZ) / PX);
console.log(`patch ${Math.round(maxX - minX)} x ${Math.round(maxZ - minZ)} m, ground ${IW}x${IH}px`);

const load = (name) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, `${name}.json.gz`))).toString()).elements;
const geomOf = (g) => g.map((p) => proj(p.lat, p.lon));
const inside = ([x, z], m = 0) => x > minX + m && x < maxX - m && z > minZ + m && z < maxZ - m;

function hash(n) {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
let seed = 12345;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function joinRings(parts) {
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const pool = parts.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings = [];
  while (pool.length) {
    let ring = pool.shift(), grew = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i], end = key(ring[ring.length - 1]);
        if (key(p[0]) === end) ring = ring.concat(p.slice(1));
        else if (key(p[p.length - 1]) === end) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function areaRings(el) {
  if (el.type === 'way' && el.geometry) return { outer: [geomOf(el.geometry)], inner: [] };
  if (el.type === 'relation' && el.members) {
    const outer = [], inner = [];
    for (const m of el.members) if (m.type === 'way' && m.geometry) (m.role === 'inner' ? inner : outer).push(geomOf(m.geometry));
    return { outer: joinRings(outer), inner: joinRings(inner) };
  }
  return { outer: [], inner: [] };
}

const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
const centroid = (r) => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
function pointInRing(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > z !== r[j][1] > z && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}

// Liang-Barsky clip of a polyline to the patch rectangle; returns the runs that are inside.
function clipLine(pts) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    let [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dz = z1 - z0;
    const p = [-dx, dx, -dz, dz], q = [x0 - minX, maxX - x0, z0 - minZ, maxZ - z0];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { ok = false; break; } continue; }
      const t = q[k] / p[k];
      if (p[k] < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { cur = null; continue; }
    const a = [x0 + dx * t0, z0 + dz * t0], b = [x0 + dx * t1, z0 + dz * t1];
    if (!cur || t0 > 0) { cur = [a]; runs.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return runs.filter((r) => r.length >= 2);
}

function densify(pts, maxLen) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxLen));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

// ---------------------------------------------------------------- ground raster
const rgba = new Uint8ClampedArray(IW * IH * 4);
const BASE = [212, 184, 142];
for (let i = 0; i < IW * IH; i++) rgba.set([...BASE, 255], i * 4);
const toPx = (x, z) => [(x - minX) / PX - 0.5, (z - minZ) / PX - 0.5];

function fillRings(rings, fn) {
  const edges = [];
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = toPx(...r[i]), b = toPx(...r[(i + 1) % r.length]);
      if (a[1] === b[1]) continue;
      edges.push([a, b]);
      y0 = Math.min(y0, a[1], b[1]);
      y1 = Math.max(y1, a[1], b[1]);
    }
  }
  for (let y = Math.max(0, Math.ceil(y0)); y <= Math.min(IH - 1, Math.floor(y1)); y++) {
    const xs = [];
    for (const [a, b] of edges) if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(IW - 1, Math.floor(xs[k + 1])); x++) fn(y * IW + x);
  }
}

function strokeLine(pts, widthM, fn) {
  const rad = Math.max(0.5, widthM / PX / 2);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = toPx(...pts[i]), [bx, by] = toPx(...pts[i + 1]);
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by) - rad)); y <= Math.min(IH - 1, Math.ceil(Math.max(ay, by) + rad)); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - rad)); x <= Math.min(IW - 1, Math.ceil(Math.max(ax, bx) + rad)); x++) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= rad * rad) fn(y * IW + x);
      }
    }
  }
}

const paint = (c, a = 255) => (i) => {
  const v = ((i * 2654435761) >>> 24) / 255 - 0.5;
  rgba.set([c[0] + v * 12, c[1] + v * 12, c[2] + v * 9, a], i * 4);
};

const LAND = {
  residential: [214, 190, 152], commercial: [206, 184, 160], retail: [206, 184, 160], industrial: [188, 176, 158],
  farmland: [158, 176, 100], meadow: [146, 176, 96], grass: [126, 170, 86], orchard: [100, 150, 74], forest: [66, 116, 60],
  wood: [66, 116, 60], scrub: [126, 146, 84], wetland: [96, 126, 94], mangrove: [52, 96, 66], sand: [226, 206, 160],
  park: [118, 174, 90], garden: [118, 174, 90], playground: [182, 168, 118], pitch: [108, 164, 86], cemetery: [152, 164, 124],
  parking: [170, 160, 150], railway: [168, 150, 132], construction: [196, 172, 134], brownfield: [190, 170, 138],
  greenfield: [146, 170, 98], village_green: [126, 170, 86], common: [150, 170, 104],
};
function landKind(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.leisure === 'swimming_pool') return 'water';
  if (t.natural === 'wetland' && t.wetland === 'mangrove') return 'mangrove';
  for (const k of [t.natural, t.landuse, t.leisure]) if (k && LAND[k]) return k;
  if (t.amenity === 'parking') return 'parking';
  return null;
}
const PRIORITY = ['residential', 'commercial', 'retail', 'industrial', 'railway', 'construction', 'brownfield', 'greenfield', 'farmland', 'meadow',
  'orchard', 'scrub', 'forest', 'wood', 'wetland', 'mangrove', 'cemetery', 'common', 'grass', 'village_green', 'park', 'garden', 'playground', 'pitch', 'parking', 'sand', 'water'];

const byKind = new Map();
const parks = [];
for (const el of load('landuse')) {
  const t = el.tags || {};
  const k = landKind(t);
  if (!k) continue;
  const { outer, inner } = areaRings(el);
  if (!outer.length || !outer.some((r) => r.some((p) => inside(p, -200)))) continue;
  if (!byKind.has(k)) byKind.set(k, []);
  byKind.get(k).push([...outer, ...inner]);
  if (['park', 'garden', 'playground', 'common', 'village_green', 'grass'].includes(k)) for (const r of outer) parks.push({ r, name: t.name });
}
// water keeps its colour but alpha 254 marks it for the collision mask
for (const k of PRIORITY) for (const rings of byKind.get(k) || []) fillRings(rings, k === 'water' ? paint([96, 150, 160], 254) : paint(LAND[k]));

// ---------------------------------------------------------------- roads
const ROAD = {
  motorway: [16, 1], trunk: [14, 1], primary: [11, 2], secondary: [9, 3], tertiary: [7.5, 4],
  primary_link: [7, 2], secondary_link: [6, 3], tertiary_link: [6, 4], unclassified: [5.5, 5], residential: [5.5, 5],
  living_street: [4.5, 5], service: [4, 6], track: [3.5, 7], pedestrian: [5, 8], footway: [2, 9], path: [1.8, 9], steps: [2, 9],
};
const roads = [];
const roadSegs = []; // for tree and tank placement
for (const el of load('roads')) {
  const t = el.tags || {};
  const spec = ROAD[t.highway];
  if (!spec || !el.geometry) continue;
  let w = spec[0];
  if (t.lanes && !isNaN(+t.lanes)) w = Math.max(w, Math.min(+t.lanes * 3.3, 24));
  for (const run of clipLine(geomOf(el.geometry))) {
    const pts = densify(run, 8);
    const r = { c: spec[1], w, p: flat(pts) };
    if (t.name) r.n = t.name;
    if (t.oneway === 'yes' || t.junction === 'roundabout') r.o = 1;
    if (t.bridge && t.bridge !== 'no') r.b = 1;
    roads.push(r);
    if (spec[1] <= 7) {
      strokeLine(pts, w + 2, paint([190, 176, 160])); // road verge / dust
      for (let i = 0; i < pts.length - 1; i++) roadSegs.push({ a: pts[i], b: pts[i + 1], w, c: spec[1], n: t.name });
    }
  }
}
// the ring road on the patch edges: only the north and west edges (the wrap supplies the other two)
const RING_W = 9;
for (const pts of [[[minX, minZ], [maxX, minZ]], [[minX, minZ], [minX, maxZ]]]) {
  roads.push({ c: 3, w: RING_W, p: flat(densify(pts, 8)), n: 'Ring Road', ring: 1 });
}
for (const pts of [[[minX, minZ], [maxX, minZ]], [[minX, maxZ], [maxX, maxZ]], [[minX, minZ], [minX, maxZ]], [[maxX, minZ], [maxX, maxZ]]]) {
  const d = densify(pts, 8);
  strokeLine(d, RING_W + 2, paint([190, 176, 160]));
  for (let i = 0; i < d.length - 1; i++) roadSegs.push({ a: d[i], b: d[i + 1], w: RING_W, c: 3, n: 'Ring Road' });
}
console.log(`roads: ${roads.length}`);

// ---------------------------------------------------------------- rail
const rail = [], platforms = [], stations = [];
const platformRings = [], railLines = [];
for (const el of load('rail')) {
  const t = el.tags || {};
  if (el.type === 'node' && t.railway === 'station') {
    const p = proj(el.lat, el.lon);
    if (inside(p, -300)) stations.push({ n: t['name:en'] || t.name, mr: t['name:mr'], x: r1(p[0]), z: r1(p[1]) });
    continue;
  }
  if (el.type !== 'way' || !el.geometry) continue;
  if (t.railway === 'platform') {
    const g = geomOf(el.geometry);
    if (g.length > 3 && g.every((p) => inside(p, 2))) {
      const ring = g[0][0] === g.at(-1)[0] && g[0][1] === g.at(-1)[1] ? g.slice(0, -1) : g;
      platforms.push({ p: flat(ringArea(ring) < 0 ? ring.reverse() : ring) });
      platformRings.push(ring);
      fillRings([ring], paint([196, 188, 176]));
    }
    continue;
  }
  if (!['rail', 'light_rail'].includes(t.railway)) continue;
  for (const run of clipLine(geomOf(el.geometry))) {
    const pts = densify(run, 8);
    strokeLine(pts, 5, paint([140, 126, 118]));
    rail.push({ p: flat(pts), m: !t.service ? 1 : undefined });
    railLines.push(pts);
  }
}
console.log(`rail runs: ${rail.length}, platforms: ${platforms.length}, stations: ${stations.map((s) => s.n)}`);

// ---------------------------------------------------------------- buildings
const PASTEL_COUNT = 10;
function height(t, area, id) {
  if (t.height && !isNaN(parseFloat(t.height))) return Math.min(90, parseFloat(t.height));
  if (t['building:levels'] && !isNaN(parseFloat(t['building:levels']))) return Math.min(30, parseFloat(t['building:levels'])) * 3.1 + 0.8;
  const h = hash(id), b = t.building;
  if (['hut', 'shed', 'roof', 'garage', 'garages', 'kiosk', 'cabin', 'toilets', 'service', 'carport'].includes(b)) return 3 + h * 1.4;
  if (['house', 'detached', 'bungalow', 'semidetached_house'].includes(b)) return 3.4 + Math.floor(h * 2.4) * 3.1;
  if (['industrial', 'warehouse', 'factory'].includes(b)) return 7 + h * 4;
  if (['church', 'temple', 'mosque', 'chapel', 'religious'].includes(b)) return 8 + h * 5;
  if (['apartments', 'residential', 'dormitory'].includes(b)) return (4 + Math.floor(h * 4 + Math.min(area / 400, 3))) * 3.1 + 0.8;
  if (['commercial', 'retail', 'office', 'hotel', 'hospital', 'school', 'college'].includes(b)) return (2 + Math.floor(h * 3 + Math.min(area / 500, 3))) * 3.1 + 0.8;
  if (area < 60) return 3.1 + Math.floor(h * 2) * 3.1;
  if (area < 200) return 3.1 * (1 + Math.floor(h * 3)) + 0.5;
  return (3 + Math.floor(h * 4 + Math.min(area / 500, 3))) * 3.1 + 0.8;
}
const buildings = [];
const bGrid = new Map(); // 20 m grid of building records { r: ring, h, n?, t: tags }, for placement
const bRecs = [];
const cell = (x, z) => `${Math.floor(x / 20)},${Math.floor(z / 20)}`;
for (const el of load('buildings')) {
  const t = el.tags || {};
  for (let ring of areaRings(el).outer) {
    if (ring.length < 4) continue;
    if (ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1);
    if (!ring.every((p) => inside(p, EDGE_CLEAR))) continue;
    const area = ringArea(ring);
    if (Math.abs(area) < 6) continue;
    if (area < 0) ring = ring.slice().reverse();
    const b = { h: r1(height(t, Math.abs(area), el.id)), c: Math.floor(hash(el.id * 7 + 3) * PASTEL_COUNT), p: flat(ring) };
    if (t.name) b.n = t.name;
    if (t.amenity === 'place_of_worship' || ['temple', 'church', 'mosque', 'religious'].includes(t.building)) b.k = 'worship';
    buildings.push(b);
    const rec = { r: ring, h: b.h, n: t.name, t };
    bRecs.push(rec);
    addToGrid(rec);
  }
}
function addToGrid(rec) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of rec.r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let cx = Math.floor(x0 / 20); cx <= Math.floor(x1 / 20); cx++) for (let cz = Math.floor(z0 / 20); cz <= Math.floor(z1 / 20); cz++) {
    const k = `${cx},${cz}`;
    if (!bGrid.has(k)) bGrid.set(k, []);
    bGrid.get(k).push(rec);
  }
}
const inBuilding = (x, z, pad = 0) => {
  for (const [dx, dz] of pad ? [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]] : [[0, 0]]) {
    for (const { r } of bGrid.get(cell(x + dx, z + dz)) || []) if (pointInRing(r, x + dx, z + dz)) return true;
  }
  return false;
};
console.log(`buildings: ${buildings.length}`);

// ---------------------------------------------------------------- distance to roads
const segGrid = new Map();
for (const s of roadSegs) {
  for (let cx = Math.floor(Math.min(s.a[0], s.b[0]) / 20) - 1; cx <= Math.floor(Math.max(s.a[0], s.b[0]) / 20) + 1; cx++)
    for (let cz = Math.floor(Math.min(s.a[1], s.b[1]) / 20) - 1; cz <= Math.floor(Math.max(s.a[1], s.b[1]) / 20) + 1; cz++) {
      const k = `${cx},${cz}`;
      if (!segGrid.has(k)) segGrid.set(k, []);
      segGrid.get(k).push(s);
    }
}
function nearestRoad(x, z) {
  let best = null, bd = Infinity;
  for (const s of segGrid.get(cell(x, z)) || []) {
    const ex = s.b[0] - s.a[0], ez = s.b[1] - s.a[1], l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - s.a[0]) * ex + (z - s.a[1]) * ez) / l2));
    const px = s.a[0] + ex * t, pz = s.a[1] + ez * t, d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; const l = Math.sqrt(l2); best = { d, px, pz, dx: ex / l, dz: ez / l, s }; }
  }
  return best;
}
const clearOfRoads = (x, z, pad) => { const r = nearestRoad(x, z); return !r || r.d > r.s.w / 2 + pad; };

// ---------------------------------------------------------------- real places (milestone 2)
// Signboards from OSM names, Station Road shopfronts, the station building and footbridges'
// stairs, and the ST Depot bus stand. All placement is done here; the game only draws it.
const pois = load('pois');
const railDist = (x, z) => {
  let d = Infinity;
  for (const pts of railLines) for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    if (Math.min(ax, bx) - d > x || Math.max(ax, bx) + d < x || Math.min(az, bz) - d > z || Math.max(az, bz) + d < z) continue;
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return d;
};
/** true if a road (ignoring classes >= ignoreFrom) comes within its half-width + pad of the point */
function onRoad(x, z, pad, ignoreFrom = 99) {
  for (const s of segGrid.get(cell(x, z)) || []) {
    if (s.c >= ignoreFrom) continue;
    const ex = s.b[0] - s.a[0], ez = s.b[1] - s.a[1], l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - s.a[0]) * ex + (z - s.a[1]) * ez) / l2));
    if (Math.hypot(s.a[0] + ex * t - x, s.a[1] + ez * t - z) < s.w / 2 + pad) return true;
  }
  return false;
}
const yawOf = (nx, nz) => +Math.atan2(nx, nz).toFixed(3); // an object's +z turned to face (nx, nz)
/** a w (along a) by d (along the normal) rectangle centred on c */
function rect(cx, cz, ax, az, w, d) {
  const nx = -az, nz = ax;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + ax * u * w / 2 + nx * v * d / 2, cz + az * u * w / 2 + nz * v * d / 2]);
}
/** sample a rectangle every ~3 m: clear of buildings, roads, rail, platforms and the edges? */
function rectClear(cx, cz, ax, az, w, d, { pad = 1, rail = 4, ignoreFrom = 99 } = {}) {
  const nx = -az, nz = ax;
  const nu = Math.max(2, Math.ceil(w / 3)), nv = Math.max(2, Math.ceil(d / 3));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = (i / nu - 0.5) * (w + pad * 2), v = (j / nv - 0.5) * (d + pad * 2);
    const x = cx + ax * u + nx * v, z = cz + az * u + nz * v;
    if (!inside([x, z], EDGE_CLEAR) || inBuilding(x, z) || onRoad(x, z, 0, ignoreFrom) || railDist(x, z) < rail) return false;
    if (platformRings.some((r) => pointInRing(r, x, z))) return false;
  }
  return true;
}
/** claim a rectangle so later placement (and trees) keep out of it */
function claim(ring, h) { addToGrid({ r: ring, h, t: {} }); }
function axisOf(ring) {
  const [cx, cz] = centroid(ring);
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of ring) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ax = Math.cos(ang), az = Math.sin(ang);
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of ring) { const t = (x - cx) * ax + (z - cz) * az; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  return { cx: cx + ax * (lo + hi) / 2, cz: cz + az * (lo + hi) / 2, ax, az, len: hi - lo };
}
/** each wall of a building ring with its outward normal */
function walls(r) {
  const out = [];
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    let nx = (bz - az) / len, nz = -(bx - ax) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (pointInRing(r, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; }
    out.push({ i, a: [ax, az], b: [bx, bz], len, nx, nz, mx, mz });
  }
  return out;
}
/** how well a wall faces a street: distance from the wall to the kerb, or Infinity */
function streetGap(w, maxGap = 14) {
  const q = nearestRoad(w.mx + w.nx * 2, w.mz + w.nz * 2);
  if (!q) return { gap: Infinity };
  const dx = q.px - w.mx, dz = q.pz - w.mz, d = Math.hypot(dx, dz) || 1;
  const facing = (dx * w.nx + dz * w.nz) / d;
  const gap = d - q.s.w / 2;
  if (facing < 0.6 || gap > maxGap || gap < 0.5 || inBuilding(w.mx + w.nx * 1.2, w.mz + w.nz * 1.2)) return { gap: Infinity };
  return { gap, road: q.s };
}

// ---- signboards on buildings, from OSM names
function signKind(t) {
  if (['hospital', 'clinic', 'dentist', 'doctors', 'pharmacy'].includes(t.amenity) || t.healthcare || t.shop === 'medical_supply' || t.shop === 'chemist') return 'health';
  if (t.amenity === 'bank' || t.amenity === 'atm') return 'bank';
  if (t.amenity === 'place_of_worship' || ['temple', 'church', 'mosque'].includes(t.building)) return 'worship';
  if (t.amenity === 'cinema') return 'cinema';
  if (['school', 'college', 'university', 'kindergarten'].includes(t.amenity)) return 'school';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.shop || t.office || ['restaurant', 'food_court', 'fast_food', 'cafe', 'bar'].includes(t.amenity)) return 'shop';
  return null;
}
const SUB = {
  hospital: 'हॉस्पिटल', clinic: 'क्लिनिक', dentist: 'डेंटल क्लिनिक', pharmacy: 'मेडिकल', medical_supply: 'मेडिकल',
  bank: 'बँक', cinema: 'सिनेमा', school: 'शाळा', college: 'महाविद्यालय', supermarket: 'सुपरमार्केट', bakery: 'बेकरी',
  jewelry: 'ज्वेलर्स', stationery: 'स्टेशनरी', dairy: 'डेअरी', restaurant: 'रेस्टॉरंट', food_court: 'फूड सेंटर',
  hairdresser: 'सलून', beauty: 'ब्युटी पार्लर', mobile_phone: 'मोबाईल', greengrocer: 'भाजी', clothes: 'कपडे', alcohol: 'वाईन शॉप',
  appliance: 'इलेक्ट्रॉनिक्स', spices: 'मसाले', variety_store: 'नॉव्हेल्टी', convenience: 'स्टोअर', bar: 'बार', park: 'उद्यान', fuel: 'पेट्रोल पंप',
};
const signs = [];
const signedWalls = new Set(); // "building#wall" keys that already carry a sign: shopfronts skip them
const byWall = new Map();
const mappedFronts = []; // shopfronts under mapped shops' boards (sign id < 0: no board of their own)
const recsNear = (x, z) => [...new Set([...(bGrid.get(cell(x, z)) || []), ...(bGrid.get(cell(x + 12, z)) || []), ...(bGrid.get(cell(x - 12, z)) || []), ...(bGrid.get(cell(x, z + 12)) || []), ...(bGrid.get(cell(x, z - 12)) || [])])];
function ringDist(r, x, z) {
  if (pointInRing(r, x, z)) return 0;
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return d;
}
const sources = [];
for (const el of pois) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || !t.name || t.amenity === 'bus_station') continue;
  const kind = signKind(t);
  if (!kind) continue;
  const p = proj(lat, lon);
  if (!inside(p, EDGE_CLEAR)) continue;
  sources.push({ n: t['name:en'] || t.name, mr: t['name:en'] ? t.name : t['name:mr'], kind, t, x: p[0], z: p[1], area: el.type !== 'node' });
}
for (const rec of bRecs) {
  if (!rec.n) continue;
  const kind = signKind(rec.t) ?? 'society';
  const [x, z] = centroid(rec.r);
  if (sources.some((s) => s.n === rec.n)) continue;
  sources.push({ n: rec.n, mr: rec.t['name:mr'], kind, t: rec.t, x, z, rec });
}
let posted = 0;
for (const s of sources) {
  const sub = s.mr && s.mr !== s.n ? s.mr : SUB[s.t.amenity] ?? SUB[s.t.shop] ?? SUB[s.t.leisure] ?? (s.kind === 'health' ? 'हॉस्पिटल' : undefined);
  // parks, the petrol pump and other open areas get a board on posts at the kerb
  let rec = s.rec;
  if (!rec && !s.area) {
    let bd = 14;
    for (const r of recsNear(s.x, s.z)) { const d = ringDist(r.r, s.x, s.z); if (d < bd) { bd = d; rec = r; } }
  }
  if (!rec) {
    const q = nearestRoad(s.x, s.z);
    if (!q || q.d > 120) continue;
    const dx = s.x - q.px, dz = s.z - q.pz, d = Math.hypot(dx, dz) || 1, off = q.s.w / 2 + 1.6;
    const x = q.px + (dx / d) * off, z = q.pz + (dz / d) * off;
    if (inBuilding(x, z, 1.2) || !clearOfRoads(x, z, 0.8) || !inside([x, z], EDGE_CLEAR)) continue;
    if (signs.some((o) => o.post && Math.hypot(o.x - x, o.z - z) < 6)) continue;
    signs.push({ k: s.kind, n: s.n, s: sub, x: r1(x), z: r1(z), y: 1.7, yaw: yawOf(-dx / d, -dz / d), w: 3, post: 1 });
    posted++;
    continue;
  }
  // the wall that faces the street best (society names go on the street side too)
  const ws = walls(rec.r);
  let best = null, bg = Infinity;
  for (const w of ws) {
    if (w.len < 2.4) continue;
    const { gap } = streetGap(w, 40);
    const score = gap + Math.hypot(w.mx - s.x, w.mz - s.z) * 0.15;
    if (score < bg) { bg = score; best = w; }
  }
  if (!best) best = ws.reduce((a, b) => (b.len > a.len ? b : a), ws[0]);
  if (!best) continue;
  const key = `${bRecs.indexOf(rec)}#${best.i}`;
  if (!byWall.has(key)) byWall.set(key, { w: best, rec, list: [] });
  byWall.get(key).list.push({ ...s, sub });
}
for (const [key, { w, rec, list }] of byWall) {
  signedWalls.add(key);
  // spread several signs along one wall, in order along it
  const ux = (w.b[0] - w.a[0]) / w.len, uz = (w.b[1] - w.a[1]) / w.len;
  list.sort((p, q) => (p.x - w.a[0]) * ux + (p.z - w.a[1]) * uz - ((q.x - w.a[0]) * ux + (q.z - w.a[1]) * uz));
  const slot = w.len / list.length;
  list.forEach((s, i) => {
    const t = (i + 0.5) * slot;
    const society = s.kind === 'society';
    const width = Math.max(1.6, Math.min(society ? 7 : 4.2, slot - 0.3));
    const hgt = width / 4;
    // society names high on the facade; shops, clinics and banks above the ground floor
    const y = society ? Math.max(2.9, rec.h - hgt / 2 - 0.5) : Math.min(rec.h - hgt / 2 - 0.2, s.kind === 'health' || s.kind === 'bank' ? 3.9 : 3.3);
    if (y < hgt / 2 + 1.8) return;
    // mapped shops, clinics and banks open onto the street under their board
    if (['shop', 'health', 'bank'].includes(s.kind) && streetGap(w, 20).gap < Infinity && rec.h >= 4.2) {
      mappedFronts.push(r1(w.a[0] + ux * t), r1(w.a[1] + uz * t), yawOf(w.nx, w.nz), r1(Math.min(slot - 0.1, 4.4)), -1 - (signs.length % 96), 1);
    }
    signs.push({ k: s.kind, n: s.n, s: s.sub, x: r1(w.a[0] + ux * t + w.nx * 0.02), z: r1(w.a[1] + uz * t + w.nz * 0.02), y: r1(y), yaw: yawOf(w.nx, w.nz), w: r1(width) });
  });
}
console.log(`signs from OSM names: ${signs.length} (${posted} on posts)`);

// ---- Station Road shopfronts: every ground floor facing the bazaar streets is a row of shops
const SHOP_ROADS = new Set(['Station Road', 'ST Depot Road', 'Nallasopara Station Road', 'Depot Road', 'Nalasopara Flyover', 'Vasant Nagari Road', 'Zero Road']);
const shops = [...mappedFronts]; // flat: x, z, yaw, width, sign id (-1 - n: under a mapped sign), open
let sid = 0;
for (let bi = 0; bi < bRecs.length; bi++) {
  const rec = bRecs[bi];
  if (rec.h < 4.2 || rec.t.amenity === 'place_of_worship') continue;
  for (const w of walls(rec.r)) {
    if (w.len < 3 || signedWalls.has(`${bi}#${w.i}`)) continue;
    const { gap, road } = streetGap(w, 9);
    if (!road || !SHOP_ROADS.has(road.n)) continue;
    const k = Math.max(1, Math.floor(w.len / 3.4)), bw = w.len / k;
    if (bw < 2.6) continue;
    for (let i = 0; i < k; i++) {
      const t = (i + 0.5) / k;
      const x = w.a[0] + (w.b[0] - w.a[0]) * t, z = w.a[1] + (w.b[1] - w.a[1]) * t;
      const h = hash(Math.round(x * 7) * 131 + Math.round(z * 7));
      shops.push(r1(x), r1(z), yawOf(w.nx, w.nz), r1(bw), Math.floor(h * 1e4) % 96, hash(sid++ * 17 + 5) < 0.7 ? 1 : 0);
    }
  }
}
console.log(`shopfronts: ${shops.length / 6}`);

// ---- street name boards near the ends of named streets
const seenStreet = [];
for (const r of roads) {
  if (!r.n || r.ring || r.c > 5 || r.b) continue;
  const n = r.p.length / 2;
  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(r.p[i * 2] - r.p[i * 2 - 2], r.p[i * 2 + 1] - r.p[i * 2 - 1]);
  if (len < 50) continue;
  for (const end of [0, n - 1]) {
    const nb = end === 0 ? 1 : n - 2;
    const ex = r.p[end * 2], ez = r.p[end * 2 + 1];
    let dx = r.p[nb * 2] - ex, dz = r.p[nb * 2 + 1] - ez;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl; // into the street
    const along = Math.min(10, dl), side = r.w / 2 + 1.3;
    const x = ex + dx * along - dz * side, z = ez + dz * along + dx * side;
    if (seenStreet.some((o) => o.n === r.n && Math.hypot(o.x - x, o.z - z) < 150)) continue;
    if (!inside([x, z], EDGE_CLEAR) || inBuilding(x, z, 1) || !clearOfRoads(x, z, 0.5)) continue;
    seenStreet.push({ n: r.n, x, z });
    // the board stands across the pavement, readable from the junction
    signs.push({ k: 'street', n: r.n, x: r1(x), z: r1(z), y: 2.2, yaw: yawOf(-dx, -dz), w: 2.4, post: 1 });
  }
}
console.log(`street boards: ${seenStreet.length}`);

// ---- solids the game collides with (station building, depot sheds, parked buses)
const solids = [];
const solid = (ring, h) => { solids.push({ p: flat(ring), h }); claim(ring, h); };

// ---- the station: a booking office on the Depot Road side of the platforms, platform numbers
let station = null;
const st = stations[0];
if (st && platformRings.length) {
  const axes = platformRings.map(axisOf);
  // number platforms west to east (Nalla Sopara's platform 1 is on the West side)
  const order = axes.map((a, i) => i).sort((i, j) => axes[i].cx - axes[j].cx);
  const near = axes.slice().sort((p, q) => Math.hypot(p.cx - st.x, p.cz - st.z) - Math.hypot(q.cx - st.x, q.cz - st.z))[0];
  // the side of the tracks Depot Road arrives from
  const q = nearestRoad(st.x - 30, st.z);
  const ax = near.ax, az = near.az;
  let nx = -az, nz = ax;
  if (q && (q.px - near.cx) * nx + (q.pz - near.cz) * nz < 0) { nx = -nx; nz = -nz; }
  const W = 26, D = 10;
  let best = null;
  for (let off = 6; off <= 70 && !best; off += 2) {
    for (const al of [0, -8, 8, -16, 16, -26, 26]) {
      const cx = st.x + nx * off + ax * al, cz = st.z + nz * off + az * al;
      if (rectClear(cx, cz, ax, az, W, D, { pad: 1.5, rail: 3.5 })) { best = { cx, cz }; break; }
    }
  }
  if (best) {
    station = { x: r1(best.cx), z: r1(best.cz), yaw: yawOf(nx, nz), w: W, d: D, h: 6.5 };
    solid(rect(best.cx, best.cz, ax, az, W, D), 6.5);
    console.log(`station building at ${station.x},${station.z}`);
  }
  // platform number boards hang from each platform roof, near both ends
  for (let k = 0; k < order.length; k++) {
    const a = axes[order[k]];
    for (const t of [-0.28, 0.28]) {
      signs.push({ k: 'platform', n: String(k + 1), x: r1(a.cx + a.ax * a.len * t), z: r1(a.cz + a.az * a.len * t), y: 3.55, yaw: yawOf(a.ax, a.az), w: 1.6, hang: 1 });
    }
  }
}

// ---- the ST Depot: a bus stand beside Depot Road and the MSRTC yard behind it
let depot = null;
const busStop = pois.find((e) => e.tags?.amenity === 'bus_station' && e.center && inside(proj(e.center.lat, e.center.lon), 50));
if (busStop) {
  const [bx, bz] = proj(busStop.center.lat, busStop.center.lon);
  // the street the stand opens onto (not the yard's service lanes)
  let q = null;
  for (const sg of roadSegs) {
    if (sg.c > 5) continue;
    const ex = sg.b[0] - sg.a[0], ez = sg.b[1] - sg.a[1], l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((bx - sg.a[0]) * ex + (bz - sg.a[1]) * ez) / l2));
    const px = sg.a[0] + ex * t, pz = sg.a[1] + ez * t, d = Math.hypot(px - bx, pz - bz), l = Math.sqrt(l2);
    if (!q || d < q.d) q = { d, px, pz, dx: ex / l, dz: ez / l, s: sg };
  }
  let ax = q.dx, az = q.dz;
  if (ax < 0) { ax = -ax; az = -az; }
  let nx = -az, nz = ax; // away from the road, into the stand
  if ((bx - q.px) * nx + (bz - q.pz) * nz < 0) { nx = -nx; nz = -nz; }
  const W = 38, D = 7;
  let canopy = null;
  for (let off = 10; off <= 40 && !canopy; off += 2) {
    for (const al of [0, -6, 6, -12, 12, -20, 20]) {
      const cx = q.px + nx * off + ax * al, cz = q.pz + nz * off + az * al;
      // the stand needs room for the canopy and a row of buses behind it
      const bayX = cx + nx * (D / 2 + 7), bayZ = cz + nz * (D / 2 + 7);
      if (rectClear(cx, cz, ax, az, W, D, { pad: 1 }) && rectClear(bayX, bayZ, ax, az, W - 4, 12, { pad: 0.5 })) { canopy = { cx, cz }; break; }
    }
  }
  if (canopy) {
    const buses = [];
    // buses nose-in to the platform, every 4.6 m
    for (let u = -W / 2 + 4; u <= W / 2 - 4; u += 4.6) {
      if (hash(Math.round(u * 10) + 77) < 0.25) continue; // an empty bay here and there
      const x = canopy.cx + ax * u + nx * (D / 2 + 7.2), z = canopy.cz + az * u + nz * (D / 2 + 7.2);
      buses.push([r1(x), r1(z), yawOf(-nx, -nz)]);
      solid(rect(x, z, nx, nz, 11, 2.6), 3.2);
    }
    // the yard (landuse=industrial, name=Depot): an apron, a workshop shed and parked buses
    const yard = [...byKind.get('industrial') || []].map((r) => r[0]).find((r) => r && pointInRing(r, canopy.cx + nx * 60, canopy.cz + nz * 60))
      ?? [...byKind.get('industrial') || []].map((r) => r[0]).sort((p, q2) => Math.hypot(...centroid(p).map((v, i) => v - [bx, bz][i])) - Math.hypot(...centroid(q2).map((v, i) => v - [bx, bz][i])))[0];
    let shed = null;
    const apron = [rect(canopy.cx + nx * 8, canopy.cz + nz * 8, ax, az, W + 10, D + 26)];
    if (yard && Math.hypot(...centroid(yard).map((v, i) => v - [bx, bz][i])) < 200) {
      apron.push(yard);
      const ya = axisOf(yard);
      for (let tries = 0; tries < 40 && !shed; tries++) {
        const u = (hash(tries * 3 + 1) - 0.5) * ya.len * 0.6, v = (hash(tries * 3 + 2) - 0.5) * 60;
        const cx = ya.cx + ya.ax * u - ya.az * v, cz = ya.cz + ya.az * u + ya.ax * v;
        if (pointInRing(yard, cx, cz) && rectClear(cx, cz, ya.ax, ya.az, 26, 14, { pad: 1, ignoreFrom: 6 })) shed = { x: r1(cx), z: r1(cz), yaw: yawOf(-ya.az, ya.ax), w: 26, d: 14, h: 7 };
      }
      if (shed) solid(rect(shed.x, shed.z, ya.ax, ya.az, shed.w, shed.d), shed.h);
      // a row or two of buses parked in the yard
      let parked = 0;
      for (let v = -40; v <= 40 && parked < 9; v += 14) for (let u = -40; u <= 40 && parked < 9; u += 4.2) {
        const cx = ya.cx + ya.ax * u - ya.az * v, cz = ya.cz + ya.az * u + ya.ax * v;
        if (!pointInRing(yard, cx, cz) || !rectClear(cx, cz, -ya.az, ya.ax, 11, 2.6, { pad: 0.6, ignoreFrom: 6 })) continue;
        buses.push([r1(cx), r1(cz), yawOf(-ya.az, ya.ax)]);
        solid(rect(cx, cz, -ya.az, ya.ax, 11, 2.6), 3.2);
        parked++;
      }
    }
    for (const r of apron) fillRings([r], paint([160, 154, 156]));
    // the stand's board at the kerb of Depot Road
    const bxk = q.px + nx * (q.s.w / 2 + 2) + ax * (W / 2 - 3), bzk = q.pz + nz * (q.s.w / 2 + 2) + az * (W / 2 - 3);
    signs.push({ k: 'depot', n: 'Nalasopara ST Depot', s: 'नालासोपारा आगार', x: r1(bxk), z: r1(bzk), y: 2.4, yaw: yawOf(-nx, -nz), w: 5, post: 1 });
    depot = { x: r1(canopy.cx), z: r1(canopy.cz), yaw: yawOf(nx, nz), w: W, d: D, buses, shed };
    const cring = rect(canopy.cx, canopy.cz, ax, az, W, D);
    claim(cring, 4);
    console.log(`ST Depot stand at ${depot.x},${depot.z}: ${buses.length} buses${shed ? ', workshop shed' : ''}`);
  }
}

// ---------------------------------------------------------------- trees
const trees = [];
const kinds = () => { const r = rand(); return r < 0.5 ? 0 : r < 0.8 ? 1 : 2; }; // 0 gulmohar, 1 neem, 2 coconut
for (const s of roadSegs) {
  if (s.c > 5 || s.n === 'Ring Road') continue;
  const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  if (rand() > len / 26) continue;
  const t = rand(), nx = -(s.b[1] - s.a[1]) / len, nz = (s.b[0] - s.a[0]) / len, side = rand() < 0.5 ? 1 : -1;
  const x = s.a[0] + (s.b[0] - s.a[0]) * t + nx * (s.w / 2 + 1.8) * side, z = s.a[1] + (s.b[1] - s.a[1]) * t + nz * (s.w / 2 + 1.8) * side;
  if (!inside([x, z], EDGE_CLEAR) || inBuilding(x, z, 1.6) || !clearOfRoads(x, z, 1.2)) continue;
  if (trees.some((q) => Math.abs(q[0] - x) < 6 && Math.abs(q[1] - z) < 6)) continue;
  trees.push([r1(x), r1(z), kinds()]);
}
for (const { r } of parks) {
  const a = Math.abs(ringArea(r));
  const n = Math.min(40, Math.floor(a / 160));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
    const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
    if (!pointInRing(r, x, z) || !inside([x, z], EDGE_CLEAR) || inBuilding(x, z, 1.5) || !clearOfRoads(x, z, 1)) continue;
    trees.push([r1(x), r1(z), rand() < 0.55 ? 0 : 1]);
    i++;
  }
}
console.log(`trees: ${trees.length}`);

// ---------------------------------------------------------------- the tank at the start, and the spawn
const road0 = nearestRoad(0, 0);
let tank = { x: 0, z: 0, yaw: 0 };
let spawn = { x: 0, z: 0, heading: 0 };
if (road0) {
  const nx = -road0.dz, nz = road0.dx;
  // stand the tank just off the carriageway, on whichever side is clear of buildings
  const off = road0.s.w / 2 + 2.4;
  const sides = [1, -1].map((s) => ({ s, x: road0.px + nx * off * s, z: road0.pz + nz * off * s }));
  const pick = sides.find((q) => !inBuilding(q.x, q.z, 1.6) && clearOfRoads(q.x, q.z, 1.4)) ?? sides.find((q) => !inBuilding(q.x, q.z, 1.2)) ?? sides[0];
  tank = { x: r1(pick.x), z: r1(pick.z), yaw: +Math.atan2(-nx * pick.s, -nz * pick.s).toFixed(3) };
  // the bike waits on the road beside it, parked on the left edge, facing along the road
  const heading = Math.atan2(-road0.dx, -road0.dz);
  spawn = { x: r1(road0.px + nx * pick.s * (road0.s.w / 2 - 1.1)), z: r1(road0.pz + nz * pick.s * (road0.s.w / 2 - 1.1)), heading: +heading.toFixed(3), side: pick.s };
  console.log(`tank at ${tank.x},${tank.z} beside ${road0.s.n ?? 'road'} (${road0.d.toFixed(1)} m from the start point)`);
}

// ---------------------------------------------------------------- labels for the HUD
const labels = [{ n: '3rd Road Taaki', x: 0, z: 0, r: 90 }];
for (const s of stations) labels.push({ n: `${s.n} Station`, mr: s.mr, x: s.x, z: s.z, r: 160 });
for (const el of pois) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || !t.name) continue;
  const p = proj(lat, lon);
  if (!inside(p)) continue;
  if (t.amenity === 'bus_station') labels.push({ n: 'ST Depot', mr: 'एस.टी. डेपो', x: r1(p[0]), z: r1(p[1]), r: 140 });
  else if (t.amenity === 'cinema' || t.leisure === 'park') labels.push({ n: t['name:en'] || t.name, x: r1(p[0]), z: r1(p[1]), r: 70 });
}
// the signboards double as landmarks: walk past a shop or clinic and the HUD names it
for (const s of signs) {
  if (s.k === 'street' || s.k === 'platform' || s.k === 'depot' || s.k === 'park') continue;
  labels.push({ n: s.n, x: s.x, z: s.z, r: s.k === 'shop' ? 10 : s.k === 'society' ? 16 : 24 });
}
const namedRoads = new Map();
for (const s of roadSegs) if (s.n && s.c <= 5) {
  const m = namedRoads.get(s.n) ?? { n: s.n, x: 0, z: 0, k: 0 };
  m.x += (s.a[0] + s.b[0]) / 2; m.z += (s.a[1] + s.b[1]) / 2; m.k++;
  namedRoads.set(s.n, m);
}
const roadLabels = [];
for (const s of roadSegs) if (s.n && s.c <= 5 && s.n !== 'Ring Road') roadLabels.push({ n: s.n, x: r1((s.a[0] + s.b[0]) / 2), z: r1((s.a[1] + s.b[1]) / 2) });
const places = [];
for (const el of load('places')) {
  const t = el.tags || {};
  if (!t.name) continue;
  const p = proj(el.lat, el.lon);
  if (inside(p, -600)) places.push({ n: t['name:en'] || t.name, mr: t['name:mr'], x: r1(p[0]), z: r1(p[1]) });
}
// sample road names sparsely (every ~40 m) so the HUD can say which street you're on
const roadNames = [];
for (const r of roadLabels) if (!roadNames.some((q) => q.n === r.n && Math.hypot(q.x - r.x, q.z - r.z) < 40)) roadNames.push(r);

// ---------------------------------------------------------------- write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'ground.png'), encodePNG(IW, IH, rgba));
const patch = {
  origin: { lat: LAT0, lon: LON0 }, scale: { kx: KX, kz: KZ },
  bounds: { minX: r1(minX), maxX: r1(maxX), minZ: r1(minZ), maxZ: r1(maxZ) },
  ground: { w: IW, h: IH, px: PX },
  roads, buildings, rail, platforms, trees, stations, places, labels, roadNames,
  tank, spawn,
  signs, shops, station, depot, solids,
  attribution: '© OpenStreetMap contributors (ODbL)',
};
const json = JSON.stringify(patch);
fs.writeFileSync(path.join(OUT, 'patch.json'), json);
console.log(`patch.json ${(json.length / 1e6).toFixed(2)} MB (${(zlib.gzipSync(json).length / 1e6).toFixed(2)} MB gz)`);
