import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createShell, WEBGL_FAIL, el } from '../../assets/js/shell.js';
import { createStage, ease } from '../../assets/js/stage.js';

const D2R = Math.PI / 180, TAU = Math.PI * 2;

// JPL "approximate positions of the planets" (J2000 elements and their rates per Julian century).
// [a (AU), e, ė, L, L̇, ϖ, ϖ̇]
const PLANETS = [
  { key: 'mercury', ar: 'عطارد', el: [0.38709927, 0.20563593, 0.00001906, 252.25032350, 149472.67411175, 77.45779628, 0.16047689], size: 0.036, period: 87.97, moons: '0', day: '176 يوماً', tilt: 0.03,
    fact: 'أقرب الكواكب إلى الشمس وأصغرها. سنته ٨٨ يوماً، أما يومه من شروق إلى شروق فـ١٧٦ يوماً: يومه أطول من سنته.' },
  { key: 'venus', ar: 'الزهرة', el: [0.72333566, 0.00677672, -0.00004107, 181.97909950, 58517.81538729, 131.60246718, 0.00268329], size: 0.062, period: 224.7, moons: '0', day: '117 يوماً', tilt: 3.1,
    fact: 'أشد الكواكب حرارة: ٤٦٥ درجة، أكثر من عطارد مع أنها أبعد، بسبب غلافها الكثيف من ثاني أكسيد الكربون. تدور عكس بقية الكواكب فتشرق الشمس فيها من الغرب. هي «نجمة الصبح» و«نجمة المساء».' },
  { key: 'earth', ar: 'الأرض', el: [1.00000261, 0.01671123, -0.00004392, 100.46457166, 35999.37244981, 102.93768193, 0.32327364], size: 0.066, period: 365.26, moons: '1', day: '24 ساعة', tilt: 0.41,
    fact: 'الكوكب الوحيد المعروف بوجود ماء سائل على سطحه وحياة. يميل محورها ٢٣٫٤ درجة، وهذا الميل وحده سبب الفصول، لا قربها وبعدها عن الشمس.' },
  { key: 'mars', ar: 'المريخ', el: [1.52371034, 0.09339410, 0.00007882, -4.55343205, 19140.30268499, -23.94362959, 0.44441088], size: 0.046, period: 686.98, moons: '2', day: '24 ساعة و37 دقيقة', tilt: 0.44,
    fact: 'لونه الأحمر من أكسيد الحديد، أي الصدأ. فيه أعلى بركان في المجموعة الشمسية، أوليمبوس، بارتفاع ٢٢ كيلومتراً. يدور حوله مسبار «الأمل» العربي منذ ٢٠٢١.' },
  { key: 'jupiter', ar: 'المشتري', el: [5.20288700, 0.04838624, -0.00013253, 34.39644051, 3034.74612775, 14.72847983, 0.21252668], size: 0.165, period: 4332.6, moons: 'أكثر من 90', day: '9 ساعات و56 دقيقة', tilt: 0.05,
    fact: 'أكبر الكواكب: يتسع لأكثر من ألف أرض. البقعة الحمراء العظيمة عاصفة أكبر من الأرض كلها، مستمرة منذ أكثر من ثلاثمئة وخمسين سنة.' },
  { key: 'saturn', ar: 'زحل', el: [9.53667594, 0.05386179, -0.00050991, 49.95424423, 1222.49362201, 92.59887831, -0.41897216], size: 0.14, period: 10759, moons: 'أكثر من 270', day: '10 ساعات و34 دقيقة', tilt: 0.47,
    fact: 'حلقاته من جليد وصخور، يبلغ عرضها نحو ٢٨٠ ألف كيلومتر، وسمكها في أغلب أجزائها نحو عشرة أمتار فقط. كثافته أقل من كثافة الماء.' },
  { key: 'uranus', ar: 'أورانوس', el: [19.18916464, 0.04725744, -0.00004397, 313.23810451, 428.48202785, 170.95427630, 0.40805281], size: 0.1, period: 30687, moons: '28', day: '17 ساعة', tilt: 1.71,
    fact: 'يدور مستلقياً على جنبه، فمحوره يميل ٩٨ درجة. لذلك يعيش كل قطب فيه ٤٢ سنة من النهار المتواصل ثم ٤٢ سنة من الليل.' },
  { key: 'neptune', ar: 'نبتون', el: [30.06992276, 0.00859048, 0.00005105, -55.12002969, 218.45945325, 44.96476227, -0.32241464], size: 0.098, period: 60190, moons: '16', day: '16 ساعة', tilt: 0.49,
    fact: 'اكتُشف بالحساب قبل أن يُرى: لاحظ الفلكيون أن مدار أورانوس يضطرب، فحسبوا مكان الكوكب المجهول ووجدوه عام ١٨٤٦ حيث توقعوا تقريباً. رياحه أسرع رياح في المجموعة الشمسية.' },
];
const ORRERY_R = [0.62, 0.84, 1.06, 1.3, 1.64, 2.0, 2.34, 2.64];
const ZODIAC = ['الحمل', 'الثور', 'الجوزاء', 'السرطان', 'الأسد', 'السنبلة', 'الميزان', 'العقرب', 'القوس', 'الجدي', 'الدلو', 'الحوت'];

