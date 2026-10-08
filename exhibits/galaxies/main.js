import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { createShell, WEBGL_FAIL } from '../../assets/js/shell.js';
import { createStage, QUALITY_OPTIONS } from '../../assets/js/stage.js';

// Units: length 1 = 2.5 kpc, velocity 1 ≈ 220 km/s  →  time 1 ≈ 11 million years.
// Each galaxy is a bulge (Plummer sphere) inside a dark-matter halo (logarithmic
// potential, which gives flat rotation curves). Stars are test particles moving in
// the combined field of both galaxies; the two centres feel each other plus
// dynamical friction, which is what lets real galaxies merge instead of flying apart.
const MYR_PER_UNIT = 11.1;
const KLY_PER_UNIT = 8.15;
const DT = 0.025;

const FIELD_GLSL = /* glsl */`
uniform float uDt;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec4 uG1;
uniform vec4 uG2;
vec3 field(vec3 p, vec3 c, vec4 g) {
  vec3 d = p - c;
  float r2 = dot(d, d);
  return -d * (g.x * pow(r2 + g.y, -1.5) + g.z / (r2 + g.w));
}
vec3 accel(vec3 p) { return field(p, uC1, uG1) + field(p, uC2, uG2); }
`;

const VEL_SHADER = FIELD_GLSL + /* glsl */`
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  gl_FragColor = vec4(v.xyz + accel(p.xyz) * uDt, v.w);
}
`;

// Symplectic Euler: positions advance with the *updated* velocity, recomputed here.
const POS_SHADER = FIELD_GLSL + /* glsl */`
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  vec3 vn = v.xyz + accel(p.xyz) * uDt;
  gl_FragColor = vec4(p.xyz + vn * uDt, p.w);
}
`;

const STAR_VS = /* glsl */`
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uScale;
uniform float uSize;
uniform float uBright;
uniform int uMode;
uniform vec3 uVRef;
attribute vec2 ref;
attribute vec4 starColor;
varying vec3 vCol;
void main() {
  vec3 p = texture2D(tPos, ref).xyz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = starColor.a * uSize * uScale / -mv.z;
  gl_PointSize = clamp(s, 1.0, 90.0);
  vec3 col = starColor.rgb;
  if (uMode == 1) {
    vec3 v = texture2D(tVel, ref).xyz - uVRef;
    float vr = dot(v, normalize(cameraPosition - p));
    float k = clamp(abs(vr) * 1.6, 0.0, 1.0);
    vec3 tint = vr > 0.0 ? vec3(0.25, 0.55, 1.0) : vec3(1.0, 0.32, 0.2);
    col = mix(vec3(0.75), tint, k) * (0.35 + 0.65 * dot(starColor.rgb, vec3(0.33)));
  }
  // Sub-pixel stars keep their energy instead of flickering.
  vCol = col * uBright * min(s * s, 1.0);
}
`;

const STAR_FS = /* glsl */`
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-d2 * 4.5), 1.0);
}
`;

// ---------------------------------------------------------------- scenarios
const PRESETS = {
  mw: {
    m: [1.0, 1.3], relPos: [24, 7, 13], relVel: [-0.5, -0.14, -0.2], cam: [-20, 26, 34],
    g: [{ incl: 0.45, pa: 0.0, spin: 1 }, { incl: 1.95, pa: 2.3, spin: 1 }],
  },
  antennae: {
    m: [1.0, 1.0], relPos: [22, 0, 9], relVel: [-0.62, 0, -0.04], cam: [-6, 40, 26],
    g: [{ incl: 0.25, pa: 0.4, spin: 1 }, { incl: -0.4, pa: 1.2, spin: 1 }],
  },
  cartwheel: {
    m: [1.0, 0.38], relPos: [1.1, 27, 0.6], relVel: [0, -1.25, 0], cam: [8, 30, 20],
    g: [{ incl: 0.0, pa: 0.0, spin: 1 }, { incl: 1.57, pa: 0.6, spin: 1 }],
  },
  minor: {
    m: [1.0, 0.13], relPos: [17, 3, 0], relVel: [0, 0.05, 0.6], cam: [-12, 26, 24],
    g: [{ incl: 0.15, pa: 0.0, spin: 1 }, { incl: 1.1, pa: 0.9, spin: -1 }],
  },
};

