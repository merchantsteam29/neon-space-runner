// Neon Void Runner — first-person neon space platformer
// Plain ES module, Three.js 0.160 via import map. No build step.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------- constants
const PLAYER_R = 0.35, PLAYER_H = 1.7, EYE = 1.55;
const MOVE_SPEED = 7.2, JUMP_V = 9.2, AIR_JUMP_V = 8.8, GRAVITY = 24;
const FIRE_RATE = 0.16, SHIELD_MAX = 100, BOLT_DMG = 34;
const STEP = 1 / 120;
const MOUSE_SENS = 0.0022, TOUCH_SENS = 0.0058;
const START_LIVES = 3;

const V3 = THREE.Vector3;
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = THREE.MathUtils.clamp;

let touchMode = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', touchMode);

function loadBest() { try { return +localStorage.getItem('nvr_best') || 0; } catch { return 0; } }
function saveBest(v) { try { localStorage.setItem('nvr_best', String(v)); } catch { /* ignore */ } }
function loadMuted() { try { return localStorage.getItem('nvr_muted') === '1'; } catch { return false; } }
function saveMuted(v) { try { localStorage.setItem('nvr_muted', v ? '1' : '0'); } catch { /* ignore */ } }

// ---------------------------------------------------------------- renderer
const canvas = $('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('title').classList.add('hidden');
  $('err').classList.remove('hidden');
  throw e;
}
const maxPR = () => Math.min(devicePixelRatio || 1, touchMode ? 1.25 : 1.75);
renderer.setPixelRatio(maxPR());
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05010f);
scene.fog = new THREE.FogExp2(0x0a0322, 0.009);

const BASE_FOV = 78;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.45, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

scene.add(new THREE.HemisphereLight(0x9a7bff, 0x12002a, 0.75));
const sun = new THREE.DirectionalLight(0xff9bf5, 0.9);
sun.position.set(30, 60, 20);
scene.add(sun);

// ---------------------------------------------------------------- textures
function makeGlowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function makeGridTex() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(0, 0, s, s);
  g.globalAlpha = 0.3; g.lineWidth = 2;
  g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = makeGlowTex();
const gridTex = makeGridTex();

// ---------------------------------------------------------------- background (follows camera position)
const bg = new THREE.Group();
scene.add(bg);
{
  const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const v = new V3().randomDirection().multiplyScalar(rand(380, 600));
    pos.set([v.x, v.y, v.z], i * 3);
    c.setHSL(rand(0.5, 0.95), 0.8, rand(0.6, 0.95));
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false });
  bg.add(new THREE.Points(g, m));

  const planetMat = new THREE.ShaderMaterial({
    fog: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vO;
      void main(){ vO = normal; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vO;
      void main(){ float rim = pow(1.0 - max(dot(vN,vV),0.0), 3.0);
        float band = sin(vO.y*14.0 + sin(vO.x*3.0)*1.5)*0.5+0.5;
        vec3 base = mix(vec3(0.05,0.0,0.12), vec3(0.32,0.02,0.36), band*0.7 + vO.y*0.2);
        gl_FragColor = vec4(base + vec3(0.2,0.6,1.0)*rim*0.9, 1.0); }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), planetMat);
  planet.position.set(-190, 60, -340);
  bg.add(planet);
  const ring = new THREE.Mesh(new THREE.RingGeometry(95, 135, 96),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.25, 1.1), transparent: true, opacity: 0.14, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.copy(planet.position);
  ring.rotation.set(1.25, 0.2, 0.3);
  bg.add(ring);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), planetMat);
  moon.position.set(220, 110, -260);
  bg.add(moon);
}
const floorGrid = new THREE.GridHelper(1400, 140, 0xff3df2, 0x6a2cff);
floorGrid.material.transparent = true;
floorGrid.material.opacity = 0.45;
scene.add(floorGrid);

// ---------------------------------------------------------------- shared geometry/materials
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitEdges = new THREE.EdgesGeometry(unitBox);

const starGeo = (() => {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.2 : 0.48, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    i ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  g.center();
  return g;
})();
const starMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb000, emissiveIntensity: 1.7, metalness: 0.3, roughness: 0.3 });

const droneCoreGeo = new THREE.IcosahedronGeometry(0.55, 0);
const droneRingGeo = new THREE.TorusGeometry(0.85, 0.05, 8, 40);
const droneEyeGeo = new THREE.SphereGeometry(0.17, 12, 8);
const droneCoreMat = new THREE.MeshStandardMaterial({ color: 0x24000f, emissive: 0xff1f6a, emissiveIntensity: 0.6, flatShading: true, metalness: 0.6, roughness: 0.35 });
const droneRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.3, 1.4) });
const droneEyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.2) });

const boltGeo = new THREE.SphereGeometry(0.2, 10, 8);
const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.35, 1.6) });

const beamGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);

