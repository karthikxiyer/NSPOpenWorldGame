#!/usr/bin/env node
// Converts raw OSM data (data/raw/*.json.gz, fetched by scripts/fetch-osm.sh)
// into game assets under public/world/:
//   world.json          — projection, bounds, tile index, places, stations, spawn
//   ground.png          — RGBA landcover texture (alpha 0 = water/sea), 8 m per pixel
//   tiles/<tx>_<tz>.json — roads, buildings, rail and POIs for one 500 m tile
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { encodePNG } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = process.env.OSM_RAW ? path.resolve(process.env.OSM_RAW) : path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/world');
const TILE = 500; // metres
const PX = 8; // metres per ground-texture pixel

// ---------- projection ----------
const LAT0 = 19.418;
const LON0 = 72.815;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110574;
const proj = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const r1 = (v) => Math.round(v * 10) / 10;

function loadLayer(name) {
  const file = path.join(RAW, `${name}.json.gz`);
  if (!fs.existsSync(file)) {
    console.warn(`missing ${file}`);
    return [];
  }
  const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  return json.elements;
}

const meta = JSON.parse(fs.readFileSync(path.join(RAW, 'meta.json'), 'utf8'));
const [S, W, N, E] = meta.bbox;
const [minX, minZ] = proj(N, W);
const [maxX, maxZ] = proj(S, E);
const IW = Math.ceil((maxX - minX) / PX);
const IH = Math.ceil((maxZ - minZ) / PX);
console.log(`world ${Math.round(maxX - minX)} x ${Math.round(maxZ - minZ)} m, ground ${IW}x${IH}px`);

// ---------- geometry helpers ----------
const geomOf = (g) => g.map((p) => proj(p.lat, p.lon));

// Join way fragments (arrays of points) into rings by matching endpoints.
function joinRings(parts) {
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const pool = parts.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const end = key(ring[ring.length - 1]);
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

// Returns { outer: [ring...], inner: [ring...] } for a way or multipolygon relation.
function areaRings(el) {
  if (el.type === 'way' && el.geometry) {
    const g = geomOf(el.geometry);
    return { outer: [g], inner: [] };
  }
  if (el.type === 'relation' && el.members) {
    const outer = [];
    const inner = [];
    for (const m of el.members) {
      if (m.type !== 'way' || !m.geometry) continue;
      (m.role === 'inner' ? inner : outer).push(geomOf(m.geometry));
    }
    return { outer: joinRings(outer), inner: joinRings(inner) };
  }
  return { outer: [], inner: [] };
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

function centroid(r) {
  let x = 0, z = 0;
  const n = r.length - (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? 1 : 0);
  for (let i = 0; i < n; i++) { x += r[i][0]; z += r[i][1]; }
  return [x / n, z / n];
}

function hash(n) {
  // deterministic 0..1 from an integer id
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- raster ----------
const rgba = new Uint8ClampedArray(IW * IH * 4);
const BASE = [196, 178, 140]; // dusty ground
for (let i = 0; i < IW * IH; i++) rgba.set([...BASE, 255], i * 4);

const toPx = (x, z) => [(x - minX) / PX - 0.5, (z - minZ) / PX - 0.5];

// Even-odd scanline fill of a set of rings (outer + inner together) at pixel centres.
function fillRings(rings, fn) {
  const edges = [];
  let y0 = Infinity, y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = toPx(...r[i]);
      const b = toPx(...r[i + 1]);
      if (a[1] === b[1]) continue;
      edges.push([a, b]);
      y0 = Math.min(y0, a[1], b[1]);
      y1 = Math.max(y1, a[1], b[1]);
    }
    // close ring if needed
    const a = toPx(...r[r.length - 1]);
    const b = toPx(...r[0]);
    if (a[1] !== b[1] && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) edges.push([a, b]);
  }
  const ys = Math.max(0, Math.ceil(y0));
  const ye = Math.min(IH - 1, Math.floor(y1));
  for (let y = ys; y <= ye; y++) {
    const xs = [];
    for (const [a, b] of edges) {
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(IW - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) fn(y * IW + x);
    }
  }
}

// Thick polyline in pixel space.
function strokeLine(pts, widthM, fn) {
  const rad = Math.max(0.5, widthM / PX / 2);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = toPx(...pts[i]);
    const [bx, by] = toPx(...pts[i + 1]);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad));
    const x1 = Math.min(IW - 1, Math.ceil(Math.max(ax, bx) + rad));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad));
    const y1 = Math.min(IH - 1, Math.ceil(Math.max(ay, by) + rad));
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= rad * rad) fn(y * IW + x);
      }
    }
  }
}

