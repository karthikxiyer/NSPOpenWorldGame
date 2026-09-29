import * as THREE from 'three';

// Low-poly models built from primitives. All models face -Z (forward) with +Y up and origin on the ground.

const matCache = new Map<string, THREE.Material>();
function mat(color: string, opts: { emissive?: string; metal?: boolean; glass?: boolean } = {}): THREE.Material {
  const k = `${color}|${opts.emissive ?? ''}|${opts.metal ? 1 : 0}|${opts.glass ? 1 : 0}`;
  let m = matCache.get(k);
  if (!m) {
    m = opts.glass
      ? new THREE.MeshPhongMaterial({ color, shininess: 30, specular: new THREE.Color('#3a4650') })
      : opts.metal
      ? new THREE.MeshPhongMaterial({ color, shininess: 90, specular: new THREE.Color('#ffffff') })
      : new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? '#000000' });
    matCache.set(k, m);
  }
  return m;
}

function box(w: number, h: number, d: number, color: string | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'string' ? mat(color) : color);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt: number, rb: number, h: number, color: string | THREE.Material, seg = 12): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'string' ? mat(color) : color);
}

/** A soft round shadow disc under a model. */
export function blobShadow(rx: number, rz: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(rx * 2, rz * 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.16;
  m.renderOrder = 1;
  return m;
}

// ---------- person ----------
export interface PersonModel {
  root: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  helmet: THREE.Object3D;
}

export function makePerson(shirt = '#c0392b'): PersonModel {
  const root = new THREE.Group();
  const skin = '#b07a55';
  const jeans = '#2c3e66';

  const mkLimb = (w: number, len: number, color: string, x: number, y: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = box(w, len, w, color, 0, -len / 2, 0);
    pivot.add(m);
    root.add(pivot);
    return pivot;
  };
  const legL = mkLimb(0.17, 0.85, jeans, -0.11, 0.88);
  const legR = mkLimb(0.17, 0.85, jeans, 0.11, 0.88);
  // shoes
  legL.add(box(0.18, 0.08, 0.28, '#222', 0, -0.83, -0.05));
  legR.add(box(0.18, 0.08, 0.28, '#222', 0, -0.83, -0.05));
  root.add(box(0.44, 0.62, 0.24, shirt, 0, 1.18, 0));
  const armL = mkLimb(0.13, 0.62, shirt, -0.3, 1.46);
  const armR = mkLimb(0.13, 0.62, shirt, 0.3, 1.46);
  armL.add(box(0.11, 0.12, 0.11, skin, 0, -0.66, 0));
  armR.add(box(0.11, 0.12, 0.11, skin, 0, -0.66, 0));
  root.add(box(0.14, 0.1, 0.14, skin, 0, 1.53, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(skin));
  head.position.set(0, 1.71, 0);
  root.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#1b1410'));
  hair.position.set(0, 1.73, 0.01);
  root.add(hair);
  const helmet = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), mat('#111111'));
  helmet.add(shell);
  const visor = box(0.3, 0.1, 0.05, mat('#2a3440', { metal: true }), 0, -0.02, -0.18);
  helmet.add(visor);
  helmet.position.set(0, 1.72, 0);
  helmet.visible = false;
  root.add(helmet);
  root.add(blobShadow(0.4, 0.4));
  return { root, legL, legR, armL, armR, helmet };
}

/** Walk cycle: phase in radians, amount 0..1 */
export function animateWalk(p: PersonModel, phase: number, amount: number): void {
  const s = Math.sin(phase) * 0.7 * amount;
  p.legL.rotation.x = s;
  p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.8;
  p.armR.rotation.x = s * 0.8;
  p.armL.rotation.z = 0;
  p.armR.rotation.z = 0;
}

