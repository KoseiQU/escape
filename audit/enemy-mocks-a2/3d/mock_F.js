/* ESCAPE — P5e-0 案F「寄り集まった亡骸」3Dコンセプトモック（レーンB）
 *
 * 旧坑の複数の骸が癒合した性別不明の個体。
 *  - 腕脚7本（長さ・太さ・向きがばらばら。癒合部は皮膚が引きつって襞になる）
 *  - 頭蓋3つ（1つだけ正面を向く／2つは肉に半分埋没）
 *  - 体は骨と皮だけ。肋骨・鎖骨・椎骨・骨盤が皮膚を押し上げて浮く
 *  - 壁の隅を這って来る姿勢（右手と左の長腕が壁を掴み、天井へ1本伸ばす）
 *
 * 構法（DESIGN.md §4 P5e）: 顔はジオメトリで彫る。眼窩は実際の空洞（内向きの円錐）、
 * 鼻腔も空洞、上顎/下顎は別パーツ、歯は1本ずつ。眼球とハイライトは無し。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var M = ESCAPE.__A2MOCKS = ESCAPE.__A2MOCKS || {};

  /* ---------------- 決定的乱数 ---------------- */
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

  /* ---------------- 皮膚・骨のプロシージャル質感 ---------------- */
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
  /* 屍蝋のような灰緑〜黄土の斑と、乾いた血の滲み */
  function skinCanvas() {
    return canvasOf(256, function (x, y, d, i) {
      var n = fbm(x / 22, y / 22, 5), m = fbm(x / 7 + 31, y / 7, 4), v = fbm(x / 60 + 5, y / 60, 3);
      var base = 88 + n * 74 - m * 34;
      var yellow = Math.max(0, v - 0.5) * 1.8;          /* 黄土の斑 */
      var bruise = Math.max(0, fbm(x / 44 + 77, y / 44, 3) - 0.58) * 2.4;
      var r = base * (1 + yellow * 0.16) * (1 - bruise * 0.30);
      var g = base * (1 + yellow * 0.10) * (1 - bruise * 0.44);
      var b = base * (1 - yellow * 0.34) * (1 - bruise * 0.20);
      d[i] = Math.min(255, r); d[i + 1] = Math.min(255, g * 0.95); d[i + 2] = Math.min(255, b * 0.84); d[i + 3] = 255;
    });
  }
  function skinBump() {
    return canvasOf(256, function (x, y, d, i) {
      var pore = fbm(x / 3.1, y / 3.1, 3), wr = fbm(x / 16 + 13, y / 16, 4);
      var v = 128 + (pore - 0.5) * 96 + (wr - 0.5) * 74;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v)); d[i + 3] = 255;
    });
  }
  function skinRough() {
    return canvasOf(128, function (x, y, d, i) {
      var w = fbm(x / 11, y / 11, 4);                    /* 濡れた斑＝粗さが落ちる */
      var v = 255 * (0.88 - Math.max(0, w - 0.45) * 0.85);
      d[i] = 255; d[i + 1] = Math.max(24, Math.min(255, v)); d[i + 2] = 255; d[i + 3] = 255;
    });
  }
  function boneCanvas() {
    return canvasOf(128, function (x, y, d, i) {
      var n = fbm(x / 9, y / 9, 4), s = fbm(x / 30 + 41, y / 30, 3);
      var v = 128 + n * 58 - Math.max(0, s - 0.52) * 120;
      d[i] = Math.min(255, v * 1.02); d[i + 1] = Math.min(255, v * 0.97); d[i + 2] = Math.min(255, v * 0.80); d[i + 3] = 255;
    });
  }

  var MAT = null;
  function mats(THREE) {
    if (MAT) return MAT;
    var sk = texFrom(THREE, skinCanvas(), [2, 2], true);
    var sb = texFrom(THREE, skinBump(), [2, 2], false);
    var sr = texFrom(THREE, skinRough(), [2, 2], false);
    var bn = texFrom(THREE, boneCanvas(), [1.4, 1.4], true);
    MAT = {
      skin: new THREE.MeshStandardMaterial({
        map: sk, bumpMap: sb, bumpScale: 0.030, roughnessMap: sr,
        color: 0x7b7562, roughness: 0.80, metalness: 0.0
      }),
      skinDark: new THREE.MeshStandardMaterial({
        map: sk, bumpMap: sb, bumpScale: 0.034, roughnessMap: sr,
        color: 0x524d3e, roughness: 0.84, metalness: 0.0
      }),
      bone: new THREE.MeshStandardMaterial({
        map: bn, bumpMap: sb, bumpScale: 0.022,
        color: 0x8e8869, roughness: 0.62, metalness: 0.0
      }),
      boneDim: new THREE.MeshStandardMaterial({ map: bn, bumpMap: sb, bumpScale: 0.018, color: 0x6e6a56, roughness: 0.78 }),
      tooth: new THREE.MeshStandardMaterial({ color: 0x9c9679, roughness: 0.42 }),
      void: new THREE.MeshBasicMaterial({ color: 0x050604, side: THREE.DoubleSide }),
      vein: new THREE.MeshStandardMaterial({ color: 0x4a3a3c, roughness: 0.55 }),
      sinew: new THREE.MeshStandardMaterial({ color: 0x8f7f62, roughness: 0.5 })
    };
    return MAT;
  }

  /* ---------------- 形の道具 ---------------- */
  function mesh(THREE, geo, mat, px, py, pz) {
    var m = new THREE.Mesh(geo, mat);
    if (px !== undefined) m.position.set(px, py, pz);
    return m;
  }
  /* 先細りの節（長さ L・根太さ r0・先太さ r1）。from→to を結ぶ */
  function boneSeg(THREE, mat, from, to, r0, r1, seg) {
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var g = new THREE.CylinderGeometry(r1, r0, L, seg || 7, 1, false);
    var m = new THREE.Mesh(g, mat);
    m.position.set(from[0] + dx / 2, from[1] + dy / 2, from[2] + dz / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    m.userData.len = L;
    return m;
  }
  function joint(THREE, mat, p, r, sx, sy, sz) {
    var m = mesh(THREE, new THREE.SphereGeometry(r, 8, 6), mat, p[0], p[1], p[2]);
    m.scale.set(sx || 1, sy || 1, sz || 1);
    return m;
  }

  global.__A2_F_UTIL = { rngOf: rngOf, fbm: fbm, mats: mats, mesh: mesh, boneSeg: boneSeg, joint: joint };
})(typeof window !== 'undefined' ? window : this);

