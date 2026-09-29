import * as THREE from 'three';

/**
 * Accumulates flat, vertex-coloured triangles (with UVs) into one geometry.
 */
export class Batch {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] = [];

  private static c = new THREE.Color();

  tri(a: number[], b: number[], c: number[], n: number[], color: THREE.ColorRepresentation, ua = [0, 0], ub = [0, 0], uc = [0, 0]): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    const col = Batch.c.set(color);
    this.pos.push(...a, ...b, ...c);
    this.nrm.push(...n, ...n, ...n);
    for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
    this.uv.push(...ua, ...ub, ...uc);
  }

  quad(a: number[], b: number[], c: number[], d: number[], n: number[], color: THREE.ColorRepresentation, uvs?: number[][]): void {
    const u = uvs ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.tri(a, b, c, n, color, u[0], u[1], u[2]);
    this.tri(a, c, d, n, color, u[0], u[2], u[3]);
  }

  /** Axis-aligned box. `uvScale` maps wall faces to a repeating window texture. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.ColorRepresentation, opts: { bottom?: boolean; top?: THREE.ColorRepresentation; wallUV?: boolean } = {}): void {
    const uvw = (a: number, b: number, h0: number, h1: number) =>
      opts.wallUV ? [[a / 3, h0 / 3.2], [b / 3, h0 / 3.2], [b / 3, h1 / 3.2], [a / 3, h1 / 3.2]] : undefined;
    // sides
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color, uvw(0, x1 - x0, y0, y1));
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], color, uvw(0, x1 - x0, y0, y1));
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], color, uvw(0, z1 - z0, y0, y1));
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color, uvw(0, z1 - z0, y0, y1));
    // roof samples the plain corner of the window texture
    const flatUV = opts.wallUV ? [[0.02, 0.02], [0.02, 0.02], [0.02, 0.02], [0.02, 0.02]] : undefined;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], opts.top ?? color, flatUV);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color, flatUV);
  }

  /** Flat horizontal rectangle at height y. */
  rect(x0: number, x1: number, z0: number, z1: number, y: number, color: THREE.ColorRepresentation): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], color);
  }

  /** Append any three.js geometry (transformed), in one colour. */
  geometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation): void {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    geo.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array as ArrayLike<number>;
    const n = g.attributes.normal.array as ArrayLike<number>;
    const col = Batch.c.set(color);
    for (let i = 0; i < p.length; i++) {
      this.pos.push(p[i]);
      this.nrm.push(n[i]);
    }
    for (let i = 0; i < p.length / 3; i++) {
      this.col.push(col.r, col.g, col.b);
      this.uv.push(0.02, 0.02);
    }
    g.dispose();
  }

  /** Append a pre-flattened template (see template()) transformed by a matrix — much faster than geometry(). */
  stamp(t: Template, m: THREE.Matrix4, color: THREE.ColorRepresentation): void {
    const e = m.elements;
    const col = Batch.c.set(color);
    const p = t.pos, n = t.nrm;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      this.pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      const nx = n[i], ny = n[i + 1], nz = n[i + 2];
      let ax = e[0] * nx + e[4] * ny + e[8] * nz, ay = e[1] * nx + e[5] * ny + e[9] * nz, az = e[2] * nx + e[6] * ny + e[10] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      ax /= l; ay /= l; az /= l;
      this.nrm.push(ax, ay, az);
      this.col.push(col.r, col.g, col.b);
      this.uv.push(0.02, 0.02);
    }
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

export interface Template {
  pos: Float32Array;
  nrm: Float32Array;
}

/** Flatten a geometry once so it can be stamped many times. */
export function template(geo: THREE.BufferGeometry): Template {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  return { pos: new Float32Array(g.attributes.position.array), nrm: new Float32Array(g.attributes.normal.array) };
}
