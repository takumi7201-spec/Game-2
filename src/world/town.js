// Hollowrock: the digger's home town on the eastern island. One domed hall
// where fossils are cleaned and revived, a colosseum where the revived ones
// fight, and the bridge that ties the town back to the dig site.
import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32, lerp } from '../lib/math.js';
import { VoxelBuilder, toonMaterial, addOutline, outlineMaterial } from '../lib/voxel.js';
import { applyWind, windOutlineMaterial } from '../lib/wind.js';
import { at, frame, rod, COL } from '../lib/parts.js';
import { CFG, groundAt, bridgeSpan, deckAt, roadPoint, roadAt } from './terrain.js';

const T = CFG.town;
/** Town-local (x,z) -> world. */
const wx = (lx) => T.x + lx;
const wz = (lz) => T.z + lz;

const PAL = {
  wall: 0xe6dcc6, wallWarm: 0xd8c8a8, wallCool: 0xcfd6dc,
  timber: 0x8a5a34, timberDark: 0x6d452a,
  roof: 0xc2564a, roofDark: 0x9d4038, roofBlue: 0x4a7fb5, roofBlueDark: 0x3a6493,
  copper: 0x49b8a4, copperDark: 0x35907f,
  stone: 0x9aa3ad, stoneDark: 0x7d8791, stoneLight: 0xb6bec7,
  sand: 0xdcc68d, glass: 0x8fd8ff, gold: 0xf0c75e,
};

/* ------------------------------------------------------------------ *
 *  Shapes                                                             *
 * ------------------------------------------------------------------ */

/** Stacked courses of blocks following a hemisphere: a tiled voxel dome. */
function domeShell(b, cx, cy, cz, R, H, rings, sides, colorFn, thickness = 0.6) {
  for (let i = 0; i < rings; i++) {
    const v0 = i / rings, v1 = (i + 1) / rings;
    const y0 = Math.sin(v0 * Math.PI / 2) * H;
    const y1 = Math.sin(v1 * Math.PI / 2) * H;
    const r = R * Math.cos(((v0 + v1) / 2) * (Math.PI / 2));
    const h = y1 - y0;
    const n = Math.max(6, Math.round(sides * Math.pow(r / R, 0.45)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (i % 2) * (Math.PI / n);
      const w = (2 * Math.PI * r) / n * 1.08;
      at(b, cx + Math.cos(a) * r, cy + y0 + h / 2, cz + Math.sin(a) * r, -a, 1);
      b.box(0, 0, 0, thickness, h * 1.04, w, colorFn(i, k));
      b.setTransform(null);
    }
  }
}

/** A ring of blocks - colonnade piers, seating tiers, cornices. */
function ring(b, cx, cy, cz, r, count, size, colorFn, startAngle = 0, span = Math.PI * 2) {
  for (let k = 0; k < count; k++) {
    const a = startAngle + (k / count) * span;
    at(b, cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, -a, 1);
    b.box(0, 0, 0, size[0], size[1], size[2], colorFn(k, a));
    b.setTransform(null);
  }
}

/** Simple gabled house: walls, a stepped roof, door and windows. */
function house(b, g, rnd, lx, lz, yaw, w, d, h, roofCol) {
  const x = wx(lx), z = wz(lz);
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  const wall = rnd() < 0.5 ? PAL.wall : PAL.wallWarm;
  b.box(0, h / 2, 0, w, h, d, wall);
  b.box(0, 0.18, 0, w + 0.18, 0.36, d + 0.18, PAL.stone, { tint: 0.96 });   // plinth
  // corner posts and a beam, half-timbered
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(sx * (w / 2 - 0.07), h / 2, sz * (d / 2 - 0.07), 0.16, h, 0.16, PAL.timberDark);
    }
  }
  b.box(0, h - 0.12, 0, w + 0.06, 0.2, d + 0.06, PAL.timber);
  // stepped gable roof running along z
  const steps = Math.max(3, Math.round(w / 0.55));
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const ww = w * (1 - t) + 0.5;
    b.box(0, h + 0.18 + t * 1.5, 0, ww, 1.5 / steps + 0.08, d + 0.55 - t * 0.1,
      i % 2 ? roofCol[0] : roofCol[1]);
  }
  // door and windows
  b.box(0, 0.72, d / 2 + 0.02, 0.62, 1.44, 0.1, PAL.timberDark);
  b.box(0.22, 0.72, d / 2 + 0.08, 0.1, 0.1, 0.06, PAL.gold);
  for (const sx of [-1, 1]) {
    b.box(sx * (w / 4), h * 0.62, d / 2 + 0.02, 0.42, 0.42, 0.08, PAL.timber);
    b.box(sx * (w / 4), h * 0.62, d / 2 + 0.05, 0.3, 0.3, 0.05, PAL.glass);
  }
  if (rnd() < 0.7) {                       // chimney
    const cx2 = (rnd() - 0.5) * w * 0.5;
    b.box(cx2, h + 1.9, -d * 0.22, 0.44, 1.1, 0.44, PAL.stone);
    b.box(cx2, h + 2.5, -d * 0.22, 0.56, 0.2, 0.56, PAL.stoneDark);
  }
  b.setTransform(null);
  // a lit window pane in the glow batch so the town never feels empty
  at(g, x, y, z, yaw, 1);
  g.box(-w / 4, h * 0.62, d / 2 + 0.06, 0.28, 0.28, 0.04, 0xffe9a8);
  g.setTransform(null);
}

