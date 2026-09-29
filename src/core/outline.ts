/*
 * Inverted-hull outlines for hero props — adapted from Sakura Crossing
 * (https://github.com/Kenton-GMI/sakura-crossing), Copyright (c) 2026 Kenton Wang, MIT License.
 * See THIRD_PARTY_NOTICES.md.
 *
 * A back-faced shell pushed out along smoothed normals and offset in clip space, so the
 * contour keeps a constant pixel width at any distance.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAL } from './palette';
import { CURVE, CURVE_GLSL } from '../world/curve';

const VERT = /* glsl */ `
  uniform float uThickness;
  uniform vec2 uResolution;
  ${CURVE_GLSL}
  void main() {
    vec4 wp = vec4( position, 1.0 );
    vec3 n = normal;
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
      n = mat3( instanceMatrix ) * n;
    #endif
    wp = modelMatrix * wp;
    vec3 wn = curveNormal( normalize( mat3( modelMatrix ) * n ), wp.xyz );
    wp.xyz = curvePos( wp.xyz );
    vec4 clip = projectionMatrix * viewMatrix * wp;
    vec3 clipN = normalize( ( projectionMatrix * viewMatrix * vec4( wn, 0.0 ) ).xyz );
    vec2 aspect = vec2( uResolution.y / uResolution.x, 1.0 );
    clip.xy += clipN.xy * aspect * uThickness * clip.w * 0.5;
    gl_Position = clip;
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4( uColor, 1.0 ); }
`;

const resolution = new THREE.Vector2(1920, 1080);
const materials = new Set<THREE.ShaderMaterial>();
const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

export function setOutlineResolution(w: number, h: number): void {
  resolution.set(w, h);
  materials.forEach((m) => m.uniforms.uResolution.value.set(w, h));
}

function smoothed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = smoothCache.get(geo);
  if (hit) return hit;
  let g = geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  try {
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
  } catch {
    /* keep the unsmoothed copy */
  }
  smoothCache.set(geo, g);
  return g;
}

export function hullOutline(mesh: THREE.Mesh, thickness = 0.0034): THREE.Mesh | null {
  if (!mesh.geometry) return null;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uThickness: { value: thickness }, uColor: { value: new THREE.Color(PAL.ink) }, uResolution: { value: resolution.clone() }, ...CURVE },
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide,
  });
  materials.add(mat);
  let shell: THREE.Mesh;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const im = mesh as THREE.InstancedMesh;
    const s = new THREE.InstancedMesh(smoothed(im.geometry), mat, im.instanceMatrix.count);
    s.instanceMatrix = im.instanceMatrix;
    s.count = im.count;
    s.frustumCulled = false;
    shell = s;
  } else shell = new THREE.Mesh(smoothed(mesh.geometry), mat);
  shell.userData.isOutline = true;
  shell.frustumCulled = false;
  shell.renderOrder = (mesh.renderOrder || 0) - 1;
  mesh.add(shell);
  return shell;
}

/** Outline every mesh in a subtree (skipping ones marked userData.noOutline). */
export function hullOutlineTree(root: THREE.Object3D, thickness?: number): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.noOutline && !m.userData.isOutline) targets.push(m);
  });
  for (const m of targets) hullOutline(m, thickness);
}
