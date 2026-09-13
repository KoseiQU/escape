/* ESCAPE — P5e-0 案G「皮を剥がれた巨躯」3Dコンセプトモック（レーンB）
 *
 * 2.6m の筋肉質の男。皮膚が無く、筋束と腱が剥き出しで濡れて光る（赤黒＋黄色い脂肪の層）。
 * 下顎が無く舌が垂れる。眼は白濁。肩と首の筋が太い。手が大きい。
 * 低い天井の支線（配管）に肩をすぼめて立つ。
 *
 * 構法: 筋は1本ずつの筋束（細長い楕円体）を積んで作る。顔はジオメトリで彫る
 * （眼窩は実空洞・眼球は白濁の球でハイライト無し・上顎と歯は別パーツ・下顎は欠落）。
 */
(function (global) {
  'use strict';

  /* ---------------- 乱数・ノイズ ---------------- */
  function rngOf(seed) {
    var s = (seed | 0) || 7;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return ((s >>> 0) % 1e5) / 1e5; };
  }
  function hash2(x, y) { var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o) { var s = 0, a = 0.5, f = 1; for (var i = 0; i < (o || 4); i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
  function canvasOf(S, fn) {
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d'), im = cx.createImageData(S, S), d = im.data;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) fn(x, y, d, (y * S + x) * 4, S);
    cx.putImageData(im, 0, 0); return cv;
  }
  function texFrom(THREE, cv, rep, srgb) {
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]);
    if (srgb && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* 筋: 繊維の走る赤黒。所々に黄色い脂肪と白い腱膜 */
  function muscleCanvas() {
    return canvasOf(256, function (x, y, d, i) {
      var fiber = fbm(x / 2.2, y / 26, 3);              /* 縦に伸びた繊維 */
      var blot = fbm(x / 30 + 11, y / 30, 4);
      var fat = Math.max(0, fbm(x / 18 + 61, y / 18, 3) - 0.60) * 2.6;
      var base = 62 + fiber * 86 + blot * 44;
      var r = base * 1.00, g = base * 0.28, b = base * 0.24;
      r = r * (1 - fat * 0.25) + fat * 120;
      g = g * (1 - fat * 0.10) + fat * 104;
      b = b * (1 - fat * 0.55) + fat * 44;
      d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g); d[i + 2] = Math.min(255, b); d[i + 3] = 255;
    });
  }
  function muscleBump() {
    return canvasOf(256, function (x, y, d, i) {
      var f = fbm(x / 1.8, y / 30, 3), n = fbm(x / 9 + 7, y / 9, 3);
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, 128 + (f - 0.5) * 150 + (n - 0.5) * 60));
      d[i + 3] = 255;
    });
  }
  function wetRough() {
    return canvasOf(128, function (x, y, d, i) {
      var w = fbm(x / 13, y / 13, 4);
      var v = 255 * (0.84 - Math.max(0, w - 0.42) * 0.72);   /* 全体に濡れて光る */
      d[i] = 255; d[i + 1] = Math.max(12, Math.min(255, v)); d[i + 2] = 255; d[i + 3] = 255;
    });
  }
  function boneCanvas() {
    return canvasOf(128, function (x, y, d, i) {
      var n = fbm(x / 9, y / 9, 4), s = fbm(x / 30 + 41, y / 30, 3);
      var v = 124 + n * 56 - Math.max(0, s - 0.52) * 116;
      d[i] = Math.min(255, v * 1.02); d[i + 1] = Math.min(255, v * 0.96); d[i + 2] = Math.min(255, v * 0.79); d[i + 3] = 255;
    });
  }

  var MAT = null;
  function mats(THREE) {
    if (MAT) return MAT;
    var mc = texFrom(THREE, muscleCanvas(), [4, 8], true);
    var mb = texFrom(THREE, muscleBump(), [4, 8], false);
    var wr = texFrom(THREE, wetRough(), [3, 4], false);
    var bn = texFrom(THREE, boneCanvas(), [1.4, 1.4], true);
    MAT = {
      muscle: new THREE.MeshStandardMaterial({
        map: mc, bumpMap: mb, bumpScale: 0.024, roughnessMap: wr,
        color: 0x64322a, roughness: 0.72, metalness: 0.0
      }),
      muscleDeep: new THREE.MeshStandardMaterial({
        map: mc, bumpMap: mb, bumpScale: 0.026, roughnessMap: wr,
        color: 0x3a1a1a, roughness: 0.68, metalness: 0.0
      }),
      fat: new THREE.MeshStandardMaterial({
        map: mc, bumpMap: mb, bumpScale: 0.018, roughnessMap: wr,
        color: 0x8a7742, roughness: 0.46, metalness: 0.0
      }),
      tendon: new THREE.MeshStandardMaterial({
        map: mc, bumpMap: mb, bumpScale: 0.012, roughnessMap: wr,
        color: 0x9d9678, roughness: 0.42, metalness: 0.0
      }),
      bone: new THREE.MeshStandardMaterial({ map: bn, bumpMap: mb, bumpScale: 0.012, color: 0x7d7658, roughness: 0.56 }),
      boneDim: new THREE.MeshStandardMaterial({ map: bn, color: 0x6a6552, roughness: 0.70 }),
      tooth: new THREE.MeshStandardMaterial({ color: 0x9c9679, roughness: 0.40 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x83867a, roughness: 1.0, metalness: 0.0 }),
      tongue: new THREE.MeshStandardMaterial({
        map: mc, bumpMap: mb, bumpScale: 0.014, roughnessMap: wr,
        color: 0x4a1f26, roughness: 0.34
      }),
      vein: new THREE.MeshStandardMaterial({ color: 0x3a1a1c, roughness: 0.35 }),
      void: new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.DoubleSide }),
      steel: new THREE.MeshStandardMaterial({ color: 0x1c1913, roughness: 0.80, metalness: 0.65 })
    };
    return MAT;
  }

  /* ---------------- 形の道具 ---------------- */
  function mesh(THREE, geo, mat, px, py, pz) {
    var m = new THREE.Mesh(geo, mat);
    if (px !== undefined) m.position.set(px, py, pz);
    return m;
  }
  function seg(THREE, mat, from, to, r0, r1, n) {
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L, n || 8, 1, false), mat);
    m.position.set(from[0] + dx / 2, from[1] + dy / 2, from[2] + dz / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    return m;
  }
  function blob(THREE, mat, p, r, sx, sy, sz) {
    var m = mesh(THREE, new THREE.SphereGeometry(r, 8, 6), mat, p[0], p[1], p[2]);
    m.scale.set(sx || 1, sy || 1, sz || 1); return m;
  }
  /** 筋束: from→to を結ぶ紡錘形（中央が膨らむ） */
  function bundle(THREE, mat, from, to, rMid, bulge) {
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var m = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), mat);
    m.scale.set(rMid, L / 2, rMid * (bulge || 1));
    m.position.set(from[0] + dx / 2, from[1] + dy / 2, from[2] + dz / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    return m;
  }

  global.__A2_G_UTIL = { rngOf: rngOf, mats: mats, mesh: mesh, seg: seg, blob: blob, bundle: bundle };
})(typeof window !== 'undefined' ? window : this);

