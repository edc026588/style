// Operation Ironveil: a browser first-person shooter built on three.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V3 = THREE.Vector3;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const dampAngle = (a, b, l, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-l * dt));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let srand = mulberry32(417);
const srange = (a, b) => a + srand() * (b - a);

const IS_TOUCH = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;
if (IS_TOUCH) document.body.classList.add('touch');

// ---------------------------------------------------------------- settings
const store = {
  get(k, d) { try { const v = localStorage.getItem('ironveil.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ironveil.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const settings = {
  sens: store.get('sens', 1),
  fov: store.get('fov', 78),
  volume: store.get('volume', 0.8),
  quality: store.get('quality', IS_TOUCH ? 'low' : 'ultra'),
  qualityManual: store.get('qualityManual', false),
};

// ---------------------------------------------------------------- renderer
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  $('notice').hidden = false;
  $('notice').textContent = 'WebGL could not start in this browser, so the game cannot run here. Try a recent Chrome, Edge, Firefox or Safari.';
  $('btn-deploy').disabled = true;
  throw err;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
const HIGH = () => settings.quality !== 'low';
const ULTRA = () => settings.quality === 'ultra';
// Layer 2 holds things ambient occlusion must ignore: sky, particles, decals, grass cards, fronds, sprites.
const NO_AO = 2;
const noAO = (o) => { o.layers.set(NO_AO); return o; };
// The FOV setting reads as landscape vertical FOV; portrait screens widen it so the view isn't a slit.
function baseFov() {
  const aspect = innerWidth / innerHeight;
  if (aspect >= 1) return settings.fov;
  const h = THREE.MathUtils.degToRad(settings.fov * 0.85);
  return Math.min(105, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect)));
}

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xbba48e);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0082);
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 800);
camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);

// ---------------------------------------------------------------- lighting and sky
const SUN_DIR = new V3(-0.55, 0.3, -0.78).normalize();
const hemi = new THREE.HemisphereLight(0xb4c2d8, 0x7a5f48, 0.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc896, 3.4);
sun.position.copy(SUN_DIR).multiplyScalar(140);
scene.add(sun, sun.target);
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -92, right: 92, top: 92, bottom: -92, near: 20, far: 340 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;

// Aerial perspective: fog thins with altitude and glows toward the sun, applied to every lit material.
const SUN_FOG = new THREE.Color(0xffc995).multiplyScalar(1.5);
const glslV3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
// The sun direction and glow are baked into the fog chunk; a mission's lighting preset rewrites it and bumps FOG_VERSION,
// which is part of every material's program key, so all materials recompile with the new values.
let FOG_VERSION = 0;
const fogFn = () => `vec3 ivFogColor(vec3 dir, vec3 base){ return mix(base, ${glslV3({ x: SUN_FOG.r, y: SUN_FOG.g, z: SUN_FOG.b })}, pow(max(dot(dir, ${glslV3(SUN_DIR)}), 0.0), 5.0)); }\n`;
THREE.Material.prototype.customProgramCacheKey = function () { return this.onBeforeCompile.toString() + '|fog' + FOG_VERSION; };
const installFog = () => { THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor;\n varying float vFogDepth;\n #if __VERSION__ >= 300\n  varying vec3 vFogWorld;\n #endif\n #ifdef FOG_EXP2\n  uniform float fogDensity;\n #else\n  uniform float fogNear;\n  uniform float fogFar;\n #endif\n' + fogFn() + '#endif'; };
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n #if __VERSION__ >= 300\n  varying vec3 vFogWorld;\n #endif\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n #if __VERSION__ >= 300\n  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n #endif\n#endif';
installFog();
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
 #if __VERSION__ >= 300 && defined(FOG_EXP2)
  vec3 fogV = vFogWorld - cameraPosition; float fogD = length(fogV); vec3 fogDir = fogV / max(fogD, 0.001);
  const float fogHK = 0.032; float fogY0 = max(cameraPosition.y, 0.0), fogY1 = max(cameraPosition.y + fogV.y, 0.0);
  float fogH = abs(fogY1 - fogY0) > 0.05 ? (exp(-fogHK * fogY0) - exp(-fogHK * fogY1)) / (fogHK * (fogY1 - fogY0)) : exp(-fogHK * fogY0);
  float fogFactor = 1.0 - exp(-fogDensity * fogD * fogH);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, ivFogColor(fogDir, fogColor), fogFactor);
 #else
  #ifdef FOG_EXP2
   float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
   float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
 #endif
#endif`;
scene.fog.density = 0.0052;

// Physically based sky (Preetham scattering model) with a lit cloud layer and horizon haze that matches the fog.
const skyUniforms = {
  uSunDir: { value: SUN_DIR }, uTurbidity: { value: 7.5 }, uRayleigh: { value: 2.2 }, uMie: { value: 0.006 }, uMieG: { value: 0.82 },
  uScale: { value: 0.5 }, uFog: { value: FOG_COLOR }, uSunCol: { value: new THREE.Color(0xffc48a).multiplyScalar(2.2) },
  uSunFog: { value: SUN_FOG }, uCloud: { value: 0.5 }, uNight: { value: 0 }, uOvercast: { value: 0 }, uDust: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 },
};
const SKY_VERT = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
uniform vec3 uSunDir, uFog, uSunCol, uSunFog; uniform float uTurbidity, uRayleigh, uMie, uMieG, uScale, uCloud, uNight, uOvercast, uDust, uFlash, uTime; varying vec3 vDir;
vec3 ivFogColor(vec3 dir, vec3 base){ return mix(base, uSunFog, pow(max(dot(dir, uSunDir), 0.0), 5.0)); }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
const float PI = 3.14159265;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
vec3 preetham(vec3 dir){
  vec3 up = vec3(0.0, 1.0, 0.0);
  float sunE = 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(dot(uSunDir, up), -1.0, 1.0))) / 1.5)));
  float sunfade = 1.0 - clamp(1.0 - exp(uSunDir.y * 400000.0 / 450000.0), 0.0, 1.0);
  vec3 betaR = totalRayleigh * (uRayleigh - (1.0 - sunfade));
  vec3 betaM = 0.434 * (0.2 * uTurbidity * 10E-18) * MieConst * uMie;
  float zen = acos(max(0.0, dot(up, dir)));
  float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - zen * 180.0 / PI, -1.253));
  vec3 Fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));
  float cosT = dot(dir, uSunDir);
  vec3 bRT = betaR * (0.05968310365946075 * (1.0 + pow(cosT * 0.5 + 0.5, 2.0)));
  float g2 = uMieG * uMieG;
  vec3 bMT = betaM * (0.07957747154594767 * (1.0 - g2) / pow(1.0 - 2.0 * uMieG * cosT + g2, 1.5));
  vec3 Lin = pow(sunE * ((bRT + bMT) / (betaR + betaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(sunE * ((bRT + bMT) / (betaR + betaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, uSunDir), 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex + sunE * 19000.0 * Fex * smoothstep(0.99995, 0.99997, cosT);
  vec3 c = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  return pow(c, vec3(1.0 / (1.2 + 1.2 * sunfade)));
}
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  float cosT = dot(d, uSunDir);
  vec3 col = uNight > 0.5 ? vec3(0.0) : preetham(vec3(d.x, max(h, 0.002), d.z)) * uScale;
  if (uNight > 0.0) {
    vec3 night = mix(vec3(0.010, 0.014, 0.026), vec3(0.0016, 0.0024, 0.006), smoothstep(0.0, 0.6, h));
    vec3 sd = d * 420.0; vec3 cell = floor(sd);
    float star = step(0.9965, hash3(cell)) * smoothstep(0.45, 0.0, length(fract(sd) - 0.5)) * smoothstep(0.02, 0.2, h);
    night += vec3(0.75, 0.82, 1.0) * star * (0.6 + 0.4 * sin(uTime * 3.0 + hash3(cell + 7.0) * 40.0)) * 2.2;
    night += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.99975, cosT) * 4.0 + pow(max(cosT, 0.0), 300.0) * 0.05);
    col = mix(col, night, uNight);
  }
  float dens = 0.0;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.09) * 0.55 + vec2(uTime * 0.004, 0.0);
    float base = fbm(uv * 1.2 + vec2(2.0, 5.0));
    float cover = mix(0.82, 0.38, uCloud);
    dens = smoothstep(cover - 0.32, cover, base + fbm(uv * 5.0) * 0.18) * smoothstep(0.0, 0.25, h);
    float thick = smoothstep(0.55, 0.95, base);
    vec3 amb = (uNight > 0.5 ? vec3(0.003, 0.0045, 0.009) : preetham(vec3(0.0, 1.0, 0.0)) * uScale * 1.4) + uFog * (0.25 - uNight * 0.15);
    vec3 lit = uSunCol * (0.28 + 1.6 * pow(max(cosT, 0.0), 10.0)) * (1.0 - thick * 0.55) * (1.0 - uOvercast * 0.85) * (1.0 - uNight * 0.97);
    col = mix(col, amb + lit, dens * 0.85);
    vec3 deck = uFog * (0.75 + 0.5 * base) * (1.0 - thick * 0.35);
    col = mix(col, deck, uOvercast * smoothstep(-0.05, 0.15, h));
  }
  col += vec3(0.75, 0.82, 1.0) * uFlash * (0.5 + dens + uOvercast) * 2.5 * smoothstep(-0.05, 0.3, h);
  vec3 haze = ivFogColor(d, uFog);
  col = mix(col, haze, h > 0.0 ? max(exp(-h * 16.0) * 0.92, uDust * 0.9) : 1.0);
  col += uSunCol * 1.2 * pow(max(cosT, 0.0), 900.0) * (1.0 - uOvercast) * (1.0 - uNight) * (1.0 - uDust * 0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function makeSky(radius) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.ShaderMaterial({
    uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
const skyMesh = noAO(makeSky(520));
scene.add(skyMesh);
const pmrem = new THREE.PMREMGenerator(renderer);
{
  const envScene = new THREE.Scene();
  envScene.add(makeSky(60));
  const env = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = env;
  vmScene.environment = env;
}
// Once the compound is built, capture it from the crossroads so reflections and ambient light carry the warm ground bounce.
function captureEnvironment() {
  const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(0.3, 900, rt);
  cam.position.set(PLAYER_START.x, 2.2, PLAYER_START.z);
  for (const c of cam.children) c.layers.enableAll();
  cam.updateMatrixWorld(true);
  skyMesh.position.copy(cam.position);
  const hemiI = hemi.intensity;
  // Light the capture with the current sky alone; reusing the previous capture would carry daylight into night.
  const skyScene = new THREE.Scene(); skyScene.add(makeSky(60));
  const skyEnv = pmrem.fromScene(skyScene, 0.04);
  const old = scene.environment;
  scene.environment = skyEnv.texture;
  // Local lights (burning wrecks, street lamps) would otherwise end up lighting the whole compound through the capture.
  const fireI = fireLights.map((l) => l.intensity), lampI = MAT.lamp.emissiveIntensity;
  fireLights.forEach((l) => { l.intensity = 0; }); MAT.lamp.emissiveIntensity = 0;
  fxAdd.points.visible = false;
  cam.update(renderer, scene);
  fireLights.forEach((l, i) => { l.intensity = fireI[i]; }); MAT.lamp.emissiveIntensity = lampI;
  fxAdd.points.visible = true;
  const env = pmrem.fromCubemap(rt.texture).texture;
  scene.environment = env; vmScene.environment = env;
  if (old && old !== env) old.dispose();
  skyEnv.dispose();
  hemi.intensity = hemiI;
  rt.dispose();
}

// ---------------------------------------------------------------- procedural textures
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
function canvasTex(size, draw, { srgb = true, repeat = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.repeat.set(repeat, repeat);
  return t;
}
function wrapped(g, s, x, y, fn) { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) fn(x + ox, y + oy); }
function blotches(g, s, n, colors, rmin, rmax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = rand(rmin, rmax);
    g.fillStyle = colors[i % colors.length];
    g.globalAlpha = alpha * rand(0.4, 1);
    wrapped(g, s, x, y, (px, py) => { g.beginPath(); g.ellipse(px, py, r, r * rand(0.5, 1), Math.random() * 3, 0, Math.PI * 2); g.fill(); });
  }
  g.globalAlpha = 1;
}
function speckle(g, s, n, colors, size, alpha) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * rand(0.3, 1);
    g.fillStyle = colors[i % colors.length];
    const r = rand(size * 0.4, size);
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
  g.globalAlpha = 1;
}
const TEX = {};
TEX.camo = canvasTex(256, (g, s) => {
  g.fillStyle = '#d6d0c0'; g.fillRect(0, 0, s, s);
  blotches(g, s, 60, ['#a39a82', '#8a826c', '#bdb49b', '#6f6a5a'], 8, 26, 0.9);
}, { repeat: 1 });
TEX.hole = canvasTex(64, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(10,8,6,1)'); grd.addColorStop(0.22, 'rgba(20,16,12,.95)'); grd.addColorStop(0.45, 'rgba(60,50,40,.5)'); grd.addColorStop(1, 'rgba(60,50,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
});
TEX.scorch = canvasTex(128, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(12,10,8,.95)'); grd.addColorStop(0.5, 'rgba(25,20,16,.7)'); grd.addColorStop(1, 'rgba(30,25,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
});
TEX.flash = canvasTex(128, (g, s) => {
  g.translate(s / 2, s / 2);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  grd.addColorStop(0, 'rgba(255,250,230,1)'); grd.addColorStop(0.25, 'rgba(255,200,110,.9)'); grd.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grd;
  for (let i = 0; i < 7; i++) { g.rotate(Math.PI * 2 / 7); g.beginPath(); g.moveTo(0, -s * 0.06); g.lineTo(s * rand(0.3, 0.5), 0); g.lineTo(0, s * 0.06); g.fill(); }
  g.beginPath(); g.arc(0, 0, s * 0.2, 0, 7); g.fill();
});
TEX.leaf = canvasTex(256, (g, s) => {
  g.clearRect(0, 0, s, s);
  g.strokeStyle = '#5c5a2c'; g.lineWidth = 5; g.beginPath(); g.moveTo(s / 2, s); g.lineTo(s / 2, 0); g.stroke();
  for (let i = 0; i < 30; i++) {
    const y = s - i * s / 30, w = Math.sin((i / 30) * Math.PI) * s * 0.48 + 6;
    g.strokeStyle = i % 2 ? '#6d7436' : '#57602b'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(s / 2, y); g.lineTo(s / 2 - w, y - 18); g.moveTo(s / 2, y); g.lineTo(s / 2 + w, y - 18); g.stroke();
  }
}, { repeat: 1 });

// Physically based surface sets. Each texel is computed from tileable value-noise fields, and every surface gets
// albedo, a normal map derived from its own height field, and a roughness map, so light behaves like it does on the real material.
function noiseField(seed) {
  const rnd = mulberry32(seed), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint16Array(512); for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256); for (let i = 0; i < 256; i++) vals[i] = rnd();
  const noise = (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = vals[perm[perm[x0] + y0]], b = vals[perm[perm[x1] + y0]], c = vals[perm[perm[x0] + y1]], d = vals[perm[perm[x1] + y1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // fbm(u, v, fx, fy = fx, octaves): integer frequencies keep every octave tileable across the texture.
  return (u, v, fx, fy = fx, oct = 4) => {
    let s = 0, amp = 1, norm = 0, x = fx, y = fy;
    for (let o = 0; o < oct; o++) { s += noise(u * x, v * y, x, y) * amp; norm += amp; amp *= 0.5; x *= 2; y *= 2; }
    return s / norm;
  };
}
const ridge = (n) => 1 - Math.abs(n * 2 - 1);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function pbrTex(size, fn, { repeat = 1, normal = 4 } = {}) {
  const n = size * size, alb = new Uint8ClampedArray(n * 4), rgh = new Uint8ClampedArray(n * 4), hgt = new Float32Array(n);
  const o = { r: 0, g: 0, b: 0, h: 0, rough: 0.9 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, 1 - y / size, o);
    const i = y * size + x, j = i * 4;
    alb[j] = o.r * 255; alb[j + 1] = o.g * 255; alb[j + 2] = o.b * 255; alb[j + 3] = 255;
    rgh[j] = rgh[j + 1] = rgh[j + 2] = o.rough * 255; rgh[j + 3] = 255;
    hgt[i] = o.h;
  }
  const nrm = new Uint8ClampedArray(n * 4), k = normal * size / 256;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = hgt[y * size + (x - 1 + size) % size], r = hgt[y * size + (x + 1) % size];
    const u = hgt[((y - 1 + size) % size) * size + x], d = hgt[((y + 1) % size) * size + x];
    let nx = (l - r) * k, ny = (d - u) * k; const len = Math.hypot(nx, ny, 1); nx /= len; ny /= len;
    const j = (y * size + x) * 4;
    nrm[j] = (nx * 0.5 + 0.5) * 255; nrm[j + 1] = (ny * 0.5 + 0.5) * 255; nrm[j + 2] = (1 / len * 0.5 + 0.5) * 255; nrm[j + 3] = 255;
  }
  const mk = (data, srgb) => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.repeat.set(repeat, repeat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(alb, true), normalMap: mk(nrm, false), roughnessMap: mk(rgh, false) };
}
const NZ = [0, 1, 2, 3, 4, 5].map((i) => noiseField(101 + i * 17));
const setC = (o, r, g, b) => { o.r = clamp(r, 0, 1); o.g = clamp(g, 0, 1); o.b = clamp(b, 0, 1); };
const PBR = {};
PBR.sand = pbrTex(512, (u, v, o) => {
  const [a, b, c] = NZ;
  const warp = a(u, v, 3, 3, 4);
  const rip = Math.pow(Math.sin((u * 14 + v * 6) * Math.PI * 2 + warp * 10) * 0.5 + 0.5, 1.7);
  const m = sstep(0.38, 0.7, b(u, v, 2, 2, 3));
  const fine = c(u, v, 48, 48, 3), grain = a(u + 0.31, v + 0.17, 128, 128, 2);
  const pebble = sstep(0.74, 0.8, b(u + 0.5, v, 40, 40, 2));
  o.h = rip * 0.45 * m + fine * 0.3 + grain * 0.25 + pebble * 0.35;
  const tone = 0.84 + 0.26 * a(u, v, 5, 5, 4) + (grain - 0.5) * 0.18 - (1 - rip) * m * 0.07;
  setC(o, 0.74 * tone - pebble * 0.2, 0.61 * tone - pebble * 0.17, 0.45 * tone - pebble * 0.12);
  o.rough = 0.93 + grain * 0.07;
}, { repeat: 120, normal: 5 });
PBR.road = pbrTex(512, (u, v, o) => {
  const [a, b, c, d] = NZ;
  const agg = a(u, v, 96, 96, 3), big = b(u, v, 4, 4, 4);
  const crack = sstep(0.972, 0.992, ridge(c(u, v, 4, 4, 5)));
  const edge = sstep(0.14, 0.0, Math.min(v, 1 - v));
  const wear = d(u, v, 24, 24, 3);
  const dash = Math.abs(v - 0.5) < 0.012 && u % 1 < 0.5, side = Math.abs(v - 0.07) < 0.007 || Math.abs(v - 0.93) < 0.007;
  const paint = (dash || side) && wear > 0.36 ? 1 : 0;
  let g = 0.2 * (0.78 + 0.45 * big) + (agg - 0.5) * 0.1 - crack * 0.1;
  let r = g, gg = g, bb = g * 1.02;
  if (paint) { r = dash ? 0.78 : 0.8; gg = dash ? 0.66 : 0.78; bb = dash ? 0.42 : 0.72; r *= 0.75 + wear * 0.3; gg *= 0.75 + wear * 0.3; bb *= 0.75 + wear * 0.3; }
  const sandMix = edge * sstep(0.35, 0.65, b(u, v, 12, 12, 3));
  setC(o, lerp(r, 0.62, sandMix), lerp(gg, 0.52, sandMix), lerp(bb, 0.38, sandMix));
  o.h = agg * 0.22 - crack * 0.5 + paint * 0.05 + sandMix * 0.15;
  o.rough = paint ? 0.6 : lerp(0.82, 0.95, sandMix) + crack * 0.1;
}, { normal: 2 });
PBR.wall = pbrTex(512, (u, v, o) => {
  const [a, b, c, d, e] = NZ;
  const st = a(u, v, 24, 24, 4), bump = b(u, v, 96, 96, 2), stain = c(u, v, 3, 3, 4);
  const streak = d(u, v, 12, 2, 3);
  const cr = sstep(0.965, 0.99, ridge(e(u, v, 5, 5, 5)));
  let r = 0.9 * (0.9 + 0.12 * st) * (0.84 + 0.22 * stain), g = r * 0.975, bl = r * 0.93, h = st * 0.45 + bump * 0.25 - cr * 0.5, rough = 0.93;
  const x0 = 0.3, x1 = 0.7, y0 = 0.38, y1 = 0.8;
  if (v < y0 - 0.01 && v > y0 - 0.34 && Math.abs(u - 0.5) < 0.19) { const s = sstep(0.4, 0.75, streak) * sstep(y0 - 0.34, y0 - 0.02, v) * 0.22; r -= s; g -= s; bl -= s * 0.9; }
  if (u > x0 - 0.03 && u < x1 + 0.03 && v > y0 - 0.055 && v < y0 - 0.005) { r = g = bl = 0.78 + st * 0.1; h = 0.85; rough = 0.8; }
  const fr = 0.022;
  if (u > x0 && u < x1 && v > y0 && v < y1) {
    const inner = u > x0 + fr && u < x1 - fr && v > y0 + fr && v < y1 - fr;
    const mull = Math.abs(u - 0.5) < 0.008 || Math.abs(v - (y0 + y1) / 2) < 0.008;
    if (!inner || mull) { r = 0.3; g = 0.27; bl = 0.24; h = 0.35; rough = 0.55; }
    else {
      const sky = (v - y0) / (y1 - y0);
      r = 0.05 + sky * 0.05; g = 0.06 + sky * 0.07; bl = 0.07 + sky * 0.09;
      if (d(u, v, 8, 8, 2) > 0.66) { r += 0.07; g += 0.06; bl += 0.05; }
      h = 0.05; rough = 0.08 + bump * 0.08;
    }
  } else if (u > x0 - 0.02 && u < x1 + 0.02 && v > y0 - 0.005 && v < y1 + 0.02) { h = 0.55; r *= 0.85; g *= 0.85; bl *= 0.85; }
  setC(o, r - cr * 0.25, g - cr * 0.25, bl - cr * 0.25); o.h = h; o.rough = rough;
}, { normal: 5 });
PBR.concrete = pbrTex(512, (u, v, o) => {
  const [a, b, c, d] = NZ;
  const st = a(u, v, 4, 4, 5), pores = sstep(0.73, 0.78, b(u, v, 64, 64, 2)), agg = c(u, v, 80, 80, 2);
  const seam = Math.min(Math.abs((u * 2) % 1 - 0.5) > 0.494 ? 1 : 0, 1) || Math.abs(v - 0.5) < 0.004 ? 1 : 0;
  const tie = [0.25, 0.75].some((x) => [0.25, 0.75].some((y) => Math.hypot(u - x, v - y) < 0.01)) ? 1 : 0;
  const tone = 0.62 * (0.82 + 0.3 * st) + (agg - 0.5) * 0.08 - pores * 0.12 - seam * 0.12 - tie * 0.25;
  const damp = sstep(0.55, 0.8, d(u, v, 3, 1, 3)) * sstep(0.35, 0.0, v) * 0.12;
  setC(o, tone - damp, tone * 0.98 - damp, tone * 0.95 - damp);
  o.h = agg * 0.3 + st * 0.3 - pores * 0.4 - seam * 0.5 - tie * 0.6; o.rough = 0.9 + pores * 0.1;
}, { normal: 4 });
PBR.roof = pbrTex(256, (u, v, o) => {
  const [a, b, c] = NZ;
  const st = a(u, v, 4, 4, 4), tar = sstep(0.6, 0.66, b(u, v, 3, 3, 4)), g = c(u, v, 64, 64, 2);
  const t = tar ? 0.16 + g * 0.05 : 0.5 * (0.8 + 0.3 * st) + (g - 0.5) * 0.1;
  setC(o, t, t * 0.97, t * 0.93); o.h = g * 0.5 + tar * 0.2; o.rough = tar ? 0.55 : 0.95;
});
const containerSet = (hex) => {
  const base = new THREE.Color(hex);
  return pbrTex(256, (u, v, o) => {
    const [a, b, c, d] = NZ;
    const f = (u * 8) % 1;
    const prof = sstep(0.08, 0.2, f) - sstep(0.58, 0.7, f);
    const rust = sstep(0.66, 0.74, a(u, v, 6, 6, 5) + (1 - v) * 0.14 + (1 - prof) * 0.04);
    const rail = v < 0.04 || v > 0.96;
    const dirt = sstep(0.25, 0.0, v) * 0.25 + (b(u, v, 3, 8, 3) - 0.5) * 0.12;
    let r = base.r, g = base.g, bl = base.b;
    const fade = 0.9 + c(u, v, 6, 6, 3) * 0.2 - dirt;
    r *= fade; g *= fade; bl *= fade;
    const rc = 0.36 + d(u, v, 32, 32, 3) * 0.2;
    if (rust) { r = lerp(r, rc, rust); g = lerp(g, rc * 0.52, rust); bl = lerp(bl, rc * 0.28, rust); }
    if (rail) { r *= 0.55; g *= 0.55; bl *= 0.55; }
    setC(o, r, g, bl);
    o.h = rail ? 1 : prof * 0.8 + rust * c(u, v, 64, 64, 2) * 0.15; o.rough = lerp(0.5, 0.95, rust);
  }, { normal: 7 });
};
PBR.crate = pbrTex(256, (u, v, o) => {
  const [a, b, c] = NZ;
  const plank = Math.floor(v * 6), pv = (v * 6) % 1;
  const border = u < 0.09 || u > 0.91 || v < 0.09 || v > 0.91;
  const grain = a(u * 1 + plank * 0.37, v, border ? 40 : 2, border ? 2 : 40, 4);
  const gap = !border && (pv < 0.03 || pv > 0.97);
  const hue = 0.85 + ((plank * 7919) % 13) / 60;
  let t = (0.5 + grain * 0.35) * hue;
  if (gap) t *= 0.35;
  const nail = border && [0.045, 0.955].some((x) => [0.045, 0.955, 0.5].some((y) => Math.hypot(u - x, v - y) < 0.012));
  setC(o, nail ? 0.3 : t * 0.93, nail ? 0.3 : t * 0.7, nail ? 0.3 : t * 0.46);
  o.h = (border ? 0.7 : 0.45) + grain * 0.2 - (gap ? 0.5 : 0) + b(u, v, 64, 64, 2) * 0.05; o.rough = nail ? 0.4 : 0.82;
}, { normal: 5 });
PBR.sandbag = pbrTex(256, (u, v, o) => {
  const [a, b] = NZ;
  const rows = 4, row = Math.floor(v * rows), rv = (v * rows) % 1, ru = (u * 2 + (row % 2) * 0.5) % 1;
  const dx = Math.max(0, Math.abs(ru - 0.5) - 0.34) / 0.16, dy = Math.max(0, Math.abs(rv - 0.5) - 0.24) / 0.26;
  const dd = Math.min(1, Math.hypot(dx, dy));
  const pillow = Math.sqrt(1 - dd * dd) * (0.85 + 0.15 * Math.cos((ru - 0.5) * 3));
  const weave = (Math.sin(u * 256 * Math.PI) * Math.sin(v * 256 * Math.PI)) * 0.5 + 0.5;
  const t = (0.55 + a(u, v, 8, 8, 4) * 0.25) * (0.55 + pillow * 0.5) + (weave - 0.5) * 0.04 + (b(u, v, 3, 3, 3) - 0.5) * 0.1;
  setC(o, t * 1.02, t * 0.9, t * 0.66); o.h = pillow * 0.9 + weave * 0.04; o.rough = 0.97;
}, { normal: 6 });
PBR.metal = pbrTex(256, (u, v, o) => {
  const [a, b, c] = NZ;
  const scratch = sstep(0.8, 0.9, ridge(a(u, v, 4, 64, 3)));
  const rust = sstep(0.66, 0.74, b(u, v, 6, 6, 4));
  const t = 0.62 + c(u, v, 8, 8, 3) * 0.12 + scratch * 0.12;
  setC(o, lerp(t, 0.4, rust), lerp(t * 1.01, 0.22, rust), lerp(t * 1.03, 0.12, rust));
  o.h = c(u, v, 64, 64, 2) * 0.2 + rust * 0.3 - scratch * 0.1; o.rough = lerp(0.45 - scratch * 0.2, 0.95, rust);
});
PBR.wear = pbrTex(256, (u, v, o) => {
  const [a, b] = NZ;
  const n = a(u, v, 16, 16, 4), s = sstep(0.82, 0.92, ridge(b(u, v, 3, 48, 3)));
  const t = 0.92 + n * 0.08 + s * 0.08;
  setC(o, t, t, t); o.h = n * 0.3 - s * 0.2; o.rough = clamp(0.5 + (n - 0.5) * 0.5 - s * 0.25, 0.1, 1);
}, { normal: 1.5 });
PBR.dirt = pbrTex(512, (u, v, o) => {
  const [a, b, c, d] = NZ;
  const big = a(u, v, 3, 3, 5), mid = b(u, v, 12, 12, 4), fine = c(u, v, 96, 96, 2);
  const grass = sstep(0.45, 0.62, big + (mid - 0.5) * 0.4);
  const puddle = sstep(0.7, 0.76, d(u, v, 4, 4, 4)) * (1 - grass);
  const pebble = sstep(0.78, 0.84, b(u + 0.3, v, 48, 48, 2)) * (1 - grass);
  let r = lerp(0.36, 0.25, grass), g = lerp(0.29, 0.33, grass), bl = lerp(0.21, 0.15, grass);
  const t = 0.8 + mid * 0.35 + (fine - 0.5) * 0.25; r *= t; g *= t; bl *= t;
  r = lerp(r, 0.45, pebble); g = lerp(g, 0.43, pebble); bl = lerp(bl, 0.4, pebble);
  r *= 1 - puddle * 0.45; g *= 1 - puddle * 0.42; bl *= 1 - puddle * 0.35;
  setC(o, r, g, bl);
  o.h = fine * 0.35 + mid * 0.3 + grass * 0.25 * fine + pebble * 0.4 - puddle * 0.3;
  o.rough = lerp(0.93, 0.25, puddle);
}, { repeat: 90, normal: 4 });
PBR.cobble = pbrTex(256, (u, v, o) => {
  const [, b, c] = NZ;
  const row = Math.floor(v * 8), rv = (v * 8) % 1;
  const uu = u * 6 + (row % 2) * 0.5, col = Math.floor(uu), ru = uu - col;
  const dx = Math.max(0, Math.abs(ru - 0.5) - 0.34) / 0.16, dy = Math.max(0, Math.abs(rv - 0.5) - 0.3) / 0.2;
  const dd = Math.min(1, Math.hypot(dx, dy)), mortar = dd >= 0.999;
  const id = (((row * 31 + (col % 6) * 17) % 13) / 13);
  const t = (0.36 + id * 0.18 + b(u, v, 32, 32, 3) * 0.12) * (0.6 + 0.4 * Math.sqrt(1 - dd));
  setC(o, mortar ? 0.2 : t, mortar ? 0.19 : t * 0.97, mortar ? 0.17 : t * 0.92);
  o.h = Math.sqrt(1 - dd) * 0.8 + c(u, v, 64, 64, 2) * 0.1; o.rough = mortar ? 0.95 : 0.72 - id * 0.15;
}, { normal: 6 });
PBR.stone = pbrTex(512, (u, v, o) => {
  const [a] = NZ;
  const row = Math.floor(v * 10), rv = (v * 10) % 1;
  const cols = 4 + (row * 7) % 3, uu = u * cols + ((row * 0.618) % 1), col = Math.floor(uu), ru = uu - col;
  const dx = Math.max(0, Math.abs(ru - 0.5) - 0.42) / 0.08, dy = Math.max(0, Math.abs(rv - 0.5) - 0.36) / 0.14;
  const dd = Math.min(1, Math.hypot(dx, dy)), mortar = dd >= 0.999;
  const id = (((row * 13 + (col % cols) * 7) % 11) / 11), st = a(u, v, 24, 24, 4);
  const t = mortar ? 0.42 : (0.5 + id * 0.22 + st * 0.18) * (0.75 + 0.25 * (1 - dd));
  setC(o, t, t * 0.95, t * 0.86);
  o.h = mortar ? 0.1 : 0.55 + (1 - dd) * 0.3 + st * 0.2; o.rough = 0.92;
}, { normal: 6 });
PBR.tiles = pbrTex(256, (u, v, o) => {
  const [a, b] = NZ;
  const row = Math.floor(v * 10), rv = (v * 10) % 1;
  const prof = Math.abs(Math.sin((u * 8 + (row % 2) * 0.5) * Math.PI)), lap = sstep(0, 0.25, rv);
  const t = (0.55 + a(u, v, 8, 8, 3) * 0.3) * (0.6 + prof * 0.4) * (0.7 + 0.3 * lap);
  const moss = sstep(0.62, 0.75, b(u, v, 6, 6, 4));
  setC(o, lerp(t * 0.8, 0.3, moss), lerp(t * 0.38, 0.33, moss), lerp(t * 0.25, 0.2, moss));
  o.h = prof * 0.6 + lap * 0.3; o.rough = 0.8;
}, { normal: 6 });
PBR.asphalt = pbrTex(512, (u, v, o) => {
  const [a, b, c] = NZ;
  const agg = a(u, v, 96, 96, 3), big = b(u, v, 4, 4, 4), crack = sstep(0.972, 0.992, ridge(c(u, v, 4, 4, 5)));
  const g = 0.19 * (0.78 + 0.45 * big) + (agg - 0.5) * 0.1 - crack * 0.1;
  setC(o, g, g, g * 1.02); o.h = agg * 0.22 - crack * 0.5; o.rough = 0.85 + crack * 0.1;
}, { repeat: 70, normal: 2 });
PBR.water = pbrTex(256, (u, v, o) => {
  const [a] = NZ;
  o.h = Math.sin((u * 6 + v * 2) * Math.PI * 2) * 0.25 + Math.sin((v * 7 - u * 3) * Math.PI * 2) * 0.2 + a(u, v, 8, 8, 4) * 0.6;
  setC(o, 0.05, 0.09, 0.11); o.rough = 0.08;
}, { normal: 3, repeat: 60 });
TEX.fence = (() => {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 3;
  for (let i = -s; i < s * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); g.beginPath(); g.moveTo(i + s, 0); g.lineTo(i, s); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; return t;
})();
TEX.windows = (() => {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  for (let y = 6; y < s; y += 16) for (let x = 6; x < s; x += 12) if (Math.random() < 0.3) { g.fillStyle = ['#ffcf7a', '#ffe0a8', '#c8e4ff'][Math.floor(Math.random() * 3)]; g.fillRect(x, y, 6, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();
TEX.macro = canvasTex(256, (g, s) => { g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); blotches(g, s, 70, ['#ffffff', '#000000', '#a0a0a0', '#505050'], 18, 60, 0.16); }, { srgb: false });
TEX.grass = canvasTex(128, (g, s) => {
  g.clearRect(0, 0, s, s);
  for (let i = 0; i < 34; i++) {
    const x = rand(s * 0.1, s * 0.9), lean = rand(-28, 28), hgt = rand(s * 0.45, s * 0.98);
    g.strokeStyle = ['#b3ab68', '#c9b97c', '#9c9a55', '#d6c690', '#8e8a4f'][i % 5]; g.lineWidth = rand(2, 4);
    g.beginPath(); g.moveTo(x, s); g.quadraticCurveTo(x + lean * 0.3, s - hgt * 0.6, x + lean, s - hgt); g.stroke();
  }
}, { repeat: 1 });
TEX.ao = (() => {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'), img = g.createImageData(s, s);
  const f = (u) => { const t = 1 - Math.abs(u * 2 - 1); return t * t * (3 - 2 * t); };
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) img.data[(y * s + x) * 4 + 3] = 255 * f((x + 0.5) / s) * f((y + 0.5) / s);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); return t;
})();

// ---------------------------------------------------------------- materials
const std = (o) => new THREE.MeshStandardMaterial(o);
const pbr = (set, o = {}) => std({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, ...o });
// Weathering: dirt and damp creep up from the ground, and a world-space tint keeps repeated textures from looking identical.
const WNOISE = 'float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }\n';
function weathered(mat, grime = 0.35, height = 1.6, vary = 0.2) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: grime }; sh.uniforms.uGrimeH = { value: height }; sh.uniforms.uVary = { value: vary };
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWPos;\nuniform float uGrime, uGrimeH, uVary;\n' + WNOISE + sh.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n  float gN = wn(vWPos.xz * 0.45 + vWPos.y * 0.3);\n  diffuseColor.rgb *= mix(1.0 - uGrime * (0.6 + 0.8 * gN), 1.0, smoothstep(0.0, uGrimeH * (0.6 + 0.8 * gN), vWPos.y));\n  diffuseColor.rgb *= 1.0 - uVary * 0.5 + uVary * wn(vWPos.xz * 0.07 + vec2(vWPos.y * 0.05, 3.1));');
  };
  mat.customProgramCacheKey = () => 'weathered|fog' + FOG_VERSION;
  return mat;
}
const MAT = {
  sand: pbr(PBR.sand, { normalScale: new THREE.Vector2(1, 1) }),
  wallTan: pbr(PBR.wall, { color: 0xd9c19c }),
  wallOchre: pbr(PBR.wall, { color: 0xdcc08c }),
  wallGrey: pbr(PBR.wall, { color: 0xbdb6ab }),
  roof: pbr(PBR.roof),
  concrete: pbr(PBR.concrete),
  perimeter: pbr(PBR.concrete, { color: 0xc9c1b4 }),
  barrier: pbr(PBR.concrete, { color: 0xf2eadc }),
  crate: pbr(PBR.crate),
  sandbag: pbr(PBR.sandbag, { normalScale: new THREE.Vector2(1.3, 1.3) }),
  metal: pbr(PBR.metal, { metalness: 0.55 }),
  darkMetal: std({ color: 0x2b2d2f, roughness: 0.55, metalness: 0.5 }),
  door: std({ color: 0x3b3027, roughness: 0.8 }),
  burnt: std({ color: 0x2a2521, roughness: 0.9, metalness: 0.3 }),
  glass: std({ color: 0x14191d, roughness: 0.15, metalness: 0.6 }),
  tire: std({ color: 0x151515, roughness: 0.95 }),
  trunk: std({ color: 0x6d5a45, roughness: 1 }),
  leaf: std({ map: TEX.leaf, color: 0x8a8a6a, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
  lamp: std({ color: 0xffd9a0, emissive: 0xffb866, emissiveIntensity: 1.6 }),
  mountain: std({ color: 0x8c6d57, roughness: 1, flatShading: true }),
  skyline: std({ color: 0x7f6f60, roughness: 1 }),
};
MAT.sand.onBeforeCompile = (sh) => {
  sh.uniforms.macroMap = { value: TEX.macro };
  sh.fragmentShader = 'uniform sampler2D macroMap;\n' + sh.fragmentShader.replace('#include <map_fragment>',
    '#include <map_fragment>\n  float mac = texture2D(macroMap, vMapUv * 0.021).r * 0.6 + texture2D(macroMap, vMapUv * 0.0047 + 0.37).r * 0.4;\n  diffuseColor.rgb *= 0.5 + mac;');
};
const containerMats = [0x8e3b2b, 0x2f5470, 0x42613f, 0xb48a4e, 0x6b6f72].map((c) => weathered(pbr(containerSet(c), { metalness: 0.35 }), 0.3, 1.0, 0.15));
for (const k of ['wallTan', 'wallOchre', 'wallGrey']) weathered(MAT[k], 0.4, 1.8, 0.22);
for (const k of ['concrete', 'perimeter', 'barrier']) weathered(MAT[k], 0.35, 1.2, 0.18);
const barrelMats = [0x9a3a2b, 0x345a7a, 0x56663d].map((c) => pbr(PBR.metal, { color: c, metalness: 0.45 }));
const carMats = [0x9b9384, 0x5c6a73, 0x7c3a2e].map((c) => std({ color: c, roughness: 0.5, metalness: 0.5 }));
Object.assign(MAT, {
  dirt: pbr(PBR.dirt, { normalScale: new THREE.Vector2(1.1, 1.1) }),
  asphalt: pbr(PBR.asphalt),
  stone: weathered(pbr(PBR.stone, { color: 0xd8cbb4 }), 0.35, 1.4, 0.22),
  tiles: pbr(PBR.tiles),
  water: std({ color: 0x0d1d24, normalMap: PBR.water.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.05, metalness: 0.1, envMapIntensity: 1.3 }),
  fence: std({ map: TEX.fence, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x9ba1a6, metalness: 0.6, roughness: 0.45 }),
  shed: weathered(pbr(containerSet(0x8d9399), { metalness: 0.4 }), 0.25, 1.2, 0.1),
  white: pbr(PBR.metal, { color: 0xe8e4d8, metalness: 0.25 }),
  crane: pbr(PBR.metal, { color: 0xd9962e, metalness: 0.35 }),
  hull: pbr(PBR.metal, { color: 0x2a3036, metalness: 0.3 }),
  hullRed: pbr(PBR.metal, { color: 0x7a2a22, metalness: 0.3 }),
  pine: std({ color: 0x2c3d26, roughness: 1, flatShading: true }),
  leafy: std({ color: 0x4a5e2c, roughness: 1, flatShading: true }),
  bark: std({ color: 0x4a3a2c, roughness: 1 }),
  cityLights: std({ color: 0x2a2c30, roughness: 0.9, emissive: 0xffffff, emissiveMap: TEX.windows, emissiveIntensity: 0.05 }),
  cloth: [0x9a3a2e, 0x2e5f6a, 0xc09a3a, 0x5a6e3a].map((c) => std({ color: c, roughness: 0.95, side: THREE.DoubleSide })),
  hay: std({ color: 0xc2a25a, roughness: 1 }),
  ruinGrey: weathered(pbr(PBR.concrete, { color: 0xa9a59d }), 0.45, 2.2, 0.25),
  ruinPale: weathered(pbr(PBR.concrete, { color: 0xcfc4b0 }), 0.45, 2.2, 0.25),
  ruinDark: weathered(pbr(PBR.concrete, { color: 0x77736c }), 0.4, 2.0, 0.2),
  skyline: std({ color: 0x5e5a56, roughness: 1 }),
  lightPool: new THREE.MeshBasicMaterial({ map: TEX.puff, color: 0xffb868, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
});

// ---------------------------------------------------------------- world geometry and colliders
// Each map builds into WORLD so switching operations can tear the whole thing down.
let WORLD = new THREE.Group();
scene.add(WORLD);
const MAP_LIGHTS = [];
let fireLights = [];
const colliders = [];
function addCollider(x0, y0, z0, x1, y1, z1, surf = 'stone') { const c = { x0, y0, z0, x1, y1, z1, surf }; colliders.push(c); return c; }
const SURF = new Map();
const surfOf = (mat) => SURF.get(Array.isArray(mat) ? mat[0] : mat) || 'stone';
function boxGeo(w, h, d, tile = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) {
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  }
  return g;
}
const aoRects = [];
function addAO(x0, z0, x1, z1, strength = 0.55) { aoRects.push([x0, z0, x1, z1, strength]); }
function addBox(x, y, z, w, h, d, mat, { tile = 0, collide = true, shadow = true, ao = true } = {}) {
  if (ao && y < 0.25 && h > 0.3) addAO(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  const m = new THREE.Mesh(boxGeo(w, h, d, tile), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = shadow; m.receiveShadow = true;
  WORLD.add(m);
  if (collide) addCollider(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, surfOf(mat));
  return m;
}
function circleHitsBox(x, z, r, b) { return x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1; }
function areaFree(x, z, r) { for (const b of colliders) if (circleHitsBox(x, z, r, b)) return false; return true; }

const HALF = 62;
const radarRoads = [];
const MARKSMAN_SPOTS = [];
const SPAWNS = [];
const FIRES = [];
const PLAYER_START = new V3(5, 0, 12);

const roadMats = [];
function road(cx, cz, len, width, alongX, set = PBR.road, tile = width) {
  const [tex, nrm, rgh] = [set.map, set.normalMap, set.roughnessMap].map((t) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(len / tile, width / tile); return c; });
  const rm = std({ map: tex, normalMap: nrm, roughnessMap: rgh, roughness: 1 }); roadMats.push(rm);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), rm);
  m.rotation.set(-Math.PI / 2, 0, alongX ? 0 : Math.PI / 2);
  m.position.set(cx, 0.02, cz);
  m.receiveShadow = true;
  WORLD.add(m);
  radarRoads.push(alongX ? [cx - len / 2, cz - width / 2, len, width] : [cx - width / 2, cz - len / 2, width, len]);
}
function building(cx, cz, w, d, h, wallMat, { marksman = null } = {}) {
  addBox(cx, 0, cz, w, h, d, [wallMat, wallMat, MAT.roof, MAT.roof, wallMat, wallMat], { tile: 3 });
  const t = 0.35, ph = 0.95;
  addBox(cx, h, cz - d / 2 + t / 2, w, ph, t, MAT.concrete, { tile: 3 });
  addBox(cx, h, cz + d / 2 - t / 2, w, ph, t, MAT.concrete, { tile: 3 });
  addBox(cx - w / 2 + t / 2, h, cz, t, ph, d - 2 * t, MAT.concrete, { tile: 3 });
  addBox(cx + w / 2 - t / 2, h, cz, t, ph, d - 2 * t, MAT.concrete, { tile: 3 });
  addBox(cx + w * 0.22, h, cz - d * 0.18, 1.5, 1.0, 1.1, MAT.metal);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 14), MAT.metal);
  tank.position.set(cx - w * 0.25, h + 0.7, cz + d * 0.2); tank.castShadow = true; WORLD.add(tank);
  addBox(cx - w * 0.2, 0, cz + d / 2 + 0.09, 1.5, 2.4, 0.08, MAT.door, { collide: false, shadow: false, ao: false });
  addBox(cx + w * 0.3, 0, cz - d / 2 - 0.09, 1.5, 2.4, 0.08, MAT.door, { collide: false, shadow: false, ao: false });
  const awn = addBox(cx - w * 0.2, 2.6, cz + d / 2 + 0.7, 2.4, 0.08, 1.4, std({ color: [0x7a2e26, 0x2e5a55, 0x8a6a2a][Math.floor(srand() * 3)], roughness: 0.9 }), { collide: false });
  awn.rotation.x = 0.18;
  addBox(cx, 0, cz, w + 0.14, 0.5, d + 0.14, MAT.perimeter, { tile: 3, collide: false, ao: false });
  addBox(cx, h - 0.32, cz, w + 0.34, 0.3, d + 0.34, MAT.concrete, { tile: 3, collide: false, ao: false });
  addBox(cx, h + ph, cz - d / 2 + t / 2, w + 0.1, 0.1, t + 0.12, MAT.barrier, { tile: 3, collide: false });
  addBox(cx, h + ph, cz + d / 2 - t / 2, w + 0.1, 0.1, t + 0.12, MAT.barrier, { tile: 3, collide: false });
  if (h >= 8) {
    for (const [fy, fx] of [[3.1, 0.22], [6.1, -0.18]]) {
      const bx = cx + w * fx, bz = cz + d / 2 + 0.55;
      addBox(bx, fy, bz, 2.8, 0.16, 1.1, MAT.concrete, { tile: 3 });
      addBox(bx, fy + 0.16, bz + 0.5, 2.8, 0.85, 0.08, MAT.concrete, { tile: 3 });
      for (const sx of [-1.36, 1.36]) addBox(bx + sx, fy + 0.16, bz, 0.08, 0.85, 1.0, MAT.concrete, { collide: false });
    }
  }
  for (let i = 0; i < 3; i++) {
    const side = Math.floor(srand() * 2) ? 1 : -1, along = srange(-0.35, 0.35), ay = Math.min(h - 1.5, srange(2.6, 7));
    if (srand() < 0.5) addBox(cx + side * (w / 2 + 0.22), ay, cz + along * d, 0.44, 0.55, 0.85, MAT.metal, { collide: false });
    else addBox(cx + along * w, ay, cz + side * (d / 2 + 0.22), 0.85, 0.55, 0.44, MAT.metal, { collide: false });
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 6, 0, Math.PI * 2, 0, 0.9), MAT.metal);
  dish.position.set(cx - w * 0.3, h + 1.1, cz - d * 0.25); dish.rotation.set(-0.9, srange(0, 6), 0); dish.castShadow = true; WORLD.add(dish);
  if (marksman) MARKSMAN_SPOTS.push({ pos: new V3(marksman[0], h, marksman[1]), used: false });
}
function wallSeg(x0, z0, x1, z1, h = 2.4) {
  const t = 0.4;
  if (x0 === x1) addBox(x0, 0, (z0 + z1) / 2, t, h, Math.abs(z1 - z0), MAT.concrete, { tile: 3 });
  else addBox((x0 + x1) / 2, 0, z0, Math.abs(x1 - x0), h, t, MAT.concrete, { tile: 3 });
}
function container(x, z, rot, mi, y = 0) {
  const w = 2.44, h = 2.6, d = 6.06;
  addBox(x, y, z, rot ? d : w, h, rot ? w : d, containerMats[mi % containerMats.length], { tile: 2.6 });
}
function crate(x, z, y = 0, s = 1.1) { addBox(x, y, z, s, s, s, MAT.crate); }
function barrel(x, z, mi) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.0, 14), barrelMats[mi % barrelMats.length]);
  m.position.set(x, 0.5, z); m.castShadow = m.receiveShadow = true; WORLD.add(m);
  addCollider(x - 0.34, 0, z - 0.34, x + 0.34, 1.0, z + 0.34, 'metal');
  addAO(x - 0.34, z - 0.34, x + 0.34, z + 0.34, 0.5);
}
function sandbags(x, z, len, alongX) { addBox(x, 0, z, alongX ? len : 0.8, 1.05, alongX ? 0.8 : len, MAT.sandbag, { tile: 1 }); }
function barrier(x, z, len, alongX) {
  addBox(x, 0, z, alongX ? len : 0.62, 0.35, alongX ? 0.62 : len, MAT.barrier, { tile: 1.5 });
  addBox(x, 0.35, z, alongX ? len : 0.3, 0.65, alongX ? 0.3 : len, MAT.barrier, { tile: 1.5, collide: false });
  addCollider(x - (alongX ? len / 2 : 0.15), 0.35, z - (alongX ? 0.15 : len / 2), x + (alongX ? len / 2 : 0.15), 1.0, z + (alongX ? 0.15 : len / 2));
}
function car(x, z, alongX, burning, mi = 0) {
  const L = 4.3, W = 1.85;
  const mat = burning ? MAT.burnt : carMats[mi % carMats.length];
  addBox(x, 0.2, z, alongX ? L : W, 0.8, alongX ? W : L, mat);
  const off = 0.3;
  addBox(x + (alongX ? -off : 0), 1.0, z + (alongX ? 0 : -off), alongX ? 2.1 : 1.6, 0.62, alongX ? 1.6 : 2.1, burning ? MAT.burnt : MAT.glass);
  const wg = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wm = new THREE.Mesh(wg, MAT.tire);
    wm.rotation.set(alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2);
    wm.position.set(x + (alongX ? sx * 1.35 : sz * 0.85), 0.34, z + (alongX ? sz * 0.85 : sx * 1.35));
    WORLD.add(wm);
  }
  if (burning) FIRES.push(new V3(x, 1.2, z));
}
const frondGeo = (() => {
  const g = new THREE.PlaneGeometry(1.1, 3.6, 1, 6);
  g.translate(0, 1.8, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 3.6; p.setZ(i, y * y * 1.7); }
  g.computeVertexNormals();
  return g;
})();
const crowns = [];
function palm(x, z, h = 7) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, h, 8), MAT.trunk);
  trunk.position.set(x, h / 2, z); trunk.castShadow = true; WORLD.add(trunk);
  const crown = new THREE.Group(); crown.position.set(x, h, z); WORLD.add(crown); crowns.push(crown);
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(frondGeo, MAT.leaf);
    f.rotation.order = 'YXZ';
    f.rotation.set(rand(0.9, 1.3), (i / 9) * Math.PI * 2 + rand(-0.2, 0.2), 0);
    f.castShadow = true; crown.add(f);
  }
  addCollider(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, 'wood');
  addAO(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0.4);
}
function lamp(x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 8), MAT.darkMetal);
  pole.position.set(x, 3.25, z); pole.castShadow = true; WORLD.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), MAT.lamp);
  head.position.set(x + (x > 0 ? -0.4 : 0.4), 6.45, z); WORLD.add(head);
  addCollider(x - 0.1, 0, z - 0.1, x + 0.1, 6.5, z + 0.1, 'metal');
}

