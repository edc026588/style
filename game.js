// Operation Ironveil: a browser first-person shooter built on three.js.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

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
const srand = mulberry32(417);
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
  quality: store.get('quality', IS_TOUCH ? 'low' : 'high'),
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
const HIGH = () => settings.quality === 'high';
// The FOV setting reads as landscape vertical FOV; portrait screens widen it so the view isn't a slit.
function baseFov() {
  const aspect = innerWidth / innerHeight;
  if (aspect >= 1) return settings.fov;
  const h = THREE.MathUtils.degToRad(settings.fov * 0.85);
  return Math.min(105, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect)));
}

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xb3917a);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0082);
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 800);
camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);

// ---------------------------------------------------------------- lighting and sky
const SUN_DIR = new V3(-0.55, 0.33, -0.77).normalize();
const hemi = new THREE.HemisphereLight(0xa8b9d4, 0x6b5343, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc28a, 3.1);
sun.position.copy(SUN_DIR).multiplyScalar(140);
scene.add(sun, sun.target);
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -92, right: 92, top: 92, bottom: -92, near: 20, far: 320 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;

const skyUniforms = {
  uTop: { value: new THREE.Color(0x25385a) },
  uMid: { value: new THREE.Color(0x8e909f) },
  uHorizon: { value: new THREE.Color(0xd49c78) },
  uGround: { value: new THREE.Color(0x5b4739) },
  uSun: { value: new THREE.Color(0xffcf96) },
  uSunDir: { value: SUN_DIR },
};
const SKY_VERT = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
uniform vec3 uTop, uMid, uHorizon, uGround, uSun, uSunDir; varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec3 d = normalize(vDir); float h = d.y; float s = max(dot(d, normalize(uSunDir)), 0.0);
  vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
  sky = mix(sky, uTop, smoothstep(0.2, 0.85, h));
  sky += uSun * pow(s, 5.0) * 0.45 * (1.0 - smoothstep(0.0, 0.55, h));
  vec3 col = h >= 0.0 ? sky : mix(uHorizon, uGround, smoothstep(0.0, 0.1, -h));
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 0.8;
    float c = smoothstep(0.52, 0.86, fbm(uv + vec2(3.1, 7.7))) * smoothstep(0.02, 0.3, h);
    vec3 cc = mix(vec3(0.46, 0.38, 0.4), uSun * 1.15, 0.25 + pow(s, 3.0) * 0.75);
    col = mix(col, cc, c * 0.7);
  }
  col += uSun * (pow(s, 1400.0) * 9.0 + pow(s, 70.0) * 0.45);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function makeSky(radius) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
