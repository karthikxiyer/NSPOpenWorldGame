import * as THREE from 'three';
import './style.css';
import { mergeByMaterial } from './art/merge';
import { blobShadows } from './art/vehicleModels';
import { hullOutlineTree, setOutlineResolution } from './core/outline';
import { PAL } from './core/palette';
import { Pipeline } from './core/post';
import { Sky } from './core/sky';
import { Player } from './entities/Player';
import { CB350RS, HARRIER, Vehicle } from './entities/Vehicle';
import { Input } from './input/Input';
import { Hud, hideLoading, setLoading, showError } from './ui/Hud';
import { buildWorld } from './world/build';
import { CURVE, curvePoint, curveTree } from './world/curve';
import { loadPatch, type Patch } from './world/patch';
import { Terrain } from './world/Terrain';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
/** phones, or ?lite: no shadow maps, no supersampling */
const lite = input.isTouch || params.has('lite');

/** tiny planet on the title screen, gentle horizon in play */
const R_TITLE = 380;
const R_PLAY = 900;
const VIEW_RANGE = 380; // beyond this the curve has dropped everything below the horizon
const INTRO_SECONDS = 3.2;
const FOG_PLAY: [number, number] = [90, 420];

// ---------- renderer, scene, lights ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false;
renderer.shadowMap.enabled = !lite;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(new THREE.Color(PAL.fog), 1);
blobShadows.enabled = !renderer.shadowMap.enabled;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PAL.fog, 1e4, 2e4);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.25, 4000);

// Two-light anime setup: a warm quantised key, a strong cool bounce so shadows are coloured,
// a weak up-light and a warm hemisphere. The world is bent around the focus, so "up" there is +y.
const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.6).normalize();
const FILL_DIR = new THREE.Vector3(-0.6, 0.4, -0.6).normalize();
const BOUNCE_DIR = new THREE.Vector3(0.1, -0.4, -0.8).normalize();
const sun = new THREE.DirectionalLight(PAL.sun, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
const fill = new THREE.DirectionalLight(PAL.fill, 1.2);
const bounce = new THREE.DirectionalLight(PAL.bounce, 0.32);
const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.35);
scene.add(sun, sun.target, fill, fill.target, bounce, bounce.target, hemi);

const pipeline = new Pipeline(renderer, scene, camera, { lite });
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
  mergeByMaterial(root);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.blob) o.castShadow = true;
  });
  // hero outlines cost a draw call per part; phones rely on the screen-space ink alone
  if (!lite) hullOutlineTree(root, 0.0026);
  curveTree(root);
  scene.add(root);
}
let lastVehicle: Vehicle = bike;

type Mode = 'title' | 'intro' | 'play';
let mode: Mode = 'title';

// camera state (flat space)
let camYaw = 0;
let camPitch = 0.16;
let camDistScale = 1;
let lastLook = -10;
const camFlat = new THREE.Vector3();
let camInit = false;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const identity = new THREE.Matrix4();

