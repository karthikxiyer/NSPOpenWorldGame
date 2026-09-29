import { glide, type Sound } from './Sound';

/** What the worklet needs to voice one engine, plus the filters that colour it. */
export interface EnginePreset {
  /** firing points in the 720° cycle, as fractions of it */
  offsets: number[];
  pulseHz: number;
  pulseTau: number;
  click: number;
  pipeDelay: number;
  pipeFeedback: number;
  pipeDamp: number;
  jitter: number;
  mech: number;
  knock: number;
  turbo: number;
  pops: number;
  idle: number;
  redline: number;
  /** colour after the exhaust: [type, Hz, Q, dB] */
  eq: [BiquadFilterType, number, number, number][];
  level: number;
}

export const ENGINES = {
  // Honda CB350RS: 348 cc air-cooled long-stroke single. At idle it fires ~9 times a second:
  // the slow, deep "dug-dug" of a big single through a long pipe, which pops on the overrun.
  cb350rs: {
    offsets: [0], pulseHz: 62, pulseTau: 0.0075, click: 0.22, pipeDelay: 0.0088, pipeFeedback: -0.58, pipeDamp: 0.32,
    jitter: 0.14, mech: 0.035, knock: 0, turbo: 0, pops: 0.22, idle: 1050, redline: 6200,
    eq: [['highpass', 32, 0.7, 0], ['lowshelf', 120, 0.7, 6], ['peaking', 260, 1.1, 4], ['peaking', 1400, 1.4, -4], ['lowpass', 3200, 0.7, 0]],
    level: 0.9,
  },
  // Tata Harrier: 2.0 Kryotec turbo-diesel in-line four, firing order 1-3-4-2. A diesel's idle
  // is a clattering ~27 Hz beat; the turbo whistles as it spools.
  harrier: {
    offsets: [0, 0.25, 0.5, 0.75], pulseHz: 95, pulseTau: 0.0042, click: 0.12, pipeDelay: 0.0062, pipeFeedback: -0.45, pipeDamp: 0.28,
    jitter: 0.07, mech: 0.03, knock: 0.32, turbo: 0.018, pops: 0, idle: 800, redline: 4600,
    eq: [['highpass', 30, 0.7, 0], ['peaking', 170, 0.9, 4], ['peaking', 3000, 1.6, 2], ['lowpass', 2600, 0.7, 0]],
    level: 0.75,
  },
  // Bajaj RE auto-rickshaw: small single with a short pipe, idling high and rough
  auto: {
    offsets: [0], pulseHz: 115, pulseTau: 0.0038, click: 0.35, pipeDelay: 0.0038, pipeFeedback: -0.5, pipeDamp: 0.4,
    jitter: 0.22, mech: 0.09, knock: 0, turbo: 0, pops: 0, idle: 1500, redline: 5500,
    eq: [['highpass', 80, 0.7, 0], ['peaking', 520, 1.2, 6], ['lowpass', 3600, 0.7, 0]],
    level: 0.7,
  },
  // 110 cc scooter: buzzy single on a CVT, always at fairly high revs
  scooter: {
    offsets: [0], pulseHz: 150, pulseTau: 0.0025, click: 0.2, pipeDelay: 0.003, pipeFeedback: -0.45, pipeDamp: 0.45,
    jitter: 0.08, mech: 0.06, knock: 0, turbo: 0, pops: 0, idle: 1700, redline: 8000,
    eq: [['highpass', 120, 0.7, 0], ['peaking', 900, 1.2, 5], ['lowpass', 4500, 0.7, 0]],
    level: 0.55,
  },
  // small petrol hatchback: smooth, quiet four
  car: {
    offsets: [0, 0.25, 0.5, 0.75], pulseHz: 150, pulseTau: 0.003, click: 0.08, pipeDelay: 0.005, pipeFeedback: -0.35, pipeDamp: 0.35,
    jitter: 0.04, mech: 0.025, knock: 0, turbo: 0, pops: 0, idle: 850, redline: 6000,
    eq: [['highpass', 50, 0.7, 0], ['lowpass', 1500, 0.7, 0]],
    level: 0.45,
  },
  // tempo / bus: big, slow diesel
  diesel: {
    offsets: [0, 0.25, 0.5, 0.75], pulseHz: 70, pulseTau: 0.005, click: 0.1, pipeDelay: 0.009, pipeFeedback: -0.5, pipeDamp: 0.25,
    jitter: 0.08, mech: 0.03, knock: 0.3, turbo: 0, pops: 0, idle: 650, redline: 2800,
    eq: [['highpass', 28, 0.7, 0], ['peaking', 140, 0.9, 5], ['lowpass', 1400, 0.7, 0]],
    level: 0.8,
  },
} satisfies Record<string, EnginePreset>;

