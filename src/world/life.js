// Everything that flits, drifts, splashes or hops. Keeps the island feeling alive.
import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32, clamp } from '../lib/math.js';
import { VoxelBuilder, toonMaterial, addOutline } from '../lib/voxel.js';
import { windUniforms } from '../lib/wind.js';
import { CFG, groundAt } from './terrain.js';

/* ================================================================== *
 *  GPU motes (pollen, fireflies, mist, sparks, dust)                  *
 * ================================================================== */

export const moteUniforms = { uPixelScale: { value: 40 } };

function motes(opts) {
  const {
    count, color, size = 0.16, rise = 0.4, span = 4, additive = false,
    place, wander = 0.5, twinkle = 0.0, opacity = 0.8,
  } = opts;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 3); // phase, speed, size jitter
  const rnd = mulberry32(opts.seed || 11);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    place(v, rnd, i);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    seed[i * 3] = rnd() * 100;
    seed[i * 3 + 1] = 0.6 + rnd() * 0.8;
    seed[i * 3 + 2] = 0.6 + rnd() * 0.9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: windUniforms.uTime,
      uPixelScale: moteUniforms.uPixelScale,
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uRise: { value: rise },
      uSpan: { value: span },
      uWander: { value: wander },
      uTwinkle: { value: twinkle },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      uniform float uTime, uPixelScale, uSize, uRise, uSpan, uWander, uTwinkle;
      attribute vec3 aSeed;
      varying float vFade;
      varying float vTw;
      void main() {
        float ph = aSeed.x, sp = aSeed.y;
        float t = uTime * sp + ph;
        vec3 p = position;
        p.x += sin( t * 0.63 ) * uWander + sin( t * 0.21 + 1.7 ) * uWander * 0.6;
        p.z += cos( t * 0.55 + 0.9 ) * uWander + cos( t * 0.17 ) * uWander * 0.6;
        float climb = mod( uTime * uRise * sp + ph * 3.0, uSpan );
        p.y += climb + sin( t * 1.3 ) * uWander * 0.35;
        float k = climb / uSpan;
        vFade = smoothstep( 0.0, 0.18, k ) * ( 1.0 - smoothstep( 0.62, 1.0, k ) );
        vTw = 0.65 + 0.35 * sin( t * 3.1 + ph );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max( 1.0, uSize * aSeed.z * uPixelScale );
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uTwinkle, uOpacity;
      varying float vFade;
      varying float vTw;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length( c );
        if ( d > 0.5 ) discard;
        float a = smoothstep( 0.5, 0.12, d ) * vFade * uOpacity;
        a *= mix( 1.0, vTw, uTwinkle );
        vec3 col = mix( uColor, vec3( 1.0 ), smoothstep( 0.28, 0.0, d ) * 0.55 );
        gl_FragColor = vec4( col, a );
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/* ================================================================== *
 *  Flapping flyers (butterflies + birds) in a single draw call each   *
 * ================================================================== */

function flyerGeometry(build) {
  const b = new VoxelBuilder();
  const wingFlag = [];
  build(b, (flag, from) => {
    // tag every vertex pushed since `from` with the wing side
    for (let i = from; i < b.vertexCount; i++) wingFlag[i] = flag;
  });
  const n = b.vertexCount;
  const geo = b.build();
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = wingFlag[i] || 0;
  geo.setAttribute('aWing', new THREE.BufferAttribute(arr, 1));
  return geo;
}

function flyerMaterial(flapSpeed, flapAmount) {
  const mat = toonMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform float uTime;
        attribute float aWing;
        attribute float aPhase;`)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        if ( abs( aWing ) > 0.5 ) {
          float ang = sin( uTime * ${flapSpeed.toFixed(2)} + aPhase ) * ${flapAmount.toFixed(2)} * aWing;
          float c = cos( ang ), s = sin( ang );
          transformed.xy = mat2( c, s, -s, c ) * transformed.xy;
        }`);
  };
  mat.customProgramCacheKey = () => `flyer|${flapSpeed}|${flapAmount}`;
  return mat;
}

function makeFlyers(scene, { count, geo, mat, rnd }) {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) phases[i] = rnd() * 6.28;
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  scene.add(mesh);
  return mesh;
}

/* ================================================================== *
 *  CPU puff system (footsteps, splashes)                              *
 * ================================================================== */