// ---------------------------------------------------------------- audio (WebAudio synth, no files)
const AudioSys = {
  ctx: null, master: null, sfxBus: null, musicBus: null, noiseBuf: null,
  muted: loadMuted(), playing: false, tempo: 112, nextNote: 0, step: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.7; this.master.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.6; this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
    setInterval(() => this.schedule(), 25);
  },
  setMuted(m) {
    this.muted = m; saveMuted(m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.02);
  },
  tone(f, dur, { type = 'sine', vol = 0.2, to = null, delay = 0, at = null, out = null, attack = 0.005, cutoff = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = at ?? c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (cutoff) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff; fl.Q.value = 4; o.connect(fl); node = fl; }
    node.connect(g); g.connect(out || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  },
  noise(dur, { vol = 0.2, freq = 2000, type = 'lowpass', to = null, delay = 0, at = null, out = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = at ?? c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out || this.sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  },
  // --- music: synthwave loop, 4 bars Am F C G
  schedule() {
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime;
    if (this.nextNote < now - 0.2) this.nextNote = now + 0.05;
    while (this.nextNote < now + 0.12) {
      this.playStep(this.step, this.nextNote);
      this.nextNote += 60 / this.tempo / 4;
      this.step = (this.step + 1) % 64;
    }
  },
  playStep(s, t) {
    const roots = [110, 87.31, 130.81, 98], chords = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
    const bar = Math.floor(s / 16), st = s % 16, root = roots[bar], ch = chords[bar], out = this.musicBus;
    if (st % 4 === 0) this.tone(150, 0.28, { to: 40, vol: 0.55, at: t, out });
    if (st % 4 === 2) this.noise(0.04, { vol: 0.07, freq: 7000, type: 'highpass', at: t, out });
    if (st === 4 || st === 12) this.noise(0.16, { vol: 0.14, freq: 1800, type: 'bandpass', at: t, out });
    if (st % 2 === 0) this.tone(st % 4 === 2 ? root : root / 2, 0.22, { type: 'sawtooth', vol: 0.2, at: t, out, cutoff: 520 });
    const semi = ch[st % 3] + (Math.floor(st / 3) % 2 ? 12 : 0);
    this.tone(root * 2 * Math.pow(2, semi / 12), 0.14, { type: 'square', vol: 0.045, at: t, out, cutoff: 2600 });
    if (st === 0) this.tone(root * 4 * Math.pow(2, ch[2] / 12), 1.6, { type: 'triangle', vol: 0.05, at: t, out, attack: 0.3 });
  },
};
const SFX = {
  shoot() { AudioSys.tone(900, 0.12, { type: 'square', vol: 0.12, to: 180, cutoff: 3500 }); AudioSys.noise(0.05, { vol: 0.08, freq: 5000, type: 'highpass' }); },
  jump() { AudioSys.tone(320, 0.16, { type: 'sine', vol: 0.22, to: 640 }); },
  dbl() { AudioSys.tone(520, 0.2, { type: 'triangle', vol: 0.22, to: 1200 }); AudioSys.noise(0.15, { vol: 0.06, freq: 3000, type: 'bandpass', to: 6000 }); },
  land() { AudioSys.noise(0.08, { vol: 0.12, freq: 500 }); },
  star() { [880, 1175, 1568].forEach((f, i) => AudioSys.tone(f, 0.18, { vol: 0.16, delay: i * 0.05 })); },
  hitDrone() { AudioSys.tone(300, 0.08, { type: 'square', vol: 0.1, to: 150 }); },
  boom() { AudioSys.noise(0.55, { vol: 0.35, freq: 1400, to: 80 }); AudioSys.tone(130, 0.45, { vol: 0.35, to: 35 }); },
  droneShot(v) { AudioSys.tone(700, 0.14, { type: 'sawtooth', vol: 0.05 * v, to: 260, cutoff: 1800 }); },
  hurt() { AudioSys.tone(220, 0.28, { type: 'sawtooth', vol: 0.2, to: 70, cutoff: 1200 }); AudioSys.noise(0.2, { vol: 0.15, freq: 900 }); },
  die() { [440, 330, 247, 165].forEach((f, i) => AudioSys.tone(f, 0.25, { type: 'square', vol: 0.12, delay: i * 0.12, cutoff: 1500 })); },
  crumble() { AudioSys.noise(0.3, { vol: 0.12, freq: 800, type: 'bandpass', to: 200 }); },
  portal() { AudioSys.tone(200, 0.9, { type: 'sawtooth', vol: 0.14, to: 1600, cutoff: 3000 }); [523, 659, 784, 1047].forEach((f, i) => AudioSys.tone(f, 0.3, { vol: 0.14, delay: 0.3 + i * 0.08 })); },
  gameover() { [392, 330, 262, 196].forEach((f, i) => AudioSys.tone(f, 0.5, { type: 'triangle', vol: 0.2, delay: i * 0.22 })); },
  click() { AudioSys.tone(660, 0.06, { type: 'square', vol: 0.06, cutoff: 3000 }); },
};

// ---------------------------------------------------------------- game state
let state = 'title';           // title | playing | transition | gameover
let manualPause = false, locked = false;
let level = 1, score = 0, lives = START_LIVES, kills = 0, starsCollected = 0, best = loadBest();
let simTime = 0, wallTime = 0, transitionT = 0, accum = 0;
let diff = {};
let levelMinY = 0;
const levelCenter = new V3();

const player = {
  pos: new V3(), vel: new V3(), yaw: 0, pitch: 0, onGround: false, ground: null,
  jumps: 2, coyote: 0, shield: SHIELD_MAX, invuln: 0, sinceHit: 99, lastSafe: new V3(),
};

let levelGroup = new THREE.Group();
scene.add(levelGroup);
const disposables = [];
const platforms = [], stars = [], drones = [], bolts = [], beams = [];
let portal = null, starsTotal = 0, starsGot = 0;

// ---------------------------------------------------------------- viewmodel (astronaut blaster)
const gun = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a84b8, metalness: 0.55, roughness: 0.35, emissive: 0x1a1430 });
  const glove = new THREE.MeshStandardMaterial({ color: 0xdedbe8, metalness: 0.1, roughness: 0.7 });
  const glowC = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.8, 1.1) });
  const glowP = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.15, 0.9) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.36), metal); body.position.z = 0.03; gun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.28, 12), metal);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015, -0.34); gun.add(barrel);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.128, 0.012, 0.18), glowC); strip.position.set(0, 0.04, 0.02); gun.add(strip);
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.12), glowP); cell.position.set(0.07, -0.01, 0.06); gun.add(cell);
  const tip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 20), glowC); tip.position.set(0, 0.015, -0.48); gun.add(tip);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.16), glove); hand.position.set(0, -0.1, 0.12); hand.rotation.x = 0.3; gun.add(hand);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 14), glowC); cuff.rotation.x = Math.PI / 2 + 0.3; cuff.position.set(0, -0.14, 0.22); gun.add(cuff);
}
const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.015, -0.5); gun.add(muzzle);
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.5, 3, 4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
flash.scale.setScalar(0.35); flash.visible = false; muzzle.add(flash);
gun.position.set(0.26, -0.25, -0.52);
gun.visible = false;
camera.add(gun);

// ---------------------------------------------------------------- particles (single pooled Points object)
const MAXP = 900;
const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
const pData = Array.from({ length: MAXP }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, grav: 0 }));
let pIdx = 0;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.28, map: glowTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
particles.frustumCulled = false;
scene.add(particles);