function galaxyParams(m) {
  const s = Math.sqrt(m);
  return { m, Mb: 0.9 * m, ab2: (0.35 * s) ** 2, V2: s, rc2: (1.2 * s) ** 2, rd: 1.5 * m ** 0.4, rmax: 6.5 * m ** 0.4 };
}

function fieldAt(out, x, y, z, c, g) {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  const r2 = dx * dx + dy * dy + dz * dz;
  const f = g.Mb * Math.pow(r2 + g.ab2, -1.5) + g.V2 / (r2 + g.rc2);
  out.x -= dx * f; out.y -= dy * f; out.z -= dz * f;
  return out;
}

function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = {
  bulge: [1.0, 0.6, 0.3],
  old: [1.0, 0.8, 0.58],
  young: [0.38, 0.58, 1.0],
  hii: [1.0, 0.3, 0.55],
  gas: [0.45, 0.3, 1.0],
};

// Fill star positions/velocities/colours for one galaxy into the shared buffers.
function seedGalaxy(buf, start, count, g, gp, centre, cvel, rand) {
  const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(g.incl, g.pa, 0, 'YXZ'));
  const p = new THREE.Vector3(), v = new THREE.Vector3(), t = new THREE.Vector3(), tmp = new THREE.Vector3();
  const pitch = 0.36, arms = 2, armPhase = rand() * Math.PI;
  const vcirc = (r) => Math.sqrt(r * r * (gp.Mb * Math.pow(r * r + gp.ab2, -1.5) + gp.V2 / (r * r + gp.rc2)));

  for (let i = start; i < start + count; i++) {
    const roll = rand();
    let col, size, bright = 1;
    if (roll < 0.16) {
      // Bulge: Plummer radius, random orbital planes with a bias to the disk's spin.
      let r = Math.sqrt(gp.ab2) / Math.sqrt(Math.pow(rand() * 0.98 + 0.01, -2 / 3) - 1);
      r = Math.min(r, 2.6 * Math.sqrt(gp.m));
      tmp.set(gaussian(rand), gaussian(rand), gaussian(rand)).normalize();
      p.copy(tmp).multiplyScalar(r);
      p.y *= 0.62;
      t.set(gaussian(rand), gaussian(rand), gaussian(rand)).cross(tmp).normalize();
      const diskT = new THREE.Vector3(-p.z, 0, p.x).normalize().multiplyScalar(g.spin);
      if (t.dot(diskT) < 0 && rand() < 0.75) t.negate();
      v.copy(t).multiplyScalar(vcirc(Math.max(r, 0.05)) * (0.85 + 0.1 * rand()));
      col = COLORS.bulge; size = 1.0; bright = 1.0;
    } else {
      // Disk: exponential profile, with 60% of stars hugging two trailing log-spiral arms.
      const kind = rand();
      let r = -gp.rd * Math.log(rand() * rand() + 1e-6) * 0.6;
      r = Math.min(Math.max(r, 0.35), gp.rmax);
      let th = rand() * Math.PI * 2;
      let y = gaussian(rand) * 0.07 * (1 + r * 0.04);
      if (kind < 0.62) {
        const arm = Math.floor(rand() * arms);
        const spread = kind < 0.1 ? 0.1 : 0.32;
        th = armPhase + arm * (Math.PI * 2 / arms) - g.spin * Math.log(r / 0.6) / Math.tan(pitch) + gaussian(rand) * spread;
        y *= 0.5;
        if (kind < 0.025) { col = COLORS.hii; size = 1.9; bright = 1.6; }
        else if (kind < 0.07) { col = COLORS.gas; size = 9.0; bright = 0.07; }
        else { col = COLORS.young; size = 1.0; bright = 1.15; }
      } else {
        col = COLORS.old; size = 0.9; bright = 0.85;
      }
      p.set(Math.cos(th) * r, y, Math.sin(th) * r);
      const vc = vcirc(r);
      v.set(-Math.sin(th), 0, Math.cos(th)).multiplyScalar(vc * g.spin);
      v.x += gaussian(rand) * 0.04; v.y += gaussian(rand) * 0.02; v.z += gaussian(rand) * 0.04;
    }
    p.applyMatrix4(rot).add(centre);
    v.applyMatrix4(rot).add(cvel);
    const j = i * 4;
    buf.pos[j] = p.x; buf.pos[j + 1] = p.y; buf.pos[j + 2] = p.z; buf.pos[j + 3] = 1;
    buf.vel[j] = v.x; buf.vel[j + 1] = v.y; buf.vel[j + 2] = v.z; buf.vel[j + 3] = 1;
    const shade = 0.75 + 0.5 * rand();
    buf.col[j] = col[0] * bright * shade; buf.col[j + 1] = col[1] * bright * shade; buf.col[j + 2] = col[2] * bright * shade;
    buf.col[j + 3] = size * (0.7 + 0.6 * rand());
  }
}

