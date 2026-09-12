/* ESCAPE — P4.17 段階2「質感と光」: 描画品質の段階と機構
 * 契約 DESIGN.md §3「陰影・質感の基準」／「P4.17 再プレイ差し戻し」項目3 段階2。
 *
 * 採用したのは段階1の系統Y（法線マップ＋粗さ＋近傍灯の MeshStandardMaterial）。
 * 系統Z（後処理: ACES・露出・色被り・粒子）を同梱し、系統X（テクセル・ライトマップ）は
 * 退避先（fallback）として残す。
 *
 * 品質段階（URL `?q=high|mobile|fallback|off` で強制可）
 *   high     PC既定。法線マップ 1/2 解像度・近傍6灯・解像度倍率上限2。
 *   mobile   iOS/Android既定。解像度倍率 1.0〜1.5・近傍4灯・法線マップ 1/4 解像度。
 *   fallback 系統X（ライトマップ）＋Z。動的ライト無し。退避先。
 *   off      P4.16 までの見た目（焼き込みのみ・後処理なし）。監査と緊急退避用。
 *
 * 自動退避（契約 段階2-2）
 *   直近5秒のフレーム時間の中央値が 20ms を超える窓を2回連続で観測したら
 *   mobile -> fallback へ落とし、HUD に一度だけ `描画を軽量モードに切り替えた` と出す。
 *   セッション内では戻さない。フレーム時間は sampleFrame() で注入できる（機械テスト）。
 *   **退避は即時に行う（世界の作り直しをしない）**: テクセル・ライトマップの焼きは
 *   数秒かかるため、走っている最中に固まらせない。退避の中身は
 *   「大面を焼き込み専用の素材へ戻す＋動的ライトを消す＋解像度倍率を下げる」で、
 *   テクセル・ライトマップは次に世界を組み直す時（＝再読み込み）から効く。
 *
 * 系統Yの弱点（段階1の報告）への対処
 *   ① 什器・小道具・掲示板は焼き込みのまま。ただし焼き込み側の減衰を近傍灯と同じ
 *      二乗則に混ぜて再較正する（world.js の Y_MIX）。大面も焼き込みを Y_MIX だけ残し、
 *      残りを実ライトが載せる＝灯が入れ替わっても黒く抜けない・遠景が今までどおり。
 *   ② 近傍灯の入れ替えは 0.3秒のフェード（LightRig）。
 *   ③ 大面の法線は格子の中心差分＋角度しきい値つきスムージング（world.js）。
 *   ④ 法線生成はアルベドの**高周波成分だけ**を高さに使う（汚れのシミを凹ませない）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE || (global.ESCAPE = {});

  function qget(k) {
    var m = new RegExp('[?&]' + k + '=([^&]*)').exec(global.location.search || '');
    return m ? decodeURIComponent(m[1]) : null;
  }
  function qnum(k, dflt) {
    var v = parseFloat(qget(k));
    return isFinite(v) ? v : dflt;
  }

  /* ---------------- 品質段階 ---------------- */

  /* exposure は §3 の輝度ゲート（暗部35〜65%・中間調≥20%・白飛<3%）を
   * 3視点とも満たすように段階ごとに較正した値（2026-09-12 実測）。
   * 灯の本数が減るぶん mobile は少し明るく、焼き込みが全量載る fallback は暗くする。 */
  var TIERS = {
    high: { y: true, x: false, post: true, lights: 6, normalDiv: 2, dpr: 2.0, exposure: 1.58 },
    mobile: { y: true, x: false, post: true, lights: 4, normalDiv: 4, dpr: 1.5, exposure: 1.70 },
    fallback: { y: false, x: true, post: true, lights: 0, normalDiv: 0, dpr: 1.25, exposure: 1.38 },
    off: { y: false, x: false, post: false, lights: 0, normalDiv: 0, dpr: 2.0, exposure: 1.0 }
  };

  /**
   * 端末判定（純関数＝機械テストが値を入れて確かめられる）。
   *   e.ua        UserAgent 文字列
   *   e.touch     タッチ端末か
   *   e.screenMin 画面の短辺(px)
   *   e.webgl2    WebGL2 が使えるか
   *   e.memory    navigator.deviceMemory（GB・不明なら 0）
   *   e.cores     navigator.hardwareConcurrency（不明なら 0）
   */
  function decideTier(e) {
    if (!e.webgl2) return 'fallback';
    if ((e.memory && e.memory <= 2) || (e.cores && e.cores <= 2)) return 'fallback';
    /* iPadOS 13+ は UA が Macintosh を名乗るのでタッチ点数で見分ける */
    var mobileUA = /iPhone|iPad|iPod|Android/i.test(e.ua || '') ||
      (/Macintosh/.test(e.ua || '') && e.touch);
    var small = !!e.touch && e.screenMin > 0 && e.screenMin <= 900;
    return (mobileUA || small) ? 'mobile' : 'high';
  }
  /** この端末の環境を集める */
  function env() {
    var nav = global.navigator || {};
    return {
      ua: nav.userAgent || '',
      touch: (nav.maxTouchPoints > 0) || ('ontouchstart' in global),
      screenMin: global.screen ? Math.min(screen.width, screen.height) : 0,
      webgl2: typeof global.WebGL2RenderingContext !== 'undefined',
      memory: nav.deviceMemory || 0,
      cores: nav.hardwareConcurrency || 0
    };
  }
  function detectTier() { return decideTier(env()); }

  /* ---------------- 自動退避の監視 ---------------- */

  var WATCH_WINDOW = 5000;   /* 中央値を取る窓(ms) */
  var WATCH_LIMIT = 20;      /* この中央値(ms)を超えたら黒星 */
  var WATCH_STRIKES = 2;     /* 連続で何窓ぶん出たら退避するか */

  /**
   * フレーム時間の窓監視。push(ms, nowMs) を毎フレーム呼ぶと、
   * 窓（5秒）が満ちるたびに中央値を判定し、2窓連続で 20ms 超なら fired=true になる。
   * 純粋なロジック（副作用なし）＝機械テストは new Watch() を作って注入するだけでよい。
   */
  function Watch() {
    this.samples = [];
    this.t0 = null;
    this.strikes = 0;
    this.fired = false;
    this.lastMedian = 0;
    this.windows = 0;
  }
  Watch.prototype.push = function (ms, now) {
    if (this.fired) return false;
    if (!(ms > 0) || !isFinite(ms)) return false;
    if (this.t0 === null) this.t0 = now;
    this.samples.push(ms);
    if (now - this.t0 < WATCH_WINDOW) return false;
    var s = this.samples.slice().sort(function (a, b) { return a - b; });
    var med = s.length ? s[s.length >> 1] : 0;
    this.lastMedian = med;
    this.windows++;
    this.strikes = (med > WATCH_LIMIT) ? (this.strikes + 1) : 0;
    this.samples.length = 0;
    this.t0 = now;
    if (this.strikes >= WATCH_STRIKES) { this.fired = true; return true; }
    return false;
  };

  /* ================================================================
   * 系統X: ライトマップ・アトラス（段階1の試作から移植）
   *  1枚の DataTexture に面ごとの小さなライトマップを敷き詰める。
   *  各タイルは1pxの縁取り（辺の複製）を持つので双線形補間が隣へにじまない。
   *  値は sRGB 伝達関数で符号化（暗部の階調を8bitで保つ）。
   * ============================================================== */
  function LightmapAtlas(size) {
    this.size = size;
    this.data = new Uint8Array(size * size * 4);
    this.px = 1; this.py = 1; this.rowH = 0;
    this.count = 0; this.overflow = 0;
    var W = 4;   /* (0,0) 付近の「白タイル」＝焼かない面はここを指す（＝頂点色そのまま） */
    for (var y = 0; y < W; y++) {
      for (var x = 0; x < W; x++) {
        var o = (y * size + x) * 4;
        this.data[o] = 255; this.data[o + 1] = 255; this.data[o + 2] = 255; this.data[o + 3] = 255;
      }
    }
    this.whiteU = 2 / size; this.whiteV = 2 / size;
    this.px = W + 2;
  }
  LightmapAtlas.prototype.alloc = function (w, h) {
    var need = w + 2, needH = h + 2;
    if (this.px + need > this.size) { this.px = 1; this.py += this.rowH + 1; this.rowH = 0; }
    if (this.py + needH > this.size) { this.overflow++; return null; }
    var r = { x: this.px + 1, y: this.py + 1, w: w, h: h };
    this.px += need;
    if (needH > this.rowH) this.rowH = needH;
    this.count++;
    return r;
  };
  function encSRGB(v) {
    if (!(v > 0)) return 0;
    if (v > 1) v = 1;
    var s = (v <= 0.0031308) ? (v * 12.92) : (1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    return (s * 255 + 0.5) | 0;
  }
  LightmapAtlas.prototype.bake = function (r, fn) {
    var d = this.data, S = this.size, out = [0, 0, 0];
    for (var j = 0; j < r.h; j++) {
      var t = (j + 0.5) / r.h;
      var row = (r.y + j) * S;
      for (var i = 0; i < r.w; i++) {
        fn((i + 0.5) / r.w, t, out);
        var o = (row + r.x + i) * 4;
        d[o] = encSRGB(out[0]); d[o + 1] = encSRGB(out[1]); d[o + 2] = encSRGB(out[2]); d[o + 3] = 255;
      }
    }
    /* 縁取り（辺の複製）。左右 → 上下（角は上下の複製で埋まる） */
    for (var j2 = 0; j2 < r.h; j2++) {
      var rw = (r.y + j2) * S;
      var a = (rw + r.x) * 4, b = (rw + r.x - 1) * 4;
      d[b] = d[a]; d[b + 1] = d[a + 1]; d[b + 2] = d[a + 2]; d[b + 3] = 255;
      var c = (rw + r.x + r.w - 1) * 4, e = (rw + r.x + r.w) * 4;
      d[e] = d[c]; d[e + 1] = d[c + 1]; d[e + 2] = d[c + 2]; d[e + 3] = 255;
    }
    for (var i2 = -1; i2 <= r.w; i2++) {
      var src = ((r.y) * S + r.x + i2) * 4, dst = ((r.y - 1) * S + r.x + i2) * 4;
      d[dst] = d[src]; d[dst + 1] = d[src + 1]; d[dst + 2] = d[src + 2]; d[dst + 3] = 255;
      var src2 = ((r.y + r.h - 1) * S + r.x + i2) * 4, dst2 = ((r.y + r.h) * S + r.x + i2) * 4;
      d[dst2] = d[src2]; d[dst2 + 1] = d[src2 + 1]; d[dst2 + 2] = d[src2 + 2]; d[dst2 + 3] = 255;
    }
  };
  LightmapAtlas.prototype.texture = function () {
    var THREE = global.THREE;
    var t = new THREE.DataTexture(this.data, this.size, this.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.SRGBColorSpace;
    t.channel = 1;                       /* uv1 を使う */
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;    /* アトラスなので mipmap は作らない */
    t.generateMipmaps = false;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };

  /* ================================================================
   * 系統Y: 法線マップ・粗さマップの生成
   *  アルベド（既存のプロシージャル生成物）から作る＝目地・打痕と必ず一致する。
   *  契約 段階2-3 ④: 高さに使うのは**高周波成分だけ**（アルベドから広いぼかしを引く）。
   *  汚れのシミ・錆だれのような低周波の暗さは凹ませない。
   * ============================================================== */
  var MAT_PROFILE = {
    /* height: 法線の強さ, grain: 微細凹凸, rough: [最小, 最大], metal: 金属度 */
    wall: { height: 2.6, grain: 0.55, rough: [0.62, 0.96], metal: 0.03 },
    wall2: { height: 2.6, grain: 0.55, rough: [0.62, 0.96], metal: 0.03 },
    wall3: { height: 2.6, grain: 0.55, rough: [0.62, 0.96], metal: 0.03 },
    wallPaint: { height: 1.5, grain: 0.80, rough: [0.70, 0.98], metal: 0.02 },
    wallMetal: { height: 2.2, grain: 0.45, rough: [0.34, 0.82], metal: 0.55 },
    floor: { height: 2.2, grain: 0.50, rough: [0.55, 0.95], metal: 0.03 },
    floorTile: { height: 3.0, grain: 0.40, rough: [0.40, 0.92], metal: 0.03 },
    floorWet: { height: 1.8, grain: 0.35, rough: [0.18, 0.80], metal: 0.04 },
    floorMetal: { height: 2.6, grain: 0.40, rough: [0.30, 0.80], metal: 0.60 },
    /* 天井は見上げる面積が広く、法線を強くすると紙やすり状に荒れる＝弱める */
    ceiling: { height: 0.9, grain: 0.22, rough: [0.72, 0.98], metal: 0.02 },
    metal: { height: 2.0, grain: 0.40, rough: [0.30, 0.78], metal: 0.62 },

    /* ---- P5 エリア2「下水道」（js/textures.js の BUILDERS と同じキーで必ず対にする。
       片方に無いと法線・粗さが付かない）。エリア1の値は一切触らない
       （§3 の輝度ゲートが既定の材質で較正済みのため）。 ---- */
    /* 煉瓦は目地が深い＝法線を強く。濡れて艶が出るぶん粗さの下限を下げる */
    wallBrick: { height: 3.2, grain: 0.55, rough: [0.52, 0.97], metal: 0.02 },
    /* 切石はノミ跡の中周波が主。面は広いのでやや弱める */
    wallStone: { height: 2.7, grain: 0.45, rough: [0.50, 0.95], metal: 0.02 },
    /* 打放しは平滑。あばた（気泡痕）だけが凹む＝ height は低く grain を高く */
    wallConcreteWet: { height: 1.6, grain: 0.72, rough: [0.42, 0.94], metal: 0.02 },
    /* 石畳: 水たまり（低周波で明るい）が粗さ下限に落ちて艶になる＝幅を広く取る */
    floorStoneWet: { height: 2.9, grain: 0.45, rough: [0.05, 0.97], metal: 0.03 },
    floorBrick: { height: 3.0, grain: 0.48, rough: [0.46, 0.95], metal: 0.02 },
    /* 泥は反射しない。凹凸は細かい粒だけ */
    floorMud: { height: 1.4, grain: 0.75, rough: [0.70, 0.99], metal: 0.01 },
    /* 水面: ほぼ鏡面。法線は弱め（強いと波が金属板に見える） */
    waterSewer: { height: 1.2, grain: 0.12, rough: [0.06, 0.30], metal: 0.10 },
    /* 格子: 桟の角が立つ＝法線を最も強く。抜けた穴は黒＝深い凹みとして出る */
    metalGrate: { height: 3.4, grain: 0.35, rough: [0.32, 0.86], metal: 0.55 },
    pipeRust: { height: 2.4, grain: 0.50, rough: [0.34, 0.93], metal: 0.42 },
    /* ぬめりは濡れて光る。凹凸は浅い */
    slime: { height: 1.2, grain: 0.55, rough: [0.22, 0.72], metal: 0.02 }
  };

  /** 幅 rad の箱ぼかし（横→縦の2パス・巻き込みは繰り返し境界で行う） */
  function boxBlur(src, w, h, rad) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    var n = rad * 2 + 1, i, x, y, s;
    for (y = 0; y < h; y++) {
      var row = y * w;
      s = 0;
      for (i = -rad; i <= rad; i++) s += src[row + ((i % w) + w) % w];
      for (x = 0; x < w; x++) {
        tmp[row + x] = s / n;
        s += src[row + ((x + rad + 1) % w)] - src[row + (((x - rad) % w) + w) % w];
      }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (i = -rad; i <= rad; i++) s += tmp[((((i % h) + h) % h)) * w + x];
      for (y = 0; y < h; y++) {
        out[y * w + x] = s / n;
        s += tmp[((y + rad + 1) % h) * w + x] - tmp[(((y - rad) % h + h) % h) * w + x];
      }
    }
    return out;
  }

  var mapCache = Object.create(null);
  var mapsBytes = 0;

  /**
   * name の法線・粗さマップ。div は解像度の割り算（high=2／mobile=4）。
   */
  function materialMaps(name, div) {
    var key = name + '@' + div;
    if (mapCache[key] !== undefined) return mapCache[key];
    var THREE = global.THREE;
    var prof = MAT_PROFILE[name];
    if (!prof) return (mapCache[key] = null);
    var src = ESCAPE.Textures.get(name).image;
    var w = Math.max(8, Math.round(src.width / div)), h = Math.max(8, Math.round(src.height / div));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var cx = cv.getContext('2d');
    cx.drawImage(src, 0, 0, w, h);
    var px = cx.getImageData(0, 0, w, h).data;
    var lum = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var o = i * 4;
      lum[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
    }
    /* ④ 高周波だけを高さにする: 低周波（＝汚れ・シミ・塗りムラ）をぼかして引く。
     *    ぼかし幅はテクスチャの 1/24（＝約10cm相当）。目地・欠け・打痕は残る。 */
    var lo = boxBlur(lum, w, h, Math.max(2, Math.round(w / 24)));
    var hgt = new Float32Array(w * h);
    var seed = 1;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i2 = 0; i2 < w * h; i2++) {
      var hi = lum[i2] - lo[i2];               /* 高周波成分（-0.5〜0.5程度） */
      hgt[i2] = hi + (rnd() - 0.5) * 0.055 * prof.grain;
    }
    var nrm = new Uint8Array(w * h * 4);
    var rgh = new Uint8Array(w * h * 4);
    /* 高周波だけにした分だけ振幅が落ちるので係数を上げる（見た目の凹凸量を保つ） */
    var k = prof.height * 3.4 * (2 / div);
    for (var y2 = 0; y2 < h; y2++) {
      var ym = ((y2 - 1 + h) % h) * w, yp = ((y2 + 1) % h) * w, y0 = y2 * w;
      for (var x2 = 0; x2 < w; x2++) {
        var xm = (x2 - 1 + w) % w, xp = (x2 + 1) % w;
        var gx = (hgt[ym + xp] + 2 * hgt[y0 + xp] + hgt[yp + xp]) -
          (hgt[ym + xm] + 2 * hgt[y0 + xm] + hgt[yp + xm]);
        var gy = (hgt[yp + xm] + 2 * hgt[yp + x2] + hgt[yp + xp]) -
          (hgt[ym + xm] + 2 * hgt[ym + x2] + hgt[ym + xp]);
        var nx = -gx * k, ny = -gy * k;
        var il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        var oi = (y0 + x2) * 4;
        nrm[oi] = ((nx * il) * 0.5 + 0.5) * 255;
        nrm[oi + 1] = ((ny * il) * 0.5 + 0.5) * 255;
        nrm[oi + 2] = (il * 0.5 + 0.5) * 255;
        nrm[oi + 3] = 255;
        /* 粗さは**低周波**（汚れ・塗装の状態）から作る: 暗い＝汚れ＝粗い */
        var l2 = lo[y0 + x2];
        if (l2 < 0) l2 = 0; else if (l2 > 1) l2 = 1;
        var rv = prof.rough[1] + (prof.rough[0] - prof.rough[1]) * l2;
        rgh[oi] = 255; rgh[oi + 1] = (rv * 255) | 0; rgh[oi + 2] = 255; rgh[oi + 3] = 255;
      }
    }
    function tex(buf) {
      var t = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 4;
      t.flipY = true;                    /* アルベド(CanvasTexture)と向きを合わせる */
      t.needsUpdate = true;
      return t;
    }
    mapsBytes += w * h * 4 * 2;
    var r = { normalMap: tex(nrm), roughnessMap: tex(rgh), profile: prof, w: w, h: h };
    mapCache[key] = r;
    return r;
  }

  /* ================================================================
   * 系統Y: 近傍灯だけの動的ライト（0.3秒フェードつき）
   * ============================================================== */
  var LIGHT_FADE = 0.30;      /* 契約 段階2-3 ②: 灯の入れ替えは0.3秒 */
  var LIGHT_RADIUS = 24;      /* この距離(m)までの器具を候補にする */
  var LIGHT_HYST = 1.18;      /* 居座っている灯を追い出すのに必要な距離比（ばたつき防止） */

  function LightRig(game, n, gain) {
    var THREE = global.THREE;
    this.game = game;
    this.gain = gain;
    this.slots = [];
    for (var i = 0; i < n; i++) {
      var L = new THREE.PointLight(0xffffff, 0, 12, 2);
      L.visible = false;
      game.scene.add(L);
      this.slots.push({ L: L, f: null, k: 0, want: 0 });
    }
    this._cand = [];
    this.swaps = 0;
  }
  /** 候補（点灯中・近い順） */
  LightRig.prototype._candidates = function () {
    var g = this.game, w = g.world, cand = this._cand;
    cand.length = 0;
    if (!w || !w.fixtures) return cand;
    var cam = g.camera.position, fx = w.fixtures;
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      if (f.state === 'off') continue;
      var dx = f.x - cam.x, dy = f.y - cam.y, dz = f.z - cam.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > LIGHT_RADIUS * LIGHT_RADIUS) continue;
      cand.push({ f: f, d2: d2 });
    }
    cand.sort(function (a, b) { return a.d2 - b.d2; });
    if (cand.length > this.slots.length) cand.length = this.slots.length;
    return cand;
  };
  LightRig.prototype.update = function (dt) {
    var g = this.game, w = g.world;
    if (!w || !w.fixtures) return;
    var cand = this._candidates();
    var i, s;
    /* 1) 今ついている灯が候補に残っているか（ヒステリシス: 少し離れても居座らせる） */
    for (i = 0; i < this.slots.length; i++) {
      s = this.slots[i];
      if (!s.f) { s.want = 0; continue; }
      var keep = false;
      for (var c = 0; c < cand.length; c++) if (cand[c].f === s.f) { keep = true; break; }
      if (!keep && s.want > 0) {
        /* 候補から外れても、最遠の候補より十分遠くなるまでは残す */
        var cam = g.camera.position;
        var d2 = (s.f.x - cam.x) * (s.f.x - cam.x) + (s.f.y - cam.y) * (s.f.y - cam.y) +
          (s.f.z - cam.z) * (s.f.z - cam.z);
        var far = cand.length ? cand[cand.length - 1].d2 : 0;
        if (cand.length < this.slots.length || d2 < far * LIGHT_HYST * LIGHT_HYST) keep = true;
      }
      s.want = keep ? 1 : 0;
      if (keep) {
        for (var c2 = 0; c2 < cand.length; c2++) if (cand[c2].f === s.f) { cand.splice(c2, 1); break; }
      }
    }
    /* 2) 空いた枠へ新しい灯を入れる（フェードが終わって解放された枠だけ） */
    for (i = 0; i < this.slots.length && cand.length; i++) {
      s = this.slots[i];
      if (s.f && s.k > 0) continue;
      if (s.f && s.want === 0 && s.k <= 0) s.f = null;
      if (s.f) continue;
      s.f = cand.shift().f;
      s.k = 0; s.want = 1;
      this.swaps++;
    }
    /* 3) フェードと反映 */
    var step = (dt > 0 ? dt : 0) / LIGHT_FADE;
    for (i = 0; i < this.slots.length; i++) {
      s = this.slots[i];
      if (s.want > s.k) { s.k += step; if (s.k > 1) s.k = 1; }
      else if (s.want < s.k) { s.k -= step; if (s.k < 0) s.k = 0; }
      if (!s.f || s.k <= 0) {
        s.L.visible = false;
        s.L.intensity = 0;
        if (s.f && s.want === 0) s.f = null;
        continue;
      }
      var f = s.f;
      s.L.visible = true;
      s.L.position.set(f.x, f.y, f.z);
      s.L.color.setRGB(f.color.r, f.color.g, f.color.b);
      s.L.distance = f.R;
      s.L.decay = 2;
      var lv = (f.state === 'flicker' && w.flickerLevelAt) ? w.flickerLevelAt(f, g.simTime) : 1;
      s.L.intensity = this.gain * f.gain * (f.R / 7.6) * lv * s.k;
    }
  };
  /** 監査用: フェードを飛ばして今の選択を即時に反映する */
  LightRig.prototype.snap = function () {
    for (var n = 0; n < 40; n++) this.update(1);
  };
  LightRig.prototype.info = function () {
    var out = [];
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      out.push({ fixture: s.f ? (s.f.x.toFixed(1) + ',' + s.f.z.toFixed(1)) : null,
        k: +s.k.toFixed(3), want: s.want, intensity: +s.L.intensity.toFixed(2) });
    }
    return out;
  };
  LightRig.prototype.dispose = function () {
    for (var i = 0; i < this.slots.length; i++) {
      var L = this.slots[i].L;
      if (L.parent) L.parent.remove(L);
      if (L.dispose) L.dispose();
    }
    this.slots.length = 0;
  };

  /* ================================================================
   * 系統Z: 後処理 1パス
   *  HalfFloat の RT へ線形で描き、ACES + 露出 + 色被り + 暗部の締め +
   *  粒子ノイズ + sRGB符号化 を1回で行う。
   *  DOM の粒子ノイズ(#fx-noise)はこのパスが動いている間は止め、
   *  発見スティングのノイズは uGrain の上乗せで表す（二重にしない）。
   * ============================================================== */
  function PostFX(game, opt) {
    var THREE = global.THREE;
    this.game = game;
    var dpr = game.renderer.getPixelRatio();
    var w = Math.max(2, Math.floor((game.viewW || 1280) * dpr));
    var h = Math.max(2, Math.floor((game.viewH || 720) * dpr));
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      depthBuffer: true, stencilBuffer: false
    });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uni = {
      tDiffuse: { value: this.rt.texture },
      uExposure: { value: opt.exposure },
      uTime: { value: 0 },
      uGrain: { value: opt.grain },
      uBlack: { value: opt.black },
      uRes: { value: new THREE.Vector2(w, h) }
    };
    this.baseGrain = opt.grain;
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uni,
      depthTest: false, depthWrite: false,
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform sampler2D tDiffuse;',
        'uniform float uExposure, uTime, uGrain, uBlack;',
        /* ACES filmic (Narkowicz 2015) */
        'vec3 aces(vec3 x){',
        '  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;',
        '  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);',
        '}',
        'vec3 toSRGB(vec3 c){',
        '  return mix(c*12.92, 1.055*pow(max(c,vec3(0.0)), vec3(1.0/2.4))-0.055, step(0.0031308, c));',
        '}',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }',
        'void main(){',
        '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
        '  c = aces(c * uExposure);',
        /* 色被り: 暗部は緑青、明部は琥珀へ */
        '  float l = dot(c, vec3(0.2126,0.7152,0.0722));',
        '  vec3 shadowT = vec3(0.86, 1.02, 1.10);',
        '  vec3 highT   = vec3(1.09, 1.015, 0.88);',
        '  c *= mix(shadowT, highT, smoothstep(0.04, 0.48, l));',
        '  c = toSRGB(c);',
        '  c = max(c - uBlack, vec3(0.0)) / (1.0 - uBlack);',
        /* 粒子ノイズ: 暗部ほど強く・時間で動く */
        '  float n = hash(gl_FragCoord.xy + vec2(uTime*37.0, uTime*17.0)) - 0.5;',
        '  float lg = dot(c, vec3(0.2126,0.7152,0.0722));',
        '  c += n * uGrain * (1.0 - smoothstep(0.0, 0.6, lg));',
        '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
        '}'
      ].join('\n')
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);
  }
  PostFX.prototype.setSize = function (w, h) {
    var dpr = this.game.renderer.getPixelRatio();
    var pw = Math.max(2, Math.floor(w * dpr)), ph = Math.max(2, Math.floor(h * dpr));
    this.rt.setSize(pw, ph);
    this.uni.uRes.value.set(pw, ph);
  };
  PostFX.prototype.render = function (scene, camera) {
    var r = this.game.renderer;
    this.uni.uTime.value = (global.performance ? performance.now() : Date.now()) * 0.001;
    /* 発見スティングのノイズ（#fx-noise は止めてある）をこのパスで表す */
    var au = ESCAPE.audio;
    var sting = (au && au.fx) ? (au.fx.noise || 0) : 0;
    this.uni.uGrain.value = this.baseGrain + sting * 0.22;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    RQ.sceneCalls = r.info.render.calls;
    RQ.sceneTris = r.info.render.triangles;
    r.setRenderTarget(null);
    r.render(this.qscene, this.cam);
  };
  PostFX.prototype.bytes = function () { return this.rt.width * this.rt.height * 8; };
  PostFX.prototype.dispose = function () {
    this.rt.dispose(); this.mat.dispose(); this.quad.geometry.dispose();
  };

  /* ================================================================
   * 本体
   * ============================================================== */

  var forced = (qget('q') || '').toLowerCase();
  if (!TIERS[forced]) forced = '';
  var bootTier = forced || detectTier();

  var RQ = {
    /* 段階 */
    tier: bootTier,
    bootTier: bootTier,
    forced: !!forced,
    detected: detectTier(),
    degraded: false,
    /* 較正つまみ（URL で上書きできる。既定値が契約の較正結果） */
    tune: {
      /* 焼き込みに残す割合（残りを近傍灯が実時間で載せる）。
       * 0 にすると灯だけ＝黒抜けが出る。1 にすると今までどおりの焼き込み。 */
      mix: qnum('ymix', 0.55),
      /* 焼き込み側で二乗則（＝灯と同じ形）に置き換える強さの基準 */
      pointBase: qnum('ypb', 2.70),
      /* PointLight の強さ（f.gain=1・R=7.6m の器具で何カンデラか） */
      light: qnum('ylight', 5.2),
      amb: qnum('yamb', 1.8),
      /* 系統X（退避先）の環境光の底上げ。焼き込みだけでは実ライトぶんの
       * 持ち上がりが無く暗部が沈むので、ライトマップに一定量を足して較正する */
      xamb: qnum('xamb', 0.024),
      /* 0 なら段階ごとの既定（TIERS.exposure）を使う */
      exposure: qnum('zexp', 0),
      /* 加算合成のライト（ヘッドライト・明滅の光溜まり）に掛ける係数。
       * 後処理は線形空間で露出を掛けてから ACES を通すので、そのままだと白飛びする。
       * 露出の逆数を基準に、見た目が現行と同等になる値へ較正した。 */
      addScale: qnum('zadd', 0),
      grain: qnum('zgrain', 0.030),
      black: qnum('zblack', 0.018)
    },
    /* 監査用 */
    sceneCalls: 0, sceneTris: 0,
    Watch: Watch,
    decideTier: decideTier,
    env: env,
    TIERS: TIERS,
    WATCH: { window: WATCH_WINDOW, limit: WATCH_LIMIT, strikes: WATCH_STRIKES },
    LightmapAtlas: LightmapAtlas,
    materialMaps: materialMaps,
    MAT_PROFILE: MAT_PROFILE,
    lmRes: Math.max(8, Math.min(48, parseInt(qget('lmres') || '20', 10) || 20)),
    notes: []
  };
  ESCAPE.RQ = RQ;

  /** 加算合成のライトに掛ける係数（後処理が有効な時だけ使う） */
  /** この段階の露出（?zexp= で上書き可） */
  RQ.exposure = function () {
    return this.tune.exposure > 0 ? this.tune.exposure : cfg().exposure;
  };
  RQ.addLightScale = function () {
    if (!cfg().post) return 1;
    if (this.tune.addScale > 0) return this.tune.addScale;
    var v = 1 / this.exposure();
    return v < 0.4 ? 0.4 : (v > 1 ? 1 : v);
  };

  /** 今の段階の設定 */
  function cfg() { return TIERS[RQ.tier] || TIERS.off; }
  RQ.cfg = cfg;
  RQ.isY = function () { return cfg().y; };
  RQ.isX = function () { return cfg().x; };
  RQ.usePost = function () { return cfg().post; };
  RQ.lightCount = function () { return cfg().lights; };
  RQ.normalDiv = function () { return cfg().normalDiv; };
  /** 焼き込みに残す割合（world.js が焼く時に読む） */
  RQ.bakeMix = function () { return cfg().y ? RQ.tune.mix : 1; };

  /* ---- 素材のシェーダ改造（頂点の焼き込み光を足す／掛ける） ---- */
  RQ.uBakedMix = { value: 1 };

  /** MeshStandardMaterial: 実ライトの結果に「焼き込みの残り」を足す */
  RQ.patchStandard = function (mat) {
    var u = RQ.uBakedMix;
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uBakedMix = u;
      shader.vertexShader = 'attribute vec3 bakedLight;\nvarying vec3 vBakedLight;\n' +
        shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n\tvBakedLight = bakedLight;');
      shader.fragmentShader = 'uniform float uBakedMix;\nvarying vec3 vBakedLight;\n' +
        shader.fragmentShader.replace('#include <opaque_fragment>',
          '\toutgoingLight += vBakedLight * diffuseColor.rgb * uBakedMix;\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = function () { return 'rq-standard-baked'; };
    return mat;
  };
  /* 退避した時だけ効く環境光の底上げ（系統X の xamb と同じ役目）。
   * 焼き込みだけに戻すと暗部が沈むので、アルベドに比例した一定量を足して較正する。 */
  RQ.uBakedLift = { value: 0 };

  /** MeshBasicMaterial: 焼き込み光をそのまま掛ける（＝P4.16 までと同じ絵） */
  RQ.patchBasic = function (mat) {
    var u = RQ.uBakedMix, u2 = RQ.uBakedLift;
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uBakedMix = u;
      shader.uniforms.uBakedLift = u2;
      shader.vertexShader = 'attribute vec3 bakedLight;\nvarying vec3 vBakedLight;\n' +
        shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n\tvBakedLight = bakedLight;');
      shader.fragmentShader = 'uniform float uBakedMix;\nuniform float uBakedLift;\nvarying vec3 vBakedLight;\n' +
        shader.fragmentShader.replace('#include <opaque_fragment>',
          '\toutgoingLight *= vBakedLight * uBakedMix + vec3(uBakedLift);\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = function () { return 'rq-basic-baked'; };
    return mat;
  };


  /* ================================================================
   * P5: 下水の水面（法線2層スクロール）
   *   three の MeshStandardMaterial は法線マップを1枚しか持てないので、
   *   同じ法線マップを**別の offset・別の縮尺で2回**サンプルして合成する。
   *   offset は ESCAPE.Textures.animate(dt) が uniform に書く
   *   （テクスチャの再アップロードは起きない＝ iPhone でも負荷が増えない）。
   *   fallback / off 段階では Basic（静止したアルベドだけ）に落とす。
   * ============================================================== */
  RQ.waterMaterial = function (opts) {
    opts = opts || {};
    var THREE = global.THREE;
    var TX = ESCAPE.Textures;
    var name = opts.texture || 'waterSewer';
    var vc = (opts.vertexColors === undefined) ? true : !!opts.vertexColors;
    var baked = (opts.baked === undefined) ? true : !!opts.baked;
    var map = TX.get(name);
    if (!cfg().y) {
      /* 退避段階: 静止した水面（焼き込みだけ）。契約 P5「fallback では静止」 */
      var b = new THREE.MeshBasicMaterial({ map: map, vertexColors: vc, fog: true });
      if (baked) RQ.patchBasic(b);
      b.userData.water = { animated: false, uniforms: null };
      return b;
    }
    var div = opts.div || RQ.normalDiv();
    var mm = materialMaps(name, div);
    var so = { map: map, vertexColors: vc, fog: true, roughness: 1.0 };
    if (mm) {
      so.normalMap = mm.normalMap;
      so.normalScale = new THREE.Vector2(opts.normalScale || 0.85, opts.normalScale || 0.85);
      so.roughnessMap = mm.roughnessMap;
      so.metalness = (opts.metalness === undefined) ? mm.profile.metal : opts.metalness;
    } else {
      so.metalness = 0.1;
    }
    var mat = new THREE.MeshStandardMaterial(so);
    var u = {
      uNrmOff1: { value: new THREE.Vector2(0, 0) },
      uNrmOff2: { value: new THREE.Vector2(0, 0) },
      uNrmScale2: { value: opts.layer2Scale || 1.73 },
      uPulse: { value: 1 }
    };
    var ub = RQ.uBakedMix;
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uNrmOff1 = u.uNrmOff1;
      shader.uniforms.uNrmOff2 = u.uNrmOff2;
      shader.uniforms.uNrmScale2 = u.uNrmScale2;
      shader.uniforms.uPulse = u.uPulse;
      var head = 'uniform vec2 uNrmOff1;\nuniform vec2 uNrmOff2;\nuniform float uNrmScale2;\nuniform float uPulse;\n';
      if (baked) {
        shader.uniforms.uBakedMix = ub;
        shader.vertexShader = 'attribute vec3 bakedLight;\nvarying vec3 vBakedLight;\n' +
          shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n\tvBakedLight = bakedLight;');
        head += 'uniform float uBakedMix;\nvarying vec3 vBakedLight;\n';
      }
      var src = head + shader.fragmentShader;
      /* 法線を2層サンプルして合成（速度も向きも違う＝干渉して周期が読めない）。
         onBeforeCompile の時点では #include はまだ展開されていないので、
         チャンクの取り込み自体を差し替える（展開後の1行を狙うと当たらない）。 */
      var one = '#include <normal_fragment_maps>';
      var two = '#ifdef USE_NORMALMAP_TANGENTSPACE\n' +
        '\tvec3 mapNa = texture2D( normalMap, vNormalMapUv + uNrmOff1 ).xyz * 2.0 - 1.0;\n' +
        '\tvec3 mapNb = texture2D( normalMap, vNormalMapUv * uNrmScale2 + uNrmOff2 ).xyz * 2.0 - 1.0;\n' +
        '\tvec3 mapN = normalize( vec3( mapNa.xy + mapNb.xy, max( mapNa.z * mapNb.z, 0.05 ) ) );\n' +
        '\tmapN.xy *= normalScale;\n' +
        '\tnormal = normalize( tbn * mapN );\n' +
        '#else\n' +
        '\t#include <normal_fragment_maps>\n' +
        '#endif';
      if (src.indexOf(one) >= 0) {
        src = src.replace(one, two);
        RQ.waterLayers = 2;
      } else {
        RQ.waterLayers = 1;                  /* three の実装が変わった時の保険 */
        RQ.notes.push('水面: 法線2層の差し込みに失敗（1層で描画）');
      }
      /* わずかな明滅＋焼き込みの残り */
      src = src.replace('#include <opaque_fragment>',
        '\toutgoingLight *= uPulse;\n' +
        (baked ? '\toutgoingLight += vBakedLight * diffuseColor.rgb * uBakedMix;\n' : '') +
        '#include <opaque_fragment>');
      shader.fragmentShader = src;
    };
    mat.customProgramCacheKey = function () { return 'rq-water-' + (baked ? 'baked' : 'plain'); };
    mat.userData.water = { animated: true, uniforms: u };
    TX.bindAnimated(name, u);
    return mat;
  };

  /* ---- renderer / game への結線 ---- */

  /** 解像度倍率の上限（端末の devicePixelRatio との小さい方） */
  RQ.pixelRatio = function () {
    var dpr = global.devicePixelRatio || 1;
    return Math.min(dpr, cfg().dpr);
  };

  RQ.applyRenderer = function (renderer) {
    renderer.setPixelRatio(RQ.pixelRatio());
  };

  /** game.init の最後に呼ぶ（scene と world が出来てから） */
  RQ.attach = function (game) {
    this.game = game;
    if (cfg().y && cfg().lights > 0) {
      this.rig = new LightRig(game, cfg().lights, this.tune.light);
      this.ambient = new global.THREE.AmbientLight(0x1a2430, 0.62 * this.tune.amb);
      this.hemi = new global.THREE.HemisphereLight(0x121b26, 0x05070a, 0.42 * this.tune.amb);
      game.scene.add(this.ambient);
      game.scene.add(this.hemi);
      this.uBakedMix.value = this.tune.mix;
      this.notes.push('Y: PointLight x' + cfg().lights + ' / 焼き込み ' + this.tune.mix);
    } else {
      this.uBakedMix.value = 1;
    }
    if (cfg().post) {
      this.post = new PostFX(game, {
        exposure: this.exposure(), grain: this.tune.grain, black: this.tune.black
      });
      this.post.setSize(game.viewW, game.viewH);
      this.notes.push('Z: HalfFloat RT + 1パス');
    }
    this.watch = new Watch();
    this.watchEnabled = (this.tier === 'mobile');
    return this;
  };

  /** 世界を作り直した時（game.reset）に呼ぶ */
  RQ.onWorldRebuilt = function () {
    if (this.rig) this.rig.snap();
  };

  /** render の先頭。dt はゲーム内の経過ではなく実時間（フェード用） */
  RQ.beforeRender = function (game) {
    var now = (global.performance ? performance.now() : Date.now());
    var dt = this._lastRender ? (now - this._lastRender) / 1000 : 1 / 60;
    this._lastRender = now;
    if (dt > 0.25) dt = 0.25;
    if (this.rig) this.rig.update(dt);
  };

  /** 後処理が有効ならここで描く（true を返したら呼び出し側は描かない） */
  RQ.renderScene = function (game) {
    if (!this.post) return false;
    this.post.render(game.scene, game.camera);
    return true;
  };

  RQ.resize = function (w, h) {
    if (this.post) this.post.setSize(w, h);
  };

  /** 実フレーム時間(ms)を入れる。機械テストは now を注入して窓を進められる */
  RQ.sampleFrame = function (ms, now) {
    if (!this.watchEnabled || this.degraded || !this.watch) return false;
    var t = (now === undefined) ? (global.performance ? performance.now() : Date.now()) : now;
    if (this.watch.push(ms, t)) { this.degrade('frame ' + this.watch.lastMedian.toFixed(1) + 'ms'); return true; }
    return false;
  };

  /**
   * 退避（mobile -> fallback）。世界は作り直さず、
   * 大面を焼き込み専用の素材へ戻し・動的ライトを消し・解像度倍率を下げる。
   */
  RQ.degrade = function (reason) {
    if (this.degraded) return false;
    this.degraded = true;
    this.tier = 'fallback';
    this.watchEnabled = false;
    this.uBakedMix.value = 1;
    this.uBakedLift.value = this.tune.xamb;
    if (this.rig) { this.rig.dispose(); this.rig = null; }
    if (this.ambient) { this.game.scene.remove(this.ambient); this.ambient = null; }
    if (this.hemi) { this.game.scene.remove(this.hemi); this.hemi = null; }
    /* 露出も退避先の較正値へ（焼き込みが全量ぶん載るので少し落とす） */
    if (this.post) this.post.uni.uExposure.value = this.exposure();
    var g = this.game;
    if (g && g.world && g.world.setLightingMode) g.world.setLightingMode('baked');
    if (g && g.renderer) {
      g.renderer.setPixelRatio(this.pixelRatio());
      g.resize();
    }
    try { global.sessionStorage.setItem('escape_rq_tier', 'fallback'); } catch (e) { /* 無効環境 */ }
    this.notice('描画を軽量モードに切り替えた');
    this.notes.push('退避: ' + (reason || ''));
    return true;
  };

  /** 機械テスト専用: 退避を巻き戻して製品初期状態へ戻す（製品中では呼ばない） */
  RQ.__restore = function () {
    if (!this.degraded) return false;
    this.degraded = false;
    this.tier = this.bootTier;
    this.uBakedMix.value = this.bakeMix();
    this.uBakedLift.value = 0;
    if (this.post) this.post.uni.uExposure.value = this.exposure();
    var g = this.game;
    if (cfg().y && cfg().lights > 0 && g) {
      this.rig = new LightRig(g, cfg().lights, this.tune.light);
      this.ambient = new global.THREE.AmbientLight(0x1a2430, 0.62 * this.tune.amb);
      this.hemi = new global.THREE.HemisphereLight(0x121b26, 0x05070a, 0.42 * this.tune.amb);
      g.scene.add(this.ambient); g.scene.add(this.hemi);
      this.rig.snap();
    }
    if (g && g.world && g.world.setLightingMode) g.world.setLightingMode(cfg().y ? 'dynamic' : 'baked');
    if (g && g.renderer) { g.renderer.setPixelRatio(this.pixelRatio()); g.resize(); }
    this.watch = new Watch();
    this.watchEnabled = (this.tier === 'mobile');
    try { global.sessionStorage.removeItem('escape_rq_tier'); } catch (e) { /* 無効環境 */ }
    var el = document.getElementById('rq-notice');
    if (el) { el.classList.remove('show'); el.textContent = ''; }
    this.noticed = false;
    return true;
  };

  /** HUD へ一度だけ短く出す */
  RQ.notice = function (text) {
    if (this.noticed) return;
    this.noticed = true;
    this.noticeText = text;
    var el = document.getElementById('rq-notice');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    global.setTimeout(function () { el.classList.remove('show'); }, 3600);
  };

  /** 追加で使っている GPU メモリ（概算・バイト） */
  RQ.extraBytes = function () {
    var n = mapsBytes;
    if (this.post) n += this.post.bytes();
    if (this.game && this.game.world && this.game.world.stats.lmBytes) n += this.game.world.stats.lmBytes;
    return n;
  };
  RQ.mapsBytes = function () { return mapsBytes; };

  RQ.info = function () {
    var g = this.game;
    return {
      tier: this.tier, bootTier: this.bootTier, forced: this.forced, detected: this.detected,
      degraded: this.degraded, lights: cfg().lights, normalDiv: cfg().normalDiv,
      dpr: g && g.renderer ? g.renderer.getPixelRatio() : 0,
      post: !!this.post, mix: this.uBakedMix.value,
      rig: this.rig ? this.rig.info() : null
    };
  };
  RQ.snapLights = function () { if (this.rig) this.rig.snap(); };

  /* ---- 監査ハーネス（?cam=1|2|3 / ?stats=1 / ?bench=1） ---- */

  var CAMS = {
    1: { col: 4, row: 74, yawDeg: 180, light: false, name: 'スタート部屋正面（掲示板）' },
    2: { col: 37, row: 47, yawDeg: 180, light: false, name: '区画Bの通路（南向き）' },
    3: { col: 63, row: 48, yawDeg: -90, light: true, name: '暗所帯 dz_B の入口（ライト点灯）' }
  };
  RQ.CAMS = CAMS;

  function hideHud() {
    ['debug', 'hint', 'stick-base', 'buttons', 'minimap-wrap', 'crosshair', 'status',
      'objective', 'rope-hud', 'prompt', 'trap-hint', 'voice-sub', 'btn-menu']
      .forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    var ov = document.getElementById('memo-overlay');
    if (ov) { ov.classList.remove('open'); ov.style.display = 'none'; }
    document.body.classList.remove('touch', 'portrait-warn');
    var hb = document.getElementById('fx-hbrim');
    if (hb) { hb.style.opacity = '0'; hb.style.display = 'none'; }
  }
  function applyCam(g, n) {
    var c = CAMS[n];
    if (!c) return;
    var T = g.map.tileSize, p = g.player;
    p.x = c.col * T + T / 2;
    p.z = c.row * T + T / 2;
    p.y = g.map.floorYAt(p.x, p.z);
    p.yaw = c.yawDeg * Math.PI / 180;
    p.pitch = 0;
    p.speed = 0;
    g.syncCamera();
    if (g.rope && g.rope.group) g.rope.group.visible = false;
    if (g.headlight) {
      g.headlight.on = !!c.light;
      g.headlight.level = c.light ? 1 : 0;
      if (g.headlight._place) g.headlight._place();
      if (g.headlight._apply) g.headlight._apply();
    }
  }
  function statsText(g) {
    var r = g.renderer, info = r.info;
    var gl = r.getContext();
    var dbg = gl.getExtension('WEBGL_debug_renderer_info');
    var L = [];
    L.push('q=' + RQ.tier + ' (' + (RQ.forced ? '強制' : '判定') + ') cam=' + RQ.cam);
    L.push('renderer=' + (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?'));
    L.push('drawCalls=' + (RQ.post ? (RQ.sceneCalls + 1) : info.render.calls) +
      (RQ.post ? (' (本編' + RQ.sceneCalls + ' + 後処理1)') : ''));
    L.push('triangles=' + (RQ.post ? RQ.sceneTris : info.render.triangles));
    L.push('pixelRatio=' + r.getPixelRatio());
    L.push('lights=' + cfg().lights + ' normalDiv=' + cfg().normalDiv);
    L.push('baseTexMB=' + ESCAPE.Textures.budget().gpuMB.toFixed(1));
    L.push('matMapsMB=' + (mapsBytes / 1e6).toFixed(2));
    L.push('lightmapMB=' + ((g.world.stats.lmBytes || 0) / 1e6).toFixed(2));
    L.push('lightmapBakeMs=' + (g.world.stats.lmBakeMs || 0).toFixed(0));
    L.push('postRT_MB=' + (RQ.post ? (RQ.post.bytes() / 1e6).toFixed(2) : '0'));
    L.push('worldBuildMs=' + (g.world.stats.buildMs || 0).toFixed(0));
    L.push('worldTriangles=' + g.world.stats.triangles);
    L.push('worldDrawGroups=' + g.world.stats.drawGroups);
    L.push('memTextures=' + info.memory.textures + ' memGeometries=' + info.memory.geometries);
    L.push('notes=' + RQ.notes.join(' | '));
    return L.join('\n');
  }
  RQ.statsText = statsText;

  /** 同期バースト計測（1px の readPixels で GPU の完了を待たせる） */
  RQ.burst = function (n) {
    var g = this.game, gl = g.renderer.getContext(), buf = new Uint8Array(4);
    for (var w = 0; w < 10; w++) { g.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); }
    var t = performance.now();
    for (var i = 0; i < n; i++) { g.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); }
    return (performance.now() - t) / n;
  };

  RQ.cam = parseInt(qget('cam') || '0', 10) || 0;
  RQ.wantStats = qget('stats') === '1';
  RQ.wantBench = qget('bench') === '1';

  function runBench(g) {
    var frames = 0, t0 = null, DUR = 20000, worst = 0, samples = [], last = null;
    function onFrame() {
      var now = performance.now();
      if (t0 === null) { t0 = now; last = now; }
      else {
        var dt = now - last; last = now;
        if (dt > worst) worst = dt;
        samples.push(dt);
      }
      frames++;
      if (now - t0 >= DUR) {
        samples.sort(function (a, b) { return a - b; });
        var fps = (frames - 1) / ((now - t0) / 1000);
        var burstMs = RQ.burst(150);
        var msg = '[BENCH] q=' + RQ.tier +
          ' burst_ms=' + burstMs.toFixed(3) + ' burst_fps=' + (1000 / burstMs).toFixed(1) +
          ' fps=' + fps.toFixed(1) +
          ' median_ms=' + (samples[samples.length >> 1] || 0).toFixed(2) +
          ' p95_ms=' + (samples[Math.floor(samples.length * 0.95)] || 0).toFixed(2) +
          ' worst_ms=' + worst.toFixed(1) +
          ' draw=' + (RQ.post ? (RQ.sceneCalls + 1) : g.renderer.info.render.calls);
        document.title = msg;
        if (global.console) console.log(msg);
        var d = document.createElement('div');
        d.id = 'rq-bench';
        d.textContent = msg;
        document.body.appendChild(d);
        RQ.benchDone = true;
        return;
      }
      global.requestAnimationFrame(onFrame);
    }
    global.requestAnimationFrame(onFrame);
  }

  function wireAudit() {
    var g = ESCAPE.game;
    if (!g || !g.world) { global.setTimeout(wireAudit, 40); return; }
    if (RQ.wantBench) {
      if (ESCAPE.Title && ESCAPE.Title.skip) ESCAPE.Title.skip();
      hideHud();
      for (var b = 0; b < 6; b++) g.stepFrame(ESCAPE.FIXED_DT);
      if (RQ.cam) applyCam(g, RQ.cam);
      hideHud();
      runBench(g);
      return;
    }
    if (!RQ.cam) return;
    if (ESCAPE.Title && ESCAPE.Title.skip) ESCAPE.Title.skip();
    hideHud();
    for (var i = 0; i < 6; i++) g.stepFrame(ESCAPE.FIXED_DT);
    applyCam(g, RQ.cam);
    hideHud();
    RQ.snapLights();
    /* 更新だけ止めて描画は続ける（preserveDrawingBuffer:false のため rAF は止めない） */
    g.stepFrame = function () { };
    g.render();
    if (RQ.wantStats) {
      var txt = statsText(g);
      document.title = 'STATS';
      var pre = document.createElement('pre');
      pre.id = 'rq-stats';
      pre.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;color:#000;' +
        'font:13px monospace;padding:12px;margin:0;';
      pre.textContent = txt;
      document.body.appendChild(pre);
      if (global.console) console.log('[STATS]\n' + txt);
    }
    RQ.camReady = true;
  }

  if (RQ.cam || RQ.wantBench) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { global.setTimeout(wireAudit, 0); });
    } else {
      global.setTimeout(wireAudit, 0);
    }
  }
})(window);