export type EngineName = keyof typeof ENGINES;

/** One running engine: worklet -> EQ -> level -> pan. */
export class EngineVoice {
  readonly out: GainNode;
  private pan: StereoPannerNode;
  private node: AudioWorkletNode | null = null;
  private rpm: AudioParam | null = null;
  private load: AudioParam | null = null;

  constructor(private s: Sound, readonly preset: EnginePreset, bus: AudioNode) {
    this.out = s.gain(0);
    this.pan = s.ctx.createStereoPanner();
    this.out.connect(this.pan).connect(bus);
    if (!s.worklet) return;
    this.node = new AudioWorkletNode(s.ctx, 'nsp-engine', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: preset });
    let head: AudioNode = this.node;
    for (const [type, f, q, g] of preset.eq) {
      const b = s.filter(type, f, q, g);
      head.connect(b);
      head = b;
    }
    head.connect(this.out);
    this.rpm = this.node.parameters.get('rpm')!;
    this.load = this.node.parameters.get('load')!;
  }

  /** rpm 0 stops it (the revs die away over a moment, like a real engine switched off). */
  set(rpm: number, load: number, level: number, pan = 0, tc = 0.04): void {
    const t = this.s.now;
    if (this.rpm) glide(this.rpm, rpm, t, rpm === 0 ? 0.25 : tc);
    if (this.load) glide(this.load, load, t, 0.03);
    glide(this.out.gain, level * this.preset.level, t, 0.05);
    glide(this.pan.pan, Math.max(-1, Math.min(1, pan)), t, 0.05);
  }
}

/**
 * A gearbox, so the revs behave: road speed and gear give the rpm; it shifts up sooner when
 * you're gentle and later when you're flat out, drops a gear when you slow, cuts the drive for a
 * moment on each shift, and slips the clutch to pull away.
 */
export class Gearbox {
  gear = 1;
  rpm = 0;
  load = 0;
  private shiftT = 0;

  /** @param kmhPer1000 road speed per 1000 rpm in each gear */
  constructor(readonly e: EnginePreset, private kmhPer1000: number[], private upGentle: number, private upHard: number, private down: number) {}

  update(dt: number, kmh: number, throttle: number, braking: boolean): void {
    const n = this.kmhPer1000.length;
    const wheelRpm = (g: number) => (kmh / this.kmhPer1000[g - 1]) * 1000;
    const up = this.upGentle + (this.upHard - this.upGentle) * throttle;
    if (this.shiftT > 0) this.shiftT -= dt;
    // (off the throttle you hold the gear and let it pull you down, unless it's about to over-rev)
    else if (this.gear < n && wheelRpm(this.gear) > (throttle > 0.05 ? up : this.e.redline * 0.97)) { this.gear++; this.shiftT = 0.22; }
    else if (this.gear > 1 && wheelRpm(this.gear) < (braking ? this.down * 1.25 : this.down)) { this.gear--; this.shiftT = 0.18; }
    if (kmh < 2) this.gear = 1;
    // pulling away: the clutch slips, the engine sits above the road speed
    const slip = this.e.idle + throttle * (this.e.redline * 0.42 - this.e.idle);
    let target = Math.max(this.e.idle, wheelRpm(this.gear));
    if (this.gear === 1 && kmh < this.kmhPer1000[0] * 2.4) target = Math.max(target, slip * (1 - kmh / (this.kmhPer1000[0] * 2.6)) + target * (kmh / (this.kmhPer1000[0] * 2.6)));
    // during a shift the revs fall away before the next gear takes up
    if (this.shiftT > 0) target *= 0.9;
    target = Math.min(target, this.e.redline * 1.02);
    this.rpm += (target - this.rpm) * Math.min(1, dt * (this.shiftT > 0 ? 9 : 14));
    this.load = this.shiftT > 0 ? 0 : throttle > 0.02 ? 0.2 + 0.8 * throttle : 0.02;
  }
}