// ---------------------------------------------------------------- UI
const ui = createShell({
  title: 'تصادم مجرتين',
  scale: 'مقياس <bdi class="num">10<sup>21</sup></bdi> متر',
  hint: 'اسحب لتدور حول المجرتين، ومرّر العجلة لتقترب',
  readouts: [
    { key: 'time', label: 'الزمن منذ البداية' },
    { key: 'sep', label: 'المسافة بين المركزين' },
    { key: 'count', label: 'عدد النجوم' },
  ],
  controls: [
    { type: 'group', label: 'السيناريو' },
    { type: 'segmented', key: 'preset', value: 'mw', options: [
      { value: 'mw', label: 'درب التبانة وأندروميدا' },
      { value: 'antennae', label: 'الهوائيات' },
      { value: 'cartwheel', label: 'عجلة العربة' },
      { value: 'minor', label: 'ابتلاع مجرة قزمة' },
    ] },
    { type: 'note', html: '' , key: 'presetNote' },
    { type: 'segmented', key: 'count', label: 'عدد النجوم', value: 262144, options: [
      { value: 65536, label: '65 ألف' },
      { value: 262144, label: '262 ألف' },
      { value: 1048576, label: 'مليون' },
    ] },
    { type: 'buttons', items: [{ label: 'أعد التصادم من البداية', primary: true, action: () => rebuild() }] },
    { type: 'group', label: 'الزمن' },
    { type: 'range', key: 'speed', label: 'سرعة الزمن', min: 0, max: 4, step: 0.05, value: 1, format: (v) => (v === 0 ? 'متوقف' : `×${v.toFixed(2)}`) },
    { type: 'group', label: 'العرض' },
    { type: 'segmented', key: 'mode', label: 'التلوين', value: 0, options: [
      { value: 0, label: 'ألوان النجوم' },
      { value: 1, label: 'اقتراب وابتعاد' },
    ] },
    { type: 'toggle', key: 'trails', label: 'آثار الحركة', value: false },
    { type: 'toggle', key: 'follow', label: 'تتبّع مركز التصادم', value: true },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي للكاميرا', value: true },
    { type: 'range', key: 'bright', label: 'السطوع', min: 0.3, max: 3, step: 0.01, value: 1, format: (v) => v.toFixed(2) },
    { type: 'group', label: 'الجودة' },
    { type: 'segmented', key: 'quality', options: QUALITY_OPTIONS, value: 'auto' },
  ],
  onChange(key, v) {
    if (key === 'preset' || key === 'count') rebuild();
    if (key === 'quality') stage.setQuality(v);
    if (key === 'trails') afterimage.enabled = v;
    if (key === 'preset') describe();
  },
  info: `
    <h2>ماذا يحدث حين تتصادم مجرتان؟</h2>
    <p>كل نقطة ضوء هنا نجمة تُحسب حركتها على كرت الشاشة، مئات الآلاف منها في كل إطار. كل نجمة تنجذب إلى مركزي المجرتين، والمركزان ينجذبان لبعضهما، والنتيجة ما تراه: أذرع حلزونية تتمزق، وذيول طويلة تُقذف إلى الفضاء، ثم كتلة واحدة تهدأ ببطء.</p>
    <h3>النجوم لا تصطدم ببعضها</h3>
    <p>المسافات بين النجوم هائلة مقارنة بأحجامها. لو صغّرت الشمس إلى حبة رمل لكان أقرب نجم إليها على بعد كيلومترات. لذلك تعبر المجرتان بعضهما كسحابتين من الغبار، والجاذبية وحدها هي التي تعيد تشكيلهما.</p>
    <h3>من أين تأتي الذيول الطويلة؟</h3>
    <p>الجهة القريبة من المجرة الأخرى تنجذب أكثر من الجهة البعيدة، فتتمدد المجرة كما يتمدد البحر في المد والجزر. النجوم التي تدور في نفس اتجاه حركة المجرة الأخرى تبقى قريبة منها مدة أطول، فتُسحب منها شرائط طولها مئات آلاف السنين الضوئية. هذا ما اكتشفه الأخوان تومري عام ١٩٧٢ بمحاكاة مشابهة لهذه، لكن بمئة وعشرين نجمة فقط.</p>
    <h3>السيناريوهات</h3>
    <ul>
      <li><strong>درب التبانة وأندروميدا:</strong> أندروميدا تقترب منا الآن بسرعة ١١٠ كيلومترات في الثانية، وسيبدأ الاندماج بعد نحو ٤.٥ مليار سنة.</li>
      <li><strong>الهوائيات:</strong> مجرتان متساويتان تدوران في اتجاه حركتهما، فتخرج منهما ذيول طويلة كقرني حشرة، مثل مجرتي الهوائيات الحقيقيتين.</li>
      <li><strong>عجلة العربة:</strong> مجرة صغيرة تخترق قرص مجرة كبيرة من منتصفه تماماً، فتنتشر موجة دائرية من النجوم كتموّج الماء بعد رمي حجر.</li>
      <li><strong>ابتلاع مجرة قزمة:</strong> مجرة صغيرة تتفكك تدريجياً إلى تيارات من النجوم تلتف حول الكبيرة، وهذا يحدث لمجرتنا الآن مع مجرة القوس القزمة.</li>
    </ul>
    <h3>جرّب</h3>
    <ul>
      <li>اختر «اقتراب وابتعاد» لترى المجرات كما يراها الفلكيون بمطيافاتهم: الأزرق يقترب منك والأحمر يبتعد.</li>
      <li>شغّل «آثار الحركة» لترى مسارات النجوم.</li>
      <li>إن كان جهازك قوياً اختر مليون نجمة.</li>
    </ul>
    <p>الحساب مبسّط: النجوم لا تجذب بعضها، والمادة المظلمة ممثلة بحقل جاذبية ناعم حول كل مجرة. هذا التبسيط نفسه استخدمه العلماء في الدراسات الأولى، وهو يعطي الشكل العام للتصادم بدقة جيدة.</p>
  `,
});

