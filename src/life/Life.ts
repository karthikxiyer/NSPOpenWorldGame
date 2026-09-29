import type * as THREE from 'three';
import type { LifeBudget } from '../config';
import { rngKit } from '../core/rng';
import type { Patch } from '../world/patch';
import type { PushResult, Terrain } from '../world/Terrain';
import { Animals } from './Animals';
import { People } from './People';
import { RoadGraph, Wrap } from './RoadGraph';
import { Spatial, type Body } from './Spatial';
import { Traffic, type Car } from './Traffic';
import { Trains } from './Trains';

export interface Destination {
  n: string;
  mr?: string;
  x: number;
  z: number;
}

/** Everything that moves by itself: traffic, pedestrians, animals, local trains, and your auto. */
export class Life {
  readonly wrap: Wrap;
  readonly carGraph: RoadGraph;
  readonly walkGraph: RoadGraph;
  readonly traffic: Traffic;
  readonly people: People;
  readonly animals: Animals;
  readonly trains: Trains;
  readonly destinations: Destination[] = [];
  private spatial = new Spatial();
  private started = false;

  constructor(scene: THREE.Scene, private patch: Patch, terrain: Terrain, budget: LifeBudget, shadows: boolean) {
    const b = patch.bounds;
    this.wrap = new Wrap(b.minX, b.minZ, b.maxX, b.maxZ);
    const rng = rngKit(Date.now() >>> 0);
    const rand = rng.next;
    this.carGraph = new RoadGraph(patch, this.wrap, (r) => r.c <= 7 && !(r.b && r.c >= 8));
    this.walkGraph = new RoadGraph(patch, this.wrap, (r) => !(r.b && r.c >= 8));
    this.traffic = new Traffic(scene, budget.cars, budget.radius, shadows, this.wrap, rand);
    this.people = new People(scene, budget.pedestrians, budget.radius * 0.85, shadows, this.wrap, rand, patch, terrain);
    this.animals = new Animals(scene, budget.animals, budget.radius * 0.8, shadows, this.wrap, rand, terrain);
    this.trains = new Trains(scene, patch, shadows, this.wrap, rand);
    terrain.dynamic = (x, z, r) => this.collide(x, z, r);

    // where an auto can take you
    const st = patch.stations[0];
    if (st) this.destinations.push({ n: `${st.n} Station`, mr: st.mr, x: patch.station?.x ?? st.x, z: patch.station?.z ?? st.z });
    if (patch.depot) this.destinations.push({ n: 'ST Depot', mr: 'एस.टी. डेपो', x: patch.depot.x, z: patch.depot.z });
    this.destinations.push({ n: '3rd Road Taaki', x: patch.tank.x, z: patch.tank.z });
    const market = patch.roadNames.filter((r) => r.n === 'Station Road').sort((p, q) => Math.abs(p.x - 150) - Math.abs(q.x - 150))[0];
    if (market) this.destinations.push({ n: 'Station Road market', x: market.x, z: market.z });
    const cinema = patch.labels.find((l) => /cinema/i.test(l.n));
    if (cinema) this.destinations.push({ n: cinema.n, x: cinema.x, z: cinema.z });
  }

  /**
   * @param players bodies the agents should react to: the player and the player's vehicles
   * @param camYaw the camera looks along (-sin, -cos) of this: new arrivals appear behind it
   */
  update(dt: number, fx: number, fz: number, players: Body[], camYaw: number): void {
    fx = this.wrap.fx(fx);
    fz = this.wrap.fz(fz);
    const lx = -Math.sin(camYaw), lz = -Math.cos(camYaw), w = this.wrap;
    // out of sight: over the horizon (the curve hides a car beyond ~130 m), or behind the camera
    const unseen = (x: number, z: number) => {
      const dx = w.dx(fx, x), dz = w.dz(fz, z), d = Math.hypot(dx, dz) || 1;
      return d > 130 || (dx * lx + dz * lz) / d < -0.35;
    };
    const sp = this.spatial;
    sp.clear();
    for (const b of players) sp.add(b);
    for (const b of this.traffic.bodies()) sp.add(b);
    for (const b of this.people.bodies()) sp.add(b);
    for (const b of this.animals.bodies()) sp.add(b);
    const initial = !this.started;
    this.started = true;
    this.trains.update(dt);
    this.traffic.update(dt, this.carGraph, fx, fz, sp, initial, unseen);
    this.people.update(dt, this.walkGraph, fx, fz, sp, initial, unseen);
    this.animals.update(dt, this.carGraph, fx, fz, sp, initial, unseen);
  }

  /** Put every agent at its copy nearest the camera's focus. */
  render(fx: number, fz: number): void {
    this.traffic.render(fx, fz);
    this.people.render(fx, fz);
    this.animals.render(fx, fz);
    this.trains.render(fx, fz, this.patch.bounds);
  }

  /** Moving obstacles the player and the player's vehicles bump into: trains, traffic and cows. */
  collide(x: number, z: number, r: number): PushResult | null {
    return this.trains.collide(x, z, r) ?? this.traffic.collide(x, z, r, this.ride ?? undefined) ?? this.animals.collide(x, z, r);
  }

  // ------------------------------------------------------------------------------------------
  // your auto

  /** The auto you hailed (on its way, waiting, or carrying you), if any. */
  get ride(): Car | null {
    return this.traffic.cars.find((c) => c.job !== 'free') ?? null;
  }

  hail(x: number, z: number): Car | null {
    return this.traffic.hail(this.carGraph, this.wrap.fx(x), this.wrap.fz(z));
  }

  /** Send the auto to a destination; false if it can't get there. */
  go(c: Car, d: Destination): boolean {
    const v = this.carGraph.nearest(d.x, d.z, 120, (e) => e.c <= c.type.maxClass);
    if (v < 0) return false;
    c.odo = 0;
    return this.traffic.dispatch(c, this.carGraph, v, 'hired');
  }

  release(c: Car): void {
    this.traffic.release(c);
  }
}

/** Mumbai-region auto fare: ₹26 for the first 1.5 km, then about ₹17 a km. */
export function autoFare(metres: number): number {
  const km = metres / 1000;
  return Math.round(26 + Math.max(0, km - 1.5) * 17.14);
}
