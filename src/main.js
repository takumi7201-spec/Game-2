import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WetGround } from './ground.js';
import { buildWorld, buildDigSites, buildSky, ARENA } from './world.js';
import { createHunter, createDino } from './chars.js';
import { makeRain, makeEmbers, makeFireflies, makeFogSheets, makeBats, Sparks, makeBeacons, makeGuideArrow } from './fx.js';
import { occlusion } from './voxel.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.30;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x101d31, 0.0076);

// ------------------------------------------------------------------ camera
const camera = new THREE.PerspectiveCamera(19, 1, 0.5, 700);
const cam = { yaw: Math.PI * 0.25, pitch: 0.555, dist: 46, target: new THREE.Vector3(0, 1, 0) };
const camSmooth = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: cam.target.clone() };

// ---------------------------------------------------------------- lighting
const moon = new THREE.DirectionalLight(0xb2ccff, 2.95);
moon.position.set(-34, 46, -26);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -42; moon.shadow.camera.right = 42;
moon.shadow.camera.top = 42; moon.shadow.camera.bottom = -42;
moon.shadow.camera.near = 1; moon.shadow.camera.far = 140;
moon.shadow.bias = -0.0011;
moon.shadow.normalBias = 0.035;
scene.add(moon, moon.target);

const hemi = new THREE.HemisphereLight(0x4266a0, 0x1c1926, 0.72);
scene.add(hemi);
const fillLight = new THREE.DirectionalLight(0x3f86ad, 0.78);
fillLight.position.set(20, 12, 26);
scene.add(fillLight);

// -------------------------------------------------------------------- sky
const skyObj = buildSky(scene);

// ------------------------------------------------------------------ world
const world = buildWorld(scene);
const dig = buildDigSites(scene, 14);

const ground = new WetGround(230, 0.42);
scene.add(ground.mesh);

// point lights from emissive props (cap for perf)
const pointLights = [];
// the four altar pillars are decorative; their glow is carried by emissive alone
const litProps = world.emissivePoints.filter(p => p.intensity > 1.5).slice(0, 5);
litProps.forEach(p => {
  const l = new THREE.PointLight(p.color, p.intensity, p.dist, 2.0);
  l.position.set(p.x, p.y, p.z);
  l.userData.base = p.intensity;
  l.userData.flicker = !!p.flicker;
  scene.add(l);
  pointLights.push(l);
});

// ------------------------------------------------------------------- IBL
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const skyScene = new THREE.Scene();
  const s2 = skyObj.sky.clone();
  s2.material = skyObj.mat;
  skyScene.add(s2);
  const env = pmrem.fromScene(skyScene, 0, 0.1, 500);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.60;
  pmrem.dispose();
}

// ------------------------------------------------------------------- FX
const rain = makeRain(scene, 4200, 46, 28);
const embers = makeEmbers(scene, world.campfire, 340);
const fireflies = makeFireflies(scene, 170, 22);
const fog = makeFogSheets(scene, 11);
const bats = makeBats(scene, 24);
const sparks = new Sparks(scene, 1100);
const beacons = makeBeacons(scene, dig.sites);
const guide = makeGuideArrow(scene);

// --------------------------------------------------------------- hunter
const hunter = createHunter();
hunter.group.position.set(1.0, 0, 2.0);
scene.add(hunter.group);

const hunterState = {
  target: new THREE.Vector3(1.0, 0, 2.0),
  facing: 0,
  speed: 0,
  task: null,       // { site, phase }
};

// ------------------------------------------------------------ post stack
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 144), 0.38, 0.62, 0.84);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const QUALITY = [
  { dpr: 1.5,  refl: 0.42 },
  { dpr: 1.25, refl: 0.38 },
  { dpr: 1.0,  refl: 0.34 },
  { dpr: 0.85, refl: 0.30 },
];
let qLevel = 0, qHoldT = 0;

