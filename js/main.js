/* Пярну — 3D-симуляция города.
 * Геометрия города строится из реальных данных OpenStreetMap (data/parnu.js),
 * поверх неё работает симуляция: солнце, погода, сезоны, машины и жители,
 * которые выбирают цели (бары ночью, пляж летом, школы утром) по расписанию.
 */
(function () {
'use strict';

var D = window.PARNU;
var LAT = D.origin.lat, LON = D.origin.lon;

// ---------------------------------------------------------------- helpers
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) {
  var t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerpColor(out, c1, c2, t) { out.copy(c1).lerp(c2, t); return out; }
function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

function polygonArea(pts) {
  var s = 0;
  for (var i = 0, n = pts.length; i < n; i++) {
    var j = (i + 1) % n;
    s += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(s) / 2;
}
function pointInPoly(x, z, pts) {
  var inside = false;
  for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    var xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------ sun position
// Компактный расчёт положения солнца (по мотивам SunCalc, BSD).
var RAD = Math.PI / 180, DAY_MS = 864e5, J1970 = 2440588, J2000 = 2451545;
var OBL = RAD * 23.4397;
function sunPosition(ms, lat, lng) {
  var lw = RAD * -lng, phi = RAD * lat;
  var d = ms / DAY_MS - 0.5 + J1970 - J2000;
  var M = RAD * (357.5291 + 0.98560028 * d);
  var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  var L = M + C + RAD * 102.9372 + Math.PI;
  var dec = Math.asin(Math.sin(0) * Math.cos(OBL) + Math.cos(0) * Math.sin(OBL) * Math.sin(L));
  var ra = Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
  var H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  return {
    azimuth: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
    altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  };
}

// ------------------------------------------------------------- time state
var sim = {
  ms: Date.now(),       // текущее «время мира», unix-мс
  speed: 1,             // множитель скорости
  weatherMode: 'auto',  // auto | clear | cloudy | rain | snow
  weather: 'clear',
  tempC: 15,
  season: 'summer'
};
window.PARNU_SIM = sim; // доступ из консоли: PARNU_SIM.ms, .speed, .weatherMode
var TZ_FMT_DATE = new Intl.DateTimeFormat('ru-RU',
  { timeZone: 'Europe/Tallinn', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
var TZ_FMT_TIME = new Intl.DateTimeFormat('ru-RU',
  { timeZone: 'Europe/Tallinn', hour: '2-digit', minute: '2-digit' });
var TZ_FMT_PARTS = new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Tallinn', hour: 'numeric', minute: 'numeric', weekday: 'short', month: 'numeric', hour12: false });

function localClock(ms) {
  // час (дробный), день недели (0=вс..6=сб) и месяц по таллинскому времени
  var parts = TZ_FMT_PARTS.formatToParts(ms), o = {};
  for (var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
  var dows = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: (+o.hour % 24) + (+o.minute) / 60,
    dow: dows[o.weekday] !== undefined ? dows[o.weekday] : new Date(ms).getDay(),
    month: +o.month
  };
}
function seasonOf(month) {
  if (month === 12 || month <= 3) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

// ------------------------------------------------------------ scene setup
var canvas = document.getElementById('scene');
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

var scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87b5e0, 1200, 6500);

var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);

var hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3a4a3a, 0.7);
scene.add(hemi);
var sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -700; sun.shadow.camera.right = 700;
sun.shadow.camera.top = 700; sun.shadow.camera.bottom = -700;
sun.shadow.camera.near = 100; sun.shadow.camera.far = 8000;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun);
scene.add(sun.target);
var ambient = new THREE.AmbientLight(0x223355, 0.25);
scene.add(ambient);

window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --------------------------------------------------- geometry construction
// Аккумулятор треугольников: положили точки — получили один merged-меш.
function GeomSink(useColor) {
  this.pos = []; this.norm = [];
  this.col = useColor ? [] : null;
  this.tint = 1;
}
GeomSink.prototype.tri = function (ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz) {
  this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  this.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  if (this.col) {
    var t = this.tint;
    this.col.push(t, t, t, t, t, t, t, t, t);
  }
};
GeomSink.prototype.build = function () {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
  if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
  return g;
};

function addFlatPoly(sink, pts, y) {
  var contour = [];
  for (var i = 0; i < pts.length; i++) contour.push(new THREE.Vector2(pts[i][0], pts[i][1]));
  var tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return; }
  for (var t = 0; t < tris.length; t++) {
    var a = pts[tris[t][0]], b = pts[tris[t][1]], c = pts[tris[t][2]];
    // следим, чтобы треугольник смотрел вверх (иначе шейдер перевернёт нормаль)
    var crossY = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (crossY < 0) { var sw = b; b = c; c = sw; }
    sink.tri(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], 0, 1, 0);
  }
}

function addRibbon(sink, pts, w, y) {
  var hw = w / 2;
  for (var i = 0; i < pts.length - 1; i++) {
    var ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    var dx = bx - ax, dz = bz - az, len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue;
    dx /= len; dz /= len;
    // слегка удлиняем сегмент, чтобы прикрыть стыки на поворотах
    var ex = dx * hw, ez = dz * hw;
    var pax = ax - ex, paz = az - ez, pbx = bx + ex, pbz = bz + ez;
    var nx = -dz * hw, nz = dx * hw;
    sink.tri(pax + nx, y, paz + nz, pbx + nx, y, pbz + nz, pbx - nx, y, pbz - nz, 0, 1, 0);
    sink.tri(pax + nx, y, paz + nz, pbx - nx, y, pbz - nz, pax - nx, y, paz - nz, 0, 1, 0);
  }
}

function addPrism(sink, pts, h, roofSink, pitched) {
  for (var i = 0; i < pts.length; i++) {
    var j = (i + 1) % pts.length;
    var ax = pts[i][0], az = pts[i][1], bx = pts[j][0], bz = pts[j][1];
    var dx = bx - ax, dz = bz - az, len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue;
    var nx = dz / len, nz = -dx / len;
    sink.tri(ax, 0, az, bx, 0, bz, bx, h, bz, nx, 0, nz);
    sink.tri(ax, 0, az, bx, h, bz, ax, h, az, nx, 0, nz);
  }
  if (!pitched) {
    addFlatPoly(roofSink || sink, pts, h);
    return;
  }
  // шатровая крыша: скаты от карниза к коньку-вершине над центроидом
  var cx = 0, cz = 0;
  for (var k = 0; k < pts.length; k++) { cx += pts[k][0]; cz += pts[k][1]; }
  cx /= pts.length; cz /= pts.length;
  var rh = clamp(0.28 * Math.sqrt(polygonArea(pts)), 1.2, 4);
  var apexY = h + rh;
  for (var e = 0; e < pts.length; e++) {
    var f = (e + 1) % pts.length;
    var ax2 = pts[e][0], az2 = pts[e][1], bx2 = pts[f][0], bz2 = pts[f][1];
    // нормаль ската: cross(B-A, apex-A), ориентируем наружу от центроида
    var ux = bx2 - ax2, uz = bz2 - az2;
    var vx = cx - ax2, vy = apexY - h, vz = cz - az2;
    var nx2 = -uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy;
    var mx = (ax2 + bx2) / 2 - cx, mz = (az2 + bz2) / 2 - cz;
    if (nx2 * mx + nz2 * mz < 0) { nx2 = -nx2; ny2 = -ny2; nz2 = -nz2; }
    var nl = Math.sqrt(nx2 * nx2 + ny2 * ny2 + nz2 * nz2) || 1;
    roofSink.tri(ax2, h, az2, bx2, h, bz2, cx, apexY, cz, nx2 / nl, ny2 / nl, nz2 / nl);
  }
}

// материалы, на которые влияют сезоны/погода — храним ссылки
var mats = {};
function flatMat(color) {
  return new THREE.MeshLambertMaterial({ color: color, side: THREE.DoubleSide });
}

var BUILDING_STYLE = {
  house:  0xc9b8a0, apt: 0xb6b0a6, gen: 0xbfb6a8, com: 0xa8b0bc,
  ind:    0x9aa0a8, garage: 0x8f8f8f, church: 0xe8e2d2, hotel: 0xd8cdb4, civic: 0xd0c2a8
};

var nightGlowMats = [];   // материалы, чья прозрачность зависит от темноты
var windowPts, lampPts, starPts;
var treeCrownMat, treeTrunkMat;
var waterMats = [];
var cityGroup = new THREE.Group();
scene.add(cityGroup);

function buildGround() {
  mats.ground = flatMat(0x6f8f5a);
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  ground.receiveShadow = true;
  cityGroup.add(ground);
}

function buildWaterAndLand() {
  var sinks = { water: new GeomSink(), beach: new GeomSink(), park: new GeomSink(),
                forest: new GeomSink(), pitch: new GeomSink(), cemetery: new GeomSink() };
  var yOf = { water: 0.06, beach: 0.045, park: 0.02, forest: 0.03, pitch: 0.05, cemetery: 0.035 };
  for (var i = 0; i < D.land.length; i++) {
    var L = D.land[i];
    if (L.p.length >= 3 && sinks[L.t]) {
      addFlatPoly(sinks[L.t], L.p, yOf[L.t]);
      if (L.t === 'water') cacheWaterPoly(L.p);
    }
  }
  if (D.sea) { addFlatPoly(sinks.water, D.sea, 0.06); cacheWaterPoly(D.sea); }

  mats.water = new THREE.MeshLambertMaterial({ color: 0x4a80ae, side: THREE.DoubleSide });
  mats.beach = flatMat(0xe5d7a8);
  mats.park = flatMat(0x5f9450);
  mats.forest = flatMat(0x40683a);
  mats.pitch = flatMat(0x4e8a4e);
  mats.cemetery = flatMat(0x5a7a52);
  waterMats.push(mats.water);
  for (var k in sinks) {
    if (!sinks[k].pos.length) continue;
    var lm = new THREE.Mesh(sinks[k].build(), mats[k]);
    lm.receiveShadow = true;
    cityGroup.add(lm);
  }
}

function buildRoads() {
  var sinks = { maj: new GeomSink(), res: new GeomSink(), srv: new GeomSink(), ped: new GeomSink() };
  var yOf = { ped: 0.10, srv: 0.12, res: 0.14, maj: 0.16 };
  for (var i = 0; i < D.roads.length; i++) {
    var r = D.roads[i];
    addRibbon(sinks[r.t], r.p, r.w, yOf[r.t]);
  }
  mats.maj = flatMat(0x3d4248);
  mats.res = flatMat(0x4a4f55);
  mats.srv = flatMat(0x55595e);
  mats.ped = flatMat(0x9a948a);
  for (var k in sinks) {
    var rm = new THREE.Mesh(sinks[k].build(), mats[k]);
    rm.receiveShadow = true;
    cityGroup.add(rm);
  }
}

function buildBuildings() {
  var sinks = {}, winPos = [];
  for (var k in BUILDING_STYLE) sinks[k] = new GeomSink(true);
  var roofP = new GeomSink(true), roofF = new GeomSink(true);
  var rng = mulberry32(7);
  for (var i = 0; i < D.buildings.length; i++) {
    var b = D.buildings[i];
    // скатные крыши — у малоэтажных домов с простым контуром
    var pitched = (b.t === 'house' || b.t === 'garage' || b.t === 'civic') &&
                  b.p.length <= 8 && b.h < 12 && polygonArea(b.p) < 700;
    // индивидуальный оттенок здания, чтобы кварталы не были однотонными
    var sink = sinks[b.t] || sinks.gen;
    var roof = pitched ? roofP : roofF;
    sink.tint = 0.8 + rng() * 0.35;
    roof.tint = 0.78 + rng() * 0.4;
    addPrism(sink, b.p, b.h, roof, pitched);
    // точки «окон», светящиеся ночью
    if (b.h >= 4 && rng() < 0.75) {
      var nWin = 1 + Math.floor(b.h / 7);
      for (var w = 0; w < nWin; w++) {
        var e0 = Math.floor(rng() * b.p.length);
        var e1 = (e0 + 1) % b.p.length;
        var t = rng();
        var wx = lerp(b.p[e0][0], b.p[e1][0], t);
        var wz = lerp(b.p[e0][1], b.p[e1][1], t);
        winPos.push(wx, 2 + rng() * Math.max(1, b.h - 3), wz);
      }
    }
  }
  mats.bld = {};
  for (var k2 in sinks) {
    if (!sinks[k2].pos.length) continue;
    var m = new THREE.MeshPhongMaterial({ color: BUILDING_STYLE[k2], side: THREE.DoubleSide,
      shininess: 4, vertexColors: true });
    mats.bld[k2] = m;
    var bm = new THREE.Mesh(sinks[k2].build(), m);
    bm.castShadow = true; bm.receiveShadow = true;
    cityGroup.add(bm);
  }
  mats.roofP = new THREE.MeshPhongMaterial({ color: 0x96503e, side: THREE.DoubleSide,
    shininess: 2, vertexColors: true });
  mats.roofF = new THREE.MeshPhongMaterial({ color: 0x84888e, side: THREE.DoubleSide,
    shininess: 2, vertexColors: true });
  var rpm = new THREE.Mesh(roofP.build(), mats.roofP);
  var rfm = new THREE.Mesh(roofF.build(), mats.roofF);
  rpm.castShadow = rfm.castShadow = rpm.receiveShadow = rfm.receiveShadow = true;
  cityGroup.add(rpm); cityGroup.add(rfm);
  var wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(winPos, 3));
  var wm = new THREE.PointsMaterial({ color: 0xffcf7d, size: 2.4, sizeAttenuation: true,
    transparent: true, opacity: 0, depthWrite: false });
  nightGlowMats.push(wm);
  windowPts = new THREE.Points(wg, wm);
  cityGroup.add(windowPts);
}

