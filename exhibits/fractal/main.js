import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { createShell, WEBGL_FAIL } from '../../assets/js/shell.js';
import { createStage, shaderQuad, cameraUniforms, syncCamera, RAY_GLSL, QUALITY_OPTIONS, ease } from '../../assets/js/stage.js';

const FRAG = /* glsl */`
varying vec2 vUv;
uniform vec2 uJitter;
uniform float uPixAngle;
uniform int uType;
uniform float uPower;
uniform float uBoxScale;
uniform vec4 uJuliaC;
uniform int uIter;
uniform int uSteps;
uniform float uDetail;
uniform float uShadows;
uniform float uFog;
uniform float uCamDist;
uniform vec3 uLight;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;
uniform float uColorShift;
uniform sampler2D uPrev;
uniform float uBlend;
${RAY_GLSL}

float deBulb(vec3 p, out vec4 trap) {
  vec3 z = p;
  float dr = 1.0, r = length(z);
  trap = vec4(abs(z), dot(z, z));
  for (int i = 0; i < uIter; i++) {
    r = length(z);
    if (r > 2.0) break;
    if (r < 1e-7) { z = p; continue; }
    float theta = acos(clamp(z.z / r, -1.0, 1.0)) * uPower;
    float phi = atan(z.y, z.x) * uPower;
    dr = pow(r, uPower - 1.0) * uPower * dr + 1.0;
    float zr = pow(r, uPower);
    z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + p;
    trap = min(trap, vec4(abs(z), dot(z, z)));
  }
  return 0.5 * log(r) * r / dr;
}

float deBox(vec3 p, out vec4 trap) {
  vec3 z = p;
  float dr = 1.0;
  trap = vec4(1e10);
  for (int i = 0; i < uIter; i++) {
    z = clamp(z, -1.0, 1.0) * 2.0 - z;
    float r2 = dot(z, z);
    if (r2 < 0.25) { z *= 4.0; dr *= 4.0; }
    else if (r2 < 1.0) { z /= r2; dr /= r2; }
    z = z * uBoxScale + p;
    dr = dr * abs(uBoxScale) + 1.0;
    trap = min(trap, vec4(abs(z) * 0.25, r2));
  }
  return length(z) / abs(dr);
}

vec4 qsq(vec4 a) { return vec4(a.x * a.x - dot(a.yzw, a.yzw), 2.0 * a.x * a.yzw); }
float deJulia(vec3 p, out vec4 trap) {
  vec4 z = vec4(p, 0.0);
  float md2 = 1.0, mz2 = dot(z, z);
  trap = vec4(abs(z.xyz), mz2);
  for (int i = 0; i < uIter; i++) {
    md2 *= 4.0 * mz2;
    z = qsq(z) + uJuliaC;
    mz2 = dot(z, z);
    trap = min(trap, vec4(abs(z.xyz), mz2));
    if (mz2 > 4.0) break;
  }
  return 0.25 * sqrt(mz2 / md2) * log(mz2);
}

// World is y-up; the fractals are defined z-up.
float map(vec3 p, out vec4 trap) {
  vec3 q = p.xzy;
  if (uType == 0) return deBulb(q, trap);
  if (uType == 1) return deBox(q, trap);
  return deJulia(q, trap);
}
float map(vec3 p) { vec4 t; return map(p, t); }

vec3 calcNormal(vec3 p, float e) {
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
                   k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

float softShadow(vec3 ro, vec3 rd, float tmin, float tmax) {
  float res = 1.0, t = tmin;
  for (int i = 0; i < 48; i++) {
    float h = map(ro + rd * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, tmin * 0.5, tmax * 0.1);
    if (res < 0.002 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}

float calcAO(vec3 p, vec3 n, float s) {
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = s * float(i);
    occ += w * (h - map(p + n * h));
    w *= 0.6;
  }
  return clamp(1.0 - 1.6 * occ / s, 0.0, 1.0);
}

vec3 palette(float t) { return uPalA + uPalB * cos(6.28318 * (uPalC * t + uPalD)); }

vec3 background(vec3 rd) {
  vec3 base = palette(0.05 + uColorShift) * 0.035;
  float up = 0.5 + 0.5 * rd.y;
  return base * (0.4 + 0.8 * up) + vec3(0.004, 0.006, 0.014);
}

void main() {
  vec3 ro = uCamPos;
  vec3 rd = cameraRay(vUv + uJitter);
  vec4 trap;
  float t = uCamDist * 0.002;
  float tmax = uCamDist * 3.0 + 8.0;
  float stepK = uType == 2 ? 0.7 : 0.9;
  bool hit = false;
  float mdr = 1e9, eps = 0.0;
  for (int i = 0; i < uSteps; i++) {
    vec3 p = ro + rd * t;
    eps = max(t * uPixAngle * uDetail, 1e-7);
    float d = map(p, trap);
    mdr = min(mdr, d / t);
    if (d < eps) { hit = true; break; }
    t += d * stepK;
    if (t > tmax) break;
  }

  vec3 col;
  vec3 bg = background(rd);
  vec3 glowCol = palette(0.35 + uColorShift);
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, eps * 0.5);
    vec3 base = palette(0.85 * sqrt(trap.w) + 0.35 * trap.x + 0.15 * trap.z + uColorShift);
    vec3 L = normalize(uLight);
    float dif = clamp(dot(n, L), 0.0, 1.0);
    float sha = 1.0;
    if (uShadows > 0.5 && dif > 0.001) sha = softShadow(p + n * eps * 3.0, L, eps * 6.0, max(uCamDist * 0.8, eps * 400.0));
    float occ = calcAO(p, n, clamp(t * 0.012, eps * 3.0, 0.08));
    float sky = 0.5 + 0.5 * n.y;
    float back = clamp(dot(n, normalize(vec3(-L.x, 0.0, -L.z))), 0.0, 1.0);
    vec3 h = normalize(L - rd);
    float spe = pow(clamp(dot(n, h), 0.0, 1.0), 40.0) * dif * sha;
    float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);
    vec3 lin = 2.0 * dif * sha * vec3(1.25, 1.0, 0.8);
    lin += 0.5 * sky * occ * vec3(0.38, 0.48, 0.78);
    lin += 0.35 * back * occ * vec3(0.6, 0.4, 0.3);
    lin += 0.6 * fre * occ * glowCol;
    col = base * lin * mix(0.35, 1.0, occ) + spe * vec3(1.0, 0.95, 0.85) * 0.9;
    float fz = t / uCamDist;
    col = mix(col, bg, 1.0 - exp(-uFog * fz * fz));
  } else {
    col = bg + glowCol * 0.16 * exp(-mdr * 140.0 / max(uDetail, 0.3));
  }

  vec3 prev = texture2D(uPrev, vUv).rgb;
  gl_FragColor = vec4(mix(prev, col, uBlend), 1.0);
}
`;

