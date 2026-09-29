import * as THREE from 'three';
import { Mesher } from './mesher';

// Low-poly models for traffic, people, animals and trains. All face -Z with origin on the ground.
// Tinted parts (last argument true) take the per-instance colour.

// ---------- traffic ----------

/** Mumbai-style auto-rickshaw: black body, yellow canopy. */
export function autoRickshaw(): THREE.BufferGeometry {
  const m = new Mesher();
  const black = '#161616', yellow = '#f1c40f';
  m.box(1.25, 0.5, 1.7, black, 0, 0.55, 0.25); // passenger tub
  m.box(0.7, 0.55, 0.9, black, 0, 0.6, -0.95); // front cowl
  m.box(0.72, 0.5, 0.06, yellow, 0, 1.1, -1.08); // front panel below the windscreen
  m.box(0.72, 0.42, 0.04, '#9fb4c2', 0, 1.42, -1.02); // windscreen
  m.box(1.3, 0.08, 2.0, yellow, 0, 1.78, 0.05); // canopy
  m.box(1.3, 0.95, 0.06, yellow, 0, 1.3, 1.05); // rear panel
  for (const x of [-0.62, 0.62]) m.box(0.05, 0.7, 0.05, black, x, 1.42, -0.55);
  m.box(1.1, 0.12, 0.5, '#3a2a20', 0, 0.86, 0.55); // seat
  m.box(0.5, 0.05, 0.05, '#222', 0, 1.18, -0.75); // handlebar
  m.box(0.14, 0.1, 0.03, '#ff3030', -0.5, 0.75, 1.1);
  m.box(0.14, 0.1, 0.03, '#ff3030', 0.5, 0.75, 1.1);
  m.box(0.16, 0.12, 0.04, '#fffbe0', 0, 0.9, -1.42);
  m.wheel(0.22, 0.14, 0, -1.2);
  m.wheel(0.22, 0.14, -0.6, 0.75);
  m.wheel(0.22, 0.14, 0.6, 0.75);
  return m.build();
}

/** Hatchback; body colour comes from the instance colour. */
export function hatchback(): THREE.BufferGeometry {
  const m = new Mesher();
  const glass = '#27313a';
  m.box(1.66, 0.62, 3.8, '#ffffff', 0, 0.62, 0, undefined, true);
  m.box(1.5, 0.52, 2.1, glass, 0, 1.19, 0.25);
  m.box(1.44, 0.06, 1.8, '#ffffff', 0, 1.47, 0.35, undefined, true);
  m.box(1.54, 0.18, 0.2, '#ffffff', 0, 1.02, -0.98, [-0.5, 0, 0], true); // bonnet slope
  m.box(1.2, 0.18, 0.04, '#202020', 0, 0.62, -1.91); // grille
  for (const x of [-0.6, 0.6]) {
    m.box(0.32, 0.12, 0.04, '#fffbe6', x, 0.78, -1.91);
    m.box(0.3, 0.14, 0.04, '#d02020', x, 0.85, 1.91);
  }
  m.box(1.7, 0.16, 3.82, '#2a2a2a', 0, 0.36, 0); // bumpers/skirts
  for (const [x, z] of [[-0.74, -1.25], [0.74, -1.25], [-0.74, 1.2], [0.74, 1.2]]) m.wheel(0.3, 0.2, x, z);
  return m.build();
}

/** Municipal bus. */
export function bus(): THREE.BufferGeometry {
  const m = new Mesher();
  const L = 11, W = 2.5;
  m.box(W, 1.2, L, '#e0622a', 0, 1.05, 0); // lower body
  m.box(W, 1.1, L, '#f3ead6', 0, 2.2, 0); // upper body
  m.box(W + 0.02, 0.8, L - 1.2, '#2b3640', 0, 2.2, 0.3); // side windows band
  m.box(W - 0.2, 1.0, 0.04, '#2b3640', 0, 2.2, -L / 2 - 0.01); // windscreen
  m.box(W, 0.12, L, '#cfcfcf', 0, 2.81, 0); // roof
  m.box(0.9, 0.3, 0.04, '#111', 0, 2.62, -L / 2 - 0.02); // destination board
  m.box(0.8, 0.2, 0.03, '#ffb000', 0, 2.62, -L / 2 - 0.04);
  for (const x of [-0.95, 0.95]) {
    m.box(0.3, 0.16, 0.04, '#fffbe6', x, 0.95, -L / 2 - 0.02);
    m.box(0.25, 0.3, 0.04, '#d02020', x, 1.0, L / 2 + 0.02);
  }
  // door openings on the kerb (left) side
  m.box(0.04, 1.9, 1.0, '#1c2228', -W / 2 - 0.01, 1.4, -3.9);
  m.box(0.04, 1.9, 1.0, '#1c2228', -W / 2 - 0.01, 1.4, 1.2);
  m.box(W + 0.04, 0.3, L + 0.04, '#333', 0, 0.45, 0);
  for (const [x, z] of [[-1.05, -3.3], [1.05, -3.3], [-1.05, 3.2], [1.05, 3.2]]) m.wheel(0.5, 0.3, x, z);
  return m.build();
}

