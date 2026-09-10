// The fossil digger: a voxel explorer with a hand-animated rig.
import * as THREE from '../vendor/three/three.module.js';
import { VoxelBuilder, toonMaterial, addOutline } from './lib/voxel.js';
import { clamp, damp, lerp } from './lib/math.js';
import { groundAt, clampToWalkable, isWalkable } from './world/terrain.js';

const SKIN = 0xf6c9a0, SKIN_D = 0xe0aa82;
const COAT = 0x3f7fd4, COAT_D = 0x2f63aa, TRIM = 0xffd15c;
const PANTS = 0x4d5673, BOOT = 0x7a4f2c, GLOVE = 0xd08347;
const CAP = 0xe2564a, CAP_D = 0xb63f36;
const HAIR = 0x63401f, HAIR_D = 0x4a2e15, SCARF = 0xf2e7cf;
const BROW = 0x4a2e15, BLUSH = 0xef9d8a, IRIS = 0x3f6ea8, INK = 0x27303f;
const PACK = 0x8a5a34, STEEL = 0xb9c6d4;

function part(build, outline = 0.019) {
  const b = new VoxelBuilder();
  build(b);
  const m = new THREE.Mesh(b.build(), toonMaterial({ vertexColors: true }));
  m.castShadow = true;
  m.receiveShadow = false;
  if (outline > 0) addOutline(m, outline);
  return m;
}

