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
      fillRings([ring], paint([196, 188, 176]));
    }
    continue;
  }
  if (!['rail', 'light_rail'].includes(t.railway)) continue;
  for (const run of clipLine(geomOf(el.geometry))) {
    const pts = densify(run, 8);
    strokeLine(pts, 5, paint([140, 126, 118]));
    rail.push({ p: flat(pts), m: !t.service ? 1 : undefined });
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
const bGrid = new Map(); // 20 m grid of building rings, for tree/tank placement
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
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let cx = Math.floor(x0 / 20); cx <= Math.floor(x1 / 20); cx++) for (let cz = Math.floor(z0 / 20); cz <= Math.floor(z1 / 20); cz++) {
      const k = `${cx},${cz}`;
      if (!bGrid.has(k)) bGrid.set(k, []);
      bGrid.get(k).push(ring);
    }
  }
}
const inBuilding = (x, z, pad = 0) => {
  for (const [dx, dz] of pad ? [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]] : [[0, 0]]) {
    for (const r of bGrid.get(cell(x + dx, z + dz)) || []) if (pointInRing(r, x + dx, z + dz)) return true;
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
for (const el of load('pois')) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || !t.name) continue;
  const p = proj(lat, lon);
  if (!inside(p)) continue;
  if (t.amenity === 'bus_station') labels.push({ n: 'ST Depot', mr: 'एस.टी. डेपो', x: r1(p[0]), z: r1(p[1]), r: 140 });
  else if (t.amenity === 'cinema' || t.leisure === 'park') labels.push({ n: t.name, x: r1(p[0]), z: r1(p[1]), r: 70 });
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
  attribution: '© OpenStreetMap contributors (ODbL)',
};
const json = JSON.stringify(patch);
fs.writeFileSync(path.join(OUT, 'patch.json'), json);
console.log(`patch.json ${(json.length / 1e6).toFixed(2)} MB (${(zlib.gzipSync(json).length / 1e6).toFixed(2)} MB gz)`);
