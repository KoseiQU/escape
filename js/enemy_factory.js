/* ESCAPE — P5e-2a エリア2の敵: 生成の窓口＋本番モデルの共有土台
 * 契約 DESIGN.md §4「P5e-2」。
 *
 *  ESCAPE.EnemyFactory.create(kind, opts)
 *      kind 'A1' … 既存 ESCAPE.Enemy（エリア1の実験体。挙動は完全に不変）
 *      kind 'D' | 'E' | 'F' … ESCAPE.EnemyModelsA2[kind]（本ファイルの Base を継承）
 *      未登録の kind は 'A1' に落として console.warn（レーン分割中も壊れない）
 *
 *  ESCAPE.EnemyA2 … D/E/F が共有する「彫るための道具」と Base クラス。
 *    - 彫り方は audit/enemy-mocks-a2/3d/index.html の __A2LIB（P5e-1 で目視合格した造形の正）
 *      からの移植。モックのファイルには一切依存しない（本番は自己完結）。
 *    - 材質は MeshStandardMaterial（プロシージャルなアルベド＋法線＋粗さ）。
 *      世界の実ライト（RQ の近傍灯）で彫刻が立つ。暗がりでの視認性は syncLight が
 *      emissive の下限で担保する（契約「顔は闇の中で浮かぶ」＝ステルスの情報源）。
 *    - インターフェースは js/enemy_model.js の ESCAPE.Enemy と同一。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var THREE = global.THREE;

  var A2 = ESCAPE.EnemyA2 = {};

  /* ================= 決定的乱数・小道具 ================= */
  function rng(seed) {
    var s = (seed | 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return ((s >>> 0) % 1e5) / 1e5; };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  A2.rng = rng; A2.clamp = clamp; A2.smooth01 = smooth01;

  /* ================= プロシージャル材質 ================= */
  /* テクスチャは重いので「同じ設定なら使い回す」。dispose では捨てない（共有物） */
  var texCache = Object.create(null);

  function sobelMaps(cv, bump, roughLo, roughHi) {
    var w = cv.width, h = cv.height;
    var px = cv.getContext('2d').getImageData(0, 0, w, h).data;
    var lum = new Float32Array(w * h), i, o;
    for (i = 0; i < w * h; i++) { o = i * 4; lum[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255; }
    var nrm = new Uint8Array(w * h * 4), rgh = new Uint8Array(w * h * 4);
    for (var y = 0; y < h; y++) {
      var ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, y0 = y * w;
      for (var x = 0; x < w; x++) {
        var xm = (x - 1 + w) % w, xp = (x + 1) % w;
        var gx = (lum[ym + xp] + 2 * lum[y0 + xp] + lum[yp + xp]) - (lum[ym + xm] + 2 * lum[y0 + xm] + lum[yp + xm]);
        var gy = (lum[yp + xm] + 2 * lum[yp + x] + lum[yp + xp]) - (lum[ym + xm] + 2 * lum[ym + x] + lum[ym + xp]);
        var nx = -gx * bump, ny = -gy * bump, il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        o = (y0 + x) * 4;
        nrm[o] = (nx * il * 0.5 + 0.5) * 255; nrm[o + 1] = (ny * il * 0.5 + 0.5) * 255;
        nrm[o + 2] = (il * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
        var rv = roughHi + (roughLo - roughHi) * lum[y0 + x];
        rgh[o] = 255; rgh[o + 1] = (clamp(rv, 0, 1) * 255) | 0; rgh[o + 2] = 255; rgh[o + 3] = 255;
      }
    }
    function dt(buf) {
      var t = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.anisotropy = 4; t.flipY = true; t.needsUpdate = true; return t;
    }
    return { normalMap: dt(nrm), roughnessMap: dt(rgh) };
  }

  /** 皮膚/骨/布のアルベド: 斑・血管・皺・毛穴 */
  function skinCanvas(o) {
    var S = o.size || 256, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var c = cv.getContext('2d'), R = rng(o.seed || 7), i, n;
    c.fillStyle = o.base || '#8f9490'; c.fillRect(0, 0, S, S);
    for (i = 0, n = o.mottle === undefined ? 120 : o.mottle; i < n; i++) {
      var mx = R() * S, my = R() * S, mr = S * (0.02 + R() * 0.09);
      var g = c.createRadialGradient(mx, my, 0, mx, my, mr), a = 0.05 + R() * 0.14;
      g.addColorStop(0, (R() < 0.45 ? o.dark || 'rgba(52,56,54,' : 'rgba(178,176,160,') + a + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(mx, my, mr, 0, 6.284); c.fill();
    }
    c.lineCap = 'round';
    for (i = 0, n = o.vein === undefined ? 46 : o.vein; i < n; i++) {
      var x = R() * S, y = R() * S, ang = R() * 6.284, seg = 4 + (R() * 6 | 0);
      c.strokeStyle = o.veinColor || 'rgba(74,62,86,0.30)';
      c.lineWidth = 0.7 + R() * 1.9;
      c.beginPath(); c.moveTo(x, y);
      for (var k = 0; k < seg; k++) {
        ang += (R() - 0.5) * 1.3; x += Math.cos(ang) * S * 0.028; y += Math.sin(ang) * S * 0.028; c.lineTo(x, y);
      }
      c.stroke();
    }
    for (i = 0, n = o.wrinkle === undefined ? 220 : o.wrinkle; i < n; i++) {
      var wx = R() * S, wy = R() * S, wa = R() * 6.284, wl = S * (0.01 + R() * 0.05);
      c.strokeStyle = R() < 0.5 ? 'rgba(30,30,28,0.34)' : 'rgba(205,205,192,0.20)';
      c.lineWidth = 0.5 + R() * 0.9;
      c.beginPath(); c.moveTo(wx, wy);
      c.quadraticCurveTo(wx + Math.cos(wa + 0.6) * wl, wy + Math.sin(wa + 0.6) * wl,
        wx + Math.cos(wa) * wl * 2, wy + Math.sin(wa) * wl * 2);
      c.stroke();
    }
    var img = c.getImageData(0, 0, S, S), d = img.data;
    for (i = 0, n = (o.pore === undefined ? 0.30 : o.pore) * S * S; i < n; i++) {
      var p = ((R() * S | 0) + (R() * S | 0) * S) * 4, v = (R() - 0.5) * 46;
      d[p] = clamp(d[p] + v, 0, 255); d[p + 1] = clamp(d[p + 1] + v, 0, 255); d[p + 2] = clamp(d[p + 2] + v, 0, 255);
    }
    c.putImageData(img, 0, 0);
    return cv;
  }
  A2.skinCanvas = skinCanvas;

  /** 皮膚材質（アルベド＋法線＋粗さ）。同じ seed/寸法ならテクスチャを共有する。 */
  A2.skin = function (o) {
    o = o || {};
    var key = 'sk' + (o.seed || 7) + '_' + (o.size || 256) + '_' + (o.base || '') + '_' + (o.bump || '') +
      '_' + (o.roughLo || '') + '_' + (o.roughHi || '') + '_' + (o.mottle || '') + '_' + (o.vein || '') +
      '_' + (o.repeat ? o.repeat[0] + 'x' + o.repeat[1] : '1');
    var set = texCache[key];
    if (!set) {
      var cv = skinCanvas(o);
      var map = new THREE.CanvasTexture(cv);
      map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
      if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
      var mm = sobelMaps(cv, o.bump === undefined ? 2.6 : o.bump,
        o.roughLo === undefined ? 0.34 : o.roughLo, o.roughHi === undefined ? 0.86 : o.roughHi);
      set = texCache[key] = { map: map, normalMap: mm.normalMap, roughnessMap: mm.roughnessMap };
      if (o.repeat) {
        /* 繰り返しは「テクスチャごと」に持たせる（材質を跨いで共有しても崩れない） */
        set.map.repeat.set(o.repeat[0], o.repeat[1]);
        set.normalMap.repeat.copy(set.map.repeat);
        set.roughnessMap.repeat.copy(set.map.repeat);
      }
    }
    var m = new THREE.MeshStandardMaterial({
      map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap,
      color: new THREE.Color(o.tint === undefined ? 0xffffff : o.tint),
      roughness: 1, metalness: o.metalness === undefined ? 0.02 : o.metalness,
      emissive: new THREE.Color(0, 0, 0), emissiveMap: set.map,
      side: o.side || THREE.FrontSide, fog: true
    });
    var ns = o.nscale === undefined ? 1 : o.nscale;
    m.normalScale = new THREE.Vector2(ns, ns);
    m.userData.a2rep = o.repeat || null;
    return m;
  };

  /** 単色材質（骨・歯・肉・金属・髪） */
  A2.mat = function (hex, rough, metal, o) {
    o = o || {};
    var m = new THREE.MeshStandardMaterial({
      color: hex, roughness: rough === undefined ? 0.8 : rough,
      metalness: metal === undefined ? 0 : metal,
      emissive: new THREE.Color(0, 0, 0),
      side: o.side || THREE.FrontSide, fog: true
    });
    if (o.flat) m.flatShading = true;
    return m;
  };

  /* ================= 彫るためのジオメトリ道具 ================= */
  A2.ell = function (rx, ry, rz, seg, segY) {
    var g = new THREE.SphereGeometry(1, seg || 12, segY || Math.max(4, Math.round((seg || 12) * 0.68)));
    g.scale(rx, ry, rz);
    return g;
  };

  A2.deform = function (g, fn) {
    var p = g.attributes.position, a = p.array, o = [0, 0, 0];
    for (var i = 0; i < a.length; i += 3) {
      o[0] = a[i]; o[1] = a[i + 1]; o[2] = a[i + 2];
      fn(a[i], a[i + 1], a[i + 2], o);
      a[i] = o[0]; a[i + 1] = o[1]; a[i + 2] = o[2];
    }
    p.needsUpdate = true; g.computeVertexNormals(); return g;
  };

  /** 球状の隆起／窪み（中心 c・半径 r の範囲を法線方向へ amp） */
  A2.bulge = function (g, c, r, amp, dir) {
    return A2.deform(g, function (x, y, z, o) {
      var dx = x - c[0], dy = y - c[1], dz = z - c[2];
      var d2 = dx * dx + dy * dy + dz * dz, r2 = r * r;
      if (d2 > r2) return;
      var t = 1 - d2 / r2; t = t * t;
      var n = dir || [x, y, z], nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
      o[0] = x + n[0] / nl * amp * t; o[1] = y + n[1] / nl * amp * t; o[2] = z + n[2] / nl * amp * t;
    });
  };

  /** 線分 a-b に沿った稜／溝（眉弓・頬骨弓・鼻梁・腱・裂け目） */
  A2.ridge = function (g, a, b, r, amp, pow, dir) {
    var ax = a[0], ay = a[1], az = a[2];
    var bx = b[0] - ax, by = b[1] - ay, bz = b[2] - az;
    var bl = bx * bx + by * by + bz * bz || 1e-9, r2 = r * r, pw = pow || 2;
    return A2.deform(g, function (x, y, z, o) {
      var t = ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / bl;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var dx = x - (ax + bx * t), dy = y - (ay + by * t), dz = z - (az + bz * t);
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) return;
      var w = Math.pow(1 - d2 / r2, pw);
      var n = dir || [x, y, z], nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
      o[0] = x + n[0] / nl * amp * w; o[1] = y + n[1] / nl * amp * w; o[2] = z + n[2] / nl * amp * w;
    });
  };

  /** 全体の有機的な揺らぎ（左右対称を壊す） */
  A2.warp = function (g, amp, freq, seed) {
    var R = rng(seed || 3), ox = R() * 10, oy = R() * 10, oz = R() * 10;
    function n(x, y, z) {
      return Math.sin(x * freq + ox) * Math.cos(y * freq * 1.3 + oy) * Math.sin(z * freq * 0.8 + oz);
    }
    return A2.deform(g, function (x, y, z, o) {
      o[0] = x + n(x, y, z) * amp; o[1] = y + n(y + 3.1, z, x) * amp * 0.7; o[2] = z + n(z, x + 1.7, y) * amp;
    });
  };

  /** 円錐台（指の節・肢の節・柄）。原点＝下端、+Y へ伸びる */
  A2.seg = function (r0, r1, len, rad) {
    var g = new THREE.CylinderGeometry(r1, r0, len, rad || 6, 1, false);
    g.translate(0, len / 2, 0);
    return g;
  };

  /** 折れ線を太さつきの管にする（鎖・腱・髪の房・唇の縁） */
  A2.tube = function (pts, r, rad, closed, segMul) {
    var v = [];
    for (var i = 0; i < pts.length; i++) v.push(new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2]));
    var curve = new THREE.CatmullRomCurve3(v, !!closed);
    return new THREE.TubeGeometry(curve, Math.max(5, Math.round(v.length * (segMul || 1.6))), r, rad || 5, !!closed);
  };

  /** 2本の折れ線の間を帯で埋める（裂け目の内壁・骨の断面） */
  A2.strip = function (A, B) {
    var n = Math.min(A.length, B.length), pos = new Float32Array(n * 6), idx = [], i;
    for (i = 0; i < n; i++) {
      pos[i * 6] = A[i][0]; pos[i * 6 + 1] = A[i][1]; pos[i * 6 + 2] = A[i][2];
      pos[i * 6 + 3] = B[i][0]; pos[i * 6 + 4] = B[i][1]; pos[i * 6 + 5] = B[i][2];
    }
    for (i = 0; i < n - 1; i++) { var o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };

  /** 頭蓋の殻（脳頭蓋・眉弓・眼窩・こめかみ・頬骨弓・梨状口・上下顎・顎先） */
  A2.headShell = function (P) {
    P = P || {};
    var rx = P.rx || 0.105, ry = P.ry || 0.138, rz = P.rz || 0.124;
    var seg = P.seg || 44;
    var g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.68)));
    g.scale(rx, ry, rz);
    var jaw = P.jaw === undefined ? 1 : P.jaw;
    A2.deform(g, function (x, y, z, o) {
      var ny = y / ry, nz = z / rz;
      var kx = 1 - 0.40 * jaw * Math.pow(Math.max(0, -ny), 1.6) - 0.06 * Math.pow(Math.max(0, ny), 2);
      var kz = nz < 0 ? 1 - 0.15 * nz * nz : 1 + 0.13 * nz * nz;
      o[0] = x * kx;
      o[2] = z * kz * (1 - 0.32 * jaw * Math.pow(Math.max(0, -ny), 1.8));
      o[1] = y - 0.24 * ry * jaw * Math.pow(Math.max(0, -ny), 2.0);
    });
    var S = P.socket === undefined ? 0.030 : P.socket;
    var E = P.eye === undefined ? 0.010 : P.eye;
    var B = P.brow === undefined ? 0.011 : P.brow;
    var ex = rx * 0.48, ey = ry * 0.03, ez = -rz * 0.81;
    A2.ridge(g, [rx * 0.06, ry * 0.26, -rz * 0.87], [rx * 0.80, ry * 0.22, -rz * 0.49], rx * 0.29, B, 1.6);
    A2.ridge(g, [-rx * 0.06, ry * 0.22, -rz * 0.87], [-rx * 0.77, ry * 0.15, -rz * 0.49], rx * 0.27, B * 0.88, 1.6);
    A2.bulge(g, [ex, ey, ez], rx * 0.47, -S);
    A2.bulge(g, [-ex * 0.96, ey - ry * 0.06, ez], rx * 0.45, -S * 1.10);
    if (E > 0) {
      A2.bulge(g, [ex, ey, ez], rx * 0.30, E);
      A2.bulge(g, [-ex * 0.96, ey - ry * 0.06, ez], rx * 0.28, E * 0.92);
    }
    var T = P.temple === undefined ? 0.015 : P.temple;
    A2.bulge(g, [rx * 0.94, ry * 0.26, -rz * 0.34], rx * 0.53, -T);
    A2.bulge(g, [-rx * 0.93, ry * 0.20, -rz * 0.36], rx * 0.50, -T * 1.25);
    A2.ridge(g, [rx * 0.99, -ry * 0.04, -rz * 0.08], [rx * 0.55, -ry * 0.10, -rz * 0.70], rx * 0.23, 0.0105, 1.8);
    A2.ridge(g, [-rx * 0.98, -ry * 0.10, -rz * 0.06], [-rx * 0.53, -ry * 0.16, -rz * 0.70], rx * 0.22, 0.0095, 1.8);
    var C = P.cheek === undefined ? 0.017 : P.cheek;
    A2.bulge(g, [rx * 0.63, -ry * 0.42, -rz * 0.63], rx * 0.44, -C);
    A2.bulge(g, [-rx * 0.60, -ry * 0.46, -rz * 0.61], rx * 0.42, -C * 1.15);
    var N = P.nose === undefined ? 0.013 : P.nose;
    A2.ridge(g, [0.001, ry * 0.19, -rz * 0.86], [0.003, -ry * 0.35, -rz * 0.87], rx * 0.17, N, 2.2);
    A2.bulge(g, [0.002, ry * 0.07, -rz * 0.90], rx * 0.13, -N * 0.6);
    A2.bulge(g, [0.002, -ry * 0.45, -rz * 0.84], rx * 0.22, -N * 1.7);
    A2.ridge(g, [rx * 0.38, -ry * 0.55, -rz * 0.69], [-rx * 0.38, -ry * 0.58, -rz * 0.69], rx * 0.25, 0.0080, 1.5);
    A2.ridge(g, [rx * 0.79, -ry * 0.26, -rz * 0.15], [rx * 0.50, -ry * 0.88, -rz * 0.50], rx * 0.23, 0.0105, 1.7);
    A2.ridge(g, [-rx * 0.77, -ry * 0.32, -rz * 0.13], [-rx * 0.48, -ry * 0.92, -rz * 0.48], rx * 0.22, 0.0095, 1.7);
    var CH = P.chin === undefined ? 0.011 : P.chin;
    A2.ridge(g, [rx * 0.50, -ry * 0.88, -rz * 0.50], [-rx * 0.48, -ry * 0.92, -rz * 0.48], rx * 0.16, CH * 0.55, 1.5);
    A2.bulge(g, [0.002, -ry * 0.95, -rz * 0.60], rx * 0.29, CH);
    A2.bulge(g, [0, ry * 0.18, rz * 0.92], rx * 0.62, 0.006);
    A2.warp(g, P.warp === undefined ? 0.0026 : P.warp, 15, P.seed || 6);
    return g;
  };

  /* ================================================================
   * Base — D/E/F が共有する骨組み
   *  インターフェースは ESCAPE.Enemy と同一（enemy_ai.js / capture.js が
   *  種類を意識しないで扱えること）。造形とポーズだけ派生クラスが持つ。
   * ============================================================== */

  /* 暗がりでの見え方（emissive の下限/傾き/上限）。
     契約: 顔は闇でも読める／眼窩と口腔は光っても闇のまま／捕獲演出中だけ顔を底上げ。 */
  var LIT = {
    body: { min: 0.020, gain: 0.46, max: 0.150, cine: [0.055, 0.230] },
    face: { min: 0.062, gain: 0.72, max: 0.300, cine: [0.135, 0.460] },
    tooth: { min: 0.040, gain: 0.52, max: 0.210, cine: [0.100, 0.330] },
    cloth: { min: 0.014, gain: 0.38, max: 0.120, cine: [0.036, 0.180] },
    hair: { min: 0.007, gain: 0.22, max: 0.070, cine: [0.018, 0.100] },
    metal: { min: 0.012, gain: 0.44, max: 0.140, cine: [0.034, 0.200] },
    flesh: { min: 0.016, gain: 0.34, max: 0.110, cine: [0.048, 0.190] },
    hollow: { min: 0.000, gain: 0.00, max: 0.000, cine: [0.000, 0.000] }
  };
  A2.LIT = LIT;

  function Base(opts) {
    opts = opts || {};
    this.seed = opts.seed || 1;
    this.kind = 'A2';
    this.group = new THREE.Group();
    this.group.name = 'enemyA2';
    this.nodes = {};
    this.mats = {};
    this.contacts = [];
    this.disposables = [];
    this.litMats = [];
    this.lodHi = [];            /* 低詳細で消す飾り */
    this.lodSwap = [];          /* {mesh, hi, lo} ジオメトリ差し替え */
    this.triangles = 0;
    this.extraTriangles = 0;
    this._countExtra = false;
    this.detail = 'normal';
    this.detailHi = false;
    this.lowDetail = false;
    this.poseT = 0;
    this.state = 'idle';
    this.transDir = 1;
    this.transTime = 0;
    this.transDur = 1.20;
    this.animTime = 0;
    this.groundSnap = false;    /* 派生が接地補正を要るときだけ true */
    this.facing = 0;
    this.x = 0; this.z = 0; this.floorY = 0;
    this.ceilFit = true;
    this.ceilH = 2.40;          /* placeAt が map から読み直す（D の天井這いが使う） */
    this.map = null;
    this.scale = 1;
    this.poseExtra = null;
    this.skirtReach = 0.6;
    this._amb = { r: 0.02, g: 0.02, b: 0.03 };
    this._shadeOut = [0, 0, 0];
    this._pose = {};
    this._tmp = new THREE.Vector3();
    this.eyes = null;
    this.grabHands = null;
    this.maw = null;
  }

  Base.prototype._track = function (o) { this.disposables.push(o); return o; };

  /** lod=1 のメッシュは setDetail('lo') で消える飾り */
  Base.prototype._mesh = function (geo, mat, parent, name, lod) {
    var m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    if (name) m.name = name;
    parent.add(m);
    this._track(geo);
    var tri = geo.index ? (geo.index.count / 3) : (geo.attributes.position.count / 3);
    if (this._countExtra) this.extraTriangles += tri; else this.triangles += tri;
    if (lod) this.lodHi.push(m);
    return m;
  };

  Base.prototype._node = function (name, parent, x, y, z) {
    var g = new THREE.Group();
    g.name = name;
    g.position.set(x || 0, y || 0, z || 0);
    parent.add(g);
    this.nodes[name] = g;
    return g;
  };

  /** 材質を「暗がりの見え方」の系統に登録する（syncLight が毎フレーム emissive を書く） */
  Base.prototype._lit = function (mat, prof) {
    mat.userData.a2lit = prof;
    this.litMats.push(mat);
    this._track(mat);
    return mat;
  };

  /** 体格倍率。天井が低い区画では上限を掛ける（直立形態だけ・這いは無関係） */
  Base.prototype.topHeight = function () { return 2.0; };
  Base.prototype.scaleTarget = function () {
    if (!this.ceilFit || !this.map || !this.map.ceilHAt) return 1;
    var col = this.map.colOf(this.x), row = this.map.rowOf(this.z);
    if (!this.map.inBounds || !this.map.inBounds(col, row)) return 1;
    var room = this.map.ceilHAt(col, row) - 0.10;
    var top = this.topHeight();
    if (!(top > 0)) return 1;
    var lim = room / top;
    return lim < 1 ? Math.max(0.55, lim) : 1;
  };

  /** 姿勢の線形ブレンド（配列＝オイラー3成分・数値＝スカラー） */
  function blendPose(A, B, u, out) {
    out = out || {};
    for (var k in A) {
      var a = A[k], b = (B && B[k] !== undefined) ? B[k] : a;
      if (typeof a === 'number') { out[k] = a + (b - a) * u; continue; }
      var o = out[k] || (out[k] = [0, 0, 0]);
      o[0] = a[0] + (b[0] - a[0]) * u;
      o[1] = a[1] + (b[1] - a[1]) * u;
      o[2] = a[2] + (b[2] - a[2]) * u;
    }
    return out;
  }
  A2.blendPose = blendPose;

  Base.prototype.applyPose = function (u, extra) {
    var p = blendPose(this.POSE_STAND, this.POSE_CRAWL, u, this._pose);
    if (extra) extra(p, u);
    if (this.poseExtra) this.poseExtra(p, u, this.animTime);
    var n = this.nodes;
    for (var k in p) {
      var v = p[k];
      if (typeof v === 'number') continue;
      var nd = n[k];
      if (nd) nd.rotation.set(v[0], v[1], v[2]);
    }
    if (this._applyScalars) this._applyScalars(p, u);
    this.group.position.set(this.x, this.floorY, this.z);
    this.group.rotation.y = this.facing;
    this.group.scale.set(this.scale, this.scale, this.scale);
    this.group.updateMatrixWorld(true);
    if (this.groundSnap) this._snap();
  };

  /** 接地補正: 接点のうち最も低いものを床に合わせる（使うのは床形態だけ） */
  Base.prototype._snap = function () {
    var lowest = Infinity, v = this._tmp, i;
    for (i = 0; i < this.contacts.length; i++) {
      this.contacts[i].getWorldPosition(v);
      if (v.y < lowest) lowest = v.y;
    }
    if (!isFinite(lowest)) return;
    var d = this.floorY - lowest;
    if (Math.abs(d) > 1e-4) { this.group.position.y += d; this.group.updateMatrixWorld(true); }
  };

  Base.prototype.update = function (dt, time) {
    if (!isFinite(dt)) dt = 0;
    this.animTime = (typeof time === 'number') ? time : (this.animTime + dt);
    var raw = 0, inTrans = false;
    if (this.state === 'trans') {
      this.transTime += dt;
      var u0 = Math.min(1, this.transTime / this.transDur);
      raw = u0; inTrans = true;
      var e = this.transEase ? this.transEase(u0) : smooth01(u0);
      this.poseT = (this.transDir > 0) ? e : (1 - e);
      if (u0 >= 1) {
        this.poseT = (this.transDir > 0) ? 1 : 0;
        this.state = (this.transDir > 0) ? 'chase' : 'walk';
      }
    }
    var want = this.scaleTarget();
    if (!(dt > 0)) this.scale = want;
    else this.scale += (want - this.scale) * (1 - Math.exp(-4.0 * dt));
    var self = this, t = this.animTime, st = this.state;
    this.applyPose(this.poseT, function (p, u) {
      if (self._animate) self._animate(p, u, t, st, inTrans, raw);
    });
    if (this._secondary) this._secondary(t, dt, st);
  };

  Base.prototype.setForm = function (form, instant) {
    var want = (form === 'crawl' || form === 1) ? 1 : 0;
    if (instant) {
      this.poseT = want;
      this.state = want ? 'chase' : 'walk';
      this.transTime = 0;
      return;
    }
    if (this.poseT === want && this.state !== 'trans') return;
    this.transDir = want ? 1 : -1;
    this.transTime = 0;
    this.state = 'trans';
  };

  Base.prototype.placeAt = function (x, z, yawRad, map) {
    this.x = x; this.z = z;
    if (map) this.map = map;
    this.floorY = this.map ? this.map.floorYAt(x, z) : 0;
    if (this.map && this.map.ceilHAt) {
      var col = this.map.colOf(x), row = this.map.rowOf(z);
      if (!this.map.inBounds || this.map.inBounds(col, row)) this.ceilH = this.map.ceilHAt(col, row);
    }
    if (typeof yawRad === 'number') this.facing = yawRad;
    this.scale = this.scaleTarget();
    this.applyPose(this.poseT);
  };

  Base.prototype.placeCell = function (col, row, yawDeg, map) {
    var c = map.cellCenter(col, row);
    this.placeAt(c.x, c.z, (yawDeg || 0) * Math.PI / 180, map);
  };

  Base.prototype.dispose = function () {
    for (var i = 0; i < this.disposables.length; i++) {
      var d = this.disposables[i];
      if (d && d.dispose) d.dispose();
    }
    this.disposables.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.grabHands && this.grabHands.parent) this.grabHands.parent.remove(this.grabHands);
    if (this.maw && this.maw.group.parent) this.maw.group.parent.remove(this.maw.group);
  };

  /** 環境光を材質へ。実ライトの上に「闇でも読める下限」を emissive で足す。 */
  Base.prototype.syncLight = function (world, map) {
    var r = 0.02, g = 0.02, b = 0.03;
    if (world && world.lightIndex && world._shade) {
      var col = map ? map.colOf(this.x) : 0, row = map ? map.rowOf(this.z) : 0;
      var key = world._ownerOf ? world._ownerOf(col, row) : (col + ',' + row);
      var out = world._shade(this.x, this.floorY + 0.10, this.z, 0, 1, 0, key, undefined, this._shadeOut);
      r = out[0]; g = out[1]; b = out[2];
    }
    this._amb.r = r; this._amb.g = g; this._amb.b = b;
    var lum = 0.30 * r + 0.59 * g + 0.11 * b;
    var mx = Math.max(r, Math.max(g, b)) + 1e-5;
    var tr = 0.62 + 0.38 * (r / mx), tg = 0.62 + 0.38 * (g / mx), tb = 0.62 + 0.38 * (b / mx);
    var cine = this.detailHi;
    var breathe = 0.94 + 0.06 * Math.sin(this.animTime * 0.9);
    for (var i = 0; i < this.litMats.length; i++) {
      var m = this.litMats[i], P = LIT[m.userData.a2lit] || LIT.body;
      var lo = cine ? P.cine[0] : P.min, hi = cine ? P.cine[1] : P.max;
      var k = clamp(lo + lum * P.gain, lo, hi);
      if (m.userData.a2lit === 'face') k *= breathe;
      m.emissive.setRGB(k * tr, k * tg, k * tb);
    }
  };

  /* ---------------- 眼窩の奥の微光（D・E の「赤い目」の読み替え） ----------------
   * 契約「眼にハイライト無し」なので、光るのは眼球ではなく**眼窩の奥の空気**。
   * 縁へ向かって 0 に落ちる加算スプライトを眼窩の底へ沈める（円盤の輪郭を作らない）。 */
  var glowCache = null;
  A2.glowTex = function () {
    if (glowCache) return glowCache;
    var S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    var x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data;
    for (var j = 0; j < S; j++) {
      for (var i = 0; i < S; i++) {
        var u = (i + 0.5) / S * 2 - 1, v = (j + 0.5) / S * 2 - 1;
        var t = Math.sqrt(u * u + v * v);
        var a = t >= 1 ? 0 : Math.pow(1 - t, 2.4) * smooth01((t - 0.02) / 0.10);
        var w = 1 - Math.min(t, 1), o = (j * S + i) * 4;
        d[o] = (120 + 96 * w * w) | 0;
        d[o + 1] = (8 + 38 * w * w * w) | 0;
        d[o + 2] = (6 + 24 * w * w * w) | 0;
        d[o + 3] = (a * 255) | 0;
      }
    }
    x.putImageData(img, 0, 0);
    var t2 = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t2.colorSpace = THREE.SRGBColorSpace;
    t2.wrapS = t2.wrapT = THREE.ClampToEdgeWrapping;
    t2.minFilter = THREE.LinearMipmapLinearFilter; t2.magFilter = THREE.LinearFilter;
    t2.needsUpdate = true;
    glowCache = t2;
    return t2;
  };

  /** spots: [{p:[x,y,z], r, k, f1, f2, ph}] （頭のローカル座標） */
  Base.prototype._buildSocketGlow = function (parent, spots) {
    if (this.eyes) return this.eyes;
    this._countExtra = true;
    var t0 = this.extraTriangles;
    this.eyes = new THREE.Group();
    this.eyes.name = 'socketGlow';
    this.eyes.visible = false;
    this.eyeSprites = [];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      for (var L = 0; L < 2; L++) {
        var mat = this._track(new THREE.SpriteMaterial({
          map: A2.glowTex(), color: 0xffffff, fog: true, transparent: true,
          opacity: (L ? 0.30 : 0.62) * (s.k === undefined ? 1 : s.k),
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        var sp = new THREE.Sprite(mat);
        sp.frustumCulled = false;
        sp.renderOrder = 6 + L;
        var rr = s.r * (L ? 2.05 : 1.0);
        sp.scale.set(rr * 2, rr * 2, 1);
        sp.position.set(s.p[0], s.p[1], s.p[2]);
        sp.userData.base = mat.opacity;
        sp.userData.f1 = s.f1 || (2.1 + i * 0.9);
        sp.userData.f2 = s.f2 || (0.83 + i * 0.37);
        sp.userData.ph = s.ph || i * 1.7;
        this.eyes.add(sp);
        this.eyeSprites.push(sp);
        this.extraTriangles += 2;
      }
    }
    parent.add(this.eyes);
    this._eyeTris = this.extraTriangles - t0;
    this._countExtra = false;
    return this.eyes;
  };

  /** 'hi'（捕獲演出）/ 'normal'（既定＝高詳細）/ 'lo'（低詳細・fallback段階） */
  Base.prototype.setDetail = function (level) {
    var hi = (level === 'hi' || level === true);
    var lo = (level === 'lo' || level === 'low');
    this.detailHi = hi;
    this.lowDetail = lo;
    this.detail = hi ? 'hi' : (lo ? 'lo' : 'normal');
    var i;
    for (i = 0; i < this.lodHi.length; i++) this.lodHi[i].visible = !lo;
    for (i = 0; i < this.lodSwap.length; i++) {
      var s = this.lodSwap[i];
      s.mesh.geometry = lo ? s.lo : s.hi;
    }
    if (hi && this._makeEyes && !this.eyes) this._makeEyes();
    if (this.eyes) this.eyes.visible = hi;
    if (this._onDetail) this._onDetail(this.detail);
    return this.detailHi;
  };

  Base.prototype.redEyesVisible = function () {
    return !!(this.eyes && this.eyes.visible && this.detailHi);
  };

  /** いま実際に描かれている三角形数（見えているものだけ数える＝実測値） */
  function countVisible(obj) {
    if (!obj || !obj.visible) return 0;
    var n = 0;
    if (obj.isMesh && obj.geometry) {
      var g = obj.geometry;
      n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    } else if (obj.isSprite) n += 2;
    for (var i = 0; i < obj.children.length; i++) n += countVisible(obj.children[i]);
    return n;
  }
  Base.prototype.activeTriangles = function () {
    var vis = this.group.visible;
    this.group.visible = true;                 /* 収納中でも「この体の量」を測れるように */
    var n = countVisible(this.group);
    this.group.visible = vis;
    if (this.grabHands && !this.grabHands.parent) n += 0;
    else if (this.grabHands) n += countVisible(this.grabHands);
    if (this.maw && this.maw.group.parent) n += countVisible(this.maw.group);
    return Math.round(n);
  };

  Base.prototype.pulseEyes = function (t, k) {
    if (!this.eyes || !this.eyes.visible || !this.eyeSprites) return;
    var kk = (k === undefined ? 1 : k);
    for (var i = 0; i < this.eyeSprites.length; i++) {
      var sp = this.eyeSprites[i], u = sp.userData;
      var a = 0.74 + 0.26 * Math.sin(t * u.f1) * Math.sin(t * u.f2 + u.ph);
      sp.material.opacity = u.base * a * kk;
    }
  };

  Base.prototype.createGrabHands = function () {
    if (this.grabHands) return this.grabHands;
    this._countExtra = true;
    var t0 = this.extraTriangles;
    this.grabHands = this._makeGrabHands();
    this.grabHands.visible = false;
    this._handTris = this.extraTriangles - t0;
    this._countExtra = false;
    return this.grabHands;
  };

  Base.prototype.createMaw = function () {
    if (this.maw) return this.maw;
    this._countExtra = true;
    var t0 = this.extraTriangles;
    this.maw = this._makeMaw();
    this.maw.group.visible = false;
    this._mawTris = this.extraTriangles - t0;
    this._countExtra = false;
    return this.maw;
  };

  /** 派生クラスを作る（prototype 継承の定型） */
  A2.extend = function (ctor) {
    ctor.prototype = Object.create(Base.prototype);
    ctor.prototype.constructor = ctor;
    return ctor;
  };
  A2.Base = Base;

  /* ================================================================
   * EnemyFactory — 生成の唯一の窓口
   * ============================================================== */
  ESCAPE.EnemyModelsA2 = ESCAPE.EnemyModelsA2 || {};

  /**
   * @param {string} kind 'A1'|'D'|'E'|'F'（opts.kind が優先。未指定は 'A1'）
   * @param {object} opts { seed, kind, ... } — そのまま実装のコンストラクタへ渡す
   */
  function create(kind, opts) {
    opts = opts || {};
    var k = opts.kind || kind || 'A1';
    if (k !== 'A1') {
      var M = ESCAPE.EnemyModelsA2 && ESCAPE.EnemyModelsA2[k];
      if (M) {
        var e = new M(opts);
        e.kind = k;
        return e;
      }
      /* レーン分割中・読み込み失敗でも「敵が居ない」にはしない（A1 で代替する） */
      if (global.console && console.warn) {
        console.warn('[EnemyFactory] 未登録の敵 kind="' + k + '" → A1 で代替');
      }
    }
    var a = new ESCAPE.Enemy(opts);
    a.kind = 'A1';
    return a;
  }

  ESCAPE.EnemyFactory = {
    create: create,
    /** 生成できる種類（機械テスト用） */
    kinds: function () {
      var out = ['A1'], m = ESCAPE.EnemyModelsA2 || {};
      for (var k in m) if (m[k]) out.push(k);
      return out;
    },
    has: function (k) { return k === 'A1' || !!(ESCAPE.EnemyModelsA2 && ESCAPE.EnemyModelsA2[k]); }
  };
})(window);
