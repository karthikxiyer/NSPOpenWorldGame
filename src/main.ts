import * as THREE from 'three';
import './style.css';
import { blobShadows } from './art/vehicleModels';
import { hullOutlineTree, setOutlineResolution } from './core/outline';
import { PAL } from './core/palette';
import { Pipeline } from './core/post';
import { Sky } from './core/sky';
import { Player } from './entities/Player';
import { CB350RS, HARRIER, Vehicle } from './entities/Vehicle';
import { Input } from './input/Input';
import { buildLoop } from './loop/build';
import { START, zoneAt } from './loop/layout';
import { frameAt, pin, toWorld } from './planet/planet';
import { Hud, hideLoading, setLoading, showError } from './ui/Hud';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
/** phones, or ?lite: no shadow maps, no supersampling */
const mobile = input.isTouch || params.has('lite');

// ---------- renderer, scene, lights ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false;
renderer.shadowMap.enabled = !mobile;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(new THREE.Color(PAL.fog), 1);
blobShadows.enabled = !renderer.shadowMap.enabled;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PAL.fog, 70, 290);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.25, 600);

// Two-light anime setup: a warm quantised key, a strong cool bounce so shadows are coloured
// rather than dark, a weak up-light, and a hemisphere with a warm dusty ground colour.
// Directions are in the player's local frame (x along the loop, y up, z across).
const sun = new THREE.DirectionalLight(PAL.sun, 2.7);
// low afternoon sun raking across the street fronts
const SUN_LOCAL = new THREE.Vector3(0.5, 0.62, -0.6).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 220 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
const fill = new THREE.DirectionalLight(PAL.fill, 1.2);
const FILL_LOCAL = new THREE.Vector3(-0.6, 0.4, 0.6).normalize();
const bounce = new THREE.DirectionalLight(PAL.bounce, 0.32);
const BOUNCE_LOCAL = new THREE.Vector3(0.1, -0.4, 0.8).normalize();
const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.35);
scene.add(sun, sun.target, fill, fill.target, bounce, bounce.target, hemi);

const pipeline = new Pipeline(renderer, scene, camera, { lite: mobile });
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pipeline.setSize(innerWidth, innerHeight);
  setOutlineResolution(pipeline.size.x, pipeline.size.y);
}
addEventListener('resize', resize);
resize();

// ---------- actors ----------
const player = new Player();
const bike = new Vehicle(CB350RS);
const harrier = new Vehicle(HARRIER);
const vehicles = [bike, harrier];
for (const root of [player.model.root, bike.model.root, harrier.model.root]) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.blob) o.castShadow = true;
  });
  // hero outlines cost a draw call per part; phones rely on the screen-space ink alone
  if (!mobile) hullOutlineTree(root, 0.0026);
  scene.add(root);
}
/** vehicle the player used last: that's the one V calls */
let lastVehicle: Vehicle = bike;

// camera state (flat space)
// opening frame: from behind the player, looking up at the Taaki with the board and bike in view
let camYaw = Math.atan2(START.player.x - START.taaki.x, START.player.z - START.taaki.z);
let camPitch = 0.12;
let camDistScale = 1;
let lastLook = -10;
const camFlat = new THREE.Vector3();
let camInit = false;

const tmpV = new THREE.Vector3();
const tmpT = new THREE.Vector3();
const frame = frameAt(0, 0);
const frameM = new THREE.Matrix4();

function seatLight(light: THREE.DirectionalLight, local: THREE.Vector3, target: THREE.Vector3, dist: number) {
  tmpV.copy(frame.east).multiplyScalar(local.x).addScaledVector(frame.up, local.y).addScaledVector(frame.north, local.z);
  light.position.copy(target).addScaledVector(tmpV, dist);
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
}