const skyMesh = makeSky(520);
scene.add(skyMesh);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky(60));
  const env = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = env;
  vmScene.environment = env;
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
TEX.sand = canvasTex(512, (g, s) => {
  g.fillStyle = '#a4865f'; g.fillRect(0, 0, s, s);
  blotches(g, s, 40, ['#8e7150', '#b8996f', '#9c7c57'], 30, 90, 0.35);
  speckle(g, s, 9000, ['#7c6146', '#c4a77f', '#6a543c', '#cdb690'], 3, 0.5);
  for (let i = 0; i < 90; i++) { g.fillStyle = ['#6f6252', '#8c7d68', '#57493b'][i % 3]; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, rand(1.5, 4), 0, 7); g.fill(); }
}, { repeat: 120 });
TEX.road = canvasTex(256, (g, s) => {
  g.fillStyle = '#44403b'; g.fillRect(0, 0, s, s);
  speckle(g, s, 5000, ['#35322e', '#57524b', '#2c2a27'], 2.5, 0.7);
  g.strokeStyle = 'rgba(25,22,20,.6)'; g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) { g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); for (let j = 0; j < 6; j++) { x += rand(-25, 25); y += rand(-25, 25); g.lineTo(x, y); } g.stroke(); }
  g.fillStyle = 'rgba(222,203,150,.78)'; g.fillRect(0, s / 2 - 3, s * 0.5, 6);
  g.fillStyle = 'rgba(222,215,196,.45)'; g.fillRect(0, 10, s, 4); g.fillRect(0, s - 14, s, 4);
  blotches(g, s, 8, ['#8f7858'], 20, 50, 0.18);
});
function plaster(g, s, base) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  blotches(g, s, 26, ['#ffffff', '#b7b0a6', '#d4ccbf'], 20, 70, 0.14);
  speckle(g, s, 4000, ['#7d776f', '#fffaf0', '#a19a90'], 2.5, 0.35);
  for (let i = 0; i < 10; i++) { const x = Math.random() * s; const grd = g.createLinearGradient(0, 0, 0, s * rand(0.3, 0.8)); grd.addColorStop(0, 'rgba(70,60,50,.25)'); grd.addColorStop(1, 'rgba(70,60,50,0)'); g.fillStyle = grd; g.fillRect(x, 0, rand(6, 20), s); }
}
TEX.wall = canvasTex(512, (g, s) => {
  plaster(g, s, '#e2dbd0');
  const x0 = s * 0.3, x1 = s * 0.7, y0 = s * 0.2, y1 = s * 0.62;
  g.fillStyle = '#6d665d'; g.fillRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 26);
  const grd = g.createLinearGradient(0, y0, 0, y1); grd.addColorStop(0, '#263340'); grd.addColorStop(1, '#141a20');
  g.fillStyle = grd; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = 'rgba(160,190,210,.18)'; g.beginPath(); g.moveTo(x0, y1); g.lineTo(x0 + 40, y0); g.lineTo(x0 + 80, y0); g.lineTo(x0 + 40, y1); g.fill();
  g.fillStyle = '#3e3a35'; g.fillRect(s / 2 - 3, y0, 6, y1 - y0); g.fillRect(x0, (y0 + y1) / 2 - 3, x1 - x0, 6);
  g.fillStyle = '#cfc6b8'; g.fillRect(x0 - 16, y1 + 10, x1 - x0 + 32, 12);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, s - 6, s, 6);
}, { repeat: 1 });
TEX.concrete = canvasTex(512, (g, s) => {
  plaster(g, s, '#c7c1b7');
  g.strokeStyle = 'rgba(60,55,50,.45)'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * s / 4, 0); g.lineTo(i * s / 4, s); g.stroke(); }
  g.beginPath(); g.moveTo(0, s * 0.5); g.lineTo(s, s * 0.5); g.stroke();
});
TEX.roof = canvasTex(256, (g, s) => { g.fillStyle = '#8b857c'; g.fillRect(0, 0, s, s); blotches(g, s, 20, ['#6f6a62', '#a39c91'], 10, 40, 0.3); speckle(g, s, 3000, ['#5c5852', '#b2aca2'], 2, 0.5); });
TEX.container = canvasTex(256, (g, s) => {
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 16) { const grd = g.createLinearGradient(x, 0, x + 16, 0); grd.addColorStop(0, '#b0b0b0'); grd.addColorStop(0.5, '#f4f4f4'); grd.addColorStop(1, '#9c9c9c'); g.fillStyle = grd; g.fillRect(x, 0, 16, s); }
  blotches(g, s, 14, ['#6b4a2e', '#8a6040'], 6, 26, 0.35);
  speckle(g, s, 1500, ['#5e3d24', '#3b2a1e'], 3, 0.4);
  g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, s, 8); g.fillRect(0, s - 8, s, 8);
});
TEX.crate = canvasTex(256, (g, s) => {
  g.fillStyle = '#8a6a44'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#7c5e3b' : '#94734b'; g.fillRect(0, i * s / 6, s, s / 6 - 2); g.fillStyle = 'rgba(40,25,10,.5)'; g.fillRect(0, (i + 1) * s / 6 - 2, s, 2); }
  speckle(g, s, 1800, ['#5c4327', '#a88659'], 3, 0.45);
  g.strokeStyle = '#5b4327'; g.lineWidth = 22; g.strokeRect(11, 11, s - 22, s - 22);
  g.beginPath(); g.moveTo(16, 16); g.lineTo(s - 16, s - 16); g.stroke();
  g.fillStyle = 'rgba(20,20,20,.55)'; g.font = 'bold 30px monospace'; g.fillText('7.62', s * 0.56, s * 0.34);
}, { repeat: 1 });
TEX.sandbag = canvasTex(256, (g, s) => {
  g.fillStyle = '#6d6149'; g.fillRect(0, 0, s, s);
  const rows = 4, h = s / rows;
  for (let r = 0; r < rows; r++) for (let c = -1; c < 3; c++) {
    const x = c * s / 2 + (r % 2) * s / 4, y = r * h;
    const grd = g.createLinearGradient(0, y, 0, y + h); grd.addColorStop(0, '#b6a57f'); grd.addColorStop(0.6, '#9a8963'); grd.addColorStop(1, '#6f6247');
    g.fillStyle = grd; g.beginPath(); g.roundRect(x + 3, y + 3, s / 2 - 6, h - 6, 16); g.fill();
  }
  speckle(g, s, 2000, ['#5e533d', '#c6b690'], 2, 0.4);
});
TEX.camo = canvasTex(256, (g, s) => {
  g.fillStyle = '#d6d0c0'; g.fillRect(0, 0, s, s);
  blotches(g, s, 60, ['#a39a82', '#8a826c', '#bdb49b', '#6f6a5a'], 8, 26, 0.9);
}, { repeat: 1 });
TEX.metal = canvasTex(256, (g, s) => { g.fillStyle = '#9ea3a6'; g.fillRect(0, 0, s, s); speckle(g, s, 2500, ['#6c7174', '#c3c7c9', '#7a5a40'], 2, 0.4); blotches(g, s, 10, ['#7a5a40'], 6, 20, 0.25); });
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

