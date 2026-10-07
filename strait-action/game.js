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
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.4;
renderer.shadowMap.enabled = true;
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
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time, scope, damage, flash, grain, vignette, aberr, night, wet; uniform vec2 res;
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

const composerRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.5, 0.9);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);
const GRADE = gradePass.uniforms;

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

// Stars and moon for night missions
const stars = (() => {
  const n = 2600, pos = new Float32Array(n * 3);
  setSeed(42);
  for (let i = 0; i < n; i++) {
    const a = srand() * TAU, y = Math.pow(srand(), 0.7);
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * 30000; pos[i * 3 + 1] = y * 30000; pos[i * 3 + 2] = Math.sin(a) * r * 30000;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
  const p = new THREE.Points(g, m); p.renderOrder = -9; p.frustumCulled = false; scene.add(p);
  return p;
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
  textureWidth: 512, textureHeight: 512, waterNormals: makeWaterNormals(),
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
  const decl = 'uniform vec4 swA[5]; uniform float swW[5]; uniform float swT;\n';
  const fn = 'float swellH(vec2 p){ float h = 0.0; for (int i = 0; i < 5; i++) h += swA[i].w * sin(dot(swA[i].xy, p) * swA[i].z - swW[i] * swT + float(i) * 1.7); return h; }\n';
  water.material.vertexShader = water.material.vertexShader
    .replace('uniform mat4 textureMatrix;', decl + 'uniform mat4 textureMatrix;')
    .replace('void main() {', fn + 'void main() {\n vec4 wp0 = modelMatrix * vec4( position, 1.0 );\n vec3 pos = position;\n pos.z += swellH(wp0.xz) * (1.0 - smoothstep(900.0, 3200.0, distance(wp0.xz, cameraPosition.xz)));')
    .replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );', 'mirrorCoord = modelMatrix * vec4( pos, 1.0 );')
    .replace('vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );', 'vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );');
  water.material.fragmentShader = water.material.fragmentShader
    .replace('uniform mat4 textureMatrix;', 'uniform mat4 textureMatrix;')
    .replace('uniform sampler2D mirrorSampler;', decl + 'uniform sampler2D mirrorSampler;')
    .replace('vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
      'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );\n' +
      ' vec2 sg = vec2(0.0); for (int i = 0; i < 5; i++) { sg += swA[i].w * swA[i].z * swA[i].xy * cos(dot(swA[i].xy, worldPosition.xz) * swA[i].z - swW[i] * swT + float(i) * 1.7); }\n' +
      ' surfaceNormal = normalize(surfaceNormal + vec3(-sg.x, 0.0, -sg.y) * (1.0 - smoothstep(1500.0, 7000.0, length(worldPosition.xz - eye.xz))));');
}
water.material.needsUpdate = true;
scene.add(water);
const WATER = water.material.uniforms;

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 1500 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x1c2428, 0.5);
scene.add(hemi);

// A tiny scene used to bake the environment map and to sample the horizon colour.
const envScene = new THREE.Scene();
const skyEnv = new Sky(); skyEnv.material.uniforms = SKY; skyEnv.scale.setScalar(60); envScene.add(skyEnv);
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
  WATER.sunColor.value.copy(sunC).multiplyScalar(E.night ? 0.35 : (E.clouds > 0.9 ? 0.25 : 1));
  WATER.waterColor.value.set(E.water);
  WATER.distortionScale.value = E.dist * 0.28;
  swellAmp = 0.11 * Math.pow(E.sea, 1.4);
  WATER.size.value = 2.2 + E.sea * 0.15;

  sun.color.copy(sunC);
  sun.intensity = E.sunI;
  hemi.color.copy(E.night ? new THREE.Color(0x2a3550) : fogC.clone().multiplyScalar(1 / Math.max(0.05, fogC.getHSL({}).l * 1.6)));
  hemi.groundColor.set(E.night ? 0x05080c : 0x1a2226);
  hemi.intensity = E.night ? 0.35 : 1.0 * E.light;

  stars.material.opacity = E.stars ? 0.9 : 0;
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

