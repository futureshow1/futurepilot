// FuturePilot — autopilot testowy: przelatuje ćwiczenia przez TEN SAM interfejs drążków co gracz.
// Użycie w konsoli przeglądarki:
//   const ap = await import('./test/autopilot.js'); await ap.runAll();
// Zastosowania: (1) test regresji ćwiczeń i punktacji, (2) zalążek „ducha instruktora" (pokaz wzorcowego przelotu).

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

// człon całkujący: „trym na wiatr" w trybach bez utrzymywania pozycji (człowiek robi to samo — trzyma drążek lekko pod wiatr)
const trim = { x: 0, z: 0, tgt: null };

// regulator pozycji → drążki
function flyTo(fp, tgt, { heading = null, vmax = 4, faceTravel = false } = {}) {
  const s = fp.sim;
  const mode = s.mode;
  const dx = tgt.x - s.p.x,
    dz = tgt.z - s.p.z;
  const dist = Math.hypot(dx, dz);
  // zadana prędkość pozioma
  const sp = Math.min(vmax, dist * 0.9);
  const vxd = dist > 1e-3 ? (dx / dist) * sp : 0,
    vzd = dist > 1e-3 ? (dz / dist) * sp : 0;
  const fx = -Math.sin(s.heading),
    fz = -Math.cos(s.heading),
    rx = Math.cos(s.heading),
    rz = -Math.sin(s.heading);
  let pitch, roll;
  if (mode === 'gps') {
    const vm = s.cfg.gps.vmax;
    pitch = (vxd * fx + vzd * fz) / vm;
    roll = (vxd * rx + vzd * rz) / vm;
    // odwrócenie krzywej expo (0.25) w przybliżeniu: drążek ~ v^(0.8)
    pitch = Math.sign(pitch) * Math.pow(Math.abs(pitch), 0.8);
    roll = Math.sign(roll) * Math.pow(Math.abs(roll), 0.8);
    // martwa strefa drążka w trybie GPS: blisko celu utrzymaj minimalne wychylenie, inaczej dron staje przed celem
    const mag = Math.hypot(pitch, roll);
    if (dist > 0.12 && mag > 1e-6 && mag < 0.085) {
      pitch *= 0.085 / mag;
      roll *= 0.085 / mag;
    }
  } else {
    if (!trim.tgt || Math.hypot(trim.tgt.x - tgt.x, trim.tgt.z - tgt.z) > 1.5) {
      trim.x = trim.z = 0; // nowy cel — trym od zera
      trim.tgt = { x: tgt.x, z: tgt.z };
    }
    if (dist < 3) {
      trim.x = clamp(trim.x + dx * 0.012, -2.5, 2.5);
      trim.z = clamp(trim.z + dz * 0.012, -2.5, 2.5);
    }
    const ex = vxd + trim.x - s.v.x,
      ez = vzd + trim.z - s.v.z;
    const k = 0.55;
    pitch = (ex * fx + ez * fz) * k;
    roll = (ex * rx + ez * rz) * k;
    if (mode === 'acro') {
      // acro: drążek zadaje PRĘDKOŚĆ obrotu, więc autopilot sam zamyka pętlę kąta (tak jak robi to człowiek)
      const maxT = (30 * Math.PI) / 180;
      const pDes = clamp(pitch, -1, 1) * maxT,
        rDes = clamp(roll, -1, 1) * maxT;
      const up = s.up;
      const pCur = Math.atan2(up.x * fx + up.z * fz, up.y),
        rCur = Math.atan2(up.x * rx + up.z * rz, up.y);
      pitch = ((pDes - pCur) * 6) / 2.27; // 2,27 rad/s ≈ 130°/s na jednostkę drążka przy środku
      roll = ((rDes - rCur) * 6) / 2.27;
    }
  }
  // wysokość
  let throttle;
  const ey = tgt.y - s.p.y;
  if (mode === 'gps' || mode === 'alt') throttle = clamp(ey * 0.9 - s.v.y * 0.25, -1, 1);
  else {
    const tiltComp = 1 / Math.max(0.6, Math.cos(s.tilt)) - 1;
    throttle = clamp(0 + ey * 0.45 - s.v.y * 0.4 + tiltComp * 0.9, -1, 1);
  }
  // kurs
  let yaw = 0;
  let hd = heading;
  if (faceTravel && dist > 1.5) hd = Math.atan2(-dx, -dz);
  if (hd !== null) yaw = clamp(-wrap(hd - s.heading) * 1.6, -1, 1);
  return { throttle, yaw, pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1) };
}