// ---------------------------------------------------------------- CPU twins of the distance estimators (for click-to-dive)
function deBulbJS(x, y, z, power, iters) {
  let zx = x, zy = y, zz = z, dr = 1, r = Math.hypot(zx, zy, zz);
  for (let i = 0; i < iters; i++) {
    r = Math.hypot(zx, zy, zz);
    if (r > 2) break;
    if (r < 1e-7) { zx = x; zy = y; zz = z; continue; }
    const th = Math.acos(Math.max(-1, Math.min(1, zz / r))) * power;
    const ph = Math.atan2(zy, zx) * power;
    dr = Math.pow(r, power - 1) * power * dr + 1;
    const zr = Math.pow(r, power);
    zx = zr * Math.sin(th) * Math.cos(ph) + x;
    zy = zr * Math.sin(ph) * Math.sin(th) + y;
    zz = zr * Math.cos(th) + z;
  }
  return 0.5 * Math.log(r) * r / dr;
}
function deBoxJS(x, y, z, s, iters) {
  let zx = x, zy = y, zz = z, dr = 1;
  const fold = (v) => Math.max(-1, Math.min(1, v)) * 2 - v;
  for (let i = 0; i < iters; i++) {
    zx = fold(zx); zy = fold(zy); zz = fold(zz);
    const r2 = zx * zx + zy * zy + zz * zz;
    if (r2 < 0.25) { zx *= 4; zy *= 4; zz *= 4; dr *= 4; }
    else if (r2 < 1) { zx /= r2; zy /= r2; zz /= r2; dr /= r2; }
    zx = zx * s + x; zy = zy * s + y; zz = zz * s + z;
    dr = dr * Math.abs(s) + 1;
  }
  return Math.hypot(zx, zy, zz) / Math.abs(dr);
}
function deJuliaJS(x, y, z, c, iters) {
  let a = x, b = y, cc = z, d = 0, md2 = 1, mz2 = a * a + b * b + cc * cc;
  for (let i = 0; i < iters; i++) {
    md2 *= 4 * mz2;
    const na = a * a - (b * b + cc * cc + d * d) + c[0];
    b = 2 * a * b + c[1]; cc = 2 * a * cc + c[2]; d = 2 * a * d + c[3]; a = na;
    mz2 = a * a + b * b + cc * cc + d * d;
    if (mz2 > 4) break;
  }
  return 0.25 * Math.sqrt(mz2 / md2) * Math.log(mz2);
}

