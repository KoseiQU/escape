/* ESCAPE — P5e-0 案E「肥大した作業員」3Dコンセプトモック
 * 元保守員の男。水で膨れた体、防護服の残骸が皮膚に癒着し境が溶けている。
 * 胸から腹が縦に裂けて肋骨と湿った内臓の暗がりが見える。頭は肩に沈み、目は膨れて充血。
 * 腕が異様に長く、鎖付きの鉤を引きずる。
 * 契約 DESIGN.md §4「P5e エリア2の敵 — 段階0」。原点＝足元・+Y上・正面 −Z。
 */
(function () {
  'use strict';
  var L = ESCAPE.__A2LIB;

  var ANK = 0.095, KNEE = 0.505, HIP = 0.930, SHOULDER = 1.585;
  var HEADY = 1.690, HRX = 0.125, HRY = 0.146, HRZ = 0.136;
  var SPLIT_TOP = 1.500, SPLIT_BOT = 1.010;

  function mats() {
    var M = {};
    /* 水で膨れた皮膚: 張って光り、死斑と血管が透ける */
    M.skin = L.skin({ seed: 501, base: '#a6aea2', dark: 'rgba(52,60,58,', veinColor: 'rgba(72,56,96,0.46)',
      mottle: 210, vein: 96, wrinkle: 150, pore: 0.30, bump: 2.0, roughLo: 0.14, roughHi: 0.52,
      tint: 0xa6c8cc, repeat: [4, 4] });
    M.face = L.skin({ seed: 503, base: '#9aa498', dark: 'rgba(48,58,54,', veinColor: 'rgba(92,54,62,0.40)',
      mottle: 260, vein: 150, wrinkle: 220, pore: 0.42, bump: 1.4, roughLo: 0.16, roughHi: 0.56,
      tint: 0x9cbcc0, repeat: [5, 4], nscale: 0.7 });
    /* 防護服の残骸（黄ばんだゴム引き布） */
    M.suit = L.skin({ seed: 507, base: '#6e6440', dark: 'rgba(28,26,14,', veinColor: 'rgba(44,40,22,0.5)',
      mottle: 160, vein: 26, wrinkle: 300, pore: 0.24, bump: 3.2, roughLo: 0.34, roughHi: 0.94,
      tint: 0xbcb884, repeat: [2, 2], side: THREE.DoubleSide });
    M.flesh = L.skin({ seed: 509, base: '#4a2220', dark: 'rgba(16,4,6,', veinColor: 'rgba(126,30,32,0.55)',
      mottle: 170, vein: 120, wrinkle: 300, pore: 0.34, bump: 4.0, roughLo: 0.10, roughHi: 0.40,
      tint: 0x6e3630, repeat: [2, 2] });
    M.rib = L.mat(0xbcb49a, 0.52, 0.02);
    M.void = L.mat(0x040506, 1.0, 0);
    M.eye = L.mat(0x9c9782, 0.88, 0.0);
    M.eyeVein = L.mat(0x43100f, 0.86, 0.0);
    M.nail = L.mat(0x6c6a56, 0.40, 0.14);
    M.iron = L.mat(0x2e2e2a, 0.48, 0.85);
    return M;
  }

  /* 胴: 水で膨れた樽。皮膚が張り、正中が縦に裂ける。 */
  function trunk(M, g) {
    var yb = HIP - 0.190, yt = SHOULDER + 0.045, cy = (yb + yt) / 2, hy = (yt - yb) / 2;
    var T = [[1, 0.90, 0.80], [0.70, 1.00, 0.92], [0.30, 1.06, 1.04], [-0.10, 1.10, 1.10],
      [-0.50, 1.02, 1.00], [-1, 0.72, 0.68]];
    var geo = new THREE.SphereGeometry(1, 44, 34);
    geo.scale(0.315, hy, 0.255);
    L.deform(geo, function (x, y, z, o) {
      var ny = L.clamp(y / hy, -1, 1);
      var k = (function (n) {
        for (var i = 0; i < T.length - 1; i++) {
          if (n <= T[i][0] && n >= T[i + 1][0]) {
            var t = (T[i][0] - n) / (T[i][0] - T[i + 1][0]);
            return [T[i][1] + (T[i + 1][1] - T[i][1]) * t, T[i][2] + (T[i + 1][2] - T[i][2]) * t];
          }
        }
        return [T[0][1], T[0][2]];
      })(ny);
      o[0] = x * k[0] * (1 + 0.045 * ny);
      o[2] = z * k[1] * (z < 0 ? 1.04 : 0.96);
      o[1] = y;
    });
    /* 張った皮膚に浮く肋の輪郭と、腹の水の溜まり */
    for (var i = 0; i < 5; i++) {
      var ry = hy * (0.56 - i * 0.105);
      L.ridge(geo, [0.075, ry, -0.235], [0.255, ry - 0.035, -0.085], 0.052, 0.0075, 1.5);
      L.ridge(geo, [-0.072, ry - 0.008, -0.233], [-0.252, ry - 0.044, -0.083], 0.050, 0.0068, 1.5);
    }
    L.bulge(geo, [0, -hy * 0.42, -0.230], 0.140, 0.026);           /* 腹の膨隆 */
    L.bulge(geo, [0, hy * 0.88, 0.040], 0.130, -0.030);            /* 頭が沈む肩の窪み */
    L.ridge(geo, [0, hy * 0.30, 0.250], [0, -hy * 0.50, 0.235], 0.055, -0.018, 1.4);
    /* 縦の裂け目（胸から腹へ）: 中央を深く抉り、縁を捲る */
    var st = (SPLIT_TOP - cy) / 1, sb = (SPLIT_BOT - cy) / 1;
    L.ridge(geo, [0, st, -0.250], [0, sb, -0.250], 0.075, -0.135, 1.05);
    L.ridge(geo, [0.080, st + 0.02, -0.225], [0.072, sb - 0.01, -0.225], 0.046, 0.040, 1.5);
    L.ridge(geo, [-0.078, st, -0.223], [-0.068, sb - 0.02, -0.223], 0.044, 0.034, 1.5);
    L.warp(geo, 0.009, 7, 9);
    g.add(L.m(geo, M.skin, [0, cy, 0]));
    return cy;
  }

  /* 裂け目の内側: V字の谷として実体を作る（肋骨の断端・濡れた内臓・暗がり） */
  function guts(M, g) {
    var N = 16, Lft = [], Rgt = [], Bot = [], Bot2 = [], R = L.rng(521);
    for (var i = 0; i <= N; i++) {
      var t = i / N, y = SPLIT_TOP - (SPLIT_TOP - SPLIT_BOT) * t;
      var w = 0.082 * Math.sin(Math.PI * Math.pow(t, 0.85)) + 0.012;   /* 中ほどが最も開く */
      var zEdge = -0.262 + 0.020 * Math.abs(t - 0.5);
      var zBot = -0.118 - 0.016 * Math.sin(Math.PI * t);
      Lft.push([w * (1 + 0.10 * R()), y, zEdge]);
      Rgt.push([-w * (1 + 0.10 * R()), y, zEdge]);
      Bot.push([0.006 * Math.sin(t * 9), y, zBot]);
      Bot2.push([-0.006 * Math.sin(t * 9), y, zBot]);
    }
    g.add(L.m(L.strip(Lft, Bot), M.flesh));
    g.add(L.m(L.strip(Bot, Lft), M.flesh));
    g.add(L.m(L.strip(Bot2, Rgt), M.flesh));
    g.add(L.m(L.strip(Rgt, Bot2), M.flesh));
    /* 谷の底の暗がり */
    g.add(L.m(L.ell(0.026, (SPLIT_TOP - SPLIT_BOT) / 2, 0.030, 14), M.void,
      [0, (SPLIT_TOP + SPLIT_BOT) / 2, -0.108]));
    /* 肋骨の断端（両壁から折れて覗く） */
    for (var r = 0; r < 5; r++) {
      var yy = SPLIT_TOP - 0.045 - r * 0.082;
      [1, -1].forEach(function (sgn) {
        var tor = new THREE.TorusGeometry(0.048 + r * 0.004, 0.0105, 6, 12, 1.05);
        g.add(L.m(tor, M.rib, [sgn * 0.052, yy, -0.196],
          [0.15 + r * 0.05, sgn > 0 ? -0.9 : Math.PI + 0.9, sgn > 0 ? 0.65 : -0.65]));
      });
    }
    /* 濡れた内臓（谷の底に詰まる） */
    for (var j = 0; j < 8; j++) {
      var y2 = SPLIT_TOP - 0.055 - j * 0.055;
      g.add(L.m(L.ell(0.024 + R() * 0.012, 0.022 + R() * 0.010, 0.022, 12), M.flesh,
        [(R() - 0.5) * 0.038, y2, -0.150 + (R() - 0.5) * 0.024]));
    }
    var pts = [];
    for (var k = 0; k < 7; k++) pts.push([Math.sin(k * 1.7) * 0.028, SPLIT_BOT + 0.13 - k * 0.026, -0.168 + Math.cos(k * 1.3) * 0.014]);
    g.add(L.m(L.tube(pts, 0.016, 7), M.flesh));
    /* 裂けた皮膚の縁（捲れて垂れる） */
    [1, -1].forEach(function (sg) {
      var fl = new THREE.PlaneGeometry(0.040, 0.13, 2, 4);
      L.deform(fl, function (x, y, z, o) { o[2] = z + Math.sin(y * 18) * 0.010; o[0] = x * (1 - 0.45 * Math.max(0, -y / 0.13)); });
      var mm = L.m(fl, M.skin, [sg * 0.100, SPLIT_BOT + 0.06, -0.252], [0.20, sg * 0.9, sg * 0.25]);
      mm.material.side = THREE.DoubleSide;
      g.add(mm);
    });
  }

  /* 肩に沈んだ頭。目は膨れて眼窩から押し出され、充血する。 */
  function head(M) {
    var g = new THREE.Group();
    var sk = L.headShell({ rx: HRX, ry: HRY, rz: HRZ, seg: 58, socket: 0.027, eye: 0.011,
      temple: 0.013, cheek: 0.004, nose: 0.017, jaw: 0.82, chin: 0.011, brow: 0.017,
      warp: 0.0030, seed: 51 });
    /* 水で膨れた顔: 頬・顎下・額が張る */
    L.bulge(sk, [0.085, -0.052, -0.085], 0.058, 0.009);
    L.bulge(sk, [-0.082, -0.058, -0.083], 0.056, 0.011);
    L.bulge(sk, [0, -0.112, -0.062], 0.072, 0.014);
    L.bulge(sk, [0, 0.092, -0.088], 0.070, 0.005);
    /* 開いたままの口（下顎が落ち、口腔が奥へ抜ける） */
    L.ridge(sk, [0.036, -0.086, -0.100], [-0.035, -0.090, -0.100], 0.030, -0.040, 1.2);
    L.ridge(sk, [0.040, -0.066, -0.100], [-0.039, -0.070, -0.100], 0.015, 0.008, 1.6);
    L.ridge(sk, [0.038, -0.108, -0.098], [-0.037, -0.112, -0.098], 0.016, 0.010, 1.6);
    L.bulge(sk, [-0.070, -0.078, -0.088], 0.048, 0.013);      /* 片側だけ垂れる頬 */
    L.bulge(sk, [0.062, 0.052, -0.086], 0.036, -0.010);        /* 片側の眉が落ちる */
    L.ridge(sk, [0.100, -0.066, -0.058], [0.030, -0.116, -0.086], 0.026, -0.009, 1.5);
    L.ridge(sk, [-0.098, -0.074, -0.054], [-0.028, -0.122, -0.084], 0.024, -0.011, 1.5);
    L.warp(sk, 0.0030, 13, 17);
    g.add(L.m(sk, M.face));
    /* 眼球: 眼窩から押し出されて膨れる。ハイライトは入れない（粗い材質） */
    [[0.056, 0.008, -0.093, 1], [-0.054, 0.000, -0.094, -1]].forEach(function (p, i) {
      var eg = L.ell(0.0205 + i * 0.0010, 0.0198, 0.0195, 18);
      L.warp(eg, 0.0012, 40, 60 + i);
      g.add(L.m(eg, M.eye, [p[0], p[1], p[2]]));
      /* 充血: 眼球を這う血管 */
      var R = L.rng(600 + i * 13);
      for (var v = 0; v < 7; v++) {
        var a0 = R() * 6.284, pts = [];
        for (var q = 0; q < 4; q++) {
          var a = a0 + q * 0.35, r = 0.0205 * (0.30 + q * 0.24);
          pts.push([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.9, p[2] - Math.sqrt(Math.max(0, 1 - (r / 0.0215) * (r / 0.0215) * 0.9)) * 0.0182]);
        }
        g.add(L.m(L.tube(pts, 0.0008 + R() * 0.0006, 4), M.eyeVein));
      }
      /* 瞳（白濁して濁る・光らせない） */
      g.add(L.m(L.ell(0.0062, 0.0060, 0.004, 12), M.void, [p[0] + p[3] * 0.002, p[1] - 0.001, p[2] - 0.0185]));
      /* 瞼が眼球に押し上げられて捲れる */
      /* 瞼: 眼球に押し上げられて上下から半ば覆う */
      var ul = L.ell(0.027, 0.016, 0.024, 16);
      L.deform(ul, function (x, y, z, o) { o[1] = y * (y > 0 ? 1 : 0.35); });
      g.add(L.m(ul, M.face, [p[0], p[1] + 0.0135, p[2] + 0.003], [0.30, 0, p[3] * 0.18]));
      var ll = L.ell(0.026, 0.014, 0.023, 16);
      L.deform(ll, function (x, y, z, o) { o[1] = y * (y < 0 ? 1 : 0.30); });
      g.add(L.m(ll, M.face, [p[0], p[1] - 0.0155, p[2] + 0.004], [-0.22, 0, p[3] * 0.12]));
    });
    /* 口腔と歯（数本が残る） */
    g.add(L.m(L.ell(0.036, 0.022, 0.034, 16), M.void, [0, -0.092, -0.072]));
    L.teeth(g, M.rib, 7, function (t) {
      return [(t - 0.5) * 0.060, -0.081, -0.093 + 0.010 * (t - 0.5) * (t - 0.5) * 4];
    }, [0.0044, 0.0092], 55, 0.5);
    /* 鼻腔・耳 */
    g.add(L.m(L.ell(0.0105, 0.0125, 0.011, 10), M.void, [0.015, -0.052, -0.121]));
    g.add(L.m(L.ell(0.0098, 0.0120, 0.011, 10), M.void, [-0.014, -0.055, -0.121]));
    g.add(L.m(new THREE.TorusGeometry(0.022, 0.0075, 6, 16, 4.2), M.face, [0.120, -0.018, -0.002], [0.2, 1.5, 0.7]));
    g.add(L.m(new THREE.TorusGeometry(0.020, 0.0068, 6, 16, 3.6), M.face, [-0.119, -0.026, 0.002], [0.1, -1.5, -0.8]));
    return g;
  }

  /* 皮膚に癒着した防護服の断片: 体の楕円体に沿う殻（縁は不揃いに欠ける） */
  function suitShell(M, g, center, radii, phi0, phiLen, th0, thLen, seed) {
    var R = L.rng(seed);
    var q = new THREE.SphereGeometry(1, 16, 14, phi0, phiLen, th0, thLen);
    q.scale(radii[0], radii[1], radii[2]);
    L.deform(q, function (x, y, z, o) {
      var d = Math.sqrt(x * x + y * y + z * z) || 1;
      var k = 1 + 0.010 * Math.sin(x * 26 + y * 17) + 0.006 * Math.sin(z * 33);
      o[0] = x * k; o[1] = y * k; o[2] = z * k;
    });
    /* 縁を内側へ引き込み、皮膚との境を溶かす */
    var m = L.m(q, M.suit, center);
    m.material.side = THREE.DoubleSide;
    g.add(m);
  }

  function limb(g, mw, from, to, r0, r1, belly) {
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var geo = new THREE.CylinderGeometry(1, 1, len, 14, 14, false);
    geo.translate(0, len / 2, 0);
    L.deform(geo, function (x, y, z, o) {
      var t = L.clamp(y / len, 0, 1), r = r0 + (r1 - r0) * t;
      r *= 1 + (belly === undefined ? 0.14 : belly) * Math.sin(Math.PI * Math.pow(t, 0.8));
      var d = Math.sqrt(x * x + z * z) || 1;
      o[0] = x / d * r; o[2] = z / d * r;
    });
    var mesh = L.m(geo, mw, from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    g.add(mesh);
  }

  function build(THREE) {
    var M = mats(), root = new THREE.Group(), R = L.rng(777);
    var cy = trunk(M, root);
    guts(M, root);

    /* 脚: 水で膨れて太い。膝から下は水に浸かってふやける。 */
    [1, -1].forEach(function (s) {
      var hipP = [s * 0.132, HIP - 0.070, -0.010];
      var kneeP = [s * (s > 0 ? 0.150 : 0.128), KNEE, s > 0 ? -0.070 : 0.055];
      var ankP = [s * (s > 0 ? 0.148 : 0.120), ANK, s > 0 ? -0.010 : 0.115];
      limb(root, M.skin, hipP, kneeP, 0.128, 0.088, 0.16);
      root.add(L.m(L.ell(0.086, 0.082, 0.090, 16), M.skin, kneeP));
      limb(root, M.skin, kneeP, ankP, 0.092, 0.062, 0.20);
      root.add(L.m(L.ell(0.064, 0.056, 0.064, 14), M.skin, ankP));
      var ft = L.ell(0.072, 0.044, 0.132, 16);
      L.deform(ft, function (x, y, z, o) { o[1] = y * (1 - 0.4 * Math.max(0, -z / 0.132)); });
      root.add(L.m(ft, M.skin, [ankP[0], 0.042, ankP[2] - 0.070], [0, s * 0.10, 0]));
      for (var t = 0; t < 5; t++) {
        root.add(L.m(L.ell(0.0155, 0.0130, 0.026, 8), M.skin,
          [ankP[0] + (t - 2) * 0.027, 0.026, ankP[2] - 0.185 + Math.abs(t - 2) * 0.010]));
      }
      /* 太腿に癒着した防護服の裾 */
      suitShell(M, root, [s * 0.140, HIP - 0.170, -0.010], [0.150, 0.190, 0.150], s > 0 ? 2.05 : 3.45, 1.55, 0.30, 1.30, 900 + s * 11);
    });

    /* 胴に癒着した防護服の板（胸・背・肩） */
    suitShell(M, root, [0, cy + 0.140, 0], [0.330, 0.300, 0.272], 2.35, 1.05, 0.55, 1.10, 941);
    suitShell(M, root, [0, cy - 0.130, 0], [0.335, 0.300, 0.275], 3.95, 0.95, 0.75, 1.05, 947);
    suitShell(M, root, [0, cy + 0.060, 0], [0.340, 0.330, 0.280], 5.55, 1.60, 0.60, 1.35, 953);
    suitShell(M, root, [0, cy + 0.300, 0], [0.325, 0.280, 0.270], 1.55, 0.70, 0.35, 0.60, 959);
    /* 肩の金具とベルトの残骸 */
    root.add(L.m(new THREE.TorusGeometry(0.030, 0.010, 6, 14), M.iron, [0.240, SHOULDER - 0.020, -0.150], [0.4, -0.5, 0.3]));
    root.add(L.m(new THREE.BoxGeometry(0.062, 0.030, 0.016), M.iron, [-0.215, cy - 0.150, -0.205], [0, 0.4, 0.15]));

    /* 肩（頭が沈むよう高く盛る） */
    [1, -1].forEach(function (s) {
      root.add(L.m(L.ell(0.125, 0.110, 0.118, 18), M.skin, [s * 0.240, SHOULDER - 0.010, -0.010], [0, 0, -s * 0.24]));
      root.add(L.m(L.ell(0.088, 0.062, 0.086, 14), M.skin, [s * 0.130, SHOULDER + 0.048, -0.010]));
    });
    /* 鎖骨（膨れた皮膚の下に沈む） */
    root.add(L.m(L.tube([[0.020, SHOULDER - 0.075, -0.180], [0.130, SHOULDER - 0.050, -0.140], [0.225, SHOULDER - 0.070, -0.060]], 0.017, 7), M.skin));
    root.add(L.m(L.tube([[-0.020, SHOULDER - 0.080, -0.180], [-0.126, SHOULDER - 0.058, -0.136], [-0.220, SHOULDER - 0.080, -0.058]], 0.016, 7), M.skin));

    /* 異様に長い腕（手は膝より下） */
    [1, -1].forEach(function (s) {
      var sh = [s * 0.258, SHOULDER - 0.055, -0.020];
      var el = s > 0 ? [0.352, 0.905, 0.060] : [-0.336, 0.880, -0.085];
      var wr = s > 0 ? [0.330, 0.330, -0.070] : [-0.372, 0.300, 0.035];
      limb(root, M.skin, sh, el, 0.092, 0.062, 0.20);
      root.add(L.m(L.ell(0.062, 0.058, 0.062, 14), M.skin, el));
      limb(root, M.skin, el, wr, 0.064, 0.046, 0.22);
      var hand = new THREE.Group();
      hand.add(L.m(L.ell(0.056, 0.070, 0.028, 16), M.skin, [0, -0.058, 0]));
      for (var f = 0; f < 4; f++) {
        var fx = (f - 1.5) * 0.030, spread = (f - 1.5) * 0.14, y0 = -0.112, zz = 0;
        for (var k = 0; k < 3; k++) {
          var l2 = 0.052 * (1 - k * 0.20);
          var mm = L.m(L.seg(0.0155 - k * 0.0026, 0.0138 - k * 0.0026, l2, 8), M.skin, [fx + spread * 0.018 * k, y0, zz]);
          mm.rotation.order = 'ZXY'; mm.rotation.z = spread * 0.45; mm.rotation.x = 0.30 + k * (s > 0 ? 0.62 : 0.22);
          hand.add(mm);
          hand.add(L.m(L.ell(0.0165 - k * 0.0026, 0.0150, 0.0160 - k * 0.0026, 10), M.skin, [fx + spread * 0.018 * k, y0, zz]));
          y0 -= l2 * 0.88; zz -= (s > 0 ? 0.016 : 0.004) * (k + 1);
          if (k === 2) hand.add(L.m(L.ell(0.0090, 0.0140, 0.0070, 8), M.nail, [fx + spread * 0.018 * k, y0 + 0.006, zz - 0.012]));
        }
      }
      var th = L.m(L.seg(0.0170, 0.0130, 0.060, 8), M.skin, [-s * 0.046, -0.078, 0.014]);
      th.rotation.z = s * 1.10; hand.add(th);
      hand.position.set(wr[0], wr[1], wr[2]);
      hand.rotation.set(s > 0 ? 0.30 : 0.05, 0, s > 0 ? 0.18 : -0.30);
      root.add(hand);
      if (s > 0) root.__grip = wr;
    });

    /* 鎖と鉤（右手から床へ垂れ、後ろへ引きずられる） */
    var chain = new THREE.Group();
    var gx = 0.330, gy = 0.255, gz = -0.105;
    var N = 16;
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1);
      var x = gx + 0.055 * t, y = gy * (1 - t) * (1 - t) + 0.028, z = gz + 0.62 * t * t + 0.05 * t;
      var lk = new THREE.TorusGeometry(0.030, 0.0092, 5, 12);
      chain.add(L.m(lk, M.iron, [x, y, z], [i % 2 ? 1.57 : 0, 0.35 + t * 0.5, 0.30 - t * 0.25]));
    }
    /* 鉤（床に転がる） */
    var hk = [];
    for (var h = 0; h <= 14; h++) {
      var a = -0.5 + h / 14 * 4.2;
      hk.push([gx + 0.075 + Math.cos(a) * 0.085, 0.030 + Math.sin(a) * 0.030 * 0.5, gz + 0.70 + Math.sin(a) * 0.085]);
    }
    chain.add(L.m(L.tube(hk, 0.0135, 7), M.iron));
    chain.add(L.m(L.seg(0.014, 0.002, 0.075, 7), M.iron, [gx + 0.160, 0.030, gz + 0.640], [1.2, 0.6, 0]));
    root.add(chain);

    /* 頭（肩に沈む） */
    var hd = head(M);
    hd.position.set(-0.020, HEADY, -0.035);
    hd.rotation.set(0.14, -0.16, 0.07);
    root.add(hd);
    /* 首は見えないほど短い（顎下の肉が肩に繋がる） */
    root.add(L.m(L.ell(0.105, 0.070, 0.100, 16), M.skin, [-0.010, HEADY - 0.120, -0.020]));
    return root;
  }

  ESCAPE.__A2MOCKS.E = {
    name: '案E 肥大した作業員',
    build: build,
    cams: {
      full: { pos: [0.46, 1.28, -2.48], look: [0.02, 1.02, 0.02], fov: 50 },
      face: { pos: [0.16, 1.755, -0.70], look: [-0.02, 1.682, -0.02], fov: 34 }
    }
  };
})();
