import * as THREE from 'three';
import { FootprintGrid, WaterMask, resolveCircle, type PushResult } from './Collision';
import { buildBuildings, buildRail, buildRoads, windowTexture } from './meshes';
import type { NamedPoint, TileData, WorldIndex } from './types';

interface LoadedTile {
  key: string;
  group: THREE.Group;
  grid: FootprintGrid;
  data: TileData;
}

const BASE = import.meta.env.BASE_URL + 'world/';

export class World {
  index!: WorldIndex;
  water!: WaterMask;
  readonly root = new THREE.Group();

  private available = new Set<string>();
  private loaded = new Map<string, LoadedTile>();
  private pending = new Set<string>();
  private buildQueue: { key: string; data: TileData }[] = [];
  private buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTexture() });
  private roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private railMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  private seaMat!: THREE.MeshLambertMaterial;

  constructor(private loadRadius: number) {}

  async init(onProgress: (f: number, text: string) => void): Promise<void> {
    onProgress(0.05, 'Loading map index…');
    const res = await fetch(BASE + 'world.json');
    if (!res.ok) throw new Error(`world.json: ${res.status}`);
    this.index = await res.json();
    for (const k of this.index.tiles) this.available.add(k);

    onProgress(0.2, 'Loading ground…');
    const img = await loadImage(BASE + 'ground.png');
    const { minX, minZ, maxX, maxZ } = this.index.bounds;
    const { w, h, px } = this.index.ground;
    this.water = WaterMask.fromImage(img, minX, minZ, px);

    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;

    const gw = w * px, gh = h * px;
    const ground = new THREE.Mesh(
      // subdivided: a few huge triangles get clipped badly by some GPUs when the camera is close
      new THREE.PlaneGeometry(gw, gh, Math.ceil(gw / 250), Math.ceil(gh / 250)),
      new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(minX + gw / 2, 0, minZ + gh / 2);
    ground.name = 'ground';
    this.root.add(ground);

    // Sea: west of the map and under every transparent ground pixel
    const far = 30000;
    this.seaMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#3f7385') });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX + far, maxZ - minZ + far * 2, 160, 200), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set((minX - far + maxX) / 2, -0.6, (minZ + maxZ) / 2);
    this.root.add(sea);
    // Inland beyond the east edge of the data
    const inland = new THREE.Mesh(new THREE.PlaneGeometry(far, maxZ - minZ + far * 2, 60, 200), new THREE.MeshLambertMaterial({ color: '#a79c74' }));
    inland.rotation.x = -Math.PI / 2;
    inland.position.set(maxX + far / 2 - 1, -0.05, (minZ + maxZ) / 2);
    this.root.add(inland);
    onProgress(0.35, 'Loading streets…');
  }

  /** Load everything around a point before the game starts. */
  async preload(x: number, z: number, onProgress: (f: number, text: string) => void): Promise<void> {
    const keys = this.wantedKeys(x, z, this.loadRadius);
    let done = 0;
    await Promise.all(
      keys.map(async (k) => {
        await this.fetchTile(k);
        done++;
        onProgress(0.35 + (0.55 * done) / keys.length, `Loading streets… ${done}/${keys.length}`);
      }),
    );
    while (this.buildQueue.length) this.buildOne();
  }

  update(x: number, z: number, time: number): void {
    const want = new Set(this.wantedKeys(x, z, this.loadRadius));
    for (const k of want) if (!this.loaded.has(k) && !this.pending.has(k)) void this.fetchTile(k);
    // unload with hysteresis
    const ts = this.index.tileSize;
    for (const [k, t] of this.loaded) {
      const [tx, tz] = k.split('_').map(Number);
      const d = Math.hypot((tx + 0.5) * ts - x, (tz + 0.5) * ts - z);
      if (d > this.loadRadius + ts * 1.5) this.unload(t);
    }
    // build at most one tile per frame to avoid hitches
    if (this.buildQueue.length) {
      // nearest first
      this.buildQueue.sort((a, b) => this.tileDist(a.key, x, z) - this.tileDist(b.key, x, z));
      this.buildOne();
    }
    // gentle sea shimmer
    const s = 0.5 + 0.5 * Math.sin(time * 0.4);
    this.seaMat.color.setRGB(0.24 + s * 0.02, 0.44 + s * 0.03, 0.51 + s * 0.03, THREE.SRGBColorSpace);
  }

  private tileDist(k: string, x: number, z: number): number {
    const [tx, tz] = k.split('_').map(Number);
    const ts = this.index.tileSize;
    return Math.hypot((tx + 0.5) * ts - x, (tz + 0.5) * ts - z);
  }

  private wantedKeys(x: number, z: number, radius: number): string[] {
    const ts = this.index.tileSize;
    const out: string[] = [];
    const r = Math.ceil(radius / ts);
    const cx = Math.floor(x / ts), cz = Math.floor(z / ts);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const k = `${cx + dx}_${cz + dz}`;
        if (!this.available.has(k)) continue;
        // distance from point to tile rectangle
        const x0 = (cx + dx) * ts, z0 = (cz + dz) * ts;
        const ddx = Math.max(x0 - x, 0, x - (x0 + ts));
        const ddz = Math.max(z0 - z, 0, z - (z0 + ts));
        if (Math.hypot(ddx, ddz) <= radius) out.push(k);
      }
    }
    return out;
  }

  private async fetchTile(k: string): Promise<void> {
    this.pending.add(k);
    try {
      const res = await fetch(BASE + `tiles/${k}.json`);
      if (!res.ok) throw new Error(String(res.status));
      const data: TileData = await res.json();
      this.buildQueue.push({ key: k, data });
    } catch (e) {
      console.warn('tile failed', k, e);
      this.pending.delete(k);
    }
  }

  private buildOne(): void {
    const item = this.buildQueue.shift();
    if (!item) return;
    const { key, data } = item;
    this.pending.delete(key);
    if (this.loaded.has(key)) return;
    const group = new THREE.Group();
    group.name = `tile_${key}`;
    const b = buildBuildings(data.buildings);
    if (b) group.add(new THREE.Mesh(b, this.buildingMat));
    const r = buildRoads(data.roads);
    if (r) group.add(new THREE.Mesh(r, this.roadMat));
    const rl = buildRail(data.rail);
    if (rl) group.add(new THREE.Mesh(rl, this.railMat));
    for (const m of group.children) m.matrixAutoUpdate = false;
    this.root.add(group);
    const grid = new FootprintGrid(data.buildings.map((bd) => bd.p));
    this.loaded.set(key, { key, group, grid, data });
  }

  private unload(t: LoadedTile): void {
    this.root.remove(t.group);
    t.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.loaded.delete(t.key);
  }

  collide(x: number, z: number, r: number): PushResult {
    const grids: FootprintGrid[] = [];
    const ts = this.index.tileSize;
    const cx = Math.floor(x / ts), cz = Math.floor(z / ts);
    // buildings are bucketed by centroid, so look in neighbouring tiles too
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const t = this.loaded.get(`${cx + dx}_${cz + dz}`);
      if (t) grids.push(t.grid);
    }
    return resolveCircle(grids, x, z, r);
  }

  isWater(x: number, z: number): boolean {
    return this.water.isWater(x, z);
  }

  inBounds(x: number, z: number, margin = 50): boolean {
    const b = this.index.bounds;
    return x > b.minX + margin && x < b.maxX - margin && z > b.minZ + margin && z < b.maxZ - margin;
  }

  nearestPlace(x: number, z: number): NamedPoint | null {
    let best: NamedPoint | null = null, bd = Infinity;
    for (const p of this.index.places) {
      // the whole-city label is only a fallback
      if (p.t === 'city' || p.t === 'town') continue;
      // neighbourhoods are small, suburbs/villages cover more ground
      const w = p.t === 'neighbourhood' || p.t === 'hamlet' ? 1.3 : 1;
      const d = Math.hypot(p.x - x, p.z - z) * w;
      if (d < bd) { bd = d; best = p; }
    }
    if (bd < 2500) return best;
    return this.index.places.find((p) => p.t === 'city' || p.t === 'town') ?? null;
  }

  /** Find a road point near (x,z) — used to park the vehicles at spawn. */
  nearestRoadPoint(x: number, z: number, minClass = 1, maxClass = 6): { x: number; z: number; heading: number } | null {
    let best: { x: number; z: number; heading: number } | null = null, bd = Infinity;
    for (const t of this.loaded.values()) {
      for (const r of t.data.roads) {
        if (r.c < minClass || r.c > maxClass) continue;
        for (let i = 0; i < r.p.length - 2; i += 2) {
          const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3];
          const ex = bx - ax, ez = bz - az;
          const len2 = ex * ex + ez * ez || 1;
          const tt = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
          const px = ax + ex * tt, pz = az + ez * tt;
          const d = Math.hypot(px - x, pz - z);
          if (d < bd) {
            bd = d;
            // offset to the left edge of the road so vehicles park on the side
            const len = Math.sqrt(len2);
            const off = r.w / 2 - 1.2;
            best = { x: px + (ez / len) * off, z: pz - (ex / len) * off, heading: Math.atan2(-ex, -ez) };
          }
        }
      }
    }
    return best;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}
