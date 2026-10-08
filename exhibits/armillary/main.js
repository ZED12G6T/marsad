import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createShell, WEBGL_FAIL, el } from '../../assets/js/shell.js';
import { createStage, ease } from '../../assets/js/stage.js';
import { STARS, STAR_BY_KEY, STORIES, CONSTELLATIONS, ZODIAC } from './stars.js';
import * as A from './astro.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;

// ---------------------------------------------------------------- places
const CITIES = [
  { name: 'الرياض', lat: 24.7136, lon: 46.6753, tz: 3 },
  { name: 'مكة المكرمة', lat: 21.4225, lon: 39.8262, tz: 3 },
  { name: 'المدينة المنورة', lat: 24.4672, lon: 39.6111, tz: 3 },
  { name: 'جدة', lat: 21.5433, lon: 39.1728, tz: 3 },
  { name: 'الدمام', lat: 26.4207, lon: 50.0888, tz: 3 },
  { name: 'أبها', lat: 18.2164, lon: 42.5053, tz: 3 },
  { name: 'تبوك', lat: 28.3835, lon: 36.5662, tz: 3 },
  { name: 'حائل', lat: 27.5114, lon: 41.7208, tz: 3 },
  { name: 'إسطنبول', lat: 41.0082, lon: 28.9784, tz: 3 },
  { name: 'كمبالا (على خط الاستواء)', lat: 0.3476, lon: 32.5825, tz: 3 },
  { name: 'سنغافورة', lat: 1.3521, lon: 103.8198, tz: 8 },
  { name: 'كيب تاون (نصف الأرض الجنوبي)', lat: -33.9249, lon: 18.4241, tz: 2 },
  { name: 'ريكيافيك (قرب القطب)', lat: 64.1466, lon: -21.9426, tz: 0 },
  { name: 'القطب الشمالي', lat: 89.9, lon: 0, tz: 0 },
];

// ---------------------------------------------------------------- colours (linear, the renderer outputs sRGB)
const C = (hex) => new THREE.Color(hex).toArray();
const COL = {
  brass: C('#d9b36a'), brassDim: C('#a88a52'), parch: C('#e9dfc8'), dust: C('#8c9ac4'),
  fajr: C('#5cc8b8'), asr: C('#e8a54b'), horizon: C('#e07a6a'), qibla: C('#f3d48b'),
  sunPath: C('#ffcf7a'), constel: C('#7f95d6'), globe: C('#c9a45e'),
};

const PLATE_Y = 0;    // plate centre in world
const S = 0.6;        // plate scale: plate units → world units
const R_CAP = Math.tan((90 + 23.44) / 2 * D2R); // tropic of Capricorn: the edge of an astrolabe plate
const R_RIM = 1.62;

// ---------------------------------------------------------------- shell
const ui = createShell({
  title: 'ذات الحلق',
  scale: 'سماؤك فوق مكانك وزمانك',
  hint: 'اسحب لتدور حول الكرة، واضغط على أي نجم لتعرف اسمه وقصته',
  readouts: [
    { key: 'clock', label: 'الوقت المحلي' },
    { key: 'sun', label: 'الشمس الآن' },
  ],
  controls: [
    { type: 'group', label: 'طريقة العرض' },
    { type: 'segmented', key: 'mode', value: 'sphere', options: [
      { value: 'sphere', label: 'الكرة' },
      { value: 'inside', label: 'من الداخل' },
      { value: 'astrolabe', label: 'الأسطرلاب' },
    ] },
    { type: 'group', label: 'المكان' },
    { type: 'select', key: 'city', value: 0, options: [...CITIES.map((c, i) => ({ value: i, label: c.name })), { value: 'geo', label: 'موقعي الحالي' }] },
    { type: 'group', label: 'الزمن' },
    { type: 'range', key: 'day', label: 'اليوم', min: 0, max: 365, step: 1, value: 0, format: (v) => dayLabel(v) },
    { type: 'range', key: 'minute', label: 'الساعة', min: 0, max: 1439, step: 1, value: 0, format: (v) => fmtTime(v / 60) },
    { type: 'segmented', key: 'rate', label: 'سرعة الزمن', value: 0, options: [
      { value: 0, label: 'متوقف' },
      { value: 1, label: 'حقيقي' },
      { value: 120, label: '٢ دقيقة/ث' },
      { value: 1800, label: 'نصف ساعة/ث' },
      { value: 86400, label: 'يوم/ث' },
    ] },
    { type: 'buttons', items: [{ label: 'الآن', action: () => setNow() }] },
    { type: 'group', label: 'الصلاة والقبلة' },
    { type: 'toggle', key: 'prayer', label: 'مواضع الشمس عند كل صلاة', value: true },
    { type: 'toggle', key: 'qibla', label: 'اتجاه القبلة', value: true },
    { type: 'group', label: 'السماء' },
    { type: 'toggle', key: 'stars', label: 'النجوم والكوكبات', value: true },
    { type: 'toggle', key: 'names', label: 'الأسماء العربية', value: true },
    { type: 'toggle', key: 'milky', label: 'درب التبانة', value: true },
    { type: 'group', label: 'تحديات الأسطرلاب', when: (v) => v.mode === 'astrolabe' },
    { type: 'note', when: (v) => v.mode === 'astrolabe', html: 'اسحب الشبكة النحاسية لتدويرها، وكأنك تحرّك السماء بيدك. العضادة تتبع الشمس وتقرأ لك الساعة على الحافة.' },
    { type: 'buttons', when: (v) => v.mode === 'astrolabe', items: [
      { label: 'متى تشرق الشمس؟', action: () => startChallenge('sunrise') },
      { label: 'متى يدخل العصر؟', action: () => startChallenge('asr') },
    ] },
  ],
  onChange(key, v) {
    if (key === 'mode') setMode(v);
    if (key === 'city') setCity(v);
    if (key === 'day' || key === 'minute') timeFromSliders();
    if (key === 'rate' && v > 0) challenge = null;
  },
  info: `
    <h2>ذات الحلق: السماء في يدك</h2>
    <p>«ذات الحلق» جهاز فلكي من حلقات متداخلة يمثّل حركة السماء حول الأرض. الحلقة الأفقية هي أفقك، والعمودية هي خط الزوال (خط الظهر)، وفي الداخل كرة السماء التي تدور حول محور يميل بزاوية تساوي خط عرض مدينتك. استعمله بطليموس، ثم طوّره الفلكيون المسلمون في مرصد مراغة الذي أسسه نصير الدين الطوسي عام ١٢٥٩م، وفي مرصد سمرقند ومرصد إسطنبول.</p>
    <h3>كل شيء هنا محسوب</h3>
    <p>موقع الشمس على دائرة البروج، والزمن النجمي، وارتفاع كل نجم وسمته، كلها تُحسب لحظياً للمدينة والوقت اللذين تختارهما. غيّر المدينة وانظر كيف يميل المحور: في مكة يرتفع القطب ٢١ درجة، وفي القطب الشمالي يصير عمودياً فتدور النجوم أفقياً ولا تغيب أبداً.</p>
    <h3>أوقات الصلاة من الشمس</h3>
    <p>أوقات الصلاة في حقيقتها مواضع للشمس في السماء. الفجر حين تكون الشمس ١٨٫٥ درجة تحت الأفق (تقويم أم القرى)، وهي اللحظة التي يبدأ فيها أول ضوء بالظهور. الظهر حين تعبر الشمس خط الزوال، والعصر حين يصير ظل الشيء مثله مضافاً إليه ظل الزوال، والمغرب حين تغيب، والعشاء بعد المغرب بتسعين دقيقة في تقويم أم القرى (ومئة وعشرين في رمضان). الحلقة المنقطة الخضراء تحت الأفق هي حلقة الفجر، والبرتقالية حلقة العصر. شغّل الزمن وراقب الشمس تعبرها.</p>
    <p>جرّب ريكيافيك في شهر يونيو: الشمس لا تنزل ١٨ درجة تحت الأفق أبداً، فلا يحدث فجر فلكي، وهي مسألة ناقشها الفقهاء والفلكيون فعلاً.</p>
    <h3>القبلة</h3>
    <p>اتجاه القبلة هو أقصر طريق على سطح الكرة الأرضية إلى الكعبة، أي «الدائرة العظمى». حسبه البيروني والفلكيون المسلمون بحساب المثلثات الكروية قبل ألف سنة، وهي نفس المعادلة المستخدمة هنا.</p>
    <h3>أسماء النجوم</h3>
    <p>معظم النجوم اللامعة تحمل في كل لغات العالم أسماء عربية محرّفة: Aldebaran من «الدبران»، وAltair من «النسر الطائر»، وFomalhaut من «فم الحوت». السبب كتاب «صور الكواكب الثابتة» لعبد الرحمن الصوفي (٩٦٤م)، الذي تُرجم إلى اللاتينية وصار مرجع أوروبا لقرون. اضغط على أي نجم لتعرف اسمه وقصته.</p>
    <h3>الأسطرلاب</h3>
    <p>الأسطرلاب هو ذات الحلق نفسها مضغوطة في صفيحة نحاسية مسطحة. الفكرة رياضية بحتة: نُسقط الكرة من قطبها الجنوبي على مستوى خط الاستواء («الإسقاط المجسّم»)، فتتحول كل دائرة على الكرة إلى دائرة على الصفيحة. اضغط «الأسطرلاب» وشاهد الكرة تنفرد أمامك. صُنّاع الأسطرلاب كانوا علماء، ومنهم مريم الإسطرلابية في حلب في القرن العاشر الميلادي.</p>
    <p>الصفيحة الثابتة («الصفيحة») تحمل أفق مدينتك ودوائر الارتفاع، والشبكة الدوّارة فوقها («العنكبوت») تحمل النجوم ودائرة البروج. تدوير الشبكة يساوي مرور الزمن. جرّب التحديين في لوحة التحكم لتستخدمه كما استخدمه الفلكيون.</p>
  `,
});

