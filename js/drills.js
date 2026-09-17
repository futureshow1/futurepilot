// FuturePilot — ćwiczenia (mikro-drille 40–90 s), każde izoluje jedną umiejętność operatora.
// Poziomy = „kółka boczne, które znikają": GPS → STABILNY → ANGLE → ACRO, do tego wiatr i ciaśniejsze tolerancje.

import { THREE, PILOT, rng } from './world.js';
import { coachTips } from './telemetry.js';

const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const fmt = (x, d = 1) => x.toFixed(d).replace('.', ',');

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100,
    b = a % 10;
  if (n === 1) return one;
  if (b >= 2 && b <= 4 && !(a >= 12 && a <= 14)) return few;
  return many;
}

export const SKILLS = {
  alt: { label: 'Wysokość', desc: 'Panowanie nad gazem i wysokością' },
  hover: { label: 'Zawis', desc: 'Utrzymanie drona w miejscu' },
  pos: { label: 'Pozycja', desc: 'Precyzyjne przeloty i lądowania' },
  orient: { label: 'Orientacja', desc: 'Sterowanie, gdy dron leci „na ciebie"' },
  coord: { label: 'Koordynacja', desc: 'Zakręty: obrót i przechył jednocześnie' },
  fpv: { label: 'FPV', desc: 'Lot z widokiem z kamery drona' },
  cam: { label: 'Kamera', desc: 'Płynne prowadzenie kadru' },
};

function starsFor(score, completed) {
  if (!completed) return 0;
  return score >= 88 ? 3 : score >= 70 ? 2 : score >= 50 ? 1 : 0;
}

class Drill {
  constructor(level, ctx) {
    this.level = level;
    this.cfg = this.constructor.levels[level - 1];
    this.t = 0;
    this.done = false;
    this.completed = false;
    this.crashes = 0;
    this.penalty = 0;
    // Pierwsze poziomy mają uczyć, nie odsiewać: luźniejsze normy czasu i tańsze kraksy.
    // Surowość rośnie z poziomem; pełne wymagania od poziomu 3. (Do kalibracji na testach z ludźmi.)
    // `ease` w konfiguracji poziomu oznacza „pierwszy kontakt z nowym trybem" (np. ręczny gaz) — też traktowany łagodnie.
    this.ease = this.cfg.ease || (level === 1 ? 1.8 : level === 2 ? 1.4 : 1);
    this.crashCost = this.ease >= 1.6 ? 6 : this.ease >= 1.4 ? 9 : 12;
  }
  get mode() {
    return this.cfg.mode;
  }
  get view() {
    return this.cfg.view || this.constructor.view || 'los';
  }
  get drone() {
    return this.constructor.drone || 'trainer';
  }
  get timeLimit() {
    return (this.cfg.limit || 90) * (this.ease >= 1.6 ? 1.6 : this.ease >= 1.4 ? 1.3 : 1);
  }
  start() {
    return { pos: { x: 0, y: 0, z: -6 }, heading: 0, airborne: false };
  }
  setup(ctx) {}
  update(dt, ctx) {}
  // po kraksie: gdzie odrodzić drona (domyślnie: tam, gdzie start)
  respawn(ctx) {
    return this.start();
  }
  onCrash(ctx) {
    this.crashes++;
    this.penalty += this.crashCost;
  }
  finish(completed) {
    this.done = true;
    this.completed = completed;
  }
  baseResult(ctx, score, metrics, tips = []) {
    const sum = ctx.telemetry.summary();
    score = Math.round(Math.max(0, Math.min(100, score - this.penalty)));
    if (this.crashes) metrics.push({ label: 'Kraksy', value: String(this.crashes), good: 0 });
    metrics.push({ label: 'Płynność sterowania (orientacyjnie)', value: `${Math.round(sum.smoothness * 100)}%`, good: sum.smoothness, neutral: true });
    const manual = this.mode === 'angle' || this.mode === 'acro';
    const all = [...tips, ...coachTips(sum, { manualThrottle: manual, usesYaw: this.constructor.usesYaw })].slice(0, 3);
    return { score, stars: starsFor(score, this.completed), completed: this.completed, metrics, tips: all, summary: sum };
  }
}

function windFor(ctx, cfg) {
  if (cfg.wind) ctx.wind.set(cfg.wind, cfg.windDir ?? 90, cfg.gust || 0);
  else ctx.wind.set(0, 0, 0);
}

