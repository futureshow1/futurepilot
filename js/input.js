// FuturePilot — wejście: drążki dotykowe, gamepad / aparatura RC (Gamepad API), klawiatura.
// Wynik: surowe pozycje drążków -1..1 w konwencji physics.js + informacja o źródle sterowania.

import { clamp } from './physics.js';

// Tryby aparatury: która fizyczna oś (LX, LY, RX, RY) steruje którą funkcją
export const STICK_MODES = {
  2: { LX: 'yaw', LY: 'throttle', RX: 'roll', RY: 'pitch', label: 'Mode 2 (gaz po lewej) — standard' },
  1: { LX: 'yaw', LY: 'pitch', RX: 'roll', RY: 'throttle', label: 'Mode 1 (gaz po prawej)' },
  3: { LX: 'roll', LY: 'pitch', RX: 'yaw', RY: 'throttle', label: 'Mode 3' },
  4: { LX: 'roll', LY: 'throttle', RX: 'yaw', RY: 'pitch', label: 'Mode 4' },
};

const GP_STORE = 'futurepilot.gamepads';

export class Input {
  constructor({ layer, stickL, stickR, monitor }) {
    this.layer = layer;
    this.el = { L: stickL, R: stickR };
    this.monitor = monitor;
    this.stickMode = 2;
    this.sizeScale = 1; // ustawienie „rozmiar drążków"
    this.centeringThrottle = true;
    this.enabled = false;
    this.source = 'touch';
    this.sourcesUsed = new Set();
    this.injected = null;

    this.axes = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.holdThrottle = -1; // zapamiętana pozycja gazu bez sprężyny
    this.sticks = {
      L: { active: false, id: null, bx: 0, by: 0, x: 0, y: 0 },
      R: { active: false, id: null, bx: 0, by: 0, x: 0, y: 0 },
    };
    this.keys = new Set();
    this.kb = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.gpMaps = {};
    try {
      this.gpMaps = JSON.parse(localStorage.getItem(GP_STORE) || '{}');
    } catch (e) {
      this.gpMaps = {};
    }
    this.gamepadInfo = null;
    this._lastGpActivity = 0;
    this._lastTouchActivity = 0;
    this._lastKeyActivity = 0;

    this._bind();
    this._layoutIdle();
    window.addEventListener('resize', () => this._layoutIdle());
  }

  get R() {
    // promień wychylenia w px CSS — dobrany do zasięgu kciuka (ok. 11–14 mm)
    const h = Math.min(window.innerHeight, window.innerWidth);
    return clamp(h * 0.19, 46, 92) * this.sizeScale;
  }

  _throttleAxis() {
    const m = STICK_MODES[this.stickMode];
    return m.LY === 'throttle' ? 'L' : 'R';
  }

  setEnabled(on) {
    this.enabled = on;
    this.layer.classList.toggle('on', on);
    if (!on) {
      for (const k of ['L', 'R']) this._release(k);
    }
  }

  // tryby ze sprężyną na gazie (GPS/STABILNY) vs gaz „zostaje, gdzie go zostawisz" (ANGLE/ACRO)
  setThrottleCentering(on) {
    this.centeringThrottle = on;
    this.holdThrottle = -1;
    this.kb.throttle = on ? 0 : -1;
    this._layoutIdle();
  }

  resetThrottle() {
    this.setHoldThrottle(-1);
  }

  // start w powietrzu w trybach ręcznych: gaz ustawiony na zawis (0 = połowa), inaczej dron od razu by spadł
  setHoldThrottle(v) {
    this.holdThrottle = this.centeringThrottle ? -1 : v;
    this.kb.throttle = this.centeringThrottle ? 0 : v;
    for (const side of ['L', 'R']) {
      const s = this.sticks[side];
      if (s.active && !this.centeringThrottle && side === this._throttleAxis()) {
        // palec już leży na drążku: przesuwamy bazę tak, by gałka pod palcem oznaczała nową wartość
        s.by += (v - s.y) * this.R;
        s.y = v;
        this._draw(side);
      }
    }
    this._layoutIdle();
  }

