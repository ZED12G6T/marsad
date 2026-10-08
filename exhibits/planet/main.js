import * as THREE from 'three';
import { createShell, WEBGL_FAIL, ltr } from '../../assets/js/shell.js';
import { createStage, shaderQuad, cameraUniforms, syncCamera, RAY_GLSL, QUALITY_OPTIONS, ease } from '../../assets/js/stage.js';

// Planet radius 1. Terrain is baked once per seed into a cube map (four noise
// layers), then ray-marched every frame with extra procedural detail up close.

const NOISE_GLSL = /* glsl */`
precision highp sampler3D;
uniform sampler3D uNoise;
// Tileable gradient noise baked into a 3D texture: 32 noise cells per texture period.
float n3(vec3 p) { return textureLod(uNoise, p * 0.03125, 0.0).r; }
const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbmN(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    s += a * n3(p);
    p = ROT * p * 2.03;
    a *= 0.5;
  }
  return s;
}
float ridgedN(vec3 p, int oct) {
  float s = 0.0, a = 0.5, w = 1.0;
  for (int i = 0; i < 10; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(n3(p) * 1.7);
    n *= n * w;
    w = clamp(n * 1.6, 0.0, 1.0);
    s += n * a;
    p = ROT * p * 2.07;
    a *= 0.5;
  }
  return s;
}
`;

// Shared by the renderer and the ground probe so both agree on where the surface is.
const HEIGHT_GLSL = /* glsl */`
float landMask(float c) { return smoothstep(uSea - 0.02, uSea + 0.2, c); }
float seaH() { return uSea * 0.45; }
float baseHeight(vec4 tx) {
  // Mountain ranges rise in continental interiors; cubing the ridge keeps most land low.
  float inland = smoothstep(uSea + 0.04, uSea + 0.5, tx.r);
  float r3 = tx.g * tx.g * tx.g;
  return tx.r * 0.45 + landMask(tx.r) * (0.03 + tx.b * 0.07 + inland * r3 * 0.75 * uMountain);
}
`;

const PROBE_FS = /* glsl */`
uniform samplerCube uTerrain;
uniform vec3 uDir;
uniform float uSea;
uniform float uMountain;
${HEIGHT_GLSL}
void main() { gl_FragColor = vec4(max(baseHeight(texture(uTerrain, uDir)), seaH()), 0.0, 0.0, 1.0); }
`;

const BAKE_VS = /* glsl */`
varying vec3 vPos;
void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Four terrain layers: continents, mountain ridges, hills, moisture.
const BAKE_FS = /* glsl */`
varying vec3 vPos;
uniform vec3 uSeed;
${NOISE_GLSL}
void main() {
  vec3 dir = normalize(vPos);
  vec3 q = dir * 1.6 + uSeed;
  vec3 w = vec3(fbmN(q + vec3(1.7, 9.2, 3.1), 4), fbmN(q + vec3(8.3, 2.8, 5.5), 4), fbmN(q + vec3(4.1, 6.6, 0.4), 4));
  float c = fbmN(q + w * 1.7, 7) * 2.3;
  float ridge = ridgedN(dir * 4.2 + uSeed * 1.3, 9);
  float hills = fbmN(dir * 13.0 + uSeed * 0.7, 7) * 1.5;
  float moist = fbmN(dir * 2.4 + uSeed * 2.1 + 40.0, 5) * 1.7 + 0.5;
  gl_FragColor = vec4(c, ridge, hills, moist);
}
`;

const FRAG = /* glsl */`
varying vec2 vUv;
uniform float uPixAngle;
uniform samplerCube uTerrain;
uniform vec3 uSun;
uniform float uTime;
uniform float uSea;
uniform float uMountain;
uniform float uRMax;
uniform float uCloud;
uniform float uCloudTime;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform float uCity;
uniform float uLava;
uniform float uFrozen;
uniform vec3 uSeed;
uniform int uSteps;
uniform vec3 cDeep, cShallow, cSand, cGrass, cForest, cDesert, cTundra, cRock, cSnow, cCloud;
${RAY_GLSL}
${NOISE_GLSL}

const float R = 1.0;
const float H = 0.035;
const float RC = 1.046;
const float RA = 1.11;
const float HR = 0.012;
const float HM = 0.004;
const float SUN = 10.0;
const float ES = SUN / 3.14159; // irradiance → Lambertian radiance, keeps ground and sky consistent

vec2 sph(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}


${HEIGHT_GLSL}
float terrainH(vec3 dir, float detail, out vec4 tx) {
  tx = textureLod(uTerrain, dir, 0.0);
  float h = baseHeight(tx);
  if (detail > 0.001) h += detail * landMask(tx.r) * fbmN(dir * 95.0 + uSeed, 5) * (0.06 + 0.14 * tx.g * tx.g * uMountain);
  return h;
}
float surfaceH(vec3 dir, float detail) { vec4 tx; return max(terrainH(dir, detail, tx), seaH()); }
float field(vec3 p, float detail) { float r = length(p); return r - (R + H * surfaceH(p / r, detail)); }

vec3 surfNormal(vec3 p, float e, float detail) {
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * field(p + k.xyy * e, detail) + k.yyx * field(p + k.yyx * e, detail) +
                   k.yxy * field(p + k.yxy * e, detail) + k.xxx * field(p + k.xxx * e, detail));
}