/* ================= 頭部（下顎の無い顔） ================= */
(function (global) {
  'use strict';
  var U = global.__A2_G_UTIL;

  /** 原点＝頭蓋の中心、正面 −Z */
  global.__A2_G_HEAD = function (THREE) {
    var P = U.mats(THREE), rnd = U.rngOf(17), g = new THREE.Group();
    var RX = 0.082, RY = 0.100, RZ = 0.103, FZ = -0.094;
    var add = function (m) { g.add(m); return m; };

    /* 1) 脳頭蓋（皮を剥がれているので骨が露出）＋ 2) 後頭・頭蓋底 */
    var cal = U.mesh(THREE, new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), P.bone);
    cal.scale.set(RX, RY, RZ * 1.02); add(cal);
    var base = U.mesh(THREE, new THREE.SphereGeometry(1, 14, 10, 0, Math.PI, Math.PI * 0.38, Math.PI * 0.62), P.bone);
    base.scale.set(RX, RY * 0.99, RZ * 1.02); add(base);
    /* 3) 側頭筋（こめかみに残る扇形の筋。左右で厚みが違う） */
    [[1, 1.0], [-1, 0.86]].forEach(function (s) {
      var t = U.blob(THREE, P.muscle, [s[0] * RX * 0.86, RY * 0.10 * s[1], RZ * 0.02], 0.046, 0.40, 1.20, 1.25);
      add(t);
      add(U.seg(THREE, P.tendon, [s[0] * RX * 0.90, RY * 0.30, -0.01], [s[0] * RX * 0.86, -0.030, FZ + 0.055], 0.006, 0.009, 5));
    });
    /* 4) 縫合線 */
    var cor = U.mesh(THREE, new THREE.TorusGeometry(RY * 0.97, 0.0026, 4, 18, Math.PI), P.boneDim, 0, 0.004, 0.002);
    cor.rotation.y = Math.PI / 2; add(cor);

    /* 5) 眼窩（実空洞）＋ 6) 眼窩縁 ＋ 7) 白濁した眼球（ハイライト無し） */
    var SOCK = [
      { x: 0.0375, y: 0.0120, r: 0.0315, d: 0.056, t: -0.10 },
      { x: -0.0360, y: 0.0065, r: 0.0288, d: 0.050, t: 0.16 }
    ];
    SOCK.forEach(function (s, i) {
      var cav = U.mesh(THREE, new THREE.ConeGeometry(s.r, s.d, 12, 1, false), P.void, s.x, s.y, FZ + s.d / 2);
      cav.rotation.x = Math.PI / 2; cav.rotation.z = s.t; add(cav);
      var eye = U.mesh(THREE, new THREE.SphereGeometry(s.r * 0.80, 14, 10), P.eye,
        s.x, s.y - 0.001, FZ + 0.0145 - i * 0.003);
      eye.scale.set(1, 0.97, 0.92); add(eye);
      /* 白濁のむら（角膜の濁り） */
      add(U.blob(THREE, P.boneDim, [s.x + 0.004, s.y + 0.003, FZ + 0.006 - i * 0.003], s.r * 0.34, 1, 0.8, 0.25));
      var rim = U.mesh(THREE, new THREE.TorusGeometry(s.r * 1.03, 0.0074, 5, 14), P.bone, s.x, s.y, FZ - 0.002);
      rim.scale.set(1.05, 0.93, 1.1); rim.rotation.z = s.t * 0.6; add(rim);
      var brow = U.mesh(THREE, new THREE.TorusGeometry(s.r * 1.14, 0.0112, 5, 12, Math.PI * 0.9), P.bone,
        s.x, s.y + 0.008, FZ + 0.012);
      brow.rotation.z = 0.24 + s.t; brow.scale.set(1, 0.68, 1.4); add(brow);
    });
    /* 8) 前頭 ＋ 9) 鼻腔（空洞）＋ 10) 鼻骨 */
    add(U.blob(THREE, P.bone, [0.001, 0.050, FZ + 0.022], 0.052, 1.24, 0.80, 0.32));
    var nas = U.mesh(THREE, new THREE.ConeGeometry(0.0180, 0.042, 9, 1, false), P.void, 0.002, -0.030, FZ + 0.024);
    nas.rotation.x = Math.PI / 2; nas.scale.set(1, 1, 1.45); add(nas);
    [[-1, 0], [1, 0.004]].forEach(function (s) {
      add(U.seg(THREE, P.bone, [s[0] * 0.005, 0.012, FZ + 0.004], [s[0] * 0.012, -0.018, FZ + 0.002 + s[1]], 0.0080, 0.0055, 5));
    });
    /* 11) 頬骨・頬骨弓 */
    [[1, 1.0], [-1, 0.91]].forEach(function (s) {
      add(U.blob(THREE, P.bone, [s[0] * 0.0560, -0.0250 * s[1], FZ + 0.018], 0.0180, 1.10, 0.80, 0.95));
      add(U.seg(THREE, P.bone, [s[0] * 0.0605, -0.021, FZ + 0.028], [s[0] * 0.0720, 0.004, RZ * 0.28], 0.0088, 0.0060, 6));
    });
    /* 12) 上顎 ＋ 13) 口蓋 ＋ 14) 上の歯（1本ずつ・下顎が無いので剥き出し） */
    var MY = -0.062;
    var mx = U.mesh(THREE, new THREE.TorusGeometry(0.0450, 0.0158, 6, 16, Math.PI * 1.08), P.bone, 0.001, MY, -0.020);
    mx.rotation.x = -Math.PI / 2; mx.scale.set(1, 1.16, 1); add(mx);
    add(U.blob(THREE, P.boneDim, [0.001, MY - 0.005, -0.018], 0.038, 1.02, 0.30, 1.18));
    var r2 = U.rngOf(29);
    for (var i2 = 0; i2 < 11; i2++) {
      var a = Math.PI * (0.055 + 0.89 * (i2 / 10));
      if (i2 === 3) continue;
      var h = 0.018 + r2() * 0.012, w = 0.0056 + r2() * 0.0030;
      var t2 = U.mesh(THREE, new THREE.CylinderGeometry(w * 0.55, w, h, 5), P.tooth,
        Math.cos(a) * 0.0440, MY - 0.011 - h * 0.5, -Math.sin(a) * 0.0440 * 1.16 - 0.020);
      t2.rotation.y = -a; t2.rotation.x = -(0.08 + r2() * 0.20) * (i2 % 2 ? 1 : -1);
      t2.rotation.z = (r2() - 0.5) * 0.28; add(t2);
    }
    /* 15) 下顎が千切れた断面（関節突起の折れ口と咬筋の残骸） */
    [[1, 1], [-1, 0.9]].forEach(function (s) {
      add(U.blob(THREE, P.muscleDeep, [s[0] * 0.058, MY + 0.004, 0.020], 0.024, 0.85, 1.05, 0.95));
      add(U.blob(THREE, P.bone, [s[0] * 0.056, MY + 0.018, 0.036], 0.011, 1.1, 0.7, 1.0));
    });
    /* 16) 咽頭（暗い喉の穴）＋ 17) 舌（垂れ下がる） */
    var thr = U.mesh(THREE, new THREE.ConeGeometry(0.026, 0.050, 10, 1, false), P.void, 0.001, MY - 0.014, -0.006);
    thr.rotation.x = -Math.PI * 0.42; add(thr);
    var tg = new THREE.Group(); tg.position.set(0.004, MY - 0.016, -0.020); tg.rotation.set(0.30, 0.10, 0.06);
    var t0 = U.bundle(THREE, P.tongue, [0, 0, 0], [0.004, -0.115, -0.028], 0.042, 0.48); tg.add(t0);
    var t1 = U.bundle(THREE, P.tongue, [0.004, -0.100, -0.026], [0.014, -0.190, -0.052], 0.030, 0.42); tg.add(t1);
    var tip = U.blob(THREE, P.tongue, [0.015, -0.196, -0.056], 0.022, 1.0, 0.85, 0.38); tip.rotation.x = 0.4; tg.add(tip);
    for (var k = 0; k < 4; k++) {                       /* 舌の裏の血管 */
      tg.add(U.seg(THREE, P.vein, [-0.016 + k * 0.011, -0.030, -0.044], [-0.010 + k * 0.010, -0.120, -0.062], 0.0020, 0.0013, 4));
    }
    add(tg);
    /* 18) 頬の筋（頬骨から上顎へ）＋ 19) 眼輪筋の残り */
    [[1], [-1]].forEach(function (s) {
      add(U.bundle(THREE, P.muscle, [s[0] * 0.058, -0.026, FZ + 0.030], [s[0] * 0.030, MY + 0.004, FZ + 0.034], 0.014, 0.7));
    });
    return g;
  };
})(typeof window !== 'undefined' ? window : this);