// =====================================================================================
// 1. PIERWSZY START — wysokość
// =====================================================================================
export class DrillAltitude extends Drill {
  static id = 'alt';
  static title = 'Pierwszy start';
  static skill = 'alt';
  static goal = 'Wystartuj, utrzymaj drona w zielonej strefie na kolejnych wysokościach i miękko wyląduj.';
  static why = 'Lewy drążek w górę i w dół to wysokość. Każdy lot zaczyna się i kończy tą umiejętnością.';
  static levels = [
    { mode: 'gps', tol: 0.75, targets: [2.5, 5, 3], hold: 2.5, limit: 80, par: 34 },
    { mode: 'alt', tol: 0.55, targets: [2, 6, 3.5, 1.5], hold: 3, wind: 1.5, limit: 90, par: 46 },
    { mode: 'angle', tol: 0.85, targets: [2.5, 5, 3], hold: 2.5, limit: 90, par: 40, assist: 1.6, ease: 1.6 },
    { mode: 'angle', tol: 0.7, targets: [2.5, 5, 3], hold: 3, limit: 110, par: 44, ease: 1.4 },
    { mode: 'angle', tol: 0.45, targets: [2, 6, 3.5, 1.5], hold: 3, wind: 2, gust: 0.6, limit: 100, par: 52 },
  ];
  setup(ctx) {
    windFor(ctx, this.cfg);
    this.pad = { x: 0, z: -6 };
    ctx.world.addPad(this.pad.x, this.pad.z, 1.2);
    this.i = 0;
    this.holdT = 0;
    this.overshoots = 0;
    this._side = 0;
    this.phase = 'climb';
    this._makeZone(ctx);
    this.wasAir = false;
  }
  _makeZone(ctx) {
    if (this.zone) ctx.world.drillGroup.remove(this.zone);
    const y = this.cfg.targets[this.i];
    this.zone = ctx.world.addZone(this.pad.x, this.pad.z, 2.4, y - this.cfg.tol, y + this.cfg.tol);
    this._side = 0;
  }
  update(dt, ctx) {
    const s = ctx.sim,
      c = this.cfg;
    if (!s.landed && s.altitude > 0.8) this.wasAir = true;
    const dx = s.p.x - this.pad.x,
      dz = s.p.z - this.pad.z,
      dh = Math.hypot(dx, dz);
    if (this.phase === 'climb') {
      const y = c.targets[this.i];
      const dy = s.altitude - y;
      const inside = Math.abs(dy) <= c.tol && dh <= 2.4;
      // przestrzelenie: przelot przez strefę na wylot
      const side = dy > c.tol ? 1 : dy < -c.tol ? -1 : 0;
      if (side !== 0) {
        if (this._side !== 0 && side !== this._side && this.holdT > 0) this.overshoots++;
        this._side = side;
      }
      this.holdT = inside ? this.holdT + dt : Math.max(0, this.holdT - dt * 0.7);
      ctx.world.setZoneColor(this.zone, inside ? 0x3ddc84 : 0xffb020, inside ? 0.26 : 0.14);
      ctx.hud.objective(`Wysokość ${fmt(y)} m — utrzymaj drona w strefie (${this.i + 1}/${c.targets.length})`);
      ctx.hud.progress(this.holdT / c.hold);
      ctx.hud.marker(V(this.pad.x, y, this.pad.z), `${fmt(y)} m`);
      if (dh > 2.4 && !s.landed) ctx.hud.sub('Znosi cię — wróć nad lądowisko prawym drążkiem');
      else ctx.hud.sub(dy > c.tol ? 'Za wysoko' : dy < -c.tol ? 'Za nisko' : 'Trzymaj…');
      if (this.holdT >= c.hold) {
        this.i++;
        this.holdT = 0;
        ctx.hud.flash('Dobrze!', 'ok');
        if (this.i >= c.targets.length) {
          this.phase = 'land';
          ctx.world.drillGroup.remove(this.zone);
        } else this._makeZone(ctx);
      }
    } else {
      ctx.hud.objective('Teraz miękko wyląduj na lądowisku');
      ctx.hud.progress(null);
      ctx.hud.marker(V(this.pad.x, 0.1, this.pad.z), 'Lądowisko');
      ctx.hud.sub(s.altitude < 1 ? 'Powoli…' : '');
      if (s.landed && this.wasAir) {
        this.tdSpeed = s.touchdownSpeed || 0;
        this.tdDist = dh;
        this.finish(true);
      }
    }
  }
  onCrash(ctx) {
    super.onCrash(ctx);
    this.wasAir = false; // po kraksie trzeba wystartować ponownie — lądowanie „z odrodzenia" się nie liczy
    this.holdT = 0;
  }
  result(ctx) {
    const c = this.cfg;
    const frac = this.completed ? 1 : this.i / (c.targets.length + 1);
    let score = 100 * frac;
    if (this.completed) {
      score -= clamp01((this.t - c.par * this.ease) / (c.par * this.ease)) * 35;
      score -= this.overshoots * 4;
      score -= clamp01(((this.tdSpeed || 0) - 0.8) / 1.6) * 22; // twarde przyziemienie to realne uszkodzenia
      score -= clamp01(((this.tdDist || 0) - 0.5) / 2) * 12;
    } else score *= 0.6;
    const m = [
      { label: 'Czas', value: `${fmt(this.t)} s`, good: clamp01(1 - (this.t - c.par * this.ease) / (c.par * this.ease)) },
      { label: 'Przestrzelenia wysokości', value: String(this.overshoots), good: clamp01(1 - this.overshoots / 4) },
    ];
    const tips = [];
    if (this.completed) {
      m.push({ label: 'Przyziemienie', value: `${fmt(this.tdSpeed, 2)} m/s`, good: clamp01(1 - (this.tdSpeed - 0.6) / 1.6) });
      m.push({ label: 'Odległość od środka lądowiska', value: `${fmt(this.tdDist, 2)} m`, good: clamp01(1 - this.tdDist / 1.5) });
    }
    if (this.overshoots >= 2) tips.push('Przestrzeliwujesz wysokość. Zacznij zwalniać wznoszenie metr przed strefą — dron potrzebuje chwili, żeby wyhamować.');
    return this.baseResult(ctx, score, m, tips);
  }
}