function buildTrees() {
  var spots = [];
  var rng = mulberry32(42);
  var budget = 6000;
  for (var i = 0; i < D.land.length && spots.length < budget; i++) {
    var L = D.land[i];
    if (L.t !== 'park' && L.t !== 'forest' && L.t !== 'cemetery') continue;
    var area = polygonArea(L.p);
    var density = L.t === 'forest' ? 380 : 950;
    var n = Math.min(Math.floor(area / density), 400);
    if (!n) continue;
    var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (var p = 0; p < L.p.length; p++) {
      minx = Math.min(minx, L.p[p][0]); maxx = Math.max(maxx, L.p[p][0]);
      minz = Math.min(minz, L.p[p][1]); maxz = Math.max(maxz, L.p[p][1]);
    }
    for (var s = 0, tries = 0; s < n && tries < n * 4; tries++) {
      var x = lerp(minx, maxx, rng()), z = lerp(minz, maxz, rng());
      if (pointInPoly(x, z, L.p)) { spots.push([x, z, 0.7 + rng() * 0.8]); s++; }
    }
  }
  treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4f35 });
  treeCrownMat = new THREE.MeshLambertMaterial({ color: 0x3f7a36 });
  var trunkG = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5);
  var crownG = new THREE.ConeGeometry(2.2, 5.5, 7);
  var trunks = new THREE.InstancedMesh(trunkG, treeTrunkMat, spots.length);
  var crowns = new THREE.InstancedMesh(crownG, treeCrownMat, spots.length);
  var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  for (var t = 0; t < spots.length; t++) {
    var sp = spots[t];
    sc.set(sp[2], sp[2], sp[2]);
    pos.set(sp[0], 1.2 * sp[2], sp[1]);
    m4.compose(pos, q, sc); trunks.setMatrixAt(t, m4);
    pos.set(sp[0], (2.4 + 2.2) * sp[2], sp[1]);
    m4.compose(pos, q, sc); crowns.setMatrixAt(t, m4);
  }
  // у InstancedMesh сфера отсечения не учитывает инстансы — отключаем culling
  trunks.frustumCulled = false; crowns.frustumCulled = false;
  crowns.castShadow = true;
  cityGroup.add(trunks); cityGroup.add(crowns);
}

