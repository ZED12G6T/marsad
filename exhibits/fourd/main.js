import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createShell, WEBGL_FAIL } from '../../assets/js/shell.js';
import { createStage } from '../../assets/js/stage.js';

const PHI = (1 + Math.sqrt(5)) / 2;
// segments per edge, so edges can bend under stereographic projection (more for shapes with few edges)
const subOf = (sh) => (sh.hopf || sh.torus ? 1 : sh.E.length < 200 ? 32 : 10);

// ---------------------------------------------------------------- building the shapes
function edgesByLength(verts, len, tol = 1e-3) {
  const E = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    const d = Math.hypot(...verts[i].map((x, k) => x - verts[j][k]));
    if (Math.abs(d - len) < tol) E.push([i, j]);
  }
  return E;
}
function adjacency(n, E) { const A = Array.from({ length: n }, () => new Set()); for (const [a, b] of E) { A[a].add(b); A[b].add(a); } return A; }
function triangles(n, E) {
  const A = adjacency(n, E), T = [];
  for (const [a, b] of E) for (const c of A[a]) if (c > b && A[b].has(c)) T.push([a, b, c]);
  return T;
}
function signedPerms(base) {
  // all permutations of coordinates with all sign changes, deduplicated
  const out = new Map();
  const perm = (arr, l = 0) => {
    if (l === arr.length) {
      for (let s = 0; s < 16; s++) {
        const v = arr.map((x, i) => (s >> i & 1 ? -x : x));
        out.set(v.map((x) => x.toFixed(5)).join(','), v);
      }
      return;
    }
    for (let i = l; i < arr.length; i++) { [arr[l], arr[i]] = [arr[i], arr[l]]; perm(arr, l + 1); [arr[l], arr[i]] = [arr[i], arr[l]]; }
  };
  perm(base.slice());
  return [...out.values()];
}
function evenPerms(base) {
  const P = [[0, 1, 2, 3], [0, 2, 3, 1], [0, 3, 1, 2], [1, 0, 3, 2], [1, 2, 0, 3], [1, 3, 2, 0], [2, 0, 1, 3], [2, 1, 3, 0], [2, 3, 0, 1], [3, 0, 2, 1], [3, 1, 0, 2], [3, 2, 1, 0]];
  const out = new Map();
  for (const p of P) for (let s = 0; s < 16; s++) {
    const v = p.map((idx, i) => { const x = base[idx]; return s >> i & 1 ? -x : x; });
    out.set(v.map((x) => x.toFixed(5)).join(','), v);
  }
  return [...out.values()];
}

