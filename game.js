import * as THREE from "./vendor/three.module.js";
import { FBXLoader } from "./vendor/FBXLoader.js";

const phone = document.getElementById("phone");
const canvas = document.getElementById("view");
const hudScore = document.getElementById("score");
const hudCombo = document.getElementById("combo");
const flashEl = document.getElementById("flash");
const hudSpeed = document.getElementById("speed");
const fareEl = document.getElementById("fare");
const hintEl = document.getElementById("hint");
const toastEl = document.getElementById("toast");
const stickEl = document.getElementById("stick");
const stickFill = document.getElementById("stick-fill");
const stickKnob = document.getElementById("stick-knob");
const menuEl = document.getElementById("menu");
const overEl = document.getElementById("over");
const bestEl = document.getElementById("best");

const LANE = 3.2;
const ROAD_HALF = LANE * 3;
const WALL = 7.55;
const STEP = 2;

const FARES = [
  { name: "Лена", dest: "Клуб", color: 0xff5c8a },
  { name: "Борис", dest: "Вокзал", color: 0xffd15c },
  { name: "Кира", dest: "Отель", color: 0x3ec8ea },
  { name: "Марк", dest: "Бар", color: 0xc6e85a },
  { name: "Нина", dest: "Театр", color: 0xd7a4ff },
  { name: "Глеб", dest: "Рынок", color: 0xff8a3d },
];
const SHOPS = [
  { name: "КИОСК", color: "#c4202a" },
  { name: "ПРОДУКТЫ", color: "#2e7d46" },
  { name: "КОЛБАСЫ", color: "#c45a28" },
  { name: "ГАЗЕТЫ", color: "#1d5c99" },
  { name: "ТРИКОТАЖ", color: "#7a3e86" },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function wrapDist(d, len) {
  d %= len;
  if (d < 0) d += len;
  return d;
}
function wrapSigned(d, len) {
  d = wrapDist(d, len);
  if (d > len * 0.5) d -= len;
  return d;
}
function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let x = 0, z = 0, h = 0, dist = 0;
const roadSamples = [{ x: 0, z: 0, h: 0, dist: 0 }];
function pushSample(nx, nz, nh, d) {
  dist += d;
  x = nx; z = nz; h = nh;
  roadSamples.push({ x, z, h, dist });
}
function layStraight(len) {
  const n = Math.max(1, Math.round(len / STEP));
  const step = len / n;
  for (let i = 1; i <= n; i++) pushSample(x + Math.sin(h) * step, z + Math.cos(h) * step, h, step);
}
function layArc(deg) {
  const rad = deg * Math.PI / 180;
  const radius = 52;
  const steps = Math.max(2, Math.round(Math.abs(rad) * radius / STEP));
  const dh = rad / steps;
  for (let i = 1; i <= steps; i++) {
    const mh = h + dh * 0.5;
    const step = radius * Math.abs(dh);
    pushSample(x + Math.sin(mh) * step, z + Math.cos(mh) * step, h + dh, step);
  }
}
for (let side = 0; side < 6; side++) {
  layStraight(56);
  layArc(30);
  layStraight(30);
  layArc(-30);
  layStraight(48);
  layArc(60);
}
const roadEdge = {
  id: 0, dir: 0, len: roadSamples[roadSamples.length - 1].dist,
  samples: roadSamples, limit: 60, camera: false,
  fromNode: { out: [null, null, null, null] }, toNode: { out: [null, null, null, null] },
};
const edges = [roadEdge];
const route = [roadEdge];
const nodes = [];
function nextOnRoute() { return roadEdge; }
function bendOf() { return 0; }
let playerEdge = roadEdge;
const trackLength = roadEdge.len;

function poseOn(edge, dist) {
  const pts = (edge && edge.samples) || roadSamples;
  const len = pts[pts.length - 1].dist;
  dist = ((dist % len) + len) % len;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].dist <= dist) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const span = b.dist - a.dist || 1;
  const t = clamp((dist - a.dist) / span, 0, 1);
  let dh = b.h - a.h;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  const hh = a.h + dh * t;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    h: hh,
    dist,
    fx: Math.sin(hh),
    fz: Math.cos(hh),
    rx: Math.cos(hh),
    rz: -Math.sin(hh),
    edge: edge || roadEdge,
  };
}
function sample(dist) {
  return poseOn(playerEdge, dist);
}
function exitsOf(edge) {
  const n = edge.toNode;
  return {
    straight: n.out[edge.dir],
    right: n.out[(edge.dir + 1) % 4],
    left: n.out[(edge.dir + 3) % 4],
  };
}
function pickExit(edge, steer) {
  const ex = exitsOf(edge);
  if (steer > 0.55 && ex.right) return ex.right;
  if (steer < -0.55 && ex.left) return ex.left;
  if (ex.straight) return ex.straight;
  return ex.right || ex.left || edge;
}
let corner = null;
function beginCorner(fromEdge, toEdge, R) {
  const a = DIRS[fromEdge.dir];
  const b = DIRS[toEdge.dir];
  const nx = fromEdge.toNode.x;
  const nz = fromEdge.toNode.z;
  const startX = nx - a.fx * R;
  const startZ = nz - a.fz * R;
  const endX = nx + b.fx * R;
  const endZ = nz + b.fz * R;
  const cx = startX + b.fx * R;
  const cz = startZ + b.fz * R;
  const a0 = Math.atan2(startX - cx, startZ - cz);
  const a1 = Math.atan2(endX - cx, endZ - cz);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  if (Math.abs(sweep) < 0.4) return null;
  return { cx, cz, a0, sweep, R, toEdge, travel: 0 };
}
function playerPose() {
  if (!corner) return poseOn(playerEdge, distance);
  const R = corner.R;
  const t = clamp(corner.travel / (Math.abs(corner.sweep) * R), 0, 1);
  const ang = corner.a0 + corner.sweep * t;
  const x = corner.cx + Math.sin(ang) * R;
  const z = corner.cz + Math.cos(ang) * R;
  const s = Math.sign(corner.sweep) || 1;
  const fx = Math.cos(ang) * s;
  const fz = -Math.sin(ang) * s;
  const h = Math.atan2(fx, fz);
  return { x, z, h, fx, fz, rx: Math.cos(h), rz: -Math.sin(h), edge: playerEdge, dist: distance };
}
function routeSteer(fromEdge, toEdge) {
  const seen = new Set();
  const q = [{ edge: fromEdge, choice: null }];
  while (q.length) {
    const cur = q.shift();
    if (cur.edge === toEdge) return cur.choice || 0;
    const ex = exitsOf(cur.edge);
    for (const [name, nxt] of [["straight", ex.straight], ["right", ex.right], ["left", ex.left]]) {
      if (!nxt || seen.has(nxt.id)) continue;
      seen.add(nxt.id);
      const turn = name === "straight" ? 0 : name === "right" ? -1 : 1;
      q.push({ edge: nxt, choice: cur.choice == null ? turn : cur.choice });
    }
  }
  return 0;
}
function routeMeters(fromEdge, fromDist, toEdge, toDist) {
  if (fromEdge === toEdge) {
    let d = toDist - fromDist;
    if (d < 0) d += fromEdge.len;
    return d;
  }
  const seen = new Set([fromEdge.id]);
  const q = [{ edge: fromEdge, m: Math.max(0, fromEdge.len - fromDist) }];
  while (q.length) {
    const cur = q.shift();
    const ex = exitsOf(cur.edge);
    for (const nxt of [ex.straight, ex.right, ex.left]) {
      if (!nxt || seen.has(nxt.id)) continue;
      seen.add(nxt.id);
      if (nxt === toEdge) return cur.m + toDist;
      q.push({ edge: nxt, m: cur.m + nxt.len });
    }
  }
  return roadEdge.len;
}

function canvasTex(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.42 : r;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function makeFacade(base, sign) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(80,50,30,0.05)";
    g.fillRect((i * 47) % 256, (i * 91) % 512, 3, 2);
  }
  g.fillStyle = "#f7f1e6";
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = "#9a3030";
  g.fillRect(0, 496, 256, 16);
  for (let y = 196; y < 470; y += 52) {
    for (let x = 22; x < 240; x += 42) {
      const lit = ((x * 3 + y * 7) % 11) > 3;
      g.fillStyle = lit ? ["#ffe7a3", "#ffd0a0", "#fff8dc", "#d5ecff"][(x + y) % 4] : "#243044";
      g.fillRect(x, y, 24, 32);
      g.strokeStyle = base;
      g.lineWidth = 2;
      g.strokeRect(x, y, 24, 32);
    }
  }
  g.fillStyle = "#c4202a";
  g.fillRect(0, 24, 256, 150);
  g.strokeStyle = "#f0d56a";
  g.lineWidth = 8;
  g.strokeRect(12, 36, 232, 126);
  g.fillStyle = "#f0d56a";
  star(g, 46, 98, 22);
  g.fillStyle = "#ffe56a";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 32;
  g.font = `bold ${size}px Arial`;
  while (g.measureText(sign).width > 170 && size > 14) {
    size -= 1;
    g.font = `bold ${size}px Arial`;
  }
  g.fillText(sign, 150, 100);
  return canvasTex(c);
}

function makeRoadTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 512, 256);
  g.strokeStyle = "#f4f1ea";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(8, 0); g.lineTo(8, 256);
  g.moveTo(504, 0); g.lineTo(504, 256);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(248, 0); g.lineTo(248, 256);
  g.moveTo(264, 0); g.lineTo(264, 256);
  g.stroke();
  g.setLineDash([28, 22]);
  g.beginPath();
  for (const u of [1 / 6, 2 / 6, 4 / 6, 5 / 6]) {
    const x = u * 512;
    g.moveTo(x, 0);
    g.lineTo(x, 256);
  }
  g.stroke();
  const tex = canvasTex(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeSidewalkTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#cabbab";
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = "#b3a394";
  g.lineWidth = 2;
  for (let y = 0; y < 128; y += 32) {
    g.strokeRect(2, y + 2, 60, 28);
  }
  return canvasTex(c);
}

