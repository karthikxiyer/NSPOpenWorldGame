/*
 * The 3D-to-2D pipeline — adapted from Sakura Crossing (https://github.com/Kenton-GMI/sakura-crossing),
 * Copyright (c) 2026 Kenton Wang, MIT License. See THIRD_PARTY_NOTICES.md.
 *
 *   scene -> rtScene (colour + depth)
 *         -> ink   : screen-space line work from the second difference of linear depth
 *         -> grade : split-tone colour grade + linear->sRGB
 *         -> fxaa  : clean the line work, straight to screen
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { PAL } from './palette';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const INK_FRAG = /* glsl */ `
  #include <packing>
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform float uNear, uFar;
  uniform vec3 uInk;
  uniform float uThickness, uSens, uConcave, uConcaveAmount;
  uniform float uFadeStart, uFadeEnd, uStrength, uSkyDepth;
  varying vec2 vUv;

  float linearDepth( vec2 uv ) {
    float d = texture2D( tDepth, uv ).x;
    return -perspectiveDepthToViewZ( d, uNear, uFar );
  }

  void main() {
    vec3 col = texture2D( tDiffuse, vUv ).rgb;
    vec2 t = uTexel * uThickness;
    float dc = linearDepth( vUv );
    if ( dc > uSkyDepth ) { gl_FragColor = vec4( col, 1.0 ); return; }
    float dl = linearDepth( vUv - vec2( t.x, 0.0 ) );
    float dr = linearDepth( vUv + vec2( t.x, 0.0 ) );
    float du = linearDepth( vUv + vec2( 0.0, t.y ) );
    float dd = linearDepth( vUv - vec2( 0.0, t.y ) );
    // second difference of linear depth: flat across any plane, fires on silhouettes and creases
    float sx = ( dl + dr - 2.0 * dc ) / dc;
    float sy = ( du + dd - 2.0 * dc ) / dc;
    float convex  = max( 0.0,  sx ) + max( 0.0,  sy );
    float concave = max( 0.0, -sx ) + max( 0.0, -sy );
    float edge = smoothstep( uSens * 0.32, uSens, convex );
    edge = max( edge, smoothstep( uConcave, uConcave * 3.4, concave ) * uConcaveAmount );
    edge *= 1.0 - smoothstep( uFadeStart, uFadeEnd, dc );
    edge *= uStrength;
    vec3 line = mix( uInk, col * 0.42, 0.22 );
    gl_FragColor = vec4( mix( col, line, clamp( edge, 0.0, 1.0 ) ), 1.0 );
  }
`;

const GRADE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec3 uShadowTint, uLightTint;
  uniform float uSaturation, uLift, uVignette, uWarmth;
  varying vec2 vUv;

  vec3 linearToSRGB( vec3 c ) {
    return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0031308 ) ), vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
  }

  void main() {
    vec3 c = texture2D( tDiffuse, vUv ).rgb;
    float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    float k = smoothstep( 0.02, 0.55, l );
    c *= mix( uShadowTint, uLightTint, k );         // violet darks, warm paper-white lights
    c += vec3( uWarmth, uWarmth * 0.45, 0.0 ) * l * 0.35; // late-afternoon warmth
    c = c + uLift * ( 1.0 - k );                    // never crush the shadows
    c = mix( vec3( l ), c, uSaturation );
    float r = length( vUv - 0.5 ) * 1.42;
    c *= 1.0 - uVignette * pow( clamp( r, 0.0, 1.0 ), 2.6 );
    gl_FragColor = vec4( linearToSRGB( max( c, vec3( 0.0 ) ) ), 1.0 );
  }
`;

const FXAA_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;
  float luma( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }
  void main() {
    vec3 cM = texture2D( tDiffuse, vUv ).rgb;
    vec3 cNW = texture2D( tDiffuse, vUv + vec2( -uTexel.x, -uTexel.y ) ).rgb;
    vec3 cNE = texture2D( tDiffuse, vUv + vec2(  uTexel.x, -uTexel.y ) ).rgb;
    vec3 cSW = texture2D( tDiffuse, vUv + vec2( -uTexel.x,  uTexel.y ) ).rgb;
    vec3 cSE = texture2D( tDiffuse, vUv + vec2(  uTexel.x,  uTexel.y ) ).rgb;
    float lM = luma( cM ), lNW = luma( cNW ), lNE = luma( cNE ), lSW = luma( cSW ), lSE = luma( cSE );
    float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
    float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
    vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( ( lNW + lSW ) - ( lNE + lSE ) ) );
    float reduce = max( ( lNW + lNE + lSW + lSE ) * 0.25 * 0.18, 1.0 / 128.0 );
    float rcp = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + reduce );
    dir = clamp( dir * rcp, vec2( -8.0 ), vec2( 8.0 ) ) * uTexel;
    vec3 rgbA = 0.5 * ( texture2D( tDiffuse, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb + texture2D( tDiffuse, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
    vec3 rgbB = rgbA * 0.5 + 0.25 * ( texture2D( tDiffuse, vUv - dir * 0.5 ).rgb + texture2D( tDiffuse, vUv + dir * 0.5 ).rgb );
    float lB = luma( rgbB );
    gl_FragColor = vec4( ( lB < lMin || lB > lMax ) ? rgbA : rgbB, 1.0 );
  }
`;

