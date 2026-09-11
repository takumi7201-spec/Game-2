// Everything that dresses the dig site: fossils, camp, ruins, foliage, tools.
// Static props are merged into a handful of batched draw calls; only things
// that actually move keep their own transform.
import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32, lerp, clamp } from '../lib/math.js';
import { VoxelBuilder, toonMaterial, addOutline, outlineMaterial } from '../lib/voxel.js';
import { applyWind, windOutlineMaterial } from '../lib/wind.js';
import { CFG, groundAt, isLand, surfaceAt, slopeAt } from './terrain.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Point the builder at a local frame (position + yaw/pitch/roll + scale). */
function at(b, x, y, z, yaw = 0, scale = 1, pitch = 0, roll = 0) {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.setScalar(scale);
  _m.compose(_v, _q, _s);
  return b.setTransform(_m);
}

/** A standalone copy of a local frame, so nested parts can compose onto it. */
function frame(x, y, z, yaw = 0, scale = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    new THREE.Vector3(scale, scale, scale),
  );
}

const _rm = new THREE.Matrix4();
const _rq = new THREE.Quaternion();
const _rd = new THREE.Vector3();
const _rc = new THREE.Vector3();
const _r1 = new THREE.Vector3(1, 1, 1);
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * A bone segment: a box rotated to lie along a->b inside `base`.
 * Chaining these with a shrinking width gives smooth tapered rods instead of
 * a staircase of axis-aligned cubes.
 */
function rod(b, base, a, c, w, color, opts = {}, pad = 0.04) {
  _rd.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = _rd.length();
  if (len < 1e-5) return;
  _rd.divideScalar(len);
  _rq.setFromUnitVectors(_UP, _rd);
  _rc.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  _rm.compose(_rc, _rq, _r1);
  _rm.premultiply(base);
  b.setTransform(_rm);
  b.box(0, 0, 0, w, len + pad, w, color, opts);
}

const COL = {
  bone: 0xf3ead2, boneDark: 0xded1b0, boneWarm: 0xfdf7e4,
  wood: 0x8a5a34, woodDark: 0x6d452a, plank: 0xa9743f,
  stone: 0x8e9aa8, stoneDark: 0x6f7c8b, stoneLight: 0xb3bfcb,
  canvas: 0xf2e3c2, canvasRed: 0xd4614f,
  metal: 0x9fb0c2, rope: 0xc7a86b,
  leaf: [0x4fa83c, 0x63bd48, 0x3f8f32, 0x76c95a],
  leafWarm: [0x8fc44a, 0xb8cf4d],
  amber: 0xffb347, crystal: 0x6fe6ff, rune: 0x9ad9ff,
};

/* ================================================================== *
 *  Prop generators (all write into a shared builder)                  *
 * ================================================================== */

function tree(b, rnd, x, z, scale = 1) {
  const y = groundAt(x, z);
  const h = (2.6 + rnd() * 1.9) * scale;
  b.setPlant(x, y, z, h + 1.6, h * 0.35);
  const yaw = rnd() * Math.PI * 2;
  at(b, x, y, z, yaw, 1);
  const tw = 0.42 * scale;
  // trunk, leaning a touch for character
  let tx = 0, tz = 0;
  const lean = (rnd() - 0.5) * 0.5;
  const segs = Math.max(3, Math.round(h / 0.55));
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    b.box(tx, (i + 0.5) * (h / segs), tz, tw * (1 - t * 0.28), h / segs + 0.02, tw * (1 - t * 0.28),
      i % 2 ? COL.wood : COL.woodDark, { tint: 0.94 + rnd() * 0.14 });
    tx += lean * 0.12; tz += lean * 0.08;
  }
  // roots
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rnd();
    b.box(Math.cos(a) * 0.42 * scale, 0.12, Math.sin(a) * 0.42 * scale,
      0.34 * scale, 0.3, 0.34 * scale, COL.woodDark, { tint: 0.95 });
  }
  // chunky canopy
  const cy = h + 0.5 * scale;
  const layers = [
    { y: cy - 0.55 * scale, r: 1.5 * scale, s: 0.95 * scale },
    { y: cy + 0.25 * scale, r: 1.85 * scale, s: 1.05 * scale },
    { y: cy + 1.0 * scale, r: 1.35 * scale, s: 0.95 * scale },
    { y: cy + 1.6 * scale, r: 0.8 * scale, s: 0.8 * scale },
  ];
  for (const L of layers) {
    const n = Math.max(4, Math.round(L.r * 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
      const rr = L.r * (0.45 + rnd() * 0.62);
      const c = COL.leaf[(rnd() * COL.leaf.length) | 0];
      b.box(tx + Math.cos(a) * rr, L.y + (rnd() - 0.5) * 0.35, tz + Math.sin(a) * rr,
        L.s * (0.8 + rnd() * 0.6), L.s * (0.7 + rnd() * 0.5), L.s * (0.8 + rnd() * 0.6),
        c, { tint: 0.9 + rnd() * 0.2 });
    }
    b.box(tx, L.y, tz, L.r * 1.05, L.s, L.r * 1.05, COL.leaf[2], { tint: 0.95 });
  }
  // a couple of glowing fruit for the fantasy note
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2, rr = 1.3 * scale;
    b.box(tx + Math.cos(a) * rr, cy + rnd() * 1.2, tz + Math.sin(a) * rr,
      0.2, 0.2, 0.2, rnd() < 0.5 ? COL.amber : 0xff7d9c);
  }
  b.setTransform(null);
}

function bush(b, rnd, x, z, scale = 1) {
  const y = groundAt(x, z);
  b.setPlant(x, y, z, 1.5 * scale, 0.1);
  at(b, x, y, z, rnd() * Math.PI * 2, 1);
  const n = 5 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = 0.35 * scale * (0.5 + rnd());
    b.box(Math.cos(a) * rr, 0.3 * scale + rnd() * 0.35 * scale, Math.sin(a) * rr,
      0.66 * scale, 0.6 * scale, 0.66 * scale,
      COL.leaf[(rnd() * COL.leaf.length) | 0], { tint: 0.88 + rnd() * 0.22 });
  }
  if (rnd() < 0.6) {
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      b.box(Math.cos(a) * 0.5 * scale, 0.55 * scale + rnd() * 0.3, Math.sin(a) * 0.5 * scale,
        0.16, 0.16, 0.16, 0xff5f6d);
    }
  }
  b.setTransform(null);
}

function cattail(b, rnd, x, z) {
  const y = groundAt(x, z);
  b.setPlant(x, y, z, 1.8, 0.2);
  at(b, x, y, z, rnd() * Math.PI * 2, 1);
  const h = 1.1 + rnd() * 0.7;
  b.box(0, h / 2, 0, 0.09, h, 0.09, 0x5f9e3c);
  b.box(0, h + 0.22, 0, 0.18, 0.46, 0.18, 0x7a5230);
  b.box(0, h + 0.5, 0, 0.09, 0.16, 0.09, 0x5f9e3c);
  b.setTransform(null);
}