/** Small goods tempo (pick-up); load bed takes the instance colour. */
export function tempo(): THREE.BufferGeometry {
  const m = new Mesher();
  m.box(1.5, 1.2, 1.3, '#f2f2ee', 0, 1.15, -1.3); // cab
  m.box(1.44, 0.5, 0.04, '#2b3640', 0, 1.45, -1.96); // windscreen
  m.box(1.6, 0.2, 2.7, '#303030', 0, 0.65, 0.65); // chassis
  m.box(1.6, 0.55, 2.7, '#ffffff', 0, 1.02, 0.65, undefined, true); // load bed walls
  m.box(1.44, 0.05, 2.5, '#6b5a44', 0, 0.78, 0.65); // bed floor
  m.box(1.3, 0.5, 1.5, '#8a6f4d', 0, 1.3, 0.7); // cargo sacks
  for (const x of [-0.55, 0.55]) m.box(0.2, 0.12, 0.04, '#fffbe6', x, 0.95, -1.96);
  for (const [x, z] of [[-0.68, -1.2], [0.68, -1.2], [-0.68, 1.3], [0.68, 1.3]]) m.wheel(0.3, 0.2, x, z);
  return m.build();
}

/** Scooter with rider; rider's shirt takes the instance colour. */
export function scooter(): THREE.BufferGeometry {
  const m = new Mesher();
  m.box(0.34, 0.35, 1.2, '#dcdcdc', 0, 0.5, 0.05);
  m.box(0.36, 0.5, 0.2, '#dcdcdc', 0, 0.75, -0.55, [0.2, 0, 0]);
  m.box(0.6, 0.04, 0.04, '#222', 0, 1.02, -0.6);
  m.box(0.3, 0.1, 0.55, '#222', 0, 0.74, 0.25);
  m.wheel(0.22, 0.1, 0, -0.62);
  m.wheel(0.22, 0.1, 0, 0.62);
  // rider
  m.box(0.4, 0.55, 0.26, '#ffffff', 0, 1.1, 0.2, [-0.15, 0, 0], true);
  m.sphere(0.14, '#b07a55', 0, 1.52, 0.12);
  m.sphere(0.16, '#202020', 0, 1.56, 0.14, [1, 0.8, 1]);
  for (const x of [-0.12, 0.12]) m.box(0.14, 0.14, 0.5, '#2c3e66', x, 0.82, -0.02);
  for (const x of [-0.2, 0.2]) m.box(0.1, 0.1, 0.45, '#ffffff', x, 1.12, -0.18, [0.4, 0, 0], true);
  return m.build();
}

// ---------- people ----------

/** Person in one of two walk poses; the shirt (and saree/kurta length) takes the instance colour. */
export function person(pose: 0 | 1): THREE.BufferGeometry {
  const m = new Mesher();
  const swing = pose === 0 ? 0.35 : -0.35;
  const skin = '#a8744f';
  for (const [x, s] of [[-0.1, swing], [0.1, -swing]]) {
    m.box(0.15, 0.82, 0.15, '#34405a', x, 0.45, 0, [s, 0, 0]);
  }
  m.box(0.42, 0.6, 0.24, '#ffffff', 0, 1.15, 0, undefined, true);
  for (const [x, s] of [[-0.28, -swing], [0.28, swing]]) m.box(0.11, 0.58, 0.11, '#ffffff', x, 1.14, 0, [s * 0.8, 0, 0], true);
  m.sphere(0.14, skin, 0, 1.62, 0);
  m.sphere(0.145, '#17110d', 0, 1.66, 0.02, [1, 0.7, 1]);
  return m.build();
}

