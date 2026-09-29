import * as THREE from 'three';
import './style.css';
import { LIFE_DESKTOP, LIFE_MOBILE, START } from './config';
import { Player } from './entities/Player';
import { CB350RS, HARRIER, Vehicle } from './entities/Vehicle';
import { Input } from './input/Input';
import { Life } from './life/Life';
import { signBoard } from './life/models';
import type { Body } from './life/Spatial';
import { Hud, hideLoading, setLoading, showError } from './ui/Hud';
import { World } from './world/World';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const mobile = input.isTouch;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const SKY = new THREE.Color('#c9dff0');
const scene = new THREE.Scene();
scene.background = SKY;
const viewDist = mobile ? 650 : 950;
scene.fog = new THREE.Fog(SKY, viewDist * 0.3, viewDist);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, viewDist + 200);
scene.add(new THREE.HemisphereLight('#dcecff', '#9c8a66', 1.9));
const sun = new THREE.DirectionalLight('#fff4e0', 2.0);
sun.position.set(-0.5, 1, 0.35).multiplyScalar(100);
scene.add(sun);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- world & actors ----------
const world = new World(mobile ? 650 : 900);
scene.add(world.root);
const player = new Player();
const bike = new Vehicle(CB350RS);
const harrier = new Vehicle(HARRIER);
const vehicles = [bike, harrier];
scene.add(player.model.root, bike.model.root, harrier.model.root);

// camera state
let camYaw = 0;
let camPitch = 0.28;
let camDistScale = 1;
let lastLook = -10;
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();

function project(lat: number, lon: number): { x: number; z: number } {
  const { origin, scale } = world.index;
  return { x: (lon - origin.lon) * scale.kx, z: -(lat - origin.lat) * scale.kz };
}

/** ?at=lat,lon overrides the default start (the 3rd Road Taaki board). */
function spawnPoint(): { x: number; z: number; board: boolean } {
  const q = new URLSearchParams(location.search).get('at');
  if (q) {
    const [lat, lon] = q.split(',').map(Number);
    if (!isNaN(lat) && !isNaN(lon)) return { ...project(lat, lon), board: false };
  }
  return { ...project(START.lat, START.lon), board: true };
}

let life: Life | null = null;

async function start() {
  await world.init(setLoading);
  const sp = spawnPoint();
  await world.preload(sp.x, sp.z, setLoading);

  // park both vehicles on the nearest road: the bike ahead with a clear road,
  // the Harrier far enough behind that it stays out of the spawn camera
  const road = world.nearestRoadPoint(sp.x, sp.z, 1, 7) ?? { x: sp.x, z: sp.z, heading: 0 };
  const fx = -Math.sin(road.heading), fz = -Math.cos(road.heading);
  bike.place(road.x, road.z, road.heading);
  harrier.place(road.x - fx * 12, road.z - fz * 12, road.heading);
  // player stands on the kerb side next to the bike, facing it
  player.place(road.x + fz * 1.6 + fx * 0.5, road.z - fx * 1.6 + fz * 0.5, road.heading - Math.PI / 2);
  camYaw = road.heading;
  if (sp.board) {
    // the board stands on the kerb just ahead of the bike, its face toward the rider
    const board = signBoard(START.board);
    board.position.set(road.x + fz * 2.6 + fx * 4, 0, road.z - fx * 2.6 + fz * 4);
    board.rotation.y = road.heading;
    scene.add(board);
  }

  setLoading(0.95, 'Waking up the streets…');
  life = new Life(scene, world, mobile ? LIFE_MOBILE : LIFE_DESKTOP);

  setLoading(1, 'Ready');
  hideLoading();
  const hud = new Hud();
  loop(hud);
}

const playerBody: Body = { x: 0, z: 0, r: 0.4, kind: 'player', ref: player };
const vehicleBodies = new Map<Vehicle, Body[]>();
/** The player and both vehicles, as obstacles the traffic and people react to. */
function actorBodies(): Body[] {
  const out: Body[] = [];
  if (!player.vehicle) {
    playerBody.x = player.x;
    playerBody.z = player.z;
    out.push(playerBody);
  }
  for (const v of vehicles) {
    let list = vehicleBodies.get(v);
    if (!list) vehicleBodies.set(v, (list = v.spec.circles.map(() => ({ x: 0, z: 0, r: 0, kind: 'player' as const, ref: v }))));
    v.circlesWorld().forEach((c, i) => Object.assign(list![i], c));
    out.push(...list);
  }
  return out;
}

function nearestVehicle(): { v: Vehicle; d: number } | null {
  let best: { v: Vehicle; d: number } | null = null;
  for (const v of vehicles) {
    const d = Math.hypot(v.x - player.x, v.z - player.z);
    if (d < 3.2 && (!best || d < best.d)) best = { v, d };
  }
  return best;
}