function fern(b, rnd, x, z) {
  const y = groundAt(x, z);
  b.setPlant(x, y, z, 1.3, 0.05);
  at(b, x, y, z, rnd() * Math.PI * 2, 1);
  const blades = 5 + ((rnd() * 3) | 0);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const len = 0.7 + rnd() * 0.5;
    for (let s = 0; s < 4; s++) {
      const t = s / 4;
      b.box(Math.cos(a) * len * t, 0.18 + t * 0.85, Math.sin(a) * len * t,
        0.24 * (1 - t * 0.5), 0.16, 0.24 * (1 - t * 0.5),
        COL.leaf[(rnd() * COL.leaf.length) | 0], { tint: 0.85 + rnd() * 0.2 });
    }
  }
  b.setTransform(null);
}

function rock(b, rnd, x, z, scale = 1) {
  const y = groundAt(x, z);
  at(b, x, y, z, rnd() * Math.PI * 2, 1);
  const n = 2 + ((rnd() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const s = (0.55 + rnd() * 0.85) * scale;
    b.box((rnd() - 0.5) * 0.7 * scale, s * 0.42 + rnd() * 0.15, (rnd() - 0.5) * 0.7 * scale,
      s * 1.25, s, s * 1.25,
      [COL.stone, COL.stoneDark, COL.stoneLight][(rnd() * 3) | 0], { tint: 0.9 + rnd() * 0.2 });
  }
  b.setTransform(null);
}

function mushroomPatch(g, rnd, x, z) {
  const y = groundAt(x, z);
  at(g, x, y, z, 0, 1);
  const n = 3 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const ox = (rnd() - 0.5) * 1.4, oz = (rnd() - 0.5) * 1.4;
    const h = 0.28 + rnd() * 0.5;
    const w = 0.18 + rnd() * 0.16;
    g.box(ox, h / 2, oz, w * 0.55, h, w * 0.55, 0xf3ead6);
    g.box(ox, h + 0.1, oz, w * 2.1, 0.22, w * 2.1, 0x7ce6ff);
    g.box(ox, h + 0.24, oz, w * 1.3, 0.12, w * 1.3, 0xb6f4ff);
  }
  g.setTransform(null);
}

function crystalCluster(g, rnd, x, z, scale = 1) {
  const y = groundAt(x, z);
  at(g, x, y, z, rnd() * Math.PI * 2, 1);
  const n = 3 + ((rnd() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const rr = 0.28 * scale * rnd();
    const h = (0.7 + rnd() * 1.1) * scale;
    const w = (0.2 + rnd() * 0.16) * scale;
    const col = rnd() < 0.5 ? COL.crystal : 0xb98cff;
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      g.box(Math.cos(a) * rr, h * t + h / (2 * steps), Math.sin(a) * rr,
        w * (1 - t * 0.75), h / steps, w * (1 - t * 0.75), col, { tint: 0.85 + t * 0.3 });
    }
  }
  g.setTransform(null);
}

function crate(b, rnd, x, z, yaw, scale = 1) {
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  const s = 0.8 * scale;
  b.box(0, s / 2, 0, s, s, s, COL.plank, { tint: 0.96 });
  for (const [dx, dz] of [[s / 2, 0], [-s / 2, 0], [0, s / 2], [0, -s / 2]]) {
    b.box(dx, s / 2, dz, dz ? s * 1.02 : 0.08, 0.1, dx ? s * 1.02 : 0.08, COL.woodDark);
  }
  b.box(0, s + 0.03, 0, s * 1.02, 0.08, s * 1.02, COL.woodDark);
  b.setTransform(null);
}

function barrel(b, rnd, x, z, yaw) {
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  b.box(0, 0.45, 0, 0.62, 0.9, 0.62, COL.wood);
  b.box(0, 0.45, 0, 0.7, 0.62, 0.5, COL.wood, { tint: 0.94 });
  b.box(0, 0.45, 0, 0.5, 0.62, 0.7, COL.wood, { tint: 0.94 });
  b.box(0, 0.2, 0, 0.72, 0.1, 0.62, COL.metal);
  b.box(0, 0.7, 0, 0.72, 0.1, 0.62, COL.metal);
  b.box(0, 0.92, 0, 0.56, 0.06, 0.56, COL.woodDark);
  b.setTransform(null);
}

function tent(b, x, z, yaw) {
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  const L = 3.2, W = 2.6, H = 2.1;
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const t = i / rows;
    const w = W * (1 - t) + 0.1;
    const yy = t * H;
    const c = i % 2 === 0 ? COL.canvas : COL.canvasRed;
    b.box(0, yy + H / (2 * rows), 0, w, H / rows + 0.02, L, c, { tint: 0.97 });
  }
  b.box(0, H + 0.06, 0, 0.22, 0.16, L + 0.3, COL.woodDark);
  // dark opening
  b.box(0, 0.75, L / 2 + 0.02, 1.05, 1.5, 0.12, 0x30303c);
  b.box(0.62, 0.85, L / 2 + 0.06, 0.3, 1.7, 0.1, COL.canvas, { tint: 0.9 });
  b.box(-0.62, 0.85, L / 2 + 0.06, 0.3, 1.7, 0.1, COL.canvas, { tint: 0.9 });
  // guy ropes + pegs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(sx * (W / 2 + 0.55), 0.08, sz * (L / 2 + 0.35), 0.12, 0.16, 0.12, COL.woodDark);
    }
  }
  b.setTransform(null);
}

function lantern(b, g, x, z, yaw) {
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  b.box(0, 0.9, 0, 0.16, 1.8, 0.16, COL.woodDark);
  b.box(0.22, 1.74, 0, 0.5, 0.12, 0.12, COL.woodDark);
  b.box(0.44, 1.5, 0, 0.34, 0.1, 0.34, COL.metal);
  b.box(0.44, 1.12, 0, 0.34, 0.1, 0.34, COL.metal);
  b.setTransform(null);
  at(g, x, y, z, yaw, 1);
  g.box(0.44, 1.31, 0, 0.28, 0.32, 0.28, 0xffd77a);
  g.setTransform(null);
}

function signpost(b, x, z, yaw) {
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  b.box(0, 0.85, 0, 0.18, 1.7, 0.18, COL.wood);
  b.box(0.42, 1.5, 0, 1.1, 0.34, 0.1, COL.plank);
  b.box(-0.45, 1.05, 0, 1.0, 0.3, 0.1, COL.plank, { tint: 0.94 });
  b.box(0.75, 1.5, 0.06, 0.5, 0.1, 0.03, COL.woodDark);
  b.box(-0.6, 1.05, 0.06, 0.4, 0.08, 0.03, COL.woodDark);
  b.setTransform(null);
}