function buildStreetLamps() {
  var pos = [];
  for (var i = 0; i < D.roads.length; i++) {
    var r = D.roads[i];
    if (r.t !== 'maj' && r.t !== 'res') continue;
    var acc = 0;
    for (var j = 0; j < r.p.length - 1; j++) {
      var ax = r.p[j][0], az = r.p[j][1], bx = r.p[j + 1][0], bz = r.p[j + 1][1];
      var len = Math.sqrt(dist2(ax, az, bx, bz));
      var step = 45;
      while (acc + len >= step) {
        var t = (step - acc) / len;
        pos.push(lerp(ax, bx, t), 6, lerp(az, bz, t));
        acc -= step;
      }
      acc += len;
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  var m = new THREE.PointsMaterial({ color: 0xffb066, size: 5, sizeAttenuation: true,
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  nightGlowMats.push(m);
  lampPts = new THREE.Points(g, m);
  cityGroup.add(lampPts);
}

function buildStars() {
  var pos = [], rng = mulberry32(5);
  for (var i = 0; i < 1200; i++) {
    var az = rng() * Math.PI * 2, el = Math.asin(rng() * 0.95 + 0.05), r = 9000;
    pos.push(r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az));
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  var m = new THREE.PointsMaterial({ color: 0xcdd8ff, size: 7, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false });
  m.size = 1.6;
  nightGlowMats.push(m);
  starPts = new THREE.Points(g, m);
  scene.add(starPts);
}

// ------------------------------------------------------------------ boats
// Реальные гавани Пярну из OSM: Jahtklubi, Talvesadam, Japsi, Vana-Sauga, Vanasadam
var HARBORS = [[-523, -55], [-265, 144], [-589, -364], [-1263, -473], [-221, -174]];
var waterPolys = [];   // полигоны воды с bbox — для посадки лодок
var boatGroup, mooredBoats = [], sailBoats = [];
function cacheWaterPoly(pts) {
  var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (var i = 0; i < pts.length; i++) {
    minx = Math.min(minx, pts[i][0]); maxx = Math.max(maxx, pts[i][0]);
    minz = Math.min(minz, pts[i][1]); maxz = Math.max(maxz, pts[i][1]);
  }
  waterPolys.push({ p: pts, minx: minx, maxx: maxx, minz: minz, maxz: maxz });
}
function findWaterNear(x, z, rmax, rng) {
  for (var t = 0; t < 80; t++) {
    var cx = x + (rng() - 0.5) * 2 * rmax, cz = z + (rng() - 0.5) * 2 * rmax;
    for (var w = 0; w < waterPolys.length; w++) {
      var wp = waterPolys[w];
      if (cx < wp.minx || cx > wp.maxx || cz < wp.minz || cz > wp.maxz) continue;
      if (pointInPoly(cx, cz, wp.p)) return [cx, cz];
    }
  }
  return null;
}
function buildBoats() {
  var hull = new THREE.BoxGeometry(5.5, 1.0, 1.9);
  hull.translate(0, 0.55, 0);
  var cabin = new THREE.BoxGeometry(1.8, 0.7, 1.3);
  cabin.translate(-0.4, 1.35, 0);
  var mast = new THREE.CylinderGeometry(0.06, 0.09, 7, 5);
  mast.translate(0.6, 4.5, 0);
  var boatGeom = mergeGeoms([hull, cabin, mast]);
  // парус — треугольник
  var sailG = new THREE.BufferGeometry();
  sailG.setAttribute('position', new THREE.Float32BufferAttribute(
    [0.5, 2.0, 0, 0.5, 7.6, 0, 3.4, 2.0, 0], 3));
  sailG.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  var yachtGeom = mergeGeoms([hull, cabin, mast, sailG]);

  var rng = mulberry32(777);
  boatGroup = new THREE.Group();
  // пришвартованные лодки у реальных гаваней
  for (var h = 0; h < HARBORS.length; h++) {
    var n = 2 + Math.floor(rng() * 2);
    for (var b = 0; b < n; b++) {
      var pos = findWaterNear(HARBORS[h][0], HARBORS[h][1], 90, rng);
      if (pos) mooredBoats.push({ x: pos[0], z: pos[1], ang: rng() * 6.28, ph: rng() * 6.28 });
    }
  }
  var mooredMesh = new THREE.InstancedMesh(boatGeom,
    new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(mooredBoats.length, 1));
  // ходовые яхты в заливе
  for (var s = 0; s < 3; s++) {
    var anchor = findWaterNear(-1200 + s * 700, 2800, 600, rng);
    if (anchor) sailBoats.push({ ax: anchor[0], az: anchor[1], r: 150 + rng() * 200,
                                 a: rng() * 6.28, w: (0.4 + rng() * 0.5) / 200 });
  }
  var sailMesh = new THREE.InstancedMesh(yachtGeom,
    new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    Math.max(sailBoats.length, 1));
  var hullCol = [0xf0f0f0, 0xdce4ec, 0x3a5a8a, 0x8a3a3a, 0xe8e0d0];
  var i;
  for (i = 0; i < mooredBoats.length; i++) {
    mooredMesh.setColorAt(i, new THREE.Color(hullCol[Math.floor(rng() * hullCol.length)]));
  }
  for (i = 0; i < sailBoats.length; i++) sailMesh.setColorAt(i, new THREE.Color(0xffffff));
  mooredMesh.frustumCulled = sailMesh.frustumCulled = false;
  mooredMesh.castShadow = sailMesh.castShadow = true;
  boatGroup.add(mooredMesh); boatGroup.add(sailMesh);
  boatGroup.userData = { mooredMesh: mooredMesh, sailMesh: sailMesh };
  scene.add(boatGroup);
}
function updateBoats(dt, simDt) {
  if (!boatGroup) return;
  boatGroup.visible = sim.season !== 'winter'; // зимой залив замерзает
  if (!boatGroup.visible) return;
  var t = performance.now() / 1000;
  var md = boatGroup.userData.mooredMesh, sd = boatGroup.userData.sailMesh;
  var i;
  for (i = 0; i < mooredBoats.length; i++) {
    var m = mooredBoats[i];
    dummy.position.set(m.x, 0.1 + Math.sin(t * 0.8 + m.ph) * 0.07, m.z);
    dummy.rotation.set(Math.sin(t * 0.6 + m.ph) * 0.02, m.ang, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    md.setMatrixAt(i, dummy.matrix);
  }
  md.instanceMatrix.needsUpdate = true;
  var moveDt = Math.min(simDt, 0.0333 * 120);
  for (i = 0; i < sailBoats.length; i++) {
    var s = sailBoats[i];
    s.a += s.w * moveDt * 3;
    var x = s.ax + Math.cos(s.a) * s.r, z = s.az + Math.sin(s.a) * s.r;
    dummy.position.set(x, 0.1 + Math.sin(t + i) * 0.1, z);
    dummy.rotation.set(Math.sin(t * 0.7 + i) * 0.04, -(s.a + Math.PI / 2), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    sd.setMatrixAt(i, dummy.matrix);
  }
  sd.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------ birds
var birdMesh, birds = [];
function buildBirds() {
  // силуэт чайки: два крыла-треугольника
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.5, -1.4, 0.4, 0, 0, 0, -0.5,
    0, 0, 0.5, 0, 0, -0.5, 1.4, 0.4, 0
  ], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0
  ], 3));
  birdMesh = new THREE.InstancedMesh(g,
    new THREE.MeshBasicMaterial({ color: 0x4a4f55, side: THREE.DoubleSide }), 26);
  birdMesh.frustumCulled = false;
  scene.add(birdMesh);
  var rng = mulberry32(314);
  for (var i = 0; i < 26; i++) {
    // якоря — над пляжем и заливом
    var anchor = findWaterNear(-900 + rng() * 1800, 2000 + rng() * 1200, 700, rng) ||
                 [-500 + rng() * 1000, 1800 + rng() * 800];
    birds.push({ ax: anchor[0], az: anchor[1], r: 25 + rng() * 110,
                 a: rng() * 6.28, w: (0.6 + rng() * 0.7) / 40 * (rng() < 0.5 ? 1 : -1),
                 h: 22 + rng() * 38, ph: rng() * 6.28 });
  }
}
var birdsVisible = true;
function updateBirds(dt, simDt, dayF) {
  if (!birdMesh) return;
  var show = sim.season !== 'winter' && sim.weather !== 'rain' && sim.weather !== 'snow' &&
             dayF > 0.3;
  birdMesh.visible = show;
  if (!show) return;
  var moveDt = Math.min(simDt, 0.0333 * 120) || dt;
  var t = performance.now() / 1000;
  for (var i = 0; i < birds.length; i++) {
    var b = birds[i];
    b.a += b.w * moveDt * 4;
    dummy.position.set(b.ax + Math.cos(b.a) * b.r,
                       b.h + Math.sin(t * 1.3 + b.ph) * 3,
                       b.az + Math.sin(b.a) * b.r);
    dummy.rotation.set(0, -(b.a + (b.w > 0 ? Math.PI / 2 : -Math.PI / 2)), 0);
    // взмах крыльев — масштаб по вертикали
    var flap = 1 + Math.sin(t * 7 + b.ph) * 0.6;
    dummy.scale.set(1.6, 1.6 * flap, 1.6);
    dummy.updateMatrix();
    birdMesh.setMatrixAt(i, dummy.matrix);
  }
  birdMesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------- sun & moon
var sunSprite, moonSprite;
function discTexture(inner, outer) {
  var cvs = document.createElement('canvas');
  cvs.width = cvs.height = 128;
  var ctx = cvs.getContext('2d');
  var g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cvs);
}
function buildSkyBodies() {
  var sm = new THREE.SpriteMaterial({ map: discTexture('rgba(255,250,230,1)', 'rgba(255,220,120,0)'),
    transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  sunSprite = new THREE.Sprite(sm);
  sunSprite.scale.set(1500, 1500, 1);
  scene.add(sunSprite);
  var mm = new THREE.SpriteMaterial({ map: discTexture('rgba(228,232,240,1)', 'rgba(190,200,220,0)'),
    transparent: true, opacity: 0, depthWrite: false, fog: false });
  moonSprite = new THREE.Sprite(mm);
  moonSprite.scale.set(600, 600, 1);
  scene.add(moonSprite);
}

// --------------------------------------------------------------- weather fx
var clouds = [], cloudOpacityTarget = 0;
function buildClouds() {
  var cvs = document.createElement('canvas');
  cvs.width = cvs.height = 128;
  var ctx = cvs.getContext('2d');
  var grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  var tex = new THREE.CanvasTexture(cvs);
  var rng = mulberry32(11);
  for (var i = 0; i < 42; i++) {
    var m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    var s = new THREE.Sprite(m);
    var sc = 350 + rng() * 600;
    s.scale.set(sc, sc * 0.42, 1);
    s.position.set((rng() - 0.5) * 9000, 380 + rng() * 250, (rng() - 0.5) * 9000);
    s.userData.vx = 3 + rng() * 5;
    clouds.push(s); scene.add(s);
  }
}

var PRECIP_N = 3500, PRECIP_BOX = 700, PRECIP_H = 320;
var precipPts, precipMat, precipVel = [];
function buildPrecip() {
  var pos = [], rng = mulberry32(99);
  for (var i = 0; i < PRECIP_N; i++) {
    pos.push((rng() - 0.5) * PRECIP_BOX, rng() * PRECIP_H, (rng() - 0.5) * PRECIP_BOX);
    precipVel.push(0.6 + rng() * 0.8);
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  precipMat = new THREE.PointsMaterial({ color: 0xb8c8e0, size: 1.6, sizeAttenuation: true,
    transparent: true, opacity: 0, depthWrite: false });
  precipPts = new THREE.Points(g, precipMat);
  scene.add(precipPts);
}

function updatePrecip(dt, camTarget) {
  var kind = sim.weather;
  var active = kind === 'rain' || kind === 'snow';
  precipMat.opacity = lerp(precipMat.opacity, active ? 0.75 : 0, Math.min(1, dt * 2));
  if (precipMat.opacity < 0.02) { precipPts.visible = false; return; }
  precipPts.visible = true;
  precipMat.color.setHex(kind === 'snow' ? 0xffffff : 0x9fb6d8);
  precipMat.size = kind === 'snow' ? 2.2 : 1.5;
  var arr = precipPts.geometry.attributes.position.array;
  var fall = (kind === 'snow' ? 14 : 95) * dt;
  var sway = kind === 'snow' ? Math.sin(performance.now() / 900) * 6 * dt : 0;
  for (var i = 0; i < PRECIP_N; i++) {
    var k = i * 3;
    arr[k + 1] -= fall * precipVel[i];
    arr[k] += sway;
    if (arr[k + 1] < 0) {
      arr[k] = camTarget.x + (Math.random() - 0.5) * PRECIP_BOX;
      arr[k + 1] = PRECIP_H * (0.7 + Math.random() * 0.3);
      arr[k + 2] = camTarget.z + (Math.random() - 0.5) * PRECIP_BOX;
    }
  }
  precipPts.geometry.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------- road graphs
function buildGraph(types) {
  var nodes = [], adj = [], idByKey = {};
  function nodeId(x, z) {
    var key = Math.round(x * 2) + ',' + Math.round(z * 2);
    var id = idByKey[key];
    if (id === undefined) {
      id = nodes.length; idByKey[key] = id;
      nodes.push([x, z]); adj.push([]);
    }
    return id;
  }
  for (var i = 0; i < D.roads.length; i++) {
    var r = D.roads[i];
    if (!types[r.t]) continue;
    var prev = -1;
    for (var j = 0; j < r.p.length; j++) {
      var id = nodeId(r.p[j][0], r.p[j][1]);
      if (prev >= 0 && prev !== id) {
        if (adj[prev].indexOf(id) < 0) adj[prev].push(id);
        if (adj[id].indexOf(prev) < 0) adj[id].push(prev);
      }
      prev = id;
    }
  }
  // пространственная сетка для поиска ближайшего узла
  var grid = {};
  for (var n = 0; n < nodes.length; n++) {
    var gk = Math.floor(nodes[n][0] / 80) + ',' + Math.floor(nodes[n][1] / 80);
    (grid[gk] || (grid[gk] = [])).push(n);
  }
  function nearest(x, z) {
    var gx = Math.floor(x / 80), gz = Math.floor(z / 80);
    var best = -1, bd = Infinity;
    for (var ring = 0; ring < 4 && best < 0; ring++) {
      for (var dx = -ring; dx <= ring; dx++) for (var dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        var cell = grid[(gx + dx) + ',' + (gz + dz)];
        if (!cell) continue;
        for (var c = 0; c < cell.length; c++) {
          var d = dist2(x, z, nodes[cell[c]][0], nodes[cell[c]][1]);
          if (d < bd) { bd = d; best = cell[c]; }
        }
      }
    }
    return best;
  }
  return { nodes: nodes, adj: adj, nearest: nearest };
}
var carGraph, walkGraph;

// ------------------------------------------------------------------- POIs
var pois = [];          // {x,z,t}
var poiByCat = {};
function preparePois() {
  pois = D.pois.slice();
  // виртуальные точки: пляж (полоса у залива) и крупные парки
  var beachAdded = 0;
  for (var i = 0; i < D.land.length; i++) {
    var L = D.land[i];
    var area = polygonArea(L.p);
    if (L.t === 'beach' && area > 3000 && beachAdded < 14) {
      var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
      for (var p = 0; p < L.p.length; p++) {
        minx = Math.min(minx, L.p[p][0]); maxx = Math.max(maxx, L.p[p][0]);
        minz = Math.min(minz, L.p[p][1]); maxz = Math.max(maxz, L.p[p][1]);
      }
      var rng = mulberry32(i);
      // пляж — длинная узкая полоса, попасть в неё из bbox сложно: много попыток
      for (var s = 0, tr = 0; s < 10 && tr < 400; tr++) {
        var x = lerp(minx, maxx, rng()), z = lerp(minz, maxz, rng());
        if (pointInPoly(x, z, L.p)) { pois.push({ x: x, z: z, t: 'beach', n: 'Пляж' }); s++; beachAdded++; }
      }
    } else if (L.t === 'park' && area > 25000) {
      var cx = 0, cz = 0;
      for (var p2 = 0; p2 < L.p.length; p2++) { cx += L.p[p2][0]; cz += L.p[p2][1]; }
      pois.push({ x: cx / L.p.length, z: cz / L.p.length, t: 'park', n: 'Парк' });
    }
  }
  for (var k = 0; k < pois.length; k++) {
    var c = pois[k].t;
    (poiByCat[c] || (poiByCat[c] = [])).push(pois[k]);
  }
}

// Подписи реальных заведений (названия из OSM), видны при приближении камеры.
var poiLabels = [], labelsEnabled = true;
var LABEL_COLORS = { night: '#ff6090', food: '#ffb84d', hotel: '#6db3ff',
                     culture: '#b58cff', shop: '#6fd66f' };
function buildPoiLabels() {
  for (var i = 0; i < pois.length && poiLabels.length < 240; i++) {
    var p = pois[i];
    var col = LABEL_COLORS[p.t];
    if (!col || !p.n || /^[a-z_]+$/.test(p.n)) continue; // пропускаем безымянные
    var name = p.n.length > 26 ? p.n.slice(0, 25) + '…' : p.n;
    var cvs = document.createElement('canvas');
    var ctx = cvs.getContext('2d');
    ctx.font = '600 22px "Segoe UI", Arial, sans-serif';
    var tw = Math.ceil(ctx.measureText(name).width);
    cvs.width = tw + 44; cvs.height = 40;
    ctx.font = '600 22px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(8,14,30,0.78)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, cvs.width, cvs.height, 10);
    else ctx.rect(0, 0, cvs.width, cvs.height);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(20, 20, 7, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#e8f0ff';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 36, 21);
    var tex = new THREE.CanvasTexture(cvs);
    var m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    var s = new THREE.Sprite(m);
    var w = cvs.width / 5.5;
    s.scale.set(w, cvs.height / 5.5, 1);
    s.position.set(p.x, 17, p.z);
    s.renderOrder = 10;
    s.visible = false;
    scene.add(s);
    poiLabels.push(s);
  }
}
var labelAccum = 1;
function updatePoiLabels(dt) {
  labelAccum += dt;
  if (labelAccum < 0.3) return;
  labelAccum = 0;
  var show = labelsEnabled && cam.dist < 1400;
  var r2 = 800 * 800;
  for (var i = 0; i < poiLabels.length; i++) {
    var s = poiLabels[i];
    s.visible = show && dist2(s.position.x, s.position.z, cam.target.x, cam.target.z) < r2;
  }
}

// Ночная неоновая подсветка заведений (там же, где собираются люди)
var GLOW_COLORS = { night: 0xff4f9a, food: 0xffa040, hotel: 0x55a0ff,
                    culture: 0xa070ff, shop: 0x55cc66 };
function buildPoiGlow() {
  var pos = [], col = [], c = new THREE.Color();
  for (var i = 0; i < pois.length; i++) {
    var p = pois[i];
    var hex = GLOW_COLORS[p.t];
    if (!hex) continue;
    c.setHex(hex);
    pos.push(p.x, 4.5, p.z);
    col.push(c.r, c.g, c.b);
    if (p.t === 'night') { // у баров — двойное свечение повыше
      pos.push(p.x, 7.5, p.z);
      col.push(c.r, c.g, c.b);
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  var m = new THREE.PointsMaterial({ vertexColors: true, size: 7, sizeAttenuation: true,
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  nightGlowMats.push(m);
  var pts = new THREE.Points(g, m);
  scene.add(pts);
}

// Веса категорий целей в зависимости от часа/дня недели/сезона/погоды.
function poiWeights(hour, dow, season, weather) {
  var w = { night: 0.1, food: 0.4, shop: 0.2, school: 0.02, culture: 0.15, hotel: 0.25,
            health: 0.1, beach: 0, sport: 0.15, transit: 0.15, park: 0.2 };
  var weekend = (dow === 0 || dow === 6);
  var partyNight = (dow === 5 || dow === 6 || dow === 0); // ночи пт→сб, сб→вс
  var h = hour;

  if (h >= 21 || h < 4) {                       // ночь — бары, пабы, клубы
    w.night = partyNight ? (h >= 22 || h < 3 ? 14 : 7) : 2.2;
    w.food = h < 23 ? 2 : 0.5;
    w.shop = 0.05; w.park = 0.05; w.culture = h < 22 ? 1.2 : 0.2; w.transit = 0.3;
  } else if (h >= 7 && h < 9) {                 // утро
    w.school = weekend ? 0.05 : 8;
    w.transit = 2.5; w.shop = 0.8; w.food = 1.2;
  } else if (h >= 9 && h < 11) {
    w.shop = 2.5; w.food = 1.5; w.school = weekend ? 0.05 : 1; w.health = 0.8;
  } else if (h >= 11 && h < 14) {               // обед
    w.food = 4; w.shop = 2; w.park = 1;
  } else if (h >= 14 && h < 17) {
    w.shop = 2.5; w.park = 1.5; w.sport = 1; w.culture = 0.8;
  } else if (h >= 17 && h < 21) {               // вечер
    w.food = 3.5; w.culture = 1.8; w.sport = 1.3; w.park = 1.5;
    w.night = h >= 19 ? 1.5 : 0.4; w.transit = 1.5; w.shop = 1.2;
  }
  // пляж: тёплый сезон, день, без дождя
  if (season === 'summer' && h >= 9 && h < 20 && weather !== 'rain') {
    w.beach = (weather === 'clear' ? 9 : 4) * (weekend ? 1.5 : 1);
  } else if (season === 'spring' && h >= 11 && h < 18 && weather === 'clear') {
    w.beach = 1.5;
  }
  if (weather === 'rain' || weather === 'snow') { w.park *= 0.15; w.beach = 0; }
  if (season === 'winter') { w.park *= 0.3; }
  return w;
}

function pickPoi(weights, rng) {
  var total = 0, cat;
  for (cat in weights) if (poiByCat[cat]) total += weights[cat];
  var r = rng() * total;
  for (cat in weights) {
    if (!poiByCat[cat]) continue;
    r -= weights[cat];
    if (r <= 0) {
      var list = poiByCat[cat];
      return list[Math.floor(rng() * list.length)];
    }
  }
  return pois[Math.floor(rng() * pois.length)];
}

// Целевые количества агентов
function pedTargetCount(hour, dow, season, weather) {
  var curve = [20, 12, 10, 6, 5, 8, 25, 60, 90, 100, 120, 140, 160, 160, 150, 150, 160, 180, 170, 150, 120, 100, 70, 40];
  var n = curve[Math.floor(hour) % 24];
  var partyNight = (dow === 5 || dow === 6 || dow === 0);
  if (partyNight && (hour >= 22 || hour < 3)) n += 130;       // толпы у баров
  var sf = { summer: 1.35, spring: 0.95, autumn: 0.85, winter: 0.45 }[season];
  n *= sf;
  if (weather === 'rain') n *= 0.45;
  if (weather === 'snow') n *= 0.6;
  if (weather === 'cloudy') n *= 0.85;
  return Math.round(clamp(n, 4, 600));
}
function carTargetCount(hour, dow, season, weather) {
  var curve = [8, 5, 4, 4, 5, 12, 35, 80, 120, 90, 70, 70, 75, 75, 70, 75, 95, 130, 110, 70, 50, 35, 25, 14];
  var n = curve[Math.floor(hour) % 24];
  if (dow === 0 || dow === 6) n = Math.round(n * 0.7 + 8);
  if (weather === 'snow') n *= 0.8;
  return Math.round(clamp(n * (season === 'winter' ? 0.85 : 1), 3, 170));
}

// ----------------------------------------------------------------- agents
var CAR_MAX = 170, PED_MAX = 600;
var cars = [], peds = [];
var carMesh, pedMesh, headPts, tailPts;
var dummy = new THREE.Object3D();
var CAR_COLORS = [0xc8ccd0, 0x2a2e33, 0x8a9aaa, 0x7a2222, 0x224477, 0xd8d2c0, 0x445544, 0xddaa33];
var PED_COLORS = [0x3a4a6a, 0x6a3a3a, 0x3a6a4a, 0x6a5a2a, 0x555566, 0x884466, 0x336677, 0x775533];

function buildAgents() {
  // машина: корпус + кабина, слитые в одну геометрию
  var body = new THREE.BoxGeometry(4.2, 1.1, 1.8);
  body.translate(0, 0.75, 0);
  var cab = new THREE.BoxGeometry(2.2, 0.85, 1.6);
  cab.translate(-0.2, 1.7, 0);
  var carGeom = mergeGeoms([body, cab]);
  carMesh = new THREE.InstancedMesh(carGeom, new THREE.MeshLambertMaterial({ color: 0xffffff }), CAR_MAX);
  carMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carMesh.frustumCulled = false;
  carMesh.castShadow = true;
  scene.add(carMesh);

  // человек: тело + голова
  var torso = new THREE.BoxGeometry(0.45, 1.15, 0.3);
  torso.translate(0, 0.95, 0);
  var head = new THREE.SphereGeometry(0.16, 6, 5);
  head.translate(0, 1.68, 0);
  var pedGeom = mergeGeoms([torso, head]);
  pedMesh = new THREE.InstancedMesh(pedGeom, new THREE.MeshLambertMaterial({ color: 0xffffff }), PED_MAX);
  pedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pedMesh.frustumCulled = false;
  pedMesh.castShadow = true;
  scene.add(pedMesh);

  // фары и габариты, светятся в темноте (по 2 точки спереди и сзади)
  function lightPoints(color, size) {
    var g = new THREE.BufferGeometry();
    var arr = new Float32Array(CAR_MAX * 2 * 3);
    for (var li = 0; li < arr.length; li += 3) arr[li + 1] = -100;
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    var m = new THREE.PointsMaterial({ color: color, size: size, sizeAttenuation: true,
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    nightGlowMats.push(m);
    var pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  }
  headPts = lightPoints(0xfff2c0, 2.6);
  tailPts = lightPoints(0xff3526, 2.0);

  var rng = mulberry32(2024);
  for (var i = 0; i < CAR_MAX; i++) {
    carMesh.setColorAt(i, new THREE.Color(CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)]));
  }
  for (var j = 0; j < PED_MAX; j++) {
    pedMesh.setColorAt(j, new THREE.Color(PED_COLORS[Math.floor(rng() * PED_COLORS.length)]));
  }
  if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
  if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
}

function mergeGeoms(list) {
  var pos = [], norm = [];
  for (var i = 0; i < list.length; i++) {
    var g = list[i].toNonIndexed();
    pos = pos.concat(Array.prototype.slice.call(g.attributes.position.array));
    norm = norm.concat(Array.prototype.slice.call(g.attributes.normal.array));
  }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  return out;
}

function spawnCar(rng) {
  var g = carGraph;
  for (var tries = 0; tries < 30; tries++) {
    var a = Math.floor(rng() * g.nodes.length);
    if (!g.adj[a].length) continue;
    var b = g.adj[a][Math.floor(rng() * g.adj[a].length)];
    return { a: a, b: b, t: rng(), speed: 8 + rng() * 5, x: 0, z: 0, ang: 0 };
  }
  return null;
}
function spawnPed(rng, clock) {
  var g = walkGraph;
  var w = poiWeights(clock.hour, clock.dow, sim.season, sim.weather);
  var target = pickPoi(w, rng);
  var startNode;
  if (rng() < 0.45) {
    // стартуем у другой точки интереса (уже «в городе»)
    var from = pickPoi(w, rng);
    startNode = g.nearest(from.x, from.z);
  } else {
    startNode = Math.floor(rng() * g.nodes.length);
  }
  if (startNode < 0 || !g.adj[startNode] || !g.adj[startNode].length) return null;
  return {
    node: startNode, next: -1, t: 0, prev: -1,
    target: target, mode: 'walk', loiterUntil: 0,
    lx: 0, lz: 0, speed: 1.2 + rng() * 0.6, x: 0, z: 0, ang: rng() * 6.28,
    walked: 0
  };
}

var agentRng = mulberry32(123456);

function updateCars(simDt, clock) {
  var target = carTargetCount(clock.hour, clock.dow, sim.season, sim.weather);
  for (var sc = 0; sc < 4 && cars.length < target; sc++) {
    var c = spawnCar(agentRng);
    if (c) cars.push(c);
  }
  if (cars.length > target) {
    var cdrop = cars.length - target > 25 ? 2 : (agentRng() < 0.1 ? 1 : 0);
    while (cdrop-- > 0 && cars.length > target) cars.pop();
  }
  var g = carGraph;
  var moveDt = Math.min(simDt, 0.0333 * 120); // движение «не быстрее» 120×
  for (var i = 0; i < cars.length; i++) {
    var c = cars[i];
    var A = g.nodes[c.a], B = g.nodes[c.b];
    var len = Math.sqrt(dist2(A[0], A[1], B[0], B[1])) || 1;
    c.t += c.speed * moveDt / len;
    while (c.t >= 1) {
      c.t -= 1;
      var nbrs = g.adj[c.b];
      var nxt = -1;
      if (nbrs.length === 1) nxt = nbrs[0];
      else {
        // предпочитаем «не разворачиваться»
        for (var tr = 0; tr < 4; tr++) {
          var cand = nbrs[Math.floor(agentRng() * nbrs.length)];
          if (cand !== c.a || tr === 3) { nxt = cand; break; }
        }
      }
      c.a = c.b; c.b = nxt;
      A = g.nodes[c.a]; B = g.nodes[c.b];
      len = Math.sqrt(dist2(A[0], A[1], B[0], B[1])) || 1;
    }
    c.x = lerp(A[0], B[0], c.t);
    c.z = lerp(A[1], B[1], c.t);
    c.ang = Math.atan2(-(B[1] - A[1]), B[0] - A[0]);
    c.fx = (B[0] - A[0]) / len; c.fz = (B[1] - A[1]) / len;
  }
  // огни: фары спереди, габариты сзади
  var hArr = headPts.geometry.attributes.position.array;
  var tArr = tailPts.geometry.attributes.position.array;
  for (var li = 0; li < CAR_MAX; li++) {
    var o = li * 6;
    if (li < cars.length) {
      var cc = cars[li];
      var px = -cc.fz * 0.6, pz = cc.fx * 0.6;
      hArr[o] = cc.x + cc.fx * 2.1 + px; hArr[o + 1] = 0.95; hArr[o + 2] = cc.z + cc.fz * 2.1 + pz;
      hArr[o + 3] = cc.x + cc.fx * 2.1 - px; hArr[o + 4] = 0.95; hArr[o + 5] = cc.z + cc.fz * 2.1 - pz;
      tArr[o] = cc.x - cc.fx * 2.1 + px; tArr[o + 1] = 0.95; tArr[o + 2] = cc.z - cc.fz * 2.1 + pz;
      tArr[o + 3] = cc.x - cc.fx * 2.1 - px; tArr[o + 4] = 0.95; tArr[o + 5] = cc.z - cc.fz * 2.1 - pz;
    } else {
      hArr[o + 1] = hArr[o + 4] = tArr[o + 1] = tArr[o + 4] = -100;
    }
  }
  headPts.geometry.attributes.position.needsUpdate = true;
  tailPts.geometry.attributes.position.needsUpdate = true;
  for (var k = 0; k < CAR_MAX; k++) {
    if (k < cars.length) {
      dummy.position.set(cars[k].x, 0.15, cars[k].z);
      dummy.rotation.set(0, cars[k].ang, 0);
      dummy.scale.set(1, 1, 1);
    } else {
      dummy.position.set(0, -100, 0); dummy.scale.set(0.001, 0.001, 0.001);
    }
    dummy.updateMatrix();
    carMesh.setMatrixAt(k, dummy.matrix);
  }
  carMesh.instanceMatrix.needsUpdate = true;
}

var lastScatterMs = 0, lastScatterReal = 0;
function updatePeds(simDt, clock) {
  var target = pedTargetCount(clock.hour, clock.dow, sim.season, sim.weather);
  for (var sp = 0; sp < 8 && peds.length < target && peds.length < PED_MAX; sp++) {
    var p = spawnPed(agentRng, clock);
    if (!p) break;
    var N = walkGraph.nodes[p.node];
    p.x = N[0]; p.z = N[1];
    peds.push(p);
  }
  if (peds.length > target) {
    // при сильном избытке (смена сцены/сезона) рассасываемся быстрее
    var drop = peds.length - target > 40 ? 3 : (agentRng() < 0.15 ? 1 : 0);
    while (drop-- > 0 && peds.length > target) peds.pop();
  }

  var fast = sim.speed > 120;
  if (fast) {
    // на больших скоростях не «ходим», а пересобираем распределение толпы
    var nowReal = performance.now();
    if (Math.abs(sim.ms - lastScatterMs) > 8 * 60e3 && nowReal - lastScatterReal > 1500) {
      lastScatterMs = sim.ms; lastScatterReal = nowReal;
      var w = poiWeights(clock.hour, clock.dow, sim.season, sim.weather);
      for (var i = 0; i < peds.length; i++) {
        var poi = pickPoi(w, agentRng);
        peds[i].x = poi.x + (agentRng() - 0.5) * 28;
        peds[i].z = poi.z + (agentRng() - 0.5) * 28;
        peds[i].ang = agentRng() * 6.28;
        peds[i].mode = 'loiter';
        peds[i].loiterUntil = sim.ms;
      }
    }
  } else {
    var g = walkGraph;
    var moveDt = Math.min(simDt, 0.0333 * 120);
    for (var j = 0; j < peds.length; j++) {
      var pd = peds[j];
      if (pd.mode === 'loiter') {
        if (sim.ms >= pd.loiterUntil || pd.loiterUntil - sim.ms > 3 * 3600e3) {
          // выбрать новую цель и вернуться на граф
          var w2 = poiWeights(clock.hour, clock.dow, sim.season, sim.weather);
          pd.target = pickPoi(w2, agentRng);
          pd.node = g.nearest(pd.x, pd.z);
          pd.next = -1; pd.mode = 'walk'; pd.walked = 0;
          if (pd.node < 0) { peds.splice(j, 1); j--; continue; }
          var NN = g.nodes[pd.node];
          pd.x = NN[0]; pd.z = NN[1];
        } else {
          // лёгкое блуждание на месте
          pd.x += Math.cos(pd.ang) * 0.3 * moveDt;
          pd.z += Math.sin(pd.ang) * 0.3 * moveDt;
          if (agentRng() < 0.02) pd.ang = agentRng() * 6.28;
          continue;
        }
      }
      // walking
      if (pd.next < 0) {
        var nbrs2 = g.adj[pd.node];
        if (!nbrs2 || !nbrs2.length) { peds.splice(j, 1); j--; continue; }
        var best = -1, bs = Infinity;
        for (var n2 = 0; n2 < nbrs2.length; n2++) {
          var nb = nbrs2[n2];
          var sc = Math.sqrt(dist2(g.nodes[nb][0], g.nodes[nb][1], pd.target.x, pd.target.z))
                 + agentRng() * 18 + (nb === pd.prev ? 70 : 0);
          if (sc < bs) { bs = sc; best = nb; }
        }
        pd.next = best; pd.t = 0;
      }
      var A2 = g.nodes[pd.node], B2 = g.nodes[pd.next];
      var len2 = Math.sqrt(dist2(A2[0], A2[1], B2[0], B2[1])) || 1;
      pd.t += pd.speed * moveDt / len2;
      pd.walked += pd.speed * moveDt;
      if (pd.t >= 1) {
        pd.prev = pd.node; pd.node = pd.next; pd.next = -1; pd.t = 0;
        var NB = g.nodes[pd.node];
        pd.x = NB[0]; pd.z = NB[1];
        var dTar = Math.sqrt(dist2(pd.x, pd.z, pd.target.x, pd.target.z));
        if (dTar < 30 || pd.walked > 3500) {
          // пришли (или «приехали на автобусе») — потусоваться у цели
          pd.x = pd.target.x + (agentRng() - 0.5) * 22;
          pd.z = pd.target.z + (agentRng() - 0.5) * 22;
          pd.mode = 'loiter';
          pd.loiterUntil = sim.ms + (8 + agentRng() * 35) * 60e3;
          pd.ang = agentRng() * 6.28;
        }
      } else {
        pd.x = lerp(A2[0], B2[0], pd.t);
        pd.z = lerp(A2[1], B2[1], pd.t);
        pd.ang = Math.atan2(B2[1] - A2[1], B2[0] - A2[0]);
      }
    }
  }
  for (var k = 0; k < PED_MAX; k++) {
    if (k < peds.length) {
      dummy.position.set(peds[k].x, 0.12, peds[k].z);
      dummy.rotation.set(0, -peds[k].ang + Math.PI / 2, 0);
      dummy.scale.set(1, 1, 1);
    } else {
      dummy.position.set(0, -100, 0); dummy.scale.set(0.001, 0.001, 0.001);
    }
    dummy.updateMatrix();
    pedMesh.setMatrixAt(k, dummy.matrix);
  }
  pedMesh.instanceMatrix.needsUpdate = true;
}

// ----------------------------------------------------------------- weather
function estimateTempC(ms, clock, weather) {
  var doy = Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 0)) / DAY_MS) % 366;
  var seasonal = 6.2 - 11.5 * Math.cos(2 * Math.PI * (doy - 15) / 365);
  var diurnal = 3.5 * Math.cos(2 * Math.PI * (clock.hour - 15) / 24);
  var t = seasonal + diurnal;
  if (weather === 'cloudy') t -= 1;
  if (weather === 'rain') t -= 2;
  if (weather === 'snow') t -= 3;
  return Math.round(t);
}

function autoWeather(ms, season) {
  var block = Math.floor(ms / (3 * 3600e3));
  var rng = mulberry32(block * 2654435761 % 2147483647);
  var r = rng();
  var probs = {
    winter: [['clear', 0.32], ['cloudy', 0.40], ['snow', 0.28]],
    spring: [['clear', 0.45], ['cloudy', 0.35], ['rain', 0.20]],
    summer: [['clear', 0.55], ['cloudy', 0.27], ['rain', 0.18]],
    autumn: [['clear', 0.30], ['cloudy', 0.45], ['rain', 0.25]]
  }[season];
  for (var i = 0; i < probs.length; i++) {
    r -= probs[i][1];
    if (r <= 0) return probs[i][0];
  }
  return 'clear';
}

function updateWeather(clock) {
  sim.season = seasonOf(clock.month);
  var w = sim.weatherMode === 'auto' ? autoWeather(sim.ms, sim.season) : sim.weatherMode;
  // согласуем осадки с температурой
  var t = estimateTempC(sim.ms, clock, w);
  if (w === 'snow' && t > 3) w = 'rain';
  if (w === 'rain' && t < -1) w = 'snow';
  sim.weather = w;
  sim.tempC = t;
}

// ------------------------------------------------------- seasons & palette
var PALETTES = {
  summer: { ground: 0x6f8f5a, park: 0x5f9450, forest: 0x40683a, crown: 0x3f7a36,
            beach: 0xe5d7a8, water: 0x4a80ae, pitch: 0x4e8a4e, cemetery: 0x5a7a52,
            roofP: 0x96503e, roofF: 0x84888e },
  spring: { ground: 0x7d9a62, park: 0x74a85c, forest: 0x4f7a44, crown: 0x5f9c48,
            beach: 0xe0d2a4, water: 0x4f7ba8, pitch: 0x5a9456, cemetery: 0x647f58,
            roofP: 0x96503e, roofF: 0x84888e },
  autumn: { ground: 0x84805a, park: 0x8c8a52, forest: 0x6d5e34, crown: 0xb07830,
            beach: 0xd8caa0, water: 0x456e96, pitch: 0x6a8050, cemetery: 0x6c7456,
            roofP: 0x8d4f3e, roofF: 0x7e8288 },
  winter: { ground: 0xe8edf2, park: 0xdfe6ec, forest: 0xc8d2da, crown: 0x8898a4,
            beach: 0xe2e8ee, water: 0xc4d6e2, pitch: 0xd8e0e8, cemetery: 0xd2dae2,
            roofP: 0xe4e9ef, roofF: 0xdde3ea }
};
var currentPalette = null;
function applySeasonPalette() {
  if (currentPalette === sim.season) return;
  currentPalette = sim.season;
  var P = PALETTES[sim.season];
  mats.ground.color.setHex(P.ground);
  mats.park.color.setHex(P.park);
  mats.forest.color.setHex(P.forest);
  mats.beach.color.setHex(P.beach);
  mats.pitch.color.setHex(P.pitch);
  mats.cemetery.color.setHex(P.cemetery);
  treeCrownMat.color.setHex(P.crown);
  mats.water.color.setHex(P.water); // зимой залив замерзает — палитра светлеет
  mats.roofP.color.setHex(P.roofP); // зимой крыши под снегом
  mats.roofF.color.setHex(P.roofF);
}

// --------------------------------------------------------------- sky/light
var SKY = {
  day: new THREE.Color(0x87b5e0), dayCloud: new THREE.Color(0x9aa6b4),
  night: new THREE.Color(0x070d1d), dawn: new THREE.Color(0xd98a4e)
};
var _sky = new THREE.Color(), _tmp = new THREE.Color();
function updateSky() {
  var sp = sunPosition(sim.ms, LAT, LON);
  var alt = sp.altitude;
  var dayF = smoothstep(-0.10, 0.12, alt);
  var dawnF = Math.exp(-Math.pow((alt - 0.02) / 0.09, 2)); // колокол у горизонта

  var cloudy = sim.weather !== 'clear';
  var overcast = sim.weather === 'cloudy' || sim.weather === 'rain' || sim.weather === 'snow';

  lerpColor(_sky, SKY.night, overcast ? SKY.dayCloud : SKY.day, dayF);
  if (!overcast) _sky.lerp(SKY.dawn, dawnF * 0.45 * dayF);
  renderer.setClearColor(_sky);
  scene.fog.color.copy(_sky);
  var fogFar = overcast ? 4200 : 7000;
  if (sim.weather === 'rain' || sim.weather === 'snow') fogFar = 2600;
  scene.fog.far = lerp(scene.fog.far, fogFar, 0.05);
  scene.fog.near = scene.fog.far * 0.18;

  // направление на солнце: x — восток, z — юг
  var az = sp.azimuth;
  var dir = new THREE.Vector3(-Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt));
  // солнце и его теневая камера следуют за камерой
  sun.position.copy(cam.target).addScaledVector(dir, 3000);
  sun.target.position.copy(cam.target);
  sun.intensity = dayF * (overcast ? 0.25 : 1.0);
  _tmp.setHex(0xfff2dd).lerp(new THREE.Color(0xff9a40), dawnF);
  sun.color.copy(_tmp);
  hemi.intensity = 0.12 + dayF * (overcast ? 0.45 : 0.62);
  ambient.intensity = 0.18 + dayF * 0.12;

  var darkness = 1 - dayF;
  for (var i = 0; i < nightGlowMats.length; i++) {
    nightGlowMats[i].opacity = darkness * (nightGlowMats[i] === starPts.material && cloudy ? 0.15 : 0.95);
  }
  cloudOpacityTarget = overcast ? 0.85 : (sim.weather === 'clear' ? 0.12 : 0.4);

  // диски солнца и луны
  if (sunSprite) {
    sunSprite.position.copy(cam.target).addScaledVector(dir, 8500);
    sunSprite.material.opacity = overcast ? 0 : smoothstep(-0.06, 0.02, alt) * 0.95;
    sunSprite.material.color.setHex(0xffffff).lerp(new THREE.Color(0xff7030), dawnF * 0.85);
    var malt = -alt, maz = az + Math.PI;
    var mdir = new THREE.Vector3(-Math.sin(maz) * Math.cos(malt), Math.sin(malt),
                                 Math.cos(maz) * Math.cos(malt));
    moonSprite.position.copy(cam.target).addScaledVector(mdir, 8500);
    moonSprite.material.opacity = malt > 0 ? darkness * (overcast ? 0.08 : 0.8) : 0;
  }
  return dayF;
}

function updateClouds(dt) {
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i];
    c.position.x += c.userData.vx * dt * 4;
    if (c.position.x > 5200) c.position.x = -5200;
    var dark = starPts.material.opacity;
    var o = cloudOpacityTarget * (1 - dark * 0.75);
    c.material.opacity = lerp(c.material.opacity, o, Math.min(1, dt * 1.2));
  }
}

// --------------------------------------------------------- camera controls
var cam = { target: new THREE.Vector3(-100, 0, 300), dist: 1100, theta: -0.9, phi: 0.95 };
var camTween = null;
function flyTo(tx, tz, dist, phi, theta) {
  var dth = theta == null ? 0 : (theta - cam.theta);
  while (dth > Math.PI) dth -= 2 * Math.PI;   // кратчайший поворот
  while (dth < -Math.PI) dth += 2 * Math.PI;
  camTween = {
    t: 0, dur: 1.5,
    fx: cam.target.x, fz: cam.target.z, fd: cam.dist, fp: cam.phi, fth: cam.theta,
    tx: tx, tz: tz, td: dist == null ? cam.dist : dist,
    tp: phi == null ? cam.phi : phi, tth: cam.theta + dth
  };
}
function updateCamTween(dt) {
  if (!camTween) return;
  camTween.t += dt;
  var k = clamp(camTween.t / camTween.dur, 0, 1);
  k = k * k * (3 - 2 * k); // ease in-out
  cam.target.x = lerp(camTween.fx, camTween.tx, k);
  cam.target.z = lerp(camTween.fz, camTween.tz, k);
  cam.dist = lerp(camTween.fd, camTween.td, k);
  cam.phi = lerp(camTween.fp, camTween.tp, k);
  cam.theta = lerp(camTween.fth, camTween.tth, k);
  if (k >= 1) camTween = null;
}
function applyCamera() {
  cam.phi = clamp(cam.phi, 0.08, 1.52);
  cam.dist = clamp(cam.dist, 25, 9000);
  var x = cam.target.x + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta);
  var z = cam.target.z + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta);
  var y = cam.target.y + cam.dist * Math.cos(cam.phi);
  camera.position.set(x, y, z);
  camera.lookAt(cam.target);
}
var keys = {};
(function initControls() {
  var dragging = 0, px = 0, py = 0;
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (e) {
    dragging = (e.button === 2 || e.shiftKey) ? 2 : 1;
    px = e.clientX; py = e.clientY;
    camTween = null; // ручное управление отменяет перелёт
  });
  window.addEventListener('mouseup', function () { dragging = 0; });
  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - px, dy = e.clientY - py;
    px = e.clientX; py = e.clientY;
    if (dragging === 1) {
      cam.theta += dx * 0.005;
      cam.phi -= dy * 0.005;
    } else {
      var k = cam.dist * 0.0013;
      var fx = -Math.cos(cam.theta), fz = -Math.sin(cam.theta);
      var rx = -fz, rz = fx;
      cam.target.x += (-dx * rx + dy * fx) * k;
      cam.target.z += (-dx * rz + dy * fz) * k;
    }
  });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    camTween = null;
    cam.dist *= Math.pow(1.0013, e.deltaY);
  }, { passive: false });
  window.addEventListener('keydown', function (e) { keys[e.code] = true; });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  // touch: 1 палец — вращение, 2 — pinch-zoom
  var lastTouchDist = 0;
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) { px = e.touches[0].clientX; py = e.touches[0].clientY; }
    else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                 e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      var dx = e.touches[0].clientX - px, dy = e.touches[0].clientY - py;
      px = e.touches[0].clientX; py = e.touches[0].clientY;
      cam.theta += dx * 0.006; cam.phi -= dy * 0.006;
    } else if (e.touches.length === 2) {
      var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
      cam.dist *= lastTouchDist / d;
      lastTouchDist = d;
    }
  }, { passive: false });
})();
function updateKeysCamera(dt) {
  if (keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD ||
      keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) camTween = null;
  var v = cam.dist * 0.9 * dt;
  var fx = -Math.cos(cam.theta), fz = -Math.sin(cam.theta);
  var rx = -fz, rz = fx;
  if (keys.KeyW || keys.ArrowUp) { cam.target.x += fx * v; cam.target.z += fz * v; }
  if (keys.KeyS || keys.ArrowDown) { cam.target.x -= fx * v; cam.target.z -= fz * v; }
  if (keys.KeyA || keys.ArrowLeft) { cam.target.x -= rx * v; cam.target.z -= rz * v; }
  if (keys.KeyD || keys.ArrowRight) { cam.target.x += rx * v; cam.target.z += rz * v; }
  if (keys.KeyQ) cam.dist *= 1 + dt;
  if (keys.KeyE) cam.dist *= 1 - dt;
}

