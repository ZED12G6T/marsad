// The hero: a brass armillary sphere set for the latitude of Riyadh, turning with the sky.
import * as THREE from 'three';

const canvas = document.getElementById('sky');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch {
  canvas.remove();
}
if (renderer) init();

function init() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070b1d, 4.6, 7.8);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.3, 6.2);
  camera.lookAt(0, 0, 0);

  const BRASS = new THREE.Color('#c9a45e');
  const HI = new THREE.Color('#e3c486');
  const drawables = [];

  const lineMat = (opacity, color = BRASS) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

  function ring(r, opacity, delay, { seg = 256, y = 0 } = {}) {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    drawables.push({ geo, count: seg + 1, delay, pairs: false });
    return new THREE.Line(geo, lineMat(opacity));
  }

  // Engraved graduations on a ring: minor ticks, with a longer one every `major`.
  function ticks(r, count, len, major, majorLen, opacity, delay, outward = false) {
    const pos = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const l = i % major === 0 ? majorLen : len;
      const r2 = outward ? r + l : r - l;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * r2, 0, Math.sin(a) * r2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    drawables.push({ geo, count: count * 2, delay, pairs: true });
    return new THREE.LineSegments(geo, lineMat(opacity));
  }

  const rig = new THREE.Group();
  scene.add(rig);
  const armillary = new THREE.Group();
  rig.add(armillary);

  // Fixed frame: horizon and meridian rings with graduated limbs.
  armillary.add(ring(1.44, 0.9, 0.0), ring(1.38, 0.45, 0.12), ticks(1.44, 72, 0.025, 9, 0.06, 0.7, 0.25));
  const meridian = new THREE.Group();
  meridian.add(ring(1.3, 0.85, 0.2), ring(1.25, 0.4, 0.3), ticks(1.3, 180, 0.022, 5, 0.05, 0.55, 0.4));
  meridian.rotation.z = Math.PI / 2;
  armillary.add(meridian);

  // Celestial sphere: pole raised to the observer's latitude.
  const LAT = THREE.MathUtils.degToRad(24.7);
  const tilt = new THREE.Group();
  tilt.rotation.x = Math.PI / 2 - LAT;
  armillary.add(tilt);
  {
    const axis = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1.75, 0), new THREE.Vector3(0, 1.75, 0)]);
    drawables.push({ geo: axis, count: 2, delay: 0.5, pairs: true });
    tilt.add(new THREE.LineSegments(axis, lineMat(0.6)));
  }
  const spin = new THREE.Group();
  tilt.add(spin);

  const OBL = THREE.MathUtils.degToRad(23.44);
  spin.add(ring(1.0, 0.9, 0.55), ticks(1.0, 96, 0.018, 4, 0.04, 0.6, 0.7));
  spin.add(ring(Math.cos(OBL), 0.32, 0.75, { y: Math.sin(OBL) }), ring(Math.cos(OBL), 0.32, 0.8, { y: -Math.sin(OBL) }));
  spin.add(ring(Math.sin(OBL), 0.28, 0.85, { y: Math.cos(OBL) }), ring(Math.sin(OBL), 0.28, 0.9, { y: -Math.cos(OBL) }));
  const colure1 = ring(1.0, 0.4, 0.95); colure1.rotation.z = Math.PI / 2;
  const colure2 = ring(1.0, 0.4, 1.0); colure2.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  spin.add(colure1, colure2);

  // Ecliptic band with the twelve zodiac divisions, and the sun travelling along it.
  const ecliptic = new THREE.Group();
  ecliptic.rotation.x = OBL;
  ecliptic.add(ring(1.0, 0.95, 1.05), ring(1.0, 0.35, 1.1, { y: 0.07 }), ring(1.0, 0.35, 1.1, { y: -0.07 }));
  {
    const pos = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pos.push(Math.cos(a), -0.07, Math.sin(a), Math.cos(a), 0.07, Math.sin(a));
    }
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      pos.push(Math.cos(a), 0.07, Math.sin(a), Math.cos(a), 0.045, Math.sin(a));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    drawables.push({ geo, count: pos.length / 3, delay: 1.25, pairs: true });
    ecliptic.add(new THREE.LineSegments(geo, lineMat(0.6)));
  }
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 12), new THREE.MeshBasicMaterial({ color: HI, fog: false }));
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,220,150,0.9)');
    grd.addColorStop(0.25, 'rgba(230,180,100,0.35)');
    grd.addColorStop(1, 'rgba(230,180,100,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.scale.setScalar(0.5);
  sun.add(glow);
  ecliptic.add(sun);
  spin.add(ecliptic);

  // The Earth at the centre, engraved with meridians and parallels.
  {
    const geo = new THREE.WireframeGeometry(new THREE.SphereGeometry(0.13, 18, 10));
    const earth = new THREE.LineSegments(geo, lineMat(0.45, HI));
    tilt.add(earth);
  }

  // Background stars ride on the celestial sphere.
  {
    const n = 2600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * r * 22, u * 22, Math.sin(a) * r * 22], i * 3);
      const b = 0.25 + Math.pow(rnd(), 6) * 1.1, warm = rnd();
      col.set([b, b * (0.88 + warm * 0.1), b * (0.75 + (1 - warm) * 0.35)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    spin.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false })));
  }

  // Layout: the sphere sits beside the title on wide screens, behind it on narrow ones.
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const wide = camera.aspect > 1.05;
    armillary.position.set(wide ? -Math.min(halfH * camera.aspect * 0.48, 2.3) : 0, wide ? 0 : halfH * 0.42, 0);
    armillary.scale.setScalar(wide ? 0.84 : Math.min(0.9, Math.max(0.62, (halfH * camera.aspect) / 1.3)));
    canvas.style.opacity = wide ? '1' : '0.6';
  }
  window.addEventListener('resize', resize);
  resize();

  const target = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  for (const d of drawables) d.geo.setDrawRange(0, reduced ? d.count : 0);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

  const clock = new THREE.Clock();
  let elapsed = 0, sunAngle = 0.6;
  rig.rotation.set(0.12, 0.55, 0);
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!visible) return;
    elapsed += dt;
    if (!reduced) {
      // One orchestrated entrance: every ring is engraved in, in sequence.
      for (const d of drawables) {
        const k = easeOut(THREE.MathUtils.clamp((elapsed - d.delay * 1.2) / 1.6, 0, 1));
        let n = Math.floor(d.count * k);
        if (d.pairs) n -= n % 2;
        d.geo.setDrawRange(0, n);
      }
      spin.rotation.y += dt * 0.05;
      sunAngle += dt * 0.12;
      rig.rotation.y += (0.55 + target.x * 0.22 - rig.rotation.y) * 0.04;
      rig.rotation.x += (0.12 + target.y * 0.08 - rig.rotation.x) * 0.04;
    }
    sun.position.set(Math.cos(sunAngle), 0, Math.sin(sunAngle));
    renderer.render(scene, camera);
  }
  frame();
}

// Point the footer link at this repository when served from GitHub Pages (user.github.io/repo/).
const link = document.getElementById('repo-link');
const m = location.hostname.match(/^([^.]+)\.github\.io$/);
if (link && m) {
  const repo = location.pathname.split('/').filter(Boolean)[0] || `${m[1]}.github.io`;
  link.href = `https://github.com/${m[1]}/${repo}`;
}
