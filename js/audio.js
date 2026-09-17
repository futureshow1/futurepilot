// FuturePilot — dźwięk silników (Web Audio). Słuch to realny kanał informacji o gazie, zwłaszcza w locie z ziemi.
export class MotorAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  unlock() {
    if (this.ctx || !this.enabled) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 1500;
    this.lp.connect(this.master);
    this.master.connect(c.destination);
    this.osc = [];
    for (const [type, mul, g] of [['sawtooth', 1, 0.5], ['sawtooth', 1.013, 0.4], ['square', 0.5, 0.25]]) {
      const o = c.createOscillator();
      o.type = type;
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(this.lp);
      o.start();
      this.osc.push({ o, mul });
    }
  }
  setEnabled(on) {
    this.enabled = on;
    if (!on && this.master) this.master.gain.value = 0;
  }
  update(thrustFrac, dist, active) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const u = Math.max(0, Math.min(1, thrustFrac));
    const f = 150 + 460 * Math.sqrt(u);
    for (const { o, mul } of this.osc) o.frequency.setTargetAtTime(f * mul, t, 0.03);
    const att = 1 / (1 + dist / 9);
    const g = active && u > 0.005 ? (0.018 + 0.05 * u) * (0.35 + 0.65 * att) : 0;
    this.master.gain.setTargetAtTime(g, t, 0.05);
    this.lp.frequency.setTargetAtTime(900 + 1600 * u, t, 0.05);
  }
  beep(freq = 880, dur = 0.08, vol = 0.06) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx,
      t = c.currentTime;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  chord(freqs, dur = 0.35) {
    freqs.forEach((f, i) => setTimeout(() => this.beep(f, dur, 0.05), i * 90));
  }
}