const NOTES = {
  mw: 'أندروميدا أثقل قليلاً، وقرصاها مائلان بزاويتين مختلفتين.',
  antennae: 'مجرتان متساويتان، تمرّان قرب بعضهما ثم تعودان.',
  cartwheel: 'المجرة الصغيرة تسقط عمودياً على قرص الكبيرة.',
  minor: 'مجرة أخف بثماني مرات تدور حول الكبيرة حتى تتفكك.',
};
function describe() {
  const n = document.querySelector('.ctl-note');
  if (n) n.textContent = NOTES[ui.values.preset];
}
describe();

// ---------------------------------------------------------------- scene
const stage = createStage({ bloom: { strength: 0.7, radius: 0.5, threshold: 0.55 }, exposure: 1.0, startScale: 0.85 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const { renderer } = stage;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 6;
controls.maxDistance = 400;
controls.autoRotateSpeed = 0.35;
controls.zoomSpeed = 0.8;
stage.setScene(scene, camera);

const afterimage = new AfterimagePass(0.9);
afterimage.enabled = false;
stage.addPass(afterimage);

// Distant background stars give the eye a fixed frame to judge rotation against.
{
  const n = 5000, rand = mulberry32(7);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).normalize().multiplyScalar(1500);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.15 + Math.pow(rand(), 8) * 1.2;
    col.set([b, b * 0.95, b * (0.85 + rand() * 0.3)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Soft round sprite so the brighter background stars aren't drawn as squares.
  const dot = document.createElement('canvas');
  dot.width = dot.height = 16;
  const g = dot.getContext('2d');
  const grd = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 16);
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: false, vertexColors: true, depthWrite: false,
    map: new THREE.CanvasTexture(dot), transparent: true, blending: THREE.AdditiveBlending,
  })));
}