// Normal maps derived from each texture's brightness, so recessed windows, corrugation and sandbags catch the light.
function normalMapFrom(tex, strength = 2) {
  const src = tex.image, w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hgt[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), o = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = hgt[y * w + (x - 1 + w) % w], r = hgt[y * w + (x + 1) % w], u = hgt[((y - 1 + h) % h) * w + x], dn = hgt[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * w + x) * 4;
    o[i] = (nx * 0.5 + 0.5) * 255; o[i + 1] = (ny * 0.5 + 0.5) * 255; o[i + 2] = (nz * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.repeat.copy(tex.repeat);
  return t;
}
const NRM = {
  sand: normalMapFrom(TEX.sand, 3), road: normalMapFrom(TEX.road, 4), wall: normalMapFrom(TEX.wall, 5), concrete: normalMapFrom(TEX.concrete, 3),
  roof: normalMapFrom(TEX.roof, 3), container: normalMapFrom(TEX.container, 6), crate: normalMapFrom(TEX.crate, 5), sandbag: normalMapFrom(TEX.sandbag, 7), metal: normalMapFrom(TEX.metal, 2),
};
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
const MAT = {
  sand: std({ map: TEX.sand, normalMap: NRM.sand, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 1 }),
  wallTan: std({ map: TEX.wall, normalMap: NRM.wall, color: 0xc9b08a, roughness: 0.95 }),
  wallOchre: std({ map: TEX.wall, normalMap: NRM.wall, color: 0xd1b37c, roughness: 0.95 }),
  wallGrey: std({ map: TEX.wall, normalMap: NRM.wall, color: 0xa7a098, roughness: 0.95 }),
  roof: std({ map: TEX.roof, normalMap: NRM.roof, roughness: 1 }),
  concrete: std({ map: TEX.concrete, normalMap: NRM.concrete, roughness: 0.95 }),
  perimeter: std({ map: TEX.concrete, normalMap: NRM.concrete, color: 0x9d968b, roughness: 0.95 }),
  barrier: std({ map: TEX.concrete, normalMap: NRM.concrete, color: 0xd6cfc2, roughness: 0.9 }),
  crate: std({ map: TEX.crate, normalMap: NRM.crate, roughness: 0.9 }),
  sandbag: std({ map: TEX.sandbag, normalMap: NRM.sandbag, roughness: 1 }),
  metal: std({ map: TEX.metal, normalMap: NRM.metal, roughness: 0.6, metalness: 0.4 }),
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
const containerMats = [0x8e3b2b, 0x2f5470, 0x42613f, 0xb48a4e, 0x6b6f72].map((c) => std({ map: TEX.container, normalMap: NRM.container, color: c, roughness: 0.7, metalness: 0.3 }));
const barrelMats = [0x7d2f23, 0x2d4e6b, 0x4b5a35].map((c) => std({ color: c, roughness: 0.6, metalness: 0.4, map: TEX.metal }));
const carMats = [0x9b9384, 0x5c6a73, 0x7c3a2e].map((c) => std({ color: c, roughness: 0.5, metalness: 0.5 }));

// ---------------------------------------------------------------- world geometry and colliders
const colliders = [];
function addCollider(x0, y0, z0, x1, y1, z1) { const c = { x0, y0, z0, x1, y1, z1 }; colliders.push(c); return c; }
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
  scene.add(m);
  if (collide) addCollider(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2);
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

function road(cx, cz, len, width, alongX) {
  const tex = TEX.road.clone(), nrm = NRM.road.clone();
  tex.needsUpdate = nrm.needsUpdate = true;
  tex.repeat.set(len / width, 1); nrm.repeat.set(len / width, 1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), std({ map: tex, normalMap: nrm, roughness: 0.92 }));
  m.rotation.set(-Math.PI / 2, 0, alongX ? 0 : Math.PI / 2);
  m.position.set(cx, 0.02, cz);
  m.receiveShadow = true;
  scene.add(m);
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
  tank.position.set(cx - w * 0.25, h + 0.7, cz + d * 0.2); tank.castShadow = true; scene.add(tank);
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
  dish.position.set(cx - w * 0.3, h + 1.1, cz - d * 0.25); dish.rotation.set(-0.9, srange(0, 6), 0); dish.castShadow = true; scene.add(dish);
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
  m.position.set(x, 0.5, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  addCollider(x - 0.34, 0, z - 0.34, x + 0.34, 1.0, z + 0.34);
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
    scene.add(wm);
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
function palm(x, z, h = 7) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, h, 8), MAT.trunk);
  trunk.position.set(x, h / 2, z); trunk.castShadow = true; scene.add(trunk);
  const crown = new THREE.Group(); crown.position.set(x, h, z); scene.add(crown);
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(frondGeo, MAT.leaf);
    f.rotation.order = 'YXZ';
    f.rotation.set(rand(0.9, 1.3), (i / 9) * Math.PI * 2 + rand(-0.2, 0.2), 0);
    f.castShadow = true; crown.add(f);
  }
  addCollider(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25);
  addAO(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0.4);
}
function lamp(x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6.5, 8), MAT.darkMetal);
  pole.position.set(x, 3.25, z); pole.castShadow = true; scene.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), MAT.lamp);
  head.position.set(x + (x > 0 ? -0.4 : 0.4), 6.45, z); scene.add(head);
  addCollider(x - 0.1, 0, z - 0.1, x + 0.1, 6.5, z + 0.1);
}

