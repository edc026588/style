// =====================================================================
// Strait Fire — first-person naval combat in the Taiwan Strait.
// Every model, texture and sound is generated in code; three.js does
// the rendering (physical sky, reflective ocean, PBR ships, bloom).
// =====================================================================
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
const V3 = THREE.Vector3;
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const $ = id => document.getElementById(id);
let seed = 1;
const srand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const setSeed = s => { seed = Math.max(1, s | 0); };

// Headings are radians clockwise from north. North is -Z, east is +X.
const fx = h => Math.sin(h), fz = h => -Math.cos(h);
const bearing = (x0, z0, x1, z1) => Math.atan2(x1 - x0, -(z1 - z0));
const deg360 = r => ((r / DEG) % 360 + 360) % 360;
const fmtBrg = r => String(Math.round(deg360(r)) % 360).padStart(3, '0');
const KN = 1.94384;

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s = 0, oct = 5) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f, s + i * 17); f *= 2.03; a *= 0.5; }
  return v;
}

/* ------------------------------------------------------------------ */
/* Renderer, camera, post-processing                                   */
/* ------------------------------------------------------------------ */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
// Graphics presets. 'auto' starts at High (Medium on phones and tablets) and steps down if the frame rate sags.
const GFX = {
  ultra: { label: 'Ultra', pr: 2, shadow: 4096, water: 1024, msaa: 4, bloom: true, shafts: 1 },
  high: { label: 'High', pr: 1.5, shadow: 2048, water: 512, msaa: 4, bloom: true, shafts: 1 },
  medium: { label: 'Medium', pr: 1, shadow: 1024, water: 256, msaa: 2, bloom: true, shafts: 0.8 },
  low: { label: 'Low', pr: 0.75, shadow: 0, water: 256, msaa: 0, bloom: false, shafts: 0 },
};
const GFX_ORDER = ['ultra', 'high', 'medium', 'low'];
const GFX_STATE = { mode: 'auto', level: window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high' };
try {
  const m = localStorage.getItem('straitfire3d-gfx'), a = localStorage.getItem('straitfire3d-gfx-auto');
  if (m === 'auto' || GFX[m]) GFX_STATE.mode = m;
  if (GFX[a] && a !== 'ultra') GFX_STATE.level = a;
} catch (e) { /* storage blocked */ }
if (GFX_STATE.mode !== 'auto') GFX_STATE.level = GFX_STATE.mode;
const gfxNow = () => GFX[GFX_STATE.level];
let pixelRatio = Math.min(window.devicePixelRatio || 1, gfxNow().pr);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.4;
renderer.shadowMap.enabled = gfxNow().shadow > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9fb4c4, 0.00004);
const camera = new THREE.PerspectiveCamera(68, 1, 0.3, 90000);
camera.rotation.order = 'YXZ';
scene.add(camera);

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) },
    scope: { value: 0 }, damage: { value: 0 }, flash: { value: 0 }, grain: { value: 0.03 },
    vignette: { value: 0.95 }, aberr: { value: 0.006 }, night: { value: 0 }, wet: { value: 0 },
    sunPos: { value: new THREE.Vector2(0.5, 0.5) }, sunVis: { value: 0 }, sunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    shafts: { value: 1 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time, scope, damage, flash, grain, vignette, aberr, night, wet; uniform vec2 res;
    uniform vec2 sunPos; uniform float sunVis, shafts; uniform vec3 sunCol;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 uv = vUv;
      // Rain drops running down the lens
      if (wet > 0.0) {
        vec2 g = vec2(uv.x * 22.0, uv.y * 9.0 + time * 0.6);
        vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float rnd = h(id);
        float drop = smoothstep(0.18, 0.0, length(f * vec2(1.0, 0.55) + vec2(0.0, rnd - 0.5) * 0.6)) * step(0.9, rnd);
        uv += f * drop * 0.008 * wet;
      }
      vec2 off = c * r2 * aberr * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      vec2 p = c * vec2(res.x / res.y, 1.0);
      // Sun glare: bloom halo, anamorphic streak and faint lens ghosts
      if (sunVis > 0.001) {
        vec2 dv = (vUv - sunPos) * vec2(res.x / res.y, 1.0);
        float dd = length(dv);
        vec3 gl = sunCol * (0.22 * exp(-dd * 22.0) + 0.025 * exp(-dd * 5.0));
        gl += sunCol * 0.07 * exp(-abs(dv.y) * 160.0) * exp(-abs(dv.x) * 2.6);
        vec2 axis = vec2(0.5) - sunPos;
        for (int i = 1; i <= 3; i++) {
          vec2 gp = sunPos + axis * (0.55 * float(i));
          float gd = length((vUv - gp) * vec2(res.x / res.y, 1.0));
          gl += sunCol * vec3(0.5, 0.8, 1.0) * 0.025 * smoothstep(0.05 + 0.025 * float(i), 0.0, gd);
        }
        col += gl * sunVis;
        // Crepuscular rays: march toward the sun gathering bright sky, so masts, smoke and cloud edges cut dark lanes
        if (shafts > 0.0) {
          vec2 dl = (sunPos - vUv) / 24.0;
          vec2 q = vUv + dl * h(vUv * res + fract(time) * 31.0);
          float acc = 0.0, wgt = 1.0;
          for (int i = 0; i < 24; i++) {
            q += dl;
            float b = max(dot(texture2D(tDiffuse, q).rgb, vec3(0.299, 0.587, 0.114)) - 0.62, 0.0);
            acc += b * wgt * exp(-length((q - sunPos) * vec2(res.x / res.y, 1.0)) * 5.0);
            wgt *= 0.96;
          }
          col += sunCol * acc * shafts * sunVis * 0.045;
        }
      }
      // Gentle filmic contrast and saturation
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);
      float lg = dot(col, vec3(0.299, 0.587, 0.114));
      col = max(mix(vec3(lg), col, 1.07), 0.0);
      float vig = smoothstep(1.15, 0.2, length(p) * vignette);
      col *= mix(0.5, 1.0, vig);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum) * vec3(0.78, 0.9, 1.18), night * 0.4);
      col += (h(vUv * res + fract(time) * vec2(97.0, 13.0)) - 0.5) * grain * (1.0 + night * 1.5);
      col = mix(col, col * vec3(1.4, 0.55, 0.5) + vec3(0.08, 0.0, 0.0), damage * (1.0 - vig * 0.5));
      col += flash;
      if (scope > 0.001) {
        float rr = 0.43;
        float d = min(length(p - vec2(-0.2, 0.0)), length(p - vec2(0.2, 0.0)));
        col *= mix(1.0, smoothstep(rr, rr - 0.015, d), scope);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const composerRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: gfxNow().msaa });
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.5, 0.9);
bloomPass.enabled = gfxNow().bloom;
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);
const GRADE = gradePass.uniforms;
GRADE.shafts.value = gfxNow().shafts;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  GRADE.res.value.set(w, h);
  const ov = $('overlay');
  ov.width = Math.round(w * Math.min(2, window.devicePixelRatio || 1));
  ov.height = Math.round(h * Math.min(2, window.devicePixelRatio || 1));
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/* Sky, clouds, ocean, light                                           */
/* ------------------------------------------------------------------ */
const sky = new Sky();
sky.scale.setScalar(50000);
sky.renderOrder = -10;
sky.material.depthWrite = false;
sky.material.depthTest = false;
scene.add(sky);
const SKY = sky.material.uniforms;
// After dark the scattering model leaves a flat grey; blend to a moonlit navy that lightens toward the horizon.
SKY.nightK = { value: 0 }; SKY.nightCol = { value: new THREE.Color(0.006, 0.0105, 0.024) }; SKY.moonDir = { value: new V3(0, 1, 0) };
function patchSky(mat) {
  mat.fragmentShader = mat.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float nightK; uniform vec3 nightCol, moonDir;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );',
      'vec3 nc = nightCol * (0.3 + 0.7 * pow(1.0 - max(direction.y, 0.0), 4.0)) + nightCol * 2.5 * pow(max(dot(direction, moonDir), 0.0), 24.0);\n' +
      ' retColor = mix(retColor, nc, nightK);\n gl_FragColor = vec4( retColor, 1.0 );');
  mat.needsUpdate = true;
}
patchSky(sky.material);

const CloudShader = {
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vDir = wp.xyz - cameraPosition;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float time, coverage, flash, dark;
    uniform vec3 sunDir, litCol, ambCol, hazeCol;
    varying vec3 vDir;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }
    void main(){
      vec3 d = normalize(vDir);
      if (d.y < 0.0) { gl_FragColor = vec4(hazeCol, 1.0); return; }
      float hz = d.y;
      float haze = 1.0 - smoothstep(0.0, 0.085, hz);
      vec2 p = d.xz / (hz + 0.07) * 0.75 + vec2(time * 0.004, time * 0.0017);
      float n = fbm(p);
      float cov = smoothstep(1.0 - coverage - 0.1, 1.0 - coverage + 0.24, n);
      float n2 = fbm(p + sunDir.xz * 0.15);
      float lightAmt = clamp(0.6 + (n - n2) * 3.2, 0.0, 1.0);
      float toSun = max(dot(d, sunDir), 0.0);
      vec3 col = mix(ambCol, litCol, lightAmt);
      col += litCol * pow(toSun, 12.0) * (1.0 - cov * 0.6) * 1.2;
      col *= mix(1.0, 0.55, dark * cov * smoothstep(0.45, 0.8, n));
      col += flash * vec3(0.9, 0.92, 1.0) * (0.4 + cov);
      float alpha = cov * smoothstep(0.0, 0.05, hz);
      col = mix(col, hazeCol, haze * 0.9);
      alpha = max(alpha, haze * 0.94);
      gl_FragColor = vec4(col, alpha);
    }`,
};
const cloudMat = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 0 }, coverage: { value: 0.3 }, flash: { value: 0 }, dark: { value: 0 },
    sunDir: { value: new V3(0, 1, 0) }, litCol: { value: new THREE.Color(1, 1, 1) },
    ambCol: { value: new THREE.Color(0.6, 0.6, 0.6) }, hazeCol: { value: new THREE.Color(0.6, 0.7, 0.8) },
  },
  vertexShader: CloudShader.vertexShader, fragmentShader: CloudShader.fragmentShader,
  side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: false,
  blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});
const clouds = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), cloudMat);
clouds.renderOrder = -8;
clouds.frustumCulled = false;
scene.add(clouds);

// Stars and moon for night missions. Stars carry their own colour and brightness and twinkle;
// a band of fainter ones traces the Milky Way, with its glow drawn on a dome just inside them.
// The band runs from the galactic core, low in the south-west, up almost overhead and down to the north-east.
const GALAXY_CORE = dirFrom(20, 218);
const GALAXY_N = GALAXY_CORE.clone().cross(dirFrom(74, 35)).normalize();
const GAL_U = GALAXY_CORE.clone(), GAL_W = GALAXY_N.clone().cross(GAL_U).normalize();
const stars = (() => {
  const base = 2600, band = 4200, n = base + band;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  setSeed(42);
  const d = new V3();
  for (let i = 0; i < n; i++) {
    if (i < base) { const a = srand() * TAU, y = Math.pow(srand(), 0.7), r = Math.sqrt(1 - y * y); d.set(Math.cos(a) * r, y, Math.sin(a) * r); }
    else {
      const a = srand() * TAU, off = Math.sqrt(-2 * Math.log(srand() + 1e-9)) * Math.cos(TAU * srand()) * 0.075;
      d.copy(GAL_U).multiplyScalar(Math.cos(a)).addScaledVector(GAL_W, Math.sin(a)).addScaledVector(GALAXY_N, off).normalize();
      if (d.y < -0.02) { i--; continue; }
    }
    pos[i * 3] = d.x * 30000; pos[i * 3 + 1] = d.y * 30000; pos[i * 3 + 2] = d.z * 30000;
    const m = Math.pow(srand(), i < base ? 5 : 9), b = (i < base ? 0.45 : 0.3) + m * 3.4, t = srand();
    const c = t < 0.12 ? [1, 0.74, 0.55] : t < 0.32 ? [1, 0.9, 0.78] : t < 0.85 ? [0.9, 0.94, 1] : [0.72, 0.82, 1];
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
    size[i] = (i < base ? 1.4 : 1.05) + m * 2.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('starCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('starSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0 }, time: { value: 0 }, pr: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 starCol; attribute float starSize; uniform float time, pr; varying vec3 vC; varying float vA;
      void main(){
        vec3 d = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float ph = fract(sin(dot(position.xz, vec2(0.0123, 0.0457))) * 4375.85);
        float ext = smoothstep(-0.02, 0.22, d.y);
        // Low stars twinkle hard and redden; high ones hold steady
        float tw = 1.0 - (0.12 + 0.3 * (1.0 - ext)) * (0.5 + 0.5 * sin(time * (2.0 + ph * 7.0) + ph * 40.0));
        vA = tw * ext;
        vC = starCol * mix(vec3(1.0, 0.75, 0.55), vec3(1.0), ext);
        gl_PointSize = starSize * pr * mix(0.75, 1.0, ext);
      }`,
    fragmentShader: /* glsl */`
      uniform float opacity; varying vec3 vC; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.08, r); gl_FragColor = vec4(vC, a * vA * opacity); }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m); p.renderOrder = -9; p.frustumCulled = false; p.visible = false; scene.add(p);
  // Layer 1 is seen by the main camera only, so stars stay out of the sea's reflection.
  p.layers.set(1); camera.layers.enable(1);
  return p;
})();
const milky = (() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(29000, 96, 48), new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0 }, gN: { value: GALAXY_N }, core: { value: GALAXY_CORE } },
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float opacity; uniform vec3 gN, core; varying vec3 vD;
      float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x){
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0)), f.x), f.y), f.z);
      }
      float fbm3(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n3(p); p = p * 2.07 + 3.1; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vD);
        float lat = dot(d, gN), c = max(dot(d, core), 0.0);
        float wdt = 0.09 + 0.07 * pow(c, 3.0);
        float band = exp(-lat * lat / (2.0 * wdt * wdt));
        float cl = fbm3(d * 7.0);
        // The dark rift: dust lanes along the middle of the band
        float dust = smoothstep(0.42, 0.72, fbm3(d * 14.0 + 7.0)) * exp(-pow(lat - 0.012, 2.0) / 0.0016);
        float glow = band * (0.12 + 1.5 * cl * cl) * (1.0 - 0.85 * dust) * (0.5 + 1.2 * pow(c, 4.0));
        vec3 col = mix(vec3(0.55, 0.62, 0.82), vec3(1.0, 0.84, 0.64), pow(c, 3.0)) * glow;
        gl_FragColor = vec4(col * 0.06 * smoothstep(-0.03, 0.3, d.y) * opacity, 1.0);
      }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  m.renderOrder = -9.5; m.frustumCulled = false; m.visible = false; m.layers.set(1); scene.add(m);
  return m;
})();
const moon = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.16, 'rgba(255,248,230,1)'); gr.addColorStop(0.19, 'rgba(200,210,235,0.35)');
  gr.addColorStop(0.5, 'rgba(120,140,190,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }));
  m.renderOrder = -9; m.visible = false; scene.add(m);
  return m;
})();

function makeWaterNormals() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  setSeed(7);
  // Wind-driven ripples: most energy travels within about 60 degrees of the wind, with fine capillary detail.
  const waves = [];
  for (let i = 0; i < 150; i++) {
    let kx, ky;
    do {
      const a = 0.6 + (srand() - 0.5) * 2.2, k = 2 + Math.pow(srand(), 1.5) * 54;
      kx = Math.round(Math.cos(a) * k); ky = Math.round(Math.sin(a) * k);
    } while (kx === 0 && ky === 0);
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: (0.5 + srand() * 0.5) / Math.pow(k, 1.1), p: srand() * TAU });
  }
  const str = 0.5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let dx = 0, dy = 0;
    for (const w of waves) {
      const cph = Math.cos(TAU * (w.kx * u + w.ky * v) + w.p);
      dx += w.a * w.kx * cph; dy += w.a * w.ky * cph;
    }
    let nx = -dx * str, ny = -dy * str, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * S + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  return t;
}

/* Swell: a few long waves shared by the ocean surface and the ships riding it. */
const SWELL = [
  { l: 132, a: 0.5, d: 0.45 }, { l: 91, a: 0.34, d: 0.8 }, { l: 63, a: 0.22, d: 0.2 }, { l: 41, a: 0.13, d: 1.15 }, { l: 27, a: 0.07, d: 0.55 },
].map((w, i) => ({ k: TAU / w.l, a: w.a, dx: Math.cos(w.d), dz: Math.sin(w.d), w: Math.sqrt(9.81 * TAU / w.l), ph: i * 1.7 }));
let swellAmp = 0.4;
function swellH(x, z) {
  let h = 0;
  for (const c of SWELL) h += c.a * swellAmp * Math.sin((c.dx * x + c.dz * z) * c.k - c.w * TIME + c.ph);
  return h;
}
// A polar grid: dense under the camera, sparse toward the horizon.
function oceanGeometry() {
  const R = 150, A = 192, pos = [0, 0, 0], idx = [];
  const kk = Math.log(12001) / (R - 1);
  for (let i = 0; i < R; i++) {
    const r = 3.4 * (Math.exp(i * kk) - 1) + 0.6;
    for (let j = 0; j < A; j++) { const a = j / A * TAU; pos.push(Math.cos(a) * r, Math.sin(a) * r, 0); }
  }
  for (let j = 0; j < A; j++) idx.push(0, 1 + j, 1 + (j + 1) % A);
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < A; j++) {
    const a = 1 + i * A + j, b = 1 + i * A + (j + 1) % A, c = a + A, d = b + A;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}
const water = new Water(oceanGeometry(), {
  textureWidth: gfxNow().water, textureHeight: gfxNow().water, waterNormals: makeWaterNormals(),
  sunDirection: new V3(0, 1, 0), sunColor: 0xffffff, waterColor: 0x0b3442, distortionScale: 3.0, fog: true,
});
water.rotation.x = -Math.PI / 2;
water.material.uniforms.size.value = 1.3;
// Real water reflects about 2% of light head-on (Fresnel F0), not 30%; and no constant grey floor.
water.material.fragmentShader = water.material.fragmentShader
  .replace('float rf0 = 0.3;', 'float rf0 = 0.025;')
  .replace('noise.xzy * vec3( 1.5, 1.0, 1.5 )', 'noise.xzy * vec3( 0.75, 1.0, 0.75 )')
  .replace('sunColor * diffuseLight * 0.3 + scatter', 'sunColor * diffuseLight * 0.025 + scatter')
  .replace('vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight', 'reflectionSample * 0.92 + specularLight * 0.55');
{
  const U = water.material.uniforms;
  U.swA = { value: SWELL.map(c => new THREE.Vector4(c.dx, c.dz, c.k, c.a)) };
  U.swW = { value: SWELL.map(c => c.w) };
  U.swT = { value: 0 };
  U.swAmp = { value: 0.4 }; U.foamAmt = { value: 0 }; U.foamLight = { value: 1 }; U.swQ = { value: 0.2 };
  const decl = 'uniform vec4 swA[5]; uniform float swW[5]; uniform float swT;\n';
  const fn = 'float swellH(vec2 p){ float h = 0.0; for (int i = 0; i < 5; i++) h += swA[i].w * sin(dot(swA[i].xy, p) * swA[i].z - swW[i] * swT + float(i) * 1.7); return h; }\n';
  water.material.vertexShader = water.material.vertexShader
    .replace('uniform mat4 textureMatrix;', decl + 'uniform float swQ;\nuniform mat4 textureMatrix;')
    .replace('void main() {', fn + 'void main() {\n vec4 wp0 = modelMatrix * vec4( position, 1.0 );\n vec3 pos = position;\n float fade = 1.0 - smoothstep(900.0, 3200.0, distance(wp0.xz, cameraPosition.xz));\n pos.z += swellH(wp0.xz) * fade;\n' +
      ' vec2 gd = vec2(0.0); for (int i = 0; i < 5; i++) { gd += swA[i].xy * (swQ / (swA[i].z * 5.0)) * cos(dot(swA[i].xy, wp0.xz) * swA[i].z - swW[i] * swT + float(i) * 1.7); }\n pos.x += gd.x * fade; pos.y -= gd.y * fade;')
    .replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );', 'mirrorCoord = modelMatrix * vec4( pos, 1.0 );')
    .replace('vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );', 'vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );');
  water.material.fragmentShader = water.material.fragmentShader
    .replace('uniform mat4 textureMatrix;', 'uniform mat4 textureMatrix;')
    .replace('uniform sampler2D mirrorSampler;', decl + 'uniform float swAmp; uniform float foamAmt; uniform float foamLight;\nuniform sampler2D mirrorSampler;')
    .replace('void main() {', fn + 'void main() {')
    .replace('vec3 outgoingLight = albedo;',
      'float dist2 = length(worldPosition.xz - eye.xz);\n' +
      ' float hgt = swellH(worldPosition.xz);\n' +
      ' float crest = smoothstep(swAmp * 0.5, swAmp * 1.15, hgt + noise.x * swAmp * 1.6);\n' +
      ' float foam = crest * foamAmt * (1.0 - smoothstep(500.0, 3500.0, dist2));\n' +
      ' float back = pow(max(dot(normalize(vec3(-eyeDirection.x, 0.0, -eyeDirection.z)), normalize(vec3(sunDirection.x, 0.0, sunDirection.z))), 0.0), 2.0);\n' +
      ' float ss = back * smoothstep(-swAmp * 0.2, swAmp, hgt) * (1.0 - smoothstep(800.0, 4000.0, dist2));\n' +
      ' albedo += vec3(0.01, 0.09, 0.075) * sunColor * ss * foamLight;\n' +
      ' albedo = mix(albedo, vec3(0.7, 0.74, 0.76) * foamLight, clamp(foam, 0.0, 0.85));\n' +
      ' vec3 outgoingLight = albedo;')
    .replace('vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );\n' +
      ' vec2 sg = vec2(0.0); for (int i = 0; i < 5; i++) { sg += swA[i].w * swA[i].z * swA[i].xy * cos(dot(swA[i].xy, worldPosition.xz) * swA[i].z - swW[i] * swT + float(i) * 1.7); }\n' +
      ' surfaceNormal = normalize(surfaceNormal + vec3(-sg.x, 0.0, -sg.y) * (1.0 - smoothstep(1500.0, 7000.0, length(worldPosition.xz - eye.xz))));');
}
water.material.needsUpdate = true;
scene.add(water);
const WATER = water.material.uniforms;
// Water.js keeps its reflection target private; catch it on first use so the quality setting can resize it.
let WATER_RT = null;
{
  const ob = water.onBeforeRender;
  water.onBeforeRender = function (r, s, c, ...rest) {
    if (WATER_RT) return ob.call(this, r, s, c, ...rest);
    const set = r.setRenderTarget;
    r.setRenderTarget = function (t, ...a) { if (t && !WATER_RT) WATER_RT = t; return set.call(this, t, ...a); };
    try { ob.call(this, r, s, c, ...rest); } finally { r.setRenderTarget = set; }
  };
}

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = gfxNow().shadow > 0;
sun.shadow.mapSize.setScalar(gfxNow().shadow || 1024);
Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 1500 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x1c2428, 0.5);
scene.add(hemi);

// A tiny scene used to bake the environment map and to sample the horizon colour.
const envScene = new THREE.Scene();
const skyEnv = new Sky(); skyEnv.material.uniforms = SKY; patchSky(skyEnv.material); skyEnv.scale.setScalar(60); envScene.add(skyEnv);
const cloudEnv = new THREE.Mesh(new THREE.SphereGeometry(45, 32, 16), cloudMat); envScene.add(cloudEnv);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const sampleRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
const sampleCam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

function sampleSky(azim, elev) {
  sampleCam.position.set(0, 0, 0);
  sampleCam.lookAt(Math.cos(elev) * Math.sin(azim), Math.sin(elev), -Math.cos(elev) * Math.cos(azim));
  const buf = new Float32Array(8 * 8 * 4);
  try {
    cloudEnv.visible = false;
    renderer.setRenderTarget(sampleRT);
    renderer.render(envScene, sampleCam);
    renderer.readRenderTargetPixels(sampleRT, 0, 0, 8, 8, buf);
  } catch (e) { /* float readback unsupported */ }
  renderer.setRenderTarget(null);
  cloudEnv.visible = true;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 64; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2]; }
  if (!(r + g + b > 0) || !isFinite(r + g + b)) return null;
  return new THREE.Color(r / 64, g / 64, b / 64);
}

/* Environment presets: time of day, weather and sea state. */
const ENV = {
  sunset:   { elev: 2.5, azim: 258, turb: 7, ray: 2.4, mie: 0.006, mieG: 0.88, exp: 0.42, fogD: 0.000042, clouds: 0.42, dark: 0.2, sea: 2.5, water: 0x082a36, sunCol: 0xffb07a, sunI: 2.2, light: 0.62, dist: 3.2 },
  dawn:     { elev: 5,   azim: 78,  turb: 5, ray: 2.0, mie: 0.005, mieG: 0.86, exp: 0.42, fogD: 0.00004,  clouds: 0.34, dark: 0.15, sea: 2, water: 0x0a3140, sunCol: 0xffc69c, sunI: 2.4, light: 0.7, dist: 3.0 },
  morning:  { elev: 30,  azim: 118, turb: 3.2, ray: 1.3, mie: 0.004, mieG: 0.8, exp: 0.3, fogD: 0.00003, clouds: 0.36, dark: 0.1, sea: 3, water: 0x0b3a4c, sunCol: 0xfff3e2, sunI: 3.2, light: 1.0, dist: 3.4 },
  overcast: { elev: 36,  azim: 205, turb: 12, ray: 0.7, mie: 0.02, mieG: 0.7, exp: 0.42, fogD: 0.0001, clouds: 0.94, dark: 0.75, sea: 5, water: 0x0d2a31, sunCol: 0xd6dbe0, sunI: 0.8, light: 0.72, dist: 4.2, rain: 0.35 },
  haze:     { elev: 19,  azim: 238, turb: 10, ray: 1.6, mie: 0.012, mieG: 0.85, exp: 0.33, fogD: 0.000062, clouds: 0.2, dark: 0.1, sea: 3, water: 0x0f3640, sunCol: 0xffe0b4, sunI: 2.8, light: 0.92, dist: 3.4 },
  night:    { elev: -16, azim: 300, moonElev: 26, moonAzim: 140, turb: 2, ray: 0.6, mie: 0.003, mieG: 0.8, exp: 1.35, fogD: 0.00005, clouds: 0.24, dark: 0.4, sea: 2, water: 0x020a0e, sunCol: 0x9fb6dc, sunI: 0.45, light: 0.12, dist: 3.0, stars: 1, night: 1 },
  squall:   { elev: 10,  azim: 250, turb: 8, ray: 1.5, mie: 0.011, mieG: 0.84, exp: 0.44, fogD: 0.00006, clouds: 0.68, dark: 0.45, sea: 4.5, water: 0x0b2d37, sunCol: 0xffc890, sunI: 1.9, light: 0.66, dist: 4.4, rain: 0.12 },
  storm:    { elev: 6,   azim: 262, turb: 9, ray: 1.1, mie: 0.02, mieG: 0.7, exp: 0.55, fogD: 0.00016, clouds: 0.97, dark: 0.85, sea: 6, water: 0x0a2125, sunCol: 0xc9a07a, sunI: 0.55, light: 0.45, dist: 5.0, rain: 1, lightning: 1 },
};
const SEA = { amp: 2, light: 1, night: 0, rain: 0, lightning: 0, preset: null };
const FOG_U = { color: { value: scene.fog.color }, density: { value: scene.fog.density } };
const lightDir = new V3(0, 1, 0);

function dirFrom(elevDeg, azimDeg) {
  const e = elevDeg * DEG, a = azimDeg * DEG;
  return new V3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

function applyEnv(name) {
  const E = ENV[name];
  SEA.preset = name; SEA.amp = E.sea; SEA.light = E.light; SEA.night = E.night || 0; SEA.rain = E.rain || 0; SEA.lightning = E.lightning || 0;
  const sunD = dirFrom(E.elev, E.azim);
  SKY.turbidity.value = E.turb; SKY.rayleigh.value = E.ray; SKY.mieCoefficient.value = E.mie; SKY.mieDirectionalG.value = E.mieG;
  SKY.sunPosition.value.copy(sunD);
  lightDir.copy(E.night ? dirFrom(E.moonElev, E.moonAzim) : sunD);
  SKY.nightK.value = E.night ? 1 : 0; SKY.moonDir.value.copy(lightDir);
  renderer.toneMappingExposure = E.exp;

  // Fog takes the colour of the sky just above the horizon, so the sea fades into it.
  const a = E.azim * DEG;
  const c1 = sampleSky(a + Math.PI / 2, 1.5 * DEG), c2 = sampleSky(a - Math.PI / 2, 1.5 * DEG), c3 = sampleSky(a + Math.PI, 1.5 * DEG);
  let hz = new THREE.Color(0x8fa3b3);
  if (c1 && c2 && c3) hz = c1.clone().add(c2).add(c3).multiplyScalar(1 / 3);
  const sunC = new THREE.Color(E.sunCol);
  if (E.night) hz = new THREE.Color(0.006, 0.009, 0.016);
  const overcastGrey = new THREE.Color().setScalar((hz.r + hz.g + hz.b) / 3);
  const fogC = hz.clone().lerp(overcastGrey, smooth(0.6, 1, E.clouds) * 0.6);
  scene.fog.color.copy(fogC);
  scene.fog.density = E.fogD;
  FOG_U.density.value = E.fogD;

  const U = cloudMat.uniforms;
  U.coverage.value = E.clouds; U.dark.value = E.dark;
  U.sunDir.value.copy(E.night ? lightDir : sunD);
  U.hazeCol.value.copy(fogC);
  if (E.night) {
    U.litCol.value.setRGB(0.02, 0.025, 0.04); U.ambCol.value.setRGB(0.008, 0.01, 0.016);
  } else {
    const warm = smooth(25, 2, E.elev);
    U.litCol.value.copy(fogC).multiplyScalar(1.35).lerp(sunC.clone().multiplyScalar(fogC.r * 2.2 + 0.05), 0.25 + warm * 0.35);
    U.ambCol.value.copy(fogC).multiplyScalar(0.82 - E.dark * 0.25);
  }

  WATER.sunDirection.value.copy(lightDir);
  FX_SUN.dir.value.copy(lightDir);
  FX_SUN.tint.value.copy(new THREE.Color(E.sunCol)).multiplyScalar(E.night ? 0.05 : (E.clouds > 0.9 ? 0.25 : 0.7) * E.light);
  WATER.sunColor.value.copy(sunC).multiplyScalar(E.night ? 0.35 : (E.clouds > 0.9 ? 0.25 : 1));
  WATER.waterColor.value.set(E.water);
  WATER.distortionScale.value = E.dist * 0.28;
  swellAmp = 0.11 * Math.pow(E.sea, 1.4);
  WATER.swAmp.value = swellAmp * 0.75;
  WATER.swQ.value = smooth(1.5, 6, E.sea) * 0.6;
  WATER.foamAmt.value = 0.08 + smooth(2, 6, E.sea) * 0.85;
  WATER.foamLight.value = E.night ? 0.12 : 0.3 + E.light * 0.7;
  WATER.size.value = 2.2 + E.sea * 0.15;

  sun.color.copy(sunC);
  sun.intensity = E.sunI;
  hemi.color.copy(E.night ? new THREE.Color(0x2a3550) : fogC.clone().multiplyScalar(1 / Math.max(0.05, fogC.getHSL({}).l * 1.6)));
  hemi.groundColor.set(E.night ? 0x05080c : 0x1a2226);
  hemi.intensity = E.night ? 0.35 : 1.0 * E.light;

  stars.visible = milky.visible = !!E.stars;
  stars.material.uniforms.opacity.value = E.stars ? 1 : 0;
  milky.material.uniforms.opacity.value = E.stars ? 1 : 0;
  moon.visible = !!E.night;
  if (E.night) moon.position.copy(lightDir).multiplyScalar(28000);

  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.02, 0.1, 200);
  scene.environment = envRT.texture;
  scene.environmentIntensity = E.night ? 0.45 : 1.7;
  GRADE.night.value = SEA.night;
  rainMesh.visible = SEA.rain > 0;
  rainMesh.material.opacity = 0.18 + SEA.rain * 0.2;
  GRADE.wet.value = SEA.rain;
}

// Rain streaks live in a box around the camera.
const RAIN_N = 3500;
const rainRel = new Float32Array(RAIN_N * 3);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_N * 6), 3).setUsage(THREE.DynamicDrawUsage));
const rainMesh = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xa9b7c4, transparent: true, opacity: 0.3, depthWrite: false }));
rainMesh.frustumCulled = false; rainMesh.visible = false; scene.add(rainMesh);
for (let i = 0; i < RAIN_N; i++) { rainRel[i * 3] = rand(-70, 70); rainRel[i * 3 + 1] = rand(-30, 50); rainRel[i * 3 + 2] = rand(-70, 70); }
function updateRain(dt) {
  if (!rainMesh.visible) return;
  const p = rainGeo.attributes.position.array, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const fall = 26 * dt, wx = 5 * SEA.rain;
  for (let i = 0; i < RAIN_N; i++) {
    const k = i * 3;
    rainRel[k + 1] -= fall; rainRel[k] += wx * dt;
    if (rainRel[k + 1] + cy < 0 || rainRel[k + 1] < -30) { rainRel[k] = rand(-70, 70); rainRel[k + 1] = rand(20, 50); rainRel[k + 2] = rand(-70, 70); }
    if (rainRel[k] > 70) rainRel[k] -= 140;
    const x = cx + rainRel[k], y = cy + rainRel[k + 1], z = cz + rainRel[k + 2];
    p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
    p[i * 6 + 3] = x - wx * 0.05; p[i * 6 + 4] = y + 1.1; p[i * 6 + 5] = z;
  }
  rainGeo.attributes.position.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* Procedural textures                                                 */
/* ------------------------------------------------------------------ */
function canvasTex(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function speckle(g, w, h, n, col, a0, a1, r0 = 1, r1 = 3) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${col},${rand(a0, a1)})`;
    g.fillRect(rand(w), rand(h), rand(r0, r1), rand(r0, r1));
  }
}
// Hull sides: v = 0.25 + y/16 puts the waterline at a fixed row.
function hullTex(base, merchant = false) {
  const t = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const s = randi(-12, 12); g.fillStyle = `rgba(${128 + s},${128 + s},${128 + s},0.07)`; g.fillRect(rand(w), rand(h * 0.1, h * 0.72), rand(20, 120), rand(10, 50)); }
    g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 48) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h * 0.75); g.stroke(); }
    for (const yy of [0.28, 0.46]) { g.beginPath(); g.moveTo(0, h * yy); g.lineTo(w, h * yy); g.stroke(); }
    for (let i = 0; i < 260; i++) {
      const x = rand(w), y0 = rand(h * 0.04, h * 0.6), len = rand(8, 90);
      const gr = g.createLinearGradient(x, y0, x, y0 + len);
      const rust = Math.random() < 0.55;
      gr.addColorStop(0, rust ? 'rgba(96,58,32,0.38)' : 'rgba(30,32,30,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y0, rand(0.8, 2.6), len);
    }
    speckle(g, w, h, 1800, '20,22,22', 0.05, 0.15);
    // boot-top and anti-fouling below the waterline (bottom quarter of the texture)
    g.fillStyle = merchant ? '#7a1e18' : '#5c2420'; g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = '#16181a'; g.fillRect(0, h * 0.72, w, h * 0.065);
    const wl = g.createLinearGradient(0, h * 0.55, 0, h * 0.72);
    wl.addColorStop(0, 'rgba(40,45,40,0)'); wl.addColorStop(1, 'rgba(40,45,40,0.35)');
    g.fillStyle = wl; g.fillRect(0, h * 0.55, w, h * 0.17);
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function supTex(base) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) { const s = randi(-10, 10); g.fillStyle = `rgba(${128 + s},${128 + s},${128 + s},0.08)`; g.fillRect(rand(w), rand(h), rand(20, 90), rand(10, 60)); }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
    for (let i = 0; i < 70; i++) {
      const x = rand(w), y0 = rand(h * 0.2), len = rand(10, 80);
      const gr = g.createLinearGradient(x, y0, x, y0 + len);
      gr.addColorStop(0, 'rgba(70,50,35,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y0, rand(1, 2), len);
    }
    speckle(g, w, h, 500, '20,20,20', 0.04, 0.1);
  }, { repeat: true });
}
function deckTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#656b6e'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, '15,17,18', 0.08, 0.2, 1, 2);
    speckle(g, w, h, 5000, '150,155,155', 0.04, 0.1, 1, 2);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,112,108,${rand(0.04, 0.1)})`; g.beginPath(); g.ellipse(rand(w), rand(h), rand(20, 80), rand(10, 40), rand(TAU), 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < h; y += 128) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
  }, { repeat: true });
}
function vlsTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3b4043'; g.fillRect(0, 0, w, h);
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = '#50565a'; g.fillRect(i * s + 6, j * s + 6, s - 12, s - 12);
      g.strokeStyle = '#25292b'; g.lineWidth = 3; g.strokeRect(i * s + 6, j * s + 6, s - 12, s - 12);
      g.fillStyle = '#2b2f31'; g.beginPath(); g.arc(i * s + s / 2, j * s + s / 2, 5, 0, TAU); g.fill();
    }
    speckle(g, w, h, 800, '20,20,20', 0.05, 0.15);
  }, { repeat: true });
}
function heliTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3c4446'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 6000, '20,20,20', 0.05, 0.2);
    g.strokeStyle = 'rgba(235,235,225,0.85)'; g.lineWidth = 10;
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.3, 0, TAU); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2, 10); g.lineTo(w / 2, h - 10); g.stroke();
    g.strokeStyle = 'rgba(230,200,60,0.8)'; g.lineWidth = 4; g.strokeRect(12, 12, w - 24, h - 24);
  });
}
function carrierDeckTex(num) {
  return canvasTex(2048, 512, (g, w, h) => {
    g.fillStyle = '#3d4244'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 30000, '20,22,24', 0.05, 0.18, 1, 3);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(20,20,20,${rand(0.05, 0.15)})`; g.fillRect(rand(w), rand(h * 0.2, h * 0.8), rand(80, 300), rand(4, 14)); }
    g.strokeStyle = 'rgba(240,240,230,0.85)'; g.lineWidth = 5;
    g.setLineDash([60, 40]);
    g.beginPath(); g.moveTo(w * 0.05, h * 0.5); g.lineTo(w * 0.97, h * 0.5); g.stroke();
    g.beginPath(); g.moveTo(w * 0.05, h * 0.62); g.lineTo(w * 0.6, h * 0.2); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(240,240,230,0.7)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(w * 0.05, h * 0.88); g.lineTo(w * 0.62, h * 0.32); g.stroke();
    g.beginPath(); g.moveTo(w * 0.05, h * 0.38); g.lineTo(w * 0.58, h * 0.08); g.stroke();
    g.strokeStyle = 'rgba(230,210,70,0.75)'; g.lineWidth = 3;
    for (const yy of [0.42, 0.58]) { g.beginPath(); g.moveTo(w * 0.7, h * yy); g.lineTo(w * 0.98, h * yy); g.stroke(); }
    g.save(); g.translate(w * 0.9, h * 0.5); g.rotate(Math.PI / 2);
    g.fillStyle = 'rgba(240,240,230,0.85)'; g.font = 'bold 150px "Saira Stencil One", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(num, 0, 0); g.restore();
  });
}
function numberTex(text) {
  return canvasTex(512, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 128px "Saira Stencil One", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(20,20,20,0.85)'; g.fillText(text, w / 2 + 6, h / 2 + 6);
    g.fillStyle = '#f2f2ea'; g.fillText(text, w / 2, h / 2);
    g.globalCompositeOperation = 'destination-out';
    speckle(g, w, h, 900, '0,0,0', 0.2, 0.6, 1, 3);
  });
}
function radialTex(stops, size = 128) {
  return canvasTex(size, size, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }, { srgb: false });
}
function puffTex() {
  return canvasTex(128, 128, (g, w) => {
    for (let i = 0; i < 22; i++) {
      const r = rand(14, 34), a = rand(TAU), d = rand(0, 30);
      const x = w / 2 + Math.cos(a) * d, y = w / 2 + Math.sin(a) * d;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    const img = g.getImageData(0, 0, w, w), d = img.data;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, n = fbm(x / 18, y / 18, 3, 4);
      const edge = 1 - smooth(0.3, 0.5, Math.hypot(x - w / 2, y - w / 2) / w);
      d[i + 3] = d[i + 3] * (0.55 + n * 0.9) * edge;
      d[i] = d[i + 1] = d[i + 2] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
function sprayTex() {
  return canvasTex(128, 128, (g, w) => {
    for (let i = 0; i < 260; i++) {
      const a = rand(TAU), d = Math.pow(Math.random(), 0.7) * 54, r = rand(1, 5);
      const x = w / 2 + Math.cos(a) * d, y = w / 2 + Math.sin(a) * d;
      g.fillStyle = `rgba(255,255,255,${rand(0.15, 0.6)})`; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }, { srgb: false });
}
function fireTex() {
  return canvasTex(128, 128, (g, w) => {
    const img = g.createImageData(w, w), d = img.data;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = Math.hypot(x - w / 2, y - w / 2) / (w / 2);
      const n = fbm(x / 14, y / 14, 9, 4);
      const a = clamp((1 - r) * 1.6 * (0.5 + n), 0, 1);
      d[i] = 255; d[i + 1] = 200 + 55 * (1 - r); d[i + 2] = 150 * (1 - r); d[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
function flashTex() {
  return canvasTex(128, 128, (g, w) => {
    g.translate(w / 2, w / 2);
    for (let i = 0; i < 9; i++) {
      g.rotate(TAU / 9 + rand(-0.2, 0.2));
      const gr = g.createLinearGradient(0, 0, w / 2, 0);
      gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -5); g.lineTo(rand(40, 64), 0); g.lineTo(0, 5); g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill();
  }, { srgb: false });
}
function foamTex(edges) {
  return canvasTex(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < (edges ? 900 : 2200); i++) {
      const y = edges ? (Math.random() < 0.5 ? rand(0, h * 0.18) : rand(h * 0.82, h)) : h / 2 + (Math.random() - 0.5) * h * Math.pow(Math.random(), 0.6);
      g.fillStyle = `rgba(255,255,255,${rand(0.08, 0.45)})`;
      g.fillRect(rand(w), y, rand(4, 26), rand(1, 3));
    }
  }, { srgb: false, repeat: true });
}
function noiseTex() {
  return canvasTex(256, 256, (g, w) => {
    const img = g.createImageData(w, w), d = img.data;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, n = 150 + fbm(x / 16, y / 16, 5, 5) * 105;
      d[i] = d[i + 1] = d[i + 2] = n; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
}

// Battle damage: a torn hole, burnt primer at the rim, soot rising above it and rust weeping below.
function scarTex(big) {
  return canvasTex(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    const c = w / 2, hole = big ? w * 0.11 : w * 0.1;
    const blot = (x, y, R, col, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
    };
    // Soot: blotchy, heavier above the hole where the smoke went
    for (let i = 0; i < (big ? 90 : 50); i++) {
      const a = rand(TAU), r = Math.pow(Math.random(), 0.8) * w * 0.32;
      const x = c + Math.cos(a) * r * 0.9, y = c + Math.sin(a) * r - (Math.sin(a) < 0 ? r * 0.25 : 0);
      blot(x, y, rand(w * 0.05, w * 0.15), '14,12,10', rand(0.3, 0.6));
    }
    blot(c, c - hole * 0.6, hole * 3.4, '12,10,9', 0.8);
    for (let i = 0; i < 9; i++) { const x = c + rand(-w * 0.18, w * 0.18); blot(x, c - rand(w * 0.15, w * 0.3), rand(w * 0.07, w * 0.12), '10,9,8', rand(0.15, 0.3)); }
    // Paint burnt back to grey primer, then a scorched brown ring at the rim
    for (let i = 0; i < 26; i++) { const a = rand(TAU), r = hole * rand(1.2, 2.2); blot(c + Math.cos(a) * r, c + Math.sin(a) * r, rand(5, 12), '120,112,100', rand(0.15, 0.35)); }
    blot(c, c, hole * 2, '70,38,18', 0.85);
    // Rust weeping down from the wound
    for (let i = 0; i < (big ? 9 : 5); i++) {
      const x = c + rand(-hole, hole), len = rand(w * 0.1, w * 0.32), wd = rand(1.5, 4);
      const gr = g.createLinearGradient(0, c, 0, c + len);
      gr.addColorStop(0, 'rgba(96,46,20,0.75)'); gr.addColorStop(1, 'rgba(96,46,20,0)');
      g.fillStyle = gr; g.fillRect(x, c, wd, len);
    }
    // The hole: jagged, black, with curled plating catching the light
    g.beginPath();
    for (let i = 0; i <= 22; i++) { const a = i / 22 * TAU, r = hole * (i % 2 ? rand(0.55, 0.85) : rand(0.9, 1.25)); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = 'rgba(4,4,4,1)'; g.fill();
    g.strokeStyle = 'rgba(150,140,128,0.55)'; g.lineWidth = 1.5; g.stroke();
    speckle(g, w, w, big ? 260 : 140, '20,18,16', 0.2, 0.6, 1, 3);
    // Fade everything to nothing at the edge so the decal never shows a square
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createRadialGradient(c, c, w * 0.25, c, c, w * 0.5);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade; g.fillRect(0, 0, w, w);
    g.globalCompositeOperation = 'source-over';
  });
}

function flagTex(nation) {
  return canvasTex(192, 128, (g, w, h) => {
    if (nation === 'ROC') {
      g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0a2b8c'; g.fillRect(0, 0, w / 2, h / 2);
      g.fillStyle = '#ffffff';
      const cx = w / 4, cy = h / 4;
      g.beginPath();
      for (let i = 0; i < 24; i++) { const a = i / 24 * TAU - Math.PI / 2, r = i % 2 ? 11 : 22; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.fill();
      g.fillStyle = '#0a2b8c'; g.beginPath(); g.arc(cx, cy, 10, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 8.5, 0, TAU); g.fill();
    } else if (nation === 'PRC') {
      g.fillStyle = '#de2910'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffde00';
      const star = (x, y, r, rot) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = rot + i / 10 * TAU - Math.PI / 2, rr = i % 2 ? r * 0.38 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
      star(w / 6, h / 4, 19, 0);
      [[w / 3, h / 10], [w * 0.4, h / 5], [w * 0.4, h * 0.35], [w / 3, h * 0.45]].forEach(([x, y]) => star(x, y, 6.5, 0.4));
    } else if (nation === 'US') {
      for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#b22234'; g.fillRect(0, i * h / 13, w, h / 13 + 1); }
      g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, w * 0.4, h * 7 / 13);
      g.fillStyle = '#ffffff';
      for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) { g.beginPath(); g.arc(6 + c * 12.5 + (r % 2 ? 6 : 0), 5 + r * 7.2, 1.6, 0, TAU); g.fill(); }
    } else {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#bc002d'; g.beginPath(); g.arc(w / 2, h / 2, h * 0.3, 0, TAU); g.fill();
    }
  });
}
// The flag hoists at x = 0 and streams aft; a vertex shader makes it ripple.
const FLAG_GEO = new THREE.PlaneGeometry(3.6, 2.4, 14, 6).translate(-1.8, 0, 0);
const FLAG_T = { value: 0 };
const FLAG_MATS = {};
function flagMat(nation) {
  if (!FLAG_MATS[nation]) {
    const m = new THREE.MeshStandardMaterial({ map: flagTex(nation), side: THREE.DoubleSide, roughness: 0.85 });
    m.onBeforeCompile = sh => {
      sh.uniforms.flagT = FLAG_T;
      sh.vertexShader = 'uniform float flagT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nfloat fk = -position.x / 3.6;\ntransformed.z += (sin(position.x * 1.9 + flagT * 7.0) * 0.22 + sin(position.x * 3.7 + flagT * 11.0) * 0.08) * fk;\ntransformed.y -= fk * fk * 0.25;');
    };
    FLAG_MATS[nation] = m;
  }
  return FLAG_MATS[nation];
}
// Height field of welded hull plates and frames, turned into a normal map.
function plateNormalTex() {
  const S = 512, hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = x % 64, py = y % 96;
    const seam = Math.min(px, 64 - px, py, 96 - py);
    const groove = -0.9 * Math.exp(-seam * seam / 3);
    const bulge = 0.35 * Math.sin(Math.PI * px / 64) * Math.sin(Math.PI * py / 96);
    hgt[y * S + x] = groove + bulge + (fbm(x / 9, y / 9, 41, 3) - 0.5) * 0.25;
  }
  return canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + (x + 1) % S] - hgt[y * S + (x + S - 1) % S];
      const hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      let nx = -hx * 1.2, ny = hy * 1.2, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * S + x) * 4; d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false, repeat: true });
}
const TEX = {};
function makeTextures() {
  setSeed(11);
  TEX.hull = { light: hullTex('#a7afb3'), mid: hullTex('#8c9499'), dark: hullTex('#747c81'), black: hullTex('#26292b', true), navy: hullTex('#9aa2a6') };
  TEX.sup = { light: supTex('#b4bcc0'), mid: supTex('#979fa4'), dark: supTex('#81898e'), black: supTex('#e8e6df'), navy: supTex('#a8b0b4') };
  TEX.deck = deckTex(); TEX.vls = vlsTex(); TEX.heli = heliTex();
  TEX.cv = { '73': carrierDeckTex('73'), '18': carrierDeckTex('18') };
  TEX.smoke = puffTex(); TEX.spray = sprayTex(); TEX.fire = fireTex(); TEX.flash = flashTex();
  TEX.dot = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']], 64);
  TEX.hullFoam = canvasTex(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      const v = Math.pow(Math.random(), 1.8);
      g.fillStyle = `rgba(255,255,255,${(1 - v) * rand(0.2, 0.7)})`;
      g.fillRect(rand(w), (1 - v) * h - 2, rand(3, 18), rand(1, 3));
    }
  }, { srgb: false, repeat: true });
  TEX.hullFoam.wrapT = THREE.ClampToEdgeWrapping;
  TEX.foam = foamTex(false); TEX.kelvin = foamTex(true); TEX.noise = noiseTex(); TEX.plates = plateNormalTex();
}


/* ------------------------------------------------------------------ */
/* Materials and geometry helpers                                      */
/* ------------------------------------------------------------------ */
const MAT = {};
const PAINT = {};
function stdMat(o) { return new THREE.MeshStandardMaterial(o); }
function makeMaterials() {
  for (const k of ['light', 'mid', 'dark', 'black', 'navy']) {
    const sup = stdMat({ map: TEX.sup[k], roughness: 0.55, metalness: 0.25 });
    sup.userData.tri = 12;
    PAINT[k] = { hull: stdMat({ userData: {}, map: TEX.hull[k], normalMap: TEX.plates, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }), sup };
    sup.normalMap = TEX.plates; sup.normalScale = new THREE.Vector2(0.3, 0.3);
    PAINT[k].hull.userData.hull = true;
  }
  MAT.deck = stdMat({ map: TEX.deck, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide });
  MAT.dark = stdMat({ color: 0x2b2f32, roughness: 0.6, metalness: 0.45 });
  MAT.black = stdMat({ color: 0x141618, roughness: 0.85, metalness: 0.2 });
  MAT.panel = stdMat({ color: 0x36414a, roughness: 0.28, metalness: 0.7 });
  MAT.glass = stdMat({ color: 0x0a1014, roughness: 0.05, metalness: 0.9 });
  MAT.white = stdMat({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.1 });
  MAT.metal = stdMat({ color: 0x697075, roughness: 0.4, metalness: 0.75 });
  MAT.vls = stdMat({ map: TEX.vls, roughness: 0.7, metalness: 0.3 });
  MAT.heli = stdMat({ map: TEX.heli, roughness: 0.85 });
  MAT.orange = stdMat({ color: 0xc7531c, roughness: 0.6 });
  MAT.green = stdMat({ color: 0x56604c, roughness: 0.7, metalness: 0.2 });
  MAT.red = stdMat({ color: 0x8e2a22, roughness: 0.6 });
  MAT.sub = stdMat({ color: 0x1a1c1e, roughness: 0.8, metalness: 0.15 });
  MAT.containers = [0x9b3b2c, 0x2d5a8c, 0x3f7a4a, 0xb08a2e, 0x6f6f6f, 0x8a4a7a, 0xc9c4b8, 0x225a5a].map(c => stdMat({ color: c, roughness: 0.75, metalness: 0.3 }));
  MAT.jet = { PLA: stdMat({ color: 0x9aa6ae, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide }), ALLIED: stdMat({ color: 0x737c83, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide }) };
  MAT.missile = stdMat({ color: 0xe4e4dc, roughness: 0.5, metalness: 0.3 });
  MAT.cv = { '73': stdMat({ map: TEX.cv['73'], roughness: 0.85, metalness: 0.1 }), '18': stdMat({ map: TEX.cv['18'], roughness: 0.85, metalness: 0.1 }) };
  MAT.wakeFoam = new THREE.MeshBasicMaterial({ map: TEX.foam, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4 });
  MAT.wakeKelvin = new THREE.MeshBasicMaterial({ map: TEX.kelvin, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4 });
}

function triplanarUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s);
    else if (ax >= az) uv.setXY(i, p.getZ(i) / s, p.getY(i) / s);
    else uv.setXY(i, p.getX(i) / s, p.getY(i) / s);
  }
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m4 = new THREE.Matrix4();
// Builder meshes carry baked vertex shading, so they use vertex-colour twins of the shared materials.
const AO_MATS = new Map();
function aoMat(m) {
  if (!AO_MATS.has(m)) { const c = m.clone(); c.vertexColors = true; c.userData = { ...m.userData }; AO_MATS.set(m, c); }
  return AO_MATS.get(m);
}
class Builder {
  constructor() { this.parts = new Map(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _m4.compose(new V3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YZX')), new V3(sx, sy, sz));
    return this.addM(geo, mat, _m4);
  }
  addM(geo, mat, m) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (mat.userData.tri) triplanarUV(g, mat.userData.tri);
    // Baked shading: parts darken toward their base (contact occlusion); hulls get a wet band at the waterline.
    const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
    g.computeBoundingBox();
    const y0 = g.boundingBox.min.y, h = Math.max(0.01, g.boundingBox.max.y - y0);
    const hull = mat.userData.hull, flat = mat === MAT.deck || mat.userData.noAO;
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i);
      let c = 1;
      if (hull) c = lerp(0.58, 1, smooth(-0.4, 1.4, y)) * lerp(0.9, 1, smooth(1.4, 6, y));
      else if (!flat) c = lerp(0.5, 1, smooth(y0, y0 + Math.min(1.8, h * 0.45), y)) * lerp(0.88, 1, smooth(y0, y0 + h, y));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  build(group, { cast = true, receive = true } = {}) {
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), aoMat(mat));
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      group.add(mesh);
    }
    return group;
  }
}

// Box with its base at y = 0 whose top is pulled in: the sloped sides of stealthy superstructures.
function taperBox(l, h, w, tz = 0, tx = 0) {
  const g = new THREE.BoxGeometry(l, h, w);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (1 - tx)); p.setZ(i, p.getZ(i) * (1 - tz)); }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}
const cyl = (r0, r1, h, s = 12) => new THREE.CylinderGeometry(r0, r1, h, s);
// Cylinder lying along +X, starting at x = 0.
function rod(r0, r1, len, s = 10) { const g = cyl(r1, r0, len, s); g.rotateZ(-Math.PI / 2); g.translate(len / 2, 0, 0); return g; }

/* ------------------------------------------------------------------ */
/* Hull lofting                                                        */
/* ------------------------------------------------------------------ */
function hullProfile(L, B, D, F, o = {}) {
  const sheer = o.sheer ?? 2.5, tr = o.transom ?? 0.8, fine = o.fine ?? 0.55, rake = o.rake ?? L * 0.045, flare = o.flare ?? 0.55;
  const cosp = (t, e) => Math.pow(Math.cos((t - fine) / (1 - fine) * Math.PI / 2), e);
  const wl = t => (t < 0.05 ? B / 2 * (tr + (1 - tr) * t / 0.05) : t < fine ? B / 2 : B / 2 * cosp(t, 0.95));
  const dk = t => (t < 0.05 ? B / 2 * 1.02 * (tr + (1 - tr) * t / 0.05) : t < fine ? B / 2 * 1.02 : B / 2 * 1.02 * cosp(t, flare));
  const fb = t => F + sheer * Math.pow(t, 2.2);
  const kd = t => D * (t > 0.86 ? 1 - smooth(0.86, 1, t) * 0.92 : t < 0.07 ? 0.5 + 0.5 * t / 0.07 : 1);
  const tAt = x => clamp((x + L / 2) / L, 0, 1);
  return { L, B, D, F, wl, dk, fb, kd, rake, tAt, deckAt: x => fb(tAt(x)) };
}
function hullGeo(P) {
  const { L, wl, dk, fb, kd, rake } = P;
  const N = 52, R = 11, pos = [], uv = [], idx = [], dpos = [], duv = [], didx = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), x = -L / 2 + t * L;
    const b = wl(t), bd = dk(t), f = fb(t), k = kd(t);
    const half = [[bd, f], [lerp(b, bd, 0.6), f * 0.5], [b, 0], [b * 0.97, -k * 0.45], [b * 0.72, -k * 0.88], [0, -k]];
    const ring = [];
    for (let j = 0; j < 6; j++) ring.push([-half[j][0], half[j][1]]);
    for (let j = 4; j >= 0; j--) ring.push([half[j][0], half[j][1]]);
    const s = smooth(0.84, 1, t);
    for (const [z, y] of ring) {
      const xs = x - rake * s * (1 - (y + k) / (f + k));
      pos.push(xs, y, z); uv.push(xs / 30, 0.25 + y / 16);
    }
    dpos.push(x, f, -bd, x, f + 0.25, 0, x, f, bd);
    duv.push(x / 10, -bd / 10, x / 10, 0, x / 10, bd / 10);
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < R - 1; j++) { const a = i * R + j, b = a + 1, c = a + R, d = c + 1; idx.push(a, c, b, b, c, d); }
    for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1; didx.push(a, b, c, b, d, c); }
  }
  // Transom: its own vertices so the stern keeps a crisp edge.
  const base = pos.length / 3;
  for (let j = 0; j < R; j++) { pos.push(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]); uv.push(pos[j * 3 + 2] / 30, 0.25 + pos[j * 3 + 1] / 16); }
  pos.push(-L / 2, (fb(0) - kd(0)) / 2, 0); uv.push(0, 0.25 + (fb(0) - kd(0)) / 32);
  for (let j = 0; j < R - 1; j++) idx.push(base + R, base + j + 1, base + j);
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hull.setIndex(idx); hull.computeVertexNormals();
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  deck.setIndex(didx); deck.computeVertexNormals();
  return { hull, deck };
}

/* ------------------------------------------------------------------ */
/* Fittings                                                            */
/* ------------------------------------------------------------------ */
function buildGun(type, mats) {
  const obj = new THREE.Group(), pivot = new THREE.Group(), B = new Builder(), BB = new Builder();
  const S = {
    mk45: { l: 4.8, h: 2.2, w: 3.5, tz: 0.3, tx: 0.42, bl: 7.2, br: 0.13, py: 1.25, px: 1.2 },
    h130: { l: 5.8, h: 2.7, w: 4.4, tz: 0.34, tx: 0.48, bl: 8.2, br: 0.16, py: 1.5, px: 1.6 },
    h76: { l: 3.6, h: 1.9, w: 2.9, tz: 0.3, tx: 0.45, bl: 4.8, br: 0.1, py: 1.1, px: 1.0 },
    oto76: { l: 3.2, h: 1.6, w: 3.2, tz: 0.4, tx: 0.4, bl: 4.6, br: 0.1, py: 1.0, px: 0.9 },
    ak630: { l: 1.8, h: 1.2, w: 1.8, tz: 0.35, tx: 0.35, bl: 2.2, br: 0.12, py: 0.8, px: 0.5 },
  }[type];
  if (type === 'oto76') { B.add(cyl(1.6, 1.7, 1.2, 18), mats.sup, 0, 0.6, 0); B.add(new THREE.SphereGeometry(1.6, 18, 8, 0, TAU, 0, Math.PI / 2), mats.sup, 0, 1.2, 0, 0, 0, 0, 1, 0.5, 1); }
  else B.add(taperBox(S.l, S.h, S.w, S.tz, S.tx), mats.sup);
  B.add(cyl(S.w * 0.42, S.w * 0.46, 0.5, 16), MAT.dark, 0, 0.0, 0);
  B.build(obj);
  BB.add(rod(S.br * 1.6, S.br, S.bl), MAT.dark);
  BB.add(rod(S.br * 1.9, S.br * 1.9, 0.8), MAT.dark, S.bl - 0.8, 0, 0);
  BB.build(pivot);
  pivot.position.set(S.px, S.py, 0);
  obj.add(pivot);
  obj.userData = { muzzle: S.bl };
  return obj;
}
function addCIWS(B, x, y, z, type, mats) {
  if (type === 'phalanx') {
    B.add(cyl(0.9, 1.0, 1.0), MAT.metal, x, y + 0.5, z);
    B.add(cyl(0.75, 0.75, 1.6, 14), MAT.white, x - 0.2, y + 1.8, z);
    B.add(new THREE.SphereGeometry(0.75, 14, 8, 0, TAU, 0, Math.PI / 2), MAT.white, x - 0.2, y + 2.6, z);
    B.add(rod(0.22, 0.2, 2.4), MAT.dark, x + 0.4, y + 1.4, z);
  } else if (type === 'ram' || type === 'hq10') {
    B.add(cyl(0.9, 1.0, 1.0), MAT.metal, x, y + 0.5, z);
    B.add(taperBox(2.0, 1.8, 1.8, 0.1, 0.1), mats.sup, x, y + 1.0, z);
    B.add(new THREE.PlaneGeometry(1.6, 1.6), MAT.dark, x + 1.01, y + 1.9, z, 0, Math.PI / 2, 0);
  } else {
    B.add(taperBox(2.4, 1.7, 2.4, 0.2, 0.2), mats.sup, x, y, z);
    B.add(rod(0.34, 0.3, 3.0), MAT.dark, x + 0.8, y + 1.0, z);
  }
}
function addVLS(B, x, y, l, w) {
  const g = new THREE.PlaneGeometry(l, w); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * l / 3.2, uv.getY(i) * w / 3.2);
  B.add(g, MAT.vls, x, y + 0.08, 0);
  B.add(new THREE.BoxGeometry(l + 0.6, 0.12, w + 0.6), MAT.dark, x, y + 0.02, 0);
}
function addCanisters(B, x, y, mats, n = 4) {
  for (const s of [-1, 1]) for (let k = 0; k < n / 2; k++) {
    B.add(rod(0.42, 0.42, 4.8, 10), MAT.green, x - 2.4, y + 0.8 + k * 0.9, s * (0.6 + k * 0.2), 0, s * -0.9 + Math.PI * 0, 0.22);
  }
  B.add(new THREE.BoxGeometry(3, 0.6, 3), MAT.dark, x, y + 0.3, 0);
}
function addArmLauncher(B, x, y, mats, twin) {
  B.add(cyl(1.2, 1.4, 1.6, 14), mats.sup, x, y + 0.8, 0);
  for (const s of twin ? [-1, 1] : [0]) {
    B.add(new THREE.BoxGeometry(4.2, 0.5, 0.5), MAT.metal, x + 1.0, y + 2.0, s * 1.0, 0, 0, 0.35);
  }
}
// A naval helicopter: fuselage, tail boom, fin, engines and (if folded) rotor blades swung aft.
function addHelo(B, mat, x, y, z, ry = 0, folded = true) {
  const M = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new V3(1, 1, 1));
  const part = (g, m, px, py, pz, rx = 0, rry = 0, rz = 0) => {
    const l = new THREE.Matrix4().compose(new V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, rry, rz, 'YZX')), new V3(1, 1, 1));
    B.addM(g, m, M.clone().multiply(l));
  };
  const body = new THREE.CapsuleGeometry(1.15, 5.6, 6, 12); body.rotateZ(Math.PI / 2); body.scale(1, 1, 0.82);
  part(body, mat, 0.5, 1.7, 0);
  part(new THREE.SphereGeometry(0.95, 12, 8, 0, TAU, 0, Math.PI / 2), MAT.glass, 3.4, 1.75, 0, 0, 0, -1.2);
  part(rod(0.42, 0.22, 7.4, 8), mat, -9.6, 2.15, 0);
  part(new THREE.BoxGeometry(1.4, 2.4, 0.16), mat, -9.7, 3.3, 0);
  part(new THREE.BoxGeometry(0.9, 0.1, 2.8), mat, -9.2, 2.3, 0);
  part(new THREE.BoxGeometry(3.2, 0.9, 1.6), mat, 0, 2.9, 0);
  part(cyl(0.2, 0.25, 0.8, 8), MAT.dark, 0.4, 3.6, 0);
  for (const zz of [-1.1, 1.1]) part(cyl(0.3, 0.3, 0.2, 10), MAT.black, 1.8, 0.35, zz, Math.PI / 2, 0, 0);
  part(cyl(0.3, 0.3, 0.2, 10), MAT.black, -6.5, 0.6, 0, Math.PI / 2, 0, 0);
  if (folded) for (const zz of [-0.35, -0.12, 0.12, 0.35]) part(new THREE.BoxGeometry(7.8, 0.06, 0.5), MAT.dark, -3.6, 3.95, zz);
}
function helicopterMesh(side) {
  const g = new THREE.Group(), B = new Builder();
  addHelo(B, MAT.jet[side], 0, 0, 0, 0, false);
  B.build(g, { cast: true, receive: false });
  const rotor = new THREE.Group();
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.06, 0.5), MAT.dark); b.position.x = 4.1; const a = new THREE.Group(); a.rotation.y = i * Math.PI / 2; a.add(b); rotor.add(a); }
  // A faint disc reads as a spinning rotor at a distance
  const disc = new THREE.Mesh(new THREE.CircleGeometry(8.2, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2; rotor.add(disc);
  rotor.position.set(0.4, 4.0, 0);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.25), MAT.dark); tail.position.set(-9.9, 3.5, 0.2);
  g.add(rotor, tail);
  return { group: g, rotor, tail };
}
function addBoat(B, x, y, z) {
  const g = new THREE.CapsuleGeometry(1.1, 5.5, 4, 10); g.rotateZ(Math.PI / 2);
  B.add(g, MAT.orange, x, y + 1.3, z, 0, 0, 0, 1, 0.6, 1);
  B.add(new THREE.BoxGeometry(3, 1.0, 1.6), MAT.white, x, y + 2.0, z);
  B.add(new THREE.BoxGeometry(0.2, 2.2, 0.2), MAT.metal, x - 2.5, y + 1.1, z);
  B.add(new THREE.BoxGeometry(0.2, 2.2, 0.2), MAT.metal, x + 2.5, y + 1.1, z);
}
function addMast(B, m, deckY, mats, spinners) {
  const y = deckY + (m.y || 0), h = m.h;
  if (m.type === 'lattice' || m.type === 'tripod') {
    const legs = m.type === 'tripod' ? [[1.8, 0], [-1.4, 1.6], [-1.4, -1.6]] : [[1.5, 1.5], [1.5, -1.5], [-1.5, 1.5], [-1.5, -1.5]];
    for (const [lx, lz] of legs) {
      const len = Math.hypot(lx * 0.8, h, lz * 0.8);
      const g = cyl(0.12, 0.2, len, 6);
      const ax = Math.atan2(lz * 0.8, h), az = -Math.atan2(lx * 0.8, h);
      B.add(g, mats.sup, m.x + lx * 0.6, y + h / 2, lz * 0.6, ax, 0, az);
    }
    for (let k = 1; k < 4; k++) B.add(new THREE.BoxGeometry(3.0 - k * 0.6, 0.15, 3.0 - k * 0.6), mats.sup, m.x, y + h * k / 4, 0);
    B.add(new THREE.BoxGeometry(0.4, 0.3, 9), mats.sup, m.x, y + h * 0.8, 0);
    B.add(cyl(0.12, 0.15, h * 0.45, 6), mats.sup, m.x, y + h * 1.2, 0);
    B.add(new THREE.SphereGeometry(0.8, 10, 8), MAT.white, m.x + 0.6, y + h * 0.95, 0);
  } else if (m.type === 'pyramid') {
    const g = new THREE.ConeGeometry(3.6, h, 4); g.rotateY(Math.PI / 4); g.translate(0, h / 2, 0);
    B.add(g, mats.sup, m.x, y, 0);
    B.add(cyl(0.15, 0.2, h * 0.5, 6), mats.sup, m.x, y + h * 1.15, 0);
    B.add(new THREE.SphereGeometry(1.0, 10, 8), MAT.white, m.x, y + h * 0.82, 0);
    B.add(new THREE.BoxGeometry(0.3, 0.25, 6), mats.sup, m.x, y + h * 0.7, 0);
  } else {
    B.add(taperBox(6.5, h, 7, 0.28, 0.25), mats.sup, m.x, y, 0);
    for (const s of [-1, 1]) B.add(new THREE.CircleGeometry(1.7, 8), MAT.panel, m.x, y + h * 0.62, s * 2.85, -s * 0.27 + (s > 0 ? 0 : Math.PI), 0, 0);
    B.add(new THREE.CircleGeometry(1.7, 8), MAT.panel, m.x + 2.95, y + h * 0.62, 0, 0, Math.PI / 2, 0);
    B.add(cyl(0.15, 0.2, 5, 6), mats.sup, m.x, y + h + 2.5, 0);
    B.add(new THREE.SphereGeometry(0.7, 10, 8), MAT.white, m.x, y + h + 0.4, 0);
  }
  if (m.type !== 'integrated') {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 5.2), mats.sup);
    sp.position.set(m.x, y + h * (m.type === 'pyramid' ? 1.02 : 1.02), 0);
    sp.castShadow = true;
    spinners.push(sp);
  }
}
function addFunnel(B, f, deckY, mats) {
  const y = deckY + (f.y || 0);
  B.add(taperBox(f.l, f.h, f.w, 0.12, 0.12), mats.sup, f.x, y, f.z || 0);
  B.add(new THREE.BoxGeometry(f.l * 0.86, 0.5, f.w * 0.84), MAT.black, f.x, y + f.h, f.z || 0);
}
function addRails(B, x0, x1, zHalf, y) {
  for (const s of [-1, 1]) {
    const len = x1 - x0;
    B.add(rod(0.03, 0.03, len, 4), MAT.metal, x0, y + 1.0, s * zHalf);
    B.add(rod(0.025, 0.025, len, 4), MAT.metal, x0, y + 0.55, s * zHalf);
    for (let x = x0; x <= x1; x += 2.2) B.add(cyl(0.035, 0.035, 1.0, 4), MAT.metal, x, y + 0.5, s * zHalf);
  }
}

/* ------------------------------------------------------------------ */
/* Ship classes                                                        */
/* ------------------------------------------------------------------ */
const SPECS = {
  kidd: { label: 'Kidd-class destroyer', L: 171, B: 16.8, D: 6.4, F: 7.4, hull: { sheer: 2.6, fine: 0.52 }, paint: 'mid', taper: 0.03,
    blocks: [{ x: 24, l: 22, w: 13, h: 5.4 }, { x: 26, l: 13, w: 10.5, h: 3.6, y: 5.4, bridge: true }, { x: -6, l: 40, w: 13.5, h: 5 }, { x: -46, l: 22, w: 14, h: 6 }],
    funnels: [{ x: 8, l: 7.5, w: 5, h: 8, y: 5, z: -1.4 }, { x: -20, l: 7.5, w: 5, h: 9, y: 5, z: 1.4 }],
    masts: [{ x: 16, y: 9, h: 15, type: 'lattice' }, { x: -12, y: 5, h: 12, type: 'lattice' }],
    guns: [{ x: 61, type: 'mk45' }, { x: -66, type: 'mk45', aft: true }], arms: [{ x: 47, twin: true }, { x: -57, twin: true }],
    ciws: [{ x: 5, y: 5, z: -5.8, type: 'phalanx' }, { x: -33, y: 6, z: 5.4, type: 'phalanx' }], canisters: [{ x: -27, y: 5, n: 6 }], boats: [{ x: -1, y: 5, z: 7.2 }, { x: -1, y: 5, z: -7.2 }] },
  burke: { label: 'Arleigh Burke-class destroyer', L: 155, B: 20, D: 6.3, F: 7.2, hull: { sheer: 2.2, fine: 0.55, flare: 0.5 }, paint: 'mid', taper: 0.12,
    blocks: [{ x: 14, l: 30, w: 16, h: 9.5, panels: true, bridge: true }, { x: -18, l: 30, w: 14, h: 5 }, { x: -44, l: 12, w: 15, h: 5 }],
    funnels: [{ x: -6, l: 7, w: 6, h: 7, y: 5 }, { x: -28, l: 7, w: 6, h: 7, y: 5 }],
    masts: [{ x: 6, y: 9.5, h: 15, type: 'tripod' }], guns: [{ x: 55, type: 'mk45' }], vls: [{ x: 40, l: 9, w: 8 }, { x: -58, l: 9, w: 8 }],
    ciws: [{ x: 31, y: 0.2, z: 0, type: 'phalanx' }, { x: -47, y: 5, z: 0, type: 'phalanx' }], canisters: [{ x: -36, y: 5 }], heli: { x: -68, l: 18 }, boats: [{ x: -10, y: 5, z: 7.5 }] },
  mogami: { label: 'Mogami-class frigate', L: 133, B: 16.3, D: 4.7, F: 7.2, hull: { sheer: 2.4, fine: 0.55, flare: 0.45 }, paint: 'dark', taper: 0.2,
    blocks: [{ x: 6, l: 44, w: 14, h: 8, bridge: true }, { x: -30, l: 26, w: 14, h: 6 }],
    masts: [{ x: 4, y: 8, h: 11, type: 'integrated' }], guns: [{ x: 44, type: 'mk45' }], vls: [{ x: 32, l: 6, w: 6 }], canisters: [{ x: -14, y: 6 }],
    ciws: [{ x: -42, y: 6, z: 0, type: 'ram' }], heli: { x: -55, l: 16 } },
  chengkung: { label: 'Cheng Kung-class frigate', L: 138, B: 14.3, D: 7.5, F: 6.2, hull: { sheer: 2.0, fine: 0.5 }, paint: 'mid', taper: 0.03,
    blocks: [{ x: 10, l: 58, w: 12, h: 6 }, { x: 22, l: 10, w: 9, h: 3, y: 6, bridge: true }, { x: -30, l: 22, w: 13, h: 5.5 }],
    funnels: [{ x: -10, l: 6, w: 5, h: 6, y: 6 }], masts: [{ x: 18, y: 9, h: 13, type: 'lattice' }, { x: 0, y: 6, h: 11, type: 'lattice' }],
    arms: [{ x: 49, twin: false }], guns: [{ x: -2, y: 6, type: 'oto76' }], ciws: [{ x: -38, y: 5.5, z: 0, type: 'phalanx' }], heli: { x: -58, l: 18 } },
  t055: { label: 'Type 055 destroyer', L: 180, B: 20, D: 6.6, F: 9, hull: { sheer: 2.6, fine: 0.58, flare: 0.5 }, paint: 'light', taper: 0.16,
    blocks: [{ x: 22, l: 42, w: 17, h: 9.5, panels: true, bridge: true }, { x: -12, l: 28, w: 15, h: 7 }, { x: -50, l: 26, w: 17, h: 7 }],
    masts: [{ x: 18, y: 9.5, h: 15, type: 'integrated' }], funnels: [{ x: -14, l: 12, w: 9, h: 6, y: 7 }],
    guns: [{ x: 66, type: 'h130' }], vls: [{ x: 50, l: 14, w: 10 }, { x: -36, l: 9, w: 10 }],
    ciws: [{ x: 41, y: 0.3, z: 0, type: 't1130' }, { x: -55, y: 7, z: 0, type: 'hq10' }], heli: { x: -78, l: 24 }, boats: [{ x: -26, y: 0.3, z: 8.8 }] },
  t052d: { label: 'Type 052D destroyer', L: 157, B: 18, D: 6, F: 8, hull: { sheer: 2.4, fine: 0.56, flare: 0.5 }, paint: 'light', taper: 0.14,
    blocks: [{ x: 18, l: 32, w: 15, h: 8.5, panels: true, bridge: true }, { x: -14, l: 30, w: 13, h: 5 }, { x: -44, l: 20, w: 15, h: 6 }],
    masts: [{ x: 12, y: 8.5, h: 13, type: 'pyramid' }], funnels: [{ x: -10, l: 12, w: 7, h: 7, y: 5 }],
    guns: [{ x: 57, type: 'h130' }], vls: [{ x: 42, l: 10, w: 9 }, { x: -34, l: 8, w: 9 }],
    ciws: [{ x: 33, y: 0.2, z: 0, type: 't1130' }, { x: -48, y: 6, z: 0, type: 'hq10' }], heli: { x: -64, l: 20 } },
  t054a: { label: 'Type 054A frigate', L: 134, B: 16, D: 5, F: 7.4, hull: { sheer: 2.4, fine: 0.55, flare: 0.5 }, paint: 'light', taper: 0.12,
    blocks: [{ x: 10, l: 30, w: 13, h: 7, bridge: true }, { x: -22, l: 30, w: 12, h: 5 }],
    masts: [{ x: 4, y: 7, h: 13, type: 'pyramid' }], funnels: [{ x: -12, l: 8, w: 6, h: 6, y: 5 }],
    guns: [{ x: 46, type: 'h76' }], vls: [{ x: 33, l: 6, w: 6 }], canisters: [{ x: -4, y: 0.2 }],
    ciws: [{ x: -30, y: 5, z: 5, type: 't730' }, { x: -30, y: 5, z: -5, type: 't730' }], heli: { x: -52, l: 18 } },
  panshih: { label: 'Panshih fast combat support ship', L: 196, B: 25, D: 9, F: 9, hull: { sheer: 2, fine: 0.5, flare: 0.7 }, paint: 'mid', taper: 0.04,
    blocks: [{ x: 62, l: 22, w: 21, h: 11, bridge: true }, { x: -60, l: 40, w: 22, h: 9 }],
    funnels: [{ x: -66, l: 9, w: 7, h: 9, y: 9 }], masts: [{ x: 64, y: 11, h: 10, type: 'lattice' }], gantries: [-30, 0, 30], ciws: [{ x: 74, y: 11, z: 0, type: 'phalanx' }], heli: { x: -88, l: 16 } },
  t901: { label: 'Type 901 fast combat support ship', L: 241, B: 33, D: 11, F: 10, hull: { sheer: 2, fine: 0.5, flare: 0.7 }, paint: 'light', taper: 0.05,
    blocks: [{ x: 84, l: 26, w: 26, h: 12, bridge: true }, { x: -74, l: 44, w: 28, h: 10 }],
    funnels: [{ x: -78, l: 10, w: 8, h: 10, y: 10 }], masts: [{ x: 86, y: 12, h: 11, type: 'pyramid' }], gantries: [-40, -5, 30, 60], ciws: [{ x: 96, y: 12, z: 0, type: 't730' }], heli: { x: -108, l: 20 } },
};

// Foam where the hull meets the sea: thick at the bow wave, thinning aft, brighter with speed.
function hullFoamGeo(P, zOff = 0) {
  const N = 40, pos = [], uv = [], idx = [];
  const ring = [];
  for (let i = 0; i <= N; i++) ring.push([i / N, 1]);
  for (let i = N; i >= 0; i--) ring.push([i / N, -1]);
  ring.forEach(([t, side], k) => {
    const x = -P.L / 2 + t * P.L, w = Math.max(P.wl(t), 0.3);
    const bow = smooth(0.7, 1, t), stern = 1 - smooth(0, 0.1, t);
    const out = 1.2 + bow * 4.5 + stern * 2.5;
    pos.push(x + bow * 1.5, 0, side * w + zOff, x + bow * 2.5 - stern * 3, 0, side * (w + out) + zOff);
    uv.push(t * P.L / 25, 0, t * P.L / 25, 1);
    if (k < ring.length - 1) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function decalMesh(text, h, P, x, side) {
  const tex = numberTex(text);
  const mat = stdMat({ map: tex, transparent: true, roughness: 0.65, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const w = h * 3.2;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const t = P.tAt(x), y = P.fb(t) * 0.55, z = lerp(P.wl(t), P.dk(t), 0.55) + 0.12;
  const t2 = P.tAt(x + 3), z2 = lerp(P.wl(t2), P.dk(t2), 0.55);
  const ang = Math.atan2(z2 - z + 0.12, 3);
  m.userData.decal = true;
  m.position.set(x, y, side * z);
  m.rotation.y = side > 0 ? ang : Math.PI - ang;
  return m;
}

function buildWarship(key, { player = false, hullNo = '' } = {}) {
  const S = SPECS[key], mats = PAINT[S.paint];
  const P = hullProfile(S.L, S.B, S.D, S.F, S.hull);
  const group = new THREE.Group(), B = new Builder(), spinners = [], turrets = [];
  const hg = hullGeo(P);
  B.add(hg.hull, mats.hull); B.add(hg.deck, MAT.deck);
  let eye = null, top = S.F;
  for (const b of S.blocks) {
    const y = P.deckAt(b.x) + (b.y || 0);
    B.add(taperBox(b.l, b.h, b.w, b.taper ?? S.taper, (b.taper ?? S.taper) * 0.5), mats.sup, b.x, y, 0);
    top = Math.max(top, y + b.h);
    if (b.bridge) {
      const fx = b.x + b.l / 2 * (1 - (S.taper * 0.25));
      const tilt = Math.atan(S.taper * 0.5 * b.l / 2 / b.h);
      B.add(new THREE.PlaneGeometry(b.w * 0.72 * (1 - S.taper * 0.6), 1.1), MAT.glass, fx - (S.taper * 0.5 * b.l / 2) * 0.18 + 0.05, y + b.h - 1.6, 0, 0.2 + tilt, Math.PI / 2, 0);
      eye = { x: b.x + b.l / 2 - 2.2 - S.taper * 3, y: y + b.h + 1.75, z: b.w / 2 * (1 - S.taper) - 0.9 };
      if (player) addRails(B, b.x - b.l / 2 + 2, b.x + b.l / 2 - 1.5 - S.taper * 3, b.w / 2 * (1 - S.taper) - 0.25, y + b.h);
    }
    if (b.panels) {
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = b.x + sx * b.l * 0.33, pz = sz * (b.w / 2 * (1 - S.taper * 0.5) + 0.06), py = y + b.h * 0.62;
        B.add(new THREE.CircleGeometry(2.0, 8), MAT.panel, px, py, pz, sz * 0.0, sz > 0 ? sx * 0.6 : Math.PI - sx * 0.6, 0);
      }
    }
  }
  for (const f of S.funnels || []) addFunnel(B, f, P.deckAt(f.x), mats);
  for (const m of S.masts || []) addMast(B, m, P.deckAt(m.x), mats, spinners);
  addShipDetail(B, S, P, mats);
  for (const v of S.vls || []) addVLS(B, v.x, P.deckAt(v.x), v.l, v.w);
  for (const c of S.ciws || []) addCIWS(B, c.x, P.deckAt(c.x) + c.y, c.z, c.type, mats);
  for (const c of S.canisters || []) addCanisters(B, c.x, P.deckAt(c.x) + c.y, mats, c.n || 4);
  for (const a of S.arms || []) addArmLauncher(B, a.x, P.deckAt(a.x), mats, a.twin);
  for (const bt of S.boats || []) addBoat(B, bt.x, P.deckAt(bt.x) + bt.y, bt.z);
  for (const gx of S.gantries || []) {
    const y = P.deckAt(gx);
    for (const s of [-1, 1]) B.add(new THREE.BoxGeometry(1.0, 13, 1.0), mats.sup, gx, y + 6.5, s * S.B * 0.32);
    B.add(new THREE.BoxGeometry(1.0, 1.0, S.B * 0.7), mats.sup, gx, y + 12.5, 0);
    B.add(new THREE.BoxGeometry(6, 3, 5), mats.sup, gx + 4, y, s0(S.B));
  }
  if (S.heli) {
    const x = S.heli.x, y = P.deckAt(x);
    const g = new THREE.PlaneGeometry(S.heli.l, S.B * 0.85); g.rotateX(-Math.PI / 2);
    B.add(g, MAT.heli, x, y + 0.3, 0);
    // A helicopter lashed down on deck, blades folded
    if (!player) addHelo(B, MAT.jet[key.startsWith('t') ? 'PLA' : 'ALLIED'], x + S.heli.l * 0.15, y + 0.3, 0, Math.PI);
  }
  if (player) addRails(B, 30, S.L / 2 - 6, S.B * 0.42, P.deckAt(40));
  B.build(group);
  for (const gd of S.guns || []) {
    const gun = buildGun(gd.type, mats);
    gun.position.set(gd.x, P.deckAt(gd.x) + (gd.y || 0), 0);
    if (gd.aft) gun.rotation.y = Math.PI;
    gun.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(gun);
    turrets.push({ obj: gun, aft: !!gd.aft });
  }
  for (const sp of spinners) group.add(sp);
  if (hullNo) {
    const h = clamp(S.L * 0.022, 2.2, 4.2);
    group.add(decalMesh(hullNo, h, P, S.L * 0.3, 1), decalMesh(hullNo, h, P, S.L * 0.3, -1));
  }
  return { group, spinners, turrets, P, eye, top, L: S.L, B: S.B };
}
function s0(b) { return b * 0.3; }

// Small fittings that sell the scale: windows, doors, life rafts, antennas, anchors, scuttles.
function addShipDetail(B, S, P, mats) {
  const stealth = S.taper > 0.1;
  const win = new THREE.PlaneGeometry(0.9, 0.7), door = new THREE.PlaneGeometry(0.9, 1.9);
  for (const b of S.blocks) {
    const y = P.deckAt(b.x) + (b.y || 0);
    const halfW = b.w / 2 + 0.03, tz = b.taper ?? S.taper;
    for (const side of [-1, 1]) {
      // Doors at deck level, two per side on each block
      for (const f of [-0.3, 0.25]) B.add(door, MAT.dark, b.x + b.l * f, y + 1.0, side * halfW, 0, side > 0 ? 0 : Math.PI, 0);
      if (!stealth) {
        const n = Math.floor(b.l / 3.2);
        for (let i = 0; i < n; i++) if ((i * 7 + Math.round(b.x)) % 5 !== 0) B.add(win, MAT.glass, b.x - b.l / 2 + 1.6 + i * 3.2, y + b.h - 1.3, side * halfW, 0, side > 0 ? 0 : Math.PI, 0);
      } else {
        const zz = side * (halfW - tz * b.h * 0.5);
        B.add(new THREE.PlaneGeometry(b.l * 0.5, 0.06), MAT.dark, b.x, y + b.h * 0.5, zz, side * tz * 0.9, side > 0 ? 0 : Math.PI, 0);
      }
    }
    // Rooftop vents and lockers
    for (let i = 0; i < 3; i++) B.add(new THREE.BoxGeometry(1.4, 0.6, 1.1), mats.sup, b.x - b.l * 0.3 + i * b.l * 0.25, y + b.h, (i % 2 ? 1 : -1) * b.w * 0.22);
  }
  // Life-raft canisters along the deck edges amidships
  const raft = cyl(0.42, 0.42, 1.5, 10); raft.rotateZ(Math.PI / 2);
  for (let i = 0; i < 6; i++) for (const side of [-1, 1]) {
    const x = -S.L * 0.12 + i * 2.2, t = P.tAt(x);
    B.add(raft, MAT.white, x, P.fb(t) + 0.55, side * (P.dk(t) - 0.8));
  }
  // Whip antennas on the deck edge
  for (const x of [-S.L * 0.05, S.L * 0.08]) for (const side of [-1, 1]) {
    const t = P.tAt(x);
    B.add(cyl(0.03, 0.06, 9, 4), MAT.metal, x, P.fb(t) + 4.5, side * (P.dk(t) - 0.4), side * 0.12, 0, 0);
  }
  // Anchors and hawse pipes near the bow
  for (const side of [-1, 1]) {
    const x = S.L * 0.4, t = P.tAt(x), z = lerp(P.wl(t), P.dk(t), 0.75);
    B.add(new THREE.BoxGeometry(1.6, 1.3, 0.35), MAT.black, x, P.fb(t) * 0.75, side * (z + 0.05));
    B.add(cyl(0.45, 0.45, 0.3, 10), MAT.black, x + 1.5, P.fb(t) - 0.25, side * (P.dk(t) - 1.2));
  }
  // Scuttles along the forward hull on older designs
  if (!stealth) {
    const sc = new THREE.CircleGeometry(0.22, 10);
    for (let i = 0; i < 18; i++) for (const side of [-1, 1]) {
      const x = -S.L * 0.05 + i * 2.6, t = P.tAt(x), z = lerp(P.wl(t), P.dk(t), 0.72) + 0.04;
      B.add(sc, MAT.glass, x, P.fb(t) * 0.68, side * z, 0, side > 0 ? 0 : Math.PI, 0);
    }
  }
}

function buildFAC(key, hullNo) {
  const group = new THREE.Group(), B = new Builder(), spinners = [], turrets = [];
  const cat = key === 't022', mats = PAINT[cat ? 'light' : 'mid'];
  const L = cat ? 42.6 : 34.2;
  let P;
  if (cat) {
    P = hullProfile(L, 3.8, 1.6, 2.6, { sheer: 0.6, fine: 0.5, flare: 0.8, rake: 1.5 });
    const hg = hullGeo(P);
    for (const s of [-1, 1]) B.add(hg.hull, mats.hull, 0, 0, s * 4.1);
    B.add(new THREE.BoxGeometry(L * 0.86, 0.8, 11.6), MAT.deck, -1, 2.4, 0);
    B.add(taperBox(17, 3.4, 9.6, 0.36, 0.3), mats.sup, 3, 2.8, 0);
    B.add(new THREE.PlaneGeometry(6, 0.9), MAT.glass, 9.9, 5.2, 0, 0.45, Math.PI / 2, 0);
    const g = new THREE.ConeGeometry(1.8, 5, 4); g.rotateY(Math.PI / 4); g.translate(0, 2.5, 0);
    B.add(g, mats.sup, 1, 6.2, 0);
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) B.add(new THREE.BoxGeometry(6.2, 0.9, 0.95), mats.sup, -12, 3.6 + (k % 2) * 1.0, s * (2.2 + Math.floor(k / 2) * 1.05), 0, 0, 0.12);
  } else {
    P = hullProfile(L, 7.6, 1.8, 2.8, { sheer: 0.8, fine: 0.5, flare: 0.6, rake: 1.2 });
    const hg = hullGeo(P);
    B.add(hg.hull, mats.hull); B.add(hg.deck, MAT.deck);
    B.add(taperBox(12, 3.0, 6.0, 0.32, 0.3), mats.sup, 2, 2.9, 0);
    B.add(new THREE.PlaneGeometry(4, 0.8), MAT.glass, 7.7, 5.0, 0, 0.45, Math.PI / 2, 0);
    B.add(cyl(0.1, 0.12, 5, 6), mats.sup, 0, 8.5, 0);
    for (const s of [-1, 1]) for (let k = 0; k < 2; k++) B.add(new THREE.BoxGeometry(5.6, 0.85, 0.9), mats.sup, -9, 3.4 + k * 0.95, s * 1.4, 0, 0, 0.14);
  }
  const sp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3), mats.sup); sp.position.set(cat ? 1 : 0, cat ? 11.4 : 11, 0); spinners.push(sp);
  B.build(group);
  const gun = buildGun('ak630', mats);
  gun.position.set(cat ? 14 : 11, cat ? 2.8 : P.deckAt(11), 0); group.add(gun); turrets.push({ obj: gun, aft: false });
  group.add(sp);
  if (hullNo) { const h = 1.6; group.add(decalMesh(hullNo, h, P, L * 0.25, 1), decalMesh(hullNo, h, P, L * 0.25, -1)); }
  return { group, spinners, turrets, P, top: 9, L, B: cat ? 12.4 : 7.6 };
}

function buildSub(key) {
  const group = new THREE.Group(), B = new Builder();
  const L = key === 't039' ? 77 : 70, r = 4.0;
  const g = new THREE.CapsuleGeometry(r, L - 2 * r, 8, 20); g.rotateZ(Math.PI / 2);
  B.add(g, MAT.sub, 0, -11, 0, 0, 0, 0, 1, 1, 0.95);
  B.add(taperBox(9, 4.8, 2.4, 0.1, 0.25), MAT.sub, L * 0.16, -11 + r - 0.5, 0);
  B.add(new THREE.BoxGeometry(5, 0.3, 5.5), MAT.sub, L * 0.17, -11 + r + 2.6, 0);
  for (const a of [0.78, -0.78, 0.78 + Math.PI / 2, -0.78 - Math.PI / 2]) B.add(new THREE.BoxGeometry(4, 0.3, 6), MAT.sub, -L / 2 + 4, -11, 0, a, 0, 0);
  B.add(cyl(0.13, 0.15, 10, 6), MAT.dark, L * 0.17, -11 + r + 7, 0);
  B.add(cyl(0.09, 0.1, 9, 6), MAT.dark, L * 0.15, -11 + r + 6.5, 0.5);
  B.build(group, { cast: false, receive: false });
  return { group, spinners: [], turrets: [], P: hullProfile(L, 8, 8, 1), top: 2, L, B: 8 };
}

function buildCarrier(key) {
  const nim = key === 'nimitz', L = nim ? 333 : 316, Bw = nim ? 40.8 : 40;
  const mats = PAINT[nim ? 'mid' : 'light'];
  const P = hullProfile(L, Bw, nim ? 11.3 : 10.5, 17, { sheer: 1.5, fine: 0.62, flare: 0.3, rake: 14, transom: 0.9 });
  const group = new THREE.Group(), B = new Builder(), spinners = [];
  const hg = hullGeo(P); B.add(hg.hull, mats.hull); B.add(hg.deck, MAT.deck);
  const sh = new THREE.Shape();
  const pts = [[-L / 2 + 2, 20], [-L / 2 + 2, -26], [-120, -38], [20, -38], [L / 2 - 30, -22], [L / 2 - 2, -12], [L / 2 - 2, 14], [60, 20], [-20, 22], [-20, 36], [-110, 36], [-120, 22]];
  pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
  const dg = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false });
  dg.rotateX(Math.PI / 2);
  const p = dg.attributes.position, uv = dg.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + L / 2) / L, 1 - (p.getZ(i) + 40) / 80);
  B.add(dg, MAT.cv[nim ? '73' : '18'], 0, 18.6, 0);
  B.add(new THREE.BoxGeometry(L * 0.7, 2, Bw * 0.9), mats.sup, -10, 17.4, 0);
  const ix = nim ? -50 : -40;
  B.add(taperBox(30, 9, 9, 0.06, 0.04), mats.sup, ix, 18.6, 28);
  B.add(taperBox(18, 7, 7.4, 0.12, 0.06), mats.sup, ix + 4, 27.6, 28);
  B.add(new THREE.PlaneGeometry(14, 1.6), MAT.glass, ix + 13.2, 32.4, 28, 0, Math.PI / 2, 0);
  if (!nim) for (const s of [-1, 1]) B.add(new THREE.CircleGeometry(2.4, 8), MAT.panel, ix + 2, 31, 28 + s * 3.75, 0, s > 0 ? 0 : Math.PI, 0);
  addMast(B, { x: ix + 2, y: 16, h: nim ? 14 : 10, type: nim ? 'lattice' : 'integrated' }, 18.6, mats, spinners);
  // Parked aircraft along the deck edge
  const jetProto = jetGeometry(nim ? 'f18' : 'flanker');
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Matrix4().compose(new V3(-120 + i * 13, 20.2, 14 + (i % 2) * 3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 2.4, 0)), new V3(0.95, 0.95, 0.95));
    for (const gg of jetProto) B.addM(gg, MAT.jet[nim ? 'ALLIED' : 'PLA'], m);
  }
  for (const [x, z] of [[130, -24], [-140, -30], [-150, 24]]) addCIWS(B, x, 17.5, z, nim ? 'phalanx' : 't1130', mats);
  B.build(group);
  for (const sp of spinners) group.add(sp);
  const no = nim ? '73' : '18';
  group.add(decalMesh(no, 6, P, L * 0.36, 1), decalMesh(no, 6, P, L * 0.36, -1));
  return { group, spinners, turrets: [], P, top: 40, L, B: Bw };
}

function buildCargo() {
  const L = 150, Bw = 23;
  const P = hullProfile(L, Bw, 8, 7, { sheer: 1.8, fine: 0.55, flare: 0.75, rake: 6 });
  const group = new THREE.Group(), B = new Builder(), spinners = [];
  const hg = hullGeo(P); B.add(hg.hull, PAINT.black.hull); B.add(hg.deck, MAT.deck);
  B.add(taperBox(14, 15, 20, 0, 0), PAINT.black.sup, -56, P.deckAt(-56), 0);
  B.add(new THREE.BoxGeometry(3, 1.4, 26), PAINT.black.sup, -50, P.deckAt(-50) + 14, 0);
  B.add(new THREE.PlaneGeometry(18, 1.4), MAT.glass, -48.95, P.deckAt(-50) + 13, 0, 0, Math.PI / 2, 0);
  B.add(taperBox(6, 8, 5, 0.05, 0.05), MAT.red, -64, P.deckAt(-64) + 15, 0);
  B.add(new THREE.BoxGeometry(5.2, 0.6, 4.2), MAT.black, -64, P.deckAt(-64) + 23, 0);
  const box = new THREE.BoxGeometry(5.9, 2.5, 2.4);
  for (let bay = 0; bay < 15; bay++) {
    const x = -40 + bay * 6.3;
    const t = P.tAt(x), half = P.dk(t) - 1.2;
    const rows = Math.max(2, Math.floor(half * 2 / 2.5));
    const tiers = 2 + ((bay * 7) % 3);
    for (let r = 0; r < rows; r++) for (let k = 0; k < tiers; k++) {
      B.add(box, MAT.containers[(bay * 3 + r * 5 + k * 7) % 8], x, P.deckAt(x) + 1.3 + k * 2.55, -half + 1.25 + r * 2.5);
    }
  }
  addMast(B, { x: 64, y: 0, h: 8, type: 'lattice' }, P.deckAt(64), PAINT.black, spinners);
  B.build(group);
  for (const sp of spinners) group.add(sp);
  return { group, spinners, turrets: [], P, top: 24, L, B: Bw };
}

/* Fast jets: a lathe fuselage, extruded wings and fins. */
function jetGeometry(kind) {
  const parts = [];
  const prof = [[0, 0], [0.35, 1], [0.7, 2.6], [0.95, 4.5], [1.1, 7], [1.15, 11], [1.05, 15], [0.85, 18.5], [0.8, 19.5]];
  const lg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * (kind === 'f16' ? 0.9 : 1), y)), 12);
  lg.rotateZ(Math.PI / 2); lg.translate(19.5, 0, 0);
  // LatheGeometry runs along +Y; after the rotation the nose sits at +X.
  parts.push(lg);
  const wing = new THREE.Shape();
  if (kind === 'j20') { wing.moveTo(9, 0); wing.lineTo(1, 6.4); wing.lineTo(-1.5, 6.4); wing.lineTo(-1.5, 0); }
  else if (kind === 'f16') { wing.moveTo(8.5, 0); wing.lineTo(3, 4.8); wing.lineTo(1.2, 4.8); wing.lineTo(0.5, 0); }
  else { wing.moveTo(9, 0); wing.lineTo(3.2, 6.8); wing.lineTo(1.0, 6.8); wing.lineTo(-0.5, 0); }
  const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.22, bevelEnabled: false }); wg.rotateX(Math.PI / 2);
  const wg2 = wg.clone(); wg2.scale(1, 1, -1);
  parts.push(wg, wg2);
  const fin = new THREE.Shape(); fin.moveTo(3.4, 0); fin.lineTo(0.2, 4.0); fin.lineTo(-1.3, 4.0); fin.lineTo(-0.5, 0);
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.18, bevelEnabled: false });
  if (kind === 'f16') { fg.translate(-0.5, 0.8, -0.09); parts.push(fg); }
  else for (const s of [-1, 1]) { const f = fg.clone(); f.rotateX(s * (kind === 'j20' || kind === 'f35' ? 0.45 : 0.2)); f.translate(-0.8, 0.8, s * 1.4); parts.push(f); }
  if (kind === 'j20') {
    const cn = new THREE.Shape(); cn.moveTo(1.6, 0); cn.lineTo(-0.4, 2.4); cn.lineTo(-1.2, 2.4); cn.lineTo(-0.8, 0);
    const cg = new THREE.ExtrudeGeometry(cn, { depth: 0.14, bevelEnabled: false }); cg.rotateX(Math.PI / 2); cg.translate(13.5, 0.3, 0);
    const cg2 = cg.clone(); cg2.scale(1, 1, -1); parts.push(cg, cg2);
  } else {
    const st = new THREE.Shape(); st.moveTo(2.4, 0); st.lineTo(-0.2, 3.0); st.lineTo(-1.3, 3.0); st.lineTo(-1.0, 0);
    const sg = new THREE.ExtrudeGeometry(st, { depth: 0.14, bevelEnabled: false }); sg.rotateX(Math.PI / 2); sg.translate(-0.8, 0, 0);
    const sg2 = sg.clone(); sg2.scale(1, 1, -1); parts.push(sg, sg2);
  }
  const can = new THREE.SphereGeometry(0.75, 12, 8); can.scale(2.6, 0.75, 0.85); can.translate(14.6, 0.75, 0);
  parts.push(can);
  return parts;
}
const JET_PROTO = {};
function jetMesh(kind, side) {
  const key = kind + side;
  if (!JET_PROTO[key]) {
    const B = new Builder();
    for (const g of jetGeometry(kind)) B.add(g, MAT.jet[side]);
    const grp = B.build(new THREE.Group(), { cast: true, receive: false });
    grp.children.forEach(c => c.geometry.translate(-10, 0, 0));
    JET_PROTO[key] = grp;
  }
  return JET_PROTO[key].clone();
}
let MISSILE_PROTO = null;
function missileMesh() {
  if (!MISSILE_PROTO) {
    const B = new Builder();
    B.add(rod(0.18, 0.18, 4.2, 10), MAT.missile, -2.4, 0, 0);
    const nose = new THREE.ConeGeometry(0.18, 0.9, 10); nose.rotateZ(-Math.PI / 2); B.add(nose, MAT.missile, 2.25, 0, 0);
    for (let k = 0; k < 4; k++) B.add(new THREE.BoxGeometry(0.6, 0.02, 0.9), MAT.dark, -2.1, 0, 0, k * Math.PI / 2, 0, 0);
    MISSILE_PROTO = B.build(new THREE.Group(), { cast: false, receive: false });
  }
  return MISSILE_PROTO.clone();
}

/* ------------------------------------------------------------------ */
/* Terrain: islands and the distant mountains of Taiwan and Fujian     */
/* ------------------------------------------------------------------ */
function islandHeight(I, x, z) {
  const d = Math.hypot(x, z) / I.r, ang = Math.atan2(z, x);
  const edge = 1 + 0.55 * (fbm(Math.cos(ang) * 1.8 + I.seed, Math.sin(ang) * 1.8, I.seed, 4) - 0.5);
  const m = 1 - smooth(0.4 * edge, 1.0 * edge, d);
  let h = I.h * m * (0.4 + 0.8 * fbm(x / (I.r * 0.5) + I.seed, z / (I.r * 0.5), I.seed + 3, 5));
  if (I.plateau) h = Math.min(h * 1.9, I.h) * smooth(0.0, 0.25, m);
  h += fbm(x / 45, z / 45, 9, 3) * 5 * m;
  return h - (1 - m) * 30 - 2.5;
}
function buildIsland(I) {
  const S = I.r * 2.6, seg = 128, group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(S, S, seg, seg); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) { p.setY(i, islandHeight(I, p.getX(i), p.getZ(i))); uv.setXY(i, uv.getX(i) * S / 60, uv.getY(i) * S / 60); }
  geo.computeVertexNormals();
  const n = geo.attributes.normal, col = new Float32Array(p.count * 3);
  const sand = new THREE.Color(0xb9a77c), scrub = new THREE.Color(I.dry ? 0x7d7550 : 0x5e6a3a), green = new THREE.Color(I.dry ? 0x6a6a40 : 0x3f5530), rock = new THREE.Color(I.basalt ? 0x45413c : 0x6b6357), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), ny = n.getY(i);
    c.copy(sand).lerp(scrub, smooth(1.2, 5, y)).lerp(green, smooth(10, 40, y) * 0.7);
    c.lerp(rock, smooth(0.86, 0.62, ny));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, stdMat({ vertexColors: true, map: TEX.noise, roughness: 0.95, metalness: 0 }));
  mesh.receiveShadow = true;
  group.add(mesh);
  if (I.town) {
    const N = I.town, inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stdMat({ roughness: 0.8 }), N);
    const m = new THREE.Matrix4(), cc = new THREE.Color();
    let k = 0, tries = 0;
    setSeed(I.seed * 31 + 5);
    while (k < N && tries < N * 30) {
      tries++;
      const a = srand() * TAU, d = Math.sqrt(srand()) * I.r * 0.65, x = Math.cos(a) * d + (I.townX || 0), z = Math.sin(a) * d + (I.townZ || 0);
      const h0 = islandHeight(I, x, z);
      if (h0 < 2.5 || h0 > I.h * 0.6 || Math.abs(islandHeight(I, x + 8, z) - h0) > 2.5) continue;
      const w = 6 + srand() * 12, dd = 6 + srand() * 12, hh = 4 + srand() * (srand() < 0.1 ? 22 : 9);
      m.compose(new V3(x, h0 + hh / 2 - 0.5, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), srand() * TAU), new V3(w, hh, dd));
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, cc.setHSL(0.08 + srand() * 0.05, 0.12, 0.62 + srand() * 0.25));
      k++;
    }
    inst.count = k; inst.castShadow = true; inst.receiveShadow = true;
    group.add(inst);
    // Lighthouse on the seaward point
    for (let a = 0; a < TAU; a += 0.05) {
      const x = Math.cos(a) * I.r * 0.62, z = Math.sin(a) * I.r * 0.62, h0 = islandHeight(I, x, z);
      if (h0 > 3 && h0 < 25 && Math.abs(a - (I.light ?? 1.2)) < 0.4) {
        const lh = new THREE.Mesh(cyl(1.6, 2.2, 16, 12), MAT.white); lh.position.set(x, h0 + 8, z);
        const top = new THREE.Mesh(cyl(1.8, 1.8, 2.4, 12), MAT.red); top.position.set(x, h0 + 17, z);
        group.add(lh, top);
        break;
      }
    }
  }
  group.position.set(I.x, 0, I.z);
  return group;
}
function buildRange(o) {
  const geo = new THREE.PlaneGeometry(o.wid, o.len, 60, 220); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const across = clamp(x / o.wid + 0.5, 0, 1);
    const env = Math.pow(Math.sin(across * Math.PI), 0.7) * (0.6 + 0.4 * Math.sin(z / o.len * Math.PI + 0.6));
    const ridge = 1 - Math.abs(2 * fbm(x / 9000 + o.seed, z / 9000, o.seed, 5) - 1);
    p.setY(i, o.h * env * (0.35 + 0.65 * ridge * fbm(x / 4000, z / 4000 + o.seed, o.seed + 1, 4) * 1.6) - 60);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, stdMat({ color: o.color || 0x3d4a3a, roughness: 1, metalness: 0 }));
  m.position.set(o.x, 0, o.z);
  return m;
}


/* ------------------------------------------------------------------ */
/* Particles: instanced camera-facing quads                            */
/* ------------------------------------------------------------------ */
const FX_SUN = { dir: { value: new V3(0, 1, 0) }, tint: { value: new THREE.Color(1, 0.9, 0.8) } };
const FX_VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 iPos; attribute float iSize; attribute float iRot; attribute vec4 iCol;
  uniform float fogDensity; uniform vec3 sunDir;
  varying vec2 vUv; varying vec4 vCol; varying float vFog; varying float vScat;
  void main(){
    vUv = uv; vCol = iCol;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iRot), s = sin(iRot);
    mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
    float d = -mv.z; vFog = 1.0 - exp(-fogDensity * fogDensity * d * d);
    vec3 vd = normalize(iPos - cameraPosition);
    vScat = pow(max(dot(vd, normalize(sunDir)), 0.0), 6.0);
  }`;
const FX_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D map; uniform vec3 fogColor; uniform vec3 sunTint;
  varying vec2 vUv; varying vec4 vCol; varying float vFog; varying float vScat;
  void main(){
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(map, vUv);
    float a = t.a * vCol.a;
    if (a < 0.004) discard;
    #ifdef ADDITIVE
      gl_FragColor = vec4(t.rgb * vCol.rgb * a * (1.0 - vFog), 1.0);
    #else
      // Thin edges catch the light, thick cores shade themselves; looking toward the sun the smoke glows.
      float thin = 1.0 - t.a;
      vec3 c = t.rgb * vCol.rgb * (0.78 + 0.42 * thin);
      c += sunTint * vScat * thin * 0.9 * (0.25 + dot(vCol.rgb, vec3(0.33)));
      gl_FragColor = vec4(mix(c, fogColor, vFog), a);
    #endif
  }`;

class FX {
  constructor(max, tex, additive, order) {
    this.max = max; this.n = 0; this.additive = additive;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const mk = n => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(3); this.aSize = mk(1); this.aRot = mk(1); this.aCol = mk(4);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iRot', this.aRot); g.setAttribute('iCol', this.aCol);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, fogColor: FOG_U.color, fogDensity: FOG_U.density, sunDir: FX_SUN.dir, sunTint: FX_SUN.tint },
      vertexShader: FX_VERT, fragmentShader: FX_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, defines: additive ? { ADDITIVE: '' } : {},
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
    scene.add(this.mesh);
    const F = n => new Float32Array(max * n);
    this.p = F(3); this.v = F(3); this.life = F(1); this.maxLife = F(1); this.s0 = F(1); this.s1 = F(1);
    this.rot = F(1); this.rv = F(1); this.c = F(3); this.a = F(1); this.drag = F(1); this.grav = F(1); this.cool = F(1);
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 0, grav = 0, cool = 0) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); else this.n++;
    const k = i * 3;
    this.p[k] = x; this.p[k + 1] = y; this.p[k + 2] = z;
    this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
    this.life[i] = this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.rot[i] = Math.random() * TAU; this.rv[i] = (Math.random() - 0.5) * 0.6;
    this.c[k] = r; this.c[k + 1] = g; this.c[k + 2] = b; this.a[i] = a;
    this.drag[i] = drag; this.grav[i] = grav; this.cool[i] = cool;
  }
  copy(d, s) {
    const a = d * 3, b = s * 3;
    for (let j = 0; j < 3; j++) { this.p[a + j] = this.p[b + j]; this.v[a + j] = this.v[b + j]; this.c[a + j] = this.c[b + j]; }
    this.life[d] = this.life[s]; this.maxLife[d] = this.maxLife[s]; this.s0[d] = this.s0[s]; this.s1[d] = this.s1[s];
    this.rot[d] = this.rot[s]; this.rv[d] = this.rv[s]; this.a[d] = this.a[s]; this.drag[d] = this.drag[s]; this.grav[d] = this.grav[s]; this.cool[d] = this.cool[s];
  }
  update(dt, wind) {
    let i = 0;
    const P = this.aPos.array, S = this.aSize.array, R = this.aRot.array, C = this.aCol.array;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.n--; if (i !== this.n) this.copy(i, this.n); continue; }
      const k = i * 3, dr = Math.max(0, 1 - this.drag[i] * dt);
      this.v[k] = this.v[k] * dr + wind.x * this.drag[i] * dt;
      this.v[k + 1] = this.v[k + 1] * dr + this.grav[i] * dt;
      this.v[k + 2] = this.v[k + 2] * dr + wind.z * this.drag[i] * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      this.rot[i] += this.rv[i] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const fade = (t < 0.06 ? t / 0.06 : 1) * Math.pow(1 - t, 1.3);
      const cool = 1 - this.cool[i] * t;
      P[k] = this.p[k]; P[k + 1] = this.p[k + 1]; P[k + 2] = this.p[k + 2];
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
      R[i] = this.rot[i];
      C[i * 4] = this.c[k]; C[i * 4 + 1] = this.c[k + 1] * cool; C[i * 4 + 2] = this.c[k + 2] * cool * cool; C[i * 4 + 3] = this.a[i] * fade;
      i++;
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aRot.needsUpdate = this.aCol.needsUpdate = true;
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}
let fxSmoke, fxSpray, fxFire, fxSpark;
const DEBRIS = { mesh: null, list: [], m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler() };
function makeDebris() {
  DEBRIS.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stdMat({ color: 0x2a2c2e, roughness: 0.8, metalness: 0.4 }), 400);
  DEBRIS.mesh.count = 0; DEBRIS.mesh.frustumCulled = false; DEBRIS.mesh.castShadow = true;
  scene.add(DEBRIS.mesh);
}
function fxDebris(x, y, z, n, size = 1) {
  for (let i = 0; i < n && DEBRIS.list.length < 400; i++) {
    const a = rand(TAU), e = rand(0.3, 1.3), sp = rand(10, 40) * Math.sqrt(size);
    DEBRIS.list.push({ p: new V3(x, y, z), v: new V3(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp), r: new V3(rand(TAU), rand(TAU), rand(TAU)), rv: new V3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), s: new V3(rand(0.3, 1.6), rand(0.1, 0.5), rand(0.3, 1.2)).multiplyScalar(size), smoke: Math.random() < 0.4 });
  }
}
function updateDebris(dt) {
  if (!DEBRIS.mesh) return;
  let k = 0;
  for (const d of DEBRIS.list) {
    d.v.y -= 9.8 * dt; d.p.addScaledVector(d.v, dt); d.r.addScaledVector(d.rv, dt);
    if (d.smoke && Math.random() < dt * 14) { const L = 0.1 + LIT() * 0.15; fxSmoke.emit(d.p.x, d.p.y, d.p.z, 0, 0.5, 0, rand(1.5, 3), 0.8, 4, L, L, L, 0.7, 0.4, 0.2); }
    if (d.p.y < 0) { d.dead = true; if (Math.random() < 0.5) fxSpray.emit(d.p.x, 0.3, d.p.z, 0, 4, 0, 1.2, 1, 3, 0.8, 0.8, 0.8, 0.6, 0.3, -9.8); continue; }
    DEBRIS.m.compose(d.p, DEBRIS.q.setFromEuler(DEBRIS.e.set(d.r.x, d.r.y, d.r.z)), d.s);
    DEBRIS.mesh.setMatrixAt(k++, DEBRIS.m);
  }
  DEBRIS.list = DEBRIS.list.filter(d => !d.dead);
  DEBRIS.mesh.count = k;
  DEBRIS.mesh.instanceMatrix.needsUpdate = true;
}
const WIND = new V3(3, 0, 1.5);
function makeFX() {
  fxSmoke = new FX(7000, TEX.smoke, false, 2);
  fxSpray = new FX(5000, TEX.spray, false, 3);
  fxFire = new FX(3500, TEX.fire, true, 4);
  fxSpark = new FX(3500, TEX.dot, true, 5);
}
const LIT = () => SEA.light;

/* Common effects */
function fxSplash(x, z, size = 1) {
  const L = 0.85 * (0.35 + LIT() * 0.65);
  const n = Math.round(14 * size);
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), r = rand(0, 2.5) * size;
    fxSpray.emit(x + Math.cos(a) * r, 0.5, z + Math.sin(a) * r, Math.cos(a) * rand(0.5, 3), rand(14, 30) * Math.sqrt(size), Math.sin(a) * rand(0.5, 3), rand(2.2, 3.6), 2.5 * size, rand(7, 12) * size, L, L, L * 1.02, 0.95, 0.35, -9.8);
  }
  for (let i = 0; i < n * 0.6; i++) {
    const a = rand(TAU), s = rand(5, 11) * Math.sqrt(size);
    fxSpray.emit(x, 0.8, z, Math.cos(a) * s, rand(2, 6), Math.sin(a) * s, rand(2.5, 4.5), 4 * size, rand(12, 20) * size, L, L, L, 0.7, 0.6, -3);
  }
  sfxAt('splash', x, 0, z, size);
}
function fxExplosion(x, y, z, size = 1, smokeMul = 1) {
  const L = 0.4 + LIT() * 0.6;
  fxFire.emit(x, y, z, 0, 0, 0, 0.16, 14 * size, 30 * size, 6, 4.5, 3, 1);
  for (let i = 0; i < 16 * size; i++) {
    const a = rand(TAU), e = rand(-0.2, 1.2), s = rand(6, 22) * size;
    fxFire.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 4, Math.sin(a) * Math.cos(e) * s, rand(0.5, 1.2), rand(4, 8) * size, rand(10, 18) * size, 5, 2.4, 0.9, 0.9, 1.6, 2, 0.8);
  }
  for (let i = 0; i < 14 * size * smokeMul; i++) {
    const a = rand(TAU), s = rand(2, 8) * size;
    const d = rand(0.05, 0.16) * L;
    fxSmoke.emit(x + rand(-3, 3) * size, y + rand(0, 4), z + rand(-3, 3) * size, Math.cos(a) * s, rand(3, 9), Math.sin(a) * s, rand(5, 11), rand(6, 10) * size, rand(24, 45) * size, d, d * 0.95, d * 0.9, 0.85, 0.35, 1.2);
  }
  for (let i = 0; i < 26 * size; i++) {
    const a = rand(TAU), e = rand(0.2, 1.4), s = rand(25, 70) * Math.sqrt(size);
    fxSpark.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, rand(0.6, 1.8), 0.7, 0.3, 6, 3.2, 1.2, 1, 0.3, -9.8, 0.6);
  }
  flashLight(x, y + 4, z, 0xffa055, 2.5e6 * size, 0.5);
  if (size >= 0.5 && Math.hypot(x - camera.position.x, z - camera.position.z) < 9000) fxDebris(x, y, z, Math.round(6 * size), Math.min(size, 2));
  sfxAt('boom', x, y, z, size);
}
function fxMuzzle(pos, dir, size = 1) {
  const L = 0.55 + LIT() * 0.45;
  fxFire.emit(pos.x + dir.x * 2, pos.y + dir.y * 2, pos.z + dir.z * 2, dir.x * 20, dir.y * 20, dir.z * 20, 0.09, 3 * size, 9 * size, 6, 4.8, 3, 1);
  for (let i = 0; i < 6; i++) {
    const s = rand(8, 26);
    fxSmoke.emit(pos.x + dir.x * 3, pos.y + dir.y * 3, pos.z + dir.z * 3, dir.x * s + rand(-2, 2), dir.y * s + rand(0, 2), dir.z * s + rand(-2, 2), rand(2.5, 5), 1.5 * size, rand(8, 14) * size, 0.55 * L, 0.55 * L, 0.56 * L, 0.55, 0.9, 0.6);
  }
  flashLight(pos.x, pos.y, pos.z, 0xffb070, 1.2e5 * size, 0.12);
}

/* Wakes: ribbons that trail every ship and spread with age. */
class Wake {
  constructor(width, kelvin = true) {
    this.N = 60; this.nodes = []; this.timer = 0; this.width = width;
    this.meshes = [];
    for (const mat of kelvin ? [MAT.wakeFoam, MAT.wakeKelvin] : [MAT.wakeFoam]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.N * 6), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.N * 4), 2).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.N * 8), 4).setUsage(THREE.DynamicDrawUsage));
      const idx = [];
      for (let i = 0; i < this.N - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 1;
      scene.add(m); this.meshes.push(m);
    }
  }
  update(dt, x, z, h, speed, sternOff) {
    this.timer -= dt;
    const sx = x - fx(h) * sternOff, sz = z - fz(h) * sternOff;
    if (this.timer <= 0) {
      this.timer = 0.5;
      this.nodes.unshift({ x: sx, z: sz, h, age: 0, sp: Math.abs(speed), d: 0 });
      if (this.nodes.length > this.N) this.nodes.pop();
    }
    if (this.nodes.length) { this.nodes[0].x = sx; this.nodes[0].z = sz; this.nodes[0].h = h; this.nodes[0].sp = Math.abs(speed); }
    let dist = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i]; nd.age += dt;
      if (i > 0) dist += Math.hypot(nd.x - this.nodes[i - 1].x, nd.z - this.nodes[i - 1].z);
      nd.d = dist;
    }
    this.meshes.forEach((m, mi) => {
      const pos = m.geometry.attributes.position.array, uv = m.geometry.attributes.uv.array, col = m.geometry.attributes.color.array;
      const L = (0.55 + LIT() * 0.45);
      for (let i = 0; i < this.N; i++) {
        const nd = this.nodes[Math.min(i, this.nodes.length - 1)];
        if (!nd) continue;
        const kel = mi === 1;
        const w = kel ? this.width * 0.6 + nd.d * 0.36 : this.width * 0.55 + nd.age * 0.8;
        const rx = Math.cos(nd.h), rz = Math.sin(nd.h);
        const k = i * 6;
        pos[k] = nd.x - rx * w; pos[k + 1] = 0.12; pos[k + 2] = nd.z - rz * w;
        pos[k + 3] = nd.x + rx * w; pos[k + 4] = 0.12; pos[k + 5] = nd.z + rz * w;
        uv[i * 4] = nd.d / 40; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = nd.d / 40; uv[i * 4 + 3] = 1;
        const life = kel ? 34 : 26;
        const a = i >= this.nodes.length ? 0 : clamp(nd.sp / 12, 0, 1) * Math.pow(clamp(1 - nd.age / life, 0, 1), 1.4) * (kel ? 0.55 : 0.85) * (i === 0 ? 0 : 1);
        for (let j = 0; j < 2; j++) { const c = i * 8 + j * 4; col[c] = L; col[c + 1] = L; col[c + 2] = L; col[c + 3] = a; }
      }
      m.geometry.attributes.position.needsUpdate = m.geometry.attributes.uv.needsUpdate = m.geometry.attributes.color.needsUpdate = true;
    });
  }
  dispose() { this.meshes.forEach(m => { scene.remove(m); m.geometry.dispose(); }); }
}

/* Tracers: glowing streaks for shells and close-in gun rounds. */
const TRACER_MAX = 1400;
const tracerGeo = new THREE.BufferGeometry();
tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACER_MAX * 6), 3).setUsage(THREE.DynamicDrawUsage));
tracerGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRACER_MAX * 6), 3).setUsage(THREE.DynamicDrawUsage));
const tracerMesh = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
tracerMesh.frustumCulled = false; tracerMesh.renderOrder = 6;
scene.add(tracerMesh);
let tracerN = 0;
function tracer(x0, y0, z0, x1, y1, z1, r, g, b) {
  if (tracerN >= TRACER_MAX) return;
  const p = tracerGeo.attributes.position.array, c = tracerGeo.attributes.color.array, k = tracerN * 6;
  p[k] = x0; p[k + 1] = y0; p[k + 2] = z0; p[k + 3] = x1; p[k + 4] = y1; p[k + 5] = z1;
  c[k] = r * 0.2; c[k + 1] = g * 0.2; c[k + 2] = b * 0.2; c[k + 3] = r; c[k + 4] = g; c[k + 5] = b;
  tracerN++;
}
function flushTracers() {
  tracerGeo.setDrawRange(0, tracerN * 2);
  tracerGeo.attributes.position.needsUpdate = tracerGeo.attributes.color.needsUpdate = true;
  tracerN = 0;
}

/* A fixed pool of point lights, so the shaders never recompile mid-battle. */
const LIGHTS = [];
for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffaa66, 0, 0, 2); scene.add(l); LIGHTS.push({ l, t: 0, max: 1, i0: 0, hold: 0 }); }
function flashLight(x, y, z, color, intensity, dur, hold = 0) {
  if (Math.hypot(x - camera.position.x, z - camera.position.z) > 9000) return null;
  let best = LIGHTS[0];
  for (const L of LIGHTS) if (L.t + L.hold < best.t + best.hold) best = L;
  best.l.position.set(x, y, z); best.l.color.set(color);
  best.t = dur; best.max = dur; best.i0 = intensity; best.hold = hold;
  return best;
}
function updateLights(dt) {
  for (const L of LIGHTS) {
    if (L.hold > 0) { L.hold -= dt; L.l.intensity = L.i0 * (0.85 + Math.random() * 0.15); continue; }
    L.t = Math.max(0, L.t - dt);
    L.l.intensity = L.i0 * Math.pow(L.t / L.max, 1.5);
  }
}

/* ------------------------------------------------------------------ */
/* Audio (synthesised)                                                 */
/* ------------------------------------------------------------------ */
const AU = { ctx: null, master: null, noise: null, brown: null, muted: false, last: {}, loops: {} };
function audioInit() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    const C = new (window.AudioContext || window.webkitAudioContext)();
    AU.ctx = C;
    AU.master = C.createGain(); AU.master.gain.value = AU.muted ? 0 : 0.55;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    AU.master.connect(comp); comp.connect(C.destination);
    const len = C.sampleRate * 2;
    AU.noise = C.createBuffer(1, len, C.sampleRate);
    AU.brown = C.createBuffer(1, len, C.sampleRate);
    const d = AU.noise.getChannelData(0), b = AU.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { d[i] = Math.random() * 2 - 1; last = (last + 0.02 * d[i]) / 1.02; b[i] = last * 3.5; }
    // Ambient sea, wind, engine and rain loops
    AU.loops.sea = loop(AU.brown, 'lowpass', 600, 0.0);
    AU.loops.wind = loop(AU.noise, 'bandpass', 700, 0.0);
    AU.loops.rain = loop(AU.noise, 'highpass', 2500, 0.0);
    AU.loops.ciws = loop(AU.noise, 'bandpass', 900, 0.0, 6);
    const o = C.createOscillator(), og = C.createGain(); o.type = 'sawtooth'; o.frequency.value = 42;
    const of = C.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 160;
    o.connect(of); of.connect(og); og.gain.value = 0; og.connect(AU.master); o.start();
    AU.loops.engine = { g: og, o };
  } catch (e) { AU.ctx = null; }
}
function loop(buf, type, freq, gain, q = 0.8) {
  const C = AU.ctx, s = C.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = C.createGain(); g.gain.value = gain;
  s.connect(f); f.connect(g); g.connect(AU.master); s.start();
  return { s, f, g };
}
function setLoop(name, v, t = 0.3) { const L = AU.loops[name]; if (!L || !AU.ctx) return; L.g.gain.setTargetAtTime(v, AU.ctx.currentTime, t); }
function sfxAt(kind, x, y, z, size = 1) {
  if (!AU.ctx || AU.muted) return;
  const d = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
  // Rocket motors are loud: launches carry much further than splashes and small guns
  const vol = clamp(1 / (1 + d / (kind === 'launch' ? 2200 : 700)), 0, 1);
  if (vol < 0.02) return;
  // Sound travels at 343 m/s, so distant guns boom after their flash. Launches play at once: a late roar reads as lag.
  const delay = kind === 'launch' ? 0 : Math.min(d / 343, 4);
  sfx(kind, vol, delay, size, d);
}
function sfx(kind, vol = 1, delay = 0, size = 1, dist = 0) {
  const C = AU.ctx; if (!C || AU.muted) return;
  const now = C.currentTime + delay;
  const key = kind + Math.round(delay * 10);
  if (AU.last[key] && now - AU.last[key] < 0.04) return;
  AU.last[key] = now;
  const src = C.createBufferSource(); src.buffer = kind === 'boom' || kind === 'gun' ? AU.brown : AU.noise;
  const f = C.createBiquadFilter(), g = C.createGain();
  src.connect(f); f.connect(g); g.connect(AU.master);
  const far = clamp(1 - dist / 6000, 0.15, 1);
  let dur = 0.3;
  const thump = (f0, f1, gain, len) => {
    const o = C.createOscillator(), og = C.createGain();
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f1, now + len);
    og.gain.setValueAtTime(gain, now); og.gain.exponentialRampToValueAtTime(0.0001, now + len);
    o.connect(og); og.connect(AU.master); o.start(now); o.stop(now + len + 0.05);
  };
  if (kind === 'gun') {
    f.type = 'lowpass'; f.frequency.value = 2200 * far; g.gain.setValueAtTime(1.6 * vol, now); dur = 1.3;
    thump(70, 28, 1.4 * vol, 0.7);
  } else if (kind === 'boom') {
    f.type = 'lowpass'; f.frequency.setValueAtTime(900 * far, now); f.frequency.exponentialRampToValueAtTime(90, now + 1.6);
    g.gain.setValueAtTime(1.8 * vol * Math.min(2, size), now); dur = 2.2;
    thump(60, 22, 1.2 * vol * Math.min(2, size), 1.0);
  } else if (kind === 'splash') {
    f.type = 'bandpass'; f.frequency.value = 900 * far; f.Q.value = 0.5; g.gain.setValueAtTime(0.7 * vol * size, now); dur = 1.6;
  } else if (kind === 'launch') {
    // Ignition: a hard thump and a crack, then the motor's roar receding as the missile climbs away
    thump(95, 28, 1.8 * vol, 0.7);
    f.type = 'lowpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(3200 * far, now); f.frequency.exponentialRampToValueAtTime(600, now + 3.2);
    g.gain.setValueAtTime(0.001, now); g.gain.exponentialRampToValueAtTime(2.4 * vol, now + 0.05);
    g.gain.exponentialRampToValueAtTime(1.1 * vol, now + 0.9); dur = 3.6;
    // Crackle of the motor exhaust
    const cr = C.createBufferSource(); cr.buffer = AU.noise;
    const cf = C.createBiquadFilter(), cg = C.createGain(); cf.type = 'highpass'; cf.frequency.value = 2400;
    cg.gain.setValueAtTime(0.001, now); cg.gain.exponentialRampToValueAtTime(0.9 * vol * far, now + 0.04); cg.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    cr.connect(cf); cf.connect(cg); cg.connect(AU.master); cr.start(now, Math.random() * 0.5); cr.stop(now + 1.7);
    // Low rumble that carries a long way
    const rb = C.createBufferSource(); rb.buffer = AU.brown;
    const rf = C.createBiquadFilter(), rg = C.createGain(); rf.type = 'lowpass'; rf.frequency.value = 160;
    rg.gain.setValueAtTime(0.001, now); rg.gain.exponentialRampToValueAtTime(1.6 * vol, now + 0.08); rg.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
    rb.connect(rf); rf.connect(rg); rg.connect(AU.master); rb.start(now, Math.random() * 0.5); rb.stop(now + 2.9);
  } else if (kind === 'whistle') {
    const o = C.createOscillator(), og = C.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(1500, now); o.frequency.exponentialRampToValueAtTime(380, now + 1.1);
    og.gain.setValueAtTime(0.0001, now); og.gain.exponentialRampToValueAtTime(0.25 * vol, now + 0.5); og.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    o.connect(og); og.connect(AU.master); o.start(now); o.stop(now + 1.2);
    return;
  } else if (kind === 'jet') {
    f.type = 'bandpass'; f.Q.value = 0.6; f.frequency.setValueAtTime(2500, now); f.frequency.exponentialRampToValueAtTime(300, now + 3);
    g.gain.setValueAtTime(0.001, now); g.gain.exponentialRampToValueAtTime(1.2 * vol, now + 1.2); dur = 3.4;
  } else if (kind === 'thunder') {
    f.type = 'lowpass'; f.frequency.value = 220; g.gain.setValueAtTime(0.001, now); g.gain.exponentialRampToValueAtTime(2.0, now + 0.4); dur = 4;
  } else if (kind === 'blip') {
    const o = C.createOscillator(), og = C.createGain(); o.type = 'square'; o.frequency.value = size;
    og.gain.setValueAtTime(0.05, now); og.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(og); og.connect(AU.master); o.start(now); o.stop(now + 0.14);
    return;
  } else if (kind === 'alarm') {
    for (let i = 0; i < 6; i++) {
      const o = C.createOscillator(), og = C.createGain(); o.type = 'triangle'; o.frequency.value = i % 2 ? 620 : 780;
      og.gain.setValueAtTime(0.0001, now + i * 0.42); og.gain.exponentialRampToValueAtTime(0.18, now + i * 0.42 + 0.03); og.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.42 + 0.38);
      o.connect(og); og.connect(AU.master); o.start(now + i * 0.42); o.stop(now + i * 0.42 + 0.4);
    }
    return;
  } else if (kind === 'hit') {
    f.type = 'lowpass'; f.frequency.value = 3000; g.gain.setValueAtTime(2.2 * vol, now); dur = 1.0;
    thump(90, 30, 1.8 * vol, 0.5);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.start(now, Math.random() * 0.5); src.stop(now + dur + 0.1);
}


/* ------------------------------------------------------------------ */
/* Order of battle                                                     */
/* ------------------------------------------------------------------ */
const CLASS = {
  kidd:      { model: 'war', label: 'Kidd-class destroyer', hp: 760, speed: 15.5, turn: 0.065, gun: { every: 3.4, dmg: 40, range: 14000 }, asm: 6, sam: true, ciws: 0.85, pref: 7000 },
  burke:     { model: 'war', label: 'Arleigh Burke-class destroyer', hp: 780, speed: 15.8, turn: 0.07, gun: { every: 3.2, dmg: 40, range: 14000 }, asm: 8, sam: true, ciws: 0.9, pref: 7500 },
  mogami:    { model: 'war', label: 'Mogami-class frigate', hp: 540, speed: 15.0, turn: 0.075, gun: { every: 3.0, dmg: 30, range: 13000 }, asm: 6, sam: false, ciws: 0.8, pref: 6000 },
  chengkung: { model: 'war', label: 'Cheng Kung-class frigate', hp: 520, speed: 14.5, turn: 0.075, gun: { every: 1.9, dmg: 20, range: 9000 }, asm: 4, sam: true, ciws: 0.8, pref: 5500 },
  kh6:       { model: 'fac', label: 'Kuang Hua VI missile boat', hp: 150, speed: 17, turn: 0.13, gun: { every: 1.3, dmg: 8, range: 4500 }, asm: 2, ciws: 0, pref: 3500, small: true },
  haikun:    { model: 'sub', label: 'Hai Kun-class submarine', hp: 320, speed: 5, turn: 0.04, torp: true, pref: 3500 },
  nimitz:    { model: 'cv', label: 'Nimitz-class aircraft carrier', hp: 2400, speed: 8.5, turn: 0.022, ciws: 0.9, jets: 'f18', pref: 16000 },
  panshih:   { model: 'war', label: 'Fast combat support ship', hp: 900, speed: 8, turn: 0.03, ciws: 0.8, pref: 0 },
  t055:      { model: 'war', label: 'Type 055 destroyer', hp: 900, speed: 15.5, turn: 0.065, gun: { every: 3.0, dmg: 44, range: 15000 }, asm: 8, sam: true, ciws: 0.95, pref: 7500 },
  t052d:     { model: 'war', label: 'Type 052D destroyer', hp: 740, speed: 15.5, turn: 0.068, gun: { every: 3.2, dmg: 42, range: 14000 }, asm: 8, sam: true, ciws: 0.9, pref: 7000 },
  t054a:     { model: 'war', label: 'Type 054A frigate', hp: 540, speed: 14.5, turn: 0.075, gun: { every: 1.9, dmg: 22, range: 10000 }, asm: 6, sam: true, ciws: 0.8, pref: 5500 },
  t022:      { model: 'fac', label: 'Type 022 missile boat', hp: 160, speed: 18, turn: 0.12, gun: { every: 1.3, dmg: 8, range: 4500 }, asm: 2, ciws: 0, pref: 3500, small: true },
  t039:      { model: 'sub', label: 'Type 039A submarine', hp: 320, speed: 5, turn: 0.04, torp: true, pref: 3500 },
  t003:      { model: 'cv', label: 'Type 003 aircraft carrier', hp: 2400, speed: 8.5, turn: 0.022, ciws: 0.9, jets: 'flanker', pref: 16000 },
  t901:      { model: 'war', label: 'Type 901 fast combat support ship', hp: 1000, speed: 8, turn: 0.03, ciws: 0.8, pref: 0 },
  cargo:     { model: 'cargo', label: 'Container ship', hp: 520, speed: 11, turn: 0.04, pref: 0 },
};
const ROLES = {
  ALLIED: { heavy: ['burke'], destroyer: ['burke', 'kidd'], frigate: ['chengkung', 'mogami'], fac: ['kh6'], sub: ['haikun'], carrier: ['nimitz'], supply: ['panshih'], cargo: ['cargo'] },
  PLA: { heavy: ['t055'], destroyer: ['t052d'], frigate: ['t054a'], fac: ['t022'], sub: ['t039'], carrier: ['t003'], supply: ['t901'], cargo: ['cargo'] },
};
const NAMES = {
  kidd: [['ROCS Su Ao', '1802'], ['ROCS Tso Ying', '1803'], ['ROCS Ma Kong', '1805']],
  burke: [['USS Higgins', '76'], ['USS Ralph Johnson', '114'], ['USS Rafael Peralta', '115'], ['USS Dewey', '105']],
  mogami: [['JS Mogami', '1'], ['JS Kumano', '2'], ['JS Noshiro', '3']],
  chengkung: [['ROCS Cheng Kung', '1101'], ['ROCS Cheng Ho', '1103'], ['ROCS Chi Kuang', '1105'], ['ROCS Yueh Fei', '1106']],
  kh6: [['PGG 6103', '6103'], ['PGG 6106', '6106'], ['PGG 6110', '6110'], ['PGG 6114', '6114'], ['PGG 6121', '6121'], ['PGG 6127', '6127'], ['PGG 6131', '6131']],
  haikun: [['ROCS Hai Kun', '711'], ['ROCS Hai Lung', '793']],
  nimitz: [['USS George Washington', '73']],
  panshih: [['ROCS Panshih', '532']],
  t055: [['Lhasa', '102'], ['Anshan', '103'], ['Wuxi', '104']],
  t052d: [['Zhengzhou', '151'], ['Taiyuan', '131'], ['Kunming', '172'], ['Suzhou', '132']],
  t054a: [['Xuzhou', '530'], ['Huangshan', '570'], ['Rizhao', '598'], ['Yancheng', '546'], ['Wenzhou', '526']],
  t022: [['Houbei 2208', '2208'], ['Houbei 2211', '2211'], ['Houbei 2213', '2213'], ['Houbei 2216', '2216'], ['Houbei 2220', '2220'], ['Houbei 2223', '2223'], ['Houbei 2226', '2226']],
  t039: [['Yuan 330', '330'], ['Yuan 331', '331']],
  t003: [['Fujian', '18']],
  t901: [['Chaganhu', '965']],
  cargoALLIED: [['MV Ever Harmony', ''], ['MV Yang Ming Unity', ''], ['MV Wan Hai 316', '']],
  cargoPLA: [['MV COSCO Xiamen', ''], ['MV Zhonggu Fujian', ''], ['MV Min Hai 7', '']],
};
/* Anti-ship missiles: cruise speed, terminal sprint and sea-skimming height (m/s, m). */
const ASM = {
  harpoon: { name: 'Harpoon', cruise: 240, alt: 5, dmg: 260, weave: 1 },
  type17: { name: 'Type 17 SSM', cruise: 250, alt: 5, dmg: 260, weave: 1 },
  hf2: { name: 'Hsiung Feng II', cruise: 250, alt: 8, dmg: 230 },
  hf3: { name: 'Hsiung Feng III', cruise: 640, alt: 14, dmg: 300 },
  yj83: { name: 'YJ-83', cruise: 270, sprint: 430, sprintAt: 6000, alt: 7, dmg: 240 },
  yj18: { name: 'YJ-18', cruise: 260, sprint: 780, sprintAt: 9000, alt: 6, dmg: 300, weave: 1 },
  yj83k: { name: 'YJ-83K', cruise: 280, sprint: 430, sprintAt: 6000, alt: 7, dmg: 230 },
  agm84: { name: 'AGM-84 Harpoon', cruise: 250, alt: 5, dmg: 230, weave: 1 },
};
const ASM_TYPE = { kidd: 'harpoon', burke: 'harpoon', mogami: 'type17', chengkung: 'hf3', kh6: 'hf2', t055: 'yj18', t052d: 'yj18', t054a: 'yj83', t022: 'yj83' };
const JET_ASM = { ALLIED: 'agm84', PLA: 'yj83k' };
const PLAYER_ASM = { ALLIED: 'hf3', PLA: 'yj18' };
// Kee Lung carries six Hsiung Feng III in canisters amidships, whatever the mission.
const FIXED_ASM = { ALLIED: 6 };
const SPECIAL_NAME = { ALLIED: 'Harpoon salvo', PLA: 'DF-21D strike' };
const SAM_NAME = { ALLIED: 'SM-2', PLA: 'HHQ-9' };
const NATION = { kidd: 'ROC', chengkung: 'ROC', kh6: 'ROC', haikun: 'ROC', panshih: 'ROC', burke: 'US', nimitz: 'US', mogami: 'JP' };
const PLAYER_SHIP = { ALLIED: { cls: 'kidd', name: 'ROCS Kee Lung', no: '1801', jets: 'f16' }, PLA: { cls: 't055', name: 'Nanchang', no: '101', jets: 'j20' } };
const JET_KIND = { ALLIED: ['f16', 'f35', 'f18'], PLA: ['flanker', 'j20', 'flanker'] };
const JET_NAME = { f16: 'F-16V', f35: 'F-35B', f18: 'F/A-18F', flanker: 'J-15', j20: 'J-20' };
const DIFF = {
  recruit: { fire: 1.5, disp0: 420, dispMin: 75, asmEvery: 80, dmg: 0.55, ciwsVs: 0.4, samPk: 0.2, torpEvery: 80, jetMul: 1.4 },
  veteran: { fire: 1.0, disp0: 300, dispMin: 40, asmEvery: 52, dmg: 1.0, ciwsVs: 0.6, samPk: 0.34, torpEvery: 52, jetMul: 1.0 },
};
const nameIx = {};
function nextName(cls, side) {
  const key = cls === 'cargo' ? 'cargo' + side : cls;
  const list = NAMES[key];
  nameIx[key] = (nameIx[key] || 0) + 1;
  return list[(nameIx[key] - 1) % list.length];
}

/* Model cache: each class is built once and cloned. */
const PROTO = {};
function modelFor(cls, no, player = false, side = 'PLA') {
  const C = CLASS[cls];
  const build = () => {
    if (C.model === 'war') return buildWarship(cls, { player });
    if (C.model === 'fac') return buildFAC(cls, '');
    if (C.model === 'sub') return buildSub(cls);
    if (C.model === 'cv') return buildCarrier(cls);
    return buildCargo();
  };
  let m;
  if (player) m = build();
  else {
    if (!PROTO[cls]) {
      const p = build();
      p.turrets.forEach((t, i) => (t.obj.name = 'turret' + i));
      p.spinners.forEach((s, i) => (s.name = 'spin' + i));
      PROTO[cls] = p;
    }
    const p = PROTO[cls], group = p.group.clone();
    m = { ...p, group, turrets: p.turrets.map((t, i) => ({ obj: group.getObjectByName('turret' + i), aft: t.aft })), spinners: p.spinners.map((s, i) => group.getObjectByName('spin' + i)) };
  }
  if (no && C.model !== 'sub' && C.model !== 'cv' && C.model !== 'cargo') {
    const h = C.model === 'fac' ? 1.6 : clamp(m.L * 0.022, 2.2, 4.2);
    const xpos = C.model === 'fac' ? m.L * 0.25 : m.L * 0.3;
    const d1 = decalMesh(no, h, m.P, xpos, 1), d2 = decalMesh(no, h, m.P, xpos, -1);
    if (cls === 't022') { d1.position.z += 4.1; d2.position.z -= 4.1; }
    m.group.add(d1, d2);
  }
  // Funnel tops and CIWS mounts in ship coordinates, for exhaust and tracer origins
  const S = SPECS[cls];
  m.funnels = S ? (S.funnels || []).map(f => new V3(f.x, m.P.deckAt(f.x) + (f.y || 0) + f.h + 0.6, f.z || 0)) : C.model === 'cargo' ? [new V3(-64, m.P.deckAt(-64) + 23.5, 0)] : [];
  m.ciwsPts = S ? (S.ciws || []).map(c => Object.assign(new V3(c.x, m.P.deckAt(c.x) + c.y + 1.8, c.z), { type: c.type }))
    : C.model === 'cv' ? [[130, -24], [-140, -30], [-150, 24]].map(([x, z]) => Object.assign(new V3(x, 19.5, z), { type: 'gun' })) : [new V3(0, m.top * 0.6, 0)];
  // Foam collar at the waterline, with its own material so each ship can set its strength
  if (C.model !== 'sub') {
    const fm = new THREE.MeshBasicMaterial({ map: TEX.hullFoam, transparent: true, depthWrite: false, opacity: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6 });
    const offs = cls === 't022' ? [-4.1, 4.1] : [0];
    m.foam = [];
    for (const z of offs) { const f = new THREE.Mesh(hullFoamGeo(m.P, z), fm); f.position.y = 0.18; f.renderOrder = 1; f.frustumCulled = false; m.group.add(f); m.foam.push(f); }
    m.foamMat = fm;
  }
  // National ensign on a stern flagstaff
  if (C.model !== 'sub') {
    const nation = NATION[cls] || (side === 'ALLIED' ? 'ROC' : 'PRC');
    const x = -m.L / 2 + (C.model === 'cv' ? 10 : 2.5), y = C.model === 'cv' ? 20 : m.P.deckAt(x);
    const pole = new THREE.Mesh(cyl(0.06, 0.09, 6.5, 6), MAT.metal); pole.position.set(x, y + 3.25, 0);
    const flag = new THREE.Mesh(FLAG_GEO, flagMat(nation)); flag.position.set(x, y + 5.4, 0); flag.userData.noScar = true;
    m.group.add(pole, flag);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* World state                                                         */
/* ------------------------------------------------------------------ */
const W = { ships: [], jets: [], missiles: [], shells: [], rounds: [], torps: [], flares: [], chaff: [], islands: [], islandObjs: [], datums: [], pending: [], helo: null };
let TIME = 0;
let CFG = { side: 'ALLIED', diff: 'veteran', capture: true };
const hostile = (a, b) => a.side !== b.side;

function landAt(x, z) {
  for (const I of W.islands) {
    const dx = x - I.x, dz = z - I.z;
    if (dx * dx + dz * dz > I.r * I.r * 1.7) continue;
    if (islandHeight(I, dx, dz) > -3) return true;
  }
  return Math.hypot(x, z) > 32000;
}

let SHIP_ID = 0;
class Ship {
  constructor(cls, side, o = {}) {
    const C = CLASS[cls];
    this.id = ++SHIP_ID; this.cls = cls; this.C = C; this.side = side;
    const nm = o.name ? [o.name, o.no ?? ''] : nextName(cls, side);
    this.name = nm[0]; this.no = nm[1];
    this.player = !!o.player;
    const m = modelFor(cls, this.no, this.player, side);
    this.model = m; this.obj = m.group; this.obj.rotation.order = 'YZX';
    scene.add(this.obj);
    this.L = m.L; this.B = m.B; this.top = m.top; this.P = m.P;
    this.hitHalf = C.model === 'cv' ? 30 : C.model === 'fac' && cls === 't022' ? 6.2 : 0;
    this.x = o.x || 0; this.z = o.z || 0; this.h = o.h ?? 0;
    this.maxSpeed = C.speed; this.speed = o.speed ?? C.speed * 0.7; this.order = this.speed; this.rudder = 0;
    this.hp = this.maxHp = Math.round(C.hp * (o.hpMul || 1));
    this.dead = false; this.sunk = false; this.deadT = 0; this.listDir = Math.random() < 0.5 ? -1 : 1; this.pitchSign = Math.random() < 0.5 ? -1 : 1;
    this.phase = rand(TAU); this.roll = 0; this.pitch = 0; this.heel = 0; this.sinkY = 0; this.listAng = 0; this.pitchAng = 0;
    this.fires = []; this.fireAcc = 0; this.exhaustAcc = 0;
    this.isSub = C.model === 'sub';
    this.wake = this.isSub ? null : new Wake(this.B, this.L > 60);
    this.gunCd = rand(3, 8); this.asmCd = rand(25, 50); this.samCd = rand(1, 4); this.torpCd = rand(25, 40); this.launchCd = rand(25, 45);
    this.asm = C.asm || 0; this.disp = new Map(); this.ciwsT = 0; this.ciwsTarget = null; this.ciwsFiring = false;
    this.tag = o.tag || ''; this.role = o.role || 'combat'; this.priority = o.priority ?? 1;
    this.path = o.path || null; this.pathI = 0; this.arrived = false; this.safe = false;
    this.detected = !this.isSub; this.revealT = 0;
    this.ai = { target: null, think: rand(0.5, 2), zig: rand(20, 40), zigDir: Math.random() < 0.5 ? 1 : -1, pref: o.pref ?? C.pref };
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.killedBy = null;
    this.turretState = m.turrets.map(t => ({ yaw: t.aft ? Math.PI : 0, el: 0.05 }));
    this.updateObj();
  }
  updateObj(dt = 0.016) {
    // Sample the swell under bow, stern and both sides, then let the hull respond with some inertia.
    const t = TIME, A = SEA.amp, k = clamp(150 / this.L, 0.3, 2.6);
    const ax = fx(this.h), az = fz(this.h), rx = Math.cos(this.h), rz = Math.sin(this.h);
    const l = this.L * 0.36, b = Math.max(this.B, 6) * 0.5;
    const hb = swellH(this.x + ax * l, this.z + az * l), hs = swellH(this.x - ax * l, this.z - az * l);
    const hp = swellH(this.x - rx * b, this.z - rz * b), hst = swellH(this.x + rx * b, this.z + rz * b), hc = swellH(this.x, this.z);
    const r = clamp(dt * (this.L > 200 ? 0.9 : this.L > 80 ? 1.6 : 3), 0, 1);
    this.heaveS = lerp(this.heaveS ?? hc, (hb + hs + hp + hst + hc * 2) / 6, r);
    this.pitchS = lerp(this.pitchS ?? 0, Math.atan2(hb - hs, l * 2), r);
    this.rollS = lerp(this.rollS ?? 0, Math.atan2(hp - hst, b * 2) * 0.7, r * 0.7);
    this.roll = this.rollS + Math.sin(t * 0.52 + this.phase) * 0.004 * A * k;
    this.pitch = this.pitchS;
    const heave = this.isSub ? 0 : this.heaveS;
    let y = heave, roll = this.roll + this.heel, pitch = this.pitch;
    if (this.dead) { y -= this.sinkY; roll += this.listDir * this.listAng; pitch += this.pitchSign * this.pitchAng; }
    this.obj.position.set(this.x, y, this.z);
    this.obj.rotation.set(roll, Math.PI / 2 - this.h, pitch);
    this.obj.updateMatrixWorld();
  }
  hits(p, pad = 0) {
    if (this.dead && this.sinkY > 4) return false;
    const dx = p.x - this.x, dz = p.z - this.z, R = this.L * 0.55 + pad + this.hitHalf;
    if (dx * dx + dz * dz > R * R) return false;
    const f = dx * fx(this.h) + dz * fz(this.h), s = dx * Math.cos(this.h) + dz * Math.sin(this.h);
    if (Math.abs(f) > this.L / 2 + pad) return false;
    const t = clamp((f + this.L / 2) / this.L, 0, 1);
    const half = Math.max(this.hitHalf || this.P.dk(t), 1.5);
    if (Math.abs(s) > half + pad) return false;
    // Silhouette, not a box to the masthead: hull up to the deck edge, a superstructure block amidships
    const y = p.y - this.obj.position.y, deck = this.P.fb(t);
    const roof = Math.abs(f) < this.L * 0.3 ? deck + (this.top - deck) * 0.5 : deck + 1.5;
    return y > -this.P.D - 3 && y < roof + pad;
  }
  get pos() { return new V3(this.x, this.obj.position.y + this.top * 0.3, this.z); }
}

function spawnShip(cls, side, o) { const s = new Ship(cls, side, o); W.ships.push(s); return s; }
function removeShip(s) {
  scene.remove(s.obj);
  s.obj.traverse(o => {
    if (o.userData.decal) { o.material.map.dispose(); o.material.dispose(); o.geometry.dispose(); }
    if (o.userData.scar) o.geometry.dispose();
  });
  if (s.wake) s.wake.dispose();
}

/* ------------------------------------------------------------------ */
/* Ship movement and damage                                            */
/* ------------------------------------------------------------------ */
function stepShip(s, dt) {
  if (s.dead) { sinkStep(s, dt); s.updateObj(dt); return; }
  const C = s.C;
  const acc = s.L > 250 ? 0.16 : s.L > 100 ? 0.32 : 0.9;
  s.speed += clamp(s.order - s.speed, -acc * 1.5 * dt, acc * dt);
  const eff = clamp(Math.abs(s.speed) / (s.maxSpeed * 0.5), 0.15, 1);
  s.h = wrapPi(s.h + s.rudder * C.turn * eff * dt * (s.speed < -0.5 ? -1 : 1));
  s.heel = lerp(s.heel, -s.rudder * clamp(s.speed / s.maxSpeed, 0, 1) * (C.small ? 0.12 : 0.06), dt * 0.7);
  const nx = s.x + fx(s.h) * s.speed * dt, nz = s.z + fz(s.h) * s.speed * dt;
  const sgn = s.speed >= 0 ? 1 : -1;
  if (!s.isSub && landAt(nx + fx(s.h) * s.L * 0.48 * sgn, nz + fz(s.h) * s.L * 0.48 * sgn)) {
    if (s.player && Math.abs(s.speed) > 3) { damageShip(s, Math.abs(s.speed) * 6, null, null, 'ground'); radio('Damage control', 'We have run aground. Back her off!', 'bad'); }
    s.speed *= -0.3;
  } else { s.x = nx; s.z = nz; }
  s.vx = fx(s.h) * s.speed; s.vz = fz(s.h) * s.speed;
  s.updateObj(dt);
  for (const sp of s.model.spinners) if (sp) sp.rotation.y += dt * 2.2;
  if (s.wake) s.wake.update(dt, s.x, s.z, s.h, s.speed, s.L * 0.47);
  shipEffects(s, dt);
}

const _v = new V3(), _v2 = new V3();
function shipEffects(s, dt) {
  if (s.model.foamMat) {
    const sp = clamp(Math.abs(s.speed) / Math.max(1, s.maxSpeed), 0, 1);
    s.model.foamMat.opacity = (0.25 + sp * 0.6 + SEA.amp * 0.04) * (0.45 + LIT() * 0.55) * (s.dead ? clamp(1 - s.sinkY / 6, 0, 1) : 1);
    s.model.foamMat.map.offset.x = -TIME * sp * 0.4;
  }
  const near = Math.hypot(s.x - camera.position.x, s.z - camera.position.z) < 14000;
  if (!near) return;
  const L = 0.35 + LIT() * 0.65;
  // Bow wave and stern wash
  if (!s.isSub && Math.abs(s.speed) > 3) {
    const sp = Math.abs(s.speed) / s.maxSpeed;
    s.exhaustAcc += dt * (s.C.small ? 30 : 14) * sp;
    while (s.exhaustAcc > 1) {
      s.exhaustAcc -= 1;
      const side = Math.random() < 0.5 ? -1 : 1, bx = s.L * 0.42;
      const rx = Math.cos(s.h) * side, rz = Math.sin(s.h) * side;
      const px = s.x + fx(s.h) * bx + rx * 2, pz = s.z + fz(s.h) * bx + rz * 2;
      fxSpray.emit(px, 1.2, pz, rx * rand(2, 5) * sp + s.vx * 0.6, rand(1, 3.5) * sp, rz * rand(2, 5) * sp + s.vz * 0.6, rand(1.2, 2.2), 2 + s.B * 0.08, 5 + s.B * 0.25, L * 0.9, L * 0.92, L * 0.95, 0.55 * sp + 0.1, 0.8, -6);
      const sx = s.x - fx(s.h) * s.L * 0.5, sz = s.z - fz(s.h) * s.L * 0.5;
      fxSpray.emit(sx + rand(-2, 2), 0.6, sz + rand(-2, 2), -s.vx * 0.2 + rand(-1, 1), rand(0.5, 2), -s.vz * 0.2 + rand(-1, 1), rand(1.5, 3), 3, 7 + s.B * 0.3, L, L, L, 0.35 * sp, 0.5, -3);
    }
  }
  // Heavy seas: when the bow drops into a rising swell it throws solid water up and over the forecastle
  if (!s.isSub && !s.dead && SEA.amp >= 4 && s.L < 200 && s.speed > 4) {
    const l = s.L * 0.42, bx = s.x + fx(s.h) * l, bz = s.z + fz(s.h) * l;
    const rel = swellH(bx, bz) - (s.obj.position.y + Math.sin(s.pitch) * l);
    const rate = s.bowRel === undefined ? 0 : (rel - s.bowRel) / Math.max(dt, 1e-3);
    s.bowRel = rel;
    s.slamCd = (s.slamCd || 0) - dt;
    if (rate > SLAM_RATE && s.slamCd <= 0) {
      bowSlam(s, clamp((rate - SLAM_RATE) / 1.4, 0.15, 1) * clamp(s.speed / s.maxSpeed * 1.4, 0.35, 1), bx, bz, L);
      s.slamCd = rand(3.5, 6);
    }
  }
  // Funnel exhaust haze
  for (const f of s.model.funnels) {
    if (Math.random() < dt * 2.5) {
      _v.copy(f); s.obj.localToWorld(_v);
      const d = 0.28 * L;
      fxSmoke.emit(_v.x, _v.y, _v.z, rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5), rand(5, 8), 2.5, rand(12, 20), d, d, d * 1.02, 0.12, 0.25, 0.4);
    }
  }
  // Fires and smoke from battle damage
  if (s.fires.length && (!s.dead || s.sinkY < s.top + 4)) {
    s.fireAcc += dt * 18;
    while (s.fireAcc > 1) {
      s.fireAcc -= 1;
      const f = pick(s.fires);
      _v.copy(f); s.obj.localToWorld(_v);
      fxFire.emit(_v.x + rand(-1.5, 1.5), _v.y + rand(0, 1), _v.z + rand(-1.5, 1.5), rand(-1, 1), rand(4, 9), rand(-1, 1), rand(0.4, 0.9), rand(2, 4), rand(5, 9), 4, 2.0, 0.7, 0.85, 0.6, 2, 0.7);
      if (Math.random() < 0.45) {
        const d = rand(0.03, 0.07) * L;
        fxSmoke.emit(_v.x, _v.y + 3, _v.z, rand(-1, 1), rand(5, 9), rand(-1, 1), rand(9, 18), rand(5, 8), rand(40, 80), d, d, d, 0.8, 0.12, 0.6);
      }
    }
    if (Math.random() < dt * 0.6) { _v.copy(pick(s.fires)); s.obj.localToWorld(_v); flashLight(_v.x, _v.y + 3, _v.z, 0xff8030, 3e5, 0.6); }
  }
}

const SLAM_RATE = 1.25;
function bowSlam(s, k, bx, bz, L) {
  const rx = Math.cos(s.h), rz = Math.sin(s.h), deck = s.obj.position.y + s.P.F * 0.7;
  const n = Math.round(30 + 70 * k), W = Math.min(1, 0.55 + L * 0.6);
  for (let i = 0; i < n; i++) {
    const side = Math.random() < 0.5 ? -1 : 1, w = rand(0.5, s.B * 0.5), out = rand(2, 10) * k, up = rand(6, 20) * (0.45 + k * 0.75), aft = rand(1, 6);
    fxSpray.emit(bx + rx * side * w - fx(s.h) * rand(0, 8), deck + rand(-1, 1.5), bz + rz * side * w - fz(s.h) * rand(0, 8),
      rx * side * out + s.vx * 0.85 - fx(s.h) * aft, up, rz * side * out + s.vz * 0.85 - fz(s.h) * aft,
      rand(1.8, 3.4), rand(2.5, 5), rand(9, 20) * (0.6 + k * 0.6), W * 0.94, W * 0.97, W, 0.7 + 0.3 * k, 0.4, -9.8);
  }
  // Sheets of white water peeling off the flare on both sides
  for (const side of [-1, 1]) for (let i = 0; i < 10 + 14 * k; i++) {
    const t = rand(0, 18);
    fxSpray.emit(bx - fx(s.h) * t + rx * side * s.B * 0.45, 1, bz - fz(s.h) * t + rz * side * s.B * 0.45,
      rx * side * rand(4, 9) + s.vx * 0.9, rand(3, 8) * k + 2, rz * side * rand(4, 9) + s.vz * 0.9,
      rand(1.2, 2.2), 3, rand(8, 14), W * 0.94, W * 0.97, W, 0.75, 0.5, -9.8);
  }
  s.slams = (s.slams || 0) + 1;
  if (s.player) {
    sfx('splash', 0.5 + k * 0.7);
    PL.shake = Math.min(3, PL.shake + k * 0.6);
    if (k > 0.5) PL.lensWet = Math.max(PL.lensWet || 0, 0.3 + 0.7 * k);
  } else if (camera.position.distanceToSquared(_v.set(bx, 0, bz)) < 2500 * 2500) sfxAt('splash', bx, 0, bz, 0.5 + k);
}
function sinkStep(s, dt) {
  s.deadT += dt;
  s.speed *= 1 - 0.25 * dt;
  s.x += fx(s.h) * s.speed * dt; s.z += fz(s.h) * s.speed * dt;
  if (s.isSub) {
    s.sinkY += dt * 2;
    if (s.deadT > 6) { s.sunk = true; removeShip(s); }
    return;
  }
  s.listAng = Math.min(0.5, s.deadT * 0.018 + Math.max(0, s.deadT - 10) * 0.02);
  s.pitchAng = Math.min(0.22, s.deadT * 0.007);
  s.sinkY = s.deadT < 8 ? s.deadT * 0.12 : 0.96 + Math.pow(s.deadT - 8, 1.6) * 0.1;
  if (s.deadT < 14 && Math.random() < dt * 0.9) {
    _v.set(rand(-s.L * 0.35, s.L * 0.35), s.P.F + 2, rand(-2, 2)); s.obj.localToWorld(_v);
    fxExplosion(_v.x, _v.y, _v.z, rand(0.6, 1.3));
    if (s.fires.length < 7) s.fires.push(new V3(rand(-s.L * 0.4, s.L * 0.4), s.P.F + 1, 0));
  }
  if (s.wake) s.wake.update(dt, s.x, s.z, s.h, s.speed, s.L * 0.47);
  shipEffects(s, dt);
  // Burning fuel spreading on the water
  if (s.deadT < 45 && Math.random() < dt * 12) {
    const r = s.L * (0.3 + s.deadT * 0.012), a = rand(TAU);
    const ox = s.x + Math.cos(a) * rand(0, r), oz = s.z + Math.sin(a) * rand(0, r) * 0.5;
    fxFire.emit(ox, 0.8, oz, 0, rand(1, 3), 0, rand(0.8, 1.6), rand(3, 5), rand(6, 10), 3.5, 1.5, 0.5, 0.75, 0.5, 1, 0.8);
    if (Math.random() < 0.35) { const L = 0.05 * (0.4 + LIT() * 0.6); fxSmoke.emit(ox, 3, oz, 0, rand(4, 7), 0, rand(12, 20), 6, rand(40, 70), L, L, L, 0.85, 0.1, 0.5); }
  }
  if (s.sinkY > s.top + s.P.D + 10 || s.deadT > 70) {
    s.sunk = true;
    const L = 0.4 + LIT() * 0.6;
    for (let i = 0; i < 25; i++) fxSpray.emit(s.x + rand(-s.L / 3, s.L / 3), 0.5, s.z + rand(-10, 10), rand(-2, 2), rand(2, 6), rand(-2, 2), rand(4, 8), 6, 22, L, L, L, 0.6, 0.4, -2);
    removeShip(s);
  }
}

function damageShip(s, amt, p, src, kind) {
  if (s.dead || s.safe) return;
  s.hp -= amt;
  if (p && amt >= 5 && kind !== 'ground') addScar(s, p, amt);
  if (s.player) onPlayerHit(amt, p, kind, src);
  if (src && src.player && kind !== 'ground') { PL.stats.hits++; hitMark(amt >= 25, false); }
  if (p && amt >= 20 && s.fires.length < 5 && !s.isSub && Math.random() < 0.55) {
    const lp = s.obj.worldToLocal(p.clone());
    lp.x = clamp(lp.x, -s.L * 0.45, s.L * 0.45); lp.y = Math.max(lp.y, s.P.F * 0.9); lp.z = clamp(lp.z, -s.B * 0.4, s.B * 0.4);
    s.fires.push(lp);
  }
  if (s.hp <= 0) killShip(s, src);
}
/* Scars: hits leave holes and soot on the plating, projected onto the hull where the ray from outboard meets it. */
const SCAR = { mats: null, budget: 0 };
const _ray = new THREE.Raycaster(), _scarO = new THREE.Object3D();
function scarMats() {
  if (!SCAR.mats) SCAR.mats = [scarTex(false), scarTex(true)].map(map => stdMat({ map, transparent: true, depthWrite: false, roughness: 0.95, metalness: 0.05 }));
  return SCAR.mats;
}
// Only triangles near the hit go to DecalGeometry, which would otherwise walk the whole merged hull.
function scarPatch(mesh, centre, R, nWorld) {
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal;
  if (!pos || !nor || pos.isInterleavedBufferAttribute || nor.isInterleavedBufferAttribute) return null;
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const c = centre.clone().applyMatrix4(inv), nl = nWorld.clone().transformDirection(inv);
  const pa = pos.array, na = nor.array, ia = g.index ? g.index.array : null, n = ia ? ia.length : pos.count;
  const P = [], N = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const a = (ia ? ia[i] : i) * 3, b = (ia ? ia[i + 1] : i + 1) * 3, d = (ia ? ia[i + 2] : i + 2) * 3;
    if (Math.max(pa[a], pa[b], pa[d]) < c.x - R || Math.min(pa[a], pa[b], pa[d]) > c.x + R) continue;
    if (Math.max(pa[a + 1], pa[b + 1], pa[d + 1]) < c.y - R || Math.min(pa[a + 1], pa[b + 1], pa[d + 1]) > c.y + R) continue;
    if (Math.max(pa[a + 2], pa[b + 2], pa[d + 2]) < c.z - R || Math.min(pa[a + 2], pa[b + 2], pa[d + 2]) > c.z + R) continue;
    // Faces seen edge-on would smear the texture into streaks
    if (Math.abs((na[a] + na[b] + na[d]) * nl.x + (na[a + 1] + na[b + 1] + na[d + 1]) * nl.y + (na[a + 2] + na[b + 2] + na[d + 2]) * nl.z) < 0.75) continue;
    for (const k of [a, b, d]) { P.push(pa[k], pa[k + 1], pa[k + 2]); N.push(na[k], na[k + 1], na[k + 2]); }
  }
  if (!P.length) return null;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  sg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  const m = new THREE.Mesh(sg); m.matrixWorld.copy(mesh.matrixWorld);
  return m;
}
function addScar(s, p, amt) {
  if (s.isSub || s.dead || (s.scars || 0) >= 18 || SCAR.budget > 3) return;
  if (camera.position.distanceToSquared(p) > 8000 * 8000) return;
  const lp = s.obj.worldToLocal(p.clone());
  const side = lp.z >= 0 ? 1 : -1;
  const o = new V3(clamp(lp.x, -s.L * 0.46, s.L * 0.46), clamp(lp.y, 0.7, s.top), side * (s.B + 25)).applyMatrix4(s.obj.matrixWorld);
  const dir = new V3(0, rand(-0.12, 0.04), -side).normalize().transformDirection(s.obj.matrixWorld);
  _ray.set(o, dir); _ray.far = s.B + 60;
  const hit = _ray.intersectObject(s.obj, true).find(h => h.object.isMesh && !h.object.isInstancedMesh && h.face && !h.object.userData.scar && !h.object.userData.decal && !h.object.userData.noScar && h.object.material && !h.object.material.transparent);
  if (!hit) return;
  const big = amt >= 25;
  const sz = Math.min(big ? clamp(5 + amt * 0.06, 6, 11) : rand(2.6, 3.6), Math.max(2.4, s.L * 0.15));
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (n.dot(dir) > 0) n.negate();
  _scarO.position.copy(hit.point); _scarO.lookAt(hit.point.clone().add(n)); _scarO.rotation.z += rand(-0.2, 0.2);
  const src = scarPatch(hit.object, hit.point, sz * 0.75, n);
  if (!src) return;
  const geo = new DecalGeometry(src, hit.point, _scarO.rotation, new V3(sz, sz, Math.max(2.5, sz * 0.6)));
  src.geometry.dispose();
  if (!geo.attributes.position.count) { geo.dispose(); return; }
  // The log depth buffer ignores polygon offset, so lift the scar off the plating instead.
  geo.translate(n.x * 0.1, n.y * 0.1, n.z * 0.1);
  geo.applyMatrix4(new THREE.Matrix4().copy(hit.object.matrixWorld).invert());
  const m = new THREE.Mesh(geo, scarMats()[big ? 1 : 0]);
  m.userData.scar = true; m.receiveShadow = true; m.renderOrder = 1;
  hit.object.add(m);
  s.scars = (s.scars || 0) + 1;
  SCAR.budget++;
}
function killShip(s, src) {
  s.dead = true; s.hp = 0; s.killedBy = src; s.order = 0;
  if (s.isSub) {
    fxSplash(s.x, s.z, 4);
    const L = 0.3 + LIT() * 0.5;
    for (let i = 0; i < 30; i++) fxSmoke.emit(s.x + rand(-40, 40), 0.3, s.z + rand(-40, 40), 0, 0.2, 0, rand(20, 40), 10, 40, 0.05 * L, 0.05 * L, 0.04 * L, 0.5, 0.1, 0);
  } else {
    fxExplosion(s.x, s.P.F + 4, s.z, s.L > 100 ? 2.6 : 1.5, 2);
    if (s.fires.length < 4) s.fires.push(new V3(0, s.P.F + 2, 0), new V3(s.L * 0.25, s.P.F + 1, 0));
  }
  onShipKilled(s, src);
}

/* ------------------------------------------------------------------ */
/* Gunnery                                                             */
/* ------------------------------------------------------------------ */
const G = 9.81, SHELL_V = 880;
function solveBallistic(from, to, v) {
  const dx = Math.max(1, Math.hypot(to.x - from.x, to.z - from.z)), dy = to.y - from.y, v2 = v * v;
  const disc = v2 * v2 - G * (G * dx * dx + 2 * dy * v2);
  const el = disc < 0 ? Math.PI / 4 : Math.atan((v2 - Math.sqrt(disc)) / (G * dx));
  const az = Math.atan2(to.x - from.x, -(to.z - from.z));
  return { el, az, t: dx / (v * Math.cos(el)) };
}
const velFrom = (el, az, v) => new V3(Math.cos(el) * Math.sin(az) * v, Math.sin(el) * v, -Math.cos(el) * Math.cos(az) * v);
function leadSolve(from, t, v, aimY) {
  const p = new V3(t.x, aimY, t.z);
  let sol = solveBallistic(from, p, v);
  for (let i = 0; i < 4; i++) {
    p.set(t.x + (t.vx || 0) * sol.t, aimY + (t.vy || 0) * sol.t, t.z + (t.vz || 0) * sol.t);
    if (t.isAir || t.isMissile) p.y = Math.max(2, p.y);
    sol = solveBallistic(from, p, v);
  }
  return { p, ...sol };
}
function turretMuzzle(s, i) {
  const tr = s.model.turrets[i]; if (!tr) return null;
  const pv = pivotOf(tr.obj);
  return pv.localToWorld(new V3(tr.obj.userData.muzzle || 6, 0, 0));
}
function aimTurret(s, i, az, el, dt, rate = 0.8) {
  const st = s.turretState[i], tr = s.model.turrets[i]; if (!tr) return 0;
  const rel = wrapPi(az - s.h);
  const diff = wrapPi(rel - st.yaw);
  st.yaw = wrapPi(st.yaw + clamp(diff, -rate * dt, rate * dt));
  st.el = lerp(st.el, clamp(el, -0.05, 1.2), clamp(dt * 3, 0, 1));
  tr.obj.rotation.y = -st.yaw + (tr.aft ? 0 : 0);
  pivotOf(tr.obj).rotation.z = st.el;
  return Math.abs(wrapPi(rel - st.yaw));
}
function turretArc(s, i, az) {
  const tr = s.model.turrets[i]; if (!tr) return false;
  const rel = wrapPi(az - s.h);
  return tr.aft ? Math.abs(wrapPi(rel - Math.PI)) < 2.55 : Math.abs(rel) < 2.55;
}
function fireShell(owner, from, vel, dmg, o = {}) {
  W.shells.push({ p: from.clone(), v: vel, side: owner.side, dmg, owner, t: 0, aa: !!o.aa, whistle: false, star: !!o.star });
  const dir = vel.clone().normalize();
  fxMuzzle(from, dir, o.small ? 0.6 : 1.2);
  if (!o.small && Math.hypot(from.x - camera.position.x, from.z - camera.position.z) < 4000) {
    const L = 0.6 + LIT() * 0.4, bx = from.x + dir.x * 6, bz = from.z + dir.z * 6;
    for (let i = 0; i < 18; i++) { const a = rand(TAU), sp = rand(10, 22); fxSpray.emit(bx + Math.cos(a) * 3, 0.4, bz + Math.sin(a) * 3, Math.cos(a) * sp, rand(0.5, 2), Math.sin(a) * sp, rand(0.6, 1.2), 2, 6, L, L, L, 0.35, 2.2, -2); }
  }
  sfxAt('gun', from.x, from.y, from.z);
  if (owner.player) { PL.shake += 0.35; PL.stats.shells++; }
}

function updateShells(dt) {
  const cam = camera.getWorldPosition(_v2);
  for (const sh of W.shells) {
    sh.t += dt;
    const sp = sh.v.length(), steps = Math.max(1, Math.ceil(sp * dt / 10)), h = dt / steps;
    const x0 = sh.p.x, y0 = sh.p.y, z0 = sh.p.z;
    for (let k = 0; k < steps && !sh.dead; k++) {
      sh.v.y -= G * h;
      sh.p.addScaledVector(sh.v, h);
      if (sh.star && (sh.v.y < 0 || sh.t > 6)) { W.flares.push({ p: sh.p.clone(), t: 32, light: flashLight(sh.p.x, sh.p.y, sh.p.z, 0xfff1d0, 3.5e7, 2, 30) }); sh.dead = true; break; }
      // Proximity fuze against aircraft and missiles
      if (sh.aa) {
        for (const a of W.jets) if (a.side !== sh.side && !a.dead && a.p.distanceToSquared(sh.p) < 1200) { airburst(sh.p); if (Math.random() < 0.7) killJet(a, sh.owner); sh.dead = true; break; }
        if (!sh.dead) for (const m of W.missiles) if (m.side !== sh.side && !m.dead && m.p.distanceToSquared(sh.p) < 500) { airburst(sh.p); if (Math.random() < 0.55) killMissile(m, sh.owner); sh.dead = true; break; }
        if (sh.dead) break;
      }
      if (sh.p.y < 40) {
        for (const s of W.ships) {
          if (s.side === sh.side || s.isSub || s.sunk) continue;
          if (s.hits(sh.p, 0.5)) {
            fxExplosion(sh.p.x, sh.p.y + 1, sh.p.z, 0.55, 0.6);
            damageShip(s, sh.dmg, sh.p, sh.owner, 'shell');
            sh.dead = true; break;
          }
        }
      }
      if (!sh.dead && sh.p.y <= 0) {
        if (landAt(sh.p.x, sh.p.z)) fxExplosion(sh.p.x, 2, sh.p.z, 0.4, 0.8);
        else fxSplash(sh.p.x, sh.p.z, 1);
        sh.dead = true;
      }
    }
    if (sh.t > 70) sh.dead = true;
    if (!sh.dead) {
      const r = sh.side === PL.side ? 1 : 1;
      tracer(x0, y0, z0, sh.p.x, sh.p.y, sh.p.z, 3.5 * r, 1.6 * r, 0.6 * r);
      if (Math.hypot(sh.p.x - cam.x, sh.p.z - cam.z) < 6000) fxSpark.emit(sh.p.x, sh.p.y, sh.p.z, 0, 0, 0, 0.03, 1.4, 1.4, 4, 2, 0.8, 1);
      if (!sh.whistle && sh.side !== PL.side && sh.v.y < 0 && PL.ship && Math.hypot(sh.p.x - PL.ship.x, sh.p.z - PL.ship.z) < 950) { sh.whistle = true; sfx('whistle', 1); }
    }
  }
  W.shells = W.shells.filter(s => !s.dead);
  // Close-in gun rounds: purely visual streaks
  for (const r of W.rounds) {
    r.t -= dt;
    const x0 = r.p.x, y0 = r.p.y, z0 = r.p.z;
    r.p.addScaledVector(r.v, dt);
    tracer(x0, y0, z0, r.p.x, r.p.y, r.p.z, 3.2, 1.2, 0.4);
  }
  W.rounds = W.rounds.filter(r => r.t > 0);
}
function airburst(p) {
  fxFire.emit(p.x, p.y, p.z, 0, 0, 0, 0.12, 4, 10, 5, 3, 1.5, 1);
  const L = 0.2 + LIT() * 0.4;
  for (let i = 0; i < 5; i++) fxSmoke.emit(p.x + rand(-2, 2), p.y + rand(-2, 2), p.z + rand(-2, 2), rand(-2, 2), rand(-1, 1), rand(-2, 2), rand(3, 6), 3, rand(8, 12), 0.08 * L, 0.08 * L, 0.08 * L, 0.9, 0.5, 0.2);
  sfxAt('boom', p.x, p.y, p.z, 0.4);
}

/* ------------------------------------------------------------------ */
/* Missiles, jets, torpedoes                                           */
/* ------------------------------------------------------------------ */
const _up = new V3(1, 0, 0);
function launchMissile(kind, owner, from, dir, target, o = {}) {
  const m = {
    kind, side: owner.side, owner, p: from.clone(), d: dir.clone().normalize(), target, isMissile: true,
    speed: o.speed0 ?? (kind === 'sam' ? 90 : 35), max: o.max ?? { asm: 270, sam: 820, asroc: 300, bm: 1700 }[kind],
    t: 0, life: { asm: 110, sam: 16, asroc: 45, bm: 30 }[kind], boost: o.boost ?? (kind === 'asm' ? 1.5 : 0.5),
    dmg: o.dmg ?? 0, pk: o.pk ?? 0.7, alt: rand(6, 11), decoy: null, aim: o.aim ? o.aim.clone() : null, trail: 0, dead: false, vx: 0, vy: 0, vz: 0,
    prof: o.prof ? ASM[o.prof] : null, ph: rand(TAU), lost: false, pd: !!o.pd, via: o.via ? o.via.clone() : null,
  };
  if (m.prof) { m.max = m.prof.cruise; m.alt = m.prof.alt + rand(-1, 1.5); if (!o.dmg) m.dmg = m.prof.dmg; }
  if (m.pd) { m.max = 1000; m.life = 7; }
  m.obj = missileMesh();
  if (kind === 'sam') m.obj.scale.setScalar(0.8);
  if (kind === 'bm') m.obj.scale.setScalar(2.2);
  scene.add(m.obj);
  W.missiles.push(m);
  if (target) target.inbound = (target.inbound || 0) + 1;
  const L = 0.5 + LIT() * 0.5;
  for (let i = 0; i < 26; i++) fxSmoke.emit(from.x + rand(-3, 3), from.y + rand(-1, 2), from.z + rand(-3, 3), rand(-6, 6), rand(1, 8), rand(-6, 6), rand(4, 9), 4, rand(14, 26), 0.75 * L, 0.75 * L, 0.76 * L, 0.6, 0.6, 0.3);
  flashLight(from.x, from.y, from.z, 0xffc080, 6e5, 0.8);
  sfxAt('launch', from.x, from.y, from.z);
  if (owner.player) PL.stats.msl++;
  return m;
}
function killMissile(m, by) {
  if (m.dead) return;
  m.dead = true;
  fxExplosion(m.p.x, m.p.y, m.p.z, 0.35, 0.5);
  if (by && by.player && m.side !== PL.side) { PL.stats.intercepts++; if (m.prof) radio('Weapons', `Splash one ${m.prof.name}.`, 'good'); }
  else if (m.owner && m.owner.player && by && !by.player) radio('Weapons', `Our ${m.prof ? m.prof.name : 'missile'} was shot down by ${by.name || 'enemy defences'}.`, 'bad');
}
function dropMissile(m) { scene.remove(m.obj); if (m.target && m.target.inbound) m.target.inbound--; if (m.onDone) m.onDone(); }
const _d = new V3();
function updateMissiles(dt) {
  for (const m of W.missiles) {
    if (m.dead) continue;
    m.t += dt;
    if (m.kind === 'bm') {
      m.p.addScaledVector(m.d, m.max * dt);
      fxSpark.emit(m.p.x, m.p.y, m.p.z, 0, 0, 0, 0.05, 6, 6, 6, 4, 2, 1);
      const L = 0.5 + LIT() * 0.5;
      if (Math.random() < 0.6) fxSmoke.emit(m.p.x, m.p.y + 20, m.p.z, 0, 0, 0, 6, 6, 18, 0.8 * L, 0.8 * L, 0.8 * L, 0.5, 0.1, 0);
      if (m.p.y <= 1) {
        m.dead = true;
        fxExplosion(m.p.x, 4, m.p.z, 4, 2); fxSplash(m.p.x, m.p.z, 4);
        GRADE.flash.value = Math.max(GRADE.flash.value, 0.25);
        for (const s of W.ships) if (s.side !== m.side && !s.dead) { const d = Math.hypot(s.x - m.p.x, s.z - m.p.z); if (d < 120) damageShip(s, 1100 * clamp(1.15 - d / 120, 0.3, 1), m.p, m.owner, 'bm'); }
      }
    } else {
      const tg = m.target && !m.target.dead && !m.target.sunk ? m.target : null;
      // Terminal sprint: YJ-18 and YJ-83 go supersonic for the last few kilometres
      if (m.prof && m.prof.sprint && tg && !tg.isAir && Math.hypot(tg.x - m.p.x, tg.z - m.p.z) < m.prof.sprintAt) m.max = m.prof.sprint;
      m.speed = Math.min(m.max, m.speed + (m.kind === 'sam' ? 700 : m.kind === 'asroc' ? 200 : m.max - m.speed > 200 ? 320 : 140) * dt);
      let aim = null;
      if (m.decoy) aim = m.decoy;
      else if (tg) {
        const tt = m.p.distanceTo(tg.isAir || tg.isMissile ? tg.p : _v.set(tg.x, 0, tg.z)) / m.speed;
        aim = tg.isAir || tg.isMissile ? _v.set(tg.p.x + tg.vx * tt, tg.p.y + (tg.vy || 0) * tt, tg.p.z + tg.vz * tt) : _v.set(tg.x + tg.vx * tt, tg.top * 0.35 + tg.obj.position.y, tg.z + tg.vz * tt);
      } else if (m.aim) aim = m.aim;
      // Dogleg: fly out to a turn point first, so a coordinated salvo arrives from several bearings
      if (m.via && !m.decoy) { if (Math.hypot(m.via.x - m.p.x, m.via.z - m.p.z) < 700) m.via = null; else aim = _v.set(m.via.x, m.alt, m.via.z); }
      if (m.t > m.boost && aim && !m.lost) {
        const dxz = Math.hypot(aim.x - m.p.x, aim.z - m.p.z);
        let ty = aim.y, rate = 3.5;
        if (m.kind === 'asm') { ty = dxz > 1300 ? m.alt : aim.y; rate = dxz > 1300 ? 0.75 : m.speed > 500 ? 1.6 : 2.2; }
        else if (m.kind === 'asroc') { ty = dxz > 900 ? 260 : -10; rate = 1.2; }
        _d.set(aim.x - m.p.x, 0, aim.z - m.p.z).normalize();
        // Terminal weave makes the close-in guns work harder
        if (m.prof && m.prof.weave && dxz < 2600 && dxz > 300) { const w = Math.sin(m.t * 2.7 + m.ph) * 0.42, c = Math.cos(w), sn = Math.sin(w); _d.set(_d.x * c - _d.z * sn, 0, _d.x * sn + _d.z * c); }
        _d.y = clamp((ty - m.p.y) / Math.max(150, Math.min(dxz, 900)), -0.9, 0.9);
        _d.normalize();
        const ang = Math.acos(clamp(m.d.dot(_d), -1, 1));
        if (ang > 1e-4) m.d.lerp(_d, clamp(rate * dt / ang, 0, 1)).normalize();
      }
      m.p.addScaledVector(m.d, m.speed * dt);
      m.vx = m.d.x * m.speed; m.vy = m.d.y * m.speed; m.vz = m.d.z * m.speed;
      // Exhaust plume
      m.trail -= dt;
      const L = 0.55 + LIT() * 0.45;
      while (m.trail < 0) {
        m.trail += m.kind === 'sam' ? 0.012 : 0.022;
        const k = Math.random() * m.speed * 0.02;
        fxSmoke.emit(m.p.x - m.d.x * (2.5 + k), m.p.y - m.d.y * (2.5 + k), m.p.z - m.d.z * (2.5 + k), rand(-0.5, 0.5), rand(0, 0.6), rand(-0.5, 0.5), m.kind === 'sam' ? rand(2, 3.5) : rand(3, 6), 1.2, rand(5, 9), 0.85 * L, 0.85 * L, 0.86 * L, 0.55, 0.4, 0.15);
      }
      fxFire.emit(m.p.x - m.d.x * 2.8, m.p.y - m.d.y * 2.8, m.p.z - m.d.z * 2.8, 0, 0, 0, 0.05, 1.8, 2.4, 6, 3.6, 1.6, 1);
      // Impacts
      if (m.kind === 'sam') {
        if (tg && m.p.distanceToSquared(tg.isAir || tg.isMissile ? tg.p : tg.pos) < 600) {
          airburst(m.p);
          const fast = tg.isMissile ? clamp(420 / Math.max(1, tg.speed), 0.45, 1.1) : 1;
          if (Math.random() < m.pk * fast) { if (tg.isAir) killJet(tg, m.owner); else killMissile(tg, m.owner); }
          else if (m.owner.player) radio('Weapons', `${m.pd ? 'Point-defence round' : SAM_NAME[PL.side]} missed. Re-engaging.`, 'quiet');
          m.dead = true;
        }
      } else if (m.kind === 'asroc') {
        if (m.p.y <= 0) {
          m.dead = true; fxSplash(m.p.x, m.p.z, 0.8);
          W.pending.push({ t: 4, fn: () => {
            if (tg && tg.isSub && !tg.dead && Math.hypot(tg.x - m.p.x, tg.z - m.p.z) < 650) { fxSplash(tg.x, tg.z, 3.2); damageShip(tg, 240, null, m.owner, 'torp'); tg.reveal = 20; }
            else if (m.owner.player) radio('Sonar', 'Torpedo lost acquisition. No hit.', '');
          } });
        }
      } else {
        for (const s of W.ships) {
          if (s.side === m.side || s.isSub || s.dead) continue;
          if (s.hits(m.p, 3)) { fxExplosion(m.p.x, m.p.y + 2, m.p.z, 1.4, 1.5); damageShip(s, m.dmg, m.p, m.owner, 'asm'); m.dead = true; break; }
        }
        if (!m.dead && m.decoy && m.p.distanceToSquared(m.decoy) < 3600) { airburst(m.p); m.dead = true; }
        if (!m.dead && m.t > m.boost && m.p.y < 0.3) { fxSplash(m.p.x, m.p.z, 1.2); m.dead = true; }
      }
      if (!m.dead && m.lost && m.kind === 'asm' && m.t > m.lostT) { m.d.y -= 0.25 * dt; m.d.normalize(); }
      if (!m.dead && m.t > m.life) { airburst(m.p); m.dead = true; }
    }
    if (!m.dead) { m.obj.position.copy(m.p); m.obj.quaternion.setFromUnitVectors(_up, m.d); }
  }
  for (const m of W.missiles) if (m.dead) dropMissile(m);
  W.missiles = W.missiles.filter(m => !m.dead);
}

const airTargets = () => (W.helo && !W.helo.dead ? [...W.jets, W.helo] : W.jets);
function spawnJet(side, kind, x, z, h, target) {
  const j = { isAir: true, side, kind, name: JET_NAME[kind], p: new V3(x, 650, z), h, speed: 235, alt: 650, state: 'in', target, msl: 1, dead: false, t: 0, bank: 0, pitch: 0, vx: 0, vy: 0, vz: 0, heard: false, fireT: 0 };
  j.obj = jetMesh(kind, side); j.obj.rotation.order = 'YZX';
  scene.add(j.obj);
  W.jets.push(j);
  return j;
}
function killJet(j, by) {
  if (j.dead) return;
  j.dead = true;
  if (j === W.helo && PL.dmgBy) PL.dmgBy['helo:' + (by ? by.cls || by.kind || by.name || '?' : '-')] = 1;
  fxExplosion(j.p.x, j.p.y, j.p.z, 0.9, 1.2);
  W.pending.push({ t: 0, life: 6, p: j.p.clone(), v: new V3(j.vx * 0.5, -10, j.vz * 0.5), fall: true });
  onJetKilled(j, by);
}
function updateJets(dt) {
  for (const j of W.jets) {
    j.t += dt;
    if (!j.target || j.target.dead || j.target.sunk) {
      const c = W.ships.filter(s => s.side !== j.side && !s.dead && !s.isSub);
      j.target = c.sort((a, b) => Math.hypot(a.x - j.p.x, a.z - j.p.z) / (a.priority || 1) - Math.hypot(b.x - j.p.x, b.z - j.p.z) / (b.priority || 1))[0] || null;
    }
    let want = j.h, alt = j.alt;
    const tg = j.target;
    if (j.state === 'in' && tg) {
      const d = Math.hypot(tg.x - j.p.x, tg.z - j.p.z);
      want = bearing(j.p.x, j.p.z, tg.x, tg.z);
      alt = d > 15000 ? 600 : 55;
      if (d < 8500 && j.msl > 0) {
        j.fireT -= dt;
        if (j.fireT <= 0) {
          j.msl--; j.fireT = 0.7;
          const dir = new V3(fx(j.h), -0.05, fz(j.h));
          const dm = (j.side === PL.side ? 0.8 : DIFF[CFG.diff].dmg) * 230;
          launchMissile('asm', j, j.p.clone().add(new V3(0, -2, 0)), dir, tg, { prof: JET_ASM[j.side], dmg: dm, boost: 0.4, speed0: 220 });
        }
      }
      if (j.msl === 0) { j.state = 'out'; j.outH = j.h + (Math.random() < 0.5 ? 1 : -1) * 2.4; }
    } else if (j.state === 'out' || !tg) { want = j.outH ?? j.h; alt = 900; }
    const dh = clamp(wrapPi(want - j.h), -0.45 * dt, 0.45 * dt);
    j.h = wrapPi(j.h + dh);
    j.bank = lerp(j.bank, clamp(dh / Math.max(dt, 1e-3) * 1.6, -1.2, 1.2), clamp(dt * 2, 0, 1));
    const vy = clamp(alt - j.p.y, -45, 35);
    j.p.x += fx(j.h) * j.speed * dt; j.p.z += fz(j.h) * j.speed * dt; j.p.y += vy * dt;
    j.vx = fx(j.h) * j.speed; j.vz = fz(j.h) * j.speed; j.vy = vy;
    j.obj.position.copy(j.p);
    j.obj.rotation.set(j.bank, Math.PI / 2 - j.h, Math.atan2(vy, j.speed));
    const tail = _v.set(-10, 0, 0).applyEuler(j.obj.rotation).add(j.p);
    fxFire.emit(tail.x, tail.y, tail.z, 0, 0, 0, 0.04, 1.6, 2.2, 5, 2.8, 1.4, 0.8);
    const dc = j.p.distanceTo(camera.getWorldPosition(_v2));
    if (!j.heard && dc < 1300) { j.heard = true; sfx('jet', 1); }
    if (j.t > 140 || (j.state === 'out' && dc > 26000)) j.dead = true;
  }
  for (const j of W.jets) if (j.dead) scene.remove(j.obj);
  W.jets = W.jets.filter(j => !j.dead);
}

function launchTorpedo(s, t) {
  const tt = Math.hypot(t.x - s.x, t.z - s.z) / 20;
  const h = bearing(s.x, s.z, t.x + t.vx * tt, t.z + t.vz * tt) + rand(-0.06, 0.06);
  W.torps.push({ p: new V3(s.x, -6, s.z), h, speed: 20, side: s.side, target: t, owner: s, life: 75, decoy: null, foam: 0 });
  s.revealT = 30;
  if (t.player) { radio('Sonar', `Torpedo in the water, bearing ${fmtBrg(bearing(t.x, t.z, s.x, s.z))}. Evade!`, 'bad'); sfx('alarm'); }
}
function updateTorps(dt) {
  for (const tp of W.torps) {
    tp.life -= dt;
    const goal = tp.decoy || (tp.target && !tp.target.dead ? tp.target : null);
    if (goal) {
      const gx = goal.x ?? goal.p.x, gz = goal.z ?? goal.p.z;
      const d = Math.hypot(gx - tp.p.x, gz - tp.p.z), want = bearing(tp.p.x, tp.p.z, gx, gz);
      if (d < 2200 && Math.abs(wrapPi(want - tp.h)) < 1.1) tp.h = wrapPi(tp.h + clamp(wrapPi(want - tp.h), -0.14 * dt, 0.14 * dt));
      if (tp.decoy && d < 60) { fxSplash(tp.p.x, tp.p.z, 1.5); tp.dead = true; continue; }
    }
    tp.p.x += fx(tp.h) * tp.speed * dt; tp.p.z += fz(tp.h) * tp.speed * dt;
    tp.foam -= dt;
    if (tp.foam < 0) {
      tp.foam = 0.1;
      const L = 0.5 + LIT() * 0.5;
      fxSpray.emit(tp.p.x, 0.2, tp.p.z, 0, 0.3, 0, rand(6, 9), 1.5, 4.5, L, L, L, 0.5, 0.5, 0);
    }
    for (const s of W.ships) {
      if (s.side === tp.side || s.isSub || s.dead) continue;
      if (s.hits(_v.set(tp.p.x, -2, tp.p.z), 2)) {
        fxSplash(tp.p.x, tp.p.z, 3.5); fxExplosion(tp.p.x, 2, tp.p.z, 1.2, 1);
        const dm = (tp.side === PL.side ? 1 : DIFF[CFG.diff].dmg) * 360;
        damageShip(s, dm, tp.p, tp.owner, 'torp');
        tp.dead = true; break;
      }
    }
    if (tp.life <= 0 || landAt(tp.p.x, tp.p.z)) tp.dead = true;
  }
  W.torps = W.torps.filter(t => !t.dead);
}

/* Close-in weapon systems engage incoming missiles automatically, one target per gun mount. */
function ciwsMounts(s) {
  if (!s.ciwsState) {
    const pts = s.model.ciwsPts.filter(p => p.type !== 'hq10' && p.type !== 'ram');
    const use = pts.length ? pts : s.model.ciwsPts;
    s.ciwsState = use.map(p => ({ p, t: rand(0.3), target: null, firing: false }));
  }
  return s.ciwsState;
}
function updateCIWS(s, dt) {
  if (s.dead || !s.C.ciws) return;
  const q = s.C.ciws * (s.player || s.side === PL.side ? 1 : DIFF[CFG.diff].ciwsVs / 0.6);
  const mounts = ciwsMounts(s);
  s.ciwsFiring = false;
  for (const mt of mounts) {
    mt.t -= dt;
    if (mt.t <= 0) {
      mt.t = 0.3;
      let best = null, bd = 2100;
      const fwd = mt.p.x >= 0;
      const inArc = (x, z) => { const rel = Math.abs(wrapPi(bearing(s.x, s.z, x, z) - s.h)); return fwd ? rel < 2.8 : rel > 0.35; };
      for (const m of W.missiles) {
        if (m.side === s.side || m.dead || m.kind === 'sam') continue;
        if (mounts.some(o => o !== mt && o.target === m) && mounts.length > 1) continue;
        const d = Math.hypot(m.p.x - s.x, m.p.z - s.z);
        if (d < bd && (m.target === s || d < 900) && inArc(m.p.x, m.p.z)) { bd = d; best = m; }
      }
      if (!best) for (const j of airTargets()) { if (j.side === s.side) continue; const d = j.p.distanceTo(s.pos); if (d < 1500 && d < bd && inArc(j.p.x, j.p.z)) { bd = d; best = j; } }
      mt.target = best;
    }
    const t = mt.target;
    mt.firing = false;
    if (!t || t.dead) continue;
    const d = t.p.distanceTo(s.pos);
    if (d > 2100) continue;
    mt.firing = true; s.ciwsFiring = true;
    _v.copy(mt.p); s.obj.localToWorld(_v);
    const n = Math.random() < 0.6 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const tt = d / 1100;
      const aim = new V3(t.p.x + t.vx * tt + rand(-8, 8), t.p.y + (t.vy || 0) * tt + rand(-6, 6), t.p.z + t.vz * tt + rand(-8, 8));
      const v = aim.sub(_v).normalize().multiplyScalar(1100);
      W.rounds.push({ p: _v.clone(), v, t: Math.min(d / 1100 + 0.15, 2.2) });
    }
    // Fast or weaving missiles are much harder to hit
    const fast = t.isMissile ? clamp(320 / Math.max(1, t.speed), 0.3, 1.15) * (t.prof && t.prof.weave && d < 2600 ? 0.8 : 1) : 0.45;
    const pk = q * (d < 1000 ? 0.45 : 0.15) * fast;
    if (Math.random() < pk * dt) { if (t.isAir) killJet(t, s); else killMissile(t, s); mt.target = null; }
  }
}


/* ------------------------------------------------------------------ */
/* The player's ship, controls and camera                              */
/* ------------------------------------------------------------------ */
const ORDERS = [
  { n: 'Back full', v: -0.45 }, { n: 'Back one-third', v: -0.2 }, { n: 'All stop', v: 0 }, { n: 'Ahead one-third', v: 0.33 },
  { n: 'Ahead two-thirds', v: 0.6 }, { n: 'Ahead standard', v: 0.8 }, { n: 'Ahead full', v: 1.0 }, { n: 'Ahead flank', v: 1.12 },
];
const PL = {
  side: 'ALLIED', ship: null, yaw: 0, pitch: -0.06, zoom: 0, zoomOn: false, fire: false, lock: null, telegraph: 5, rudder: 0,
  asm: 6, sam: 12, asroc: 2, pd: 0, special: 1, chaff: 4, flares: 0, chaffCd: 0, gunCd: 0, shake: 0, dmg: 0, lastHit: -99, salvo: [],
  adMode: 'auto', samCd: 0, pdCd: 0, ecmT: 0, ecmCd: 0, salvoN: 1, lockManual: false, track: false, zoomLevel: 0, zoomF: 1, invertY: false,
  sys: { gun: 100, radar: 100, launchers: 100, engines: 100, steering: 100 }, dcT: 0, dcCd: 0, dcSys: null, heloSorties: 2, heloCd: 0, mcamOn: true, mcamM: null, mcamHold: 0,
  stats: { shells: 0, hits: 0, msl: 0, kills: 0, air: 0, intercepts: 0 }, aimPoint: new V3(), masked: false, aimRay: new THREE.Ray(),
  pointer: false, cursor: { x: 0.5, y: 0.5 }, look: { x: 0, y: 0 }, keys: {}, touch: false, stick: { x: 0, y: 0 }, msg: '',
};
const ray = new THREE.Raycaster();
function pivotOf(obj) { return obj.children.find(c => c.isGroup); }

function setupPlayer(side, x, z, h) {
  const ps = PLAYER_SHIP[side];
  const s = spawnShip(ps.cls, side, { player: true, name: ps.name, no: ps.no, x, z, h, speed: CLASS[ps.cls].speed * 0.8, hpMul: 1000 / CLASS[ps.cls].hp, priority: 1.25 });
  s.order = s.speed;
  PL.ship = s; PL.side = side; PL.dmgBy = {}; PL.shellHits = []; PL.tipEvade = false; PL.lightOn = false; PL.lightTold = false; PL.yaw = 0; PL.pitch = -0.07; PL.telegraph = 5; PL.rudder = 0; PL.lock = null; PL.dmg = 0; PL.shake = 0;
  PL.stats = { shells: 0, hits: 0, msl: 0, kills: 0, air: 0, intercepts: 0 };
  PL.sys = { gun: 100, radar: 100, launchers: 100, engines: 100, steering: 100 };
  PL.dcT = 0; PL.dcCd = 0; PL.ecmT = 0; PL.ecmCd = 0; PL.samCd = 0; PL.pdCd = 0; PL.lockManual = false; PL.track = false; PL.mcamM = null; PL.mcamHold = 0; PL.zoomLevel = 0; PL.zoomF = 1;
  s.baseMax = s.maxSpeed;
  s.obj.add(camera);
  camera.position.set(s.model.eye.x, s.model.eye.y, s.model.eye.z);
  return s;
}

function updatePlayerControls(dt) {
  const s = PL.ship; if (!s) return;
  const K = PL.keys;
  if (!s.dead && MS.t - PL.lastHit > 12 && s.hp < s.maxHp * 0.7) {
    s.hp = Math.min(s.maxHp * 0.7, s.hp + 4 * dt);
    if (s.fires.length && Math.random() < dt / 8) { s.fires.shift(); radio('Damage control', 'Fire is out. Repairs continuing.', 'good'); }
  }
  if (!s.dead) {
    let r = 0;
    if (K.KeyA || K.ArrowLeft) r -= 1;
    if (K.KeyD || K.ArrowRight) r += 1;
    if (PL.touch && Math.abs(PL.stick.x) > 0.2) r = PL.stick.x;
    PL.rudder = r ? clamp(PL.rudder + Math.sign(r - PL.rudder) * 1.1 * dt, -1, 1) : PL.rudder - Math.sign(PL.rudder) * Math.min(Math.abs(PL.rudder), 1.4 * dt);
    if (PL.touch) {
      PL.stickT = (PL.stickT || 0) + dt;
      if (Math.abs(PL.stick.y) > 0.6 && PL.stickT > 0.45) { PL.stickT = 0; telegraph(PL.stick.y < 0 ? 1 : -1); }
    }
    s.rudder = PL.rudder * (0.3 + 0.7 * PL.sys.steering / 100);
    s.order = s.maxSpeed * ORDERS[PL.telegraph].v;
    updateSystems(dt);
  }
  // Padlock view: keep the locked target in the crosshair
  if (PL.track && PL.lock && !PL.lock.dead && !PL.lock.sunk) {
    const t = PL.lock, cp = camera.getWorldPosition(_v3);
    const tx = t.isAir || t.isMissile ? t.p.x : t.x, tz = t.isAir || t.isMissile ? t.p.z : t.z, ty = t.isAir || t.isMissile ? t.p.y : t.obj.position.y + t.top * 0.3;
    const k = clamp(dt * 7, 0, 1);
    PL.yaw += wrapPi(bearing(cp.x, cp.z, tx, tz) - s.h - PL.yaw) * k;
    PL.pitch = lerp(PL.pitch, Math.atan2(ty - cp.y, Math.hypot(tx - cp.x, tz - cp.z)), k);
  } else if (PL.track && (!PL.lock || PL.lock.dead)) PL.track = false;
  // Looking around: pointer lock, or a cursor that pans the view at the screen edges
  if (!PL.pointer && !PL.touch) {
    const ex = PL.cursor.x < 0.08 ? -(0.08 - PL.cursor.x) / 0.08 : PL.cursor.x > 0.92 ? (PL.cursor.x - 0.92) / 0.08 : 0;
    const ey = PL.cursor.y < 0.08 ? -(0.08 - PL.cursor.y) / 0.08 : PL.cursor.y > 0.92 ? (PL.cursor.y - 0.92) / 0.08 : 0;
    const k = 1.6 * camera.fov / 68;
    PL.yaw += ex * k * dt; PL.pitch -= ey * k * 0.6 * dt;
  }
  PL.pitch = clamp(PL.pitch, -0.6, 1.1);
  PL.yaw = wrapPi(PL.yaw);
  // Zoom: scroll wheel steps 1x, 2.5x, 6x, 12x; holding right click gives 7x binoculars
  const zf = PL.zoomOn ? Math.max(7, ZOOMS[PL.zoomLevel]) : ZOOMS[PL.zoomLevel];
  PL.zoomF = lerp(PL.zoomF, zf, clamp(dt * 9, 0, 1));
  camera.fov = 68 / PL.zoomF;
  camera.updateProjectionMatrix();
  PL.zoom = smooth(4, 6.5, PL.zoomF);
  GRADE.scope.value = PL.zoom > 0.02 ? Math.min(1, PL.zoom * 1.3) : 0;
}

const ZOOMS = [1, 2.5, 6, 12];

/* Searchlight (N): a narrow beam from above the bridge that follows your aim. At night it lights up
   targets for you, and shows their gunners exactly where you are. */
const SEARCH = (() => {
  const spot = new THREE.SpotLight(0xe6eeff, 0, 9000, 0.045, 0.45, 2);
  spot.castShadow = false;
  scene.add(spot, spot.target);
  const len = 2600, r = len * Math.tan(0.05);
  const g = new THREE.CylinderGeometry(0.7, r, len, 32, 8, true).translate(0, -len / 2, 0).rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    uniforms: { k: { value: 0 }, len: { value: len }, fogDensity: FOG_U.density },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform float len, fogDensity; varying float vZ, vFog; varying vec3 vN, vW;
      void main(){
        vZ = position.z / len;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * wp; gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
        float d = -mv.z; vFog = 1.0 - exp(-fogDensity * fogDensity * d * d);
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float k; varying float vZ, vFog; varying vec3 vN, vW;
      void main(){
        #include <logdepthbuf_fragment>
        // Brightest where we look through the most lit air, fading along the beam and into the haze
        float face = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
        float a = k * pow(face, 1.4) * pow(1.0 - vZ, 1.7) * smoothstep(0.0, 0.006, vZ) * (1.0 - vFog);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(g, m);
  beam.frustumCulled = false; beam.renderOrder = 6; beam.visible = false;
  beam.layers.set(1);
  scene.add(beam);
  return { spot, beam, level: 0, dir: new V3(0, 0, -1), o: new V3(), t: new V3() };
})();
function updateSearchlight(dt) {
  const on = PL.lightOn && PL.ship && !PL.ship.dead && state === 'play';
  SEARCH.level = lerp(SEARCH.level, on ? 1 : 0, clamp(dt * 6, 0, 1));
  const lv = SEARCH.level;
  SEARCH.spot.intensity = lv * 1.0e7;
  SEARCH.beam.visible = lv > 0.01;
  if (lv < 0.01) return;
  const o = camera.getWorldPosition(SEARCH.o); o.y += 4;
  SEARCH.dir.lerp(PL.aimRay.direction, clamp(dt * 8, 0, 1)).normalize();
  SEARCH.spot.position.copy(o);
  SEARCH.spot.target.position.copy(o).addScaledVector(SEARCH.dir, 200);
  SEARCH.spot.target.updateMatrixWorld();
  SEARCH.beam.position.copy(o);
  SEARCH.beam.lookAt(SEARCH.t.copy(o).add(SEARCH.dir));
  SEARCH.beam.material.uniforms.k.value = lv * (0.006 + SEA.night * 0.05 + SEA.rain * 0.04) * (SEA.night ? 1 : 1 - SEA.light * 0.6);
}
function lightKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  PL.lightOn = !PL.lightOn;
  sfx('blip', 1, 0, PL.lightOn ? 660 : 440);
  if (PL.lightOn && SEA.night && !PL.lightTold) { PL.lightTold = true; radio('Navigator', 'Searchlight on. It lights them up for us, and shows their gunners exactly where we are.', 'tip'); }
  else flashMsg(PL.lightOn ? 'Searchlight on' : 'Searchlight off');
}
const _v3 = new V3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _ea = new THREE.Euler();
function updatePlayerCamera(dt) {
  const s = PL.ship; if (!s) return;
  PL.shake = Math.max(0, PL.shake - dt * 2.2);
  const sh = PL.shake * PL.shake * 0.03;
  const e = s.model.eye;
  camera.position.set(e.x + rand(-sh, sh), e.y + rand(-sh, sh), e.z + rand(-sh, sh));
  // Cancel part of the ship's roll and pitch, the way your legs would.
  _qa.setFromEuler(_ea.set(-(s.roll + s.heel) * 0.45, 0, -s.pitch * 0.45, 'XYZ'));
  _qb.setFromEuler(_ea.set(PL.pitch + rand(-sh, sh) * 0.01, -Math.PI / 2 - PL.yaw, 0, 'YXZ'));
  camera.quaternion.copy(_qa).multiply(_qb);
}

function telegraph(d) {
  PL.telegraph = clamp(PL.telegraph + d, 0, ORDERS.length - 1);
  radio('Helm', `${ORDERS[PL.telegraph].n}, aye.`, 'quiet');
  sfx('blip', 1, 0, 880);
}

/* Aiming and target lock */
const _ndc = new THREE.Vector2();
function aimUpdate() {
  const s = PL.ship;
  if (PL.pointer || PL.touch) _ndc.set(0, 0); else _ndc.set(PL.cursor.x * 2 - 1, -(PL.cursor.y * 2 - 1));
  camera.updateMatrixWorld();
  ray.setFromCamera(_ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  PL.aimRay.copy(ray.ray);
  if (d.y < -0.0004) { const t = Math.min(-o.y / d.y, 22000); PL.aimPoint.copy(o).addScaledVector(d, t); if (t >= 22000) PL.aimPoint.y = 0; }
  else PL.aimPoint.copy(o).addScaledVector(d, 22000).setY(0);
  // Lock the hostile contact closest to the crosshair
  const fovK = camera.fov / 68;
  let best = null, ba = 3.6 * DEG * fovK;
  const keep = PL.lock && !PL.lock.dead && !PL.lock.sunk ? 7 * DEG * fovK : 0;
  const consider = (t, p) => {
    _v.copy(p).sub(o); const dist = _v.length(); if (dist > radarReach() || dist < 30) return;
    const a = _v.normalize().angleTo(d);
    const lim = t === PL.lock ? Math.max(keep, ba) : ba;
    if (a < lim) { if (!best || a < ba || t === PL.lock) { best = t; ba = Math.min(a, ba); } }
  };
  for (const t of W.ships) if (!t.dead && hostile(t, s) && t.detected) consider(t, _v2.set(t.x, t.obj.position.y + t.top * 0.35, t.z));
  for (const j of W.jets) if (hostile(j, s)) consider(j, j.p);
  for (const m of W.missiles) if (hostile(m, s) && m.kind !== 'sam') consider(m, m.p);
  // A target picked with T stays locked until you put the crosshair right on another one
  if (PL.lockManual && PL.lock && !PL.lock.dead && !PL.lock.sunk) {
    if (best && best !== PL.lock && ba < 1.2 * DEG * fovK) { PL.lockManual = false; } else return;
  } else PL.lockManual = false;
  if (best !== PL.lock) { PL.lock = best; if (best) sfx('blip', 1, 0, 1320); }
}
function cycleTarget(dir = 1) {
  const s = PL.ship; if (!s || state !== 'play') return;
  const maxR = radarReach();
  const list = [
    ...W.jets.filter(j => hostile(j, s)),
    ...W.ships.filter(t => hostile(t, s) && !t.dead && t.detected),
  ].map(o => ({ o, d: o.isAir || o.isMissile ? o.p.distanceTo(s.pos) : Math.hypot(o.x - s.x, o.z - s.z) })).filter(e => e.d < maxR).sort((a, b) => a.d - b.d).map(e => e.o);
  if (!list.length) { flashMsg('No contacts to lock'); return; }
  const i = list.indexOf(PL.lock);
  PL.lock = list[(i + dir + list.length) % list.length];
  PL.lockManual = true;
  sfx('blip', 1, 0, 1320);
}

function playerWeapons(dt) {
  const s = PL.ship; if (!s || s.dead) return;
  PL.gunCd -= dt; PL.chaffCd -= dt;
  // Fire control: lead the locked target, otherwise fire at the sea under the crosshair
  let sol = null, aa = false;
  const muzzleRef = turretMuzzle(s, 0) || s.pos;
  if (PL.lock) {
    const t = PL.lock;
    aa = !!(t.isAir || t.isMissile);
    sol = aa ? leadSolve(muzzleRef, { x: t.p.x, z: t.p.z, vx: t.vx, vz: t.vz, vy: t.vy, isAir: true }, SHELL_V, t.p.y) : leadSolve(muzzleRef, t, SHELL_V, t.obj.position.y + t.top * 0.22);
  } else sol = solveBallistic(muzzleRef, PL.aimPoint, SHELL_V);
  PL.solution = sol;
  // Pick a mount that can bear
  let gi = -1;
  for (let i = 0; i < s.model.turrets.length; i++) if (turretArc(s, i, sol.az)) { gi = i; break; }
  PL.masked = gi < 0;
  for (let i = 0; i < s.model.turrets.length; i++) {
    const err = aimTurret(s, i, i === gi ? sol.az : s.h + (s.model.turrets[i].aft ? Math.PI : 0), i === gi ? sol.el : 0.05, dt, 0.9);
    if (i === gi && PL.fire && PL.gunCd <= 0 && err < 0.05 && sysOK('gun')) {
      const m = turretMuzzle(s, i);
      // Heavy seas spoil the gun's aim as the ship rolls
      const sea = 1 + SEA.amp * 0.22 + Math.abs(s.rollS || 0) * 20;
      const v = velFrom(sol.el + rand(-0.0011, 0.0011) * sea, sol.az + rand(-0.0014, 0.0014) * sea, SHELL_V);
      fireShell(s, m, v, 55, { aa });
      PL.gunCd = 1.05;
    }
  }
  // Queued salvo launches
  for (const q of PL.salvo) { q.t -= dt; if (q.t <= 0 && !q.done) { q.done = true; if (!q.target.dead) playerLaunch('asm', q.target, q.prof, q.spread); } }
  PL.salvo = PL.salvo.filter(q => !q.done);
  playerAirDefence(dt);
  PL.ecmT = Math.max(0, PL.ecmT - dt); PL.ecmCd -= dt;
}

function playerLaunch(kind, target, prof, spread = 0) {
  const s = PL.ship;
  const S = SPECS[s.cls];
  const coal = PL.side === 'ALLIED';
  const tx = target.isAir || target.isMissile ? target.p.x : target.x, tz = target.isAir || target.isMissile ? target.p.z : target.z;
  const b = bearing(s.x, s.z, tx, tz);
  let from, dir;
  if (kind === 'asm' && coal && S.canisters) {
    // Kee Lung's anti-ship missiles leave the angled canisters amidships
    from = _v.set(S.canisters[0].x, s.P.deckAt(S.canisters[0].x) + 6, rand(-2, 2)); s.obj.localToWorld(from); from = from.clone();
    dir = new V3(fx(b), 0.35, fz(b));
  } else if (kind === 'pd') {
    const pd = (S.ciws || []).find(c => c.type === 'hq10') || { x: -50, y: 6, z: 0 };
    from = _v.set(pd.x, s.P.deckAt(pd.x) + pd.y + 2, pd.z); s.obj.localToWorld(from); from = from.clone();
    dir = new V3(fx(b), 0.5, fz(b));
  } else if (coal && S.arms) {
    // SM-2s alternate between the forward and aft Mk 26 launchers
    PL.arm = (PL.arm || 0) + 1;
    const a = S.arms[PL.arm % S.arms.length];
    from = _v.set(a.x + 2, s.P.deckAt(a.x) + 3.5, 0); s.obj.localToWorld(from); from = from.clone();
    dir = new V3(fx(b), 0.7, fz(b));
  } else {
    const v = S.vls ? S.vls[(PL.arm = (PL.arm || 0) + 1) % S.vls.length] : { x: 30 };
    from = _v.set(v.x + rand(-3, 3), s.P.deckAt(v.x) + 1.5, rand(-3, 3)); s.obj.localToWorld(from); from = from.clone();
    dir = new V3(0, 1, 0);
  }
  let m;
  let via = null;
  if (spread) { const r = Math.hypot(tx - s.x, tz - s.z) * 0.5; via = new V3(s.x + fx(b + spread) * r, 0, s.z + fz(b + spread) * r); }
  if (kind === 'asm') m = launchMissile('asm', s, from, dir, target, { prof: prof || PLAYER_ASM[PL.side], boost: coal ? 0.8 : 1.6, via });
  else if (kind === 'sam') m = launchMissile('sam', s, from, dir, target, { pk: 0.85, boost: 0.45 });
  else if (kind === 'pd') m = launchMissile('sam', s, from, dir, target, { pk: 0.8, boost: 0.15, pd: true });
  else if (kind === 'asroc') m = launchMissile('asroc', s, from, dir, target, { boost: 1.0 });
  if (m && (kind === 'sam' || kind === 'pd')) { target.samOn = true; m.onDone = () => { target.samOn = false; }; }
  if (m && (kind === 'asm' || kind === 'asroc')) { PL.mcamM = m; }
  return m;
}
function fireMissileKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  if (!sysOK('launchers')) { flashMsg('Missile launchers are damaged. Send a repair team (H)'); return; }
  const t = PL.lock;
  if (!t) { flashMsg('Lock a target first: crosshair on it, or press T'); return; }
  if (t.isAir || t.isMissile) {
    if (PL.sam <= 0) { flashMsg(`No ${SAM_NAME[PL.side]} missiles left`); return; }
    if (t.samOn) { flashMsg('Already engaged'); return; }
    PL.sam--; playerLaunch('sam', t); radio('Weapons', `${SAM_NAME[PL.side]} away, ${t.isAir ? t.name : t.prof ? t.prof.name : 'missile'} engaged.`, 'quiet');
  } else if (t.isSub) {
    if (PL.asroc <= 0) { flashMsg('No anti-submarine rockets left'); return; }
    PL.asroc--; playerLaunch('asroc', t); radio('Weapons', `ASROC away on ${t.name}.`, 'quiet');
  } else {
    const n = Math.min(PL.salvoN, PL.asm);
    if (n <= 0) { flashMsg('No anti-ship missiles left'); return; }
    PL.asm -= n;
    const prof = PLAYER_ASM[PL.side];
    for (let i = 0; i < n; i++) PL.salvo.push({ t: i * 0.6, target: t, prof });
    radio('Weapons', `${n > 1 ? n + ' ' : ''}${ASM[prof].name}${n > 1 ? 's' : ''} away. Target ${t.name}.`, 'quiet');
  }
}
function fireSpecialKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  if (PL.special <= 0) { flashMsg('Special weapon expended'); return; }
  if (PL.side === 'ALLIED') {
    if (!sysOK('launchers')) { flashMsg('Missile launchers are damaged'); return; }
    const tgts = W.ships.filter(t => hostile(t, s) && !t.dead && !t.isSub && t.detected && Math.hypot(t.x - s.x, t.z - s.z) < 32000).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    if (!tgts.length) { flashMsg('No surface targets in range'); return; }
    PL.special--;
    const lockShip = PL.lock && !PL.lock.isAir && !PL.lock.isMissile && !PL.lock.isSub ? PL.lock : null;
    // Eight Harpoons from the two quad launchers, doglegged so they arrive together from a spread of bearings
    const main = lockShip || tgts[0], spread = [-0.6, 0.6, -0.4, 0.4, -0.2, 0.2, -0.05, 0.05];
    for (let i = 0; i < 8; i++) PL.salvo.push({ t: i * 0.35, target: i < 6 || tgts.length < 2 ? main : tgts.find(t => t !== main) || main, prof: 'harpoon', spread: spread[i] });
    radio('Weapons', `Harpoon salvo, eight birds away on ${main.name}. Coordinated attack from several bearings.`, '');
  } else {
    const t = PL.lock && !PL.lock.isAir && !PL.lock.isMissile && !PL.lock.isSub ? PL.lock : null;
    const at = t ? new V3(t.x + t.vx * 6, 0, t.z + t.vz * 6) : PL.aimPoint.clone();
    if (Math.hypot(at.x - s.x, at.z - s.z) < 1500) { flashMsg('Too close to our own ship'); return; }
    PL.special--;
    const m = launchMissile('bm', s, new V3(at.x, 10200, at.z), new V3(0, -1, 0), null, {});
    PL.mcamM = m;
    radio('Rocket Force', `DF-21D launched. Impact at grid ${Math.round(at.x / 100)}/${Math.round(-at.z / 100)} in six seconds.`, '');
  }
}
function salvoKey() { PL.salvoN = PL.salvoN === 1 ? 2 : PL.salvoN === 2 ? 4 : 1; flashMsg(`Anti-ship salvo: ${PL.salvoN} missile${PL.salvoN > 1 ? 's' : ''} per launch`); sfx('blip', 1, 0, 990); }
function adModeKey() {
  PL.adMode = PL.adMode === 'auto' ? 'manual' : 'auto';
  radio('Weapons', PL.adMode === 'auto' ? 'Air defence to automatic. Fire control will engage inbound threats.' : 'Air defence to manual. Missiles only on your order (E).', '');
}
function ecmKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  if (PL.ecmCd > 0) { flashMsg(`Jammer recharging, ${Math.ceil(PL.ecmCd)}s`); return; }
  if (!sysOK('radar')) { flashMsg('Jammer is down with the radar'); return; }
  PL.ecmT = 10; PL.ecmCd = 40;
  let broke = 0;
  for (const m of W.missiles) {
    if (m.target !== s || m.kind !== 'asm' || m.lost) continue;
    if (m.p.distanceTo(s.pos) > 2000 && Math.random() < 0.45) { m.lost = true; m.lostT = m.t + 1.5; m.life = m.t + 14; if (m.target.inbound) m.target.inbound--; m.target = null; broke++; }
  }
  radio('EW', broke ? `Jammer on. ${broke} seeker${broke > 1 ? 's' : ''} broke lock.` : 'Jammer on. Enemy fire-control radars are degraded.', broke ? 'good' : '');
  sfx('blip', 1, 0, 440);
}
function trackKey() {
  if (!PL.lock) { flashMsg('Lock a target to track it'); return; }
  PL.track = !PL.track; flashMsg(PL.track ? `Tracking ${PL.lock.name || 'missile'}` : 'Free look');
}

/* The ship's helicopter: scouts ahead, listens for submarines with dipping sonar, carries one torpedo. */
const HELO_NAME = { ALLIED: 'S-70C Seahawk', PLA: 'Z-9C' };
function heloKey(recall = false) {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  const h = W.helo;
  if (h && !h.dead) {
    if (recall) { if (h.state === 'winch' && MS.raft) MS.raft.state = 'adrift'; h.state = 'rtb'; radio('Air', `${h.name} returning to mother.`, ''); return; }
    if (h.pilot || h.state === 'winch') { flashMsg(`${h.name} is busy with the pilot`); return; }
    h.goal = heloGoal(); h.state = 'transit'; h.goalT = PL.lock && !PL.lock.isAir && !PL.lock.isMissile ? PL.lock : null;
    h.rescue = !h.goalT && !!MS.raft && MS.raft.state === 'adrift';
    radio('Air', `${h.name} retasked, bearing ${fmtBrg(bearing(s.x, s.z, h.goal.x, h.goal.z))}.`, '');
    return;
  }
  if (recall) return;
  if (PL.heloSorties <= 0) { flashMsg('No helicopter sorties left'); return; }
  if (PL.heloCd > 0) { flashMsg(`Helicopter refuelling, ${Math.ceil(PL.heloCd)}s`); return; }
  PL.heloSorties--;
  const S = SPECS[s.cls], hx = S.heli ? S.heli.x : -s.L * 0.27;
  const m = helicopterMesh(PL.side);
  const p = new V3(hx, s.P.deckAt(hx) + (S.heli ? 0.5 : 6.5), 0); s.obj.localToWorld(p);
  W.helo = { isAir: true, side: PL.side, name: HELO_NAME[PL.side], p, h: s.h, speed: 0, vx: 0, vy: 0, vz: 0, state: 'takeoff', t: 0, fuel: MS.raft ? 320 : 150, torp: 1, goal: heloGoal(), goalT: PL.lock && !PL.lock.isAir && !PL.lock.isMissile ? PL.lock : null, obj: m.group, rotor: m.rotor, tail: m.tail, dead: false, bank: 0, deckX: hx, owner: s };
  W.helo.rescue = !W.helo.goalT && !!MS.raft && MS.raft.state === 'adrift';
  m.group.rotation.order = 'YZX';
  scene.add(m.group);
  radio('Air', `${HELO_NAME[PL.side]} launching. Bearing ${fmtBrg(bearing(s.x, s.z, W.helo.goal.x, W.helo.goal.z))}, ${(Math.hypot(W.helo.goal.x - s.x, W.helo.goal.z - s.z) / 1000).toFixed(1)} km.`, '');
}
/* Search and rescue: a life raft that drifts, smokes and strobes, and can be reached by ship or helicopter. */
const RAFT_HOLD = 12, WINCH_T = 14;
function buildRaft() {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.3, 8, 18).rotateX(Math.PI / 2), MAT.orange);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.1, 18), MAT.black);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1), MAT.orange);
  canopy.position.y = 0.2;
  const pilot = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 8), MAT.green);
  pilot.position.set(0.55, 0.55, 0.3);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  strobe.position.y = 1.15;
  g.add(tube, floor, canopy, pilot, strobe);
  g.userData = { pilot, strobe };
  return g;
}
function raftTick(dt) {
  const R = MS.raft; if (!R) return;
  const s = PL.ship;
  if (R.state === 'adrift' || R.state === 'winch') {
    R.x += WIND.x * 0.05 * dt; R.z += WIND.z * 0.05 * dt;
    MS.waypoints[0].x = R.x; MS.waypoints[0].z = R.z;
  }
  const y = swellH(R.x, R.z);
  R.obj.position.set(R.x, y + 0.15, R.z);
  R.obj.rotation.set(Math.sin(TIME * 1.3) * 0.12, TIME * 0.1, Math.cos(TIME * 1.1) * 0.12);
  R.obj.userData.pilot.visible = R.state === 'adrift' || R.state === 'winch';
  if (R.state !== 'adrift' && R.state !== 'winch') { R.obj.userData.strobe.visible = false; return; }
  // Orange marker smoke and a strobe, so the raft can be found through binoculars
  const L = 0.4 + LIT() * 0.6;
  R.smokeAcc += dt * 7;
  while (R.smokeAcc > 1) { R.smokeAcc -= 1; fxSmoke.emit(R.x + rand(-0.5, 0.5), y + 0.8, R.z + rand(-0.5, 0.5), rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4), rand(6, 10), 1.5, rand(12, 22), 1.0 * L, 0.42 * L, 0.12 * L, 0.75, 0.25, 0.35); }
  R.strobe -= dt;
  R.obj.userData.strobe.visible = R.strobe > 1.35;
  if (R.strobe <= 0) { R.strobe = 1.5; flashLight(R.x, y + 1.5, R.z, 0xffffff, 1.5e5, 0.12); }
  if (R.state !== 'adrift') return;
  // Pickup by ship: close, slow and steady
  if (s && !s.dead) {
    const d = Math.hypot(R.x - s.x, R.z - s.z), slow = Math.abs(s.speed) < 2.6;
    if (d < 150 && slow) {
      if (R.hold === 0) radio('Boat crew', 'Sea boat away. Hold her steady.', '');
      R.hold += dt;
      if (R.hold >= RAFT_HOLD) recoverPilot('ship');
    } else {
      R.hold = Math.max(0, R.hold - dt * 2);
      if (d < 450 && !slow && !R.toldSlow) { R.toldSlow = true; flashMsg('Slow below 5 knots within 150 m of the raft (S to slow down)'); }
    }
  }
  // Enemy boats loitering at the raft take the pilot
  let near = Infinity, at = false;
  for (const e of W.ships) {
    if (!e.capture || e.dead) continue;
    const d = Math.hypot(R.x - e.x, R.z - e.z);
    near = Math.min(near, d);
    if (d < 230 && Math.abs(e.speed) < 4) at = true;
  }
  R.cap = at ? R.cap + dt : Math.max(0, R.cap - dt * 0.5);
  if (near < 2500 && R.warned < 1) { R.warned = 1; radio('CIC', 'Missile boat 2.5 km from the raft!', 'bad'); }
  if (at && R.warned < 2) { R.warned = 2; radio('CIC', 'They are alongside the raft! Drive them off!', 'bad'); sfx('alarm'); }
  if (R.cap > 15) { R.state = 'lost'; radio('CIC', 'They have the pilot. The raft is empty.', 'bad'); }
}
function recoverPilot(how) {
  const R = MS.raft;
  if (how === 'helo') { R.state = 'helo'; radio('Air', `Pilot is aboard the ${HELO_NAME[PL.side]}. Bringing them home.`, 'good'); if (R.onAboard) R.onAboard(); return; }
  R.state = 'aboard'; R.hold = 0;
  radio('Boat crew', 'Pilot recovered, cold and wet but in one piece!', 'good');
  if (R.onAboard) R.onAboard();
}
function heloGoal() {
  const s = PL.ship, t = PL.lock;
  if (t && !t.isAir && !t.isMissile) return new V3(t.x, 0, t.z);
  if (MS.raft && MS.raft.state === 'adrift') return new V3(MS.raft.x, 0, MS.raft.z);
  const d = Math.hypot(PL.aimPoint.x - s.x, PL.aimPoint.z - s.z);
  if (d > 800 && d < 20000) return PL.aimPoint.clone().setY(0);
  const datum = W.datums.find(dd => !dd.sub.dead);
  if (datum) return new V3(datum.x, 0, datum.z);
  return new V3(s.x + fx(s.h) * 6000, 0, s.z + fz(s.h) * 6000);
}
function updateHelo(dt) {
  PL.heloCd -= dt;
  const h = W.helo; if (!h) return;
  if (h.dead) {
    // Lost with the pilot aboard, the rescue has failed; lost over the raft, the pilot is still in it
    if (h.pilot && MS.raft && MS.raft.state === 'helo') { MS.raft.state = 'lost'; radio('Air', `We have lost the ${h.name} with the pilot aboard.`, 'bad'); }
    else if (h.state === 'winch' && MS.raft && MS.raft.state === 'winch') { MS.raft.state = 'adrift'; radio('Air', `We have lost the ${h.name} over the raft. The pilot is still in the water.`, 'bad'); }
    scene.remove(h.obj); W.helo = null; PL.heloCd = 60; return;
  }
  const s = PL.ship;
  h.t += dt;
  if (h.state !== 'takeoff') h.fuel -= dt;
  if (h.fuel < 25 && h.state !== 'rtb') { if (h.state === 'winch') MS.raft.state = 'adrift'; h.state = 'rtb'; radio('Air', `${h.name} bingo fuel, returning.`, ''); }
  if (h.rescue && MS.raft) {
    const R = MS.raft;
    if (R.state === 'adrift' || R.state === 'winch') h.goal.set(R.x, 0, R.z);
    else if (!h.pilot && h.state !== 'rtb') { h.rescue = false; h.state = 'rtb'; }
  }
  if (h.goalT && !h.goalT.dead) h.goal.set(h.goalT.x, 0, h.goalT.z);
  let want = h.h, spd = 65, alt = 120;
  if (h.state === 'takeoff') {
    if (!s || s.dead) { h.state = 'transit'; }
    else {
      const deck = _v.set(h.deckX, s.P.deckAt(h.deckX) + 0.5, 0); s.obj.localToWorld(deck);
      h.p.set(deck.x, deck.y + Math.min(60, h.t * h.t * 2.5), deck.z); h.h = s.h; spd = s.speed;
      if (h.t > 5.5) h.state = 'transit';
    }
  } else if (h.state === 'transit') {
    want = bearing(h.p.x, h.p.z, h.goal.x, h.goal.z); spd = h.rescue ? 75 : 65;
    if (Math.hypot(h.goal.x - h.p.x, h.goal.z - h.p.z) < 900) {
      if (h.rescue) { h.state = 'winch'; h.winchT = 0; MS.raft.state = 'winch'; radio('Air', `${h.name} over the raft. Rescue swimmer going down.`, ''); }
      else { h.state = 'station'; radio('Air', `${h.name} on station. Dipping sonar in the water.`, 'quiet'); }
    }
  } else if (h.state === 'winch') {
    // Hover low over the raft while the swimmer and winch do their work
    const d = Math.hypot(h.goal.x - h.p.x, h.goal.z - h.p.z);
    want = bearing(h.p.x, h.p.z, h.goal.x, h.goal.z); spd = clamp(d * 0.3, 0, 40); alt = d < 120 ? 18 : 55;
    if (d < 45) {
      h.winchT += dt;
      if (Math.random() < dt * 40) { const a = rand(TAU), r = rand(6, 16), L = 0.5 + LIT() * 0.5; fxSpray.emit(h.goal.x + Math.cos(a) * r, 0.4, h.goal.z + Math.sin(a) * r, Math.cos(a) * 12, rand(0.5, 3), Math.sin(a) * 12, rand(1, 2), 2, 7, L, L, L, 0.5, 0.8, -1); }
      if (h.winchT >= WINCH_T) { h.pilot = true; h.state = 'rtb'; recoverPilot('helo'); }
    }
  } else if (h.state === 'station') {
    // Orbit the datum low and slow, listening
    const a = bearing(h.goal.x, h.goal.z, h.p.x, h.p.z);
    want = a + Math.PI / 2 + clamp((Math.hypot(h.goal.x - h.p.x, h.goal.z - h.p.z) - 900) / 600, -0.8, 0.8);
    spd = 42; alt = 55;
  } else if (h.state === 'rtb') {
    if (!s || s.dead) { h.dead = true; return; }
    // Aim a little ahead of the ship and overtake her properly, even when she is steaming hard and weaving
    want = bearing(h.p.x, h.p.z, s.x + s.vx * 3, s.z + s.vz * 3);
    const d = Math.hypot(s.x - h.p.x, s.z - h.p.z);
    alt = d < 600 ? 30 : 100; spd = d < 600 ? Math.max(Math.abs(s.speed) + 10, 22) : 70;
    if (d < 150) {
      scene.remove(h.obj); W.helo = null; PL.heloCd = 45; radio('Air', `${h.name} on deck. Refuelling and rearming.`, 'good');
      if (h.pilot && MS.raft) { MS.raft.state = 'aboard'; radio('Medical', 'The pilot is in the sick bay. Hypothermic, but fine.', 'good'); }
      return;
    }
  }
  if (h.state !== 'takeoff') {
    const dh = clamp(wrapPi(want - h.h), -0.7 * dt, 0.7 * dt);
    h.h = wrapPi(h.h + dh);
    h.bank = lerp(h.bank, clamp(dh / Math.max(dt, 1e-3) * 0.8, -0.5, 0.5), clamp(dt * 2, 0, 1));
    h.speed = lerp(h.speed, spd, clamp(dt * 0.6, 0, 1));
    h.p.x += fx(h.h) * h.speed * dt; h.p.z += fz(h.h) * h.speed * dt;
    h.vy = clamp(alt - h.p.y, -8, 8); h.p.y += h.vy * dt;
  }
  h.vx = fx(h.h) * h.speed; h.vz = fz(h.h) * h.speed;
  h.obj.position.copy(h.p);
  h.obj.rotation.set(h.bank, Math.PI / 2 - h.h, -h.speed * 0.0025);
  h.rotor.rotation.y += dt * 26; h.tail.rotation.z += dt * 60;
  // Rotor wash on the water
  if (h.p.y < 70 && Math.random() < dt * 30) { const a = rand(TAU), r = rand(4, 14), L = 0.5 + LIT() * 0.5; fxSpray.emit(h.p.x + Math.cos(a) * r, 0.4, h.p.z + Math.sin(a) * r, Math.cos(a) * 9, rand(0.5, 2), Math.sin(a) * 9, rand(1, 2), 2, 6, L, L, L, (70 - h.p.y) / 140, 0.8, -1); }
  if (h.state === 'station' || h.state === 'transit') {
    for (const sub of W.ships) {
      if (!sub.isSub || sub.dead || sub.side === PL.side) continue;
      const d = Math.hypot(sub.x - h.p.x, sub.z - h.p.z);
      if (d < (h.state === 'station' ? 3800 : 1800)) {
        if (!sub.detected) radio('Air', `${h.name}: sonar contact, submarine, ${(Math.hypot(sub.x - s.x, sub.z - s.z) / 1000).toFixed(1)} km from us.`, 'good');
        sub.revealT = Math.max(sub.revealT, 4);
        if (h.torp > 0 && d < 1300) {
          h.torp--;
          fxSplash(h.p.x, h.p.z, 0.6);
          const at = new V3(sub.x, 0, sub.z);
          radio('Air', `${h.name}: torpedo away.`, '');
          W.pending.push({ t: 5, fn: () => { if (!sub.dead && Math.hypot(sub.x - at.x, sub.z - at.z) < 750) { fxSplash(sub.x, sub.z, 3.2); damageShip(sub, 260, null, s, 'torp'); } else radio('Air', 'Torpedo missed.', ''); } });
        }
      }
    }
  }
}

/* Ship's systems: hits knock them out, repair parties bring them back. */
const SYS_NAME = { gun: 'Main gun', radar: 'Radar', launchers: 'Launchers', engines: 'Engines', steering: 'Steering' };
const SYS_MSG = {
  gun: 'Main gun mount is out of action!', radar: 'Air search radar is down. We are blind beyond six kilometres!',
  launchers: 'Missile launchers damaged. No missiles until they are repaired!', engines: 'Engine room hit. We are losing speed!', steering: 'Steering gear damaged. The helm is sluggish!',
};
const sysOK = k => PL.sys[k] >= 35;
// Rain clutter shortens radar reach; the hull sonar hears further when the ship slows down.
const radarReach = () => (sysOK('radar') ? 26000 : 6000) * (1 - SEA.rain * 0.3);
function sonarRange() {
  const s = PL.ship; if (!s) return 0;
  return 2200 + 3600 * Math.pow(1 - clamp(Math.abs(s.speed) / (s.baseMax || s.maxSpeed), 0, 1), 1.4);
}
function sysHit(p, amt) {
  const s = PL.ship;
  let k;
  if (!p) k = pick(['engines', 'steering']);
  else {
    const lp = s.obj.worldToLocal(p.clone()), f = lp.x / s.L;
    if (lp.y > s.top * 0.6) k = 'radar';
    else if (f > 0.2) k = Math.random() < 0.6 ? 'gun' : 'launchers';
    else if (f < -0.3) k = Math.random() < 0.5 ? 'steering' : 'engines';
    else k = Math.random() < 0.5 ? 'engines' : 'launchers';
  }
  const was = sysOK(k);
  PL.sys[k] = Math.max(0, PL.sys[k] - amt * rand(0.35, 0.8));
  if (was && !sysOK(k)) radio('Damage control', SYS_MSG[k] + ' (H sends a repair party)', 'bad');
}
function updateSystems(dt) {
  const s = PL.ship;
  for (const k in PL.sys) PL.sys[k] = Math.min(100, PL.sys[k] + dt * 0.7);
  if (PL.dcT > 0) {
    PL.dcT -= dt;
    const was = sysOK(PL.dcSys);
    PL.sys[PL.dcSys] = Math.min(100, PL.sys[PL.dcSys] + dt * 9);
    if (!was && sysOK(PL.dcSys)) radio('Damage control', `${SYS_NAME[PL.dcSys]} back on line.`, 'good');
  }
  PL.dcCd -= dt;
  s.maxSpeed = s.baseMax * (0.35 + 0.65 * PL.sys.engines / 100);
}
function damageControlKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  if (PL.dcCd > 0) { flashMsg(`Repair parties busy, ${Math.ceil(PL.dcCd)}s`); return; }
  const k = Object.keys(PL.sys).sort((a, b) => PL.sys[a] - PL.sys[b])[0];
  if (PL.sys[k] >= 98 && !s.fires.length) { flashMsg('All systems working'); return; }
  PL.dcSys = k; PL.dcT = 12; PL.dcCd = 25;
  s.fires.splice(0, 2);
  radio('Damage control', `Repair party to the ${SYS_NAME[k].toLowerCase()}${s.fires.length ? '' : ', fires under control'}.`, '');
}

/* Automatic air defence: shoot at what threatens us or the ships we guard. */
function threatList() {
  const s = PL.ship, out = [];
  for (const m of W.missiles) {
    if (m.side === PL.side || m.dead || (m.kind !== 'asm' && m.kind !== 'bm')) continue;
    const d = m.p.distanceTo(s.pos);
    if (d > 30000) continue;
    const tg = m.target;
    const toward = tg ? Math.hypot(tg.x - m.p.x, tg.z - m.p.z) : d;
    out.push({ o: m, kind: 'msl', d, tti: toward / Math.max(50, m.speed), tgt: tg });
  }
  for (const j of W.jets) { if (j.side === PL.side) continue; const d = j.p.distanceTo(s.pos); if (d < 32000) out.push({ o: j, kind: 'air', d, tti: d / j.speed, tgt: j.target }); }
  return out.sort((a, b) => a.tti - b.tti);
}
function playerAirDefence(dt) {
  PL.samCd -= dt; PL.pdCd -= dt;
  const s = PL.ship;
  if (PL.adMode !== 'auto' || !sysOK('radar') || !sysOK('launchers')) return;
  for (const th of threatList()) {
    const o = th.o;
    if (o.samOn || o.dead) continue;
    if (th.kind === 'msl') {
      if (o.kind === 'bm' || o.lost || o.decoy) continue;
      const guarded = th.tgt && th.tgt.side === PL.side && Math.hypot(th.tgt.x - s.x, th.tgt.z - s.z) < 9000;
      if (!guarded) continue;
      if (th.d < 11000 && th.d > 1500 && PL.sam > 0 && PL.samCd <= 0) { PL.sam--; PL.samCd = 1.1; playerLaunch('sam', o); }
      else if (PL.pd > 0 && th.d <= 4500 && th.d > 500 && PL.pdCd <= 0) { PL.pd--; PL.pdCd = 0.6; playerLaunch('pd', o); }
    } else if (th.d < 15000 && PL.sam > 3 && PL.samCd <= 0 && th.tgt && th.tgt.side === PL.side) { PL.sam--; PL.samCd = 1.1; playerLaunch('sam', o); }
  }
}

/* Missile camera: a picture-in-picture chase view of your latest missile. */
const mcam = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 80000);
mcam.layers.enable(1);
const mcamLast = new V3(), mcamDir = new V3(1, 0, 0);
function renderMissileCam(dt) {
  const el = $('mcam');
  let m = PL.mcamM;
  if (m && m.dead) { PL.mcamHold = 2.5; PL.mcamM = m = null; }
  if (PL.mcamHold > 0) PL.mcamHold -= dt;
  if (!PL.mcamOn || state !== 'play' || (!m && PL.mcamHold <= 0)) { el.hidden = true; return; }
  el.hidden = false;
  if (m) {
    mcamLast.copy(m.p); mcamDir.copy(m.d);
    const back = m.kind === 'bm' ? 160 : 26;
    mcam.position.copy(m.p).addScaledVector(m.d, -back).add(_v.set(0, m.kind === 'bm' ? 0 : 4, 0));
    if (m.kind === 'bm') mcam.position.x += 60;
    mcam.lookAt(_v.copy(m.p).addScaledVector(m.d, 220));
    const tg = m.target;
    $('mcamCap').textContent = `${m.prof ? m.prof.name : m.kind === 'bm' ? 'DF-21D' : 'ASROC'} · ${Math.round(m.speed * 3.6)} km/h${tg && !tg.dead ? ` · ${(Math.hypot(tg.x - m.p.x, tg.z - m.p.z) / 1000).toFixed(1)} km to ${tg.name}` : ''}`;
  } else {
    $('mcamCap').textContent = 'Impact';
    mcam.lookAt(mcamLast);
  }
  const r = el.getBoundingClientRect();
  const x = r.left, y = window.innerHeight - r.bottom;
  mcam.aspect = r.width / r.height; mcam.updateProjectionMatrix();
  const wx = water.position.x, wz = water.position.z;
  water.position.x = mcam.position.x; water.position.z = mcam.position.z;
  renderer.setScissorTest(true);
  renderer.setViewport(x, y, r.width, r.height); renderer.setScissor(x, y, r.width, r.height);
  renderer.render(scene, mcam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  water.position.x = wx; water.position.z = wz;
}

function chaffKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  if (PL.chaff <= 0) { flashMsg('No decoys left'); return; }
  if (PL.chaffCd > 0) { flashMsg('Decoy launchers reloading'); return; }
  PL.chaff--; PL.chaffCd = 12;
  const L = 0.6 + LIT() * 0.4;
  const pts = [];
  for (const side of [-1, 1]) {
    const a = s.h + side * 1.3, p = new V3(s.x + fx(a) * 260, 45, s.z + fz(a) * 260);
    pts.push(p);
    for (let i = 0; i < 60; i++) fxSpark.emit(p.x + rand(-25, 25), p.y + rand(-15, 15), p.z + rand(-25, 25), rand(-2, 2), rand(-3, 0), rand(-2, 2), rand(4, 10), 0.6, 0.6, 2.2, 2.2, 2.4, 0.7, 0.2, -0.5);
    for (let i = 0; i < 16; i++) fxSmoke.emit(p.x + rand(-20, 20), p.y + rand(-10, 10), p.z + rand(-20, 20), rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(8, 14), 8, 34, 0.7 * L, 0.72 * L, 0.75 * L, 0.35, 0.2, -0.3);
  }
  W.chaff.push(...pts.map(p => ({ p, t: 14 })));
  let seduced = 0;
  for (const m of W.missiles) {
    if (m.target === s && m.kind === 'asm' && Math.hypot(m.p.x - s.x, m.p.z - s.z) > 600 && Math.random() < 0.55) { m.decoy = pick(pts); m.target.inbound--; m.target = null; seduced++; }
  }
  for (const tp of W.torps) if (tp.target === s && Math.random() < 0.55) { tp.decoy = { x: s.x - fx(s.h) * 450, z: s.z - fz(s.h) * 450 }; seduced++; }
  radio('EW', seduced ? `Chaff and decoys away. ${seduced} ${seduced === 1 ? 'threat has' : 'threats have'} taken the bait.` : 'Chaff and decoys away.', '');
  sfx('launch', 0.5);
}
function starShellKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  if (PL.flares <= 0) { flashMsg(SEA.night ? 'No star shells left' : 'Star shells are only loaded for night actions'); return; }
  PL.flares--;
  const m = turretMuzzle(s, 0);
  const tgt = PL.lock && !PL.lock.isAir ? new V3(PL.lock.x, 0, PL.lock.z) : PL.aimPoint;
  const d = Math.hypot(tgt.x - s.x, tgt.z - s.z), az = bearing(s.x, s.z, tgt.x, tgt.z);
  const el = Math.atan2(500, Math.max(400, d) * 0.5) * 0.9;
  fireShell(s, m, velFrom(el, az, Math.sqrt(Math.max(d, 600) * G / Math.sin(2 * el)) * 0.95), 0, { star: true });
  radio('Gunnery', 'Star shell away.', 'quiet');
}

function onPlayerHit(amt, p, kind, src) {
  const by = (kind || 'other') + ':' + (src ? src.cls || src.kind || src.name || '?' : '-');
  PL.dmgBy[by] = (PL.dmgBy[by] || 0) + Math.round(amt);
  PL.shake = Math.min(3, PL.shake + amt * 0.02 + 0.4);
  PL.dmg = Math.min(1, PL.dmg + amt / 300);
  PL.lastHit = MS.t;
  sfx('hit', 1);
  if (kind !== 'ground') sysHit(p, amt);
  // Teach evasion: enemy fire control re-solves whenever we change course or speed
  if (kind === 'shell') {
    PL.shellHits = (PL.shellHits || []).filter(t => MS.t - t < 25); PL.shellHits.push(MS.t);
    if (PL.shellHits.length >= 4 && !PL.tipEvade) { PL.tipEvade = true; radio('Navigator', 'Their salvos are walking onto us. Put the helm over or change speed to throw off their fire control.', 'tip'); }
  }
  const hp = PL.ship.hp / PL.ship.maxHp;
  if (kind === 'asm') radio('Damage control', `Missile hit ${p && p.distanceTo(camera.getWorldPosition(_v2)) < 60 ? 'forward' : 'amidships'}! Fire parties away.`, 'bad');
  else if (kind === 'torp') radio('Damage control', 'Torpedo hit! Flooding in the engine room.', 'bad');
  else if (Math.random() < 0.3) radio('Damage control', pick(['Shell hit on the superstructure.', 'Hit aft. Fighting the fire.', 'Splinter damage on the bridge wing.']), 'bad');
  if (hp < 0.3 && !PL.warned) { PL.warned = true; radio('Captain', 'Hull integrity critical. We cannot take much more.', 'bad'); }
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */
const ov = $('overlay'), octx = ov.getContext('2d');
const radarC = $('radar'), rctx = radarC.getContext('2d');
const compC = $('compass'), cctx = compC.getContext('2d');
let radarRange = 12000, hudT = 0, msgT = 0;
const COL = { hostile: '#ff6b52', friend: '#6fb1ff', protect: '#71e09a', missile: '#ff3b30', way: '#ffd166', sub: '#ffb347' };

function radio(from, text, cls = '') {
  const ol = $('radio');
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = `<b>${from}</b> ${text}`;
  ol.appendChild(li);
  while (ol.children.length > 5) ol.removeChild(ol.firstChild);
  setTimeout(() => li.classList.add('old'), 7000);
  setTimeout(() => li.remove(), 9000);
  if (cls !== 'quiet') sfx('blip', 1, 0, 660);
}
function flashMsg(text) { PL.msg = text; msgT = 2.2; }

function project(p, out) {
  _v.copy(p).project(camera);
  const behind = _v.z > 1;
  out.x = (_v.x * 0.5 + 0.5) * ov.width; out.y = (-_v.y * 0.5 + 0.5) * ov.height; out.behind = behind;
  return out;
}
const _sp = { x: 0, y: 0, behind: false }, _sp2 = { x: 0, y: 0, behind: false };
function shipColor(t) { return t.side !== PL.side ? COL.hostile : (t.role === 'convoy' || t.role === 'hvu') ? COL.protect : COL.friend; }

function drawOverlay() {
  const w = ov.width, h = ov.height, k = w / window.innerWidth;
  octx.clearRect(0, 0, w, h);
  if (state !== 'play' || !PL.ship) return;
  const cam = camera.getWorldPosition(_v2).clone();
  octx.font = `${11 * k}px "IBM Plex Mono", monospace`;
  octx.lineWidth = 1.5 * k;
  // Ship brackets
  for (const t of W.ships) {
    if (t.player || t.sunk || !t.detected) continue;
    const d = Math.hypot(t.x - cam.x, t.z - cam.z);
    if (d > 24000) continue;
    project(_v.set(t.x, t.obj.position.y + t.top * 0.4, t.z), _sp);
    if (_sp.behind || _sp.x < -50 || _sp.x > w + 50 || _sp.y < -50 || _sp.y > h + 50) continue;
    const half = Math.max(10 * k, (t.L / d) * (h / 2) / Math.tan(camera.fov * DEG / 2) * 0.55);
    const c = t.dead ? 'rgba(200,200,200,0.5)' : shipColor(t);
    octx.strokeStyle = c; octx.fillStyle = c;
    const hh = Math.max(7 * k, half * 0.45), q = Math.min(half, hh) * 0.5;
    const x0 = _sp.x - half, x1 = _sp.x + half, y0 = _sp.y - hh, y1 = _sp.y + hh;
    octx.globalAlpha = t === PL.lock ? 1 : 0.75;
    octx.beginPath();
    octx.moveTo(x0, y0 + q); octx.lineTo(x0, y0); octx.lineTo(x0 + q, y0);
    octx.moveTo(x1 - q, y0); octx.lineTo(x1, y0); octx.lineTo(x1, y0 + q);
    octx.moveTo(x0, y1 - q); octx.lineTo(x0, y1); octx.lineTo(x0 + q, y1);
    octx.moveTo(x1 - q, y1); octx.lineTo(x1, y1); octx.lineTo(x1, y1 - q);
    octx.stroke();
    if (d < 13000 || t === PL.lock || PL.zoom > 0.5) {
      octx.textAlign = 'center';
      octx.fillText(`${t.dead ? 'SINKING · ' : ''}${t.name}  ${(d / 1000).toFixed(1)} km`, _sp.x, y0 - 6 * k);
    }
    if (t.isSub) { octx.textAlign = 'center'; octx.fillText('SONAR CONTACT', _sp.x, y1 + 14 * k); }
  }
  // Our helicopter
  if (W.helo && !W.helo.dead) {
    const hh = W.helo; project(hh.p, _sp);
    if (!_sp.behind) {
      octx.strokeStyle = octx.fillStyle = COL.friend; octx.globalAlpha = 0.9;
      octx.beginPath(); octx.arc(_sp.x, _sp.y, 6 * k, 0, TAU); octx.stroke();
      octx.textAlign = 'center'; octx.fillText(`${hh.name} · ${hh.state === 'station' ? 'on station' : hh.state === 'rtb' ? 'returning' : 'outbound'} · fuel ${Math.max(0, Math.round(hh.fuel))}s`, _sp.x, _sp.y + 18 * k);
    }
  }
  // Aircraft and missiles
  for (const j of W.jets) {
    project(j.p, _sp); if (_sp.behind) continue;
    octx.strokeStyle = octx.fillStyle = j.side !== PL.side ? COL.hostile : COL.friend;
    octx.globalAlpha = 0.85;
    octx.beginPath(); octx.moveTo(_sp.x - 8 * k, _sp.y + 5 * k); octx.lineTo(_sp.x, _sp.y - 4 * k); octx.lineTo(_sp.x + 8 * k, _sp.y + 5 * k); octx.stroke();
    octx.textAlign = 'center'; octx.fillText(`${j.name} ${(j.p.distanceTo(cam) / 1000).toFixed(1)}`, _sp.x, _sp.y + 18 * k);
  }
  for (const m of W.missiles) {
    if (m.side === PL.side || m.kind === 'sam') continue;
    const d = m.p.distanceTo(cam);
    project(m.p, _sp);
    octx.strokeStyle = octx.fillStyle = COL.missile; octx.globalAlpha = 1;
    if (_sp.behind || _sp.x < 0 || _sp.x > w || _sp.y < 0 || _sp.y > h) { edgeArrow(m.p, cam, COL.missile, k); continue; }
    octx.beginPath(); octx.moveTo(_sp.x, _sp.y - 7 * k); octx.lineTo(_sp.x + 7 * k, _sp.y); octx.lineTo(_sp.x, _sp.y + 7 * k); octx.lineTo(_sp.x - 7 * k, _sp.y); octx.closePath(); octx.stroke();
    octx.textAlign = 'center'; octx.fillText(`VAMPIRE ${(d / 1000).toFixed(1)}`, _sp.x, _sp.y - 12 * k);
  }
  // Off-screen hostile ships
  for (const t of W.ships) if (!t.dead && t.detected && t.side !== PL.side) {
    project(_v.set(t.x, t.top * 0.4, t.z), _sp);
    if (_sp.behind || _sp.x < 0 || _sp.x > w || _sp.y < 0 || _sp.y > h) edgeArrow(_v.set(t.x, 0, t.z), cam, COL.hostile, k, 0.6);
  }
  // Mission waypoints
  for (const wp of MS.waypoints || []) {
    project(_v.set(wp.x, 30, wp.z), _sp); if (_sp.behind) continue;
    octx.strokeStyle = octx.fillStyle = COL.way; octx.globalAlpha = 0.9;
    octx.beginPath(); octx.moveTo(_sp.x, _sp.y - 9 * k); octx.lineTo(_sp.x + 9 * k, _sp.y); octx.lineTo(_sp.x, _sp.y + 9 * k); octx.lineTo(_sp.x - 9 * k, _sp.y); octx.closePath(); octx.stroke();
    octx.textAlign = 'center'; octx.fillText(`${wp.label} ${(Math.hypot(wp.x - cam.x, wp.z - cam.z) / 1000).toFixed(1)} km`, _sp.x, _sp.y - 14 * k);
  }
  octx.globalAlpha = 1;
  // Locked target: box, lead pip and data block
  const t = PL.lock;
  if (t && !t.dead) {
    const tp = t.isAir || t.isMissile ? t.p : _v.set(t.x, t.obj.position.y + t.top * 0.35, t.z);
    project(tp, _sp);
    if (!_sp.behind) {
      octx.strokeStyle = octx.fillStyle = '#ffffff';
      octx.lineWidth = 2 * k;
      const r = 18 * k;
      octx.strokeRect(_sp.x - r, _sp.y - r, r * 2, r * 2);
      if (PL.solution && PL.solution.p) {
        project(PL.solution.p, _sp2);
        if (!_sp2.behind) {
          octx.beginPath(); octx.arc(_sp2.x, _sp2.y, 5 * k, 0, TAU); octx.stroke();
          octx.globalAlpha = 0.5; octx.beginPath(); octx.moveTo(_sp.x, _sp.y); octx.lineTo(_sp2.x, _sp2.y); octx.stroke(); octx.globalAlpha = 1;
        }
      }
      const d = (t.isAir || t.isMissile ? t.p.distanceTo(cam) : Math.hypot(t.x - cam.x, t.z - cam.z));
      const brg = t.isAir || t.isMissile ? bearing(cam.x, cam.z, t.p.x, t.p.z) : bearing(cam.x, cam.z, t.x, t.z);
      const lines = [t.isAir ? t.name : t.isMissile ? 'ANTI-SHIP MISSILE' : t.name, t.isAir ? 'Strike fighter' : t.isMissile ? 'Sea-skimming' : t.C.label, `RNG ${(d / 1000).toFixed(2)} km  BRG ${fmtBrg(brg)}`, `SPD ${Math.round(Math.hypot(t.vx || 0, t.vz || 0) * KN)} kn${t.hp ? `  HULL ${Math.round(100 * t.hp / t.maxHp)}%` : ''}`];
      octx.textAlign = 'left';
      octx.font = `500 ${11 * k}px "IBM Plex Mono", monospace`;
      lines.forEach((l, i) => octx.fillText(l, _sp.x + r + 8 * k, _sp.y - r + 10 * k + i * 14 * k));
    }
  }
  // Hit marker
  if (PL.hitT > 0) {
    const free = !PL.pointer && !PL.touch, x = free ? PL.cursor.x * w : w / 2, y = free ? PL.cursor.y * h : h / 2;
    const a = Math.min(1, PL.hitT / 0.2), g0 = (PL.hitBig ? 8 : 6) * k + (1 - a) * 3 * k, l = (PL.hitBig ? 9 : 6) * k;
    octx.strokeStyle = PL.hitKill ? `rgba(255,92,70,${a})` : `rgba(255,255,255,${a})`; octx.lineWidth = 2 * k;
    octx.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { octx.moveTo(x + sx * g0, y + sy * g0); octx.lineTo(x + sx * (g0 + l), y + sy * (g0 + l)); }
    octx.stroke();
  }
  // Fallback cursor crosshair
  if (!PL.pointer && !PL.touch) {
    const x = PL.cursor.x * w, y = PL.cursor.y * h;
    octx.strokeStyle = 'rgba(255,255,255,0.9)'; octx.lineWidth = 1.5 * k;
    octx.beginPath(); octx.moveTo(x - 14 * k, y); octx.lineTo(x - 4 * k, y); octx.moveTo(x + 4 * k, y); octx.lineTo(x + 14 * k, y); octx.moveTo(x, y - 14 * k); octx.lineTo(x, y - 4 * k); octx.moveTo(x, y + 4 * k); octx.lineTo(x, y + 14 * k); octx.stroke();
  }
}
function edgeArrow(p, cam, color, k, alpha = 1) {
  const w = ov.width, h = ov.height;
  const camDir = new V3(); camera.getWorldDirection(camDir);
  const yawCam = Math.atan2(camDir.x, -camDir.z);
  const a = wrapPi(bearing(cam.x, cam.z, p.x, p.z) - yawCam);
  const r = Math.min(w, h) * 0.42;
  const x = w / 2 + Math.sin(a) * r, y = h / 2 - Math.cos(a) * r * 0.85;
  octx.save(); octx.translate(x, y); octx.rotate(a); octx.globalAlpha = alpha;
  octx.fillStyle = color; octx.beginPath(); octx.moveTo(0, -10 * k); octx.lineTo(7 * k, 4 * k); octx.lineTo(-7 * k, 4 * k); octx.closePath(); octx.fill();
  octx.restore();
}

function drawRadar() {
  const W2 = radarC.width, R = W2 / 2 - 6, s = PL.ship;
  rctx.clearRect(0, 0, W2, W2);
  if (!s) return;
  rctx.save(); rctx.translate(W2 / 2, W2 / 2);
  rctx.fillStyle = 'rgba(4,16,14,0.82)'; rctx.beginPath(); rctx.arc(0, 0, R, 0, TAU); rctx.fill();
  rctx.save(); rctx.beginPath(); rctx.arc(0, 0, R, 0, TAU); rctx.clip();
  const sc = R / radarRange, rot = -s.h;
  const P = (x, z) => { const dx = x - s.x, dz = z - s.z; const c = Math.cos(rot), sn = Math.sin(rot); return [(dx * c - dz * sn) * sc, (dx * sn + dz * c) * sc]; };
  // Land
  rctx.fillStyle = 'rgba(120,150,90,0.55)';
  for (const I of W.islands) { const [x, y] = P(I.x, I.z); rctx.beginPath(); rctx.arc(x, y, I.r * 0.8 * sc, 0, TAU); rctx.fill(); }
  // Rings
  rctx.strokeStyle = 'rgba(110,220,160,0.25)'; rctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) { rctx.beginPath(); rctx.arc(0, 0, R * i / 4, 0, TAU); rctx.stroke(); }
  rctx.beginPath(); rctx.moveTo(0, -R); rctx.lineTo(0, R); rctx.moveTo(-R, 0); rctx.lineTo(R, 0); rctx.stroke();
  // Look direction
  rctx.fillStyle = 'rgba(110,220,160,0.12)';
  const la = PL.yaw, spread = camera.fov * DEG * camera.aspect * 0.5;
  rctx.beginPath(); rctx.moveTo(0, 0); rctx.arc(0, 0, R, la - spread - Math.PI / 2, la + spread - Math.PI / 2); rctx.closePath(); rctx.fill();
  // Sweep
  const sw = (TIME * 2.4) % TAU;
  const grd = rctx.createConicGradient ? rctx.createConicGradient(sw - Math.PI / 2 - 0.6, 0, 0) : null;
  if (grd) { grd.addColorStop(0, 'rgba(110,255,170,0)'); grd.addColorStop(0.095, 'rgba(110,255,170,0.35)'); grd.addColorStop(0.1, 'rgba(110,255,170,0)'); rctx.fillStyle = grd; rctx.fillRect(-R, -R, 2 * R, 2 * R); }
  // Datums
  for (const d of W.datums) { const [x, y] = P(d.x, d.z); rctx.strokeStyle = COL.sub; rctx.setLineDash([3, 3]); rctx.beginPath(); rctx.arc(x, y, d.r * sc, 0, TAU); rctx.stroke(); rctx.setLineDash([]); }
  for (const wp of MS.waypoints || []) { const [x, y] = P(wp.x, wp.z); rctx.strokeStyle = COL.way; rctx.strokeRect(x - 4, y - 4, 8, 8); }
  // Contacts
  for (const t of W.ships) {
    if (t.player || t.sunk || !t.detected) continue;
    const [x, y] = P(t.x, t.z);
    const ang = (Math.atan2(x, -y) + TAU) % TAU, lag = (sw - ang + TAU) % TAU;
    rctx.globalAlpha = 0.35 + 0.65 * (1 - lag / TAU);
    rctx.fillStyle = t.dead ? '#888' : t.isSub ? COL.sub : shipColor(t);
    if (t.isSub) { rctx.beginPath(); rctx.moveTo(x, y - 5); rctx.lineTo(x + 5, y); rctx.lineTo(x, y + 5); rctx.lineTo(x - 5, y); rctx.closePath(); rctx.fill(); }
    else rctx.fillRect(x - (t.L > 200 ? 5 : 3.5), y - (t.L > 200 ? 5 : 3.5), t.L > 200 ? 10 : 7, t.L > 200 ? 10 : 7);
    if (t === PL.lock) { rctx.strokeStyle = '#fff'; rctx.strokeRect(x - 7, y - 7, 14, 14); }
  }
  rctx.globalAlpha = 1;
  if (W.helo) { const [x, y] = P(W.helo.p.x, W.helo.p.z); rctx.strokeStyle = COL.friend; rctx.beginPath(); rctx.arc(x, y, 4, 0, TAU); rctx.stroke(); if (W.helo.state === 'station') { rctx.setLineDash([2, 3]); rctx.beginPath(); rctx.arc(x, y, 3800 * sc, 0, TAU); rctx.stroke(); rctx.setLineDash([]); } }
  if (W.ships.some(o => o.isSub && !o.dead && o.side !== PL.side)) { rctx.strokeStyle = 'rgba(255,179,71,0.35)'; rctx.setLineDash([4, 4]); rctx.beginPath(); rctx.arc(0, 0, sonarRange() * sc, 0, TAU); rctx.stroke(); rctx.setLineDash([]); }
  for (const j of W.jets) { const [x, y] = P(j.p.x, j.p.z); rctx.fillStyle = j.side === PL.side ? COL.friend : COL.hostile; rctx.beginPath(); rctx.moveTo(x, y - 4); rctx.lineTo(x + 4, y + 3); rctx.lineTo(x - 4, y + 3); rctx.fill(); }
  for (const m of W.missiles) { if (m.kind === 'sam' || m.kind === 'bm') continue; const [x, y] = P(m.p.x, m.p.z); rctx.fillStyle = m.side === PL.side ? '#cfe8ff' : COL.missile; rctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
  for (const tp of W.torps) { const [x, y] = P(tp.p.x, tp.p.z); rctx.fillStyle = tp.side === PL.side ? '#cfe8ff' : COL.missile; rctx.beginPath(); rctx.arc(x, y, 2, 0, TAU); rctx.fill(); }
  rctx.restore();
  if (!sysOK('radar')) {
    rctx.fillStyle = 'rgba(160,255,200,0.12)';
    for (let i = 0; i < 260; i++) { const a = Math.random() * TAU, r = Math.random() * R; rctx.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2, 2); }
    rctx.strokeStyle = 'rgba(255,90,70,0.6)'; rctx.beginPath(); rctx.arc(0, 0, R * 6000 / radarRange, 0, TAU); rctx.stroke();
  }
  // Own ship and labels
  rctx.fillStyle = '#e8fff2'; rctx.beginPath(); rctx.moveTo(0, -7); rctx.lineTo(4, 5); rctx.lineTo(-4, 5); rctx.closePath(); rctx.fill();
  rctx.strokeStyle = 'rgba(110,220,160,0.6)'; rctx.lineWidth = 1.5; rctx.beginPath(); rctx.arc(0, 0, R, 0, TAU); rctx.stroke();
  const nA = s.h; // north marker rotates with head-up display
  rctx.fillStyle = 'rgba(160,255,200,0.9)'; rctx.font = '500 18px "IBM Plex Mono", monospace'; rctx.textAlign = 'center'; rctx.textBaseline = 'middle';
  rctx.fillText('N', Math.sin(-nA) * (R - 14), -Math.cos(-nA) * (R - 14));
  rctx.restore();
}

function drawCompass() {
  const w = compC.width, h = compC.height;
  cctx.clearRect(0, 0, w, h);
  if (!PL.ship) return;
  const dir = new V3(); camera.getWorldDirection(dir);
  const look = deg360(Math.atan2(dir.x, -dir.z));
  const ppd = w / 90;
  cctx.font = '500 20px "IBM Plex Mono", monospace'; cctx.textAlign = 'center'; cctx.textBaseline = 'top';
  for (let d = Math.floor(look - 50); d <= look + 50; d++) {
    const dd = ((d % 360) + 360) % 360, x = w / 2 + (d - look) * ppd;
    if (dd % 5) continue;
    cctx.fillStyle = 'rgba(226,236,241,0.75)';
    cctx.fillRect(x - 1, 0, 2, dd % 15 ? 8 : 14);
    if (dd % 15 === 0) cctx.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] ?? String(dd).padStart(3, '0'), x, 18);
  }
  const mark = (deg, col, shape) => {
    let rel = ((deg - look + 540) % 360) - 180; if (Math.abs(rel) > 45) rel = Math.sign(rel) * 45;
    const x = w / 2 + rel * ppd; cctx.fillStyle = col;
    cctx.beginPath(); if (shape) { cctx.moveTo(x, h - 2); cctx.lineTo(x - 7, h - 12); cctx.lineTo(x + 7, h - 12); } else { cctx.moveTo(x - 6, 0); cctx.lineTo(x + 6, 0); cctx.lineTo(x, 9); } cctx.fill();
  };
  mark(deg360(PL.ship.h), '#e8fff2', true);
  for (const m of W.missiles) if (m.side !== PL.side && m.kind === 'asm') mark(deg360(bearing(PL.ship.x, PL.ship.z, m.p.x, m.p.z)), COL.missile, false);
  if (PL.lock) mark(deg360(PL.lock.isAir || PL.lock.isMissile ? bearing(PL.ship.x, PL.ship.z, PL.lock.p.x, PL.lock.p.z) : bearing(PL.ship.x, PL.ship.z, PL.lock.x, PL.lock.z)), '#ffffff', false);
  cctx.fillStyle = '#ffd166'; cctx.fillRect(w / 2 - 1, 0, 2, h);
}

let lastHud = '';
function updateHud(dt) {
  hudT -= dt; msgT -= dt;
  drawOverlay(); drawCompass();
  document.body.classList.toggle('cursor-aim', !PL.pointer && !PL.touch);
  if (hudT > 0) return;
  hudT = 0.1;
  drawRadar();
  const s = PL.ship; if (!s) return;
  const hp = clamp(s.hp / s.maxHp, 0, 1);
  $('hullBar').style.width = (hp * 100).toFixed(0) + '%';
  $('hullBar').className = hp < 0.3 ? 'crit' : hp < 0.6 ? 'warn' : '';
  $('hullPct').textContent = Math.round(hp * 100) + '%';
  $('spd').textContent = `${Math.abs(s.speed * KN).toFixed(1)} kn${s.speed < -0.3 ? ' astern' : ''}`;
  $('eng').textContent = ORDERS[PL.telegraph].n;
  $('hdg').textContent = fmtBrg(s.h) + '°';
  $('rud').style.left = (50 + PL.rudder * 46) + '%';
  $('rudTxt').textContent = PL.rudder === 0 ? 'midships' : `${Math.round(Math.abs(PL.rudder) * 35)}° ${PL.rudder < 0 ? 'port' : 'stbd'}`;
  const gun = !sysOK('gun') ? '<i class="bad">Damaged</i>' : PL.masked ? '<i class="bad">Masked</i>' : PL.gunCd > 0 ? 'Loading' : '<i class="ok">Ready</i>';
  const mounts = s.ciwsState ? s.ciwsState.length : 1;
  const ciws = s.ciwsFiring ? '<i class="bad">Engaging</i>' : `Auto${mounts > 1 ? ' ×' + mounts : ''}`;
  const lnch = sysOK('launchers');
  const ecm = PL.ecmT > 0 ? `<i class="ok">On ${Math.ceil(PL.ecmT)}s</i>` : PL.ecmCd > 0 ? `${Math.ceil(PL.ecmCd)}s` : 'Ready';
  const wp = `
    <div><span>Main gun <kbd>LMB</kbd></span><b>${gun}</b></div>
    <div><span>${ASM[PLAYER_ASM[PL.side]].name} <kbd>E</kbd><kbd>B</kbd></span><b>${lnch ? '' : '<i class="bad">Damaged</i> '}${PL.asm} · salvo ${PL.salvoN}</b></div>
    <div><span>${SAM_NAME[PL.side]} <kbd>G</kbd></span><b>${PL.sam} · ${PL.adMode === 'auto' ? '<i class="ok">Auto</i>' : 'Manual'}</b></div>
    ${PL.pd ? `<div><span>HQ-10 point defence</span><b>${PL.pd}</b></div>` : ''}
    ${PL.asroc ? `<div><span>ASROC</span><b>${PL.asroc}</b></div>` : ''}
    <div><span>${SPECIAL_NAME[PL.side]} <kbd>Q</kbd></span><b>${PL.special}</b></div>
    <div><span>Chaff <kbd>C</kbd> · Jammer <kbd>J</kbd></span><b>${PL.chaff}${PL.chaffCd > 0 ? ' (' + Math.ceil(PL.chaffCd) + 's)' : ''} · ${ecm}</b></div>
    ${PL.flares || SEA.night ? `<div><span>Star shells <kbd>F</kbd></span><b>${PL.flares}</b></div>` : ''}
    ${SEA.night || PL.lightOn ? `<div><span>Searchlight <kbd>N</kbd></span><b>${PL.lightOn ? '<i class="ok">On</i>' : 'Off'}</b></div>` : ''}
    <div><span>CIWS</span><b>${ciws}</b></div>
    <div><span>Helicopter <kbd>L</kbd></span><b>${W.helo ? `<i class="ok">${W.helo.state === 'station' ? 'On station' : W.helo.state === 'winch' ? `Winching ${Math.round((W.helo.winchT || 0) / WINCH_T * 100)}%` : W.helo.state === 'rtb' ? (W.helo.pilot ? 'Returning with pilot' : 'Returning') : 'Airborne'}</i> ${Math.max(0, Math.round(W.helo.fuel))}s` : PL.heloCd > 0 ? `Refuel ${Math.ceil(PL.heloCd)}s` : PL.heloSorties > 0 ? `On deck · ${PL.heloSorties}` : 'None left'}</b></div>`;
  if (wp !== lastHud) { $('weapons').innerHTML = wp; lastHud = wp; }
  $('sys').innerHTML = Object.keys(PL.sys).map(k => `<span class="${PL.sys[k] >= 70 ? 'ok' : sysOK(k) ? 'warn' : 'bad'}${PL.dcT > 0 && PL.dcSys === k ? ' fix' : ''}" title="${SYS_NAME[k]} ${Math.round(PL.sys[k])}%">${{ gun: 'GUN', radar: 'RDR', launchers: 'MSL', engines: 'ENG', steering: 'STR' }[k]}</span>`).join('') + `<em>${PL.dcT > 0 ? 'Repairing' : PL.dcCd > 0 ? 'Teams ' + Math.ceil(PL.dcCd) + 's' : 'Repair <kbd>H</kbd>'}</em>`;
  // Air picture: inbound threats with time to impact and how we are engaging them
  const th = threatList().slice(0, 6);
  $('threats').hidden = !th.length;
  $('aawMode').textContent = `${PL.adMode === 'auto' ? 'AAW auto' : 'AAW manual'}${sysOK('radar') ? '' : ' · radar down'}`;
  $('threatList').innerHTML = th.map(e => {
    const o = e.o, brg = fmtBrg(bearing(s.x, s.z, o.p.x, o.p.z));
    const name = e.kind === 'air' ? o.name : o.kind === 'bm' ? 'Ballistic' : o.prof ? o.prof.name : 'ASM';
    const vsUs = e.tgt === s;
    const st = o.lost ? 'Jammed' : o.decoy ? 'Decoyed' : o.samOn ? 'Missile' : W.ships.some(sh => sh.ciwsState && sh.ciwsState.some(mt => mt.target === o)) ? 'CIWS' : e.kind === 'air' ? '' : 'Unengaged';
    const mach = o.speed / 340;
    return `<li class="${e.kind === 'msl' && e.tti < 10 && vsUs ? 'crit' : ''}"><b>${name}</b><span>${brg}° ${(e.d / 1000).toFixed(1)}km</span><span>${e.kind === 'msl' ? 'TTI ' + Math.max(0, Math.round(e.tti)) + 's' : 'M' + mach.toFixed(1)}</span><em>${st}${e.kind === 'msl' && !vsUs && e.tgt ? ' · ' + (e.tgt.name || '').split(' ').pop() : ''}</em></li>`;
  }).join('');
  const subs = W.ships.some(o => o.isSub && !o.dead && o.side !== PL.side);
  $('radarCap').textContent = `Radar ${radarRange / 1000} km${SEA.rain > 0.5 ? ' · rain clutter' : ''}${subs ? ` · sonar ${(sonarRange() / 1000).toFixed(1)} km` : ''}`;
  $('zoomTxt').textContent = `${PL.zoomF.toFixed(PL.zoomF < 3 ? 1 : 0)}× · mil scale`;
  // Objectives
  $('objList').innerHTML = MS.objs.filter(o => !o.hidden).map(o => `<li class="${o.done ? 'done' : o.failed ? 'failed' : ''}${o.secondary ? ' sec' : ''}"><span></span><div>${o.text}${o.progress ? ` <em>${o.progress()}</em>` : ''}</div></li>`).join('');
  const tm = MS.t, rem = MS.limit ? Math.max(0, MS.limit - tm) : null;
  $('clock').innerHTML = `<b>${rem !== null ? fmtTime(rem) : fmtTime(tm)}</b><span>${rem !== null ? 'Hold until relieved' : MS.timeLabel + ' local'}</span>`;
  // Alerts
  const threats = W.missiles.filter(m => m.side !== PL.side && m.kind === 'asm' && m.target === s);
  const torps = W.torps.filter(t => t.side !== PL.side && t.target === s && !t.decoy);
  const al = $('alert');
  if (threats.length) {
    const near = threats.reduce((a, m) => (m.p.distanceTo(s.pos) < a.p.distanceTo(s.pos) ? m : a));
    al.hidden = false; al.className = 'alert red';
    al.textContent = `VAMPIRE · ${threats.length} inbound · bearing ${fmtBrg(bearing(s.x, s.z, near.p.x, near.p.z))} · ${(near.p.distanceTo(s.pos) / 1000).toFixed(1)} km`;
    if ((TIME % 1) < 0.1) sfx('blip', 1, 0, 1760);
  } else if (torps.length) {
    al.hidden = false; al.className = 'alert red';
    al.textContent = `TORPEDO · bearing ${fmtBrg(bearing(s.x, s.z, torps[0].p.x, torps[0].p.z))} · ${(Math.hypot(torps[0].p.x - s.x, torps[0].p.z - s.z) / 1000).toFixed(1)} km`;
  } else if (msgT > 0) { al.hidden = false; al.className = 'alert'; al.textContent = PL.msg; }
  else if (PL.fire && !sysOK('gun')) { al.hidden = false; al.className = 'alert'; al.textContent = 'Main gun out of action: press H for a repair party'; }
  else if (PL.fire && PL.masked) { al.hidden = false; al.className = 'alert'; al.textContent = 'Gun masked: target is behind the superstructure'; }
  else al.hidden = true;
  $('binos').hidden = PL.zoom < 0.5;
}
const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;


/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */
function pickTarget(s) {
  let best = null, bs = Infinity;
  for (const t of W.ships) {
    if (t.dead || !hostile(t, s) || t.isSub || t.safe) continue;
    const d = Math.hypot(t.x - s.x, t.z - s.z) / (t.priority || 1);
    if (d < bs) { bs = d; best = t; }
  }
  return best;
}
function steerClear(s, desired) {
  const look = s.role === 'convoy' || s.role === 'hvu' ? 350 : 700 + s.L * 2;
  const probe = a => landAt(s.x + fx(a) * look, s.z + fz(a) * look) || landAt(s.x + fx(a) * look * 0.5, s.z + fz(a) * look * 0.5);
  if (!probe(desired) && !probe(s.h)) return desired;
  for (const off of [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) if (!probe(s.h + off)) return s.h + off;
  return s.h + Math.PI;
}
function followPath(s) {
  if (!s.path || s.arrived) { s.order = 0; return s.h; }
  const wp = s.path[s.pathI];
  const d = Math.hypot(wp.x - s.x, wp.z - s.z);
  if (d < (wp.r || 450)) {
    if (s.pathI < s.path.length - 1) s.pathI++;
    else { s.arrived = true; s.safe = true; s.order = 0; onArrived(s); return s.h; }
  }
  s.order = s.cruise || s.maxSpeed;
  return bearing(s.x, s.z, wp.x, wp.z);
}
function aiShip(s, dt) {
  if (s.dead || s.player) return;
  const a = s.ai, C = s.C, D = DIFF[CFG.diff], enemy = s.side !== PL.side;
  a.think -= dt;
  if (a.think <= 0) { a.think = rand(2, 3.5); a.target = s.role === 'combat' ? pickTarget(s) : null; }
  let desired = s.h;
  const t = a.target && !a.target.dead ? a.target : null;
  let d = Infinity;
  if (s.role === 'convoy' || s.role === 'hvu') desired = followPath(s);
  else if (s.role === 'cruise') { desired = s.h + Math.sin(TIME * 0.05 + s.phase) * 0.2; s.order = s.maxSpeed * 0.6; }
  else if (s.capture && MS.raft && MS.raft.state === 'adrift') {
    const R = MS.raft, dr = Math.hypot(R.x - s.x, R.z - s.z);
    desired = bearing(s.x, s.z, R.x, R.z);
    s.order = dr > 700 ? s.maxSpeed : dr > 220 ? 5 : 1.2;
    if (t) d = Math.hypot(t.x - s.x, t.z - s.z);
  }
  else if (s.escort && s.escort.some(c => !c.dead && !c.arrived)) {
    // Escort: hold a station ahead of the convoy on the threat side, and only fight from near it
    const live = s.escort.filter(c => !c.dead && !c.arrived), lead = live[0];
    let cx = 0, cz = 0;
    for (const c of live) { cx += c.x / live.length; cz += c.z / live.length; }
    const sx = cx + fx(lead.h) * 900 + Math.cos(lead.h) * 600 * (s.escortSide || 1), sz = cz + fz(lead.h) * 900 + Math.sin(lead.h) * 600 * (s.escortSide || 1);
    const dc = Math.hypot(sx - s.x, sz - s.z);
    if (t) d = Math.hypot(t.x - s.x, t.z - s.z);
    if (t && dc < 1500 && d < 9000) { desired = bearing(s.x, s.z, t.x, t.z) + (Math.PI / 2 - 0.3) * a.zigDir; s.order = s.maxSpeed * 0.75; }
    else { desired = bearing(s.x, s.z, sx, sz); s.order = dc > 400 ? s.maxSpeed * 0.9 : Math.max(lead.speed, 5); }
  }
  else if (t) {
    d = Math.hypot(t.x - s.x, t.z - s.z);
    const brg = bearing(s.x, s.z, t.x, t.z);
    if (C.model === 'cv') { desired = brg + Math.PI + Math.sin(TIME * 0.02) * 0.6; s.order = s.maxSpeed; }
    else if (s.isSub) {
      if (d > a.pref + 600) desired = brg; else desired = brg + Math.PI / 2 * a.zigDir;
      s.order = s.maxSpeed * (d > 7000 ? 1 : 0.6);
    } else {
      if (d > a.pref + 1200) desired = brg;
      else if (d < a.pref - 1200) desired = brg + Math.PI * 0.72 * a.zigDir;
      else desired = brg + (Math.PI / 2 - 0.25) * a.zigDir;
      a.zig -= dt;
      if (a.zig < 0) { a.zig = rand(16, 36); a.zigDir *= -1; }
      s.order = s.maxSpeed * (C.small ? 1 : 0.9);
    }
  } else { s.order = s.maxSpeed * 0.5; if (s.path) desired = followPath(s); }
  if (Math.hypot(s.x, s.z) > 26000) desired = bearing(s.x, s.z, 0, 0);
  if (!s.isSub) desired = steerClear(s, desired);
  s.rudder = clamp(wrapPi(desired - s.h) * 2.4, -1, 1);

  if (!t) return;
  // Guns, with salvos that walk onto the target
  if (C.gun && d < C.gun.range) {
    s.gunCd -= dt;
    const muz = turretMuzzle(s, 0);
    if (muz) {
      const sol = leadSolve(muz, t, SHELL_V, t.obj.position.y + t.top * 0.25);
      aimTurret(s, 0, sol.az, sol.el, dt, 0.7);
      if (s.gunCd <= 0) {
        s.gunCd = C.gun.every * (enemy ? D.fire : 1.2) * rand(0.9, 1.15);
        let rec = s.disp.get(t.id);
        if (!rec) { rec = { r: enemy ? D.disp0 : 260, h: t.h, sp: t.speed }; s.disp.set(t.id, rec); }
        if (Math.abs(wrapPi(t.h - rec.h)) > 0.3 || Math.abs(t.speed - rec.sp) > 4) rec.r = Math.max(rec.r, 150);
        if (t.player && PL.ecmT > 0) rec.r = Math.max(rec.r, 190);
        rec.h = t.h; rec.sp = t.speed;
        const ang = rand(TAU), rr = Math.sqrt(Math.random()) * rec.r;
        const aim = sol.p.clone().add(new V3(Math.cos(ang) * rr, 0, Math.sin(ang) * rr));
        const s2 = solveBallistic(muz, aim, SHELL_V);
        const dmg = C.gun.dmg * (enemy ? D.dmg : 0.9);
        fireShell(s, muz, velFrom(s2.el, s2.az, SHELL_V), dmg, { small: C.small });
        // Spread grows with range: at 12 km a shell spends 14 s in the air and the solution is never as tight
        // At night a darkened ship is hard to range on; one showing a searchlight is not
        const night = t.player && SEA.night ? (PL.lightOn ? 0.85 : 1.4) : 1;
        rec.r = Math.max((enemy ? D.dispMin : 40) * (1 + SEA.amp * 0.08) * (0.6 + d / 8000) * night, rec.r * 0.8);
      }
    }
  }
  // Anti-ship missiles
  if (s.asm > 0 && d < 17000) {
    s.asmCd -= dt;
    if (s.asmCd <= 0) {
      s.asmCd = (enemy ? D.asmEvery : 45) * rand(0.8, 1.3) * (C.small ? 0.7 : 1);
      const n = C.small ? 1 : Math.random() < 0.25 ? 2 : 1;
      for (let i = 0; i < Math.min(n, s.asm); i++) {
        s.asm--;
        const from = new V3(s.x + fx(s.h) * s.L * (C.small ? -0.25 : 0.25) + rand(-2, 2), s.P.F + 2, s.z + fz(s.h) * s.L * (C.small ? -0.25 : 0.25));
        const dir = C.small ? new V3(fx(s.h), 0.35, fz(s.h)) : new V3(0, 1, 0);
        const prof = ASM_TYPE[s.cls] || 'yj83';
        W.pending.push({ t: i * 1.2, fn: () => { if (!s.dead) launchMissile('asm', s, from, dir, t, { prof, dmg: ASM[prof].dmg * (enemy ? D.dmg : 0.9), boost: C.small ? 0.8 : 1.5 }); } });
      }
      if (t.player) radio('CIC', `${ASM[ASM_TYPE[s.cls] || 'yj83'].name} launch from ${s.name}, bearing ${fmtBrg(bearing(t.x, t.z, s.x, s.z))}.`, 'bad');
    }
  }
}
function aiAirDefence(s, dt) {
  if (s.dead || !s.C.sam) return;
  s.samCd -= dt;
  if (s.samCd > 0) return;
  s.samCd = rand(3.5, 5.5);
  const enemy = s.side !== PL.side;
  let tgt = null, bd = 12000;
  for (const j of airTargets()) { if (j.side === s.side || j.samOn) continue; const d = j.p.distanceTo(s.pos); if (d < (j === W.helo ? 8000 : 12000) && d < bd) { bd = d; tgt = j; } }
  if (!tgt) {
    bd = 6000;
    for (const m of W.missiles) {
      if (m.side === s.side || m.samOn || m.kind === 'sam' || m.kind === 'asroc') continue;
      const d = m.p.distanceTo(s.pos);
      if (d < bd && d > 1200 && m.target && m.target.side === s.side) { bd = d; tgt = m; }
    }
  }
  if (!tgt) return;
  tgt.samOn = true;
  // A helicopter down among the wave tops is a hard target
  const pk = tgt === W.helo ? (tgt.p.y < 60 ? 0.35 : 0.5) : tgt.isAir ? 0.6 : enemy ? DIFF[CFG.diff].samPk : 0.45;
  const from = new V3(s.x + fx(s.h) * s.L * 0.28, s.P.F + 1.5, s.z + fz(s.h) * s.L * 0.28);
  const m = launchMissile('sam', s, from, new V3(0, 1, 0), tgt, { pk, boost: 0.45 });
  m.onDone = () => { tgt.samOn = false; };
}
function aiSub(s, dt) {
  if (s.dead) return;
  s.revealT = Math.max(0, s.revealT - dt);
  const p = PL.ship;
  const wasDetected = s.detected;
  s.detected = s.revealT > 0 || (p && !p.dead && Math.hypot(p.x - s.x, p.z - s.z) < sonarRange()) || W.ships.some(o => !o.dead && o.side !== s.side && !o.isSub && o !== p && Math.hypot(o.x - s.x, o.z - s.z) < 3000);
  if (s.detected && !wasDetected && s.side !== PL.side) radio('Sonar', `Submarine contact, bearing ${fmtBrg(bearing(p.x, p.z, s.x, s.z))}, ${(Math.hypot(p.x - s.x, p.z - s.z) / 1000).toFixed(1)} km. Classified ${s.C.label}.`, 'bad');
  const t = s.ai.target;
  if (!t || t.dead) return;
  s.torpCd -= dt;
  const d = Math.hypot(t.x - s.x, t.z - s.z);
  if (s.torpCd <= 0 && d < 6500) { s.torpCd = DIFF[CFG.diff].torpEvery * rand(0.85, 1.2) * (s.side === PL.side ? 1.3 : 1); launchTorpedo(s, t); }
}
function aiCarrier(s, dt) {
  if (s.dead || !s.C.jets) return;
  s.launchCd -= dt;
  if (s.launchCd <= 0) {
    s.launchCd = rand(45, 60) * DIFF[CFG.diff].jetMul;
    const t = pickTarget(s);
    if (!t) return;
    for (let i = 0; i < 2; i++) spawnJet(s.side, s.C.jets, s.x + fx(s.h) * 120 + i * 40, s.z + fz(s.h) * 120, s.h, t);
    if (s.side !== PL.side) radio('CIC', `${s.name} is launching aircraft.`, 'bad');
  }
}

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */
const MS = { def: null, idx: 0, t: 0, objs: [], timers: [], over: false, won: false, endT: 0, waypoints: [], limit: 0, kills: {}, arrived: 0 };
const OTHER = s => (s === 'PLA' ? 'ALLIED' : 'PLA');

const MISSIONS = [
  {
    id: 'patrol', endless: true, env: null, time: 'Any', weather: 'Random weather · endless waves',
    title: { ALLIED: 'Open Patrol', PLA: 'Open Patrol' },
    place: { ALLIED: 'Taiwan Strait', PLA: 'Taiwan Strait' },
    brief: {
      ALLIED: 'An open-ended patrol of the strait in whatever weather the day brings. Enemy groups arrive in waves, each larger than the last, with aircraft and submarines joining later. Between waves you are resupplied and repaired a little. Survive as long as you can.',
      PLA: 'An open-ended patrol of the strait in whatever weather the day brings. Enemy groups arrive in waves, each larger than the last, with aircraft and submarines joining later. Between waves you are resupplied and repaired a little. Survive as long as you can.',
    },
    loadout: { asm: 6, sam: 18, asroc: 4, special: 1, chaff: 4, flares: 6, helo: 3 },
    setup(A) {
      A.player(0, 0, A.toward);
      A.ally('frigate', { x: A.ex(-500), z: 1300, h: A.toward });
      MS.wave = 0; MS.waveT = 10; MS.score = 0;
      A.obj({ text: 'Hold the patrol line', need: 1e9, count: () => 0, progress: () => `wave ${MS.wave} · ${MS.score} pts` });
    },
    tick(A, dt) {
      const alive = W.ships.some(s => s.side === A.E && !s.dead) || W.jets.some(j => j.side === A.E);
      if (MS.waveT > 0) { MS.waveT -= dt; if (MS.waveT <= 0) patrolWave(A, ++MS.wave); return; }
      if (!alive) {
        MS.waveT = 20;
        const s = PL.ship;
        PL.asm = Math.min(FIXED_ASM[PL.side] || 10, PL.asm + 2); PL.sam = Math.min(30, PL.sam + 6); PL.chaff = Math.min(6, PL.chaff + 1); PL.asroc = Math.min(6, PL.asroc + 1);
        if (PL.side === 'PLA') PL.pd = Math.min(16, PL.pd + 6);
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.15);
        for (const k in PL.sys) PL.sys[k] = Math.min(100, PL.sys[k] + 30);
        W.datums = W.datums.filter(d => !d.sub.dead);
        radio('Fleet', `Wave ${MS.wave} beaten. Replenishment alongside: missiles, decoys and repair crews. Next wave in 20 seconds.`, 'good');
      }
    },
  },
  {
    id: 'median', env: 'dawn', time: '06:12', weather: 'Dawn · light cloud · calm',
    title: { ALLIED: 'Median Line', PLA: 'Median Line' },
    place: { ALLIED: 'Central Taiwan Strait', PLA: 'Central Taiwan Strait' },
    brief: {
      ALLIED: 'Two PLA Navy frigates crossed the median line at first light and are closing on the Penghu approaches. Turn them back the hard way: sink both. ROCS Cheng Kung is in company. Use this action to learn the fire-control system.',
      PLA: 'Two ROC Navy frigates are shadowing our exercise area east of the median line. Sink both before they report our positions. The frigate Huangshan is in company. Use this action to learn the fire-control system.',
    },
    loadout: { asm: 6, sam: 14, asroc: 2, special: 1, chaff: 4, flares: 0 },
    setup(A) {
      A.player(0, 0, A.toward);
      A.ally('frigate', { x: A.ex(-600), z: 1100, h: A.toward });
      A.enemy('frigate', { x: A.ex(11500), z: -1600, h: A.away, tag: 'f' });
      A.enemy('frigate', { x: A.ex(12500), z: 1400, h: A.away, tag: 'f' });
      A.obj({ text: 'Sink both frigates', need: 2, count: () => A.killed('f') });
      A.obj({ text: 'Keep hull integrity above 60%', secondary: true, final: () => PL.ship.hp / PL.ship.maxHp >= 0.6 });
      A.at(2, () => radio('CIC', `Two surface contacts bearing ${fmtBrg(A.toward)}, range 12 km, closing. Classified ${CLASS[ROLES[A.E].frigate[0]].label}s.`));
      A.at(7, () => radio('Gunnery', 'Put the crosshair on a contact to lock it. Hold the left mouse button to fire; fire control leads the target for you.', 'tip'));
      A.at(16, () => radio('Gunnery', 'Right mouse button for binoculars. E launches a missile at the locked target. W and S ring the engine telegraph, A and D put the rudder over.', 'tip'));
      A.at(30, () => radio('CIC', 'If they launch missiles, the close-in guns engage automatically. Press C to fire chaff and decoys.', 'tip'));
      A.at(44, () => radio('Navigator', 'Their salvos walk closer each time. Put the rudder over or change speed to throw off their aim.', 'tip'));
    },
  },
  {
    id: 'convoy', env: 'morning', time: '09:40', weather: 'Morning · scattered cloud · moderate sea',
    title: { ALLIED: 'Convoy to Makung', PLA: 'Convoy to Pingtan' },
    place: { ALLIED: 'Penghu Islands', PLA: 'Pingtan Island' },
    brief: {
      ALLIED: 'Three merchant ships carrying fuel and ammunition must reach Makung harbour in the Penghu Islands. PLA missile boats and a surface group will try to stop them. Get at least two ships into the harbour.',
      PLA: 'Three merchant ships carrying fuel and stores must reach the Pingtan anchorage. ROC missile boats and a surface group will try to stop them. Get at least two ships into the anchorage.',
    },
    loadout: { asm: 6, sam: 18, asroc: 2, special: 1, chaff: 4, flares: 0 },
    setup(A) {
      A.islands([
        { x: 0, z: -7900, r: 2300, h: 42, seed: 3, plateau: true, basalt: true, dry: true, town: 260, light: 1.3 },
        { x: -3300, z: -5600, r: 800, h: 30, seed: 8, plateau: true, basalt: true, dry: true },
        { x: 3100, z: -5200, r: 650, h: 26, seed: 12, plateau: true, basalt: true, dry: true, town: 30 },
        { x: 2600, z: -10400, r: 1100, h: 35, seed: 5, plateau: true, basalt: true, dry: true },
      ]);
      const port = { x: 0, z: -3700, label: A.P === 'ALLIED' ? 'Makung' : 'Pingtan', r: 700 };
      MS.waypoints = [port];
      A.player(A.ex(1000), 300, 0);
      const path = [{ x: 0, z: -1800 }, port];
      const convoy = [[-350, 700], [380, 1300], [0, 1950]].map(([x, z]) => A.convoy('cargo', { x, z, h: 0, path, cruise: 12.5 }));
      const esc = A.ally('frigate', { x: A.ex(-1200), z: -400, h: 0 });
      esc.escort = convoy; esc.escortSide = A.P === 'ALLIED' ? -1 : 1;
      A.at(25, () => { for (let i = 0; i < 3; i++) A.enemy('fac', { x: A.ex(8000 + i * 300), z: -3200 + i * 500, h: A.away, tag: 'fac' }); radio('CIC', `Fast movers bearing ${fmtBrg(A.toward)}, 8 km. Missile boats, three of them.`, 'bad'); });
      A.at(80, () => { A.enemy('destroyer', { x: A.ex(13000), z: -1200, h: A.away }); A.enemy('frigate', { x: A.ex(12500), z: -2600, h: A.away }); radio('CIC', 'New surface group at 13 km: a destroyer and a frigate.', 'bad'); });
      A.at(86, () => radio('Captain', A.P === 'ALLIED' ? 'That destroyer outguns us. Lock her (T) and send the Harpoon salvo (Q), and keep turning so her guns cannot settle.' : 'That destroyer outguns us. Lock her (T) and call in the DF-21D (Q), and keep turning so her guns cannot settle.', 'tip'));
      A.at(140, () => A.jets(A.E, 2));
      A.at(200, () => { for (let i = 0; i < 2; i++) A.enemy('fac', { x: A.ex(7000), z: -4400 + i * 600, h: A.away, tag: 'fac' }); radio('CIC', 'Two more missile boats breaking out from behind the islands.', 'bad'); });
      A.obj({ text: `Bring 2 of 3 merchant ships into ${port.label}`, need: 2, count: () => MS.arrived, fail: () => W.ships.filter(s => s.role === 'convoy' && (!s.dead || s.arrived)).length < 2, progress: () => `${MS.arrived}/2` });
      A.obj({ text: 'Sink all the missile boats', secondary: true, final: () => A.killed('fac') >= A.count('fac') && A.count('fac') > 0 });
    },
  },
  {
    id: 'hunter', env: 'overcast', time: '13:05', weather: 'Overcast · rain showers · rough sea',
    title: { ALLIED: 'Silent Hunter', PLA: 'Silent Hunter' },
    place: { ALLIED: 'Southern approaches, Taiwan Strait', PLA: 'Southern approaches, Taiwan Strait' },
    brief: {
      ALLIED: 'Two Type 039A diesel submarines are hunting in the southern strait. Maritime patrol aircraft have dropped datum buoys on their last known positions. Close each datum until sonar holds contact, then kill them with ASROC (lock the sonar contact and press E). Evade torpedoes or decoy them with C.',
      PLA: 'Two Hai Kun-class submarines are hunting in the southern strait. Patrol aircraft have marked their last known positions. Close each datum until sonar holds contact, then kill them with anti-submarine rockets (lock the sonar contact and press E). Evade torpedoes or decoy them with C.',
    },
    loadout: { asm: 4, sam: 10, asroc: 8, special: 1, chaff: 5, flares: 0 },
    setup(A) {
      A.player(0, 0, A.toward);
      A.ally('frigate', { x: 700, z: 1600, h: A.toward });
      const s1 = A.enemy('sub', { x: A.ex(6500), z: -2600, h: A.away, tag: 'sub' });
      const s2 = A.enemy('sub', { x: A.ex(5200), z: 4300, h: A.away, tag: 'sub' });
      for (const s of [s1, s2]) W.datums.push({ x: s.x + rand(-500, 500), z: s.z + rand(-500, 500), r: 1300, sub: s });
      A.at(150, () => { A.enemy('frigate', { x: A.ex(14000), z: 500, h: A.away, tag: 'ff' }); radio('CIC', 'Surface contact closing from 14 km. Frigate.', 'bad'); });
      A.obj({ text: 'Find and sink both submarines', need: 2, count: () => A.killed('sub'), progress: () => `${A.killed('sub')}/2` });
      A.obj({ text: 'Sink the frigate', secondary: true, final: () => A.killed('ff') >= 1 });
      A.at(3, () => radio('Sonar', 'Nothing on the hull array yet. Datum circles are marked on the radar. Close them at speed, then slow down to listen.'));
    },
  },
  {
    id: 'vampire', env: 'haze', time: '16:20', weather: 'Afternoon · haze · moderate sea',
    title: { ALLIED: 'Vampire Raid', PLA: 'Vampire Raid' },
    place: { ALLIED: 'West of Kaohsiung', PLA: 'East of Shantou' },
    brief: {
      ALLIED: 'ROCS Panshih, the fleet\'s only fast combat support ship, is transiting under your protection. PLA naval aviation is sending strike after strike. Keep her afloat until the air cover arrives. Automatic air defence fires SM-2s at anything aimed at her or you; save missiles by switching to manual (G), lock threats with T and fire with E. The gun bursts its shells near aircraft and missiles.',
      PLA: 'Chaganhu, a Type 901 fast combat support ship, is transiting under your protection. Allied strike aircraft are coming in waves. Keep her afloat until our fighters arrive. Automatic air defence fires HHQ-9s at anything aimed at her or you, with HQ-10 point defence inside 4 km; save missiles by switching to manual (G), lock threats with T and fire with E. The gun bursts its shells near aircraft and missiles.',
    },
    loadout: { asm: 2, sam: 30, asroc: 0, special: 1, chaff: 6, flares: 0 },
    setup(A) {
      MS.limit = 270;
      const hvu = A.protect('supply', { x: 0, z: 500, h: A.away, path: [{ x: A.ex(-30000), z: 0 }], cruise: 7 });
      A.player(400, -500, A.away);
      A.ally('destroyer', { x: -1300, z: 1800, h: A.away });
      A.at(14, () => { A.jets(A.E, 2, hvu); radio('Air', `Raid inbound, bearing ${fmtBrg(A.toward)}. Two strike fighters, low.`, 'bad'); sfx('alarm'); });
      A.at(70, () => { A.jets(A.E, 4, hvu); radio('Air', 'Second raid: four aircraft.', 'bad'); });
      A.at(135, () => { A.salvo(4, hvu); radio('CIC', 'Over-the-horizon salvo! Four sea-skimmers inbound.', 'bad'); sfx('alarm'); });
      A.at(185, () => { A.jets(A.E, 4); radio('Air', 'Third raid inbound.', 'bad'); });
      A.at(232, () => { A.salvo(5, hvu); A.jets(A.E, 2, hvu); radio('CIC', 'Massed missile attack! Everything we have.', 'bad'); sfx('alarm'); });
      A.obj({ text: 'Hold until the air cover arrives', need: 1, count: () => (MS.t >= MS.limit ? 1 : 0) });
      A.obj({ text: `Keep ${hvu.name} afloat`, need: 1, count: () => (MS.t >= MS.limit ? 1 : 0), fail: () => hvu.dead });
      A.obj({ text: 'Shoot down 5 aircraft yourself', secondary: true, final: () => PL.stats.air >= 5, progress: () => `${PL.stats.air}/5` });
    },
  },
  {
    id: 'rescue', env: 'squall', time: '17:35', weather: 'Late afternoon · squalls · rough sea',
    title: { ALLIED: 'Pilot Down', PLA: 'Pilot Down' },
    place: { ALLIED: 'West of the Penghu Islands', PLA: 'East of Nan\'ao Island' },
    brief: {
      ALLIED: 'An ROCAF F-16V pilot has ejected over the strait and is adrift in a life raft 8 km west of you, beacon transmitting. PLA missile boats are racing to reach the raft first. Get there and bring the pilot aboard: stop within 150 m of the raft (under 5 knots) and hold while the sea boat makes the pickup, or send the Seahawk (L) to winch the pilot up. Keep the boats off the raft, then take the pilot back to the rendezvous.',
      PLA: 'A J-16 pilot has ejected over the strait and is adrift in a life raft 8 km east of you, beacon transmitting. ROC missile boats are racing to reach the raft first. Get there and bring the pilot aboard: stop within 150 m of the raft (under 5 knots) and hold while the sea boat makes the pickup, or send the Z-9C (L) to winch the pilot up. Keep the boats off the raft, then take the pilot back to the rendezvous.',
    },
    loadout: { asm: 6, sam: 16, asroc: 2, special: 1, chaff: 4, flares: 0, helo: 2 },
    setup(A) {
      A.player(0, 0, A.toward);
      const R = MS.raft = { x: A.ex(8200), z: -700, state: 'adrift', hold: 0, cap: 0, obj: buildRaft(), smokeAcc: 0, strobe: 0, warned: 0 };
      scene.add(R.obj);
      const rv = { x: A.ex(-1500), z: 600, label: 'Rendezvous', r: 800 };
      MS.waypoints = [{ x: R.x, z: R.z, label: 'Raft' }];
      for (let i = 0; i < 3; i++) { const b = A.enemy('fac', { x: A.ex(15500 + i * 400), z: -2400 + i * 1500, h: A.away, tag: 'fac' }); b.capture = true; }
      A.at(55, () => { A.jets(A.E, 2); radio('Air', 'Two fast movers inbound, low.', 'bad'); });
      A.at(175, () => { A.enemy('frigate', { x: A.ex(18000), z: 1800, h: A.away, tag: 'ff' }); radio('CIC', `Frigate closing from 18 km. Her missiles reach 8 km: keep the ${HELO_NAME[A.P]} clear of her.`, 'bad'); });
      A.at(165, () => { if (R.state !== 'adrift') return; for (let i = 0; i < 2; i++) { const b = A.enemy('fac', { x: A.ex(14000), z: 2600 - i * 900, h: A.away, tag: 'fac' }); b.capture = true; } radio('CIC', 'Two more boats heading for the raft!', 'bad'); });
      const back = A.obj({ text: 'Take the pilot to the rendezvous', hidden: true, need: 1, fail: () => R.state === 'lost', count: () => (R.state === 'aboard' && PL.ship && Math.hypot(PL.ship.x - rv.x, PL.ship.z - rv.z) < rv.r ? 1 : 0) });
      R.onAboard = () => { back.hidden = false; MS.waypoints = [rv]; };
      A.obj({
        text: 'Recover the pilot', need: 1, count: () => (R.state === 'aboard' || R.state === 'helo' ? 1 : 0), fail: () => R.state === 'lost',
        progress: () => (R.hold > 0 ? `pickup ${Math.round(R.hold / RAFT_HOLD * 100)}%` : R.cap > 0 ? 'boats at the raft!' : PL.ship ? `${(Math.hypot(R.x - PL.ship.x, R.z - PL.ship.z) / 1000).toFixed(1)} km` : ''),
      });
      // Keep the rendezvous objective after the recovery one in the list
      MS.objs.push(MS.objs.shift());
      A.obj({ text: 'Sink all the missile boats', secondary: true, final: () => A.killed('fac') >= A.count('fac') && A.count('fac') > 0 });
      A.at(3, () => radio('CIC', `Beacon bearing ${fmtBrg(bearing(0, 0, R.x, R.z))}, 8.2 km. Missile boats on radar beyond it, heading for the raft.`, 'bad'));
      A.at(9, () => radio('Captain', `Ahead flank. Slow below 5 knots within 150 m of the raft to pick the pilot up, or launch the ${HELO_NAME[A.P]} with L.`, 'tip'));
    },
    tick(A, dt) { raftTick(dt); },
  },
  {
    id: 'night', env: 'night', time: '23:40', weather: 'Night · moonlit · calm',
    title: { ALLIED: 'Kinmen Night', PLA: 'Xiamen Approaches' },
    place: { ALLIED: 'Kinmen', PLA: 'Kinmen' },
    brief: {
      ALLIED: 'Under cover of darkness, a swarm of Type 022 missile boats is gathering in the lee of the island to strike the Kinmen garrison\'s supply line. Find them and sink them all. Fire star shells with F to light them up; their wakes and gun flashes give them away.',
      PLA: 'Under cover of darkness, ROC Kuang Hua VI missile boats are gathering in the lee of the island to strike our Xiamen approaches. Find them and sink them all. Fire star shells with F to light them up; their wakes and gun flashes give them away.',
    },
    loadout: { asm: 6, sam: 12, asroc: 2, special: 1, chaff: 4, flares: 8 },
    setup(A) {
      A.islands([
        { x: A.ex(5200), z: -3200, r: 2400, h: 55, seed: 21, town: 320, light: 0.4 },
        { x: A.ex(2400), z: 2900, r: 650, h: 30, seed: 4 },
        { x: A.ex(9000), z: 2600, r: 1200, h: 70, seed: 17 },
      ]);
      A.player(0, 0, A.toward);
      for (let i = 0; i < 4; i++) A.at(8 + i * 3, () => A.enemy('fac', { x: A.ex(7400), z: -800 + i * 240, h: A.away, tag: 'fac' }));
      A.at(115, () => { for (let i = 0; i < 3; i++) A.enemy('fac', { x: A.ex(3800 + i * 150), z: 5200, h: A.away - 0.6 * A.dir, tag: 'fac' }); radio('CIC', 'Three more boats coming round the north point!', 'bad'); });
      A.enemy('frigate', { x: A.ex(10500), z: 900, h: A.away, tag: 'ff', speed: 6 });
      A.obj({ text: 'Sink all 7 missile boats', need: 7, count: () => A.killed('fac'), progress: () => `${A.killed('fac')}/7` });
      A.obj({ text: 'Sink the frigate', secondary: true, final: () => A.killed('ff') >= 1 });
      A.at(4, () => radio('CIC', 'Radar shows small fast contacts in the island\'s shadow. Star shells loaded: press F.'));
    },
  },
  {
    id: 'carrier', env: 'storm', time: '18:45', weather: 'Dusk · thunderstorm · very rough sea',
    title: { ALLIED: 'Carrier Strike', PLA: 'Carrier Strike' },
    place: { ALLIED: 'South of the Penghu Islands', PLA: 'Bashi Channel approaches' },
    brief: {
      ALLIED: 'The carrier Fujian is using a storm front to cover her group\'s run through the strait. Her escorts are a Type 055, a Type 052D and a frigate, and she is launching strike aircraft. Break through and sink the carrier. You have six Hsiung Feng III supersonic missiles and two Harpoon salvos.',
      PLA: 'USS George Washington is using a storm front to cover her group\'s run north. Her escorts are destroyers and a frigate, and she is launching strike aircraft. Break through and sink the carrier. You have two DF-21D strikes.',
    },
    loadout: { asm: 10, sam: 24, asroc: 2, special: 2, chaff: 6, flares: 0 },
    setup(A) {
      A.player(0, 0, A.toward);
      A.ally('destroyer', { x: 900, z: 1500, h: A.toward });
      A.ally('frigate', { x: -900, z: -1300, h: A.toward });
      const cv = A.enemy('carrier', { x: A.ex(16000), z: -1500, h: A.toward, tag: 'cv', speed: 6 });
      A.enemy('heavy', { x: A.ex(14000), z: -300, h: A.away, tag: 'esc' });
      A.enemy('destroyer', { x: A.ex(15500), z: -3600, h: A.away, tag: 'esc' });
      A.enemy('frigate', { x: A.ex(11500), z: 1200, h: A.away, tag: 'esc' });
      cv.launchCd = 20;
      A.obj({ text: `Sink ${cv.name}`, need: 1, count: () => A.killed('cv') });
      A.obj({ text: 'Sink all three escorts', secondary: true, final: () => A.killed('esc') >= 3, progress: () => `${A.killed('esc')}/3` });
      A.at(3, () => radio('CIC', `Carrier group bearing ${fmtBrg(A.toward)}, 16 km, opening. Escorts are turning toward us.`, 'bad'));
    },
  },
];

// Open Patrol: endless, escalating waves in random weather.
const PATROL_ENV = [['dawn', '06:10'], ['morning', '09:30'], ['overcast', '13:00'], ['haze', '16:00'], ['sunset', '18:20'], ['night', '23:30'], ['storm', '18:45']];
function patrolWave(A, n) {
  const P0 = PL.ship, center = A.toward;
  const place = () => { const b = center + rand(-1.1, 1.1), d = rand(10500, 15000); return { x: P0.x + fx(b) * d, z: P0.z + fz(b) * d, h: b + Math.PI }; };
  const add = (role, k) => { for (let i = 0; i < k; i++) A.enemy(role, { ...place(), tag: 'w' }); };
  add('frigate', Math.min(4, 1 + Math.floor(n / 2)));
  if (n >= 2) add('fac', Math.min(4, n - 1));
  if (n >= 3) add('destroyer', Math.min(3, Math.floor((n - 1) / 2)));
  if (n >= 6) add('heavy', 1);
  if (n >= 4 && n % 2 === 0) { const q = place(); const sub = A.enemy('sub', { x: P0.x + (q.x - P0.x) * 0.5, z: P0.z + (q.z - P0.z) * 0.5, h: q.h, tag: 'w' }); W.datums.push({ x: sub.x + rand(-600, 600), z: sub.z + rand(-600, 600), r: 1400, sub }); }
  if (n >= 2) A.at(MS.t + 35, () => { if (!MS.over) { A.jets(A.E, Math.min(8, 2 + Math.floor(n / 3) * 2)); radio('Air', 'Enemy strike aircraft inbound.', 'bad'); } });
  radio('CIC', `Wave ${n}: new contacts bearing ${fmtBrg(center)}, 10 to 15 km.`, 'bad');
  sfx('alarm');
}
MISSIONS.push(MISSIONS.shift());
function missionAPI(def) {
  const P = CFG.side, E = OTHER(P);
  const dir = P === 'ALLIED' ? -1 : 1;
  const A = {
    P, E, dir,
    ex: d => d * dir,
    toward: P === 'ALLIED' ? -Math.PI / 2 : Math.PI / 2,
    away: P === 'ALLIED' ? Math.PI / 2 : -Math.PI / 2,
    player: (x, z, h) => setupPlayer(P, x, z, h),
    spawn(side, role, o) {
      const cls = o.cls || pick(ROLES[side][role]);
      if (o.tag) MS.spawned[o.tag] = (MS.spawned[o.tag] || 0) + 1;
      return spawnShip(cls, side, { ...o, speed: o.speed ?? CLASS[cls].speed * 0.75 });
    },
    enemy: (role, o) => A.spawn(E, role, { ...o, role: 'combat' }),
    ally: (role, o) => A.spawn(P, role, { ...o, role: 'combat' }),
    convoy: (role, o) => { const s = A.spawn(P, role, { ...o, role: 'convoy', priority: 1.3, hpMul: 1.8 }); s.cruise = o.cruise; s.order = o.cruise; return s; },
    protect: (role, o) => { const s = A.spawn(P, role, { ...o, role: 'hvu', priority: 1.8 }); s.cruise = o.cruise; return s; },
    jets(side, n, target) {
      const kinds = JET_KIND[side];
      const bx = side === P ? A.ex(-22000) : A.ex(22000);
      for (let i = 0; i < n; i++) {
        const t = target && !target.dead ? (i % 2 ? PL.ship : target) : null;
        spawnJet(side, kinds[i % kinds.length], bx + rand(-800, 800), rand(-4000, 4000) + (PL.ship ? PL.ship.z : 0), side === P ? A.toward : A.away, t);
      }
    },
    salvo(n, target) {
      for (let i = 0; i < n; i++) {
        const t = i % 2 && PL.ship ? PL.ship : target;
        if (!t || t.dead) continue;
        const b = A.toward + rand(-0.5, 0.5);
        const p = new V3(t.x + fx(b) * 16000, 12, t.z + fz(b) * 16000);
        const ghost = { side: E, player: false, name: 'Over-the-horizon launcher' };
        W.pending.push({ t: i * 1.4, fn: () => { if (!t.dead) { const prof = E === 'PLA' ? 'yj18' : (i % 2 ? 'hf3' : 'harpoon'); const m = launchMissile('asm', ghost, p, new V3(-fx(b), 0, -fz(b)), t, { prof, dmg: ASM[prof].dmg * DIFF[CFG.diff].dmg, boost: 0.1, speed0: ASM[prof].cruise }); } } });
      }
    },
    islands(list) {
      for (const I of list) { W.islands.push(I); const g = buildIsland(I); scene.add(g); W.islandObjs.push(g); }
    },
    at: (t, fn) => MS.timers.push({ t, fn }),
    obj(o) { const ob = { done: false, failed: false, ...o }; MS.objs.push(ob); return ob; },
    killed: tag => MS.kills[tag] || 0,
    count: tag => MS.spawned[tag] || 0,
  };
  return A;
}

function clearWorld() {
  if (MS.raft) { scene.remove(MS.raft.obj); MS.raft.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); MS.raft.obj.userData.strobe.material.dispose(); MS.raft = null; }
  for (const s of W.ships) removeShip(s);
  for (const j of W.jets) scene.remove(j.obj);
  if (W.helo) scene.remove(W.helo.obj);
  for (const m of W.missiles) scene.remove(m.obj);
  for (const g of W.islandObjs) { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  for (const k of Object.keys(W)) W[k] = [];
  W.helo = null;
  [fxSmoke, fxSpray, fxFire, fxSpark].forEach(f => f.clear());
  DEBRIS.list = [];
  for (const L of LIGHTS) { L.t = 0; L.hold = 0; L.l.intensity = 0; }
  scene.add(camera);
  PL.ship = null; PL.lock = null; PL.salvo = [];
  Object.keys(nameIx).forEach(k => delete nameIx[k]);
}

const RANGES = [];
function buildRanges() {
  RANGES.push(buildRange({ x: 40000, z: 0, len: 150000, wid: 22000, h: 2800, seed: 3, color: 0x34432f }));
  RANGES.push(buildRange({ x: -50000, z: 0, len: 150000, wid: 18000, h: 900, seed: 9, color: 0x3a4535 }));
  RANGES.forEach(r => scene.add(r));
}

function startMission(i) {
  const def = MISSIONS[i];
  clearWorld();
  Object.assign(MS, { def, idx: i, t: 0, objs: [], timers: [], over: false, won: false, endT: 0, waypoints: [], limit: 0, kills: {}, spawned: {}, arrived: 0, raft: null });
  let env = def.env;
  MS.timeLabel = def.time;
  if (def.endless) { const e = pick(PATROL_ENV); env = e[0]; MS.timeLabel = e[1]; }
  applyEnv(env);
  const A = missionAPI(def);
  def.setup(A);
  const lo = def.loadout;
  PL.asm = FIXED_ASM[CFG.side] ?? lo.asm; PL.sam = lo.sam; PL.asroc = lo.asroc; PL.pd = CFG.side === 'PLA' ? 16 : 0;
  PL.special = lo.special; PL.chaff = lo.chaff; PL.flares = lo.flares; PL.chaffCd = 0; PL.gunCd = 0; PL.warned = false; PL.salvo = [];
  PL.heloSorties = lo.helo ?? 2; PL.heloCd = 0;
  $('missionName').textContent = def.title[CFG.side];
  state = 'play';
  show('hud', true); show('title', false); show('brief', false); show('debrief', false); show('pause', false);
  show('touch', PL.touch);
  $('radio').innerHTML = '';
  radio('Captain', `${PL.ship.name}, battle stations. ${def.title[CFG.side]}.`);
  sfx('alarm');
  lockPointer();
}

const SCORE = { frigate: 100, fac: 60, destroyer: 200, heavy: 300, sub: 250, carrier: 1000 };
function onShipKilled(s, src) {
  if (s.tag) MS.kills[s.tag] = (MS.kills[s.tag] || 0) + 1;
  if (MS.def && MS.def.endless && s.side !== PL.side) {
    const role = Object.keys(ROLES[s.side]).find(r => ROLES[s.side][r].includes(s.cls)) || 'frigate';
    MS.score += Math.round((SCORE[role] || 100) * (1 + MS.wave * 0.1) * (src && src.player ? 2 : 1));
  }
  if (state !== 'play') return;
  if (s.player) { radio('Captain', 'Abandon ship! Abandon ship!', 'bad'); endMission(false, `${s.name} was sunk.`); return; }
  if (src && src.player) { PL.stats.kills++; hitMark(true, true); }
  if (s.side !== PL.side) radio('CIC', `${s.name} is sinking${src && src.player ? '. Good shooting.' : '.'}`, 'good');
  else radio('CIC', `${s.name} has been hit and is going down.`, 'bad');
}
// Hit confirmation at the crosshair: white for a hit, red when it kills.
function hitMark(big, kill) {
  if (state !== 'play') return;
  if (kill) { PL.hitKill = true; PL.hitT = 0.75; }
  else if (!PL.hitKill || PL.hitT <= 0) { PL.hitKill = false; PL.hitT = 0.32; }
  PL.hitBig = big || kill;
  sfx('blip', 1, 0, kill ? 1150 : 2500);
}
function onJetKilled(j, by) {
  if (state !== 'play') return;
  if (j === W.helo) { radio('Air', `${j.name} is down! We have lost our helicopter.`, 'bad'); return; }
  if (by && by.player) { PL.stats.air++; PL.stats.kills++; hitMark(true, true); }
  if (MS.def && MS.def.endless && j.side !== PL.side) MS.score += Math.round(80 * (1 + MS.wave * 0.1) * (by && by.player ? 2 : 1));
  if (j.side !== PL.side) radio('Air', `${j.name} splashed${by && by.player ? ' by our fire' : ''}.`, 'good');
}
function onArrived(s) {
  MS.arrived++;
  radio('Harbour control', `${s.name} is inside the breakwater. ${MS.arrived} safe.`, 'good');
}

function updateMission(dt) {
  if (MS.over) {
    MS.endT -= dt;
    if (MS.endT <= 0 && state === 'play') showDebrief();
    return;
  }
  MS.t += dt;
  for (const tm of MS.timers) if (!tm.done && MS.t >= tm.t) { tm.done = true; tm.fn(); }
  if (MS.def.tick) MS.def.tick(missionAPI(MS.def), dt);
  let allPrimary = true;
  for (const o of MS.objs) {
    if (o.final) continue;
    if (!o.done && !o.failed) {
      if (o.fail && o.fail()) { o.failed = true; radio('Fleet', `Objective failed: ${o.text}.`, 'bad'); }
      else if (o.count && o.count() >= o.need) { o.done = true; radio('Fleet', `Objective complete: ${o.text}.`, 'good'); }
    }
    if (!o.secondary && o.failed) { endMission(false, `Objective failed: ${o.text}.`); return; }
    if (!o.secondary && !o.done) allPrimary = false;
  }
  if (allPrimary) endMission(true, 'All primary objectives complete.');
}
function endMission(won, reason) {
  if (MS.over) return;
  MS.over = true; MS.won = won; MS.reason = reason; MS.endT = won ? 4 : 6;
  for (const o of MS.objs) if (o.final) o.done = !!o.final();
  radio('Fleet', won ? 'Well done. Mission accomplished.' : reason, won ? 'good' : 'bad');
}
const PROG_KEY = 'straitfire3d-progress';
function loadProgress() { try { return JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); } catch (e) { return {}; } }
function saveProgress(p) { try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }

function showDebrief() {
  state = 'debrief';
  unlockPointer();
  const def = MS.def, s = PL.ship;
  const hp = s ? clamp(s.hp / s.maxHp, 0, 1) : 0;
  const secOK = MS.objs.filter(o => o.secondary).every(o => o.done);
  let stars = MS.won ? 1 + (hp >= 0.5 ? 1 : 0) + (secOK ? 1 : 0) : 0;
  if (def.endless) {
    const done = Math.max(0, MS.wave - 1);
    stars = done >= 10 ? 3 : done >= 6 ? 2 : done >= 3 ? 1 : 0;
    const p = loadProgress(), k = CFG.side + ':' + def.id;
    p[k] = Math.max(p[k] || 0, stars); p[k + ':score'] = Math.max(p[k + ':score'] || 0, MS.score); saveProgress(p);
    $('dbTitle').textContent = 'Patrol over';
    $('dbSub').textContent = `Survived ${done} wave${done === 1 ? '' : 's'} · ${MS.score} points · best ${p[k + ':score']}`;
  } else {
    if (MS.won) { const p = loadProgress(); const k = CFG.side + ':' + def.id; p[k] = Math.max(p[k] || 0, stars); saveProgress(p); }
    $('dbTitle').textContent = MS.won ? 'Mission accomplished' : 'Mission failed';
    $('dbSub').textContent = `${def.title[CFG.side]} · ${MS.reason}`;
  }
  $('dbStars').innerHTML = [0, 1, 2].map(i => `<i class="${i < stars ? 'on' : ''}"></i>`).join('');
  const acc = PL.stats.shells ? Math.round(100 * PL.stats.hits / Math.max(1, PL.stats.shells + PL.stats.msl)) : 0;
  $('dbStats').innerHTML = [
    ['Time', fmtTime(MS.t)], ['Hull', Math.round(hp * 100) + '%'], ['Ships and aircraft destroyed', PL.stats.kills],
    ['Shells fired', PL.stats.shells], ['Missiles fired', PL.stats.msl], ['Hits', PL.stats.hits],
  ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
  $('dbObj').innerHTML = MS.objs.map(o => `<li class="${o.done ? 'done' : 'failed'}${o.secondary ? ' sec' : ''}"><span></span>${o.text}</li>`).join('');
  $('dbNext').hidden = !MS.won || MS.idx >= MISSIONS.length - 1 || !!def.endless || !!(MISSIONS[MS.idx + 1] || {}).endless;
  show('hud', false); show('touch', false); show('debrief', true);
  void acc;
}

/* ------------------------------------------------------------------ */
/* Menu backdrop                                                       */
/* ------------------------------------------------------------------ */
let attract = null;
function startAttract() {
  clearWorld();
  applyEnv('sunset');
  const side = CFG.side, ps = PLAYER_SHIP[side];
  const hero = spawnShip(ps.cls, side, { name: ps.name, no: ps.no, x: 0, z: 0, h: 4.2, speed: 9, role: 'cruise' });
  spawnShip(ROLES[side].frigate[0], side, { x: 900, z: 1500, h: 4.2, speed: 9, role: 'cruise' });
  spawnShip(ROLES[side].destroyer[0], side, { x: -1400, z: 2600, h: 4.2, speed: 9, role: 'cruise' });
  attract = { hero, a: 0.6 };
  MS.def = null; MS.waypoints = [];
}
function updateAttract(dt) {
  if (!attract) return;
  attract.a += dt * 0.025;
  const h = attract.hero;
  const r = 230;
  camera.position.set(h.x + Math.cos(attract.a) * r, 26 + Math.sin(attract.a * 0.7) * 6, h.z + Math.sin(attract.a) * r);
  camera.lookAt(h.x + fx(h.h) * 30, 14, h.z + fz(h.h) * 30);
  camera.fov = 45; camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let state = 'loading';
const show = (id, on) => { $(id).hidden = !on; };
let lightningT = 8;
function updateWorld(dt, playing) {
  TIME += dt;
  if (playing) { updatePlayerControls(dt); }
  for (const s of W.ships) {
    if (!s.player) {
      if (s.isSub) { aiShip(s, dt); aiSub(s, dt); }
      else { aiShip(s, dt); aiAirDefence(s, dt); aiCarrier(s, dt); }
    }
    stepShip(s, dt);
    updateCIWS(s, dt);
  }
  W.ships = W.ships.filter(s => !s.sunk);
  if (playing) { updatePlayerCamera(dt); aimUpdate(); playerWeapons(dt); }
  updateSearchlight(dt);
  updateJets(dt); if (playing) updateHelo(dt); updateMissiles(dt); updateTorps(dt); updateShells(dt);
  for (const p of W.pending) {
    if (p.fall) {
      p.life -= dt; p.v.y -= 9.8 * dt; p.p.addScaledVector(p.v, dt);
      fxFire.emit(p.p.x, p.p.y, p.p.z, 0, 0, 0, 0.3, 3, 5, 5, 2.4, 1, 0.8, 0, 0, 0.6);
      const L = 0.1 + LIT() * 0.2; fxSmoke.emit(p.p.x, p.p.y, p.p.z, 0, 1, 0, 4, 3, 10, L, L, L, 0.7, 0.4, 0.5);
      if (p.p.y <= 0) { fxSplash(p.p.x, p.p.z, 0.9); p.done = true; }
      if (p.life <= 0) p.done = true;
    } else { p.t -= dt; if (p.t <= 0) { p.done = true; p.fn(); } }
  }
  W.pending = W.pending.filter(p => !p.done);
  for (const f of W.flares) {
    f.t -= dt; f.p.y = Math.max(20, f.p.y - 4.5 * dt); f.p.x += WIND.x * dt; f.p.z += WIND.z * dt;
    if (f.light) { f.light.l.position.copy(f.p); if (f.t < 3) f.light.hold = 0; }
    fxFire.emit(f.p.x, f.p.y, f.p.z, 0, 0, 0, 0.05, 9, 9, 6, 5.6, 4.5, 1);
    if (Math.random() < dt * 8) { const L = 0.35; fxSmoke.emit(f.p.x, f.p.y + 2, f.p.z, 0, 2, 0, 6, 2, 8, L, L, L, 0.4, 0.2, 0); }
  }
  W.flares = W.flares.filter(f => f.t > 0);
  for (const c of W.chaff) c.t -= dt;
  W.chaff = W.chaff.filter(c => c.t > 0);
  // Ships near the player that haven't been detected (subs) stay hidden; everything else is a radar contact
  WIND.set(3 + SEA.amp * 0.8, 0, 1.5);
  fxSmoke.update(dt, WIND); fxSpray.update(dt, WIND); fxFire.update(dt, WIND); fxSpark.update(dt, WIND);
  updateLights(dt);
  updateDebris(dt);
  // Lightning
  if (SEA.lightning) {
    lightningT -= dt;
    if (lightningT < 0) {
      lightningT = rand(6, 16);
      const flash = rand(0.25, 0.6);
      GRADE.flash.value = flash * 0.18; cloudMat.uniforms.flash.value = flash;
      hemi.intensity += 3 * flash;
      setTimeout(() => { hemi.intensity = 1.0 * SEA.light; }, 120);
      setTimeout(() => sfx('thunder', 1), rand(400, 2600));
    }
    cloudMat.uniforms.flash.value *= Math.pow(0.02, dt);
  }
}

// Screen position and strength of the sun (or moon) for the lens glare in the grading pass.
const _sunV = new V3(), _camDir = new V3();
function updateSunGlare() {
  const night = SEA.night;
  const dir = night ? lightDir : SKY.sunPosition.value;
  const elev = Math.asin(clamp(dir.y / dir.length(), -1, 1));
  const cp = camera.getWorldPosition(_v2);
  _sunV.copy(dir).normalize().multiplyScalar(20000).add(cp);
  camera.getWorldDirection(_camDir);
  const front = _camDir.dot(_v.copy(dir).normalize());
  _sunV.project(camera);
  const onScreen = 1 - smooth(1.0, 1.35, Math.max(Math.abs(_sunV.x), Math.abs(_sunV.y)));
  const cov = cloudMat.uniforms.coverage.value;
  let vis = front > 0 ? onScreen * smooth(-0.02, 0.04, elev) * (1 - smooth(0.4, 0.95, cov) * 0.92) : 0;
  if (night) vis *= 0.25;
  if (PL.zoom > 0.5) vis *= 0.5;
  GRADE.sunVis.value = vis;
  GRADE.sunPos.value.set(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5);
  GRADE.sunCol.value.copy(sun.color).multiplyScalar(night ? 0.5 : 1);
}
/* Graphics quality: applied live, and in Auto mode stepped down when the frame rate sags. */
function setQuality(level) {
  const prev = gfxNow();
  GFX_STATE.level = level;
  const q = gfxNow();
  pixelRatio = Math.min(window.devicePixelRatio || 1, q.pr);
  bloomPass.enabled = q.bloom;
  GRADE.shafts.value = q.shafts;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); }
  if (WATER_RT && WATER_RT.width !== q.water) WATER_RT.setSize(q.water, q.water);
  if (q.shadow !== prev.shadow) {
    if (q.shadow) { sun.shadow.mapSize.setScalar(q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    if (renderer.shadowMap.enabled !== q.shadow > 0) {
      // Changing castShadow changes the light setup, which makes three.js rebuild every lit material, cached ones included
      renderer.shadowMap.enabled = sun.castShadow = q.shadow > 0;
      scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => (m.needsUpdate = true)); });
    }
  }
  resize();
  syncGfxUi();
}
function setGfxMode(mode) {
  GFX_STATE.mode = mode;
  try { localStorage.setItem('straitfire3d-gfx', mode); } catch (e) { /* storage blocked */ }
  PERF.t = PERF.n = 0; PERF.grace = 3; PERF.downs = 0;
  setQuality(mode === 'auto' ? (GFX_STATE.level === 'ultra' ? 'high' : GFX_STATE.level) : mode);
}
const PERF = { t: 0, n: 0, grace: 4, fast: 0, downs: 0 };
function perfWatch(raw) {
  if (GFX_STATE.mode !== 'auto' || state !== 'play' || document.hidden || raw > 0.5) { PERF.t = PERF.n = 0; return; }
  if (PERF.grace > 0) { PERF.grace -= raw; return; }
  PERF.t += raw; PERF.n++;
  if (PERF.t < 5) return;
  const fps = PERF.n / PERF.t, i = GFX_ORDER.indexOf(GFX_STATE.level);
  PERF.t = PERF.n = 0;
  let next = null;
  if (fps < 28 && i < GFX_ORDER.length - 1) { next = GFX_ORDER[i + 1]; PERF.downs++; PERF.fast = 0; }
  else if (fps > 57 && PERF.downs === 0 && GFX_STATE.level !== 'high' && GFX_STATE.level !== 'ultra') { if (++PERF.fast >= 3) { next = GFX_ORDER[i - 1]; PERF.fast = 0; } }
  else PERF.fast = 0;
  if (!next) return;
  setQuality(next);
  try { localStorage.setItem('straitfire3d-gfx-auto', next); } catch (e) { /* storage blocked */ }
  flashMsg(`Graphics ${GFX[next].label}${PERF.downs ? ' for a smoother frame rate' : ''}`);
  PERF.grace = 3;
}
function syncGfxUi() {
  document.querySelectorAll('.gfxSel').forEach(sel => {
    sel.value = GFX_STATE.mode;
    sel.options[0].textContent = GFX_STATE.mode === 'auto' ? `Auto · ${gfxNow().label} now` : 'Auto';
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - (frame.last || now)) / 1000;
  const dt = Math.min(0.05, Math.max(0.001, raw));
  frame.last = now;
  perfWatch(raw);
  SCAR.budget = Math.max(0, SCAR.budget - dt * 3);
  if (state === 'loading') return;
  if (state === 'play') { updateWorld(dt, true); updateMission(dt); }
  else if (state === 'debrief') updateWorld(dt, false);
  else if (state === 'menu' || state === 'brief') { updateWorld(dt, false); updateAttract(dt); }
  // Sky, sea and weather follow the camera
  const cp = camera.getWorldPosition(_v2);
  sky.position.copy(cp); clouds.position.copy(cp); stars.position.copy(cp); milky.position.copy(cp);
  if (stars.visible) { stars.material.uniforms.time.value = TIME; stars.material.uniforms.pr.value = pixelRatio; }
  water.position.x = cp.x; water.position.z = cp.z;
  WATER.swT.value = TIME;
  if (moon.visible) { moon.position.copy(lightDir).multiplyScalar(28000).add(cp); moon.lookAt(cp); }
  WATER.time.value += dt * (0.55 + SEA.amp * 0.12);
  cloudMat.uniforms.time.value += dt;
  sun.position.copy(cp).addScaledVector(lightDir, 800); sun.target.position.copy(cp);
  updateRain(dt);
  // Audio ambience
  if (AU.ctx) {
    setLoop('sea', 0.12 + SEA.amp * 0.04); setLoop('wind', 0.02 + SEA.amp * 0.012 + SEA.rain * 0.05); setLoop('rain', SEA.rain * 0.12);
    const ps = PL.ship;
    if (ps && state === 'play') { AU.loops.engine.g.gain.setTargetAtTime(0.05 + Math.abs(ps.speed / ps.maxSpeed) * 0.12, AU.ctx.currentTime, 0.4); AU.loops.engine.o.frequency.setTargetAtTime(38 + Math.abs(ps.speed) * 2.2, AU.ctx.currentTime, 0.5); setLoop('ciws', ps.ciwsFiring ? 0.35 : 0, 0.05); }
    else { AU.loops.engine.g.gain.setTargetAtTime(0, AU.ctx.currentTime, 0.4); setLoop('ciws', 0); }
  }
  PL.dmg = Math.max(0, PL.dmg - dt * 0.6);
  GRADE.damage.value = PL.dmg * 0.6 + (PL.ship && state === 'play' && PL.ship.hp / PL.ship.maxHp < 0.25 ? 0.15 + 0.1 * Math.sin(TIME * 5) : 0);
  GRADE.flash.value *= Math.pow(0.001, dt);
  GRADE.time.value = TIME;
  PL.lensWet = Math.max(0, (PL.lensWet || 0) - dt * 0.22);
  PL.hitT = Math.max(0, (PL.hitT || 0) - dt);
  GRADE.wet.value = Math.max(SEA.rain, PL.lensWet);
  flushTracers();
  FLAG_T.value = TIME;
  updateSunGlare();
  composer.render(dt);
  if (state === 'play') { renderMissileCam(dt); updateHud(dt); }
  else { $('mcam').hidden = true; octx.clearRect(0, 0, ov.width, ov.height); }
}


/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */
let sens = 1;
try { sens = parseFloat(localStorage.getItem('straitfire3d-sens')) || 1; } catch (e) { /* storage blocked */ }
PL.touch = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;

window.addEventListener('keydown', e => {
  PL.keys[e.code] = true;
  if (state === 'play') {
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') telegraph(1);
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') telegraph(-1);
    else if (e.code === 'KeyE') fireMissileKey();
    else if (e.code === 'KeyQ') fireSpecialKey();
    else if (e.code === 'KeyC') chaffKey();
    else if (e.code === 'KeyF') starShellKey();
    else if (e.code === 'KeyR') radarRange = radarRange === 12000 ? 24000 : radarRange === 24000 ? 6000 : 12000;
    else if (e.code === 'KeyL') heloKey(e.shiftKey);
    else if (e.code === 'KeyN') lightKey();
    else if (e.code === 'KeyZ') PL.zoomOn = !PL.zoomOn;
    else if (e.code === 'KeyG') adModeKey();
    else if (e.code === 'KeyJ') ecmKey();
    else if (e.code === 'KeyB') salvoKey();
    else if (e.code === 'KeyT') cycleTarget(e.shiftKey ? -1 : 1);
    else if (e.code === 'KeyV') trackKey();
    else if (e.code === 'KeyH') damageControlKey();
    else if (e.code === 'KeyK') { PL.mcamOn = !PL.mcamOn; flashMsg(PL.mcamOn ? 'Missile camera on' : 'Missile camera off'); }
    else if (e.code === 'BracketRight' || e.code === 'Equal') PL.zoomLevel = Math.min(ZOOMS.length - 1, PL.zoomLevel + 1);
    else if (e.code === 'BracketLeft' || e.code === 'Minus') PL.zoomLevel = Math.max(0, PL.zoomLevel - 1);
    else if (e.code === 'Space') PL.fire = true;
    else if (e.code === 'KeyM') toggleSound();
    else if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); pause(true); }
  } else if (state === 'paused' && e.code === 'KeyP') pause(false);
});
window.addEventListener('keyup', e => { PL.keys[e.code] = false; if (e.code === 'Space') PL.fire = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
$('overlay').addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousedown', e => {
  if (state !== 'play' || e.target.closest('button, input, label, select, .screen')) return;
  // Middle click or the mouse's back/forward buttons: pause and free the mouse without the keyboard
  if (e.button === 1 || e.button === 3 || e.button === 4) { e.preventDefault(); pause(true); return; }
  if (!PL.pointer && !PL.touch && e.button === 0 && PL.wantLock && !PL.lockTried) { PL.lockTried = true; lockPointer(); }
  if (e.button === 0) PL.fire = true;
  if (e.button === 2) PL.zoomOn = true;
});
window.addEventListener('wheel', e => {
  if (state !== 'play') return;
  PL.zoomLevel = clamp(PL.zoomLevel + (e.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1);
}, { passive: true });
window.addEventListener('mouseup', e => { if (e.button === 0) PL.fire = false; if (e.button === 2) PL.zoomOn = false; });
window.addEventListener('mousemove', e => {
  if (state !== 'play') return;
  if (PL.pointer) {
    const k = 0.0022 * sens * (camera.fov / 68);
    if (PL.track && Math.hypot(e.movementX, e.movementY) > 30) { PL.track = false; flashMsg('Free look'); }
    if (!PL.track) { PL.yaw += e.movementX * k; PL.pitch -= e.movementY * k * (PL.invertY ? -1 : 1); }
  } else { PL.cursor.x = e.clientX / window.innerWidth; PL.cursor.y = e.clientY / window.innerHeight; }
});
document.addEventListener('pointerlockchange', () => {
  const was = PL.pointer;
  PL.pointer = document.pointerLockElement === canvas;
  if (!was && PL.pointer) showLockHint();
  if (was && !PL.pointer && state === 'play') pause(true);
});
// Each time the mouse is captured, say how to get it back
let lockHintT = 0;
function showLockHint() {
  const el = $('lockHint'); el.hidden = false; el.classList.remove('fade');
  clearTimeout(lockHintT);
  lockHintT = setTimeout(() => { el.classList.add('fade'); lockHintT = setTimeout(() => { el.hidden = true; }, 900); }, 5000);
}
window.addEventListener('blur', () => { PL.fire = false; PL.keys = {}; if (state === 'play') pause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(true); });

function lockPointer() {
  if (PL.touch) return;
  if (!CFG.capture) {
    // Free cursor: the mouse aims, and the view turns when it nears the screen edge
    PL.wantLock = false;
    if (state === 'play' && !PL.cursorTold) { PL.cursorTold = true; PL.cursor.x = 0.5; PL.cursor.y = 0.5; flashMsg('Mouse aims the crosshair. Push it to the screen edge to turn your view.'); }
    return;
  }
  PL.wantLock = true;
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* pointer lock unavailable */ }
  setTimeout(() => {
    if (!PL.pointer && state === 'play') {
      PL.cursor.x = 0.5; PL.cursor.y = 0.5;
      flashMsg('Mouse aims the crosshair. Push it to the screen edge to turn your view.');
    }
  }, 700);
}
function unlockPointer() {
  clearTimeout(lockHintT); $('lockHint').hidden = true;
  if (document.pointerLockElement) document.exitPointerLock();
}

// Touch: a stick for helm and engines, drag the right side to look, buttons for weapons
(function touchSetup() {
  const stick = $('tStick'), knob = $('tKnob');
  let sid = null, lid = null, lx = 0, ly = 0;
  const move = e => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), max = r.width / 2;
    if (m > max) { dx *= max / m; dy *= max / m; }
    PL.stick.x = dx / max; PL.stick.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); move(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) move(e); });
  const end = e => { if (e.pointerId === sid) { sid = null; PL.stick.x = PL.stick.y = 0; knob.style.transform = ''; } };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  const pad = $('tLook');
  pad.addEventListener('pointerdown', e => { lid = e.pointerId; lx = e.clientX; ly = e.clientY; pad.setPointerCapture(lid); });
  pad.addEventListener('pointermove', e => {
    if (e.pointerId !== lid) return;
    const k = 0.005 * sens * (camera.fov / 68);
    PL.yaw += (e.clientX - lx) * k; PL.pitch -= (e.clientY - ly) * k * (PL.invertY ? -1 : 1); lx = e.clientX; ly = e.clientY; PL.track = false;
  });
  const lend = e => { if (e.pointerId === lid) lid = null; };
  pad.addEventListener('pointerup', lend); pad.addEventListener('pointercancel', lend);
  const fire = $('tFire');
  fire.addEventListener('pointerdown', e => { PL.fire = true; fire.setPointerCapture(e.pointerId); fire.classList.add('on'); });
  ['pointerup', 'pointercancel'].forEach(ev => fire.addEventListener(ev, () => { PL.fire = false; fire.classList.remove('on'); }));
  $('tMsl').addEventListener('pointerdown', fireMissileKey);
  $('tSpec').addEventListener('pointerdown', fireSpecialKey);
  $('tChaff').addEventListener('pointerdown', chaffKey);
  $('tZoom').addEventListener('pointerdown', () => { PL.zoomOn = !PL.zoomOn; $('tZoom').classList.toggle('on', PL.zoomOn); });
  $('tTgt').addEventListener('pointerdown', () => cycleTarget(1));
  $('tPause').addEventListener('pointerdown', () => pause(true));
  $('tLight').addEventListener('pointerdown', () => { lightKey(); $('tLight').classList.toggle('on', !!PL.lightOn); });
})();

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */
function pause(on) {
  if (on && state === 'play') {
    state = 'paused'; PL.fire = false; PL.zoomOn = false; PL.keys = {};
    unlockPointer();
    show('pause', true);
  } else if (!on && state === 'paused') {
    state = 'play'; show('pause', false);
    PL.lockTried = false;
    lockPointer();
  }
}
function toggleSound() {
  AU.muted = !AU.muted;
  if (AU.master) AU.master.gain.value = AU.muted ? 0 : 0.55;
  $('pSound').textContent = AU.muted ? 'Sound off' : 'Sound on';
}
function renderMissionList() {
  const prog = loadProgress();
  $('missionList').innerHTML = MISSIONS.map((m, i) => {
    const st = prog[CFG.side + ':' + m.id] || 0;
    return `<button class="mcard" type="button" data-i="${i}">
      <span class="mnum">${m.endless ? '∞' : String(i + 1).padStart(2, '0')}</span>
      <span class="mbody"><strong>${m.title[CFG.side]}</strong><span>${m.place[CFG.side]}${m.endless && prog[CFG.side + ':' + m.id + ':score'] ? ` · best ${prog[CFG.side + ':' + m.id + ':score']} points` : ''}</span><em>${m.endless ? m.weather : `${m.time} · ${m.weather}`}</em></span>
      <span class="mstars" aria-label="${st} of 3 stars">${[0, 1, 2].map(k => `<i class="${k < st ? 'on' : ''}"></i>`).join('')}</span>
    </button>`;
  }).join('');
}
function openBrief(i) {
  const m = MISSIONS[i];
  state = 'brief';
  MS.idx = i;
  $('bNum').textContent = m.endless ? 'Endless mode' : `Mission ${String(i + 1).padStart(2, '0')} of ${MISSIONS.length - 1}`;
  $('bTitle').textContent = m.title[CFG.side];
  $('bMeta').textContent = m.endless ? `${m.place[CFG.side]} · ${m.weather}` : `${m.place[CFG.side]} · ${m.time} local · ${m.weather}`;
  $('bText').textContent = m.brief[CFG.side];
  const ps = PLAYER_SHIP[CFG.side];
  const lo = m.loadout;
  $('bShip').textContent = `${ps.name} (${ps.no}), ${CLASS[ps.cls].label}`;
  $('bLoad').textContent = `${FIXED_ASM[CFG.side] ?? lo.asm} ${ASM[PLAYER_ASM[CFG.side]].name} · ${lo.sam} ${SAM_NAME[CFG.side]}${CFG.side === 'PLA' ? ' · 16 HQ-10' : ''}${lo.asroc ? ` · ${lo.asroc} ASROC` : ''} · ${lo.special} ${SPECIAL_NAME[CFG.side]}${lo.special > 1 ? 's' : ''} · ${lo.chaff} decoy loads · jammer · ${lo.helo ?? 2} helicopter sorties${lo.flares ? ` · ${lo.flares} star shells` : ''}`;
  show('title', false); show('debrief', false); show('pause', false); show('brief', true);
  $('bBegin').focus();
}
function toMenu() {
  unlockPointer();
  state = 'menu';
  show('hud', false); show('touch', false); show('pause', false); show('debrief', false); show('brief', false); show('title', true);
  renderMissionList();
  startAttract();
}
$('missionList').addEventListener('click', e => { const b = e.target.closest('.mcard'); if (b) { audioInit(); openBrief(+b.dataset.i); } });
$('bBegin').addEventListener('click', () => { audioInit(); startMission(MS.idx); });
$('bBack').addEventListener('click', toMenu);
$('pResume').addEventListener('click', () => pause(false));
$('pRestart').addEventListener('click', () => { show('pause', false); startMission(MS.idx); });
$('pMenu').addEventListener('click', toMenu);
$('pSound').addEventListener('click', toggleSound);
$('dbNext').addEventListener('click', () => openBrief(MS.idx + 1));
$('dbRetry').addEventListener('click', () => openBrief(MS.idx));
$('dbMenu').addEventListener('click', toMenu);
$('sens').value = sens;
$('invY').addEventListener('change', e => { PL.invertY = e.target.checked; });
// Mouse capture can be switched off for hosts where a captured pointer is awkward
try { CFG.capture = localStorage.getItem('straitfire3d-capture') !== '0'; } catch (e) { CFG.capture = true; }
document.querySelectorAll('.capChk').forEach(c => {
  c.checked = CFG.capture;
  c.addEventListener('change', () => {
    CFG.capture = c.checked;
    document.querySelectorAll('.capChk').forEach(o => (o.checked = CFG.capture));
    try { localStorage.setItem('straitfire3d-capture', CFG.capture ? '1' : '0'); } catch (err) { /* storage blocked */ }
    if (!CFG.capture) unlockPointer();
  });
});
$('sens').addEventListener('input', e => { sens = parseFloat(e.target.value); try { localStorage.setItem('straitfire3d-sens', String(sens)); } catch (err) { /* storage blocked */ } });
document.querySelectorAll('input[name="side"]').forEach(r => r.addEventListener('change', () => {
  CFG.side = r.value; document.body.dataset.side = r.value; renderMissionList(); startAttract();
}));
document.querySelectorAll('input[name="diff"]').forEach(r => r.addEventListener('change', () => { CFG.diff = r.value; }));
document.querySelectorAll('.gfxSel').forEach(sel => sel.addEventListener('change', () => setGfxMode(sel.value)));
syncGfxUi();

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
(async function boot() {
  try {
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);
    makeTextures();
    makeMaterials();
    makeFX();
    makeDebris();
    buildRanges();
    resize();
    CFG.side = document.querySelector('input[name="side"]:checked').value;
    CFG.diff = document.querySelector('input[name="diff"]:checked').value;
    document.body.dataset.side = CFG.side;
    renderMissionList();
    startAttract();
    state = 'menu';
    show('loading', false);
    show('title', true);
    requestAnimationFrame(frame);
  } catch (err) {
    $('loading').textContent = 'This game needs WebGL 2, which this browser could not start. ' + (err && err.message ? err.message : '');
    console.error(err);
  }
})();
// Test hook: run the simulation without rendering, with an optional autopilot captain.
function simulate(seconds, auto = true) {
  const dt = 0.05;
  for (let t = 0; t < seconds && state === 'play'; t += dt) {
    if (auto && PL.ship && !PL.ship.dead) {
      const s = PL.ship;
      const foes = W.ships.filter(o => o.side !== s.side && !o.dead && o.detected);
      const sub = foes.find(o => o.isSub);
      const near = (sub ? [sub] : foes).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
      const air = W.jets.find(j => j.side !== s.side) || W.missiles.find(m => m.side !== s.side && m.kind === 'asm');
      const tgt = air && (!near || air.p.distanceTo(s.pos) < 6000) ? air : near;
      if (tgt) {
        const tx = tgt.isAir || tgt.isMissile ? tgt.p.x : tgt.x, tz = tgt.isAir || tgt.isMissile ? tgt.p.z : tgt.z;
        PL.yaw = wrapPi(bearing(s.x, s.z, tx, tz) - s.h);
        const d = Math.hypot(tx - s.x, tz - s.z);
        PL.pitch = tgt.isAir || tgt.isMissile ? Math.atan2(tgt.p.y - 20, d) : -Math.atan2(18, d);
        PL.fire = true;
        if (Math.random() < dt / 15 || (tgt.isSub && Math.random() < dt / 6)) fireMissileKey();
        // Save the special for the biggest ship in range, the way the in-game tips suggest
        const big = foes.filter(o => !o.isSub && o.maxHp >= 700 && Math.hypot(o.x - s.x, o.z - s.z) < 26000).sort((a, b) => b.maxHp - a.maxHp)[0];
        if (big && PL.special > 0 && Math.random() < dt / 8) { const keep = PL.lock; PL.lock = big; fireSpecialKey(); PL.lock = keep; }
        else if (!big && W.ships.length && Math.random() < dt / 150) fireSpecialKey();
        PL.telegraph = d > 9000 ? 6 : 5;
        PL.keys.KeyA = false; PL.keys.KeyD = false;
      }
      if (W.missiles.some(m => m.target === s) && Math.random() < dt / 4) chaffKey();
      if (W.missiles.some(m => m.target === s && m.p.distanceTo(s.pos) < 9000) && PL.ecmCd <= 0) ecmKey();
      if (Object.values(PL.sys).some(v => v < 50) && PL.dcCd <= 0) damageControlKey();
      if (!W.helo && W.datums.some(d => !d.sub.dead) && PL.heloCd <= 0 && PL.heloSorties > 0) heloKey();
      const mp = MS.waypoints[0] || (!W.ships.some(o => o.isSub && o.detected && !o.dead) && W.datums.find(d => !d.sub.dead));
      if (mp) { const b = wrapPi(bearing(s.x, s.z, mp.x, mp.z) - s.h); PL.rudder = clamp(b, -1, 1) * (Math.hypot(mp.x - s.x, mp.z - s.z) > (MS.raft ? 60 : 2500) ? 1 : 0); }
      if (MS.raft && MS.raft.state === 'adrift') {
        const d = Math.hypot(MS.raft.x - s.x, MS.raft.z - s.z);
        PL.telegraph = d > 1800 ? 6 : d > 500 ? 3 : 2;
        if (!W.helo && PL.heloSorties > 0 && PL.heloCd <= 0 && d > 3000) { const keep = PL.lock; PL.lock = null; heloKey(); PL.lock = keep; }
      } else if (MS.raft && MS.raft.state === 'aboard') PL.telegraph = 6;
      // Under gunfire, weave to spoil their solution
      if ((PL.shellHits || []).some(t => MS.t - t < 30)) PL.rudder = Math.sin(MS.t / 7) > 0 ? 0.8 : -0.8;
    }
    updateWorld(dt, true); updateMission(dt);
    flushTracers();
  }
  return { t: MS.t, over: MS.over, won: MS.won, reason: MS.reason, hp: PL.ship ? Math.round(PL.ship.hp) : null, stats: { ...PL.stats }, objs: MS.objs.map(o => (o.done ? '+' : o.failed ? 'x' : '-') + o.text), ships: W.ships.length, jets: W.jets.length, missiles: W.missiles.length };
}
window.__strait = { simulate, startMission, openBrief, MS, PL, W, CFG, get state() { return state; }, set state(v) { state = v; }, applyEnv, camera, scene, setGfxMode, GFX_STATE, damageShip, SEA, bowSlam, SEARCH, renderer, GRADE };