const starUniforms = {
  tPos: { value: null },
  tVel: { value: null },
  uScale: { value: 500 },
  uSize: { value: 0.06 },
  uBright: { value: 0.12 },
  uMode: { value: 0 },
  uVRef: { value: new THREE.Vector3() },
};
const starMaterial = new THREE.ShaderMaterial({
  vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starUniforms,
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
});

const sim = {
  gpu: null, posVar: null, velVar: null, points: null,
  c: [new THREE.Vector3(), new THREE.Vector3()],
  v: [new THREE.Vector3(), new THREE.Vector3()],
  gp: [null, null],
  time: 0, count: 0, acc: 0,
};
const com = new THREE.Vector3();
const comVel = new THREE.Vector3();

function rebuild() {
  const preset = PRESETS[ui.values.preset];
  const N = ui.values.count;
  const W = Math.sqrt(N);
  const rand = mulberry32(1234 + N);

  if (sim.gpu) sim.gpu.dispose();
  if (sim.points) { scene.remove(sim.points); sim.points.geometry.dispose(); }

  const [m1, m2] = preset.m;
  sim.gp = [galaxyParams(m1), galaxyParams(m2)];
  const M = m1 + m2;
  const rp = new THREE.Vector3(...preset.relPos), rv = new THREE.Vector3(...preset.relVel);
  sim.c[0].copy(rp).multiplyScalar(-m2 / M);
  sim.c[1].copy(rp).multiplyScalar(m1 / M);
  sim.v[0].copy(rv).multiplyScalar(-m2 / M);
  sim.v[1].copy(rv).multiplyScalar(m1 / M);

  const gpu = new GPUComputationRenderer(W, W, renderer);
  gpu.setDataType(THREE.FloatType);
  const tPos = gpu.createTexture(), tVel = gpu.createTexture();
  const col = new Float32Array(N * 4);
  const buf = { pos: tPos.image.data, vel: tVel.image.data, col };
  const share = Math.pow(m1, 0.6) / (Math.pow(m1, 0.6) + Math.pow(m2, 0.6));
  const n1 = Math.round(N * share);
  seedGalaxy(buf, 0, n1, preset.g[0], sim.gp[0], sim.c[0], sim.v[0], rand);
  seedGalaxy(buf, n1, N - n1, preset.g[1], sim.gp[1], sim.c[1], sim.v[1], rand);

  const posVar = gpu.addVariable('texturePosition', POS_SHADER, tPos);
  const velVar = gpu.addVariable('textureVelocity', VEL_SHADER, tVel);
  gpu.setVariableDependencies(posVar, [posVar, velVar]);
  gpu.setVariableDependencies(velVar, [posVar, velVar]);
  for (const vr of [posVar, velVar]) {
    Object.assign(vr.material.uniforms, {
      uDt: { value: DT }, uC1: { value: new THREE.Vector3() }, uC2: { value: new THREE.Vector3() },
      uG1: { value: new THREE.Vector4() }, uG2: { value: new THREE.Vector4() },
    });
  }
  const err = gpu.init();
  if (err) { console.error(err); ui.fail('تعذّر تشغيل المحاكاة على كرت الشاشة هذا.'); return; }

  const ref = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { ref[i * 2] = ((i % W) + 0.5) / W; ref[i * 2 + 1] = (Math.floor(i / W) + 0.5) / W; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
  geo.setAttribute('starColor', new THREE.BufferAttribute(col, 4));
  const points = new THREE.Points(geo, starMaterial);
  points.frustumCulled = false;
  scene.add(points);

  Object.assign(sim, { gpu, posVar, velVar, points, time: 0, count: N, acc: 0 });
  // Brightness per star falls as the count rises, so the total light stays similar.
  starUniforms.uSize.value = 0.06 * Math.pow(262144 / N, 0.18);
  updateCom();
  controls.target.copy(com);
  camera.position.copy(com).add(new THREE.Vector3(...preset.cam));
  ui.readout('count', N.toLocaleString('en'));
}

function updateCom() {
  const [g1, g2] = sim.gp;
  const M = g1.m + g2.m;
  com.copy(sim.c[0]).multiplyScalar(g1.m / M).addScaledVector(sim.c[1], g2.m / M);
  comVel.copy(sim.v[0]).multiplyScalar(g1.m / M).addScaledVector(sim.v[1], g2.m / M);
}

const a = [new THREE.Vector3(), new THREE.Vector3()];
function step() {
  const [g1, g2] = sim.gp;
  for (const vr of [sim.posVar, sim.velVar]) {
    const u = vr.material.uniforms;
    u.uC1.value.copy(sim.c[0]); u.uC2.value.copy(sim.c[1]);
    u.uG1.value.set(g1.Mb, g1.ab2, g1.V2, g1.rc2);
    u.uG2.value.set(g2.Mb, g2.ab2, g2.V2, g2.rc2);
  }
  sim.gpu.compute();

  // Centres: mutual pull + dynamical friction (drag from plowing through each other's halo).
  const [c1, c2] = sim.c, [v1, v2] = sim.v;
  a[0].set(0, 0, 0); a[1].set(0, 0, 0);
  fieldAt(a[0], c1.x, c1.y, c1.z, c2, g2);
  fieldAt(a[1], c2.x, c2.y, c2.z, c1, g1);
  const d2 = c1.distanceToSquared(c2);
  const k = 0.025 * Math.exp(-d2 / (2 * 6 * 6));
  const M = g1.m + g2.m;
  a[0].addScaledVector(v1, -k * g2.m / M).addScaledVector(v2, k * g2.m / M);
  a[1].addScaledVector(v2, -k * g1.m / M).addScaledVector(v1, k * g1.m / M);
  v1.addScaledVector(a[0], DT); v2.addScaledVector(a[1], DT);
  c1.addScaledVector(v1, DT); c2.addScaledVector(v2, DT);
  sim.time += DT;
}

stage.onResize((bw, bh, w, h) => {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  starUniforms.uScale.value = bh / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
});

rebuild();
window.__exhibit = { camera, controls, sim, ui, step };

const prevCom = new THREE.Vector3();
let roTimer = 0, first = true;
stage.start((dt) => {
  const v = ui.values;
  sim.acc += v.speed * 2;
  let n = Math.floor(sim.acc);
  sim.acc -= n;
  n = Math.min(n, 10);
  for (let i = 0; i < n; i++) step();

  prevCom.copy(com);
  updateCom();
  if (v.follow) {
    const delta = com.clone().sub(prevCom);
    camera.position.add(delta);
    controls.target.add(delta);
    controls.target.lerp(com, 0.02);
  }
  controls.autoRotate = v.auto;
  controls.update();

  starUniforms.tPos.value = sim.gpu.getCurrentRenderTarget(sim.posVar).texture;
  starUniforms.tVel.value = sim.gpu.getCurrentRenderTarget(sim.velVar).texture;
  starUniforms.uMode.value = v.mode;
  starUniforms.uVRef.value.copy(comVel);
  // Brightness per star falls as the count rises, so the total light stays similar.
  starUniforms.uBright.value = 0.055 * Math.pow(262144 / sim.count, 0.75) * v.bright;
  stage.render();

  roTimer -= dt;
  if (roTimer <= 0) {
    roTimer = 0.2;
    const myr = sim.time * MYR_PER_UNIT;
    ui.readout('time', myr < 1000 ? `${Math.round(myr)} مليون سنة` : `${(myr / 1000).toFixed(2)} مليار سنة`);
    ui.readout('sep', `${Math.round(sim.c[0].distanceTo(sim.c[1]) * KLY_PER_UNIT).toLocaleString('en')} ألف سنة ضوئية`);
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
