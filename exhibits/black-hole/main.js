import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createShell, WEBGL_FAIL, ltr } from '../../assets/js/shell.js';
import { createStage, shaderQuad, cameraUniforms, syncCamera, RAY_GLSL, QUALITY_OPTIONS, ease } from '../../assets/js/stage.js';

// Units: Schwarzschild radius rs = 1 (so GM = 0.5, c = 1).
// Photon paths use the classic trick d²x/dλ² = -1.5·h²·x/r⁵, which reproduces
// Schwarzschild null geodesics exactly in flat-space coordinates.
const FRAG = /* glsl */`
varying vec2 vUv;
uniform float uPixAngle;
uniform float uDiskTime;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uDoppler;
uniform float uTemp;
uniform float uDiskGain;
uniform float uStarGain;
uniform float uCamR;
uniform int uSteps;
${RAY_GLSL}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(13.1, 7.7, 3.3); a *= 0.5; }
  return s;
}

// Planckian locus approximation (Tanner Helland), returned in linear RGB.
vec3 blackbody(float t) {
  t = clamp(t, 1000.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.29294 * pow(t - 60.0, -0.1332048), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.390082 * log(t) - 0.631841, 0.0, 1.0) : clamp(1.129890 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.543207 * log(t - 10.0) - 1.196254, 0.0, 1.0));
  return pow(vec3(r, g, b), vec3(2.2));
}

vec3 stars(vec3 d) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float sc = 34.0 + fl * 38.0;
    vec3 p = d * sc;
    vec3 cell = floor(p);
    vec3 h = hash33(cell + fl * 31.7);
    float density = 0.16 - fl * 0.035;
    if (h.x > density) continue;
    vec3 o = 0.3 + 0.4 * hash33(cell * 1.7 + 11.0 + fl);
    vec3 f = fract(p) - o;
    float r0 = 0.055;
    float r = max(r0, uPixAngle * sc * 0.85);
    float b = (0.05 + 7.0 * pow(h.y, 14.0)) * (r0 * r0) / (r * r);
    vec3 c = mix(vec3(1.0), blackbody(mix(2600.0, 16000.0, h.z * h.z)), 0.65);
    col += c * b * exp(-dot(f, f) / (r * r));
  }
  return col;
}

vec3 background(vec3 d) {
  vec3 col = stars(d);
  vec3 bn = normalize(vec3(0.25, 1.0, -0.35));
  float b = dot(d, bn);
  float band = exp(-b * b * 9.0);
  float cl = fbm(d * 2.6 + 3.1);
  float dust = smoothstep(0.38, 0.72, fbm(d * 5.5 + 11.0));
  col += mix(vec3(0.20, 0.26, 0.58), vec3(0.80, 0.56, 0.36), cl) * band * cl * cl * (0.3 + 0.7 * (1.0 - dust)) * 0.22;
  return col * uStarGain;
}

vec4 disk(vec3 p, vec3 dir) {
  float r = length(p.xz);
  if (r < uDiskIn || r > uDiskOut) return vec4(0.0);
  float x = (r - uDiskIn) / (uDiskOut - uDiskIn);

  // Keplerian shear: inner gas laps the outer gas, winding the turbulence into streaks.
  float phi = atan(p.z, p.x);
  float omega = sqrt(0.5 / (r * r * r));
  float a = phi - omega * uDiskTime;
  float lr = log(r);
  vec2 cs = vec2(cos(a), sin(a));
  float n1 = fbm(vec3(cs * 2.2, lr * 7.0));
  float n2 = fbm(vec3(cs * 7.5, lr * 28.0) + 5.3);
  float edge = smoothstep(0.0, 0.04, x) * (1.0 - smoothstep(0.35, 1.0, x));
  float streak = smoothstep(0.32, 0.78, n1 * 0.75 + n2 * 0.45);
  float dens = edge * (0.06 + 0.95 * streak);

  // Thin-disk temperature profile T ∝ r^-3/4 (1 - k·sqrt(r_in/r))^1/4, peak = uTemp.
  float xr = r / uDiskIn;
  float T = uTemp * pow(xr, -0.75) * pow(max(1.0 - 0.9 * inversesqrt(xr), 0.0), 0.25) / 0.571;

  // Relativistic Doppler + gravitational redshift.
  float beta = min(sqrt(0.5 / (r - 1.0)), 0.9);
  float gam = inversesqrt(1.0 - beta * beta);
  vec3 vdir = vec3(-p.z, 0.0, p.x) / r;
  float D = 1.0 / (gam * (1.0 - beta * dot(vdir, -dir)));
  float g = D * sqrt((1.0 - 1.0 / r) / max(1.0 - 1.0 / uCamR, 0.02));
  g = mix(1.0, g, uDoppler);
  float To = T * g;

  vec3 c = blackbody(To) * pow(To / uTemp, 4.0) * uDiskGain * 0.9;
  c *= 0.35 + 1.1 * streak;
  return vec4(c, clamp(dens, 0.0, 1.0));
}

void main() {
  vec3 rd = cameraRay(vUv);
  vec3 pos = uCamPos;
  vec3 vel = rd;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  bool escaped = false;
  float r = length(pos);
  vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);

  // Dynamic bound on purpose: a constant bound makes ANGLE/D3D unroll the loop and compile for seconds.
  for (int i = 0; i < uSteps; i++) {
    r = length(pos);
    if (r < 1.0) break;
    if (r > 40.0 && dot(pos, vel) > 0.0) { escaped = true; break; }
    float dt = 0.05 * r * clamp(r * 0.12, 1.0, 6.0);
    vec3 prev = pos;
    vel += acc * (0.5 * dt);
    pos += vel * dt;
    float r2 = dot(pos, pos);
    acc = -1.5 * h2 * pos / (r2 * r2 * sqrt(r2));
    vel += acc * (0.5 * dt);
    if (prev.y * pos.y < 0.0) {
      float t = prev.y / (prev.y - pos.y);
      vec4 dc = disk(mix(prev, pos, t), normalize(vel));
      col += (1.0 - alpha) * dc.rgb * dc.a;
      alpha += (1.0 - alpha) * dc.a;
      if (alpha > 0.995) break;
    }
  }
  if (escaped) col += (1.0 - alpha) * background(normalize(vel));
  gl_FragColor = vec4(col, 1.0);
}
`;

