// Cel-shaded water: pond surface, ridge waterfall and the overflow that pours
// off the island rim into the clouds.
import * as THREE from '../../vendor/three/three.module.js';
import { CFG, groundAt, isLand } from './terrain.js';
import { windUniforms } from '../lib/wind.js';

const COMMON = /* glsl */`
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
`;

function pondMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: windUniforms.uTime,
      uRadius: { value: CFG.pond.r },
      uDeep: { value: new THREE.Color(0x1f7ea8) },
      uShallow: { value: new THREE.Color(0x63d3e0) },
      uFoam: { value: new THREE.Color(0xeafcff) },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec2 vLocal;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        p.z += sin( p.x * 1.7 + uTime * 1.5 ) * 0.035
             + sin( p.y * 2.2 - uTime * 1.1 ) * 0.03;
        vLocal = position.xy;
        vec4 wp = modelMatrix * vec4( p, 1.0 );
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uRadius;
      uniform vec3 uDeep, uShallow, uFoam;
      varying vec2 vLocal;
      varying vec3 vWorld;
      ${COMMON}
      void main() {
        float rr = length( vLocal ) / uRadius;
        float w1 = sin( length( vLocal ) * 3.1 - uTime * 1.7 );
        float w2 = sin( vWorld.x * 1.9 + vWorld.z * 1.3 + uTime * 1.05 );
        float w3 = sin( vWorld.x * 0.8 - vWorld.z * 2.4 - uTime * 0.7 );
        float h = w1 * 0.3 + w2 * 0.4 + w3 * 0.3;

        vec3 col = mix( uDeep, uShallow, smoothstep( 0.30, 1.05, rr ) );
        float band = step( 0.22, h ) * 0.45 + step( 0.70, h ) * 0.55;
        col = mix( col, uShallow, band * 0.34 );
        col = mix( col, vec3( 1.0 ), smoothstep( 0.90, 0.99, h ) * 0.7 );

        float foam = smoothstep( 0.80, 0.94, rr + h * 0.02 );
        foam *= 1.0 - smoothstep( 0.99, 1.0, rr );
        col = mix( col, uFoam, foam * 0.85 );

        gl_FragColor = vec4( col, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A stepped cascade that follows the terrain: flat stretches where the ground
 * is level, sheer drops where it steps down, foam at the foot of each drop.
 */
function cascadeGeometry(x0, z0, x1, z1, width, steps, yFloor = -Infinity) {
  const pos = [], uv = [], foam = [], idx = [];
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const nx = -dz / len * (width / 2), nz = dx / len * (width / 2);
  let flow = 0;

  const quad = (ax, ay, az, bx, by, bz, v0, v1, f0, f1) => {
    const base = pos.length / 3;
    pos.push(ax + nx, ay, az + nz, ax - nx, ay, az - nz,
             bx - nx, by, bz - nz, bx + nx, by, bz + nz);
    uv.push(0, v0, 1, v0, 1, v1, 0, v1);
    foam.push(f0, f0, f1, f1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  let px = x0, pz = z0;
  let py = Math.max(groundAt(px, pz), yFloor) + 0.09;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t, cz = z0 + dz * t;
    const cy = Math.max(groundAt(cx, cz), yFloor) + 0.09;
    const seg = len / steps;
    quad(px, py, pz, cx, py, cz, flow, flow + seg * 0.5, 0, 0);
    flow += seg * 0.5;
    if (cy < py - 0.06) {
      const drop = py - cy;
      quad(cx, py, cz, cx, cy, cz, flow, flow + drop * 0.5, 0, 1);
      flow += drop * 0.5;
    }
    px = cx; pz = cz; py = cy;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, endX: px, endY: py, endZ: pz };
}

function cascadeMaterial(speed = 1.6) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: windUniforms.uTime,
      uSpeed: { value: speed },
      uTop: { value: new THREE.Color(0xdff8ff) },
      uBody: { value: new THREE.Color(0x5cc4e4) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying float vFoam;
      attribute float aFoam;
      void main() {
        vUv = uv;
        vFoam = aFoam;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSpeed;
      uniform vec3 uTop, uBody;
      varying vec2 vUv;
      varying float vFoam;
      ${COMMON}
      void main() {
        float flow = vUv.y * 2.2 - uTime * uSpeed;
        float s = floor( fract( flow ) * 4.0 ) / 4.0;
        float lane = floor( vUv.x * 5.0 );
        float j = hash12( vec2( lane, floor( flow ) ) );
        float streak = step( 0.4, fract( s + j ) );
        vec3 col = mix( uBody, uTop, streak * 0.75 );
        col = mix( col, vec3( 1.0 ), vFoam * 0.85 );
        float edge = smoothstep( 0.0, 0.12, vUv.x ) * smoothstep( 1.0, 0.88, vUv.x );
        gl_FragColor = vec4( col, ( 0.86 + 0.14 * streak ) * ( 0.35 + 0.65 * edge ) );
        #include <colorspace_fragment>
      }`,
  });
}

function fallMaterial(speed = 1.0, fade = 0.0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: windUniforms.uTime,
      uSpeed: { value: speed },
      uFade: { value: fade },
      uTop: { value: new THREE.Color(0xd8f6ff) },
      uBody: { value: new THREE.Color(0x66c9e6) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSpeed, uFade;
      uniform vec3 uTop, uBody;
      varying vec2 vUv;
      ${COMMON}
      void main() {
        float y = vUv.y;
        float flow = y * 5.0 + uTime * uSpeed;
        // chunky cel streaks falling downward
        float s = floor( fract( flow ) * 4.0 ) / 4.0;
        float lane = floor( vUv.x * 7.0 );
        float j = hash12( vec2( lane, floor( flow ) ) );
        float streak = step( 0.35, fract( s + j ) );

        vec3 col = mix( uBody, uTop, streak * 0.8 + ( 1.0 - y ) * 0.25 );
        // whiter and foamier at the lip and where it lands
        col = mix( col, vec3( 1.0 ), smoothstep( 0.86, 1.0, y ) * 0.8 );
        col = mix( col, vec3( 1.0 ), smoothstep( 0.16, 0.0, y ) * 0.55 * ( 1.0 - uFade ) );

        float edge = smoothstep( 0.0, 0.14, vUv.x ) * smoothstep( 1.0, 0.86, vUv.x );
        float a = 0.92 * edge;
        a *= mix( 1.0, smoothstep( 0.0, 0.55, y ), uFade );  // dissolve into the void
        a *= 0.85 + 0.15 * streak;

        gl_FragColor = vec4( col, a );
        #include <colorspace_fragment>
      }`,
  });
}

export function buildWater(scene) {
  const group = new THREE.Group();
  group.name = 'water';

  // --- pond ---------------------------------------------------------------
  const pondGeo = new THREE.CircleGeometry(CFG.pond.r, 48);
  const pond = new THREE.Mesh(pondGeo, pondMaterial());
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(CFG.pond.x, CFG.pond.water, CFG.pond.z);
  pond.renderOrder = 1;
  group.add(pond);

  // --- cascade tumbling off the ridge into the pond -----------------------
  const r = CFG.ridge;
  const rmx = (r.ax + r.bx) / 2, rmz = (r.az + r.bz) / 2;
  let ux = rmx - CFG.pond.x, uz = rmz - CFG.pond.z;
  const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul;
  // walk up the slope until we are clearly above the pond: that is the lip
  let lipT = CFG.pond.r + 1.0;
  for (let t = CFG.pond.r; t < 11; t += 0.3) {
    if (groundAt(CFG.pond.x + ux * t, CFG.pond.z + uz * t) > CFG.pond.water + 3.4) {
      lipT = t + 1.1;
      break;
    }
    lipT = t;
  }
  const topX = CFG.pond.x + ux * lipT, topZ = CFG.pond.z + uz * lipT;
  const botX = CFG.pond.x + ux * (CFG.pond.r - 1.2), botZ = CFG.pond.z + uz * (CFG.pond.r - 1.2);
  const casc = cascadeGeometry(topX, topZ, botX, botZ, 2.3, 26, CFG.pond.water);
  const cascMesh = new THREE.Mesh(casc.geometry, cascadeMaterial(1.7));
  cascMesh.renderOrder = 2;
  group.add(cascMesh);

  // splash pool where it lands
  const splash = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 24),
    new THREE.MeshBasicMaterial({ color: 0xf2feff, transparent: true, opacity: 0.5 }),
  );
  splash.rotation.x = -Math.PI / 2;
  splash.position.set(botX, CFG.pond.water + 0.05, botZ);
  splash.renderOrder = 3;
  group.add(splash);

  // --- overflow running down the carved channel and off the rim -----------
  const ang = Math.atan2(CFG.pond.z, CFG.pond.x);
  const ox = Math.cos(ang), oz = Math.sin(ang);
  let rimT = CFG.pond.r;
  for (let t = CFG.pond.r; t < 16; t += 0.25) {
    if (!isLand(CFG.pond.x + ox * t, CFG.pond.z + oz * t)) break;
    rimT = t;
  }
  const chan = cascadeGeometry(
    CFG.pond.x + ox * (CFG.pond.r - 0.8), CFG.pond.z + oz * (CFG.pond.r - 0.8),
    CFG.pond.x + ox * (rimT + 0.4), CFG.pond.z + oz * (rimT + 0.4),
    1.9, 30,
  );
  const chanMesh = new THREE.Mesh(chan.geometry, cascadeMaterial(1.2));
  chanMesh.renderOrder = 2;
  group.add(chanMesh);

  const ex = chan.endX, ez = chan.endZ, ey = chan.endY;
  const edgeFall = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 40), fallMaterial(2.6, 1.0));
  edgeFall.position.set(ex, ey - 20, ez);
  edgeFall.rotation.y = -ang + Math.PI / 2;
  group.add(edgeFall);
  const edgeFall2 = new THREE.Mesh(edgeFall.geometry, edgeFall.material);
  edgeFall2.position.copy(edgeFall.position);
  edgeFall2.rotation.y = edgeFall.rotation.y + Math.PI / 2;
  edgeFall2.scale.x = 0.55;
  group.add(edgeFall2);

  scene.add(group);
  return {
    group,
    fallBase: new THREE.Vector3(botX, CFG.pond.water, botZ),
    edgeTop: new THREE.Vector3(ex, ey, ez),
  };
}
