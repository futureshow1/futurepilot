// FuturePilot — prototyp 0.1: pętla gry, przebieg ćwiczeń, ekrany.
import { World, THREE, PILOT } from './world.js';
import { DroneSim, Wind, MODES, DRONES } from './physics.js';
import { Input, GamepadWizard, STICK_MODES } from './input.js';
import { Telemetry } from './telemetry.js';
import { DRILLS, drillById, SKILLS, plural } from './drills.js';
import { store } from './storage.js';
import { MotorAudio } from './audio.js';

const $ = (s) => document.querySelector(s);
const PHYS_DT = 1 / 240;
const ZERO = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
const coarse = window.matchMedia('(pointer: coarse)').matches;
const fmt = (x, d = 1) => x.toFixed(d).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SRC_LABEL = { touch: 'dotyk', gamepad: 'gamepad', radio: 'aparatura RC', keyboard: 'klawiatura', auto: 'autopilot' };

store.load();
const world = new World($('#gl'));
const sim = new DroneSim('trainer');
const wind = new Wind();
const telemetry = new Telemetry();
const audio = new MotorAudio();
const input = new Input({ layer: $('#touch-layer'), stickL: $('#stickL'), stickR: $('#stickR'), monitor: $('#stick-monitor') });

const app = {
  state: 'menu', // menu | brief | countdown | flying | paused | result | other
  drill: null,
  D: null,
  level: 1,
  playlist: null,
  pIndex: 0,
  acc: 0,
  crashT: 0,
  assistView: false,
  lastResult: null,
};

// ------------------------------------------------------------------ ustawienia
function applySettings() {
  const s = store.data.settings;
  input.stickMode = s.stickMode;
  input.sizeScale = s.stickSize;
  audio.setEnabled(s.sound);
  world.zoomAssist = s.zoomAssist;
  world.plumbAssist = s.plumbAssist;
  world.setQuality(s.quality);
  input._layoutIdle();
}
applySettings();

// ------------------------------------------------------------------ HUD
const hudEl = {
  root: $('#hud'),
  obj: $('#hud-obj'),
  bar: $('#hud-bar'),
  barwrap: $('#hud-barwrap'),
  sub: $('#hud-sub'),
  timer: $('#hud-timer'),
  mode: $('#hud-mode'),
  src: $('#hud-src'),
  flash: $('#hud-flash'),
  marker: $('#hud-marker'),
  frame: $('#hud-frame'),
  osd: $('#osd'),
  kbd: $('#kbd-hint'),
};
const hud = {
  _c: {},
  _marker: null,
  _flashT: 0,
  _set(key, el, val) {
    if (this._c[key] !== val) {
      this._c[key] = val;
      el.textContent = val;
    }
  },
  objective(t) {
    this._set('obj', hudEl.obj, t);
  },
  sub(t) {
    this._set('sub', hudEl.sub, t || '');
  },
  progress(f) {
    const v = f === null || f === undefined ? -1 : Math.round(Math.max(0, Math.min(1, f)) * 100);
    if (this._c.bar !== v) {
      this._c.bar = v;
      hudEl.barwrap.style.visibility = v < 0 ? 'hidden' : 'visible';
      hudEl.bar.style.width = Math.max(0, v) + '%';
    }
  },
  flash(text, kind = 'info', ms = 1300) {
    hudEl.flash.textContent = text;
    hudEl.flash.className = 'show ' + kind;
    this._flashT = ms / 1000;
  },
  marker(v, label) {
    this._marker = v ? { v, label: label || '' } : null;
  },
  frameBand(tolDeg, ok) {
    this._band = tolDeg ? { tol: tolDeg, ok } : null;
  },
  reset() {
    this._c = {};
    this._marker = null;
    this._band = null;
    hudEl.flash.className = '';
    hudEl.marker.hidden = true;
    hudEl.frame.hidden = true;
    this.objective('');
    this.sub('');
    this.progress(null);
  },
  update(dt) {
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) hudEl.flash.className = '';
    }
    // znacznik celu
    let m = this._marker;
    // blisko celu znacznik znika — nie może zasłaniać drona ani strefy
    if (m && Math.hypot(m.v.x - sim.p.x, m.v.y - sim.p.y, m.v.z - sim.p.z) < 4) m = null;
    if (m) {
      const w = window.innerWidth,
        h = window.innerHeight;
      const p = world.toScreen(m.v);
      let x = p.x,
        y = p.y;
      if (p.behind) {
        x = w - x;
        y = h - y;
      }
      const mx = 46,
        top = 84,
        bot = 70;
      const on = !p.behind && x > mx && x < w - mx && y > top && y < h - bot;
      hudEl.marker.hidden = false;
      hudEl.marker.classList.toggle('onscreen', on);
      const lbl = hudEl.marker.lastElementChild;
      if (this._c.mlabel !== m.label) {
        this._c.mlabel = m.label;
        lbl.textContent = m.label;
      }
      if (on) {
        hudEl.marker.style.transform = `translate(${x + 12}px, ${y - 44}px)`;
      } else {
        const cx = w / 2,
          cy = h / 2;
        let dx = x - cx,
          dy = y - cy;
        if (p.behind) {
          dx *= 4;
          dy *= 4;
        }
        const k = Math.min((w / 2 - mx) / Math.abs(dx || 1e-6), (h / 2 - bot) / Math.abs(dy || 1e-6));
        const ex = cx + dx * k,
          ey = Math.max(top, cy + dy * k);
        const ang = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
        hudEl.marker.style.transform = `translate(${ex - 8}px, ${ey - 8}px)`;
        hudEl.marker.firstElementChild.style.transform = `rotate(${ang}deg)`;
      }
    } else hudEl.marker.hidden = true;
    // ramka kadru (Orbita)
    const b = this._band;
    if (b) {
      hudEl.frame.hidden = false;
      hudEl.frame.classList.toggle('ok', !!b.ok);
      const cam = world.camera;
      const hf = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
      const off = (Math.tan((b.tol * Math.PI) / 180) / Math.tan(hf)) * 50;
      const [l, r] = hudEl.frame.children;
      l.style.left = 50 - off + '%';
      r.style.left = 50 + off + '%';
    } else hudEl.frame.hidden = true;
  },
};

