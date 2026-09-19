/* ESCAPE — P5e-2a 案D「配管を這う」本番モデル
 * 契約 DESIGN.md §4「P5e-2」／造形の正＝ audit/enemy-mocks-a2/3d/mock_D.js（P5e-1 目視合格版）。
 * モックの彫り方をそのまま移植し、モックのファイルには依存しない（本番は自己完結）。
 *
 * 2形態（名前は既存互換・意味はこの体のもの）:
 *   stand … 天井を這う。幹線/合流槽（天井 4.6〜5.0）では天井に張り付き、
 *           支線（2.4）では壁の上部 1.9m へ逃げて横に這う。
 *   crawl … 床に落ちて四つ足で疾走する。
 *   遷移 1.2 秒 … 手を離し、逆さの顔が先に落ちて、体が遅れて回り込み着地する。
 *
 * リグの向き: 造形は「床にいる姿（肢が −Y へ、棘突起が +Y、逆さの顔が前へ垂れる）」で作り、
 * 天井形態は mount ノードを Z 軸まわりに π 回して裏返す（正面 −Z は保たれる）。
 * 顔だけは headRoll を逆に回すので、どちらの形態でも**顔は常に逆さのまま**こちらを向く。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE, THREE = global.THREE;
  var A2 = ESCAPE.EnemyA2;
  var ell = A2.ell, tube = A2.tube, seg = A2.seg, strip = A2.strip;
  var bulge = A2.bulge, ridge = A2.ridge, warp = A2.warp, deform = A2.deform;
  var clamp = A2.clamp, rng = A2.rng;

  var HRX = 0.098, HRY = 0.140, HRZ = 0.126;   /* 頭の基準半径（モックと同値） */
  var BODY_Y = 0.80;                            /* 床形態での胴の高さ(m) */
  var CEIL_GAP = 0.40;                          /* 天井形態で胴が天井から下がる量(m) */
  var LOW_CEIL = 3.20;                          /* これ未満なら支線＝壁の上部へ */
  var WALL_Y = 1.90;                            /* 支線で張り付く高さ(m) */

  function D(opts) {
    A2.Base.call(this, opts);
    this.kind = 'D';
    this.transDur = 1.20;                       /* 契約: 落下の遷移は 1.2 秒 */
    this.fingers = [];
    this.hair = [];
    this._cineDrop = 0;
    this._build();
    this.setForm('stand', true);
    this.applyPose(0);
  }
  A2.extend(D);

  /* ---------------- 材質 ---------------- */
  D.prototype._mats = function () {
    var M = this.mats;
    M.skin = this._lit(A2.skin({
      seed: 311, size: 256, base: '#4c5156', dark: 'rgba(6,8,9,', veinColor: 'rgba(26,34,44,0.55)',
      mottle: 210, vein: 90, wrinkle: 330, pore: 0.44, bump: 3.6, roughLo: 0.40, roughHi: 0.92,
      tint: 0x3f464b, metalness: 0, repeat: [2, 2]
    }), 'body');
    M.face = this._lit(A2.skin({
      seed: 313, size: 384, base: '#5b6166', dark: 'rgba(7,9,10,', veinColor: 'rgba(30,40,52,0.5)',
      mottle: 250, vein: 130, wrinkle: 300, pore: 0.55, bump: 3.0, roughLo: 0.44, roughHi: 0.94,
      tint: 0x444d54, metalness: 0, repeat: [6, 5], nscale: 1.55
    }), 'face');
    M.bone = this._lit(A2.skin({
      seed: 319, size: 256, base: '#7c7867', dark: 'rgba(34,31,24,', veinColor: 'rgba(58,48,34,0.4)',
      mottle: 170, vein: 26, wrinkle: 230, pore: 0.26, bump: 2.4, roughLo: 0.62, roughHi: 0.96,
      tint: 0x35332c, metalness: 0, repeat: [3, 3]
    }), 'body');
    /* 眼窩と口腔と鼻腔の底＝光を拾わない闇（実ライトでも白く浮かない） */
    M.void = this._track(new THREE.MeshBasicMaterial({ color: 0x000000, fog: true }));
    M.gum = this._lit(A2.mat(0x3a1512, 0.70, 0, { side: THREE.DoubleSide }), 'flesh');
    M.flesh = this._lit(A2.mat(0x4c1a19, 0.62, 0, { side: THREE.DoubleSide }), 'flesh');
    M.tooth = this._lit(A2.mat(0x4a4533, 0.88, 0), 'tooth');
    /* 唇の断面は小さく凸なので近接の実ライトで白飛びしやすい。専用に暗く粗く持つ */
    M.lip = this._lit(A2.mat(0x3b322b, 0.90, 0), 'flesh');
    M.nail = this._lit(A2.mat(0x35352d, 0.52, 0), 'body');
    M.sinew = this._lit(A2.mat(0x554738, 0.52, 0), 'flesh');
    M.oil = this._lit(A2.mat(0x0b0d10, 0.38, 0), 'hair');
    M.hair = this._lit(A2.mat(0x07080a, 0.62, 0), 'hair');
    M.cloth = M.oil;                             /* capture.js が mats.cloth を読む（油膜で代用） */
    return M;
  };

  /* ---------------- 頭蓋の殻（造形の正＝モック D の head()） ---------------- */
  D.prototype._skullGeo = function (segN) {
    var X = HRX, Y = HRY, Z = HRZ;
    var sk = A2.headShell({
      rx: X, ry: Y, rz: Z, seg: segN, socket: 0.070, eye: 0,
      temple: 0.040, cheek: 0.034, nose: 0.022, jaw: 1.22, chin: 0.015, brow: 0.026, seed: 31
    });
    bulge(sk, [0, Y * 0.86, Z * 0.10], X * 0.85, 0.012);
    bulge(sk, [X * 1.02, Y * 0.34, -Z * 0.26], X * 0.60, -0.022);
    bulge(sk, [-X * 1.00, Y * 0.28, -Z * 0.30], X * 0.56, -0.030);
    ridge(sk, [0, Y * 0.96, -Z * 0.30], [0, Y * 0.62, Z * 0.86], X * 0.22, 0.0075, 1.6);
    bulge(sk, [-X * 0.58, Y * 0.72, -Z * 0.22], X * 0.50, -0.013);
    bulge(sk, [X * 0.72, Y * 0.02, -Z * 0.66], 0.040, 0.016);
    bulge(sk, [-X * 0.68, -Y * 0.02, -Z * 0.64], 0.038, 0.013);
    bulge(sk, [X * 0.76, -Y * 0.20, -Z * 0.54], X * 0.50, -0.038);
    bulge(sk, [-X * 0.72, -Y * 0.26, -Z * 0.52], X * 0.48, -0.044);
    ridge(sk, [X * 0.40, -Y * 0.56, -Z * 0.74], [-X * 0.40, -Y * 0.60, -Z * 0.74], X * 0.24, 0.012, 1.5);
    ridge(sk, [X * 0.34, -Y * 0.40, -Z * 0.82], [-X * 0.34, -Y * 0.44, -Z * 0.82], X * 0.18, -0.008, 1.5);
    /* 正中の縦裂（口が縦に裂ける）と、左右で違う量に捲れる縁 */
    ridge(sk, [0, -Y * 0.24, -Z * 0.90], [0, -Y * 1.04, -Z * 0.56], X * 0.28, -0.048, 1.2);
    ridge(sk, [X * 0.26, -Y * 0.28, -Z * 0.84], [X * 0.26, -Y * 0.98, -Z * 0.52], X * 0.16, 0.014, 1.5);
    ridge(sk, [-X * 0.23, -Y * 0.32, -Z * 0.84], [-X * 0.23, -Y * 1.02, -Z * 0.50], X * 0.14, 0.010, 1.5);
    ridge(sk, [X * 0.30, -Y * 0.30, Z * 0.90], [X * 0.24, -Y * 0.80, Z * 0.70], X * 0.16, -0.008, 1.5);
    /* 眼窩（左右で大きさが違う・骨縁が立つ） */
    bulge(sk, [X * 0.52 + 0.006, Y * 0.24 + 0.010, -Z * 0.78], 0.064, 0.012);
    bulge(sk, [X * 0.52 + 0.006, Y * 0.24 + 0.010, -Z * 0.78], 0.048, -0.040);
    bulge(sk, [-X * 0.52 - 0.009, Y * 0.24 - 0.008, -Z * 0.78], 0.058, 0.010);
    bulge(sk, [-X * 0.52 - 0.009, Y * 0.24 - 0.008, -Z * 0.78], 0.043, -0.036);
    /* 頬骨弓とその下の影の溝 */
    ridge(sk, [X * 0.70, Y * 0.02, -Z * 0.68], [X * 0.98, Y * 0.12, Z * 0.26], X * 0.24, 0.014, 1.8);
    ridge(sk, [-X * 0.66, -Y * 0.02, -Z * 0.66], [-X * 0.94, Y * 0.08, Z * 0.24], X * 0.22, 0.011, 1.8);
    ridge(sk, [X * 0.68, -Y * 0.16, -Z * 0.62], [X * 0.94, -Y * 0.08, Z * 0.20], X * 0.18, -0.013, 1.6);
    ridge(sk, [-X * 0.64, -Y * 0.20, -Z * 0.60], [-X * 0.90, -Y * 0.12, Z * 0.18], X * 0.17, -0.015, 1.6);
    /* 眼窩の骨縁（上は鋭く・下は厚く） */
    ridge(sk, [X * 0.14, Y * 0.40, -Z * 0.82], [X * 0.92, Y * 0.30, -Z * 0.46], X * 0.14, 0.012, 2.0);
    ridge(sk, [-X * 0.14, Y * 0.38, -Z * 0.82], [-X * 0.88, Y * 0.24, -Z * 0.46], X * 0.13, 0.009, 2.0);
    ridge(sk, [X * 0.18, Y * 0.06, -Z * 0.80], [X * 0.92, Y * 0.12, -Z * 0.46], X * 0.13, 0.011, 2.0);
    ridge(sk, [-X * 0.18, Y * 0.04, -Z * 0.80], [-X * 0.88, Y * 0.08, -Z * 0.46], X * 0.12, 0.009, 2.0);
    /* 眉弓（重い庇・左右非対称） */
    ridge(sk, [X * 0.08, Y * 0.44, -Z * 0.84], [X * 0.86, Y * 0.34, -Z * 0.50], X * 0.34, 0.020, 1.5);
    ridge(sk, [-X * 0.08, Y * 0.40, -Z * 0.84], [-X * 0.80, Y * 0.26, -Z * 0.50], X * 0.30, 0.015, 1.5);
    bulge(sk, [X * 0.98, Y * 0.30, -Z * 0.30], 0.055, -0.026);
    bulge(sk, [-X * 0.96, Y * 0.26, -Z * 0.32], 0.052, -0.030);
    bulge(sk, [X * 0.42, Y * 0.66, -Z * 0.72], 0.046, 0.010);
    bulge(sk, [-X * 0.38, Y * 0.70, -Z * 0.70], 0.042, 0.008);
    bulge(sk, [0, Y * 0.46, -Z * 0.84], 0.030, -0.010);
    bulge(sk, [X * 0.78, -Y * 0.66, -Z * 0.30], 0.042, 0.014);
    bulge(sk, [-X * 0.74, -Y * 0.70, -Z * 0.28], 0.040, 0.010);
    warp(sk, 0.0030, 19, 12);
    return sk;
  };

  /* ---------------- 顔一式（逆さの頭。ローカルは正立・正面 −Z） ---------------- */
  D.prototype._buildHead = function (head) {
    var X = HRX, Y = HRY, Z = HRZ, M = this.mats, self = this;
    /* 皮膚の殻（高詳細／低詳細を持ち、setDetail('lo') で差し替える） */
    var hi = this._skullGeo(64), lo = this._skullGeo(26);
    var face = this._mesh(hi, M.face, head, 'faceShell');
    this._track(lo);
    this.lodSwap.push({ mesh: face, hi: hi, lo: lo });
    this.faceMesh = face;

    /* 眉間の塊と鼻骨の稜（骨を皮膚の下から押し上げる） */
    this._mesh(ell(0.019, 0.014, 0.011, 8), M.bone, head, 'glabella').position.set(-0.002, Y * 0.47, -Z * 0.88);
    var nb = this._mesh(ell(0.0080, 0.030, 0.011, 8), M.bone, head, 'nasalBone');
    nb.position.set(0.001, Y * 0.28, -Z * 0.92); nb.rotation.set(0.26, 0, 0.05);

    /* 眼窩: 底の見えない空洞（眼球は置かない＝契約「眼にハイライト無し」） */
    this.sockets = [];
    [[1, 0.052, 0.033, 0.010, 0.006], [-1, 0.046, 0.030, -0.009, -0.010]].forEach(function (p) {
      var s = p[0], rx2 = p[1], ry2 = p[2], cy = p[3], cx = p[4];
      var ex = s * X * 0.52 + cx, ey = Y * 0.24 + cy, ez = -Z * 0.54;
      var hole = ell(rx2, ry2, 0.056, 14, 10);
      deform(hole, function (x, y, z, o) {
        o[0] = x * (1 - 0.34 * clamp(-z / 0.056, 0, 1));
        o[1] = y * (1 - 0.34 * clamp(-z / 0.056, 0, 1)) - 0.10 * ry2 * clamp(z / 0.056, 0, 1);
      });
      var m = self._mesh(hole, M.void, head, 'socket');
      m.position.set(ex, ey, ez); m.rotation.set(0.10, s * 0.16, s * 0.22);
      self.sockets.push([ex, ey, ez - 0.022]);
    });

    /* 梨状口（涙形の鼻腔2つ）と鼻棘 */
    var pyr = ell(0.020, 0.026, 0.044, 12, 8);
    deform(pyr, function (x, y, z, o) {
      var t = clamp((y / 0.026 + 1) * 0.5, 0, 1);
      o[0] = x * (0.28 + 0.85 * (1 - t)); o[1] = y * 1.15; o[2] = z;
    });
    var pm = this._mesh(pyr, M.void, head, 'pyriform');
    pm.position.set(0.001, -Y * 0.02, -Z * 0.60); pm.rotation.set(0.20, 0, 0.05);
    this._mesh(ell(0.0050, 0.014, 0.008, 6), M.bone, head, 'nasalSpine').position.set(0, -Y * 0.09, -Z * 0.91);

    /* 縦に裂けた口: 唇の断面・歯茎の畝・1本ずつの歯・奥の喉の闇 */
    var N = 13, eL = [], eR = [], iL = [], iR = [], back = [], k, t, y, w, jag, ze;
    for (k = 0; k <= N; k++) {
      t = k / N; y = -Y * 0.22 - (Y * 0.86) * t;
      w = 0.026 * Math.sin(Math.PI * Math.pow(t, 0.70)) + 0.005;
      jag = ((k % 3) - 1) * 0.0011 + ((k % 5) - 2) * 0.0007;
      ze = -Z * 0.86 + 0.020 * Math.abs(t - 0.45) + 0.016 * t;
      eL.push([w + jag, y, ze]); eR.push([-w * 0.92 - jag, y, ze]);
      iL.push([w * 0.52, y, ze + 0.036]); iR.push([-w * 0.50, y, ze + 0.036]);
      back.push([0, y, ze + 0.062]);
    }
    this._mesh(strip(eL, iL), M.flesh, head, 'lipCutL');
    this._mesh(strip(iR, eR), M.flesh, head, 'lipCutR');
    this._mesh(strip(iL, back), M.gum, head, 'mucosaL');
    this._mesh(strip(back, iR), M.gum, head, 'mucosaR');
    this._mesh(ell(0.016, Y * 0.40, 0.026, 10, 7), M.void, head, 'throat')
      .position.set(0, -Y * 0.62, -Z * 0.50);
    this._mesh(tube(eL, 0.0046, 5, false, 1.5), M.lip, head, 'lipL');
    this._mesh(tube(eR, 0.0042, 5, false, 1.5), M.lip, head, 'lipR');
    [1, -1].forEach(function (s) {
      var gp = [], q, t2, ww;
      for (q = 0; q <= 8; q++) {
        t2 = q / 8; ww = (0.026 * Math.sin(Math.PI * Math.pow(t2, 0.70)) + 0.005) * 0.62;
        gp.push([s * ww, -Y * 0.24 - (Y * 0.82) * t2, -Z * 0.78 + 0.018 * t2]);
      }
      self._mesh(tube(gp, 0.0062, 5, false, 1.4), M.gum, head, 'gum');
      /* 歯茎の畝の内側に湿った暗赤（口の中に色を残す） */
      var R2 = rng(s > 0 ? 41 : 47);
      for (var n = 0; n < 11; n++) {
        var t3 = 0.05 + 0.90 * n / 10;
        var ww2 = (0.026 * Math.sin(Math.PI * Math.pow(t3, 0.70)) + 0.005) * 0.68;
        if (R2() < 0.16) continue;                       /* 欠けた歯 */
        var hh = 0.007 + R2() * 0.030, cw = 0.0028 + R2() * 0.0046;
        var cone = new THREE.ConeGeometry(cw, hh, 5);
        cone.translate(0, -hh / 2, 0);
        var tm = self._mesh(cone, M.tooth, head, 'tooth', 1);
        tm.position.set(s * ww2, -Y * 0.24 - (Y * 0.82) * t3, -Z * 0.81 + 0.018 * t3 + (R2() - 0.5) * 0.005);
        tm.rotation.order = 'ZXY';
        tm.rotation.z = s * (1.34 + (R2() - 0.5) * 0.62);
        tm.rotation.x = (R2() - 0.5) * 0.62;
      }
    });

    /* 下顎の枝と関節（縦裂で割れているので左右が離れる） */
    [1, -1].forEach(function (s) {
      var kk = s > 0 ? 1 : 0.9;
      var ram = tube([
        [s * X * 0.30, -Y * 1.00, -Z * 0.56], [s * X * 0.74, -Y * 0.82, -Z * 0.30],
        [s * X * 0.92, -Y * 0.34, -Z * 0.06], [s * X * 0.88, -Y * 0.02, Z * 0.08]
      ], 0.0125 * kk, 6, false, 1.4);
      self._mesh(ram, M.bone, head, 'ramus').scale.set(0.72, 1, 1);
      self._mesh(ell(0.013 * kk, 0.009, 0.011, 7), M.bone, head, 'condyle')
        .position.set(s * X * 0.88, Y * 0.02, Z * 0.10);
    });

    /* 耳の残骸（左右で残り方が違う）＋外耳道の闇 */
    var e1 = this._mesh(new THREE.TorusGeometry(0.023, 0.0062, 5, 12, 4.1), M.face, head, 'earL', 1);
    e1.position.set(X * 1.06, -Y * 0.02, Z * 0.16); e1.rotation.set(0.2, 1.5, 0.8);
    var e2 = this._mesh(new THREE.TorusGeometry(0.014, 0.0044, 5, 10, 2.7), M.face, head, 'earR', 1);
    e2.position.set(-X * 1.04, -Y * 0.12, Z * 0.20); e2.rotation.set(0.1, -1.5, -0.9);
    this._mesh(ell(0.0065, 0.0075, 0.0065, 6), M.void, head, 'earCanal', 1)
      .position.set(X * 1.02, -Y * 0.03, Z * 0.14);

    /* 濡れた短い髪の束（二次揺れの対象。根元ノードを持つ） */
    var RH = rng(97);
    for (var h = 0; h < 14; h++) {
      var a = RH() * 6.284, rr2 = 0.30 + RH() * 0.70;
      var hx = Math.sin(a) * X * rr2 * 0.7, hz = Math.abs(Math.cos(a)) * Z * rr2 * 0.6 + Z * 0.62;
      var len = 0.022 + RH() * 0.040;
      var nd = new THREE.Group();
      nd.position.set(hx, Y * 0.86, hz);
      head.add(nd);
      this._mesh(tube([
        [0, 0, 0], [hx * 0.10, len * 0.4, hz * 0.05],
        [hx * 0.16 + (RH() - 0.5) * 0.012, len, hz * 0.08]
      ], 0.0013 + RH() * 0.0012, 3, false, 1.4), M.hair, nd, 'hair', 1);
      this.hair.push({ n: nd, p: RH() * 6.284, k: 0.9 + RH() * 0.9 });
    }
    /* 垂れる油の筋（皮膚を伝って顎先＝上へ集まる） */
    var RO = rng(53);
    for (var o2 = 0; o2 < 6; o2++) {
      var ax = (RO() - 0.5) * X * 1.7, az = -Z * (0.20 + RO() * 0.30);
      this._mesh(tube([
        [ax, Y * 0.30 - RO() * 0.06, az], [ax * 0.8, -Y * 0.30, az - 0.006],
        [ax * 0.5, -Y * 0.90 - RO() * 0.10, az * 0.7]
      ], 0.0013 + RO() * 0.0011, 3, false, 1.4), M.oil, head, 'oil', 1);
    }
  };

  /* -Y 方向へ伸びる円錐台（肢の節・指の節） */
  function limbSeg(r0, r1, len, rad) {
    var g = new THREE.CylinderGeometry(r1, r0, len, rad || 8, 1, false);
    g.translate(0, -len / 2, 0);
    return g;
  }

  /* 配管／天井を掴む手。指は3節・節ごとに骨頭・爪。ノードを返して開閉できるようにする */
  D.prototype._buildHand = function (parent, sx, seedN) {
    var M = this.mats, R = rng(seedN), self = this;
    var hand = this._node('H' + seedN, parent, 0, -0.26, 0);
    this._mesh(ell(0.052, 0.020, 0.062, 10), M.skin, hand, 'palm');
    for (var mc = 0; mc < 4; mc++) {
      this._mesh(limbSeg(0.0075, 0.0060, 0.052, 5), M.skin, hand, 'meta', 1)
        .position.set((-0.028 + mc * 0.019) * sx, 0.004, -0.010);
    }
    for (var f = 0; f < 4; f++) {
      var a0 = -0.58 + f * 0.39;
      var base = new THREE.Group();
      base.position.set(Math.sin(a0) * 0.048 * sx, -0.010, -0.046);
      base.rotation.order = 'ZXY';
      base.rotation.z = a0 * 0.55 * sx;
      hand.add(base);
      var cur = base, len = 0.078 + (f === 1 || f === 2 ? 0.026 : 0);
      for (var j = 0; j < 3; j++) {
        var nd = new THREE.Group();
        nd.rotation.order = 'ZXY';
        cur.add(nd);
        var l2 = len * (1 - j * 0.18);
        this._mesh(limbSeg(0.0132 - j * 0.0024, 0.0110 - j * 0.0024, l2, 6), M.skin, nd, 'phal');
        this._mesh(ell(0.0150 - j * 0.0024, 0.0132, 0.0142 - j * 0.0024, 6), M.skin, nd, 'knuckle', 1);
        if (j === 2) {
          this._mesh(ell(0.0082, 0.0168, 0.0068, 6), M.nail, nd, 'nail', 1)
            .position.set(0, -l2 - 0.004, -0.006);
        }
        this.fingers.push({ n: nd, base: (j === 0 ? 0.34 : 0.62) });
        var nxt = new THREE.Group();
        nxt.position.set(0, -l2, 0);
        nd.add(nxt);
        cur = nxt;
      }
    }
    /* 親指は反対側から回り込む */
    var th = new THREE.Group();
    th.position.set(-sx * 0.040, -0.012, 0.018);
    th.rotation.order = 'ZXY'; th.rotation.z = -sx * 1.05;
    hand.add(th);
    this._mesh(limbSeg(0.0140, 0.0110, 0.070, 6), M.skin, th, 'thumb');
    this.fingers.push({ n: th, base: -sx * 1.05, axis: 'x', bx: 0.30 });
    this.contacts.push(hand);
    return hand;
  };

  /* ---------------- 骨組み ---------------- */
  D.prototype._build = function () {
    var M = this._mats(), self = this;
    var mount = this._node('mount', this.group, 0, BODY_Y, 0);
    var body = this._node('body', mount, 0, 0, 0);

    /* 胴: 長い紡錘。棘突起・肋・骨盤が皮膚の下に浮く（高/低の2段） */
    function torsoGeo(sx2, sy2) {
      var g = new THREE.SphereGeometry(1, sx2, sy2);
      g.scale(0.215, 0.205, 0.700);
      deform(g, function (x, y, z, o) {
        var nz = z / 0.700;
        var k = 1 - 0.56 * Math.pow(Math.abs(nz), 3.0);
        k *= 1 + 0.34 * Math.exp(-Math.pow((nz - 0.52) * 3.0, 2));
        k *= 1 + 0.22 * Math.exp(-Math.pow((nz + 0.55) * 3.2, 2));
        k *= 1 - 0.34 * Math.exp(-Math.pow((nz + 0.02) * 4.2, 2));
        o[0] = x * k * (1 + 0.10 * Math.sin(nz * 2.1));
        o[1] = y * k - 0.050 * Math.pow(Math.abs(nz), 2);
        o[2] = z;
      });
      for (var r = 0; r < 9; r++) {
        var rz2 = 0.44 - r * 0.070;
        ridge(g, [-0.17, -0.04, rz2], [0.17, 0.04, rz2 + 0.020], 0.046, 0.0225, 1.5);
        ridge(g, [-0.03, -0.10, rz2 + 0.033], [0.15, -0.02, rz2 + 0.043], 0.036, -0.0110, 1.4);
      }
      ridge(g, [0.00, 0.150, 0.66], [0.00, 0.145, -0.68], 0.050, 0.0270, 1.3);
      for (var v = 0; v < 13; v++) bulge(g, [0.0, 0.178, 0.62 - v * 0.106], 0.034, 0.0150);
      ridge(g, [-0.03, -0.195, 0.18], [-0.03, -0.190, -0.42], 0.046, -0.0180, 1.4);
      warp(g, 0.0125, 6, 8);
      return g;
    }
    var tHi = torsoGeo(30, 20), tLo = torsoGeo(16, 11);
    var tm = this._mesh(tHi, M.skin, body, 'torso');
    this._track(tLo);
    this.lodSwap.push({ mesh: tm, hi: tHi, lo: tLo });

    /* 首（胴の前端から垂れる）と頭 */
    var neck = this._node('neck', body, 0, 0.01, -0.60);
    var nk = tube([[0, 0, 0], [0.01, -0.11, -0.03], [0.02, -0.23, -0.04], [0.02, -0.32, -0.03]], 0.072, 9, false, 1.6);
    ridge(nk, [0, -0.02, -0.055], [0.02, -0.30, -0.075], 0.024, 0.007, 1.6);
    this._mesh(nk, M.skin, neck, 'neck');
    this._mesh(tube([[0.035, -0.04, -0.050], [0.040, -0.18, -0.060], [0.036, -0.30, -0.050]], 0.0090, 4, false, 1.3), M.sinew, neck, 'sinewL', 1);
    this._mesh(tube([[-0.030, -0.05, -0.055], [-0.036, -0.18, -0.062], [-0.032, -0.30, -0.052]], 0.0072, 4, false, 1.3), M.sinew, neck, 'sinewR', 1);
    var head = this._node('head', neck, 0, -0.345, -0.010);
    this._buildHead(head);

    /* 四肢（各4節・関節3つ以上）。attach: [sx, x, z] */
    var ATT = [[1, 0.205, -0.40], [-1, -0.205, -0.40], [1, 0.215, 0.42], [-1, -0.215, 0.42]];
    this.limbs = [];
    ATT.forEach(function (A, i) {
      var sx = A[0];
      var a = self._node('L' + i + 'a', body, A[1], -0.02, A[2]);
      self._mesh(ell(0.115, 0.098, 0.115, 10), M.skin, a, 'shoulder');
      var LEN = [0.44, 0.42, 0.34], RAD = [0.105, 0.086, 0.068, 0.050];
      var cur = a;
      for (var j = 0; j < 3; j++) {
        var g2 = limbSeg(RAD[j] - (i > 1 ? 0.008 : 0), RAD[j + 1] - (i > 1 ? 0.008 : 0), LEN[j], 10);
        ridge(g2, [RAD[j] * 0.8, -LEN[j] * 0.15, 0], [RAD[j + 1] * 0.8, -LEN[j] * 0.85, 0], RAD[j] * 0.9, RAD[j] * 0.10, 1.6);
        self._mesh(g2, M.skin, cur, 'limbSeg');
        var nx = self._node('L' + i + String.fromCharCode(98 + j), cur, 0, -LEN[j], 0);
        self._mesh(ell(RAD[j + 1] * 1.28, RAD[j + 1] * 1.40, RAD[j + 1] * 1.24, 8), M.skin, nx, 'joint');
        self._mesh(tube([[0, 0.02, -RAD[j + 1] * 0.9], [0, -0.09, -RAD[j + 1] * 0.7]], RAD[j + 1] * 0.22, 4, false, 1.2), M.sinew, nx, 'tendon', 1);
        cur = nx;
      }
      self._buildHand(cur, sx, 500 + i * 7);
      self.limbs.push({ sx: sx, i: i });
    });
    this._poses();
  };

  /* ---------------- 2形態の姿勢 ----------------
   * 造形は床の姿で作ってあるので、天井形態は mount を Z 軸に π 回して裏返す。
   * 肢はどちらの形態でも「ローカル −Y ＝ 張り付いている面の方向」なので、
   * 違うのは開き具合と折り畳み方だけ（＝同じ生き物の同じ肢に見える）。 */
  D.prototype._poses = function () {
    var S = { mountY: 0.88, grip: 1.0, mount: [0, 0, Math.PI], body: [0.04, 0, 0],
      neck: [2.214, 0, 0], head: [-1.894, 0.20, 0] };
    var C = { mountY: BODY_Y, grip: 0.34, mount: [0, 0, 0], body: [-0.14, 0, 0],
      neck: [1.180, 0, 0], head: [-1.020, 0.10, Math.PI] };
    var FWD = [-0.26, -0.26, 0.24, 0.24];       /* 前肢は前へ・後肢は後ろへ */
    for (var i = 0; i < 4; i++) {
      var sx = (i % 2 === 0) ? 1 : -1;
      /* 肢は「外へ・面から離れる向きへ」一度立ち上げてから折り返す＝関節の瘤が
         胴より高く（天井形態では低く）突き出る多関節のシルエットになる。 */
      S['L' + i + 'a'] = [FWD[i] * 0.8, 0, sx * 1.85];
      S['L' + i + 'b'] = [0, 0, -sx * 2.30];
      S['L' + i + 'c'] = [0, 0, sx * 0.65];
      S['L' + i + 'd'] = [0, 0, -sx * 0.20];
      C['L' + i + 'a'] = [FWD[i], 0, sx * 1.95];
      C['L' + i + 'b'] = [0, 0, -sx * 2.45];
      C['L' + i + 'c'] = [0, 0, sx * 0.60];
      C['L' + i + 'd'] = [0, 0, -sx * 0.20];
    }
    this.POSE_STAND = S;
    this.POSE_CRAWL = C;
  };

  D.prototype._applyScalars = function (p) {
    var n = this.nodes;
    if (n.mount) n.mount.position.y = p.mountY;
    var g = p.grip, i;
    for (i = 0; i < this.fingers.length; i++) {
      var f = this.fingers[i];
      if (f.axis === 'x') f.n.rotation.x = f.bx * g;
      else f.n.rotation.x = f.base * g;
    }
  };

  /** 天井高に応じて張り付く高さを決める（幹線＝天井／支線＝壁の上部） */
  D.prototype.applyPose = function (u, extra) {
    var ceil = this.ceilH || 2.4;
    this.POSE_STAND.mountY = (ceil >= LOW_CEIL) ? (ceil - 0.86) : WALL_Y;
    A2.Base.prototype.applyPose.call(this, u, extra);
    this._snapSurface();
  };

  /** 面に吸い付かせる: 床形態は最下点を床へ、天井形態は最上点を天井へ */
  D.prototype._snapSurface = function () {
    if (!this.contacts.length || this._cineDrop > 0) return;
    var pt = this.poseT, v = this._tmp, i, w;
    if (pt > 0.92) {                             /* 床形態: 最下点を床へ */
      var lowest = Infinity;
      for (i = 0; i < this.contacts.length; i++) { this.contacts[i].getWorldPosition(v); if (v.y < lowest) lowest = v.y; }
      if (!isFinite(lowest)) return;
      w = this.floorY - lowest;
    } else if (pt < 0.08) {                      /* 天井形態: 最上点を天井へ */
      var ceil = this.ceilH || 2.4;
      if (ceil < LOW_CEIL) return;              /* 支線は壁の上部なので天井合わせをしない */
      var high = -Infinity;
      for (i = 0; i < this.contacts.length; i++) { this.contacts[i].getWorldPosition(v); if (v.y > high) high = v.y; }
      if (!isFinite(high)) return;
      w = (this.floorY + ceil - 0.02) - high;
    } else return;                               /* 遷移中（落下）は吸い付かせない */
    if (Math.abs(w) > 1e-4) { this.group.position.y += w; this.group.updateMatrixWorld(true); }
  };

  /* 落下の時間曲線: 手を離す→加速して落ちる→着地で潰れる（契約 1.2 秒） */
  D.prototype.transEase = function (u) {
    if (u < 0.20) return 0.05 * (u / 0.20);
    var t = (u - 0.20) / 0.80;
    var e = 0.05 + 0.95 * Math.pow(t, 1.75);
    if (t > 0.84) e += 0.055 * Math.sin((t - 0.84) / 0.16 * Math.PI);
    return clamp(e, 0, 1.06);
  };

  /* ---------------- アニメーション ---------------- */
  D.prototype._animate = function (p, u, t, st, inTrans, raw) {
    var i, sx, ph, s, cyc, amp;
    if (st === 'walk' || (inTrans && this.transDir > 0 && raw < 0.3)) {
      /* 天井を這う: 対角の肢が交互に離れて前へ運ばれる（遅く・粘る） */
      cyc = 2.55; amp = 1.0;
    } else if (st === 'chase') {
      cyc = 0.44; amp = 1.0;
    } else { cyc = 0; amp = 0; }
    if (cyc > 0) {
      var base = (t % cyc) / cyc * Math.PI * 2;
      for (i = 0; i < 4; i++) {
        sx = (i % 2 === 0) ? 1 : -1;
        ph = base + ((i === 0 || i === 3) ? 0 : Math.PI);
        s = Math.sin(ph);
        var lift = Math.max(0, s);
        p['L' + i + 'a'][0] += s * (st === 'chase' ? 0.46 : 0.30) * amp;
        p['L' + i + 'a'][2] += sx * lift * 0.22 * amp;
        p['L' + i + 'b'][2] += -sx * lift * 0.40 * amp;
        p['L' + i + 'c'][2] += sx * lift * 0.30 * amp;
      }
      p.body[0] += 0.045 * Math.sin(base * 2) * amp;
      p.body[1] += 0.055 * Math.sin(base) * amp;
      p.mountY += (st === 'chase' ? 0.055 : 0.022) * Math.abs(Math.sin(base)) * amp;
      /* 首と頭: 疾走中は正面を睨んで揺れない（不気味）。這いは緩く振れる */
      if (st === 'chase') { p.neck[0] += 0.05 * Math.sin(base * 2); p.head[1] += 0.06 * Math.sin(base); }
      else { p.neck[0] += 0.10 * Math.sin(base * 0.5); p.head[2] += 0.07 * Math.sin(base); }
    }
    /* ぎこちない引き攣り（等速で動かない） */
    var tw = Math.max(0, Math.sin(t * 0.83) - 0.94) * 16;
    p.head[1] += tw * 0.22; p.head[0] += tw * 0.12;

    if (inTrans && this.transDir > 0) {
      /* 落下: 手が先に離れ（grip が落ちる）、逆さの顔が先に落ちて体が遅れて回り込む */
      var rel = clamp(raw / 0.22, 0, 1);
      p.grip = Math.min(p.grip, 1 - rel);
      var lead = Math.sin(Math.min(1, raw * 1.5) * Math.PI);
      p.neck[0] += lead * 0.55 * (this.poseT < 0.5 ? 1 : -1);
      for (i = 0; i < 4; i++) {
        sx = (i % 2 === 0) ? 1 : -1;
        p['L' + i + 'a'][2] += sx * lead * 0.55;   /* 肢が空を掻く */
        p['L' + i + 'a'][0] += lead * 0.35 * ((i < 2) ? -1 : 1);
        p['L' + i + 'b'][2] += -sx * lead * 0.30;
      }
      if (raw > 0.86) {                            /* 着地の潰れ */
        var sq = Math.sin((raw - 0.86) / 0.14 * Math.PI);
        p.mountY -= sq * 0.11;
        p.body[0] += sq * 0.22;
      }
    }
    /* 捕獲演出（契約「D は逆さの顔が上から降りてくる」）:
       胴は天井へ張り付いたまま頭上に覆いかぶさり、首を伸ばして逆さの顔だけを
       目の高さへ降ろす。capture.js は nodes.head の実位置へ寄るのでこれで画になる。 */
    if (this._cineDrop > 0) {
      var cd = this._cineDrop;
      p.mountY = p.mountY * (1 - cd) + 2.22 * cd;
      p.neck[0] = p.neck[0] * (1 - cd) + 2.62 * cd;
      p.head[0] = p.head[0] * (1 - cd) + (-2.30) * cd;
      p.head[1] = p.head[1] * (1 - cd) + 0.10 * cd;
      p.body[0] = p.body[0] * (1 - cd) + 0.22 * cd;
    }
    this.groundSnap = false;
  };

  /** 髪の二次揺れ（垂れる方向は形態で変わるので world の重力では見ない） */
  D.prototype._secondary = function (t, dt, st) {
    var k = (st === 'chase') ? 1.9 : 0.8;
    for (var i = 0; i < this.hair.length; i++) {
      var h = this.hair[i];
      h.n.rotation.x = Math.sin(t * (1.6 + h.k) + h.p) * 0.19 * k;
      h.n.rotation.z = Math.cos(t * (1.1 + h.k * 0.7) + h.p) * 0.15 * k;
    }
  };

  /* ---------------- 捕獲演出（顔アップ） ----------------
   * 契約: D は「逆さの顔が上から降りてくる」。setDetail('hi') で首を伸ばして
   * 顔を目の高さまで降ろし、眼窩の奥にだけ微光を灯す（眼球のハイライトは作らない）。 */
  D.prototype._makeEyes = function () {
    var s = this.sockets || [[0.05, 0.034, -0.09], [-0.05, 0.030, -0.09]];
    return this._buildSocketGlow(this.nodes.head, [
      { p: s[0], r: 0.0135, k: 1.00, f1: 2.27, f2: 1.03, ph: 0.0 },
      { p: s[1], r: 0.0112, k: 0.78, f1: 3.19, f2: 0.67, ph: 1.9 }
    ]);
  };

  D.prototype._onDetail = function (level) {
    this._cineDrop = (level === 'hi') ? 1 : 0;
  };

  /** 首を掴む手（camera 空間・-Z が前方）。D は天井から落ちてくるので上から入る。 */
  D.prototype._makeGrabHands = function () {
    var M = this.mats, self = this;
    var root = new THREE.Group();
    root.name = 'grab-hands-D';
    function digit(parent, px, py, pz, rz, len, r0) {
      var cur = new THREE.Group();
      cur.position.set(px, py, pz);
      cur.rotation.order = 'ZXY';
      cur.rotation.z = rz;
      parent.add(cur);
      for (var j = 0; j < 3; j++) {
        var nd = new THREE.Group();
        nd.rotation.x = -(0.85 + j * 0.62);      /* 深く握り込む */
        cur.add(nd);
        var l2 = len * (1 - j * 0.17);
        self._mesh(limbSeg(r0 - j * 0.0028, r0 * 0.86 - j * 0.0028, l2, 6), M.skin, nd, 'gPhal');
        self._mesh(ell(r0 * 1.16, r0 * 1.02, r0 * 1.10, 6), M.skin, nd, 'gKnuckle');
        var nx = new THREE.Group(); nx.position.set(0, -l2, 0); nd.add(nx);
        if (j === 2) self._mesh(ell(r0 * 0.52, r0 * 1.10, r0 * 0.44, 6), M.nail, nx, 'gNail');
        cur = nx;
      }
    }
    function arm(sx) {
      var a = new THREE.Group();
      a.name = sx > 0 ? 'grabHandR' : 'grabHandL';
      root.add(a);
      /* 前腕は画面の上隅から降りてくる（多関節の細長い腕） */
      var fore = new THREE.Group();
      fore.position.set(sx * 0.46, 0.78, -0.86);
      fore.rotation.set(-0.55, 0, sx * 0.62);
      a.add(fore);
      self._mesh(limbSeg(0.062, 0.042, 0.95, 8), M.skin, fore, 'gForearm');
      self._mesh(tube([[0, -0.10, 0.030], [0, -0.70, 0.026]], 0.008, 4, false, 1.2), M.sinew, fore, 'gTendon');
      var wr = new THREE.Group();
      wr.position.set(sx * 0.185, -0.235, -0.470);
      wr.rotation.set(0.42, 0, -sx * 0.55);
      a.add(wr);
      self._mesh(ell(0.062, 0.024, 0.070, 10), M.skin, wr, 'gPalm');
      for (var f = 0; f < 4; f++) {
        digit(wr, (f - 1.5) * 0.034 * -sx, -0.016, -0.052, (f - 1.5) * 0.14, 0.086, 0.0155);
      }
      digit(wr, sx * 0.050, -0.010, 0.022, -sx * 1.12, 0.072, 0.0170);
    }
    arm(-1); arm(1);
    return root;
  };

  /** 「食われる」用の縦に裂けた口。半幅 1.0 の単位系で camera 空間に置く */
  D.prototype._makeMaw = function () {
    var M = this.mats, self = this;
    var root = new THREE.Group();
    root.name = 'maw-D';
    /* 喉の闇（奥へすぼまる袋） */
    var gul = ell(1.24, 1.55, 1.70, 14, 10);
    deform(gul, function (x, y, z, o) {
      var t = clamp((z + 1.70) / 3.40, 0, 1);
      o[0] = x * (0.22 + 0.78 * t); o[1] = y * (0.30 + 0.70 * t); o[2] = z;
    });
    this._mesh(gul, M.void, root, 'gullet').position.set(0, 0, 1.05);
    /* 左右の裂けた縁（縦の顎）。奥（+Z）を蝶番に開く */
    var halves = [];
    [1, -1].forEach(function (s) {
      var hinge = new THREE.Group();
      root.add(hinge);
      var g = new THREE.Group();
      g.position.set(0, 0, -1.10);
      hinge.add(g);
      /* 唇の断面（捲れた組織）と歯茎の畝 */
      var edge = [], gum = [], q, t2, yy, ww;
      for (q = 0; q <= 10; q++) {
        t2 = q / 10; yy = 1.45 - 2.90 * t2;
        ww = 0.30 * Math.sin(Math.PI * Math.pow(t2, 0.7)) + 0.06 + ((q % 3) - 1) * 0.02;
        edge.push([s * ww, yy, 0]);
        gum.push([s * ww * 0.55, yy, 0.30]);
      }
      self._mesh(A2.strip(edge, gum), M.flesh, g, 'mawCut');
      self._mesh(tube(edge, 0.055, 5, false, 1.3), M.lip, g, 'mawLip');
      self._mesh(tube(gum, 0.062, 5, false, 1.3), M.gum, g, 'mawGum');
      var R2 = rng(s > 0 ? 4801 : 9109);
      for (var n = 0; n <= 12; n++) {
        if (R2() < 0.12) continue;
        var t3 = n / 12, y2 = 1.42 - 2.84 * t3;
        var w2 = (0.30 * Math.sin(Math.PI * Math.pow(t3, 0.7)) + 0.06) * 0.72;
        var hh = 0.10 + R2() * 0.30, cw = 0.045 + R2() * 0.048;
        var cone = new THREE.ConeGeometry(cw, hh, 5);
        cone.translate(0, -hh / 2, 0);
        var tm = self._mesh(cone, M.tooth, g, 'mawTooth');
        tm.position.set(s * w2, y2, 0.16 + (R2() - 0.5) * 0.06);
        tm.rotation.order = 'ZXY';
        tm.rotation.z = s * (1.40 + (R2() - 0.5) * 0.55);
        tm.rotation.x = (R2() - 0.5) * 0.5;
      }
      halves.push(hinge);
    });
    var maw = {
      group: root,
      setOpen: function (u) {
        halves[0].rotation.y = -(0.06 + 0.62 * u);
        halves[1].rotation.y = (0.06 + 0.62 * u);
        halves[0].position.x = 0.04 + 0.30 * u;
        halves[1].position.x = -(0.04 + 0.30 * u);
      }
    };
    maw.setOpen(0);
    return maw;
  };

  D.prototype.topHeight = function () { return 0; };   /* 天井へ張り付くので体格の縮小はしない */

  ESCAPE.EnemyModelsA2 = ESCAPE.EnemyModelsA2 || {};
  ESCAPE.EnemyModelsA2.D = D;
})(window);