// --------------------------------------------------------------------- UI
var elClock = document.getElementById('clock');
var elDate = document.getElementById('dateline');
var elEnv = document.getElementById('envline');
var elStats = document.getElementById('stats');
var WEATHER_RU = { clear: 'ясно', cloudy: 'облачно', rain: 'дождь', snow: 'снег' };
var SEASON_RU = { winter: 'зима ❄', spring: 'весна 🌱', summer: 'лето ☀', autumn: 'осень 🍂' };
var uiAccum = 0;
function updateUI(dt) {
  uiAccum += dt;
  if (uiAccum < 0.25) return;
  uiAccum = 0;
  elDate.textContent = TZ_FMT_DATE.format(sim.ms);
  elClock.textContent = TZ_FMT_TIME.format(sim.ms) + (sim.speed === 0 ? '  ⏸' : '');
  elEnv.textContent = SEASON_RU[sim.season] + ' · ' + WEATHER_RU[sim.weather] + ' · ≈' +
    (sim.tempC > 0 ? '+' : '') + sim.tempC + ' °C';
  elStats.textContent = 'Жителей на улицах: ' + peds.length + ' · машин: ' + cars.length +
    ' · ' + Math.round(fpsValue) + ' fps';
}

// Адаптивное качество: при низком FPS снижаем разрешение рендера
var fpsValue = 60, fpsFrames = 0, fpsTime = 0;
var prMax = Math.min(window.devicePixelRatio || 1, 2), prScale = prMax;
function updateQuality(dt) {
  fpsFrames++; fpsTime += dt;
  if (fpsTime < 2) return;
  fpsValue = fpsFrames / fpsTime;
  fpsFrames = 0; fpsTime = 0;
  if (fpsValue < 28 && prScale > 0.7) {
    prScale = Math.max(0.65, prScale - 0.25);
    renderer.setPixelRatio(prScale);
  } else if (fpsValue > 55 && prScale < prMax) {
    prScale = Math.min(prMax, prScale + 0.25);
    renderer.setPixelRatio(prScale);
  }
}

