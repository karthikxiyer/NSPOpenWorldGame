import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Builds one merged, vertex-coloured geometry out of primitives so a whole model is a single
 * draw call (and can be instanced). Parts marked `tint` take the per-instance colour; the rest
 * keep their own colour — see tintMaterial().
 */
export class Mesher {
  private parts: THREE.BufferGeometry[] = [];
  private static e = new THREE.Euler();
  private static q = new THREE.Quaternion();
  private static m = new THREE.Matrix4();

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], tint = false): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.deleteAttribute('uv');
    Mesher.q.setFromEuler(Mesher.e.set(rot[0], rot[1], rot[2]));
    Mesher.m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), Mesher.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(Mesher.m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const tn = new Float32Array(n).fill(tint ? 1 : 0);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(tn, 1));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rot?: number[], tint = false): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, [x, y, z], rot, tint);
  }

  cyl(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rot?: number[], seg = 8, tint = false): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, [x, y, z], rot, tint);
  }

  sphere(r: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, scale: number[] = [1, 1, 1], tint = false): this {
    const g = new THREE.SphereGeometry(r, 8, 6);
    g.scale(scale[0], scale[1], scale[2]);
    return this.add(g, color, [x, y, z], undefined, tint);
  }

  /** A wheel lying on its side, axle along x. */
  wheel(r: number, w: number, x: number, z: number, color = '#1a1a1a'): this {
    return this.cyl(r, r, w, color, x, r, z, [0, 0, Math.PI / 2], 10);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingSphere();
    return g;
  }
}

let shared: THREE.MeshLambertMaterial | null = null;

/** Lambert material where the instance colour only affects vertices with tint = 1. */
export function tintMaterial(): THREE.MeshLambertMaterial {
  if (shared) return shared;
  shared = new THREE.MeshLambertMaterial({ vertexColors: true });
  shared.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float tint;\n' + sh.vertexShader.replace(
      'vColor.xyz *= instanceColor.xyz;',
      'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, tint);',
    );
  };
  return shared;
}

/** An InstancedMesh ready for per-frame updates. */
export function instanced(geo: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, tintMaterial(), capacity);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // instanceColor must exist before the first render so the shader is compiled with it
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < capacity; i++) m.setColorAt(i, white);
  m.count = 0;
  m.frustumCulled = false;
  return m;
}