// ------------------------------------------------------------------ ekrany
const screens = $('#screens');
function show(html, light = false) {
  screens.innerHTML = `<section class="screen${light ? ' light' : ''}"><div class="wrap">${html}</div></section>`;
  screens.firstElementChild.scrollTop = 0;
}
function hideScreens() {
  screens.innerHTML = '';
}
const starsHtml = (n, max = 3) => `<span class="stars" aria-label="${n} z ${max} gwiazdek">${'★'.repeat(n)}<span class="off">${'★'.repeat(max - n)}</span></span>`;

function bestStars(id) {
  const p = store.data.progress[id] || {};
  let best = 0;
  for (const l of Object.values(p)) best = Math.max(best, l.stars || 0);
  return best;
}

function modeTag(cfg) {
  return MODES[cfg.mode].label + (cfg.wind ? ' + wiatr' : '');
}

function showMenu() {
  app.state = 'menu';
  app.playlist = null;
  setFlightUi(false);
  startAttract();
  const plan = store.dailyPlan();
  const planNames = plan.map((p) => `${drillById(p.id).title} <span class="note">(poz. ${p.level})</span>`).join(' · ');
  const t = store.data.totals;
  const mins = Math.round(t.flightSec / 60);
  const cards = DRILLS.map((D) => {
    const rec = store.recommended(D.id);
    const pips = D.levels
      .map((_, i) => {
        const b = store.best(D.id, i + 1);
        return `<i class="${b && b.stars >= 2 ? 'done' : b && b.runs ? 'part' : ''}"></i>`;
      })
      .join('');
    return `<button class="card drill" data-act="brief" data-id="${D.id}">
      <div class="top"><span class="skill">${esc(SKILLS[D.skill].label)}</span>${starsHtml(bestStars(D.id))}</div>
      <h3>${esc(D.title)}</h3>
      <p>${esc(D.goal)}</p>
      <div class="pips">${pips}<span>&nbsp;poziom ${rec} z ${D.levels.length} · ${modeTag(D.levels[rec - 1])}</span></div>
    </button>`;
  }).join('');
  show(`
    <div class="brand"><h1>FUTURE<b>PILOT</b></h1><small>trener operatora drona · prototyp 0.1</small></div>
    <p class="lead">Pięć minut dziennie. Krótkie ćwiczenia uczą tego, co naprawdę przenosi się na prawdziwego drona: układu drążków, orientacji, płynności ruchów i procedur.</p>
    <div class="card daily">
      <div><h3>Trening dnia · około 6 minut</h3><p>${planNames}</p></div>
      <button class="btn primary" data-act="daily">Zaczynam</button>
    </div>
    <h2>Ćwiczenia</h2>
    <div class="grid">${cards}</div>
    <div class="foot">
      <button class="btn small" data-act="profile">Profil umiejętności</button>
      <button class="btn small" data-act="settings">Ustawienia</button>
      <button class="btn small" data-act="about">O projekcie</button>
      <span class="note" style="align-self:center">${t.runs ? `${t.runs} ${plural(t.runs, 'lot', 'loty', 'lotów')} · ${mins} ${plural(mins, 'minuta', 'minuty', 'minut')} w powietrzu` : 'Pierwszy raz? Zacznij od „Treningu dnia".'}</span>
    </div>`);
}

function controlsHtml(mode) {
  const m = STICK_MODES[store.data.settings.stickMode];
  const manual = !MODES[mode].centeringThrottle;
  const names = {
    throttle: manual ? ['Gaz', 'więcej / mniej ciągu — drążek NIE wraca do środka'] : ['Wysokość', 'w górę / w dół'],
    yaw: ['Obrót', 'w lewo / w prawo'],
    pitch: ['Przód / tył', mode === 'acro' ? 'pochylenie' : 'lot do przodu i do tyłu'],
    roll: ['Lewo / prawo', mode === 'acro' ? 'przechył' : 'lot w bok'],
  };
  const stick = (label, vert, horiz) => `<div class="ctl"><b>${label}</b>
    <span class="ax">↕ <em>${names[vert][0]}</em> — ${names[vert][1]}</span>
    <span class="ax">↔ <em>${names[horiz][0]}</em> — ${names[horiz][1]}</span></div>`;
  return `<div class="controls">${stick('LEWY KCIUK', m.LY, m.LX)}${stick('PRAWY KCIUK', m.RY, m.RX)}</div>`;
}