(function initUI() {
  var btns = document.querySelectorAll('button[data-speed]');
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      btns.forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      sim.speed = +b.dataset.speed;
    });
  });
  document.getElementById('weather').addEventListener('change', function (e) {
    sim.weatherMode = e.target.value;
  });
  document.getElementById('labels').addEventListener('change', function (e) {
    labelsEnabled = e.target.checked;
  });
  document.getElementById('shadows').addEventListener('change', function (e) {
    sun.castShadow = e.target.checked;
  });

  // готовые сцены: дата + погода + точка города
  function catCenter(cat, n) {
    var list = (poiByCat[cat] || []).slice(0, n || 8);
    if (!list.length) return { x: 0, z: 0 };
    var cx = 0, cz = 0;
    list.forEach(function (p) { cx += p.x; cz += p.z; });
    return { x: cx / list.length, z: cz / list.length };
  }
  function nthFridayOfJuly(year, n) {
    var d = new Date(Date.UTC(year, 6, 1));
    var fridays = 0;
    while (true) {
      if (d.getUTCDay() === 5 && ++fridays === n) return d;
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  var PRESETS = {
    now: function () {
      sim.ms = Date.now(); sim.weatherMode = 'auto'; sim.speed = 1;
      flyTo(-100, 300, 1100, 0.95);
    },
    friday: function () { // ночь пятницы: толпы у баров старого города
      var y = new Date(sim.ms).getUTCFullYear();
      sim.ms = nthFridayOfJuly(y, 3).getTime() + (20 * 60 + 30) * 60e3; // 23:30 местного
      sim.weatherMode = 'clear'; sim.speed = 60;
      var c = catCenter('night');
      flyTo(c.x, c.z, 350, 0.85);
    },
    beach: function () { // субботний полдень на пляже
      var y = new Date(sim.ms).getUTCFullYear();
      sim.ms = nthFridayOfJuly(y, 3).getTime() + DAY_MS + 10 * 3600e3; // сб 13:00 местного
      sim.weatherMode = 'clear'; sim.speed = 60;
      var c = catCenter('beach', 12);
      flyTo(c.x, c.z, 650, 1.0, 1.6);
    },
    winter: function () { // заснеженный центр в январе
      var y = new Date(sim.ms).getUTCFullYear();
      sim.ms = Date.UTC(y, 0, 20, 10, 0); sim.weatherMode = 'snow'; sim.speed = 60;
      flyTo(-100, 300, 900, 0.9);
    }
  };
  document.querySelectorAll('button[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      PRESETS[b.dataset.preset]();
      lastScatterMs = 0;
      var dp2 = document.getElementById('datepick');
      var d = new Date(sim.ms - new Date(sim.ms).getTimezoneOffset() * 60000);
      dp2.value = d.toISOString().slice(0, 16);
      document.getElementById('weather').value = sim.weatherMode;
      document.querySelectorAll('button[data-speed]').forEach(function (x) {
        x.classList.toggle('active', +x.dataset.speed === sim.speed);
      });
    });
  });
  var dp = document.getElementById('datepick');
  function msToLocalInput(ms) {
    var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  dp.value = msToLocalInput(sim.ms);
  document.getElementById('setdate').addEventListener('click', function () {
    if (dp.value) {
      sim.ms = new Date(dp.value).getTime();
      lastScatterMs = 0;
    }
  });
})();