// =====================================================================================
// 2. ZAWIS W POLU
// =====================================================================================
export class DrillHover extends Drill {
  static id = 'hover';
  static title = 'Zawis w polu';
  static skill = 'hover';
  static goal = 'Wleć do zielonego pola i utrzymaj w nim drona przez 30 sekund.';
  static why = 'Zawis to fundament: kto umie stać w miejscu mimo wiatru, ten panuje nad dronem.';
  static levels = [
    { mode: 'alt', box: [4.5, 3, 4.5], wind: 1.5, gust: 0.3, T: 30, limit: 70 },
    { mode: 'angle', box: [4.8, 3.6, 4.8], T: 30, limit: 75, assist: 1.6, ease: 1.6 },
    { mode: 'angle', box: [4.5, 3.2, 4.5], T: 30, limit: 80, ease: 1.4 },
    { mode: 'angle', box: [3.2, 2.4, 3.2], wind: 2, gust: 0.8, T: 30, limit: 75 },
    { mode: 'angle', box: [3.6, 2.8, 3.6], wind: 1.5, gust: 0.5, T: 30, limit: 75, noseIn: true },
    { mode: 'acro', box: [5.5, 4, 5.5], T: 25, limit: 75 },
  ];
  start() {
    return { pos: { x: 0, y: 0, z: -8 }, heading: this.cfg.noseIn ? Math.PI : 0, airborne: false };
  }
  setup(ctx) {
    windFor(ctx, this.cfg);
    const [w, h, d] = this.cfg.box;
    this.c = V(0, 2.6, -8);
    this.half = V(w / 2, h / 2, d / 2);
    ctx.world.addPad(0, -8, 1.0);
    this.box = ctx.world.addBox(this.c.x, this.c.y, this.c.z, w, h, d);
    this.phase = 'enter';
    this.inT = 0;
    this.runT = 0;
    this.sqErr = 0;
    this.n = 0;
    this.exits = 0;
    this._wasIn = false;
  }
  update(dt, ctx) {
    const s = ctx.sim;
    const dx = s.p.x - this.c.x,
      dy = s.p.y - this.c.y,
      dz = s.p.z - this.c.z;
    const inside = Math.abs(dx) <= this.half.x && Math.abs(dy) <= this.half.y && Math.abs(dz) <= this.half.z;
    ctx.world.setBoxColor(this.box, inside ? 0x3ddc84 : this.phase === 'hold' ? 0xff5a4f : 0xffb020);
    ctx.hud.marker(this.c, 'Pole');
    if (this.phase === 'enter') {
      ctx.hud.objective(this.cfg.noseIn ? 'Dron stoi przodem do ciebie. Wystartuj i wleć do pola' : 'Wystartuj i wleć do zielonego pola');
      ctx.hud.progress(null);
      if (inside) {
        this.phase = 'hold';
        ctx.hud.flash('Trzymaj!', 'ok');
      }
    } else {
      this.runT += dt;
      if (inside) this.inT += dt;
      if (this._wasIn && !inside) this.exits++;
      this.sqErr += dx * dx + dy * dy + dz * dz;
      this.n++;
      ctx.hud.objective(`Utrzymaj drona w polu — ${Math.ceil(this.cfg.T - this.runT)} s`);
      ctx.hud.progress(this.runT / this.cfg.T);
      ctx.hud.sub(inside ? '' : 'Poza polem — wracaj spokojnie');
      if (this.runT >= this.cfg.T) this.finish(true);
    }
    this._wasIn = inside;
  }
  result(ctx) {
    const frac = this.runT > 0 ? this.inT / this.cfg.T : 0;
    const rms = this.n ? Math.sqrt(this.sqErr / this.n) : 9;
    const ref = Math.hypot(this.half.x, this.half.y, this.half.z);
    const precision = clamp01(1 - rms / (ref * 0.85));
    let score = this.completed ? 72 * Math.pow(frac, 1.15) + 28 * precision : 30 * frac;
    const m = [
      { label: 'Czas w polu', value: `${Math.round(frac * 100)}%`, good: frac },
      { label: 'Średnia odchyłka od środka', value: `${fmt(rms, 2)} m`, good: precision },
      { label: 'Wyjścia poza pole', value: String(this.exits), good: clamp01(1 - this.exits / 5) },
    ];
    const tips = [];
    if (this.exits >= 3) tips.push('Gdy dron zaczyna odpływać, reaguj od razu, ale małym wychyleniem. Duża, spóźniona kontra kończy się wahadłem.');
    if (this.cfg.noseIn && frac < 0.7) tips.push('Przodem do ciebie lewo–prawo i przód–tył są odwrócone. Sztuczka: wychylaj drążek w stronę, w którą dron „ucieka" — jakbyś go podpierał.');
    return this.baseResult(ctx, score, m, tips);
  }
}

// =====================================================================================
// 3. KWADRAT — przeloty między punktami
// =====================================================================================
export class DrillSquare extends Drill {
  static id = 'square';
  static title = 'Kwadrat';
  static skill = 'pos';
  static goal = 'Leć nad wskazane lądowisko, zatrzymaj się w strefie i poczekaj, aż się zaliczy. Nie obracaj drona.';
  static why = 'Prawy drążek przesuwa drona: przód–tył i lewo–prawo. Tu uczysz się hamować na czas.';
  static levels = [
    { mode: 'gps', r: 1.3, hold: 1.2, n: 5, random: false, par: 7, limit: 80 },
    { mode: 'alt', r: 1.3, hold: 1.5, n: 6, random: true, par: 8, limit: 95 },
    { mode: 'angle', r: 1.3, hold: 1.5, n: 6, random: true, par: 8.5, limit: 100, assist: 1.6, ease: 1.6 },
    { mode: 'angle', r: 1.25, hold: 1.5, n: 6, random: true, par: 8.5, limit: 110, ease: 1.4 },
    { mode: 'angle', r: 1.1, hold: 1.5, n: 6, random: true, wind: 2, gust: 0.6, par: 9.5, limit: 110 },
  ];
  start() {
    return { pos: { x: 0, y: 0, z: -13 }, heading: 0, airborne: false };
  }
  setup(ctx) {
    windFor(ctx, this.cfg);
    const c = { x: 0, z: -13 },
      a = 5.5;
    this.pts = [
      { x: c.x - a, z: c.z - a, n: 'A' },
      { x: c.x + a, z: c.z - a, n: 'B' },
      { x: c.x + a, z: c.z + a, n: 'C' },
      { x: c.x - a, z: c.z + a, n: 'D' },
      { x: c.x, z: c.z, n: 'S' },
    ];
    for (const p of this.pts) ctx.world.addPad(p.x, p.z, 0.95, p.n);
    const order = [];
    if (!this.cfg.random) order.push(0, 1, 2, 3, 4);
    else {
      let last = 4;
      while (order.length < this.cfg.n) {
        const k = Math.floor(Math.random() * 5);
        if (k !== last) {
          order.push(k);
          last = k;
        }
      }
    }
    this.order = order.slice(0, this.cfg.n);
    this.i = 0;
    this.holdT = 0;
    this.overshoots = 0;
    this._entered = false;
    this.ideal = 0;
    let prev = this.pts[4];
    for (const k of this.order) {
      this.ideal += Math.hypot(this.pts[k].x - prev.x, this.pts[k].z - prev.z);
      prev = this.pts[k];
    }
    this._zone(ctx);
  }
  _zone(ctx) {
    if (this.zone) ctx.world.drillGroup.remove(this.zone);
    const p = this.pts[this.order[this.i]];
    this.zone = ctx.world.addZone(p.x, p.z, this.cfg.r, 1.2, 4.2);
    this._entered = false;
  }
  update(dt, ctx) {
    const s = ctx.sim,
      c = this.cfg;
    const p = this.pts[this.order[this.i]];
    const dh = Math.hypot(s.p.x - p.x, s.p.z - p.z);
    const inside = dh <= c.r && s.altitude >= 1.2 && s.altitude <= 4.2;
    if (inside) this._entered = true;
    else if (this._entered && this.holdT > 0.05) {
      this.overshoots++;
      this._entered = false;
    }
    this.holdT = inside ? this.holdT + dt : 0;
    ctx.world.setZoneColor(this.zone, inside ? 0x3ddc84 : 0xffb020, inside ? 0.28 : 0.14);
    ctx.hud.objective(`Leć nad lądowisko ${p.n} i zatrzymaj się (${this.i + 1}/${this.order.length})`);
    ctx.hud.progress(this.holdT / c.hold);
    ctx.hud.marker(V(p.x, 2.6, p.z), p.n);
    ctx.hud.sub(s.landed ? 'Wystartuj i wznieś się na 2–3 m' : s.altitude < 1.2 ? 'Wyżej' : s.altitude > 4.2 ? 'Niżej' : '');
    if (this.holdT >= c.hold) {
      this.i++;
      this.holdT = 0;
      ctx.hud.flash(`${p.n} zaliczone`, 'ok');
      if (this.i >= this.order.length) this.finish(true);
      else this._zone(ctx);
    }
  }
  respawn() {
    const p = this.pts[this.i > 0 ? this.order[this.i - 1] : 4];
    return { pos: { x: p.x, y: 0, z: p.z }, heading: 0, airborne: false };
  }
  result(ctx) {
    const c = this.cfg,
      N = this.order.length;
    const par = (c.par * N + 6) * this.ease;
    const frac = this.i / N;
    let score = this.completed ? 100 - clamp01((this.t - par) / par) * 45 - this.overshoots * 3.5 : 55 * frac;
    const sum = ctx.telemetry.summary();
    const eff = this.completed && sum.path > 0 ? clamp01(this.ideal / sum.path) : 0;
    const m = [
      { label: 'Czas', value: `${fmt(this.t)} s`, good: clamp01(1 - (this.t - par) / par) },
      { label: 'Przestrzelone strefy', value: String(this.overshoots), good: clamp01(1 - this.overshoots / 5) },
      { label: 'Ekonomia toru lotu', value: `${Math.round(eff * 100)}%`, good: eff },
    ];
    const tips = [];
    if (this.overshoots >= 2 && c.mode !== 'gps') tips.push('W tym trybie dron nie hamuje sam. Puść drążek wcześniej i skontruj krótkim wychyleniem w przeciwną stronę.');
    return this.baseResult(ctx, score, m, tips);
  }
}