class Puffs {
  constructor(scene, count = 90, color = 0xd8c9a8, size = 0.3) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.alpha = new Float32Array(count);
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelScale: moteUniforms.uPixelScale,
        uColor: { value: new THREE.Color(color) },
        uSize: { value: size },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        uniform float uPixelScale, uSize;
        attribute float aAlpha;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max( 1.0, uSize * uPixelScale * ( 0.5 + 1.4 * ( 1.0 - aAlpha ) ) );
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length( c );
          if ( d > 0.5 || vA <= 0.0 ) discard;
          gl_FragColor = vec4( uColor, smoothstep( 0.5, 0.1, d ) * vA * 0.75 );
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(x, y, z, spread = 0.25, up = 0.5, life = 0.7) {
    const i = this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = (Math.random() - 0.5) * spread;
    this.vel[i * 3 + 1] = up * (0.6 + Math.random() * 0.7);
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
    this.life[i] = this.max[i] = life;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      any = true;
      this.life[i] -= dt;
      const k = i * 3;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.vel[k + 1] -= dt * 0.35;
      this.vel[k] *= 1 - dt * 1.4;
      this.vel[k + 2] *= 1 - dt * 1.4;
      this.alpha[i] = clamp(this.life[i] / this.max[i], 0, 1);
    }
    if (any || this._wasAny) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
    this._wasAny = any;
  }
}

/* ================================================================== *
 *  Pond fish                                                          *
 * ================================================================== */

function makeFish(scene) {
  const b = new VoxelBuilder();
  b.box(0, 0, 0, 0.62, 0.34, 0.24, 0xff9b57);
  b.box(0.34, 0.02, 0, 0.2, 0.24, 0.16, 0xffbe7d);
  b.box(-0.38, 0.06, 0, 0.28, 0.34, 0.06, 0xff7d43);
  b.box(0, 0.2, 0, 0.24, 0.16, 0.06, 0xff7d43);
  b.box(0.22, 0.06, 0.12, 0.08, 0.08, 0.03, 0x22262f);
  b.box(0.22, 0.06, -0.12, 0.08, 0.08, 0.03, 0x22262f);
  const mesh = new THREE.Mesh(b.build(), toonMaterial({ vertexColors: true }));
  addOutline(mesh, 0.015);
  mesh.visible = false;
  scene.add(mesh);

  const ringGeo = new THREE.RingGeometry(0.2, 0.34, 24);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xeafcff, transparent: true, opacity: 0, side: THREE.DoubleSide,
    }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    rings.push({ mesh: m, t: 0 });
  }

  let timer = 3 + Math.random() * 4;
  let jump = null;
  return {
    update(dt) {
      timer -= dt;
      if (!jump && timer <= 0) {
        timer = 5 + Math.random() * 7;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * (CFG.pond.r - 1.2);
        const dir = Math.random() * Math.PI * 2;
        jump = {
          t: 0, dur: 1.15,
          x: CFG.pond.x + Math.cos(a) * r,
          z: CFG.pond.z + Math.sin(a) * r,
          dir, dist: 1.1 + Math.random() * 0.8, h: 1.1 + Math.random() * 0.6,
        };
        mesh.visible = true;
        const ring = rings.find((rr) => !rr.mesh.visible) || rings[0];
        ring.mesh.visible = true; ring.t = 0;
        ring.mesh.position.set(jump.x, CFG.pond.water + 0.04, jump.z);
      }
      if (jump) {
        jump.t += dt;
        const u = jump.t / jump.dur;
        if (u >= 1) {
          jump = null; mesh.visible = false;
        } else {
          const dx = Math.cos(jump.dir) * jump.dist * u;
          const dz = Math.sin(jump.dir) * jump.dist * u;
          mesh.position.set(jump.x + dx, CFG.pond.water + Math.sin(u * Math.PI) * jump.h - 0.15,
            jump.z + dz);
          mesh.rotation.y = -jump.dir;
          mesh.rotation.z = Math.cos(u * Math.PI) * 0.9;
          if (u > 0.92) {
            const ring = rings.find((rr) => !rr.mesh.visible);
            if (ring) {
              ring.mesh.visible = true; ring.t = 0;
              ring.mesh.position.set(mesh.position.x, CFG.pond.water + 0.04, mesh.position.z);
            }
          }
        }
      }
      for (const r of rings) {
        if (!r.mesh.visible) continue;
        r.t += dt;
        const u = r.t / 1.4;
        if (u >= 1) { r.mesh.visible = false; continue; }
        const s = 0.4 + u * 3.2;
        r.mesh.scale.set(s, s, s);
        r.mesh.material.opacity = (1 - u) * 0.7;
      }
    },
  };
}

