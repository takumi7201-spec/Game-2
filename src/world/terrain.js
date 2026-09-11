// The floating lands: the dig-site island, the town island, and the causeway
// that joins them. Procedural voxel heightfield, strata and undersides.
import * as THREE from '../../vendor/three/three.module.js';
import { fbm2, lerp, smoothstep, clamp, mulberry32 } from '../lib/math.js';
import { VoxelBuilder, toonMaterial, outlineMaterial } from '../lib/voxel.js';

export const CFG = {
  rim: 23,            // dig island radius (wobbled per angle)
  play: 16,           // how far the digger may roam from the island's middle
  step: 0.5,          // voxel height quantisation
  pond: { x: -12, z: -10, r: 3.9, floor: -2.7, water: -0.85 },
  pit: { x: 7, z: -3, r: 6.3, floor: -2.1 },
  ridge: { ax: -20.5, az: -16.5, bx: -5, bz: -19.5, r: 6.6, h: 5.6 },
  camp: { x: -4.5, z: 5.5 },
  obelisk: { x: 13.5, z: 8.5 },

  // The digger's home town, on its own island to the east. Layout positions
  // below are local to the town's middle.
  town: {
    x: 52, z: -4, r: 19, play: 15, ground: 1.6,
    plaza: [0, 0], plazaR: 4.6,
    dome: [0.5, -8.6], domeR: 5.2,      // cleaning lab and revival chamber
    arena: [3.0, 8.6], arenaR: 6.6,     // battle colosseum
    gate: [-14.6, -0.4],
  },

  // One corridor runs from the meadow, out over the void and into town. The
  // middle stretch, where there is no ground under it, is the bridge.
  road: { ax: 13.2, az: -1.4, bx: 38.6, bz: -3.6, w: 3.4, sag: 1.5 },
};

const C = {
  grass: [0x77c14b, 0x6ab642, 0x86cc57, 0x5da53c],
  dirt: [0x8a5a38, 0x7d5132, 0x94643e],
  clay: 0xa8714a,
  rock: [0x8794a3, 0x77838f, 0x99a6b3],
  sand: 0xdcc68d,
  paved: [0xb9b3a6, 0xc6bfb0, 0xaaa599],
};

/* ------------------------------------------------------------------ *
 *  Shapes                                                             *
 * ------------------------------------------------------------------ */

export function rimAt(x, z) {
  const a = Math.atan2(z, x);
  return CFG.rim
    + Math.sin(a * 3.0) * 1.7
    + Math.sin(a * 5.0 + 1.3) * 1.1
    + Math.sin(a * 8.0 - 0.7) * 0.6
    + fbm2(x * 0.07, z * 0.07, 2) * 1.2;
}

export function townRimAt(x, z) {
  const t = CFG.town;
  const a = Math.atan2(z - t.z, x - t.x);
  return t.r
    + Math.sin(a * 3.0 + 0.8) * 1.3
    + Math.sin(a * 5.0 - 0.4) * 0.9
    + fbm2(x * 0.08, z * 0.08, 2) * 0.9;
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return Math.hypot(dx, dz);
}

/** Where a point falls along the road corridor: t in [0,1] plus side offset. */
export function roadAt(x, z, out = {}) {
  const r = CFG.road;
  const vx = r.bx - r.ax, vz = r.bz - r.az;
  const len2 = vx * vx + vz * vz;
  const tRaw = ((x - r.ax) * vx + (z - r.az) * vz) / len2;
  const t = clamp(tRaw, 0, 1);
  out.t = t;
  out.tRaw = tRaw;
  out.perp = Math.hypot(x - (r.ax + vx * t), z - (r.az + vz * t));
  return out;
}

export const roadPoint = (t, out = {}) => {
  const r = CFG.road;
  out.x = lerp(r.ax, r.bx, t);
  out.z = lerp(r.az, r.bz, t);
  return out;
};

/* ------------------------------------------------------------------ *
 *  Height                                                             *
 * ------------------------------------------------------------------ */

function digHeightRaw(x, z) {
  const d = Math.hypot(x, z);
  let h = fbm2(x * 0.055 + 3.1, z * 0.055 - 7.2, 4) * 2.4
        + fbm2(x * 0.15 - 2.0, z * 0.15 + 5.0, 2) * 0.55;
  h *= lerp(0.45, 1.0, smoothstep(3, 15, d));
  return h;
}