const paint = (c, a = 255) => (i) => {
  const o = i * 4;
  // tiny per-pixel variation so large areas don't look flat
  const v = ((i * 2654435761) >>> 24) / 255 - 0.5;
  rgba[o] = c[0] + v * 10; rgba[o + 1] = c[1] + v * 10; rgba[o + 2] = c[2] + v * 8; rgba[o + 3] = a;
};

// Landcover colours
const LAND = {
  residential: [206, 190, 160],
  commercial: [200, 180, 165],
  retail: [200, 180, 165],
  industrial: [180, 172, 160],
  farmland: [150, 170, 95],
  meadow: [140, 170, 90],
  grass: [120, 165, 80],
  orchard: [95, 145, 70],
  forest: [60, 110, 55],
  wood: [60, 110, 55],
  scrub: [120, 140, 80],
  wetland: [90, 120, 90],
  mangrove: [48, 92, 62],
  sand: [226, 206, 160],
  beach: [232, 214, 168],
  park: [110, 170, 85],
  playground: [170, 170, 110],
  pitch: [100, 160, 80],
  cemetery: [150, 160, 120],
  parking: [150, 150, 150],
  salt_pond: [190, 200, 205],
  railway: [150, 135, 120],
  quarry: [175, 160, 140],
  bare_rock: [150, 140, 130],
  village_green: [120, 165, 80],
  construction: [185, 165, 130],
  brownfield: [180, 165, 135],
  greenfield: [140, 165, 95],
  plant_nursery: [100, 150, 80],
};

function landKind(t) {
  if (t.natural === 'wetland' && t.wetland === 'mangrove') return 'mangrove';
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.natural === 'bay' || t.leisure === 'swimming_pool') return 'water';
  if (t.landuse === 'salt_pond') return 'salt_pond';
  if (t.natural === 'beach' || t.leisure === 'beach_resort') return 'beach';
  if (t.natural && LAND[t.natural]) return t.natural;
  if (t.landuse && LAND[t.landuse]) return t.landuse;
  if (t.leisure && LAND[t.leisure]) return t.leisure;
  if (t.amenity === 'parking') return 'parking';
  return null;
}

// Paint order: low priority first
const PRIORITY = ['residential', 'commercial', 'retail', 'industrial', 'railway', 'construction', 'brownfield', 'greenfield',
  'farmland', 'meadow', 'orchard', 'plant_nursery', 'scrub', 'forest', 'wood', 'wetland', 'mangrove', 'salt_pond', 'cemetery',
  'quarry', 'bare_rock', 'grass', 'village_green', 'park', 'playground', 'pitch', 'parking', 'sand', 'beach', 'water'];

const landEls = loadLayer('landuse');
const areasByKind = new Map();
const coast = [];
const waterways = [];
for (const el of landEls) {
  const t = el.tags || {};
  if (t.natural === 'coastline' && el.geometry) { coast.push(geomOf(el.geometry)); continue; }
  if (t.waterway && el.type === 'way' && el.geometry && t.waterway !== 'riverbank') { waterways.push(el); continue; }
  const k = landKind(t);
  if (!k) continue;
  if (!areasByKind.has(k)) areasByKind.set(k, []);
  areasByKind.get(k).push(el);
}

for (const k of PRIORITY) {
  const list = areasByKind.get(k) || [];
  for (const el of list) {
    const { outer, inner } = areaRings(el);
    if (!outer.length) continue;
    const closed = outer.every((r) => r.length > 3);
    if (!closed) continue;
    fillRings([...outer, ...inner], k === 'water' ? paint([70, 110, 120], 0) : paint(LAND[k]));
  }
}

// Rivers, streams, nalas
const WW = { river: 24, canal: 10, stream: 4, drain: 3, ditch: 2 };
for (const el of waterways) {
  const w = WW[el.tags.waterway];
  if (!w) continue;
  strokeLine(geomOf(el.geometry), w, w >= 10 ? paint([70, 110, 120], 0) : paint([95, 120, 110]));
}