// ---------------------------------------------------------------- configuration
const TYPES = {
  bulb: { id: 0, iter: 9, cam: 3.1 },
  box: { id: 1, iter: 14, cam: 7.5 },
  julia: { id: 2, iter: 14, cam: 3.0 },
};
const PALETTES = {
  brass: { a: [0.55, 0.4, 0.25], b: [0.45, 0.33, 0.2], c: [1, 1, 1], d: [0.0, 0.1, 0.2] },
  coral: { a: [0.62, 0.42, 0.42], b: [0.38, 0.32, 0.3], c: [1, 0.9, 0.8], d: [0.0, 0.25, 0.45] },
  ice: { a: [0.42, 0.52, 0.64], b: [0.3, 0.3, 0.3], c: [1, 1, 1], d: [0.6, 0.62, 0.68] },
  nebula: { a: [0.5, 0.42, 0.6], b: [0.5, 0.42, 0.4], c: [1, 1, 1], d: [0.0, 0.33, 0.67] },
  jade: { a: [0.35, 0.55, 0.45], b: [0.3, 0.36, 0.3], c: [1, 1, 1], d: [0.3, 0.55, 0.6] },
};
const STEPS = { auto: 180, low: 120, medium: 170, high: 260 };
const ACCUM_MAX = 48;

