// FuturePilot — świat 3D (three.js): pole treningowe, dron, kamery, obiekty ćwiczeń.
import * as THREE from '../vendor/three.module.js';

const DEG = Math.PI / 180;
export const PILOT = new THREE.Vector3(0, 1.65, 0);

const COL = {
  zenith: new THREE.Color(0x3f7fd6),
  horizon: new THREE.Color(0xcfe3f2),
  haze: new THREE.Color(0xb9cfdd),
  grass: '#5f8c4c',
  apron: '#79a35f',
  target: 0x3ddc84,
  accent: 0xffb020,
  danger: 0xff5a4f,
};

function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.anisotropy = 4;
  return t;
}

// deterministyczny generator (powtarzalne rozmieszczenie dekoracji i tras)
export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.quality = 1;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COL.haze, 140, 750);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 2000);
    this.view = 'los';
    this.zoomAssist = true;
    this.uptilt = 12 * DEG;
    this._look = new THREE.Vector3(0, 1, -6);
    this._chasePos = new THREE.Vector3(0, 3, 4);
    this._tmp = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
    this.drillGroup = new THREE.Group();
    this.scene.add(this.drillGroup);

    this._buildSky();
    this._buildGround();
    this._buildScenery();
    this._buildDrone();
    this._buildPilot();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  resize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    const cap = this.quality >= 1 ? 2 : this.quality >= 0.75 ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildSky() {
    const g = new THREE.SphereGeometry(1500, 32, 16);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 1500;
      if (t >= 0) c.copy(COL.horizon).lerp(COL.zenith, Math.pow(Math.min(1, t * 1.6), 0.7));
      else c.copy(COL.haze);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(g, m);
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.sky = sky;

    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a6a3a, 1.15));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(-60, 120, 40);
    this.scene.add(sun);

    // kilka płaskich chmur — punkty odniesienia dla horyzontu w widoku FPV
    const rand = rng(7);
    const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, fog: false, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2,
        d = 500 + rand() * 600;
      const cl = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), cm);
      cl.scale.set(60 + rand() * 90, 9 + rand() * 8, 30 + rand() * 40);
      cl.position.set(Math.cos(a) * d, 170 + rand() * 120, Math.sin(a) * d);
      this.scene.add(cl);
    }
  }

  _buildGround() {
    const grass = canvasTex(
      512,
      (x, s) => {
        x.fillStyle = COL.grass;
        x.fillRect(0, 0, s, s);
        const rand = rng(3);
        for (let i = 0; i < 5200; i++) {
          const l = 34 + rand() * 16;
          x.fillStyle = `hsla(${96 + rand() * 18},${30 + rand() * 18}%,${l}%,0.35)`;
          x.fillRect(rand() * s, rand() * s, 1 + rand() * 3, 1 + rand() * 3);
        }
      },
      200
    );
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ map: grass }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // płyta treningowa: szachownica 5 m + linie co 1 m — kluczowe wskazówki ruchu i głębi
    const N = 16; // 16 x 5 m = 80 m
    const apron = canvasTex(1024, (x, s) => {
      const cell = s / N;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          x.fillStyle = (i + j) % 2 ? '#7dab62' : '#739f5a';
          x.fillRect(i * cell, j * cell, cell, cell);
        }
      x.strokeStyle = 'rgba(255,255,255,0.10)';
      x.lineWidth = 1;
      for (let i = 0; i <= N * 5; i++) {
        const p = (i * cell) / 5;
        x.beginPath();
        x.moveTo(p, 0);
        x.lineTo(p, s);
        x.moveTo(0, p);
        x.lineTo(s, p);
        x.stroke();
      }
      x.strokeStyle = 'rgba(255,255,255,0.85)';
      x.lineWidth = 6;
      x.strokeRect(3, 3, s - 6, s - 6);
    });
    const ap = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshLambertMaterial({ map: apron, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    );
    ap.rotation.x = -Math.PI / 2;
    ap.position.set(0, 0.01, -32);
    this.scene.add(ap);
  }

  _buildScenery() {
    const rand = rng(21);
    // drzewa (instancje)
    const n = 170;
    const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.4, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 1, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), n);
    const m4 = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      let x, z;
      do {
        const a = rand() * Math.PI * 2,
          d = 62 + rand() * 210;
        x = Math.cos(a) * d;
        z = -32 + Math.sin(a) * d;
      } while (Math.abs(x) < 46 && z > -78 && z < 14);
      const s = 2.2 + rand() * 3.2;
      m4.compose(new THREE.Vector3(x, s * 1.2 + s * 0.45, z), q, new THREE.Vector3(s, s, s));
      foliage.setMatrixAt(i, m4);
      c.setHSL(0.27 + rand() * 0.07, 0.42, 0.22 + rand() * 0.1);
      foliage.setColorAt(i, c);
      m4.compose(new THREE.Vector3(x, s * 0.35, z), q, new THREE.Vector3(s * 0.6, s * 0.9, s * 0.6));
      trunks.setMatrixAt(i, m4);
    }
    this.scene.add(foliage, trunks);

    // odległe wzgórza
    const hm = new THREE.MeshLambertMaterial({ color: 0x5d7f63 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand() * 0.4,
        d = 620 + rand() * 260;
      const h = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), hm);
      h.scale.set(190 + rand() * 160, 50 + rand() * 60, 190 + rand() * 120);
      h.position.set(Math.cos(a) * d, -12, Math.sin(a) * d);
      this.scene.add(h);
    }

    // hangar klubowy (punkt odniesienia za plecami pilota)
    const hangar = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 4.2, 10), new THREE.MeshLambertMaterial({ color: 0xd9dee6 }));
    wall.position.y = 2.1;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 16, 12, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x9aa7b8 }));
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.y = 4.2;
    roof.scale.set(1, 1, 0.45);
    const door = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 0.1), new THREE.MeshLambertMaterial({ color: 0x3c4a5e }));
    door.position.set(0, 1.6, -5.06);
    hangar.add(wall, roof, door);
    hangar.position.set(-26, 0, 22);
    hangar.rotation.y = 0.35;
    this.scene.add(hangar);

    // rękaw lotniczy — pokazuje kierunek i siłę wiatru (realna wskazówka dla pilota)
    const ws = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 5, 6), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
    pole.position.y = 2.5;
    const sock = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.14, 2.0, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0xff6a2b, side: THREE.DoubleSide }));
    cone.rotation.x = Math.PI / 2; // oś stożka wzdłuż -Z (szeroki koniec przy maszcie)
    cone.position.z = -1.0;
    sock.add(cone);
    sock.rotation.order = 'YXZ'; // najpierw kierunek wiatru (Y), potem opadanie (X)
    sock.position.y = 4.9;
    ws.add(pole, sock);
    ws.position.set(11, 0, -3);
    this.scene.add(ws);
    this.windsock = sock;
  }

  setWindsock(wind) {
    const sp = Math.hypot(wind.x, wind.z);
    const s = this.windsock;
    if (sp > 0.05) s.rotation.y = Math.atan2(-wind.x, -wind.z);
    // opadanie rękawa: bez wiatru wisi, przy ok. 6 m/s stoi poziomo
    s.rotation.x = -(1 - Math.min(1, sp / 6)) * 75 * DEG;
  }

  _buildDrone() {
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x20252d });
    const orange = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
    const light = new THREE.MeshLambertMaterial({ color: 0xe9edf2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.2), dark);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.12), orange);
    top.position.set(0, 0.035, -0.02);
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.05), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    cam.position.set(0, 0.01, -0.12);
    g.add(body, top, cam);
    const arm = new THREE.BoxGeometry(0.035, 0.018, 0.42);
    for (const a of [45, -45]) {
      const m = new THREE.Mesh(arm, dark);
      m.rotation.y = a * DEG;
      g.add(m);
    }
    const propMat = (col) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
    this.props = [];
    const d = 0.148;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const front = sz < 0;
      const duct = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.012, 6, 18), front ? orange : light);
      duct.rotation.x = Math.PI / 2;
      duct.position.set(sx * d, 0.02, sz * d);
      const prop = new THREE.Mesh(new THREE.CircleGeometry(0.09, 14), propMat(front ? 0xffc27a : 0xcfd6df));
      prop.rotation.x = -Math.PI / 2;
      prop.position.set(sx * d, 0.03, sz * d);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.035, 8), dark);
      motor.position.set(sx * d, 0.012, sz * d);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), new THREE.MeshBasicMaterial({ color: front ? 0xeaffea : 0xff2b2b, fog: false }));
      led.position.set(sx * d, -0.012, sz * d);
      g.add(duct, prop, motor, led);
      this.props.push(prop);
    }
    this.drone = g;
    this.droneScale = 1.7; // powiększenie wizualne kompensuje niską „rozdzielczość" ekranu telefonu względem oka
    this.scene.add(g);

    // cień-plama i linia pionu: wskazówki głębi w widoku z ziemi
    const st = canvasTex(128, (x, s) => {
      const gr = x.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.75)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, s, s);
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    this.scene.add(this.shadow);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
    this.plumb = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    this.scene.add(this.plumb);
    this.plumbAssist = true;
  }

  _buildPilot() {
    const g = new THREE.Group();
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.15, 8), new THREE.MeshLambertMaterial({ color: 0xffd23c }));
    vest.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshLambertMaterial({ color: 0xe0b48c }));
    head.position.y = 1.68;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x27303f }));
    legs.position.y = 0.25;
    g.add(vest, head, legs);
    g.position.set(PILOT.x, 0, PILOT.z);
    this.pilot = g;
    this.scene.add(g);
  }

  setView(view) {
    this.view = view;
    this.pilot.visible = view !== 'los';
    this._chaseInit = false;
  }

  // synchronizacja z symulacją + kamera
  update(sim, dt) {
    const d = this.drone;
    d.position.set(sim.p.x, sim.p.y, sim.p.z);
    d.quaternion.set(sim.q.x, sim.q.y, sim.q.z, sim.q.w);
    const sc = this.view === 'los' ? this.droneScale : 1;
    d.scale.setScalar(sc);
    d.visible = this.view === 'los' || this.view === 'chase';
    const spin = sim.landed && sim.thrust < 0.01 ? 0 : 1;
    for (const p of this.props) p.material.opacity = spin ? 0.42 : 0.9;

    const alt = Math.max(0, sim.p.y);
    this.shadow.position.set(sim.p.x, 0.03, sim.p.z);
    const ss = (0.55 + alt * 0.05) * (this.view === 'los' ? 1.6 : 1.1);
    this.shadow.scale.set(ss, ss, 1);
    this.shadow.material.opacity = Math.max(0.18, 0.9 - alt * 0.035);
    this.plumb.visible = this.plumbAssist && this.view !== 'fpv' && this.view !== 'cam' && alt > 0.4;
    this.plumb.position.set(sim.p.x, 0, sim.p.z);
    this.plumb.scale.set(1, alt, 1);

    const cam = this.camera;
    const k = 1 - Math.exp(-dt * 9);
    if (this.view === 'los') {
      cam.position.copy(PILOT);
      this._look.lerp(d.position, k);
      cam.up.set(0, 1, 0);
      cam.lookAt(this._look);
      const dist = cam.position.distanceTo(d.position);
      const fov = this.zoomAssist ? THREE.MathUtils.clamp(56 * Math.sqrt(11 / Math.max(dist, 11)), 17, 56) : 56;
      if (Math.abs(fov - cam.fov) > 0.05) {
        cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));
        cam.updateProjectionMatrix();
      }
    } else if (this.view === 'fpv') {
      this._setFov(88);
      cam.quaternion.copy(d.quaternion).multiply(this._tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.uptilt));
      cam.position.copy(d.position).add(this._tmp.set(0, 0.035, -0.1).applyQuaternion(d.quaternion));
    } else if (this.view === 'cam') {
      // kamera na gimbalu: stabilizowany horyzont, obrót tylko z kursem drona
      this._setFov(58);
      cam.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sim.heading).multiply(this._tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -7 * DEG));
      cam.position.copy(d.position).add(this._tmp.set(0, -0.02, 0));
    } else {
      // chase — kółka boczne na pierwsze minuty
      this._setFov(62);
      const fx = -Math.sin(sim.heading),
        fz = -Math.cos(sim.heading);
      const want = this._tmp.set(sim.p.x - fx * 3.4, sim.p.y + 1.5, sim.p.z - fz * 3.4);
      if (!this._chaseInit) {
        this._chasePos.copy(want);
        this._chaseInit = true;
      }
      this._chasePos.lerp(want, 1 - Math.exp(-dt * 5));
      cam.position.copy(this._chasePos);
      cam.up.set(0, 1, 0);
      cam.lookAt(sim.p.x + fx * 2, sim.p.y + 0.2, sim.p.z + fz * 2);
    }
  }

  _setFov(f) {
    if (this.camera.fov !== f) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // pozycja ekranu dla wskaźników celu; zwraca {x,y,behind}
  toScreen(v) {
    const p = this._tmp.copy(v).project(this.camera);
    const behind = p.z > 1;
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, behind };
  }

  clearDrill() {
    const g = this.drillGroup;
    while (g.children.length) {
      const o = g.children.pop();
      o.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) {
          if (n.material.map) n.material.map.dispose();
          n.material.dispose();
        }
      });
    }
  }

  // ---------- obiekty ćwiczeń ----------
  addPad(x, z, r = 0.9, label = 'H') {
    const tex = canvasTex(256, (c, s) => {
      c.fillStyle = '#2b3442';
      c.beginPath();
      c.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#ffb020';
      c.lineWidth = 12;
      c.beginPath();
      c.arc(s / 2, s / 2, s / 2 - 14, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.18, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#fff';
      c.font = `bold ${s * 0.42}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, s / 2, s / 2 + 6);
    });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.025, z);
    this.drillGroup.add(pad);
    return pad;
  }

  // strefa docelowa: półprzezroczysty walec (x,z), wysokości y0..y1
  addZone(x, z, r, y0, y1, color = COL.target) {
    const g = new THREE.Group();
    const h = y1 - y0;
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 28, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    shell.position.y = y0 + h / 2;
    const ringG = new THREE.TorusGeometry(r, 0.035, 6, 40);
    const ringM = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const r1 = new THREE.Mesh(ringG, ringM),
      r2 = new THREE.Mesh(ringG, ringM);
    r1.rotation.x = r2.rotation.x = Math.PI / 2;
    r1.position.y = y0;
    r2.position.y = y1;
    const foot = new THREE.Mesh(new THREE.RingGeometry(r * 0.92, r, 36), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    foot.rotation.x = -Math.PI / 2;
    foot.position.y = 0.04;
    g.add(shell, r1, r2, foot);
    g.position.set(x, 0, z);
    g.userData = { shell, ringM, footM: foot.material };
    this.drillGroup.add(g);
    return g;
  }

  setZoneColor(zone, color, opacity = 0.16) {
    zone.userData.shell.material.color.setHex(color);
    zone.userData.shell.material.opacity = opacity;
    zone.userData.ringM.color.setHex(color);
    zone.userData.footM.color.setHex(color);
  }

  addBox(cx, cy, cz, w, h, d, color = COL.target) {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
    const faces = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }));
    const foot = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
    foot.rotation.x = -Math.PI / 2;
    foot.position.y = -cy + 0.04;
    g.add(edges, faces, foot);
    g.position.set(cx, cy, cz);
    g.userData = { edges, faces, foot };
    this.drillGroup.add(g);
    return g;
  }

  setBoxColor(box, color) {
    box.userData.edges.material.color.setHex(color);
    box.userData.faces.material.color.setHex(color);
    box.userData.foot.material.color.setHex(color);
  }

  addGate(x, y, z, heading, inner = 3, number = 0) {
    const g = new THREE.Group();
    const t = 0.22;
    const mat = new THREE.MeshLambertMaterial({ color: 0xf2f4f7, emissive: 0x000000 });
    const mk = (w, h, px, py) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
      m.position.set(px, py, 0);
      g.add(m);
    };
    const o = inner / 2 + t / 2;
    mk(inner + 2 * t, t, 0, o);
    mk(inner + 2 * t, t, 0, -o);
    mk(t, inner, -o, 0);
    mk(t, inner, o, 0);
    // nogi do ziemi
    const legH = Math.max(0, y - inner / 2 - t);
    if (legH > 0.05) {
      const lm = new THREE.MeshLambertMaterial({ color: 0x8c96a5 });
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, legH, 0.1), lm);
        leg.position.set(sx * o, -inner / 2 - t - legH / 2, 0);
        g.add(leg);
      }
    }
    if (number) {
      const tex = canvasTex(128, (c, s) => {
        c.fillStyle = '#1b2433';
        c.fillRect(0, 0, s, s);
        c.fillStyle = '#fff';
        c.font = `bold ${s * 0.7}px system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(number), s / 2, s / 2 + 4);
      });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      flag.position.set(0, o + t / 2 + 0.45, 0);
      g.add(flag);
    }
    g.position.set(x, y, z);
    g.rotation.y = heading;
    g.userData = { mat, inner, t, heading };
    this.drillGroup.add(g);
    return g;
  }

  setGateState(gate, state) {
    const m = gate.userData.mat;
    if (state === 'next') {
      m.color.setHex(0xffb020);
      m.emissive.setHex(0x7a4a00);
    } else if (state === 'done') {
      m.color.setHex(0x3ddc84);
      m.emissive.setHex(0x0c4a26);
    } else {
      m.color.setHex(0xf2f4f7);
      m.emissive.setHex(0x000000);
    }
  }

  addPylon(x, z, h = 4, color = 0xff5a4f) {
    const g = new THREE.Group();
    const seg = 4;
    for (let i = 0; i < seg; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, h / seg, 10), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xffffff : color }));
      m.position.y = (i + 0.5) * (h / seg);
      g.add(m);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color }));
    ball.position.y = h + 0.2;
    g.add(ball);
    g.position.set(x, 0, z);
    g.userData = { r: 0.35, h: h + 0.5 };
    this.drillGroup.add(g);
    return g;
  }

  addTower(x, z, h = 14) {
    const g = new THREE.Group();
    const seg = 7;
    for (let i = 0; i < seg; i++) {
      const r0 = 1.3 - (i / seg) * 0.5,
        r1 = 1.3 - ((i + 1) / seg) * 0.5;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h / seg, 14), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xf4f4f4 : 0xd8422f }));
      m.position.y = (i + 0.5) * (h / seg);
      g.add(m);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    lamp.position.y = h + 0.3;
    g.add(lamp);
    g.position.set(x, 0, z);
    g.userData = { r: 1.5, h: h + 0.6 };
    this.drillGroup.add(g);
    return g;
  }

  addCheckpoint(x, y, z, r = 1.8) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 36), new THREE.MeshBasicMaterial({ color: COL.accent, transparent: true, opacity: 0.95 }));
    const fill = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), new THREE.MeshBasicMaterial({ color: COL.accent, transparent: true, opacity: 0.12, depthWrite: false }));
    const g = new THREE.Group();
    g.add(m, fill);
    g.position.set(x, y, z);
    g.userData = { ring: m, fill, r };
    this.drillGroup.add(g);
    return g;
  }

  // strzałka na ziemi wskazująca przód drona / kierunek zadania
  addGroundArrow(color = 0xffffff) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.9);
    shape.lineTo(0.55, 0.1);
    shape.lineTo(0.2, 0.1);
    shape.lineTo(0.2, -0.8);
    shape.lineTo(-0.2, -0.8);
    shape.lineTo(-0.2, 0.1);
    shape.lineTo(-0.55, 0.1);
    shape.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; // kształt „w górę" (+Y) → -Z świata
    const g = new THREE.Group();
    g.add(m);
    g.position.y = 0.05;
    this.drillGroup.add(g);
    return g;
  }
}

export { THREE, COL };
