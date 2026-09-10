import * as THREE from 'three';
import { VoxBuilder, voxelMaterial } from './voxel.js';

const rand = (() => { let s = 1337; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const rr = (a, b) => a + rand() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));

export const ARENA = 16;          // playable radius-ish (square half-extent)

const PAL = {
  rock: 0x565c6b, rockD: 0x3e424e, rockL: 0x717988,
  dirt: 0x624c33, dirtD: 0x453421, sand: 0x8a734f,
  bone: 0xd9cca7, boneD: 0xb0a17e,
  wood: 0x4e3624, woodD: 0x36241a,
  canvas: 0xa8a08a, canvasD: 0x7d7663,
  banner: 0xa8342a, bannerD: 0x76211a,
  crystal: 0x59f0ff, crystalD: 0x1e7f96,
  rune: 0x8be0ff, fire: 0xff8a2a,
  moss: 0x40613f, iron: 0x8f9aa8,
};
const R_ROCK = { rough: 0.86, metal: 0.02, jitter: 0.10 };
const R_BONE = { rough: 0.60, metal: 0.02, jitter: 0.07 };
const R_WOOD = { rough: 0.9, metal: 0.0, jitter: 0.09 };
const R_CLOTH = { rough: 0.96, metal: 0.0, jitter: 0.08 };
const R_METAL = { rough: 0.35, metal: 0.85 };

function fbm2(x, y) {
  let v = 0, a = 0.5, fx = x, fy = y;
  for (let i = 0; i < 4; i++) {
    v += a * (Math.sin(fx * 1.7 + Math.cos(fy * 1.3) * 2.1) * 0.5 + 0.5);
    fx *= 2.02; fy *= 1.97; a *= 0.5;
  }
  return v;
}