function lamp(b, g, lx, lz, yaw = 0) {
  const x = wx(lx), z = wz(lz);
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  b.box(0, 0.12, 0, 0.44, 0.24, 0.44, PAL.stoneDark);
  b.box(0, 1.3, 0, 0.16, 2.4, 0.16, PAL.timberDark);
  b.box(0, 2.6, 0, 0.4, 0.16, 0.4, PAL.stoneDark);
  b.box(0, 2.92, 0, 0.2, 0.3, 0.2, PAL.timberDark);
  b.setTransform(null);
  at(g, x, y, z, yaw, 1);
  g.box(0, 2.42, 0, 0.3, 0.36, 0.3, 0xffd77a);
  g.setTransform(null);
}

function banner(lx, ly, lz, yaw, height, colA, colB) {
  const x = wx(lx), z = wz(lz);
  const y = groundAt(x, z) + ly;
  const b = new VoxelBuilder({ plant: true });
  b.setPlant(x, y, z, height, 0);
  b.setSwayFixed(0);
  b.box(0, height / 2, 0, 0.13, height, 0.13, PAL.timberDark);
  const cells = 7;
  for (let i = 0; i < cells; i++) {
    const t = (i + 0.5) / cells;
    b.setSwayFixed(Math.pow(t, 0.8));
    for (let j = 0; j < 4; j++) {
      b.box(0.2 + t * 1.35, height - 0.3 - j * 0.4, 0, 1.4 / cells, 0.4, 0.07,
        j === 1 || j === 2 ? colB : colA);
    }
  }
  const geo = b.build();
  const mat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
  applyWind(mat, { mode: 'attribute', push: false, strength: 1.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  mesh.add(new THREE.Mesh(geo, windOutlineMaterial(0.02, 0x1b2333, {
    mode: 'attribute', push: false, strength: 1.4,
  })));
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  The bridge                                                         *
 * ------------------------------------------------------------------ */

function buildBridge(b, g, rnd) {
  const s = bridgeSpan();
  const p = {};
  const steps = 34;
  // deck planks following the sag
  for (let i = 0; i <= steps; i++) {
    const t = lerp(s.t0, s.t1, i / steps);
    roadPoint(t, p);
    const y = deckAt(p.x, p.z);
    if (y === null) continue;
    roadPoint(Math.min(s.t1, t + 0.01), _p2);
    const yaw = Math.atan2(_p2.z - p.z, _p2.x - p.x);
    at(b, p.x, y, p.z, -yaw, 1);
    b.box(0, -0.12, 0, 0.62, 0.2, CFG.road.w, i % 2 ? 0x9a6a3c : 0x8a5a34,
      { tint: 0.94 + rnd() * 0.12 });
    if (i % 4 === 0) {
      b.box(0, -0.26, 0, 0.28, 0.3, CFG.road.w + 0.3, PAL.timberDark);  // cross beam
      for (const sz of [-1, 1]) {                                        // railing posts
        b.box(0, 0.45, sz * (CFG.road.w / 2 - 0.1), 0.18, 1.0, 0.18, PAL.timberDark);
      }
    }
    // rope railings
    for (const sz of [-1, 1]) {
      b.box(0, 0.9, sz * (CFG.road.w / 2 - 0.1), 0.66, 0.11, 0.11, COL.rope);
      b.box(0, 0.45, sz * (CFG.road.w / 2 - 0.1), 0.66, 0.08, 0.08, COL.rope, { tint: 0.92 });
    }
    b.setTransform(null);
  }
  // stone abutments and a lantern at each end
  for (const [ex, ez, dir] of [[s.ax, s.az, 1], [s.bx, s.bz, -1]]) {
    const y = groundAt(ex + dir * 0.8, ez);
    at(b, ex + dir * 0.6, y, ez, 0, 1);
    b.box(0, -0.5, 0, 2.0, 1.6, CFG.road.w + 1.4, PAL.stone, { tint: 0.96 });
    b.box(0, 0.42, 0, 1.7, 0.3, CFG.road.w + 1.0, PAL.stoneDark);
    for (const sz of [-1, 1]) {
      b.box(0, 1.5, sz * (CFG.road.w / 2 + 0.35), 0.7, 2.0, 0.7, PAL.stone);
      b.box(0, 2.62, sz * (CFG.road.w / 2 + 0.35), 0.9, 0.26, 0.9, PAL.stoneDark);
    }
    b.setTransform(null);
    at(g, ex + dir * 0.6, y, ez, 0, 1);
    for (const sz of [-1, 1]) g.box(0, 2.9, sz * (CFG.road.w / 2 + 0.35), 0.34, 0.4, 0.34, 0xffd77a);
    g.setTransform(null);
  }
}
const _p2 = {};

/* ------------------------------------------------------------------ *
 *  The domed hall: cleaning below, revival above                      *
 * ------------------------------------------------------------------ */

function buildDome(b, g, rnd, scene, updaters) {
  const [lx, lz] = T.dome;
  const x = wx(lx), z = wz(lz);
  const y = groundAt(x, z);
  const R = T.domeR;

  // stone drum the dome sits on, with tall arched windows
  at(b, x, y, z, 0, 1);
  b.box(0, 0.25, 0, R * 2 + 1.2, 0.5, R * 2 + 1.2, PAL.stone, { tint: 0.95 });
  b.setTransform(null);
  ring(b, x, y + 1.9, z, R, 16, [0.75, 3.2, 1.15],
    (k) => (k % 2 ? PAL.wall : PAL.wallWarm));
  ring(b, x, y + 3.7, z, R, 16, [0.85, 0.45, 1.3], () => PAL.stoneDark);
  // window glass between the piers
  ring(g, x, y + 2.4, z, R - 0.12, 16, [0.3, 1.5, 0.62],
    () => PAL.glass, Math.PI / 16);

  // the dome itself: copper courses with a glazed lantern on top
  domeShell(b, x, y + 4.0, z, R + 0.15, 4.6, 6, 20,
    (i) => (i % 2 ? PAL.copper : PAL.copperDark), 0.62);
  at(b, x, y + 8.5, z, 0, 1);
  b.box(0, 0.35, 0, 1.9, 0.7, 1.9, PAL.stoneDark);
  b.box(0, 1.25, 0, 1.5, 1.1, 1.5, PAL.copper);
  b.box(0, 1.95, 0, 1.9, 0.3, 1.9, PAL.copperDark);
  b.box(0, 2.5, 0, 0.22, 0.9, 0.22, PAL.gold);
  b.setTransform(null);
  at(g, x, y + 8.5, z, 0, 1);
  g.box(0, 1.25, 0, 1.6, 0.75, 1.6, 0x9ff2ff);
  g.box(0, 2.95, 0, 0.4, 0.4, 0.4, PAL.gold);
  g.setTransform(null);

  // entrance: an arch facing the plaza (+z), with steps and a sign
  at(b, x, y, z + R + 0.25, 0, 1);
  for (let i = 0; i < 3; i++) {
    b.box(0, 0.1 + i * 0.22, 1.1 - i * 0.36, 4.0 - i * 0.5, 0.24, 0.8, PAL.stoneLight,
      { tint: 0.97 });
  }
  b.box(-1.55, 2.0, 0, 0.8, 4.0, 1.2, PAL.wall);
  b.box(1.55, 2.0, 0, 0.8, 4.0, 1.2, PAL.wall);
  for (let i = 0; i < 5; i++) {           // arch head
    const a = (i / 4) * Math.PI;
    b.box(-Math.cos(a) * 1.55, 4.0 + Math.sin(a) * 1.0, 0, 0.85, 0.6, 1.2,
      i % 2 ? PAL.stoneLight : PAL.wallWarm);
  }
  b.box(0, 5.3, 0, 3.4, 0.4, 1.4, PAL.stoneDark);
  b.box(0, 3.1, -0.2, 2.4, 2.4, 0.3, 0x2c3444);    // the dark hall beyond
  b.setTransform(null);

  // sign board over the door
  at(b, x, y, z + R + 1.0, 0, 1);
  b.box(0, 5.9, 0, 3.0, 0.9, 0.22, PAL.timber);
  b.box(0, 5.9, 0.14, 2.6, 0.62, 0.06, PAL.wall);
  b.setTransform(null);
  at(g, x, y, z + R + 1.0, 0, 1);
  g.box(-0.7, 5.9, 0.2, 0.5, 0.26, 0.05, 0xf5e7c8);   // a little fossil rib icon
  g.box(0.1, 5.95, 0.2, 0.22, 0.5, 0.05, 0xf5e7c8);
  g.box(0.62, 5.88, 0.2, 0.44, 0.3, 0.05, 0xf5e7c8);
  g.setTransform(null);

  // --- the revival chamber, glowing inside the doorway -------------------
  const capsule = new THREE.Group();
  capsule.position.set(x, y, z + R - 1.4);
  const cb = new VoxelBuilder();
  cb.box(0, 0.3, 0, 2.2, 0.6, 2.2, PAL.stoneDark);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    cb.box(Math.cos(a) * 0.95, 1.6, Math.sin(a) * 0.95, 0.24, 2.0, 0.24, PAL.copper);
  }
  cb.box(0, 2.8, 0, 2.4, 0.4, 2.4, PAL.copperDark);
  const frameMesh = new THREE.Mesh(cb.build(), toonMaterial({ vertexColors: true }));
  addOutline(frameMesh, 0.022);
  capsule.add(frameMesh);
  const lb = new VoxelBuilder();
  lb.box(0, 1.6, 0, 1.5, 2.1, 1.5, 0x7ef0ff);
  const light = new THREE.Mesh(lb.build(), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7,
  }));
  capsule.add(light);
  scene.add(capsule);

  // an orrery ring that turns slowly around the lantern
  const rb = new VoxelBuilder();
  const RR = R * 0.78;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    at(rb, Math.cos(a) * RR, 0, Math.sin(a) * RR, -a, 1);
    rb.box(0, 0, 0, 0.22, 0.26, (2 * Math.PI * RR) / 24 * 1.1,
      i % 4 === 0 ? PAL.gold : PAL.copper);
    rb.setTransform(null);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    rb.box(Math.cos(a) * RR, 0.4, Math.sin(a) * RR, 0.34, 0.6, 0.34, PAL.gold);
  }
  const orrery = new THREE.Mesh(rb.build(), toonMaterial({ vertexColors: true }));
  addOutline(orrery, 0.018);
  orrery.position.set(x, y + 7.1, z);
  scene.add(orrery);

  // --- the cleaning workshop annex --------------------------------------
  const ax = x - R - 2.1, az = z + 1.2;
  const ay = groundAt(ax, az);
  at(b, ax, ay, az, 0, 1);
  b.box(0, 1.5, 0, 4.2, 3.0, 5.0, PAL.wallCool);
  b.box(0, 0.2, 0, 4.5, 0.4, 5.3, PAL.stone);
  for (let i = 0; i < 4; i++) {
    b.box(0, 3.1 + i * 0.42, 0, 4.6 - i * 0.8, 0.45, 5.4 - i * 0.5,
      i % 2 ? PAL.roofBlue : PAL.roofBlueDark);
  }
  b.box(-1.5, 5.1, -1.6, 0.7, 1.6, 0.7, PAL.stone);          // chimney
  b.box(-1.5, 6.0, -1.6, 0.9, 0.24, 0.9, PAL.stoneDark);
  b.box(2.15, 1.4, 1.0, 0.12, 1.6, 2.4, PAL.glass);          // long workshop window
  b.box(2.2, 1.4, 1.0, 0.1, 1.7, 2.6, PAL.timber, { tint: 0.9 });
  b.setTransform(null);

  // work bench outside the annex, with a half-cleaned fossil slab
  at(b, ax + 3.0, ay, az + 3.2, 0.4, 1);
  b.box(0, 0.78, 0, 2.2, 0.16, 1.2, COL.plank);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(sx * 0.9, 0.38, sz * 0.44, 0.16, 0.78, 0.16, PAL.timberDark);
  }
  b.box(-0.3, 0.98, 0, 1.1, 0.26, 0.8, 0x9c8a6e);            // matrix rock
  b.box(-0.3, 1.14, 0.05, 0.7, 0.1, 0.4, COL.bone);          // exposed bone
  b.box(0.75, 0.94, 0.1, 0.5, 0.1, 0.1, PAL.timber);         // brush
  b.box(0.75, 0.99, 0.34, 0.34, 0.12, 0.2, 0xe8d7a8);
  b.setTransform(null);

  updaters.push((dt, t) => {
    orrery.rotation.y += dt * 0.22;
    orrery.position.y = y + 7.1 + Math.sin(t * 0.7) * 0.12;
    const pulse = 0.55 + Math.sin(t * 1.9) * 0.2 + Math.sin(t * 5.1) * 0.06;
    light.material.opacity = pulse;
    light.scale.set(1 + Math.sin(t * 1.9) * 0.04, 1, 1 + Math.sin(t * 1.9) * 0.04);
  });

  return {
    door: new THREE.Vector3(x, y, z + R + 1.5),
    chimney: new THREE.Vector3(ax - 1.5, ay + 6.2, az - 1.6),
    capsule: new THREE.Vector3(x, y + 1.6, z + R - 1.4),
  };
}

