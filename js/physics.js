// FuturePilot — model lotu wielowirnikowca (prototyp 0.1)
// Samodzielny moduł (bez three.js), żeby dało się go testować w Node.
//
// Układ współrzędnych: Y w górę, prawoskrętny. Przód drona = -Z, prawo = +X, góra = +Y.
// Konwencja drążków (wartości surowe -1..1):
//   throttle: +1 = drążek w górę, yaw: +1 = obrót w prawo (zgodnie z zegarem, patrząc z góry),
//   pitch: +1 = drążek do przodu (nos w dół, lot do przodu), roll: +1 = przechył w prawo.
//
// Uproszczenia (świadome): pętla prędkości kątowych jako opóźnienie I rzędu (zamiast PID + silników),
// opór liniowy (opór wirników) + kwadratowy (kadłub), brak prop-washu i efektu przyziemnego.
// To, co MUSI być wierne dla transferu umiejętności: mapowanie drążków, tryby lotu, bezwładność,
// brak samohamowania w trybach ręcznych, zależność ciągu od przechyłu.

export const G = 9.81;
const DEG = Math.PI / 180;

// ---------- matematyka ----------
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const vlen = (v) => Math.hypot(v.x, v.y, v.z);

export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export const qConj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qNorm(q) {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
export function qAxis(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(angle / 2) };
}
export function qRot(q, v) {
  // v' = q v q*
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}
function qSlerpToward(q, target, t) {
  // tania interpolacja (nlerp) — wystarcza do poziomowania na ziemi
  let d = q.x * target.x + q.y * target.y + q.z * target.z + q.w * target.w;
  const s = d < 0 ? -1 : 1;
  return qNorm({
    x: q.x + (s * target.x - q.x) * t,
    y: q.y + (s * target.y - q.y) * t,
    z: q.z + (s * target.z - q.z) * t,
    w: q.w + (s * target.w - q.w) * t,
  });
}

// ---------- krzywe drążków ----------
// Betaflight „Actual rates": center = czułość przy środku (°/s), max = prędkość przy pełnym wychyleniu (°/s)
export function actualRate(x, center, max, expo) {
  const ax = Math.abs(x);
  const expof = ax * (Math.pow(x, 5) * expo + x * (1 - expo));
  return x * center + Math.max(0, max - center) * expof; // °/s
}
const expoCurve = (x, e) => x * (1 - e) + x * x * x * e;
function deadband(x, d) {
  const a = Math.abs(x);
  if (a <= d) return 0;
  return Math.sign(x) * ((a - d) / (1 - d));
}

// ---------- presety dronów ----------
export const DRONES = {
  trainer: {
    id: 'trainer',
    label: 'Trener 3,5″ (poniżej 250 g)',
    mass: 0.249,
    twr: 3.0, // ciąg maks. / ciężar
    thrustExp: 1.585, // ciąg ~ gaz^n; dla twr=3 zawis wypada dokładnie w połowie gazu
    dragLin: 0.35, // 1/s  (opór wirników, liniowy)
    dragQuad: 0.06, // 1/m  (opór kadłuba, kwadratowy)
    tauMotor: 0.045,
    tauRate: 0.05,
    attGain: 8.5, // 1/s — sztywność pętli kąta
    maxLevelRate: 320 * DEG,
    angleMaxTilt: 35 * DEG,
    altMaxTilt: 22 * DEG,
    yawRate: 170 * DEG,
    gps: { vmax: 7.5, vUp: 3.0, vDown: 2.2, maxTilt: 28 * DEG, yawRate: 110 * DEG },
    acro: { center: 130, max: 520, expo: 0.45, yawCenter: 120, yawMax: 400 },
    hoverMinutes: 5.5,
    radius: 0.16,
  },
  camera: {
    id: 'camera',
    label: 'Dron z kamerą (klasa 249 g)',
    mass: 0.249,
    twr: 2.1,
    thrustExp: 1.07,
    dragLin: 0.3,
    dragQuad: 0.05,
    tauMotor: 0.07,
    tauRate: 0.09,
    attGain: 6.0,
    maxLevelRate: 200 * DEG,
    angleMaxTilt: 30 * DEG,
    altMaxTilt: 20 * DEG,
    yawRate: 120 * DEG,
    gps: { vmax: 7.0, vUp: 3.0, vDown: 2.5, maxTilt: 25 * DEG, yawRate: 100 * DEG },
    acro: { center: 100, max: 360, expo: 0.4, yawCenter: 90, yawMax: 300 },
    hoverMinutes: 24,
    radius: 0.16,
  },
};

