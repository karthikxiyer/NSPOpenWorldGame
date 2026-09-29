import type * as THREE from 'three';
import type { LifeBudget } from '../config';
import type { PushResult } from '../world/Collision';
import { RoadGraph } from '../world/RoadGraph';
import type { Poi } from '../world/types';
import type { World } from '../world/World';
import { Animals } from './Animals';
import { People } from './People';
import { Spatial, type Body } from './Spatial';
import { Traffic } from './Traffic';
import { Trains } from './Trains';

/** Everything that moves by itself: traffic, pedestrians, animals and local trains. */
export class Life {
  readonly traffic: Traffic;
  readonly people: People;
  readonly animals: Animals;
  readonly trains: Trains;
  private spatial = new Spatial();
  private carGraph: RoadGraph | null = null;
  private walkGraph: RoadGraph | null = null;
  private pois: Poi[] = [];
  private graphVersion = -1;
  private rebuildTimer = 0;
  private started = false;

  constructor(scene: THREE.Scene, private world: World, budget: LifeBudget) {
    this.traffic = new Traffic(scene, budget.cars, budget.radius);
    this.people = new People(scene, budget.pedestrians, budget.radius * 0.6);
    this.animals = new Animals(scene, budget.animals, budget.radius * 0.7);
    this.trains = new Trains(scene, world.index.trainRoutes ?? [], world.index.crossings ?? []);
    world.dynamicCollider = (x, z, r) => this.collide(x, z, r);
  }

  private rebuildGraphs(): void {
    const tiles = this.world.loadedTiles();
    const oldCar = this.carGraph, oldWalk = this.walkGraph;
    this.carGraph = new RoadGraph(tiles, (r) => r.c <= 7);
    this.walkGraph = new RoadGraph(tiles, (r) => r.c >= 3);
    this.pois = tiles.flatMap((t) => t.pois);
    this.traffic.rebind(this.carGraph, oldCar);
    this.people.rebind(this.walkGraph, oldWalk);
    this.graphVersion = this.world.version;
  }

  /**
   * @param players bodies the agents should react to: the player and both of the player's vehicles
   */
  update(dt: number, fx: number, fz: number, players: Body[]): void {
    this.rebuildTimer -= dt;
    if (this.world.version !== this.graphVersion && (this.rebuildTimer <= 0 || !this.carGraph)) {
      this.rebuildGraphs();
      this.rebuildTimer = 1;
    }
    const cg = this.carGraph!, wg = this.walkGraph!;

    const sp = this.spatial;
    sp.clear();
    for (const b of players) sp.add(b);
    for (const b of this.traffic.bodies()) sp.add(b);
    for (const b of this.people.bodies()) sp.add(b);
    for (const b of this.animals.bodies()) sp.add(b);

    const initial = !this.started;
    this.started = true;
    this.trains.update(dt, fx, fz);
    this.traffic.update(dt, cg, fx, fz, sp, (x, z, d) => this.trains.closedCrossingNear(x, z, d), initial);
    this.people.update(dt, wg, this.pois, fx, fz, sp, initial);
    this.animals.update(dt, cg, this.world, fx, fz, sp, initial);
  }

  /** Moving obstacles that block the player: traffic, cows and trains. */
  collide(x: number, z: number, r: number): PushResult {
    const hit = this.trains.collide(x, z, r) ?? this.traffic.collide(x, z, r) ?? this.animals.collide(x, z, r);
    if (hit) return { ...hit, hit: true };
    return { x, z, hit: false, nx: 0, nz: 0 };
  }
}