/**
 * Tyrannosaurus skull, built by projecting its lateral profile into voxels.
 *
 * A theropod skull reads as one because of its openings, not because of horns:
 * the dorsal/ventral margins are sampled per column, the fenestrae are punched
 * through as ellipses, and the cross-section swells at mid height so the thing
 * is an arch rather than a slab. Columns run snout (0) to occiput (25).
 */
const TREX = {
  cell: 0.085,
  cols: 26,
  // Landmarks follow a lateral drawing of a large specimen, normalised so that
  // snout tip -> occiput is 25 cells and everything else is measured in the
  // same square cells above the maxillary tooth row.
  // dorsal margin: long and low over the snout, then a steep climb at the
  // lacrimal to a deep, boxy back - the T. rex signature
  top: [5.5, 5.8, 6.1, 6.3, 6.5, 6.6, 6.8, 6.9, 7.1, 7.4, 7.8, 8.3, 9.0,
        9.9, 11.0, 12.2, 13.1, 13.7, 14.0, 14.1, 14.1, 14.0, 13.7, 13.1, 12.1, 11.0],
  // ventral margin: flat tooth row to 60%, then the jugal arch, then the
  // quadrate dropping back down to the jaw joint
  bot: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0.4, 1.6, 2.8, 3.4, 3.8, 3.9, 3.4, 2.0, 0.6, 1.2],
  // full width in cells: narrow snout, very broad braincase
  wide: [3.2, 3.4, 3.6, 3.7, 3.8, 3.9, 4.0, 4.2, 4.4, 4.7, 5.0, 5.4, 5.9,
         6.5, 7.2, 8.0, 8.9, 9.8, 10.8, 11.8, 12.4, 12.5, 12.2, 11.4, 10.2, 9.0],
  holes: [
    { cx: 4.3, cy: 4.5, rx: 2.0, ry: 1.25 },     // external naris
    { cx: 8.3, cy: 3.4, rx: 0.8, ry: 0.9 },      // maxillary fenestra
    { cx: 12.0, cy: 5.0, rx: 2.2, ry: 2.6 },     // antorbital fenestra, rear lobe
    { cx: 10.3, cy: 3.7, rx: 1.4, ry: 1.5 },     // ... tapering forward to a point
    { cx: 16.7, cy: 10.2, rx: 1.8, ry: 1.7 },    // orbit, round upper lobe
    { cx: 16.5, cy: 8.2, rx: 0.85, ry: 1.6 },    // orbit, keyhole slot below
    { cx: 21.3, cy: 7.8, rx: 1.95, ry: 3.1 },    // lateral temporal fenestra
  ],
  jawTop: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
           0.4, 1.0, 1.6, 1.9, 1.8, 1.4, 1.0, 0.7, 0.5],
  jawBot: [-1.6, -2.4, -2.9, -3.1, -3.2, -3.2, -3.15, -3.1, -3.0, -2.9,
           -2.8, -2.7, -2.6, -2.5, -2.45, -2.4, -2.35, -2.3, -2.2, -2.1,
           -2.0, -1.9, -1.7, -1.4, -1.0, -1.6],
  jawHoles: [{ cx: 15.6, cy: -1.3, rx: 1.9, ry: 0.7 }],
};

const inHole = (holes, c, r) => {
  for (const h of holes) {
    const u = (c - h.cx) / h.rx, v = (r - h.cy) / h.ry;
    if (u * u + v * v < 1) return true;
  }
  return false;
};

/** Half-width multiplier across the skull's height: an arch, not a slab. */
const archProfile = (v) => 0.58 + 0.42 * Math.sin(Math.PI * Math.pow(clamp(v, 0, 1), 0.85));

export function trexSkull(b, base, ox, oy, oz, tilt, rnd, jawDrop = 0.2) {
  const T = TREX;
  const cell = T.cell;
  const bone = () => (rnd() < 0.22 ? COL.boneWarm : COL.bone);
  const skullM = new THREE.Matrix4()
    .compose(new THREE.Vector3(ox, oy, oz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, tilt)),
      new THREE.Vector3(1, 1, 1))
    .premultiply(base);

  const xOf = (c) => (T.cols - 1 - c) * cell;
  const put = (m, x, y, z, w, h, d, tint) => {
    b.setTransform(m);
    b.box(x, y, z, w, h, d, bone(), { tint: tint * (0.96 + rnd() * 0.08) });
  };

  // --- cranium ------------------------------------------------------------
  const solid = (c, r) => {
    if (c < 0 || c >= T.cols) return false;
    const mid = r + 0.5;
    return mid >= T.bot[c] && mid <= T.top[c] && !inHole(T.holes, c + 0.5, mid);
  };
  for (let c = 0; c < T.cols; c++) {
    const span = T.top[c] - T.bot[c];
    for (let r = 0; r < Math.ceil(T.top[c]); r++) {
      if (!solid(c, r)) continue;
      const mid = r + 0.5;
      const v = (mid - T.bot[c]) / Math.max(span, 0.001);
      // thin the bone down around every opening so the rims read as recessed
      const rim = !solid(c - 1, r) || !solid(c + 1, r) || !solid(c, r - 1) || !solid(c, r + 1);
      const w = T.wide[c] * cell * archProfile(v) * (rim ? 0.78 : 1);
      put(skullM, xOf(c), mid * cell, 0, cell * 1.02, cell * 1.02, w, rim ? 0.9 : 1);
    }
  }
  // lateral offset that actually lands on the skull surface at a given height
  const surfaceZ = (c, row) => {
    const ci = Math.round(c);
    const v = (row - T.bot[ci]) / Math.max(T.top[ci] - T.bot[ci], 0.001);
    return T.wide[ci] * cell * archProfile(v) * 0.44;
  };

  // occipital condyle + the rugose bosses over each orbit (a T. rex has
  // roughened lumps on the lacrimal and postorbital, never horns)
  put(skullM, xOf(25) - cell * 0.7, cell * 2.6, 0, cell * 1.4, cell * 1.7, cell * 1.7, 0.94);
  for (const s of [-1, 1]) {
    put(skullM, xOf(15.6), cell * 9.6, s * surfaceZ(16, 9.6),
      cell * 2.2, cell * 1.5, cell * 1.3, 0.96);        // rugose lacrimal boss
    put(skullM, xOf(18.4), cell * 11.2, s * surfaceZ(18, 11.2),
      cell * 1.8, cell * 1.3, cell * 1.2, 0.96);        // postorbital boss
  }

  // --- lower jaw, hinged open at the articulation --------------------------
  const px = xOf(24.5), py = cell * 0.4;
  const jawM = new THREE.Matrix4().makeTranslation(px, py - cell * 0.35, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(-jawDrop))
    .multiply(new THREE.Matrix4().makeTranslation(-px, -py, 0))
    .premultiply(skullM);
  const jawSolid = (c, r) => {
    if (c < 0 || c >= T.cols) return false;
    const mid = r + 0.5;
    return mid <= T.jawTop[c] && mid >= T.jawBot[c] && !inHole(T.jawHoles, c + 0.5, mid);
  };
  for (let c = 0; c < T.cols; c++) {
    for (let r = Math.floor(T.jawBot[c]); r <= Math.ceil(T.jawTop[c]); r++) {
      if (!jawSolid(c, r)) continue;
      const rim = !jawSolid(c - 1, r) || !jawSolid(c + 1, r)
        || !jawSolid(c, r - 1) || !jawSolid(c, r + 1);
      const w = T.wide[c] * cell * 0.78 * (rim ? 0.84 : 1);
      put(jawM, xOf(c), (r + 0.5) * cell, 0, cell * 1.02, cell * 1.02, w, rim ? 0.92 : 1);
    }
  }

  // --- teeth: big recurved bananas in the maxilla, smaller in the dentary --
  const toothLen = (c) => 1.1 + 2.0 * Math.exp(-Math.pow((c - 5.5) / 5.5, 2));
  for (let c = 0.7; c < 15.6; c += 1.15) {
    const ci = Math.round(c);
    const L = toothLen(c) * cell;
    const z = T.wide[ci] * cell * archProfile(0) * 0.44;
    const x = xOf(c);
    for (const s of [-1, 1]) {
      // upper: down and raked back, tapering to a point
      rod(b, skullM, [x, 0, s * z], [x - L * 0.16, -L * 0.62, s * z * 0.98],
        cell * 0.62, bone(), { tint: 1.04 }, 0);
      rod(b, skullM, [x - L * 0.16, -L * 0.62, s * z * 0.98],
        [x - L * 0.3, -L, s * z * 0.95], cell * 0.34, bone(), { tint: 1.06 }, 0);
      // lower
      const L2 = L * 0.82;
      rod(b, jawM, [x, 0, s * z * 0.9], [x - L2 * 0.12, L2 * 0.6, s * z * 0.88],
        cell * 0.54, bone(), { tint: 1.04 }, 0);
      rod(b, jawM, [x - L2 * 0.12, L2 * 0.6, s * z * 0.88],
        [x - L2 * 0.24, L2, s * z * 0.86], cell * 0.3, bone(), { tint: 1.06 }, 0);
    }
  }
  b.setTransform(null);
  return { length: (T.cols - 1) * cell, height: 14.1 * cell };
}

