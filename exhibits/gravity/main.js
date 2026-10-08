import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createShell, WEBGL_FAIL } from '../../assets/js/shell.js';
import { createStage } from '../../assets/js/stage.js';

// N-body gravity in the plane (G = 1), velocity-Verlet with substeps.
// Massive bodies attract each other; asteroids are massless test particles.
const SOFT2 = 0.35;
const MAX_BODIES = 32;
const TRAIL = 360;

const TYPES = {
  star: { label: 'نجم', mass: 120, color: '#ffe2a0', emissive: true },
  planet: { label: 'كوكب', mass: 1.2, color: null },
  moon: { label: 'قمر', mass: 0.03, color: '#b9b4ac' },
  hole: { label: 'ثقب أسود', mass: 600, color: '#000000', hole: true },
  belt: { label: 'حزام كويكبات', mass: 0 },
};
const PLANET_COLORS = ['#5aa0ff', '#e0865a', '#9bd18a', '#d9c27a', '#c79bff', '#6fd6c6', '#ff9cb0'];
const radiusOf = (b) => (b.hole ? 1.1 : b.emissive ? 1.2 + Math.cbrt(b.mass / 120) * 0.9 : Math.max(0.18, Math.cbrt(b.mass) * 0.42));

const ui = createShell({
  title: 'ساحة الجاذبية',
  scale: 'مقياس <bdi class="num">10<sup>11</sup></bdi> متر',
  hint: 'اسحب بالزر الأيسر لترمي جسماً في اتجاه السحب، وبالزر الأيمن لتدوير المشهد',
  readouts: [
    { key: 'bodies', label: 'الأجسام' },
    { key: 'energy', label: 'الطاقة الكلية' },
  ],
  controls: [
    { type: 'group', label: 'ماذا ترمي؟' },
    { type: 'segmented', key: 'type', value: 'planet', options: Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label })) },
    { type: 'toggle', key: 'assist', label: 'نقرة واحدة تصنع مداراً دائرياً', value: true },
    { type: 'group', label: 'أنظمة جاهزة' },
    { type: 'buttons', items: [
      { label: 'شمس وكواكب', action: () => preset('solar') },
      { label: 'نجمان متراقصان', action: () => preset('binary') },
      { label: 'رقصة الثمانية', action: () => preset('eight') },
      { label: 'نقاط لاغرانج', action: () => preset('lagrange') },
      { label: 'نجم عابر', action: () => preset('flyby') },
      { label: 'امسح الكل', action: () => preset('empty') },
    ] },
    { type: 'group', label: 'العرض' },
    { type: 'range', key: 'speed', label: 'سرعة الزمن', min: 0, max: 4, step: 0.05, value: 1, format: (v) => (v === 0 ? 'متوقف' : `×${v.toFixed(2)}`) },
    { type: 'toggle', key: 'grid', label: 'نسيج الزمكان', value: true },
    { type: 'toggle', key: 'trails', label: 'آثار المدارات', value: true },
    { type: 'toggle', key: 'predict', label: 'توقّع المسار قبل الرمي', value: true },
  ],
  onChange(key, v) { if (key === 'trails' && !v) clearTrails(); },
  info: `
    <h2>قانون واحد يصنع كل المدارات</h2>
    <p>كل جسم هنا يجذب كل جسم آخر بقوة تتناسب مع كتلتيهما وتضعف بمربع المسافة بينهما، وهو قانون نيوتن للجذب العام. لا يوجد في البرنامج أي سطر يقول «ادر حول النجم»: المدارات والاصطدامات والفوضى كلها تخرج من هذا القانون وحده، يُحسب مئات المرات في الثانية.</p>
    <h3>لماذا لا يسقط الكوكب على النجم؟</h3>
    <p>هو يسقط فعلاً، طوال الوقت! لكنه يتحرك جانبياً بسرعة كافية فيفوته باستمرار. إن رميته ببطء سقط واصطدم، وإن رميته بسرعة كبيرة أفلت إلى الأبد، وبينهما مدار. فعّل «توقّع المسار» وجرّب سرعات مختلفة.</p>
    <h3>نسيج الزمكان</h3>
    <p>الشبكة تحت الأجسام تمثيل مبسّط لفكرة أينشتاين: الكتلة تحني الزمكان، والأجسام تتبع هذا الانحناء. عمق كل حفرة يتناسب مع كتلة الجسم الذي فيها.</p>
    <h3>الأنظمة الجاهزة</h3>
    <ul>
      <li><strong>رقصة الثمانية:</strong> ثلاثة نجوم متساوية تتبع مداراً واحداً على شكل رقم ٨. اكتُشف هذا الحل رياضياً عام ١٩٩٣، وهو من الحلول النادرة المستقرة لمسألة الأجسام الثلاثة.</li>
      <li><strong>نقاط لاغرانج:</strong> أمام الكوكب وخلفه بستين درجة نقطتان تبقى فيهما الكويكبات مستقرة. هكذا تتجمع «كويكبات طروادة» أمام المشتري وخلفه منذ مليارات السنين.</li>
      <li><strong>نجم عابر:</strong> نجم غريب يمر قرب نظام شمسي فيبعثر كواكبه وكويكباته. يعتقد العلماء أن شيئاً كهذا ربما حدث للشمس في بداية عمرها.</li>
    </ul>
    <p>رقم «الطاقة الكلية» يجب أن يبقى ثابتاً تقريباً لأن الطاقة محفوظة في الجاذبية؛ لا يتغير إلا حين يندمج جسمان، فجزء من الطاقة يذهب في الاصطدام.</p>
  `,
});