function digHeight(x, z) {
  let h = digHeightRaw(x, z);

  const r = CFG.ridge;
  h += r.h * smoothstep(r.r, r.r * 0.42, distToSeg(x, z, r.ax, r.az, r.bx, r.bz));

  const p = CFG.pond;
  const dp = Math.hypot(x - p.x, z - p.z);
  h = lerp(h, p.floor, smoothstep(p.r + 1.4, p.r - 1.6, dp));

  const q = CFG.pit;
  const dq = Math.hypot(x - q.x, z - q.z);
  // a small mound in the middle of the pit where the big fossil sits
  const mound = Math.max(0, 1.25 - dq * 0.2);
  h = lerp(h, q.floor + mound, smoothstep(q.r, q.r - 1.8, dq));

  // Overflow channel: carve a groove from the pond out to the island rim so the
  // water has somewhere to go before it spills into the void.
  const ca = Math.atan2(p.z, p.x);
  const cdx = Math.cos(ca), cdz = Math.sin(ca);
  const tAxis = (x - p.x) * cdx + (z - p.z) * cdz;
  const tPerp = Math.abs(-(x - p.x) * cdz + (z - p.z) * cdx);
  if (tAxis > p.r - 1.0 && tAxis < 12) {
    const u = smoothstep(p.r - 1.0, p.r + 1.2, tAxis);
    const floorY = lerp(p.water - 0.15, p.water - 1.6, smoothstep(p.r, 10.5, tAxis));
    const k = u * (1 - smoothstep(0.55, 1.55, tPerp));
    if (k > 0) h = lerp(h, Math.min(h, floorY), k);
  }

  // Flatten the camp terrace.
  const dc = Math.hypot(x - CFG.camp.x, z - CFG.camp.z);
  h = lerp(h, digHeightRaw(CFG.camp.x, CFG.camp.z), smoothstep(4.2, 1.6, dc));

  // Level the road out to the bridge head so the causeway lies flat.
  const rd = roadAt(x, z, _road);
  if (rd.tRaw < 0.55 && rd.perp < CFG.road.w) {
    const flat = 1.6;
    const k = smoothstep(CFG.road.w, CFG.road.w * 0.45, rd.perp) * smoothstep(-0.25, 0.1, rd.tRaw);
    h = lerp(h, flat, k * 0.85);
  }
  return h;
}

function townHeight(x, z) {
  const t = CFG.town;
  const dx = x - t.x, dz = z - t.z;
  const d = Math.hypot(dx, dz);
  let h = t.ground + fbm2(dx * 0.1 + 12, dz * 0.1 - 4, 3) * 0.75;
  // the built-up middle is terraced flat
  h = lerp(h, t.ground, smoothstep(14, 5, d));
  // and it falls away to the rim
  h -= smoothstep(t.r - 6, t.r + 1.5, d) * 3.2;

  // the colosseum floor is dug down into the plateau
  const da = Math.hypot(x - t.x - t.arena[0], z - t.z - t.arena[1]);
  h = lerp(h, t.ground - 1.6, smoothstep(t.arenaR - 1.0, t.arenaR - 3.6, da));

  // a level stone landing carries the road out to the bridge head
  const rd = roadAt(x, z, _road);
  if (rd.tRaw > 0.55 && rd.perp < CFG.road.w) {
    const k = smoothstep(CFG.road.w, CFG.road.w * 0.45, rd.perp)
      * smoothstep(0.58, 0.8, rd.tRaw);
    h = lerp(h, t.ground - 0.3, k);
  }
  return h;
}

const _road = {};
const TOWN_REACH = () => CFG.town.r + 5;

/** Continuous land height, ignoring anything built on top of it. */
export function heightAt(x, z) {
  const t = CFG.town;
  if (Math.hypot(x - t.x, z - t.z) < TOWN_REACH()) return townHeight(x, z);
  return digHeight(x, z);
}

export const quantize = (h) => Math.round(h / CFG.step) * CFG.step;

export const isLand = (x, z) => {
  if (Math.hypot(x - CFG.town.x, z - CFG.town.z) < TOWN_REACH()) {
    return Math.hypot(x - CFG.town.x, z - CFG.town.z) < townRimAt(x, z);
  }
  return Math.hypot(x, z) < rimAt(x, z);
};

/* ------------------------------------------------------------------ *
 *  The bridge span                                                    *
 * ------------------------------------------------------------------ */