// =====================================================================================
// 4. ORIENTACJA — odwrócone sterowanie, gdy dron jest zwrócony do pilota
// =====================================================================================
export class DrillOrientation extends Drill {
  static id = 'orient';
  static title = 'Orientacja';
  static skill = 'orient';
  static goal = 'Dron za każdym razem jest obrócony inaczej. Doleć nad wskazane lądowisko — liczy się dobry pierwszy ruch.';
  static why = 'Najczęstsza przyczyna kraks początkujących: dron leci „na ciebie" i lewo z prawym zamieniają się miejscami.';
  static usesYaw = false;
  static levels = [
    { mode: 'gps', heads: [180], n: 6, arrow: true, limit: 90 },
    { mode: 'gps', heads: [0, 180, 180], n: 8, arrow: true, limit: 100 },
    { mode: 'gps', heads: [90, -90, 180, 180], n: 8, arrow: false, limit: 100 },
    { mode: 'gps', heads: [45, -45, 135, -135, 90, -90, 180], n: 10, arrow: false, limit: 120 },
    { mode: 'alt', heads: [90, -90, 180, 135, -135], n: 8, arrow: false, limit: 120 },
  ];
  start() {
    return { pos: { x: 0, y: 2.6, z: -11 }, heading: 0, airborne: true };
  }
  setup(ctx) {
    windFor(ctx, this.cfg);
    this.c = { x: 0, z: -11 };
    const d = 6;
    this.pads = [
      { x: -d, z: -11, n: 'L', name: 'LEWE' },
      { x: d, z: -11, n: 'P', name: 'PRAWE' },
      { x: 0, z: -11 - d, n: 'D', name: 'DALSZE' },
      { x: 0, z: -11 + d, n: 'B', name: 'BLIŻSZE' },
    ];
    for (const p of this.pads) ctx.world.addPad(p.x, p.z, 1.0, p.n);
    if (this.cfg.arrow) this.arrow = ctx.world.addGroundArrow(0xffffff);
    this.trial = 0;
    this.good = 0;
    this.times = [];
    this.reacts = [];
    this.errs = [];
    this.phase = 'reset';
    this.phaseT = 0;
    this._lastPad = -1;
  }
  _newTrial(ctx) {
    const c = this.cfg;
    let k;
    do k = Math.floor(Math.random() * 4);
    while (k === this._lastPad);
    this._lastPad = k;
    this.target = this.pads[k];
    const h = c.heads[Math.floor(Math.random() * c.heads.length)] * DEG;
    ctx.respawnTo({ pos: { x: this.c.x, y: 2.6, z: this.c.z }, heading: h, airborne: true });
    if (this.zone) ctx.world.drillGroup.remove(this.zone);
    this.zone = ctx.world.addZone(this.target.x, this.target.z, 1.6, 0.8, 5);
    this.phase = 'ready';
    this.phaseT = 0;
    this.moveStart = null;
    this.judged = false;
  }
  update(dt, ctx) {
    const s = ctx.sim,
      st = ctx.sticks;
    this.phaseT += dt;
    if (this.arrow) {
      this.arrow.position.set(s.p.x, 0.05, s.p.z);
      this.arrow.rotation.y = s.heading;
    }
    if (this.phase === 'reset') {
      ctx.hud.objective('Przygotuj się…');
      ctx.hud.progress(null);
      if (this.phaseT > 0.5) this._newTrial(ctx);
      return;
    }
    const neutral = Math.abs(st.pitch) < 0.15 && Math.abs(st.roll) < 0.15;
    if (this.phase === 'ready') {
      ctx.hud.objective(`Puść drążek… (${this.trial + 1}/${this.cfg.n})`);
      ctx.freeze = true;
      if (neutral && this.phaseT > 0.7) {
        this.phase = 'go';
        this.phaseT = 0;
        ctx.freeze = false;
        ctx.hud.flash(`Leć na ${this.target.name}!`, 'go');
      }
      return;
    }
    // faza „go"
    ctx.hud.objective(`Leć nad ${this.target.name} lądowisko (${this.trial + 1}/${this.cfg.n})`);
    ctx.hud.marker(V(this.target.x, 2.6, this.target.z), this.target.n);
    ctx.hud.progress(null);
    if (!this.moveStart && !neutral) {
      this.moveStart = { t: this.phaseT, x: s.p.x, z: s.p.z };
      this.reacts.push(this.phaseT);
    }
    if (this.moveStart && !this.judged) {
      const mx = s.p.x - this.moveStart.x,
        mz = s.p.z - this.moveStart.z;
      const moved = Math.hypot(mx, mz);
      if (moved > 0.7 || this.phaseT - this.moveStart.t > 1.2) {
        const tx = this.target.x - this.moveStart.x,
          tz = this.target.z - this.moveStart.z;
        const cos = (mx * tx + mz * tz) / ((moved || 1e-6) * Math.hypot(tx, tz));
        const err = Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
        this.errs.push(err);
        this.judged = true;
        if (err <= 45) {
          this.good++;
          ctx.hud.sub('Dobry pierwszy ruch');
        } else {
          ctx.hud.sub('Pierwszy ruch w złą stronę');
          ctx.hud.flash('Zły kierunek!', 'bad');
        }
      }
    }
    const dh = Math.hypot(s.p.x - this.target.x, s.p.z - this.target.z);
    if (dh < 1.6 || this.phaseT > 14) {
      this.times.push(Math.min(this.phaseT, 14));
      if (!this.judged) this.errs.push(180);
      this.trial++;
      ctx.hud.sub('');
      if (this.trial >= this.cfg.n) this.finish(true);
      else {
        this.phase = 'reset';
        this.phaseT = 0;
      }
    }
  }
  respawn() {
    return { pos: { x: this.c.x, y: 2.6, z: this.c.z }, heading: 0, airborne: true };
  }
  onCrash(ctx) {
    super.onCrash(ctx);
    this.phase = 'reset';
    this.phaseT = 0;
  }
  result(ctx) {
    const n = Math.max(1, this.trial);
    const avg = this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 14;
    const react = this.reacts.length ? this.reacts.reduce((a, b) => a + b, 0) / this.reacts.length : 0;
    const acc = this.good / n;
    const speed = clamp01(1 - (avg - 3.2) / 6);
    let score = this.completed ? 100 * (0.65 * acc + 0.35 * speed) : 40 * acc * (this.trial / this.cfg.n);
    const m = [
      { label: 'Dobry pierwszy ruch', value: `${this.good}/${n}`, good: acc },
      { label: 'Średni czas dolotu', value: `${fmt(avg)} s`, good: speed },
      { label: 'Średni czas reakcji', value: `${fmt(react, 2)} s`, good: clamp01(1 - (react - 0.5) / 2) },
    ];
    const tips = [];
    if (acc < 0.75) tips.push('Zanim ruszysz, znajdź przód drona (pomarańczowe pierścienie, białe światła) i „wejdź" w niego wyobraźnią. Lepiej sekundę pomyśleć niż ruszyć w złą stronę.');
    else if (react > 1.6) tips.push('Kierunki masz opanowane — teraz skracaj czas namysłu. Z czasem mapowanie stanie się automatyczne.');
    return this.baseResult(ctx, score, m, tips);
  }
}

