// Per-frame spatial hash of everything that moves, so agents can look for what's in front of them.

export type AgentKind = 'car' | 'ped' | 'animal' | 'player';

export interface Body {
  x: number;
  z: number;
  r: number;
  kind: AgentKind;
  /** identity, so an agent can skip itself */
  ref: unknown;
}

const CELL = 12;
const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class Spatial {
  private cells = new Map<number, Body[]>();
  private pool: Body[][] = [];

  clear(): void {
    for (const list of this.cells.values()) {
      list.length = 0;
      this.pool.push(list);
    }
    this.cells.clear();
  }

  add(b: Body): void {
    const k = key(Math.floor(b.x / CELL), Math.floor(b.z / CELL));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = this.pool.pop() ?? []));
    list.push(b);
  }

  /** Visit bodies within roughly `r` of a point. */
  near(x: number, z: number, r: number, fn: (b: Body) => void): void {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const list = this.cells.get(key(cx, cz));
      if (list) for (const b of list) fn(b);
    }
  }
}
