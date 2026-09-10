// Orthographic isometric rig: drag to orbit, wheel to zoom, lazy follow.
import * as THREE from '../vendor/three/three.module.js';
import { clamp, damp } from './lib/math.js';

const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);   // the true isometric angle

export function createCameraRig(dom) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -600, 1400);
  camera.position.set(1, 1, 1);

  const rig = {
    camera,
    target: new THREE.Vector3(0, 0, 0),
    focus: new THREE.Vector3(0, 0, 0),
    azimuth: Math.PI * 0.25,
    elevation: ISO_ELEVATION,
    viewSize: 12,
    wantView: 12,
    distance: 90,
    aspect: 1,
    dragging: false,
  };

  const pointers = new Map();
  let downAt = null;
  let moved = 0;
  let pinchDist = 0;
  let onClick = null;

  const setSize = (w, h) => {
    rig.aspect = w / h;
    applyFrustum();
  };

  function applyFrustum() {
    const hh = rig.viewSize;
    const hw = hh * rig.aspect;
    camera.left = -hw; camera.right = hw;
    camera.top = hh; camera.bottom = -hh;
    camera.updateProjectionMatrix();
  }

  dom.addEventListener('pointerdown', (e) => {
    dom.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      moved = 0;
      rig.dragging = true;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  dom.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) rig.wantView = clamp(rig.wantView * (pinchDist / d), 7, 40);
      pinchDist = d;
      moved += 50;
      return;
    }
    if (!rig.dragging) return;
    moved += Math.abs(dx) + Math.abs(dy);
    rig.azimuth -= dx * 0.0062;
    rig.elevation = clamp(rig.elevation + dy * 0.0042, 0.22, 1.32);
  });

  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      rig.dragging = false;
      const dt = performance.now() - (downAt ? downAt.t : 0);
      if (moved < 7 && dt < 600 && onClick) onClick(e);
      downAt = null;
    }
  };
  dom.addEventListener('pointerup', release);
  dom.addEventListener('pointercancel', release);
  dom.addEventListener('lostpointercapture', release);

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaY, -200, 200) * 0.0013);
    rig.wantView = clamp(rig.wantView * k, 7, 40);
  }, { passive: false });

  const off = new THREE.Vector3();

  rig.update = (dt) => {
    // lazy follow: the camera drifts toward the digger instead of sticking to them
    rig.target.x += (rig.focus.x - rig.target.x) * damp(2.4, dt);
    rig.target.y += (rig.focus.y + 1.0 - rig.target.y) * damp(1.8, dt);
    rig.target.z += (rig.focus.z - rig.target.z) * damp(2.4, dt);

    const prev = rig.viewSize;
    rig.viewSize += (rig.wantView - rig.viewSize) * damp(7, dt);
    if (Math.abs(prev - rig.viewSize) > 1e-4) applyFrustum();

    const ce = Math.cos(rig.elevation);
    off.set(
      Math.cos(rig.azimuth) * ce,
      Math.sin(rig.elevation),
      Math.sin(rig.azimuth) * ce,
    ).multiplyScalar(rig.distance);
    camera.position.copy(rig.target).add(off);
    camera.lookAt(rig.target);
  };

  rig.setSize = setSize;
  rig.onClick = (fn) => { onClick = fn; };
  return rig;
}