// =====================================================================================
// 5. ÓSEMKA — lot skoordynowany
// =====================================================================================
export class DrillEight extends Drill {
  static id = 'eight';
  static title = 'Ósemka';
  static skill = 'coord';
  static usesYaw = true;
  static goal = 'Obleć oba pachołki po ósemce, zaliczając pomarańczowe punkty. Leć nosem do przodu — zakręt prowadź obrotem i przechyłem naraz.';
  static why = 'Klasyczne ćwiczenie egzaminacyjne: wymaga jednoczesnej pracy obu drążków i ciągłej zmiany orientacji.';
  static levels = [
    { mode: 'gps', laps: 1, r: 2.7, par: 50, slipW: 0.15, limit: 110 },
    { mode: 'alt', laps: 1, r: 2.5, par: 46, slipW: 0.25, limit: 110 },
    { mode: 'angle', laps: 2, r: 2.4, par: 84, slipW: 0.3, limit: 150, assist: 1.6, ease: 1.6 },
    { mode: 'angle', laps: 2, r: 2.3, par: 84, slipW: 0.3, limit: 160, ease: 1.4 },
    { mode: 'angle', laps: 2, r: 2.1, par: 88, slipW: 0.3, wind: 2, gust: 0.7, limit: 160 },
    { mode: 'acro', laps: 2, r: 2.6, par: 90, slipW: 0.3, limit: 170 },
  ];
  start() {
    return { pos: { x: 0, y: 0, z: -15 }, heading: 0, airborne: false };
  }
  setup(ctx) {
    windFor(ctx, this.cfg);
    const cz = -15,
      px = 7.5;
    this.pylons = [ctx.world.addPylon(-px, cz, 4.2), ctx.world.addPylon(px, cz, 4.2, 0x2f7de1)];
    ctx.world.addPad(0, cz, 0.9, 'S');
    const y = 2.6;
    const lap = [
      [-px, cz - 4.8],
      [-px - 4.8, cz],
      [-px, cz + 4.8],
      [0, cz],
      [px, cz - 4.8],
      [px + 4.8, cz],
      [px, cz + 4.8],
      [0, cz],
    ];
    this.cps = [];
    for (let l = 0; l < this.cfg.laps; l++) for (const [x, z] of lap) this.cps.push(V(x, y, z));
    this.i = 0;
    this.cp = null;
    this.slipSum = 0;
    this.slipN = 0;
    this.altOut = 0;
    this.flyT = 0;
    this._nextCp(ctx);
  }
  _nextCp(ctx) {
    if (this.cp) ctx.world.drillGroup.remove(this.cp);
    const p = this.cps[this.i];
    this.cp = ctx.world.addCheckpoint(p.x, p.y, p.z, this.cfg.r);
  }
  update(dt, ctx) {
    const s = ctx.sim;
    const p = this.cps[this.i];
    ctx.hud.objective(`Ósemka — punkt ${this.i + 1}/${this.cps.length}`);
    ctx.hud.progress(this.i / this.cps.length);
    ctx.hud.marker(p, String(this.i + 1));
    if (!s.landed) {
      this.flyT += dt;
      if (s.altitude < 1.3 || s.altitude > 4.5) {
        this.altOut += dt;
        ctx.hud.sub(s.altitude < 1.3 ? 'Za nisko (trzymaj 2–4 m)' : 'Za wysoko (trzymaj 2–4 m)');
      } else ctx.hud.sub('');
      if (s.hSpeed > 1.5) {
        const vh = Math.atan2(-s.v.x, -s.v.z);
        let d = Math.abs(vh - s.heading) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        this.slipSum += d / DEG;
        this.slipN++;
      }
    } else ctx.hud.sub('Wystartuj i wznieś się na 2–3 m');
    // kolizja z pachołkami
    for (const py of this.pylons) {
      const d = Math.hypot(s.p.x - py.position.x, s.p.z - py.position.z);
      if (d < py.userData.r + 0.18 && s.p.y < py.userData.h) s.crash('Uderzenie w pachołek');
    }
    const d2 = (s.p.x - p.x) ** 2 + (s.p.y - p.y) ** 2 + (s.p.z - p.z) ** 2;
    if (d2 < this.cfg.r * this.cfg.r) {
      this.i++;
      ctx.buzz(8);
      if (this.i >= this.cps.length) this.finish(true);
      else this._nextCp(ctx);
    }
  }
  respawn() {
    const p = this.i > 0 ? this.cps[this.i - 1] : V(0, 0, -15);
    const n = this.cps[this.i];
    return { pos: { x: p.x, y: this.i > 0 ? 2.6 : 0, z: p.z }, heading: Math.atan2(-(n.x - p.x), -(n.z - p.z)), airborne: this.i > 0 };
  }
  result(ctx) {
    const c = this.cfg;
    const frac = this.i / this.cps.length;
    const slip = this.slipN ? this.slipSum / this.slipN : 90;
    const slipQ = clamp01(1 - (slip - 12) / 50);
    const altQ = clamp01(1 - (this.altOut / Math.max(this.flyT, 1)) * 2.5);
    const timeQ = clamp01(1 - (this.t - c.par * this.ease) / (c.par * this.ease));
    let score = this.completed ? 100 * ((1 - c.slipW - 0.15) * (0.45 + 0.55 * timeQ) + c.slipW * slipQ + 0.15 * altQ) : 50 * frac;
    const m = [
      { label: 'Czas', value: `${fmt(this.t)} s`, good: timeQ },
      { label: 'Lot bokiem (średni kąt znoszenia)', value: `${Math.round(slip)}°`, good: slipQ },
      { label: 'Wysokość w normie 2–4 m', value: `${Math.round(altQ * 100)}%`, good: altQ },
    ];
    const tips = [];
    if (slip > 35) tips.push('Latasz „bokiem" — samym prawym drążkiem. W ósemce nos ma wskazywać kierunek lotu: lekko naprzód, a zakręt prowadź lewym drążkiem (obrót) z odrobiną przechyłu w tę samą stronę.');
    return this.baseResult(ctx, score, m, tips);
  }
}