function nearestVehicle(): Vehicle | null {
  let best: Vehicle | null = null, bd = 3.2;
  for (const v of vehicles) {
    const d = Math.hypot(v.x - player.x, v.z - player.z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

async function start() {
  setLoading(0.2, 'Building the loop…');
  await new Promise((r) => setTimeout(r, 30));
  const t0 = performance.now();
  const world = buildLoop(scene);
  const terrain = world.terrain;
  if (debug) console.log(`loop built in ${Math.round(performance.now() - t0)} ms`);
  const sky = new Sky(scene);

  bike.place(START.bike.x, START.bike.z, START.bike.heading);
  harrier.place(START.harrier.x, START.harrier.z, START.harrier.heading);
  player.place(START.player.x, START.player.z, START.player.heading);

  setLoading(1, 'Ready');
  hideLoading();
  const hud = new Hud();
  const hintFoot = input.isTouch ? 'Left stick to walk · E to get on · CALL brings your ride · drag to look' : 'WASD walk · Shift run · E get on · V call your ride · C camera · drag to look · H hide';
  const hintRide = input.isTouch ? 'Push up to go, down to brake · E to get off when stopped' : 'W/S throttle & brake · A/D steer · Space brake · E get off when stopped';
  const vy = new Map<Vehicle, number>();

  const clock = new THREE.Clock();
  let areaTimer = 0, frames = 0, fpsT = 0;

  const frameFn = () => {
    const dt = Math.max(1e-4, Math.min(clock.getDelta(), 1 / 20));
    const t = clock.elapsedTime;
    const inp = input.read();
    const riding = player.vehicle;

    // ---- actions ----
    if (input.consume('KeyE') || input.consume('KeyF')) {
      if (riding) {
        if (riding.kmh < 12) player.exit(scene, terrain);
      } else {
        const nv = nearestVehicle();
        if (nv) {
          player.enter(nv);
          lastVehicle = nv;
          camYaw = nv.heading;
        }
      }
    }
    if (input.consume('KeyV') && !riding) {
      // bring the ride round: park it just ahead of you, on the road if you're near it
      const v = lastVehicle;
      if (Math.hypot(v.x - player.x, v.z - player.z) > 4) {
        const fx = -Math.sin(player.heading), fz = -Math.cos(player.heading);
        let x = player.x + fx * 3, z = player.z + fz * 3;
        if (Math.abs(player.z) < 10) z = Math.max(-3.2, Math.min(3.2, z));
        const res = terrain.collide(x, z, v.spec.kind === 'car' ? 1.2 : 0.6, true);
        x = res.x;
        z = res.z;
        v.place(x, z, Math.abs(player.z) < 10 ? (fx >= 0 ? -Math.PI / 2 : Math.PI / 2) : player.heading);
        vy.set(v, terrain.heightAt(x, z));
      }
    }
    if (input.consume('KeyC')) camDistScale = camDistScale === 1 ? 1.6 : camDistScale === 1.6 ? 0.7 : 1;
    if (input.consume('KeyH')) hud.toggleHint();
    if (inp.lookX || inp.lookY) {
      camYaw -= inp.lookX;
      camPitch = THREE.MathUtils.clamp(camPitch + inp.lookY, -0.05, 1.2);
      lastLook = t;
    }

    // ---- simulate (flat) ----
    for (const v of vehicles) {
      v.update(dt, v === player.vehicle ? inp : null, terrain, vehicles);
      const target = terrain.heightAt(v.x, v.z);
      const y = vy.get(v) ?? target;
      const ny = y + (target - y) * Math.min(1, dt * 12);
      vy.set(v, ny);
      v.model.root.position.y = ny;
      pin(v.model.root);
    }
    player.update(dt, inp, camYaw, terrain, vehicles);
    if (!player.vehicle) {
      player.model.root.position.y = terrain.heightAt(player.x, player.z);
      pin(player.model.root);
    }

    // ---- chase camera, computed flat then bent ----
    const v = player.vehicle;
    const focus = v ?? player;
    const fy = v ? (vy.get(v) ?? 0) : terrain.heightAt(player.x, player.z);
    const spec = v?.spec.cam ?? { dist: 4.8, height: 1.8, look: 1.5 };
    if (v && t - lastLook > 1.2 && Math.abs(v.speed) > 1) {
      const target = v.speed >= 0 ? v.heading : v.heading + Math.PI;
      const diff = Math.atan2(Math.sin(target - camYaw), Math.cos(target - camYaw));
      camYaw += diff * Math.min(1, dt * 3);
      camPitch += (0.26 - camPitch) * Math.min(1, dt * 1.5);
    }
    const dist = spec.dist * camDistScale * (v ? 1 + Math.abs(v.speed) / 120 : 1);
    const desiredX = focus.x + Math.sin(camYaw) * dist * Math.cos(camPitch);
    const desiredZ = focus.z + Math.cos(camYaw) * dist * Math.cos(camPitch);
    const desiredY = Math.max(fy + 0.7, fy + spec.look + spec.height * 0.4 + dist * Math.sin(camPitch));
    if (!camInit) { camFlat.set(desiredX, desiredY, desiredZ); camInit = true; }
    const k = Math.min(1, dt * 10);
    camFlat.x += (desiredX - camFlat.x) * k;
    camFlat.y += (desiredY - camFlat.y) * k;
    camFlat.z += (desiredZ - camFlat.z) * k;
    toWorld(camFlat.x, camFlat.y, camFlat.z, camera.position);
    frameAt(focus.x, focus.z, frame);
    camera.up.copy(frame.up);
    camera.lookAt(toWorld(focus.x, fy + spec.look, focus.z, tmpT));
    if (v && v.impact > 0.2) camera.position.addScaledVector(frame.up, (Math.random() - 0.5) * v.impact * 0.4);
    const fov = 55 + (v ? Math.min(12, Math.abs(v.speed) * 0.28) : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }

    // ---- lights & sky follow the local frame ----
    const ground = toWorld(focus.x, 0, focus.z, tmpT);
    seatLight(sun, SUN_LOCAL, ground, 90);
    seatLight(fill, FILL_LOCAL, ground, 60);
    seatLight(bounce, BOUNCE_LOCAL, ground, 60);
    sun.shadow.camera.up.copy(frame.north);
    hemi.position.copy(frame.up);
    frameM.makeBasis(frame.east, frame.up, frame.north);
    sky.update(frameM, camera.position);

    // ---- HUD ----
    areaTimer -= dt;
    if (areaTimer <= 0) {
      areaTimer = 0.4;
      const z = zoneAt(focus.x);
      hud.setArea(z.name, z.mr);
    }
    if (v) {
      hud.setDriving(v.spec.name, v.kmh);
      hud.setPrompt(v.kmh < 3 ? `${input.isTouch ? 'Tap' : 'Press'} E to get off` : null);
      hud.setActionVisible(v.kmh < 12);
      hud.setHint(hintRide);
    } else {
      hud.setDriving(null);
      const nv = nearestVehicle();
      hud.setPrompt(nv ? `${input.isTouch ? 'Tap' : 'Press'} E to ${nv.spec.kind === 'bike' ? 'ride' : 'drive'} the ${nv.spec.name}` : null);
      hud.setActionVisible(!!nv);
      hud.setHint(hintFoot);
    }

    renderer.info.reset();
    pipeline.render();

    if (debug) {
      frames++;
      fpsT += dt;
      if (fpsT > 1) {
        console.log(`fps ${frames} calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`);
        frames = 0;
        fpsT = 0;
      }
    }
    requestAnimationFrame(frameFn);
  };
  requestAnimationFrame(frameFn);
}

// handy for testing from the console
Object.assign(window, {
  game: {
    player, bike, harrier, camera, pipeline,
    get camYaw() { return camYaw; },
    set camYaw(v: number) { camYaw = v; lastLook = performance.now() / 1000; },
  },
});

start().catch((e) => {
  console.error(e);
  showError(`Could not build the loop: ${e.message}`);
});