/* ================= 案G 本体 ================= */
(function (global) {
  'use strict';
  var U = global.__A2_G_UTIL;
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var M = ESCAPE.__A2MOCKS = ESCAPE.__A2MOCKS || {};

  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function off(p, dx, dy, dz) { return [p[0] + dx, p[1] + dy, p[2] + dz]; }

  /* 腕: 三角筋3頭・上腕二頭/三頭・前腕の筋束・腱・大きな手 */
  function arm(THREE, P, g, o) {
    var U2 = U, s = o.side;
    /* 三角筋（前・中・後の3頭） */
    g.add(U2.blob(THREE, P.muscle, off(o.sh, s * 0.034, 0.026, -0.038), 0.090, 1.0, 0.95, 0.86));
    g.add(U2.blob(THREE, P.muscle, off(o.sh, s * 0.058, 0.024, 0.012), 0.098, 1.0, 1.02, 0.92));
    g.add(U2.blob(THREE, P.muscleDeep, off(o.sh, s * 0.040, 0.018, 0.058), 0.082, 1.0, 0.92, 0.84));
    /* 上腕: 二頭（前）・三頭（後）・上腕筋 */
    var midU = mix(o.sh, o.el, 0.52);
    g.add(U2.bundle(THREE, P.muscle, off(o.sh, 0, -0.02, -0.028), off(o.el, 0, 0.01, -0.024), 0.082, 1.0));
    g.add(U2.bundle(THREE, P.muscleDeep, off(o.sh, 0, -0.02, 0.038), off(o.el, 0, 0.01, 0.030), 0.086, 0.95));
    g.add(U2.bundle(THREE, P.muscle, off(o.sh, s * 0.040, -0.03, 0.004), off(o.el, s * 0.020, 0.01, 0.004), 0.046, 1.0));
    g.add(U2.seg(THREE, P.tendon, midU, off(o.el, 0, 0, -0.012), 0.010, 0.016, 6));
    /* 肘（骨が浮く） */
    g.add(U2.blob(THREE, P.bone, off(o.el, 0, 0, 0.026), 0.030, 1.0, 0.9, 0.9));
    g.add(U2.blob(THREE, P.muscleDeep, o.el, 0.044, 1.0, 0.8, 1.0));
    /* 前腕: 4本の筋束（回外・屈筋・伸筋） */
    var A = [[-0.038, 0.038, 0.072], [0.038, 0.038, 0.068], [-0.014, -0.044, 0.060], [0.032, -0.038, 0.058]];
    A.forEach(function (a, i) {
      g.add(U2.bundle(THREE, i % 2 ? P.muscle : P.muscleDeep,
        off(o.el, a[0] * 0.6, 0, a[1] * 0.6), mix(off(o.wr, a[0] * 0.25, 0, a[1] * 0.25), o.el, 0.12), a[2], 0.95));
    });
    /* 手首の腱（4本） */
    for (var t = 0; t < 4; t++) {
      g.add(U2.seg(THREE, P.tendon, mix(o.el, o.wr, 0.60), off(o.wr, (t - 1.5) * 0.014, 0, -0.014), 0.0055, 0.0042, 4));
    }
    /* 手（大きい） */
    var d = [o.wr[0] - o.el[0], o.wr[1] - o.el[1], o.wr[2] - o.el[2]];
    var L = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]); d = [d[0] / L, d[1] / L, d[2] / L];
    var dv = new THREE.Vector3(d[0], d[1], d[2]);
    var side = new THREE.Vector3().crossVectors(dv, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 0.01) side.set(1, 0, 0); side.normalize();
    var fwd = new THREE.Vector3().crossVectors(side, dv).normalize();
    var palm = U2.blob(THREE, P.muscle, o.wr, 0.074, 1.35, 0.78, 0.50);
    palm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dv);
    palm.position.set(o.wr[0] + d[0] * 0.045, o.wr[1] + d[1] * 0.045, o.wr[2] + d[2] * 0.045);
    g.add(palm);
    var rnd = U2.rngOf(o.seed || 3);
    for (var i = 0; i < 5; i++) {
      var tt = (i / 4 - 0.5) * 2;
      var fl = 0.135 * (1 - Math.abs(tt) * 0.26) * (0.85 + rnd() * 0.32);
      var b0 = new THREE.Vector3(o.wr[0], o.wr[1], o.wr[2])
        .addScaledVector(side, tt * 0.058).addScaledVector(dv, 0.085);
      var k1 = b0.clone().addScaledVector(dv, fl * 0.5).addScaledVector(fwd, (o.curl || 0.4) * fl * 0.35);
      var k2 = k1.clone().addScaledVector(dv, fl * 0.34).addScaledVector(fwd, (o.curl || 0.4) * fl * 0.55);
      var k3 = k2.clone().addScaledVector(dv, fl * 0.26).addScaledVector(fwd, (o.curl || 0.4) * fl * 0.6);
      g.add(U2.seg(THREE, P.muscle, b0.toArray(), k1.toArray(), 0.0165, 0.0140, 6));
      g.add(U2.seg(THREE, P.muscle, k1.toArray(), k2.toArray(), 0.0140, 0.0118, 6));
      g.add(U2.seg(THREE, P.muscle, k2.toArray(), k3.toArray(), 0.0118, 0.0070, 6));
      g.add(U2.blob(THREE, P.bone, k1.toArray(), 0.0130, 1, 1, 1));
      g.add(U2.blob(THREE, P.bone, k3.toArray(), 0.0070, 0.8, 0.8, 1.5));
      g.add(U2.seg(THREE, P.tendon, o.wr, b0.toArray(), 0.0040, 0.0034, 4));
    }
  }

  /* 脚: 大腿四頭・ハムストリング・内転筋・腓腹筋・アキレス腱・足 */
  function leg(THREE, P, g, o) {
    var s = o.side;
    g.add(U.bundle(THREE, P.muscle, off(o.hip, 0, 0.02, -0.040), off(o.kn, 0, 0.04, -0.034), 0.118, 0.90));
    g.add(U.bundle(THREE, P.muscleDeep, off(o.hip, 0, 0.02, 0.046), off(o.kn, 0, 0.04, 0.040), 0.114, 0.88));
    g.add(U.bundle(THREE, P.muscle, off(o.hip, s * 0.048, 0.00, 0.004), off(o.kn, s * 0.034, 0.04, 0.004), 0.076, 1.0));
    g.add(U.bundle(THREE, P.muscleDeep, off(o.hip, -s * 0.040, 0.00, 0.010), off(o.kn, -s * 0.030, 0.04, 0.008), 0.072, 1.0));
    g.add(U.blob(THREE, P.bone, o.kn, 0.052, 1.0, 0.80, 0.95));                    /* 膝蓋骨 */
    g.add(U.seg(THREE, P.tendon, off(o.kn, 0, 0.05, -0.036), off(o.kn, 0, -0.05, -0.034), 0.014, 0.012, 6));
    g.add(U.bundle(THREE, P.muscle, off(o.kn, s * 0.022, -0.02, 0.038), off(o.an, s * 0.010, 0.10, 0.030), 0.078, 0.95));
    g.add(U.bundle(THREE, P.muscleDeep, off(o.kn, -s * 0.020, -0.02, 0.036), off(o.an, -s * 0.008, 0.10, 0.028), 0.074, 0.95));
    g.add(U.bundle(THREE, P.muscle, off(o.kn, 0, -0.02, -0.030), off(o.an, 0, 0.06, -0.018), 0.044, 1.0));
    g.add(U.seg(THREE, P.tendon, off(o.kn, 0, -0.34, 0.030), off(o.an, 0, 0.01, 0.022), 0.014, 0.011, 5));  /* アキレス腱 */
    g.add(U.blob(THREE, P.bone, off(o.an, s * 0.028, 0.012, 0.004), 0.019, 1, 1, 1));
    /* 足 */
    var ft = U.blob(THREE, P.muscle, off(o.an, 0, -0.052, -0.052), 0.072, 0.78, 0.42, 1.35); g.add(ft);
    g.add(U.blob(THREE, P.muscleDeep, off(o.an, 0, -0.040, 0.046), 0.048, 0.80, 0.55, 0.80));
    for (var i = 0; i < 5; i++) {
      var t = (i / 4 - 0.5) * 2, fl = 0.048 * (1 - Math.abs(t) * 0.3);
      var b0 = off(o.an, t * 0.042, -0.078, -0.115);
      g.add(U.seg(THREE, P.muscle, b0, off(b0, t * 0.008, 0.004, -fl), 0.0135, 0.0095, 5));
      g.add(U.blob(THREE, P.bone, off(b0, t * 0.010, 0.005, -fl - 0.006), 0.0068, 0.9, 0.7, 1.3));
    }
  }

  global.__A2_G_LIMBS = { arm: arm, leg: leg, mix: mix, off: off };
})(typeof window !== 'undefined' ? window : this);