const J2000 = Date.UTC(2000, 0, 1, 12);
const daysOf = (ms) => (ms - J2000) / 86400000;

function heliocentricLongitude(p, d) {
  const T = d / 36525;
  const [, e0, de, L0, dL, w0, dw] = p.el;
  const e = e0 + de * T;
  const L = (L0 + dL * T) * D2R, w = (w0 + dw * T) * D2R;
  let M = (L - w) % TAU;
  let E = M;
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return { lon: nu + w, r: p.el[0] * (1 - e * Math.cos(E)) };
}

// ---------------------------------------------------------------- shell
const ui = createShell({
  title: 'المجموعة الشمسية',
  scale: 'مقياس <bdi class="num">10<sup>13</sup></bdi> متر',
  hint: 'أمسك المقبض النحاسي على جانب القاعدة ودوّره لتحرّك الزمن، واضغط على أي كوكب',
  readouts: [
    { key: 'date', label: 'التاريخ' },
    { key: 'hijri', label: 'بالهجري' },
    { key: 'sign', label: 'الشمس كما تُرى من الأرض' },
    { key: 'mars', label: 'المريخ كما يُرى من الأرض' },
  ],
  controls: [
    { type: 'group', label: 'الزمن' },
    { type: 'segmented', key: 'speed', label: 'السرعة', value: 7, options: [
      { value: 0, label: 'متوقف' },
      { value: 1, label: 'يوم/ث' },
      { value: 7, label: 'أسبوع/ث' },
      { value: 30, label: 'شهر/ث' },
      { value: 365, label: 'سنة/ث' },
    ] },
    { type: 'toggle', key: 'reverse', label: 'اعكس اتجاه الزمن', value: false },
    { type: 'buttons', items: [
      { label: 'اليوم', action: () => jumpTo(Date.now()) },
      { label: 'التقارن العظيم ٢٠٢٠', action: () => jumpTo(Date.UTC(2020, 11, 21)) },
      { label: 'أقرب اقتراب للمريخ ٢٠٠٣', action: () => jumpTo(Date.UTC(2003, 7, 27)) },
    ] },
    { type: 'group', label: 'العرض' },
    { type: 'toggle', key: 'real', label: 'المسافات الحقيقية', value: false },
    { type: 'toggle', key: 'marsLine', label: 'خط النظر من الأرض إلى المريخ', value: false },
    { type: 'toggle', key: 'orbits', label: 'المدارات', value: true },
    { type: 'toggle', key: 'names', label: 'الأسماء', value: true },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي للكاميرا', value: false },
    { type: 'note', html: 'في وضع «المسافات الحقيقية» تُرسم أبعاد الكواكب عن الشمس بنسبتها الصحيحة. لاحظ كيف تتكدّس الكواكب الأربعة الأولى قرب الشمس.' },
  ],
  onChange(key) {
    if (key === 'marsLine' && ui.values.marsLine) ui.toast('راقب المريخ حين تتجاوزه الأرض: يبدو كأنه يرجع إلى الخلف بين النجوم، وهي «الحركة الراجعة» التي حيّرت الفلكيين قروناً', 8000);
  },
  info: `
    <h2>آلة تحاكي السماء</h2>
    <p>هذه آلة نحاسية من نوع «الأوري» (Orrery): كل كوكب يحمله ذراع يدور حول الشمس، وكل الأذرع تُدار من مقبض واحد عبر سلسلة من التروس، فتدور الكواكب بنسب سرعاتها الحقيقية. أدر المقبض دورة كاملة يمضِ شهر.</p>
    <h3>مواقع حقيقية</h3>
    <p>اتجاه كل كوكب هنا محسوب من عناصر مداره الحقيقية التي تنشرها وكالة ناسا، بحل «معادلة كبلر» لكل كوكب في كل إطار. اضغط «اليوم» فترى الكواكب في أماكنها الفعلية الآن، أو «التقارن العظيم ٢٠٢٠» لترى المشتري وزحل في خط واحد مع الأرض، وهو حدث لم يحدث بهذا القرب منذ عام ١٦٢٣.</p>
    <p>المسافات في الوضع العادي مضغوطة كما في كل الآلات من هذا النوع، لأنها لو رُسمت بنسبتها لاحتاج نبتون ذراعاً طولها ثمانون ضعف ذراع عطارد. فعّل «المسافات الحقيقية» لترى الفرق.</p>
    <h3>تاريخ التروس الفلكية</h3>
    <p>أقدم آلة فلكية مسنّنة معروفة هي «آلة أنتيكيثيرا» اليونانية قبل نحو ألفي سنة. ووصف البيروني في القرن الحادي عشر تقويماً مسنّناً يحسب أطوار القمر، وما زال في متحف أكسفورد أسطرلاب فارسي بتروس صُنع عام ١٢٢١م. وفي دمشق صنع ابن الشاطر في القرن الرابع عشر ساعة فلكية، ووضع نماذج لحركة الكواكب ظهرت بعد قرنين بصيغة شبه مطابقة في كتاب كوبرنيكوس.</p>
    <h3>الحركة الراجعة</h3>
    <p>فعّل «خط النظر من الأرض إلى المريخ». حين تقترب الأرض من المريخ وتسبقه في مدارها الداخلي الأسرع، يبدو المريخ من الأرض كأنه يتوقف ثم يرجع إلى الخلف بين النجوم أسابيع قبل أن يعود إلى مساره. هذه الحركة كانت من أصعب ألغاز الفلك القديم، وحلّها النموذج الذي يضع الشمس في المركز.</p>
  `,
});