// =====================================================================================
// 6. BRAMKI FPV
// =====================================================================================
export class DrillGates extends Drill {
  static id = 'gates';
  static title = 'Bramki FPV';
  static skill = 'fpv';
  static view = 'fpv';
  static usesYaw = true;
  static goal = 'Widok z kamery drona. Przeleć po kolei przez wszystkie bramki — pomarańczowa jest następna.';
  static why = 'W FPV nie widzisz drona, tylko to, co on. Uczysz się oceniać odległość, prędkość i tor lotu z perspektywy kamery.';
  static levels = [
    { mode: 'alt', gates: 6, inner: 3.8, turn: 18, dy: 0, tilt: 8, pace: 2.8, limit: 90 },
    { mode: 'alt', gates: 8, inner: 3.4, turn: 32, dy: 0.9, tilt: 8, pace: 3.1, limit: 110 },
    { mode: 'angle', gates: 8, inner: 3.6, turn: 30, dy: 0.7, tilt: 12, pace: 3.4, limit: 120, assist: 1.6, ease: 1.6 },
    { mode: 'angle', gates: 10, inner: 3.0, turn: 42, dy: 1.0, tilt: 15, pace: 4.0, limit: 130 },
    { mode: 'acro', gates: 8, inner: 3.8, turn: 28, dy: 0.6, tilt: 20, pace: 3.4, limit: 140 },
  ];
  start() {
    return { pos: { x: 0, y: 2.2, z: -5 }, heading: 0, airborne: true };
  }
  setup(ctx) {
    windFor(ctx, this.cfg);
    const c = this.cfg;
    ctx.world.uptilt = c.tilt * DEG;
    this.variant = ctx.variant % 5;
    const rand = rng(1000 * this.level + 17 * this.variant + 5);
    let x = 0,
      z = -5,
      h = 0,
      y = 2.2;
    this.gates = [];
    this.length = 0;
    for (let i = 0; i < c.gates; i++) {
      const d = 12 + rand() * 4;
      let dh = (rand() * 2 - 1) * c.turn * DEG;
      // trzymamy trasę na płycie treningowej: zawracaj ku osi pola
      const cx = x - Math.sin(h + dh) * d,
        cz = z - Math.cos(h + dh) * d;
      if (Math.abs(cx) > 30 || cz < -68 || cz > 2) dh = -Math.sign(x || 1) * Math.abs(dh) * (cz < -68 ? 2.2 : 1);
      h += dh;
      x -= Math.sin(h) * d;
      z -= Math.cos(h) * d;
      y = Math.max(1.9, Math.min(4.2, y + (rand() * 2 - 1) * c.dy));
      const g = ctx.world.addGate(x, y, z, h, c.inner, i + 1);
      this.gates.push({ g, x, y, z, h });
      this.length += d;
    }
    this.i = 0;
    this.misses = 0;
    ctx.world.setGateState(this.gates[0].g, 'next');
    this._prev = null;
  }
  update(dt, ctx) {
    const s = ctx.sim,
      c = this.cfg;
    const G = this.gates[this.i];
    ctx.hud.objective(`Bramka ${this.i + 1}/${this.gates.length}`);
    ctx.hud.progress(this.i / this.gates.length);
    ctx.hud.marker(V(G.x, G.y, G.z), String(this.i + 1));
    const fx = -Math.sin(G.h),
      fz = -Math.cos(G.h);
    const rx = Math.cos(G.h),
      rz = -Math.sin(G.h);
    const loc = (p) => {
      const dx = p.x - G.x,
        dz = p.z - G.z;
      return { f: dx * fx + dz * fz, r: dx * rx + dz * rz, u: p.y - G.y };
    };
    const cur = loc(s.p);
    if (this._prev && this._prevGate === this.i && this._prev.f < 0 && cur.f >= 0) {
      const k = this._prev.f / (this._prev.f - cur.f);
      const r = this._prev.r + (cur.r - this._prev.r) * k,
        u = this._prev.u + (cur.u - this._prev.u) * k;
      const half = c.inner / 2;
      const m = Math.max(Math.abs(r), Math.abs(u));
      if (m < half - 0.14) {
        ctx.world.setGateState(G.g, 'done');
        this.i++;
        ctx.buzz(10);
        ctx.hud.sub('');
        if (this.i >= this.gates.length) this.finish(true);
        else ctx.world.setGateState(this.gates[this.i].g, 'next');
      } else if (m < half + 0.4) {
        s.crash('Uderzenie w ramę bramki');
      } else {
        this.misses++;
        ctx.hud.flash('Ominięta bramka — zawróć', 'bad');
      }
    }
    this._prev = cur;
    this._prevGate = this.i;
  }
  respawn() {
    const G = this.gates[Math.min(this.i, this.gates.length - 1)];
    const back = 6.5;
    return { pos: { x: G.x + Math.sin(G.h) * back, y: G.y, z: G.z + Math.cos(G.h) * back }, heading: G.h, airborne: true };
  }
  onCrash(ctx) {
    this.crashes++;
    this.penalty += Math.round(this.crashCost * 0.67);
    this._prev = null;
  }
  result(ctx) {
    const c = this.cfg;
    const frac = this.i / this.gates.length;
    const par = (this.length / c.pace + 4) * this.ease; // tempo odniesienia rośnie z poziomem (do kalibracji na testach z ludźmi)
    const timeQ = clamp01(1 - (this.t - par) / par);
    let score = this.completed ? 100 * (0.5 + 0.5 * timeQ) - this.misses * 4 : 55 * frac;
    const m = [
      { label: 'Bramki', value: `${this.i}/${this.gates.length}`, good: frac },
      { label: 'Czas', value: `${fmt(this.t)} s`, good: timeQ },
      { label: 'Ominięte bramki', value: String(this.misses), good: clamp01(1 - this.misses / 3) },
    ];
    const tips = [];
    if (this.crashes >= 2) tips.push('Celuj w środek bramki z daleka i ustaw się na wprost niej PRZED dolotem. Korekty w ostatniej chwili kończą się na ramie.');
    if (c.mode !== 'alt' && this.crashes >= 1) tips.push('W tym trybie gaz jest ręczny: w zakręcie i przy pochyleniu do przodu dron traci wysokość — dodaj odrobinę gazu.');
    return this.baseResult(ctx, score, m, tips);
  }
}

