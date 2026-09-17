// FuturePilot — postęp i ustawienia (localStorage, wszystko zostaje na urządzeniu)
import { DRILLS, SKILLS } from './drills.js';

const KEY = 'futurepilot.v1';
const DEFAULTS = {
  settings: { stickMode: 2, stickSize: 1, sound: true, zoomAssist: true, plumbAssist: true, quality: 1, courseMode: true },
  progress: {}, // { drillId: { level: { best, stars, runs, last } } }
  runs: [], // ostatnie przebiegi (do analizy uczenia się)
  totals: { flightSec: 0, runs: 0, sources: {} },
  variant: 0,
};

export const store = {
  data: JSON.parse(JSON.stringify(DEFAULTS)),
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw) {
        this.data = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...raw };
        this.data.settings = { ...DEFAULTS.settings, ...(raw.settings || {}) };
        this.data.totals = { ...DEFAULTS.totals, ...(raw.totals || {}) };
      }
    } catch (e) {}
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {}
  },
  reset() {
    const settings = this.data.settings;
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.data.settings = settings;
    this.save();
  },
  best(id, level) {
    return (this.data.progress[id] || {})[level] || null;
  },
  recordRun(id, level, result, source, duration) {
    const p = (this.data.progress[id] = this.data.progress[id] || {});
    const prev = p[level] || { best: 0, stars: 0, runs: 0 };
    const newBest = result.completed && result.score > prev.best;
    p[level] = {
      best: Math.max(prev.best, result.completed ? result.score : 0),
      stars: Math.max(prev.stars, result.stars),
      runs: prev.runs + 1,
      last: Date.now(),
    };
    this.data.runs.push({ t: Date.now(), id, level, score: result.score, stars: result.stars, ok: result.completed, src: source, dur: Math.round(duration), smooth: Math.round((result.summary?.smoothness || 0) * 100) });
    if (this.data.runs.length > 400) this.data.runs.splice(0, this.data.runs.length - 400);
    this.data.totals.runs++;
    this.data.totals.flightSec += duration;
    this.data.totals.sources[source] = (this.data.totals.sources[source] || 0) + 1;
    this.data.variant++;
    this.save();
    return { newBest, prevBest: prev.best };
  },
  // najwyższy dostępny poziom: kolejny odblokowuje się po 2 gwiazdkach na poprzednim
  unlocked(id) {
    const D = DRILLS.find((d) => d.id === id);
    if (!this.data.settings.courseMode) return D.levels.length;
    let l = 1;
    while (l < D.levels.length && ((this.best(id, l) || {}).stars || 0) >= 2) l++;
    return l;
  },
  recommended(id) {
    const D = DRILLS.find((d) => d.id === id);
    for (let l = 1; l <= D.levels.length; l++) if (((this.best(id, l) || {}).stars || 0) < 2) return l;
    return D.levels.length;
  },
  drillMastery(id) {
    const D = DRILLS.find((d) => d.id === id);
    let m = 0;
    for (let l = 1; l <= D.levels.length; l++) {
      const b = this.best(id, l);
      if (b && b.best > 0) m = Math.max(m, (l - 1 + Math.min(1, b.best / 100)) / D.levels.length);
    }
    return m;
  },
  skillMastery() {
    const out = {};
    for (const k of Object.keys(SKILLS)) {
      const ds = DRILLS.filter((d) => d.skill === k);
      out[k] = ds.length ? ds.reduce((a, d) => a + this.drillMastery(d.id), 0) / ds.length : 0;
    }
    return out;
  },
  lastPlayed(id) {
    const p = this.data.progress[id] || {};
    return Math.max(0, ...Object.values(p).map((x) => x.last || 0));
  },
  // „Trening dnia": najsłabsza umiejętność + najdawniej ćwiczone + ćwiczenie „na deser" (przeplatanie i odstępy)
  dailyPlan() {
    const mastery = this.skillMastery();
    const byWeak = [...DRILLS].sort((a, b) => this.drillMastery(a.id) - this.drillMastery(b.id) || mastery[a.skill] - mastery[b.skill]);
    const plan = [byWeak[0]];
    const byOld = [...DRILLS].filter((d) => !plan.includes(d)).sort((a, b) => this.lastPlayed(a.id) - this.lastPlayed(b.id));
    plan.push(byOld[0]);
    const fun = ['gates', 'orbit', 'eight'].map((id) => DRILLS.find((d) => d.id === id)).filter((d) => !plan.includes(d));
    plan.push(fun[this.data.totals.runs % fun.length]);
    // pierwszy kontakt zawsze zaczyna się od startu i wysokości
    if (this.data.totals.runs === 0) {
      const first = DRILLS.find((d) => d.id === 'alt');
      return [first, DRILLS.find((d) => d.id === 'square'), DRILLS.find((d) => d.id === 'gates')].map((d) => ({ id: d.id, level: 1 }));
    }
    return plan.map((d) => ({ id: d.id, level: this.recommended(d.id) }));
  },
};
