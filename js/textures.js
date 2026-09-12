/* ESCAPE — Canvasプロシージャルテクスチャ（外部アセット禁止・契約 §2）
 * 生成は全てここに集約する。1テクスチャ=1キャンバスで、決定的な擬似乱数で描く
 * （同じ入力なら毎回同じ絵＝スクショ監査が再現可能）。
 *
 * 解像度（契約 §3「至近距離1mで目地の欠け・錆だれ・汚れの粒が読める」）:
 *   壁   2m x 3m = 512 x 768   ＝ 256 px/m
 *   床   2m x 2m = 512 x 512   ＝ 256 px/m
 *   天井 2m x 2m = 384 x 384   ＝ 192 px/m
 *   金属 1.5m角  = 384 x 384   ＝ 256 px/m 相当
 * 目地は3px、タイルの欠けは4〜18px、汚れの粒は1〜2pxで描く。
 * GPU上のテクスチャ総量は約5MB（ミップ込み）。ダウンロード量は0（全てコード生成）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* ---- 決定的PRNG（mulberry32） ---- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  /* ================================================================
   * P4.11 項目7「質感を一回り上げる」の土台
   * 壁 1024 x 1536・床 1024 x 1024（＝512 px/m。従来の2倍）。
   * 既存の描画コードは 512 px/m 系の座標で書かれているので、キャンバスだけ
   * TEX_S 倍にして ctx.scale() を掛ける＝描画コードは論理座標のまま使い回し、
   * その上に「実ピクセル解像度でしか出ない細部」（1pxの粒・細い擦り傷）を重ねる。
   * ============================================================== */
  var TEX_S = 2;

  /** 論理サイズ w x h のテクスチャを TEX_S 倍の実解像度で作る */
  function makeTex(w, h) {
    var c = makeCanvas(w * TEX_S, h * TEX_S);
    var ctx = c.getContext('2d');
    ctx.scale(TEX_S, TEX_S);
    return { c: c, ctx: ctx };
  }
  /** 実ピクセル空間で描く（論理座標のスケールを一時的に外す） */
  function pxSpace(ctx, fn) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    fn(ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  /** 実ピクセルの微粒子。至近距離（1m）で「汚れの粒」が読めるのはこれ */
  function fineGrit(ctx, n, rand, css) {
    pxSpace(ctx, function (w, h) {
      ctx.fillStyle = css;
      for (var i = 0; i < n; i++) ctx.fillRect((rand() * w) | 0, (rand() * h) | 0, 1, 1);
    });
  }
  /** 擦れ傷。1px幅の細い線を ang 方向へ散らす（人や台車が擦った跡） */
  function scuff(ctx, n, rand, css, ang, len) {
    pxSpace(ctx, function (w, h) {
      ctx.strokeStyle = css;
      ctx.lineWidth = 1;
      for (var i = 0; i < n; i++) {
        var x = rand() * w, y = rand() * h;
        var a = ang + (rand() - 0.5) * 0.55;
        var L = len * (0.25 + rand() * 1.6);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
        ctx.stroke();
      }
    });
  }
  /** 塗装の剥落。下地の色が出る不定形の斑＋縁のめくれ */
  function peel(ctx, x, y, r, rand, baseCss, edgeCss) {
    ctx.beginPath();
    for (var i = 0; i <= 14; i++) {
      var a = i / 14 * Math.PI * 2, rr = r * (0.5 + rand() * 0.75);
      var qx = x + Math.cos(a) * rr, qy = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
    }
    ctx.closePath();
    ctx.fillStyle = baseCss; ctx.fill();
    ctx.strokeStyle = edgeCss; ctx.lineWidth = 1.6; ctx.stroke();
  }
  /**
   * 方向性のある擬似スペキュラ。ang 方向へ細長く伸びる淡い反射を n 本置く。
   * 「床が濡れて／磨り減って光を長く引く」見え方＝平面のフラットさを壊す。
   */
  function sheen(ctx, W, H, n, rand, ang, css) {
    for (var i = 0; i < n; i++) {
      var cx = rand() * W, cy = rand() * H;
      var len = W * (0.55 + rand() * 0.8), wid = 16 + rand() * 62;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang + (rand() - 0.5) * 0.25);
      var g2 = ctx.createLinearGradient(0, -wid / 2, 0, wid / 2);
      g2.addColorStop(0, css.replace('%A%', '0'));
      g2.addColorStop(0.5, css.replace('%A%', (0.05 + rand() * 0.08).toFixed(3)));
      g2.addColorStop(1, css.replace('%A%', '0'));
      var g3 = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
      g3.addColorStop(0, 'rgba(0,0,0,0)');
      g3.addColorStop(0.5, 'rgba(0,0,0,1)');
      g3.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = g2;
      /* 縦方向の減衰だけだと帯が切れないので、両端をマスクで落とす */
      ctx.beginPath();
      for (var s = -len / 2; s <= len / 2; s += len / 24) {
        var fall = 1 - Math.abs(s) / (len / 2);
        ctx.rect(s, -wid / 2 * fall, len / 24 + 1, wid * fall);
      }
      ctx.fill();
      ctx.restore();
      if (g3) { /* 参照のみ */ }
    }
  }

  /** ピクセル単位のざらつき（±amt）。alpha は触らない。キャンバス全域に掛ける */
  function grain(ctx, w, h, amt, rand) {
    w = ctx.canvas.width; h = ctx.canvas.height;
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (rand() - 0.5) * 2 * amt;
      d[i] = clamp255(d[i] + n);
      d[i + 1] = clamp255(d[i + 1] + n);
      d[i + 2] = clamp255(d[i + 2] + n);
    }
    ctx.putImageData(img, 0, 0);
  }

  /** 汚れの「粒」。1〜2pxの点を面にばら撒く（至近距離でこれが効く） */
  function speckle(ctx, w, h, n, rand, css, sz) {
    ctx.fillStyle = css;
    for (var i = 0; i < n; i++) {
      var s = sz || (1 + (rand() < 0.25 ? 1 : 0));
      ctx.fillRect((rand() * w) | 0, (rand() * h) | 0, s, s);
    }
  }

  /** ぼんやりした汚れ（放射グラデーション） */
  function blot(ctx, x, y, r, css) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  /**
   * P4.17 項目1: 壁テクスチャごとの錆だれ（縦筋）の本数。prev は P4.16 までの本数で、
   * 契約は「本数を現行の1/4以下」。機械テスト（world.js testP417Wall）がここを読む。
   * wallMetal は2ループ（塗装の剥げ＋打痕まわり）の合計。
   */
  var RUST_RUNS = {
    wall: 2, wallPaint: 1, wallMetalA: 5, wallMetalB: 3, metal: 3,
    prev: { wall: 9, wallPaint: 6, wallMetal: 36, metal: 14 }
  };

  /**
   * 錆だれ: 上端から下へ流れる帯＋粒。錆の輪郭がにじむように2層で描く。
   * 2026-09-11 P4.17 項目1（ユーザー評「壁に無数の赤い線が引いてあって質が下がった」）:
   * 色相を赤茶から**茶**へ振り、彩度を落とす（R−G を 56 → 16 前後に）。本数と長さは
   * 呼び出し側で1/4以下へ削っている。遠目に「赤い縦線」と読めないことが合格条件。
   */
  function rustRun(ctx, x, y, w, len, rand, alpha) {
    var g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(96,80,58,' + (0.34 * alpha) + ')');
    g.addColorStop(0.35, 'rgba(84,70,52,' + (0.24 * alpha) + ')');
    g.addColorStop(1, 'rgba(78,66,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, len);
    /* 縁のにじみ */
    ctx.fillStyle = 'rgba(112,96,72,' + (0.16 * alpha) + ')';
    for (var i = 0; i < len; i += 3) {
      var jitter = (rand() - 0.5) * w * 0.8;
      ctx.fillRect(x + jitter, y + i, w * (0.4 + rand() * 0.5), 3);
    }
    /* 粒 */
    for (var k = 0; k < len * 0.5; k++) {
      ctx.fillStyle = 'rgba(' + (78 + rand() * 46 | 0) + ',' + (64 + rand() * 38 | 0) + ',' + (46 + rand() * 20 | 0) + ',' + (0.22 + rand() * 0.34) * alpha + ')';
      ctx.fillRect(x + (rand() - 0.2) * w, y + rand() * len, 1 + (rand() < 0.3 ? 1 : 0), 1 + (rand() < 0.3 ? 1 : 0));
    }
  }

  /** ひび。枝分かれしながら細くなる */
  function crack(ctx, x, y, len, ang, rand, depth) {
    ctx.strokeStyle = 'rgba(46,48,46,' + (0.30 + 0.35 / (depth + 1)) + ')';
    ctx.lineWidth = Math.max(0.7, 2.4 / (depth + 1));
    ctx.beginPath(); ctx.moveTo(x, y);
    var px = x, py = y, a = ang;
    for (var i = 0; i < 7; i++) {
      a += (rand() - 0.5) * 0.9;
      px += Math.cos(a) * len / 7; py += Math.sin(a) * len / 7;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    if (depth < 2 && rand() < 0.7) {
      crack(ctx, x + Math.cos(ang) * len * 0.4, y + Math.sin(ang) * len * 0.4,
        len * 0.5, ang + (rand() - 0.5) * 1.8, rand, depth + 1);
    }
  }

  /* ================================================================ */
  /* 壁: 白タイル（2m x 3m / 512 x 768）                                */
  /* ================================================================ */
  function texWall(seed) {
    var W = 512, H = 768, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(seed || 1337);

    /* 下地モルタル */
    ctx.fillStyle = '#8e8b82'; ctx.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 9000, rand, 'rgba(120,116,106,0.5)');

    var TS = 64;                     /* タイル 0.25m = 64px */
    var chips = [];
    for (var ty = 0; ty < H / TS; ty++) {
      for (var tx = 0; tx < W / TS; tx++) {
        var broken = rand() < 0.045;
        if (broken) { chips.push([tx, ty]); continue; }
        var v = 168 + rand() * 34;
        var g = v - 2 + rand() * 7;
        var b = v - 10 + rand() * 7;
        ctx.fillStyle = 'rgb(' + (v | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
        ctx.fillRect(tx * TS + 2, ty * TS + 2, TS - 4, TS - 4);
        /* 釉薬のムラ */
        blot(ctx, tx * TS + 10 + rand() * (TS - 20), ty * TS + 10 + rand() * (TS - 20),
          10 + rand() * 22, 'rgba(' + (v + 18 | 0) + ',' + (v + 20 | 0) + ',' + (v + 14 | 0) + ',0.30)');
        /* タイル1枚ごとの「微傾き」による反射差。向きと強さをタイルごとに変える */
        var ga = rand() * Math.PI * 2, gs = 0.05 + rand() * 0.22;
        var gx0 = tx * TS + TS / 2 + Math.cos(ga) * TS * 0.6;
        var gy0 = ty * TS + TS / 2 + Math.sin(ga) * TS * 0.6;
        var lg = ctx.createLinearGradient(gx0, gy0, tx * TS + TS - gx0 + tx * TS, ty * TS + TS - gy0 + ty * TS);
        lg.addColorStop(0, 'rgba(255,255,255,' + gs.toFixed(3) + ')');
        lg.addColorStop(0.5, 'rgba(255,255,255,0)');
        lg.addColorStop(1, 'rgba(0,0,0,' + (gs * 0.8).toFixed(3) + ')');
        ctx.fillStyle = lg;
        ctx.fillRect(tx * TS + 2, ty * TS + 2, TS - 4, TS - 4);
        /* 上端のハイライト＋下端の落ち */
        ctx.fillStyle = 'rgba(255,255,255,0.11)';
        ctx.fillRect(tx * TS + 3, ty * TS + 3, TS - 6, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(tx * TS + 3, ty * TS + TS - 7, TS - 6, 4);
        /* 角の欠け（小） */
        if (rand() < 0.30) {
          var cx0 = tx * TS + (rand() < 0.5 ? 2 : TS - 12);
          var cy0 = ty * TS + (rand() < 0.5 ? 2 : TS - 12);
          ctx.fillStyle = 'rgba(126,120,110,0.95)';
          ctx.beginPath();
          ctx.moveTo(cx0, cy0);
          ctx.lineTo(cx0 + 4 + rand() * 8, cy0 + rand() * 4);
          ctx.lineTo(cx0 + rand() * 5, cy0 + 4 + rand() * 8);
          ctx.closePath(); ctx.fill();
        }
      }
    }

    /* 目地（3px）。立体感を出すため上/左に影、下/右にハイライトを添える */
    ctx.fillStyle = 'rgba(66,70,66,0.92)';
    for (var gx = 0; gx <= W; gx += TS) ctx.fillRect(gx - 2, 0, 3, H);
    for (var gy = 0; gy <= H; gy += TS) ctx.fillRect(0, gy - 2, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    for (var gx1 = 0; gx1 <= W; gx1 += TS) ctx.fillRect(gx1 + 1, 0, 2, H);
    for (var gy1 = 0; gy1 <= H; gy1 += TS) ctx.fillRect(0, gy1 + 1, W, 2);
    ctx.fillStyle = 'rgba(232,236,230,0.26)';
    for (var gx2 = 0; gx2 <= W; gx2 += TS) ctx.fillRect(gx2 - 4, 0, 2, H);
    for (var gy2 = 0; gy2 <= H; gy2 += TS) ctx.fillRect(0, gy2 - 4, W, 2);
    /* 目地の欠け＝下地が覗く白い抜け */
    for (var m = 0; m < 150; m++) {
      var horiz = rand() < 0.5;
      var mx = horiz ? rand() * W : ((rand() * W / TS) | 0) * TS - 2;
      var my = horiz ? ((rand() * H / TS) | 0) * TS - 2 : rand() * H;
      ctx.fillStyle = 'rgba(150,146,136,0.85)';
      if (horiz) ctx.fillRect(mx, my, 4 + rand() * 16, 3);
      else ctx.fillRect(mx, my, 3, 4 + rand() * 16);
    }
    /* 目地に溜まった黒カビ */
    ctx.fillStyle = 'rgba(34,40,34,0.55)';
    for (var mk = 0; mk < 260; mk++) {
      var h2 = rand() < 0.5;
      var kx = h2 ? rand() * W : ((rand() * W / TS) | 0) * TS - 2;
      var ky = h2 ? ((rand() * H / TS) | 0) * TS - 2 : rand() * H;
      if (h2) ctx.fillRect(kx, ky, 3 + rand() * 22, 3);
      else ctx.fillRect(kx, ky, 3, 3 + rand() * 22);
    }

    /* 剥落したタイル＝下地が丸ごと出る */
    for (var ch = 0; ch < chips.length; ch++) {
      var bx = chips[ch][0] * TS, by = chips[ch][1] * TS;
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx + 1, by + 1, TS - 2, TS - 2);
      ctx.clip();
      ctx.fillStyle = '#6b6860';
      ctx.fillRect(bx, by, TS, TS);
      /* 接着剤の櫛目（斜め・低コントラスト） */
      ctx.strokeStyle = 'rgba(92,88,80,0.42)';
      ctx.lineWidth = 3;
      for (var q = -TS; q < TS * 2; q += 9) {
        ctx.beginPath(); ctx.moveTo(bx + q, by); ctx.lineTo(bx + q + TS, by + TS); ctx.stroke();
      }
      /* モルタルの残骸 */
      for (var q2 = 0; q2 < 26; q2++) {
        ctx.fillStyle = 'rgba(' + (108 + rand() * 40 | 0) + ',' + (104 + rand() * 38 | 0) + ',' + (94 + rand() * 34 | 0) + ',0.65)';
        ctx.fillRect(bx + rand() * TS, by + rand() * TS, 2 + rand() * 7, 2 + rand() * 6);
      }
      /* 凹み＝上と左に落ち込みの影、下と右に薄い受け光 */
      var sg = ctx.createLinearGradient(0, by, 0, by + 22);
      sg.addColorStop(0, 'rgba(14,16,16,0.85)');
      sg.addColorStop(1, 'rgba(14,16,16,0)');
      ctx.fillStyle = sg; ctx.fillRect(bx, by, TS, 22);
      var sg2 = ctx.createLinearGradient(bx, 0, bx + 16, 0);
      sg2.addColorStop(0, 'rgba(14,16,16,0.7)');
      sg2.addColorStop(1, 'rgba(14,16,16,0)');
      ctx.fillStyle = sg2; ctx.fillRect(bx, by, 16, TS);
      ctx.fillStyle = 'rgba(180,176,166,0.16)';
      ctx.fillRect(bx, by + TS - 5, TS, 5);
      speckle(ctx, W, H, 900, rand, 'rgba(58,56,50,0.35)');
      ctx.restore();
      /* 割れ残ったタイルの縁 */
      ctx.strokeStyle = 'rgba(210,208,200,0.5)'; ctx.lineWidth = 2;
      ctx.strokeRect(bx + 2, by + 2, TS - 4, TS - 4);
    }

    /* 錆だれ（上の配管から）。P4.17 項目1: 9本→2本・長さも1/3以下に */
    for (var s = 0; s < RUST_RUNS.wall; s++) {
      rustRun(ctx, rand() * W, rand() * H * 0.4, 5 + rand() * 8, 50 + rand() * 90, rand, 0.85);
    }
    /* 水の垂れ跡（無彩色） */
    for (var s2 = 0; s2 < 16; s2++) {
      var sx = rand() * W, sw = 4 + rand() * 14, sh = 70 + rand() * 420;
      var gr = ctx.createLinearGradient(0, 0, 0, sh);
      gr.addColorStop(0, 'rgba(74,72,62,0.30)');
      gr.addColorStop(1, 'rgba(74,72,62,0)');
      ctx.fillStyle = gr; ctx.fillRect(sx, 0, sw, sh);
    }
    /* しみ */
    for (var t = 0; t < 16; t++) {
      blot(ctx, rand() * W, rand() * H, 30 + rand() * 90, 'rgba(88,80,58,0.26)');
    }
    /* ひび */
    for (var k = 0; k < 7; k++) {
      crack(ctx, rand() * W, rand() * H, 90 + rand() * 160, rand() * 6.28, rand, 0);
    }
    /* 床際のカビ・黒ずみ（幾何AOと二重掛けにして接地を締める） */
    var gm = ctx.createLinearGradient(0, H, 0, H - 190);
    gm.addColorStop(0, 'rgba(26,32,28,0.80)');
    gm.addColorStop(0.45, 'rgba(30,36,32,0.34)');
    gm.addColorStop(1, 'rgba(30,36,32,0)');
    ctx.fillStyle = gm; ctx.fillRect(0, H - 190, W, 190);
    /* 天井際も少し落とす */
    var gt = ctx.createLinearGradient(0, 0, 0, 90);
    gt.addColorStop(0, 'rgba(20,24,26,0.42)');
    gt.addColorStop(1, 'rgba(20,24,26,0)');
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 90);

    /* 幅木 */
    ctx.fillStyle = '#464d52'; ctx.fillRect(0, H - 46, W, 46);
    ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(0, H - 46, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, H - 8, W, 8);
    /* 幅木の錆・剥げ */
    for (var bb = 0; bb < 26; bb++) {
      ctx.fillStyle = 'rgba(98,78,50,' + (0.25 + rand() * 0.4) + ')';
      ctx.fillRect(rand() * W, H - 44 + rand() * 34, 3 + rand() * 20, 2 + rand() * 8);
    }

    /* ---- P4.11 項目7: 質感の上乗せ（1024x1536で読める細部） ---- */
    /* 手が触れる腰高の帯だけ艶が出る（人の動線が壁に残る） */
    var hb = ctx.createLinearGradient(0, H - 350, 0, H - 150);
    hb.addColorStop(0, 'rgba(214,210,200,0)');
    hb.addColorStop(0.5, 'rgba(214,210,200,0.11)');
    hb.addColorStop(1, 'rgba(214,210,200,0)');
    ctx.fillStyle = hb; ctx.fillRect(0, H - 350, W, 200);
    /* 台車・担架がぶつかった擦り傷（横方向・腰高に集中） */
    scuff(ctx, 520, rand, 'rgba(64,60,54,0.22)', 0, 34);
    pxSpace(ctx, function (pw, ph) {
      ctx.strokeStyle = 'rgba(52,50,44,0.30)'; ctx.lineWidth = 1;
      for (var i = 0; i < 260; i++) {
        var y = ph * 0.52 + (rand() - 0.5) * ph * 0.16, x = rand() * pw;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20 + rand() * 90, y + (rand() - 0.5) * 4); ctx.stroke();
      }
    });
    /* 飛沫（薬品・血の古い染み）。粒が散る＝面が均一に見えない */
    for (var spl = 0; spl < 26; spl++) {
      var sx3 = rand() * W, sy3 = rand() * H * 0.85;
      var col3 = (rand() < 0.35) ? '86,40,32' : '92,84,52';
      for (var dp = 0; dp < 22; dp++) {
        var rr3 = rand() * 34;
        ctx.fillStyle = 'rgba(' + col3 + ',' + (0.10 + rand() * 0.30).toFixed(2) + ')';
        ctx.fillRect(sx3 + (rand() - 0.5) * rr3, sy3 + (rand() - 0.5) * rr3, 1 + rand() * 3, 1 + rand() * 3);
      }
    }
    fineGrit(ctx, 30000, rand, 'rgba(58,56,50,0.22)');
    fineGrit(ctx, 11000, rand, 'rgba(198,196,188,0.16)');
    speckle(ctx, W, H, 5200, rand, 'rgba(58,56,50,0.30)');
    speckle(ctx, W, H, 2600, rand, 'rgba(186,184,176,0.22)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /* ================================================================ */
  /* 床: リノリウム（2m x 2m / 512 x 512）                              */
  /* ================================================================ */
  function texFloor() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(20240830);

    ctx.fillStyle = '#8b9088'; ctx.fillRect(0, 0, W, H);
    /* リノリウム特有の細かい斑（1〜3px） */
    for (var i = 0; i < 26000; i++) {
      var v = 96 + rand() * 104;
      ctx.fillStyle = 'rgba(' + (v | 0) + ',' + ((v + 5) | 0) + ',' + ((v - 7) | 0) + ',0.55)';
      ctx.fillRect(rand() * W, rand() * H, 1 + (rand() < 0.3 ? 1 : 0), 1 + (rand() < 0.3 ? 1 : 0));
    }
    /* シートの継ぎ目（2mごと＝セル境界）と溶接ビード */
    ctx.fillStyle = 'rgba(70,74,70,0.62)';
    ctx.fillRect(0, 0, W, 4); ctx.fillRect(0, 0, 4, H);
    ctx.fillStyle = 'rgba(150,154,146,0.30)';
    ctx.fillRect(0, 4, W, 2); ctx.fillRect(4, 0, 2, H);
    /* 目地に溜まった黒い汚れ */
    for (var e = 0; e < 240; e++) {
      ctx.fillStyle = 'rgba(40,44,40,' + (0.2 + rand() * 0.4) + ')';
      if (rand() < 0.5) ctx.fillRect(rand() * W, rand() * 5, 2 + rand() * 14, 3);
      else ctx.fillRect(rand() * 5, rand() * H, 3, 2 + rand() * 14);
    }
    /* こすれ跡（円弧） */
    for (var s = 0; s < 60; s++) {
      ctx.strokeStyle = 'rgba(158,162,154,' + (0.18 + rand() * 0.3) + ')';
      ctx.lineWidth = 1 + rand() * 3;
      ctx.beginPath();
      var x = rand() * W, y = rand() * H, a = rand() * Math.PI * 2, r = 30 + rand() * 150;
      ctx.arc(x, y, r, a, a + 0.3 + rand() * 1.0);
      ctx.stroke();
    }
    /* 引きずり跡 */
    for (var d = 0; d < 9; d++) {
      ctx.strokeStyle = 'rgba(58,56,48,' + (0.18 + rand() * 0.24) + ')';
      ctx.lineWidth = 4 + rand() * 8;
      ctx.beginPath();
      var px = rand() * W, py = rand() * H;
      ctx.moveTo(px, py);
      ctx.lineTo(px + (rand() - 0.5) * 400, py + (rand() - 0.5) * 400);
      ctx.stroke();
    }
    /* めくれ・欠損（下地のコンクリが出る） */
    for (var k = 0; k < 5; k++) {
      var hx = rand() * W, hy = rand() * H, hr = 10 + rand() * 34;
      ctx.beginPath();
      for (var p = 0; p <= 12; p++) {
        var aa = p / 12 * Math.PI * 2, rr = hr * (0.6 + rand() * 0.6);
        var qx = hx + Math.cos(aa) * rr, qy = hy + Math.sin(aa) * rr;
        if (p === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
      }
      ctx.closePath();
      ctx.fillStyle = '#6d6f68'; ctx.fill();
      ctx.strokeStyle = 'rgba(40,42,38,0.6)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.clip();
      speckle(ctx, W, H, 3000, rand, 'rgba(96,98,92,0.6)');
      ctx.restore();
    }
    /* 動線＝中央に沿った摩耗（人が通る帯だけ艶が出て明るい） */
    var wear = ctx.createLinearGradient(0, H * 0.5 - 150, 0, H * 0.5 + 150);
    wear.addColorStop(0, 'rgba(196,200,192,0)');
    wear.addColorStop(0.5, 'rgba(196,200,192,0.20)');
    wear.addColorStop(1, 'rgba(196,200,192,0)');
    ctx.fillStyle = wear; ctx.fillRect(0, 0, W, H);
    /* 引きずり跡（動線方向＝横方向に強く伸ばす） */
    for (var dr2 = 0; dr2 < 16; dr2++) {
      ctx.strokeStyle = 'rgba(72,70,62,' + (0.10 + rand() * 0.22) + ')';
      ctx.lineWidth = 2 + rand() * 7;
      ctx.beginPath();
      var dy0 = rand() * H;
      ctx.moveTo(-20, dy0);
      ctx.bezierCurveTo(W * 0.3, dy0 + (rand() - 0.5) * 40, W * 0.7, dy0 + (rand() - 0.5) * 40, W + 20, dy0 + (rand() - 0.5) * 30);
      ctx.stroke();
    }
    /* 汚れだまり（重力＝下方向へ尾を引く） */
    for (var t = 0; t < 22; t++) {
      var bx2 = rand() * W, by2 = rand() * H, br2 = 34 + rand() * 120;
      blot(ctx, bx2, by2, br2, 'rgba(62,60,50,0.26)');
      var tg = ctx.createLinearGradient(0, by2, 0, by2 + br2 * 1.3);
      tg.addColorStop(0, 'rgba(58,56,46,0.22)');
      tg.addColorStop(1, 'rgba(58,56,46,0)');
      ctx.fillStyle = tg; ctx.fillRect(bx2 - br2 * 0.4, by2, br2 * 0.8, br2 * 1.3);
    }
    /* 乾いた水跡の輪 */
    for (var w2 = 0; w2 < 7; w2++) {
      ctx.strokeStyle = 'rgba(70,74,66,0.30)'; ctx.lineWidth = 2 + rand() * 3;
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * H, 20 + rand() * 70, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* ---- P4.11 項目7: 方向性のある擬似スペキュラ＋通路の継ぎ目＋擦れの粒 ---- */
    sheen(ctx, W, H, 4, rand, 0, 'rgba(228,234,236,%A%)');
    sheen(ctx, W, H, 2, rand, 1.5708, 'rgba(228,234,236,%A%)');
    /* マス境界＝通路の継ぎ目（2mごと）。影と受け光の2本で段差に見せる */
    ctx.fillStyle = 'rgba(26,28,26,0.50)'; ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, 0, 3, H);
    ctx.fillStyle = 'rgba(198,202,196,0.16)'; ctx.fillRect(0, 3, W, 2); ctx.fillRect(3, 0, 2, H);
    scuff(ctx, 1500, rand, 'rgba(212,218,214,0.10)', 0, 52);
    scuff(ctx, 900, rand, 'rgba(40,42,38,0.14)', 0, 40);
    fineGrit(ctx, 30000, rand, 'rgba(44,44,38,0.24)');
    fineGrit(ctx, 10000, rand, 'rgba(196,200,192,0.14)');
    speckle(ctx, W, H, 6000, rand, 'rgba(46,46,40,0.30)');
    grain(ctx, W, H, 9, rand);
    return c;
  }

  /* ================================================================ */
  /* 天井: システム天井（2m x 2m = 0.5m角パネル 4x4 / 384 x 384）        */
  /* ================================================================ */
  function texCeiling() {
    var W = 384, H = 384, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(99117);
    ctx.fillStyle = '#7c837e'; ctx.fillRect(0, 0, W, H);
    var PS = 96;
    for (var py = 0; py < 4; py++) {
      for (var px = 0; px < 4; px++) {
        var v = 104 + rand() * 40;
        ctx.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 3) | 0) + ',' + ((v - 2) | 0) + ')';
        ctx.fillRect(px * PS + 3, py * PS + 3, PS - 6, PS - 6);
        /* 吸音孔（1.5px） */
        ctx.fillStyle = 'rgba(58,62,58,0.42)';
        for (var d = 0; d < 420; d++) {
          ctx.fillRect(px * PS + 6 + rand() * (PS - 12), py * PS + 6 + rand() * (PS - 12), 2, 2);
        }
        var roll = rand();
        if (roll < 0.10) {
          /* 脱落＝暗い穴。奥の梁がわずかに見える */
          ctx.fillStyle = '#151a1d';
          ctx.fillRect(px * PS + 4, py * PS + 4, PS - 8, PS - 8);
          ctx.fillStyle = 'rgba(66,72,78,0.42)';
          ctx.fillRect(px * PS + 4, py * PS + 4, PS - 8, 6);
          ctx.fillStyle = 'rgba(52,58,62,0.35)';
          ctx.fillRect(px * PS + PS * 0.45, py * PS + 4, 7, PS - 8);
        } else if (roll < 0.34) {
          /* 雨漏りのしみ（輪郭が濃い） */
          var sx = px * PS + PS * 0.5, sy = py * PS + PS * 0.5;
          blot(ctx, sx, sy, 46, 'rgba(116,92,46,0.40)');
          ctx.strokeStyle = 'rgba(96,72,34,0.42)'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(sx, sy, 26 + rand() * 12, 0, Math.PI * 2); ctx.stroke();
        } else if (roll < 0.46) {
          /* たわみ＝端が浮いて影が出る */
          ctx.fillStyle = 'rgba(24,28,30,0.35)';
          ctx.fillRect(px * PS + 4, py * PS + 4, PS - 8, 10);
        }
      }
    }
    /* Tバー */
    ctx.fillStyle = 'rgba(166,172,168,0.92)';
    for (var gx = 0; gx <= W; gx += PS) ctx.fillRect(gx - 3, 0, 6, H);
    for (var gy = 0; gy <= H; gy += PS) ctx.fillRect(0, gy - 3, W, 6);
    ctx.fillStyle = 'rgba(48,52,50,0.55)';
    for (var gx2 = 0; gx2 <= W; gx2 += PS) ctx.fillRect(gx2 + 3, 0, 2, H);
    for (var gy2 = 0; gy2 <= H; gy2 += PS) ctx.fillRect(0, gy2 + 3, W, 2);

    /* ---- P4.11 項目7: 天井の染み（漏水が広がった輪＋芯）と埃の粒 ---- */
    for (var stn = 0; stn < 7; stn++) {
      var cx4 = rand() * W, cy4 = rand() * H, r4 = 22 + rand() * 62;
      blot(ctx, cx4, cy4, r4, 'rgba(108,86,44,0.30)');
      ctx.strokeStyle = 'rgba(84,64,30,0.26)'; ctx.lineWidth = 2;
      for (var rg = 0; rg < 3; rg++) {
        ctx.beginPath(); ctx.arc(cx4, cy4, r4 * (0.38 + rg * 0.24), 0, Math.PI * 2); ctx.stroke();
      }
      blot(ctx, cx4, cy4, r4 * 0.32, 'rgba(52,38,18,0.34)');
    }
    fineGrit(ctx, 22000, rand, 'rgba(48,50,46,0.22)');
    fineGrit(ctx, 7000, rand, 'rgba(190,192,186,0.12)');
    speckle(ctx, W, H, 3000, rand, 'rgba(52,54,50,0.28)');
    grain(ctx, W, H, 7, rand);
    return c;
  }

  /* ================================================================ */
  /* 金属: 塗装鋼板（ロッカー・扉・機械 / 384 x 384）                     */
  /* ================================================================ */
  function texMetal() {
    var W = 384, H = 384, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(4242);
    ctx.fillStyle = '#5d646b'; ctx.fillRect(0, 0, W, H);
    /* ヘアライン */
    for (var i = 0; i < 2600; i++) {
      var y = rand() * H, a = 0.04 + rand() * 0.10;
      ctx.strokeStyle = (rand() < 0.5) ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + (rand() - 0.5) * 3); ctx.stroke();
    }
    /* 塗膜の剥げ（下地の生地色） */
    for (var p = 0; p < 22; p++) {
      var bx = rand() * W, by = rand() * H, br = 5 + rand() * 20;
      ctx.beginPath();
      for (var q = 0; q <= 9; q++) {
        var aa = q / 9 * Math.PI * 2, rr = br * (0.55 + rand() * 0.7);
        var qx = bx + Math.cos(aa) * rr, qy = by + Math.sin(aa) * rr;
        if (q === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(124,120,112,0.8)'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,32,30,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    /* 錆だれ（縦）。P4.17 項目1: 14本→3本・長さ短縮 */
    for (var r = 0; r < RUST_RUNS.metal; r++) {
      rustRun(ctx, rand() * W, rand() * H * 0.6, 5 + rand() * 8, 40 + rand() * 70, rand, 0.9);
    }
    /* 錆の点（P4.17 項目1: 赤茶→茶・数も半分） */
    speckle(ctx, W, H, 1100, rand, 'rgba(98,82,58,0.32)');
    /* 傷 */
    for (var s = 0; s < 40; s++) {
      ctx.strokeStyle = 'rgba(198,206,212,' + (0.16 + rand() * 0.3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      var x = rand() * W, y2 = rand() * H;
      ctx.moveTo(x, y2); ctx.lineTo(x + (rand() - 0.5) * 110, y2 + (rand() - 0.5) * 110);
      ctx.stroke();
    }
    /* 下端の溜まり汚れ */
    var gm = ctx.createLinearGradient(0, H, 0, H - 70);
    gm.addColorStop(0, 'rgba(22,26,26,0.6)');
    gm.addColorStop(1, 'rgba(22,26,26,0)');
    ctx.fillStyle = gm; ctx.fillRect(0, H - 70, W, 70);
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /* ================================================================ */
  /* 蛍光灯パネル（発光面）                                             */
  /* ================================================================ */
  function texLamp() {
    var W = 128, H = 64, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(4711);
    ctx.fillStyle = '#dfeaf6'; ctx.fillRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(120,146,176,0.68)');
    g.addColorStop(0.24, 'rgba(255,255,255,0)');
    g.addColorStop(0.76, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(120,146,176,0.68)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* 管の切れ目・端の黒ずみ・虫の死骸 */
    ctx.fillStyle = 'rgba(44,50,58,0.9)';
    ctx.fillRect(0, 0, 8, H); ctx.fillRect(W - 8, 0, 8, H);
    ctx.fillStyle = 'rgba(78,88,98,0.42)';
    ctx.fillRect(W * 0.5 - 2, 0, 5, H);
    ctx.fillStyle = 'rgba(40,36,30,0.55)';
    for (var i = 0; i < 14; i++) ctx.fillRect(10 + rand() * (W - 24), 6 + rand() * (H - 14), 2 + rand() * 4, 2);
    return c;
  }

  /* ================================================================ */
  /* 端末画面（発光）                                                   */
  /* ================================================================ */
  function texScreen() {
    var W = 128, H = 96, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(777);
    ctx.fillStyle = '#07130f'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(70,200,152,0.88)';
    for (var i = 0; i < 11; i++) {
      var y = 8 + i * 8;
      ctx.fillRect(8, y, 10 + rand() * 96, 3);
    }
    ctx.fillStyle = 'rgba(238,172,64,0.95)';
    ctx.fillRect(8, 8, 60, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    for (var s = 0; s < H; s += 3) ctx.fillRect(0, s, W, 1);
    return c;
  }

  /* ================================================================ */
  /* 紙のメモ                                                          */
  /* ================================================================ */
  function texPaper() {
    var W = 256, H = 320, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(31415);
    ctx.fillStyle = '#d8d1bb'; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < 14; i++) blot(ctx, rand() * W, rand() * H, 22 + rand() * 60, 'rgba(146,124,80,0.24)');
    ctx.fillStyle = 'rgba(44,42,38,0.8)';
    for (var l = 0; l < 15; l++) {
      var y = 44 + l * 17;
      ctx.fillRect(26, y, 46 + rand() * 168, 4);
    }
    ctx.strokeStyle = 'rgba(150,40,34,0.85)'; ctx.lineWidth = 5;
    ctx.strokeRect(150, 224, 80, 58);
    ctx.fillStyle = 'rgba(150,40,34,0.5)'; ctx.fillRect(162, 244, 56, 7);
    /* 折り目と留めピンの影 */
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(0, H * 0.42, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, 5); ctx.fillRect(0, H - 5, W, 5);
    speckle(ctx, W, H, 1600, rand, 'rgba(120,108,80,0.28)');
    return c;
  }

  /* ================================================================ */
  /* 布・段ボール（マットレス／木箱）                                    */
  /* ================================================================ */
  function texSheet() {
    var W = 256, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(2468);
    ctx.fillStyle = '#bdb8a8'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(146,140,126,0.34)'; ctx.lineWidth = 1;
    for (var i = 0; i < W; i += 5) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(102,96,84,0.34)'; ctx.lineWidth = 3;
    for (var k = 0; k < 11; k++) {
      ctx.beginPath();
      var x = rand() * W, y = rand() * H;
      ctx.moveTo(x, y);
      for (var q = 0; q < 4; q++) { x += (rand() - 0.5) * 120; y += (rand() - 0.5) * 120; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (var b = 0; b < 14; b++) blot(ctx, rand() * W, rand() * H, 14 + rand() * 52, 'rgba(120,104,74,0.26)');
    speckle(ctx, W, H, 3400, rand, 'rgba(96,90,76,0.24)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /* ================================================================ */
  /* 水たまり（アルファ）                                               */
  /* ================================================================ */
  function texWater() {
    var W = 256, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(5150);
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    var cx = 128, cy = 128, pts = 26;
    for (var i = 0; i <= pts; i++) {
      var a = i / pts * Math.PI * 2;
      var r = 80 + Math.sin(a * 3.1) * 16 + Math.sin(a * 5.7) * 11 + rand() * 7;
      var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.86;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    var g = ctx.createRadialGradient(cx, cy, 4, cx, cy, 104);
    g.addColorStop(0, 'rgba(8,17,22,0.90)');
    g.addColorStop(0.75, 'rgba(12,23,29,0.80)');
    g.addColorStop(1, 'rgba(18,30,36,0.26)');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(184,212,234,0.28)';
    for (var s = 0; s < 12; s++) {
      ctx.lineWidth = 1 + rand() * 2.5;
      ctx.beginPath();
      var y2 = 34 + rand() * 188;
      ctx.moveTo(26 + rand() * 44, y2);
      ctx.lineTo(120 + rand() * 96, y2 + (rand() - 0.5) * 9);
      ctx.stroke();
    }
    ctx.restore();
    return c;
  }

  /* ================================================================ */
  /* ガラス片（アルファ）                                               */
  /* ================================================================ */
  function texGlass() {
    var W = 256, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(8642);
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < 82; i++) {
      var x = 12 + rand() * (W - 24), y = 12 + rand() * (H - 24);
      var s = 3 + rand() * 15;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s * (0.4 + rand()), y + s * (rand() - 0.5));
      ctx.lineTo(x + s * (rand() - 0.2), y + s * (0.5 + rand() * 0.7));
      ctx.closePath();
      ctx.fillStyle = 'rgba(190,210,222,' + (0.26 + rand() * 0.42) + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(238,250,255,0.8)';
      ctx.lineWidth = 1; ctx.stroke();
    }
    /* 粉になった細片 */
    speckle(ctx, W, H, 900, rand, 'rgba(214,228,238,0.55)');
    return c;
  }

  /* ================================================================ */
  /* 血痕（アルファ）                                                   */
  /* ================================================================ */
  function texBlood() {
    var W = 192, H = 192, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(6660);
    ctx.clearRect(0, 0, W, H);
    blot(ctx, 96, 92, 66, 'rgba(64,9,9,0.80)');
    blot(ctx, 86, 84, 36, 'rgba(40,5,5,0.86)');
    for (var i = 0; i < 40; i++) {
      var a = rand() * Math.PI * 2, r = 32 + rand() * 64;
      blot(ctx, 96 + Math.cos(a) * r, 92 + Math.sin(a) * r, 2 + rand() * 11, 'rgba(58,8,8,0.7)');
    }
    ctx.strokeStyle = 'rgba(52,6,6,0.5)'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(96, 104); ctx.lineTo(166, 176); ctx.stroke();
    speckle(ctx, W, H, 400, rand, 'rgba(46,6,6,0.5)');
    return c;
  }

  /* ================================================================ */
  /* 警告ハッチング（アルファ）: チェックポイント・出口の床標示            */
  /* ================================================================ */
  function texHatch() {
    var W = 192, H = 192, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(1212);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(198,166,52,0.85)';
    ctx.lineWidth = 18;
    for (var i = -H; i < W + H; i += 39) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'destination-out';
    for (var k = 0; k < 90; k++) {
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * H, 2 + rand() * 15, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.4 + rand() * 0.6) + ')'; ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(36,38,36,0.5)'; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    return c;
  }

  /* ================================================================ */
  /* 壁の貼り紙（2x2アトラス・アルファ）: 警告 / 書類 / 図面 / 剥がれかけ    */
  /* ================================================================ */
  function texPoster() {
    var S = 256, W = S * 2, H = S * 2, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(24680);
    ctx.clearRect(0, 0, W, H);

    function sheet(ox, oy, bg, edge) {
      ctx.fillStyle = bg;
      ctx.fillRect(ox + 12, oy + 10, S - 24, S - 20);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(ox + 12, oy + 10, S - 24, 4);
      if (edge) {
        ctx.globalCompositeOperation = 'destination-out';
        for (var i = 0; i < 26; i++) {
          ctx.beginPath();
          ctx.arc(ox + 12 + rand() * (S - 24), oy + 10 + (rand() < 0.5 ? 0 : S - 20) + (rand() - 0.5) * 22,
            3 + rand() * 12, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    /* (0,0) 警告標識 */
    sheet(0, 0, '#d8c94a', false);
    ctx.fillStyle = '#1c1c18';
    ctx.beginPath(); ctx.moveTo(128, 46); ctx.lineTo(196, 150); ctx.lineTo(60, 150); ctx.closePath();
    ctx.lineWidth = 9; ctx.strokeStyle = '#1c1c18'; ctx.stroke();
    ctx.fillRect(122, 78, 12, 44); ctx.fillRect(122, 128, 12, 12);
    for (var i0 = 0; i0 < 4; i0++) ctx.fillRect(44 + rand() * 12, 172 + i0 * 14, 120 + rand() * 40, 6);
    /* (1,0) 書類・掲示 */
    sheet(S, 0, '#ddd8c8', true);
    ctx.fillStyle = 'rgba(40,38,34,0.82)';
    ctx.fillRect(S + 30, 30, 130, 12);
    for (var i1 = 0; i1 < 12; i1++) ctx.fillRect(S + 30, 62 + i1 * 14, 60 + rand() * 150, 5);
    ctx.strokeStyle = 'rgba(150,40,34,0.8)'; ctx.lineWidth = 5;
    ctx.strokeRect(S + 150, 176, 74, 48);
    /* (0,1) 図面（褪せた青焼き。彩度は抑える） */
    sheet(0, S, '#4a5a63', false);
    ctx.strokeStyle = 'rgba(206,216,222,0.62)'; ctx.lineWidth = 2;
    for (var i2 = 0; i2 < 7; i2++) {
      ctx.strokeRect(34 + rand() * 60, S + 34 + rand() * 60, 40 + rand() * 110, 30 + rand() * 100);
    }
    ctx.lineWidth = 1;
    for (var g2 = 30; g2 < S - 20; g2 += 18) {
      ctx.strokeStyle = 'rgba(178,190,196,0.16)';
      ctx.beginPath(); ctx.moveTo(20, S + g2); ctx.lineTo(S - 20, S + g2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g2, S + 16); ctx.lineTo(g2, S + S - 16); ctx.stroke();
    }
    /* (1,1) 剥がれかけのポスター */
    sheet(S, S, '#b9b0a0', true);
    ctx.fillStyle = 'rgba(120,40,34,0.72)';
    ctx.fillRect(S + 28, S + 30, S - 56, 60);
    ctx.fillStyle = 'rgba(40,38,34,0.6)';
    for (var i3 = 0; i3 < 8; i3++) ctx.fillRect(S + 30, S + 108 + i3 * 16, 70 + rand() * 140, 6);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(S + S - 14, S + S - 14); ctx.lineTo(S + S - 100, S + S - 14); ctx.lineTo(S + S - 14, S + 96);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    for (var k = 0; k < 4; k++) {
      var ox = (k & 1) * S, oy = (k >> 1) * S;
      ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, S, S); ctx.clip();
      for (var b = 0; b < 6; b++) blot(ctx, ox + rand() * S, oy + rand() * S, 18 + rand() * 44, 'rgba(90,76,44,0.22)');
      ctx.restore();
    }
    return c;
  }

  /* ================================================================ */
  /* 床の散乱物（2x2アトラス・アルファ）: 書類 / ケーブル / 瓦礫 / ゴミ      */
  /* ================================================================ */
  function texLitter() {
    var S = 256, W = S * 2, H = S * 2, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(13579);
    ctx.clearRect(0, 0, W, H);

    /* (0,0) 散らばった書類 */
    for (var i = 0; i < 13; i++) {
      var x = 40 + rand() * (S - 80), y = 40 + rand() * (S - 80), a = rand() * Math.PI;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(214,208,190,' + (0.62 + rand() * 0.3) + ')';
      ctx.fillRect(-26, -18, 52, 36);
      ctx.fillStyle = 'rgba(60,58,52,0.5)';
      for (var l = 0; l < 4; l++) ctx.fillRect(-20, -12 + l * 7, 16 + rand() * 24, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-26, 14, 52, 4);
      ctx.restore();
    }
    /* (1,0) ケーブルとコネクタ */
    for (var k = 0; k < 5; k++) {
      ctx.strokeStyle = 'rgba(48,48,52,' + (0.7 + rand() * 0.3) + ')';
      ctx.lineWidth = 6 + rand() * 7;
      ctx.beginPath();
      var px = S + 24 + rand() * 60, py = 30 + rand() * 180;
      ctx.moveTo(px, py);
      for (var q = 0; q < 4; q++) {
        px += 30 + rand() * 40; py += (rand() - 0.5) * 90;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,120,126,0.30)'; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(112,112,118,0.9)';
      ctx.fillRect(px - 10, py - 8, 20, 16);
      ctx.fillStyle = 'rgba(40,40,44,0.8)';
      ctx.fillRect(px - 6, py - 4, 12, 8);
    }
    /* (0,1) 瓦礫・割れたタイル */
    for (var m = 0; m < 44; m++) {
      var rx = 24 + rand() * (S - 48), ry = S + 24 + rand() * (S - 48), rs = 9 + rand() * 26;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + rs * (0.4 + rand()), ry + rs * (rand() - 0.5));
      ctx.lineTo(rx + rs * (rand() - 0.3), ry + rs * (0.4 + rand() * 0.8));
      ctx.closePath();
      var gv = 132 + rand() * 74;                       /* 無彩色に寄せる（色相が出ないように） */
      ctx.fillStyle = 'rgba(' + (gv | 0) + ',' + ((gv + 2) | 0) + ',' + ((gv - 6) | 0) + ',0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(28,30,28,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    speckle(ctx, S, S, 500, rand, 'rgba(120,118,108,0.45)');
    /* (1,1) ゴミ・こぼれた汚れ */
    ctx.save(); ctx.translate(S, S);
    blot(ctx, 128, 128, 96, 'rgba(44,40,30,0.42)');
    for (var t = 0; t < 26; t++) {
      var tv = 118 + rand() * 84;                       /* くすんだ紙・包装。彩度は乗せない */
      var warm = rand() < 0.35 ? 12 : 0;
      ctx.fillStyle = 'rgba(' + ((tv + warm) | 0) + ',' + (tv | 0) + ',' + ((tv - warm - 8) | 0) + ',0.78)';
      var wx = 40 + rand() * 176, wy = 40 + rand() * 176;
      ctx.save(); ctx.translate(wx, wy); ctx.rotate(rand() * 3.14);
      ctx.fillRect(-11, -6, 22 + rand() * 18, 12);
      ctx.fillStyle = 'rgba(40,40,38,0.35)'; ctx.fillRect(-11, 4, 22 + rand() * 18, 3);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(24,26,24,0.6)';
    for (var cbl = 0; cbl < 40; cbl++) ctx.fillRect(rand() * S, rand() * S, 2 + rand() * 5, 2 + rand() * 4);
    ctx.restore();
    return c;
  }

  /* ================================================================ */
  /* 標識（2x2アトラス・アルファ）                                       */
  /*   (0,0) バイオハザード / (1,0) 区画銘板 / (0,1) 立入禁止 / (1,1) 除染注意 */
  /* ================================================================ */
  var JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';

  function trefoil(ctx, cx, cy, r, css) {
    ctx.fillStyle = css;
    for (var k = 0; k < 3; k++) {
      var a = -Math.PI / 2 + k * Math.PI * 2 / 3;
      var ox = cx + Math.cos(a) * r * 0.62, oy = cy + Math.sin(a) * r * 0.62;
      ctx.beginPath();
      ctx.arc(ox, oy, r * 0.56, a - 2.35, a + 2.35);
      ctx.lineTo(cx + Math.cos(a) * r * 0.10, cy + Math.sin(a) * r * 0.10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.20, 0, Math.PI * 2); ctx.fill();
    /* 中心の抜き（三つ葉らしさを出す） */
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.115, 0, Math.PI * 2); ctx.fill();
    for (var m = 0; m < 3; m++) {
      var b = -Math.PI / 2 + m * Math.PI * 2 / 3;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(b) * r * 0.62, cy + Math.sin(b) * r * 0.62, r * 0.185, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function texSign() {
    var S = 256, W = S * 2, H = S * 2, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(60931);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    /* (0,0) バイオハザード */
    ctx.fillStyle = '#d9c531'; ctx.fillRect(8, 8, S - 16, S - 16);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(8, 8, S - 16, 6);
    trefoil(ctx, 128, 108, 74, '#141410');
    ctx.fillStyle = '#141410';
    ctx.font = 'bold 30px ' + JP;
    ctx.fillText('生物災害', 128, 200);
    ctx.font = 'bold 15px ' + JP;
    ctx.fillText('BIOHAZARD  LEVEL 3', 128, 226);

    /* (1,0) 区画銘板 */
    ctx.fillStyle = '#20262a'; ctx.fillRect(S + 8, 10, S - 16, S - 20);
    ctx.strokeStyle = '#59636a'; ctx.lineWidth = 4;
    ctx.strokeRect(S + 16, 18, S - 32, S - 36);
    ctx.fillStyle = '#cfd8dc';
    ctx.font = 'bold 64px ' + JP;
    ctx.fillText('B-3', S + 128, 84);
    ctx.font = 'bold 34px ' + JP;
    ctx.fillText('実験区画', S + 128, 146);
    ctx.fillStyle = '#8d979c';
    ctx.font = '19px ' + JP;
    ctx.fillText('検体管理棟 / SPECIMEN', S + 128, 196);
    ctx.fillStyle = 'rgba(212,84,40,0.55)';
    for (var i = 0; i < 5; i++) ctx.fillRect(S + 20 + rand() * 200, 24 + rand() * 200, 3 + rand() * 8, 22 + rand() * 40);

    /* (0,1) 立入禁止 */
    ctx.fillStyle = '#dedad0'; ctx.fillRect(10, S + 10, S - 20, S - 20);
    ctx.strokeStyle = '#a8291f'; ctx.lineWidth = 12;
    ctx.strokeRect(22, S + 22, S - 44, S - 44);
    ctx.fillStyle = '#a8291f';
    ctx.font = 'bold 52px ' + JP;
    ctx.fillText('立入禁止', 128, S + 100);
    ctx.fillStyle = '#33312c';
    ctx.font = 'bold 20px ' + JP;
    ctx.fillText('AUTHORIZED PERSONNEL ONLY', 128, S + 150);
    ctx.font = '17px ' + JP;
    ctx.fillText('防護具着用のこと', 128, S + 182);
    ctx.fillText('第三種病原体取扱区域', 128, S + 208);

    /* (1,1) 除染・警告 */
    ctx.fillStyle = '#1d2622'; ctx.fillRect(S + 10, S + 10, S - 20, S - 20);
    ctx.fillStyle = '#d9c531';
    for (var k = -S; k < S; k += 34) {
      ctx.save(); ctx.beginPath(); ctx.rect(S + 10, S + 10, S - 20, 30); ctx.clip();
      ctx.beginPath(); ctx.moveTo(S + k, S + 40); ctx.lineTo(S + k + 17, S + 10);
      ctx.lineTo(S + k + 34, S + 10); ctx.lineTo(S + k + 17, S + 40); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#5fd6a8';
    ctx.font = 'bold 40px ' + JP;
    ctx.fillText('除染区域', S + 128, S + 96);
    ctx.fillStyle = '#c8d2cc';
    ctx.font = '19px ' + JP;
    ctx.fillText('DECONTAMINATION', S + 128, S + 140);
    ctx.fillText('滅菌後に退出すること', S + 128, S + 172);
    ctx.strokeStyle = 'rgba(95,214,168,0.5)'; ctx.lineWidth = 3;
    ctx.strokeRect(S + 24, S + 62, S - 48, S - 108);

    /* 全パネル共通の汚れ・褪色 */
    for (var q = 0; q < 4; q++) {
      var ox = (q & 1) * S, oy = (q >> 1) * S;
      ctx.save(); ctx.beginPath(); ctx.rect(ox + 8, oy + 8, S - 16, S - 16); ctx.clip();
      for (var b = 0; b < 7; b++) blot(ctx, ox + rand() * S, oy + rand() * S, 12 + rand() * 40, 'rgba(60,50,30,0.20)');
      rustRun(ctx, ox + 20 + rand() * (S - 40), oy + 12, 5, 40 + rand() * 60, rand, 0.30);
      ctx.restore();
    }
    return c;
  }

  /* ================================================================ */
  /* 検体タンクの液体（2x2アトラス・発光）: 液中のシルエット＋気泡          */
  /* ================================================================ */
  function texTankFluid() {
    var S = 128, W = S * 2, H = S * 4, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(80017);

    function body(ox, oy, kind, tint) {
      /* 液体 */
      var g = ctx.createLinearGradient(ox, oy, ox, oy + S * 2);
      g.addColorStop(0, tint[0]); g.addColorStop(0.55, tint[1]); g.addColorStop(1, tint[2]);
      ctx.fillStyle = g; ctx.fillRect(ox, oy, S, S * 2);
      /* 液中のシルエット。輪郭がぼやけた実体が浮いている（拡大コピーを重ねて滲ませる） */
      ctx.save();
      ctx.beginPath(); ctx.rect(ox, oy, S, S * 2); ctx.clip();
      var cx = ox + S / 2, cy = oy + S * 1.02;

      /** 漂う人型。rot=傾き、mir=左右反転、gw=滲みの倍率 */
      function humanoid(gw, al, rot, mir) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(mir * gw, gw);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        var css = 'rgba(3,9,7,' + al + ')';
        ctx.fillStyle = css; ctx.strokeStyle = css;
        /* 胴（肋の見える痩せた胴） */
        ctx.beginPath(); ctx.ellipse(0, 6, 16, 39, 0.05, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-1, -20, 20, 17, 0.12, 0, Math.PI * 2); ctx.fill();
        /* 首と俯いた頭 */
        ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(4, -45); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(6, -55, 12.5, 14.5, 0.30, 0, Math.PI * 2); ctx.fill();
        /* 漂う髪 */
        ctx.lineWidth = 1.9;
        for (var hr = 0; hr < 5; hr++) {
          ctx.beginPath();
          ctx.moveTo(6 + (hr - 2) * 2.6, -65);
          ctx.quadraticCurveTo(9 + (hr - 2) * 5, -74 - hr, 1 + (hr - 2) * 7, -78 - hr);
          ctx.stroke();
        }
        /* 力の抜けた腕 */
        ctx.lineWidth = 8.5;
        ctx.beginPath(); ctx.moveTo(-15, -20); ctx.quadraticCurveTo(-36, -6, -41, 24); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(16, -18); ctx.quadraticCurveTo(35, 4, 30, 33); ctx.stroke();
        ctx.lineWidth = 5.5;
        ctx.beginPath(); ctx.moveTo(-41, 24); ctx.lineTo(-45, 33); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(30, 33); ctx.lineTo(33, 42); ctx.stroke();
        /* 垂れた脚 */
        ctx.lineWidth = 10.5;
        ctx.beginPath(); ctx.moveTo(-8, 40); ctx.quadraticCurveTo(-16, 66, -11, 90); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(9, 40); ctx.quadraticCurveTo(18, 62, 12, 88); ctx.stroke();
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-11, 90); ctx.lineTo(-16, 97); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(12, 88); ctx.lineTo(18, 95); ctx.stroke();
        /* 呼吸管 */
        ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(8, -60); ctx.quadraticCurveTo(26, -84, 22, -112); ctx.stroke();
        ctx.restore();
      }

      for (var pass = 0; pass < 5; pass++) {
        var al = [0.13, 0.18, 0.26, 0.42, 0.80][pass];
        var gw = [1.34, 1.22, 1.12, 1.05, 1.0][pass];
        ctx.fillStyle = 'rgba(3,9,7,' + al + ')';
        if (kind === 0 || kind === 2) {
          humanoid(gw, al, (kind === 0) ? 0.10 : -0.14, (kind === 0) ? 1 : -1);
        } else if (kind === 1) {
          /* 丸まった小型の個体 */
          ctx.save(); ctx.translate(cx + 2, cy + S * 0.16); ctx.scale(gw, gw);
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(3,9,7,' + al + ')';
          ctx.beginPath(); ctx.ellipse(4, 4, 32, 25, 0.34, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(-24, -12, 15, 14, 0, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 7;
          ctx.beginPath(); ctx.moveTo(-14, 10); ctx.quadraticCurveTo(-26, 24, -20, 34); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(20, 18); ctx.quadraticCurveTo(30, 30, 24, 40); ctx.stroke();
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(30, -4); ctx.quadraticCurveTo(52, 6, 48, 34); ctx.stroke();
          ctx.restore();
        } else {
          /* 空になった房（濁りと沈殿物、こびりついた手形） */
          ctx.fillStyle = 'rgba(6,14,11,' + (al * 0.7) + ')';
          ctx.beginPath();
          ctx.ellipse(cx, oy + S * 1.90, 48 * gw, 14 * gw, 0, 0, Math.PI * 2); ctx.fill();
          if (pass === 2) {
            ctx.fillStyle = 'rgba(8,18,14,0.55)';
            for (var fg = 0; fg < 5; fg++) {
              ctx.beginPath();
              ctx.ellipse(cx - 22 + fg * 10, oy + S * 0.86 - Math.abs(fg - 2) * 5, 3.4, 11, 0, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.beginPath(); ctx.ellipse(cx - 2, oy + S * 0.96, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      /* 気泡（細かく・上ほど密に） */
      for (var b = 0; b < 54; b++) {
        var bx = ox + 8 + rand() * (S - 16);
        var t2 = rand();
        var by = oy + S * 2 * (t2 * t2);
        var br = 0.5 + rand() * 1.5;
        ctx.fillStyle = 'rgba(178,236,214,' + (0.12 + rand() * 0.30) + ')';
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      }
      /* 気泡の列（曝気管から立ちのぼる） */
      for (var bb = 0; bb < 16; bb++) {
        var byy = oy + S * 1.94 - bb * (S * 0.115);
        ctx.fillStyle = 'rgba(210,255,236,' + (0.44 - bb * 0.022) + ')';
        ctx.beginPath();
        ctx.arc(cx + 34 + Math.sin(bb * 1.1) * 5, byy, 1.2 + bb * 0.16, 0, Math.PI * 2); ctx.fill();
      }
      /* ガラスの縦の映り込み */
      var gr = ctx.createLinearGradient(ox, oy, ox + S, oy);
      gr.addColorStop(0, 'rgba(214,255,242,0.13)');
      gr.addColorStop(0.15, 'rgba(255,255,255,0.01)');
      gr.addColorStop(0.72, 'rgba(255,255,255,0.0)');
      gr.addColorStop(0.87, 'rgba(214,255,242,0.07)');
      gr.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = gr; ctx.fillRect(ox, oy, S, S * 2);
      /* 上下の液面・沈殿。下ほど濁って暗い */
      var gd = ctx.createLinearGradient(0, oy + S * 1.3, 0, oy + S * 2);
      gd.addColorStop(0, 'rgba(0,0,0,0)'); gd.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = gd; ctx.fillRect(ox, oy + S * 1.3, S, S * 0.7);
      ctx.fillStyle = 'rgba(150,232,204,0.26)'; ctx.fillRect(ox, oy + 6, S, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(ox, oy + S * 2 - 11, S, 11);
      ctx.restore();
      grain(ctx, S, S * 2, 5, rand);
    }
    /* 出力はsRGB変換で持ち上がるので、素の色はかなり暗く作る */
    body(0, 0, 0, ['#0d4436', '#083026', '#031712']);
    body(S, 0, 1, ['#0f483d', '#072e29', '#021411']);
    body(0, S * 2, 2, ['#12452c', '#0a2f1f', '#03150e']);
    body(S, S * 2, 3, ['#123c42', '#08282d', '#021216']);
    return c;
  }

  /* ================================================================ */
  /* ホワイトボード（書き込み・消し跡）                                   */
  /* ================================================================ */
  function texBoard() {
    var W = 512, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(19191);
    ctx.fillStyle = '#dfe2df'; ctx.fillRect(0, 0, W, H);
    /* 消し跡 */
    for (var i = 0; i < 22; i++) {
      ctx.fillStyle = 'rgba(150,158,156,' + (0.10 + rand() * 0.16) + ')';
      ctx.save(); ctx.translate(rand() * W, rand() * H); ctx.rotate((rand() - 0.5) * 0.6);
      ctx.fillRect(-40 - rand() * 60, -10, 90 + rand() * 110, 16 + rand() * 20);
      ctx.restore();
    }
    /* 系統図: 箱と矢印 */
    var boxes = [];
    for (var b = 0; b < 6; b++) {
      var bx = 26 + rand() * (W - 150), by = 30 + rand() * (H - 100);
      var bw = 56 + rand() * 60, bh = 30 + rand() * 22;
      boxes.push([bx, by, bw, bh]);
      ctx.strokeStyle = (b % 3 === 0) ? 'rgba(160,40,36,0.82)' : 'rgba(34,48,86,0.82)';
      ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(40,52,80,0.7)';
      for (var l = 0; l < 2; l++) ctx.fillRect(bx + 8, by + 9 + l * 11, 14 + rand() * (bw - 30), 4);
    }
    ctx.strokeStyle = 'rgba(34,48,86,0.7)'; ctx.lineWidth = 2.4;
    for (var a = 0; a < 5; a++) {
      var p = boxes[a], q = boxes[a + 1];
      ctx.beginPath();
      ctx.moveTo(p[0] + p[2], p[1] + p[3] / 2);
      ctx.lineTo(q[0], q[1] + q[3] / 2);
      ctx.stroke();
    }
    /* 走り書き・数式 */
    ctx.strokeStyle = 'rgba(30,42,74,0.62)'; ctx.lineWidth = 2;
    for (var s = 0; s < 26; s++) {
      ctx.beginPath();
      var x = 20 + rand() * (W - 60), y = 20 + rand() * (H - 40);
      ctx.moveTo(x, y);
      for (var k = 0; k < 3; k++) { x += 6 + rand() * 16; y += (rand() - 0.5) * 12; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    /* 赤で囲った結論 */
    ctx.strokeStyle = 'rgba(168,38,32,0.9)'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(W * 0.72, H * 0.68, 84, 40, -0.12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(168,38,32,0.85)';
    ctx.font = 'bold 26px ' + JP;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('封鎖', W * 0.72, H * 0.68);
    grain(ctx, W, H, 6, rand);
    return c;
  }

  /* ================================================================ */
  /* モニタ壁（発光・小画面の集合）                                       */
  /* ================================================================ */
  function texMonitors() {
    var W = 256, H = 192, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(44321);
    ctx.fillStyle = '#0a0d10'; ctx.fillRect(0, 0, W, H);
    var cols = 3, rows = 2, pw = W / cols, ph = H / rows;
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var ox = i * pw + 5, oy = j * ph + 5, w = pw - 10, h = ph - 10;
        var kind = ((i + j * cols) % 4);
        ctx.fillStyle = ['#06170f', '#04121c', '#160c06', '#06170f'][kind];
        ctx.fillRect(ox, oy, w, h);
        var ink = ['rgba(80,224,160,', 'rgba(96,168,240,', 'rgba(240,168,72,', 'rgba(80,224,160,'][kind];
        if (kind === 0 || kind === 3) {
          /* 波形 */
          ctx.strokeStyle = ink + '0.92)'; ctx.lineWidth = 2;
          ctx.beginPath();
          for (var x = 0; x < w; x++) {
            var y = oy + h / 2 + Math.sin(x * 0.24 + i) * h * 0.16 * (1 + 0.6 * Math.sin(x * 0.05));
            if (x === 0) ctx.moveTo(ox + x, y); else ctx.lineTo(ox + x, y);
          }
          ctx.stroke();
        } else if (kind === 1) {
          /* 平面図・スキャン */
          ctx.strokeStyle = ink + '0.5)'; ctx.lineWidth = 1;
          for (var g = 6; g < w; g += 10) { ctx.beginPath(); ctx.moveTo(ox + g, oy + 4); ctx.lineTo(ox + g, oy + h - 4); ctx.stroke(); }
          for (var g2 = 6; g2 < h; g2 += 10) { ctx.beginPath(); ctx.moveTo(ox + 4, oy + g2); ctx.lineTo(ox + w - 4, oy + g2); ctx.stroke(); }
          ctx.strokeStyle = ink + '0.95)'; ctx.lineWidth = 2;
          ctx.strokeRect(ox + 12, oy + 12, w * 0.44, h * 0.5);
          ctx.strokeRect(ox + w * 0.5, oy + h * 0.42, w * 0.36, h * 0.4);
        } else {
          /* テキストログ */
          ctx.fillStyle = ink + '0.9)';
          for (var l = 0; l < 7; l++) ctx.fillRect(ox + 6, oy + 8 + l * 8, 12 + rand() * (w - 26), 3);
        }
        /* 走査線と枠 */
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        for (var sc = 0; sc < h; sc += 3) ctx.fillRect(ox, oy + sc, w, 1);
        ctx.strokeStyle = 'rgba(120,132,140,0.55)'; ctx.lineWidth = 3;
        ctx.strokeRect(ox - 2, oy - 2, w + 4, h + 4);
        if (rand() < 0.2) { ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(ox, oy, w, h); }  /* 落ちた画面 */
      }
    }
    return c;
  }

  /**
   * P4.8 区画銘板（docs/notes.md「区画名」）。3x2 のアトラスに A〜F の6枚。
   * 表記は正文どおり `A　受入区画` 形式（大きな英字＋施設名）。
   * 実際に読めることが「調べて地図に記入する」動線の説得力になるので文字を焼き込む。
   */
  var ZONE_PANELS = [
    ['A', '受入区画', 'RECEIVING'],
    ['B', '実験区画', 'LABORATORY'],
    ['C', '検体区画', 'SPECIMEN'],
    ['D', '拘束区画', 'CONFINEMENT'],
    ['E', '記録区画', 'ARCHIVE'],
    ['F', '機械区画', 'UTILITY']
  ];
  /* P5c: 銘板の区画名はマップ別（正文 docs/notes.md「エリア2『下水道』」＞「区画名」）。
     絵柄・寸法・アトラスの並び（3x2・A..F）は area1 と同じ＝world.js 側は名前を選ぶだけ。 */
  var ZONE_PANELS_A2 = [
    ['A', '流入区画', 'INFLOW'],
    ['B', '幹線区画', 'MAIN LINE'],
    ['C', '沈殿区画', 'SEDIMENT'],
    ['D', '機関区画', 'PUMP'],
    ['E', '旧坑区画', 'OLD GALLERY'],
    ['F', '水門区画', 'SLUICE']
  ];
  function texZoneSignOf(panels) {
    var S = 256, W = S * 3, H = S * 2, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(24601);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < 6; i++) {
      var ox = (i % 3) * S, oy = ((i / 3) | 0) * S;
      var p = panels[i];
      /* 琺瑯引きの銘板。縁は金属、地は濃紺灰 */
      ctx.fillStyle = '#3b444b'; ctx.fillRect(ox + 4, oy + 4, S - 8, S - 8);
      ctx.fillStyle = '#161c21'; ctx.fillRect(ox + 12, oy + 12, S - 24, S - 24);
      ctx.strokeStyle = '#8d9aa2'; ctx.lineWidth = 3;
      ctx.strokeRect(ox + 18, oy + 18, S - 36, S - 36);
      /* 大きな区画記号 */
      ctx.fillStyle = '#e8f1f6';
      ctx.font = 'bold 118px ' + JP;
      ctx.fillText(p[0], ox + 78, oy + 108);
      /* 施設名（縦に2行で収める） */
      ctx.fillStyle = '#cfdde5';
      ctx.font = 'bold 40px ' + JP;
      ctx.fillText(p[1].slice(0, 2), ox + 172, oy + 82);
      ctx.fillText(p[1].slice(2), ox + 172, oy + 128);
      ctx.fillStyle = '#7f8f98';
      ctx.font = '17px ' + JP;
      ctx.fillText(p[2], ox + S / 2, oy + 196);
      ctx.fillStyle = 'rgba(150,170,182,0.35)';
      ctx.fillRect(ox + 40, oy + 164, S - 80, 2);
      /* ビス4本と汚れ */
      ctx.fillStyle = '#9aa6ad';
      for (var b = 0; b < 4; b++) {
        ctx.beginPath();
        ctx.arc(ox + ((b & 1) ? S - 30 : 30), oy + ((b & 2) ? S - 30 : 30), 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(96,66,30,0.30)';
      for (var q = 0; q < 7; q++) {
        ctx.fillRect(ox + 16 + rand() * (S - 44), oy + 16 + rand() * (S - 44), 2 + rand() * 9, 5 + rand() * 26);
      }
    }
    grain(ctx, W, H, 9, rand);
    return c;
  }
  function texZoneSign() { return texZoneSignOf(ZONE_PANELS); }
  function texZoneSignA2() { return texZoneSignOf(ZONE_PANELS_A2); }

  /* ================================================================ */
  /* P4.9 区画ごとの景観差（DESIGN.md §4「エリア1 新マップ Z4」）            */
  /*   壁: wallPaint（塗装モルタル）/ wallMetal（リベット鋼板）              */
  /*   床: floorTile（白タイル）/ floorWet（湿ったコンクリ）/ floorMetal（縞鋼板） */
  /* ================================================================ */

  /** 壁: 塗装した石膏・モルタル（2m x 3m / 512 x 768）。事務区画・記録区画・拘束区画向け */
  function texWallPaint() {
    var W = 512, H = 768, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(771103);
    ctx.fillStyle = '#a6a49c'; ctx.fillRect(0, 0, W, H);
    /* ローラー塗りのムラ（縦方向の帯） */
    for (var i = 0; i < 90; i++) {
      var x = rand() * W, w = 18 + rand() * 60;
      ctx.fillStyle = 'rgba(' + (150 + rand() * 60 | 0) + ',' + (148 + rand() * 58 | 0) + ',' + (140 + rand() * 54 | 0) + ',0.18)';
      ctx.fillRect(x, 0, w, H);
    }
    speckle(ctx, W, H, 14000, rand, 'rgba(126,124,116,0.35)');
    /* 打ち継ぎ目地（1.5mごと＝水平の線）とパネル割 */
    ctx.fillStyle = 'rgba(74,76,72,0.55)';
    ctx.fillRect(0, 372, W, 4);
    ctx.fillStyle = 'rgba(216,214,206,0.22)'; ctx.fillRect(0, 368, W, 2);
    /* 塗装の剥がれ＝薄く浮いた塗膜が捲れて下地のモルタルが覗く。
     * 「暗い染み」に見えないよう、①下地は周囲とほぼ同じ明度 ②縁だけを段差として描く
     * ③捲れた塗膜の側に細い明るいハイライトを入れる。数は控えめに。 */
    for (var k = 0; k < 10; k++) {
      var hx = rand() * W, hy = rand() * H, hr = 9 + rand() * 18;
      var pts = [];
      for (var q = 0; q <= 13; q++) {
        var aa = q / 13 * Math.PI * 2, rr = hr * (0.72 + rand() * 0.5);
        pts.push([hx + Math.cos(aa) * rr * 1.25, hy + Math.sin(aa) * rr * 0.85]);
      }
      function tracePoly() {
        ctx.beginPath();
        for (var t2 = 0; t2 < pts.length; t2++) {
          if (t2 === 0) ctx.moveTo(pts[t2][0], pts[t2][1]); else ctx.lineTo(pts[t2][0], pts[t2][1]);
        }
        ctx.closePath();
      }
      /* 下地（僅かに暗くザラつく） */
      tracePoly();
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(178,174,164,0.80)';
      ctx.fillRect(hx - hr * 2, hy - hr * 2, hr * 4, hr * 4);
      speckle(ctx, W, H, 1600, rand, 'rgba(146,142,134,0.45)');
      /* 下地に残る刷毛目 */
      ctx.strokeStyle = 'rgba(158,154,146,0.45)'; ctx.lineWidth = 2;
      for (var br = -3; br < 4; br++) {
        ctx.beginPath();
        ctx.moveTo(hx - hr * 1.6, hy + br * 7); ctx.lineTo(hx + hr * 1.6, hy + br * 7 + 3);
        ctx.stroke();
      }
      ctx.restore();
      /* 縁: 上側は塗膜の影、下側は捲れた塗膜のハイライト */
      tracePoly();
      ctx.strokeStyle = 'rgba(126,122,116,0.45)'; ctx.lineWidth = 2.0; ctx.stroke();
      ctx.save(); ctx.clip();
      var eg = ctx.createLinearGradient(0, hy - hr, 0, hy + hr);
      eg.addColorStop(0, 'rgba(96,92,88,0.22)');
      eg.addColorStop(0.35, 'rgba(96,92,88,0)');
      ctx.fillStyle = eg; ctx.fillRect(hx - hr * 2, hy - hr * 2, hr * 4, hr * 4);
      ctx.restore();
      ctx.strokeStyle = 'rgba(224,220,212,0.34)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var t3 = 0; t3 < pts.length; t3++) {
        var pp = [pts[t3][0], pts[t3][1] + 2.2];
        if (t3 === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]);
      }
      ctx.stroke();
    }
    /* 掲示物を剥がした跡（四角い日焼け） */
    for (var t = 0; t < 7; t++) {
      var tx = rand() * (W - 120), ty = rand() * (H - 200);
      ctx.fillStyle = 'rgba(226,222,206,0.16)';
      ctx.fillRect(tx, ty, 60 + rand() * 70, 80 + rand() * 90);
    }
    /* 錆だれ・水だれ・しみ */
    /* P4.17 項目1: 錆だれ 6本→1本・長さ短縮（水だれ（無彩色）は残す） */
    for (var s2 = 0; s2 < RUST_RUNS.wallPaint; s2++) rustRun(ctx, rand() * W, rand() * H * 0.35, 5 + rand() * 8, 45 + rand() * 80, rand, 0.7);
    for (var s3 = 0; s3 < 14; s3++) {
      var sx = rand() * W, sw = 5 + rand() * 16, sh = 80 + rand() * 400;
      var gr = ctx.createLinearGradient(0, 0, 0, sh);
      gr.addColorStop(0, 'rgba(84,80,68,0.26)'); gr.addColorStop(1, 'rgba(84,80,68,0)');
      ctx.fillStyle = gr; ctx.fillRect(sx, 0, sw, sh);
    }
    for (var b2 = 0; b2 < 18; b2++) blot(ctx, rand() * W, rand() * H, 26 + rand() * 96, 'rgba(92,84,62,0.24)');
    for (var cr = 0; cr < 9; cr++) crack(ctx, rand() * W, rand() * H, 80 + rand() * 190, rand() * 6.28, rand, 0);
    /* 床際・天井際の落ち */
    var gm = ctx.createLinearGradient(0, H, 0, H - 200);
    gm.addColorStop(0, 'rgba(26,30,28,0.78)'); gm.addColorStop(0.45, 'rgba(30,34,32,0.32)');
    gm.addColorStop(1, 'rgba(30,34,32,0)');
    ctx.fillStyle = gm; ctx.fillRect(0, H - 200, W, 200);
    var gt = ctx.createLinearGradient(0, 0, 0, 90);
    gt.addColorStop(0, 'rgba(20,24,26,0.40)'); gt.addColorStop(1, 'rgba(20,24,26,0)');
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 90);
    /* 幅木（塗装のケレン） */
    ctx.fillStyle = '#4c5158'; ctx.fillRect(0, H - 44, W, 44);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, H - 44, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, H - 8, W, 8);
    for (var bb = 0; bb < 22; bb++) {
      ctx.fillStyle = 'rgba(102,82,54,' + (0.22 + rand() * 0.38) + ')';
      ctx.fillRect(rand() * W, H - 42 + rand() * 32, 3 + rand() * 18, 2 + rand() * 7);
    }

    /* ---- P4.11 項目7: 塗装の剥落・擦れ・にじみ ---- */
    for (var pk = 0; pk < 13; pk++) {
      var pr2 = 8 + rand() * 22;
      peel(ctx, rand() * W, 60 + rand() * (H - 200), pr2, rand,
        'rgba(134,128,116,0.62)', 'rgba(198,194,184,0.42)');
    }
    /* 剥落の縁から下へ流れる汚れ */
    for (var dr3 = 0; dr3 < 18; dr3++) {
      var dx3 = rand() * W, dy3 = rand() * H * 0.7, dl = 40 + rand() * 200;
      var dg = ctx.createLinearGradient(0, dy3, 0, dy3 + dl);
      dg.addColorStop(0, 'rgba(72,66,54,0.26)');
      dg.addColorStop(1, 'rgba(72,66,54,0)');
      ctx.fillStyle = dg; ctx.fillRect(dx3, dy3, 3 + rand() * 10, dl);
    }
    scuff(ctx, 700, rand, 'rgba(78,74,66,0.20)', 0, 40);
    scuff(ctx, 260, rand, 'rgba(206,202,192,0.14)', 1.57, 26);
    fineGrit(ctx, 26000, rand, 'rgba(56,54,48,0.22)');
    fineGrit(ctx, 8000, rand, 'rgba(190,188,180,0.14)');
    speckle(ctx, W, H, 5000, rand, 'rgba(60,58,52,0.28)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /** 壁: リベット留めの鋼板（2m x 3m / 512 x 768）。機械区画向け */
  function texWallMetal() {
    var W = 512, H = 768, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(410889);
    ctx.fillStyle = '#6f757a'; ctx.fillRect(0, 0, W, H);
    /* 圧延の縦目 */
    for (var i = 0; i < 260; i++) {
      ctx.fillStyle = 'rgba(' + (110 + rand() * 60 | 0) + ',' + (116 + rand() * 60 | 0) + ',' + (122 + rand() * 58 | 0) + ',0.30)';
      ctx.fillRect(rand() * W, 0, 1 + rand() * 3, H);
    }
    /* パネル割（0.5m = 128px）と継ぎ目の段差 */
    var PS = 128;
    for (var py = 0; py <= H; py += PS * 1.5) {
      ctx.fillStyle = 'rgba(38,42,46,0.85)'; ctx.fillRect(0, py - 3, W, 5);
      ctx.fillStyle = 'rgba(196,204,210,0.20)'; ctx.fillRect(0, py + 2, W, 2);
    }
    for (var px = 0; px <= W; px += PS * 2) {
      ctx.fillStyle = 'rgba(38,42,46,0.75)'; ctx.fillRect(px - 3, 0, 5, H);
      ctx.fillStyle = 'rgba(196,204,210,0.16)'; ctx.fillRect(px + 2, 0, 2, H);
    }
    /* リベット */
    for (var ry = 22; ry < H; ry += PS * 1.5) {
      for (var rx = 20; rx < W; rx += 46) {
        var d = 5 + rand() * 1.5;
        ctx.fillStyle = 'rgba(150,158,164,0.85)';
        ctx.beginPath(); ctx.arc(rx, ry, d, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(30,34,38,0.55)';
        ctx.beginPath(); ctx.arc(rx + 1.4, ry + 1.8, d * 0.72, 0, Math.PI * 2); ctx.fill();
      }
    }
    /* 塗装の剥げと錆（重力方向に流れる）。P4.17 項目1: 22本→5本・長さ短縮、
       剥げの斑も赤茶→茶（R−G を 46 → 20 前後へ）・数を 40→14 に */
    for (var s = 0; s < RUST_RUNS.wallMetalA; s++) rustRun(ctx, rand() * W, rand() * H * 0.6, 6 + rand() * 10, 45 + rand() * 85, rand, 0.95);
    for (var k = 0; k < 14; k++) {
      ctx.fillStyle = 'rgba(' + (94 + rand() * 34 | 0) + ',' + (78 + rand() * 28 | 0) + ',' + (54 + rand() * 20 | 0) + ',' + (0.22 + rand() * 0.34) + ')';
      ctx.fillRect(rand() * W, rand() * H, 4 + rand() * 22, 3 + rand() * 12);
    }
    for (var b2 = 0; b2 < 14; b2++) blot(ctx, rand() * W, rand() * H, 30 + rand() * 90, 'rgba(46,40,30,0.30)');
    /* 打痕（凹み） */
    for (var d2 = 0; d2 < 16; d2++) {
      var dx = rand() * W, dy = rand() * H, dr = 8 + rand() * 20;
      blot(ctx, dx, dy - dr * 0.3, dr, 'rgba(24,28,32,0.45)');
      blot(ctx, dx, dy + dr * 0.4, dr * 0.7, 'rgba(206,214,220,0.16)');
    }
    var gm2 = ctx.createLinearGradient(0, H, 0, H - 190);
    gm2.addColorStop(0, 'rgba(20,24,26,0.80)'); gm2.addColorStop(1, 'rgba(20,24,26,0)');
    ctx.fillStyle = gm2; ctx.fillRect(0, H - 190, W, 190);
    var gt2 = ctx.createLinearGradient(0, 0, 0, 80);
    gt2.addColorStop(0, 'rgba(16,20,22,0.40)'); gt2.addColorStop(1, 'rgba(16,20,22,0)');
    ctx.fillStyle = gt2; ctx.fillRect(0, 0, W, 80);

    /* ---- P4.11 項目7: 鋼板の擦れ・打痕・錆の粒 ---- */
    scuff(ctx, 1400, rand, 'rgba(30,34,38,0.22)', 0, 46);
    scuff(ctx, 700, rand, 'rgba(206,214,220,0.14)', 0, 60);
    for (var dnt = 0; dnt < 20; dnt++) {
      var dx4 = rand() * W, dy4 = rand() * H, dr4 = 8 + rand() * 22;
      blot(ctx, dx4, dy4, dr4, 'rgba(18,22,26,0.40)');
      ctx.fillStyle = 'rgba(210,218,224,0.14)';
      ctx.fillRect(dx4 - dr4 * 0.5, dy4 + dr4 * 0.45, dr4, 2);
    }
    /* P4.17 項目1: 14本→3本・長さ短縮 */
    for (var rs = 0; rs < RUST_RUNS.wallMetalB; rs++) {
      rustRun(ctx, rand() * W, rand() * H * 0.55, 5 + rand() * 8, 40 + rand() * 70, rand, 0.75);
    }
    fineGrit(ctx, 30000, rand, 'rgba(38,42,46,0.24)');
    fineGrit(ctx, 9000, rand, 'rgba(196,206,214,0.14)');
    speckle(ctx, W, H, 6800, rand, 'rgba(44,48,52,0.32)');
    speckle(ctx, W, H, 2400, rand, 'rgba(198,206,212,0.18)');
    grain(ctx, W, H, 9, rand);
    return c;
  }

  /** 床: 白タイル（2m x 2m / 512 x 512・0.25m角）。実験区画向け */
  function texFloorTile() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(556677);
    ctx.fillStyle = '#8d8d86'; ctx.fillRect(0, 0, W, H);
    var TS = 64;
    for (var ty = 0; ty < H / TS; ty++) {
      for (var tx = 0; tx < W / TS; tx++) {
        var broken = rand() < 0.05;
        if (broken) {
          ctx.fillStyle = '#70706a'; ctx.fillRect(tx * TS + 2, ty * TS + 2, TS - 4, TS - 4);
          for (var q2 = 0; q2 < 22; q2++) {
            ctx.fillStyle = 'rgba(' + (104 + rand() * 40 | 0) + ',' + (102 + rand() * 38 | 0) + ',' + (94 + rand() * 34 | 0) + ',0.6)';
            ctx.fillRect(tx * TS + rand() * TS, ty * TS + rand() * TS, 2 + rand() * 6, 2 + rand() * 5);
          }
          continue;
        }
        var v = 158 + rand() * 40;
        ctx.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 2) | 0) + ',' + ((v - 8) | 0) + ')';
        ctx.fillRect(tx * TS + 2, ty * TS + 2, TS - 4, TS - 4);
        /* 1枚ごとの微傾き＝反射差 */
        var ga = rand() * Math.PI * 2, gs = 0.05 + rand() * 0.20;
        var lg = ctx.createLinearGradient(
          tx * TS + TS / 2 + Math.cos(ga) * TS, ty * TS + TS / 2 + Math.sin(ga) * TS,
          tx * TS + TS / 2 - Math.cos(ga) * TS, ty * TS + TS / 2 - Math.sin(ga) * TS);
        lg.addColorStop(0, 'rgba(255,255,255,' + gs.toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(0,0,0,' + (gs * 0.85).toFixed(3) + ')');
        ctx.fillStyle = lg; ctx.fillRect(tx * TS + 2, ty * TS + 2, TS - 4, TS - 4);
      }
    }
    /* 目地（立体感つき）と黒カビ */
    ctx.fillStyle = 'rgba(62,66,62,0.92)';
    for (var gx = 0; gx <= W; gx += TS) ctx.fillRect(gx - 2, 0, 3, H);
    for (var gy = 0; gy <= H; gy += TS) ctx.fillRect(0, gy - 2, W, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (var gx1 = 0; gx1 <= W; gx1 += TS) ctx.fillRect(gx1 + 1, 0, 2, H);
    for (var gy1 = 0; gy1 <= H; gy1 += TS) ctx.fillRect(0, gy1 + 1, W, 2);
    ctx.fillStyle = 'rgba(30,36,30,0.55)';
    for (var mk = 0; mk < 300; mk++) {
      var h2 = rand() < 0.5;
      var kx = h2 ? rand() * W : ((rand() * W / TS) | 0) * TS - 2;
      var ky = h2 ? ((rand() * H / TS) | 0) * TS - 2 : rand() * H;
      if (h2) ctx.fillRect(kx, ky, 3 + rand() * 20, 3); else ctx.fillRect(kx, ky, 3, 3 + rand() * 20);
    }
    /* 引きずり痕（動線方向）と汚れだまり */
    for (var dr2 = 0; dr2 < 14; dr2++) {
      ctx.strokeStyle = 'rgba(70,68,60,' + (0.10 + rand() * 0.22) + ')';
      ctx.lineWidth = 2 + rand() * 7;
      ctx.beginPath();
      var dy0 = rand() * H;
      ctx.moveTo(-20, dy0);
      ctx.bezierCurveTo(W * 0.3, dy0 + (rand() - 0.5) * 40, W * 0.7, dy0 + (rand() - 0.5) * 40, W + 20, dy0 + (rand() - 0.5) * 30);
      ctx.stroke();
    }
    for (var t2 = 0; t2 < 18; t2++) {
      var bx2 = rand() * W, by2 = rand() * H, br2 = 30 + rand() * 110;
      blot(ctx, bx2, by2, br2, 'rgba(60,58,48,0.24)');
      var tg = ctx.createLinearGradient(0, by2, 0, by2 + br2 * 1.2);
      tg.addColorStop(0, 'rgba(56,54,44,0.20)'); tg.addColorStop(1, 'rgba(56,54,44,0)');
      ctx.fillStyle = tg; ctx.fillRect(bx2 - br2 * 0.4, by2, br2 * 0.8, br2 * 1.2);
    }

    /* ---- P4.11 項目7: 方向性のある擬似スペキュラ＋通路の継ぎ目＋擦れの粒 ---- */
    sheen(ctx, W, H, 4, rand, 0, 'rgba(236,240,240,%A%)');
    sheen(ctx, W, H, 2, rand, 1.5708, 'rgba(236,240,240,%A%)');
    /* マス境界＝通路の継ぎ目（2mごと）。影と受け光の2本で段差に見せる */
    ctx.fillStyle = 'rgba(26,28,26,0.50)'; ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, 0, 3, H);
    ctx.fillStyle = 'rgba(198,202,196,0.16)'; ctx.fillRect(0, 3, W, 2); ctx.fillRect(3, 0, 2, H);
    scuff(ctx, 1500, rand, 'rgba(212,218,214,0.10)', 0, 52);
    scuff(ctx, 900, rand, 'rgba(40,42,38,0.14)', 0, 40);
    fineGrit(ctx, 30000, rand, 'rgba(42,42,36,0.24)');
    fineGrit(ctx, 10000, rand, 'rgba(206,210,204,0.14)');
    speckle(ctx, W, H, 6000, rand, 'rgba(44,44,38,0.28)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /** 床: 湿ったコンクリート（2m x 2m / 512 x 512）。検体区画向け */
  function texFloorWet() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(313373);
    ctx.fillStyle = '#71766f'; ctx.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 22000, rand, 'rgba(96,102,94,0.45)');
    speckle(ctx, W, H, 6000, rand, 'rgba(126,134,124,0.35)');
    /* 骨材（コンクリの粒） */
    for (var i = 0; i < 900; i++) {
      var v = 100 + rand() * 60;
      ctx.fillStyle = 'rgba(' + (v | 0) + ',' + ((v + 6) | 0) + ',' + ((v - 4) | 0) + ',0.55)';
      ctx.beginPath(); ctx.arc(rand() * W, rand() * H, 1 + rand() * 3.4, 0, Math.PI * 2); ctx.fill();
    }
    /* 打ち継ぎの目地（2mごと＝セル境界） */
    ctx.fillStyle = 'rgba(48,54,48,0.70)';
    ctx.fillRect(0, 0, W, 5); ctx.fillRect(0, 0, 5, H);
    ctx.fillStyle = 'rgba(132,140,130,0.24)';
    ctx.fillRect(0, 5, W, 2); ctx.fillRect(5, 0, 2, H);
    /* 濡れ＝低い場所に溜まった艶（暗く・青緑に寄る鏡面） */
    for (var p = 0; p < 22; p++) {
      var px = rand() * W, py = rand() * H, pr = 26 + rand() * 110;
      var g2 = ctx.createRadialGradient(px, py, 0, px, py, pr);
      g2.addColorStop(0, 'rgba(30,52,48,0.52)');
      g2.addColorStop(0.72, 'rgba(38,60,54,0.30)');
      g2.addColorStop(1, 'rgba(38,60,54,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      /* 水縁のハイライト */
      ctx.strokeStyle = 'rgba(168,206,196,0.20)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(px, py, pr * 0.78, 0, Math.PI * 2); ctx.stroke();
    }
    /* 藻・ぬめり（緑） */
    for (var m = 0; m < 34; m++) blot(ctx, rand() * W, rand() * H, 18 + rand() * 70, 'rgba(52,86,58,0.30)');
    /* 排水の流れ跡（重力方向） */
    for (var s = 0; s < 12; s++) {
      ctx.strokeStyle = 'rgba(40,58,50,' + (0.16 + rand() * 0.26) + ')';
      ctx.lineWidth = 3 + rand() * 9;
      ctx.beginPath();
      var sx = rand() * W;
      ctx.moveTo(sx, -10);
      ctx.bezierCurveTo(sx + (rand() - 0.5) * 60, H * 0.35, sx + (rand() - 0.5) * 80, H * 0.7, sx + (rand() - 0.5) * 40, H + 10);
      ctx.stroke();
    }
    /* ひび */

    /* ---- P4.11 項目7: 方向性のある擬似スペキュラ＋通路の継ぎ目＋擦れの粒 ---- */
    sheen(ctx, W, H, 4, rand, 0, 'rgba(200,214,220,%A%)');
    sheen(ctx, W, H, 2, rand, 1.5708, 'rgba(200,214,220,%A%)');
    /* マス境界＝通路の継ぎ目（2mごと）。影と受け光の2本で段差に見せる */
    ctx.fillStyle = 'rgba(26,28,26,0.50)'; ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, 0, 3, H);
    ctx.fillStyle = 'rgba(198,202,196,0.16)'; ctx.fillRect(0, 3, W, 2); ctx.fillRect(3, 0, 2, H);
    scuff(ctx, 1500, rand, 'rgba(212,218,214,0.10)', 0, 52);
    scuff(ctx, 900, rand, 'rgba(40,42,38,0.14)', 0, 40);
    fineGrit(ctx, 30000, rand, 'rgba(38,40,36,0.26)');
    fineGrit(ctx, 10000, rand, 'rgba(178,190,192,0.12)');
    for (var cr = 0; cr < 8; cr++) crack(ctx, rand() * W, rand() * H, 70 + rand() * 180, rand() * 6.28, rand, 0);
    grain(ctx, W, H, 9, rand);
    return c;
  }

  /** 床: 縞鋼板（2m x 2m / 512 x 512）。機械区画向け＝足音が変わる床 */
  function texFloorMetal() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(902244);
    ctx.fillStyle = '#6b7076'; ctx.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 14000, rand, 'rgba(96,102,108,0.40)');
    /* 縞（涙型の突起）を千鳥に並べる */
    var SP = 64;
    for (var ry = 0; ry < H; ry += SP) {
      for (var rx = 0; rx < W; rx += SP) {
        var ox = ((ry / SP) | 0) % 2 ? SP / 2 : 0;
        for (var k = 0; k < 2; k++) {
          var a = (k ? 1 : -1) * 0.62;
          var bx = rx + ox + SP * 0.25 + k * SP * 0.30, by = ry + SP * 0.30 + k * SP * 0.32;
          ctx.save();
          ctx.translate(bx, by); ctx.rotate(a);
          /* 突起の面（明）と影 */
          ctx.fillStyle = 'rgba(28,32,36,0.62)';
          ctx.fillRect(-14, -4 + 3, 28, 8);
          ctx.fillStyle = 'rgba(150,158,166,0.55)';
          ctx.fillRect(-14, -4, 28, 8);
          ctx.fillStyle = 'rgba(206,214,222,0.35)';
          ctx.fillRect(-13, -4, 26, 3);
          ctx.restore();
        }
      }
    }
    /* 板の継ぎ目（2mごと）とボルト */
    ctx.fillStyle = 'rgba(30,34,38,0.85)'; ctx.fillRect(0, 0, W, 6); ctx.fillRect(0, 0, 6, H);
    ctx.fillStyle = 'rgba(190,200,208,0.20)'; ctx.fillRect(0, 6, W, 2); ctx.fillRect(6, 0, 2, H);
    for (var bx2 = 26; bx2 < W; bx2 += 120) {
      for (var by2 = 26; by2 < H; by2 += 120) {
        ctx.fillStyle = 'rgba(146,154,162,0.85)';
        ctx.beginPath(); ctx.arc(bx2, by2, 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(26,30,34,0.6)';
        ctx.beginPath(); ctx.arc(bx2 + 1.5, by2 + 1.8, 4.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    /* 摩耗（動線に沿って突起が潰れて光る） */
    var wear = ctx.createLinearGradient(0, H * 0.5 - 130, 0, H * 0.5 + 130);
    wear.addColorStop(0, 'rgba(206,214,222,0)');
    wear.addColorStop(0.5, 'rgba(206,214,222,0.20)');
    wear.addColorStop(1, 'rgba(206,214,222,0)');
    ctx.fillStyle = wear; ctx.fillRect(0, 0, W, H);
    /* 油だまりと錆 */
    for (var o = 0; o < 16; o++) blot(ctx, rand() * W, rand() * H, 24 + rand() * 90, 'rgba(24,24,22,0.42)');
    for (var s2 = 0; s2 < 26; s2++) {
      ctx.fillStyle = 'rgba(' + (104 + rand() * 46 | 0) + ',' + (58 + rand() * 32 | 0) + ',22,' + (0.22 + rand() * 0.4) + ')';
      ctx.fillRect(rand() * W, rand() * H, 4 + rand() * 20, 3 + rand() * 10);
    }

    /* ---- P4.11 項目7: 方向性のある擬似スペキュラ＋通路の継ぎ目＋擦れの粒 ---- */
    sheen(ctx, W, H, 4, rand, 0, 'rgba(214,224,232,%A%)');
    sheen(ctx, W, H, 2, rand, 1.5708, 'rgba(214,224,232,%A%)');
    /* マス境界＝通路の継ぎ目（2mごと）。影と受け光の2本で段差に見せる */
    ctx.fillStyle = 'rgba(26,28,26,0.50)'; ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, 0, 3, H);
    ctx.fillStyle = 'rgba(198,202,196,0.16)'; ctx.fillRect(0, 3, W, 2); ctx.fillRect(3, 0, 2, H);
    scuff(ctx, 1500, rand, 'rgba(212,218,214,0.10)', 0, 52);
    scuff(ctx, 900, rand, 'rgba(40,42,38,0.14)', 0, 40);
    fineGrit(ctx, 30000, rand, 'rgba(36,40,44,0.26)');
    fineGrit(ctx, 10000, rand, 'rgba(198,208,216,0.14)');
    speckle(ctx, W, H, 5200, rand, 'rgba(40,44,48,0.30)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /* ================================================================ */
  /* P4.16 項目1: スタート部屋の大型掲示板（2.4m x 1.6m の紙面）           */
  /*   契約 §4「P4.16」項目1 / 正文は docs/notes.md「P4.16追加」。          */
  /*   木炭風のスケッチは「同じ輪郭を複数回なぞる」＋「面を短い筆で埋める」  */
  /*   ＋「擦れ（destination-out）」の3層で描く。幾何学的な単線にしない。    */
  /* ================================================================ */
  var JPM = '"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP",serif';

  /** 透明な作業用キャンバス（擦れの destination-out を紙面に波及させないため） */
  function offCanvas(w, h, fn) {
    var c = makeCanvas(w, h), x = c.getContext('2d');
    fn(x, w, h);
    return c;
  }
  /** 点列をランダムに揺らす（なぞるたびに線がずれる＝木炭のムラ） */
  function chJit(pts, rand, amt) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      out.push([pts[i][0] + (rand() - 0.5) * amt, pts[i][1] + (rand() - 0.5) * amt]);
    }
    return out;
  }
  /** 点列を通る滑らかなパス（角のある折れ線にしない） */
  function chPath(ctx, pts, closed) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i][0], pts[i][1],
        (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (closed) ctx.closePath();
  }
  /** 木炭の線: passes 回なぞる。毎回わずかに太さ・濃さ・位置を変える */
  function chLine(ctx, pts, rand, o) {
    o = o || {};
    var passes = o.passes || 5, css = o.css || 'rgb(22,20,19)';
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = css;
    for (var p = 0; p < passes; p++) {
      ctx.globalAlpha = (o.alpha || 0.26) * (0.40 + rand() * 0.85);
      ctx.lineWidth = (o.w || 4) * (0.45 + rand() * 1.15);
      chPath(ctx, chJit(pts, rand, (o.jit || 3.0) * (0.5 + p / passes)), o.closed);
      ctx.stroke();
    }
    ctx.restore();
  }
  /** 3点を通る「先細りの帯」を多角形にする（腕・脚・胴を線ではなく形で描く） */
  function limbPoly(p0, p1, p2, w0, w1, w2) {
    var N = 7, L = [], R = [], i;
    for (i = 0; i <= N; i++) {
      var t = i / N, it = 1 - t;
      var x = it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0];
      var y = it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1];
      var dx = 2 * it * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
      var dy = 2 * it * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
      var m = Math.sqrt(dx * dx + dy * dy) || 1;
      var w = (t < 0.5) ? (w0 + (w1 - w0) * (t * 2)) : (w1 + (w2 - w1) * ((t - 0.5) * 2));
      L.push([x - dy / m * w, y + dx / m * w]);
      R.push([x + dy / m * w, y - dx / m * w]);
    }
    R.reverse();
    return L.concat(R);
  }

  /** 木炭の面: 輪郭で切り抜いて短い筆を重ね、最後に擦れを抜く */
  function chFill(ctx, pts, rand, o) {
    o = o || {};
    var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i][0] < minx) minx = pts[i][0];
      if (pts[i][0] > maxx) maxx = pts[i][0];
      if (pts[i][1] < miny) miny = pts[i][1];
      if (pts[i][1] > maxy) maxy = pts[i][1];
    }
    var css = o.css || 'rgb(20,18,17)';
    var ang = (o.ang === undefined) ? 1.18 : o.ang;
    var slen = o.slen || 26;
    ctx.save();
    chPath(ctx, chJit(pts, rand, (o.jit || 3.0) * 0.55), true);
    ctx.clip();
    ctx.fillStyle = css;
    ctx.globalAlpha = (o.base === undefined) ? 0.42 : o.base;
    ctx.fillRect(minx - 2, miny - 2, maxx - minx + 4, maxy - miny + 4);
    ctx.strokeStyle = css; ctx.lineCap = 'round';
    var n = o.strokes || 110;
    for (i = 0; i < n; i++) {
      var x = minx + rand() * (maxx - minx), y = miny + rand() * (maxy - miny);
      var a = ang + (rand() - 0.5) * 0.55, l = slen * (0.35 + rand() * 1.1);
      ctx.globalAlpha = 0.08 + rand() * 0.30;
      ctx.lineWidth = 2 + rand() * 7;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    /* 擦れ（紙の目が出る）。作業用キャンバス上なので紙面は削れない */
    ctx.globalCompositeOperation = 'destination-out';
    var m = o.scuffs || 46;
    for (i = 0; i < m; i++) {
      var x2 = minx + rand() * (maxx - minx), y2 = miny + rand() * (maxy - miny);
      var a2 = ang + (rand() - 0.5) * 0.7, l2 = slen * (0.3 + rand() * 1.0);
      ctx.globalAlpha = 0.05 + rand() * 0.24;
      ctx.lineWidth = 1 + rand() * 4.5;
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + Math.cos(a2) * l2, y2 + Math.sin(a2) * l2);
      ctx.stroke();
    }
    ctx.restore();
    chLine(ctx, pts, rand, { passes: o.passes || 6, w: o.w || 5,
      alpha: o.alpha || 0.30, jit: o.jit || 3.0, closed: true, css: css });
    /* はみ出した筆（木炭は輪郭の外にも線が走る）。切り抜きの外に少しだけ描く */
    if (o.stray !== 0) {
      ctx.save();
      ctx.strokeStyle = css; ctx.lineCap = 'round';
      var ns = o.stray || 14;
      for (var q = 0; q < ns; q++) {
        var k = (rand() * pts.length) | 0;
        var bx = pts[k][0], by = pts[k][1];
        var aa = ang + (rand() - 0.5) * 1.0, ll = slen * (0.5 + rand() * 1.2);
        ctx.globalAlpha = 0.06 + rand() * 0.16;
        ctx.lineWidth = 1.5 + rand() * 5;
        ctx.beginPath();
        ctx.moveTo(bx - Math.cos(aa) * ll * 0.5, by - Math.sin(aa) * ll * 0.5);
        ctx.lineTo(bx + Math.cos(aa) * ll * 0.6, by + Math.sin(aa) * ll * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** 肘・膝で折れる四肢（滑らかな弧にせず、関節で角を作る） */
  function chLimb2(ctx, rand, a, b, c, w0, w1, w2, o) {
    function mid(p, q, f) { return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; }
    chFill(ctx, limbPoly(a, mid(a, b, 0.55), b, w0, (w0 + w1) / 2, w1), rand, o);
    chFill(ctx, limbPoly(b, mid(b, c, 0.45), c, w1, (w1 + w2) / 2, w2), rand, o);
    /* 関節（角がちぎれて見えないぶんだけ。輪郭線は足さない＝丸い節に見せない） */
    var jp = [], i;
    for (i = 0; i < 7; i++) {
      var an = i / 7 * Math.PI * 2;
      jp.push([b[0] + Math.cos(an) * w1 * 0.92, b[1] + Math.sin(an) * w1 * 0.92]);
    }
    chFill(ctx, jp, rand, { base: o.base, strokes: 14, ang: o.ang, slen: o.slen,
      alpha: 0.10, passes: 2, w: 2, scuffs: 8, css: o.css, stray: 0 });
  }

  /** 直立した長髪の人影（顔は影で潰す・輪郭は細かく揺らす） */
  function chStanding(ctx, rand, cx, top, hgt) {
    var s = hgt / 300;
    function P(x, y) { return [cx + x * s, top + y * s]; }
    function LP(a, b, c, w0, w1, w2) {
      return limbPoly(P(a[0], a[1]), P(b[0], b[1]), P(c[0], c[1]), w0 * s, w1 * s, w2 * s);
    }
    var CH = 'rgb(34,30,28)';
    /* 髪（後ろの塊。肩を越えて腰まで落ちる。裾は房に割れる） */
    var hairBack = [P(-28, 4), P(-38, 38), P(-43, 86), P(-44, 132), P(-38, 166),
      P(-30, 144), P(-25, 174), P(-17, 148), P(-8, 178), P(0, 146),
      P(8, 176), P(17, 148), P(25, 176), P(32, 146), P(39, 168),
      P(45, 130), P(44, 84), P(39, 36), P(29, 3), P(0, -8)];
    chFill(ctx, hairBack, rand, { base: 0.30, strokes: 190, ang: 1.52,
      slen: 46 * s + 10, w: 5, alpha: 0.24, scuffs: 70, css: CH, stray: 22 });
    /* 脚（先細りの帯） */
    chFill(ctx, LP([-13, 186], [-16, 244], [-19, 298], 15, 12, 9), rand,
      { base: 0.46, strokes: 60, ang: 1.55, slen: 26 * s + 8, css: CH, stray: 8 });
    chFill(ctx, LP([13, 186], [15, 244], [19, 298], 15, 12, 9), rand,
      { base: 0.46, strokes: 60, ang: 1.55, slen: 26 * s + 8, css: CH, stray: 8 });
    /* 胴（撫で肩・痩せて腰がくびれる） */
    var torso = [P(-31, 78), P(-27, 118), P(-20, 152), P(-25, 188), P(-14, 196),
      P(0, 199), P(14, 196), P(25, 188), P(20, 152), P(27, 118), P(31, 78),
      P(16, 68), P(0, 66), P(-16, 68)];
    chFill(ctx, torso, rand, { base: 0.44, strokes: 130, ang: 1.42,
      slen: 30 * s + 8, css: CH, stray: 16 });
    /* 腕（膝下まで届く。肘で外へ張り、手が長い） */
    chFill(ctx, LP([-31, 82], [-54, 148], [-45, 234], 12, 9, 6), rand,
      { base: 0.46, strokes: 55, ang: 1.5, slen: 24 * s + 7, css: CH, stray: 8 });
    chFill(ctx, LP([31, 80], [53, 146], [44, 236], 12, 9, 6), rand,
      { base: 0.46, strokes: 55, ang: 1.5, slen: 24 * s + 7, css: CH, stray: 8 });
    /* 手（指の分かれた小さな塊） */
    var hL = [P(-48, 232), P(-54, 246), P(-50, 258), P(-44, 248), P(-41, 260), P(-38, 242)];
    var hR = [P(47, 234), P(53, 248), P(49, 260), P(43, 250), P(40, 262), P(37, 244)];
    chFill(ctx, hL, rand, { base: 0.5, strokes: 26, ang: 1.5, slen: 12 * s + 5, css: CH, stray: 6 });
    chFill(ctx, hR, rand, { base: 0.5, strokes: 26, ang: 1.5, slen: 12 * s + 5, css: CH, stray: 6 });
    /* 首・頭 */
    chFill(ctx, [P(-8, 58), P(-9, 74), P(9, 74), P(8, 58)], rand,
      { base: 0.5, strokes: 18, ang: 1.5, slen: 10 * s + 4, css: CH, stray: 4 });
    var head = [P(-21, 22), P(-24, 40), P(-19, 56), P(-8, 64), P(8, 64),
      P(19, 56), P(24, 40), P(21, 22), P(12, 8), P(0, 5), P(-12, 8)];
    chFill(ctx, head, rand, { base: 0.42, strokes: 60, ang: 1.4,
      slen: 16 * s + 5, css: CH, stray: 8 });
    /* 顔＝影で潰す（目鼻を描かない。中はほぼ黒） */
    var face = [P(-16, 26), P(-18, 44), P(-12, 58), P(0, 62), P(12, 58),
      P(18, 44), P(16, 26), P(0, 18)];
    chFill(ctx, face, rand, { base: 0.86, strokes: 60, ang: 1.3,
      slen: 12 * s + 4, alpha: 0.40, scuffs: 22, css: 'rgb(20,17,16)', stray: 4 });
    /* 髪の前髪（顔にかかる房） */
    for (var i = 0; i < 9; i++) {
      var x0 = -22 + i * 5.5;
      chLine(ctx, [P(x0, 8), P(x0 - 2 + rand() * 4, 30 + rand() * 18), P(x0 - 4 + rand() * 8, 52 + rand() * 22)],
        rand, { passes: 3, w: 3.2 * s + 1.2, alpha: 0.30, jit: 2.0, css: CH });
    }
    /* 髪の毛先（房が割れて垂れる） */
    for (var j = 0; j < 14; j++) {
      var hx = -50 + rand() * 100;
      chLine(ctx, [P(hx * 0.7, 60 + rand() * 40), P(hx * 0.9, 120 + rand() * 30), P(hx, 160 + rand() * 32)],
        rand, { passes: 3, w: 2.6 * s + 1, alpha: 0.24, jit: 2.6, css: CH });
    }
    /* 床の影 */
    var sh = [P(-44, 300), P(0, 293), P(46, 300), P(0, 311)];
    chFill(ctx, sh, rand, { base: 0.24, strokes: 44, ang: 0.05,
      slen: 44 * s + 10, alpha: 0.16, w: 3, css: CH, stray: 6 });
  }

  /** 床に伏せて四つ足で這う影（背が反り、肘と膝が背より高く突き出る反転姿勢） */
  function chCrawling(ctx, rand, cx, base, wid) {
    var s = wid / 380;
    function P(x, y) { return [cx + x * s, base + y * s]; }
    var CH = 'rgb(34,30,28)';
    function limb(a, b, c, w0, w1, w2, o) {
      chLimb2(ctx, rand, P(a[0], a[1]), P(b[0], b[1]), P(c[0], c[1]),
        w0 * s, w1 * s, w2 * s, o);
    }
    var far = { base: 0.30, strokes: 40, ang: 1.35, slen: 22 * s + 6, alpha: 0.20,
      w: 3.5, css: CH, stray: 5 };
    var near = { base: 0.46, strokes: 46, ang: 1.35, slen: 22 * s + 6, alpha: 0.26,
      w: 4, css: CH, stray: 6 };
    /* 髪（頭から前方の床へ広がって垂れる） */
    var hair = [P(-96, -52), P(-120, -58), P(-150, -44), P(-174, -22), P(-192, 0),
      P(-172, 6), P(-146, -6), P(-150, 8), P(-124, -4), P(-122, 8), P(-102, -2), P(-88, -34)];
    chFill(ctx, hair, rand, { base: 0.26, strokes: 130, ang: 0.16,
      slen: 44 * s + 10, w: 4, alpha: 0.20, css: CH, stray: 16 });
    /* 奥側の腕（前方の床へ伸ばす）と脚（膝を高く跳ね上げる） */
    limb([-64, -54], [-92, -84], [-128, -4], 9, 7, 6, far);
    limb([80, -48], [98, -112], [116, -2], 11, 8, 7, far);
    /* 胴＝厚みのある三日月。背が高く反り、胸と腹が床に近い（ここが絵の主役） */
    var body = [
      P(-86, -46), P(-62, -70), P(-30, -90), P(8, -96), P(44, -88), P(70, -72), P(84, -54),
      P(80, -28), P(56, -44), P(24, -54), P(-12, -54), P(-48, -42), P(-78, -26)];
    chFill(ctx, body, rand, { base: 0.46, strokes: 190, ang: 0.42,
      slen: 34 * s + 9, css: CH, stray: 22 });
    /* 背骨と肋（反り返りが読める内側の線） */
    chLine(ctx, [P(-80, -44), P(-34, -82), P(14, -90), P(64, -68)], rand,
      { passes: 4, w: 3.2 * s + 1.2, alpha: 0.24, jit: 2.2, css: CH });
    for (var i = 0; i < 5; i++) {
      var t = i / 4;
      chLine(ctx, [P(-58 + t * 112, -34 - t * 20), P(-52 + t * 112, -54 - t * 24), P(-48 + t * 112, -74 - t * 18)],
        rand, { passes: 2, w: 2.2 * s + 1, alpha: 0.17, jit: 1.8, css: CH });
    }
    /* 手前側: 腕は前方の床を掻き、脚は膝が背より高く跳ね上がる（関節が逆に見える） */
    limb([-82, -44], [-110, -66], [-146, -4], 10, 8, 6, near);
    limb([62, -60], [46, -134], [22, -2], 13, 9, 7, near);
    /* 床についた手・足（指が開いている） */
    function paw(px, py, dir) {
      var pts = [P(px - 10 * dir, py - 8), P(px - 14 * dir, py + 2), P(px - 2 * dir, py + 9),
        P(px + 8 * dir, py + 2), P(px + 7 * dir, py - 8)];
      chFill(ctx, pts, rand, { base: 0.48, strokes: 22, ang: 0.2, slen: 11 * s + 4,
        alpha: 0.26, w: 3, css: CH, stray: 5 });
      for (var k = 0; k < 3; k++) {
        chLine(ctx, [P(px + (k - 1) * 6 * dir, py - 2), P(px + (k - 1) * 7 * dir - 6 * dir, py + 6)],
          rand, { passes: 2, w: 2.2 * s + 1, alpha: 0.28, jit: 1.4, css: CH });
      }
    }
    paw(-148, -4, 1); paw(-130, -4, 1); paw(22, -2, -1); paw(116, -2, -1);
    /* 首（胸から前へ伸びる）と頭（床すれすれで後ろへ反り返る） */
    chFill(ctx, limbPoly(P(-82, -46), P(-92, -40), P(-102, -34), 9 * s, 8 * s, 8 * s), rand,
      { base: 0.44, strokes: 24, ang: 0.5, slen: 12 * s + 5, alpha: 0.24, w: 3.5, css: CH, stray: 4 });
    var head = [P(-96, -46), P(-112, -56), P(-132, -50), P(-140, -30),
      P(-133, -10), P(-113, -3), P(-97, -14), P(-92, -32)];
    chFill(ctx, head, rand, { base: 0.44, strokes: 62, ang: 0.9,
      slen: 18 * s + 6, css: CH, stray: 8 });
    /* 顔＝影で潰す（こちらを向いている） */
    var face = [P(-106, -48), P(-124, -46), P(-134, -30), P(-127, -14), P(-109, -8), P(-99, -26)];
    chFill(ctx, face, rand, { base: 0.88, strokes: 44, ang: 0.8,
      slen: 12 * s + 4, alpha: 0.36, scuffs: 18, css: 'rgb(18,15,15)', stray: 4 });
    /* 床の影 */
    var sh = [P(-166, 12), P(-40, 4), P(70, 6), P(126, 14), P(0, 26)];
    chFill(ctx, sh, rand, { base: 0.22, strokes: 52, ang: 0.04,
      slen: 50 * s + 12, alpha: 0.15, w: 3, css: CH, stray: 6 });
  }

  /** 掠れた印刷体の見出し（版が擦り切れた活字） */
  function chHeadline(ctx, text, cx, cy, px, rand) {
    var w = Math.ceil(px * text.length * 1.25) + 80, h = Math.ceil(px * 2.0);
    var off = offCanvas(w, h, function (x) {
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = 'rgb(26,24,22)';
      x.font = 'bold ' + px + 'px ' + JPM;
      /* 版ずれの淡いゴースト＋本刷り */
      x.globalAlpha = 0.22; x.fillText(text, w / 2 + 2.5, h / 2 + 1.5);
      x.globalAlpha = 1; x.fillText(text, w / 2, h / 2);
      /* 掠れ: インクの乗らなかった帯と粒を抜く */
      x.globalCompositeOperation = 'destination-out';
      var i;
      for (i = 0; i < 46; i++) {
        var yy = rand() * h;
        x.globalAlpha = 0.10 + rand() * 0.55;
        x.fillRect(rand() * w * 0.4, yy, w * (0.15 + rand() * 0.5), 1 + rand() * 3.5);
      }
      for (i = 0; i < 700; i++) {
        x.globalAlpha = 0.25 + rand() * 0.7;
        x.beginPath();
        x.arc(rand() * w, rand() * h, 0.6 + rand() * 2.6, 0, Math.PI * 2);
        x.fill();
      }
    });
    ctx.drawImage(off, cx - w / 2, cy - h / 2);
  }

  /** 手書き風の走り書き（1文字ずつ角度・大きさ・濃さを揺らす） */
  function chScrawl(ctx, text, x, y, px, rand) {
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var sc = 0.86 + rand() * 0.30;
      var rot = (rand() - 0.5) * 0.20;
      var dy = (rand() - 0.5) * px * 0.22;
      ctx.save();
      ctx.translate(cx + px * sc * 0.5, y + dy);
      ctx.rotate(rot);
      ctx.globalAlpha = 0.52 + rand() * 0.46;
      ctx.fillStyle = (rand() < 0.14) ? 'rgb(24,22,24)' : 'rgb(44,40,38)';
      ctx.font = Math.round(px * sc) + 'px ' + JP;
      ctx.fillText(ch, -px * sc * 0.5, 0);
      ctx.restore();
      cx += px * (0.82 + rand() * 0.16);
    }
    ctx.restore();
    return cx;
  }

  /** 赤い丸判（にじみ・かすれ） */
  function chStamp(ctx, lines, cx, cy, r, rot, rand) {
    var d = Math.ceil(r * 2.6);
    var off = offCanvas(d, d, function (x) {
      var c0 = d / 2;
      x.translate(c0, c0); x.rotate(rot); x.translate(-c0, -c0);
      x.strokeStyle = 'rgb(150,26,22)'; x.fillStyle = 'rgb(150,26,22)';
      x.lineWidth = r * 0.13;
      x.globalAlpha = 0.92;
      x.beginPath(); x.arc(c0, c0, r * 0.92, 0, Math.PI * 2); x.stroke();
      x.lineWidth = r * 0.05; x.globalAlpha = 0.6;
      x.beginPath(); x.arc(c0, c0, r * 0.76, 0, Math.PI * 2); x.stroke();
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.globalAlpha = 0.95;
      var fp = Math.round(r * 0.52);
      x.font = 'bold ' + fp + 'px ' + JPM;
      for (var i = 0; i < lines.length; i++) {
        x.fillText(lines[i], c0, c0 + (i - (lines.length - 1) / 2) * fp * 1.12);
      }
      /* にじみ（外へ淡く広がる）とかすれ（内が抜ける） */
      x.globalCompositeOperation = 'source-atop';
      for (var b = 0; b < 60; b++) {
        x.globalAlpha = 0.05 + rand() * 0.12;
        x.beginPath();
        x.arc(c0 + (rand() - 0.5) * r * 1.7, c0 + (rand() - 0.5) * r * 1.7, 2 + rand() * 9, 0, Math.PI * 2);
        x.fill();
      }
      x.globalCompositeOperation = 'destination-out';
      for (var k = 0; k < 190; k++) {
        x.globalAlpha = 0.15 + rand() * 0.55;
        x.beginPath();
        x.arc(c0 + (rand() - 0.5) * r * 2.0, c0 + (rand() - 0.5) * r * 2.0, 0.8 + rand() * 3.4, 0, Math.PI * 2);
        x.fill();
      }
    });
    ctx.save();
    ctx.globalAlpha = 0.86;
    ctx.drawImage(off, cx - d / 2, cy - d / 2);
    ctx.restore();
  }

  function texBigBoard() {
    var W = 1024, H = 683, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(41601);
    var i;

    /* ---- 紙面（褪せた大判の掲示。上ほど日焼け） ---- */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#cdc4ab'); g.addColorStop(0.45, '#c6bda4'); g.addColorStop(1, '#b8ae94');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* 紙の斑・古びた縁 */
    for (i = 0; i < 90; i++) {
      blot(ctx, rand() * W, rand() * H, 20 + rand() * 90, 'rgba(150,136,104,0.10)');
    }
    ctx.fillStyle = 'rgba(96,84,60,0.20)';
    ctx.fillRect(0, 0, W, 10); ctx.fillRect(0, H - 12, W, 12);
    ctx.fillRect(0, 0, 10, H); ctx.fillRect(W - 11, 0, 11, H);
    grain(ctx, W, H, 13, rand);

    /* ---- ① 見出し ---- */
    chHeadline(ctx, '封鎖区画 —— 立入禁止', W / 2, 84, 74, rand);
    ctx.strokeStyle = 'rgba(38,34,30,0.55)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(70, 132); ctx.lineTo(W - 70, 132); ctx.stroke();
    ctx.strokeStyle = 'rgba(38,34,30,0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(70, 140); ctx.lineTo(W - 70, 140); ctx.stroke();

    /* ---- ② 木炭風のスケッチ2点（作業用キャンバスで描いて合成） ---- */
    var skA = offCanvas(420, 360, function (x) { chStanding(x, rand, 210, 22, 310); });
    ctx.save(); ctx.globalAlpha = 0.94; ctx.drawImage(skA, 62, 158); ctx.restore();
    var skB = offCanvas(460, 360, function (x) { chCrawling(x, rand, 250, 300, 380); });
    ctx.save(); ctx.globalAlpha = 0.94; ctx.drawImage(skB, 520, 158); ctx.restore();
    /* 2枚のスケッチを分ける薄い罫（枠で囲うと図が弱くなるので縦罫1本だけ） */
    ctx.save();
    ctx.strokeStyle = 'rgba(52,46,42,0.26)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.35 + rand() * 0.4;
      ctx.beginPath();
      ctx.moveTo(504 + (rand() - 0.5) * 3, 168 + rand() * 6);
      ctx.lineTo(504 + (rand() - 0.5) * 3, 498 - rand() * 8);
      ctx.stroke();
    }
    ctx.restore();
    /* 読めない走り書きの注記（文字ではない短い線） */
    for (i = 0; i < 7; i++) {
      chLine(ctx, [[96 + i * 2, 486 + i * 3], [140 + rand() * 40, 484 + i * 3], [190 + rand() * 30, 488 + i * 3]],
        rand, { passes: 2, w: 2, alpha: 0.18, jit: 1.6, css: 'rgb(60,54,48)' });
    }

    /* ---- ③ 走り書き3行（docs/notes.md「P4.16追加」の正文） ---- */
    var lines = [
      '心臓の音を聞け。速くなったら、近い。',
      '音を立てるな。叫びが聞こえたら、もう走っている。',
      'ロッカーに入れ。板の陰で息を殺せ。'
    ];
    for (i = 0; i < lines.length; i++) chScrawl(ctx, lines[i], 62, 562 + i * 40, 28, rand);

    /* ---- ④ 赤い判 ---- */
    chStamp(ctx, ['回収', '未了'], 872, 588, 82, -0.19, rand);

    /* ---- ⑤ コーヒー染み・破れ・画鋲 ---- */
    ctx.save();
    for (i = 0; i < 3; i++) {
      var sx = [846, 210, 640][i], sy = [214, 640, 128][i], sr = [64, 40, 30][i];
      ctx.globalAlpha = 0.20;
      blot(ctx, sx, sy, sr, 'rgba(104,72,34,0.55)');
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = 'rgba(96,64,28,0.7)'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(sx, sy, sr * 0.92, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    /* 破れ（紙が欠けて下地の暗がりが出る） */
    ctx.fillStyle = 'rgba(24,22,20,0.85)';
    ctx.beginPath();
    ctx.moveTo(W - 8, H - 8); ctx.lineTo(W - 96, H - 8);
    ctx.lineTo(W - 40, H - 62); ctx.lineTo(W - 8, H - 74);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 236); ctx.lineTo(26, 258); ctx.lineTo(0, 292);
    ctx.closePath(); ctx.fill();
    /* 画鋲（4隅＋中央上） */
    var pins = [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34], [W / 2, 26]];
    for (i = 0; i < pins.length; i++) {
      var px = pins[i][0], py = pins[i][1];
      ctx.fillStyle = 'rgba(20,18,16,0.42)';
      ctx.beginPath(); ctx.arc(px + 2.5, py + 3, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = (i % 2) ? '#8d3a30' : '#3f4a54';
      ctx.beginPath(); ctx.arc(px, py, 9.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.beginPath(); ctx.arc(px - 3, py - 3.5, 3.2, 0, Math.PI * 2); ctx.fill();
    }
    speckle(ctx, W, H, 900, rand, 'rgba(88,76,54,0.16)', 2);
    fineGrit(ctx, 2600, rand, 'rgba(70,60,44,0.10)');
    return c;
  }

  /* ================================================================ */
  /* P4.16 項目2: 血痕の増補（壁の手形・引きずり跡・飛沫）                 */
  /*   色は乾いた暗赤〜黒に近い赤。濡れ光沢は最小限。                      */
  /* ================================================================ */
  /* 乾いた血の色。黒に落とさず「赤み」を残す（2026-09-10 差し戻し①②）。
     暗い通路でも赤と分かるよう、旧値 rgba(34,6,6) 系より明度・彩度を上げてある。 */
  var BLOOD_DARK = 'rgba(72,13,10,';   /* 芯（最も濃い） */
  var BLOOD_MID = 'rgba(104,22,16,';   /* 帯・手形の本体 */
  var BLOOD_THIN = 'rgba(132,38,28,';  /* 擦れ・にじみの縁 */
  /* 2026-09-11 P4.17 項目1（ユーザー評「壁の血痕も床と同じ赤黒く濃い色に」）:
     壁に貼る2種（押しつけた擦り／飛沫）専用の、床の血溜まりに寄せた暗い段。
     鮮やかな赤に見えていた旧 BLOOD_MID/THIN は壁では使わない。 */
  var BLOOD_WALL_DARK = 'rgba(54,10,8,';
  var BLOOD_WALL_MID = 'rgba(78,16,12,';
  var BLOOD_WALL_THIN = 'rgba(96,26,20,';

  /** にじんだ塊（楕円の放射グラデーション）。縁が立たないので擦り跡の基材に使う */
  function softBlob(ctx, x, y, rx, ry, rot, col, a) {
    if (!(rx > 0.1) || !(ry > 0.1)) return;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(1, ry / rx);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, col + a.toFixed(3) + ')');
    g.addColorStop(0.5, col + (a * 0.66).toFixed(3) + ')');
    g.addColorStop(0.82, col + (a * 0.22).toFixed(3) + ')');
    g.addColorStop(1, col + '0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  /** にじんだ消し（destination-out 用）。角の立った切り欠きを作らない */
  function softErase(ctx, x, y, rx, ry, rot, a) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    softBlob(ctx, x, y, rx, ry, rot, 'rgba(0,0,0,', a);
    ctx.restore();
  }

  /* 実寸の基準（2026-09-10 差し戻し①「実物大」）: 手の長さ（手首の付け根〜中指の先）
     ＝ 0.19m。テクスチャは PPM(px/m) で描き、面の実寸と必ず一致させる。 */
  var HAND_LEN_M = 0.19;

  /**
   * 手形を1つ押す。L = 手の長さ(px)。全長は概ね L（指先 -0.65L 〜 手首 +0.34L）。
   * 手のひら幅は 0.43L ≒ 8.2cm（L=19cm のとき）＝実寸の人の手。
   */
  function handPrint(ctx, cx, cy, L, rot, rand, alpha, palette) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot);
    /* P4.17 項目1: 壁に貼るときは暗い段（BLOOD_WALL_*）を渡す */
    var pal = palette || { dark: BLOOD_DARK, thin: BLOOD_THIN };
    var col = pal.dark;
    /* --- 手のひら --- */
    softBlob(ctx, 0, 0.06 * L, 0.235 * L, 0.29 * L, 0, col, alpha);
    ctx.fillStyle = col + (alpha * 0.92).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(0, 0.06 * L, 0.215 * L, 0.27 * L, 0, 0, Math.PI * 2);
    ctx.fill();
    /* 母指球・小指球（手のひらの接地は左右が濃い） */
    softBlob(ctx, -0.17 * L, 0.14 * L, 0.10 * L, 0.14 * L, 0, col, alpha * 0.9);
    softBlob(ctx, 0.16 * L, 0.12 * L, 0.09 * L, 0.13 * L, 0, col, alpha * 0.8);
    /* --- 4本指（付け根 -0.19L から先へ、わずかに細る） --- */
    var F = [[-0.145, -0.54, 0.048], [-0.045, -0.60, 0.050],
      [0.055, -0.565, 0.047], [0.145, -0.46, 0.041]];
    var i;
    for (i = 0; i < F.length; i++) {
      var bx = F[i][0] * L * 0.72, by = -0.19 * L;
      var tx = F[i][0] * L + (rand() - 0.5) * 0.02 * L, ty = F[i][1] * L;
      var w = F[i][2] * L;
      ctx.strokeStyle = col + (alpha * 0.95).toFixed(3) + ')';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = w * 2.0;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo((bx + tx) / 2 + (rand() - 0.5) * 0.03 * L, (by + ty) / 2, tx, ty);
      ctx.stroke();
      /* 指先の腹（少し太い） */
      softBlob(ctx, tx, ty + w * 0.4, w * 1.25, w * 1.5, 0, col, alpha * 0.85);
    }
    /* --- 親指（手のひらの横から斜めに） --- */
    ctx.strokeStyle = col + (alpha * 0.92).toFixed(3) + ')';
    ctx.lineWidth = 0.058 * L * 2.0;
    ctx.beginPath();
    ctx.moveTo(-0.185 * L, 0.13 * L);
    ctx.quadraticCurveTo(-0.30 * L, 0.03 * L, -0.335 * L, -0.11 * L);
    ctx.stroke();
    softBlob(ctx, -0.335 * L, -0.13 * L, 0.075 * L, 0.085 * L, 0, col, alpha * 0.85);
    /* --- 押しムラ（中心が抜けて縁が濃い＝血が薄く伸びた見え方） --- */
    for (i = 0; i < 26; i++) {
      softErase(ctx, (rand() - 0.5) * 0.34 * L, (rand() - 0.4) * 0.42 * L,
        0.03 * L + rand() * 0.09 * L, 0.03 * L + rand() * 0.08 * L, rand() * 3,
        0.10 + rand() * 0.38);
    }
    /* --- にじみの縁（外へ薄く広がる） --- */
    for (i = 0; i < 14; i++) {
      var an = rand() * Math.PI * 2, rr = 0.20 * L + rand() * 0.24 * L;
      softBlob(ctx, Math.cos(an) * rr * 0.9, Math.sin(an) * rr, 0.05 * L + rand() * 0.06 * L,
        0.05 * L + rand() * 0.06 * L, 0, pal.thin, 0.08 + rand() * 0.16);
    }
    ctx.restore();
  }

  /**
   * 壁の血痕「押しつけた擦り」（アルファ）。面は 1.50m x 1.125m、中心高さ 1.22m（腰〜肩）。
   * 1024px / 1.50m ＝ 682.7 px/m。手形は HAND_LEN_M（0.19m）＝130px で押す＝実物大。
   *
   * 2026-09-11 P4.17 項目1（ユーザー評「壁の無数の赤い縦線を消す」「壁も床と同じ赤黒く」）:
   *   ①指が掻いた長い筋（1面あたり8本・最長34cm）は**全廃**。
   *   ②掌が滑った擦りは短く（P4_17_HAND.smearM＝7cm以内）。
   *   ③垂れは P4_17_HAND.drips 本（＝2本）・各 P4_17_HAND.dripM（＝17cm）以内。
   *   ④色は BLOOD_WALL_* の暗い段（床の血溜まりと同じ赤黒）。
   *   数値は機械テスト（world.js testP417Blood）が読む。
   */
  var P4_17_HAND = { drips: 2, dripM: 0.17, smearM: 0.07, droplets: 90 };
  function texBloodHand() {
    var W = 1024, H = 768, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(70311);
    ctx.clearRect(0, 0, W, H);
    var PPM = W / 1.50;                 /* 682.7 px/m */
    var L = HAND_LEN_M * PPM;           /* 手の長さ 130px ＝ 19cm（実物大） */
    var PAL = { dark: BLOOD_WALL_DARK, thin: BLOOD_WALL_THIN };
    var i, k;

    /* 手形の位置（実物大の手が2つ。角度と濃さだけ変える） */
    var HANDS = [{ x: 0.235 * W, y: 0.32 * H, rot: -0.14, a: 0.90 },
      { x: 0.615 * W, y: 0.43 * H, rot: 0.46, a: 0.78 }];

    /* --- ① 掌が押しつけられて少しだけ滑った擦り（7cm以内。にじんだ塊だけで描く） --- */
    for (i = 0; i < HANDS.length; i++) {
      var hs = HANDS[i], slen = P4_17_HAND.smearM * PPM * (0.7 + rand() * 0.3);
      for (k = 0; k <= 14; k++) {
        var st = k / 14;
        softBlob(ctx, hs.x + Math.sin(st * 2.3 + i) * 0.008 * W + (rand() - 0.5) * 0.010 * W,
          hs.y + 0.30 * L + st * slen,
          L * (0.30 - st * 0.12), L * (0.20 - st * 0.07), 0,
          BLOOD_WALL_MID, (0.30 - st * 0.26) * hs.a * (0.7 + rand() * 0.5));
      }
    }
    /* --- ② 手形2つ（実物大。手の長さ L＝0.19m） --- */
    for (i = 0; i < HANDS.length; i++) {
      handPrint(ctx, HANDS[i].x, HANDS[i].y, L, HANDS[i].rot, rand, HANDS[i].a, PAL);
    }
    /* --- ③ 垂れ（重力に沿う細い筋）。2本・17cm以内。手形から離して置く
           （手形と繋がると1本の長い縦線に見えるため） --- */
    var DRIPS = [{ x: 0.085 * W, y: 0.300 * H, len: P4_17_HAND.dripM * PPM },
      { x: 0.880 * W, y: 0.470 * H, len: P4_17_HAND.dripM * PPM * 0.70 }];
    for (i = 0; i < P4_17_HAND.drips; i++) {
      var dp = DRIPS[i], dl = dp.len;
      ctx.strokeStyle = BLOOD_WALL_DARK + (0.34 + rand() * 0.16).toFixed(3) + ')';
      ctx.lineWidth = 2.0 + rand() * 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(dp.x, dp.y);
      ctx.lineTo(dp.x + (rand() - 0.5) * 7, dp.y + dl); ctx.stroke();
      /* 垂れの先の玉 */
      softBlob(ctx, dp.x + (rand() - 0.5) * 5, dp.y + dl, 4 + rand() * 4, 5 + rand() * 5, 0,
        BLOOD_WALL_DARK, 0.30 + rand() * 0.16);
      /* 垂れの出どころ（小さな擦り） */
      softBlob(ctx, dp.x, dp.y - 4, 9 + rand() * 6, 7 + rand() * 5, 0,
        BLOOD_WALL_MID, 0.26 + rand() * 0.14);
    }
    /* --- ④ 飛んだ細かい滴（P4.17: 260→90。点在程度に） --- */
    for (k = 0; k < P4_17_HAND.droplets; k++) {
      blot(ctx, 0.08 * W + rand() * 0.82 * W, 0.18 * H + rand() * 0.66 * H,
        1.2 + rand() * 4.0, BLOOD_WALL_MID + (0.16 + rand() * 0.34).toFixed(3) + ')');
    }
    return c;
  }

  /**
   * 引きずり跡（アルファ・V方向に始点→終点）。
   * 面は幅 0.90m（world.js DRAG_QUAD_W）、V は run 全体（2〜4マス＝4〜8m）に割り当てる。
   * 256px / 0.90m ＝ 284 px/m。帯の幅は 119px ≒ 0.42m（契約 30〜45cm）。
   * 2026-09-10 差し戻し②: 鋭い折れ線・黒い帯を禁止。
   *   ①連続した擦り帯 ②縁がにじんで薄れる ③乾いた暗赤 ④揺れは緩やか
   *   ⑤帯の中に濃淡の筋 ⑥終点付近に掠れ（擦れた手の跡）
   */
  var DRAG_BAND_M = 0.42;
  function texBloodDrag() {
    var W = 256, H = 1024, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(31877);
    ctx.clearRect(0, 0, W, H);
    var HALF = (DRAG_BAND_M / 0.90) * W / 2;      /* 帯の半幅 60px ＝ 21cm */
    var i, k, t, y;

    /* 中心線。緩やかな2成分のうねりだけ（振れ幅は合計 ±16px ＝ ±5.6cm） */
    function cxAt(tt) {
      return W / 2 + Math.sin(tt * 1.9 + 0.4) * 11 + Math.sin(tt * 4.3 + 1.7) * 5;
    }
    /* 帯の濃さ: 始点が濃く、終点へ向けて薄れる（消え際は 0 に落とす） */
    function ampAt(tt) {
      var a = 0.72 - 0.50 * Math.pow(tt, 0.85);
      if (tt > 0.90) a *= (1 - (tt - 0.90) / 0.10);
      return Math.max(0, a);
    }
    /* 行ごとの太さの揺らぎ（帯の輪郭を直線にしない） */
    function widAt(tt) {
      return HALF * (0.86 + 0.16 * Math.sin(tt * 13.7) + 0.08 * Math.sin(tt * 31.1 + 2.0));
    }

    /* --- ① 帯の本体: 1行ずつ横方向のグラデーションで塗る＝縁が必ずにじむ --- */
    /* 行ごとの揺らぎは「なめらかな関数」で作る。行ごとに独立した乱数を使うと
       横縞（リボン状の縞）が出て擦り跡に見えなくなるため（2026-09-10 実測）。 */
    function wob(tt, f1, f2, ph) {
      return 1 + 0.10 * Math.sin(tt * f1 + ph) + 0.05 * Math.sin(tt * f2 + ph * 1.7);
    }
    var STEP = 3;
    for (y = 0; y < H; y += STEP) {
      t = y / H;
      var a0 = ampAt(t) * wob(t, 47.3, 113.1, 0.6) * (0.98 + rand() * 0.04);
      if (a0 <= 0.004) continue;
      var hw = widAt(t) * wob(t, 29.7, 71.3, 2.2);
      var cx0 = cxAt(t) + (rand() - 0.5) * 1.2;
      var g = ctx.createLinearGradient(cx0 - hw, 0, cx0 + hw, 0);
      var e0 = 0.15 + 0.05 * Math.sin(t * 23.1), e1 = 0.85 + 0.05 * Math.sin(t * 19.7 + 1.4);
      g.addColorStop(0, BLOOD_MID + '0)');
      g.addColorStop(e0, BLOOD_MID + (a0 * 0.42).toFixed(3) + ')');
      g.addColorStop(0.36 + 0.04 * Math.sin(t * 37.7), BLOOD_MID + a0.toFixed(3) + ')');
      g.addColorStop(0.64 + 0.04 * Math.sin(t * 41.3 + 2.0), BLOOD_MID + (a0 * 0.88).toFixed(3) + ')');
      g.addColorStop(e1, BLOOD_MID + (a0 * 0.36).toFixed(3) + ')');
      g.addColorStop(1, BLOOD_MID + '0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx0 - hw, y, hw * 2, STEP + 1);
    }

    /* --- ② 帯の中の濃淡の筋（複数の指・布が擦った跡）。V方向に長く連続させる --- */
    for (i = 0; i < 22; i++) {
      var off = (rand() - 0.5) * HALF * 1.55;
      var t0 = rand() * 0.62, t1 = Math.min(0.98, t0 + 0.20 + rand() * 0.46);
      var dark = rand() < 0.62;
      var wln = 3 + rand() * 9;
      var seg = 22;
      for (k = 0; k <= seg; k++) {
        var tk = t0 + (t1 - t0) * (k / seg);
        var fade = Math.sin(Math.PI * (k / seg));            /* 両端で消える＝途切れない */
        var aa = (dark ? 0.20 : 0.11) * fade * ampAt(tk) / 0.7;
        if (aa <= 0.004) continue;
        softBlob(ctx, cxAt(tk) + off + (rand() - 0.5) * 4, tk * H,
          wln, wln * 3.6, 0, dark ? BLOOD_DARK : BLOOD_THIN, aa);
      }
    }

    /* --- ③ 始点の溜まり（引きずり始めが濃い） --- */
    softBlob(ctx, cxAt(0.02) + 4, 0.028 * H, HALF * 1.15, HALF * 0.85, 0, BLOOD_DARK, 0.80);
    softBlob(ctx, cxAt(0.05) - 14, 0.055 * H, HALF * 0.80, HALF * 0.62, 0, BLOOD_DARK, 0.62);
    for (i = 0; i < 26; i++) {
      var an = rand() * Math.PI * 2, r2 = HALF * (0.7 + rand() * 1.5);
      softBlob(ctx, cxAt(0.03) + Math.cos(an) * r2, 0.04 * H + Math.sin(an) * r2 * 0.8,
        4 + rand() * 14, 5 + rand() * 18, 0, BLOOD_MID, 0.10 + rand() * 0.32);
    }

    /* --- ④ 途切れ（床が乾いて跡が抜けた部分）。にじんだ消しだけを使う --- */
    for (i = 0; i < 22; i++) {
      t = 0.10 + rand() * 0.86;
      softErase(ctx, cxAt(t) + (rand() - 0.5) * HALF * 1.5, t * H,
        10 + rand() * 26, 16 + rand() * 48, 0, 0.18 + rand() * 0.44);
    }
    /* 縁の外側をさらに薄く削る（帯の幅を一定にしない） */
    for (i = 0; i < 40; i++) {
      t = rand();
      softErase(ctx, cxAt(t) + (rand() < 0.5 ? -1 : 1) * (HALF * 0.95 + rand() * HALF * 0.5),
        t * H, 12 + rand() * 22, 18 + rand() * 40, 0, 0.30 + rand() * 0.55);
    }

    /* --- ⑤ 終点付近の掠れ（擦れた手の跡・指4本ぶんの筋） --- */
    var te = 0.855, ex = cxAt(te);
    for (i = 0; i < 4; i++) {
      var ox = (i - 1.5) * (HALF * 0.34);
      for (k = 0; k <= 12; k++) {
        var tk2 = te + (k / 12) * 0.075;
        var fd = 1 - k / 12;
        softBlob(ctx, ex + ox + (rand() - 0.5) * 5 + (k / 12) * ox * 0.5, tk2 * H,
          4 + rand() * 3, 10 + rand() * 8, 0, BLOOD_DARK, 0.30 * fd + 0.05);
      }
    }
    softBlob(ctx, ex, (te + 0.012) * H, HALF * 0.52, HALF * 0.40, 0, BLOOD_DARK, 0.34);

    /* --- ⑥ 脇へ飛んだ細かい滴（帯の外にわずかに） --- */
    for (i = 0; i < 200; i++) {
      t = rand();
      blot(ctx, cxAt(t) + (rand() - 0.5) * HALF * 3.0, t * H * 0.94,
        1.0 + rand() * 3.4, BLOOD_MID + (0.10 + rand() * 0.34 * (1 - t)).toFixed(3) + ')');
    }
    return c;
  }

  /** 飛沫（アルファ・放射状に飛んだ滴） */
  function texBloodSplat() {
    var W = 256, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(52411);
    ctx.clearRect(0, 0, W, H);
    var ox = 96, oy = 118;
    /* 小さな溜まり */
    blot(ctx, ox, oy, 26, BLOOD_WALL_DARK + '0.72)');
    blot(ctx, ox + 10, oy + 8, 15, BLOOD_WALL_DARK + '0.60)');
    /* 主方向を持った飛沫（一方向に長く飛ぶ＝殴打の向きが読める） */
    var main = -0.55;
    for (var i = 0; i < 150; i++) {
      var a = main + (rand() - 0.5) * 1.5;
      var r = 18 + Math.pow(rand(), 0.6) * 150;
      var x = ox + Math.cos(a) * r, y = oy + Math.sin(a) * r;
      if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
      var sz = Math.max(0.8, 6.5 * (1 - r / 190) + rand() * 2.6);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = BLOOD_WALL_MID + (0.35 + rand() * 0.5).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(0, 0, sz * (1 + rand() * 1.6), sz, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      /* 尾を引く滴 */
      if (rand() < 0.28) {
        ctx.strokeStyle = BLOOD_WALL_THIN + (0.2 + rand() * 0.3).toFixed(2) + ')';
        ctx.lineWidth = 1 + rand() * 2;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * (6 + rand() * 18), y + Math.sin(a) * (6 + rand() * 18));
        ctx.stroke();
      }
    }
    /* 霧状の微細な飛沫 */
    for (var k = 0; k < 420; k++) {
      var a2 = main + (rand() - 0.5) * 2.2, r3 = 20 + rand() * 165;
      blot(ctx, ox + Math.cos(a2) * r3, oy + Math.sin(a2) * r3,
        0.5 + rand() * 1.7, BLOOD_WALL_MID + (0.16 + rand() * 0.4).toFixed(2) + ')');
    }
    return c;
  }

  /* ================================================================ */

  /* ================================================================
   * P5 エリア2「下水道」の素材（契約 §4 P5「見た目・細部」の10種）
   *   トーンはエリア1（研究所の白タイル・鋼板）と別系統にする:
   *   「暗い・湿った・古い」＝ 低彩度の茶／灰／黒緑。
   *   ただし真っ黒には潰さない（暗さは照明で作る。素材は読める明度を残す）。
   *   解像度は既存に合わせる（壁 512x768・床 512x512 の論理サイズ x TEX_S）。
   * ============================================================== */

  /** 下水道共通: 下へ向かうほど黒い水染み＋水位線の汚れ帯 */
  function damp(ctx, W, H, rand, opt) {
    opt = opt || {};
    var waterline = (opt.waterline === undefined) ? 0.62 : opt.waterline;
    /* 下部の水染み（重力方向・二乗で濃くなる） */
    var g = ctx.createLinearGradient(0, H, 0, H * waterline);
    g.addColorStop(0, 'rgba(10,14,13,' + (opt.dark === undefined ? 0.82 : opt.dark) + ')');
    g.addColorStop(0.45, 'rgba(12,18,16,0.42)');
    g.addColorStop(1, 'rgba(12,18,16,0)');
    ctx.fillStyle = g; ctx.fillRect(0, H * waterline, W, H * (1 - waterline));
    /* 水位線（かつて水が来ていた高さ）＝ 黒緑の帯と、その上の白い析出 */
    if (opt.line !== false) {
      var ly = H * waterline + (rand() - 0.5) * 10;
      var lg = ctx.createLinearGradient(0, ly - 16, 0, ly + 26);
      lg.addColorStop(0, 'rgba(36,48,34,0)');
      lg.addColorStop(0.4, 'rgba(30,44,30,0.42)');
      lg.addColorStop(1, 'rgba(16,24,18,0.12)');
      ctx.fillStyle = lg; ctx.fillRect(0, ly - 16, W, 42);
      ctx.strokeStyle = 'rgba(186,190,172,0.20)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ly - 14);
      for (var x = 0; x <= W; x += 26) ctx.lineTo(x, ly - 14 + (rand() - 0.5) * 7);
      ctx.stroke();
    }
    /* 上から垂れる黒い流れ染み（重力に沿う＝方向性のある汚れ） */
    var n = opt.runs === undefined ? 14 : opt.runs;
    for (var i = 0; i < n; i++) {
      var sx = rand() * W, sw = 5 + rand() * 22, sh = H * (0.25 + rand() * 0.7);
      var sg = ctx.createLinearGradient(0, 0, 0, sh);
      sg.addColorStop(0, 'rgba(14,20,18,0.46)');
      sg.addColorStop(0.6, 'rgba(16,22,20,0.26)');
      sg.addColorStop(1, 'rgba(16,22,20,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      for (var y = 0; y <= sh; y += 18) {
        ctx.lineTo(sx + (rand() - 0.5) * sw * 0.6 - sw / 2, y);
      }
      for (var y2 = sh; y2 >= 0; y2 -= 18) {
        ctx.lineTo(sx + (rand() - 0.5) * sw * 0.6 + sw / 2, y2);
      }
      ctx.closePath(); ctx.fill();
    }
  }

  /** 苔・ぬめり（濡れた面の緑。低い場所ほど濃い） */
  function moss(ctx, W, H, rand, n, lowBias, alpha) {
    for (var i = 0; i < n; i++) {
      var mx = rand() * W;
      var my = lowBias ? H * (0.35 + Math.pow(rand(), 0.55) * 0.65) : rand() * H;
      var mr = 12 + rand() * 62;
      var a = (alpha === undefined ? 0.30 : alpha) * (0.5 + rand() * 0.7);
      blot(ctx, mx, my, mr, 'rgba(' + (44 + rand() * 22 | 0) + ',' + (66 + rand() * 26 | 0) + ',' + (38 + rand() * 18 | 0) + ',' + a.toFixed(3) + ')');
    }
  }

  /** 石灰の垂れ（つらら状の白い析出。目地から下へ） */
  function limeDrip(ctx, x, y, len, rand) {
    var g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(214,214,198,0.52)');
    g.addColorStop(0.5, 'rgba(198,198,182,0.32)');
    g.addColorStop(1, 'rgba(190,190,176,0)');
    ctx.fillStyle = g;
    var w = 3 + rand() * 7;
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w * 0.35 + (rand() - 0.5) * 4, y + len);
    ctx.lineTo(x - w * 0.35 + (rand() - 0.5) * 4, y + len);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(226,226,212,0.30)';
    ctx.fillRect(x - w * 0.3, y, 1.5, len * 0.8);
  }

  /** 壁: 湿った古煉瓦（2m x 3m / 512 x 768）。目地に苔・下部ほど黒い水染み */
  function texWallBrick() {
    var W = 512, H = 768, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(520911);
    /* 目地（モルタル）を下地にして、その上に煉瓦を置く */
    ctx.fillStyle = '#3b3833'; ctx.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 9000, rand, 'rgba(74,70,62,0.45)');
    var BW = 64, BH = 26, J = 4;                 /* 煉瓦 25cm x 10cm・目地 1.5cm */
    var rows = Math.ceil(H / BH), cols = Math.ceil(W / BW) + 1;
    for (var ry = 0; ry < rows; ry++) {
      var off = (ry % 2) ? BW / 2 : 0;
      for (var rx = -1; rx < cols; rx++) {
        var bx = rx * BW + off + J / 2, by = ry * BH + J / 2;
        var bw = BW - J, bh = BH - J;
        /* 煉瓦1枚ごとの色ムラ（焼きムラ＋濡れ）。下段ほど暗く湿る */
        var wet = Math.min(1, by / H * 1.25);
        var base = 92 - wet * 32;
        var r0 = base + rand() * 22 - 8;
        var g0 = r0 * (0.76 + rand() * 0.08) + 3;
        var b0 = r0 * (0.66 + rand() * 0.10);
        if (rand() < 0.18) { g0 += 10; b0 += 5; r0 -= 12; }     /* 焼けすぎて黒緑になった煉瓦 */
        ctx.fillStyle = 'rgb(' + (r0 | 0) + ',' + (g0 | 0) + ',' + (b0 | 0) + ')';
        ctx.fillRect(bx, by, bw, bh);
        /* 面の微傾き（1枚ごとに光の向きが違う） */
        var lg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
        lg.addColorStop(0, 'rgba(255,240,220,' + (0.03 + rand() * 0.07).toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(0,0,0,' + (0.05 + rand() * 0.10).toFixed(3) + ')');
        ctx.fillStyle = lg; ctx.fillRect(bx, by, bw, bh);
        /* 角の欠け */
        if (rand() < 0.22) {
          var cx0 = bx + (rand() < 0.5 ? 0 : bw - 10), cy0 = by + (rand() < 0.5 ? 0 : bh - 8);
          ctx.fillStyle = 'rgba(46,42,36,0.85)';
          ctx.beginPath();
          ctx.moveTo(cx0, cy0);
          ctx.lineTo(cx0 + 4 + rand() * 8, cy0 + 1);
          ctx.lineTo(cx0 + 1, cy0 + 3 + rand() * 6);
          ctx.closePath(); ctx.fill();
        }
        /* 目地の影（上と左）＝ 立体感 */
        ctx.fillStyle = 'rgba(22,20,17,0.55)';
        ctx.fillRect(bx - J / 2, by - J / 2, bw + J, 2);
        ctx.fillRect(bx - J / 2, by - J / 2, 2, bh + J);
        ctx.fillStyle = 'rgba(150,146,132,0.10)';
        ctx.fillRect(bx - J / 2, by + bh - 1, bw + J, 1.5);
      }
    }
    /* 目地の苔（下ほど濃い）。緑は帯でなく目地の線に沿って乗せる */
    for (var m = 0; m < 260; m++) {
      var my = (Math.floor(Math.pow(rand(), 0.6) * rows)) * BH + J / 2;
      var mx = rand() * W;
      var ml = 12 + rand() * 70;
      ctx.strokeStyle = 'rgba(' + (48 + rand() * 26 | 0) + ',' + (72 + rand() * 30 | 0) + ',' + (40 + rand() * 20 | 0) + ',' + (0.18 + rand() * 0.42).toFixed(3) + ')';
      ctx.lineWidth = 2 + rand() * 3;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + ml, my + (rand() - 0.5) * 2); ctx.stroke();
    }
    moss(ctx, W, H, rand, 44, true, 0.26);
    /* 崩れた目地（モルタルが抜けた穴） */
    for (var h2 = 0; h2 < 26; h2++) {
      blot(ctx, rand() * W, H * (0.2 + rand() * 0.8), 4 + rand() * 12, 'rgba(18,16,14,0.62)');
    }
    /* 白い析出（石灰）が目地から短く垂れる */
    for (var l = 0; l < 12; l++) limeDrip(ctx, rand() * W, rand() * H * 0.7, 20 + rand() * 70, rand);
    damp(ctx, W, H, rand, { waterline: 0.60, dark: 0.84, runs: 16 });
    /* 天井側の煤けた影 */
    var gt = ctx.createLinearGradient(0, 0, 0, 110);
    gt.addColorStop(0, 'rgba(12,14,13,0.52)'); gt.addColorStop(1, 'rgba(12,14,13,0)');
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 110);
    scuff(ctx, 900, rand, 'rgba(26,24,20,0.20)', 0, 40);
    fineGrit(ctx, 26000, rand, 'rgba(22,26,22,0.26)');
    fineGrit(ctx, 9000, rand, 'rgba(150,156,140,0.10)');
    for (var cr = 0; cr < 6; cr++) crack(ctx, rand() * W, rand() * H, 80 + rand() * 220, rand() * 6.28, rand, 0);
    grain(ctx, c.width, c.height, 8, rand);
    return c;
  }

  /** 壁: 暗灰の切石ヴォールト（2m x 3m）。水染みと石灰の白い垂れ */
  function texWallStone() {
    var W = 512, H = 768, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(781344);
    ctx.fillStyle = '#2c2f2d'; ctx.fillRect(0, 0, W, H);      /* 目地 */
    var BW = 128, BH = 96, J = 6;                             /* 切石 50cm x 37cm */
    var rows = Math.ceil(H / BH), cols = Math.ceil(W / BW) + 1;
    for (var ry = 0; ry < rows; ry++) {
      var off = (ry % 2) ? BW / 2 : 0;
      for (var rx = -1; rx < cols; rx++) {
        var bx = rx * BW + off + J / 2, by = ry * BH + J / 2;
        var bw = BW - J, bh = BH - J;
        var v = 74 + rand() * 30 - Math.min(26, by / H * 30);
        ctx.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 3) | 0) + ',' + ((v - 2) | 0) + ')';
        ctx.fillRect(bx, by, bw, bh);
        /* 石の粒（花崗岩状の斑） */
        for (var s = 0; s < 220; s++) {
          var sv = v + (rand() - 0.5) * 44;
          ctx.fillStyle = 'rgba(' + (sv | 0) + ',' + ((sv + 4) | 0) + ',' + ((sv - 3) | 0) + ',0.5)';
          ctx.fillRect(bx + rand() * bw, by + rand() * bh, 1 + rand() * 2.6, 1 + rand() * 2.2);
        }
        /* ノミ跡（斜めの筋） */
        ctx.strokeStyle = 'rgba(20,22,21,0.20)'; ctx.lineWidth = 1.4;
        for (var t = 0; t < 16; t++) {
          var tx = bx + rand() * bw, ty = by + rand() * bh;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 10 + rand() * 16, ty + 6 + rand() * 10); ctx.stroke();
        }
        /* 面取りの陰影（上＝影・下＝受け光） */
        var bg = ctx.createLinearGradient(0, by, 0, by + bh);
        bg.addColorStop(0, 'rgba(0,0,0,0.34)');
        bg.addColorStop(0.22, 'rgba(0,0,0,0)');
        bg.addColorStop(0.86, 'rgba(0,0,0,0)');
        bg.addColorStop(1, 'rgba(206,212,206,0.10)');
        ctx.fillStyle = bg; ctx.fillRect(bx, by, bw, bh);
        /* 欠けた角 */
        if (rand() < 0.30) {
          ctx.fillStyle = 'rgba(34,36,34,0.9)';
          var qx = bx + (rand() < 0.5 ? -1 : bw - 16), qy = by + rand() * (bh - 16);
          ctx.beginPath(); ctx.moveTo(qx, qy);
          ctx.lineTo(qx + 8 + rand() * 12, qy + 3);
          ctx.lineTo(qx + 3, qy + 10 + rand() * 12);
          ctx.closePath(); ctx.fill();
        }
        /* 目地の影 */
        ctx.fillStyle = 'rgba(16,18,17,0.62)';
        ctx.fillRect(bx - J / 2, by - J / 2, bw + J, 3);
        ctx.fillRect(bx - J / 2, by - J / 2, 3, bh + J);
      }
    }
    /* 石灰の白い垂れ（目地から。ヴォールトの継ぎ目に多い） */
    for (var l = 0; l < 26; l++) {
      limeDrip(ctx, rand() * W, (Math.floor(rand() * rows)) * BH + 4, 40 + rand() * 190, rand);
    }
    /* 白い析出の面（にじみ） */
    for (var w2 = 0; w2 < 14; w2++) blot(ctx, rand() * W, rand() * H * 0.8, 24 + rand() * 90, 'rgba(196,198,186,0.12)');
    moss(ctx, W, H, rand, 34, true, 0.22);
    damp(ctx, W, H, rand, { waterline: 0.58, dark: 0.80, runs: 18 });
    var gt2 = ctx.createLinearGradient(0, 0, 0, 130);
    gt2.addColorStop(0, 'rgba(10,12,12,0.58)'); gt2.addColorStop(1, 'rgba(10,12,12,0)');
    ctx.fillStyle = gt2; ctx.fillRect(0, 0, W, 130);
    scuff(ctx, 1100, rand, 'rgba(18,20,19,0.18)', 0.5, 44);
    fineGrit(ctx, 30000, rand, 'rgba(20,24,22,0.24)');
    fineGrit(ctx, 11000, rand, 'rgba(170,176,168,0.10)');
    for (var cr2 = 0; cr2 < 9; cr2++) crack(ctx, rand() * W, rand() * H, 90 + rand() * 240, rand() * 6.28, rand, 0);
    grain(ctx, c.width, c.height, 8, rand);
    return c;
  }

  /** 壁: 打放しコンクリート（2m x 3m）。型枠の継ぎ目・黒い流れ染み */
  function texWallConcreteWet() {
    var W = 512, H = 768, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(300277);
    ctx.fillStyle = '#585d5a'; ctx.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 26000, rand, 'rgba(72,78,74,0.42)');
    speckle(ctx, W, H, 9000, rand, 'rgba(104,110,106,0.30)');
    /* 骨材とあばた（気泡痕） */
    for (var i = 0; i < 900; i++) {
      var v = 72 + rand() * 40;
      ctx.fillStyle = 'rgba(' + (v | 0) + ',' + ((v + 4) | 0) + ',' + ((v + 1) | 0) + ',0.45)';
      ctx.beginPath(); ctx.arc(rand() * W, rand() * H, 1 + rand() * 3, 0, Math.PI * 2); ctx.fill();
    }
    for (var p = 0; p < 260; p++) {
      var px = rand() * W, py = rand() * H, pr = 1.5 + rand() * 4;
      ctx.fillStyle = 'rgba(26,30,28,0.55)';
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(138,144,140,0.20)';
      ctx.beginPath(); ctx.arc(px, py - pr * 0.4, pr * 0.7, 0, Math.PI * 2); ctx.fill();
    }
    /* 型枠（合板）の木目が転写された筋 */
    for (var g2 = 0; g2 < 140; g2++) {
      ctx.fillStyle = 'rgba(' + (58 + rand() * 34 | 0) + ',' + (62 + rand() * 34 | 0) + ',' + (60 + rand() * 32 | 0) + ',0.13)';
      ctx.fillRect(0, rand() * H, W, 1 + rand() * 2.0);
    }
    /* 型枠の継ぎ目（0.9m ごとの水平・1m ごとの垂直）＋セパの穴 */
    var PH = 230, PV = 256;
    for (var y = 0; y <= H; y += PH) {
      ctx.fillStyle = 'rgba(24,28,26,0.72)'; ctx.fillRect(0, y - 2, W, 4);
      ctx.fillStyle = 'rgba(154,160,156,0.16)'; ctx.fillRect(0, y + 2, W, 2);
    }
    for (var x = 0; x <= W; x += PV) {
      ctx.fillStyle = 'rgba(24,28,26,0.60)'; ctx.fillRect(x - 2, 0, 4, H);
      ctx.fillStyle = 'rgba(154,160,156,0.12)'; ctx.fillRect(x + 2, 0, 2, H);
    }
    for (var hy = PH * 0.5; hy < H; hy += PH) {
      for (var hx = PV * 0.5; hx < W; hx += PV) {
        var hr = 7;
        ctx.fillStyle = 'rgba(22,26,24,0.85)';
        ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(122,128,124,0.35)';
        ctx.beginPath(); ctx.arc(hx, hy - 1.4, hr * 0.62, 0, Math.PI * 2); ctx.fill();
        /* 穴から下へ伸びる錆のにじみ（茶。赤くしない＝P4.17 の色相規定を踏襲） */
        rustRun(ctx, hx, hy + hr, 5 + rand() * 5, 26 + rand() * 64, rand, 0.55);
      }
    }
    /* 黒い流れ染み（多め） */
    damp(ctx, W, H, rand, { waterline: 0.66, dark: 0.78, runs: 26 });
    moss(ctx, W, H, rand, 30, true, 0.24);
    /* ひび（構造の亀裂） */
    for (var cr = 0; cr < 10; cr++) crack(ctx, rand() * W, rand() * H, 110 + rand() * 260, rand() * 6.28, rand, 0);
    var gt = ctx.createLinearGradient(0, 0, 0, 120);
    gt.addColorStop(0, 'rgba(12,16,15,0.50)'); gt.addColorStop(1, 'rgba(12,16,15,0)');
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, 120);
    scuff(ctx, 1200, rand, 'rgba(30,34,32,0.16)', 0, 46);
    fineGrit(ctx, 34000, rand, 'rgba(26,30,28,0.24)');
    fineGrit(ctx, 12000, rand, 'rgba(168,174,170,0.10)');
    grain(ctx, c.width, c.height, 9, rand);
    return c;
  }

  /** 床: 濡れた石畳（2m x 2m）。水たまりは低周波で明るく＝粗さマップで艶が出る */
  function texFloorStoneWet() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(640022);
    ctx.fillStyle = '#2f3230'; ctx.fillRect(0, 0, W, H);      /* 目地 */
    /* 玉石（不定形の多角形）を千鳥に敷く */
    var CS = 52;
    for (var ry = -1; ry <= H / CS + 1; ry++) {
      for (var rx = -1; rx <= W / CS + 1; rx++) {
        var ox = (ry % 2) ? CS * 0.5 : 0;
        var cx = rx * CS + ox + CS * 0.5 + (rand() - 0.5) * 6;
        var cy = ry * CS + CS * 0.5 + (rand() - 0.5) * 6;
        var v = 66 + rand() * 34;
        ctx.beginPath();
        for (var k = 0; k <= 9; k++) {
          var a = k / 9 * Math.PI * 2;
          var r = CS * (0.40 + rand() * 0.10);
          var qx = cx + Math.cos(a) * r, qy = cy + Math.sin(a) * r * 0.92;
          if (k === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgb(' + (v | 0) + ',' + ((v + 2) | 0) + ',' + ((v - 2) | 0) + ')';
        ctx.fill();
        /* 石の頂の摩耗（明るい）と縁の影 */
        var sg = ctx.createRadialGradient(cx - CS * 0.12, cy - CS * 0.14, 1, cx, cy, CS * 0.55);
        sg.addColorStop(0, 'rgba(226,230,224,' + (0.08 + rand() * 0.10).toFixed(3) + ')');
        sg.addColorStop(0.6, 'rgba(0,0,0,0)');
        sg.addColorStop(1, 'rgba(0,0,0,0.30)');
        ctx.fillStyle = sg; ctx.fill();
        for (var s = 0; s < 90; s++) {
          var sv = v + (rand() - 0.5) * 40;
          ctx.fillStyle = 'rgba(' + (sv | 0) + ',' + ((sv + 3) | 0) + ',' + ((sv - 2) | 0) + ',0.45)';
          ctx.fillRect(cx - CS * 0.4 + rand() * CS * 0.8, cy - CS * 0.4 + rand() * CS * 0.8, 1 + rand() * 2.2, 1 + rand() * 2);
        }
      }
    }
    /* 目地の泥と苔 */
    moss(ctx, W, H, rand, 46, false, 0.24);
    for (var d = 0; d < 40; d++) blot(ctx, rand() * W, rand() * H, 10 + rand() * 34, 'rgba(38,34,26,0.28)');
    /* 水たまり: 低周波で**明るい**冷色の膜（＝ materialMaps の粗さが下がり艶が出る）。
       半径は粗さマップのぼかし幅（テクスチャの1/24）より十分大きく取る。 */
    var pools = [
      [96, 128, 86], [330, 96, 68], [190, 330, 104], [408, 300, 74], [58, 400, 62], [300, 430, 58]
    ];
    for (var p = 0; p < pools.length; p++) {
      var px = pools[p][0], py = pools[p][1], pr = pools[p][2];
      ctx.save();
      ctx.beginPath();
      for (var k2 = 0; k2 <= 16; k2++) {
        var a2 = k2 / 16 * Math.PI * 2;
        var rr = pr * (0.82 + rand() * 0.30);
        var qx2 = px + Math.cos(a2) * rr, qy2 = py + Math.sin(a2) * rr * 0.82;
        if (k2 === 0) ctx.moveTo(qx2, qy2); else ctx.lineTo(qx2, qy2);
      }
      ctx.closePath();
      ctx.clip();
      /* 水膜＝空（天井の灯）の映り込み。周囲より明るい冷色 */
      var pg = ctx.createRadialGradient(px - pr * 0.2, py - pr * 0.25, 2, px, py, pr * 1.15);
      pg.addColorStop(0, 'rgba(138,168,178,0.56)');
      pg.addColorStop(0.55, 'rgba(106,138,148,0.50)');
      pg.addColorStop(1, 'rgba(70,98,108,0.34)');
      ctx.fillStyle = pg; ctx.fillRect(px - pr * 1.4, py - pr * 1.4, pr * 2.8, pr * 2.8);
      /* 水面のさざ波（細い明線） */
      ctx.strokeStyle = 'rgba(198,214,216,0.22)'; ctx.lineWidth = 1.4;
      for (var w3 = 0; w3 < 14; w3++) {
        var wy = py - pr + rand() * pr * 2;
        ctx.beginPath(); ctx.moveTo(px - pr, wy);
        ctx.bezierCurveTo(px - pr * 0.3, wy + (rand() - 0.5) * 6, px + pr * 0.3, wy + (rand() - 0.5) * 6, px + pr, wy);
        ctx.stroke();
      }
      ctx.restore();
      /* 水縁（濡れて暗い輪） */
      ctx.strokeStyle = 'rgba(20,26,26,0.42)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(px, py, pr * 1.02, pr * 0.86, 0, 0, Math.PI * 2); ctx.stroke();
    }
    /* 引きずり跡・摩耗の動線 */
    sheen(ctx, W, H, 3, rand, 0, 'rgba(190,206,208,%A%)');
    sheen(ctx, W, H, 2, rand, 1.5708, 'rgba(190,206,208,%A%)');
    scuff(ctx, 1400, rand, 'rgba(196,204,202,0.09)', 0, 48);
    scuff(ctx, 900, rand, 'rgba(24,26,24,0.16)', 0, 40);
    fineGrit(ctx, 30000, rand, 'rgba(24,28,26,0.24)');
    fineGrit(ctx, 10000, rand, 'rgba(176,186,184,0.10)');
    grain(ctx, c.width, c.height, 8, rand);
    return c;
  }

  /** 床: 煉瓦敷き（2m x 2m）。動線が摩耗して平ら・目地に泥 */
  function texFloorBrick() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(118822);
    ctx.fillStyle = '#33302b'; ctx.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 12000, rand, 'rgba(60,56,48,0.40)');
    var BW = 64, BH = 32, J = 4;
    var rows = Math.ceil(H / BH), cols = Math.ceil(W / BW) + 1;
    for (var ry = 0; ry < rows; ry++) {
      var off = (ry % 2) ? BW / 2 : 0;
      for (var rx = -1; rx < cols; rx++) {
        var bx = rx * BW + off + J / 2, by = ry * BH + J / 2;
        var bw = BW - J, bh = BH - J;
        var base = 80 + rand() * 24;
        var r0 = base, g0 = base * (0.78 + rand() * 0.08), b0 = base * (0.68 + rand() * 0.10);
        if (rand() < 0.16) { r0 -= 16; g0 += 5; b0 += 2; }
        ctx.fillStyle = 'rgb(' + (r0 | 0) + ',' + (g0 | 0) + ',' + (b0 | 0) + ')';
        ctx.fillRect(bx, by, bw, bh);
        var lg = ctx.createLinearGradient(bx, by, bx + bw * 0.4, by + bh);
        lg.addColorStop(0, 'rgba(255,244,226,' + (0.03 + rand() * 0.06).toFixed(3) + ')');
        lg.addColorStop(1, 'rgba(0,0,0,' + (0.06 + rand() * 0.10).toFixed(3) + ')');
        ctx.fillStyle = lg; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(20,18,15,0.50)';
        ctx.fillRect(bx - J / 2, by - J / 2, bw + J, 2);
        ctx.fillRect(bx - J / 2, by - J / 2, 2, bh + J);
        ctx.fillStyle = 'rgba(150,142,126,0.09)';
        ctx.fillRect(bx - J / 2, by + bh - 1, bw + J, 1.5);
        if (rand() < 0.18) {
          ctx.fillStyle = 'rgba(44,40,34,0.8)';
          ctx.beginPath();
          var qx = bx + rand() * bw, qy = by + (rand() < 0.5 ? 0 : bh - 6);
          ctx.moveTo(qx, qy); ctx.lineTo(qx + 5 + rand() * 9, qy + 1); ctx.lineTo(qx + 2, qy + 4 + rand() * 5);
          ctx.closePath(); ctx.fill();
        }
      }
    }
    /* 動線の摩耗（中央が擦れて明るく平滑） */
    var wear = ctx.createLinearGradient(0, H * 0.5 - 150, 0, H * 0.5 + 150);
    wear.addColorStop(0, 'rgba(206,196,178,0)');
    wear.addColorStop(0.5, 'rgba(206,196,178,0.16)');
    wear.addColorStop(1, 'rgba(206,196,178,0)');
    ctx.fillStyle = wear; ctx.fillRect(0, 0, W, H);
    /* 目地の泥・苔・落ちた砂 */
    for (var m = 0; m < 44; m++) blot(ctx, rand() * W, rand() * H, 12 + rand() * 44, 'rgba(40,36,26,0.30)');
    moss(ctx, W, H, rand, 26, false, 0.20);
    /* 欠けて抜けた煉瓦（穴） */
    for (var hh = 0; hh < 5; hh++) {
      var hx = rand() * W, hy = rand() * H;
      ctx.fillStyle = 'rgba(18,17,14,0.80)';
      ctx.fillRect(hx, hy, BW - J, BH - J);
      blot(ctx, hx + BW * 0.4, hy + BH * 0.4, 22, 'rgba(12,12,10,0.5)');
    }
    sheen(ctx, W, H, 3, rand, 0, 'rgba(214,204,186,%A%)');
    scuff(ctx, 1500, rand, 'rgba(212,202,184,0.08)', 0, 50);
    scuff(ctx, 900, rand, 'rgba(26,24,20,0.15)', 0, 40);
    fineGrit(ctx, 28000, rand, 'rgba(26,24,20,0.24)');
    fineGrit(ctx, 9000, rand, 'rgba(178,170,152,0.10)');
    grain(ctx, c.width, c.height, 8, rand);
    return c;
  }

  /** 床: 泥と堆積物（2m x 2m）。足跡つき */
  function texFloorMud() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(455901);
    ctx.fillStyle = '#4a4234'; ctx.fillRect(0, 0, W, H);
    /* 堆積のムラ（大きいうねり） */
    for (var i = 0; i < 70; i++) {
      var v = 52 + rand() * 34;
      blot(ctx, rand() * W, rand() * H, 40 + rand() * 130,
        'rgba(' + (v | 0) + ',' + ((v - 5) | 0) + ',' + ((v - 16) | 0) + ',0.40)');
    }
    /* 濡れて黒くなった窪み */
    for (var d = 0; d < 34; d++) blot(ctx, rand() * W, rand() * H, 18 + rand() * 76, 'rgba(20,20,16,0.36)');
    /* 乾いて白く浮いた膜 */
    for (var w2 = 0; w2 < 18; w2++) blot(ctx, rand() * W, rand() * H, 20 + rand() * 60, 'rgba(150,142,120,0.14)');
    /* 砂利・小石・堆積した破片 */
    for (var s = 0; s < 900; s++) {
      var sv = 70 + rand() * 46;
      ctx.fillStyle = 'rgba(' + (sv | 0) + ',' + ((sv - 4) | 0) + ',' + ((sv - 14) | 0) + ',' + (0.28 + rand() * 0.34).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(rand() * W, rand() * H, 1 + rand() * 2.4, 0, Math.PI * 2); ctx.fill();
    }
    /* ひび割れた泥（乾いた面の亀甲） */
    for (var cr = 0; cr < 26; cr++) crack(ctx, rand() * W, rand() * H, 40 + rand() * 130, rand() * 6.28, rand, 0);
    /* 足跡（2列・進行方向へ）。縁が盛り上がり中が暗い */
    var fa = rand() * Math.PI * 2;
    var fx0 = rand() * W, fy0 = rand() * H;
    for (var f = 0; f < 9; f++) {
      var side = (f % 2) ? 1 : -1;
      var fx = fx0 + Math.cos(fa) * f * 46 + Math.cos(fa + 1.57) * side * 13;
      var fy = fy0 + Math.sin(fa) * f * 46 + Math.sin(fa + 1.57) * side * 13;
      ctx.save();
      ctx.translate(fx % W, fy % H); ctx.rotate(fa + 1.57);
      ctx.fillStyle = 'rgba(170,162,140,0.08)';
      ctx.beginPath(); ctx.ellipse(0, 0, 12.5, 24.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(14,14,11,0.50)';
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 21, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(20,20,15,0.42)';
      ctx.beginPath(); ctx.ellipse(0, 14.5, 8, 8.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    /* 引きずり跡 */
    ctx.strokeStyle = 'rgba(24,24,18,0.26)';
    for (var t = 0; t < 8; t++) {
      ctx.lineWidth = 5 + rand() * 16;
      ctx.beginPath();
      var tx = rand() * W;
      ctx.moveTo(tx, -8);
      ctx.bezierCurveTo(tx + (rand() - 0.5) * 70, H * 0.4, tx + (rand() - 0.5) * 90, H * 0.72, tx + (rand() - 0.5) * 50, H + 8);
      ctx.stroke();
    }
    moss(ctx, W, H, rand, 18, false, 0.18);
    fineGrit(ctx, 40000, rand, 'rgba(22,22,17,0.28)');
    fineGrit(ctx, 14000, rand, 'rgba(170,162,140,0.10)');
    grain(ctx, c.width, c.height, 11, rand);
    return c;
  }

  /**
   * 水面: 黒緑の下水（2m x 2m）。
   * 継ぎ目なくスクロールさせるので、波は**整数の波数**の正弦の和で作る
   * （x/W・y/H が1周する＝上下左右どこで切っても繋がる）。
   * 実時間の揺れは ESCAPE.Textures.animate(dt) が offset を動かして作る
   * （キャンバスの描き換えは1回きり＝iPhone でも負荷が増えない）。
   */
  var WAVES = [
    /* [nx, ny, amp, phase] */
    [6, 2, 1.00, 0.00], [3, 7, 0.82, 1.31], [9, 5, 0.58, 2.44],
    [13, 11, 0.34, 0.77], [17, 6, 0.24, 3.90], [8, 19, 0.20, 5.12],
    [22, 14, 0.13, 2.05], [5, 27, 0.09, 4.41]
  ];
  function texWaterSewer() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(909142);
    var dw = c.width, dh = c.height;
    var img = ctx.createImageData(dw, dh);
    var d = img.data;
    var TAU = Math.PI * 2, amax = 0;
    for (var k = 0; k < WAVES.length; k++) amax += WAVES[k][2];
    for (var y = 0; y < dh; y++) {
      var v = y / dh;
      for (var x = 0; x < dw; x++) {
        var u = x / dw, s = 0;
        for (var w = 0; w < WAVES.length; w++) {
          var q = WAVES[w];
          s += q[2] * Math.sin(TAU * (q[0] * u + q[1] * v) + q[3]);
        }
        var hgt = s / amax;                       /* -1 .. 1 */
        var b = 0.5 + 0.5 * hgt;
        /* 黒緑の水。緑を主に、赤は最小限（真っ黒にはしない） */
        var r0 = 12 + 18 * b;
        var g0 = 26 + 34 * b;
        var b0 = 22 + 26 * b;
        /* 波の頂の擬似スペキュラ（灯が水面で割れる） */
        var cr = hgt > 0 ? Math.pow(hgt, 7) : 0;
        r0 += cr * 96; g0 += cr * 104; b0 += cr * 88;
        var o = (y * dw + x) * 4;
        d[o] = clamp255(r0); d[o + 1] = clamp255(g0); d[o + 2] = clamp255(b0); d[o + 3] = 255;
      }
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(img, 0, 0);
    ctx.restore();
    /* 浮遊物・油膜・泡（縁をまたがない位置に置く＝タイルの継ぎ目を壊さない） */
    for (var i = 0; i < 26; i++) {
      var ox = 60 + rand() * (W - 120), oy = 60 + rand() * (H - 120), orr = 14 + rand() * 42;
      var og = ctx.createRadialGradient(ox, oy, 1, ox, oy, orr);
      og.addColorStop(0, 'rgba(96,74,120,0.16)');
      og.addColorStop(0.5, 'rgba(70,104,96,0.14)');
      og.addColorStop(1, 'rgba(60,80,70,0)');
      ctx.fillStyle = og;
      ctx.beginPath(); ctx.arc(ox, oy, orr, 0, Math.PI * 2); ctx.fill();
    }
    for (var f = 0; f < 120; f++) {
      ctx.fillStyle = 'rgba(' + (150 + rand() * 60 | 0) + ',' + (156 + rand() * 60 | 0) + ',' + (140 + rand() * 50 | 0) + ',' + (0.10 + rand() * 0.26).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(50 + rand() * (W - 100), 50 + rand() * (H - 100), 1 + rand() * 4, 0, Math.PI * 2); ctx.fill();
    }
    for (var g2 = 0; g2 < 34; g2++) {
      blot(ctx, 60 + rand() * (W - 120), 60 + rand() * (H - 120), 10 + rand() * 30, 'rgba(18,26,18,0.34)');
    }
    return c;
  }

  /**
   * 金属の格子（アルファ。床の grate・排水口）。
   * 透過部分は完全に抜く。世界側は alphaTest:0.5・transparent:true で使うこと
   * （CanvasTexture は非プリマルチプライ想定だが、ブラウザが内部で
   *  プリマルチプライして抜けた画素の色が黒になるため、alphaTest で縁を切る）。
   */
  function texMetalGrate() {
    var W = 256, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(662201);
    ctx.clearRect(0, 0, W, H);
    var BAR = 16, PITCH = 64;                    /* 主桟 6cm・ピッチ 25cm */
    function bar(x, y, w, h, vert) {
      var g = vert ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(44,46,44,1)');
      g.addColorStop(0.28, 'rgba(126,130,128,1)');
      g.addColorStop(0.62, 'rgba(92,96,94,1)');
      g.addColorStop(1, 'rgba(34,36,34,1)');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    }
    for (var x = 0; x < W; x += PITCH) bar(x, 0, BAR, H, true);
    for (var y = 0; y < H; y += PITCH * 2) bar(0, y + PITCH - 5, W, 10, false);
    /* 錆・汚れ（桟の上だけに乗るよう source-atop で合成） */
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (var i = 0; i < 120; i++) {
      ctx.fillStyle = 'rgba(' + (96 + rand() * 40 | 0) + ',' + (62 + rand() * 30 | 0) + ',' + (28 + rand() * 18 | 0) + ',' + (0.18 + rand() * 0.44).toFixed(2) + ')';
      ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 12, 2 + rand() * 20);
    }
    for (var m = 0; m < 40; m++) blot(ctx, rand() * W, rand() * H, 8 + rand() * 26, 'rgba(34,48,32,0.30)');
    for (var s = 0; s < 900; s++) {
      ctx.fillStyle = 'rgba(20,22,20,0.30)';
      ctx.fillRect((rand() * W) | 0, (rand() * H) | 0, 1, 1);
    }
    /* 踏面の摩耗（上面が擦れて光る） */
    for (var x2 = 0; x2 < W; x2 += PITCH) {
      ctx.fillStyle = 'rgba(196,202,200,0.22)';
      ctx.fillRect(x2 + 3, 0, 3, H);
    }
    ctx.restore();
    return c;
  }

  /** 配管: 錆と塗装の剥げ（円周方向にタイル可。溶接のリングは横帯） */
  function texPipeRust() {
    var W = 512, H = 512, T2 = makeTex(W, H), c = T2.c, ctx = T2.ctx;
    var rand = rng(773310);
    ctx.fillStyle = '#38403c'; ctx.fillRect(0, 0, W, H);       /* 工業用の暗い緑灰の塗装 */
    speckle(ctx, W, H, 16000, rand, 'rgba(52,62,58,0.40)');
    speckle(ctx, W, H, 6000, rand, 'rgba(78,90,86,0.28)');
    /* 溶接リング（管軸に直交＝横帯）。継ぎ手のふくらみ */
    for (var y = 0; y < H; y += 170) {
      var wg = ctx.createLinearGradient(0, y - 12, 0, y + 14);
      wg.addColorStop(0, 'rgba(18,22,20,0.55)');
      wg.addColorStop(0.45, 'rgba(126,132,126,0.45)');
      wg.addColorStop(1, 'rgba(18,22,20,0.55)');
      ctx.fillStyle = wg; ctx.fillRect(0, y - 12, W, 26);
      /* ビードの粒 */
      for (var b = 0; b < 120; b++) {
        ctx.fillStyle = 'rgba(' + (110 + rand() * 60 | 0) + ',' + (104 + rand() * 52 | 0) + ',' + (94 + rand() * 44 | 0) + ',0.5)';
        ctx.beginPath(); ctx.arc(rand() * W, y + (rand() - 0.5) * 16, 1.5 + rand() * 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    /* 広い錆のにじみ（塗装の下で進む腐食。低周波の茶） */
    for (var b3 = 0; b3 < 26; b3++) {
      blot(ctx, rand() * W, rand() * H, 30 + rand() * 96,
        'rgba(' + (86 + rand() * 26 | 0) + ',' + (62 + rand() * 20 | 0) + ',' + (40 + rand() * 14 | 0) + ',0.26)');
    }
    /* 塗装の剥げ＝下地の錆が出る（小さく・多く。大きな斑は迷彩に見える） */
    for (var p = 0; p < 54; p++) {
      var px = rand() * W, py = rand() * H, pr = 6 + rand() * 17;
      peel(ctx, px, py, pr, rand,
        'rgba(' + (98 + rand() * 24 | 0) + ',' + (68 + rand() * 20 | 0) + ',' + (42 + rand() * 14 | 0) + ',0.72)',
        'rgba(30,34,31,0.55)');
      /* 剥げの下から流れる錆（管軸方向＝縦） */
      rustRun(ctx, px, py + pr * 0.6, 4 + rand() * 8, 22 + rand() * 80, rand, 0.55);
    }
    /* 錆の粒（塗装の上に点々と噴き出す） */
    for (var r2 = 0; r2 < 900; r2++) {
      ctx.fillStyle = 'rgba(' + (104 + rand() * 44 | 0) + ',' + (64 + rand() * 30 | 0) + ',' + (30 + rand() * 16 | 0) + ',' + (0.2 + rand() * 0.5).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(rand() * W, rand() * H, 1 + rand() * 3, 0, Math.PI * 2); ctx.fill();
    }
    /* 結露と黒い汚れの筋 */
    for (var s2 = 0; s2 < 16; s2++) {
      ctx.strokeStyle = 'rgba(16,20,18,' + (0.14 + rand() * 0.24).toFixed(2) + ')';
      ctx.lineWidth = 3 + rand() * 10;
      ctx.beginPath();
      var sx = rand() * W;
      ctx.moveTo(sx, -8);
      ctx.bezierCurveTo(sx + (rand() - 0.5) * 40, H * 0.4, sx + (rand() - 0.5) * 50, H * 0.7, sx + (rand() - 0.5) * 30, H + 8);
      ctx.stroke();
    }
    moss(ctx, W, H, rand, 20, false, 0.18);
    /* 円筒の陰影は付けない（法線と近傍灯が作る）。粒だけ足す */
    scuff(ctx, 1200, rand, 'rgba(22,26,24,0.18)', 1.5708, 44);
    fineGrit(ctx, 26000, rand, 'rgba(24,28,26,0.24)');
    fineGrit(ctx, 8000, rand, 'rgba(170,164,150,0.10)');
    grain(ctx, c.width, c.height, 8, rand);
    return c;
  }

  /**
   * ぬめり帯（アルファ）。水位線に沿って横に長く貼る帯。
   * 上下端は alpha でぼかし、帯の下側に垂れを付ける。
   */
  function texSlime() {
    var W = 512, H = 128, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(214477);
    ctx.clearRect(0, 0, W, H);
    /* 帯の本体（黒緑）。上端はゆらぐ水位線、下端はぼける */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.00, 'rgba(44,62,36,0)');
    g.addColorStop(0.16, 'rgba(40,60,34,0.84)');
    g.addColorStop(0.45, 'rgba(26,44,26,0.95)');
    g.addColorStop(0.80, 'rgba(16,28,18,0.62)');
    g.addColorStop(1.00, 'rgba(12,20,14,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var x = 0; x <= W; x += 16) {
      var yy = H * 0.16 + Math.sin(x / W * Math.PI * 6) * 5 + Math.sin(x / W * Math.PI * 14) * 3 + (rand() - 0.5) * 4;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(W, H);
    ctx.closePath(); ctx.fill();
    /* ぬめりの照り（湿って光る細い線を水位線の直下に） */
    ctx.strokeStyle = 'rgba(186,214,170,0.52)'; ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (var x2 = 0; x2 <= W; x2 += 12) {
      var y2 = H * 0.20 + Math.sin(x2 / W * Math.PI * 6) * 5 + (rand() - 0.5) * 3;
      if (x2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    /* 垂れ（帯の下へ伸びる糸状のぬめり） */
    for (var i = 0; i < 40; i++) {
      var dx = rand() * W, dl = 10 + rand() * 54;
      var dg = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.4 + dl);
      dg.addColorStop(0, 'rgba(26,40,26,0.60)');
      dg.addColorStop(1, 'rgba(22,34,22,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(dx, H * 0.4, 2 + rand() * 6, dl);
    }
    /* 藻の粒・気泡 */
    for (var s = 0; s < 700; s++) {
      var sy = H * (0.16 + rand() * 0.7);
      ctx.fillStyle = 'rgba(' + (48 + rand() * 50 | 0) + ',' + (76 + rand() * 60 | 0) + ',' + (44 + rand() * 30 | 0) + ',' + (0.2 + rand() * 0.5).toFixed(2) + ')';
      ctx.fillRect((rand() * W) | 0, sy | 0, 1 + (rand() < 0.3 ? 1 : 0), 1 + (rand() < 0.3 ? 1 : 0));
    }
    return c;
  }

  var BUILDERS = {
    wall: function () { return texWall(1337); },
    wall2: function () { return texWall(90210); },
    wall3: function () { return texWall(555013); },
    poster: texPoster, litter: texLitter,
    floor: texFloor, ceiling: texCeiling, metal: texMetal,
    lamp: texLamp, screen: texScreen, paper: texPaper, sheet: texSheet,
    water: texWater, glass: texGlass, blood: texBlood, hatch: texHatch,
    sign: texSign, tankfluid: texTankFluid, board: texBoard, monitors: texMonitors,
    zonesign: texZoneSign,
    zonesignA2: texZoneSignA2,
    bigboard: texBigBoard,
    bloodHand: texBloodHand, bloodDrag: texBloodDrag, bloodSplat: texBloodSplat,
    wallPaint: texWallPaint, wallMetal: texWallMetal,
    floorTile: texFloorTile, floorWet: texFloorWet, floorMetal: texFloorMetal,
    /* P5 エリア2「下水道」（契約 §4 P5「見た目・細部」の素材キー10種）。
       同じキーを js/render_quality.js の MAT_PROFILE にも登録してある
       （両方に無いと法線・粗さが付かない）。 */
    wallBrick: texWallBrick, wallStone: texWallStone, wallConcreteWet: texWallConcreteWet,
    floorStoneWet: texFloorStoneWet, floorBrick: texFloorBrick, floorMud: texFloorMud,
    waterSewer: texWaterSewer, metalGrate: texMetalGrate,
    pipeRust: texPipeRust, slime: texSlime
  };

  /* エリア専用の大面素材（GPU 見積りの区分け。エリア切替＝ページ再読込なので
     この2群が同時に GPU へ載ることはない）。ここに無いものは共通素材として数える。 */
  var AREA1_TEX = {
    wall: 1, wall2: 1, wall3: 1, wallPaint: 1, wallMetal: 1,
    floor: 1, floorTile: 1, floorWet: 1, floorMetal: 1
  };
  var AREA2_TEX = {
    wallBrick: 1, wallStone: 1, wallConcreteWet: 1,
    floorStoneWet: 1, floorBrick: 1, floorMud: 1,
    waterSewer: 1, metalGrate: 1, pipeRust: 1, slime: 1,
    zonesignA2: 1
  };

  /** アルファを持つ素材（世界側は transparent / alphaTest で使うこと） */
  var ALPHA_TEX = {
    poster: 1, litter: 1, water: 1, glass: 1, blood: 1, paper: 1, sheet: 1,
    bloodHand: 1, bloodDrag: 1, bloodSplat: 1,
    metalGrate: 1, slime: 1, zonesignA2: 1
  };

  var cache = Object.create(null);
  var anisotropy = 8;

  function get(name) {
    if (cache[name]) return cache[name];
    var b = BUILDERS[name];
    if (!b) throw new Error('unknown texture: ' + name);
    var tex = new THREE.CanvasTexture(b());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    cache[name] = tex;
    return tex;
  }

  /* ================================================================
   * P5: 動く素材（水面の揺れ）
   *   契約 §4 P5「waterSewer は法線を時間でスクロールして揺らす／静止した板に
   *   見えないこと」「fallback では静止テクスチャに落とす」。
   *   キャンバスの描き換えは**しない**。offset だけを毎フレーム進める
   *   （iPhone の負荷を増やさないため。テクスチャの再アップロードが起きない）。
   *   world.js（P5c）が毎フレーム ESCAPE.Textures.animate(dt) を呼ぶ前提。
   * ============================================================== */
  var ANIMATED = {
    waterSewer: {
      albedo: [0.0130, 0.0075],       /* アルベドのスクロール（uv/秒） */
      n1: [0.0210, 0.0125],           /* 法線 1層目 */
      n2: [-0.0145, 0.0235],          /* 法線 2層目（逆向き＝干渉して周期が読めない） */
      pulseHz: 0.11, pulseAmp: 0.055  /* わずかな明滅（光の反射が寄る・散る） */
    }
  };
  var animT = 0;
  var animEnabled = true;
  var animState = Object.create(null);
  var animMats = [];                  /* RQ.waterMaterial が登録した材質の uniform */

  function animTier() {
    var RQ = ESCAPE.RQ;
    if (!RQ) return 'high';
    return (typeof RQ.tier === 'function') ? RQ.tier() : RQ.tier;
  }
  /** この段階で動かしてよいか（fallback / off は静止） */
  function animLive() {
    if (!animEnabled) return false;
    var t = animTier();
    return t !== 'fallback' && t !== 'off';
  }
  function animSlot(name) {
    var st = animState[name];
    if (!st) {
      st = animState[name] = { t: 0, au: 0, av: 0, u1: 0, v1: 0, u2: 0, v2: 0, pulse: 1, moving: false };
    }
    return st;
  }
  function frac(v) { v = v % 1; return v < 0 ? v + 1 : v; }

  /**
   * 動く素材を dt 秒ぶん進める。
   *   戻り値: 進んだあとの内部時刻（秒）。fallback では常に 0。
   */
  function animate(dt) {
    if (!(dt > 0) || !isFinite(dt)) dt = 0;
    var live = animLive();
    if (live) animT += dt;
    for (var name in ANIMATED) {
      if (!ANIMATED.hasOwnProperty(name)) continue;
      var a = ANIMATED[name], st = animSlot(name);
      if (live) {
        st.t = animT;
        st.au = frac(a.albedo[0] * animT); st.av = frac(a.albedo[1] * animT);
        st.u1 = frac(a.n1[0] * animT); st.v1 = frac(a.n1[1] * animT);
        st.u2 = frac(a.n2[0] * animT); st.v2 = frac(a.n2[1] * animT);
        st.pulse = 1 + a.pulseAmp * Math.sin(Math.PI * 2 * a.pulseHz * animT);
        st.moving = true;
      } else {
        st.t = 0; st.au = st.av = st.u1 = st.v1 = st.u2 = st.v2 = 0;
        st.pulse = 1; st.moving = false;
      }
      /* アルベド（＝ CanvasTexture）は offset を動かすだけ。needsUpdate は不要 */
      var tex = cache[name];
      if (tex) { tex.offset.x = st.au; tex.offset.y = st.av; }
    }
    /* 法線2層＋明滅は材質の uniform 側で受ける（RQ.waterMaterial が結線する） */
    for (var i = 0; i < animMats.length; i++) {
      var m = animMats[i], s2 = animSlot(m.name);
      if (m.u.uNrmOff1) m.u.uNrmOff1.value.set(s2.u1, s2.v1);
      if (m.u.uNrmOff2) m.u.uNrmOff2.value.set(s2.u2, s2.v2);
      if (m.u.uPulse) m.u.uPulse.value = s2.pulse;
    }
    return animT;
  }

  ESCAPE.Textures = {
    get: get,
    names: function () { return Object.keys(BUILDERS); },
    /** アルファを持つ素材か（世界側が transparent / alphaTest を決める判断材料） */
    hasAlpha: function (name) { return !!ALPHA_TEX[name]; },
    alphaNames: function () { return Object.keys(ALPHA_TEX); },
    /* ---- P5: 動く素材 ---- */
    /** 毎フレーム呼ぶ（world.js）。dt 秒ぶん水面を進める。戻り値は内部時刻(秒) */
    animate: animate,
    /** 動く素材の現在値（機械テスト・監査が読む）: {t,au,av,u1,v1,u2,v2,pulse,moving} */
    animState: function (name) { return animSlot(name || 'waterSewer'); },
    /** 動く素材のキー一覧 */
    animNames: function () { return Object.keys(ANIMATED); },
    /** 動く素材のパラメータ（スクロール速度・明滅） */
    animParams: function (name) { return ANIMATED[name || 'waterSewer']; },
    /** この段階で水面が動くか（fallback/off は false） */
    animLive: animLive,
    /** 強制停止・再開（監査用。製品コードは触らない） */
    setAnimEnabled: function (on) { animEnabled = !!on; },
    /** 時刻を 0 に戻す（world の作り直し・テストの初期化） */
    resetAnim: function () {
      animT = 0;
      for (var k in animState) if (animState.hasOwnProperty(k)) {
        var s = animState[k];
        s.t = s.au = s.av = s.u1 = s.v1 = s.u2 = s.v2 = 0; s.pulse = 1; s.moving = false;
        if (cache[k]) cache[k].offset.set(0, 0);
      }
    },
    /** RQ.waterMaterial が自分の uniform を預ける（animate が毎フレーム書く） */
    bindAnimated: function (name, uniforms) {
      animMats.push({ name: name, u: uniforms });
      return uniforms;
    },
    unbindAnimated: function (uniforms) {
      for (var i = animMats.length - 1; i >= 0; i--) if (animMats[i].u === uniforms) animMats.splice(i, 1);
    },
    /** P4.17 項目1: 壁の血痕の作画数値（機械テストが読む）。垂れの本数と長さ・擦りの長さ */
    wallBloodMetrics: function () {
      return { drips: P4_17_HAND.drips, dripM: P4_17_HAND.dripM, smearM: P4_17_HAND.smearM };
    },
    /** P4.17 項目1: 壁テクスチャの錆だれの本数（機械テストが読む。旧値は P4.16 まで） */
    rustRunCounts: function () { return RUST_RUNS; },
    setAnisotropy: function (n) {
      anisotropy = n;
      for (var k in cache) { cache[k].anisotropy = n; cache[k].needsUpdate = true; }
    },
    /** 監査・テスト用（生成物を破棄して作り直せるように） */
    disposeAll: function () {
      for (var k in cache) cache[k].dispose();
      cache = Object.create(null);
      animMats.length = 0;
      this.resetAnim();
    },
    /**
     * P4.11 項目7 の解像度倍率（既定2＝壁1024x1536・床1024x1024）。
     * これを 1 にすると P4.10 までの解像度（壁512x768・床512x512）に戻る。
     * GPUテクスチャは 27.6MB -> 78.2MB（mipmap込みの推定）に増えているので、
     * 実機(iPhone)でメモリが足りない場合に触るつまみはここ1か所だけ。
     * 変更後は disposeAll() してからワールドを組み直すこと。
     */
    scale: function () { return TEX_S; },
    setScale: function (n) { TEX_S = (n > 0) ? n : 1; },
    /** そのテクスチャの実解像度（機械テスト用） */
    sizeOf: function (name) {
      var im = get(name).image;
      return { w: im.width, h: im.height };
    },
    /**
     * 合計ピクセル数(百万)と GPU 見積り(MB, mipmap込み)。契約の報告値。
     *
     * P5 で素材が2エリアぶんになったので「1セッションで実際に GPU に載る量」を返す。
     * エリアの切替は**ページ再読込**（契約 §4 P5「エリア接続」）なので、
     * エリア1の大面素材とエリア2（下水道）の大面素材が同時に載ることはない。
     * 既定はその**最悪ケース**（共通＋大きい方のエリア）＝ P4.11 で較正した値と同じ。
     *   budget()            … セッションの最悪ケース（world.js の上限テストが読む値）
     *   budget({all:true})  … 全素材の単純合計（両エリアぶん。参考値）
     *   budget({area:'area2'}) … そのエリアのセッションの見積り
     */
    budget: function (opts) {
      opts = opts || {};
      var n = Object.keys(BUILDERS), i, im;
      var sum = { all: 0, common: 0, area1: 0, area2: 0 };
      for (i = 0; i < n.length; i++) {
        im = get(n[i]).image;
        var px = im.width * im.height;
        sum.all += px;
        if (AREA2_TEX[n[i]]) sum.area2 += px;
        else if (AREA1_TEX[n[i]]) sum.area1 += px;
        else sum.common += px;
      }
      var px2 = opts.all ? sum.all
        : (opts.area === 'area1' ? sum.common + sum.area1
          : (opts.area === 'area2' ? sum.common + sum.area2
            : sum.common + Math.max(sum.area1, sum.area2)));
      return {
        mpx: px2 / 1e6, gpuMB: px2 * 4 * 4 / 3 / 1e6,
        allMpx: sum.all / 1e6, allGpuMB: sum.all * 4 * 4 / 3 / 1e6,
        commonMpx: sum.common / 1e6,
        area1Mpx: sum.area1 / 1e6, area2Mpx: sum.area2 / 1e6
      };
    },
    /**
     * 「細部の量」の数値化。隣接ピクセルの輝度差（高周波成分）を面全体で積む。
     *   mean  1ピクセルあたりの平均差。解像度を上げると同じ絵でも下がる
     *   total mean x 総ピクセル数 ＝ **同じ面積に載っている細部の総量**（百万単位）
     * 面のワールド寸法は据え置きなので total がそのまま「1m四方に載る情報量」の比になる。
     * P4.11 項目7 の「質感が一回り上がった」は total で判定する。
     */
    detail: function (name) {
      var im = get(name).image;
      var cx = im.getContext ? im.getContext('2d') : null;
      if (!cx) return { mean: 0, total: 0 };
      var w = im.width, h = im.height;
      var d = cx.getImageData(0, 0, w, h).data, sum = 0, n2 = 0;
      for (var y = 0; y < h; y += 2) {
        for (var x = 1; x < w; x++) {
          var i0 = (y * w + x) * 4, i1 = i0 - 4;
          var l0 = 0.2126 * d[i0] + 0.7152 * d[i0 + 1] + 0.0722 * d[i0 + 2];
          var l1 = 0.2126 * d[i1] + 0.7152 * d[i1 + 1] + 0.0722 * d[i1 + 2];
          sum += Math.abs(l0 - l1); n2++;
        }
      }
      var mean = n2 ? sum / n2 : 0;
      return { mean: mean, total: mean * w * h / 1e6 };
    }
  };
})(window);