// ===========================================================================
export function buildWorld(scene) {
  const mat = voxelMaterial();
  const b = new VoxBuilder();          // everything static, one draw call
  const emissivePoints = [];

  // ---------------------------------------------------------------- cliffs
  // A ring of voxel cliffs enclosing the arena; height rises with distance.
  const S = 1.0;
  const outer = 62;
  for (let x = -outer; x <= outer; x += 1) {
    for (let z = -outer; z <= outer; z += 1) {
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d < ARENA + 7) continue;
      const t = (d - (ARENA + 7)) / (outer - ARENA - 7);
      const n = fbm2(x * 0.09, z * 0.09);
      let h = Math.pow(t, 1.9) * 34 * (0.5 + n * 0.95);
      if (h < 0.6) continue;
      h = Math.round(h);
      if (d > ARENA + 18 && ((x + z) % 2 === 0)) continue;   // thin out far cells
      const step = d > ARENA + 16 ? 3 : 1;
      if ((x % step !== 0 || z % step !== 0) && d > ARENA + 16) continue;
      const w = d > ARENA + 16 ? 3 : 1;
      const top = h;
      const bodyH = Math.min(top, 6);
      const col = n > 0.62 ? PAL.rockL : (n < 0.4 ? PAL.rockD : PAL.rock);
      b.box(x, top - bodyH, z, w * S, bodyH, w * S, col, R_ROCK);
      if (n > 0.72 && d < ARENA + 16) b.box(x, top, z, 1, 0.55, 1, PAL.moss, { rough: 0.95 });
    }
  }

  // ------------------------------------------------------- arena rim wall
  for (let i = -ARENA - 2; i <= ARENA + 2; i++) {
    for (const [ax, az] of [[i, -ARENA - 2], [i, ARENA + 2], [-ARENA - 2, i], [ARENA + 2, i]]) {
      const h = 0.5 + fbm2(ax * 0.4, az * 0.4) * 1.1;
      b.box(ax, 0, az, 1, h, 1, fbm2(ax * .8, az * .8) > 0.55 ? PAL.rockL : PAL.rock, R_ROCK);
    }
  }

  // ------------------------------------------------------ scattered rubble
  for (let i = 0; i < 110; i++) {
    const a = rand() * Math.PI * 2, r = rr(3.5, ARENA + 1);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) > ARENA || Math.abs(z) > ARENA) continue;
    const s = rr(0.22, 0.6);
    b.box(x, 0, z, s, s * rr(0.5, 1.1), s, rand() > 0.5 ? PAL.rock : PAL.rockD, R_ROCK);
  }
  // ------------------------------------------------ giant fossil rib arch
  const archX = -2.0, archZ = -10.5;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const ang = t * Math.PI * 0.52;
      const rad = 11.5;
      const px = archX + side * Math.sin(ang) * rad;
      const py = Math.cos(ang) * rad * 0.98;
      if (py < 0.2) continue;
      const th = 1.5 - t * 0.35;
      b.box(px - th / 2, py - th / 2, archZ - 0.9, th, th, 1.8, i % 2 ? PAL.bone : PAL.boneD, R_BONE);
      // ribs hanging from spine
      for (let k = 1; k < 5; k++) {
        const rx = px - side * k * 0.85, ry = py - k * 1.55 - t * 1.2;
        if (ry < 0.4) break;
        b.box(rx - 0.45, ry, archZ - 0.6, 0.9, 0.9, 1.2, PAL.boneD, R_BONE);
      }
    }
  }
  // vertebrae ridge across the top
  for (let i = -4; i <= 4; i++) {
    b.box(archX + i * 1.5 - 0.6, 13.2 - Math.abs(i) * 0.42, archZ - 1.1, 1.2, 1.2, 2.2, PAL.bone, R_BONE);
    b.box(archX + i * 1.5 - 0.3, 14.3 - Math.abs(i) * 0.42, archZ - 0.7, 0.6, 1.4, 1.4, PAL.boneD, R_BONE);
  }
  // skull at base
  b.box(archX + 11.5, 0, archZ + 3.0, 4.2, 3.0, 5.6, PAL.bone, R_BONE);
  b.box(archX + 12.2, 0.4, archZ + 8.2, 2.8, 1.8, 3.2, PAL.boneD, R_BONE);
  b.box(archX + 12.3, 1.9, archZ + 6.2, 0.9, 0.9, 0.9, 0x000000, { rough: 1 });
  b.box(archX + 14.0, 1.9, archZ + 6.2, 0.9, 0.9, 0.9, 0x000000, { rough: 1 });

  // -------------------------------------------------------- revival altar
  const AX = 9.5, AZ = -5.5;
  for (let ring = 0; ring < 3; ring++) {
    const rad = 5.2 - ring * 1.1;
    const h = 0.35 + ring * 0.35;
    const steps = 40 + ring * 6;
    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      const x = AX + Math.cos(a) * rad, z = AZ + Math.sin(a) * rad;
      b.box(x - 0.45, 0, z - 0.45, 0.95, h, 0.95, i % 3 === 0 ? PAL.rockL : PAL.rock, R_ROCK);
    }
  }
  b.box(AX - 3.4, 0, AZ - 3.4, 6.8, 1.05, 6.8, PAL.rockD, { rough: 0.62, metal: 0.05 });
  // glowing runes on the platform
  const runeSpots = [[0,-2.6],[2.6,0],[0,2.6],[-2.6,0],[1.85,1.85],[-1.85,1.85],[1.85,-1.85],[-1.85,-1.85]];
  runeSpots.forEach(([dx, dz]) => {
    b.box(AX + dx - 0.45, 1.05, AZ + dz - 0.45, 0.9, 0.06, 0.9, PAL.rune,
      { emissive: PAL.rune, emissiveIntensity: 1.05, rough: 0.4 });
  });
  for (let i = 0; i < 56; i++) {
    const a = i / 56 * Math.PI * 2;
    b.box(AX + Math.cos(a) * 3.0 - 0.16, 1.05, AZ + Math.sin(a) * 3.0 - 0.16, 0.32, 0.05, 0.32, PAL.rune,
      { emissive: PAL.rune, emissiveIntensity: 0.8, rough: 0.4 });
  }
  // four bone pillars with crystals
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const px = AX + Math.cos(a) * 4.4, pz = AZ + Math.sin(a) * 4.4;
    for (let y = 0; y < 4; y++) {
      const w = 1.05 - y * 0.09;
      b.box(px - w / 2, 0.6 + y * 0.85, pz - w / 2, w, 0.87, w, y % 2 ? PAL.bone : PAL.boneD, R_BONE);
    }
    b.box(px - 0.34, 4.0, pz - 0.34, 0.68, 0.95, 0.68, PAL.crystal,
      { emissive: PAL.crystal, emissiveIntensity: 0.62, rough: 0.15, metal: 0.1 });
    emissivePoints.push({ x: px, y: 4.5, z: pz, color: 0x59f0ff, intensity: 0.85, dist: 10 });
  }
  // centre crystal spire
  for (let y = 0; y < 6; y++) {
    const w = 1.5 - y * 0.21;
    b.box(AX - w / 2, 1.05 + y * 0.8, AZ - w / 2, w, 0.82, w, PAL.crystal,
      { emissive: PAL.crystal, emissiveIntensity: 0.42 + y * 0.09, rough: 0.12, metal: 0.15 });
  }
  emissivePoints.push({ x: AX, y: 4.2, z: AZ, color: 0x59f0ff, intensity: 3.0, dist: 20 });

  // ---------------------------------------------------------------- camp
  const camps = [[-10.0, -1.0, 0.5], [-6.0, 8.5, -0.7]];
  camps.forEach(([cx, cz, rot]) => {
    // tent
    const wsp = 5.2;
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const h = Math.sin((1 - t) * Math.PI * 0.5) * 4.0;
      const w = wsp * (0.35 + t * 0.65);
      b.box(cx - w / 2, 0, cz - 2.6 + i * 0.62, w, Math.max(0.4, h), 0.66,
        i % 2 ? PAL.canvas : PAL.canvasD, R_CLOTH);
    }
    b.box(cx - 0.3, 0, cz - 3.2, 0.6, 4.6, 0.6, PAL.wood, R_WOOD);
    b.box(cx - 3.0, 0, cz - 3.4, 0.45, 3.2, 0.45, PAL.wood, R_WOOD);
    b.box(cx + 2.6, 0, cz - 3.4, 0.45, 3.2, 0.45, PAL.wood, R_WOOD);
    // crates + barrels
    for (let i = 0; i < 4; i++) {
      const bx = cx + rr(-4.5, 4.5), bz = cz + rr(2.6, 5.2);
      const s = rr(0.8, 1.3);
      b.box(bx, 0, bz, s, s, s, PAL.wood, R_WOOD);
      b.box(bx - 0.05, s * 0.42, bz - 0.05, s + 0.1, s * 0.16, s + 0.1, PAL.iron, R_METAL);
    }
    // banner pole
    const px = cx + 4.6, pz = cz - 1.2;
    b.box(px - 0.22, 0, pz - 0.22, 0.44, 7.0, 0.44, PAL.wood, R_WOOD);
    b.box(px - 0.5, 6.9, pz - 0.5, 1.0, 0.5, 1.0, PAL.iron, R_METAL);
  });

  // campfire
  const FX = -7.0, FZ = 2.0;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    b.box(FX + Math.cos(a) * 1.5 - 0.3, 0, FZ + Math.sin(a) * 1.5 - 0.3, 0.6, 0.45, 0.6, PAL.rock, R_ROCK);
  }
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    b.box(FX + Math.cos(a) * 0.5 - 0.16, 0.1, FZ + Math.sin(a) * 0.5 - 0.16, 0.34, 1.5, 0.34, PAL.woodD, R_WOOD);
  }
  b.box(FX - 0.55, 0.15, FZ - 0.55, 1.1, 0.7, 1.1, 0xff9a3a, { emissive: 0xff7a20, emissiveIntensity: 1.7, rough: 0.5 });
  emissivePoints.push({ x: FX, y: 1.2, z: FZ, color: 0xff8a30, intensity: 7.5, dist: 22, flicker: true });

  // ------------------------------------------------------------- lanterns
  const lanterns = [[-2.0, 8.0], [12.0, 5.0], [3.0, 12.0], [-12.5, -2.5], [9.5, -11.0], [-5.5, -7.5]];
  lanterns.forEach(([lx, lz]) => {
    b.box(lx - 0.13, 0, lz - 0.13, 0.26, 2.55, 0.26, PAL.woodD, R_WOOD);
    b.box(lx - 0.32, 2.42, lz - 0.32, 0.64, 0.2, 0.64, PAL.iron, R_METAL);
    b.box(lx - 0.3, 1.68, lz - 0.3, 0.6, 0.1, 0.6, PAL.iron, R_METAL);
    b.box(lx - 0.19, 1.78, lz - 0.19, 0.38, 0.5, 0.38, 0xffc27a,
      { emissive: 0xff9a3c, emissiveIntensity: 0.85, rough: 0.35 });
    for (let e = 0; e < 4; e++) {
      const ex = (e % 2 ? 1 : -1) * 0.26, ez = (e < 2 ? 1 : -1) * 0.26;
      b.box(lx + ex - 0.05, 1.76, lz + ez - 0.05, 0.1, 0.54, 0.1, PAL.iron, R_METAL);
    }
    emissivePoints.push({ x: lx, y: 2.1, z: lz, color: 0xffa040, intensity: 2.3, dist: 12, flicker: true });
  });

  // --------------------------------------------------- broken bone pillars
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, r = rr(9, ARENA - 1.0);
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    const h = ri(2, 6);
    for (let y = 0; y < h; y++) {
      const w = 1.25 - y * 0.09;
      b.box(px - w / 2, y * 1.0, pz - w / 2, w, 1.02, w, y % 2 ? PAL.boneD : PAL.bone, R_BONE);
    }
  }

  // ------------------------------------------------------- distant giants
  // far skeletal dragon silhouette behind the cliffs (fog does the rest)
  const DX = -32, DZ = -46;
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    const x = DX + t * 46;
    const y = 20 + Math.sin(t * Math.PI) * 20 - t * 4;
    b.box(x, y, DZ, 2.4, 2.4, 2.4, PAL.boneD, { rough: 0.75, jitter: 0.05 });
    if (i % 3 === 0) {
      for (let k = 1; k < 6; k++) {
        b.box(x, y - k * 2.3, DZ - k * 0.6, 1.6, 1.8, 1.6, PAL.boneD, { rough: 0.75, jitter: 0.05 });
      }
    }
  }
  // wing spars
  for (let w = 0; w < 7; w++) {
    for (let k = 0; k < 9; k++) {
      b.box(DX + 16 + w * 2.2 + k * 1.4, 34 - k * 1.9 - w * 1.4, DZ - 2, 1.5, 1.5, 1.5, PAL.boneD, { rough: 0.75, jitter: 0.05 });
    }
  }
  // far mountain range
  for (let i = -70; i < 70; i += 3) {
    const h = 22 + fbm2(i * 0.05, 9.1) * 34;
    b.box(i, 0, -78, 3.2, h, 6, 0x2a3140, { rough: 0.95, jitter: 0.04 });
    b.box(i * 1.1, 0, 76, 3.4, h * 0.8, 6, 0x252b38, { rough: 0.95, jitter: 0.04 });
    b.box(-80, 0, i * 1.05, 6, h * 0.9, 3.4, 0x272e3c, { rough: 0.95, jitter: 0.04 });
    b.box(80, 0, i * 1.05, 6, h * 0.85, 3.4, 0x272e3c, { rough: 0.95, jitter: 0.04 });
  }

  const mesh = new THREE.Mesh(b.geometry(), mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'world';
  scene.add(mesh);

  return { mesh, emissivePoints, altar: new THREE.Vector3(AX, 1.05, AZ), campfire: new THREE.Vector3(FX, 0, FZ) };
}