function nearestVehicle(): Vehicle | null {
  let best: Vehicle | null = null, bd = 3.2;
  for (const v of vehicles) {
    const d = Math.hypot(v.x - player.x, v.z - player.z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function seatLight(light: THREE.DirectionalLight, dir: THREE.Vector3, target: THREE.Vector3, dist: number) {
  light.position.copy(target).addScaledVector(dir, dist);
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
}

/** HUD label: a landmark if you're near one, else the street you're on, else the locality. */
function areaLabel(patch: Patch, terrain: Terrain, x: number, z: number): { n: string; mr?: string } {
  const [wx, wz] = terrain.wrap(x, z);
  let best: { n: string; mr?: string } | null = null, bd = Infinity;
  for (const l of patch.labels) {
    const d = Math.hypot(l.x - wx, l.z - wz);
    if (d < l.r && d < bd) { bd = d; best = l; }
  }
  if (best) return best;
  bd = 30;
  for (const r of patch.roadNames) {
    const d = Math.hypot(r.x - wx, r.z - wz);
    if (d < bd) { bd = d; best = r; }
  }
  if (best) return best;
  bd = Infinity;
  for (const p of patch.places) {
    const d = Math.hypot(p.x - wx, p.z - wz);
    if (d < bd) { bd = d; best = p; }
  }
  return best ?? { n: 'Nallasopara West' };
}

async function start() {
  setLoading(0.15, 'Loading Nallasopara…');
  const { patch, ground } = await loadPatch();
  setLoading(0.5, 'Building streets…');
  await new Promise((r) => setTimeout(r, 20));
  const t0 = performance.now();
  const terrain = new Terrain(patch, ground);
  const built = buildWorld(patch, ground, terrain);
  scene.add(built.view.root);
  if (!lite) for (const h of built.heroes) hullOutlineTree(h, 0.003);
  if (debug) console.log(`world built in ${Math.round(performance.now() - t0)} ms`);
  const sky = new Sky(scene);
  sky.setClouds(false);

  // spawn: the bike on the road beside the tank, the Harrier behind it, you between bike and tank
  const sp = patch.spawn;
  const fwd = { x: -Math.sin(sp.heading), z: -Math.cos(sp.heading) };
  const nrm = { x: -fwd.z, z: fwd.x }; // normal to the road; sp.side points toward the tank
  bike.place(sp.x, sp.z, sp.heading);
  harrier.place(sp.x - fwd.x * 10, sp.z - fwd.z * 10, sp.heading);
  player.place(sp.x + nrm.x * sp.side * 1.5, sp.z + nrm.z * sp.side * 1.5, sp.heading);
  // opening frame: swing the camera round so the tank and its board are in view beside the bike
  camYaw = sp.heading - 0.7 * sp.side;
  CURVE.uCurveCenter.value.set(patch.tank.x, patch.tank.z);
  CURVE.uCurveR.value = R_TITLE;

  setLoading(1, 'Ready');
  hideLoading();
  const title = document.getElementById('title')!;
  title.hidden = false;
  let hud: Hud | null = null;
  let introT = 0;
  const begin = (ride: boolean) => {
    if (mode !== 'title') return;
    if (ride) {
      player.enter(bike);
      lastVehicle = bike;
    }
    mode = 'intro';
    introT = 0;
    title.classList.add('fade');
    setTimeout(() => (title.hidden = true), 700);
  };
  document.getElementById('btn-ride')!.addEventListener('click', () => begin(true));
  document.getElementById('btn-walk')!.addEventListener('click', () => begin(false));
  addEventListener('keydown', (e) => {
    if (mode !== 'title') return;
    if (e.code === 'Enter' || e.code === 'KeyR') begin(true);
    if (e.code === 'KeyW' && e.shiftKey) begin(false);
  });
  if (params.has('play')) begin(params.get('play') !== 'walk');

  const hintFoot = input.isTouch ? 'Left stick to walk · E to get on · CALL brings your ride · drag to look' : 'WASD walk · Shift run · E get on · V call your ride · C camera · drag to look · H hide';
  const hintRide = input.isTouch ? 'Push up to go, down to brake · E to get off when stopped' : 'W/S throttle & brake · A/D steer · Space brake · E get off when stopped';
  const vy = new Map<Vehicle, number>();
  const clock = new THREE.Clock();
  let orbit = 0.6, areaTimer = 0, frames = 0, fpsT = 0;

  const frameFn = () => {
    const dt = Math.max(1e-4, Math.min(clock.getDelta(), 1 / 20));
    const t = clock.elapsedTime;
    const inp = input.read();
    const playing = mode === 'play';

    // ---- actions (play only) ----
    if (playing) {
      const riding = player.vehicle;
      if (input.consume('KeyE') || input.consume('KeyF')) {
        if (riding) {
          if (riding.kmh < 12) player.exit(scene, terrain);
        } else {
          const nv = nearestVehicle();
          if (nv) { player.enter(nv); lastVehicle = nv; camYaw = nv.heading; }
        }
      }
      if (input.consume('KeyV') && !riding) {
        const v = lastVehicle;
        if (Math.hypot(v.x - player.x, v.z - player.z) > 4) {
          const fx = -Math.sin(player.heading), fz = -Math.cos(player.heading);
          const res = terrain.collide(player.x + fx * 3, player.z + fz * 3, v.spec.kind === 'car' ? 1.2 : 0.6, true);
          v.place(res.x, res.z, player.heading);
          vy.set(v, terrain.heightAt(res.x, res.z));
        }
      }
      if (input.consume('KeyC')) camDistScale = camDistScale === 1 ? 1.6 : camDistScale === 1.6 ? 0.7 : 1;
      if (input.consume('KeyH')) hud?.toggleHint();
      if (inp.lookX || inp.lookY) {
        camYaw -= inp.lookX;
        camPitch = THREE.MathUtils.clamp(camPitch + inp.lookY, -0.05, 1.2);
        lastLook = t;
      }
    }

    // ---- simulate (flat, wrapping) ----
    const idle = { x: 0, y: 0, throttle: 0, brake: 0, alt: false, lookX: 0, lookY: 0 };
    for (const v of vehicles) {
      v.update(dt, playing && v === player.vehicle ? inp : null, terrain, vehicles);
      const target = terrain.heightAt(v.x, v.z);
      const y = vy.get(v) ?? target;
      vy.set(v, y + (target - y) * Math.min(1, dt * 12));
    }
    player.update(dt, playing ? inp : idle, camYaw, terrain, vehicles);

    // fold whoever crossed an edge back into the patch; the camera follows the focus across
    const focusBefore = player.vehicle ?? player;
    const fbx = focusBefore.x, fbz = focusBefore.z;
    const bd = patch.bounds;
    for (const a of [bike, harrier, player] as const) {
      if (a === player && player.vehicle) continue;
      if (a.x >= bd.minX && a.x < bd.maxX && a.z >= bd.minZ && a.z < bd.maxZ) continue;
      const [wx, wz] = terrain.wrap(a.x, a.z);
      // move without resetting speed or heading
      a.x = wx;
      a.z = wz;
      if (a === player) player.sync();
    }
    const focus = player.vehicle ?? player;
    camFlat.x += focus.x - fbx;
    camFlat.z += focus.z - fbz;

    // ---- place actors at their copy nearest the focus ----
    const near = (x: number, z: number): [number, number] => [
      x + Math.round((focus.x - x) / terrain.W) * terrain.W,
      z + Math.round((focus.z - z) / terrain.H) * terrain.H,
    ];
    for (const v of vehicles) {
      const [x, z] = near(v.x, v.z);
      v.model.root.position.set(x, vy.get(v) ?? 0, z);
    }
    if (!player.vehicle) player.model.root.position.y = terrain.heightAt(player.x, player.z);

    // ---- curve, camera ----
    const fy = player.vehicle ? (vy.get(player.vehicle) ?? 0) : terrain.heightAt(player.x, player.z);
    const spec = player.vehicle?.spec.cam ?? { dist: 4.8, height: 1.8, look: 1.5 };
    const v = player.vehicle;
    if (v && t - lastLook > 1.2 && Math.abs(v.speed) > 1) {
      const target = v.speed >= 0 ? v.heading : v.heading + Math.PI;
      camYaw += Math.atan2(Math.sin(target - camYaw), Math.cos(target - camYaw)) * Math.min(1, dt * 3);
      camPitch += (0.2 - camPitch) * Math.min(1, dt * 1.5);
    }
    const dist = spec.dist * camDistScale * (v ? 1 + Math.abs(v.speed) / 120 : 1);
    const dx = focus.x + Math.sin(camYaw) * dist * Math.cos(camPitch);
    const dz = focus.z + Math.cos(camYaw) * dist * Math.cos(camPitch);
    const dy = Math.max(fy + 0.7, fy + spec.look + spec.height * 0.4 + dist * Math.sin(camPitch));
    if (!camInit) { camFlat.set(dx, dy, dz); camInit = true; }
    const k = Math.min(1, dt * 10);
    camFlat.x += (dx - camFlat.x) * k;
    camFlat.y += (dy - camFlat.y) * k;
    camFlat.z += (dz - camFlat.z) * k;

    let e = 0; // 0 = title, 1 = play
    if (mode === 'intro') {
      introT += dt / INTRO_SECONDS;
      e = introT >= 1 ? 1 : introT * introT * (3 - 2 * introT);
      if (introT >= 1) {
        mode = 'play';
        hud = new Hud();
        if (input.isTouch) document.getElementById('touch')!.hidden = false;
        sky.setClouds(true);
      }
    } else if (mode === 'play') e = 1;

    const tank = patch.tank;
    CURVE.uCurveR.value = Math.exp(Math.log(R_TITLE) + (Math.log(R_PLAY) - Math.log(R_TITLE)) * e);
    CURVE.uCurveCenter.value.set(tank.x + (focus.x - tank.x) * e, tank.z + (focus.z - tank.z) * e);

    // play camera (through the current curve)
    curvePoint(camFlat.x, camFlat.y, camFlat.z, tmpA);
    curvePoint(focus.x, fy + spec.look, focus.z, tmpB);
    if (e < 1) {
      // title orbit around the planet's centre, blended into the chase camera
      orbit += dt * 0.08 * (1 - e);
      const R = CURVE.uCurveR.value, c = CURVE.uCurveCenter.value;
      // pull back on short (landscape phone) screens so the planet clears the title text
      const D = R * (innerHeight < 520 ? 3.9 : 3.1);
      const ox = c.x + Math.sin(orbit) * Math.cos(0.5) * D, oy = -R + Math.sin(0.5) * D, oz = c.y + Math.cos(orbit) * Math.cos(0.5) * D;
      const tx = c.x, ty = -R * 1.35, tz = c.y; // aim below the centre so the planet sits above the title text
      const w = e * e * (3 - 2 * e);
      tmpA.set(ox + (tmpA.x - ox) * w, oy + (tmpA.y - oy) * w, oz + (tmpA.z - oz) * w);
      tmpB.set(tx + (tmpB.x - tx) * w, ty + (tmpB.y - ty) * w, tz + (tmpB.z - tz) * w);
      (scene.fog as THREE.Fog).near = 1e4 + (FOG_PLAY[0] - 1e4) * w;
      (scene.fog as THREE.Fog).far = 2e4 + (FOG_PLAY[1] - 2e4) * w;
      camera.far = 4000 + (700 - 4000) * w;
    } else {
      (scene.fog as THREE.Fog).near = FOG_PLAY[0];
      (scene.fog as THREE.Fog).far = FOG_PLAY[1];
      camera.far = 700;
    }
    const dbg = (window as unknown as { game?: { debugCam?: number[] } }).game?.debugCam;
    if (dbg) {
      // testing aid: a fixed flat-space camera [x, y, z, tx, ty, tz]
      curvePoint(dbg[0], dbg[1], dbg[2], tmpA);
      curvePoint(dbg[3], dbg[4], dbg[5], tmpB);
    }
    camera.position.copy(tmpA);
    camera.up.set(0, 1, 0);
    camera.lookAt(tmpB);
    if (v && v.impact > 0.2 && playing) camera.position.y += (Math.random() - 0.5) * v.impact * 0.4;
    const fov = 55 + (v && playing ? Math.min(12, Math.abs(v.speed) * 0.28) : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    pipeline.setClip(camera.near, camera.far);

    // chunks nearest the focus; everything visible while it's still a planet
    built.view.update(CURVE.uCurveCenter.value.x, CURVE.uCurveCenter.value.y, e < 1 ? 1e5 : VIEW_RANGE);

    // lights & sky
    const g = curvePoint(focus.x, 0, focus.z, tmpB);
    seatLight(sun, SUN_DIR, g, 110);
    seatLight(fill, FILL_DIR, g, 60);
    seatLight(bounce, BOUNCE_DIR, g, 60);
    sky.update(identity, camera.position);

    // HUD
    if (hud) {
      areaTimer -= dt;
      if (areaTimer <= 0) {
        areaTimer = 0.4;
        const a = areaLabel(patch, terrain, focus.x, focus.z);
        hud.setArea(a.n, a.mr);
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
    }

    renderer.info.reset();
    pipeline.render();
    if (debug) {
      frames++;
      fpsT += dt;
      if (fpsT > 1) {
        console.log(`fps ${frames} calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles} mode ${mode}`);
        frames = 0;
        fpsT = 0;
      }
    }
    requestAnimationFrame(frameFn);
  };
  requestAnimationFrame(frameFn);

  Object.assign(window, { game: { scene, patch, terrain, player, bike, harrier, camera, CURVE, get mode() { return mode; }, begin,
    get camYaw() { return camYaw; }, set camYaw(v: number) { camYaw = v; lastLook = performance.now() / 1000; } } });
}

start().catch((e) => {
  console.error(e);
  showError(`Could not load the map: ${e.message}`);
});