export function poseSeated(p: PersonModel, kind: 'bike' | 'car'): void {
  if (kind === 'bike') {
    p.legL.rotation.x = -1.2;
    p.legR.rotation.x = -1.2;
    p.legL.rotation.z = -0.25;
    p.legR.rotation.z = 0.25;
    p.armL.rotation.x = -1.1;
    p.armR.rotation.x = -1.1;
  } else {
    p.legL.rotation.x = -1.5;
    p.legR.rotation.x = -1.5;
    p.armL.rotation.x = -1.2;
    p.armR.rotation.x = -1.2;
  }
}

// ---------- wheels ----------
function wheel(radius: number, width: number, rim: string, spokes = 0): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius - width * 0.45, width * 0.45, 8, 20), mat('#161616'));
  tyre.rotation.y = Math.PI / 2;
  g.add(tyre);
  const hub = cyl(radius * 0.62, radius * 0.62, width * 0.7, rim, 16);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < spokes; i++) {
    const s = box(width * 0.4, radius * 1.3, 0.04, rim);
    s.rotation.x = (i / spokes) * Math.PI;
    g.add(s);
  }
  return g;
}

// ---------- Honda CB350RS (black with Pearl Sports Yellow) ----------
export interface VehicleModel {
  root: THREE.Group;
  body: THREE.Group; // leans / rolls
  wheels: THREE.Object3D[];
  frontFork?: THREE.Object3D;
  seat: THREE.Vector3; // rider hip position in root space
}