/* ================= 頭蓋（ジオメトリで彫る） ================= */
(function (global) {
  'use strict';
  var U = global.__A2_F_UTIL;

  /** 頭蓋1つ。原点＝脳頭蓋の中心、正面 −Z。opt: {seed, jaw, teeth, gape, crack} */
  global.__A2_F_SKULL = function (THREE, opt) {
    opt = opt || {};
    var P = U.mats(THREE), rnd = U.rngOf(opt.seed || 3);
    var g = new THREE.Group();
    var RX = 0.072, RY = 0.092, RZ = 0.095;
    var add = function (m) { g.add(m); return m; };

    /* 1) 脳頭蓋（額から上だけの殻。顔面は開けておく） */
    var cal = U.mesh(THREE, new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.44), P.bone);
    cal.scale.set(RX, RY, RZ * 1.02); cal.position.z = 0.006; add(cal);
    /* 2) 頭蓋底＋後頭（後ろ半分だけ） */
    var base = U.mesh(THREE, new THREE.SphereGeometry(1, 14, 10, 0, Math.PI, Math.PI * 0.40, Math.PI * 0.60), P.bone);
    base.scale.set(RX * 1.0, RY * 0.99, RZ * 1.02); base.position.z = 0.006; add(base);
    /* 3) 側頭（こめかみの窪んだ板。左右で高さを変える） */
    [[1, 1.0], [-1, 0.93]].forEach(function (s) {
      var t = U.joint(THREE, P.boneDim, [s[0] * RX * 0.80, RY * 0.05 * s[1], RZ * 0.02], 0.040, 0.42, 1.25, 1.30);
      add(t);
    });
    /* 4) 縫合線（冠状・矢状） */
    var cor = U.mesh(THREE, new THREE.TorusGeometry(RY * 0.97, 0.0024, 4, 20, Math.PI), P.boneDim, 0, 0.004, 0.002);
    cor.rotation.y = Math.PI / 2; add(cor);
    var sag = U.mesh(THREE, new THREE.TorusGeometry(RY * 0.96, 0.0022, 4, 16, Math.PI * 0.7), P.boneDim, 0, 0.002, 0.012);
    sag.rotation.z = Math.PI * 0.12; add(sag);

    /* ---- 顔面（FZ＝顔の前面。脳頭蓋の前縁とほぼ揃える） ---- */
    var FZ = -0.086;
    /* 5) 眼窩（実際の空洞: 内向きの円錐）＋ 6) 眼窩縁 ＋ 7) 眉弓 */
    var SOCK = [
      { x: 0.0340, y: 0.0125, r: 0.0298, d: 0.052, t: -0.13 },
      { x: -0.0325, y: 0.0070, r: 0.0268, d: 0.047, t: 0.17 }   /* 左右非対称 */
    ];
    SOCK.forEach(function (s) {
      var cav = U.mesh(THREE, new THREE.ConeGeometry(s.r, s.d, 12, 1, false), P.void,
        s.x, s.y, FZ + s.d / 2);
      cav.rotation.x = Math.PI / 2; cav.rotation.z = s.t; add(cav);
      var rim = U.mesh(THREE, new THREE.TorusGeometry(s.r * 1.02, 0.0072, 5, 14), P.bone, s.x, s.y, FZ - 0.002);
      rim.scale.set(1.06, 0.92, 1.1); rim.rotation.z = s.t * 0.6; add(rim);
      var brow = U.mesh(THREE, new THREE.TorusGeometry(s.r * 1.12, 0.0102, 5, 12, Math.PI * 0.88), P.bone,
        s.x, s.y + 0.007, FZ + 0.010);
      brow.rotation.z = 0.24 + s.t; brow.scale.set(1, 0.70, 1.4); add(brow);
    });
    /* 8) 前頭（眉弓の上から額へ繋ぐ板） */
    var fore = U.joint(THREE, P.bone, [0.001, 0.047, FZ + 0.020], 0.047, 1.26, 0.80, 0.32); add(fore);
    /* 9) 鼻腔（空洞）＋ 10) 鼻骨 */
    var nas = U.mesh(THREE, new THREE.ConeGeometry(0.0160, 0.038, 9, 1, false), P.void,
      0.0015, -0.027, FZ + 0.022);
    nas.rotation.x = Math.PI / 2; nas.scale.set(1, 1, 1.45); add(nas);
    [[-1, 0.0], [1, 0.004]].forEach(function (s) {
      add(U.boneSeg(THREE, P.bone, [s[0] * 0.004, 0.011, FZ + 0.004], [s[0] * 0.011, -0.016, FZ + 0.002 + s[1]], 0.0072, 0.005, 5));
    });
    /* 11) 頬骨 ＋ 12) 頬骨弓（眼窩の外下からこめかみへ） */
    [[1, 1.0], [-1, 0.92]].forEach(function (s) {
      add(U.joint(THREE, P.bone, [s[0] * 0.0495, -0.0225 * s[1], FZ + 0.016], 0.0168, 1.12, 0.82, 0.95));
      add(U.boneSeg(THREE, P.bone, [s[0] * 0.0540, -0.019, FZ + 0.026], [s[0] * 0.0640, 0.004, RZ * 0.28], 0.0080, 0.0056, 6));
    });
    /* 12) 上顎（歯列弓）＋ 13) 口蓋 ＋ 14) 上の歯（1本ずつ） */
    var MY = -0.056;
    var mx = U.mesh(THREE, new THREE.TorusGeometry(0.0405, 0.0145, 6, 16, Math.PI * 1.08), P.bone, 0.001, MY, -0.018);
    mx.rotation.x = -Math.PI / 2; mx.scale.set(1, 1.18, 1); add(mx);
    var pal = U.joint(THREE, P.boneDim, [0.001, MY - 0.004, -0.016], 0.034, 1.02, 0.30, 1.20); add(pal);
    function teethRow(y, rad, n, mat, sgn, seed) {
      var r2 = U.rngOf(seed);
      for (var i = 0; i < n; i++) {
        var a = Math.PI * (0.055 + 0.89 * (i / (n - 1)));
        if (i === 2 || i === n - 4) continue;                       /* 欠損 */
        var h = (0.016 + r2() * 0.011) * (i > 2 && i < n - 3 ? 1.0 : 0.82);
        var w = 0.0052 + r2() * 0.0028;
        var t = U.mesh(THREE, new THREE.CylinderGeometry(w * 0.55, w, h, 5), mat,
          Math.cos(a) * rad, y + sgn * h * 0.5, -Math.sin(a) * rad * 1.18 - 0.018);
        t.rotation.y = -a; t.rotation.x = sgn * (0.10 + r2() * 0.22) * (i % 2 ? 1 : -1);
        t.rotation.z = (r2() - 0.5) * 0.30;
        add(t);
      }
    }
    teethRow(MY - 0.010, 0.0395, 11, P.tooth, -1, 11);

    /* 15) 下顎（体部＋左右の枝）＋ 16) 下の歯 */
    if (opt.jaw !== false) {
      var gp = opt.gape === undefined ? 0.22 : opt.gape;
      var jw = new THREE.Group(); jw.position.set(0, MY - 0.012, -0.030); jw.rotation.x = gp;
      var mb = U.mesh(THREE, new THREE.TorusGeometry(0.0385, 0.0125, 6, 16, Math.PI * 1.04), P.bone, 0, -0.012, 0.004);
      mb.rotation.x = -Math.PI / 2; mb.scale.set(1, 1.06, 1); jw.add(mb);
      [[1, 1], [-1, 0.94]].forEach(function (s) {
        var r = U.boneSeg(THREE, P.bone, [s[0] * 0.0375, -0.012, 0.032], [s[0] * 0.050 * s[1], 0.040, 0.062], 0.011, 0.0085, 6);
        jw.add(r);
      });
      var jchin = U.joint(THREE, P.bone, [0.002, -0.021, -0.052], 0.015, 1.30, 0.78, 0.62); jw.add(jchin);
      var sub = new THREE.Group();
      jw.add(sub);
      var saveAdd = add;
      add = function (m) { jw.add(m); return m; };
      teethRow(-0.020, 0.0375, 10, P.tooth, 1, 29);
      add = saveAdd;
      g.add(jw);
      g.userData.jaw = jw;
    }
    /* 17) 頸椎の上端（後頭顆から2つ） */
    for (var v = 0; v < 2; v++) {
      var vt = U.joint(THREE, P.boneDim, [0.002 * v, -RY * 0.80 - v * 0.026, RZ * 0.46 + v * 0.010], 0.0155, 1.25, 0.62, 1.0);
      add(vt);
    }
    /* 18) 亀裂（癒合した骸なので頭蓋も割れている） */
    if (opt.crack) {
      for (var c = 0; c < 3; c++) {
        var a0 = -0.5 + rnd() * 1.0;
        var cr = U.mesh(THREE, new THREE.BoxGeometry(0.0028, 0.045 + rnd() * 0.04, 0.0022), P.void,
          Math.sin(a0) * RX * 0.74, RY * (0.30 + rnd() * 0.4), -Math.cos(a0) * RZ * 0.66);
        cr.rotation.set(0.2 * rnd(), a0, (rnd() - 0.5) * 0.9); add(cr);
      }
    }
    return g;
  };
})(typeof window !== 'undefined' ? window : this);