function applyQuality() {
  const q = QUALITY[qLevel];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
  ground.resScale = q.refl;
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  ground.setSize(w, h, renderer);
}
addEventListener('resize', resize);
resize();

// =========================================================== interaction
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragging = false, dragMoved = 0, lastX = 0, lastY = 0;

const touches = new Map();
let pinchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {                     // second finger starts a pinch
    dragging = false;
    const [a, b] = [...touches.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    return;
  }
  dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0 && d > 0) {
      cam.dist = THREE.MathUtils.clamp(cam.dist * (pinchDist / d), 22, 82);
    }
    pinchDist = d;
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  cam.yaw -= dx * 0.0055;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch - dy * 0.004, 0.34, 0.95);
});
function endPointer(e) {
  const wasPinching = touches.size === 2;
  touches.delete(e.pointerId);
  if (touches.size < 2) pinchDist = 0;
  if (!dragging || wasPinching) { dragging = false; return; }
  dragging = false;
  if (dragMoved < 6) handleClick(e);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.style.touchAction = 'none';
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.09), 22, 82);
}, { passive: false });

function handleClick(e) {
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ndc, camera);

  // dig site under cursor?
  const meshes = dig.sites.filter(s => !s.done).map(s => s.mesh);
  const hits = ray.intersectObjects(meshes, false);
  if (hits.length) {
    const site = dig.sites.find(s => s.mesh === hits[0].object);
    hunterState.task = { site, phase: 'goto' };
    hunterState.target.copy(site.pos);
    return;
  }
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(groundPlane, p)) {
    p.x = THREE.MathUtils.clamp(p.x, -ARENA + 1, ARENA - 1);
    p.z = THREE.MathUtils.clamp(p.z, -ARENA + 1, ARENA - 1);
    hunterState.target.copy(p);
    hunterState.task = null;
    sparks.burst(p.x, 0.1, p.z, 8, 0x8fd8ff, { spread: 1.2, up: 1.2, life: 0.5, size: 1.4 });
  }
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); tryRevive(); }
  if (e.code === 'KeyF') commandAttack();
});

// ================================================================== game
const G = {
  fossils: 0, shards: 0, revived: [], dinos: [], enemy: null,
  battle: null, toastT: 0,
};
const SPECIES = [
  { name: 'RAPTOR', kind: 'raptor', tint: 0x8d7b3e, cost: 3, hp: 120, atk: 9 },
  { name: 'TYRANNO', kind: 'trex', tint: 0x7a4f39, cost: 6, hp: 220, atk: 16 },
  { name: 'STEGO', kind: 'stego', tint: 0x4a6b52, cost: 5, hp: 260, atk: 11 },
];

const el = id => document.getElementById(id);
function toast(msg, ms = 1900) {
  el('toast').textContent = msg;
  el('toast').style.opacity = '1';
  G.toastT = ms / 1000;
}
function hint(msg) { el('hintText').textContent = msg; }
function refreshHud() {
  el('fossils').textContent = G.fossils;
  el('shards').textContent = G.shards;
  el('sites').textContent = dig.sites.filter(s => !s.done).length;
  const next = SPECIES.find(s => !G.revived.includes(s.name));
  el('progress').textContent = next
    ? `${next.name} 復活まで 化石 ${Math.max(0, next.cost - G.fossils)} 個`
    : '全恐竜を復活済み';
  if (G.revived.length) {
    el('rosterPanel').style.display = '';
    el('roster').innerHTML = G.revived.map(n => {
      const s = SPECIES.find(x => x.name === n);
      return `<div class="dino"><span class="swatch" style="background:#${s.tint.toString(16).padStart(6, '0')};color:#${s.tint.toString(16).padStart(6, '0')}"></span>${n}</div>`;
    }).join('');
  }
}

function tryRevive() {
  const d = hunter.group.position.distanceTo(world.altar);
  if (d > 6.5) { toast('祭壇に近づいて'); return; }
  const s = SPECIES.find(sp => !G.revived.includes(sp.name) && G.fossils >= sp.cost);
  if (!s) { toast('化石が足りない'); return; }
  G.fossils -= s.cost;
  G.revived.push(s.name);
  refreshHud();
  spawnDino(s);
}