// ---------------------------------------------------------------- stage, scene
const stage = createStage({ bloom: { strength: 0.5, radius: 0.45, threshold: 1.1 }, exposure: 0.9, startScale: 0.9 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const { renderer } = stage;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#05081a');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
camera.position.set(3.6, 2.7, 4.1);
const controls = new OrbitControls(camera, stage.canvas);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 1.2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotateSpeed = 0.35;
stage.setScene(scene, camera);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
document.body.append(labelRenderer.domElement);

const SUN_Y = 1.18;
const sunLight = new THREE.PointLight('#fff1d6', 2.2, 0, 0);
sunLight.position.set(0, SUN_Y, 0);
scene.add(sunLight);
scene.add(new THREE.HemisphereLight('#4a5a9a', '#120e08', 0.25));

// Background stars
{
  const n = 3000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * r * 80, u * 80, Math.sin(a) * r * 80], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#c8d0ff', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
}

// ---------------------------------------------------------------- materials
const brass = new THREE.MeshStandardMaterial({ color: '#c9a055', metalness: 1, roughness: 0.3, envMapIntensity: 0.45 });
const brassDark = new THREE.MeshStandardMaterial({ color: '#94703a', metalness: 1, roughness: 0.4, envMapIntensity: 0.4 });
const steel = new THREE.MeshStandardMaterial({ color: '#b8bcc6', metalness: 1, roughness: 0.28, envMapIntensity: 0.45 });
const ebony = new THREE.MeshStandardMaterial({ color: '#1a120c', metalness: 0, roughness: 0.45 });

// ---------------------------------------------------------------- the base drum with an enamel zodiac dial
const BASE_Y = 0.34;
const base = new THREE.Group();
scene.add(base);
{
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.32, BASE_Y, 128, 1), brass);
  drum.position.y = BASE_Y / 2;
  base.add(drum);
  for (const [r, y, t] of [[1.33, 0.02, 0.02], [1.255, BASE_Y - 0.03, 0.014], [1.22, BASE_Y, 0.012], [0.9, BASE_Y + 0.004, 0.008]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 12, 160), brassDark);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    base.add(ring);
  }
  // enamel dial: zodiac names and degree ticks drawn on a canvas
  const c = document.createElement('canvas');
  c.width = c.height = 2048;
  const g = c.getContext('2d');
  const C = 1024;
  g.fillStyle = '#0b1230';
  g.fillRect(0, 0, 2048, 2048);
  g.strokeStyle = '#d9b36a';
  g.fillStyle = '#e8c98a';
  g.lineWidth = 3;
  for (const r of [1018, 990, 760, 735]) { g.beginPath(); g.arc(C, C, r, 0, TAU); g.stroke(); }
  for (let i = 0; i < 360; i++) {
    const a = -i * D2R, len = i % 30 === 0 ? 60 : i % 10 === 0 ? 34 : i % 5 === 0 ? 22 : 12;
    g.lineWidth = i % 30 === 0 ? 4 : 2;
    g.beginPath();
    g.moveTo(C + Math.cos(a) * 990, C + Math.sin(a) * 990);
    g.lineTo(C + Math.cos(a) * (990 - len), C + Math.sin(a) * (990 - len));
    g.stroke();
  }
  g.font = '600 84px "IBM Plex Sans Arabic", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ZODIAC.forEach((name, i) => {
    const a = -(i * 30 + 15) * D2R;
    g.save();
    g.translate(C + Math.cos(a) * 850, C + Math.sin(a) * 850);
    g.rotate(a - Math.PI / 2); // tops toward the centre, so names read upright from outside the dial
    g.fillText(name, 0, 0);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const dial = new THREE.Mesh(new THREE.RingGeometry(0.72, 1.215, 128, 1), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.2, roughness: 0.4 }));
  // map ring UVs to the square canvas
  const uv = dial.geometry.attributes.uv, p = dial.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / (2 * 1.215) * (2048 / 2036) + 0.5, p.getY(i) / (2 * 1.215) * (2048 / 2036) + 0.5);
  dial.rotation.x = -Math.PI / 2;
  dial.position.y = BASE_Y + 0.002;
  base.add(dial);
  // the centre plate
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.72, 96), brassDark);
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = BASE_Y + 0.001;
  base.add(plate);
  // a soft shadow pool on the floor
  const sh = document.createElement('canvas');
  sh.width = sh.height = 256;
  const sg = sh.getContext('2d');
  const grd = sg.createRadialGradient(128, 128, 40, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = grd;
  sg.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.001;
  scene.add(shadow);
}