function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), MAT.sand);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

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
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.3, 5.2, 1.3), MAT.perimeter); post.position.set(x, 2.6, z); post.castShadow = true; scene.add(post);
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

  // Beyond the wall: skyline and mountains
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + srange(-0.05, 0.05), r = srange(78, 130);
    const w = srange(6, 16), h = srange(4, 16), d = srange(6, 14);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.skyline);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); m.rotation.y = srange(0, 3); scene.add(m);
  }
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + srange(-0.08, 0.08), r = srange(210, 300), h = srange(28, 80);
    const m = new THREE.Mesh(new THREE.ConeGeometry(srange(45, 90), h, 6 + Math.floor(srand() * 3)), MAT.mountain);
    m.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r); m.rotation.y = srange(0, 3); scene.add(m);
  }

  buildAOMesh();
  buildCables();
  buildGroundCover();

  // Enemy spawn points around the perimeter
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
buildWorld();

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
  const m = new THREE.Mesh(g, mat); m.renderOrder = 1; scene.add(m);
}
function buildCables() {
  const mat = std({ color: 0x1d1b19, roughness: 0.8 });
  const pairs = [[[-23, 9.7, -21], [-5.6, 6.4, -7]], [[5.6, 6.4, 8], [23, 9.7, 23]], [[17.6, 6.4, -6], [24, 6.8, -23]], [[-17.6, 6.4, 6], [-26, 6.8, 24]], [[-39.6, 6.4, -6], [-39, 9.7, -21]], [[39.6, 6.4, 6], [41, 9.7, 23]]];
  for (const [a, b] of pairs) {
    for (let k = 0; k < 2; k++) {
      const A = new V3(...a).add(new V3(0, k * 0.25, 0)), Bp = new V3(...b).add(new V3(0, k * 0.25, 0));
      const mid = A.clone().lerp(Bp, 0.5); mid.y -= 1.3 + k * 0.2;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, Bp);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.018, 4), mat); m.castShadow = true; scene.add(m);
    }
  }
}
function onRoad(x, z) { return (Math.abs(z) < 5 && Math.abs(x) < 62) || (Math.abs(x) < 5 && z > -47); }
const grassUniforms = { uTime: { value: 0 } };
function buildGroundCover() {
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
  const gm = std({ map: TEX.grass, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: 0xffffff });
  gm.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n  vec4 ip = instanceMatrix[3];\n  float wv = sin(uTime * 1.6 + ip.x * 0.35 + ip.z * 0.27) * 0.6 + sin(uTime * 3.3 + ip.x * 1.3) * 0.25;\n  transformed.x += wv * position.y * 0.22; transformed.z += wv * position.y * 0.12;');
  };
  const N = HIGH() ? 2600 : 1200;
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
  grass.count = n; grass.receiveShadow = true; scene.add(grass);
  // Rocks and rubble
  const rg = new THREE.DodecahedronGeometry(0.2, 0);
  const rocks = new THREE.InstancedMesh(rg, std({ color: 0x8c7a63, roughness: 1, flatShading: true }), 420);
  let r = 0;
  for (let i = 0; i < 1200 && r < 420; i++) {
    const x = srange(-HALF + 1, HALF - 1), z = srange(-HALF + 1, HALF - 1);
    if (!areaFree(x, z, 0.2)) continue;
    const big = srand() < 0.12;
    dummy.position.set(x, 0.02, z); dummy.rotation.set(srange(0, 3), srange(0, 3), srange(0, 3));
    const sc = big ? srange(1.6, 2.6) : srange(0.3, 1.1); dummy.scale.set(sc, sc * srange(0.4, 0.8), sc);
    dummy.updateMatrix(); rocks.setMatrixAt(r++, dummy.matrix);
  }
  rocks.count = r; rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks);
}

