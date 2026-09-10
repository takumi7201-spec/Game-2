import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Wet stone floor with true planar reflection.
// The reflection RT is rendered from a mirrored camera each frame (half res) and
// sampled projectively; puddle mask decides mirror-sharp vs blurry-damp vs matte.
// ---------------------------------------------------------------------------

const GROUND_VERT = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 vRefUv;
  varying vec3 vWPos;
`;

export class WetGround {
  constructor(size = 200, resScale = 0.55) {
    this.size = size;
    this.resScale = resScale;
    this.reflectionRT = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, samples: 0, depthBuffer: true,
    });
    this.textureMatrix = new THREE.Matrix4();
    this.mirrorCam = new THREE.PerspectiveCamera();
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.0);

    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1.0, metalness: 0.0, dithering: true,
    });
    this.uniforms = null;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tReflect = { value: this.reflectionRT.texture };
      shader.uniforms.textureMatrix = { value: this.textureMatrix };
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uRain = { value: 1.0 };
      shader.uniforms.uWetness = { value: 1.0 };
      shader.uniforms.uPuddleTint = { value: new THREE.Color(0x0d1622) };
      shader.uniforms.uArena = { value: 22.0 };
      this.uniforms = shader.uniforms;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GROUND_VERT}`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vRefUv = textureMatrix * vec4(transformed, 1.0);`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tReflect;
          uniform float uTime, uRain, uWetness, uArena;
          uniform vec3 uPuddleTint;
          varying vec4 vRefUv;
          varying vec3 vWPos;

          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          vec2 h22(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))))*43758.5453); }
          float vnoise2(vec2 p){
            vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(h21(i), h21(i+vec2(1,0)), f.x),
                       mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
          }
          float fbm(vec2 p){
            float v = 0.0, a = 0.5;
            for(int i=0;i<5;i++){ v += a*vnoise2(p); p *= 2.03; a *= 0.5; }
            return v;
          }
          // expanding rain rings, one seeded per cell of a jittered grid
          vec2 ripples(vec2 p, float t){
            vec2 acc = vec2(0.0);
            for(int k=0;k<2;k++){
              float sc = 1.6 + float(k)*1.1;
              vec2 gp = p*sc;
              vec2 id = floor(gp);
              vec2 fp = fract(gp) - 0.5;
              for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
                vec2 o = vec2(float(x), float(y));
                vec2 rnd = h22(id+o+float(k)*37.0);
                vec2 cpos = o + rnd - 0.5 - fp;
                float d = length(cpos);
                float phase = fract(t*0.75 + rnd.x*7.13 + rnd.y*3.7);
                float r = phase*0.62;
                float ring = smoothstep(0.055, 0.0, abs(d-r)) * (1.0-phase) * (1.0-phase);
                acc += normalize(cpos + 1e-5) * ring * 0.55;
              }
            }
            return acc;
          }`)
        // ------------------------------------------------- procedural albedo
        .replace('#include <color_fragment>', `
          vec2 wp = vWPos.xz;
          vec2 cell = floor(wp);
          float cr = h21(cell);
          vec2 fcell = fract(wp);
          // grout / voxel-tile seams
          float seam = min(min(fcell.x, 1.0-fcell.x), min(fcell.y, 1.0-fcell.y));
          float seamMask = smoothstep(0.0, 0.055, seam);
          float grain = fbm(wp*7.0)*0.5 + fbm(wp*31.0)*0.25;
          vec3 stoneA = vec3(0.128, 0.132, 0.146);
          vec3 stoneB = vec3(0.074, 0.079, 0.094);
          vec3 stone = mix(stoneB, stoneA, cr*0.75 + grain*0.55);
          // dirt / sand drift toward the dig area
          float dirt = smoothstep(0.55, 0.95, fbm(wp*0.22 + 3.1));
          stone = mix(stone, vec3(0.152,0.118,0.083), dirt*0.55);
          stone *= 0.82 + 0.30*seamMask;
          diffuseColor.rgb *= stone;`)
        // ------------------------------------------------ puddle + roughness
        .replace('#include <roughnessmap_fragment>', `
          float low = fbm(wp*0.29 + 11.0);
          float lowFine = fbm(wp*1.15 + 4.0);
          float radial = smoothstep(uArena*1.85, uArena*0.55, length(wp));
          float puddle = smoothstep(0.47, 0.60, low*0.78 + lowFine*0.30) * mix(0.35, 1.0, radial);
          puddle *= uWetness;
          float damp = clamp(smoothstep(0.30, 0.62, low*0.8+lowFine*0.3)*uWetness, 0.0, 1.0);
          float roughnessFactor = mix(mix(0.88, 0.34, damp), 0.045, puddle);
          roughnessFactor = clamp(roughnessFactor - seamMask*0.0 + (grain-0.4)*0.10*(1.0-puddle), 0.03, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*0.42 + uPuddleTint*0.55, damp*0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPuddleTint*0.85, puddle*0.88);`)
        .replace('#include <metalnessmap_fragment>', `
          float metalnessFactor = metalness;`)
        // ------------------------------------------------------ ripple normal
        .replace('#include <normal_fragment_maps>', `
          vec2 rip = ripples(wp, uTime) * uRain;
          vec2 microWave = vec2(
            fbm(wp*3.1 + vec2(uTime*0.06, 0.0)) - 0.5,
            fbm(wp*3.1 + vec2(0.0, uTime*0.05)) - 0.5) * 0.35;
          vec3 wet = normalize(vec3(-(rip.x + microWave.x*damp), 1.0, -(rip.y + microWave.y*damp)));
          // dry stone still gets a little bump so it is not a mirror-flat plane
          vec2 dryB = vec2(fbm(wp*9.0+0.3)-fbm(wp*9.0-0.3), fbm(wp*9.0+2.7)-fbm(wp*9.0-2.7));
          vec3 dryN = normalize(vec3(-dryB.x*1.6, 1.0, -dryB.y*1.6));
          normal = normalize(mix(dryN, wet, clamp(puddle + damp*0.55, 0.0, 1.0)));`)
        // ------------------------------------------------- projected reflection
        .replace('#include <opaque_fragment>', `
          {
            vec2 ruv = vRefUv.xy / max(vRefUv.w, 1e-4);
            float blur = mix(0.030, 0.0016, clamp(puddle*1.15, 0.0, 1.0));
            vec2 dist = (rip*0.85 + microWave*0.6) * mix(0.010, 0.040, puddle);
            vec3 refl = vec3(0.0);
            const int TAPS = 5;
            vec2 offs[5];
            offs[0] = vec2(0.0);
            offs[1] = vec2( 1.0, 0.55);
            offs[2] = vec2(-0.85, 0.9);
            offs[3] = vec2(-0.9,-0.75);
            offs[4] = vec2( 0.8,-1.0);
            float wsum = 0.0;
            for(int i=0;i<TAPS;i++){
              float w = (i==0) ? 2.0 : 1.0;
              vec2 uv2 = clamp(ruv + dist + offs[i]*blur, vec2(0.002), vec2(0.998));
              refl += texture2D(tReflect, uv2).rgb * w;
              wsum += w;
            }
            refl /= wsum;
            float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            float fres = pow(1.0 - ndv, 4.0);
            float strength = clamp(puddle*1.0 + damp*0.30, 0.0, 1.0);
            float amount = clamp(mix(0.035, 0.60, fres) * strength * 1.9, 0.0, 0.9);
            // reflections read cooler and slightly crushed, like real water
            refl = refl * vec3(0.86, 0.93, 1.06);
            outgoingLight = mix(outgoingLight, outgoingLight*0.30 + refl, amount);
          }
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'wetground';

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'wetground';
    this.mesh.renderOrder = -1;
  }

  setSize(w, h, renderer) {
    const pr = renderer.getPixelRatio();
    const rw = Math.max(2, Math.floor(w * pr * this.resScale));
    const rh = Math.max(2, Math.floor(h * pr * this.resScale));
    if (this.reflectionRT.width !== rw || this.reflectionRT.height !== rh) {
      this.reflectionRT.setSize(rw, rh);
    }
  }

  update(renderer, scene, camera, time, hidden = []) {
    if (this.uniforms) this.uniforms.uTime.value = time;

    const m = this.mirrorCam;
    m.copy(camera);
    m.position.set(camera.position.x, -camera.position.y, camera.position.z);
    // mirror the camera basis across y = 0
    const e = camera.matrixWorld.elements;
    const up = new THREE.Vector3(e[4], -e[5], e[6]);
    const fwd = new THREE.Vector3(-e[8], e[9], -e[10]);
    m.up.copy(up);
    m.lookAt(m.position.clone().add(fwd));
    m.updateMatrixWorld(true);
    m.projectionMatrix.copy(camera.projectionMatrix);

    // oblique near plane clip so nothing below the floor leaks into the mirror
    const clip = this.clipPlane.clone().applyMatrix4(m.matrixWorldInverse);
    const cp = new THREE.Vector4(clip.normal.x, clip.normal.y, clip.normal.z, clip.constant);
    const proj = m.projectionMatrix;
    const q = new THREE.Vector4(
      (Math.sign(cp.x) + proj.elements[8]) / proj.elements[0],
      (Math.sign(cp.y) + proj.elements[9]) / proj.elements[5],
      -1.0,
      (1.0 + proj.elements[10]) / proj.elements[14]);
    const c = cp.multiplyScalar(2.0 / cp.dot(q));
    proj.elements[2] = c.x; proj.elements[6] = c.y;
    proj.elements[10] = c.z + 1.0; proj.elements[14] = c.w;

    this.textureMatrix.set(0.5,0,0,0.5, 0,0.5,0,0.5, 0,0,0.5,0.5, 0,0,0,1);
    this.textureMatrix.multiply(m.projectionMatrix);
    this.textureMatrix.multiply(m.matrixWorldInverse);
    this.textureMatrix.multiply(this.mesh.matrixWorld);

    const groundVis = this.mesh.visible;
    this.mesh.visible = false;
    const prevVis = hidden.map(o => o.visible);
    hidden.forEach(o => { o.visible = false; });

    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.reflectionRT);
    renderer.clear();
    renderer.render(scene, m);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.enabled = prevShadow;

    this.mesh.visible = groundVis;
    hidden.forEach((o, i) => { o.visible = prevVis[i]; });
  }
}