/* ------------------------------------------------------------------ *
 *  The colosseum                                                      *
 * ------------------------------------------------------------------ */

function buildArena(b, g, rnd, scene, updaters) {
  const [lx, lz] = T.arena;
  const x = wx(lx), z = wz(lz);
  const R = T.arenaR;
  const GATE = Math.PI * 1.5;            // the gate faces the plaza (-z)

  // the bowl floor is carved into the terrain; ring out the battle markings
  const floorY = groundAt(x, z);
  ring(b, x, floorY + 0.32, z, 2.7, 18, [0.5, 0.1, 0.36], () => 0xc8ae74);
  ring(b, x, floorY + 0.32, z, 1.1, 8, [0.4, 0.1, 0.3], () => 0xc8ae74);

  // seating tiers stepping up from the sand to ground level
  for (let i = 0; i < 3; i++) {
    const r = 3.8 + i * 0.8;
    const h = floorY + 0.45 + i * 0.62;
    const n = Math.max(20, Math.round((2 * Math.PI * r) / 0.85));
    ring(b, x, h, z, r, n, [0.9, 0.62, (2 * Math.PI * r) / n * 1.06],
      (k) => (k % 2 ? PAL.stoneLight : PAL.stone),
      0, Math.PI * 2);
  }
  // the crowd: little coloured blocks on the top tier
  const crowdCols = [0xe2564a, 0x4a7fb5, 0xf0c75e, 0x6fbe45, 0xc59bff, 0xf2e3c2];
  const crowd = [];
  for (let k = 0; k < 46; k++) {
    const a = (k / 46) * Math.PI * 2 + 0.07;
    if (Math.abs(((a - GATE + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.45) continue;
    crowd.push([Math.cos(a) * 5.5, Math.sin(a) * 5.5, k]);
  }
  const crowdGeo = new VoxelBuilder();
  crowd.forEach(([px, pz], i) => {
    crowdGeo.box(px, 0, pz, 0.34, 0.5, 0.34, crowdCols[i % crowdCols.length]);
    crowdGeo.box(px, 0.36, pz, 0.28, 0.26, 0.28, 0xf6c9a0);
  });
  const crowdMesh = new THREE.Mesh(crowdGeo.build(), toonMaterial({ vertexColors: true }));
  addOutline(crowdMesh, 0.016);
  crowdMesh.position.set(x, floorY + 2.35, z);
  scene.add(crowdMesh);

  // a continuous plinth and cornice tie the arcade together into a wall
  const gateOpen = (a) => Math.abs(((a - GATE + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
    > Math.PI - 0.5;
  const plinthN = Math.round((2 * Math.PI * R) / 0.9);
  for (let k = 0; k < plinthN; k++) {
    const a = (k / plinthN) * Math.PI * 2;
    if (gateOpen(a)) continue;
    const px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
    const py = groundAt(px, pz);
    at(b, px, py, pz, -a, 1);
    b.box(0, 0.45, 0, 1.25, 0.9, (2 * Math.PI * R) / plinthN * 1.08,
      k % 2 ? PAL.stone : PAL.stoneLight);
    b.box(0, 3.95, 0, 1.1, 0.34, (2 * Math.PI * R) / plinthN * 1.08, PAL.stoneDark);
    b.box(0, 5.8, 0, 1.3, 0.4, (2 * Math.PI * R) / plinthN * 1.08, PAL.stoneDark);
    b.setTransform(null);
  }

  // outer wall: an arcade of piers with arch heads, broken by the gate
  const piers = 18;
  for (let k = 0; k < piers; k++) {
    const a = (k / piers) * Math.PI * 2;
    const off = Math.abs(((a - GATE + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (off > Math.PI - 0.42) continue;                 // leave the gate open
    const px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
    at(b, px, groundAt(px, pz), pz, -a, 1);
    b.box(0, 2.2, 0, 1.05, 3.4, 1.3, k % 2 ? PAL.stone : PAL.stoneLight);
    b.box(0, 4.05, 0, 1.2, 0.42, 1.45, PAL.stoneDark);   // capital
    b.box(0, 4.95, 0, 1.05, 1.5, 1.35, PAL.wallWarm);    // upper tier

    b.setTransform(null);
  }
  // arch heads spanning between piers
  for (let k = 0; k < piers; k++) {
    const a = ((k + 0.5) / piers) * Math.PI * 2;
    const off = Math.abs(((a - GATE + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (off > Math.PI - 0.62) continue;
    const px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
    at(b, px, groundAt(px, pz), pz, -a, 1);
    b.box(0, 3.6, 0, 0.95, 0.65, 1.0, PAL.stoneLight);
    b.box(0, 3.1, 0, 0.6, 0.5, 0.85, PAL.stone, { tint: 0.9 });
    b.box(0, 5.0, 0, 0.95, 1.4, 0.95, PAL.wallWarm, { tint: 0.96 });
    b.setTransform(null);
  }

  // the gate: two towers and a lintel
  const gx = x + Math.cos(GATE) * R, gz = z + Math.sin(GATE) * R;
  const gy = groundAt(gx, gz);
  at(b, gx, gy, gz, -GATE, 1);
  for (const sz of [-1, 1]) {
    b.box(0, 2.6, sz * 1.9, 1.5, 5.2, 1.5, PAL.stone);
    b.box(0, 5.4, sz * 1.9, 1.8, 0.5, 1.8, PAL.stoneDark);
    b.box(0, 5.95, sz * 1.9, 1.2, 0.7, 1.2, PAL.stoneLight);
  }
  b.box(0, 4.9, 0, 1.2, 0.8, 4.2, PAL.stoneDark);
  b.box(0, 5.5, 0, 1.5, 0.5, 3.2, PAL.stoneLight);
  b.setTransform(null);
  // braziers on the gate towers
  at(g, gx, gy, gz, -GATE, 1);
  for (const sz of [-1, 1]) g.box(0, 6.5, sz * 1.9, 0.7, 0.7, 0.7, 0xff9a4a);
  g.setTransform(null);

  updaters.push((dt, t) => {
    // the crowd bobs, a wave running round the stands
    crowdMesh.children.forEach(() => {});
    crowdMesh.position.y = floorY + 2.35 + Math.abs(Math.sin(t * 2.2)) * 0.06;
  });

  // a ramp from the gate down into the sand
  at(b, gx, gy, gz, -GATE, 1);
  for (let i = 0; i < 5; i++) {
    b.box(-0.7 - i * 0.62, -0.2 - i * 0.34, 0, 0.7, 0.5, 2.6,
      i % 2 ? PAL.stone : PAL.stoneLight);
  }
  b.setTransform(null);

  return { gate: new THREE.Vector3(gx, gy, gz), centre: new THREE.Vector3(x, floorY, z) };
}

/* ------------------------------------------------------------------ *
 *  Assembly                                                           *
 * ------------------------------------------------------------------ */

export function buildTown(scene) {
  const rnd = mulberry32(31337);
  const statics = new VoxelBuilder();
  const foliage = new VoxelBuilder({ plant: true });
  const glow = new VoxelBuilder();
  const updaters = [];

  buildBridge(statics, glow, rnd);
  const dome = buildDome(statics, glow, rnd, scene, updaters);
  const arena = buildArena(statics, glow, rnd, scene, updaters);

  /* --- town gate at the head of the street --- */
  {
    const [lx, lz] = T.gate;
    const x = wx(lx), z = wz(lz);
    const y = groundAt(x, z);
    // the road runs along x here, so the towers straddle it in z
    at(statics, x, y, z, 0, 1);
    for (const sz of [-1, 1]) {
      statics.box(0, 2.1, sz * 2.5, 1.4, 4.2, 1.4, PAL.stone);
      statics.box(0, 4.45, sz * 2.5, 1.7, 0.5, 1.7, PAL.stoneDark);
      statics.box(0, 4.95, sz * 2.5, 1.1, 0.5, 1.1, PAL.stoneLight);
    }
    statics.box(0, 4.6, 0, 1.1, 0.8, 5.6, PAL.stoneLight);
    statics.box(0, 5.25, 0, 0.8, 0.5, 3.2, PAL.stoneDark);
    statics.setTransform(null);
    scene.add(banner(lx, 4.7, lz - 2.5, 0, 2.4, PAL.roofBlue, PAL.wall));
    scene.add(banner(lx, 4.7, lz + 2.5, 0, 2.4, PAL.roof, PAL.wall));
  }

  /* --- plaza: fountain, benches, planters, stalls --- */
  {
    const x = wx(T.plaza[0]), z = wz(T.plaza[1]);
    const y = groundAt(x, z);
    ring(statics, x, y + 0.3, z, 2.0, 14, [0.5, 0.6, 0.62],
      (k) => (k % 2 ? PAL.stoneLight : PAL.stone));
    at(statics, x, y, z, 0, 1);
    statics.box(0, 0.15, 0, 4.4, 0.3, 4.4, PAL.stoneLight, { tint: 0.97 });
    statics.box(0, 1.0, 0, 0.9, 1.6, 0.9, PAL.stone);
    statics.box(0, 1.9, 0, 1.7, 0.3, 1.7, PAL.stoneDark);
    statics.box(0, 2.4, 0, 0.5, 0.8, 0.5, PAL.stone);
    statics.setTransform(null);

    const water = new VoxelBuilder();
    water.box(0, 0.45, 0, 3.4, 0.5, 3.4, 0x59c7e0);
    water.box(0, 2.1, 0, 0.8, 0.5, 0.8, 0x8fe4f2);
    water.box(0, 2.95, 0, 0.34, 0.8, 0.34, 0xcaf4ff);
    const wm = new THREE.Mesh(water.build(), toonMaterial({ vertexColors: true }));
    wm.position.set(x, y, z);
    scene.add(wm);
    updaters.push((dt, t) => {
      wm.scale.set(1, 1 + Math.sin(t * 2.6) * 0.04, 1);
      wm.position.y = y + Math.sin(t * 2.6) * 0.03;
    });

    // benches and planters round the square
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = x + Math.cos(a) * 3.6, bz = z + Math.sin(a) * 3.6;
      at(statics, bx, groundAt(bx, bz), bz, -a + Math.PI / 2, 1);
      statics.box(0, 0.44, 0, 1.9, 0.16, 0.5, COL.plank);
      statics.box(0, 0.72, -0.22, 1.9, 0.5, 0.12, COL.plank, { tint: 0.95 });
      for (const sx of [-1, 1]) statics.box(sx * 0.8, 0.22, 0, 0.16, 0.44, 0.44, PAL.timberDark);
      statics.setTransform(null);
    }
  }

  /* --- houses along the street and around the square --- */
  const plots = [
    [-11.5, -4.6, 0.1], [-11.0, 4.2, -0.2], [-7.0, -7.2, 0.35], [-6.5, 6.6, -0.3],
    [9.5, -2.5, -1.2], [11.5, 3.0, -1.6], [9.5, -7.0, -0.9], [-9.5, 8.0, 0.6],
  ];
  const roofs = [[PAL.roof, PAL.roofDark], [PAL.roofBlue, PAL.roofBlueDark],
    [PAL.copper, PAL.copperDark]];
  plots.forEach(([lx, lz, yaw], i) => {
    if (!clearOfLandmarks(lx, lz, 2.6)) return;
    house(statics, glow, rnd, lx, lz, yaw,
      2.8 + rnd() * 1.4, 3.0 + rnd() * 1.6, 2.4 + rnd() * 0.9,
      roofs[i % roofs.length]);
  });

  /* --- market stalls on the street --- */
  for (const [lx, lz, yaw] of [[-7.8, -1.6, 0], [-7.8, 1.6, Math.PI]]) {
    const x = wx(lx), z = wz(lz);
    const y = groundAt(x, z);
    at(statics, x, y, z, yaw, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      statics.box(sx * 0.95, 0.9, sz * 0.6, 0.12, 1.8, 0.12, PAL.timberDark);
    }
    statics.box(0, 0.85, 0, 2.1, 0.14, 1.3, COL.plank);
    for (let i = 0; i < 5; i++) {
      statics.box(-0.84 + i * 0.42, 1.95, 0, 0.42, 0.3, 1.7,
        i % 2 ? PAL.roof : PAL.wall);
    }
    statics.box(-0.5, 1.02, 0, 0.5, 0.2, 0.5, 0x9c8a6e);
    statics.box(0.3, 1.04, 0.1, 0.4, 0.24, 0.4, COL.bone);
    statics.setTransform(null);
  }

  /* --- street lamps --- */
  for (const [lx, lz] of [[-12.6, -1.9], [-12.6, 1.9], [-8.0, -2.6], [-8.0, 2.6],
    [-3.6, -3.2], [-3.6, 3.2], [1.5, 1.6], [6.2, -4.8], [-4.8, -3.8],
    [6.4, 4.2], [-1.0, 6.6]]) {
    if (!clearOfLandmarks(lx, lz, 0.6)) continue;
    lamp(statics, glow, lx, lz);
  }

  /* --- greenery: trees and hedges on the outskirts --- */
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 9 + Math.sqrt(rnd()) * 6.0;
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
    const x = wx(lx), z = wz(lz);
    if (!clearOfLandmarks(lx, lz, 1.8)) continue;
    if (Math.hypot(lx, lz) < 6) continue;
    // and out of the way of the houses
    if (plots.some(([hx, hz]) => Math.hypot(lx - hx, lz - hz) < 3.4)) continue;
    townTree(foliage, rnd, x, z, 0.7 + rnd() * 0.4);
  }

  /* --- commit the batches --- */
  const sGeo = statics.build();
  const sMesh = new THREE.Mesh(sGeo, toonMaterial({ vertexColors: true }));
  sMesh.name = 'town-static';
  sMesh.castShadow = true;
  sMesh.receiveShadow = true;
  sMesh.add(new THREE.Mesh(sGeo, outlineMaterial(0.024)));
  scene.add(sMesh);

  const fGeo = foliage.build();
  const fMat = toonMaterial({ vertexColors: true });
  applyWind(fMat, { mode: 'attribute', push: true, strength: 0.5 });
  const fMesh = new THREE.Mesh(fGeo, fMat);
  fMesh.name = 'town-foliage';
  fMesh.castShadow = true;
  fMesh.receiveShadow = true;
  fMesh.add(new THREE.Mesh(fGeo, windOutlineMaterial(0.026, 0x1b2333, {
    mode: 'attribute', push: true, strength: 0.5,
  })));
  scene.add(fMesh);

  const gGeo = glow.build();
  const gMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const gMesh = new THREE.Mesh(gGeo, gMat);
  gMesh.name = 'town-glow';
  gMesh.add(new THREE.Mesh(gGeo, outlineMaterial(0.016, 0x2a4a60)));
  scene.add(gMesh);
  updaters.push((dt, t) => {
    gMat.color.setScalar(0.84 + Math.sin(t * 1.4 + 1.1) * 0.09);
  });

  return {
    update(dt, t) { for (const u of updaters) u(dt, t); },
    dome,
    arena,
  };
}

/** Keep small props out of the dome's and the colosseum's footprints. */
function clearOfLandmarks(lx, lz, pad = 0) {
  if (Math.hypot(lx - T.dome[0], lz - T.dome[1]) < T.domeR + 1.0 + pad) return false;
  if (Math.hypot(lx - T.arena[0], lz - T.arena[1]) < T.arenaR + 1.0 + pad) return false;
  return true;
}

/** A rounder, tidier tree than the ones out at the dig. */
function townTree(b, rnd, x, z, scale) {
  const y = groundAt(x, z);
  const h = (2.2 + rnd() * 1.0) * scale;
  b.setPlant(x, y, z, h + 1.4, h * 0.4);
  at(b, x, y, z, rnd() * Math.PI * 2, 1);
  const segs = Math.max(3, Math.round(h / 0.5));
  for (let i = 0; i < segs; i++) {
    b.box(0, (i + 0.5) * (h / segs), 0, 0.34 * scale, h / segs + 0.02, 0.34 * scale,
      i % 2 ? COL.wood : COL.woodDark);
  }
  const cy = h + 0.7 * scale;
  for (const L of [[cy - 0.5, 1.25], [cy + 0.2, 1.5], [cy + 0.95, 1.0]]) {
    const n = Math.max(5, Math.round(L[1] * 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      const rr = L[1] * scale * (0.5 + rnd() * 0.5);
      b.box(Math.cos(a) * rr, L[0], Math.sin(a) * rr,
        0.85 * scale, 0.8 * scale, 0.85 * scale,
        [0x57ad3e, 0x66bd4a, 0x479a36][(rnd() * 3) | 0], { tint: 0.92 + rnd() * 0.16 });
    }
  }
  b.setTransform(null);
}
