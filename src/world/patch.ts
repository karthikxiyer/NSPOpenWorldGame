// Shape of public/patch/patch.json, written by scripts/build-patch.mjs.

export interface PRoad {
  /** 1 highway, 2 primary, 3 secondary, 4 tertiary, 5 local, 6 service, 7 track, 8 pedestrian, 9 path */
  c: number;
  w: number;
  /** flat [x, z, ...] */
  p: number[];
  n?: string;
  o?: 1;
  b?: 1;
  ring?: 1;
}

export interface PBuilding {
  h: number;
  c: number;
  p: number[];
  n?: string;
  k?: 'worship';
}

export type SignKind = 'shop' | 'health' | 'bank' | 'worship' | 'cinema' | 'school' | 'park' | 'fuel' | 'society' | 'street' | 'platform' | 'depot' | 'station';

/** A signboard: on a wall (default), on two posts, or hanging from a platform roof. */
export interface PSign {
  k: SignKind;
  n: string;
  /** second line, usually Marathi */
  s?: string;
  x: number;
  z: number;
  /** height of the board's centre */
  y: number;
  /** facing: the board's front points along (sin yaw, cos yaw) */
  yaw: number;
  /** width; every board is 4:1 */
  w: number;
  post?: 1;
  hang?: 1;
}

export interface Patch {
  origin: { lat: number; lon: number };
  scale: { kx: number; kz: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  ground: { w: number; h: number; px: number };
  roads: PRoad[];
  buildings: PBuilding[];
  rail: { p: number[]; m?: 1 }[];
  platforms: { p: number[] }[];
  /** [x, z, kind] kind: 0 gulmohar, 1 neem, 2 coconut */
  trees: [number, number, number][];
  stations: { n: string; mr?: string; x: number; z: number }[];
  places: { n: string; mr?: string; x: number; z: number }[];
  labels: { n: string; mr?: string; x: number; z: number; r: number }[];
  roadNames: { n: string; x: number; z: number }[];
  tank: { x: number; z: number; yaw: number };
  spawn: { x: number; z: number; heading: number; side: number };
  signs: PSign[];
  /** shopfronts, flat: x, z, yaw, width, sign id (negative: under a mapped shop's own board), open (1) or shuttered (0) */
  shops: number[];
  station: { x: number; z: number; yaw: number; w: number; d: number; h: number } | null;
  depot: {
    x: number; z: number; yaw: number; w: number; d: number;
    /** [x, z, yaw] */
    buses: [number, number, number][];
    shed: { x: number; z: number; yaw: number; w: number; d: number; h: number } | null;
  } | null;
  /** extra footprints to collide with: station building, depot shed, parked buses */
  solids: { p: number[]; h: number }[];
}

export async function loadPatch(): Promise<{ patch: Patch; ground: HTMLImageElement }> {
  const base = import.meta.env.BASE_URL + 'patch/';
  const res = await fetch(base + 'patch.json');
  if (!res.ok) throw new Error(`patch.json: ${res.status}`);
  const patch: Patch = await res.json();
  const ground = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('ground.png'));
    img.src = base + 'ground.png';
  });
  return { patch, ground };
}
