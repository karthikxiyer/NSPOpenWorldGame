import * as THREE from 'three';
import { cel } from '../core/toon';
import { curveTree } from '../world/curve';

/**
 * An InstancedMesh for things that move: cel-shaded like the rest of the town, bent by the curve,
 * with the per-instance colour applied only to the model's tinted parts (see art/mesher).
 */
export function instanced(geo: THREE.BufferGeometry, capacity: number, shadows: boolean): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, cel({ vertexColors: true, maskedInstanceColor: true }), capacity);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // instanceColor must exist before the first render so the shader is compiled with it
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < capacity; i++) m.setColorAt(i, white);
  m.count = 0;
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  curveTree(m);
  return m;
}

/** Fills the instances of one mesh per frame. */
export class InstanceWriter {
  private n = 0;
  private o = new THREE.Object3D();
  constructor(readonly mesh: THREE.InstancedMesh) {}
  begin(): void {
    this.n = 0;
  }
  add(x: number, y: number, z: number, yaw: number, color?: THREE.Color, pitch = 0): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    const o = this.o;
    o.position.set(x, y, z);
    o.rotation.set(pitch, yaw, 0, 'YXZ');
    o.updateMatrix();
    this.mesh.setMatrixAt(this.n, o.matrix);
    if (color) this.mesh.setColorAt(this.n, color);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