/* ================= 胴・四肢・組み立て ================= */
(function (global) {
  'use strict';
  var U = global.__A2_F_UTIL;

  function V(THREE, a) { return new THREE.Vector3(a[0], a[1], a[2]); }

  /* 癒合部: 引きつった皮膚の襟（円錐）＋放射状の襞 */
  function seam(THREE, P, g, p, dir, r, seed) {
    var rnd = U.rngOf(seed);
    var c = U.mesh(THREE, new THREE.ConeGeometry(r * 1.9, r * 2.4, 9, 1, true), P.skinDark, p[0], p[1], p[2]);
    c.material = P.skinDark;
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), V(THREE, dir).normalize());
    g.add(c);
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * Math.PI * 2 + rnd();
      var f = U.mesh(THREE, new THREE.CylinderGeometry(r * 0.05, r * 0.13, r * (0.9 + rnd() * 0.7), 5), P.skinDark,
        p[0] + Math.cos(a) * r * 1.25, p[1] + (rnd() - 0.5) * r * 0.8, p[2] + Math.sin(a) * r * 1.25);
      f.rotation.set(Math.PI / 2 + (rnd() - 0.5) * 0.6, a, (rnd() - 0.5) * 0.6); g.add(f);
    }
  }

  /* 四肢1本。pts=[root,mid,tip] ＋ 手/足（指つき） */
  function limb(THREE, P, g, o) {
    var K = 0.94;                                   /* 骨と皮だけ＝痩せ細らせる */
    var r0 = o.r0 * K, r1 = o.r1 * K, r2 = o.r2 * K;
    g.add(U.boneSeg(THREE, P.skin, o.a, o.b, r0, r1, 8));
    g.add(U.boneSeg(THREE, P.skin, o.b, o.c, r1, r2, 8));
    g.add(U.joint(THREE, P.skin, o.a, r0 * 1.22, 1, 1, 1));
    var kn = U.joint(THREE, P.skin, o.b, r1 * 1.42, 1.05, 0.92, 1.1); g.add(kn);   /* 関節の節くれ */
    g.add(U.joint(THREE, P.skinDark, o.b, r1 * 1.05, 1.5, 0.5, 1.5));             /* 関節のしわ */
    /* 腱（関節をまたぐ細い筋） */
    var mid = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2, (o.a[2] + o.b[2]) / 2];
    g.add(U.boneSeg(THREE, P.sinew, mid, o.c, r1 * 0.16, r2 * 0.20, 5));
    /* 手（または足） */
    var d = [o.c[0] - o.b[0], o.c[1] - o.b[1], o.c[2] - o.b[2]];
    var L = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    d = [d[0] / L, d[1] / L, d[2] / L];
    var palm = U.joint(THREE, P.skin, o.c, r2 * (o.foot ? 1.9 : 1.5),
      o.foot ? 1.2 : 1.35, o.foot ? 0.55 : 0.62, o.foot ? 1.9 : 1.25);
    palm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), V(THREE, d));
    g.add(palm);
    var n = o.foot ? 4 : 5, rnd = U.rngOf(o.seed || 5);
    if (o.foot) palm.scale.set(1.45, 0.38, 2.15);
    var up = new THREE.Vector3(0, 1, 0);
    var dv = V(THREE, d), side = new THREE.Vector3().crossVectors(dv, up).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    var fwd = new THREE.Vector3().crossVectors(side, dv).normalize();
    if (o.foot) {                                    /* 足指は「前（−Z）」へ並べる */
      fwd = new THREE.Vector3(0, 0, -1).addScaledVector(dv, dv.z).normalize();
      side = new THREE.Vector3().crossVectors(dv, fwd).normalize();
    }
    for (var i = 0; i < n; i++) {
      var t = (i / (n - 1) - 0.5) * 2;
      var fl = (o.foot ? 0.052 : 0.105) * (1 - Math.abs(t) * 0.28) * (0.8 + rnd() * 0.5);
      var adv = o.foot ? fwd : dv;
      var base = new THREE.Vector3(o.c[0], o.c[1], o.c[2])
        .addScaledVector(side, t * r2 * (o.foot ? 1.05 : 1.25))
        .addScaledVector(adv, r2 * (o.foot ? 1.9 : 0.8))
        .addScaledVector(dv, o.foot ? r2 * 0.45 : 0);
      var knu = base.clone().addScaledVector(adv, fl * 0.55).addScaledVector(o.foot ? dv : fwd, (rnd() - 0.3) * fl * 0.4);
      var tip = knu.clone().addScaledVector(adv, fl * 0.62).addScaledVector(o.foot ? dv : fwd, (o.curl || 0.45) * fl * (o.foot ? 0.3 : 1));
      g.add(U.boneSeg(THREE, P.skin, base.toArray(), knu.toArray(), r2 * 0.34, r2 * 0.27, 5));
      g.add(U.boneSeg(THREE, P.skin, knu.toArray(), tip.toArray(), r2 * 0.27, r2 * 0.15, 5));
      if (!o.foot) g.add(U.joint(THREE, P.skin, knu.toArray(), r2 * 0.30, 1, 1, 1));            /* 指の節 */
      if (!o.foot) g.add(U.joint(THREE, P.bone, tip.toArray(), r2 * 0.16, 0.8, 0.8, 1.6)); /* 爪 */
    }
    seam(THREE, P, g, o.a, [o.b[0] - o.a[0], o.b[1] - o.a[1], o.b[2] - o.a[2]], r0, (o.seed || 5) * 3);
  }

  /* 血管（皮膚の上を這う細い管） */
  function veins(THREE, P, g, p, n, len, seed) {
    var rnd = U.rngOf(seed);
    for (var i = 0; i < n; i++) {
      var a = rnd() * Math.PI * 2, b = rnd() * Math.PI;
      var v = U.mesh(THREE, new THREE.TorusGeometry(len * (0.5 + rnd() * 0.6), 0.0042, 4, 10, Math.PI * (0.4 + rnd() * 0.7)), P.vein,
        p[0] + (rnd() - 0.5) * len, p[1] + (rnd() - 0.5) * len, p[2] + (rnd() - 0.5) * len);
      v.rotation.set(a, b, rnd() * 3); g.add(v);
    }
  }

  global.__A2_F_PARTS = { seam: seam, limb: limb, veins: veins, V: V };
})(typeof window !== 'undefined' ? window : this);