function showBrief(id, level) {
  const D = drillById(id);
  app.state = 'brief';
  const unlocked = store.unlocked(id);
  level = Math.min(level || store.recommended(id), unlocked);
  app.D = D;
  app.level = level;
  const cfg = D.levels[level - 1];
  const lv = D.levels
    .map((c, i) => {
      const n = i + 1;
      const b = store.best(id, n);
      const locked = n > unlocked;
      return `<button class="lvl${n === level ? ' sel' : ''}${locked ? ' locked' : ''}" data-act="level" data-l="${n}" ${locked ? 'disabled' : ''}>
        ${locked ? '🔒' : n}<small>${MODES[c.mode].label}${c.wind ? ' 💨' : ''}</small><small>${b ? '★'.repeat(b.stars) || '—' : ''}</small></button>`;
    })
    .join('');
  const gp = input.readGamepadRaw();
  const srcNote = gp
    ? `Wykryto kontroler: <b>${esc(gp.id.slice(0, 48))}</b>${gp.mapping !== 'standard' && !input.gpMaps[gp.id] ? ' — <button class="btn small" data-act="wizard">Przypisz osie</button>' : ''}`
    : coarse
    ? 'Sterowanie: <b>dotyk</b>. Połóż kciuki w dolnych rogach ekranu — drążek pojawi się tam, gdzie dotkniesz.'
    : 'Sterowanie: <b>klawiatura</b> (W/S, A/D, strzałki; Shift = precyzyjnie) albo podłącz gamepad lub aparaturę RC przez USB.';
  const inPlan = app.playlist ? `<span class="note">Trening dnia: ćwiczenie ${app.pIndex + 1} z ${app.playlist.length}</span>` : '';
  show(`
    <div class="brief">
      <div class="card">
        <div class="kicker">${esc(SKILLS[D.skill].label)} · ${esc(SKILLS[D.skill].desc)}</div>
        <h1>${esc(D.title)}</h1>
        <p>${esc(D.goal)}</p>
        <p class="note"><b>Po co to ćwiczenie?</b> ${esc(D.why)}</p>
        <div class="levels">${lv}</div>
        ${unlocked < D.levels.length ? `<p class="note">Kolejny poziom otwiera zaliczenie poprzedniego (1 gwiazdka) albo trzy próby. Dwie i trzy gwiazdki to cele na mistrzostwo.</p>` : ''}
        <div class="modebox"><b>Tryb lotu: ${MODES[cfg.mode].label}</b> — ${esc(MODES[cfg.mode].long)}.${cfg.wind ? ` Wiatr około ${fmt(cfg.wind)} m/s${cfg.gust ? ' z porywami' : ''} — patrz na rękaw przy polu.` : ''}${cfg.assist ? ' <b>Asysta gazu:</b> na tym poziomie gra łagodzi wznoszenie i opadanie, żeby łatwiej było wyczuć ręczny gaz. Na kolejnym poziomie asysta znika.' : ''}</div>
      </div>
      <div class="card">
        ${controlsHtml(cfg.mode)}
        <p class="note" style="margin:10px 0">${srcNote}</p>
        <div class="row end">${inPlan}
          <button class="btn" data-act="menu">Wróć</button>
          <button class="btn primary" data-act="start">Start</button>
        </div>
      </div>
    </div>`);
}

function qColor(g) {
  return g >= 0.75 ? 'var(--ok)' : g >= 0.45 ? 'var(--accent)' : 'var(--bad)';
}

