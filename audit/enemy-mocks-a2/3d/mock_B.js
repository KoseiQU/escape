/* ESCAPE — P5e-0 案B「盲目の聴覚型」3Dコンセプトモック
 * 2.2m の痩身の男。頭蓋が頭頂から左右へ観音開きに割れ、骨の厚みのある断面と
 * 内側の耳道の襞・血管が露出する。眼窩は皮膚が覆い、窪みの輪郭だけが皮膚越しに読める。
 * 口は縫合糸で閉じられている（糸は1本ずつ独立ジオメトリ）。首が異様に長く傾ぐ。
 * 契約 DESIGN.md §4「P5e エリア2の敵 — 段階0」。原点＝足元・+Y上・正面 −Z。
 */
(function () {
  'use strict';
  var L = ESCAPE.__A2LIB;

  /* ---------------- 寸法 ---------------- */
  var ANK = 0.075, KNEE = 0.585, HIP = 1.075, CHEST = 1.585;
  var NECK_L = 0.335, HRX = 0.104, HRY = 0.137, HRZ = 0.123;
  var SPLIT = 1.06;            /* 割れ目の下端（theta, rad）＝眉のすぐ上 */
  var OPEN = 0.80;             /* 観音開きの角度(rad) */

  function mats() {
    var M = {};
    M.skin = L.skin({ seed: 41, base: '#98a8a1', dark: 'rgba(38,50,48,', veinColor: 'rgba(66,58,98,0.38)',
      mottle: 165, vein: 72, wrinkle: 300, pore: 0.36, bump: 3.3, roughLo: 0.36, roughHi: 0.92, tint: 0xa9cfd6 });
    /* 膝下: 水にふやけた皮膚（青白く・つるりと濡れる） */
    M.wet = L.skin({ seed: 57, base: '#879a98', dark: 'rgba(28,42,44,', veinColor: 'rgba(54,52,94,0.46)',
      mottle: 205, vein: 92, wrinkle: 360, pore: 0.42, bump: 3.9, roughLo: 0.10, roughHi: 0.46, tint: 0x9cc6ce });
    M.face = L.skin({ seed: 44, base: '#97a8a2', dark: 'rgba(38,50,48,', veinColor: 'rgba(68,58,98,0.30)',
      mottle: 210, vein: 95, wrinkle: 210, pore: 0.46, bump: 1.9, roughLo: 0.34, roughHi: 0.88,
      tint: 0xa9cfd6, repeat: [3, 2], nscale: 0.85 });
    M.eye = L.mat(0x17191a, 0.94, 0);
    M.tooth = L.mat(0x9a9074, 0.52, 0.03);
    M.bone = L.skin({ seed: 61, base: '#b0ab97', dark: 'rgba(62,56,42,', veinColor: 'rgba(120,96,70,0.28)',
      mottle: 170, vein: 30, wrinkle: 150, pore: 0.30, bump: 2.2, roughLo: 0.40, roughHi: 0.86,
      tint: 0x9ba8a6, repeat: [2, 2] });
    M.boneCut = L.mat(0x9aa29c, 0.50, 0.02, { flat: true });   /* 断面（内側の海綿骨） */
    M.inner = L.skin({ seed: 73, base: '#3a1d1a', dark: 'rgba(12,4,4,', veinColor: 'rgba(96,26,28,0.50)',
      mottle: 160, vein: 110, wrinkle: 340, pore: 0.34, bump: 4.6, roughLo: 0.26, roughHi: 0.72,
      tint: 0x5c3028, repeat: [2, 2] });
    M.vessel = L.mat(0x6b1f24, 0.32, 0.02);
    M.void = L.mat(0x0a0706, 0.95, 0);
    M.thread = L.mat(0x191712, 0.66, 0.05);
    M.nail = L.mat(0x7d7a66, 0.42, 0.12);
    M.rag = L.skin({ seed: 91, base: '#4a4a3e', dark: 'rgba(20,22,18,', veinColor: 'rgba(30,30,24,0.4)',
      mottle: 120, vein: 20, wrinkle: 320, pore: 0.22, bump: 3.4, roughLo: 0.55, roughHi: 0.98, tint: 0x8f9a86 });
    return M;
  }

  /* ---- 頭蓋の割れた片側（外殻＋内殻＋矢状断面＋下端のリム） ---- */
  function capHalf(M, side) {
    var g = new THREE.Group(), seg = 26, th = 0.885;   /* th: 内殻の比率＝骨の厚み */
    var phi0 = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    var outer = new THREE.SphereGeometry(1, seg, 18, phi0, Math.PI, 0, SPLIT);
    outer.scale(HRX, HRY, HRZ);
    /* 頭頂をやや尖らせ、側頭を凹ませる（左右で量を変えて非対称に） */
    L.deform(outer, function (x, y, z, o) {
      var t = Math.max(0, y / HRY);
      o[1] = y + t * t * 0.016 * (side > 0 ? 1 : 0.6);
      o[0] = x * (1 - 0.10 * Math.pow(Math.max(0, 1 - Math.abs(y / HRY - 0.35) * 3.2), 2));
    });
    L.warp(outer, 0.0045, 11, side > 0 ? 5 : 9);
    g.add(L.m(outer, M.bone));
    var inner = new THREE.SphereGeometry(th, seg, 18, phi0, Math.PI, 0, SPLIT);
    inner.scale(HRX, HRY, HRZ);
    var ia = inner.index.array;
    for (var i = 0; i < ia.length; i += 3) { var t2 = ia[i]; ia[i] = ia[i + 2]; ia[i + 2] = t2; }
    inner.computeVertexNormals();
    g.add(L.m(inner, M.inner));
    /* 矢状断面（x=0 平面）: 前縁と後縁の2枚。骨の厚みが読める。 */
    [1, -1].forEach(function (zs) {
      var A = [], B = [], n = 22;
      for (var k = 0; k <= n; k++) {
        var t3 = SPLIT * k / n, st = Math.sin(t3), ct = Math.cos(t3);
        var jag = 1 + (k % 3 === 0 ? 0.012 : -0.008);      /* 割れ口はギザつく */
        A.push([0, ct * HRY * jag, zs * st * HRZ * jag]);
        B.push([0, ct * HRY * th, zs * st * HRZ * th]);
      }
      g.add(L.m(L.strip(A, B), M.boneCut));
      g.add(L.m(L.strip(B, A), M.boneCut));
    });
    /* 下端（theta=SPLIT）のリム＝割れ口の切り口 */
    var A2 = [], B2 = [], m = 20, s2 = Math.sin(SPLIT), c2 = Math.cos(SPLIT);
    for (var j = 0; j <= m; j++) {
      var ph = phi0 + Math.PI * j / m;
      A2.push([-Math.cos(ph) * s2 * HRX, c2 * HRY, Math.sin(ph) * s2 * HRZ]);
      B2.push([-Math.cos(ph) * s2 * HRX * th, c2 * HRY * th, Math.sin(ph) * s2 * HRZ * th]);
    }
    g.add(L.m(L.strip(A2, B2), M.boneCut));
    g.add(L.m(L.strip(B2, A2), M.boneCut));
    /* 内側: 耳道の襞（同心の輪が奥へ潜る）と血管 */
    var fold = new THREE.Group();
    for (var f = 0; f < 5; f++) {
      var rr = 0.052 - f * 0.0082, tor = new THREE.TorusGeometry(rr, 0.0062 + f * 0.0012, 6, 18);
      fold.add(L.m(tor, M.inner, [0, -0.012 - f * 0.009, -0.004 * f], [1.32 + f * 0.06, side > 0 ? -0.38 : 0.34, 0]));
    }
    fold.add(L.m(L.ell(0.020, 0.013, 0.020, 12), M.void, [0, -0.062, -0.016]));
    fold.position.set(side * HRX * 0.30, HRY * 0.30, 0);
    g.add(fold);
    var R = L.rng(side > 0 ? 13 : 29);
    for (var v = 0; v < 7; v++) {
      var p0 = [side * HRX * (0.06 + R() * 0.2), HRY * (0.82 - R() * 0.1), (R() - 0.5) * HRZ * 0.5];
      var pts = [p0];
      for (var q = 1; q < 4; q++) pts.push([p0[0] + side * 0.012 * q + (R() - 0.5) * 0.02,
        p0[1] - 0.030 * q, p0[2] + (R() - 0.5) * 0.035]);
      g.add(L.m(L.tube(pts, 0.0022 + R() * 0.0018, 5), M.vessel));
    }
    /* 蝶番: 側頭（x=±HRX 付近）を軸に外へ開く */
    var piv = new THREE.Group();
    piv.add(g);
    g.position.set(-side * HRX * 0.92, -HRY * 0.30, 0);
    piv.position.set(side * HRX * 0.92, HRY * 0.30, 0);
    piv.rotation.z = -side * OPEN * (side > 0 ? 1 : 0.84);   /* 左右で開き量を変える */
    piv.rotation.x = side > 0 ? 0.06 : -0.04;
    return piv;
  }

  /* ---- 顔: 頭蓋の下半分を1枚の殻として彫り、骨の稜を稜線として起こす ----
   * 眉弓・頬骨弓・鼻梁・鼻腔・上顎・下顎枝・顎先を「稜と窪み」で刻み、
   * 別ジオメトリで積むのは実際に別の器官であるもの（下顎の塊・歯・眼球・耳・縫合糸）だけ。 */
  function face(M) {
    var g = new THREE.Group();
    var sk = new THREE.SphereGeometry(1, 64, 44, 0, Math.PI * 2, SPLIT - 0.03, Math.PI - SPLIT + 0.03);
    sk.scale(HRX, HRY, HRZ);
    L.deform(sk, function (x, y, z, o) {
      var ny = y / HRY, nz = z / HRZ;
      var kx = 1 - 0.40 * Math.pow(Math.max(0, -ny), 1.6) - 0.05 * Math.max(0, ny);
      var kz = nz < 0 ? 1 - 0.15 * nz * nz : 1 + 0.12 * nz * nz;
      o[0] = x * kx;
      o[2] = z * kz * (1 - 0.34 * Math.pow(Math.max(0, -ny), 1.8));
      o[1] = y - 0.034 * Math.pow(Math.max(0, -ny), 2.0);
    });
    /* 眉弓（左右で高さ・張り出しが違う） */
    L.ridge(sk, [0.006, 0.036, -0.108], [0.083, 0.030, -0.060], 0.030, 0.0115, 1.6);
    L.ridge(sk, [-0.006, 0.030, -0.108], [-0.080, 0.021, -0.060], 0.028, 0.0100, 1.6);
    /* 眼窩: 深い窪み＋皮膚越しの眼球の膨らみ */
    L.bulge(sk, [0.050, 0.004, -0.100], 0.050, -0.0370);
    L.bulge(sk, [-0.048, -0.004, -0.100], 0.048, -0.0405);
    L.bulge(sk, [0.050, 0.004, -0.100], 0.031, 0.0100);
    L.bulge(sk, [-0.048, -0.004, -0.100], 0.029, 0.0092);
    /* こめかみ・側頭筋の落ち窪み */
    L.bulge(sk, [0.098, 0.036, -0.042], 0.055, -0.0155);
    L.bulge(sk, [-0.097, 0.028, -0.044], 0.052, -0.0195);
    /* 頬骨弓（耳の前から目尻へ走る稜） */
    L.ridge(sk, [0.104, -0.006, -0.010], [0.058, -0.014, -0.086], 0.024, 0.0105, 1.8);
    L.ridge(sk, [-0.103, -0.014, -0.008], [-0.056, -0.022, -0.086], 0.023, 0.0095, 1.8);
    /* 頬のこけ（頬骨の下が抉れる） */
    L.bulge(sk, [0.066, -0.058, -0.078], 0.046, -0.0175);
    L.bulge(sk, [-0.063, -0.064, -0.076], 0.044, -0.0200);
    /* 鼻梁: 眉間から鼻尖へ */
    L.ridge(sk, [0.001, 0.026, -0.106], [0.003, -0.048, -0.108], 0.018, 0.0135, 2.2);
    L.bulge(sk, [0.002, 0.010, -0.112], 0.014, -0.0080);          /* 鼻根の括れ */
    /* 鼻腔: 鼻軟骨が落ち、梨状口が開く */
    L.bulge(sk, [0.002, -0.062, -0.104], 0.023, -0.0220);
    /* 人中・上顎 */
    L.ridge(sk, [0.000, -0.066, -0.104], [0.000, -0.082, -0.102], 0.009, 0.0055, 2);
    L.ridge(sk, [0.040, -0.076, -0.086], [-0.040, -0.080, -0.086], 0.026, 0.0080, 1.5);
    /* 口の合わせ目（縫われて内側へ引き込まれる溝） */
    L.ridge(sk, [0.047, -0.086, -0.078], [-0.046, -0.090, -0.078], 0.013, -0.0105, 1.4);
    /* 下唇の下の窪みと顎先 */
    L.ridge(sk, [0.026, -0.110, -0.084], [-0.026, -0.113, -0.084], 0.016, -0.0075, 1.6);
    L.bulge(sk, [0.002, -0.131, -0.074], 0.030, 0.0110);
    /* 下顎枝（エラ）と顎のライン */
    L.ridge(sk, [0.083, -0.036, -0.018], [0.052, -0.121, -0.062], 0.024, 0.0105, 1.7);
    L.ridge(sk, [-0.081, -0.044, -0.016], [-0.050, -0.126, -0.060], 0.023, 0.0095, 1.7);
    L.ridge(sk, [0.052, -0.121, -0.062], [-0.050, -0.126, -0.060], 0.017, 0.0060, 1.5);
    /* 縫い口の刺し傷（皮膚が糸に引かれて窪む） */
    var Rp = L.rng(77);
    for (var sI = 0; sI < 9; sI++) {
      var tx = -0.042 + 0.084 * sI / 8 + (Rp() - 0.5) * 0.004;
      L.bulge(sk, [tx, -0.073 - Rp() * 0.004, -0.082], 0.0085, -0.0042);
      L.bulge(sk, [tx, -0.101 - Rp() * 0.004, -0.080], 0.0085, -0.0040);
    }
    L.warp(sk, 0.0026, 15, 6);
    g.add(L.m(sk, M.face));
    /* 割れ目から中身が透けないよう、暗い髄の塊 */
    var brainG = L.ell(HRX * 0.80, HRY * 0.48, HRZ * 0.80, 24);
    for (var bw = 0; bw < 7; bw++) L.ridge(brainG, [-0.09 + bw * 0.03, 0.02, -0.09], [-0.07 + bw * 0.03, 0.04, 0.09], 0.016, -0.006, 1.4);
    g.add(L.m(brainG, M.inner, [0, HRY * 0.30, 0]));

    /* --- 別器官として積むもの --- */
    /* 眼球は皮膚の奥に沈む（表には出さない。輪郭だけが皮膚越しに読める） */
    g.add(L.m(L.ell(0.0150, 0.0142, 0.0130, 12), M.eye, [0.050, 0.004, -0.0480]));
    g.add(L.m(L.ell(0.0144, 0.0136, 0.0126, 12), M.eye, [-0.048, -0.004, -0.0485]));
    /* 歯列（縫合の奥・口腔内。1本ずつ独立。外からはほぼ見えない） */
    var mouth = new THREE.Group();
    L.teeth(mouth, M.tooth, 10, function (t) {
      var x = (t - 0.5) * 0.076;
      return [x, -0.0835, -0.0605 + 0.010 * (t - 0.5) * (t - 0.5) * 4];
    }, [0.0044, 0.0090], 23, 0.4);
    g.add(mouth);
    g.add(L.m(L.ell(0.046, 0.016, 0.030, 14), M.void, [0, -0.092, -0.058]));
    /* 縫合糸: 1本ずつ。結び目も1つずつ。 */
    var R = L.rng(101);
    for (var k = 0; k < 9; k++) {
      var x0 = -0.042 + 0.084 * k / 8 + (R() - 0.5) * 0.004;
      var yU = -0.0730 - R() * 0.004, yL = -0.1010 - R() * 0.004;
      var zz = -0.0815 + 0.030 * x0 * x0 * 42;
      var a = [x0 - 0.0055, yU, zz + 0.002], b = [x0 + 0.0035, -0.0875, zz - 0.0055], c = [x0 + 0.0060, yL, zz + 0.002];
      g.add(L.m(L.tube([a, b, c], 0.0012 + R() * 0.0005, 5), M.thread));
      g.add(L.m(L.ell(0.0026, 0.0024, 0.0020, 7), M.thread, [a[0], a[1], a[2] - 0.0022]));
      g.add(L.m(L.ell(0.0026, 0.0024, 0.0020, 7), M.thread, [c[0], c[1], c[2] - 0.0022]));
    }
    /* 耳（外耳は潰れ、耳輪の残骸だけ。左右で残り方が違う） */
    g.add(L.m(new THREE.TorusGeometry(0.021, 0.0055, 6, 16, 4.4), M.face, [0.101, -0.018, -0.004], [0.22, 1.48, 0.75]));
    g.add(L.m(new THREE.TorusGeometry(0.015, 0.0045, 6, 14, 3.2), M.face, [-0.100, -0.026, 0.002], [0.10, -1.52, -0.85]));
    g.add(L.m(L.ell(0.006, 0.007, 0.006, 8), M.void, [0.096, -0.020, -0.006]));
    g.add(L.m(L.ell(0.006, 0.007, 0.006, 8), M.void, [-0.095, -0.028, -0.002]));
    return g;
  }

  /* ---- 首（異様に長い）・胴・腕・脚 ---- */
  /* 断面プロファイル: [ny, kx, kz] の表を線形補間する */
  function prof(ny, T) {
    for (var i = 0; i < T.length - 1; i++) {
      if (ny <= T[i][0] && ny >= T[i + 1][0]) {
        var t = (T[i][0] - ny) / (T[i][0] - T[i + 1][0]);
        return [T[i][1] + (T[i + 1][1] - T[i][1]) * t, T[i][2] + (T[i + 1][2] - T[i][2]) * t];
      }
    }
    return ny > T[0][0] ? [T[0][1], T[0][2]] : [T[T.length - 1][1], T[T.length - 1][2]];
  }

  /* 四肢の一節: 起点→終点、途中に筋腹の膨らみ。継ぎ目が出ないよう端で細める。 */
  function limb(g, mw, from, to, r0, r1, belly, rad) {
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var geo = new THREE.CylinderGeometry(1, 1, len, rad || 12, 14, false);
    geo.translate(0, len / 2, 0);
    L.deform(geo, function (x, y, z, o) {
      var t = L.clamp(y / len, 0, 1);
      var r = r0 + (r1 - r0) * t;
      r *= 1 + (belly || 0.10) * Math.sin(Math.PI * Math.pow(t, 0.82));
      r *= 1 + 0.05 * Math.sin(t * 17 + x * 30);        /* 筋・腱のうねり */
      var d = Math.sqrt(x * x + z * z) || 1;
      o[0] = x / d * r; o[2] = z / d * r;
    });
    var mesh = L.m(geo, mw, from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx / len, dy / len, dz / len));
    g.add(mesh);
    return mesh;
  }

  function body(M) {
    var g = new THREE.Group(), R = L.rng(211);
    var yb = HIP - 0.145, yt = CHEST + 0.055, cy = (yb + yt) / 2, hy = (yt - yb) / 2;
    var TT = [[1, 0.98, 0.66], [0.72, 1.00, 0.76], [0.42, 0.86, 0.74], [0.10, 0.60, 0.58],
      [-0.22, 0.64, 0.60], [-0.60, 0.82, 0.70], [-1, 0.50, 0.46]];
    var torso = new THREE.SphereGeometry(1, 34, 26);
    torso.scale(0.168, hy, 0.118);
    L.deform(torso, function (x, y, z, o) {
      var ny = L.clamp(y / hy, -1, 1), k = prof(ny, TT);
      o[0] = x * k[0] * (1 + 0.05 * ny);            /* 左右非対称（右肩が下がる） */
      o[2] = z * k[1] * (z < 0 ? 1.06 : 0.94);
      o[1] = y;
    });
    /* 肋が浮く（前面の左右に稜を彫る）・鎖骨下の窪み・腹の凹み */
    for (var i = 0; i < 6; i++) {
      var ry = hy * (0.52 - i * 0.115);
      L.bulge(torso, [0.055, ry, -0.088], 0.050, 0.0085 - i * 0.0006);
      L.bulge(torso, [-0.052, ry - 0.006, -0.086], 0.048, 0.0080 - i * 0.0006);
      L.bulge(torso, [0.098, ry + 0.01, -0.030], 0.044, -0.006);
      L.bulge(torso, [-0.096, ry + 0.004, -0.028], 0.044, -0.007);
    }
    L.bulge(torso, [0, hy * 0.70, -0.090], 0.060, -0.016);      /* 胸骨の谷 */
    L.bulge(torso, [0, -hy * 0.18, -0.078], 0.070, -0.020);     /* 腹の落ち込み */
    L.bulge(torso, [0, hy * 0.30, 0.100], 0.090, -0.012);       /* 背の反り */
    L.warp(torso, 0.0055, 8, 4);
    g.add(L.m(torso, M.skin, [0, cy, -0.012]));
    /* 肩甲・三角筋（胴に埋めて継ぎ目を消す） */
    [1, -1].forEach(function (s) {
      var sy = CHEST - 0.035 - (s > 0 ? 0 : 0.022);
      g.add(L.m(L.ell(0.062, 0.060, 0.058, 18), M.skin, [s * 0.130, sy, -0.010], [0, 0, -s * 0.22]));
      g.add(L.m(L.ell(0.052, 0.070, 0.026, 14), M.skin, [s * 0.085, sy - 0.085, 0.072], [0.1, s * 0.3, -s * 0.2]));
    });
    /* 鎖骨・胸骨・腸骨稜（人体の部品） */
    g.add(L.m(L.tube([[0.010, CHEST - 0.085, -0.088], [0.080, CHEST - 0.060, -0.066], [0.140, CHEST - 0.078, -0.020]], 0.0115, 8), M.skin));
    g.add(L.m(L.tube([[-0.010, CHEST - 0.092, -0.088], [-0.078, CHEST - 0.070, -0.062], [-0.136, CHEST - 0.090, -0.018]], 0.0110, 8), M.skin));
    g.add(L.m(L.ell(0.019, 0.072, 0.014, 14), M.skin, [0, CHEST - 0.155, -0.098], [0.16, 0, 0.03]));
    [1, -1].forEach(function (s) {
      g.add(L.m(L.tube([[s * 0.020, HIP + 0.045, -0.078], [s * 0.090, HIP + 0.030, -0.050], [s * 0.108, HIP + 0.005, 0.010]], 0.0105, 7), M.skin));
    });
    /* 腰の襤褸（作業着の残骸） */
    for (var b = 0; b < 11; b++) {
      var a = b / 11 * 6.284 + 0.2, rx = Math.cos(a) * 0.128, rz = Math.sin(a) * 0.098;
      var hgt = 0.22 + R() * 0.34;
      var q = new THREE.PlaneGeometry(0.085 + R() * 0.06, hgt, 2, 4);
      L.deform(q, function (x, y, z, o) {
        o[2] = z + Math.sin(y * 8 + a * 3) * 0.016 + Math.sin(x * 22) * 0.006;
        o[0] = x * (1 - 0.25 * Math.max(0, -y / hgt));
      });
      var mm = L.m(q, M.rag, [rx, HIP - 0.015 - hgt / 2, rz], [0.05, -a + Math.PI / 2, (R() - 0.5) * 0.35]);
      mm.material.side = THREE.DoubleSide;
      g.add(mm);
    }
    /* 脚（膝下は水にふやけた材質・左右で開き方を変える） */
    [1, -1].forEach(function (s) {
      var hipP = [s * 0.076, HIP - 0.085, -0.006];
      var kneeP = [s * (s > 0 ? 0.070 : 0.058), KNEE + (s > 0 ? 0 : 0.012), s > 0 ? -0.040 : 0.030];
      var ankP = [s * (s > 0 ? 0.066 : 0.050), ANK, s > 0 ? 0.010 : 0.070];
      limb(g, M.skin, hipP, kneeP, 0.070, 0.042, 0.13, 14);
      g.add(L.m(L.ell(0.043, 0.042, 0.046, 16), M.wet, kneeP, [0, 0, 0]));
      g.add(L.m(L.ell(0.030, 0.017, 0.012, 12), M.wet, [kneeP[0], kneeP[1] + 0.008, kneeP[2] - 0.038]));  /* 膝蓋骨 */
      limb(g, M.wet, kneeP, ankP, 0.046, 0.026, 0.22, 14);
      g.add(L.m(L.ell(0.029, 0.026, 0.030, 12), M.wet, ankP));
      var ft = L.ell(0.040, 0.024, 0.090, 16);
      L.deform(ft, function (x, y, z, o) { o[1] = y * (1 - 0.4 * Math.max(0, -z / 0.09)); });
      g.add(L.m(ft, M.wet, [ankP[0], 0.025, ankP[2] - 0.050], [0, s * 0.14, 0]));
      for (var t = 0; t < 5; t++) {
        g.add(L.m(L.ell(0.0095, 0.0080, 0.018, 8), M.wet,
          [ankP[0] + (t - 2) * 0.0165, 0.015, ankP[2] - 0.128 + Math.abs(t - 2) * 0.006]));
      }
      var rip = new THREE.TorusGeometry(0.085 + s * 0.025, 0.0055, 5, 22);
      g.add(L.m(rip, M.wet, [ankP[0], 0.040, ankP[2] - 0.03], [Math.PI / 2, 0, 0]));
    });
    /* 腕: 左右で角度を変え、指が異様に長い */
    [1, -1].forEach(function (s) {
      var sh = [s * 0.150, CHEST - 0.075 - (s > 0 ? 0 : 0.020), -0.012];
      var el = s > 0 ? [0.238, CHEST - 0.435, 0.045] : [-0.205, CHEST - 0.455, -0.070];
      var wr = s > 0 ? [0.212, CHEST - 0.805, -0.075] : [-0.240, CHEST - 0.770, -0.215];
      limb(g, M.skin, sh, el, 0.050, 0.031, 0.16, 12);
      g.add(L.m(L.ell(0.032, 0.030, 0.033, 14), M.skin, el));
      limb(g, M.skin, el, wr, 0.033, 0.021, 0.20, 12);
      var hand = new THREE.Group();
      hand.add(L.m(L.ell(0.032, 0.048, 0.013, 16), M.skin, [0, -0.040, 0]));
      for (var f = 0; f < 4; f++) {
        var fx = (f - 1.5) * 0.0185, spread = (f - 1.5) * 0.12;
        var y0 = -0.080, len = 0.056 + (f === 1 || f === 2 ? 0.022 : 0.004), zz = 0;
        for (var k = 0; k < 3; k++) {
          var l2 = len * (1 - k * 0.20);
          var mm2 = L.m(L.seg(0.0086 - k * 0.0016, 0.0072 - k * 0.0016, l2, 8), M.skin, [fx + spread * 0.018 * k, y0, zz]);
          mm2.rotation.order = 'ZXY'; mm2.rotation.z = spread * 0.55; mm2.rotation.x = 0.14 + k * 0.20;
          hand.add(mm2);
          hand.add(L.m(L.ell(0.0090 - k * 0.0016, 0.0078, 0.0086, 8), M.skin, [fx + spread * 0.018 * k, y0, zz]));
          if (k === 2) hand.add(L.m(L.ell(0.0060, 0.0105, 0.0048, 8), M.nail, [fx + spread * 0.018 * k, y0 - l2 * 0.95, zz - 0.006]));
          y0 -= l2 * 0.93; zz += 0.005;
        }
      }
      var th = L.m(L.seg(0.0098, 0.0072, 0.050, 8), M.skin, [-s * 0.028, -0.058, 0.008]);
      th.rotation.z = s * 1.15; hand.add(th);
      hand.position.set(wr[0], wr[1], wr[2]);
      hand.rotation.set(s > 0 ? 0.22 : -0.10, 0, s > 0 ? 0.20 : -0.42);
      g.add(hand);
    });
    return g;
  }

  function build(THREE) {
    var M = mats(), root = new THREE.Group();
    var lean = new THREE.Group();
    lean.rotation.set(0.055, 0.16, -0.03);
    lean.add(body(M));
    root.add(lean);
    /* 首: 長い。腱・気管の輪が浮く。 */
    var neck = new THREE.Group();
    neck.position.set(0, CHEST - 0.055, -0.012);
    neck.rotation.set(-0.09, -0.08, 0.23);
    var nk = L.seg(0.054, 0.040, NECK_L, 14);
    L.deform(nk, function (x, y, z, o) { o[0] = x * (1 - 0.10 * Math.sin(y / NECK_L * 3.1)); });
    neck.add(L.m(nk, M.skin));
    for (var r = 0; r < 3; r++) {
      neck.add(L.m(new THREE.TorusGeometry(0.029, 0.0030, 5, 14), M.skin, [0.004, 0.075 + r * 0.075, -0.030], [1.45, 0, 0]));
    }
    neck.add(L.m(L.tube([[0.030, 0.02, -0.030], [0.040, NECK_L * 0.55, -0.012], [0.030, NECK_L - 0.01, 0.014]], 0.0085, 7), M.skin));
    neck.add(L.m(L.tube([[-0.030, 0.02, -0.030], [-0.038, NECK_L * 0.55, -0.010], [-0.028, NECK_L - 0.01, 0.016]], 0.0080, 7), M.skin));
    /* 頭 */
    var head = new THREE.Group();
    head.position.set(0, NECK_L + 0.052, 0.004);
    head.rotation.set(0.05, -0.26, -0.44);          /* 首を傾げる */
    head.add(face(M));
    head.add(capHalf(M, 1));
    head.add(capHalf(M, -1));
    neck.add(head);
    lean.add(neck);
    return root;
  }

  ESCAPE.__A2MOCKS.B = {
    name: '案B 盲目の聴覚型',
    build: build,
    cams: {
      full: { pos: [0.88, 1.40, -2.28], look: [-0.03, 1.13, 0.02], fov: 48 },
      face: { pos: [0.12, 1.985, -0.63], look: [-0.075, 1.905, -0.02], fov: 33 }
    }
  };
})();