// ---------------------------------------------------------------- physics queries
const hitNormal = new V3();
function rayWorld(o, d, maxT) {
  let best = maxT, nx = 0, ny = 0, nz = 0;
  if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; } }
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
    if (tmin > 0 && tmin <= tmax && tmin < best) { best = tmin; nx = ax === 0 ? sg : 0; ny = ax === 1 ? sg : 0; nz = ax === 2 ? sg : 0; }
  }
  hitNormal.set(nx, ny, nz);
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
  },
  setVolume(v) { if (this.master) this.master.gain.value = v; },
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
    this.points.frustumCulled = false;
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
dust.frustumCulled = false;
scene.add(dust);

const tracerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
const tracerMatP = new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const tracerMatE = new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const tracers = [];
for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(tracerGeo, tracerMatP); m.visible = false; scene.add(m); tracers.push({ m, a: new V3(), dir: new V3(), len: 0, t: 0, speed: 0, seg: 0, live: false }); }
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
for (let i = 0; i < 140; i++) { const m = new THREE.Mesh(decalGeo, holeMat); m.visible = false; scene.add(m); decals.push(m); }
function placeDecal(p, n, size, mat) {
  const m = decals[decalIdx]; decalIdx = (decalIdx + 1) % decals.length;
  m.material = mat; m.visible = true;
  m.position.copy(p).addScaledVector(n, 0.012);
  m.lookAt(_tA.copy(m.position).add(n));
  m.rotateZ(Math.random() * 6.28);
  m.scale.set(size, size, 1);
}
function impactFX(p, n, big = false) {
  const c = big ? 14 : 7;
  for (let i = 0; i < c; i++) {
    fxAdd.spawn(p.x, p.y, p.z, n.x * rand(2, 6) + rand(-3, 3), n.y * rand(2, 6) + rand(0, 4), n.z * rand(2, 6) + rand(-3, 3), 1.0, rand(0.6, 0.85), 0.35, rand(0.05, 0.09), rand(0.12, 0.3), { grav: 14, drag: 1 });
  }
  for (let i = 0; i < (big ? 5 : 3); i++) {
    fxSmoke.spawn(p.x, p.y, p.z, n.x * rand(0.5, 1.5) + rand(-0.4, 0.4), n.y * rand(0.5, 1.5) + rand(0.2, 0.8), n.z * rand(0.5, 1.5) + rand(-0.4, 0.4), 0.55, 0.47, 0.38, rand(0.25, 0.45), rand(0.6, 1.1), { drag: 2, grow: 0.8, alpha: 0.55 });
  }
}
function bloodFX(p, d) {
  for (let i = 0; i < 9; i++) fxSmoke.spawn(p.x, p.y, p.z, d.x * rand(1, 3) + rand(-1.2, 1.2), rand(-0.5, 1.8), d.z * rand(1, 3) + rand(-1.2, 1.2), rand(0.35, 0.5), 0.03, 0.03, rand(0.1, 0.22), rand(0.25, 0.5), { grav: 9, drag: 2.2, grow: 0.3, alpha: 0.9 });
}

