// Sky dome, cloud sea and the distant archipelago that sells the scale.
import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32 } from '../lib/math.js';
import { VoxelBuilder, toonMaterial } from '../lib/voxel.js';
import { windUniforms } from '../lib/wind.js';

export const SKY = {
  zenith: 0x1f6fc8,
  mid: 0x5fb2ee,
  horizon: 0xc8e8fa,
  fog: 0xcfe8f7,
  cloud: 0xffffff,
  cloudShade: 0xbed4ea,
  sun: 0xfff6d5,
};

const NOISE_GLSL = /* glsl */`
float hash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash21( i );
  float b = hash21( i + vec2( 1.0, 0.0 ) );
  float c = hash21( i + vec2( 0.0, 1.0 ) );
  float d = hash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float fbm( vec2 p ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 4; i++ ) { s += a * vnoise( p ); p *= 2.03; a *= 0.5; }
  return s;
}
`;

export function buildSky(scene, sunDir) {
  const group = new THREE.Group();
  group.name = 'sky';

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: windUniforms.uTime,
      uSun: { value: sunDir.clone().normalize() },
      uZenith: { value: new THREE.Color(SKY.zenith) },
      uMid: { value: new THREE.Color(SKY.mid) },
      uHorizon: { value: new THREE.Color(SKY.horizon) },
      uCloud: { value: new THREE.Color(SKY.cloud) },
      uCloudShade: { value: new THREE.Color(SKY.cloudShade) },
      uSunCol: { value: new THREE.Color(SKY.sun) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSun, uZenith, uMid, uHorizon, uCloud, uCloudShade, uSunCol;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize( vDir );
        float h = clamp( d.y, -1.0, 1.0 );
        vec3 col = mix( uHorizon, uMid, smoothstep( -0.06, 0.42, h ) );
        col = mix( col, uZenith, smoothstep( 0.30, 0.95, h ) );

        // sun + soft bloom
        float s = dot( d, uSun );
        col = mix( col, uSunCol, pow( max( s, 0.0 ), 220.0 ) );
        col += uSunCol * pow( max( s, 0.0 ), 12.0 ) * 0.16;

        // banded anime clouds, projected onto the dome
        if ( h > 0.015 ) {
          vec2 p = d.xz / max( d.y, 0.09 ) * 0.55;
          p += vec2( uTime * 0.006, uTime * 0.0035 );
          float n = fbm( p * 1.15 );
          float n2 = fbm( p * 2.4 + 11.3 );
          float c = smoothstep( 0.46, 0.72, n * 0.75 + n2 * 0.25 );
          c *= smoothstep( 0.02, 0.20, h );
          float band = step( 0.30, c ) * 0.45 + step( 0.62, c ) * 0.55;
          vec3 cc = mix( uCloudShade, uCloud, band );
          col = mix( col, cc, clamp( c * 1.15, 0.0, 1.0 ) );
        }
        gl_FragColor = vec4( col, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 20), domeMat);
  dome.frustumCulled = false;
  group.add(dome);

  /* --- the cloud ocean far below the island --- */
  const seaMat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: windUniforms.uTime,
      uCloud: { value: new THREE.Color(0xffffff) },
      uShade: { value: new THREE.Color(0xa9c6e4) },
      uDeep: { value: new THREE.Color(0x7fa8cf) },
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      varying vec2 vP;
      void main() {
        vP = position.xy;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uCloud, uShade, uDeep;
      varying vec2 vP;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        vec2 p = vP * 0.014 + vec2( uTime * 0.008, uTime * 0.004 );
        float n = fbm( p ) * 0.7 + fbm( p * 2.7 + 4.0 ) * 0.3;
        float c = smoothstep( 0.38, 0.66, n );
        float band = step( 0.25, c ) * 0.4 + step( 0.55, c ) * 0.6;
        vec3 col = mix( uDeep, uShade, smoothstep( 0.1, 0.45, n ) );
        col = mix( col, uCloud, band * 0.9 );
        gl_FragColor = vec4( col, 1.0 );
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -235;
  sea.frustumCulled = false;
  group.add(sea);

  scene.add(group);
  return { group, dome };
}

/* ------------------------------------------------------------------ *
 *  Distant floating lands                                             *
 * ------------------------------------------------------------------ */

function floatingIsland(b, rnd, cx, cy, cz, radius, opts = {}) {
  const cell = Math.max(0.9, radius * 0.16);
  const grassCols = [0x6fbe45, 0x5da53c, 0x86cc57];
  const rockCols = [0x8794a3, 0x77838f, 0x6f7c8b, 0x8a7561];
  const top = [];
  for (let x = -radius; x <= radius; x += cell) {
    for (let z = -radius; z <= radius; z += cell) {
      const d = Math.hypot(x, z) / radius;
      if (d > 0.86 + Math.sin(x * 0.7 + z * 0.4) * 0.13) continue;
      const hump = (1 - d * d) * radius * 0.22;
      const y = hump + Math.sin(x * 1.1) * radius * 0.03;
      top.push([x, y, z, d]);
    }
  }
  for (const [x, y, z, d] of top) {
    b.box(cx + x, cy + y, cz + z, cell * 1.05, cell * 0.8, cell * 1.05,
      opts.barren ? rockCols[(rnd() * rockCols.length) | 0] : grassCols[(rnd() * 3) | 0],
      { tint: 0.9 + rnd() * 0.2 });
    // rock body tapering into a point
    const depth = radius * (1.5 - d) * 0.85;
    const steps = Math.max(2, Math.round(depth / cell));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const shrink = 1 - t * 0.55;
      if (Math.hypot(x, z) > radius * (0.86 - t * 0.75)) continue;
      b.box(cx + x * shrink, cy + y - i * cell * 0.85, cz + z * shrink,
        cell * 1.05, cell * 0.9, cell * 1.05,
        rockCols[(rnd() * rockCols.length) | 0], { tint: 0.86 + rnd() * 0.2 });
    }
  }
  // tiny trees / spires
  if (!opts.barren) {
    const n = Math.max(1, Math.round(radius * 0.5));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * radius * 0.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = cy + (1 - (r / radius) ** 2) * radius * 0.22 + cell * 0.4;
      const th = radius * (0.12 + rnd() * 0.14);
      b.box(cx + x, y + th * 0.5, cz + z, th * 0.28, th, th * 0.28, 0x7a5230);
      b.box(cx + x, y + th * 1.25, cz + z, th * 1.25, th * 0.95, th * 1.25,
        [0x4fa83c, 0x63bd48, 0x3f8f32][(rnd() * 3) | 0]);
    }
  } else {
    const n = Math.max(1, Math.round(radius * 0.3));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * radius * 0.55;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const th = radius * (0.3 + rnd() * 0.5);
      b.box(cx + x, cy + th * 0.5 + cell * 0.4, cz + z, cell * 1.4, th, cell * 1.4,
        rockCols[(rnd() * rockCols.length) | 0], { tint: 0.9 + rnd() * 0.16 });
    }
  }
}