function spawnDino(s) {
  const d = createDino(s.kind, s.tint);
  d.group.position.copy(world.altar).setY(1.05);
  d.group.rotation.y = Math.PI;
  d.hp = s.hp; d.maxHp = s.hp; d.atk = s.atk; d.species = s;
  d.home = new THREE.Vector3();
  scene.add(d.group);
  G.dinos.push(d);
  d.setAction('roar');
  hunter.setAction('cheer');
  setTimeout(() => hunter.setAction('idle'), 1400);

  // revival burst
  for (let k = 0; k < 5; k++) {
    setTimeout(() => sparks.burst(world.altar.x, 1.4 + k * 0.7, world.altar.z, 90, 0x7ef2ff,
      { spread: 5.0, up: 9.0, life: 1.5, size: 3.4 }), k * 90);
  }
  const flash = new THREE.PointLight(0x9ff4ff, 60, 45, 2);
  flash.position.copy(world.altar).setY(3.5);
  scene.add(flash);
  const t0 = performance.now();
  const fade = () => {
    const k = (performance.now() - t0) / 1400;
    flash.intensity = 60 * Math.max(0, 1 - k);
    if (k < 1) requestAnimationFrame(fade); else scene.remove(flash);
  };
  fade();
  toast(`${s.name} 復活!`);
  hint('F キーで攻撃指示 · 発掘を続けよう');
  if (!G.enemy) setTimeout(spawnEnemy, 3200);
}