// =====================================================================================
// 7. ORBITA — prowadzenie kadru
// =====================================================================================
export class DrillOrbit extends Drill {
  static id = 'orbit';
  static title = 'Orbita';
  static skill = 'cam';
  static view = 'cam';
  static drone = 'camera';
  static usesYaw = true;
  static goal = 'Okrąż komin, trzymając go cały czas w środku kadru. Prawy drążek w bok, lewy w przeciwną stronę.';
  static why = 'Najważniejsze ujęcie filmowe i inspekcyjne. Wymaga idealnie zgranych rąk: przesuw w bok i obrót jednocześnie.';
  static levels = [
    { mode: 'gps', tol: 13, turns: 1, par: 48, limit: 110 },
    { mode: 'gps', tol: 9, turns: 1, par: 44, wind: 2.5, limit: 110 },
    { mode: 'gps', tol: 7, turns: 1.5, par: 62, band: true, limit: 140 },
    { mode: 'alt', tol: 11, turns: 1, par: 55, limit: 140 },
  ];
  start() {
    return { pos: { x: 0, y: 7, z: -16 }, heading: 0, airborne: true };
  }
  setup(ctx) {
    windFor(ctx, this.cfg);
    this.poi = V(0, 7, -32);
    this.tower = ctx.world.addTower(this.poi.x, this.poi.z, 14);
    this.acc = 0;
    this.lastAng = null;
    this.errSq = 0;
    this.n = 0;
    this.okT = 0;
    this.rSum = 0;
    this.rSq = 0;
    ctx.hud.frameBand(this.cfg.tol, false);
  }
  update(dt, ctx) {
    const s = ctx.sim,
      c = this.cfg;
    const dx = this.poi.x - s.p.x,
      dz = this.poi.z - s.p.z;
    const dist = Math.hypot(dx, dz);
    const bearing = Math.atan2(-dx, -dz);
    let off = bearing - s.heading;
    while (off > Math.PI) off -= 2 * Math.PI;
    while (off < -Math.PI) off += 2 * Math.PI;
    const offDeg = off / DEG;
    const rOK = dist > 8 && dist < 24;
    const altOK = !c.band || Math.abs(s.p.y - 7) < 1.6;
    const ok = Math.abs(offDeg) <= c.tol && rOK && altOK;
    const ang = Math.atan2(s.p.x - this.poi.x, s.p.z - this.poi.z);
    if (this.lastAng !== null) {
      let d = ang - this.lastAng;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (ok) this.acc += d;
    }
    this.lastAng = ang;
    this.errSq += offDeg * offDeg;
    this.n++;
    this.rSum += dist;
    this.rSq += dist * dist;
    if (ok) this.okT += dt;
    const need = c.turns * 2 * Math.PI;
    const prog = Math.abs(this.acc) / need;
    ctx.hud.frameBand(c.tol, ok);
    ctx.hud.objective(`Okrążaj komin, trzymając go w kadrze — ${Math.round(clamp01(prog) * 100)}%`);
    ctx.hud.progress(prog);
    ctx.hud.sub(!rOK ? (dist <= 8 ? 'Za blisko komina' : 'Za daleko od komina') : !altOK ? 'Trzymaj wysokość startową' : Math.abs(offDeg) > c.tol ? 'Komin ucieka z kadru — obróć drona' : '');
    if (dist < this.tower.userData.r + 0.2 && s.p.y < this.tower.userData.h) s.crash('Uderzenie w komin');
    if (prog >= 1) this.finish(true);
  }
  result(ctx) {
    const c = this.cfg;
    const need = c.turns * 2 * Math.PI;
    const frac = clamp01(Math.abs(this.acc) / need);
    const rms = this.n ? Math.sqrt(this.errSq / this.n) : 99;
    const mean = this.n ? this.rSum / this.n : 0;
    const std = this.n ? Math.sqrt(Math.max(0, this.rSq / this.n - mean * mean)) : 0;
    const frameQ = clamp01(1 - (rms - 3) / (c.tol * 1.6));
    const timeQ = clamp01(1 - (this.t - c.par * this.ease) / (c.par * this.ease));
    const rQ = clamp01(1 - (std - 0.8) / 4);
    let score = this.completed ? 100 * (0.4 * frameQ + 0.35 * (0.4 + 0.6 * timeQ) + 0.25 * rQ) : 50 * frac;
    const m = [
      { label: 'Czas', value: `${fmt(this.t)} s`, good: timeQ },
      { label: 'Błąd kadrowania (RMS)', value: `${fmt(rms)}°`, good: frameQ },
      { label: 'Stałość promienia (odchylenie)', value: `${fmt(std)} m`, good: rQ },
    ];
    const tips = [];
    if (frameQ < 0.5) tips.push('Zacznij od samego przesuwu w bok (prawy drążek), a gdy komin zacznie wyjeżdżać z kadru, „doganiaj" go obrotem w przeciwną stronę. Szukaj stałego, małego wychylenia obu drążków.');
    if (rQ < 0.5) tips.push('Promień się zmienia: za dużo obrotu względem przesuwu zbliża cię do komina, za mało — oddala. Koryguj odrobiną przód/tył.');
    return this.baseResult(ctx, score, m, tips);
  }
}