// Point lights are created once and dimmed when idle so shaders never recompile mid-game.
const muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 2);
scene.add(muzzleLight);
const blastLights = [0, 1].map(() => { const l = new THREE.PointLight(0xff9a40, 0, 45, 2); scene.add(l); return l; });
const fireLights = FIRES.slice(0, 3).map((p) => { const l = new THREE.PointLight(0xff8a30, 30, 18, 2); l.position.copy(p).add(new V3(0, 1, 0)); scene.add(l); return l; });

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
  ring.position.set(p.x, p.y + 0.1, p.z); scene.add(ring); shocks.push({ m: ring, t: 0, r: radius * 1.4 });
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
  metal: std({ color: 0x2a2d30, metalness: 0.75, roughness: 0.36 }),
  poly: std({ color: 0x1c1e20, metalness: 0.1, roughness: 0.7 }),
  fde: std({ color: 0x9a865f, roughness: 0.72 }),
  olive: std({ color: 0x4a5236, roughness: 0.75 }),
  wood: std({ color: 0x6b4428, roughness: 0.55 }),
  glove: std({ color: 0x2a2924, roughness: 0.92 }),
  sleeve: std({ map: TEX.camo, color: 0x8a8766, roughness: 0.95 }),
  brass: std({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  glass: new THREE.MeshBasicMaterial({ color: 0x8fc6d8, transparent: true, opacity: 0.05, depthWrite: false }),
  lens: std({ color: 0x0c1a22, metalness: 0.9, roughness: 0.1 }),
};
const vmTubeMat = vmMat.poly.clone(); vmTubeMat.side = THREE.DoubleSide;
function P(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; }
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
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
  sp.position.set(x, y, z); sp.scale.set(s, s, s); sp.visible = false; parent.add(sp); return sp;
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
vmScene.add(new THREE.HemisphereLight(0xb5c3d8, 0x5a4636, 0.9));
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
const EM = { black: std({ color: 0x181a1b, roughness: 0.6, metalness: 0.4 }), boot: std({ color: 0x2b241d, roughness: 0.9 }), skinMask: std({ color: 0x23231f, roughness: 0.95 }) };
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
  P(gun, long ? EG.longGun : EG.gun, EM.black, 0, 0, long ? -0.15 : 0).castShadow = true;
  if (long) P(gun, EG.scope, EM.black, 0, 0.09, -0.05);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, long ? -0.75 : -0.4); gun.add(muzzle);
  const flash = makeFlash(muzzle, 0, 0, -0.1, type === 'heavy' ? 0.7 : 0.55);
  let glint = null, laser = null;
  if (long) {
    glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.flash, color: 0xcff6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
    glint.scale.set(0.05, 0.05, 1); glint.position.set(0, 0.09, 0.1); glint.visible = false; gun.add(glint);
    const lg = new THREE.BufferGeometry().setFromPoints([new V3(), new V3(0, 0, -1)]);
    laser = new THREE.Line(lg, laserMat); laser.frustumCulled = false; laser.visible = false; scene.add(laser);
  }
  return { root, body, legL, legR, gun, muzzle, flash, glint, laser, helmet, head, parts, mats: [uni, vest] };
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
    if (part === 'head' && cause !== 'frag' && cause !== 'air') {
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
      const noticed = this.alerted || facing > 0.15 || distH < 12 || (G.time - G.lastShotT < 0.6 && distH < 55);
      if (noticed && distH < 110) {
        if (!this.alerted) { this.alerted = true; this.reaction = rand(0.55, 0.95) * T.react; }
        this.lastKnown.copy(Pl.pos);
      }
      if (!this.hadLos && this.alerted) this.reaction = Math.max(this.reaction, rand(0.25, 0.45) * T.react);
    } else if (!this.alerted && G.time - G.lastShotT < 0.3 && distH < 45) {
      this.alerted = true; this.lastKnown.set(Pl.pos.x + rand(-5, 5), 0, Pl.pos.z + rand(-5, 5));
    }
    this.hadLos = this.los;

    let mx = 0, mz = 0, speed = T.speed, fX = 0, fZ = 0;
    if (T.static) {
      if (this.alerted) { fX = dx; fZ = dz; }
      this.updateMarksman(dt, distH);
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
      if (this.huntT <= 0) { this.huntT = rand(3, 6); this.huntTarget.set(Pl.pos.x + rand(-14, 14), 0, Pl.pos.z + rand(-14, 14)); }
      const tx = this.huntTarget.x - this.pos.x, tz = this.huntTarget.z - this.pos.z, d = Math.hypot(tx, tz);
      if (d > 2) { mx = tx / d; mz = tz / d; }
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
    return true;
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
      const n = hitNormal.clone();
      _c.copy(_a).addScaledVector(_b, t);
      if (Math.random() < 0.6) spawnTracer(_a, _c, false);
      if (t < 160) impactFX(_c, n);
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
const touch = { moveX: 0, moveY: 0, fire: false, ads: false, sprint: false };

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
  player.hp = 0; player.alive = false; G.mode = 'dead'; G.deathT = 0; G.timeScale = 0.35;
  canvas.classList.add('dying');
  ws.reloading = false;
  showBanner('Man down', 'You were killed', 'danger', 2.2);
  const best = store.get('best', { score: 0, wave: 0 });
  if (G.score > best.score || G.wavesCleared > best.wave) store.set('best', { score: Math.max(best.score, G.score), wave: Math.max(best.wave, G.wavesCleared) });
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
  const n = hitNormal.clone();
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
    if (tW < W.range) { impactFX(end, n, W.id === 'sr'); placeDecal(end, n, W.id === 'sg' ? 0.09 : 0.13, holeMat); }
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
  glow.scale.set(3, 3, 3); glow.position.set(0, 0, 7); g.add(glow);
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
    if (fireLights[i]) fireLights[i].intensity = 26 + Math.sin(G.time * 17 + i) * 6 + Math.random() * 8;
  });
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