function loadRepeat(url, rx, ry) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 8;
  return tex;
}
const asphaltMap = loadRepeat("./textures/asphalt.jpg", 1, 1);
const plasterMap = loadRepeat("./textures/plaster.jpg", 1, 1);
const brickMap = loadRepeat("./textures/brick.jpg", 1, 1);
const paintMap = loadRepeat("./textures/paint.jpg", 1, 1);
const concreteMap = loadRepeat("./textures/concrete.jpg", 4, 8);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb46830, 70, 190);
scene.background = new THREE.Color(0xb46830);
function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const bands = ["#7ecff5", "#b7e6f6", "#f4ef9a", "#ffe14a", "#ffc233", "#ff9a2c", "#ff6422", "#ef3c1c"];
  const horizon = 128;
  const bandTop = 88;
  g.fillStyle = bands[0];
  g.fillRect(0, 0, 4, bandTop);
  bands.forEach((color, i) => {
    const y0 = Math.floor(bandTop + i * (horizon - bandTop) / bands.length);
    const y1 = Math.floor(bandTop + (i + 1) * (horizon - bandTop) / bands.length);
    g.fillStyle = color;
    g.fillRect(0, y0, 4, Math.max(1, y1 - y0));
  });
  g.fillStyle = bands[bands.length - 1];
  g.fillRect(0, horizon, 4, 256 - horizon);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(380, 32, 24),
  new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
);
sky.renderOrder = -3;
scene.add(sky);

const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 900);

scene.add(new THREE.HemisphereLight(0xb9c6e4, 0x2a241c, 1.15));
const moon = new THREE.DirectionalLight(0xdfe7ff, 1.35);
moon.position.set(-30, 50, 10);
scene.add(moon);
scene.add(new THREE.AmbientLight(0x6c7388, 0.35));

function makeGridTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#070014";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#00c8e0";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  const tex = canvasTex(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  return tex;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.MeshBasicMaterial({ map: makeGridTexture() })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(40, -0.08, 40);
scene.add(ground);
const earth = new THREE.Mesh(
  new THREE.PlaneGeometry(520, 520),
  new THREE.MeshStandardMaterial({ color: 0x3a4a32, roughness: 0.95 })
);
earth.rotation.x = -Math.PI / 2;
{
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of roadSamples) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const span = Math.max(maxX - minX, maxZ - minZ) + 280;
  earth.scale.set(span / 520, span / 520, 1);
  earth.position.set(cx, -0.02, cz);
  ground.position.set(cx, -0.08, cz);
  ground.scale.set(span / 500, span / 500, 1);
}
scene.add(earth);

function edgePoints(edge) {
  return edge.samples;
}

function ribbon(pts, half0, half1, y, material) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < pts.length; i++) {
    const s = pts[i];
    const rx = Math.cos(s.h);
    const rz = -Math.sin(s.h);
    positions.push(s.x - rx * half0, y, s.z - rz * half0);
    positions.push(s.x + rx * half1, y, s.z + rz * half1);
    uvs.push(0, s.dist / 10);
    uvs.push(1, s.dist / 10);
    if (i < pts.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

for (const edge of edges) {
  const pts = edgePoints(edge);
  scene.add(ribbon(pts, ROAD_HALF + 2.5, ROAD_HALF + 2.5, 0.01, new THREE.MeshStandardMaterial({
    map: concreteMap, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
  })));
  scene.add(ribbon(pts, ROAD_HALF, ROAD_HALF, 0.04, new THREE.MeshStandardMaterial({
    map: asphaltMap, color: 0xb9b4ae, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide,
  })));
  scene.add(ribbon(pts, ROAD_HALF, ROAD_HALF, 0.06, new THREE.MeshStandardMaterial({
    map: makeRoadTexture(), transparent: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
  })));
}
for (const n of nodes) {
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2 + 1.2, ROAD_HALF * 2 + 1.2),
    new THREE.MeshStandardMaterial({ map: asphaltMap, roughness: 0.94, side: THREE.DoubleSide })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(n.x, 0.07, n.z);
  scene.add(pad);
}

function hash(a, b) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function makeWindows(seed) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 128, 256);
  for (let y = 18; y < 230; y += 28) {
    for (let x = 10; x < 118; x += 22) {
      const lit = hash(seed, x * 3 + y) > 0.48;
      g.fillStyle = lit ? ["#ffe7a3", "#ffd0a0", "#fff6d2", "#d5ecff"][Math.floor(hash(x, y + seed) * 4)] : "#141820";
      g.fillRect(x, y, 12, 16);
    }
  }
  const tex = canvasTex(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
function makeShopSign(text, color) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = "#f0d56a";
  g.lineWidth = 6;
  g.strokeRect(6, 6, 244, 52);
  g.fillStyle = "#ffe56a";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 28;
  g.font = `bold ${size}px Arial`;
  while (g.measureText(text).width > 220 && size > 14) {
    size -= 1;
    g.font = `bold ${size}px Arial`;
  }
  g.fillText(text, 128, 34);
  return canvasTex(c);
}
function makeLimitSign(limit) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#d12636";
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(64, 64, 48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#111";
  g.font = "bold 52px Courier New";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(limit), 64, 66);
  return canvasTex(c);
}
const buildings = [];
for (const edge of edges) {
  for (let dist = 16; dist < edge.len - 16; dist += 14) {
    if (Math.abs(angDiff(poseOn(edge, dist - 8).h, poseOn(edge, dist + 8).h)) > 0.12) continue;
  for (const side of [-1, 1]) {
    const pose = poseOn(edge, dist);
    const shop = SHOPS[Math.abs(Math.floor(edge.id * 3 + dist + side * 5)) % SHOPS.length];
    const height = 8 + (Math.abs(Math.floor(edge.id + dist * 0.3 + side)) % 5) * 1.8;
    const w = 9.2;
    const d = 8;
    const palette = [0x8a8d94, 0x6f737a, 0x6a5158, 0x7a5c64, 0x5c585e, 0x7d6870, 0x64686e];
    const wallMat = new THREE.MeshBasicMaterial({
      color: palette[Math.abs(Math.floor(edge.id * 3 + dist + side * 5)) % palette.length],
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const group = new THREE.Group();
    const face = side * (ROAD_HALF + 2.4 + d * 0.5);
    group.position.set(pose.x + pose.rx * face, 0, pose.z + pose.rz * face);
    group.rotation.y = pose.h;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(d, height, w - 1.2), wallMat);
    mesh.position.y = height * 0.5;
    group.add(mesh);
    const rows = Math.max(4, Math.round((height - 1.1) / 1.35));
    const winH = (height - 1.15) / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 3; col++) {
        const lit = hash(dist * 3 + row * 9, col * 5 + side * 13) > 0.42;
        const wy = 0.55 + winH * 0.5 + row * winH;
        const pane = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, winH * 0.72, 0.72),
          new THREE.MeshBasicMaterial({ color: lit ? 0xffe3a1 : 0x1a222e })
        );
        pane.position.set(side > 0 ? -d * 0.5 - 0.08 : d * 0.5 + 0.08, wy, (col - 1) * 1.7);
        group.add(pane);
      }
    }
    if (hash(dist + 2, side * 9) > 0.58) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.7, 1.05),
        new THREE.MeshBasicMaterial({ map: makeShopSign(shop.name, shop.color) })
      );
      sign.position.set(side > 0 ? -d * 0.5 - 0.16 : d * 0.5 + 0.16, 1.3, 0);
      sign.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(sign);
    }
    scene.add(group);
    buildings.push({ edge, dist, side, half: w * 0.5, face: side * (ROAD_HALF + 2.15) });
  }
  }
}
const cows = [];
function makeCow() {
  const g = new THREE.Group();
  const hide = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.52, 0.48), hide);
  body.position.y = 0.62;
  const spot = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.5), dark);
  spot.position.set(-0.05, 0.72, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.3), hide);
  head.position.set(0.68, 0.58, 0);
  g.add(body, spot, head);
  for (const x of [-0.38, 0.32]) {
    for (const z of [-0.14, 0.14]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.1), dark);
      leg.position.set(x, 0.19, z);
      g.add(leg);
    }
  }
  return g;
}
const trunkMat = new THREE.MeshBasicMaterial({ color: 0x5a4030 });
const leafMat = new THREE.MeshBasicMaterial({ color: 0x2f6a3a });
const fieldMat = new THREE.MeshBasicMaterial({ color: 0x245c32 });
for (const edge of edges) {
  for (let dist = 8; dist < edge.len - 8; dist += 9) {
    const pose = poseOn(edge, dist);
    const bending = Math.abs(angDiff(poseOn(edge, dist - 8).h, poseOn(edge, dist + 8).h)) > 0.08;
    for (const side of [-1, 1]) {
      if (!bending && hash(dist, side * 3) > 0.82) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.5, 6), trunkMat);
      trunk.position.y = 0.75;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.5, 7), leafMat);
      crown.position.y = 2.35;
      tree.add(trunk, crown);
      const out = ROAD_HALF + (bending ? 4.2 : 11.5) + hash(dist, side) * 3;
      tree.position.set(pose.x + pose.rx * side * out, 0, pose.z + pose.rz * side * out);
      scene.add(tree);
      if (hash(dist + 1, side * 7) > 0.4) {
        const extra = tree.clone();
        const further = out + 4 + hash(dist, side * 11) * 5;
        extra.position.set(pose.x + pose.rx * side * further, 0, pose.z + pose.rz * side * further);
        extra.scale.setScalar(0.75 + hash(dist, side) * 0.5);
        scene.add(extra);
      }
    }
    if (hash(dist, 4) > 0.4) {
      const pose = poseOn(edge, dist);
      const field = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), fieldMat);
      field.rotation.x = -Math.PI / 2;
      field.rotation.y = pose.h;
      const side = hash(dist, 9) > 0.5 ? 1 : -1;
      const out = ROAD_HALF + 18;
      field.position.set(pose.x + pose.rx * side * out, 0.02, pose.z + pose.rz * side * out);
      scene.add(field);
      for (let k = 0; k < 2; k++) {
        const cow = makeCow();
        scene.add(cow);
        cows.push({ mesh: cow, dist, side, out: out + (k === 0 ? -3.2 : 3.4), phase: k + dist * 0.01 });
      }
    }
  }
}

