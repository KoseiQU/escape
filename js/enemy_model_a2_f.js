/* ESCAPE — P5e-2a エリア2の敵 本番モデル 案F「寄り集まった亡骸」
 * 契約 DESIGN.md §4「P5e-2」／「P5e-1」／「敵」の「ゲーム内の顔の実装規範」。
 *
 * 造形の正は audit/enemy-mocks-a2/3d/mock_F.js（P5e-1 目視合格版）。
 * 本ファイルは**自己完結**（モックにも audit/ にも依存しない。彫り方だけを移植した）。
 *
 * 2形態（名前は既存互換。意味は本体ごと）:
 *   stand … 壁を這う。最寄りの壁面へ寄り、12本の肢を壁に掛けて横移動する。
 *   crawl … 床を走る。壁から剥がれ落ちて蜘蛛のように疾走。頭蓋がガタガタ揺れる。
 *   遷移 0.9 秒。ひとつの四元数 slerp で「剥がれ落ちる」弧を描く
 *   （腹＝+X が壁向きから床向きへ回り、脊柱＝+Y が上から前へ倒れる）。
 *
 * 模型座標（mock_F.js と同一・彫り直しの参照が効くよう意図的に据え置き）:
 *   +X … 腹側（壁に接する面。接地面 x≈0.99）／−X … 顔の向く側
 *   +Y … 上（床 y=0 基準。最下点 y≈0.19＝壁にぶら下がる）
 *   Z  … 壁に沿う横方向
 *
 * 三角形: detail 'normal' ≤30k ／ 'low' ≤10k（activeTriangles() で実測）。
 * インターフェースは js/enemy_model.js の ESCAPE.Enemy と同一。
 * 公開: ESCAPE.EnemyModelsA2.F（レーンAの EnemyFactory が拾う）
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE = global.ESCAPE || {};
  var THREE = global.THREE;
  var A2 = ESCAPE.EnemyA2 || null;   /* レーンAの共有土台。無くても動く */

  /* ================= 決定的乱数・ノイズ ================= */
  function rng(seed) {
    var s = (seed | 0) || 7;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return ((s >>> 0) % 1e5) / 1e5; };
  }
  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth01(t) { t = cl(t, 0, 1); return t * t * (3 - 2 * t); }
  function h2(x, y) { var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
  function vn(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o) {
    var s = 0, a = 0.5, f = 1, i;
    for (i = 0; i < (o || 4); i++) { s += a * vn(x * f, y * f); f *= 2.03; a *= 0.5; }
    return s;
  }

  /* 暗がりでの見え方（emissive の下限/傾き/上限）。レーンAの表があればそれに合わせる
     ＝D・E・F が同じ明るさの系で沈む。無ければ同値の自前の表を使う。 */
  var LIT = (A2 && A2.LIT) || {
    body: { min: 0.020, gain: 0.46, max: 0.150, cine: [0.055, 0.230] },
    face: { min: 0.062, gain: 0.72, max: 0.300, cine: [0.135, 0.460] },
    tooth: { min: 0.040, gain: 0.52, max: 0.210, cine: [0.100, 0.330] },
    cloth: { min: 0.014, gain: 0.38, max: 0.120, cine: [0.036, 0.180] },
    hair: { min: 0.007, gain: 0.22, max: 0.070, cine: [0.018, 0.100] },
    metal: { min: 0.012, gain: 0.44, max: 0.140, cine: [0.034, 0.200] },
    flesh: { min: 0.016, gain: 0.34, max: 0.110, cine: [0.048, 0.190] },
    hollow: { min: 0.000, gain: 0.00, max: 0.000, cine: [0.000, 0.000] }
  };

  /* ================= アルベド canvas → 法線・粗さ ================= */
  function sobel(cv, bump, rLo, rHi) {
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

  /* ================= 骨のアルベド: 汚れた黄褐色・泥・黴・ひび =================
   * 清潔な象牙色は禁止（契約 P5e-1 F）。剥がれて明るく出た新しい骨面と栄養孔を混ぜる。 */
  function boneCanvas(seed, dirty) {
    var S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var c = cv.getContext('2d'), R = rng(seed), im = c.createImageData(S, S), d = im.data, x, y, i;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      i = (y * S + x) * 4;
      var n = fbm(x / 26 + seed, y / 26, 5);
      var m = fbm(x / 7 + 40, y / 7 + 11, 3);
      var r = 126 + n * 58 + (m - 0.5) * 26;
      var g = 110 + n * 50 + (m - 0.5) * 22;
      var b = 76 + n * 32 + (m - 0.5) * 16;
      var grime = cl((fbm(x / 58 + 7, y / 58 + 3, 4) - 0.40) * 2.7, 0, 1) * dirty;
      r = r * (1 - grime * 0.70) + 26 * grime;
      g = g * (1 - grime * 0.62) + 30 * grime;
      b = b * (1 - grime * 0.74) + 17 * grime;
      var drip = cl((fbm(x / 5.5 + 91, y / 46 + 5, 3) - 0.56) * 3.2, 0, 1) * dirty;
      r *= 1 - drip * 0.55; g *= 1 - drip * 0.52; b *= 1 - drip * 0.58;
      d[i] = cl(r, 0, 255); d[i + 1] = cl(g, 0, 255); d[i + 2] = cl(b, 0, 255); d[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    c.lineCap = 'round';
    for (i = 0; i < 95; i++) {                          /* ひび（枝分かれ） */
      var cx = R() * S, cy = R() * S, a = R() * 6.283, seg = 3 + (R() * 7 | 0);
      c.strokeStyle = 'rgba(16,13,8,' + (0.34 + R() * 0.46).toFixed(2) + ')';
      c.lineWidth = 0.45 + R() * 1.0;
      c.beginPath(); c.moveTo(cx, cy);
      for (var k = 0; k < seg; k++) {
        a += (R() - 0.5) * 1.15; cx += Math.cos(a) * S * 0.017; cy += Math.sin(a) * S * 0.017; c.lineTo(cx, cy);
      }
      c.stroke();
    }
    for (i = 0; i < 26; i++) {                          /* 剥がれた新しい骨面 */
      var px2 = R() * S, py = R() * S, pr = S * (0.008 + R() * 0.026);
      var gr = c.createRadialGradient(px2, py, 0, px2, py, pr);
      gr.addColorStop(0, 'rgba(196,180,140,0.42)'); gr.addColorStop(1, 'rgba(196,180,140,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(px2, py, pr, 0, 6.283); c.fill();
    }
    var img = c.getImageData(0, 0, S, S), dd = img.data;
    for (i = 0; i < S * S * 0.34; i++) {                /* 粒状感 */
      var p = ((R() * S | 0) + (R() * S | 0) * S) * 4, v = (R() - 0.5) * 40;
      dd[p] = cl(dd[p] + v, 0, 255); dd[p + 1] = cl(dd[p + 1] + v, 0, 255); dd[p + 2] = cl(dd[p + 2] + v, 0, 255);
    }
    c.putImageData(img, 0, 0);
    for (i = 0; i < 260; i++) {                         /* 栄養孔 */
      c.fillStyle = 'rgba(22,18,12,' + (0.22 + R() * 0.4).toFixed(2) + ')';
      c.beginPath(); c.arc(R() * S, R() * S, 0.5 + R() * 1.3, 0, 6.283); c.fill();
    }
    return cv;
  }

  /* 羊皮紙状に乾いた皮膚: 黄ばんだ薄い膜。透けた血管と染み、縮れた縁。 */
  function dryCanvas(seed) {
    var S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var c = cv.getContext('2d'), R = rng(seed), im = c.createImageData(S, S), d = im.data, x, y, i;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      i = (y * S + x) * 4;
      var n = fbm(x / 19 + seed, y / 19, 5), w = fbm(x / 3.2, y / 46, 3);
      var r = 118 + n * 46 + (w - 0.5) * 30, g = 103 + n * 40 + (w - 0.5) * 24, b = 82 + n * 28 + (w - 0.5) * 16;
      var rot = cl((fbm(x / 44 + 20, y / 44 + 8, 4) - 0.46) * 3.0, 0, 1);
      r = r * (1 - rot * 0.76) + 22 * rot; g = g * (1 - rot * 0.70) + 24 * rot; b = b * (1 - rot * 0.72) + 18 * rot;
      d[i] = cl(r, 0, 255); d[i + 1] = cl(g, 0, 255); d[i + 2] = cl(b, 0, 255); d[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    c.lineCap = 'round';
    for (i = 0; i < 300; i++) {                          /* 縮れた皺 */
      var sx = R() * S, sy = R() * S, a = R() * 6.283, L = S * (0.012 + R() * 0.05);
      c.strokeStyle = R() < 0.62 ? 'rgba(28,23,16,0.40)' : 'rgba(188,176,146,0.22)';
      c.lineWidth = 0.5 + R() * 1.0;
      c.beginPath(); c.moveTo(sx, sy);
      c.quadraticCurveTo(sx + Math.cos(a + 0.8) * L, sy + Math.sin(a + 0.8) * L,
        sx + Math.cos(a) * L * 2, sy + Math.sin(a) * L * 2);
      c.stroke();
    }
    for (i = 0; i < 40; i++) {                           /* 透けた血管 */
      var vx = R() * S, vy = R() * S, va = R() * 6.283;
      c.strokeStyle = 'rgba(58,40,38,0.30)'; c.lineWidth = 0.6 + R() * 1.5;
      c.beginPath(); c.moveTo(vx, vy);
      for (var k = 0; k < 5; k++) {
        va += (R() - 0.5) * 1.2; vx += Math.cos(va) * S * 0.026; vy += Math.sin(va) * S * 0.026; c.lineTo(vx, vy);
      }
      c.stroke();
    }
    return cv;
  }

  /* 布の切れ端（織り目＋ほつれ） */
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

  /* テクスチャは重い。同じ設定は使い回す（dispose では捨てない＝共有物） */
  var texCache = null;
  function sharedTex() {
    if (texCache) return texCache;
    function pack(cv, bump, rLo, rHi) {
      var map = new THREE.CanvasTexture(cv);
      map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
      if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
      var mm = sobel(cv, bump, rLo, rHi);
      return { map: map, normalMap: mm.normalMap, roughnessMap: mm.roughnessMap };
    }
    texCache = {
      bone: pack(boneCanvas(3, 0.72), 2.8, 0.60, 0.95),
      boneDirty: pack(boneCanvas(29, 1.35), 3.2, 0.66, 0.98),
      dry: pack(dryCanvas(17), 2.4, 0.62, 0.94),
      cloth: pack(clothCanvas(41), 2.2, 0.88, 1.0)
    };
    return texCache;
  }

  /* ================= 彫刻ヘルパ（造形の正＝モックの彫り方の移植） ================= */
  function deform(g, fn) {
    var p = g.attributes.position, a = p.array, o = [0, 0, 0];
    for (var i = 0; i < a.length; i += 3) {
      o[0] = a[i]; o[1] = a[i + 1]; o[2] = a[i + 2];
      fn(a[i], a[i + 1], a[i + 2], o);
      a[i] = o[0]; a[i + 1] = o[1]; a[i + 2] = o[2];
    }
    p.needsUpdate = true; g.computeVertexNormals(); return g;
  }
  /* 球状ガウス隆起／窪み（前頭隆起・側頭窩・頬骨体・欠け） */
  function bulge(g, c, r, amp, dir) {
    return deform(g, function (x, y, z, o) {
      var dx = x - c[0], dy = y - c[1], dz = z - c[2];
      var d2 = dx * dx + dy * dy + dz * dz, r2 = r * r;
      if (d2 > r2) return;
      var t = 1 - d2 / r2; t = t * t;
      var n = dir || [x, y, z], nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
      o[0] = x + n[0] / nl * amp * t; o[1] = y + n[1] / nl * amp * t; o[2] = z + n[2] / nl * amp * t;
    });
  }
  /* 線分 a-b に沿った稜／溝（眉弓・縫合・眼窩縁・鼻梁） */
  function ridge(g, a, b, r, amp, pow, dir) {
    var ax = a[0], ay = a[1], az = a[2];
    var bx = b[0] - ax, by = b[1] - ay, bz = b[2] - az;
    var bl = bx * bx + by * by + bz * bz || 1e-9, r2 = r * r, pw = pow || 2;
    return deform(g, function (x, y, z, o) {
      var t = ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / bl;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var dx = x - (ax + bx * t), dy = y - (ay + by * t), dz = z - (az + bz * t);
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) return;
      var w = Math.pow(1 - d2 / r2, pw);
      var n = dir || [x, y, z], nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
      o[0] = x + n[0] / nl * amp * w; o[1] = y + n[1] / nl * amp * w; o[2] = z + n[2] / nl * amp * w;
    });
  }
  /* 全体を軽く歪ませる（左右非対称・有機的な揺らぎ） */
  function warp(g, amp, freq, seed) {
    var R = rng(seed || 3), ox = R() * 10, oy = R() * 10, oz = R() * 10;
    function n(x, y, z) {
      return Math.sin(x * freq + ox) * Math.cos(y * freq * 1.3 + oy) * Math.sin(z * freq * 0.8 + oz);
    }
    return deform(g, function (x, y, z, o) {
      o[0] = x + n(x, y, z) * amp; o[1] = y + n(y + 3.1, z, x) * amp * 0.7; o[2] = z + n(z, x + 1.7, y) * amp;
    });
  }
  /* 三角形を削って本当の穴を開ける（眼窩・梨状口）。holes: [{c:[x,y,z], r:[rx,ry,rz]}] */
  function punch(g, holes) {
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
  }
  /* 曲線チューブ（腱・弓・髪・根・肋骨） */
  function tube(pts, r, rad, mul) {
    var v = [], i;
    for (i = 0; i < pts.length; i++) v.push(new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2]));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(v),
      Math.max(4, Math.round(v.length * (mul || 2))), r, rad || 4, false);
  }
  /* 歪めた楕円体（埋没した頭蓋を覆う乾いた肉のかたまり） */
  function warpBall(rx, ry, rz, seed, seg) {
    var g = new THREE.SphereGeometry(1, seg || 12, Math.round((seg || 12) * 0.78));
    g.scale(rx, ry, rz);
    warp(g, Math.min(rx, ry) * 0.26, 12, seed || 7);
    return g;
  }
  /* 羊皮紙状の皮膜: 3点を結ぶ薄い帯（骨の隙間に張る）。UV つき */
  function webGeo(a, b, c, sag) {
    var g = new THREE.BufferGeometry(), i, j, N = 4;
    var pos = [], uv = [], idx = [];
    for (i = 0; i <= N; i++) for (j = 0; j <= N; j++) {
      var u = i / N, v = j / N * (1 - u);
      var w = 1 - u - v, s = (sag || 0.04) * u * v * w * 27;
      pos.push(a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v - s, a[2] * w + b[2] * u + c[2] * v);
      uv.push(u, v);
    }
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      var o = i * (N + 1) + j;
      idx.push(o, o + 1, o + N + 1, o + 1, o + N + 2, o + N + 1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  /* ================= 材質 =================
   * 骨・乾いた皮膚・布はアルベド＋法線＋粗さ（実ライトで彫刻が立つ）。
   * 眼窩と口腔は「覗いた先は闇」＝光っても黒のまま（emissive 0・粗さ1）。 */
  function buildMats(self) {
    var T = sharedTex(), P = {};
    function std(t, tint, rep, ns, side) {
      var m = new THREE.MeshStandardMaterial({
        map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
        emissiveMap: t.map,                    /* 闇での下限光も絵柄で濁る＝のっぺり光らない */
        color: new THREE.Color(tint), roughness: 1, metalness: 0,
        side: side || THREE.FrontSide
      });
      m.normalScale = new THREE.Vector2(ns, ns);
      if (rep) {
        /* repeat はテクスチャ共有を壊すので、共有物を clone して縮尺だけ変える */
        m.map = t.map.clone(); m.map.needsUpdate = true; m.map.repeat.set(rep[0], rep[1]);
        m.normalMap = t.normalMap.clone(); m.normalMap.needsUpdate = true; m.normalMap.repeat.set(rep[0], rep[1]);
        m.roughnessMap = t.roughnessMap.clone(); m.roughnessMap.needsUpdate = true; m.roughnessMap.repeat.set(rep[0], rep[1]);
        m.emissiveMap = m.map;
        self._track(m.map); self._track(m.normalMap); self._track(m.roughnessMap);
      }
      return m;
    }
    P.bone = self._lit(std(T.bone, 0x8f886d, [3, 3], 1.0), 'body', 0.85);
    P.boneSkull = self._lit(std(T.bone, 0x9a9178, [4, 4], 0.75), 'face', 0.46);
    P.boneDirty = self._lit(std(T.boneDirty, 0x6e6a53, [2, 2], 1.3), 'body', 0.85);
    P.boneChild = self._lit(std(T.bone, 0xa39a7c, [3, 3], 1.2), 'body', 0.85);
    P.dry = self._lit(std(T.dry, 0x80765f, [2, 2], 1.1, THREE.DoubleSide), 'flesh');
    P.dryWet = self._lit(std(T.dry, 0x6d6252, [2, 2], 1.5, THREE.DoubleSide), 'flesh');
    P.dryWet.roughness = 0.74;
    P.cloth = self._lit(std(T.cloth, 0x36342b, [2, 2], 1.0, THREE.DoubleSide), 'cloth');
    P.cavity = self._lit(new THREE.MeshStandardMaterial({
      color: 0x030303, roughness: 1, metalness: 0, side: THREE.DoubleSide
    }), 'hollow');
    P.gum = self._lit(new THREE.MeshStandardMaterial({ color: 0x2a1512, roughness: 0.88, metalness: 0 }), 'flesh');
    P.hair = self._lit(new THREE.MeshStandardMaterial({ color: 0x100d0b, roughness: 0.94, metalness: 0 }), 'hair');
    P.root = self._lit(new THREE.MeshStandardMaterial({ color: 0x5f5947, roughness: 0.96, metalness: 0 }), 'body', 0.7);
    P.sinew = self._lit(new THREE.MeshStandardMaterial({ color: 0x6d6450, roughness: 0.86, metalness: 0 }), 'flesh');
    /* 歯は1本ごとに色を変える（白く均一な歯列は禁止） */
    P.teeth = [0x7c7150, 0x655b3e, 0x877a57, 0x534930, 0x6f6446, 0x3f3722].map(function (hx) {
      /* 白く均一な歯列は禁止。粗さを上げて鏡面を殺し、闇での底上げも弱める */
      return self._lit(new THREE.MeshStandardMaterial({ color: hx, roughness: 0.88, metalness: 0 }), 'tooth', 0.55);
    });
    return P;
  }

  /* ================= 骨の基本部品（すべて親ノードのローカル空間に焼き込む） ================= */
  var _up = null, _v0 = null, _q0 = null, _m0 = null;
  function lazy() {
    if (_up) return;
    _up = new THREE.Vector3(0, 1, 0); _v0 = new THREE.Vector3();
    _q0 = new THREE.Quaternion(); _m0 = new THREE.Matrix4();
  }
  /** a→b に骨を立てる。中央が細く両端が膨らむ（骨幹と骨端）。bow で反らせる。 */
  function boneGeo(a, b, r, bow, seg, hseg) {
    lazy();
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
    var g = new THREE.CylinderGeometry(r, r, L, seg || 7, hseg || 4);
    var ar = g.attributes.position.array, i;
    for (i = 0; i < ar.length; i += 3) {
      var t = ar[i + 1] / (L / 2);
      var k = 0.58 + 0.42 * Math.pow(Math.abs(t), 2.4);
      k *= 1 + 0.10 * Math.sin(t * 7.0);
      ar[i] *= k; ar[i + 2] *= k * (1 - 0.16 * (1 - Math.abs(t)));
      ar[i] += (bow || 0) * L * (1 - t * t);
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals();
    g.translate(0, L / 2, 0);
    _q0.setFromUnitVectors(_up, _v0.set(dx / L, dy / L, dz / L));
    g.applyMatrix4(_m0.makeRotationFromQuaternion(_q0));
    g.translate(a[0], a[1], a[2]);
    return g;
  }
  /** 関節の瘤 */
  function knobGeo(p, r, seg) {
    var g = new THREE.SphereGeometry(r, seg || 6, Math.max(4, Math.round((seg || 6) * 0.72)));
    g.scale(1, 0.85, 1.05);
    g.translate(p[0], p[1], p[2]);
    return g;
  }
  /** 位置・回転・尺度を焼き込む */
  function place(g, p, r, s) {
    lazy();
    if (s) { if (typeof s === 'number') g.scale(s, s, s); else g.scale(s[0], s[1], s[2]); }
    if (r) g.applyMatrix4(_m0.makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2])));
    if (p) g.translate(p[0], p[1], p[2]);
    return g;
  }

  /* ================= 歯（1本ずつ不揃い・欠け・黄ばみ） ================= */
  function toothGeo(R, p, up, w, h, chip) {
    var g = chip > 0.6
      ? new THREE.ConeGeometry(w, h * 0.55, 4)
      : new THREE.CylinderGeometry(w * (0.55 + R() * 0.35), w, h, 4, 1);
    g.translate(0, -h / 2 * (up ? -1 : 1), 0);
    if (up) g.scale(1, -1, 1);
    return place(g, p, [(R() - 0.5) * 0.55, (R() - 0.5) * 1.2, (R() - 0.5) * 0.5]);
  }
  /** 歯列: arc(t)->[x,y,z] に n 本。miss の割合で欠ける。 */
  function teethRow(self, P, parent, n, arc, up, size, seed, miss, lod) {
    var R = rng(seed), i;
    for (i = 0; i < n; i++) {
      if (R() < (miss === undefined ? 0.16 : miss)) continue;
      var t = i / (n - 1), p = arc(t);
      var m = P.teeth[(R() * P.teeth.length) | 0];
      self._mesh(toothGeo(R, p, up, size[0] * (0.72 + R() * 0.62), size[1] * (0.6 + R() * 0.85), R()),
        m, parent, 'tooth', 1);
    }
  }

  /* ================= 頭蓋 =================
   * 原点＝頭の中心、正面 −Z。眼窩は「本物の穴」: 殻に窪みを彫って三角形を削り、
   * 奥に暗い筒を差し、周囲を隆起させて骨の縁を立てる（契約「ゲーム内の顔の実装規範」）。
   * opt: { seed, gape, slip, jaw, scale, chip, seg, slim, only:'jaw'|'calvaria', lod } */
  function buildSkull(self, P, parent, opt) {
    opt = opt || {};
    var R = rng(opt.seed || 5), G = new THREE.Group();
    parent.add(G);
    if (opt.scale) G.scale.setScalar(opt.scale);
    var rx = 0.080, ry = 0.098, rz = 0.110;
    var ch = opt.chip === undefined ? 1 : opt.chip;
    var slim = !!opt.slim, only = opt.only || '', lod = opt.lod || 0;
    var out = { group: G, jaw: null };

    if (only === 'calvaria') {                 /* 頭頂の割れた蓋だけの断片 */
      var cal = new THREE.SphereGeometry(1, 16, 10, 0.35, Math.PI * 1.15, 0, Math.PI * 0.48);
      cal.scale(rx, ry, rz); warp(cal, 0.004, 16, opt.seed || 5);
      self._mesh(cal, P.boneSkull, G, 'calvaria', lod);
      var cin = new THREE.SphereGeometry(1, 9, 6, 0.35, Math.PI * 1.15, 0, Math.PI * 0.48);
      cin.scale(rx * 0.90, ry * 0.90, rz * 0.90);
      self._mesh(cin, P.cavity, G, 'calvariaIn', lod);
      return out;
    }
    if (only === 'jaw') {                      /* 下顎だけの断片 */
      self._mesh(tube([
        [rx * 0.58, ry * 0.02, -rz * 0.30], [rx * 0.44, -ry * 0.03, -rz * 0.54],
        [0, -ry * 0.05, -rz * 0.62], [-rx * 0.44, -ry * 0.03, -rz * 0.52],
        [-rx * 0.56, ry * 0.02, -rz * 0.28]
      ], 0.0122, 5), P.boneDirty, G, 'jawArc', lod);
      [1, -1].forEach(function (s4) {
        self._mesh(tube([[s4 * rx * 0.54, 0.002, -rz * 0.36], [s4 * rx * 0.70, ry * 0.20, rz * 0.10]],
          0.0092, 4), P.boneDirty, G, 'ramus', lod);
      });
      teethRow(self, P, G, 11, function (t) {
        var a = (t - 0.5) * 2.38;
        return [Math.sin(a) * rx * 0.52, 0.007, -rz * 0.38 - Math.cos(a) * rz * 0.22];
      }, true, [0.0060, 0.0158], (opt.seed || 5) + 9, 0.34, lod);
      return out;
    }

    /* 眼窩の中心（左右で高さ・大きさを変える＝非対称） */
    var OR = [
      { c: [rx * 0.44, ry * 0.20, -rz * 0.64], r: 0.0320, s: 1 },
      { c: [-rx * 0.42, ry * 0.15, -rz * 0.66], r: 0.0345, s: -1 }
    ];
    var SEG = opt.seg || 26;
    function shape(x, y, z, o) {
      var ny = y / ry, nz = z / rz;
      var dn = Math.max(0, -ny), up = Math.max(0, ny), fw = Math.max(0, -nz);
      var t = Math.max(0, (dn - 0.52) / 0.48), col = 1 - 0.90 * t * t;
      o[0] = x * (1 - 0.34 * Math.pow(dn, 1.6)) * (1 - 0.24 * Math.pow(fw, 2.0)) * col;
      o[2] = (z * (nz > 0 ? 1.08 : 1.0) * (1 - 0.18 * Math.pow(dn, 1.9))
             + rz * 0.34 * up * up * fw) * col;
      o[1] = y - 0.18 * ry * Math.pow(dn, 2.0) + ry * 0.34 * t * t;
    }
    function shell(seg) {
    var v = new THREE.SphereGeometry(1, seg, Math.max(7, Math.round(seg * 0.68)));
    v.scale(rx, ry, rz);
    deform(v, shape);
    bulge(v, [0, ry * 0.50, -rz * 0.66], rx * 0.88, -0.0075);            /* 額を平らに */
    bulge(v, [rx * 0.36, ry * 0.66, -rz * 0.56], rx * 0.30, 0.0072);     /* 前頭隆起 右 */
    bulge(v, [-rx * 0.30, ry * 0.60, -rz * 0.58], rx * 0.26, 0.0044);    /* 左は弱い */
    bulge(v, [0, ry * 0.30, rz * 0.92], rx * 0.55, 0.0060);              /* 後頭隆起 */
    bulge(v, [rx * 0.98, ry * 0.16, -rz * 0.16], rx * 0.66, -0.0215);    /* 側頭窩 右 */
    bulge(v, [-rx * 0.97, ry * 0.10, -rz * 0.12], rx * 0.62, -0.0270);   /* 左は深い */
    if (!slim) {
      ridge(v, [rx * 0.06, ry * 0.94, -rz * 0.22], [rx * 0.05, ry * 0.34, rz * 0.88], rx * 0.09, -0.0028, 2.4);
      ridge(v, [rx * 0.99, ry * 0.36, -rz * 0.04], [-rx * 0.96, ry * 0.31, 0], rx * 0.09, -0.0026, 2.6);
      ridge(v, [rx * 0.78, ry * 0.08, rz * 0.64], [-rx * 0.66, ry * 0.22, rz * 0.68], rx * 0.10, -0.0024, 2.4);
      ridge(v, [rx * 0.22, ry * 0.64, -rz * 0.76], [rx * 0.94, ry * 0.38, -rz * 0.14], rx * 0.14, 0.0034, 2.1);
    }
    /* 眼窩: 浅く窪ませ、縁を隆起で立てる */
    OR.forEach(function (e) {
      var c = e.c, r = e.r, s = e.s;
      bulge(v, c, r * 1.70, -0.0130);
      ridge(v, [c[0] - s * r * 1.15, c[1] + r * 0.98, c[2] + 0.014],
        [c[0] + s * r * 1.15, c[1] + r * 0.86, c[2] + 0.006], r * 0.46, 0.0195, 2.3);
      ridge(v, [c[0] + s * r * 1.22, c[1] + r * 0.84, c[2] + 0.008],
        [c[0] + s * r * 1.10, c[1] - r * 0.80, c[2] + 0.022], r * 0.42, 0.0168, 2.3);
      ridge(v, [c[0] - s * r * 0.85, c[1] - r * 1.05, c[2] + 0.010],
        [c[0] + s * r * 1.00, c[1] - r * 0.92, c[2] + 0.018], r * 0.40, 0.0140, 2.4);
    });
    /* 眉弓（右は重く、左は欠ける＝非対称）・鼻根・梨状口・頬骨体 */
    ridge(v, [rx * 0.04, ry * 0.36, -rz * 0.78], [rx * 0.82, ry * 0.30, -rz * 0.36], rx * 0.22, 0.0185, 1.6);
    ridge(v, [-rx * 0.05, ry * 0.33, -rz * 0.78], [-rx * 0.46, ry * 0.31, -rz * 0.64], rx * 0.17, 0.0104, 1.8);
    ridge(v, [0.001, ry * 0.30, -rz * 0.78], [0.002, ry * 0.04, -rz * 0.86], rx * 0.10, 0.0040, 2.6);
    bulge(v, [0.002, ry * 0.32, -rz * 0.80], rx * 0.10, -0.0082);
    bulge(v, [0.002, -ry * 0.12, -rz * 0.80], rx * 0.22, -0.0230);
    bulge(v, [rx * 0.86, -ry * 0.20, -rz * 0.52], rx * 0.34, 0.0110);
    bulge(v, [-rx * 0.82, -ry * 0.26, -rz * 0.50], rx * 0.30, 0.0086);
    /* 欠け・ひび */
    bulge(v, [-rx * 0.60, ry * 0.74, rz * 0.28], rx * 0.26, -0.0230 * ch);
    bulge(v, [rx * 0.40, ry * 0.26, rz * 0.90], rx * 0.17, -0.0150 * ch);
    ridge(v, [-rx * 0.50, ry * 0.80, rz * 0.10], [-rx * 0.10, ry * 0.42, -rz * 0.58], rx * 0.045, -0.0090 * ch, 2.8);
    ridge(v, [rx * 0.70, ry * 0.62, rz * 0.40], [rx * 0.30, ry * 0.86, -rz * 0.20], rx * 0.038, -0.0075 * ch, 2.8);
    warp(v, 0.0024, 19, opt.seed || 5);
    punch(v, [
      { c: [OR[0].c[0], OR[0].c[1], -rz * 0.62], r: [0.0215, 0.0180, 0.060] },
      { c: [OR[1].c[0], OR[1].c[1], -rz * 0.62], r: [0.0228, 0.0192, 0.060] },
      { c: [0.001, ry * 0.02, -rz * 0.62], r: [0.0058, 0.0120, 0.060] },
      { c: [0.001, -ry * 0.10, -rz * 0.62], r: [0.0094, 0.0115, 0.060] },
      { c: [0.001, -ry * 0.20, -rz * 0.62], r: [0.0124, 0.0100, 0.060] }
    ]);
    return v;
    }
    var v = shell(SEG);
    var shellMesh = self._mesh(v, P.boneSkull, G, 'calvarium');
    /* 主頭蓋だけ低詳細用の粗い殻を持つ（遠景では丸みだけ残ればよい） */
    if (opt.swapLo) {
      var vLo = shell(16);
      self._track(vLo);
      var hiT = v.index.count / 3, loT = vLo.index.count / 3;
      self.lodSwap.push({ m: shellMesh, hi: v, lo: vLo });
      self.loTriangles += loT - hiT;
    }
    var inn = new THREE.SphereGeometry(1, slim ? 7 : 12, slim ? 5 : 9);
    inn.scale(rx, ry, rz); deform(inn, shape); inn.scale(0.90, 0.90, 0.90);
    self._mesh(inn, P.cavity, G, 'skullVoid');
    out.sockets = OR; out.r = [rx, ry, rz];
    buildSkullFace(self, P, G, opt, OR, rx, ry, rz, R, slim, lod, out);
    return out;
  }

  /** 頭蓋の顔まわり: 眼窩の筒と縁・頬骨弓・上顎と歯・下顎・乾いた皮膚 */
  function buildSkullFace(self, P, G, opt, OR, rx, ry, rz, R, slim, lod, out) {
    var i;
    for (i = 0; i < OR.length; i++) {
      var e = OR[i], c = e.c, w = i ? 0.0228 : 0.0215;
      /* 眼窩の奥＝完全な黒の内壁（覗いた先は闇） */
      var tin = new THREE.CylinderGeometry(w * 1.02, w * 0.44, 0.046, 10, 1, true);
      tin.rotateX(Math.PI / 2);
      self._mesh(place(tin, [c[0], c[1], -rz * 0.58], [0.12, -e.s * 0.28, 0], [1, 0.86, 1]),
        P.cavity, G, 'socket' + i);
      /* 立った骨の縁（眼窩縁）。穴の切り口も隠す */
      var rim = new THREE.TorusGeometry(w * 1.02, w * 0.112, 4, slim ? 10 : 16);
      rim.scale(1, 0.88, 0.50);
      self._mesh(place(rim, [c[0], c[1], -rz * 0.795], [0.13, -e.s * 0.30, e.s * 0.08]),
        P.boneSkull, G, 'orbitRim' + i);
      out['socket' + i] = [c[0], c[1], -rz * 0.66];
    }
    /* 頬骨弓: 殻に沿わせた細い橋（下に隙間ができる＝本物の頭蓋の決め手） */
    if (!slim) [1, -1].forEach(function (s2) {
      self._mesh(tube([
        [s2 * rx * 0.70, -ry * 0.10, -rz * 0.44], [s2 * rx * 0.86, -ry * 0.02, -rz * 0.12],
        [s2 * rx * 0.84, ry * 0.10, rz * 0.18]
      ], 0.0033 * (s2 > 0 ? 1 : 0.80), 4), P.boneSkull, G, 'zygoma', lod);
    });
    /* 上顎（歯槽突起）と歯 */
    var mx = new THREE.SphereGeometry(1, slim ? 9 : 16, slim ? 6 : 11);
    mx.scale(rx * 0.60, ry * 0.24, rz * 0.42);
    deform(mx, function (x, y, z, o) { o[2] = z * (z < 0 ? 1.02 : 0.74); o[1] = y * (y < 0 ? 1.2 : 0.9); });
    bulge(mx, [0, -ry * 0.22, -rz * 0.34], rx * 0.26, -0.0055);
    bulge(mx, [rx * 0.34, -ry * 0.04, -rz * 0.30], rx * 0.20, -0.0072);
    bulge(mx, [-rx * 0.30, -ry * 0.08, -rz * 0.28], rx * 0.18, -0.0058);
    warp(mx, 0.0022, 21, (opt.seed || 5) + 2);
    self._mesh(place(mx, [0.002, -ry * 0.52, -rz * 0.22]), P.boneSkull, G, 'maxilla', slim ? 1 : 0);
    self._mesh(tube([[rx * 0.54, -ry * 0.62, -rz * 0.36], [0, -ry * 0.64, -rz * 0.52],
      [-rx * 0.52, -ry * 0.66, -rz * 0.34]], 0.0090, 4), P.gum, G, 'gumUp', lod);
    teethRow(self, P, G, 11, function (t) {
      var a = (t - 0.5) * 2.45;
      return [Math.sin(a) * rx * 0.58, -ry * 0.68, -rz * 0.30 - Math.cos(a) * rz * 0.26];
    }, false, [0.0064, 0.0182], (opt.seed || 5) + 3, 0.22);
    /* 下顎（別ノード＝カタカタ揺れる。主頭蓋はずれて開く） */
    if (opt.jaw !== false) {
      var J = new THREE.Group();
      J.name = 'jaw';
      G.add(J);
      self._mesh(tube([
        [rx * 0.58, ry * 0.02, -rz * 0.30], [rx * 0.44, -ry * 0.03, -rz * 0.54],
        [0, -ry * 0.05, -rz * 0.62], [-rx * 0.44, -ry * 0.03, -rz * 0.52],
        [-rx * 0.56, ry * 0.02, -rz * 0.28]
      ], 0.0125, 5), P.boneSkull, J, 'jawArc');
      [1, -1].forEach(function (s3) {
        self._mesh(tube([[s3 * rx * 0.54, 0.002, -rz * 0.36], [s3 * rx * 0.70, ry * 0.20, rz * 0.10],
          [s3 * rx * 0.64, ry * 0.34, rz * 0.26]], 0.0090 * (s3 > 0 ? 1 : 0.88), 4), P.boneSkull, J, 'ramus');
      });
      teethRow(self, P, J, 11, function (t) {
        var a = (t - 0.5) * 2.38;
        return [Math.sin(a) * rx * 0.52, 0.007, -rz * 0.38 - Math.cos(a) * rz * 0.22];
      }, true, [0.0060, 0.0158], (opt.seed || 5) + 9, 0.28);
      self._mesh(knobGeo([rx * 0.64, ry * 0.34, rz * 0.26], 0.0085, 6), P.boneSkull, J, 'condyle', lod);
      self._mesh(knobGeo([-rx * 0.62, ry * 0.34, rz * 0.26], 0.0080, 6), P.boneSkull, J, 'condyle', lod);
      J.position.set((opt.slip === undefined ? 0.014 : opt.slip), -ry * 0.54, rz * 0.04);
      J.rotation.set(-(opt.gape === undefined ? 0.42 : opt.gape), (opt.slip ? 0.18 : 0.10), 0.15);
      J.userData.base = [J.rotation.x, J.rotation.y, J.rotation.z];
      out.jaw = J;
      /* 喉の闇 */
      var th = new THREE.SphereGeometry(0.032, slim ? 7 : 10, slim ? 5 : 8);
      self._mesh(place(th, [0.004, -ry * 0.78, -rz * 0.22], null, [1, 1, 0.85]), P.cavity, G, 'throat', slim ? 1 : 0);
    }
    if (slim) return;
    /* 骨に張り付いた羊皮紙状の皮膚と腱（3か所・非対称） */
    var pc = new THREE.SphereGeometry(1, 10, 7, Math.PI * 0.72, Math.PI * 0.56, Math.PI * 0.20, Math.PI * 0.40);
    pc.scale(rx * 1.03, ry * 1.03, rz * 1.03);
    self._mesh(place(pc, null, [0, 0, 0.25]), P.dry, G, 'scalp', lod);
    self._mesh(tube([[rx * 0.76, -ry * 0.24, -rz * 0.42], [rx * 0.84, -ry * 0.48, -rz * 0.14],
      [rx * 0.60, -ry * 0.66, rz * 0.08]], 0.0032, 4), P.sinew, G, 'sinew', lod);
    var flap = new THREE.PlaneGeometry(0.030, 0.046, 2, 3);
    warp(flap, 0.006, 40, 31);
    self._mesh(place(flap, [rx * 0.72, -ry * 0.36, -rz * 0.46], [0.15, -0.85, 0.22]), P.dry, G, 'flap', lod);
    var flap2 = new THREE.PlaneGeometry(0.024, 0.034, 2, 2);
    warp(flap2, 0.005, 44, 37);
    self._mesh(place(flap2, [-rx * 0.66, -ry * 0.20, -rz * 0.50], [-0.10, 0.75, -0.30]), P.dry, G, 'flap', lod);
  }

  /* ================= 手・足・肢 ================= */
  /** 指（3節）。dir 方向へ伸ばし、curl で壁を掴むように曲げる。 */
  function finger(self, mat, parent, root, dir, L, r, curl, lod) {
    var p = root.slice(), d = dir.slice(), i, segs = [0.42, 0.33, 0.25];
    for (i = 0; i < 3; i++) {
      var l = L * segs[i];
      var n = [p[0] + d[0] * l, p[1] + d[1] * l, p[2] + d[2] * l];
      self._mesh(boneGeo(p, n, r * (1 - i * 0.20), 0, 3, 1), mat, parent, 'phal', 1);
      p = n;
      d[1] -= curl;
      var dl = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
      d[0] /= dl; d[1] /= dl; d[2] /= dl;
    }
  }
  /** 手: 掌の小骨＋5指。壁を掴む。 */
  function hand(self, mat, parent, size, seed, curl, lod) {
    var R = rng(seed), i;
    var pal = new THREE.SphereGeometry(1, 7, 5);
    pal.scale(size * 0.34, size * 0.13, size * 0.30);
    self._mesh(pal, mat, parent, 'palm', 1);
    for (i = 0; i < 5; i++) {
      var a = (i / 4 - 0.5) * 1.55 + (R() - 0.5) * 0.22;
      var dir = [Math.sin(a) * 0.42, -0.12 + (R() - 0.5) * 0.2, -Math.cos(a) * 0.9];
      var dl = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
      dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
      finger(self, mat, parent, [dir[0] * size * 0.26, 0, dir[2] * size * 0.26], dir,
        size * (0.78 + R() * 0.34), size * 0.052 * (i === 0 ? 1.25 : 1),
        curl === undefined ? 0.42 : curl, lod);
    }
  }
  /** 足: 踵＋短い趾 */
  function foot(self, mat, parent, size, seed, lod) {
    var R = rng(seed), i;
    var hl = new THREE.SphereGeometry(1, 7, 5);
    hl.scale(size * 0.22, size * 0.20, size * 0.26);
    self._mesh(place(hl, [0, 0, size * 0.16]), mat, parent, 'heel', 1);
    for (i = 0; i < 5; i++) {
      var a = (i / 4 - 0.5) * 0.95;
      var dir = [Math.sin(a) * 0.4, -0.30, -Math.cos(a) * 0.86];
      finger(self, mat, parent, [dir[0] * size * 0.1, 0, -size * 0.06], dir,
        size * (0.60 + R() * 0.22), size * 0.048, 0.34, lod);
    }
  }

  /** 肢1本: 上腕→前腕→（手/足）。骨端の瘤と腱つき。歩容のためノードで分節する。 */
  function limb(self, P, parent, o, idx) {
    var mat = o.child ? P.boneChild : (o.dirty ? P.boneDirty : P.bone);
    var a = o.a, b = o.b, c = o.c;
    var root = new THREE.Group();
    root.name = 'limb' + idx;
    root.position.set(a[0], a[1], a[2]);
    parent.add(root);
    self.limbs.push({ root: root, elbow: null, tip: null, seed: (o.seed || 3) });
    var L = self.limbs[self.limbs.length - 1];
    var d1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    self._mesh(boneGeo([0, 0, 0], d1, o.r0, o.bow0 === undefined ? 0.03 : o.bow0, 6, 3), mat, root, 'humerus');
    self._mesh(knobGeo([0, 0, 0], o.r0 * 1.5, 6), mat, root, 'knobA');
    self._mesh(tube([[-o.r0, 0, 0], [d1[0] / 2 - o.r0 * 1.4, d1[1] / 2, d1[2] / 2 - o.r0],
      [d1[0] - o.r0 * 0.6, d1[1], d1[2]]], o.r0 * 0.22, 4), P.sinew, root, 'sinew', 1);
    var elb = new THREE.Group();
    elb.name = 'limb' + idx + 'E';
    elb.position.set(d1[0], d1[1], d1[2]);
    root.add(elb);
    L.elbow = elb;
    var d2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    self._mesh(boneGeo([0, 0, 0], d2, o.r1, o.bow1 === undefined ? -0.02 : o.bow1, 6, 3), mat, elb, 'ulna');
    self._mesh(knobGeo([0, 0, 0], o.r0 * 1.42, 6), mat, elb, 'knobB');
    var tip = new THREE.Group();
    tip.name = 'limb' + idx + 'T';
    tip.position.set(d2[0], d2[1], d2[2]);
    if (o.aim) tip.rotation.set(o.aim[0], o.aim[1], o.aim[2]);
    elb.add(tip);
    L.tip = tip;
    if (o.hand) hand(self, mat, tip, o.hand, o.seed || 3, o.curl, 1);
    if (o.foot) foot(self, mat, tip, o.foot, o.seed || 5, 1);
    self.contacts.push(tip);
    return L;
  }

  /** 肋郭: 脊柱から前方へ弧を描く肋骨を n 対。折れた肋骨を混ぜる。 */
  function ribcage(self, mat, parent, o) {
    var G = new THREE.Group(), R = rng(o.seed || 21), i, s;
    G.position.set(o.p[0], o.p[1], o.p[2]);
    if (o.rot) G.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
    if (o.scale) G.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    parent.add(G);
    for (i = 0; i < o.n; i++) {
      var t = i / (o.n - 1);
      var y = -t * o.h, w = o.w * (0.52 + Math.sin((0.15 + t * 0.82) * Math.PI) * 0.66);
      var dep = o.d * (0.55 + Math.sin((0.1 + t * 0.9) * Math.PI) * 0.60);
      for (s = -1; s <= 1; s += 2) {
        var brk = R() < 0.16;
        var pts = [[0, y, 0], [s * w * 0.42, y - 0.012, -dep * 0.42], [s * w * 0.86, y - 0.038, -dep * 0.86],
          [s * w * 0.80, y - 0.085, -dep * 1.20], [s * w * 0.34, y - 0.105, -dep * 1.36]];
        if (brk) pts = pts.slice(0, 3);
        self._mesh(tube(pts, o.r * (0.78 + R() * 0.5), 4, 1.6), mat, G, 'rib',
          o.lod || ((i % 2) ? 1 : 0));
      }
    }
    return G;
  }

  /** 脊柱: 椎体＋棘突起 */
  function spine(self, mat, parent, pts, r, n) {
    var v = [], i;
    for (i = 0; i < pts.length; i++) v.push(new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2]));
    var cu = new THREE.CatmullRomCurve3(v);
    for (i = 0; i < n; i++) {
      var t = i / (n - 1), p = cu.getPoint(t), tg = cu.getTangent(t);
      lazy();
      var body = new THREE.CylinderGeometry(r * 0.96, r, r * 1.15, 6);
      _q0.setFromUnitVectors(_up, tg);
      body.applyMatrix4(_m0.makeRotationFromQuaternion(_q0));
      body.translate(p.x, p.y, p.z);
      self._mesh(body, mat, parent, 'vertebra');
      var sp = new THREE.ConeGeometry(r * 0.42, r * 1.9, 4);
      sp.translate(0, r * 0.95, 0);
      self._mesh(place(sp, [p.x + r * 1.0, p.y + r * 0.2, p.z + r * 1.05],
        [1.15 + 0.1 * Math.sin(i), 0, -0.7]), mat, parent, 'spinous', 1);
    }
  }

  /* ================================================================
   * EnemyF — 本体
   * ============================================================== */
  var PIVOT = [0.70, 0, 0.45];     /* 模型座標のどの点を group 原点に置くか */
  var WALL_REACH = 1.55;           /* この距離までの壁を探す(m) */

  function EnemyF(opts) {
    opts = opts || {};
    this.kind = 'F';
    this.seed = opts.seed || 1;
    this.group = new THREE.Group();
    this.group.name = 'enemyF';
    this.nodes = {};
    this.mats = {};
    this.contacts = [];
    this.disposables = [];
    this.litMats = [];
    this.lodHi = [];                /* 低詳細で消す飾り */
    this.lodSwap = [];              /* {m,hi,lo} 低詳細で粗い殻へ差し替える */
    this._forceLod = 0;
    this.limbs = [];
    this.skulls = [];
    this.triangles = 0;
    this.loTriangles = 0;           /* 低詳細で残る三角形（_build 後に確定） */
    this.extraTriangles = 0;
    this._countExtra = false;
    this.detail = 'normal';
    this.detailHi = false;
    this.lowDetail = false;
    this.poseT = 0;
    this.state = 'idle';
    this.transDir = 1;
    this.transTime = 0;
    this.transDur = 0.90;           /* 契約: 壁から剥がれ落ちる 0.9 秒 */
    this.animTime = 0;
    this.groundSnap = false;
    this.facing = 0;
    this.x = 0; this.z = 0; this.floorY = 0;
    this.ceilFit = true;
    this.ceilH = 2.40;
    this.map = null;
    this.scale = 1;
    this.poseExtra = null;
    this.skirtReach = 0.7;
    /* 壁への張り付き。wallT=0 は「掛ける壁が見つからない」＝床で身を屈める */
    this.wallYaw = 0; this.wallDist = 0.9; this.wallT = 0;
    this._wallYawSm = 0; this._wallTSm = 0; this._wallDSm = 0.9;
    this._amb = { r: 0.02, g: 0.02, b: 0.03 };
    this._shadeOut = [0, 0, 0];
    this._pose = {};
    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this.eyes = null; this.eyeSprites = null;
    this.grabHands = null; this.maw = null;
    this._build();
    this.applyPose(0);
  }

  EnemyF.prototype._track = function (o) { this.disposables.push(o); return o; };
  /**
   * 材質を「暗がりの見え方」の系統に登録する（syncLight が毎フレーム emissive を書く）。
   * 絵柄を持つ材質は emissiveMap が下限光を濁らせるが、単色の材質は
   * そのままだと「黒い髪が灰色に光る」＝明暗の関係が反転する。
   * そこで単色材質だけ、下限光を自分のアルベドに比例させる（中間色 0.20 を基準）。
   */
  EnemyF.prototype._lit = function (mat, prof, k) {
    mat.userData.a2lit = prof;
    var g = (k === undefined ? 1 : k);
    if (!mat.map) {
      var c = mat.color;            /* three は linear-sRGB で保持している */
      var lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      g *= Math.min(1, lum / 0.20);
    }
    mat.userData.a2k = g;
    this.litMats.push(mat); this._track(mat); return mat;
  };
  /** lod=1 のメッシュは setDetail('low') で消える飾り */
  EnemyF.prototype._mesh = function (geo, mat, parent, name, lod) {
    var m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    if (name) m.name = name;
    parent.add(m);
    this._track(geo);
    var tri = geo.index ? (geo.index.count / 3) : (geo.attributes.position.count / 3);
    var hide = lod || this._forceLod;
    if (this._countExtra) this.extraTriangles += tri;
    else { this.triangles += tri; if (!hide) this.loTriangles += tri; }
    if (hide) this.lodHi.push(m);
    return m;
  };
  EnemyF.prototype._node = function (name, parent, x, y, z) {
    var g = new THREE.Group();
    g.name = name;
    g.position.set(x || 0, y || 0, z || 0);
    parent.add(g);
    this.nodes[name] = g;
    return g;
  };

  /* ---------------- 組み立て ---------------- */
  EnemyF.prototype._build = function () {
    var P = this.mats = buildMats(this), self = this, i;
    var R = rng(this.seed * 101 + 7);
    /* 壁向き → 剥がれ落ち → 呼吸 → 模型 の4段。形態はすべてこの3ノードで表す */
    var wall = this._node('wall', this.group, 0, 0, 0);
    var fall = this._node('fall', wall, 0, 0, 0);
    var body = this._node('body', fall, 0, 0, 0);
    var rig = this._node('rig', body, -PIVOT[0], -PIVOT[1], -PIVOT[2]);

    /* ===== 脊柱（棘突起が壁と反対＝手前に立つ）と骨盤 ===== */
    var sp = [[0.84, 0.56, 0.96], [0.79, 0.95, 0.64], [0.72, 1.33, 0.30], [0.63, 1.70, 0.04], [0.55, 1.93, -0.14]];
    spine(this, P.bone, rig, sp, 0.030, 14);
    var pel = new THREE.TorusGeometry(0.105, 0.030, 5, 12, Math.PI * 1.5);
    this._mesh(place(pel, [0.82, 0.57, 0.94], [1.25, -0.5, 0.4], [1, 0.78, 1]), P.boneDirty, rig, 'pelvis');
    this._mesh(place(new THREE.SphereGeometry(0.052, 9, 7), [0.84, 0.62, 0.93], null, [1, 1.2, 0.7]),
      P.boneDirty, rig, 'sacrum');

    /* ===== 肋郭3つ（噛み合う） ===== */
    ribcage(this, P.bone, rig, { n: 10, h: 0.60, w: 0.19, d: 0.20, r: 0.0115, seed: 21,
      p: [0.63, 1.74, 0.02], rot: [0.28, -1.57, -0.40] });
    ribcage(this, P.boneDirty, rig, { n: 8, h: 0.40, w: 0.145, d: 0.15, r: 0.0092, seed: 37,
      p: [0.74, 1.28, 0.44], rot: [1.05, -2.35, 0.62], scale: [1, 1, 1.1] });
    ribcage(this, P.boneChild, rig, { n: 7, h: 0.30, w: 0.105, d: 0.112, r: 0.0072, seed: 61,
      p: [0.59, 1.20, 0.00], rot: [-0.62, -0.95, 0.42], lod: 1 });
    /* 鎖骨2本（非対称） */
    this._mesh(boneGeo([0.58, 1.84, -0.06], [0.66, 1.78, 0.26], 0.011, 0.06, 6, 3), P.bone, rig, 'clavicle');
    this._mesh(boneGeo([0.58, 1.83, -0.08], [0.55, 1.74, -0.30], 0.0095, -0.05, 6, 3), P.bone, rig, 'clavicle');

    /* ===== 肢12本（大人と子供／2本は逆向きの関節） ===== */
    var LIMBS = [
      { a: [0.60, 1.80, -0.02], b: [0.82, 2.14, 0.14], c: [0.93, 2.20, 0.00],
        r0: 0.036, r1: 0.028, hand: 0.10, aim: [0.5, -1.35, 0.4], seed: 3, curl: 0.5 },
      { a: [0.67, 1.66, 0.30], b: [0.46, 1.29, -0.32], c: [0.90, 1.33, -0.28],
        r0: 0.035, r1: 0.026, bow1: 0.06, hand: 0.095, aim: [0.1, -1.6, -0.2], seed: 7, curl: 0.55 },
      { a: [0.69, 1.46, 0.08], b: [0.50, 1.28, -0.36], c: [0.37, 1.12, -0.55],
        r0: 0.020, r1: 0.015, child: true, hand: 0.058, aim: [-0.5, -0.6, 0.5], seed: 11, curl: 0.22 },
      { a: [0.75, 1.54, 0.62], b: [0.87, 1.12, 0.87], c: [0.82, 0.73, 0.93],
        r0: 0.031, r1: 0.024, dirty: true, hand: 0.088, aim: [0.9, -0.3, 0.2], seed: 13, curl: 0.15 },
      { a: [0.80, 0.99, 0.71], b: [0.60, 0.62, 0.28], c: [0.92, 0.41, 0.26],
        r0: 0.041, r1: 0.031, foot: 0.11, aim: [-0.35, -1.5, 0.3], seed: 17 },
      { a: [0.78, 0.93, 0.86], b: [0.91, 0.49, 1.27], c: [0.93, 0.19, 0.85],
        r0: 0.037, r1: 0.029, dirty: true, foot: 0.10, aim: [0.5, -1.5, -0.3], seed: 19 },
      { a: [0.85, 0.85, 1.00], b: [0.95, 0.62, 1.24], c: [0.94, 0.34, 1.31],
        r0: 0.022, r1: 0.017, child: true, foot: 0.062, aim: [0.2, -1.5, 0.0], seed: 23 },
      { a: [0.72, 1.62, 0.46], b: [0.88, 1.92, 0.62], c: [0.95, 2.00, 0.46],
        r0: 0.023, r1: 0.018, child: true, hand: 0.062, aim: [0.4, -1.5, 0.5], seed: 29, curl: 0.5 },
      { a: [0.74, 1.04, 0.28], b: [0.52, 0.68, -0.20], c: [0.41, 0.38, -0.40],
        r0: 0.036, r1: 0.028, dirty: true, foot: 0.098, aim: [-0.9, -0.9, 0.4], seed: 31 },
      { a: [0.82, 0.76, 0.44], b: [0.70, 0.50, 0.16], c: [0.90, 0.33, 0.44],
        r0: 0.020, r1: 0.015, child: true, foot: 0.058, aim: [0.3, -1.5, -0.2], seed: 37 },
      { a: [0.80, 0.66, 0.02], b: [0.88, 0.58, -0.05], c: [0.94, 0.48, -0.14],
        r0: 0.022, r1: 0.020, dirty: true, hand: 0.086, aim: [0.2, -1.6, 0.1], seed: 41, curl: 0.5 },
      { a: [0.71, 1.30, 0.74], b: [0.64, 1.17, 0.86], c: [0.56, 1.03, 0.97],
        r0: 0.024, r1: 0.020, dirty: true, aim: [1.0, 0.4, 0.6], seed: 43 }
    ];
    for (i = 0; i < LIMBS.length; i++) limb(this, P, rig, LIMBS[i], i);
    /* 折れた腕の断面（最後の肢は手が無い＝骨の断口） */
    this._mesh(place(new THREE.ConeGeometry(0.026, 0.035, 5), [0.55, 1.01, 0.99], [1.0, 0.4, 0.6]),
      P.cavity, rig, 'stump');
    this._buildHeads(P, rig, R);
    this._buildTissue(P, rig, R);
    this._measure();
  };

  /* ---------------- 頭蓋8個＋断片2（契約 P5e-1「顔を増やして複雑に」） ---------------- */
  var HEAD_BASE = [-0.22, 0.14];   /* 主頭蓋の基準の傾き（yaw は毎フレーム決める） */

  EnemyF.prototype._buildHeads = function (P, rig, R) {
    var self = this, i;
    /* 主頭蓋: 首の先。顔は常に group の前方（−Z）＝プレイヤー側を向く（_aimHead） */
    var neck = this._node('neck', rig, 0.56, 1.92, -0.10);
    this._mesh(boneGeo([0, -0.02, 0], [-0.05, 0.05, -0.08], 0.026, 0, 7, 3), P.bone, neck, 'cervical');
    var head = this._node('head', neck, -0.06, 0.10, -0.10);
    var hA = buildSkull(this, P, head, { seed: 5, gape: 0.42, slip: 0.018, seg: 48, swapLo: true });
    this.mainSkull = hA;
    this.nodes.headScale = hA.group;
    this.skulls.push({ n: head, jaw: hA.jaw, f: 6.1, g: 4.3, a: 1.0, main: 1 });

    /* 残りの頭蓋。位置・向き・大きさ・状態をばらす（大人・子供・欠けた半分・下顎だけ） */
    var SK = [
      { p: [0.66, 1.79, 0.28], r: [-0.72, 2.15, 1.30], o: { seed: 41, gape: 0.14, slip: -0.010, chip: 1.5, scale: 0.90, seg: 22 },
        bury: [0.70, 1.72, 0.35], br: [0.120, 0.105, 0.130], bs: 9 },
      { p: [0.49, 1.33, 0.30], r: [0.30, 1.05, 2.55], o: { seed: 71, gape: 0.34, slip: 0.02, chip: 1.3, scale: 0.86, seg: 22 },
        bury: [0.56, 1.30, 0.36], br: [0.105, 0.098, 0.105], bs: 4 },
      { p: [0.64, 1.56, -0.10], r: [0.36, 0.80, -1.05], o: { seed: 23, gape: 0.50, slip: 0.012, chip: 1.2, scale: 0.62, seg: 18, slim: true },
        bury: [0.68, 1.52, 0.00], br: [0.056, 0.050, 0.058], bs: 11 },
      { p: [0.55, 1.10, 0.06], r: [1.05, 1.85, 0.70], o: { seed: 57, jaw: false, chip: 2.6, scale: 0.92, seg: 18, slim: true },
        bury: [0.61, 1.07, 0.14], br: [0.078, 0.070, 0.076], bs: 13 },
      { p: [0.61, 0.92, 0.26], r: [-0.45, 1.10, 2.25], o: { seed: 83, only: 'jaw', scale: 1.05 } },
      { p: [0.70, 0.78, 0.02], r: [0.25, 0.30, 2.45], o: { seed: 97, jaw: false, chip: 1.8, scale: 0.48, seg: 14, slim: true },
        bury: [0.73, 0.76, 0.07], br: [0.042, 0.038, 0.042], bs: 10 },
      { p: [0.60, 1.40, 0.36], r: [-1.25, 0.20, 0.30], o: { only: 'calvaria', seed: 31, scale: 0.88 } },
      { p: [0.50, 1.44, -0.18], r: [-0.10, 1.55, -0.55], o: { seed: 113, gape: 0.30, slip: -0.020, chip: 1.6, scale: 0.80, seg: 18, slim: true },
        bury: [0.56, 1.42, -0.10], br: [0.066, 0.060, 0.066], bs: 17 },
      { p: [0.58, 0.62, 0.04], r: [0.22, 1.20, -2.30], o: { seed: 127, gape: 0.44, chip: 1.4, scale: 0.56, seg: 14, slim: true },
        bury: [0.63, 0.64, 0.10], br: [0.048, 0.044, 0.048], bs: 19 }
    ];
    for (i = 0; i < SK.length; i++) {
      var s = SK[i];
      var nd = new THREE.Group();
      nd.name = 'skull' + (i + 1);
      nd.position.set(s.p[0], s.p[1], s.p[2]);
      nd.rotation.set(s.r[0], s.r[1], s.r[2]);
      nd.userData.base = [s.r[0], s.r[1], s.r[2]];
      rig.add(nd);
      /* 低詳細では肩の1個だけ残し、他は乾いた肉の玉（bury）が輪郭を引き継ぐ */
      this._forceLod = (i >= 1) ? 1 : 0;
      var sk = buildSkull(this, P, nd, s.o);
      this._forceLod = 0;
      this.skulls.push({ n: nd, jaw: sk.jaw, f: 5.0 + i * 0.77, g: 3.1 + i * 0.53, a: 0.55 + (i % 3) * 0.22 });
      if (s.bury) {
        this._mesh(place(warpBall(s.br[0], s.br[1], s.br[2], s.bs, 10), s.bury), P.dry, rig, 'bury', 0);
      }
    }
    /* 下胴の乾いた肉のかたまり（骨の山を一体にまとめる＝「一体の怪物」） */
    this._mesh(place(warpBall(0.150, 0.185, 0.145, 23, 12), [0.74, 0.96, 0.44]), P.dry, rig, 'mass');
    this._mesh(place(warpBall(0.115, 0.140, 0.110, 29, 12), [0.70, 1.38, 0.24]), P.dryWet, rig, 'mass');
  };

  /* ---------------- 背骨1本の芯・膜・腱・髪・布・根 ---------------- */
  EnemyF.prototype._buildTissue = function (P, rig, R) {
    var i, t0, u;
    /* 全部を癒合させる乾いた組織の鞘（これが無いと「骨の山」に見える） */
    var core = tube([[0.84, 0.58, 0.94], [0.80, 0.96, 0.62], [0.73, 1.34, 0.30],
      [0.64, 1.71, 0.04], [0.56, 1.92, -0.12]], 0.066, 8, 2.4);
    warp(core, 0.016, 11, 5);
    this._mesh(core, P.dry, rig, 'sheath');
    var core2 = tube([[0.80, 0.74, 0.72], [0.72, 1.16, 0.40], [0.66, 1.55, 0.16]], 0.036, 7, 2.4);
    warp(core2, 0.013, 14, 12);
    this._mesh(core2, P.dryWet, rig, 'sheath2');

    /* 乾いた皮膚の膜（骨の隙間に張る） */
    var WEB = [
      [[0.64, 1.74, 0.02], [0.66, 1.46, 0.14], [0.80, 1.62, 0.26], 0.035],
      [[0.68, 1.62, 0.28], [0.58, 1.42, -0.02], [0.72, 1.40, 0.20], 0.05],
      [[0.79, 0.98, 0.72], [0.70, 0.78, 0.48], [0.82, 0.74, 0.84], 0.04],
      [[0.80, 0.92, 0.86], [0.88, 0.70, 1.06], [0.86, 0.90, 1.00], 0.04],
      [[0.58, 1.88, -0.08], [0.74, 1.74, 0.26], [0.64, 1.72, 0.04], 0.025],
      [[0.62, 1.72, 0.02], [0.78, 1.52, 0.04], [0.70, 1.60, 0.30], 0.035],
      [[0.78, 1.50, 0.00], [0.66, 1.30, 0.10], [0.80, 1.28, 0.26], 0.035],
      [[0.62, 1.06, 0.26], [0.74, 1.22, 0.44], [0.66, 1.30, 0.14], 0.035],
      [[0.76, 0.82, 0.60], [0.86, 0.72, 0.32], [0.80, 0.96, 0.46], 0.035],
      [[0.58, 1.60, 0.52], [0.68, 1.48, 0.34], [0.62, 1.68, 0.30], 0.035],
      [[0.74, 1.62, 0.46], [0.62, 1.78, 0.22], [0.72, 1.80, 0.44], 0.035]
    ];
    for (i = 0; i < WEB.length; i++) {
      this._mesh(webGeo(WEB[i][0], WEB[i][1], WEB[i][2], WEB[i][3]),
        i % 2 ? P.dry : P.dryWet, rig, 'web', i > 4 ? 1 : 0);
    }
    /* 腱（骨に張り付いた乾いた筋） */
    for (i = 0; i < 7; i++) {
      t0 = 0.15 + i * 0.11;
      this._mesh(tube([
        [0.60 + R() * 0.1, 1.90 - t0 * 1.2, -0.10 + t0 * 0.7],
        [0.72 + R() * 0.12, 1.80 - t0 * 1.3, 0.02 + t0 * 0.8],
        [0.84 + R() * 0.08, 1.66 - t0 * 1.25, 0.16 + t0 * 0.75]], 0.0045 + R() * 0.004, 4, 1.6),
        P.sinew, rig, 'sinew', 1);
    }
    for (i = 0; i < 9; i++) {
      u = i / 8;
      this._mesh(tube([
        [0.58 + R() * 0.22, 1.92 - u * 1.24, -0.10 + u * 0.92],
        [0.70 + R() * 0.18, 1.84 - u * 1.28, 0.04 + u * 0.90],
        [0.84 + R() * 0.10, 1.70 - u * 1.20, 0.22 + u * 0.72]], 0.0035 + R() * 0.0035, 4, 1.6),
        P.sinew, rig, 'sinew', 1);
    }
    /* 髪の房（主頭蓋の後ろから垂れる。二次揺れの対象） */
    var hair = this._node('hair', rig, 0, 0, 0);
    for (i = 0; i < 11; i++) {
      /* 房は頭皮の球面から生やして前後にも散らす（束ねると板に見える） */
      var a = (i / 10 - 0.5) * 2.6 + (R() - 0.5) * 0.3, rr = 0.058 + R() * 0.022;
      var hx = 0.50 + Math.sin(a) * rr, hz = -0.20 - Math.cos(a) * rr * 1.25;
      var hl = 0.17 + R() * 0.26, dx = (R() - 0.5) * 0.10, dz = (R() - 0.5) * 0.10;
      this._mesh(tube([[hx, 2.07 + R() * 0.03, hz],
        [hx + dx * 0.4, 2.06 - hl * 0.45, hz + dz * 0.4 + 0.02],
        [hx + dx, 2.05 - hl, hz + dz + 0.05]], 0.0035 + R() * 0.004, 3, 1.6),
        P.hair, hair, 'hair', 1);
    }
    for (i = 0; i < 5; i++) {
      var bx = 0.66 + (R() - 0.5) * 0.1, bz = 0.30 + (R() - 0.5) * 0.1, bl = 0.12 + R() * 0.12;
      this._mesh(tube([[bx, 1.84, bz], [bx + 0.02, 1.84 - bl, bz + 0.04]], 0.0055, 4, 1.6),
        P.hair, hair, 'hair', 1);
    }
    /* 布の切れ端 */
    [[0.70, 1.20, 0.20, 0.26, 0.34, 0.7], [0.84, 0.86, 0.60, 0.20, 0.26, -0.5],
     [0.60, 1.52, -0.18, 0.16, 0.22, 1.2]].forEach(function (c, k) {
      var pg = new THREE.PlaneGeometry(c[3], c[4], 4, 5);
      warp(pg, 0.055, 14, 13 + k);
      this._mesh(place(pg, [c[0], c[1], c[2]], [0.25 + k * 0.3, c[5], 0.2 * k]), P.cloth, rig, 'rag', 1);
    }, this);
    /* 白い根（壁の隙間から垂れて絡む） */
    for (i = 0; i < 6; i++) {
      var ry0 = 0.35 + R() * 1.5;
      this._mesh(tube([[0.99, ry0 + 0.5, 0.2 + R() * 0.8], [0.88 - R() * 0.1, ry0 + 0.2, 0.3 + R() * 0.6],
        [0.96, ry0 - 0.2, 0.1 + R() * 0.9]], 0.0035 + R() * 0.003, 4, 1.6), P.root, rig, 'root', 1);
    }
  };

  /* ---------------- 実測（形態の姿勢・高さ・壁への寄せ量） ---------------- */
  EnemyF.prototype._measure = function () {
    lazy();
    var n = this.nodes;
    n.wall.rotation.set(0, 0, 0);
    n.fall.quaternion.identity(); n.fall.position.set(0, 0, 0);
    n.body.rotation.set(0, 0, 0);
    n.rig.scale.set(1, 1, 1);
    this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0); this.group.scale.set(1, 1, 1);
    this.group.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(n.rig);
    /* 模型 +X＝腹側。壁に触れるのは max.x、床形態ではそこが接地面になる */
    this.WALL_OFF = box.max.x;                  /* rig ローカルでの接地面 x */
    this.LIFT = box.max.x;                      /* 床形態の持ち上げ量 */
    this.FWD = (box.min.y + box.max.y) / 2;     /* 床形態の前後の中心合わせ */
    this.TOP_STAND = box.max.y;                 /* 壁形態の最高点(m) */
    this.TOP_CRAWL = (box.max.x - box.min.x) * 0.92;
    /* 剥がれ落ちた先の姿勢: 腹 +X → 下、脊柱 +Y → 前（−Z）、横 +Z → 右（+X） */
    this.Q_FALL = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));
    this.Q_ID = new THREE.Quaternion();
  };

  /* ================================================================
   * 姿勢・形態
   *   stand … 壁を這う（_findWall が見つけた壁面へ寄せ、肢を掛ける）
   *   crawl … 床を走る（Q_FALL へ slerp＝腹が床を向き、脊柱が前へ倒れる）
   * ============================================================== */
  var POSE_STAND = {
    body: [0.00, 0.00, 0.00], neck: [0.00, 0.00, 0.00], head: [0.00, 0.00, 0.00],
    limbAmp: 0.115, limbRate: 1.15, limbSpread: 0.00, rattle: 0.24, sway: 0.030, headPitch: 0.06
  };
  var POSE_CRAWL = {
    body: [0.00, 0.00, 0.00], neck: [0.10, 0.00, 0.00], head: [0.06, 0.00, 0.00],
    limbAmp: 0.305, limbRate: 2.45, limbSpread: 0.26, rattle: 0.95, sway: 0.075, headPitch: -0.22
  };

  function blendPose(A, B, u, out) {
    out = out || {};
    for (var k in A) {
      var a = A[k], b = (B && B[k] !== undefined) ? B[k] : a;
      if (typeof a === 'number') { out[k] = a + (b - a) * u; continue; }
      var o = out[k] || (out[k] = [0, 0, 0]);
      o[0] = a[0] + (b[0] - a[0]) * u;
      o[1] = a[1] + (b[1] - a[1]) * u;
      o[2] = a[2] + (b[2] - a[2]) * u;
    }
    return out;
  }

  /** 最寄りの壁（4方位・WALL_REACH まで）を探す。見つからなければ wallT=0。
   *  既知の妥協: 斜めの壁・柱の角は見ない。幅1の支線では必ず左右に壁があるので実害は無い。 */
  EnemyF.prototype._findWall = function () {
    var m = this.map;
    this.wallT = 0;
    if (!m || !m.isSolid) return;
    var T = m.tileSize || 2.0;
    var c0 = m.colOf(this.x), r0 = m.rowOf(this.z);
    var best = 1e9, bx = 1, bz = 0, k;
    for (k = 1; k <= 2; k++) {
      if (best < 1e9) break;
      if (m.isSolid(c0 + k, r0)) { var d = (c0 + k) * T - this.x; if (d < best) { best = d; bx = 1; bz = 0; } }
      if (m.isSolid(c0 - k, r0)) { var d2 = this.x - (c0 - k + 1) * T; if (d2 < best) { best = d2; bx = -1; bz = 0; } }
      if (m.isSolid(c0, r0 + k)) { var d3 = (r0 + k) * T - this.z; if (d3 < best) { best = d3; bx = 0; bz = 1; } }
      if (m.isSolid(c0, r0 - k)) { var d4 = this.z - (r0 - k + 1) * T; if (d4 < best) { best = d4; bx = 0; bz = -1; } }
    }
    if (best > WALL_REACH || best < 0.05) return;
    this.wallDist = best;
    this.wallYaw = Math.atan2(-bz, bx);     /* group.rotation.y と同じ向きの表現 */
    this.wallT = 1;
  };

  function angWrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /** 壁への寄せを滑らかに追う（マスを跨ぐ瞬間に飛ばない） */
  EnemyF.prototype._stepWall = function (dt) {
    this._findWall();
    var k = (dt > 0) ? (1 - Math.exp(-6.0 * dt)) : 1;
    var want = angWrap(this.wallYaw - this.facing);
    this._wallYawSm += angWrap(want - this._wallYawSm) * k;
    this._wallYawSm = angWrap(this._wallYawSm);
    this._wallTSm += (this.wallT - this._wallTSm) * k;
    this._wallDSm += (this.wallDist - this._wallDSm) * k;
  };

  /** 形態・壁寄せ・歩容・二次揺れをまとめて当てる */
  EnemyF.prototype.applyPose = function (u, extra) {
    var p = blendPose(POSE_STAND, POSE_CRAWL, u, this._pose);
    if (extra) extra(p, u);
    if (this.poseExtra) this.poseExtra(p, u, this.animTime);
    var n = this.nodes, t = this.animTime, i;
    var wt = this._wallTSm;
    /* 壁が無いときは「床で身を屈める」側へ寄せる（壁に貼りつく素振りをさせない） */
    var pe = u + (1 - u) * (1 - wt) * 0.30;

    /* --- 形態: ひとつの四元数 slerp で剥がれ落ちる --- */
    n.fall.quaternion.copy(this.Q_ID).slerp(this.Q_FALL, pe);
    var wx = (this._wallDSm - this.WALL_OFF - 0.02) * wt * (1 - pe);
    n.fall.position.set(wx, this.LIFT * pe, this.FWD * pe);
    n.wall.rotation.y = this._wallYawSm * wt * (1 - pe);
    var sz = 1 - 0.28 * pe;
    n.rig.scale.set(1, 1, sz);
    n.rig.position.set(-PIVOT[0], -PIVOT[1], -PIVOT[2] * sz);

    /* --- 胴の呼吸とうねり（骨の山が「息をしている」） --- */
    var sw = p.sway, st = this.state;
    var drive = (st === 'chase' || st === 'trans') ? 1 : (st === 'walk' ? 0.72 : 0.30);
    n.body.rotation.set(
      p.body[0] + sw * 0.55 * Math.sin(t * 1.25),
      p.body[1] + sw * Math.sin(t * 0.83 + 1.1),
      p.body[2] + sw * 0.8 * Math.sin(t * 1.07 + 0.4));

    /* --- 歩容: 12本の肢を位相をずらして掛け替える --- */
    var amp = p.limbAmp * drive, rate = p.limbRate;
    for (i = 0; i < this.limbs.length; i++) {
      var L = this.limbs[i], ph = t * rate * 2 * Math.PI + i * 2.07;
      var s1 = Math.sin(ph), s2 = Math.sin(ph + 1.25);
      L.root.rotation.set(
        amp * s1,
        amp * 0.55 * Math.sin(ph * 0.5 + i) + p.limbSpread * ((i % 2) ? 1 : -1) * 0.5,
        amp * 0.40 * s2);
      L.elbow.rotation.set(amp * 1.25 * (0.45 + 0.55 * s2), 0, amp * 0.5 * s1);
    }
    /* --- 頭蓋と骨のカタカタ（二次揺れ） --- */
    var rat = p.rattle * (0.45 + 0.55 * drive);
    for (i = 0; i < this.skulls.length; i++) {
      var S = this.skulls[i], b = S.n.userData.base;
      var jx = rat * S.a * 0.055, ph2 = t * S.f + i;
      if (b) {
        S.n.rotation.set(
          b[0] + jx * Math.sin(ph2), b[1] + jx * 0.8 * Math.sin(ph2 * 0.73 + 2.1),
          b[2] + jx * 1.2 * Math.sin(t * S.g + i * 1.7));
      }
      if (S.jaw) {
        var jb = S.jaw.userData.base;
        S.jaw.rotation.set(jb[0] - rat * S.a * (0.10 + 0.09 * Math.sin(t * S.g * 1.7 + i)),
          jb[1], jb[2] + rat * S.a * 0.05 * Math.sin(t * S.f * 1.3 + i));
      }
    }
    if (n.hair) n.hair.rotation.set(0.05 * Math.sin(t * 1.4) * drive, 0, 0.07 * Math.sin(t * 1.1 + 0.6) * drive);
    /* --- 首と主頭蓋（顔は常にこちらを向く） --- */
    n.neck.rotation.set(p.neck[0] + 0.05 * Math.sin(t * 1.3), p.neck[1], p.neck[2]);
    this._aimHead(p, pe, t, rat);

    this.group.position.set(this.x, this.floorY, this.z);
    this.group.rotation.y = this.facing;
    this.group.scale.set(this.scale, this.scale, this.scale);
    this.group.updateMatrixWorld(true);
    if (this.groundSnap) this._snap();
  };

  /** 主頭蓋の向き: 体がどう捻れていても顔は group の前方（−Z）へ立て直す。
   *  壁這いでは首をねじって通路を睨み、捕獲演出では必ずカメラ側を向く。 */
  EnemyF.prototype._aimHead = function (p, pe, t, rat) {
    var n = this.nodes, q = this._q, q2 = this._q2, e = this._e;
    /* 親の連鎖（group ローカル空間での向き）を合成する */
    q.identity();
    e.set(0, n.wall.rotation.y, 0); q.multiply(q2.setFromEuler(e));
    q.multiply(n.fall.quaternion);
    e.copy(n.body.rotation); q.multiply(q2.setFromEuler(e));
    e.copy(n.neck.rotation); q.multiply(q2.setFromEuler(e));
    q.invert();
    /* 狙う向き: 正面＋基準の傾き＋形態ごとの俯仰＋カタカタ */
    e.set(HEAD_BASE[0] + p.headPitch + p.head[0] + rat * 0.035 * Math.sin(t * 6.7),
      p.head[1] + rat * 0.03 * Math.sin(t * 5.1 + 1.3),
      HEAD_BASE[1] + p.head[2] + rat * 0.045 * Math.sin(t * 7.9 + 0.5));
    q.multiply(q2.setFromEuler(e));
    n.head.quaternion.copy(q);
  };

  EnemyF.prototype._snap = function () {
    var lowest = Infinity, v = this._tmp, i;
    for (i = 0; i < this.contacts.length; i++) {
      this.contacts[i].getWorldPosition(v);
      if (v.y < lowest) lowest = v.y;
    }
    if (!isFinite(lowest)) return;
    var d = this.floorY - lowest;
    if (d > 0.25) d = 0.25; else if (d < -0.25) d = -0.25;
    if (Math.abs(d) > 1e-4) { this.group.position.y += d; this.group.updateMatrixWorld(true); }
  };

  /* ---------------- 毎フレーム ---------------- */
  EnemyF.prototype.update = function (dt, time) {
    if (!isFinite(dt)) dt = 0;
    this.animTime = (typeof time === 'number') ? time : (this.animTime + dt);
    var inTrans = false, raw = 0;
    if (this.state === 'trans') {
      this.transTime += dt;
      var u0 = Math.min(1, this.transTime / this.transDur);
      raw = u0; inTrans = true;
      /* 剥がれ落ちる: 前半は指が滑るだけ、後半で一気に落ちる／戻りは這い上がる */
      var e = (u0 < 0.35) ? (u0 / 0.35) * 0.18 : 0.18 + Math.pow((u0 - 0.35) / 0.65, 0.62) * 0.82;
      this.poseT = (this.transDir > 0) ? e : (1 - e);
      if (u0 >= 1) {
        this.poseT = (this.transDir > 0) ? 1 : 0;
        this.state = (this.transDir > 0) ? 'chase' : 'walk';
      }
    }
    this._stepWall(dt);
    var want = this.scaleTarget();
    if (!(dt > 0)) this.scale = want;
    else this.scale += (want - this.scale) * (1 - Math.exp(-4.5 * dt));
    var self = this;
    this.applyPose(this.poseT, function (p, u) {
      if (!inTrans) return;
      /* 落下の身震い（剥がれる瞬間に骨が総立ちになる） */
      var k = Math.sin(Math.PI * raw);
      p.rattle += 1.15 * k;
      p.limbAmp += 0.22 * k;
      p.sway += 0.06 * k;
    });
  };

  EnemyF.prototype.setForm = function (form, instant) {
    var want = (form === 'crawl' || form === 1) ? 1 : 0;
    if (instant) {
      this.poseT = want;
      this.state = want ? 'chase' : 'walk';
      this.transTime = 0;
      return;
    }
    if (this.poseT === want && this.state !== 'trans') return;
    this.transDir = want ? 1 : -1;
    this.transTime = 0;
    this.state = 'trans';
  };

  /** 天井で頭がつかえる区画では縮める（壁形態のみ。床形態は 0.6m 程度で無関係） */
  EnemyF.prototype.topHeight = function () {
    return this.TOP_STAND + (this.TOP_CRAWL - this.TOP_STAND) * smooth01(this.poseT);
  };
  EnemyF.prototype.scaleTarget = function () {
    if (!this.ceilFit || !this.map || !this.map.ceilHAt) return 1;
    var col = this.map.colOf(this.x), row = this.map.rowOf(this.z);
    if (this.map.inBounds && !this.map.inBounds(col, row)) return 1;
    var room = this.map.ceilHAt(col, row) - 0.10;
    var top = this.topHeight();
    if (!(top > 0)) return 1;
    var lim = room / top;
    return lim < 1 ? Math.max(0.60, lim) : 1;
  };

  EnemyF.prototype.placeAt = function (x, z, yawRad, map) {
    this.x = x; this.z = z;
    if (map) this.map = map;
    this.floorY = this.map ? this.map.floorYAt(x, z) : 0;
    if (this.map && this.map.ceilHAt) {
      var col = this.map.colOf(x), row = this.map.rowOf(z);
      if (!this.map.inBounds || this.map.inBounds(col, row)) this.ceilH = this.map.ceilHAt(col, row);
    }
    if (typeof yawRad === 'number') this.facing = yawRad;
    this._stepWall(0);
    this.scale = this.scaleTarget();
    this.applyPose(this.poseT);
  };

  EnemyF.prototype.placeCell = function (col, row, yawDeg, map) {
    var c = map.cellCenter(col, row);
    this.placeAt(c.x, c.z, (yawDeg || 0) * Math.PI / 180, map);
  };

  EnemyF.prototype.dispose = function () {
    for (var i = 0; i < this.disposables.length; i++) {
      var d = this.disposables[i];
      if (d && d.dispose) d.dispose();
    }
    this.disposables.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.grabHands && this.grabHands.parent) this.grabHands.parent.remove(this.grabHands);
    if (this.maw && this.maw.group.parent) this.maw.group.parent.remove(this.maw.group);
  };

  /* ---------------- 明るさ（暗がりでも骨が読めること） ---------------- */
  EnemyF.prototype.syncLight = function (world, map) {
    var r = 0.02, g = 0.02, b = 0.03;
    if (world && world.lightIndex && world._shade) {
      var col = map ? map.colOf(this.x) : 0, row = map ? map.rowOf(this.z) : 0;
      var key = world._ownerOf ? world._ownerOf(col, row) : (col + ',' + row);
      var out = world._shade(this.x, this.floorY + 0.10, this.z, 0, 1, 0, key, undefined, this._shadeOut);
      r = out[0]; g = out[1]; b = out[2];
    }
    this._amb.r = r; this._amb.g = g; this._amb.b = b;
    var lum = 0.30 * r + 0.59 * g + 0.11 * b;
    var mx = Math.max(r, Math.max(g, b)) + 1e-5;
    var tr = 0.62 + 0.38 * (r / mx), tg = 0.62 + 0.38 * (g / mx), tb = 0.62 + 0.38 * (b / mx);
    var cine = this.detailHi;
    var breathe = 0.94 + 0.06 * Math.sin(this.animTime * 0.9);
    for (var i = 0; i < this.litMats.length; i++) {
      var m = this.litMats[i], Pf = LIT[m.userData.a2lit] || LIT.body;
      var lo = cine ? Pf.cine[0] : Pf.min, hi = cine ? Pf.cine[1] : Pf.max;
      var k = cl(lo + lum * Pf.gain, lo, hi) * (m.userData.a2k === undefined ? 1 : m.userData.a2k);
      if (m.userData.a2lit === 'face') k *= breathe;
      m.emissive.setRGB(k * tr, k * tg, k * tb);
    }
  };

  /* ================================================================
   * 詳細度・三角形
   *   'normal' … 高詳細（契約 ≤30k）／'low' … 遠景・退避段階（契約 ≤10k）
   *   'hi'     … 捕獲演出中だけ。眼窩の奥に微光を灯し、顔を底上げする。
   * ============================================================== */
  EnemyF.prototype.setDetail = function (level) {
    var want = (level === 'hi' || level === true) ? 'hi'
      : (level === 'low' || level === 'lo') ? 'low' : 'normal';
    if (want === this.detail) return this.detail;
    this.detail = want;
    this.detailHi = (want === 'hi');
    this.lowDetail = (want === 'low');
    var vis = !this.lowDetail, i;
    for (i = 0; i < this.lodHi.length; i++) this.lodHi[i].visible = vis;
    for (i = 0; i < this.lodSwap.length; i++) {
      var sw = this.lodSwap[i];
      sw.m.geometry = this.lowDetail ? sw.lo : sw.hi;
    }
    if (this.detailHi) this._buildEyes().visible = true;
    else if (this.eyes) this.eyes.visible = false;
    return this.detail;
  };

  /** いま描かれている三角形数（演出パーツを含む） */
  EnemyF.prototype.activeTriangles = function () {
    var n = this.lowDetail ? this.loTriangles : this.triangles;
    if (this.eyes && this.eyes.visible) n += this._eyeTris || 0;
    if (this.grabHands && this.grabHands.visible) n += this._handTris || 0;
    if (this.maw && this.maw.group.visible) n += this._mawTris || 0;
    return n;
  };

  /* ---------------- 眼窩の奥の微光（ハイライト無し・演出中だけ） ---------------- */
  var _glowTex = null;
  function glowTex() {
    if (_glowTex) return _glowTex;
    var S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,148,96,1)');
    g.addColorStop(0.30, 'rgba(206,74,38,0.62)');
    g.addColorStop(0.70, 'rgba(96,22,10,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    _glowTex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) _glowTex.colorSpace = THREE.SRGBColorSpace;
    return _glowTex;
  }
  /** 眼窩の底に置く微光。球体の眼は作らない（契約: 眼窩は黒い空洞のまま） */
  EnemyF.prototype._sockGlow = function (parent, p, r, k, list) {
    var mat = this._track(new THREE.SpriteMaterial({
      map: glowTex(), color: 0xffffff, fog: true, transparent: true,
      opacity: 0.55 * k, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true
    }));
    var sp = new THREE.Sprite(mat);
    sp.name = 'sockGlow';
    sp.frustumCulled = false;
    sp.renderOrder = 6;
    sp.scale.set(r * 2, r * 2, 1);
    sp.position.set(p[0], p[1], p[2]);
    sp.userData.k = k;
    parent.add(sp);
    this.extraTriangles += 2;
    if (list) list.push(sp);
    return sp;
  };
  EnemyF.prototype._buildEyes = function () {
    if (this.eyes) return this.eyes;
    this._countExtra = true;
    var t0 = this.extraTriangles;
    this.eyes = new THREE.Group();
    this.eyes.name = 'sockLight';
    this.eyes.visible = false;
    this.eyeSprites = [];
    var S = this.mainSkull;
    this._sockGlow(this.eyes, S.socket0, 0.0165, 1.00, this.eyeSprites);
    this._sockGlow(this.eyes, S.socket1, 0.0180, 0.78, this.eyeSprites);
    this.nodes.headScale.add(this.eyes);
    this._eyeTris = this.extraTriangles - t0;
    this._countExtra = false;
    return this.eyes;
  };
  EnemyF.prototype.redEyesVisible = function () {
    return !!(this.eyes && this.eyes.visible && this.detailHi);
  };
  /** 微光を脈打たせる。左右で周期を揃えない（片方だけ不規則に翳る） */
  EnemyF.prototype.pulseEyes = function (t, k) {
    var kk = (k === undefined ? 1 : k), i, lit = 0;
    var F1 = [2.27, 3.19], F2 = [1.03, 0.67], PH = [0, 1.9], FK = [0.10, 0.34], F3 = [0.71, 1.83];
    var all = [];
    if (this.eyes && this.eyes.visible) all = all.concat(this.eyeSprites || []);
    if (this.maw && this.maw.group.visible && this.mawSprites) all = all.concat(this.mawSprites);
    for (i = 0; i < all.length; i++) {
      var sp = all[i], j = i % 2;
      var a = 0.76 + 0.24 * Math.sin(t * F1[j]) * Math.sin(t * F2[j] + PH[j]);
      a *= 1 - FK[j] * Math.pow(0.5 + 0.5 * Math.sin(t * F3[j] + 1.7), 3);
      a *= kk * (sp.userData.k || 1);
      sp.material.opacity = 0.55 * a;
      lit += a;
    }
    return lit;
  };

  /* ================================================================
   * 捕獲演出の造形（camera 空間にそのまま置ける）
   *   createGrabHands … 首を掴む骨の手（左右一対。指は骨だけ）
   *   createMaw       … 複数の頭蓋が覗き込む（主頭蓋が正面・周りに4個が傾いて寄る）
   * ============================================================== */
  EnemyF.prototype.createGrabHands = function () {
    if (this.grabHands) return this.grabHands;
    var P = this.mats, self = this;
    this._countExtra = true;
    var t0 = this.extraTriangles;
    var root = new THREE.Group();
    root.name = 'grab-hands';
    root.visible = false;
    /* sx=+1 が画面右。前腕が画面の下隅から入り、指が首を握り込む。 */
    function arm(sx, name) {
      var a = new THREE.Group();
      a.name = name;
      root.add(a);
      var hx = sx * 0.185, hy = -0.245, hz = -0.470;
      self._mesh(boneGeo([sx * 0.62, -0.60, -0.90], [hx, hy, hz], 0.030, 0.02, 7, 4), P.boneDirty, a, 'ulna');
      self._mesh(boneGeo([sx * 0.66, -0.63, -0.90], [hx + sx * 0.03, hy - 0.02, hz + 0.02], 0.024, -0.02, 6, 3),
        P.boneDirty, a, 'radius');
      self._mesh(knobGeo([hx, hy, hz], 0.036, 8), P.boneDirty, a, 'wrist');
      var w = new THREE.Group();
      w.position.set(hx, hy, hz);
      w.rotation.set(0.55, sx * 0.42, -sx * 0.30);
      a.add(w);
      hand(self, P.boneDirty, w, 0.175, 4801 + (sx > 0 ? 7 : 0), 0.62, 0);
      /* 手首に絡む乾いた腱と布 */
      self._mesh(tube([[hx, hy, hz], [hx + sx * 0.10, hy - 0.10, hz - 0.10],
        [hx + sx * 0.22, hy - 0.26, hz - 0.22]], 0.010, 4, 1.6), P.sinew, a, 'sinew');
      return a;
    }
    this.handL = arm(-1, 'grabHandL');
    this.handR = arm(1, 'grabHandR');
    this.grabHands = root;
    this._handTris = this.extraTriangles - t0;
    this._countExtra = false;
    return root;
  };

  /**
   * 「食われる」用の口＝**複数の頭蓋が覗き込む**（契約 P5e-2 F）。
   * 単位系: 主頭蓋の幅がおよそ 1.0。setOpen(u) で主頭蓋の顎が開き、
   * 周りの4個が寄って傾き、視界を塞ぐ。
   */
  EnemyF.prototype.createMaw = function () {
    if (this.maw) return this.maw;
    var P = this.mats, self = this;
    this._countExtra = true;
    var t0 = this.extraTriangles;
    var root = new THREE.Group();
    root.name = 'maw';
    root.visible = false;
    this.mawSprites = [];
    var K = 11.5;                       /* 頭蓋 rx=0.080 → 半幅およそ 0.92 */
    var U = K * 0.080;                  /* 主頭蓋の半幅＝寄せる距離の単位 */

    /* 主頭蓋: 正面。顔は camera（+Z 側）を向く */
    var mainN = new THREE.Group();
    mainN.name = 'mawMain';
    mainN.rotation.set(0.10, Math.PI, 0.05);
    mainN.scale.setScalar(K);
    root.add(mainN);
    var mainSk = buildSkull(this, P, mainN, { seed: 5, gape: 0.42, slip: 0.018, seg: 26 });
    this._sockGlow(mainSk.group, mainSk.socket0, 0.0165, 1.0, this.mawSprites);
    this._sockGlow(mainSk.group, mainSk.socket1, 0.0180, 0.78, this.mawSprites);
    /* 喉の闇（開いた口の奥。カメラを飲み込む袋） */
    var gul = new THREE.CylinderGeometry(0.042, 0.016, 0.24, 12, 1, true);
    gul.rotateX(Math.PI / 2);
    this._mesh(place(gul, [0.004, -0.070, 0.10]), P.cavity, mainSk.group, 'gullet');

    /* 周りの4個: 傾いて寄る（大人2・子供1・欠けた半分1） */
    var RING = [
      { p: [-0.92, 0.30, -0.26], r: [0.12, Math.PI - 0.62, -0.58], s: 0.86,
        o: { seed: 41, gape: 0.26, slip: -0.010, chip: 1.5, seg: 20, slim: true } },
      { p: [0.95, 0.16, -0.30], r: [-0.20, Math.PI + 0.70, 0.66], s: 0.92,
        o: { seed: 113, gape: 0.38, slip: 0.020, chip: 1.6, seg: 20, slim: true } },
      { p: [-0.34, -0.86, -0.20], r: [-0.62, Math.PI + 0.22, 1.35], s: 0.64,
        o: { seed: 23, gape: 0.50, chip: 1.2, seg: 16, slim: true } },
      { p: [0.42, 0.92, -0.34], r: [0.70, Math.PI - 0.18, -1.15], s: 0.80,
        o: { seed: 57, gape: 0.20, chip: 2.2, seg: 16, slim: true } }
    ];
    var ring = [];
    for (var i = 0; i < RING.length; i++) {
      var c = RING[i], nd = new THREE.Group();
      nd.name = 'mawRing' + i;
      nd.position.set(c.p[0] * U * 1.45, c.p[1] * U * 1.45, c.p[2] * U * 1.45);
      nd.rotation.set(c.r[0], c.r[1], c.r[2]);
      nd.scale.setScalar(K * c.s);
      root.add(nd);
      var sk = buildSkull(this, P, nd, c.o);
      this._sockGlow(sk.group, sk.socket0, 0.0175, 0.62, this.mawSprites);
      this._sockGlow(sk.group, sk.socket1, 0.0175, 0.50, this.mawSprites);
      ring.push({ n: nd, jaw: sk.jaw, home: nd.position.toArray(), rot: c.r.slice() });
    }

    var jawBase = mainSk.jaw ? mainSk.jaw.userData.base.slice() : [0, 0, 0];
    var maw = {
      group: root,
      setOpen: function (u) {
        if (mainSk.jaw) {
          mainSk.jaw.rotation.set(jawBase[0] - 1.05 * u, jawBase[1] + 0.10 * u, jawBase[2]);
          mainSk.jaw.position.y = -0.098 * 0.54 - 0.052 * u;
        }
        mainN.position.set(0, -0.16 * U * u, 0.34 * U * u);
        mainN.rotation.x = 0.10 + 0.30 * u;
        for (var j = 0; j < ring.length; j++) {
          var g = ring[j], h = g.home;
          /* 寄ってくる＝中心へ 34% 詰め、カメラ側へ出る */
          g.n.position.set(h[0] * (1 - 0.34 * u), h[1] * (1 - 0.34 * u), h[2] + (0.46 + 0.20 * j) * U * u);
          g.n.rotation.set(g.rot[0] + (j % 2 ? 0.34 : -0.28) * u, g.rot[1], g.rot[2] * (1 + 0.45 * u));
          if (g.jaw) {
            var b = g.jaw.userData.base;
            g.jaw.rotation.x = b[0] - 0.62 * u;
          }
        }
      }
    };
    maw.setOpen(0);
    this.maw = maw;
    this._mawTris = this.extraTriangles - t0;
    this._countExtra = false;
    return maw;
  };

  /* ---------------- 公開 ---------------- */
  EnemyF.PIVOT = PIVOT;
  EnemyF.POSE_STAND = POSE_STAND;
  EnemyF.POSE_CRAWL = POSE_CRAWL;
  ESCAPE.EnemyModelsA2 = ESCAPE.EnemyModelsA2 || {};
  ESCAPE.EnemyModelsA2.F = EnemyF;
})(typeof window !== 'undefined' ? window : this);