// ---------------------------------------------------------------- gears
function gearGeometry(teeth, radius, depth = 0.016, toothH = 0.018, spokes = 5) {
  const shape = new THREE.Shape();
  const rr = radius - toothH * 0.5, rt = radius + toothH * 0.5;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * TAU, step = TAU / teeth;
    const pts = [[rr, a0], [rr, a0 + step * 0.18], [rt, a0 + step * 0.3], [rt, a0 + step * 0.52], [rr, a0 + step * 0.64]];
    pts.forEach(([r, a], j) => (i === 0 && j === 0 ? shape.moveTo(Math.cos(a) * r, Math.sin(a) * r) : shape.lineTo(Math.cos(a) * r, Math.sin(a) * r)));
  }
  shape.closePath();
  // spoked wheel: cut windows between the hub and the rim
  if (radius > 0.12 && spokes) {
    const inner = radius * 0.32, outer = radius * 0.78;
    for (let s = 0; s < spokes; s++) {
      const a0 = (s / spokes) * TAU + 0.18, a1 = ((s + 1) / spokes) * TAU - 0.18;
      const hole = new THREE.Path();
      hole.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
      hole.absarc(0, 0, outer, a0, a1, false);
      hole.lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner);
      hole.absarc(0, 0, inner, a1, a0, true);
      shape.holes.push(hole);
    }
  }
  const hub = new THREE.Path();
  hub.absarc(0, 0, 0.012, 0, TAU, true);
  shape.holes.push(hub);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------- planets
