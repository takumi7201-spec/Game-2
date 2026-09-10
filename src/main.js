// Fossil Isle - an isometric voxel graphics demo.
import * as THREE from '../vendor/three/three.module.js';
import { createCameraRig } from './camera.js';
import { createCharacter } from './character.js';
import { windUniforms } from './lib/wind.js';
import { fbm2 } from './lib/math.js';
import { buildIsland, groundAt } from './world/terrain.js';
import { buildMeadow } from './world/grass.js';
import { buildWater } from './world/water.js';
import { buildProps } from './world/props.js';
import { buildSky, buildDistantLands, SKY } from './world/sky.js';
import { buildLife, moteUniforms } from './world/life.js';

const canvas = document.getElementById('scene');
const hudFps = document.getElementById('fps');
const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const loaderBar = document.getElementById('loader-bar');

/* ------------------------------------------------------------------ *
 *  Renderer                                                           *
 * ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setClearColor(SKY.fog, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

// Foreground: the island itself, drawn with the true isometric ortho camera.
const scene = new THREE.Scene();

// Background: sky, cloud ocean and the distant archipelago. Drawn first with a
// perspective camera whose fov is matched to the ortho zoom, so objects at the
// island's distance line up exactly while everything beyond falls away with
// real depth. An ortho camera alone cannot show a horizon.
const bgScene = new THREE.Scene();
bgScene.fog = new THREE.Fog(new THREE.Color(SKY.fog), 150, 780);
const bgCamera = new THREE.PerspectiveCamera(45, 1, 1, 2200);

const rig = createCameraRig(canvas);

/* ------------------------------------------------------------------ *
 *  Light                                                              *
 * ------------------------------------------------------------------ */

// Roughly 55 degrees off the default camera azimuth: far enough that cast
// shadows are not hidden behind their casters, close enough that the digger's
// face is lit while they are facing the camera.
const sunDir = new THREE.Vector3(-0.12, 0.72, 0.68).normalize();
const sun = new THREE.DirectionalLight(0xfff2d8, 3.3);
sun.position.copy(sunDir).multiplyScalar(60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -27;
sun.shadow.camera.right = 27;
sun.shadow.camera.top = 27;
sun.shadow.camera.bottom = -27;
sun.shadow.camera.near = 6;
sun.shadow.camera.far = 130;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);

const SUN_I = 3.3, HEMI_I = 0.38;
const hemi = new THREE.HemisphereLight(0x9ccdf5, 0x3d5f30, HEMI_I);
scene.add(hemi);
// cool bounce from the opposite side keeps the shadow side from going muddy
const fill = new THREE.DirectionalLight(0x8fb6ee, 0.34);
fill.position.set(0.7, 0.4, 0.75);
scene.add(fill);

// the backdrop gets its own (shadowless) copies of the same light rig
const bgSun = new THREE.DirectionalLight(0xfff2d8, 2.6);
bgSun.position.copy(sunDir).multiplyScalar(60);
bgScene.add(bgSun, bgSun.target);
bgScene.add(new THREE.HemisphereLight(0xa8dcff, 0x5a7f9a, 0.9));

/* ------------------------------------------------------------------ *
 *  Build the world                                                    *
 * ------------------------------------------------------------------ */

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

async function step(pct, label, fn) {
  loaderText.textContent = label;
  loaderBar.style.width = `${pct}%`;
  await nextFrame();
  await nextFrame();
  return fn();
}

let world = null;

async function build() {
  const sky = await step(8, '空をひらいています', () => buildSky(bgScene, sunDir));
  const island = await step(22, '浮遊島を積みあげています', () => buildIsland(scene));
  const water = await step(34, '池と滝を流しています', () => buildWater(scene));
  const props = await step(52, '発掘現場をならべています', () => buildProps(scene));
  const meadow = await step(74, '草原を生やしています', () => buildMeadow(scene, 1));
  const distant = await step(84, '遠景をひろげています', () => buildDistantLands(bgScene));
  const life = await step(92, '生きものを放しています', () => buildLife(scene, { water, props }));
  const hero = await step(98, '発掘家を起こしています', () => createCharacter(scene));
  world = { sky, island, water, props, meadow, distant, life, hero };
  window.__world = world;
  return world;
}