function emit(pos, count, color, speed = 6, life = 0.7, grav = 6) {
  for (let i = 0; i < count; i++) {
    const p = pData[pIdx], k = pIdx * 3;
    pIdx = (pIdx + 1) % MAXP;
    const d = new V3().randomDirection().multiplyScalar(speed * rand(0.3, 1));
    pPos[k] = pos.x; pPos[k + 1] = pos.y; pPos[k + 2] = pos.z;
    p.vx = d.x; p.vy = d.y; p.vz = d.z; p.life = p.max = life * rand(0.6, 1.2); p.grav = grav;
    p.r = color.r; p.g = color.g; p.b = color.b;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    const p = pData[i], k = i * 3;
    if (p.life <= 0) { pCol[k] = pCol[k + 1] = pCol[k + 2] = 0; continue; }
    p.life -= dt;
    p.vy -= p.grav * dt;
    const drag = Math.exp(-dt * 2);
    p.vx *= drag; p.vy *= drag; p.vz *= drag;
    pPos[k] += p.vx * dt; pPos[k + 1] += p.vy * dt; pPos[k + 2] += p.vz * dt;
    const f = Math.max(0, p.life / p.max);
    pCol[k] = p.r * f; pCol[k + 1] = p.g * f; pCol[k + 2] = p.b * f;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}
const C_CYAN = new THREE.Color(0.4, 2, 3), C_PINK = new THREE.Color(2.5, 0.4, 2), C_GOLD = new THREE.Color(3, 2, 0.4), C_ORANGE = new THREE.Color(3, 1, 0.2);

// ---------------------------------------------------------------- level building
function clearLevel() {
  scene.remove(levelGroup);
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  for (const d of disposables) d.dispose();
  disposables.length = 0;
  platforms.length = stars.length = drones.length = bolts.length = 0;
  for (const b of beams) { scene.remove(b.mesh); b.mesh.material.dispose(); }
  beams.length = 0;
  portal = null;
}

function addPlatform(x, top, z, w, d, col, sideMat, bottomMat, t = 0.6) {
  const tex = gridTex.clone();
  tex.repeat.set(Math.max(1, Math.round(w / 1.4)), Math.max(1, Math.round(d / 1.4)));
  tex.needsUpdate = true;
  const topMat = new THREE.MeshStandardMaterial({ color: 0x0d0822, roughness: 0.35, metalness: 0.7, emissive: col, emissiveMap: tex, emissiveIntensity: 0.8 });
  const mesh = new THREE.Mesh(unitBox, [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat]);
  mesh.scale.set(w, t, d);
  mesh.position.set(x, top - t / 2, z);
  const edgeMat = new THREE.LineBasicMaterial({ color: col.clone().multiplyScalar(1.8), transparent: true });
  mesh.add(new THREE.LineSegments(unitEdges, edgeMat));
  levelGroup.add(mesh);
  disposables.push(tex, topMat, edgeMat);
  const p = {
    mesh, topMat, edgeMat, hw: w / 2, hh: t / 2, hd: d / 2, active: true,
    base: mesh.position.clone(), prev: mesh.position.clone(), delta: new V3(), move: null, vanish: null,
  };
  platforms.push(p);
  return p;
}
const topOf = (p) => p.mesh.position.y + p.hh;

function addStar(x, y, z) {
  const m = new THREE.Mesh(starGeo, starMat);
  m.position.set(x, y, z);
  levelGroup.add(m);
  stars.push({ mesh: m, baseY: y, phase: Math.random() * 6.28 });
}

function addDrone(pos) {
  const g = new THREE.Group();
  const coreMat = droneCoreMat.clone(); disposables.push(coreMat);
  const core = new THREE.Mesh(droneCoreGeo, coreMat); g.add(core);
  const ring = new THREE.Mesh(droneRingGeo, droneRingMat); g.add(ring);
  const ring2 = new THREE.Mesh(droneRingGeo, droneRingMat); ring2.scale.setScalar(0.75); ring2.rotation.y = Math.PI / 2; g.add(ring2);
  const eye = new THREE.Mesh(droneEyeGeo, droneEyeMat); eye.position.z = 0.48; g.add(eye);
  g.position.copy(pos);
  levelGroup.add(g);
  drones.push({ g, core, coreMat, ring, ring2, eye, anchor: pos.clone(), hp: diff.hp, alive: true, fireT: rand(1.5, 3), phase: Math.random() * 6.28, flash: 0, aggro: false });
}

function makePortal(pos, facing) {
  const g = new THREE.Group();
  const geos = [new THREE.TorusGeometry(1.7, 0.14, 12, 56), new THREE.TorusGeometry(1.98, 0.05, 8, 56), new THREE.CircleGeometry(1.62, 56), new THREE.CylinderGeometry(0.5, 1.9, 140, 24, 1, true)];
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 3.2) });
  const ring2Mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.4, 2.4) });
  const discMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){ vec2 p = vUv-0.5; float r = length(p)*2.0; float a = atan(p.y,p.x);
        float s = sin(a*5.0 + r*14.0 - uTime*5.0)*0.5+0.5;
        vec3 c = mix(vec3(0.2,1.6,2.6), vec3(2.4,0.3,2.2), s) * (1.3 - r);
        float alpha = smoothstep(1.0, 0.55, r) * (0.55 + 0.45*s);
        gl_FragColor = vec4(c, alpha); }`,
  });
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.1, 1.5), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  disposables.push(...geos, ringMat, ring2Mat, discMat, beamMat);
  const ring = new THREE.Mesh(geos[0], ringMat), ring2 = new THREE.Mesh(geos[1], ring2Mat), disc = new THREE.Mesh(geos[2], discMat);
  g.add(ring, ring2, disc);
  g.position.copy(pos);
  g.lookAt(facing.x, pos.y, facing.z);
  levelGroup.add(g);
  const beam = new THREE.Mesh(geos[3], beamMat);
  beam.position.set(pos.x, pos.y + 70, pos.z);
  levelGroup.add(beam);
  return { g, ring, ring2, discMat, pos: pos.clone() };
}

function buildLevel(n) {
  clearLevel();
  level = n;
  diff = {
    aggro: Math.min(22 + n * 1.5, 34),
    orbit: Math.max(5.5, 9 - n * 0.3),
    droneSpeed: 3 + n * 0.45,
    fireInterval: Math.max(0.85, 2.9 - n * 0.2),
    boltSpeed: 8.5 + n * 0.8,
    hp: 1 + Math.floor((n - 1) / 3),
  };
  const hue = (0.52 + (n - 1) * 0.11) % 1;
  const col = new THREE.Color().setHSL(hue, 1, 0.5);
  const vanCol = new THREE.Color(1, 0.3, 0.02);
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x0b0618, emissive: col, emissiveIntensity: 0.12, metalness: 0.6, roughness: 0.4 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0x0b0618, emissive: col, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.4 });
  disposables.push(sideMat, bottomMat);

  const count = Math.min(9 + n * 2, 32);
  const gapBase = 1.4 + Math.min((n - 1) * 0.32, 2.8);
  const sizeMax = Math.max(2.8, 5.5 - (n - 1) * 0.28), sizeMin = Math.max(1.9, sizeMax - 1.6);
  const moveChance = n >= 2 ? Math.min(0.45, 0.1 * (n - 1)) : 0;
  const vanishChance = n >= 4 ? Math.min(0.3, 0.07 * (n - 3)) : 0;

  let heading = 0;
  let prev = addPlatform(0, 0, 0, 7, 7, col, sideMat, bottomMat);
  const path = [prev];
  starsTotal = 0; starsGot = 0;
  let minTop = 0;

  for (let i = 1; i < count; i++) {
    const last = i === count - 1;
    heading = clamp(heading + rand(-0.7, 0.7), -1.1, 1.1);
    const dx = Math.sin(heading), dz = -Math.cos(heading);
    const w = last ? 6 : rand(sizeMin, sizeMax), d = last ? 6 : rand(sizeMin, sizeMax);
    const gap = gapBase + rand(0, 1.3);
    const prevHalf = Math.abs(dx) * prev.hw + Math.abs(dz) * prev.hd;
    const nextHalf = Math.abs(dx) * w / 2 + Math.abs(dz) * d / 2;
    const dist = prevHalf + gap + nextHalf;
    let dy = rand(-1.8, 1.5);
    if (gap > 4) dy = Math.min(dy, 0.5);
    const prevTop = prev.base.y + prev.hh;
    const x = prev.base.x + dx * dist, z = prev.base.z + dz * dist, top = prevTop + dy;

    let pcol = col;
    const vanish = !last && i > 1 && Math.random() < vanishChance;
    if (vanish) pcol = vanCol;
    const p = addPlatform(x, top, z, w, d, pcol, sideMat, bottomMat);
    if (vanish) p.vanish = { state: 'solid', t: 0 };
    else if (!last && i > 1 && Math.random() < moveChance) {
      const vertical = Math.random() < 0.35;
      p.move = {
        axis: vertical ? new V3(0, 1, 0) : new V3(-dz, 0, dx),
        amp: vertical ? rand(0.9, 1.4) : rand(1.4, 2.6),
        speed: rand(0.7, 1.1) + n * 0.05,
        phase: Math.random() * 6.28,
      };
    }
    minTop = Math.min(minTop, top);

    if (!last && Math.random() < 0.55) { addStar(x, top + 1.2, z); starsTotal++; }
    if (Math.random() < 0.32) {
      const m = prevHalf + gap / 2;
      addStar(prev.base.x + dx * m, Math.max(prevTop, top) + 2.1, prev.base.z + dz * m);
      starsTotal++;
    }
    path.push(p);
    prev = p;
  }
  if (starsTotal === 0) { const p = path[1]; addStar(p.base.x, p.base.y + p.hh + 1.2, p.base.z); starsTotal = 1; }

  const end = path[path.length - 1], before = path[path.length - 2];
  portal = makePortal(new V3(end.base.x, end.base.y + end.hh + 1.95, end.base.z), before.base);

  const droneCount = Math.min(1 + n, 12);
  for (let k = 0; k < droneCount; k++) {
    const p = path[randInt(2, Math.max(2, path.length - 2))];
    const side = Math.random() < 0.5 ? -1 : 1;
    const a = Math.random() * Math.PI * 2;
    addDrone(new V3(p.base.x + Math.cos(a) * rand(3, 5) * side, p.base.y + rand(3.5, 5.5), p.base.z + Math.sin(a) * rand(3, 5)));
  }

  levelMinY = minTop;
  levelCenter.set(0, 0, 0);
  for (const p of path) levelCenter.add(p.base);
  levelCenter.divideScalar(path.length);
  floorGrid.position.y = minTop - 32;
  AudioSys.tempo = Math.min(140, 108 + n * 3);
}

function placePlayer() {
  const start = platforms[0], next = platforms[1];
  player.pos.set(start.base.x, topOf(start), start.base.z);
  player.vel.set(0, 0, 0);
  player.yaw = Math.atan2(-(next.base.x - start.base.x), -(next.base.z - start.base.z));
  player.pitch = -0.08;
  player.onGround = true; player.ground = start; player.jumps = 2;
  player.lastSafe.copy(player.pos);
  player.shield = SHIELD_MAX; player.invuln = 1.5; player.sinceHit = 99;
  accum = 0;
}

// ---------------------------------------------------------------- input
const keys = {};
let mouseFire = false, jumpBuffer = 0;

function isPaused() { return manualPause || (!touchMode && !locked); }
function requestLock() {
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* ignore */ }
}
function setTouchMode(on) {
  if (touchMode === on) return;
  touchMode = on;
  document.body.classList.toggle('touch', on);
  renderer.setPixelRatio(maxPR());
  onResize();
}

addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Space' && state === 'playing') jumpBuffer = 0.14;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyP' && state === 'playing') {
    if (locked) document.exitPointerLock();
    else if (touchMode) manualPause = !manualPause;
  }
  if (e.code === 'Enter' && (state === 'title' || state === 'gameover')) startGame();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseFire = false; });

canvas.addEventListener('mousedown', (e) => {
  if (state !== 'playing' && state !== 'transition') return;
  if (!locked) { setTouchMode(false); requestLock(); return; }
  if (e.button === 0) mouseFire = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseFire = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked || state !== 'playing') return;
  player.yaw -= clamp(e.movementX, -200, 200) * MOUSE_SENS;
  player.pitch = clamp(player.pitch - clamp(e.movementY, -200, 200) * MOUSE_SENS, -1.5, 1.5);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { manualPause = false; setTouchMode(false); }
  else mouseFire = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && touchMode && state === 'playing') manualPause = true;
});

// --- touch: floating joystick (left), drag-to-aim (right), fire button also aims
const joyBase = $('joyBase'), joyKnob = $('joyKnob'), btnJump = $('btnJump'), btnFire = $('btnFire');
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let lookId = null, lookX = 0, lookY = 0, fireId = null, fireX = 0, fireY = 0, jumpId = null, touchFire = false;
const JOY_R = 55;

function joyHome() {
  const x = Math.min(110, innerWidth * 0.14 + 40);
  const y = innerHeight - Math.min(120, innerHeight * 0.28);
  joyBase.style.left = x + 'px'; joyBase.style.top = y + 'px';
  joyKnob.style.transform = '';
}
function resetTouch() {
  joy.id = lookId = fireId = jumpId = null; joy.x = joy.y = 0; touchFire = false;
  joyBase.classList.remove('on'); btnJump.classList.remove('on'); btnFire.classList.remove('on');
  joyHome();
}
function lookDelta(dx, dy) {
  player.yaw -= dx * TOUCH_SENS;
  player.pitch = clamp(player.pitch - dy * TOUCH_SENS, -1.45, 1.45);
}
document.addEventListener('touchstart', (e) => {
  setTouchMode(true);
  if (state !== 'playing' && state !== 'transition') return;
  if (isPaused()) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    const el = t.target instanceof Element ? t.target : null;
    if (el && el.closest('#pauseBtn')) { manualPause = true; resetTouch(); SFX.click(); return; }
    if (el && el.closest('#btnJump')) { jumpBuffer = 0.14; jumpId = t.identifier; btnJump.classList.add('on'); continue; }
    if (el && el.closest('#btnFire')) { fireId = t.identifier; fireX = t.clientX; fireY = t.clientY; touchFire = true; btnFire.classList.add('on'); continue; }
    if (t.clientX < innerWidth * 0.42 && joy.id === null) {
      joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY; joy.x = joy.y = 0;
      joyBase.style.left = t.clientX + 'px'; joyBase.style.top = t.clientY + 'px';
      joyBase.classList.add('on');
      continue;
    }
    if (lookId === null) { lookId = t.identifier; lookX = t.clientX; lookY = t.clientY; }
  }
}, { passive: false });
document.addEventListener('touchmove', (e) => {
  if (state !== 'playing' && state !== 'transition') return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy;
      const L = Math.hypot(dx, dy);
      if (L > JOY_R) { dx *= JOY_R / L; dy *= JOY_R / L; }
      joy.x = dx / JOY_R; joy.y = dy / JOY_R;
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (t.identifier === lookId) {
      lookDelta(t.clientX - lookX, t.clientY - lookY); lookX = t.clientX; lookY = t.clientY;
    } else if (t.identifier === fireId) {
      lookDelta(t.clientX - fireX, t.clientY - fireY); fireX = t.clientX; fireY = t.clientY;
    }
  }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; joyBase.classList.remove('on'); joyHome(); }
    if (t.identifier === lookId) lookId = null;
    if (t.identifier === fireId) { fireId = null; touchFire = false; btnFire.classList.remove('on'); }
    if (t.identifier === jumpId) { jumpId = null; btnJump.classList.remove('on'); }
  }
}
document.addEventListener('touchend', touchEnd);
document.addEventListener('touchcancel', touchEnd);

// ---------------------------------------------------------------- UI
const ui = {
  hud: $('hud'), touch: $('touch'), title: $('title'), pause: $('pause'), gameover: $('gameover'), crosshair: $('crosshair'),
  score: $('score'), lives: $('lives'), shield: $('shieldbar'), level: $('level'), stars: $('stars'),
  banner: $('banner'), bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'), popup: $('popup'), hitflash: $('hitflash'),
};
const hudCache = {};
function setText(el, key, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }
function updateHUD() {
  setText(ui.score, 'score', String(score));
  setText(ui.level, 'level', 'LEVEL ' + level);
  setText(ui.stars, 'stars', `★ ${starsGot} / ${starsTotal}`);
  if (hudCache.lives !== lives) {
    hudCache.lives = lives;
    ui.lives.innerHTML = '<i></i>'.repeat(Math.max(0, lives)) + '<i class="off"></i>'.repeat(Math.max(0, START_LIVES - lives));
  }
  const sw = Math.round(player.shield);
  if (hudCache.shield !== sw) { hudCache.shield = sw; ui.shield.style.width = sw + '%'; ui.shield.classList.toggle('low', sw < 35); }
  const blink = player.invuln > 0.5;
  if (hudCache.blink !== blink) { hudCache.blink = blink; ui.shield.classList.toggle('blink', blink); }
}
let bannerTimer = 0;
function showBanner(title, sub = '', ms = 1800) {
  ui.bannerTitle.textContent = title; ui.bannerSub.textContent = sub;
  ui.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove('show'), ms);
}
function popup(text) {
  ui.popup.textContent = text;
  ui.popup.classList.remove('show'); void ui.popup.offsetWidth; ui.popup.classList.add('show');
}
let hitFlash = 0, crossHitT = 0;
function refreshScreens() {
  const playing = state === 'playing' || state === 'transition';
  ui.title.classList.toggle('hidden', state !== 'title');
  ui.gameover.classList.toggle('hidden', state !== 'gameover');
  ui.hud.classList.toggle('hidden', !playing);
  const paused = playing && isPaused();
  ui.pause.classList.toggle('hidden', !paused);
  ui.touch.classList.toggle('hidden', !(playing && touchMode && !paused));
  ui.crosshair.classList.toggle('hidden', !playing || paused);
  gun.visible = playing;
}
function toggleMute() {
  AudioSys.setMuted(!AudioSys.muted);
  $('muteBtn').textContent = 'SOUND: ' + (AudioSys.muted ? 'OFF' : 'ON');
}
$('muteBtn').textContent = 'SOUND: ' + (AudioSys.muted ? 'OFF' : 'ON');
$('bestTitle').textContent = best;

$('startBtn').addEventListener('click', () => startGame());
$('againBtn').addEventListener('click', () => startGame());
$('menuBtn').addEventListener('click', () => toTitle());
$('quitBtn').addEventListener('click', () => toTitle());
$('muteBtn').addEventListener('click', () => toggleMute());
$('resumeBtn').addEventListener('click', () => {
  SFX.click();
  if (touchMode) { manualPause = false; resetTouch(); }
  else { manualPause = false; requestLock(); }
});

function tryFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  }).catch(() => {});
}

// ---------------------------------------------------------------- flow
function startGame() {
  AudioSys.init();
  AudioSys.playing = true;
  score = 0; lives = START_LIVES; kills = 0; starsCollected = 0;
  buildLevel(1);
  placePlayer();
  state = 'playing';
  manualPause = false;
  resetTouch();
  for (const k in hudCache) delete hudCache[k];
  if (touchMode) tryFullscreen(); else requestLock();
  showBanner('LEVEL 1', 'REACH THE PORTAL', 2200);
  SFX.click();
}
function toTitle() {
  state = 'title';
  manualPause = false;
  AudioSys.playing = false;
  if (locked) document.exitPointerLock();
  $('bestTitle').textContent = best;
  buildLevel(1);
}
function gameOver() {
  state = 'gameover';
  AudioSys.playing = false;
  mouseFire = false; touchFire = false;
  if (locked) document.exitPointerLock();
  const isBest = score > best;
  if (isBest) { best = score; saveBest(best); }
  $('goScore').textContent = score; $('goBest').textContent = best; $('goLevel').textContent = level;
  $('goStars').textContent = starsCollected; $('goKills').textContent = kills;
  $('newBest').classList.toggle('hidden', !isBest);
  SFX.gameover();
}
function loseLife(fell) {
  lives--;
  hitFlash = 1;
  SFX.die();
  if (lives <= 0) { gameOver(); return; }
  player.pos.copy(player.lastSafe);
  player.vel.set(0, 0, 0);
  player.ground = null; player.onGround = false;
  player.shield = SHIELD_MAX; player.invuln = 2; player.sinceHit = 99;
  for (const b of bolts) levelGroup.remove(b.mesh);
  bolts.length = 0;
  showBanner(fell ? 'LOST IN THE VOID' : 'SUIT BREACH', `${lives} ${lives === 1 ? 'LIFE' : 'LIVES'} LEFT`);
}
function damagePlayer(amount) {
  if (player.invuln > 0) return;
  player.shield -= amount;
  player.sinceHit = 0;
  player.invuln = 0.35;
  hitFlash = Math.max(hitFlash, 0.6);
  SFX.hurt();
  if (player.shield <= 0) loseLife(false);
}
function completeLevel() {
  state = 'transition';
  transitionT = 1.8;
  const allStars = starsGot === starsTotal;
  const bonus = 500 * level + (allStars ? 1000 : 0);
  score += bonus;
  SFX.portal();
  hitFlash = 0;
  emit(portal.pos, 80, C_CYAN, 10, 1.2, 0);
  showBanner(`LEVEL ${level} CLEAR`, allStars ? `+${bonus} · ALL STARS BONUS!` : `+${bonus}`, 1700);
}

// ---------------------------------------------------------------- physics
const overlapXZ = (p) => Math.abs(player.pos.x - p.mesh.position.x) < p.hw + PLAYER_R && Math.abs(player.pos.z - p.mesh.position.z) < p.hd + PLAYER_R;

function updatePlatform(p, h) {
  p.prev.copy(p.mesh.position);
  if (p.move) {
    const m = p.move, s = Math.sin(simTime * m.speed + m.phase) * m.amp;
    p.mesh.position.copy(p.base).addScaledVector(m.axis, s);
  }
  p.delta.subVectors(p.mesh.position, p.prev);
  const v = p.vanish;
  if (!v) return;
  if (v.state === 'warn') {
    v.t -= h;
    const on = Math.sin(v.t * (v.t < 0.35 ? 70 : 35)) > 0;
    p.topMat.emissiveIntensity = on ? 1.4 : 0.15; p.edgeMat.opacity = on ? 1 : 0.2;
    if (v.t <= 0) { v.state = 'gone'; v.t = 3; p.active = false; p.mesh.visible = false; emit(new V3(p.mesh.position.x, topOf(p), p.mesh.position.z), 30, C_ORANGE, 4, 0.6, 8); }
  } else if (v.state === 'gone') {
    v.t -= h;
    if (v.t <= 0) { v.state = 'solid'; p.active = true; p.mesh.visible = true; p.topMat.emissiveIntensity = 0.8; p.edgeMat.opacity = 1; }
  }
}

function moveH(axis, d) {
  const P = player;
  P.pos[axis] += d;
  for (const p of platforms) {
    if (!p.active) continue;
    const top = topOf(p), bot = p.mesh.position.y - p.hh;
    if (!(P.pos.y < top - 0.02 && P.pos.y + PLAYER_H > bot)) continue;
    if (!overlapXZ(p)) continue;
    if (top - P.pos.y < 0.45 && P.vel.y < 3) { P.pos.y = top; continue; } // ledge assist / step-up
    const c = p.mesh.position[axis], half = axis === 'x' ? p.hw : p.hd;
    const goPos = d !== 0 ? d < 0 : P.pos[axis] > c;
    P.pos[axis] = goPos ? c + half + PLAYER_R + 0.001 : c - half - PLAYER_R - 0.001;
    P.vel[axis] = 0;
  }
}

let landDip = 0, fovKick = 0;
function updatePlayer(h) {
  const P = player;
  // input
  let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  if (joy.id !== null && Math.hypot(joy.x, joy.y) > 0.12) { f -= joy.y; s += joy.x; }
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  const k = Math.min(1, (P.onGround ? 16 : 5) * h);
  P.vel.x += (wx * MOVE_SPEED - P.vel.x) * k;
  P.vel.z += (wz * MOVE_SPEED - P.vel.z) * k;

  // jump / double jump
  if (P.coyote > 0) P.coyote -= h;
  if (jumpBuffer > 0) {
    if (P.onGround || P.coyote > 0) {
      P.vel.y = JUMP_V; P.onGround = false; P.ground = null; P.coyote = 0; P.jumps = 1; jumpBuffer = 0;
      SFX.jump();
    } else if (P.jumps > 0) {
      P.vel.y = AIR_JUMP_V; P.jumps = 0; jumpBuffer = 0; fovKick = 1;
      SFX.dbl();
      emit(new V3(P.pos.x, P.pos.y, P.pos.z), 22, C_CYAN, 4, 0.5, 2);
    } else jumpBuffer -= h;
  }
  P.vel.y = Math.max(P.vel.y - GRAVITY * h, -45);

  // ride moving platforms
  if (P.ground && P.ground.active) P.pos.add(P.ground.delta);
  const wasGround = P.onGround;

  moveH('x', P.vel.x * h);
  moveH('z', P.vel.z * h);

  const dy = P.vel.y * h;
  P.pos.y += dy;
  P.onGround = false; P.ground = null;
  let landTop = -Infinity, landP = null;
  for (const p of platforms) {
    if (!p.active || !overlapXZ(p)) continue;
    const top = topOf(p), bot = p.mesh.position.y - p.hh;
    if (P.vel.y <= 0 && P.pos.y <= top + 0.02 && P.pos.y > top - 0.6) {
      if (top > landTop) { landTop = top; landP = p; }
    } else if (P.vel.y > 0 && P.pos.y + PLAYER_H > bot && P.pos.y < bot) {
      P.pos.y = bot - PLAYER_H; P.vel.y = 0;
    }
  }
  if (landP) {
    const impact = P.vel.y;
    P.pos.y = landTop; P.vel.y = 0; P.onGround = true; P.ground = landP; P.jumps = 2; P.coyote = 0;
    if (!wasGround) {
      if (impact < -6) { landDip = Math.min(0.18, -impact * 0.008); SFX.land(); }
    }
    if (landP.vanish && landP.vanish.state === 'solid') { landP.vanish.state = 'warn'; landP.vanish.t = 0.75; SFX.crumble(); }
    if (!landP.move && !landP.vanish) P.lastSafe.set(landP.base.x, landTop, landP.base.z);
  } else if (wasGround && P.vel.y <= 0) {
    P.coyote = 0.1;
  }
}

// ---------------------------------------------------------------- combat
const raycaster = new THREE.Raycaster();
const _o = new V3(), _d = new V3(), _m = new V3(), _t = new V3(), _pc = new V3();
let fireCd = 0, recoil = 0, flashT = 0;

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}

function spawnBeam(from, to) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(beamGeo, mat);
  m.position.copy(from);
  m.lookAt(to);
  m.scale.set(0.025, 0.025, from.distanceTo(to));
  scene.add(m);
  beams.push({ mesh: m, life: 0.09 });
}

function shoot() {
  fireCd = FIRE_RATE;
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(_o);
  camera.getWorldDirection(_d);
  // gentle aim assist for touch
  if (touchMode) {
    let bestA = 0.09, bestD = null;
    for (const d of drones) {
      if (!d.alive) continue;
      _t.subVectors(d.g.position, _o);
      const dist = _t.length();
      if (dist > 60) continue;
      const a = _t.normalize().angleTo(_d);
      if (a < bestA) { bestA = a; bestD = d; }
    }
    if (bestD) _d.subVectors(bestD.g.position, _o).normalize();
  }
  raycaster.set(_o, _d);
  raycaster.far = 160;
  const meshes = platforms.filter((p) => p.active).map((p) => p.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  let tHit = hits.length ? hits[0].distance : 160, target = null;
  const r = touchMode ? 1.2 : 0.95;
  for (const d of drones) {
    if (!d.alive) continue;
    const t = raySphere(_o, _d, d.g.position, r);
    if (t > 0 && t < tHit) { tHit = t; target = d; }
  }
  const end = _t.copy(_o).addScaledVector(_d, tHit);
  muzzle.getWorldPosition(_m);
  spawnBeam(_m, end);
  recoil = 1; flashT = 0.05;
  SFX.shoot();
  if (target) {
    target.hp--; target.flash = 1;
    crossHitT = 0.12;
    emit(end, 10, C_PINK, 5, 0.35, 3);
    if (target.hp <= 0) killDrone(target);
    else SFX.hitDrone();
  } else if (hits.length) {
    emit(end, 6, C_CYAN, 3, 0.3, 4);
  }
}

function killDrone(d) {
  d.alive = false;
  levelGroup.remove(d.g);
  emit(d.g.position, 55, C_PINK, 9, 0.9, 4);
  emit(d.g.position, 25, C_ORANGE, 6, 0.7, 4);
  SFX.boom();
  kills++;
  const pts = 250 + (level - 1) * 25;
  score += pts;
  popup('+' + pts);
}

function updateDrones(dt, passive) {
  _pc.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
  for (const d of drones) {
    if (!d.alive) continue;
    d.ring.rotation.x += dt * 2.5; d.ring.rotation.y += dt * 1.3; d.ring2.rotation.z += dt * 3;
    d.core.rotation.y += dt * 1.5;
    d.flash = Math.max(0, d.flash - dt * 5);
    d.coreMat.emissiveIntensity = 0.6 + d.flash * 4;
    const dist = d.g.position.distanceTo(_pc);
    if (passive) d.aggro = false;
    else if (dist < diff.aggro) d.aggro = true;
    else if (dist > diff.aggro * 1.6) d.aggro = false;
    const target = _t;
    if (d.aggro) {
      const a = d.phase + simTime * 0.45;
      target.set(_pc.x + Math.cos(a) * diff.orbit, _pc.y + 2.5 + Math.sin(simTime * 1.3 + d.phase), _pc.z + Math.sin(a) * diff.orbit);
    } else {
      target.copy(d.anchor); target.y += Math.sin(wallTime * 1.5 + d.phase) * 0.5;
    }
    const dx = target.x - d.g.position.x, dy = target.y - d.g.position.y, dz = target.z - d.g.position.z;
    const L = Math.hypot(dx, dy, dz);
    if (L > 0.001) {
      const st = Math.min(L, (d.aggro ? diff.droneSpeed : 1.5) * dt);
      d.g.position.x += dx / L * st; d.g.position.y += dy / L * st; d.g.position.z += dz / L * st;
    }
    if (d.aggro) d.g.lookAt(camera.position);
    else d.g.rotation.y += dt * 0.6;
    // telegraph shot: eye swells
    const charging = d.aggro && d.fireT < 0.45;
    d.eye.scale.setScalar(charging ? 1.4 + Math.sin(wallTime * 40) * 0.3 : 1);
    if (d.aggro && !passive) {
      d.fireT -= dt;
      if (d.fireT <= 0) {
        if (dist < diff.aggro) fireBolt(d, dist);
        d.fireT = diff.fireInterval * rand(0.75, 1.25);
      }
    }
  }
}

function fireBolt(d, dist) {
  const lead = (dist / diff.boltSpeed) * 0.4;
  _m.set(_pc.x + player.vel.x * lead, _pc.y + player.vel.y * lead * 0.3, _pc.z + player.vel.z * lead);
  const dir = _m.sub(d.g.position).normalize();
  const mesh = new THREE.Mesh(boltGeo, boltMat);
  mesh.position.copy(d.g.position).addScaledVector(dir, 0.6);
  levelGroup.add(mesh);
  bolts.push({ mesh, vel: dir.clone().multiplyScalar(diff.boltSpeed), life: 5 });
  SFX.droneShot(clamp(1.4 - dist / 30, 0.2, 1));
}

function updateBolts(dt) {
  const P = player;
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i], m = b.mesh;
    m.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    let dead = b.life <= 0;
    // hit player: distance to vertical body segment
    const cyc = clamp(m.position.y, P.pos.y + 0.3, P.pos.y + PLAYER_H - 0.2);
    const dx = m.position.x - P.pos.x, dy = m.position.y - cyc, dz = m.position.z - P.pos.z;
    if (!dead && dx * dx + dy * dy + dz * dz < 0.55 * 0.55) {
      dead = true;
      damagePlayer(BOLT_DMG);
      if (state !== 'playing' || bolts.length === 0) return;
    }
    if (!dead) {
      for (const p of platforms) {
        if (!p.active) continue;
        const q = p.mesh.position;
        if (Math.abs(m.position.x - q.x) < p.hw && Math.abs(m.position.z - q.z) < p.hd && Math.abs(m.position.y - q.y) < p.hh) {
          dead = true; emit(m.position, 6, C_PINK, 3, 0.3, 2); break;
        }
      }
    }
    if (dead) { levelGroup.remove(m); bolts.splice(i, 1); }
  }
}

function updateStars(dt, collect) {
  const c = _pc.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
  for (let i = stars.length - 1; i >= 0; i--) {
    const s = stars[i];
    s.mesh.rotation.y += dt * 2.2;
    s.mesh.position.y = s.baseY + Math.sin(wallTime * 2.4 + s.phase) * 0.15;
    if (collect && s.mesh.position.distanceTo(c) < 1.2) {
      levelGroup.remove(s.mesh);
      stars.splice(i, 1);
      starsGot++; starsCollected++;
      score += 100;
      emit(s.mesh.position, 24, C_GOLD, 5, 0.6, 2);
      SFX.star();
      popup(starsGot === starsTotal ? '+100 ALL STARS!' : '+100');
    }
  }
}

function updateFX(dt) {
  updateParticles(dt);
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.life -= dt;
    b.mesh.material.opacity = Math.max(0, b.life / 0.09);
    if (b.life <= 0) { scene.remove(b.mesh); b.mesh.material.dispose(); beams.splice(i, 1); }
  }
  if (portal) {
    portal.discMat.uniforms.uTime.value = wallTime;
    portal.ring.rotation.z += dt * 0.8;
    portal.ring2.rotation.z -= dt * 1.4;
  }
  bg.position.copy(camera.position);
  floorGrid.position.x = Math.round(camera.position.x / 10) * 10;
  floorGrid.position.z = Math.round(camera.position.z / 10) * 10;
  hitFlash = Math.max(0, hitFlash - dt * 2.2);
  ui.hitflash.style.opacity = hitFlash.toFixed(3);
  crossHitT -= dt;
  const ch = crossHitT > 0;
  if (hudCache.cross !== ch) { hudCache.cross = ch; ui.crosshair.classList.toggle('hit', ch); }
}

// ---------------------------------------------------------------- camera
let bobT = 0, roll = 0;
function updateCamera(dt) {
  const P = player;
  const speedH = Math.hypot(P.vel.x, P.vel.z);
  const bobAmt = P.onGround ? Math.min(1, speedH / MOVE_SPEED) : 0;
  if (P.onGround) bobT += dt * speedH * 1.4;
  const bobY = Math.sin(bobT * 2) * 0.045 * bobAmt;
  landDip *= Math.exp(-dt * 9);
  camera.position.set(P.pos.x, P.pos.y + EYE + bobY - landDip, P.pos.z);
  const strafeV = P.vel.x * Math.cos(P.yaw) - P.vel.z * Math.sin(P.yaw);
  roll += (-strafeV * 0.005 - roll) * Math.min(1, dt * 8);
  camera.rotation.set(P.pitch, P.yaw, roll);
  fovKick *= Math.exp(-dt * 4);
  const fov = BASE_FOV + fovKick * 6 + speedH * 0.35;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  recoil *= Math.exp(-dt * 14);
  gun.position.set(
    0.26 + Math.cos(bobT) * 0.014 * bobAmt,
    -0.25 + Math.abs(Math.sin(bobT)) * 0.014 * bobAmt - landDip * 0.4 + clamp(-P.vel.y * 0.002, -0.03, 0.03),
    -0.52 + recoil * 0.07);
  gun.rotation.set(recoil * 0.18, 0, 0);
  flashT -= dt;
  flash.visible = flashT > 0;
  if (flash.visible) flash.material.rotation = Math.random() * 6.28;
}

let idleT = 0;
function idleCamera(dt) {
  idleT += dt * 0.07;
  camera.position.set(levelCenter.x + Math.cos(idleT) * 42, levelCenter.y + 15, levelCenter.z + Math.sin(idleT) * 42);
  camera.lookAt(levelCenter);
  if (camera.fov !== BASE_FOV) { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- main loop
function updatePlaying(dt) {
  accum += dt;
  let n = 0;
  while (accum >= STEP && n < 10) {
    simTime += STEP;
    for (const p of platforms) updatePlatform(p, STEP);
    updatePlayer(STEP);
    accum -= STEP; n++;
  }
  if (n === 10) accum = 0;

  const P = player;
  updateCamera(dt);
  fireCd -= dt;
  if ((mouseFire || touchFire) && fireCd <= 0) shoot();

  P.invuln -= dt;
  P.sinceHit += dt;
  if (P.sinceHit > 3) P.shield = Math.min(SHIELD_MAX, P.shield + 25 * dt);

  updateDrones(dt, false);
  updateBolts(dt);
  if (state !== 'playing') return;
  updateStars(dt, true);

  if (portal) {
    const dx = P.pos.x - portal.pos.x, dz = P.pos.z - portal.pos.z, dy = P.pos.y + 0.9 - portal.pos.y;
    if (dx * dx + dz * dz < 1.5 * 1.5 && Math.abs(dy) < 2) { completeLevel(); return; }
  }
  if (P.pos.y < levelMinY - 18) loseLife(true);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  wallTime += dt;

  if (state === 'playing') {
    if (!isPaused()) updatePlaying(dt);
  } else if (state === 'transition') {
    if (!isPaused()) transitionT -= dt;
    updateCamera(dt);
    updateStars(dt, false);
    if (transitionT <= 0) {
      buildLevel(level + 1);
      placePlayer();
      state = 'playing';
      showBanner('LEVEL ' + level, levelSub(level), 2200);
    }
  } else {
    idleCamera(dt);
    simTime += dt;
    for (const p of platforms) if (p.move) updatePlatform(p, dt);
    updateDrones(dt, true);
    updateStars(dt, false);
  }
  updateFX(dt);
  if (state === 'playing' || state === 'transition') updateHUD();
  refreshScreens();
  composer.render();
}

function levelSub(n) {
  const notes = [];
  notes.push(`${Math.min(1 + n, 12)} DRONES`);
  if (n === 2) notes.push('MOVING PLATFORMS');
  if (n === 4) notes.push('CRUMBLING ORANGE PLATFORMS');
  if (n > 1 && (n - 1) % 3 === 0) notes.push('TOUGHER DRONES');
  if (n > 4) notes.push('WIDER GAPS');
  return notes.join(' · ');
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  joyHome();
}
addEventListener('resize', onResize);

// boot: build a backdrop level for the title screen
buildLevel(1);
onResize();
requestAnimationFrame(frame);