const STEPS = { auto: 320, low: 190, medium: 280, high: 460 };
const RS_MKM = 12.2; // Sagittarius A*: rs ≈ 12.2 million km

const ui = createShell({
  title: 'الثقب الأسود',
  scale: 'مقياس <bdi class="num">10<sup>10</sup></bdi> متر',
  hint: 'اسحب لتدور حول الثقب، ومرّر العجلة لتقترب',
  readouts: [
    { key: 'dist', label: 'بعدك عن المركز' },
    { key: 'time', label: 'ساعتك مقارنة بساعة بعيدة' },
  ],
  controls: [
    { type: 'group', label: 'قرص المادة' },
    { type: 'range', key: 'temp', label: 'الحرارة عند الحافة الداخلية', min: 2500, max: 25000, step: 100, value: 7000, format: (v) => `${Math.round(v).toLocaleString('en')} كلفن` },
    { type: 'range', key: 'gain', label: 'السطوع', min: 0.2, max: 3, step: 0.01, value: 1.2, format: (v) => v.toFixed(2) },
    { type: 'range', key: 'outer', label: 'نصف قطر القرص', min: 6, max: 26, step: 0.1, value: 14, format: (v) => `${v.toFixed(1)} rs` },
    { type: 'range', key: 'speed', label: 'سرعة الدوران', min: 0, max: 4, step: 0.01, value: 1, format: (v) => `×${v.toFixed(2)}` },
    { type: 'group', label: 'النسبية' },
    { type: 'range', key: 'doppler', label: 'دوبلر والانزياح الأحمر', min: 0, max: 1, step: 0.01, value: 1, format: (v) => `${Math.round(v * 100)}٪` },
    { type: 'buttons', items: [
      { label: 'كما في الواقع', action: (api) => { api.set('doppler', 1); api.set('temp', 7000); api.set('gain', 1.2); api.set('outer', 14); } },
      { label: 'كما في إنترستيلر', action: (api) => { api.set('doppler', 0); api.set('temp', 4300); api.set('gain', 1.7); api.set('outer', 17); } },
    ] },
    { type: 'group', label: 'الرحلة' },
    { type: 'buttons', items: [
      { label: 'اقترب من الأفق', primary: true, action: () => flyTo(2.35, 87.5, 0.9, 9) },
      { label: 'ارجع للبعيد', action: () => flyTo(17, 82, -0.5, 5) },
    ] },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي للكاميرا', value: true },
    { type: 'range', key: 'stars', label: 'النجوم خلف الثقب', min: 0, max: 2, step: 0.01, value: 1, format: (v) => `${Math.round(v * 100)}٪` },
    { type: 'group', label: 'الجودة' },
    { type: 'segmented', key: 'quality', options: QUALITY_OPTIONS, value: 'auto' },
  ],
  onChange(key, v) {
    if (key === 'quality') { stage.setQuality(v); uniforms.uSteps.value = STEPS[v]; }
  },
  info: `
    <h2>كيف يُرسم ثقب أسود؟</h2>
    <p>لا توجد هنا صورة ولا مجسّم. لكل بكسل على شاشتك يطلق البرنامج شعاع ضوء إلى الخلف، ويتتبّعه خطوة بخطوة وهو ينحني حول الثقب حسب معادلات النسبية العامة. إن سقط الشعاع في الأفق صار البكسل أسود، وإن عبر القرص أخذ لونه، وإن أفلت أخذ لون النجوم خلفه. هذا يتكرر مئات المرات لكل بكسل، في كل إطار.</p>
    <h3>القرص الذي فوق الثقب ليس فوقه</h3>
    <p>القوس المضيء الملتفّ فوق الظل الأسود وتحته هو الجزء الخلفي من القرص نفسه. الجاذبية تحني الضوء القادم منه فتراه من فوق ومن تحت معاً. والحلقة الرفيعة الملاصقة للظل ضوءٌ دار حول الثقب دورة كاملة أو أكثر قبل أن يصل إليك.</p>
    <h3>لماذا جهة أسطع من الأخرى؟</h3>
    <p>الغاز عند الحافة الداخلية للقرص يدور بنحو نصف سرعة الضوء. الجهة المقبلة نحوك يتركّز ضوؤها ويميل إلى الأزرق، والجهة المبتعدة تخفت وتميل إلى الأحمر. هذا هو تأثير دوبلر النسبي، ولهذا السبب ظهرت صورة الثقب M87 التي التقطها تلسكوب أفق الحدث عام ٢٠١٩ أسطع من جهة واحدة.</p>
    <p>في فيلم <bdi>Interstellar</bdi> حُذف هذا التأثير عمداً لأن الشكل الحقيقي يربك المشاهد. جرّب زر «كما في إنترستيلر» لترى الفرق.</p>
    <h3>الزمن يتباطأ</h3>
    <p>كلما اقتربت من الثقب تباطأت ساعتك مقارنة بساعة شخص بعيد. الرقم أسفل الشاشة يحسب ذلك لمراقب ثابت في مكانه. وعند الأفق نفسه يصير التباطؤ لا نهائياً.</p>
    <h3>جرّب</h3>
    <ul>
      <li>اضغط «اقترب من الأفق» وراقب الظل وهو يبتلع نصف السماء.</li>
      <li>انزل بالكاميرا حتى تصير في مستوى القرص تماماً.</li>
      <li>ارفع الحرارة وشاهد القرص يتحول من البرتقالي إلى الأبيض المزرقّ.</li>
      <li>اضغط حرف <bdi>H</bdi> لتخفي الواجهة وتتأمل المشهد وحده.</li>
    </ul>
    <p>المسافات بوحدة نصف قطر شفارتزشيلد (<bdi>rs</bdi>). لو كان هذا الثقب بحجم قوس الرامي <bdi>A*</bdi> في مركز مجرتنا، فإن <bdi>rs</bdi> الواحد يساوي نحو ١٢ مليون كيلومتر.</p>
  `,
});

