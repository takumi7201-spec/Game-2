import * as THREE from 'three';
import { VoxBuilder, voxelMaterial } from './voxel.js';

export const VOX = 0.128;

const MAT = voxelMaterial();

function mkPart(build) {
  const b = new VoxBuilder();
  build(b);
  const m = new THREE.Mesh(b.geometry(), MAT);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// pivot group in voxel space; meshes are already modelled around their pivot
function joint(mesh, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh);
  return g;
}

const C = {
  skin: 0xa97a55, skinD: 0x8a5f40,
  armor: 0x46536a, armorD: 0x2f3a4c, armorL: 0x62718c,
  bone: 0xe8dfc6, boneD: 0xbcae8c,
  cloth: 0xa13a2c, clothD: 0x74241c,
  leather: 0x5c3f29, leatherD: 0x3f2a1b,
  gold: 0xd9a441, steel: 0xb9c2cf,
  eye: 0x9fe8ff,
};
const MET = { rough: 0.32, metal: 0.85 };
const MET2 = { rough: 0.45, metal: 0.7 };
const CLOTH = { rough: 0.95, metal: 0.0, jitter: 0.09 };
const BONE = { rough: 0.62, metal: 0.02, jitter: 0.07 };
const LEATH = { rough: 0.78, metal: 0.05 };

