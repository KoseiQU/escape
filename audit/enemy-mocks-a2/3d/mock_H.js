/* ESCAPE — P5e-0 案H「顔のない管理者」3Dコンセプトモック（レーンB）
 *
 * 2.4m の細い男。防護服の残骸（フード・前面のジッパー・ゴム手袋の名残）。
 * 頭部は錆びた呼吸装置（円筒のフィルター2つ・蛇腹ホース）とバルブが肉に癒着して顔が無い。
 * 装置の縁で皮膚が盛り上がり血管が絡む。指先が金属化（錆びた爪）。
 * 静かに立ち、首だけこちらへ回す。
 *
 * 構法: 装置と肉の境は別パーツで積む（癒着のリッジ・めくれた皮膚・血管・リベット）。
 * 眼は無い（顔が無い）ので眼球もハイライトも無い。
 */
(function (global) {
  'use strict';

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

  function rustCanvas() {
    return canvasOf(256, function (x, y, d, i) {
      var n = fbm(x / 14, y / 14, 5), pit = fbm(x / 3.4 + 19, y / 3.4, 3);
      var flake = Math.max(0, fbm(x / 26 + 7, y / 26, 4) - 0.50) * 2.2;
      var base = 46 + n * 58;
      var r = base * (1 + flake * 0.95), g = base * (1 + flake * 0.42), b = base * (1 - flake * 0.35);
      var dark = pit < 0.34 ? 0.55 : 1;
      d[i] = Math.min(255, r * dark); d[i + 1] = Math.min(255, g * dark * 0.80); d[i + 2] = Math.min(255, b * dark * 0.62); d[i + 3] = 255;
    });
  }
  function rubberCanvas() {
    return canvasOf(256, function (x, y, d, i) {
      var n = fbm(x / 10, y / 10, 4), cr = fbm(x / 2.6 + 41, y / 22, 3);
      var v = 30 + n * 34 - Math.max(0, cr - 0.62) * 60;
      var grime = Math.max(0, fbm(x / 40 + 3, y / 40, 3) - 0.52) * 1.8;
      d[i] = Math.max(0, v * (1 + grime * 0.5)); d[i + 1] = Math.max(0, v * (1 + grime * 0.34)); d[i + 2] = Math.max(0, v * 0.86); d[i + 3] = 255;
    });
  }
  function skinCanvas() {
    return canvasOf(256, function (x, y, d, i) {
      var n = fbm(x / 20, y / 20, 5), m = fbm(x / 6 + 31, y / 6, 4);
      var v = fbm(x / 52 + 9, y / 52, 3);
      var base = 104 + n * 52 - m * 26;
      var sick = Math.max(0, v - 0.48) * 1.7;
      d[i] = Math.min(255, base * (1 - sick * 0.10));
      d[i + 1] = Math.min(255, base * (1 - sick * 0.02) * 0.99);
      d[i + 2] = Math.min(255, base * (1 - sick * 0.34) * 0.90);
      d[i + 3] = 255;
    });
  }
  function bumpCanvas() {
    return canvasOf(256, function (x, y, d, i) {
      var p = fbm(x / 3.0, y / 3.0, 3), w = fbm(x / 15 + 13, y / 15, 4);
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, 128 + (p - 0.5) * 92 + (w - 0.5) * 72));
      d[i + 3] = 255;
    });
  }

  var MAT = null;
  function mats(THREE) {
    if (MAT) return MAT;
    var ru = texFrom(THREE, rustCanvas(), [2, 2], true);
    var rb = texFrom(THREE, rubberCanvas(), [2, 2], true);
    var sk = texFrom(THREE, skinCanvas(), [2, 2], true);
    var bp = texFrom(THREE, bumpCanvas(), [3, 3], false);
    MAT = {
      rust: new THREE.MeshStandardMaterial({ map: ru, bumpMap: bp, bumpScale: 0.010, color: 0x3c2d1c, roughness: 0.82, metalness: 0.42 }),
      rustDark: new THREE.MeshStandardMaterial({ map: ru, bumpMap: bp, bumpScale: 0.012, color: 0x1d170e, roughness: 0.88, metalness: 0.35 }),
      steel: new THREE.MeshStandardMaterial({ map: ru, color: 0x2c2a26, roughness: 0.52, metalness: 0.80 }),
      rubber: new THREE.MeshStandardMaterial({ map: rb, bumpMap: bp, bumpScale: 0.014, color: 0x121309, roughness: 0.90, metalness: 0.0 }),
      rubberWet: new THREE.MeshStandardMaterial({ map: rb, bumpMap: bp, bumpScale: 0.010, color: 0x0f110a, roughness: 0.46, metalness: 0.05 }),
      skin: new THREE.MeshStandardMaterial({ map: sk, bumpMap: bp, bumpScale: 0.022, color: 0x3d3c31, roughness: 0.70 }),
      skinRaw: new THREE.MeshStandardMaterial({ map: sk, bumpMap: bp, bumpScale: 0.026, color: 0x39271f, roughness: 0.44 }),
      vein: new THREE.MeshStandardMaterial({ color: 0x2d1b1c, roughness: 0.42 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x11150f, roughness: 0.22, metalness: 0.30 }),
      nail: new THREE.MeshStandardMaterial({ map: ru, color: 0x33291c, roughness: 0.62, metalness: 0.70 }),
      dark: new THREE.MeshBasicMaterial({ color: 0x050604, side: THREE.DoubleSide })
    };
    return MAT;
  }

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
    var m = mesh(THREE, new THREE.SphereGeometry(r, 9, 7), mat, p[0], p[1], p[2]);
    m.scale.set(sx || 1, sy || 1, sz || 1); return m;
  }
  global.__A2_H_UTIL = { rngOf: rngOf, mats: mats, mesh: mesh, seg: seg, blob: blob };
})(typeof window !== 'undefined' ? window : this);