// ---------------------------------------------------------------- stage
const stage = createStage({ bloom: { strength: 0.55, radius: 0.4, threshold: 0.55 }, exposure: 1, startScale: 1, minScale: 0.6 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
stage.renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#060a1a');
const camera = new THREE.PerspectiveCamera(42, 1, 0.005, 100);
camera.position.set(2.3, 1.35, 2.9);
stage.setScene(scene, camera);

const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.9;
controls.maxDistance = 7;
controls.rotateSpeed = 0.6;

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
document.body.append(labelRenderer.domElement);

// ---------------------------------------------------------------- state
const state = {
  lat: CITIES[0].lat, lon: CITIES[0].lon, tz: CITIES[0].tz, place: CITIES[0].name,
  ms: Date.now(),
  mode: 'sphere',
  k: 0, kIn: 0,      // astrolabe morph, inside view
  L: 0,               // local sidereal time (rad)
  sun: null,
  times: null, dayKey: '',
};
let challenge = null;

// Observer frame: Q = equator's meridian point, E = east, P = celestial pole (horizon frame: x east, y up, z south).
let cphi = 1, sphi = 0;
function setLatitude(lat) { cphi = Math.cos(lat * D2R); sphi = Math.sin(lat * D2R); }

// ---------------------------------------------------------------- line batches
const LINE_VS = /* glsl */`
attribute float aAlpha;
attribute vec3 aColor;
varying vec4 vC;
void main() { vC = vec4(aColor, aAlpha); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const LINE_FS = /* glsl */`
varying vec4 vC;
void main() { if (vC.a < 0.004) discard; gl_FragColor = vec4(vC.rgb * vC.a, 1.0); }
`;

const tmpF = { x: 0, y: 0, z: 0 };
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Transform a point from its space into the observer's frame-local equatorial coordinates.
function toFrame(space, x, y, z, out) {
  if (space === 'sky') {
    const c = Math.cos(state.L), s = Math.sin(state.L);
    out.x = x * c + y * s; out.y = -x * s + y * c; out.z = z;
  } else if (space === 'hz') {
    out.x = y * cphi + z * sphi; out.y = x; out.z = y * sphi - z * cphi;
  } else { out.x = x; out.y = y; out.z = z; }
  return out;
}
// Frame-local → world (horizon frame).
const wx = (f) => f.y, wy = (f) => f.x * cphi + f.z * sphi, wz = (f) => f.x * sphi - f.z * cphi;
// Stereographic projection from the south celestial pole onto the equatorial plane.
function stereo(f, out) {
  const len = Math.hypot(f.x, f.y, f.z) || 1;
  const d = Math.max(1 + f.z / len, 0.02);
  let X = f.x / len / d, Y = f.y / len / d;
  const r = Math.hypot(X, Y);
  if (r > 3) { X *= 3 / r; Y *= 3 / r; }
  out.X = X; out.Y = Y; out.r = r;
  return out;
}
const st = { X: 0, Y: 0, r: 0 };

class Batch {
  constructor() { this.items = []; }
  add(item) {
    this.items.push(Object.assign({ alpha: 1, show3D: 1, showPlate: 1, inside: 1, clip: true, visible: () => true }, item));
    return this.items[this.items.length - 1];
  }
  build() {
    let n = 0;
    for (const it of this.items) { it.offset = n; it.count = it.pts.length / 3; n += it.count; }
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    for (const it of this.items) for (let i = 0; i < it.count; i++) this.col.set(it.color, (it.offset + i) * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update() {
    const { k, kIn } = state, pos = this.pos, al = this.alpha;
    for (const it of this.items) {
      const vis = it.visible();
      const modeMul = (it.show3D * (1 - kIn) + it.inside * kIn) * (1 - k) + it.showPlate * k;
      const base = it.alpha * modeMul * (vis ? 1 : 0);
      for (let i = 0; i < it.count; i++) {
        const j = (it.offset + i) * 3, src = i * 3;
        let a = base;
        let x3, y3, z3, px, py;
        if (it.space === 'plate') {
          px = -it.pts[src + 1] * S; py = it.pts[src] * S + PLATE_Y;
          x3 = px; y3 = py; z3 = 0;
        } else {
          toFrame(it.space, it.pts[src], it.pts[src + 1], it.pts[src + 2], tmpF);
          x3 = wx(tmpF); y3 = wy(tmpF); z3 = wz(tmpF);
          stereo(tmpF, st);
          px = -st.Y * S; py = st.X * S + PLATE_Y;
          if (it.clip) a *= 1 - k * smooth(R_CAP, R_CAP + 0.06, st.r);
          if (it.dimBelow && y3 < -0.001) a *= 0.28 + 0.72 * k;
        }
        if (it.dash && ((i >> 1) % 2)) a *= 0.15;
        pos[j] = x3 + (px - x3) * k;
        pos[j + 1] = y3 + (py - y3) * k;
        pos[j + 2] = z3 * (1 - k);
        al[it.offset + i] = a;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

// Geometry helpers: all return flat arrays of segment end points.
function curve(fn, n) {
  const out = new Float32Array(n * 6);
  let p = fn(0);
  for (let i = 1; i <= n; i++) {
    const q = fn(i / n);
    out.set(p, (i - 1) * 6); out.set(q, (i - 1) * 6 + 3);
    p = q;
  }
  return out;
}
const circleZ = (r, z, n = 256) => curve((t) => [Math.cos(t * TAU) * r, Math.sin(t * TAU) * r, z], n); // in an xy-plane at height z
const circleHz = (r, y, n = 256) => curve((t) => [Math.cos(t * TAU) * r, y, Math.sin(t * TAU) * r], n);  // parallel to the horizon
function segs(list) { return new Float32Array(list.flat()); }

const lines = new Batch();
const PALE = 0.55;

// --- celestial sphere (rotates with the sky)
const EPS = 23.4393 * D2R;
const ecl = (lam, b = 0, r = 1) => {
  // ecliptic longitude/latitude → equatorial cartesian
  const x = Math.cos(b) * Math.cos(lam), y = Math.cos(b) * Math.sin(lam), z = Math.sin(b);
  return [x * r, (y * Math.cos(EPS) - z * Math.sin(EPS)) * r, (y * Math.sin(EPS) + z * Math.cos(EPS)) * r];
};
lines.add({ space: 'sky', pts: circleZ(1, 0, 360), color: COL.brass, alpha: 0.95, inside: 0.5 });
lines.add({ space: 'sky', pts: circleZ(0.985, 0, 360), color: COL.brass, alpha: 0.45, inside: 0.2, showPlate: 0.4 });
{
  const t = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * TAU, len = i % 4 === 0 ? 0.045 : 0.02;
    t.push([Math.cos(a), Math.sin(a), 0, Math.cos(a) * (1 - len), Math.sin(a) * (1 - len), 0]);
  }
  lines.add({ space: 'sky', pts: segs(t), color: COL.brass, alpha: 0.6, inside: 0.3 });
}
// ecliptic band with graduations
lines.add({ space: 'sky', pts: curve((t) => ecl(t * TAU), 360), color: COL.brass, alpha: 1, inside: 0.6 });
lines.add({ space: 'sky', pts: curve((t) => ecl(t * TAU, 3 * D2R), 360), color: COL.brass, alpha: 0.45, inside: 0.25 });
lines.add({ space: 'sky', pts: curve((t) => ecl(t * TAU, -3 * D2R), 360), color: COL.brass, alpha: 0.45, inside: 0.25 });
{
  const t = [];
  for (let i = 0; i < 72; i++) {
    const lam = (i / 72) * TAU, major = i % 6 === 0;
    t.push([...ecl(lam, major ? -3 * D2R : 0), ...ecl(lam, 3 * D2R)]);
  }
  lines.add({ space: 'sky', pts: segs(t), color: COL.brass, alpha: 0.7, inside: 0.35 });
}
// tropics, polar circles, colures, axis
const ringsMinor = [];
ringsMinor.push(lines.add({ space: 'sky', pts: circleZ(Math.cos(EPS), Math.sin(EPS), 256), color: COL.brassDim, alpha: PALE, inside: 0.25 }));
ringsMinor.push(lines.add({ space: 'sky', pts: circleZ(Math.cos(EPS), -Math.sin(EPS), 256), color: COL.brassDim, alpha: PALE, inside: 0.25 }));
ringsMinor.push(lines.add({ space: 'sky', pts: circleZ(Math.sin(EPS), Math.cos(EPS), 128), color: COL.brassDim, alpha: 0.4, inside: 0.2, showPlate: 0.6 }));
ringsMinor.push(lines.add({ space: 'sky', pts: circleZ(Math.sin(EPS), -Math.cos(EPS), 128), color: COL.brassDim, alpha: 0.4, inside: 0.2, showPlate: 0 }));
lines.add({ space: 'sky', pts: curve((t) => [Math.cos(t * TAU), 0, Math.sin(t * TAU)], 256), color: COL.brassDim, alpha: 0.4, inside: 0.15, showPlate: 0.5 });
lines.add({ space: 'sky', pts: curve((t) => [0, Math.cos(t * TAU), Math.sin(t * TAU)], 256), color: COL.brassDim, alpha: 0.4, inside: 0.15, showPlate: 0.5 });
lines.add({ space: 'eq', pts: segs([[0, 0, -1.35, 0, 0, 1.35]]), color: COL.brass, alpha: 0.75, inside: 0, showPlate: 0 });

// --- fixed frame (horizon-based): horizon and meridian rings with graduated limbs
const RH = 1.17, RM = 1.11;
lines.add({ space: 'hz', pts: circleHz(RH, 0, 360), color: COL.brass, alpha: 1, inside: 0.9, showPlate: 0.9 });
lines.add({ space: 'hz', pts: circleHz(RH - 0.035, 0, 360), color: COL.brass, alpha: 0.55, inside: 0.5, showPlate: 0 });
{
  const t = [];
  for (let i = 0; i < 360; i += 2) {
    const a = i * D2R, len = i % 30 === 0 ? 0.07 : i % 10 === 0 ? 0.04 : 0.02;
    t.push([Math.sin(a) * RH, 0, -Math.cos(a) * RH, Math.sin(a) * (RH + len), 0, -Math.cos(a) * (RH + len)]);
  }
  lines.add({ space: 'hz', pts: segs(t), color: COL.brass, alpha: 0.7, inside: 0.8, showPlate: 0 });
}
lines.add({ space: 'hz', pts: curve((t) => [0, Math.sin(t * TAU) * RM, Math.cos(t * TAU) * RM], 360), color: COL.brass, alpha: 0.95, inside: 0.35, showPlate: 0.8 });
lines.add({ space: 'hz', pts: curve((t) => [0, Math.sin(t * TAU) * (RM - 0.035), Math.cos(t * TAU) * (RM - 0.035)], 360), color: COL.brass, alpha: 0.45, inside: 0.15, showPlate: 0 });
{
  const t = [];
  for (let i = 0; i < 360; i += 2) {
    const a = i * D2R, len = i % 30 === 0 ? 0.06 : i % 10 === 0 ? 0.035 : 0.018;
    t.push([0, Math.sin(a) * RM, Math.cos(a) * RM, 0, Math.sin(a) * (RM + len), Math.cos(a) * (RM + len)]);
  }
  lines.add({ space: 'hz', pts: segs(t), color: COL.brass, alpha: 0.6, inside: 0.2, showPlate: 0 });
}
// zenith cross
lines.add({ space: 'hz', pts: segs([[-0.03, 1, 0, 0.03, 1, 0], [0, 1, -0.03, 0, 1, 0.03]]), color: COL.parch, alpha: 0.7, inside: 0.6 });

// --- tympan: almucantars every 10° and azimuth circles, shown on the astrolabe plate
for (let h = 10; h < 90; h += 10) lines.add({ space: 'hz', pts: circleHz(Math.cos(h * D2R), Math.sin(h * D2R), 180), color: COL.parch, alpha: 0.32, show3D: 0, inside: 0 });
for (let az = 0; az < 180; az += 30) {
  const a = az * D2R;
  lines.add({ space: 'hz', pts: curve((t) => { const u = t * Math.PI; return [Math.cos(u) * Math.sin(a), Math.sin(u), -Math.cos(u) * Math.cos(a)]; }, 120), color: COL.parch, alpha: 0.22, show3D: 0, inside: 0 });
}

// --- prayer almucantars (rebuilt when the day changes): Fajr at -18.5°, Asr at its daily altitude, sunrise/sunset at -0.833°
const prayerOn = () => ui.values.prayer;
const fajrRing = lines.add({ space: 'hz', pts: circleHz(Math.cos(18.5 * D2R), -Math.sin(18.5 * D2R), 180), color: COL.fajr, alpha: 0.8, dash: true, visible: prayerOn, inside: 0.6 });
const asrRing = lines.add({ space: 'hz', pts: circleHz(1, 0, 180), color: COL.asr, alpha: 0.8, dash: true, visible: prayerOn, inside: 0.6 });
lines.add({ space: 'hz', pts: circleHz(Math.cos(0.833 * D2R), -Math.sin(0.833 * D2R), 180), color: COL.horizon, alpha: 0.5, dash: true, visible: prayerOn, inside: 0, show3D: 0.6 });

// --- the sun's path today (a circle of constant declination), dimmed below the horizon
const sunPath = lines.add({ space: 'eq', pts: circleZ(1, 0, 240), color: COL.sunPath, alpha: 0.85, dimBelow: true, inside: 0.6 });

// --- qibla arrow on the horizon
const qiblaOn = () => ui.values.qibla;
const qiblaArrow = lines.add({ space: 'hz', pts: new Float32Array(18), color: COL.qibla, alpha: 1, visible: qiblaOn, inside: 1, showPlate: 0.8 });

// --- Earth at the centre (observer on top) and the observer's pin
{
  const t = [];
  const R = 0.11;
  for (let lat = -60; lat <= 60; lat += 30) {
    const z = Math.sin(lat * D2R) * R, r = Math.cos(lat * D2R) * R;
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * TAU, a1 = ((i + 1) / 48) * TAU;
      t.push([Math.cos(a0) * r, Math.sin(a0) * r, z, Math.cos(a1) * r, Math.sin(a1) * r, z]);
    }
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const a = lon * D2R;
    for (let i = 0; i < 48; i++) {
      const u0 = (i / 48) * TAU, u1 = ((i + 1) / 48) * TAU;
      t.push([Math.cos(u0) * Math.cos(a) * R, Math.cos(u0) * Math.sin(a) * R, Math.sin(u0) * R, Math.cos(u1) * Math.cos(a) * R, Math.cos(u1) * Math.sin(a) * R, Math.sin(u1) * R]);
    }
  }
  lines.add({ space: 'eq', pts: segs(t), color: COL.globe, alpha: 0.5, inside: 0, showPlate: 0 });
  lines.add({ space: 'hz', pts: segs([[0, 0.11, 0, 0, 0.2, 0]]), color: COL.qibla, alpha: 1, inside: 0, showPlate: 0 });
}

// --- constellation figures as great-circle arcs
const starVec = (s, r = 1) => [Math.cos(s.dec) * Math.cos(s.ra) * r, Math.cos(s.dec) * Math.sin(s.ra) * r, Math.sin(s.dec) * r];
function arc(a, b, out) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const ang = va.angleTo(vb), n = Math.max(2, Math.ceil(ang / (2 * D2R)));
  let p = va.clone();
  for (let i = 1; i <= n; i++) {
    const q = new THREE.Vector3().copy(va).lerp(vb, i / n).normalize();
    out.push([p.x, p.y, p.z, q.x, q.y, q.z]);
    p = q;
  }
}
const constellationOn = () => ui.values.stars;
{
  const t = [];
  for (const [, chains] of CONSTELLATIONS) for (const chain of chains) for (let i = 0; i < chain.length - 1; i++) {
    const a = STAR_BY_KEY[chain[i]], b = STAR_BY_KEY[chain[i + 1]];
    if (a && b) arc(starVec(a), starVec(b), t);
  }
  lines.add({ space: 'sky', pts: segs(t), color: COL.constel, alpha: 0.42, visible: constellationOn, inside: 0.6, showPlate: 0 });
}

// --- astrolabe-only parts: the mater's rim with degrees and hours, the throne, and the rule (alidade)
{
  const t = [];
  const rim = [];
  for (const r of [R_CAP, R_RIM, R_RIM + 0.07, R_RIM + 0.17]) rim.push(...Array.from(curve((u) => [Math.cos(u * TAU) * r, Math.sin(u * TAU) * r, 0], 256)));
  lines.add({ space: 'plate', pts: new Float32Array(rim), color: COL.brass, alpha: 0.9, show3D: 0, inside: 0 });
  for (let i = 0; i < 360; i++) {
    const a = i * D2R, len = i % 15 === 0 ? 0.07 : i % 5 === 0 ? 0.045 : 0.02;
    t.push([Math.cos(a) * R_RIM, Math.sin(a) * R_RIM, 0, Math.cos(a) * (R_RIM + len), Math.sin(a) * (R_RIM + len), 0]);
  }
  lines.add({ space: 'plate', pts: segs(t), color: COL.brass, alpha: 0.75, show3D: 0, inside: 0 });
  // the throne (kursi) arch above the rim
  const thr = [];
  const top = R_RIM + 0.17;
  thr.push(...Array.from(curve((u) => { const a = (u - 0.5) * 0.9; return [top + 0.22 * Math.cos(a * 2.2) + 0.03, Math.sin(a) * 0.32, 0]; }, 40)));
  thr.push(...Array.from(curve((u) => { const a = (u - 0.5) * 0.7; return [top + 0.12 * Math.cos(a * 2.6) + 0.02, Math.sin(a) * 0.2, 0]; }, 30)));
  lines.add({ space: 'plate', pts: new Float32Array(thr), color: COL.brass, alpha: 0.85, show3D: 0, inside: 0 });
}
const rule = lines.add({ space: 'plate', pts: new Float32Array(12), color: COL.qibla, alpha: 0.95, show3D: 0, inside: 0 });

lines.build();

// ---------------------------------------------------------------- stars
const WARM = new Set(['betelgeuse', 'antares', 'aldebaran', 'arcturus', 'pollux', 'mirach', 'schedar', 'alphard', 'kochab', 'dubhe', 'enif', 'scheat', 'menkar', 'gacrux', 'hamal', 'eltanin', 'rasalgethi', 'mirfak', 'diphda', 'alnair', 'tarazed']);
const COOL = new Set(['rigel', 'spica', 'regulus', 'achernar', 'hadar', 'acrux', 'mimosa', 'bellatrix', 'alnilam', 'alnitak', 'mintaka', 'saiph', 'adhara', 'shaula', 'vega', 'alkaid', 'elnath', 'alcyone', 'deneb', 'sirius', 'castor', 'algol', 'alpheratz', 'menkalinan']);
const STAR_VS = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec4 vC;
void main() {
  vC = vec4(aColor, aAlpha);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale;
}
`;
const STAR_FS = /* glsl */`
varying vec4 vC;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0 || vC.a < 0.01) discard;
  float core = exp(-d * 9.0), halo = exp(-d * 2.2) * 0.35;
  gl_FragColor = vec4(vC.rgb * (core + halo) * vC.a, 1.0);
}
`;
const starPos = new Float32Array(STARS.length * 3);
const starAlpha = new Float32Array(STARS.length);
const starSize = new Float32Array(STARS.length);
const starCol = new Float32Array(STARS.length * 3);
const starBase = STARS.map((s) => starVec(s));
STARS.forEach((s, i) => {
  starSize[i] = Math.max(2.2, Math.min(11, 7.6 - 1.6 * s.mag));
  const c = WARM.has(s.key) ? [1.0, 0.72, 0.45] : COOL.has(s.key) ? [0.72, 0.84, 1.0] : [1.0, 0.96, 0.9];
  starCol.set(c, i * 3);
});
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3).setUsage(THREE.DynamicDrawUsage));
starGeo.setAttribute('aAlpha', new THREE.BufferAttribute(starAlpha, 1).setUsage(THREE.DynamicDrawUsage));
starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
starGeo.setAttribute('aColor', new THREE.BufferAttribute(starCol, 3));
const starUniforms = { uScale: { value: 1 } };
const starPoints = new THREE.Points(starGeo, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
starPoints.frustumCulled = false;
scene.add(starPoints);

// The sun: one bright point riding the ecliptic.
const sunGeo = new THREE.BufferGeometry();
sunGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
sunGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array([1]), 1));
sunGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([30]), 1));
sunGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([1.6, 1.2, 0.6]), 3));
const sunPoint = new THREE.Points(sunGeo, starPoints.material);
sunPoint.frustumCulled = false;
scene.add(sunPoint);