// ---- atmosphere (single scattering, Rayleigh + Mie)
vec2 dens(vec3 p) { float h = max(length(p) - R, 0.0); return vec2(exp(-h / HR), exp(-h / HM)); }
vec2 lightDepth(vec3 p, vec3 L) {
  float len = sph(p, L, RA).y;
  float ds = len * 0.25;
  vec2 od = vec2(0.0);
  for (int i = 0; i < 4; i++) od += dens(p + L * (ds * (float(i) + 0.5)));
  return od * ds;
}
vec3 sunTrans(vec3 p, vec3 L) {
  vec2 od = lightDepth(p, L);
  return exp(-(uBetaR * od.x + uBetaM * 1.1 * od.y));
}
void atmosphere(vec3 ro, vec3 rd, float tEnd, vec3 L, out vec3 inscat, out vec3 trans) {
  inscat = vec3(0.0);
  trans = vec3(1.0);
  vec2 ia = sph(ro, rd, RA);
  if (ia.y < 0.0) return;
  float t0 = max(ia.x, 0.0), t1 = min(ia.y, tEnd);
  if (t1 <= t0) return;
  float ds = (t1 - t0) / 12.0;
  vec2 odV = vec2(0.0);
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    vec2 d = dens(p) * ds;
    odV += d;
    if (sph(p, L, R).x > 0.0) continue;
    vec2 odL = lightDepth(p, L);
    vec3 att = exp(-(uBetaR * (odV.x + odL.x) + uBetaM * 1.1 * (odV.y + odL.y)));
    sR += att * d.x;
    sM += att * d.y;
  }
  float mu = dot(rd, L);
  float pr = 0.0597 * (1.0 + mu * mu);
  const float g = 0.76;
  float pm = 0.1194 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  inscat = SUN * (sR * uBetaR * pr + sM * uBetaM * pm);
  trans = exp(-(uBetaR * odV.x + uBetaM * 1.1 * odV.y));
}

// ---- clouds on a thin shell
float cloudDens(vec3 dir, int oct) {
  float lat = dir.y;
  float ang = uCloudTime * (0.6 + 0.4 * (1.0 - lat * lat));
  float cs = cos(ang), sn = sin(ang);
  vec3 q = vec3(cs * dir.x - sn * dir.z, dir.y, sn * dir.x + cs * dir.z);
  vec3 w = q * 3.0 + uSeed * 0.37;
  w += 0.55 * vec3(n3(w * 0.9 + uCloudTime * 0.15), n3(w * 0.9 + 7.1), n3(w * 0.9 + 3.3));
  float systems = fbmN(w * 1.1, 3) * 1.8 + 0.5;      // weather systems
  float cells = fbmN(w * 5.5 + 11.0, oct) * 1.9;     // convective cells and wisps
  float f = systems + cells * 0.42 + 0.08 * cos(lat * 9.0);
  float d = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.5, f);
  return d * d;
}

vec3 stars(vec3 d) {
  vec3 p = d * 140.0;
  vec3 c = floor(p);
  vec3 h = fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
  if (h.x > 0.08) return vec3(0.0);
  vec3 f = fract(p) - (0.3 + 0.4 * h.yzx);
  float r = max(0.06, uPixAngle * 140.0);
  return mix(vec3(1.0, 0.8, 0.6), vec3(0.7, 0.8, 1.0), h.z) * (0.08 + 2.5 * pow(h.y, 12.0)) * (0.0036 / (r * r)) * exp(-dot(f, f) / (r * r));
}