// =====================================================================================
// 8. LĄDOWANIE NA PUNKT
// =====================================================================================
export class DrillLanding extends Drill {
  static id = 'landing';
  static title = 'Lądowanie na punkt';
  static skill = 'pos';
  static goal = 'Wyląduj możliwie blisko środka każdego z trzech lądowisk. Po każdym lądowaniu wystartuj do następnego.';
  static why = 'Z ziemi trudno ocenić, czy dron jest już NAD punktem. Uczysz się czytać cień, perspektywę i wysokość.';
  static levels = [
    { mode: 'gps', pads: [[-4, -9], [5, -14], [0, -8]], limit: 100, par: 60 },
    { mode: 'alt', pads: [[5, -10], [-6, -16], [0, -22]], wind: 1.5, limit: 120, par: 70 },
    { mode: 'angle', pads: [[-5, -10], [6, -15], [0, -9]], limit: 120, par: 70, assist: 1.6, ease: 1.6 },
    { mode: 'angle', pads: [[5, -11], [-6, -16], [0, -10]], limit: 130, par: 72, ease: 1.4 },
    { mode: 'angle', pads: [[6, -12], [-8, -20], [2, -28]], wind: 2.2, gust: 0.7, limit: 140, par: 85 },
  ];
  start() {
    return { pos: { x: 0, y: 0, z: -5 }, heading: 0, airborne: false };
  }
  setup(ctx) {
    windFor(ctx, this.cfg);
    ctx.world.addPad(0, -5, 0.8, 'S');
    this.pads = this.cfg.pads.map(([x, z], i) => {
      ctx.world.addPad(x, z, 1.0, String(i + 1));
      return { x, z };
    });
    this.i = 0;
    this.res = [];
    this.needAir = true;
    this.wasHigh = false;
  }
  update(dt, ctx) {
    const s = ctx.sim;
    const p = this.pads[this.i];
    ctx.hud.objective(`Wyląduj na lądowisku ${this.i + 1} (${this.i + 1}/${this.pads.length})`);
    ctx.hud.progress(this.i / this.pads.length);
    ctx.hud.marker(V(p.x, 0.2, p.z), String(this.i + 1));
    if (s.altitude > 1.2) this.wasHigh = true;
    ctx.hud.sub(!this.wasHigh ? 'Wystartuj na co najmniej 1,5 m' : '');
    if (s.landed && this.wasHigh) {
      const d = Math.hypot(s.p.x - p.x, s.p.z - p.z);
      if (d < 2.2) {
        this.res.push({ d, v: s.touchdownSpeed || 0 });
        ctx.hud.flash(`${fmt(d, 2)} m od środka`, d < 0.5 ? 'ok' : 'info');
        this.i++;
        this.wasHigh = false;
        if (this.i >= this.pads.length) this.finish(true);
      } else {
        ctx.hud.flash('To nie to lądowisko — wystartuj ponownie', 'bad');
        this.wasHigh = false;
      }
    }
  }
  respawn() {
    const p = this.i > 0 ? this.pads[this.i - 1] : { x: 0, z: -5 };
    return { pos: { x: p.x, y: 0, z: p.z }, heading: 0, airborne: false };
  }
  result(ctx) {
    const c = this.cfg;
    const n = this.res.length;
    const avgD = n ? this.res.reduce((a, r) => a + r.d, 0) / n : 9;
    const avgV = n ? this.res.reduce((a, r) => a + r.v, 0) / n : 9;
    const precQ = clamp01(1 - (avgD - 0.15) / 1.3);
    const softQ = clamp01(1 - (avgV - 0.7) / 1.5);
    const timeQ = clamp01(1 - (this.t - c.par * this.ease) / (c.par * this.ease));
    let score = this.completed ? 100 * (0.6 * precQ + 0.2 * softQ + 0.2 * (0.4 + 0.6 * timeQ)) : 45 * (n / this.pads.length) * precQ;
    const m = [
      { label: 'Średnia odległość od środka', value: `${fmt(avgD, 2)} m`, good: precQ },
      { label: 'Średnia prędkość przyziemienia', value: `${fmt(avgV, 2)} m/s`, good: softQ },
      { label: 'Czas', value: `${fmt(this.t)} s`, good: timeQ },
    ];
    const tips = [];
    if (precQ < 0.6) tips.push('Patrz na cień drona, nie na drona. Gdy cień leży na środku lądowiska, dron jest nad nim — wtedy schodź pionowo.');
    return this.baseResult(ctx, score, m, tips);
  }
}

export const DRILLS = [DrillAltitude, DrillHover, DrillSquare, DrillLanding, DrillOrientation, DrillEight, DrillGates, DrillOrbit];
export const drillById = (id) => DRILLS.find((d) => d.id === id);
export { PILOT };