function showResult(res, rec) {
  app.state = 'result';
  setFlightUi(false);
  const D = app.D;
  const metrics = res.metrics
    .map((m) => `<li><span>${esc(m.label)}</span><b>${esc(m.value)}</b>${m.good === null || m.good === undefined ? '' : `<span class="q"><i style="width:${Math.round(Math.max(0.04, m.good) * 100)}%;background:${m.neutral ? 'var(--blue)' : qColor(m.good)}"></i></span>`}</li>`)
    .join('');
  const tips = res.tips.length ? `<ul class="tips">${res.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="note">Czysty lot — nie mam uwag. Spróbuj wyższego poziomu.</p>';
  const canNext = app.level < D.levels.length && store.unlocked(D.id) > app.level;
  const more = app.playlist && app.pIndex < app.playlist.length - 1;
  const head = res.completed ? (res.stars === 3 ? 'Wzorowo!' : res.stars === 2 ? 'Bardzo dobrze' : res.stars === 1 ? 'Zaliczone' : 'Ukończone — gwiazdka jest blisko') : 'Jeszcze nie — spróbuj ponownie';
  // porównanie z WŁASNĄ poprzednią próbą: dla początkującego ważniejsze niż norma
  const mine = store.data.runs.filter((r) => r.id === D.id && r.level === app.level);
  const prevRun = mine.length >= 2 ? mine[mine.length - 2] : null;
  let trend;
  if (!prevRun) trend = 'Pierwsza próba na tym poziomie — to twój punkt odniesienia.';
  else if (res.score > prevRun.score) trend = `<b class="up">▲ +${res.score - prevRun.score}</b> względem poprzedniej próby (${prevRun.score} → ${res.score}).`;
  else if (res.score === prevRun.score) trend = `Tak samo jak poprzednio (${res.score}). Stabilność też jest postępem.`;
  else trend = `Poprzednio ${prevRun.score}, teraz ${res.score}. Wahania są normalne — liczy się kierunek po kilku próbach.`;
  if (!res.completed) trend += ' Na tym etapie to normalne: każda próba utrwala układ drążków.';
  show(
    `
    <div class="card">
      <div class="result-head">
        <div class="bigstars">${'★'.repeat(res.stars)}<span class="off">${'★'.repeat(3 - res.stars)}</span></div>
        <div>
          <div class="kicker">${esc(D.title)} · poziom ${app.level} · ${MODES[D.levels[app.level - 1].mode].label}</div>
          <div class="score"><b>${res.score}</b> / 100 · ${head}</div>
          ${rec.newBest && rec.prevBest ? `<div class="record">Nowy rekord (poprzednio ${rec.prevBest})</div>` : ''}
          <div class="trend">${trend}</div>
        </div>
      </div>
      <div class="cols">
        <div><h2 style="margin-top:0">Pomiary</h2><ul class="metrics">${metrics}</ul></div>
        <div><h2 style="margin-top:0">Trener</h2>${tips}
          <canvas class="trace" id="trace" width="600" height="300" aria-label="Tor lotu z góry"></canvas>
          <p class="note" style="margin:4px 0 0">Tor lotu widziany z góry (kropka = pilot).</p></div>
      </div>
      <div class="foot row end">
        <button class="btn" data-act="menu">Menu</button>
        <button class="btn" data-act="retry">Jeszcze raz</button>
        ${more ? `<button class="btn primary" data-act="next-in-plan">Dalej: ${esc(drillById(app.playlist[app.pIndex + 1].id).title)}</button>` : canNext ? `<button class="btn primary" data-act="next-level">Następny poziom</button>` : app.playlist ? `<button class="btn primary" data-act="plan-done">Zakończ trening</button>` : ''}
      </div>
    </div>`,
    true
  );
  drawTrace();
}

function drawTrace() {
  const c = $('#trace');
  if (!c) return;
  const g = c.getContext('2d');
  const tr = telemetry.trace;
  g.clearRect(0, 0, c.width, c.height);
  if (tr.length < 2) return;
  let minX = PILOT.x,
    maxX = PILOT.x,
    minZ = PILOT.z,
    maxZ = PILOT.z;
  for (const p of tr) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const pad = 24;
  const s = Math.min((c.width - 2 * pad) / Math.max(maxX - minX, 6), (c.height - 2 * pad) / Math.max(maxZ - minZ, 6));
  const ox = c.width / 2 - ((minX + maxX) / 2) * s,
    oz = c.height / 2 - ((minZ + maxZ) / 2) * s;
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  for (let m = Math.floor(minX / 5) * 5; m <= maxX + 5; m += 5) {
    g.beginPath();
    g.moveTo(ox + m * s, 0);
    g.lineTo(ox + m * s, c.height);
    g.stroke();
  }
  for (let m = Math.floor(minZ / 5) * 5; m <= maxZ + 5; m += 5) {
    g.beginPath();
    g.moveTo(0, oz + m * s);
    g.lineTo(c.width, oz + m * s);
    g.stroke();
  }
  g.lineWidth = 3;
  g.lineJoin = 'round';
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1],
      b = tr[i];
    const t = i / tr.length;
    g.strokeStyle = `hsl(${40 + t * 100}, 90%, 60%)`;
    g.beginPath();
    g.moveTo(ox + a.x * s, oz + a.z * s);
    g.lineTo(ox + b.x * s, oz + b.z * s);
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(ox + PILOT.x * s, oz + PILOT.z * s, 5, 0, Math.PI * 2);
  g.fill();
}

function showPause() {
  show(
    `<div class="card" style="max-width:420px;margin:12vh auto 0;text-align:center">
      <h1 style="margin:4px 0 14px">Pauza</h1>
      <div class="row" style="justify-content:center">
        <button class="btn primary" data-act="resume">Wznów</button>
        <button class="btn" data-act="retry">Od nowa</button>
        <button class="btn" data-act="menu">Menu</button>
      </div>
    </div>`,
    true
  );
}

function radarSvg(m) {
  const keys = Object.keys(SKILLS);
  const n = keys.length,
    R = 120,
    cx = 180,
    cy = 165;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  let grid = '';
  for (const f of [0.25, 0.5, 0.75, 1]) grid += `<polygon points="${keys.map((_, i) => pt(i, R * f).join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,0.13)"/>`;
  const axes = keys.map((k, i) => {
    const [x, y] = pt(i, R),
      [lx, ly] = pt(i, R + 22);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.13)"/><text x="${lx}" y="${ly}" fill="#9fb0c8" font-size="12" text-anchor="middle" dominant-baseline="middle">${SKILLS[k].label}</text>`;
  });
  const poly = keys.map((k, i) => pt(i, R * Math.max(0.03, m[k])).join(',')).join(' ');
  return `<svg class="radar" viewBox="0 0 360 330" role="img" aria-label="Profil umiejętności">${grid}${axes.join('')}<polygon points="${poly}" fill="rgba(255,176,32,0.3)" stroke="#ffb020" stroke-width="2"/></svg>`;
}

