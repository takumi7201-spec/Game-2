// The floating dig-site island: procedural voxel heightfield, strata and underside.
import * as THREE from '../../vendor/three/three.module.js';
import { fbm2, lerp, smoothstep, clamp, mulberry32 } from '../lib/math.js';
import { VoxelBuilder, toonMaterial, outlineMaterial } from '../lib/voxel.js';

export const CFG = {
  rim: 23,            // island radius (wobbled per angle)
  play: 16,           // the player may only roam this far
  step: 0.5,          // voxel height quantisation
  pond: { x: -12, z: -10, r: 3.9, floor: -2.7, water: -0.85 },
  pit: { x: 7, z: -3, r: 6.3, floor: -2.1 },
  ridge: { ax: -20.5, az: -16.5, bx: -5, bz: -19.5, r: 6.6, h: 5.6 },
  camp: { x: -4.5, z: 5.5 },
  obelisk: { x: 13.5, z: 8.5 },
};

const C = {
  grass: [0x77c14b, 0x6ab642, 0x86cc57, 0x5da53c],
  dirt: [0x8a5a38, 0x7d5132, 0x94643e],
  clay: 0xa8714a,
  rock: [0x8794a3, 0x77838f, 0x99a6b3],
  sand: 0xdcc68d,
};

export function rimAt(x, z) {
  const a = Math.atan2(z, x);
  return CFG.rim
    + Math.sin(a * 3.0) * 1.7
    + Math.sin(a * 5.0 + 1.3) * 1.1
    + Math.sin(a * 8.0 - 0.7) * 0.6
    + fbm2(x * 0.07, z * 0.07, 2) * 1.2;
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return Math.hypot(dx, dz);
}

/** Continuous terrain height (pre-quantisation). */
export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  let h = fbm2(x * 0.055 + 3.1, z * 0.055 - 7.2, 4) * 2.4
        + fbm2(x * 0.15 - 2.0, z * 0.15 + 5.0, 2) * 0.55;
  // Keep the middle of the meadow walkable and calm.
  h *= lerp(0.45, 1.0, smoothstep(3, 15, d));

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
  h = lerp(h, heightAtRaw(CFG.camp.x, CFG.camp.z), smoothstep(4.2, 1.6, dc));
  return h;
}

function heightAtRaw(x, z) {
  const d = Math.hypot(x, z);
  let h = fbm2(x * 0.055 + 3.1, z * 0.055 - 7.2, 4) * 2.4
        + fbm2(x * 0.15 - 2.0, z * 0.15 + 5.0, 2) * 0.55;
  h *= lerp(0.45, 1.0, smoothstep(3, 15, d));
  return h;
}

export const quantize = (h) => Math.round(h / CFG.step) * CFG.step;
/** Top surface the character walks on. */
export const groundAt = (x, z) => quantize(heightAt(x, z));
export const isLand = (x, z) => Math.hypot(x, z) < rimAt(x, z);