function tesseract() {
  const V = [];
  for (let i = 0; i < 16; i++) V.push([0, 1, 2, 3].map((k) => (i >> k & 1 ? 1 : -1)));
  const E = edgesByLength(V, 2);
  // square faces: vertices that agree in two coordinates
  const F = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const free = [0, 1, 2, 3].filter((k) => k !== a && k !== b);
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const idx = (x, y) => V.findIndex((v) => v[a] === sa && v[b] === sb && v[free[0]] === x && v[free[1]] === y);
      F.push([idx(-1, -1), idx(1, -1), idx(1, 1), idx(-1, 1)]);
    }
  }
  return { V, E, F, cells: 8, cellName: 'مكعبات' };
}
function sixteenCell() {
  const V = signedPerms([1, 0, 0, 0]);
  const E = edgesByLength(V, Math.SQRT2);
  return { V, E, F: triangles(V.length, E), cells: 16, cellName: 'رباعيات أوجه' };
}
function twentyFourCell() {
  const V = signedPerms([1, 1, 0, 0]);
  const E = edgesByLength(V, Math.SQRT2);
  return { V, E, F: triangles(V.length, E), cells: 24, cellName: 'ثمانيات أوجه' };
}
function sixHundredCell() {
  const V = [...signedPerms([0.5, 0.5, 0.5, 0.5]), ...signedPerms([1, 0, 0, 0]), ...evenPerms([PHI / 2, 0.5, 1 / (2 * PHI), 0])];
  const E = edgesByLength(V, 1 / PHI);
  return { V, E, F: triangles(V.length, E), cells: 600, cellName: 'رباعيات أوجه' };
}
function oneTwentyCell() {
  // the dual of the 600-cell: one vertex at the centre of each of its 600 tetrahedra
  const s = sixHundredCell();
  const A = adjacency(s.V.length, s.E);
  const tets = [];
  for (const [a, b, c] of s.F) for (const d of A[a]) if (d > c && A[b].has(d) && A[c].has(d)) tets.push([a, b, c, d]);
  const V = tets.map((t) => { const v = [0, 0, 0, 0]; t.forEach((i) => s.V[i].forEach((x, k) => (v[k] += x / 4))); return v; });
  const faceMap = new Map();
  tets.forEach((t, ti) => {
    for (let k = 0; k < 4; k++) {
      const f = t.filter((_, j) => j !== k).join(',');
      if (!faceMap.has(f)) faceMap.set(f, []);
      faceMap.get(f).push(ti);
    }
  });
  const E = [...faceMap.values()].filter((x) => x.length === 2);
  // pentagons: the 5 tetrahedra around each edge of the 600-cell, in cyclic order
  const F = [];
  const cellAdj = adjacency(V.length, E);
  for (const [a, b] of s.E) {
    const ring = tets.map((t, i) => (t.includes(a) && t.includes(b) ? i : -1)).filter((i) => i >= 0);
    if (ring.length !== 5) continue;
    const ordered = [ring[0]];
    while (ordered.length < 5) {
      const last = ordered[ordered.length - 1];
      const next = ring.find((r) => !ordered.includes(r) && cellAdj[last].has(r));
      if (next == null) break;
      ordered.push(next);
    }
    if (ordered.length === 5) F.push(ordered);
  }
  return { V, E, F, cells: 120, cellName: 'اثنا عشريات أوجه' };
}
function cliffordTorus() {
  const V = [], E = [], n = 24, m = 48;
  const idx = (i, j) => (i % n) * m + (j % m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = (i / n) * Math.PI * 2, b = (j / m) * Math.PI * 2;
    V.push([Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)].map((x) => x / Math.SQRT2));
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { E.push([idx(i, j), idx(i, j + 1)]); if (j % 4 === 0) E.push([idx(i, j), idx(i + 1, j)]); }
  return { V, E, F: [], torus: true };
}
function hopf() {
  // fibres of the Hopf map S³ → S²: every point of the 2-sphere becomes a circle, and every two circles link
  const V = [], E = [], C = [];
  const rings = [0.16, 0.27, 0.38, 0.49, 0.6, 0.71], per = 14, seg = 120;
  rings.forEach((eta, ri) => {
    for (let k = 0; k < per; k++) {
      const phi = (k / per) * Math.PI * 2 + ri * 0.4;
      const start = V.length;
      for (let s = 0; s < seg; s++) {
        const t = (s / seg) * Math.PI * 2;
        V.push([Math.cos(eta) * Math.cos(t + phi), Math.cos(eta) * Math.sin(t + phi), Math.sin(eta) * Math.cos(t), Math.sin(eta) * Math.sin(t)]);
        E.push([start + s, start + ((s + 1) % seg)]);
        const col = new THREE.Color().setHSL(k / per, 0.75, 0.42 + ri * 0.05);
        C.push(col);
      }
    }
  });
  return { V, E, F: [], fibreColors: C, hopf: true };
}

const SHAPES = {
  tesseract: { ar: 'المكعب الرباعي (تسراكت)', build: tesseract },
  c16: { ar: 'ذو الست عشرة خلية', build: sixteenCell },
  c24: { ar: 'ذو الأربع والعشرين خلية', build: twentyFourCell },
  c120: { ar: 'ذو المئة والعشرين خلية', build: oneTwentyCell },
  c600: { ar: 'ذو الستمئة خلية', build: sixHundredCell },
  torus: { ar: 'طارة كليفورد', build: cliffordTorus },
  hopf: { ar: 'تليّف هوبف', build: hopf },
};