/* ================= 人体の胴（肋骨・鎖骨・胸骨・骨盤） ================= */
(function (global) {
  'use strict';
  var U = global.__A2_F_UTIL, Q = global.__A2_F_PARTS;

  /** 痩せ切った胴。o={hip:[..], sho:[..], w, ribs, seed, pelvis:bool, dark:bool} */
  global.__A2_F_TORSO = function (THREE, g, o) {
    var P = U.mats(THREE), rnd = U.rngOf(o.seed || 3);
    var skin = o.dark ? P.skinDark : P.skin;
    var hip = Q.V(THREE, o.hip), sho = Q.V(THREE, o.sho);
    var axis = sho.clone().sub(hip), L = axis.length(); axis.normalize();
    var W = o.w || 0.150, N = o.ribs === undefined ? 9 : o.ribs;
    /* 体幹の肉（腰は細く胸は広い） */
    for (var i = 0; i <= 8; i++) {
      var t = i / 8 * 0.94, p = hip.clone().addScaledVector(axis, L * t);
      var k = 0.70 + 0.34 * Math.pow(t, 1.6) - 0.20 * Math.max(0, 0.55 - Math.abs(t - 0.30));
      k *= 1 - 0.42 * Math.max(0, t - 0.72) / 0.28;          /* 首元へ向けて窄める */
      var seg = U.joint(THREE, skin, p.toArray(), W * k, 1.0, 0.90, 0.56);
      g.add(seg);
    }
    /* 肋骨（上ほど広い。前で開いて胸骨に繋がる） */
    var Zv = new THREE.Vector3(0, 0, 1);
    for (var r = 0; r < N; r++) {
      var tt = 0.34 + 0.60 * (r / Math.max(1, N - 1));
      var pp = hip.clone().addScaledVector(axis, L * tt);
      var rr = W * (0.80 + 0.42 * Math.pow(tt, 1.4)) - 0.004 * Math.abs(r - N * 0.6);
      var rib = U.mesh(THREE, new THREE.TorusGeometry(rr, 0.0115, 4, 13, Math.PI * 1.22), skin,
        pp.x, pp.y, pp.z);
      rib.quaternion.setFromUnitVectors(Zv, axis);
      rib.rotateZ(Math.PI * 0.39 + (rnd() - 0.5) * 0.10);
      rib.rotateX(0.16);
      rib.scale.set(1, 1, 0.58); g.add(rib);
      /* 椎骨（背に節が並ぶ） */
      var back = new THREE.Vector3(axis.z, 0, -axis.x); if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
      back.normalize();
      g.add(U.joint(THREE, skin, pp.clone().addScaledVector(back, rr * 0.72).toArray(), 0.021, 0.9, 0.75, 1.2));
    }
    /* 胸骨・鎖骨 */
    var front = new THREE.Vector3(-axis.z, 0, axis.x); if (front.lengthSq() < 1e-4) front.set(0, 0, -1);
    front.normalize();
    var side = new THREE.Vector3().crossVectors(axis, front).normalize();
    var chest = hip.clone().addScaledVector(axis, L * 0.72);
    var stn = U.joint(THREE, skin, chest.clone().addScaledVector(front, W * 0.80).toArray(), 0.042, 0.60, 1.8, 0.26);
    stn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis); g.add(stn);
    [1, -1].forEach(function (sg, k) {
      var a = sho.clone().addScaledVector(front, W * 0.52);
      var b = sho.clone().addScaledVector(side, sg * W * 1.05).addScaledVector(axis, -0.02);
      g.add(U.boneSeg(THREE, P.skin, a.toArray(), b.toArray(), 0.018 - k * 0.002, 0.014, 7));
      g.add(U.joint(THREE, skin, b.toArray(), 0.040, 1.0, 0.85, 1.0));           /* 肩峰 */
    });
    /* 骨盤（腸骨の翼2枚＋恥骨弓） */
    if (o.pelvis !== false) {
      var pl = U.mesh(THREE, new THREE.TorusGeometry(W * 0.72, 0.024, 5, 12, Math.PI * 1.05), skin,
        hip.x, hip.y, hip.z);
      pl.quaternion.setFromUnitVectors(Zv, axis); pl.rotateZ(Math.PI * 0.45); pl.scale.set(1, 1, 0.7);
      g.add(pl);
      [1, -1].forEach(function (sg) {
        var w = U.joint(THREE, skin, hip.clone().addScaledVector(side, sg * W * 0.66).addScaledVector(axis, 0.045).toArray(),
          W * 0.50, 0.42, 1.05, 0.95);
        w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis); g.add(w);
      });
    }
    return { axis: axis, front: front, side: side, L: L };
  };
})(typeof window !== 'undefined' ? window : this);