const stage = createStage({ bloom: { strength: 0.55, radius: 0.35, threshold: 0.95 }, exposure: 0.95, startScale: 0.7 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }

const uniforms = {
  ...cameraUniforms(),
  uPixAngle: { value: 0.001 },
  uDiskTime: { value: 0 },
  uDiskIn: { value: 3.0 },
  uDiskOut: { value: 14 },
  uDoppler: { value: 1 },
  uTemp: { value: 7000 },
  uDiskGain: { value: 1.2 },
  uStarGain: { value: 1 },
  uCamR: { value: 17 },
  uSteps: { value: STEPS.auto },
};
const quad = shaderQuad(FRAG, uniforms);
stage.setScene(quad.scene, quad.camera);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.setFromSphericalCoords(17, THREE.MathUtils.degToRad(82), 0.35);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 60;
controls.zoomSpeed = 0.7;
controls.rotateSpeed = 0.5;
controls.autoRotateSpeed = 0.25;

stage.onResize((bw, bh, w, h) => {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

window.__exhibit = { camera, controls, uniforms, ui };

let flight = null;
function flyTo(r, polarDeg, dAzimuth, seconds) {
  const s = new THREE.Spherical().setFromVector3(camera.position);
  flight = {
    t: 0, dur: seconds,
    r0: s.radius, r1: r,
    p0: s.phi, p1: THREE.MathUtils.degToRad(polarDeg),
    a0: s.theta, a1: s.theta + dAzimuth,
  };
}
stage.canvas.addEventListener('pointerdown', () => { flight = null; });
stage.canvas.addEventListener('wheel', () => { flight = null; }, { passive: true });

let diskTime = 0, roTimer = 0, first = true;
stage.start((dt) => {
  const v = ui.values;
  diskTime += dt * v.speed * 6.0;
  uniforms.uDiskTime.value = diskTime;
  uniforms.uTemp.value = v.temp;
  uniforms.uDiskGain.value = v.gain;
  uniforms.uDiskOut.value = v.outer;
  uniforms.uDoppler.value = v.doppler;
  uniforms.uStarGain.value = v.stars;
  controls.autoRotate = v.auto && !flight;

  if (flight) {
    flight.t += dt;
    const k = ease(Math.min(flight.t / flight.dur, 1));
    const r = Math.exp(THREE.MathUtils.lerp(Math.log(flight.r0), Math.log(flight.r1), k));
    camera.position.setFromSphericalCoords(r, THREE.MathUtils.lerp(flight.p0, flight.p1, k), THREE.MathUtils.lerp(flight.a0, flight.a1, k));
    camera.lookAt(0, 0, 0);
    if (k >= 1) flight = null;
  }
  controls.update();

  // Near the photon sphere the shadow spans >100° of sky: widen the lens and
  // turn the gaze aside so the shadow's edge (where the action is) stays in view.
  const camR = camera.position.length();
  const near = 1 - THREE.MathUtils.smoothstep(camR, 2.4, 7.5);
  const fov = 50 + 42 * near;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.rotateY(-0.72 * near);
  camera.rotateX(0.1 * near);

  syncCamera(uniforms, camera);
  uniforms.uCamR.value = camR;
  uniforms.uPixAngle.value = THREE.MathUtils.degToRad(camera.fov) / stage.size.y;
  stage.render();

  roTimer -= dt;
  if (roTimer <= 0) {
    roTimer = 0.25;
    const mkm = camR * RS_MKM;
    ui.readout('dist', `${ltr(camR.toFixed(2) + ' rs')}، أي ${mkm < 100 ? mkm.toFixed(1) : Math.round(mkm)} مليون كم`);
    ui.readout('time', `ساعة هنا = ${(1 / Math.sqrt(1 - 1 / camR)).toFixed(3)} ساعة هناك`);
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
