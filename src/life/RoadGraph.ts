import type { Patch, PRoad } from '../world/patch';

export interface GEdge {
  to: number;
  /** road class (see PRoad.c) */
  c: number;
  /** road width */
  w: number;
  len: number;
  /** unit direction; the map wraps, so this is not always xs[to] - xs[from] */
  dx: number;
  dz: number;
}

const CELL = 40;
const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

/**
 * The patch wraps around, so everything alive lives in "folded" coordinates inside the base
 * patch, and differences between two points are taken the short way round.
 */
export class Wrap {
  readonly W: number;
  readonly H: number;
  constructor(readonly minX: number, readonly minZ: number, maxX: number, maxZ: number) {
    this.W = maxX - minX;
    this.H = maxZ - minZ;
  }
  fx(x: number): number { return this.minX + ((((x - this.minX) % this.W) + this.W) % this.W); }
  fz(z: number): number { return this.minZ + ((((z - this.minZ) % this.H) + this.H) % this.H); }
  /** shortest x / z difference b - a */
  dx(a: number, b: number): number { const d = b - a; return d - Math.round(d / this.W) * this.W; }
  dz(a: number, b: number): number { const d = b - a; return d - Math.round(d / this.H) * this.H; }
  dist(ax: number, az: number, bx: number, bz: number): number { return Math.hypot(this.dx(ax, bx), this.dz(az, bz)); }
  /** the copy of x nearest to fx (for drawing next to the camera) */
  near(x: number, f: number, span: number): number { return x + Math.round((f - x) / span) * span; }
}

/**
 * Directed graph of the patch's roads. Vertices are keyed by their folded, 0.1 m rounded position,
 * so OSM junctions shared by several ways join up. One-way roads only get forward edges. Roads the
 * builder cut at the patch edges are stitched to the ring road, which is where the wrap takes them.
 */
export class RoadGraph {
  xs: number[] = [];
  zs: number[] = [];
  adj: GEdge[][] = [];
  private ids = new Map<number, number>();
  private cells = new Map<number, number[]>();

