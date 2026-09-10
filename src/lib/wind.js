// Shared vertex-shader wind. Drives grass, flowers, foliage and banners so the
// whole meadow breathes with one coherent gust field.
import * as THREE from '../../vendor/three/three.module.js';

export const windUniforms = {
  uTime: { value: 0 },
  // xy = wind direction, z = strength (animated gusts)
  uWind: { value: new THREE.Vector3(0.82, 0.57, 1.0) },
  // xyz = player position, w = push radius
  uPlayer: { value: new THREE.Vector4(0, 0, 0, 1.35) },
};

export const WIND_GLSL = /* glsl */`
uniform float uTime;
uniform vec3 uWind;
uniform vec4 uPlayer;

vec2 windBend( vec3 wOrigin, float h ) {
  float phase = wOrigin.x * 0.55 + wOrigin.z * 0.42;
  float gust = sin( uTime * 0.55 - ( wOrigin.x * 0.11 + wOrigin.z * 0.09 ) );
  gust = gust * 0.5 + 0.5;
  gust *= gust;
  float amp = ( 0.10 + gust * 0.42 ) * uWind.z;
  float s = sin( uTime * 2.1 + phase ) * 0.6 + sin( uTime * 3.6 + phase * 1.7 ) * 0.25;
  float b = s * amp * h * h;
  return vec2( b * uWind.x, b * uWind.y );
}
`;

/**
 * GLSL that bends `transformed`.
 * mode 'instance' - pivot from the instance matrix, bend height from local Y
 * mode 'object'   - pivot from the model matrix
 * mode 'attribute'- pivot/bend read from aPivot/aSway (merged foliage batches)
 */
export function windDisplaceGLSL(opts = {}) {
  const { mode = 'instance', height = 1, push = true, rigidity = 0, strength = 1 } = opts;
  const origin = {
    instance: '( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz',
    object: '( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz',
    attribute: 'aPivot',
  }[mode];
  const bh = mode === 'attribute'
    ? 'aSway'
    : `clamp( transformed.y / ${height.toFixed(4)}, 0.0, 1.0 )`;
  return /* glsl */`
    vec3 wOrigin = ${origin};
    float bh = ${bh};
    bh = mix( bh, bh * bh, ${rigidity.toFixed(3)} );
    vec2 bend = windBend( wOrigin, bh ) * ${strength.toFixed(3)};
    transformed.x += bend.x;
    transformed.z += bend.y;
    transformed.y -= length( bend ) * 0.28 * bh;
    ${push ? /* glsl */`
    vec3 toP = wOrigin - uPlayer.xyz;
    toP.y = 0.0;
    float dp = length( toP );
    float pushK = smoothstep( uPlayer.w, uPlayer.w * 0.25, dp );
    if ( pushK > 0.001 ) {
      vec2 dir = normalize( toP.xz + vec2( 1e-4 ) );
      transformed.xz += dir * pushK * bh * bh * 0.55;
      transformed.y -= pushK * bh * 0.22;
    }` : ''}
  `;
}

const attrDecl = (mode) => (mode === 'attribute' ? 'attribute vec3 aPivot;\nattribute float aSway;' : '');

/** Patch any lit material so its vertices ride the wind field. */
export function applyWind(material, opts = {}) {
  const key = 'wind|' + JSON.stringify(opts);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.uniforms.uPlayer = windUniforms.uPlayer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${attrDecl(opts.mode)}\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${windDisplaceGLSL(opts)}`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/** Ink outline that bends with exactly the same wind, so hulls stay glued on. */
export function windOutlineMaterial(thickness, color, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) },
      uTime: windUniforms.uTime,
      uWind: windUniforms.uWind,
      uPlayer: windUniforms.uPlayer,
    },
    side: THREE.BackSide,
    vertexShader: /* glsl */`
      uniform float uThickness;
      attribute vec3 aExpand;
      ${attrDecl(opts.mode)}
      #include <common>
      ${WIND_GLSL}
      void main() {
        vec3 transformed = position + aExpand * uThickness;
        ${windDisplaceGLSL(opts)}
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      #include <common>
      void main() {
        gl_FragColor = vec4( uColor, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
}