function makePaint(hex) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = hex;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,0.18)";
  g.lineWidth = 3;
  g.strokeRect(6, 6, 116, 116);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
    g.fillRect((i * 19) % 128, (i * 47) % 128, 2, 1);
  }
  return canvasTex(c);
}

function addWheel(group, x, z, front, wheels, fronts) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.34, z);
  const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  geo.rotateZ(Math.PI / 2);
  const wheel = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.85, map: paintMap }));
  pivot.add(wheel);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.26, 8),
    new THREE.MeshStandardMaterial({ color: 0xd5d8de, metalness: 0.8, roughness: 0.25 })
  );
  hub.rotation.z = Math.PI / 2;
  pivot.add(hub);
  group.add(pivot);
  wheels.push(wheel);
  if (front) fronts.push(pivot);
}

function makeCar(color, kind) {
  const group = new THREE.Group();
  const paintHex = "#" + color.toString(16).padStart(6, "0");
  const paint = new THREE.MeshStandardMaterial({ color, map: makePaint(paintHex), roughness: 0.38, metalness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xb7d4e4, roughness: 0.08, metalness: 0.55, emissive: 0x1a3044, emissiveIntensity: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a5058, map: concreteMap, roughness: 0.55, metalness: 0.55 });
  const wheels = [];
  const fronts = [];
  if (kind === "bus") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.7, 7.2), paint);
    body.position.set(0, 1.25, 0);
    group.add(body);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.7, 5.6), glass);
    win.position.set(0, 1.7, 0.2);
    group.add(win);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.2), dark);
    bumper.position.set(0, 0.55, 3.65);
    group.add(bumper);
    addWheel(group, -0.95, 2.3, true, wheels, fronts);
    addWheel(group, 0.95, 2.3, true, wheels, fronts);
    addWheel(group, -0.95, -2.4, false, wheels, fronts);
    addWheel(group, 0.95, -2.4, false, wheels, fronts);
  } else if (kind === "pickup") {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.85, 1.8), paint);
    cab.position.set(0, 0.95, 0.85);
    group.add(cab);
    const glassCab = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 1.2), glass);
    glassCab.position.set(0, 1.45, 0.7);
    group.add(glassCab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 1.9), dark);
    bed.position.set(0, 0.7, -1.15);
    group.add(bed);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 0.9), paint);
    hood.position.set(0, 0.72, 1.85);
    group.add(hood);
    addWheel(group, -0.78, 1.35, true, wheels, fronts);
    addWheel(group, 0.78, 1.35, true, wheels, fronts);
    addWheel(group, -0.78, -1.35, false, wheels, fronts);
    addWheel(group, 0.78, -1.35, false, wheels, fronts);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 3.6), paint);
    body.position.set(0, 0.55, 0);
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.7), glass);
    cabin.position.set(0, 1.05, -0.15);
    group.add(cabin);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.22, 1.15), paint);
    hood.position.set(0, 0.72, 1.15);
    group.add(hood);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.28, 0.7), paint);
    trunk.position.set(0, 0.78, -1.35);
    group.add(trunk);
    addWheel(group, -0.78, 1.15, true, wheels, fronts);
    addWheel(group, 0.78, 1.15, true, wheels, fronts);
    addWheel(group, -0.78, -1.15, false, wheels, fronts);
    addWheel(group, 0.78, -1.15, false, wheels, fronts);
    if (kind === "taxi") {
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.16, 0.28),
        new THREE.MeshStandardMaterial({ color: 0xffe56a, emissive: 0xffcc33, emissiveIntensity: 0.8 })
      );
      sign.position.set(0, 1.42, -0.1);
      group.add(sign);
      const light = new THREE.PointLight(0xfff0cc, 6, 24, 2);
      light.position.set(0, 0.7, 2.2);
      group.add(light);
    }
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffe2a0, emissiveIntensity: 1 });
  const nose = kind === "bus" ? 3.62 : kind === "pickup" ? 2.3 : 1.82;
  for (const lx of [-0.5, 0.5]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.08), lampMat);
    lamp.position.set(lx, kind === "bus" ? 0.7 : 0.58, nose);
    group.add(lamp);
  }
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xd8dbe2, metalness: 0.7, roughness: 0.2 });
  const mirrorY = kind === "bus" ? 1.7 : 1.05;
  const mirrorZ = kind === "bus" ? 2.2 : 0.45;
  for (const mx of [-1, 1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.22), mirrorMat);
    mirror.position.set(mx * (kind === "bus" ? 1.2 : 0.95), mirrorY, mirrorZ);
    group.add(mirror);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(kind === "bus" ? 1.4 : 0.7, 0.28, 0.06), dark);
  grille.position.set(0, kind === "bus" ? 0.85 : 0.55, nose + 0.02);
  group.add(grille);
  group.userData.wheels = wheels;
  group.userData.fronts = fronts;
  return group;
}

const taxi = new THREE.Group();
taxi.userData.wheels = [];
taxi.userData.fronts = [];
scene.add(taxi);
const taxiPaint = new THREE.TextureLoader().load("./models/taxi/paintjob.png");
taxiPaint.colorSpace = THREE.SRGBColorSpace;
const taxiPlate = new THREE.TextureLoader().load("./models/taxi/paintjob_plate.png");
taxiPlate.colorSpace = THREE.SRGBColorSpace;
function seatVehicle(model, length, turnAround) {
  model.rotation.set(0, 0, 0);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const raw = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  raw.getSize(size);
  const long = Math.max(size.x, size.z, 0.001);
  model.scale.setScalar(length / long);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  fitted.getCenter(center);
  model.position.set(-center.x, -fitted.min.y + 0.12, -center.z);
  const yaw = (size.x > size.z ? Math.PI / 2 : 0) + (turnAround ? Math.PI : 0);
  const rig = new THREE.Group();
  const nose = new THREE.Group();
  nose.rotation.y = yaw;
  nose.add(model);
  rig.add(nose);
  return rig;
}
new FBXLoader().load("./models/taxi/taxi.fbx", (model) => {
  model.traverse((child) => {
    if (!child.isMesh) return;
    const name = (child.name || "").toLowerCase();
    const wheel = name.includes("wheel");
    const plate = name.includes("plate");
    child.material = new THREE.MeshStandardMaterial({
      map: wheel ? null : plate ? taxiPlate : taxiPaint,
      color: wheel ? 0x242424 : 0xffffff,
      roughness: wheel ? 0.85 : 0.42,
      metalness: wheel ? 0.15 : 0.02,
    });
  });
  taxi.add(seatVehicle(model, 4.6, false));
});

const traffic = [];
const trafficSources = [
  "./models/cars/Car_V2/fbx/car.fbx",
  "./models/cars/suv.fbx",
  "./models/cars/FBX/car.fbx",
  "./models/cars/pickup_truck.fbx",
];
const trafficTemplates = [];
new FBXLoader().load("./models/cars/FBX/wheel.fbx", (wheelModel) => {
  seatVehicle(wheelModel, 0.7);
  trafficTemplates.wheel = wheelModel;
});
trafficSources.forEach((url, index) => {
  new FBXLoader().load(url, (model) => {
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.roughness = mat.roughness ?? 0.55;
      }
    });
    trafficTemplates[index] = seatVehicle(model, index === 3 ? 5.1 : index === 1 ? 4.8 : 4.4, true);
    if (trafficTemplates.filter(Boolean).length === trafficSources.length) buildTraffic();
  });
});
function spreadAlong(count) {
  const gap = roadEdge.len / count;
  const spots = [];
  for (let i = 0; i < count; i++) spots.push((i + 0.2 + Math.random() * 0.6) * gap);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = spots[i];
    spots[i] = spots[j];
    spots[j] = swap;
  }
  return spots;
}
const carPaints = [0xc23b3b, 0x2f6fad, 0xe6e1d6, 0x3d6b45, 0xc47a32, 0x4a4e57, 0x8a3d62, 0xd6c15a];
function paintClone(source, hex) {
  const mesh = source.clone(true);
  mesh.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const next = mats.map((mat) => {
      const copy = mat.clone();
      if (!copy.map && copy.color) {
        const label = ((child.name || "") + " " + (copy.name || "")).toLowerCase();
        const bright = (copy.color.r + copy.color.g + copy.color.b) / 3;
        const sat = Math.max(copy.color.r, copy.color.g, copy.color.b) - Math.min(copy.color.r, copy.color.g, copy.color.b);
        const wheel = label.includes("wheel") || label.includes("tyre") || label.includes("tire");
        const glass = label.includes("window") || label.includes("glass") || label.includes("mirrow");
        const gray = sat < 0.08 && bright > 0.18 && bright < 0.92;
        const unpainted = bright < 0.16;
        if (!wheel && !glass && (gray || unpainted)) copy.color.setHex(hex);
      }
      return copy;
    });
    child.material = next.length === 1 ? next[0] : next;
  });
  return mesh;
}
let trafficBuilt = false;
function buildTraffic() {
  if (trafficBuilt) return;
  trafficBuilt = true;
  const count = 18;
  const gap = roadEdge.len / count;
  for (let i = 0; i < count; i++) {
    const oncoming = i % 2 === 1;
    const lane = i % 3;
    const lat = (oncoming ? 0.5 + lane : -(0.5 + lane)) * LANE;
    const mesh = paintClone(trafficTemplates[i % trafficTemplates.length], carPaints[i % carPaints.length]);
    scene.add(mesh);
    const pace = oncoming ? 10 : 12;
    traffic.push({
      edge: roadEdge,
      dist: (i + 0.5) * gap,
      lat,
      latTarget: lat,
      home: lat,
      oncoming,
      yaw: 0,
      base: (oncoming ? -1 : 1) * pace,
      speed: (oncoming ? -1 : 1) * pace,
      mesh,
    });
  }
}

