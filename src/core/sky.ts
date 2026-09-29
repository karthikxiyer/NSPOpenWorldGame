/*
 * Painted sky — the gradient dome approach is adapted from Sakura Crossing
 * (https://github.com/Kenton-GMI/sakura-crossing), Copyright (c) 2026 Kenton Wang, MIT License.
 *
 * On a small planet "up" changes as you travel, so the whole sky rig (dome + clouds) lives in
 * the player's local frame and is re-seated every frame.
 */
import * as THREE from 'three';
import { PAL } from './palette';
import { flat } from './toon';
import { rngKit } from './rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function cloudTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  const rng = rngKit(91);
  g.fillStyle = '#fff';
  // a flat-bottomed cumulus built from overlapping puffs
  for (let i = 0; i < 14; i++) {
    const x = 30 + rng.range(0, 196), r = rng.range(16, 34);
    const y = 70 - r * rng.range(0.4, 0.9);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.clearRect(0, 74, 256, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  readonly rig = new THREE.Group();
  private uniforms;

  constructor(scene: THREE.Scene, radius = 380) {
    this.uniforms = {
      uTop: { value: new THREE.Color(PAL.skyTop) },
      uMid: { value: new THREE.Color(PAL.skyMid) },
      uHaze: { value: new THREE.Color(PAL.skyHaze) },
      uBands: { value: 26 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vLocal;
          void main() {
            vLocal = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uMid, uHaze;
          uniform float uBands;
          varying vec3 vLocal;
          void main() {
            float h = normalize( vLocal ).y;
            float t = clamp( h * 1.15 + 0.06, 0.0, 1.0 );
            float q = floor( t * uBands ) / uBands;
            t = mix( t, q, 0.35 ); // faint painted banding
            vec3 col = mix( uHaze, uMid, smoothstep( 0.0, 0.30, t ) );
            col = mix( col, uTop, smoothstep( 0.26, 0.92, t ) );
            col = mix( col, uHaze, smoothstep( 0.12, -0.05, h ) * 0.6 );
            gl_FragColor = vec4( col, 1.0 );
          }
        `,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.rig.add(dome);

    const tex = cloudTexture();
    const matA = flat({ color: PAL.cloud, map: tex, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
    const matB = flat({ color: PAL.cloudShade, map: tex, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
    // clouds: billboards facing the middle, merged into two meshes (front puffs and shade)
    const rng = rngKit(7781);
    const fronts: THREE.BufferGeometry[] = [], backs: THREE.BufferGeometry[] = [];
    const o = new THREE.Object3D();
    for (let i = 0; i < 20; i++) {
      const r = rng.range(230, 330), a = rng.range(0, Math.PI * 2);
      const w = rng.range(80, 190), h = w * rng.range(0.32, 0.42);
      const y = rng.range(28, 120);
      o.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      o.lookAt(0, y * 0.55, 0);
      o.updateMatrix();
      fronts.push(new THREE.PlaneGeometry(w, h).applyMatrix4(o.matrix));
      backs.push(new THREE.PlaneGeometry(w, h).translate(2, -h * 0.08, -1.5).applyMatrix4(o.matrix));
    }
    const back = new THREE.Mesh(mergeGeometries(backs)!, matB);
    const front = new THREE.Mesh(mergeGeometries(fronts)!, matA);
    back.renderOrder = front.renderOrder = -9;
    back.frustumCulled = front.frustumCulled = false;
    this.rig.add(back, front);
    this.rig.matrixAutoUpdate = false;
    scene.add(this.rig);
  }

  setClouds(visible: boolean): void {
    this.rig.children.forEach((c, i) => { if (i > 0) c.visible = visible; });
  }

  /** Seat the sky in the player's local frame, centred on the camera. */
  update(frame: THREE.Matrix4, cameraPos: THREE.Vector3): void {
    this.rig.matrix.copy(frame).setPosition(cameraPos);
    this.rig.matrixWorldNeedsUpdate = true;
  }
}