function loop(hud: Hud) {
  const clock = new THREE.Clock();
  let areaTimer = 0;
  const debug = new URLSearchParams(location.search).has('debug');
  let frames = 0, fpsTime = 0;

  const frame = () => {
    const dt = Math.max(1e-4, Math.min(clock.getDelta(), 1 / 20));
    const t = clock.elapsedTime;
    const inp = input.read();
    const driving = player.vehicle;

    // enter / exit
    if (input.consume('KeyE') || input.consume('KeyF')) {
      if (driving) {
        if (driving.kmh < 12) player.exit(scene, world);
      } else {
        const nv = nearestVehicle();
        if (nv) {
          player.enter(nv.v);
          camYaw = nv.v.heading;
        }
      }
    }
    if (input.consume('KeyC')) camDistScale = camDistScale === 1 ? 1.6 : camDistScale === 1.6 ? 0.7 : 1;

    // camera look
    if (inp.lookX || inp.lookY) {
      camYaw -= inp.lookX;
      camPitch = THREE.MathUtils.clamp(camPitch + inp.lookY, -0.1, 1.2);
      lastLook = t;
    }

    // simulate
    for (const v of vehicles) v.update(dt, v === player.vehicle ? inp : null, world, vehicles);
    player.update(dt, inp, camYaw, world, vehicles);

    const focus = player.vehicle ?? player;
    world.update(focus.x, focus.z, t);
    life?.update(dt, focus.x, focus.z, actorBodies());

    // chase camera: swing back behind the vehicle unless the player is looking around
    const v = player.vehicle;
    const spec = v?.spec.cam ?? { dist: 4.6, height: 1.7, look: 1.5 };
    if (v && t - lastLook > 1.2 && Math.abs(v.speed) > 1) {
      const target = v.speed >= 0 ? v.heading : v.heading + Math.PI;
      let diff = target - camYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      camYaw += diff * Math.min(1, dt * 3);
      camPitch += (0.22 - camPitch) * Math.min(1, dt * 1.5);
    }
    const dist = spec.dist * camDistScale * (v ? 1 + Math.abs(v.speed) / 120 : 1);
    camTarget.set(focus.x, spec.look, focus.z);
    const bx = Math.sin(camYaw), bz = Math.cos(camYaw);
    const desired = new THREE.Vector3(
      focus.x + bx * dist * Math.cos(camPitch),
      spec.look + spec.height * 0.4 + dist * Math.sin(camPitch),
      focus.z + bz * dist * Math.cos(camPitch),
    );
    desired.y = Math.max(desired.y, 0.6);
    if (camPos.lengthSq() === 0) camPos.copy(desired);
    camPos.lerp(desired, Math.min(1, dt * 10));
    camera.position.copy(camPos);
    if (v && v.impact > 0.2) camera.position.y += (Math.random() - 0.5) * v.impact * 0.4;
    camera.lookAt(camTarget);
    const fov = 62 + (v ? Math.min(14, Math.abs(v.speed) * 0.3) : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
    // keep the sun's light direction fixed relative to the player (no shadows, so position doesn't matter much)
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.set(focus.x - 50, 100, focus.z + 35);

    // HUD
    areaTimer -= dt;
    if (areaTimer <= 0) {
      areaTimer = 0.5;
      const p = world.nearestPlace(focus.x, focus.z);
      hud.setArea(p?.n ?? 'Vasai-Virar', p?.mr);
    }
    if (v) {
      hud.setDriving(v.spec.name, v.kmh);
      hud.setPrompt(v.kmh < 3 ? `${input.isTouch ? 'Tap' : 'Press'} E to get off` : null);
      hud.setActionVisible(v.kmh < 12);
    } else {
      hud.setDriving(null);
      const nv = nearestVehicle();
      const verb = nv?.v.spec.kind === 'bike' ? 'ride' : 'drive';
      hud.setPrompt(nv ? `${input.isTouch ? 'Tap' : 'Press'} E to ${verb} the ${nv.v.spec.name}` : null);
      hud.setActionVisible(!!nv);
    }

    renderer.render(scene, camera);

    if (debug) {
      frames++;
      fpsTime += dt;
      if (fpsTime > 1) {
        console.log(`fps ${frames} calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`);
        frames = 0;
        fpsTime = 0;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// handy for testing from the console
Object.assign(window, {
  game: {
    world, player, bike, harrier, camera,
    get life() { return life; },
    get camYaw() { return camYaw; },
    set camYaw(v: number) { camYaw = v; lastLook = performance.now() / 1000; },
  },
});

start().catch((e) => {
  console.error(e);
  showError(`Could not load the map: ${e.message}`);
});
