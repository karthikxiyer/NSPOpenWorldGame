// Shapes of the files produced by scripts/build-tiles.mjs

export interface Road {
  /** class: 1 highway, 2 primary, 3 secondary, 4 tertiary, 5 local, 6 service, 7 track, 8 pedestrian, 9 path */
  c: number;
  /** width in metres */
  w: number;
  /** flat [x, z, x, z, ...] in world metres */
  p: number[];
  b?: 1;
  o?: 1;
  n?: string;
}

export interface Building {
  h: number;
  /** palette index */
  c: number;
  p: number[];
  n?: string;
  k?: 'worship';
}

export interface Rail {
  p: number[];
  b?: 1;
}

export interface Poi {
  k: string;
  x: number;
  z: number;
  n?: string;
  mr?: string;
  t?: string;
  r?: string;
}

export interface TileData {
  roads: Road[];
  buildings: Building[];
  rail: Rail[];
  pois: Poi[];
}

export interface NamedPoint {
  n: string;
  mr?: string;
  t?: string;
  x: number;
  z: number;
}

export interface TrainRoute {
  kind: 'wr' | 'branch';
  len: number;
  /** flat [x, z, ...] */
  p: number[];
  /** distance along the route of each station stop */
  stops: { s: number; n: string }[];
}

export interface Crossing {
  x: number;
  z: number;
  /** direction of the road through the crossing */
  dx: number;
  dz: number;
  /** half-width of the tracks measured along the road, plus clearance */
  h: number;
}

export interface WorldIndex {
  origin: { lat: number; lon: number };
  scale: { kx: number; kz: number };
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  tileSize: number;
  ground: { w: number; h: number; px: number };
  tiles: string[];
  stations: NamedPoint[];
  places: NamedPoint[];
  spawn: { x: number; z: number; near: string };
  trainRoutes: TrainRoute[];
  crossings: Crossing[];
  attribution: string;
  fetchedAt: string;
}
