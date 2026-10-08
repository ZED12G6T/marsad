import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createShell, WEBGL_FAIL, ltr } from '../../assets/js/shell.js';
import { createStage, shaderQuad, cameraUniforms, syncCamera, RAY_GLSL, QUALITY_OPTIONS } from '../../assets/js/stage.js';

// Hydrogen eigenstates ψ_nlm = R_nl(r)·Y_lm(θ,φ), in Bohr radii.
// Whenever the state changes, both wavefunctions are evaluated on the CPU into one
// 3D texture (Re ψA, Im ψA, Re ψB, Im ψB); the shader only combines them with their
// time-dependent phases and renders the result.
const GRID = 96;

const FRAG = /* glsl */`
precision highp sampler3D;
varying vec2 vUv;
uniform sampler3D uPsi;
uniform float uAmpA;
uniform float uAmpB;
uniform float uPhB;
uniform int uMode;
uniform float uGain;
uniform float uIso;
uniform float uCut;
uniform vec3 uCutN;
uniform int uSteps;
uniform float uFrame;
${RAY_GLSL}

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// World is y-up; the baked grid is in physics axes (z-up), spanning [-1, 1]³.
vec2 wave(vec3 p) {
  // textureLod: implicit derivatives are undefined inside loops with a variable trip count.
  vec4 s = textureLod(uPsi, p.xzy * 0.5 + 0.5, 0.0);
  return s.xy * uAmpA + cmul(s.zw * uAmpB, vec2(cos(uPhB), sin(uPhB)));
}
float density(vec3 p) { vec2 w = wave(p); return dot(w, w); }

// Phase → colour wheel: 0 amber, π/2 magenta, π cyan, -π/2 green.
vec3 phaseColor(vec2 w) {
  float l = length(w) + 1e-9;
  float c = w.x / l, s = w.y / l;
  vec3 col = vec3(1.0, 0.58, 0.16) * max(c, 0.0) + vec3(0.16, 0.7, 1.0) * max(-c, 0.0)
           + vec3(0.95, 0.28, 0.72) * max(s, 0.0) + vec3(0.3, 0.95, 0.5) * max(-s, 0.0);
  // Guard 0/0 where ψ vanishes: one NaN pixel would be smeared over the whole frame by the bloom.
  return col / max(abs(c) + abs(s), 1e-4);
}

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec2 sph(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void main() {
  vec3 ro = uCamPos;
  vec3 rd = cameraRay(vUv);
  vec3 bg = vec3(0.006, 0.008, 0.02) + vec3(0.02, 0.025, 0.05) * (1.0 - length(vUv - 0.5) * 1.3);
  vec3 col = bg;

  // The nucleus: one proton, drawn vastly larger than life so it can be seen at all.
  float tn = max(dot(-ro, rd), 0.0);
  float dn = length(ro + rd * tn);
  vec3 nucleus = vec3(1.0, 0.85, 0.7) * exp(-dn * dn * 9000.0) * 3.0;

  vec2 hs = sph(ro, rd, 1.0);
  if (hs.y <= 0.0) { gl_FragColor = vec4(col + nucleus, 1.0); return; }
  float t0 = max(hs.x, 0.0), t1 = hs.y;

  // Cut away the half facing the camera.
  float tPlane = -1.0;
  if (uCut > 0.5) {
    float den = dot(rd, uCutN);
    float tp = -dot(ro, uCutN) / den;
    if (dot(ro + rd * t0, uCutN) > 0.0) { if (den < 0.0 && tp > t0) { t0 = tp; tPlane = tp; } else t0 = t1; }
    else if (den > 0.0 && tp > t0 && tp < t1) t1 = tp;
  }
  if (t1 <= t0) { gl_FragColor = vec4(col + nucleus, 1.0); return; }

  float dt = (t1 - t0) / float(uSteps);
  float jit = hash12(gl_FragCoord.xy + uFrame * 17.0);

  if (uMode == 0) {
    // Emission–absorption volume of |ψ|², coloured by phase.
    vec3 acc = vec3(0.0);
    float trans = 1.0;
    if (tPlane > 0.0) {
      vec2 w = wave(ro + rd * tPlane);
      acc = phaseColor(w) * pow(dot(w, w), 0.5) * 0.8 * uGain;
      trans = 0.55;
    }
    for (int i = 0; i < uSteps; i++) {
      vec2 w = wave(ro + rd * (t0 + (float(i) + jit) * dt));
      float d = dot(w, w);
      acc += trans * phaseColor(w) * pow(d, 0.85) * uGain * dt * 3.2;
      trans *= exp(-d * 3.0 * dt * uGain);
      if (trans < 0.01) break;
    }
    col = bg * trans + acc + nucleus * trans;
  } else {
    // Isosurface |ψ|² = uIso, refined by bisection and lit.
    if (tPlane > 0.0 && density(ro + rd * tPlane) > uIso) {
      vec2 w = wave(ro + rd * tPlane);
      col = phaseColor(w) * (0.3 + 0.8 * smoothstep(uIso, uIso * 6.0 + 0.05, dot(w, w)));
    } else {
      float prevT = t0, th = -1.0;
      for (int i = 0; i < uSteps; i++) {
        float t = t0 + (float(i) + jit) * dt;
        if (density(ro + rd * t) > uIso) { th = t; break; }
        prevT = t;
      }
      if (th > 0.0) {
        float a = prevT, b = th;
        for (int j = 0; j < 6; j++) { float m = 0.5 * (a + b); if (density(ro + rd * m) > uIso) b = m; else a = m; }
        vec3 p = ro + rd * b;
        const float e = 0.02;
        vec3 g = vec3(density(p + vec3(e, 0, 0)) - density(p - vec3(e, 0, 0)),
                      density(p + vec3(0, e, 0)) - density(p - vec3(0, e, 0)),
                      density(p + vec3(0, 0, e)) - density(p - vec3(0, 0, e)));
        vec3 n = -normalize(g + 1e-9);
        vec3 L = normalize(vec3(0.5, 0.8, 0.3));
        vec3 base = phaseColor(wave(p));
        float dif = max(dot(n, L), 0.0);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        float spe = pow(max(dot(n, normalize(L - rd)), 0.0), 50.0);
        col = base * (0.18 + 0.95 * dif) + base * rim * 0.9 + vec3(1.0) * spe * 0.6;
      } else col = bg + nucleus;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- physics on the CPU
const fact = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const binom = (n, k) => fact(n) / (fact(k) * fact(n - k));
// Radial polynomial coefficients in ρ = 2r/n (generalised Laguerre), times the normalisation constant.
function radialCoefs(n, l) {
  const N = Math.sqrt((2 / n) ** 3 * fact(n - l - 1) / (2 * n * fact(n + l)));
  const k = n - l - 1, a = 2 * l + 1;
  const c = [];
  for (let i = 0; i <= k; i++) c[i] = N * ((i % 2 ? -1 : 1) * binom(k + a, k - i)) / fact(i);
  return c;
}

// Real spherical harmonics on the unit sphere (Condon–Shortley phase dropped).
function realY(l, m, x, y, z) {
  switch (l) {
    case 0: return 0.282095;
    case 1: return 0.488603 * (m === -1 ? y : m === 0 ? z : x);
    case 2:
      switch (m) {
        case -2: return 1.092548 * x * y;
        case -1: return 1.092548 * y * z;
        case 0: return 0.315392 * (3 * z * z - 1);
        case 1: return 1.092548 * x * z;
        default: return 0.546274 * (x * x - y * y);
      }
    case 3:
      switch (m) {
        case -3: return 0.590044 * y * (3 * x * x - y * y);
        case -2: return 2.890611 * x * y * z;
        case -1: return 0.457046 * y * (5 * z * z - 1);
        case 0: return 0.373176 * z * (5 * z * z - 3);
        case 1: return 0.457046 * x * (5 * z * z - 1);
        case 2: return 1.445306 * z * (x * x - y * y);
        default: return 0.590044 * x * (x * x - 3 * y * y);
      }
    default: {
      const x2 = x * x, y2 = y * y, z2 = z * z;
      switch (m) {
        case -4: return 2.503343 * x * y * (x2 - y2);
        case -3: return 1.770131 * y * z * (3 * x2 - y2);
        case -2: return 0.946175 * x * y * (7 * z2 - 1);
        case -1: return 0.669047 * y * z * (7 * z2 - 3);
        case 0: return 0.105786 * (35 * z2 * z2 - 30 * z2 + 3);
        case 1: return 0.669047 * x * z * (7 * z2 - 3);
        case 2: return 0.473087 * (x2 - y2) * (7 * z2 - 1);
        case 3: return 1.770131 * x * z * (x2 - 3 * y2);
        default: return 0.625836 * (x2 * x2 - 6 * x2 * y2 + y2 * y2);
      }
    }
  }
}

const extentFor = (n) => 2.3 * n * n + 5;

// Evaluate ψ (complex) for one state over the grid; returns [re, im] arrays scaled so peak |ψ|² = 1.
function evalState(s, E) {
  const N = GRID, total = N * N * N;
  const re = new Float32Array(total), im = new Float32Array(total);
  const c = radialCoefs(s.n, s.l);
  const am = Math.abs(s.m);
  const complex = s.cplx && s.m !== 0;
  const sign = s.m > 0 ? 1 : -1;
  let peak = 0, idx = 0;
  for (let k = 0; k < N; k++) {
    const z = ((k + 0.5) / N * 2 - 1) * E;
    for (let j = 0; j < N; j++) {
      const y = ((j + 0.5) / N * 2 - 1) * E;
      for (let i = 0; i < N; i++, idx++) {
        const x = ((i + 0.5) / N * 2 - 1) * E;
        const r = Math.sqrt(x * x + y * y + z * z);
        const rho = 2 * r / s.n;
        let poly = 0;
        for (let q = c.length - 1; q >= 0; q--) poly = poly * rho + c[q];
        let rl = 1;
        for (let q = 0; q < s.l; q++) rl *= rho;
        const R = Math.exp(-0.5 * rho) * rl * poly;
        const ir = 1 / r;
        const ux = x * ir, uy = y * ir, uz = z * ir;
        let a, b = 0;
        if (complex) {
          a = R * 0.70710678 * realY(s.l, am, ux, uy, uz);
          b = R * 0.70710678 * sign * realY(s.l, -am, ux, uy, uz);
        } else a = R * realY(s.l, s.m, ux, uy, uz);
        re[idx] = a; im[idx] = b;
        const d = a * a + b * b;
        if (d > peak) peak = d;
      }
    }
  }
  const k = 1 / Math.sqrt(peak || 1);
  for (let q = 0; q < total; q++) { re[q] *= k; im[q] *= k; }
  return [re, im];
}

const psiData = new Uint16Array(GRID * GRID * GRID * 4);
const psiTex = new THREE.Data3DTexture(psiData, GRID, GRID, GRID);
psiTex.format = THREE.RGBAFormat;
psiTex.type = THREE.HalfFloatType;
psiTex.minFilter = psiTex.magFilter = THREE.LinearFilter;
psiTex.wrapS = psiTex.wrapT = psiTex.wrapR = THREE.ClampToEdgeWrapping;
psiTex.unpackAlignment = 1;

const toHalf = THREE.DataUtils.toHalfFloat;
function bake(A, B) {
  const E = Math.max(extentFor(A.n), B ? extentFor(B.n) : 0);
  const [ar, ai] = evalState(A, E);
  const [br, bi] = B ? evalState(B, E) : [null, null];
  const zero = toHalf(0);
  for (let q = 0, o = 0; q < ar.length; q++, o += 4) {
    psiData[o] = toHalf(ar[q]);
    psiData[o + 1] = ai[q] ? toHalf(ai[q]) : zero;
    psiData[o + 2] = br ? toHalf(br[q]) : zero;
    psiData[o + 3] = bi && bi[q] ? toHalf(bi[q]) : zero;
  }
  psiTex.needsUpdate = true;
  return E;
}

// ---------------------------------------------------------------- naming & light
const L_LETTER = ['s', 'p', 'd', 'f', 'g'];
const REAL_NAMES = [
  [''],
  ['y', 'z', 'x'],
  ['xy', 'yz', 'z²', 'xz', 'x²−y²'],
  ['y(3x²−y²)', 'xyz', 'yz²', 'z³', 'xz²', 'z(x²−y²)', 'x(x²−3y²)'],
];
function orbitalName(n, l, m, cplx) {
  const base = `${n}${L_LETTER[l]}`;
  if (l === 0) return base;
  if (cplx) return `${base} m=${m > 0 ? '+' : ''}${m}`;
  if (l <= 3) return `${base} ${REAL_NAMES[l][m + l]}`;
  return `${base} m=${m}`;
}

// Approximate visible colour of a wavelength in nm, or null outside 380–750 nm.
function wavelengthColor(nm) {
  if (nm < 380 || nm > 750) return null;
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else r = 1;
  const f = nm < 420 ? 0.4 + 0.6 * (nm - 380) / 40 : nm > 700 ? 0.4 + 0.6 * (750 - nm) / 50 : 1;
  const c = (v) => Math.round(255 * Math.pow(Math.max(v * f, 0), 0.8));
  return `rgb(${Math.max(c(r), 90)}, ${Math.max(c(g), 90)}, ${Math.max(c(b), 90)})`;
}
const SERIES = { 1: 'سلسلة لايمان', 2: 'سلسلة بالمر', 3: 'سلسلة باشن', 4: 'سلسلة براكيت', 5: 'سلسلة فوند' };

// ---------------------------------------------------------------- UI
const nOptions = () => [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }));
const lOptions = (nKey) => (v) => L_LETTER.map((s, l) => ({ value: l, label: s, disabled: l >= v[nKey] }));
const mOptions = (lKey) => (v) => {
  const out = [];
  for (let m = -v[lKey]; m <= v[lKey]; m++) out.push({ value: m, label: m > 0 ? `+${m}` : String(m) });
  return out;
};

const ui = createShell({
  title: 'ذرة الهيدروجين',
  scale: 'مقياس <bdi class="num">10<sup>−10</sup></bdi> متر',
  hint: 'اسحب لتدور حول الذرة، ومرّر العجلة لتقترب',
  readouts: [
    { key: 'name', label: 'المدار' },
    { key: 'energy', label: 'طاقة الإلكترون' },
    { key: 'nodes', label: 'العُقد' },
    { key: 'light', label: 'الضوء المنبعث' },
  ],
  controls: [
    { type: 'group', label: 'حالات جاهزة' },
    { type: 'buttons', items: [
      { label: '1s', action: () => preset({ n: 1, l: 0, m: 0 }) },
      { label: '2p', action: () => preset({ n: 2, l: 1, m: 0 }) },
      { label: '3d', action: () => preset({ n: 3, l: 2, m: 0 }) },
      { label: '4f', action: () => preset({ n: 4, l: 3, m: 1 }) },
      { label: '5g', action: () => preset({ n: 5, l: 4, m: 2 }) },
      { label: 'حلقة مركّبة', action: () => preset({ n: 4, l: 3, m: 3, cplx: true }) },
    ] },
    { type: 'buttons', items: [
      { label: 'ذرة تُطلق ضوءاً', primary: true, action: () => preset({ n: 2, l: 1, m: 0 }, { n: 1, l: 0, m: 0 }) },
      { label: 'الخط الأحمر Hα', action: () => preset({ n: 3, l: 2, m: 0 }, { n: 2, l: 1, m: 0 }) },
    ] },
    { type: 'group', label: 'الحالة الأولى' },
    { type: 'segmented', key: 'n', label: 'الرقم الرئيسي n: الطاقة والحجم', value: 3, options: nOptions },
    { type: 'segmented', key: 'l', label: 'الرقم المداري l: الشكل', value: 2, options: lOptions('n') },
    { type: 'segmented', key: 'm', label: 'الرقم المغناطيسي m: الاتجاه', value: 0, options: mOptions('l') },
    { type: 'toggle', key: 'cplx', label: 'مدارات مركّبة (تدور فعلاً)', value: false },
    { type: 'group', label: 'التراكب الكمومي' },
    { type: 'toggle', key: 'sup', label: 'ركّب حالة ثانية فوقها', value: false },
    { type: 'segmented', key: 'n2', label: 'n للحالة الثانية', value: 2, options: nOptions, when: (v) => v.sup },
    { type: 'segmented', key: 'l2', label: 'l للحالة الثانية', value: 1, options: lOptions('n2'), when: (v) => v.sup },
    { type: 'segmented', key: 'm2', label: 'm للحالة الثانية', value: 0, options: mOptions('l2'), when: (v) => v.sup },
    { type: 'range', key: 'mix', label: 'نسبة المزج', min: 0, max: 1, step: 0.01, value: 0.5, format: (v) => `${Math.round((1 - v) * 100)}٪ و${Math.round(v * 100)}٪`, when: (v) => v.sup },
    { type: 'range', key: 'speed', label: 'سرعة الزمن', min: 0, max: 3, step: 0.01, value: 1, format: (v) => (v === 0 ? 'متوقف' : `×${v.toFixed(2)}`), when: (v) => v.sup },
    { type: 'group', label: 'العرض' },
    { type: 'segmented', key: 'mode', value: 0, options: [{ value: 0, label: 'سحابة احتمال' }, { value: 1, label: 'سطح' }] },
    { type: 'toggle', key: 'cut', label: 'اقطع نصفها لترى الداخل', value: false },
    { type: 'range', key: 'gain', label: 'السطوع', min: 0.2, max: 4, step: 0.01, value: 1.2, format: (v) => v.toFixed(2), when: (v) => v.mode === 0 },
    { type: 'range', key: 'iso', label: 'حدّ السطح', min: 0.01, max: 0.5, step: 0.005, value: 0.06, format: (v) => `${Math.round(v * 100)}٪ من الذروة`, when: (v) => v.mode === 1 },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي', value: true },
    { type: 'group', label: 'الجودة' },
    { type: 'segmented', key: 'quality', options: QUALITY_OPTIONS, value: 'auto' },
  ],
  onChange(key, v) {
    if (key === 'quality') { stage.setQuality(v); uniforms.uSteps.value = STEPS[v]; return; }
    if (['mix', 'speed', 'mode', 'cut', 'gain', 'iso', 'auto'].includes(key)) return;
    if (key === 'n' || key === 'l') clampState('n', 'l', 'm');
    if (key === 'n2' || key === 'l2') clampState('n2', 'l2', 'm2');
    updateStates();
  },
  info: `
    <h2>أين الإلكترون؟</h2>
    <p>الصورة المدرسية لإلكترون يدور حول النواة كالكوكب حول الشمس غير صحيحة. ميكانيكا الكم تقول إن الإلكترون لا مكان محدد له قبل أن تقيسه، وكل ما نعرفه «دالة موجية» تحدد احتمال وجوده في كل نقطة. هذه السحب هي تلك الاحتمالات، محسوبة من حل معادلة شرودنغر لذرة الهيدروجين، أبسط ذرة في الكون: بروتون واحد وإلكترون واحد.</p>
    <h3>الأرقام الثلاثة</h3>
    <ul>
      <li><strong>n</strong> يحدد الطاقة والحجم. كلما كبر ابتعد الإلكترون عن النواة.</li>
      <li><strong>l</strong> يحدد الشكل: s كرة، و p فصّان، و d أربعة فصوص أو حلقة، و f و g أشكال أعقد.</li>
      <li><strong>m</strong> يحدد اتجاه الشكل في الفضاء.</li>
    </ul>
    <p>هذه الأرقام ليست اختيارية؛ هي الحلول الوحيدة الممكنة للمعادلة. ولهذا الطاقة داخل الذرة «مكمّاة»: سلّم له درجات وليس منحدراً.</p>
    <h3>ماذا تعني الألوان؟</h3>
    <p>للموجة «طور» مثل موجة الماء: قمة وقاع. البرتقالي والأزرق طوران متعاكسان، وحيث يلتقيان تمر «عقدة»: سطح احتمال وجود الإلكترون عليه صفر تماماً. فعّل «اقطع نصفها» لترى العقد الكروية داخل المدارات ذات n الكبير.</p>
    <h3>كيف تُطلق الذرة الضوء؟</h3>
    <p>المدار الواحد ثابت لا يتغير مع الزمن. لكن إن كان الإلكترون في تراكب من حالتين، تبدأ سحابته تتأرجح ذهاباً وإياباً، وهذه الشحنة المتأرجحة تُطلق موجة كهرومغناطيسية، أي ضوءاً، بتردد يساوي فرق الطاقة بين الحالتين. اضغط «ذرة تُطلق ضوءاً» وشاهد السحابة تتأرجح. أما «الخط الأحمر Hα» فيعطي ضوءاً طوله ٦٥٦ نانومتراً، وهو اللون الأحمر الذي يصبغ سديم الجبار وكل سحب الهيدروجين في المجرة.</p>
    <p>التأرجح الحقيقي أسرع بكثير: نحو ألفي تريليون مرة في الثانية. هنا أبطأناه لتراه.</p>
    <h3>المدارات المركّبة</h3>
    <p>المدارات المرسومة عادةً في الكتب «حقيقية»، أي مزيج من حالتين تدوران في اتجاهين متعاكسين. فعّل «مدارات مركّبة» لترى الحالات التي تدور فعلاً: حلقات يلتف الطور حولها كقوس قزح، وكلما زاد m زاد عدد الالتفافات.</p>
  `,
});

const STEPS = { auto: 140, low: 90, medium: 130, high: 200 };

const stage = createStage({ bloom: { strength: 0.4, radius: 0.45, threshold: 0.85 }, exposure: 1.0, startScale: 0.75 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }

const uniforms = {
  ...cameraUniforms(),
  uPsi: { value: psiTex },
  uAmpA: { value: 1 },
  uAmpB: { value: 0 },
  uPhB: { value: 0 },
  uMode: { value: 0 },
  uGain: { value: 1.2 },
  uIso: { value: 0.06 },
  uCut: { value: 0 },
  uCutN: { value: new THREE.Vector3(0, 0, 1) },
  uSteps: { value: STEPS.auto },
  uFrame: { value: 0 },
};
const quad = shaderQuad(FRAG, uniforms);
stage.setScene(quad.scene, quad.camera);

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
camera.position.set(1.6, 1.3, 2.6);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 1.2;
controls.maxDistance = 8;
controls.autoRotateSpeed = 0.6;
stage.onResize((bw, bh, w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); });

function clampState(nk, lk, mk) {
  const v = ui.values;
  if (v[lk] >= v[nk]) ui.set(lk, v[nk] - 1, { silent: true });
  if (Math.abs(v[mk]) > v[lk]) ui.set(mk, Math.sign(v[mk]) * v[lk], { silent: true });
  ui.refresh();
}

function preset(a, b) {
  ui.set('n', a.n, { silent: true }); ui.set('l', a.l, { silent: true }); ui.set('m', a.m, { silent: true });
  ui.set('cplx', !!a.cplx, { silent: true });
  ui.set('sup', !!b, { silent: true });
  if (b) { ui.set('n2', b.n, { silent: true }); ui.set('l2', b.l, { silent: true }); ui.set('m2', b.m, { silent: true }); ui.set('mix', 0.5, { silent: true }); }
  ui.refresh();
  updateStates();
}

const state = { A: null, B: null };
function updateStates() {
  const v = ui.values;
  const A = { n: v.n, l: v.l, m: v.m, cplx: v.cplx };
  const B = v.sup ? { n: v.n2, l: v.l2, m: v.m2, cplx: v.cplx } : null;
  bake(A, B);
  state.A = A; state.B = B;

  const eA = -13.6057 / (A.n * A.n);
  ui.readout('name', ltr(B ? `${orbitalName(A.n, A.l, A.m, A.cplx)} + ${orbitalName(B.n, B.l, B.m, B.cplx)}` : orbitalName(A.n, A.l, A.m, A.cplx)));
  ui.readout('energy', B ? `${ltr(eA.toFixed(2) + ' eV')} و ${ltr((-13.6057 / (B.n * B.n)).toFixed(2) + ' eV')}` : ltr(`${eA.toFixed(3)} eV`));
  ui.readout('nodes', `${A.n - A.l - 1} كروية و${A.l} زاوية`);
  const lightEl = ui.readoutEl('light');
  lightEl.style.color = '';
  if (B && B.n !== A.n) {
    const lo = Math.min(A.n, B.n), hi = Math.max(A.n, B.n);
    const dE = 13.6057 * (1 / (lo * lo) - 1 / (hi * hi));
    const nm = 1239.84 / dE;
    const wl = ltr(`${Math.round(nm).toLocaleString('en')} nm`);
    if (Math.abs(A.l - B.l) !== 1) {
      ui.readout('light', `${wl}، لكنه انتقال «ممنوع» لأن l يجب أن يتغير بواحد`);
    } else {
      const region = nm < 380 ? 'فوق بنفسجي' : nm > 750 ? 'تحت أحمر' : 'ضوء مرئي';
      ui.readout('light', `${wl}، ${region}، ${SERIES[lo] || ''}`);
      lightEl.style.color = wavelengthColor(nm) || '';
    }
  } else {
    ui.readout('light', B ? 'لا شيء: الحالتان بنفس الطاقة' : 'لا شيء: المدار المنفرد ثابت');
  }
}
updateStates();

window.__exhibit = { camera, controls, uniforms, ui, preset, psiData };

let phase = 0, frame = 0, first = true;
const camDir = new THREE.Vector3();
stage.start((dt) => {
  const v = ui.values;
  controls.autoRotate = v.auto;
  controls.update();
  syncCamera(uniforms, camera);

  // Every mix oscillates at the same watchable rate; the true frequency is in the readout.
  if (state.B) {
    if (state.B.n !== state.A.n) phase += dt * v.speed * 2.2;
    uniforms.uAmpA.value = Math.sqrt(1 - v.mix);
    uniforms.uAmpB.value = Math.sqrt(v.mix);
  } else {
    uniforms.uAmpA.value = 1;
    uniforms.uAmpB.value = 0;
  }
  uniforms.uPhB.value = phase;
  uniforms.uMode.value = v.mode;
  uniforms.uGain.value = v.gain;
  uniforms.uIso.value = v.iso;
  uniforms.uCut.value = v.cut ? 1 : 0;
  camera.getWorldDirection(camDir);
  uniforms.uCutN.value.copy(camDir).negate();
  uniforms.uFrame.value = frame++ % 64;
  stage.render();
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
