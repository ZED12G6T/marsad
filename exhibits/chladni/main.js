import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShell, WEBGL_FAIL } from '../../assets/js/shell.js';
import { createStage, QUALITY_OPTIONS } from '../../assets/js/stage.js';

// Square plate modes in Chladni's classic approximation:
//   u(x,y) = cos(nπX)·cos(mπY) ± cos(mπX)·cos(nπY),   X,Y ∈ [0,1]
// with frequency ∝ n² + m². Sand grains are kicked in proportion to the local
// vibration amplitude, so they wander until they come to rest on the nodal lines.
const F0 = 31;
const MODES = [];
for (let n = 1; n <= 11; n++) for (let m = 0; m < n; m++) for (const s of [1, -1]) {
  if ((n + m) % 2 && s === 1 && m === 0) continue;
  MODES.push({ n, m, s, f: F0 * (n * n + m * m) * (s > 0 ? 1.0 : 1.045) });
}
MODES.sort((a, b) => a.f - b.f);
const MAXM = 6;
const Q = 26;

const FMIN = 90, FMAX = 3800;
const sliderToF = (v) => FMIN * Math.pow(FMAX / FMIN, v / 1000);
const fToSlider = (f) => (1000 * Math.log(f / FMIN)) / Math.log(FMAX / FMIN);

const ui = createShell({
  title: 'لوحة كلادني',
  scale: 'مقياس <bdi class="num">10<sup>−1</sup></bdi> متر',
  hint: 'حرّك التردد ببطء أو اضغط «الرنين التالي»، وشغّل الصوت لتسمع النغمة',
  readouts: [
    { key: 'freq', label: 'التردد' },
    { key: 'mode', label: 'النمط' },
    { key: 'res', label: 'شدة الاهتزاز' },
  ],
  controls: [
    { type: 'group', label: 'النغمة' },
    { type: 'range', key: 'f', label: 'التردد', min: 0, max: 1000, step: 1, value: Math.round(fToSlider(MODES[6].f)), format: (v) => `${Math.round(sliderToF(v))} هرتز` },
    { type: 'buttons', items: [
      { label: 'الرنين السابق', action: () => jump(-1) },
      { label: 'الرنين التالي', primary: true, action: () => jump(1) },
    ] },
    { type: 'toggle', key: 'sound', label: 'اسمع النغمة', value: false },
    { type: 'range', key: 'vol', label: 'قوة الاهتزاز', min: 0.2, max: 2, step: 0.01, value: 1, format: (v) => `×${v.toFixed(2)}` },
    { type: 'group', label: 'الرمل' },
    { type: 'segmented', key: 'count', label: 'عدد الحبيبات', value: 65536, options: [
      { value: 16384, label: '16 ألف' },
      { value: 65536, label: '65 ألف' },
      { value: 262144, label: '262 ألف' },
    ] },
    { type: 'buttons', items: [{ label: 'صُبّ رملاً جديداً', action: () => pour() }] },
    { type: 'group', label: 'العرض' },
    { type: 'toggle', key: 'lines', label: 'الخطوط النظرية', value: false },
    { type: 'toggle', key: 'wobble', label: 'أظهر اهتزاز اللوح (مكبّراً)', value: false },
    { type: 'segmented', key: 'quality', options: QUALITY_OPTIONS, value: 'auto' },
  ],
  onChange(key, v) {
    if (key === 'count') build(v);
    if (key === 'sound') setSound(v);
    if (key === 'quality') stage.setQuality(v);
  },
  info: `
    <h2>حين يصير الصوت شكلاً</h2>
    <p>لوح معدني مثبت من منتصفه، يهتز بنغمة واحدة. بعض أجزائه ترتفع وتنخفض بقوة، وأجزاء أخرى تبقى ساكنة تماماً، وتسمى «العُقد». حبيبات الرمل تقفز في المناطق المهتزة حتى تقع على خط ساكن فتستقر فيه. بعد ثوانٍ يرسم الرمل خريطة دقيقة للخطوط الساكنة.</p>
    <h3>لماذا يتغير الشكل مع النغمة؟</h3>
    <p>اللوح لا يهتز بقوة إلا عند ترددات معينة تسمى «ترددات الرنين»، لكل منها شكل خاص. بين هذه الترددات يكاد اللوح يسكن فيتوقف الرمل عن الحركة. حرّك التردد ببطء وستلاحظ أن الرمل يهدأ ثم يثور فجأة ويرسم شكلاً جديداً عند كل رنين. وإن شغّلت الصوت سمعت النغمة تعلو عند الرنين.</p>
    <h3>القصة</h3>
    <p>عرض الفيزيائي الألماني إرنست كلادني هذه الأشكال عام ١٧٨٧ بقوس كمان يمرره على حافة لوح معدني. أُعجب بها نابليون فرصد جائزة لمن يفسّرها رياضياً، فنالتها عام ١٨١٦ صوفي جيرمان، أول امرأة تفوز بجائزة أكاديمية العلوم في باريس، بعد أن درست الرياضيات سراً باسم رجل. وما زال صانعو الكمان والعود يستخدمون الفكرة نفسها لضبط ألواح الخشب قبل تجميعها.</p>
    <h3>جرّب</h3>
    <ul>
      <li>فعّل «الخطوط النظرية» لترى الخطوط التي تحسبها المعادلة فوق الرمل الحقيقي.</li>
      <li>اختر ٢٦٢ ألف حبيبة إن كان جهازك قوياً، وستصير الخطوط أدق.</li>
    </ul>
  `,
});