const passengers = [];
let fare = null;
const markers = new THREE.Group();
scene.add(markers);

function makePerson(color) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c8a8, roughness: 0.55 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 0.22), new THREE.MeshStandardMaterial({ color: 0x2a3144, roughness: 0.8 }));
  legs.position.y = 0.32;
  g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.26), cloth);
  torso.position.y = 0.85;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
  head.position.y = 1.28;
  g.add(head);
  const arm = new THREE.Group();
  arm.position.set(0.24, 1.05, 0);
  const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.1), cloth);
  armMesh.position.y = -0.18;
  arm.add(armMesh);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), skin);
  hand.position.y = -0.4;
  arm.add(hand);
  g.add(arm);
  g.userData.arm = arm;
  const beacon = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.48, 4),
    new THREE.MeshBasicMaterial({ color: 0xffe14a })
  );
  beacon.position.y = 2.25;
  beacon.rotation.x = Math.PI;
  g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}

const zoneMat = new THREE.MeshStandardMaterial({
  color: 0xf0c14b, emissive: 0xc48a12, emissiveIntensity: 0.55, roughness: 0.45,
});
const zone = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2, 0.08, 12), zoneMat);
zone.visible = false;
scene.add(zone);
const archMat = new THREE.MeshStandardMaterial({ color: 0xc4202a, emissive: 0x6a1018, emissiveIntensity: 0.4, roughness: 0.5 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xf0d56a, emissive: 0xb8860b, emissiveIntensity: 0.5 });
const arch = new THREE.Group();
for (const x of [-ROAD_HALF, ROAD_HALF]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.35), archMat);
  post.position.set(x, 1.6, 0);
  arch.add(post);
}
const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 0.4, 0.4, 0.4), goldMat);
beam.position.y = 3.2;
arch.add(beam);
arch.visible = false;
scene.add(arch);
const dropMark = new THREE.Group();
const dropPole = new THREE.Mesh(
  new THREE.CylinderGeometry(0.12, 0.12, 5.2, 6),
  new THREE.MeshBasicMaterial({ color: 0xff2d95 })
);
dropPole.position.y = 2.6;
dropMark.add(dropPole);
const dropFlag = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.7, 0.08),
  new THREE.MeshBasicMaterial({ color: 0xffe14a })
);
dropFlag.position.set(0.9, 4.8, 0);
dropMark.add(dropFlag);
dropMark.visible = false;
scene.add(dropMark);

edges.forEach((edge) => {
  if (edge.camera) {
    const sp = poseOn(edge, 10);
    const sign = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 20),
      new THREE.MeshStandardMaterial({ map: makeLimitSign(edge.limit), roughness: 0.4 })
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.58, 0.72, 24),
      new THREE.MeshStandardMaterial({ color: 0xd12636, emissive: 0x8a1020, emissiveIntensity: 0.4, side: THREE.DoubleSide })
    );
    sign.position.set(sp.x - sp.rx * (ROAD_HALF + 0.4), 2.3, sp.z - sp.rz * (ROAD_HALF + 0.4));
    ring.position.copy(sign.position);
    sign.lookAt(sp.x, 2.3, sp.z);
    ring.lookAt(sp.x, 2.3, sp.z);
    scene.add(sign);
    scene.add(ring);
    const cam = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.28, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x111418, metalness: 0.4, roughness: 0.35 })
    );
    const cp = poseOn(edge, 18);
    cam.position.set(cp.x - cp.rx * (ROAD_HALF + 0.2), 3.4, cp.z - cp.rz * (ROAD_HALF + 0.2));
    cam.lookAt(cp.x, 1.2, cp.z);
    scene.add(cam);
  }
});

function placeOnRoad(obj, dist, lat, y, edge) {
  const p = poseOn(edge || playerEdge, dist);
  obj.position.set(p.x + p.rx * lat, y || 0, p.z + p.rz * lat);
  obj.rotation.y = p.h;
  return p;
}

let state = "menu";
let gear = "P";
let throttle = 0;
let stickHeld = false;
let steerAxis = 0;
let steerTravel = 0;
let keySteer = 0;
let keyGas = false;
let bodyYaw = 0;
let steerFilt = 0;
let hardFilt = 0;
let cruiseYaw = null;
let laneHold = 0.2;
let driftSlip = 0;
let driftHold = 0;
let driftPts = 0;
let driftBank = 0;
let wrongHold = 0;
let wrongPts = 0;
let wrongBank = 0;
let protocol = 0;
let speedGuilt = 0;
let boarding = null;
let autoGo = 0;
let worldT = 0;
let prevDistance = 18;
const hudProtocol = document.getElementById("protocol");
let distance = 18;
let lateral = -1.5 * LANE;
let speed = 0;
let score = 0;
let combo = 1;
let timeLeft = 70;
let trips = 0;
let hitCd = 0;
let wasInZone = false;
let shake = 0;
let toastLife = 0;
let muted = false;
let best = 0;
try { best = Number(localStorage.getItem("night-cab-best") || 0); } catch (e) { best = 0; }
if (best) bestEl.textContent = "РЕКОРД " + best;

function clearPassengers() {
  for (const p of passengers) markers.remove(p.mesh);
  passengers.length = 0;
}

function spawnPassenger() {
  let edge = route[Math.floor(Math.random() * route.length)];
  let dist = 20 + Math.random() * (roadEdge.len - 40);
  for (let n = 0; n < 12; n++) {
    const crowded = passengers.some((p) => p.edge === edge && Math.abs(p.dist - dist) < 10);
    const blocked = fare && fare.edge === edge && Math.abs(dist - fare.drop) < 16;
    if (!crowded && !blocked) break;
    edge = route[Math.floor(Math.random() * route.length)];
    dist = 20 + Math.random() * (roadEdge.len - 40);
  }
  const type = Math.floor(Math.random() * FARES.length);
  const side = Math.random() > 0.5 ? 1 : -1;
  const mesh = makePerson(FARES[type].color);
  mesh.scale.setScalar(1.65);
  markers.add(mesh);
  passengers.push({ edge, dist, side, type, mesh });
  placeOnRoad(mesh, dist, side * (ROAD_HALF + 1.15), 0, edge);
}

function fillPassengers() {
  let guard = 0;
  while (passengers.length < 5 && guard++ < 10) spawnPassenger();
}

function resetShift() {
  distance = 18;
  lateral = -1.5 * LANE;
  speed = 0;
  score = 0;
  combo = 1;
  timeLeft = 70;
  trips = 0;
  hitCd = 0;
  wasInZone = false;
  fare = null;
  boarding = null;
  protocol = 0;
  speedGuilt = 0;
  autoGo = 0;
  bodyYaw = 0;
  steerFilt = 0;
  hardFilt = 0;
  cruiseYaw = null;
  driftSlip = 0;
  driftHold = 0;
  driftPts = 0;
  driftBank = 0;
  wrongHold = 0;
  wrongPts = 0;
  wrongBank = 0;
  prevDistance = 18;
  zone.visible = false;
  arch.visible = false;
  playerEdge = route[0];
  gear = "D";
  throttle = 0;
  stickHeld = false;
  steerAxis = 0;
  steerTravel = 0;
  document.getElementById("stick-fill").style.height = "0%";
  document.getElementById("stick-knob").style.transform = "translate(0,0)";
  clearPassengers();
  fillPassengers();
  crossers.forEach((w) => scene.remove(w.mesh));
  crossers.length = 0;
  travel = 0;
  nextCross = 120 + Math.random() * 80;
  traffic.forEach((car, i) => {
    const gap = roadEdge.len / Math.max(1, traffic.length);
    car.edge = roadEdge;
    car.dist = (i + 0.5) * gap;
    car.speed = car.base;
    car.wreck = false;
    car.struck = false;
    car.latTarget = car.home;
    car.lat = car.home;
  });
  corner = null;
  setGear("D");
  state = "play";
  document.body.classList.add("playing");
  showSheet(null);
  spawnCrosser("cow");
  spawnCrosser("cow");
  spawnCrosser("cow");
  spawnCrosser("person");
  spawnCrosser("person");
  say("D · ВПЕРЁД");
}

function showSheet(which) {
  menuEl.classList.toggle("hidden", which !== "menu");
  overEl.classList.toggle("hidden", which !== "over");
}

function say(text) {
  toastEl.textContent = text;
  toastLife = 1.5;
}

let driveGear = 0;
let engineCut = 1;
let shiftSurge = 0;
let shiftLock = 0;
const GEAR_KMH = [30, 60, 90, 132];
const TOP_KMH = 132;
const TOP_MS = TOP_KMH / 3.6;
function stepDriveGear() {
  if (gear !== "D") {
    driveGear = 0;
    return;
  }
  const kmh = Math.abs(speed) * 3.6;
  let next = 0;
  if (kmh >= 30) next = 1;
  if (kmh >= 60) next = 2;
  if (kmh >= 90) next = 3;
  if (next !== driveGear) {
    driveGear = next;
    if (engine) engine.rpm = 520;
  }
}
function gearRpm() {
  if (gear !== "D") return 380 + Math.abs(speed) * 18;
  const lo = driveGear === 0 ? 0 : GEAR_KMH[driveGear - 1];
  const hi = GEAR_KMH[driveGear];
  const t = clamp((Math.abs(speed) * 3.6 - lo) / (hi - lo), 0, 1);
  return 520 + t * 2600;
}
function setGear(next) {
  if (next !== gear) clunk();
  gear = next;
  if (next !== "D") driveGear = 0;
}

let audioCtx = null;
let engine = null;
const music = new Audio("./audio/underclocked.mp3");
music.loop = true;
let musicMuted = false;
let musicVolume = 0.1;
let sfxVolume = 0.1;
let sfxGain = null;
music.volume = musicVolume;
const volInput = document.getElementById("vol");
const volRead = document.getElementById("vol-read");

function applyMusic() {
  music.volume = musicMuted ? 0 : musicVolume;
  if (!musicMuted && music.paused) music.play().catch(() => {});
  if (musicMuted) music.pause();
}

