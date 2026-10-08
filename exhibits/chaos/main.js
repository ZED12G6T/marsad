import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { createShell, WEBGL_FAIL } from '../../assets/js/shell.js';
import { createStage, QUALITY_OPTIONS } from '../../assets/js/stage.js';

// Strange attractors. Each particle follows dX/dt = F(X) integrated with RK4 on the GPU.
// The same F is mirrored in JavaScript for the two "butterfly" trajectories.
const ATTRACTORS = {
  lorenz: {
    ar: 'لورنز', dt: 0.004, scale: 0.042, center: [0, 0, 27], rot: [-Math.PI / 2, 0, 0],
    glsl: 'return vec3(p1 * (p.y - p.x), p.x * (p2 - p.z) - p.y, p.x * p.y - p3 * p.z);',
    js: (p, [a, b, c]) => [a * (p[1] - p[0]), p[0] * (b - p[2]) - p[1], p[0] * p[1] - c * p[2]],
    params: [10, 28, 8 / 3], spawn: 15,
  },
  aizawa: {
    ar: 'أيزاوا', dt: 0.008, scale: 0.7, center: [0, 0, 0.4], rot: [-Math.PI / 2, 0, 0],
    glsl: 'float a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1; return vec3((p.z - b) * p.x - d * p.y, d * p.x + (p.z - b) * p.y, c + a * p.z - p.z * p.z * p.z / 3.0 - (p.x * p.x + p.y * p.y) * (1.0 + e * p.z) + f * p.z * p.x * p.x * p.x);',
    js: (p) => { const [a, b, c, d, e, f] = [0.95, 0.7, 0.6, 3.5, 0.25, 0.1]; return [(p[2] - b) * p[0] - d * p[1], d * p[0] + (p[2] - b) * p[1], c + a * p[2] - p[2] ** 3 / 3 - (p[0] ** 2 + p[1] ** 2) * (1 + e * p[2]) + f * p[2] * p[0] ** 3]; },
    params: [0, 0, 0], spawn: 1,
  },
  thomas: {
    ar: 'توماس', dt: 0.03, scale: 0.28, center: [0, 0, 0], rot: [0, 0, 0],
    glsl: 'return vec3(sin(p.y) - p1 * p.x, sin(p.z) - p1 * p.y, sin(p.x) - p1 * p.z);',
    js: (p, [b]) => [Math.sin(p[1]) - b * p[0], Math.sin(p[2]) - b * p[1], Math.sin(p[0]) - b * p[2]],
    params: [0.208186, 0, 0], spawn: 3,
  },
  halvorsen: {
    ar: 'هالفورسن', dt: 0.004, scale: 0.12, center: [-2.5, -2.5, -2.5], rot: [0.3, 0.6, 0],
    glsl: 'float a = p1; return vec3(-a * p.x - 4.0 * p.y - 4.0 * p.z - p.y * p.y, -a * p.y - 4.0 * p.z - 4.0 * p.x - p.z * p.z, -a * p.z - 4.0 * p.x - 4.0 * p.y - p.x * p.x);',
    js: (p, [a]) => [-a * p[0] - 4 * p[1] - 4 * p[2] - p[1] ** 2, -a * p[1] - 4 * p[2] - 4 * p[0] - p[2] ** 2, -a * p[2] - 4 * p[0] - 4 * p[1] - p[0] ** 2],
    params: [1.89, 0, 0], spawn: 2,
  },
  dadras: {
    ar: 'دادراس', dt: 0.004, scale: 0.13, center: [0, 0, 0], rot: [-Math.PI / 2, 0, 0],
    glsl: 'float a = 3.0, b = 2.7, c = 1.7, d = 2.0, e = 9.0; return vec3(p.y - a * p.x + b * p.y * p.z, c * p.y - p.x * p.z + p.z, d * p.x * p.y - e * p.z);',
    js: (p) => [p[1] - 3 * p[0] + 2.7 * p[1] * p[2], 1.7 * p[1] - p[0] * p[2] + p[2], 2 * p[0] * p[1] - 9 * p[2]],
    params: [0, 0, 0], spawn: 2,
  },
  chen: {
    ar: 'تشن', dt: 0.003, scale: 0.05, center: [0, 0, 18], rot: [-Math.PI / 2, 0, 0],
    glsl: 'float a = 5.0, b = -10.0, c = -0.38; return vec3(a * p.x - p.y * p.z, b * p.y + p.x * p.z, c * p.z + p.x * p.y / 3.0);',
    js: (p) => [5 * p[0] - p[1] * p[2], -10 * p[1] + p[0] * p[2], -0.38 * p[2] + p[0] * p[1] / 3],
    params: [0, 0, 0], spawn: 6,
  },
  rossler: {
    ar: 'روسلر', dt: 0.012, scale: 0.12, center: [0, 0, 4], rot: [-Math.PI / 2, 0, 0],
    glsl: 'return vec3(-p.y - p.z, p.x + 0.2 * p.y, 0.2 + p.z * (p.x - p1));',
    js: (p, [c]) => [-p[1] - p[2], p[0] + 0.2 * p[1], 0.2 + p[2] * (p[0] - c)],
    params: [5.7, 0, 0], spawn: 4,
  },
  sprott: {
    ar: 'سبروت', dt: 0.006, scale: 0.9, center: [0.3, 0, 0], rot: [-Math.PI / 2, 0, 0],
    glsl: 'float a = 2.07, b = 1.79; return vec3(p.y + a * p.x * p.y + p.x * p.z, 1.0 - b * p.x * p.x + p.y * p.z, p.x - p.x * p.x - p.y * p.y);',
    js: (p) => [p[1] + 2.07 * p[0] * p[1] + p[0] * p[2], 1 - 1.79 * p[0] ** 2 + p[1] * p[2], p[0] - p[0] ** 2 - p[1] ** 2],
    params: [0, 0, 0], spawn: 0.5,
  },
};