function buildKessar() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), MAT.sand);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; WORLD.add(ground);

  road(0, 0, 124, 9, true);
  road(0, -25.25, 41.5, 9, false);
  road(0, 33.25, 57.5, 9, false);

  // Perimeter
  const ph = 4.6;
  addBox(0, 0, -HALF - 0.5, 2 * HALF + 2, ph, 1, MAT.perimeter, { tile: 4 });
  addBox(0, 0, HALF + 0.5, 2 * HALF + 2, ph, 1, MAT.perimeter, { tile: 4 });
  addBox(-HALF - 0.5, 0, 0, 1, ph, 2 * HALF, MAT.perimeter, { tile: 4 });
  addBox(HALF + 0.5, 0, 0, 1, ph, 2 * HALF, MAT.perimeter, { tile: 4 });
  for (let i = -HALF; i <= HALF; i += 8) {
    for (const [x, z] of [[i, -HALF - 0.5], [i, HALF + 0.5], [-HALF - 0.5, i], [HALF + 0.5, i]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.3, 5.2, 1.3), MAT.perimeter); post.position.set(x, 2.6, z); post.castShadow = true; WORLD.add(post);
    }
  }

  // Buildings
  building(-31, -26, 16, 10, 9, MAT.wallTan, { marksman: [-31, -22] });
  building(30, -29, 12, 12, 6, MAT.wallGrey);
  building(-33, 30, 14, 12, 6, MAT.wallOchre);
  building(-21, 38, 6, 8, 3.6, MAT.wallTan);
  building(32, 28, 18, 10, 9, MAT.wallOchre, { marksman: [30, 24] });
  building(-13, -41, 6, 6, 3.6, MAT.wallGrey);
  building(14, 45, 7, 5, 3.6, MAT.wallTan);
  building(-51, 12, 6, 8, 3.6, MAT.wallGrey);
  building(50, 44, 8, 8, 6, MAT.wallTan);
  // Warehouse
  addBox(0, 0, -53, 26, 9, 10, [MAT.perimeter, MAT.perimeter, MAT.roof, MAT.roof, containerMats[4], MAT.perimeter], { tile: 3 });
  addBox(0, 0, -47.9, 8, 5, 0.2, MAT.darkMetal, { collide: false });
  // Watch tower
  addBox(48, 0, -8, 4.5, 12, 4.5, MAT.concrete, { tile: 3 });
  addBox(48, 12, -8, 5.6, 0.3, 5.6, MAT.concrete);
  for (const [dx, dz, w, d] of [[0, -2.65, 5.6, 0.3], [0, 2.65, 5.6, 0.3], [-2.65, 0, 0.3, 5.0], [2.65, 0, 0.3, 5.0]]) addBox(48 + dx, 12.3, -8 + dz, w, 1.0, d, MAT.concrete);
  addBox(48, 14.6, -8, 5.8, 0.25, 5.8, MAT.darkMetal, { collide: false });
  for (const [dx, dz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) addBox(48 + dx, 12.3, -8 + dz, 0.2, 2.3, 0.2, MAT.darkMetal, { collide: false });
  MARKSMAN_SPOTS.push({ pos: new V3(47, 12.3, -8), used: false });

  // Compound walls
  wallSeg(-42, -16, -35, -16); wallSeg(-27, -16, -20, -16); wallSeg(-20, -16, -20, -24);
  wallSeg(20, -20, 26, -20); wallSeg(36, -20, 40, -20); wallSeg(40, -20, 40, -38);
  wallSeg(-42, 20, -34, 20); wallSeg(-26, 20, -22, 20);
  wallSeg(20, 19, 27, 19); wallSeg(37, 19, 44, 19);

  // Central monument
  addBox(0, 0, 0, 5.5, 1.1, 5.5, MAT.concrete, { tile: 2 });
  addBox(0, 1.1, 0, 3.2, 1.0, 3.2, MAT.concrete, { tile: 2 });
  addBox(0, 2.1, 0, 1.1, 4.2, 1.1, MAT.barrier, { tile: 2 });
  const cap = addBox(0.35, 6.3, 0.1, 1.4, 0.6, 1.4, MAT.barrier, { collide: false });
  cap.rotation.set(0.2, 0.4, 0.3);

  // Containers
  container(17, -39, false, 0); container(20, -39, false, 1); container(17, -39, false, 2, 2.6);
  container(44, -46, true, 3); container(12, -18, true, 4);
  container(-18, 15, false, 1); container(-46, -8, true, 0); container(-46, -8, true, 3, 2.6);
  container(-9, -22, false, 2); container(21, 13, true, 0); container(44, 13, false, 3);
  container(-50, 46, true, 4); container(-8, 52, true, 1);

  // Vehicles
  car(-11, 2.2, true, false, 0); car(15, -2.4, true, false, 1); car(4, 22, false, true); car(-3, -30, false, true);
  car(-36, 3, true, false, 2); car(38, -2, true, true);

  // Cover
  sandbags(-5.5, 6.5, 3.2, true); sandbags(6, -6.8, 3.2, true); sandbags(7.5, 5, 3, false); sandbags(-7.5, -5, 3, false);
  sandbags(-24, -12, 3, true); sandbags(26, 8, 3, true); sandbags(-16, 26, 3, false); sandbags(12, 30, 3, true);
  sandbags(40, -26, 3, false); sandbags(-40, -34, 3, true);
  barrier(-24, -5.5, 3, true); barrier(-30, 5.5, 3, true); barrier(24, 5.5, 3, true); barrier(30, -5.5, 3, true);
  barrier(5.5, -16, 3, false); barrier(-5.5, 18, 3, false); barrier(-5.5, 40, 3, false); barrier(5.5, -36, 3, false);
  barrier(46, 5.5, 3, true); barrier(-48, -5.5, 3, true);

  // Palms and lamps
  for (const [x, z, h] of [[-7.5, -13, 7], [7.5, -19, 8], [-7.5, 22, 6.5], [7.5, 36, 7.5], [-20, -7.5, 7], [22, 7.5, 8], [-42, 7.5, 6.5], [40, -7.5, 7.5], [-26, 46, 7], [52, 30, 6.5]]) palm(x, z, h);
  for (const [x, z] of [[-6, -7], [6, 8], [-18, 6], [18, -6], [-40, -6], [40, 6], [6, -40], [-6, 50]]) lamp(x, z);

  // Scattered crates and barrels, seeded so the layout stays the same between runs
  let placed = 0, tries = 0;
  while (placed < 34 && tries < 800) {
    tries++;
    const x = srange(-HALF + 4, HALF - 4), z = srange(-HALF + 4, HALF - 4);
    if (Math.abs(x) < 5.5 && Math.abs(z) < 26) continue;
    if (Math.abs(z) < 5 && Math.abs(x) < 26) continue;
    if (Math.hypot(x - PLAYER_START.x, z - PLAYER_START.z) < 7) continue;
    if (!areaFree(x, z, 2.2)) continue;
    const kind = srand();
    if (kind < 0.45) {
      crate(x, z);
      if (srand() < 0.5) crate(x + 1.12, z);
      if (srand() < 0.4) crate(x + 0.4, z + 0.1, 1.1, 0.95);
    } else if (kind < 0.8) {
      const n = 1 + Math.floor(srand() * 3), mi = Math.floor(srand() * 3);
      for (let i = 0; i < n; i++) barrel(x + (i % 2) * 0.75, z + Math.floor(i / 2) * 0.75, mi);
    } else {
      sandbags(x, z, 2.6, srand() < 0.5);
    }
    placed++;
  }

  // Beyond the wall: town skyline and desert ridges
  const skyMats = [MAT.wallTan, MAT.wallGrey, MAT.wallOchre];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + srange(-0.05, 0.05), r = srange(78, 130);
    const w = srange(6, 16), h = Math.round(srange(1, 5)) * 3, d = srange(6, 14);
    const wm = skyMats[i % 3];
    const m = new THREE.Mesh(boxGeo(w, h, d, 3), [wm, wm, MAT.roof, MAT.roof, wm, wm]);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); m.rotation.y = srange(0, 3); WORLD.add(m);
  }
  buildCables();
}
// Enemy spawn points around the edge of the playable square, wherever there is room.
function buildSpawns() {
  const cand = [];
  for (let v = -54; v <= 54; v += 12) cand.push([v, -58], [v, 58], [-58, v], [58, v]);
  for (const [x, z] of cand) {
    let px = x, pz = z, ok = false;
    for (let k = 0; k < 12 && !ok; k++) {
      if (areaFree(px, pz, 0.9)) ok = true;
      else { px = x + rand(-4, 4); pz = z + rand(-4, 4); }
    }
    if (ok) SPAWNS.push(new V3(px, 0, pz));
  }
}
camera.layers.enable(NO_AO);

// One merged mesh of soft contact shadows: a nine-slice quad per object so the falloff width stays constant.
function buildAOMesh() {
  const pos = [], uv = [], idx = [], col = [];
  for (const [x0, z0, x1, z1, k] of aoRects) {
    const m = clamp(Math.min(x1 - x0, z1 - z0) * 0.45 + 0.35, 0.45, 1.6);
    const xs = [x0 - m, x0 + 0.02, x1 - 0.02, x1 + m], zs = [z0 - m, z0 + 0.02, z1 - 0.02, z1 + m], us = [0, 0.5, 0.5, 1];
    const base = pos.length / 3;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { pos.push(xs[i], 0.035, zs[j]); uv.push(us[i], us[j]); col.push(k, k, k); }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const a = base + j * 4 + i; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: TEX.ao } }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: 'attribute vec3 color; varying vec2 vUv; varying float vK; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vK = color.r * exp(-length(mv.xyz) * 0.012); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying float vK; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(map, vUv).a * vK); }',
  });
  const m = noAO(new THREE.Mesh(g, mat)); m.renderOrder = 1; WORLD.add(m);
}
function buildCables() {
  const mat = std({ color: 0x1d1b19, roughness: 0.8 });
  const pairs = [[[-23, 9.7, -21], [-5.6, 6.4, -7]], [[5.6, 6.4, 8], [23, 9.7, 23]], [[17.6, 6.4, -6], [24, 6.8, -23]], [[-17.6, 6.4, 6], [-26, 6.8, 24]], [[-39.6, 6.4, -6], [-39, 9.7, -21]], [[39.6, 6.4, 6], [41, 9.7, 23]]];
  for (const [a, b] of pairs) {
    for (let k = 0; k < 2; k++) {
      const A = new V3(...a).add(new V3(0, k * 0.25, 0)), Bp = new V3(...b).add(new V3(0, k * 0.25, 0));
      const mid = A.clone().lerp(Bp, 0.5); mid.y -= 1.3 + k * 0.2;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, Bp);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.018, 4), mat); m.castShadow = true; WORLD.add(m);
    }
  }
}
function buildRidges({ inner = 150, low = 0xb49a78, high = 0x7d6a58, scale = 1, start = 170 } = {}) {
  const g = new THREE.RingGeometry(inner, 620, 360, 30).rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = [];
  const [a, b] = NZ, sand = new THREE.Color(low), rock = new THREE.Color(high), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    const u = x / 1400 + 0.5, v = z / 1400 + 0.5;
    const ridged = Math.pow(ridge(a(u, v, 6, 6, 5)), 2.2), broad = b(u, v, 3, 3, 4);
    const h = (ridged * 70 + broad * 55) * scale * sstep(start, start + 130, r) - 4;
    pos.setY(i, h);
    c.copy(sand).lerp(rock, sstep(12, 45, h) * (0.6 + ridged * 0.4));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  WORLD.add(new THREE.Mesh(g, std({ vertexColors: true, roughness: 1 })));
}
function onRoad(x, z) { for (const r of radarRoads) if (x > r[0] && x < r[0] + r[2] && z > r[1] && z < r[1] + r[3]) return true; return false; }
const grassUniforms = { uTime: { value: 0 } };
function buildGroundCover({ grass: gDensity = 1, tint = 0xffffff, rocks: rockN = 420, rockTint = 0xc9b395 } = {}) {
  // Grass tufts: three crossed cards per tuft, lit as if their normals point up, swaying in the wind.
  const planes = [];
  for (let i = 0; i < 3; i++) { const p = new THREE.PlaneGeometry(0.75, 0.55).translate(0, 0.27, 0).rotateY((i / 3) * Math.PI); planes.push(p); }
  const pos = [], uv = [], nrm = [], idx = [];
  for (const p of planes) {
    const b = pos.length / 3;
    pos.push(...p.attributes.position.array); uv.push(...p.attributes.uv.array);
    for (let i = 0; i < p.attributes.position.count; i++) nrm.push(0, 1, 0);
    for (const i of p.index.array) idx.push(i + b);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); tg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); tg.setIndex(idx);
  const gm = std({ map: TEX.grass, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: tint });
  gm.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n  vec4 ip = instanceMatrix[3];\n  float wv = sin(uTime * 1.6 + ip.x * 0.35 + ip.z * 0.27) * 0.6 + sin(uTime * 3.3 + ip.x * 1.3) * 0.25;\n  transformed.x += wv * position.y * 0.22; transformed.z += wv * position.y * 0.12;');
  };
  const N = Math.round((HIGH() ? 2600 : 1200) * gDensity);
  const grass = new THREE.InstancedMesh(tg, gm, N);
  const dummy = new THREE.Object3D();
  let n = 0, guard = 0;
  while (n < N && guard++ < N * 8) {
    const cxz = [srange(-HALF + 1, HALF - 1), srange(-HALF + 1, HALF - 1)];
    const cluster = 3 + Math.floor(srand() * 8);
    for (let k = 0; k < cluster && n < N; k++) {
      const x = cxz[0] + srange(-1.8, 1.8), z = cxz[1] + srange(-1.8, 1.8);
      if (Math.abs(x) > HALF - 0.5 || Math.abs(z) > HALF - 0.5 || onRoad(x, z) || !areaFree(x, z, 0.3)) continue;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, srange(0, 6.28), 0);
      const sc = srange(0.6, 1.5); dummy.scale.set(sc, sc * srange(0.7, 1.3), sc);
      dummy.updateMatrix(); grass.setMatrixAt(n++, dummy.matrix);
    }
  }
  grass.count = n; grass.receiveShadow = true; noAO(grass); if (n) WORLD.add(grass);
  // Rocks and rubble
  const rg = new THREE.IcosahedronGeometry(0.22, 2);
  { const p = rg.attributes.position, [na] = NZ; for (let i = 0; i < p.count; i++) { const v = new V3().fromBufferAttribute(p, i); const k = 0.75 + na(v.x * 2 + 0.5, v.z * 2 + 0.5 + v.y, 4, 4, 3) * 0.5; p.setXYZ(i, v.x * k, v.y * k, v.z * k); } rg.computeVertexNormals(); }
  const rocks = new THREE.InstancedMesh(rg, pbr(PBR.concrete, { color: rockTint }), Math.max(1, rockN));
  let r = 0;
  for (let i = 0; i < rockN * 3 && r < rockN; i++) {
    const x = srange(-HALF + 1, HALF - 1), z = srange(-HALF + 1, HALF - 1);
    if (!areaFree(x, z, 0.2)) continue;
    const big = srand() < 0.12;
    dummy.position.set(x, 0.02, z); dummy.rotation.set(srange(0, 3), srange(0, 3), srange(0, 3));
    const sc = big ? srange(1.6, 2.6) : srange(0.3, 1.1); dummy.scale.set(sc, sc * srange(0.4, 0.8), sc);
    dummy.updateMatrix(); rocks.setMatrixAt(r++, dummy.matrix);
  }
  rocks.count = r; rocks.castShadow = true; rocks.receiveShadow = true; WORLD.add(rocks);
}