const holdInput = document.getElementById("hold");
const holdRead = document.getElementById("hold-read");
holdInput.addEventListener("input", () => {
  laneHold = Number(holdInput.value) / 100;
  holdRead.textContent = holdInput.value + "%";
});
volInput.addEventListener("input", () => {
  musicVolume = Number(volInput.value) / 100;
  volRead.textContent = volInput.value + "%";
  musicMuted = false;
  paintMute();
  ensureAudio();
});
const sfxInput = document.getElementById("sfx");
const sfxRead = document.getElementById("sfx-read");
sfxInput.addEventListener("input", () => {
  sfxVolume = Number(sfxInput.value) / 100;
  sfxRead.textContent = sfxInput.value + "%";
  if (sfxGain) sfxGain.gain.value = muted || state === "menu" ? 0 : sfxVolume;
  muted = false;
  paintMute();
  ensureAudio();
});

function ensureAudio() {
  applyMusic();
  if (muted) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) {
    audioCtx = new AC();
    const master = audioCtx.createGain();
    master.gain.value = 0;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    filter.Q.value = 0.6;
    const osc = audioCtx.createOscillator();
    osc.type = "sawtooth";
    const osc2 = audioCtx.createOscillator();
    osc2.type = "triangle";
    const g1 = audioCtx.createGain();
    const g2 = audioCtx.createGain();
    g1.gain.value = 0.22;
    g2.gain.value = 0.12;
    const len = audioCtx.sampleRate * 2;
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      brown = brown * 0.98 + (Math.random() * 2 - 1) * 0.02;
      data[i] = brown * 4.5;
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 110;
    bp.Q.value = 0.7;
    const ng = audioCtx.createGain();
    ng.gain.value = 0.55;
    osc.connect(g1); g1.connect(filter);
    osc2.connect(g2); g2.connect(filter);
    noise.connect(bp); bp.connect(ng); ng.connect(filter);
    filter.connect(master);
    master.connect(audioCtx.destination);
    osc.start(); osc2.start(); noise.start();
    g1.gain.value = 0;
    g2.gain.value = 0;
    ng.gain.value = 0;
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = sfxVolume;
    const passGain = audioCtx.createGain();
    passGain.gain.value = 0;
    const passFilter = audioCtx.createBiquadFilter();
    passFilter.type = "lowpass";
    passFilter.frequency.value = 280;
    noise.connect(passFilter);
    passFilter.connect(passGain);
    passGain.connect(sfxGain);
    master.disconnect();
    master.connect(sfxGain);
    sfxGain.connect(audioCtx.destination);
    engine = { master, filter, osc, osc2, rpm: 400, passGain, idle: null, run: null };
    Promise.all([
      fetch("./audio/idle.wav").then((r) => r.arrayBuffer()).then((b) => audioCtx.decodeAudioData(b)),
      fetch("./audio/engine.wav").then((r) => r.arrayBuffer()).then((b) => audioCtx.decodeAudioData(b)),
    ]).then(([idleBuf, runBuf]) => {
      const loop = (buffer) => {
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(sfxGain);
        src.start();
        return { src, gain };
      };
      engine.idle = loop(idleBuf);
      engine.run = loop(runBuf);
    }).catch(() => {});
  }
  if (sfxGain) sfxGain.gain.value = muted ? 0 : sfxVolume;
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function blip(freq, dur, type, gain, slide) {
  if (muted || !audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type || "square";
  o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), audioCtx.currentTime + dur);
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(sfxGain || audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + dur);
}

function noiseBurst(dur, gain) {
  if (muted || !audioCtx) return;
  const n = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const g = audioCtx.createGain();
  g.gain.value = gain;
  src.connect(g); g.connect(sfxGain || audioCtx.destination);
  src.start();
}

function clunk() {
  blip(90, 0.07, "square", 0.04, 50);
  noiseBurst(0.05, 0.03);
}

function crashFx() {
  noiseBurst(0.16, 0.1);
  blip(70, 0.18, "sawtooth", 0.05, 40);
  shake = 0.45;
  if (navigator.vibrate) navigator.vibrate(18);
}

function updateEngine(dt, pedal) {
  if (!engine || !audioCtx) return;
  const moving = Math.abs(speed);
  const target = gear === "P" ? 0 : gearRpm();
  engine.rpm += (target - engine.rpm) * (1 - Math.exp(-dt * 9));
  const now = audioCtx.currentTime;
  const rate = clamp(0.72 + (engine.rpm - 460) / 2700 * 0.9, 0.65, 1.7);
  const drive = clamp(moving / 6, 0, 1);
  const wantCut = driveGear === GEAR_KMH.length - 1 ? 0.5 : 1;
  engineCut += (wantCut - engineCut) * (1 - Math.exp(-dt * 1.4));
  const audible = state === "play" ? engineCut : 0;
  if (engine.run) {
    engine.run.src.playbackRate.setTargetAtTime(rate, now, 0.06);
    engine.run.gain.gain.setTargetAtTime(audible * drive * 0.7, now, 0.05);
  }
  if (engine.idle) {
    engine.idle.src.playbackRate.setTargetAtTime(0.85 + pedal * 0.12, now, 0.06);
    engine.idle.gain.gain.setTargetAtTime(audible * (1 - drive) * 0.45, now, 0.05);
  }
  let pass = 0;
  for (const car of traffic) {
    if (car.edge !== playerEdge) continue;
    const dz = Math.abs(car.dist - distance);
    if (dz < 14) pass = Math.max(pass, (1 - dz / 14) * 0.045);
  }
  engine.passGain.gain.setTargetAtTime(muted || state !== "play" ? 0 : pass, now, 0.08);
  if (sfxGain) sfxGain.gain.value = muted || state !== "play" ? 0 : sfxVolume;
}

function silenceGameplay() {
  if (engine) {
    if (engine.run) engine.run.gain.gain.value = 0;
    if (engine.idle) engine.idle.gain.gain.value = 0;
    if (engine.passGain) engine.passGain.gain.value = 0;
  }
  if (sfxGain) sfxGain.gain.value = 0;
}

function upcomingTurn() {
  const ahead = playerEdge.len - distance;
  const nxt = nextOnRoute(playerEdge);
  const bend = nxt ? bendOf(playerEdge, nxt) : 0;
  if (!bend || ahead > 28) return null;
  return { ahead, text: bend < 0 ? "← ПЛАВНЫЙ ПОВОРОТ" : "ПЛАВНЫЙ ПОВОРОТ →" };
}