function showProfile() {
  app.state = 'other';
  const m = store.skillMastery();
  const t = store.data.totals;
  const src = t.sources || {};
  const mins = Math.round(t.flightSec / 60);
  const stars = DRILLS.reduce((a, D) => a + Object.values(store.data.progress[D.id] || {}).reduce((x, l) => x + (l.stars || 0), 0), 0);
  const maxStars = DRILLS.reduce((a, D) => a + D.levels.length * 3, 0);
  const runs = store.data.runs.slice(-60);
  const avgSmooth = runs.length ? Math.round(runs.reduce((a, r) => a + (r.smooth || 0), 0) / runs.length) : 0;
  const ladder = [
    ['touch', 'Ekran dotykowy', 'Uczysz się układu drążków, orientacji, trybów lotu i procedur. Bez żadnych kosztów.'],
    ['gamepad', 'Gamepad Bluetooth (od ok. 80 zł)', 'Prawdziwe, sprężynujące drążki pod kciukami. Ten sam układ co w aparaturze (Mode 2).'],
    ['radio', 'Aparatura RC przez USB (od ok. 250 zł)', 'To samo urządzenie, którym potem sterujesz prawdziwym dronem. Tu przenosi się już pamięć mięśniowa.'],
  ]
    .map(([k, name, d], i) => `<li class="${src[k] ? 'on' : ''}"><span class="n">${i + 1}</span><span><b>${name}</b>${src[k] ? ` — ${src[k]} ${plural(src[k], 'lot', 'loty', 'lotów')}` : ''}<br><span class="note">${d}</span></span></li>`)
    .join('');
  show(`
    <div class="row" style="justify-content:space-between"><div class="brand"><h1>Profil umiejętności</h1></div><button class="btn small" data-act="menu">Wróć</button></div>
    <div class="cols">
      <div class="card">${radarSvg(m)}<p class="note" style="text-align:center;margin:0">Wykres rośnie wraz z poziomem i wynikiem ćwiczeń z danej umiejętności.</p></div>
      <div>
        <div class="card"><div class="kv">
          <span>Loty treningowe</span><b>${t.runs}</b>
          <span>Czas w powietrzu</span><b>${mins} ${plural(mins, 'minuta', 'minuty', 'minut')}</b>
          <span>Zdobyte gwiazdki</span><b>${stars} z ${maxStars}</b>
          <span>Średnia płynność sterowania (ostatnie loty)</span><b>${avgSmooth}%</b>
        </div></div>
        <h2>Drabina sprzętowa</h2>
        <div class="card"><ul class="ladder">${ladder}</ul>
        <p class="note">Wyniki są zapisywane z informacją, czym sterowano — docelowo gra porówna twoje postępy na każdym szczeblu.</p></div>
      </div>
    </div>`);
}

function seg(name, options, cur) {
  return `<div class="seg">${options.map(([v, l]) => `<button data-act="set" data-k="${name}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function showSettings() {
  app.state = 'other';
  const s = store.data.settings;
  const gp = input.readGamepadRaw();
  show(`
    <div class="row" style="justify-content:space-between"><div class="brand"><h1>Ustawienia</h1></div><button class="btn small" data-act="menu">Wróć</button></div>
    <div class="card" style="margin-top:12px">
      <div class="set"><div>Układ drążków<small>Mode 2 to standard w Polsce i w dronach z kamerą: gaz i obrót po lewej.</small></div>${seg('stickMode', [[2, 'Mode 2'], [1, 'Mode 1'], [3, 'Mode 3'], [4, 'Mode 4']], s.stickMode)}</div>
      <div class="set"><div>Rozmiar drążków dotykowych<small>Większy = precyzyjniej, mniejszy = krótszy ruch kciuka.</small></div>${seg('stickSize', [[0.8, 'Mały'], [1, 'Średni'], [1.25, 'Duży']], s.stickSize)}</div>
      <div class="set"><div>Dźwięk silników<small>Słuch podpowiada, ile masz gazu.</small></div>${seg('sound', [[true, 'Włączony'], [false, 'Wyłączony']], s.sound)}</div>
      <div class="set"><div>Przybliżanie w widoku z ziemi<small>Kompensuje mały ekran: daleki dron jest lekko przybliżany.</small></div>${seg('zoomAssist', [[true, 'Tak'], [false, 'Nie']], s.zoomAssist)}</div>
      <div class="set"><div>Linia pionu pod dronem<small>Ułatwia ocenę, nad czym jest dron. Wyłącz, gdy poczujesz się pewnie.</small></div>${seg('plumbAssist', [[true, 'Tak'], [false, 'Nie']], s.plumbAssist)}</div>
      <div class="set"><div>Jakość grafiki<small>Niższa oszczędza baterię i pomaga na starszych telefonach.</small></div>${seg('quality', [[1, 'Wysoka'], [0.75, 'Średnia'], [0.5, 'Niska']], s.quality)}</div>
      <div class="set"><div>Tryb kursu<small>Kolejny poziom otwiera zaliczenie poprzedniego albo trzy próby. Wyłącz, żeby mieć dostęp do wszystkiego (tryb testowy).</small></div>${seg('courseMode', [[true, 'Kurs'], [false, 'Wszystko odblokowane']], s.courseMode)}</div>
      <div class="set"><div>Kontroler<small>${gp ? esc(gp.id.slice(0, 60)) : 'Nie wykryto. Podłącz gamepad lub aparaturę RC i porusz drążkiem.'}</small></div><button class="btn small" data-act="wizard" ${gp ? '' : 'disabled'}>Przypisz osie</button></div>
      <div class="set"><div>Postępy<small>Wszystko jest zapisane wyłącznie na tym urządzeniu.</small></div><button class="btn small" data-act="reset">Wyzeruj postępy</button></div>
    </div>`);
}

