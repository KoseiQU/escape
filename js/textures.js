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

  /** ピクセル単位のざらつき（±amt）。alpha は触らない */
  function grain(ctx, w, h, amt, rand) {
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

  /** 錆だれ: 上端から下へ流れる帯＋粒。錆の輪郭がにじむように2層で描く */
  function rustRun(ctx, x, y, w, len, rand, alpha) {
    var g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(124,68,30,' + (0.42 * alpha) + ')');
    g.addColorStop(0.35, 'rgba(104,56,26,' + (0.30 * alpha) + ')');
    g.addColorStop(1, 'rgba(92,52,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, len);
    /* 縁のにじみ */
    ctx.fillStyle = 'rgba(140,86,40,' + (0.20 * alpha) + ')';
    for (var i = 0; i < len; i += 3) {
      var jitter = (rand() - 0.5) * w * 0.8;
      ctx.fillRect(x + jitter, y + i, w * (0.4 + rand() * 0.5), 3);
    }
    /* 粒 */
    for (var k = 0; k < len * 0.5; k++) {
      ctx.fillStyle = 'rgba(' + (80 + rand() * 70 | 0) + ',' + (40 + rand() * 34 | 0) + ',18,' + (0.25 + rand() * 0.4) * alpha + ')';
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
    var W = 512, H = 768, c = makeCanvas(W, H), ctx = c.getContext('2d');
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

    /* 錆だれ（上の配管から）*/
    for (var s = 0; s < 9; s++) {
      rustRun(ctx, rand() * W, rand() * H * 0.4, 7 + rand() * 16, 120 + rand() * 380, rand, 1);
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
      ctx.fillStyle = 'rgba(96,58,30,' + (0.25 + rand() * 0.4) + ')';
      ctx.fillRect(rand() * W, H - 44 + rand() * 34, 3 + rand() * 20, 2 + rand() * 8);
    }
    speckle(ctx, W, H, 5200, rand, 'rgba(58,56,50,0.30)');
    speckle(ctx, W, H, 2600, rand, 'rgba(186,184,176,0.22)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /* ================================================================ */
  /* 床: リノリウム（2m x 2m / 512 x 512）                              */
  /* ================================================================ */
  function texFloor() {
    var W = 512, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
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
    speckle(ctx, W, H, 6000, rand, 'rgba(46,46,40,0.30)');
    grain(ctx, W, H, 9, rand);
    return c;
  }

  /* ================================================================ */
  /* 天井: システム天井（2m x 2m = 0.5m角パネル 4x4 / 384 x 384）        */
  /* ================================================================ */
  function texCeiling() {
    var W = 384, H = 384, c = makeCanvas(W, H), ctx = c.getContext('2d');
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
    /* 錆だれ（縦） */
    for (var r = 0; r < 14; r++) {
      rustRun(ctx, rand() * W, rand() * H * 0.6, 5 + rand() * 13, 60 + rand() * 190, rand, 1.1);
    }
    /* 錆の点 */
    speckle(ctx, W, H, 2200, rand, 'rgba(112,62,28,0.35)');
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
  function texZoneSign() {
    var S = 256, W = S * 3, H = S * 2, c = makeCanvas(W, H), ctx = c.getContext('2d');
    var rand = rng(24601);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < 6; i++) {
      var ox = (i % 3) * S, oy = ((i / 3) | 0) * S;
      var p = ZONE_PANELS[i];
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

  /* ================================================================ */
  /* P4.9 区画ごとの景観差（DESIGN.md §4「エリア1 新マップ Z4」）            */
  /*   壁: wallPaint（塗装モルタル）/ wallMetal（リベット鋼板）              */
  /*   床: floorTile（白タイル）/ floorWet（湿ったコンクリ）/ floorMetal（縞鋼板） */
  /* ================================================================ */

  /** 壁: 塗装した石膏・モルタル（2m x 3m / 512 x 768）。事務区画・記録区画・拘束区画向け */
  function texWallPaint() {
    var W = 512, H = 768, c = makeCanvas(W, H), ctx = c.getContext('2d');
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
    for (var s2 = 0; s2 < 6; s2++) rustRun(ctx, rand() * W, rand() * H * 0.35, 6 + rand() * 12, 100 + rand() * 340, rand, 0.8);
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
      ctx.fillStyle = 'rgba(102,62,32,' + (0.22 + rand() * 0.38) + ')';
      ctx.fillRect(rand() * W, H - 42 + rand() * 32, 3 + rand() * 18, 2 + rand() * 7);
    }
    speckle(ctx, W, H, 5000, rand, 'rgba(60,58,52,0.28)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /** 壁: リベット留めの鋼板（2m x 3m / 512 x 768）。機械区画向け */
  function texWallMetal() {
    var W = 512, H = 768, c = makeCanvas(W, H), ctx = c.getContext('2d');
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
    /* 塗装の剥げと錆（重力方向に流れる） */
    for (var s = 0; s < 22; s++) rustRun(ctx, rand() * W, rand() * H * 0.6, 6 + rand() * 20, 90 + rand() * 320, rand, 1.15);
    for (var k = 0; k < 40; k++) {
      ctx.fillStyle = 'rgba(' + (98 + rand() * 50 | 0) + ',' + (58 + rand() * 34 | 0) + ',24,' + (0.25 + rand() * 0.45) + ')';
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
    speckle(ctx, W, H, 6800, rand, 'rgba(44,48,52,0.32)');
    speckle(ctx, W, H, 2400, rand, 'rgba(198,206,212,0.18)');
    grain(ctx, W, H, 9, rand);
    return c;
  }

  /** 床: 白タイル（2m x 2m / 512 x 512・0.25m角）。実験区画向け */
  function texFloorTile() {
    var W = 512, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
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
    speckle(ctx, W, H, 6000, rand, 'rgba(44,44,38,0.28)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /** 床: 湿ったコンクリート（2m x 2m / 512 x 512）。検体区画向け */
  function texFloorWet() {
    var W = 512, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
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
    for (var cr = 0; cr < 8; cr++) crack(ctx, rand() * W, rand() * H, 70 + rand() * 180, rand() * 6.28, rand, 0);
    grain(ctx, W, H, 9, rand);
    return c;
  }

  /** 床: 縞鋼板（2m x 2m / 512 x 512）。機械区画向け＝足音が変わる床 */
  function texFloorMetal() {
    var W = 512, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d');
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
    speckle(ctx, W, H, 5200, rand, 'rgba(40,44,48,0.30)');
    grain(ctx, W, H, 8, rand);
    return c;
  }

  /* ================================================================ */

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
    wallPaint: texWallPaint, wallMetal: texWallMetal,
    floorTile: texFloorTile, floorWet: texFloorWet, floorMetal: texFloorMetal
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

  ESCAPE.Textures = {
    get: get,
    names: function () { return Object.keys(BUILDERS); },
    setAnisotropy: function (n) {
      anisotropy = n;
      for (var k in cache) { cache[k].anisotropy = n; cache[k].needsUpdate = true; }
    },
    /** 監査・テスト用（生成物を破棄して作り直せるように） */
    disposeAll: function () {
      for (var k in cache) cache[k].dispose();
      cache = Object.create(null);
    }
  };
})(window);