  constructor(patch: Patch, readonly wrap: Wrap, accept: (r: PRoad) => boolean) {
    const ring: number[] = [];
    for (const r of patch.roads) {
      if (!accept(r)) continue;
      const p = r.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const a = this.vertex(p[i], p[i + 1]);
        const b = this.vertex(p[i + 2], p[i + 3]);
        if (a === b) continue;
        this.link(a, b, r.c, r.w);
        if (!r.o) this.link(b, a, r.c, r.w);
        if (r.ring) ring.push(a, b);
      }
    }
    // stitch loose ends at the edges to the nearest ring-road vertex (both ways)
    const b = patch.bounds, near = (v: number, lo: number, hi: number) => Math.abs(v - lo) < 2 || Math.abs(v - hi) < 2;
    const ringSet = new Set(ring);
    for (let v = 0; v < this.xs.length; v++) {
      if (ringSet.has(v)) continue;
      if (!near(this.xs[v], b.minX, b.maxX) && !near(this.zs[v], b.minZ, b.maxZ)) continue;
      let best = -1, bd = 14;
      for (const u of ringSet) {
        const d = wrap.dist(this.xs[v], this.zs[v], this.xs[u], this.zs[u]);
        if (d < bd) { bd = d; best = u; }
      }
      if (best < 0) continue;
      const w = this.adj[v][0]?.w ?? 5.5, c = this.adj[v][0]?.c ?? 5;
      this.link(v, best, c, w);
      this.link(best, v, c, w);
    }
  }

  private vertex(x: number, z: number): number {
    x = this.wrap.fx(x);
    z = this.wrap.fz(z);
    const k = Math.round(x * 10) * 1e6 + Math.round(z * 10);
    let id = this.ids.get(k);
    if (id === undefined) {
      id = this.xs.length;
      this.ids.set(k, id);
      this.xs.push(x);
      this.zs.push(z);
      this.adj.push([]);
      const ck = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
      let cell = this.cells.get(ck);
      if (!cell) this.cells.set(ck, (cell = []));
      cell.push(id);
    }
    return id;
  }

  private link(a: number, b: number, c: number, w: number) {
    const list = this.adj[a];
    if (list.some((e) => e.to === b)) return;
    const dx = this.wrap.dx(this.xs[a], this.xs[b]), dz = this.wrap.dz(this.zs[a], this.zs[b]);
    const len = Math.hypot(dx, dz) || 0.01;
    list.push({ to: b, c, w, len, dx: dx / len, dz: dz / len });
  }

  get size(): number {
    return this.xs.length;
  }

  /** nearest vertex with outgoing edges (optionally only edges a filter accepts), or -1 */
  nearest(x: number, z: number, maxDist: number, ok: (e: GEdge) => boolean = () => true): number {
    x = this.wrap.fx(x);
    z = this.wrap.fz(z);
    let best = -1, bd = maxDist;
    const r = Math.ceil(maxDist / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const W = this.wrap.W, H = this.wrap.H;
    const nx = Math.ceil(W / CELL), nz = Math.ceil(H / CELL);
    const ox = Math.floor(this.wrap.minX / CELL), oz = Math.floor(this.wrap.minZ / CELL);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      // cells wrap too
      const kx = ox + ((((cx + dx - ox) % nx) + nx) % nx), kz = oz + ((((cz + dz - oz) % nz) + nz) % nz);
      for (const id of this.cells.get(cellKey(kx, kz)) ?? []) {
        if (!this.adj[id].some(ok)) continue;
        const d = this.wrap.dist(x, z, this.xs[id], this.zs[id]);
        if (d < bd) { bd = d; best = id; }
      }
    }
    return best;
  }

  /** A random vertex (with an acceptable edge) in a ring around a point, or -1. */
  randomInRing(x: number, z: number, rMin: number, rMax: number, rand: () => number, ok: (e: GEdge) => boolean = () => true, tries = 30): number {
    for (let i = 0; i < tries; i++) {
      const a = rand() * Math.PI * 2;
      const d = rMin + rand() * (rMax - rMin);
      const id = this.nearest(x + Math.cos(a) * d, z + Math.sin(a) * d, CELL, ok);
      if (id < 0) continue;
      const dd = this.wrap.dist(x, z, this.xs[id], this.zs[id]);
      if (dd >= rMin && dd <= rMax) return id;
    }
    return -1;
  }

  /** Shortest path (A*) from one vertex to another over acceptable edges: the list of edges, or null. */
  path(from: number, to: number, ok: (e: GEdge) => boolean): { from: number; edge: GEdge }[] | null {
    if (from === to) return [];
    const n = this.xs.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevEdge: (GEdge | null)[] = new Array(n).fill(null);
    const h = (v: number) => this.wrap.dist(this.xs[v], this.zs[v], this.xs[to], this.zs[to]);
    // small binary heap of [f, vertex]
    const heap: number[][] = [];
    const push = (f: number, v: number) => {
      heap.push([f, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    g[from] = 0;
    push(h(from), from);
    while (heap.length) {
      const [f, v] = pop();
      if (v === to) break;
      if (f - h(v) > g[v] + 1e-6) continue;
      for (const e of this.adj[v]) {
        if (!ok(e)) continue;
        // prefer bigger roads a little, like a driver would
        const cost = e.len * (1 + Math.max(0, e.c - 3) * 0.08);
        const ng = g[v] + cost;
        if (ng < g[e.to]) {
          g[e.to] = ng;
          prev[e.to] = v;
          prevEdge[e.to] = e;
          push(ng + h(e.to), e.to);
        }
      }
    }
    if (prev[to] < 0) return null;
    const out: { from: number; edge: GEdge }[] = [];
    for (let v = to; v !== from; v = prev[v]) out.push({ from: prev[v], edge: prevEdge[v]! });
    return out.reverse();
  }
}
