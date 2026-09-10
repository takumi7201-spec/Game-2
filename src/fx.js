import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Atmosphere: rain streaks, embers, fog sheets, fireflies, bats, hit sparks.
// All GPU-animated in the vertex shader -> effectively free on the CPU.
// ---------------------------------------------------------------------------

export function makeRain(scene, count = 5200, area = 46, height = 30) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const len = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area * 2;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area * 2;
    seed[i] = Math.random();
    len[i] = 0.5 + Math.random() * 1.1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uH: { value: height }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 1 } },
    vertexShader: `
      attribute float aSeed, aLen;
      uniform float uTime, uH, uAmount;
      uniform vec3 uCam;
      varying float vA;
      void main(){
        vec3 p = position;
        float sp = 14.0 + aSeed*10.0;
        p.y = mod(p.y - uTime*sp, uH);
        p.x += sin(uTime*0.4 + aSeed*6.28)*0.8 + p.y*0.06;
        p.z += cos(uTime*0.33 + aSeed*6.28)*0.6;
        p.x = mod(p.x - uCam.x + 46.0, 92.0) - 46.0 + uCam.x;
        p.z = mod(p.z - uCam.z + 46.0, 92.0) - 46.0 + uCam.z;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (aLen * 34.0) / max(0.5, -mv.z) * 5.0;
        gl_PointSize = clamp(gl_PointSize, 1.0, 9.0);
        vA = (0.20 + aSeed*0.26) * uAmount * smoothstep(0.0, 3.0, p.y);
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, abs(c.x)*3.4) * smoothstep(0.5, 0.05, abs(c.y));
        gl_FragColor = vec4(vec3(0.62,0.74,0.95), a * vA);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 5;
  scene.add(p);
  return { points: p, mat: m };
}

export function makeEmbers(scene, origin, count = 320) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = origin.x + (Math.random() - 0.5) * 1.6;
    pos[i * 3 + 1] = Math.random() * 12;
    pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 1.6;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aSeed; uniform float uTime; varying float vA; varying float vS;
      void main(){
        vec3 p = position;
        float life = mod(uTime*(0.30+aSeed*0.35) + aSeed, 1.0);
        p.y = 0.5 + life*11.0;
        p.x += sin(uTime*(0.8+aSeed*1.6) + aSeed*20.0) * (0.5 + life*2.6);
        p.z += cos(uTime*(0.6+aSeed*1.3) + aSeed*13.0) * (0.5 + life*2.6);
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((2.4+aSeed*3.0)*22.0/max(0.5,-mv.z), 1.0, 14.0);
        vA = (1.0-life)*(1.0-life)*0.9; vS = aSeed;
      }`,
    fragmentShader: `
      varying float vA; varying float vS;
      void main(){
        float d = length(gl_PointCoord-0.5);
        float a = smoothstep(0.5,0.0,d);
        vec3 c = mix(vec3(1.0,0.42,0.10), vec3(1.0,0.86,0.45), vS);
        gl_FragColor = vec4(c, a*vA);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.renderOrder = 6;
  scene.add(p);
  return { points: p, mat: m };
}

export function makeFireflies(scene, count = 180, area = 24) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area * 2;
    pos[i * 3 + 1] = 0.6 + Math.random() * 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area * 2;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aSeed; uniform float uTime; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*(0.25+aSeed*0.4) + aSeed*30.0)*2.4;
        p.y += sin(uTime*(0.5+aSeed*0.6) + aSeed*11.0)*0.8;
        p.z += cos(uTime*(0.22+aSeed*0.36) + aSeed*17.0)*2.4;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = clamp(2.6*24.0/max(0.5,-mv.z), 1.0, 10.0);
        vA = pow(0.5+0.5*sin(uTime*2.2 + aSeed*40.0), 3.0)*0.85;
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        float d = length(gl_PointCoord-0.5);
        gl_FragColor = vec4(vec3(0.62,1.0,0.72), smoothstep(0.5,0.0,d)*vA);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.renderOrder = 6;
  scene.add(p);
  return { points: p, mat: m };
}

// Drifting ground fog: a few big soft quads that slowly slide and fade.
export function makeFogSheets(scene, count = 22) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec4 aInst;  // x,z,scale,seed
      uniform float uTime;
      varying vec2 vUv; varying float vS;
      void main(){
        vUv = uv; vS = aInst.w;
        float dx = sin(uTime*0.06 + aInst.w*20.0)*7.0;
        float dz = cos(uTime*0.045 + aInst.w*13.0)*6.0;
        vec3 p = position * aInst.z;
        // billboard around Y
        vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 wp = vec3(aInst.x + dx, 0.55 + sin(uTime*0.3+aInst.w*9.0)*0.3, aInst.y + dz)
                  + right*p.x + up*p.y*0.55;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv; varying float vS; uniform float uTime;
      float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){v+=a*n2(p);p*=2.1;a*=.5;} return v; }
      void main(){
        vec2 c = vUv-0.5;
        float r = smoothstep(0.5, 0.06, length(c));
        float n = fbm(vUv*3.5 + vec2(uTime*0.05 + vS*30.0, uTime*0.03));
        float a = r * smoothstep(0.34, 0.88, n) * 0.115;
        gl_FragColor = vec4(vec3(0.17,0.23,0.34), a);
      }`,
  });
  const inst = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    inst[i * 4] = (Math.random() - 0.5) * 62;
    inst[i * 4 + 1] = (Math.random() - 0.5) * 62;
    inst[i * 4 + 2] = 9 + Math.random() * 13;
    inst[i * 4 + 3] = Math.random();
  }
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = geo.index;
  ig.attributes.position = geo.attributes.position;
  ig.attributes.uv = geo.attributes.uv;
  ig.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
  ig.instanceCount = count;
  const mesh = new THREE.Mesh(ig, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  scene.add(mesh);
  return { mesh, mat };
}

