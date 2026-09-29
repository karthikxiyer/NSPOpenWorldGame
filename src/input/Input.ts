// Unified input: keyboard, mouse-drag look, gamepad, and touch (virtual stick + buttons).

export interface InputState {
  /** -1..1, right positive */
  x: number;
  /** -1..1, forward positive */
  y: number;
  throttle: number;
  brake: number;
  /** run on foot / handbrake in a vehicle */
  alt: boolean;
  /** camera look delta this frame (radians) */
  lookX: number;
  lookY: number;
}

export class Input {
  readonly isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private look = { x: 0, y: 0 };
  private dragging: { id: number; x: number; y: number } | null = null;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private touchAlt = false;
  private padPrev: boolean[] = [];

  constructor(canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // mouse / touch drag on the canvas rotates the camera
    canvas.addEventListener('pointerdown', (e) => {
      if (this.dragging) return;
      this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || this.dragging.id !== e.pointerId) return;
      const k = this.isTouch ? 0.008 : 0.005;
      this.look.x += (e.clientX - this.dragging.x) * k;
      this.look.y += (e.clientY - this.dragging.y) * k;
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (this.dragging?.id === e.pointerId) this.dragging = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    if (this.isTouch) this.setupTouch();
  }

  private setupTouch() {
    document.body.classList.add('touch');
    document.getElementById('touch')!.hidden = false;
    const zone = document.getElementById('stick-zone')!;
    const base = document.getElementById('stick-base')!;
    const knob = document.getElementById('stick-knob')!;
    const R = 55;
    const place = () => {
      knob.style.transform = `translate(${this.stick.x * R}px, ${this.stick.y * R}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stick.id = e.pointerId;
      const r = base.getBoundingClientRect();
      this.stick.ox = r.left + r.width / 2;
      this.stick.oy = r.top + r.height / 2;
      zone.setPointerCapture(e.pointerId);
      this.moveStick(e.clientX, e.clientY, R);
      place();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.moveStick(e.clientX, e.clientY, R);
      place();
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = -1;
      this.stick.x = this.stick.y = 0;
      place();
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    const action = document.getElementById('btn-action')!;
    action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pressed.add('KeyE');
    });
    const alt = document.getElementById('btn-alt')!;
    alt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchAlt = true;
      alt.classList.add('active');
    });
    const altUp = () => {
      this.touchAlt = false;
      alt.classList.remove('active');
    };
    alt.addEventListener('pointerup', altUp);
    alt.addEventListener('pointercancel', altUp);
    alt.addEventListener('pointerleave', altUp);
  }

  private moveStick(cx: number, cy: number, R: number) {
    let dx = (cx - this.stick.ox) / R, dy = (cy - this.stick.oy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    this.stick.x = dx;
    this.stick.y = dy;
  }

  /** Returns true once per key press (keyboard code, or the gamepad/touch equivalents mapped to codes). */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  read(): InputState {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    let x = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    let y = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    let throttle = Math.max(k('KeyW'), k('ArrowUp'));
    let brake = Math.max(k('KeyS'), k('ArrowDown'));
    let alt = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Space') || this.touchAlt;

    // touch stick: up = forward/throttle, down = back/brake
    if (this.stick.id !== -1 || this.stick.x || this.stick.y) {
      const dead = 0.12;
      const sx = Math.abs(this.stick.x) > dead ? this.stick.x : 0;
      const sy = Math.abs(this.stick.y) > dead ? -this.stick.y : 0;
      x += sx;
      y += sy;
      throttle = Math.max(throttle, sy > 0 ? Math.min(1, sy * 1.3) : 0);
      brake = Math.max(brake, sy < 0 ? Math.min(1, -sy * 1.3) : 0);
    }

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = (i: number) => (Math.abs(pad.axes[i] ?? 0) > 0.15 ? pad.axes[i] : 0);
      const btn = (i: number) => pad.buttons[i]?.value ?? 0;
      x += ax(0);
      y += -ax(1);
      throttle = Math.max(throttle, btn(7), -ax(1) > 0.5 ? 1 : 0);
      brake = Math.max(brake, btn(6));
      alt = alt || btn(2) > 0.5 || btn(10) > 0.5;
      this.look.x += ax(2) * 0.05;
      this.look.y += ax(3) * 0.03;
      const now = pad.buttons.map((b) => b.pressed);
      if (now[0] && !this.padPrev[0]) this.pressed.add('KeyE');
      if (now[3] && !this.padPrev[3]) this.pressed.add('KeyC');
      if (now[9] && !this.padPrev[9]) this.pressed.add('Escape');
      this.padPrev = now;
      break;
    }

    const look = { ...this.look };
    this.look.x = this.look.y = 0;
    return {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      throttle: Math.min(1, throttle),
      brake: Math.min(1, brake),
      alt,
      lookX: look.x,
      lookY: look.y,
    };
  }
}
