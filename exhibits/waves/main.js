import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createShell, WEBGL_FAIL, el } from '../../assets/js/shell.js';
import { createStage } from '../../assets/js/stage.js';

// A binary black hole inspiral, slowed down and enlarged. The orbit shrinks with the
// leading-order chirp law ω ∝ (1 − t/τ)^(−3/8); the wave the binary emits at each
// moment is stored in a history texture, and every point of the sheet reads it back
// at its retarded time t − r/c, which draws the two-armed spiral of outgoing waves.
const N = 2048, HDT = 1 / 60;       // history: 2048 samples, 1/60 s apart (34 s of signal)
const C = 6.5;                       // wave speed in scene units per second
const A0 = 8;                        // starting separation
const W0 = Math.PI / 2;              // starting orbital angular frequency (period 4 s)
const TAU = 22;                      // time to coalescence at normal speed
const DET = new THREE.Vector3(46, 0, 0); // the detector ring

const ui = createShell({
  title: 'موجات الجاذبية',
  scale: 'مقياس <bdi class="num">10<sup>5</sup></bdi> متر',
  hint: 'شغّل الصوت من لوحة التحكم لتسمع الإشارة وهي تتسارع حتى الاندماج',
  readouts: [
    { key: 'phase', label: 'المرحلة' },
    { key: 'freq', label: 'تردد الموجة لو كانت بالحجم الحقيقي' },
    { key: 'sep', label: 'المسافة بين الثقبين' },
  ],
  controls: [
    { type: 'group', label: 'الثقبان' },
    { type: 'range', key: 'm1', label: 'كتلة الأول', min: 5, max: 80, step: 1, value: 36, format: (v) => `${v} كتلة شمسية` },
    { type: 'range', key: 'm2', label: 'كتلة الثاني', min: 5, max: 80, step: 1, value: 29, format: (v) => `${v} كتلة شمسية` },
    { type: 'buttons', items: [{ label: 'أعد الاندماج من البداية', primary: true, action: () => restart() }] },
    { type: 'group', label: 'الصوت' },
    { type: 'toggle', key: 'sound', label: 'اسمع الإشارة', value: false },
    { type: 'note', html: 'الإشارة الحقيقية تقع في مدى السمع البشري تقريباً: من ٣٥ إلى ٢٥٠ هرتز. هنا رفعناها قليلاً لتسمعها سماعات الجوال والكمبيوتر.' },
    { type: 'group', label: 'العرض' },
    { type: 'range', key: 'speed', label: 'سرعة الزمن', min: 0.1, max: 2, step: 0.05, value: 1, format: (v) => `×${v.toFixed(2)}` },
    { type: 'toggle', key: 'slowmo', label: 'إبطاء تلقائي لحظة الاندماج', value: true },
    { type: 'range', key: 'amp', label: 'تضخيم الموجات', min: 0.2, max: 3, step: 0.05, value: 1, format: (v) => `×${v.toFixed(2)}` },
    { type: 'toggle', key: 'ring', label: 'حلقة الكاشف', value: true },
    { type: 'toggle', key: 'plot', label: 'رسم الإشارة', value: true },
  ],
  onChange(key, v) {
    if (key === 'm1' || key === 'm2') restart();
    if (key === 'sound') setSound(v);
    if (key === 'plot') plot.hidden = !v;
  },
  info: `
    <h2>الزمكان يرتجف</h2>
    <p>تنبأ أينشتاين عام ١٩١٦ بأن الأجسام الثقيلة حين تتسارع تُحدث تموجات في نسيج الزمان والمكان نفسه، تنتشر بسرعة الضوء. لكنه ظن أنها أضعف من أن تُرصد أبداً.</p>
    <p>في ١٤ سبتمبر ٢٠١٥ التقط مرصد LIGO في أمريكا أول موجة منها: ثقبان أسودان كتلتاهما ٣٦ و٢٩ ضعف الشمس اندمجا قبل مليار وثلاثمئة مليون سنة. حين وصلت الموجة إلى الأرض مدّت أذرع المرصد التي طولها أربعة كيلومترات وقلّصتها بمقدار جزء من ألف من قطر البروتون. هذه هي القيم الافتراضية هنا، وقد نال مكتشفوها جائزة نوبل في الفيزياء عام ٢٠١٧.</p>
    <h3>لماذا تتسارع؟</h3>
    <p>الموجات تحمل طاقة بعيداً عن الثقبين، فيقتربان من بعضهما، فيدوران أسرع، فيطلقان موجات أقوى، فيقتربان أكثر. تسمع هذا في الصوت: نغمة ترتفع وتعلو بسرعة ثم تنقطع فجأة، ويسميها العلماء «الزقزقة». في أجزاء من الثانية الأخيرة تحوّلت ثلاث كتل شمسية إلى طاقة خالصة، وكانت قدرة الانفجار أكبر من قدرة كل نجوم الكون المرئي مجتمعة.</p>
    <h3>ماذا ترى؟</h3>
    <ul>
      <li><strong>الشبكة:</strong> كل نقطة فيها تتحرك حسب الموجة التي وصلتها، والموجة التي تصل إلى نقطة بعيدة خرجت من الثقبين قبل وقت أطول. لهذا يظهر الذراعان الحلزونيان.</li>
      <li><strong>الحلقة البعيدة:</strong> جسيمات حرة تمر بها الموجة فتتمدد الحلقة في اتجاه وتنضغط في الاتجاه العمودي، وهذا بالضبط ما يقيسه LIGO بأشعة الليزر.</li>
      <li><strong>الرسم في الأسفل:</strong> الإشارة كما تصل إلى الكاشف، تشبه الرسم الشهير الذي نُشر عام ٢٠١٦.</li>
    </ul>
    <p>التمثيل هنا مبطّأ ومكبّر ملايين المرات، والشبكة تعرض الموجة في مستوى المدار للتبسيط.</p>
  `,
});