// ---------------------------------------------------------------- map building helpers
const SMOKE_COLUMNS = [];
function mesh(geo, mat, x, y, z, { cast = true, parent = WORLD } = {}) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
function groundPlane(mat, { size = 600, cx = 0, cz = 0, w = size, d = size } = {}) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  g.rotation.x = -Math.PI / 2; g.position.set(cx, 0, cz); g.receiveShadow = true; WORLD.add(g); return g;
}
function paved(cx, cz, w, d, mat, tile = 3, y = 0.012) {
  const g = new THREE.PlaneGeometry(w, d), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
  const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(cx, y, cz); m.receiveShadow = true; WORLD.add(m);
  radarRoads.push([cx - w / 2, cz - d / 2, w, d]);
  return m;
}
function fence(x0, z0, x1, z1, h = 3) {
  const alongX = z0 === z1, len = Math.abs(alongX ? x1 - x0 : z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const g = new THREE.PlaneGeometry(len, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.2, uv.getY(i) * h / 1.2);
  const m = new THREE.Mesh(g, MAT.fence); m.position.set(cx, h / 2, cz); if (!alongX) m.rotation.y = Math.PI / 2; m.castShadow = true; WORLD.add(m);
  for (let t = 0; t <= len; t += 3) mesh(new THREE.CylinderGeometry(0.05, 0.05, h + 0.3, 6), MAT.darkMetal, alongX ? Math.min(x0, x1) + t : cx, (h + 0.3) / 2, alongX ? cz : Math.min(z0, z1) + t);
  addCollider(alongX ? Math.min(x0, x1) : cx - 0.1, 0, alongX ? cz - 0.1 : Math.min(z0, z1), alongX ? Math.max(x0, x1) : cx + 0.1, h, alongX ? cz + 0.1 : Math.max(z0, z1), 'metal');
}
function tWalls(x0, z0, x1, z1, h = 3.6) {
  const alongX = z0 === z1, len = Math.abs(alongX ? x1 - x0 : z1 - z0), n = Math.max(1, Math.round(len / 1.5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t);
    addBox(x, 0, z, alongX ? 1.46 : 1.1, 0.5, alongX ? 1.1 : 1.46, MAT.barrier, { collide: false });
    addBox(x, 0.5, z, alongX ? 1.46 : 0.3, h - 0.5, alongX ? 0.3 : 1.46, MAT.barrier, { tile: 1.5, collide: false });
  }
  addCollider(Math.min(x0, x1) - (alongX ? 0 : 0.2), 0, Math.min(z0, z1) - (alongX ? 0.2 : 0), Math.max(x0, x1) + (alongX ? 0 : 0.2), h, Math.max(z0, z1) + (alongX ? 0.2 : 0));
}
function cylinderProp(x, z, r, h, mat, { y = 0, surf = 'metal', seg = 20 } = {}) {
  mesh(new THREE.CylinderGeometry(r, r, h, seg), mat, x, y + h / 2, z);
  addCollider(x - r * 0.9, y, z - r * 0.9, x + r * 0.9, y + h, z + r * 0.9, surf);
  if (y < 0.25) addAO(x - r, z - r, x + r, z + r, 0.5);
}
function gableHouse(cx, cz, w, d, h, wallMat, { door = true } = {}) {
  addBox(cx, 0, cz, w, h, d, [wallMat, wallMat, MAT.roof, MAT.roof, wallMat, wallMat], { tile: 3 });
  const alongX = w >= d, span = alongX ? d : w, rh = span * 0.42;
  const roof = new THREE.Mesh(new THREE.BufferGeometry(), MAT.tiles);
  const L = (alongX ? w : d) + 0.6, S = span / 2 + 0.35;
  const v = alongX
    ? [[-L / 2, 0, -S], [L / 2, 0, -S], [L / 2, rh, 0], [-L / 2, rh, 0], [-L / 2, 0, S], [L / 2, 0, S]]
    : [[-S, 0, -L / 2], [-S, 0, L / 2], [0, rh, L / 2], [0, rh, -L / 2], [S, 0, -L / 2], [S, 0, L / 2]];
  const pos = [], uv = [];
  const quad = (a, b, c, d2, uw, uh) => { for (const [p, t] of [[a, [0, 0]], [b, [uw, 0]], [c, [uw, uh]], [a, [0, 0]], [c, [uw, uh]], [d2, [0, uh]]]) { pos.push(...p); uv.push(...t); } };
  const tl = L / 1.5, th = Math.hypot(S, rh) / 1.5;
  if (alongX) { quad(v[0], v[1], v[2], v[3], tl, th); quad(v[5], v[4], v[3], v[2], tl, th); }
  else { quad(v[1], v[0], v[3], v[2], tl, th); quad(v[4], v[5], v[2], v[3], tl, th); }
  roof.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roof.geometry.computeVertexNormals();
  roof.material = MAT.tiles; roof.position.set(cx, h, cz); roof.castShadow = true; roof.receiveShadow = true; roof.material.side = THREE.DoubleSide;
  WORLD.add(roof);
  const gable = new THREE.BufferGeometry(), gp = [];
  for (const sgn of [-1, 1]) {
    if (alongX) gp.push(sgn * w / 2, 0, -d / 2, sgn * w / 2, 0, d / 2, sgn * w / 2, rh * 0.95, 0);
    else gp.push(-w / 2, 0, sgn * d / 2, w / 2, 0, sgn * d / 2, 0, rh * 0.95, sgn * d / 2);
  }
  gable.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gable.computeVertexNormals();
  const gm = mesh(gable, wallMat, cx, h, cz); gm.material = wallMat.clone(); gm.material.side = THREE.DoubleSide; gm.material.map = null; gm.material.normalMap = null; gm.material.roughnessMap = null;
  if (door) { if (alongX) addBox(cx - w * 0.2, 0, cz + d / 2 + 0.06, 1.3, 2.2, 0.08, MAT.door, { collide: false, shadow: false, ao: false }); else addBox(cx + w / 2 + 0.06, 0, cz - d * 0.2, 0.08, 2.2, 1.3, MAT.door, { collide: false, shadow: false, ao: false }); }
}
function flatHouse(cx, cz, w, d, h, wallMat) {
  addBox(cx, 0, cz, w, h, d, [wallMat, wallMat, MAT.roof, MAT.roof, wallMat, wallMat], { tile: 3 });
  const t = 0.3;
  addBox(cx, h, cz - d / 2 + t / 2, w, 0.7, t, wallMat, { tile: 3 }); addBox(cx, h, cz + d / 2 - t / 2, w, 0.7, t, wallMat, { tile: 3 });
  addBox(cx - w / 2 + t / 2, h, cz, t, 0.7, d - 2 * t, wallMat, { tile: 3 }); addBox(cx + w / 2 - t / 2, h, cz, t, 0.7, d - 2 * t, wallMat, { tile: 3 });
  addBox(cx + w * 0.15, 0, cz + d / 2 + 0.06, 1.3, 2.2, 0.08, MAT.door, { collide: false, shadow: false, ao: false });
}
function pine(x, z, h = 9, cypress = false) {
  mesh(new THREE.CylinderGeometry(0.12, 0.22, h * 0.35, 6), MAT.bark, x, h * 0.175, z);
  const tiers = cypress ? 1 : 4;
  for (let i = 0; i < tiers; i++) {
    const r = cypress ? h * 0.12 : h * (0.32 - i * 0.06), th = cypress ? h * 0.85 : h * 0.42;
    mesh(new THREE.ConeGeometry(r, th, 7), MAT.pine, x, (cypress ? h * 0.55 : h * (0.38 + i * 0.17)), z).rotation.y = srand() * 3;
  }
  addCollider(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, 'wood');
  addAO(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0.45);
}
function leafyTree(x, z, h = 6) {
  mesh(new THREE.CylinderGeometry(0.15, 0.25, h * 0.6, 7), MAT.bark, x, h * 0.3, z);
  for (let i = 0; i < 4; i++) mesh(new THREE.IcosahedronGeometry(h * srange(0.2, 0.28), 1), MAT.leafy, x + srange(-1, 1), h * srange(0.6, 0.85), z + srange(-1, 1));
  addCollider(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, 'wood');
  addAO(x - 1, z - 1, x + 1, z + 1, 0.4);
}
function floodlight(x, z, h = 14, light = false, color = 0xffb868) {
  mesh(new THREE.CylinderGeometry(0.16, 0.24, h, 8), MAT.darkMetal, x, h / 2, z);
  mesh(new THREE.BoxGeometry(2.2, 0.5, 0.6), MAT.darkMetal, x, h, z);
  for (const dx of [-0.7, 0, 0.7]) mesh(new THREE.BoxGeometry(0.5, 0.35, 0.12), MAT.lamp, x + dx, h - 0.1, z + 0.32, { cast: false });
  addCollider(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, 'metal');
  if (light) MAP_LIGHTS.push({ pos: new V3(x, h - 1, z + 1.5), color, intensity: 900, distance: 55, flicker: false });
  const pool = mesh(new THREE.PlaneGeometry(26, 26), MAT.lightPool, x, 0.06, z + 4, { cast: false });
  pool.rotation.x = -Math.PI / 2; pool.receiveShadow = false; noAO(pool);
}
function truck(x, z, alongX, tanker = false, mat = carMats[1]) {
  const L = 8, W = 2.5, fx = alongX ? 1 : 0, fz = alongX ? 0 : 1;
  addBox(x - fx * 2.9, 0.5, z - fz * 2.9, alongX ? 2.2 : W, 2.3, alongX ? W : 2.2, mat);
  addBox(x - fx * 3.0, 1.7, z - fz * 3.0, alongX ? 1.4 : W - 0.1, 0.8, alongX ? W - 0.1 : 1.4, MAT.glass, { collide: false });
  addBox(x + fx * 1.1, 0.5, z + fz * 1.1, alongX ? 5.6 : W, 0.4, alongX ? W : 5.6, MAT.darkMetal);
  if (tanker) {
    const t = mesh(new THREE.CylinderGeometry(1.15, 1.15, 5.4, 18), MAT.white, x + fx * 1.2, 2.1, z + fz * 1.2);
    t.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
    addCollider(x + fx * 1.2 - (alongX ? 2.7 : 1.15), 0.9, z + fz * 1.2 - (alongX ? 1.15 : 2.7), x + fx * 1.2 + (alongX ? 2.7 : 1.15), 3.3, z + fz * 1.2 + (alongX ? 1.15 : 2.7), 'metal');
  } else addBox(x + fx * 1.1, 0.9, z + fz * 1.1, alongX ? 5.6 : W, 2.4, alongX ? W : 5.6, std({ color: 0x5c5f45, roughness: 0.95 }));
  const wg = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14);
  for (const along of [-3, 0.2, 2.6]) for (const side of [-1.1, 1.1]) {
    const w = mesh(wg, MAT.tire, x + fx * along + fz * side, 0.55, z + fz * along + fx * side);
    w.rotation.set(alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2);
  }
}
function hangar(cx, cz, w, d, h) {
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 32, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), MAT.shed);
  shell.scale.y = h / (w / 2); shell.position.set(cx, 0, cz); shell.castShadow = true; shell.receiveShadow = true; shell.material.side = THREE.DoubleSide; WORLD.add(shell);
  for (const [sz, door] of [[-d / 2, true], [d / 2, false]]) {
    const end = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 32, 0, Math.PI), MAT.shed);
    end.scale.y = h / (w / 2); end.position.set(cx, 0, cz + sz); if (sz > 0) end.rotation.y = Math.PI; end.castShadow = true; WORLD.add(end);
    if (door) {
      addBox(cx, 0, cz + sz - 0.08, w * 0.62, h * 0.72, 0.15, MAT.darkMetal, { collide: false, ao: false });
      for (let i = 1; i < 6; i++) addBox(cx, i * h * 0.12, cz + sz - 0.17, w * 0.62, 0.05, 0.04, MAT.metal, { collide: false, ao: false, shadow: false });
    }
  }
  addCollider(cx - w / 2 * 0.92, 0, cz - d / 2, cx + w / 2 * 0.92, h * 0.85, cz + d / 2, 'metal');
  addAO(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0.6);
}
function ruin(cx, cz, w, d, h, mat, { marksman = false } = {}) {
  const floors = Math.max(2, Math.round(h / 3)), base = Math.max(2, Math.floor(floors * srange(0.45, 0.7)));
  addBox(cx, 0, cz, w, base * 3, d, [mat, mat, MAT.roof, MAT.roof, mat, mat], { tile: 3 });
  for (let f = 1; f <= base; f++) addBox(cx, f * 3 - 0.15, cz, w + 0.35, 0.25, d + 0.35, MAT.concrete, { collide: false, ao: false });
  let top = base * 3;
  for (let f = base; f < floors; f++) {
    for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (srand() < 0.3 + (f - base) * 0.18) continue;
      const cw = (w / 2) * srange(0.55, 1), cd = (d / 2) * srange(0.55, 1), ch = srand() < 0.35 ? srange(1, 3) : 3;
      addBox(cx + qx * (w / 2 - cw / 2), f * 3, cz + qz * (d / 2 - cd / 2), cw, ch, cd, [mat, mat, MAT.concrete, MAT.concrete, mat, mat], { tile: 3, ao: false });
      top = Math.max(top, f * 3 + ch);
    }
  }
  for (let k = 0; k < 4; k++) {
    const side = Math.floor(srand() * 4), fy = srange(1.5, base * 3 - 2.5), along = srange(-0.35, 0.35);
    const hw = srange(1.6, 3.2), hh = srange(1.2, 2.4), dark = std({ color: 0x0c0b0a, roughness: 1 });
    if (side < 2) addBox(cx + along * w, fy, cz + (side ? 1 : -1) * (d / 2 + 0.02), hw, hh, 0.12, dark, { collide: false, ao: false, shadow: false });
    else addBox(cx + (side === 2 ? 1 : -1) * (w / 2 + 0.02), fy, cz + along * d, 0.12, hh, hw, dark, { collide: false, ao: false, shadow: false });
  }
  const px = cx + (srand() < 0.5 ? -1 : 1) * (w / 2 + 1.6), pz = cz + srange(-d / 3, d / 3);
  rubble(px, pz, 2.6);
  if (marksman) MARKSMAN_SPOTS.push({ pos: new V3(cx, base * 3, cz), used: false });
}
const rubbleGeo = new THREE.DodecahedronGeometry(0.5, 0);
function rubble(x, z, r = 2) {
  for (let i = 0; i < 9; i++) {
    const m = mesh(rubbleGeo, MAT.concrete, x + srange(-r, r) * 0.7, srange(0, 0.5), z + srange(-r, r) * 0.7);
    m.scale.set(srange(0.6, 1.8), srange(0.4, 1.1), srange(0.6, 1.8)); m.rotation.set(srange(0, 3), srange(0, 3), srange(0, 3));
  }
  addCollider(x - r * 0.6, 0, z - r * 0.6, x + r * 0.6, 1.0, z + r * 0.6, 'stone');
  addAO(x - r, z - r, x + r, z + r, 0.45);
}
function bus(x, z, alongX) {
  const L = 11, W = 2.5;
  addBox(x, 0.4, z, alongX ? L : W, 2.6, alongX ? W : L, MAT.burnt);
  for (let i = 0; i < 7; i++) {
    const t = -L / 2 + 1 + i * 1.45;
    for (const s of [-1, 1]) addBox(x + (alongX ? t : s * (W / 2 + 0.01)), 1.6, z + (alongX ? s * (W / 2 + 0.01) : t), alongX ? 1.1 : 0.04, 0.9, alongX ? 0.04 : 1.1, std({ color: 0x050505, roughness: 1 }), { collide: false, ao: false, shadow: false });
  }
  FIRES.push(new V3(x, 2.2, z));
}
function tankWreck(x, z, rot = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; WORLD.add(g);
  const hull = mesh(new THREE.BoxGeometry(3.4, 1.2, 7), MAT.burnt, 0, 1.0, 0, { parent: g });
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.7, 0.9, 7.2), MAT.tire, s * 1.75, 0.6, 0, { parent: g });
  const tur = mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.9, 10), MAT.burnt, 0.2, 2.05, 0.6, { parent: g }); tur.rotation.y = 0.6;
  const gun = mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.5, 8), MAT.burnt, -0.7, 2.0, -2.4, { parent: g }); gun.rotation.set(Math.PI / 2 - 0.15, 0, 0.3);
  hull.rotation.z = 0.05;
  addCollider(x - 2.6, 0, z - 2.6, x + 2.6, 2.4, z + 2.6, 'metal');
  addAO(x - 3, z - 3, x + 3, z + 3, 0.6);
}
function crater(x, z, r) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24).rotateX(-Math.PI / 2), scorchMatWorld);
  m.position.set(x, 0.03, z); noAO(m); WORLD.add(m);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; const k = mesh(rubbleGeo, MAT.dirt, x + Math.cos(a) * r * 0.9, 0.1, z + Math.sin(a) * r * 0.9); k.scale.set(srange(0.5, 1.2), 0.35, srange(0.5, 1.2)); }
}
function crane(x, z) {
  const legs = [[-5, -28], [5, -28], [-5, -17], [5, -17]];
  for (const [dx, lz] of legs) { addBox(x + dx, 0, lz, 1, 22, 1, MAT.crane, { tile: 2 }); }
  addBox(x, 20, -22.5, 12, 2, 13, MAT.crane, { tile: 2 });
  addBox(x, 22, -34, 2.2, 1.6, 46, MAT.crane, { tile: 2, ao: false });
  addBox(x, 22, -12, 2.2, 1.4, 8, MAT.crane, { tile: 2, ao: false });
  addBox(x, 19, -16, 3, 2.4, 3, MAT.white, { ao: false });
  addBox(x, 22, -8.5, 3, 2, 2, MAT.concrete, { ao: false });
  const spreader = addBox(x, 12, -38, 2.6, 0.6, 6, MAT.crane, { collide: false, ao: false });
  for (const dz of [-2, 2]) WORLD.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(x, 22, -38 + dz), new V3(x, 12.6, -38 + dz)]), new THREE.LineBasicMaterial({ color: 0x222222 })));
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.flash, color: new THREE.Color(3, 0.3, 0.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  beacon.scale.setScalar(1.2); beacon.position.set(x, 24.2, -22.5); noAO(beacon); WORLD.add(beacon);
  MARKSMAN_SPOTS.push({ pos: new V3(x + 3.5, 22, -22.5), used: false });
  return spreader;
}
function ship(x0, x1, zc) {
  const L = x1 - x0, cx = (x0 + x1) / 2;
  addBox(cx, -3, zc, L, 3.2, 12, MAT.hullRed, { ao: false });
  addBox(cx, 0.2, zc, L, 3.6, 12, MAT.hull, { ao: false });
  addBox(cx + L / 2 - 1, 0.2, zc, 2, 4.4, 11, MAT.hull, { ao: false });
  addBox(x1 - 9, 3.8, zc, 10, 9, 11, MAT.white, { tile: 3, ao: false });
  addBox(x1 - 9, 12.8, zc, 12, 0.4, 12, MAT.white, { ao: false });
  for (let i = 0; i < 4; i++) addBox(x1 - 13.98 + i * 0.01, 9, zc - 4 + i * 2.6, 0.06, 1.2, 1.8, MAT.glass, { collide: false, ao: false });
  for (const fy of [5.2, 7.4]) addBox(x1 - 14.05, fy, zc, 0.06, 0.9, 10, MAT.cityLights, { collide: false, ao: false, shadow: false });
  for (let bx = x0 + 6; bx < x1 - 18; bx += 6.3) for (let k = 0; k < 2; k++) {
    const hgt = 1 + Math.floor(srand() * 3);
    for (let y = 0; y < hgt; y++) container(bx, zc - 2.8 + k * 5.6 - 1.4, true, Math.floor(srand() * 5), 3.8 + y * 2.6);
  }
  MARKSMAN_SPOTS.push({ pos: new V3(x1 - 9, 13.2, zc), used: false });
}
function farSkyline(rMin, rMax, n, hMin, hMax, mat) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + srange(-0.04, 0.04), r = srange(rMin, rMax);
    const w = srange(10, 22), h = srange(hMin, hMax), d = srange(10, 20);
    const m = new THREE.Mesh(boxGeo(w, h, d, 12), mat);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); m.rotation.y = srange(0, 3); WORLD.add(m);
  }
}
const scorchMatWorld = new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.85 });

// ---------------------------------------------------------------- maps
function buildAirbase() {
  groundPlane(MAT.sand);
  road(0, -22, 124, 16, true);
  for (let x = -54; x <= 54; x += 9) paved(x, -22, 4.5, 0.45, MAT.white, 1, 0.03);
  for (const sx of [-58, 58]) for (let i = -3; i <= 3; i++) paved(sx, -22 + i * 2, 3.5, 0.9, MAT.white, 1, 0.03);
  for (let x = -60; x <= 60; x += 8) for (const ez of [-30.4, -13.6]) addBox(x, 0, ez, 0.3, 0.25, 0.3, MAT.lamp, { collide: false, ao: false, shadow: false });
  road(30, 4, 36, 9, false);
  paved(0, 28, 112, 12, MAT.concrete, 6);
  hangar(-38, 46, 18, 18, 9); hangar(-10, 46, 18, 18, 9); hangar(18, 46, 18, 18, 9);
  // Control tower with a glass cab; a marksman watches from the roof.
  addBox(45, 0, 10, 5, 12, 5, MAT.concrete, { tile: 3 });
  addBox(45, 12, 10, 6.4, 3, 6.4, MAT.glass);
  addBox(45, 15, 10, 7, 0.35, 7, MAT.concrete);
  for (const [dx, dz, w, d] of [[0, -3.4, 7, 0.2], [0, 3.4, 7, 0.2], [-3.4, 0, 0.2, 7], [3.4, 0, 0.2, 7]]) addBox(45 + dx, 15.35, 10 + dz, w, 0.9, d, MAT.darkMetal, { ao: false });
  MARKSMAN_SPOTS.push({ pos: new V3(45, 15.35, 10), used: false });
  // Fuel farm behind a low berm
  for (const [x, z] of [[-45, -47], [-34, -47], [-45, -57]]) cylinderProp(x, z, 3.6, 5.5, MAT.white);
  MARKSMAN_SPOTS.push({ pos: new V3(-34, 5.5, -47), used: false });
  wallSeg(-52, -40, -40, -40, 1.2); wallSeg(-36, -40, -28, -40, 1.2); wallSeg(-28, -40, -28, -61, 1.2);
  // Radar dome on its plinth
  addBox(46, 0, -46, 6, 5, 6, MAT.concrete, { tile: 3 });
  mesh(new THREE.SphereGeometry(4, 28, 18), MAT.white, 46, 8.2, -46);
  addCollider(43, 5, -49, 49, 11.5, -43, 'metal');
  // Revetments for the launchers and parked jets
  tWalls(-47, 2, -37, 2); tWalls(-47, 10, -37, 10); tWalls(-48, 2, -48, 10);
  tWalls(5, -51, 15, -51); tWalls(4, -51, 4, -41); tWalls(16, -51, 16, -41);
  tWalls(46, 25, 56, 25); tWalls(46, 33, 56, 33);
  for (const [x, z, yaw] of [[-24, 28, Math.PI], [2, 28, Math.PI]]) {
    const j = buildJet(); scene.remove(j); WORLD.add(j);
    j.position.set(x, 2, z); j.rotation.y = yaw; j.scale.setScalar(0.8);
    j.traverse((o) => { if (o.isSprite) o.visible = false; if (o.isMesh) o.castShadow = true; });
    addCollider(x - 4.8, 0, z - 5.5, x + 4.8, 3, z + 5.5, 'metal');
    addAO(x - 3, z - 5, x + 3, z + 5, 0.5);
  }
  truck(-12, 18, true, true); truck(36, -6, false, true, carMats[0]); truck(-52, -30, false, false);
  for (const [x, z] of [[-30, -6], [-18, -36], [24, -38], [52, 2], [-56, 18], [30, 18]]) { barrel(x, z, 1); barrel(x + 0.75, z, 1); barrel(x, z + 0.75, 2); }
  for (const [x, z, l, ax] of [[-8, -4, 3, true], [10, 6, 3, false], [-26, 14, 3, true], [20, -4, 3, true]]) sandbags(x, z, l, ax);
  for (const [x, z] of [[-4, 12], [12, -6], [-34, 16], [40, -34]]) { crate(x, z); crate(x + 1.12, z); crate(x + 0.5, z, 1.1, 0.95); }
  for (const [x, z] of [[-56, 34], [56, 36], [-20, 10], [6, -4]]) floodlight(x, z, 12, false);
  fence(-62, -62, 62, -62); fence(-62, 62, 62, 62); fence(-62, -62, -62, 62); fence(62, -62, 62, 62);
}
function buildPort() {
  paved(0, 135, 600, 330, MAT.concrete, 6, 0.004);
  radarRoads.pop();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 700), MAT.water);
  water.rotation.x = -Math.PI / 2; water.position.set(0, -1.1, -380); water.receiveShadow = true; WORLD.add(water);
  addBox(0, -3, -30.5, 140, 3.1, 1, MAT.concrete, { tile: 3, ao: false });
  addCollider(-400, -6, -400, 400, 0.6, -30.05, 'water');
  for (let x = -60; x <= 60; x += 7) {
    cylinderProp(x, -29.4, 0.25, 0.7, MAT.darkMetal);
    const f = mesh(new THREE.TorusGeometry(0.45, 0.18, 8, 14), MAT.tire, x + 3.5, -0.8, -30.95); f.rotation.y = 0;
  }
  for (const z of [-27.5, -17.5]) paved(0, z, 124, 0.25, MAT.darkMetal, 1, 0.02);
  crane(-32, 0); crane(16, 0);
  ship(-24, 46, -40);
  road(0, 17, 124, 10, true);
  road(56, 40, 44, 8, false);
  // Container yard: stacked rows with aisles between them
  const keep = [[14, -10, 7], [-55, 55, 8], [54, 30, 8], [-20, -8, 4], [36, -6, 4]];
  for (const z of [-22, -12.5, -3, 6.5]) {
    for (let x = -56; x <= 52; x += 6.4) {
      if (Math.abs(x + 22) < 3 || Math.abs(x - 8) < 3 || Math.abs(x - 34) < 3) continue;
      if (keep.some(([kx, kz, r]) => Math.hypot(x - kx, z - kz) < r)) continue;
      if (srand() < 0.18) continue;
      for (const dz of [-1.3, 1.3]) {
        const hgt = 1 + Math.floor(srand() * (z < -15 ? 2 : 3));
        for (let y = 0; y < hgt; y++) container(x, z + dz, true, Math.floor(srand() * 5), y * 2.6);
      }
    }
  }
  // Warehouses and the harbour office
  for (const [cx, cz, w, d, h] of [[-38, 40, 30, 18, 11], [2, 40, 26, 18, 11], [40, 46, 20, 12, 9]]) {
    addBox(cx, 0, cz, w, h, d, [MAT.shed, MAT.shed, MAT.roof, MAT.roof, MAT.shed, MAT.shed], { tile: 2.6 });
    gableRoofOnly(cx, cz, w, d, h);
    for (let i = 0; i < 2; i++) addBox(cx - w * 0.25 + i * w * 0.5, 0, cz - d / 2 - 0.08, w * 0.3, h * 0.6, 0.1, MAT.darkMetal, { collide: false, ao: false });
  }
  building(40, 27, 12, 7, 6, MAT.wallGrey);
  floodlight(-44, -25, 16, true); floodlight(-4, -25, 16, true); floodlight(30, 4, 16, true);
  floodlight(-20, 26, 14); floodlight(20, 26, 14); floodlight(-50, 10, 14); floodlight(50, -26, 14); floodlight(-26, 2, 14); floodlight(6, 2, 14);
  for (const [x, z] of [[-12, 12], [24, 12], [-50, 14], [48, 12]]) { barrel(x, z, 0); barrel(x + 0.75, z, 2); }
  for (const [x, z] of [[-30, -8], [2, -20], [44, -16], [-50, -4]]) { crate(x, z); crate(x, z + 1.12); }
  truck(-28, 22, true, false, carMats[2]); truck(26, 22, true, false, carMats[1]);
  car(-6, 21, true, false, 0);
  fence(-62, -30, -62, 62); fence(62, -30, 62, 62); fence(-62, 62, 62, 62);
  farSkyline(320, 460, 40, 20, 70, MAT.cityLights);
}
function gableRoofOnly(cx, cz, w, d, h) {
  const alongX = w >= d, span = alongX ? d : w, rh = span * 0.22, L = (alongX ? w : d) + 0.4, S = span / 2 + 0.3;
  const pts = alongX ? [[-L / 2, 0, -S], [L / 2, 0, -S], [L / 2, rh, 0], [-L / 2, rh, 0], [-L / 2, 0, S], [L / 2, 0, S]]
    : [[-S, 0, -L / 2], [-S, 0, L / 2], [0, rh, L / 2], [0, rh, -L / 2], [S, 0, -L / 2], [S, 0, L / 2]];
  const idx = alongX ? [0, 1, 2, 0, 2, 3, 5, 4, 3, 5, 3, 2] : [1, 0, 3, 1, 3, 2, 4, 5, 2, 4, 2, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = mesh(g, MAT.darkMetal, cx, h, cz); m.material = MAT.roofMetal;
}
function buildVillage() {
  groundPlane(MAT.dirt);
  road(0, 0, 124, 6, true, PBR.cobble, 2);
  road(-26, -33.5, 57, 5, false, PBR.cobble, 2); road(-26, 33.5, 57, 5, false, PBR.cobble, 2);
  road(26, -33.5, 57, 5, false, PBR.cobble, 2); road(26, 33.5, 57, 5, false, PBR.cobble, 2);
  road(0, -30, 47, 4, true, PBR.cobble, 2);
  paved(0, 0, 16, 16, MAT.concrete, 2, 0.03);
  cylinderProp(0, 0, 1.8, 0.9, MAT.stone, { surf: 'stone' });
  mesh(new THREE.CylinderGeometry(0.25, 0.3, 2.2, 10), MAT.stone, 0, 1.1, 0);
  // Church with a bell tower that a marksman uses
  gableHouse(9, 14, 8, 12, 7, MAT.stone, { door: false });
  addBox(9, 0, 6.5, 4, 17, 4, MAT.stone, { tile: 3 });
  addBox(9, 17, 6.5, 4.6, 0.4, 4.6, MAT.stone);
  for (const [dx, dz] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]]) addBox(9 + dx, 17.4, 6.5 + dz, 0.4, 2.2, 0.4, MAT.stone, { ao: false });
  addBox(9, 19.6, 6.5, 4.8, 0.5, 4.8, MAT.tiles, { ao: false });
  MARKSMAN_SPOTS.push({ pos: new V3(9, 17.4, 6.5), used: false });
  // The Jackal's walled compound in the east block, with gates toward his convoy
  flatHouse(36, 28, 12, 9, 6.5, MAT.wallOchre);
  MARKSMAN_SPOTS.push({ pos: new V3(36, 6.5, 28), used: false });
  for (const [x0, z0, x1, z1] of [[24, 14, 46, 14], [24, 14, 24, 36], [24, 36, 39, 36], [46, 14, 46, 27]]) wallStone(x0, z0, x1, z1, 2.6);
  car(30, 18, true, false, 2); car(41, 18, true, false, 0);
  truck(55, 55, false, false, carMats[0]); car(52, 49, false, false, 1);
  // Houses filling the blocks between the lanes
  const avoid = [[0, 0, 11], [9, 10, 9], [35, 25, 15], [-56, -8, 6], [-50, -50, 9], [56, 56, 8]];
  for (let gx = -54; gx <= 54; gx += 12) for (let gz = -54; gz <= 54; gz += 12) {
    const x = gx + srange(-1.5, 1.5), z = gz + srange(-1.5, 1.5);
    if (avoid.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
    const w = srange(6, 9), d = srange(6, 9);
    let blocked = false;
    for (const r of radarRoads) if (x + w / 2 + 1 > r[0] && x - w / 2 - 1 < r[0] + r[2] && z + d / 2 + 1 > r[1] && z - d / 2 - 1 < r[1] + r[3]) blocked = true;
    if (blocked) continue;
    if (srand() < 0.15) { leafyTree(x, z, srange(5, 7)); continue; }
    const h = srand() < 0.4 ? srange(5.5, 7) : srange(3.2, 4.2);
    const wm = [MAT.stone, MAT.wallTan, MAT.stone, MAT.wallOchre][Math.floor(srand() * 4)];
    if (srand() < 0.55) gableHouse(x, z, w, d, h, wm); else flatHouse(x, z, w, d, h, wm);
    if (srand() < 0.35) wallStone(x - w / 2 - 2, z + d / 2 + 2, x + w / 2 + 2, z + d / 2 + 2, 1.1);
  }
  for (let i = 0; i < 70; i++) {
    const x = srange(-60, 60), z = srange(-60, 60);
    if (onRoad(x, z) || !areaFree(x, z, 1.4) || avoid.slice(0, 2).some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
    pine(x, z, srange(7, 12), srand() < 0.3);
  }
  for (const [x, z, c] of [[-8, -6, 0], [-8, 6, 1], [6, -8, 2]]) stall(x, z, c);
  for (const [x, z] of [[-14, 9], [16, -9], [-40, 9], [40, -8]]) { mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 14), MAT.hay, x, 0.6, z).rotation.z = Math.PI / 2; addCollider(x - 0.6, 0, z - 0.7, x + 0.6, 1.4, z + 0.7, 'wood'); }
  for (const [x, z] of [[-30, -6], [30, 6], [-20, 24], [20, -24]]) { barrel(x, z, 2); crate(x + 1, z); }
  wallStone(-62, -62, 62, -62, 3); wallStone(-62, 62, 62, 62, 3); wallStone(-62, -62, -62, 62, 3); wallStone(62, -62, 62, 50, 3);
  for (let i = 0; i < 90; i++) { const a = srange(0, 6.28), r = srange(70, 150); pine(Math.cos(a) * r, Math.sin(a) * r, srange(10, 18)); colliders.pop(); }
}
function wallStone(x0, z0, x1, z1, h) {
  const t = 0.55;
  if (x0 === x1) addBox(x0, 0, (z0 + z1) / 2, t, h, Math.abs(z1 - z0), MAT.stone, { tile: 3 });
  else addBox((x0 + x1) / 2, 0, z0, Math.abs(x1 - x0), h, t, MAT.stone, { tile: 3 });
}
function stall(x, z, c) {
  for (const [dx, dz] of [[-1.4, -1], [1.4, -1], [-1.4, 1], [1.4, 1]]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), MAT.bark, x + dx, 1.2, z + dz);
  const cloth = mesh(new THREE.PlaneGeometry(3.2, 2.6), MAT.cloth[c % MAT.cloth.length], x, 2.45, z); cloth.rotation.x = -Math.PI / 2 + 0.12;
  addBox(x, 0, z, 2.6, 0.9, 1.2, MAT.crate);
}
function buildCity() {
  groundPlane(MAT.asphalt);
  road(0, 0, 124, 12, true); road(0, -36, 48, 12, false); road(0, 36, 48, 12, false);
  for (const s of [-1, 1]) { paved(0, s * 7.5, 124, 3, MAT.concrete, 2, 0.05); paved(s * 7.5, -36, 3, 48, MAT.concrete, 2, 0.05); paved(s * 7.5, 36, 3, 48, MAT.concrete, 2, 0.05); }
  // Elevated highway along the north, with a collapsed span
  for (let x = -60; x <= 60; x += 12) {
    if (x > 2 && x < 22) continue;
    for (const z of [-38, -30]) addBox(x, 0, z, 1.6, 7, 1.6, MAT.concrete, { tile: 3 });
  }
  for (const [x0, x1] of [[-62, 4], [20, 62]]) {
    const cx = (x0 + x1) / 2, L = x1 - x0;
    addBox(cx, 7, -34, L, 1.1, 12, MAT.concrete, { tile: 3, ao: false });
    for (const z of [-39.8, -28.2]) addBox(cx, 8.1, z, L, 0.9, 0.4, MAT.barrier, { tile: 1.5, ao: false });
  }
  const slab = mesh(new THREE.BoxGeometry(17, 1.1, 12), MAT.concrete, 12, 3.6, -34); slab.rotation.z = -0.42;
  addCollider(4, 0, -40, 12, 6.5, -28, 'stone'); addCollider(12, 0, -40, 20, 3, -28, 'stone');
  rubble(19, -27, 3); rubble(6, -41, 2.5);
  // Ruined blocks in each quadrant
  ruin(-30, -18, 18, 12, 21, MAT.ruinGrey, { marksman: true }); ruin(-50, -52, 14, 10, 15, MAT.ruinPale); ruin(-22, -52, 16, 10, 12, MAT.ruinGrey);
  ruin(40, -18, 16, 12, 15, MAT.ruinPale); ruin(40, -52, 20, 10, 18, MAT.ruinGrey, { marksman: true });
  ruin(-28, 24, 20, 14, 24, MAT.ruinDark, { marksman: true }); ruin(-50, 48, 16, 14, 18, MAT.ruinGrey); ruin(-20, 50, 14, 12, 12, MAT.ruinPale);
  ruin(28, 24, 14, 12, 18, MAT.ruinGrey); ruin(48, 42, 16, 14, 21, MAT.ruinDark, { marksman: true }); ruin(22, 50, 14, 10, 15, MAT.ruinPale);
  bus(-2.6, -18, false); bus(-22, 2.6, true); bus(30, -3, true);
  tankWreck(-12, -3.5, 1.2);
  for (const [x, z, ax, burn] of [[16, 3, true, false], [-40, -2.5, true, true], [3, 26, false, false], [-3, 44, false, true], [46, 3, true, false]]) car(x, z, ax, burn, 1);
  for (const [x, z, r] of [[0, -10, 2.4], [-36, 6, 3], [22, -8, 2.2], [-6, 30, 2.6]]) crater(x, z, r);
  for (const [x, z, l, ax] of [[8, 6.5, 4, true], [16, 8, 3, false], [4, 16, 3, true], [-8, 8, 3, false], [10, -8, 3, true]]) sandbags(x, z, l, ax);
  for (const [x, z, l, ax] of [[-6, 16, 3, false], [18, 16, 3, true], [-16, -8, 3, true]]) barrier(x, z, l, ax);
  for (const [x, z] of [[-44, 14], [44, 14], [-12, 30], [14, -26]]) rubble(x, z, 2.4);
  for (const [x, z] of [[-9, -12], [9, 12], [-9, 24], [9, -24], [-24, -9], [24, 9]]) lamp(x, z);
  wallSeg(-62, -62, 62, -62, 4); wallSeg(-62, 62, 62, 62, 4); wallSeg(-62, -62, -62, 62, 4); wallSeg(62, -62, 62, 62, 4);
  farSkyline(170, 320, 30, 18, 60, MAT.skyline);
  SMOKE_COLUMNS.push(new V3(-140, 20, -160), new V3(170, 25, -60), new V3(60, 20, 190));
}
const MAPS = {
  kessar: { name: 'Kessar Compound', seed: 417, build: buildKessar, start: [5, 12], groundSurf: 'sand', ridges: {}, cover: {} },
  airbase: { name: 'Wadi Kesh Airfield', seed: 911, build: buildAirbase, start: [20, -57], groundSurf: 'sand', ridges: { inner: 160 }, cover: { grass: 0.45, rocks: 300 } },
  port: { name: 'Port Tamar', seed: 1207, build: buildPort, start: [-55, 55], groundSurf: 'stone', ridges: { inner: 260, low: 0x5a5448, high: 0x3c3a36, scale: 1.3, start: 280 }, cover: { grass: 0.12, tint: 0xa8a080, rocks: 60, rockTint: 0x8a8a86 } },
  village: { name: 'Shirin Dara', seed: 3301, build: buildVillage, start: [-56, -8], groundSurf: 'sand', ridges: { inner: 120, low: 0x4f5f3a, high: 0x5e5a52, scale: 1.9, start: 130 }, cover: { grass: 1.6, tint: 0x9cc06e, rocks: 240, rockTint: 0x9a968c } },
  city: { name: 'Haddar', seed: 5150, build: buildCity, start: [10, 20], groundSurf: 'stone', ridges: { inner: 240, low: 0x8a7a66, high: 0x6a5e52, start: 260 }, cover: { grass: 0.25, tint: 0xc8bc8c, rocks: 520, rockTint: 0x9a948a } },
};
let mapName = null, curMap = MAPS.kessar;
function clearWorld() {
  scene.remove(WORLD);
  WORLD.traverse((o) => { if (o.geometry && o.geometry !== frondGeo && o.geometry !== rubbleGeo) o.geometry.dispose(); });
  WORLD = new THREE.Group(); scene.add(WORLD);
  colliders.length = 0; aoRects.length = 0; radarRoads.length = 0; MARKSMAN_SPOTS.length = 0; SPAWNS.length = 0; FIRES.length = 0; crowns.length = 0; MAP_LIGHTS.length = 0; SMOKE_COLUMNS.length = 0;
  for (const m of roadMats) { m.map.dispose(); m.normalMap.dispose(); m.roughnessMap.dispose(); m.dispose(); }
  roadMats.length = 0;
}
function loadMap(name) {
  if (name === mapName) return false;
  clearWorld();
  mapName = name; curMap = MAPS[name];
  srand = mulberry32(curMap.seed);
  PLAYER_START.set(curMap.start[0], 0, curMap.start[1]);
  curMap.build();
  if (curMap.ridges) buildRidges(curMap.ridges);
  buildAOMesh();
  buildGroundCover(curMap.cover);
  buildSpawns();
  for (const c of crowns) c.traverse(noAO);
  placeMapLights();
  return true;
}
SURF.set(MAT.crate, 'wood'); SURF.set(MAT.sandbag, 'sand'); SURF.set(MAT.dirt, 'sand');
for (const m of [MAT.metal, MAT.darkMetal, MAT.burnt, MAT.glass, MAT.shed, MAT.white, MAT.crane, MAT.hull, MAT.hullRed, ...containerMats, ...barrelMats, ...carMats]) SURF.set(m, 'metal');
MAT.roofMetal = std({ color: 0x6a6e70, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide, roughnessMap: PBR.wear.roughnessMap });
loadMap('kessar');

// ---------------------------------------------------------------- physics queries
const hitNormal = new V3();
let hitSurf = 'sand';
function rayWorld(o, d, maxT) {
  let best = maxT, nx = 0, ny = 0, nz = 0;
  let surf = 'sand';
  if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; surf = onRoad(o.x + d.x * t, o.z + d.z * t) ? 'stone' : curMap.groundSurf; } }
  const ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    const tx1 = (b.x0 - o.x) * ix, tx2 = (b.x1 - o.x) * ix;
    let tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2), ax = 0, sg = tx1 < tx2 ? -1 : 1;
    const ty1 = (b.y0 - o.y) * iy, ty2 = (b.y1 - o.y) * iy;
    const tymin = Math.min(ty1, ty2);
    if (tymin > tmin) { tmin = tymin; ax = 1; sg = ty1 < ty2 ? -1 : 1; }
    tmax = Math.min(tmax, Math.max(ty1, ty2));
    const tz1 = (b.z0 - o.z) * iz, tz2 = (b.z1 - o.z) * iz;
    const tzmin = Math.min(tz1, tz2);
    if (tzmin > tmin) { tmin = tzmin; ax = 2; sg = tz1 < tz2 ? -1 : 1; }
    tmax = Math.min(tmax, Math.max(tz1, tz2));
    if (tmin > 0 && tmin <= tmax && tmin < best) { best = tmin; nx = ax === 0 ? sg : 0; ny = ax === 1 ? sg : 0; nz = ax === 2 ? sg : 0; surf = b.surf; }
  }
  hitNormal.set(nx, ny, nz); hitSurf = surf;
  return best;
}
const _los = new V3();
function hasLOS(a, b) {
  _los.subVectors(b, a);
  const len = _los.length();
  if (len < 1e-3) return true;
  _los.divideScalar(len);
  return rayWorld(a, _los, len) >= len - 0.05;
}
function collideCircle(p, r, feetY, headY) {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (b.y1 <= feetY + 0.5 || b.y0 >= headY) continue;
      const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), push = (r - d) / d; p.x += dx * push; p.z += dz * push; }
      else {
        const l = p.x - b.x0, rr = b.x1 - p.x, f = p.z - b.z0, bk = b.z1 - p.z, m = Math.min(l, rr, f, bk);
        if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === f) p.z = b.z0 - r; else p.z = b.z1 + r;
      }
    }
  }
  p.x = clamp(p.x, -HALF + r, HALF - r);
  p.z = clamp(p.z, -HALF + r, HALF - r);
}
function groundHeightAt(x, z, maxY, r) {
  let g = 0;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (b.y1 > maxY || b.y1 <= g) continue;
    if (circleHitsBox(x, z, r, b)) g = b.y1;
  }
  return g;
}