function spawnEnemy() {
  if (G.enemy) return;
  const kinds = ['raptor', 'trex'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const e = createDino(kind, kind === 'trex' ? 0x5a3350 : 0x4b3a5e);
  const a = Math.random() * Math.PI * 2;
  e.group.position.set(Math.cos(a) * (ARENA - 3), 0, Math.sin(a) * (ARENA - 3));
  e.hp = kind === 'trex' ? 240 : 140; e.maxHp = e.hp;
  e.atk = kind === 'trex' ? 14 : 8;
  e.isEnemy = true;
  scene.add(e.group);
  G.enemy = e;
  e.setAction('roar');
  toast('野生の魔獣が現れた!');
  el('bars').style.display = 'block';
  el('n2').textContent = kind === 'trex' ? 'WILD TYRANNO' : 'WILD RAPTOR';
}

function commandAttack() {
  if (!G.dinos.length) { toast('まず恐竜を復活させよう'); return; }
  if (!G.enemy) { toast('敵がいない'); return; }
  G.dinos.forEach(d => { d.charging = true; });
  toast('ATTACK!', 900);
}

// ---------------------------------------------------------- dig mechanic
let digCd = 0;
function updateDig(dt) {
  const t = hunterState.task;
  if (!t || t.site.done) return;
  const d = hunter.group.position.distanceTo(t.site.pos);
  if (t.phase === 'goto') {
    if (d < 2.2) { t.phase = 'dig'; digCd = 0; }
    return;
  }
  digCd -= dt;
  if (digCd <= 0) {
    digCd = 0.62;
    hunter.setAction('dig');
    setTimeout(() => { if (hunter.action === 'dig') hunter.setAction('idle'); }, 520);
    setTimeout(() => {
      const p = t.site.pos;
      sparks.burst(p.x, 0.55, p.z, 26, 0xc7a06a, { spread: 2.6, up: 4.2, life: 0.8, size: 2.2 });
      t.site.hp--;
      t.site.mesh.scale.y = Math.max(0.25, t.site.hp / 3);
      G.shards++;
      if (t.site.hp <= 0) {
        t.site.done = true;
        t.site.mesh.visible = false;
        t.site.flag.visible = false;
        beacons.clear(dig.sites.indexOf(t.site));
        G.fossils++;
        sparks.burst(p.x, 0.8, p.z, 120, 0xffe08a, { spread: 4.2, up: 7.0, life: 1.3, size: 3.0 });
        toast('化石を発見!');
        hunterState.task = null;
        hunter.setAction('cheer');
        setTimeout(() => hunter.setAction('idle'), 900);
        const ready = SPECIES.find(s => !G.revived.includes(s.name) && G.fossils >= s.cost);
        if (ready) hint(`祭壇へ行き SPACE で ${ready.name} を復活`);
      }
      refreshHud();
    }, 260);
  }
}

// -------------------------------------------------- nearest-site signposting
function updateGuide(dt) {
  let best = null, bestD = 1e9;
  dig.sites.forEach(s => {
    if (s.done) return;
    const d = s.pos.distanceToSquared(hunter.group.position);
    if (d < bestD) { bestD = d; best = s; }
  });
  const m = guide.mesh;
  if (!best) { m.visible = false; return; }
  m.visible = true;
  m.position.set(hunter.group.position.x, 0.06, hunter.group.position.z);
  const want = Math.atan2(best.pos.x - m.position.x, best.pos.z - m.position.z);
  m.rotation.y = lerpAngle(m.rotation.y, want, 1 - Math.pow(0.001, dt));
  // fade out once you are standing on the site
  guide.mat.uniforms.uFade.value = THREE.MathUtils.clamp((Math.sqrt(bestD) - 2.5) / 3.0, 0, 1);
}

// ------------------------------------------------------------- battle AI
function updateBattle(dt) {
  const e = G.enemy;
  G.dinos.forEach(d => {
    if (!e) {
      // idle: follow the hunter at a respectful distance
      const to = hunter.group.position.clone();
      const dir = d.group.position.clone().sub(to);
      const dist = dir.length();
      let sp = 0;
      if (dist > 5.5) {
        dir.normalize();
        const v = dir.multiplyScalar(-Math.min(4.2, (dist - 5) * 1.6) * dt);
        d.group.position.add(v);
        sp = v.length() / dt;
        d.group.rotation.y = lerpAngle(d.group.rotation.y, Math.atan2(-v.x, -v.z) + Math.PI, 0.12);
      }
      d.update(dt, sp);
      return;
    }
    const to = e.group.position;
    const dir = to.clone().sub(d.group.position);
    const dist = dir.length();
    let sp = 0;
    const reach = 4.2 * Math.max(d.group.scale.x, e.group.scale.x);
    if (d.charging && dist > reach) {
      dir.normalize();
      const v = dir.multiplyScalar(5.0 * dt);
      d.group.position.add(v);
      sp = v.length() / dt;
    }
    d.group.rotation.y = lerpAngle(d.group.rotation.y, Math.atan2(dir.x, dir.z), 0.16);
    d.atkCd = (d.atkCd || 0) - dt;
    if (d.charging && dist <= reach && d.atkCd <= 0) {
      d.atkCd = 1.15;
      d.setAction('attack');
      setTimeout(() => {
        if (!G.enemy) return;
        G.enemy.hp -= d.atk;
        G.enemy.setAction('hurt');
        const p = G.enemy.group.position;
        sparks.burst(p.x, 1.4, p.z, 40, 0xff8f4a, { spread: 3.4, up: 4.0, life: 0.7, size: 2.6 });
        if (G.enemy.hp <= 0) killEnemy();
      }, 240);
      setTimeout(() => { if (d.action === 'attack') d.setAction('idle'); }, 520);
    }
    d.update(dt, sp);
  });

  if (!e) return;
  // enemy targets nearest dino, else the hunter
  let tgt = null, best = 1e9;
  G.dinos.forEach(d => { const dd = d.group.position.distanceTo(e.group.position); if (dd < best) { best = dd; tgt = d; } });
  const hd = hunter.group.position.distanceTo(e.group.position);
  if (!tgt || hd < best - 3) { tgt = { group: hunter.group, isHunter: true }; best = hd; }
  const dir = tgt.group.position.clone().sub(e.group.position);
  const dist = dir.length();
  let sp = 0;
  const reach = 4.6 * e.group.scale.x;
  if (dist > reach) {
    dir.normalize();
    const v = dir.multiplyScalar(3.6 * dt);
    e.group.position.add(v);
    sp = v.length() / dt;
  }
  e.group.rotation.y = lerpAngle(e.group.rotation.y, Math.atan2(dir.x, dir.z), 0.12);
  e.atkCd = (e.atkCd || 1.5) - dt;
  if (dist <= reach && e.atkCd <= 0) {
    e.atkCd = 1.5;
    e.setAction('attack');
    setTimeout(() => {
      if (tgt.isHunter) {
        const p = hunter.group.position;
        sparks.burst(p.x, 1.2, p.z, 26, 0xff5a3c, { spread: 2.6, up: 3.4, life: 0.6, size: 2.0 });
      } else if (tgt.hp !== undefined) {
        tgt.hp -= e.atk;
        tgt.setAction('hurt');
        const p = tgt.group.position;
        sparks.burst(p.x, 1.4, p.z, 30, 0xff5a3c, { spread: 3.0, up: 3.6, life: 0.7, size: 2.2 });
        if (tgt.hp <= 0) {
          scene.remove(tgt.group);
          G.dinos.splice(G.dinos.indexOf(tgt), 1);
          G.revived.splice(G.revived.indexOf(tgt.species.name), 1);
          refreshHud();
          toast('恐竜が倒れた…');
        }
      }
    }, 260);
    setTimeout(() => { if (e.action === 'attack') e.setAction('idle'); }, 560);
  }
  e.update(dt, sp);

  // HP bars
  const ally = G.dinos[0];
  if (ally) { el('n1').textContent = ally.species.name; el('v1').textContent = Math.max(0, Math.ceil(ally.hp)); el('f1').style.width = Math.max(0, ally.hp / ally.maxHp * 100) + '%'; }
  el('v2').textContent = Math.max(0, Math.ceil(e.hp));
  el('f2').style.width = Math.max(0, e.hp / e.maxHp * 100) + '%';
}

function killEnemy() {
  const e = G.enemy;
  const p = e.group.position;
  for (let k = 0; k < 4; k++) {
    setTimeout(() => sparks.burst(p.x, 1.0 + k * 0.6, p.z, 70, 0xffd76a, { spread: 5.0, up: 7.5, life: 1.4, size: 3.2 }), k * 110);
  }
  scene.remove(e.group);
  G.enemy = null;
  el('bars').style.display = 'none';
  toast('魔獣を撃破!');
  G.fossils += 1;
  refreshHud();
  setTimeout(spawnEnemy, 16000);
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ================================================================= loop
const clock = new THREE.Clock();
let elapsed = 0, frames = 0, fpsT = 0, fps = 0;
const hiddenFromReflection = [
  rain.points, embers.points, fireflies.points, fog.mesh, bats.points,
  sparks.points, beacons.mesh, guide.mesh,
];

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  // ---- hunter movement
  const hp = hunter.group.position;
  const to = hunterState.target.clone().sub(hp);
  to.y = 0;
  const dist = to.length();
  const stopAt = hunterState.task ? 1.9 : 0.35;
  let sp = 0;
  if (dist > stopAt) {
    to.normalize();
    const v = Math.min(5.4, 1.2 + dist * 2.6);
    hp.addScaledVector(to, v * dt);
    hp.x = THREE.MathUtils.clamp(hp.x, -ARENA + 1, ARENA - 1);
    hp.z = THREE.MathUtils.clamp(hp.z, -ARENA + 1, ARENA - 1);
    sp = v;
    hunterState.facing = Math.atan2(to.x, to.z);
  }
  hunter.group.rotation.y = lerpAngle(hunter.group.rotation.y, hunterState.facing, 0.16);
  hunter.update(dt, hunter.action === 'dig' || hunter.action === 'cheer' ? 0 : sp);

  updateDig(dt);
  updateBattle(dt);
  updateGuide(dt);

  // ---- lazy camera follow
  cam.target.lerp(new THREE.Vector3(hp.x, 1.1, hp.z), 1 - Math.pow(0.0015, dt));
  camSmooth.yaw += (cam.yaw - camSmooth.yaw) * (1 - Math.pow(0.0006, dt));
  camSmooth.pitch += (cam.pitch - camSmooth.pitch) * (1 - Math.pow(0.0006, dt));
  camSmooth.dist += (cam.dist - camSmooth.dist) * (1 - Math.pow(0.004, dt));
  camSmooth.target.lerp(cam.target, 1 - Math.pow(0.02, dt));
  const cp = camSmooth;
  camera.position.set(
    cp.target.x + Math.sin(cp.yaw) * Math.cos(cp.pitch) * cp.dist,
    cp.target.y + Math.sin(cp.pitch) * cp.dist,
    cp.target.z + Math.cos(cp.yaw) * Math.cos(cp.pitch) * cp.dist);
  camera.lookAt(cp.target.x, cp.target.y + 1.1, cp.target.z);

  // ---- moonlight follows so shadows stay inside the map
  moon.position.set(cp.target.x - 34, 46, cp.target.z - 26);
  moon.target.position.set(cp.target.x, 0, cp.target.z);
  moon.target.updateMatrixWorld();

  // ---- fx uniforms
  occlusion.uFocusPos.value.set(cp.target.x, cp.target.y + 1.1, cp.target.z);
  occlusion.uFocusDist.value = camera.position.distanceTo(occlusion.uFocusPos.value);
  beacons.mat.uniforms.uTime.value = elapsed;
  guide.mat.uniforms.uTime.value = elapsed;
  rain.mat.uniforms.uTime.value = elapsed;
  rain.mat.uniforms.uCam.value.copy(camera.position);
  embers.mat.uniforms.uTime.value = elapsed;
  fireflies.mat.uniforms.uTime.value = elapsed;
  fog.mat.uniforms.uTime.value = elapsed;
  bats.mat.uniforms.uTime.value = elapsed;
  skyObj.mat.uniforms.uTime.value = elapsed;
  sparks.update(dt);

  pointLights.forEach((l, i) => {
    if (l.userData.flicker) {
      l.intensity = l.userData.base * (0.78 + Math.sin(elapsed * (9 + i * 2.3)) * 0.12 + Math.sin(elapsed * (23 + i * 5)) * 0.08);
    } else {
      l.intensity = l.userData.base * (0.9 + Math.sin(elapsed * 1.6 + i) * 0.14);
    }
  });

  // ---- planar reflection then final frame
  ground.update(renderer, scene, camera, elapsed, hiddenFromReflection);
  composer.render();

  // ---- hud
  frames++; fpsT += dt;
  if (fpsT > 0.5) {
    fps = frames / fpsT; frames = 0; fpsT = 0;
    el('perf').textContent = `${fps.toFixed(0)} FPS`;
    qHoldT += 0.5;
    if (qHoldT > 1.5) {
      if (fps < 55 && qLevel < QUALITY.length - 1) { qLevel++; applyQuality(); qHoldT = 0; }
      else if (fps > 75 && qLevel > 0) { qLevel--; applyQuality(); qHoldT = 0; }
    }
  }
  if (G.toastT > 0) { G.toastT -= dt; if (G.toastT <= 0) el('toast').style.opacity = '0'; }
}

refreshHud();
el('load').style.display = 'none';
tick();

window.__demo = { scene, camera, renderer, G, hunter, cam, hunterState, dig, world, sparks, spawnEnemy, spawnDino, SPECIES,
  setQuality(n) { qLevel = Math.max(0, Math.min(QUALITY.length - 1, n)); applyQuality(); qHoldT = -1e6; } };