const NOISE = /* glsl */`
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;
const PLANET_VS = /* glsl */`
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
void main() {
  vObj = normalize(position);
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const PLANET_FS = /* glsl */`
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
uniform vec3 uSun;
uniform int uType;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uSeed;
${NOISE}
void main() {
  vec3 p = vObj;
  vec3 n = normalize(vN);
  vec3 L = normalize(uSun - vW);
  vec3 V = normalize(cameraPosition - vW);
  float dif = max(dot(n, L), 0.0);
  float lat = p.y;
  vec3 col;
  float spec = 0.0;
  if (uType == 0) {           // rocky, cratered
    float f = fbm(p * 4.0 + uSeed);
    float cr = smoothstep(0.62, 0.66, vn(p * 18.0 + uSeed)) * 0.25;
    col = mix(uA, uB, f) - cr;
    col = mix(col, uC, smoothstep(0.84, 0.92, abs(lat)) * step(2.0, uSeed)); // Martian polar caps
  } else if (uType == 1) {    // banded gas giant
    float w = fbm(p * vec3(2.0, 6.0, 2.0) + uSeed) * 0.35;
    float b = sin((lat + w) * 22.0) * 0.5 + 0.5;
    float b2 = sin((lat - w * 0.5) * 47.0) * 0.5 + 0.5;
    col = mix(uA, uB, b);
    col = mix(col, uC, b2 * 0.35);
    // a great red spot for Jupiter
    vec2 spot = vec2(atan(p.z, p.x) - 1.0, (lat + 0.32) * 3.0);
    col = mix(col, vec3(0.75, 0.3, 0.16), smoothstep(0.35, 0.0, length(spot * vec2(1.0, 1.6))) * step(uSeed, 1.5));
  } else if (uType == 2) {    // Earth
    float c = fbm(p * 2.6 + 3.0);
    float land = smoothstep(0.5, 0.53, c);
    vec3 ground = mix(uB, vec3(0.62, 0.52, 0.34), smoothstep(0.55, 0.7, fbm(p * 7.0)));
    col = mix(uA, ground, land);
    col = mix(col, vec3(0.95), smoothstep(0.8, 0.88, abs(lat)));
    float cl = smoothstep(0.55, 0.75, fbm(p * 5.0 + 9.0));
    col = mix(col, vec3(1.0), cl * 0.85);
    spec = (1.0 - land) * (1.0 - cl) * pow(max(dot(reflect(-L, n), V), 0.0), 40.0) * 0.8;
  } else {                    // smooth ice giant / cloudy Venus
    float b = fbm(p * vec3(1.5, 8.0, 1.5) + uSeed);
    col = mix(uA, uB, b * 0.7 + 0.15 * sin(lat * 14.0));
  }
  vec3 lit = col * (dif * 1.25 + 0.035) + spec;
  // atmospheric rim on the lit side
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * smoothstep(-0.2, 0.4, dot(n, L));
  lit += uC * rim * 0.35 * step(1.5, float(uType == 2 || uType == 3 ? 2 : 0));
  gl_FragColor = vec4(lit, 1.0);
}
`;
const LOOKS = {
  mercury: [0, '#8a827c', '#5f5853', '#b0a89f', 0.3],
  venus: [3, '#e8cd92', '#c79c55', '#ffe7b0', 0.7],
  earth: [2, '#173f7a', '#4f7a34', '#7fb4ff', 0.1],
  mars: [0, '#b9582f', '#6d3220', '#f2e2d0', 2.7],
  jupiter: [1, '#e2c39a', '#a8744a', '#f4ead8', 1.0],
  saturn: [1, '#e6d3a1', '#b99b62', '#f5ecd0', 2.3],
  uranus: [3, '#a6dfe4', '#7cc3cc', '#c8f4f6', 0.4],
  neptune: [3, '#4673d9', '#2b4fa8', '#8fb0ff', 0.9],
};

const planetObjs = [];
const tubeTop = (i) => 1.03 - i * 0.055;
for (let i = 0; i < PLANETS.length; i++) {
  const P = PLANETS[i];
  const g = new THREE.Group();
  scene.add(g);
  const yArm = tubeTop(i);
  const tubeR = 0.022 + (PLANETS.length - 1 - i) * 0.007;
  // tube from the base to this arm (outer planets on the wider, shorter tubes)
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, yArm - BASE_Y, 32), i % 2 ? brassDark : brass);
  tube.position.y = (yArm + BASE_Y) / 2;
  g.add(tube);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(tubeR + 0.008, tubeR + 0.008, 0.03, 32), brass);
  collar.position.y = yArm;
  g.add(collar);
  // arm, pin and planet
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 0.014, 0.022), brass);
  g.add(arm);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 12), steel);
  g.add(pin);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), brass);
  g.add(knob);
  const [type, a, b, c, seed] = LOOKS[P.key];
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VS, fragmentShader: PLANET_FS,
    uniforms: { uSun: { value: new THREE.Vector3(0, SUN_Y, 0) }, uType: { value: type }, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uC: { value: new THREE.Color(c) }, uSeed: { value: seed } },
  });
  const tiltG = new THREE.Group();
  tiltG.rotation.z = P.tilt;
  g.add(tiltG);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  body.userData.planet = i;
  tiltG.add(body);
  if (P.key === 'saturn') {
    const ringGeo = new THREE.RingGeometry(1.25, 2.3, 128, 1);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0, SUN_Y, 0) } },
      vertexShader: `varying vec3 vL; varying vec3 vW; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`varying vec3 vL; varying vec3 vW; uniform vec3 uSun; ${NOISE}
        void main(){ float r = length(vL.xy); float t = (r - 1.25) / 1.05;
          float bands = 0.55 + 0.45 * sin(t * 90.0 + vn(vec3(t * 40.0, 0.0, 0.0)) * 4.0);
          float cassini = smoothstep(0.58, 0.6, t) * (1.0 - smoothstep(0.63, 0.65, t));
          float a = (0.25 + 0.65 * bands) * (1.0 - cassini * 0.9) * smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.92, 1.0, t));
          vec3 col = mix(vec3(0.78, 0.68, 0.5), vec3(0.95, 0.88, 0.72), bands);
          gl_FragColor = vec4(col * 0.9, a); }`,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    body.add(ring);
  }
  // moons
  const moons = [];
  if (P.key === 'earth') {
    const moonArm = new THREE.Group();
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.018, 24, 16), new THREE.ShaderMaterial({ vertexShader: PLANET_VS, fragmentShader: PLANET_FS, uniforms: { uSun: { value: new THREE.Vector3(0, SUN_Y, 0) }, uType: { value: 0 }, uA: { value: new THREE.Color('#bdb8b0') }, uB: { value: new THREE.Color('#7d7872') }, uC: { value: new THREE.Color('#ffffff') }, uSeed: { value: 5.1 } } }));
    m.position.x = 0.13;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.13, 6), steel);
    rod.rotation.z = Math.PI / 2;
    rod.position.x = 0.065;
    moonArm.add(m, rod);
    g.add(moonArm);
    moons.push({ obj: moonArm, period: 27.3217, phase: 218.316 * D2R, mat: m.material });
  }
  if (P.key === 'jupiter') {
    [[1.769, 0.24], [3.551, 0.29], [7.155, 0.35], [16.69, 0.43]].forEach(([per, r], j) => {
      const mg = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: ['#f2d36a', '#e6e0d0', '#c9bfae', '#8f8a80'][j] }));
      m.position.x = r;
      mg.add(m);
      g.add(mg);
      moons.push({ obj: mg, period: per, phase: j * 1.7 });
    });
  }
  planetObjs.push({ P, g, arm, pin, knob, body, mat, yArm, tubeR, moons, r: ORRERY_R[i], spin: 0 });
}

// the sun on the central spindle
const sunMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec3 vObj; varying vec3 vN; varying vec3 vW; void main(){ vObj = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`varying vec3 vObj; varying vec3 vN; varying vec3 vW; uniform float uTime; ${NOISE}
    void main(){
      float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
      float g = fbm(vObj * 9.0 + vec3(0.0, uTime * 0.05, 0.0)) * 0.6 + fbm(vObj * 30.0 - uTime * 0.03) * 0.4;
      vec3 col = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.86, 0.5), g);
      col *= (0.45 + 0.55 * pow(mu, 0.5)) * 2.6;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sun = new THREE.Mesh(new THREE.SphereGeometry(0.24, 64, 48), sunMat);
