/**
 * The engine synthesiser, as the source of an AudioWorklet module (loaded from a Blob URL so it
 * needs no separate build step).
 *
 * A four-stroke cylinder fires once every two revolutions, so an engine at `rpm` completes
 * rpm / 120 cycles a second and each cylinder puts one pressure pulse into the exhaust per cycle
 * at its own point in the firing order. Each pulse is a damped low sine (the "whump") with a
 * sharp crack of noise on its leading edge; small cycle-to-cycle variation keeps it alive. The
 * pulses run through a waveguide model of the exhaust pipe (a delay line with an inverting,
 * lossy open-end reflection), which gives the note its body. Diesels add combustion knock, a
 * turbocharger adds a whistle that spools up with boost, and a hot single on a closed throttle
 * pops on the overrun.
 */
export const ENGINE_WORKLET = /* js */ `
class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 15000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const o = options.processorOptions;
    this.offsets = o.offsets;
    this.f0 = o.pulseHz;
    this.tau = o.pulseTau;
    this.click = o.click;
    this.jitter = o.jitter;
    this.mech = o.mech;
    this.knock = o.knock;
    this.turbo = o.turbo;
    this.pops = o.pops;
    this.pipe = Math.max(8, Math.round(sampleRate * o.pipeDelay));
    this.fb = o.pipeFeedback;
    this.damp = o.pipeDamp;
    this.buf = new Float32Array(this.pipe + 1);
    this.w = 0;
    this.lp = 0;
    this.phase = Math.random();
    this.pulses = [];
    this.knocks = [];
    this.boost = 0;
    this.tph = 0;
    this.nlp = 0;
    this.hp = 0;
    this.prevOut = 0;
    this.seed = (Math.random() * 4294967296) >>> 0;
    // the cycle-to-cycle wobble in the firing interval (combustion is never quite the same twice)
    this.wobble = 0;
  }

  rnd() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    const ch = out[0];
    if (!ch) return true;
    const rpm = params.rpm[0], load = params.load[0];
    const sr = sampleRate;
    const running = rpm > 110;
    for (let i = 0; i < ch.length; i++) {
      let x = 0;
      if (running) {
        const prev = this.phase;
        this.phase += (rpm / 120 / sr) * (1 + this.wobble);
        if (this.phase >= 1) {
          this.phase -= 1;
          this.wobble = (this.rnd() - 0.5) * this.jitter * 0.12;
        }
        for (let c = 0; c < this.offsets.length; c++) {
          const off = this.offsets[c];
          const a = prev - off - Math.floor(prev - off), b = this.phase - off - Math.floor(this.phase - off);
          if (b < a) {
            // one combustion: stronger under load, a little different every time
            const amp = (0.28 + 0.72 * load) * (1 + this.jitter * (this.rnd() - 0.5)) * Math.min(1, rpm / 500);
            this.pulses.push({ t: 0, a: amp, c: this.click });
            if (this.knock > 0) this.knocks.push({ t: 0, a: this.knock * (0.6 + 0.4 * (1 - load)) * (0.8 + 0.4 * this.rnd()) });
            // overrun: unburnt fuel popping in a hot exhaust
            if (this.pops > 0 && load < 0.06 && rpm > 2800 && this.rnd() < this.pops) {
              this.pulses.push({ t: -Math.floor(sr * (0.004 + 0.01 * this.rnd())), a: 0.7 + 0.6 * this.rnd(), c: 2.2 });
            }
          }
        }
      }
      for (let k = this.pulses.length - 1; k >= 0; k--) {
        const p = this.pulses[k];
        p.t++;
        if (p.t < 0) continue;
        const t = p.t / sr;
        x += p.a * (Math.exp(-t / this.tau) * Math.sin(6.2831853 * this.f0 * t) + p.c * Math.exp(-t / 0.0006) * (this.rnd() * 2 - 1));
        if (t > this.tau * 7) this.pulses.splice(k, 1);
      }
      // diesel knock: bright, short, rattly
      let kx = 0;
      for (let k = this.knocks.length - 1; k >= 0; k--) {
        const q = this.knocks[k];
        const t = q.t++ / sr;
        const n = this.rnd() * 2 - 1;
        kx += q.a * Math.exp(-t / 0.0014) * (n - this.nlp);
        if (t > 0.012) this.knocks.splice(k, 1);
      }
      // the exhaust pipe: delay line with an inverting, lossy reflection at the open end
      const r = this.w + 1 >= this.buf.length ? 0 : this.w + 1;
      this.lp += (this.buf[r] - this.lp) * this.damp;
      const y = x + this.fb * this.lp;
      this.buf[this.w] = y;
      this.w = r;
      // valve train and chain: high, faint, rising with revs
      const n = this.rnd() * 2 - 1;
      this.nlp += (n - this.nlp) * 0.3;
      const mech = running ? this.mech * (n - this.nlp) * Math.min(1.5, rpm / 4500) : 0;
      // turbo: spools up with revs and throttle, with lag, and whistles
      let tur = 0;
      if (this.turbo > 0) {
        const want = running ? Math.min(1, Math.max(0, (rpm - 1500) / 2500)) * load : 0;
        this.boost += (want - this.boost) * (want > this.boost ? 0.00003 : 0.00008);
        this.tph += (2200 + 4200 * this.boost) / sr;
        if (this.tph > 1) this.tph -= 1;
        tur = this.turbo * this.boost * this.boost * Math.sin(6.2831853 * this.tph);
      }
      // DC blocker, then a soft clip for the grit of a real exhaust
      const s = y + kx + mech;
      this.hp = s - this.prevOut + 0.995 * this.hp;
      this.prevOut = s;
      ch[i] = Math.tanh(this.hp * 1.6) * 0.6 + tur;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch);
    return true;
  }
}
registerProcessor('nsp-engine', EngineProcessor);
`;