const skids = [];
let skidHold = 0;
function dropSkids() {
  const pose = playerPose();
  const yaw = pose.h + bodyYaw;
  for (const side of [-0.72, 0.72]) {
    let mark = skids.find((m) => m.userData.life <= 0);
    if (!mark) {
      mark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.9),
        new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.7, depthWrite: false })
      );
      mark.rotation.order = "YXZ";
      mark.userData.life = 0;
      scene.add(mark);
      skids.push(mark);
    }
    mark.visible = true;
    mark.userData.life = 2.4;
    mark.material.opacity = 0.72;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    mark.position.set(
      pose.x + pose.rx * lateral + rx * side - fx * 1.35,
      0.28,
      pose.z + pose.rz * lateral + rz * side - fz * 1.35
    );
    mark.rotation.x = -Math.PI / 2;
    mark.rotation.y = yaw;
  }
}
let squealCd = 0;
function tireSqueal() {
  squealCd -= 1 / 60;
  if (squealCd > 0 || muted || !audioCtx) return;
  squealCd = 0.09;
  const n = Math.floor(audioCtx.sampleRate * 0.1);
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 880;
  filter.Q.value = 4;
  const g = audioCtx.createGain();
  g.gain.value = 0.07;
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
  src.connect(filter); filter.connect(g); g.connect(sfxGain || audioCtx.destination);
  src.start();
}
function update(dt) {
  const info = upcomingTurn();
  const inTurn = false;
  if (state === "menu") {
    distance += 8 * dt;
    if (distance >= playerEdge.len) {
      distance -= playerEdge.len;
      playerEdge = nextOnRoute(playerEdge);
    }
    lateral = -1.5 * LANE;
    placeWorld(dt);
    aimCamera(dt, true);
    silenceGameplay();
    return;
  }
  if (state !== "play") {
    placeWorld(dt);
    aimCamera(dt, false);
    if (state === "paused") silenceGameplay();
    return;
  }

  const stickDown = stickHeld && throttle < -0.12;
  const braking = stickDown && speed > 0.6;
  if (stickHeld && throttle > 0.12 && gear !== "D") setGear("D");
  if (stickDown && !braking && gear !== "R") setGear("R");
  if (braking && gear !== "D") setGear("D");
  const stickPower = stickHeld ? Math.abs(throttle) : 0;
  const pedal = gear === "P" ? 0 : (keyGas ? 1 : stickPower);
  let target = 0;
  stepDriveGear();
  if (braking) target = 0;
  else if (gear === "D") target = pedal * TOP_MS;
  else if (gear === "R") target = -pedal * 24;
  const rate = braking ? 26 + stickPower * 16 : gear === "P" ? 18 : pedal > 0 ? 4.9 : 5;
  speed += clamp(target - speed, -rate * dt, rate * dt);
  if (inTurn && Math.abs(speed) > 18) {
    const capped = 18 * Math.sign(speed);
    speed += (capped - speed) * Math.min(1, dt * 1.4);
  }

  const rawAxis = -clamp(steerAxis + keySteer, -1, 1);
  const stick = Math.abs(rawAxis) < 0.06 ? 0 : rawAxis;
  steerFilt += (stick - steerFilt) * Math.min(1, dt * 16);
  const axis = steerFilt * 0.85;
  const rolling = Math.abs(speed);
  const speedT = clamp(rolling / TOP_MS, 0, 1);
  const authority = 1 - speedT * 0.32;
  const poseNow = playerPose();
  if (cruiseYaw == null) cruiseYaw = poseNow.h;
  const zone = stickHeld ? Math.abs(steerTravel) : Math.abs(keySteer);
  const steerBoost = zone <= 0.75 ? 1.05 : 1.05 * 1.15;
  if (Math.abs(axis) > 0.02 && rolling > 0.2) {
    cruiseYaw += axis * 1.35 * authority * steerBoost * dt;
  }
  if (laneHold > 0) {
    const toRoad = Math.atan2(Math.sin(poseNow.h - cruiseYaw), Math.cos(poseNow.h - cruiseYaw));
    cruiseYaw += toRoad * Math.min(1, dt * 8 * laneHold);
  }
  bodyYaw = Math.atan2(Math.sin(cruiseYaw - poseNow.h), Math.cos(cruiseYaw - poseNow.h));
  const nx = Math.sin(cruiseYaw);
  const nz = Math.cos(cruiseYaw);
  const step = speed * dt;
  const freeAlong = (nx * poseNow.fx + nz * poseNow.fz) * step;
  const freeLat = (nx * poseNow.rx + nz * poseNow.rz) * step;
  let along = freeAlong * (1 - laneHold) + speed * dt * laneHold;
  lateral += freeLat * (1 - laneHold);
  lateral += axis * (1.7 + rolling * 0.12) * authority * steerBoost * dt;
  driftSlip = bodyYaw;
  if (Math.abs(axis) > 0.45 && rolling > 12) {
    skidHold = 0.07;
    tireSqueal();
  }
  const drifting = Math.abs(axis) > 0.28 && rolling > 12 && Math.abs(driftSlip) > 0.1;
  if (drifting) {
    driftHold += dt;
    driftBank += 36 * dt;
    const whole = Math.floor(driftBank);
    if (whole > 0) {
      score += whole;
      driftPts += whole;
      driftBank -= whole;
    }
  } else {
    driftHold = 0;
    driftPts = 0;
    driftBank = 0;
  }
  const oncomingLane = speed > 3 && lateral > 0.8;
  if (oncomingLane) {
    wrongHold += dt;
    wrongBank += 28 * dt;
    const whole = Math.floor(wrongBank);
    if (whole > 0) {
      score += whole;
      wrongPts += whole;
      wrongBank -= whole;
    }
  } else {
    wrongHold = 0;
    wrongPts = 0;
    wrongBank = 0;
  }
  skidHold = Math.max(0, skidHold - dt);
  if (skidHold > 0) dropSkids();
  const edge = Math.abs(axis) > 0.55 ? ROAD_HALF + 4 : ROAD_HALF - 0.4;
  lateral = clamp(lateral, -edge, edge);

  let scraping = false;
  for (const b of buildings) {
    if (b.edge !== playerEdge || Math.abs(distance - b.dist) > b.half + 1.4) continue;
    if (b.side > 0 && lateral > b.face) {
      lateral = b.face;
      scraping = true;
    } else if (b.side < 0 && lateral < b.face && Math.abs(axis) < 0.55) {
      lateral = b.face;
      scraping = true;
    }
  }
  if (scraping) {
    speed *= 1 - Math.min(0.45, dt * 0.55);
    if (Math.random() < dt * 8) noiseBurst(0.03, 0.015);
  }
  if (Math.abs(axis) < 0.45 && Math.abs(lateral) > ROAD_HALF) speed *= 1 - Math.min(0.5, dt * 0.8);

  distance += along;
  distance = ((distance % playerEdge.len) + playerEdge.len) % playerEdge.len;

  for (const car of traffic) {
    if (car.wreck) {
      car.speed += (0 - car.speed) * Math.min(1, dt * 1.1);
      if (Math.abs(car.speed) < 0.25) {
        car.speed = 0;
        car.stopped = (car.stopped || 0) + dt;
        if (car.stopped > 4) {
          car.wreck = false;
          car.struck = false;
          car.stopped = 0;
          car.speed = car.base;
        }
      }
    } else {
      car.stopped = 0;
      car.speed += (car.base - car.speed) * dt * 0.5;
      const floor = Math.abs(car.base) * 0.7;
      if (Math.abs(car.speed) < floor) car.speed = Math.sign(car.base || 1) * floor;
    }
    if (!car.wreck) {
      car.latTarget = car.home;
      for (const w of crossers) {
        if (w.flying) continue;
        let gap = w.dist - car.dist;
        gap = ((gap % roadEdge.len) + roadEdge.len) % roadEdge.len;
        if (gap > roadEdge.len * 0.5) gap -= roadEdge.len;
        const ahead = car.speed >= 0 ? gap : -gap;
        if (ahead > 0.5 && ahead < 16 && Math.abs(w.lat - car.lat) < 2.4) {
          const side = Math.sign(car.lat - w.lat || 1);
          car.latTarget = clamp(car.home + side * LANE, -ROAD_HALF + 1, ROAD_HALF - 1);
          break;
        }
      }
    }
    car.lat += (car.latTarget - car.lat) * Math.min(1, dt * 2.4);
    car.dist += car.speed * dt;
    const roadLen = car.edge.len;
    car.dist = ((car.dist % roadLen) + roadLen) % roadLen;
  }
  for (const car of traffic) {
    if (!car.wreck) car.speed = car.base;
  }

  hitCd = Math.max(0, hitCd - dt);
  hornCd = Math.max(0, hornCd - dt);
  if (hornCd <= 0) {
    for (const car of traffic) {
      if (car.edge !== playerEdge) continue;
      let gap = car.dist - distance;
      gap = ((gap % playerEdge.len) + playerEdge.len) % playerEdge.len;
      if (gap > playerEdge.len * 0.5) gap -= playerEdge.len;
      if (Math.abs(gap) > 4 && Math.abs(gap) < 26 && Math.abs(lateral - car.lat) < 7 && Math.random() < dt * 0.12) {
        horn();
        hornCd = 5 + Math.random() * 7;
        break;
      }
    }
  }
  for (const car of traffic) {
    if (car.edge !== playerEdge) continue;
    let dz = car.dist - distance;
    dz = ((dz % playerEdge.len) + playerEdge.len) % playerEdge.len;
    if (dz > playerEdge.len * 0.5) dz -= playerEdge.len;
    const dx = lateral - car.lat;
    if (Math.abs(dz) < 4.6 && Math.abs(dx) < 1.85) {
      const overlap = 4.6 - Math.abs(dz);
      const len = playerEdge.len;
      if (car.oncoming) {
        distance -= Math.sign(speed || 1) * overlap * 0.5;
        car.dist = (car.dist - Math.sign(car.base || -1) * overlap * 0.5 + len) % len;
        distance = ((distance % len) + len) % len;
        if (!car.struck) {
          car.struck = true;
          car.wreck = true;
          car.stopped = 0;
          car.speed *= 0.15;
          speed *= 0.42;
          hitCd = 0.4;
          crashFx();
        }
      } else if (dz >= 0) {
        distance -= overlap;
        distance = ((distance % len) + len) % len;
        if (speed > Math.max(0, car.speed)) speed = Math.max(0, car.speed) * 0.9;
        car.wreck = true;
        car.stopped = 0;
        if (!car.struck) {
          car.struck = true;
          hitCd = 0.4;
          crashFx();
        }
      } else {
        car.dist = (car.dist - overlap + len) % len;
        car.wreck = true;
        car.stopped = 0;
        car.speed = Math.min(car.speed, Math.max(0, speed) * 0.85);
        if (!car.struck) {
          car.struck = true;
          hitCd = 0.4;
          crashFx();
        }
      }
    } else if (car.struck && Math.abs(dx) > 2.4) {
      car.struck = false;
    }
  }

  for (let i = passengers.length - 1; i >= 0; i--) {
    const p = passengers[i];
    if (boarding && boarding.p === p) continue;
    if (p.edge !== playerEdge) continue;
    let gap = p.dist - distance;
    gap = ((gap % playerEdge.len) + playerEdge.len) % playerEdge.len;
    if (gap > playerEdge.len * 0.5) gap -= playerEdge.len;
    const stand = p.side * (ROAD_HALF + 1.15);
    if (Math.abs(gap) < 2.2 && Math.abs(lateral - stand) < 1.6 && Math.abs(speed) > 7) {
      launchPerson(p);
    }
  }

  if (boarding) {
    boarding.t += dt;
    speed *= 1 - Math.min(0.8, dt * 3);
    if (boarding.t > 0.9) {
      const who = boarding.p;
      boarding = null;
      pickup(who);
      if (gear === "D") autoGo = 1.3;
    }
  } else if (!fare) {
    for (const p of passengers) {
      if (p.edge !== playerEdge) continue;
      const dz = Math.abs(p.dist - distance);
      const stand = p.side * (ROAD_HALF + 1.15);
      let gap = p.dist - distance;
      gap = ((gap % playerEdge.len) + playerEdge.len) % playerEdge.len;
      if (gap > playerEdge.len * 0.5) gap -= playerEdge.len;
      const nearCurb = Math.abs(lateral - stand) < 4.5;
      const fromOpposite = lateral * p.side < 0 && Math.abs(lateral) < ROAD_HALF;
      if (Math.abs(gap) < 9 && (nearCurb || fromOpposite) && Math.abs(speed) < 12) {
        boarding = { p, t: 0 };
        break;
      }
    }
  } else {
    fare.patience -= dt;
    let passed = ((distance - fare.drop) % playerEdge.len + playerEdge.len) % playerEdge.len;
    const inZone = passed < fare.len;
    if (inZone && Math.abs(lateral) < WALL + 0.4) deliver();
    else if (wasInZone && !inZone && speed > 0.4) failFare("ПРОСКОЧИЛ");
    else if (fare && fare.patience <= 0) failFare("УШЁЛ");
    wasInZone = !!(fare && inZone);
  }

  worldT += dt;
  if (autoGo > 0) {
    autoGo -= dt;
    if (gear === "D" && speed < 8) speed += 10 * dt;
  }
  if (playerEdge.camera && !corner && prevDistance < 18 && distance >= 18 && Math.abs(speed) * 3.6 > playerEdge.limit) {
    protocol += 1;
    say("КАМЕРА · ПРОТОКОЛ");
    flashShot();
  }
  prevDistance = distance;
  stepWalkers(dt);

  if (info && info.ahead < 22) {
    hintEl.textContent = info.text;
    hintEl.classList.add("show");
  } else hintEl.classList.remove("show");

  hudScore.textContent = "СЧЁТ " + score;
  const stunt = document.getElementById("stunt");
  const lines = [];
  if (driftHold > 0) lines.push("СКОЛЬЖЕНИЕ  +" + driftPts);
  if (wrongHold > 0) lines.push("ХУЛИГАНСТВО  +" + wrongPts);
  stunt.textContent = lines.join("\n");
  stunt.classList.toggle("show", lines.length > 0);
  hudCombo.textContent = "серия x" + Math.min(combo, 8);
  hudProtocol.textContent = "ПРОТОКОЛ " + protocol;
  hudSpeed.textContent = String(Math.min(TOP_KMH, Math.round(Math.abs(speed) * 3.6))).padStart(3, "0");
  if (fare) {
    const left = Math.max(0, Math.round(routeMeters(playerEdge, distance, fare.edge, fare.drop)));
    fareEl.textContent = "ДО ВЫСАДКИ  " + left + " м";
  } else {
    let next = null;
    let bestD = Infinity;
    for (const p of passengers) {
      const d = routeMeters(playerEdge, distance, p.edge, p.dist);
      if (d < bestD) { bestD = d; next = p; }
    }
    fareEl.textContent = next ? "ПОСАДКА " + (next.side > 0 ? "СЛЕВА" : "СПРАВА") + "  " + Math.round(bestD) + " м" : "";
  }

  updateEngine(dt, pedal);
  placeWorld(dt);
  aimCamera(dt, false);
  if (toastLife > 0) {
    toastLife -= dt;
    toastEl.style.opacity = String(Math.max(0, toastLife));
  }
}

