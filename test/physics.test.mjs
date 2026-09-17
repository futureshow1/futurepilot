// Testy modelu lotu: node test/physics.test.mjs
import { DroneSim, Wind, DRONES, G, actualRate } from '../js/physics.js';

const DT = 1 / 240;
let failed = 0;
const ok = (name, cond, info = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!cond) failed++;
};
const run = (sim, secs, sticksFn, wind) => {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) sim.step(DT, sticksFn(i * DT, sim), wind ? wind.step(DT) : undefined);
};
const Z = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

// 1. GPS: start, wznoszenie, zawis
{
  const s = new DroneSim('trainer'); s.setMode('gps'); s.reset({});
  run(s, 2.0, () => ({ ...Z, throttle: 1 }));
  const yAfterClimb = s.p.y;
  run(s, 3.0, () => Z);
  const y1 = s.p.y; run(s, 3.0, () => Z);
  ok('GPS wznoszenie ~3 m/s', yAfterClimb > 3.5 && yAfterClimb < 6.5, `y=${yAfterClimb.toFixed(2)}`);
  ok('GPS zawis trzyma wysokość', Math.abs(s.p.y - y1) < 0.02 && Math.abs(s.v.y) < 0.02, `dy=${(s.p.y - y1).toFixed(4)}`);
}
// 2. GPS: prędkość maks. do przodu i hamowanie
{
  const s = new DroneSim('trainer'); s.setMode('gps'); s.reset({ pos: { x: 0, y: 5, z: 0 }, airborne: true });
  run(s, 6.0, () => ({ ...Z, pitch: 1 }));
  const vmax = s.hSpeed, zf = s.p.z;
  ok('GPS leci do przodu (-Z)', zf < -20, `z=${zf.toFixed(1)}`);
  ok('GPS vmax ~7.5 m/s', vmax > 6.3 && vmax < 8.0, `v=${vmax.toFixed(2)}`);
  run(s, 4.0, () => Z);
  ok('GPS hamuje do zera', s.hSpeed < 0.1, `v=${s.hSpeed.toFixed(3)}`);
  ok('GPS trzyma wysokość w locie', Math.abs(s.p.y - 5) < 0.4, `y=${s.p.y.toFixed(2)}`);
}
// 3. GPS: utrzymanie pozycji w wietrze 5 m/s z porywami
{
  const s = new DroneSim('trainer'); s.setMode('gps'); s.reset({ pos: { x: 0, y: 4, z: 0 }, airborne: true });
  const w = new Wind(); w.set(5, 90, 1.2);
  run(s, 12, () => Z, w);
  const d = Math.hypot(s.p.x, s.p.z);
  ok('GPS trzyma pozycję w wietrze', d < 1.2, `dryf=${d.toFixed(2)} m`);
}
// 4. ANGLE: gaz w połowie = zawis (trener)
{
  const s = new DroneSim('trainer'); s.setMode('angle'); s.reset({ pos: { x: 0, y: 10, z: 0 }, airborne: true });
  run(s, 3, () => ({ ...Z, throttle: 0 }));
  ok('ANGLE zawis przy 50% gazu', Math.abs(s.v.y) < 0.15, `vy=${s.v.y.toFixed(3)}`);
  // pełny przechył do przodu, gaz dobrany do utrzymania wysokości ~ 1/cos(35°)
  const s2 = new DroneSim('trainer'); s2.setMode('angle'); s2.reset({ pos: { x: 0, y: 30, z: 0 }, airborne: true });
  const u = Math.pow(1 / (3.0 * Math.cos(35 * Math.PI / 180)), 1 / 1.585); // gaz 0..1
  run(s2, 8, () => ({ ...Z, pitch: 1, throttle: u * 2 - 1 }));
  ok('ANGLE vmax ~8 m/s przy 35°', s2.hSpeed > 7 && s2.hSpeed < 9.5, `v=${s2.hSpeed.toFixed(2)} tilt=${(s2.tilt * 57.3).toFixed(1)}°`);
  // puszczenie drążka: poziomuje się, ale NIE hamuje aktywnie
  run(s2, 1.0, () => ({ ...Z, throttle: 0 }));
  ok('ANGLE poziomuje po puszczeniu', s2.tilt < 3 * Math.PI / 180, `tilt=${(s2.tilt * 57.3).toFixed(2)}°`);
  ok('ANGLE nadal płynie po puszczeniu', s2.hSpeed > 3, `v=${s2.hSpeed.toFixed(2)}`);
}
// 5. ALT: dryf z wiatrem (brak trzymania pozycji)
{
  const s = new DroneSim('trainer'); s.setMode('alt'); s.reset({ pos: { x: 0, y: 3, z: 0 }, airborne: true });
  const w = new Wind(); w.set(3, 90, 0);
  run(s, 6, () => Z, w);
  ok('ALT znosi z wiatrem', Math.hypot(s.p.x, s.p.z) > 5, `dryf=${Math.hypot(s.p.x, s.p.z).toFixed(1)} m`);
  ok('ALT trzyma wysokość', Math.abs(s.p.y - 3) < 0.15, `y=${s.p.y.toFixed(2)}`);
}
// 6. ACRO: prędkości kątowe i pełny obrót
{
  ok('Actual rates: pełne wychylenie = max', Math.abs(actualRate(1, 130, 520, 0.45) - 520) < 1e-6);
  ok('Actual rates: środek ~center', Math.abs(actualRate(0.1, 130, 520, 0.45) / 0.1 - 130) < 25, `${(actualRate(0.1, 130, 520, 0.45) / 0.1).toFixed(1)}`);
  const s = new DroneSim('trainer'); s.setMode('acro'); s.reset({ pos: { x: 0, y: 50, z: 0 }, airborne: true });
  run(s, 0.5, () => ({ ...Z, roll: 1, throttle: 0 }));
  ok('ACRO roll osiąga ~520°/s', Math.abs(Math.abs(s.w.z) * 57.3 - 520) < 15, `${(s.w.z * 57.3).toFixed(0)}°/s`);
  // po puszczeniu drążka przechył ZOSTAJE (brak samopoziomowania)
  const s3 = new DroneSim('trainer'); s3.setMode('acro'); s3.reset({ pos: { x: 0, y: 50, z: 0 }, airborne: true });
  run(s3, 0.25, () => ({ ...Z, pitch: 0.5, throttle: 0 }));
  run(s3, 1.0, () => ({ ...Z, throttle: 0 }));
  ok('ACRO nie poziomuje się sam', s3.tilt > 10 * Math.PI / 180, `tilt=${(s3.tilt * 57.3).toFixed(1)}°`);
}
// 7. Obrót (yaw) w prawo: heading maleje (zgodnie z zegarem z góry), przód skręca ku +X
{
  const s = new DroneSim('trainer'); s.setMode('gps'); s.reset({ pos: { x: 0, y: 5, z: 0 }, airborne: true });
  run(s, 0.8, () => ({ ...Z, yaw: 1 }));
  const f = s.forward;
  ok('Yaw w prawo: przód skręca ku +X', f.x > 0.5, `f=(${f.x.toFixed(2)},${f.z.toFixed(2)})`);
  const s2 = new DroneSim('trainer'); s2.setMode('gps'); s2.reset({ pos: { x: 0, y: 5, z: 0 }, airborne: true });
  run(s2, 2, () => ({ ...Z, roll: 1 }));
  ok('Roll w prawo: lot ku +X', s2.p.x > 5 && Math.abs(s2.p.z) < 0.5, `x=${s2.p.x.toFixed(1)} z=${s2.p.z.toFixed(2)}`);
}
// 8. Lądowanie i kraksa
{
  const s = new DroneSim('trainer'); s.setMode('gps'); s.reset({ pos: { x: 0, y: 3, z: 0 }, airborne: true });
  run(s, 8, () => ({ ...Z, throttle: -1 }));
  ok('GPS miękkie lądowanie', s.landed && !s.crashed, `td=${(s.touchdownSpeed || 0).toFixed(2)} m/s`);
  const s2 = new DroneSim('trainer'); s2.setMode('angle'); s2.reset({ pos: { x: 0, y: 12, z: 0 }, airborne: true });
  run(s2, 4, () => ({ ...Z, throttle: -1 }));
  ok('ANGLE upadek z 12 m = kraksa', s2.crashed, s2.crashReason);
  // ponowny start po lądowaniu
  run(s, 2, () => ({ ...Z, throttle: 1 }));
  ok('GPS ponowny start', !s.landed && s.p.y > 1, `y=${s.p.y.toFixed(2)}`);
}
// 9. Dron z kamerą
{
  const s = new DroneSim('camera'); s.setMode('gps'); s.reset({ pos: { x: 0, y: 10, z: 0 }, airborne: true });
  run(s, 8, () => ({ ...Z, pitch: 1 }));
  ok('KAMERA vmax ~6-7 m/s', s.hSpeed > 5.5 && s.hSpeed < 7.5, `v=${s.hSpeed.toFixed(2)}`);
  const s2 = new DroneSim('camera'); s2.setMode('angle'); s2.reset({ pos: { x: 0, y: 10, z: 0 }, airborne: true });
  const uh = Math.pow(1 / DRONES.camera.twr, 1 / DRONES.camera.thrustExp);
  run(s2, 3, () => ({ ...Z, throttle: uh * 2 - 1 }));
  ok('KAMERA zawis przy wyliczonym gazie', Math.abs(s2.v.y) < 0.2, `gaz=${(uh * 100).toFixed(0)}% vy=${s2.v.y.toFixed(3)}`);
}
console.log(failed ? `\n${failed} test(y) NIE przeszły` : '\nWszystkie testy przeszły');
process.exit(failed ? 1 : 0);