const POLICIES = {
  alt(fp, d) {
    const s = fp.sim;
    if (d.phase === 'climb') return flyTo(fp, { x: d.pad.x, y: d.cfg.targets[d.i] + 0.08, z: d.pad.z });
    const st = flyTo(fp, { x: d.pad.x, y: 0, z: d.pad.z });
    st.throttle = s.mode === 'angle' ? (s.altitude > 1 ? -0.16 : -0.07) : s.altitude > 1.2 ? -0.6 : -0.35;
    return st;
  },
  hover(fp, d) {
    return flyTo(fp, { x: d.c.x, y: d.c.y, z: d.c.z }, { heading: d.cfg.noseIn ? Math.PI : 0 });
  },
  square(fp, d) {
    const p = d.pts[d.order[Math.min(d.i, d.order.length - 1)]];
    return flyTo(fp, { x: p.x, y: 2.7, z: p.z }, { heading: 0, vmax: 3.2 });
  },
  landing(fp, d) {
    const s = fp.sim;
    const p = d.pads[Math.min(d.i, d.pads.length - 1)];
    const dh = Math.hypot(s.p.x - p.x, s.p.z - p.z);
    if (!d.wasHigh) return flyTo(fp, { x: s.p.x, y: 2.2, z: s.p.z });
    // niezdarny gracz nie czeka na ideał: schodzi, gdy jest „mniej więcej nad" lądowiskiem
    const tolD = POLICIES._clumsy ? 1.0 : 0.4,
      tolV = POLICIES._clumsy ? 1.4 : 0.6;
    if (dh > tolD || s.hSpeed > tolV) return flyTo(fp, { x: p.x, y: 2.0, z: p.z }, { vmax: 3 });
    const st = flyTo(fp, { x: p.x, y: 0, z: p.z });
    st.throttle = s.mode === 'angle' ? (s.altitude > 0.8 ? -0.16 : -0.07) : -0.4;
    return st;
  },
  orient(fp, d) {
    if (!d.target || d.phase !== 'go') return { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    return flyTo(fp, { x: d.target.x, y: 2.6, z: d.target.z }, { vmax: 4 });
  },
  eight(fp, d) {
    const p = d.cps[Math.min(d.i, d.cps.length - 1)];
    return flyTo(fp, { x: p.x, y: 2.6, z: p.z }, { faceTravel: true, vmax: 3.2 });
  },
  gates(fp, d) {
    const s = fp.sim;
    const G = d.gates[Math.min(d.i, d.gates.length - 1)];
    const fx = -Math.sin(G.h),
      fz = -Math.cos(G.h);
    const rel = (s.p.x - G.x) * fx + (s.p.z - G.z) * fz; // <0 przed bramką
    const lat = Math.abs((s.p.x - G.x) * Math.cos(G.h) + (s.p.z - G.z) * -Math.sin(G.h));
    // najpierw ustaw się w osi bramki, potem przeleć na wylot
    const aim = rel < -5 || lat > 0.7 ? { x: G.x - fx * 4.5, y: G.y, z: G.z - fz * 4.5 } : { x: G.x + fx * 3, y: G.y, z: G.z + fz * 3 };
    return flyTo(fp, aim, { heading: G.h, vmax: 3.5 });
  },
  orbit(fp, d) {
    const s = fp.sim;
    const dx = d.poi.x - s.p.x,
      dz = d.poi.z - s.p.z;
    const dist = Math.hypot(dx, dz);
    const bearing = Math.atan2(-dx, -dz);
    const off = wrap(bearing - s.heading);
    return {
      throttle: clamp((7 - s.p.y) * 0.8 - s.v.y * 0.3, -1, 1),
      yaw: clamp(-off * 2.2, -1, 1),
      pitch: clamp((dist - 14) * 0.25, -0.6, 0.6),
      roll: 0.55,
    };
  },
};

// clumsy: przybliżenie niezdarnego początkującego — reaguje z opóźnieniem (trzyma poprzednie wychylenie ok. 0,4 s),
// ma drżącą rękę i przesterowuje. To NIE zastępuje testów z ludźmi; pozwala tylko sprawdzić, czy poziom 1
// da się zaliczyć kiepskim sterowaniem i jaką ocenę wtedy daje gra.
export async function runDrill(id, level, { maxSec = 200, dt = 1 / 60, noise = 0, clumsy = false, seed0 = 7 } = {}) {
  const fp = window.__fp;
  fp.startDrill(id, level);
  trim.x = trim.z = 0;
  POLICIES._clumsy = clumsy;
  let n = 0;
  const maxN = maxSec / dt;
  let seed = seed0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2;
  let held = null,
    heldN = 0;
  while (fp.app.state !== 'result' && n < maxN) {
    const d = fp.app.drill;
    let st = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    if (fp.app.state === 'flying' && !fp.sim.crashed) st = POLICIES[id](fp, d);
    if (noise) {
      st.pitch = clamp(st.pitch + rnd() * noise, -1, 1);
      st.roll = clamp(st.roll + rnd() * noise, -1, 1);
    }
    if (clumsy && fp.app.state === 'flying') {
      if (!held || heldN <= 0) {
        held = {
          throttle: clamp(st.throttle * 1.3 + rnd() * 0.2, -1, 1),
          yaw: clamp(st.yaw * 1.4 + rnd() * 0.25, -1, 1),
          pitch: clamp(st.pitch * 1.5 + rnd() * 0.3, -1, 1),
          roll: clamp(st.roll * 1.5 + rnd() * 0.3, -1, 1),
        };
        heldN = 18 + Math.floor(Math.abs(rnd()) * 14); // 0,3–0,5 s „zamrożonej" reakcji
      }
      heldN--;
      st = held;
    }
    // gaz w trybach ręcznych: autopilot podaje surową pozycję drążka
    fp.input.injected = st;
    fp.step(dt, false);
    n++;
  }
  const r = fp.app.lastResult;
  fp.input.injected = null;
  return {
    id,
    level,
    mode: fp.app.drill.mode,
    finished: fp.app.state === 'result',
    simSec: +(n * dt).toFixed(1),
    score: r && r.score,
    stars: r && r.stars,
    completed: r && r.completed,
    crashes: fp.app.drill.crashes,
    metrics: r && r.metrics.map((m) => `${m.label}: ${m.value}`),
    tips: r && r.tips,
  };
}

export async function runAll(levels = null) {
  const fp = window.__fp;
  const saved = JSON.stringify(fp.store.data);
  fp.store.data.settings.courseMode = false;
  const out = [];
  for (const D of fp.DRILLS) {
    const ls = levels || D.levels.map((_, i) => i + 1);
    for (const l of ls) {
      if (l > D.levels.length) continue;
      try {
        out.push(await runDrill(D.id, l));
      } catch (e) {
        out.push({ id: D.id, level: l, error: String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) });
      }
    }
  }
  // testy nie mogą zmienić postępów gracza
  fp.store.data = JSON.parse(saved);
  fp.store.save();
  fp.showMenu();
  return out;
}