// ---------------------------------------------------------------- minimap
var mmCanvas = document.getElementById('minimap');
var mmCtx = mmCanvas.getContext('2d');
var mmBase = document.createElement('canvas');
var MM_SIZE = 210, MM_SPAN = 7400, MM_SCALE = MM_SIZE / MM_SPAN;
function w2m(x, z) { return [MM_SIZE / 2 + x * MM_SCALE, MM_SIZE / 2 + z * MM_SCALE]; }
function buildMinimap() {
  mmBase.width = mmBase.height = MM_SIZE;
  var c = mmBase.getContext('2d');
  c.fillStyle = '#1c2c1e';
  c.fillRect(0, 0, MM_SIZE, MM_SIZE);
  function poly(pts) {
    c.beginPath();
    var m0 = w2m(pts[0][0], pts[0][1]);
    c.moveTo(m0[0], m0[1]);
    for (var i = 1; i < pts.length; i++) {
      var m = w2m(pts[i][0], pts[i][1]);
      c.lineTo(m[0], m[1]);
    }
    c.closePath(); c.fill();
  }
  var i;
  c.fillStyle = '#3a5c33';
  for (i = 0; i < D.land.length; i++) {
    if (D.land[i].t === 'park' || D.land[i].t === 'forest') poly(D.land[i].p);
  }
  c.fillStyle = '#cfc08a';
  for (i = 0; i < D.land.length; i++) if (D.land[i].t === 'beach') poly(D.land[i].p);
  c.fillStyle = '#2c5f8a';
  if (D.sea) poly(D.sea);
  for (i = 0; i < D.land.length; i++) if (D.land[i].t === 'water') poly(D.land[i].p);
  c.strokeStyle = '#8a8f96'; c.lineWidth = 1;
  for (i = 0; i < D.roads.length; i++) {
    var r = D.roads[i];
    if (r.t !== 'maj' && r.t !== 'res') continue;
    c.beginPath();
    var s0 = w2m(r.p[0][0], r.p[0][1]);
    c.moveTo(s0[0], s0[1]);
    for (var j = 1; j < r.p.length; j++) {
      var s1 = w2m(r.p[j][0], r.p[j][1]);
      c.lineTo(s1[0], s1[1]);
    }
    c.stroke();
  }
  mmCanvas.addEventListener('click', function (e) {
    var rect = mmCanvas.getBoundingClientRect();
    var mx = (e.clientX - rect.left) * (MM_SIZE / rect.width);
    var mz = (e.clientY - rect.top) * (MM_SIZE / rect.height);
    flyTo((mx - MM_SIZE / 2) / MM_SCALE, (mz - MM_SIZE / 2) / MM_SCALE);
  });
}
var mmAccum = 1;
function updateMinimap(dt) {
  mmAccum += dt;
  if (mmAccum < 0.25) return;
  mmAccum = 0;
  mmCtx.clearRect(0, 0, MM_SIZE, MM_SIZE);
  mmCtx.drawImage(mmBase, 0, 0);
  // маркер камеры: точка цели и сектор обзора
  var m = w2m(cam.target.x, cam.target.z);
  var a = cam.theta + Math.PI; // взгляд камеры направлен от позиции к цели
  mmCtx.fillStyle = 'rgba(255,210,80,0.25)';
  mmCtx.beginPath();
  mmCtx.moveTo(m[0], m[1]);
  mmCtx.arc(m[0], m[1], 16, a - 0.5, a + 0.5);
  mmCtx.closePath(); mmCtx.fill();
  mmCtx.fillStyle = '#ffd250';
  mmCtx.beginPath(); mmCtx.arc(m[0], m[1], 3.2, 0, 6.3); mmCtx.fill();
  mmCtx.strokeStyle = 'rgba(255,210,80,0.8)'; mmCtx.lineWidth = 1;
  mmCtx.beginPath(); mmCtx.arc(m[0], m[1], 3.2, 0, 6.3); mmCtx.stroke();
}