/** A colossal half-buried skull on the horizon: this island is one big fossil bed. */
function titanSkull(b, rnd, cx, cy, cz, s) {
  const bone = 0xe6dcc2, dark = 0xc9bb9a;
  b.box(cx, cy + s * 0.5, cz, s * 2.6, s * 1.5, s * 2.0, bone);
  b.box(cx + s * 1.9, cy + s * 0.35, cz, s * 1.6, s * 0.9, s * 1.2, bone, { tint: 0.97 });
  b.box(cx + s * 2.8, cy + s * 0.3, cz, s * 0.7, s * 0.6, s * 0.8, dark);
  b.box(cx + s * 0.5, cy + s * 0.75, cz + s * 0.8, s * 0.6, s * 0.6, s * 0.5, 0x2b2f3a);
  b.box(cx + s * 0.5, cy + s * 0.75, cz - s * 0.8, s * 0.6, s * 0.6, s * 0.5, 0x2b2f3a);
  b.box(cx - s * 0.2, cy + s * 1.4, cz, s * 1.7, s * 0.5, s * 2.2, bone);
  for (let i = 0; i < 5; i++) {
    b.box(cx + s * (1.3 + i * 0.32), cy - s * 0.12, cz + s * 0.55, s * 0.2, s * 0.35, s * 0.2, bone);
    b.box(cx + s * (1.3 + i * 0.32), cy - s * 0.12, cz - s * 0.55, s * 0.2, s * 0.35, s * 0.2, bone);
  }
  // ribs rising behind it
  for (let i = 0; i < 5; i++) {
    const rx = cx - s * (1.8 + i * 0.9);
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const u = k / 4;
        b.box(rx, cy + s * (0.4 + Math.sin(u * 1.5) * 1.9), cz + sd * s * (1.0 + u * 1.5),
          s * 0.28, s * 0.5, s * 0.28, k % 2 ? dark : bone);
      }
    }
  }
}