// ---------- animals ----------

function legs(m: Mesher, pose: 0 | 1, xs: number, zs: number[], len: number, w: number, color: string) {
  const s = pose === 0 ? 0.3 : -0.3;
  zs.forEach((z, i) => {
    for (const [k, x] of [[0, -xs], [1, xs]] as const) {
      const a = (i + k) % 2 === 0 ? s : -s;
      m.box(w, len, w, color, x, len / 2, z, [a, 0, 0]);
    }
  });
}

/** Indian cow with hump and horns; body colour from the instance colour. Pose 2 = lying down. */
export function cow(pose: 0 | 1 | 2): THREE.BufferGeometry {
  const m = new Mesher();
  const y = pose === 2 ? -0.62 : 0;
  m.box(0.62, 0.7, 1.55, '#ffffff', 0, 1.15 + y, 0, undefined, true);
  m.box(0.4, 0.28, 0.4, '#ffffff', 0, 1.6 + y, -0.45, undefined, true); // hump
  m.box(0.3, 0.3, 0.55, '#ffffff', 0, 1.3 + y, -0.95, [0.5, 0, 0], true); // neck
  m.box(0.3, 0.32, 0.5, '#ffffff', 0, 1.2 + y, -1.25, [0.4, 0, 0], true); // head
  m.box(0.2, 0.16, 0.12, '#3a2a24', 0, 1.06 + y, -1.48); // muzzle
  for (const x of [-0.12, 0.12]) m.box(0.05, 0.28, 0.05, '#d8cfb8', x, 1.52 + y, -1.18, [0.2, 0, x * 3]);
  m.box(0.05, 0.6, 0.05, '#ffffff', 0, 0.95 + y, 0.8, [-0.3, 0, 0], true); // tail
  if (pose !== 2) legs(m, pose, 0.2, [-0.55, 0.55], 0.8, 0.13, '#e9e2d2');
  else for (const [x, z] of [[-0.35, -0.5], [0.35, -0.5], [-0.35, 0.5], [0.35, 0.5]]) m.box(0.13, 0.13, 0.6, '#e9e2d2', x, 0.1, z);
  return m.build();
}

/** Street dog; coat colour from the instance colour. Pose 2 = lying down. */
export function dog(pose: 0 | 1 | 2): THREE.BufferGeometry {
  const m = new Mesher();
  const y = pose === 2 ? -0.3 : 0;
  m.box(0.26, 0.26, 0.7, '#ffffff', 0, 0.48 + y, 0, undefined, true);
  m.box(0.22, 0.22, 0.26, '#ffffff', 0, 0.66 + y, -0.42, undefined, true);
  m.box(0.12, 0.1, 0.16, '#ffffff', 0, 0.6 + y, -0.6, undefined, true);
  m.box(0.06, 0.06, 0.04, '#111', 0, 0.62 + y, -0.69);
  for (const x of [-0.08, 0.08]) m.box(0.05, 0.12, 0.04, '#ffffff', x, 0.82 + y, -0.42, [0, 0, x * 3], true);
  m.box(0.05, 0.05, 0.3, '#ffffff', 0, 0.62 + y, 0.45, [-0.6, 0, 0], true);
  if (pose !== 2) legs(m, pose, 0.09, [-0.25, 0.25], 0.36, 0.07, '#ffffff');
  return m.build();
}

/** Goat; coat colour from the instance colour. */
export function goat(pose: 0 | 1 | 2): THREE.BufferGeometry {
  const m = new Mesher();
  const y = pose === 2 ? -0.4 : 0;
  m.box(0.34, 0.36, 0.8, '#ffffff', 0, 0.68 + y, 0, undefined, true);
  m.box(0.2, 0.24, 0.32, '#ffffff', 0, 0.9 + y, -0.5, [0.5, 0, 0], true);
  for (const x of [-0.14, 0.14]) m.box(0.14, 0.05, 0.08, '#ffffff', x, 0.9 + y, -0.48, undefined, true); // floppy ears
  for (const x of [-0.05, 0.05]) m.box(0.03, 0.14, 0.03, '#6b5a44', x, 1.08 + y, -0.45, [-0.5, 0, 0]);
  if (pose !== 2) legs(m, pose, 0.11, [-0.28, 0.28], 0.5, 0.07, '#d8d2c6');
  return m.build();
}

