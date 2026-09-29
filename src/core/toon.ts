/*
 * Cel shading — adapted from Sakura Crossing (https://github.com/Kenton-GMI/sakura-crossing),
 * Copyright (c) 2026 Kenton Wang, MIT License. See THIRD_PARTY_NOTICES.md.
 *
 * Everything uses MeshToonMaterial with a hand-authored gradient ramp, so direct sunlight
 * is quantised into 2-4 flat bands. The toon BRDF is patched so the darker bands shift
 * toward a cool violet instead of just going darker — the hue shift in shadow is most of
 * what separates "anime cel" from "low-poly 3D".
 */
import * as THREE from 'three';
import { PAL } from './palette';

const RAMPS: Record<string, number[]> = {
  2: [96, 255],
  3: [92, 178, 255],
  4: [80, 142, 202, 255],
  // high-key ramps for pale masses (blossom, clouds) that must stay light on the shadow side
  soft: [180, 255],
  soft3: [172, 214, 255],
};

const rampCache = new Map<string, THREE.DataTexture>();

export function gradientMap(bands: number | string = 3): THREE.DataTexture {
  const key = String(bands);
  const hit = rampCache.get(key);
  if (hit) return hit;
  const stops = RAMPS[key] ?? RAMPS[3];
  const data = new Uint8Array(stops.length * 4);
  stops.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(key, tex);
  return tex;
}

const TOON_CHUNK = 'lights_toon_pars_fragment';
const TOON_LINE = 'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;';
const TOON_PATCH = `
	vec3 celBand = getGradientIrradiance( geometryNormal, directLight.direction );
	vec3 irradiance = celBand * mix( uShadowTint, vec3( 1.0 ), celBand ) * directLight.color;`;

const src = (THREE.ShaderChunk as Record<string, string>)[TOON_CHUNK];
const patchAvailable = !!src && src.includes(TOON_LINE);
const patchedChunk = patchAvailable ? 'uniform vec3 uShadowTint;\n' + src.replace(TOON_LINE, TOON_PATCH) : '';

function applyShadowTint(mat: THREE.MeshToonMaterial, tint: THREE.ColorRepresentation, extraVertex?: (s: string) => string): void {
  if (!patchAvailable) return;
  const uni = { value: new THREE.Color(tint) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = uni;
    shader.fragmentShader = shader.fragmentShader.replace(`#include <${TOON_CHUNK}>`, patchedChunk);
    if (extraVertex) shader.vertexShader = extraVertex(shader.vertexShader);
  };
  const hex = new THREE.Color(tint).getHexString();
  mat.customProgramCacheKey = () => 'celTint_' + hex + (extraVertex ? '_x' : '');
}

export interface CelOptions {
  color?: THREE.ColorRepresentation;
  bands?: number | string;
  tint?: THREE.ColorRepresentation;
  flat?: boolean;
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation | null;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  /** instance colour only applies where the `tint` vertex attribute is 1 (see art/mesher) */
  maskedInstanceColor?: boolean;
}

const matCache = new Map<string, THREE.MeshToonMaterial>();

/** Cel-shaded material factory, cached by parameters so the loop shares a few dozen programs. */
export function cel(opts: CelOptions = {}): THREE.MeshToonMaterial {
  const {
    color = 0xffffff, bands = 3, tint = PAL.shadowTint, flat = true, map = null, emissive = null,
    transparent = false, opacity = 1, side = THREE.FrontSide, vertexColors = false, maskedInstanceColor = false,
  } = opts;
  const key = map ? null : [color, bands, tint, flat, emissive, transparent, opacity, side, vertexColors, maskedInstanceColor].join('|');
  if (key) {
    const hit = matCache.get(key);
    if (hit) return hit;
  }
  const mat = new THREE.MeshToonMaterial({
    color, gradientMap: gradientMap(bands), map, transparent, opacity, side, vertexColors,
    emissive: emissive ?? 0x000000,
  });
  // toon materials have no flat-shading switch; faceting comes from per-face normals in the geometry
  void flat;
  applyShadowTint(mat, tint, maskedInstanceColor
    ? (v) => 'attribute float tint;\n' + v.replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, tint);')
    : undefined);
  if (key) matCache.set(key, mat);
  return mat;
}

/** Unlit flat colour — sky, glowing panels, distant silhouettes. */
export function flat(opts: { color?: THREE.ColorRepresentation; map?: THREE.Texture | null; transparent?: boolean; opacity?: number; side?: THREE.Side; depthWrite?: boolean; fog?: boolean; alphaTest?: number } = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: opts.color ?? 0xffffff, map: opts.map ?? null, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide, fog: opts.fog ?? true, alphaTest: opts.alphaTest ?? 0,
  });
  if (opts.depthWrite !== undefined) m.depthWrite = opts.depthWrite;
  return m;
}