/* ================================================================== *
 *  Wandering critters: little fossil-hatchling dinos                  *
 * ================================================================== */

function makeCritter(scene, rnd, tint) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const b = new VoxelBuilder();
  b.box(0, 0.38, 0, 0.5, 0.42, 0.68, tint);
  b.box(0, 0.34, -0.42, 0.34, 0.3, 0.3, tint, { tint: 0.95 });
  b.box(0, 0.3, -0.62, 0.22, 0.2, 0.2, tint, { tint: 0.9 });
  b.box(0, 0.5, 0.1, 0.42, 0.2, 0.3, 0xfff0cf);   // belly stripe
  const bodyMesh = new THREE.Mesh(b.build(), toonMaterial({ vertexColors: true }));
  addOutline(bodyMesh, 0.02);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);

  const h = new VoxelBuilder();
  h.box(0, 0, 0, 0.42, 0.4, 0.46, tint);
  h.box(0, -0.05, 0.28, 0.3, 0.24, 0.2, 0xffe0b0);
  h.box(0.14, 0.08, 0.2, 0.1, 0.1, 0.04, 0x22262f);
  h.box(-0.14, 0.08, 0.2, 0.1, 0.1, 0.04, 0x22262f);
  h.box(0, 0.24, -0.02, 0.16, 0.16, 0.3, 0xffd166);  // little crest
  const headMesh = new THREE.Mesh(h.build(), toonMaterial({ vertexColors: true }));
  addOutline(headMesh, 0.02);
  headMesh.position.set(0, 0.62, 0.42);
  headMesh.castShadow = true;
  body.add(headMesh);

  const legs = [];
  for (const sx of [-1, 1]) {
    const l = new VoxelBuilder();
    l.box(0, -0.14, 0, 0.16, 0.28, 0.16, tint, { tint: 0.9 });
    l.box(0, -0.3, 0.06, 0.18, 0.1, 0.26, 0xffd166);
    const m = new THREE.Mesh(l.build(), toonMaterial({ vertexColors: true }));
    addOutline(m, 0.018);
    m.position.set(sx * 0.16, 0.28, 0.02);
    body.add(m);
    legs.push(m);
  }

  scene.add(root);
  const state = {
    root, body, headMesh, legs,
    pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0,
    idle: 0, hop: 0, phase: rnd() * 6.28,
  };
  return state;
}

/* ================================================================== *
 *  Assembly                                                           *
 * ================================================================== */

