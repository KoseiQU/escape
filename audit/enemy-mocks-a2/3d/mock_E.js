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
  var SPLIT_TOP = 1.455, SPLIT_BOT = 1.010;

  function mats() {
    var M = {};
    /* 水で膨れた皮膚: 蒼白の地に死斑と血管。metalness 0。引き伸ばされた所だけ粗さが低い。 */
    M.skin = L.skin({ seed: 501, base: '#5f645b', dark: 'rgba(14,18,18,', veinColor: 'rgba(62,48,84,0.50)',
      mottle: 300, vein: 160, wrinkle: 300, pore: 0.50, bump: 4.6, roughLo: 0.24, roughHi: 0.90,
      tint: 0x939e95, metalness: 0, repeat: [4, 4], nscale: 1.55 });
    M.face = L.skin({ seed: 503, base: '#5e635b', dark: 'rgba(12,16,16,', veinColor: 'rgba(84,46,54,0.45)',
      mottle: 340, vein: 210, wrinkle: 420, pore: 0.62, bump: 4.4, roughLo: 0.22, roughHi: 0.90,
      tint: 0x939e95, metalness: 0, repeat: [5, 4], nscale: 1.7 });
    /* 防護服の残骸（汚れた黄灰の PVC 布地） */
    M.suit = L.skin({ seed: 507, base: '#49452a', dark: 'rgba(16,15,8,', veinColor: 'rgba(38,34,18,0.5)',
      mottle: 180, vein: 30, wrinkle: 340, pore: 0.26, bump: 3.4, roughLo: 0.40, roughHi: 0.96,
      tint: 0x8b855f, metalness: 0, repeat: [3, 3], side: THREE.DoubleSide });
    /* 反射帯の名残（褪せて汚れた銀灰） */
    M.band = L.mat(0x6a6d66, 0.52, 0.06);
    M.flesh = L.skin({ seed: 509, base: '#2c1112', dark: 'rgba(8,2,3,', veinColor: 'rgba(110,26,28,0.55)',
      mottle: 180, vein: 130, wrinkle: 320, pore: 0.36, bump: 4.2, roughLo: 0.22, roughHi: 0.58,
      tint: 0x37160f, metalness: 0, repeat: [3, 3] });
    M.rib = L.mat(0x8e8970, 0.58, 0);
    M.void = new THREE.MeshBasicMaterial({ color: 0x000000 });
    M.eye = L.mat(0x585446, 0.92, 0);          /* 白濁して濁った眼球。ハイライト無し。 */
    M.eyeVein = L.mat(0x3a0d0c, 0.90, 0);
    M.gum = L.mat(0x2c1211, 0.52, 0);
    M.tooth = L.mat(0x6e6754, 0.50, 0);
    M.hairM = L.mat(0x090a0a, 0.66, 0);
    M.nail = L.mat(0x55533f, 0.46, 0);
    M.iron = L.mat(0x39372f, 0.52, 0.70);
    return M;
  }

  /* 胴: 水で膨れた樽。皮膚が張り、正中が縦に裂ける。 */
  function trunk(M, g) {
    var yb = HIP - 0.190, yt = SHOULDER + 0.045, cy = (yb + yt) / 2, hy = (yt - yb) / 2;
    var T = [[1, 0.90, 0.80], [0.70, 1.00, 0.92], [0.30, 1.06, 1.04], [-0.10, 1.10, 1.10],
      [-0.50, 1.02, 1.00], [-1, 0.72, 0.68]];
    var geo = new THREE.SphereGeometry(1, 30, 22);
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
    L.ridge(geo, [0, st, -0.250], [0, sb, -0.250], 0.105, -0.150, 1.02);
    L.ridge(geo, [0.112, st + 0.02, -0.215], [0.100, sb - 0.01, -0.215], 0.050, 0.046, 1.5);
    L.ridge(geo, [-0.108, st, -0.213], [-0.096, sb - 0.02, -0.213], 0.048, 0.038, 1.5);
    L.warp(geo, 0.009, 7, 9);
    g.add(L.m(geo, M.skin, [0, cy, 0]));
    return cy;
  }

  /* 裂け目の内側: V字の谷として実体を作る（肋骨の断端・濡れた内臓・暗がり） */
  function guts(M, g) {
    var N = 16, Lft = [], Rgt = [], Bot = [], Bot2 = [], R = L.rng(521);
    for (var i = 0; i <= N; i++) {
      var t = i / N, y = SPLIT_TOP - (SPLIT_TOP - SPLIT_BOT) * t;
      var w = 0.118 * Math.sin(Math.PI * Math.pow(t, 0.85)) + 0.016;   /* 中ほどが最も開く */
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
        var tor = new THREE.TorusGeometry(0.062 + r * 0.005, 0.0125, 6, 14, 1.15);
        g.add(L.m(tor, M.rib, [sgn * 0.066, yy, -0.206],
          [0.15 + r * 0.05, sgn > 0 ? -0.9 : Math.PI + 0.9, sgn > 0 ? 0.65 : -0.65]));
      });
    }
    /* 濡れた内臓（谷の底に詰まる） */
    for (var j = 0; j < 8; j++) {
      var y2 = SPLIT_TOP - 0.055 - j * 0.055;
      g.add(L.m(L.ell(0.024 + R() * 0.012, 0.022 + R() * 0.010, 0.022, 9), M.flesh,
        [(R() - 0.5) * 0.038, y2, -0.150 + (R() - 0.5) * 0.024]));
    }
    var pts = [];
    for (var k = 0; k < 7; k++) pts.push([Math.sin(k * 1.7) * 0.028, SPLIT_BOT + 0.13 - k * 0.026, -0.168 + Math.cos(k * 1.3) * 0.014]);
    g.add(L.m(L.tube(pts, 0.016, 7), M.flesh));
    /* 裂けた皮膚の縁（捲れて垂れる） */
    [1, -1].forEach(function (sg) {
      var fl = new THREE.PlaneGeometry(0.040, 0.13, 2, 4);
      L.deform(fl, function (x, y, z, o) { o[2] = z + Math.sin(y * 18) * 0.010; o[0] = x * (1 - 0.45 * Math.max(0, -y / 0.13)); });
      var mm = L.m(fl, M.skin, [sg * 0.134, SPLIT_BOT + 0.06, -0.238], [0.20, sg * 1.1, sg * 0.28]);
      mm.material.side = THREE.DoubleSide;
      g.add(mm);
    });
  }

  /* 肩に沈んだ頭。目は膨れて眼窩から押し出され、充血する。 */
  function head(M) {
    var g = new THREE.Group(), X = HRX, Y = HRY, Z = HRZ;
    /* 頭蓋から積む: 眉弓を重く、頬骨・下顎を彫り、眼窩は骨の縁が立った深い窪み */
    var sk = L.headShell({ rx: X, ry: Y, rz: Z, seg: 50, socket: 0.052, eye: 0.004,
      temple: 0.030, cheek: 0.020, nose: 0.020, jaw: 0.78, chin: 0.013, brow: 0.040,
      warp: 0.0030, seed: 51 });
    /* 脳頭蓋を低く潰し、額を後退させる（眉の上がすぐ生え際） */
    L.deform(sk, function (x, y, z, o) {
      var t = L.clamp((y / Y - 0.28) / 0.72, 0, 1);
      o[1] = y - Y * 0.30 * t * t;
      o[2] = z + Z * 0.22 * t * t * (z < 0 ? 1 : -0.3);
      o[0] = x * (1 - 0.10 * t * t);
    });
    /* 眉弓（庇）: 左右で高さと厚みが違う */
    L.ridge(sk, [X * 0.10, Y * 0.40, -Z * 0.86], [X * 0.86, Y * 0.30, -Z * 0.48], X * 0.32, 0.021, 1.5);
    L.ridge(sk, [-X * 0.10, Y * 0.36, -Z * 0.86], [-X * 0.80, Y * 0.22, -Z * 0.48], X * 0.28, 0.016, 1.5);
    /* こめかみを抉り、頬骨弓を張らせ、その下を落とす */
    L.bulge(sk, [X * 0.96, Y * 0.30, -Z * 0.30], 0.058, -0.022);
    L.bulge(sk, [-X * 0.94, Y * 0.24, -Z * 0.32], 0.055, -0.026);
    L.ridge(sk, [X * 0.66, Y * 0.00, -Z * 0.70], [X * 0.98, Y * 0.10, Z * 0.20], X * 0.24, 0.015, 1.8);
    L.ridge(sk, [-X * 0.62, -Y * 0.04, -Z * 0.68], [-X * 0.94, Y * 0.06, Z * 0.18], X * 0.22, 0.012, 1.8);
    L.ridge(sk, [X * 0.62, -Y * 0.22, -Z * 0.62], [X * 0.92, -Y * 0.12, Z * 0.14], X * 0.18, -0.010, 1.6);
    /* 眼窩: 皮膚側も深く落とし、周囲の骨縁を立てる（左右非対称） */
    L.bulge(sk, [X * 0.46, Y * 0.14, -Z * 0.80], 0.058, 0.011);
    L.bulge(sk, [X * 0.46, Y * 0.14, -Z * 0.80], 0.041, -0.040);
    L.bulge(sk, [-X * 0.46, Y * 0.10, -Z * 0.80], 0.054, 0.009);
    L.bulge(sk, [-X * 0.46, Y * 0.10, -Z * 0.80], 0.038, -0.036);
    /* 水で膨れた部位（額・頬の下・顎下）が張る。片側だけ大きく垂れる。 */
    L.bulge(sk, [X * 0.58, -Y * 0.44, -Z * 0.58], 0.062, 0.016);
    L.bulge(sk, [-X * 0.62, -Y * 0.52, -Z * 0.54], 0.066, 0.024);
    L.bulge(sk, [0, -Y * 0.86, -Z * 0.40], 0.080, 0.020);
    L.bulge(sk, [X * 0.30, Y * 0.72, -Z * 0.62], 0.062, 0.010);
    /* 下顎角を張らせ、輪郭を四角くする */
    L.bulge(sk, [X * 0.80, -Y * 0.62, -Z * 0.24], 0.046, 0.014);
    L.bulge(sk, [-X * 0.76, -Y * 0.66, -Z * 0.22], 0.044, 0.011);
    /* 開いたままの口（下顎が落ち、口腔が奥へ抜ける） */
    L.ridge(sk, [X * 0.28, -Y * 0.60, -Z * 0.78], [-X * 0.27, -Y * 0.62, -Z * 0.78], 0.030, -0.042, 1.2);
    L.ridge(sk, [X * 0.32, -Y * 0.44, -Z * 0.78], [-X * 0.31, -Y * 0.46, -Z * 0.78], 0.015, 0.009, 1.6);
    L.ridge(sk, [X * 0.30, -Y * 0.76, -Z * 0.76], [-X * 0.29, -Y * 0.78, -Z * 0.76], 0.016, 0.010, 1.6);
    /* 鼻唇溝と、膨れた皮膚に走る深い皺 */
    L.ridge(sk, [X * 0.18, -Y * 0.22, -Z * 0.84], [X * 0.44, -Y * 0.62, -Z * 0.66], 0.018, -0.009, 1.6);
    L.ridge(sk, [-X * 0.17, -Y * 0.24, -Z * 0.84], [-X * 0.42, -Y * 0.66, -Z * 0.64], 0.017, -0.008, 1.6);
    L.warp(sk, 0.0032, 13, 17);
    g.add(L.m(sk, M.face));

    /* 眼: 小さく白濁し、腫れた瞼で半分以上隠れ、影に沈む。ハイライト無し。 */
    [[X * 0.46, Y * 0.14, -Z * 0.74, 1, 1.00], [-X * 0.46, Y * 0.10, -Z * 0.74, -1, 0.92]].forEach(function (p, i) {
      var er = 0.0126 * p[4];
      var eg = L.ell(er, er * 0.94, er * 0.92, 12);
      L.warp(eg, 0.0009, 44, 60 + i);
      g.add(L.m(eg, M.eye, [p[0], p[1], p[2]]));
      var R = L.rng(600 + i * 13);
      for (var v = 0; v < 6; v++) {
        var a0 = R() * 6.284, pts = [];
        for (var q = 0; q < 4; q++) {
          var a = a0 + q * 0.38, r = er * (0.28 + q * 0.22);
          pts.push([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.9,
            p[2] - Math.sqrt(Math.max(0, 1 - (r / er) * (r / er) * 0.9)) * er * 0.86]);
        }
        g.add(L.m(L.tube(pts, 0.0006 + R() * 0.0005, 4), M.eyeVein));
      }
      g.add(L.m(L.ell(er * 0.34, er * 0.32, er * 0.28, 10), M.void, [p[0] + p[3] * 0.0015, p[1] - 0.0008, p[2] - er * 0.88]));
      /* 腫れた瞼（上は 60% 覆う・下は袋状に垂れる） */
      var ul = L.ell(er * 2.3, er * 1.9, er * 2.1, 13);
      L.deform(ul, function (x, y, z, o) { o[1] = y * (y > 0 ? 1.15 : 0.34) + 0.0035 * Math.sin(x * 46); });
      g.add(L.m(ul, M.face, [p[0], p[1] + er * 0.62, p[2] + er * 0.34], [0.24, 0, p[3] * 0.22]));
      var ll = L.ell(er * 2.2, er * 1.7, er * 2.0, 13);
      L.deform(ll, function (x, y, z, o) { o[1] = y * (y < 0 ? 1.10 : 0.30); });
      g.add(L.m(ll, M.face, [p[0], p[1] - er * 0.92, p[2] + er * 0.40], [-0.20, 0, p[3] * 0.14]));
      /* 眼窩の縁の影（瞼の上に落ちる庇の陰） */
      g.add(L.m(L.ell(er * 2.7, er * 0.46, er * 1.1, 10), M.void,
        [p[0], p[1] + er * 1.92, p[2] + er * 0.55]));
    });

    /* 口腔（奥へ抜ける闇）・歯茎・1本ずつ植わる不揃いの歯 */
    var mo = L.ell(0.036, 0.026, 0.038, 16, 12);
    L.deform(mo, function (x, y, z, o) {
      o[0] = x * (1 + 0.22 * Math.sin(y * 90)); o[1] = y * (1 + 0.18 * Math.sin(x * 70));
    });
    g.add(L.m(mo, M.void, [0.004, -Y * 0.62, -Z * 0.48], [0.10, 0.10, 0.08]));
    /* 垂れた下唇と、片側だけ捲れた上唇 */
    var lipL = [];
    for (var q2 = 0; q2 <= 10; q2++) {
      var t4 = q2 / 10;
      lipL.push([(-0.036 + 0.072 * t4), -Y * 0.80 - 0.006 * Math.sin(Math.PI * t4) + ((q2 % 3) - 1) * 0.0015,
        -Z * 0.72 + 0.020 * (t4 - 0.5) * (t4 - 0.5) * 4]);
    }
    g.add(L.m(L.tube(lipL, 0.0085, 7), M.face));
    var lipU = [];
    for (var q3 = 0; q3 <= 10; q3++) {
      var t5 = q3 / 10;
      lipU.push([(-0.034 + 0.070 * t5), -Y * 0.44 + 0.008 * (t5 > 0.6 ? (t5 - 0.6) * 2 : 0) + ((q3 % 4) - 1.5) * 0.0012,
        -Z * 0.74 + 0.020 * (t5 - 0.5) * (t5 - 0.5) * 4]);
    }
    g.add(L.m(L.tube(lipU, 0.0062, 7), M.face));
    [1, -1].forEach(function (s) {
      var R2 = L.rng(s > 0 ? 71 : 79), gp = [], q;
      for (q = 0; q <= 6; q++) {
        var t = q / 6;
        gp.push([(-0.030 + 0.060 * t) * 1, -Y * (s > 0 ? 0.52 : 0.74) - 0.002,
          -Z * 0.70 + 0.014 * (t - 0.5) * (t - 0.5) * 4]);
      }
      g.add(L.m(L.tube(gp, 0.0060, 6), M.gum));
      for (var n = 0; n < 7; n++) {
        if (R2() < 0.26) continue;                    /* 抜けた歯 */
        var t2 = n / 6, hh = 0.006 + R2() * 0.013, cw = 0.0030 + R2() * 0.0026;
        var cone = new THREE.ConeGeometry(cw, hh, 5);
        cone.translate(0, -hh / 2, 0);
        var tm = L.m(cone, M.tooth, [-0.030 + 0.060 * t2 + (R2() - 0.5) * 0.004,
          -Y * (s > 0 ? 0.52 : 0.74) + s * 0.002, -Z * 0.70 + 0.014 * (t2 - 0.5) * (t2 - 0.5) * 4]);
        tm.rotation.order = 'ZXY';
        tm.rotation.x = (s > 0 ? 0.10 : Math.PI - 0.10) + (R2() - 0.5) * 0.7;
        tm.rotation.z = (R2() - 0.5) * 0.8;
        g.add(tm);
      }
    });
    /* 鼻腔（2つの黒い穴）・耳（左右で残り方が違う）・外耳道の闇 */
    /* 鼻: 骨の鼻梁 → 軟骨の鼻尖 → 斜めのスリット状の鼻孔（丸い穴は禁止） */
    [1, -1].forEach(function (s2) {
      var nos = L.ell(0.0072, 0.0038, 0.0115, 10);
      L.deform(nos, function (x, y, z, o) { o[0] = x + 0.35 * z * s2; });
      g.add(L.m(nos, M.void, [s2 * 0.0135, -Y * 0.30, -Z * 0.86], [0.55, s2 * 0.30, s2 * 0.42]));
    });
    g.add(L.m(new THREE.TorusGeometry(0.022, 0.0075, 6, 16, 4.2), M.face, [X * 0.96, -Y * 0.12, -0.002], [0.2, 1.5, 0.7]));
    g.add(L.m(new THREE.TorusGeometry(0.017, 0.0060, 6, 14, 3.2), M.face, [-X * 0.95, -Y * 0.20, 0.004], [0.1, -1.5, -0.8]));
    g.add(L.m(L.ell(0.0060, 0.0070, 0.0060, 8), M.void, [X * 0.92, -Y * 0.13, -0.006]));
    /* 張りの限界で裂けた皮膚（左のこめかみ〜頬。縁が捲れ、下は暗い肉） */
    var fa = [], fb = [], fc = [];
    for (var q4 = 0; q4 <= 10; q4++) {
      var t6 = q4 / 10, ww = 0.010 * Math.sin(Math.PI * t6) + 0.001;
      var yy = Y * 0.24 - Y * 0.62 * t6, zz2 = -Z * (0.62 + 0.10 * t6);
      var xx = -X * (0.74 - 0.16 * t6) + ((q4 % 3) - 1) * 0.0016;
      fa.push([xx + ww, yy, zz2]); fb.push([xx - ww, yy, zz2]); fc.push([xx, yy, zz2 + 0.013]);
    }
    var fm1 = L.m(L.strip(fa, fc), M.flesh); fm1.material.side = THREE.DoubleSide; g.add(fm1);
    var fm2 = L.m(L.strip(fc, fb), M.flesh); fm2.material.side = THREE.DoubleSide; g.add(fm2);
    g.add(L.m(L.tube(fa, 0.0032, 5), M.face));
    g.add(L.m(L.tube(fb, 0.0028, 5), M.face));
    /* 濡れて張り付いた短い髪（額の生え際に残る数束） */
    var RH = L.rng(311);
    for (var h = 0; h < 12; h++) {
      var a = (RH() - 0.5) * 2.4;
      var hx = Math.sin(a) * X * 0.72, hz = -Math.cos(a) * Z * 0.52;
      g.add(L.m(L.tube([
        [hx, Y * 0.50, hz],
        [hx * 1.02, Y * 0.50, hz + Z * 0.30],
        [hx * 1.00, Y * 0.44 - RH() * 0.03, hz + Z * 0.62]
      ], 0.0010 + RH() * 0.0009, 4), M.hairM));
    }
    return g;
  }

  /* 皮膚に癒着した防護服の断片: 体の楕円体に沿う殻（縁は不揃いに欠ける） */
  function suitShell(M, g, center, radii, phi0, phiLen, th0, thLen, seed) {
    var R = L.rng(seed);
    var q = new THREE.SphereGeometry(1, 15, 12, phi0, phiLen, th0, thLen);
    var uv = q.attributes.uv.array, pos = q.attributes.position.array, i;
    /* 縁を不揃いに欠けさせ、皮膚の下へ沈ませる（板の直線的な断ち切りを消す） */
    for (i = 0; i < pos.length / 3; i++) {
      var u = uv[i * 2], v = uv[i * 2 + 1];
      var d = Math.min(u, 1 - u, v, 1 - v);
      var n = 0.5 + 0.5 * Math.sin(u * 41.3 + v * 17.7) * Math.cos(v * 29.1 - u * 11.3);
      var edge = L.clamp((d - 0.02 - 0.10 * n) / 0.16, 0, 1);
      var k = 0.955 + 0.045 * edge + 0.012 * Math.sin(u * 63 + v * 37);
      pos[i * 3] *= k; pos[i * 3 + 1] *= k; pos[i * 3 + 2] *= k;
    }
    q.attributes.position.needsUpdate = true;
    q.scale(radii[0], radii[1], radii[2]);
    L.deform(q, function (x, y, z, o) {
      var kk = 1 + 0.012 * Math.sin(x * 26 + y * 17) + 0.008 * Math.sin(z * 33);
      o[0] = x * kk; o[1] = y * kk; o[2] = z * kk;
    });
    var m = L.m(q, M.suit, center);
    m.material.side = THREE.DoubleSide;
    g.add(m);
  }

  /* 張って裂けかけた皮膚: 紡錘形の裂け目＋渡る繊維。局所座標で作って貼る。 */
  function tear(g, M, at, rot, len, w, seed) {
    var R = L.rng(seed), N = 12, A = [], B = [], C = [], D = [];
    for (var i = 0; i <= N; i++) {
      var t = i / N, y = (t - 0.5) * len;
      var ww = w * Math.sin(Math.PI * Math.pow(t, 0.9)) * (0.85 + R() * 0.3);
      A.push([ww, y, 0]); B.push([0, y, -w * 0.9]);
      C.push([-ww, y, 0]); D.push([0, y, -w * 0.9]);
    }
    var grp = new THREE.Group();
    grp.add(L.m(L.strip(A, B), M.flesh)); grp.add(L.m(L.strip(B, A), M.flesh));
    grp.add(L.m(L.strip(D, C), M.flesh)); grp.add(L.m(L.strip(C, D), M.flesh));
    /* 渡る繊維（引き伸ばされた皮膚） */
    for (var f = 0; f < 5; f++) {
      var tt = 0.18 + 0.64 * f / 4 + (R() - 0.5) * 0.06, yy = (tt - 0.5) * len;
      var ww2 = w * Math.sin(Math.PI * Math.pow(tt, 0.9));
      grp.add(L.m(L.tube([[ww2 * 0.92, yy, 0.002], [0, yy + (R() - 0.5) * 0.012, -w * 0.34], [-ww2 * 0.92, yy, 0.002]],
        0.0018 + R() * 0.0014, 4), M.skin));
    }
    /* 縁の捲れ */
    grp.add(L.m(L.tube(A, 0.0062, 6), M.skin));
    grp.add(L.m(L.tube(C, 0.0058, 6), M.skin));
    grp.position.set(at[0], at[1], at[2]);
    grp.rotation.set(rot[0], rot[1], rot[2]);
    g.add(grp);
  }

  function limb(g, mw, from, to, r0, r1, belly) {
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var geo = new THREE.CylinderGeometry(1, 1, len, 12, 10, false);
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
    /* 上体は腰を軸に前傾させる（脚と鎖・鉤は床に据え置き） */
    var pivot = new THREE.Group();
    pivot.position.set(0, HIP - 0.10, 0);
    pivot.rotation.set(-0.175, 0.06, -0.035);
    var up = new THREE.Group();
    up.position.set(0, -(HIP - 0.10), 0);
    pivot.add(up); root.add(pivot);
    var cy = trunk(M, up);
    guts(M, up);

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
        root.add(L.m(L.ell(0.0155, 0.0130, 0.026, 6), M.skin,
          [ankP[0] + (t - 2) * 0.027, 0.026, ankP[2] - 0.185 + Math.abs(t - 2) * 0.010]));
      }
      /* 太腿に癒着した防護服の裾 */
      suitShell(M, root, [s * 0.140, HIP - 0.170, -0.010], [0.150, 0.190, 0.150], s > 0 ? 2.05 : 3.45, 1.55, 0.30, 1.30, 900 + s * 11);
    });

    /* 胴に癒着した防護服の板（胸・背・肩） */
    var SR = [0.334, 0.452, 0.266];
    suitShell(M, up, [0, cy, 0], SR, 4.02, 0.44, 0.62, 0.52, 941);
    suitShell(M, up, [0, cy, 0], SR, 5.06, 0.50, 1.18, 0.48, 947);
    suitShell(M, up, [0, cy, 0], SR, 6.15, 1.25, 0.72, 0.95, 953);
    suitShell(M, up, [0, cy, 0], SR, 3.36, 0.50, 0.34, 0.40, 959);
    /* 張った皮膚の裂けかけ（腹・脇・上腕）と、防護服が皮膚に混ざる斑 */
    tear(up, M, [0.195, cy - 0.235, -0.215], [0.10, -0.62, 0.42], 0.22, 0.026, 1201);
    tear(up, M, [-0.215, cy - 0.130, -0.185], [-0.05, 0.70, -0.30], 0.18, 0.022, 1207);
    tear(up, M, [0.110, cy - 0.330, -0.240], [0.16, -0.30, 1.35], 0.15, 0.018, 1213);
    tear(up, M, [-0.298, SHOULDER - 0.300, -0.060], [0.10, 0.40, 0.22], 0.17, 0.020, 1217);
    tear(up, M, [0.318, SHOULDER - 0.420, 0.010], [0.05, -0.45, -0.16], 0.14, 0.017, 1223);
    for (var fk = 0; fk < 8; fk++) {
      var fa = R() * 6.284, fy = cy + (R() - 0.9) * 0.42, frr = 0.30 + R() * 0.05;
      up.add(L.m(L.ell(0.024 + R() * 0.028, 0.020 + R() * 0.024, 0.008, 7), M.suit,
        [Math.sin(fa) * frr * 0.92, fy, -Math.cos(fa) * frr * 0.80],
        [(R() - 0.5) * 0.5, -fa, (R() - 0.5) * 0.8]));
    }
    /* 肩の金具とベルトの残骸 */
    up.add(L.m(new THREE.TorusGeometry(0.030, 0.010, 6, 14), M.iron, [0.240, SHOULDER - 0.020, -0.150], [0.4, -0.5, 0.3]));
    up.add(L.m(new THREE.BoxGeometry(0.062, 0.030, 0.016), M.iron, [-0.215, cy - 0.150, -0.205], [0, 0.4, 0.15]));
    /* ジッパー線（胸から腹へ・裂け目の脇を走る） */
    up.add(L.m(L.tube([[-0.108, SHOULDER - 0.090, -0.245], [-0.126, cy - 0.020, -0.268], [-0.132, cy - 0.250, -0.238]], 0.0075, 5), M.band));
    for (var zk = 0; zk < 14; zk++) {
      var zt = zk / 13;
      up.add(L.m(new THREE.BoxGeometry(0.009, 0.006, 0.005), M.band,
        [-0.108 - 0.024 * zt, SHOULDER - 0.090 - (SHOULDER - 0.090 - (cy - 0.250)) * zt, -0.252 - 0.010 * Math.sin(Math.PI * zt)],
        [0, 0.2, (zk % 2 ? 0.3 : -0.3)]));
    }

    /* 肩（頭が沈むよう高く盛る） */
    [1, -1].forEach(function (s) {
      var shg = L.ell(0.134, 0.118, 0.126, 18);
      L.warp(shg, 0.010, 9, 400 + s * 7);
      L.ridge(shg, [s * 0.05, 0.08, -0.10], [s * 0.11, -0.06, 0.06], 0.05, -0.010, 1.5);
      up.add(L.m(shg, M.skin, [s * 0.238, SHOULDER - 0.010 - (s < 0 ? 0.030 : 0), -0.010], [0, 0, -s * 0.24]));
      suitShell(M, up, [s * 0.238, SHOULDER - 0.010 - (s < 0 ? 0.030 : 0), -0.010],
        [0.140, 0.124, 0.132], s > 0 ? 3.00 : 5.55, 1.45, 0.26, 0.86, 1300 + s * 17);
      /* 反射帯の名残（上腕を巻く帯） */
      up.add(L.m(new THREE.TorusGeometry(0.098, 0.011, 4, 18, 3.6), M.band,
        [s * 0.300, SHOULDER - 0.215, -0.010], [0.06, 0, -s * 0.30]));
      /* 首を埋める肩の肉（頭の下半分を隠す） */
      up.add(L.m(L.ell(0.118, 0.062, 0.106, 16), M.skin, [s * 0.168, SHOULDER - 0.014, -0.010]));
    });
    /* 鎖骨（膨れた皮膚の下に沈む） */
    up.add(L.m(L.tube([[0.020, SHOULDER - 0.075, -0.180], [0.130, SHOULDER - 0.050, -0.140], [0.225, SHOULDER - 0.070, -0.060]], 0.017, 7), M.skin));
    up.add(L.m(L.tube([[-0.020, SHOULDER - 0.080, -0.180], [-0.126, SHOULDER - 0.058, -0.136], [-0.220, SHOULDER - 0.080, -0.058]], 0.016, 7), M.skin));

    /* 異様に長い腕（手は膝より下） */
    [1, -1].forEach(function (s) {
      var sh = [s * 0.258, SHOULDER - 0.055, -0.020];
      var el = s > 0 ? [0.428, 0.905, 0.030] : [-0.412, 0.880, -0.115];
      var wr = s > 0 ? [0.408, 0.315, -0.185] : [-0.452, 0.285, 0.010];
      limb(up, M.skin, sh, el, 0.092, 0.062, 0.20);
      up.add(L.m(L.ell(0.062, 0.058, 0.062, 14), M.skin, el));
      limb(up, M.skin, el, wr, 0.064, 0.046, 0.22);
      var hand = new THREE.Group();
      hand.add(L.m(L.ell(0.056, 0.070, 0.028, 16), M.skin, [0, -0.058, 0]));
      for (var f = 0; f < 4; f++) {
        var fx = (f - 1.5) * 0.030, spread = (f - 1.5) * 0.14, y0 = -0.112, zz = 0;
        for (var k = 0; k < 3; k++) {
          var l2 = 0.052 * (1 - k * 0.20);
          var mm = L.m(L.seg(0.0155 - k * 0.0026, 0.0138 - k * 0.0026, l2, 8), M.skin, [fx + spread * 0.018 * k, y0, zz]);
          mm.rotation.order = 'ZXY'; mm.rotation.z = spread * 0.45; mm.rotation.x = 0.30 + k * (s > 0 ? 0.62 : 0.22);
          hand.add(mm);
          hand.add(L.m(L.ell(0.0165 - k * 0.0026, 0.0150, 0.0160 - k * 0.0026, 7), M.skin, [fx + spread * 0.018 * k, y0, zz]));
          y0 -= l2 * 0.88; zz -= (s > 0 ? 0.016 : 0.004) * (k + 1);
          if (k === 2) hand.add(L.m(L.ell(0.0090, 0.0140, 0.0070, 8), M.nail, [fx + spread * 0.018 * k, y0 + 0.006, zz - 0.012]));
        }
      }
      var th = L.m(L.seg(0.0170, 0.0130, 0.060, 8), M.skin, [-s * 0.046, -0.078, 0.014]);
      th.rotation.z = s * 1.10; hand.add(th);
      hand.position.set(wr[0], wr[1], wr[2]);
      hand.rotation.set(s > 0 ? 0.30 : 0.05, 0, s > 0 ? 0.18 : -0.30);
      up.add(hand);
      if (s > 0) root.__grip = wr;
    });

    /* 鎖と鉤（右手から床へ垂れ、後ろへ引きずられる。鉤は0.4mの鋳鉄） */
    var chain = new THREE.Group();
    var gx = 0.430, gy = 0.305, gz = -0.265, N = 16;
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1);
      var x = gx + 0.070 * t, y = gy * (1 - t) * (1 - t) + 0.030, z = gz + 0.70 * t * t + 0.10 * t;
      var lk = new THREE.TorusGeometry(0.034, 0.0105, 4, 10);
      chain.add(L.m(lk, M.iron, [x, y, z], [i % 2 ? 1.57 : 0, 0.30 + t * 0.6, 0.34 - t * 0.30]));
    }
    /* 鉤本体: 全長0.4m。柄＋アイ＋鉤の湾曲＋尖った先端 */
    var hx = gx + 0.075, hz = gz + 0.84;
    chain.add(L.m(new THREE.TorusGeometry(0.030, 0.0115, 6, 14), M.iron, [hx - 0.020, 0.034, hz - 0.055], [0.1, 0.4, 1.50]));
    chain.add(L.m(L.seg(0.0165, 0.0150, 0.155, 9), M.iron, [hx - 0.010, 0.036, hz - 0.040], [1.50, 0.42, 0]));
    var hk = [];
    for (var h = 0; h <= 18; h++) {
      var a2 = -0.35 + h / 18 * 4.6;
      hk.push([hx + 0.052 + Math.cos(a2) * 0.105, 0.034 + Math.sin(a2) * 0.020, hz + 0.105 + Math.sin(a2) * 0.105]);
    }
    chain.add(L.m(L.tube(hk, 0.0155, 8), M.iron));
    chain.add(L.m(L.seg(0.0150, 0.0010, 0.085, 7), M.iron,
      [hk[18][0], hk[18][1], hk[18][2]], [1.15, -0.55, 0]));
    root.add(chain);

    /* 頭（肩に沈む） */
    var hd = head(M);
    hd.position.set(-0.020, HEADY, -0.048);
    hd.rotation.set(0.10, -0.18, 0.06);
    up.add(hd);
    /* 首は無く、顎下の肉と首の皮膚の襞が肩へ続く（頭の下半分が沈む） */
    up.add(L.m(L.ell(0.112, 0.076, 0.106, 16), M.skin, [-0.010, HEADY - 0.112, -0.030]));
    for (var nf = 0; nf < 3; nf++) {
      var fr = new THREE.TorusGeometry(0.092 + nf * 0.012, 0.020 + nf * 0.004, 5, 16);
      L.deform(fr, function (x, y, z, o) { o[1] = y + 0.010 * Math.sin(x * 22) - 0.006; o[0] = x * (1 + 0.06 * Math.sin(z * 18)); });
      up.add(L.m(fr, M.skin, [-0.012, HEADY - 0.088 - nf * 0.040, -0.028], [1.42 + nf * 0.06, 0, 0.05]));
    }
    /* 斜め上からの橙1灯＋反対側の弱い緑で形を彫る */
    var key = new THREE.PointLight(0xffa860, 11.0, 6.4, 2); key.position.set(0.95, 2.55, -1.70); root.add(key);
    var grn = new THREE.PointLight(0x6ab896, 5.0, 3.9, 2); grn.position.set(-1.10, 1.62, 0.50); root.add(grn);
    /* 裂け目の内側にわずかな回り込み（肋骨と内臓が読めるだけ） */
    var wl = new THREE.PointLight(0xffb494, 0.16, 0.80, 2); wl.position.set(0.04, 1.22, -0.44); root.add(wl);
    return root;
  }

  ESCAPE.__A2MOCKS.E = {
    name: '案E 肥大した作業員',
    build: build,
    cams: {
      full: { pos: [0.86, 0.98, -2.30], look: [0.05, 0.96, -0.02], fov: 58 },
      face: { pos: [0.15, 1.800, -0.96], look: [-0.02, 1.700, -0.21], fov: 31 },
      corridor: { pos: [0.0, 1.56, 1.20], look: [0.0, 1.20, -8.6], fov: 42,
        place: [0.05, 0.0, -8.6], rot: [0, 0.30, 0] }
    }
  };
})();