export function createCharacter(scene) {
  const root = new THREE.Group();
  root.name = 'digger';

  const body = new THREE.Group();          // bob / lean
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.82;
  body.add(hips);

  // --- torso -------------------------------------------------------------
  const torso = part((b) => {
    b.box(0, 0.36, 0, 0.64, 0.74, 0.42, COAT);
    b.box(0, 0.62, 0, 0.7, 0.2, 0.46, COAT_D);          // shoulders
    b.box(0, 0.06, 0, 0.68, 0.14, 0.46, TRIM);          // belt
    b.box(0, 0.06, 0.24, 0.16, 0.18, 0.06, STEEL);      // buckle
    b.box(0, 0.4, 0.22, 0.14, 0.5, 0.03, TRIM);         // zip
    b.box(0.2, 0.3, 0.23, 0.18, 0.2, 0.03, COAT_D);     // pocket
    b.box(-0.2, 0.3, 0.23, 0.18, 0.2, 0.03, COAT_D);
    // backpack
    b.box(0, 0.42, -0.32, 0.5, 0.56, 0.26, PACK);
    b.box(0, 0.16, -0.34, 0.46, 0.14, 0.24, 0x6d452a);
    b.box(0, 0.72, -0.32, 0.44, 0.14, 0.3, 0xd8c9a0);   // bedroll
    b.box(0.18, 0.4, -0.2, 0.1, 0.5, 0.06, 0x6d452a);   // straps
    b.box(-0.18, 0.4, -0.2, 0.1, 0.5, 0.06, 0x6d452a);
    // pickaxe strapped diagonally across the pack
    b.box(0.02, 0.44, -0.5, 0.08, 1.15, 0.08, 0x8a5a34);
    b.box(0.02, 0.96, -0.5, 0.62, 0.12, 0.12, STEEL);
    b.box(0.32, 0.92, -0.5, 0.18, 0.14, 0.1, 0x8c9aa8);
  });
  hips.add(torso);

  // --- head --------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.y = 0.74;
  hips.add(neck);

  const head = part((b) => {
    // rounded cranium with a narrower jaw and a small chin: reads young
    b.box(0, 0.36, 0, 0.6, 0.44, 0.56, SKIN);
    b.box(0, 0.11, 0.01, 0.52, 0.16, 0.54, SKIN, { tint: 0.99 });
    b.box(0, 0.02, 0.02, 0.36, 0.1, 0.44, SKIN, { tint: 0.98 });
    b.box(0, 0.16, -0.28, 0.52, 0.36, 0.06, HAIR);       // nape

    // hair: fringe chunks and side tufts escaping from under the cap
    b.box(0, 0.53, 0, 0.62, 0.14, 0.58, HAIR);
    b.box(-0.13, 0.45, 0.3, 0.22, 0.15, 0.05, HAIR);
    b.box(0.11, 0.47, 0.3, 0.17, 0.11, 0.05, HAIR_D);
    b.box(0.24, 0.46, 0.3, 0.1, 0.08, 0.05, HAIR);
    b.box(0.29, 0.42, 0.2, 0.07, 0.16, 0.2, HAIR);       // sideburns
    b.box(-0.29, 0.42, 0.2, 0.07, 0.16, 0.2, HAIR);
    b.box(0.18, 0.5, -0.3, 0.14, 0.13, 0.09, HAIR_D);    // tufts at the back
    b.box(-0.15, 0.47, -0.31, 0.12, 0.11, 0.08, HAIR);

    // cap
    b.box(0, 0.63, 0, 0.64, 0.14, 0.6, CAP);
    b.box(0, 0.71, -0.02, 0.5, 0.08, 0.5, CAP_D);
    b.box(0, 0.57, 0.31, 0.5, 0.08, 0.24, CAP_D);        // brim
    b.box(0, 0.63, -0.31, 0.16, 0.1, 0.1, CAP_D);

    // goggles pushed up onto the cap
    b.box(0, 0.59, 0, 0.66, 0.14, 0.62, 0x3f4654);
    b.box(0.17, 0.59, 0.32, 0.22, 0.2, 0.06, 0x8fe8ff);
    b.box(-0.17, 0.59, 0.32, 0.22, 0.2, 0.06, 0x8fe8ff);
    b.box(0.17, 0.59, 0.35, 0.26, 0.24, 0.02, 0x5f6b7c);
    b.box(-0.17, 0.59, 0.35, 0.26, 0.24, 0.02, 0x5f6b7c);

    // brows, nose, a small lopsided grin, and a bit of colour on the cheeks
    b.box(0.15, 0.395, 0.283, 0.17, 0.05, 0.02, BROW);
    b.box(-0.15, 0.405, 0.283, 0.17, 0.05, 0.02, BROW);
    b.box(0, 0.2, 0.293, 0.09, 0.07, 0.035, SKIN_D);
    b.box(0.01, 0.1, 0.278, 0.11, 0.04, 0.015, 0xb5645a);
    b.box(0.08, 0.125, 0.278, 0.05, 0.035, 0.015, 0xb5645a);
    b.box(-0.06, 0.12, 0.278, 0.04, 0.03, 0.015, 0xb5645a);
    b.box(0.235, 0.19, 0.26, 0.1, 0.07, 0.06, BLUSH);
    b.box(-0.235, 0.19, 0.26, 0.1, 0.07, 0.06, BLUSH);
  });
  neck.add(head);

  // Big anime eyes, built around their own centre so the blink squashes in
  // place. Thin outlines keep them from turning into black blobs.
  const eyes = part((b) => {
    for (const s of [-1, 1]) {
      b.box(s * 0.145, 0, 0.281, 0.2, 0.21, 0.02, 0xfdfdff);          // sclera
      b.box(s * 0.145, -0.015, 0.284, 0.125, 0.16, 0.02, IRIS);       // iris
      b.box(s * 0.145, -0.035, 0.287, 0.08, 0.09, 0.02, INK);         // pupil
      b.box(s * 0.145 + 0.05, 0.055, 0.29, 0.05, 0.055, 0.02, 0xffffff);
      b.box(s * 0.145 - 0.045, -0.06, 0.29, 0.03, 0.03, 0.02, 0xffffff);
      b.box(s * 0.145, 0.107, 0.283, 0.21, 0.05, 0.02, INK);          // lash line
    }
  }, 0.009);
  eyes.position.set(0, 0.27, 0);
  neck.add(eyes);

  // scarf: collar + three trailing segments that lag behind
  const collar = part((b) => {
    b.box(0, 0.02, 0, 0.62, 0.18, 0.5, SCARF);
    b.box(0, -0.06, 0.2, 0.4, 0.14, 0.16, SCARF);
  });
  neck.add(collar);

  const scarf = [];
  let parent = neck;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.position.set(0, i === 0 ? -0.02 : -0.02, i === 0 ? -0.26 : -0.24);
    const seg = part((b) => {
      b.box(0, -0.02, -0.12, 0.34 - i * 0.04, 0.16, 0.28, i % 2 ? SCARF : 0xe6d8bb);
    });
    g.add(seg);
    parent.add(g);
    parent = g;
    scarf.push(g);
  }

  // --- arms --------------------------------------------------------------
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.41, 0.6, 0);
    const arm = part((b) => {
      b.box(0, -0.24, 0, 0.22, 0.5, 0.24, COAT);
      b.box(0, -0.46, 0, 0.23, 0.1, 0.25, TRIM);
      b.box(0, -0.58, 0.02, 0.24, 0.2, 0.26, GLOVE);
    });
    shoulder.add(arm);
    hips.add(shoulder);
    arms.push(shoulder);
  }

  // --- legs --------------------------------------------------------------
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.17, 0.0, 0);
    const leg = part((b) => {
      b.box(0, -0.34, 0, 0.28, 0.68, 0.28, PANTS);
      b.box(0, -0.62, 0, 0.29, 0.14, 0.29, 0x3d455e);
      b.box(0, -0.76, 0.04, 0.32, 0.18, 0.36, BOOT);
    });
    hip.add(leg);
    hips.add(hip);
    legs.push(hip);
  }

  scene.add(root);

  // --- click marker ------------------------------------------------------
  const marker = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(0.55, 0.72, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffe27a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);
  const arrowsB = new VoxelBuilder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    arrowsB.box(Math.cos(a) * 0.95, 0.05, Math.sin(a) * 0.95, 0.16, 0.16, 0.16, 0xffe27a);
  }
  const arrowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
  const arrows = new THREE.Mesh(arrowsB.build(), arrowMat);
  marker.add(arrows);
  marker.visible = false;
  scene.add(marker);

  /* ---------------------------------------------------------------- */

  const state = {
    pos: new THREE.Vector3(3, 0, 6.5),
    dest: new THREE.Vector3(3, 0, 6.5),
    vel: new THREE.Vector3(),
    yaw: 0.7,
    speed: 0,
    phase: 0,
    groundY: 0,
    blink: 2 + Math.random() * 3,
    markerT: 1,
    markerBlocked: false,
    footed: false,
  };
  state.pos.y = groundAt(state.pos.x, state.pos.z);
  state.groundY = state.pos.y;
  root.position.copy(state.pos);
  root.rotation.y = state.yaw;

  const MAX_SPEED = 3.6;
  const tmp = new THREE.Vector3();

  function moveTo(x, z) {
    const wanted = isWalkable(x, z);
    clampToWalkable(x, z, state.dest);
    state.markerBlocked = !wanted;
    marker.visible = true;
    marker.position.set(state.dest.x, state.dest.y + 0.06, state.dest.z);
    state.markerT = 0;
    const col = wanted ? 0xffe27a : 0xff7a6a;
    ringMat.color.setHex(col);
    arrowMat.color.setHex(col);
  }

  function update(dt, t, ctx) {
    // --- steering --------------------------------------------------------
    tmp.set(state.dest.x - state.pos.x, 0, state.dest.z - state.pos.z);
    const dist = tmp.length();
    const arrive = clamp(dist / 1.4, 0, 1);
    const want = dist > 0.08 ? MAX_SPEED * arrive : 0;
    state.speed += (want - state.speed) * damp(want > state.speed ? 6 : 9, dt);
    if (dist > 1e-4) {
      tmp.normalize();
      const step = Math.min(state.speed * dt, dist);
      state.pos.x += tmp.x * step;
      state.pos.z += tmp.z * step;
      if (state.speed > 0.25) {
        const target = Math.atan2(tmp.x, tmp.z);
        let diff = target - state.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        state.yaw += diff * damp(9, dt);
      }
    }

    // --- ground follow ---------------------------------------------------
    const g = groundAt(state.pos.x, state.pos.z);
    state.groundY += (g - state.groundY) * damp(14, dt);
    root.position.set(state.pos.x, state.groundY, state.pos.z);
    root.rotation.y = state.yaw;

    const sn = clamp(state.speed / MAX_SPEED, 0, 1);
    state.phase += dt * lerp(6.0, 9.5, sn) * sn;

    // --- gait ------------------------------------------------------------
    const swing = Math.sin(state.phase);
    legs[0].rotation.x = swing * 0.95 * sn;
    legs[1].rotation.x = -swing * 0.95 * sn;
    legs[0].position.y = Math.max(0, swing) * 0.05 * sn;
    legs[1].position.y = Math.max(0, -swing) * 0.05 * sn;

    const idleArm = Math.sin(t * 1.6) * 0.06;
    arms[0].rotation.x = -swing * 0.75 * sn + idleArm;
    arms[1].rotation.x = swing * 0.75 * sn - idleArm;
    arms[0].rotation.z = 0.12 + sn * 0.06;
    arms[1].rotation.z = -0.12 - sn * 0.06;

    const bob = Math.abs(Math.cos(state.phase)) * 0.07 * sn;
    const breath = Math.sin(t * 1.9) * 0.018 * (1 - sn);
    body.position.y = bob + breath;
    body.rotation.x = sn * 0.1;
    body.rotation.z = Math.sin(state.phase) * 0.05 * sn;
    hips.rotation.y = Math.sin(state.phase) * 0.12 * sn;

    // head: look ahead when moving, glance around when idle
    neck.rotation.y = lerp(Math.sin(t * 0.45) * 0.5 + Math.sin(t * 0.17) * 0.35, 0, sn);
    neck.rotation.x = lerp(Math.sin(t * 0.6) * 0.08, -0.06, sn) + bob * 0.3;

    // scarf trails behind, driven by speed and wind
    scarf.forEach((s, i) => {
      const lag = i * 0.55;
      s.rotation.x = -0.15 - sn * (0.5 + i * 0.22)
        + Math.sin(t * 3.0 - lag) * (0.06 + sn * 0.1);
      s.rotation.y = Math.sin(t * 1.7 - lag) * (0.16 + sn * 0.22);
    });

    // blinking
    state.blink -= dt;
    if (state.blink < 0) {
      const k = clamp(-state.blink / 0.09, 0, 1);
      eyes.scale.y = k < 0.5 ? lerp(1, 0.08, k * 2) : lerp(0.08, 1, (k - 0.5) * 2);
      if (k >= 1) { state.blink = 1.6 + Math.random() * 4.5; eyes.scale.y = 1; }
    }

    // footfall dust
    const foot = Math.cos(state.phase);
    if (sn > 0.35 && foot < -0.9 && !state.footed) {
      state.footed = true;
      const back = 0.25;
      ctx.puffs.spawn(
        state.pos.x - Math.sin(state.yaw) * back,
        state.groundY + 0.06,
        state.pos.z - Math.cos(state.yaw) * back,
        0.6, 0.35, 0.55,
      );
    } else if (foot > -0.5) state.footed = false;

    // --- marker ----------------------------------------------------------
    if (marker.visible) {
      state.markerT += dt;
      const u = state.markerT;
      const pulse = 0.55 + Math.sin(u * 5.0) * 0.2;
      const fade = clamp(1 - (u - 1.2) / 0.6, 0, 1) * (dist > 0.35 ? 1 : clamp(1 - u, 0, 1));
      const grow = 1 + Math.max(0, 0.6 - u) * 1.2;
      ring.scale.setScalar(grow * (0.9 + Math.sin(u * 4) * 0.05));
      ringMat.opacity = fade * pulse;
      arrowMat.opacity = fade * pulse * 0.9;
      arrows.rotation.y = u * 1.6;
      arrows.scale.setScalar(grow);
      if (fade <= 0) marker.visible = false;
    }
  }

  return {
    root, marker, state,
    get position() { return state.pos; },
    moveTo,
    update,
  };
}