/** Everything one of your vehicles sounds like: engine, starter, tyres, wind and skids. */
export class VehicleSound {
  private engine: EngineVoice;
  private box: Gearbox;
  private tyre: { f: BiquadFilterNode; g: GainNode };
  private wind: { f: BiquadFilterNode; g: GainNode };
  private skid: { f: BiquadFilterNode; g: GainNode };
  private on = false;
  private startT = 0;
  private lastImpact = 0;

  constructor(private s: Sound, private kind: 'bike' | 'car') {
    const e = kind === 'bike' ? ENGINES.cb350rs : ENGINES.harrier;
    this.engine = new EngineVoice(s, e, s.fx);
    this.box = kind === 'bike'
      ? new Gearbox(e, [7.2, 11.6, 15.6, 19.4, 22.8], 3300, 5900, 1900) // 5-speed
      : new Gearbox(e, [7.6, 13.2, 20.5, 28.5, 36.5, 45], 2100, 4100, 1250); // 6-speed
    this.tyre = s.bed('brown', 'lowpass', 260, 0.7, s.fx);
    this.wind = s.bed('white', 'bandpass', 700, 0.5, s.fx);
    this.skid = s.bed('white', 'bandpass', 2100, 6, s.fx);
  }

  /** Get on: the starter cranks, it catches, blips and settles to idle. */
  start(): void {
    if (this.on) return;
    this.on = true;
    this.startT = this.kind === 'bike' ? 0.55 : 0.8;
    this.s.starter(this.startT, this.kind === 'bike' ? 190 : 130);
  }

  stop(): void {
    this.on = false;
    this.engine.set(0, 0, 1);
  }

  /**
   * @param dist camera distance to the vehicle, for level
   */
  update(dt: number, v: { speed: number; kmh: number; impact: number; spec: { maxSpeed: number } }, throttle: number, brake: number, handbrake: boolean, dist: number, pan: number): void {
    const near = 1 / (1 + (Math.max(0, dist - 4) / 10) ** 2);
    const t = this.s.now;
    if (this.on) {
      if (this.startT > 0) {
        this.startT -= dt;
        if (this.startT <= 0) this.box.rpm = this.box.e.idle * 1.7; // catches with a blip
        this.engine.set(this.startT > 0 ? 0 : this.box.rpm, 0.3, near, pan);
      } else {
        this.box.update(dt, v.kmh, Math.max(0, throttle), brake > 0.2);
        this.engine.set(this.box.rpm, this.box.load, near, pan);
      }
    }
    const sp = Math.abs(v.speed) / v.spec.maxSpeed;
    glide(this.tyre.g.gain, Math.min(0.5, (v.kmh / 90) * 0.5) * near, t, 0.08);
    glide(this.wind.g.gain, Math.min(0.35, sp * sp * 0.6) * near, t, 0.1);
    glide(this.wind.f.frequency, 500 + 900 * sp, t, 0.1);
    const skidding = (v.kmh > 25 && brake > 0.85) || (handbrake && v.kmh > 18);
    glide(this.skid.g.gain, skidding ? 0.12 * near : 0, t, 0.04);
    if (v.impact > 0.25 && this.lastImpact <= 0.25) this.s.thud(v.impact);
    this.lastImpact = v.impact;
  }

  get rpm(): number {
    return this.box.rpm;
  }

  get gear(): number {
    return this.box.gear;
  }

  horn(): void {
    if (this.kind === 'bike') this.s.horn([415], 0.45, 0.28);
    else this.s.horn([405, 505], 0.5, 0.32);
  }
}