sun.position.y = SUN_Y;
sun.userData.planet = -1;
scene.add(sun);
const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, SUN_Y - BASE_Y, 16), steel);
spindle.position.y = (SUN_Y + BASE_Y) / 2;
scene.add(spindle);

// gear train on the centre plate: one wheel per planet tube, each driven by a pinion on a common lay shaft
const LAY = new THREE.Vector3(0.6, 0, -0.18);
const wheels = [], pinions = [];
for (let i = 0; i < PLANETS.length; i++) {
  const y = BASE_Y + 0.02 + (PLANETS.length - 1 - i) * 0.027;
  const rw = 0.43 - i * 0.022;
  const dist = Math.hypot(LAY.x, LAY.z);
  const rp = Math.max(dist - rw, 0.06);
  const teethW = Math.round(rw * 260), teethP = Math.max(8, Math.round(rp * 260));
  const w = new THREE.Mesh(gearGeometry(teethW, rw), i % 2 ? brass : brassDark);
  w.position.y = y;
  scene.add(w);
  const p = new THREE.Mesh(gearGeometry(teethP, rp, 0.016, 0.018, 0), i % 2 ? brassDark : brass);
  p.position.set(LAY.x, y, LAY.z);
  scene.add(p);
  wheels.push({ mesh: w, i, rw });
  pinions.push({ mesh: p, i, ratio: rw / rp, teethP });
}
{
  const lay = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 12), steel);
  lay.position.set(LAY.x, BASE_Y + 0.14, LAY.z);
  scene.add(lay);
}

// the crank on the side of the drum
const crank = new THREE.Group();
crank.position.set(-1.32, 0.17, 0);
scene.add(crank);
const crankSpin = new THREE.Group();
crank.add(crankSpin);
{
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 16), steel);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -0.06;
  crank.add(shaft);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 24), brass);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = -0.14;
  crankSpin.add(hub);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.035), brass);
  lever.position.set(-0.15, 0.11, 0);
  crankSpin.add(lever);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.14, 20), ebony);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-0.23, 0.23, 0);
  crankSpin.add(handle);
  crankSpin.traverse((o) => { if (o.isMesh) o.userData.crank = true; });
}

// orbit circles and the Earth→Mars sight line
const orbitLines = new THREE.Group();
scene.add(orbitLines);
const orbitMat = new THREE.LineBasicMaterial({ color: '#c9a45e', transparent: true, opacity: 0.22 });
const orbitGeos = planetObjs.map(() => {
  const g = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 257 }, (_, j) => new THREE.Vector3(Math.cos(j / 256 * TAU), 0, -Math.sin(j / 256 * TAU))));
  const l = new THREE.Line(g, orbitMat);
  l.position.y = SUN_Y;
  orbitLines.add(l);
  return l;
});
const sightGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const sight = new THREE.Line(sightGeo, new THREE.LineBasicMaterial({ color: '#ff8a5c', transparent: true, opacity: 0.9 }));
scene.add(sight);

// labels
const tags = planetObjs.map((o) => {
  const div = el('div', { class: 'tag' }, el('span', { style: 'transform: translateY(-22px)' }, o.P.ar));
  const obj = new CSS2DObject(div);
  scene.add(obj);
  return obj;
});
const sunTag = new CSS2DObject(el('div', { class: 'tag' }, el('span', { style: 'transform: translateY(-38px); color: #ffd98a' }, 'الشمس')));
sunTag.position.set(0, SUN_Y, 0);
scene.add(sunTag);
const marsTag = new CSS2DObject(el('div', { class: 'tag' }, el('span', { style: 'color: #ff9c74' }, 'المريخ بين النجوم')));
scene.add(marsTag);

// ---------------------------------------------------------------- time and state
let ms = Date.now();
let realK = 0;
function jumpTo(t) { ms = t; ui.set('speed', 0); ui.refresh(); }