const stage = createStage({ bloom: { strength: 0.8, radius: 0.55, threshold: 0.55 }, exposure: 1.0, startScale: 0.85 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const scene = new THREE.Scene();
scene.background = new THREE.Color('#02040c');
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(-6, 34, 58);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 10;
controls.maxDistance = 200;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(6, 0, 0);
stage.setScene(scene, camera);

{
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * r * 900, u * 900, Math.sin(a) * r * 900], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#aab4e8', size: 1.3, sizeAttenuation: false })));
}

// ---------------------------------------------------------------- history texture of the emitted wave
const hist = new Float32Array(N * 4);
const histTex = new THREE.DataTexture(hist, N, 1, THREE.RGBAFormat, THREE.FloatType);
histTex.wrapS = THREE.RepeatWrapping;
histTex.minFilter = histTex.magFilter = THREE.NearestFilter;
histTex.needsUpdate = true;

const sheetUniforms = {
  uHist: { value: histTex }, uHead: { value: 0 }, uValid: { value: 0 }, uAmp: { value: 1 },
  uB1: { value: new THREE.Vector4() }, uB2: { value: new THREE.Vector4() }, uSep: { value: A0 },
};
const WAVE_GLSL = /* glsl */`
uniform sampler2D uHist;
uniform float uHead;
uniform float uValid;
uniform float uAmp;
uniform float uSep;
// strain at a point of the plane, read at the retarded time
float strain(vec2 xz) {
  float r = length(xz);
  float back = r / ${C.toFixed(3)} / ${HDT.toFixed(6)};
  if (back > uValid) return 0.0;
  float idx = uHead - back;
  vec4 s = texture2D(uHist, vec2((mod(idx, ${N}.0) + 0.5) / ${N}.0, 0.5));
  float phi = atan(xz.y, xz.x);
  float near = smoothstep(uSep * 0.6, uSep * 1.6 + 2.0, r);
  return s.x * cos(2.0 * (s.y - phi)) * near / (1.0 + r * 0.045);
}
`;
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(180, 180, 420, 420), new THREE.ShaderMaterial({
  uniforms: sheetUniforms,
  vertexShader: /* glsl */`
    uniform vec4 uB1;
    uniform vec4 uB2;
    varying vec2 vXZ;
    varying float vH;
    varying float vWell;
    ${WAVE_GLSL}
    void main() {
      vec2 xz = vec2(position.x, -position.y);
      float h = strain(xz) * uAmp;
      float well = -(uB1.w / sqrt(dot(xz - uB1.xz, xz - uB1.xz) + 3.0) + uB2.w / sqrt(dot(xz - uB2.xz, xz - uB2.xz) + 3.0));
      vH = h; vWell = well; vXZ = xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(xz.x, h * 3.2 + well * 2.2 - 0.5, xz.y, 1.0);
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vXZ;
    varying float vH;
    varying float vWell;
    void main() {
      vec2 q = vXZ / 2.5;
      vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float fade = 1.0 - smoothstep(55.0, 88.0, length(vXZ));
      vec3 base = vec3(0.16, 0.24, 0.55);
      vec3 col = base + vec3(1.0, 0.55, 0.2) * max(vH, 0.0) * 2.2 + vec3(0.3, 0.55, 1.0) * max(-vH, 0.0) * 2.2;
      col += vec3(0.9, 0.7, 0.4) * smoothstep(0.5, 4.0, -vWell) * 0.5;
      gl_FragColor = vec4(col * line * fade * 0.85, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
sheet.frustumCulled = false;
scene.add(sheet);

// ---------------------------------------------------------------- black holes: black spheres with a glowing photon ring
const BH_VS = `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BH_FS = `varying vec3 vN; varying vec3 vW; void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))); vec3 c = vec3(1.0, 0.75, 0.45) * pow(f, 6.0) * 3.0; gl_FragColor = vec4(c, 1.0); }`;
const bhMat = new THREE.ShaderMaterial({ vertexShader: BH_VS, fragmentShader: BH_FS });
const bhGeo = new THREE.SphereGeometry(1, 48, 32);
const bh1 = new THREE.Mesh(bhGeo, bhMat), bh2 = new THREE.Mesh(bhGeo, bhMat), remnant = new THREE.Mesh(bhGeo, bhMat);
scene.add(bh1, bh2, remnant);

// a faint trail of each hole's recent path
const TR = 240;
function makeTrail(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR * 3), 3));
  const col = new Float32Array(TR * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < TR; i++) { const f = (1 - i / TR) ** 2; col.set([c.r * f, c.g * f, c.b * f], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  l.frustumCulled = false;
  scene.add(l);
  return l;
}
const trail1 = makeTrail('#ffb070'), trail2 = makeTrail('#8fb0ff');
function pushTrail(l, x, z) {
  const a = l.geometry.attributes.position.array;
  a.copyWithin(3, 0, (TR - 1) * 3);
  a[0] = x; a[1] = 0.3; a[2] = z;
  l.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- detector ring of free particles
const RING_N = 36, RING_R = 4;
const ringPos = new Float32Array(RING_N * 3);
const ringGeo = new THREE.BufferGeometry();
ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
const ringPts = new THREE.Points(ringGeo, new THREE.PointsMaterial({ color: '#f3d48b', size: 5, sizeAttenuation: false }));
scene.add(ringPts);
const ringRefGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => new THREE.Vector3(DET.x, 3 + Math.sin(i / 96 * Math.PI * 2) * RING_R, Math.cos(i / 96 * Math.PI * 2) * RING_R)));
const ringRef = new THREE.Line(ringRefGeo, new THREE.LineDashedMaterial({ color: '#6c78a8', dashSize: 0.4, gapSize: 0.3 }));
ringRef.computeLineDistances();
scene.add(ringRef);

// ---------------------------------------------------------------- waveform plot
const plot = el('canvas', { class: 'gw-plot', 'aria-label': 'رسم الإشارة عند الكاشف' });
document.body.append(plot);
const style = document.createElement('style');
style.textContent = `.gw-plot{position:fixed;left:16px;bottom:20px;width:min(620px,calc(100vw - 330px));height:96px;z-index:4;border-radius:12px;background:rgba(8,13,34,.72);border:1px solid var(--brass-faint);pointer-events:none;transition:opacity .5s}
body.ui-hidden .gw-plot{opacity:0} @media (max-width:760px){.gw-plot{left:12px;right:12px;width:auto;top:150px;bottom:auto;height:64px}}`;
document.head.append(style);
const PLOT_N = 900;
const plotData = new Float32Array(PLOT_N);
function drawPlot() {
  if (plot.hidden) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = plot.clientWidth * dpr, h = plot.clientHeight * dpr;
  if (plot.width !== w || plot.height !== h) { plot.width = w; plot.height = h; }
  const g = plot.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(151,163,202,0.25)';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.strokeStyle = '#f0b25f';
  g.lineWidth = 2 * dpr;
  g.beginPath();
  for (let i = 0; i < PLOT_N; i++) {
    const x = (i / (PLOT_N - 1)) * w, y = h / 2 - plotData[i] * h * 0.42;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  g.fillStyle = 'rgba(151,163,202,0.8)';
  g.font = `${12 * dpr}px "IBM Plex Sans Arabic", sans-serif`;
  g.textAlign = 'right';
  g.fillText('الإشارة عند الكاشف', w - 10 * dpr, 18 * dpr);
}

// ---------------------------------------------------------------- sound
let audio = null;
function setSound(on) {
  if (on && !audio) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), osc2 = ctx.createOscillator(), gain = ctx.createGain(), g2 = ctx.createGain();
    osc.type = 'sine'; osc2.type = 'sine';
    g2.gain.value = 0.35;
    gain.gain.value = 0;
    osc.connect(gain); osc2.connect(g2); g2.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc2.start();
    audio = { ctx, osc, osc2, gain };
  }
  if (audio) {
    if (on) audio.ctx.resume(); else audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05);
  }
}