const ui = createShell({
  title: 'فراكتل لا ينتهي',
  scale: 'بلا مقياس: نفس التعقيد في كل تكبير',
  hint: 'دبل كلك على أي نقطة لتنغمس فيها، ومرّر العجلة لتقترب',
  readouts: [
    { key: 'zoom', label: 'التكبير' },
    { key: 'state', label: 'الصورة' },
  ],
  controls: [
    { type: 'group', label: 'الشكل' },
    { type: 'segmented', key: 'type', value: 'bulb', options: [
      { value: 'bulb', label: 'مندلبَلب' },
      { value: 'box', label: 'مندلبوكس' },
      { value: 'julia', label: 'جوليا رباعية' },
    ] },
    { type: 'range', key: 'power', label: 'الأُس', min: 2, max: 14, step: 0.01, value: 8, format: (v) => v.toFixed(2), when: (v) => v.type === 'bulb' },
    { type: 'range', key: 'boxScale', label: 'معامل الطيّ', min: -2.8, max: -1.3, step: 0.005, value: -1.75, format: (v) => v.toFixed(3), when: (v) => v.type === 'box' },
    { type: 'range', key: 'julia', label: 'الثابت c', min: 0, max: 6.283, step: 0.001, value: 1.2, format: (v) => v.toFixed(2), when: (v) => v.type === 'julia' },
    { type: 'toggle', key: 'breathe', label: 'اجعله يتنفّس', value: false },
    { type: 'range', key: 'iter', label: 'عدد التكرارات', min: 3, max: 20, step: 1, value: 9, format: (v) => String(v) },
    { type: 'group', label: 'الألوان والضوء' },
    { type: 'segmented', key: 'palette', value: 'brass', options: [
      { value: 'brass', label: 'نحاس' },
      { value: 'coral', label: 'مرجان' },
      { value: 'ice', label: 'جليد' },
      { value: 'jade', label: 'يشم' },
      { value: 'nebula', label: 'سديم' },
    ] },
    { type: 'range', key: 'shift', label: 'إزاحة اللون', min: 0, max: 1, step: 0.005, value: 0, format: (v) => v.toFixed(2) },
    { type: 'toggle', key: 'shadows', label: 'ظلال ناعمة', value: true },
    { type: 'range', key: 'fog', label: 'الضباب', min: 0, max: 3, step: 0.01, value: 0.6, format: (v) => v.toFixed(2) },
    { type: 'range', key: 'detail', label: 'دقة التفاصيل', min: 0.4, max: 3, step: 0.01, value: 1, format: (v) => `×${(1 / v).toFixed(2)}` },
    { type: 'buttons', items: [{ label: 'ارجع للمنظر الكامل', action: () => resetView(1.6) }] },
    { type: 'group', label: 'الجودة' },
    { type: 'segmented', key: 'quality', options: QUALITY_OPTIONS, value: 'auto' },
    { type: 'note', html: 'حين تتوقف عن التحريك تتحسن الصورة تدريجياً، ثم يتوقف الحساب تماماً لتوفير الطاقة.' },
  ],
  onChange(key, v) {
    if (key === 'type') {
      ui.set('iter', TYPES[v].iter, { silent: true });
      resetView(1.4);
    }
    if (key === 'quality') { stage.setQuality(v); uniforms.uSteps.value = STEPS[v]; }
    dirty = true;
  },
  info: `
    <h2>شكل من سطر واحد</h2>
    <p>الفراكتل شكل يتكرر داخل نفسه: قرّب على جزء منه تجد نسخة معقدة بنفس القدر. هذه الأشكال الثلاثة لم يرسمها أحد. كل نقطة في الفضاء تُختبر بمعادلة بسيطة تُعاد عشرات المرات: إن بقيت النتيجة محدودة فالنقطة داخل الشكل، وإن انفلتت إلى ما لا نهاية فهي خارجه.</p>
    <h3>مندلبَلب</h3>
    <p>هو النسخة الثلاثية الأبعاد من مجموعة ماندلبرو الشهيرة، اكتُشف عام ٢٠٠٩ بعد سنين من البحث عن صيغة تعطي تفاصيل حقيقية في الأبعاد الثلاثة. الفكرة: خذ نقطة، ضاعف زاويتيها ثماني مرات وارفع بعدها عن المركز للأس الثامن، ثم أضف النقطة الأصلية، وكرّر. غيّر «الأُس» لترى كيف يتحول الشكل من فقاعة ناعمة إلى ما يشبه الشعاب المرجانية.</p>
    <h3>مندلبوكس</h3>
    <p>معادلة تطوي الفضاء وتقلبه: تطوي كل نقطة خارج مكعب إلى داخله، وتقلب النقاط القريبة من المركز كالمرآة الكروية، ثم تكبّر. النتيجة مدن وأبراج وكهوف لا نهاية لها. ادخل إليه بالعجلة وتجوّل في ممراته.</p>
    <h3>جوليا رباعية</h3>
    <p>تستخدم الأعداد الرباعية (الكواترنيونات)، وهي أعداد لها أربعة أبعاد اكتشفها هاملتون عام ١٨٤٣ ونقشها على حجر جسر في دبلن. ما تراه شريحة ثلاثية الأبعاد من جسم رباعي الأبعاد. حرّك «الثابت c» وشاهده يذوب ويتشكل.</p>
    <h3>كيف يُرسم؟</h3>
    <p>من كل بكسل يخرج شعاع، والمعادلة تخبره كم يبعد عن أقرب نقطة من السطح، فيقفز تلك المسافة بأمان، ويكرر حتى يلامس السطح. ثم تُحسب الظلال الناعمة والإضاءة المحيطة بأشعة إضافية. حين تتوقف عن التحريك تُرسم الصورة عشرات المرات بإزاحات دقيقة وتُدمج، فتصير الحواف ناعمة جداً.</p>
    <h3>جرّب</h3>
    <ul>
      <li>دبل كلك على أي نتوء صغير، ثم دبل كلك مرة ثانية داخله. استمر.</li>
      <li>شغّل «اجعله يتنفّس» واترك الشكل يتحول أمامك.</li>
      <li>في مندلبوكس اقترب حتى تدخل في الشكل نفسه.</li>
    </ul>
  `,
});