// ---------------------------------------------------------------- audio (all synthesized)
const Sfx = {
  ctx: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = settings.volume; this.master.connect(comp);
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.21;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
    delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(this.master);
    this.echoIn = ctx.createGain(); this.echoIn.gain.value = 0.4; this.echoIn.connect(delay);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const wind = ctx.createBufferSource(); wind.buffer = buf; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 340;
    const wg = ctx.createGain(); wg.gain.value = 0.06;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 160; lfo.connect(lg); lg.connect(wf.frequency); lfo.start();
    wind.connect(wf); wf.connect(wg); wg.connect(this.master); wind.start();
    this.windGain = wg;
    this.setWeather(this.weather || null);
  },
  setVolume(v) { if (this.master) this.master.gain.value = v; },
  setWeather(w) {
    this.weather = w;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(w === 'sand' ? 0.32 : w === 'rain' ? 0.1 : 0.06, t, 0.8);
    if (!this.rainGain) {
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.35;
      this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
      src.connect(f); f.connect(this.rainGain); this.rainGain.connect(this.master); src.start();
      const hsrc = this.ctx.createBufferSource(); hsrc.buffer = this.noiseBuf; hsrc.loop = true;
      const hf = this.ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 140;
      this.heliGain = this.ctx.createGain(); this.heliGain.gain.value = 0;
      const am = this.ctx.createGain(); am.gain.value = 0.5;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 9; const lg = this.ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(am.gain); lfo.start();
      hsrc.connect(hf); hf.connect(am); am.connect(this.heliGain); this.heliGain.connect(this.master); hsrc.start();
    }
    this.rainGain.gain.setTargetAtTime(w === 'rain' ? 0.16 : 0, t, 0.8);
  },
  heli(level) { if (this.heliGain) this.heliGain.gain.setTargetAtTime(level * 1.4, this.ctx.currentTime, 0.2); },
  thunder(close) {
    if (!this.ctx) return;
    const b = this.bus(rand(-0.5, 0.5), 0.9);
    if (close) this.noise(b, { dur: 0.35, type: 'highpass', freq: 1500, gain: 0.5 });
    this.noise(b, { t: close ? 0.05 : 0, dur: 4.5, type: 'lowpass', freq: close ? 600 : 300, to: 50, gain: close ? 1.1 : 0.7, attack: 0.08 });
  },
  nvg() { if (!this.ctx) return; this.tone(this.bus(), { dur: 0.5, type: 'sine', f0: 3000, f1: 7000, gain: 0.05, attack: 0.05 }); },
  beep() { if (!this.ctx) return; this.tone(this.bus(), { dur: 0.09, type: 'square', f0: 1760, gain: 0.08 }); },
  alarm() { if (!this.ctx) return; const b = this.bus(0, 0.6); for (let i = 0; i < 4; i++) this.tone(b, { t: i * 0.5, dur: 0.45, type: 'sawtooth', f0: 520, f1: 760, gain: 0.07, attack: 0.05 }); },
  victory() { if (!this.ctx) return; const b = this.bus(0, 0.5); [392, 523, 659, 784].forEach((f, i) => this.tone(b, { t: i * 0.16, dur: 0.9 - i * 0.1, type: 'triangle', f0: f, gain: 0.12, attack: 0.02 })); },
  bus(pan = 0, echo = 0) {
    const ctx = this.ctx, g = ctx.createGain();
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(this.master); } else g.connect(this.master);
    if (echo > 0) { const e = ctx.createGain(); e.gain.value = echo; g.connect(e); e.connect(this.echoIn); }
    return g;
  },
  noise(dest, { t = 0, dur = 0.2, type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.002, to = null }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = dur > 0.5;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.4); src.stop(t0 + dur + 0.05);
  },
  tone(dest, { t = 0, dur = 0.1, type = 'sine', f0 = 440, f1 = null, gain = 0.3, attack = 0.002 }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  },
  shot(id) {
    if (!this.ctx) return;
    const P = { ar: [1300, 0.17, 0.8, 150, 0.9, 0.45], smg: [1800, 0.11, 0.65, 180, 0.6, 0.35], sg: [760, 0.42, 1.0, 110, 1.2, 0.7], sr: [950, 0.62, 1.1, 85, 1.3, 0.95] }[id];
    const b = this.bus(0, P[5]), r = rand(0.94, 1.06);
    this.noise(b, { dur: P[1], freq: P[0] * r, q: 0.7, gain: P[2], to: P[0] * 0.35 });
    this.noise(b, { dur: 0.045, type: 'highpass', freq: 3200, gain: 0.42 });
    this.tone(b, { dur: P[1] * 0.8, f0: P[3] * r, f1: 38, gain: P[4] });
    if (id === 'sg') { this.mech(0.34, 900, 0.3); this.mech(0.46, 1300, 0.3); }
    if (id === 'sr') { this.mech(0.42, 1800, 0.25); this.mech(0.62, 1100, 0.3); }
  },
  mech(t, f, g) { if (!this.ctx) return; const b = this.bus(0.15); this.noise(b, { t, dur: 0.06, freq: f, q: 2, gain: g }); },
  enemyShot(dist, pan, heavy = false) {
    if (!this.ctx) return;
    const b = this.bus(pan, 0.5), att = clamp(1 - dist / 150, 0.07, 1);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + 5200 * att * att; lp.connect(b);
    this.noise(lp, { dur: 0.13 + (1 - att) * 0.22, freq: heavy ? 900 : 1150, q: 0.6, gain: 0.55 * att, to: 380 });
    this.tone(lp, { dur: 0.1, f0: heavy ? 110 : 130, f1: 45, gain: 0.45 * att });
  },
  sniperEnemy(dist, pan) {
    if (!this.ctx) return;
    const b = this.bus(pan, 0.9), att = clamp(1 - dist / 220, 0.15, 1);
    this.noise(b, { dur: 0.08, type: 'highpass', freq: 2500, gain: 0.5 * att });
    this.noise(b, { dur: 0.7, freq: 800, q: 0.6, gain: 0.8 * att, to: 200 });
  },
  hit(kill, head) {
    if (!this.ctx) return;
    const b = this.bus();
    this.tone(b, { dur: 0.05, type: 'triangle', f0: 1700, f1: 1500, gain: 0.22 });
    this.noise(b, { dur: 0.03, type: 'highpass', freq: 5000, gain: 0.18 });
    if (head) { this.tone(b, { dur: 0.22, f0: 2600, gain: 0.12 }); this.tone(b, { dur: 0.16, f0: 3900, gain: 0.07 }); }
    if (kill) this.tone(b, { dur: 0.13, f0: 190, f1: 80, gain: 0.4 });
  },
  dry() { if (!this.ctx) return; this.noise(this.bus(), { dur: 0.035, freq: 3200, q: 3, gain: 0.3 }); },
  reload(total) {
    if (!this.ctx) return;
    const b = this.bus(0.1);
    this.noise(b, { t: 0.15, dur: 0.06, freq: 1800, q: 2, gain: 0.35 });
    this.noise(b, { t: total * 0.62, dur: 0.07, freq: 1200, q: 2, gain: 0.45 });
    this.tone(b, { t: total * 0.62, dur: 0.05, f0: 420, gain: 0.12 });
    this.noise(b, { t: total - 0.22, dur: 0.05, freq: 2600, q: 2, gain: 0.4 });
    this.noise(b, { t: total - 0.15, dur: 0.06, freq: 900, q: 2, gain: 0.3 });
  },
  foot(g = 0.16) { if (!this.ctx) return; this.noise(this.bus(rand(-0.1, 0.1)), { dur: 0.09, type: 'lowpass', freq: 300, to: 120, gain: g * rand(0.7, 1.1) }); },
  land() { if (!this.ctx) return; this.noise(this.bus(), { dur: 0.16, type: 'lowpass', freq: 220, gain: 0.4 }); },
  slide() { if (!this.ctx) return; this.noise(this.bus(), { dur: 0.65, freq: 900, to: 260, gain: 0.22, attack: 0.03 }); },
  hurt() { if (!this.ctx) return; const b = this.bus(); this.tone(b, { dur: 0.18, f0: 90, f1: 50, gain: 0.45 }); this.noise(b, { dur: 0.12, type: 'lowpass', freq: 520, gain: 0.3 }); },
  whizz(pan) { if (!this.ctx) return; this.noise(this.bus(pan), { dur: 0.17, freq: 2900, to: 700, q: 3, gain: 0.26 }); },
  explosion(dist) {
    if (!this.ctx) return;
    const att = clamp(1 - dist / 220, 0.08, 1), b = this.bus(0, 1.0);
    this.noise(b, { dur: 1.7, type: 'lowpass', freq: 1700, to: 80, gain: 1.2 * att, attack: 0.005 });
    this.tone(b, { dur: 0.9, f0: 72, f1: 26, gain: 1.3 * att });
    this.noise(b, { dur: 0.09, type: 'highpass', freq: 1800, gain: 0.5 * att });
  },
  distantBoom() { if (!this.ctx) return; const b = this.bus(rand(-0.8, 0.8), 0.8); this.noise(b, { dur: 2.2, type: 'lowpass', freq: 380, to: 60, gain: 0.3, attack: 0.02 }); },
  jet() { if (!this.ctx) return; const b = this.bus(0, 0.6); this.noise(b, { dur: 3.6, freq: 280, to: 1300, q: 0.5, gain: 0.8, attack: 1.7 }); this.noise(b, { dur: 3.4, type: 'lowpass', freq: 200, gain: 0.5, attack: 1.6 }); },
  uav() { if (!this.ctx) return; const b = this.bus(); for (let i = 0; i < 3; i++) this.tone(b, { t: i * 0.14, dur: 0.08, type: 'square', f0: 880, gain: 0.07 }); },
  radio() { if (!this.ctx) return; const b = this.bus(); this.noise(b, { dur: 0.25, freq: 1900, q: 4, gain: 0.14 }); this.tone(b, { t: 0.05, dur: 0.12, type: 'square', f0: 1250, gain: 0.05 }); },
  horn() {
    if (!this.ctx) return;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.connect(this.bus(0, 0.5));
    this.tone(lp, { dur: 1.5, type: 'sawtooth', f0: 98, gain: 0.16, attack: 0.25 });
    this.tone(lp, { dur: 1.5, type: 'sawtooth', f0: 147, gain: 0.1, attack: 0.25 });
  },
  pickup() { if (!this.ctx) return; this.tone(this.bus(), { dur: 0.14, f0: 660, f1: 990, gain: 0.18 }); },
  swish() { if (!this.ctx) return; this.noise(this.bus(), { dur: 0.2, freq: 1500, to: 450, q: 1.5, gain: 0.3 }); },
  thud() { if (!this.ctx) return; const b = this.bus(); this.noise(b, { dur: 0.1, type: 'lowpass', freq: 420, gain: 0.55 }); this.tone(b, { dur: 0.12, f0: 130, f1: 60, gain: 0.4 }); },
  bounce(dist) { if (!this.ctx) return; this.noise(this.bus(), { dur: 0.03, type: 'highpass', freq: 2800, gain: 0.14 * clamp(1 - dist / 30, 0.1, 1) }); },
  heartbeat() { if (!this.ctx) return; const b = this.bus(); this.tone(b, { dur: 0.12, f0: 58, gain: 0.5 }); this.tone(b, { t: 0.18, dur: 0.12, f0: 52, gain: 0.35 }); },
};

// ---------------------------------------------------------------- particles, tracers, decals
const PARTICLE_VERT = `attribute float alpha; attribute float size; attribute vec3 pcolor; attribute float seed; varying float vA; varying vec3 vC; varying float vS; uniform float uScale;
void main(){ vA = alpha; vC = pcolor; vS = seed; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = alpha <= 0.0 ? 0.0 : size * uScale / max(-mv.z, 0.1); }`;
const PARTICLE_FRAG = `varying float vA; varying vec3 vC; varying float vS; uniform float uBoost; uniform float uNoise;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * vA;
  vec3 col = vC;
  if (uNoise > 0.0) {
    float cs = cos(vS * 6.28), sn = sin(vS * 6.28); vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
    float n = n2(r * 5.0 + vS * 17.0) * 0.6 + n2(r * 11.0 - vS * 9.0) * 0.4;
    a *= smoothstep(0.25, 0.75, n + (0.5 - d) * 0.9);
    col *= 0.75 + n * 0.5 - c.y * 0.35;
  }
  gl_FragColor = vec4(col * uBoost, a);
}`;
const particleSystems = [];
class Particles {
  constructor(max, additive) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max); this.size = new Float32Array(max); this.seed = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    const mk = (arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('position', mk(this.pos, 3)); g.setAttribute('pcolor', mk(this.col, 3));
    g.setAttribute('alpha', mk(this.alpha, 1)); g.setAttribute('size', mk(this.size, 1)); g.setAttribute('seed', mk(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uBoost: { value: 1 }, uNoise: { value: additive ? 0 : 1 } }, vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; noAO(this.points);
    this.points.renderOrder = additive ? 3 : 2;
    this.geo = g; this.active = 0;
    scene.add(this.points);
    particleSystems.push(this);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, { grav = 0, drag = 0, grow = 0, alpha = 1 } = {}) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.seed[i] = Math.random(); this.seedDirty = true;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.a0[i] = alpha; this.alpha[i] = alpha;
    this.active = this.max;
  }
  update(dt) {
    if (!this.active) return;
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      any++;
      this.life[i] -= dt;
      const k = 1 - this.drag[i] * dt, j = i * 3;
      this.vel[j + 1] -= this.grav[i] * dt;
      this.vel[j] *= k; this.vel[j + 1] *= k; this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.02 && this.grav[i] > 0) { this.pos[j + 1] = 0.02; this.vel[j + 1] *= -0.3; }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.life[i] <= 0 ? 0 : this.a0[i] * Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 12 + 0.35);
    }
    if (!any) this.active = 0;
    for (const n of ['position', 'pcolor', 'alpha', 'size']) this.geo.attributes[n].needsUpdate = true;
    if (this.seedDirty) { this.geo.attributes.seed.needsUpdate = true; this.seedDirty = false; }
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.geo.attributes.alpha.needsUpdate = true; }
}
const fxAdd = new Particles(1600, true);
const fxSmoke = new Particles(900, false);

// Ambient dust motes drifting around the camera
const DUST_N = 380;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_N * 3);
for (let i = 0; i < DUST_N; i++) { dustPos[i * 3] = rand(-20, 20); dustPos[i * 3 + 1] = rand(0, 12); dustPos[i * 3 + 2] = rand(-20, 20); }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffe2b8, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
dust.frustumCulled = false; noAO(dust);
scene.add(dust);

const tracerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
const tracerMatP = new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const tracerMatE = new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const tracers = [];
for (let i = 0; i < 48; i++) { const m = noAO(new THREE.Mesh(tracerGeo, tracerMatP)); m.visible = false; scene.add(m); tracers.push({ m, a: new V3(), dir: new V3(), len: 0, t: 0, speed: 0, seg: 0, live: false }); }
let tracerIdx = 0;
function spawnTracer(a, b, mine) {
  const tr = tracers[tracerIdx]; tracerIdx = (tracerIdx + 1) % tracers.length;
  tr.a.copy(a); tr.dir.subVectors(b, a); tr.len = tr.dir.length();
  if (tr.len < 0.5) return;
  tr.dir.divideScalar(tr.len);
  tr.t = 0; tr.speed = mine ? 420 : 170; tr.seg = mine ? 4.5 : 3; tr.live = true;
  tr.m.material = mine ? tracerMatP : tracerMatE;
}
const _tA = new V3(), _tB = new V3();
function updateTracers(dt) {
  for (const tr of tracers) {
    if (!tr.live) continue;
    tr.t += tr.speed * dt;
    const head = Math.min(tr.t, tr.len), tail = Math.max(0, tr.t - tr.seg);
    if (tail >= tr.len) { tr.live = false; tr.m.visible = false; continue; }
    _tA.copy(tr.a).addScaledVector(tr.dir, tail);
    _tB.copy(tr.a).addScaledVector(tr.dir, head);
    const segLen = head - tail;
    if (segLen < 0.01) { tr.m.visible = false; continue; }
    const w = Math.max(0.018, _tA.distanceTo(camera.position) * 0.0022);
    tr.m.visible = true;
    tr.m.position.copy(_tA);
    tr.m.lookAt(_tB);
    tr.m.scale.set(w, w, segLen);
  }
}

const decalGeo = new THREE.PlaneGeometry(1, 1);
const holeMat = new THREE.MeshBasicMaterial({ map: TEX.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const scorchMat = new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.9 });
const decals = [];
let decalIdx = 0;
for (let i = 0; i < 140; i++) { const m = noAO(new THREE.Mesh(decalGeo, holeMat)); m.visible = false; scene.add(m); decals.push(m); }
function placeDecal(p, n, size, mat) {
  const m = decals[decalIdx]; decalIdx = (decalIdx + 1) % decals.length;
  m.material = mat; m.visible = true;
  m.position.copy(p).addScaledVector(n, 0.012);
  m.lookAt(_tA.copy(m.position).add(n));
  m.rotateZ(Math.random() * 6.28);
  m.scale.set(size, size, 1);
}
// Impacts react to what was hit: sparks off metal, splinters off wood, puffs of sand, grit and dust off stone.
function impactFX(p, n, big = false, surf = 'stone') {
  const k = big ? 1.8 : 1;
  const burst = (count, col, size, life, speed, grav, sys = fxSmoke, alpha = 0.9, drag = 1.5, grow = 0) => {
    for (let i = 0; i < count * k; i++) sys.spawn(p.x, p.y, p.z, n.x * rand(0.4, 1) * speed + rand(-0.5, 0.5) * speed, n.y * rand(0.4, 1) * speed + rand(0, 0.7) * speed, n.z * rand(0.4, 1) * speed + rand(-0.5, 0.5) * speed, col[0] * rand(0.85, 1.1), col[1] * rand(0.85, 1.1), col[2] * rand(0.85, 1.1), rand(size * 0.6, size), rand(life * 0.6, life), { grav, drag, grow, alpha });
  };
  if (surf === 'metal') {
    burst(12, [1, 0.72, 0.38], 0.06, 0.35, 9, 16, fxAdd, 1, 1);
    burst(3, [0.35, 0.33, 0.31], 0.25, 0.7, 1, 0, fxSmoke, 0.5, 2, 0.6);
  } else if (surf === 'wood') {
    burst(8, [0.42, 0.3, 0.18], 0.07, 0.6, 5, 14, fxSmoke, 1, 1);
    burst(3, [0.55, 0.45, 0.33], 0.3, 0.8, 1.2, 0, fxSmoke, 0.5, 2, 0.8);
  } else if (surf === 'sand') {
    burst(5, [0.62, 0.5, 0.36], 0.45, 1.3, 2.2, -0.4, fxSmoke, 0.75, 2.2, 1.2);
    burst(10, [0.55, 0.44, 0.3], 0.05, 0.7, 5, 14, fxSmoke, 1, 0.6);
  } else {
    burst(4, [0.6, 0.57, 0.52], 0.35, 1.0, 1.6, -0.2, fxSmoke, 0.65, 2, 1);
    burst(9, [0.5, 0.48, 0.44], 0.05, 0.6, 6, 14, fxSmoke, 1, 0.8);
    burst(3, [1, 0.75, 0.4], 0.045, 0.18, 7, 12, fxAdd, 1, 1);
  }
}
function bloodFX(p, d) {
  for (let i = 0; i < 9; i++) fxSmoke.spawn(p.x, p.y, p.z, d.x * rand(1, 3) + rand(-1.2, 1.2), rand(-0.5, 1.8), d.z * rand(1, 3) + rand(-1.2, 1.2), rand(0.35, 0.5), 0.03, 0.03, rand(0.1, 0.22), rand(0.25, 0.5), { grav: 9, drag: 2.2, grow: 0.3, alpha: 0.9 });
}

// Point lights are created once and dimmed when idle so shaders never recompile mid-game.
const muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 2);
scene.add(muzzleLight);
const blastLights = [0, 1].map(() => { const l = new THREE.PointLight(0xff9a40, 0, 45, 2); scene.add(l); return l; });
fireLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff8a30, 0, 18, 2); scene.add(l); return l; });
// Three point lights serve each map: its own floodlights if it has any, otherwise its burning wrecks.
function placeMapLights() {
  const src = MAP_LIGHTS.length ? MAP_LIGHTS : FIRES.slice(0, 3).map((p) => ({ pos: p.clone().add(new V3(0, 1, 0)), color: 0xff8a30, intensity: 30, distance: 18, flicker: true }));
  fireLights.forEach((l, i) => {
    const c = src[i] || null; l.userData.cfg = c;
    if (c) { l.position.copy(c.pos); l.color.setHex(c.color); l.distance = c.distance; l.intensity = c.intensity; } else l.intensity = 0;
  });
}
placeMapLights();

const shockGeo = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
const shocks = [];
function explode(p, { radius = 7, dmg = 230, playerDmg = 100, cause = 'frag' } = {}) {
  const light = blastLights[0].intensity <= blastLights[1].intensity ? blastLights[0] : blastLights[1];
  light.position.set(p.x, p.y + 1.5, p.z); light.intensity = 2600;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * 6.28, u = rand(-0.2, 1), s = rand(3, 10), r = Math.sqrt(1 - u * u);
    fxAdd.spawn(p.x, p.y + 0.5, p.z, Math.cos(a) * r * s, u * s + 2, Math.sin(a) * r * s, 1.0, rand(0.45, 0.8), rand(0.12, 0.3), rand(1.4, 2.6), rand(0.3, 0.65), { drag: 3, grow: 2.5 });
  }
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * 6.28, s = rand(4, 16);
    fxAdd.spawn(p.x, p.y + 0.3, p.z, Math.cos(a) * s, rand(4, 13), Math.sin(a) * s, 1, 0.75, 0.35, rand(0.06, 0.12), rand(0.5, 1.2), { grav: 16, drag: 0.6 });
  }
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * 6.28, s = rand(0.5, 3);
    fxSmoke.spawn(p.x + rand(-1, 1), p.y + rand(0.5, 2.5), p.z + rand(-1, 1), Math.cos(a) * s, rand(1.2, 3.5), Math.sin(a) * s, rand(0.16, 0.24), rand(0.14, 0.2), rand(0.12, 0.17), rand(2.4, 4.2), rand(2.4, 4.4), { drag: 0.9, grow: 1.4, alpha: 0.8 });
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 6.28;
    fxSmoke.spawn(p.x, p.y + 0.3, p.z, Math.cos(a) * 9, 0.4, Math.sin(a) * 9, 0.62, 0.52, 0.4, 1.6, 1.4, { drag: 2.4, grow: 1.6, alpha: 0.6 });
  }
  const ring = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  noAO(ring); ring.position.set(p.x, p.y + 0.1, p.z); scene.add(ring); shocks.push({ m: ring, t: 0, r: radius * 1.4 });
  placeDecal(_tB.set(p.x, p.y + 0.01, p.z), _tA.set(0, 1, 0).clone(), radius * 0.9, scorchMat);

  const eyeP = camera.position;
  _tA.set(p.x, p.y + 0.6, p.z);
  for (const e of enemies) {
    if (e.dead) continue;
    e.chestInto(_tB);
    const d = _tB.distanceTo(_tA);
    if (d < radius && hasLOS(_tA, _tB)) {
      const dir = _tB.clone().sub(_tA).normalize();
      e.damage(dmg * Math.pow(1 - d / radius, 0.7) + 15, 'body', dir, cause, e.pos.distanceTo(player.pos));
    } else if (d < radius * 4) { e.alerted = true; e.lastKnown.copy(player.pos); }
  }
  const dP = eyeP.distanceTo(_tA);
  if (player.alive && playerDmg > 0 && dP < radius * 1.15 && hasLOS(_tA, eyeP)) hurtPlayer(playerDmg * (1 - dP / (radius * 1.15)) + 5, p, true);
  G.shake = Math.max(G.shake, clamp(1.5 - dP / 28, 0, 1.5));
  if (dP < 16) flashScreen(clamp(0.7 - dP / 25, 0, 0.6));
  Sfx.explosion(dP);
}

// ---------------------------------------------------------------- weapons and viewmodel
const WEAPONS = [
  { id: 'ar', name: 'AR-7 CARBINE', auto: true, rpm: 720, dmg: 31, head: 1.8, pellets: 1, mag: 30, reserve: 150, reserveMax: 240, reload: 2.1, hip: 0.034, ads: 0.0035, recoil: 0.0125, bloom: 0.006, zoom: 0.72, adsTime: 0.2, range: 160, falloff: [35, 70, 0.7], mobility: 1, mode: 'AUTO' },
  { id: 'smg', name: 'VK-9 SMG', auto: true, rpm: 940, dmg: 23, head: 1.6, pellets: 1, mag: 32, reserve: 192, reserveMax: 256, reload: 1.7, hip: 0.022, ads: 0.009, recoil: 0.0085, bloom: 0.004, zoom: 0.8, adsTime: 0.13, range: 100, falloff: [14, 35, 0.55], mobility: 1.08, mode: 'AUTO' },
  { id: 'sg', name: 'BRECHER-12', auto: false, rpm: 72, dmg: 17, head: 1.3, pellets: 9, mag: 7, reserve: 28, reserveMax: 42, reload: 2.6, hip: 0.065, ads: 0.048, recoil: 0.05, bloom: 0, zoom: 0.86, adsTime: 0.18, range: 50, falloff: [8, 22, 0.25], mobility: 1, mode: 'PUMP' },
  { id: 'sr', name: 'LONGBOW .338', auto: false, rpm: 48, dmg: 140, head: 2.5, pellets: 1, mag: 5, reserve: 20, reserveMax: 35, reload: 3.0, hip: 0.08, ads: 0.0, recoil: 0.065, bloom: 0, zoom: 0.22, adsTime: 0.32, range: 400, falloff: [400, 500, 1], mobility: 0.92, mode: 'BOLT', scope: true },
];
const ws = { cur: 0, state: WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve })), fireCd: 0, reloading: false, reloadT: 0, bloom: 0, nades: 3 };

const vmMat = {
  metal: std({ roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x2a2d30, metalness: 0.75, roughness: 0.72 }),
  poly: std({ roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x1c1e20, metalness: 0.1, roughness: 1 }),
  fde: std({ roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x9a865f, roughness: 1 }),
  olive: std({ roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x4a5236, roughness: 1 }),
  wood: std({ roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x6b4428, roughness: 0.9 }),
  glove: std({ roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x2a2924, roughness: 1 }),
  sleeve: std({ map: TEX.camo, color: 0x8a8766, roughness: 0.95 }),
  brass: std({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  glass: new THREE.MeshBasicMaterial({ color: 0x8fc6d8, transparent: true, opacity: 0.05, depthWrite: false }),
  lens: std({ color: 0x0c1a22, metalness: 0.9, roughness: 0.1 }),
};
const vmTubeMat = vmMat.poly.clone(); vmTubeMat.side = THREE.DoubleSide;
function P(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; }
const B = (w, h, d) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.2);
const CZ = (r1, r2, len, seg = 14, open = false) => new THREE.CylinderGeometry(r1, r2, len, seg, 1, open).rotateX(Math.PI / 2);
function limb(parent, from, to, t, mat) {
  const d = new V3().subVectors(to, from), len = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, t, len).translate(0, 0, len / 2), mat);
  m.position.copy(from); m.lookAt(new V3().addVectors(from, d)); parent.add(m); return m;
}
function addHands(g, grip, fore) {
  P(g, B(0.075, 0.1, 0.11), vmMat.glove, grip[0], grip[1], grip[2]);
  limb(g, new V3(grip[0] + 0.01, grip[1] - 0.03, grip[2] + 0.04), new V3(grip[0] + 0.15, grip[1] - 0.26, grip[2] + 0.5), 0.085, vmMat.sleeve);
  P(g, B(0.085, 0.07, 0.13), vmMat.glove, fore[0], fore[1], fore[2]);
  limb(g, new V3(fore[0] - 0.02, fore[1] - 0.02, fore[2] + 0.03), new V3(fore[0] - 0.24, fore[1] - 0.3, fore[2] + 0.42), 0.085, vmMat.sleeve);
}
function makeFlash(parent, x, y, z, s) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.flash, color: new THREE.Color(2.6, 2.1, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.position.set(x, y, z); sp.scale.set(s, s, s); sp.visible = false; noAO(sp); parent.add(sp); return sp;
}
function buildViewmodel(id) {
  const g = new THREE.Group();
  const out = { g, sightY: 0.1, adsZ: 0.3, hip: new V3(0.2, -0.215, -0.47) };
  if (id === 'ar') {
    P(g, B(0.062, 0.05, 0.38), vmMat.fde, 0, 0.028, -0.05);
    P(g, B(0.056, 0.05, 0.24), vmMat.poly, 0, -0.022, 0.0);
    P(g, B(0.03, 0.012, 0.36), vmMat.metal, 0, 0.059, -0.06);
    P(g, B(0.07, 0.07, 0.3), vmMat.fde, 0, 0.014, -0.39);
    for (let i = 0; i < 5; i++) P(g, B(0.072, 0.012, 0.03), vmMat.poly, 0, 0.02, -0.29 - i * 0.05);
    P(g, CZ(0.011, 0.011, 0.16), vmMat.metal, 0, 0.02, -0.62);
    P(g, CZ(0.019, 0.019, 0.07), vmMat.metal, 0, 0.02, -0.72);
    out.mag = P(g, B(0.045, 0.17, 0.075), vmMat.poly, 0, -0.12, -0.1, 0.18);
    P(g, B(0.04, 0.11, 0.055), vmMat.poly, 0, -0.085, 0.07, -0.35);
    P(g, CZ(0.016, 0.016, 0.12), vmMat.metal, 0, 0.01, 0.2);
    P(g, B(0.055, 0.09, 0.16), vmMat.fde, 0, -0.005, 0.3);
    P(g, B(0.03, 0.022, 0.05), vmMat.metal, 0, 0.074, -0.02);
    P(g, CZ(0.025, 0.025, 0.055, 18, true), vmTubeMat, 0, 0.108, -0.02);
    P(g, new THREE.CircleGeometry(0.023, 18), vmMat.glass, 0, 0.108, -0.046);
    P(g, new THREE.SphereGeometry(0.0017, 8, 6), vmMat.red, 0, 0.108, -0.048);
    out.sightY = 0.108; out.adsZ = 0.27;
    out.muzzle = new V3(0, 0.02, -0.77); out.eject = new V3(0.035, 0.03, -0.02);
    addHands(g, [0.004, -0.1, 0.075], [-0.005, -0.035, -0.4]);
  } else if (id === 'smg') {
    P(g, B(0.055, 0.075, 0.3), vmMat.poly, 0, 0, -0.08);
    P(g, B(0.05, 0.03, 0.3), vmMat.metal, 0, 0.05, -0.08);
    P(g, B(0.05, 0.055, 0.12), vmMat.metal, 0, 0.01, -0.29);
    P(g, CZ(0.022, 0.022, 0.22), vmMat.metal, 0, 0.012, -0.46);
    out.mag = P(g, B(0.035, 0.21, 0.045), vmMat.poly, 0, -0.135, -0.13, 0.08);
    P(g, B(0.038, 0.1, 0.05), vmMat.poly, 0, -0.08, 0.04, -0.3);
    P(g, B(0.018, 0.018, 0.22), vmMat.metal, 0.022, 0.0, 0.18);
    P(g, B(0.018, 0.08, 0.02), vmMat.metal, 0.022, -0.025, 0.29);
    P(g, B(0.042, 0.016, 0.075), vmMat.metal, 0, 0.073, -0.05);
    P(g, B(0.052, 0.006, 0.012), vmMat.poly, 0, 0.127, -0.07);
    P(g, B(0.006, 0.05, 0.012), vmMat.poly, -0.026, 0.103, -0.07);
    P(g, B(0.006, 0.05, 0.012), vmMat.poly, 0.026, 0.103, -0.07);
    P(g, new THREE.PlaneGeometry(0.046, 0.042), vmMat.glass, 0, 0.102, -0.071);
    P(g, new THREE.TorusGeometry(0.0065, 0.0007, 6, 24), vmMat.red, 0, 0.1, -0.072);
    P(g, new THREE.SphereGeometry(0.0012, 6, 4), vmMat.red, 0, 0.1, -0.072);
    out.sightY = 0.1; out.adsZ = 0.36; out.hip.set(0.19, -0.2, -0.43);
    out.muzzle = new V3(0, 0.012, -0.58); out.eject = new V3(0.03, 0.03, -0.06);
    addHands(g, [0.004, -0.09, 0.045], [-0.005, -0.03, -0.27]);
  } else if (id === 'sg') {
    P(g, B(0.055, 0.08, 0.26), vmMat.metal, 0, 0, -0.02);
    P(g, CZ(0.016, 0.016, 0.62), vmMat.metal, 0, 0.022, -0.45);
    P(g, CZ(0.014, 0.014, 0.5), vmMat.metal, 0, -0.018, -0.4);
    out.pump = P(g, B(0.062, 0.055, 0.17), vmMat.wood, 0, -0.016, -0.36);
    P(g, B(0.05, 0.09, 0.3), vmMat.wood, 0, -0.035, 0.25, 0.12);
    P(g, B(0.045, 0.09, 0.06), vmMat.wood, 0, -0.07, 0.085, -0.4);
    P(g, new THREE.SphereGeometry(0.0045, 8, 6), std({ color: 0xf2e6c0, emissive: 0x5a4a20 }), 0, 0.042, -0.75);
    P(g, B(0.01, 0.016, 0.012), vmMat.metal, -0.009, 0.046, 0.0);
    P(g, B(0.01, 0.016, 0.012), vmMat.metal, 0.009, 0.046, 0.0);
    out.sightY = 0.043; out.adsZ = 0.24; out.hip.set(0.21, -0.2, -0.46);
    out.muzzle = new V3(0, 0.022, -0.77); out.eject = new V3(0.035, 0.02, -0.05);
    addHands(g, [0.004, -0.1, 0.09], [-0.005, -0.03, -0.36]);
  } else {
    P(g, B(0.065, 0.1, 0.55), vmMat.olive, 0, -0.035, 0.12);
    P(g, B(0.06, 0.06, 0.2), vmMat.olive, 0, -0.03, -0.27);
    P(g, CZ(0.022, 0.022, 0.26), vmMat.metal, 0, 0.02, -0.05);
    P(g, CZ(0.014, 0.01, 0.72), vmMat.metal, 0, 0.02, -0.54);
    P(g, B(0.036, 0.03, 0.07), vmMat.metal, 0, 0.02, -0.92);
    P(g, CZ(0.02, 0.02, 0.3), vmMat.metal, 0, 0.085, -0.05);
    P(g, CZ(0.031, 0.021, 0.08), vmMat.metal, 0, 0.085, -0.24);
    P(g, CZ(0.026, 0.02, 0.06), vmMat.metal, 0, 0.085, 0.13);
    P(g, new THREE.CircleGeometry(0.028, 18), vmMat.lens, 0, 0.085, -0.281);
    P(g, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), vmMat.metal, 0, 0.115, -0.05);
    P(g, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), vmMat.metal, 0.03, 0.085, -0.05, 0, 0, Math.PI / 2);
    P(g, B(0.03, 0.03, 0.02), vmMat.metal, 0, 0.055, -0.14); P(g, B(0.03, 0.03, 0.02), vmMat.metal, 0, 0.055, 0.04);
    out.bolt = P(g, new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8), vmMat.metal, 0.045, 0.02, 0.05, 0, 0, Math.PI / 2);
    out.mag = P(g, B(0.04, 0.06, 0.08), vmMat.poly, 0, -0.07, -0.05);
    out.sightY = 0.085; out.adsZ = 0.3; out.hip.set(0.21, -0.215, -0.5);
    out.muzzle = new V3(0, 0.02, -0.96); out.eject = new V3(0.04, 0.03, 0.0);
    addHands(g, [0.004, -0.11, 0.1], [-0.005, -0.06, -0.3]);
  }
  out.flash = makeFlash(g, out.muzzle.x, out.muzzle.y, out.muzzle.z - 0.03, id === 'sg' || id === 'sr' ? 0.3 : 0.2);
  if (out.mag) out.magY = out.mag.position.y;
  if (out.pump) out.pumpZ = out.pump.position.z;
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return out;
}
const vm = { root: new THREE.Group(), models: WEAPONS.map((w) => buildViewmodel(w.id)), adsT: 0, sprintT: 0, bobT: 0, swayX: 0, swayY: 0, kick: 0, raiseT: 0, meleeT: 0, throwT: 0, pumpT: 0, boltT: 0, flashT: 0 };
for (const m of vm.models) { m.g.visible = false; vm.root.add(m.g); }
vmScene.add(vm.root);
const vmHemi = new THREE.HemisphereLight(0xb5c3d8, 0x5a4636, 0.9);
vmScene.add(vmHemi);
const vmSun = new THREE.DirectionalLight(0xffc896, 2.4);
vmScene.add(vmSun, vmSun.target);
const vmFlashLight = new THREE.PointLight(0xffb060, 0, 2, 2);
vmScene.add(vmFlashLight);
const shellGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6).rotateZ(Math.PI / 2);
const shells = [];
for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(shellGeo, vmMat.brass); m.visible = false; m.frustumCulled = false; vmScene.add(m); shells.push({ m, v: new V3(), s: new V3(), t: 0 }); }
let shellIdx = 0;