function showAbout() {
  app.state = 'other';
  show(`
    <div class="row" style="justify-content:space-between"><div class="brand"><h1>O projekcie</h1></div><button class="btn small" data-act="menu">Wróć</button></div>
    <div class="card" style="margin-top:12px;max-width:760px">
      <p><b>FuturePilot to prototyp gry treningowej</b>, która ma ułatwić każdemu chętnemu wejście w obsługę dronów — zanim kupi sprzęt albo pójdzie na kurs.</p>
      <p><b>Co się przenosi na prawdziwego drona?</b> Układ i kierunki drążków, zrozumienie trybów lotu, orientacja (zwłaszcza lot „na siebie"), koordynacja obu rąk, nawyk płynnych, proporcjonalnych ruchów, czytanie sytuacji i procedury.</p>
      <p><b>Czego ekran dotykowy nie da?</b> Czucia sprężyn i precyzji prawdziwych drążków. Dlatego gra obsługuje także gamepady i aparatury RC, a wyniki zapisuje osobno dla każdego sposobu sterowania.</p>
      <p><b>Jak ćwiczyć?</b> Krótko i regularnie: 5–10 minut dziennie daje więcej niż godzina raz w tygodniu. Poziomy stopniowo zabierają ułatwienia: GPS → STABILNY → ANGLE → ACRO, potem wiatr i ciaśniejsze tolerancje.</p>
      <p class="note">Wersja 0.1 — fizyka jest uproszczona, a progi ocen wymagają kalibracji na testach z ludźmi. Żadne dane nie opuszczają urządzenia.</p>
    </div>`);
}

let wizard = null;
function showWizard() {
  app.state = 'wizard';
  wizard = new GamepadWizard(input);
  renderWizard();
}
function renderWizard() {
  const gp = input.readGamepadRaw();
  const st = wizard.done ? null : wizard.step;
  show(`
    <div class="card" style="max-width:560px;margin:8vh auto 0">
      <div class="kicker">Kontroler · krok ${Math.min(wizard.i + 1, 4)} z 4</div>
      <h1 style="margin:6px 0 10px">${wizard.done ? 'Gotowe — osie przypisane' : esc(st.text)}</h1>
      <p class="note">${gp ? esc(gp.id.slice(0, 70)) : 'Nie widzę kontrolera. Porusz drążkiem albo naciśnij dowolny przycisk.'}</p>
      ${wizard.waitRelease && !wizard.done ? '<p class="note">Zapisane. Puść drążek…</p>' : ''}
      <div class="row end"><button class="btn${wizard.done ? ' primary' : ''}" data-act="settings">${wizard.done ? 'Zakończ' : 'Anuluj'}</button></div>
    </div>`);
  wizard._shown = `${wizard.i}|${wizard.waitRelease}|${wizard.done}|${!!gp}`;
}

// ------------------------------------------------------------------ akcje interfejsu
screens.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  audio.unlock();
  const act = b.dataset.act;
  if (act === 'brief') showBrief(b.dataset.id);
  else if (act === 'level') showBrief(app.D.id, +b.dataset.l);
  else if (act === 'menu') showMenu();
  else if (act === 'start') startDrill(app.D.id, app.level);
  else if (act === 'retry') startDrill(app.D.id, app.level);
  else if (act === 'resume') resume();
  else if (act === 'next-level') showBrief(app.D.id, app.level + 1);
  else if (act === 'daily') {
    app.playlist = store.dailyPlan();
    app.pIndex = 0;
    showBrief(app.playlist[0].id, app.playlist[0].level);
  } else if (act === 'next-in-plan') {
    app.pIndex++;
    const p = app.playlist[app.pIndex];
    showBrief(p.id, p.level);
  } else if (act === 'plan-done') showMenu();
  else if (act === 'profile') showProfile();
  else if (act === 'settings') showSettings();
  else if (act === 'about') showAbout();
  else if (act === 'wizard') showWizard();
  else if (act === 'reset') {
    if (confirm('Wyzerować wszystkie postępy na tym urządzeniu?')) {
      store.reset();
      showSettings();
    }
  } else if (act === 'set') {
    const k = b.dataset.k;
    let v = b.dataset.v;
    v = v === 'true' ? true : v === 'false' ? false : +v;
    store.data.settings[k] = v;
    store.save();
    applySettings();
    showSettings();
  }
});
$('#btn-pause').addEventListener('click', () => pause());
$('#btn-view').addEventListener('click', () => {
  if (!app.drill || app.drill.view !== 'los') return;
  app.assistView = world.view === 'los';
  world.setView(world.view === 'los' ? 'chase' : 'los');
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (app.state === 'flying') pause();
    else if (app.state === 'paused') resume();
  } else if (e.code === 'KeyR' && (app.state === 'flying' || app.state === 'paused')) startDrill(app.D.id, app.level);
  else if (e.code === 'KeyV' && app.state === 'flying') $('#btn-view').click();
  audio.unlock();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && app.state === 'flying') pause();
});