/* ================= 案F 本体 ================= */
(function (global) {
  'use strict';
  var U = global.__A2_F_UTIL, Q = global.__A2_F_PARTS;
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var M = ESCAPE.__A2MOCKS = ESCAPE.__A2MOCKS || {};

  M.F = {
    name: '案F 寄り集まった亡骸',
    build: function (THREE) {
      var P = U.mats(THREE), g = new THREE.Group();

      /* ---- 1体目（主体）: 直立して壁の隅から出てくる ---- */
      global.__A2_F_TORSO(THREE, g, { hip: [0.30, 0.98, 0.42], sho: [0.36, 1.60, 0.30], w: 0.155, ribs: 9, seed: 7 });
      /* ---- 2体目: 右腰に癒合して斜め上後方へ生えている ---- */
      global.__A2_F_TORSO(THREE, g, { hip: [0.74, 1.04, 0.62], sho: [1.12, 1.34, 0.86], w: 0.125, ribs: 7, seed: 13, dark: true });
      Q.seam(THREE, P, g, [0.60, 1.02, 0.54], [0.8, 0.6, 0.5], 0.105, 101);
      /* ---- 3体目: 左肩に胸郭の断片と頭だけが残る ---- */
      global.__A2_F_TORSO(THREE, g, { hip: [0.10, 1.30, 0.44], sho: [0.02, 1.62, 0.34], w: 0.100, ribs: 5, seed: 23, dark: true, pelvis: false });
      Q.seam(THREE, P, g, [0.16, 1.44, 0.38], [-0.4, 0.8, -0.3], 0.085, 103);
      Q.veins(THREE, P, g, [0.18, 1.46, 0.30], 8, 0.09, 107);
      Q.veins(THREE, P, g, [0.66, 1.10, 0.56], 7, 0.09, 109);

      /* ---- 腕6本（長さ・太さ・向きがばらばら） ---- */
      /* 1 主体の右腕: 天井の梁を掴んで体を引き上げる */
      Q.limb(THREE, P, g, { a: [0.58, 1.58, 0.30], b: [0.94, 2.12, 0.54], c: [1.18, 2.64, 0.44], r0: 0.054, r1: 0.040, r2: 0.031, seed: 3, curl: 0.9 });
      /* 2 主体の左腕: 異様に長く、指先が床に届く */
      Q.limb(THREE, P, g, { a: [0.13, 1.56, 0.30], b: [-0.16, 1.06, 0.04], c: [-0.28, 0.46, -0.16], r0: 0.050, r1: 0.040, r2: 0.032, seed: 11, curl: 0.5 });
      /* 3 こちらへ伸ばす腕（胸の左脇から） */
      Q.limb(THREE, P, g, { a: [0.12, 1.32, 0.28], b: [-0.16, 1.26, -0.10], c: [-0.30, 1.14, -0.48], r0: 0.044, r1: 0.035, r2: 0.027, seed: 17, curl: 1.0 });
      /* 4 萎びた小さい腕（胸の中央） */
      Q.limb(THREE, P, g, { a: [0.42, 1.30, 0.12], b: [0.32, 1.06, -0.08], c: [0.30, 0.90, -0.02], r0: 0.028, r1: 0.021, r2: 0.016, seed: 19, curl: 0.35 });
      /* 5 2体目の腕: 右の壁を掴む（太い） */
      Q.limb(THREE, P, g, { a: [1.14, 1.34, 0.80], b: [1.50, 1.48, 0.52], c: [1.68, 1.26, 0.18], r0: 0.058, r1: 0.046, r2: 0.036, seed: 29, curl: 0.95 });
      /* 6 背から生えた腕（別個体の名残） */
      Q.limb(THREE, P, g, { a: [0.50, 1.22, 0.60], b: [0.76, 1.46, 0.96], c: [0.84, 1.72, 1.06], r0: 0.036, r1: 0.029, r2: 0.023, seed: 31, curl: 1.0 });

      /* ---- 脚4本 ---- */
      /* 主体の両脚（＝原点が足元） */
      Q.limb(THREE, P, g, { a: [0.16, 0.96, 0.40], b: [0.09, 0.52, 0.16], c: [0.07, 0.07, -0.03], r0: 0.072, r1: 0.050, r2: 0.040, seed: 37, foot: true, curl: 0.3 });
      Q.limb(THREE, P, g, { a: [0.47, 0.96, 0.46], b: [0.57, 0.50, 0.30], c: [0.52, 0.07, 0.13], r0: 0.074, r1: 0.052, r2: 0.041, seed: 41, foot: true, curl: 0.3 });
      /* 2体目の脚（萎縮して宙に浮く・向きがばらばら） */
      Q.limb(THREE, P, g, { a: [0.86, 1.00, 0.70], b: [1.08, 0.60, 0.88], c: [1.14, 0.24, 0.68], r0: 0.048, r1: 0.036, r2: 0.028, seed: 43, foot: true, curl: 0.7 });
      Q.limb(THREE, P, g, { a: [0.72, 0.98, 0.80], b: [0.70, 0.60, 1.10], c: [0.56, 0.30, 1.22], r0: 0.044, r1: 0.033, r2: 0.026, seed: 47, foot: true, curl: 0.8 });

      /* ---- 頭蓋3つ ---- */
      /* A 正面を向く（首の上・口を開く） */
      var neck = U.boneSeg(THREE, P.skin, [0.36, 1.52, 0.32], [0.345, 1.72, 0.215], 0.052, 0.033, 9); g.add(neck);
      g.add(U.boneSeg(THREE, P.skinDark, [0.305, 1.51, 0.28], [0.348, 1.69, 0.20], 0.0075, 0.005, 5));
      g.add(U.boneSeg(THREE, P.skinDark, [0.415, 1.51, 0.29], [0.356, 1.69, 0.21], 0.0075, 0.005, 5));
      var hA = global.__A2_F_SKULL(THREE, { seed: 5, gape: 0.52, crack: true });
      hA.position.set(0.335, 1.84, 0.155); hA.rotation.set(0.20, -0.16, 0.07); g.add(hA);
      /* B 半分埋没（左肩の断片の上。仰向けに傾いで肉に沈む） */
      var hB = global.__A2_F_SKULL(THREE, { seed: 13, jaw: true, gape: 0.10, crack: true });
      hB.position.set(0.00, 1.72, 0.30); hB.rotation.set(-0.75, 0.95, 1.15); hB.scale.setScalar(0.93); g.add(hB);
      var buryB = U.joint(THREE, P.skin, [0.03, 1.64, 0.40], 0.112, 1.1, 0.95, 1.05); g.add(buryB);
      Q.seam(THREE, P, g, [0.02, 1.66, 0.34], [0.2, 0.85, -0.45], 0.062, 53);
      var ear = U.mesh(THREE, new THREE.TorusGeometry(0.019, 0.0055, 4, 10, Math.PI * 1.25), P.skin, 0.085, 1.735, 0.355);
      ear.rotation.set(0.3, -0.9, 2.1); ear.scale.set(1, 1.2, 0.35); g.add(ear);
      /* C ほぼ埋没（2体目の肩に逆さで沈む。天頂と片眼窩だけ覗く） */
      var hC = global.__A2_F_SKULL(THREE, { seed: 71, jaw: false, crack: true });
      hC.position.set(1.15, 1.45, 0.84); hC.rotation.set(0.18, -1.05, 2.25); hC.scale.setScalar(0.88); g.add(hC);
      var buryC = U.joint(THREE, P.skin, [1.14, 1.36, 0.92], 0.118, 1.15, 1.0, 1.0); g.add(buryC);
      Q.seam(THREE, P, g, [1.15, 1.40, 0.88], [0.3, 0.7, 0.6], 0.068, 59);

      return g;
    },
    cams: {
      full: { pos: [-1.02, 1.46, -2.72], look: [0.45, 1.08, 0.42] },
      face: { pos: [0.40, 1.77, -0.64], look: [0.20, 1.79, 0.18] }
    }
  };
})(typeof window !== 'undefined' ? window : this);