// -------------------------------------------------------------- main loop
var lastFrame = performance.now();
function loop() {
  requestAnimationFrame(loop);
  var now = performance.now();
  var dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  var simDt = dt * sim.speed;
  sim.ms += simDt * 1000;

  var clock = localClock(sim.ms);
  updateWeather(clock);
  applySeasonPalette();
  var dayF = updateSky();
  updateClouds(dt);
  updatePrecip(dt, cam.target);
  if (sim.speed > 0) {
    updateCars(simDt, clock);
    updatePeds(simDt, clock);
  }
  updateBoats(dt, simDt);
  updateBirds(dt, simDt, dayF);
  updateKeysCamera(dt);
  updateCamTween(dt);
  applyCamera();
  updatePoiLabels(dt);
  updateQuality(dt);
  updateMinimap(dt);
  updateUI(dt);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------ build stages
var loadbar = document.getElementById('loadbar');
var loadmsg = document.getElementById('loadmsg');
var stages = [
  ['Рельеф и залив…', function () { buildGround(); buildWaterAndLand(); }],
  ['Улицы и дороги…', function () { buildRoads(); }],
  ['Здания (' + D.buildings.length + ')…', function () { buildBuildings(); }],
  ['Деревья и парки…', function () { buildTrees(); }],
  ['Освещение и небо…', function () { buildStreetLamps(); buildStars(); buildSkyBodies(); buildClouds(); buildPrecip(); }],
  ['Дорожный граф…', function () {
    carGraph = buildGraph({ maj: 1, res: 1, srv: 1 });
    walkGraph = buildGraph({ ped: 1, res: 1, srv: 1, maj: 1 });
  }],
  ['Жители и транспорт…', function () { preparePois(); buildPoiLabels(); buildPoiGlow(); buildAgents(); buildBoats(); buildBirds(); buildMinimap(); }]
];
var stageIdx = 0;
function runStage() {
  if (stageIdx >= stages.length) {
    var loader = document.getElementById('loader');
    loader.style.opacity = 0;
    setTimeout(function () { loader.remove(); }, 700);
    lastFrame = performance.now();
    loop();
    return;
  }
  var st = stages[stageIdx];
  loadmsg.textContent = st[0];
  loadbar.style.width = Math.round(stageIdx / stages.length * 100) + '%';
  setTimeout(function () {
    st[1]();
    stageIdx++;
    runStage();
  }, 30);
}
window.PARNU_DEBUG = { scene: scene, renderer: renderer, camera: camera, mats: mats, cam: cam,
                       peds: peds, cars: cars, get pois() { return pois; } };
runStage();

})();