/** The star of the dig: a huge half-buried fossil beast. */
function fossilBeast(b, rnd, cx, cz, yaw) {
  const base = frame(cx, CFG.pit.floor + 0.95, cz, yaw, 1.4);
  const col = () => (rnd() < 0.22 ? COL.boneWarm : COL.bone);
  const jit = (t = 1) => ({ tint: t * (0.95 + rnd() * 0.1) });
  const blk = (x, y, z, w, h, d, c = col(), t = 1) => {
    b.setTransform(base);
    b.box(x, y, z, w, h, d, c, jit(t));
  };
  const seg = (a, c, w, t = 1, pad) => rod(b, base, a, c, w, col(), jit(t), pad);

  // --- spine: a chain of vertebrae lying along the floor of the trench -----
  const N = 15;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    pts.push([
      lerp(-4.2, 2.4, u),
      1.05 + Math.sin(u * Math.PI) * 0.4,
      Math.sin(u * 1.8) * 0.3,
    ]);
  }
  for (let i = 0; i < N - 1; i++) {
    const u = i / (N - 2);
    const w = lerp(0.6, 0.36, Math.abs(u - 0.3) * 1.2);
    seg(pts[i], pts[i + 1], w, 1, -0.08);          // negative pad -> visible joints
    // neural spine, raked back the way real vertebrae are
    const [x, y, z] = pts[i];
    seg([x, y + w * 0.4, z], [x - 0.16, y + w * 0.45 + 0.62, z], w * 0.45, 0.97);
  }

  // --- rib cage: the spine rides on top and the ribs bow out and down into
  //     the dirt, closing back in under the belly the way a real cage does ---
  for (let i = 1; i < 13; i += 2) {
    const [x, y, z] = pts[i];
    const t = (i - 1) / 12;
    const bell = Math.sin(t * Math.PI * 0.92 + 0.18);
    const span = 0.95 + bell * 0.75;               // how far the ribs bow out
    const drop = 1.5 + bell * 0.75;                // how deep the cage goes
    const thMax = 2.15;                            // >90deg so the tips curl in
    for (const s of [-1, 1]) {
      const steps = 12;
      let prev = [x, y - 0.06, z + s * 0.22];
      for (let k = 1; k <= steps; k++) {
        const u = k / steps;
        const th = u * thMax;
        const next = [
          x + Math.sin(u * 1.15) * 0.3,
          y - (1 - Math.cos(th)) * drop,
          z + s * Math.sin(th) * span,
        ];
        seg(prev, next, lerp(0.34, 0.14, u), 1 - u * 0.05);
        prev = next;
      }
    }
  }

  // --- neck and skull ------------------------------------------------------
  const [hx, hy, hz] = pts[N - 1];
  const neck = [
    [hx, hy, hz],
    [hx + 0.42, hy + 0.28, hz - 0.05],
    [hx + 0.78, hy + 0.62, hz - 0.08],
    [hx + 1.02, hy + 0.92, hz - 0.1],
  ];
  for (let i = 0; i < neck.length - 1; i++) {
    seg(neck[i], neck[i + 1], lerp(0.5, 0.36, i / 2), 0.98, -0.04);
  }
  trexSkull(b, base, neck[3][0] + 0.06, neck[3][1] + 0.02, neck[3][2], 0.22, rnd, 0.16);

  // --- limbs, half sunk in the clay ---------------------------------------
  for (const s of [-1, 1]) {
    seg([0.9, 0.75, s * 1.25], [1.35, -0.55, s * 1.95], 0.4);    // humerus
    blk(0.9, 0.8, s * 1.2, 0.5, 0.46, 0.5);                      // shoulder knob
    seg([1.35, -0.55, s * 1.95], [2.05, -0.95, s * 2.3], 0.3);   // forearm
    for (let f = -1; f <= 1; f++) {
      seg([2.05, -0.95, s * 2.3], [2.55, -1.05, s * (2.3 + f * 0.35)], 0.16, 1, 0.02);
    }
    seg([-1.9, 0.7, s * 1.1], [-2.5, -0.6, s * 1.8], 0.36);      // hind limb
    blk(-1.9, 0.75, s * 1.05, 0.46, 0.42, 0.46);
  }

  // --- tail vanishing into the pit wall ------------------------------------
  let tp = pts[0];
  for (let i = 1; i <= 5; i++) {
    const u = i / 5;
    const nt = [pts[0][0] - u * 2.6, pts[0][1] - u * 1.15, pts[0][2] + Math.sin(u * 2.2) * 0.6];
    seg(tp, nt, lerp(0.36, 0.14, u), 1, -0.05);
    tp = nt;
  }
  b.setTransform(null);
}