// ---------------------------------------------------------------- UI
const ui = createShell({
  title: 'البعد الرابع',
  scale: 'بلا مقياس: اتجاه رابع عمودي على الثلاثة',
  hint: 'اسحب لتدوّر في أبعادنا الثلاثة، واسحب مع الضغط على Shift لتدوّر في البعد الرابع',
  readouts: [
    { key: 'name', label: 'الشكل' },
    { key: 'parts', label: 'مكوّناته' },
  ],
  controls: [
    { type: 'group', label: 'الشكل' },
    { type: 'select', key: 'shape', value: 'tesseract', options: Object.entries(SHAPES).map(([value, s]) => ({ value, label: s.ar })) },
    { type: 'segmented', key: 'proj', label: 'الإسقاط إلى أبعادنا', value: 'persp', options: [
      { value: 'persp', label: 'منظوري (ظل)' },
      { value: 'stereo', label: 'كروي' },
    ] },
    { type: 'group', label: 'الدوران في البعد الرابع' },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي', value: true },
    { type: 'range', key: 'speed', label: 'السرعة', min: 0, max: 2, step: 0.01, value: 0.5, format: (v) => `×${v.toFixed(2)}` },
    { type: 'range', key: 'xw', label: 'مستوى X–W', min: -3.1416, max: 3.1416, step: 0.01, value: 0, format: (v) => `${Math.round(v * 57.3)}°` },
    { type: 'range', key: 'yw', label: 'مستوى Y–W', min: -3.1416, max: 3.1416, step: 0.01, value: 0, format: (v) => `${Math.round(v * 57.3)}°` },
    { type: 'range', key: 'zw', label: 'مستوى Z–W', min: -3.1416, max: 3.1416, step: 0.01, value: 0, format: (v) => `${Math.round(v * 57.3)}°` },
    { type: 'group', label: 'المرور عبر عالمنا' },
    { type: 'toggle', key: 'slice', label: 'أظهر الشريحة التي تقطع عالمنا', value: false },
    { type: 'range', key: 'cut', label: 'موضع الشريحة', min: -1.2, max: 1.2, step: 0.005, value: 0, format: (v) => v.toFixed(2), when: (v) => v.slice },
    { type: 'toggle', key: 'sweep', label: 'حرّك الشريحة تلقائياً', value: true, when: (v) => v.slice },
    { type: 'group', label: 'العرض' },
    { type: 'range', key: 'width', label: 'سُمك الخطوط', min: 0.5, max: 5, step: 0.1, value: 2, format: (v) => v.toFixed(1) },
    { type: 'toggle', key: 'verts', label: 'الرؤوس', value: true },
    { type: 'toggle', key: 'spin3', label: 'دوران بطيء للكاميرا', value: false },
  ],
  onChange(key) { if (key === 'shape') build(); },
  info: `
    <h2>كيف ترى شيئاً من أربعة أبعاد؟</h2>
    <p>تخيّل كائناً مسطحاً يعيش على ورقة ولا يعرف إلا الطول والعرض. لو مرّت كرة عبر ورقته لرأى نقطة تكبر إلى دائرة ثم تصغر وتختفي، ولن يفهم أبداً أنها كرة. ولو أضأت على مكعب لرأى ظلّه المسطح: مربعاً داخل مربع. نحن بالنسبة للبعد الرابع مثل هذا الكائن تماماً. ما تراه هنا «ظلال» أشكال رباعية الأبعاد على عالمنا الثلاثي.</p>
    <h3>لماذا يبدو المكعب الرباعي كأنه ينقلب على نفسه؟</h3>
    <p>هو لا ينقلب ولا يتشوه. إنه يدور في مستوى يحوي المحور الرابع، فيقترب جزء منه من «الضوء» ويبتعد جزء، فيكبر ظل الأول ويصغر ظل الثاني. المكعب الصغير في الداخل والكبير في الخارج مكعبان متطابقان تماماً، وكذلك الأشكال الستة بينهما، والمكعب الرباعي كله ثماني خلايا مكعبة. اللون يدل على الإحداثي الرابع: الأزرق «أبعد» في البعد الرابع، والبرتقالي «أقرب».</p>
    <h3>ستة أشكال فقط</h3>
    <p>في عالمنا خمسة مجسمات منتظمة فقط (مجسمات أفلاطون). أما في الأبعاد الأربعة فهناك ستة بالضبط، اكتشفها الرياضي السويسري لودفيغ شلافلي نحو عام ١٨٥٠. أعقدها ذو الستمئة خلية: ١٢٠ رأساً و٧٢٠ حافة وستمئة رباعي أوجه، وأخوه ذو المئة والعشرين خلية المبني من ١٢٠ مجسماً اثني عشري الأوجه.</p>
    <h3>الإسقاط الكروي</h3>
    <p>بدلاً من الظل المنظوري، يمكن نفخ الشكل على كرة رباعية الأبعاد ثم إسقاطه، فتنحني حوافه وتصير كل خلاياه مرئية. هكذا تبدو الأشكال المنتظمة أجمل، وهكذا يُرسم «تليّف هوبف»: طريقة لملء الكرة الرباعية بدوائر لا تتقاطع أبداً، لكن كل دائرتين منها متشابكتان كحلقتي سلسلة. اكتشفه هاينز هوبف عام ١٩٣١، ويظهر اليوم في فيزياء الكم وفي وصف دوران الأجسام.</p>
    <h3>الشريحة</h3>
    <p>فعّل «الشريحة» لترى ما يراه كائن ثلاثي الأبعاد حين يمر الشكل عبر عالمه: مجسمات تظهر وتتحول وتختفي، كما يرى الكائن المسطح الكرة دوائر متغيرة.</p>
  `,
});

