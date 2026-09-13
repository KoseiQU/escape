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
  var HRX = 0.132, HRY = 0.172, HRZ = 0.152;

  function mats() {
    var M = {};
    /* 黒ずんだ皮膚＋油膜（金属味を少し混ぜ、粗さを落として虹色の照り返しを作る） */
    M.skin = L.skin({ seed: 311, base: '#52574c', dark: 'rgba(16,18,16,', veinColor: 'rgba(30,44,40,0.5)',
      mottle: 200, vein: 80, wrinkle: 340, pore: 0.42, bump: 3.4, roughLo: 0.12, roughHi: 0.58,
      tint: 0x9aa89c, metalness: 0.30 });
    M.face = L.skin({ seed: 313, base: '#585d50', dark: 'rgba(18,20,16,', veinColor: 'rgba(34,50,44,0.45)',
      mottle: 230, vein: 110, wrinkle: 240, pore: 0.50, bump: 2.1, roughLo: 0.10, roughHi: 0.54,
      tint: 0xa4b2a6, metalness: 0.30, repeat: [3, 2], nscale: 0.9 });
    M.void = L.mat(0x030405, 1.0, 0);
    M.gum = L.mat(0x2a1512, 0.68, 0.02);
    M.tooth = L.mat(0x8e8670, 0.44, 0.04);
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

  /* ---- 逆さの顔: 眼窩は空洞、口は唇と歯茎から縦に裂ける ---- */
  function head(M) {
    var g = new THREE.Group();
    var sk = L.headShell({ rx: HRX, ry: HRY, rz: HRZ, seg: 62, socket: 0.048, eye: 0,
      temple: 0.020, cheek: 0.020, nose: 0.012, jaw: 1.05, chin: 0.010, brow: 0.013, seed: 31 });
    /* 縦の裂け目: 上唇の上から顎先まで、正中を割って開く */
    L.ridge(sk, [0, -0.034, -0.126], [0, -0.150, -0.098], 0.026, -0.046, 1.2);
    L.ridge(sk, [0, -0.034, -0.126], [0, -0.150, -0.098], 0.048, -0.012, 1.1);
    /* 裂け目の縁が捲れる（左右で捲れ方が違う） */
    L.ridge(sk, [0.033, -0.040, -0.120], [0.026, -0.146, -0.094], 0.021, 0.015, 1.6);
    L.ridge(sk, [-0.031, -0.044, -0.120], [-0.024, -0.148, -0.092], 0.020, 0.012, 1.6);
    L.warp(sk, 0.0024, 17, 12);
    g.add(L.m(sk, M.face));
    /* 眼窩の空洞（奥に暗箱） */
    [[0.062, 0.006, -0.092], [-0.060, -0.006, -0.093]].forEach(function (p, i) {
      g.add(L.m(L.ell(0.036 - i * 0.001, 0.031, 0.030, 14), M.void, p));
    });
    /* 縦裂の口腔（暗い奥行き） */
    var cav = L.ell(0.019, 0.062, 0.024, 16);
    g.add(L.m(cav, M.void, [0, -0.092, -0.084]));
    /* 歯茎（裂け目の両縁）と歯: 歯茎に1本ずつ植わる。縦に並ぶ。 */
    [1, -1].forEach(function (s) {
      var gum = L.tube([[s * 0.012, -0.038, -0.100], [s * 0.016, -0.092, -0.092], [s * 0.011, -0.148, -0.082]], 0.0090, 8);
      g.add(L.m(gum, M.gum));
      L.teeth(g, M.tooth, 8, function (t) {
        var y = -0.044 - t * 0.100;
        return [s * 0.0080, y, -0.0985 + t * 0.014];
      }, [0.0048, 0.0135], s > 0 ? 41 : 47, 0.7);
    });
    /* 歯の向きを裂け目の内へ倒す */
    g.children.forEach(function (c) {
      if (c.material === M.tooth) { c.rotation.z += (c.position.x > 0 ? -1 : 1) * 1.25; }
    });
    /* 鼻腔の穴・耳の残骸・首から垂れる腱 */
    g.add(L.m(L.ell(0.0085, 0.0110, 0.010, 10), M.void, [0.013, -0.020, -0.131]));
    g.add(L.m(L.ell(0.0080, 0.0105, 0.010, 10), M.void, [-0.012, -0.023, -0.131]));
    g.add(L.m(new THREE.TorusGeometry(0.020, 0.0055, 6, 16, 4.2), M.face, [0.097, -0.016, 0.000], [0.2, 1.5, 0.8]));
    g.add(L.m(new THREE.TorusGeometry(0.014, 0.0042, 6, 14, 3.0), M.face, [-0.096, -0.024, 0.006], [0.1, -1.5, -0.9]));
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
      [[0.34, 2.46, -0.08], [0.52, 2.16, -0.52], [0.66, 2.74, -0.54], [0.74, 2.94, -0.16], [0.70, 2.84, 0.14]],
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
    hd.rotation.set(-0.46, 0.22, Math.PI - 0.30);       /* 逆さ: 額が下・顎が上 */
    root.add(hd);
    /* 首から頭へ走る腱 */
    root.add(L.m(L.tube([[0.49, 2.28, -0.13], [0.53, 2.18, -0.20], [0.56, 2.12, -0.24]], 0.010, 6), M.sinew));
    root.add(L.m(L.tube([[0.45, 2.26, -0.18], [0.50, 2.17, -0.24], [0.54, 2.11, -0.27]], 0.008, 6), M.sinew));
    /* 配管の下に吊られた灯からの回り込み（この個体は下から照らされる） */
    var up = new THREE.PointLight(0xffb070, 13, 6.5, 2); up.position.set(0.85, 1.25, -1.05); root.add(up);
    var up2 = new THREE.PointLight(0x6ea08c, 5.0, 6.0, 2); up2.position.set(-0.9, 1.05, 0.45); root.add(up2);
    return root;
  }

  ESCAPE.__A2MOCKS.D = {
    name: '案D 配管を這う',
    build: build,
    cams: {
      full: { pos: [0.46, 0.72, -3.00], look: [-0.26, 2.36, -0.04], fov: 52 },
      face: { pos: [0.30, 1.50, -0.94], look: [0.57, 1.95, -0.31], fov: 40 }
    }
  };
})();
