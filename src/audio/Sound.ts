import { ENGINE_WORKLET } from './worklet';

/**
 * The audio context and everything shared: master bus with a gentle compressor (Nalasopara is
 * loud, but it shouldn't clip), looping noise sources, and the one-shot sounds — horns, crows,
 * dogs, the station chime, bumps and skids. Everything is synthesised; there are no samples.
 */
export class Sound {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** engines and one-shots feed this; ambience has its own bus so it can duck under the engine */
  readonly fx: GainNode;
  readonly amb: GainNode;
  worklet = false;
  private white: AudioBuffer;
  private brown: AudioBuffer;
  private muted = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp).connect(this.ctx.destination);
    this.fx = this.ctx.createGain();
    this.fx.connect(this.master);
    this.amb = this.ctx.createGain();
    this.amb.connect(this.master);
    const sr = this.ctx.sampleRate, n = sr * 3;
    this.white = this.ctx.createBuffer(1, n, sr);
    this.brown = this.ctx.createBuffer(1, n, sr);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
  }

  async init(): Promise<void> {
    try {
      if (!this.ctx.audioWorklet) return;
      const url = URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      this.worklet = true;
    } catch (e) {
      console.warn('engine sound unavailable', e);
    }
  }

  /** Browsers only start audio after a tap or key press. */
  resume(): void {
    if (this.ctx.state !== 'running' && !this.muted) void this.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (m) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** A looping noise source (white or brown). */
  noise(kind: 'white' | 'brown' = 'white'): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = kind === 'white' ? this.white : this.brown;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 2);
    return s;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7, gain = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }

  gain(v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  /** A panner-and-level output into a bus. */
  out(level: number, pan: number, bus: AudioNode = this.fx): GainNode {
    const g = this.gain(level);
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(bus);
    return g;
  }

  // ------------------------------------------------------------------------------------------
  // one-shots

  /**
   * An electric horn: one or two buzzy tones (a vibrating diaphragm is rich in odd harmonics),
   * shaped by the trumpet's resonance, with a slight pitch sag as it starts.
   */
  horn(freqs: number[], dur: number, level: number, pan = 0, bus: AudioNode = this.fx, shape = 1): void {
    const t = this.now;
    const out = this.out(0, pan, bus);
    const body = this.filter('peaking', freqs[0] * 2.2, 1.2, 8);
    const lp = this.filter('lowpass', 3200 * shape, 0.7);
    body.connect(lp).connect(out);
    for (const f of freqs) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      o.connect(body);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(level, t + 0.02);
    out.gain.setValueAtTime(level, t + dur - 0.04);
    out.gain.linearRampToValueAtTime(0, t + dur);
  }

  /** A crow's "kaa-kaa": a harsh, falling, nasal call. */
  crow(level: number, pan: number): void {
    const n = 2 + Math.floor(Math.random() * 2);
    const base = 480 + Math.random() * 160;
    for (let k = 0; k < n; k++) {
      const t = this.now + k * (0.34 + Math.random() * 0.08);
      const out = this.out(0, pan, this.amb);
      const f1 = this.filter('bandpass', 1150, 3), f2 = this.filter('bandpass', 2300, 4);
      f1.connect(out);
      f2.connect(out);
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 1.1, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.26);
      o.connect(f1);
      o.connect(f2);
      const nz = this.ctx.createBufferSource();
      nz.buffer = this.white;
      const ng = this.gain(0.35);
      nz.connect(ng).connect(f1);
      o.start(t);
      o.stop(t + 0.3);
      nz.start(t, Math.random());
      nz.stop(t + 0.3);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(level, t + 0.03);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    }
  }

  /** A street dog: a couple of short, rough barks. */
  bark(level: number, pan: number): void {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const t = this.now + k * (0.22 + Math.random() * 0.1);
      const out = this.out(0, pan, this.amb);
      const f = this.filter('bandpass', 700 + Math.random() * 300, 2.5);
      f.connect(out);
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(380 + Math.random() * 80, t);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.12);
      o.connect(f);
      const nz = this.ctx.createBufferSource();
      nz.buffer = this.white;
      nz.connect(this.gain(0.5)).connect(f);
      o.start(t);
      o.stop(t + 0.16);
      nz.start(t, Math.random());
      nz.stop(t + 0.16);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(level, t + 0.01);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    }
  }

  /** The station's announcement chime: three bell tones before an announcement. */
  chime(level: number, pan: number): void {
    const notes = [659.3, 830.6, 987.8, 830.6];
    notes.forEach((f, k) => {
      const t = this.now + k * 0.42;
      const out = this.out(0, pan, this.amb);
      for (const [mul, g] of [[1, 1], [2.76, 0.3], [5.4, 0.12]]) {
        const o = this.ctx.createOscillator();
        o.frequency.value = f * mul;
        const og = this.gain(g);
        o.connect(og).connect(out);
        o.start(t);
        o.stop(t + 1.6);
      }
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(level, t + 0.01);
      out.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    });
  }

  /** A bump: low thud plus a crunch, scaled by how hard. */
  thud(strength: number): void {
    const t = this.now;
    const out = this.out(0, 0);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    o.connect(out);
    o.start(t);
    o.stop(t + 0.3);
    const nz = this.ctx.createBufferSource();
    nz.buffer = this.white;
    const f = this.filter('bandpass', 1400, 0.8);
    nz.connect(f).connect(out);
    nz.start(t, Math.random());
    nz.stop(t + 0.25);
    const lv = 0.25 + 0.6 * strength;
    out.gain.setValueAtTime(lv, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  }

  /** An electric starter cranking a cold engine: whirr with the compression stroke in it. */
  starter(dur: number, pitch: number): void {
    const t = this.now;
    const out = this.out(0, 0);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch * 0.7, t);
    o.frequency.linearRampToValueAtTime(pitch, t + dur);
    const f = this.filter('bandpass', pitch * 3, 1.5);
    const chug = this.gain(0.5);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoG = this.gain(0.45);
    lfo.connect(lfoG).connect(chug.gain);
    o.connect(f).connect(chug).connect(out);
    o.start(t);
    o.stop(t + dur);
    lfo.start(t);
    lfo.stop(t + dur);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.35, t + 0.05);
    out.gain.setValueAtTime(0.35, t + dur - 0.05);
    out.gain.linearRampToValueAtTime(0, t + dur);
  }

  /** A short metallic click (a wheel over a rail joint). */
  click(level: number, pan: number, delay = 0, freq = 1800): void {
    const t = this.now + delay;
    const out = this.out(0, pan, this.amb);
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    src.connect(this.filter('bandpass', freq, 1.2)).connect(out);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.06);
    out.gain.setValueAtTime(level, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  }

  /** A looping noise voice with a filter and a level you drive every frame. */
  bed(kind: 'white' | 'brown', type: BiquadFilterType, freq: number, q: number, bus: AudioNode): { f: BiquadFilterNode; g: GainNode } {
    const f = this.filter(type, freq, q);
    const g = this.gain(0);
    this.noise(kind).connect(f).connect(g).connect(bus);
    return { f, g };
  }
}

/** Set an AudioParam smoothly toward a value (for per-frame control). */
export function glide(p: AudioParam, v: number, t: number, tc = 0.05): void {
  p.setTargetAtTime(v, t, tc);
}