function pickup(p) {
  passengers.splice(passengers.indexOf(p), 1);
  markers.remove(p.mesh);
  const who = FARES[p.type];
  const patience = 140 + Math.random() * 40;
  const drop = (distance + (320 + Math.random() * 260) * 4) % playerEdge.len;
  fare = { type: p.type, edge: playerEdge, drop, len: 18, patience, max: patience };
  wasInZone = false;
  say(who.name + " → " + who.dest);
  doorSound(true);
  placeZone();
  fillPassengers();
}

function placeZone() {
  if (!fare) return;
  placeOnRoad(zone, fare.drop + fare.len * 0.5, 0, 0.08, fare.edge);
  placeOnRoad(arch, fare.drop, 0, 0, fare.edge);
  placeOnRoad(dropMark, fare.drop + fare.len * 0.5, 0, 0, fare.edge);
  zone.visible = true;
  arch.visible = true;
  dropMark.visible = true;
}

function deliver() {
  const ratio = clamp(fare.patience / fare.max, 0, 1);
  const base = 140 + Math.round(routeMeters(playerEdge, distance, fare.edge, fare.drop));
  const tip = Math.round((140 + 80) * ratio * 1.4);
  const multi = Math.min(combo, 8);
  const gained = (base + tip) * multi;
  score += gained;
  trips += 1;
  combo += 1;
  say("+" + gained);
  doorSound(false);
  fare = null;
  wasInZone = false;
  zone.visible = false;
  arch.visible = false;
  dropMark.visible = false;
  fillPassengers();
}

function failFare(reason) {
  combo = 1;
  say(reason);
  blip(160, 0.18, "sawtooth", 0.05, 60);
  fare = null;
  wasInZone = false;
  zone.visible = false;
  arch.visible = false;
  dropMark.visible = false;
  fillPassengers();
}

function doorSound(boardingIn) {
  if (boardingIn) {
    blip(392, 0.07, "square", 0.07, 523);
    setTimeout(() => blip(659, 0.12, "square", 0.06), 90);
    noiseBurst(0.08, 0.04);
  } else {
    blip(784, 0.08, "square", 0.07, 988);
    setTimeout(() => blip(1174, 0.16, "triangle", 0.05), 110);
    noiseBurst(0.06, 0.03);
  }
}
let flashLife = 0;
function flashShot() {
  flashLife = 0.18;
  flashEl.style.opacity = "0.92";
  blip(1800, 0.04, "square", 0.04);
  noiseBurst(0.05, 0.08);
}
const crossers = [];
let travel = 0;
let nextCross = 160 + Math.random() * 120;
function launchPerson(p) {
  const i = passengers.indexOf(p);
  if (i >= 0) passengers.splice(i, 1);
  markers.remove(p.mesh);
  if (p.mesh.userData.beacon) p.mesh.userData.beacon.visible = false;
  scene.add(p.mesh);
  crossers.push({
    mesh: p.mesh,
    dist: p.dist,
    lat: p.side * (ROAD_HALF + 1.15),
    dir: 0,
    y: 0.6,
    flying: true,
    spin: 0.5,
  });
  playHit();
  fillPassengers();
}
function spawnCrosser(kind) {
  const person = kind === "person";
  const mesh = person
    ? makePerson([0xe24b8a, 0x3ec6ff, 0xffe14a, 0xc8f54a][Math.floor(Math.random() * 4)])
    : makeCow();
  if (mesh.userData.beacon) mesh.userData.beacon.visible = false;
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (!person) mesh.scale.setScalar(1.6);
  scene.add(mesh);
  crossers.push({
    mesh,
    cow: !person,
    dist: (distance + 36 + Math.random() * 28) % playerEdge.len,
    lat: (Math.random() * 2 - 1) * (ROAD_HALF - 1.5),
    dir,
    y: 0,
    flying: false,
    spin: 0,
  });
}
function stepWalkers(dt) {
  travel += Math.abs(speed) * dt;
  if (travel >= nextCross) {
    travel = 0;
    nextCross = 140 + Math.random() * 100;
    spawnCrosser("cow");
    spawnCrosser("person");
  }
  for (let i = crossers.length - 1; i >= 0; i--) {
    const w = crossers[i];
    if (w.flying) {
      w.y += 16 * dt;
      w.spin += dt * 9;
    } else {
      w.lat += w.dir * 0.85 * dt;
    }
    placeOnRoad(w.mesh, w.dist, w.lat, w.y, playerEdge);
    if (!w.flying && w.cow && w.dir > 0) w.mesh.rotation.y += Math.PI;
    w.mesh.rotation.z = w.spin;
    if (!w.flying && Math.abs(w.lat) > ROAD_HALF + 2.2) {
      scene.remove(w.mesh);
      crossers.splice(i, 1);
      continue;
    }
    let gap = w.dist - distance;
    gap = ((gap % playerEdge.len) + playerEdge.len) % playerEdge.len;
    if (gap > playerEdge.len * 0.5) gap -= playerEdge.len;
    if (!w.flying && Math.abs(gap) < 2.4 && Math.abs(w.lat - lateral) < 1.35) {
      w.flying = true;
      w.y = 0.4;
      w.spin = (Math.random() < 0.5 ? -1 : 1) * 0.4;
      playHit();
    }
    if (w.y > 24) {
      scene.remove(w.mesh);
      crossers.splice(i, 1);
    }
  }
}
function placeWorld(dt) {
  const spin = speed * dt * 1.6;
  const axis = -clamp(steerAxis + keySteer, -1, 1);
  const moving = Math.abs(speed) > 0.45;
  const wheel = (moving ? axis : 0) * (0.28 + Math.abs(axis) * 0.34);
  (taxi.userData.wheels || []).forEach((w) => { w.rotation.x += spin; });
  taxi.userData.fronts.forEach((pivot) => { pivot.rotation.y = wheel; });
  const pose = playerPose();
  taxi.position.set(pose.x + pose.rx * lateral, 0, pose.z + pose.rz * lateral);
  taxi.rotation.y = pose.h + bodyYaw;
  for (const cow of cows) {
    const wander = Math.sin(worldT * 0.18 + cow.phase) * 3;
    const spot = poseOn(roadEdge, cow.dist + wander);
    cow.mesh.position.set(spot.x + spot.rx * cow.side * cow.out, 0, spot.z + spot.rz * cow.side * cow.out);
    cow.mesh.rotation.y = spot.h + cow.side * Math.PI * 0.5 + Math.sin(worldT * 0.18 + cow.phase) * 0.4;
    cow.mesh.rotation.z = Math.sin(worldT * 1.4 + cow.phase) * 0.05;
  }
  for (const mark of skids) {
    if (mark.userData.life <= 0) continue;
    mark.userData.life -= dt;
    mark.material.opacity = Math.max(0, mark.userData.life / 2.4) * 0.72;
    if (mark.userData.life <= 0) mark.visible = false;
  }
  for (const car of traffic) {
    const placed = placeOnRoad(car.mesh, car.dist, car.lat, 0, car.edge);
    car.mesh.rotation.y = placed.h + (car.oncoming ? Math.PI : 0);
    (car.mesh.userData.wheels || []).forEach((w) => { w.rotation.x += car.speed * dt * 1.4; });
    const sway = clamp((car.latTarget - car.lat) * 0.35, -0.4, 0.4);
    (car.mesh.userData.fronts || []).forEach((pivot) => { pivot.rotation.y = sway; });
  }
  for (const p of passengers) {
    const close = p.edge === playerEdge && Math.abs(p.dist - distance) < 20;
    const wave = close ? Math.PI + Math.sin(worldT * 9) * 0.4 : 0;
    if (p.mesh.userData.beacon) p.mesh.userData.beacon.position.y = 2.15 + Math.sin(worldT * 4 + p.dist) * 0.18;
    if (boarding && boarding.p === p) {
      const t = Math.min(1, boarding.t / 0.9);
      placeOnRoad(p.mesh, lerp(p.dist, distance, t), lerp(p.side * (ROAD_HALF + 1.05), lateral + p.side * 0.85, t), 0, playerEdge);
      p.mesh.userData.arm.rotation.z = (1 - t) * wave;
    } else {
      p.mesh.userData.arm.rotation.z = wave;
    }
  }
}