// ---------------------------------------------------------------- meshes: Milky Way, sky dome, ground, horizon disc, plate, Kaaba
const NOISE = /* glsl */`
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.07 + 7.3; a *= 0.5; } return s; }
`;
const milky = new THREE.Mesh(new THREE.SphereGeometry(0.995, 96, 48), new THREE.ShaderMaterial({
  uniforms: { uAmount: { value: 0.5 } },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying vec3 vP;
    uniform float uAmount;
    ${NOISE}
    void main() {
      vec3 d = normalize(vP);
      // Galactic frame in equatorial coordinates (J2000).
      const vec3 NGP = vec3(-0.8677, -0.1981, 0.4560);
      const vec3 GC = vec3(-0.0549, -0.8734, -0.4839);
      vec3 Y = cross(NGP, GC);
      float b = asin(clamp(dot(d, NGP), -1.0, 1.0));
      float l = atan(dot(d, Y), dot(d, GC));
      float band = exp(-b * b / (2.0 * 0.09 * 0.09));
      float bulge = exp(-(l * l) / 0.25) * exp(-b * b / 0.02);
      float cl = fbm(d * 9.0);
      float fine = fbm(d * 38.0 + 2.0);
      float dust = smoothstep(0.42, 0.68, fbm(d * 16.0 + 4.0)) * exp(-b * b / (2.0 * 0.03 * 0.03));
      float rift = exp(-pow((l - 0.9) / 0.6, 2.0)) * exp(-pow(b / 0.035, 2.0));
      float v = (band * (0.25 + 0.9 * cl) + bulge * 0.6 * cl) * (0.55 + 0.9 * fine * fine) * (1.0 - 0.75 * dust) * (1.0 - 0.6 * rift);
      vec3 col = mix(vec3(0.42, 0.5, 0.85), vec3(1.0, 0.82, 0.6), clamp(bulge * 2.0 + cl * 0.3, 0.0, 1.0));
      gl_FragColor = vec4(col * v * 0.16 * uAmount, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
milky.matrixAutoUpdate = false;
milky.frustumCulled = false;
scene.add(milky);

const dome = new THREE.Mesh(new THREE.SphereGeometry(20, 64, 32), new THREE.ShaderMaterial({
  uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uAmount: { value: 0 } },
  vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying vec3 vD;
    uniform vec3 uSun;
    uniform float uAmount;
    void main() {
      vec3 d = normalize(vD);
      float sh = uSun.y;
      float up = max(d.y, 0.0);
      float day = smoothstep(-0.1, 0.22, sh);
      vec3 zen = mix(vec3(0.003, 0.005, 0.014), vec3(0.05, 0.16, 0.45), day);
      vec3 hor = mix(vec3(0.008, 0.011, 0.026), vec3(0.42, 0.58, 0.82), day);
      vec3 col = mix(hor, zen, pow(up, 0.45));
      // Twilight: the first glow appears exactly as the sun climbs past -18°.
      float tw = smoothstep(-0.309, -0.04, sh) * (1.0 - smoothstep(0.06, 0.3, sh));
      vec2 sd = normalize(uSun.xz + 1e-5);
      float toward = max(dot(normalize(d.xz + 1e-5), sd), 0.0);
      float low = exp(-up * 5.0);
      col += (vec3(1.0, 0.42, 0.16) * pow(toward, 3.0) * 0.8 + vec3(0.32, 0.26, 0.55) * 0.18) * tw * low;
      float cs = max(dot(d, normalize(uSun)), 0.0);
      col += vec3(1.0, 0.8, 0.55) * (pow(cs, 600.0) * 3.0 + pow(cs, 14.0) * 0.18 * day) * smoothstep(-0.03, 0.02, sh);
      if (d.y < 0.0) col *= 0.25;
      gl_FragColor = vec4(col, uAmount);
    }`,
  side: THREE.BackSide, transparent: true, depthWrite: false,
}));
dome.renderOrder = -10;
scene.add(dome);

const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 64), new THREE.ShaderMaterial({
  uniforms: { uAmount: { value: 0 }, uDay: { value: 0 } },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vP; uniform float uAmount; uniform float uDay;
    void main(){ float r = length(vP.xy); vec3 c = mix(vec3(0.012, 0.011, 0.012), vec3(0.08, 0.065, 0.05), uDay) * (0.55 + 0.45 * smoothstep(20.0, 1.0, r)); gl_FragColor = vec4(c, uAmount); }`,
  transparent: true, side: THREE.DoubleSide,
}));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.004;
ground.renderOrder = -5;
scene.add(ground);

const horizonDisc = new THREE.Mesh(new THREE.CircleGeometry(RH, 96), new THREE.MeshBasicMaterial({ color: '#2a3a7a', transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
horizonDisc.rotation.x = -Math.PI / 2;
scene.add(horizonDisc);

const plateDisc = new THREE.Mesh(new THREE.CircleGeometry((R_RIM + 0.19) * S, 128), new THREE.ShaderMaterial({
  uniforms: { uAmount: { value: 0 } },
  vertexShader: `varying vec2 vU; void main(){ vU = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying vec2 vU;
    uniform float uAmount;
    ${NOISE}
    void main() {
      float r = length(vU);
      float a = atan(vU.y, vU.x);
      float brush = vn(vec3(r * 140.0, a * 2.0, 0.0)) * 0.5 + vn(vec3(r * 40.0, a * 30.0, 3.0)) * 0.5;
      vec3 c = mix(vec3(0.055, 0.04, 0.022), vec3(0.11, 0.08, 0.042), brush) * (1.0 - 0.35 * smoothstep(0.6, 1.1, r));
      gl_FragColor = vec4(c, uAmount);
    }`,
  transparent: true, depthWrite: false,
}));
plateDisc.position.set(0, PLATE_Y, -0.02);
plateDisc.renderOrder = -4;
scene.add(plateDisc);

const kaaba = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.045), new THREE.MeshBasicMaterial({ color: '#050505', transparent: true }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: '#e3c486', transparent: true }));
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.0465, 0.008, 0.0465), new THREE.MeshBasicMaterial({ color: '#c9a45e', transparent: true }));
  band.position.y = 0.013;
  box.position.y = edges.position.y = 0.025;
  band.position.y += 0.012;
  kaaba.add(box, edges, band);
}
scene.add(kaaba);

// ---------------------------------------------------------------- labels
const labels = [];
function label(text, cls, space, v, opts = {}) {
  const div = el('div', { class: 'lbl ' + cls }, el('span', {}, text));
  const obj = new CSS2DObject(div);
  scene.add(obj);
  const L = Object.assign({ obj, div, space, v, show3D: 1, inside: 1, showPlate: 1, visible: () => true }, opts);
  labels.push(L);
  return L;
}
ZODIAC.forEach((name, i) => label(name, 'lbl-zodiac', 'sky', ecl((i * 30 + 15) * D2R, 7 * D2R, 1.0), { inside: 0.9 }));
[['شمال', 0], ['شرق', 90], ['جنوب', 180], ['غرب', 270]].forEach(([t, az]) => {
  const a = az * D2R;
  label(t, 'lbl-compass', 'hz', [Math.sin(a) * (RH + 0.12), 0.0, -Math.cos(a) * (RH + 0.12)], { showPlate: 0.85 });
});
const qiblaLabel = label('القبلة', 'lbl-qibla', 'hz', [0, 0.06, -RH], { visible: qiblaOn, showPlate: 0.8 });
const sunLabel = label('الشمس', 'lbl-sun', 'sky', [1, 0, 0]);
const PRAYER_NAMES = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
const prayerLabels = Object.fromEntries(Object.entries(PRAYER_NAMES).map(([k, t]) => [k, label(t, 'lbl-prayer lbl-p-' + k, 'eq', [1, 0, 0], { visible: prayerOn, inside: 0.9 })]));
const hourLabels = [];
for (let h = 0; h < 24; h += 1) {
  const L = label(String(h === 0 ? 24 : h), 'lbl-hour', 'plate', [0, 0, 0], { show3D: 0, inside: 0 });
  L.hour = h;
  hourLabels.push(L);
}
// Fewer names from outside (the sphere is small), more from inside where the sky fills the view.
const nameLimit = () => (state.kIn > 0.5 ? 2.5 : state.k > 0.5 ? 0.9 : 0.9);
const FEATURED = new Set(['alcyone', 'polaris', 'canopus']);
const starLabels = STARS.map((s, i) => (s.ar ? label(s.ar, 'lbl-star', 'sky', starVec(s), { star: i, visible: () => ui.values.stars && ui.values.names && (s.mag < nameLimit() || FEATURED.has(s.key)) }) : null));
const constLabels = CONSTELLATIONS.map(([name, chains]) => {
  const keys = [...new Set(chains.flat())];
  const v = new THREE.Vector3();
  keys.forEach((k) => v.add(new THREE.Vector3(...starVec(STAR_BY_KEY[k]))));
  v.normalize();
  return label(name, 'lbl-const', 'sky', v.toArray(), { visible: () => ui.values.stars && ui.values.names, show3D: 0, showPlate: 0 });
});
const hover = label('', 'lbl-hover', 'sky', [1, 0, 0]);
let hoverOn = false;

const camDir = new THREE.Vector3();
function updateLabels() {
  const { k, kIn } = state;
  camera.getWorldDirection(camDir);
  const camLen = camera.position.length();
  for (const L of labels) {
    const isHover = L === hover;
    if (isHover && !hoverOn) { L.obj.visible = false; continue; }
    const mul = isHover ? 1 : (L.show3D * (1 - kIn) + L.inside * kIn) * (1 - k) + L.showPlate * k;
    if (mul < 0.05 || L.missing || !L.visible()) { L.obj.visible = false; continue; }
    let x3, y3, z3, px, py, r = 0;
    if (L.space === 'plate') {
      px = -L.v[1] * S; py = L.v[0] * S + PLATE_Y; x3 = px; y3 = py; z3 = 0;
    } else {
      toFrame(L.space, L.v[0], L.v[1], L.v[2], tmpF);
      x3 = wx(tmpF); y3 = wy(tmpF); z3 = wz(tmpF);
      stereo(tmpF, st); r = st.r;
      px = -st.Y * S; py = st.X * S + PLATE_Y;
    }
    L.obj.position.set(x3 + (px - x3) * k, y3 + (py - y3) * k, z3 * (1 - k));
    let o = mul;
    if (k < 0.5 && kIn < 0.5) {
      // hide labels on the far side of the sphere
      const len = Math.hypot(x3, y3, z3) || 1;
      const facing = (x3 * camera.position.x + y3 * camera.position.y + z3 * camera.position.z) / (len * camLen);
      o *= smooth(-0.25, 0.15, facing);
    } else if (kIn >= 0.5 && L.space !== 'plate') {
      o *= smooth(-0.06, 0.02, y3);
    }
    if (k > 0.5 && L.space !== 'plate') o *= 1 - smooth(R_CAP, R_CAP + 0.08, r);
    if (L.star != null) o *= starAlpha[L.star] > 0.05 ? 1 : 0;
    if (isHover) o = 1;
    L.obj.visible = o > 0.03;
    L.div.style.opacity = o.toFixed(2);
  }
}

// ---------------------------------------------------------------- time
// Function declarations (hoisted): the panel's sliders format their values while the shell is being built.
function fmtTime(h) {
  if (!Number.isFinite(h)) return 'لا يحدث';
  h = ((h % 24) + 24) % 24;
  let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'ص' : 'م'}`;
}
const localParts = () => {
  const d = new Date(state.ms + state.tz * 3600000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), hours: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600, date: d };
};
const dayOfYear = (p) => Math.round((Date.UTC(p.y, p.m, p.d) - Date.UTC(p.y, 0, 1)) / 86400000);
const gregFmt = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const gregShort = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const hijriFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const hijriMonth = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', month: 'numeric' });
function dayLabel(v) {
  const y = new Date().getUTCFullYear();
  return new Date(Date.UTC(y, 0, 1 + v)).toLocaleDateString('ar-u-ca-gregory-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long' });
}
function timeFromSliders() {
  const p = localParts();
  state.ms = Date.UTC(p.y, 0, 1 + ui.values.day) + ui.values.minute * 60000 - state.tz * 3600000;
}
function syncSliders() {
  const p = localParts();
  ui.set('day', dayOfYear(p), { silent: true });
  ui.set('minute', Math.floor(p.hours * 60), { silent: true });
}
function setNow() { state.ms = Date.now(); syncSliders(); }

function setCity(v) {
  if (v === 'geo') {
    if (!navigator.geolocation) { ui.toast('المتصفح لا يدعم تحديد الموقع'); return; }
    ui.toast('نطلب موقعك من المتصفح…');
    navigator.geolocation.getCurrentPosition((pos) => {
      Object.assign(state, { lat: pos.coords.latitude, lon: pos.coords.longitude, tz: -new Date().getTimezoneOffset() / 60, place: 'موقعك' });
      afterPlace();
      ui.toast('تم: الكرة الآن مضبوطة على موقعك');
    }, () => ui.toast('لم نحصل على الموقع. اختر مدينة من القائمة.'), { timeout: 10000 });
    return;
  }
  const c = CITIES[v];
  Object.assign(state, { lat: c.lat, lon: c.lon, tz: c.tz, place: c.name });
  afterPlace();
}
function afterPlace() {
  setLatitude(state.lat);
  state.dayKey = '';
  syncSliders();
}

// ---------------------------------------------------------------- prayer card & star card
const prayerCard = el('section', { class: 'prayers', 'aria-label': 'أوقات الصلاة' });
const starCard = el('section', { class: 'star-card', hidden: true, 'aria-live': 'polite' });
document.body.append(prayerCard, starCard);

function renderPrayerCard() {
  const p = localParts();
  const t = state.times;
  const order = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const next = order.find((k) => Number.isFinite(t[k]) && t[k] > p.hours) || 'fajr';
  const q = A.qibla(state.lat, state.lon);
  prayerCard.innerHTML = `
    <div class="pc-place">${state.place}</div>
    <div class="pc-date">${gregFmt.format(p.date)}<br>${hijriFmt.format(p.date)}</div>
    <ul>${order.map((k) => `<li class="${k === next ? 'next' : ''}"><span>${PRAYER_NAMES[k]}</span><span class="t">${fmtTime(t[k])}</span></li>`).join('')}</ul>
    <div class="pc-qibla">القبلة: ${Math.round(q.bearing)}° من الشمال، وتبعد ${Math.round(q.km).toLocaleString('en')} كم</div>
    <div class="pc-method">تقويم أم القرى${t.ramadan ? '، العشاء بعد المغرب بساعتين في رمضان' : ''}</div>`;
}

function showStar(i) {
  const s = STARS[i];
  const altaz = A.altAz(s.ra, s.dec, state.L, state.lat);
  const constel = CONSTELLATIONS.find(([, ch]) => ch.flat().includes(s.key));
  starCard.hidden = false;
  starCard.innerHTML = `
    <button class="chip sc-close" type="button">إغلاق</button>
    <h2>${s.ar || s.en}</h2>
    <div class="sc-en">${s.en}${constel ? ` في كوكبة ${constel[0]}` : ''}</div>
    <dl>
      <div><dt>القدر الظاهري</dt><dd>${s.mag.toFixed(2)}</dd></div>
      ${s.dist ? `<div><dt>البعد</dt><dd>${s.dist.toLocaleString('en')} سنة ضوئية</dd></div>` : ''}
      <div><dt>ارتفاعه الآن</dt><dd>${(altaz.alt * R2D).toFixed(1)}°${altaz.alt < 0 ? ' (تحت الأفق)' : ''}</dd></div>
    </dl>
    ${STORIES[s.key] ? `<p>${STORIES[s.key]}</p>` : ''}`;
  starCard.querySelector('.sc-close').addEventListener('click', () => { starCard.hidden = true; });
}

// ---------------------------------------------------------------- modes and camera
const orbitPos = new THREE.Vector3().copy(camera.position);
let tween = null;
const look = { yaw: Math.PI, pitch: 0.28 }; // inside view: yaw 0 looks north (-z)
const lookDir = () => new THREE.Vector3(Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), -Math.cos(look.yaw) * Math.cos(look.pitch));
const target = new THREE.Vector3();

function setMode(m) {
  const from = state.mode;
  if (from === 'sphere') orbitPos.copy(camera.position);
  state.mode = m;
  challenge = null;
  controls.enabled = false;
  const t = {
    t: 0, dur: 1.8,
    p0: camera.position.clone(), q0: target.clone(), f0: camera.fov,
    k0: state.k, k1: m === 'astrolabe' ? 1 : 0,
    i0: state.kIn, i1: m === 'inside' ? 1 : 0,
  };
  if (m === 'sphere') { t.p1 = orbitPos.clone(); t.q1 = new THREE.Vector3(); t.f1 = 42; }
  if (m === 'inside') { t.p1 = new THREE.Vector3(0, 0.0, 0); t.q1 = lookDir(); t.f1 = 72; }
  if (m === 'astrolabe') { t.p1 = new THREE.Vector3(0, PLATE_Y, 3.25); t.q1 = new THREE.Vector3(0, PLATE_Y, 0); t.f1 = 42; }
  tween = t;
  ui.toast(m === 'inside' ? 'أنت الآن في مركز الكرة: اسحب لتنظر حولك، ومرّر العجلة لتقرّب' : m === 'astrolabe' ? 'الكرة تنفرد على صفيحة مستوية: هذا هو الأسطرلاب' : 'اسحب لتدور حول الكرة', 5000);
}

function stepTween(dt) {
  if (!tween) return;
  tween.t += dt;
  const e = ease(Math.min(tween.t / tween.dur, 1));
  // the morph lags the camera slightly so the unfolding reads clearly
  state.k = THREE.MathUtils.lerp(tween.k0, tween.k1, ease(Math.min(Math.max((tween.t - 0.15) / (tween.dur - 0.15), 0), 1)));
  state.kIn = THREE.MathUtils.lerp(tween.i0, tween.i1, e);
  camera.position.lerpVectors(tween.p0, tween.p1, e);
  target.lerpVectors(tween.q0, tween.q1, e);
  camera.fov = THREE.MathUtils.lerp(tween.f0, tween.f1, e);
  camera.updateProjectionMatrix();
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  if (tween.t >= tween.dur) {
    if (state.mode === 'sphere') { controls.target.set(0, 0, 0); controls.enabled = true; controls.update(); }
    tween = null;
  }
}

// ---------------------------------------------------------------- pointer: star picking, looking around, turning the rete
const canvas = stage.canvas;
let drag = null;
const ndc = new THREE.Vector3();
function pickStar(cx, cy) {
  const r = canvas.getBoundingClientRect();
  let best = -1, bestD = 16 * 16;
  for (let i = 0; i < STARS.length; i++) {
    if (starAlpha[i] < 0.08) continue;
    ndc.set(starPos[i * 3], starPos[i * 3 + 1], starPos[i * 3 + 2]).project(camera);
    if (ndc.z > 1) continue;
    const sx = (ndc.x * 0.5 + 0.5) * r.width + r.left, sy = (-ndc.y * 0.5 + 0.5) * r.height + r.top;
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
const plateHit = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const platePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
function plateAngle(cx, cy) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
  if (!raycaster.ray.intersectPlane(platePlane, plateHit)) return null;
  return Math.atan2(plateHit.y - PLATE_Y, plateHit.x);
}
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0, ang: state.mode === 'astrolabe' ? plateAngle(e.clientX, e.clientY) : null };
  if (state.mode !== 'sphere') canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    if (state.mode === 'inside' && !tween) {
      const s = (camera.fov * D2R) / canvas.clientHeight;
      look.yaw -= dx * s;
      look.pitch = THREE.MathUtils.clamp(look.pitch + dy * s, -0.4, 1.5);
    } else if (state.mode === 'astrolabe' && !tween && drag.ang != null) {
      const a = plateAngle(e.clientX, e.clientY);
      if (a != null) {
        let d = a - drag.ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        drag.ang = a;
        // θ = α − L + 90°, so turning the rete by +dθ means sidereal time −dθ.
        state.ms += (-d / TAU) * A.SIDEREAL_DAY_S * 1000;
        ui.set('rate', 0, { silent: true });
        ui.refresh();
        syncSliders();
      }
    }
    return;
  }
  const i = pickStar(e.clientX, e.clientY);
  if (i >= 0) {
    const s = STARS[i];
    hover.v = starBase[i];
    hover.div.firstChild.textContent = s.ar ? `${s.ar}  ${s.en}` : s.en;
    hoverOn = true;
    canvas.style.cursor = 'pointer';
  } else {
    hoverOn = false;
    canvas.style.cursor = '';
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (drag && drag.moved < 6) {
    const i = pickStar(e.clientX, e.clientY);
    if (i >= 0) showStar(i);
  }
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  if (state.mode !== 'inside') return;
  e.preventDefault();
  camera.fov = THREE.MathUtils.clamp(camera.fov * Math.exp(e.deltaY * 0.001), 18, 100);
  camera.updateProjectionMatrix();
}, { passive: false });

// ---------------------------------------------------------------- challenges (astrolabe)
function startChallenge(kind) {
  const p = localParts();
  state.ms = Date.UTC(p.y, p.m, p.d) + (kind === 'sunrise' ? 2.5 : 11.6) * 3600000 - state.tz * 3600000;
  ui.set('rate', 0, { silent: true });
  syncSliders();
  challenge = { kind, armed: false };
  ui.toast(kind === 'sunrise'
    ? 'دوّر الشبكة حتى تلمس الشمس خط الأفق الشرقي (يسار الصفيحة)، ثم اقرأ الساعة من العضادة'
    : 'دوّر الشبكة حتى تلمس الشمس حلقة العصر البرتقالية في جهة الغرب (يمين الصفيحة)', 9000);
}
function checkChallenge(sunAlt, sunAz) {
  if (!challenge) return;
  const want = challenge.kind === 'sunrise' ? -0.833 : A.asrAltitude(state.lat, state.sun.dec);
  const sideOK = challenge.kind === 'sunrise' ? sunAz < Math.PI : sunAz > Math.PI;
  if (Math.abs(sunAlt * R2D - want) < 0.7 && sideOK) {
    const p = localParts();
    const real = challenge.kind === 'sunrise' ? state.times.sunrise : state.times.asr;
    ui.toast(`أحسنت! قرأت ${fmtTime(p.hours)}، والحساب الدقيق ${fmtTime(real)}. هكذا عرف الفلكيون الوقت قبل الساعات.`, 9000);
    challenge = null;
  }
}

// ---------------------------------------------------------------- frame update
const B4 = new THREE.Matrix4();
const rotZ = new THREE.Matrix4();
let lastHours = null, roTimer = 0, first = true;

function updateDay() {
  const p = localParts();
  const key = `${p.y}-${p.m}-${p.d}-${state.lat}-${state.lon}`;
  if (key === state.dayKey) return;
  state.dayKey = key;
  const ramadan = hijriMonth.format(p.date) === '9';
  state.times = Object.assign(A.prayerTimes(p, state.lat, state.lon, state.tz, ramadan), { ramadan });
  renderPrayerCard();
}

function sunHourAnglePoint(tHours) {
  // where on today's sun circle the sun stands at local time tHours (frame-local coordinates)
  const H = (tHours - state.times.dhuhr) * 15 * D2R;
  const dec = state.sun.dec;
  return [Math.cos(dec) * Math.cos(H), -Math.cos(dec) * Math.sin(H), Math.sin(dec)];
}

stage.onResize((bw, bh, w, h) => {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  labelRenderer.setSize(w, h);
  starUniforms.uScale.value = Math.max(0.75, bh / 820);
});

setLatitude(state.lat);
syncSliders();
window.__exhibit = { state, ui, camera, setMode, look };

stage.start((dt) => {
  const v = ui.values;
  if (v.rate > 0 && !drag) {
    state.ms += dt * v.rate * 1000;
    roTimer -= dt;
    if (roTimer <= 0) { syncSliders(); roTimer = 0.12; }
  }
  updateDay();
  state.sun = A.sun(state.ms);
  state.L = A.lst(state.ms, state.lon);
  const sun = state.sun;
  const sa = A.altAz(sun.ra, sun.dec, state.L, state.lat);

  // prayer-time toasts while time runs at a watchable pace
  const p = localParts();
  if (lastHours != null && v.rate > 0 && v.rate <= 1800 && p.hours > lastHours) {
    for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      const t = state.times[k];
      if (Number.isFinite(t) && lastHours < t && p.hours >= t) ui.toast(`دخل وقت ${PRAYER_NAMES[k]} في ${state.place}: ${fmtTime(t)}`, 3500);
    }
  }
  lastHours = p.hours;

  stepTween(dt);
  if (state.mode === 'sphere' && !tween) controls.update();
  if (state.mode === 'inside' && !tween) { camera.position.set(0, 0, 0); camera.lookAt(lookDir()); target.copy(lookDir()); }

  // dynamic geometry: sun circle, Asr ring, qibla arrow, rule
  const cd = Math.cos(sun.dec), sd = Math.sin(sun.dec);
  for (let i = 0; i < sunPath.count / 2; i++) {
    const a0 = (i / (sunPath.count / 2)) * TAU, a1 = ((i + 1) / (sunPath.count / 2)) * TAU;
    sunPath.pts.set([cd * Math.cos(a0), cd * Math.sin(a0), sd, cd * Math.cos(a1), cd * Math.sin(a1), sd], i * 6);
  }
  const asrAlt = A.asrAltitude(state.lat, sun.dec) * D2R;
  for (let i = 0; i < asrRing.count / 2; i++) {
    const a0 = (i / (asrRing.count / 2)) * TAU, a1 = ((i + 1) / (asrRing.count / 2)) * TAU, r = Math.cos(asrAlt), y = Math.sin(asrAlt);
    asrRing.pts.set([Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r], i * 6);
  }
  const q = A.qibla(state.lat, state.lon).bearing * D2R;
  const qx = Math.sin(q), qz = -Math.cos(q), wx2 = Math.sin(q + 0.12), wz2 = -Math.cos(q + 0.12), wx3 = Math.sin(q - 0.12), wz3 = -Math.cos(q - 0.12);
  qiblaArrow.pts.set([qx * 0.2, 0, qz * 0.2, qx * (RH - 0.02), 0, qz * (RH - 0.02),
    qx * (RH - 0.02), 0, qz * (RH - 0.02), wx2 * (RH - 0.14), 0, wz2 * (RH - 0.14),
    qx * (RH - 0.02), 0, qz * (RH - 0.02), wx3 * (RH - 0.14), 0, wz3 * (RH - 0.14)]);
  qiblaLabel.v = [qx * (RH + 0.13), 0.07, qz * (RH + 0.13)];
  kaaba.position.set(qx * RH, 0, qz * RH);
  kaaba.rotation.y = -q;
  const kaabaVis = (v.qibla ? 1 : 0) * (1 - state.k);
  kaaba.visible = kaabaVis > 0.02;
  kaaba.traverse((o) => { if (o.material) o.material.opacity = kaabaVis; });

  // the rule points at the sun and reads the hour on the rim
  const sunFrame = toFrame('sky', Math.cos(sun.lambda), Math.sin(sun.lambda) * Math.cos(sun.eps), Math.sin(sun.lambda) * Math.sin(sun.eps), { x: 0, y: 0, z: 0 });
  stereo(sunFrame, st);
  const sunPlateX = st.X, sunPlateY = st.Y;
  const ang = Math.atan2(st.Y, st.X);
  const rx = Math.cos(ang), ry = Math.sin(ang);
  rule.pts.set([-rx * R_RIM, -ry * R_RIM, 0, rx * (R_RIM + 0.17), ry * (R_RIM + 0.17), 0,
    rx * R_RIM - ry * 0.03, ry * R_RIM + rx * 0.03, 0, rx * (R_RIM + 0.17), ry * (R_RIM + 0.17), 0]);
  // hour labels: apparent solar time increases with the sun's hour angle (H = 0 at noon on the meridian, top)
  for (const L of hourLabels) {
    const H = (L.hour - 12) * 15 * D2R;
    const a = Math.atan2(-Math.sin(H), Math.cos(H));
    L.v = [Math.cos(a) * (R_RIM + 0.28), Math.sin(a) * (R_RIM + 0.28), 0];
  }

  lines.update();

  // stars: same transform as the lines
  const { k, kIn } = state;
  const starVis = (v.stars ? 1 : 0) * (1 - kIn * smooth(-0.309, -0.1, sa.alt > -2 ? Math.sin(sa.alt) : -1));
  for (let i = 0; i < STARS.length; i++) {
    const b = starBase[i];
    toFrame('sky', b[0], b[1], b[2], tmpF);
    const x3 = wx(tmpF), y3 = wy(tmpF), z3 = wz(tmpF);
    stereo(tmpF, st);
    const px = -st.Y * S, py = st.X * S + PLATE_Y;
    starPos[i * 3] = x3 + (px - x3) * k; starPos[i * 3 + 1] = y3 + (py - y3) * k; starPos[i * 3 + 2] = z3 * (1 - k);
    let a = starVis * (1 - k * smooth(R_CAP, R_CAP + 0.05, st.r));
    if (kIn > 0) a *= 1 - kIn * (1 - smooth(-0.03, 0.01, y3));
    starAlpha[i] = a;
  }
  starGeo.attributes.position.needsUpdate = true;
  starGeo.attributes.aAlpha.needsUpdate = true;

  // the sun
  const sx3 = wx(sunFrame), sy3 = wy(sunFrame), sz3 = wz(sunFrame);
  const spx = -sunPlateY * S, spy = sunPlateX * S + PLATE_Y;
  const sp = sunGeo.attributes.position.array;
  sp[0] = sx3 + (spx - sx3) * k; sp[1] = sy3 + (spy - sy3) * k; sp[2] = sz3 * (1 - k);
  sunGeo.attributes.position.needsUpdate = true;
  sunGeo.attributes.aSize.array[0] = kIn > 0.5 ? 46 : 30;
  sunGeo.attributes.aSize.needsUpdate = true;
  sunLabel.v = [Math.cos(sun.lambda), Math.sin(sun.lambda) * Math.cos(sun.eps), Math.sin(sun.lambda) * Math.sin(sun.eps)];

  // prayer markers ride on today's sun path
  for (const [key, L] of Object.entries(prayerLabels)) {
    const t = state.times[key];
    L.missing = !Number.isFinite(t);
    if (!L.missing) L.v = sunHourAnglePoint(t);
  }

  // Milky Way follows the sky
  B4.set(0, 1, 0, 0, cphi, 0, sphi, 0, sphi, 0, -cphi, 0, 0, 0, 0, 1);
  rotZ.makeRotationZ(-state.L);
  milky.matrix.multiplyMatrices(B4, rotZ);
  milky.matrixWorldNeedsUpdate = true;
  milky.material.uniforms.uAmount.value = (v.milky ? 1 : 0) * (1 - k) * (0.45 * (1 - kIn) + kIn * starVis * 0.8);
  milky.material.side = kIn > 0.5 ? THREE.BackSide : THREE.FrontSide;

  // inside-view environment
  const sunWorld = new THREE.Vector3(sx3, sy3, sz3).normalize();
  dome.material.uniforms.uSun.value.copy(sunWorld);
  dome.material.uniforms.uAmount.value = kIn;
  dome.visible = kIn > 0.01;
  ground.material.uniforms.uAmount.value = kIn * 0.97;
  ground.material.uniforms.uDay.value = smooth(-0.1, 0.25, sunWorld.y);
  ground.material.depthWrite = kIn > 0.5;
  ground.visible = kIn > 0.01;
  horizonDisc.material.opacity = 0.07 * (1 - k) * (1 - kIn);
  plateDisc.material.uniforms.uAmount.value = k;
  plateDisc.visible = k > 0.01;

  // hover label tracks its star
  updateLabels();

  checkChallenge(sa.alt, sa.az);

  roTimerLabels(dt, p, sa);
  stage.render();
  labelRenderer.render(scene, camera);
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});

let roT = 0, lastCardMinute = -1;
function roTimerLabels(dt, p, sa) {
  roT -= dt;
  if (roT > 0) return;
  roT = 0.2;
  ui.readout('clock', `${fmtTime(p.hours)}، ${gregShort.format(p.date)}`);
  const dir = ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'][Math.round(sa.az / (Math.PI / 4)) % 8];
  ui.readout('sun', sa.alt > 0 ? `${(sa.alt * R2D).toFixed(1)}° فوق الأفق، جهة ${dir}` : `${(-sa.alt * R2D).toFixed(1)}° تحت الأفق`);
  const minute = Math.floor(p.hours * 60);
  if (minute !== lastCardMinute) { lastCardMinute = minute; renderPrayerCard(); }
}