/* ================= 頭部（顔の無い呼吸装置） ================= */
(function (global) {
  'use strict';
  var U = global.__A2_H_UTIL;

  /** 原点＝頭の中心、装置の面は −Z */
  global.__A2_H_HEAD = function (THREE) {
    var P = U.mats(THREE), rnd = U.rngOf(23), g = new THREE.Group();
    var add = function (m) { g.add(m); return m; };
    var RX = 0.078, RY = 0.096, RZ = 0.094, FZ = -0.060;

    /* 1) 頭蓋（薄い皮膚に覆われる。毛は無い） */
    var cr = U.mesh(THREE, new THREE.SphereGeometry(1, 16, 12), P.skin);
    cr.scale.set(RX, RY, RZ); cr.position.z = 0.012; add(cr);
    /* 2) 側頭の血管＋ 3) 片方だけ残る耳 */
    for (var v = 0; v < 9; v++) {
      var a = rnd() * Math.PI * 2;
      var vn = U.mesh(THREE, new THREE.TorusGeometry(0.026 + rnd() * 0.030, 0.0030, 4, 8, Math.PI * (0.4 + rnd() * 0.7)), P.vein,
        Math.sin(a) * RX * 0.80, RY * (0.1 + rnd() * 0.6) - 0.02, 0.012 + Math.cos(a) * RZ * 0.62);
      vn.rotation.set(rnd() * 3, a, rnd() * 3); add(vn);
    }
    var ear = U.mesh(THREE, new THREE.TorusGeometry(0.024, 0.0072, 5, 12, Math.PI * 1.25), P.skin, -RX * 0.98, -0.006, 0.020);
    ear.rotation.set(0.2, Math.PI / 2, 2.0); ear.scale.set(1, 1.25, 0.42); add(ear);
    /* 4) 顎〜首（顔が無いので下顎の輪郭だけが皮膚の下にある） */
    add(U.blob(THREE, P.skin, [0.002, -RY * 0.72, 0.020], 0.058, 1.02, 0.62, 0.92));

    /* ---- 呼吸装置（錆びた金属が肉に癒着している） ---- */
    /* 5) 面体（顔の位置を塞ぐ楕円の板） */
    var plate = U.mesh(THREE, new THREE.CylinderGeometry(0.080, 0.070, 0.048, 16), P.rust, 0.002, -0.012, FZ - 0.020);
    plate.rotation.x = Math.PI / 2; plate.scale.set(1.0, 1, 1.12); add(plate);
    var face = U.mesh(THREE, new THREE.SphereGeometry(0.081, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.44), P.rustDark, 0.002, -0.012, FZ - 0.044);
    face.rotation.x = -Math.PI / 2; face.scale.set(1.0, 1.12, 0.52); add(face);
    /* 6) 面体の枠（縁のリング）＋ 7) リベット */
    var ring = U.mesh(THREE, new THREE.TorusGeometry(0.081, 0.0082, 6, 20), P.steel, 0.002, -0.012, FZ - 0.044);
    ring.scale.set(1, 1.12, 1); add(ring);
    for (var i = 0; i < 10; i++) {
      var t = i / 10 * Math.PI * 2;
      add(U.blob(THREE, P.steel, [0.002 + Math.cos(t) * 0.081, -0.012 + Math.sin(t) * 0.090, FZ - 0.046], 0.0062, 1, 1, 0.7));
    }
    /* 8) フィルター缶2つ（左右に張り出す。蓋は打ち抜きの穴） */
    [[1, 0.082, -0.030], [-1, 0.078, -0.044]].forEach(function (s, k) {
      var cx = 0.002 + s[0] * s[1], cy = -0.026 - k * 0.012;
      var can = U.mesh(THREE, new THREE.CylinderGeometry(0.038, 0.038, 0.086, 14), P.rust, cx, cy, FZ - 0.052);
      can.rotation.x = Math.PI / 2; can.rotation.z = s[0] * 0.34; can.rotation.y = -s[0] * 0.30; add(can);
      var lid = U.mesh(THREE, new THREE.CylinderGeometry(0.040, 0.040, 0.010, 14), P.rustDark, cx, cy, FZ - 0.096);
      lid.rotation.x = Math.PI / 2; lid.rotation.z = s[0] * 0.34; lid.rotation.y = -s[0] * 0.30; add(lid);
      for (var h = 0; h < 6; h++) {                    /* 打ち抜きの穴 */
        var ang = h / 6 * Math.PI * 2;
        add(U.mesh(THREE, new THREE.CircleGeometry(0.0058, 6), P.dark,
          cx + Math.cos(ang) * 0.020 + s[0] * 0.030, cy + Math.sin(ang) * 0.020, FZ - 0.098));
      }
      add(U.mesh(THREE, new THREE.TorusGeometry(0.039, 0.0038, 4, 14), P.steel, cx, cy, FZ - 0.030));
      add(U.seg(THREE, P.rubberWet, [cx, cy, FZ - 0.010], [0.002 + s[0] * 0.028, -0.040, FZ - 0.020], 0.010, 0.012, 7));
    });
    /* 9) バルブ（円形のノブ＋スポーク） */
    var val = U.mesh(THREE, new THREE.TorusGeometry(0.019, 0.0060, 5, 12), P.steel, 0.004, -0.052, FZ - 0.050);
    add(val);
    for (var sp = 0; sp < 3; sp++) {
      var m = U.mesh(THREE, new THREE.BoxGeometry(0.036, 0.0040, 0.0040), P.steel, 0.004, -0.052, FZ - 0.050);
      m.rotation.z = sp * Math.PI / 3; add(m);
    }
    add(U.mesh(THREE, new THREE.CylinderGeometry(0.010, 0.012, 0.020, 8), P.rustDark, 0.004, -0.052, FZ - 0.040)).rotation.x = Math.PI / 2;
    /* 10) 蛇腹ホース（口の位置から胸へ垂れる） */
    var pts = [[0.010, -0.070, FZ - 0.040], [0.030, -0.150, FZ - 0.020], [0.050, -0.230, 0.010], [0.040, -0.310, 0.030]];
    var curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
    add(U.mesh(THREE, new THREE.TubeGeometry(curve, 14, 0.0165, 7, false), P.rubberWet));
    for (var r = 0; r <= 13; r++) {
      var pp = curve.getPointAt(r / 13), tg = curve.getTangentAt(r / 13);
      var rib = U.mesh(THREE, new THREE.TorusGeometry(0.0192, 0.0048, 4, 10), P.rubber, pp.x, pp.y, pp.z);
      rib.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg); add(rib);
    }
    /* 11) 癒着のリッジ（装置の縁で皮膚が盛り上がる）＋ 12) めくれた皮膚 ＋ 13) 絡む血管 */
    var rr = U.mesh(THREE, new THREE.TorusGeometry(0.083, 0.0135, 6, 20), P.skinRaw, 0.002, -0.012, FZ - 0.020);
    rr.scale.set(1.02, 1.12, 1); add(rr);
    var rnd2 = U.rngOf(47);
    for (var b = 0; b < 12; b++) {
      var a2 = b / 12 * Math.PI * 2 + rnd2() * 0.3;
      var lump = U.blob(THREE, b % 3 ? P.skin : P.skinRaw,
        [0.002 + Math.cos(a2) * 0.086, -0.012 + Math.sin(a2) * 0.096, FZ - 0.012 + rnd2() * 0.012],
        0.011 + rnd2() * 0.009, 1.0, 1.0, 1.5);
      lump.rotation.z = a2; add(lump);
      var vv = U.mesh(THREE, new THREE.TorusGeometry(0.020 + rnd2() * 0.020, 0.0032, 4, 8, Math.PI * (0.5 + rnd2() * 0.6)), P.vein,
        0.002 + Math.cos(a2) * 0.079, -0.012 + Math.sin(a2) * 0.088, FZ - 0.030 + rnd2() * 0.02);
      vv.rotation.set(rnd2() * 2, a2, rnd2() * 3); add(vv);
    }
    /* 14) 頭を締めるゴムバンド2本（頭蓋の上を渡る） */
    [[0.30, 0.0], [-0.10, 0.030]].forEach(function (s) {
      var bd = U.mesh(THREE, new THREE.TorusGeometry(RY * 0.99, 0.0085, 4, 18, Math.PI * 1.15), P.rubber, 0.002, -0.004, s[1]);
      bd.rotation.y = Math.PI / 2; bd.rotation.x = s[0]; bd.scale.set(0.94, 1, 1); add(bd);
    });
    return g;
  };
})(typeof window !== 'undefined' ? window : this);