const stage = createStage({ bloom: { strength: 0.35, radius: 0.4, threshold: 0.85 }, exposure: 1.0, startScale: 0.65 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const { renderer } = stage;

const uniforms = {
  ...cameraUniforms(),
  uJitter: { value: new THREE.Vector2() },
  uPixAngle: { value: 0.001 },
  uType: { value: 0 },
  uPower: { value: 8 },
  uBoxScale: { value: -1.75 },
  uJuliaC: { value: new THREE.Vector4() },
  uIter: { value: 9 },
  uSteps: { value: STEPS.auto },
  uDetail: { value: 1 },
  uShadows: { value: 1 },
  uFog: { value: 0.6 },
  uCamDist: { value: 3 },
  uLight: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
  uPalA: { value: new THREE.Vector3() },
  uPalB: { value: new THREE.Vector3() },
  uPalC: { value: new THREE.Vector3() },
  uPalD: { value: new THREE.Vector3() },
  uColorShift: { value: 0 },
  uPrev: { value: null },
  uBlend: { value: 1 },
};
const quad = shaderQuad(FRAG, uniforms);

// Accumulation: the fractal renders into ping-pong HDR targets; the composer only displays the result.
const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
let rtRead = new THREE.WebGLRenderTarget(4, 4, rtOpts);
let rtWrite = new THREE.WebGLRenderTarget(4, 4, rtOpts);
const texPass = new TexturePass(rtRead.texture);
stage.renderPass.enabled = false;
stage.composer.insertPass(texPass, 1);

const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 100);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 0.00002;
controls.maxDistance = 30;
controls.zoomSpeed = 0.9;
controls.rotateSpeed = 0.5;

let dirty = true, accum = 0;
stage.onResize((bw, bh, w, h) => {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  rtRead.setSize(bw, bh);
  rtWrite.setSize(bw, bh);
  accum = 0; // history is stale, but the view itself did not change
});
camera.aspect = window.innerWidth / window.innerHeight;

// A loop through quaternion space centred on one of Paul Bourke's classic Julia constants.
function juliaC(a) {
  return [-0.125 + 0.13 * Math.cos(a), -0.256 + 0.16 * Math.sin(a * 2), 0.847 + 0.1 * Math.cos(a * 3 + 1), 0.0895 + 0.14 * Math.sin(a + 2)];
}

function de(x, y, z) {
  const v = ui.values;
  // world → fractal axes (x, z, y), matching the shader
  if (v.type === 'bulb') return deBulbJS(x, z, y, uniforms.uPower.value, v.iter);
  if (v.type === 'box') return deBoxJS(x, z, y, uniforms.uBoxScale.value, v.iter);
  const c = uniforms.uJuliaC.value;
  return deJuliaJS(x, z, y, [c.x, c.y, c.z, c.w], v.iter);
}

let flight = null;
function flyTo(target, position, seconds) {
  flight = { t: 0, dur: seconds, t0: controls.target.clone(), t1: target, p0: camera.position.clone(), p1: position };
}
function resetView(seconds = 0) {
  const d = TYPES[ui.values.type].cam * Math.max(1, Math.pow(1 / camera.aspect, 0.85));
  const pos = new THREE.Vector3(0.55, 0.42, 0.72).normalize().multiplyScalar(d);
  if (seconds) flyTo(new THREE.Vector3(), pos, seconds);
  else { controls.target.set(0, 0, 0); camera.position.copy(pos); }
}
resetView();

const raycaster = new THREE.Raycaster();
stage.canvas.addEventListener('dblclick', (e) => {
  const r = stage.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  const pix = THREE.MathUtils.degToRad(camera.fov) / r.height;
  let t = 0;
  for (let i = 0; i < 600; i++) {
    const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
    const dist = de(px, py, pz);
    if (dist < Math.max(t * pix, 1e-7)) {
      const hit = new THREE.Vector3(px, py, pz);
      const back = camera.position.clone().sub(hit).normalize().multiplyScalar(t * 0.32);
      flyTo(hit, hit.clone().add(back), 1.6);
      return;
    }
    t += dist * 0.9;
    if (t > 40) return;
  }
});
stage.canvas.addEventListener('pointerdown', () => { flight = null; });
stage.canvas.addEventListener('wheel', () => { flight = null; }, { passive: true });

window.__exhibit = { camera, controls, uniforms, ui };

const prevMatrix = new THREE.Matrix4();
const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
const startDist = 1.9;
let time = 0, roTimer = 0, first = true, refining = false, movingScale = 0.65;

stage.start((dt) => {
  const v = ui.values;
  time += dt;

  if (flight) {
    flight.t += dt;
    const k = ease(Math.min(flight.t / flight.dur, 1));
    controls.target.lerpVectors(flight.t0, flight.t1, k);
    // Log-interpolate distance so deep dives feel uniform.
    const d0 = flight.p0.distanceTo(flight.t0), d1 = flight.p1.distanceTo(flight.t1);
    const dir = flight.p0.clone().sub(flight.t0).normalize().lerp(flight.p1.clone().sub(flight.t1).normalize(), k).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, Math.exp(THREE.MathUtils.lerp(Math.log(d0), Math.log(d1), k)));
    if (k >= 1) flight = null;
  }
  controls.update();

  // Shape parameters (optionally breathing).
  const br = v.breathe ? time : 0;
  uniforms.uType.value = TYPES[v.type].id;
  uniforms.uPower.value = v.breathe ? 8 + 3.2 * Math.sin(br * 0.25) : v.power;
  uniforms.uBoxScale.value = v.breathe ? -2.05 + 0.45 * Math.sin(br * 0.2) : v.boxScale;
  const jc = juliaC(v.breathe ? v.julia + br * 0.15 : v.julia);
  uniforms.uJuliaC.value.set(jc[0], jc[1], jc[2], jc[3]);
  uniforms.uIter.value = v.iter;
  uniforms.uDetail.value = v.detail;
  uniforms.uShadows.value = v.shadows ? 1 : 0;
  uniforms.uFog.value = v.fog;
  uniforms.uColorShift.value = v.shift;
  const pal = PALETTES[v.palette];
  uniforms.uPalA.value.fromArray(pal.a); uniforms.uPalB.value.fromArray(pal.b);
  uniforms.uPalC.value.fromArray(pal.c); uniforms.uPalD.value.fromArray(pal.d);

  camera.updateMatrixWorld();
  const moved = !prevMatrix.equals(camera.matrixWorld);
  prevMatrix.copy(camera.matrixWorld);
  if (moved || v.breathe || flight) dirty = true;

  if (dirty) {
    accum = 0;
    dirty = false;
    if (refining) { refining = false; stage.unlock(movingScale); }
  } else if (accum === 1 && !refining && v.quality === 'auto') {
    // Camera came to rest: render the refinement passes at full resolution.
    refining = true;
    movingScale = stage.scale;
    stage.lock(1);
    accum = 0;
  }

  if (accum < ACCUM_MAX) {
    syncCamera(uniforms, camera);
    const camDist = camera.position.distanceTo(controls.target);
    uniforms.uCamDist.value = Math.max(camDist, 1e-5);
    uniforms.uPixAngle.value = THREE.MathUtils.degToRad(camera.fov) / stage.size.y;
    // Key light rides with the camera: above, to the left, slightly behind.
    camera.matrixWorld.extractBasis(right, up, fwd);
    uniforms.uLight.value.copy(up).multiplyScalar(0.75).addScaledVector(right, -0.5).addScaledVector(fwd, 0.45).normalize();
    if (accum === 0) uniforms.uJitter.value.set(0, 0);
    else uniforms.uJitter.value.set((Math.random() - 0.5) / stage.size.x, (Math.random() - 0.5) / stage.size.y);
    uniforms.uBlend.value = 1 / (accum + 1);
    uniforms.uPrev.value = rtRead.texture;
    renderer.setRenderTarget(rtWrite);
    renderer.render(quad.scene, quad.camera);
    renderer.setRenderTarget(null);
    [rtRead, rtWrite] = [rtWrite, rtRead];
    texPass.map = rtRead.texture;
    accum++;
    stage.render();
  }

  roTimer -= dt;
  if (roTimer <= 0) {
    roTimer = 0.25;
    const surf = Math.max(de(camera.position.x, camera.position.y, camera.position.z), 1e-9);
    const zoom = Math.max(1, startDist / surf);
    ui.readout('zoom', zoom < 10 ? `×${zoom.toFixed(1)}` : `×${Math.round(zoom).toLocaleString('en')}`);
    ui.readout('state', accum >= ACCUM_MAX ? 'مكتملة، والحساب متوقف' : refining ? `تتحسن… ${Math.round((accum / ACCUM_MAX) * 100)}٪` : 'تتحرك');
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