const stage = createStage({ bloom: { strength: 0.25, radius: 0.4, threshold: 0.9 }, exposure: 1.0, startScale: 0.9 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const { renderer } = stage;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070f');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
camera.position.set(0, 3.1, 2.2);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.4;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.45;
controls.target.set(0, 0, 0);
stage.setScene(scene, camera);
scene.add(new THREE.DirectionalLight('#ffffff', 1.2).translateX(1).translateY(3).translateZ(1.5));
scene.add(new THREE.AmbientLight('#8090b0', 0.3));

// ---------------------------------------------------------------- the active modes (shared by plate and sand shaders)
const modeUniforms = {
  uModes: { value: Array.from({ length: MAXM }, () => new THREE.Vector4()) }, // n, m, s, amplitude
  uTime: { value: 0 }, uWobble: { value: 0 }, uLines: { value: 0 }, uAmp: { value: 0 },
};
const MODE_GLSL = /* glsl */`
uniform vec4 uModes[${MAXM}];
const float CPI = 3.14159265; // not PI: three.js defines PI as a macro
// returns (u, du/dx, du/dy) for plate coordinates x,y ∈ [-1,1]
vec3 field(vec2 p) {
  vec2 q = p * 0.5 + 0.5;
  vec3 r = vec3(0.0);
  for (int i = 0; i < ${MAXM}; i++) {
    vec4 M = uModes[i];
    float a = M.w;
    if (a == 0.0) continue;
    float n = M.x * CPI, m = M.y * CPI, s = M.z;
    float cnx = cos(n * q.x), cmy = cos(m * q.y), cmx = cos(m * q.x), cny = cos(n * q.y);
    float snx = sin(n * q.x), smy = sin(m * q.y), smx = sin(m * q.x), sny = sin(n * q.y);
    r.x += a * (cnx * cmy + s * cmx * cny);
    r.y += a * (-n * snx * cmy - s * m * smx * cny) * 0.5;
    r.z += a * (-m * cnx * smy - s * n * cmx * sny) * 0.5;
  }
  return r;
}
`;

// ---------------------------------------------------------------- the plate on its stem
const plate = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 2, 160, 1, 160), new THREE.MeshStandardMaterial({ color: '#23262e', metalness: 0.85, roughness: 0.42, envMapIntensity: 0.35 }));
plate.material.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, modeUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${MODE_GLSL}\nuniform float uTime;\nuniform float uWobble;\nuniform float uAmp;\nvarying vec2 vPlate;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPlate = position.xz;\ntransformed.y += field(position.xz).x * uWobble * uAmp * 0.035 * sin(uTime * 40.0);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${MODE_GLSL}\nuniform float uLines;\nvarying vec2 vPlate;`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (uLines > 0.5) {
        float u = field(vPlate).x;
        float w = fwidth(u) * 1.2;
        float line = 1.0 - smoothstep(0.0, w, abs(u));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.35, 0.85, 0.78), line * 0.8);
      }`);
};
scene.add(plate);
{
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.4, 24), new THREE.MeshStandardMaterial({ color: '#3a3f48', metalness: 0.8, roughness: 0.4 }));
  stem.position.y = -0.71;
  scene.add(stem);
  const driver = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.22, 48), new THREE.MeshStandardMaterial({ color: '#1c1f26', metalness: 0.4, roughness: 0.5 }));
  driver.position.y = -1.42;
  scene.add(driver);
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), new THREE.MeshStandardMaterial({ color: '#c9a45e', metalness: 1, roughness: 0.3 }));
  bolt.position.y = 0.02;
  scene.add(bolt);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshBasicMaterial({ color: '#030409' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.53;
  scene.add(floor);
}

// ---------------------------------------------------------------- sand on the GPU
const SAND_SHADER = MODE_GLSL + /* glsl */`
uniform float uAmp;
uniform float uDt;
uniform float uSeed;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 s = texture2D(textureSand, uv);
  vec2 p = s.xy;
  vec3 f = field(p);
  float a = abs(f.x) * uAmp;
  // random hop proportional to the local vibration, plus a slow slide toward stiller ground
  float ang = hash(uv * 977.0 + uSeed) * 6.2832;
  float len = hash(uv * 613.0 - uSeed * 1.7);
  // a little restlessness everywhere so the lines keep the width of real sand
  p += vec2(cos(ang), sin(ang)) * len * (a * 0.045 + uAmp * 0.0022) * uDt * 60.0;
  p -= f.x * f.yz * uAmp * 0.0006 * uDt * 60.0;
  p = clamp(p, -0.995, 0.995);
  gl_FragColor = vec4(p, s.z, s.w);
}
`;
const SAND_VS = /* glsl */`
uniform sampler2D tSand;
uniform float uScale;
uniform float uWobble;
uniform float uAmp;
uniform float uTime;
attribute vec2 ref;
varying float vShade;
${MODE_GLSL}
void main() {
  vec4 s = texture2D(tSand, ref);
  float y = 0.0105 + field(s.xy).x * uWobble * uAmp * 0.035 * sin(uTime * 40.0);
  vec4 mv = modelViewMatrix * vec4(s.x, y, s.y, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uScale / -mv.z);
  vShade = s.z;
}
`;
const SAND_FS = /* glsl */`
varying float vShade;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  vec3 col = mix(vec3(0.82, 0.7, 0.48), vec3(0.98, 0.9, 0.7), vShade);
  gl_FragColor = vec4(col, 1.0);
}
`;
const sandUniforms = { tSand: { value: null }, uScale: { value: 3 }, uWobble: modeUniforms.uWobble, uAmp: modeUniforms.uAmp, uTime: modeUniforms.uTime, uModes: modeUniforms.uModes };
const sandMat = new THREE.ShaderMaterial({ vertexShader: SAND_VS, fragmentShader: SAND_FS, uniforms: sandUniforms });
let gpu = null, sandVar = null, sandPoints = null, W = 0;

function build(count) {
  if (gpu) gpu.dispose();
  if (sandPoints) { scene.remove(sandPoints); sandPoints.geometry.dispose(); }
  W = Math.sqrt(count);
  gpu = new GPUComputationRenderer(W, W, renderer);
  gpu.setDataType(THREE.FloatType);
  const t0 = gpu.createTexture();
  fillSand(t0.image.data);
  sandVar = gpu.addVariable('textureSand', SAND_SHADER, t0);
  gpu.setVariableDependencies(sandVar, [sandVar]);
  Object.assign(sandVar.material.uniforms, { uModes: modeUniforms.uModes, uAmp: modeUniforms.uAmp, uDt: { value: 1 / 60 }, uSeed: { value: 0 } });
  const err = gpu.init();
  if (err) { console.error(err); ui.fail('تعذّر تشغيل محاكاة الرمل على كرت الشاشة هذا.'); return; }
  const ref = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { ref[i * 2] = ((i % W) + 0.5) / W; ref[i * 2 + 1] = (Math.floor(i / W) + 0.5) / W; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
  sandPoints = new THREE.Points(g, sandMat);
  sandPoints.frustumCulled = false;
  scene.add(sandPoints);
  sizeSand();
}
function fillSand(d) {
  for (let i = 0; i < d.length / 4; i++) {
    d[i * 4] = Math.random() * 1.98 - 0.99;
    d[i * 4 + 1] = Math.random() * 1.98 - 0.99;
    d[i * 4 + 2] = Math.random();
    d[i * 4 + 3] = 1;
  }
}
function pour() {
  const t = gpu.createTexture();
  fillSand(t.image.data);
  gpu.renderTexture(t, gpu.getCurrentRenderTarget(sandVar));
  gpu.renderTexture(t, gpu.getAlternateRenderTarget(sandVar));
}
function sizeSand() {
  sandUniforms.uScale.value = (stage.size.y / 700) * 4.2 * Math.sqrt(65536 / (W * W));
}

// ---------------------------------------------------------------- resonance response
function response(f) {
  const out = MODES.map((M) => {
    const r = f / M.f;
    return { M, a: 1 / Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2) };
  });
  out.sort((a, b) => b.a - a.a);
  return out.slice(0, MAXM);
}
function jump(dir) {
  const f = sliderToF(ui.values.f);
  const list = dir > 0 ? MODES.filter((M) => M.f > f * 1.002) : MODES.filter((M) => M.f < f * 0.998).reverse();
  if (list.length) { ui.set('f', Math.round(fToSlider(list[0].f) * 1000) / 1000); ui.refresh(); }
}

// ---------------------------------------------------------------- sound
let audio = null;
function setSound(on) {
  if (on && !audio) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    audio = { ctx, osc, gain };
  }
  if (audio) { if (on) audio.ctx.resume(); else audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05); }
}

