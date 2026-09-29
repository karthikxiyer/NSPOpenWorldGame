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
      if (!localStorage.getItem('nsp.helpSeen')) {
        help.hidden = false;
        localStorage.setItem('nsp.helpSeen', '1');
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