const stage = createStage({ bloom: { strength: 0.75, radius: 0.5, threshold: 0.6 }, exposure: 1.0, startScale: 0.9 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const scene = new THREE.Scene();
scene.background = new THREE.Color('#03050f');
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(0, 62, 52);
const controls = new OrbitControls(camera, stage.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.minDistance = 15;
controls.maxDistance = 260;
controls.maxPolarAngle = Math.PI * 0.49;
stage.setScene(scene, camera);
stage.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const starLight = new THREE.PointLight('#fff2d8', 3, 0, 0);
scene.add(starLight);
scene.add(new THREE.AmbientLight('#8090c0', 0.25));

// background stars
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

// ---------------------------------------------------------------- spacetime grid
const gridUniforms = { uBodies: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Vector4()) }, uCount: { value: 0 }, uAmount: { value: 1 } };
const grid = new THREE.Mesh(new THREE.PlaneGeometry(240, 240, 300, 300), new THREE.ShaderMaterial({
  uniforms: gridUniforms,
  vertexShader: /* glsl */`
    uniform vec4 uBodies[${MAX_BODIES}];
    uniform int uCount;
    varying vec2 vXZ;
    varying float vDepth;
    void main() {
      vec3 p = vec3(position.x, 0.0, -position.y);
      float y = 0.0;
      for (int i = 0; i < ${MAX_BODIES}; i++) {
        if (i >= uCount) break;
        vec2 d = p.xz - uBodies[i].xz;
        y -= uBodies[i].w / sqrt(dot(d, d) + 30.0);
      }
      y = max(y * 0.55, -16.0);
      vDepth = -y;
      vXZ = p.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, y - 2.5, p.z, 1.0);
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vXZ;
    varying float vDepth;
    uniform float uAmount;
    void main() {
      vec2 g = abs(fract(vXZ / 4.0 - 0.5) - 0.5) / fwidth(vXZ / 4.0);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float fade = 1.0 - smoothstep(60.0, 118.0, length(vXZ));
      vec3 col = mix(vec3(0.18, 0.26, 0.6), vec3(0.95, 0.72, 0.35), smoothstep(0.5, 12.0, vDepth));
      gl_FragColor = vec4(col * line * fade * (0.07 + 0.6 * smoothstep(0.0, 6.0, vDepth)) * uAmount, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
grid.frustumCulled = false;
scene.add(grid);

// ---------------------------------------------------------------- bodies
const bodies = [];
const sphereGeo = new THREE.SphereGeometry(1, 40, 28);
function makeBody(type, x, z, vx, vz, massOverride, color) {
  if (bodies.length >= MAX_BODIES) return null;
  const T = TYPES[type];
  const b = { type, mass: massOverride ?? T.mass, x, z, vx, vz, ax: 0, az: 0, emissive: !!T.emissive, hole: !!T.hole };
  const col = new THREE.Color(color || T.color || PLANET_COLORS[Math.floor(Math.random() * PLANET_COLORS.length)]);
  b.color = col;
  if (b.emissive) {
    b.mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2) }));
  } else if (b.hole) {
    b.mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#000000' }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 12, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb060').multiplyScalar(2.5) }));
    ring.rotation.x = Math.PI / 2 - 0.25;
    b.mesh.add(ring);
  } else {
    b.mesh = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.05, emissive: col, emissiveIntensity: 0.08 }));
  }
  scene.add(b.mesh);
  const tg = new THREE.BufferGeometry();
  b.trailPos = new Float32Array(TRAIL * 3);
  b.trailCol = new Float32Array(TRAIL * 3);
  b.trailN = 0;
  tg.setAttribute('position', new THREE.BufferAttribute(b.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  tg.setAttribute('color', new THREE.BufferAttribute(b.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
  b.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  b.trail.frustumCulled = false;
  scene.add(b.trail);
  updateBodyMesh(b);
  bodies.push(b);
  return b;
}
function updateBodyMesh(b) {
  b.r = radiusOf(b);
  b.mesh.scale.setScalar(b.r);
  b.mesh.position.set(b.x, 0, b.z);
}
function removeBody(b) {
  scene.remove(b.mesh, b.trail);
  b.trail.geometry.dispose();
  bodies.splice(bodies.indexOf(b), 1);
}
function clearTrails() { for (const b of bodies) b.trailN = 0; }

// asteroids (test particles)
const MAX_AST = 4000;
const ast = { n: 0, x: new Float32Array(MAX_AST), z: new Float32Array(MAX_AST), vx: new Float32Array(MAX_AST), vz: new Float32Array(MAX_AST) };
const astPos = new Float32Array(MAX_AST * 3);
const astGeo = new THREE.BufferGeometry();
astGeo.setAttribute('position', new THREE.BufferAttribute(astPos, 3).setUsage(THREE.DynamicDrawUsage));
const dot = document.createElement('canvas');
dot.width = dot.height = 16;
{
  const g = dot.getContext('2d');
  const grd = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 16, 16);
}
const astPoints = new THREE.Points(astGeo, new THREE.PointsMaterial({ color: '#cbb894', size: 3, sizeAttenuation: false, transparent: true, map: new THREE.CanvasTexture(dot), depthWrite: false, blending: THREE.AdditiveBlending }));
astPoints.frustumCulled = false;
scene.add(astPoints);
function addAsteroid(x, z, vx, vz) {
  if (ast.n >= MAX_AST) return;
  const i = ast.n++;
  ast.x[i] = x; ast.z[i] = z; ast.vx[i] = vx; ast.vz[i] = vz;
}
function removeAsteroid(i) {
  const j = --ast.n;
  ast.x[i] = ast.x[j]; ast.z[i] = ast.z[j]; ast.vx[i] = ast.vx[j]; ast.vz[i] = ast.vz[j];
}

// ---------------------------------------------------------------- physics
function accelAt(x, z, list, skip) {
  let ax = 0, az = 0;
  for (const o of list) {
    if (o === skip) continue;
    const dx = o.x - x, dz = o.z - z;
    const r2 = dx * dx + dz * dz + SOFT2;
    const f = o.mass / (r2 * Math.sqrt(r2));
    ax += dx * f; az += dz * f;
  }
  return [ax, az];
}
function computeAccel(list) { for (const b of list) { const a = accelAt(b.x, b.z, list, b); b.ax = a[0]; b.az = a[1]; } }

function step(dt) {
  // velocity Verlet for the massive bodies
  for (const b of bodies) { b.vx += b.ax * dt * 0.5; b.vz += b.az * dt * 0.5; b.x += b.vx * dt; b.z += b.vz * dt; }
  computeAccel(bodies);
  for (const b of bodies) { b.vx += b.ax * dt * 0.5; b.vz += b.az * dt * 0.5; }
  // test particles (semi-implicit Euler is plenty for them)
  for (let i = 0; i < ast.n; i++) {
    const a = accelAt(ast.x[i], ast.z[i], bodies, null);
    ast.vx[i] += a[0] * dt; ast.vz[i] += a[1] * dt;
    ast.x[i] += ast.vx[i] * dt; ast.z[i] += ast.vz[i] * dt;
  }
  // collisions: massive bodies merge, conserving momentum
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], c = bodies[j];
    const dx = a.x - c.x, dz = a.z - c.z;
    if (dx * dx + dz * dz < (a.r + c.r) * (a.r + c.r) * 0.6) {
      const [big, small] = a.mass >= c.mass ? [a, c] : [c, a];
      const M = big.mass + small.mass;
      big.vx = (big.vx * big.mass + small.vx * small.mass) / M;
      big.vz = (big.vz * big.mass + small.vz * small.mass) / M;
      big.x = (big.x * big.mass + small.x * small.mass) / M;
      big.z = (big.z * big.mass + small.z * small.mass) / M;
      big.mass = M;
      flash(small.x, small.z, small.color);
      removeBody(small);
      updateBodyMesh(big);
      return;
    }
  }
  // asteroids that hit a body disappear; very distant ones are dropped
  for (let i = ast.n - 1; i >= 0; i--) {
    for (const b of bodies) {
      const dx = ast.x[i] - b.x, dz = ast.z[i] - b.z;
      if (dx * dx + dz * dz < b.r * b.r) { removeAsteroid(i); break; }
    }
    if (i < ast.n && Math.abs(ast.x[i]) + Math.abs(ast.z[i]) > 900) removeAsteroid(i);
  }
}

function energy() {
  let E = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    E += 0.5 * a.mass * (a.vx * a.vx + a.vz * a.vz);
    for (let j = i + 1; j < bodies.length; j++) {
      const c = bodies[j];
      E -= a.mass * c.mass / Math.sqrt((a.x - c.x) ** 2 + (a.z - c.z) ** 2 + SOFT2);
    }
  }
  return E;
}

// collision flashes
const flashes = [];
const flashGeo = new THREE.SphereGeometry(1, 20, 14);
function flash(x, z, color) {
  const m = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.set(x, 0, z);
  scene.add(m);
  flashes.push({ m, t: 0 });
}

// ---------------------------------------------------------------- presets
function dominant(x, z) {
  let best = null, bestF = 0;
  for (const b of bodies) {
    const d2 = (b.x - x) ** 2 + (b.z - z) ** 2 + SOFT2;
    const f = b.mass / d2;
    if (f > bestF) { bestF = f; best = b; }
  }
  return best;
}
function circularVelocity(x, z, around) {
  const c = around || dominant(x, z);
  if (!c) return [0, 0];
  const dx = x - c.x, dz = z - c.z, r = Math.hypot(dx, dz) || 1;
  const v = Math.sqrt(c.mass / r);
  // counter-clockwise seen from above
  return [c.vx + (dz / r) * v, c.vz - (dx / r) * v];
}
function belt(cx, cz, r0, r1, n, around) {
  for (let i = 0; i < n; i++) {
    const r = r0 + Math.random() * (r1 - r0), a = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const [vx, vz] = circularVelocity(x, z, around);
    addAsteroid(x, z, vx, vz);
  }
}
function clearAll() {
  while (bodies.length) removeBody(bodies[0]);
  ast.n = 0;
}
function preset(name) {
  clearAll();
  if (name === 'solar') {
    const s = makeBody('star', 0, 0, 0, 0);
    [[9, 0.4, '#b9b0a4'], [15, 1.1, '#e8c38a'], [22, 1.3, '#5aa0ff'], [31, 0.8, '#e0865a'], [52, 8, '#d9b38c']].forEach(([r, m, c], i) => {
      const a = i * 2.1;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const [vx, vz] = circularVelocity(x, z, s);
      const p = makeBody('planet', x, z, vx, vz, m, c);
      if (i === 2) { const mx = x + 2.2, [mvx, mvz] = circularVelocity(mx, z, p); makeBody('moon', mx, z, mvx, mvz); }
    });
    belt(0, 0, 38, 44, 900, s);
  } else if (name === 'binary') {
    const m = 90, d = 7, v = Math.sqrt(m / (4 * d));
    makeBody('star', -d, 0, 0, v, m, '#ffd28a');
    makeBody('star', d, 0, 0, -v, m, '#9cc4ff');
    const r = 34, [vx, vz] = [0, -Math.sqrt(2 * m / r)];
    makeBody('planet', r, 0, vx, vz, 1, '#9bd18a');
    for (let i = 0; i < 1200; i++) {
      const rr = 18 + Math.random() * 40, a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr, vv = Math.sqrt(2 * m / rr);
      addAsteroid(x, z, (z / rr) * vv, -(x / rr) * vv);
    }
  } else if (name === 'eight') {
    // Chenciner–Montgomery figure-eight, scaled to mass m and length L.
    const m = 100, L = 12, k = Math.sqrt(m / L);
    const p = [[-0.97000436, 0.24308753], [0.97000436, -0.24308753], [0, 0]];
    const v3 = [-0.93240737, -0.86473146];
    const v = [[-v3[0] / 2, -v3[1] / 2], [-v3[0] / 2, -v3[1] / 2], v3];
    ['#ffd28a', '#9cc4ff', '#ff9cb0'].forEach((c, i) => makeBody('star', p[i][0] * L, p[i][1] * L, v[i][0] * k, v[i][1] * k, m, c));
  } else if (name === 'lagrange') {
    const s = makeBody('star', 0, 0, 0, 0, 120);
    const r = 30, pm = 3;
    const [vx, vz] = circularVelocity(r, 0, s);
    makeBody('planet', r, 0, vx, vz, pm, '#d9b38c');
    const w = Math.sqrt((120 + pm) / r ** 3);
    for (let i = 0; i < 700; i++) {
      const side = i % 2 ? 1 : -1;
      const a = side * Math.PI / 3 + (Math.random() - 0.5) * 0.25, rr = r * (1 + (Math.random() - 0.5) * 0.04);
      // L4 leads the planet by 60°, L5 trails it; both co-rotate with angular speed w
      const x = Math.cos(a) * rr, z = -Math.sin(a) * rr;
      addAsteroid(x, z, z * w, -x * w);
    }
  } else if (name === 'flyby') {
    const s = makeBody('star', 0, 0, 0, 0, 120);
    [[12, 1, '#5aa0ff'], [20, 1.5, '#e0865a'], [30, 4, '#d9b38c']].forEach(([r, m, c], i) => {
      const a = i * 2.3, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const [vx, vz] = circularVelocity(x, z, s);
      makeBody('planet', x, z, vx, vz, m, c);
    });
    belt(0, 0, 36, 46, 1200, s);
    makeBody('star', -120, 34, 3.4, 0, 110, '#ff8a6a');
  }
  computeAccel(bodies);
  E0 = energy();
  clearTrails();
}

// ---------------------------------------------------------------- throwing
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const hit = new THREE.Vector3();
function planePoint(e) {
  const r = stage.canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return raycaster.ray.intersectPlane(plane, hit) ? hit.clone() : null;
}
let aim = null;
const aimLineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const aimLine = new THREE.Line(aimLineGeo, new THREE.LineBasicMaterial({ color: '#f3d48b' }));
aimLine.visible = false;
scene.add(aimLine);
const PRED = 700;
const predGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRED * 3), 3));
const pred = new THREE.Line(predGeo, new THREE.LineDashedMaterial({ color: '#8fb0ff', dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.85 }));
pred.visible = false;
pred.frustumCulled = false;
scene.add(pred);
const ghost = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }));
ghost.visible = false;
scene.add(ghost);

const THROW = 0.22;
function throwVelocity(a) {
  const base = ui.values.assist && a.dist < 1.5 ? circularVelocity(a.start.x, a.start.z) : [0, 0];
  return [base[0] + (a.cur.x - a.start.x) * THROW, base[1] + (a.cur.z - a.start.z) * THROW];
}
function predict(x, z, vx, vz) {
  // integrate the would-be body forward with a coarse copy of the system
  const sim = bodies.map((b) => ({ x: b.x, z: b.z, vx: b.vx, vz: b.vz, mass: b.mass }));
  const arr = predGeo.attributes.position.array;
  const dt = 0.05;
  const mass = TYPES[ui.values.type].mass;
  const me = { x, z, vx, vz, mass };
  for (let i = 0; i < PRED; i++) {
    const all = [...sim, me];
    for (const b of all) { const a = accelAt(b.x, b.z, all, b); b.vx += a[0] * dt; b.vz += a[1] * dt; }
    for (const b of all) { b.x += b.vx * dt; b.z += b.vz * dt; }
    arr[i * 3] = me.x; arr[i * 3 + 1] = 0.05; arr[i * 3 + 2] = me.z;
  }
  predGeo.attributes.position.needsUpdate = true;
  pred.computeLineDistances();
}

stage.canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = planePoint(e);
  if (!p) return;
  aim = { start: p, cur: p.clone(), dist: 0 };
  stage.canvas.setPointerCapture(e.pointerId);
});
stage.canvas.addEventListener('pointermove', (e) => {
  if (!aim) return;
  const p = planePoint(e);
  if (!p) return;
  aim.cur = p;
  aim.dist = p.distanceTo(aim.start);
});
stage.canvas.addEventListener('pointerup', (e) => {
  if (!aim || e.button !== 0) return;
  const t = ui.values.type;
  const [vx, vz] = throwVelocity(aim);
  if (t === 'belt') {
    const c = dominant(aim.start.x, aim.start.z);
    if (c) {
      const r = Math.hypot(aim.start.x - c.x, aim.start.z - c.z);
      belt(c.x, c.z, r * 0.92, r * 1.08, 500, c);
    } else {
      for (let i = 0; i < 400; i++) addAsteroid(aim.start.x + (Math.random() - 0.5) * 6, aim.start.z + (Math.random() - 0.5) * 6, vx, vz);
    }
  } else {
    const b = makeBody(t, aim.start.x, aim.start.z, vx, vz);
    if (!b) ui.toast('الساحة ممتلئة: الحد ٣٢ جسماً ثقيلاً');
    computeAccel(bodies);
    E0 = energy();
  }
  aim = null;
});

// ---------------------------------------------------------------- loop
stage.onResize((bw, bh, w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); });
let E0 = 0, roT = 0, first = true, acc = 0;
preset('solar');
window.__exhibit = { bodies, preset, step };

stage.start((dt) => {
  const v = ui.values;
  // fixed substeps for stable orbits
  const H = 1 / 240;
  acc += Math.min(dt, 0.05) * v.speed * 3;
  let n = 0;
  while (acc >= H && n < 40) { step(H); acc -= H; n++; }

  for (const b of bodies) {
    b.mesh.position.set(b.x, 0, b.z);
    if (v.trails) {
      if (b.trailN < TRAIL) b.trailN++;
      b.trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
      b.trailPos[0] = b.x; b.trailPos[1] = 0; b.trailPos[2] = b.z;
      for (let i = 0; i < b.trailN; i++) {
        const f = (1 - i / TRAIL) ** 1.5 * 0.9;
        b.trailCol[i * 3] = b.color.r * f; b.trailCol[i * 3 + 1] = b.color.g * f; b.trailCol[i * 3 + 2] = b.color.b * f;
      }
      b.trail.geometry.setDrawRange(0, b.trailN);
      b.trail.geometry.attributes.position.needsUpdate = true;
      b.trail.geometry.attributes.color.needsUpdate = true;
    }
    b.trail.visible = v.trails && !b.hole;
  }
  // the brightest star lights the planets
  const star = bodies.filter((b) => b.emissive).sort((a, b) => b.mass - a.mass)[0];
  if (star) starLight.position.set(star.x, 0, star.z);

  for (let i = 0; i < ast.n; i++) { astPos[i * 3] = ast.x[i]; astPos[i * 3 + 1] = 0; astPos[i * 3 + 2] = ast.z[i]; }
  astGeo.setDrawRange(0, ast.n);
  astGeo.attributes.position.needsUpdate = true;

  const gb = gridUniforms.uBodies.value;
  bodies.forEach((b, i) => gb[i].set(b.x, 0, b.z, Math.min(b.mass, 400) * 0.5));
  gridUniforms.uCount.value = bodies.length;
  grid.visible = v.grid;

  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    f.m.scale.setScalar(1 + f.t * 14);
    f.m.material.opacity = Math.max(0, 1 - f.t * 1.6);
    if (f.t > 0.7) { scene.remove(f.m); flashes.splice(i, 1); }
  }

  if (aim) {
    const [vx, vz] = throwVelocity(aim);
    aimLineGeo.attributes.position.array.set([aim.start.x, 0.05, aim.start.z, aim.cur.x, 0.05, aim.cur.z]);
    aimLineGeo.attributes.position.needsUpdate = true;
    aimLine.visible = aim.dist > 0.3;
    ghost.visible = ui.values.type !== 'belt';
    ghost.position.set(aim.start.x, 0, aim.start.z);
    ghost.scale.setScalar(radiusOf({ ...TYPES[ui.values.type], emissive: !!TYPES[ui.values.type].emissive, hole: !!TYPES[ui.values.type].hole, mass: TYPES[ui.values.type].mass }));
    if (v.predict && ui.values.type !== 'belt') { predict(aim.start.x, aim.start.z, vx, vz); pred.visible = true; }
  } else { aimLine.visible = false; pred.visible = false; ghost.visible = false; }

  controls.update();
  stage.render();

  roT -= dt;
  if (roT <= 0) {
    roT = 0.3;
    ui.readout('bodies', `${bodies.length} جسماً و${ast.n.toLocaleString('en')} كويكباً`);
    const E = energy();
    ui.readout('energy', E0 !== 0 ? `${(100 * E / E0).toFixed(2)}٪ من قيمتها الأولى` : '–');
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 150); }
});