const PALETTES = {
  fire: [[0.2, 0.05, 0.6], [1.0, 0.35, 0.1], [1.0, 0.85, 0.5]],
  ice: [[0.05, 0.15, 0.5], [0.2, 0.7, 1.0], [0.9, 0.98, 1.0]],
  brass: [[0.3, 0.12, 0.05], [0.85, 0.6, 0.25], [1.0, 0.95, 0.8]],
  aurora: [[0.35, 0.1, 0.7], [0.1, 0.9, 0.6], [0.95, 1.0, 0.7]],
};

const ui = createShell({
  title: 'الفوضى',
  scale: 'مقياس <bdi class="num">10<sup>4</sup></bdi> متر: خلية من الطقس',
  hint: 'اسحب لتدوير المشهد، وجرّب «أثر الفراشة» من لوحة التحكم',
  readouts: [
    { key: 'name', label: 'الجاذب' },
    { key: 'gap', label: 'الفرق بين مسارَي الفراشة' },
  ],
  controls: [
    { type: 'group', label: 'الجاذب' },
    { type: 'select', key: 'att', value: 'lorenz', options: Object.entries(ATTRACTORS).map(([value, a]) => ({ value, label: a.ar })) },
    { type: 'range', key: 'rho', label: 'ρ (رو)', min: 10, max: 60, step: 0.1, value: 28, format: (v) => v.toFixed(1), when: (v) => v.att === 'lorenz' },
    { type: 'range', key: 'sigma', label: 'σ (سيغما)', min: 4, max: 20, step: 0.1, value: 10, format: (v) => v.toFixed(1), when: (v) => v.att === 'lorenz' },
    { type: 'range', key: 'tb', label: 'b', min: 0.12, max: 0.3, step: 0.001, value: 0.208, format: (v) => v.toFixed(3), when: (v) => v.att === 'thomas' },
    { type: 'range', key: 'ha', label: 'a', min: 1.4, max: 2.2, step: 0.01, value: 1.89, format: (v) => v.toFixed(2), when: (v) => v.att === 'halvorsen' },
    { type: 'range', key: 'rc', label: 'c', min: 3, max: 12, step: 0.05, value: 5.7, format: (v) => v.toFixed(2), when: (v) => v.att === 'rossler' },
    { type: 'group', label: 'أثر الفراشة' },
    { type: 'toggle', key: 'butterfly', label: 'مساران يبدآن متلاصقين', value: false },
    { type: 'buttons', when: (v) => v.butterfly, items: [{ label: 'أعد التجربة', primary: true, action: () => resetButterfly() }] },
    { type: 'group', label: 'العرض' },
    { type: 'range', key: 'speed', label: 'السرعة', min: 0, max: 3, step: 0.05, value: 1, format: (v) => (v === 0 ? 'متوقف' : `×${v.toFixed(2)}`) },
    { type: 'segmented', key: 'pal', label: 'الألوان', value: 'fire', options: [
      { value: 'fire', label: 'نار' }, { value: 'ice', label: 'جليد' }, { value: 'brass', label: 'نحاس' }, { value: 'aurora', label: 'شفق' },
    ] },
    { type: 'segmented', key: 'style', label: 'طريقة الرسم', value: 'threads', options: [
      { value: 'threads', label: 'خيوط: ٣٢٠ مساراً' },
      { value: 'cloud', label: 'سحابة جسيمات' },
    ] },
    { type: 'segmented', key: 'count', label: 'عدد الجسيمات', value: 262144, when: (v) => v.style === 'cloud', options: [
      { value: 65536, label: '65 ألف' },
      { value: 262144, label: '262 ألف' },
      { value: 1048576, label: 'مليون' },
    ] },
    { type: 'toggle', key: 'trails', label: 'أذيال الحركة', value: true },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي', value: true },
    { type: 'segmented', key: 'quality', options: QUALITY_OPTIONS, value: 'auto' },
  ],
  onChange(key, v) {
    if (key === 'att' || key === 'count') build();
    if (key === 'butterfly') { if (v) resetButterfly(); bLines.forEach((l) => (l.visible = v)); }
    if (key === 'trails') after.enabled = v;
    if (key === 'quality') stage.setQuality(v);
  },
  info: `
    <h2>نظام محسوب بالكامل، ولا يمكن التنبؤ به</h2>
    <p>كل جسيم هنا يتبع معادلة بسيطة من ثلاثة أسطر، بلا أي عشوائية. لو عرفت موقعه الآن بدقة تامة لعرفت موقعه بعد مليون سنة. لكن «بدقة تامة» هي المشكلة: أي خطأ صغير في البداية، ولو في الرقم العاشر بعد الفاصلة، يتضاعف بسرعة حتى يصير المساران مختلفين تماماً. هذا هو «الفوضى».</p>
    <h3>لورنز والفراشة</h3>
    <p>عام ١٩٦١ كان عالم الأرصاد إدوارد لورنز يشغّل نموذجاً بسيطاً للطقس على حاسوبه. أعاد حساباً فأدخل رقماً مقرّباً إلى ثلاث خانات بدل ست، فخرج طقس مختلف كلياً بعد أيام قليلة. بسّط نموذجه إلى المعادلات الثلاث التي ترسم هذا الشكل، ثم ألقى عام ١٩٧٢ محاضرته الشهيرة: «هل ترفرف فراشة في البرازيل فتُطلق إعصاراً في تكساس؟». ولهذا لا تتجاوز توقعات الطقس الدقيقة نحو عشرة أيام مهما قويت الحواسيب.</p>
    <h3>جرّب أثر الفراشة</h3>
    <p>فعّل «مساران يبدآن متلاصقين». يبدأ المساران الأزرق والبرتقالي على بعد جزء من مئة مليون من بعضهما، فيسيران معاً كأنهما خط واحد، ثم ينفصلان فجأة ويذهب كل منهما في طريق. راقب رقم «الفرق» أسفل الشاشة.</p>
    <h3>الجاذب الغريب</h3>
    <p>رغم أن الحركة لا يمكن التنبؤ بها، يبقى كل جسيم محبوساً في هذا الشكل لا يغادره، ولا يمر بالنقطة نفسها مرتين. يسمى «جاذباً غريباً»، وهو كائن هندسي ليس سطحاً تماماً ولا حجماً تماماً: بُعده نحو ٢٫٠٦، فهو فراكتل.</p>
    <p>غيّر قيمة ρ في جاذب لورنز: تحت ٢٤٫٧ تقريباً تهدأ الجسيمات في نقطتين ثابتتين، وفوقها تبدأ الفوضى.</p>
  `,
});

