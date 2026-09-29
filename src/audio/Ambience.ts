import type { Life } from '../life/Life';
import type { Car } from '../life/Traffic';
import { ENGINES, EngineVoice, type EngineName } from './Engine';
import { glide, type Sound } from './Sound';

interface Pooled {
  voice: EngineVoice;
  kind: EngineName;
  car: Car | null;
}

const KIND_OF: Record<string, EngineName> = { auto: 'auto', scooter: 'scooter', car: 'car', tempo: 'diesel', bus: 'diesel' };

/**
 * The street: the nearest few vehicles get real engine voices, placed by distance and bearing;
 * a traffic rumble and a crowd murmur scale with how busy it is round you; horns, crows and dogs
 * come and go; locals rumble and clatter past, sound their horns, and the station chimes.
 */
export class Ambience {
  private pool: Pooled[] = [];
  private traffic: { f: BiquadFilterNode; g: GainNode };
  private crowd: { f: BiquadFilterNode; g: GainNode }[];
  private rumble: { f: BiquadFilterNode; g: GainNode };
  private hornT = 2;
  private crowT = 5;
  private dogT = 8;
  private clackAcc = 0;
  private murmurT = 0;

  constructor(private s: Sound, private life: Life, voices: number) {
    // the pool: mostly autos and scooters, as on the road
    const kinds: EngineName[] = ['auto', 'auto', 'scooter', 'car', 'diesel', 'auto'].slice(0, voices) as EngineName[];
    for (const k of kinds) this.pool.push({ voice: new EngineVoice(s, ENGINES[k], s.amb), kind: k, car: null });
    this.traffic = s.bed('brown', 'lowpass', 180, 0.7, s.amb);
    // crowd: three formant bands of noise, each swelling and fading like overlapping voices
    this.crowd = [420, 1100, 2400].map((f) => s.bed('white', 'bandpass', f, 3, s.amb));
    this.rumble = s.bed('brown', 'lowpass', 240, 0.8, s.amb);
  }

