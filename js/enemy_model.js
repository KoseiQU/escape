/* ESCAPE — 敵3Dモデル（P3a・DESIGN.md §4「敵デザイン」v4準拠）
 *
 * 方針:
 *  - プリミティブ（回転体・球・帯）とCanvasプロシージャルテクスチャのみ。外部アセット無し。
 *  - 材質は MeshBasicMaterial（map × vertexColors × material.color）。環境と同じ「光を焼く」世界。
 *    立体感は頂点色に焼いた擬似ライト＋AO、明暗は material.color に
 *    「今いるマスの床の明るさ」を毎フレーム乗せる（暗がりで白く浮かない）。
 *    顔だけは下限を高く取り（微発光）、闇の中で顔が浮かぶ＝ステルスの視認性要件を満たす。
 *  - 顔は「絵」ではなく「形」（§4 ゲーム内の顔の実装規範）。頭蓋は彫刻した1枚の殻で、
 *    眼窩は真後ろへ 6cm 彫った空洞、口は頬まで裂けた実開口＋奥行きのある口腔＋
 *    1本ずつ独立ジオメトリの歯。鼻・頬骨・顎・こめかみも実形状。テクスチャが持つのは
 *    皮膚・乾いた血・汚れ・遮蔽の焼きだけで、目や口や歯は一切描かない。
 *  - 2形態は「同一リグの姿勢セット」。直立(0) ←→ 反転(1) を poseT で線形ブレンドするので
 *    形態遷移はブレンド＋落下アークだけで表現できる。
 *
 * 骨組み（ノード名＝ポーズのキー）:
 *   root
 *    └ body(rx) ─ roll(ry) ─ pelvis
 *        ├ hipL/R(rx,ry,rz) ─ kneeL/R ─ ankL/R ─ (足・指)
 *        └ spine ─ chest
 *             ├ neck(rx) ─ headRoll(rz) ─ head(rx,ry,rz) ─ headScale ─ (頭蓋・口腔・歯・髪)
 *             └ shL/R ─ elbL/R ─ wrL/R ─ (手・指)
 *
 * 使い方（デバッグ）: window.__enemyDebug を参照。
 * AI・視界・捕獲は P3b の領分。本ファイルは造形とアニメだけを持つ。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* ---------------- 寸法（DESIGN.md: 直立2.4m） ---------------- */
  var HIP_Y = 1.40;        /* 骨盤の高さ(m) */
  var THIGH = 0.62, SHANK = 0.60, FOOT = 0.30;
  var SPINE = 0.06, CHEST = 0.32, NECK = 0.02, HEAD_OFF = 0.395;
  /* 頭部一式（頭蓋・口腔・歯・髪）の拡大率。遠目でも眼窩と口が読めるようにする。
     胴（CHEST）を詰めて首の分を空けているので全高は 2.4m 台のまま。 */
  var HEAD_K = 1.15;
  var NECK_L = 0.24;       /* 首の実ジオメトリの長さ(m)。上端は顎の下に潜り込む */
  var UPARM = 0.60, FOREARM = 0.58, HAND = 0.19;
  var SHOULDER_W = 0.205, HIP_W = 0.15;

  /* ---------------- 頭部（v4_face準拠の実彫刻） ----------------
   * 頭蓋は「彫刻した1枚の殻」。眼窩と口は実際に面を抜いた開口で、
   * その奥を暗箱メッシュ（socket cup / oral cavity）で塞ぐ。
   * 歯は1本ずつ独立ジオメトリ。顔はテクスチャで描かない（規範§4）。
   */
  var HRX = 0.107, HRY = 0.176, HRZ = 0.126;   /* 基準楕円体の半径 */
  /* 眼窩: [cx, cy, rx, ry, tilt]（左右非対称。+X＝正面から見て画面左） */
  var SOCK = [
    [0.0570, 0.0605, 0.0372, 0.0288, -0.11],
    [-0.0525, 0.0552, 0.0336, 0.0262, 0.13]
  ];
  var SOCK_DEEP = 0.060;                        /* 眼窩の彫り深さ(m) */
  var MOUTH_W = 0.0800;                         /* 口の半幅（頬まで） */
  var MOUTH_Y = -0.0865, MOUTH_LIFT = 0.0460;   /* 中央の高さ／口角の吊り上がり */
  var MOUTH_H = 0.0205;                         /* 中央の開口半径（上下） */
  var NOSE_Y = -0.0235;

  /* 明度の下限/上限（環境サンプルに掛ける係数の写像）
   * v4_face の実測トーン（頭部の中央値17・p90=47・最大122）に寄せるため、
   * 顔は下限を保ちつつ上限を強く抑える（明所で石膏の白にしない）。 */
  var BODY_MIN = 0.085, BODY_GAIN = 2.10, BODY_MAX = 0.95;
  var FACE_MIN = 0.420, FACE_GAIN = 1.10, FACE_MAX = 0.80;
  var TOOTH_MIN = 0.160, TOOTH_GAIN = 0.95, TOOTH_MAX = 0.55;
  /* P4.6: 捕獲演出中だけの顔の底上げ。画面いっぱいに迫る顔が闇に沈んでは演出にならない。
     通常の巡回・追跡では使わない（＝暗がりでの見え方は P3a のまま） */
  var FACE_MIN_CINE = 0.640, FACE_MAX_CINE = 0.94;
  var TOOTH_MIN_CINE = 0.330, TOOTH_MAX_CINE = 0.72;
  var VOID_MIN = 0.030, VOID_GAIN = 0.22, VOID_MAX = 0.115;
  var CLOTH_MIN = 0.075, CLOTH_GAIN = 1.90;
  var HAIR_MIN = 0.050, HAIR_GAIN = 1.10, HAIR_MAX = 0.62;

  /* ---------------- 乱数（決定的） ---------------- */
  function rngOf(seed) {
    var s = (seed | 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  /* ================================================================
   * 頭部サーフェスの共有ヘルパ
   *  - headBase(theta,phi): 特徴を彫る前の基準面（卵形）
   *  - headUV(x,y): 顔の目標位置(x,y)が来るテクスチャのUV（描画位置合わせ用）
   *  - mouthMid/mouthHalf: 口の開口カーブ（殻・口腔・歯で同じ式を使う）
   * theta: 0=頭頂 π=顎先 / phi: 0=正面(-Z) ±π=後頭部（UVの継ぎ目）
   * ============================================================== */
  function headKX(ny) {
    return 1 - 0.11 * Math.pow(Math.max(0, ny), 2.2) - 0.46 * Math.pow(Math.max(0, -ny), 1.35);
  }
  function headKZ(ny, nz) {
    var k = 1 - 0.05 * Math.pow(Math.max(0, ny), 2.0) - 0.30 * Math.pow(Math.max(0, -ny), 1.4);
    if (nz > 0) k *= 1 + 0.11 * nz * nz;          /* 後頭部の張り出し */
    else k *= 1 - 0.11 * nz * nz;                 /* 顔面は平たい */
    return k;
  }
  function headBase(theta, phi, out) {
    var ny = Math.cos(theta), s = Math.sin(theta);
    var nx = s * Math.sin(phi), nz = -s * Math.cos(phi);
    out[0] = nx * HRX * headKX(ny);
    out[1] = ny * HRY;
    out[2] = nz * HRZ * headKZ(ny, nz);
    return out;
  }
  /** 顔の(x,y)→(u,v)。テクスチャに血や汚れを「その位置」に描くための逆写像 */
  function headUV(x, y) {
    var ny = clamp(y / HRY, -0.9995, 0.9995);
    var th = Math.acos(ny), s = Math.sin(th);
    var den = s * HRX * headKX(ny);
    var sp = den > 1e-6 ? clamp(x / den, -1, 1) : 0;
    return [0.5 + Math.asin(sp) / (Math.PI * 2), th / Math.PI];
  }
  function mouthT(x) { return clamp(Math.abs(x) / MOUTH_W, 0, 1); }
  function mouthMid(x) { return MOUTH_Y + MOUTH_LIFT * Math.pow(mouthT(x), 1.42); }
  function mouthHalf(x) {
    var t = mouthT(x);
    return MOUTH_H * Math.pow(Math.max(0, 1 - Math.pow(t, 1.7)), 0.70);
  }

  /* ================================================================
   * Canvas テクスチャ
   * ============================================================== */
  var texCache = Object.create(null);

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function toTex(c, rep) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /** 蒼白い人肌。筋・腱の streak、血管、しみ、乾いた皺 */
  function texSkin() {
    var W = 512, H = 512, c = canvasOf(W, H), x = c.getContext('2d');
    var rand = rngOf(7717);
    /* 蒼白い「人肌」＝灰緑がかったくすみ。石膏白にならないよう明度を落とす */
    x.fillStyle = '#8e8f80'; x.fillRect(0, 0, W, H);
    /* ムラ（灰緑・土気色・鬱血の紫）。色差をはっきり付けないと石膏に見える */
    for (var i = 0; i < 520; i++) {
      var r = 10 + rand() * 66;
      var cx = rand() * W, cy = rand() * H;
      var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      var tint = rand();
      var col = tint < 0.28 ? '84,96,76'              /* 灰緑の死斑 */
        : (tint < 0.50 ? '170,166,144'                /* 明るい張り */
          : (tint < 0.70 ? '116,102,82'               /* 土気色 */
            : (tint < 0.86 ? '90,72,86' : '62,72,64'))); /* 鬱血・くすみ */
      var pa2 = 0.08 + rand() * 0.15;
      g.addColorStop(0, 'rgba(' + col + ',' + pa2.toFixed(3) + ')');
      g.addColorStop(0.45, 'rgba(' + col + ',' + (pa2 * 0.62).toFixed(3) + ')');
      g.addColorStop(0.78, 'rgba(' + col + ',' + (pa2 * 0.22).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    /* 汚れの筋（重力方向＝下向きに流れる垢と乾いた体液） */
    for (var gr = 0; gr < 90; gr++) {
      var gx = rand() * W, gy = rand() * H, gl = 30 + rand() * 160;
      var gg = x.createLinearGradient(gx, gy, gx, gy + gl);
      var gc = rand() < 0.35 ? '60,46,36' : '72,70,58';
      gg.addColorStop(0, 'rgba(' + gc + ',0)');
      gg.addColorStop(0.4, 'rgba(' + gc + ',' + (0.06 + rand() * 0.10).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(' + gc + ',0)');
      x.strokeStyle = gg; x.lineWidth = 1.6 + rand() * 5;
      x.beginPath(); x.moveTo(gx, gy);
      x.quadraticCurveTo(gx + (rand() - 0.5) * 8, gy + gl * 0.5, gx + (rand() - 0.5) * 14, gy + gl);
      x.stroke();
    }
    /* 血管（青緑） */
    x.lineCap = 'round';
    for (var v = 0; v < 80; v++) {
      var px = rand() * W, py = rand() * H, a = rand() * Math.PI * 2;
      var w0 = 0.9 + rand() * 2.2;
      x.strokeStyle = 'rgba(' + (48 + rand() * 26 | 0) + ',' + (64 + rand() * 22 | 0) + ',' + (72 + rand() * 28 | 0) + ',' + (0.15 + rand() * 0.24).toFixed(3) + ')';
      x.lineWidth = w0;
      x.beginPath(); x.moveTo(px, py);
      for (var s = 0; s < 7; s++) {
        a += (rand() - 0.5) * 0.9;
        px += Math.cos(a) * (7 + rand() * 16); py += Math.sin(a) * (7 + rand() * 16);
        x.lineTo(px, py);
      }
      x.stroke();
      /* 枝 */
      if (rand() < 0.5) {
        x.lineWidth = w0 * 0.6;
        x.beginPath(); x.moveTo(px, py);
        for (var s2 = 0; s2 < 3; s2++) {
          a += (rand() - 0.5) * 1.4;
          px += Math.cos(a) * 9; py += Math.sin(a) * 9; x.lineTo(px, py);
        }
        x.stroke();
      }
    }
    /* 筋・腱の縦streak（線を長手方向にすると腕脚で腱に見える） */
    for (var t2 = 0; t2 < 190; t2++) {
      var tx = rand() * W, ty = rand() * H, len = 20 + rand() * 90;
      x.strokeStyle = 'rgba(' + (rand() < 0.45 ? '196,192,178' : '104,104,94') + ',' + (0.07 + rand() * 0.13).toFixed(3) + ')';
      x.lineWidth = 0.8 + rand() * 2.2;
      x.beginPath(); x.moveTo(tx, ty);
      x.quadraticCurveTo(tx + (rand() - 0.5) * 12, ty + len * 0.5, tx + (rand() - 0.5) * 16, ty + len);
      x.stroke();
    }
    /* 皺（短い線の群れ）と毛穴 */
    for (var k = 0; k < 1600; k++) {
      var kx = rand() * W, ky = rand() * H, kl = 2 + rand() * 8, ka = rand() * Math.PI;
      x.strokeStyle = 'rgba(' + (rand() < 0.75 ? '70,66,56' : '176,172,156') + ',' + (0.06 + rand() * 0.16).toFixed(3) + ')';
      x.lineWidth = 0.8 + rand() * 1.1;
      x.beginPath();
      x.moveTo(kx, ky); x.lineTo(kx + Math.cos(ka) * kl, ky + Math.sin(ka) * kl);
      x.stroke();
    }
    for (var po = 0; po < 1400; po++) {
      x.fillStyle = 'rgba(70,66,56,' + (0.05 + rand() * 0.16).toFixed(3) + ')';
      x.beginPath(); x.arc(rand() * W, rand() * H, 0.7 + rand() * 1.5, 0, 6.2832); x.fill();
    }
    /* 汚れ・乾いた血の粒 */
    for (var d = 0; d < 420; d++) {
      x.fillStyle = 'rgba(' + (rand() < 0.3 ? '78,24,18' : '68,62,50') + ',' + (0.06 + rand() * 0.24).toFixed(3) + ')';
      x.beginPath(); x.arc(rand() * W, rand() * H, 0.6 + rand() * 3.8, 0, 6.2832); x.fill();
    }
    /* 湿った照りは点で少しだけ（面で白くしない） */
    for (var wt = 0; wt < 120; wt++) {
      x.fillStyle = 'rgba(214,214,202,' + (0.05 + rand() * 0.11).toFixed(3) + ')';
      x.beginPath(); x.arc(rand() * W, rand() * H, 0.8 + rand() * 2.2, 0, 6.2832); x.fill();
    }
    return c;
  }

  /**
   * 頭部の皮膚テクスチャ（v4_face準拠）。頭を一周する球面UVに貼る。
   * 顔の造形——眼窩・口腔・歯・鼻・頬骨——はすべてジオメトリ側で彫る（規範§4）。
   * ここが持つのは皮膚の質感・乾いた血・汚れ・造形に沿った遮蔽の焼きだけで、
   * 目や口や歯は一切「描かない」。位置合わせは headUV() で実座標から逆写像する。
   */
  function texHead() {
    var W = 1024, H = 1024, c = canvasOf(W, H), x = c.getContext('2d');
    var rand = rngOf(90917);
    var i, g, cx, cy, r;
    /** 頭部ローカル座標(m) → キャンバス座標(px) */
    function P(mx, my) { var uv = headUV(mx, my); return [uv[0] * W, uv[1] * H]; }

    /* --- 下地: 蒼白いが「石膏白」ではない灰緑の死肌 --- */
    x.fillStyle = '#7a7c6e'; x.fillRect(0, 0, W, H);

    /* 大きなムラ（死斑・鬱血・土気色）。色差をはっきり付けないと樹脂に見える */
    for (i = 0; i < 460; i++) {
      cx = rand() * W; cy = rand() * H; r = 20 + rand() * 118;
      g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      var t0 = rand();
      var col = t0 < 0.30 ? '58,70,54'
        : (t0 < 0.52 ? '134,132,114'
          : (t0 < 0.72 ? '86,74,58'
            : (t0 < 0.88 ? '70,56,68' : '44,52,46')));
      var pa = 0.07 + rand() * 0.16;
      g.addColorStop(0, 'rgba(' + col + ',' + pa.toFixed(3) + ')');
      g.addColorStop(0.46, 'rgba(' + col + ',' + (pa * 0.60).toFixed(3) + ')');
      g.addColorStop(0.80, 'rgba(' + col + ',' + (pa * 0.20).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    /* しみ・色素沈着 */
    for (i = 0; i < 1700; i++) {
      var sp = rand();
      x.fillStyle = 'rgba(' + (sp < 0.55 ? '52,50,40' : (sp < 0.84 ? '86,80,64' : '44,36,34')) + ','
        + (0.05 + rand() * 0.20).toFixed(3) + ')';
      x.beginPath(); x.arc(rand() * W, rand() * H, 1.0 + rand() * 4.4, 0, 6.2832); x.fill();
    }
    /* 皮下に浮いた血管（青緑・薄く） */
    x.lineCap = 'round';
    for (i = 0; i < 120; i++) {
      var vx = rand() * W, vy = 80 + rand() * (H - 200), va = rand() * Math.PI * 2;
      x.strokeStyle = 'rgba(' + (40 + rand() * 20 | 0) + ',' + (54 + rand() * 18 | 0) + ',' + (60 + rand() * 22 | 0) + ',' + (0.10 + rand() * 0.20).toFixed(3) + ')';
      x.lineWidth = 1.0 + rand() * 2.4;
      x.beginPath(); x.moveTo(vx, vy);
      for (var s = 0; s < 6; s++) {
        va += (rand() - 0.5) * 1.1;
        vx += Math.cos(va) * (10 + rand() * 22); vy += Math.sin(va) * (10 + rand() * 22);
        x.lineTo(vx, vy);
      }
      x.stroke();
    }
    /* 皺と毛穴 */
    for (i = 0; i < 3000; i++) {
      var wx = rand() * W, wy = rand() * H, wl = 3 + rand() * 12, wa = rand() * Math.PI;
      x.strokeStyle = 'rgba(' + (rand() < 0.78 ? '44,42,34' : '138,134,118') + ',' + (0.05 + rand() * 0.15).toFixed(3) + ')';
      x.lineWidth = 0.9 + rand() * 1.2;
      x.beginPath(); x.moveTo(wx, wy); x.lineTo(wx + Math.cos(wa) * wl, wy + Math.sin(wa) * wl); x.stroke();
    }
    for (i = 0; i < 2400; i++) {
      x.fillStyle = 'rgba(40,38,32,' + (0.05 + rand() * 0.15).toFixed(3) + ')';
      x.beginPath(); x.arc(rand() * W, rand() * H, 0.7 + rand() * 1.6, 0, 6.2832); x.fill();
    }
    /* 垢の流れ（重力方向） */
    for (i = 0; i < 70; i++) {
      var dx0 = rand() * W, dy0 = 100 + rand() * 760, dl = 50 + rand() * 220;
      var dg = x.createLinearGradient(dx0, dy0, dx0, dy0 + dl);
      var dc = rand() < 0.4 ? '38,30,24' : '48,48,40';
      dg.addColorStop(0, 'rgba(' + dc + ',0)');
      dg.addColorStop(0.42, 'rgba(' + dc + ',' + (0.06 + rand() * 0.10).toFixed(3) + ')');
      dg.addColorStop(1, 'rgba(' + dc + ',0)');
      x.strokeStyle = dg; x.lineWidth = 2 + rand() * 7;
      x.beginPath(); x.moveTo(dx0, dy0);
      x.quadraticCurveTo(dx0 + (rand() - 0.5) * 12, dy0 + dl * 0.5, dx0 + (rand() - 0.5) * 20, dy0 + dl);
      x.stroke();
    }

    /* --- 骨の稜線だけを僅かに起こす（明部は稜線のみ・面では光らせない） --- */
    function ridge(mx, my, rw, rh, rot, alpha) {
      var p = P(mx, my);
      x.save(); x.translate(p[0], p[1]); x.rotate(rot); x.scale(rw, rh);
      var gg = x.createRadialGradient(0, 0, 0, 0, 0, 1);
      gg.addColorStop(0, 'rgba(206,204,184,' + alpha + ')');
      gg.addColorStop(0.55, 'rgba(190,188,170,' + (alpha * 0.44).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(190,188,170,0)');
      x.fillStyle = gg; x.beginPath(); x.arc(0, 0, 1, 0, 6.2832); x.fill(); x.restore();
    }
    ridge(0.052, 0.100, 70, 26, -0.20, 0.24);      /* 眉庇（左） */
    ridge(-0.048, 0.094, 64, 24, 0.18, 0.21);      /* 眉庇（右） */
    ridge(0.076, 0.010, 62, 42, -0.30, 0.34);      /* 頬骨（左） */
    ridge(-0.071, 0.004, 58, 40, 0.28, 0.30);      /* 頬骨（右） */
    ridge(0.000, 0.012, 30, 70, 0, 0.30);          /* 鼻梁 */
    ridge(0.000, -0.056, 96, 30, 0, 0.26);         /* 上唇の上（v4で最も明るい面） */
    ridge(0.004, -0.138, 56, 30, 0, 0.16);         /* 顎 */

    /* --- 造形に沿った遮蔽（凹み方向を考慮した焼き） --- */
    function occ(mx, my, rw, rh, rot, alpha, tone) {
      var p = P(mx, my);
      x.save(); x.translate(p[0], p[1]); x.rotate(rot); x.scale(rw, rh);
      var gs = x.createRadialGradient(0, 0, 0, 0, 0, 1);
      gs.addColorStop(0, 'rgba(' + tone + ',' + alpha + ')');
      gs.addColorStop(0.52, 'rgba(' + tone + ',' + (alpha * 0.56).toFixed(3) + ')');
      gs.addColorStop(1, 'rgba(' + tone + ',0)');
      x.fillStyle = gs; x.beginPath(); x.arc(0, 0, 1, 0, 6.2832); x.fill(); x.restore();
    }
    var sk;
    for (i = 0; i < 2; i++) {
      sk = SOCK[i];
      /* 眼窩まわり: 上（眉庇の落ちる影）と下（涙堂の窪み）を濃く */
      /* 空洞の内側そのもの。造形の窪みと合わせて「覗くと闇」にする */
      occ(sk[0], sk[1], 104, 84, sk[4], 1.00, '3,3,4');
      occ(sk[0], sk[1], 150, 120, sk[4], 0.86, '6,7,7');
      occ(sk[0], sk[1] - sk[3] * 1.25, 96, 42, sk[4], 0.52, '14,16,16');
      occ(sk[0] + (i ? -0.020 : 0.020), sk[1] + sk[3] * 1.15, 78, 34, sk[4], 0.40, '12,14,14');
    }
    occ(0.098, 0.086, 96, 150, 0, 0.62, '10,12,12');    /* こめかみの落ち込み（左） */
    occ(-0.094, 0.080, 92, 146, 0, 0.60, '10,12,12');   /* 同（右） */
    occ(0.066, -0.046, 84, 74, 0, 0.46, '14,16,16');    /* 頬のこけ（左） */
    occ(-0.062, -0.042, 80, 70, 0, 0.44, '14,16,16');
    occ(0.000, NOSE_Y + 0.004, 46, 44, 0, 0.55, '10,11,11'); /* 鼻の欠損まわり */
    occ(0.000, MOUTH_Y - 0.004, 250, 66, 0, 0.50, '10,11,11'); /* 口のまわり */
    occ(0.072, -0.066, 76, 46, -0.5, 0.44, '12,13,13');  /* 口角の裂け（左） */
    occ(-0.068, -0.062, 72, 44, 0.5, 0.42, '12,13,13');
    occ(0.000, -0.172, 260, 90, 0, 0.62, '8,9,9');       /* 顎の下 */
    occ(0.000, -0.132, 210, 62, 0, 0.44, '10,11,11');    /* 口の下（顎の前面） */
    occ(0.000, 0.140, 300, 118, 0, 0.60, '9,10,10');     /* 額（v4は額が暗い） */
    occ(0.000, 0.176, 320, 96, 0, 0.68, '8,9,9');        /* 生え際の影 */

    /* --- 乾いた黒赤の血（眼窩の下縁→頬→顎）。彩度を落とし細い流路にする --- */
    function bloodRun(sx, sy, len, w0, seed, alpha) {
      var rr = rngOf(seed);
      var px = sx, py = sy, ww = w0, steps = 30;
      x.lineCap = 'round';
      for (var k = 0; k < steps; k++) {
        var qx = px + (rr() - 0.5) * 0.0016;
        var qy = py - len / steps;
        ww *= 0.970 + rr() * 0.028;
        var a = P(px, py), b = P(qx, qy);
        var cr = 32 + rr() * 34, cg = 10 + rr() * 12, cb = 8 + rr() * 10;
        x.strokeStyle = 'rgba(' + (cr | 0) + ',' + (cg | 0) + ',' + (cb | 0) + ','
          + (alpha * (1 - k / steps * 0.42)).toFixed(3) + ')';
        x.lineWidth = ww;
        x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
        /* 乾いて縁が黒くなる（テカらせない） */
        if (rr() < 0.30) {
          x.strokeStyle = 'rgba(22,9,8,' + (alpha * 0.5).toFixed(3) + ')';
          x.lineWidth = ww * 0.42;
          x.beginPath(); x.moveTo(a[0] + ww * 0.4, a[1]); x.lineTo(b[0] + ww * 0.4, b[1]); x.stroke();
        }
        px = qx; py = qy;
      }
    }
    var bseed = 11;
    for (i = 0; i < 2; i++) {
      sk = SOCK[i];
      var nrun = i ? 3 : 4;
      for (var b2 = 0; b2 < nrun; b2++) {
        var bx = sk[0] + (b2 / (nrun - 1) - 0.5) * sk[2] * 1.30;
        var by = sk[1] - sk[3] * (1.06 + rand() * 0.22);
        bloodRun(bx, by, 0.038 + rand() * 0.056, 1.7 + rand() * 1.9, bseed, 0.50 + rand() * 0.26);
        bseed += 37;
      }
    }
    /* 口角と顎からの垂れ */
    bloodRun(0.0470, 0.0330, 0.128, 2.0, 371, 0.50);
    bloodRun(-0.0430, 0.0270, 0.118, 1.8, 383, 0.46);
    bloodRun(0.070, -0.064, 0.075, 2.0, 401, 0.52);
    bloodRun(-0.066, -0.060, 0.062, 1.8, 419, 0.48);
    bloodRun(0.018, -0.128, 0.048, 2.2, 433, 0.54);
    bloodRun(-0.014, -0.126, 0.042, 1.9, 447, 0.50);
    /* 乾いた古血の澱み（斑にして塗りベタ感を消す） */
    for (i = 0; i < 46; i++) {
      var ox = (rand() - 0.5) * 0.19, oy = 0.06 - rand() * 0.20;
      var p2 = P(ox, oy);
      x.fillStyle = 'rgba(' + (30 + rand() * 26 | 0) + ',' + (10 + rand() * 10 | 0) + ',' + (8 + rand() * 8 | 0) + ','
        + (0.06 + rand() * 0.16).toFixed(3) + ')';
      x.beginPath(); x.ellipse(p2[0], p2[1], 2 + rand() * 9, 4 + rand() * 18, (rand() - 0.5) * 0.6, 0, 6.2832); x.fill();
    }

    /* --- 側面〜後頭部を落とす（顔だけが闇から浮く） --- */
    var side = x.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0.00, 'rgba(5,6,6,0.96)');
    side.addColorStop(0.24, 'rgba(5,6,6,0.86)');
    side.addColorStop(0.34, 'rgba(5,6,6,0.34)');
    side.addColorStop(0.42, 'rgba(5,6,6,0)');
    side.addColorStop(0.58, 'rgba(5,6,6,0)');
    side.addColorStop(0.66, 'rgba(5,6,6,0.34)');
    side.addColorStop(0.76, 'rgba(5,6,6,0.86)');
    side.addColorStop(1.00, 'rgba(5,6,6,0.96)');
    x.fillStyle = side; x.fillRect(0, 0, W, H);
    /* 生え際から上（頭皮）は髪に覆われる前提で暗く */
    var top = x.createLinearGradient(0, 0, 0, H);
    top.addColorStop(0.00, 'rgba(7,8,9,0.90)');
    top.addColorStop(0.17, 'rgba(7,8,9,0.62)');
    top.addColorStop(0.26, 'rgba(7,8,9,0)');
    top.addColorStop(0.93, 'rgba(7,8,9,0)');
    top.addColorStop(1.00, 'rgba(7,8,9,0.70)');
    x.fillStyle = top; x.fillRect(0, 0, W, H);
    /* 最後にくすみを一枚（清潔感を消す） */
    x.fillStyle = 'rgba(52,56,48,0.10)'; x.fillRect(0, 0, W, H);
    return c;
  }

  /** 拘束衣のボロ布 */
  function texCloth() {
    var W = 256, H = 256, c = canvasOf(W, H), x = c.getContext('2d');
    var rand = rngOf(31337);
    x.fillStyle = '#8d8d7c'; x.fillRect(0, 0, W, H);
    /* 織り目 */
    for (var i = 0; i < W; i += 2) {
      x.fillStyle = 'rgba(60,60,52,' + (0.05 + (i % 4 === 0 ? 0.05 : 0)) + ')';
      x.fillRect(i, 0, 1, H);
      x.fillRect(0, i, W, 1);
    }
    /* 汚れ・染み */
    for (var s = 0; s < 90; s++) {
      var cx = rand() * W, cy = rand() * H, r = 8 + rand() * 60;
      var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      var t = rand();
      var col = t < 0.24 ? '58,20,16' : (t < 0.6 ? '74,70,56' : '46,48,42');
      g.addColorStop(0, 'rgba(' + col + ',' + (0.14 + rand() * 0.3).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    /* 縫い目 */
    for (var q = 0; q < 6; q++) {
      var yy = rand() * H;
      x.strokeStyle = 'rgba(50,48,40,0.5)'; x.lineWidth = 1.4;
      x.setLineDash([4, 5]);
      x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy + (rand() - 0.5) * 10); x.stroke();
      x.setLineDash([]);
    }
    /* ほつれ */
    for (var f = 0; f < 200; f++) {
      x.strokeStyle = 'rgba(' + (rand() < 0.5 ? '160,158,142' : '58,56,48') + ',' + (0.1 + rand() * 0.2).toFixed(3) + ')';
      x.lineWidth = 0.7;
      var fx = rand() * W, fy = rand() * H, fl = 3 + rand() * 14, fa = rand() * Math.PI;
      x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx + Math.cos(fa) * fl, fy + Math.sin(fa) * fl); x.stroke();
    }
    return c;
  }

  /**
   * P4.6: 捕獲演出専用の高解像度頭部テクスチャ（2048）。
   * 1024版を土台に「2048でしか読めない細部」だけを原寸で重ねる
   * ＝ 1024を引き伸ばしただけの絵にはならない（毛穴・産毛・毛細血管・濡れの照り）。
   * 生成コストがあるので最初の捕獲まで作らない（tex('headHi') は遅延評価）。
   */
  function texHeadHi() {
    var S = 2048, c = canvasOf(S, S), x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.drawImage(texHead(), 0, 0, S, S);
    var rand = rngOf(50231);
    var i, cx, cy;

    /* 毛穴（1px の点。至近距離で皮膚が「樹脂」に見えないための粒） */
    for (i = 0; i < 13000; i++) {
      cx = rand() * S; cy = rand() * S;
      var dk = 0.10 + rand() * 0.22;
      x.fillStyle = 'rgba(28,30,24,' + dk.toFixed(3) + ')';
      x.fillRect(cx | 0, cy | 0, 1 + (rand() < 0.18 ? 1 : 0), 1);
    }
    /* 産毛・細い皺（短い線） */
    x.lineWidth = 1;
    for (i = 0; i < 4200; i++) {
      cx = rand() * S; cy = rand() * S;
      var a = rand() * Math.PI, L = 3 + rand() * 11;
      x.strokeStyle = (rand() < 0.5 ? 'rgba(24,26,22,' : 'rgba(168,166,150,') + (0.05 + rand() * 0.13).toFixed(3) + ')';
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); x.stroke();
    }
    /* 毛細血管（枝分かれ） */
    for (i = 0; i < 240; i++) {
      cx = rand() * S; cy = rand() * S;
      var an = rand() * Math.PI * 2;
      x.strokeStyle = 'rgba(' + (rand() < 0.5 ? '104,34,32' : '68,26,44') + ',' + (0.10 + rand() * 0.18).toFixed(3) + ')';
      x.lineWidth = 0.8 + rand() * 0.9;
      x.beginPath(); x.moveTo(cx, cy);
      var px2 = cx, py2 = cy;
      for (var k = 0; k < 5; k++) {
        an += (rand() - 0.5) * 1.1;
        px2 += Math.cos(an) * (5 + rand() * 12); py2 += Math.sin(an) * (5 + rand() * 12);
        x.lineTo(px2, py2);
      }
      x.stroke();
    }
    /* 濡れた照り（薄い明るい斑。湿った皮膚＝契約 §4「湿った皮膚の質感」） */
    for (i = 0; i < 320; i++) {
      cx = rand() * S; cy = rand() * S;
      var r2 = 4 + rand() * 26;
      var g2 = x.createRadialGradient(cx, cy, 0, cx, cy, r2);
      g2.addColorStop(0, 'rgba(214,216,200,' + (0.05 + rand() * 0.10).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(214,216,200,0)');
      x.fillStyle = g2; x.fillRect(cx - r2, cy - r2, r2 * 2, r2 * 2);
    }
    /* 乾いた血の粒（眼窩から頬へ流れる帯の上に散らす） */
    for (i = 0; i < 900; i++) {
      cx = S * (0.30 + rand() * 0.40); cy = S * (0.30 + rand() * 0.42);
      x.fillStyle = 'rgba(' + (rand() < 0.6 ? '72,14,12' : '44,10,12') + ',' + (0.08 + rand() * 0.26).toFixed(3) + ')';
      x.fillRect(cx | 0, cy | 0, 1 + (rand() < 0.3 ? 1 : 0), 1 + (rand() < 0.5 ? 1 : 0));
    }
    return c;
  }

  function tex(name) {
    if (texCache[name]) return texCache[name];
    var t;
    if (name === 'skin') t = toTex(texSkin(), true);
    else if (name === 'head') t = toTex(texHead(), false);
    else if (name === 'headHi') t = toTex(texHeadHi(), false);
    else if (name === 'cloth') t = toTex(texCloth(), true);
    else throw new Error('unknown enemy texture: ' + name);
    texCache[name] = t;
    return t;
  }

  /* ================================================================
   * ジオメトリ
   * ============================================================== */

  /** 回転体。y=0 から -len へ伸びる（＝関節にぶら下がる向き）。open=true で蓋なし */
  function revolve(len, radSeg, hSeg, profile, uRep, vRep, open) {
    var pos = [], uv = [], idx = [];
    var i, j;
    for (j = 0; j <= hSeg; j++) {
      var t = j / hSeg;
      var p = profile(t);
      var r = p.r, sx = p.sx === undefined ? 1 : p.sx, sz = p.sz === undefined ? 1 : p.sz;
      var ox = p.ox || 0, oz = p.oz || 0;
      for (i = 0; i <= radSeg; i++) {
        var a = i / radSeg * Math.PI * 2;
        pos.push(Math.cos(a) * r * sx + ox, -t * len, Math.sin(a) * r * sz + oz);
        uv.push(i / radSeg * (uRep || 1), t * (vRep || 1));
      }
    }
    var stride = radSeg + 1;
    for (j = 0; j < hSeg; j++) {
      for (i = 0; i < radSeg; i++) {
        var a0 = j * stride + i, b0 = a0 + 1, c0 = a0 + stride, d0 = c0 + 1;
        idx.push(a0, c0, b0, b0, c0, d0);
      }
    }
    /* 両端の蓋（先細りでも隙間が見えないように） */
    function cap(j0, flip) {
      var base = pos.length / 3;
      var t0 = j0 / hSeg, p0 = profile(t0);
      pos.push(p0.ox || 0, -t0 * len, p0.oz || 0);
      uv.push(0.5, t0 * (vRep || 1));
      for (i = 0; i < radSeg; i++) {
        var s0 = j0 * stride + i, s1 = s0 + 1;
        if (flip) idx.push(base, s1, s0); else idx.push(base, s0, s1);
      }
    }
    if (!open) { cap(0, true); cap(hSeg, false); }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** 単純な先細り四肢（両端半径と中間の膨らみ） */
  function limbGeo(len, rTop, rMid, rBot, radSeg, flatX, bow) {
    return revolve(len, radSeg || 8, 6, function (t) {
      var r;
      if (t < 0.5) r = rTop + (rMid - rTop) * (t / 0.5);
      else r = rMid + (rBot - rMid) * ((t - 0.5) / 0.5);
      /* 腱の起伏（僅かな凹凸） */
      r *= 1 + 0.055 * Math.sin(t * 11.0) + 0.03 * Math.sin(t * 23.0 + 1.3);
      return { r: r, sx: flatX || 1, sz: 1, oz: (bow || 0) * Math.sin(t * Math.PI) };
    }, 1, 1.6);
  }

  function sphereGeo(r, wSeg, hSeg) {
    return new THREE.SphereGeometry(r, wSeg || 8, hSeg || 6);
  }

  /* ---------------- 有機的な低周波うねり ----------------
   * 頭蓋と顔殻は「方向ベクトルの関数」として同じうねりを掛ける。
   * こうすると2つの殻が同心のままズレず、かつ球の面取り感が消える。
   * 生き物の頭は左右非対称なので、x に非対称項を混ぜる（契約§4「輪郭は左右非対称で有機的」）。
   */
  function headLump(nx, ny, nz) {
    var v =
      0.42 * Math.sin(nx * 2.9 + 0.7) * Math.cos(ny * 2.3 - 1.1) +
      0.26 * Math.sin(ny * 4.1 + 2.2) * Math.cos(nz * 3.3 + 0.4) +
      0.18 * Math.sin(nz * 5.3 - 0.9) * Math.cos(nx * 4.7 + 1.8) +
      0.14 * Math.sin((nx + ny + nz) * 6.1 + 3.3);
    /* 左右非対称: 片側だけ僅かに張らせ、こめかみを凹ませる */
    v += 0.30 * nx + 0.22 * Math.sin(nx * 1.7 + 1.2) * Math.abs(ny);
    v -= 0.34 * Math.exp(-((Math.abs(nx) - 0.86) * (Math.abs(nx) - 0.86)) / 0.02) * (ny > 0 ? ny : 0);
    return v;
  }

  /* ================================================================
   * 頭部の彫刻（P3a差し戻し2回目・DESIGN.md §4「ゲーム内の顔の実装規範」）
   *
   * 顔は絵ではなく形。頭蓋は1枚の殻として彫り、
   *   - 眼窩は面を抜いた開口＋奥へ伸びる暗箱（socket cup）
   *   - 口は頬まで裂けた開口＋奥行きのある口腔（oral cavity）＋1本ずつの歯
   *   - 鼻・頬骨・顎・こめかみは実形状の起伏
   * とし、凹み方向を考慮した遮蔽（occ）を頂点色に焼く。
   * ============================================================== */

  /** 頭部表面の特徴（変位・遮蔽・開口）。base は基準面の座標 */
  function headFeatures(bx, by, bz, nx, ny, nz, out) {
    var X = bx, Y = by;
    var fr = -nz;                                    /* 正面度 */
    var gF = smooth01((fr - 0.02) / 0.42);
    var gS = smooth01((fr + 0.42) / 0.80);
    var d = 0, dz = 0, oc = 1, hole = 0, i, s, e, ex, ey, ca, sa, dx, dy;

    /* 有機的な低周波うねり（左右非対称の輪郭） */
    d += headLump(nx, ny, nz) * 0.0105;

    /* 眉庇（眼窩の上に張り出す骨） */
    var brow = Math.exp(-Math.pow((Y - 0.0955) / 0.0215, 2))
      * Math.exp(-Math.pow(X / 0.0640, 4));
    d += 0.0072 * brow * gF;

    /* こめかみの落ち込み */
    var tem = Math.exp(-Math.pow((Math.abs(X) - 0.0920) / 0.0260, 2))
      * Math.exp(-Math.pow((Y - 0.0740) / 0.0560, 2));
    d -= 0.0132 * tem * gS;
    oc *= 1 - 0.44 * tem * gS;

    /* 眼窩: 縁の骨が隆起し、内側は深い漏斗。中心は面を抜く */
    for (i = 0; i < 2; i++) {
      s = SOCK[i];
      ca = Math.cos(s[4]); sa = Math.sin(s[4]);
      dx = X - s[0]; dy = Y - s[1];
      ex = (dx * ca + dy * sa) / s[2]; ey = (-dx * sa + dy * ca) / s[3];
      e = Math.sqrt(ex * ex + ey * ey);
      if (e >= 1.60) continue;
      /* 縁の骨の隆起 */
      if (e > 0.98) d += 0.0092 * Math.sin(clamp((e - 0.98) / 0.56, 0, 1) * Math.PI) * gF;
      /* 眼窩は法線ではなく「真後ろ」へ彫る。法線方向に彫ると曲面上で
         窪みが中心へ潰れてしまう。底は平らに深く落として空洞にする。 */
      if (e < 1.04) {
        var prof = e < 0.66 ? 1 : Math.pow(Math.cos(clamp((e - 0.66) / 0.38, 0, 1) * Math.PI * 0.5), 0.72);
        dz += SOCK_DEEP * prof * gF;
      }
      /* 奥は闇、縁だけ僅かに光る */
      oc *= 1 - 0.985 * smooth01((1.30 - e) / 0.56) * gF;
    }

    /* 頬骨の張りと、その下のこけ */
    var cb1 = Math.exp(-(Math.pow((X - 0.0765) / 0.0305, 2) + Math.pow((Y - 0.0135) / 0.0255, 2)));
    var cb2 = Math.exp(-(Math.pow((X + 0.0720) / 0.0290, 2) + Math.pow((Y - 0.0085) / 0.0245, 2)));
    d += (0.0094 * cb1 + 0.0084 * cb2) * gS;
    var hl1 = Math.exp(-(Math.pow((X - 0.0650) / 0.0305, 2) + Math.pow((Y + 0.0430) / 0.0275, 2)));
    var hl2 = Math.exp(-(Math.pow((X + 0.0615) / 0.0295, 2) + Math.pow((Y + 0.0400) / 0.0265, 2)));
    d -= (0.0106 * hl1 + 0.0098 * hl2) * gS;
    oc *= 1 - 0.36 * Math.max(hl1, hl2) * gS;

    /* 鼻: 鼻梁の稜 → 軟骨が欠けた梨状口 → 鼻孔の窪み */
    var brg = Math.exp(-Math.pow(X / 0.0135, 2)) * Math.exp(-Math.pow((Y - 0.0230) / 0.0320, 2));
    d += 0.0042 * brg * gF;
    var pyr = Math.exp(-(Math.pow(X / 0.0180, 2) + Math.pow((Y - NOSE_Y) / 0.0215, 2)));
    dz += 0.0195 * pyr * gF;
    oc *= 1 - 0.64 * pyr * gF;
    var no1 = Math.exp(-(Math.pow((X - 0.0104) / 0.0038, 2) + Math.pow((Y - NOSE_Y - 0.0010) / 0.0135, 2)));
    var no2 = Math.exp(-(Math.pow((X + 0.0100) / 0.0036, 2) + Math.pow((Y - NOSE_Y - 0.0000) / 0.0130, 2)));
    dz += (0.0230 * no1 + 0.0220 * no2) * gF;
    oc *= 1 - 0.94 * Math.max(no1, no2) * gF;

    /* 口: 頬まで裂けた開口。縁は唇ではなく破れた肉として引き込む */
    var mt = mouthT(X);
    if (mt < 1) {
      var ym = mouthMid(X), hh = mouthHalf(X);
      var ad = Math.abs(Y - ym);
      var gM = gF * smooth01((1 - mt) / 0.10);
      if (ad < hh + 0.014) dz += 0.0090 * (1 - clamp((ad - hh) / 0.014, 0, 1)) * gM;
      else if (ad < hh + 0.027) d += 0.0030 * (1 - clamp((ad - hh - 0.014) / 0.013, 0, 1)) * gM;
      oc *= 1 - 0.74 * smooth01((hh + 0.032 - ad) / 0.036) * gM;
      hole = Math.max(hole, smooth01((hh * 1.06 - ad) / (hh * 0.42 + 0.004)) * gM);
    }
    /* 口角から頬へ延びる裂け（溝。穴は開けない） */
    for (i = 0; i < 2; i++) {
      var sgn = i ? -1 : 1;
      var tx = sgn * 0.0930, ty = -0.0430;
      var sx0 = sgn * MOUTH_W, sy0 = mouthMid(sgn * MOUTH_W);
      var vx2 = tx - sx0, vy2 = ty - sy0;
      var tt = clamp(((X - sx0) * vx2 + (Y - sy0) * vy2) / (vx2 * vx2 + vy2 * vy2), 0, 1);
      var qx2 = X - (sx0 + vx2 * tt), qy2 = Y - (sy0 + vy2 * tt);
      var dist = Math.sqrt(qx2 * qx2 + qy2 * qy2);
      var cut = Math.exp(-Math.pow(dist / 0.0058, 2)) * (1 - tt * 0.55);
      d -= 0.0072 * cut * gS;
      oc *= 1 - 0.55 * cut * gS;
    }

    /* 顎とオトガイ */
    var chn = Math.exp(-(Math.pow((X - 0.0040) / 0.0300, 2) + Math.pow((Y + 0.1400) / 0.0280, 2)));
    d += 0.0070 * chn * gF;
    var jaw = Math.exp(-Math.pow((Y + 0.0930) / 0.0340, 2))
      * Math.exp(-Math.pow((Math.abs(X) - 0.0730) / 0.0260, 2));
    d += 0.0050 * jaw * gS;

    /* 全体の遮蔽: 下面と後頭部を落とす（上前方からの光が届かない側） */
    oc *= 0.52 + 0.48 * smooth01((ny + 0.92) / 1.25);
    oc *= 0.50 + 0.50 * smooth01((fr + 0.62) / 1.10);

    out[0] = d; out[1] = clamp(oc, 0.02, 1); out[2] = clamp(hole, 0, 1); out[3] = dz;
    return out;
  }

  var _hb = [0, 0, 0], _hf = [0, 0, 0];

  /**
   * 彫刻後の頭部表面点 → out[0..2]=座標 / out[3]=遮蔽 / out[4]=開口の度合い。
   * off だけ法線方向に押し出す（髪・頭皮用）。
   */
  function headSurfacePoint(theta, phi, off, out) {
    headBase(theta, phi, _hb);
    var ny = Math.cos(theta), s = Math.sin(theta);
    var nx = s * Math.sin(phi), nz = -s * Math.cos(phi);
    /* 楕円体の法線 */
    var gx = _hb[0] / (HRX * HRX), gy = _hb[1] / (HRY * HRY), gz = _hb[2] / (HRZ * HRZ);
    var gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    headFeatures(_hb[0], _hb[1], _hb[2], nx, ny, nz, _hf);
    var d = _hf[0] + (off || 0);
    out[0] = _hb[0] + gx * d; out[1] = _hb[1] + gy * d;
    out[2] = _hb[2] + gz * d + _hf[3];
    out[3] = _hf[1]; out[4] = _hf[2];
    return out;
  }

  /**
   * 彫刻前（うねりのみ）の表面点。髪と頭皮はこちらを使う——
   * 彫った眼窩や口腔に髪が落ち込むのを防ぐ。
   */
  function headSmoothPoint(theta, phi, off, out) {
    headBase(theta, phi, _hb);
    var ny = Math.cos(theta), s = Math.sin(theta);
    var nx = s * Math.sin(phi), nz = -s * Math.cos(phi);
    var gx = _hb[0] / (HRX * HRX), gy = _hb[1] / (HRY * HRY), gz = _hb[2] / (HRZ * HRZ);
    var gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    var d = headLump(nx, ny, nz) * 0.0105 + (off || 0);
    out[0] = _hb[0] + gx * d; out[1] = _hb[1] + gy * d; out[2] = _hb[2] + gz * d;
    return out;
  }

  /** (x,y) から彫刻後の表面点を引く（口腔・歯・眼窩の位置合わせ用） */
  function headSurfaceAtXY(mx, my, off, out) {
    var uv = headUV(mx, my);
    return headSurfacePoint(uv[1] * Math.PI, (uv[0] - 0.5) * Math.PI * 2, off, out);
  }

  /** 密度関数に沿って [0,1] を n+1 点に分割（顔の周りに頂点を集める） */
  function densitySamples(n, density) {
    var M = 384, cum = new Float64Array(M + 1), sum = 0, i;
    for (i = 0; i < M; i++) { sum += density((i + 0.5) / M); cum[i + 1] = sum; }
    for (i = 0; i <= M; i++) cum[i] /= sum;
    var out = new Float64Array(n + 1), k = 0;
    for (var j = 0; j <= n; j++) {
      var target = j / n;
      while (k < M - 1 && cum[k + 1] < target) k++;
      var t0 = cum[k], t1 = cum[k + 1];
      out[j] = (k + (t1 > t0 ? (target - t0) / (t1 - t0) : 0)) / M;
    }
    out[0] = 0; out[n] = 1;
    return out;
  }

  /** 彫刻した頭蓋。眼窩と口は面を抜く。occ は頂点ごとの遮蔽 */
  function skullGeo(RS, HS) {
    var pos = [], uv = [], occ = [], idx = [];
    var pt = [0, 0, 0, 0, 0];
    var i, j;
    /* 正面と顔の高さ帯に頂点を寄せる */
    var pu = densitySamples(RS, function (t) {
      return 1 + 2.30 * Math.exp(-Math.pow((t - 0.5) / 0.175, 2));
    });
    var pv = densitySamples(HS, function (t) {
      return 1
        + 1.95 * Math.exp(-Math.pow((t - 0.345) / 0.085, 2))   /* 眼窩 */
        + 1.55 * Math.exp(-Math.pow((t - 0.665) / 0.090, 2))   /* 口 */
        + 0.60 * Math.exp(-Math.pow((t - 0.530) / 0.100, 2));  /* 鼻 */
    });
    var holeF = new Float32Array((RS + 1) * (HS + 1));
    for (j = 0; j <= HS; j++) {
      var th = pv[j] * Math.PI;
      for (i = 0; i <= RS; i++) {
        var u = pu[i];
        headSurfacePoint(th, (u - 0.5) * Math.PI * 2, 0, pt);
        pos.push(pt[0], pt[1], pt[2]);
        uv.push(u, pv[j]);
        occ.push(pt[3]);
        holeF[j * (RS + 1) + i] = pt[4];
      }
    }
    var stride = RS + 1;
    for (j = 0; j < HS; j++) {
      for (i = 0; i < RS; i++) {
        var a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
        var h = (holeF[a] + holeF[b] + holeF[c] + holeF[d]) * 0.25;
        if (h > 0.50) continue;                   /* 開口: 面を張らない */
        idx.push(a, c, b, b, c, d);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.userData.occ = new Float32Array(occ);
    return geo;
  }

  /** 口腔。開口より一回り大きい縁から奥へすぼまり、閉じる */
  function oralCavityGeo() {
    var RING = 20, K = 5, pos = [], col = [], idx = [];
    var pt = [0, 0, 0, 0, 0];
    for (var k = 0; k <= K; k++) {
      var f = k / K;
      var kw = 1.20 * (1 - 0.40 * f), kh = 1.46 * (1 - 0.26 * f);
      var depth = 0.0155 + 0.042 * Math.pow(f, 0.72);
      var lum = 0.085 * (1 - f) * (1 - f) + 0.018;
      for (var i = 0; i <= RING; i++) {
        var a = i / RING * Math.PI * 2;
        var X = MOUTH_W * kw * Math.cos(a);
        var xc = clamp(X, -MOUTH_W * 0.999, MOUTH_W * 0.999);
        var Y = mouthMid(xc) + (mouthHalf(xc) * kh + 0.0075 * (1 - 0.5 * f)) * Math.sin(a);
        headSurfaceAtXY(xc, Y, 0, pt);
        pos.push(pt[0] + (X - xc), pt[1], pt[2] + depth);
        /* 上顎側にだけ乾いた暗赤を僅かに残す */
        var warm = Math.sin(a) > 0.3 ? 1.55 : 1.0;
        col.push(lum * warm, lum * 0.88, lum * 0.84);
      }
    }
    var stride = RING + 1;
    for (var k2 = 0; k2 < K; k2++) {
      for (var i2 = 0; i2 < RING; i2++) {
        var A = k2 * stride + i2, B = A + 1, C = A + stride, D = C + 1;
        idx.push(A, C, B, B, C, D);
      }
    }
    var base = pos.length / 3;
    headSurfaceAtXY(0, MOUTH_Y, 0, pt);
    pos.push(pt[0], pt[1], pt[2] + 0.048);
    col.push(0.014, 0.012, 0.012);
    for (var i3 = 0; i3 < RING; i3++) {
      var E = K * stride + i3;
      idx.push(base, E, E + 1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * 歯。上下の開口縁に1本ずつ独立ジオメトリで植える。
   * 不揃い・欠損・傾きを持たせ、根元を汚して「白い帯」に見せない。
   */
  function teethGeo(seed) {
    var rr = rngOf(seed || 771);
    var pos = [], col = [], idx = [];
    var pt = [0, 0, 0, 0, 0];

    function tooth(cxm, cym, czm, dirx, diry, len, w, dep, lean, sh) {
      var base = pos.length / 3;
      /* 歯の軸(dirx,diry) に沿って len 伸びる四角錐台 */
      var px = -diry, py = dirx;                     /* 軸に直交する横方向 */
      var tipx = cxm + dirx * len + px * lean;
      var tipy = cym + diry * len + py * lean;
      var quads = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      for (var q = 0; q < 4; q++) {
        pos.push(cxm + px * w * quads[q][0], cym + py * w * quads[q][0], czm + dep * quads[q][1]);
        col.push(sh * 0.42, sh * 0.40, sh * 0.32);   /* 根元は汚れて暗い */
      }
      for (var q2 = 0; q2 < 4; q2++) {
        pos.push(tipx + px * w * 0.68 * quads[q2][0], tipy + py * w * 0.68 * quads[q2][0],
          czm + dep * 0.62 * quads[q2][1]);
        col.push(sh * 1.00, sh * 0.96, sh * 0.80);
      }
      for (var e = 0; e < 4; e++) {
        var a = base + e, b = base + (e + 1) % 4, c = base + 4 + e, d = base + 4 + (e + 1) % 4;
        idx.push(a, c, b, b, c, d);
      }
      idx.push(base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
    }

    function row(up) {
      var N = up ? 21 : 18;
      for (var i = 0; i < N; i++) {
        var f = (i + 0.5) / N;
        var X = (f * 2 - 1) * MOUTH_W * 0.92;
        if (rr() < (Math.abs(X) > MOUTH_W * 0.70 ? 0.52 : (up ? 0.16 : 0.34))) continue;   /* 欠損 */
        var hh = mouthHalf(X);
        if (hh < 0.0035) continue;
        var Y = mouthMid(X) + (up ? 1 : -1) * hh * (0.74 + rr() * 0.14);
        /* 開口縁の傾きに沿って、口の中へ向ける */
        var dxm = 0.0012;
        var y1 = mouthMid(X - dxm) + (up ? 1 : -1) * mouthHalf(X - dxm) * 0.90;
        var y2 = mouthMid(X + dxm) + (up ? 1 : -1) * mouthHalf(X + dxm) * 0.90;
        var m = (y2 - y1) / (dxm * 2);
        var nl = Math.sqrt(m * m + 1);
        var dirx = (up ? m : -m) / nl, diry = (up ? -1 : 1) / nl;
        headSurfaceAtXY(X, Y, 0, pt);
        X = pt[0]; Y = pt[1];
        var g2 = rr();
        var len = (up ? 0.0030 : 0.0026) + g2 * g2 * (up ? 0.0112 : 0.0088);
        var w = 0.0030 + rr() * 0.0042;
        var sh = 0.16 + rr() * rr() * 0.62;
        tooth(X, Y, pt[2] + 0.0060 + rr() * 0.0030,
          dirx, diry, len, w, 0.0060 + rr() * 0.0028, (rr() - 0.5) * 0.0026, sh);
      }
    }
    row(true); row(false);

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /* ---------------- 髪 ----------------
   * 「黒い棒の束」をやめ、頭皮に沿って生えて肩へ落ちる濡れた束にする。
   * 房の前半は頭蓋の面をなぞり、生え際を越えてから自由落下に切り替わる。
   */
  function hairlineTheta(phi) {
    var ap = Math.abs(phi);
    return 0.72 + 0.55 * smooth01((ap - 0.50) / 1.20) + 0.56 * smooth01((ap - 1.80) / 1.30);
  }

  /** 頭皮（生え際より上を覆う薄い殻） */
  function scalpGeo(RS, HS) {
    var pos = [], col = [], idx = [];
    var pt = [0, 0, 0, 0, 0];
    var rr = rngOf(3391);
    var edge = [];
    for (var i = 0; i <= RS; i++) {
      var phi = (i / RS - 0.5) * Math.PI * 2;
      edge.push(hairlineTheta(phi) + (rr() - 0.5) * 0.09);
    }
    edge[RS] = edge[0];
    /* 隣と均して尖った切り欠きを消す */
    for (var sm = 0; sm < 2; sm++) {
      var cp = edge.slice();
      for (var q = 0; q <= RS; q++) {
        var a0 = cp[(q - 1 + RS) % RS], b0 = cp[q], c0 = cp[(q + 1) % RS];
        edge[q] = (a0 + b0 * 2 + c0) * 0.25;
      }
      edge[RS] = edge[0];
    }
    for (var j = 0; j <= HS; j++) {
      var t = j / HS;
      for (var i2 = 0; i2 <= RS; i2++) {
        var ph = (i2 / RS - 0.5) * Math.PI * 2;
        var th = 0.045 + (edge[i2] - 0.045) * t;
        headSmoothPoint(th, ph, 0.0075 + 0.0035 * (1 - t), pt);
        pos.push(pt[0], pt[1], pt[2]);
        /* 濡れた黒。頭頂だけ僅かに光る */
        var lum = 0.007 + 0.019 * Math.pow(1 - t, 2.6) * (0.5 + 0.5 * Math.cos(ph));
        col.push(lum, lum, lum * 1.10);
      }
    }
    var stride = RS + 1;
    for (var j2 = 0; j2 < HS; j2++) {
      for (var i3 = 0; i3 < RS; i3++) {
        var A = j2 * stride + i3, B = A + 1, C = A + stride, D = C + 1;
        idx.push(A, C, B, B, C, D);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * 髪の房1本。頭皮に沿って垂れ、生え際を越えたら重力方向へ流れる。
   * 返すのは head ローカル座標のリボン（親は head ノード）。
   */
  function hairStrandGeo(theta0, phi0, total, w0, off, rr) {
    var S = 10, spine = [], pt = [0, 0, 0, 0, 0, 0, 0, 0];
    var th = theta0, ph = phi0;
    var dth = 0.26 + rr() * 0.10;
    var dph = (rr() - 0.5) * 0.10;
    var stop = 2.05 + rr() * 0.35;
    var prev = null, dir = null, used = 0;
    for (var i = 0; i <= S; i++) {
      if (dir === null) {
        headSmoothPoint(th, ph, off + 0.008 * (i / S), pt);
        var p = [pt[0], pt[1], pt[2]];
        if (prev) used += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
        spine.push(p);
        prev = p;
        th += dth; ph += dph;
        if (th >= stop && spine.length > 1) {
          var q = spine[spine.length - 2];
          dir = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
          var dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
          dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;
        }
      } else {
        var rest = Math.max(0.04, total - used);
        var step = rest / Math.max(1, (S - i + 1));
        /* 重力＋僅かに後方へ流れる */
        var mix = 0.34;
        dir[0] += (0 - dir[0]) * mix * 0.5 + (rr() - 0.5) * 0.05;
        dir[1] += (-1 - dir[1]) * mix;
        dir[2] += (0.16 - dir[2]) * mix * 0.6;
        var l2 = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        dir[0] /= l2; dir[1] /= l2; dir[2] /= l2;
        var np = [prev[0] + dir[0] * step, prev[1] + dir[1] * step, prev[2] + dir[2] * step];
        spine.push(np); prev = np; used += step;
      }
    }
    /* リボン化: 幅方向は「接線 × 外向き」＝頭の面に沿う向き。
       根元を原点に平行移動して返す（揺れは根元まわりの回転になる） */
    var pos = [], col = [], idx = [], n = spine.length;
    var root = spine[0].slice();
    var twist = (rr() - 0.5) * 2.0;
    for (var k = 0; k < n; k++) {
      var a = spine[Math.max(0, k - 1)], b = spine[Math.min(n - 1, k + 1)];
      var tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      var tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      var ox = spine[k][0], oy = spine[k][1], oz = spine[k][2];
      var ol = Math.hypot(ox, oy, oz) || 1;
      var rx = ox / ol, ry = oy / ol, rz = oz / ol;
      /* 幅ベクトル = t × r */
      var wx = ty * rz - tz * ry, wy = tz * rx - tx * rz, wz = tx * ry - ty * rx;
      var wl = Math.hypot(wx, wy, wz) || 1; wx /= wl; wy /= wl; wz /= wl;
      var u = k / (n - 1);
      var tw = twist * u;
      var cw = Math.cos(tw), sw = Math.sin(tw);
      var ax = wx * cw + rx * sw, ay = wy * cw + ry * sw, az = wz * cw + rz * sw;
      var hw = w0 * (1 - 0.72 * Math.pow(u, 1.6)) * 0.5;
      pos.push(ox - ax * hw - root[0], oy - ay * hw - root[1], oz - az * hw - root[2]);
      pos.push(ox + ax * hw - root[0], oy + ay * hw - root[1], oz + az * hw - root[2]);
      /* 濡れた束: 片側にだけ弱いハイライト */
      var lum = 0.0075 + 0.0090 * (1 - u);
      col.push(lum, lum, lum * 1.18);
      col.push(lum * 3.4, lum * 3.4, lum * 3.8);
      if (k < n - 1) {
        var A = k * 2;
        idx.push(A, A + 2, A + 1, A + 1, A + 2, A + 3);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    /* 毛先（根元からの相対位置）。反転形態で床を抜かせないクランプに使う */
    var tip = [spine[n - 1][0] - root[0], spine[n - 1][1] - root[1], spine[n - 1][2] - root[2]];
    return { geo: geo, root: root, tip: tip };
  }

  /**
   * 布。輪郭を角度ごとに歪ませ、裾を不揃いに破る（板・紙に見せない）。
   * 列ごとに丈が違うので、そのままギザギザのほつれた裾になる。
   */
  function clothGeo(len, radSeg, hSeg, profile, uRep, vRep, seed, ragged) {
    var pos = [], uv = [], idx = [];
    var rr = rngOf(seed || 7);
    var lenOf = [], warp = [], lean = [];
    for (var i = 0; i <= radSeg; i++) {
      var a0 = i / radSeg * Math.PI * 2;
      var wobble = 1 + 0.115 * Math.sin(a0 * 3 + seed) + 0.075 * Math.sin(a0 * 7 - seed * 1.7)
        + 0.045 * Math.sin(a0 * 13 + 2.1);
      var tear = ragged ? (ragged * (0.25 + 0.75 * Math.abs(Math.sin(a0 * 2.6 + seed * 0.9)))
        + ragged * 0.5 * rr()) : 0;
      warp.push(wobble);
      lenOf.push(len + tear);
      lean.push((rr() - 0.5) * 0.035);
    }
    warp[radSeg] = warp[0]; lenOf[radSeg] = lenOf[0]; lean[radSeg] = lean[0];
    for (var j = 0; j <= hSeg; j++) {
      var t = j / hSeg;
      var pf = profile(t);
      var sx = pf.sx === undefined ? 1 : pf.sx, sz = pf.sz === undefined ? 1 : pf.sz;
      for (var k = 0; k <= radSeg; k++) {
        var a = k / radSeg * Math.PI * 2;
        var w = 1 + (warp[k] - 1) * (0.35 + 0.65 * t);   /* 裾ほど歪む */
        var r = pf.r * w;
        var yy = -t * lenOf[k];
        pos.push(Math.cos(a) * r * sx + lean[k] * t * t,
          yy,
          Math.sin(a) * r * sz + lean[k] * t * t * 0.6);
        uv.push(k / radSeg * (uRep || 1), t * (vRep || 1));
      }
    }
    var stride = radSeg + 1;
    for (var jj = 0; jj < hSeg; jj++) {
      for (var kk = 0; kk < radSeg; kk++) {
        var a1 = jj * stride + kk, b1 = a1 + 1, c1 = a1 + stride, d1 = c1 + 1;
        idx.push(a1, c1, b1, b1, c1, d1);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /* スカートの丈（腰から裾まで・m）。_drape の縦詰めもこの値を基準にする */
  var SKIRT_L = 1.45;

  /**
   * スカートの1枚。腰の弧 aWidth ぶんを占める帯で、下へ行くほど外へ開く。
   * 列ごとに丈を変え、1〜2列を深く切り欠く＝裂け目。パネル同士の隙間と
   * この切り欠きから、逆関節の膝と脚の動きが覗く（契約§4）。
   */
  function skirtPanelGeo(aCenter, aWidth, len, rTop, rBotX, rBotZ, hSeg, wSeg, seed) {
    var pos = [], uv = [], idx = [];
    var rr = rngOf(seed || 5);
    var lenK = [], wob = [];
    for (var k = 0; k <= wSeg; k++) {
      lenK.push(0.95 + 0.05 * rr());
      wob.push((rr() - 0.5) * 0.055);
    }
    /* 深い切り欠き（裂け目）を1本入れる */
    var notch = 1 + Math.floor(rr() * Math.max(1, wSeg - 1));
    lenK[notch] *= 0.40 + 0.22 * rr();
    for (var j = 0; j <= hSeg; j++) {
      var t = j / hSeg;
      var flare = Math.pow(t, 1.25);
      for (var k2 = 0; k2 <= wSeg; k2++) {
        var e = k2 / wSeg;
        /* 端の列ほど短く＝ほつれた縦の縁 */
        var edgeK = 0.94 + 0.06 * Math.sin(e * Math.PI);
        var a = aCenter + (e - 0.5) * aWidth * (1 + 0.16 * t) + wob[k2] * t;
        var rx = rTop + (rBotX - rTop) * flare;
        var rz = rTop + (rBotZ - rTop) * flare;
        pos.push(Math.cos(a) * rx, -t * len * lenK[k2] * edgeK, Math.sin(a) * rz);
        uv.push(e * 1.2, t * 2.2);
      }
    }
    var stride = wSeg + 1;
    for (var j2 = 0; j2 < hSeg; j2++) {
      for (var k3 = 0; k3 < wSeg; k3++) {
        var A = j2 * stride + k3, B = A + 1, C = A + stride, D = C + 1;
        idx.push(A, C, B, B, C, D);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** 帯（髪・ボロ布の房）。y=0 から -len、幅 w、緩く波打つ */
  function ribbonGeo(len, w, seg, curve, twist) {
    var pos = [], uv = [], idx = [];
    for (var j = 0; j <= seg; j++) {
      var t = j / seg;
      var bend = curve * t * t;
      var ww = w * (1 - 0.55 * t);
      var tw = (twist || 0) * t;
      for (var i = 0; i <= 1; i++) {
        var s = (i - 0.5) * ww;
        pos.push(Math.cos(tw) * s, -t * len, bend + Math.sin(tw) * s);
        uv.push(i, t);
      }
    }
    for (var j2 = 0; j2 < seg; j2++) {
      var a = j2 * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * 頂点色に擬似ライト＋AOを焼く。
   * 環境は MeshBasicMaterial なので、ここで焼かないと立体が平板に潰れる。
   * key は「上前方から」の固定光。ローカル空間で焼く＝どちらを向いても形が読める。
   */
  var KEY = (function () {
    var v = new THREE.Vector3(0.28, 0.90, -0.34); v.normalize(); return v;
  })();
  var FILL = (function () {
    var v = new THREE.Vector3(-0.55, 0.15, 0.62); v.normalize(); return v;
  })();

  function bakeShade(geo, opt) {
    opt = opt || {};
    var amb = opt.amb === undefined ? 0.34 : opt.amb;
    var kgain = opt.key === undefined ? 0.72 : opt.key;
    var fgain = opt.fill === undefined ? 0.18 : opt.fill;
    var base = opt.base || [1, 1, 1];
    var kd = opt.keyDir || KEY, fd = opt.fillDir || FILL;
    var kpow = opt.keyPow === undefined ? 2 : opt.keyPow;
    var np = geo.attributes.position.count;
    var nAttr = geo.attributes.normal, pAttr = geo.attributes.position;
    var col = new Float32Array(np * 3);
    for (var i = 0; i < np; i++) {
      var nx, ny, nz;
      if (opt.radialNormal) {
        /* 起伏を焼き込んだ殻用: 中心からの向きを法線として使う。
           凹凸で法線が暴れて「まだら」になるのを防ぎ、陰影はテクスチャに任せる。 */
        nx = pAttr.getX(i); ny = pAttr.getY(i) - (opt.radialCenterY || 0); nz = pAttr.getZ(i);
        var rl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= rl; ny /= rl; nz /= rl;
      } else {
        nx = nAttr.getX(i); ny = nAttr.getY(i); nz = nAttr.getZ(i);
      }
      var k = nx * kd.x + ny * kd.y + nz * kd.z; if (k < 0) k = 0;
      var f = nx * fd.x + ny * fd.y + nz * fd.z; if (f < 0) f = 0;
      var v = amb + kgain * Math.pow(k, kpow) + fgain * f;
      /* 上下方向のグラデ（根元を落として関節を締める） */
      if (opt.grad) {
        var y = pAttr.getY(i);
        v *= opt.grad(y);
      }
      if (v > 1.25) v = 1.25;
      /* 凹み方向を考慮した遮蔽（眼窩の奥・口の周り・こめかみ等） */
      if (opt.occ) v *= opt.occ[i];
      col[i * 3] = base[0] * v; col[i * 3 + 1] = base[1] * v; col[i * 3 + 2] = base[2] * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }

  /* ================================================================
   * ポーズ（joint -> [rx,ry,rz]）
   * ============================================================== */
  var POSE_STAND = {
    hipY: HIP_Y,
    body: [0.10, 0, 0.02], roll: [0, 0, 0],
    spine: [0.06, 0, -0.02], chest: [0.05, 0.04, 0.03],
    neck: [-0.08, -0.10, 0], headRoll: [0, 0, 0], head: [0.02, 0.07, 0.14],
    shL: [-0.06, 0, -0.11], elbL: [0.20, 0, 0.04], wrL: [0.18, 0, 0.10],
    shR: [-0.02, 0, 0.14], elbR: [0.14, 0, -0.05], wrR: [0.22, 0, -0.06],
    hipL: [0.30, 0.04, 0.05], kneeL: [-0.56, 0, 0], ankL: [0.72, 0, 0],
    hipR: [0.26, -0.05, -0.04], kneeR: [-0.50, 0, 0], ankR: [0.68, 0, 0]
  };

  /* 反転形態（ブリッジ）。body で後方へ倒し、roll で腹を上に向け、
     首を反らせ headRoll(π) で顔だけ正面に立て直す。 */
  var POSE_CRAWL = {
    hipY: 0.52,
    body: [-1.60, 0, 0.05], roll: [0, Math.PI, 0],
    spine: [0.10, 0, 0], chest: [0.22, 0.05, 0],
    /* headRoll(z=π) の中なので head の rx は符号が反転する。
       neck を起こして head を戻すことで「首だけねじれて顔は正面」を作る。 */
    /* 首を実長で通し頭を一回り大きくしたぶん、同じ neck 角では顎が床を擦る。
       首を起こし head で同量戻す＝顔の向きは据え置きのまま顎を床から離す。 */
    neck: [0.24, 0, 0], headRoll: [0, 0, Math.PI], head: [-0.98, 0.10, -0.10],
    shL: [2.50, 0.24, 0.26], elbL: [2.34, 0, -0.16], wrL: [-0.70, 0, 0.10],
    shR: [2.56, -0.20, -0.22], elbR: [2.38, 0, 0.14], wrR: [-0.66, 0, -0.10],
    hipL: [0.42, 0.20, 0.14], kneeL: [-1.92, 0, 0], ankL: [-0.34, 0, 0],
    hipR: [0.48, -0.18, -0.12], kneeR: [-1.98, 0, 0], ankR: [-0.30, 0, 0]
  };

  var JOINTS = ['body', 'roll', 'spine', 'chest', 'neck', 'headRoll', 'head',
    'shL', 'elbL', 'wrL', 'shR', 'elbR', 'wrR',
    'hipL', 'kneeL', 'ankL', 'hipR', 'kneeR', 'ankR'];

  function blendPose(a, b, u, out) {
    out.hipY = a.hipY + (b.hipY - a.hipY) * u;
    for (var i = 0; i < JOINTS.length; i++) {
      var k = JOINTS[i], va = a[k], vb = b[k];
      var o = out[k] || (out[k] = [0, 0, 0]);
      o[0] = va[0] + (vb[0] - va[0]) * u;
      o[1] = va[1] + (vb[1] - va[1]) * u;
      o[2] = va[2] + (vb[2] - va[2]) * u;
    }
    return out;
  }

  /* ================================================================
   * Enemy
   * ============================================================== */
  function Enemy(opts) {
    opts = opts || {};
    this.seed = opts.seed || 1;
    this.group = new THREE.Group();
    this.group.name = 'enemy';
    this.nodes = {};
    this.contacts = [];
    this.disposables = [];
    this.triangles = 0;
    this.extraTriangles = 0;        /* P4.6: 捕獲演出中だけ足される三角形 */
    this._countExtra = false;
    this.detailHi = false;          /* P4.6: 捕獲演出中だけ true（高密度顔＋赤い目） */
    this.skirtReach = 1.0;          /* スカートの到達距離（_build で実測） */
    this.poseT = 0;                 /* 0=直立 1=反転 */
    this.state = 'idle';            /* idle | walk | chase | trans */
    this.transDir = 1;
    this.transTime = 0;
    this.transDur = 1.60;           /* 契約: 形態遷移は2秒以内 */
    this.animTime = 0;
    this.groundSnap = true;
    this.facing = 0;
    this.x = 0; this.z = 0; this.floorY = 0;
    this._pose = blendPose(POSE_STAND, POSE_STAND, 0, {});
    this._tmp = new THREE.Vector3();
    this._amb = { r: 0.02, g: 0.02, b: 0.02 };
    this._shadeOut = [0, 0, 0];
    this._build();
    this.applyPose(0);
  }

  Enemy.prototype._track = function (o) { this.disposables.push(o); return o; };

  Enemy.prototype._mesh = function (geo, mat, parent, name) {
    var m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;      /* 部位ごとの境界球がリグ変形で狂うため切らない */
    if (name) m.name = name;
    parent.add(m);
    this._track(geo);
    var tri = geo.index ? (geo.index.count / 3) : (geo.attributes.position.count / 3);
    /* P4.6: 捕獲演出専用パーツは通常時の三角形予算に数えない（演出中だけ足される） */
    if (this._countExtra) this.extraTriangles += tri;
    else this.triangles += tri;
    return m;
  };

  Enemy.prototype._node = function (name, parent, x, y, z) {
    var g = new THREE.Group();
    g.name = name;
    g.position.set(x || 0, y || 0, z || 0);
    parent.add(g);
    this.nodes[name] = g;
    return g;
  };

  Enemy.prototype._build = function () {
    var rand = rngOf(this.seed * 977 + 13);
    var SKIN = [0.86, 0.85, 0.80];

    var matSkin = this._track(new THREE.MeshBasicMaterial({
      map: tex('skin'), vertexColors: true, fog: true
    }));
    /* 頭部: 開口の縁を裏から見ることがあるので両面 */
    var matHead = this._track(new THREE.MeshBasicMaterial({
      map: tex('head'), vertexColors: true, fog: true, side: THREE.DoubleSide
    }));
    /* 眼窩・口腔の暗箱。明所でも黒く保つ（覗いた先は闇） */
    var matVoid = this._track(new THREE.MeshBasicMaterial({
      vertexColors: true, fog: true, side: THREE.DoubleSide
    }));
    /* 歯。骨の明度は肌と顔の中間 */
    var matTooth = this._track(new THREE.MeshBasicMaterial({
      vertexColors: true, fog: true, side: THREE.DoubleSide
    }));
    var matCloth = this._track(new THREE.MeshBasicMaterial({
      map: tex('cloth'), vertexColors: true, fog: true, side: THREE.DoubleSide
    }));
    /* 髪はリボン形状そのものが房なので、テクスチャもalphaTestも使わない
       （ペン画のような硬い輪郭を出さないため） */
    var matHair = this._track(new THREE.MeshBasicMaterial({
      vertexColors: true, fog: true, side: THREE.DoubleSide
    }));
    var matDark = this._track(new THREE.MeshBasicMaterial({
      vertexColors: true, fog: true, side: THREE.DoubleSide
    }));
    this.mats = {
      skin: matSkin, head: matHead, tooth: matTooth, hollow: matVoid,
      cloth: matCloth, hair: matHair, dark: matDark
    };

    var root = this.group;
    var body = this._node('body', root, 0, HIP_Y, 0);
    var roll = this._node('roll', body, 0, 0, 0);
    var pelvis = this._node('pelvis', roll, 0, 0, 0);

    /* ---- 骨盤 ---- */
    this._mesh(bakeShade(revolve(0.26, 8, 4, function (t) {
      return { r: 0.115 - 0.03 * t, sx: 1.25, sz: 0.80 };
    }, 1, 0.6), { base: SKIN, grad: function () { return 1; } }), matSkin, pelvis, 'pelvis');

    /* ---- 脚（逆関節） ---- */
    var self = this;
    function leg(side, sx) {
      var hip = self._node('hip' + side, pelvis, sx * HIP_W, -0.06, 0);
      var kL = (side === 'L' ? 1.02 : 0.98);   /* 左右非対称 */
      self._mesh(bakeShade(limbGeo(THIGH * kL, 0.098, 0.080, 0.055, 8, 0.92, 0.012), {
        base: SKIN, grad: function (y) { return 0.72 + 0.28 * Math.min(1, (-y) / 0.18 + 0.35); }
      }), matSkin, hip, 'thigh' + side);
      var knee = self._node('knee' + side, hip, 0, -THIGH * kL, 0);
      self._mesh(bakeShade(sphereGeo(0.050, 7, 5), { base: [0.72, 0.71, 0.66], amb: 0.28 }), matSkin, knee, 'kneecap' + side);
      self._mesh(bakeShade(limbGeo(SHANK * kL, 0.062, 0.055, 0.038, 8, 0.95, -0.010), {
        base: SKIN, grad: function (y) { return 0.78 + 0.22 * Math.min(1, (-y) / 0.14 + 0.4); }
      }), matSkin, knee, 'shank' + side);
      var ank = self._node('ank' + side, knee, 0, -SHANK * kL, 0);
      self._mesh(bakeShade(sphereGeo(0.044, 7, 5), { base: SKIN }), matSkin, ank, 'ankle' + side);
      /* 中足骨（長い足）＋つま先 */
      self._mesh(bakeShade(revolve(FOOT, 7, 3, function (t) {
        return { r: 0.040 - 0.012 * t, sx: 1.5, sz: 0.85 };
      }, 1, 0.8), { base: SKIN }), matSkin, ank, 'meta' + side);
      var toes = self._node('toes' + side, ank, 0, -FOOT, 0);
      for (var f = 0; f < 4; f++) {
        var tg = new THREE.Group();
        tg.position.set((f - 1.5) * 0.030, 0, 0);
        tg.rotation.set(1.30 + (rand() - 0.5) * 0.3, (f - 1.5) * 0.18, 0);
        toes.add(tg);
        self._mesh(bakeShade(revolve(0.085 + rand() * 0.03, 5, 2, function (t) {
          return { r: 0.014 - 0.005 * t };
        }, 1, 0.5), { base: SKIN }), matSkin, tg, 'toe');
      }
      var mk = new THREE.Object3D();
      mk.position.set(0, -0.02, -0.07);
      toes.add(mk);
      self.contacts.push(mk);
    }
    leg('L', -1); leg('R', 1);

    /* ---- 胴 ---- */
    var spine = this._node('spine', pelvis, 0, SPINE, 0);
    /* あばらの起伏は半径のうねりで作る（別メッシュにすると布を突き抜ける） */
    this._mesh(bakeShade(revolve(-CHEST, 10, 10, function (t) {
      var r = 0.086 + 0.042 * Math.sin(t * 2.6) - 0.018 * t;
      if (t > 0.28 && t < 0.88) r += 0.0080 * Math.sin((t - 0.28) * 32);   /* 浮いたあばら */
      return { r: r, sx: 1.20 + 0.30 * t, sz: 0.78 };
    }, 1, 1.0), {
      base: SKIN, grad: function (y) { return 0.80 + 0.20 * Math.min(1, y / 0.3 + 0.5); }
    }), matSkin, spine, 'torso');
    var chest = this._node('chest', spine, 0, CHEST, 0);

    /* ---- 服: 丈の長いスカート状の襤褸（DESIGN.md §4 2026-08-31改訂） ----
     * 上衣（胸〜腰の筒）＋腰から足首近くまで垂れる裂けたスカート。
     * スカートは縦の裂け目で分かれた帯（パネル）の集合で、隙間と破れから
     * 脚の動きと逆関節の膝が覗く。裾の向きは _drape が重力へ合わせる。 */
    var BODICE_L = 0.52;
    var clothRoot = this._node('clothRoot', chest, 0, -0.04, 0);
    this._mesh(bakeShade(clothGeo(BODICE_L, 16, 5, function (t) {
      return { r: 0.126 + 0.056 * t - 0.020 * Math.sin(t * 3.1), sx: 1.10, sz: 0.82 };
    }, 2, 1.0, 3, 0.055), {
      /* 布は key を弱める。裾を破ると法線が上を向く列ができ、強い上方キーで白く飛ぶ */
      base: [0.46, 0.47, 0.41], amb: 0.38, key: 0.32, fill: 0.12,
      grad: function (y) { return 0.62 + 0.38 * Math.min(1, (BODICE_L + y) / 0.5); }
    }), matCloth, clothRoot, 'bodice');

    /* スカートの根元。骨盤にぶら下がり、毎フレーム重力方向へ向け直される */
    var skirtRoot = this._node('skirtRoot', pelvis, 0, -0.02, 0);
    this.skirtRoot = skirtRoot;
    /* 下スカート（腰まわりを塞ぐ短い内側）。ここだけは閉じた筒 */
    this._mesh(bakeShade(clothGeo(0.40, 14, 3, function (t) {
      return { r: 0.150 + 0.062 * t, sx: 1.06, sz: 0.90 };
    }, 2, 0.7, 23, 0.05), {
      base: [0.40, 0.41, 0.35], amb: 0.38, key: 0.24, fill: 0.10
    }), matCloth, skirtRoot, 'underskirt');

    /* 外側のパネル14枚。正面と背面は短く（脚の踏み出しを殺さない）、
       側面は足首近くまで届かせて「丈の長いスカート」の輪郭を作る。 */
    var PANEL_N = 14;
    for (var pn = 0; pn < PANEL_N; pn++) {
      var pr = rngOf(4400 + pn * 313);
      var ac = (pn + 0.5) / PANEL_N * Math.PI * 2;
      /* |cos| は ±X（真横）で1、正面/背面で0 */
      var side = Math.pow(Math.abs(Math.cos(ac)), 0.55);
      var plen = SKIRT_L * (0.52 + 0.48 * side) * (0.88 + 0.24 * pr());
      var awid = (Math.PI * 2 / PANEL_N) * (1.00 + 0.10 * pr());
      /* 2枚だけ大きく破って短くする（裂け目の見せ場） */
      if (pn === 3 || pn === 10) { plen *= 0.42; awid *= 0.80; }
      /* 正面/背面は脚の踏み出しぶん外へ開かせる（腿がパネルを突き抜けない） */
      var rbx = 0.290 + 0.075 * (1 - side), rbz = 0.250 + 0.150 * (1 - side);
      var pg = skirtPanelGeo(ac, awid, plen, 0.158, rbx, rbz, 4, 4, 4400 + pn * 313);
      bakeShade(pg, {
        /* 垂直面ばかりなので上方キーが乗らない。amb を上げて上衣と同じ布に見せる */
        base: [0.46, 0.47, 0.41], amb: 0.40, key: 0.26, fill: 0.14,
        grad: function (y) { return 0.46 + 0.54 * clamp(1 + y / 1.30, 0, 1); }
      });
      this._mesh(pg, matCloth, skirtRoot, 'skirtPanel');
    }
    /* 裾から垂れるほつれ紐。短いパネルの下にも布の気配を残す */
    for (var fr = 0; fr < 6; fr++) {
      var a3 = fr / 6 * Math.PI * 2 + rand() * 0.30;
      var s3 = Math.pow(Math.abs(Math.cos(a3)), 0.55);
      var len3 = SKIRT_L * (0.42 + 0.50 * s3) * (0.68 + 0.34 * rand());
      var fg = ribbonGeo(len3 * 0.26, 0.030 + rand() * 0.026, 4, 0.04, (rand() - 0.5) * 0.6);
      bakeShade(fg, { base: [0.44, 0.45, 0.39], amb: 0.40, key: 0.24 });
      var fm = this._mesh(fg, matCloth, skirtRoot, 'fringe');
      var fry = -len3 * (0.72 + 0.18 * rand());
      var frr = 0.158 + (0.310 - 0.158) * Math.min(1, -fry / SKIRT_L * 1.6);
      fm.position.set(Math.cos(a3) * frr, fry, Math.sin(a3) * frr * 0.86);
      fm.rotation.y = -a3 + Math.PI / 2;
      fm.rotation.z = (rand() - 0.5) * 0.26;
    }
    /* スカートの到達距離を実測（この時点では回転が未適用＝ローカルの垂れ長そのもの） */
    this.group.updateMatrixWorld(true);
    var sbb = new THREE.Box3().setFromObject(skirtRoot);
    this.skirtReach = Math.max(0.3, skirtRoot.matrixWorld.elements[13] - sbb.min.y);

    /* 袖の残り（肩にかろうじて掛かる布）。輪郭を歪ませ裾を破る＝板に見せない */
    for (var sl = 0; sl < 2; sl++) {
      var sm = this._mesh(bakeShade(clothGeo(0.26, 12, 4, function (t) {
        return { r: 0.068 + 0.020 * t - 0.010 * Math.sin(t * 4.2), sx: 1.06, sz: 0.94 };
      }, 1, 0.6, sl ? 11 : 19, 0.085), {
        base: [0.36, 0.37, 0.32], amb: 0.30, key: 0.34, fill: 0.10,
        grad: function (y) { return 0.62 + 0.38 * Math.min(1, (0.30 + y) / 0.26); }
      }), matCloth, chest, 'sleeve');
      sm.position.set((sl ? 1 : -1) * (SHOULDER_W - 0.015), 0.13, 0);
      sm.rotation.set((sl ? 0.06 : -0.04), 0, (sl ? -1 : 1) * 0.16);
      /* 肩から垂れた破れ布（袖口の続き） */
      for (var tr2 = 0; tr2 < 3; tr2++) {
        var ta = (sl ? 1 : -1) * (0.5 + tr2 * 0.55) + rand() * 0.3;
        var tg2 = ribbonGeo(0.10 + rand() * 0.20, 0.026 + rand() * 0.026, 3, 0.03, (rand() - 0.5) * 0.8);
        bakeShade(tg2, { base: [0.40, 0.41, 0.36], amb: 0.36, key: 0.32 });
        var tm2 = this._mesh(tg2, matCloth, sm, 'sleeveTear');
        tm2.position.set(Math.cos(ta) * 0.078, -0.24, Math.sin(ta) * 0.072);
        tm2.rotation.set(0, -ta, (rand() - 0.5) * 0.4);
      }
    }
    /* 革ベルト（任意のアクセント。契約でベルトは必須ではない） */
    function belt(y0, tilt, seed2) {
      var pts = [], uvs = [], ids = [];
      var seg = 14, w = 0.028;
      for (var i2 = 0; i2 <= seg; i2++) {
        var a4 = i2 / seg * Math.PI * 2;
        var rr2 = 0.152;
        var yy = y0 + Math.sin(a4) * tilt;
        for (var k2 = 0; k2 < 2; k2++) {
          pts.push(Math.cos(a4) * rr2 * 1.18, yy + (k2 ? w : -w), Math.sin(a4) * rr2 * 0.88);
          uvs.push(i2 / seg * 3, k2);
        }
      }
      for (var i3 = 0; i3 < seg; i3++) {
        var a5 = i3 * 2, b5 = a5 + 1, c5 = a5 + 2, d5 = a5 + 3;
        ids.push(a5, c5, b5, b5, c5, d5);
      }
      var g5 = new THREE.BufferGeometry();
      g5.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g5.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g5.setIndex(ids);
      g5.computeVertexNormals();
      bakeShade(g5, { base: [0.075, 0.062, 0.052], amb: 0.55, key: 0.55 });
      return g5;
    }
    this._mesh(belt(-0.02, 0.075, 1), matDark, spine, 'belt1');
    var bg = new THREE.BoxGeometry(0.042, 0.056, 0.014);
    bakeShade(bg, { base: [0.10, 0.094, 0.082], amb: 0.6, key: 0.5 });
    var bm = this._mesh(bg, matDark, spine, 'buckle');
    bm.position.set(0.04, 0.005, -0.150);
    bm.rotation.z = 0.32;

    /* ---- 腕（膝下まで届く） ---- */
    function arm(side, sx) {
      var sh = self._node('sh' + side, chest, sx * SHOULDER_W, 0.14 + (side === 'L' ? 0.008 : -0.008), 0);
      self._mesh(bakeShade(sphereGeo(0.058, 8, 6), { base: SKIN }), matSkin, sh, 'shoulder' + side);
      var kA = (side === 'L' ? 1.04 : 1.0);
      self._mesh(bakeShade(limbGeo(UPARM * kA, 0.058, 0.048, 0.036, 7, 0.95, 0.010), {
        base: SKIN, grad: function (y) { return 0.76 + 0.24 * Math.min(1, (-y) / 0.16 + 0.4); }
      }), matSkin, sh, 'uparm' + side);
      var elb = self._node('elb' + side, sh, 0, -UPARM * kA, 0);
      self._mesh(bakeShade(sphereGeo(0.042, 7, 5), { base: SKIN }), matSkin, elb, 'elbow' + side);
      self._mesh(bakeShade(limbGeo(FOREARM * kA, 0.044, 0.038, 0.028, 7, 0.92, -0.008), {
        base: SKIN, grad: function (y) { return 0.80 + 0.20 * Math.min(1, (-y) / 0.14 + 0.4); }
      }), matSkin, elb, 'forearm' + side);
      var wr = self._node('wr' + side, elb, 0, -FOREARM * kA, 0);
      /* 手のひら */
      self._mesh(bakeShade(revolve(HAND * 0.5, 6, 2, function (t) {
        return { r: 0.036 - 0.004 * t, sx: 1.5, sz: 0.62 };
      }, 1, 0.4), { base: SKIN }), matSkin, wr, 'palm' + side);
      /* 指5本（節つき・長い） */
      for (var f2 = 0; f2 < 5; f2++) {
        var isThumb = (f2 === 4);
        var fg2 = new THREE.Group();
        if (isThumb) {
          fg2.position.set(sx * 0.045, -HAND * 0.36, 0.006);
          fg2.rotation.set(0.35, 0, sx * 1.05);
        } else {
          fg2.position.set((f2 - 1.5) * 0.030, -HAND * 0.52, 0);
          fg2.rotation.set(0.22 + rand() * 0.30, (f2 - 1.5) * 0.10, 0);
        }
        wr.add(fg2);
        var l1 = isThumb ? 0.058 : (0.066 + (1.5 - Math.abs(f2 - 1.5)) * 0.014);
        self._mesh(bakeShade(revolve(l1, 5, 2, function (t) {
          return { r: 0.0145 - 0.003 * t };
        }, 1, 0.4), { base: SKIN }), matSkin, fg2, 'phal1');
        var fg3 = new THREE.Group();
        fg3.position.set(0, -l1, 0);
        fg3.rotation.x = 0.42 + rand() * 0.5;
        fg2.add(fg3);
        self._mesh(bakeShade(revolve(l1 * 0.82, 5, 2, function (t) {
          return { r: 0.0125 - 0.004 * t };
        }, 1, 0.4), { base: SKIN }), matSkin, fg3, 'phal2');
        var fg4 = new THREE.Group();
        fg4.position.set(0, -l1 * 0.82, 0);
        fg4.rotation.x = 0.30 + rand() * 0.4;
        fg3.add(fg4);
        self._mesh(bakeShade(revolve(l1 * 0.6, 4, 1, function (t) {
          return { r: 0.0105 - 0.004 * t };
        }, 1, 0.4), { base: [0.80, 0.78, 0.72] }), matSkin, fg4, 'phal3');
      }
      var mk2 = new THREE.Object3D();
      mk2.position.set(0, -HAND, 0.02);
      wr.add(mk2);
      self.contacts.push(mk2);
    }
    arm('L', -1); arm('R', 1);

    /* ---- 首・頭 ----
     * 首は襟（上衣の口）から顎の下まで実際に通した筒。付け根＝鎖骨の高さに
     * ピボットを置くので、頭の傾きが「首から傾く」動きになる。
     * 細く長く取る＝大きな頭を支えきれていない不気味さが出る（契約§4の方向）。 */
    var neck = this._node('neck', chest, 0, NECK, 0);
    this._mesh(bakeShade(revolve(-NECK_L, 12, 7, function (t) {
      /* 付け根は僧帽筋へ広がり、上は顎の下で締まる。腱の起伏を僅かに残す。
         頭は前へ出ているので、筒も上へ行くほど前へ寄せて繋ぐ。 */
      var r = 0.054 - 0.021 * smooth01(t * 1.12) + 0.0035 * Math.sin(t * 9.1)
        + 0.0028 * Math.sin(t * 21.0 + 1.7);
      return { r: r, sx: 1.0, sz: 0.90, oz: -0.038 * t * t };
    }, 1, 0.9), {
      base: SKIN, amb: 0.24, key: 0.44,
      /* 襟の内側と顎の下は落とす。明るいままだと顎の下に白い板が出る */
      grad: function (y) {
        var u = clamp(y / NECK_L, 0, 1);
        return 0.26 + 0.74 * clamp((0.84 - u) / 0.52, 0, 1) * clamp((u + 0.40) / 0.50, 0, 1);
      }
    }), matSkin, neck, 'neck');
    /* 頭は首より前に出す。真上に載せると首の筒が口腔を貫き、
       口の奥に首の面が「白い板」として覗いてしまう。 */
    var headRoll = this._node('headRoll', neck, 0, HEAD_OFF, -0.038);
    var head = this._node('head', headRoll, 0, 0, 0);
    /* v4 の輪郭は縦長。頭部一式（殻・眼窩・口腔・歯・髪）をまとめて横に詰め、
       HEAD_K ぶん拡大する（髪もピボットごと乗るので頭に貼り付いたまま育つ） */
    var headScale = new THREE.Group();
    headScale.name = 'headScale';
    headScale.scale.set(0.93 * HEAD_K, HEAD_K, 0.99 * HEAD_K);
    head.add(headScale);

    /* 頭蓋: 彫刻した1枚の殻。眼窩は真後ろへ深く彫った空洞、口は実際に面を抜いた
       開口（規範§4）。陰影は「凹み方向を考慮した遮蔽」を頂点色に焼く（occ）。 */
    var sgeo = skullGeo(48, 46);
    bakeShade(sgeo, {
      /* v4_face のトーン: 光は正面から。額・こめかみ・眼窩は落ち、
         頬骨〜鼻〜上唇の面だけが蒼白く浮く。 */
      base: [1, 1, 1], amb: 0.26, key: 0.84, fill: 0.10, keyPow: 1.25, occ: sgeo.userData.occ,
      keyDir: new THREE.Vector3(0.14, -0.10, -0.99).normalize(),
      fillDir: new THREE.Vector3(-0.50, -0.34, -0.80).normalize()
    });
    var skull = this._mesh(sgeo, matHead, headScale, 'skull');
    this.faceMesh = skull;
    /* P4.6: 高解像度への差し替えから必ず戻れるよう、通常時の実体を保持する */
    this.headScale = headScale;
    this._loGeo = sgeo;
    this._loTex = matHead.map;

    /* 口腔（奥行きのある暗い袋）と、1本ずつ植えた歯 */
    this._mesh(oralCavityGeo(), matVoid, headScale, 'oral');
    this._mesh(teethGeo(this.seed * 131 + 7), matTooth, headScale, 'teeth');

    /* ---- 髪: 頭皮に沿って生え、濡れた束になって落ちる ---- */
    this._mesh(scalpGeo(22, 6), matHair, headScale, 'scalp');
    this.hairPivots = [];
    this.hairParent = headScale;    /* 房ピボットの親（床抜けクランプで world 行列に使う） */
    var self2 = this;
    function strand(theta0, phi0, total, w0, off, trailK, seed) {
      var rr = rngOf(seed);
      var res = hairStrandGeo(theta0, phi0, total, w0, off, rr);
      var piv = new THREE.Group();
      piv.position.set(res.root[0], res.root[1], res.root[2]);
      headScale.add(piv);
      var hm = self2._mesh(res.geo, matHair, piv, 'hair');
      hm.renderOrder = 3;
      self2.hairPivots.push({
        node: piv, base: piv.rotation.clone(),
        phase: rr() * 6.28, k: 0.5 + rr(), trailK: trailK,
        tip: new THREE.Vector3(res.tip[0], res.tip[1], res.tip[2])
      });
    }
    /* 側頭〜後頭の長い束 */
    for (var h = 0; h < 18; h++) {
      var hr = rngOf(6100 + h * 17);
      var ph0 = (h / 18 - 0.5) * Math.PI * 2 * 0.92 + (hr() - 0.5) * 0.14;
      if (Math.abs(ph0) < 1.38) ph0 += (ph0 >= 0 ? 1.38 : -1.38);   /* 顔の正面は空ける */
      var thl = hairlineTheta(ph0);
      strand(0.16 + (thl - 0.16) * Math.pow(hr(), 0.55), ph0,
        0.44 + hr() * 0.44, 0.016 + hr() * 0.020, 0.012 + hr() * 0.006, 1.0, 7100 + h * 91);
    }
    /* 後頭部の太い塊（薄っぺらく見せない） */
    for (var hb = 0; hb < 9; hb++) {
      var hr2 = rngOf(8200 + hb * 23);
      var ph2 = (hb - 4) * 0.26 + Math.PI + (hr2() - 0.5) * 0.2;
      if (ph2 > Math.PI) ph2 -= Math.PI * 2;
      strand(0.30 + hr2() * 0.40, ph2, 0.58 + hr2() * 0.34,
        0.028 + hr2() * 0.024, 0.013 + hr2() * 0.009, 1.0, 9300 + hb * 71);
    }
    /* 顔にかかる数本（濡れて頬に貼り付く。揺れは抑える） */
    var faceStrands = [-0.86, 0.52];
    for (var fs = 0; fs < faceStrands.length; fs++) {
      var hr3 = rngOf(9900 + fs * 29);
      var pf = faceStrands[fs];
      strand(hairlineTheta(pf) * (0.88 + hr3() * 0.10), pf,
        0.28 + hr3() * 0.20, 0.0055 + hr3() * 0.0055, 0.018 + hr3() * 0.008, 0.20, 10400 + fs * 53);
    }
  };

  /* ---------------- ポーズ適用 ---------------- */

  Enemy.prototype.applyPose = function (u, extra) {
    var p = blendPose(POSE_STAND, POSE_CRAWL, u, this._pose);
    if (extra) extra(p, u);
    var n = this.nodes;
    for (var i = 0; i < JOINTS.length; i++) {
      var k = JOINTS[i], nd = n[k], v = p[k];
      if (nd) nd.rotation.set(v[0], v[1], v[2]);
    }
    n.body.position.y = p.hipY;
    this.group.position.set(this.x, this.floorY, this.z);
    this.group.rotation.y = this.facing;
    this.group.updateMatrixWorld(true);
    if (this.groundSnap) this._snap();
  };

  /** 接地補正: 手足の接点のうち最も低いものを床に合わせる */
  Enemy.prototype._snap = function () {
    var lowest = Infinity, v = this._tmp;
    for (var i = 0; i < this.contacts.length; i++) {
      this.contacts[i].getWorldPosition(v);
      if (v.y < lowest) lowest = v.y;
    }
    if (!isFinite(lowest)) return;
    var d = this.floorY - lowest;
    if (Math.abs(d) > 1e-4) {
      this.group.position.y += d;
      this.group.updateMatrixWorld(true);
    }
  };

  /* ---------------- アニメーション ---------------- */

  /** ぎこちなさ: 時間を非線形に歪める（等速で動かない） */
  function jerk(t) {
    return t + 0.085 * Math.sin(t * 2 * Math.PI * 2) + 0.035 * Math.sin(t * 2 * Math.PI * 5 + 1.1);
  }

  Enemy.prototype._walkPose = function (p, time) {
    var cyc = 2.35;                         /* ゆっくり */
    var ph = jerk((time % cyc) / cyc) * Math.PI * 2;
    var s = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
    var lift = function (v) { return Math.max(0, v); };
    /* 脚: 逆関節なので膝は後ろへ、着地でつま先から */
    p.hipL[0] += s * 0.46;
    p.kneeL[0] += -lift(s) * 0.55 - 0.10;
    p.ankL[0] += lift(-s) * 0.30 + s * 0.12;
    p.hipR[0] += s2 * 0.46;
    p.kneeR[0] += -lift(s2) * 0.55 - 0.10;
    p.ankR[0] += lift(-s2) * 0.30 + s2 * 0.12;
    /* 腰の上下・左右の揺れ */
    p.hipY += -0.035 + 0.030 * Math.cos(ph * 2);
    p.body[2] += 0.055 * s;
    p.body[0] += 0.045 * Math.cos(ph * 2);
    p.roll[1] += 0.10 * s;
    /* 腕: 逆位相でだらりと振れる（振り遅れ） */
    p.shL[0] += s2 * 0.30;
    p.shL[2] += 0.06 * s;
    p.elbL[0] += 0.20 + lift(s2) * 0.22;
    p.shR[0] += s * 0.30;
    p.shR[2] += -0.06 * s;
    p.elbR[0] += 0.18 + lift(s) * 0.20;
    /* 首・頭: たまに引き攣る */
    var tw = Math.max(0, Math.sin(time * 0.83) - 0.94) * 16;
    p.neck[1] += 0.10 * Math.sin(ph * 0.5) + tw * 0.22;
    p.head[2] += 0.05 * s + tw * 0.18;
    p.head[0] += 0.04 * Math.cos(ph);
  };

  Enemy.prototype._chasePose = function (p, time) {
    var cyc = 0.46;                          /* 速い */
    var ph = (time % cyc) / cyc * Math.PI * 2;
    var s = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
    var lift = function (v) { return Math.max(0, v); };
    /* 対角の四肢が組になって跳ねる（肘・膝が胴より高く跳ね上がる） */
    p.shL[0] += -lift(s) * 0.70 + 0.10 * s;
    p.elbL[0] += lift(s) * 0.55;
    p.wrL[0] += -lift(s) * 0.30;
    p.shR[0] += -lift(s2) * 0.70 + 0.10 * s2;
    p.elbR[0] += lift(s2) * 0.55;
    p.wrR[0] += -lift(s2) * 0.30;
    p.hipL[0] += lift(s2) * 0.60 - 0.08;
    p.kneeL[0] += -lift(s2) * 0.42;
    p.ankL[0] += lift(s2) * 0.24;
    p.hipR[0] += lift(s) * 0.60 - 0.08;
    p.kneeR[0] += -lift(s) * 0.42;
    p.ankR[0] += lift(s) * 0.24;
    /* 胴のうねり・上下動 */
    p.hipY += 0.055 * Math.abs(Math.sin(ph));
    p.body[0] += 0.10 * Math.sin(ph * 2);
    p.spine[0] += 0.08 * Math.sin(ph * 2 + 0.6);
    p.chest[1] += 0.10 * s;
    /* 頭は固定して正面を睨む（揺れない＝不気味） */
    p.neck[0] += -0.05 * Math.sin(ph * 2);
    p.head[1] += 0.05 * s;
  };

  /** 形態遷移（直立→後ろへ倒れ込んで反転）。契約: 2秒以内 */
  Enemy.prototype._transPose = function (p, u, raw) {
    /* 落下アーク: 前半で背中から落ち、後半でブリッジに持ち上がる */
    var fall = Math.sin(Math.min(1, raw * 1.35) * Math.PI);
    p.hipY -= fall * 0.34;
    p.body[0] -= fall * 0.55;                 /* 倒れ込みの行き過ぎ */
    /* 腕を跳ね上げて受け身 */
    var flail = Math.sin(Math.min(1, raw * 1.9) * Math.PI);
    p.shL[0] -= flail * 1.10; p.shL[2] += flail * 0.5;
    p.shR[0] -= flail * 1.05; p.shR[2] -= flail * 0.45;
    p.elbL[0] += flail * 0.5; p.elbR[0] += flail * 0.5;
    /* 首は最後まで正面を保つ（顔だけこちらを向いたまま倒れる）。
       首を実長で通したぶん、落下の谷で顎が床を割りやすい。首を起こして
       head で同量戻す＝顔の向きは据え置きのまま、頭の通る高さだけ上げる。 */
    p.neck[0] += fall * 0.10;
    p.head[0] -= fall * 0.45;
    /* 膝が跳ねる */
    p.kneeL[0] -= flail * 0.35; p.kneeR[0] -= flail * 0.30;
  };

  Enemy.prototype.update = function (dt, time) {
    if (!isFinite(dt)) dt = 0;
    this.animTime = (typeof time === 'number') ? time : (this.animTime + dt);
    var raw = 0, inTrans = false;
    if (this.state === 'trans') {
      this.transTime += dt;
      var u0 = Math.min(1, this.transTime / this.transDur);
      raw = u0;
      inTrans = true;
      /* ease: 前半ゆっくり傾いて、後半で一気に落ちる */
      var e = u0 < 0.42 ? (u0 / 0.42) * 0.22 : 0.22 + Math.pow((u0 - 0.42) / 0.58, 0.65) * 0.78;
      this.poseT = (this.transDir > 0) ? e : (1 - e);
      if (u0 >= 1) {
        this.poseT = (this.transDir > 0) ? 1 : 0;
        this.state = (this.transDir > 0) ? 'chase' : 'walk';
      }
    }
    var self = this, t = this.animTime;
    var st = this.state;
    this.applyPose(this.poseT, function (p, u) {
      /* 呼吸（常時） */
      p.spine[0] += 0.012 * Math.sin(t * 1.35);
      p.chest[0] += 0.010 * Math.sin(t * 1.35 + 0.7);
      if (st === 'walk') self._walkPose(p, t);
      else if (st === 'chase') self._chasePose(p, t);
      else if (inTrans) {
        if (self.transDir > 0 && u < 0.5) self._walkPose(p, t);
        self._transPose(p, u, raw);
      }
      /* P4.6: 演出側の姿勢上書き口。ここで足さないと applyPose に消される
         （「Aが設定→Bの毎フレーム更新が上書き」型の事故の防止） */
      if (self.poseExtra) self.poseExtra(p, u, t);
    });
    this._drape(t, st);
  };

  /* ---------------- 垂れ物（髪・スカート）の重力合わせ ----------------
   * スカートは「ローカル -Y ＝ 垂れる向き」で作ってあるので、毎フレーム
   * その -Y を world の重力方向へ向け直し、丈も高さに合わせて詰める。
   * 髪は根元まわりの回転で揺らし、反転形態でだけ床抜けぶんを縮める。
   */
  var NEG_Y = new THREE.Vector3(0, -1, 0);
  var _dDir = new THREE.Vector3();
  var _dMat = new THREE.Matrix4();
  var _dQ = new THREE.Quaternion();
  var _dQ2 = new THREE.Quaternion();
  var _dEul = new THREE.Euler();
  var _dPos = new THREE.Vector3();
  var _dB = new THREE.Vector3();

  /** node のローカル -Y を world 方向 dir へ向ける（＋微小な揺れを乗せる） */
  Enemy.prototype._aimDown = function (node, dir, sx, sy, sz) {
    _dMat.copy(node.parent.matrixWorld).invert();
    _dDir.copy(dir).transformDirection(_dMat).normalize();
    _dQ.setFromUnitVectors(NEG_Y, _dDir);
    if (sx || sy || sz) {
      _dEul.set(sx || 0, sy || 0, sz || 0);
      _dQ.multiply(_dQ2.setFromEuler(_dEul));
    }
    node.quaternion.copy(_dQ);
  };

  Enemy.prototype._drape = function (t, st) {
    var pt = this.poseT;
    /* 後方（顔の向きの反対）。反転形態では髪と裾がここへ流れる */
    var bx = Math.sin(this.facing), bz = Math.cos(this.facing);

    /* --- 髪（根元まわりの回転の揺れ。房は頭皮に沿って生えているので離れない） ---
     * 反転形態では頭が床すれすれなので、束を後方へ流して引きずらせたうえで、
     * 毛先が床を抜けるぶんだけ房を縮める（縮小は反転側でしか起きない）。 */
    var hsway = (st === 'chase') ? 0.22 : 0.07;
    var trail = -0.10 - 1.05 * pt;
    var hpw = this.hairParent ? this.hairParent.matrixWorld : null;
    for (var i = 0; i < this.hairPivots.length; i++) {
      var hp = this.hairPivots[i];
      var tk = hp.trailK === undefined ? 1 : hp.trailK;
      hp.node.rotation.x = hp.base.x + trail * tk
        + hsway * tk * Math.sin(t * (1.4 + hp.k) + hp.phase) * 0.5;
      hp.node.rotation.z = hp.base.z + hsway * tk * 0.4 * Math.sin(t * (1.1 + hp.k * 0.7) + hp.phase * 1.7);
      /* 床抜けクランプ: 直立形態では余裕があるので必ず等倍＝rework2 と同一の見え方 */
      var s = 1;
      if (pt > 0.001 && hpw) {
        hp.node.scale.set(1, 1, 1);
        hp.node.updateMatrix();
        _dMat.multiplyMatrices(hpw, hp.node.matrix);
        var rootY = _dMat.elements[13];
        var tipY = _dPos.copy(hp.tip).applyMatrix4(_dMat).y;
        var drop = rootY - tipY;
        var hroom = rootY - this.floorY - 0.04;
        if (drop > 1e-4 && tipY < this.floorY + 0.04) s = clamp(hroom / drop, 0.30, 1);
      }
      hp.node.scale.set(s, s, s);
    }

    /* --- スカート --- */
    if (!this.skirtRoot) return;
    var swing = (st === 'walk') ? 0.055 * Math.sin(t / 2.35 * Math.PI * 2)
      : (st === 'chase' ? 0.09 * Math.sin(t / 0.46 * Math.PI * 2) : 0);
    this.skirtRoot.getWorldPosition(_dPos);
    var room = _dPos.y - this.floorY;
    /* 裾は姿勢で詰める（布が床に溜まる見え方）。向きも高さに応じて寝かせる */
    var sc = clamp((room - 0.05) / this.skirtReach, 0.22, 1);
    this.skirtRoot.scale.y = sc;
    /* 丈は sc で合わせてあるので、向きは真下＋僅かな後方への流れでよい */
    var sdrag = 0.05 + 0.55 * pt;
    var sd = _dB.set(bx * sdrag, -1, bz * sdrag).normalize();
    this._aimDown(this.skirtRoot, sd, swing, 0, swing * 0.6);
  };

  /* ---------------- 照明整合 ---------------- */

  /**
   * 「今いるマスの床の明るさ」をサンプルして全体の明度に乗せる。
   * world._shade は焼き込みと同じ式なので、環境と同じ光量に乗る。
   */
  Enemy.prototype.syncLight = function (world, map) {
    var r = 0.02, g = 0.02, b = 0.03;
    if (world && world.lightIndex && world._shade) {
      var col = map ? map.colOf(this.x) : 0, row = map ? map.rowOf(this.z) : 0;
      var key = world._ownerOf ? world._ownerOf(col, row) : (col + ',' + row);
      var out = world._shade(this.x, this.floorY + 0.10, this.z, 0, 1, 0, key, undefined, this._shadeOut);
      r = out[0]; g = out[1]; b = out[2];
    }
    this._amb.r = r; this._amb.g = g; this._amb.b = b;
    var lum = 0.30 * r + 0.59 * g + 0.11 * b;
    /* 色味は環境光の色に寄せる（非常灯の赤区画では赤く沈む） */
    var mx = Math.max(r, Math.max(g, b)) + 1e-5;
    var tr = 0.55 + 0.45 * (r / mx), tg = 0.55 + 0.45 * (g / mx), tb = 0.55 + 0.45 * (b / mx);

    var cine = this.detailHi;
    var fmin = cine ? FACE_MIN_CINE : FACE_MIN, fmax = cine ? FACE_MAX_CINE : FACE_MAX;
    var tmin = cine ? TOOTH_MIN_CINE : TOOTH_MIN, tmax = cine ? TOOTH_MAX_CINE : TOOTH_MAX;
    var kb = clamp(BODY_MIN + lum * BODY_GAIN, BODY_MIN, BODY_MAX);
    var kf = clamp(fmin + lum * FACE_GAIN, fmin, fmax);
    /* 顔の微発光をごく緩く脈打たせる（生きているように見せる） */
    kf *= 0.94 + 0.06 * Math.sin(this.animTime * 0.9);
    var kc = clamp(CLOTH_MIN + lum * CLOTH_GAIN, CLOTH_MIN, 0.92);
    var kh = clamp(HAIR_MIN + lum * HAIR_GAIN, HAIR_MIN, HAIR_MAX);
    var kt = clamp(tmin + lum * TOOTH_GAIN, tmin, tmax);
    var kv = clamp(VOID_MIN + lum * VOID_GAIN, VOID_MIN, VOID_MAX);

    this.mats.skin.color.setRGB(kb * tr, kb * tg, kb * tb);
    this.mats.dark.color.setRGB(kb * tr, kb * tg, kb * tb);
    this.mats.cloth.color.setRGB(kc * tr, kc * tg, kc * tb);
    this.mats.hair.color.setRGB(kh * tr, kh * tg, kh * tb);
    this.mats.tooth.color.setRGB(kt * tr, kt * tg, kt * tb);
    /* 眼窩と口腔は環境が明るくてもほぼ黒のまま（覗いた先は闇） */
    this.mats.hollow.color.setRGB(kv, kv, kv);
    /* 顔は環境色に引きずられ過ぎないよう白寄りに */
    this.mats.head.color.setRGB(kf * (0.72 + 0.28 * tr), kf * (0.72 + 0.28 * tg), kf * (0.72 + 0.28 * tb));
  };

  /* ---------------- 配置 ---------------- */

  Enemy.prototype.placeAt = function (x, z, yawRad, map) {
    this.x = x; this.z = z;
    this.floorY = map ? map.floorYAt(x, z) : 0;
    if (typeof yawRad === 'number') this.facing = yawRad;
    this.applyPose(this.poseT);
  };

  Enemy.prototype.placeCell = function (col, row, yawDeg, map) {
    var c = map.cellCenter(col, row);
    this.placeAt(c.x, c.z, (yawDeg || 0) * Math.PI / 180, map);
  };

  Enemy.prototype.setForm = function (form, instant) {
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

  Enemy.prototype.dispose = function () {
    for (var i = 0; i < this.disposables.length; i++) {
      var d = this.disposables[i];
      if (d && d.dispose) d.dispose();
    }
    this.disposables.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  };

  /* ================================================================
   * P4.6 捕獲演出むけの造形API（契約 §4「捕獲演出と駆け引き」）
   *
   *  setDetail('hi'|'normal') … 演出中だけ顔を高密度メッシュ＋2048テクスチャへ差し替え、
   *                             眼窩の奥に赤い目（微発光）を灯す。normal で必ず元へ戻る。
   *  createGrabHands()        … 一人称視界に持ち込む敵の手（左右一対・camera空間に置く）
   *  createMaw()              … 「食われる」用の口（歯列で画面を覆う。開き具合は setOpen(u)）
   *
   * 上書き事故の防止: 赤い目・手・口は専用マテリアルを持ち、syncLight は触らない。
   * ============================================================== */

  /* 通常は 48x46。演出中のみこの密度（契約の三角形予算 +8000 以内に収める実測値。
     食われる演出では顔＋赤い目＋手＋口が同時に出るので、その合計で 8000 を超えないこと） */
  var HI_SKULL_RS = 70, HI_SKULL_HS = 66;

  /** 赤い目（眼窩の底に置く芯＋加算合成のハロー）。最初の演出時に1度だけ作る */
  Enemy.prototype._buildRedEyes = function () {
    if (this.eyes) return this.eyes;
    this._countExtra = true;
    this.matEyeCore = this._track(new THREE.MeshBasicMaterial({
      color: 0xa8180e, fog: true, depthWrite: true
    }));
    this.matEyeGlow = this._track(new THREE.MeshBasicMaterial({
      color: 0x6e0a05, fog: true, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    this.eyes = new THREE.Group();
    this.eyes.name = 'redEyes';
    this.eyes.visible = false;
    var pt = [0, 0, 0, 0, 0];
    for (var i = 0; i < SOCK.length; i++) {
      var s = SOCK[i];
      /* 眼窩は「真後ろへ」彫ってあるので、その底の点を引いて少しだけ手前へ戻す
         ＝ 奥から覗いている見え方になり、斜めからは眼窩の縁に隠れる */
      headSurfaceAtXY(s[0], s[1], 0, pt);
      var node = new THREE.Group();
      /* 眼窩の底からほんの数ミリだけ手前。奥に沈めておかないと
         「顔に貼った赤い丸」になる（契約は“眼窩の奥から覗く微発光”） */
      node.position.set(pt[0], pt[1], pt[2] - 0.0055);
      var rr = 0.0072 - i * 0.0005;                 /* 左右非対称（契約 §4） */
      var core = this._mesh(sphereGeo(rr, 10, 8), this.matEyeCore, node, 'eyeCore');
      core.renderOrder = 4;
      var glow = this._mesh(sphereGeo(rr * 1.75, 8, 6), this.matEyeGlow, node, 'eyeGlow');
      glow.renderOrder = 5;
      this.eyes.add(node);
    }
    this.headScale.add(this.eyes);
    this._countExtra = false;
    return this.eyes;
  };

  /** 捕獲演出中だけの高解像度化。'hi' / 'normal'（true / false も可） */
  Enemy.prototype.setDetail = function (level) {
    var hi = (level === 'hi' || level === true);
    if (hi === this.detailHi) return this.detailHi;
    if (hi) {
      if (!this._hiGeo) {
        var g2 = skullGeo(HI_SKULL_RS, HI_SKULL_HS);
        /* 焼き込みは通常版と同一の光源設定（＝同じ存在の高精細版に見えること） */
        bakeShade(g2, {
          base: [1, 1, 1], amb: 0.26, key: 0.84, fill: 0.10, keyPow: 1.25, occ: g2.userData.occ,
          keyDir: new THREE.Vector3(0.14, -0.10, -0.99).normalize(),
          fillDir: new THREE.Vector3(-0.50, -0.34, -0.80).normalize()
        });
        this._track(g2);
        this._hiGeo = g2;
        this._hiTex = tex('headHi');
        this._hiTris = (g2.index.count - this._loGeo.index.count) / 3;
      }
      this.faceMesh.geometry = this._hiGeo;
      this.mats.head.map = this._hiTex;
      this.mats.head.needsUpdate = true;
      this._buildRedEyes().visible = true;
    } else {
      this.faceMesh.geometry = this._loGeo;
      this.mats.head.map = this._loTex;
      this.mats.head.needsUpdate = true;
      if (this.eyes) this.eyes.visible = false;
    }
    this.detailHi = hi;
    return hi;
  };

  /** 赤い目が出ているか（機械テスト用。演出外で true になってはいけない） */
  Enemy.prototype.redEyesVisible = function () {
    return !!(this.eyes && this.eyes.visible && this.detailHi);
  };

  /** いま描かれている三角形数（演出パーツを含む） */
  Enemy.prototype.activeTriangles = function () {
    var n = this.triangles;
    if (this.detailHi) n += (this._hiTris || 0);
    if (this.eyes && this.eyes.visible) n += 2 * (10 * 8 * 2 + 8 * 6 * 2);
    if (this.grabHands && this.grabHands.visible) n += this._handTris || 0;
    if (this.maw && this.maw.group.visible) n += this._mawTris || 0;
    return n;
  };

  /** 赤い目の微発光を脈打たせる（演出中のみ呼ばれる） */
  Enemy.prototype.pulseEyes = function (t, k) {
    if (!this.eyes || !this.eyes.visible) return;
    var a = 0.72 + 0.28 * Math.sin(t * 2.6) * Math.sin(t * 1.13 + 0.6);
    a *= (k === undefined ? 1 : k);
    this.matEyeCore.color.setRGB(0.62 * a, 0.055 * a, 0.030 * a);
    this.matEyeGlow.opacity = 0.10 + 0.16 * a;
  };

  /** -Y に伸びるパーツを from→to へ向ける（長さも返す） */
  var _aimA = new THREE.Vector3(), _aimB = new THREE.Vector3(0, -1, 0);
  function aimNode(node, fx, fy, fz, tx, ty, tz) {
    node.position.set(fx, fy, fz);
    _aimA.set(tx - fx, ty - fy, tz - fz);
    var len = _aimA.length() || 1e-4;
    _aimA.multiplyScalar(1 / len);
    node.quaternion.setFromUnitVectors(_aimB, _aimA);
    return len;
  }

  /**
   * 首を掴む手（一人称視界用）。camera 空間（-Z が前方）にそのまま置ける。
   * 前腕は画面の下隅から入り、手のひらは画面下中央（＝首の位置）で握る。
   */
  Enemy.prototype.createGrabHands = function () {
    if (this.grabHands) return this.grabHands;
    var self = this;
    var SKIN2 = [0.86, 0.85, 0.80];
    this._countExtra = true;
    var t0 = this.extraTriangles;
    var root = new THREE.Group();
    root.name = 'grab-hands';
    root.visible = false;

    function finger(parent, px, py, pz, rx, ry, rz, len, r0) {
      var g1 = new THREE.Group();
      g1.position.set(px, py, pz);
      g1.rotation.set(rx, ry, rz);
      parent.add(g1);
      self._mesh(bakeShade(revolve(len, 5, 2, function (t) { return { r: r0 - 0.004 * t }; }, 1, 0.4),
        { base: SKIN2, amb: 0.30, key: 0.62 }), self.mats.skin, g1, 'gPhal1');
      var g2 = new THREE.Group();
      g2.position.set(0, -len, 0);
      g2.rotation.x = 1.05;                       /* 第2関節で強く曲げる＝掴んでいる */
      g1.add(g2);
      self._mesh(bakeShade(revolve(len * 0.80, 5, 2, function (t) { return { r: r0 * 0.86 - 0.004 * t }; }, 1, 0.4),
        { base: SKIN2, amb: 0.30, key: 0.62 }), self.mats.skin, g2, 'gPhal2');
      var g3 = new THREE.Group();
      g3.position.set(0, -len * 0.80, 0);
      g3.rotation.x = 0.95;
      g2.add(g3);
      self._mesh(bakeShade(revolve(len * 0.58, 4, 1, function (t) { return { r: r0 * 0.70 - 0.004 * t }; }, 1, 0.4),
        { base: [0.80, 0.78, 0.72], amb: 0.30, key: 0.62 }), self.mats.skin, g3, 'gPhal3');
      return g1;
    }

    /* sx = +1 が画面右。前腕は画面の下隅から入り、手は画面下寄りで首を握る。
       ローカル空間 = camera 空間（-Z が前方）なので、寸法はそのまま画角に効く。 */
    function hand(sx, name) {
      var arm = new THREE.Group();
      arm.name = name;
      root.add(arm);
      var hx = sx * 0.190, hy = -0.250, hz = -0.480;   /* 手のひらの位置（画面の下端寄り） */
      var fore = new THREE.Group();
      var len = aimNode(fore, sx * 0.620, -0.600, -0.900, hx, hy, hz);
      arm.add(fore);
      self._mesh(bakeShade(limbGeo(len, 0.058, 0.047, 0.034, 8, 0.92, -0.012), {
        base: SKIN2, amb: 0.26, key: 0.66,
        grad: function (y) { return 0.62 + 0.38 * Math.min(1, (-y) / (len * 0.5) + 0.35); }
      }), self.mats.skin, fore, 'gForearm');
      /* 袖の襤褸（前腕の付け根） */
      self._mesh(bakeShade(revolve(0.18, 8, 3, function (t) {
        return { r: 0.070 + 0.030 * t };
      }, 1, 1), { base: [0.40, 0.41, 0.36], amb: 0.34, key: 0.34 }), self.mats.cloth, fore, 'gSleeve');
      /* 手首から先は arm 直下に置く（＝camera 空間で向きを決められる）。
         指は内側かつ上へ伸ばす＝首を握り込んだ手の甲がこちらを向く。 */
      var wr = new THREE.Group();
      aimNode(wr, hx, hy, hz, hx - sx * 0.45, hy + 0.80, hz + 0.05);
      wr.scale.setScalar(0.92);
      arm.add(wr);
      self._mesh(bakeShade(revolve(0.105, 7, 2, function (t) {
        return { r: 0.044 - 0.005 * t, sx: 1.50, sz: 0.68 };
      }, 1, 0.4), { base: SKIN2, amb: 0.30, key: 0.64 }), self.mats.skin, wr, 'gPalm');
      for (var f = 0; f < 4; f++) {
        finger(wr, (f - 1.5) * 0.032 * -sx, -0.094, 0.004,
          0.34 + f * 0.05, (f - 1.5) * 0.10, 0, 0.072 + (1.5 - Math.abs(f - 1.5)) * 0.012, 0.0155);
      }
      /* 親指は反対側から回り込む */
      finger(wr, sx * 0.052, -0.038, 0.028, 0.55, 0, -sx * 1.15, 0.064, 0.0170);
      return arm;
    }
    this.handL = hand(-1, 'grabHandL');
    this.handR = hand(1, 'grabHandR');
    this.grabHands = root;
    this._handTris = this.extraTriangles - t0;
    this._countExtra = false;
    return root;
  };

  /**
   * 「食われる」用の口。camera 空間に置いて拡大すると歯列が画面を覆う。
   * 単位系: 口の半幅 = 1.0。上下の顎が u（0..1）で開く。
   */
  Enemy.prototype.createMaw = function () {
    if (this.maw) return this.maw;
    var self = this;
    this._countExtra = true;
    var t0 = this.extraTriangles;
    var root = new THREE.Group();
    root.name = 'maw';
    root.visible = false;
    var upper = new THREE.Group(); upper.name = 'mawUpper'; root.add(upper);
    var lower = new THREE.Group(); lower.name = 'mawLower'; root.add(lower);

    /* 喉の闇（奥へすぼまる袋）。手前は開いたまま＝カメラを飲み込む */
    var gullet = new THREE.Group();
    root.add(gullet);
    self._mesh(bakeShade(revolve(2.10, 16, 5, function (t) {
      return { r: 1.34 * (1 - 0.74 * t * t), sx: 1.0, sz: 0.78 };
    }, 1, 1, true), { base: [0.06, 0.045, 0.045], amb: 0.30, key: 0.10 }), self.mats.hollow, gullet, 'gullet');
    gullet.rotation.x = -Math.PI / 2;            /* -Y方向の袋を -Z（奥）へ倒す */

    /* 歯列: 楕円弧に沿って1本ずつ植える（お面の絵ではなく実ジオメトリ） */
    function row(parent, up, n, seed) {
      var rr = rngOf(seed);
      var gum = self._mesh(bakeShade(revolve(0.30, 16, 2, function (t) {
        return { r: 1.06 - 0.06 * t, sx: 1.0, sz: 0.66 };
      }, 1, 1, true), { base: [0.30, 0.14, 0.14], amb: 0.34, key: 0.30 }), self.mats.hollow, parent, 'gum');
      gum.rotation.x = up ? Math.PI : 0;
      gum.position.y = up ? 0.04 : -0.04;
      for (var i = 0; i < n; i++) {
        var a = (i + 0.5) / n * Math.PI - Math.PI / 2;      /* 前方の弧だけ */
        var len = (0.20 + rr() * 0.20) * (up ? 1.05 : 0.92);
        var w = 0.055 + rr() * 0.045;
        var g1 = new THREE.Group();
        g1.position.set(Math.sin(a) * 1.00, up ? 0.02 : -0.02, -Math.cos(a) * 0.64);
        g1.rotation.set((up ? 1 : -1) * (0.16 + rr() * 0.22), -a, (rr() - 0.5) * 0.22);
        parent.add(g1);
        if (rr() < 0.12) continue;                          /* 欠損（不揃いの歯列） */
        var geo = revolve(up ? len : -len, 5, 2, function (t) {
          return { r: w * (1 - 0.72 * t) };
        }, 1, 0.5);
        var sh = 0.46 + rr() * rr() * 0.54;
        bakeShade(geo, { base: [sh, sh * 0.97, sh * 0.84], amb: 0.42, key: 0.52 });
        self._mesh(geo, self.mats.tooth, g1, 'mawTooth');
      }
    }
    row(upper, true, 15, 4801);
    row(lower, false, 13, 9109);

    var maw = {
      group: root,
      setOpen: function (u) {
        /* 0=閉じ 1=大きく開く。噛み合わせの回転軸は口の奥（+Z 側） */
        upper.rotation.x = -0.06 - 0.72 * u;
        lower.rotation.x = 0.06 + 0.62 * u;
        upper.position.y = 0.05 + 0.30 * u;
        lower.position.y = -0.05 - 0.26 * u;
      }
    };
    maw.setOpen(0);
    this.maw = maw;
    this._mawTris = this.extraTriangles - t0;
    this._countExtra = false;
    return maw;
  };

  ESCAPE.Enemy = Enemy;
  ESCAPE.EnemyPoses = { stand: POSE_STAND, crawl: POSE_CRAWL };

  /* ================================================================
   * デバッグ配置（P3a: AIなし・その場アニメ。既定は非表示）
   *  ?enemy=1 で自動表示。ゲームプレイには影響させない。
   * ============================================================== */
  function install() {
    var g = ESCAPE.game;
    if (!g) return;
    var enemy = null;

    /* P3b: 敵AIが実体を持つならそれを操作対象にする（デバッグ用の2体目は作らない）。
       AIが握ったままだと毎フレームの更新でポーズ指定が上書きされるので、
       モデルを直接いじるフックは manual=true にしてAIの駆動を止める。 */
    function ai() {
      var gg = ESCAPE.game;
      return (gg && gg.ai && gg.ai.enemy) ? gg.ai : null;
    }
    function detach() {
      var a = ai();
      if (a) { a.manual = true; return a.enemy; }
      return null;
    }
    function ensure() {
      var a = ai();
      if (a) return a.enemy;
      if (enemy) return enemy;
      enemy = new Enemy({ seed: 3 });
      g.scene.add(enemy.group);
      enemy.group.visible = false;
      /* 既定位置: 北の縦長廊下（天井4.3m・2.4mの直立形態が収まる） */
      enemy.placeCell(34, 24, 180, g.map);
      enemy.state = 'walk';
      return enemy;
    }

    /* ゲームループに相乗り（stepFrame をラップ＝__pump でも同じ絵になる） */
    var origStep = g.stepFrame;
    g.stepFrame = function (dt) {
      origStep.call(this, dt);
      /* AIが持つ個体は AI 側が更新する（二重更新＝アニメ上書きを避ける） */
      if (enemy && enemy.group.visible && !(this.ai && this.ai.enemy === enemy)) {
        enemy.update(dt, this.simTime);
        enemy.syncLight(this.world, this.map);
      }
    };

    global.__enemyDebug = {
      /** 生成して表示/非表示 */
      show: function (v) {
        var e = ensure();
        e.group.visible = (v === undefined) ? true : !!v;
        if (e.group.visible) { e.update(0, g.simTime); e.syncLight(g.world, g.map); }
        return e.group.visible;
      },
      /** 形態を直接指定（0=直立 1=反転、中間可）。遷移アニメは止める */
      setPose: function (t) {
        var e = ensure(); detach();
        e.state = (t >= 0.5) ? 'chase' : 'walk';
        if (t > 0 && t < 1) e.state = 'idle';
        e.poseT = Math.max(0, Math.min(1, t));
        e.update(0, g.simTime);
        return e.poseT;
      },
      /** 直立形態の歩行アニメ on/off */
      walk: function (on) {
        var e = ensure(); detach();
        if (on === false) { e.state = 'idle'; return e.state; }
        e.poseT = 0; e.state = 'walk';
        return e.state;
      },
      /** 反転形態の疾走アニメ on/off */
      chase: function (on) {
        var e = ensure(); detach();
        if (on === false) { e.state = 'idle'; return e.state; }
        e.poseT = 1; e.state = 'chase';
        return e.state;
      },
      /** 形態遷移を開始（引数なし=現在の逆へ） */
      transition: function (to) {
        var e = ensure(); detach();
        var want = (to === undefined) ? (e.poseT < 0.5 ? 1 : 0) : ((to === 'crawl' || to === 1) ? 1 : 0);
        e.setForm(want ? 'crawl' : 'stand', false);
        return { dir: e.transDir, dur: e.transDur };
      },
      /** マス指定で配置 */
      place: function (col, row, yawDeg) {
        var e = ensure(); detach();
        e.placeCell(col, row, yawDeg === undefined ? 180 : yawDeg, ESCAPE.game.map);
        return { x: e.x, z: e.z, y: e.floorY };
      },
      /** AIへ操作を返す（デバッグで握った後の復帰） */
      release: function () {
        var a = ai();
        if (a) { a.manual = false; a.path = null; a.repathT = 0; }
        return !!a;
      },
      /** 状態の読み出し（検証用） */
      info: function () {
        var e = ensure();
        var b = new THREE.Box3().setFromObject(e.group);
        return {
          triangles: e.triangles,
          poseT: e.poseT, state: e.state, visible: e.group.visible,
          x: e.x, z: e.z, floorY: e.floorY, rootY: e.group.position.y,
          ambient: [e._amb.r, e._amb.g, e._amb.b],
          bboxMinY: b.min.y, bboxMaxY: b.max.y,
          height: b.max.y - b.min.y
        };
      },
      /** 内部参照（微調整用） */
      get: function () { return ensure(); }
    };

    var q = global.location && global.location.search;
    if (q && /[?&]enemy=1/.test(q)) global.__enemyDebug.show(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(window);