/* ------------------------------------------------------------------ *
 *  Input: click to walk                                               *
 * ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();

rig.onClick((e) => {
  if (!world) return;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, rig.camera);
  // Iterate: intersect a horizontal plane, resample the terrain, repeat.
  let y = world.hero.state.groundY;
  let found = false;
  for (let i = 0; i < 5; i++) {
    plane.constant = -y;
    if (!raycaster.ray.intersectPlane(plane, hit)) break;
    found = true;
    const gy = groundAt(hit.x, hit.z);
    if (Math.abs(gy - y) < 0.02) break;
    y = gy;
  }
  if (found) world.hero.moveTo(hit.x, hit.z);
});

/* ------------------------------------------------------------------ *
 *  Adaptive quality: hold the frame budget above 60fps                *
 * ------------------------------------------------------------------ */

const TIERS = [
  { pr: 2.0, grass: 1.00 },
  { pr: 1.5, grass: 1.00 },
  { pr: 1.25, grass: 0.85 },
  { pr: 1.0, grass: 0.65 },
  { pr: 1.0, grass: 0.42 },
];
let tier = window.devicePixelRatio > 1.5 ? 1 : 0;
let goodTime = 0;
let badTime = 0;

function applyTier() {
  const t = TIERS[tier];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pr));
  resize();
  if (world) world.meadow.setDensity(t.grass);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  rig.setSize(w, h);
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ *
 *  Loop                                                               *
 * ------------------------------------------------------------------ */

let last = performance.now();
let elapsed = 0;
let frames = 0;
let fpsAccum = 0;
let smoothFps = 60;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  const t = elapsed;
  windUniforms.uTime.value = t;

  if (world) {
    const hero = world.hero;
    hero.update(dt, t, { puffs: world.life.puffs });
    rig.focus.copy(hero.state.pos);
    rig.focus.y = hero.state.groundY;

    windUniforms.uPlayer.value.set(hero.state.pos.x, hero.state.groundY, hero.state.pos.z, 1.5);
    // breathing gust strength so the meadow surges and settles
    windUniforms.uWind.value.z = 0.75 + fbm2(t * 0.09, 4.2, 3) * 0.85;

    world.props.update(dt, t);
    world.life.update(dt, t);
    world.distant.update(dt, t);

    // clouds crossing the sun
    const shade = 0.86 + fbm2(t * 0.045, -8.1, 2) * 0.18;
    sun.intensity = SUN_I * shade;
    hemi.intensity = HEMI_I * (2 - shade) * 0.94;
  }

  rig.update(dt);
  moteUniforms.uPixelScale.value = renderer.domElement.height / (2 * rig.viewSize);

  // backdrop first, then clear depth so the isometric layer always sits on top
  bgCamera.position.copy(rig.camera.position);
  bgCamera.quaternion.copy(rig.camera.quaternion);
  bgCamera.aspect = rig.aspect;
  bgCamera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(rig.viewSize / rig.distance));
  bgCamera.updateProjectionMatrix();

  renderer.autoClear = true;
  renderer.render(bgScene, bgCamera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, rig.camera);
  renderer.autoClear = true;

  // --- adaptive quality ---
  frames++;
  fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    const fps = frames / fpsAccum;
    smoothFps = smoothFps * 0.35 + fps * 0.65;
    hudFps.textContent = `${Math.round(smoothFps)} fps`;
    hudFps.style.color = smoothFps >= 58 ? '#8ef0a4' : smoothFps >= 45 ? '#ffd97a' : '#ff9a8a';
    frames = 0; fpsAccum = 0;

    if (smoothFps < 55 && tier < TIERS.length - 1) {
      badTime += 1; goodTime = 0;
      if (badTime >= 2) { tier++; applyTier(); badTime = 0; }
    } else if (smoothFps > 88 && tier > 0) {
      goodTime += 1; badTime = 0;
      if (goodTime >= 8) { tier--; applyTier(); goodTime = 0; }
    } else { badTime = 0; goodTime = 0; }
  }
}

/* ------------------------------------------------------------------ */

// handles for tuning/debugging from the console
window.__renderer = renderer;
window.__rig = rig;
window.__scene = scene;
window.__sun = sun;

applyTier();
build().then(() => {
  applyTier();
  rig.focus.copy(world.hero.state.pos);
  rig.target.copy(world.hero.state.pos);
  loaderBar.style.width = '100%';
  loader.classList.add('done');
  setTimeout(() => loader.remove(), 700);
  last = performance.now();
  frame();
}).catch((err) => {
  loaderText.textContent = `読み込みに失敗しました: ${err.message}`;
  console.error(err);
});