const TEX = {};
function makeTextures() {
  setSeed(11);
  TEX.hull = { light: hullTex('#a7afb3'), mid: hullTex('#8c9499'), dark: hullTex('#747c81'), black: hullTex('#26292b', true), navy: hullTex('#9aa2a6') };
  TEX.sup = { light: supTex('#b4bcc0'), mid: supTex('#979fa4'), dark: supTex('#81898e'), black: supTex('#e8e6df'), navy: supTex('#a8b0b4') };
  TEX.deck = deckTex(); TEX.vls = vlsTex(); TEX.heli = heliTex();
  TEX.cv = { '73': carrierDeckTex('73'), '18': carrierDeckTex('18') };
  TEX.smoke = puffTex(); TEX.spray = sprayTex(); TEX.fire = fireTex(); TEX.flash = flashTex();
  TEX.dot = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']], 64);
  TEX.foam = foamTex(false); TEX.kelvin = foamTex(true); TEX.noise = noiseTex();
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
    PAINT[k] = { hull: stdMat({ map: TEX.hull[k], roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }), sup };
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
    g.clearGroups();
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  build(group, { cast = true, receive = true } = {}) {
    for (const [mat, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
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
    ciws: [{ x: 5, y: 5, z: -5.8, type: 'phalanx' }, { x: -33, y: 6, z: 5.4, type: 'phalanx' }], canisters: [{ x: -27, y: 5 }], boats: [{ x: -1, y: 5, z: 7.2 }, { x: -1, y: 5, z: -7.2 }] },
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
  for (const v of S.vls || []) addVLS(B, v.x, P.deckAt(v.x), v.l, v.w);
  for (const c of S.ciws || []) addCIWS(B, c.x, P.deckAt(c.x) + c.y, c.z, c.type, mats);
  for (const c of S.canisters || []) addCanisters(B, c.x, P.deckAt(c.x) + c.y, mats);
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
const FX_VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 iPos; attribute float iSize; attribute float iRot; attribute vec4 iCol;
  uniform float fogDensity;
  varying vec2 vUv; varying vec4 vCol; varying float vFog;
  void main(){
    vUv = uv; vCol = iCol;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iRot), s = sin(iRot);
    mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
    float d = -mv.z; vFog = 1.0 - exp(-fogDensity * fogDensity * d * d);
  }`;
const FX_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D map; uniform vec3 fogColor;
  varying vec2 vUv; varying vec4 vCol; varying float vFog;
  void main(){
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(map, vUv);
    float a = t.a * vCol.a;
    if (a < 0.004) discard;
    #ifdef ADDITIVE
      gl_FragColor = vec4(t.rgb * vCol.rgb * a * (1.0 - vFog), 1.0);
    #else
      gl_FragColor = vec4(mix(t.rgb * vCol.rgb, fogColor, vFog), a);
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
      uniforms: { map: { value: tex }, fogColor: FOG_U.color, fogDensity: FOG_U.density },
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
  const vol = clamp(1 / (1 + d / 700), 0, 1);
  if (vol < 0.02) return;
  const delay = Math.min(d / 343, 4);
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
    f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.setValueAtTime(400, now); f.frequency.exponentialRampToValueAtTime(1500, now + 2.4);
    g.gain.setValueAtTime(0.001, now); g.gain.exponentialRampToValueAtTime(1.3 * vol, now + 0.15); dur = 3.0;
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
  mogami:    { model: 'war', label: 'Mogami-class frigate', hp: 540, speed: 15.0, turn: 0.075, gun: { every: 3.0, dmg: 36, range: 13000 }, asm: 6, sam: false, ciws: 0.8, pref: 6000 },
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
const PLAYER_SHIP = { ALLIED: { cls: 'kidd', name: 'ROCS Kee Lung', no: '1801', jets: 'f16' }, PLA: { cls: 't055', name: 'Nanchang', no: '101', jets: 'j20' } };
const JET_KIND = { ALLIED: ['f16', 'f35', 'f18'], PLA: ['flanker', 'j20', 'flanker'] };
const JET_NAME = { f16: 'F-16V', f35: 'F-35B', f18: 'F/A-18F', flanker: 'J-15', j20: 'J-20' };
const DIFF = {
  recruit: { fire: 1.5, disp0: 400, dispMin: 50, asmEvery: 80, dmg: 0.55, ciwsVs: 0.4, samPk: 0.2, torpEvery: 80, jetMul: 1.4 },
  veteran: { fire: 1.0, disp0: 290, dispMin: 24, asmEvery: 52, dmg: 1.0, ciwsVs: 0.6, samPk: 0.34, torpEvery: 52, jetMul: 1.0 },
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
function modelFor(cls, no, player = false) {
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
  m.ciwsPts = S ? (S.ciws || []).map(c => new V3(c.x, m.P.deckAt(c.x) + c.y + 1.8, c.z)) : [new V3(0, m.top * 0.6, 0)];
  return m;
}

/* ------------------------------------------------------------------ */
/* World state                                                         */
/* ------------------------------------------------------------------ */
const W = { ships: [], jets: [], missiles: [], shells: [], rounds: [], torps: [], flares: [], chaff: [], islands: [], islandObjs: [], datums: [], pending: [] };
let TIME = 0;
let CFG = { side: 'ALLIED', diff: 'veteran' };
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
    const m = modelFor(cls, this.no, this.player);
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
    const half = Math.max(this.hitHalf || this.P.dk((f + this.L / 2) / this.L), 1.5);
    if (Math.abs(s) > half + pad) return false;
    const y = p.y - this.obj.position.y;
    return y > -this.P.D - 3 && y < this.top + pad;
  }
  get pos() { return new V3(this.x, this.obj.position.y + this.top * 0.3, this.z); }
}

function spawnShip(cls, side, o) { const s = new Ship(cls, side, o); W.ships.push(s); return s; }
function removeShip(s) {
  scene.remove(s.obj);
  s.obj.traverse(o => { if (o.userData.decal) { o.material.map.dispose(); o.material.dispose(); o.geometry.dispose(); } });
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
  if (s.player) onPlayerHit(amt, p, kind);
  if (src && src.player && kind !== 'ground') PL.stats.hits++;
  if (p && amt >= 20 && s.fires.length < 5 && !s.isSub && Math.random() < 0.55) {
    const lp = s.obj.worldToLocal(p.clone());
    lp.x = clamp(lp.x, -s.L * 0.45, s.L * 0.45); lp.y = Math.max(lp.y, s.P.F * 0.9); lp.z = clamp(lp.z, -s.B * 0.4, s.B * 0.4);
    s.fires.push(lp);
  }
  if (s.hp <= 0) killShip(s, src);
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
  };
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
  if (by && by.player && m.side !== PL.side) { PL.stats.intercepts++; }
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
      m.speed = Math.min(m.max, m.speed + (m.kind === 'sam' ? 700 : m.kind === 'asroc' ? 200 : 140) * dt);
      const tg = m.target && !m.target.dead && !m.target.sunk ? m.target : null;
      let aim = null;
      if (m.decoy) aim = m.decoy;
      else if (tg) {
        const tt = m.p.distanceTo(tg.isAir || tg.isMissile ? tg.p : _v.set(tg.x, 0, tg.z)) / m.speed;
        aim = tg.isAir || tg.isMissile ? _v.set(tg.p.x + tg.vx * tt, tg.p.y + (tg.vy || 0) * tt, tg.p.z + tg.vz * tt) : _v.set(tg.x + tg.vx * tt, tg.top * 0.35 + tg.obj.position.y, tg.z + tg.vz * tt);
      } else if (m.aim) aim = m.aim;
      if (m.t > m.boost && aim) {
        const dxz = Math.hypot(aim.x - m.p.x, aim.z - m.p.z);
        let ty = aim.y, rate = 3.5;
        if (m.kind === 'asm') { ty = dxz > 1300 ? m.alt : aim.y; rate = dxz > 1300 ? 0.75 : 2.2; }
        else if (m.kind === 'asroc') { ty = dxz > 900 ? 260 : -10; rate = 1.2; }
        _d.set(aim.x - m.p.x, 0, aim.z - m.p.z).normalize();
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
          if (Math.random() < m.pk) { if (tg.isAir) killJet(tg, m.owner); else killMissile(tg, m.owner); }
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
      if (!m.dead && m.t > m.life) { airburst(m.p); m.dead = true; }
    }
    if (!m.dead) { m.obj.position.copy(m.p); m.obj.quaternion.setFromUnitVectors(_up, m.d); }
  }
  for (const m of W.missiles) if (m.dead) dropMissile(m);
  W.missiles = W.missiles.filter(m => !m.dead);
}

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
          launchMissile('asm', j, j.p.clone().add(new V3(0, -2, 0)), dir, tg, { dmg: dm, boost: 0.4, speed0: 220 });
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

/* Close-in weapon systems engage incoming missiles automatically. */
function updateCIWS(s, dt) {
  if (s.dead || !s.C.ciws) return;
  const q = s.C.ciws * (s.player || s.side === PL.side ? 1 : DIFF[CFG.diff].ciwsVs / 0.6);
  s.ciwsT -= dt;
  if (s.ciwsT <= 0) {
    s.ciwsT = 0.35;
    let best = null, bd = 2100;
    for (const m of W.missiles) {
      if (m.side === s.side || m.dead || m.kind === 'sam') continue;
      const d = Math.hypot(m.p.x - s.x, m.p.z - s.z);
      if (d < bd && (m.target === s || d < 900)) { bd = d; best = m; }
    }
    if (!best) for (const j of W.jets) { if (j.side === s.side) continue; const d = j.p.distanceTo(s.pos); if (d < 1500 && d < bd) { bd = d; best = j; } }
    s.ciwsTarget = best;
  }
  const t = s.ciwsTarget;
  s.ciwsFiring = false;
  if (!t || t.dead) return;
  const d = t.p.distanceTo(s.pos);
  if (d > 2100) return;
  s.ciwsFiring = true;
  const mount = s.model.ciwsPts[0];
  _v.copy(mount); s.obj.localToWorld(_v);
  const n = Math.random() < 0.6 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const tt = d / 1100;
    const aim = new V3(t.p.x + t.vx * tt + rand(-8, 8), t.p.y + (t.vy || 0) * tt + rand(-6, 6), t.p.z + t.vz * tt + rand(-8, 8));
    const v = aim.sub(_v).normalize().multiplyScalar(1100);
    W.rounds.push({ p: _v.clone(), v, t: Math.min(d / 1100 + 0.15, 2.2) });
  }
  const pk = q * (d < 1000 ? 0.45 : 0.15) * (t.isAir ? 0.45 : 1);
  if (Math.random() < pk * dt) { if (t.isAir) killJet(t, s); else killMissile(t, s); s.ciwsTarget = null; }
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
  msl: 8, special: 1, chaff: 4, flares: 0, chaffCd: 0, gunCd: 0, shake: 0, dmg: 0, lastHit: -99, salvo: [],
  stats: { shells: 0, hits: 0, msl: 0, kills: 0, air: 0, intercepts: 0 }, aimPoint: new V3(), masked: false, aimRay: new THREE.Ray(),
  pointer: false, cursor: { x: 0.5, y: 0.5 }, look: { x: 0, y: 0 }, keys: {}, touch: false, stick: { x: 0, y: 0 }, msg: '',
};
const ray = new THREE.Raycaster();
function pivotOf(obj) { return obj.children.find(c => c.isGroup); }

function setupPlayer(side, x, z, h) {
  const ps = PLAYER_SHIP[side];
  const s = spawnShip(ps.cls, side, { player: true, name: ps.name, no: ps.no, x, z, h, speed: CLASS[ps.cls].speed * 0.8, hpMul: 1000 / CLASS[ps.cls].hp, priority: 1.25 });
  s.order = s.speed;
  PL.ship = s; PL.side = side; PL.yaw = 0; PL.pitch = -0.07; PL.telegraph = 5; PL.rudder = 0; PL.lock = null; PL.dmg = 0; PL.shake = 0;
  PL.stats = { shells: 0, hits: 0, msl: 0, kills: 0, air: 0, intercepts: 0 };
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
    s.rudder = PL.rudder;
    s.order = s.maxSpeed * ORDERS[PL.telegraph].v;
  }
  // Looking around: pointer lock, or a cursor that pans the view at the screen edges
  if (!PL.pointer && !PL.touch) {
    const ex = PL.cursor.x < 0.08 ? -(0.08 - PL.cursor.x) / 0.08 : PL.cursor.x > 0.92 ? (PL.cursor.x - 0.92) / 0.08 : 0;
    const ey = PL.cursor.y < 0.08 ? -(0.08 - PL.cursor.y) / 0.08 : PL.cursor.y > 0.92 ? (PL.cursor.y - 0.92) / 0.08 : 0;
    const k = 1.6 * camera.fov / 68;
    PL.yaw += ex * k * dt; PL.pitch -= ey * k * 0.6 * dt;
  }
  PL.pitch = clamp(PL.pitch, -0.6, 1.1);
  PL.yaw = wrapPi(PL.yaw);
  PL.zoom = lerp(PL.zoom, PL.zoomOn ? 1 : 0, clamp(dt * 8, 0, 1));
  camera.fov = lerp(68, 9.5, PL.zoom);
  camera.updateProjectionMatrix();
  GRADE.scope.value = PL.zoom > 0.02 ? Math.min(1, PL.zoom * 1.4) : 0;
}

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
    _v.copy(p).sub(o); const dist = _v.length(); if (dist > 26000 || dist < 30) return;
    const a = _v.normalize().angleTo(d);
    const lim = t === PL.lock ? Math.max(keep, ba) : ba;
    if (a < lim) { if (!best || a < ba || t === PL.lock) { best = t; ba = Math.min(a, ba); } }
  };
  for (const t of W.ships) if (!t.dead && hostile(t, s) && t.detected) consider(t, _v2.set(t.x, t.obj.position.y + t.top * 0.35, t.z));
  for (const j of W.jets) if (hostile(j, s)) consider(j, j.p);
  for (const m of W.missiles) if (hostile(m, s) && m.kind !== 'sam') consider(m, m.p);
  if (best !== PL.lock) { PL.lock = best; if (best) sfx('blip', 1, 0, 1320); }
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
    if (i === gi && PL.fire && PL.gunCd <= 0 && err < 0.05) {
      const m = turretMuzzle(s, i);
      const v = velFrom(sol.el + rand(-0.0011, 0.0011), sol.az + rand(-0.0014, 0.0014), SHELL_V);
      fireShell(s, m, v, 55, { aa });
      PL.gunCd = 1.05;
    }
  }
  // Queued salvo launches (Harpoon salvo)
  for (const q of PL.salvo) { q.t -= dt; if (q.t <= 0 && !q.done) { q.done = true; playerLaunch('asm', q.target, true); } }
  PL.salvo = PL.salvo.filter(q => !q.done);
}

function playerLaunch(kind, target, salvo = false) {
  const s = PL.ship;
  const coal = PL.side === 'ALLIED';
  const S = SPECS[s.cls];
  let from, dir;
  if (salvo && S.canisters) {
    from = _v.set(S.canisters[0].x, s.P.deckAt(S.canisters[0].x) + 6, rand(-2, 2)); s.obj.localToWorld(from); from = from.clone();
    const b = bearing(s.x, s.z, target.x, target.z);
    dir = new V3(fx(b), 0.35, fz(b));
  } else if (coal && S.arms) {
    from = _v.set(S.arms[0].x + 2, s.P.deckAt(S.arms[0].x) + 3.5, 0); s.obj.localToWorld(from); from = from.clone();
    const b = target.isAir || target.isMissile ? bearing(s.x, s.z, target.p.x, target.p.z) : bearing(s.x, s.z, target.x, target.z);
    dir = new V3(fx(b), 0.6, fz(b));
  } else {
    const v = S.vls ? S.vls[0] : { x: 30 };
    from = _v.set(v.x + rand(-3, 3), s.P.deckAt(v.x) + 1.5, rand(-3, 3)); s.obj.localToWorld(from); from = from.clone();
    dir = new V3(0, 1, 0);
  }
  if (kind === 'asm') launchMissile('asm', s, from, dir, target, { dmg: 280, boost: 1.6 });
  else if (kind === 'sam') launchMissile('sam', s, from, dir, target, { pk: 0.85, boost: 0.45 });
  else if (kind === 'asroc') launchMissile('asroc', s, from, dir, target, { boost: 1.0 });
}
function fireMissileKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  const t = PL.lock;
  if (!t) { flashMsg('Lock a target first: put the crosshair on it'); return; }
  if (PL.msl <= 0) { flashMsg('Missile cells empty'); return; }
  PL.msl--;
  if (t.isAir || t.isMissile) { playerLaunch('sam', t); radio('Weapons', `Bird away, ${t.isAir ? t.name : 'missile'} engaged.`, 'quiet'); }
  else if (t.isSub) { playerLaunch('asroc', t); radio('Weapons', `ASROC away on ${t.name}.`, 'quiet'); }
  else { playerLaunch('asm', t); radio('Weapons', `${PL.side === 'ALLIED' ? 'Hsiung Feng' : 'YJ-18'} away. Target ${t.name}.`, 'quiet'); }
}
function fireSpecialKey() {
  const s = PL.ship; if (!s || s.dead || state !== 'play') return;
  if (PL.special <= 0) { flashMsg('Special weapon expended'); return; }
  if (PL.side === 'ALLIED') {
    const tgts = W.ships.filter(t => hostile(t, s) && !t.dead && !t.isSub && t.detected && Math.hypot(t.x - s.x, t.z - s.z) < 32000).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    if (!tgts.length) { flashMsg('No surface targets in range'); return; }
    PL.special--;
    for (let i = 0; i < 4; i++) PL.salvo.push({ t: i * 0.45, target: PL.lock && !PL.lock.isAir && !PL.lock.isMissile && !PL.lock.isSub && i < 2 ? PL.lock : tgts[i % tgts.length] });
    radio('Weapons', 'Harpoon salvo, four birds away.', '');
  } else {
    const t = PL.lock && !PL.lock.isAir && !PL.lock.isMissile && !PL.lock.isSub ? PL.lock : null;
    const at = t ? new V3(t.x + t.vx * 6, 0, t.z + t.vz * 6) : PL.aimPoint.clone();
    if (Math.hypot(at.x - s.x, at.z - s.z) < 1500) { flashMsg('Too close to our own ship'); return; }
    PL.special--;
    const m = launchMissile('bm', s, new V3(at.x, 10200, at.z), new V3(0, -1, 0), null, {});
    m.obj.visible = true;
    radio('Rocket Force', `DF-21D launched. Impact at grid ${Math.round(at.x / 100)}/${Math.round(-at.z / 100)} in six seconds.`, '');
  }
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

function onPlayerHit(amt, p, kind) {
  PL.shake = Math.min(3, PL.shake + amt * 0.02 + 0.4);
  PL.dmg = Math.min(1, PL.dmg + amt / 300);
  PL.lastHit = MS.t;
  sfx('hit', 1);
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
  for (const j of W.jets) { const [x, y] = P(j.p.x, j.p.z); rctx.fillStyle = j.side === PL.side ? COL.friend : COL.hostile; rctx.beginPath(); rctx.moveTo(x, y - 4); rctx.lineTo(x + 4, y + 3); rctx.lineTo(x - 4, y + 3); rctx.fill(); }
  for (const m of W.missiles) { if (m.kind === 'sam' || m.kind === 'bm') continue; const [x, y] = P(m.p.x, m.p.z); rctx.fillStyle = m.side === PL.side ? '#cfe8ff' : COL.missile; rctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
  for (const tp of W.torps) { const [x, y] = P(tp.p.x, tp.p.z); rctx.fillStyle = tp.side === PL.side ? '#cfe8ff' : COL.missile; rctx.beginPath(); rctx.arc(x, y, 2, 0, TAU); rctx.fill(); }
  rctx.restore();
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
  const sp = PL.side === 'ALLIED' ? 'Harpoon salvo' : 'DF-21D strike';
  const gun = PL.masked ? '<i class="bad">Masked</i>' : PL.gunCd > 0 ? 'Loading' : '<i class="ok">Ready</i>';
  const ciws = s.ciwsFiring ? '<i class="bad">Engaging</i>' : 'Auto';
  const wp = `
    <div><span>Main gun</span><b>${gun}</b></div>
    <div><span>Missiles <kbd>E</kbd></span><b>${PL.msl}</b></div>
    <div><span>${sp} <kbd>Q</kbd></span><b>${PL.special}</b></div>
    <div><span>Chaff, decoys <kbd>C</kbd></span><b>${PL.chaff}${PL.chaffCd > 0 ? ' · ' + Math.ceil(PL.chaffCd) + 's' : ''}</b></div>
    ${PL.flares || SEA.night ? `<div><span>Star shells <kbd>F</kbd></span><b>${PL.flares}</b></div>` : ''}
    <div><span>CIWS</span><b>${ciws}</b></div>`;
  if (wp !== lastHud) { $('weapons').innerHTML = wp; lastHud = wp; }
  // Objectives
  $('objList').innerHTML = MS.objs.filter(o => !o.hidden).map(o => `<li class="${o.done ? 'done' : o.failed ? 'failed' : ''}${o.secondary ? ' sec' : ''}"><span></span>${o.text}${o.progress ? ` <em>${o.progress()}</em>` : ''}</li>`).join('');
  const tm = MS.t, rem = MS.limit ? Math.max(0, MS.limit - tm) : null;
  $('clock').innerHTML = `<b>${rem !== null ? fmtTime(rem) : fmtTime(tm)}</b><span>${rem !== null ? 'Hold until relieved' : MS.def.time + ' local'}</span>`;
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
        rec.h = t.h; rec.sp = t.speed;
        const ang = rand(TAU), rr = Math.sqrt(Math.random()) * rec.r;
        const aim = sol.p.clone().add(new V3(Math.cos(ang) * rr, 0, Math.sin(ang) * rr));
        const s2 = solveBallistic(muz, aim, SHELL_V);
        const dmg = C.gun.dmg * (enemy ? D.dmg : 0.9);
        fireShell(s, muz, velFrom(s2.el, s2.az, SHELL_V), dmg, { small: C.small });
        rec.r = Math.max(enemy ? D.dispMin : 40, rec.r * 0.72);
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
        W.pending.push({ t: i * 1.2, fn: () => { if (!s.dead) launchMissile('asm', s, from, dir, t, { dmg: 240 * (enemy ? D.dmg : 0.9), boost: C.small ? 0.8 : 1.5 }); } });
      }
      if (t.player) radio('CIC', `Missile launch detected from ${s.name}, bearing ${fmtBrg(bearing(t.x, t.z, s.x, s.z))}.`, 'bad');
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
  for (const j of W.jets) { if (j.side === s.side || j.samOn) continue; const d = j.p.distanceTo(s.pos); if (d < bd) { bd = d; tgt = j; } }
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
  const pk = tgt.isAir ? 0.6 : enemy ? DIFF[CFG.diff].samPk : 0.45;
  const from = new V3(s.x + fx(s.h) * s.L * 0.28, s.P.F + 1.5, s.z + fz(s.h) * s.L * 0.28);
  const m = launchMissile('sam', s, from, new V3(0, 1, 0), tgt, { pk, boost: 0.45 });
  m.onDone = () => { tgt.samOn = false; };
}
function aiSub(s, dt) {
  if (s.dead) return;
  s.revealT = Math.max(0, s.revealT - dt);
  const p = PL.ship;
  const wasDetected = s.detected;
  s.detected = s.revealT > 0 || (p && !p.dead && Math.hypot(p.x - s.x, p.z - s.z) < 4800) || W.ships.some(o => !o.dead && o.side !== s.side && !o.isSub && o !== p && Math.hypot(o.x - s.x, o.z - s.z) < 3000);
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
    id: 'median', env: 'dawn', time: '06:12', weather: 'Dawn · light cloud · calm',
    title: { ALLIED: 'Median Line', PLA: 'Median Line' },
    place: { ALLIED: 'Central Taiwan Strait', PLA: 'Central Taiwan Strait' },
    brief: {
      ALLIED: 'Two PLA Navy frigates crossed the median line at first light and are closing on the Penghu approaches. Turn them back the hard way: sink both. ROCS Cheng Kung is in company. Use this action to learn the fire-control system.',
      PLA: 'Two ROC Navy frigates are shadowing our exercise area east of the median line. Sink both before they report our positions. The frigate Huangshan is in company. Use this action to learn the fire-control system.',
    },
    loadout: { msl: 8, special: 1, chaff: 4, flares: 0 },
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
    loadout: { msl: 10, special: 1, chaff: 4, flares: 0 },
    setup(A) {
      A.islands([
        { x: 0, z: -7900, r: 2300, h: 42, seed: 3, plateau: true, basalt: true, dry: true, town: 260, light: 1.3 },
        { x: -3300, z: -5600, r: 800, h: 30, seed: 8, plateau: true, basalt: true, dry: true },
        { x: 3100, z: -5200, r: 650, h: 26, seed: 12, plateau: true, basalt: true, dry: true, town: 30 },
        { x: 2600, z: -10400, r: 1100, h: 35, seed: 5, plateau: true, basalt: true, dry: true },
      ]);
      const port = { x: 0, z: -3700, label: A.P === 'ALLIED' ? 'Makung' : 'Pingtan', r: 700 };
      MS.waypoints = [port];
      A.player(-1000, 300, 0);
      const path = [{ x: 0, z: -1800 }, port];
      for (const [x, z] of [[-350, 700], [380, 1300], [0, 1950]]) A.convoy('cargo', { x, z, h: 0, path, cruise: 12.5 });
      A.ally('frigate', { x: 1200, z: -400, h: 0 });
      A.at(25, () => { for (let i = 0; i < 3; i++) A.enemy('fac', { x: A.ex(8000 + i * 300), z: -3200 + i * 500, h: A.away, tag: 'fac' }); radio('CIC', `Fast movers bearing ${fmtBrg(A.toward)}, 8 km. Missile boats, three of them.`, 'bad'); });
      A.at(80, () => { A.enemy('destroyer', { x: A.ex(13000), z: -1200, h: A.away }); A.enemy('frigate', { x: A.ex(12500), z: -2600, h: A.away }); radio('CIC', 'New surface group at 13 km: a destroyer and a frigate.', 'bad'); });
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
    loadout: { msl: 10, special: 1, chaff: 5, flares: 0 },
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
      ALLIED: 'ROCS Panshih, the fleet\'s only fast combat support ship, is transiting under your protection. PLA naval aviation is sending strike after strike. Keep her afloat until the air cover arrives. Lock aircraft and incoming missiles and press E for surface-to-air missiles; the gun bursts its shells near aircraft and missiles.',
      PLA: 'Chaganhu, a Type 901 fast combat support ship, is transiting under your protection. Allied strike aircraft are coming in waves. Keep her afloat until our fighters arrive. Lock aircraft and incoming missiles and press E for surface-to-air missiles; the gun bursts its shells near aircraft and missiles.',
    },
    loadout: { msl: 16, special: 1, chaff: 5, flares: 0 },
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
    id: 'night', env: 'night', time: '23:40', weather: 'Night · moonlit · calm',
    title: { ALLIED: 'Kinmen Night', PLA: 'Xiamen Approaches' },
    place: { ALLIED: 'Kinmen', PLA: 'Kinmen' },
    brief: {
      ALLIED: 'Under cover of darkness, a swarm of Type 022 missile boats is gathering in the lee of the island to strike the Kinmen garrison\'s supply line. Find them and sink them all. Fire star shells with F to light them up; their wakes and gun flashes give them away.',
      PLA: 'Under cover of darkness, ROC Kuang Hua VI missile boats are gathering in the lee of the island to strike our Xiamen approaches. Find them and sink them all. Fire star shells with F to light them up; their wakes and gun flashes give them away.',
    },
    loadout: { msl: 8, special: 1, chaff: 4, flares: 8 },
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
      ALLIED: 'The carrier Fujian is using a storm front to cover her group\'s run through the strait. Her escorts are a Type 055, a Type 052D and a frigate, and she is launching strike aircraft. Break through and sink the carrier. You have two Harpoon salvos.',
      PLA: 'USS George Washington is using a storm front to cover her group\'s run north. Her escorts are destroyers and a frigate, and she is launching strike aircraft. Break through and sink the carrier. You have two DF-21D strikes.',
    },
    loadout: { msl: 14, special: 2, chaff: 6, flares: 0 },
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
    convoy: (role, o) => { const s = A.spawn(P, role, { ...o, role: 'convoy', priority: 1.6 }); s.cruise = o.cruise; s.order = o.cruise; return s; },
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
        W.pending.push({ t: i * 1.4, fn: () => { if (!t.dead) { const m = launchMissile('asm', ghost, p, new V3(-fx(b), 0, -fz(b)), t, { dmg: 240 * DIFF[CFG.diff].dmg, boost: 0.1, speed0: 260 }); m.alt = rand(6, 10); } } });
      }
    },
    islands(list) {
      for (const I of list) { W.islands.push(I); const g = buildIsland(I); scene.add(g); W.islandObjs.push(g); }
    },
    at: (t, fn) => MS.timers.push({ t, fn }),
    obj(o) { MS.objs.push({ done: false, failed: false, ...o }); },
    killed: tag => MS.kills[tag] || 0,
    count: tag => MS.spawned[tag] || 0,
  };
  return A;
}

function clearWorld() {
  for (const s of W.ships) removeShip(s);
  for (const j of W.jets) scene.remove(j.obj);
  for (const m of W.missiles) scene.remove(m.obj);
  for (const g of W.islandObjs) { scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  for (const k of Object.keys(W)) W[k] = [];
  [fxSmoke, fxSpray, fxFire, fxSpark].forEach(f => f.clear());
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
  Object.assign(MS, { def, idx: i, t: 0, objs: [], timers: [], over: false, won: false, endT: 0, waypoints: [], limit: 0, kills: {}, spawned: {}, arrived: 0 });
  applyEnv(def.env);
  const A = missionAPI(def);
  def.setup(A);
  const lo = def.loadout;
  PL.msl = lo.msl; PL.special = lo.special; PL.chaff = lo.chaff; PL.flares = lo.flares; PL.chaffCd = 0; PL.gunCd = 0; PL.warned = false;
  $('missionName').textContent = def.title[CFG.side];
  state = 'play';
  show('hud', true); show('title', false); show('brief', false); show('debrief', false); show('pause', false);
  show('touch', PL.touch);
  $('radio').innerHTML = '';
  radio('Captain', `${PL.ship.name}, battle stations. ${def.title[CFG.side]}.`);
  sfx('alarm');
  lockPointer();
}

function onShipKilled(s, src) {
  if (s.tag) MS.kills[s.tag] = (MS.kills[s.tag] || 0) + 1;
  if (state !== 'play') return;
  if (s.player) { radio('Captain', 'Abandon ship! Abandon ship!', 'bad'); endMission(false, `${s.name} was sunk.`); return; }
  if (src && src.player) PL.stats.kills++;
  if (s.side !== PL.side) radio('CIC', `${s.name} is sinking${src && src.player ? '. Good shooting.' : '.'}`, 'good');
  else radio('CIC', `${s.name} has been hit and is going down.`, 'bad');
}
function onJetKilled(j, by) {
  if (state !== 'play') return;
  if (by && by.player) { PL.stats.air++; PL.stats.kills++; }
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
  const stars = MS.won ? 1 + (hp >= 0.5 ? 1 : 0) + (secOK ? 1 : 0) : 0;
  if (MS.won) { const p = loadProgress(); const k = CFG.side + ':' + def.id; p[k] = Math.max(p[k] || 0, stars); saveProgress(p); }
  $('dbTitle').textContent = MS.won ? 'Mission accomplished' : 'Mission failed';
  $('dbSub').textContent = `${def.title[CFG.side]} · ${MS.reason}`;
  $('dbStars').innerHTML = [0, 1, 2].map(i => `<i class="${i < stars ? 'on' : ''}"></i>`).join('');
  const acc = PL.stats.shells ? Math.round(100 * PL.stats.hits / Math.max(1, PL.stats.shells + PL.stats.msl)) : 0;
  $('dbStats').innerHTML = [
    ['Time', fmtTime(MS.t)], ['Hull', Math.round(hp * 100) + '%'], ['Ships and aircraft destroyed', PL.stats.kills],
    ['Shells fired', PL.stats.shells], ['Missiles fired', PL.stats.msl], ['Hits', PL.stats.hits],
  ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
  $('dbObj').innerHTML = MS.objs.map(o => `<li class="${o.done ? 'done' : 'failed'}${o.secondary ? ' sec' : ''}"><span></span>${o.text}</li>`).join('');
  $('dbNext').hidden = !MS.won || MS.idx >= MISSIONS.length - 1;
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
  updateJets(dt); updateMissiles(dt); updateTorps(dt); updateShells(dt);
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

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - (frame.last || now)) / 1000));
  frame.last = now;
  if (state === 'loading') return;
  if (state === 'play') { updateWorld(dt, true); updateMission(dt); }
  else if (state === 'debrief') updateWorld(dt, false);
  else if (state === 'menu' || state === 'brief') { updateWorld(dt, false); updateAttract(dt); }
  // Sky, sea and weather follow the camera
  const cp = camera.getWorldPosition(_v2);
  sky.position.copy(cp); clouds.position.copy(cp); stars.position.copy(cp);
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
  flushTracers();
  composer.render(dt);
  if (state === 'play') updateHud(dt);
  else octx.clearRect(0, 0, ov.width, ov.height);
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
    else if (e.code === 'KeyR') { radarRange = radarRange === 12000 ? 24000 : radarRange === 24000 ? 6000 : 12000; $('radarCap').textContent = `Radar ${radarRange / 1000} km · head up`; }
    else if (e.code === 'KeyZ') PL.zoomOn = !PL.zoomOn;
    else if (e.code === 'Space') PL.fire = true;
    else if (e.code === 'KeyM') toggleSound();
    else if (e.code === 'KeyP' || (e.code === 'Escape' && !PL.pointer)) pause(true);
  } else if (state === 'paused' && e.code === 'KeyP') pause(false);
});
window.addEventListener('keyup', e => { PL.keys[e.code] = false; if (e.code === 'Space') PL.fire = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
$('overlay').addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousedown', e => {
  if (state !== 'play' || e.target.closest('button, input, label, .screen')) return;
  if (!PL.pointer && !PL.touch && e.button === 0 && PL.wantLock && !PL.lockTried) { PL.lockTried = true; lockPointer(); }
  if (e.button === 0) PL.fire = true;
  if (e.button === 2) PL.zoomOn = true;
});
window.addEventListener('mouseup', e => { if (e.button === 0) PL.fire = false; if (e.button === 2) PL.zoomOn = false; });
window.addEventListener('mousemove', e => {
  if (state !== 'play') return;
  if (PL.pointer) {
    const k = 0.0022 * sens * (camera.fov / 68);
    PL.yaw += e.movementX * k; PL.pitch -= e.movementY * k;
  } else { PL.cursor.x = e.clientX / window.innerWidth; PL.cursor.y = e.clientY / window.innerHeight; }
});
document.addEventListener('pointerlockchange', () => {
  const was = PL.pointer;
  PL.pointer = document.pointerLockElement === canvas;
  if (was && !PL.pointer && state === 'play') pause(true);
});
window.addEventListener('blur', () => { PL.fire = false; PL.keys = {}; if (state === 'play') pause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(true); });

function lockPointer() {
  if (PL.touch) return;
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
function unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }

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
    PL.yaw += (e.clientX - lx) * k; PL.pitch -= (e.clientY - ly) * k; lx = e.clientX; ly = e.clientY;
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
  $('tPause').addEventListener('pointerdown', () => pause(true));
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
      <span class="mnum">${String(i + 1).padStart(2, '0')}</span>
      <span class="mbody"><strong>${m.title[CFG.side]}</strong><span>${m.place[CFG.side]}</span><em>${m.time} · ${m.weather}</em></span>
      <span class="mstars" aria-label="${st} of 3 stars">${[0, 1, 2].map(k => `<i class="${k < st ? 'on' : ''}"></i>`).join('')}</span>
    </button>`;
  }).join('');
}
function openBrief(i) {
  const m = MISSIONS[i];
  state = 'brief';
  MS.idx = i;
  $('bNum').textContent = `Mission ${String(i + 1).padStart(2, '0')} of ${MISSIONS.length}`;
  $('bTitle').textContent = m.title[CFG.side];
  $('bMeta').textContent = `${m.place[CFG.side]} · ${m.time} local · ${m.weather}`;
  $('bText').textContent = m.brief[CFG.side];
  const ps = PLAYER_SHIP[CFG.side];
  const lo = m.loadout;
  $('bShip').textContent = `${ps.name} (${ps.no}), ${CLASS[ps.cls].label}`;
  $('bLoad').textContent = `${lo.msl} missiles · ${lo.special} ${CFG.side === 'ALLIED' ? 'Harpoon salvo' : 'DF-21D strike'}${lo.special > 1 ? 's' : ''} · ${lo.chaff} decoy loads${lo.flares ? ` · ${lo.flares} star shells` : ''}`;
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
$('sens').addEventListener('input', e => { sens = parseFloat(e.target.value); try { localStorage.setItem('straitfire3d-sens', String(sens)); } catch (err) { /* storage blocked */ } });
document.querySelectorAll('input[name="side"]').forEach(r => r.addEventListener('change', () => {
  CFG.side = r.value; document.body.dataset.side = r.value; renderMissionList(); startAttract();
}));
document.querySelectorAll('input[name="diff"]').forEach(r => r.addEventListener('change', () => { CFG.diff = r.value; }));

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
(async function boot() {
  try {
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);
    makeTextures();
    makeMaterials();
    makeFX();
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
        if (W.ships.length && Math.random() < dt / 60) fireSpecialKey();
        PL.telegraph = d > 9000 ? 6 : 5;
        PL.keys.KeyA = false; PL.keys.KeyD = false;
      }
      if (W.missiles.some(m => m.target === s) && Math.random() < dt / 4) chaffKey();
      const mp = MS.waypoints[0];
      if (mp) { const b = wrapPi(bearing(s.x, s.z, mp.x, mp.z) - s.h); PL.rudder = clamp(b, -1, 1) * (Math.hypot(mp.x - s.x, mp.z - s.z) > 2500 ? 1 : 0); }
    }
    updateWorld(dt, true); updateMission(dt);
    flushTracers();
  }
  return { t: MS.t, over: MS.over, won: MS.won, reason: MS.reason, hp: PL.ship ? Math.round(PL.ship.hp) : null, stats: { ...PL.stats }, objs: MS.objs.map(o => (o.done ? '+' : o.failed ? 'x' : '-') + o.text), ships: W.ships.length, jets: W.jets.length, missiles: W.missiles.length };
}
window.__strait = { simulate, startMission, openBrief, MS, PL, W, CFG, get state() { return state; }, set state(v) { state = v; }, applyEnv, camera, scene };
