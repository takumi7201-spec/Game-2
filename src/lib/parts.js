// Shared building blocks for hand-placed props: local frames and bone/beam rods.
import * as THREE from '../../vendor/three/three.module.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Point the builder at a local frame (position + yaw/pitch/roll + scale). */
export function at(b, x, y, z, yaw = 0, scale = 1, pitch = 0, roll = 0) {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.setScalar(scale);
  _m.compose(_v, _q, _s);
  return b.setTransform(_m);
}

/** A standalone copy of a local frame, so nested parts can compose onto it. */
export function frame(x, y, z, yaw = 0, scale = 1) {
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
export function rod(b, base, a, c, w, color, opts = {}, pad = 0.04, depth = 0) {
  _rd.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = _rd.length();
  if (len < 1e-5) return;
  _rd.divideScalar(len);
  _rq.setFromUnitVectors(_UP, _rd);
  _rc.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  _rm.compose(_rc, _rq, _r1);
  _rm.premultiply(base);
  b.setTransform(_rm);
  b.box(0, 0, 0, w, len + pad, depth || w, color, opts);
}

export const COL = {
  bone: 0xf3ead2, boneDark: 0xded1b0, boneWarm: 0xfdf7e4,
  wood: 0x8a5a34, woodDark: 0x6d452a, plank: 0xa9743f,
  stone: 0x8e9aa8, stoneDark: 0x6f7c8b, stoneLight: 0xb3bfcb,
  canvas: 0xf2e3c2, canvasRed: 0xd4614f,
  metal: 0x9fb0c2, rope: 0xc7a86b,
  leaf: [0x4fa83c, 0x63bd48, 0x3f8f32, 0x76c95a],
  leafWarm: [0x8fc44a, 0xb8cf4d],
  amber: 0xffb347, crystal: 0x6fe6ff, rune: 0x9ad9ff,
};