function ammonite(b, rnd, x, y, z, yaw, scale = 1) {
  at(b, x, y, z, yaw, 1);
  const turns = 2.4;
  const steps = 44;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2 * turns;
    const r = (0.25 + t * 1.5) * scale;
    const w = (0.18 + t * 0.42) * scale;
    b.box(Math.cos(a) * r, Math.sin(a) * r, 0, w, w, w * 1.4,
      i % 3 === 0 ? COL.boneDark : COL.bone, { tint: 0.92 + t * 0.18 });
  }
  b.setTransform(null);
}

function boneArch(b, rnd, x, z, yaw) {
  const base = frame(x, groundAt(x, z), z, yaw, 1);
  const col = () => (rnd() < 0.3 ? COL.boneDark : COL.bone);
  for (const s of [-1, 1]) {
    const steps = 14;
    let prev = [s * 3.3, 0.1, 0];
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const a = u * Math.PI * 0.52;
      const next = [s * (Math.cos(a) * 3.4 - 0.2), Math.sin(a) * 4.6, Math.sin(u * 2.2) * 0.25];
      rod(b, base, prev, next, lerp(0.62, 0.3, u), col(), { tint: 0.94 + rnd() * 0.1 });
      prev = next;
    }
    b.setTransform(base);
    b.box(s * 3.3, 0.35, 0, 1.15, 0.75, 1.15, COL.boneDark, { tint: 0.96 });
  }
  b.setTransform(base);
  b.box(0, 4.6, 0, 0.85, 0.5, 0.7, COL.boneWarm);
  b.setTransform(null);
}

function scaffold(b, x, z, yaw) {
  const y = groundAt(x, z);
  at(b, x, y, z, yaw, 1);
  const H = 3.0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(sx * 0.9, H / 2, sz * 0.7, 0.16, H, 0.16, COL.wood);
    }
  }
  for (const yy of [1.1, 2.2]) {
    b.box(0, yy, 0.7, 1.96, 0.1, 0.12, COL.woodDark);
    b.box(0, yy, -0.7, 1.96, 0.1, 0.12, COL.woodDark);
  }
  for (let i = 0; i < 4; i++) {
    b.box(0, H + 0.08, -0.55 + i * 0.37, 2.0, 0.12, 0.32, COL.plank, { tint: 0.95 + i * 0.02 });
  }
  b.box(-0.9, H + 0.45, 0, 0.12, 0.8, 1.5, COL.woodDark);
  b.setTransform(null);
}

function ladder(b, x, y, z, yaw, len) {
  at(b, x, y, z, yaw, 1, -0.22);
  for (const s of [-1, 1]) b.box(s * 0.28, len / 2, 0, 0.1, len, 0.1, COL.wood);
  const rungs = Math.round(len / 0.42);
  for (let i = 1; i < rungs; i++) b.box(0, i * 0.42, 0, 0.62, 0.08, 0.08, COL.woodDark);
  b.setTransform(null);
}

function ropeFence(b, rnd, cx, cz, radius, posts) {
  const pts = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
    const y = groundAt(x, z);
    pts.push([x, y, z]);
    at(b, x, y, z, a, 1);
    b.box(0, 0.55, 0, 0.16, 1.1, 0.16, COL.wood, { tint: 0.92 + rnd() * 0.16 });
    b.box(0, 1.12, 0, 0.22, 0.12, 0.22, COL.woodDark);
    b.setTransform(null);
  }
  // sagging rope between posts
  for (let i = 0; i < posts; i++) {
    const a = pts[i], c = pts[(i + 1) % posts];
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const x = lerp(a[0], c[0], t), z = lerp(a[2], c[2], t);
      const sag = Math.sin(t * Math.PI) * 0.18;
      const y = lerp(a[1], c[1], t) + 0.92 - sag;
      const len = Math.hypot(c[0] - a[0], c[2] - a[2]) / steps + 0.06;
      at(b, x, y, z, Math.atan2(c[2] - a[2], c[0] - a[0]), 1);
      b.box(0, 0, 0, len, 0.075, 0.075, COL.rope);
      b.setTransform(null);
    }
  }
}

function obelisk(b, g, x, z) {
  const y = groundAt(x, z);
  at(b, x, y, z, 0.3, 1);
  b.box(0, 0.2, 0, 3.0, 0.4, 3.0, COL.stoneDark);
  b.box(0, 0.55, 0, 2.3, 0.4, 2.3, COL.stone);
  const H = 5.4;
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const w = lerp(1.15, 0.55, t);
    b.box(0, 0.75 + t * H + H / (2 * segs), 0, w, H / segs + 0.02, w,
      i % 2 ? COL.stone : COL.stoneLight, { tint: 0.96 });
  }
  b.box(0, 0.78 + H + 0.3, 0, 0.7, 0.6, 0.7, COL.stoneDark);
  b.setTransform(null);
  // runes carved on two faces
  at(g, x, y, z, 0.3, 1);
  for (let i = 0; i < 7; i++) {
    const yy = 1.4 + i * 0.62;
    const w = lerp(1.05, 0.5, i / 8);
    g.box(0, yy, w / 2 + 0.01, 0.26, 0.26, 0.04, COL.rune);
    g.box(w / 2 + 0.01, yy - 0.28, 0, 0.04, 0.18, 0.18, COL.rune);
  }
  g.box(0, 0.78 + H + 0.3, 0, 0.3, 0.3, 0.74, 0xd6f0ff);
  g.setTransform(null);
}

function brokenPillar(b, rnd, x, z, h) {
  const y = groundAt(x, z);
  at(b, x, y, z, rnd() * Math.PI * 2, 1);
  const segs = Math.max(1, Math.round(h / 0.6));
  for (let i = 0; i < segs; i++) {
    const w = 0.8 - i * 0.03;
    b.box((rnd() - 0.5) * 0.1, i * 0.6 + 0.3, (rnd() - 0.5) * 0.1, w, 0.6, w,
      i % 2 ? COL.stone : COL.stoneLight, { tint: 0.93 + rnd() * 0.14 });
  }
  b.box(0, 0.1, 0, 1.15, 0.2, 1.15, COL.stoneDark);
  b.setTransform(null);
}