export function buildLife(scene, ctx) {
  const rnd = mulberry32(6060);
  const updaters = [];

  /* --- pollen drifting over the whole meadow --- */
  scene.add(motes({
    count: 420, color: 0xfff4c9, size: 0.075, rise: 0.35, span: 5.5, wander: 0.55,
    additive: true, twinkle: 0.5, opacity: 0.75, seed: 3,
    place: (v, r) => {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * CFG.rim;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      v.set(x, groundAt(x, z) + 0.4, z);
    },
  }));

  /* --- fireflies hugging the bushes and the ruins --- */
  scene.add(motes({
    count: 190, color: 0xbdff8a, size: 0.13, rise: 0.16, span: 2.6, wander: 0.9,
    additive: true, twinkle: 1.0, opacity: 0.9, seed: 8,
    place: (v, r) => {
      const a = r() * Math.PI * 2, rr = 6 + Math.sqrt(r()) * (CFG.rim - 7);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      v.set(x, groundAt(x, z) + 0.5, z);
    },
  }));

  /* --- waterfall mist + spray off the island rim --- */
  scene.add(motes({
    count: 130, color: 0xffffff, size: 0.42, rise: 0.9, span: 3.4, wander: 0.35,
    opacity: 0.5, seed: 12,
    place: (v, r) => {
      const p = ctx.water.fallBase;
      v.set(p.x + (r() - 0.5) * 2.6, p.y - 0.2, p.z + (r() - 0.5) * 2.2);
    },
  }));
  scene.add(motes({
    count: 110, color: 0xffffff, size: 0.6, rise: 0.55, span: 5.0, wander: 0.5,
    opacity: 0.42, seed: 15,
    place: (v, r) => {
      const p = ctx.water.edgeTop;
      v.set(p.x + (r() - 0.5) * 4.0, p.y - 3 - r() * 6, p.z + (r() - 0.5) * 4.0);
    },
  }));

  /* --- embers over the campfire --- */
  scene.add(motes({
    count: 70, color: 0xffb15c, size: 0.1, rise: 1.35, span: 3.6, wander: 0.28,
    additive: true, twinkle: 1.0, seed: 21,
    place: (v, r) => {
      const p = ctx.props.firePos;
      v.set(p.x + (r() - 0.5) * 0.6, p.y - 0.4, p.z + (r() - 0.5) * 0.6);
    },
  }));

  /* --- dust hanging in the dig pit --- */
  scene.add(motes({
    count: 90, color: 0xe3cfa6, size: 0.18, rise: 0.22, span: 3.2, wander: 0.7,
    opacity: 0.45, seed: 30,
    place: (v, r) => {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * CFG.pit.r;
      const x = CFG.pit.x + Math.cos(a) * rr, z = CFG.pit.z + Math.sin(a) * rr;
      v.set(x, groundAt(x, z) + 0.3, z);
    },
  }));

  /* --- butterflies --- */
  const bflyGeo = flyerGeometry((b, tag) => {
    b.box(0, 0, 0, 0.09, 0.09, 0.3, 0x3b3550);
    b.box(0, 0.07, -0.16, 0.07, 0.07, 0.07, 0x3b3550);
    let from = b.vertexCount;
    b.box(0.26, 0.02, 0.02, 0.42, 0.03, 0.34, 0xffffff);
    b.box(0.2, 0.02, -0.2, 0.3, 0.03, 0.24, 0xffffff);
    tag(1, from);
    from = b.vertexCount;
    b.box(-0.26, 0.02, 0.02, 0.42, 0.03, 0.34, 0xffffff);
    b.box(-0.2, 0.02, -0.2, 0.3, 0.03, 0.24, 0xffffff);
    tag(-1, from);
  });
  const bflyCount = 26;
  const bflies = makeFlyers(scene, {
    count: bflyCount, geo: bflyGeo, mat: flyerMaterial(16.0, 1.15), rnd,
  });
  const bflyCols = [0xffe066, 0xff9ec7, 0x9ad7ff, 0xffffff, 0xc59bff, 0xff8a5c];
  const bflyState = [];
  const _c = new THREE.Color();
  for (let i = 0; i < bflyCount; i++) {
    const a = rnd() * Math.PI * 2, rr = 3 + rnd() * (CFG.rim - 5);
    bflyState.push({
      x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: 0,
      ang: rnd() * Math.PI * 2, speed: 0.8 + rnd() * 0.9,
      bob: rnd() * 6.28, height: 0.6 + rnd() * 1.6, turn: (rnd() - 0.5) * 0.8,
    });
    bflies.setColorAt(i, _c.set(bflyCols[(rnd() * bflyCols.length) | 0]));
  }
  bflies.instanceColor.needsUpdate = true;

  /* --- birds circling high above --- */
  const birdGeo = flyerGeometry((b, tag) => {
    b.box(0, 0, 0, 0.16, 0.16, 0.72, 0x39435c);
    b.box(0, 0.06, -0.42, 0.14, 0.14, 0.2, 0x39435c);
    b.box(0, 0.02, 0.44, 0.1, 0.1, 0.22, 0x2c3448);
    let from = b.vertexCount;
    b.box(0.62, 0.04, 0, 1.1, 0.05, 0.42, 0x4d5a78);
    tag(1, from);
    from = b.vertexCount;
    b.box(-0.62, 0.04, 0, 1.1, 0.05, 0.42, 0x4d5a78);
    tag(-1, from);
  });
  const birdCount = 9;
  const birds = makeFlyers(scene, {
    count: birdCount, geo: birdGeo, mat: flyerMaterial(4.6, 0.75), rnd,
  });
  const birdState = [];
  for (let i = 0; i < birdCount; i++) {
    birdState.push({
      r: 26 + rnd() * 26, y: 16 + rnd() * 16, a: rnd() * 6.28,
      speed: (0.1 + rnd() * 0.14) * (rnd() < 0.35 ? -1 : 1), bob: rnd() * 6.28,
      cx: (rnd() - 0.5) * 14, cz: (rnd() - 0.5) * 14, scale: 0.7 + rnd() * 0.7,
    });
  }

  /* --- critters --- */
  const critters = [];
  for (let i = 0; i < 3; i++) {
    const c = makeCritter(scene, rnd, [0x8fd36a, 0x6fc3e8, 0xffb066][i % 3]);
    const a = rnd() * Math.PI * 2, rr = 4 + rnd() * 8;
    c.pos.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    c.target.copy(c.pos);
    critters.push(c);
  }

  const puffs = new Puffs(scene, 110, 0xe8dcc0, 0.34);
  const fish = makeFish(scene);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();

  updaters.push((dt, t) => {
    // butterflies: lazy wandering, staying near the ground
    for (let i = 0; i < bflyCount; i++) {
      const s = bflyState[i];
      s.ang += (Math.sin(t * s.speed * 0.7 + s.bob) * 0.9 + s.turn) * dt;
      s.x += Math.cos(s.ang) * s.speed * dt;
      s.z += Math.sin(s.ang) * s.speed * dt;
      const d = Math.hypot(s.x, s.z);
      if (d > CFG.rim - 2) {           // steer back inland
        s.ang += Math.PI * dt * 2.2;
        s.x -= (s.x / d) * dt * 1.4;
        s.z -= (s.z / d) * dt * 1.4;
      }
      const g = groundAt(s.x, s.z);
      s.y = g + s.height + Math.sin(t * 2.2 + s.bob) * 0.35;
      e.set(Math.sin(t * 1.4 + s.bob) * 0.2, -s.ang + Math.PI / 2, Math.sin(t * 2.0 + s.bob) * 0.25);
      q.setFromEuler(e);
      v3.set(s.x, s.y, s.z);
      s3.setScalar(0.75);
      m4.compose(v3, q, s3);
      bflies.setMatrixAt(i, m4);
    }
    bflies.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < birdCount; i++) {
      const s = birdState[i];
      s.a += s.speed * dt;
      v3.set(s.cx + Math.cos(s.a) * s.r, s.y + Math.sin(t * 0.5 + s.bob) * 1.2,
        s.cz + Math.sin(s.a) * s.r);
      e.set(0, -s.a + (s.speed > 0 ? Math.PI / 2 : -Math.PI / 2), Math.sin(s.a * 2) * 0.12);
      q.setFromEuler(e);
      s3.setScalar(s.scale);
      m4.compose(v3, q, s3);
      birds.setMatrixAt(i, m4);
    }
    birds.instanceMatrix.needsUpdate = true;

    // hatchlings hop between waypoints and peck at the grass
    for (const c of critters) {
      const dx = c.target.x - c.pos.x, dz = c.target.z - c.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.35) {
        c.idle -= dt;
        if (c.idle <= 0) {
          const a = Math.random() * Math.PI * 2;
          const rr = 2 + Math.random() * 5;
          let nx = c.pos.x + Math.cos(a) * rr, nz = c.pos.z + Math.sin(a) * rr;
          const dd = Math.hypot(nx, nz);
          if (dd > CFG.play - 1) { nx *= (CFG.play - 1) / dd; nz *= (CFG.play - 1) / dd; }
          c.target.set(nx, 0, nz);
          c.idle = 1.5 + Math.random() * 3.5;
        }
        // idle: bob the head, look around
        c.headMesh.rotation.x = Math.sin(t * 1.3 + c.phase) * 0.35 - 0.1;
        c.headMesh.rotation.y = Math.sin(t * 0.7 + c.phase) * 0.6;
        c.body.position.y = Math.sin(t * 2.4 + c.phase) * 0.03;
        c.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 1.5 + i) * 0.05; });
      } else {
        const sp = 2.1;
        c.pos.x += (dx / dist) * sp * dt;
        c.pos.z += (dz / dist) * sp * dt;
        c.hop += dt * 7.5;
        const hop = Math.abs(Math.sin(c.hop));
        c.body.position.y = hop * 0.22;
        c.body.rotation.x = -hop * 0.18;
        c.headMesh.rotation.x = hop * 0.2 - 0.1;
        c.headMesh.rotation.y *= 0.85;
        c.legs.forEach((l, i) => {
          l.rotation.x = Math.sin(c.hop + i * Math.PI) * 0.7;
        });
        const want = Math.atan2(dx, dz);
        let diff = want - c.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        c.yaw += diff * Math.min(1, dt * 7);
        if (hop < 0.12 && !c.footed) {
          puffs.spawn(c.pos.x, groundAt(c.pos.x, c.pos.z) + 0.05, c.pos.z, 0.5, 0.25, 0.45);
          c.footed = true;
        } else if (hop > 0.4) c.footed = false;
      }
      c.root.position.set(c.pos.x, groundAt(c.pos.x, c.pos.z), c.pos.z);
      c.root.rotation.y = c.yaw;
    }

    puffs.update(dt);
    fish.update(dt);
  });

  return {
    update(dt, t) { for (const u of updaters) u(dt, t); },
    puffs,
  };
}