// The corridor crosses open sky between the two rims; that stretch is decked.
let _span = null;
export function bridgeSpan() {
  if (_span) return _span;
  const p = {};
  let t0 = 0, t1 = 1;
  for (let t = 0; t <= 1.0001; t += 0.004) {     // walk out until the ground ends
    roadPoint(t, p);
    if (!isLand(p.x, p.z)) break;
    t0 = t;
  }
  for (let t = 1; t >= -0.0001; t -= 0.004) {    // and back from the far side
    roadPoint(t, p);
    if (!isLand(p.x, p.z)) break;
    t1 = t;
  }
  roadPoint(t0, p);
  const y0 = quantize(heightAt(p.x, p.z));
  roadPoint(t1, p);
  const y1 = quantize(heightAt(p.x, p.z));
  _span = { t0, t1, y0, y1, ax: 0, az: 0 };
  roadPoint(t0, p); _span.ax = p.x; _span.az = p.z;
  roadPoint(t1, p); _span.bx = p.x; _span.bz = p.z;
  return _span;
}

/** Deck height at a point over the span, or null when it is not on the deck. */
export function deckAt(x, z) {
  const rd = roadAt(x, z, _road);
  const tRaw = rd.tRaw, perp = rd.perp;     // copy: bridgeSpan() reuses _road
  if (perp > CFG.road.w * 0.5) return null;
  const s = bridgeSpan();
  if (tRaw <= s.t0 || tRaw >= s.t1) return null;
  const u = (tRaw - s.t0) / (s.t1 - s.t0);
  return lerp(s.y0, s.y1, u) - Math.sin(u * Math.PI) * CFG.road.sag;
}

/** Top surface the character stands on, bridge deck included. */
export function groundAt(x, z) {
  const deck = deckAt(x, z);
  return deck !== null ? deck : quantize(heightAt(x, z));
}