  /**
   * @param fx,fz the listener (the camera's focus)
   * @param yaw the camera's yaw: sounds to its right pan right
   * @param quiet 0..1, how much your own engine should push the street back
   */
  update(dt: number, fx: number, fz: number, yaw: number, quiet: number): void {
    const s = this.s, w = this.life.wrap, t = s.now;
    // listener's right-hand vector (the camera looks along (-sin, -cos))
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const where = (x: number, z: number) => {
      const dx = w.dx(fx, x), dz = w.dz(fz, z), d = Math.hypot(dx, dz) || 1;
      return { d, pan: ((dx * rx + dz * rz) / d) * 0.8 };
    };
    glide(s.amb.gain, 1 - 0.35 * quiet, t, 0.3);

    // ---- engines of the nearest vehicles, by kind
    const cars = this.life.traffic.cars.map((c) => ({ c, ...where(c.x, c.z) })).filter((q) => q.d < 60).sort((a, b) => a.d - b.d);
    const taken = new Set<Car>();
    for (const p of this.pool) {
      // keep the same car while it's still near, so a voice doesn't jump around
      if (p.car && !cars.some((q) => q.c === p.car)) p.car = null;
      if (!p.car) p.car = cars.find((q) => KIND_OF[q.c.type.name] === p.kind && !taken.has(q.c) && !this.pool.some((o) => o.car === q.c))?.c ?? null;
      if (!p.car) { p.voice.set(0, 0, 0); continue; }
      taken.add(p.car);
      const q = where(p.car.x, p.car.z);
      const e = p.voice.preset, top = p.car.type.max;
      const rpm = e.idle + (e.redline * 0.7 - e.idle) * Math.min(1, p.car.speed / top) * (p.kind === 'scooter' ? 1 : 0.8);
      const accel = p.car.speed < top * 0.6 ? 0.6 : 0.25;
      const level = 1 / (1 + (Math.max(0, q.d - 3) / 7) ** 2);
      p.voice.set(rpm, accel, level, q.pan, 0.15);
    }

    // ---- beds: traffic rumble and crowd murmur, from what's near
    let carNear = 0;
    for (const q of cars) carNear += 1 / (1 + q.d / 25);
    glide(this.traffic.g.gain, Math.min(0.28, carNear * 0.05), t, 0.4);
    let pedNear = 0;
    for (const b of this.life.people.bodies()) {
      const d = w.dist(b.x, b.z, fx, fz);
      if (d < 40) pedNear += 1 - d / 40;
    }
    this.murmurT -= dt;
    if (this.murmurT <= 0) {
      this.murmurT = 0.12 + Math.random() * 0.15;
      const base = Math.min(0.09, pedNear * 0.012);
      for (const b of this.crowd) glide(b.g.gain, base * (0.3 + Math.random() * 0.9), t, 0.08);
    }

    // ---- horns: now and then, and more when traffic is stuck
    this.hornT -= dt;
    if (this.hornT <= 0 && cars.length) {
      const stuck = cars.filter((q) => q.c.stuck > 1.5);
      const q = stuck.length && Math.random() < 0.7 ? stuck[Math.floor(Math.random() * stuck.length)] : cars[Math.floor(Math.random() * cars.length)];
      const lv = 0.22 / (1 + (q.d / 18) ** 2);
      const n = q.c.type.name;
      const freqs = n === 'bus' || n === 'tempo' ? [300, 372] : n === 'car' ? [405, 505] : n === 'scooter' ? [455] : [520];
      // Indian horns: short, often twice
      const beeps = Math.random() < 0.5 ? 1 : 2;
      for (let k = 0; k < beeps; k++) setTimeout(() => s.horn(freqs, 0.16 + Math.random() * 0.2, lv, q.pan, s.amb), k * 260);
      this.hornT = 1.5 + Math.random() * 4 / Math.max(0.5, carNear);
    }

    // ---- crows overhead, dogs nearby
    this.crowT -= dt;
    if (this.crowT <= 0) {
      s.crow(0.05 + Math.random() * 0.06, Math.random() * 1.6 - 0.8);
      this.crowT = 7 + Math.random() * 16;
    }
    this.dogT -= dt;
    if (this.dogT <= 0) {
      const dogs = this.life.animals.animals.filter((a) => a.sp.name === 'dog').map((a) => where(a.x, a.z)).filter((q) => q.d < 60);
      if (dogs.length) {
        const q = dogs[Math.floor(Math.random() * dogs.length)];
        s.bark(0.18 / (1 + (q.d / 12) ** 2), q.pan);
      }
      this.dogT = 9 + Math.random() * 20;
    }

    // ---- trains
    const tr = this.life.trains.nearest(fx, fz);
    if (tr) {
      const q = where(tr.x, tr.z);
      const near = 1 / (1 + (tr.d / 35) ** 2);
      glide(this.rumble.g.gain, Math.min(0.5, near * (0.05 + tr.v / 25)), t, 0.2);
      // the clatter of wheels over rail joints: a "ta-dak" for each bogie passing a joint
      this.clackAcc += tr.v * dt;
      if (this.clackAcc > 6.5 && tr.v > 1 && tr.d < 160) {
        this.clackAcc = 0;
        const lv = near * 0.3;
        s.click(lv, q.pan, 0);
        s.click(lv * 0.8, q.pan, 0.09);
      }
    } else glide(this.rumble.g.gain, 0, t, 0.3);
    for (const ev of this.life.trains.events.splice(0)) {
      const q = where(ev.x, ev.z);
      if (ev.kind === 'enter' && q.d < 700) {
        // an EMU's horn: a long, high, slightly out-of-tune pair
        s.horn([587, 698], 1.4, 0.22 / (1 + (q.d / 200) ** 2), q.pan, s.amb, 0.8);
      } else if (ev.kind === 'stop' && q.d < 200) {
        s.chime(0.12 / (1 + (q.d / 60) ** 2), q.pan);
      }
    }
  }
}
