import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge the leaf meshes under each node that share a material into a single mesh, keeping the
 * node hierarchy (so wheels, forks and limbs still animate). Cuts a model's draw calls from
 * dozens to a handful.
 */
export function mergeByMaterial(root: THREE.Object3D): void {
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => nodes.push(o));
  for (const node of nodes) {
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of node.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.children.length || m.userData.blob || Array.isArray(m.material)) continue;
      const list = groups.get(m.material as THREE.Material) ?? [];
      list.push(m);
      groups.set(m.material as THREE.Material, list);
    }
    for (const [mat, meshes] of groups) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return g;
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = meshes.some((m) => m.castShadow);
      mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
      for (const m of meshes) node.remove(m);
      node.add(mesh);
    }
  }
}
