// Voxel geometry builder + anime/cel shading materials.
// Every mesh in the demo is generated from boxes at runtime: zero asset downloads.
import * as THREE from '../../vendor/three/three.module.js';

/* ------------------------------------------------------------------ *
 *  Cel-shading                                                        *
 * ------------------------------------------------------------------ */

let _gradient = null;
/** Hard-stepped ramp texture -> the classic anime 3-tone falloff. */
export function toonRamp() {
  if (_gradient) return _gradient;
  const steps = new Uint8Array([62, 132, 200, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _gradient = tex;
  return tex;
}

export function toonMaterial(params = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });
}

/* ------------------------------------------------------------------ *
 *  Ink outlines (inverted hull)                                       *
 * ------------------------------------------------------------------ */

const OUTLINE_VERT = /* glsl */`
uniform float uThickness;
attribute vec3 aExpand;
#include <common>
void main() {
  vec3 transformed = position + aExpand * uThickness;
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}`;

const OUTLINE_FRAG = /* glsl */`
uniform vec3 uColor;
#include <common>
void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <colorspace_fragment>
}`;

export function outlineMaterial(thickness = 0.02, color = 0x1b2333) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
  });
}

/**
 * Attach a back-face hull to `mesh` so it reads as an inked voxel sprite.
 * Geometry must carry the `aExpand` attribute (VoxelBuilder emits it).
 */
export function addOutline(mesh, thickness = 0.022, color = 0x1b2333) {
  if (!mesh.geometry.getAttribute('aExpand')) return null;
  const shell = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
  shell.frustumCulled = mesh.frustumCulled;
  shell.renderOrder = (mesh.renderOrder || 0) - 1;
  mesh.add(shell);
  return shell;
}

/* ------------------------------------------------------------------ *
 *  Voxel builder                                                      *
 * ------------------------------------------------------------------ */

// Unit-cube faces, CCW seen from outside. Each face carries a baked tint so
// the blocks keep their chunky readability even in flat light.
const FACES = [
  { n: [1, 0, 0], t: 0.93, v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], t: 0.86, v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], t: 1.00, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], t: 0.70, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], t: 0.96, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], t: 0.82, v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const _c = new THREE.Color();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();

export class VoxelBuilder {
  /** opts.plant -> also emit aPivot/aSway so merged foliage can bend per plant. */
  constructor(opts = {}) {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.exp = [];
    this.idx = [];
    this._v = 0;
    this._m = null;      // optional transform applied to new boxes
    this._nm = null;
    this.plant = !!opts.plant;
    if (this.plant) {
      this.piv = [];
      this.swy = [];
      this._pivot = [0, 0, 0];
      this._swayH = 1;
      this._swayBase = 0;
      this._swayFixed = null;
    }
  }

  /** Apply a matrix to every box added afterwards (null to clear). */
  setTransform(m4) {
    this._m = m4;
    this._nm = m4 ? new THREE.Matrix3().setFromMatrix4(m4).invert().transpose() : null;
    return this;
  }

  /** Declare the pivot of the plant whose boxes come next (plant mode only). */
  setPlant(px, py, pz, swayHeight, base = 0) {
    this._pivot = [px, py, pz];
    this._swayH = swayHeight || 1;
    this._swayBase = base;
    this._swayFixed = null;
    return this;
  }

  /** Force a constant bend weight (banners bend by distance, not by height). */
  setSwayFixed(v) { this._swayFixed = v; return this; }

  /**
   * Add a box centred on (cx,cy,cz).
   * opts: { tint (per-box multiplier), faceShade (bool), skip:['+y',...] }
   */
  box(cx, cy, cz, w, h, d, color, opts = {}) {
    const tintMul = opts.tint === undefined ? 1 : opts.tint;
    const faceShade = opts.faceShade !== false;
    const skip = opts.skip;
    _c.set(color);
    const cr = _c.r * tintMul, cg = _c.g * tintMul, cb = _c.b * tintMul;
    const hx = w / 2, hy = h / 2, hz = d / 2;

    for (const f of FACES) {
      if (skip && skip.includes(faceKey(f.n))) continue;
      const shade = faceShade ? f.t : 1;
      const base = this._v;
      for (const v of f.v) {
        const sx = v[0] * 2 - 1, sy = v[1] * 2 - 1, sz = v[2] * 2 - 1;
        _p.set(cx + sx * hx, cy + sy * hy, cz + sz * hz);
        _n.set(f.n[0], f.n[1], f.n[2]);
        _e.set(sx, sy, sz);
        if (this._m) {
          _p.applyMatrix4(this._m);
          _n.applyMatrix3(this._nm).normalize();
          _e.applyMatrix3(this._nm);
        }
        this.pos.push(_p.x, _p.y, _p.z);
        this.nrm.push(_n.x, _n.y, _n.z);
        this.col.push(cr * shade, cg * shade, cb * shade);
        this.exp.push(_e.x, _e.y, _e.z);
        if (this.plant) {
          this.piv.push(this._pivot[0], this._pivot[1], this._pivot[2]);
          if (this._swayFixed !== null) {
            this.swy.push(this._swayFixed);
          } else {
            const t = (_p.y - this._pivot[1] - this._swayBase) / this._swayH;
            this.swy.push(t < 0 ? 0 : t > 1 ? 1 : t);
          }
        }
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      this._v += 4;
    }
    return this;
  }

  /** Box given by its min corner. */
  boxMin(x, y, z, w, h, d, color, opts) {
    return this.box(x + w / 2, y + h / 2, z + d / 2, w, h, d, color, opts);
  }

  /** Axis-aligned "beam" between two points (voxel style, no rotation). */
  slab(x0, y0, z0, x1, y1, z1, color, opts) {
    return this.boxMin(
      Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1),
      Math.abs(x1 - x0) || 0.001, Math.abs(y1 - y0) || 0.001, Math.abs(z1 - z0) || 0.001,
      color, opts,
    );
  }

  get empty() { return this._v === 0; }

  /** Vertices pushed so far - used to tag ranges with extra attributes. */
  get vertexCount() { return this._v; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aExpand', new THREE.Float32BufferAttribute(this.exp, 3));
    if (this.plant) {
      g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
      g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.swy, 1));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  /** Convenience: geometry + toon material + optional ink outline. */
  mesh(matParams = {}, outline = 0.02) {
    const m = new THREE.Mesh(this.build(), toonMaterial({ vertexColors: true, ...matParams }));
    if (outline > 0) addOutline(m, outline);
    return m;
  }
}

function faceKey(n) {
  if (n[0] === 1) return '+x'; if (n[0] === -1) return '-x';
  if (n[1] === 1) return '+y'; if (n[1] === -1) return '-y';
  return n[2] === 1 ? '+z' : '-z';
}

/** Give a non-voxel geometry an expand attribute so outlines still work. */
export function expandFromNormals(geometry) {
  if (geometry.getAttribute('aExpand')) return geometry;
  const n = geometry.getAttribute('normal');
  geometry.setAttribute('aExpand', new THREE.Float32BufferAttribute(n.array.slice(), 3));
  return geometry;
}
