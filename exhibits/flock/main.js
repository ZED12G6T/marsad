import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createShell, WEBGL_FAIL } from '../../assets/js/shell.js';
import { createStage } from '../../assets/js/stage.js';

// Boids (Reynolds, 1986) with a cap on how many neighbours each bird attends to:
// real starlings track about seven of their nearest neighbours (Ballerini et al., 2008).
const MAXN = 12000;
const R = 5.5;                // perception radius
const BOX = 90;               // spatial hash covers [-BOX, BOX]³ around the flock centre
const CELL = R, G = Math.ceil((2 * BOX) / CELL);
const HOME = new THREE.Vector3(0, 60, 0);

const ui = createShell({
  title: 'سرب الطيور',
  scale: 'مقياس <bdi class="num">10<sup>2</sup></bdi> متر',
  hint: 'اسحب لتدور حول السرب، وشغّل الصقر لترى السرب يتموّج هرباً منه',
  readouts: [
    { key: 'count', label: 'الطيور' },
    { key: 'rule', label: 'كل طائر يراقب' },
  ],
  controls: [
    { type: 'group', label: 'السرب' },
    { type: 'segmented', key: 'n', label: 'عدد الطيور', value: 5000, options: [
      { value: 2500, label: '2,500' }, { value: 5000, label: '5,000' }, { value: 10000, label: '10,000' },
    ] },
    { type: 'range', key: 'k', label: 'عدد الجيران الذين يراقبهم كل طائر', min: 1, max: 12, step: 1, value: 7, format: (v) => String(v) },
    { type: 'range', key: 'sep', label: 'الابتعاد عن الأقرب', min: 0, max: 3, step: 0.01, value: 1.4, format: (v) => v.toFixed(2) },
    { type: 'range', key: 'ali', label: 'مجاراة اتجاه الجيران', min: 0, max: 3, step: 0.01, value: 1.1, format: (v) => v.toFixed(2) },
    { type: 'range', key: 'coh', label: 'الاقتراب من الجماعة', min: 0, max: 3, step: 0.01, value: 0.8, format: (v) => v.toFixed(2) },
    { type: 'range', key: 'speed', label: 'السرعة', min: 0.3, max: 2, step: 0.01, value: 1, format: (v) => `×${v.toFixed(2)}` },
    { type: 'group', label: 'الصقر' },
    { type: 'toggle', key: 'falcon', label: 'أطلق الصقر', value: false },
    { type: 'group', label: 'المشهد' },
    { type: 'toggle', key: 'follow', label: 'الكاميرا تتبع السرب', value: true },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي', value: true },
  ],
  onChange(key, v) { if (key === 'n') spawn(v); },
  info: `
    <h2>ثلاث قواعد، ولا قائد</h2>
    <p>لا يوجد في السرب طائر يقود أو يعرف الشكل الكلي. كل طائر يطبّق ثلاث قواعد بسيطة على جيرانه القريبين فقط: <strong>لا تقترب أكثر من اللازم</strong>، و<strong>طِر في الاتجاه نفسه الذي يطيرون فيه</strong>، و<strong>لا تبتعد عن الجماعة</strong>. من هذه القواعد وحدها تخرج هذه الأشكال المتموجة التي تبدو كأنها كائن واحد. هذا ما يسمى «السلوك الناشئ».</p>
    <p>كتب هذه القواعد في برنامج حاسوبي كريغ رينولدز عام ١٩٨٦، وسمّى طيوره الافتراضية «بويدز». واستُخدمت بعده في أفلام كثيرة لتحريك الأسراب والحشود.</p>
    <h3>سبعة جيران</h3>
    <p>عام ٢٠٠٨ صوّر علماء إيطاليون أسراب الزرازير فوق روما بكاميرات متعددة، وأعادوا بناء موقع كل طائر في الأبعاد الثلاثة. اكتشفوا أن الطائر لا يراقب كل من حوله ضمن مسافة معينة، بل يراقب نحو سبعة من أقرب جيرانه أياً كانت مسافتهم. لهذا يبقى السرب متماسكاً حين يتمدد أو ينضغط. غيّر هذا الرقم في لوحة التحكم وراقب ما يحدث.</p>
    <h3>الصقر</h3>
    <p>حين يهجم صقر، يبتعد عنه أقرب الطيور، فيدفع جيرانه، فيدفعون جيرانهم، وتنتقل موجة الهروب عبر السرب أسرع من طيران الصقر نفسه. هذه الموجات الداكنة التي تراها هي سرّ نجاة الزرازير، وهي أجمل ما في عروضها عند الغروب.</p>
  `,
});