void main() {
  vec3 ro = uCamPos;
  vec3 rd = cameraRay(vUv);
  vec3 L = normalize(uSun);
  float camR = length(ro);

  // ---- terrain march
  bool hit = false;
  float t = 0.0;
  vec2 ib = sph(ro, rd, uRMax);
  if (ib.y > 0.0) {
    t = max(ib.x, 0.0);
    float tPrev = t;
    // Grazing rays over steep slopes overshoot a radial height field, so near the
    // ground we step more cautiously.
    float k = mix(0.3, 0.6, smoothstep(0.02, 0.3, camR - 1.0));
    for (int i = 0; i < uSteps; i++) {
      vec3 p = ro + rd * t;
      float r = length(p);
      float det = 1.0 - smoothstep(0.03, 0.4, t);
      float d = r - (R + H * surfaceH(p / r, det));
      if (d < max(0.0003 * t, 2e-6)) { hit = true; break; }
      tPrev = t;
      t += max(d * k, 0.00025 * t);
      if (t > ib.y) break;
    }
    if (hit) {
      // Bisect between the last point above ground and the first one below.
      float a = tPrev, b = t;
      for (int j = 0; j < 6; j++) {
        float m = 0.5 * (a + b);
        vec3 p = ro + rd * m;
        float r = length(p);
        if (r - (R + H * surfaceH(p / r, 1.0 - smoothstep(0.03, 0.4, m))) > 0.0) a = m; else b = m;
      }
      t = b;
    }
  }

  vec3 col;
  float tEnd = 1e9;
  if (hit) {
    tEnd = t;
    vec3 p = ro + rd * t;
    vec3 up = normalize(p);
    float det = 1.0 - smoothstep(0.03, 0.4, t);
    vec4 tx;
    float hT = terrainH(up, det, tx);
    float sH = seaH();
    bool water = hT < sH;
    float e = (hT - sH) / 0.55;
    float lat = abs(up.y);
    float moist = tx.a;
    float jitter = n3(up * 40.0 + uSeed) * 0.25;
    float temp = 1.0 - pow(lat, 1.4) * 1.25 - max(e, 0.0) * 0.5 + jitter * 0.5;
    vec3 sunT = sunTrans(p, L) * ES;
    float upL = dot(up, L);
    vec3 skyAmb = (vec3(0.05, 0.09, 0.18) * smoothstep(-0.25, 0.4, upL) + 0.002) * ES;

    // cloud shadow
    float cshadow = 1.0;
    if (uCloud > 0.01) {
      vec3 sp = normalize(p + L * max((RC - length(p)) / max(upL, 0.15), 0.0));
      cshadow = 1.0 - 0.6 * cloudDens(sp, 4);
    }

    vec3 emit = vec3(0.0);
    if (water) {
      float depth = sH - hT;
      vec3 base = mix(cShallow, cDeep, smoothstep(0.0, 0.12, depth));
      float ice = smoothstep(0.25, 0.08, temp) + uFrozen;
      vec3 n = up;
      if (uLava > 0.5) {
        // Cooled crust plates drifting on molten rock; the glow shows through the cracks.
        float flow = n3(up * 26.0 + vec3(0.0, uTime * 0.04, 0.0)) * 0.6 + n3(up * 80.0 - uTime * 0.02) * 0.4;
        float crust = smoothstep(-0.02, 0.12, n3(up * 34.0 + uSeed) + 0.35 * n3(up * 110.0));
        vec3 hot = mix(vec3(0.85, 0.06, 0.0), vec3(1.0, 0.42, 0.05), smoothstep(-0.2, 0.5, flow));
        emit = hot * (0.5 + 1.4 * max(flow + 0.3, 0.0)) * (1.0 - 0.92 * crust);
        col = vec3(0.025, 0.018, 0.016) * crust * (sunT * max(upL, 0.0) + skyAmb);
      } else if (ice > 0.5) {
        float crack = smoothstep(0.85, 0.97, 1.0 - abs(n3(up * 120.0) * 2.0));
        vec3 iceC = mix(vec3(0.75, 0.86, 0.95), vec3(0.45, 0.6, 0.75), crack);
        col = iceC * (sunT * max(upL, 0.0) * cshadow + skyAmb);
      } else {
        vec3 wq = up * 260.0 + vec3(uTime * 0.4, 0.0, uTime * 0.25);
        vec3 wn = normalize(up + 0.04 * det * vec3(n3(wq), n3(wq + 17.0), n3(wq + 31.0)));
        float rough = mix(1200.0, 40.0, smoothstep(0.01, 2.5, t));
        vec3 hv = normalize(L - rd);
        float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(-rd, wn), 0.0, 1.0), 5.0);
        float spec = pow(max(dot(wn, hv), 0.0), rough) * rough * 0.012;
        vec3 sky = vec3(0.2, 0.38, 0.8) * smoothstep(-0.2, 0.3, upL);
        col = base * (sunT * max(upL, 0.0) * 0.9 * cshadow + skyAmb) + sky * fres * 0.12 * ES + sunT * spec * cshadow * step(0.0, upL);
      }
    } else {
      // Normal step no smaller than ~half a cube texel, so bilinear facets don't show as creases.
      vec3 n = surfNormal(p, max(0.0004 * t, 0.0011), det);
      float slope = 1.0 - clamp(dot(n, up), 0.0, 1.0);
      vec3 low = mix(cDesert, cGrass, smoothstep(0.32, 0.5, moist));
      low = mix(low, cForest, smoothstep(0.55, 0.78, moist));
      vec3 c = mix(cTundra, low, smoothstep(0.12, 0.38, temp));
      c = mix(cSand, c, smoothstep(0.0, 0.03, e + jitter * 0.04));
      c = mix(c, cRock, smoothstep(0.1, 0.32, slope) * 0.85);
      c = mix(c, cRock, smoothstep(0.28, 0.6, e));
      // Cold latitudes freeze; on high ground only the peaks keep snow (dry plateaus stay rock).
      float peaks = smoothstep(1.15, 1.6, e + jitter * 0.6 + n3(up * 160.0) * 0.3) * (0.5 + 0.5 * smoothstep(0.3, 0.7, moist));
      float snow = max(smoothstep(0.12, -0.08, temp), peaks);
      c = mix(c, cSnow, snow * (1.0 - smoothstep(0.25, 0.45, slope)));
      float dif = max(dot(n, L), 0.0);
      float wrap = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
      col = c * (sunT * dif * cshadow * 1.05 + skyAmb * (0.6 + 0.4 * wrap));
      if (uLava > 0.5) {
        float vein = smoothstep(0.9, 0.985, 1.0 - abs(n3(up * 55.0 + uSeed) * 2.2)) * (1.0 - smoothstep(0.0, 0.25, e));
        emit = vec3(1.0, 0.3, 0.05) * vein * 2.5;
      }
      // city lights on the night side
      if (uCity > 0.5) {
        float cl = smoothstep(0.12, 0.4, n3(up * 150.0 + uSeed * 3.0) * 0.6 + n3(up * 480.0) * 0.5);
        float hab = smoothstep(0.0, 0.03, e) * (1.0 - smoothstep(0.12, 0.3, e)) * smoothstep(0.85, 0.55, lat) * smoothstep(0.25, 0.45, moist) * (1.0 - snow);
        float night = smoothstep(0.08, -0.12, upL);
        emit += vec3(1.0, 0.62, 0.28) * cl * hab * night * 0.9;
      }
    }
    col += emit;
  } else {
    col = stars(rd) + vec3(1.0, 0.96, 0.88) * (smoothstep(0.99986, 0.99995, dot(rd, L)) * 22.0 + pow(max(dot(rd, L), 0.0), 900.0) * 1.2);
  }

  // ---- clouds
  if (uCloud > 0.01) {
    vec2 ic = sph(ro, rd, RC);
    float tc = camR > RC ? ic.x : ic.y;
    if (tc > 0.0 && (!hit || tc < t)) {
      vec3 pc = ro + rd * tc;
      vec3 dc = normalize(pc);
      // A thin shell seen edge-on smears into streaks; fade it out at grazing angles.
      float cd = cloudDens(dc, 6) * smoothstep(0.02, 0.16, abs(dot(rd, dc)));
      if (cd > 0.002) {
        float ndl = dot(dc, L);
        float lit = smoothstep(-0.18, 0.35, ndl) * (0.35 + 0.65 * max(ndl, 0.0));
        float self = cloudDens(normalize(pc + L * 0.015), 3);
        vec3 amb = vec3(0.05, 0.08, 0.14) * smoothstep(-0.3, 0.2, ndl);
        vec3 cc = cCloud * 0.85 * ES * (sunTrans(pc, L) * lit * (1.0 - 0.5 * self) + amb);
        if (camR < RC) cc *= 0.55 + 0.45 * (1.0 - cd);
        col = mix(col, cc, cd * 0.96);
        if (cd > 0.5) tEnd = min(tEnd, tc);
      }
    }
  }

  vec3 inscat, trans;
  atmosphere(ro, rd, tEnd, L, inscat, trans);
  col = col * trans + inscat;
  // Clamp so a single blazing pixel can't smear blocky squares through the bloom mips.
  gl_FragColor = vec4(min(col, vec3(24.0)), 1.0);
}
`;

// ---------------------------------------------------------------- noise texture
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise3D(size = 128, period = 32) {
  const rand = mulberry32(2024);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  const gx = new Float32Array(512), gy = new Float32Array(512), gz = new Float32Array(512);
  for (let i = 0; i < 512; i++) { const g = G[perm[i] % 12]; gx[i] = g[0]; gy[i] = g[1]; gz[i] = g[2]; }
  const h = (x, y, z) => perm[perm[perm[x] + y] + z];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const data = new Uint16Array(size * size * size);
  const s = period / size;
  let idx = 0;
  for (let z = 0; z < size; z++) {
    const pz = z * s, iz = Math.floor(pz), fz = pz - iz, z0 = iz % period, z1 = (iz + 1) % period, wz = fade(fz);
    for (let y = 0; y < size; y++) {
      const py = y * s, iy = Math.floor(py), fy = py - iy, y0 = iy % period, y1 = (iy + 1) % period, wy = fade(fy);
      for (let x = 0; x < size; x++) {
        const px = x * s, ix = Math.floor(px), fx = px - ix, x0 = ix % period, x1 = (ix + 1) % period, wx = fade(fx);
        const d = (hh, ax, ay, az) => gx[hh] * ax + gy[hh] * ay + gz[hh] * az;
        const n000 = d(h(x0, y0, z0), fx, fy, fz), n100 = d(h(x1, y0, z0), fx - 1, fy, fz);
        const n010 = d(h(x0, y1, z0), fx, fy - 1, fz), n110 = d(h(x1, y1, z0), fx - 1, fy - 1, fz);
        const n001 = d(h(x0, y0, z1), fx, fy, fz - 1), n101 = d(h(x1, y0, z1), fx - 1, fy, fz - 1);
        const n011 = d(h(x0, y1, z1), fx, fy - 1, fz - 1), n111 = d(h(x1, y1, z1), fx - 1, fy - 1, fz - 1);
        const nx00 = n000 + wx * (n100 - n000), nx10 = n010 + wx * (n110 - n010);
        const nx01 = n001 + wx * (n101 - n001), nx11 = n011 + wx * (n111 - n011);
        const nxy0 = nx00 + wy * (nx10 - nx00), nxy1 = nx01 + wy * (nx11 - nx01);
        data[idx++] = THREE.DataUtils.toHalfFloat(nxy0 + wz * (nxy1 - nxy0));
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- planet types
const hex = (h) => new THREE.Color(h).convertSRGBToLinear();
const TYPES = {
  earth: {
    label: 'أرضي', sea: 0.08, mountain: 1.0, cloud: 0.5, atmos: 1.0, city: true,
    betaR: [3.9, 9.0, 22.0], betaM: 2.2, lava: 0, frozen: 0,
    c: { deep: '#06204a', shallow: '#0f6f86', sand: '#c9b282', grass: '#4f7a2a', forest: '#1f4a1c', desert: '#c19a5b', tundra: '#7d8069', rock: '#5d5248', snow: '#f2f5f8', cloud: '#ffffff' },
  },
  desert: {
    label: 'صحراوي', sea: -0.42, mountain: 1.15, cloud: 0.12, atmos: 0.8, city: false,
    betaR: [9.0, 6.0, 4.0], betaM: 7.0, lava: 0, frozen: 0,
    c: { deep: '#1d3b4f', shallow: '#3f7f86', sand: '#d9b07a', grass: '#b5793f', forest: '#8c4f2a', desert: '#d6955a', tundra: '#a7704a', rock: '#6f4130', snow: '#efe1d0', cloud: '#f3e3d0' },
  },
  ice: {
    label: 'جليدي', sea: 0.2, mountain: 0.9, cloud: 0.35, atmos: 0.7, city: false,
    betaR: [5.5, 10.0, 18.0], betaM: 1.6, lava: 0, frozen: 1,
    c: { deep: '#123a5c', shallow: '#2e7aa0', sand: '#c7d3dc', grass: '#a8b8c4', forest: '#8899a8', desert: '#d6dee6', tundra: '#b5c3cf', rock: '#56606b', snow: '#f7fbff', cloud: '#ffffff' },
  },
  ocean: {
    label: 'محيطي', sea: 0.42, mountain: 1.3, cloud: 0.68, atmos: 1.2, city: false,
    betaR: [3.6, 8.8, 23.0], betaM: 3.0, lava: 0, frozen: 0,
    c: { deep: '#031a40', shallow: '#0a8d9a', sand: '#e4d5a8', grass: '#2f8a3a', forest: '#145a28', desert: '#9aa05a', tundra: '#6f8a5f', rock: '#4a4a45', snow: '#f4f7fa', cloud: '#ffffff' },
  },
  lava: {
    label: 'بركاني', sea: 0.02, mountain: 1.3, cloud: 0.18, atmos: 1.4, city: false,
    betaR: [12.0, 4.5, 2.0], betaM: 9.0, lava: 1, frozen: 0,
    c: { deep: '#000000', shallow: '#000000', sand: '#2a1d18', grass: '#231a17', forest: '#1a1412', desert: '#33241c', tundra: '#2b211d', rock: '#181312', snow: '#3e3430', cloud: '#5b4b44' },
  },
  alien: {
    label: 'غريب', sea: 0.05, mountain: 1.1, cloud: 0.4, atmos: 1.1, city: true,
    betaR: [4.0, 16.0, 9.0], betaM: 2.0, lava: 0, frozen: 0,
    c: { deep: '#1b0a3a', shallow: '#0f8f7c', sand: '#d8c4e4', grass: '#7a3a9a', forest: '#3d1a5e', desert: '#c86a8a', tundra: '#8a7aa0', rock: '#3a3346', snow: '#e8f6f0', cloud: '#f0fff8' },
  },
};

// ---------------------------------------------------------------- UI
const ui = createShell({
  title: 'كوكب من العدم',
  scale: 'مقياس <bdi class="num">10<sup>7</sup></bdi> متر',
  hint: 'اسحب لتدور حول الكوكب، ومرّر العجلة لتقترب من السطح',
  readouts: [
    { key: 'alt', label: 'ارتفاعك عن البحر' },
    { key: 'name', label: 'رمز الكوكب' },
  ],
  controls: [
    { type: 'group', label: 'الكوكب' },
    { type: 'segmented', key: 'type', value: 'earth', options: Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label })) },
    { type: 'buttons', items: [
      { label: 'ولّد كوكباً جديداً', primary: true, action: () => newSeed() },
      { label: 'فاجئني', action: () => surprise() },
    ] },
    { type: 'range', key: 'sea', label: 'مستوى البحر', min: -0.6, max: 0.6, step: 0.005, value: 0.08, format: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
    { type: 'range', key: 'mountain', label: 'ارتفاع الجبال', min: 0, max: 1.6, step: 0.01, value: 1, format: (v) => `×${v.toFixed(2)}` },
    { type: 'range', key: 'cloud', label: 'الغيوم', min: 0, max: 1, step: 0.01, value: 0.5, format: (v) => `${Math.round(v * 100)}٪` },
    { type: 'range', key: 'atmos', label: 'كثافة الهواء', min: 0, max: 3, step: 0.01, value: 1, format: (v) => `×${v.toFixed(2)}` },
    { type: 'toggle', key: 'city', label: 'أضواء المدن في الليل', value: true },
    { type: 'group', label: 'الشمس' },
    { type: 'range', key: 'sun', label: 'موقع الشمس', min: 0, max: 360, step: 0.5, value: 140, format: (v) => `${Math.round(v)}°` },
    { type: 'toggle', key: 'sunMove', label: 'الشمس تتحرك', value: false },
    { type: 'group', label: 'الرحلة' },
    { type: 'buttons', items: [
      { label: 'انزل عند الغروب', primary: true, action: () => land() },
      { label: 'ارجع للمدار', action: () => toOrbit() },
    ] },
    { type: 'toggle', key: 'fly', label: 'حلّق للأمام', value: false },
    { type: 'toggle', key: 'auto', label: 'دوران تلقائي من المدار', value: true },
    { type: 'group', label: 'الجودة' },
    { type: 'segmented', key: 'quality', options: QUALITY_OPTIONS, value: 'auto' },
  ],
  onChange(key, v) {
    if (key === 'type') applyType(v, true);
    if (key === 'quality') { stage.setQuality(v); uniforms.uSteps.value = STEPS[v]; }
  },
  info: `
    <h2>كوكب بلا رسّام</h2>
    <p>لم يرسم أحد هذه القارات. كل جبل وساحل ونهر جليدي هنا يخرج من «الضوضاء المتماسكة»، وهي دالة رياضية تعطي قيماً عشوائية لكنها ناعمة ومتصلة. ابتكرها كين بيرلن لفيلم «ترون» عام ١٩٨٢، ونال عليها جائزة أوسكار تقنية عام ١٩٩٧، وهي اليوم وراء كل لعبة فيها عالم يتولّد تلقائياً.</p>
    <h3>من الضوضاء إلى قارات</h3>
    <p>طبقة ضوضاء واسعة ترسم القارات، وفوقها طبقات أدق فأدق، كل واحدة بنصف قوة السابقة وضعف تفاصيلها. هذا يشبه الطبيعة: الساحل يبدو متعرجاً من الفضاء، ويبقى متعرجاً إذا وقفت عليه. وللجبال نوع خاص اسمه «الضوضاء المحدّبة» يقلب القيم فيصنع قمماً حادة وسلاسل متصلة. وحتى لا تبدو القارات كبقع مستديرة، تُلوى إحداثيات الضوضاء بضوضاء أخرى، فتخرج أشكال ملتوية كالتي نراها على الخرائط.</p>
    <h3>لماذا السماء زرقاء والغروب برتقالي؟</h3>
    <p>جزيئات الهواء تشتّت الضوء الأزرق أكثر من الأحمر بنحو ست مرات، وهذا يسمى «تشتت رايلي». في النهار يصلك الأزرق المشتت من كل اتجاه فتبدو السماء زرقاء. عند الغروب يقطع ضوء الشمس طريقاً أطول بكثير داخل الهواء، فيضيع الأزرق في الطريق ولا يبقى إلا البرتقالي والأحمر. البرنامج يحسب هذا فعلاً لكل بكسل، ولهذا تجد الحافة الزرقاء الرقيقة حول الكوكب من الفضاء.</p>
    <p>في الكوكب الصحراوي عكسنا معاملات التشتت مع غبار كثيف، فصار النهار برتقالياً. وفي الكوكب الغريب يشتت الهواء الأخضر أكثر.</p>
    <h3>جرّب</h3>
    <ul>
      <li>اضغط «انزل عند الغروب» واترك الكاميرا تنزل بك فوق الجبال والشمس تغيب أمامك.</li>
      <li>ارفع «كثافة الهواء» إلى أقصاها وشاهد السماء تحمرّ.</li>
      <li>حرّك الشمس لتجعل وجهك على الجانب الليلي وترى أضواء المدن.</li>
      <li>اضغط «ولّد كوكباً جديداً» عدة مرات. لن يتكرر كوكب.</li>
    </ul>
  `,
});

const STEPS = { auto: 150, low: 100, medium: 140, high: 220 };

const stage = createStage({ bloom: { strength: 0.45, radius: 0.5, threshold: 1.8 }, exposure: 1.0, startScale: 0.6 });
if (!stage) { ui.fail(WEBGL_FAIL); throw new Error('WebGL2 unavailable'); }
const { renderer } = stage;
ui.loading('نولّد التضاريس…');

const noiseTex = makeNoise3D();

// Bake: a cube camera inside a box whose shader evaluates the terrain layers per direction.
const cubeRT = new THREE.WebGLCubeRenderTarget(512, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});
const bakeMat = new THREE.ShaderMaterial({
  vertexShader: BAKE_VS, fragmentShader: BAKE_FS, side: THREE.BackSide,
  uniforms: { uSeed: { value: new THREE.Vector3() }, uNoise: { value: noiseTex } },
});
const bakeScene = new THREE.Scene();
bakeScene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), bakeMat));
const cubeCam = new THREE.CubeCamera(0.1, 10, cubeRT);

const uniforms = {
  ...cameraUniforms(),
  uPixAngle: { value: 0.001 },
  uTerrain: { value: cubeRT.texture },
  uNoise: { value: noiseTex },
  uSun: { value: new THREE.Vector3(1, 0.3, 0.4) },
  uTime: { value: 0 },
  uSea: { value: 0.08 },
  uMountain: { value: 1 },
  uRMax: { value: 1.05 },
  uCloud: { value: 0.5 },
  uCloudTime: { value: 0 },
  uBetaR: { value: new THREE.Vector3() },
  uBetaM: { value: 6 },
  uCity: { value: 1 },
  uLava: { value: 0 },
  uFrozen: { value: 0 },
  uSeed: { value: new THREE.Vector3() },
  uSteps: { value: STEPS.auto },
  cDeep: { value: new THREE.Color() }, cShallow: { value: new THREE.Color() }, cSand: { value: new THREE.Color() },
  cGrass: { value: new THREE.Color() }, cForest: { value: new THREE.Color() }, cDesert: { value: new THREE.Color() },
  cTundra: { value: new THREE.Color() }, cRock: { value: new THREE.Color() }, cSnow: { value: new THREE.Color() },
  cCloud: { value: new THREE.Color() },
};
const quad = shaderQuad(FRAG, uniforms);
stage.setScene(quad.scene, quad.camera);

let seedNum = 0;
function bake(seed) {
  seedNum = seed;
  const r = mulberry32(seed);
  const s = new THREE.Vector3(r() * 200 - 100, r() * 200 - 100, r() * 200 - 100);
  bakeMat.uniforms.uSeed.value.copy(s);
  uniforms.uSeed.value.copy(s);
  cubeCam.update(renderer, bakeScene);
  const letters = 'ABCDEFGHKMNPRSTVXZ';
  ui.readout('name', ltr(`MR-${letters[seed % letters.length]}${(seed * 7919) % 9000 + 1000}`));
}
function newSeed() { bake(Math.floor(Math.random() * 1e9)); }
function surprise() {
  const keys = Object.keys(TYPES);
  ui.set('type', keys[Math.floor(Math.random() * keys.length)], { silent: true });
  applyType(ui.values.type, true);
  newSeed();
  ui.set('sun', Math.random() * 360, { silent: true });
}

function applyType(key, resetSliders) {
  const t = TYPES[key];
  for (const [k, v] of Object.entries(t.c)) uniforms['c' + k[0].toUpperCase() + k.slice(1)].value.copy(hex(v));
  uniforms.uLava.value = t.lava;
  uniforms.uFrozen.value = t.frozen;
  typeBeta = t;
  if (resetSliders) {
    ui.set('sea', t.sea, { silent: true });
    ui.set('mountain', t.mountain, { silent: true });
    ui.set('cloud', t.cloud, { silent: true });
    ui.set('atmos', t.atmos, { silent: true });
    ui.set('city', t.city, { silent: true });
  }
}
let typeBeta = TYPES.earth;
applyType('earth', false);
bake(20251008);

// Ground probe: renders the terrain height under the camera into one float pixel,
// so altitude can be measured above the ground instead of above sea level.
const probe = shaderQuad(PROBE_FS, {
  uTerrain: { value: cubeRT.texture }, uDir: { value: new THREE.Vector3() },
  uSea: { value: 0 }, uMountain: { value: 1 },
});
const probeRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
const probeBuf = new Float32Array(4);
function groundHeight(dir) {
  const u = probe.material.uniforms;
  u.uDir.value.copy(dir);
  u.uSea.value = ui.values.sea;
  u.uMountain.value = ui.values.mountain;
  renderer.setRenderTarget(probeRT);
  renderer.render(probe.scene, probe.camera);
  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
  renderer.setRenderTarget(null);
  return 0.035 * probeBuf[0];
}

// ---------------------------------------------------------------- camera: a frame that rides over the sphere
const camera = new THREE.PerspectiveCamera(50, 1, 0.0001, 100);
const nav = {
  up: new THREE.Vector3(0.35, 0.42, 0.84).normalize(),
  fwd: new THREE.Vector3(0, 1, 0),
  alt: 2.0, // above the ground
  ground: 0, // smoothed ground height under the camera
  vF: 0, vS: 0, vY: 0,
};
function orthonormalize() {
  nav.fwd.addScaledVector(nav.up, -nav.fwd.dot(nav.up));
  if (nav.fwd.lengthSq() < 1e-8) nav.fwd.set(1, 0, 0).addScaledVector(nav.up, -nav.up.x);
  nav.fwd.normalize();
}
orthonormalize();
const q = new THREE.Quaternion(), axis = new THREE.Vector3();
function moveForward(a) { axis.crossVectors(nav.up, nav.fwd).normalize(); q.setFromAxisAngle(axis, a); nav.up.applyQuaternion(q); nav.fwd.applyQuaternion(q); orthonormalize(); }
function moveSide(a) { q.setFromAxisAngle(nav.fwd, a); nav.up.applyQuaternion(q); orthonormalize(); }
function yaw(a) { q.setFromAxisAngle(nav.up, a); nav.fwd.applyQuaternion(q); orthonormalize(); }

let flight = null;
function flyNav(up1, fwd1, alt1, seconds) {
  flight = { t: 0, dur: seconds, up0: nav.up.clone(), fwd0: nav.fwd.clone(), alt0: nav.alt, up1, fwd1, alt1 };
}
function land({ sunElev = 0.012, alt = 0.0045, side = 0.32 * Math.min(camera.aspect, 1.4), seconds = 8 } = {}) {
  // Head for the terminator, facing the setting sun (a little off to one side).
  const L = sunDir();
  const upT = nav.up.clone().addScaledVector(L, -nav.up.dot(L)).normalize();
  if (upT.lengthSq() < 0.5) upT.set(0, 1, 0).addScaledVector(L, -L.y).normalize();
  const up1 = upT.clone().multiplyScalar(Math.cos(sunElev)).addScaledVector(L, Math.sin(sunElev)).normalize();
  const fwd1 = L.clone().addScaledVector(up1, -L.dot(up1)).normalize().applyAxisAngle(up1, side);
  ui.set('auto', false);
  flyNav(up1, fwd1, alt, seconds);
}
function toOrbit() {
  flyNav(nav.up.clone(), nav.fwd.clone(), 2.0, 4);
  ui.set('fly', false);
}

const canvas = stage.canvas;
const pointers = new Map();
let pinchDist = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  flight = null;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) zoomBy(pinchDist / d);
    pinchDist = d;
    return;
  }
  const k = (nav.alt / (1 + nav.alt)) * 2.2 / window.innerHeight;
  const near = 1 - THREE.MathUtils.smoothstep(nav.alt, 0.05, 0.5);
  nav.vF = dy * k;
  nav.vS = -dx * k * (1 - near);
  nav.vY = -dx * 0.0035 * near;
  moveForward(nav.vF); moveSide(nav.vS); yaw(nav.vY);
});
const endPointer = (e) => { pointers.delete(e.pointerId); pinchDist = 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
function zoomBy(f) { nav.alt = THREE.MathUtils.clamp(nav.alt * f, 0.003, 7); }
canvas.addEventListener('wheel', (e) => { e.preventDefault(); flight = null; zoomBy(Math.exp(e.deltaY * 0.0011)); }, { passive: false });

const look = new THREE.Vector3(), camUp = new THREE.Vector3(), lookNear = new THREE.Vector3(), target = new THREE.Vector3();
function placeCamera() {
  const f = 1 - THREE.MathUtils.smoothstep(nav.alt, 0.04, 0.7);
  const pitch = THREE.MathUtils.lerp(0.42, 0.1, 1 - THREE.MathUtils.smoothstep(nav.alt, 0.006, 0.06));
  lookNear.copy(nav.fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(nav.up, -Math.sin(pitch));
  look.copy(nav.up).negate().lerp(lookNear, f).normalize();
  camUp.copy(nav.fwd).lerp(nav.up, f).normalize();
  camera.position.copy(nav.up).multiplyScalar(1 + nav.ground + nav.alt);
  camera.up.copy(camUp);
  camera.lookAt(target.copy(camera.position).add(look));
}

function sunDir() {
  const a = THREE.MathUtils.degToRad(ui.values.sun);
  return new THREE.Vector3(Math.cos(a), 0.32, Math.sin(a)).normalize();
}

stage.onResize((bw, bh, w, h) => {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

window.__exhibit = { camera, nav, uniforms, ui, land, bake, placeCamera };

let time = 0, cloudTime = 0, roTimer = 0, first = true, probeTick = 0, groundTarget = 0;
stage.start((dt) => {
  const v = ui.values;
  time += dt;
  cloudTime += dt * 0.012;

  if (flight) {
    flight.t += dt;
    const k = ease(Math.min(flight.t / flight.dur, 1));
    nav.up.copy(flight.up0).lerp(flight.up1, k).normalize();
    nav.fwd.copy(flight.fwd0).lerp(flight.fwd1, k);
    orthonormalize();
    nav.alt = Math.exp(THREE.MathUtils.lerp(Math.log(flight.alt0), Math.log(flight.alt1), k));
    if (k >= 1) flight = null;
  } else if (!pointers.size) {
    // inertia
    nav.vF *= 0.92; nav.vS *= 0.92; nav.vY *= 0.9;
    if (Math.abs(nav.vF) + Math.abs(nav.vS) + Math.abs(nav.vY) > 1e-6) { moveForward(nav.vF); moveSide(nav.vS); yaw(nav.vY); }
    if (v.auto && nav.alt > 0.3) moveSide(-dt * 0.035);
    if (v.fly) { moveForward(dt * (0.05 + nav.alt * 0.6) * 0.25); yaw(Math.sin(time * 0.13) * dt * 0.05); }
  }
  // Follow the terrain when low. Reading a pixel back stalls the GPU a little, so only every few frames.
  if (nav.alt < 0.4) {
    if (++probeTick % 4 === 0) groundTarget = groundHeight(nav.up);
  } else groundTarget = 0;
  nav.ground += (groundTarget - nav.ground) * Math.min(1, dt * 5);
  placeCamera();

  if (v.sunMove) ui.set('sun', (v.sun + dt * 4) % 360, { silent: true });
  syncCamera(uniforms, camera);
  uniforms.uPixAngle.value = THREE.MathUtils.degToRad(camera.fov) / stage.size.y;
  uniforms.uSun.value.copy(sunDir());
  uniforms.uTime.value = time;
  uniforms.uCloudTime.value = cloudTime;
  uniforms.uSea.value = v.sea;
  uniforms.uMountain.value = v.mountain;
  uniforms.uRMax.value = 1 + 0.035 * (0.65 + 0.85 * v.mountain);
  uniforms.uCloud.value = v.cloud;
  uniforms.uCity.value = v.city ? 1 : 0;
  uniforms.uBetaR.value.fromArray(typeBeta.betaR).multiplyScalar(v.atmos);
  uniforms.uBetaM.value = typeBeta.betaM * v.atmos;
  stage.render();

  roTimer -= dt;
  if (roTimer <= 0) {
    roTimer = 0.25;
    // Altitude above sea level, in kilometres for an Earth-sized planet.
    const km = Math.max(camera.position.length() - 1 - 0.035 * ui.values.sea * 0.45, 0) * 6371;
    ui.readout('alt', km > 1000 ? `${Math.round(km).toLocaleString('en')} كم` : `${km.toFixed(km < 100 ? 1 : 0)} كم`);
  }
  if (first) { first = false; setTimeout(() => ui.ready(), 200); }
});
