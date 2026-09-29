#!/usr/bin/env node
// Splits an `osmium export -f geojsonseq` file into the layer files read by build-tiles.mjs.
// Output elements use the Overpass "out geom" shape:
//   way:      { type: 'way', id, tags, geometry: [{lat, lon}, ...] }
//   relation: { type: 'relation', id, tags, members: [{ type: 'way', role, geometry }] }
//   node:     { type: 'node', id, tags, lat, lon }      (area POIs get their centroid)
// Usage: node osm-to-layers.mjs <in.geojsonseq> <out-dir> <south,west,north,east> [data-timestamp]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

const [input, outDir, bboxArg, stamp = 'unknown'] = process.argv.slice(2);
if (!input || !outDir || !bboxArg) {
  console.error('usage: osm-to-layers.mjs <in.geojsonseq> <out-dir> <s,w,n,e> [timestamp]');
  process.exit(1);
}
const bbox = bboxArg.split(',').map(Number);

const LAYERS = ['roads', 'buildings', 'landuse', 'rail', 'pois', 'places'];
const out = Object.fromEntries(LAYERS.map((l) => [l, new Map()]));

const pt = ([lon, lat]) => ({ lat: +lat.toFixed(7), lon: +lon.toFixed(7) });
const line = (coords) => coords.map(pt);

function centroid(coords) {
  let lat = 0, lon = 0;
  for (const [x, y] of coords) { lon += x; lat += y; }
  return { lat: lat / coords.length, lon: lon / coords.length };
}

/** All point sequences of a geometry (lines as-is, polygon rings). */
function polygonsOf(g) {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function asLineElement(type, id, tags, g) {
  if (g.type === 'LineString') return { type: 'way', id, tags, geometry: line(g.coordinates) };
  if (g.type === 'MultiLineString') return { type: 'relation', id, tags, members: g.coordinates.map((c) => ({ type: 'way', role: '', geometry: line(c) })) };
  if (g.type === 'Polygon') return { type: 'way', id, tags, geometry: line(g.coordinates[0]) };
  return null;
}

function asAreaElement(type, id, tags, g) {
  const polys = polygonsOf(g);
  if (!polys.length) return null;
  if (type === 'way' && polys.length === 1 && polys[0].length === 1) {
    return { type: 'way', id, tags, geometry: line(polys[0][0]) };
  }
  const members = [];
  for (const rings of polys) {
    rings.forEach((r, i) => members.push({ type: 'way', role: i === 0 ? 'outer' : 'inner', geometry: line(r) }));
  }
  return { type: 'relation', id, tags, members };
}

function asPointElement(type, id, tags, g) {
  if (g.type === 'Point') {
    const p = pt(g.coordinates);
    return { type: 'node', id, tags, lat: p.lat, lon: p.lon };
  }
  let coords = [];
  if (g.type === 'LineString') coords = g.coordinates;
  else if (g.type === 'Polygon') coords = g.coordinates[0];
  else if (g.type === 'MultiPolygon') coords = g.coordinates.flatMap((p) => p[0]);
  else if (g.type === 'MultiLineString') coords = g.coordinates.flat();
  if (!coords.length) return null;
  return { type, id, tags, center: centroid(coords) };
}

const isArea = (g) => g.type === 'Polygon' || g.type === 'MultiPolygon';
const isLine = (g) => g.type === 'LineString' || g.type === 'MultiLineString';

function add(layer, el) {
  if (!el) return;
  const key = `${el.type}/${el.id}`;
  // prefer area/line geometry over a duplicate of another shape
  if (!out[layer].has(key)) out[layer].set(key, el);
}

function classify(f) {
  const g = f.geometry;
  if (!g) return;
  const p = f.properties || {};
  const type = p['@type'];
  const id = p['@id'];
  const tags = {};
  for (const [k, v] of Object.entries(p)) if (!k.startsWith('@')) tags[k] = v;

  if (tags.highway && (isLine(g) || (g.type === 'Polygon' && tags.area !== 'yes'))) add('roads', asLineElement(type, id, tags, g));

  if (tags.building && isArea(g)) add('buildings', asAreaElement(type, id, tags, g));

  const landish = tags.natural || tags.landuse || tags.leisure || tags.waterway || tags.amenity === 'parking' || tags.man_made === 'pier' || tags.place === 'island' || tags.place === 'islet';
  if (landish && !tags.building) {
    if (isArea(g)) add('landuse', asAreaElement(type, id, tags, g));
    else if (isLine(g)) add('landuse', asLineElement(type, id, tags, g));
  }

  if (tags.railway) {
    if (['station', 'halt', 'level_crossing'].includes(tags.railway)) {
      const el = asPointElement(type, id, tags, g);
      if (el?.center) add('rail', { type: 'node', id, tags, lat: el.center.lat, lon: el.center.lon });
      else add('rail', el);
    } else if (isLine(g)) add('rail', asLineElement(type, id, tags, g));
    else if (isArea(g) && tags.railway === 'platform') add('rail', asAreaElement(type, id, tags, g));
  }

  const poi = tags.shop || tags.amenity || tags.tourism || tags.historic || tags.craft || tags.office ||
    tags.leisure === 'park' || tags.leisure === 'beach_resort' || tags.natural === 'beach' || tags.natural === 'peak';
  if (poi) add('pois', asPointElement(type, id, tags, g));

  if (tags.place && g.type === 'Point') add('places', asPointElement(type, id, tags, g));
}

const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
let n = 0;
for await (const raw of rl) {
  // geojsonseq lines may start with the RS (0x1e) record separator
  const s = raw.replace(/^\x1e/, '').trim();
  if (!s) continue;
  classify(JSON.parse(s));
  n++;
}
console.log(`features read: ${n}`);

fs.mkdirSync(outDir, { recursive: true });
for (const layer of LAYERS) {
  const elements = [...out[layer].values()];
  const buf = zlib.gzipSync(JSON.stringify({ elements }), { level: 9 });
  fs.writeFileSync(path.join(outDir, `${layer}.json.gz`), buf);
  console.log(`${layer}: ${elements.length} elements, ${(buf.length / 1e6).toFixed(2)} MB gz`);
}
fs.writeFileSync(
  path.join(outDir, 'meta.json'),
  JSON.stringify(
    {
      bbox,
      source: 'OpenStreetMap contributors via Geofabrik extract',
      license: 'ODbL-1.0',
      data_timestamp: stamp,
      fetched_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    },
    null,
    2,
  ) + '\n',
);