const gregFmt = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const hijriFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

// ---------------------------------------------------------------- interaction: crank and planet picking
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let cranking = null;
const card = el('section', { class: 'obj-card', hidden: true });
document.body.append(card);
function setPointer(e) {
  const r = stage.canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
function crankScreenAngle(e) {
  const c = new THREE.Vector3();
  crankSpin.children[0].getWorldPosition(c);
  c.project(camera);
  const r = stage.canvas.getBoundingClientRect();
  const sx = (c.x * 0.5 + 0.5) * r.width + r.left, sy = (-c.y * 0.5 + 0.5) * r.height + r.top;
  return Math.atan2(e.clientY - sy, e.clientX - sx);
}
let downAt = null;
stage.canvas.addEventListener('pointerdown', (e) => {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(crankSpin.children, true)[0];
  downAt = { x: e.clientX, y: e.clientY };
  if (hit) {
    cranking = { ang: crankScreenAngle(e) };
    controls.enabled = false;
    stage.canvas.setPointerCapture(e.pointerId);
    ui.set('speed', 0); ui.refresh();
  }
});
stage.canvas.addEventListener('pointermove', (e) => {
  setPointer(e);
  if (cranking) {
    const a = crankScreenAngle(e);
    let d = a - cranking.ang;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    cranking.ang = a;
    ms += (Math.abs(d) / TAU) * 30 * 86400000 * (d > 0 ? 1 : -1) * (camera.position.z > 0 ? 1 : -1);
    crankAngle += d;
    return;
  }
  raycaster.setFromCamera(pointer, camera);
  const over = raycaster.intersectObjects([...crankSpin.children, ...planetObjs.map((o) => o.body), sun], true)[0];
  stage.canvas.style.cursor = over ? (over.object.userData.crank ? 'grab' : 'pointer') : '';
});
stage.canvas.addEventListener('pointerup', (e) => {
  if (cranking) { cranking = null; controls.enabled = true; return; }
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...planetObjs.map((o) => o.body), sun], false)[0];
    if (hit) showPlanet(hit.object.userData.planet);
  }
  downAt = null;
});

function showPlanet(i) {
  card.hidden = false;
  if (i < 0) {
    card.innerHTML = `<button class="chip close" type="button">إغلاق</button><h2>الشمس</h2><div class="sub">نجم متوسط عمره نحو ٤٫٦ مليار سنة</div>
      <p>تحوي ٩٩٫٨٪ من كتلة المجموعة الشمسية كلها. ضوؤها الذي يصلك الآن خرج من سطحها قبل ثماني دقائق وعشرين ثانية، لكنه احتاج عشرات آلاف السنين ليشق طريقه من قلبها إلى السطح.</p>`;
  } else {
    const P = PLANETS[i];
    const d = daysOf(ms);
    const h = heliocentricLongitude(P, d), e = heliocentricLongitude(PLANETS[2], d);
    const dx = h.r * Math.cos(h.lon) - e.r * Math.cos(e.lon), dy = h.r * Math.sin(h.lon) - e.r * Math.sin(e.lon);
    const fromEarth = P.key === 'earth' ? null : Math.hypot(dx, dy) * 149.6;
    card.innerHTML = `<button class="chip close" type="button">إغلاق</button><h2>${P.ar}</h2>
      <div class="sub">يبعد عن الشمس ${P.el[0].toFixed(2)} وحدة فلكية</div>
      <dl>
        <div><dt>سنته</dt><dd>${P.period < 1000 ? Math.round(P.period) + ' يوماً' : (P.period / 365.25).toFixed(1) + ' سنة أرضية'}</dd></div>
        <div><dt>يومه</dt><dd>${P.day}</dd></div>
        <div><dt>الأقمار</dt><dd>${P.moons}</dd></div>
        ${fromEarth ? `<div><dt>بعده عن الأرض في هذا التاريخ</dt><dd>${Math.round(fromEarth).toLocaleString('en')} مليون كم</dd></div>` : ''}
      </dl>
      <p>${P.fact}</p>`;
  }
  card.querySelector('.close').addEventListener('click', () => { card.hidden = true; });
}

// ---------------------------------------------------------------- frame loop
stage.onResize((bw, bh, w, h) => {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  labelRenderer.setSize(w, h);
});

let crankAngle = 0, t = 0, roT = 0, first = true, prevMarsGeo = null;
window.__exhibit = { ui, camera, setTime: (x) => { ms = x; } };