export function makeCB350RS(): VehicleModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const black = '#141414';
  const yellow = '#f2b705';
  const chrome = mat('#d9d9d9', { metal: true });
  const R = 0.32;
  const wb = 1.44;

  const rear = wheel(R, 0.16, '#1c1c1c', 5);
  rear.position.set(0, R, wb / 2);
  body.add(rear);

  const fork = new THREE.Group();
  fork.position.set(0, 0, -wb / 2);
  body.add(fork);
  const front = wheel(R, 0.12, '#1c1c1c', 5);
  front.position.set(0, R, 0);
  fork.add(front);
  // fork legs
  for (const x of [-0.09, 0.09]) {
    const leg = cyl(0.022, 0.022, 0.72, chrome, 8);
    leg.position.set(x, R + 0.33, 0.1);
    leg.rotation.x = -0.45;
    fork.add(leg);
  }
  // front fender (yellow accent)
  const ff = box(0.14, 0.03, 0.42, yellow, 0, R + 0.34, -0.02);
  fork.add(ff);
  // round LED headlamp
  const lamp = cyl(0.1, 0.1, 0.1, black, 16);
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0, 0.98, -0.6);
  body.add(lamp);
  const lens = cyl(0.085, 0.085, 0.02, mat('#fffbe8', { emissive: '#fff4c0' }), 16);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.98, -0.66);
  body.add(lens);
  // handlebar
  const bar = cyl(0.016, 0.016, 0.74, black, 6);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.07, -0.46);
  body.add(bar);
  for (const x of [-0.37, 0.37]) body.add(box(0.1, 0.035, 0.035, '#333', x, 1.07, -0.46));
  // mirrors
  for (const x of [-0.26, 0.26]) {
    const st = cyl(0.008, 0.008, 0.2, black, 4);
    st.position.set(x, 1.17, -0.45);
    body.add(st);
    const mi = cyl(0.045, 0.045, 0.02, black, 10);
    mi.rotation.x = Math.PI / 2;
    mi.position.set(x, 1.27, -0.45);
    body.add(mi);
  }
  // frame spine
  const spine = box(0.08, 0.08, 1.0, black, 0, 0.78, -0.05);
  spine.rotation.x = 0.12;
  body.add(spine);
  // teardrop tank: yellow with black top stripe (dual-tone)
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat(yellow));
  tank.scale.set(1.05, 0.75, 1.6);
  tank.position.set(0, 0.93, -0.22);
  body.add(tank);
  const stripe = box(0.08, 0.05, 0.56, black, 0, 1.075, -0.22);
  body.add(stripe);
  // tank badge
  for (const x of [-0.205, 0.205]) body.add(box(0.01, 0.05, 0.14, mat('#e8e8e8', { metal: true }), x, 0.93, -0.24));
  // engine: silver cylinder with fins + black crankcase
  const crank = box(0.3, 0.26, 0.42, '#1f1f1f', 0, 0.42, -0.02);
  body.add(crank);
  const cylBlock = box(0.24, 0.28, 0.24, '#8c8c8c', 0, 0.66, -0.16);
  cylBlock.rotation.x = -0.2;
  body.add(cylBlock);
  for (let i = 0; i < 4; i++) {
    const fin = box(0.3, 0.02, 0.3, '#a8a8a8', 0, 0.56 + i * 0.06, -0.16);
    fin.rotation.x = -0.2;
    body.add(fin);
  }
  // exhaust (right side), chrome with black heat shield
  const pipe = cyl(0.035, 0.035, 0.6, chrome, 8);
  pipe.rotation.x = Math.PI / 2 - 0.3;
  pipe.position.set(0.14, 0.4, -0.3);
  body.add(pipe);
  const muffler = cyl(0.055, 0.045, 0.62, black, 10);
  muffler.rotation.x = Math.PI / 2 - 0.12;
  muffler.position.set(0.2, 0.42, 0.42);
  body.add(muffler);
  const tip = cyl(0.046, 0.046, 0.04, chrome, 10);
  tip.rotation.x = Math.PI / 2 - 0.12;
  tip.position.set(0.2, 0.46, 0.74);
  body.add(tip);
  // side panel (yellow accent) and seat
  for (const x of [-0.13, 0.13]) body.add(box(0.02, 0.16, 0.26, yellow, x, 0.72, 0.22));
  const seat = box(0.28, 0.1, 0.62, '#1a1a1a', 0, 0.86, 0.28);
  seat.rotation.x = -0.05;
  body.add(seat);
  // rear subframe, fender, tail light
  body.add(box(0.16, 0.06, 0.36, black, 0, 0.8, 0.66));
  body.add(box(0.12, 0.04, 0.3, black, 0, R + 0.3, wb / 2 - 0.02));
  body.add(box(0.12, 0.05, 0.04, mat('#ff2a2a', { emissive: '#aa0000' }), 0, 0.83, 0.86));
  // number plate
  body.add(box(0.2, 0.1, 0.01, '#fffbe0', 0, 0.68, 0.9));
  // rear shocks
  for (const x of [-0.13, 0.13]) {
    const sh = cyl(0.025, 0.025, 0.36, '#e6c200', 8);
    sh.position.set(x, 0.55, 0.52);
    sh.rotation.x = 0.35;
    body.add(sh);
  }
  root.add(blobShadow(0.45, 1.2));
  return { root, body, wheels: [rear, front], frontFork: fork, seat: new THREE.Vector3(0, 0.96, 0.24) };
}