// ---------------------------------------------------------------- simulation state
const sim = { t: 0, head: 0, valid: 0, acc: 0, merged: false, tm: 0, phiM: 0, wM: 0, aM: 0 };
let m1 = 36, m2 = 29;
const radius = (m) => 0.7 + m / 45;
function restart() {
  m1 = ui.values.m1; m2 = ui.values.m2;
  Object.assign(sim, { t: 0, head: 0, valid: 0, acc: 0, merged: false });
  hist.fill(0);
  histTex.needsUpdate = true;
  plotData.fill(0);
  for (const l of [trail1, trail2]) { l.geometry.attributes.position.array.fill(0); l.geometry.attributes.position.needsUpdate = true; }
}

function state(t) {
  const M = m1 + m2, eta = (m1 * m2) / (M * M);
  const aMin = (radius(m1) + radius(m2)) * 0.95;
  const tMerge = TAU * (1 - Math.pow(aMin / A0, 4));
  if (t < tMerge) {
    const u = 1 - t / TAU;
    const w = W0 * Math.pow(u, -3 / 8);
    const a = A0 * Math.pow(u, 1 / 4);
    const phi = W0 * TAU * 1.6 * (1 - Math.pow(u, 5 / 8));
    return { w, a, phi, amp: 4 * eta * 0.3 * Math.pow(w / W0, 2 / 3), merged: false, tMerge };
  }
  const um = 1 - tMerge / TAU;
  const wM = W0 * Math.pow(um, -3 / 8), phiM = W0 * TAU * 1.6 * (1 - Math.pow(um, 5 / 8));
  const ampM = 4 * eta * 0.3 * Math.pow(wM / W0, 2 / 3);
  const dt = t - tMerge;
  return { w: wM * 1.5, a: 0, phi: phiM + wM * 1.5 * dt, amp: ampM * Math.exp(-dt / 0.55) * (1 + 0.6 * Math.exp(-dt / 0.15)), merged: true, tMerge };
}

