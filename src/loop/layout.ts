import { CIRCUMFERENCE, wrapX } from '../planet/planet';

/*
 * The loop, in flat coordinates.
 *
 * Across the strip (z, +z = north = Nalasopara West):
 *
 *   z  62 ┄┄ far towers (silhouettes)
 *   z  24 ┄┄ second row of buildings / lanes
 *   z   7 ── north footpath edge, frontage buildings start at 7.5
 *   z 4.5 ── road edge (9 m two-lane road, keep left)
 *   z   0 ── road centre (the equator)
 *   z-4.5 ── road edge
 *   z-8.4 ── compound wall between the road and the railway (open at the station)
 *   z-13.5 ─ UP line      ┐ Western Railway
 *   z-18.5 ─ DOWN line    ┘
 *   z -23 ── east boundary wall, Nalasopara East beyond
 *
 * Along the strip (x) the real sequence of places from 3rd Road Taaki to Nalla Sopara station
 * and back, compressed about 2.5x into one lap.
 */

export const ROAD_HALF = 4.5;
export const FOOTPATH_OUT = 7;
export const FOOTPATH_H = 0.16;
export const SOUTH_WALL_Z = -8.4;
export const TRACK_UP_Z = -13.5;
export const TRACK_DOWN_Z = -18.5;
export const EAST_WALL_Z = -23;
export const PLATFORM = { z0: -11.8, z1: -8.4, h: 0.92 };

export interface Zone {
  id: string;
  name: string;
  mr?: string;
  /** centre along the loop */
  x: number;
  /** half-length along the loop */
  half: number;
  kind: 'residential' | 'parks' | 'cinema' | 'junction' | 'market' | 'station' | 'depot' | 'lanes';
}

// Real names from OpenStreetMap, in real order.
export const ZONES: Zone[] = [
  { id: 'taaki', name: '3rd Road Taaki', x: 0, half: 55, kind: 'residential' },
  { id: 'parks', name: 'Rajhans Play Park', x: 110, half: 55, kind: 'parks' },
  { id: 'cinema', name: 'Fun Fiesta Cinema', x: 215, half: 50, kind: 'cinema' },
  { id: 'link', name: 'Link Road Junction', mr: 'लिंक रोड', x: 320, half: 55, kind: 'junction' },
  { id: 'market', name: 'Station Road', mr: 'स्टेशन रोड', x: 425, half: 50, kind: 'market' },
  { id: 'station', name: 'Nalla Sopara Station', mr: 'नाला सोपारा', x: 525, half: 50, kind: 'station' },
  { id: 'depot', name: 'ST Depot', mr: 'एस.टी. डेपो', x: 645, half: 70, kind: 'depot' },
  { id: 'lanes', name: 'Samel Pada', x: 788, half: 70, kind: 'lanes' },
  { id: 'shriprastha', name: 'Shriprastha', mr: 'श्रीप्रस्थ', x: 904, half: 44, kind: 'residential' },
];

/** The zone containing a loop position. */
export function zoneAt(x: number): Zone {
  const w = wrapX(x);
  let best = ZONES[0], bd = Infinity;
  for (const z of ZONES) {
    let d = Math.abs(w - z.x);
    d = Math.min(d, CIRCUMFERENCE - d);
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}

/** Start pose: the end of Road 3, beside the Taaki, facing west along the loop. */
export const START = {
  bike: { x: 6, z: 3.2, heading: Math.PI / 2 },
  harrier: { x: 19, z: 3.2, heading: Math.PI / 2 },
  player: { x: 6.4, z: 5.6, heading: 0 },
  /** Road 3 runs north from the loop road here */
  road3X: -4,
  taaki: { x: -17, z: 40 },
  /** Archit Bar & Restaurant, the low building on the corner (keeps the view of the Taaki open) */
  corner: { x0: 10.5, x1: 22.5 },
  board: { x: -0.6, z: 7.3 },
};