const TOWN = { x: 52, z: -4, keep: 95 };
const tooCloseToTown = (x, z) => Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.keep;

export function buildDistantLands(scene) {
  const rnd = mulberry32(31415);
  const b = new VoxelBuilder();
  const drifters = [];

  // The isometric eye looks 35 degrees down, so anything "far away" is also far
  // BELOW: the visible band follows that cone. Islands are laid along it.
  const bandY = (h) => -h * 0.72;

  // near neighbours: their own meshes so they can bob independently
  for (let i = 0; i < 12; i++) {
    const bb = new VoxelBuilder();
    const a = (i / 12) * Math.PI * 2 + rnd() * 0.5;
    const dist = 88 + rnd() * 70;
    const radius = 3.5 + rnd() * 9;
    const y = bandY(dist) + (rnd() - 0.35) * dist * 0.45;
    const px = Math.cos(a) * dist, pz = Math.sin(a) * dist;
    if (tooCloseToTown(px, pz)) continue;
    floatingIsland(bb, rnd, 0, 0, 0, radius, { barren: rnd() < 0.3 });
    const mesh = new THREE.Mesh(bb.build(), toonMaterial({ vertexColors: true }));
    mesh.position.set(px, y, pz);
    mesh.userData = { phase: rnd() * 6.28, amp: 0.5 + rnd() * 1.1, spin: (rnd() - 0.5) * 0.02, y };
    scene.add(mesh);
    drifters.push(mesh);
  }

  // far archipelago, merged into one static mesh
  for (let i = 0; i < 44; i++) {
    const a = rnd() * Math.PI * 2;
    const dist = 140 + Math.pow(rnd(), 0.75) * 320;
    const radius = 8 + rnd() * 40;
    if (tooCloseToTown(Math.cos(a) * dist, Math.sin(a) * dist)) continue;
    floatingIsland(b, rnd,
      Math.cos(a) * dist,
      bandY(dist) + (rnd() - 0.4) * dist * 0.5,
      Math.sin(a) * dist, radius,
      { barren: rnd() < 0.55 });
  }
  // a few landmark silhouettes
  titanSkull(b, rnd, -132, bandY(190) + 40, -136, 9.5);
  titanSkull(b, rnd, 168, bandY(210) + 26, 128, 7.0);
  titanSkull(b, rnd, 40, bandY(120) + 8, -118, 5.5);
  const far = new THREE.Mesh(b.build(), toonMaterial({ vertexColors: true }));
  far.frustumCulled = false;
  scene.add(far);

  /* --- drifting cloud puffs at island height --- */
  const puffs = [];
  for (let i = 0; i < 22; i++) {
    const pb = new VoxelBuilder();
    const s = 2.6 + rnd() * 5.5;
    const n = 9 + ((rnd() * 7) | 0);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = s * (0.15 + rnd() * 0.85);
      pb.box(Math.cos(a) * rr, (rnd() - 0.5) * s * 0.22, Math.sin(a) * rr * 0.6,
        s * (0.35 + rnd() * 0.4), s * (0.2 + rnd() * 0.22), s * (0.3 + rnd() * 0.32),
        rnd() < 0.4 ? 0xdce9f7 : 0xffffff, { tint: 0.9 + rnd() * 0.16 });
    }
    const mesh = new THREE.Mesh(pb.build(), toonMaterial({ vertexColors: true, fog: true }));
    const a = rnd() * Math.PI * 2;
    const dist = 78 + rnd() * 210;
    if (tooCloseToTown(Math.cos(a) * dist, Math.sin(a) * dist)) continue;
    mesh.position.set(Math.cos(a) * dist, bandY(dist) + (rnd() - 0.3) * dist * 0.55,
      Math.sin(a) * dist);
    mesh.userData = { speed: 0.35 + rnd() * 0.5, phase: rnd() * 6.28 };
    scene.add(mesh);
    puffs.push(mesh);
  }

  return {
    update(dt, t) {
      for (const m of drifters) {
        m.position.y = m.userData.y + Math.sin(t * 0.25 + m.userData.phase) * m.userData.amp;
        m.rotation.y += m.userData.spin * dt;
      }
      for (const p of puffs) {
        p.position.x += p.userData.speed * dt;
        p.position.y += Math.sin(t * 0.3 + p.userData.phase) * dt * 0.4;
        if (p.position.x > 260) p.position.x = -260;
      }
    },
  };
}