const stage = createStage({ bloom: { strength: 0.5, radius: 0.4, threshold: 0.45 }, exposure: 1.0, startScale: 0.85 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const { renderer } = stage;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#020309');
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(2.6, 0.9, 3.0);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.8;
controls.maxDistance = 12;
controls.autoRotateSpeed = 0.6;
stage.setScene(scene, camera);
const after = new AfterimagePass(0.86);
stage.addPass(after);

const group = new THREE.Group();
scene.add(group);

const POINT_VS = /* glsl */`
uniform sampler2D tPos;
uniform vec3 uPal[3];
uniform float uSize;
uniform float uBright;
attribute vec2 ref;
varying vec3 vCol;
void main() {
  vec4 s = texture2D(tPos, ref);
  vec4 mv = modelViewMatrix * vec4(s.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize / -mv.z);
  float k = clamp(s.w, 0.0, 1.0);
  vCol = (k < 0.5 ? mix(uPal[0], uPal[1], k * 2.0) : mix(uPal[1], uPal[2], k * 2.0 - 1.0)) * uBright;
}
`;
const POINT_FS = /* glsl */`
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-d * 3.0), 1.0);
}
`;
const pointUniforms = { tPos: { value: null }, uPal: { value: PALETTES.fire.map((c) => new THREE.Vector3(...c)) }, uSize: { value: 2 }, uBright: { value: 0.2 } };
const pointMat = new THREE.ShaderMaterial({ vertexShader: POINT_VS, fragmentShader: POINT_FS, uniforms: pointUniforms, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

let gpu = null, posVar = null, points = null, A = ATTRACTORS.lorenz, N = 0;

function computeShader(att) {
  // positions live in attractor coordinates; the group transform scales and orients them
  return /* glsl */`
uniform float uDt;
uniform float p1;
uniform float p2;
uniform float p3;
uniform float uSeed;
uniform float uSpawn;
uniform vec3 uCenter;
uniform vec3 uInject;
uniform float uInjectR;
uniform float uRespawn;
vec3 F(vec3 p) { ${att.glsl} }
float hash(vec2 q) { vec3 p3 = fract(vec3(q.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 s = texture2D(texturePosition, uv);
  vec3 p = s.xyz;
  float h = uDt;
  vec3 k1 = F(p), k2 = F(p + 0.5 * h * k1), k3 = F(p + 0.5 * h * k2), k4 = F(p + h * k3);
  vec3 v = (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0;
  p += h * v;
  float speed = length(v);
  // particles that escape (or go NaN for wild parameters) are reborn near the centre
  if (!(abs(p.x) < 1e3 && abs(p.y) < 1e3 && abs(p.z) < 1e3)) {
    p = uCenter + (vec3(hash(uv + uSeed), hash(uv * 1.3 - uSeed), hash(uv * 0.7 + uSeed * 2.0)) - 0.5) * uSpawn;
    speed = 0.0;
  }
  // a steady trickle of particles re-injected at one spot draws continuous threads through the attractor
  if (hash(uv * 1.7 + uSeed * 3.1) < uRespawn) {
    p = uInject + (vec3(hash(uv * 2.3 + uSeed), hash(uv * 3.1 - uSeed), hash(uv * 1.9 + uSeed * 1.3)) - 0.5) * uInjectR;
  }
  gl_FragColor = vec4(p, mix(s.w, clamp(speed * ${(1 / (att.spawn * 4)).toFixed(4)}, 0.0, 1.0), 0.15));
}
`;
}

function params() {
  const v = ui.values;
  const key = v.att;
  if (key === 'lorenz') return [v.sigma, v.rho, 8 / 3];
  if (key === 'thomas') return [v.tb, 0, 0];
  if (key === 'halvorsen') return [v.ha, 0, 0];
  if (key === 'rossler') return [v.rc, 0, 0];
  return A.params;
}

function build() {
  A = ATTRACTORS[ui.values.att];
  N = ui.values.count;
  const W = Math.sqrt(N);
  if (gpu) gpu.dispose();
  if (points) { group.remove(points); points.geometry.dispose(); }
  gpu = new GPUComputationRenderer(W, W, renderer);
  gpu.setDataType(THREE.FloatType);
  const t0 = gpu.createTexture();
  const d = t0.image.data;
  for (let i = 0; i < N; i++) {
    d[i * 4] = A.center[0] + (Math.random() - 0.5) * A.spawn;
    d[i * 4 + 1] = A.center[1] + (Math.random() - 0.5) * A.spawn;
    d[i * 4 + 2] = A.center[2] + (Math.random() - 0.5) * A.spawn;
    d[i * 4 + 3] = 0;
  }
  posVar = gpu.addVariable('texturePosition', computeShader(A), t0);
  gpu.setVariableDependencies(posVar, [posVar]);
  // injection point: somewhere on the attractor itself, found by integrating a probe until it settles
  let probe = [A.center[0] + A.spawn * 0.13, A.center[1] + A.spawn * 0.07, A.center[2] + A.spawn * 0.11];
  for (let i = 0; i < 3000; i++) probe = rk4(probe, A.dt);
  Object.assign(posVar.material.uniforms, {
    uDt: { value: A.dt }, p1: { value: 0 }, p2: { value: 0 }, p3: { value: 0 }, uSeed: { value: 0 }, uSpawn: { value: A.spawn },
    uCenter: { value: new THREE.Vector3(...A.center) }, uInject: { value: new THREE.Vector3(...probe) }, uInjectR: { value: A.spawn * 0.1 }, uRespawn: { value: 0 },
  });
  const err = gpu.init();
  if (err) { console.error(err); ui.fail('تعذّر تشغيل المحاكاة على كرت الشاشة هذا.'); return; }
  // let the cloud settle onto the attractor before showing it
  const p = params();
  Object.assign(posVar.material.uniforms, { p1: { value: p[0] }, p2: { value: p[1] }, p3: { value: p[2] } });
  for (let i = 0; i < 300; i++) gpu.compute();

  const ref = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { ref[i * 2] = ((i % W) + 0.5) / W; ref[i * 2 + 1] = (Math.floor(i / W) + 0.5) / W; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
  points = new THREE.Points(g, pointMat);
  points.frustumCulled = false;
  group.add(points);
  group.scale.setScalar(A.scale);
  group.rotation.set(...A.rot);
  group.position.set(-A.center[0] * A.scale, 0, 0);
  group.updateMatrixWorld();
  // centre the attractor in view
  const c = new THREE.Vector3(...A.center).applyMatrix4(group.matrixWorld);
  group.position.sub(c);
  pointUniforms.uBright.value = 0.12 * Math.pow(262144 / N, 0.7);
  sizePoints();
  ui.readout('name', `جاذب ${A.ar}`);
  if (typeof seedThreads === 'function' && threadsReady) seedThreads();
  if (ui.values.butterfly) resetButterfly();
}
let threadsReady = false;
function sizePoints() { pointUniforms.uSize.value = (stage.size.y / 720) * 2.4 * Math.pow(262144 / N, 0.25); }

// ---------------------------------------------------------------- the two butterfly trajectories (CPU, RK4)
const BTR = 3000;
const bLines = [0, 1].map((i) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BTR * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const col = new Float32Array(BTR * 3);
  const c = i ? new THREE.Color(2.2, 0.9, 0.3) : new THREE.Color(0.4, 0.9, 2.4);
  for (let j = 0; j < BTR; j++) { const f = Math.pow(1 - j / BTR, 1.3); col.set([c.r * f, c.g * f, c.b * f], j * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  l.frustumCulled = false;
  l.visible = false;
  group.add(l);
  return l;
});
const bfly = { p: [[0, 0, 0], [0, 0, 0]], n: 0, t: 0 };
function resetButterfly() {
  const s = [A.center[0] + A.spawn * 0.13, A.center[1] + A.spawn * 0.07, A.center[2] + A.spawn * 0.11];
  // settle onto the attractor first, then split by one part in 10⁸
  let p = s;
  for (let i = 0; i < 4000; i++) p = rk4(p, A.dt);
  bfly.p = [p.slice(), [p[0] + 1e-8, p[1], p[2]]];
  bfly.n = 0;
  bfly.t = 0;
  for (const l of bLines) { const a = l.geometry.attributes.position.array; for (let j = 0; j < BTR; j++) a.set(p, j * 3); l.geometry.attributes.position.needsUpdate = true; }
}
function rk4(p, h) {
  const prm = params();
  const f = (q) => A.js(q, prm);
  const k1 = f(p);
  const k2 = f(p.map((x, i) => x + 0.5 * h * k1[i]));
  const k3 = f(p.map((x, i) => x + 0.5 * h * k2[i]));
  const k4 = f(p.map((x, i) => x + h * k3[i]));
  return p.map((x, i) => x + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

// ---------------------------------------------------------------- threads: hundreds of trajectories drawn as fading lines
const TT = 320, TL = 420;
const thrPos = new Float32Array(TT * TL * 3);
const thrCol = new Float32Array(TT * TL * 3);
const thrHead = Array.from({ length: TT }, () => [0, 0, 0]);
const threads = (() => {
  const idx = new Uint32Array(TT * (TL - 1) * 2);
  let o = 0;
  for (let t = 0; t < TT; t++) for (let j = 0; j < TL - 1; j++) { idx[o++] = t * TL + j; idx[o++] = t * TL + j + 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(thrPos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(thrCol, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  l.frustumCulled = false;
  group.add(l);
  return l;
})();
let thrPal = '';
function paintThreads(pal) {
  const P = PALETTES[pal].map((c) => new THREE.Color(...c));
  const c = new THREE.Color();
  for (let t = 0; t < TT; t++) {
    const k = t / (TT - 1);
    if (k < 0.5) c.copy(P[0]).lerp(P[1], k * 2); else c.copy(P[1]).lerp(P[2], k * 2 - 1);
    for (let j = 0; j < TL; j++) {
      const f = Math.pow(1 - j / TL, 1.6) * 0.2;
      thrCol.set([c.r * f, c.g * f, c.b * f], (t * TL + j) * 3);
    }
  }
  threads.geometry.attributes.color.needsUpdate = true;
  thrPal = pal;
}
function seedThreads() {
  for (let t = 0; t < TT; t++) {
    let p = [A.center[0] + (Math.random() - 0.5) * A.spawn, A.center[1] + (Math.random() - 0.5) * A.spawn, A.center[2] + (Math.random() - 0.5) * A.spawn];
    // settle onto the attractor, each for a different time so they spread along it
    const n = 300 + Math.floor(Math.random() * 500);
    for (let i = 0; i < n; i++) p = rk4(p, A.dt);
    if (!p.every(Number.isFinite)) p = A.center.slice();
    thrHead[t] = p;
    for (let j = 0; j < TL; j++) thrPos.set(p, (t * TL + j) * 3);
  }
  threads.geometry.attributes.position.needsUpdate = true;
}
function stepThreads(sub) {
  for (let t = 0; t < TT; t++) {
    let p = thrHead[t];
    for (let k = 0; k < sub; k++) p = rk4(p, A.dt);
    if (!p.every((x) => Number.isFinite(x) && Math.abs(x) < 1e3)) p = [A.center[0] + Math.random() * 0.1, A.center[1], A.center[2]];
    thrHead[t] = p;
    const base = t * TL * 3;
    thrPos.copyWithin(base + 3, base, base + (TL - 1) * 3);
    thrPos[base] = p[0]; thrPos[base + 1] = p[1]; thrPos[base + 2] = p[2];
  }
  threads.geometry.attributes.position.needsUpdate = true;
}

stage.onResize((bw, bh, w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); if (points) sizePoints(); });
threadsReady = true;
build();
window.__exhibit = { ui, build };

let roT = 0, first = true;
stage.start((dt) => {
  const v = ui.values;
  const p = params();
  const u = posVar.material.uniforms;
  u.p1.value = p[0]; u.p2.value = p[1]; u.p3.value = p[2];
  const steps = Math.round(v.speed * 3);
  const threadMode = v.style === 'threads';
  points.visible = !threadMode;
  threads.visible = threadMode;
  if (threadMode) {
    if (thrPal !== v.pal) paintThreads(v.pal);
    stepThreads(Math.max(1, Math.round(v.speed * 2)));
  } else {
    for (let i = 0; i < steps; i++) { u.uSeed.value = Math.random() * 100; gpu.compute(); }
  }
  pointUniforms.tPos.value = gpu.getCurrentRenderTarget(posVar).texture;
  PALETTES[v.pal].forEach((c, i) => pointUniforms.uPal.value[i].set(...c));
  after.uniforms.damp.value = 0.86;

  if (v.butterfly) {
    const sub = Math.max(1, Math.round(v.speed * 4));
    for (let k = 0; k < sub; k++) {
      for (let i = 0; i < 2; i++) bfly.p[i] = rk4(bfly.p[i], A.dt);
      bfly.t += A.dt;
    }
    for (let i = 0; i < 2; i++) {
      const a = bLines[i].geometry.attributes.position.array;
      a.copyWithin(3, 0, (BTR - 1) * 3);
      a.set(bfly.p[i], 0);
      bLines[i].geometry.attributes.position.needsUpdate = true;
    }
    pointUniforms.uBright.value = 0.06 * Math.pow(262144 / N, 0.7);
  } else {
    pointUniforms.uBright.value = 0.12 * Math.pow(262144 / N, 0.7);
  }

  controls.autoRotate = v.auto;
  controls.update();
  stage.render();

  roT -= dt;
  if (roT <= 0) {
    roT = 0.15;
    if (v.butterfly) {
      const d = Math.hypot(...bfly.p[0].map((x, i) => x - bfly.p[1][i]));
      ui.readout('gap', d < 1e-3 ? `${d.toExponential(1)} (متلاصقان)` : d < 1 ? d.toFixed(3) : `${d.toFixed(1)} (افترقا تماماً)`);
    } else ui.readout('gap', 'فعّل «أثر الفراشة»');
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