/* ================= 案H 本体 ================= */
(function (global) {
  'use strict';
  var U = global.__A2_H_UTIL;
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var M = ESCAPE.__A2MOCKS = ESCAPE.__A2MOCKS || {};

  /* 細い腕/脚。o={a,b,c, r0,r1,r2, sleeve:'rubber'|null, glove:bool, foot:bool, seed} */
  function limb(THREE, P, g, o) {
    var up = o.sleeve ? P.rubber : P.skin;
    g.add(U.seg(THREE, up, o.a, o.b, o.r0, o.r1, 8));
    g.add(U.seg(THREE, o.bare ? P.skin : up, o.b, o.c, o.r1, o.r2, 8));
    g.add(U.blob(THREE, up, o.a, o.r0 * 1.25, 1, 1, 1));
    g.add(U.blob(THREE, o.bare ? P.skin : up, o.b, o.r1 * 1.30, 1.0, 0.9, 1.0));
    if (o.sleeve && o.bare) {                        /* 袖の裂けた端（ゴムの縁がめくれる） */
      var d = [o.c[0] - o.b[0], o.c[1] - o.b[1], o.c[2] - o.b[2]];
      var L = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      var p = [o.b[0] + d[0] * 0.22, o.b[1] + d[1] * 0.22, o.b[2] + d[2] * 0.22];
      var cuff = U.mesh(THREE, new THREE.CylinderGeometry(o.r1 * 1.35, o.r1 * 1.05, 0.055, 9, 1, true), P.rubber, p[0], p[1], p[2]);
      cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(d[0] / L, d[1] / L, d[2] / L));
      cuff.material = P.rubber; g.add(cuff);
    }
    /* 手（指先が金属化）／足 */
    var d2 = [o.c[0] - o.b[0], o.c[1] - o.b[1], o.c[2] - o.b[2]];
    var L2 = Math.sqrt(d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2]);
    var dv = new THREE.Vector3(d2[0] / L2, d2[1] / L2, d2[2] / L2);
    var side = new THREE.Vector3().crossVectors(dv, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 0.01) side.set(1, 0, 0); side.normalize();
    if (o.foot) {
      var ft = U.blob(THREE, P.rubber, [o.c[0], o.c[1] - 0.026, o.c[2] - 0.062], 0.056, 0.80, 0.42, 1.45);
      g.add(ft);
      g.add(U.blob(THREE, P.rubberWet, [o.c[0], o.c[1] - 0.020, o.c[2] + 0.036], 0.040, 0.85, 0.55, 0.75));
      return;
    }
    var fwd = new THREE.Vector3().crossVectors(side, dv).normalize();
    var palm = U.blob(THREE, P.skin, [o.c[0] + dv.x * 0.035, o.c[1] + dv.y * 0.035, o.c[2] + dv.z * 0.035], 0.042, 1.25, 0.66, 0.52);
    palm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dv); g.add(palm);
    if (o.glove) {                                   /* ゴム手袋の名残（手首の輪） */
      var gl = U.mesh(THREE, new THREE.TorusGeometry(o.r2 * 1.5, 0.0090, 5, 12), P.rubber, o.c[0], o.c[1], o.c[2]);
      gl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dv); g.add(gl);
    }
    var rnd = U.rngOf(o.seed || 3);
    for (var i = 0; i < 5; i++) {
      var t = (i / 4 - 0.5) * 2, fl = 0.098 * (1 - Math.abs(t) * 0.24) * (0.85 + rnd() * 0.3);
      var b0 = new THREE.Vector3(o.c[0], o.c[1], o.c[2]).addScaledVector(side, t * 0.034).addScaledVector(dv, 0.062);
      var k1 = b0.clone().addScaledVector(dv, fl * 0.52).addScaledVector(fwd, (o.curl || 0.25) * fl * 0.4);
      var k2 = k1.clone().addScaledVector(dv, fl * 0.40).addScaledVector(fwd, (o.curl || 0.25) * fl * 0.55);
      g.add(U.seg(THREE, P.skin, b0.toArray(), k1.toArray(), 0.0105, 0.0088, 6));
      g.add(U.seg(THREE, P.skin, k1.toArray(), k2.toArray(), 0.0088, 0.0070, 6));
      g.add(U.blob(THREE, P.skin, k1.toArray(), 0.0092, 1, 1, 1));
      /* 指先の金属化（錆びた爪） */
      var tip = k2.clone().addScaledVector(dv, fl * 0.26).addScaledVector(fwd, (o.curl || 0.25) * fl * 0.5);
      g.add(U.seg(THREE, P.nail, k2.toArray(), tip.toArray(), 0.0072, 0.0018, 6));
      g.add(U.mesh(THREE, new THREE.TorusGeometry(0.0074, 0.0018, 4, 8), P.nail, k2.x, k2.y, k2.z));
    }
  }

  M.H = {
    name: '案H 顔のない管理者',
    build: function (THREE) {
      var P = U.mats(THREE), g = new THREE.Group(), rnd = U.rngOf(3);

      /* ---- 制御室の盤（背後の壁面。立っている場所を示す） ---- */
      var panel = new THREE.Group(); panel.position.set(0.92, 1.26, 0.92); panel.rotation.y = -0.34;
      panel.add(U.mesh(THREE, new THREE.BoxGeometry(1.10, 1.30, 0.16), P.rustDark, 0, 0, 0));
      panel.add(U.mesh(THREE, new THREE.BoxGeometry(1.16, 0.10, 0.20), P.rust, 0, 0.68, 0));
      for (var d = 0; d < 6; d++) {
        var dl = U.mesh(THREE, new THREE.CylinderGeometry(0.038, 0.038, 0.030, 10), P.steel,
          -0.36 + (d % 3) * 0.36, 0.30 - Math.floor(d / 3) * 0.30, -0.09);
        dl.rotation.x = Math.PI / 2; panel.add(dl);
        panel.add(U.mesh(THREE, new THREE.BoxGeometry(0.006, 0.030, 0.006), P.rust,
          -0.36 + (d % 3) * 0.36, 0.315 - Math.floor(d / 3) * 0.30, -0.105));
      }
      panel.add(U.mesh(THREE, new THREE.BoxGeometry(0.52, 0.22, 0.04), P.glass, 0.06, -0.32, -0.09));
      /* 生きている表示灯（この装置だけが光っている） */
      var lamps = [[-0.30, 0.52, 0x4e1208], [-0.16, 0.52, 0x123f16], [-0.02, 0.52, 0x3a2f06]];
      lamps.forEach(function (L) {
        panel.add(U.mesh(THREE, new THREE.SphereGeometry(0.016, 8, 6),
          new THREE.MeshBasicMaterial({ color: L[2] }), L[0], L[1], -0.10));
      });
      g.add(panel);

      /* ---- 体（正面は −Z。体は右へ捻り、首だけこちらを向く） ---- */
      var body = new THREE.Group(); body.rotation.y = 0.86; g.add(body);
      var SHO = 2.00, HIP = 1.22;
      /* 防護服の胴（裾が裂けている） */
      var tor = U.mesh(THREE, new THREE.CylinderGeometry(0.150, 0.120, 0.80, 14, 1, true), P.rubber, 0, 1.62, 0.0);
      tor.scale.set(1.0, 1, 0.72); body.add(tor);
      body.add(U.blob(THREE, P.rubber, [0, SHO - 0.02, 0], 0.160, 1.0, 0.62, 0.74));
      [-1, 1].forEach(function (s) {
        var pad = U.blob(THREE, P.rubberWet, [s * 0.150, SHO - 0.03, 0.005], 0.062, 1.0, 0.72, 0.92);
        body.add(pad);
        body.add(U.mesh(THREE, new THREE.TorusGeometry(0.052, 0.0075, 4, 12), P.rubber, s * 0.158, SHO - 0.05, 0.0));
      });
      body.add(U.blob(THREE, P.rubber, [0, HIP, 0], 0.130, 1.05, 0.70, 0.80));
      /* 裂けた裾からのぞく腹の皮膚 */
      body.add(U.blob(THREE, P.skin, [0.015, 1.47, -0.085], 0.082, 0.90, 0.80, 0.42));
      var tear = U.mesh(THREE, new THREE.TorusGeometry(0.088, 0.012, 5, 14, Math.PI * 1.2), P.rubberWet, 0.015, 1.47, -0.070);
      tear.rotation.z = 0.4; body.add(tear);
      for (var t2 = 0; t2 < 5; t2++) {                  /* 裾の裂け目 */
        var a3 = -0.9 + t2 * 0.45;
        var rag = U.mesh(THREE, new THREE.BoxGeometry(0.055, 0.10 + rnd() * 0.09, 0.006), P.rubber,
          Math.sin(a3) * 0.128, 1.235 - rnd() * 0.05, -Math.cos(a3) * 0.092);
        rag.rotation.set(0.1, a3, (rnd() - 0.5) * 0.5); body.add(rag);
      }
      for (var f2 = 0; f2 < 7; f2++) {
        var af = -1.3 + f2 * 0.46;
        var flap = U.mesh(THREE, new THREE.BoxGeometry(0.070, 0.16 + rnd() * 0.13, 0.008), P.rubber,
          Math.sin(af) * 0.126, 1.18 - rnd() * 0.06, -Math.cos(af) * 0.096);
        flap.rotation.set(0.16 + rnd() * 0.2, af, (rnd() - 0.5) * 0.6); body.add(flap);
      }
      var belt = U.mesh(THREE, new THREE.TorusGeometry(0.142, 0.014, 5, 16), P.rubberWet, 0, 1.76, 0);
      belt.scale.set(1, 1, 0.76); body.add(belt);
      body.add(U.mesh(THREE, new THREE.BoxGeometry(0.044, 0.052, 0.020), P.rust, 0.006, 1.76, -0.108));
      /* 前面のジッパー（テープ＋務歯） */
      body.add(U.mesh(THREE, new THREE.BoxGeometry(0.030, 0.74, 0.010), P.rubberWet, 0.004, 1.62, -0.110));
      for (var z = 0; z < 22; z++) {
        body.add(U.mesh(THREE, new THREE.BoxGeometry(0.016, 0.010, 0.008), P.steel, 0.004, 1.28 + z * 0.033, -0.116));
      }
      body.add(U.mesh(THREE, new THREE.BoxGeometry(0.020, 0.034, 0.010), P.rust, 0.004, 1.99, -0.118));  /* スライダー */
      /* フードの残骸（首まわりの立ち襟）＋ 肩の縫い目 */
      var hood = U.mesh(THREE, new THREE.CylinderGeometry(0.105, 0.150, 0.20, 14, 1, true), P.rubber, 0, 2.06, 0.005);
      hood.scale.set(1, 1, 0.82); body.add(hood);
      [-1, 1].forEach(function (s) {
        body.add(U.seg(THREE, P.rubberWet, [s * 0.02, 2.02, 0.02], [s * 0.175, 1.98, 0.0], 0.012, 0.010, 6));
      });
      /* 首（細い・腱が浮く） */
      body.add(U.seg(THREE, P.skin, [0, 1.99, 0.01], [0, 2.14, 0.0], 0.048, 0.042, 9));

      /* ---- 腕（両腕とも垂れる。前腕は素肌＋手袋の名残） ---- */
      limb(THREE, P, body, { a: [-0.175, 1.97, 0.00], b: [-0.225, 1.55, 0.04], c: [-0.215, 1.12, -0.03], r0: 0.048, r1: 0.038, r2: 0.030, sleeve: 1, bare: 1, glove: 1, seed: 5, curl: 0.30 });
      limb(THREE, P, body, { a: [0.175, 1.97, 0.00], b: [0.235, 1.54, 0.03], c: [0.225, 1.10, -0.05], r0: 0.048, r1: 0.038, r2: 0.030, sleeve: 1, bare: 1, glove: 1, seed: 9, curl: 0.22 });
      /* ---- 脚（防護服のズボン。脛は裂けて素肌） ---- */
      limb(THREE, P, body, { a: [-0.085, 1.20, 0.01], b: [-0.095, 0.66, -0.01], c: [-0.090, 0.12, 0.01], r0: 0.070, r1: 0.052, r2: 0.042, sleeve: 1, foot: 1, seed: 13 });
      limb(THREE, P, body, { a: [0.090, 1.20, 0.02], b: [0.105, 0.66, 0.00], c: [0.100, 0.12, 0.02], r0: 0.070, r1: 0.052, r2: 0.042, sleeve: 1, foot: 1, seed: 17 });

      /* ---- 頭（体は右へ 49° 捻れているが、首だけ回してこちらを向く） ---- */
      var head = global.__A2_H_HEAD(THREE);
      head.position.set(0, 2.25, 0.0); head.rotation.set(0.06, -0.96, 0.06); head.scale.setScalar(1.14);
      head.name = 'HEAD'; body.add(head);
      return g;
    },
    cams: {
      full: { pos: [-1.02, 1.44, -3.05], look: [0.02, 1.24, 0.08] },
      face: { pos: [0.13, 2.37, -1.00], look: [0.00, 2.22, 0.02] }
    }
  };
})(typeof window !== 'undefined' ? window : this);