const stage = createStage({ bloom: { strength: 0.35, radius: 0.6, threshold: 0.85 }, exposure: 1.0, startScale: 0.9 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#b9806a', 120, 420);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
camera.position.set(-70, 22, 110);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 20;
controls.maxDistance = 400;
controls.maxPolarAngle = Math.PI * 0.53;
controls.autoRotateSpeed = 0.25;
controls.target.copy(HOME);
stage.setScene(scene, camera);

// ---------------------------------------------------------------- dusk sky and a dark horizon
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying vec3 vD;
    void main() {
      float h = vD.y;
      vec3 sunDir = normalize(vec3(-0.6, 0.06, -0.8));
      vec3 top = vec3(0.09, 0.12, 0.3), mid = vec3(0.55, 0.36, 0.5), low = vec3(1.0, 0.56, 0.32);
      vec3 col = h > 0.0 ? mix(mid, top, pow(clamp(h * 2.2, 0.0, 1.0), 0.7)) : low * 0.5;
      col = mix(col, low, exp(-max(h, 0.0) * 9.0) * 0.85);
      float s = max(dot(vD, sunDir), 0.0);
      col += vec3(1.0, 0.7, 0.4) * (pow(s, 12.0) * 0.5 + pow(s, 600.0) * 3.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
scene.add(sky);
{
  // rolling ground and a ring of tree silhouettes for scale
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), new THREE.MeshBasicMaterial({ color: '#120b10' }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3, 6), new THREE.MeshBasicMaterial({ color: '#0d080c' }), 700);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI * 2, r = 160 + Math.random() * 500;
    const h = 6 + Math.random() * 14;
    p.set(Math.cos(a) * r, h * 1.5 * 0.5, Math.sin(a) * r);
    s.set(h * 0.35, h * 0.5, h * 0.35);
    trees.setMatrixAt(i, m.compose(p, q, s));
  }
  scene.add(trees);
}

// ---------------------------------------------------------------- birds: instanced, wings flap in the vertex shader
function birdGeometry(scale = 1) {
  // body plus two wings; aWing marks how far a vertex is out along a wing (signed)
  const v = [
    0, 0, 0.9, 0, 0.05, -0.6, 0, -0.08, -0.6,     // body sliver
    0, 0, 0.35, 0, 0, -0.25, -1.1, 0, -0.05,       // left wing
    0, 0, 0.35, 1.1, 0, -0.05, 0, 0, -0.25,        // right wing
  ].map((x) => x * scale);
  const wing = [0, 0, 0, 0, 0, -1, 0, 1, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return g;
}
const BIRD_VS = /* glsl */`
attribute float aWing;
attribute float aPhase;
uniform float uTime;
uniform float uFlap;
varying float vFog;
void main() {
  vec3 p = position;
  float flap = sin(uTime * uFlap + aPhase * 6.2831);
  p.y += abs(aWing) * flap * 0.55;
  p.x *= 1.0 - abs(aWing) * (0.25 + 0.25 * flap);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vFog = smoothstep(120.0, 420.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const BIRD_FS = /* glsl */`
uniform vec3 uColor;
varying float vFog;
void main() { gl_FragColor = vec4(mix(uColor, vec3(0.72, 0.5, 0.42), vFog), 1.0); }
`;
const birdUniforms = { uTime: { value: 0 }, uFlap: { value: 15 }, uColor: { value: new THREE.Color('#0b0709') } };
const birds = new THREE.InstancedMesh(birdGeometry(0.7), new THREE.ShaderMaterial({ vertexShader: BIRD_VS, fragmentShader: BIRD_FS, uniforms: birdUniforms, side: THREE.DoubleSide }), MAXN);
const phase = new Float32Array(MAXN);
for (let i = 0; i < MAXN; i++) phase[i] = Math.random();
birds.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
birds.frustumCulled = false;
scene.add(birds);

const falconUniforms = { uTime: birdUniforms.uTime, uFlap: { value: 7 }, uColor: { value: new THREE.Color('#1a0f08') } };
const falconMesh = new THREE.InstancedMesh(birdGeometry(2.6), new THREE.ShaderMaterial({ vertexShader: BIRD_VS, fragmentShader: BIRD_FS, uniforms: falconUniforms, side: THREE.DoubleSide }), 1);
falconMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
falconMesh.frustumCulled = false;
scene.add(falconMesh);

// ---------------------------------------------------------------- simulation state
let N = 0;
const px = new Float32Array(MAXN), py = new Float32Array(MAXN), pz = new Float32Array(MAXN);
const vx = new Float32Array(MAXN), vy = new Float32Array(MAXN), vz = new Float32Array(MAXN);
const cellOf = new Int32Array(MAXN), order = new Int32Array(MAXN);
const cellStart = new Int32Array(G * G * G + 1), cellCount = new Int32Array(G * G * G);
const falcon = { p: new THREE.Vector3(200, 90, 0), v: new THREE.Vector3(-1, 0, 0), state: 'circle', t: 0 };
const centre = new THREE.Vector3().copy(HOME);

function spawn(n) {
  N = n;
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.cbrt(Math.random()) * 30;
    px[i] = HOME.x + Math.cos(a) * r; py[i] = HOME.y + (Math.random() - 0.5) * 16; pz[i] = HOME.z + Math.sin(a) * r;
    vx[i] = Math.cos(a + 1.6) * 10; vy[i] = 0; vz[i] = Math.sin(a + 1.6) * 10;
  }
  birds.count = N;
  ui.readout('count', N.toLocaleString('en'));
}

function step(dt) {
  const v = ui.values;
  const ox = centre.x - BOX, oy = centre.y - BOX, oz = centre.z - BOX;
  cellCount.fill(0);
  for (let i = 0; i < N; i++) {
    const cx = Math.min(G - 1, Math.max(0, ((px[i] - ox) / CELL) | 0));
    const cy = Math.min(G - 1, Math.max(0, ((py[i] - oy) / CELL) | 0));
    const cz = Math.min(G - 1, Math.max(0, ((pz[i] - oz) / CELL) | 0));
    const c = cx + G * (cy + G * cz);
    cellOf[i] = c;
    cellCount[c]++;
  }
  let acc = 0;
  for (let c = 0; c < cellCount.length; c++) { cellStart[c] = acc; acc += cellCount[c]; }
  cellStart[cellCount.length] = acc;
  cellCount.fill(0);
  for (let i = 0; i < N; i++) { const c = cellOf[i]; order[cellStart[c] + cellCount[c]++] = i; }

  const K = v.k, R2 = R * R, sepR2 = 2.2 * 2.2;
  const vmax = 17 * v.speed, vmin = 9 * v.speed;
  const fpx = falcon.p.x, fpy = falcon.p.y, fpz = falcon.p.z;
  const falconOn = v.falcon;
  for (let i = 0; i < N; i++) {
    const x = px[i], y = py[i], z = pz[i];
    const c = cellOf[i];
    const cx = c % G, cy = ((c / G) | 0) % G, cz = (c / (G * G)) | 0;
    let n = 0, ax = 0, ay = 0, az = 0, sx = 0, sy = 0, sz = 0, mx = 0, my = 0, mz = 0;
    outer: for (let dz = -1; dz <= 1; dz++) {
      const zz = cz + dz; if (zz < 0 || zz >= G) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = cy + dy; if (yy < 0 || yy >= G) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx; if (xx < 0 || xx >= G) continue;
          const cc = xx + G * (yy + G * zz);
          for (let k = cellStart[cc], e = cellStart[cc + 1]; k < e; k++) {
            const j = order[k];
            if (j === i) continue;
            const ddx = px[j] - x, ddy = py[j] - y, ddz = pz[j] - z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > R2) continue;
            if (d2 < sepR2) { const f = 1 / (d2 + 0.05); sx -= ddx * f; sy -= ddy * f; sz -= ddz * f; }
            ax += vx[j]; ay += vy[j]; az += vz[j];
            mx += ddx; my += ddy; mz += ddz;
            if (++n >= K) break outer;
          }
        }
      }
    }
    let fx = 0, fy = 0, fz = 0;
    if (n) {
      fx += (ax / n - vx[i]) * 0.9 * v.ali + (mx / n) * 0.35 * v.coh + sx * 2.2 * v.sep;
      fy += (ay / n - vy[i]) * 0.9 * v.ali + (my / n) * 0.35 * v.coh + sy * 2.2 * v.sep;
      fz += (az / n - vz[i]) * 0.9 * v.ali + (mz / n) * 0.35 * v.coh + sz * 2.2 * v.sep;
    }
    // stay near home: a soft ellipsoidal leash, and keep off the ground
    const hx = (x - HOME.x) / 80, hy = (y - HOME.y) / 44, hz = (z - HOME.z) / 80;
    const out = Math.sqrt(hx * hx + hy * hy + hz * hz) - 1;
    if (out > 0) { fx -= hx * out * 14; fy -= hy * out * 14; fz -= hz * out * 14; }
    if (y < 18) fy += (18 - y) * 2;
    // flee the falcon
    if (falconOn) {
      const ex = x - fpx, ey = y - fpy, ez = z - fpz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < 22 * 22) { const f = 900 / (d2 + 4); fx += ex * f / Math.sqrt(d2 + 1); fy += ey * f / Math.sqrt(d2 + 1); fz += ez * f / Math.sqrt(d2 + 1); }
    }
    let nvx = vx[i] + fx * dt, nvy = (vy[i] + fy * dt) * 0.985, nvz = vz[i] + fz * dt;
    let sp = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz) || 1;
    const cl = Math.min(vmax, Math.max(vmin, sp)) / sp;
    vx[i] = nvx * cl; vy[i] = nvy * cl; vz[i] = nvz * cl;
  }
  for (let i = 0; i < N; i++) { px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt; }

  // the falcon circles above, then stoops through the middle of the flock
  falcon.t += dt;
  const target = new THREE.Vector3();
  let fs = 22;
  if (!falconOn) { falcon.state = 'circle'; }
  if (falcon.state === 'circle') {
    const a = falcon.t * 0.35;
    target.set(centre.x + Math.cos(a) * 110, centre.y + 45, centre.z + Math.sin(a) * 110);
    if (falconOn && falcon.t > 4) { falcon.state = 'dive'; falcon.t = 0; }
  } else {
    target.copy(centre);
    fs = 38;
    if (falcon.p.distanceTo(centre) < 6 || falcon.t > 6) { falcon.state = 'circle'; falcon.t = 0; }
  }
  const desired = target.sub(falcon.p).normalize().multiplyScalar(fs);
  falcon.v.lerp(desired, Math.min(1, dt * (falcon.state === 'dive' ? 2.5 : 1.2)));
  falcon.p.addScaledVector(falcon.v, dt);
}

// orientation from velocity, written straight into the instance matrices
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function writeMatrix(arr, o, x, y, z, dx, dy, dz) {
  fwd.set(dx, dy, dz).normalize();
  right.crossVectors(UP, fwd);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  upv.crossVectors(fwd, right);
  arr[o] = right.x; arr[o + 1] = right.y; arr[o + 2] = right.z; arr[o + 3] = 0;
  arr[o + 4] = upv.x; arr[o + 5] = upv.y; arr[o + 6] = upv.z; arr[o + 7] = 0;
  arr[o + 8] = fwd.x; arr[o + 9] = fwd.y; arr[o + 10] = fwd.z; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
}

stage.onResize((bw, bh, w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); });
spawn(ui.values.n);
window.__exhibit = { ui, step };

let t = 0, roT = 0, first = true;
stage.start((dt) => {
  const v = ui.values;
  const h = Math.min(dt, 1 / 30);
  t += h;
  step(h);

  centre.set(0, 0, 0);
  for (let i = 0; i < N; i++) { centre.x += px[i]; centre.y += py[i]; centre.z += pz[i]; }
  centre.multiplyScalar(1 / N);

  const m = birds.instanceMatrix.array;
  for (let i = 0; i < N; i++) writeMatrix(m, i * 16, px[i], py[i], pz[i], vx[i], vy[i], vz[i]);
  birds.instanceMatrix.needsUpdate = true;
  writeMatrix(falconMesh.instanceMatrix.array, 0, falcon.p.x, falcon.p.y, falcon.p.z, falcon.v.x, falcon.v.y, falcon.v.z);
  falconMesh.instanceMatrix.needsUpdate = true;
  falconMesh.visible = v.falcon;
  birdUniforms.uTime.value = t;

  if (v.follow) controls.target.lerp(centre, Math.min(1, h * 1.5));
  controls.autoRotate = v.auto;
  controls.update();
  stage.render();

  roT -= dt;
  if (roT <= 0) {
    roT = 0.3;
    ui.readout('rule', `أقرب ${v.k} ${v.k > 2 && v.k < 11 ? 'جيران' : 'جاراً'} فقط`);
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
