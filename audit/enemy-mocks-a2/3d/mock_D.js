/* ESCAPE — P5e-0 案D「配管を這う」3Dコンセプトモック
 * 全長3m超・性別不明の多関節体（各肢に関節3つ以上）。天井配管に四肢で絡みつき、
 * 頭が逆さに垂れる。逆さの顔＝額が下・顎が上。眼窩は空洞、口は唇と歯茎から縦に裂け、
 * 歯は歯茎に植わる。皮膚は黒ずんで油膜が乗る。
 * 契約 DESIGN.md §4「P5e エリア2の敵 — 段階0」。原点＝床（真下）・+Y上・正面 −Z。
 */
(function () {
  'use strict';
  var L = ESCAPE.__A2LIB;

  var PIPE_Y = 2.72, PIPE_R = 0.185;
  var HEAD = [0.58, 1.98, -0.26];          /* 逆さの頭の中心 */
  var HRX = 0.145, HRY = 0.188, HRZ = 0.166;

  function mats() {
    var M = {};
    /* 黒ずんだ皮膚＋油膜（金属味を少し混ぜ、粗さを落として虹色の照り返しを作る） */
    M.skin = L.skin({ seed: 311, base: '#2e332e', dark: 'rgba(8,10,10,', veinColor: 'rgba(30,44,40,0.5)',
      mottle: 200, vein: 80, wrinkle: 340, pore: 0.42, bump: 3.4, roughLo: 0.18, roughHi: 0.56,
      tint: 0x8c9c94, metalness: 0.10 });
    M.face = L.skin({ seed: 313, base: '#343a34', dark: 'rgba(9,11,10,', veinColor: 'rgba(34,50,44,0.45)',
      mottle: 230, vein: 110, wrinkle: 240, pore: 0.50, bump: 2.1, roughLo: 0.17, roughHi: 0.52,
      tint: 0x93a79c, metalness: 0.10, repeat: [4, 3], nscale: 0.9 });
    M.void = L.mat(0x030405, 1.0, 0);
    M.gum = L.mat(0x24100f, 0.62, 0.02);
    M.tooth = L.mat(0x9a9076, 0.42, 0.04);
    M.nail = L.mat(0x5a5a4c, 0.34, 0.20);
    M.sinew = L.mat(0x5e4f42, 0.50, 0.05);
    M.pipe = L.skin({ seed: 317, base: '#4a4038', dark: 'rgba(24,16,10,', veinColor: 'rgba(88,52,26,0.5)',
      mottle: 150, vein: 40, wrinkle: 180, pore: 0.28, bump: 2.8, roughLo: 0.36, roughHi: 0.92,
      tint: 0x8a7a68, metalness: 0.55, repeat: [6, 1] });
    M.bolt = L.mat(0x3c352c, 0.55, 0.75);
    return M;
  }

  /* 多関節の肢: 折れ点の列を筒でつなぎ、関節ごとに骨頭を置く */
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
        r *= 1 + 0.17 * Math.sin(Math.PI * Math.pow(t, 0.8));
        var d = Math.sqrt(x * x + z * z) || 1;
        o[0] = x / d * r; o[2] = z / d * r;
      });
      var mm = L.m(geo, M.skin, a);
      mm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
      g.add(mm);
      if (i > 0) {
        g.add(L.m(L.ell(ra * 1.12, ra * 1.30, ra * 1.12, 14), M.skin, a));   /* 関節の骨頭 */
        g.add(L.m(L.tube([[a[0], a[1] - ra, a[2]], [a[0] + dx * 0.2, a[1] + dy * 0.2 - ra * 0.6, a[2] + dz * 0.2]], ra * 0.22, 5), M.sinew));
      }
    }
  }

  /* 配管を掴む手（指は3節・爪が食い込む） */
  function grip(g, M, at, dir, seed, scale) {
    var R = L.rng(seed), h = new THREE.Group(), k = scale || 1;
    h.add(L.m(L.ell(0.036 * k, 0.016 * k, 0.044 * k, 14), M.skin, [0, 0, 0]));
    for (var f = 0; f < 4; f++) {
      var a0 = -0.55 + f * 0.38, y0 = 0, len = (0.052 + (f === 1 || f === 2 ? 0.018 : 0)) * k;
      var px = Math.sin(a0) * 0.034 * k, pz = -0.032 * k, py = 0;
      for (var j = 0; j < 3; j++) {
        var l2 = len * (1 - j * 0.18);
        var seg = L.m(L.seg(0.0105 * k - j * 0.0018, 0.0090 * k - j * 0.0018, l2, 8), M.skin, [px, py, pz]);
        seg.rotation.order = 'ZXY';
        seg.rotation.z = a0 * 0.55 + Math.PI;            /* 指は下向きに回り込む */
        seg.rotation.x = -(0.55 + j * 0.55);
        h.add(seg);
        h.add(L.m(L.ell(0.0112 * k - j * 0.0018, 0.0100 * k, 0.0108 * k - j * 0.0018, 10), M.skin, [px, py, pz]));
        py -= l2 * 0.72 * Math.cos(j * 0.5); pz -= l2 * 0.52;
        if (j === 2) h.add(L.m(L.ell(0.0068 * k, 0.0125 * k, 0.0055 * k, 8), M.nail, [px, py - 0.006 * k, pz - 0.008 * k], [0.9, 0, 0]));
      }
    }
    h.position.set(at[0], at[1], at[2]);
    h.rotation.set(dir[0], dir[1], dir[2]);
    g.add(h);
  }

  /* ---- 逆さの顔: 人の頭蓋を彫り、眼窩は骨の縁が立った空洞、口は縦に大きく裂ける ---- */
  function head(M) {
    var g = new THREE.Group();
    var sk = L.headShell({ rx: HRX, ry: HRY, rz: HRZ, seg: 68, socket: 0.052, eye: 0,
      temple: 0.030, cheek: 0.030, nose: 0.020, jaw: 1.10, chin: 0.016, brow: 0.022, seed: 31 });
    /* 眉弓をさらに重く（左右で量を変える） */
    L.ridge(sk, [0.008, 0.046, -0.140], [0.104, 0.038, -0.078], 0.034, 0.014, 1.5);
    L.ridge(sk, [-0.008, 0.038, -0.140], [-0.100, 0.026, -0.078], 0.032, 0.011, 1.5);
    /* こめかみをさらに抉る／頬骨を張らせる */
    L.bulge(sk, [0.122, 0.044, -0.052], 0.062, -0.017);
    L.bulge(sk, [-0.120, 0.034, -0.054], 0.058, -0.022);
    L.ridge(sk, [0.128, -0.006, -0.012], [0.072, -0.016, -0.112], 0.028, 0.014, 1.7);
    L.ridge(sk, [-0.126, -0.016, -0.010], [-0.070, -0.026, -0.112], 0.027, 0.012, 1.7);
    /* 上顎と下顎の段差（歯槽の張り出しと、その下の窪み） */
    L.ridge(sk, [0.052, -0.052, -0.118], [-0.050, -0.056, -0.118], 0.030, 0.012, 1.5);
    L.ridge(sk, [0.060, -0.088, -0.112], [-0.058, -0.092, -0.112], 0.020, -0.010, 1.5);
    L.ridge(sk, [0.058, -0.108, -0.108], [-0.056, -0.112, -0.108], 0.024, 0.010, 1.5);
    /* 縦の裂け目: 幅を大きく取り、正中を深く抉る */
    L.ridge(sk, [0, -0.026, -0.140], [0, -0.172, -0.108], 0.052, -0.072, 1.05);
    /* 裂け目の縁（唇）が外へ捲れる。左右で捲れ方が違う。 */
    L.ridge(sk, [0.052, -0.022, -0.128], [0.044, -0.168, -0.100], 0.024, 0.020, 1.5);
    L.ridge(sk, [-0.049, -0.028, -0.128], [-0.041, -0.170, -0.098], 0.022, 0.016, 1.5);
    L.warp(sk, 0.0028, 17, 12);

    /* --- 眼窩: 骨の縁が立った深い空洞 --- */
    [[0.070, 0.010, -0.112, 1], [-0.068, -0.006, -0.113, -1]].forEach(function (p, i) {
      var rr = 0.044 - i * 0.002;
      /* 縁の骨が立ち上がり、その内側が深く落ちる（殻に彫る） */
      L.bulge(sk, [p[0], p[1], p[2]], rr * 1.42, 0.013);
      L.bulge(sk, [p[0], p[1], p[2]], rr * 1.02, -0.068);
      /* 眼窩の内壁（奥へ抜ける筒）と底の闇 */
      var cup = new THREE.CylinderGeometry(rr * 0.94, rr * 0.32, 0.066, 18, 1, true);
      cup.rotateX(Math.PI / 2);
      var cm = L.m(cup, M.void, [p[0], p[1], p[2] + 0.048], [0.10, p[3] * 0.24, 0]);
      cm.material.side = THREE.DoubleSide;
      g.add(cm);
      g.add(L.m(L.ell(rr * 0.58, rr * 0.52, 0.012, 12), M.void, [p[0], p[1], p[2] + 0.072]));
    });
    /* 頬骨と下顎で輪郭を割る（左右非対称） */
    L.ridge(sk, [0.142, -0.010, -0.020], [0.082, -0.024, -0.120], 0.026, 0.018, 1.8);
    L.ridge(sk, [-0.140, -0.022, -0.016], [-0.078, -0.036, -0.120], 0.024, 0.014, 1.8);
    L.ridge(sk, [0.126, -0.052, -0.026], [0.058, -0.150, -0.078], 0.026, 0.016, 1.7);
    L.ridge(sk, [-0.122, -0.062, -0.022], [-0.054, -0.156, -0.074], 0.024, 0.012, 1.7);
    g.add(L.m(sk, M.face));

    /* --- 鼻腔: 三角の穴（骨が落ちた梨状口） --- */
    var nasal = new THREE.ConeGeometry(0.026, 0.044, 3);
    nasal.rotateX(-Math.PI / 2); nasal.rotateZ(Math.PI);
    g.add(L.m(nasal, M.void, [0.002, -0.026, -0.122], [0.22, 0, 0.06]));
    g.add(L.m(L.tube([[0.024, -0.006, -0.126], [0.002, -0.046, -0.132], [-0.023, -0.008, -0.126]], 0.0055, 6), M.face));

    /* --- 縦に裂けた口: 唇の断面・歯茎・歯・奥の暗がり --- */
    var N = 14, Lft = [], Rgt = [], Bot = [], Bot2 = [], eL = [], eR = [];
    for (var k = 0; k <= N; k++) {
      var t = k / N, y = -0.030 - 0.140 * t;
      var w = 0.042 * Math.sin(Math.PI * Math.pow(t, 0.80)) + 0.009;
      var ze = -0.124 + 0.020 * Math.abs(t - 0.5) + 0.012 * t;
      var zb = -0.050 - 0.010 * Math.sin(Math.PI * t);
      Lft.push([w, y, ze]); Rgt.push([-w * 0.94, y, ze]);
      Bot.push([0.004, y, zb]); Bot2.push([-0.004, y, zb]);
      eL.push([w * 1.02, y, ze - 0.003]); eR.push([-w * 0.96, y, ze - 0.003]);
    }
    g.add(L.m(L.strip(Lft, Bot), M.gum));
    g.add(L.m(L.strip(Bot, Lft), M.gum));
    g.add(L.m(L.strip(Bot2, Rgt), M.gum));
    g.add(L.m(L.strip(Rgt, Bot2), M.gum));
    /* 奥の暗がり */
    g.add(L.m(L.ell(0.020, 0.072, 0.030, 14), M.void, [0, -0.100, -0.048]));
    /* 唇（裂け目の縁の断面が丸く盛る） */
    g.add(L.m(L.tube(eL, 0.0105, 8), M.face));
    g.add(L.m(L.tube(eR, 0.0098, 8), M.face));
    /* 歯茎（暗い赤の畝）と、そこに1本ずつ植わる不揃いの歯 */
    [1, -1].forEach(function (s) {
      var gp = [];
      for (var q = 0; q <= 8; q++) {
        var t2 = q / 8, yy = -0.034 - 0.132 * t2;
        var ww = (0.042 * Math.sin(Math.PI * Math.pow(t2, 0.80)) + 0.009) * 0.62;
        gp.push([s * ww, yy, -0.104 + 0.016 * t2]);
      }
      g.add(L.m(L.tube(gp, 0.0105, 8), M.gum));
      var R2 = L.rng(s > 0 ? 41 : 47);
      for (var n = 0; n < 9; n++) {
        var t3 = 0.04 + 0.92 * n / 8, yy2 = -0.034 - 0.132 * t3;
        var ww2 = (0.042 * Math.sin(Math.PI * Math.pow(t3, 0.80)) + 0.009) * 0.68;
        var hh = 0.014 + R2() * 0.013, cw = 0.0048 + R2() * 0.0026;
        var cone = new THREE.ConeGeometry(cw, hh, 5);
        cone.translate(0, -hh / 2, 0);
        var tm = L.m(cone, M.tooth, [s * ww2, yy2, -0.114 + 0.016 * t3 + (R2() - 0.5) * 0.006]);
        tm.rotation.order = 'ZXY';
        tm.rotation.z = s * (1.30 + (R2() - 0.5) * 0.5);      /* 裂け目の内へ倒す */
        tm.rotation.x = (R2() - 0.5) * 0.5;
        g.add(tm);
      }
    });
    /* 耳の残骸（左右で残り方が違う）と首の腱 */
    g.add(L.m(new THREE.TorusGeometry(0.024, 0.0065, 6, 16, 4.2), M.face, [0.128, -0.018, 0.000], [0.2, 1.5, 0.8]));
    g.add(L.m(new THREE.TorusGeometry(0.016, 0.0048, 6, 14, 2.9), M.face, [-0.127, -0.028, 0.008], [0.1, -1.5, -0.9]));
    g.add(L.m(L.ell(0.007, 0.008, 0.007, 8), M.void, [0.124, -0.020, -0.006]));
    return g;
  }

  function build(THREE) {
    var M = mats(), root = new THREE.Group();

    /* ---- 天井の太い配管（1本）＋吊りバンド ---- */
    var pipe = new THREE.Group();
    var pg = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 9.4, 22, 1);
    pg.rotateZ(Math.PI / 2);
    pipe.add(L.m(pg, M.pipe, [0, PIPE_Y, 0]));
    for (var i = -3; i <= 3; i++) {
      pipe.add(L.m(new THREE.TorusGeometry(PIPE_R + 0.022, 0.024, 8, 22), M.pipe, [i * 1.35, PIPE_Y, 0], [0, Math.PI / 2, 0]));
      pipe.add(L.m(new THREE.BoxGeometry(0.05, 0.9, 0.05), M.bolt, [i * 1.35, PIPE_Y + 0.55, 0]));
      for (var b = 0; b < 6; b++) {
        var a = b / 6 * 6.284;
        pipe.add(L.m(new THREE.CylinderGeometry(0.013, 0.013, 0.020, 6), M.bolt,
          [i * 1.35 + 0.030, PIPE_Y + Math.cos(a) * (PIPE_R + 0.024), Math.sin(a) * (PIPE_R + 0.024)],
          [0, 0, Math.PI / 2 + 0]));
      }
    }
    /* 細い並走管（奥行き） */
    var pg2 = new THREE.CylinderGeometry(0.075, 0.075, 9.4, 14, 1); pg2.rotateZ(Math.PI / 2);
    pipe.add(L.m(pg2, M.pipe, [0, PIPE_Y + 0.30, 0.34]));
    root.add(pipe);

    /* ---- 胴（配管の下に張り付く長い胴。肋と背骨が浮く） ---- */
    var torso = new THREE.SphereGeometry(1, 44, 30);
    torso.scale(0.70, 0.120, 0.104);
    L.deform(torso, function (x, y, z, o) {
      var nx = x / 0.70;
      var k = 1 - 0.55 * Math.pow(Math.abs(nx), 3.0);
      k *= 1 + 0.34 * Math.exp(-Math.pow((nx - 0.50) * 3.0, 2));    /* 胸郭 */
      k *= 1 + 0.26 * Math.exp(-Math.pow((nx + 0.55) * 3.2, 2));    /* 骨盤 */
      k *= 1 - 0.30 * Math.exp(-Math.pow((nx + 0.02) * 4.2, 2));    /* 腰の括れ */
      o[1] = y * k - 0.030 * Math.pow(Math.abs(nx), 2);
      o[2] = z * k;
      o[0] = x;
    });
    for (var r = 0; r < 8; r++) {
      var rx2 = 0.40 - r * 0.070;
      L.ridge(torso, [rx2, -0.11, -0.10], [rx2 + 0.018, 0.02, 0.10], 0.030, 0.0135, 1.5);
      L.ridge(torso, [rx2 + 0.035, -0.115, -0.02], [rx2 + 0.045, -0.06, 0.09], 0.024, -0.0060, 1.4);
    }
    L.ridge(torso, [0.66, 0.085, 0.00], [-0.68, 0.080, 0.00], 0.034, 0.0165, 1.3);   /* 背骨（配管側） */
    for (var v = 0; v < 11; v++) {
      L.bulge(torso, [0.58 - v * 0.118, 0.100, 0.0], 0.022, 0.0075);                 /* 棘突起 */
    }
    L.ridge(torso, [0.18, -0.120, -0.02], [-0.40, -0.115, -0.02], 0.030, -0.0100, 1.4); /* 腹の落ち込み */
    L.ridge(torso, [0.52, -0.05, -0.095], [0.52, 0.02, 0.095], 0.030, -0.0090, 1.5);
    L.warp(torso, 0.0075, 6, 8);
    root.add(L.m(torso, M.skin, [-0.20, PIPE_Y - 0.30, -0.04], [0.10, 0, -0.05]));

    /* ---- 四肢（各4節・3関節以上）: 配管に絡みつく ---- */
    var limbs = [
      [[0.36, 2.46, -0.08], [0.58, 2.08, -0.56], [0.78, 2.54, -0.66], [0.88, 2.84, -0.40], [0.86, 2.70, -0.18]],
      [[0.28, 2.48, 0.06], [0.10, 2.10, 0.50], [-0.06, 2.70, 0.56], [-0.14, 2.92, 0.18], [-0.10, 2.82, -0.12]],
      [[-0.62, 2.40, -0.08], [-0.86, 2.02, -0.56], [-1.10, 2.68, -0.58], [-1.18, 2.92, -0.18], [-1.14, 2.84, 0.14]],
      [[-0.66, 2.42, 0.06], [-0.98, 2.10, 0.52], [-1.28, 2.72, 0.52], [-1.40, 2.92, 0.14], [-1.36, 2.84, -0.16]]
    ];
    limbs.forEach(function (pts, i) {
      chain(root, M, pts, 0.058 - (i > 1 ? 0.004 : 0), 0.024);
      var e = pts[pts.length - 1], d = pts[pts.length - 2];
      grip(root, M, e, [0.2 + i * 0.1, Math.atan2(e[0] - d[0], e[2] - d[2]), 0.1 * (i % 2 ? 1 : -1)], 500 + i * 7, 1.0);
    });
    /* 肩・骨盤の塊（肢の付け根を胴に溶かす） */
    [[0.34, 2.48, -0.02], [-0.64, 2.42, 0.00]].forEach(function (p) {
      root.add(L.m(L.ell(0.100, 0.078, 0.110, 18), M.skin, p));
    });

    /* ---- 首（逆さに垂れる）と頭 ---- */
    var neckPts = [[0.42, 2.44, -0.04], [0.52, 2.32, -0.14], [0.56, 2.20, -0.22]];
    chain(root, M, neckPts, 0.052, 0.044);
    var nk = L.tube([[0.42, 2.46, -0.02], [0.52, 2.30, -0.14], [0.565, 2.16, -0.235]], 0.050, 12);
    root.add(L.m(nk, M.skin));
    var hd = head(M);
    hd.position.set(HEAD[0], HEAD[1], HEAD[2]);
    hd.rotation.set(-0.40, 0.30, Math.PI - 0.08);       /* 逆さ: 額が下・顎が上 */
    root.add(hd);
    /* 首から頭へ走る腱 */
    root.add(L.m(L.tube([[0.49, 2.28, -0.13], [0.53, 2.18, -0.20], [0.56, 2.12, -0.24]], 0.010, 6), M.sinew));
    root.add(L.m(L.tube([[0.45, 2.26, -0.18], [0.50, 2.17, -0.24], [0.54, 2.11, -0.27]], 0.008, 6), M.sinew));
    /* 配管の下に吊られた灯からの回り込み（この個体は下から照らされる） */
    var up = new THREE.PointLight(0xffa858, 20, 7.2, 2); up.position.set(1.05, 2.85, -1.45); root.add(up);
    var up2 = new THREE.PointLight(0x7cbaa2, 7.5, 6.2, 2); up2.position.set(-0.05, 1.02, -0.95); root.add(up2);
    var up3 = new THREE.PointLight(0x4e9c80, 4.0, 5.0, 2); up3.position.set(-1.10, 1.00, 0.40); root.add(up3);
    return root;
  }

  ESCAPE.__A2MOCKS.D = {
    name: '案D 配管を這う',
    build: build,
    cams: {
      full: { pos: [0.46, 0.72, -3.00], look: [-0.26, 2.36, -0.04], fov: 52 },
      face: { pos: [0.33, 1.58, -1.02], look: [0.55, 1.95, -0.36], fov: 33 }
    }
  };
})();