// ---------------------------------------------------------------- enemies
const ENEMY_TYPES = {
  rifleman: { name: 'Rifleman', hp: 100, speed: 3.1, run: 4.7, burst: [3, 5], interval: 0.12, pause: [0.9, 1.8], dmg: 9, acc: 0.42, range: [12, 26], score: 100, scale: 1, uniform: 0x6f6a4f, vest: 0x3c4032, visor: 0xffa640, react: 1 },
  heavy: { name: 'Juggernaut', hp: 250, speed: 2.3, run: 3.3, burst: [8, 14], interval: 0.085, pause: [1.5, 2.3], dmg: 7, acc: 0.33, range: [5, 13], score: 150, scale: 1.13, uniform: 0x34383b, vest: 0x1d1f21, visor: 0xff3a2a, react: 1.2 },
  commander: { name: 'The Jackal', hp: 340, speed: 2.8, run: 5.0, burst: [3, 6], interval: 0.11, pause: [0.8, 1.4], dmg: 10, acc: 0.42, range: [10, 24], score: 500, scale: 1.02, uniform: 0x3a2a24, vest: 0x161616, visor: 0xff5533, react: 0.8 },
  marksman: { name: 'Marksman', hp: 90, static: true, dmg: 55, acc: 0.85, aim: 1.7, cooldown: 2.8, score: 150, scale: 1, uniform: 0x756d4c, vest: 0x4d4a35, visor: 0x9cf0ff, react: 1 },
};
const EG = {
  leg: new THREE.CapsuleGeometry(0.105, 0.7, 4, 10).translate(0, -0.46, 0),
  boot: new THREE.BoxGeometry(0.22, 0.14, 0.32),
  torso: new THREE.CapsuleGeometry(0.2, 0.34, 4, 12).scale(1.12, 1, 0.7),
  vest: new THREE.BoxGeometry(0.5, 0.42, 0.34),
  pouch: new THREE.BoxGeometry(0.1, 0.13, 0.07),
  neck: new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10),
  pack: new THREE.BoxGeometry(0.36, 0.42, 0.18),
  head: new THREE.SphereGeometry(0.135, 14, 10).scale(0.95, 1.12, 1),
  helmet: new THREE.SphereGeometry(0.175, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  goggles: new THREE.BoxGeometry(0.2, 0.06, 0.04),
  visor: new THREE.BoxGeometry(0.22, 0.13, 0.03),
  arm: new THREE.CapsuleGeometry(0.068, 0.4, 4, 8).translate(0, -0.25, 0),
  gun: new THREE.BoxGeometry(0.07, 0.12, 0.75),
  longGun: new THREE.BoxGeometry(0.06, 0.1, 1.15),
  scope: CZ(0.03, 0.03, 0.26, 10),
  pad: new THREE.BoxGeometry(0.2, 0.12, 0.26),
};
const EM = {
  black: std({ color: 0x1c1e20, roughness: 1, metalness: 0.45, roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap }),
  tan: std({ color: 0x8f7d5c, roughness: 0.85, roughnessMap: PBR.wear.roughnessMap }),
  boot: std({ color: 0x2b241d, roughness: 0.9 }), skinMask: std({ color: 0x23231f, roughness: 0.95 }),
};
const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
const beamGeo = new THREE.ConeGeometry(1.5, 12, 24, 1, true).translate(0, -6, 0).rotateX(Math.PI / 2);
let beamMat, lensMat; // created with the mission textures
// Rigged, animated soldier (Mixamo "Vanguard", shipped with the three.js examples). Until it loads, or if it can't,
// enemies fall back to the built-in low-poly soldier.
const SOLDIER = { ready: false };
const onSoldierLoaded = (gltf) => {
  gltf.scene.updateMatrixWorld(true);
  const head = gltf.scene.getObjectByName('mixamorigHead');
  SOLDIER.scale = head ? 1.6 / head.getWorldPosition(new V3()).y : 1;
  SOLDIER.scene = gltf.scene; SOLDIER.clips = gltf.animations;
  gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  SOLDIER.ready = true;
};
{
  const loader = new GLTFLoader();
  const noModel = (err) => console.warn('Soldier model unavailable, using fallback soldiers.', err);
  // Hosts that can't serve .glb files get the same model as base64 in assets/soldier.json.
  const fromJson = () => fetch('assets/soldier.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(({ glb }) => { const bin = atob(glb), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); loader.parse(buf.buffer, '', onSoldierLoaded, noModel); })
    .catch(noModel);
  loader.load('assets/soldier.glb', onSoldierLoaded, undefined, fromJson);
}
const SOLDIER_TINT = { rifleman: 0xa8a386, heavy: 0x6a6d6e, marksman: 0xc2ad86, commander: 0x6a3c32 };
function buildRifle(g, long) {
  const add = (geo, mat, x, y, z, rx = 0) => { const m = P(g, geo, mat, x, y, z, rx); m.castShadow = true; return m; };
  add(B(0.05, 0.095, 0.22), EM.tan, 0, -0.02, 0.2);
  add(B(0.058, 0.075, 0.32), EM.black, 0, 0, -0.05);
  add(B(0.06, 0.062, 0.26), EM.tan, 0, 0.004, -0.33);
  add(CZ(0.011, 0.011, long ? 0.5 : 0.22, 8), EM.black, 0, 0.01, long ? -0.7 : -0.56);
  add(B(0.036, 0.15, 0.065), EM.black, 0, -0.1, -0.08, 0.22);
  add(B(0.034, 0.085, 0.04), EM.black, 0, -0.07, 0.06, -0.35);
  if (long) add(CZ(0.024, 0.024, 0.3, 10), EM.black, 0, 0.075, -0.06);
  else add(B(0.04, 0.05, 0.09), EM.black, 0, 0.065, -0.05);
  return long ? -0.97 : -0.68;
}
const visorMats = {};
for (const [k, t] of Object.entries(ENEMY_TYPES)) visorMats[k] = std({ color: t.visor, emissive: t.visor, emissiveIntensity: 2.2 });
const laserMat = new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

function buildSoldier(type) {
  const T = ENEMY_TYPES[type];
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const body = new THREE.Group(); body.scale.setScalar(T.scale); root.add(body);
  const uni = std({ map: TEX.camo, color: T.uniform, roughness: 0.95 });
  const vest = std({ color: T.vest, roughness: 0.85 });
  const parts = [];
  const part = (parent, geo, mat, x, y, z, kind, cast = true) => { const m = P(parent, geo, mat, x, y, z); m.castShadow = cast; if (kind) { m.userData.part = kind; parts.push(m); } return m; };
  const legL = new THREE.Group(); legL.position.set(-0.12, 0.95, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.12, 0.95, 0); body.add(legR);
  part(legL, EG.leg, uni, 0, 0, 0, 'limb'); part(legR, EG.leg, uni, 0, 0, 0, 'limb');
  part(legL, EG.boot, EM.boot, 0, -0.88, -0.04, null, false); part(legR, EG.boot, EM.boot, 0, -0.88, -0.04, null, false);
  part(body, EG.torso, uni, 0, 1.28, 0, 'body');
  part(body, EG.vest, vest, 0, 1.32, 0, 'body');
  part(body, EG.pack, vest, 0, 1.34, 0.24, 'body');
  for (const px of [-0.15, 0, 0.15]) P(body, EG.pouch, vest, px, 1.2, -0.2);
  P(body, EG.neck, EM.skinMask, 0, 1.6, 0);
  const head = part(body, EG.head, EM.skinMask, 0, 1.73, 0, 'head');
  const helmet = part(body, EG.helmet, vest, 0, 1.8, 0.0, 'head');
  helmet.scale.set(1.05, 1, 1.12);
  if (type === 'heavy') {
    P(body, EG.visor, visorMats[type], 0, 1.75, -0.135);
    part(body, EG.pad, vest, -0.33, 1.56, 0, 'body'); part(body, EG.pad, vest, 0.33, 1.56, 0, 'body');
  } else P(body, EG.goggles, visorMats[type], 0, 1.76, -0.135);
  const armL = new THREE.Group(); armL.position.set(-0.3, 1.54, 0); armL.rotation.set(-1.15, 0, 0.45); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.3, 1.54, 0); armR.rotation.set(-1.3, 0, -0.25); body.add(armR);
  part(armL, EG.arm, uni, 0, 0, 0, 'limb'); part(armR, EG.arm, uni, 0, 0, 0, 'limb');
  const gun = new THREE.Group(); gun.position.set(0.06, 1.3, -0.4); body.add(gun);
  const long = type === 'marksman';
  const muzzleZ = buildRifle(gun, long);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, muzzleZ); gun.add(muzzle);
  const flash = makeFlash(muzzle, 0, 0, -0.1, type === 'heavy' ? 0.7 : 0.55);
  let glint = null, laser = null;
  if (long) {
    glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.flash, color: 0xcff6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
    noAO(glint); glint.scale.set(0.05, 0.05, 1); glint.position.set(0, 0.09, 0.1); glint.visible = false; gun.add(glint);
    const lg = new THREE.BufferGeometry().setFromPoints([new V3(), new V3(0, 0, -1)]);
    laser = noAO(new THREE.Line(lg, laserMat)); laser.frustumCulled = false; laser.visible = false; scene.add(laser);
  }
  const beam = noAO(new THREE.Mesh(beamGeo, beamMat)); beam.position.set(0, -0.03, muzzleZ + 0.12); beam.visible = !!ENV.night; gun.add(beam);
  const lens = noAO(new THREE.Sprite(lensMat)); lens.scale.setScalar(0.35); lens.position.set(0, 0, -0.05); beam.add(lens);
  const out = { root, body, legL, legR, gun, muzzle, flash, glint, laser, helmet, head, parts, mats: [uni, vest], rig: null, beam };
  if (SOLDIER.ready) {
    const model = cloneSkinned(SOLDIER.scene);
    model.scale.setScalar(SOLDIER.scale * T.scale);
    const mats = [];
    model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(SOLDIER_TINT[type]); o.material.roughness = 0.9; mats.push(o.material); } });
    root.add(model);
    const gunMeshes = new Set(); gun.traverse((o) => gunMeshes.add(o));
    for (const p of parts) { p.material = hitboxMat; p.castShadow = false; }
    body.traverse((o) => { if (o.isMesh && !parts.includes(o) && !gunMeshes.has(o)) o.visible = false; });
    gun.position.set(0.1 * T.scale, 1.37 * T.scale, -0.26 * T.scale);
    const mixer = new THREE.AnimationMixer(model), act = {};
    for (const name of ['Idle', 'Walk', 'Run']) { const a = mixer.clipAction(THREE.AnimationClip.findByName(SOLDIER.clips, name)); a.play(); a.setEffectiveWeight(name === 'Idle' ? 1 : 0); act[name] = a; }
    mixer.update(Math.random() * 3);
    const bone = (n) => model.getObjectByName('mixamorig' + n);
    out.rig = { model, mixer, act, w: { Idle: 1, Walk: 0, Run: 0 }, rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'), lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'), spine: bone('Spine1') };
    out.mats = mats;
  }
  return out;
}

// Two-bone IK so the rigged soldiers' hands stay on their rifles whatever the animation is doing.
const IK = { a: new V3(), b: new V3(), c: new V3(), t: new V3(), e: new V3(), f: new V3(), g: new V3(), p: new V3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), pq: new THREE.Quaternion() };
function aimBone(bone, childWorld, targetWorld) {
  bone.getWorldPosition(IK.a);
  IK.f.subVectors(childWorld, IK.a).normalize();
  IK.g.subVectors(targetWorld, IK.a).normalize();
  IK.q.setFromUnitVectors(IK.f, IK.g);
  bone.getWorldQuaternion(IK.q2).premultiply(IK.q);
  bone.parent.getWorldQuaternion(IK.pq);
  bone.quaternion.copy(IK.pq.invert().multiply(IK.q2));
  bone.updateMatrixWorld(true);
}
function solveArm(upper, lower, hand, target, pole) {
  const A = upper.getWorldPosition(new V3()), Bw = lower.getWorldPosition(new V3()), C = hand.getWorldPosition(new V3());
  const l1 = A.distanceTo(Bw), l2 = Bw.distanceTo(C);
  const dir = IK.t.subVectors(target, A); const d = clamp(dir.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3); dir.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const perp = IK.p.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = IK.e.copy(A).addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
  aimBone(upper, Bw, elbow);
  lower.getWorldPosition(Bw); hand.getWorldPosition(C);
  aimBone(lower, C, IK.c.copy(A).addScaledVector(dir, d));
}

const enemies = [];
const enemyParts = [];
const flying = [];
const pickups = [];
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();

class Enemy {
  constructor(type, pos, spot = null) {
    this.type = type; this.T = ENEMY_TYPES[type];
    this.m = buildSoldier(type);
    this.pos = pos.clone(); this.vel = new V3();
    this.yaw = Math.atan2(-(player.pos.x - pos.x), -(player.pos.z - pos.z));
    this.hp = this.T.hp * (1 + 0.045 * (G.wave - 1));
    this.dead = false; this.deadT = 0; this.alerted = !!this.T.static; this.los = false; this.hadLos = false; this.losT = Math.random() * 0.2;
    this.lastKnown = player.pos.clone(); this.huntT = 0; this.huntTarget = pos.clone();
    this.reaction = 0; this.burst = 0; this.shotT = 0; this.pauseT = rand(0.3, 1.0); this.firstBurst = true;
    this.strafe = 0; this.strafeT = 0; this.detour = 0; this.detourT = 0; this.stuckT = 0;
    this.walk = Math.random() * 6; this.flash = 0; this.flashT = 0; this.flinch = 0; this.revealUntil = -1; this.heardShot = -9;
    this.aimT = -rand(0.8, 1.6); this.spot = spot;
    this.post = null; this.flee = null; this.upT = 0; this.upBurst = 0; this.wasAlerted = this.alerted;
    for (const p of this.m.parts) { p.userData.enemy = this; enemyParts.push(p); }
    this.m.root.position.copy(this.pos);
    this.m.root.rotation.y = this.yaw;
    scene.add(this.m.root);
  }
  eyeInto(v) { return v.set(this.pos.x, this.pos.y + 1.7 * this.T.scale, this.pos.z); }
  chestInto(v) { return v.set(this.pos.x, this.pos.y + 1.3 * this.T.scale, this.pos.z); }
  damage(amount, part, dir, cause, dist) {
    if (this.dead) return false;
    this.hp -= amount; this.flash = 0.09; this.flinch = 0.18;
    this.alerted = true; this.lastKnown.copy(player.pos); this.reaction = Math.min(this.reaction, 0.25);
    if (this.hp <= 0) { this.die(part, dir, cause, dist); return true; }
    return false;
  }
  die(part, dir, cause, dist) {
    this.dead = true; this.deadT = 0;
    for (const p of this.m.parts) { const i = enemyParts.indexOf(p); if (i >= 0) enemyParts.splice(i, 1); }
    this.m.flash.visible = false;
    if (this.m.laser) this.m.laser.visible = false;
    if (this.m.glint) this.m.glint.visible = false;
    if (this.spot) this.spot.used = false;
    this.m.root.rotation.y = Math.atan2(dir.x, dir.z);
    this.m.root.rotation.z = rand(-0.25, 0.25);
    this.fallSpeed = cause === 'frag' || cause === 'air' ? 2.6 : 1.6;
    if (part === 'head' && cause !== 'frag' && cause !== 'air' && !this.m.rig) {
      const h = this.m.helmet;
      scene.attach(h);
      flying.push({ obj: h, v: new V3(dir.x * 4 + rand(-1, 1), rand(3, 5), dir.z * 4 + rand(-1, 1)), s: new V3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), t: 0 });
    }
    if (!this.T.static && Math.random() < 0.4) dropAmmo(this.pos.x, this.pos.z);
    onEnemyKilled(this, cause, part, dist);
  }
  remove() {
    scene.remove(this.m.root);
    if (this.m.laser) scene.remove(this.m.laser);
    if (this.m.rig) this.m.rig.mixer.stopAllAction();
    for (const m of this.m.mats) m.dispose();
  }
  update(dt) {
    const m = this.m;
    if (this.dead) {
      this.deadT += dt;
      const k = ease(Math.min(this.deadT * this.fallSpeed, 1));
      m.root.rotation.x = k * Math.PI * 0.49;
      m.legL.rotation.x = damp(m.legL.rotation.x, 0.2, 6, dt); m.legR.rotation.x = damp(m.legR.rotation.x, -0.1, 6, dt);
      m.root.position.y = this.pos.y - (this.deadT > 7 ? (this.deadT - 7) * 0.5 : 0);
      return this.deadT < 9;
    }
    const T = this.T, Pl = player;
    const dx = Pl.pos.x - this.pos.x, dz = Pl.pos.z - this.pos.z, distH = Math.hypot(dx, dz) || 0.001;
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = rand(0.14, 0.24); this.los = Pl.alive && hasLOS(this.eyeInto(_a), camera.position); }
    if (this.los) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const facing = (fx * dx + fz * dz) / distH;
      const per = (G.flashlight ? 1 : (ENV.perception || 1)) * (Pl.crouch ? 0.65 : Pl.sprinting ? 1.25 : 1);
      const sees = distH < 110 * per && (facing > 0.15 || distH < 12 * per + 2);
      const noticed = this.alerted || sees || (G.time - G.lastShotT < 0.6 && distH < 55);
      if (noticed && distH < 110) {
        if (!this.alerted) { this.alerted = true; this.reaction = rand(0.55, 0.95) * T.react; }
        this.lastKnown.copy(Pl.pos);
      }
      if (!this.hadLos && this.alerted) this.reaction = Math.max(this.reaction, rand(0.25, 0.45) * T.react);
    } else if (!this.alerted && G.time - G.lastShotT < 0.3 && distH < 45) {
      this.alerted = true; this.lastKnown.set(Pl.pos.x + rand(-5, 5), 0, Pl.pos.z + rand(-5, 5));
    }
    this.hadLos = this.los;
    if (this.alerted && !this.wasAlerted) { this.wasAlerted = true; onEnemyAlert(this); }

    let mx = 0, mz = 0, speed = T.speed, fX = 0, fZ = 0;
    const U = G.uplink && G.uplink.hp > 0 ? G.uplink.pos : null;
    if (T.static) {
      if (this.alerted) { fX = dx; fZ = dz; }
      this.updateMarksman(dt, distH);
    } else if (this.flee && this.alerted) {
      const tx = this.flee.x - this.pos.x, tz = this.flee.z - this.pos.z, d = Math.hypot(tx, tz) || 1;
      mx = tx / d; mz = tz / d; speed = T.run; fX = mx; fZ = mz;
      if (this.los && Pl.alive && distH < 30) { fX = dx; fZ = dz; this.shoot(dt, distH); }
    } else if (U && !(this.alerted && this.los && distH < 26)) {
      const ux = U.x - this.pos.x, uz = U.z - this.pos.z, ud = Math.hypot(ux, uz) || 1;
      if (ud > 15) { mx = ux / ud; mz = uz / ud; speed = T.run * 0.85; fX = mx; fZ = mz; }
      else {
        fX = ux; fZ = uz;
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = rand(1, 2.4); this.strafe = [-1, 1, 0][randInt(0, 2)]; }
        mx = -uz / ud * this.strafe * 0.5; mz = ux / ud * this.strafe * 0.5; speed = T.speed * 0.6;
        this.attackUplink(dt, U, distH);
      }
    } else if (this.alerted && this.los && Pl.alive) {
      const nx = dx / distH, nz = dz / distH;
      fX = nx; fZ = nz;
      const fwd = distH > T.range[1] ? 1 : distH < T.range[0] ? -0.6 : 0;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(0.7, 2.0); this.strafe = [-1, 1, 0, -1, 1][randInt(0, 4)]; }
      mx = nx * fwd - nz * this.strafe * 0.9; mz = nz * fwd + nx * this.strafe * 0.9;
      speed = T.speed * 0.85;
      this.shoot(dt, distH);
    } else if (this.alerted) {
      const tx = this.lastKnown.x - this.pos.x, tz = this.lastKnown.z - this.pos.z, d = Math.hypot(tx, tz);
      if (d < 2.5) this.lastKnown.set(Pl.pos.x + rand(-7, 7), 0, Pl.pos.z + rand(-7, 7));
      mx = tx / (d || 1); mz = tz / (d || 1); speed = T.run; fX = mx; fZ = mz;
      this.burst = 0;
    } else {
      this.huntT -= dt;
      if (this.huntT <= 0) {
        this.huntT = rand(3, 6);
        const c = this.post || Pl.pos, r = this.post ? 6 : 14;
        this.huntTarget.set(c.x + rand(-r, r), 0, c.z + rand(-r, r));
        if (this.post && Math.random() < 0.35) this.huntTarget.copy(this.pos);
      }
      const tx = this.huntTarget.x - this.pos.x, tz = this.huntTarget.z - this.pos.z, d = Math.hypot(tx, tz);
      if (d > 2) { mx = tx / d; mz = tz / d; }
      if (this.post) speed = T.speed * 0.42;
      fX = mx; fZ = mz;
    }

    if (!T.static) {
      if (this.detourT > 0) { this.detourT -= dt; const c = Math.cos(this.detour), s = Math.sin(this.detour); const rx = mx * c - mz * s; mz = mx * s + mz * c; mx = rx; }
      for (const o of enemies) {
        if (o === this || o.dead || o.T.static) continue;
        const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, d2 = ox * ox + oz * oz;
        if (d2 < 2.25 && d2 > 1e-4) { const d = Math.sqrt(d2); mx += (ox / d) * (1.5 - d); mz += (oz / d) * (1.5 - d); }
      }
      const ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      this.vel.x = damp(this.vel.x, mx * speed, 8, dt); this.vel.z = damp(this.vel.z, mz * speed, 8, dt);
      const px = this.pos.x, pz = this.pos.z;
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      collideCircle(this.pos, 0.38 * T.scale, 0, 1.8);
      const moved = Math.hypot(this.pos.x - px, this.pos.z - pz), expected = Math.hypot(this.vel.x, this.vel.z) * dt;
      if (ml > 0.3 && expected > 0.001 && moved < expected * 0.4) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.3 && this.detourT <= 0) { this.detour = (Math.random() < 0.5 ? -1 : 1) * rand(1.2, 1.9); this.detourT = rand(0.8, 1.7); this.stuckT = 0; }
    }
    if (fX || fZ) this.yaw = dampAngle(this.yaw, Math.atan2(-fX, -fZ), 9, dt);

    const sp = Math.hypot(this.vel.x, this.vel.z), amt = Math.min(sp / 3, 1);
    this.walk += dt * sp * 2.7;
    const sw = Math.sin(this.walk) * amt * 0.65;
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
    m.body.position.y = Math.abs(Math.cos(this.walk)) * 0.045 * amt;
    this.flinch = Math.max(0, this.flinch - dt);
    m.body.rotation.x = this.flinch * 1.3;
    if (this.flash > 0) { this.flash -= dt; for (const mt of m.mats) mt.emissive.setHex(this.flash > 0 ? 0x661a10 : 0); }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) m.flash.visible = false; }
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    if (m.rig) this.animateRig(dt, sp, distH);
    return true;
  }
  animateRig(dt, sp, distH) {
    const m = this.m, r = m.rig;
    const want = sp < 0.3 ? 'Idle' : sp < 3.7 ? 'Walk' : 'Run';
    for (const k of ['Idle', 'Walk', 'Run']) { r.w[k] = damp(r.w[k], k === want ? 1 : 0, 7, dt); r.act[k].setEffectiveWeight(r.w[k]); }
    r.act.Walk.timeScale = clamp(sp / 1.6, 0.5, 2.2); r.act.Run.timeScale = clamp(sp / 4.6, 0.6, 1.5);
    r.mixer.update(dt);
    const engaged = this.alerted && this.los && player.alive;
    const pitch = engaged || this.T.static ? Math.atan2(camera.position.y - (this.pos.y + 1.37 * this.T.scale), distH) : -0.45;
    m.gun.rotation.x = damp(m.gun.rotation.x, clamp(pitch, -0.9, 0.9), 9, dt);
    m.gun.position.y = (1.37 - (this.dead ? 0 : Math.abs(Math.sin(this.walk)) * 0.025 * Math.min(sp / 3, 1))) * this.T.scale;
    if (r.spine) r.spine.rotation.x -= this.flinch * 1.6;
    m.root.updateMatrixWorld(true);
    const yaw = this.yaw, rx = Math.cos(yaw), rz = -Math.sin(yaw);
    solveArm(r.rArm, r.rFore, r.rHand, m.gun.localToWorld(IK.b.set(0, -0.08, 0.06)), _d.set(rx * 0.7, -1, rz * 0.7));
    solveArm(r.lArm, r.lFore, r.lHand, m.gun.localToWorld(IK.b.set(-0.01, -0.04, -0.3)), _d.set(-rx * 0.9, -1, -rz * 0.9));
  }
  shoot(dt, dist) {
    if (!player.alive) return;
    if (this.reaction > 0) { this.reaction -= dt; return; }
    if (this.burst > 0) {
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.fireShot(dist);
        this.burst--; this.shotT = this.T.interval * rand(0.9, 1.15);
        if (this.burst === 0) { this.pauseT = rand(...this.T.pause); this.firstBurst = false; }
      }
    } else {
      this.pauseT -= dt;
      if (this.pauseT <= 0) this.burst = randInt(...this.T.burst);
    }
  }
  attackUplink(dt, U, distH) {
    this.upT -= dt;
    if (this.upT > 0) return;
    if (this.upBurst <= 0) { this.upBurst = randInt(...this.T.burst); this.upT = rand(...this.T.pause); return; }
    this.upBurst--; this.upT = this.T.interval * rand(0.9, 1.2);
    const m = this.m;
    m.muzzle.getWorldPosition(_a);
    _c.set(U.x + rand(-0.8, 0.8), rand(0.4, 3.5), U.z + rand(-0.8, 0.8));
    spawnTracer(_a, _c, false);
    m.flash.visible = true; m.flash.material.rotation = Math.random() * 6; this.flashT = 0.05;
    impactFX(_c, _d.subVectors(_a, _c).normalize(), false, 'metal');
    Sfx.enemyShot(distH, panFor(this.pos), this.type === 'heavy');
    this.revealUntil = G.time + 1.6;
    G.uplink.hp -= this.T.dmg * 0.032; G.uplink.hitT = G.time;
  }
  hitChance(dist) {
    const Pl = player;
    let p = this.T.acc * clamp(1.15 - dist / 80, 0.15, 1);
    p *= 1 - clamp(Math.hypot(Pl.vel.x, Pl.vel.z) / 9, 0, 1) * 0.45;
    if (Pl.crouch) p *= 0.85;
    if (Pl.slide > 0) p *= 0.5;
    if (!Pl.onGround) p *= 0.7;
    if (this.firstBurst) p *= 0.55;
    return p * Math.min(1 + (G.wave - 1) * 0.035, 1.5);
  }
  fireShot(dist) {
    const m = this.m;
    m.muzzle.getWorldPosition(_a);
    m.flash.visible = true; m.flash.material.rotation = Math.random() * 6; this.flashT = 0.05;
    this.revealUntil = G.time + 1.6;
    const pan = panFor(this.pos);
    const heavy = this.type === 'heavy';
    Sfx.enemyShot(dist, pan, heavy);
    if (Math.random() < this.hitChance(dist)) {
      hurtPlayer(this.T.dmg * (1 + (G.wave - 1) * 0.03), this.pos);
      _b.subVectors(camera.position, _a); const L = _b.length(); _b.normalize();
      _c.copy(_a).addScaledVector(_b, Math.max(0, L - 1.2)); _c.y -= 0.25;
      spawnTracer(_a, _c, false);
    } else {
      _c.copy(camera.position).add(_d.set(rand(-1, 1) * 1.7, rand(-0.9, 1.3), rand(-1, 1) * 1.7));
      _b.subVectors(_c, _a).normalize();
      const t = rayWorld(_a, _b, 160);
      const n = hitNormal.clone(), surf = hitSurf;
      _c.copy(_a).addScaledVector(_b, t);
      if (Math.random() < 0.6) spawnTracer(_a, _c, false);
      if (t < 160) impactFX(_c, n, false, surf);
      _d.subVectors(camera.position, _a);
      const proj = clamp(_d.dot(_b), 0, t);
      const closest = _d.addScaledVector(_b, -proj).length();
      if (closest < 2.4) Sfx.whizz(pan);
    }
  }
  updateMarksman(dt, dist) {
    const m = this.m, Pl = player;
    if (this.aimT < 0) { this.aimT += dt; m.laser.visible = false; m.glint.visible = false; return; }
    if (this.alerted && this.los && Pl.alive) {
      this.aimT += dt;
      const k = clamp(this.aimT / this.T.aim, 0, 1);
      m.muzzle.getWorldPosition(_a);
      const wob = (1 - k) * 1.6;
      _b.copy(camera.position).add(_c.set(Math.sin(G.time * 3.1) * wob, Math.sin(G.time * 2.3) * wob * 0.5 - 0.15, Math.cos(G.time * 2.7) * wob));
      const pos = m.laser.geometry.attributes.position;
      pos.setXYZ(0, _a.x, _a.y, _a.z); pos.setXYZ(1, _b.x, _b.y, _b.z); pos.needsUpdate = true;
      m.laser.visible = true;
      m.glint.visible = true; m.glint.scale.setScalar(0.03 + 0.03 * Math.abs(Math.sin(G.time * 9)));
      this.revealUntil = G.time + 0.3;
      if (this.aimT >= this.T.aim) {
        const moving = Math.hypot(Pl.vel.x, Pl.vel.z) > 4;
        const p = this.T.acc * (moving ? 0.5 : 1) * (Pl.crouch ? 0.9 : 1) * (Pl.slide > 0 ? 0.4 : 1);
        m.flash.visible = true; this.flashT = 0.06;
        Sfx.sniperEnemy(dist, panFor(this.pos));
        if (Math.random() < p) { hurtPlayer(this.T.dmg * (1 + (G.wave - 1) * 0.02), this.pos); spawnTracer(_a, _c.copy(camera.position).setY(camera.position.y - 0.3), false); }
        else { spawnTracer(_a, _b.addScaledVector(_c.subVectors(_b, _a).normalize(), 20), false); Sfx.whizz(panFor(this.pos)); }
        this.aimT = -this.T.cooldown;
        m.laser.visible = false; m.glint.visible = false;
      }
    } else {
      m.laser.visible = false; m.glint.visible = false;
      this.aimT = Math.max(0, this.aimT - dt * 2);
    }
  }
}

const ammoStripe = std({ color: 0xf0a53a, emissive: 0xf0a53a, emissiveIntensity: 1.3 });
function dropAmmo(x, z) {
  const g = new THREE.Group();
  P(g, B(0.5, 0.28, 0.32), vmMat.olive, 0, 0, 0).castShadow = true;
  P(g, B(0.52, 0.05, 0.34), ammoStripe, 0, 0.06, 0);
  g.position.set(x, 0.35, z); scene.add(g);
  pickups.push({ g, t: 0 });
}

// ---------------------------------------------------------------- game state
const G = {
  mode: 'menu', paused: false, time: 0, timeScale: 1, shake: 0,
  wave: 0, wavesCleared: 0, toSpawn: 0, marksToSpawn: 0, spawnT: 0, maxAlive: 4, intermission: 0,
  score: 0, kills: 0, headshots: 0, shots: 0, hits: 0, streak: 0, bestStreak: 0,
  uavUntil: -1, strikes: 0, lastKillT: -9, multi: 0, lastShotT: -9, nextBoom: 12, heartT: 0, deathT: 0,
};
const timers = [];
const after = (sec, fn) => timers.push({ t: G.time + sec, fn });

const player = {
  pos: PLAYER_START.clone(), vel: new V3(), yaw: 0, pitch: 0, recoilPitch: 0,
  onGround: true, crouch: false, slide: 0, sprinting: false, eye: 1.62, hp: 100, lastHurt: -99, alive: true, bobT: 0, stepSign: 1, roll: 0,
};
const input = { keys: {}, fire: false, fireQueued: false, ads: false, jump: false, lookDX: 0, lookDY: 0 };
const touch = { moveX: 0, moveY: 0, fire: false, ads: false, sprint: false, use: false };

function panFor(p) {
  const bearing = Math.atan2(p.x - player.pos.x, -(p.z - player.pos.z));
  return clamp(Math.sin(wrapAngle(bearing + player.yaw)), -0.9, 0.9);
}
function bearingOf(p) { return Math.atan2(p.x - player.pos.x, -(p.z - player.pos.z)); }

// ---------------------------------------------------------------- player
function hurtPlayer(dmg, from, explosive = false) {
  if (!player.alive || G.mode !== 'play') return;
  player.hp -= dmg; player.lastHurt = G.time;
  addDamageIndicator(from);
  Sfx.hurt();
  G.shake = Math.max(G.shake, explosive ? 0.9 : 0.22);
  player.recoilPitch += explosive ? 0.03 : 0.008;
  if (player.hp < 22 && G.streak > 0) { G.streak = 0; addPopup(0, 'STREAK LOST'); updateStreakHUD(); }
  if (player.hp <= 0) die();
}
function die() {
  player.hp = 0; player.alive = false; G.mode = 'dead'; G.deathT = 0; G.timeScale = 0.35; G.result = 'kia'; G.missionTime = G.time;
  canvas.classList.add('dying');
  ws.reloading = false;
  showBanner('Man down', 'You were killed', 'danger', 2.2);
  const best = store.get('best', { score: 0, wave: 0 });
  if (MISSION.mode === 'waves' && (G.score > best.score || G.wavesCleared > best.wave)) store.set('best', { score: Math.max(best.score, G.score), wave: Math.max(best.wave, G.wavesCleared) });
  setTimeout(showGameOver, 2300);
}
function updatePlayer(dt) {
  const Pl = player;
  if (!Pl.alive) {
    G.deathT += dt;
    Pl.eye = damp(Pl.eye, 0.3, 3, dt); Pl.roll = damp(Pl.roll, 1.1, 2.5, dt); Pl.pitch = damp(Pl.pitch, 0.25, 2, dt);
    return;
  }
  const k = input.keys;
  let ix = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + touch.moveX;
  let iz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0) + touch.moveY;
  const il = Math.hypot(ix, iz);
  if (il > 1) { ix /= il; iz /= il; }
  const sy = Math.sin(Pl.yaw), cy = Math.cos(Pl.yaw);
  const wx = cy * ix - sy * iz, wz = -sy * ix - cy * iz;
  const W = WEAPONS[ws.cur];
  const wantSprint = (k.ShiftLeft || k.ShiftRight || touch.sprint) && iz > 0.5 && !input.fire && !touch.fire && !(input.ads || touch.ads) && vm.meleeT <= 0;
  Pl.sprinting = wantSprint && Pl.slide <= 0 && (Pl.onGround || Pl.sprinting);
  if (Pl.sprinting && Pl.crouch) Pl.crouch = false;
  let speed = 5.0 * W.mobility;
  if (Pl.sprinting) speed = 7.8 * W.mobility; else if (Pl.crouch) speed = 2.7;
  if (vm.adsT > 0.5) speed *= 0.62;
  if (Pl.slide > 0) {
    Pl.slide -= dt;
    const f = Math.exp(-1.4 * dt); Pl.vel.x *= f; Pl.vel.z *= f;
    Pl.vel.x += wx * 3 * dt; Pl.vel.z += wz * 3 * dt;
    if (Pl.slide <= 0) Pl.crouch = true;
  } else {
    const acc = Pl.onGround ? 14 : 2.5;
    Pl.vel.x = damp(Pl.vel.x, wx * speed, acc, dt); Pl.vel.z = damp(Pl.vel.z, wz * speed, acc, dt);
  }
  if (input.jump) {
    input.jump = false;
    if (Pl.onGround) {
      if (Pl.crouch && Pl.slide <= 0) Pl.crouch = false;
      else { Pl.vel.y = 7.4; Pl.onGround = false; Pl.slide = 0; Pl.crouch = false; }
    }
  }
  Pl.vel.y -= 22 * dt;
  const headH = Pl.crouch || Pl.slide > 0 ? 1.2 : 1.75;
  Pl.pos.x += Pl.vel.x * dt; Pl.pos.z += Pl.vel.z * dt;
  collideCircle(Pl.pos, 0.35, Pl.pos.y, Pl.pos.y + headH);
  Pl.pos.y += Pl.vel.y * dt;
  const g = groundHeightAt(Pl.pos.x, Pl.pos.z, Pl.pos.y + 0.55, 0.25);
  if (Pl.pos.y <= g + 0.001) {
    if (!Pl.onGround && Pl.vel.y < -7) { G.shake = Math.max(G.shake, 0.18); Sfx.land(); }
    Pl.pos.y = g; if (Pl.vel.y < 0) Pl.vel.y = 0; Pl.onGround = true;
  } else if (Pl.pos.y - g > 0.06) Pl.onGround = false;

  const targetEye = Pl.slide > 0 ? 0.9 : Pl.crouch ? 1.05 : 1.62;
  Pl.eye = damp(Pl.eye, targetEye, 12, dt);
  const hs = Math.hypot(Pl.vel.x, Pl.vel.z);
  if (Pl.onGround && hs > 0.6 && Pl.slide <= 0) {
    Pl.bobT += dt * hs * 1.55;
    const s = Math.sign(Math.sin(Pl.bobT));
    if (s !== Pl.stepSign) { Pl.stepSign = s; Sfx.foot(Pl.sprinting ? 0.22 : Pl.crouch ? 0.08 : 0.15); }
  }
  Pl.roll = damp(Pl.roll, (Pl.slide > 0 ? 0.09 : 0) - ix * 0.012, 8, dt);
  if (G.time - Pl.lastHurt > 4 && Pl.hp < 100) Pl.hp = Math.min(100, Pl.hp + 32 * dt);
  if (Pl.hp < 35) { G.heartT -= dt; if (G.heartT <= 0) { G.heartT = 0.9; Sfx.heartbeat(); } }
}
function crouchPress() {
  const Pl = player;
  if (!Pl.alive) return;
  const hs = Math.hypot(Pl.vel.x, Pl.vel.z);
  if (Pl.sprinting && Pl.onGround && hs > 5.5) {
    Pl.slide = 0.8; Pl.crouch = true; Pl.sprinting = false;
    Pl.vel.x = (Pl.vel.x / hs) * 11.5; Pl.vel.z = (Pl.vel.z / hs) * 11.5;
    Sfx.slide();
  } else if (Pl.slide <= 0) Pl.crouch = !Pl.crouch;
}

function updateCamera(dt) {
  const Pl = player;
  G.shake = Math.max(0, G.shake - dt * 1.8);
  const s = G.shake * G.shake;
  Pl.recoilPitch = damp(Pl.recoilPitch, 0, 9, dt);
  const bob = Pl.onGround && Pl.slide <= 0 ? Math.abs(Math.sin(Pl.bobT)) * 0.04 * clamp(Math.hypot(Pl.vel.x, Pl.vel.z) / 5, 0, 1.4) * (1 - vm.adsT * 0.8) : 0;
  camera.position.set(Pl.pos.x + rand(-1, 1) * s * 0.06, Pl.pos.y + Pl.eye + bob + rand(-1, 1) * s * 0.06, Pl.pos.z + rand(-1, 1) * s * 0.06);
  camera.rotation.set(Pl.pitch + Pl.recoilPitch + rand(-1, 1) * s * 0.012, Pl.yaw + rand(-1, 1) * s * 0.012, Pl.roll);
  const W = WEAPONS[ws.cur];
  const base = baseFov();
  let fov = lerp(base, base * W.zoom, ease(vm.adsT));
  fov *= 1 + 0.07 * vm.sprintT + (Pl.slide > 0 ? 0.08 : 0);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = damp(camera.fov, fov, 18, dt); camera.updateProjectionMatrix(); updateParticleScale(); }
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- shooting
const raycaster = new THREE.Raycaster();
const _fwd = new V3(), _right = new V3(), _up = new V3(), _dir = new V3(), _mz = new V3();
function currentSpread(W) {
  const Pl = player;
  let s = lerp(W.hip, W.ads, ease(vm.adsT));
  const mv = clamp(Math.hypot(Pl.vel.x, Pl.vel.z) / 5, 0, 1.5);
  s *= 1 + mv * 0.7 * (1 - vm.adsT * 0.7);
  if (!Pl.onGround) s *= 2;
  if (Pl.crouch && Pl.slide <= 0) s *= 0.8;
  return s + ws.bloom * (1 - vm.adsT * 0.65);
}
function muzzleWorld(out) {
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const a = ease(vm.adsT);
  return out.copy(camera.position).addScaledVector(_fwd, 0.75).addScaledVector(_right, 0.16 * (1 - a)).addScaledVector(_up, -0.13 * (1 - a) - 0.04 * a);
}
function fireWeapon(W, S) {
  S.mag--; ws.fireCd = 60 / W.rpm; G.shots++; G.lastShotT = G.time;
  const spread = currentSpread(W);
  const o = camera.position;
  muzzleWorld(_mz);
  let anyHit = false, killed = false, head = false;
  for (let i = 0; i < W.pellets; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    _dir.copy(_fwd).addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    const res = hitscan(o, _dir, W, i % 3 === 0);
    if (res.hit) { anyHit = true; killed ||= res.kill; head ||= res.head; }
  }
  if (anyHit) { G.hits++; showHitmarker(killed, head); Sfx.hit(killed, head); }
  const rk = W.recoil * (1 - vm.adsT * 0.3) * (player.crouch ? 0.8 : 1);
  player.recoilPitch += rk * 0.65; player.pitch = clamp(player.pitch + rk * 0.35, -1.5, 1.5); player.yaw += (Math.random() - 0.5) * rk * 0.7;
  ws.bloom = Math.min(ws.bloom + W.bloom, 0.05);
  vm.kick = Math.min(vm.kick + (W.id === 'sg' || W.id === 'sr' ? 0.075 : 0.022), 0.11);
  const model = vm.models[ws.cur];
  model.flash.visible = true; model.flash.material.rotation = Math.random() * 6.28; vm.flashT = 0.045;
  muzzleLight.position.copy(_mz); muzzleLight.intensity = W.id === 'sg' || W.id === 'sr' ? 90 : 55;
  vmFlashLight.position.copy(model.muzzle).applyMatrix4(model.g.matrixWorld); vmFlashLight.intensity = 3;
  if (W.id !== 'sg' && W.id !== 'sr') ejectShell(model);
  if (W.id === 'sg') { vm.pumpT = 0.6; after(0.35, () => ejectShell(model)); }
  if (W.id === 'sr') { vm.boltT = 1.0; after(0.55, () => ejectShell(model)); }
  Sfx.shot(W.id);
}
function hitscan(o, d, W, drawTracer) {
  const tW = rayWorld(o, d, W.range);
  const n = hitNormal.clone(), surf = hitSurf;
  raycaster.set(o, d); raycaster.near = 0; raycaster.far = tW;
  const hits = enemyParts.length ? raycaster.intersectObjects(enemyParts, false) : [];
  const res = { hit: false, kill: false, head: false };
  let end;
  if (hits.length) {
    const h = hits[0], e = h.object.userData.enemy, part = h.object.userData.part;
    let dmg = W.dmg * lerp(1, W.falloff[2], smoothstep(W.falloff[0], W.falloff[1], h.distance));
    if (part === 'head') dmg *= W.head; else if (part === 'limb') dmg *= 0.8;
    res.hit = true; res.head = part === 'head';
    res.kill = e.damage(dmg, part, d, W.id, h.distance);
    bloodFX(h.point, d);
    end = h.point;
  } else {
    end = _c.copy(o).addScaledVector(d, tW).clone();
    if (tW < W.range) { impactFX(end, n, W.id === 'sr', surf); placeDecal(end, n, (W.id === 'sg' ? 0.09 : 0.13) * (surf === 'sand' ? 0.7 : 1), holeMat); }
  }
  if (drawTracer) spawnTracer(_mz, end, true);
  return res;
}
function ejectShell(model) {
  const sh = shells[shellIdx]; shellIdx = (shellIdx + 1) % shells.length;
  sh.m.position.copy(model.eject).applyMatrix4(model.g.matrixWorld);
  sh.v.set(rand(1.2, 1.8), rand(1.0, 1.6), rand(0.1, 0.5));
  sh.s.set(rand(-20, 20), rand(-20, 20), rand(-20, 20));
  sh.t = 0.7; sh.m.visible = true;
}
function startReload() {
  const W = WEAPONS[ws.cur], S = ws.state[ws.cur];
  if (ws.reloading || S.mag >= W.mag || S.reserve <= 0 || !player.alive || vm.raiseT > 0) return;
  ws.reloading = true; ws.reloadT = W.reload;
  Sfx.reload(W.reload);
}
function finishReload() {
  const W = WEAPONS[ws.cur], S = ws.state[ws.cur];
  const take = Math.min(W.mag - S.mag, S.reserve);
  S.mag += take; S.reserve -= take; ws.reloading = false;
}
function switchWeapon(i) {
  if (i === ws.cur || i < 0 || i >= WEAPONS.length || !player.alive) return;
  ws.cur = i; ws.reloading = false; ws.fireCd = 0.1; vm.raiseT = 0.42; vm.pumpT = 0; vm.boltT = 0;
  vm.models.forEach((m, j) => { m.g.visible = j === i; });
  Sfx.mech(0.02, 1400, 0.2);
  refreshWeaponHUD(true);
}
function updateWeapons(dt) {
  const W = WEAPONS[ws.cur], S = ws.state[ws.cur];
  ws.fireCd -= dt; ws.bloom = Math.max(0, ws.bloom - dt * 0.12);
  if (vm.raiseT > 0) vm.raiseT -= dt;
  if (vm.meleeT > 0) vm.meleeT -= dt;
  if (vm.throwT > 0) vm.throwT -= dt;
  if (vm.pumpT > 0) vm.pumpT -= dt;
  if (vm.boltT > 0) vm.boltT -= dt;
  if (ws.reloading) { ws.reloadT -= dt; if (ws.reloadT <= 0) finishReload(); }
  const wantAds = (input.ads || touch.ads) && player.alive && !player.sprinting && vm.meleeT <= 0 && player.slide <= 0.3;
  vm.adsT = clamp(vm.adsT + ((wantAds ? 1 : -1) * dt) / W.adsTime, 0, 1);
  if (!player.alive) return;
  const holding = input.fire || touch.fire;
  const canFire = !ws.reloading && vm.raiseT <= 0 && vm.meleeT <= 0 && vm.throwT <= 0 && ws.fireCd <= 0 && !player.sprinting;
  if (canFire && (holding || input.fireQueued)) {
    if (S.mag > 0) {
      if (W.auto ? holding : input.fireQueued) { fireWeapon(W, S); input.fireQueued = false; }
    } else if (input.fireQueued) { input.fireQueued = false; Sfx.dry(); ws.fireCd = 0.25; startReload(); }
  }
  if (S.mag === 0 && S.reserve > 0 && !ws.reloading && ws.fireCd <= 0) startReload();
}
function throwGrenade() {
  if (ws.nades <= 0 || vm.throwT > 0 || !player.alive) return;
  ws.nades--; vm.throwT = 0.6; ws.reloading = false;
  Sfx.mech(0, 4200, 0.15); Sfx.swish();
  after(0.22, () => {
    if (!player.alive) return;
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), vmMat.olive); g.castShadow = true;
    g.position.copy(camera.position).addScaledVector(_fwd, 0.5); scene.add(g);
    const v = _fwd.clone().multiplyScalar(18).add(new V3(player.vel.x * 0.5, 3.6, player.vel.z * 0.5));
    grenades.push({ m: g, v, fuse: 2.2, lastBounce: 0 });
  });
  refreshWeaponHUD();
}
const grenades = [];
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const gr = grenades[i];
    gr.fuse -= dt; gr.lastBounce -= dt;
    gr.v.y -= 20 * dt;
    const step = gr.v.length() * dt;
    if (step > 1e-4) {
      _dir.copy(gr.v).normalize();
      const t = rayWorld(gr.m.position, _dir, step + 0.08);
      if (t <= step + 0.07) {
        gr.m.position.addScaledVector(_dir, Math.max(0, t - 0.08));
        const vn = gr.v.dot(hitNormal);
        gr.v.addScaledVector(hitNormal, -2 * vn).multiplyScalar(0.42);
        if (gr.lastBounce <= 0 && Math.abs(vn) > 2) { Sfx.bounce(gr.m.position.distanceTo(camera.position)); gr.lastBounce = 0.1; }
      } else gr.m.position.addScaledVector(_dir, step);
    }
    gr.m.rotation.x += dt * 8; gr.m.rotation.z += dt * 5;
    if (gr.fuse <= 0) { scene.remove(gr.m); gr.m.geometry.dispose(); grenades.splice(i, 1); explode(gr.m.position.clone(), { cause: 'frag' }); }
  }
}
function melee() {
  if (vm.meleeT > 0 || !player.alive) return;
  vm.meleeT = 0.5; ws.reloading = false;
  Sfx.swish();
  after(0.12, () => {
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    let best = null, bd = 2.7;
    for (const e of enemies) {
      if (e.dead) continue;
      _a.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z);
      const d = _a.length();
      if (d < bd && _a.normalize().dot(_b.set(_fwd.x, 0, _fwd.z).normalize()) > 0.5) { best = e; bd = d; }
    }
    if (best) { Sfx.thud(); best.damage(999, 'body', _b.clone(), 'melee', bd); showHitmarker(true, false); G.shake = Math.max(G.shake, 0.25); }
  });
}