function sample(idx) {
  const i = ((Math.floor(idx) % N) + N) % N;
  return [hist[i * 4], hist[i * 4 + 1], hist[i * 4 + 2]];
}

stage.onResize((bw, bh, w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); });
restart();
window.__exhibit = { sim, restart, ui };

let roT = 0, first = true;
stage.start((dt) => {
  const v = ui.values;
  const s0 = state(sim.t);
  let speed = v.speed;
  if (v.slowmo && Math.abs(sim.t - s0.tMerge) < 1.4) speed *= 0.3;
  sim.acc += Math.min(dt, 0.05) * speed;
  while (sim.acc >= HDT) {
    sim.acc -= HDT;
    sim.t += HDT;
    const s = state(sim.t);
    sim.head++;
    const i = sim.head % N;
    hist[i * 4] = s.amp; hist[i * 4 + 1] = s.phi; hist[i * 4 + 2] = s.w;
    sim.valid = Math.min(sim.valid + 1, N - 2);
    // what the detector receives now left the binary DET.x / C seconds ago
    const [A, P] = sample(sim.head - DET.x / C / HDT);
    plotData.copyWithin(0, 1);
    plotData[PLOT_N - 1] = sim.head - DET.x / C / HDT > sim.head - sim.valid ? A * Math.cos(2 * P) * 2.2 : 0;
  }
  histTex.needsUpdate = true;
  const s = state(sim.t);
  const M = m1 + m2;
  sheetUniforms.uHead.value = sim.head;
  sheetUniforms.uValid.value = sim.valid;
  sheetUniforms.uAmp.value = v.amp;
  sheetUniforms.uSep.value = s.merged ? 2 : s.a;

  if (!s.merged) {
    const x1 = s.a * (m2 / M), x2 = -s.a * (m1 / M);
    const c = Math.cos(s.phi), sn = Math.sin(s.phi);
    bh1.position.set(x1 * c, 0.3, x1 * sn);
    bh2.position.set(x2 * c, 0.3, x2 * sn);
    bh1.scale.setScalar(radius(m1)); bh2.scale.setScalar(radius(m2));
    bh1.visible = bh2.visible = true; remnant.visible = false;
    pushTrail(trail1, bh1.position.x, bh1.position.z);
    pushTrail(trail2, bh2.position.x, bh2.position.z);
    sheetUniforms.uB1.value.set(bh1.position.x, 0, bh1.position.z, m1 / 12);
    sheetUniforms.uB2.value.set(bh2.position.x, 0, bh2.position.z, m2 / 12);
  } else {
    bh1.visible = bh2.visible = false;
    remnant.visible = true;
    const grow = Math.min(1, (sim.t - s.tMerge) / 0.25);
    remnant.scale.setScalar(radius(M * 0.95) * (0.7 + 0.3 * grow) * (1 + 0.06 * Math.sin((sim.t - s.tMerge) * 30) * Math.exp(-(sim.t - s.tMerge) / 0.4)));
    remnant.position.set(0, 0.3, 0);
    sheetUniforms.uB1.value.set(0, 0, 0, (M * 0.95) / 12);
    sheetUniforms.uB2.value.set(0, 0, 0, 0);
  }

  // detector ring: + polarisation stretches one axis and squeezes the other
  const back = sim.head - DET.x / C / HDT;
  const [A, P, Wd] = back > sim.head - sim.valid ? sample(back) : [0, 0, W0];
  const hDet = A * Math.cos(2 * P) * v.amp * 0.45;
  for (let i = 0; i < RING_N; i++) {
    const a = (i / RING_N) * Math.PI * 2;
    ringPos.set([DET.x, 3 + Math.sin(a) * RING_R * (1 + hDet), Math.cos(a) * RING_R * (1 - hDet)], i * 3);
  }
  ringGeo.attributes.position.needsUpdate = true;
  ringPts.visible = ringRef.visible = v.ring;

  if (audio && v.sound) {
    const f = (Wd / Math.PI) * 140;
    const t = audio.ctx.currentTime;
    audio.osc.frequency.setTargetAtTime(Math.min(f, 1800), t, 0.02);
    audio.osc2.frequency.setTargetAtTime(Math.min(f * 2, 3600), t, 0.02);
    audio.gain.gain.setTargetAtTime(Math.min(A * 0.9, 0.35), t, 0.03);
  }

  controls.update();
  stage.render();
  drawPlot();

  roT -= dt;
  if (roT <= 0) {
    roT = 0.15;
    const left = s.tMerge - sim.t;
    ui.readout('phase', s.merged ? (sim.t - s.tMerge < 1.5 ? 'الاندماج والارتجاج الأخير' : `اندمجا في ثقب واحد كتلته ${Math.round(M * 0.95)} كتلة شمسية`) : left < 1.5 ? 'الانغماس: اللحظات الأخيرة' : 'الدوران الحلزوني');
    ui.readout('freq', s.merged ? '–' : `${Math.round(35 * (s.w / W0))} هرتز`);
    ui.readout('sep', s.merged ? 'صفر' : `${Math.round(350 * s.a / A0).toLocaleString('en')} كم`);
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