function digTools(b, rnd, x, z) {
  const y = groundAt(x, z);
  // pickaxe stuck in the dirt
  at(b, x, y, z, rnd() * Math.PI * 2, 1, 0, 0.42);
  b.box(0, 0.62, 0, 0.11, 1.5, 0.11, COL.wood);
  b.box(0, 1.36, 0, 0.9, 0.16, 0.16, COL.metal);
  b.box(0.45, 1.3, 0, 0.22, 0.2, 0.14, COL.stoneDark);
  b.setTransform(null);
  // brush + bucket next to it
  at(b, x + 0.9, y, z + 0.5, rnd(), 1);
  b.box(0, 0.28, 0, 0.5, 0.56, 0.5, COL.metal, { tint: 0.9 });
  b.box(0, 0.58, 0, 0.42, 0.08, 0.42, 0x5c6673);
  b.setTransform(null);
  at(b, x - 0.7, y, z - 0.4, rnd() * 3, 1, 1.4);
  b.box(0, 0.06, 0, 0.1, 0.5, 0.1, COL.wood);
  b.box(0, 0.06, 0.3, 0.16, 0.22, 0.2, 0xe8d7a8);
  b.setTransform(null);
}

function lilyPad(b, rnd, x, z, wy) {
  at(b, x, wy + 0.02, z, rnd() * Math.PI * 2, 1);
  const s = 0.34 + rnd() * 0.28;
  b.box(0, 0, 0, s * 1.6, 0.08, s * 1.6, 0x4ea83f, { tint: 0.92 + rnd() * 0.16 });
  b.box(s * 0.6, 0.01, s * 0.6, s * 0.8, 0.07, s * 0.8, 0x5fbb46);
  if (rnd() < 0.35) {
    b.box(0, 0.16, 0, 0.22, 0.22, 0.22, 0xffd6ea);
    b.box(0, 0.3, 0, 0.12, 0.1, 0.12, 0xfff0a8);
  }
  b.setTransform(null);
}

/* ================================================================== *
 *  Animated props                                                     *
 * ================================================================== */

function makeCampfire(x, z) {
  const y = groundAt(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);

  const b = new VoxelBuilder();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    at(b, Math.cos(a) * 0.95, 0.14, Math.sin(a) * 0.95, a, 1);
    b.box(0, 0, 0, 0.42, 0.32, 0.3, i % 2 ? COL.stone : COL.stoneDark);
    b.setTransform(null);
  }
  for (let i = 0; i < 4; i++) {
    at(b, 0, 0.2, 0, (i / 4) * Math.PI + 0.3, 1, 0, 0.35);
    b.box(0, 0, 0, 1.5, 0.24, 0.24, i % 2 ? COL.wood : COL.woodDark);
    b.setTransform(null);
  }
  b.box(0, 0.12, 0, 0.9, 0.2, 0.9, 0x3a2a22);
  const logs = new THREE.Mesh(b.build(), toonMaterial({ vertexColors: true }));
  logs.castShadow = true;
  logs.receiveShadow = true;
  addOutline(logs, 0.022);
  group.add(logs);

  // stepped voxel flame
  const f = new VoxelBuilder();
  const flameCols = [0xffd34d, 0xff9a3c, 0xff6b35, 0xffe9a8];
  const tiers = [
    [0.0, 0.30, 0.72], [0.0, 0.72, 0.55], [0.1, 1.05, 0.4], [-0.05, 1.32, 0.26], [0.05, 1.52, 0.16],
  ];
  tiers.forEach(([ox, oy, s], i) => {
    f.box(ox, oy, 0, s, 0.4, s, flameCols[i % flameCols.length]);
  });
  const flame = new THREE.Mesh(f.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  flame.position.y = 0.2;
  group.add(flame);

  const light = new THREE.PointLight(0xffb066, 12, 14, 2);
  group.add(light);

  return { group, flame, light, y };
}

function makeDrillRig(x, z, yaw) {
  const y = groundAt(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = yaw;

  const b = new VoxelBuilder();
  // derrick legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      at(b, sx * 1.0, 0, sz * 1.0, 0, 1, sz * 0.16, -sx * 0.16);
      b.box(0, 1.7, 0, 0.2, 3.4, 0.2, COL.wood);
      b.setTransform(null);
    }
  }
  b.box(0, 3.45, 0, 1.4, 0.22, 1.4, COL.woodDark);
  b.box(0, 0.55, 1.05, 2.2, 0.14, 0.14, COL.woodDark);
  b.box(0, 1.8, -1.05, 2.2, 0.14, 0.14, COL.woodDark);
  b.box(0, 0.12, 0, 2.6, 0.24, 2.6, COL.plank, { tint: 0.94 });
  const frame = new THREE.Mesh(b.build(), toonMaterial({ vertexColors: true }));
  frame.castShadow = true;
  addOutline(frame, 0.024);
  group.add(frame);

  // spinning wheel
  const w = new VoxelBuilder();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    at(w, Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0, 0, 1, 0, a);
    w.box(0, 0, 0, 0.42, 0.18, 0.24, i % 2 ? COL.wood : COL.plank);
    w.setTransform(null);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    at(w, 0, 0, 0, 0, 1, 0, a);
    w.box(0, 0, 0, 1.44, 0.13, 0.16, COL.woodDark);
    w.setTransform(null);
  }
  w.box(0, 0, 0, 0.3, 0.3, 0.34, COL.metal);
  const wheel = new THREE.Mesh(w.build(), toonMaterial({ vertexColors: true }));
  wheel.position.set(0, 2.4, 1.0);
  wheel.castShadow = true;
  addOutline(wheel, 0.022);
  group.add(wheel);

  // auger that bobs into the ground
  const d = new VoxelBuilder();
  d.box(0, 0, 0, 0.22, 2.6, 0.22, COL.metal);
  for (let i = 0; i < 9; i++) {
    const a = i * 0.9;
    d.box(Math.cos(a) * 0.3, -1.1 + i * 0.28, Math.sin(a) * 0.3, 0.34, 0.14, 0.34, 0xb9c6d4,
      { tint: 0.9 + (i % 3) * 0.06 });
  }
  d.box(0, -1.45, 0, 0.26, 0.42, 0.26, 0x7d8b99);
  const auger = new THREE.Mesh(d.build(), toonMaterial({ vertexColors: true }));
  auger.position.y = 1.9;
  auger.castShadow = true;
  addOutline(auger, 0.02);
  group.add(auger);

  return { group, wheel, auger };
}