// ---------------------------------------------------------------- kill streaks: UAV and airstrike
function activateUAV() {
  G.uavUntil = G.time + 30;
  showBanner('Kill streak', 'UAV online', 'uav', 2.2);
  Sfx.uav();
}
const jets = [];
const bombs = [];
const jetMat = std({ color: 0x5d646b, roughness: 0.5, metalness: 0.6 });
function buildJet() {
  const g = new THREE.Group();
  P(g, CZ(0.9, 0.5, 13, 10), jetMat, 0, 0, 0);
  P(g, new THREE.ConeGeometry(0.5, 3, 10).rotateX(-Math.PI / 2), jetMat, 0, 0, -8);
  P(g, B(12, 0.2, 3.2), jetMat, 0, 0, 1);
  P(g, B(4.6, 0.15, 1.6), jetMat, 0, 0.3, 5.6);
  P(g, B(0.2, 2.4, 1.8), jetMat, 0, 1.3, 5.6);
  P(g, B(0.8, 0.5, 2), vmMat.lens, 0, 0.7, -3.5);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.flash, color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  noAO(glow); glow.scale.set(3, 3, 3); glow.position.set(0, 0, 7); g.add(glow);
  scene.add(g);
  return g;
}
let strikeMark = null;
function callAirstrike() {
  if (G.strikes <= 0 || !player.alive) return;
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const t = rayWorld(camera.position, _fwd, 160);
  const target = camera.position.clone().addScaledVector(_fwd, Math.min(t, 90));
  target.y = 0;
  const dir = new V3(_fwd.x, 0, _fwd.z).normalize();
  G.strikes--;
  strikeMark = { p: target.clone(), until: G.time + 4.2 };
  showBanner('Airstrike', 'Inbound on your mark', '', 2.2);
  Sfx.radio();
  after(1.8, () => spawnJet(target, dir));
  refreshWeaponHUD();
}
function spawnJet(target, dir) {
  const g = buildJet();
  const start = target.clone().addScaledVector(dir, -280).setY(55);
  g.position.copy(start);
  g.lookAt(start.clone().sub(dir));
  jets.push({ g, start, dir: dir.clone(), t: 0, speed: 160 });
  Sfx.jet();
  const tOver = 280 / 160;
  for (let i = 0; i < 7; i++) {
    const off = (i - 3) * 5.5;
    const bp = target.clone().addScaledVector(dir, off).add(new V3(-dir.z, 0, dir.x).multiplyScalar(rand(-1.5, 1.5)));
    const release = tOver + (off - 20) / 160;
    after(release, () => {
      const rel = start.clone().addScaledVector(dir, 160 * release);
      const m = new THREE.Mesh(CZ(0.18, 0.18, 1.4, 8), EM.black); m.position.copy(rel); scene.add(m);
      bombs.push({ m, from: rel, to: bp, t: 0, dur: 1.0 });
    });
  }
}
function updateAir(dt) {
  for (let i = jets.length - 1; i >= 0; i--) {
    const j = jets[i];
    j.t += dt;
    j.g.position.copy(j.start).addScaledVector(j.dir, j.speed * j.t);
    j.g.rotation.z = Math.sin(j.t * 1.3) * 0.08;
    if (j.t > 4) { scene.remove(j.g); jets.splice(i, 1); }
  }
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.t += dt;
    const k = Math.min(b.t / b.dur, 1);
    b.m.position.lerpVectors(b.from, b.to, k);
    b.m.position.y = lerp(b.from.y, b.to.y, k * k);
    b.m.lookAt(b.to);
    if (k >= 1) {
      scene.remove(b.m); bombs.splice(i, 1);
      const gy = groundHeightAt(b.to.x, b.to.z, 50, 0.1);
      explode(new V3(b.to.x, gy, b.to.z), { radius: 8.5, dmg: 420, playerDmg: 0, cause: 'air' });
    }
  }
  if (strikeMark && G.time < strikeMark.until && Math.random() < dt * 30) {
    const p = strikeMark.p;
    fxSmoke.spawn(p.x + rand(-0.3, 0.3), 0.3, p.z + rand(-0.3, 0.3), rand(-0.4, 0.4), rand(2, 3.5), rand(-0.4, 0.4), 0.85, 0.14, 0.1, rand(0.8, 1.4), rand(2, 3), { drag: 0.6, grow: 1.2, alpha: 0.75 });
  }
}

// ---------------------------------------------------------------- waves and scoring
function startWave(n) {
  G.wave = n;
  G.toSpawn = Math.min(4 + n * 2, 30);
  G.maxAlive = Math.min(3 + n, 10);
  G.marksToSpawn = n >= 2 ? Math.min(1 + Math.floor((n - 2) / 2), 3) : 0;
  G.spawnT = 0.6;
  showBanner(`Wave ${n}`, n === 1 ? 'Contact front' : n % 5 === 0 ? 'Heavy assault' : 'Hostiles inbound', 'danger', 2.4);
  Sfx.horn();
}
function pickSpawn() {
  const opts = SPAWNS.map((p) => {
    const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    _a.set(p.x, 1.6, p.z);
    const seen = hasLOS(_a, camera.position);
    return { p, s: d - (seen ? 40 : 0) + rand(0, 12) - (d < 26 ? 200 : 0) };
  }).sort((a, b) => b.s - a.s);
  return opts[randInt(0, Math.min(3, opts.length - 1))].p;
}
function updateWaves(dt) {
  if (G.intermission > 0) {
    G.intermission -= dt;
    if (G.intermission <= 0) startWave(G.wave + 1);
    return;
  }
  if (G.wave === 0) return;
  G.spawnT -= dt;
  const aliveGround = enemies.filter((e) => !e.dead && !e.T.static).length;
  if (G.spawnT <= 0) {
    const spot = MARKSMAN_SPOTS.find((s) => !s.used);
    if (G.marksToSpawn > 0 && spot) {
      spot.used = true; G.marksToSpawn--;
      enemies.push(new Enemy('marksman', spot.pos, spot));
      G.spawnT = 1.2;
    } else if (G.toSpawn > 0 && aliveGround < G.maxAlive) {
      const heavyChance = G.wave >= 3 ? Math.min(0.08 * (G.wave - 2), 0.35) : 0;
      enemies.push(new Enemy(Math.random() < heavyChance ? 'heavy' : 'rifleman', pickSpawn()));
      G.toSpawn--;
      G.spawnT = rand(0.7, 1.6);
    } else G.spawnT = 0.4;
    if (G.marksToSpawn > 0 && !spot) G.marksToSpawn = 0;
  }
  if (G.toSpawn === 0 && G.marksToSpawn === 0 && !enemies.some((e) => !e.dead)) waveCleared();
}
function waveCleared() {
  const bonus = 250 * G.wave;
  G.score += bonus; G.wavesCleared = G.wave;
  showBanner(`Wave ${G.wave} cleared`, `+${bonus}`, '', 3);
  addPopup(bonus, 'WAVE CLEARED');
  ws.nades = Math.max(ws.nades, 3);
  WEAPONS.forEach((w, i) => { const S = ws.state[i]; S.reserve = Math.min(w.reserveMax, S.reserve + w.mag * 2); });
  G.intermission = 8;
  refreshWeaponHUD(true);
}
function onEnemyKilled(e, cause, part, dist) {
  G.kills++;
  let pts = e.T.score;
  const labels = [];
  const gun = !['frag', 'air', 'melee'].includes(cause);
  if (part === 'head' && gun) { pts += 50; labels.push('HEADSHOT'); G.headshots++; }
  if (cause === 'melee') { pts += 50; labels.push('MELEE'); }
  if (cause === 'frag') { pts += 25; labels.push('FRAG'); }
  if (cause === 'air') labels.push('AIRSTRIKE');
  if (dist > 45 && gun) { pts += 50; labels.push('LONGSHOT'); }
  if (G.time - G.lastKillT < 2.2) G.multi++; else G.multi = 1;
  G.lastKillT = G.time;
  if (G.multi === 2) { pts += 50; labels.push('DOUBLE KILL'); } else if (G.multi === 3) { pts += 100; labels.push('TRIPLE KILL'); } else if (G.multi >= 4) { pts += 150; labels.push('MULTI KILL'); }
  G.score += pts;
  addPopup(pts, labels.length ? labels.join(' · ') : `${e.T.name.toUpperCase()} DOWN`);
  addKillfeed(cause, e.T.name, part === 'head');
  if (cause !== 'air') {
    G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
    if (G.streak % 6 === 3) activateUAV();
    if (G.streak % 6 === 0) { G.strikes++; showBanner('Kill streak', IS_TOUCH ? 'Airstrike ready · tap AIR' : 'Airstrike ready · press B', '', 2.6); Sfx.radio(); }
  }
  updateStreakHUD(); refreshWeaponHUD();
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.t += dt;
    pk.g.rotation.y += dt * 1.6;
    pk.g.position.y = 0.35 + Math.sin(pk.t * 3) * 0.08;
    const d = Math.hypot(pk.g.position.x - player.pos.x, pk.g.position.z - player.pos.z);
    if (player.alive && d < 1.6 && player.pos.y < 1.5) {
      WEAPONS.forEach((w, j) => { const S = ws.state[j]; S.reserve = Math.min(w.reserveMax, S.reserve + w.mag); });
      ws.nades = Math.min(4, ws.nades + 1);
      addPopup(0, 'AMMO RESUPPLY'); Sfx.pickup(); refreshWeaponHUD(true);
      scene.remove(pk.g); pickups.splice(i, 1);
    } else if (pk.t > 30) { scene.remove(pk.g); pickups.splice(i, 1); }
  }
}
function updateFlying(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.t += dt;
    f.v.y -= 16 * dt;
    f.obj.position.addScaledVector(f.v, dt);
    f.obj.rotation.x += f.s.x * dt; f.obj.rotation.y += f.s.y * dt; f.obj.rotation.z += f.s.z * dt;
    const g = groundHeightAt(f.obj.position.x, f.obj.position.z, f.obj.position.y + 0.3, 0.05) + 0.1;
    if (f.obj.position.y < g) { f.obj.position.y = g; f.v.y *= -0.35; f.v.x *= 0.6; f.v.z *= 0.6; f.s.multiplyScalar(0.5); }
    if (f.t > 9) { scene.remove(f.obj); flying.splice(i, 1); }
  }
}
function updateFX(dt, rdt) {
  for (const ps of particleSystems) ps.update(dt);
  updateTracers(dt);
  for (let i = shocks.length - 1; i >= 0; i--) {
    const s = shocks[i];
    s.t += dt;
    const k = s.t / 0.4;
    s.m.scale.setScalar(1 + k * s.r); s.m.material.opacity = 0.6 * (1 - k);
    if (k >= 1) { scene.remove(s.m); s.m.material.dispose(); shocks.splice(i, 1); }
  }
  for (const l of blastLights) l.intensity = Math.max(0, l.intensity - dt * 9000);
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 2000);
  vmFlashLight.intensity = Math.max(0, vmFlashLight.intensity - dt * 80);
  FIRES.forEach((p, i) => {
    const n = Math.random() < 0.5 ? 2 : 1;
    for (let k = 0; k < n; k++) fxAdd.spawn(p.x + rand(-0.6, 0.6), p.y + rand(-0.2, 0.3), p.z + rand(-0.9, 0.9), rand(-0.3, 0.3), rand(1.5, 3.2), rand(-0.3, 0.3), 1, rand(0.35, 0.6), 0.1, rand(0.5, 0.9), rand(0.35, 0.7), { drag: 1, grow: -0.6 });
    if (Math.random() < dt * 9) fxSmoke.spawn(p.x + rand(-0.4, 0.4), p.y + 1.2, p.z + rand(-0.4, 0.4), rand(-0.3, 0.3) + 0.4, rand(1.8, 2.8), rand(-0.3, 0.3), 0.12, 0.11, 0.1, rand(1.2, 1.8), rand(4, 6), { drag: 0.3, grow: 1.1, alpha: 0.7 });
  });
  fireLights.forEach((l, i) => { const c = l.userData.cfg; if (c) l.intensity = c.flicker ? c.intensity * (0.8 + Math.sin(G.time * 17 + i) * 0.15 + Math.random() * 0.25) : c.intensity; });
  for (const p of SMOKE_COLUMNS) if (Math.random() < dt * 6) fxSmoke.spawn(p.x + rand(-3, 3), p.y, p.z + rand(-3, 3), rand(-0.5, 0.5) + 1.5, rand(5, 8), rand(-0.5, 0.5), 0.09, 0.085, 0.08, rand(10, 16), rand(12, 18), { drag: 0.05, grow: 2.5, alpha: 0.6 });
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  for (let i = 0; i < DUST_N; i++) {
    const j = i * 3;
    dustPos[j] += (0.35 + Math.sin(i + G.time * 0.3) * 0.2) * rdt; dustPos[j + 1] += Math.sin(i * 1.7 + G.time) * 0.05 * rdt;
    if (dustPos[j] - cx > 20) dustPos[j] -= 40; else if (dustPos[j] - cx < -20) dustPos[j] += 40;
    if (dustPos[j + 2] - cz > 20) dustPos[j + 2] -= 40; else if (dustPos[j + 2] - cz < -20) dustPos[j + 2] += 40;
    if (dustPos[j + 1] - cy > 8) dustPos[j + 1] -= 12; else if (dustPos[j + 1] - cy < -4) dustPos[j + 1] += 12;
  }
  dustGeo.attributes.position.needsUpdate = true;
}
function updateParticleScale() {
  const s = renderer.domElement.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const ps of particleSystems) ps.mat.uniforms.uScale.value = s;
}

// ---------------------------------------------------------------- viewmodel animation
function updateViewmodel(dt) {
  const W = WEAPONS[ws.cur], model = vm.models[ws.cur], Pl = player;
  vm.sprintT = damp(vm.sprintT, Pl.sprinting ? 1 : 0, 10, dt);
  const a = ease(vm.adsT);
  const pos = _a.copy(model.hip).lerp(_b.set(0, -model.sightY, -model.adsZ), a);
  let rx = 0, ry = 0, rz = 0;
  const hs = Math.hypot(Pl.vel.x, Pl.vel.z), mv = Pl.onGround && Pl.slide <= 0 ? clamp(hs / 5, 0, 1.6) : 0.15;
  const bobAmp = (0.011 + vm.sprintT * 0.02) * mv * (1 - a * 0.9);
  pos.x += Math.sin(Pl.bobT) * bobAmp;
  pos.y += -Math.abs(Math.cos(Pl.bobT)) * bobAmp + Math.sin(G.time * 1.7) * 0.0022 * (1 - a * 0.8);
  rz += Math.sin(Pl.bobT) * bobAmp * 1.2;
  vm.swayX = damp(vm.swayX, clamp(-input.lookDX * 0.00055, -0.045, 0.045), 7, dt);
  vm.swayY = damp(vm.swayY, clamp(input.lookDY * 0.00055, -0.045, 0.045), 7, dt);
  const sw = 1 - a * 0.75;
  pos.x += vm.swayX * sw; pos.y += vm.swayY * sw;
  ry += vm.swayX * 1.4 * sw; rx += vm.swayY * 1.4 * sw; rz += vm.swayX * 1.2 * sw;
  if (!Pl.onGround) { pos.y += clamp(-Pl.vel.y * 0.004, -0.03, 0.03); }
  vm.kick = damp(vm.kick, 0, 16, dt);
  pos.z += vm.kick; rx += vm.kick * 2.2 * (1 - a * 0.6);
  const st = vm.sprintT;
  pos.x -= 0.06 * st; pos.y -= 0.05 * st; pos.z += 0.05 * st;
  rx -= 0.25 * st; ry += 0.8 * st; rz += 0.25 * st;
  if (Pl.slide > 0) rz += 0.22;
  if (ws.reloading) {
    const p = 1 - ws.reloadT / W.reload, r = Math.sin(p * Math.PI);
    rz += 0.55 * r; rx += 0.3 * r; pos.y -= 0.05 * r; pos.x -= 0.03 * r;
    if (model.mag) {
      const drop = p < 0.15 ? 0 : p < 0.32 ? (p - 0.15) / 0.17 : p < 0.6 ? 1 : p < 0.8 ? 1 - (p - 0.6) / 0.2 : 0;
      model.mag.position.y = model.magY - drop * 0.3;
      model.mag.visible = drop < 0.95;
    }
    if (W.id === 'sg') pos.y -= 0.02 * Math.sin(p * Math.PI * 12);
  } else if (model.mag) { model.mag.position.y = model.magY; model.mag.visible = true; }
  if (model.pump) { const p = vm.pumpT > 0 && vm.pumpT < 0.45 ? Math.sin((1 - vm.pumpT / 0.45) * Math.PI) : 0; model.pump.position.z = model.pumpZ + p * 0.1; rx += p * 0.05; }
  if (model.bolt) { const p = vm.boltT > 0 && vm.boltT < 0.7 ? Math.sin((1 - vm.boltT / 0.7) * Math.PI) : 0; model.bolt.position.z = 0.05 + p * 0.09; model.bolt.rotation.x = p * 1.2; if (p > 0) { rz += p * 0.2; pos.y -= p * 0.02; } }
  if (vm.raiseT > 0) { const r = vm.raiseT / 0.42; pos.y -= r * r * 0.32; rx -= r * 0.9; }
  if (vm.meleeT > 0) { const p = 1 - vm.meleeT / 0.5, r = Math.sin(p * Math.PI); pos.z -= r * 0.16; pos.x -= r * 0.1; rz -= r * 0.9; ry += r * 0.4; }
  if (vm.throwT > 0) { const r = Math.sin((1 - vm.throwT / 0.6) * Math.PI); pos.y -= r * 0.25; rx -= r * 0.6; }
  if (!Pl.alive) pos.y -= 0.4;
  vm.root.position.copy(pos);
  vm.root.rotation.set(rx, ry, rz);
  vm.root.visible = !(W.scope && vm.adsT > 0.9) && Pl.alive;
  if (vm.flashT > 0) { vm.flashT -= dt; if (vm.flashT <= 0) model.flash.visible = false; }
  for (const sh of shells) {
    if (sh.t <= 0) continue;
    sh.t -= dt; sh.v.y -= 9 * dt;
    sh.m.position.addScaledVector(sh.v, dt);
    sh.m.rotation.x += sh.s.x * dt; sh.m.rotation.y += sh.s.y * dt; sh.m.rotation.z += sh.s.z * dt;
    if (sh.t <= 0) sh.m.visible = false;
  }
  vmSun.position.copy(SUN_DIR).applyQuaternion(_q.copy(camera.quaternion).invert()).multiplyScalar(5);
}
const _q = new THREE.Quaternion();

// ---------------------------------------------------------------- HUD
const hud = {
  el: $('hud'), compass: $('compass'), radar: $('radar'), cross: $('crosshair'), hit: $('hitmarker'),
  waveNum: $('wave-num'), hostiles: $('hostile-count'), score: $('score'), weapon: $('weapon-name'),
  mag: $('ammo-mag'), res: $('ammo-res'), magBar: $('mag-bar'), nades: $('nades'), strike: $('strike-ready'),
  hint: $('hint'), banner: $('banner'), hp: $('hp'), pips: $('pips'), feed: $('killfeed'), popups: $('popups'),
  dmg: $('dmg-ind'), hurt: $('hurt'), scope: $('scope'), flash: $('flash'),
  cache: {}, hitT: 0, bannerTimer: 0, flashV: 0,
};
const cctx = hud.compass.getContext('2d'), rctx = hud.radar.getContext('2d');
function sizeHudCanvases() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  for (const c of [hud.compass, hud.radar]) {
    const r = c.getBoundingClientRect();
    if (!r.width) continue;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
for (let i = 0; i < 10; i++) hud.hp.appendChild(document.createElement('i'));
for (let i = 0; i < 6; i++) { const p = document.createElement('i'); p.className = 'pip' + (i === 2 || i === 5 ? ' mark' : ''); hud.pips.appendChild(p); }
function setText(el, key, v) { if (hud.cache[key] !== v) { hud.cache[key] = v; el.textContent = v; } }
function refreshWeaponHUD(rebuild = false) {
  const W = WEAPONS[ws.cur], S = ws.state[ws.cur];
  setText(hud.weapon, 'wn', `${W.name} · ${W.mode}`);
  setText(hud.mag, 'mag', String(S.mag));
  setText(hud.res, 'res', `/ ${S.reserve}`);
  hud.mag.classList.toggle('low', S.mag <= Math.ceil(W.mag * 0.25));
  if (rebuild || hud.magBar.childElementCount !== W.mag) {
    hud.magBar.textContent = '';
    for (let i = 0; i < W.mag; i++) { const t = document.createElement('i'); if (W.mag <= 8) t.style.width = '7px'; hud.magBar.appendChild(t); }
  }
  [...hud.magBar.children].forEach((t, i) => t.classList.toggle('off', i >= S.mag));
  hud.nades.innerHTML = `FRAG <b>${'●'.repeat(ws.nades)}${'○'.repeat(Math.max(0, 3 - ws.nades))}</b>`;
  hud.strike.hidden = G.strikes <= 0;
  hud.strike.textContent = (IS_TOUCH ? 'AIR' : 'B') + ' · AIRSTRIKE' + (G.strikes > 1 ? ` ×${G.strikes}` : '');
  $('tb-strike').hidden = G.strikes <= 0;
}
function updateStreakHUD() {
  const n = G.streak === 0 ? 0 : G.streak % 6 === 0 ? 6 : G.streak % 6;
  [...hud.pips.children].forEach((p, i) => p.classList.toggle('on', i < n));
}
function showBanner(k, t, cls, dur) {
  hud.banner.querySelector('.k').textContent = k.toUpperCase();
  hud.banner.querySelector('.t').textContent = t;
  hud.banner.className = 'show ' + (cls || '');
  clearTimeout(hud.bannerTimer);
  hud.bannerTimer = setTimeout(() => { hud.banner.className = cls || ''; }, dur * 1000);
}
function addPopup(pts, label) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = (pts ? `<span class="pts">+${pts}</span>` : '') + label;
  hud.popups.appendChild(el);
  while (hud.popups.childElementCount > 4) hud.popups.firstChild.remove();
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 1600);
}
const CAUSE_LABEL = { ar: 'AR-7', smg: 'VK-9', sg: 'BRECHER', sr: 'LONGBOW', frag: 'FRAG', air: 'AIRSTRIKE', melee: 'MELEE' };
function addKillfeed(cause, name, head) {
  const el = document.createElement('div');
  el.className = 'kf';
  el.innerHTML = `<span class="you">YOU</span><span class="gun">[${CAUSE_LABEL[cause] || cause}]</span><span class="foe">${name}</span>${head ? '<span class="hs">HEADSHOT</span>' : ''}`;
  hud.feed.appendChild(el);
  while (hud.feed.childElementCount > 5) hud.feed.firstChild.remove();
  setTimeout(() => { el.style.opacity = '0'; }, 4500);
  setTimeout(() => el.remove(), 5100);
}
function addDamageIndicator(from) {
  const el = document.createElement('div');
  el.className = 'dmg';
  const rel = THREE.MathUtils.radToDeg(wrapAngle(bearingOf(from) + player.yaw));
  el.style.transform = `rotate(${rel}deg)`;
  hud.dmg.appendChild(el);
  while (hud.dmg.childElementCount > 6) hud.dmg.firstChild.remove();
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '0'; }));
  setTimeout(() => el.remove(), 1300);
}
function showHitmarker(kill, head) {
  hud.hitT = kill ? 0.3 : 0.14;
  hud.hit.classList.toggle('kill', kill);
  hud.hit.style.transform = `scale(${head ? 1.35 : 1})`;
}
function flashScreen(v) { hud.flashV = Math.max(hud.flashV, v); }
function drawCompass() {
  const c = cctx, w = hud.compass.clientWidth, h = hud.compass.clientHeight;
  if (!w) return;
  c.clearRect(0, 0, w, h);
  const heading = ((THREE.MathUtils.radToDeg(-player.yaw) % 360) + 360) % 360;
  const span = 150, ppd = w / span, mid = w / 2;
  const grd = c.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, 'rgba(236,230,214,0)'); grd.addColorStop(0.2, 'rgba(236,230,214,.9)'); grd.addColorStop(0.8, 'rgba(236,230,214,.9)'); grd.addColorStop(1, 'rgba(236,230,214,0)');
  c.fillStyle = grd; c.strokeStyle = grd;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  for (let d = Math.floor((heading - span / 2) / 5) * 5; d <= heading + span / 2; d += 5) {
    const x = mid + (d - heading) * ppd, n = ((d % 360) + 360) % 360;
    c.globalAlpha = 1 - Math.abs(x - mid) / mid;
    if (names[n] !== undefined) {
      c.font = n % 90 === 0 ? '700 15px "Barlow Condensed", sans-serif' : '600 12px "Barlow Condensed", sans-serif';
      c.fillStyle = n === 0 ? '#f0a53a' : '#ece6d6';
      c.fillText(names[n], x, 17);
      c.fillRect(x - 0.75, 22, 1.5, 8);
    } else if (n % 15 === 0) {
      c.font = '11px "Share Tech Mono", monospace'; c.fillStyle = 'rgba(236,230,214,.7)';
      c.fillText(String(n), x, 16);
      c.fillRect(x - 0.5, 24, 1, 6);
    } else { c.fillStyle = 'rgba(236,230,214,.5)'; c.fillRect(x - 0.5, 26, 1, 4); }
  }
  c.globalAlpha = 1;
  const uav = G.time < G.uavUntil;
  for (const e of enemies) {
    if (e.dead || !(uav || G.time < e.revealUntil)) continue;
    const rel = THREE.MathUtils.radToDeg(wrapAngle(bearingOf(e.pos) + player.yaw));
    if (Math.abs(rel) > span / 2) continue;
    const x = mid + rel * ppd;
    c.fillStyle = '#e5483c';
    c.beginPath(); c.moveTo(x, 30); c.lineTo(x + 4, 35); c.lineTo(x, 40); c.lineTo(x - 4, 35); c.fill();
  }
  if (G.objPoint) {
    const rel = THREE.MathUtils.radToDeg(wrapAngle(bearingOf(G.objPoint) + player.yaw));
    const x = mid + clamp(rel, -span / 2, span / 2) * ppd;
    c.strokeStyle = '#f0a53a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, 29); c.lineTo(x + 5, 34); c.lineTo(x, 39); c.lineTo(x - 5, 34); c.closePath(); c.stroke();
  }
  c.fillStyle = '#f0a53a';
  c.beginPath(); c.moveTo(mid - 5, 0); c.lineTo(mid + 5, 0); c.lineTo(mid, 6); c.fill();
}
function drawRadar() {
  const c = rctx, S = hud.radar.clientWidth;
  if (!S) return;
  const R = S / 2, range = 46, sc = R / range, Pl = player;
  c.clearRect(0, 0, S, S);
  c.save();
  c.beginPath(); c.arc(R, R, R - 1, 0, Math.PI * 2); c.clip();
  c.fillStyle = 'rgba(12,16,18,.74)'; c.fillRect(0, 0, S, S);
  c.save();
  c.translate(R, R); c.rotate(Pl.yaw); c.scale(sc, sc); c.translate(-Pl.pos.x, -Pl.pos.z);
  c.fillStyle = 'rgba(0,0,0,.35)';
  for (const r of radarRoads) c.fillRect(r[0], r[1], r[2], r[3]);
  for (const b of colliders) {
    if (b.y1 < 1.6) continue;
    const tall = b.y1 > 3.5;
    c.fillStyle = tall ? 'rgba(236,230,214,.26)' : 'rgba(236,230,214,.14)';
    c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  }
  c.fillStyle = '#f0a53a';
  for (const pk of pickups) { c.beginPath(); c.arc(pk.g.position.x, pk.g.position.z, 2.5 / sc, 0, 7); c.fill(); }
  if (G.objPoint) {
    const o = G.objPoint, r = 4.5 / sc;
    c.save(); c.translate(o.x, o.z); c.rotate(-Pl.yaw + Math.PI / 4);
    c.fillStyle = 'rgba(240,165,58,.35)'; c.strokeStyle = '#f0a53a'; c.lineWidth = 1.5 / sc;
    c.fillRect(-r, -r, r * 2, r * 2); c.strokeRect(-r, -r, r * 2, r * 2); c.restore();
  }
  if (strikeMark && G.time < strikeMark.until + 3) { c.strokeStyle = '#f0a53a'; c.lineWidth = 2 / sc; c.beginPath(); c.arc(strikeMark.p.x, strikeMark.p.z, 8, 0, 7); c.stroke(); }
  const uav = G.time < G.uavUntil;
  for (const e of enemies) {
    if (e.dead) continue;
    const vis = uav || G.time < e.revealUntil;
    if (!vis) continue;
    const fade = uav ? 1 : clamp((e.revealUntil - G.time) / 0.6, 0, 1);
    c.globalAlpha = fade;
    c.fillStyle = e.T.static ? '#ff7a5a' : '#e5483c';
    c.beginPath(); c.arc(e.pos.x, e.pos.z, (e.T.static ? 4 : 3.2) / sc, 0, 7); c.fill();
  }
  c.globalAlpha = 1;
  c.restore();
  if (uav) {
    const a = (G.time * 2.2) % (Math.PI * 2);
    const g = c.createConicGradient ? c.createConicGradient(a - 0.8, R, R) : null;
    if (g) { g.addColorStop(0, 'rgba(127,209,199,0)'); g.addColorStop(0.12, 'rgba(127,209,199,.28)'); g.addColorStop(0.125, 'rgba(127,209,199,0)'); c.fillStyle = g; c.fillRect(0, 0, S, S); }
  }
  c.strokeStyle = 'rgba(236,230,214,.12)'; c.lineWidth = 1;
  for (const k of [0.33, 0.66]) { c.beginPath(); c.arc(R, R, R * k, 0, 7); c.stroke(); }
  const fovHalf = THREE.MathUtils.degToRad(camera.fov * camera.aspect / 2);
  const cg = c.createRadialGradient(R, R, 0, R, R, R);
  cg.addColorStop(0, 'rgba(236,230,214,.18)'); cg.addColorStop(1, 'rgba(236,230,214,0)');
  c.fillStyle = cg;
  c.beginPath(); c.moveTo(R, R); c.arc(R, R, R, -Math.PI / 2 - Math.min(fovHalf, 1.2), -Math.PI / 2 + Math.min(fovHalf, 1.2)); c.fill();
  c.restore();
  c.fillStyle = '#ece6d6';
  c.beginPath(); c.moveTo(R, R - 7); c.lineTo(R + 5, R + 5); c.lineTo(R, R + 2); c.lineTo(R - 5, R + 5); c.closePath(); c.fill();
  c.strokeStyle = uav ? 'rgba(127,209,199,.8)' : 'rgba(236,230,214,.35)'; c.lineWidth = 1.5;
  c.beginPath(); c.arc(R, R, R - 1, 0, Math.PI * 2); c.stroke();
  c.fillStyle = 'rgba(236,230,214,.55)'; c.font = '10px "Share Tech Mono", monospace'; c.textAlign = 'center';
  c.fillText(uav ? 'UAV' : `${range}M`, R, S - 8);
}
let hudFrame = 0;
function updateHUD(dt) {
  const W = WEAPONS[ws.cur], S = ws.state[ws.cur];
  const alive = enemies.filter((e) => !e.dead).length;
  setText(hud.waveNum, 'wave', String(Math.max(1, G.wave)));
  setText(hud.hostiles, 'host', String(G.toSpawn + G.marksToSpawn + alive));
  updateMissionHUD();
  setText(hud.score, 'score', G.score.toLocaleString('en-US'));
  setText(hud.mag, 'mag', String(S.mag));
  setText(hud.res, 'res', `/ ${S.reserve}`);
  if (hud.cache.magBarN !== S.mag) { hud.cache.magBarN = S.mag; [...hud.magBar.children].forEach((t, i) => t.classList.toggle('off', i >= S.mag)); hud.mag.classList.toggle('low', S.mag <= Math.ceil(W.mag * 0.25)); }
  const segs = Math.ceil(player.hp / 10);
  if (hud.cache.hp !== segs) { hud.cache.hp = segs; [...hud.hp.children].forEach((s, i) => s.classList.toggle('off', i >= segs)); hud.hp.classList.toggle('low', player.hp < 35); }
  const spread = currentSpread(W);
  const gap = Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (innerHeight / 2) + 5;
  hud.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  hud.cross.style.opacity = vm.adsT > 0.5 || player.sprinting || !player.alive ? '0' : '1';
  hud.scope.hidden = !(W.scope && vm.adsT > 0.9 && player.alive);
  if (hud.hitT > 0) { hud.hitT -= dt; hud.hit.style.opacity = String(clamp(hud.hitT * 8, 0, 1)); } else hud.hit.style.opacity = '0';
  const hurt = player.alive ? clamp((70 - player.hp) / 60, 0, 1) : 1;
  hud.hurt.style.opacity = String(Math.max(hurt, clamp(1 - (G.time - player.lastHurt) * 3, 0, 1) * 0.5));
  hud.flashV = Math.max(0, hud.flashV - dt * 1.5);
  hud.flash.style.opacity = String(hud.flashV);
  let hint = '', warn = false;
  const key = (k) => (IS_TOUCH ? '' : `<kbd>${k}</kbd>`);
  if (G.intermission > 0) hint = `NEXT WAVE IN ${Math.ceil(G.intermission)}`;
  else if (ws.reloading) hint = 'RELOADING';
  else if (S.mag === 0 && S.reserve === 0) { hint = WEAPONS.some((w, i) => ws.state[i].mag + ws.state[i].reserve > 0) ? `NO AMMO · SWITCH WEAPON` : 'NO AMMO'; warn = true; }
  else if (S.mag <= Math.ceil(W.mag * 0.25) && S.reserve > 0) { hint = `${key('R')}RELOAD`; warn = true; }
  if (hud.cache.hint !== hint + warn) { hud.cache.hint = hint + warn; hud.hint.innerHTML = hint; hud.hint.classList.toggle('warn', warn); }
  const cross = aimingAtEnemy();
  if (hud.cache.ce !== cross) { hud.cache.ce = cross; hud.cross.classList.toggle('enemy', cross); }
  hudFrame++;
  drawCompass();
  if (hudFrame % 2 === 0) drawRadar();
}
function aimingAtEnemy() {
  if (!enemyParts.length) return false;
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const tW = rayWorld(camera.position, _fwd, 120);
  raycaster.set(camera.position, _fwd); raycaster.far = tW;
  return raycaster.intersectObjects(enemyParts, false).length > 0;
}