// ------------------------------------------------------------------ przebieg ćwiczenia
function setFlightUi(on) {
  hudEl.root.hidden = !on;
  input.setEnabled(on);
  $('#countdown').hidden = true;
  if (!on) releaseWake();
}

const ctx = {
  world,
  sim,
  wind,
  hud,
  input,
  telemetry,
  sticks: ZERO,
  freeze: false,
  variant: 0,
  buzz(ms) {
    vibrate(ms);
    audio.beep(990, 0.07);
  },
  respawnTo(spec) {
    sim.reset(spec);
    const manual = !MODES[sim.mode].centeringThrottle;
    if (manual) input.setHoldThrottle(spec.airborne ? 0 : -1);
    world._look.set(sim.p.x, sim.p.y, sim.p.z);
    world._chaseInit = false;
  },
};

// wibracja tylko po realnym dotknięciu ekranu (przeglądarki blokują ją wcześniej); iOS jej nie obsługuje
function vibrate(pattern) {
  if (!navigator.vibrate) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate(pattern);
}

let wakeLock = null;
async function acquireWake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {}
}
function releaseWake() {
  try {
    wakeLock && wakeLock.release();
  } catch (e) {}
  wakeLock = null;
}
async function immersive() {
  if (!coarse) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (e) {}
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) {}
}

function startDrill(id, level) {
  const D = drillById(id);
  app.D = D;
  app.level = level;
  immersive();
  acquireWake();
  audio.unlock();
  input.injected = null;
  world.clearDrill();
  hud.reset();
  telemetry.reset();
  input.sourcesUsed.clear();
  ctx.variant = store.data.variant;
  ctx.freeze = false;
  const drill = (app.drill = new D(level));
  sim.setDrone(drill.drone);
  sim.setMode(drill.mode);
  sim.vDamp = drill.cfg.assist || 0;
  input.setThrottleCentering(MODES[drill.mode].centeringThrottle);
  drill.setup(ctx);
  ctx.respawnTo(drill.start());
  world.setView(drill.view);
  app.assistView = false;
  hudEl.mode.textContent = MODES[drill.mode].label + (drill.cfg.assist ? ' + asysta' : '');
  // ściąga klawiszy (komputer): w trybach ręcznych gaz nie wraca sam — W/S go dodają i odejmują
  const manualThr = !MODES[drill.mode].centeringThrottle;
  hudEl.kbd.innerHTML =
    `<kbd>W</kbd><kbd>S</kbd> ${manualThr ? 'gaz: dodaj / ujmij (zostaje, gdzie go zostawisz)' : 'wysokość: w górę / w dół'} · <kbd>A</kbd><kbd>D</kbd> obrót<br>` +
    `<kbd>↑</kbd><kbd>↓</kbd> przód / tył · <kbd>←</kbd><kbd>→</kbd> lewo / prawo · <kbd>Shift</kbd> delikatnie<br>` +
    `<kbd>P</kbd> pauza · <kbd>R</kbd> od nowa${drill.view === 'los' ? ' · <kbd>V</kbd> widok' : ''}`;
  hudEl.osd.hidden = !(drill.view === 'fpv' || drill.view === 'cam');
  $('#btn-view').hidden = drill.view !== 'los';
  hideScreens();
  setFlightUi(true);
  app.acc = 0;
  app.crashT = 0;
  // odliczanie: czas na ułożenie kciuków
  app.state = 'countdown';
  app.cd = 2.4;
  hud.objective(D.goal);
}

function pause() {
  if (app.state !== 'flying') return;
  app.state = 'paused';
  input.setEnabled(false);
  showPause();
}
function resume() {
  hideScreens();
  input.setEnabled(true);
  app.state = 'countdown';
  app.cd = 1.6;
}

function endDrill() {
  const drill = app.drill;
  const res = drill.result(ctx);
  const used = [...input.sourcesUsed].filter((s) => s !== 'auto');
  const source = used.includes('radio') ? 'radio' : used.includes('gamepad') ? 'gamepad' : used.includes('touch') ? 'touch' : used[0] || (coarse ? 'touch' : 'keyboard');
  const rec = store.recordRun(app.D.id, app.level, res, source, drill.t);
  app.lastResult = res;
  if (res.stars >= 2) audio.chord([660, 880, 1320]);
  else if (res.completed) audio.chord([660, 880]);
  else audio.chord([330, 247]);
  showResult(res, rec);
}

function startAttract() {
  world.clearDrill();
  world.addPad(0, -12, 1.2);
  wind.set(1.2, 60, 0.3);
  sim.setDrone('trainer');
  sim.setMode('gps');
  sim.reset({ pos: { x: 4, y: 3, z: -12 }, heading: 0, airborne: true });
  input.setThrottleCentering(true);
  input.injected = { throttle: 0, yaw: 0.26, pitch: 0.34, roll: 0 };
  world.setView('los');
  world._look.set(4, 3, -12);
}