// ---------------------------------------------------------------- flow: menu, play, pause, game over
const screens = { menu: $('menu'), pause: $('pause'), gameover: $('gameover'), settings: $('settings') };
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
}
function startGame() {
  Sfx.init();
  resetRun();
  G.mode = 'play';
  for (const s of Object.values(screens)) s.hidden = true;
  hud.el.hidden = false;
  $('touch').hidden = !IS_TOUCH;
  sizeHudCanvases();
  refreshWeaponHUD(true); updateStreakHUD();
  showBanner('Kessar Compound · 0552', 'Hold the crossroads', '', 2.6);
  after(2.2, () => startWave(1));
  lockPointer();
}
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
  if (G.mode !== 'dead') return;
  $('st-score').textContent = G.score.toLocaleString('en-US');
  $('st-waves').textContent = String(G.wavesCleared);
  $('st-kills').textContent = String(G.kills);
  $('st-hs').textContent = String(G.headshots);
  $('st-acc').textContent = G.shots ? `${Math.round((G.hits / G.shots) * 100)}%` : '—';
  $('st-streak').textContent = String(G.bestStreak);
  const best = store.get('best', { score: 0, wave: 0 });
  $('go-sub').textContent = G.score > 0 && G.score >= best.score ? 'New best score' : `Fell on wave ${Math.max(1, G.wave)}`;
  hud.el.hidden = true; $('touch').hidden = true;
  screens.gameover.hidden = false;
  if (pointerLocked) document.exitPointerLock();
}
function loadBest() {
  const best = store.get('best', { score: 0, wave: 0 });
  $('best-score').textContent = best.score.toLocaleString('en-US');
  $('best-wave').textContent = String(best.wave);
}
loadBest();