// ---------- sea from coastline ----------
{
  const barrier = new Uint8Array(IW * IH);
  const seeds = [];
  for (const line of coast) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = toPx(...line[i]);
      const [bx, by] = toPx(...line[i + 1]);
      // Bresenham (8-connected) barrier — a 4-connected fill cannot cross it
      let x0 = Math.round(ax), y0 = Math.round(ay);
      const x1 = Math.round(bx), y1 = Math.round(by);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        if (x0 >= 0 && y0 >= 0 && x0 < IW && y0 < IH) barrier[y0 * IW + x0] = 1;
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
      // OSM coastline: land on the left, water on the right (in lat/lon). Our z axis points south,
      // so in pixel space (x east, y south) "right of travel" is (-dy, dx) rotated: n = (-(by-ay), (bx-ax)).
      const len = Math.hypot(bx - ax, by - ay);
      if (len > 0) {
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        const mx = (ax + bx) / 2 + nx * 2.5, my = (ay + by) / 2 + ny * 2.5;
        seeds.push([Math.round(mx), Math.round(my)]);
      }
    }
  }
  const sea = new Uint8Array(IW * IH);
  const stack = [];
  for (const [x, y] of seeds) {
    if (x < 0 || y < 0 || x >= IW || y >= IH) continue;
    const i = y * IW + x;
    if (!barrier[i] && !sea[i]) { sea[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % IW, y = (i - x) / IW;
    const nb = [x > 0 ? i - 1 : -1, x < IW - 1 ? i + 1 : -1, y > 0 ? i - IW : -1, y < IH - 1 ? i + IW : -1];
    for (const j of nb) if (j >= 0 && !barrier[j] && !sea[j]) { sea[j] = 1; stack.push(j); }
  }
  let n = 0;
  for (let i = 0; i < IW * IH; i++) n += sea[i];
  if (n / (IW * IH) > 0.6) {
    // The fill leaked through a gap in the coastline. Fall back to: on each row, everything west
    // of the westernmost coastline pixel is sea (the Vasai-Virar coast faces west).
    console.warn(`sea fill leaked (${(n / (IW * IH) * 100).toFixed(0)}%), using west-of-coast fallback`);
    sea.fill(0);
    for (let y = 0; y < IH; y++) {
      let x0 = -1;
      for (let x = 0; x < IW; x++) if (barrier[y * IW + x]) { x0 = x; break; }
      for (let x = 0; x < x0; x++) sea[y * IW + x] = 1;
    }
  }
  n = 0;
  for (let i = 0; i < IW * IH; i++) if (sea[i]) { n++; rgba[i * 4 + 3] = 0; rgba[i * 4] = 60; rgba[i * 4 + 1] = 105; rgba[i * 4 + 2] = 120; }
  console.log(`coastline ways: ${coast.length}, sea fraction ${(n / (IW * IH) * 100).toFixed(1)}%`);
}

// ---------- roads ----------
const ROAD = {
  motorway: [16, 1], trunk: [14, 1], primary: [11, 2], secondary: [9, 3], tertiary: [7.5, 4],
  motorway_link: [7, 1], trunk_link: [7, 1], primary_link: [7, 2], secondary_link: [6, 3], tertiary_link: [6, 4],
  unclassified: [5.5, 5], residential: [5.5, 5], living_street: [4.5, 5], service: [4, 6], track: [3.5, 7],
  pedestrian: [5, 8], footway: [2, 9], path: [1.8, 9], cycleway: [2, 9], steps: [2, 9],
};
// class ids used by the client: 1 highway, 2 primary, 3 secondary, 4 tertiary, 5 local, 6 service, 7 track, 8 pedestrian, 9 path
const tiles = new Map();
const tileKey = (x, z) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
const getTile = (k) => {
  if (!tiles.has(k)) tiles.set(k, { roads: [], buildings: [], rail: [], pois: [] });
  return tiles.get(k);
};

// Break long straight segments so no single triangle spans a huge distance
// (large triangles clip badly on some GPUs) and every piece lands in the right tile.
function densify(pts, maxLen = 40) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / maxLen);
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

// Split a polyline into runs, one per tile (by segment midpoint).
function splitByTile(pts) {
  pts = densify(pts);
  const runs = [];
  let cur = null, curKey = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const k = tileKey((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    if (k !== curKey) {
      cur = { k, pts: [a] };
      runs.push(cur);
      curKey = k;
    }
    cur.pts.push(b);
  }
  return runs;
}
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);