// Bats crossing the sky
export function makeBats(scene, count = 26) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { seed[i] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aSeed; uniform float uTime; varying float vF;
      void main(){
        float t = uTime*(0.055+aSeed*0.05) + aSeed*10.0;
        float r = 26.0 + aSeed*22.0;
        vec3 p = vec3(cos(t*3.0)*r, 15.0 + aSeed*13.0 + sin(t*7.0)*1.6, sin(t*3.0)*r*0.8 - 10.0);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = clamp(4.0*30.0/max(0.5,-mv.z), 1.5, 9.0);
        vF = 0.5+0.5*sin(uTime*16.0 + aSeed*20.0);
      }`,
    fragmentShader: `
      varying float vF;
      void main(){
        vec2 c = (gl_PointCoord-0.5)*2.0;
        float wing = smoothstep(1.0, 0.0, abs(c.y)*(3.0+vF*4.0) + abs(c.x)*0.6);
        float body = smoothstep(0.45,0.0,length(c*vec2(1.6,1.0)));
        float a = clamp(wing*0.55 + body, 0.0, 1.0);
        gl_FragColor = vec4(vec3(0.04,0.05,0.08), a*0.8);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  scene.add(p);
  return { points: p, mat: m };
}

// Pooled burst particles for digs / hits / revival
export class Sparks {
  constructor(scene, max = 900) {
    this.max = max; this.head = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.dat = new Float32Array(max * 3);   // age, life, size
    this.col = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) this.dat[i * 3 + 1] = -1;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aDat', new THREE.BufferAttribute(this.dat, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: {},
      vertexShader: `
        attribute vec3 aDat, aCol; varying float vA; varying vec3 vC;
        void main(){
          float life = aDat.y;
          if (life <= 0.0) { gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; vA=0.0; vC=vec3(0.0); return; }
          float k = clamp(aDat.x/life, 0.0, 1.0);
          vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_Position = projectionMatrix*mv;
          gl_PointSize = clamp(aDat.z*(1.0-k*0.65)*30.0/max(0.5,-mv.z), 1.0, 26.0);
          vA = (1.0-k)*(1.0-k); vC = aCol;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main(){ float d=length(gl_PointCoord-0.5);
          gl_FragColor = vec4(vC, smoothstep(0.5,0.0,d)*vA); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }
  burst(x, y, z, n, color, opts = {}) {
    const spread = opts.spread ?? 3.0;
    const up = opts.up ?? 4.0;
    const life = opts.life ?? 0.9;
    const size = opts.size ?? 2.4;
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.35;
      this.pos[i * 3 + 1] = y + Math.random() * 0.3;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.35;
      const a = Math.random() * Math.PI * 2, s = Math.random() * spread;
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = up * (0.35 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      this.dat[i * 3] = 0;
      this.dat[i * 3 + 1] = life * (0.65 + Math.random() * 0.7);
      this.dat[i * 3 + 2] = size * (0.6 + Math.random() * 0.9);
      const cc = c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      this.col[i * 3] = cc.r; this.col[i * 3 + 1] = cc.g; this.col[i * 3 + 2] = cc.b;
    }
    this.geo.attributes.aCol.needsUpdate = true;
  }
  update(dt) {
    const p = this.pos, v = this.vel, d = this.dat;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (d[i * 3 + 1] <= 0) continue;
      any = true;
      d[i * 3] += dt;
      if (d[i * 3] >= d[i * 3 + 1]) { d[i * 3 + 1] = -1; continue; }
      v[i * 3 + 1] -= 11 * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < 0.05) { p[i * 3 + 1] = 0.05; v[i * 3 + 1] *= -0.32; v[i * 3] *= 0.6; v[i * 3 + 2] *= 0.6; }
    }
    if (any) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aDat.needsUpdate = true; }
  }
}