/* ================= 案G 組み立て ================= */
(function (global) {
  'use strict';
  var U = global.__A2_G_UTIL, LB = global.__A2_G_LIMBS;
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var M = ESCAPE.__A2MOCKS = ESCAPE.__A2MOCKS || {};
  var off = LB.off, mix = LB.mix;

  M.G = {
    name: '案G 皮を剥がれた巨躯',
    build: function (THREE) {
      var P = U.mats(THREE), g = new THREE.Group(), rnd = U.rngOf(5);

      /* ---- 低い天井の支線（配管）。肩をすぼめる理由を見せる ---- */
      var pipe = U.mesh(THREE, new THREE.CylinderGeometry(0.050, 0.050, 3.2, 10), P.steel, 0.34, 2.52, 0.04);
      pipe.rotation.z = Math.PI / 2; pipe.rotation.y = 0.22; g.add(pipe);
      [-1, 1].forEach(function (s) {
        var br = U.mesh(THREE, new THREE.BoxGeometry(0.035, 0.44, 0.08), P.steel, 0.34 + s * 1.15, 2.74, 0.04);
        g.add(br);
      });

      /* ---- 体幹 ---- */
      var HIP = [0.03, 1.28, 0.12], SHO = [0.00, 2.04, -0.02], CH = [0.01, 1.78, 0.02];
      /* 脊柱起立筋（背中の2本の太い畝）＋ 広背筋 */
      [-1, 1].forEach(function (s) {
        g.add(U.bundle(THREE, P.muscleDeep, off(HIP, s * 0.050, -0.02, 0.115), off(SHO, s * 0.046, 0.00, 0.105), 0.062, 0.9));
        g.add(U.bundle(THREE, P.muscle, off(HIP, s * 0.140, 0.10, 0.075), off(SHO, s * 0.195, -0.10, 0.055), 0.086, 0.55));
      });
      /* 肋郭（筋の下から肋骨が浮く） */
      for (var r = 0; r < 5; r++) {
        var y = 1.66 + r * 0.060;
        var rib = U.mesh(THREE, new THREE.TorusGeometry(0.198 - r * 0.005, 0.0092, 4, 12, Math.PI * 1.16), P.muscleDeep, 0.01, y, 0.02);
        rib.rotation.x = -Math.PI / 2 + 0.20; rib.rotation.z = Math.PI * 0.42; rib.scale.set(1, 1, 0.62); g.add(rib);
      }
      /* 大胸筋（2枚。乳頭は無い＝皮が無い） */
      [-1, 1].forEach(function (s) {
        var pec = U.bundle(THREE, P.muscle, off(CH, s * 0.022, 0.10, -0.140), off(SHO, s * 0.200, -0.06, -0.060), 0.108, 0.62);
        g.add(pec);
        g.add(U.seg(THREE, P.tendon, off(CH, s * 0.120, 0.12, -0.100), off(SHO, s * 0.160, -0.05, -0.030), 0.012, 0.016, 5));
      });
      /* 前鋸筋（脇腹の指状の筋・4本） */
      [-1, 1].forEach(function (s) {
        for (var k = 0; k < 4; k++) {
          g.add(U.bundle(THREE, P.muscle, [s * 0.175, 1.64 + k * 0.052, 0.03], [s * 0.105, 1.70 + k * 0.052, -0.075], 0.022, 0.8));
        }
      });
      /* 腹直筋（6区画）＋ 腹斜筋 ＋ 黄色い脂肪の層 */
      for (var i = 0; i < 3; i++) {
        [-1, 1].forEach(function (s) {
          var ab = U.blob(THREE, P.muscle, [s * 0.054, 1.42 + i * 0.098, -0.132 + i * 0.010], 0.058, 0.90, 0.80, 0.62);
          g.add(ab);
        });
      }
      [-1, 1].forEach(function (s) {
        g.add(U.bundle(THREE, P.muscleDeep, [s * 0.130, 1.36, -0.060], [s * 0.160, 1.66, -0.020], 0.055, 0.72));
        g.add(U.blob(THREE, P.fat, [s * 0.150, 1.40, -0.070], 0.048, 1.1, 0.55, 0.70));
        g.add(U.blob(THREE, P.fat, [s * 0.120, 1.88, -0.095], 0.036, 1.2, 0.45, 0.55));
      });
      /* 腰・骨盤 */
      g.add(U.blob(THREE, P.muscleDeep, [0.03, 1.28, 0.04], 0.180, 1.10, 0.72, 0.90));
      [-1, 1].forEach(function (s) {
        g.add(U.blob(THREE, P.bone, [s * 0.175, 1.32, 0.02], 0.062, 0.42, 0.85, 1.05));   /* 腸骨稜 */
        g.add(U.blob(THREE, P.muscle, [s * 0.170, 1.20, 0.090], 0.115, 0.95, 0.85, 0.95)); /* 臀筋 */
      });
      /* 肩甲骨・僧帽筋・胸鎖乳突筋・鎖骨 */
      [-1, 1].forEach(function (s) {
        g.add(U.bundle(THREE, P.muscle, [s * 0.034, 2.26, 0.055], [s * 0.235, 2.00, 0.035], 0.070, 0.62));  /* 僧帽筋 */
        g.add(U.blob(THREE, P.bone, [s * 0.160, 1.98, 0.095], 0.082, 0.30, 0.95, 0.80));                    /* 肩甲骨 */
        g.add(U.seg(THREE, P.bone, [s * 0.034, 2.04, -0.085], [s * 0.225, 2.01, -0.030], 0.018, 0.014, 6));  /* 鎖骨 */
        g.add(U.bundle(THREE, P.muscle, [s * 0.038, 2.06, -0.070], [s * 0.070, 2.26, 0.010], 0.026, 1.0));   /* 胸鎖乳突筋 */
        g.add(U.seg(THREE, P.vein, [s * 0.052, 2.06, -0.060], [s * 0.062, 2.28, -0.010], 0.0060, 0.0042, 4));
      });
      /* 首（太い） */
      g.add(U.seg(THREE, P.muscleDeep, [0.00, 2.02, 0.010], [0.00, 2.30, -0.045], 0.088, 0.072, 9));

      /* ---- 頭部（前へ突き出し、うなだれる） ---- */
      var head = global.__A2_G_HEAD(THREE);
      head.position.set(0.00, 2.38, -0.12); head.rotation.set(0.30, 0.12, -0.05); head.scale.setScalar(0.98); g.add(head);

      /* ---- 腕（右腕は配管を掴み、左腕は垂れる） ---- */
      LB.arm(THREE, P, g, { side: 1, sh: [0.255, 2.01, 0.00], el: [0.470, 2.26, 0.12], wr: [0.520, 2.46, 0.06], seed: 7, curl: 1.25 });
      LB.arm(THREE, P, g, { side: -1, sh: [-0.255, 2.01, 0.00], el: [-0.345, 1.58, 0.06], wr: [-0.300, 1.12, -0.12], seed: 11, curl: 0.42 });
      /* ---- 脚 ---- */
      LB.leg(THREE, P, g, { side: -1, hip: [-0.155, 1.26, 0.08], kn: [-0.180, 0.70, 0.02], an: [-0.165, 0.15, 0.04] });
      LB.leg(THREE, P, g, { side: 1, hip: [0.215, 1.26, 0.11], kn: [0.255, 0.70, 0.10], an: [0.240, 0.15, 0.10] });

      /* ---- 表面の血管（濡れた筋の上を這う） ---- */
      for (var v = 0; v < 14; v++) {
        var a = rnd() * Math.PI * 2, yy = 1.30 + rnd() * 0.80;
        var vn = U.mesh(THREE, new THREE.TorusGeometry(0.05 + rnd() * 0.09, 0.0045, 4, 8, Math.PI * (0.4 + rnd() * 0.6)), P.vein,
          Math.sin(a) * 0.16, yy, -0.10 + Math.cos(a) * 0.10);
        vn.rotation.set(rnd() * 3, a, rnd() * 3); g.add(vn);
      }
      return g;
    },
    cams: {
      full: { pos: [-1.02, 1.34, -2.82], look: [0.02, 1.40, 0.02] },
      face: { pos: [0.06, 2.30, -0.90], look: [0.00, 2.26, -0.14] }
    }
  };
})(typeof window !== 'undefined' ? window : this);