const sunGroup = new THREE.Mesh(
  new THREE.CircleGeometry(22, 48),
  new THREE.MeshBasicMaterial({ color: 0xff8c1a, side: THREE.DoubleSide, fog: false, depthWrite: false })
);
sunGroup.renderOrder = -1;
sunGroup.frustumCulled = false;
{
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of roadSamples) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const ahead = poseOn(roadEdge, 90);
  sunGroup.position.set(ahead.x - ahead.rx * 70, 32, ahead.z - ahead.rz * 70);
  sunGroup.lookAt(ahead.x, 4, ahead.z);
}
scene.add(sunGroup);
let landX = 0, landZ = 0;
for (const s of roadSamples) { landX += s.x; landZ += s.z; }
landX /= roadSamples.length;
landZ /= roadSamples.length;
function rockyRidge(width, height, seed) {
  const steps = 9;
  const positions = [];
  const heights = [];
  for (let i = 0; i < steps; i++) {
    const edge = i === 0 || i === steps - 1;
    heights.push(edge ? 0.15 : 0.35 + hash(seed, i) * 0.65);
  }
  const depth = 28;
  for (let i = 0; i < steps - 1; i++) {
    const x0 = (i / (steps - 1) - 0.5) * width;
    const x1 = ((i + 1) / (steps - 1) - 0.5) * width;
    const y0 = heights[i] * height;
    const y1 = heights[i + 1] * height;
    positions.push(x0, 0, depth, x1, 0, depth, x0, y0, 0);
    positions.push(x1, 0, depth, x1, y1, 0, x0, y0, 0);
    positions.push(x0, 0, -depth, x0, y0, 0, x1, 0, -depth);
    positions.push(x1, 0, -depth, x0, y0, 0, x1, y1, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}
const ridgeMat = new THREE.MeshBasicMaterial({ color: 0x6e463c, fog: false, side: THREE.DoubleSide });
const mountains = new THREE.Group();
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  const h = 34 + (i % 3) * 12;
  const ridge = new THREE.Mesh(rockyRidge(90 + (i % 4) * 18, h, i * 5), ridgeMat);
  ridge.position.set(landX + Math.cos(a) * 380, 0, landZ + Math.sin(a) * 380);
  ridge.lookAt(landX, h * 0.3, landZ);
  mountains.add(ridge);
}
scene.add(mountains);
const cloudMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false, fog: false,
});
const clouds = new THREE.Group();
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + 0.4;
  const cluster = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(11, 8, 6), cloudMat);
    puff.scale.set(1.6, 0.42, 1);
    puff.position.set((k - 1) * 12, k === 1 ? 3 : 0, (k % 2) * 4);
    cluster.add(puff);
  }
  cluster.position.set(landX + Math.cos(a) * 220, 46 + (i % 3) * 8, landZ + Math.sin(a) * 220);
  clouds.add(cluster);
}
scene.add(clouds);
const camPos = new THREE.Vector3(0, 6, -10);
function aimCamera(dt, attract) {
  const p = playerPose();
  const back = 9.4;
  const camLat = clamp(lateral, -ROAD_HALF + 0.6, ROAD_HALF - 0.6);
  const desired = new THREE.Vector3(
    p.x + p.rx * camLat - p.fx * back,
    5.5,
    p.z + p.rz * camLat - p.fz * back
  );
  if (shake > 0) {
    desired.x += (Math.random() - 0.5) * shake;
    desired.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.4);
  }
  const k = attract ? 1 : 1 - Math.exp((corner ? -14 : -4.5) * dt);
  camPos.lerp(desired, k);
  camera.position.copy(camPos);
  if (!attract && state === "play") {
    const kmh = Math.abs(speed) * 3.6;
    const buzz = clamp((kmh - (TOP_KMH - 10)) / 10, 0, 1);
    if (buzz > 0) {
      const t = performance.now() * 0.03;
      camera.position.x += Math.sin(t * 1.7) * 0.036 * buzz;
      camera.position.y += Math.sin(t * 2.5) * 0.022 * buzz;
      camera.position.z += Math.cos(t * 2.1) * 0.03 * buzz;
    }
    const blurT = clamp((kmh - 115) / 8, 0, 1);
    canvas.style.filter = blurT > 0.02 ? "blur(" + (blurT * 0.9).toFixed(2) + "px)" : "none";
  } else {
    canvas.style.filter = "none";
  }
  camera.lookAt(p.x + p.rx * lateral + p.fx * 14, 0.8, p.z + p.rz * lateral + p.fz * 14);
  sky.position.copy(camera.position);
  if (flashLife > 0) {
    flashLife -= dt;
    flashEl.style.opacity = String(Math.max(0, flashLife / 0.18));
  }
}

function resize() {
  const w = phone.clientWidth || 390;
  const h = phone.clientHeight || 780;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
resize();
window.addEventListener("resize", resize);

function paintMute() {
  const any = !muted || !musicMuted;
  document.getElementById("sound-btn").textContent = any ? "ЗВУК ВКЛ" : "ЗВУК ВЫКЛ";
  document.getElementById("sfx-btn").classList.toggle("off", muted);
  document.getElementById("music-btn").classList.toggle("off", musicMuted);
}
function toggleSfx() {
  muted = !muted;
  paintMute();
  if (sfxGain) sfxGain.gain.value = muted ? 0 : sfxVolume;
  ensureAudio();
}
function toggleMusic() {
  musicMuted = !musicMuted;
  paintMute();
  ensureAudio();
}
function openPause() {
  state = "paused";
  document.getElementById("start-btn").textContent = "ПРОДОЛЖИТЬ";
  showSheet("menu");
  silenceGameplay();
}
const hitSound = new Audio("./audio/hit.mp3");
const slapSound = new Audio("./audio/slap.mp3");
let hitCount = 0;
function playHit() {
  hitCount += 1;
  if (hitCount % 2 === 0 || muted || state !== "play") return;
  const clip = ((hitCount + 1) / 2) % 2 === 1 ? hitSound : slapSound;
  clip.volume = Math.min(1, sfxVolume * 4);
  clip.currentTime = 0;
  clip.play().catch(() => {});
}
let hornCd = 2;
function horn() {
  if (muted || state !== "play") return;
  blip(440, 0.16, "square", 0.09, 390);
  setTimeout(() => { if (!muted && state === "play") blip(370, 0.2, "square", 0.08); }, 170);
}
function closePause() {
  state = "play";
  document.getElementById("start-btn").textContent = "ЗА РУЛЬ";
  showSheet(null);
}
document.getElementById("start-btn").onclick = () => {
  ensureAudio();
  if (state === "paused") closePause();
  else resetShift();
};
document.getElementById("sound-btn").onclick = () => {
  const off = !muted && !musicMuted;
  muted = off;
  musicMuted = off;
  paintMute();
  if (sfxGain) sfxGain.gain.value = muted ? 0 : sfxVolume;
  ensureAudio();
};
document.getElementById("sfx-btn").onclick = () => { ensureAudio(); toggleSfx(); };
document.getElementById("music-btn").onclick = () => { ensureAudio(); toggleMusic(); };
document.getElementById("pause-btn").onclick = () => {
  if (state !== "play") return;
  openPause();
};
document.getElementById("again-btn").onclick = () => resetShift();
document.getElementById("over-menu-btn").onclick = () => {
  state = "menu";
  document.getElementById("start-btn").textContent = "ЗА РУЛЬ";
  document.body.classList.remove("playing");
  showSheet("menu");
  silenceGameplay();
  bestEl.textContent = best ? "РЕКОРД " + best : "";
};

let stickOrigin = null;
function moveStick(e) {
  if (!stickHeld || !stickOrigin) return;
  const dx = e.clientX - stickOrigin.x;
  const dy = stickOrigin.y - e.clientY;
  throttle = clamp(dy / 130, -1, 1);
  const half = Math.max(40, (phone.clientWidth || window.innerWidth) / 2);
  steerTravel = clamp(dx / half, -1, 1);
  steerAxis = clamp(dx / 110, -1, 1);
  stickFill.style.height = (Math.abs(throttle) * 100) + "%";
  stickKnob.style.transform = "translate(" + clamp(dx, -half + 29, half - 29) + "px, " + clamp(-dy, -130, 130) + "px)";
}
stickEl.addEventListener("pointerdown", (e) => {
  stickEl.setPointerCapture(e.pointerId);
  stickHeld = true;
  stickOrigin = { x: e.clientX, y: e.clientY };
  ensureAudio();
  moveStick(e);
});
stickEl.addEventListener("pointermove", moveStick);
function releaseStick() {
  stickHeld = false;
  stickOrigin = null;
  throttle = 0;
  steerAxis = 0;
  steerTravel = 0;
  stickFill.style.height = "0%";
  stickKnob.style.transform = "translate(0,0)";
}
stickEl.addEventListener("pointerup", releaseStick);
stickEl.addEventListener("pointercancel", releaseStick);

window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft") keySteer = -1;
  if (e.code === "ArrowRight") keySteer = 1;
  if (e.code === "ArrowUp") { keyGas = true; ensureAudio(); }
  if (e.code === "Digit1") setGear("D");
  if (e.code === "Digit2") setGear("R");
  if (e.code === "Digit3") setGear("P");
  if (e.code === "Enter" && state === "paused") closePause();
  else if (e.code === "Enter" && state !== "play") { ensureAudio(); resetShift(); }
  if (e.code === "Escape" && state === "play") openPause();
  if (e.code === "Escape" && state === "paused") closePause();
  if (e.code === "KeyM") toggleSfx();
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" && keySteer < 0) keySteer = 0;
  if (e.code === "ArrowRight" && keySteer > 0) keySteer = 0;
  if (e.code === "ArrowUp") keyGas = false;
});

setGear("D");
fillPassengers();
showSheet("menu");

const clock = new THREE.Clock();
function frame() {
  update(Math.min(0.05, clock.getDelta()));
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