export function slopeAt(x, z) {
  const e = 0.9;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

const _pondD = (x, z) => Math.hypot(x - CFG.pond.x, z - CFG.pond.z);
export const inWater = (x, z) => _pondD(x, z) < CFG.pond.r - 0.2 && heightAt(x, z) < CFG.pond.water;

/** Surface classification used both for colouring and for scattering props. */
export function surfaceAt(x, z) {
  const h = heightAt(x, z);
  const s = slopeAt(x, z);
  const dPond = _pondD(x, z);
  const dPit = Math.hypot(x - CFG.pit.x, z - CFG.pit.z);
  if (dPond < CFG.pond.r + 1.5 && h < CFG.pond.water + 0.65) return 'sand';
  if (dPit < CFG.pit.r - 0.6) return 'dig';
  if (s > 0.72) return 'rock';
  if (h > 4.4) return 'rock';
  const dCamp = Math.hypot(x - CFG.camp.x, z - CFG.camp.z);
  if (dCamp < 2.6) return 'path';
  return 'grass';
}

/* ------------------------------------------------------------------ *
 *  Mesh construction                                                  *
 * ------------------------------------------------------------------ */

export function buildIsland(scene) {
  const rnd = mulberry32(90210);
  const cells = [];
  const R = CFG.rim + 2.5;
  for (let x = -R; x <= R; x += 1) {
    for (let z = -R; z <= R; z += 1) {
      const cx = x + 0.5, cz = z + 0.5;
      if (!isLand(cx, cz)) continue;
      cells.push([cx, cz, quantize(heightAt(cx, cz)), surfaceAt(cx, cz)]);
    }
  }

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

  scene.add(buildUnderside());
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

/** Chunky inverted cone hanging beneath the island, with roots and crystals. */
function buildUnderside() {
  const b = new VoxelBuilder();
  const rnd = mulberry32(4242);
  const topY = -4.0;
  const depth = 20;
  const stepY = 1.6;
  for (let y = topY; y > topY - depth; y -= stepY) {
    const t = (topY - y) / depth;                       // 0 at top -> 1 at tip
    const rOut = CFG.rim * Math.pow(1 - t, 0.62) + 0.5;
    const rIn = Math.max(0, rOut - 4.0);
    const cell = 1.6;
    for (let x = -rOut - cell; x <= rOut + cell; x += cell) {
      for (let z = -rOut - cell; z <= rOut + cell; z += cell) {
        const cx = x + cell / 2, cz = z + cell / 2;
        const d = Math.hypot(cx, cz);
        const wob = fbm2(cx * 0.12, cz * 0.12, 2) * 1.6;
        if (d > rOut + wob || d < rIn + wob) continue;
        const shade = [0x6f7c8a, 0x7d6a55, 0x5f6b79, 0x8a7561][
          Math.abs(Math.round(fbm2(cx * 0.3, cz * 0.3 + y, 1) * 3 + y)) % 4];
        b.box(cx, y - stepY / 2, cz, cell, stepY, cell, shade, { tint: 0.92 + rnd() * 0.16 });
      }
    }
  }
  // hanging roots + glowing crystal veins
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = CFG.rim * (0.35 + rnd() * 0.6);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const t = 1 - rr / CFG.rim;
    const yTop = topY - t * 6 - rnd() * 3;
    const len = 1.5 + rnd() * 5;
    const w = 0.18 + rnd() * 0.2;
    const crystal = rnd() < 0.22;
    const colr = crystal ? 0x63e8ff : (rnd() < 0.5 ? 0x6b4a2f : 0x7a5a38);
    let yy = yTop;
    let cx = x, cz = z;
    const segs = Math.max(2, Math.round(len / 0.8));
    for (let s = 0; s < segs; s++) {
      b.box(cx, yy - 0.4, cz, w, 0.8, w, colr, { tint: 1 - s * 0.03 });
      yy -= 0.75;
      cx += (rnd() - 0.5) * 0.25;
      cz += (rnd() - 0.5) * 0.25;
    }
  }
  const geo = b.build();
  const mesh = new THREE.Mesh(geo, toonMaterial({ vertexColors: true }));
  mesh.name = 'island-underside';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const shell = new THREE.Mesh(geo, outlineMaterial(0.05));
  mesh.add(shell);
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  Movement bounds                                                    *
 * ------------------------------------------------------------------ */

/** Clamp a desired destination into the walkable meadow. */
export function clampToWalkable(x, z, out) {
  let px = x, pz = z;
  const d = Math.hypot(px, pz);
  if (d > CFG.play) {
    px = (px / d) * CFG.play;
    pz = (pz / d) * CFG.play;
  }
  // push out of the pond
  const p = CFG.pond;
  const dx = px - p.x, dz = pz - p.z;
  const dp = Math.hypot(dx, dz);
  const shore = p.r + 0.35;
  if (dp < shore) {
    const k = dp < 1e-4 ? 1 : shore / dp;
    px = p.x + dx * k;
    pz = p.z + dz * k;
  }
  out.set(px, groundAt(px, pz), pz);
  return out;
}

export const isWalkable = (x, z) =>
  Math.hypot(x, z) <= CFG.play + 0.01 && _pondD(x, z) >= CFG.pond.r + 0.3;