  _bind() {
    const L = this.layer;
    const opts = { passive: false };
    L.addEventListener('pointerdown', (e) => this._down(e), opts);
    L.addEventListener('pointermove', (e) => this._move(e), opts);
    const up = (e) => this._up(e);
    L.addEventListener('pointerup', up, opts);
    L.addEventListener('pointercancel', up, opts);
    L.addEventListener('lostpointercapture', up, opts);
    L.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS: blokada gestów przeglądarki na warstwie sterowania
    L.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    L.addEventListener('touchmove', (e) => e.preventDefault(), opts);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // pisanie w formularzu to nie sterowanie
      this.keys.add(e.code);
      this._lastKeyActivity = performance.now();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadInfo = { id: e.gamepad.id, mapping: e.gamepad.mapping, index: e.gamepad.index };
      this.onGamepadChange && this.onGamepadChange(this.gamepadInfo);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadInfo = null;
      this.onGamepadChange && this.onGamepadChange(null);
    });
  }

  _sideOf(e) {
    return e.clientX < window.innerWidth / 2 ? 'L' : 'R';
  }

  _down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const side = this._sideOf(e);
    const s = this.sticks[side];
    if (s.active) return;
    s.active = true;
    s.id = e.pointerId;
    try {
      this.layer.setPointerCapture(e.pointerId);
    } catch (err) {}
    const R = this.R;
    s.bx = e.clientX;
    s.by = e.clientY;
    s.x = 0;
    s.y = 0;
    if (!this.centeringThrottle && side === this._throttleAxis()) {
      // gaz bez sprężyny: gałka „pod palcem" w swojej zapamiętanej pozycji (sterowanie względne)
      s.y = this.holdThrottle;
      s.by = e.clientY + s.y * R;
    }
    this._lastTouchActivity = performance.now();
    this._draw(side);
  }

  _move(e) {
    if (!this.enabled) return;
    for (const side of ['L', 'R']) {
      const s = this.sticks[side];
      if (!s.active || s.id !== e.pointerId) continue;
      e.preventDefault();
      const R = this.R;
      let dx = (e.clientX - s.bx) / R;
      let dy = -(e.clientY - s.by) / R;
      // baza podąża za palcem, gdy wyjdzie poza zakres — kciuk nigdy nie „gubi" drążka
      if (dx > 1) { s.bx += (dx - 1) * R; dx = 1; }
      if (dx < -1) { s.bx += (dx + 1) * R; dx = -1; }
      if (dy > 1) { s.by -= (dy - 1) * R; dy = 1; }
      if (dy < -1) { s.by -= (dy + 1) * R; dy = -1; }
      s.x = dx;
      s.y = dy;
      if (!this.centeringThrottle && side === this._throttleAxis()) this.holdThrottle = dy;
      this._lastTouchActivity = performance.now();
      this._draw(side);
    }
  }

  _up(e) {
    for (const side of ['L', 'R']) {
      const s = this.sticks[side];
      if (s.active && s.id === e.pointerId) this._release(side);
    }
  }

  _release(side) {
    const s = this.sticks[side];
    s.active = false;
    s.id = null;
    s.x = 0;
    s.y = !this.centeringThrottle && side === this._throttleAxis() ? this.holdThrottle : 0;
    this._layoutIdle();
  }

  _layoutIdle() {
    // nieaktywne drążki: delikatna podpowiedź w dolnych rogach
    const R = this.R;
    const w = window.innerWidth,
      h = window.innerHeight;
    for (const side of ['L', 'R']) {
      const s = this.sticks[side];
      if (s.active) continue;
      s.bx = side === 'L' ? Math.max(R * 1.7, w * 0.16) : w - Math.max(R * 1.7, w * 0.16);
      s.by = h - R * 1.55;
      if (!this.centeringThrottle && side === this._throttleAxis()) s.y = this.holdThrottle;
      else s.y = 0;
      s.x = 0;
      this._draw(side);
    }
  }

  _draw(side) {
    const s = this.sticks[side];
    const el = this.el[side];
    if (!el) return;
    const R = this.R;
    el.style.setProperty('--r', R + 'px');
    el.style.transform = `translate(${s.bx}px, ${s.by}px)`;
    el.classList.toggle('active', s.active);
    const knob = el.firstElementChild;
    if (knob) knob.style.transform = `translate(${s.x * R}px, ${-s.y * R}px)`;
  }

  // ---------- gamepad / aparatura ----------
  _gamepad() {
    if (!navigator.getGamepads) return null;
    const list = navigator.getGamepads();
    for (const gp of list) if (gp && gp.connected && gp.axes && gp.axes.length >= 4) return gp;
    return null;
  }

  _mapFor(gp) {
    if (this.gpMaps[gp.id]) return this.gpMaps[gp.id];
    if (gp.mapping === 'standard') {
      return { throttle: { a: 1, inv: true }, yaw: { a: 0, inv: false }, roll: { a: 2, inv: false }, pitch: { a: 3, inv: true }, guessed: false };
    }
    // aparatura RC jako joystick USB (EdgeTX, kolejność kanałów AETR) — zgadujemy; kreator mapowania to poprawi
    return { roll: { a: 0, inv: false }, pitch: { a: 1, inv: false }, throttle: { a: 2, inv: false }, yaw: { a: 3, inv: false }, guessed: true };
  }

  saveGamepadMap(id, map) {
    this.gpMaps[id] = map;
    try {
      localStorage.setItem(GP_STORE, JSON.stringify(this.gpMaps));
    } catch (e) {}
  }

  readGamepadRaw() {
    const gp = this._gamepad();
    return gp ? { id: gp.id, mapping: gp.mapping, axes: Array.from(gp.axes) } : null;
  }

  isRadio() {
    const gp = this._gamepad();
    return !!gp && gp.mapping !== 'standard';
  }

  // ---------- klawiatura (awaryjnie, do testów na komputerze) ----------
  _keyboard(dt) {
    const k = this.keys;
    const tgt = {
      yaw: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      pitch: (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0),
      roll: (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0),
    };
    const fine = k.has('ShiftLeft') || k.has('ShiftRight') ? 0.45 : 0.85;
    const a = 1 - Math.exp(-dt / 0.09);
    for (const ax of ['yaw', 'pitch', 'roll']) this.kb[ax] += (tgt[ax] * fine - this.kb[ax]) * a;
    const th = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (this.centeringThrottle) this.kb.throttle += (th * fine - this.kb.throttle) * a;
    else this.kb.throttle = clamp(this.kb.throttle + th * dt * 0.9, -1, 1);
    return k.size > 0;
  }

  update(dt) {
    const now = performance.now();
    const out = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

    if (this.injected) {
      Object.assign(out, this.injected);
      this.source = 'auto';
    } else {
      // 1) gamepad / aparatura
      const gp = this._gamepad();
      let gpVals = null;
      if (gp) {
        const map = this._mapFor(gp);
        gpVals = {};
        for (const f of ['throttle', 'yaw', 'pitch', 'roll']) {
          const m = map[f];
          let v = gp.axes[m.a] || 0;
          if (m.inv) v = -v;
          if (gp.mapping === 'standard' && Math.abs(v) < 0.05) v = 0; // luz sprężyn w padach
          gpVals[f] = clamp(v, -1, 1);
        }
        const moved = Math.abs(gpVals.yaw) + Math.abs(gpVals.pitch) + Math.abs(gpVals.roll) > 0.12 ||
          Math.abs(gpVals.throttle - (this._gpLastThr ?? gpVals.throttle)) > 0.02;
        this._gpLastThr = gpVals.throttle;
        if (moved) this._lastGpActivity = now;
      }
      // 2) klawiatura
      const kbActive = this._keyboard(dt);
      if (kbActive) this._lastKeyActivity = now;

      // wybór źródła: ostatnio aktywne
      const tTouch = this._lastTouchActivity,
        tGp = this._lastGpActivity,
        tKey = this._lastKeyActivity;
      const latest = Math.max(tTouch, tGp, tKey);
      if (latest > 0) {
        if (latest === tGp && gpVals) this.source = this.isRadio() ? 'radio' : 'gamepad';
        else if (latest === tKey) this.source = 'keyboard';
        else this.source = 'touch';
      }

      if ((this.source === 'gamepad' || this.source === 'radio') && gpVals) {
        Object.assign(out, gpVals);
      } else if (this.source === 'keyboard') {
        Object.assign(out, this.kb);
      } else {
        const m = STICK_MODES[this.stickMode];
        const L = this.sticks.L,
          R = this.sticks.R;
        out[m.LX] = L.x;
        out[m.LY] = L.y;
        out[m.RX] = R.x;
        out[m.RY] = R.y;
        if (!this.centeringThrottle) out.throttle = this.holdThrottle;
      }
    }
    if (this.enabled) this.sourcesUsed.add(this.source);
    this.axes = out;
    this._drawMonitor(out);
    return out;
  }

  _drawMonitor(a) {
    const mon = this.monitor;
    if (!mon) return;
    const m = STICK_MODES[this.stickMode];
    const dots = this._dots || (this._dots = mon.querySelectorAll('.dot'));
    if (dots.length < 2) return;
    // pozycję kropek liczy CSS ze zmiennych --x/--y (podgląd drążków poza zasięgiem kciuków)
    dots[0].style.setProperty('--x', a[m.LX]);
    dots[0].style.setProperty('--y', a[m.LY]);
    dots[1].style.setProperty('--x', a[m.RX]);
    dots[1].style.setProperty('--y', a[m.RY]);
  }
}