function quad(uniforms: Record<string, THREE.IUniform>, fragmentShader: string) {
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false });
  return { quad: new FullScreenQuad(mat), mat };
}

export interface PipelineOptions {
  /** phones: render at 1x, no supersampling */
  lite?: boolean;
}

export class Pipeline {
  readonly size = new THREE.Vector2(1, 1);
  scale = 1;
  enabled = { ink: true, grade: true, fxaa: true };
  private rtScene: THREE.WebGLRenderTarget;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private ink;
  private grade;
  private fxaa;
  private pixelBudget: number;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private opts: PipelineOptions = {}) {
    this.pixelBudget = opts.lite ? 1.6e6 : 4.6e6;
    const rtOpts = {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false, colorSpace: THREE.NoColorSpace,
    } as const;
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    const depth = new THREE.DepthTexture(2, 2);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rtScene.depthTexture = depth;
    this.rtA = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, type: THREE.UnsignedByteType, depthBuffer: false });

    this.ink = quad({
      tDiffuse: { value: null }, tDepth: { value: depth }, uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.25 }, uFar: { value: 600 }, uInk: { value: new THREE.Color(PAL.ink) },
      uThickness: { value: 1.35 }, uSens: { value: 0.0042 }, uConcave: { value: 0.026 }, uConcaveAmount: { value: 0.42 },
      uFadeStart: { value: 45 }, uFadeEnd: { value: 110 }, uStrength: { value: 1 }, uSkyDepth: { value: 380 },
    }, INK_FRAG);
    this.grade = quad({
      tDiffuse: { value: null }, uShadowTint: { value: new THREE.Color(0xb0a4cc) }, uLightTint: { value: new THREE.Color(0xfff4e2) },
      uSaturation: { value: 1.1 }, uLift: { value: 0.034 }, uVignette: { value: 0.16 }, uWarmth: { value: 0.07 },
    }, GRADE_FRAG);
    this.fxaa = quad({ tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } }, FXAA_FRAG);
  }

  /** 0.5..1: lowered by the frame-rate governor on slow devices (it multiplies the render scale) */
  quality = 1;
  private lastW = 1;
  private lastH = 1;

  setQuality(q: number): void {
    this.quality = Math.max(0.5, Math.min(1, q));
    this.setSize(this.lastW, this.lastH);
  }

  setSize(w: number, h: number): void {
    this.lastW = w;
    this.lastH = h;
    const dpr = window.devicePixelRatio || 1;
    let scale = this.opts.lite ? Math.min(dpr, 1) : dpr < 1.5 ? 1.5 : Math.min(dpr, 2);
    if (w * h * scale * scale > this.pixelBudget) scale = Math.max(this.opts.lite ? 0.75 : 1, Math.sqrt(this.pixelBudget / (w * h)));
    scale *= this.quality;
    this.scale = scale;
    const rw = Math.max(2, Math.floor(w * scale)), rh = Math.max(2, Math.floor(h * scale));
    this.size.set(rw, rh);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, true);
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.setSize(rw, rh);
    const texel = new THREE.Vector2(1 / rw, 1 / rh);
    this.ink.mat.uniforms.uTexel.value.copy(texel);
    this.fxaa.mat.uniforms.uTexel.value.copy(texel);
    this.ink.mat.uniforms.uNear.value = this.camera.near;
    this.ink.mat.uniforms.uFar.value = this.camera.far;
    // keep lines ~2 device px whatever the resolution
    this.ink.mat.uniforms.uThickness.value = 1.05 + 0.55 * scale;
  }

  /** Call after changing camera.near/far so the ink pass linearises depth correctly. */
  setClip(near: number, far: number): void {
    this.ink.mat.uniforms.uNear.value = near;
    this.ink.mat.uniforms.uFar.value = far;
  }

  render(): void {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);
    let src = this.rtScene.texture;
    if (this.enabled.ink) {
      this.ink.mat.uniforms.tDiffuse.value = src;
      r.setRenderTarget(this.rtA);
      this.ink.quad.render(r);
      src = this.rtA.texture;
    }
    this.grade.mat.uniforms.tDiffuse.value = src;
    r.setRenderTarget(this.enabled.fxaa ? this.rtB : null);
    this.grade.quad.render(r);
    if (this.enabled.fxaa) {
      this.fxaa.mat.uniforms.tDiffuse.value = this.rtB.texture;
      r.setRenderTarget(null);
      this.fxaa.quad.render(r);
    }
    r.setRenderTarget(null);
  }
}