// ===========================================================================
// Dig-site tiles: 1x1 mounds that can be excavated
// ===========================================================================
export function buildDigSites(scene, count = 26) {
  const mat = voxelMaterial();
  const sites = [];
  const group = new THREE.Group();
  scene.add(group);
  for (let i = 0; i < count; i++) {
    let x, z, ok = false, tries = 0;
    while (!ok && tries++ < 60) {
      const a = rand() * Math.PI * 2, r = rr(4.0, ARENA - 2.2);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      ok = sites.every(s => (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 > 10) &&
           ((x - 9.5) ** 2 + (z + 5.5) ** 2 > 42);
      if (Math.abs(x) > ARENA - 2 || Math.abs(z) > ARENA - 2) ok = false;
    }
    const b = new VoxBuilder();
    const w = rr(1.15, 1.6);
    b.box(-w / 2, 0, -w / 2, w, rr(0.30, 0.5), w, PAL.dirt, { rough: 0.94, jitter: 0.12 });
    b.box(-w / 2 + 0.25, 0.3, -w / 2 + 0.25, w - 0.5, 0.28, w - 0.5, PAL.dirtD, { rough: 0.94, jitter: 0.12 });
    b.box(-0.26, 0.46, -0.26, 0.52, 0.16, 0.52, PAL.sand, { rough: 0.95 });
    // a bone tip peeking out, hinting at the fossil
    b.box(-0.16, 0.5, -0.34, 0.32, 0.42, 0.32, PAL.boneD, R_BONE);
    for (let k = 0; k < 5; k++) {
      b.box(rr(-w, w) * 0.6, 0, rr(-w, w) * 0.6, 0.26, 0.17, 0.26, PAL.rockD, R_ROCK);
    }
    const m = new THREE.Mesh(b.geometry(), mat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.set(x, 0, z);
    m.rotation.y = rand() * Math.PI * 2;
    group.add(m);

    // marker flag so the player can see it from across the arena
    const fb = new VoxBuilder();
    fb.box(-0.08, 0, -0.08, 0.16, 2.5, 0.16, PAL.woodD, R_WOOD);
    fb.box(0.07, 1.74, -0.06, 0.78, 0.52, 0.1, PAL.banner,
      { rough: 0.9, emissive: 0xc03a26, emissiveIntensity: 0.22, jitter: 0.06 });
    fb.box(0.07, 1.66, -0.06, 0.78, 0.09, 0.1, 0xffd27a,
      { emissive: 0xffb040, emissiveIntensity: 0.7, rough: 0.5 });
    fb.box(-0.11, 2.5, -0.11, 0.22, 0.22, 0.22, 0xffd27a,
      { emissive: 0xffa83c, emissiveIntensity: 1.15, rough: 0.4 });
    const flag = new THREE.Mesh(fb.geometry(), mat);
    flag.castShadow = true;
    flag.position.set(x + 1.0, 0, z + 0.6);
    group.add(flag);

    sites.push({ pos: new THREE.Vector3(x, 0, z), mesh: m, flag, hp: 3, done: false });
  }
  return { group, sites };
}

// ===========================================================================
// Sky dome + moon
// ===========================================================================
export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(400, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `
      varying vec3 vP; uniform float uTime;
      float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){v+=a*n2(p);p*=2.05;a*=.5;} return v; }
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
        vec3 horizon = vec3(0.115, 0.150, 0.225);
        vec3 mid     = vec3(0.052, 0.083, 0.152);
        vec3 zenith  = vec3(0.016, 0.028, 0.062);
        vec3 col = mix(horizon, mid, smoothstep(0.46, 0.62, h));
        col = mix(col, zenith, smoothstep(0.60, 0.95, h));
        // warm glow where the camp is
        col += vec3(0.10,0.05,0.02) * pow(max(0.0, dot(d, normalize(vec3(-0.6,0.12,0.5)))), 8.0);
        // moon
        vec3 md = normalize(vec3(-0.45, 0.52, -0.72));
        float md0 = dot(d, md);
        col += vec3(0.55,0.66,0.95) * pow(max(0.0, md0), 900.0) * 3.2;
        col += vec3(0.20,0.28,0.45) * pow(max(0.0, md0), 22.0) * 0.55;
        // stars
        vec2 su = vec2(atan(d.z,d.x)*2.2, d.y*3.4);
        float st = h21(floor(su*70.0));
        float tw = 0.5 + 0.5*sin(uTime*1.7 + st*40.0);
        col += vec3(0.85,0.9,1.0) * smoothstep(0.9965, 0.9995, st) * smoothstep(0.35,0.9,h) * (0.5+tw*0.9);
        // clouds
        float cl = fbm(su*1.15 + vec2(uTime*0.010, 0.0));
        float cm = smoothstep(0.52, 0.86, cl) * smoothstep(0.02, 0.42, h) * (1.0 - smoothstep(0.75, 1.0, h));
        col = mix(col, vec3(0.085,0.105,0.155), cm*0.85);
        col += vec3(0.06,0.075,0.11) * cm * pow(max(0.0,md0)*0.5+0.5, 6.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return { sky, mat };
}