// ---------- kreator mapowania osi dla aparatur RC / nietypowych padów ----------
export class GamepadWizard {
  constructor(input) {
    this.input = input;
    this.steps = [
      { f: 'throttle', text: 'Przesuń drążek GAZU do samej góry i przytrzymaj' },
      { f: 'yaw', text: 'Wychyl drążek OBROTU (yaw) maksymalnie w prawo i przytrzymaj' },
      { f: 'pitch', text: 'Wychyl drążek POCHYLENIA (pitch) maksymalnie od siebie i przytrzymaj' },
      { f: 'roll', text: 'Wychyl drążek PRZECHYŁU (roll) maksymalnie w prawo i przytrzymaj' },
    ];
    this.reset();
  }
  reset() {
    this.i = 0;
    this.map = {};
    this.base = null;
    this.holdT = 0;
    this.cand = null;
    this.done = false;
    this.waitRelease = false;
  }
  get step() {
    return this.steps[this.i];
  }
  update(dt) {
    if (this.done) return;
    const raw = this.input.readGamepadRaw();
    if (!raw) return;
    if (!this.base) {
      this.base = raw.axes.slice();
      return;
    }
    let best = -1,
      bestD = 0;
    raw.axes.forEach((v, idx) => {
      if (Object.values(this.map).some((m) => m.a === idx)) return;
      const d = v - this.base[idx];
      if (Math.abs(d) > Math.abs(bestD)) {
        bestD = d;
        best = idx;
      }
    });
    if (this.waitRelease) {
      // czekamy, aż drążki wrócą w okolice pozycji wyjściowej (gaz może zostać wysoko — to bez znaczenia)
      this.holdT += dt;
      if (this.holdT > 0.7) {
        this.waitRelease = false;
        this.base = raw.axes.slice();
        this.holdT = 0;
      }
      return;
    }
    if (best >= 0 && Math.abs(bestD) > 0.55) {
      if (this.cand && this.cand.a === best) this.holdT += dt;
      else {
        this.cand = { a: best, inv: bestD < 0 };
        this.holdT = 0;
      }
      if (this.holdT > 0.35) {
        this.map[this.step.f] = { a: this.cand.a, inv: this.cand.inv };
        this.i++;
        this.cand = null;
        this.holdT = 0;
        this.waitRelease = true;
        if (this.i >= this.steps.length) {
          this.done = true;
          this.input.saveGamepadMap(raw.id, { ...this.map, guessed: false });
        }
      }
    } else {
      this.cand = null;
      this.holdT = 0;
    }
  }
}