let roadCount = 0;
for (const el of loadLayer('roads')) {
  const t = el.tags || {};
  const spec = ROAD[t.highway];
  if (!spec || !el.geometry) continue;
  const pts = geomOf(el.geometry);
  let w = spec[0];
  if (t.lanes && !isNaN(+t.lanes)) w = Math.max(w, Math.min(+t.lanes * 3.3, 24));
  const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
  if (spec[1] <= 4) strokeLine(pts, Math.max(w, PX), paint([118, 116, 112]));
  else if (bridge) strokeLine(pts, w, paint([120, 118, 114]));
  for (const run of splitByTile(pts)) {
    const r = { c: spec[1], w, p: flat(run.pts) };
    if (bridge) r.b = 1;
    if (t.oneway === 'yes') r.o = 1;
    if (t.name) r.n = t.name;
    getTile(run.k).roads.push(r);
  }
  roadCount++;
}
console.log(`roads: ${roadCount}`);

// ---------- rail ----------
const stations = [];
for (const el of loadLayer('rail')) {
  const t = el.tags || {};
  if (el.type === 'node' && t.railway === 'station') {
    const [x, z] = proj(el.lat, el.lon);
    stations.push({ n: t['name:en'] || t.name || 'Station', mr: t['name:mr'] || undefined, x: r1(x), z: r1(z) });
    continue;
  }
  if (el.type !== 'way' || !el.geometry) continue;
  if (!['rail', 'light_rail', 'subway', 'narrow_gauge'].includes(t.railway)) {
    if (t.railway === 'platform') {
      // platforms are drawn as areas in the ground texture
      const g = geomOf(el.geometry);
      if (g.length > 3) fillRings([g], paint([175, 170, 160]));
    }
    continue;
  }
  const pts = geomOf(el.geometry);
  strokeLine(pts, 6, paint([128, 112, 98]));
  for (const run of splitByTile(pts)) getTile(run.k).rail.push({ p: flat(run.pts), b: t.bridge && t.bridge !== 'no' ? 1 : undefined });
}
console.log(`stations: ${stations.map((s) => s.n).join(', ')}`);

// ---------- buildings ----------
const PASTEL = [
  [236, 228, 208], [240, 220, 180], [214, 226, 232], [236, 210, 206], [222, 232, 214],
  [246, 238, 222], [230, 200, 160], [210, 214, 222], [242, 226, 196], [200, 220, 214],
  [232, 186, 150], [250, 250, 244],
];
function buildingHeight(t, area, id) {
  if (t.height && !isNaN(parseFloat(t.height))) return Math.min(120, parseFloat(t.height));
  if (t['building:levels'] && !isNaN(parseFloat(t['building:levels']))) return Math.min(40, parseFloat(t['building:levels'])) * 3.2 + 0.8;
  const h = hash(id);
  const b = t.building;
  if (['hut', 'shed', 'roof', 'garage', 'garages', 'kiosk', 'cabin', 'toilets', 'service', 'carport'].includes(b)) return 3 + h * 1.5;
  if (['house', 'detached', 'bungalow', 'farm', 'semidetached_house'].includes(b)) return 3.5 + Math.floor(h * 2.2) * 3.2;
  if (['industrial', 'warehouse', 'factory'].includes(b)) return 7 + h * 5;
  if (['church', 'temple', 'mosque', 'cathedral', 'chapel', 'religious'].includes(b)) return 9 + h * 6;
  if (['apartments', 'residential', 'dormitory'].includes(b)) return (4 + Math.floor(h * 4 + Math.min(area / 400, 4))) * 3.2 + 0.8;
  if (['commercial', 'retail', 'office', 'hotel', 'hospital', 'school', 'college'].includes(b)) return (2 + Math.floor(h * 3 + Math.min(area / 500, 3))) * 3.2 + 0.8;
  // generic "yes": small footprints are 1-3 floor houses/shops, larger ones are chawls/apartment blocks
  if (area < 60) return 3.2 + Math.floor(h * 2) * 3.2;
  if (area < 200) return 3.2 * (1 + Math.floor(h * 3)) + 0.5;
  return (3 + Math.floor(h * 4 + Math.min(area / 500, 3))) * 3.2 + 0.8;
}

