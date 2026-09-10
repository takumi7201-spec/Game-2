import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Voxel builder: accumulates axis-aligned boxes into one merged BufferGeometry
// with per-vertex colour, per-vertex roughness/metalness and per-vertex emissive.
// Faces get baked directional tint + corner AO so flat voxel faces never read flat.
// ---------------------------------------------------------------------------

const FACES = [
  // dir, normal, 4 corner offsets (ccw), face light multiplier
  { n: [ 1, 0, 0], c: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], l: 0.92 },
  { n: [-1, 0, 0], c: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], l: 0.80 },
  { n: [ 0, 1, 0], c: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], l: 1.00 },
  { n: [ 0,-1, 0], c: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], l: 0.62 },
  { n: [ 0, 0, 1], c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], l: 0.88 },
  { n: [ 0, 0,-1], c: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], l: 0.74 },
];

const _c = new THREE.Color();

export class VoxBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.rm = []; this.emi = []; this.idx = [];
    this.v = 0;
    this.bounds = new THREE.Box3().makeEmpty();
  }

  // box(x,y,z, w,h,d, colour, opts)
  //   opts: { rough, metal, emissive, emissiveIntensity, jitter, aoTop, skip:[faceIdx] }
  box(x, y, z, w, h, d, color, opts = {}) {
    const rough = opts.rough !== undefined ? opts.rough : 0.72;
    const metal = opts.metal !== undefined ? opts.metal : 0.0;
    const jit = opts.jitter !== undefined ? opts.jitter : 0.06;
    const skip = opts.skip;
    _c.set(color);
    // deterministic-ish per-box jitter so the same model looks the same each build
    const h1 = Math.sin((x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453);
    const j = 1 + (h1 - Math.floor(h1) - 0.5) * 2 * jit;
    const rj = 1 + (Math.sin(h1 * 91.7) * 0.5) * 0.5;
    const er = opts.emissive ? new THREE.Color(opts.emissive) : null;
    const ei = opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1;

    for (let f = 0; f < 6; f++) {
      if (skip && skip.indexOf(f) !== -1) continue;
      const face = FACES[f];
      const lm = face.l;
      for (let k = 0; k < 4; k++) {
        const o = face.c[k];
        this.pos.push(x + o[0] * w, y + o[1] * h, z + o[2] * d);
        this.nor.push(face.n[0], face.n[1], face.n[2]);
        this.col.push(_c.r * j * lm, _c.g * j * lm, _c.b * j * lm);
        this.rm.push(Math.min(1, Math.max(0.02, rough * rj)), metal);
        if (er) this.emi.push(er.r * ei, er.g * ei, er.b * ei);
        else this.emi.push(0, 0, 0);
      }
      const v = this.v;
      this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      this.v += 4;
    }
    this.bounds.expandByPoint(new THREE.Vector3(x, y, z));
    this.bounds.expandByPoint(new THREE.Vector3(x + w, y + h, z + d));
    return this;
  }

  // unit voxel helper
  vox(x, y, z, color, opts) { return this.box(x, y, z, 1, 1, 1, color, opts); }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.rm, 2));
    g.setAttribute('aEmis', new THREE.Float32BufferAttribute(this.emi, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  isEmpty() { return this.v === 0; }
}

// Standard material patched to read per-vertex roughness / metalness / emissive.
export function voxelMaterial(params = {}) {
  const m = new THREE.MeshStandardMaterial(Object.assign({
    vertexColors: true, roughness: 1.0, metalness: 1.0,
  }, params));
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aRM;
        attribute vec3 aEmis;
        varying vec2 vRM;
        varying vec3 vEmis;
        varying vec3 vWPos;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vRM = aRM; vEmis = aEmis;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRM;
        varying vec3 vEmis;
        varying vec3 vWPos;
        // cheap 3d value noise for micro surface breakup
        float vhash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
        float vnoise(vec3 p){
          vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(vhash(i+vec3(0,0,0)),vhash(i+vec3(1,0,0)),f.x),
                         mix(vhash(i+vec3(0,1,0)),vhash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(vhash(i+vec3(0,0,1)),vhash(i+vec3(1,0,1)),f.x),
                         mix(vhash(i+vec3(0,1,1)),vhash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }`)
      .replace('#include <roughnessmap_fragment>', `
        float n0 = vnoise(vWPos * 5.5);
        float n1 = vnoise(vWPos * 21.0);
        float roughnessFactor = clamp(vRM.x + (n0-0.5)*0.20 + (n1-0.5)*0.10, 0.03, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `
        float metalnessFactor = clamp(vRM.y - (n1-0.5)*0.12, 0.0, 1.0);`)
      .replace('#include <emissivemap_fragment>', `
        totalEmissiveRadiance = vEmis;`)
      // subtle grime darkening in crevices, keeps big flat faces alive
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 0.86 + 0.28 * vnoise(vWPos * 2.3);`);
  };
  m.customProgramCacheKey = () => 'voxmat';
  return m;
}