// ---------- Tata Harrier Kaziranga edition ----------
export function makeHarrierKaziranga(): VehicleModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // Kaziranga edition: Grassland Beige body, piano black roof, dark alloys, rhino badge
  const beige = mat('#b8a47e');
  const pianoBlack = mat('#0d0d0d', { metal: true });
  const cladding = '#262626';
  const glass = mat('#1d262e', { glass: true });
  const L = 4.6, W = 1.9;
  const R = 0.37;

  // lower body
  body.add(box(W, 0.62, L, beige, 0, 0.72, 0));
  // bonnet slope + front fascia
  const bonnet = box(W - 0.06, 0.16, 1.2, beige, 0, 1.07, -1.62);
  bonnet.rotation.x = 0.06;
  body.add(bonnet);
  // shoulder line
  body.add(box(W - 0.04, 0.2, 2.9, beige, 0, 1.12, 0.35));
  // greenhouse: tapered cabin
  const cabinGeo = new THREE.BoxGeometry(W - 0.2, 0.58, 2.7);
  const pos = cabinGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i), x = pos.getX(i);
    if (y > 0) {
      pos.setX(i, x * 0.9);
      // raked windscreen at the front (-z), steeper tailgate
      if (z < 0) pos.setZ(i, z + 0.55);
      else pos.setZ(i, z - 0.18);
    }
  }
  cabinGeo.computeVertexNormals();
  const cabin = new THREE.Mesh(cabinGeo, glass);
  cabin.position.set(0, 1.51, 0.35);
  body.add(cabin);
  // pillars in body colour so the glass reads as windows
  for (const x of [-(W - 0.2) / 2 + 0.04, (W - 0.2) / 2 - 0.04]) {
    const bp = box(0.05, 0.5, 0.1, beige, x * 0.95, 1.5, 0.35);
    body.add(bp);
  }
  // piano black roof with silver rails
  body.add(box(W - 0.42, 0.06, 1.95, pianoBlack, 0, 1.83, 0.45));
  for (const x of [-0.62, 0.62]) body.add(box(0.05, 0.05, 1.8, mat('#b0b0b0', { metal: true }), x, 1.89, 0.45));
  // front: grille, split lamps (slim LED DRL on top, main lamps lower), skid plate
  body.add(box(1.3, 0.34, 0.06, pianoBlack, 0, 0.83, -L / 2 - 0.02));
  for (const x of [-0.72, 0.72]) {
    body.add(box(0.42, 0.04, 0.05, mat('#ffffff', { emissive: '#e8f4ff' }), x, 1.1, -L / 2 - 0.02));
    body.add(box(0.3, 0.16, 0.05, mat('#dfe8ee', { emissive: '#8898a0' }), x, 0.8, -L / 2 - 0.02));
  }
  body.add(box(1.0, 0.1, 0.08, '#8a8a8a', 0, 0.44, -L / 2 - 0.01));
  // rear: full-width LED tail lamps + tailgate glass
  body.add(box(W - 0.2, 0.06, 0.05, mat('#ff2020', { emissive: '#aa0000' }), 0, 1.08, L / 2 + 0.01));
  for (const x of [-0.78, 0.78]) body.add(box(0.28, 0.12, 0.06, mat('#ff2a2a', { emissive: '#990000' }), x, 1.06, L / 2 + 0.01));
  body.add(box(0.5, 0.14, 0.02, '#fffbe0', 0, 0.8, L / 2 + 0.02));
  // black cladding around the lower body and wheel arches
  body.add(box(W + 0.04, 0.2, L - 0.3, cladding, 0, 0.47, 0));
  for (const z of [-1.43, 1.37]) {
    for (const s of [-1, 1]) body.add(box(0.1, 0.18, 1.0, cladding, s * (W / 2 + 0.01), 0.98, z));
  }
  // Kaziranga rhino badge (on the front fenders)
  for (const s of [-1, 1]) body.add(box(0.02, 0.06, 0.14, mat('#c9b27a', { metal: true }), s * (W / 2 + 0.06), 0.98, -1.05));
  // mirrors (piano black)
  for (const s of [-1, 1]) body.add(box(0.2, 0.12, 0.1, pianoBlack, s * (W / 2 + 0.06), 1.3, -0.72));

  const wheels: THREE.Object3D[] = [];
  const wb = 2.74;
  for (const [x, z] of [[-W / 2 + 0.12, -wb / 2 - 0.08], [W / 2 - 0.12, -wb / 2 - 0.08], [-W / 2 + 0.12, wb / 2 - 0.02], [W / 2 - 0.12, wb / 2 - 0.02]]) {
    const w = wheel(R, 0.26, '#2b2b2b', 5);
    w.position.set(x, R, z);
    root.add(w);
    wheels.push(w);
  }
  root.add(blobShadow(1.25, 2.6));
  // right-hand drive: driver sits on the right (+x when facing -z)
  return { root, body, wheels, seat: new THREE.Vector3(0.42, 1.0, 0.15) };
}