let bCount = 0;
for (const el of loadLayer('buildings')) {
  const t = el.tags || {};
  const { outer } = areaRings(el);
  for (let ring of outer) {
    if (ring.length < 4) continue;
    // drop closing point, enforce CCW (in x/z space) for consistent wall normals
    if (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
    const area = ringArea(ring);
    if (Math.abs(area) < 6) continue;
    if (area < 0) ring = ring.slice().reverse();
    const c = centroid(ring);
    const h = buildingHeight(t, Math.abs(area), el.id);
    const b = { h: r1(h), c: Math.floor(hash(el.id * 7 + 3) * PASTEL.length), p: flat(ring) };
    if (t.name) b.n = t.name;
    const kind = t.building;
    if (['church', 'temple', 'mosque', 'chapel', 'cathedral', 'religious'].includes(kind) || t.amenity === 'place_of_worship') b.k = 'worship';
    getTile(tileKey(c[0], c[1])).buildings.push(b);
    bCount++;
  }
}
console.log(`buildings: ${bCount}`);

// ---------- POIs ----------
function poiKind(t) {
  if (t.historic) return 'historic';
  if (t.tourism) return 'tourism';
  if (t.amenity === 'place_of_worship') return 'worship';
  if (t.shop) return 'shop';
  if (['restaurant', 'cafe', 'fast_food', 'food_court', 'bar', 'pub', 'ice_cream'].includes(t.amenity)) return 'food';
  if (['hospital', 'clinic', 'pharmacy', 'doctors', 'dentist'].includes(t.amenity)) return 'health';
  if (['school', 'college', 'university', 'kindergarten'].includes(t.amenity)) return 'education';
  if (['bank', 'atm'].includes(t.amenity)) return 'bank';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.leisure === 'park') return 'park';
  if (t.natural === 'beach' || t.leisure === 'beach_resort') return 'beach';
  if (t.natural === 'peak') return 'peak';
  if (t.amenity) return 'amenity';
  if (t.office || t.craft) return 'office';
  return null;
}
let pCount = 0;
for (const el of loadLayer('pois')) {
  const t = el.tags || {};
  const k = poiKind(t);
  if (!k) continue;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null) continue;
  const name = t['name:en'] || t.name;
  if (!name && !['beach', 'peak', 'worship', 'historic'].includes(k)) continue;
  const [x, z] = proj(lat, lon);
  const p = { k, x: r1(x), z: r1(z) };
  if (name) p.n = name;
  if (t['name:mr']) p.mr = t['name:mr'];
  const sub = t.shop || t.amenity || t.tourism || t.historic || t.leisure || t.natural;
  if (sub) p.t = sub;
  if (t.religion) p.r = t.religion;
  getTile(tileKey(x, z)).pois.push(p);
  pCount++;
}
console.log(`pois: ${pCount}`);

// ---------- places ----------
const places = [];
for (const el of loadLayer('places')) {
  const t = el.tags || {};
  if (!t.name || !['suburb', 'neighbourhood', 'village', 'town', 'hamlet', 'quarter', 'city', 'locality'].includes(t.place)) continue;
  const [x, z] = proj(el.lat, el.lon);
  places.push({ n: t['name:en'] || t.name, mr: t['name:mr'], t: t.place, x: r1(x), z: r1(z) });
}
console.log(`places: ${places.length}`);

// ---------- write ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'tiles'), { recursive: true });

const index = [];
let bytes = 0;
for (const [k, t] of tiles) {
  if (!t.roads.length && !t.buildings.length && !t.rail.length && !t.pois.length) continue;
  const s = JSON.stringify(t);
  bytes += s.length;
  fs.writeFileSync(path.join(OUT, 'tiles', `${k}.json`), s);
  index.push(k);
}
const png = encodePNG(IW, IH, rgba);
fs.writeFileSync(path.join(OUT, 'ground.png'), png);

const byName = (re) => stations.find((s) => re.test(s.n));
const nsp = byName(/nala ?sopara/i) || stations[0] || { x: 0, z: 0 };
const world = {
  origin: { lat: LAT0, lon: LON0 },
  scale: { kx: KX, kz: KZ },
  bounds: { minX: r1(minX), minZ: r1(minZ), maxX: r1(maxX), maxZ: r1(maxZ) },
  tileSize: TILE,
  ground: { w: IW, h: IH, px: PX },
  tiles: index,
  stations,
  places,
  spawn: { x: nsp.x, z: nsp.z, near: nsp.n },
  attribution: '© OpenStreetMap contributors (ODbL)',
  fetchedAt: meta.fetched_at,
};
fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify(world));
console.log(`tiles: ${index.length}, ${(bytes / 1e6).toFixed(1)} MB json, ground.png ${(png.length / 1e6).toFixed(2)} MB`);
