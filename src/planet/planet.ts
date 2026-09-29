/**
 * The planet.
 *
 * Everything is authored and simulated on a flat strip: x runs along the loop (and wraps every
 * CIRCUMFERENCE metres), z runs across it (+z = north, the Nalasopara West side), y is up.
 * This module is the only code that knows the world is round. It maps the strip onto a sphere
 * with the loop road on the equator:
 *
 *   longitude = x / R,  latitude = z / R,  position = up(lon, lat) * (R + y)
 *
 * Static geometry is bent once after it is built (long edges subdivided first so they don't
 * chord through the planet). Moving things are placed rigidly in the local frame each frame.
 * The approach follows Sakura Crossing's planet.js (MIT, see THIRD_PARTY_NOTICES.md).
 */
import * as THREE from 'three';

export const R = 160;
export const CIRCUMFERENCE = 2 * Math.PI * R; // ~1005 m

/** Wrap an x coordinate into [0, CIRCUMFERENCE). */
export const wrapX = (x: number): number => ((x % CIRCUMFERENCE) + CIRCUMFERENCE) % CIRCUMFERENCE;

/** Shortest signed distance from a to b along the loop. */
export const loopDelta = (a: number, b: number): number => {
  let d = wrapX(b) - wrapX(a);
  if (d > CIRCUMFERENCE / 2) d -= CIRCUMFERENCE;
  if (d < -CIRCUMFERENCE / 2) d += CIRCUMFERENCE;
  return d;
};

export interface Frame {
  east: THREE.Vector3;
  up: THREE.Vector3;
  north: THREE.Vector3;
}

/** Local frame at a flat point. (east, up, north) is right-handed, matching flat (x, y, z). */
export function frameAt(x: number, z: number, out?: Frame): Frame {
  const lon = x / R, lat = z / R;
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  const f = out ?? { east: new THREE.Vector3(), up: new THREE.Vector3(), north: new THREE.Vector3() };
  f.up.set(cl * so, cl * co, sl);
  f.east.set(co, -so, 0);
  f.north.set(-sl * so, -sl * co, cl);
  return f;
}

/** World position of a flat point. */
export function toWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const lon = x / R, lat = z / R, cl = Math.cos(lat);
  const r = R + y;
  return out.set(cl * Math.sin(lon) * r, cl * Math.cos(lon) * r, Math.sin(lat) * r);
}

const _f = frameAt(0, 0);
const _yaw = new THREE.Matrix4();
const _p = new THREE.Vector3();

/** Matrix placing an object at a flat pose: position + yaw about local up. */
export function poseMatrix(x: number, y: number, z: number, yaw: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  frameAt(x, z, _f);
  out.makeBasis(_f.east, _f.up, _f.north);
  out.setPosition(toWorld(x, y, z, _p));
  if (yaw) out.multiply(_yaw.makeRotationY(yaw));
  return out;
}

/**
 * Seat a top-level object on the planet from its flat transform
 * (position.x/y/z and rotation.y are read as flat values).
 */
export function pin(obj: THREE.Object3D): void {
  obj.matrixAutoUpdate = false;
  poseMatrix(obj.position.x, obj.position.y, obj.position.z, obj.rotation.y, obj.matrix);
  obj.matrixWorldNeedsUpdate = true;
}

// ---------- bending static geometry ----------

/**
 * Split triangles until no edge is longer than `maxLen` in the flat x/z plane.
 * Works on non-indexed geometry and interpolates every attribute.
 */
export function subdivide(geo: THREE.BufferGeometry, maxLen: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes);
  const attrs = names.map((n) => g.attributes[n] as THREE.BufferAttribute);
  const sizes = attrs.map((a) => a.itemSize);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // each vertex as a flat array of all attribute values
  const stride = sizes.reduce((a, b) => a + b, 0);
  const vert = (i: number): number[] => {
    const v: number[] = [];
    attrs.forEach((a) => {
      for (let k = 0; k < a.itemSize; k++) v.push(a.array[i * a.itemSize + k] as number);
    });
    return v;
  };
  const out: number[][] = [];
  const stack: number[][][] = [];
  for (let i = 0; i < pos.count; i += 3) stack.push([vert(i), vert(i + 1), vert(i + 2)]);
  const max2 = maxLen * maxLen;
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
  let guard = 0;
  while (stack.length) {
    const t = stack.pop()!;
    const e = [d2(t[0], t[1]), d2(t[1], t[2]), d2(t[2], t[0])];
    const k = e[0] >= e[1] && e[0] >= e[2] ? 0 : e[1] >= e[2] ? 1 : 2;
    if (e[k] <= max2 || ++guard > 2e6) {
      out.push(t[0], t[1], t[2]);
      continue;
    }
    const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
    const m = a.map((v, j) => (v + b[j]) / 2);
    stack.push([a, m, c], [m, b, c]);
  }
  const res = new THREE.BufferGeometry();
  let off = 0;
  names.forEach((n, ai) => {
    const size = sizes[ai];
    const arr = new Float32Array(out.length * size);
    out.forEach((v, i) => {
      for (let k = 0; k < size; k++) arr[i * size + k] = v[off + k];
    });
    res.setAttribute(n, new THREE.BufferAttribute(arr, size));
    off += size;
  });
  void stride;
  return res;
}

/** Bend flat geometry onto the planet in place (positions and normals). */
export function bend(geo: THREE.BufferGeometry, maxLen = 6): THREE.BufferGeometry {
  const g = subdivide(geo, maxLen);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
  const f = frameAt(0, 0);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    toWorld(x, y, z, p);
    pos.setXYZ(i, p.x, p.y, p.z);
    if (nrm) {
      frameAt(x, z, f);
      const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
      nrm.setXYZ(
        i,
        f.east.x * nx + f.up.x * ny + f.north.x * nz,
        f.east.y * nx + f.up.y * ny + f.north.y * nz,
        f.east.z * nx + f.up.z * ny + f.north.z * nz,
      );
    }
  }
  g.computeBoundingSphere();
  return g;
}