function checkRotate() {
  const needs = coarse && window.innerHeight > window.innerWidth && ['countdown', 'flying'].includes(app.state);
  $('#rotate').hidden = !needs;
  if (needs && app.state === 'flying') pause();
  return needs;
}

// ------------------------------------------------------------------ pętla
let last = performance.now();
let frameNo = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt, true);
}

// jeden krok gry; wywoływany z pętli animacji albo z testów (window.__fp.step)
function step(dt, render = true) {
  frameNo++;
  const sticks = input.update(dt);
  ctx.sticks = sticks;
  const st = app.state;

  if (st === 'wizard' && wizard) {
    wizard.update(dt);
    const gp = input.readGamepadRaw();
    const key = `${wizard.i}|${wizard.waitRelease}|${wizard.done}|${!!gp}`;
    if (key !== wizard._shown) renderWizard();
  }

  if (st === 'countdown') {
    if (!checkRotate()) app.cd -= dt;
    const el = $('#countdown');
    el.hidden = false;
    const n = Math.ceil(app.cd / 0.8);
    el.textContent = n > 0 ? String(n) : '';
    if (app.cd <= 0) {
      el.hidden = true;
      app.state = 'flying';
      audio.beep(1320, 0.12);
    }
  } else if (st === 'flying') {
    checkRotate();
    const drill = app.drill;
    drill.t += dt;
    if (sim.crashed) {
      if (app.crashT === 0) {
        drill.onCrash(ctx);
        hud.flash(sim.crashReason || 'Kraksa', 'bad', 1200);
        vibrate([30, 40, 60]);
        audio.beep(140, 0.3, 0.09);
      }
      app.crashT += dt;
      if (app.crashT > 1.15) {
        app.crashT = 0;
        ctx.respawnTo(drill.respawn(ctx));
      }
    } else {
      app.acc += dt;
      const s = ctx.freeze ? ZERO : sticks;
      while (app.acc >= PHYS_DT) {
        sim.step(PHYS_DT, s, wind.step(PHYS_DT));
        app.acc -= PHYS_DT;
      }
      if (!ctx.freeze) telemetry.sample(dt, sticks, sim);
      drill.update(dt, ctx);
      // granice pola treningowego
      const far = Math.hypot(sim.p.x - PILOT.x, sim.p.z - PILOT.z);
      if (far > 150 || sim.p.y > 90) sim.crash('Dron poza zasięgiem — utracono łączność');
      else if (far > 105 || sim.p.y > 60) hud.sub('Za daleko — zawróć, zanim stracisz zasięg');
    }
    hudEl.timer.textContent = fmt(drill.t);
    if (drill.t > drill.timeLimit && !drill.done) {
      hud.flash('Koniec czasu', 'info');
      drill.finish(false);
    }
    if (drill.done) endDrill();
  } else if (st !== 'paused') {
    // tło menu: dron krąży na autopilocie
    app.acc += dt;
    while (app.acc >= PHYS_DT) {
      sim.step(PHYS_DT, input.injected || ZERO, wind.step(PHYS_DT));
      app.acc -= PHYS_DT;
    }
    if (sim.crashed) startAttract();
  }

  // OSD + znaczniki
  if (st === 'flying' || st === 'countdown') {
    if (!hudEl.osd.hidden) {
      $('#osd-bat').textContent = `BAT ${Math.round(sim.battery * 100)}%`;
      $('#osd-thr').textContent = MODES[sim.mode].centeringThrottle ? '' : `GAZ ${Math.round(sim.throttle01 * 100)}%`;
      $('#osd-alt').textContent = `WYS ${fmt(sim.altitude)} m`;
      $('#osd-spd').textContent = `${Math.round(sim.speed * 3.6)} km/h`;
    }
    const srcTxt = SRC_LABEL[input.source] || '';
    if (hud._c.src !== srcTxt) {
      hud._c.src = srcTxt;
      hudEl.src.textContent = srcTxt;
      document.body.classList.toggle('src-pad', input.source === 'gamepad' || input.source === 'radio' || input.source === 'keyboard');
    }
    {
      const showKbd = !coarse && input.source !== 'gamepad' && input.source !== 'radio' && input.source !== 'auto';
      if (hudEl.kbd.hidden === showKbd) hudEl.kbd.hidden = !showKbd;
    }
    hud.update(dt);
  }

  world.setWindsock(wind.cur);
  world.update(sim, dt);
  const menuLike = st !== 'flying' && st !== 'countdown';
  if (render && (!menuLike || frameNo % 2 === 0)) world.render();
  const dist = Math.hypot(sim.p.x - PILOT.x, sim.p.y - PILOT.y, sim.p.z - PILOT.z);
  audio.update(sim.thrust / sim.tMax, world.view === 'los' ? dist : 2, st === 'flying' && !sim.crashed);
}

// ------------------------------------------------------------------ start
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('resize', checkRotate);
showMenu();
requestAnimationFrame(frame);

// interfejs testowy (autotesty w przeglądarce, przyszły „duch instruktora")
window.__fp = { app, sim, input, world, wind, store, telemetry, hud, ctx, step, startDrill, showMenu, drillById, DRILLS };