// ---------- trains ----------

export const COACH_LEN = 20.4;

/** Suburban EMU coach: cream upper, maroon lower, open doorways. Origin at rail level. */
export function emuCoach(motor: boolean): THREE.BufferGeometry {
  const m = new Mesher();
  const L = COACH_LEN - 0.3, W = 3.66;
  m.box(W, 1.3, L, '#8a1f2d', 0, 1.65, 0); // maroon lower body
  m.box(W, 1.25, L, '#efe6cf', 0, 2.93, 0); // cream upper body
  const doors = [-7, 0, 7];
  for (const s of [-1, 1]) {
    for (const z of doors) m.box(0.05, 2.3, 1.3, '#1b1f24', s * (W / 2 + 0.01), 2.25, z); // open doorways
    // barred windows between the doors, cream pillars in between
    for (let z = -L / 2 + 1.2; z < L / 2 - 1; z += 1.45) {
      if (doors.some((d) => Math.abs(z - d) < 1.3)) continue;
      m.box(0.05, 0.75, 1.0, '#2a3038', s * (W / 2 + 0.01), 3.0, z);
    }
  }
  m.box(W + 0.02, 0.1, L, '#8a1f2d', 0, 3.47, 0); // maroon cant rail stripe
  // half cylinder bulging toward +z, flattened, then turned so it bulges up and runs along the coach
  const roof = new THREE.CylinderGeometry(W / 2, W / 2, L, 12, 1, false, -Math.PI / 2, Math.PI);
  roof.scale(1, 1, 0.22);
  m.add(roof, '#b8b8b4', [0, 3.55, 0], [-Math.PI / 2, 0, 0]);
  m.box(W - 0.3, 0.5, L - 2, '#333', 0, 0.75, 0); // underframe
  for (const z of [-7.2, 7.2]) {
    m.box(2.6, 0.6, 2.6, '#222', 0, 0.45, z); // bogies
  }
  if (motor) {
    m.box(0.1, 0.8, 1.6, '#555', 0, 4.35, -5, [0, 0, 0]); // pantograph
    m.box(1.4, 0.06, 0.2, '#777', 0, 4.8, -5);
  }
  return m.build();
}

/** Driving cab front, placed on the leading coach. */
export function emuCab(): THREE.BufferGeometry {
  const m = new Mesher();
  m.box(3.5, 1.4, 0.1, '#2a3038', 0, 2.95, -COACH_LEN / 2 + 0.1); // windscreen
  m.box(3.66, 0.4, 0.12, '#f2c200', 0, 1.2, -COACH_LEN / 2 + 0.1); // yellow warning band
  for (const x of [-1.2, 1.2]) m.box(0.3, 0.18, 0.06, '#fffbe6', x, 1.7, -COACH_LEN / 2 + 0.05);
  return m.build();
}

// ---------- signs & gates ----------

/** Level-crossing boom: pole plus striped arm (the arm pivots at the pole). */
export function gatePole(): THREE.BufferGeometry {
  return new Mesher().cyl(0.12, 0.14, 1.2, '#dedede', 0, 0.6, 0).box(0.4, 0.5, 0.4, '#b01818', 0, 1.1, 0).build();
}

export function gateArm(length: number): THREE.BufferGeometry {
  const m = new Mesher();
  const n = Math.max(2, Math.round(length / 0.8));
  for (let i = 0; i < n; i++) m.box(length / n, 0.12, 0.1, i % 2 ? '#ffffff' : '#d01818', (i + 0.5) * (length / n), 0, 0);
  return m.build();
}

/** A blue roadside board with white text on two posts. */
export function signBoard(text: string): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b4f9c';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 76;
  do {
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    size -= 4;
  } while (ctx.measureText(text).width > c.width - 60 && size > 20);
  ctx.fillText(text, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshLambertMaterial({ map: tex });
  const back = new THREE.MeshLambertMaterial({ color: '#8a8f96' });
  // box faces: +x, -x, +y, -y, +z (front), -z (back)
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.81, 0.06), [back, back, back, back, face, back]);
  board.position.y = 2.35;
  g.add(board);
  const postMat = new THREE.MeshLambertMaterial({ color: '#5b6068' });
  for (const x of [-1.05, 1.05]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.75, 8), postMat);
    post.position.set(x, 1.37, -0.05);
    g.add(post);
  }
  return g;
}