// ---------------------------------------------------------------- film grain
const grainCanvas = $('grain'), gctx = grainCanvas.getContext('2d'), grainImg = gctx.createImageData(160, 160);
function drawGrain() {
  const d = grainImg.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  gctx.putImageData(grainImg, 0, 0);
}

// ---------------------------------------------------------------- time of day and weather
const ENVS = {
  dawn: {
    sun: [-0.55, 0.3, -0.78], sunCol: 0xffc896, sunI: 3.4, hemi: [0xb4c2d8, 0x7a5f48, 0.3], fog: 0xbba48e, fogD: 0.0052, sunFog: [0xffc995, 1.5],
    sky: { turb: 7.5, ray: 2.2, mie: 0.006, scale: 0.5, cloud: 0.5, sunCol: [0xffc48a, 2.2] }, exposure: 1,
  },
  storm: {
    sun: [0.3, 0.82, -0.35], sunCol: 0xffd5a0, sunI: 0.95, hemi: [0xc9a676, 0x6a4c30, 0.75], fog: 0x8f6a44, fogD: 0.058, sunFog: [0xc8a070, 1.1],
    sky: { turb: 16, ray: 1.2, mie: 0.02, scale: 0.42, cloud: 0.25, dust: 1, sunCol: [0xfff0d4, 1.5] }, exposure: 0.95, weather: 'sand', perception: 0.55,
  },
  night: {
    sun: [0.42, 0.52, 0.55], sunCol: 0x9fb6e6, sunI: 0.45, hemi: [0x34445f, 0x100e0c, 0.12], fog: 0x0c1119, fogD: 0.014, sunFog: [0x3c4a64, 1],
    sky: { turb: 2, ray: 1, mie: 0.004, scale: 0.5, cloud: 0.3, night: 1, sunCol: [0xd8e4ff, 1.4] }, exposure: 1.25, night: true, perception: 0.35,
  },
  rain: {
    sun: [0.3, 0.62, -0.55], sunCol: 0xc6d0da, sunI: 0.8, hemi: [0x9aa4ae, 0x4a4640, 0.85], fog: 0x7c848c, fogD: 0.013, sunFog: [0x9aa2aa, 1],
    sky: { turb: 10, ray: 1, mie: 0.01, scale: 0.4, cloud: 0.9, overcast: 1, sunCol: [0xc0c8d0, 0.8] }, exposure: 1.1, weather: 'rain', wet: true, perception: 0.75,
  },
  sunset: {
    sun: [0.82, 0.1, 0.3], sunCol: 0xff8f4e, sunI: 3.0, hemi: [0x9b8cb4, 0x6a4a3a, 0.32], fog: 0xb27c60, fogD: 0.0062, sunFog: [0xff9a5c, 1.9],
    sky: { turb: 9, ray: 3, mie: 0.008, scale: 0.5, cloud: 0.6, sunCol: [0xff8c52, 2.6] }, exposure: 1,
  },
};
let ENV = ENVS.dawn, envName = 'dawn';
const baseLook = new Map();
const wetMats = () => [MAT.sand, MAT.concrete, MAT.perimeter, MAT.barrier, MAT.roof, MAT.crate, MAT.sandbag, MAT.wallTan, MAT.wallOchre, MAT.wallGrey, ...roadMats];
function applyEnv(name, force = false) {
  if (name === envName && !force) return false;
  const changed = name !== envName;
  const E = ENV = ENVS[name]; envName = name;
  SUN_DIR.set(...E.sun).normalize();
  sun.color.setHex(E.sunCol); sun.intensity = E.sunI;
  hemi.color.setHex(E.hemi[0]); hemi.groundColor.setHex(E.hemi[1]); hemi.intensity = E.hemi[2];
  FOG_COLOR.setHex(E.fog); scene.fog.color.setHex(E.fog); scene.fog.density = E.fogD;
  SUN_FOG.setHex(E.sunFog[0]).multiplyScalar(E.sunFog[1]);
  const k = E.sky, u = skyUniforms;
  u.uTurbidity.value = k.turb; u.uRayleigh.value = k.ray; u.uMie.value = k.mie; u.uScale.value = k.scale; u.uCloud.value = k.cloud;
  u.uNight.value = k.night || 0; u.uOvercast.value = k.overcast || 0; u.uDust.value = k.dust || 0;
  u.uSunCol.value.setHex(k.sunCol[0]).multiplyScalar(k.sunCol[1]);
  for (const m of wetMats()) {
    if (!baseLook.has(m)) baseLook.set(m, { r: m.roughness, c: m.color.clone() });
    const b = baseLook.get(m);
    m.roughness = b.r * (E.wet ? 0.4 : 1); m.color.copy(b.c).multiplyScalar(E.wet ? 0.7 : 1);
  }
  MAT.lamp.emissiveIntensity = E.night ? 8 : 1.6;
  vmSun.color.setHex(E.sunCol); vmSun.intensity = E.sunI * 0.7;
  vmHemi.intensity = clamp(E.hemi[2] * 3, 0.2, 1.3);
  rain.visible = E.weather === 'rain'; sandstorm.visible = E.weather === 'sand';
  for (const e of enemies) if (e.m.beam) e.m.beam.visible = !!E.night;
  MAT.cityLights.emissiveIntensity = E.night ? 1.8 : name === 'sunset' ? 0.35 : 0.04;
  MAT.lightPool.opacity = E.night ? 0.24 : 0;
  if (changed) {
    installFog(); FOG_VERSION++;
    const touchMat = (o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); };
    scene.traverse(touchMat); vmScene.traverse(touchMat);
  }
  Sfx.setWeather(E.weather || null);
  captureEnvironment();
  return true;
}

TEX.puff = (() => {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d'), grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
})();
TEX.beam = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.35, '#555'); grd.addColorStop(1, '#000');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
})();
beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1d2, alphaMap: TEX.beam, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
lensMat = new THREE.SpriteMaterial({ map: TEX.flash, color: new THREE.Color(3, 2.8, 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
// Rain: streaks falling through a box that follows the camera.
const RAIN_N = 3200;
const rainDrops = new Float32Array(RAIN_N * 3), rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) { rainDrops[i * 3] = rand(-24, 24); rainDrops[i * 3 + 1] = rand(0, 20); rainDrops[i * 3 + 2] = rand(-24, 24); }
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rain = noAO(new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc4ccd6, transparent: true, opacity: 0.34, depthWrite: false })));
rain.frustumCulled = false; rain.visible = false; scene.add(rain);
// Sandstorm: soft dust clouds driven by a gusting wind.
const SAND_N = 1400;
const sandPos = new Float32Array(SAND_N * 3);
for (let i = 0; i < SAND_N; i++) { sandPos[i * 3] = rand(-30, 30); sandPos[i * 3 + 1] = rand(0, 12); sandPos[i * 3 + 2] = rand(-30, 30); }
const sandGeo = new THREE.BufferGeometry();
sandGeo.setAttribute('position', new THREE.BufferAttribute(sandPos, 3).setUsage(THREE.DynamicDrawUsage));
const sandstorm = noAO(new THREE.Points(sandGeo, new THREE.PointsMaterial({ map: TEX.puff, color: 0x8a6a46, size: 2.8, transparent: true, opacity: 0.45, depthWrite: false })));
sandstorm.frustumCulled = false; sandstorm.visible = false; scene.add(sandstorm);
const GRIT_N = 1600, gritP = new Float32Array(GRIT_N * 3), gritPos = new Float32Array(GRIT_N * 6);
for (let i = 0; i < GRIT_N; i++) { gritP[i * 3] = rand(-18, 18); gritP[i * 3 + 1] = rand(0, 5); gritP[i * 3 + 2] = rand(-18, 18); }
const gritGeo = new THREE.BufferGeometry();
gritGeo.setAttribute('position', new THREE.BufferAttribute(gritPos, 3).setUsage(THREE.DynamicDrawUsage));
const grit = noAO(new THREE.LineSegments(gritGeo, new THREE.LineBasicMaterial({ color: 0xd8b585, transparent: true, opacity: 0.3, depthWrite: false })));
grit.frustumCulled = false; sandstorm.add(grit);
// Player flashlight: always in the scene (dark when off) so toggling it never recompiles shaders.
const flashlight = new THREE.SpotLight(0xfff0d8, 0, 45, 0.4, 0.55, 2);
scene.add(flashlight, flashlight.target);
const weather = { lightT: 7, flash: 0, gust: 0 };
function updateWeather(rdt) {
  const cx = camera.position.x, cz = camera.position.z;
  if (rain.visible) {
    const wind = 2.5;
    for (let i = 0; i < RAIN_N; i++) {
      const j = i * 3;
      rainDrops[j + 1] -= 21 * rdt; rainDrops[j] += wind * rdt;
      let x = rainDrops[j], z = rainDrops[j + 2];
      if (rainDrops[j + 1] < 0) { rainDrops[j + 1] += 20; x = rainDrops[j] = rand(-24, 24) + cx; z = rainDrops[j + 2] = rand(-24, 24) + cz; }
      if (x - cx > 24) x = rainDrops[j] -= 48; else if (x - cx < -24) x = rainDrops[j] += 48;
      if (z - cz > 24) z = rainDrops[j + 2] -= 48; else if (z - cz < -24) z = rainDrops[j + 2] += 48;
      const y = rainDrops[j + 1], k = i * 6;
      rainPos[k] = x; rainPos[k + 1] = y; rainPos[k + 2] = z;
      rainPos[k + 3] = x - wind * 0.025; rainPos[k + 4] = y + 0.55; rainPos[k + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * 6.28, r = rand(1, 14), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      fxSmoke.spawn(x, groundHeightAt(x, z, 30, 0.05) + 0.03, z, rand(-0.4, 0.4), rand(0.8, 1.6), rand(-0.4, 0.4), 0.75, 0.8, 0.85, 0.07, 0.22, { grav: 7, drag: 1, alpha: 0.55 });
    }
    weather.lightT -= rdt;
    if (weather.lightT <= 0) {
      weather.lightT = rand(7, 18); weather.flash = 1;
      const delay = rand(0.5, 2.6);
      setTimeout(() => Sfx.thunder(delay < 1.2), delay * 1000);
    }
  }
  weather.flash = Math.max(0, weather.flash - rdt * 2.2);
  const fl = weather.flash > 0 ? (Math.sin(weather.flash * 40) > -0.3 ? weather.flash : weather.flash * 0.2) : 0;
  skyUniforms.uFlash.value = fl;
  hemi.intensity = ENV.hemi[2] + fl * 2.4;
  skyUniforms.uTime.value = performance.now() / 1000;
  MAT.water.normalMap.offset.set(performance.now() / 1000 * 0.004, performance.now() / 1000 * 0.0025);
  if (sandstorm.visible) {
    weather.gust = 9 + Math.sin(performance.now() / 1000 * 0.7) * 4 + Math.sin(performance.now() / 1000 * 2.3) * 2;
    for (let i = 0; i < SAND_N; i++) {
      const j = i * 3;
      sandPos[j] += weather.gust * rdt; sandPos[j + 2] += weather.gust * 0.35 * rdt; sandPos[j + 1] += Math.sin(i + performance.now() / 700) * 0.6 * rdt;
      if (sandPos[j] - cx > 30) sandPos[j] -= 60; else if (sandPos[j] - cx < -30) sandPos[j] += 60;
      if (sandPos[j + 2] - cz > 30) sandPos[j + 2] -= 60; else if (sandPos[j + 2] - cz < -30) sandPos[j + 2] += 60;
      if (sandPos[j + 1] > 12) sandPos[j + 1] -= 12; else if (sandPos[j + 1] < 0) sandPos[j + 1] += 12;
    }
    sandGeo.attributes.position.needsUpdate = true;
    const gx = weather.gust * 2.2, gz = weather.gust * 0.75;
    for (let i = 0; i < GRIT_N; i++) {
      const j = i * 3;
      gritP[j] += gx * rdt; gritP[j + 2] += gz * rdt;
      if (gritP[j] - cx > 18) { gritP[j] -= 36; gritP[j + 1] = rand(0, 5); } else if (gritP[j] - cx < -18) gritP[j] += 36;
      if (gritP[j + 2] - cz > 18) gritP[j + 2] -= 36; else if (gritP[j + 2] - cz < -18) gritP[j + 2] += 36;
      const k = i * 6;
      gritPos[k] = gritP[j]; gritPos[k + 1] = gritP[j + 1]; gritPos[k + 2] = gritP[j + 2];
      gritPos[k + 3] = gritP[j] - gx * 0.03; gritPos[k + 4] = gritP[j + 1]; gritPos[k + 5] = gritP[j + 2] - gz * 0.03;
    }
    gritGeo.attributes.position.needsUpdate = true;
  }
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  flashlight.position.copy(camera.position).addScaledVector(_right, 0.25).add(_up.set(0, -0.2, 0));
  flashlight.target.position.copy(camera.position).addScaledVector(_fwd, 12);
  flashlight.intensity = G.flashlight && G.mode !== 'menu' ? 16 : 0;
}
function setNVG(on) {
  G.nvg = !!on && !!ENV.night;
  canvas.classList.toggle('nvg-css', G.nvg && !HIGH());
  if (G.nvg) Sfx.nvg();
}
function toggleFlashlight() { if (G.mode !== 'play') return; G.flashlight = !G.flashlight; Sfx.mech(0, 2600, 0.2); }

// ---------------------------------------------------------------- mission props
const missionObjs = [], missionCols = [], missionFires = [];
let heli = null;
function addMissionObj(o) { scene.add(o); missionObjs.push(o); return o; }
function addMissionCol(x0, y0, z0, x1, y1, z1, surf = 'metal') { const c = addCollider(x0, y0, z0, x1, y1, z1, surf); missionCols.push(c); return c; }
function clearMission() {
  for (const o of missionObjs) scene.remove(o);
  missionObjs.length = 0;
  for (const c of missionCols) { const i = colliders.indexOf(c); if (i >= 0) colliders.splice(i, 1); }
  missionCols.length = 0; missionFires.length = 0;
  G.uplink = null; G.obj = null; G.objPoint = null; heli = null;
  Sfx.heli(0);
}
function freeSpot(x, z, r) {
  for (let k = 0; k < 80; k++) {
    const a = k * 2.4, d = k * 0.7, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (Math.abs(px) < HALF - r - 1 && Math.abs(pz) < HALF - r - 1 && areaFree(px, pz, r)) return new V3(px, 0, pz);
  }
  return new V3(x, 0, z);
}
const propMat = std({ color: 0x59603f, roughness: 1, metalness: 0.3, roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap });
const propDark = std({ color: 0x24272a, roughness: 0.8, metalness: 0.5, roughnessMap: PBR.wear.roughnessMap });
const ledMat = (hex) => new THREE.SpriteMaterial({ map: TEX.flash, color: new THREE.Color(hex).multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
function led(parent, hex, x, y, z, s = 0.35) { const sp = noAO(new THREE.Sprite(ledMat(hex))); sp.position.set(x, y, z); sp.scale.setScalar(s); parent.add(sp); return sp; }
function shadowed(g) { g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g; }
function buildSAM(p, rot) {
  const g = new THREE.Group(); g.position.copy(p); g.rotation.y = rot ? Math.PI / 2 : 0;
  P(g, B(2.5, 0.9, 5.6), propMat, 0, 0.95, 0);
  P(g, B(2.4, 1.4, 1.7), propMat, 0, 2.0, -2.0);
  P(g, B(2.1, 0.55, 0.06), MAT.glass, 0, 2.25, -2.86);
  const wg = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 16);
  for (const sx of [-1.28, 1.28]) for (const sz of [-1.9, 0.1, 1.9]) P(g, wg, MAT.tire, sx, 0.55, sz, 0, 0, Math.PI / 2);
  P(g, new THREE.CylinderGeometry(0.8, 0.95, 0.5, 18), propMat, 0, 1.65, 1.0);
  const L = new THREE.Group(); L.position.set(0, 2.2, 1.0); L.rotation.x = 0.55; g.add(L);
  for (const tx of [-0.33, 0.33]) for (const ty of [-0.3, 0.3]) {
    P(L, CZ(0.28, 0.28, 3.8, 16), propMat, tx, ty, -0.6);
    P(L, new THREE.CircleGeometry(0.24, 14), propDark, tx, ty, -2.51, 0, Math.PI);
  }
  P(L, B(1.5, 0.14, 2.6), propDark, 0, -0.62, -0.4);
  P(g, new THREE.SphereGeometry(0.45, 14, 6, 0, Math.PI * 2, 0, 1), MAT.metal, 0, 3.05, -2.0, -0.4);
  const charge = new THREE.Group(); charge.position.set(1.3, 1.05, 0.4); charge.visible = false; g.add(charge);
  P(charge, B(0.12, 0.26, 0.38), propDark, 0, 0, 0);
  const chargeLed = led(charge, 0xff2a1a, 0.08, 0.1, 0, 0.3);
  addMissionObj(shadowed(g));
  const w = rot ? 5.8 : 2.7, d = rot ? 2.7 : 5.8;
  addMissionCol(p.x - w / 2, 0, p.z - d / 2, p.x + w / 2, 2.7, p.z + d / 2);
  return { g, L, charge, chargeLed };
}
function buildIntel(p) {
  const g = new THREE.Group(); g.position.copy(p);
  P(g, B(1.0, 0.9, 0.8), MAT.crate, 0, 0.45, 0);
  const kase = new THREE.Group(); kase.position.set(0, 0.97, 0); g.add(kase);
  P(kase, B(0.5, 0.13, 0.36), propDark, 0, 0, 0);
  P(kase, B(0.16, 0.05, 0.03), MAT.metal, 0, 0.09, 0);
  const l = led(kase, 0x40ff80, 0.2, 0.08, 0.19, 0.22);
  addMissionObj(shadowed(g));
  addMissionCol(p.x - 0.5, 0, p.z - 0.4, p.x + 0.5, 0.9, p.z + 0.4, 'wood');
  return { g, kase, led: l };
}
function buildUplink(p) {
  const g = new THREE.Group(); g.position.copy(p);
  P(g, B(1.7, 1.0, 1.1), propMat, 0, 0.5, 0);
  P(g, B(0.5, 0.3, 0.9), propDark, -0.6, 1.1, 0);
  P(g, new THREE.CylinderGeometry(0.06, 0.1, 7.5, 10), MAT.darkMetal, 0.5, 3.75, 0);
  const dish = P(g, new THREE.SphereGeometry(0.9, 20, 8, 0, Math.PI * 2, 0, 1.0), MAT.metal, 0.5, 5.4, 0.3, -1.0);
  dish.material = MAT.metal;
  P(g, CZ(0.03, 0.03, 0.9, 6), MAT.darkMetal, 0.5, 5.5, 0.75);
  const beacon = led(g, 0xff3020, 0.5, 7.6, 0, 0.6);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
  for (const [x, z] of [[3.5, 0], [-2.5, 2.5], [-2.5, -2.5]]) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(0.5, 6.5, 0), new V3(x, 0.02, z)]), wireMat));
  addMissionObj(shadowed(g));
  addMissionCol(p.x - 0.85, 0, p.z - 0.55, p.x + 0.85, 1.4, p.z + 0.55);
  return { g, beacon };
}
function buildHeli() {
  const g = new THREE.Group();
  const body = std({ color: 0x3e4636, roughness: 1, metalness: 0.35, roughnessMap: PBR.wear.roughnessMap, normalMap: PBR.wear.normalMap });
  const fus = P(g, new THREE.CapsuleGeometry(1.15, 3.4, 8, 16).rotateX(Math.PI / 2), body, 0, 0, 0); fus.scale.set(1, 0.92, 1);
  P(g, new THREE.SphereGeometry(1.08, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), std({ color: 0x18222a, metalness: 0.9, roughness: 0.08 }), 0, 0.15, -2.15);
  P(g, B(1.3, 0.7, 2.6), body, 0, 1.15, 0.4);
  P(g, CZ(0.36, 0.18, 6.4, 12), body, 0, 0.45, 5.0);
  P(g, B(0.14, 1.5, 0.9), body, 0, 1.15, 7.9);
  P(g, B(2.2, 0.08, 0.6), body, 0, 0.55, 7.4);
  const rotor = new THREE.Group(); rotor.position.set(0, 1.75, 0.2); g.add(rotor);
  P(rotor, new THREE.CylinderGeometry(0.12, 0.12, 0.5, 10), propDark, 0, -0.15, 0);
  for (let i = 0; i < 4; i++) { const b = P(rotor, B(5.6, 0.05, 0.32), propDark, 0, 0.1, 0); b.rotation.y = (i / 4) * Math.PI; b.position.set(0, 0.1, 0); b.geometry = b.geometry.clone().translate(2.8, 0, 0); }
  const disc = noAO(new THREE.Mesh(new THREE.CircleGeometry(5.7, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.12, depthWrite: false })));
  disc.position.y = 0.1; rotor.add(disc);
  const tail = new THREE.Group(); tail.position.set(0.18, 1.3, 7.95); g.add(tail);
  for (let i = 0; i < 2; i++) { const b = P(tail, B(0.04, 1.5, 0.16), propDark, 0, 0, 0); b.rotation.x = (i / 2) * Math.PI; }
  for (const sx of [-1.05, 1.05]) {
    P(g, CZ(0.06, 0.06, 4.6, 8), propDark, sx, -1.3, 0.2);
    for (const sz of [-1.2, 1.4]) P(g, new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), propDark, sx * 0.85, -0.95, sz, 0, 0, sx * 0.25);
  }
  led(g, 0xff2a1a, -1.2, 0.2, 0.6, 0.35); led(g, 0x2aff60, 1.2, 0.2, 0.6, 0.35);
  shadowed(g);
  return { g, rotor, tail };
}
function spawnHeli(lz) {
  const h = buildHeli();
  const from = lz.clone().add(new V3(-170, 60, 150));
  h.g.position.copy(from);
  addMissionObj(h.g);
  heli = { ...h, from, lz: lz.clone(), t: 0, state: 'inbound', landed: false };
}
function updateHeli(dt) {
  if (!heli) return;
  heli.t += dt;
  heli.rotor.rotation.y += dt * 26; heli.tail.rotation.x += dt * 45;
  const g = heli.g, top = _a.copy(heli.lz).setY(24);
  if (heli.state === 'inbound') {
    const k = Math.min(heli.t / 12, 1), e = 1 - Math.pow(1 - k, 2.2);
    g.position.lerpVectors(heli.from, top, e);
    g.rotation.order = 'YXZ'; g.rotation.y = Math.atan2(-(top.x - heli.from.x), -(top.z - heli.from.z)); g.rotation.x = -0.18 * (1 - k);
    if (k >= 1) { heli.state = 'descend'; heli.t = 0; }
  } else if (heli.state === 'descend') {
    const k = Math.min(heli.t / 5, 1);
    g.position.set(heli.lz.x, lerp(24, 1.75, ease(k)), heli.lz.z); g.rotation.x = 0;
    if (k >= 1) { heli.state = 'landed'; heli.landed = true; showBanner('Extraction', 'Board the helicopter', '', 2.4); Sfx.radio(); }
  } else if (heli.state === 'liftoff') {
    g.position.y += dt * (3 + heli.t * 4); g.rotation.x = -0.1;
    g.position.addScaledVector(_b.set(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y)), dt * heli.t * 6);
  }
  const alt = g.position.y;
  if (alt < 16 && Math.random() < 0.9) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * 6.28, s = rand(5, 11) * (1 - alt / 18);
      fxSmoke.spawn(g.position.x + Math.cos(a) * 1.5, 0.3, g.position.z + Math.sin(a) * 1.5, Math.cos(a) * s, rand(0.2, 1), Math.sin(a) * s, 0.62, 0.52, 0.4, rand(1, 2), rand(1, 1.8), { drag: 1.6, grow: 1.4, alpha: 0.5 });
    }
  }
  Sfx.heli(clamp(1 - g.position.distanceTo(camera.position) / 220, 0, 1));
}

