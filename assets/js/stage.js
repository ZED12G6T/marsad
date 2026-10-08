// Renderer + post-processing + adaptive resolution shared by every exhibit.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY_SCALE = { low: 0.5, medium: 0.75, high: 1 };

export const QUALITY_OPTIONS = [
  { value: 'auto', label: 'تلقائي' },
  { value: 'low', label: 'خفيفة' },
  { value: 'medium', label: 'متوسطة' },
  { value: 'high', label: 'عالية' },
];

export function createStage(opts = {}) {
  const { bloom = null, exposure = 1, startScale = 0.75, minScale = 0.33, maxPixelRatio = 2 } = opts;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: true, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve,
  });
  if (!gl) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  document.getElementById('stage').append(canvas);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.Camera());
  composer.addPass(renderPass);
  let bloomPass = null;
  if (bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), bloom.strength, bloom.radius, bloom.threshold);
    composer.addPass(bloomPass);
  }
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const basePR = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  let scale = startScale;
  let quality = 'auto';
  let ceiling = 1;
  let locked = false;
  const size = new THREE.Vector2();
  const resizeCbs = [];

  function apply() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = basePR * scale;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    renderer.getDrawingBufferSize(size);
    for (const cb of resizeCbs) cb(size.x, size.y, w, h);
  }
  window.addEventListener('resize', apply);

  let last = 0, ema = 16.7, cool = 1500, relax = 0, update = null;
  function adapt(dt) {
    cool -= dt;
    relax += dt;
    if (relax > 8000) { ceiling = Math.min(1, ceiling + 0.04); relax = 0; }
    if (cool > 0) return;
    if (ema > 23.5 && scale > minScale) {
      ceiling = Math.max(minScale, scale * 0.97);
      scale = Math.max(minScale, scale * 0.84);
      apply();
      cool = 1100;
    } else if (ema < 17.6 && scale < Math.min(1, ceiling)) {
      scale = Math.min(1, ceiling, scale * 1.07);
      apply();
      cool = 1600;
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 16.7;
    if (document.hidden) return;
    ema += (dt - ema) * 0.08;
    if (quality === 'auto' && !locked) adapt(dt);
    update(dt / 1000, now / 1000);
  }

  const stage = {
    THREE, renderer, composer, renderPass, bloomPass, outputPass, size, canvas,
    get scale() { return scale; },
    get fps() { return 1000 / ema; },
    setScene(scene, camera) { renderPass.scene = scene; renderPass.camera = camera; },
    addPass(pass) { composer.insertPass(pass, composer.passes.indexOf(outputPass)); },
    onResize(cb) { resizeCbs.push(cb); cb(size.x, size.y, window.innerWidth, window.innerHeight); },
    setQuality(q) {
      quality = q;
      if (q !== 'auto') scale = QUALITY_SCALE[q];
      else ceiling = 1;
      apply();
    },
    // Temporarily pin the internal resolution (used for progressive refinement).
    lock(s) { locked = true; if (s !== scale) { scale = s; apply(); } },
    unlock(s) { locked = false; if (s != null && s !== scale) { scale = s; apply(); } },
    render() { composer.render(); },
    start(fn) { update = fn; apply(); requestAnimationFrame(frame); },
    // Debug helper: average GPU time per frame (ms) at the current internal resolution.
    bench(n = 10) {
      const px = new Uint8Array(4);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { update(0.016, performance.now() / 1000); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return { ms: +((performance.now() - t0) / n).toFixed(1), scale: +scale.toFixed(2), w: size.x, h: size.y };
    },
  };
  window.__stage = stage;
  return stage;
}

// Fullscreen quad for ray-marched scenes.
const QUAD_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function shaderQuad(fragmentShader, uniforms) {
  const material = new THREE.ShaderMaterial({
    vertexShader: QUAD_VS, fragmentShader, uniforms, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, camera, material, mesh };
}

export function cameraUniforms() {
  return {
    uCamPos: { value: new THREE.Vector3() },
    uCamWorld: { value: new THREE.Matrix4() },
    uProjInv: { value: new THREE.Matrix4() },
  };
}

export function syncCamera(u, cam) {
  cam.updateMatrixWorld();
  u.uCamPos.value.copy(cam.position);
  u.uCamWorld.value.copy(cam.matrixWorld);
  u.uProjInv.value.copy(cam.projectionMatrixInverse);
}

export const RAY_GLSL = /* glsl */`
uniform vec3 uCamPos;
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
vec3 cameraRay(vec2 uv) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(mat3(uCamWorld) * (v.xyz / v.w));
}
`;

// Small tween helper.
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
