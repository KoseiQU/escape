/* ESCAPE — P5e-1 案F「寄り集まった亡骸」3Dモック（レーンB・質上げ版）
 *
 * 旧坑の複数の骸が癒合した性別不明の個体。壁に手足を掛けて這う。
 *  - 骨は汚れた黄褐色。ひび・欠け・こびりついた泥と黴。清潔な象牙色は禁止。
 *  - 羊皮紙状に乾いた皮膚と腱が骨に張り付き、隙間に膜を張る。
 *  - 頭蓋3つ: 主＝下顎がずれて開く／2つ目＝肩に半分埋没／3つ目＝背中側。
 *  - 肋郭が2つ噛み合う。肢は8本（大人と子供が混ざり、2本は逆向きに曲がる）。
 *  - 歯は1本ずつ不揃い・欠け・黄ばみ。眼窩は黒い空洞で骨の縁が立つ。
 *  - 髪の房・布の切れ端・白い根が絡む。左右非対称。
 *
 * 壁は x=+1.00 の面（法線 −X）。指先・足先が x≈0.97 で接地する。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var MOCKS = ESCAPE.__A2MOCKS = ESCAPE.__A2MOCKS || {};
  var F = global.__A2F = {};

  /* ---------------- 乱数・ノイズ ---------------- */
  function rng(seed) {
    var s = (seed | 0) || 7;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return ((s >>> 0) % 1e5) / 1e5; };
  }
  F.rng = rng;
  function h2(x, y) { var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
  function vn(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o) { var s = 0, a = 0.5, f = 1, i; for (i = 0; i < (o || 4); i++) { s += a * vn(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------- アルベド canvas → 法線・粗さ ---------------- */
  function maps(THREE, cv, bump, rLo, rHi) {
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
        var rv = rHi + (rLo - rHi) * lum[y0 + x];
        rgh[o] = 255; rgh[o + 1] = (cl(rv, 0, 1) * 255) | 0; rgh[o + 2] = 255; rgh[o + 3] = 255;
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

  /* ---------------- 骨のアルベド: 汚れた黄褐色・泥・黴・ひび ---------------- */
  function boneCanvas(seed, dirty) {
    var S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var c = cv.getContext('2d'), R = rng(seed), im = c.createImageData(S, S), d = im.data, x, y, i;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      i = (y * S + x) * 4;
      var n = fbm(x / 26 + seed, y / 26, 5);            /* 骨層の色ムラ */
      var m = fbm(x / 7 + 40, y / 7 + 11, 3);           /* 細かい斑 */
      var r = 126 + n * 58 + (m - 0.5) * 26;
      var g = 110 + n * 50 + (m - 0.5) * 22;
      var b = 76 + n * 32 + (m - 0.5) * 16;
      /* 泥と黴のこびりつき（低周波の塊） */
      var grime = cl((fbm(x / 58 + 7, y / 58 + 3, 4) - 0.40) * 2.7, 0, 1) * dirty;
      r = r * (1 - grime * 0.70) + 26 * grime;
      g = g * (1 - grime * 0.62) + 30 * grime;
      b = b * (1 - grime * 0.74) + 17 * grime;
      /* 黒ずんだ縦の垂れ */
      var drip = cl((fbm(x / 5.5 + 91, y / 46 + 5, 3) - 0.56) * 3.2, 0, 1) * dirty;
      r *= 1 - drip * 0.55; g *= 1 - drip * 0.52; b *= 1 - drip * 0.58;
      d[i] = cl(r, 0, 255); d[i + 1] = cl(g, 0, 255); d[i + 2] = cl(b, 0, 255); d[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    /* ひび（枝分かれする細い黒線） */
    c.lineCap = 'round';
    for (i = 0; i < 95; i++) {
      var cx = R() * S, cy = R() * S, a = R() * 6.283, seg = 3 + (R() * 7 | 0);
      c.strokeStyle = 'rgba(16,13,8,' + (0.34 + R() * 0.46).toFixed(2) + ')';
      c.lineWidth = 0.45 + R() * 1.0;
      c.beginPath(); c.moveTo(cx, cy);
      for (var k = 0; k < seg; k++) {
        a += (R() - 0.5) * 1.15; cx += Math.cos(a) * S * 0.017; cy += Math.sin(a) * S * 0.017; c.lineTo(cx, cy);
      }
      c.stroke();
    }
    /* 剥がれて明るく出た新しい骨面 */
    for (i = 0; i < 26; i++) {
      var px2 = R() * S, py = R() * S, pr = S * (0.008 + R() * 0.026);
      var gr = c.createRadialGradient(px2, py, 0, px2, py, pr);
      gr.addColorStop(0, 'rgba(196,180,140,0.42)'); gr.addColorStop(1, 'rgba(196,180,140,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(px2, py, pr, 0, 6.283); c.fill();
    }
    /* 骨の孔（栄養孔）と粒状感 */
    var img = c.getImageData(0, 0, S, S), dd = img.data;
    for (i = 0; i < S * S * 0.34; i++) {
      var p = ((R() * S | 0) + (R() * S | 0) * S) * 4, v = (R() - 0.5) * 40;
      dd[p] = cl(dd[p] + v, 0, 255); dd[p + 1] = cl(dd[p + 1] + v, 0, 255); dd[p + 2] = cl(dd[p + 2] + v, 0, 255);
    }
    c.putImageData(img, 0, 0);
    for (i = 0; i < 260; i++) {
      c.fillStyle = 'rgba(22,18,12,' + (0.22 + R() * 0.4).toFixed(2) + ')';
      c.beginPath(); c.arc(R() * S, R() * S, 0.5 + R() * 1.3, 0, 6.283); c.fill();
    }
    return cv;
  }
  F.boneCanvas = boneCanvas;
  F.maps = maps;
  F.fbm = fbm;
  F.cl = cl;
})(typeof window !== 'undefined' ? window : this);

/* ---- 案F その2: 乾いた皮膚・布・材質セット・骨の基本部品 ---- */
(function (global) {
  'use strict';
  var F = global.__A2F, cl = F.cl, fbm = F.fbm, rng = F.rng;

  /* 羊皮紙状に乾いた皮膚: 黄ばんだ薄い膜。透けた血管と染み、縮れた縁。 */
  function dryCanvas(seed) {
    var S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var c = cv.getContext('2d'), R = rng(seed), im = c.createImageData(S, S), d = im.data, x, y, i;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      i = (y * S + x) * 4;
      var n = fbm(x / 19 + seed, y / 19, 5), w = fbm(x / 3.2, y / 46, 3);
      var r = 118 + n * 46 + (w - 0.5) * 30, g = 103 + n * 40 + (w - 0.5) * 24, b = 82 + n * 28 + (w - 0.5) * 16;
      var rot = cl((fbm(x / 44 + 20, y / 44 + 8, 4) - 0.46) * 3.0, 0, 1);  /* 腐って黒ずんだ部分 */
      r = r * (1 - rot * 0.76) + 22 * rot; g = g * (1 - rot * 0.70) + 24 * rot; b = b * (1 - rot * 0.72) + 18 * rot;
      d[i] = cl(r, 0, 255); d[i + 1] = cl(g, 0, 255); d[i + 2] = cl(b, 0, 255); d[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    c.lineCap = 'round';
    for (i = 0; i < 300; i++) {                     /* 縮れた皺 */
      var sx = R() * S, sy = R() * S, a = R() * 6.283, L = S * (0.012 + R() * 0.05);
      c.strokeStyle = R() < 0.62 ? 'rgba(28,23,16,0.40)' : 'rgba(188,176,146,0.22)';
      c.lineWidth = 0.5 + R() * 1.0;
      c.beginPath(); c.moveTo(sx, sy);
      c.quadraticCurveTo(sx + Math.cos(a + 0.8) * L, sy + Math.sin(a + 0.8) * L,
        sx + Math.cos(a) * L * 2, sy + Math.sin(a) * L * 2);
      c.stroke();
    }
    for (i = 0; i < 40; i++) {                      /* 透けた血管 */
      var vx = R() * S, vy = R() * S, va = R() * 6.283;
      c.strokeStyle = 'rgba(58,40,38,0.30)'; c.lineWidth = 0.6 + R() * 1.5;
      c.beginPath(); c.moveTo(vx, vy);
      for (var k = 0; k < 5; k++) { va += (R() - 0.5) * 1.2; vx += Math.cos(va) * S * 0.026; vy += Math.sin(va) * S * 0.026; c.lineTo(vx, vy); }
      c.stroke();
    }
    return cv;
  }

  function clothCanvas(seed) {
    var S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var c = cv.getContext('2d'), R = rng(seed), im = c.createImageData(S, S), d = im.data, x, y, i;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      i = (y * S + x) * 4;
      var weave = ((x % 3 < 1.4) ? 1 : 0.82) * ((y % 3 < 1.4) ? 1 : 0.86);
      var n = fbm(x / 21 + seed, y / 21, 4), v = (30 + n * 34) * weave;
      d[i] = cl(v * 1.02, 0, 255); d[i + 1] = cl(v * 0.98, 0, 255); d[i + 2] = cl(v * 0.80, 0, 255); d[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    for (i = 0; i < 70; i++) {
      c.strokeStyle = 'rgba(10,9,7,0.5)'; c.lineWidth = 0.6 + R() * 1.4;
      c.beginPath(); c.moveTo(R() * S, R() * S); c.lineTo(R() * S, R() * S); c.stroke();
    }
    return cv;
  }

  F.materials = function (THREE) {
    function std(cv, o) {
      var map = new THREE.CanvasTexture(cv);
      map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
      if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
      if (o.rep) map.repeat.set(o.rep[0], o.rep[1]);
      var mm = F.maps(THREE, cv, o.bump, o.rLo, o.rHi);
      if (o.rep) { mm.normalMap.repeat.copy(map.repeat); mm.roughnessMap.repeat.copy(map.repeat); }
      var m = new THREE.MeshStandardMaterial({
        map: map, normalMap: mm.normalMap, roughnessMap: mm.roughnessMap,
        color: new THREE.Color(o.tint === undefined ? 0xffffff : o.tint),
        roughness: 1, metalness: 0, side: o.side || THREE.FrontSide
      });
      m.normalScale = new THREE.Vector2(o.ns === undefined ? 1 : o.ns, o.ns === undefined ? 1 : o.ns);
      return m;
    }
    var boneCv = F.boneCanvas(3, 0.72), boneDirtyCv = F.boneCanvas(29, 1.35), dryCv = dryCanvas(17);
    var P = {};
    P.bone = std(boneCv, { bump: 2.8, rLo: 0.60, rHi: 0.95, tint: 0x8f886d, rep: [3, 3], ns: 1.0 });
    P.boneSkull = std(boneCv, { bump: 2.6, rLo: 0.58, rHi: 0.94, tint: 0x9a9178, rep: [4, 4], ns: 0.75 });
    P.boneDirty = std(boneDirtyCv, { bump: 3.2, rLo: 0.66, rHi: 0.98, tint: 0x6e6a53, rep: [2, 2], ns: 1.3 });
    P.boneChild = std(boneCv, { bump: 3.0, rLo: 0.58, rHi: 0.93, tint: 0xa39a7c, rep: [3, 3], ns: 1.2 });
    P.dry = std(dryCv, { bump: 2.4, rLo: 0.62, rHi: 0.94, tint: 0x80765f, rep: [2, 2], ns: 1.1, side: THREE.DoubleSide });
    P.dryWet = std(dryCv, { bump: 2.8, rLo: 0.30, rHi: 0.72, tint: 0x6d6252, rep: [2, 2], ns: 1.5, side: THREE.DoubleSide });
    P.cloth = std(clothCanvas(41), { bump: 2.2, rLo: 0.88, rHi: 1.0, tint: 0x6d6a55, rep: [2, 2], side: THREE.DoubleSide });
    P.cavity = new THREE.MeshBasicMaterial({ color: 0x000000 });
    P.socket = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    P.gum = new THREE.MeshStandardMaterial({ color: 0x2a1512, roughness: 0.62, metalness: 0 });
    P.hair = new THREE.MeshStandardMaterial({ color: 0x100d0b, roughness: 0.58, metalness: 0 });
    P.root = new THREE.MeshStandardMaterial({ color: 0x9c9478, roughness: 0.78, metalness: 0 });
    P.sinew = new THREE.MeshStandardMaterial({ color: 0x94886a, roughness: 0.45, metalness: 0 });
    /* 歯は1本ごとに色を変えるのでマテリアルを数本用意する */
    P.teeth = [0x7c7150, 0x655b3e, 0x877a57, 0x534930, 0x6f6446, 0x3f3722].map(function (hx) {
      return new THREE.MeshStandardMaterial({ color: hx, roughness: 0.46 + Math.random() * 0, metalness: 0 });
    });
    return P;
  };
  global.__A2F_dryCanvas = dryCanvas;
})(typeof window !== 'undefined' ? window : this);

/* ---- 案F その3: 頭蓋（3つとも同じ彫り方。眼窩＝黒い空洞＋立った骨の縁） ---- */
(function (global) {
  'use strict';
  var F = global.__A2F;

  function mesh(THREE, g, m, p, r, s) {
    var o = new THREE.Mesh(g, m);
    if (p) o.position.set(p[0], p[1], p[2]);
    if (r) o.rotation.set(r[0], r[1], r[2]);
    if (s) { if (typeof s === 'number') o.scale.setScalar(s); else o.scale.set(s[0], s[1], s[2]); }
    o.castShadow = true; o.receiveShadow = true; return o;
  }
  F.mesh = mesh;

  /* 曲線チューブ（腱・弓・髪・根） */
  function tube(THREE, pts, r, rad) {
    var v = pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v), Math.max(6, v.length * 3), r, rad || 5, false);
  }
  F.tube = tube;

  /* 三角形を削って本当の穴を開ける（眼窩・鼻腔）。holes: [{c:[x,y,z], r:[rx,ry,rz]}] */
  /* 歪めた楕円体（埋没した頭蓋を覆う乾いた肉のかたまり） */
  F.warpBall = function (THREE, rx, ry, rz, seed) {
    var L = global.ESCAPE.__A2LIB;
    var g = new THREE.SphereGeometry(1, 14, 11);
    g.scale(rx, ry, rz);
    L.warp(g, Math.min(rx, ry) * 0.26, 12, seed || 7);
    return g;
  };

  F.punch = function (g, holes) {
    var pos = g.attributes.position.array, idx = g.index.array, out = [], i, h;
    for (i = 0; i < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var cx = (pos[a] + pos[b] + pos[c]) / 3;
      var cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
      var cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
      var kill = false;
      for (h = 0; h < holes.length; h++) {
        var H = holes[h];
        var dx = (cx - H.c[0]) / H.r[0], dy = (cy - H.c[1]) / H.r[1], dz = (cz - H.c[2]) / H.r[2];
        if (dx * dx + dy * dy + dz * dz < 1) { kill = true; break; }
      }
      if (!kill) out.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g.setIndex(out);
    return g;
  };

  /* 歯を1本: 大きさ・向き・色・欠けを個別に散らす */
  function tooth(THREE, P, R, pos, up, w, h, chip) {
    var g = chip > 0.6
      ? new THREE.ConeGeometry(w, h * 0.55, 4)            /* 折れて短い */
      : new THREE.CylinderGeometry(w * (0.55 + R() * 0.35), w, h, 5);
    g.translate(0, -h / 2 * (up ? -1 : 1), 0);
    if (up) g.scale(1, -1, 1);
    var m = P.teeth[(R() * P.teeth.length) | 0];
    return mesh(THREE, g, m, pos, [(R() - 0.5) * 0.55, (R() - 0.5) * 1.2, (R() - 0.5) * 0.5]);
  }

  /* 歯列: arc(t)->[x,y,z] に n 本。miss の割合で欠ける。 */
  function row(THREE, P, parent, n, arc, up, size, seed, miss) {
    var R = F.rng(seed), i;
    for (i = 0; i < n; i++) {
      if (R() < (miss === undefined ? 0.16 : miss)) continue;
      var t = i / (n - 1), p = arc(t);
      parent.add(tooth(THREE, P, R, p, up, size[0] * (0.72 + R() * 0.62), size[1] * (0.6 + R() * 0.85), R()));
    }
  }
  F.teethRow = row;

  /* 頭蓋。原点＝頭の中心、正面 −Z。
   * 眼窩は「本物の穴」: 骨殻に浅い窪みを彫り、そこへ開口円錐（内面＝ほぼ無照明の黒）を
   * 差し込む。窪みの周囲は隆起させて骨の縁を立てる。
   * opt: { seed, gape, slip, jaw, scale, chip, seg,
   *        slim（頬骨弓・皮膚片・腱を省いて安く作る）, only:'jaw'|'calvaria'（断片） } */
  F.skull = function (THREE, P, opt) {
    opt = opt || {};
    var L = global.ESCAPE.__A2LIB;
    var R = F.rng(opt.seed || 5), G = new THREE.Group();
    var rx = 0.080, ry = 0.098, rz = 0.110;
    var ch = opt.chip === undefined ? 1 : opt.chip;
    var slim = !!opt.slim, only = opt.only || '';
    /* 頭頂の割れた蓋だけの断片 */
    if (only === 'calvaria') {
      var cal = new THREE.SphereGeometry(1, 22, 14, 0.35, Math.PI * 1.15, 0, Math.PI * 0.48);
      cal.scale(rx, ry, rz);
      L.warp(cal, 0.004, 16, opt.seed || 5);
      var cm = mesh(THREE, cal, P.boneSkull);
      cm.material = P.boneSkull; G.add(cm);
      var cin = new THREE.SphereGeometry(1, 12, 8, 0.35, Math.PI * 1.15, 0, Math.PI * 0.48);
      cin.scale(rx * 0.90, ry * 0.90, rz * 0.90);
      G.add(mesh(THREE, cin, P.cavity));
      if (opt.scale) G.scale.setScalar(opt.scale);
      return G;
    }
    /* 眼窩の中心（左右で高さ・大きさを変える＝非対称） */
    var OR = [
      { c: [rx * 0.44, ry * 0.20, -rz * 0.64], r: 0.0320, s: 1 },
      { c: [-rx * 0.42, ry * 0.15, -rz * 0.66], r: 0.0345, s: -1 }
    ];

    /* ---- 脳頭蓋 ---- */
    if (only === 'jaw') {
      var JG = new THREE.Group();
      JG.add(mesh(THREE, F.tube(THREE, [
        [rx * 0.58, ry * 0.02, -rz * 0.30], [rx * 0.44, -ry * 0.03, -rz * 0.54],
        [0, -ry * 0.05, -rz * 0.62], [-rx * 0.44, -ry * 0.03, -rz * 0.52],
        [-rx * 0.56, ry * 0.02, -rz * 0.28]
      ], 0.0122, 6), P.boneDirty));
      [1, -1].forEach(function (s4) {
        JG.add(mesh(THREE, F.tube(THREE, [
          [s4 * rx * 0.54, 0.002, -rz * 0.36], [s4 * rx * 0.70, ry * 0.20, rz * 0.10]
        ], 0.0092, 5), P.boneDirty));
      });
      F.teethRow(THREE, P, JG, 11, function (t) {
        var a = (t - 0.5) * 2.38;
        return [Math.sin(a) * rx * 0.52, 0.007, -rz * 0.38 - Math.cos(a) * rz * 0.22];
      }, true, [0.0060, 0.0158], (opt.seed || 5) + 9, 0.34);
      if (opt.scale) JG.scale.setScalar(opt.scale);
      return JG;
    }
    var SEG = opt.seg || 44;
    var v = new THREE.SphereGeometry(1, SEG, Math.round(SEG * 0.68)); v.scale(rx, ry, rz);
    function shape(x, y, z, o) {
      var ny = y / ry, nz = z / rz;
      var dn = Math.max(0, -ny), up = Math.max(0, ny), fw = Math.max(0, -nz);
      var t = Math.max(0, (dn - 0.52) / 0.48), col = 1 - 0.90 * t * t;  /* 歯列の高さで底を絞る */
      o[0] = x * (1 - 0.34 * Math.pow(dn, 1.6)) * (1 - 0.24 * Math.pow(fw, 2.0)) * col;
      o[2] = (z * (nz > 0 ? 1.08 : 1.0) * (1 - 0.18 * Math.pow(dn, 1.9))
             + rz * 0.34 * up * up * fw) * col;            /* 額を後ろへ寝かせる */
      o[1] = y - 0.18 * ry * Math.pow(dn, 2.0) + ry * 0.34 * t * t;
    }
    L.deform(v, shape);
    L.bulge(v, [0, ry * 0.50, -rz * 0.66], rx * 0.88, -0.0075);            /* 額を平らに */
    L.bulge(v, [rx * 0.36, ry * 0.66, -rz * 0.56], rx * 0.30, 0.0072);     /* 前頭隆起 右 */
    L.bulge(v, [-rx * 0.30, ry * 0.60, -rz * 0.58], rx * 0.26, 0.0044);    /* 左は弱い */
    L.bulge(v, [0, ry * 0.30, rz * 0.92], rx * 0.55, 0.0060);              /* 後頭隆起 */
    L.bulge(v, [rx * 0.98, ry * 0.16, -rz * 0.16], rx * 0.66, -0.0215);   /* 側頭窩 右 */
    L.bulge(v, [-rx * 0.97, ry * 0.10, -rz * 0.12], rx * 0.62, -0.0270);  /* 左は深い */
    L.ridge(v, [rx * 0.06, ry * 0.94, -rz * 0.22], [rx * 0.05, ry * 0.34, rz * 0.88], rx * 0.09, -0.0028, 2.4); /* 矢状縫合 */
    L.ridge(v, [rx * 0.99, ry * 0.36, -rz * 0.04], [-rx * 0.96, ry * 0.31, 0], rx * 0.09, -0.0026, 2.6);        /* 冠状縫合 */
    L.ridge(v, [rx * 0.78, ry * 0.08, rz * 0.64], [-rx * 0.66, ry * 0.22, rz * 0.68], rx * 0.10, -0.0024, 2.4); /* ラムダ縫合 */
    L.ridge(v, [rx * 0.22, ry * 0.64, -rz * 0.76], [rx * 0.94, ry * 0.38, -rz * 0.14], rx * 0.14, 0.0034, 2.1); /* 側頭線 */
    /* 眼窩: 浅く窪ませてから三角形を削り取り、本当の穴にする（縁は隆起で立てる） */
    OR.forEach(function (e) {
      var c = e.c, r = e.r, s = e.s;
      L.bulge(v, c, r * 1.70, -0.0130);
      L.ridge(v, [c[0] - s * r * 1.15, c[1] + r * 0.98, c[2] + 0.014],
        [c[0] + s * r * 1.15, c[1] + r * 0.86, c[2] + 0.006], r * 0.46, 0.0195, 2.3);
      L.ridge(v, [c[0] + s * r * 1.22, c[1] + r * 0.84, c[2] + 0.008],
        [c[0] + s * r * 1.10, c[1] - r * 0.80, c[2] + 0.022], r * 0.42, 0.0168, 2.3);
      L.ridge(v, [c[0] - s * r * 0.85, c[1] - r * 1.05, c[2] + 0.010],
        [c[0] + s * r * 1.00, c[1] - r * 0.92, c[2] + 0.018], r * 0.40, 0.0140, 2.4);
    });
    /* 眉弓（右は重く、左は欠ける＝非対称） */
    L.ridge(v, [rx * 0.04, ry * 0.36, -rz * 0.78], [rx * 0.82, ry * 0.30, -rz * 0.36], rx * 0.22, 0.0185, 1.6);
    L.ridge(v, [-rx * 0.05, ry * 0.33, -rz * 0.78], [-rx * 0.46, ry * 0.31, -rz * 0.64], rx * 0.17, 0.0104, 1.8);
    /* 鼻根・鼻梁・梨状口のくぼみ */
    L.ridge(v, [0.001, ry * 0.30, -rz * 0.78], [0.002, ry * 0.04, -rz * 0.86], rx * 0.10, 0.0040, 2.6);
    L.bulge(v, [0.002, ry * 0.32, -rz * 0.80], rx * 0.10, -0.0082);
    L.bulge(v, [0.002, -ry * 0.12, -rz * 0.80], rx * 0.22, -0.0230);
    /* 頬骨体（下眼窩縁の外側の盛り上がり） */
    L.bulge(v, [rx * 0.86, -ry * 0.20, -rz * 0.52], rx * 0.34, 0.0110);
    L.bulge(v, [-rx * 0.82, -ry * 0.26, -rz * 0.50], rx * 0.30, 0.0086);
    /* 欠け・ひび */
    L.bulge(v, [-rx * 0.60, ry * 0.74, rz * 0.28], rx * 0.26, -0.0230 * ch);
    L.bulge(v, [rx * 0.40, ry * 0.26, rz * 0.90], rx * 0.17, -0.0150 * ch);
    L.ridge(v, [-rx * 0.50, ry * 0.80, rz * 0.10], [-rx * 0.10, ry * 0.42, -rz * 0.58], rx * 0.045, -0.0090 * ch, 2.8);
    L.ridge(v, [rx * 0.70, ry * 0.62, rz * 0.40], [rx * 0.30, ry * 0.86, -rz * 0.20], rx * 0.038, -0.0075 * ch, 2.8);
    L.warp(v, 0.0024, 19, opt.seed || 5);
    /* 穴を開ける: 眼窩2つ＋梨状口（鼻腔） */
    F.punch(v, [
      { c: [OR[0].c[0], OR[0].c[1], -rz * 0.62], r: [0.0215, 0.0180, 0.060] },
      { c: [OR[1].c[0], OR[1].c[1], -rz * 0.62], r: [0.0228, 0.0192, 0.060] },
      { c: [0.001, ry * 0.02, -rz * 0.62], r: [0.0058, 0.0120, 0.060] },
      { c: [0.001, -ry * 0.10, -rz * 0.62], r: [0.0094, 0.0115, 0.060] },
      { c: [0.001, -ry * 0.20, -rz * 0.62], r: [0.0124, 0.0100, 0.060] }
    ]);
    G.add(mesh(THREE, v, P.boneSkull));
    /* 頭蓋の内側＝完全な闇（穴から覗く） */
    var inn = new THREE.SphereGeometry(1, slim ? 10 : 16, slim ? 8 : 12);
    inn.scale(rx, ry, rz);
    L.deform(inn, shape);
    inn.scale(0.90, 0.90, 0.90);
    G.add(mesh(THREE, inn, P.cavity));

    /* ---- 眼窩の縁（骨が立つ）と、穴の奥の筒 ---- */
    OR.forEach(function (e, k) {
      var c = e.c, w = k ? 0.0228 : 0.0215;
      /* 眼窩の奥＝完全な黒の内壁 */
      var tubeIn = new THREE.CylinderGeometry(w * 1.02, w * 0.44, 0.046, 14, 1, true);
      tubeIn.rotateX(Math.PI / 2);
      G.add(mesh(THREE, tubeIn, P.cavity, [c[0], c[1], -rz * 0.58], [0.12, -e.s * 0.28, 0], [1, 0.86, 1]));
      /* 立った骨の縁（眼窩縁）。穴の切り口も隠す。 */
      var rim = new THREE.TorusGeometry(w * 1.02, w * 0.112, 5, slim ? 13 : 22);
      rim.scale(1, 0.88, 0.50);
      G.add(mesh(THREE, rim, P.boneSkull, [c[0], c[1], -rz * 0.795], [0.13, -e.s * 0.30, e.s * 0.08]));
    });

    /* ---- 頬骨弓: 殻に沿わせた細い橋（下に隙間ができる＝本物の頭蓋の決め手） ---- */
    if (!slim) [1, -1].forEach(function (s2) {
      G.add(mesh(THREE, F.tube(THREE, [
        [s2 * rx * 0.70, -ry * 0.10, -rz * 0.44], [s2 * rx * 0.86, -ry * 0.02, -rz * 0.12],
        [s2 * rx * 0.84, ry * 0.10, rz * 0.18]
      ], 0.0033 * (s2 > 0 ? 1 : 0.80), 4), P.boneSkull));
    });

    /* ---- 上顎（歯槽突起）と歯 ---- */
    var mx = new THREE.SphereGeometry(1, 22, 14); mx.scale(rx * 0.60, ry * 0.24, rz * 0.42);
    L.deform(mx, function (x, y, z, o) { o[2] = z * (z < 0 ? 1.02 : 0.74); o[1] = y * (y < 0 ? 1.2 : 0.9); });
    L.bulge(mx, [0, -ry * 0.22, -rz * 0.34], rx * 0.26, -0.0055);
    L.bulge(mx, [rx * 0.34, -ry * 0.04, -rz * 0.30], rx * 0.20, -0.0072);   /* 犬歯窩 右 */
    L.bulge(mx, [-rx * 0.30, -ry * 0.08, -rz * 0.28], rx * 0.18, -0.0058);  /* 左 */
    L.warp(mx, 0.0022, 21, (opt.seed || 5) + 2);
    G.add(mesh(THREE, mx, P.boneSkull, [0.002, -ry * 0.52, -rz * 0.22]));
    G.add(mesh(THREE, F.tube(THREE, [[rx * 0.54, -ry * 0.62, -rz * 0.36], [0, -ry * 0.64, -rz * 0.52],
      [-rx * 0.52, -ry * 0.66, -rz * 0.34]], 0.0090, 5), P.gum));
    F.teethRow(THREE, P, G, 11, function (t) {
      var a = (t - 0.5) * 2.45;
      return [Math.sin(a) * rx * 0.58, -ry * 0.68, -rz * 0.30 - Math.cos(a) * rz * 0.26];
    }, false, [0.0064, 0.0182], (opt.seed || 5) + 3, 0.22);

    /* ---- 下顎（別パーツ。主頭蓋はずれて開く） ---- */
    if (opt.jaw !== false) {
      var J = new THREE.Group();
      J.add(mesh(THREE, F.tube(THREE, [
        [rx * 0.58, ry * 0.02, -rz * 0.30], [rx * 0.44, -ry * 0.03, -rz * 0.54],
        [0, -ry * 0.05, -rz * 0.62], [-rx * 0.44, -ry * 0.03, -rz * 0.52],
        [-rx * 0.56, ry * 0.02, -rz * 0.28]
      ], 0.0125, 6), P.boneSkull));
      [1, -1].forEach(function (s3) {
        J.add(mesh(THREE, F.tube(THREE, [
          [s3 * rx * 0.54, 0.002, -rz * 0.36], [s3 * rx * 0.70, ry * 0.20, rz * 0.10], [s3 * rx * 0.64, ry * 0.34, rz * 0.26]
        ], 0.0090 * (s3 > 0 ? 1 : 0.88), 5), P.boneSkull));
      });
      F.teethRow(THREE, P, J, 11, function (t) {
        var a = (t - 0.5) * 2.38;
        return [Math.sin(a) * rx * 0.52, 0.007, -rz * 0.38 - Math.cos(a) * rz * 0.22];
      }, true, [0.0060, 0.0158], (opt.seed || 5) + 9, 0.28);
      J.add(F.knob(THREE, P.boneSkull, [rx * 0.64, ry * 0.34, rz * 0.26], 0.0085));
      J.add(F.knob(THREE, P.boneSkull, [-rx * 0.62, ry * 0.34, rz * 0.26], 0.0080));
      J.position.set((opt.slip === undefined ? 0.014 : opt.slip), -ry * 0.54, rz * 0.04);
      J.rotation.set(-(opt.gape === undefined ? 0.42 : opt.gape), (opt.slip ? 0.18 : 0.10), 0.15);
      G.add(J);
      G.add(mesh(THREE, new THREE.SphereGeometry(0.032, 12, 10), P.cavity,
        [0.004, -ry * 0.78, -rz * 0.22], null, [1, 1, 0.85]));
    }

    /* ---- 骨に張り付いた羊皮紙状の皮膚と腱（3か所・非対称） ---- */
    if (slim) { if (opt.scale) G.scale.setScalar(opt.scale); return G; }
    var pc = new THREE.SphereGeometry(1, 12, 9, Math.PI * 0.72, Math.PI * 0.56, Math.PI * 0.20, Math.PI * 0.40);
    pc.scale(rx * 1.03, ry * 1.03, rz * 1.03);
    G.add(mesh(THREE, pc, P.dry, [0, 0, 0], [0, 0, 0.25]));              /* 後頭にだけ張り付く */
    G.add(mesh(THREE, F.tube(THREE, [[rx * 0.76, -ry * 0.24, -rz * 0.42], [rx * 0.84, -ry * 0.48, -rz * 0.14],
      [rx * 0.60, -ry * 0.66, rz * 0.08]], 0.0032, 4), P.sinew));
    /* 頬骨の下に垂れ下がる乾いた皮膚 */
    var flap = new THREE.PlaneGeometry(0.030, 0.046, 3, 4);
    L.warp(flap, 0.006, 40, 31);
    G.add(mesh(THREE, flap, P.dry, [rx * 0.72, -ry * 0.36, -rz * 0.46], [0.15, -0.85, 0.22]));
    var flap2 = new THREE.PlaneGeometry(0.024, 0.034, 3, 3);
    L.warp(flap2, 0.005, 44, 37);
    G.add(mesh(THREE, flap2, P.dry, [-rx * 0.66, -ry * 0.20, -rz * 0.50], [-0.10, 0.75, -0.30]));

    if (opt.scale) G.scale.setScalar(opt.scale);
    return G;
  };
})(typeof window !== 'undefined' ? window : this);

/* ---- 案F その4: 長骨・肋骨・椎骨・手足・腱・膜 ---- */
(function (global) {
  'use strict';
  var F = global.__A2F, mesh = F.mesh, tube = F.tube;
  var UP = null;

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function len(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
  F.mid = function (a, b, o) {
    o = o || [0, 0, 0];
    return [(a[0] + b[0]) / 2 + o[0], (a[1] + b[1]) / 2 + o[1], (a[2] + b[2]) / 2 + o[2]];
  };

  /* a→b に骨を立てる。中央が細く両端が膨らむ（骨幹と骨端）。bow で反らせる。 */
  F.bone = function (THREE, mat, a, b, r, bow, seg, hseg) {
    if (!UP) UP = new THREE.Vector3(0, 1, 0);
    var d = sub(b, a), L = len(d) || 1e-4;
    var g = new THREE.CylinderGeometry(r, r, L, seg || 9, hseg || 7);
    var pos = g.attributes.position, ar = pos.array, i;
    for (i = 0; i < ar.length; i += 3) {
      var t = ar[i + 1] / (L / 2);                       /* -1..1 */
      var k = 0.58 + 0.42 * Math.pow(Math.abs(t), 2.4);  /* 骨端で太る */
      k *= 1 + 0.10 * Math.sin(t * 7.0);                 /* 骨の瘤 */
      ar[i] *= k; ar[i + 2] *= k * (1 - 0.16 * (1 - Math.abs(t)));
      ar[i] += (bow || 0) * L * (1 - t * t);             /* 反り */
    }
    pos.needsUpdate = true; g.computeVertexNormals();
    g.translate(0, L / 2, 0);
    var m = new THREE.Mesh(g, mat);
    m.position.set(a[0], a[1], a[2]);
    m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(d[0] / L, d[1] / L, d[2] / L));
    m.castShadow = true; m.receiveShadow = true; return m;
  };

  /* 関節の瘤 */
  F.knob = function (THREE, mat, p, r, s) {
    var g = new THREE.SphereGeometry(r, 9, 7);
    return mesh(THREE, g, mat, p, [Math.random() * 0, 0, 0], s || [1, 0.85, 1.05]);
  };

  /* 指（3節）。dir 方向へ伸ばし、curl で壁を掴むように曲げる。 */
  F.finger = function (THREE, mat, root, dir, L, r, curl, grip) {
    var g = new THREE.Group(), p = root.slice(), d = dir.slice(), i;
    var segs = [0.42, 0.33, 0.25];
    for (i = 0; i < 3; i++) {
      var l = L * segs[i];
      var n = [p[0] + d[0] * l, p[1] + d[1] * l, p[2] + d[2] * l];
      g.add(F.bone(THREE, mat, p, n, r * (1 - i * 0.20), 0, 5, 4));
      p = n;
      d[1] -= curl; d[0] += grip || 0;
      var dl = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
      d[0] /= dl; d[1] /= dl; d[2] /= dl;
    }
    return g;
  };

  /* 手: 掌の小骨＋5指。壁を掴む（+X 方向の壁に貼りつく）。 */
  F.hand = function (THREE, mat, p, aim, size, seed, curl) {
    var R = F.rng(seed), g = new THREE.Group(), i;
    var pal = new THREE.SphereGeometry(1, 12, 9); pal.scale(size * 0.34, size * 0.13, size * 0.30);
    g.add(mesh(THREE, pal, mat, [0, 0, 0]));
    for (i = 0; i < 5; i++) {
      var a = (i / 4 - 0.5) * 1.55 + (R() - 0.5) * 0.22;
      var dir = [Math.sin(a) * 0.42, -0.12 + (R() - 0.5) * 0.2, -Math.cos(a) * 0.9];
      var dl = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
      dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
      g.add(F.finger(THREE, mat, [dir[0] * size * 0.26, 0, dir[2] * size * 0.26],
        dir, size * (0.78 + R() * 0.34), size * 0.052 * (i === 0 ? 1.25 : 1), curl === undefined ? 0.42 : curl, 0));
    }
    g.position.set(p[0], p[1], p[2]);
    g.rotation.set(aim[0], aim[1], aim[2]);
    return g;
  };

  /* 足: 踵＋中足骨＋短い趾 */
  F.foot = function (THREE, mat, p, aim, size, seed) {
    var R = F.rng(seed), g = new THREE.Group(), i;
    var hl = new THREE.SphereGeometry(1, 11, 8); hl.scale(size * 0.22, size * 0.20, size * 0.26);
    g.add(mesh(THREE, hl, mat, [0, 0, size * 0.16]));
    for (i = 0; i < 5; i++) {
      var a = (i / 4 - 0.5) * 0.95;
      var dir = [Math.sin(a) * 0.4, -0.30, -Math.cos(a) * 0.86];
      g.add(F.finger(THREE, mat, [dir[0] * size * 0.1, 0, -size * 0.06],
        dir, size * (0.60 + R() * 0.22), size * 0.048, 0.34, 0));
    }
    g.position.set(p[0], p[1], p[2]);
    g.rotation.set(aim[0], aim[1], aim[2]);
    return g;
  };

  /* 腱（骨に張り付いた乾いた筋） */
  F.sinew = function (THREE, mat, pts, r) {
    return mesh(THREE, tube(THREE, pts, r, 4), mat);
  };

  /* 羊皮紙状の皮膜: 3点を結ぶ薄い帯（骨の隙間に張る） */
  F.web = function (THREE, mat, a, b, c, sag) {
    var g = new THREE.BufferGeometry(), i, j, N = 5;
    var pos = [], idx = [];
    for (i = 0; i <= N; i++) for (j = 0; j <= N; j++) {
      var u = i / N, v = j / N * (1 - u);
      var w = 1 - u - v, s = (sag || 0.04) * u * v * w * 27;
      pos.push(a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v - s, a[2] * w + b[2] * u + c[2] * v);
    }
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      var o = i * (N + 1) + j;
      idx.push(o, o + 1, o + N + 1, o + 1, o + N + 2, o + N + 1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
  };

  /* 肋郭: 脊柱 spine(t) から前方 fwd へ弧を描く肋骨を n 対。break で折れた肋骨を混ぜる。 */
  F.ribcage = function (THREE, mat, o) {
    var g = new THREE.Group(), R = F.rng(o.seed || 21), i, s;
    for (i = 0; i < o.n; i++) {
      var t = i / (o.n - 1);
      var y = -t * o.h, w = o.w * (0.52 + Math.sin((0.15 + t * 0.82) * Math.PI) * 0.66);
      var dep = o.d * (0.55 + Math.sin((0.1 + t * 0.9) * Math.PI) * 0.60);
      for (s = -1; s <= 1; s += 2) {
        var brk = R() < 0.16;
        var pts = [[0, y, 0], [s * w * 0.42, y - 0.012, -dep * 0.42], [s * w * 0.86, y - 0.038, -dep * 0.86],
          [s * w * 0.80, y - 0.085, -dep * 1.20], [s * w * 0.34, y - 0.105, -dep * 1.36]];
        if (brk) pts = pts.slice(0, 3);
        var rr = o.r * (0.78 + R() * 0.5);
        var rib = mesh(THREE, tube(THREE, pts, rr, 4), mat);
        g.add(rib);
      }
    }
    g.position.set(o.p[0], o.p[1], o.p[2]);
    if (o.rot) g.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    if (o.scale) g.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    return g;
  };

  /* 脊柱: 椎体＋棘突起 */
  F.spine = function (THREE, mat, pts, r, n) {
    var g = new THREE.Group(), i;
    var v = pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
    var cu = new THREE.CatmullRomCurve3(v);
    for (i = 0; i < n; i++) {
      var t = i / (n - 1), p = cu.getPoint(t), tg = cu.getTangent(t);
      var body = new THREE.CylinderGeometry(r * 0.96, r, r * 1.15, 8);
      var m = new THREE.Mesh(body, mat); m.position.copy(p);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tg);
      m.castShadow = m.receiveShadow = true; g.add(m);
      var sp = new THREE.ConeGeometry(r * 0.42, r * 1.9, 5);
      sp.translate(0, r * 0.95, 0);
      var sm = new THREE.Mesh(sp, mat);
      sm.position.set(p.x + r * 1.0, p.y + r * 0.2, p.z + r * 1.05);
      sm.rotation.set(1.15 + 0.1 * Math.sin(i), 0, -0.7);
      sm.castShadow = sm.receiveShadow = true; g.add(sm);
    }
    return g;
  };
})(typeof window !== 'undefined' ? window : this);

/* ---- 案F その5: 組み立て（壁 x=+1.00 を這う） ---- */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE, F = global.__A2F, mesh = F.mesh, tube = F.tube;

  /* 肢1本: 上腕→前腕→（手/足）。骨端の瘤と腱つき。 */
  function limb(THREE, P, g, o) {
    var mat = o.child ? P.boneChild : (o.dirty ? P.boneDirty : P.bone);
    g.add(F.bone(THREE, mat, o.a, o.b, o.r0, o.bow0 || 0.03, 8, 5));
    g.add(F.bone(THREE, mat, o.b, o.c, o.r1, o.bow1 || -0.02, 8, 5));
    g.add(F.knob(THREE, mat, o.a, o.r0 * 1.5, [1, 0.85, 1.05]));
    g.add(F.knob(THREE, mat, o.b, o.r0 * 1.42));
    g.add(F.sinew(THREE, P.sinew, [
      [o.a[0] - o.r0, o.a[1], o.a[2]], [(o.a[0] + o.b[0]) / 2 - o.r0 * 1.4, (o.a[1] + o.b[1]) / 2, (o.a[2] + o.b[2]) / 2 - o.r0],
      [o.b[0] - o.r0 * 0.6, o.b[1], o.b[2]]], o.r0 * 0.22));
    if (o.hand) g.add(F.hand(THREE, mat, o.c, o.aim, o.hand, o.seed || 3, o.curl));
    if (o.foot) g.add(F.foot(THREE, mat, o.c, o.aim, o.foot, o.seed || 5));
  }

  ESCAPE.__A2MOCKS.F = {
    name: '案F 寄り集まった亡骸',
    build: function (THREE) {
      var L = ESCAPE.__A2LIB, P = F.materials(THREE), G = new THREE.Group(), i;
      var R = F.rng(101);

      /* ===== 脊柱（棘突起が壁と反対＝手前に立つ） ===== */
      var sp = [[0.84, 0.56, 0.96], [0.79, 0.95, 0.64], [0.72, 1.33, 0.30], [0.63, 1.70, 0.04], [0.55, 1.93, -0.14]];
      G.add(F.spine(THREE, P.bone, sp, 0.030, 16));
      /* 骨盤（欠けた輪） */
      var pel = new THREE.TorusGeometry(0.105, 0.030, 7, 16, Math.PI * 1.5);
      G.add(mesh(THREE, pel, P.boneDirty, [0.82, 0.57, 0.94], [1.25, -0.5, 0.4], [1, 0.78, 1]));
      G.add(mesh(THREE, new THREE.SphereGeometry(0.052, 10, 8), P.boneDirty, [0.84, 0.62, 0.93], null, [1, 1.2, 0.7]));

      /* ===== 肋郭2つ（噛み合う） ===== */
      G.add(F.ribcage(THREE, P.bone, {
        n: 10, h: 0.60, w: 0.19, d: 0.20, r: 0.0115, seed: 21,
        p: [0.63, 1.74, 0.02], rot: [0.28, -1.57, -0.40]
      }));
      G.add(F.ribcage(THREE, P.boneDirty, {
        n: 8, h: 0.40, w: 0.145, d: 0.15, r: 0.0092, seed: 37,
        p: [0.74, 1.28, 0.44], rot: [1.05, -2.35, 0.62], scale: [1, 1, 1.1]
      }));
      /* 鎖骨2本（非対称） */
      G.add(F.bone(THREE, P.bone, [0.58, 1.84, -0.06], [0.66, 1.78, 0.26], 0.011, 0.06, 7, 5));
      G.add(F.bone(THREE, P.bone, [0.58, 1.83, -0.08], [0.55, 1.74, -0.30], 0.0095, -0.05, 7, 5));

      /* ===== 肢8本（大人と子供／2本は逆向きの関節） ===== */
      limb(THREE, P, G, { a: [0.60, 1.80, -0.02], b: [0.82, 2.14, 0.14], c: [0.93, 2.20, 0.00],
        r0: 0.036, r1: 0.028, hand: 0.10, aim: [0.5, -1.35, 0.4], seed: 3, curl: 0.5 });
      limb(THREE, P, G, { a: [0.67, 1.66, 0.30], b: [0.46, 1.29, -0.32], c: [0.90, 1.33, -0.28],  /* 逆向きの肘 */
        r0: 0.035, r1: 0.026, bow1: 0.06, hand: 0.095, aim: [0.1, -1.6, -0.2], seed: 7, curl: 0.55 });
      limb(THREE, P, G, { a: [0.69, 1.46, 0.08], b: [0.50, 1.28, -0.36], c: [0.37, 1.12, -0.55],  /* 子供の腕 */
        r0: 0.020, r1: 0.015, child: true, hand: 0.058, aim: [-0.5, -0.6, 0.5], seed: 11, curl: 0.22 });
      limb(THREE, P, G, { a: [0.75, 1.54, 0.62], b: [0.87, 1.12, 0.87], c: [0.82, 0.73, 0.93],    /* 垂れた腕 */
        r0: 0.031, r1: 0.024, dirty: true, hand: 0.088, aim: [0.9, -0.3, 0.2], seed: 13, curl: 0.15 });
      limb(THREE, P, G, { a: [0.80, 0.99, 0.71], b: [0.60, 0.62, 0.28], c: [0.92, 0.41, 0.26],    /* 脚（膝が手前） */
        r0: 0.041, r1: 0.031, foot: 0.11, aim: [-0.35, -1.5, 0.3], seed: 17 });
      limb(THREE, P, G, { a: [0.78, 0.93, 0.86], b: [0.91, 0.49, 1.27], c: [0.93, 0.19, 0.85],    /* 逆向きの膝 */
        r0: 0.037, r1: 0.029, dirty: true, foot: 0.10, aim: [0.5, -1.5, -0.3], seed: 19 });
      limb(THREE, P, G, { a: [0.85, 0.85, 1.00], b: [0.95, 0.62, 1.24], c: [0.94, 0.34, 1.31],    /* 子供の脚 */
        r0: 0.022, r1: 0.017, child: true, foot: 0.062, aim: [0.2, -1.5, 0.0], seed: 23 });
      G.add(F.bone(THREE, P.boneDirty, [0.71, 1.30, 0.74], [0.56, 1.03, 0.97], 0.024, 0.05, 9, 5)); /* 折れた腕の残骸 */
      G.add(mesh(THREE, new THREE.ConeGeometry(0.026, 0.035, 5), P.cavity, [0.55, 1.01, 0.99], [1.0, 0.4, 0.6]));

      /* ===== 頭蓋3つ ===== */
      /* 主頭蓋: 首をねじって壁から外へ（カメラ側 −X）顔を向ける。下顎はずれて開く。 */
      var hA = F.skull(THREE, P, { seed: 5, gape: 0.42, slip: 0.018, seg: 52 });
      hA.position.set(0.50, 2.02, -0.20); hA.rotation.set(-0.28, 1.24, 0.14); G.add(hA);
      G.add(F.bone(THREE, P.bone, [0.56, 1.90, -0.10], [0.51, 1.97, -0.18], 0.026, 0, 8, 4)); /* 頸椎 */
      /* 2つ目: 肩の肉に半分埋没（頭頂と片眼窩だけ出る） */
      var hB = F.skull(THREE, P, { seed: 41, gape: 0.14, slip: -0.010, chip: 1.5, scale: 0.90, seg: 34 });
      hB.position.set(0.66, 1.79, 0.28); hB.rotation.set(-0.72, 2.15, 1.30); G.add(hB);
      var buryB = new THREE.SphereGeometry(1, 16, 12); buryB.scale(0.120, 0.105, 0.130);
      L.warp(buryB, 0.013, 14, 9);
      G.add(mesh(THREE, buryB, P.dry, [0.70, 1.72, 0.35]));
      /* 3つ目: 背中側（脊柱の手前）に逆さで沈む */
      var hC = F.skull(THREE, P, { seed: 71, gape: 0.34, slip: 0.02, chip: 1.3, scale: 0.86, seg: 34 });
      hC.position.set(0.49, 1.33, 0.30); hC.rotation.set(0.30, 1.05, 2.55); G.add(hC);
      var buryC = new THREE.SphereGeometry(1, 14, 11); buryC.scale(0.105, 0.098, 0.105);
      L.warp(buryC, 0.012, 15, 4);
      G.add(mesh(THREE, buryC, P.dry, [0.56, 1.30, 0.36]));

      /* 4つ目: 子供の頭蓋。胸郭の縁から横向きに覗く */
      var hD = F.skull(THREE, P, { seed: 23, gape: 0.50, slip: 0.012, chip: 1.2, scale: 0.62, seg: 30, slim: true });
      hD.position.set(0.64, 1.56, -0.10); hD.rotation.set(0.36, 0.80, -1.05); G.add(hD);
      G.add(mesh(THREE, F.warpBall(THREE, 0.056, 0.050, 0.058, 11), P.dry, [0.68, 1.52, 0.00]));
      /* 5つ目: 欠けた半分の頭蓋。下の肋郭に食い込む（下顎なし） */
      var hE = F.skull(THREE, P, { seed: 57, jaw: false, chip: 2.6, scale: 0.92, seg: 30, slim: true });
      hE.position.set(0.55, 1.10, 0.06); hE.rotation.set(1.05, 1.85, 0.70); G.add(hE);
      G.add(mesh(THREE, F.warpBall(THREE, 0.078, 0.070, 0.076, 13), P.dry, [0.61, 1.07, 0.14]));
      /* 6つ目: 下顎だけの断片が骨盤の上に癒着 */
      var hF = F.skull(THREE, P, { seed: 83, only: 'jaw', scale: 1.05 });
      hF.position.set(0.61, 0.92, 0.26); hF.rotation.set(-0.45, 1.10, 2.25); G.add(hF);
      /* 7つ目: 幼児の頭蓋。腰の骨の間に沈む */
      var hG = F.skull(THREE, P, { seed: 97, jaw: false, chip: 1.8, scale: 0.48, seg: 24, slim: true });
      hG.position.set(0.70, 0.78, 0.02); hG.rotation.set(0.25, 0.30, 2.45); G.add(hG);
      G.add(mesh(THREE, F.warpBall(THREE, 0.042, 0.038, 0.042, 10), P.dry, [0.73, 0.76, 0.07]));
      /* 8つ目: 頭頂の割れた蓋だけが背中から生えている */
      var hH = F.skull(THREE, P, { only: 'calvaria', seed: 31, scale: 0.88 });
      hH.position.set(0.60, 1.40, 0.36); hH.rotation.set(-1.25, 0.20, 0.30); G.add(hH);

      /* 9つ目: 大人の頭蓋が胸郭の左から顔を出す */
      var hI = F.skull(THREE, P, { seed: 113, gape: 0.30, slip: -0.020, chip: 1.6, scale: 0.80, seg: 28, slim: true });
      hI.position.set(0.50, 1.44, -0.18); hI.rotation.set(-0.10, 1.55, -0.55); G.add(hI);
      G.add(mesh(THREE, F.warpBall(THREE, 0.066, 0.060, 0.066, 17), P.dry, [0.56, 1.42, -0.10]));
      /* 10個目: 子供の頭蓋が腰の下から出る */
      var hJ = F.skull(THREE, P, { seed: 127, gape: 0.44, chip: 1.4, scale: 0.56, seg: 26, slim: true });
      hJ.position.set(0.58, 0.62, 0.04); hJ.rotation.set(0.22, 1.20, -2.30); G.add(hJ);
      G.add(mesh(THREE, F.warpBall(THREE, 0.048, 0.044, 0.048, 19), P.dry, [0.63, 0.64, 0.10]));
      /* 下胴の乾いた肉のかたまり（骨の山を一体にまとめる） */
      G.add(mesh(THREE, F.warpBall(THREE, 0.150, 0.185, 0.145, 23), P.dry, [0.74, 0.96, 0.44]));
      G.add(mesh(THREE, F.warpBall(THREE, 0.115, 0.140, 0.110, 29), P.dryWet, [0.70, 1.38, 0.24]));

      /* ===== 3つ目の肋郭（子供・脊柱の下部に噛み合う） ===== */
      G.add(F.ribcage(THREE, P.boneChild, {
        n: 7, h: 0.30, w: 0.105, d: 0.112, r: 0.0072, seed: 61,
        p: [0.59, 1.20, 0.00], rot: [-0.62, -0.95, 0.42]
      }));

      /* ===== 追加の肢（合計12本） ===== */
      limb(THREE, P, G, { a: [0.72, 1.62, 0.46], b: [0.88, 1.92, 0.62], c: [0.95, 2.00, 0.46],
        r0: 0.023, r1: 0.018, child: true, hand: 0.062, aim: [0.4, -1.5, 0.5], seed: 29, curl: 0.5 });
      limb(THREE, P, G, { a: [0.74, 1.04, 0.28], b: [0.52, 0.68, -0.20], c: [0.41, 0.38, -0.40],
        r0: 0.036, r1: 0.028, dirty: true, foot: 0.098, aim: [-0.9, -0.9, 0.4], seed: 31 });
      limb(THREE, P, G, { a: [0.82, 0.76, 0.44], b: [0.70, 0.50, 0.16], c: [0.90, 0.33, 0.44],  /* 子供・逆関節 */
        r0: 0.020, r1: 0.015, child: true, foot: 0.058, aim: [0.3, -1.5, -0.2], seed: 37 });
      /* 前腕と手だけの肢（上腕は無い） */
      G.add(F.bone(THREE, P.boneDirty, [0.80, 0.66, 0.02], [0.93, 0.50, -0.12], 0.022, 0.04, 8, 5));
      G.add(F.hand(THREE, P.boneDirty, [0.94, 0.48, -0.14], [0.2, -1.6, 0.1], 0.086, 41, 0.5));
      G.add(F.knob(THREE, P.boneDirty, [0.80, 0.66, 0.02], 0.030));

      /* ===== 背骨1本の芯: 全部を癒合させる乾いた組織の鞘 ===== */
      var core = F.tube(THREE, [[0.84, 0.58, 0.94], [0.80, 0.96, 0.62], [0.73, 1.34, 0.30],
        [0.64, 1.71, 0.04], [0.56, 1.92, -0.12]], 0.066, 9);
      L.warp(core, 0.016, 11, 5);
      G.add(mesh(THREE, core, P.dry));
      var core2 = F.tube(THREE, [[0.80, 0.74, 0.72], [0.72, 1.16, 0.40], [0.66, 1.55, 0.16]], 0.036, 8);
      L.warp(core2, 0.013, 14, 12);
      G.add(mesh(THREE, core2, P.dryWet));

      /* ===== 乾いた皮膚の膜・腱 ===== */
      G.add(F.web(THREE, P.dry, [0.64, 1.74, 0.02], [0.66, 1.46, 0.14], [0.80, 1.62, 0.26], 0.035));
      G.add(F.web(THREE, P.dry, [0.68, 1.62, 0.28], [0.58, 1.42, -0.02], [0.72, 1.40, 0.20], 0.05));
      G.add(F.web(THREE, P.dry, [0.79, 0.98, 0.72], [0.70, 0.78, 0.48], [0.82, 0.74, 0.84], 0.04));
      G.add(F.web(THREE, P.dry, [0.80, 0.92, 0.86], [0.88, 0.70, 1.06], [0.86, 0.90, 1.00], 0.04));
      G.add(F.web(THREE, P.dry, [0.58, 1.88, -0.08], [0.74, 1.74, 0.26], [0.64, 1.72, 0.04], 0.025));
      for (i = 0; i < 7; i++) {
        var t0 = 0.15 + i * 0.11;
        G.add(F.sinew(THREE, P.sinew, [
          [0.60 + R() * 0.1, 1.90 - t0 * 1.2, -0.10 + t0 * 0.7],
          [0.72 + R() * 0.12, 1.80 - t0 * 1.3, 0.02 + t0 * 0.8],
          [0.84 + R() * 0.08, 1.66 - t0 * 1.25, 0.16 + t0 * 0.75]], 0.0045 + R() * 0.004));
      }

      /* 追加の襞と腱（骨の隙間を埋めて一体にする） */
      [[[0.62, 1.72, 0.02], [0.78, 1.52, 0.04], [0.70, 1.60, 0.30]],
       [[0.78, 1.50, 0.00], [0.66, 1.30, 0.10], [0.80, 1.28, 0.26]],
       [[0.62, 1.06, 0.26], [0.74, 1.22, 0.44], [0.66, 1.30, 0.14]],
       [[0.76, 0.82, 0.60], [0.86, 0.72, 0.32], [0.80, 0.96, 0.46]],
       [[0.58, 1.60, 0.52], [0.68, 1.48, 0.34], [0.62, 1.68, 0.30]],
       [[0.74, 1.62, 0.46], [0.62, 1.78, 0.22], [0.72, 1.80, 0.44]]
      ].forEach(function (w, k) { G.add(F.web(THREE, k % 2 ? P.dry : P.dryWet, w[0], w[1], w[2], 0.035)); });
      for (i = 0; i < 10; i++) {
        var u = i / 9;
        G.add(F.sinew(THREE, P.sinew, [
          [0.58 + R() * 0.22, 1.92 - u * 1.24, -0.10 + u * 0.92],
          [0.70 + R() * 0.18, 1.84 - u * 1.28, 0.04 + u * 0.90],
          [0.84 + R() * 0.10, 1.70 - u * 1.20, 0.22 + u * 0.72]], 0.0035 + R() * 0.0035));
      }

      /* ===== 髪の房・布の切れ端・根 ===== */
      for (i = 0; i < 9; i++) {
        var a = (i / 8 - 0.5) * 1.5, hx = 0.50 + Math.sin(a) * 0.05, hz = -0.20 - Math.cos(a) * 0.05;
        var hl = 0.20 + R() * 0.20;
        G.add(mesh(THREE, tube(THREE, [[hx, 2.08, hz], [hx + (R() - 0.5) * 0.03, 2.08 - hl * 0.5, hz + 0.02],
          [hx + (R() - 0.5) * 0.06, 2.08 - hl, hz + 0.05 + R() * 0.04]], 0.006 + R() * 0.005, 4), P.hair));
      }
      for (i = 0; i < 5; i++) {
        var bx = 0.66 + (R() - 0.5) * 0.1, bz = 0.30 + (R() - 0.5) * 0.1, bl = 0.12 + R() * 0.12;
        G.add(mesh(THREE, tube(THREE, [[bx, 1.84, bz], [bx + 0.02, 1.84 - bl, bz + 0.04]], 0.0055, 4), P.hair));
      }
      [[0.70, 1.20, 0.20, 0.26, 0.34, 0.7], [0.84, 0.86, 0.60, 0.20, 0.26, -0.5],
       [0.60, 1.52, -0.18, 0.16, 0.22, 1.2]].forEach(function (c, k) {
        var pg = new THREE.PlaneGeometry(c[3], c[4], 4, 5);
        L.warp(pg, 0.03, 9, 13 + k);
        G.add(mesh(THREE, pg, P.cloth, [c[0], c[1], c[2]], [0.25 + k * 0.3, c[5], 0.2 * k]));
      });
      for (i = 0; i < 6; i++) {
        var ry0 = 0.35 + R() * 1.5;
        G.add(mesh(THREE, tube(THREE, [[0.99, ry0 + 0.5, 0.2 + R() * 0.8], [0.88 - R() * 0.1, ry0 + 0.2, 0.3 + R() * 0.6],
          [0.96, ry0 - 0.2, 0.1 + R() * 0.9]], 0.0035 + R() * 0.003, 4), P.root));
      }
      return G;
    },
    cams: {
      full: { pos: [-1.80, 1.38, -0.80], look: [0.68, 1.18, 0.30] },
      face: { pos: [-0.09, 1.98, -0.40], look: [0.462, 1.966, -0.212], fov: 32 },
      corridor: { pos: [-0.10, 1.50, -8.60], look: [0.62, 1.40, 0.16] }
    }
  };
})(typeof window !== 'undefined' ? window : this);
