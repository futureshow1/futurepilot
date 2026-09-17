// FuturePilot — telemetria drążków i lotu: z niej powstaje informacja zwrotna „trenera".
// Idea: gra ocenia nie tylko WYNIK (czas, celność), ale też SPOSÓB sterowania (płynność, proporcjonalność),
// bo to on przenosi się na prawdziwy sprzęt.

const AXES = ['throttle', 'yaw', 'pitch', 'roll'];

class AxisTracker {
  constructor(h = 0.07) {
    this.h = h;
    this.dir = 0;
    this.ext = null;
    this.rev = 0;
    this.sat = 0;
    this.absVel = 0;
    this.active = 0;
    this.last = null;
  }
  push(x, dt) {
    if (this.ext === null) {
      this.ext = x;
      this.last = x;
      return;
    }
    // zmiana kierunku ruchu drążka z histerezą h (odporność na drżenie palca / szum osi)
    if (this.dir === 0) {
      if (x > this.ext + this.h) {
        this.dir = 1;
        this.ext = x;
      } else if (x < this.ext - this.h) {
        this.dir = -1;
        this.ext = x;
      }
    } else if (this.dir === 1) {
      if (x > this.ext) this.ext = x;
      else if (x < this.ext - this.h) {
        this.dir = -1;
        this.ext = x;
        this.rev++;
      }
    } else {
      if (x < this.ext) this.ext = x;
      else if (x > this.ext + this.h) {
        this.dir = 1;
        this.ext = x;
        this.rev++;
      }
    }
    this.absVel += Math.abs(x - this.last);
    if (Math.abs(x) > 0.93) this.sat += dt;
    if (Math.abs(x) > 0.08) this.active += dt;
    this.last = x;
  }
}

export class Telemetry {
  constructor() {
    this.reset();
  }
  reset() {
    this.t = 0;
    this.acc = 0;
    this.ax = {};
    for (const a of AXES) this.ax[a] = new AxisTracker();
    this.path = 0;
    this.lastP = null;
    this.maxSpeed = 0;
    this.maxAlt = 0;
    this.trace = []; // rzadki ślad toru lotu (do podglądu po ćwiczeniu)
  }
  sample(dt, sticks, sim) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    const step = this.acc;
    this.acc = 0;
    for (const a of AXES) this.ax[a].push(sticks[a], step);
    if (this.lastP && !sim.landed) this.path += Math.hypot(sim.p.x - this.lastP.x, sim.p.y - this.lastP.y, sim.p.z - this.lastP.z);
    this.lastP = { x: sim.p.x, y: sim.p.y, z: sim.p.z };
    this.maxSpeed = Math.max(this.maxSpeed, sim.speed);
    this.maxAlt = Math.max(this.maxAlt, sim.altitude);
    if (this.trace.length < 1500 && (this.trace.length === 0 || this.t - this.trace[this.trace.length - 1].t > 0.2)) {
      this.trace.push({ t: this.t, x: sim.p.x, y: sim.p.y, z: sim.p.z });
    }
  }
  summary() {
    const T = Math.max(this.t, 0.001);
    const out = { duration: T, path: this.path, maxSpeed: this.maxSpeed, maxAlt: this.maxAlt, axes: {} };
    for (const a of AXES) {
      const k = this.ax[a];
      out.axes[a] = { revPerSec: k.rev / T, satFrac: k.sat / T, activity: k.absVel / T, activeFrac: k.active / T };
    }
    out.rightRev = (out.axes.pitch.revPerSec + out.axes.roll.revPerSec) / 2;
    out.rightSat = Math.max(out.axes.pitch.satFrac, out.axes.roll.satFrac);
    // płynność 0..1 — do profilu umiejętności (1 = spokojne, proporcjonalne sterowanie)
    const jitter = Math.max(0, out.rightRev - 0.9) / 2.6;
    out.smoothness = Math.max(0, Math.min(1, 1 - jitter - out.rightSat * 0.8));
    return out;
  }
}

const pct = (x) => Math.round(x * 100);
const fmt1 = (x) => x.toFixed(1).replace('.', ',');

// Ogólne wskazówki „trenera" z telemetrii (maks. 2; szczegółowe dodają same ćwiczenia)
export function coachTips(sum, { manualThrottle = false, usesYaw = false } = {}) {
  const tips = [];
  if (sum.rightSat > 0.22) {
    tips.push({
      w: 3,
      text: `Przez ${pct(sum.rightSat)}% lotu prawy drążek był wychylony do oporu. Prawdziwym dronem steruje się proporcjonalnie: małe wychylenie to wolny ruch. Spróbuj przelecieć to samo na „pół drążka".`,
    });
  }
  if (sum.rightRev > 2.3) {
    tips.push({
      w: 2.5,
      text: `Dużo szybkich, drobnych korekt (${fmt1(sum.rightRev)} zmiany kierunku na sekundę). Dron ma bezwładność — wychyl mniej, odczekaj na reakcję i dopiero wtedy poprawiaj.`,
    });
  }
  if (manualThrottle && sum.axes.throttle.revPerSec > 1.7) {
    tips.push({
      w: 2.8,
      text: `„Pompowanie" gazem (${fmt1(sum.axes.throttle.revPerSec)} zmiany na sekundę). Znajdź punkt zawisu i poprawiaj go ruchami o milimetr, nie o centymetr.`,
    });
  }
  if (usesYaw && sum.axes.yaw.activeFrac < 0.12) {
    tips.push({ w: 1.5, text: 'Prawie nie używasz obrotu (yaw). W locie do przodu zakręt prowadzi się obrotem i przechyłem jednocześnie — ćwicz to w „Ósemce".' });
  }
  tips.sort((a, b) => b.w - a.w);
  return tips.slice(0, 2).map((t) => t.text);
}
