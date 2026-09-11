// Lush instanced meadow: blades, tufts, ferns and flowers, all wind-driven.
import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32, fbm2, lerp } from '../lib/math.js';
import { toonMaterial, VoxelBuilder } from '../lib/voxel.js';
import { applyWind } from '../lib/wind.js';
import { CFG, groundAt, isLand, surfaceAt } from './terrain.js';

/** A tapered, slightly curved blade with baked base-to-tip shading. */
function bladeGeometry(w, h, segs = 3, curve = 0.16) {
  const pos = [], col = [], nrm = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const hw = (w * 0.5) * (1 - t * 0.88);
    const y = h * t;
    const z = curve * t * t;
    const shade = lerp(0.52, 1.0, Math.pow(t, 0.7));
    for (const s of [-1, 1]) {
      pos.push(s * hw, y, z);
      col.push(shade, shade, shade);
      // tilt the normal skyward so blades catch light like the ground does
      nrm.push(s * 0.18, 0.86, 0.48);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function scatter(rnd, count, opts) {
  const pts = [];
  const {
    minR = 0, maxR = CFG.rim, kinds, clump = 0, clumpR = 0.6, jitterY = 0,
    cx = 0, cz = 0,
  } = opts;
  let guard = 0;
  while (pts.length < count && guard < count * 40) {
    guard++;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(lerp((minR / maxR) ** 2, 1, rnd())) * maxR;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!isLand(x, z)) continue;
    const kind = surfaceAt(x, z);
    if (kinds && !kinds.includes(kind)) continue;
    const n = clump > 0 ? 1 + Math.floor(rnd() * clump) : 1;
    for (let i = 0; i < n && pts.length < count; i++) {
      const ox = i === 0 ? 0 : (rnd() - 0.5) * clumpR * 2;
      const oz = i === 0 ? 0 : (rnd() - 0.5) * clumpR * 2;
      const px = x + ox, pz = z + oz;
      if (!isLand(px, pz)) continue;
      pts.push([px, groundAt(px, pz) + jitterY, pz]);
    }
  }
  return pts;
}

function instanced(geo, mat, pts, rnd, cfg) {
  const { scale = [0.8, 1.3], tiltUp = 0.16, colors, colorJitter = 0.1 } = cfg;
  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i];
    e.set((rnd() - 0.5) * tiltUp, rnd() * Math.PI * 2, (rnd() - 0.5) * tiltUp);
    q.setFromEuler(e);
    const sc = lerp(scale[0], scale[1], rnd());
    s.set(sc * lerp(0.85, 1.15, rnd()), sc, sc);
    v.set(x, y, z);
    m4.compose(v, q, s);
    mesh.setMatrixAt(i, m4);
    if (colors) {
      const base = colors[(rnd() * colors.length) | 0];
      const n = fbm2(x * 0.11, z * 0.11, 2);
      col.set(base).offsetHSL(n * 0.03, n * 0.06, (rnd() - 0.5) * colorJitter + n * 0.05);
      mesh.setColorAt(i, col);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function buildMeadow(scene, quality = 1) {
  const rnd = mulberry32(777);
  const layers = [];

  // --- short blades: the bulk of the meadow -------------------------------
  {
    const geo = bladeGeometry(0.13, 0.62, 3, 0.14);
    const mat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
    applyWind(mat, { height: 0.62, push: true });
    const pts = [
      ...scatter(rnd, Math.round(42000 * quality), {
        maxR: CFG.rim, kinds: ['grass', 'path'], clump: 5, clumpR: 0.55, jitterY: -0.04,
      }),
      ...scatter(rnd, Math.round(11000 * quality), {
        cx: CFG.town.x, cz: CFG.town.z, maxR: CFG.town.r,
        kinds: ['grass'], clump: 5, clumpR: 0.55, jitterY: -0.04,
      }),
    ];
    const m = instanced(geo, mat, pts, rnd, {
      scale: [0.7, 1.45],
      colors: [0x6fbe45, 0x63b03d, 0x85cb56, 0x559b38, 0x92c95a],
    });
    m.name = 'grass-short';
    layers.push(m);
  }

  // --- tall tufts ---------------------------------------------------------
  {
    const geo = bladeGeometry(0.19, 0.95, 4, 0.26);
    const mat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
    applyWind(mat, { height: 0.95, push: true });
    const pts = [
      ...scatter(rnd, Math.round(6500 * quality), {
        maxR: CFG.rim, kinds: ['grass'], clump: 6, clumpR: 0.4, jitterY: -0.05,
      }),
      ...scatter(rnd, Math.round(1600 * quality), {
        cx: CFG.town.x, cz: CFG.town.z, maxR: CFG.town.r,
        kinds: ['grass'], clump: 6, clumpR: 0.4, jitterY: -0.05,
      }),
    ];
    const m = instanced(geo, mat, pts, rnd, {
      scale: [0.65, 1.15],
      colors: [0x4f9433, 0x5da53a, 0x6cae42, 0x7fae3f],
    });
    m.name = 'grass-tall';
    layers.push(m);
  }

  // --- flowers: stems + blossoms share the same transforms ----------------
  {
    const stemGeo = bladeGeometry(0.07, 0.66, 2, 0.05);
    const stemMat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
    applyWind(stemMat, { height: 0.66, push: true });

    const b = new VoxelBuilder();
    b.box(0, 0.72, 0, 0.11, 0.11, 0.11, 0xffffff);
    b.box(0.11, 0.72, 0, 0.11, 0.08, 0.11, 0xffffff);
    b.box(-0.11, 0.72, 0, 0.11, 0.08, 0.11, 0xffffff);
    b.box(0, 0.72, 0.11, 0.11, 0.08, 0.11, 0xffffff);
    b.box(0, 0.72, -0.11, 0.11, 0.08, 0.11, 0xffffff);
    b.box(0, 0.77, 0, 0.07, 0.07, 0.07, 0xffe27a);
    const petalGeo = b.build();
    const petalMat = toonMaterial({ vertexColors: true });
    applyWind(petalMat, { height: 0.9, push: true });

    const pts = [
      ...scatter(rnd, Math.round(1500 * quality), {
        maxR: CFG.rim - 1, kinds: ['grass'], clump: 5, clumpR: 0.42, jitterY: -0.03,
      }),
      ...scatter(rnd, Math.round(600 * quality), {
        cx: CFG.town.x, cz: CFG.town.z, maxR: CFG.town.r - 1,
        kinds: ['grass'], clump: 5, clumpR: 0.42, jitterY: -0.03,
      }),
    ];
    const stems = instanced(stemGeo, stemMat, pts, rnd, {
      scale: [0.85, 1.2], colors: [0x4f9433],
    });
    stems.name = 'flower-stems';
    const rnd2 = mulberry32(777);
    const petals = instanced(petalGeo, petalMat, pts, rnd2, {
      scale: [0.85, 1.2], tiltUp: 0.16,
      colors: [0xff8fb1, 0xfff1a8, 0xa9d8ff, 0xffffff, 0xd6a6ff, 0xffb36b],
      colorJitter: 0.06,
    });
    petals.name = 'flowers';
    layers.push(stems, petals);
  }

  // --- clover / low leafy ground cover ------------------------------------
  {
    const b = new VoxelBuilder();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      b.box(Math.cos(a) * 0.14, 0.1, Math.sin(a) * 0.14, 0.22, 0.07, 0.22, 0xffffff);
    }
    const geo = b.build();
    const mat = toonMaterial({ vertexColors: true });
    applyWind(mat, { height: 0.24, push: true });
    const pts = [
      ...scatter(rnd, Math.round(3200 * quality), {
        maxR: CFG.rim, kinds: ['grass', 'path'], clump: 3, clumpR: 0.5,
      }),
      ...scatter(rnd, Math.round(900 * quality), {
        cx: CFG.town.x, cz: CFG.town.z, maxR: CFG.town.r, kinds: ['grass'],
        clump: 3, clumpR: 0.5,
      }),
    ];
    const m = instanced(geo, mat, pts, rnd, {
      scale: [0.7, 1.5], colors: [0x69b84a, 0x57a63c, 0x7cc457],
    });
    m.name = 'clover';
    layers.push(m);
  }

  layers.forEach((m) => scene.add(m));

  const totals = layers.map((m) => m.count);
  return {
    layers,
    /** Thin the meadow uniformly (instances are generated in random order). */
    setDensity(k) {
      layers.forEach((m, i) => { m.count = Math.max(1, Math.round(totals[i] * k)); });
    },
  };
}
