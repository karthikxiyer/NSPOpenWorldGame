import type { Road, TileData } from './types';

export interface GEdge {
  to: number;
  /** road class (see Road.c) */
  c: number;
  /** road width */
  w: number;
  len: number;
}

const CELL = 60;

/**
 * Directed graph of the roads in the loaded tiles. Vertices are keyed by their (0.1 m rounded)
 * position, so OSM junction nodes shared by several ways — and points split across tiles —
 * join up automatically. One-way roads only get forward edges.
 */
export class RoadGraph {
  xs: number[] = [];
  zs: number[] = [];
  adj: GEdge[][] = [];
  private ids = new Map<number, number>();
  private cells = new Map<number, number[]>();

  constructor(tiles: TileData[], accept: (r: Road) => boolean) {
    for (const t of tiles) {
      for (const r of t.roads) {
        if (!accept(r)) continue;
        const p = r.p;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const a = this.vertex(p[i], p[i + 1]);
          const b = this.vertex(p[i + 2], p[i + 3]);
          if (a === b) continue;
          const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
          this.link(a, b, r, len);
          if (!r.o) this.link(b, a, r, len);
        }
      }
    }
  }

  get size(): number {
    return this.xs.length;
  }

  private vertex(x: number, z: number): number {
    const k = Math.round(x * 10) * 1e7 + Math.round(z * 10);
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

  private link(a: number, b: number, r: Road, len: number) {
    const list = this.adj[a];
    if (list.some((e) => e.to === b)) return;
    list.push({ to: b, c: r.c, w: r.w, len });
  }

  /** Vertex id at an exact position, if the graph has one. */
  find(x: number, z: number): number | undefined {
    return this.ids.get(Math.round(x * 10) * 1e7 + Math.round(z * 10));
  }

  nearest(x: number, z: number, maxDist: number): number {
    let best = -1, bd = maxDist;
    const r = Math.ceil(maxDist / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      for (const id of this.cells.get(cellKey(cx + dx, cz + dz)) ?? []) {
        const d = Math.hypot(this.xs[id] - x, this.zs[id] - z);
        if (d < bd && this.adj[id].length) { bd = d; best = id; }
      }
    }
    return best;
  }

  /** A random vertex (with outgoing edges) in a ring around a point, or -1. */
  randomInRing(x: number, z: number, rMin: number, rMax: number, tries = 30): number {
    const n = this.xs.length;
    if (!n) return -1;
    for (let i = 0; i < tries; i++) {
      // sample a random cell position in the ring, then take the nearest vertex there
      const a = Math.random() * Math.PI * 2;
      const d = rMin + Math.random() * (rMax - rMin);
      const id = this.nearest(x + Math.cos(a) * d, z + Math.sin(a) * d, CELL);
      if (id < 0) continue;
      const dd = Math.hypot(this.xs[id] - x, this.zs[id] - z);
      if (dd >= rMin && dd <= rMax) return id;
    }
    return -1;
  }
}

const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