export const MODES = {
  gps: { id: 'gps', label: 'GPS', long: 'dron sam trzyma pozycję i wysokość, a po puszczeniu drążków hamuje', centeringThrottle: true },
  alt: { id: 'alt', label: 'STABILNY', long: 'dron trzyma wysokość, ale nie pozycję — znosi go wiatr i własny rozpęd', centeringThrottle: true },
  angle: { id: 'angle', label: 'ANGLE', long: 'dron sam się poziomuje, ale gaz (wysokość) jest w pełni ręczny', centeringThrottle: false },
  acro: { id: 'acro', label: 'ACRO', long: 'pełna kontrola ręczna — nic się samo nie poziomuje ani nie hamuje', centeringThrottle: false },
};

// ---------- wiatr (średni + porywy jako proces Ornsteina-Uhlenbecka) ----------
export class Wind {
  constructor() {
    this.mean = { x: 0, y: 0, z: 0 };
    this.gustSigma = 0;
    this.tau = 2.5;
    this.g = { x: 0, y: 0, z: 0 };
    this.cur = { x: 0, y: 0, z: 0 };
    this._seed = 12345;
  }
  set(speed, dirDeg, gustSigma = 0) {
    const a = dirDeg * DEG; // kierunek, W KTÓRĄ wieje; 0 = w stronę -Z
    this.mean = { x: -Math.sin(a) * speed, y: 0, z: -Math.cos(a) * speed };
    this.gustSigma = gustSigma;
    this.g = { x: 0, y: 0, z: 0 };
  }
  _randn() {
    // deterministyczny LCG + Box-Muller (powtarzalność testów)
    const r = () => ((this._seed = (this._seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  }
  step(dt) {
    if (this.gustSigma > 0) {
      const k = Math.sqrt((2 * dt) / this.tau) * this.gustSigma;
      this.g.x += (-this.g.x / this.tau) * dt + k * this._randn();
      this.g.z += (-this.g.z / this.tau) * dt + k * this._randn();
      this.g.y += (-this.g.y / this.tau) * dt + 0.35 * k * this._randn();
    }
    this.cur.x = this.mean.x + this.g.x;
    this.cur.y = this.mean.y + this.g.y;
    this.cur.z = this.mean.z + this.g.z;
    return this.cur;
  }
}

// ---------- symulacja ----------
export class DroneSim {
  constructor(presetId = 'trainer') {
    this.setDrone(presetId);
    this.mode = 'gps';
    this.groundY = 0;
    this.reset({});
  }

  setDrone(presetId) {
    this.cfg = DRONES[presetId] || DRONES.trainer;
    this.tMax = this.cfg.twr * this.cfg.mass * G;
  }

  setMode(mode) {
    this.mode = MODES[mode] ? mode : 'gps';
    this.vDamp = 0;
    this._holdAlt = null;
    this._holdPos = null;
    this._int = { x: 0, z: 0 };
  }

  reset({ pos = { x: 0, y: 0, z: 0 }, heading = 0, airborne = false } = {}) {
    const r = this.cfg.radius * 0.5;
    this.p = { x: pos.x, y: Math.max(pos.y, this.groundY + r), z: pos.z };
    this.v = { x: 0, y: 0, z: 0 };
    this.q = qAxis(0, 1, 0, heading);
    this.w = { x: 0, y: 0, z: 0 }; // prędkości kątowe w układzie drona (rad/s)
    this.thrust = airborne ? this.cfg.mass * G : 0;
    this.landed = !airborne;
    this.crashed = false;
    this.crashReason = '';
    this.heading = heading;
    this.tilt = 0;
    this.battery = 1;
    this.time = 0;
    this.airTime = 0;
    this._holdAlt = airborne ? this.p.y : null;
    this._holdPos = airborne ? { x: this.p.x, z: this.p.z } : null;
    this._int = { x: 0, z: 0 };
    this.throttle01 = 0;
  }

  // gaz 0..1 z surowego drążka -1..1
  static throttle01(raw) {
    return clamp((raw + 1) / 2, 0, 1);
  }

  get forward() {
    return qRot(this.q, { x: 0, y: 0, z: -1 });
  }
  get up() {
    return qRot(this.q, { x: 0, y: 1, z: 0 });
  }
  get speed() {
    return vlen(this.v);
  }
  get hSpeed() {
    return Math.hypot(this.v.x, this.v.z);
  }
  get altitude() {
    return this.p.y - this.groundY - this.cfg.radius * 0.5;
  }

  _updateDerived() {
    const f = this.forward;
    const hl = Math.hypot(f.x, f.z);
    if (hl > 0.15) this.heading = Math.atan2(-f.x, -f.z);
    this.tilt = Math.acos(clamp(this.up.y, -1, 1));
  }

  // regulator kąta: zwraca zadane prędkości kątowe (x,z) w układzie drona
  _levelRates(pitchAng, rollAng) {
    const c = this.cfg;
    const qDes = qMul(qMul(qAxis(0, 1, 0, this.heading), qAxis(1, 0, 0, -pitchAng)), qAxis(0, 0, 1, -rollAng));
    let e = qMul(qConj(this.q), qDes);
    if (e.w < 0) e = { x: -e.x, y: -e.y, z: -e.z, w: -e.w };
    const s = Math.hypot(e.x, e.y, e.z);
    let rx = 0,
      rz = 0;
    if (s > 1e-6) {
      const ang = 2 * Math.atan2(s, e.w);
      rx = (e.x / s) * ang;
      rz = (e.z / s) * ang;
    }
    return {
      x: clamp(rx * c.attGain, -c.maxLevelRate, c.maxLevelRate),
      z: clamp(rz * c.attGain, -c.maxLevelRate, c.maxLevelRate),
    };
  }

  step(dt, sticks, wind = { x: 0, y: 0, z: 0 }) {
    if (this.crashed) return;
    const c = this.cfg;
    const m = c.mass;
    this.time += dt;
    this._updateDerived();

    const sThr = clamp(sticks.throttle, -1, 1);
    const sYaw = clamp(sticks.yaw, -1, 1);
    const sPitch = clamp(sticks.pitch, -1, 1);
    const sRoll = clamp(sticks.roll, -1, 1);

    let wCmd = { x: 0, y: 0, z: 0 };
    let tCmd = 0;
    const cosTilt = Math.max(this.up.y, 0.45);

    // ----- oś pionowa -----
    if (this.mode === 'gps' || this.mode === 'alt') {
      const g = c.gps;
      const s = deadband(sThr, 0.08);
      let aCmd;
      if (this.landed) {
        tCmd = s > 0.12 ? m * G * 1.25 : 0;
        this._holdAlt = null;
      } else {
        if (s === 0) {
          if (this._holdAlt === null) this._holdAlt = this.p.y + this.v.y * 0.25;
          aCmd = 5.0 * (this._holdAlt - this.p.y) - 3.6 * this.v.y;
        } else {
          this._holdAlt = null;
          let vy = s > 0 ? s * g.vUp : s * g.vDown;
          // ochrona lądowania: blisko ziemi schodzimy powoli (jak w dronach z kamerą)
          if (vy < 0 && this.altitude < 0.8) vy = Math.max(vy, -0.55);
          aCmd = 4.0 * (vy - this.v.y);
        }
        aCmd = clamp(aCmd, -6, 8);
        tCmd = (m * (G + aCmd)) / cosTilt;
      }
      this.throttle01 = clamp(tCmd / this.tMax, 0, 1);
    } else {
      const u = DroneSim.throttle01(sThr);
      this.throttle01 = u;
      const idle = this.landed ? 0 : 0.02;
      tCmd = this.tMax * Math.max(idle, Math.pow(u, c.thrustExp));
    }
    // spadek osiągów przy słabej baterii
    const sag = this.battery < 0.25 ? 0.85 + 0.6 * this.battery : 1;
    tCmd = clamp(tCmd, 0, this.tMax * sag);

    // ----- orientacja -----
    if (this.mode === 'acro') {
      const a = c.acro;
      wCmd.x = -actualRate(sPitch, a.center, a.max, a.expo) * DEG;
      wCmd.z = -actualRate(sRoll, a.center, a.max, a.expo) * DEG;
      wCmd.y = -actualRate(sYaw, a.yawCenter, a.yawMax, a.expo) * DEG;
    } else {
      let pitchAng = 0,
        rollAng = 0,
        yawRate = c.yawRate;
      if (this.mode === 'gps') {
        const g = c.gps;
        yawRate = g.yawRate;
        const fx = -Math.sin(this.heading),
          fz = -Math.cos(this.heading);
        const rx = Math.cos(this.heading),
          rz = -Math.sin(this.heading);
        const sp = deadband(sPitch, 0.05),
          sr = deadband(sRoll, 0.05);
        let ax, az;
        if (sp === 0 && sr === 0 && !this.landed) {
          if (!this._holdPos && this.hSpeed < 0.6) this._holdPos = { x: this.p.x, z: this.p.z };
          if (this._holdPos) {
            ax = 3.2 * (this._holdPos.x - this.p.x) - 3.4 * this.v.x;
            az = 3.2 * (this._holdPos.z - this.p.z) - 3.4 * this.v.z;
          } else {
            ax = -2.2 * this.v.x; // hamowanie
            az = -2.2 * this.v.z;
          }
        } else {
          this._holdPos = null;
          const vf = expoCurve(sp, 0.25) * g.vmax,
            vr = expoCurve(sr, 0.25) * g.vmax;
          const vxCmd = fx * vf + rx * vr,
            vzCmd = fz * vf + rz * vr;
          ax = 2.4 * (vxCmd - this.v.x);
          az = 2.4 * (vzCmd - this.v.z);
        }
        // człon całkujący kompensuje stały wiatr
        if (!this.landed) {
          this._int.x = clamp(this._int.x + ax * 0.6 * dt, -4, 4);
          this._int.z = clamp(this._int.z + az * 0.6 * dt, -4, 4);
        }
        ax += this._int.x;
        az += this._int.z;
        const af = ax * fx + az * fz,
          ar = ax * rx + az * rz;
        pitchAng = Math.atan2(af, G);
        rollAng = Math.atan2(ar, G);
        const tl = Math.hypot(pitchAng, rollAng);
        if (tl > g.maxTilt) {
          pitchAng *= g.maxTilt / tl;
          rollAng *= g.maxTilt / tl;
        }
      } else {
        const maxTilt = this.mode === 'alt' ? c.altMaxTilt : c.angleMaxTilt;
        pitchAng = expoCurve(sPitch, 0.2) * maxTilt;
        rollAng = expoCurve(sRoll, 0.2) * maxTilt;
      }
      if (this.landed) {
        pitchAng = 0;
        rollAng = 0;
      }
      const lr = this._levelRates(pitchAng, rollAng);
      wCmd.x = lr.x;
      wCmd.z = lr.z;
      wCmd.y = -expoCurve(deadband(sYaw, 0.04), 0.3) * yawRate;
    }

    // ----- dynamika obrotowa (opóźnienie I rzędu) -----
    if (this.landed) {
      this.w = { x: 0, y: 0, z: 0 };
      this.q = qSlerpToward(this.q, qAxis(0, 1, 0, this.heading), 1 - Math.exp(-dt * 6));
      // na ziemi pozwalamy tylko na obrót wokół osi pionowej przy rozkręconych silnikach
    } else {
      const kr = 1 - Math.exp(-dt / c.tauRate);
      this.w.x += (wCmd.x - this.w.x) * kr;
      this.w.y += (wCmd.y - this.w.y) * kr;
      this.w.z += (wCmd.z - this.w.z) * kr;
      const wl = vlen(this.w);
      if (wl > 1e-9) {
        const dq = qAxis(this.w.x / wl, this.w.y / wl, this.w.z / wl, wl * dt);
        this.q = qNorm(qMul(this.q, dq));
      }
    }

    // ----- ciąg i ruch postępowy -----
    this.thrust += (tCmd - this.thrust) * (1 - Math.exp(-dt / c.tauMotor));
    const up = this.up;
    const rvx = this.v.x - wind.x,
      rvy = this.v.y - wind.y,
      rvz = this.v.z - wind.z;
    const rv = Math.hypot(rvx, rvy, rvz);
    const kd = c.dragLin + c.dragQuad * rv;
    let ax = (up.x * this.thrust) / m - kd * rvx;
    let ay = (up.y * this.thrust) / m - G - kd * rvy;
    // asysta gazu (tylko pierwszy poziom z ręcznym gazem): tłumi wznoszenie i opadanie, więc błąd gazu
    // daje ograniczoną prędkość pionową zamiast narastającego przyspieszenia
    if (this.vDamp && !this.landed && (this.mode === 'angle' || this.mode === 'acro')) ay -= this.vDamp * this.v.y;
    let az = (up.z * this.thrust) / m - kd * rvz;

    const r = c.radius * 0.5;
    if (this.landed) {
      if (this.thrust * up.y > m * G * 1.02) {
        this.landed = false; // start
      } else {
        this.v = { x: 0, y: 0, z: 0 };
        this.p.y = this.groundY + r;
        this._drainBattery(dt);
        return;
      }
    }
    this.v.x += ax * dt;
    this.v.y += ay * dt;
    this.v.z += az * dt;
    this.p.x += this.v.x * dt;
    this.p.y += this.v.y * dt;
    this.p.z += this.v.z * dt;
    this.airTime += dt;

    // ----- kontakt z ziemią -----
    if (this.p.y <= this.groundY + r) {
      const hs = Math.hypot(this.v.x, this.v.z);
      const tooFast = this.v.y < -2.6 || hs > 3.5;
      const tooTilted = this.tilt > 55 * DEG;
      if (tooFast || tooTilted) {
        this.crash(tooTilted ? 'Przyziemienie w zbyt dużym przechyle' : 'Zbyt twarde przyziemienie');
      } else {
        this.touchdownSpeed = Math.abs(this.v.y);
        this.touchdownHSpeed = hs;
        this.p.y = this.groundY + r;
        this.v = { x: 0, y: 0, z: 0 };
        this.landed = true;
        this._holdAlt = null;
        this._holdPos = null;
        this._int = { x: 0, z: 0 };
      }
    }
    this._drainBattery(dt);
  }

  _drainBattery(dt) {
    const hover = this.cfg.mass * G;
    const load = Math.pow(Math.max(this.thrust, 0) / hover, 1.5);
    this.battery = Math.max(0, this.battery - (dt * load) / (this.cfg.hoverMinutes * 60));
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason || 'Kolizja';
    this.v = { x: 0, y: 0, z: 0 };
    this.w = { x: 0, y: 0, z: 0 };
  }
}