// ===========================================================================
// HUNTER
// ===========================================================================
export function createHunter() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(VOX);
  root.add(body);

  // ---- legs -------------------------------------------------------------
  const mkLeg = (s) => mkPart(b => {
    b.box(-1.7, -7.0, -1.7, 3.4, 7.0, 3.4, C.leather, LEATH);            // thigh/shin
    b.box(-1.9, -7.3, -2.4, 3.8, 1.9, 4.6, C.armorD, MET2);              // boot
    b.box(-2.0, -5.9, -2.0, 4.0, 1.5, 4.0, C.armor, MET2);               // knee plate
    b.box(-2.1, -1.4, -2.1, 4.2, 1.6, 4.2, C.armorD, MET2);              // hip plate
    b.box(-1.6, -7.5, 1.4, 3.2, 0.8, 1.6, C.bone, BONE);                 // toe claw
  });
  const legL = joint(mkLeg(-1), -2.2, 7.0, 0);
  const legR = joint(mkLeg(1), 2.2, 7.0, 0);

  // ---- torso ------------------------------------------------------------
  const torsoMesh = mkPart(b => {
    b.box(-4.0, 7.0, -2.4, 8.0, 7.6, 4.8, C.armor, MET2);                 // core
    b.box(-4.4, 12.0, -2.8, 8.8, 2.6, 5.6, C.armorL, MET);                // chest plate
    b.box(-2.2, 12.4, 2.6, 4.4, 2.4, 0.9, C.bone, BONE);                  // sternum bone
    b.box(-4.6, 9.6, -2.6, 9.2, 1.5, 5.2, C.leatherD, LEATH);             // belt
    b.box(-1.4, 9.4, 2.5, 2.8, 2.0, 1.0, C.gold, MET);                    // buckle
    b.box(-4.9, 13.2, -1.6, 1.6, 2.2, 3.2, C.bone, BONE);                 // shoulder bone L
    b.box(3.3, 13.2, -1.6, 1.6, 2.2, 3.2, C.bone, BONE);                  // shoulder bone R
    b.box(-1.3, 14.4, -1.3, 2.6, 1.2, 2.6, C.skinD, { rough: 0.85 });     // neck
    // hip skirt (fabric)
    b.box(-4.2, 6.2, -2.6, 8.4, 3.6, 1.1, C.cloth, CLOTH);
    b.box(-4.2, 6.2, 1.5, 8.4, 3.6, 1.1, C.cloth, CLOTH);
  });

  // ---- head / helm ------------------------------------------------------
  const headMesh = mkPart(b => {
    b.box(-2.6, 0.0, -2.6, 5.2, 5.0, 5.2, C.skin, { rough: 0.86 });       // head
    b.box(-2.9, 3.2, -2.9, 5.8, 2.6, 5.8, C.bone, BONE);                  // helm dome
    b.box(-2.9, 2.4, 2.2, 5.8, 1.4, 0.9, C.boneD, BONE);                  // brow
    b.box(-1.4, 1.4, 2.5, 0.9, 0.9, 0.7, C.eye, { emissive: 0x8fe8ff, emissiveIntensity: 1.6, rough: 0.3 });
    b.box(0.5, 1.4, 2.5, 0.9, 0.9, 0.7, C.eye, { emissive: 0x8fe8ff, emissiveIntensity: 1.6, rough: 0.3 });
    b.box(-2.4, -0.4, 1.6, 4.8, 1.6, 1.4, C.clothD, CLOTH);               // scarf/mask
    // horns
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      b.box(-3.0 - t * 1.5, 4.6 + i * 0.95, -0.4 - t * 0.9, 1.5 - t * 0.4, 1.1, 1.5 - t * 0.4, C.bone, BONE);
      b.box(1.5 + t * 1.5 - (1.5 - t * 0.4) + (1.5 - t * 0.4), 4.6 + i * 0.95, -0.4 - t * 0.9, 1.5 - t * 0.4, 1.1, 1.5 - t * 0.4, C.bone, BONE);
    }
    // plume
    for (let i = 0; i < 3; i++) {
      b.box(-0.7, 5.6 + i * 1.1, -2.2 - i * 0.9, 1.4, 1.3, 1.6, i === 0 ? C.cloth : C.clothD, CLOTH);
    }
  });

  // ---- arms -------------------------------------------------------------
  const mkArm = () => mkPart(b => {
    b.box(-1.5, -6.4, -1.5, 3.0, 6.4, 3.0, C.skinD, { rough: 0.85 });
    b.box(-1.9, -2.0, -1.9, 3.8, 2.4, 3.8, C.armorL, MET);                // pauldron
    b.box(-1.7, -5.4, -1.7, 3.4, 1.8, 3.4, C.leather, LEATH);             // bracer
    b.box(-1.6, -7.4, -1.6, 3.2, 1.2, 3.2, C.leatherD, LEATH);            // glove
  });
  const armL = joint(mkArm(), -5.2, 14.0, 0);
  const armR = joint(mkArm(), 5.2, 14.0, 0);

  // ---- pickaxe held in right hand --------------------------------------
  const pick = mkPart(b => {
    for (let i = 0; i < 9; i++) b.box(-0.5, -1.5 + i * 1.0, -0.5, 1.1, 1.05, 1.1, i % 2 ? C.leather : C.leatherD, LEATH);
    b.box(-0.8, 7.2, -0.8, 1.7, 1.6, 1.7, C.steel, MET);
    b.box(-3.4, 7.4, -0.7, 2.8, 1.3, 1.5, C.steel, MET);                  // head left
    b.box(0.8, 7.4, -0.7, 2.8, 1.3, 1.5, C.steel, MET);
    b.box(-4.6, 6.9, -0.6, 1.4, 1.5, 1.3, C.bone, BONE);                  // bone tip
    b.box(3.3, 6.9, -0.6, 1.4, 1.5, 1.3, C.bone, BONE);
  });
  const pickG = new THREE.Group();
  pick.position.set(0, -3.2, 0);
  pickG.add(pick);
  pickG.position.set(0, -6.8, 0.7);
  pickG.rotation.set(0.28, 0, -0.16);
  armR.add(pickG);

  // ---- cape -------------------------------------------------------------
  const capeSegs = [];
  const capeRoot = new THREE.Group();
  capeRoot.position.set(0, 14.2, -2.7);
  body.add(capeRoot);
  let capeParent = capeRoot;
  for (let i = 0; i < 4; i++) {
    const w = 8.6 - i * 1.0;
    const seg = mkPart(b => {
      b.box(-w / 2, -3.1, -0.55, w, 3.2, 1.1, i < 2 ? C.cloth : C.clothD, CLOTH);
      if (i === 3) b.box(-w / 2, -3.9, -0.5, w, 0.9, 1.0, C.clothD, CLOTH);
    });
    const g = new THREE.Group();
    g.position.set(0, i === 0 ? 0 : -3.1, 0);
    g.add(seg);
    capeParent.add(g);
    capeParent = g;
    capeSegs.push(g);
  }

  body.add(torsoMesh);
  const headJ = joint(headMesh, 0, 15.0, 0);
  body.add(headJ, legL, legR, armL, armR);

  // small warm rim light that travels with the hunter so it never goes black
  const rim = new THREE.PointLight(0xffb066, 0.85, 6.0, 2.0);
  rim.position.set(0, 1.25, 0.35);
  root.add(rim);

  const api = {
    group: root, rim,
    height: 21 * VOX,
    t: 0, action: 'idle', actionT: 0,
    setAction(a) { if (this.action !== a) { this.action = a; this.actionT = 0; } },
    update(dt, speed) {
      this.t += dt; this.actionT += dt;
      const t = this.t;
      const walk = Math.min(1, speed / 3.0);
      const f = t * (6.0 + walk * 5.0);
      const sw = Math.sin(f) * walk;
      const sw2 = Math.sin(f * 2) * walk;

      legL.rotation.x = sw * 0.85;
      legR.rotation.x = -sw * 0.85;
      armL.rotation.x = -sw * 0.65;
      armR.rotation.x = sw * 0.5;
      armL.rotation.z = 0.08 + walk * 0.05;
      armR.rotation.z = -0.08 - walk * 0.05;

      const breathe = Math.sin(t * 1.9) * 0.02;
      body.position.y = (Math.abs(sw2) * 0.10 * walk + breathe) ;
      body.rotation.z = sw * 0.045;
      headJ.rotation.y = Math.sin(t * 0.7) * 0.16 * (1 - walk);
      headJ.rotation.x = -0.05 + Math.sin(t * 1.3) * 0.04;

      // dig / swing overrides
      if (this.action === 'dig') {
        const p = Math.min(1, this.actionT / 0.55);
        const s = Math.sin(p * Math.PI);
        armR.rotation.x = -2.1 + s * 2.9;
        armL.rotation.x = -1.5 + s * 2.1;
        body.rotation.x = s * 0.42;
        legL.rotation.x = 0.25; legR.rotation.x = -0.2;
      } else if (this.action === 'cheer') {
        armR.rotation.x = -2.6 + Math.sin(t * 9) * 0.2;
        armL.rotation.x = -2.6 - Math.sin(t * 9) * 0.2;
        body.rotation.x = -0.12;
      } else {
        body.rotation.x = walk * 0.13;
      }

      // cape follows with damped lag
      const lag = 0.28 + walk * 0.55;
      capeSegs.forEach((g, i) => {
        g.rotation.x = lag * (0.45 + i * 0.16) + Math.sin(t * 3.1 + i * 0.9) * (0.05 + walk * 0.07);
        g.rotation.z = Math.sin(t * 2.3 + i * 0.7) * (0.03 + walk * 0.05);
      });
      rim.intensity = 1.0 + Math.sin(t * 7.3) * 0.12;
    },
  };
  return api;
}