// ---------------------------------------------------------------- missions
const MISSIONS = [
  {
    id: 'survival', name: 'Ironveil', tag: 'Survival', env: 'dawn', map: 'kessar', time: '0552 · Dawn', color: '#f0a53a', mode: 'waves',
    brief: 'Hold the Kessar crossroads against endless assault waves. Marksmen take the rooftops from wave two. Survive as long as you can.',
  },
  {
    id: 'dustdevil', name: 'Dust Devil', tag: 'Sabotage', env: 'storm', map: 'airbase', time: '1310 · Sandstorm', color: '#c9a46a', level: 2,
    brief: 'A sandstorm has grounded the fighters at Wadi Kesh airfield. Plant charges on three SAM launchers in their revetments before it clears, then reach the extraction helicopter.',
    start: [20, -57], startYaw: 0,
    spawn: { max: 6, every: 4.5, heavy: 0.2, marks: 1 },
    guards: [[-40, 13, 'rifleman'], [-35, 4, 'rifleman'], [14, -39, 'heavy'], [6, -38, 'rifleman'], [48, 21, 'rifleman'], [55, 37, 'rifleman'], [-10, 20, 'rifleman']],
    objectives: [{ type: 'plant', at: [[-42, 6, 1], [10, -46, 0], [51, 29, 1]] }, { type: 'extract', at: [-5, 2] }],
  },
  {
    id: 'blacksand', name: 'Black Sand', tag: 'Recon', env: 'night', map: 'port', time: '0210 · Night', color: '#7fd1c7', level: 2, stealth: true,
    brief: 'Slip into Port Tamar under the cranes. Recover the courier\'s intel case from the container stacks, then reach the helicopter. Guards carry flashlights. Night vision is on N and your flashlight on L.',
    start: [-55, 55], startYaw: -0.81,
    spawn: { max: 6, every: 3.5, heavy: 0.15 },
    guards: [[10, -4, 'rifleman'], [20, -15, 'rifleman'], [6, -17, 'rifleman'], [-20, -8, 'heavy'], [36, -6, 'rifleman'], [-8, 12, 'rifleman'], [24, 12, 'rifleman'], [-40, 12, 'rifleman']],
    objectives: [{ type: 'intel', at: [14, -10] }, { type: 'extract', at: [54, 30] }],
  },
  {
    id: 'kingpin', name: 'Kingpin', tag: 'Assassination', env: 'rain', map: 'village', time: '1645 · Thunderstorm', color: '#9aa8b4', level: 3,
    brief: 'The warlord known as the Jackal is meeting his lieutenants in a walled compound in the mountain village of Shirin Dara. Kill him before he reaches his convoy at the north-east gate, then extract.',
    start: [-56, -8], startYaw: -Math.PI / 2,
    spawn: { max: 6, every: 4, heavy: 0.25, marks: 1 },
    guards: [[18, 0, 'rifleman'], [-10, -14, 'rifleman'], [2, 20, 'rifleman'], [30, -20, 'rifleman']],
    objectives: [{ type: 'hvt', at: [34, 19], escape: [57, 57] }, { type: 'extract', at: [-50, -50] }],
  },
  {
    id: 'lastlight', name: 'Last Light', tag: 'Defend', env: 'sunset', map: 'city', time: '1902 · Sunset', color: '#e5703c', level: 4,
    brief: 'Engineers are relaying satellite imagery through a field uplink at a crossroads in the ruins of Haddar. Keep it online for three minutes while the enemy throws everything at it.',
    start: [10, 20], startYaw: 0, winText: 'Transfer complete',
    spawn: { max: 9, every: 2.2, heavy: 0.3, marks: 2 },
    objectives: [{ type: 'defend', at: [12, 12], duration: 180 }],
  },
];
let MISSION = MISSIONS[0];
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const OBJ = {
  plant: {
    init(o) {
      o.sites = o.at.map(([x, z, rot]) => { const p = freeSpot(x, z, 3.4); return { p, ent: buildSAM(p, rot), planted: false }; });
      o.timer = -1; o.doneAt = 0;
    },
    label(o) { const n = o.sites.filter((s) => s.planted).length; return o.timer >= 0 ? 'Charges set. Clear the blast radius' : `Destroy the SAM launchers (${n}/${o.sites.length})`; },
    sub(o) { return o.timer >= 0 ? `Detonation in ${Math.ceil(o.timer)}` : 'Hold E at a launcher to plant a charge'; },
    point(o) { const s = o.sites.filter((t) => !t.planted).sort((a, b) => a.p.distanceTo(player.pos) - b.p.distanceTo(player.pos))[0]; return s ? _mkp.copy(s.p).setY(3.2) : null; },
    interact(o) {
      const s = o.sites.find((t) => !t.planted && t.p.distanceTo(player.pos) < 4.2);
      if (!s) return null;
      return { label: 'Plant charge', need: 2.6, done: () => {
        s.planted = true; s.ent.charge.visible = true; Sfx.beep(); addPopup(100, 'CHARGE PLANTED'); G.score += 100;
        if (o.sites.every((t) => t.planted)) { o.timer = 7; showBanner('All charges set', 'Clear the area', 'danger', 2.4); }
      } };
    },
    update(o, dt) {
      for (const s of o.sites) if (s.planted && o.timer >= 0) s.ent.chargeLed.visible = Math.sin(G.time * (o.timer < 3 ? 30 : 12)) > 0;
      if (o.timer >= 0) {
        const before = Math.ceil(o.timer); o.timer -= dt;
        if (Math.ceil(o.timer) !== before && o.timer > 0) Sfx.beep();
        if (o.timer <= 0) {
          o.timer = -2; o.doneAt = G.time + 3;
          o.sites.forEach((s, i) => after(i * 0.45, () => {
            explode(s.p.clone().setY(1.2), { radius: 10, dmg: 600, playerDmg: 140, cause: 'frag' });
            s.ent.g.traverse((m) => { if (m.isMesh) m.material = MAT.burnt; });
            s.ent.L.rotation.x = 0.1; s.ent.charge.visible = false;
            missionFires.push(s.p.clone().setY(1.6));
          }));
        }
      }
      return o.timer === -2 && G.time > o.doneAt ? 'done' : null;
    },
  },
  intel: {
    init(o) { o.p = freeSpot(o.at[0], o.at[1], 1.4); o.ent = buildIntel(o.p); },
    label() { return 'Recover the intel case'; },
    sub() { return G.alarm ? 'They know you are here' : 'Stay out of flashlight beams'; },
    point(o) { return _mkp.copy(o.p).setY(1.6); },
    interact(o) {
      if (o.p.distanceTo(player.pos) > 2.6) return null;
      return { label: 'Take intel', need: 2.2, done: () => { o.ent.kase.visible = false; o.taken = true; Sfx.pickup(); addPopup(500, 'INTEL SECURED'); G.score += 500; if (!G.alarm) raiseAlarm('The case was alarmed'); } };
    },
    update(o) { o.ent.led.visible = Math.sin(G.time * 5) > 0; return o.taken ? 'done' : null; },
  },
  hvt: {
    init(o) {
      const p = freeSpot(o.at[0], o.at[1], 1.2);
      o.escape = new V3(o.escape[0], 0, o.escape[1]);
      o.hvt = new Enemy('commander', p); o.hvt.post = p.clone(); o.hvt.flee = o.escape; o.hvt.alerted = false;
      enemies.push(o.hvt);
      for (const [dx, dz] of [[2.5, 1.5], [-2.5, 1.2], [0, -2.8]]) { const e = new Enemy('heavy', freeSpot(p.x + dx, p.z + dz, 0.8)); e.post = e.pos.clone(); e.alerted = false; enemies.push(e); }
    },
    label(o) { return o.hvt.alerted && !o.hvt.dead ? 'The Jackal is running for his convoy' : 'Eliminate the Jackal'; },
    sub(o) { return o.hvt.alerted ? `Convoy ${Math.round(o.hvt.pos.distanceTo(o.escape))} m from him` : 'He is guarded by Juggernauts'; },
    point(o) { return o.hvt.dead ? null : o.hvt.eyeInto(_mkp).setY(o.hvt.pos.y + 2.3); },
    hvt: true,
    update(o) {
      if (o.hvt.dead) { addPopup(1000, 'HVT ELIMINATED'); G.score += 1000; return 'done'; }
      if (o.hvt.pos.distanceTo(o.escape) < 3) return { fail: 'The Jackal reached his convoy' };
      return null;
    },
  },
  defend: {
    init(o) {
      const p = freeSpot(o.at[0], o.at[1], 1.2);
      o.ent = buildUplink(p); o.left = o.duration; o.p = p;
      G.uplink = { pos: p, hp: 100, hitT: -9 };
    },
    label() { return 'Defend the uplink'; },
    sub(o) { return `Transfer ${Math.round((1 - o.left / o.duration) * 100)}% · ${fmtTime(o.left)} left`; },
    point(o) { return _mkp.copy(o.p).setY(8.4); },
    update(o, dt) {
      o.left -= dt;
      o.ent.beacon.visible = Math.sin(G.time * (G.time - G.uplink.hitT < 0.5 ? 25 : 4)) > 0;
      if (G.uplink.hp <= 0) { explode(G.uplink.pos.clone().setY(1), { radius: 6, dmg: 200, playerDmg: 60 }); G.uplink = null; return { fail: 'The uplink was destroyed' }; }
      if (o.left <= 0) { addPopup(1500, 'TRANSFER COMPLETE'); G.score += 1500; G.uplink = null; return 'done'; }
      return null;
    },
  },
  extract: {
    init(o) {
      o.p = freeSpot(o.at[0], o.at[1], 5); G.extracting = true;
      showBanner('Extraction', 'Helicopter inbound', '', 2.4); Sfx.radio();
      after(2, () => { if (G.obj === o) spawnHeli(o.p); });
    },
    label() { return heli && heli.landed ? 'Board the helicopter' : 'Get to the extraction point'; },
    sub() { return heli ? (heli.landed ? 'Dust off when you are aboard' : 'Helicopter inbound') : 'Pop smoke at the LZ'; },
    point(o) { return _mkp.copy(o.p).setY(2); },
    update(o) {
      if (Math.random() < 0.5) fxSmoke.spawn(o.p.x + rand(-0.3, 0.3), 0.3, o.p.z + rand(-0.3, 0.3), rand(-0.5, 0.5) + 0.6, rand(1.5, 2.6), rand(-0.5, 0.5), 0.2, 0.7, 0.3, rand(0.9, 1.5), rand(2.5, 3.5), { drag: 0.6, grow: 1.3, alpha: 0.7 });
      if (heli && heli.landed && Math.hypot(player.pos.x - o.p.x, player.pos.z - o.p.z) < 7) { heli.state = 'liftoff'; heli.t = 0; return 'done'; }
      return null;
    },
  },
};
const _mkp = new V3();
function curObjective() { return G.obj; }
function raiseAlarm(why) {
  if (G.alarm) return;
  G.alarm = true;
  showBanner(why || 'Alarm raised', 'Reinforcements inbound', 'danger', 2.4);
  Sfx.alarm();
  for (const e of enemies) if (!e.dead) { e.alerted = true; e.lastKnown.copy(player.pos); }
}
function onEnemyAlert() { if (MISSION.stealth && !G.alarm) after(1.2, () => raiseAlarm()); }
function nextObjective() {
  G.objIdx++;
  if (G.objIdx > 0) { addPopup(500, 'OBJECTIVE COMPLETE'); G.score += 500; }
  if (G.objIdx >= MISSION.objectives.length) { missionComplete(); return; }
  const o = G.obj = { ...MISSION.objectives[G.objIdx] };
  OBJ[o.type].init(o);
  if (G.objIdx > 0) { Sfx.radio(); showBanner('New objective', OBJ[o.type].label(o), '', 2.6); }
}
function setupMission() {
  G.alarm = !MISSION.stealth; G.extracting = false; G.objIdx = -1; G.obj = null; G.result = null;
  G.flashlight = false; setNVG(false);
  const isWaves = MISSION.mode === 'waves';
  $('objective').hidden = isWaves;
  hud.el.querySelector('#tl .wave').hidden = !isWaves;
  $('hostiles').hidden = !isWaves;
  $('nvg-hint').hidden = !ENV.night;
  $('tb-nvg').hidden = $('tb-light').hidden = !(IS_TOUCH && ENV.night);
  if (isWaves) { showBanner('Kessar Compound · 0552', 'Hold the crossroads', '', 2.6); after(2.2, () => startWave(1)); return; }
  G.wave = MISSION.level;
  if (MISSION.start) { player.pos.set(MISSION.start[0], 0, MISSION.start[1]); player.yaw = MISSION.startYaw || 0; }
  for (const [x, z, type] of MISSION.guards || []) { const e = new Enemy(type, freeSpot(x, z, 0.8)); e.post = e.pos.clone(); e.alerted = false; enemies.push(e); }
  const marks = MISSION.spawn?.marks || 0;
  for (let i = 0; i < marks; i++) { const spot = MARKSMAN_SPOTS.find((s) => !s.used); if (spot) { spot.used = true; enemies.push(new Enemy('marksman', spot.pos, spot)); } }
  G.spawnT = MISSION.stealth ? 0 : 6;
  nextObjective();
  showBanner(MISSION.time, MISSION.name, '', 3);
}
function updateDirector(dt) {
  const S = MISSION.spawn;
  if (!S || (MISSION.stealth && !G.alarm)) return;
  G.spawnT -= dt;
  if (G.spawnT > 0) return;
  const alive = enemies.filter((e) => !e.dead && !e.T.static).length;
  if (alive < S.max + (G.extracting ? 3 : 0)) enemies.push(new Enemy(Math.random() < S.heavy ? 'heavy' : 'rifleman', pickSpawn()));
  G.spawnT = S.every * (G.extracting ? 0.6 : 1) * rand(0.7, 1.3);
}
const use = { avail: null, t: 0 };
function updateMission(dt) {
  if (MISSION.mode === 'waves') { if (G.mode === 'play') updateWaves(dt); return; }
  if (G.mode !== 'play') { updateHeli(dt); return; }
  updateDirector(dt);
  const o = G.obj;
  if (o) {
    const r = OBJ[o.type].update(o, dt);
    if (r === 'done') nextObjective();
    else if (r && r.fail) missionFailed(r.fail);
  }
  updateHeli(dt);
  for (const p of missionFires) {
    fxAdd.spawn(p.x + rand(-0.8, 0.8), p.y, p.z + rand(-1.2, 1.2), rand(-0.3, 0.3), rand(1.5, 3.2), rand(-0.3, 0.3), 1, rand(0.35, 0.6), 0.1, rand(0.6, 1), rand(0.4, 0.8), { drag: 1, grow: -0.6 });
    if (Math.random() < dt * 8) fxSmoke.spawn(p.x, p.y + 1.5, p.z, rand(-0.3, 0.3) + 0.5, rand(1.8, 2.8), rand(-0.3, 0.3), 0.1, 0.09, 0.08, rand(1.4, 2), rand(5, 7), { drag: 0.3, grow: 1.2, alpha: 0.75 });
  }
  const cur = G.obj;
  use.avail = cur && player.alive && OBJ[cur.type].interact ? OBJ[cur.type].interact(cur) : null;
  const holding = input.keys.KeyE || touch.use;
  if (use.avail && holding) {
    use.t += dt;
    if (use.t >= use.avail.need) { const a = use.avail; use.t = 0; use.avail = null; a.done(); }
  } else use.t = 0;
}
function missionComplete() {
  if (G.mode !== 'play') return;
  G.mode = 'won'; G.result = 'won';
  const t = G.time;
  const bonus = 2000 + Math.max(0, Math.round((600 - t) * 4));
  G.score += bonus;
  G.missionTime = t;
  const prog = store.get('missions', {});
  const prev = prog[MISSION.id] || {};
  prog[MISSION.id] = { done: true, best: Math.min(prev.best || Infinity, Math.round(t)), score: Math.max(prev.score || 0, G.score) };
  store.set('missions', prog);
  showBanner('Mission complete', MISSION.name, '', 3);
  Sfx.victory();
  setTimeout(showGameOver, 3200);
}
function missionFailed(reason) {
  if (G.mode !== 'play') return;
  G.mode = 'dead'; G.result = 'failed'; G.failReason = reason; G.timeScale = 0.5; G.missionTime = G.time;
  canvas.classList.add('dying');
  showBanner('Mission failed', reason, 'danger', 2.6);
  setTimeout(showGameOver, 2800);
}
const _mk = new V3();
function updateMissionHUD() {
  const mk = $('objmarker'), o = G.obj;
  if (MISSION.mode === 'waves' || !o) { mk.hidden = true; $('use').hidden = true; G.objPoint = null; $('tb-use').hidden = true; return; }
  const def = OBJ[o.type];
  setText($('obj-text'), 'objt', def.label(o));
  setText($('obj-sub'), 'objs', def.sub ? def.sub(o) : '');
  const up = $('uplink');
  up.hidden = !G.uplink;
  if (G.uplink) { up.firstChild.style.width = `${clamp(G.uplink.hp, 0, 100)}%`; up.classList.toggle('low', G.uplink.hp < 35); }
  const p = def.point(o);
  G.objPoint = p ? p.clone() : null;
  if (!p || G.mode !== 'play') mk.hidden = true;
  else {
    mk.hidden = false;
    _mk.copy(p).project(camera);
    const W = innerWidth, H = innerHeight, m = 48;
    let x = (_mk.x * 0.5 + 0.5) * W, y = (-_mk.y * 0.5 + 0.5) * H;
    const behind = _mk.z > 1;
    if (behind) { x = W - x; y = H - m; }
    const edge = behind || x < m || x > W - m || y < m || y > H - m;
    x = clamp(x, m, W - m); y = clamp(y, m, H - m);
    mk.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%)`;
    mk.classList.toggle('edge', edge);
    mk.classList.toggle('hvt', !!def.hvt);
    setText(mk.querySelector('.lbl'), 'mkl', def.hvt ? 'HVT' : o.type === 'extract' ? 'LZ' : 'OBJ');
    setText(mk.querySelector('.dst'), 'mkd', `${Math.round(Math.hypot(p.x - player.pos.x, p.z - player.pos.z))} m`);
  }
  const u = $('use');
  u.hidden = !use.avail;
  if (use.avail) {
    setText(u.querySelector('.lbl'), 'usel', `${IS_TOUCH ? 'Hold USE' : 'Hold E'} · ${use.avail.label}`);
    u.querySelector('.bar i').style.width = `${(use.t / use.avail.need) * 100}%`;
  }
  $('tb-use').hidden = !(IS_TOUCH && use.avail);
}
function renderMissions() {
  const prog = store.get('missions', {}), best = store.get('best', { score: 0, wave: 0 });
  const grid = $('mission-grid');
  grid.textContent = '';
  MISSIONS.forEach((M, i) => {
    const card = document.createElement('article');
    card.className = 'mcard'; card.style.setProperty('--sky', M.color);
    const pr = prog[M.id];
    const status = M.mode === 'waves'
      ? (best.score ? `Best ${best.score.toLocaleString('en-US')} · ${best.wave} waves` : 'Not attempted')
      : (pr && pr.done ? `Complete · best ${fmtTime(pr.best)}` : 'Not attempted');
    card.innerHTML = `<div class="mnum"><span>OP ${String(i + 1).padStart(2, '0')} · <b>${M.tag.toUpperCase()}</b></span></div>
      <h3>${M.name}</h3><div class="mtime">${MAPS[M.map || 'kessar'].name.toUpperCase()} · ${M.time.toUpperCase()}</div><p>${M.brief}</p>
      <div class="mfoot"><span class="mstat${pr && pr.done ? ' done' : ''}">${status}</span><button class="btn primary" type="button">Deploy</button></div>`;
    card.querySelector('button').addEventListener('click', () => startMission(M.id));
    grid.appendChild(card);
  });
}

// ---------------------------------------------------------------- flow: menu, play, pause, game over
const screens = { menu: $('menu'), missions: $('missions'), pause: $('pause'), gameover: $('gameover'), settings: $('settings') };
let pointerLocked = false;
function lockPointer() {
  if (IS_TOUCH || !canvas.requestPointerLock) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* play without pointer lock */ }
}
let lockedAt = 0;
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (pointerLocked) lockedAt = performance.now();
  if (!pointerLocked && G.mode === 'play' && !G.paused) pause();
});
function resetRun() {
  for (const e of enemies) e.remove();
  enemies.length = 0; enemyParts.length = 0;
  for (const g of grenades) scene.remove(g.m);
  grenades.length = 0;
  for (const p of pickups) scene.remove(p.g);
  pickups.length = 0;
  for (const f of flying) scene.remove(f.obj);
  flying.length = 0;
  for (const j of jets) scene.remove(j.g);
  jets.length = 0;
  for (const b of bombs) scene.remove(b.m);
  bombs.length = 0;
  for (const d of decals) d.visible = false;
  for (const s of MARKSMAN_SPOTS) s.used = false;
  for (const ps of particleSystems) ps.clear();
  timers.length = 0;
  strikeMark = null;
  Object.assign(G, { paused: false, time: 0, timeScale: 1, shake: 0, wave: 0, wavesCleared: 0, toSpawn: 0, marksToSpawn: 0, spawnT: 0, intermission: 0, score: 0, kills: 0, headshots: 0, shots: 0, hits: 0, streak: 0, bestStreak: 0, uavUntil: -1, strikes: 0, lastKillT: -9, multi: 0, lastShotT: -9, nextBoom: 10, deathT: 0 });
  Object.assign(player, { yaw: 0, pitch: 0, recoilPitch: 0, onGround: true, crouch: false, slide: 0, sprinting: false, eye: 1.62, hp: 100, lastHurt: -99, alive: true, bobT: 0, roll: 0 });
  player.pos.copy(PLAYER_START); player.vel.set(0, 0, 0);
  ws.state = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));
  ws.cur = 0; ws.reloading = false; ws.fireCd = 0; ws.bloom = 0; ws.nades = 3;
  Object.assign(vm, { adsT: 0, sprintT: 0, kick: 0, raiseT: 0.42, meleeT: 0, throwT: 0, pumpT: 0, boltT: 0 });
  vm.models.forEach((m, j) => { m.g.visible = j === 0; });
  Object.assign(input, { keys: {}, fire: false, fireQueued: false, ads: false, jump: false });
  Object.assign(touch, { moveX: 0, moveY: 0, fire: false, ads: false, sprint: false });
  hud.feed.textContent = ''; hud.popups.textContent = ''; hud.dmg.textContent = '';
  canvas.classList.remove('dying');
  clearMission();
  G.flashlight = false; setNVG(false); use.avail = null; use.t = 0;
  touch.use = false;
}
function startMission(id) { MISSION = MISSIONS.find((m) => m.id === id) || MISSIONS[0]; startGame(); }
function startGame() {
  Sfx.init();
  const mapChanged = loadMap(MISSION.map || 'kessar');
  applyEnv(MISSION.env, mapChanged);
  resetRun();
  G.mode = 'play';
  for (const s of Object.values(screens)) s.hidden = true;
  hud.el.hidden = false;
  $('touch').hidden = !IS_TOUCH;
  sizeHudCanvases();
  refreshWeaponHUD(true); updateStreakHUD();
  setupMission();
  lockPointer();
}
function openMissions() { renderMissions(); screens.menu.hidden = true; screens.missions.hidden = false; }
function pause() {
  if (G.mode !== 'play' || G.paused) return;
  G.paused = true;
  input.fire = false; input.ads = false; input.keys = {};
  screens.pause.hidden = false;
  if (pointerLocked) document.exitPointerLock();
}
function resume() {
  if (!G.paused) return;
  G.paused = false;
  screens.pause.hidden = true;
  lockPointer();
}
function toMenu() {
  resetRun();
  G.mode = 'menu';
  hud.el.hidden = true; $('touch').hidden = true;
  for (const s of Object.values(screens)) s.hidden = true;
  screens.menu.hidden = false;
  if (pointerLocked) document.exitPointerLock();
  loadBest();
}
function showGameOver() {
  if (G.mode !== 'dead' && G.mode !== 'won') return;
  const waves = MISSION.mode === 'waves', won = G.result === 'won';
  $('go-title').textContent = won ? 'Mission complete' : G.result === 'failed' ? 'Mission failed' : 'K.I.A.';
  screens.gameover.classList.toggle('won', won);
  $('st-waves-label').textContent = waves ? 'Waves held' : 'Time';
  const idx = MISSIONS.indexOf(MISSION);
  $('btn-next').hidden = !(won && idx < MISSIONS.length - 1);
  $('btn-retry').classList.toggle('primary', !won || idx >= MISSIONS.length - 1);
  $('st-score').textContent = G.score.toLocaleString('en-US');
  $('st-waves').textContent = waves ? String(G.wavesCleared) : fmtTime(G.missionTime || G.time);
  $('st-kills').textContent = String(G.kills);
  $('st-hs').textContent = String(G.headshots);
  $('st-acc').textContent = G.shots ? `${Math.round((G.hits / G.shots) * 100)}%` : '—';
  $('st-streak').textContent = String(G.bestStreak);
  const best = store.get('best', { score: 0, wave: 0 });
  $('go-sub').textContent = !waves ? `${MISSION.name} · ${won ? (MISSION.winText || 'Extracted') : G.result === 'failed' ? G.failReason : 'Killed in action'}`
    : G.score > 0 && G.score >= best.score ? 'New best score' : `Fell on wave ${Math.max(1, G.wave)}`;
  hud.el.hidden = true; $('touch').hidden = true;
  screens.gameover.hidden = false;
  if (pointerLocked) document.exitPointerLock();
}
function loadBest() {
  const best = store.get('best', { score: 0, wave: 0 }), prog = store.get('missions', {});
  $('best-ops').textContent = `${MISSIONS.filter((m) => m.mode !== 'waves' && prog[m.id] && prog[m.id].done).length}/${MISSIONS.length - 1}`;
  $('best-score').textContent = best.score.toLocaleString('en-US');
  $('best-wave').textContent = String(best.wave);
}
loadBest();

$('btn-deploy').addEventListener('click', openMissions);
$('btn-missions-back').addEventListener('click', () => { screens.missions.hidden = true; screens.menu.hidden = false; });
$('btn-retry').addEventListener('click', startGame);
$('btn-next').addEventListener('click', () => { const i = MISSIONS.indexOf(MISSION); startMission(MISSIONS[Math.min(i + 1, MISSIONS.length - 1)].id); });
$('btn-menu').addEventListener('click', toMenu);
$('btn-resume').addEventListener('click', resume);
$('btn-quit').addEventListener('click', toMenu);
let settingsReturn = null;
function openSettings(from) { settingsReturn = from; screens.settings.hidden = false; $('set-sens').focus(); }
$('btn-settings').addEventListener('click', () => openSettings('menu'));
$('btn-settings-2').addEventListener('click', () => openSettings('pause'));
$('btn-settings-done').addEventListener('click', () => { screens.settings.hidden = true; settingsReturn = null; });

function bindSettings() {
  const sens = $('set-sens'), fov = $('set-fov'), vol = $('set-vol'), q = $('set-quality');
  sens.value = settings.sens; fov.value = settings.fov; vol.value = settings.volume; q.value = settings.quality;
  const show = () => {
    $('out-sens').textContent = Number(settings.sens).toFixed(2);
    $('out-fov').textContent = `${settings.fov}°`;
    $('out-vol').textContent = `${Math.round(settings.volume * 100)}%`;
  };
  show();
  sens.addEventListener('input', () => { settings.sens = Number(sens.value); store.set('sens', settings.sens); show(); });
  fov.addEventListener('input', () => { settings.fov = Number(fov.value); store.set('fov', settings.fov); show(); });
  vol.addEventListener('input', () => { settings.volume = Number(vol.value); store.set('volume', settings.volume); Sfx.setVolume(settings.volume); show(); });
  q.addEventListener('change', () => { settings.quality = q.value; settings.qualityManual = true; store.set('quality', settings.quality); store.set('qualityManual', true); applyQuality(); });
}
bindSettings();

// ---------------------------------------------------------------- input
const playing = () => G.mode === 'play' && !G.paused;
addEventListener('keydown', (e) => {
  if (!screens.settings.hidden && e.code === 'Escape') { screens.settings.hidden = true; return; }
  if (G.mode !== 'play') return;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.paused) { if (e.code === 'KeyP') resume(); } else pause(); return; }
  if (G.paused) return;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  input.keys[e.code] = true;
  switch (e.code) {
    case 'KeyR': startReload(); break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': switchWeapon(Number(e.code.slice(5)) - 1); break;
    case 'KeyQ': switchWeapon((ws.cur + 1) % WEAPONS.length); break;
    case 'KeyG': throwGrenade(); break;
    case 'KeyV': case 'KeyF': melee(); break;
    case 'KeyB': callAirstrike(); break;
    case 'KeyN': if (ENV.night) setNVG(!G.nvg); break;
    case 'KeyL': toggleFlashlight(); break;
    case 'KeyC': crouchPress(); break;
    case 'Space': input.jump = true; break;
  }
});
addEventListener('keyup', (e) => { input.keys[e.code] = false; });
addEventListener('blur', () => { input.keys = {}; input.fire = false; input.ads = false; if (G.mode === 'play') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play') pause(); });
canvas.addEventListener('mousedown', (e) => {
  if (!playing() || IS_TOUCH) return;
  if (!pointerLocked) lockPointer();
  if (e.button === 0) { input.fire = true; input.fireQueued = true; }
  if (e.button === 2) input.ads = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { input.fire = false; input.fireQueued = false; }
  if (e.button === 2) input.ads = false;
});
addEventListener('contextmenu', (e) => { if (G.mode === 'play') e.preventDefault(); });
addEventListener('mousemove', (e) => {
  if (!playing() || IS_TOUCH || !player.alive) return;
  // Browsers can report a large bogus jump right after pointer lock engages; drop it.
  if (performance.now() - lockedAt < 120 || Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;
  const s = 0.0022 * settings.sens * (camera.fov / baseFov());
  player.yaw -= e.movementX * s;
  player.pitch = clamp(player.pitch - e.movementY * s, -1.5, 1.5);
  input.lookDX += e.movementX; input.lookDY += e.movementY;
});
addEventListener('wheel', (e) => {
  if (!playing()) return;
  switchWeapon((ws.cur + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length);
}, { passive: true });

// Touch controls: left stick moves, dragging anywhere else looks, buttons act.
(function setupTouch() {
  const layer = $('touch'), stick = $('stick'), knob = $('knob');
  let stickId = null, lookId = null, lx = 0, ly = 0;
  const stickMove = (e) => {
    const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = r.width / 2, l = Math.hypot(dx, dy);
    if (l > max) { dx *= max / l; dy *= max / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.moveX = dx / max; touch.moveY = -dy / max;
    touch.sprint = l > max * 0.95 && -dy > max * 0.7;
  };
  stick.addEventListener('pointerdown', (e) => { e.preventDefault(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; knob.style.transform = ''; touch.moveX = touch.moveY = 0; touch.sprint = false; };
  stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);
  layer.addEventListener('pointerdown', (e) => { if (e.target !== layer || lookId !== null) return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; layer.setPointerCapture(e.pointerId); });
  layer.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId || !playing() || !player.alive) return;
    const s = 0.0048 * settings.sens * (camera.fov / baseFov());
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    player.yaw -= dx * s; player.pitch = clamp(player.pitch - dy * s, -1.5, 1.5);
    input.lookDX += dx * 1.5; input.lookDY += dy * 1.5;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  layer.addEventListener('pointerup', lookEnd); layer.addEventListener('pointercancel', lookEnd);
  const btn = (id, down, up) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (playing()) down(el); });
    if (up) { el.addEventListener('pointerup', () => up(el)); el.addEventListener('pointercancel', () => up(el)); el.addEventListener('pointerleave', () => up(el)); }
  };
  btn('tb-fire', (el) => { touch.fire = true; input.fireQueued = true; el.classList.add('on'); }, (el) => { touch.fire = false; input.fireQueued = false; el.classList.remove('on'); });
  btn('tb-ads', (el) => { touch.ads = !touch.ads; el.classList.toggle('on', touch.ads); });
  btn('tb-jump', () => { input.jump = true; });
  btn('tb-crouch', () => crouchPress());
  btn('tb-reload', () => startReload());
  btn('tb-nade', () => throwGrenade());
  btn('tb-swap', () => switchWeapon((ws.cur + 1) % WEAPONS.length));
  btn('tb-strike', () => callAirstrike());
  btn('tb-pause', () => pause());
  btn('tb-use', (el) => { touch.use = true; el.classList.add('on'); }, (el) => { touch.use = false; el.classList.remove('on'); });
  btn('tb-nvg', () => setNVG(!G.nvg));
  btn('tb-light', () => toggleFlashlight());
})();

// ---------------------------------------------------------------- resize, quality, main loop
// ---------------------------------------------------------------- post-processing (High quality)
// The scene renders into an HDR target; bloom, sun shafts, tone mapping and the grade are applied in one final pass.
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const fsGeo = new THREE.BufferGeometry();
fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fsGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const fsMesh = new THREE.Mesh(fsGeo); fsMesh.frustumCulled = false;
const fsScene = new THREE.Scene(); fsScene.add(fsMesh);
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsMat = (uniforms, frag) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
const mkRT = (samples = 0, depth = false) => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples, depthBuffer: depth });
const post = {
  scene: mkRT(renderer.capabilities.isWebGL2 ? 4 : 0, true), half: mkRT(), qA: mkRT(), qB: mkRT(), eA: mkRT(), eB: mkRT(), rays: mkRT(), fA: mkRT(), fB: mkRT(),
  copy: fsMat({ tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } }, `uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
    void main(){ gl_FragColor = vec4((texture2D(tDiffuse, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(0.5, -0.5)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25, 1.0); }`),
  bright: fsMat({ tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } }, `uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      vec3 c = (texture2D(tDiffuse, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(0.5, -0.5)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tDiffuse, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25;
      float l = max(c.r, max(c.g, c.b)); float knee = 0.5, th = 1.2;
      float soft = clamp(l - th + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee + 1e-4);
      gl_FragColor = vec4(min(c * max(soft, l - th) / max(l, 1e-4), vec3(24.0)), 1.0);
    }`),
  blur: fsMat({ tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } }, `uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270;
      c += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * 0.3162;
      c += (texture2D(tDiffuse, vUv + uDir * 3.2308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2308).rgb) * 0.0703;
      gl_FragColor = vec4(c, 1.0);
    }`),
  shafts: fsMat({ tDiffuse: { value: null }, uSun: { value: new THREE.Vector2() }, uStrength: { value: 0 }, uAspect: { value: 1 } }, `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform float uAspect; varying vec2 vUv;
    void main(){
      vec2 d = (vUv - uSun) * (0.95 / 56.0); vec2 uv = vUv; vec3 acc = vec3(0.0); float w = 1.0;
      for (int i = 0; i < 56; i++) {
        uv -= d;
        vec2 o = (uv - uSun) * vec2(uAspect, 1.0);
        acc += texture2D(tDiffuse, uv).rgb * w * smoothstep(0.42, 0.0, length(o));
        w *= 0.965;
      }
      gl_FragColor = vec4(acc * (uStrength / 56.0), 1.0);
    }`),
  final: fsMat({
    tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, tRays: { value: null }, tFocus: { value: null },
    uExposure: { value: 1 }, uNVG: { value: 0 }, uFocus: { value: 0 }, uFlare: { value: 0 }, uRainLens: { value: 0 },
    uTime: { value: 0 }, uDesat: { value: 0 }, uCA: { value: 0.004 }, uGrain: { value: 0.012 }, uRes: { value: new THREE.Vector2(1, 1) }, uBloom: { value: 0.55 },
  }, `uniform sampler2D tScene, tB1, tB2, tRays, tFocus; uniform float uTime, uDesat, uCA, uGrain, uBloom, uExposure, uNVG, uFocus, uFlare, uRainLens; uniform vec2 uRes; varying vec2 vUv;
    vec3 ivRrtOdt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 ivAces(vec3 c){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c = I * (c / 0.6); c = ivRrtOdt(c); return clamp(O * c, 0.0, 1.0);
    }
    vec3 ivToSRGB(vec3 c){ return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    void main(){
      vec2 uv = vUv;
      if (uRainLens > 0.0) {
        vec2 g = vUv * vec2(26.0, 15.0); vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float r = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
        float life = fract(uTime * (0.12 + r * 0.25) + r * 7.0);
        vec2 c = vec2(r - 0.5, fract(r * 7.13) - 0.5) * 0.5 + vec2(0.0, life * 0.25);
        float drop = smoothstep(0.2, 0.0, length((f - c) * vec2(1.0, 0.8))) * step(0.6, r) * (1.0 - life);
        uv += (f - c) * drop * 0.05 * uRainLens;
      }
      vec2 cd = uv - 0.5; float r2 = dot(cd, cd);
      vec2 off = cd * r2 * uCA;
      vec3 col = vec3(texture2D(tScene, uv - off).r, texture2D(tScene, uv).g, texture2D(tScene, uv + off).b);
      if (uFocus > 0.0) col = mix(col, texture2D(tFocus, uv).rgb, smoothstep(0.14, 0.5, length(cd * vec2(uRes.x / uRes.y, 1.0))) * uFocus);
      vec3 bloom = texture2D(tB1, uv).rgb * 0.55 + texture2D(tB2, uv).rgb * 0.9;
      col += bloom * uBloom + texture2D(tRays, uv).rgb * vec3(1.0, 0.86, 0.66);
      if (uFlare > 0.0) {
        vec2 gv = vec2(0.5) - uv; vec3 gh = vec3(0.0);
        for (int i = 1; i < 5; i++) { vec2 sp = uv + gv * (float(i) * 0.42); float w = pow(max(1.0 - length(vec2(0.5) - sp) / 0.71, 0.0), 5.0); gh += texture2D(tB2, sp).rgb * w * (i == 2 ? vec3(0.6, 0.8, 1.0) : vec3(1.0, 0.8, 0.6)); }
        vec2 hv = normalize(gv + 1e-5) * 0.38; float hw = pow(max(1.0 - abs(length(gv) - 0.38) * 12.0, 0.0), 2.0);
        gh += texture2D(tB2, uv + hv).rgb * hw * 0.6;
        col += gh * uFlare * 0.3;
      }
      col *= uExposure * (uNVG > 0.5 ? 4.0 : 1.0);
      col = ivAces(col);
      if (uNVG > 0.5) {
        float l = pow(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.8);
        float nz = fract(sin(dot(vUv * uRes + fract(uTime * 13.7) * 71.3, vec2(12.9898, 78.233))) * 43758.5453);
        col = vec3(0.16, 1.0, 0.3) * (l * 1.15 + (nz - 0.5) * 0.12);
        col *= 0.92 + 0.08 * sin(vUv.y * uRes.y * 1.4);
        col *= smoothstep(0.62, 0.48, length(cd * vec2(uRes.x / uRes.y, 1.0)));
        gl_FragColor = vec4(ivToSRGB(clamp(col, 0.0, 1.0)), 1.0);
        return;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.1 - uDesat);
      col *= mix(vec3(0.92, 0.99, 1.07), vec3(1.07, 1.0, 0.9), smoothstep(0.05, 0.75, l));
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col *= 1.0 - smoothstep(0.3, 1.05, sqrt(r2) * 1.4) * 0.5;
      float n = fract(sin(dot(vUv * uRes + fract(uTime * 7.13) * 91.7, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += n * uGrain * (1.2 - l);
      gl_FragColor = vec4(ivToSRGB(clamp(col, 0.0, 1.0)), 1.0);
    }`),
  depth: new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), aoA: mkRT(), aoB: mkRT(),
  depthMat: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
  ao: fsMat({ tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uProjScale: { value: 1 }, uRadius: { value: 0.9 }, uIntensity: { value: 1.6 } }, `#include <packing>
    uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uRes; uniform float uProjScale, uRadius, uIntensity; varying vec2 vUv;
    float gd(vec2 uv){ return unpackRGBAToDepth(texture2D(tDepth, uv)); }
    vec3 vp(vec2 uv, float d){ vec4 v = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
    void main(){
      float d = gd(vUv);
      if (d > 0.9999) { gl_FragColor = vec4(1.0); return; }
      vec3 P = vp(vUv, d);
      vec3 N = normalize(cross(dFdx(P), dFdy(P)));
      float sr = min(uRadius * uProjScale / -P.z, 70.0);
      float ang = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
      float occ = 0.0, r2 = uRadius * uRadius;
      for (int i = 0; i < 14; i++) {
        float t = (float(i) + 0.5) / 14.0, a = ang + t * 40.84;
        vec2 suv = vUv + vec2(cos(a), sin(a)) * t * sr / uRes;
        vec3 S = vp(suv, gd(suv));
        vec3 v = S - P; float vv = dot(v, v);
        float f = max(r2 - vv, 0.0) / r2;
        occ += f * f * max(dot(v, N) - 0.015 * -P.z * 0.05 - 0.02, 0.0) / (vv + 0.02);
      }
      gl_FragColor = vec4(vec3(clamp(1.0 - occ * uIntensity / 14.0, 0.0, 1.0)), 1.0);
    }`),
  aoBlur: fsMat({ tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uProjInv: { value: new THREE.Matrix4() } }, `#include <packing>
    uniform sampler2D tAO, tDepth; uniform vec2 uDir; uniform mat4 uProjInv; varying vec2 vUv;
    float lz(vec2 uv){ vec4 v = uProjInv * vec4(vec3(uv, unpackRGBAToDepth(texture2D(tDepth, uv))) * 2.0 - 1.0, 1.0); return -v.z / v.w; }
    void main(){
      float c = lz(vUv), sum = 0.0, w = 0.0;
      for (int i = -4; i <= 4; i++) {
        vec2 uv = vUv + uDir * float(i);
        float wt = exp(-abs(lz(uv) - c) / (0.04 * c + 0.05)) * (1.0 - abs(float(i)) / 5.0);
        sum += texture2D(tAO, uv).r * wt; w += wt;
      }
      gl_FragColor = vec4(vec3(sum / max(w, 1e-4)), 1.0);
    }`),
  aoApply: new THREE.ShaderMaterial({
    uniforms: { tAO: { value: null } }, vertexShader: FS_VERT, depthTest: false, depthWrite: false, transparent: true, premultipliedAlpha: true, blending: THREE.MultiplyBlending,
    fragmentShader: 'uniform sampler2D tAO; varying vec2 vUv; void main(){ gl_FragColor = vec4(vec3(texture2D(tAO, vUv).r), 1.0); }',
  }),
  setSize(w, h) {
    this.scene.setSize(w, h);
    this.depth.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.aoA.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); this.aoB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
    this.half.setSize(hw, hh); this.fA.setSize(hw, hh); this.fB.setSize(hw, hh); this.qA.setSize(qw, qh); this.qB.setSize(qw, qh); this.eA.setSize(ew, eh); this.eB.setSize(ew, eh); this.rays.setSize(qw, qh);
    this.final.uniforms.uRes.value.set(w, h);
  },
};
function runPass(mat, target) { fsMesh.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
const _sunNdc = new V3();
function renderPost(withVM) {
  renderer.setRenderTarget(post.scene); renderer.clear();
  renderer.render(scene, camera);
  if (ULTRA()) renderAO();
  if (withVM) { renderer.setRenderTarget(post.scene); renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
  const W = post.scene.width, H = post.scene.height;
  post.bright.uniforms.tDiffuse.value = post.scene.texture; post.bright.uniforms.uTexel.value.set(1 / W, 1 / H);
  runPass(post.bright, post.half);
  const b = post.blur.uniforms;
  b.tDiffuse.value = post.half.texture; b.uDir.value.set(2 / W, 0); runPass(post.blur, post.qA);
  b.tDiffuse.value = post.qA.texture; b.uDir.value.set(0, 4 / H); runPass(post.blur, post.qB);
  b.tDiffuse.value = post.qB.texture; b.uDir.value.set(8 / W, 0); runPass(post.blur, post.eA);
  b.tDiffuse.value = post.eA.texture; b.uDir.value.set(0, 8 / H); runPass(post.blur, post.eB);
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const facing = _fwd.dot(SUN_DIR);
  const sh = post.shafts.uniforms;
  _sunNdc.copy(camera.position).addScaledVector(SUN_DIR, 300).project(camera);
  sh.uStrength.value = smoothstep(0.1, 0.75, facing) * 0.8 * (1 - (skyUniforms.uOvercast.value + skyUniforms.uDust.value) * 0.85) * (ENV.night ? 0.25 : 1);
  sh.uSun.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5); sh.uAspect.value = W / H;
  sh.tDiffuse.value = post.half.texture;
  runPass(post.shafts, post.rays);
  const f = post.final.uniforms;
  f.tScene.value = post.scene.texture; f.tB1.value = post.qB.texture; f.tB2.value = post.eB.texture; f.tRays.value = post.rays.texture;
  f.uTime.value = performance.now() / 1000;
  f.uDesat.value = G.mode === 'menu' ? 0 : player.alive ? clamp((45 - player.hp) / 45, 0, 1) * 0.55 : 0.75;
  f.uExposure.value = ENV.exposure || 1;
  f.uNVG.value = G.nvg && G.mode !== 'menu' ? 1 : 0;
  f.uFlare.value = ENV.night || ENV.sky.overcast || ENV.sky.dust ? 0 : smoothstep(0.55, 0.95, facing);
  f.uRainLens.value = ENV.weather === 'rain' && G.mode !== 'menu' ? clamp(0.4 + camera.rotation.x * 1.5, 0, 1) : 0;
  const focus = G.mode === 'menu' ? 0 : ease(vm.adsT) * (WEAPONS[ws.cur].scope ? 0 : 0.85);
  f.uFocus.value = focus;
  if (focus > 0.01) {
    post.copy.uniforms.tDiffuse.value = post.scene.texture; post.copy.uniforms.uTexel.value.set(1 / W, 1 / H);
    runPass(post.copy, post.fA);
    b.tDiffuse.value = post.fA.texture; b.uDir.value.set(3 / W, 0); runPass(post.blur, post.fB);
    b.tDiffuse.value = post.fB.texture; b.uDir.value.set(0, 3 / H); runPass(post.blur, post.fA);
    f.tFocus.value = post.fA.texture;
  }
  runPass(post.final, null);
}
// Screen-space ambient occlusion (Ultra): a half-resolution depth pass, a scalable-AO estimate, a depth-aware blur,
// then a multiply over the scene before the weapon is drawn, so creases, corners and contact points darken naturally.
const _cc = new THREE.Color();
function renderAO() {
  const auto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  camera.layers.disable(NO_AO);
  scene.overrideMaterial = post.depthMat;
  renderer.getClearColor(_cc); const ca = renderer.getClearAlpha();
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(post.depth); renderer.clear(); renderer.render(scene, camera);
  renderer.setClearColor(_cc, ca);
  scene.overrideMaterial = null;
  camera.layers.enable(NO_AO);
  renderer.shadowMap.autoUpdate = auto;
  const a = post.ao.uniforms, w = post.depth.width, h = post.depth.height;
  a.tDepth.value = post.depth.texture; a.uProjInv.value.copy(camera.projectionMatrixInverse); a.uRes.value.set(w, h);
  a.uProjScale.value = h * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  runPass(post.ao, post.aoA);
  const bl = post.aoBlur.uniforms;
  bl.tDepth.value = post.depth.texture; bl.uProjInv.value.copy(camera.projectionMatrixInverse);
  bl.tAO.value = post.aoA.texture; bl.uDir.value.set(1 / w, 0); runPass(post.aoBlur, post.aoB);
  bl.tAO.value = post.aoB.texture; bl.uDir.value.set(0, 1 / h); runPass(post.aoBlur, post.aoA);
  post.aoApply.uniforms.tAO.value = post.aoA.texture;
  runPass(post.aoApply, post.scene);
}
// Sun shadows follow the player so nearby detail stays sharp.
function updateShadowFocus() {
  if (!sun.castShadow) return;
  const menu = G.mode === 'menu';
  const R = menu ? 92 : 64, cx = menu ? 0 : player.pos.x, cz = menu ? 0 : player.pos.z;
  const texel = (2 * R) / sun.shadow.mapSize.x;
  const sx = Math.round(cx / texel) * texel, sz = Math.round(cz / texel) * texel;
  sun.target.position.set(sx, 0, sz);
  sun.position.set(sx + SUN_DIR.x * 160, SUN_DIR.y * 160, sz + SUN_DIR.z * 160);
  const c = sun.shadow.camera;
  if (c.right !== R) { c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.updateProjectionMatrix(); }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(renderer.domElement.width, renderer.domElement.height);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vmCamera.aspect = w / h; vmCamera.fov = w / h < 1 ? 88 : 54; vmCamera.updateProjectionMatrix();
  updateParticleScale();
  sizeHudCanvases();
}
function applyQuality() {
  const hi = HIGH();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, hi ? 2 : 1));
  renderer.shadowMap.enabled = hi;
  sun.castShadow = hi;
  const ms = ULTRA() ? 4096 : 2048;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  fxAdd.mat.uniforms.uBoost.value = hi ? 2.2 : 1;
  $('grain').hidden = hi;
  $('vignette').style.opacity = hi ? '0.4' : '1';
  scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  resize();
}
addEventListener('resize', resize);
applyQuality();
captureEnvironment();

let menuAngle = 0.6;
function menuCamera(dt) {
  menuAngle += dt * 0.045;
  camera.position.set(Math.cos(menuAngle) * 40, 13 + Math.sin(menuAngle * 0.7) * 3, Math.sin(menuAngle) * 40);
  camera.lookAt(0, 3, 0);
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); updateParticleScale(); }
  camera.updateMatrixWorld();
}
function processTimers() {
  for (let i = timers.length - 1; i >= 0; i--) if (G.time >= timers[i].t) { const t = timers[i]; timers.splice(i, 1); t.fn(); }
}
function update(dt, rdt) {
  processTimers();
  updatePlayer(dt);
  updateCamera(dt);
  updateWeapons(dt);
  for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].update(dt)) { enemies[i].remove(); enemies.splice(i, 1); }
  updateGrenades(dt);
  updateAir(dt);
  updatePickups(dt);
  updateFlying(dt);
  updateMission(dt);
  updateFX(dt, rdt);
  updateViewmodel(dt);
  updateHUD(dt);
  G.nextBoom -= dt;
  if (G.nextBoom <= 0) { G.nextBoom = rand(9, 22); Sfx.distantBoom(); }
  if (G.mode === 'dead' && G.deathT > 1.2) G.timeScale = damp(G.timeScale, 1, 2, rdt);
  input.lookDX = 0; input.lookDY = 0;
}
let last = performance.now(), frameN = 0;
// If the first seconds of a deployment run slowly, step the graphics down once per level (unless the player picked a level).
const perf = { t: 0, n: 0, sum: 0 };
function adaptQuality(rdt) {
  if (settings.qualityManual || G.mode !== 'play' || G.paused || settings.quality === 'low') { perf.t = 0; perf.n = 0; perf.sum = 0; return; }
  perf.t += rdt; perf.n++; perf.sum += rdt;
  if (perf.t < 6) return;
  const avg = perf.sum / perf.n;
  perf.t = 0; perf.n = 0; perf.sum = 0;
  if (avg > 1 / 36) {
    settings.quality = settings.quality === 'ultra' ? 'high' : 'low';
    store.set('quality', settings.quality); $('set-quality').value = settings.quality;
    applyQuality();
    addPopup(0, `GRAPHICS SET TO ${settings.quality.toUpperCase()} FOR SMOOTHER PLAY`);
  } else settings.qualityManual = true;
}
function frame(now) {
  requestAnimationFrame(frame);
  // rAF timestamps can predate the end of a long synchronous load, so never step time backwards.
  const rdt = clamp((now - last) / 1000, 0, 0.05);
  last = now; frameN++;
  adaptQuality(rdt);
  if (G.mode === 'menu') { menuCamera(rdt); G.time += rdt; updateFX(rdt, rdt); }
  else if (!G.paused) { const dt = rdt * G.timeScale; G.time += dt; update(dt, rdt); }
  skyMesh.position.copy(camera.position);
  updateWeather(rdt);
  grassUniforms.uTime.value = performance.now() / 1000 * (ENV.weather === 'sand' ? 2.6 : ENV.weather === 'rain' ? 1.6 : 1);
  updateShadowFocus();
  const withVM = G.mode !== 'menu' && vm.root.visible;
  if (HIGH()) renderPost(withVM);
  else {
    renderer.setRenderTarget(null);
    renderer.toneMappingExposure = ENV.exposure || 1;
    renderer.clear();
    renderer.render(scene, camera);
    if (withVM) { renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
    if (frameN % 3 === 0) drawGrain();
  }
}
requestAnimationFrame(frame);

window.__ironveil = { startMission, MISSIONS, getObj: () => G.obj, use, setNVG, applyEnv, step: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { G.time += dt; update(dt, dt); } }, input, camera, WEAPONS, G, player, enemies, ws, startGame, pause, resume, toMenu, callAirstrike, throwGrenade, switchWeapon, activateUAV, explode };