// ---------------------------------------------------------------- scene
const stage = createStage({ bloom: { strength: 0.7, radius: 0.5, threshold: 0.35 }, exposure: 1.0, startScale: 1 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const scene = new THREE.Scene();
scene.background = new THREE.Color('#04060f');
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
camera.position.set(3.4, 2.2, 5.2);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 20;
controls.autoRotateSpeed = 0.4;
stage.setScene(scene, camera);

const lineMat = new LineMaterial({ linewidth: 2, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const sliceMat = new LineMaterial({ linewidth: 3.5, color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
let lines = null, sliceLines = null, verts = null, shape = null;
let segPos, segCol, slicePos, sliceCol;
const MAX_SLICE = 4000;

function build() {
  if (lines) { scene.remove(lines); lines.geometry.dispose(); }
  if (sliceLines) { scene.remove(sliceLines); sliceLines.geometry.dispose(); }
  if (verts) { scene.remove(verts); verts.geometry.dispose(); }
  const key = ui.values.shape;
  shape = SHAPES[key].build();
  // normalise every vertex to the unit 3-sphere (projection math assumes radius 1)
  const r = Math.max(...shape.V.map((v) => Math.hypot(...v)));
  shape.V = shape.V.map((v) => v.map((x) => x / r));
  const nSeg = shape.E.length * subOf(shape);
  segPos = new Float32Array(nSeg * 6);
  segCol = new Float32Array(nSeg * 6);
  const g = new LineSegmentsGeometry();
  g.setPositions(segPos);
  g.setColors(segCol);
  lines = new LineSegments2(g, lineMat);
  lines.frustumCulled = false;
  scene.add(lines);

  slicePos = new Float32Array(MAX_SLICE * 6);
  sliceCol = new Float32Array(MAX_SLICE * 6).fill(1);
  const sg = new LineSegmentsGeometry();
  sg.setPositions(slicePos);
  sg.setColors(sliceCol);
  sliceLines = new LineSegments2(sg, sliceMat);
  sliceLines.frustumCulled = false;
  scene.add(sliceLines);

  const showV = !shape.hopf && !shape.torus;
  verts = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), showV ? shape.V.length : 1);
  verts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((showV ? shape.V.length : 1) * 3), 3);
  verts.visible = showV;
  scene.add(verts);

  ui.readout('name', SHAPES[key].ar);
  ui.readout('parts', shape.hopf ? `${shape.E.length / 120} دائرة متشابكة` : shape.torus ? 'سطح مسطّح تماماً يعيش في أربعة أبعاد' : `${shape.V.length} رأساً، ${shape.E.length} حافة، ${shape.F.length} وجهاً، ${shape.cells} ${shape.cellName}`);
  const persp = !(shape.hopf);
  if (shape.hopf) { ui.set('proj', 'stereo', { silent: true }); ui.refresh(); }
  else if (persp && key !== 'torus' && ui.values.proj === 'stereo' && (key === 'tesseract' || key === 'c16')) { /* keep user's choice */ }
}

// ---------------------------------------------------------------- 4D rotation and projection
const R = new Float64Array(16);
function rot4(angles) {
  // compose the six plane rotations; angles: [xy, xz, xw, yz, yw, zw]
  const M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const planes = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  planes.forEach(([a, b], i) => {
    const t = angles[i];
    if (!t) return;
    const c = Math.cos(t), s = Math.sin(t);
    for (let row = 0; row < 4; row++) {
      const ra = M[row * 4 + a], rb = M[row * 4 + b];
      M[row * 4 + a] = ra * c - rb * s;
      M[row * 4 + b] = ra * s + rb * c;
    }
  });
  R.set(M);
}
const tmp4 = [0, 0, 0, 0];
function apply(v, out) {
  for (let r = 0; r < 4; r++) out[r] = R[r * 4] * v[0] + R[r * 4 + 1] * v[1] + R[r * 4 + 2] * v[2] + R[r * 4 + 3] * v[3];
  return out;
}
let SCALE = 1.6;
function project(p, stereo, out) {
  let k;
  if (stereo) {
    const len = Math.hypot(p[0], p[1], p[2], p[3]) || 1;
    const w = p[3] / len;
    k = Math.min(1 / Math.max(1 - w, 0.06), 9) / len;
  } else k = 2.4 / (2.4 - p[3] * 0.9);
  out[0] = p[0] * k * SCALE; out[1] = p[1] * k * SCALE; out[2] = p[2] * k * SCALE;
  return k;
}
const W_COOL = new THREE.Color('#4f8dff'), W_MID = new THREE.Color('#f2ead8'), W_WARM = new THREE.Color('#ff8a3a');
const wc = new THREE.Color();
function wColor(w) {
  const t = THREE.MathUtils.clamp((w + 1) / 2, 0, 1);
  return t < 0.5 ? wc.copy(W_COOL).lerp(W_MID, t * 2) : wc.copy(W_MID).lerp(W_WARM, t * 2 - 1);
}

// shift-drag rotates in 4D
let drag4 = null;
stage.canvas.addEventListener('pointerdown', (e) => { if (e.shiftKey) { drag4 = { x: e.clientX, y: e.clientY }; controls.enabled = false; } });
window.addEventListener('pointermove', (e) => {
  if (!drag4) return;
  const dx = e.clientX - drag4.x, dy = e.clientY - drag4.y;
  drag4 = { x: e.clientX, y: e.clientY };
  ui.set('xw', THREE.MathUtils.euclideanModulo(ui.values.xw + dx * 0.01 + Math.PI, Math.PI * 2) - Math.PI, { silent: true });
  ui.set('yw', THREE.MathUtils.euclideanModulo(ui.values.yw + dy * 0.01 + Math.PI, Math.PI * 2) - Math.PI, { silent: true });
});
window.addEventListener('pointerup', () => { if (drag4) { drag4 = null; controls.enabled = true; } });

stage.onResize((bw, bh, w, h) => {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  lineMat.resolution.set(w, h);
  sliceMat.resolution.set(w, h);
});
build();
window.__exhibit = { ui, build };

const pA = [0, 0, 0, 0], pB = [0, 0, 0, 0], q3a = [0, 0, 0], q3b = [0, 0, 0], ip = [0, 0, 0, 0];
const mtx = new THREE.Matrix4();
let t = 0, first = true;
stage.start((dt) => {
  const v = ui.values;
  if (v.auto) t += dt * v.speed;
  rot4([t * 0.13, 0, v.xw + t * 0.61, t * 0.07, v.yw + t * 0.37, v.zw + t * 0.23]);
  const stereo = v.proj === 'stereo';
  lineMat.linewidth = v.width;
  sliceMat.linewidth = v.width * 1.8;

  // edges, subdivided so they can curve (great-circle arcs on the 3-sphere);
  // dense shapes are dimmed so thousands of additive lines don't wash out to white
  const sub = subOf(shape);
  const bright = shape.hopf ? 0.45 : shape.torus ? 0.6 : Math.min(1, 7 / Math.sqrt(shape.E.length));
  SCALE = stereo ? (shape.V.length > 100 ? 0.75 : 1.0) : 1.6;
  let o = 0;
  for (let ei = 0; ei < shape.E.length; ei++) {
    const [a, b] = shape.E[ei];
    const A = shape.V[a], B = shape.V[b];
    for (let s = 0; s < sub; s++) {
      const t0 = s / sub, t1 = (s + 1) / sub;
      for (let k = 0; k < 4; k++) { ip[k] = A[k] + (B[k] - A[k]) * t0; }
      if (stereo) { const l = Math.hypot(...ip); for (let k = 0; k < 4; k++) ip[k] /= l; }
      apply(ip, pA);
      for (let k = 0; k < 4; k++) { ip[k] = A[k] + (B[k] - A[k]) * t1; }
      if (stereo) { const l = Math.hypot(...ip); for (let k = 0; k < 4; k++) ip[k] /= l; }
      apply(ip, pB);
      const ka = project(pA, stereo, q3a), kb = project(pB, stereo, q3b);
      segPos.set(q3a, o); segPos.set(q3b, o + 3);
      // fade the far tails of the stereographic projection and, when slicing, dim everything but the cut
      const dim = bright * (v.slice ? 0.25 : 1) * (stereo ? Math.min(1, 3.2 / Math.max(ka, kb)) : 1);
      const ca = shape.hopf ? shape.fibreColors[ei] : wColor(pA[3]);
      segCol[o] = ca.r * dim; segCol[o + 1] = ca.g * dim; segCol[o + 2] = ca.b * dim;
      const cb = shape.hopf ? shape.fibreColors[ei] : wColor(pB[3]);
      segCol[o + 3] = cb.r * dim; segCol[o + 4] = cb.g * dim; segCol[o + 5] = cb.b * dim;
      o += 6;
    }
  }
  const ig = lines.geometry;
  ig.attributes.instanceStart.data.array.set(segPos);
  ig.attributes.instanceStart.data.needsUpdate = true;
  ig.attributes.instanceColorStart.data.array.set(segCol);
  ig.attributes.instanceColorStart.data.needsUpdate = true;

  // vertices
  if (verts.visible) {
    verts.visible = v.verts;
    for (let i = 0; i < shape.V.length; i++) {
      apply(shape.V[i], pA);
      const k = project(pA, stereo, q3a);
      const size = 0.03 * Math.min(k, 3) * (shape.V.length > 200 ? 0.6 : 1);
      mtx.makeScale(size, size, size).setPosition(q3a[0], q3a[1], q3a[2]);
      verts.setMatrixAt(i, mtx);
      verts.setColorAt(i, wColor(pA[3]).clone().multiplyScalar(1.6 * Math.min(1, bright * 1.6) * (v.slice ? 0.3 : 1)));
    }
    verts.instanceMatrix.needsUpdate = true;
    verts.instanceColor.needsUpdate = true;
  }
  if (!shape.hopf && !shape.torus) verts.visible = v.verts;

  // the 3D slice w = cut: every face that crosses the hyperplane contributes one segment
  let ns = 0;
  if (v.slice && shape.F.length) {
    const cut = v.sweep ? Math.sin(performance.now() / 2600) * 0.95 : v.cut;
    if (v.sweep) ui.set('cut', cut, { silent: true });
    const rv = shape.V.map((p) => apply(p, [0, 0, 0, 0]));
    for (const f of shape.F) {
      const pts = [];
      for (let i = 0; i < f.length; i++) {
        const a = rv[f[i]], b = rv[f[(i + 1) % f.length]];
        const da = a[3] - cut, db = b[3] - cut;
        if ((da < 0) !== (db < 0)) {
          const s = da / (da - db);
          pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]);
        }
      }
      if (pts.length === 2 && ns < MAX_SLICE) {
        // the slice lives in our space: show it at true size, unprojected
        slicePos.set(pts[0].map((x) => x * SCALE * 1.1), ns * 6);
        slicePos.set(pts[1].map((x) => x * SCALE * 1.1), ns * 6 + 3);
        ns++;
      }
    }
  }
  for (let i = ns; i < MAX_SLICE && i < ns + 8; i++) slicePos.fill(0, i * 6, i * 6 + 6);
  const sgeo = sliceLines.geometry;
  sgeo.attributes.instanceStart.data.array.set(slicePos);
  sgeo.attributes.instanceStart.data.needsUpdate = true;
  sgeo.instanceCount = ns;
  sliceLines.visible = ns > 0;
  for (let i = 0; i < ns; i++) sliceCol.set([1.3, 1.1, 0.8, 1.3, 1.1, 0.8], i * 6);
  sgeo.attributes.instanceColorStart.data.array.set(sliceCol);
  sgeo.attributes.instanceColorStart.data.needsUpdate = true;

  controls.autoRotate = v.spin3;
  controls.update();
  stage.render();
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
