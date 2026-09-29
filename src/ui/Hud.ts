const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private areaEn = $('area-en');
  private areaMr = $('area-mr');
  private prompt = $('prompt');
  private speedo = $('speedo');
  private speed = $('speed');
  private vname = $('vehicle-name');
  private actionBtn = $('btn-action');
  private altBtn = $('btn-alt');
  private lastArea = '';
  private toastEl = $('toast');
  private toastT = 0;
  private dest = $('dest');
  private destList = $('dest-list');
  private destItems: HTMLButtonElement[] = [];
  private destHi = 0;
  private destPick: ((i: number) => void) | null = null;

  constructor() {
    $('hud').hidden = false;
    const help = $('help');
    const close = () => (help.hidden = true);
    $('help-btn').addEventListener('click', () => (help.hidden = !help.hidden));
    $('help-close').addEventListener('click', close);
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'Enter') close();
    });
    try {
      if (!localStorage.getItem('nsploop.helpSeen')) {
        help.hidden = false;
        localStorage.setItem('nsploop.helpSeen', '1');
      }
    } catch {
      help.hidden = false;
    }
  }

  setArea(en: string, mr?: string): void {
    const k = en + (mr ?? '');
    if (k === this.lastArea) return;
    this.lastArea = k;
    this.areaEn.textContent = en;
    this.areaMr.textContent = mr ?? '';
  }

  setPrompt(text: string | null): void {
    this.prompt.hidden = !text;
    if (text) this.prompt.textContent = text;
  }

  setDriving(name: string | null, kmh = 0): void {
    this.speedo.hidden = !name;
    if (name) {
      this.speed.textContent = String(Math.round(kmh));
      this.vname.textContent = name;
    }
    this.altBtn.textContent = name ? 'BRAKE' : 'RUN';
  }

  setHint(text: string): void {
    $('hint').textContent = text;
  }

  toggleHint(): void {
    const h = $('hint');
    h.hidden = !h.hidden;
  }

  /** A short message at the top of the screen. */
  toast(text: string, seconds = 3.5): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastT = seconds;
  }

  tick(dt: number): void {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.hidden = true;
    }
  }

  /** The auto's "where to?" menu. */
  showDestinations(items: { n: string; sub?: string }[], pick: (i: number) => void): void {
    this.destList.replaceChildren();
    this.destItems = items.map((it, i) => {
      const b = document.createElement('button');
      b.append(`${i + 1}. ${it.n}`);
      if (it.sub) {
        const s = document.createElement('small');
        s.textContent = it.sub;
        b.append(s);
      }
      b.addEventListener('click', () => this.destPick?.(i));
      this.destList.append(b);
      return b;
    });
    this.destPick = pick;
    this.destHi = 0;
    this.highlight(0);
    this.dest.hidden = false;
  }

  hideDestinations(): void {
    this.dest.hidden = true;
    this.destPick = null;
  }

  get destinationsOpen(): boolean {
    return !this.dest.hidden;
  }

  highlight(d: number): void {
    if (!this.destItems.length) return;
    this.destHi = (this.destHi + d + this.destItems.length) % this.destItems.length;
    this.destItems.forEach((b, i) => b.classList.toggle('hi', i === this.destHi));
  }

  chooseHighlighted(): void {
    this.destPick?.(this.destHi);
  }

  setActionVisible(v: boolean): void {
    this.actionBtn.style.visibility = v ? 'visible' : 'hidden';
  }
}

export function setLoading(f: number, text: string): void {
  ($('load-bar') as HTMLElement).style.width = `${Math.round(f * 100)}%`;
  $('load-text').textContent = text;
}

export function hideLoading(): void {
  $('loading').hidden = true;
}

export function showError(msg: string): void {
  $('load-text').textContent = msg;
}