export function slopeAt(x, z) {
  const e = 0.9;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

const _pondD = (x, z) => Math.hypot(x - CFG.pond.x, z - CFG.pond.z);
export const inWater = (x, z) => _pondD(x, z) < CFG.pond.r - 0.2 && heightAt(x, z) < CFG.pond.water;

/* ------------------------------------------------------------------ *
 *  Surface classification                                             *
 * ------------------------------------------------------------------ */

function townSurface(x, z) {
  const t = CFG.town;
  const lx = x - t.x, lz = z - t.z;
  const d = Math.hypot(lx, lz);
  if (d > t.r - 1.6 || slopeAt(x, z) > 0.7) return 'rock';
  if (Math.hypot(lx - t.plaza[0], lz - t.plaza[1]) < t.plazaR) return 'paved';
  if (Math.hypot(lx - t.dome[0], lz - t.dome[1]) < t.domeR + 1.2) return 'paved';
  const da = Math.hypot(lx - t.arena[0], lz - t.arena[1]);
  if (da < t.arenaR - 3.4) return 'sand';
  if (da < t.arenaR + 1.0) return 'paved';
  // the main street, gate to plaza
  if (distToSeg(lx, lz, t.gate[0], t.gate[1], t.plaza[0], t.plaza[1]) < 2.1) return 'paved';
  return 'grass';
}

/** Surface classification used both for colouring and for scattering props. */
export function surfaceAt(x, z) {
  if (Math.hypot(x - CFG.town.x, z - CFG.town.z) < TOWN_REACH()) return townSurface(x, z);

  const h = heightAt(x, z);
  const s = slopeAt(x, z);
  const dPond = _pondD(x, z);
  const dPit = Math.hypot(x - CFG.pit.x, z - CFG.pit.z);
  if (dPond < CFG.pond.r + 1.5 && h < CFG.pond.water + 0.65) return 'sand';
  if (dPit < CFG.pit.r - 0.6) return 'dig';
  if (s > 0.72) return 'rock';
  if (h > 4.4) return 'rock';
  const rd = roadAt(x, z, _road);
  if (rd.tRaw > -0.1 && rd.tRaw < 0.6 && rd.perp < CFG.road.w * 0.55) return 'path';
  const dCamp = Math.hypot(x - CFG.camp.x, z - CFG.camp.z);
  if (dCamp < 2.6) return 'path';
  return 'grass';
}

/* ------------------------------------------------------------------ *
 *  Where the digger may walk                                          *
 * ------------------------------------------------------------------ */

export function onRoad(x, z) {
  const rd = roadAt(x, z, _road);
  return rd.tRaw > -0.02 && rd.tRaw < 1.02 && rd.perp < CFG.road.w * 0.5 - 0.25;
}

const inDig = (x, z) => Math.hypot(x, z) <= CFG.play + 0.01;
const inTown = (x, z) => Math.hypot(x - CFG.town.x, z - CFG.town.z) <= CFG.town.play + 0.01;

export function regionOf(x, z) {
  if (inDig(x, z)) return 'dig';
  if (inTown(x, z)) return 'town';
  if (onRoad(x, z)) return 'road';
  return null;
}

export const isWalkable = (x, z) => {
  if (_pondD(x, z) < CFG.pond.r + 0.3) return false;
  return regionOf(x, z) !== null;
};

const _v2 = { x: 0, z: 0 };

/** Nudge a desired destination onto the nearest patch of walkable ground. */
export function clampToWalkable(x, z, out) {
  let best = null;
  const consider = (px, pz) => {
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (!best || d < best.d) best = { x: px, z: pz, d };
  };
  if (isWalkable(x, z)) {
    best = { x, z, d: 0 };
  } else {
    // nearest point of each region
    const dd = Math.hypot(x, z);
    consider((x / (dd || 1)) * CFG.play, (z / (dd || 1)) * CFG.play);
    const tx = x - CFG.town.x, tz = z - CFG.town.z;
    const dt = Math.hypot(tx, tz) || 1;
    consider(CFG.town.x + (tx / dt) * CFG.town.play, CFG.town.z + (tz / dt) * CFG.town.play);
    const rd = roadAt(x, z, _road);
    roadPoint(rd.t, _v2);
    consider(_v2.x, _v2.z);
  }
  // never stand in the pond
  const p = CFG.pond;
  const dx = best.x - p.x, dz = best.z - p.z;
  const dp = Math.hypot(dx, dz);
  if (dp < p.r + 0.35) {
    const k = dp < 1e-4 ? 1 : (p.r + 0.35) / dp;
    best = { x: p.x + dx * k, z: p.z + dz * k };
  }
  out.set(best.x, groundAt(best.x, best.z), best.z);
  return out;
}

/**
 * Waypoints from one place to another. Movement is a straight walk, so crossing
 * between the islands has to be threaded through the two ends of the causeway.
 */
export function routeTo(fromX, fromZ, toX, toZ) {
  const a = regionOf(fromX, fromZ);
  const b = regionOf(toX, toZ);
  const head = roadPoint(0.04, {});
  const tail = roadPoint(0.96, {});
  const via = [];
  if (a === b || a === null || b === null) {
    // nothing to thread
  } else if (a === 'dig' && b === 'town') {
    via.push([head.x, head.z], [tail.x, tail.z]);
  } else if (a === 'town' && b === 'dig') {
    via.push([tail.x, tail.z], [head.x, head.z]);
  } else if (b === 'road') {
    via.push(a === 'dig' ? [head.x, head.z] : [tail.x, tail.z]);
  } else if (a === 'road') {
    via.push(b === 'dig' ? [head.x, head.z] : [tail.x, tail.z]);
  }
  via.push([toX, toZ]);
  return via;
}

/* ------------------------------------------------------------------ *
 *  Mesh construction                                                  *
 * ------------------------------------------------------------------ */

export function buildIsland(scene) {
  const rnd = mulberry32(90210);
  const cells = [];
  const push = (x0, z0, x1, z1) => {
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const cx = x + 0.5, cz = z + 0.5;
        if (!isLand(cx, cz)) continue;
        cells.push([cx, cz, quantize(heightAt(cx, cz)), surfaceAt(cx, cz)]);
      }
    }
  };
  const R = CFG.rim + 2.5;
  push(-R, -R, R, R);
  const t = CFG.town;
  push(t.x - t.r - 2.5, t.z - t.r - 2.5, t.x + t.r + 2.5, t.z + t.r + 2.5);

  const layers = [
    { name: 'top', height: 0.55 },
    { name: 'sub', height: 1.55 },
    { name: 'deep', height: 2.6 },
  ];
  const meshes = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.setAttribute('aExpand', new THREE.Float32BufferAttribute(
    box.getAttribute('normal').array.slice(), 3));

  const col = new THREE.Color();
  const m4 = new THREE.Matrix4();

  layers.forEach((layer, li) => {
    const mat = toonMaterial({ });
    const inst = new THREE.InstancedMesh(box, mat, cells.length);
    inst.castShadow = li === 0;
    inst.receiveShadow = true;
    inst.name = `terrain-${layer.name}`;
    let yOff = 0;
    for (let i = 0; i < li; i++) yOff += layers[i].height;

    for (let i = 0; i < cells.length; i++) {
      const [cx, cz, top, kind] = cells[i];
      const cy = top - yOff - layer.height / 2;
      m4.makeScale(1.0, layer.height, 1.0);
      m4.setPosition(cx, cy, cz);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, tint(col, layer.name, kind, cx, cz, top, rnd));
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    meshes.push(inst);
  });

  scene.add(buildUnderside(0, 0, CFG.rim, 20, 4242));
  scene.add(buildUnderside(t.x, t.z, t.r, 15, 909, t.ground - 2.6));
  return meshes;
}