stage.start((dt) => {
  const v = ui.values;
  t += dt;
  if (!cranking) {
    const step = v.speed * dt * 86400000 * (v.reverse ? -1 : 1);
    ms += step;
    crankAngle += (step / 86400000 / 30) * TAU;
  }
  crankSpin.rotation.x = -crankAngle;
  realK += ((v.real ? 1 : 0) - realK) * Math.min(1, dt * 2.5);
  sunMat.uniforms.uTime.value = t;
  const sunScale = THREE.MathUtils.lerp(1, 0.25, realK);
  sun.scale.setScalar(sunScale);

  const d = daysOf(ms);
  const earthH = heliocentricLongitude(PLANETS[2], d);
  let marsGeo = null;
  planetObjs.forEach((o, i) => {
    const h = heliocentricLongitude(o.P, d);
    const rr = THREE.MathUtils.lerp(o.r, o.P.el[0] * 0.0875, realK);
    const size = o.P.size * THREE.MathUtils.lerp(1, 0.5, realK);
    o.g.rotation.y = h.lon;
    const armStart = o.tubeR;
    o.arm.scale.x = Math.max(rr - armStart, 0.001);
    o.arm.position.set(armStart + (rr - armStart) / 2, o.yArm, 0);
    const pinLen = Math.max(SUN_Y - size - o.yArm, 0.001);
    o.pin.scale.y = pinLen;
    o.pin.position.set(rr, o.yArm + pinLen / 2, 0);
    o.knob.position.set(rr, o.yArm, 0);
    o.body.scale.setScalar(size);
    o.body.parent.position.set(rr, SUN_Y, 0);
    o.body.rotation.y += dt * (o.P.key === 'venus' ? -0.2 : 1.2) * Math.min(4, v.speed / 7 + 0.15);
    for (const m of o.moons) {
      m.obj.position.set(rr, SUN_Y, 0);
      m.obj.rotation.y = (d / m.period) * TAU + m.phase - h.lon;
    }
    orbitGeos[i].scale.setScalar(rr);
    orbitGeos[i].visible = v.orbits;
    const wp = new THREE.Vector3();
    o.body.getWorldPosition(wp);
    tags[i].position.copy(wp);
    tags[i].visible = v.names;
    if (o.P.key === 'mars') {
      const ex = earthH.r * Math.cos(earthH.lon), ey = earthH.r * Math.sin(earthH.lon);
      const mx = h.r * Math.cos(h.lon), my = h.r * Math.sin(h.lon);
      marsGeo = Math.atan2(my - ey, mx - ex);
    }
  });
  wheels.forEach((w) => { w.mesh.rotation.y = planetObjs[w.i].g.rotation.y; });
  pinions.forEach((p) => { p.mesh.rotation.y = -planetObjs[p.i].g.rotation.y * p.ratio + Math.PI / p.teethP; });

  // Earth → Mars sight line extended out to the "sky"
  const earthW = new THREE.Vector3(), marsW = new THREE.Vector3();
  planetObjs[2].body.getWorldPosition(earthW);
  planetObjs[3].body.getWorldPosition(marsW);
  const dir = marsW.clone().sub(earthW).normalize();
  const far = earthW.clone().addScaledVector(dir, 3.4);
  sightGeo.attributes.position.array.set([earthW.x, earthW.y, earthW.z, far.x, far.y, far.z]);
  sightGeo.attributes.position.needsUpdate = true;
  sight.visible = v.marsLine;
  marsTag.position.copy(far);
  marsTag.visible = v.marsLine;

  controls.autoRotate = v.auto;
  controls.update();
  stage.render();
  labelRenderer.render(scene, camera);

  roT -= dt;
  if (roT <= 0) {
    roT = 0.15;
    const date = new Date(ms);
    ui.readout('date', gregFmt.format(date));
    ui.readout('hijri', hijriFmt.format(date));
    const sunGeo = ((earthH.lon + Math.PI) % TAU + TAU) % TAU;
    ui.readout('sign', `في برج ${ZODIAC[Math.floor(sunGeo / (TAU / 12)) % 12]}`);
    if (marsGeo != null) {
      const lonDeg = ((marsGeo * 180 / Math.PI) % 360 + 360) % 360;
      let retro = false;
      if (prevMarsGeo != null && v.speed > 0) {
        let dm = marsGeo - prevMarsGeo.lon, dd = d - prevMarsGeo.d;
        dm = Math.atan2(Math.sin(dm), Math.cos(dm));
        if (dd !== 0) retro = dm / dd < 0;
      } else {
        const g2 = (() => { const e2 = heliocentricLongitude(PLANETS[2], d + 1), m2 = heliocentricLongitude(PLANETS[3], d + 1); return Math.atan2(m2.r * Math.sin(m2.lon) - e2.r * Math.sin(e2.lon), m2.r * Math.cos(m2.lon) - e2.r * Math.cos(e2.lon)); })();
        let dm = g2 - marsGeo;
        dm = Math.atan2(Math.sin(dm), Math.cos(dm));
        retro = dm < 0;
      }
      prevMarsGeo = { lon: marsGeo, d };
      ui.readout('mars', `في برج ${ZODIAC[Math.floor(lonDeg / 30) % 12]}${retro ? '، ويبدو راجعاً الآن' : ''}`);
    }
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
