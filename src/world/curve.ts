/**
 * The curved world.
 *
 * The map is flat (x east, z south, y up) and wraps around at its edges. Every material bends it
 * in the vertex shader around a centre point (the player, or the Taaki on the title screen):
 * a point at distance d from the centre is rotated round a sphere of radius R by d / R. With a
 * small R the whole neighbourhood becomes a tiny planet; with a large R it is a gently curved
 * horizon. Animating R is how the title planet unrolls into the playable map.
 */
import * as THREE from 'three';

export const CURVE = {
  uCurveCenter: { value: new THREE.Vector2(0, 0) },
  uCurveR: { value: 650 },
};

export const CURVE_GLSL = /* glsl */ `
  uniform vec2 uCurveCenter;
  uniform float uCurveR;
  vec3 curvePos( vec3 p ) {
    vec2 q = p.xz - uCurveCenter;
    float d = length( q );
    if ( d < 1e-4 ) return p;
    float th = min( d / uCurveR, 3.1 );
    vec2 dir = q / d;
    float r = uCurveR + p.y;
    return vec3( uCurveCenter.x + dir.x * r * sin( th ), r * cos( th ) - uCurveR, uCurveCenter.y + dir.y * r * sin( th ) );
  }
  vec3 curveNormal( vec3 n, vec3 p ) {
    vec2 q = p.xz - uCurveCenter;
    float d = length( q );
    if ( d < 1e-4 ) return n;
    float th = min( d / uCurveR, 3.1 );
    vec2 dir = q / d;
    vec3 k = vec3( dir.y, 0.0, -dir.x );
    float c = cos( th ), s = sin( th );
    return n * c + cross( k, n ) * s + k * dot( k, n ) * ( 1.0 - c );
  }
`;

const PROJECT = /* glsl */ `
  vec4 cwp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    cwp = instanceMatrix * cwp;
  #endif
  cwp = modelMatrix * cwp;
  cwp.xyz = curvePos( cwp.xyz );
  vec4 mvPosition = viewMatrix * cwp;
  gl_Position = projectionMatrix * mvPosition;
`;

const NORMAL = /* glsl */ `
  {
    vec4 np = vec4( position, 1.0 );
    #ifdef USE_INSTANCING
      np = instanceMatrix * np;
    #endif
    np = modelMatrix * np;
    vec3 wn = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );
    transformedNormal = normalize( ( viewMatrix * vec4( curveNormal( wn, np.xyz ), 0.0 ) ).xyz );
  }
`;

/** Patch a shader (from onBeforeCompile) to bend positions, normals and shadow lookups. */
export function patchShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uCurveCenter = CURVE.uCurveCenter;
  shader.uniforms.uCurveR = CURVE.uCurveR;
  let v = shader.vertexShader;
  v = v.replace('void main() {', CURVE_GLSL + '\nvoid main() {');
  v = v.replace('#include <project_vertex>', PROJECT);
  if (v.includes('#include <defaultnormal_vertex>')) v = v.replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n' + NORMAL);
  v = v.replace('#include <worldpos_vertex>', 'vec4 worldPosition = cwp;');
  shader.vertexShader = v;
}

/** Make a material bend with the world (idempotent; keeps any existing onBeforeCompile). */
export function curveMaterial<T extends THREE.Material>(mat: T): T {
  if (mat.userData.curved) return mat;
  mat.userData.curved = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patchShader(shader);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '|curve';
  return mat;
}

let depthMat: THREE.MeshDepthMaterial | null = null;
/** Shared depth material for shadow casting that bends like everything else. */
export function curveDepthMaterial(): THREE.MeshDepthMaterial {
  if (!depthMat) depthMat = curveMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  return depthMat;
}

/** Curve every mesh under a root (materials and shadow depth). */
export function curveTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.isOutline) return; // outline shells bend in their own shader
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mm) => curveMaterial(mm));
    m.customDepthMaterial = curveDepthMaterial();
    m.frustumCulled = false; // bounds are unbent; visibility is managed by distance instead
  });
}

/** CPU mirror of curvePos, for the camera and anything placed by script. */
export function curvePoint(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const cx = CURVE.uCurveCenter.value.x, cz = CURVE.uCurveCenter.value.y, R = CURVE.uCurveR.value;
  const qx = x - cx, qz = z - cz, d = Math.hypot(qx, qz);
  if (d < 1e-4) return out.set(x, y, z);
  const th = Math.min(d / R, 3.1), r = R + y;
  return out.set(cx + (qx / d) * r * Math.sin(th), r * Math.cos(th) - R, cz + (qz / d) * r * Math.sin(th));
}

/** Local "up" at a flat point after bending. */
export function curveUp(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const cx = CURVE.uCurveCenter.value.x, cz = CURVE.uCurveCenter.value.y, R = CURVE.uCurveR.value;
  const qx = x - cx, qz = z - cz, d = Math.hypot(qx, qz);
  if (d < 1e-4) return out.set(0, 1, 0);
  const th = Math.min(d / R, 3.1);
  return out.set((qx / d) * Math.sin(th), Math.cos(th), (qz / d) * Math.sin(th));
}