$('btn-deploy').addEventListener('click', startGame);
$('btn-retry').addEventListener('click', startGame);
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
  q.addEventListener('change', () => { settings.quality = q.value; store.set('quality', settings.quality); applyQuality(); });
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
  scene: mkRT(renderer.capabilities.isWebGL2 ? 4 : 0, true), half: mkRT(), qA: mkRT(), qB: mkRT(), eA: mkRT(), eB: mkRT(), rays: mkRT(),
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
    tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, tRays: { value: null },
    uTime: { value: 0 }, uDesat: { value: 0 }, uCA: { value: 0.012 }, uGrain: { value: 0.016 }, uRes: { value: new THREE.Vector2(1, 1) }, uBloom: { value: 0.55 },
  }, `uniform sampler2D tScene, tB1, tB2, tRays; uniform float uTime, uDesat, uCA, uGrain, uBloom; uniform vec2 uRes; varying vec2 vUv;
    vec3 ivRrtOdt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 ivAces(vec3 c){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c = I * (c / 0.6); c = ivRrtOdt(c); return clamp(O * c, 0.0, 1.0);
    }
    vec3 ivToSRGB(vec3 c){ return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    void main(){
      vec2 cd = vUv - 0.5; float r2 = dot(cd, cd);
      vec2 off = cd * r2 * uCA;
      vec3 col = vec3(texture2D(tScene, vUv - off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv + off).b);
      vec3 bloom = texture2D(tB1, vUv).rgb * 0.55 + texture2D(tB2, vUv).rgb * 0.9;
      col += bloom * uBloom + texture2D(tRays, vUv).rgb * vec3(1.0, 0.86, 0.66);
      col = ivAces(col);
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
  setSize(w, h) {
    this.scene.setSize(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
    this.half.setSize(hw, hh); this.qA.setSize(qw, qh); this.qB.setSize(qw, qh); this.eA.setSize(ew, eh); this.eB.setSize(ew, eh); this.rays.setSize(qw, qh);
    this.final.uniforms.uRes.value.set(w, h);
  },
};
function runPass(mat, target) { fsMesh.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
const _sunNdc = new V3();
function renderPost(withVM) {
  renderer.setRenderTarget(post.scene); renderer.clear();
  renderer.render(scene, camera);
  if (withVM) { renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
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
  sh.uStrength.value = smoothstep(0.1, 0.75, facing) * 0.8;
  sh.uSun.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5); sh.uAspect.value = W / H;
  sh.tDiffuse.value = post.half.texture;
  runPass(post.shafts, post.rays);
  const f = post.final.uniforms;
  f.tScene.value = post.scene.texture; f.tB1.value = post.qB.texture; f.tB2.value = post.eB.texture; f.tRays.value = post.rays.texture;
  f.uTime.value = performance.now() / 1000;
  f.uDesat.value = G.mode === 'menu' ? 0 : player.alive ? clamp((45 - player.hp) / 45, 0, 1) * 0.55 : 0.75;
  runPass(post.final, null);
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
  fxAdd.mat.uniforms.uBoost.value = hi ? 2.2 : 1;
  $('grain').hidden = hi;
  $('vignette').style.opacity = hi ? '0.4' : '1';
  scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  resize();
}
addEventListener('resize', resize);
applyQuality();

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
  if (G.mode === 'play') updateWaves(dt);
  updateFX(dt, rdt);
  updateViewmodel(dt);
  updateHUD(dt);
  G.nextBoom -= dt;
  if (G.nextBoom <= 0) { G.nextBoom = rand(9, 22); Sfx.distantBoom(); }
  if (G.mode === 'dead' && G.deathT > 1.2) G.timeScale = damp(G.timeScale, 1, 2, rdt);
  input.lookDX = 0; input.lookDY = 0;
}
let last = performance.now(), frameN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min((now - last) / 1000, 0.05);
  last = now; frameN++;
  if (G.mode === 'menu') { menuCamera(rdt); G.time += rdt; updateFX(rdt, rdt); }
  else if (!G.paused) { const dt = rdt * G.timeScale; G.time += dt; update(dt, rdt); }
  skyMesh.position.copy(camera.position);
  grassUniforms.uTime.value = performance.now() / 1000;
  updateShadowFocus();
  const withVM = G.mode !== 'menu' && vm.root.visible;
  if (HIGH()) renderPost(withVM);
  else {
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(scene, camera);
    if (withVM) { renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
    if (frameN % 3 === 0) drawGrain();
  }
}
requestAnimationFrame(frame);

window.__ironveil = { step: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { G.time += dt; update(dt, dt); } }, input, camera, WEAPONS, G, player, enemies, ws, startGame, pause, resume, toMenu, callAirstrike, throwGrenade, switchWeapon, activateUAV, explode };
