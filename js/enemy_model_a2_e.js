/* ESCAPE — P5e-2a 案E「肥大した作業員」本番モデル
 * 契約 DESIGN.md §4「P5e-2」／造形の正＝ audit/enemy-mocks-a2/3d/mock_E.js（P5e-1 目視合格版）。
 * 水で膨れた元保守員の男。防護服が皮膚に癒着し、胸から腹が縦に裂け、頭は肩に沈む。
 * 腕が異様に長く、右手の鎖と鋳鉄の鉤を引きずる。
 *
 * 2形態（既存互換の名前・意味はこの体のもの）:
 *   stand … 重い歩き。鎖と鉤を床に引きずる（遠くから鎖の音が聞こえる＝音は P5e-2b）。
 *   crawl … 突進。姿勢は同じで前傾が深くなり、腕を振り回して速度と揺れが増す。
 *   遷移 0.8 秒 … 咆哮（顎が落ちて口が開き、胸が反って肩が上がる）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE, THREE = global.THREE;
  var A2 = ESCAPE.EnemyA2;
  var ell = A2.ell, tube = A2.tube, strip = A2.strip;
  var bulge = A2.bulge, ridge = A2.ridge, warp = A2.warp, deform = A2.deform;
  var clamp = A2.clamp, rng = A2.rng;

  var ANK = 0.095, KNEE = 0.505, HIP = 0.930, SHOULDER = 1.585;
  var HEADY = 1.690, HRX = 0.141, HRY = 0.150, HRZ = 0.150;
  var SPLIT_TOP = 1.455, SPLIT_BOT = 1.010;
  var UPARM = 0.655, FOREARM = 0.628, THIGH = 0.360, SHANK = 0.410;

  function E(opts) {
    A2.Base.call(this, opts);
    this.kind = 'E';
    this.transDur = 0.80;                 /* 契約: 咆哮の遷移は 0.8 秒 */
    this.chain = [];
    this.jowls = [];
    this._roar = 0;
    this._cine = 0;
    this._build();
    this.setForm('stand', true);
    this.applyPose(0);
  }
  A2.extend(E);

  E.prototype.topHeight = function () { return 1.98; };

  /* ---------------- 材質 ---------------- */
  E.prototype._mats = function () {
    var M = this.mats;
    /* 値はモック mock_E.js の mats() をそのまま移植（色・粗さ・法線の強さ・繰り返し）。
       ここを弄ると「同一の存在」に見えなくなる（2026-09-20 事前ゲート差し戻しの主因）。 */
    M.skin = this._lit(A2.skin({
      seed: 501, base: '#5f645b', dark: 'rgba(14,18,18,', veinColor: 'rgba(62,48,84,0.50)',
      mottle: 300, vein: 160, wrinkle: 300, pore: 0.50, bump: 4.6, roughLo: 0.24, roughHi: 0.90,
      tint: 0x939e95, metalness: 0, repeat: [4, 4], nscale: 1.55
    }), 'body');
    M.face = this._lit(A2.skin({
      seed: 503, base: '#5e635b', dark: 'rgba(12,16,16,', veinColor: 'rgba(84,46,54,0.45)',
      mottle: 340, vein: 210, wrinkle: 420, pore: 0.62, bump: 4.4, roughLo: 0.22, roughHi: 0.90,
      tint: 0x939e95, metalness: 0, repeat: [5, 4], nscale: 1.70
    }), 'face');
    /* 防護服の残骸（汚れた黄灰の PVC 布地）。皮膚と境が溶けている */
    M.suit = this._lit(A2.skin({
      seed: 507, base: '#49452a', dark: 'rgba(16,15,8,', veinColor: 'rgba(38,34,18,0.5)',
      mottle: 180, vein: 30, wrinkle: 340, pore: 0.26, bump: 3.4, roughLo: 0.40, roughHi: 0.96,
      tint: 0x8b855f, metalness: 0, repeat: [3, 3], side: THREE.DoubleSide
    }), 'cloth');
    M.cloth = M.suit;
    M.fleshT = this._lit(A2.skin({
      seed: 509, base: '#2c1112', dark: 'rgba(8,2,3,', veinColor: 'rgba(110,26,28,0.55)',
      mottle: 180, vein: 130, wrinkle: 320, pore: 0.36, bump: 4.2, roughLo: 0.22, roughHi: 0.58,
      tint: 0x37160f, metalness: 0, repeat: [3, 3], side: THREE.DoubleSide
    }), 'flesh');
    M.flesh = M.fleshT;
    M.band = this._lit(A2.mat(0x6a6d66, 0.52, 0.06), 'metal');
    M.rib = this._lit(A2.mat(0x8e8970, 0.58, 0), 'tooth');
    M.void = this._track(new THREE.MeshBasicMaterial({ color: 0x000000, fog: true }));
    M.eye = this._lit(A2.mat(0x585446, 0.92, 0), 'tooth');       /* 白濁して濁った眼球 */
    M.eyeVein = this._lit(A2.mat(0x3a0d0c, 0.90, 0), 'flesh');
    M.gum = this._lit(A2.mat(0x2c1211, 0.52, 0), 'flesh');
    M.tooth = this._lit(A2.mat(0x6e6754, 0.50, 0), 'tooth');
    M.hair = this._lit(A2.mat(0x090a0a, 0.66, 0), 'hair');
    M.nail = this._lit(A2.mat(0x55533f, 0.46, 0), 'body');
    M.iron = this._lit(A2.mat(0x39372f, 0.52, 0.70), 'metal');
    return M;
  };

  /* ---------------- 頭（骨の上に水で膨れた肉が張る） ---------------- */
  E.prototype._skullGeo = function (segN) {
    var X = HRX, Y = HRY, Z = HRZ;
    var sk = A2.headShell({
      rx: X, ry: Y, rz: Z, seg: segN, socket: 0.052, eye: 0.004,
      temple: 0.030, cheek: 0.020, nose: 0.020, jaw: 0.78, chin: 0.013, brow: 0.040,
      warp: 0.0030, seed: 51
    });
    /* 脳頭蓋を低く潰し、額を後退させる */
    deform(sk, function (x, y, z, o) {
      var t = clamp((y / Y - 0.28) / 0.72, 0, 1);
      o[1] = y - Y * 0.15 * t * t;
      o[2] = z + Z * 0.11 * t * t * (z < 0 ? 1 : -0.3);
      o[0] = x * (1 + 0.05 * t * t);
    });
    ridge(sk, [X * 0.10, Y * 0.40, -Z * 0.86], [X * 0.86, Y * 0.30, -Z * 0.48], X * 0.32, 0.027, 1.5);
    ridge(sk, [-X * 0.10, Y * 0.36, -Z * 0.86], [-X * 0.80, Y * 0.22, -Z * 0.48], X * 0.28, 0.021, 1.5);
    bulge(sk, [X * 0.96, Y * 0.30, -Z * 0.30], 0.058, -0.022);
    bulge(sk, [-X * 0.94, Y * 0.24, -Z * 0.32], 0.055, -0.026);
    ridge(sk, [X * 0.66, Y * 0.00, -Z * 0.70], [X * 0.98, Y * 0.10, Z * 0.20], X * 0.24, 0.015, 1.8);
    ridge(sk, [-X * 0.62, -Y * 0.04, -Z * 0.68], [-X * 0.94, Y * 0.06, Z * 0.18], X * 0.22, 0.012, 1.8);
    ridge(sk, [X * 0.62, -Y * 0.22, -Z * 0.62], [X * 0.92, -Y * 0.12, Z * 0.14], X * 0.18, -0.010, 1.6);
    bulge(sk, [X * 0.46, Y * 0.14, -Z * 0.80], 0.058, 0.011);
    bulge(sk, [X * 0.46, Y * 0.14, -Z * 0.80], 0.041, -0.040);
    bulge(sk, [-X * 0.46, Y * 0.10, -Z * 0.80], 0.054, 0.009);
    bulge(sk, [-X * 0.46, Y * 0.10, -Z * 0.80], 0.038, -0.036);
    /* 水で膨れた肉が骨の上に張る（風船状の頬・顎下・こめかみ。片側だけ大きく垂れる） */
    bulge(sk, [X * 0.66, -Y * 0.20, -Z * 0.58], 0.068, 0.034);
    bulge(sk, [-X * 0.70, -Y * 0.26, -Z * 0.54], 0.072, 0.042);
    bulge(sk, [X * 0.60, -Y * 0.58, -Z * 0.46], 0.066, 0.032);
    bulge(sk, [-X * 0.64, -Y * 0.64, -Z * 0.42], 0.070, 0.040);
    bulge(sk, [0, -Y * 0.92, -Z * 0.34], 0.092, 0.040);
    bulge(sk, [X * 0.86, -Y * 0.10, -Z * 0.10], 0.062, 0.024);
    bulge(sk, [-X * 0.84, -Y * 0.16, -Z * 0.08], 0.060, 0.028);
    bulge(sk, [X * 0.38, Y * 0.76, -Z * 0.58], 0.070, 0.020);
    bulge(sk, [-X * 0.34, Y * 0.80, -Z * 0.54], 0.068, 0.016);
    bulge(sk, [0, Y * 0.40, Z * 0.86], 0.088, 0.022);
    /* 膨れた肉に食い込む皺（骨の上に肉が載っていることを示す） */
    ridge(sk, [X * 0.30, -Y * 0.40, -Z * 0.78], [X * 0.78, -Y * 0.26, -Z * 0.42], 0.020, -0.011, 1.6);
    ridge(sk, [-X * 0.28, -Y * 0.44, -Z * 0.78], [-X * 0.76, -Y * 0.32, -Z * 0.40], 0.019, -0.012, 1.6);
    ridge(sk, [X * 0.52, -Y * 0.80, -Z * 0.52], [-X * 0.50, -Y * 0.84, -Z * 0.50], 0.024, -0.013, 1.5);
    bulge(sk, [X * 0.80, -Y * 0.62, -Z * 0.24], 0.046, 0.014);
    bulge(sk, [-X * 0.76, -Y * 0.66, -Z * 0.22], 0.044, 0.011);
    /* 開いたままの口（下顎が落ち、口腔が奥へ抜ける） */
    ridge(sk, [X * 0.30, -Y * 0.60, -Z * 0.78], [-X * 0.29, -Y * 0.62, -Z * 0.78], 0.042, -0.058, 1.1);
    ridge(sk, [X * 0.32, -Y * 0.44, -Z * 0.78], [-X * 0.31, -Y * 0.46, -Z * 0.78], 0.015, 0.009, 1.6);
    ridge(sk, [X * 0.30, -Y * 0.76, -Z * 0.76], [-X * 0.29, -Y * 0.78, -Z * 0.76], 0.016, 0.010, 1.6);
    /* 鼻: 膨れた肉の中でも鼻梁→鼻尖の稜が残り、その下に鼻孔が沈む */
    ridge(sk, [0, Y * 0.26, -Z * 0.88], [0, -Y * 0.20, -Z * 0.94], 0.024, 0.016, 2.0);
    bulge(sk, [0, -Y * 0.21, -Z * 0.92], 0.024, 0.016);
    bulge(sk, [0, -Y * 0.33, -Z * 0.86], 0.022, -0.010);
    ridge(sk, [X * 0.18, -Y * 0.22, -Z * 0.84], [X * 0.44, -Y * 0.62, -Z * 0.66], 0.018, -0.009, 1.6);
    ridge(sk, [-X * 0.17, -Y * 0.24, -Z * 0.84], [-X * 0.42, -Y * 0.66, -Z * 0.64], 0.017, -0.008, 1.6);
    warp(sk, 0.0032, 13, 17);
    return sk;
  };

  /* ---------------- 顔一式（頭ノードの下に積む） ---------------- */
  E.prototype._buildHead = function (head, jaw) {
    var X = HRX, Y = HRY, Z = HRZ, M = this.mats, self = this;
    var hi = this._skullGeo(52), lo = this._skullGeo(16);
    var face = this._mesh(hi, M.face, head, 'faceShell');
    this._track(lo);
    this.lodSwap.push({ mesh: face, hi: hi, lo: lo });
    this.faceMesh = face;

    /* 眼: 小さく白濁し、腫れた瞼で半分以上隠れ、影に沈む。ハイライト無し */
    this.sockets = [];
    [[X * 0.46, Y * 0.14, -Z * 0.74, 1, 1.00], [-X * 0.46, Y * 0.10, -Z * 0.74, -1, 0.92]].forEach(function (p, i) {
      var er = 0.0180 * p[4];                 /* 差し戻し②: 眼が小さすぎて別人 → 拡大 */
      var eg = ell(er, er * 0.94, er * 0.92, 12);
      warp(eg, 0.0009, 44, 60 + i);
      self._mesh(eg, M.eye, head, 'eyeball').position.set(p[0], p[1], p[2]);
      var R = rng(600 + i * 13);
      for (var v = 0; v < 6; v++) {
        var a0 = R() * 6.284, pts = [];
        for (var q = 0; q < 4; q++) {
          var a = a0 + q * 0.38, r = er * (0.28 + q * 0.22);
          pts.push([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.9,
            p[2] - Math.sqrt(Math.max(0, 1 - (r / er) * (r / er) * 0.9)) * er * 0.86]);
        }
        self._mesh(tube(pts, 0.0011 + R() * 0.0009, 4, false, 1.3), M.eyeVein, head, 'eyeVein', 1);
      }
      self._mesh(ell(er * 0.34, er * 0.32, er * 0.28, 6), M.void, head, 'pupil')
        .position.set(p[0] + p[3] * 0.0015, p[1] - 0.0008, p[2] - er * 0.88);
      /* 腫れた瞼（上は 60% 覆う・下は袋状に垂れる） */
      var ul = ell(er * 1.95, er * 1.62, er * 1.80, 11);
      deform(ul, function (x, y, z, o) { o[1] = y * (y > 0 ? 1.15 : 0.34) + 0.0035 * Math.sin(x * 46); });
      var um = self._mesh(ul, M.face, head, 'lidUp');
      um.position.set(p[0], p[1] + er * 0.62, p[2] + er * 0.34); um.rotation.set(0.24, 0, p[3] * 0.22);
      var ll = ell(er * 1.86, er * 1.46, er * 1.72, 11);
      deform(ll, function (x, y, z, o) { o[1] = y * (y < 0 ? 1.10 : 0.30); });
      var lm = self._mesh(ll, M.face, head, 'lidLo');
      lm.position.set(p[0], p[1] - er * 0.92, p[2] + er * 0.40); lm.rotation.set(-0.20, 0, p[3] * 0.14);
      /* 眼窩の縁の影（庇の陰） */
      self._mesh(ell(er * 2.7, er * 0.46, er * 1.1, 8), M.void, head, 'browShade')
        .position.set(p[0], p[1] + er * 1.92, p[2] + er * 0.55);
      self.sockets.push([p[0], p[1], p[2] - er * 0.6]);
    });

    /* 口腔（奥へ抜ける闇）と、下顎側に持つ歯茎・歯（顎ノードで開く） */
    var mo = ell(0.052, 0.040, 0.052, 14, 10);
    deform(mo, function (x, y, z, o) {
      o[0] = x * (1 + 0.22 * Math.sin(y * 90)); o[1] = y * (1 + 0.18 * Math.sin(x * 70));
    });
    var mm2 = this._mesh(mo, M.void, head, 'oral');
    mm2.position.set(0.004, -Y * 0.62, -Z * 0.56); mm2.rotation.set(0.10, 0.10, 0.08);
    var lipU = [];
    for (var q3 = 0; q3 <= 10; q3++) {
      var t5 = q3 / 10;
      lipU.push([(-0.034 + 0.070 * t5), -Y * 0.44 + 0.008 * (t5 > 0.6 ? (t5 - 0.6) * 2 : 0) + ((q3 % 4) - 1.5) * 0.0012,
        -Z * 0.74 + 0.020 * (t5 - 0.5) * (t5 - 0.5) * 4]);
    }
    this._mesh(tube(lipU, 0.0062, 5, false, 1.3), M.face, head, 'lipUp');
    var lipL = [];
    for (var q2 = 0; q2 <= 10; q2++) {
      var t4 = q2 / 10;
      lipL.push([(-0.036 + 0.072 * t4), -Y * 0.80 - 0.006 * Math.sin(Math.PI * t4) + ((q2 % 3) - 1) * 0.0015,
        -Z * 0.72 + 0.020 * (t4 - 0.5) * (t4 - 0.5) * 4]);
    }
    this._mesh(tube(lipL, 0.0085, 5, false, 1.3), M.face, jaw, 'lipLo');
    [1, -1].forEach(function (s) {
      var par = s > 0 ? head : jaw, R2 = rng(s > 0 ? 71 : 79), gp = [], q;
      for (q = 0; q <= 6; q++) {
        var t = q / 6;
        gp.push([(-0.030 + 0.060 * t), -Y * (s > 0 ? 0.52 : 0.74) - 0.002,
          -Z * 0.70 + 0.014 * (t - 0.5) * (t - 0.5) * 4]);
      }
      self._mesh(tube(gp, 0.0092, 6, false, 1.4), M.gum, par, 'gum');
      for (var n = 0; n < 7; n++) {
        if (R2() < 0.18) continue;                    /* 抜けた歯 */
        var t2 = n / 6, hh = 0.010 + R2() * 0.017, cw = 0.0044 + R2() * 0.0034;
        var cone = new THREE.ConeGeometry(cw, hh, 5);
        cone.translate(0, -hh / 2, 0);
        var tm = self._mesh(cone, M.tooth, par, 'tooth');
        tm.position.set(-0.030 + 0.060 * t2 + (R2() - 0.5) * 0.004,
          -Y * (s > 0 ? 0.52 : 0.74) + s * 0.002, -Z * 0.70 + 0.014 * (t2 - 0.5) * (t2 - 0.5) * 4);
        tm.rotation.order = 'ZXY';
        tm.rotation.x = (s > 0 ? 0.10 : Math.PI - 0.10) + (R2() - 0.5) * 0.7;
        tm.rotation.z = (R2() - 0.5) * 0.8;
      }
    });
    /* 鼻孔（斜めのスリット。丸い穴は禁止）・耳・外耳道の闇 */
    [1, -1].forEach(function (s2) {
      var nos = ell(0.0072, 0.0038, 0.0115, 7);
      deform(nos, function (x, y, z, o) { o[0] = x + 0.35 * z * s2; });
      var nm = self._mesh(nos, M.void, head, 'nostril');
      nm.position.set(s2 * 0.0142, -Y * 0.245, -Z * 0.905); nm.rotation.set(0.72, s2 * 0.30, s2 * 0.42);
    });
    var e1 = this._mesh(new THREE.TorusGeometry(0.022, 0.0075, 5, 12, 4.2), M.face, head, 'earL', 1);
    e1.position.set(X * 0.96, -Y * 0.12, -0.002); e1.rotation.set(0.2, 1.5, 0.7);
    var e2 = this._mesh(new THREE.TorusGeometry(0.017, 0.0060, 5, 10, 3.2), M.face, head, 'earR', 1);
    e2.position.set(-X * 0.95, -Y * 0.20, 0.004); e2.rotation.set(0.1, -1.5, -0.8);
    this._mesh(ell(0.0060, 0.0070, 0.0060, 6), M.void, head, 'earCanal', 1)
      .position.set(X * 0.92, -Y * 0.13, -0.006);
    /* 張りの限界で裂けた皮膚（左のこめかみ〜頬。縁が捲れ、下は暗い肉） */
    var fa = [], fb = [], fc = [];
    for (var q4 = 0; q4 <= 10; q4++) {
      var t6 = q4 / 10, ww = 0.010 * Math.sin(Math.PI * t6) + 0.001;
      var yy = Y * 0.24 - Y * 0.62 * t6, zz2 = -Z * (0.62 + 0.10 * t6);
      var xx = -X * (0.74 - 0.16 * t6) + ((q4 % 3) - 1) * 0.0016;
      fa.push([xx + ww, yy, zz2]); fb.push([xx - ww, yy, zz2]); fc.push([xx, yy, zz2 + 0.013]);
    }
    this._mesh(strip(fa, fc), M.fleshT, head, 'faceTearA', 1);
    this._mesh(strip(fc, fb), M.fleshT, head, 'faceTearB', 1);
    this._mesh(tube(fa, 0.0032, 4, false, 1.2), M.face, head, 'faceTearEdgeA', 1);
    this._mesh(tube(fb, 0.0028, 4, false, 1.2), M.face, head, 'faceTearEdgeB', 1);
    /* 濡れて張り付いた短い髪（額の生え際に残る数束） */
    var RH = rng(311);
    for (var h = 0; h < 12; h++) {
      var a = (RH() - 0.5) * 2.4;
      var hx = Math.sin(a) * X * 0.72, hz = -Math.cos(a) * Z * 0.52;
      this._mesh(tube([
        [hx, Y * 0.50, hz], [hx * 1.02, Y * 0.50, hz + Z * 0.30],
        [hx * 1.00, Y * 0.44 - RH() * 0.03, hz + Z * 0.62]
      ], 0.0010 + RH() * 0.0009, 3, false, 1.2), M.hair, head, 'hair', 1);
    }
  };

  /* -Y へ伸びる肉づきの肢（中ほどが膨れる＝水で垂れた肉） */
  function limbGeo(len, r0, r1, belly, rad) {
    var g = new THREE.CylinderGeometry(1, 1, len, rad || 10, 8, false);
    g.translate(0, -len / 2, 0);
    deform(g, function (x, y, z, o) {
      var t = clamp(-y / len, 0, 1), r = r0 + (r1 - r0) * t;
      r *= 1 + (belly === undefined ? 0.14 : belly) * Math.sin(Math.PI * Math.pow(t, 0.8));
      var d = Math.sqrt(x * x + z * z) || 1;
      o[0] = x / d * r; o[2] = z / d * r;
    });
    return g;
  }

  /* 皮膚に癒着した防護服の断片（縁は不揃いに欠けて皮膚の下へ沈む） */
  E.prototype._suitShell = function (parent, center, radii, phi0, phiLen, th0, thLen, seedN, lod) {
    var q = new THREE.SphereGeometry(1, 11, 8, phi0, phiLen, th0, thLen);
    var uv = q.attributes.uv.array, pos = q.attributes.position.array, i;
    for (i = 0; i < pos.length / 3; i++) {
      var u = uv[i * 2], v = uv[i * 2 + 1];
      var d = Math.min(u, 1 - u, v, 1 - v);
      var n = 0.5 + 0.5 * Math.sin(u * 41.3 + v * 17.7) * Math.cos(v * 29.1 - u * 11.3);
      var edge = clamp((d - 0.02 - 0.10 * n) / 0.16, 0, 1);
      var k = 0.955 + 0.045 * edge + 0.012 * Math.sin(u * 63 + v * 37);
      pos[i * 3] *= k; pos[i * 3 + 1] *= k; pos[i * 3 + 2] *= k;
    }
    q.attributes.position.needsUpdate = true;
    q.scale(radii[0], radii[1], radii[2]);
    deform(q, function (x, y, z, o) {
      var kk = 1 + 0.012 * Math.sin(x * 26 + y * 17) + 0.008 * Math.sin(z * 33);
      o[0] = x * kk; o[1] = y * kk; o[2] = z * kk;
    });
    this._mesh(q, this.mats.suit, parent, 'suit', lod).position.set(center[0], center[1], center[2]);
  };

  /* 張って裂けかけた皮膚（紡錘形の裂け目＋渡る繊維） */
  E.prototype._tear = function (parent, at, rot, len, w, seedN) {
    var R = rng(seedN), N = 10, A = [], B = [], C = [], M = this.mats, i;
    for (i = 0; i <= N; i++) {
      var t = i / N, y = (t - 0.5) * len;
      var ww = w * Math.sin(Math.PI * Math.pow(t, 0.9)) * (0.85 + R() * 0.3);
      A.push([ww, y, 0]); B.push([0, y, -w * 0.9]); C.push([-ww, y, 0]);
    }
    var grp = new THREE.Group();
    grp.position.set(at[0], at[1], at[2]);
    grp.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(grp);
    this.lodHi.push(grp);            /* 裂け目一式は低詳細で消す飾り */
    this._mesh(strip(A, B), M.fleshT, grp, 'tear');
    this._mesh(strip(B, C), M.fleshT, grp, 'tear');
    for (var f = 0; f < 3; f++) {
      var tt = 0.24 + 0.52 * f / 2 + (R() - 0.5) * 0.06, yy = (tt - 0.5) * len;
      var ww2 = w * Math.sin(Math.PI * Math.pow(tt, 0.9));
      this._mesh(tube([[ww2 * 0.92, yy, 0.002], [0, yy + (R() - 0.5) * 0.012, -w * 0.34], [-ww2 * 0.92, yy, 0.002]],
        0.0018 + R() * 0.0014, 3, false, 1.2), M.skin, grp, 'tearFiber', 1);
    }
    var A2f = A.filter(function (_, i2) { return i2 % 2 === 0; });
    var C2 = C.filter(function (_, i2) { return i2 % 2 === 0; });
    this._mesh(tube(A2f, 0.0062, 4, false, 1.2), M.skin, grp, 'tearEdge');
    this._mesh(tube(C2, 0.0058, 4, false, 1.2), M.skin, grp, 'tearEdge');
  };

  /* ---------------- 胴（水で膨れた樽。正中が縦に裂ける） ---------------- */
  E.prototype._trunkGeo = function (segN) {
    var yb = HIP - 0.190, yt = SHOULDER + 0.045, cy = (yb + yt) / 2, hy = (yt - yb) / 2;
    var T = [[1, 0.90, 0.80], [0.70, 1.00, 0.92], [0.30, 1.06, 1.04], [-0.10, 1.10, 1.10],
      [-0.50, 1.02, 1.00], [-1, 0.72, 0.68]];
    var g = new THREE.SphereGeometry(1, segN, Math.round(segN * 0.7));
    g.scale(0.472, hy, 0.382);
    deform(g, function (x, y, z, o) {
      var ny = clamp(y / hy, -1, 1), k = [T[0][1], T[0][2]];
      for (var i = 0; i < T.length - 1; i++) {
        if (ny <= T[i][0] && ny >= T[i + 1][0]) {
          var t = (T[i][0] - ny) / (T[i][0] - T[i + 1][0]);
          k = [T[i][1] + (T[i + 1][1] - T[i][1]) * t, T[i][2] + (T[i + 1][2] - T[i][2]) * t];
          break;
        }
      }
      o[0] = x * k[0] * (1 + 0.045 * ny);
      o[2] = z * k[1] * (z < 0 ? 1.04 : 0.96);
      o[1] = y;
    });
    for (var i2 = 0; i2 < 5; i2++) {
      var ry = hy * (0.56 - i2 * 0.105);
      ridge(g, [0.075, ry, -0.235], [0.255, ry - 0.035, -0.085], 0.052, 0.0075, 1.5);
      ridge(g, [-0.072, ry - 0.008, -0.233], [-0.252, ry - 0.044, -0.083], 0.050, 0.0068, 1.5);
    }
    bulge(g, [0, -hy * 0.42, -0.230], 0.140, 0.026);
    bulge(g, [0, hy * 0.88, 0.040], 0.130, -0.030);
    ridge(g, [0, hy * 0.30, 0.250], [0, -hy * 0.50, 0.235], 0.055, -0.018, 1.4);
    var st = SPLIT_TOP - cy, sb = SPLIT_BOT - cy;
    ridge(g, [0, st, -0.250], [0, sb, -0.250], 0.105, -0.150, 1.02);
    ridge(g, [0.112, st + 0.02, -0.215], [0.100, sb - 0.01, -0.215], 0.050, 0.046, 1.5);
    ridge(g, [-0.108, st, -0.213], [-0.096, sb - 0.02, -0.213], 0.048, 0.038, 1.5);
    warp(g, 0.009, 7, 9);
    g.translate(0, cy, 0);
    return g;
  };

  /* 裂け目の内側（肋骨の断端・濡れた内臓・暗がり） */
  E.prototype._guts = function (parent) {
    var N = 12, Lft = [], Rgt = [], Bot = [], Bot2 = [], R = rng(521), M = this.mats, self = this, i;
    for (i = 0; i <= N; i++) {
      var t = i / N, y = SPLIT_TOP - (SPLIT_TOP - SPLIT_BOT) * t;
      var w = 0.164 * Math.sin(Math.PI * Math.pow(t, 0.85)) + 0.022;
      var zE = -0.436 + 0.030 * Math.abs(t - 0.5), zB = -0.280 - 0.030 * Math.sin(Math.PI * t);
      Lft.push([w * (1 + 0.10 * R()), y, zE]); Rgt.push([-w * (1 + 0.10 * R()), y, zE]);
      Bot.push([0.006 * Math.sin(t * 9), y, zB]); Bot2.push([-0.006 * Math.sin(t * 9), y, zB]);
    }
    this._mesh(strip(Lft, Bot), M.fleshT, parent, 'gutL');
    this._mesh(strip(Bot2, Rgt), M.fleshT, parent, 'gutR');
    this._mesh(ell(0.030, (SPLIT_TOP - SPLIT_BOT) / 2, 0.034, 10, 7), M.void, parent, 'gutVoid')
      .position.set(0, (SPLIT_TOP + SPLIT_BOT) / 2, -0.228);
    for (var r = 0; r < 5; r++) {
      var yy = SPLIT_TOP - 0.045 - r * 0.082;
      [1, -1].forEach(function (sgn) {
        var tor = new THREE.TorusGeometry(0.082 + r * 0.007, 0.0145, 5, 10, 1.20);
        var m = self._mesh(tor, M.rib, parent, 'rib', 1);
        m.position.set(sgn * 0.086, yy, -0.330);
        m.rotation.set(0.15 + r * 0.05, sgn > 0 ? -0.9 : Math.PI + 0.9, sgn > 0 ? 0.65 : -0.65);
      });
    }
    for (var j = 0; j < 8; j++) {
      var y2 = SPLIT_TOP - 0.055 - j * 0.055;
      this._mesh(ell(0.030 + R() * 0.014, 0.028 + R() * 0.012, 0.028, 7), M.fleshT, parent, 'organ', 1)
        .position.set((R() - 0.5) * 0.046, y2, -0.286 + (R() - 0.5) * 0.028);
    }
    var pts = [];
    for (var k = 0; k < 7; k++) pts.push([Math.sin(k * 1.7) * 0.032, SPLIT_BOT + 0.13 - k * 0.026, -0.300 + Math.cos(k * 1.3) * 0.016]);
    this._mesh(tube(pts, 0.016, 5, false, 1.3), M.fleshT, parent, 'entrail', 1);
  };

  /* ---------------- 骨組み ---------------- */
  E.prototype._build = function () {
    var M = this._mats(), self = this, R = rng(777), i;
    var pelvis = this._node('pelvis', this.group, 0, HIP, 0);
    var spine = this._node('spine', pelvis, 0, 0, 0);
    var chest = this._node('chest', spine, 0, SHOULDER - HIP, 0);
    /* abs: ローカル座標が「立っている時の絶対高さ」になる箱（胴の塊はここに積む） */
    var abs = new THREE.Group();
    abs.position.set(0, -SHOULDER, 0);
    chest.add(abs);

    var tHi = this._trunkGeo(26), tLo = this._trunkGeo(10);
    var tm = this._mesh(tHi, M.skin, abs, 'trunk');
    this._track(tLo);
    this.lodSwap.push({ mesh: tm, hi: tHi, lo: tLo });
    this._guts(abs);

    /* 胴に癒着した防護服の板（胸・背・肩） */
    var cy = ((HIP - 0.190) + (SHOULDER + 0.045)) / 2, SR = [0.500, 0.452, 0.400];
    this._suitShell(abs, [0, cy, 0], SR, 4.02, 0.44, 0.62, 0.52, 941, 1);
    this._suitShell(abs, [0, cy, 0], SR, 5.06, 0.50, 1.18, 0.48, 947, 1);
    this._suitShell(abs, [0, cy, 0], SR, 6.15, 1.25, 0.72, 0.95, 953);
    this._suitShell(abs, [0, cy, 0], SR, 3.36, 0.50, 0.34, 0.40, 959, 1);
    /* 張った皮膚の裂けかけ（腹・脇・上腕）と、防護服が皮膚に混ざる斑 */
    this._tear(abs, [0.195, cy - 0.235, -0.215], [0.10, -0.62, 0.42], 0.22, 0.026, 1201);
    this._tear(abs, [-0.215, cy - 0.130, -0.185], [-0.05, 0.70, -0.30], 0.18, 0.022, 1207);
    this._tear(abs, [0.300, cy - 0.300, -0.330], [0.12, -0.20, 0.95], 0.20, 0.024, 1229);
    this._tear(abs, [-0.330, cy - 0.060, -0.270], [-0.08, 0.30, -0.75], 0.19, 0.023, 1231);
    this._tear(abs, [-0.060, cy - 0.430, -0.390], [0.20, 0.10, 1.50], 0.17, 0.021, 1237);
    this._tear(abs, [0.110, cy - 0.330, -0.240], [0.16, -0.30, 1.35], 0.15, 0.018, 1213);
    for (var fk = 0; fk < 8; fk++) {
      var fa = R() * 6.284, fy = cy + (R() - 0.9) * 0.42, frr = 0.30 + R() * 0.05;
      var pm = this._mesh(ell(0.024 + R() * 0.028, 0.020 + R() * 0.024, 0.008, 6), M.suit, abs, 'suitPatch', 1);
      pm.position.set(Math.sin(fa) * frr * 0.92, fy, -Math.cos(fa) * frr * 0.80);
      pm.rotation.set((R() - 0.5) * 0.5, -fa, (R() - 0.5) * 0.8);
    }
    /* 肩の金具・ベルト・ジッパー線（反射帯の名残） */
    var bk = this._mesh(new THREE.TorusGeometry(0.030, 0.010, 5, 10), M.iron, abs, 'buckle', 1);
    bk.position.set(0.240, SHOULDER - 0.020, -0.150); bk.rotation.set(0.4, -0.5, 0.3);
    this._mesh(tube([[-0.108, SHOULDER - 0.090, -0.245], [-0.126, cy - 0.020, -0.268], [-0.132, cy - 0.250, -0.238]], 0.0075, 4, false, 1.3), M.band, abs, 'zipLine');
    for (var zk = 0; zk < 12; zk++) {
      var zt = zk / 11;
      var zm = this._mesh(new THREE.BoxGeometry(0.009, 0.006, 0.005), M.band, abs, 'zip', 1);
      zm.position.set(-0.108 - 0.024 * zt, SHOULDER - 0.090 - (SHOULDER - 0.090 - (cy - 0.250)) * zt,
        -0.252 - 0.010 * Math.sin(Math.PI * zt));
      zm.rotation.set(0, 0.2, (zk % 2 ? 0.3 : -0.3));
    }
    /* 肩（頭が沈むよう高く盛る）・鎖骨・首を埋める肉 */
    [1, -1].forEach(function (s) {
      var shg = ell(0.186, 0.158, 0.174, 12);
      warp(shg, 0.010, 9, 400 + s * 7);
      ridge(shg, [s * 0.05, 0.08, -0.10], [s * 0.11, -0.06, 0.06], 0.05, -0.010, 1.5);
      var sm = self._mesh(shg, M.skin, abs, 'shoulder');
      sm.position.set(s * 0.310, SHOULDER - 0.010 - (s < 0 ? 0.034 : 0), -0.010);
      sm.rotation.set(0, 0, -s * 0.24);
      self._suitShell(abs, [s * 0.310, SHOULDER - 0.010 - (s < 0 ? 0.034 : 0), -0.010],
        [0.192, 0.164, 0.180], s > 0 ? 3.00 : 5.55, 1.45, 0.26, 0.86, 1300 + s * 17, 1);
      var bm = self._mesh(new THREE.TorusGeometry(0.138, 0.013, 4, 14, 3.6), M.band, abs, 'reflect', 1);
      bm.position.set(s * 0.390, SHOULDER - 0.215, -0.010); bm.rotation.set(0.06, 0, -s * 0.30);
      self._mesh(ell(0.150, 0.074, 0.134, 11), M.skin, abs, 'neckFill', 1)
        .position.set(s * 0.208, SHOULDER - 0.018, -0.010);
    });
    this._mesh(tube([[0.024, SHOULDER - 0.075, -0.268], [0.170, SHOULDER - 0.050, -0.210], [0.295, SHOULDER - 0.070, -0.090]], 0.023, 6, false, 1.3), M.skin, abs, 'clavL', 1);
    this._mesh(tube([[-0.024, SHOULDER - 0.080, -0.268], [-0.166, SHOULDER - 0.058, -0.204], [-0.288, SHOULDER - 0.080, -0.088]], 0.022, 6, false, 1.3), M.skin, abs, 'clavR', 1);

    /* 首は無い: 顎下の肉と首の皮膚の襞が肩へ続く（頭の下半分が沈む） */
    var neck = this._node('neck', chest, -0.010, HEADY - SHOULDER - 0.118, -0.030);
    this._mesh(ell(0.158, 0.104, 0.150, 12), M.skin, neck, 'jowlBase');
    for (var nf = 0; nf < 3; nf++) {
      var fr = new THREE.TorusGeometry(0.126 + nf * 0.020, 0.032 + nf * 0.007, 5, 14);
      deform(fr, function (x, y, z, o) { o[1] = y + 0.010 * Math.sin(x * 22) - 0.006; o[0] = x * (1 + 0.06 * Math.sin(z * 18)); });
      var fm = this._mesh(fr, M.skin, neck, 'jowl', nf > 0 ? 1 : 0);
      fm.position.set(-0.002, 0.034 - nf * 0.042, -0.026 - nf * 0.008);
      fm.rotation.set(1.42 + nf * 0.06, 0, 0.05);
      this.jowls.push({ n: fm, p: nf * 1.3, y0: 0.034 - nf * 0.042, z0: -0.026 - nf * 0.008 });
    }
    var head = this._node('head', neck, -0.010, 0.118, -0.018);
    var jaw = this._node('jaw', head, 0, 0, 0);
    this._buildHead(head, jaw);

    /* 異様に長い腕（手は膝より下）・水で膨れた脚・鎖と鉤 */
    this._buildArms(chest);
    this._buildLegs(pelvis);
    this._buildChain();
    this._poses();
  };

  E.prototype._buildArms = function (chest) {
    var M = this.mats, self = this;
    [1, -1].forEach(function (s) {
      var tag = s > 0 ? 'L' : 'R';
      var sh = self._node('sh' + tag, chest, s * 0.336, -0.055, -0.020);
      self._mesh(limbGeo(UPARM, 0.134, 0.092, 0.30, 10), M.skin, sh, 'upperArm');
      self._tear(sh, [s * 0.085, -UPARM * 0.42, -0.020], [0.06, -0.30 * s, 0.40], 0.15, 0.018, 1241 + s);
      var el = self._node('el' + tag, sh, 0, -UPARM, 0);
      self._mesh(ell(0.092, 0.086, 0.092, 10), M.skin, el, 'elbow');
      self._mesh(limbGeo(FOREARM, 0.096, 0.070, 0.32, 10), M.skin, el, 'forearm');
      var wr = self._node('wr' + tag, el, 0, -FOREARM, 0);
      self._mesh(ell(0.074, 0.090, 0.040, 11), M.skin, wr, 'palm').position.set(0, -0.070, 0);
      for (var f = 0; f < 4; f++) {
        var fx = (f - 1.5) * 0.030, spread = (f - 1.5) * 0.14;
        var cur = new THREE.Group();
        cur.position.set(fx, -0.112, 0);
        cur.rotation.order = 'ZXY'; cur.rotation.z = spread * 0.45;
        wr.add(cur);
        for (var k = 0; k < 3; k++) {
          var nd = new THREE.Group();
          nd.rotation.order = 'ZXY';
          nd.rotation.x = 0.30 + k * (s > 0 ? 0.62 : 0.22);
          cur.add(nd);
          var l2 = 0.052 * (1 - k * 0.20);
          self._mesh(limbGeo(l2, 0.0155 - k * 0.0026, 0.0138 - k * 0.0026, 0.10, 6), M.skin, nd, 'phal');
              self._mesh(ell(0.0165 - k * 0.0026, 0.0150, 0.0160 - k * 0.0026, 6), M.skin, nd, 'knuckle', 1);
          var nx = new THREE.Group(); nx.position.set(0, -l2, 0); nd.add(nx);
          if (k === 2) self._mesh(ell(0.0090, 0.0140, 0.0070, 6), M.nail, nx, 'nail', 1).position.set(0, 0.006, -0.012);
          cur = nx;
        }
      }
      var th = new THREE.Group();
      th.position.set(-s * 0.046, -0.078, 0.014);
      th.rotation.z = s * 1.10;
      wr.add(th);
      self._mesh(limbGeo(0.060, 0.0170, 0.0130, 0.12, 6), M.skin, th, 'thumb');
    });
  };

  E.prototype._buildLegs = function (pelvis) {
    var M = this.mats, self = this;
    [1, -1].forEach(function (s) {
      var tag = s > 0 ? 'L' : 'R';
      var hp = self._node('hip' + tag, pelvis, s * 0.186, -0.070, -0.010);
      self._mesh(limbGeo(THIGH, 0.182, 0.132, 0.26, 10), M.skin, hp, 'thigh');
      self._suitShell(hp, [0, -0.100, 0], [0.212, 0.205, 0.212], s > 0 ? 2.05 : 3.45, 1.55, 0.30, 1.30, 900 + s * 11, 1);
      var kn = self._node('knee' + tag, hp, 0, -THIGH, 0);
      self._mesh(ell(0.128, 0.120, 0.132, 11), M.skin, kn, 'kneeBall');
      self._mesh(limbGeo(SHANK, 0.134, 0.090, 0.30, 10), M.skin, kn, 'shank');
      var an = self._node('ank' + tag, kn, 0, -SHANK, 0);
      self._mesh(ell(0.092, 0.080, 0.092, 10), M.skin, an, 'ankle');
      var ft = ell(0.098, 0.058, 0.150, 11);
      deform(ft, function (x, y, z, o) { o[1] = y * (1 - 0.4 * Math.max(0, -z / 0.132)); });
      var fm = self._mesh(ft, M.skin, an, 'foot');
      fm.position.set(0, -0.053, -0.070); fm.rotation.set(0, s * 0.10, 0);
      for (var t = 0; t < 5; t++) {
        self._mesh(ell(0.0155, 0.0130, 0.026, 5), M.skin, an, 'toe', 1)
          .position.set((t - 2) * 0.027, -0.069, -0.185 + Math.abs(t - 2) * 0.010);
      }
      /* 接地の基準は足裏（足首ではない）。groundSnap がここを床へ合わせる */
      self.contacts.push(self._node('sole' + tag, an, 0, -0.106, -0.070));
    });
  };

  /* 鎖と鉤（右手から床へ垂れ、後ろへ引きずられる。鉤は 0.4m の鋳鉄）。
     先頭3節は手首の子（手に追従）、残りは体の下に置いて床を這わせる。 */
  E.prototype._buildChain = function () {
    var M = this.mats, self = this;
    var wr = this.nodes.wrL;
    var lead = this._node('chainLead', wr, 0.010, -0.090, -0.020);
    var prev = lead;
    for (var i = 0; i < 3; i++) {
      var nd = new THREE.Group();
      nd.position.set(0, -0.058, 0);
      prev.add(nd);
      var lk = this._mesh(new THREE.TorusGeometry(0.030, 0.0095, 4, 8), M.iron, nd, 'link');
      lk.rotation.set(i % 2 ? 1.57 : 0, 0.3, 1.57);
      this.chain.push({ n: nd, p: i * 0.8, k: 0.9 });
      prev = nd;
    }
    /* 床を這う残り（体の後ろへ伸びる） */
    var root = this._node('chainDrag', this.group, 0.42, 0.036, 0.10);
    for (var j = 0; j < 11; j++) {
      var t = j / 10;
      var nd2 = new THREE.Group();
      nd2.position.set(0.016 + 0.022 * t, 0.014 * Math.max(0, 1 - t * 2.4), 0.070 + 0.012 * t);
      root.add(nd2);
      var lk2 = this._mesh(new THREE.TorusGeometry(0.032, 0.0100, 4, 8), M.iron, nd2, 'link', j > 4 ? 1 : 0);
      lk2.rotation.set(j % 2 ? 1.57 : 0, 0.30 + t * 0.6, 0.34 - t * 0.30);
      this.chain.push({ n: nd2, p: 1.2 + j * 0.55, k: 0.45 + 0.55 * t });
      root = nd2;
    }
    /* 鉤: 柄＋アイ＋湾曲＋尖った先端 */
    var hook = this._node('hook', root, 0, 0, 0.10);
    var hm = this._mesh(new THREE.TorusGeometry(0.030, 0.0115, 5, 10), M.iron, hook, 'hookEye', 1);
    hm.position.set(-0.020, -0.002, -0.055); hm.rotation.set(0.1, 0.4, 1.50);
    var sm = this._mesh(limbGeo(0.155, 0.0165, 0.0150, 0.02, 7), M.iron, hook, 'hookShaft');
    sm.position.set(-0.010, 0.000, -0.040); sm.rotation.set(-1.50, 0.42, 0);
    var hk = [];
    for (var h = 0; h <= 14; h++) {
      var a2 = -0.35 + h / 14 * 4.6;
      hk.push([0.052 + Math.cos(a2) * 0.105, Math.sin(a2) * 0.020, 0.105 + Math.sin(a2) * 0.105]);
    }
    this._mesh(tube(hk, 0.0155, 6, false, 1.4), M.iron, hook, 'hookCurve', 1);
    var tipm = this._mesh(limbGeo(0.085, 0.0150, 0.0010, 0.02, 6), M.iron, hook, 'hookTip');
    tipm.position.set(hk[14][0], hk[14][1], hk[14][2]); tipm.rotation.set(-1.15, -0.55, 0);
  };

  /* ---------------- 2形態の姿勢 ----------------
   * 契約「姿勢は同じで速度と揺れが変わる」。突進は前傾が深く腕を振り回す。 */
  E.prototype._poses = function () {
    var S = {
      pelvisY: HIP, chainSag: 1.0,
      pelvis: [0, 0, 0], spine: [-0.175, 0.06, -0.035], chest: [-0.05, 0, 0.02],
      neck: [0.12, -0.10, 0.04], head: [0.10, -0.18, 0.06], jaw: [0.10, 0, 0],
      shL: [-0.06, 0, 0.50], elL: [-0.24, 0, -0.30], wrL: [0.18, 0, 0.10],
      shR: [0.12, 0, -0.48], elR: [-0.10, 0, 0.30], wrR: [0.05, 0, -0.14],
      hipL: [0.06, 0, -0.03], kneeL: [0.14, 0, 0.02], ankL: [-0.16, 0.10, 0],
      hipR: [0.04, 0, 0.03], kneeR: [0.10, 0, -0.02], ankR: [-0.12, -0.10, 0]
    };
    var C = {
      pelvisY: HIP - 0.075, chainSag: 0.55,
      pelvis: [0, 0, 0], spine: [-0.52, 0.04, -0.02], chest: [-0.10, 0, 0.03],
      neck: [0.30, -0.06, 0.03], head: [0.36, -0.10, 0.05], jaw: [0.30, 0, 0],
      shL: [-0.62, 0, 0.46], elL: [-0.78, 0, -0.34], wrL: [0.30, 0, 0.14],
      shR: [-0.50, 0, -0.44], elR: [-0.70, 0, 0.32], wrR: [0.22, 0, -0.18],
      hipL: [0.30, 0, -0.05], kneeL: [0.42, 0, 0.02], ankL: [-0.30, 0.10, 0],
      hipR: [0.26, 0, 0.05], kneeR: [0.38, 0, -0.02], ankR: [-0.26, -0.10, 0]
    };
    this.POSE_STAND = S;
    this.POSE_CRAWL = C;
  };

  E.prototype._applyScalars = function (p) {
    var n = this.nodes;
    if (n.pelvis) n.pelvis.position.y = p.pelvisY;
  };

  E.prototype.applyPose = function (u, extra) {
    this.groundSnap = true;
    A2.Base.prototype.applyPose.call(this, u, extra);
  };

  /* 咆哮の時間曲線（契約 0.8 秒）: 前半で仰け反り、後半で一気に前へ出る */
  E.prototype.transEase = function (u) {
    if (u < 0.45) return -0.10 * Math.sin(u / 0.45 * Math.PI) * 0.6 + 0.24 * (u / 0.45);
    var t = (u - 0.45) / 0.55;
    return 0.24 + 0.76 * (1 - Math.pow(1 - t, 2.0));
  };

  /* ---------------- アニメーション ---------------- */
  E.prototype._animate = function (p, u, t, st, inTrans, raw) {
    var cyc = 0, amp = 0;
    if (st === 'walk' || (inTrans && this.transDir < 0)) { cyc = 1.38; amp = 1.0; }
    else if (st === 'chase') { cyc = 0.62; amp = 1.45; }
    if (cyc > 0) {
      var ph = (t % cyc) / cyc * Math.PI * 2;
      var s = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
      var lift = function (v) { return Math.max(0, v); };
      /* 脚: 重い。踏み出しは低く、着地で腰が沈む */
      p.hipL[0] += s * 0.40 * amp;
      p.kneeL[0] += lift(s) * 0.52 * amp + 0.06;
      p.ankL[0] += -lift(s) * 0.26 * amp + s * 0.10;
      p.hipR[0] += s2 * 0.40 * amp;
      p.kneeR[0] += lift(s2) * 0.52 * amp + 0.06;
      p.ankR[0] += -lift(s2) * 0.26 * amp + s2 * 0.10;
      p.pelvisY += (-0.030 + 0.026 * Math.cos(ph * 2)) * amp;
      p.pelvis[2] += 0.075 * s * amp;
      p.spine[2] += -0.055 * s * amp;
      p.spine[1] += 0.10 * s * amp;
      /* 腕: 逆位相で振り遅れる。突進では振り回す */
      p.shL[0] += s2 * (st === 'chase' ? 0.62 : 0.26) * amp;
      p.shL[2] += 0.10 * s * amp;
      p.elL[0] += -lift(s2) * 0.30 * amp;
      p.shR[0] += s * (st === 'chase' ? 0.58 : 0.24) * amp;
      p.shR[2] += -0.10 * s * amp;
      p.elR[0] += -lift(s) * 0.28 * amp;
      /* 肩に沈んだ頭は重く遅れて揺れる */
      p.neck[0] += 0.05 * Math.sin(ph * 2) * amp;
      p.head[1] += 0.07 * Math.sin(ph - 0.7) * amp;
      p.head[2] += 0.05 * s * amp;
      if (st === 'chase') p.jaw[0] += 0.10 + 0.08 * Math.abs(s);
    }
    /* 形態遷移＝咆哮（顎が落ちて口が開き、胸が反って肩が上がる） */
    if (inTrans) {
      var roar = Math.sin(Math.min(1, raw * 1.25) * Math.PI);
      p.jaw[0] += roar * 0.62;
      p.chest[0] -= roar * 0.34;
      p.neck[0] -= roar * 0.22;
      p.head[0] -= roar * 0.26;
      p.shL[2] += roar * 0.34; p.shR[2] -= roar * 0.34;
      p.shL[0] -= roar * 0.30; p.shR[0] -= roar * 0.30;
      p.pelvisY += roar * 0.030;
    }
    /* 捕獲演出: 膨れた顔が迫る（頭を前へ突き出し、口を開く） */
    if (this._cine > 0) {
      var c = this._cine;
      p.neck[0] = p.neck[0] * (1 - c) + 0.46 * c;
      p.head[0] = p.head[0] * (1 - c) + 0.28 * c;
      p.head[1] = p.head[1] * (1 - c) + (-0.10) * c;
      p.jaw[0] = p.jaw[0] * (1 - c) + 0.30 * c;
      p.spine[0] = p.spine[0] * (1 - c) + (-0.34) * c;
    }
  };

  /** 二次揺れ: 鎖（引きずり）と、顎下・首の肉の襞 */
  E.prototype._secondary = function (t, dt, st) {
    var k = (st === 'chase') ? 1.7 : 1.0, i;
    for (i = 0; i < this.chain.length; i++) {
      var c = this.chain[i];
      c.n.rotation.x = Math.sin(t * (2.1 + i * 0.13) + c.p) * 0.13 * k * c.k;
      c.n.rotation.z = Math.cos(t * (1.5 + i * 0.09) + c.p) * 0.11 * k * c.k;
    }
    for (i = 0; i < this.jowls.length; i++) {
      var j = this.jowls[i];
      j.n.position.z = j.z0 + Math.sin(t * (3.0 + i * 0.7) + j.p) * 0.006 * k;
      j.n.position.y = j.y0 + Math.sin(t * (2.6 + i * 0.5) + j.p + 1.2) * 0.005 * k;
    }
  };

  /* ---------------- 捕獲演出（顔アップ） ----------------
   * 契約: E は「鉤が視界に入り膨れた顔が迫る」。 */
  E.prototype._makeEyes = function () {
    var s = this.sockets || [[0.065, 0.021, -0.118], [-0.065, 0.015, -0.118]];
    return this._buildSocketGlow(this.nodes.head, [
      { p: s[0], r: 0.0115, k: 1.00, f1: 2.11, f2: 0.97, ph: 0.4 },
      { p: s[1], r: 0.0098, k: 0.74, f1: 2.93, f2: 0.61, ph: 2.2 }
    ]);
  };

  E.prototype._onDetail = function (level) { this._cine = (level === 'hi') ? 1 : 0; };

  /** 首を掴む手（camera 空間・-Z が前方）。E は水で膨れた太い手＋視界に入る鉤。 */
  E.prototype._makeGrabHands = function () {
    var M = this.mats, self = this;
    var root = new THREE.Group();
    root.name = 'grab-hands-E';
    function digit(parent, px, py, pz, rz, len, r0) {
      var cur = new THREE.Group();
      cur.position.set(px, py, pz);
      cur.rotation.order = 'ZXY'; cur.rotation.z = rz;
      parent.add(cur);
      for (var j = 0; j < 3; j++) {
        var nd = new THREE.Group();
        nd.rotation.x = -(0.78 + j * 0.66);
        cur.add(nd);
        var l2 = len * (1 - j * 0.18);
        self._mesh(limbGeo(l2, r0 - j * 0.0030, r0 * 0.88 - j * 0.0030, 0.18, 6), M.skin, nd, 'gPhal');
        self._mesh(ell(r0 * 1.20, r0 * 1.06, r0 * 1.14, 6), M.skin, nd, 'gKnuckle');
        var nx = new THREE.Group(); nx.position.set(0, -l2, 0); nd.add(nx);
        if (j === 2) self._mesh(ell(r0 * 0.56, r0 * 1.12, r0 * 0.46, 6), M.nail, nx, 'gNail');
        cur = nx;
      }
    }
    function arm(sx) {
      var a = new THREE.Group();
      a.name = sx > 0 ? 'grabHandR' : 'grabHandL';
      root.add(a);
      var fore = new THREE.Group();
      fore.position.set(sx * 0.66, -0.30, -1.02);
      fore.rotation.set(1.05, 0, sx * 1.02);
      a.add(fore);
      self._mesh(limbGeo(0.92, 0.105, 0.072, 0.30, 9), M.skin, fore, 'gForearm');
      /* 反射帯の名残が前腕を巻く（この体の印＝防護服の残骸） */
      var bd = self._mesh(new THREE.TorusGeometry(0.098, 0.014, 4, 12), M.band, fore, 'gBand');
      bd.position.set(0, -0.22, 0); bd.rotation.set(1.57, 0, 0);
      var wr = new THREE.Group();
      wr.position.set(sx * 0.205, -0.235, -0.470);
      wr.rotation.set(0.38, 0, -sx * 0.48);
      a.add(wr);
      self._mesh(ell(0.086, 0.034, 0.082, 10), M.skin, wr, 'gPalm');
      for (var f = 0; f < 4; f++) digit(wr, (f - 1.5) * 0.038 * -sx, -0.022, -0.056, (f - 1.5) * 0.13, 0.082, 0.0195);
      digit(wr, sx * 0.058, -0.014, 0.026, -sx * 1.08, 0.070, 0.0210);
    }
    arm(-1); arm(1);
    /* 右下から視界に入る鎖と鉤（契約「鉤が視界に入り」） */
    var hook = new THREE.Group();
    hook.position.set(0.52, -0.46, -0.72);
    hook.rotation.set(0.35, -0.55, -0.85);
    root.add(hook);
    for (var i = 0; i < 5; i++) {
      var lk = this._mesh(new THREE.TorusGeometry(0.046, 0.014, 4, 9), M.iron, hook, 'gLink');
      lk.position.set(0.018 * i, 0.086 * i, 0.010 * i);
      lk.rotation.set(i % 2 ? 1.57 : 0, 0.3, 1.2);
    }
    var hk = [];
    for (var h = 0; h <= 14; h++) {
      var a2 = -0.35 + h / 14 * 4.6;
      hk.push([Math.cos(a2) * 0.135, Math.sin(a2) * 0.028 - 0.10, Math.sin(a2) * 0.135]);
    }
    this._mesh(tube(hk, 0.021, 6, false, 1.4), M.iron, hook, 'gHook');
    var tip = this._mesh(limbGeo(0.11, 0.020, 0.0014, 0.02, 6), M.iron, hook, 'gHookTip');
    tip.position.set(hk[14][0], hk[14][1], hk[14][2]); tip.rotation.set(-1.15, -0.55, 0);
    return root;
  };

  /** 「食われる」用の口（横に裂ける普通の顎）。半幅 1.0 の単位系で camera 空間に置く */
  E.prototype._makeMaw = function () {
    var M = this.mats, self = this;
    var root = new THREE.Group();
    root.name = 'maw-E';
    var upper = new THREE.Group(); upper.name = 'mawUpper'; root.add(upper);
    var lower = new THREE.Group(); lower.name = 'mawLower'; root.add(lower);
    /* 喉の闇（奥へすぼまる袋） */
    var gul = ell(1.30, 1.40, 1.80, 14, 10);
    deform(gul, function (x, y, z, o) {
      var t = clamp((z + 1.80) / 3.60, 0, 1);
      o[0] = x * (0.20 + 0.80 * t); o[1] = y * (0.22 + 0.78 * t); o[2] = z;
    });
    this._mesh(gul, M.void, root, 'gullet').position.set(0, 0, 1.10);
    function row(parent, up, n, seedN) {
      var rr = rng(seedN);
      /* 歯茎の畝（前方の弧） */
      var gp = [], q;
      for (q = 0; q <= 12; q++) {
        var a = (q / 12) * Math.PI - Math.PI / 2;
        gp.push([Math.sin(a) * 1.00, up ? 0.05 : -0.05, -Math.cos(a) * 0.66]);
      }
      self._mesh(tube(gp, 0.115, 6, false, 1.3), M.gum, parent, 'mawGum');
      for (var i = 0; i < n; i++) {
        var a2 = (i + 0.5) / n * Math.PI - Math.PI / 2;
        if (rr() < 0.16) continue;                  /* 抜けた歯（不揃いの歯列） */
        var len = (0.20 + rr() * 0.24) * (up ? 1.05 : 0.92);
        var w = 0.060 + rr() * 0.050;
        var cone = new THREE.ConeGeometry(w, len, 5);
        cone.translate(0, up ? -len / 2 : len / 2, 0);
        var tm = self._mesh(cone, M.tooth, parent, 'mawTooth');
        tm.position.set(Math.sin(a2) * 1.00, up ? 0.02 : -0.02, -Math.cos(a2) * 0.64);
        tm.rotation.set((up ? 1 : -1) * (0.16 + rr() * 0.26), -a2, (rr() - 0.5) * 0.24);
      }
      /* 膨れた唇（縁が厚く垂れる） */
      var lp = [];
      for (q = 0; q <= 12; q++) {
        var a3 = (q / 12) * Math.PI - Math.PI / 2;
        lp.push([Math.sin(a3) * 1.16, (up ? 0.16 : -0.18) + ((q % 3) - 1) * 0.02, -Math.cos(a3) * 0.80]);
      }
      self._mesh(tube(lp, 0.150, 7, false, 1.3), M.face, parent, 'mawLip');
    }
    row(upper, true, 13, 4801);
    row(lower, false, 11, 9109);
    var maw = {
      group: root,
      setOpen: function (u) {
        upper.rotation.x = -0.06 - 0.70 * u;
        lower.rotation.x = 0.06 + 0.64 * u;
        upper.position.y = 0.05 + 0.30 * u;
        lower.position.y = -0.05 - 0.28 * u;
      }
    };
    maw.setOpen(0);
    return maw;
  };

  ESCAPE.EnemyModelsA2 = ESCAPE.EnemyModelsA2 || {};
  ESCAPE.EnemyModelsA2.E = E;
})(window);