function makeBanner(x, z, yaw, height) {
  const y = groundAt(x, z);
  const b = new VoxelBuilder({ plant: true });
  // pivot in world space so this banner shares the meadow's gust phase
  b.setPlant(x, y, z, height, 0);
  b.setSwayFixed(0);
  b.box(0, height / 2, 0, 0.14, height, 0.14, COL.wood);
  // cloth: the further from the pole, the more it whips
  const cells = 8;
  for (let i = 0; i < cells; i++) {
    const t = (i + 0.5) / cells;
    b.setSwayFixed(Math.pow(t, 0.8));
    for (let j = 0; j < 3; j++) {
      const col = j === 1 ? COL.canvasRed : COL.canvas;
      b.box(0.22 + t * 1.6, height - 0.35 - j * 0.42, 0, 1.62 / cells, 0.42, 0.07, col,
        { tint: 0.95 + j * 0.04 });
    }
  }
  const geo = b.build();
  const mat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
  applyWind(mat, { mode: 'attribute', push: false, strength: 1.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  const shell = new THREE.Mesh(geo, windOutlineMaterial(0.02, 0x1b2333, {
    mode: 'attribute', push: false, strength: 1.5,
  }));
  mesh.add(shell);
  return mesh;
}

/* ================================================================== *
 *  Scene assembly                                                     *
 * ================================================================== */

export function buildProps(scene) {
  const rnd = mulberry32(20260910);
  const statics = new VoxelBuilder();
  const foliage = new VoxelBuilder({ plant: true });
  const glow = new VoxelBuilder();
  const updaters = [];

  const occupied = [];
  // keep the digger's spawn clearing free of props
  const claim = (x, z, r) => { occupied.push([x, z, r]); };
  const free = (x, z, r) => {
    if (!isLand(x, z)) return false;
    for (const [ox, oz, orr] of occupied) if (Math.hypot(x - ox, z - oz) < r + orr) return false;
    return true;
  };

  claim(3, 6.5, 4.2);      // spawn clearing
  claim(-0.5, 3.0, 3.4);   // and the ground just behind it, which the camera sees

  /* ---- the dig pit ---- */
  const pit = CFG.pit;
  claim(pit.x, pit.z, pit.r + 1.5);
  fossilBeast(statics, rnd, pit.x - 0.6, pit.z + 0.4, 0.42);
  ammonite(statics, rnd, pit.x - 4.6, CFG.pit.floor + 1.6, pit.z - 3.8, 0.9, 1.0);
  ammonite(statics, rnd, pit.x + 3.6, CFG.pit.floor + 1.2, pit.z + 3.9, -1.9, 0.6);
  scaffold(statics, pit.x + 5.0, pit.z - 4.2, -0.6);
  ladder(statics, pit.x + 2.1, groundAt(pit.x + 2.1, pit.z + 5.3), pit.z + 5.3, Math.PI, 3.4);
  ropeFence(statics, rnd, pit.x, pit.z, pit.r + 1.35, 11);
  digTools(statics, rnd, pit.x - 2.6, pit.z + 2.2);
  digTools(statics, rnd, pit.x + 1.9, pit.z - 3.1);
  crate(statics, rnd, pit.x + 3.1, pit.z + 2.4, 0.6);
  crate(statics, rnd, pit.x + 3.7, pit.z + 2.0, 1.4, 0.8);
  // loose bones on the pit floor
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * (pit.r - 1.4);
    const bx = pit.x + Math.cos(a) * r, bz = pit.z + Math.sin(a) * r;
    at(statics, bx, groundAt(bx, bz) + 0.1, bz, rnd() * Math.PI, 1, 0, rnd() * 0.6);
    statics.box(0, 0, 0, 0.3 + rnd() * 0.7, 0.2, 0.2, rnd() < 0.3 ? COL.boneDark : COL.bone);
    statics.setTransform(null);
  }
  const rig = makeDrillRig(pit.x - 5.6, pit.z - 4.2, 0.8);
  scene.add(rig.group);
  claim(pit.x - 5.6, pit.z - 4.2, 2.4);
  updaters.push((dt, t) => {
    rig.wheel.rotation.z -= dt * 1.15;
    rig.auger.rotation.y += dt * 2.6;
    rig.auger.position.y = 1.9 + Math.sin(t * 1.1) * 0.28;
  });
  scene.add(makeBanner(pit.x + 5.0, pit.z - 4.2, -0.6, 4.3));

  /* ---- the camp ---- */
  const camp = CFG.camp;
  claim(camp.x, camp.z, 6.0);
  tent(statics, camp.x - 1.4, camp.z - 0.6, 0.35);
  crate(statics, rnd, camp.x + 1.6, camp.z - 1.6, 0.2);
  crate(statics, rnd, camp.x + 2.1, camp.z - 1.2, 1.1, 0.75);
  barrel(statics, rnd, camp.x + 2.4, camp.z + 0.4, 0.5);
  lantern(statics, glow, camp.x + 2.6, camp.z + 1.6, 0.0);
  lantern(statics, glow, camp.x - 3.4, camp.z + 1.2, 2.4);
  signpost(statics, camp.x + 3.6, camp.z + 3.0, -0.7);
  // bedroll + map table
  at(statics, camp.x + 0.4, groundAt(camp.x + 0.4, camp.z + 2.4), camp.z + 2.4, 0.4, 1);
  statics.box(0, 0.5, 0, 1.5, 0.12, 1.0, COL.plank);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    statics.box(sx * 0.62, 0.25, sz * 0.38, 0.1, 0.5, 0.1, COL.woodDark);
  }
  statics.box(0.1, 0.58, 0, 0.8, 0.05, 0.6, 0xf6ecd2);
  statics.box(0.3, 0.61, 0.1, 0.3, 0.03, 0.2, 0xb4653f);
  statics.setTransform(null);

  const fire = makeCampfire(camp.x + 0.9, camp.z + 0.4);
  scene.add(fire.group);
  claim(camp.x + 0.9, camp.z + 0.4, 1.6);
  // log seats around the fire
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const lx = camp.x + 0.9 + Math.cos(a) * 2.0, lz = camp.z + 0.4 + Math.sin(a) * 2.0;
    at(statics, lx, groundAt(lx, lz) + 0.25, lz, a + Math.PI / 2, 1);
    statics.box(0, 0, 0, 1.5, 0.46, 0.46, COL.wood, { tint: 0.94 + rnd() * 0.12 });
    statics.setTransform(null);
  }

  /* ---- ancient ruins ---- */
  const ob = CFG.obelisk;
  claim(ob.x, ob.z, 4.6);
  obelisk(statics, glow, ob.x, ob.z);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const px = ob.x + Math.cos(a) * 4.2, pz = ob.z + Math.sin(a) * 4.2;
    if (!isLand(px, pz)) continue;
    brokenPillar(statics, rnd, px, pz, 0.8 + rnd() * 2.4);
    claim(px, pz, 1.2);
  }
  // orbiting rune stones
  const runes = new THREE.Group();
  runes.position.set(ob.x, groundAt(ob.x, ob.z), ob.z);
  const runeMeshes = [];
  for (let i = 0; i < 4; i++) {
    const rb = new VoxelBuilder();
    rb.box(0, 0, 0, 0.5, 0.7, 0.16, COL.stoneLight);
    rb.box(0, 0.12, 0.09, 0.22, 0.22, 0.04, COL.rune);
    rb.box(0, -0.16, 0.09, 0.3, 0.06, 0.04, COL.rune);
    const mesh = new THREE.Mesh(rb.build(), toonMaterial({ vertexColors: true }));
    addOutline(mesh, 0.016);
    mesh.userData.phase = (i / 4) * Math.PI * 2;
    mesh.userData.radius = 2.1 + (i % 2) * 0.7;
    mesh.userData.height = 3.6 + i * 0.55;
    runes.add(mesh);
    runeMeshes.push(mesh);
  }
  scene.add(runes);
  updaters.push((dt, t) => {
    for (const m of runeMeshes) {
      const a = t * 0.45 + m.userData.phase;
      m.position.set(Math.cos(a) * m.userData.radius,
        m.userData.height + Math.sin(t * 1.3 + m.userData.phase) * 0.28,
        Math.sin(a) * m.userData.radius);
      m.rotation.y = -a + Math.PI / 2;
      m.rotation.z = Math.sin(t * 0.9 + m.userData.phase) * 0.15;
    }
  });

  /* ---- pond dressing ---- */
  const pond = CFG.pond;
  claim(pond.x, pond.z, pond.r + 2.6);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * (pond.r - 1.0);
    lilyPad(statics, rnd, pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r, pond.water);
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = pond.r + 0.3 + rnd() * 1.5;
    const cx = pond.x + Math.cos(a) * r, cz = pond.z + Math.sin(a) * r;
    if (!isLand(cx, cz)) continue;
    cattail(foliage, rnd, cx, cz);
  }
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, r = pond.r + 1.0 + rnd() * 2.2;
    const cx = pond.x + Math.cos(a) * r, cz = pond.z + Math.sin(a) * r;
    if (free(cx, cz, 1.0)) { rock(statics, rnd, cx, cz, 0.7 + rnd() * 0.6); claim(cx, cz, 1.0); }
  }

  /* ---- landmark bone arch in the meadow ---- */
  boneArch(statics, rnd, -1.5, -8.5, 0.5);
  claim(-1.5, -8.5, 3.6);

  /* ---- scattered nature ---- */
  const R = CFG.rim;
  for (let i = 0; i < 26; i++) {
    let placed = false;
    for (let k = 0; k < 30 && !placed; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 6 + Math.sqrt(rnd()) * (R - 6.5);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!free(x, z, 2.6) || surfaceAt(x, z) !== 'grass' || slopeAt(x, z) > 0.5) continue;
      tree(foliage, rnd, x, z, 0.8 + rnd() * 0.55);
      claim(x, z, 2.6);
      placed = true;
    }
  }
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = 3 + Math.sqrt(rnd()) * (R - 3.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 1.1) || surfaceAt(x, z) === 'dig') continue;
    bush(foliage, rnd, x, z, 0.7 + rnd() * 0.7);
    claim(x, z, 1.1);
  }
  for (let i = 0; i < 34; i++) {
    const a = rnd() * Math.PI * 2, r = 3 + Math.sqrt(rnd()) * (R - 2.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 1.0)) continue;
    rock(statics, rnd, x, z, 0.55 + rnd() * 0.9);
    claim(x, z, 1.0);
  }
  for (let i = 0; i < 30; i++) {
    const a = rnd() * Math.PI * 2, r = 4 + Math.sqrt(rnd()) * (R - 4.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 0.9) || surfaceAt(x, z) !== 'grass') continue;
    fern(foliage, rnd, x, z);
    claim(x, z, 0.7);
  }
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2, r = 8 + Math.sqrt(rnd()) * (R - 9);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 1.2)) continue;
    mushroomPatch(glow, rnd, x, z);
    claim(x, z, 1.2);
  }
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, r = 7 + Math.sqrt(rnd()) * (R - 7.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 1.3)) continue;
    crystalCluster(glow, rnd, x, z, 0.7 + rnd() * 0.8);
    claim(x, z, 1.3);
  }
  // half-buried bones hinting the whole island is one giant fossil bed
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = 5 + Math.sqrt(rnd()) * (R - 5.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 1.4) || surfaceAt(x, z) === 'dig') continue;
    at(statics, x, groundAt(x, z) - 0.1, z, rnd() * Math.PI * 2, 1, 0, 0.25 + rnd() * 0.5);
    const L = 0.9 + rnd() * 1.6;
    statics.box(0, 0.2, 0, L, 0.34, 0.34, COL.bone, { tint: 0.94 + rnd() * 0.1 });
    statics.box(L / 2, 0.24, 0, 0.42, 0.5, 0.5, COL.boneDark);
    statics.setTransform(null);
    claim(x, z, 1.0);
  }

  /* ---- commit the batches ---- */
  const staticGeo = statics.build();
  const staticMesh = new THREE.Mesh(staticGeo, toonMaterial({ vertexColors: true }));
  staticMesh.name = 'props-static';
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  staticMesh.add(new THREE.Mesh(staticGeo, outlineMaterial(0.024)));
  scene.add(staticMesh);

  const folGeo = foliage.build();
  const folMat = toonMaterial({ vertexColors: true });
  applyWind(folMat, { mode: 'attribute', push: true, strength: 0.55 });
  const folMesh = new THREE.Mesh(folGeo, folMat);
  folMesh.name = 'props-foliage';
  folMesh.castShadow = true;
  folMesh.receiveShadow = true;
  folMesh.add(new THREE.Mesh(folGeo, windOutlineMaterial(0.028, 0x1b2333, {
    mode: 'attribute', push: true, strength: 0.55,
  })));
  scene.add(folMesh);

  const glowGeo = glow.build();
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.name = 'props-glow';
  scene.add(glowMesh);
  glowMesh.add(new THREE.Mesh(glowGeo, outlineMaterial(0.018, 0x2a4a60)));

  updaters.push((dt, t) => {
    const pulse = 0.82 + Math.sin(t * 1.6) * 0.1 + Math.sin(t * 3.1) * 0.06;
    glowMat.color.setScalar(pulse);
  });

  // campfire flicker
  updaters.push((dt, t) => {
    const f = 0.86 + Math.sin(t * 13.0) * 0.08 + Math.sin(t * 7.3) * 0.06;
    fire.flame.scale.set(f, 1.0 + Math.sin(t * 9.1) * 0.16, f);
    fire.flame.rotation.y = Math.sin(t * 2.2) * 0.25;
    fire.light.intensity = 12 + Math.sin(t * 11.0) * 3.5 + Math.sin(t * 5.1) * 2.0;
    fire.light.position.set(0, 1.0 + Math.sin(t * 6.0) * 0.08, 0);
  });

  return {
    update(dt, t) { for (const u of updaters) u(dt, t); },
    firePos: new THREE.Vector3(camp.x + 0.9, fire.y + 0.9, camp.z + 0.4),
  };
}
