/* ESCAPE — P5e-1 案D「配管を這う」3Dモック（質上げ版）
 * 契約 DESIGN.md §4「P5e-1 エリア2の敵3体（D・E・F）— デザインの質上げ」。
 * 逆さの頭は「頭蓋を別パーツで積んでから皮膚で覆う」構法で彫る。
 *   骨パーツ: 脳頭蓋 / 眉弓（左右で厚みが違う）/ 頬骨弓（浮いた橋・下に影の隙間）/
 *             眼窩の骨縁と空洞 / 梨状口 / 上顎の歯槽 / 下顎の左右2片（縦裂で割れている）
 *   皮膚: 黒ずんだ油膜。metalness 0・アルベドは暗い蒼灰＋斑と血管、濡れた部分だけ粗さが低い。
 * 原点＝床（真下）・+Y 上・正面 −Z。頭はローカルでは正立、配置時に逆さへ回す。
 */
(function () {
  'use strict';
  var L = ESCAPE.__A2LIB;

  var PIPE_Y = 2.72, PIPE_R = 0.185;
  var HEAD = [0.56, 1.70, -0.66];
  var HRX = 0.098, HRY = 0.140, HRZ = 0.126;

  function mats() {
    var M = {};
    /* 皮膚: 黒ずんだ油膜。金属味は禁止（metalness 0）。濡れ＝低粗さで白い小ハイライト。 */
    M.skin = L.skin({ seed: 311, base: '#4c5156', dark: 'rgba(6,8,9,', veinColor: 'rgba(26,34,44,0.55)',
      mottle: 210, vein: 90, wrinkle: 330, pore: 0.44, bump: 3.6, roughLo: 0.22, roughHi: 0.78,
      tint: 0x8c959d, metalness: 0 });
    M.face = L.skin({ seed: 313, base: '#5b6166', dark: 'rgba(7,9,10,', veinColor: 'rgba(30,40,52,0.5)',
      mottle: 250, vein: 130, wrinkle: 300, pore: 0.55, bump: 2.4, roughLo: 0.22, roughHi: 0.76,
      tint: 0x99a3ab, metalness: 0, repeat: [4, 3], nscale: 1.1 });
    /* 骨: 皮膚より白く、粗い。透けて浮く部分に使う。 */
    M.bone = L.skin({ seed: 319, base: '#7c7867', dark: 'rgba(34,31,24,', veinColor: 'rgba(58,48,34,0.4)',
      mottle: 170, vein: 26, wrinkle: 230, pore: 0.26, bump: 2.4, roughLo: 0.62, roughHi: 0.96,
      tint: 0x3e3c34, metalness: 0, repeat: [3, 3] });
    M.void = new THREE.MeshBasicMaterial({ color: 0x000000 });   /* 底の見えない闇（光を拾わない） */
    M.gum = L.mat(0x2d1110, 0.48, 0);
    M.flesh = L.mat(0x41181a, 0.44, 0);
    M.tooth = L.mat(0x6b6350, 0.52, 0);
    M.nail = L.mat(0x4a4a40, 0.34, 0);
    M.sinew = L.mat(0x554738, 0.52, 0);
    M.oil = L.mat(0x0b0d10, 0.38, 0);
    M.hair = L.mat(0x07080a, 0.62, 0);
    M.pipe = L.skin({ seed: 317, base: '#4a4038', dark: 'rgba(24,16,10,', veinColor: 'rgba(88,52,26,0.5)',
      mottle: 150, vein: 40, wrinkle: 180, pore: 0.28, bump: 2.8, roughLo: 0.42, roughHi: 0.94,
      tint: 0x4b4339, metalness: 0.35, repeat: [6, 1] });
    M.bolt = L.mat(0x241f19, 0.62, 0.6);
    return M;
  }

  /* ---- 頭蓋の骨パーツ（ローカル正立・正面 −Z）。皮膚の下から形を押し上げる。 ---- */
  function skullBones(M) {
    var g = new THREE.Group(), X = HRX, Y = HRY, Z = HRZ;

    /* 眉間（グラベラ）の塊と、そこから続く鼻骨の稜 */
    g.add(L.m(L.ell(0.019, 0.014, 0.011, 12), M.bone, [-0.002, Y * 0.47, -Z * 0.88]));
    g.add(L.m(L.ell(0.0080, 0.030, 0.011, 10), M.bone, [0.001, Y * 0.28, -Z * 0.92], [0.26, 0, 0.05]));

    /* 眼窩: 骨縁のリングが立ち、その内側は底の見えない空洞（眼球は置かない） */
    [[1, 0.052, 0.033, 0.010, 0.006], [-1, 0.046, 0.030, -0.009, -0.010]].forEach(function (p) {
      var s = p[0], rx2 = p[1], ry2 = p[2], cy = p[3], cx = p[4];
      var ex = s * X * 0.52 + cx, ey = Y * 0.24 + cy, ez = -Z * 0.54;
      /* 空洞そのもの（前へ張り出して皮膚の窪みから覗く） */
      var hole = L.ell(rx2, ry2, 0.056, 20, 14);
      L.deform(hole, function (x, y, z, o) {
        o[0] = x * (1 - 0.34 * L.clamp(-z / 0.056, 0, 1));
        o[1] = y * (1 - 0.34 * L.clamp(-z / 0.056, 0, 1)) - 0.10 * ry2 * L.clamp(z / 0.056, 0, 1);
      });
      g.add(L.m(hole, M.void, [ex, ey, ez], [0.10, s * 0.16, s * 0.22]));
    });
    return g;
  }

  /* ---- 逆さの顔（ローカル正立）: 骨を積んだ上に皮膚を被せ、正中を縦に裂く ---- */
  function head(M) {
    var g = new THREE.Group(), X = HRX, Y = HRY, Z = HRZ;

    /* 皮膚の殻（頭蓋の形をそのまま写す。眼窩は空洞＝eye:0） */
    var sk = L.headShell({ rx: X, ry: Y, rz: Z, seg: 72, socket: 0.070, eye: 0,
      temple: 0.040, cheek: 0.034, nose: 0.022, jaw: 1.22, chin: 0.015, brow: 0.026, seed: 31 });
    /* 脳頭蓋を高く・後頭を張らせ、側頭は深く抉る（骨格が読める輪郭） */
    L.bulge(sk, [0, Y * 0.86, Z * 0.10], X * 0.85, 0.012);
    L.bulge(sk, [X * 1.02, Y * 0.34, -Z * 0.26], X * 0.60, -0.022);
    L.bulge(sk, [-X * 1.00, Y * 0.28, -Z * 0.30], X * 0.56, -0.030);
    /* 矢状（正中）の稜と、片側だけ落ちた頭頂（非対称） */
    L.ridge(sk, [0, Y * 0.96, -Z * 0.30], [0, Y * 0.62, Z * 0.86], X * 0.22, 0.0075, 1.6);
    L.bulge(sk, [-X * 0.58, Y * 0.72, -Z * 0.22], X * 0.50, -0.013);
    /* 頬骨の張り（隆起）→その下が落ちる。ここが「お面」を壊す。 */
    L.bulge(sk, [X * 0.72, Y * 0.02, -Z * 0.66], 0.040, 0.016);
    L.bulge(sk, [-X * 0.68, -Y * 0.02, -Z * 0.64], 0.038, 0.013);
    L.bulge(sk, [X * 0.76, -Y * 0.20, -Z * 0.54], X * 0.50, -0.038);
    L.bulge(sk, [-X * 0.72, -Y * 0.26, -Z * 0.52], X * 0.48, -0.044);
    /* 上顎の歯槽が前へ張り、その上（鼻の下）が窪む */
    L.ridge(sk, [X * 0.40, -Y * 0.56, -Z * 0.74], [-X * 0.40, -Y * 0.60, -Z * 0.74], X * 0.24, 0.012, 1.5);
    L.ridge(sk, [X * 0.34, -Y * 0.40, -Z * 0.82], [-X * 0.34, -Y * 0.44, -Z * 0.82], X * 0.18, -0.008, 1.5);
    /* 正中の縦裂: 額の下から顎先まで深く抉る（口が縦に裂ける） */
    L.ridge(sk, [0, -Y * 0.24, -Z * 0.90], [0, -Y * 1.04, -Z * 0.56], X * 0.28, -0.048, 1.2);
    /* 裂け目の縁（唇の断面）が左右で違う量に捲れる */
    L.ridge(sk, [X * 0.26, -Y * 0.28, -Z * 0.84], [X * 0.26, -Y * 0.98, -Z * 0.52], X * 0.16, 0.014, 1.5);
    L.ridge(sk, [-X * 0.23, -Y * 0.32, -Z * 0.84], [-X * 0.23, -Y * 1.02, -Z * 0.50], X * 0.14, 0.010, 1.5);
    /* 首の後ろ（項）の腱の溝 */
    L.ridge(sk, [X * 0.30, -Y * 0.30, Z * 0.90], [X * 0.24, -Y * 0.80, Z * 0.70], X * 0.16, -0.008, 1.5);
    /* 眼窩: 皮膚側も深く落とし、周囲の骨縁を立てる（左右で大きさが違う） */
    L.bulge(sk, [X * 0.52 + 0.006, Y * 0.24 + 0.010, -Z * 0.78], 0.064, 0.012);
    L.bulge(sk, [X * 0.52 + 0.006, Y * 0.24 + 0.010, -Z * 0.78], 0.048, -0.040);
    L.bulge(sk, [-X * 0.52 - 0.009, Y * 0.24 - 0.008, -Z * 0.78], 0.058, 0.010);
    L.bulge(sk, [-X * 0.52 - 0.009, Y * 0.24 - 0.008, -Z * 0.78], 0.043, -0.036);
    /* 頬骨弓: 頬骨から耳の前へ渡る稜。その下が影の溝になる。 */
    L.ridge(sk, [X * 0.70, Y * 0.02, -Z * 0.68], [X * 0.98, Y * 0.12, Z * 0.26], X * 0.24, 0.014, 1.8);
    L.ridge(sk, [-X * 0.66, -Y * 0.02, -Z * 0.66], [-X * 0.94, Y * 0.08, Z * 0.24], X * 0.22, 0.011, 1.8);
    L.ridge(sk, [X * 0.68, -Y * 0.16, -Z * 0.62], [X * 0.94, -Y * 0.08, Z * 0.20], X * 0.18, -0.013, 1.6);
    L.ridge(sk, [-X * 0.64, -Y * 0.20, -Z * 0.60], [-X * 0.90, -Y * 0.12, Z * 0.18], X * 0.17, -0.015, 1.6);
    /* 眼窩の骨縁: 上縁は鋭く立ち、下縁（頬骨前頭突起側）は厚く盛る。 */
    L.ridge(sk, [X * 0.14, Y * 0.40, -Z * 0.82], [X * 0.92, Y * 0.30, -Z * 0.46], X * 0.14, 0.012, 2.0);
    L.ridge(sk, [-X * 0.14, Y * 0.38, -Z * 0.82], [-X * 0.88, Y * 0.24, -Z * 0.46], X * 0.13, 0.009, 2.0);
    L.ridge(sk, [X * 0.18, Y * 0.06, -Z * 0.80], [X * 0.92, Y * 0.12, -Z * 0.46], X * 0.13, 0.011, 2.0);
    L.ridge(sk, [-X * 0.18, Y * 0.04, -Z * 0.80], [-X * 0.88, Y * 0.08, -Z * 0.46], X * 0.12, 0.009, 2.0);
    /* 眉弓: 殻に彫る重い庇。左右で高さと張り出しが違う（非対称）。 */
    L.ridge(sk, [X * 0.08, Y * 0.44, -Z * 0.84], [X * 0.86, Y * 0.34, -Z * 0.50], X * 0.34, 0.020, 1.5);
    L.ridge(sk, [-X * 0.08, Y * 0.40, -Z * 0.84], [-X * 0.80, Y * 0.26, -Z * 0.50], X * 0.30, 0.015, 1.5);
    /* 側頭の深い窪み（眼窩の外側・骨格の読みを決める） */
    L.bulge(sk, [X * 0.98, Y * 0.30, -Z * 0.30], 0.055, -0.026);
    L.bulge(sk, [-X * 0.96, Y * 0.26, -Z * 0.32], 0.052, -0.030);
    L.bulge(sk, [X * 0.42, Y * 0.66, -Z * 0.72], 0.046, 0.010);
    L.bulge(sk, [-X * 0.38, Y * 0.70, -Z * 0.70], 0.042, 0.008);
    L.bulge(sk, [0, Y * 0.46, -Z * 0.84], 0.030, -0.010);
    L.bulge(sk, [X * 0.78, -Y * 0.66, -Z * 0.30], 0.042, 0.014);
    L.bulge(sk, [-X * 0.74, -Y * 0.70, -Z * 0.28], 0.040, 0.010);
    L.warp(sk, 0.0030, 19, 12);
    g.add(L.m(sk, M.face));

    g.add(skullBones(M));

    /* 梨状口（鼻の穴）: 左右2つの涙形の穴＋間の鼻棘 */
    var pyr = L.ell(0.020, 0.026, 0.044, 16, 12);
    L.deform(pyr, function (x, y, z, o) {
      var t = L.clamp((y / 0.026 + 1) * 0.5, 0, 1);       /* 下が広い涙形 */
      o[0] = x * (0.28 + 0.85 * (1 - t)); o[1] = y * 1.15; o[2] = z;
    });
    g.add(L.m(pyr, M.void, [0.001, -Y * 0.02, -Z * 0.60], [0.20, 0, 0.05]));
    g.add(L.m(L.ell(0.0050, 0.014, 0.008, 8), M.bone, [0.000, -Y * 0.09, -Z * 0.91]));

    /* ---- 縦に裂けた口: 唇の断面・歯茎の畝・1本ずつの歯・奥の喉の闇 ---- */
    var N = 16, eL = [], eR = [], iL = [], iR = [], back = [];
    for (var k = 0; k <= N; k++) {
      var t = k / N, y = -Y * 0.22 - (Y * 0.86) * t;
      var w = 0.026 * Math.sin(Math.PI * Math.pow(t, 0.70)) + 0.005;
      var jag = ((k % 3) - 1) * 0.0011 + ((k % 5) - 2) * 0.0007;                     /* 縁が不揃いに裂ける */
      var ze = -Z * 0.86 + 0.020 * Math.abs(t - 0.45) + 0.016 * t;
      eL.push([w + jag, y, ze]); eR.push([-w * 0.92 - jag, y, ze]);
      iL.push([w * 0.52, y, ze + 0.036]); iR.push([-w * 0.50, y, ze + 0.036]);
      back.push([0, y, ze + 0.062]);
    }
    /* 裂け目の内壁（唇の断面→粘膜）と喉の闇 */
    var s1 = L.m(L.strip(eL, iL), M.flesh); s1.material.side = THREE.DoubleSide; g.add(s1);
    var s2 = L.m(L.strip(iR, eR), M.flesh); s2.material.side = THREE.DoubleSide; g.add(s2);
    var s3 = L.m(L.strip(iL, back), M.gum); s3.material.side = THREE.DoubleSide; g.add(s3);
    var s4 = L.m(L.strip(back, iR), M.gum); s4.material.side = THREE.DoubleSide; g.add(s4);
    g.add(L.m(L.ell(0.016, Y * 0.40, 0.026, 14), M.void, [0, -Y * 0.62, -Z * 0.50]));
    /* 唇（縁の断面が丸く盛る。左右で太さが違う） */
    g.add(L.m(L.tube(eL, 0.0052, 8), M.face));
    g.add(L.m(L.tube(eR, 0.0048, 7), M.face));
    /* 歯茎の畝（暗赤）と、そこに1本ずつ大きさ・向きを変えて植わる歯 */
    [1, -1].forEach(function (s) {
      var gp = [], q, t2, ww;
      for (q = 0; q <= 10; q++) {
        t2 = q / 10; ww = (0.026 * Math.sin(Math.PI * Math.pow(t2, 0.70)) + 0.005) * 0.62;
        gp.push([s * ww, -Y * 0.24 - (Y * 0.82) * t2, -Z * 0.78 + 0.018 * t2]);
      }
      g.add(L.m(L.tube(gp, 0.0062, 6), M.gum));
      var R2 = L.rng(s > 0 ? 41 : 47);
      for (var n = 0; n < 11; n++) {
        var t3 = 0.05 + 0.90 * n / 10;
        var ww2 = (0.026 * Math.sin(Math.PI * Math.pow(t3, 0.70)) + 0.005) * 0.68;
        if (R2() < 0.16) continue;                       /* 欠けた歯 */
        var hh = 0.007 + R2() * 0.030, cw = 0.0028 + R2() * 0.0046;
        var cone = new THREE.ConeGeometry(cw, hh, 5);
        cone.translate(0, -hh / 2, 0);
        var tm = L.m(cone, M.tooth, [s * ww2, -Y * 0.24 - (Y * 0.82) * t3,
          -Z * 0.81 + 0.018 * t3 + (R2() - 0.5) * 0.005]);
        tm.rotation.order = 'ZXY';
        tm.rotation.z = s * (1.34 + (R2() - 0.5) * 0.62);
        tm.rotation.x = (R2() - 0.5) * 0.62;
        g.add(tm);
      }
    });

    /* 下顎の枝と関節（左右2片。縦裂で割れているので左右が離れる） */
    [1, -1].forEach(function (s) {
      var k = s > 0 ? 1 : 0.9;
      var ram = L.tube([
        [s * X * 0.30, -Y * 1.00, -Z * 0.56],
        [s * X * 0.74, -Y * 0.82, -Z * 0.30],
        [s * X * 0.92, -Y * 0.34, -Z * 0.06],
        [s * X * 0.88, -Y * 0.02, Z * 0.08]
      ], 0.0125 * k, 7);
      var rm2 = L.m(ram, M.bone); rm2.scale.set(0.72, 1, 1); g.add(rm2);
      g.add(L.m(L.ell(0.013 * k, 0.009, 0.011, 10), M.bone, [s * X * 0.88, Y * 0.02, Z * 0.10]));
    });

    /* 耳の残骸（左右で残り方が違う）＋外耳道の闇 */
    g.add(L.m(new THREE.TorusGeometry(0.023, 0.0062, 6, 16, 4.1), M.face, [X * 1.06, -Y * 0.02, Z * 0.16], [0.2, 1.5, 0.8]));
    g.add(L.m(new THREE.TorusGeometry(0.014, 0.0044, 6, 13, 2.7), M.face, [-X * 1.04, -Y * 0.12, Z * 0.20], [0.1, -1.5, -0.9]));
    g.add(L.m(L.ell(0.0065, 0.0075, 0.0065, 8), M.void, [X * 1.02, -Y * 0.03, Z * 0.14]));

    /* 濡れた短い髪の束（重力で垂れる＝頭が逆さなので +Y 側へ伸ばす） */
    var RH = L.rng(97);
    for (var h = 0; h < 14; h++) {
      var a = RH() * 6.284, rr2 = 0.30 + RH() * 0.70;
      var hx = Math.sin(a) * X * rr2 * 0.7, hz = Math.abs(Math.cos(a)) * Z * rr2 * 0.6 + Z * 0.62;
      var len = 0.022 + RH() * 0.040;
      g.add(L.m(L.tube([
        [hx, Y * 0.86, hz],
        [hx * 1.10, Y * 0.98 + len * 0.4, hz * 1.05],
        [hx * 1.16 + (RH() - 0.5) * 0.012, Y * 0.98 + len, hz * 1.08]
      ], 0.0013 + RH() * 0.0012, 4), M.hair));
    }
    /* 垂れる油の筋（皮膚の上を伝って顎先＝上へ集まる） */
    var RO = L.rng(53);
    for (var o = 0; o < 6; o++) {
      var ax = (RO() - 0.5) * X * 1.7, az = -Z * (0.20 + RO() * 0.30);
      g.add(L.m(L.tube([
        [ax, Y * 0.30 - RO() * 0.06, az],
        [ax * 0.8, -Y * 0.30, az - 0.006],
        [ax * 0.5, -Y * 0.90 - RO() * 0.10, az * 0.7]
      ], 0.0013 + RO() * 0.0011, 4), M.oil));
    }
    return g;
  }

  /* 多関節の肢: 折れ点の列を筒でつなぎ、関節ごとに骨の瘤と腱を置く */
  function chain(g, M, pts, r0, r1) {
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
      var ra = r0 + (r1 - r0) * t0, rb = r0 + (r1 - r0) * t1;
      var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var geo = new THREE.CylinderGeometry(1, 1, len, 12, 10, false);
      geo.translate(0, len / 2, 0);
      L.deform(geo, function (x, y, z, o) {
        var t = L.clamp(y / len, 0, 1), r = ra + (rb - ra) * t;
        r *= 1 - 0.26 * Math.sin(Math.PI * Math.pow(t, 0.9));   /* 中央が細る＝骨と皮 */
        var d = Math.sqrt(x * x + z * z) || 1;
        o[0] = x / d * r; o[2] = z / d * r;
      });
      /* 骨の稜（長骨の陵線）を1本入れる */
      L.ridge(geo, [ra * 0.8, len * 0.15, 0], [rb * 0.8, len * 0.85, 0], ra * 0.9, ra * 0.10, 1.6);
      var mm = L.m(geo, M.skin, a);
      mm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
      g.add(mm);
      if (i > 0) {
        g.add(L.m(L.ell(ra * 1.30, ra * 1.46, ra * 1.26, 12), M.skin, a));   /* 関節の骨の瘤 */
        g.add(L.m(L.tube([[a[0], a[1] - ra, a[2]],
          [a[0] + dx * 0.22, a[1] + dy * 0.22 - ra * 0.6, a[2] + dz * 0.22]], ra * 0.20, 5), M.sinew));
      }
    }
  }

  /* 配管を掴む手（指は3節・節ごとに骨頭・爪が食い込む） */
  function grip(g, M, at, dir, seed, scale) {
    var R = L.rng(seed), h = new THREE.Group(), k = scale || 1;
    h.add(L.m(L.ell(0.038 * k, 0.015 * k, 0.046 * k, 14), M.skin, [0, 0, 0]));
    /* 中手骨が皮膚の下で4本浮く */
    for (var mc = 0; mc < 4; mc++) {
      h.add(L.m(L.seg(0.0055 * k, 0.0045 * k, 0.040 * k, 6), M.skin,
        [(-0.021 + mc * 0.014) * k, 0.004 * k, -0.004 * k], [1.55, 0, 0]));
    }
    for (var f = 0; f < 4; f++) {
      var a0 = -0.58 + f * 0.39, len = (0.058 + (f === 1 || f === 2 ? 0.020 : 0)) * k;
      var px = Math.sin(a0) * 0.036 * k, pz = -0.034 * k, py = 0;
      for (var j = 0; j < 3; j++) {
        var l2 = len * (1 - j * 0.18);
        var seg = L.m(L.seg(0.0100 * k - j * 0.0018, 0.0084 * k - j * 0.0018, l2, 8), M.skin, [px, py, pz]);
        seg.rotation.order = 'ZXY';
        seg.rotation.z = a0 * 0.55 + Math.PI;
        seg.rotation.x = -(0.58 + j * 0.58);
        h.add(seg);
        h.add(L.m(L.ell(0.0116 * k - j * 0.0018, 0.0102 * k, 0.0110 * k - j * 0.0018, 9), M.skin, [px, py, pz]));
        py -= l2 * 0.72 * Math.cos(j * 0.5); pz -= l2 * 0.52;
        if (j === 2) h.add(L.m(L.ell(0.0064 * k, 0.0130 * k, 0.0052 * k, 7), M.nail,
          [px, py - 0.006 * k, pz - 0.008 * k], [0.9, 0, 0]));
      }
    }
    h.position.set(at[0], at[1], at[2]);
    h.rotation.set(dir[0], dir[1], dir[2]);
    g.add(h);
  }

  function build(THREE) {
    var M = mats(), root = new THREE.Group();

    /* ---- 天井の太い配管＋吊りバンド ---- */
    var pipe = new THREE.Group();
    var pg = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 9.4, 20, 1);
    pg.rotateZ(Math.PI / 2);
    pipe.add(L.m(pg, M.pipe, [0, PIPE_Y, 0]));
    for (var i = -3; i <= 3; i++) {
      pipe.add(L.m(new THREE.TorusGeometry(PIPE_R + 0.022, 0.024, 7, 20), M.pipe, [i * 1.35, PIPE_Y, 0], [0, Math.PI / 2, 0]));
      pipe.add(L.m(new THREE.BoxGeometry(0.05, 0.9, 0.05), M.bolt, [i * 1.35, PIPE_Y + 0.55, 0]));
    }
    var pg2 = new THREE.CylinderGeometry(0.075, 0.075, 9.4, 12, 1); pg2.rotateZ(Math.PI / 2);
    pipe.add(L.m(pg2, M.pipe, [0, PIPE_Y + 0.30, 0.34]));
    root.add(pipe);

    /* ---- 胴: 配管の下に張り付く長い胴。棘突起・肋・骨盤が浮く ---- */
    var torso = new THREE.SphereGeometry(1, 46, 30);
    torso.scale(0.72, 0.118, 0.100);
    L.deform(torso, function (x, y, z, o) {
      var nx = x / 0.72;
      var k = 1 - 0.58 * Math.pow(Math.abs(nx), 3.0);
      k *= 1 + 0.36 * Math.exp(-Math.pow((nx - 0.50) * 3.0, 2));
      k *= 1 + 0.24 * Math.exp(-Math.pow((nx + 0.55) * 3.2, 2));
      k *= 1 - 0.36 * Math.exp(-Math.pow((nx + 0.02) * 4.2, 2));
      o[1] = y * k - 0.034 * Math.pow(Math.abs(nx), 2);
      o[2] = z * k * (1 + 0.10 * Math.sin(nx * 2.1));       /* 胴が捻れる */
      o[0] = x;
    });
    for (var r = 0; r < 9; r++) {
      var rx2 = 0.42 - r * 0.066;
      L.ridge(torso, [rx2, -0.11, -0.10], [rx2 + 0.018, 0.02, 0.10], 0.028, 0.0145, 1.5);
      L.ridge(torso, [rx2 + 0.033, -0.115, -0.02], [rx2 + 0.043, -0.06, 0.09], 0.022, -0.0068, 1.4);
    }
    L.ridge(torso, [0.66, 0.084, 0.00], [-0.68, 0.078, 0.00], 0.032, 0.0175, 1.3);
    for (var v = 0; v < 13; v++) {
      L.bulge(torso, [0.60 - v * 0.104, 0.100, 0.0], 0.021, 0.0088);      /* 棘突起 */
    }
    L.ridge(torso, [0.18, -0.120, -0.02], [-0.42, -0.115, -0.02], 0.028, -0.0112, 1.4);
    L.warp(torso, 0.0080, 6, 8);
    root.add(L.m(torso, M.skin, [-0.20, PIPE_Y - 0.30, -0.04], [0.12, 0, -0.06]));

    /* ---- 四肢（各4節・関節3つ以上）: 配管に絡みつく ---- */
    var limbs = [
      [[0.36, 2.46, -0.08], [0.62, 1.94, -0.62], [0.84, 2.56, -0.72], [0.92, 2.88, -0.42], [0.88, 2.72, -0.16]],
      [[0.28, 2.48, 0.06], [0.06, 1.96, 0.58], [-0.10, 2.72, 0.62], [-0.18, 2.94, 0.18], [-0.12, 2.84, -0.12]],
      [[-0.62, 2.40, -0.08], [-0.90, 1.90, -0.62], [-1.16, 2.70, -0.62], [-1.24, 2.94, -0.18], [-1.18, 2.86, 0.16]],
      [[-0.66, 2.42, 0.06], [-1.04, 1.98, 0.56], [-1.36, 2.74, 0.56], [-1.48, 2.94, 0.14], [-1.42, 2.86, -0.18]]
    ];
    limbs.forEach(function (pts, i) {
      chain(root, M, pts, 0.068 - (i > 1 ? 0.006 : 0), 0.026);
      var e = pts[pts.length - 1], d = pts[pts.length - 2];
      grip(root, M, e, [0.2 + i * 0.1, Math.atan2(e[0] - d[0], e[2] - d[2]), 0.1 * (i % 2 ? 1 : -1)], 500 + i * 7, 1.0);
    });
    [[0.34, 2.48, -0.02], [-0.64, 2.42, 0.00]].forEach(function (p) {
      root.add(L.m(L.ell(0.098, 0.074, 0.106, 16), M.skin, p));
    });

    /* ---- 首（逆さに垂れる）と頭 ---- */
    var nk = L.tube([[0.40, 2.44, -0.04], [0.46, 2.22, -0.24], [0.52, 2.00, -0.46], [0.555, 1.88, -0.58]], 0.048, 12);
    L.ridge(nk, [0.40, 2.42, -0.08], [0.55, 1.90, -0.60], 0.024, 0.007, 1.6);
    root.add(L.m(nk, M.skin));
    var hd = head(M);
    hd.position.set(HEAD[0], HEAD[1], HEAD[2]);
    hd.rotation.set(0.30, 0.22, Math.PI - 0.12);        /* 逆さ: 額が下・顎が上 */
    root.add(hd);
    root.add(L.m(L.tube([[0.45, 2.30, -0.16], [0.50, 2.08, -0.38], [0.55, 1.90, -0.57]], 0.0090, 6), M.sinew));
    root.add(L.m(L.tube([[0.41, 2.28, -0.22], [0.47, 2.06, -0.44], [0.52, 1.89, -0.62]], 0.0072, 6), M.sinew));
    /* 配管の下の弱い回り込み（この個体は下から照らされる）。corridor では外される。 */
    var up = new THREE.PointLight(0xffa254, 4.5, 5.2, 2); up.position.set(0.98, 2.36, -1.46); root.add(up);
    var up2 = new THREE.PointLight(0x4f8f78, 3.4, 4.8, 2); up2.position.set(-0.10, 0.95, -1.25); root.add(up2);
    var up3 = new THREE.PointLight(0x8aa8bf, 6.0, 4.6, 2); up3.position.set(-0.55, 2.05, -1.35); root.add(up3);
    return root;
  }

  ESCAPE.__A2MOCKS.D = {
    name: '案D 配管を這う',
    build: build,
    cams: {
      full: { pos: [1.05, 0.62, -2.52], look: [-0.30, 2.24, -0.10], fov: 62 },
      face: { pos: [0.505, 1.745, -1.26], look: [0.565, 1.712, -0.66], fov: 34 },
      corridor: { pos: [0.0, 1.56, 1.20], look: [0.0, 1.42, -8.4], fov: 42,
        place: [-0.26, -0.50, -8.4], rot: [0, 0.28, 0] }
    }
  };
})();