// ===========================================================================
// DINOSAURS  (kind: 'raptor' | 'trex' | 'stego')
// ===========================================================================
export function createDino(kind = 'raptor', tint = null) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(VOX);
  root.add(body);

  const skinBase = tint !== null ? tint : (kind === 'trex' ? 0x6d4b39 : kind === 'stego' ? 0x4a6b52 : 0x7a6a3f);
  const skinDark = new THREE.Color(skinBase).multiplyScalar(0.62).getHex();
  const belly = new THREE.Color(skinBase).lerp(new THREE.Color(0xe8d9b0), 0.55).getHex();
  const SK = { rough: 0.82, metal: 0.03, jitter: 0.10 };
  const scale = kind === 'trex' ? 2.0 : kind === 'stego' ? 1.5 : 1.0;

  const torso = mkPart(b => {
    // barrel body
    b.box(-3.2, 6.0, -6.0, 6.4, 6.4, 12.0, skinBase, SK);
    b.box(-2.6, 5.4, -4.6, 5.2, 1.4, 9.2, belly, SK);           // belly
    b.box(-3.4, 10.4, -5.2, 6.8, 1.3, 10.4, skinDark, SK);      // back ridge
    // spines
    for (let i = 0; i < 7; i++) {
      b.box(-0.6, 11.4, -4.8 + i * 1.5, 1.2, 1.1 + Math.sin(i / 6 * Math.PI) * 1.5, 1.1, C.bone, BONE);
    }
    b.box(-2.2, 8.0, 5.4, 4.4, 3.4, 1.6, skinBase, SK);         // shoulders
  });
  body.add(torso);

  const neck = new THREE.Group();
  neck.position.set(0, 10.0, 5.4);
  const neckMesh = mkPart(b => {
    b.box(-1.7, -0.8, -0.4, 3.4, 3.8, 4.0, skinBase, SK);
  });
  neck.add(neckMesh);
  body.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 2.4, 3.4);
  const headMesh = mkPart(b => {
    if (kind === 'trex') {
      b.box(-2.2, -1.4, 0, 4.4, 4.2, 7.0, skinBase, SK);
      b.box(-2.0, -2.4, 0.4, 4.0, 1.4, 6.2, belly, SK);           // jaw
      for (let i = 0; i < 6; i++) {                                // teeth
        b.box(-1.9, -1.5, 1.0 + i * 1.0, 0.7, 1.1, 0.7, C.bone, BONE);
        b.box(1.2, -1.5, 1.0 + i * 1.0, 0.7, 1.1, 0.7, C.bone, BONE);
      }
      b.box(-2.5, 1.6, 1.0, 1.2, 1.6, 1.6, C.bone, BONE);         // brow horns
      b.box(1.3, 1.6, 1.0, 1.2, 1.6, 1.6, C.bone, BONE);
    } else {
      b.box(-1.6, -1.0, 0, 3.2, 3.2, 5.4, skinBase, SK);
      b.box(-1.4, -1.9, 0.4, 2.8, 1.1, 4.8, belly, SK);
      for (let i = 0; i < 4; i++) {
        b.box(-1.35, -1.1, 1.0 + i * 1.0, 0.6, 0.9, 0.6, C.bone, BONE);
        b.box(0.75, -1.1, 1.0 + i * 1.0, 0.6, 0.9, 0.6, C.bone, BONE);
      }
      b.box(-0.6, 2.1, 0.6, 1.2, 1.4, 2.6, skinDark, SK);          // crest
    }
    const ec = kind === 'trex' ? 0xff7a3c : 0xffd24a;
    b.box(-1.75, 0.9, 2.6, 0.8, 0.8, 0.8, ec, { emissive: ec, emissiveIntensity: 2.2, rough: 0.3 });
    b.box(0.95, 0.9, 2.6, 0.8, 0.8, 0.8, ec, { emissive: ec, emissiveIntensity: 2.2, rough: 0.3 });
  });
  head.add(headMesh);
  neck.add(head);

  // tail chain
  const tailSegs = [];
  let tp = body;
  for (let i = 0; i < 5; i++) {
    const w = 3.2 - i * 0.55;
    const seg = mkPart(b => {
      b.box(-w / 2, -w * 0.52, -3.5, w, w * 1.04, 3.6, i % 2 ? skinBase : skinDark, SK);
      if (i >= 2) b.box(-0.5, w * 0.52, -3.0, 1.0, 1.2 + (4 - i) * 0.3, 1.2, C.bone, BONE);
    });
    const g = new THREE.Group();
    g.position.set(0, i === 0 ? 9.0 : 0, i === 0 ? -5.6 : -3.5);
    g.add(seg);
    tp.add(g);
    tp = g;
    tailSegs.push(g);
  }

  const mkLeg2 = (big) => mkPart(b => {
    b.box(-1.5, -3.2, -1.2, 3.0, 3.6, 3.4, skinBase, SK);       // thigh
    b.box(-1.2, -6.4, -0.9, 2.4, 3.4, 2.6, skinDark, SK);       // shin
    b.box(-1.4, -7.2, -1.2, 2.8, 1.0, 4.0, skinBase, SK);       // foot
    b.box(-1.3, -7.3, 2.4, 0.8, 0.9, 1.4, C.bone, BONE);
    b.box(0.5, -7.3, 2.4, 0.8, 0.9, 1.4, C.bone, BONE);
  });
  const legL = joint(mkLeg2(), -2.8, 7.4, -1.0);
  const legR = joint(mkLeg2(), 2.8, 7.4, -1.0);
  body.add(legL, legR);

  const mkArm2 = () => mkPart(b => {
    b.box(-0.8, -3.4, -0.7, 1.6, 3.6, 1.6, skinBase, SK);
    b.box(-0.7, -4.6, -0.6, 1.4, 1.4, 2.2, skinDark, SK);
    b.box(-0.6, -4.8, 1.4, 0.6, 0.8, 1.2, C.bone, BONE);
  });
  const armL = joint(mkArm2(), -3.0, 10.2, 4.2);
  const armR = joint(mkArm2(), 3.0, 10.2, 4.2);
  body.add(armL, armR);

  root.scale.setScalar(scale);

  const api = {
    group: root, kind, t: Math.random() * 10, action: 'idle', actionT: 0,
    height: 14 * VOX * scale,
    setAction(a) { if (this.action !== a) { this.action = a; this.actionT = 0; } },
    update(dt, speed) {
      this.t += dt; this.actionT += dt;
      const t = this.t;
      const walk = Math.min(1, speed / 2.5);
      const f = t * (4.0 + walk * 4.5);
      const sw = Math.sin(f) * (0.35 + walk * 0.75);
      legL.rotation.x = sw; legR.rotation.x = -sw;
      armL.rotation.x = -0.7 - sw * 0.3; armR.rotation.x = -0.7 + sw * 0.3;
      body.position.y = Math.abs(Math.sin(f * 2)) * 0.10 * walk + Math.sin(t * 1.6) * 0.02;
      body.rotation.x = 0.12 + walk * 0.16;
      neck.rotation.x = -0.35 - walk * 0.18 + Math.sin(t * 1.7) * 0.05;
      head.rotation.x = 0.25 + Math.sin(t * 2.3) * 0.06;
      head.rotation.y = Math.sin(t * 0.9) * 0.2 * (1 - walk);
      tailSegs.forEach((g, i) => {
        g.rotation.y = Math.sin(f * 0.8 - i * 0.55) * (0.10 + walk * 0.16);
        g.rotation.x = (i === 0 ? -0.12 : 0.02) + Math.sin(t * 2.1 - i * 0.6) * 0.05;
      });
      if (this.action === 'roar') {
        const p = Math.min(1, this.actionT / 1.1);
        const s = Math.sin(p * Math.PI);
        neck.rotation.x = -0.35 - s * 0.85;
        head.rotation.x = 0.25 + s * 0.75;
        body.position.y += s * 0.25;
      } else if (this.action === 'attack') {
        const p = Math.min(1, this.actionT / 0.5);
        const s = Math.sin(p * Math.PI);
        neck.rotation.x = -0.35 + s * 0.9;
        head.rotation.x = 0.25 - s * 0.5;
        body.rotation.x = 0.12 + s * 0.35;
      } else if (this.action === 'hurt') {
        const p = Math.min(1, this.actionT / 0.4);
        const s = Math.sin(p * Math.PI);
        body.rotation.z = s * 0.28;
        neck.rotation.x = -0.35 + s * 0.3;
      } else {
        body.rotation.z = 0;
      }
    },
  };
  return api;
}