stage.onResize((bw, bh, w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); if (sandPoints) sizeSand(); });
build(ui.values.count);
window.__exhibit = { ui, pour, jump };

let t = 0, roT = 0, first = true;
stage.start((dt) => {
  const v = ui.values;
  t += dt;
  const f = sliderToF(v.f);
  const resp = response(f);
  const peak = resp[0].a;
  // normalise the field so the largest mode has unit shape amplitude; overall drive follows the resonance
  const drive = Math.min(1, peak / Q) * v.vol;
  resp.forEach((r, i) => modeUniforms.uModes.value[i].set(r.M.n, r.M.m, r.M.s, r.a / peak));
  modeUniforms.uAmp.value = drive;
  modeUniforms.uTime.value = t;
  modeUniforms.uWobble.value = v.wobble ? 1 : 0;
  modeUniforms.uLines.value = v.lines ? 1 : 0;

  if (gpu) {
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      sandVar.material.uniforms.uSeed.value = Math.random() * 1000;
      sandVar.material.uniforms.uDt.value = Math.min(dt, 1 / 30) / steps * 2.2;
      gpu.compute();
    }
    sandUniforms.tSand.value = gpu.getCurrentRenderTarget(sandVar).texture;
  }

  if (audio && v.sound) {
    const tt = audio.ctx.currentTime;
    audio.osc.frequency.setTargetAtTime(f, tt, 0.03);
    audio.gain.gain.setTargetAtTime(0.03 + 0.22 * drive, tt, 0.05);
  }

  controls.update();
  stage.render();

  roT -= dt;
  if (roT <= 0) {
    roT = 0.15;
    ui.readout('freq', `${Math.round(f)} هرتز`);
    const M = resp[0].M;
    ui.readout('mode', drive > 0.25 ? `(${M.n}، ${M.m})` : 'بين نمطين');
    ui.readout('res', `${Math.round(drive / v.vol * 100)}٪`);
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