function tint(col, layer, kind, x, z, top, rnd) {
  const n = fbm2(x * 0.32, z * 0.32, 2);
  if (layer === 'top') {
    switch (kind) {
      case 'sand': return col.set(C.sand).offsetHSL(0, 0, n * 0.04);
      case 'rock': return col.set(C.rock[(Math.abs(Math.round(n * 3)) % 3)]).offsetHSL(0, 0, n * 0.03);
      case 'dig': return col.set(C.clay).offsetHSL(0.01 * n, 0.02, n * 0.05);
      case 'path': return col.set(C.dirt[1]).offsetHSL(0, 0, n * 0.04);
      case 'paved': return col.set(C.paved[Math.abs(Math.round(n * 2 + x + z)) % 3])
        .offsetHSL(0, 0, n * 0.03);
      default: {
        const g = C.grass[Math.abs(Math.round(n * 2 + top * 0.7)) % C.grass.length];
        return col.set(g).offsetHSL(n * 0.012, 0.03 * n, n * 0.05);
      }
    }
  }
  if (layer === 'sub') {
    if (kind === 'rock') return col.set(C.rock[1]).offsetHSL(0, 0, n * 0.03);
    return col.set(C.dirt[Math.abs(Math.round(n * 2)) % C.dirt.length]).offsetHSL(0, 0, n * 0.035);
  }
  // deep strata band, slightly banded by height for a layered-rock read
  const band = Math.abs(Math.round(top * 1.3 + n * 1.5)) % 3;
  return col.set([0x7c8794, 0x8d7a63, 0x6d7885][band]).offsetHSL(0, 0, n * 0.03);
}

/** Chunky inverted cone hanging beneath an island, with roots and crystals. */
function buildUnderside(cx0, cz0, rim, depth, seed, topY = -4.0) {
  const b = new VoxelBuilder();
  const rnd = mulberry32(seed);
  const stepY = 1.6;
  for (let y = topY; y > topY - depth; y -= stepY) {
    const t = (topY - y) / depth;                       // 0 at top -> 1 at tip
    const rOut = rim * Math.pow(1 - t, 0.62) + 0.5;
    const rIn = Math.max(0, rOut - 4.0);
    const cell = 1.6;
    for (let x = -rOut - cell; x <= rOut + cell; x += cell) {
      for (let z = -rOut - cell; z <= rOut + cell; z += cell) {
        const cx = x + cell / 2, cz = z + cell / 2;
        const d = Math.hypot(cx, cz);
        const wob = fbm2((cx + cx0) * 0.12, (cz + cz0) * 0.12, 2) * 1.6;
        if (d > rOut + wob || d < rIn + wob) continue;
        const shade = [0x6f7c8a, 0x7d6a55, 0x5f6b79, 0x8a7561][
          Math.abs(Math.round(fbm2(cx * 0.3, cz * 0.3 + y, 1) * 3 + y)) % 4];
        b.box(cx0 + cx, y - stepY / 2, cz0 + cz, cell, stepY, cell,
          shade, { tint: 0.92 + rnd() * 0.16 });
      }
    }
  }
  // hanging roots + glowing crystal veins
  for (let i = 0; i < Math.round(rim * 2); i++) {
    const a = rnd() * Math.PI * 2;
    const rr = rim * (0.35 + rnd() * 0.6);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const t = 1 - rr / rim;
    const yTop = topY - t * 6 - rnd() * 3;
    const len = 1.5 + rnd() * 5;
    const w = 0.18 + rnd() * 0.2;
    const crystal = rnd() < 0.22;
    const colr = crystal ? 0x63e8ff : (rnd() < 0.5 ? 0x6b4a2f : 0x7a5a38);
    let yy = yTop;
    let cx = x, cz = z;
    const segs = Math.max(2, Math.round(len / 0.8));
    for (let s = 0; s < segs; s++) {
      b.box(cx0 + cx, yy - 0.4, cz0 + cz, w, 0.8, w, colr, { tint: 1 - s * 0.03 });
      yy -= 0.75;
      cx += (rnd() - 0.5) * 0.25;
      cz += (rnd() - 0.5) * 0.25;
    }
  }
  const geo = b.build();
  const mesh = new THREE.Mesh(geo, toonMaterial({ vertexColors: true }));
  mesh.name = 'island-underside';
  mesh.add(new THREE.Mesh(geo, outlineMaterial(0.05)));
  return mesh;
}
