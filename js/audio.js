/* ESCAPE — P4.5: 音響エンジン＋恐怖演出（契約 DESIGN.md §4「音響と恐怖演出」）
 *
 * 方針（契約 §2 $0構成）:
 *   外部音源は一切使わない。すべて WebAudio のオシレータ＋ノイズバッファから生成する。
 *   AudioContext は初回タップ/クリック/キーで解錠する（iOS Safari 対策）。
 *   解錠前は「無音だが例外ゼロ」＝ 発音系は全て null チェックで素通りする。
 *
 * 構成:
 *   VOICES    … 純関数の音色定義 (ctx, dest, t0, p) -> 長さ(s)
 *               ライブの AudioContext でも OfflineAudioContext でも同じコードが走る。
 *               乱数は使わず p.r（0..1）で振れ幅を渡す＝オフラインレンダの結果が再現する。
 *   Engine    … バス・空間化・同時発音数の上限・設定保持・毎フレームの音響ディレクタ。
 *               連続音（環境ドローン/蛍光灯/呼吸）は AudioParam の自動化ではなく
 *               毎フレームの .value 代入で駆動する（出力デバイス無し環境でも破綻しない）。
 *   Fear FX   … 画面周辺減光・微振動・FOV微増・スティングのフラッシュ/ノイズ・瞬間暗転。
 *               ポストプロセスは使わず DOM オーバーレイとカメラ回転のみ（軽量）。
 *   render    … OfflineAudioContext で1音を描画して RMS/peak を返す機械テスト用ヘルパー。
 *
 * 上書き事故の防止:
 *   - 心拍・足音・敵の足音は「時間/距離の累積器」で発火する。レート（BPM等）は毎フレーム
 *     変えてよいが、累積器そのものは発火時にしか減らさない（毎フレーム 0 に戻すと鳴らない）。
 *   - 連続音の gain は「ディレクタが毎フレーム1回だけ」書く。イベント側からは触らない。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE || (global.ESCAPE = {});

  /* ================================================================
   * 定数
   * ============================================================== */
  var STORE_KEY = 'escape.audio.v1';
  var MAX_VOICES = 20;            /* 同時発音数の上限（スマホ想定） */
  /* P4.10: 罠発火の絶叫は施設全体に届く（80x80マップの対角=226mより大きく取る） */
  var SHRIEK_MAX_DIST = 400;
  var SHRIEK_ATTEN_FLOOR = 0.34;  /* 遠くても必ずこの音量では届く（方向は pan で分かる） */
  var NOISE_SECONDS = 2.0;        /* 共有ノイズバッファの長さ */
  var DEFAULT_VOLUME = 0.75;

  /* 空間化 */
  var ATTEN_REF = 3.5;            /* この距離で音量半分 */
  var ATTEN_MAX = 26.0;           /* これ以上は無音 */
  var LP_NEAR = 14000;            /* 至近距離のローパス上限(Hz) */
  var LP_FALL = 9.0;              /* 距離による減衰長(m) */
  var OCCLUDE_LP = 0.22;          /* 壁越しのローパス係数 */
  var OCCLUDE_GAIN = 0.50;        /* 壁越しの音量係数 */
  var PAN_WIDTH = 0.85;
  var AMB_BUS_GAIN = 0.9;         /* 環境音バスの基準ゲイン（ダッキングの基準） */

  /* 足音の歩幅(m)。この距離だけ進むごとに1歩 */
  var STRIDE = { walk: 0.92, run: 1.32, crouch: 1.05 };
  var STEP_GAIN = { walk: 0.52, run: 1.00, crouch: 0.17 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }

  /* ================================================================
   * 共有ノイズバッファ（決定的に生成する＝オフラインレンダが再現する）
   * ============================================================== */
  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function noiseBuffer(ctx) {
    if (ctx.__escNoise) return ctx.__escNoise;
    var n = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var rnd = lcg(20260902);
    for (var i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    try { ctx.__escNoise = buf; } catch (e) { /* 代入できない環境は都度生成 */ }
    return buf;
  }

  /* ================================================================
   * ノード生成の小物
   * ============================================================== */
  function gainOf(ctx, v) { var g = ctx.createGain(); g.gain.value = v; return g; }

  function bq(ctx, type, f, q) {
    var b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    if (q !== undefined) b.Q.value = q;
    return b;
  }

  function osc(ctx, type, f) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return o;
  }

  function noiseSrc(ctx, rate) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    s.loop = true;
    if (rate) s.playbackRate.value = rate;
    return s;
  }

  /** 打撃系の包絡（指数減衰）。peak は 0 より大きい値であること */
  function hit(ctx, t0, peak, attack, decay) {
    var g = ctx.createGain();
    var p = Math.max(peak, 0.0004);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(p, t0 + Math.max(attack, 0.001));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack, 0.001) + Math.max(decay, 0.01));
    return g;
  }

  /** 持続系の包絡（立ち上がり→維持→減衰） */
  function swell(ctx, t0, peak, a, hold, r) {
    var g = ctx.createGain();
    var p = Math.max(peak, 0.0004);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(p, t0 + a);
    g.gain.setValueAtTime(p, t0 + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + r);
    return g;
  }

  function chain(nodes) {
    for (var i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  function startStop(node, t0, dur) {
    try { node.start(t0); } catch (e) { /* 既に開始済み */ }
    try { node.stop(t0 + dur); } catch (e) { /* stop 非対応 */ }
  }

  /* ================================================================
   * P4.15「声の差し替え」で足した小物（契約 DESIGN.md「P4.15 声の差し替え」）
   *   shaper / widen / reverb … 歪み・左右の広がり・生成した残響（音源ファイルは使わない）
   *   walk / curveTo          … 非周期の揺れ（要件1）と、折れ線でない包絡（要件6）
   *   voicePair / driftFormants … 二重の声とフォルマントの漂い（要件2）
   * ============================================================== */

  /** 歪み（声を「人だったもの」に寄せる）。k が大きいほど潰れる */
  function shaper(ctx, k) {
    var ws = ctx.createWaveShaper();
    var n = 1024, c = new Float32Array(n), d = Math.tanh(k);
    for (var i = 0; i < n; i++) {
      var x = (i * 2) / (n - 1) - 1;
      c[i] = Math.tanh(k * x) / d;
    }
    ws.curve = c;
    try { ws.oversample = '4x'; } catch (e) { /* 非対応環境はそのまま */ }
    return ws;
  }

  /** 定位。StereoPanner が無い環境では素通しの gain を返す */
  function panOf(ctx, v) {
    if (!ctx.createStereoPanner) return gainOf(ctx, 1);
    var p = ctx.createStereoPanner();
    p.pan.value = clamp(v, -1, 1);
    return p;
  }

  /** ごく短い時間差で左右に開く（頭内定位を避ける）。入力ノードを返す */
  function widen(ctx, dest, spread, lagMs) {
    var inp = gainOf(ctx, 1);
    if (!ctx.createStereoPanner) { inp.connect(dest); return inp; }
    var a = panOf(ctx, -spread);
    var b = panOf(ctx, spread);
    var dl = ctx.createDelay(0.05);
    dl.delayTime.value = (lagMs === undefined ? 6 : lagMs) / 1000;
    var bg = gainOf(ctx, 0.82);
    inp.connect(a); a.connect(dest);
    inp.connect(dl); dl.connect(bg); bg.connect(b); b.connect(dest);
    return inp;
  }

  /** 生成した遅延ループの残響（音源ファイルは使わない＝$0）。送り先のノードを返す */
  function reverb(ctx, dest, taps, fb, lpHz, wetGain) {
    var send = gainOf(ctx, 1);
    var wet = gainOf(ctx, wetGain);
    for (var i = 0; i < taps.length; i++) {
      var dl = ctx.createDelay(0.6);
      dl.delayTime.value = taps[i];
      var lp = bq(ctx, 'lowpass', lpHz, 0.8);
      var g = gainOf(ctx, fb);
      send.connect(dl); dl.connect(lp); lp.connect(g); g.connect(dl);
      lp.connect(wet);
    }
    wet.connect(dest);
    return send;
  }

  function smooth01(u) { return u <= 0 ? 0 : (u >= 1 ? 1 : u * u * (3 - 2 * u)); }
  function centsMul(c) { return Math.pow(2, c / 1200); }

  /**
   * param に「基準カーブ base(u) × ランダムウォークの揺れ」を書く（要件1）。
   * 正弦のビブラート／トレモロは使わない＝どの周波数にも山が立たない。
   * amt は揺れの深さ（比率）、rLo..rHi は揺れの速さ(Hz)の範囲。
   */
  function walk(param, rnd, t0, dur, base, amt, rLo, rHi) {
    var t = 0, w = 0, guard = 0;
    param.setValueAtTime(Math.max(base(0), 1e-3), t0);
    while (t < dur - 1e-4 && guard++ < 600) {
      var rate = rLo + rnd() * (rHi - rLo);
      var dt = Math.min(0.35 / rate, dur - t);
      if (dt < 1e-4) break;
      t += dt;
      /* 前の値を半分だけ引き継ぐ＝周期を持たないが暴れもしない */
      w = w * 0.45 + (rnd() * 2 - 1) * amt;
      param.exponentialRampToValueAtTime(Math.max(base(t / dur) * (1 + w), 1e-3), t0 + t);
    }
  }

  /** 折れ線にしない包絡（要件6）。fn(u) を n 段の指数ランプで描く */
  function curveTo(param, t0, dur, fn, steps) {
    var n = steps || 40, i;
    param.setValueAtTime(Math.max(fn(0), 1e-4), t0);
    for (i = 1; i <= n; i++) {
      param.exponentialRampToValueAtTime(Math.max(fn(i / n), 1e-4), t0 + dur * (i / n));
    }
  }

  /**
   * 主声＋副声（±cent 離調・lag 遅れ）＝要件2「声を1本で鳴らさない」。
   * baseFn(u) は 0..1 の位置から基音(Hz)を返す。戻り値は歪ませた波形の出口。
   */
  function voicePair(ctx, t0, dur, baseFn, wob, wLo, wHi, cent, lag, subG, drive, shape, seed) {
    var sum = gainOf(ctx, 1);
    var o1 = osc(ctx, 'sawtooth', baseFn(0));
    walk(o1.frequency, lcg(seed || 1), t0, dur, baseFn, wob, wLo, wHi);
    o1.connect(sum);
    startStop(o1, t0, dur + 0.05);

    var m = centsMul(cent);
    var o2 = osc(ctx, 'sawtooth', baseFn(0) * m);
    walk(o2.frequency, lcg(((seed + 12345) >>> 0) || 1), t0, dur,
      function (u) { return baseFn(u) * m; }, wob, wLo, wHi);
    var dl = ctx.createDelay(0.05);
    dl.delayTime.value = lag;
    var sg = gainOf(ctx, subG);
    o2.connect(dl); dl.connect(sg); sg.connect(sum);
    startStop(o2, t0, dur + 0.05);

    var d = gainOf(ctx, drive);
    var ws = shaper(ctx, shape);
    sum.connect(d); d.connect(ws);
    return ws;
  }

  /** フォルマント3本。中心は a->b へ動きつつ非周期に漂う（要件2の後半） */
  function driftFormants(ctx, src, dst, t0, dur, specs, drift, seed) {
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      var b = bq(ctx, 'bandpass', s.a, s.q);
      walk(b.frequency, lcg(((seed + i * 7919) >>> 0) || 1), t0, dur, (function (sp) {
        return function (u) { return sp.a + (sp.b - sp.a) * smooth01(Math.min(u / 0.62, 1)); };
      }(s)), drift, 0.6, 2.0);
      var g = gainOf(ctx, s.g);
      src.connect(b); b.connect(g); g.connect(dst);
    }
  }

  /* ---- P4.13 項目3: 追跡中の緊迫層（シェパード式の終わりなき上昇） ---- */
  var TEN_CYCLE = 6.0;          /* 1オクターブ上がりきる周期(s)。回り込みはここで起きる */
  var TEN_OCT = 9;              /* 重ねるオクターブ数。釣鐘の裾が両端で完全に0になる幅を取る */
  var TEN_BASE = 40;            /* 最下段の基音(Hz) */
  var TEN_STACK = [1, 1.059463, 1.414214];  /* 同度・短2度・三全音＝不協和 */
  var TEN_C0 = 8.23;            /* 明るさ（釣鐘中心）の開始 log2(Hz) ≒ 300Hz */
  var TEN_C1 = 9.97;            /* 同・到達点 ≒ 1000Hz */
  var TEN_RISE = 22.0;          /* 明るさが上がりきるまでの秒数 */
  var TEN_WIDTH = 0.95;         /* 釣鐘の幅（オクターブ） */
  var TEN_STEP = 0.05;          /* 包絡の自動化ステップ(s) */
  var TEN_AMP = 0.075;          /* 1本あたりの振幅 */
  var TEN_XF = 0.40;               /* チャンクの継ぎ目の等パワー・クロスフェード(s) */
  var TEN_HOP = TEN_CYCLE * 9;     /* 次のチャンクの開始間隔(s)。周期の整数倍＝模様が揃う */
  var TEN_CHUNK = TEN_HOP + TEN_XF;/* 1チャンクの長さ(s)。末尾の TEN_XF だけ次と重ねる */
  var TEN_ARM = 2.0;               /* 切れる何秒前に次を継ぎ足すか */
  var TEN_REL = 1.7;               /* 追跡解除で抜けきるまで(s)。chaseRelease と同じ尺 */
  var TEN_MIX = 0.28;              /* 他の層（絶叫・爪音・鼓動）を埋めない混ぜ量 */

  /* ---- P4.15 項目: すすり泣き→絶叫（P4.13 項目4の「囁き」は失効） ---- */
  var SOB_ONSET = 1.20;         /* すすり泣き→絶叫に変わる時刻(s)。字幕はここに合わせる（契約） */
  var SOB_SCR = 1.16;           /* 絶叫の長さ(s) */
  var SOB_WET = 0.24;           /* 残響量（05b の 0.28 から製品用に薄く） */
  var SOB_G = 0.85;             /* すすり泣きの音量（コンプ後も静→爆を残すため下げる） */
  var SOB_TRIM = 0.963;         /* レンダのピークを 0.885 に載せる較正値（実測 0.919 から） */

  /* ================================================================
   * VOICES — 音色定義
   *   すべて (ctx, dest, t0, p) を取り「およその長さ(s)」を返す。
   *   dest は呼び出し側が用意した gain ノード（音量・空間化は外側の責務）。
   * ============================================================== */

  /* 床種ごとの足音パラメータ（契約 §4「床種で音色が変わる」） */
  var FLOOR_MAT = {
    tile:  { thF: 92, thG: 0.50, thD: 0.075, bpF: 1900, bpQ: 1.1, nG: 0.40, nD: 0.050, ring: 0,    ringG: 0,    ringD: 0 },
    metal: { thF: 76, thG: 0.46, thD: 0.100, bpF: 2400, bpQ: 1.5, nG: 0.44, nD: 0.075, ring: 2650, ringG: 0.20, ringD: 0.34 },
    water: { thF: 68, thG: 0.38, thD: 0.090, bpF: 880,  bpQ: 0.9, nG: 0.62, nD: 0.190, ring: 0,    ringG: 0,    ringD: 0 },
    glass: { thF: 98, thG: 0.30, thD: 0.065, bpF: 4300, bpQ: 1.3, nG: 0.52, nD: 0.100, ring: 6100, ringG: 0.17, ringD: 0.18 }
  };

  var VOICES = {

    /* ---------------- プレイヤー ---------------- */

    /** 足音。p: {mat, level(0..1), r(0..1)} */
    footstep: function (ctx, dest, t0, p) {
      var m = FLOOR_MAT[p.mat] || FLOOR_MAT.tile;
      var lv = (p.level === undefined) ? 1 : clamp(p.level, 0.05, 1.6);
      var r = (p.r === undefined) ? 0.5 : p.r;
      var det = 0.88 + r * 0.26;

      /* 低い踏み込み */
      var o = osc(ctx, 'sine', m.thF * det);
      o.frequency.setValueAtTime(m.thF * det * 1.9, t0);
      o.frequency.exponentialRampToValueAtTime(m.thF * det * 0.62, t0 + m.thD);
      chain([o, hit(ctx, t0, m.thG * lv, 0.004, m.thD), dest]);
      startStop(o, t0, m.thD + 0.05);

      /* 擦れ（帯域ノイズ） */
      var n = noiseSrc(ctx, 0.85 + r * 0.3);
      var f = bq(ctx, 'bandpass', m.bpF * det, m.bpQ);
      if (p.mat === 'water') {
        f.frequency.setValueAtTime(m.bpF * 1.7, t0);
        f.frequency.exponentialRampToValueAtTime(m.bpF * 0.55, t0 + m.nD);
      }
      chain([n, f, hit(ctx, t0, m.nG * lv, 0.003, m.nD), dest]);
      startStop(n, t0, m.nD + 0.06);

      /* 金属・硝子の余韻 */
      if (m.ring) {
        var n2 = noiseSrc(ctx, 1.0);
        var f2 = bq(ctx, 'bandpass', m.ring * det, 12);
        chain([n2, f2, hit(ctx, t0 + 0.004, m.ringG * lv, 0.003, m.ringD), dest]);
        startStop(n2, t0, m.ringD + 0.08);
      }
      /* 硝子は粒が散る */
      if (p.mat === 'glass') {
        for (var i = 0; i < 3; i++) {
          var tt = t0 + 0.02 + i * (0.028 + r * 0.02);
          var n3 = noiseSrc(ctx, 1.4);
          var f3 = bq(ctx, 'bandpass', 5200 + i * 1500, 9);
          chain([n3, f3, hit(ctx, tt, 0.13 * lv, 0.002, 0.045), dest]);
          startStop(n3, tt, 0.07);
        }
      }
      return Math.max(m.nD, m.thD, m.ringD) + 0.12;
    },

    /** 音地盤を走って踏んだ＝「音イベントが起きた」と分かる強い音 */
    noiseStep: function (ctx, dest, t0, p) {
      VOICES.footstep(ctx, dest, t0, { mat: p.mat || 'water', level: 1.45, r: p.r });
      /* 施設に響く残響（帯域ノイズの長い尾） */
      var n = noiseSrc(ctx, 0.6);
      var f = bq(ctx, 'bandpass', (p.mat === 'glass') ? 2600 : 1100, 1.4);
      chain([n, f, hit(ctx, t0 + 0.02, 0.16, 0.010, 0.55), dest]);
      startStop(n, t0, 0.7);
      return 0.75;
    },

    /** 呼吸ひと息（吸う→吐く）。p: {level, exhale} */
    breath: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 0.5 : p.level;
      var n = noiseSrc(ctx, 0.5);
      var f = bq(ctx, 'bandpass', p.exhale ? 480 : 760, 1.2);
      f.frequency.setValueAtTime(p.exhale ? 700 : 420, t0);
      f.frequency.linearRampToValueAtTime(p.exhale ? 380 : 820, t0 + 0.42);
      chain([n, f, swell(ctx, t0, 0.22 * lv, 0.14, 0.10, 0.26), dest]);
      startStop(n, t0, 0.62);
      return 0.62;
    },

    /** 息切れ（走り続けた時の荒い呼吸） */
    pant: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 0.7 : p.level;
      var n = noiseSrc(ctx, 0.7);
      var f = bq(ctx, 'bandpass', 620, 0.9);
      f.frequency.setValueAtTime(900, t0);
      f.frequency.exponentialRampToValueAtTime(360, t0 + 0.20);
      chain([n, f, hit(ctx, t0, 0.34 * lv, 0.030, 0.20), dest]);
      startStop(n, t0, 0.30);
      /* 喉の鳴り（かすかな有声成分） */
      var o = osc(ctx, 'triangle', 128);
      o.frequency.exponentialRampToValueAtTime(96, t0 + 0.18);
      chain([o, bq(ctx, 'lowpass', 700, 0.8), hit(ctx, t0, 0.055 * lv, 0.020, 0.16), dest]);
      startStop(o, t0, 0.26);
      return 0.34;
    },

    /**
     * 心拍（二拍）。P4.13 項目3「鼓動の強化」（契約 §4）。
     *
     *   第1音「ドッ」… 40〜70Hz を主体にした重い打（低域<120Hz が全体の半分以上）。
     *   第2音「クン」… 120〜160ms 後に入る、短く軽い打。
     *   p.near (0..1) … 近さ。1 に寄るほど基音を下げ・減衰を伸ばして
     *                   「胸に響く厚み」（ローパス寄りの圧）を作る。5m で 1。
     *
     * 音量は p.level（heartbeatFor の level。最大 HB_LEVEL_CAP=1.725）で決まる。
     * 最大でもクリップしない配分にしてある（レンダで peak<0.98 を機械テストが見る）。
     */
    heartbeat: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 0.8 : p.level;
      var near = clamp((p.near === undefined) ? 0 : p.near, 0, 1);
      var gap = 0.128 + near * 0.026;      /* 第2音までの間（契約: 120〜160ms） */
      var d1 = 0.155 + near * 0.055;       /* 近いほど長く尾を引く＝胸に残る圧 */

      /* --- 第1音「ドッ」: 40〜70Hz 主体 --- */
      var f1 = 66 - near * 12;             /* 立ち上がりの高さ 66→54Hz */
      var fEnd = 42 - near * 4;            /* 沈み込む先 42→38Hz */
      var o1 = osc(ctx, 'sine', f1);
      o1.frequency.setValueAtTime(f1, t0);
      o1.frequency.exponentialRampToValueAtTime(fEnd, t0 + d1);
      /* 厚みは「重ねた低域」で作る＝上の帯域を足さないので低域比率が下がらない */
      chain([o1, bq(ctx, 'lowpass', 150 + near * 40, 0.9),
        hit(ctx, t0, 0.638 * lv, 0.010, d1), dest]);
      startStop(o1, t0, d1 + 0.08);

      var o1b = osc(ctx, 'sine', f1 * 1.5);
      o1b.frequency.exponentialRampToValueAtTime(fEnd * 1.5, t0 + d1 * 0.8);
      chain([o1b, bq(ctx, 'lowpass', 190, 0.8),
        hit(ctx, t0, (0.188 + near * 0.075) * lv, 0.008, d1 * 0.7), dest]);
      startStop(o1b, t0, d1 + 0.06);

      /* 胸を叩く打点（超低域のノイズ。ローパスで<120Hz に閉じ込める） */
      var n1 = noiseSrc(ctx, 0.30);
      chain([n1, bq(ctx, 'lowpass', 105, 0.7),
        hit(ctx, t0, (0.213 + near * 0.113) * lv, 0.005, 0.075), dest]);
      startStop(n1, t0, 0.12);

      /* --- 第2音「クン」: 短く軽い --- */
      var t2 = t0 + gap;
      var d2 = 0.085 + near * 0.020;
      var o2 = osc(ctx, 'sine', 96 - near * 10);
      o2.frequency.exponentialRampToValueAtTime(58 - near * 6, t2 + d2);
      chain([o2, hit(ctx, t2, 0.288 * lv, 0.006, d2), dest]);
      startStop(o2, t2, d2 + 0.05);
      /* 弁が閉じる短い擦れ（軽さを出すぶん帯域は上） */
      var n2 = noiseSrc(ctx, 0.55);
      chain([n2, bq(ctx, 'bandpass', 520, 1.1),
        hit(ctx, t2, 0.113 * lv, 0.004, 0.045), dest]);
      startStop(n2, t2, 0.08);

      return gap + d1 + 0.12;
    },

    /* ---------------- 環境 ---------------- */

    /** 配管の滴り */
    drip: function (ctx, dest, t0, p) {
      var r = (p.r === undefined) ? 0.5 : p.r;
      var o = osc(ctx, 'sine', 900);
      o.frequency.setValueAtTime(1500 + r * 700, t0);
      o.frequency.exponentialRampToValueAtTime(220 + r * 90, t0 + 0.075);
      chain([o, hit(ctx, t0, 0.42, 0.002, 0.085), dest]);
      startStop(o, t0, 0.14);
      /* 水面のはじけ */
      var n = noiseSrc(ctx, 1.2);
      chain([n, bq(ctx, 'bandpass', 2600 + r * 900, 3), hit(ctx, t0, 0.16, 0.002, 0.045), dest]);
      startStop(n, t0, 0.07);
      /* 反響（短いディレイ2発） */
      for (var i = 1; i <= 2; i++) {
        var t = t0 + 0.11 * i + r * 0.03;
        var o2 = osc(ctx, 'sine', 520 - i * 60);
        chain([o2, bq(ctx, 'lowpass', 1400, 0.8), hit(ctx, t, 0.10 / i, 0.003, 0.10), dest]);
        startStop(o2, t, 0.16);
      }
      return 0.45;
    },

    /** 遠くの金属音（配管を叩く音・扉が軋む音） */
    metalFar: function (ctx, dest, t0, p) {
      var r = (p.r === undefined) ? 0.5 : p.r;
      var base = 150 + r * 190;
      for (var i = 0; i < 3; i++) {
        var n = noiseSrc(ctx, 0.8 + i * 0.2);
        var f = bq(ctx, 'bandpass', base * (1 + i * 1.63), 14 + i * 6);
        chain([n, f, hit(ctx, t0, 0.30 / (i + 1), 0.004, 0.9 + i * 0.35), dest]);
        startStop(n, t0, 1.5);
      }
      var n2 = noiseSrc(ctx, 0.5);
      chain([n2, bq(ctx, 'lowpass', 420, 0.7), hit(ctx, t0, 0.13, 0.006, 0.5), dest]);
      startStop(n2, t0, 0.7);
      return 1.6;
    },

    /* ---------------- 敵 ---------------- */

    /** 引きずる足（直立形態の徘徊音） */
    enemyDrag: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      var n = noiseSrc(ctx, 0.45 + r * 0.2);
      var f = bq(ctx, 'bandpass', 620 + r * 220, 0.8);
      f.frequency.linearRampToValueAtTime(300, t0 + 0.30);
      chain([n, f, swell(ctx, t0, 0.30 * lv, 0.055, 0.09, 0.19), dest]);
      startStop(n, t0, 0.40);
      var o = osc(ctx, 'sine', 62);
      chain([o, hit(ctx, t0 + 0.24, 0.34 * lv, 0.006, 0.11), dest]);
      startStop(o, t0, 0.42);
      return 0.42;
    },

    /** 低い呻き（壁越しでも届く低域が主） */
    enemyMoan: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      var f0 = 74 + r * 26;
      var dur = 1.8 + r * 0.9;
      var o = osc(ctx, 'sawtooth', f0);
      o.frequency.setValueAtTime(f0 * 1.08, t0);
      o.frequency.linearRampToValueAtTime(f0 * 0.80, t0 + dur);
      var fm = bq(ctx, 'lowpass', 380, 3.2);
      fm.frequency.setValueAtTime(240, t0);
      fm.frequency.linearRampToValueAtTime(520, t0 + dur * 0.4);
      fm.frequency.linearRampToValueAtTime(180, t0 + dur);
      chain([o, fm, swell(ctx, t0, 0.30 * lv, 0.32, dur * 0.35, dur * 0.55), dest]);
      startStop(o, t0, dur + 0.2);
      /* 息の擦れ */
      var n = noiseSrc(ctx, 0.4);
      chain([n, bq(ctx, 'bandpass', 900, 1.1), swell(ctx, t0, 0.055 * lv, 0.30, dur * 0.3, dur * 0.5), dest]);
      startStop(n, t0, dur + 0.2);
      return dur + 0.25;
    },

    /** 関節の鳴り */
    enemyJoint: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      for (var i = 0; i < 2; i++) {
        var t = t0 + i * (0.045 + r * 0.04);
        var n = noiseSrc(ctx, 1.1);
        chain([n, bq(ctx, 'bandpass', 1700 + i * 900 + r * 500, 10), hit(ctx, t, 0.30 * lv, 0.002, 0.035), dest]);
        startStop(n, t, 0.06);
      }
      return 0.16;
    },

    /** 疾走の爪音（反転形態） */
    enemyClaw: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      var n = noiseSrc(ctx, 1.5 + r * 0.4);
      var f = bq(ctx, 'bandpass', 3400 + r * 1400, 6);
      f.frequency.exponentialRampToValueAtTime(1500, t0 + 0.07);
      chain([n, f, hit(ctx, t0, 0.42 * lv, 0.002, 0.070), dest]);
      startStop(n, t0, 0.11);
      var o = osc(ctx, 'sine', 110);
      o.frequency.exponentialRampToValueAtTime(48, t0 + 0.09);
      chain([o, hit(ctx, t0, 0.30 * lv, 0.003, 0.090), dest]);
      startStop(o, t0, 0.13);
      return 0.16;
    },

    /** 形態遷移: 骨の鳴る音（連なる破裂） */
    boneCrack: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var rnd = lcg(7717);
      var n8 = 9;
      for (var i = 0; i < n8; i++) {
        var t = t0 + Math.pow(i / n8, 1.4) * 0.85 + rnd() * 0.02;
        var n = noiseSrc(ctx, 1.0 + rnd() * 0.8);
        chain([n, bq(ctx, 'bandpass', 700 + rnd() * 2600, 11), hit(ctx, t, (0.30 + rnd() * 0.30) * lv, 0.002, 0.030), dest]);
        startStop(n, t, 0.05);
        var o = osc(ctx, 'triangle', 180 + rnd() * 260);
        chain([o, hit(ctx, t, 0.13 * lv, 0.002, 0.045), dest]);
        startStop(o, t, 0.07);
      }
      /* 軟部の軋み */
      var nn = noiseSrc(ctx, 0.3);
      var ff = bq(ctx, 'bandpass', 420, 2.5);
      ff.frequency.linearRampToValueAtTime(160, t0 + 0.9);
      chain([nn, ff, swell(ctx, t0, 0.16 * lv, 0.12, 0.45, 0.35), dest]);
      startStop(nn, t0, 1.0);
      return 1.05;
    },

    /** 形態遷移: 短い絶叫 */
    scream: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var dur = (p.dur === undefined) ? 0.85 : p.dur;
      /* 3声の不安定な倍音 */
      var mults = [1, 1.49, 2.02];
      for (var i = 0; i < mults.length; i++) {
        var o = osc(ctx, 'sawtooth', 320 * mults[i]);
        o.frequency.setValueAtTime(230 * mults[i], t0);
        o.frequency.exponentialRampToValueAtTime(880 * mults[i], t0 + dur * 0.22);
        o.frequency.exponentialRampToValueAtTime(300 * mults[i], t0 + dur);
        var f = bq(ctx, 'bandpass', 1400 + i * 700, 2.0);
        chain([o, f, swell(ctx, t0, (0.26 / (i + 1)) * lv, 0.035, dur * 0.35, dur * 0.55), dest]);
        startStop(o, t0, dur + 0.2);
      }
      /* 喉の破裂音 */
      var n = noiseSrc(ctx, 1.0);
      var fn = bq(ctx, 'bandpass', 2200, 1.0);
      fn.frequency.exponentialRampToValueAtTime(700, t0 + dur);
      chain([n, fn, swell(ctx, t0, 0.20 * lv, 0.02, dur * 0.3, dur * 0.6), dest]);
      startStop(n, t0, dur + 0.2);
      return dur + 0.25;
    },

    /**
     * P4.10（契約 §4「罠が鳴った瞬間、敵の絶叫が施設全体に響く」）。
     * scream より長く・低い成分を足して遠くまで届かせる。方向は _route の
     * StereoPanner が付ける（この関数は音色だけを作る純関数のまま）。
     */
    shriek: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var dur = (p.dur === undefined) ? 1.60 : p.dur;
      /* 上に伸びる悲鳴（scream をそのまま重ねて芯にする） */
      VOICES.scream(ctx, dest, t0, { level: 1.15 * lv, dur: dur * 0.62 });
      /* 遠くまで届く低い唸り（壁越しのローパスでも残る帯域） */
      var mults = [0.5, 0.755, 1.007];
      for (var i = 0; i < mults.length; i++) {
        var o = osc(ctx, 'sawtooth', 120 * mults[i]);
        o.frequency.setValueAtTime(96 * mults[i], t0);
        o.frequency.exponentialRampToValueAtTime(210 * mults[i], t0 + dur * 0.30);
        o.frequency.exponentialRampToValueAtTime(78 * mults[i], t0 + dur);
        var f = bq(ctx, 'lowpass', 900, 1.2);
        chain([o, f, swell(ctx, t0, (0.30 / (i + 1)) * lv, 0.05, dur * 0.45, dur * 0.50), dest]);
        startStop(o, t0, dur + 0.25);
      }
      /* 息の擦れ（尾を引かせて「施設に響く」感じを作る） */
      var n = noiseSrc(ctx, 1.0);
      var fn = bq(ctx, 'bandpass', 1500, 0.8);
      fn.frequency.exponentialRampToValueAtTime(480, t0 + dur);
      chain([n, fn, swell(ctx, t0, 0.16 * lv, 0.04, dur * 0.5, dur * 0.55), dest]);
      startStop(n, t0, dur + 0.25);
      return dur + 0.30;
    },

    /** 発見スティング（不協和音の刺し音） */
    sting: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      /* 短2度＋三全音の束 */
      var fs = [196, 207.65, 277.18, 415.3, 830.6];
      for (var i = 0; i < fs.length; i++) {
        var o = osc(ctx, i < 3 ? 'sawtooth' : 'square', fs[i]);
        o.frequency.setValueAtTime(fs[i] * 1.02, t0);
        o.frequency.linearRampToValueAtTime(fs[i] * 0.97, t0 + 0.9);
        var f = bq(ctx, 'lowpass', 5200, 1.0);
        f.frequency.exponentialRampToValueAtTime(700, t0 + 0.9);
        chain([o, f, hit(ctx, t0, (0.20 / (1 + i * 0.55)) * lv, 0.004, 0.85), dest]);
        startStop(o, t0, 1.0);
      }
      /* ノイズの立ち上がり */
      var n = noiseSrc(ctx, 1.0);
      var fn = bq(ctx, 'highpass', 1800, 0.7);
      chain([n, fn, hit(ctx, t0, 0.22 * lv, 0.004, 0.30), dest]);
      startStop(n, t0, 0.4);
      /* 腹に来る低音 */
      var o2 = osc(ctx, 'sine', 62);
      o2.frequency.exponentialRampToValueAtTime(34, t0 + 0.8);
      chain([o2, hit(ctx, t0, 0.38 * lv, 0.006, 0.80), dest]);
      startStop(o2, t0, 0.95);
      return 1.05;
    },

    /** 追跡解除の減衰音 */
    chaseRelease: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var dur = 1.7;
      var fs = [146.8, 174.6, 220];
      for (var i = 0; i < fs.length; i++) {
        var o = osc(ctx, 'sine', fs[i]);
        o.frequency.exponentialRampToValueAtTime(fs[i] * 0.5, t0 + dur);
        chain([o, swell(ctx, t0, 0.16 * lv / (i + 1), 0.10, 0.3, dur - 0.4), dest]);
        startStop(o, t0, dur + 0.15);
      }
      var n = noiseSrc(ctx, 0.35);
      var f = bq(ctx, 'lowpass', 1200, 0.8);
      f.frequency.exponentialRampToValueAtTime(200, t0 + dur);
      chain([n, f, swell(ctx, t0, 0.10 * lv, 0.08, 0.35, dur - 0.4), dest]);
      startStop(n, t0, dur + 0.15);
      return dur + 0.2;
    },

    /* ================================================================
     * P4.13 項目3「追跡中の緊迫層」（契約 §4）
     *
     *   不協和（短2度・三全音）の持続音が終わりなく上昇し続ける層。
     *   シェパード/リセ式: 1オクターブずつ離れた OCT 本の正弦波が
     *   TEN_CYCLE 秒で 1オクターブ上がり、周期の終わりで最上段が最下段へ回る。
     *   {f, 2f, 4f, …} は回り込みで自分自身へ写るので**継ぎ目が無い**
     *   （＝チャンクを TEN_CYCLE の整数倍で継ぎ足せば境目が聞こえない）。
     *   これを 1／短2度／三全音 の3スタック重ねて不協和にする。
     *
     *   さらに「明るさ」（対数周波数上の釣鐘の中心）を TEN_RISE 秒かけて
     *   押し上げる＝追跡が長引くほど張り詰める。8秒レンダでスペクトル重心が
     *   1秒刻みで単調上昇することを機械テストが数値で見る。
     *
     *   p.dur   … 長さ(s)。TEN_CYCLE の整数倍へ丸める（継ぎ目対策）
     *   p.t1    … 開始時点での経過秒（再武装時に明るさの傾きを継ぐ）
     *   p.level … 音量
     * ============================================================== */
    tension: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var cycles = Math.max(1, Math.ceil((((p.dur === undefined) ? TEN_CYCLE * 2 : p.dur) / TEN_CYCLE) - 1e-6));
      var span = cycles * TEN_CYCLE;
      var elapsed = (p.t1 === undefined) ? 0 : p.t1;
      var rise = (p.rise === undefined) ? TEN_RISE : p.rise;
      var steps = Math.ceil(span / TEN_STEP);

      /* 明るさ（釣鐘の中心）を対数周波数で返す */
      function centerAt(tau) {
        var k = clamp((elapsed + tau) / rise, 0, 1);
        return TEN_C0 + (TEN_C1 - TEN_C0) * k;      /* オクターブ番号（log2 Hz） */
      }
      /* 時刻 tau における「下から数えたオクターブ位置」。
         1周期で1段上がり、最上段まで行くと最下段へ回る（回り込みは釣鐘の裾＝無音） */
      function slotAt(k, tau) {
        var c = Math.floor(tau / TEN_CYCLE + 1e-9);
        var u = (tau - c * TEN_CYCLE) / TEN_CYCLE;
        return ((k + c) % TEN_OCT) + u;
      }

      var i, s2, k2;
      for (s2 = 0; s2 < TEN_STACK.length; s2++) {
        var base = Math.log(TEN_BASE * TEN_STACK[s2]) / Math.LN2;
        for (k2 = 0; k2 < TEN_OCT; k2++) {
          /* 先に包絡を計算して、この区間で一度も鳴らない本は作らない（無駄な自動化を省く） */
          var vals = new Array(steps + 1), maxv = 0;
          for (i = 0; i <= steps; i++) {
            var tau = Math.min(i * TEN_STEP, span);
            var x = (base + slotAt(k2, tau) - centerAt(tau)) / TEN_WIDTH;
            var v = TEN_AMP * lv * Math.exp(-x * x);
            if (v < 1e-5) v = 0;
            vals[i] = v;
            if (v > maxv) maxv = v;
          }
          if (maxv <= 0) continue;

          var o = osc(ctx, 'sine', Math.pow(2, base + (k2 % TEN_OCT)));
          /* 周波数: 1周期で ×2。最上段からの回り込みだけ跳ぶ（そこは無音） */
          for (var c2 = 0; c2 < cycles; c2++) {
            var tc = t0 + c2 * TEN_CYCLE;
            var f0 = Math.pow(2, base + ((k2 + c2) % TEN_OCT));
            o.frequency.setValueAtTime(f0, tc);
            o.frequency.exponentialRampToValueAtTime(f0 * 2, tc + TEN_CYCLE);
          }
          var g = ctx.createGain();
          g.gain.setValueAtTime(vals[0], t0);
          for (i = 1; i <= steps; i++) {
            /* 無音が続く区間は点を打たない（0→0 の直線は書かなくても同じ） */
            if (vals[i] === 0 && vals[i - 1] === 0) continue;
            g.gain.linearRampToValueAtTime(vals[i], t0 + Math.min(i * TEN_STEP, span));
          }
          chain([o, g, dest]);
          startStop(o, t0, span);
        }
      }

      /* 上がっていく空気（釣鐘の中心に追随するバンドパス）。重心の上昇を支える。
         音量は一定にしておく＝チャンクを繋いだ時に段差にならない */
      var n = noiseSrc(ctx, 0.9);
      var bp = bq(ctx, 'bandpass', Math.pow(2, centerAt(0) + 0.35), 1.4);
      for (var j = 0; j <= steps; j++) {
        var ta = Math.min(j * TEN_STEP, span);
        var fc = Math.pow(2, centerAt(ta) + 0.35);
        if (j === 0) bp.frequency.setValueAtTime(fc, t0);
        else bp.frequency.linearRampToValueAtTime(fc, t0 + ta);
      }
      chain([n, bp, gainOf(ctx, 0.052 * lv), dest]);
      startStop(n, t0, span);
      return span;
    },

    /** 追跡中の自分の荒い呼吸（吸って吐く1組。喉の鳴りを混ぜる） */
    raggedBreath: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      /* 吸う（詰まった短い吸気） */
      var n1 = noiseSrc(ctx, 0.85 + r * 0.25);
      var f1 = bq(ctx, 'bandpass', 900 + r * 260, 0.85);
      f1.frequency.exponentialRampToValueAtTime(1500, t0 + 0.20);
      chain([n1, f1, swell(ctx, t0, 0.341 * lv, 0.045, 0.055, 0.16), dest]);
      startStop(n1, t0, 0.32);
      /* 喉の震え（呼吸に芯を持たせる） */
      var o = osc(ctx, 'triangle', 138 + r * 22);
      o.frequency.exponentialRampToValueAtTime(112, t0 + 0.22);
      /* 包絡の最初の点は必ず音源の start と同時刻に置く。後ろにずらすと、
         その隙間だけ gain が既定値 1 のまま通り抜けて頭に破裂音が出る */
      chain([o, bq(ctx, 'lowpass', 620, 0.8), hit(ctx, t0, 0.062 * lv, 0.030, 0.17), dest]);
      startStop(o, t0, 0.26);
      /* 吐く（長めに崩れる呼気） */
      var t2 = t0 + 0.27;
      var n2 = noiseSrc(ctx, 0.55 + r * 0.2);
      var f2 = bq(ctx, 'bandpass', 620, 0.7);
      f2.frequency.exponentialRampToValueAtTime(340, t2 + 0.34);
      chain([n2, f2, swell(ctx, t2, 0.297 * lv, 0.05, 0.09, 0.24), dest]);
      startStop(n2, t2, 0.42);
      return 0.72;
    },

    /** 金属の擦過スティンガー（追跡中に2〜4秒間隔で不規則に刺す） */
    metalScrape: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      var dur = 0.42 + r * 0.30;
      /* 擦れの本体（帯域を上へ引きずる） */
      var n = noiseSrc(ctx, 1.15 + r * 0.5);
      var f = bq(ctx, 'bandpass', 1700 + r * 900, 3.2);
      f.frequency.exponentialRampToValueAtTime(3400 + r * 1800, t0 + dur);
      chain([n, f, swell(ctx, t0, 0.315 * lv, 0.030, dur * 0.35, dur * 0.55), dest]);
      startStop(n, t0, dur + 0.15);
      /* 金属の鳴き（不協和な2本） */
      var fs = [2300 + r * 700, (2300 + r * 700) * 1.414];
      for (var i = 0; i < fs.length; i++) {
        var o = osc(ctx, 'sine', fs[i]);
        o.frequency.linearRampToValueAtTime(fs[i] * (1.06 + r * 0.05), t0 + dur);
        /* 包絡の起点は音源の start と同時刻（頭の破裂音を出さない） */
        chain([o, hit(ctx, t0, (0.144 / (i + 1)) * lv, 0.022, dur * 0.8), dest]);
        startStop(o, t0, dur + 0.12);
      }
      /* 下に残る軋み */
      var n2 = noiseSrc(ctx, 0.4);
      chain([n2, bq(ctx, 'bandpass', 320, 2.0), swell(ctx, t0, 0.114 * lv, 0.04, 0.10, dur), dest]);
      startStop(n2, t0, dur + 0.2);
      return dur + 0.25;
    },

    /* ------------------------------------------------------------
     * 案5改（P4.15）: すすり泣き → 絶叫
     *
     * 契約 DESIGN.md「P4.15 声の差し替え」の6要件をそのまま構造にしてある。
     *   1 非周期の揺れ … 基音・フォルマントの揺れはすべて walk（ランダムウォーク）。
     *                    正弦のビブラート／トレモロは1つも使わない。
     *   2 二重の声     … 主声＋（±cent 離調・lag 遅れ）の副声。フォルマントの
     *                    中心も時間とともに漂う。
     *   3 息とざらつき … 声の振幅で変調した帯域ノイズ（喉の擦れ）＋絶叫の頭で
     *                    声帯が割れる短い倍音の乱れ。すすり泣きには不規則な吸気。
     *   4 毎回違う     … 乱数は p.seed だけが決める。種が変われば波形が変わる。
     *   5 空間         … 初期反射＋長いテールの残響を通す。絶叫はわずかに近づく。
     *   6 曲線の包絡   … 音量・ピッチは curveTo / walk の曲線。折れ線を作らない。
     *
     * 妥協点（契約で許諾済み）: 冒頭のしゃくり上げは「静→爆」を守るため小さく、
     * 全体ピークの30%以下に収めてある（P4.15 では立ち上がり30ms要件を課さない）。
     *
     * 製品版（audit/voice-samples の 05b からの変更点）:
     *   ・残響量 0.28 -> SOB_WET(0.24)。ゲーム側に環境ドローンが常時鳴っているぶん薄くする。
     *   ・すすり泣き 1.0 -> SOB_G(0.85)。master の DynamicsCompressor（-18dB/5:1）が絶叫だけを
     *     押し込むので、静側を下げて「静→爆」の差をコンプ後にも残す。
     *   ・PK に SOB_TRIM を掛けてレンダのピークを 0.885（契約 0.85〜0.92）へ較正。
     *   ・毎回の再生で p.seed が変わる（js/voice.js が渡す）＝同じ音が二度と完全一致しない。
     *
     * p: level, seed, onset(絶叫の開始=既定 SOB_ONSET), scream(絶叫の長さ),
     *    wob/wobLo/wobHi(揺れ), cents/lag/subG(副声), grit(息とざらつき),
     *    wet(残響量), sobG(すすり泣きの音量)
     * ---------------------------------------------------------- */
    sobScream: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var seed = (p.seed === undefined) ? 20260908 : ((p.seed >>> 0) || 1);
      var SOB = (p.onset === undefined) ? SOB_ONSET : p.onset;   /* ここから絶叫（字幕もここ） */
      var SCR = (p.scream === undefined) ? SOB_SCR : p.scream;
      var wob = (p.wob === undefined) ? 0.025 : p.wob;
      var wLo = (p.wobLo === undefined) ? 3.0 : p.wobLo;
      var wHi = (p.wobHi === undefined) ? 7.0 : p.wobHi;
      var cent = (p.cents === undefined) ? 6.5 : p.cents;
      var lag = (p.lag === undefined) ? 0.013 : p.lag;
      var subG = (p.subG === undefined) ? 0.50 : p.subG;
      var grit = (p.grit === undefined) ? 1.0 : p.grit;
      var wet = (p.wet === undefined) ? SOB_WET : p.wet;
      var sobG = (p.sobG === undefined) ? SOB_G : p.sobG;
      var PK = 0.62 * lv * SOB_TRIM;      /* 内部の基準振幅（SOB_TRIM がレンダのピーク較正） */
      var rnd = lcg(seed);
      var i;

      /* ---- 出口: 乾き＋残響（施設の初期反射＋長めのテール） ---- */
      var out = widen(ctx, dest, 0.34, 9);
      var dry = gainOf(ctx, 0.90); dry.connect(out);
      var early = reverb(ctx, dest, [0.0131, 0.0197, 0.0289], 0.30, 3400, wet * 0.55);
      var tail = reverb(ctx, dest, [0.0713, 0.0931, 0.1277], 0.62, 1900, wet);

      /* =========================================================
       * すすり泣き（t0 .. t0+SOB）
       *   遠く・こもって・小さい。ここが「静」。
       * ======================================================= */
      var sobBus = gainOf(ctx, sobG);
      sobBus.connect(dry);
      var sobSend = gainOf(ctx, 0.85);
      sobBus.connect(sobSend); sobSend.connect(early); sobSend.connect(tail);
      var sobLP = bq(ctx, 'lowpass', 2200, 0.7);   /* 少し遠い＝高域が落ちている */
      sobLP.connect(sobBus);

      /* 冒頭の小さなしゃくり上げ（ピークの30%以下） */
      var gt = t0 + 0.015 + rnd() * 0.02;
      var gn = noiseSrc(ctx, 0.85 + rnd() * 0.2);
      chain([gn, bq(ctx, 'bandpass', 820 + rnd() * 260, 1.0),
        hit(ctx, gt, 0.085 * PK, 0.018, 0.11), sobLP]);
      startStop(gn, gt, 0.16);

      /* しゃくり本体（4〜5回・間隔は不規則） */
      var sobMix = gainOf(ctx, 1);
      sobMix.connect(sobLP);
      var breath = gainOf(ctx, 0.0001);
      var bn = noiseSrc(ctx, 0.45 + rnd() * 0.2);
      chain([bn, bq(ctx, 'lowpass', 760, 0.8), breath, sobLP]);
      startStop(bn, t0, SOB + 0.10);

      var ts = t0 + 0.20 + rnd() * 0.04;
      var sobN = 0, sobSpans = [];
      while (ts < t0 + SOB - 0.20 && sobN < 6) {
        var len = 0.19 + rnd() * 0.07;
        var f0 = 196 + rnd() * 54;
        var amp = PK * 0.115 * (0.72 + 0.28 * ((ts - t0) / SOB));   /* 少しずつ近づく */
        var sVoice = (function (ts2, len2, f02) {
          return voicePair(ctx, ts2, len2 + 0.05, function (u) {
            return f02 * (1 - 0.17 * smooth01(u));                  /* 尻下がりの泣き */
          }, wob * 1.25, wLo, wHi, cent, lag, subG, 1.25, 1.7,
          (seed + sobN * 7717) >>> 0);
        }(ts, len, f0));
        /* 鼻にかかった母音（低い F1・鼻腔の反共振） */
        var ntc = bq(ctx, 'notch', 640 + rnd() * 120, 2.0);
        sVoice.connect(ntc);
        var sg = gainOf(ctx, 0.0001);
        driftFormants(ctx, ntc, sg, ts, len + 0.05, [
          { a: 300 + rnd() * 40, b: 268, q: 4.0, g: 1.00 },
          { a: 1020 + rnd() * 80, b: 1120, q: 5.0, g: 0.42 },
          { a: 2450, b: 2350, q: 6.0, g: 0.10 }
        ], 0.02 + wob * 0.6, (seed + sobN * 131) >>> 0);
        sg.connect(sobMix);
        curveTo(sg.gain, ts, len, (function (a) {
          return function (u) {
            return a * (smooth01(Math.min(u / 0.22, 1)) * Math.pow(0.02, Math.max(0, u - 0.35) / 0.65) + 0.004);
          };
        }(amp)), 28);
        /* 息（声の振幅で変調した低域ノイズ） */
        curveTo(breath.gain, ts, len + 0.03, (function (a) {
          return function (u) {
            return a * 0.55 * grit * (smooth01(Math.min(u / 0.30, 1)) * (1 - smooth01(Math.max(0, u - 0.45) / 0.55)) + 0.006);
          };
        }(amp)), 20);
        /* 不規則な吸気（しゃくり上げ）。半分くらいの確率で挟む */
        if (rnd() < 0.62) {
          var it = ts + len + 0.02 + rnd() * 0.05;
          var inn = noiseSrc(ctx, 1.0 + rnd() * 0.5);
          var ibp = bq(ctx, 'bandpass', 1150 + rnd() * 700, 1.4);
          chain([inn, ibp, hit(ctx, it, PK * 0.055 * grit, 0.012, 0.055 + rnd() * 0.05), sobLP]);
          startStop(inn, it, 0.14);
        }
        sobSpans.push([ts, ts + len]);
        ts += len + 0.055 + rnd() * 0.11;
        sobN++;
      }

      /* =========================================================
       * 絶叫（t0+SOB .. t0+SOB+SCR）
       *   ここが「爆」。近づきながら裏返る。
       * ======================================================= */
      var st = t0 + SOB;
      /* 遠近: 乾いた音が増え、残響が減る＝近づいてくる */
      var scrNear = gainOf(ctx, 1);
      curveTo(scrNear.gain, st, SCR, function (u) { return 0.80 + 0.20 * smooth01(Math.min(u / 0.45, 1)); }, 24);
      scrNear.connect(dry);
      var scrSend = gainOf(ctx, 1);
      curveTo(scrSend.gain, st, SCR, function (u) { return 0.95 - 0.42 * smooth01(u); }, 20);
      scrSend.connect(early); scrSend.connect(tail);
      var scrOpen = bq(ctx, 'lowpass', 3800, 0.7);   /* 近づくと開く */
      curveTo(scrOpen.frequency, st, SCR, function (u) { return 3800 + 6200 * smooth01(Math.min(u / 0.40, 1)); }, 20);
      scrOpen.connect(scrNear); scrOpen.connect(scrSend);

      /* 基音: 560 -> 1400 へ跳ね上がり、山を保ってから落ちる（S字） */
      function scrF0(u) {
        var f = 560 + 840 * (1 - Math.pow(1 - smooth01(Math.min(u / 0.24, 1)), 1.6));
        if (u > 0.46) f -= 700 * smooth01((u - 0.46) / 0.54);
        return f;
      }
      var sv = voicePair(ctx, st, SCR + 0.06, scrF0, wob, wLo, wHi, cent, lag, subG, 2.3, 3.3,
        (seed * 2654435761) >>> 0);
      var scrEnv = gainOf(ctx, 0.0001);
      /* 母音 a -> i（中心は漂う） */
      driftFormants(ctx, sv, scrEnv, st, SCR, [
        { a: 820, b: 340, q: 5.2, g: 1.00 },
        { a: 1240, b: 2420, q: 5.8, g: 0.78 },
        { a: 2880, b: 3120, q: 6.6, g: 0.30 }
      ], 0.02 + wob * 0.6, (seed + 4242) >>> 0);
      var raw = gainOf(ctx, 0.18); sv.connect(raw); raw.connect(scrEnv);   /* 潰れた芯 */
      scrEnv.connect(scrOpen);

      function scrAmp(u) {
        var a = smooth01(Math.min(u / 0.055, 1));                 /* S字の立ち上がり */
        var body = (u < 0.50) ? 1 : Math.pow(0.03, (u - 0.50) / 0.50);
        return PK * (a * body + 0.002);
      }
      curveTo(scrEnv.gain, st, SCR, scrAmp, 56);

      /* 喉の擦れ（声の振幅で変調した帯域ノイズ） */
      var tn = noiseSrc(ctx, 1.0);
      var tbp = bq(ctx, 'bandpass', 2600, 0.9);
      curveTo(tbp.frequency, st, SCR, function (u) { return 2600 - 1400 * smooth01(u); }, 16);
      var tg = gainOf(ctx, 0.0001);
      curveTo(tg.gain, st, SCR, function (u) { return scrAmp(u) * 0.34 * grit; }, 40);
      chain([tn, tbp, tg, scrOpen]);
      startStop(tn, st, SCR + 0.08);

      /* 声帯が割れる粗さ（頭 0.15 秒に短い倍音の乱れを不規則に置く） */
      var nb = 3 + Math.round(grit * 2);
      for (i = 0; i < nb; i++) {
        var bt = st + 0.004 + rnd() * 0.145;
        var bf = 620 + rnd() * 1600;
        var bo = osc(ctx, 'sawtooth', bf);
        bo.frequency.exponentialRampToValueAtTime(bf * (0.52 + rnd() * 0.55), bt + 0.06);
        chain([bo, shaper(ctx, 3.0),
          hit(ctx, bt, PK * 0.20 * grit, 0.004, 0.030 + rnd() * 0.045), scrOpen]);
        startStop(bo, bt, 0.13);
      }

      return SOB + SCR + 1.30;   /* 残響のテールまで含めた実尺 */
    },

    /** 捕獲（耳元の音） */
    capture: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      /* 掴まれる衝撃 */
      var o = osc(ctx, 'sine', 120);
      o.frequency.exponentialRampToValueAtTime(38, t0 + 0.22);
      chain([o, hit(ctx, t0, 0.90 * lv, 0.004, 0.24), dest]);
      startStop(o, t0, 0.32);
      var n = noiseSrc(ctx, 0.9);
      chain([n, bq(ctx, 'bandpass', 1300, 0.9), hit(ctx, t0, 0.50 * lv, 0.003, 0.16), dest]);
      startStop(n, t0, 0.24);
      /* 耳元の絶叫 */
      VOICES.scream(ctx, dest, t0 + 0.05, { level: 1.15 * lv, dur: 1.10 });
      /* 布と骨 */
      VOICES.boneCrack(ctx, dest, t0 + 0.16, { level: 0.55 * lv });
      /* 意識が落ちる: 高域が閉じていく耳鳴り */
      var o2 = osc(ctx, 'sine', 3200);
      o2.frequency.exponentialRampToValueAtTime(1400, t0 + 1.6);
      chain([o2, swell(ctx, t0 + 0.25, 0.10 * lv, 0.15, 0.5, 0.9), dest]);
      startStop(o2, t0 + 0.25, 1.7);
      return 1.9;
    },

    /* ---------------- 仕掛け ---------------- */

    /** レバー投入: 重い駆動音（施設全体に響く） */
    lever: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      /* 層が重なるので voice 内でまとめて頭を抑える（peak <= 1.0 を保つ） */
      var out = gainOf(ctx, 0.80);
      out.connect(dest);
      dest = out;
      /* 掛け金のクランク */
      var n0 = noiseSrc(ctx, 1.0);
      chain([n0, bq(ctx, 'bandpass', 1600, 4), hit(ctx, t0, 0.38 * lv, 0.002, 0.09), dest]);
      startStop(n0, t0, 0.14);
      var o0 = osc(ctx, 'sine', 150);
      o0.frequency.exponentialRampToValueAtTime(52, t0 + 0.18);
      chain([o0, hit(ctx, t0 + 0.01, 0.44 * lv, 0.004, 0.20), dest]);
      startStop(o0, t0, 0.28);
      /* 起動する発電機（唸り） */
      var dur = 2.6;
      var o1 = osc(ctx, 'sawtooth', 34);
      o1.frequency.setValueAtTime(24, t0 + 0.10);
      o1.frequency.linearRampToValueAtTime(56, t0 + 1.4);
      o1.frequency.linearRampToValueAtTime(50, t0 + dur);
      var f1 = bq(ctx, 'lowpass', 200, 4.5);
      f1.frequency.linearRampToValueAtTime(420, t0 + 1.2);
      chain([o1, f1, swell(ctx, t0 + 0.10, 0.38 * lv, 0.55, 1.0, 1.0), dest]);
      startStop(o1, t0 + 0.10, dur + 0.2);
      /* 施設の共振（高い倍音の唸り） */
      var o2 = osc(ctx, 'square', 101);
      chain([o2, bq(ctx, 'bandpass', 320, 6), swell(ctx, t0 + 0.35, 0.10 * lv, 0.45, 0.9, 0.9), dest]);
      startStop(o2, t0 + 0.35, dur);
      return dur + 0.3;
    },

    /** 端末のキー操作音 */
    terminalKey: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var o = osc(ctx, 'square', 1180);
      chain([o, bq(ctx, 'bandpass', 1180, 3), hit(ctx, t0, 0.20 * lv, 0.002, 0.038), dest]);
      startStop(o, t0, 0.06);
      return 0.08;
    },

    /** 端末のエラー音 */
    terminalErr: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      for (var i = 0; i < 2; i++) {
        var t = t0 + i * 0.16;
        var o = osc(ctx, 'square', 174);
        chain([o, bq(ctx, 'lowpass', 900, 1.2), hit(ctx, t, 0.28 * lv, 0.004, 0.11), dest]);
        startStop(o, t, 0.16);
      }
      return 0.35;
    },

    /** 端末の解錠音 */
    terminalOk: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var fs = [523.25, 659.25];
      for (var i = 0; i < fs.length; i++) {
        var t = t0 + i * 0.11;
        var o = osc(ctx, 'triangle', fs[i]);
        chain([o, hit(ctx, t, 0.16 * lv, 0.005, 0.20), dest]);
        startStop(o, t, 0.26);
      }
      /* 遠くで隔壁の錠が外れる */
      var n = noiseSrc(ctx, 0.5);
      chain([n, bq(ctx, 'lowpass', 500, 1.0), hit(ctx, t0 + 0.30, 0.22 * lv, 0.010, 0.45), dest]);
      startStop(n, t0 + 0.30, 0.55);
      return 0.85;
    },

    /** 隔壁ハンドルの軋み（回している間、短く繰り返す） */
    handleCreak: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      var o = osc(ctx, 'sawtooth', 118 + r * 46);
      var lfo = osc(ctx, 'sine', 17 + r * 9);
      var lg = gainOf(ctx, 26);
      lfo.connect(lg); lg.connect(o.frequency);
      var f = bq(ctx, 'bandpass', 1250 + r * 700, 7);
      chain([o, f, swell(ctx, t0, 0.22 * lv, 0.045, 0.16, 0.16), dest]);
      startStop(o, t0, 0.42);
      startStop(lfo, t0, 0.42);
      var n = noiseSrc(ctx, 0.6);
      chain([n, bq(ctx, 'bandpass', 480, 2.2), swell(ctx, t0, 0.10 * lv, 0.04, 0.16, 0.14), dest]);
      startStop(n, t0, 0.40);
      return 0.42;
    },

    /** 隔壁が開く轟音 */
    doorRoar: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var dur = 3.0;
      /* 巨大な擦過音 */
      var n = noiseSrc(ctx, 0.28);
      var f = bq(ctx, 'lowpass', 260, 3.0);
      f.frequency.linearRampToValueAtTime(900, t0 + 1.1);
      f.frequency.linearRampToValueAtTime(200, t0 + dur);
      chain([n, f, swell(ctx, t0, 0.80 * lv, 0.28, 1.5, 1.1), dest]);
      startStop(n, t0, dur + 0.2);
      /* 金属の共鳴 */
      var res = [88, 143, 268];
      for (var i = 0; i < res.length; i++) {
        var n2 = noiseSrc(ctx, 0.5 + i * 0.3);
        chain([n2, bq(ctx, 'bandpass', res[i], 16), swell(ctx, t0 + 0.1, 0.24 * lv / (i + 1), 0.35, 1.3, 1.2), dest]);
        startStop(n2, t0 + 0.1, dur);
      }
      /* 開ききる衝撃 */
      var o = osc(ctx, 'sine', 74);
      o.frequency.exponentialRampToValueAtTime(30, t0 + dur * 0.86 + 0.35);
      chain([o, hit(ctx, t0 + dur * 0.86, 0.70 * lv, 0.006, 0.40), dest]);
      startStop(o, t0 + dur * 0.86, 0.5);
      return dur + 0.5;
    },

    /** センサー警報 */
    alarm: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var beeps = 6, span = 0.30;
      for (var i = 0; i < beeps; i++) {
        var t = t0 + i * span;
        var fq = (i % 2) ? 932 : 699;
        var o = osc(ctx, 'square', fq);
        chain([o, bq(ctx, 'bandpass', fq, 2.5), hit(ctx, t, 0.34 * lv, 0.006, 0.20), dest]);
        startStop(o, t, 0.26);
        var o2 = osc(ctx, 'sawtooth', fq / 2);
        chain([o2, bq(ctx, 'lowpass', 1400, 1.0), hit(ctx, t, 0.14 * lv, 0.006, 0.18), dest]);
        startStop(o2, t, 0.24);
      }
      return beeps * span + 0.3;
    },

    /** 牢の格子をこじ開ける金属音 */
    pry: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var r = (p.r === undefined) ? 0.5 : p.r;
      var n = noiseSrc(ctx, 0.9 + r * 0.5);
      var f = bq(ctx, 'bandpass', 900 + r * 900, 8);
      f.frequency.linearRampToValueAtTime(2400 + r * 800, t0 + 0.22);
      chain([n, f, swell(ctx, t0, 0.60 * lv, 0.020, 0.10, 0.18), dest]);
      startStop(n, t0, 0.36);
      var res = [196, 411];
      for (var i = 0; i < res.length; i++) {
        var n2 = noiseSrc(ctx, 1.0);
        chain([n2, bq(ctx, 'bandpass', res[i] * (0.9 + r * 0.25), 18), hit(ctx, t0, 0.60 * lv / (i + 1), 0.003, 0.42), dest]);
        startStop(n2, t0, 0.5);
      }
      return 0.55;
    },

    /** 格子が折れて外れる */
    grateBreak: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var n = noiseSrc(ctx, 1.3);
      chain([n, bq(ctx, 'bandpass', 2600, 3), hit(ctx, t0, 0.55 * lv, 0.002, 0.14), dest]);
      startStop(n, t0, 0.2);
      var res = [128, 231, 507];
      for (var i = 0; i < res.length; i++) {
        var n2 = noiseSrc(ctx, 0.8);
        chain([n2, bq(ctx, 'bandpass', res[i], 20), hit(ctx, t0, 0.34 * lv / (i + 1), 0.003, 1.1), dest]);
        startStop(n2, t0, 1.3);
      }
      var o = osc(ctx, 'sine', 90);
      o.frequency.exponentialRampToValueAtTime(40, t0 + 0.3);
      chain([o, hit(ctx, t0 + 0.05, 0.40 * lv, 0.004, 0.30), dest]);
      startStop(o, t0, 0.4);
      return 1.35;
    },

    /** ロッカーの扉 */
    lockerDoor: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var open = !!p.open;
      var n = noiseSrc(ctx, 0.8);
      var f = bq(ctx, 'bandpass', open ? 1400 : 900, 3);
      f.frequency.linearRampToValueAtTime(open ? 700 : 1800, t0 + 0.18);
      chain([n, f, swell(ctx, t0, 0.26 * lv, 0.015, 0.06, 0.14), dest]);
      startStop(n, t0, 0.28);
      var res = [176, 352];
      for (var i = 0; i < res.length; i++) {
        var n2 = noiseSrc(ctx, 1.0);
        chain([n2, bq(ctx, 'bandpass', res[i], 15), hit(ctx, t0 + (open ? 0 : 0.14), 0.24 * lv / (i + 1), 0.003, 0.45), dest]);
        startStop(n2, t0, 0.7);
      }
      return 0.7;
    },

    /* ---------------- P4.6 捕獲シネマティック ---------------- */

    /** 牢の鉄扉が閉まる（重い金属の一撃＋長い共鳴） */
    cellDoor: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      /* 蝶番の軋み → 叩きつけ */
      var n0 = noiseSrc(ctx, 0.5);
      var f0 = bq(ctx, 'bandpass', 620, 6);
      f0.frequency.linearRampToValueAtTime(1250, t0 + 0.24);
      chain([n0, f0, swell(ctx, t0, 0.26 * lv, 0.04, 0.12, 0.12), dest]);
      startStop(n0, t0, 0.34);
      var tb = t0 + 0.28;
      var o = osc(ctx, 'sine', 96);
      o.frequency.exponentialRampToValueAtTime(34, tb + 0.32);
      chain([o, hit(ctx, tb, 0.86 * lv, 0.004, 0.34), dest]);
      startStop(o, tb, 0.44);
      var n1 = noiseSrc(ctx, 1.2);
      chain([n1, bq(ctx, 'bandpass', 2100, 2.2), hit(ctx, tb, 0.44 * lv, 0.002, 0.10), dest]);
      startStop(n1, tb, 0.16);
      /* 鉄格子の共鳴（長く残る） */
      var res = [118, 214, 447, 903];
      for (var i = 0; i < res.length; i++) {
        var n2 = noiseSrc(ctx, 0.7 + i * 0.2);
        chain([n2, bq(ctx, 'bandpass', res[i], 22),
          hit(ctx, tb, 0.30 * lv / (i + 1), 0.003, 1.5 - i * 0.24), dest]);
        startStop(n2, tb, 1.7);
      }
      return 2.0;
    },

    /** 鍵をかける（差し込み → 二段の回転） */
    cellLock: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      /* 鍵を差し込む擦れ */
      var n = noiseSrc(ctx, 1.5);
      chain([n, bq(ctx, 'bandpass', 3100, 3), swell(ctx, t0, 0.20 * lv, 0.02, 0.06, 0.10), dest]);
      startStop(n, t0, 0.22);
      /* かんぬきが2回落ちる */
      for (var k = 0; k < 2; k++) {
        var t = t0 + 0.26 + k * 0.34;
        var o = osc(ctx, 'triangle', 210 - k * 40);
        o.frequency.exponentialRampToValueAtTime(72, t + 0.10);
        chain([o, hit(ctx, t, 0.50 * lv, 0.002, 0.11), dest]);
        startStop(o, t, 0.18);
        var n2 = noiseSrc(ctx, 1.1);
        chain([n2, bq(ctx, 'bandpass', 1750 + k * 500, 9),
          hit(ctx, t, 0.34 * lv, 0.002, 0.16), dest]);
        startStop(n2, t, 0.24);
        var n3 = noiseSrc(ctx, 0.8);
        chain([n3, bq(ctx, 'bandpass', 380, 20), hit(ctx, t, 0.20 * lv, 0.003, 0.55), dest]);
        startStop(n3, t, 0.65);
      }
      return 1.25;
    },

    /** 食われる: 顎の閉じる衝撃＋肉と骨（3回目の捕獲） */
    bite: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      /* 湿った咀嚼のうねり */
      var n = noiseSrc(ctx, 0.45);
      var f = bq(ctx, 'lowpass', 700, 1.4);
      f.frequency.exponentialRampToValueAtTime(180, t0 + 0.55);
      chain([n, f, swell(ctx, t0, 0.62 * lv, 0.01, 0.10, 0.42), dest]);
      startStop(n, t0, 0.7);
      /* 噛み合わせの一撃 */
      var o = osc(ctx, 'sine', 140);
      o.frequency.exponentialRampToValueAtTime(30, t0 + 0.30);
      chain([o, hit(ctx, t0, 0.92 * lv, 0.003, 0.30), dest]);
      startStop(o, t0, 0.42);
      /* 骨 */
      VOICES.boneCrack(ctx, dest, t0 + 0.02, { level: 1.0 * lv });
      VOICES.boneCrack(ctx, dest, t0 + 0.34, { level: 0.7 * lv });
      /* 途切れる絶叫 */
      VOICES.scream(ctx, dest, t0, { level: 0.85 * lv, dur: 0.55 });
      return 1.6;
    },

    /** 資材板を倒す */
    boardCrash: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var rnd = lcg(4241);
      for (var i = 0; i < 5; i++) {
        var t = t0 + Math.pow(i / 5, 1.6) * 0.55;
        var o = osc(ctx, 'triangle', 120 + rnd() * 180);
        chain([o, bq(ctx, 'lowpass', 1400, 1.2), hit(ctx, t, (0.30 + rnd() * 0.25) * lv, 0.003, 0.10 + rnd() * 0.08), dest]);
        startStop(o, t, 0.22);
        var n = noiseSrc(ctx, 0.8 + rnd() * 0.6);
        chain([n, bq(ctx, 'bandpass', 700 + rnd() * 1200, 2.5), hit(ctx, t, 0.22 * lv, 0.002, 0.07), dest]);
        startStop(n, t, 0.12);
      }
      return 0.8;
    },

    /** 紙をめくる（メモを開く/閉じる） */
    paper: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var n = noiseSrc(ctx, 1.6);
      var f = bq(ctx, 'bandpass', 3400, 1.1);
      f.frequency.linearRampToValueAtTime(1800, t0 + 0.22);
      chain([n, f, swell(ctx, t0, 0.16 * lv, 0.04, 0.08, 0.14), dest]);
      startStop(n, t0, 0.30);
      return 0.32;
    },

    /** チェックポイント（かすかな低い鐘） */
    checkpoint: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1 : p.level;
      var fs = [110, 164.8];
      for (var i = 0; i < fs.length; i++) {
        var o = osc(ctx, 'sine', fs[i]);
        chain([o, swell(ctx, t0 + i * 0.05, 0.13 * lv / (i + 1), 0.03, 0.25, 1.0), dest]);
        startStop(o, t0, 1.5);
      }
      return 1.5;
    },

    /* ---------------- P4.10b 音の罠（契約 §4「音の罠（5種以上）」） ---------------- */

    /** 空き缶の散乱を蹴った: 薄い鉄が跳ねて転がる（高い金属の粒が連なる） */
    canRattle: function (ctx, dest, t0, p) {
      /* 既定値が1より大きいのは「罠が鳴った＝音イベントが起きた」と分かる強さにするため
         （契約 §4。通常の足音 peak≈0.29 に対して明確に上に出す） */
      var lv = (p.level === undefined) ? 2.2 : p.level;
      var rnd = lcg(90311);
      for (var i = 0; i < 9; i++) {
        var t = t0 + Math.pow(i / 9, 1.35) * 0.72;
        var f = 2100 + rnd() * 2600;
        /* 缶の胴が鳴る（帯域の狭いノイズ＝金属の輪郭） */
        var n = noiseSrc(ctx, 1.0 + rnd() * 0.7);
        chain([n, bq(ctx, 'bandpass', f, 11), hit(ctx, t, (0.24 - i * 0.014) * lv, 0.002, 0.09 + rnd() * 0.07), dest]);
        startStop(n, t, 0.20);
        /* 床を叩く低い成分 */
        var o = osc(ctx, 'triangle', 190 + rnd() * 160);
        chain([o, bq(ctx, 'lowpass', 1200, 1.0), hit(ctx, t, 0.13 * lv, 0.002, 0.055), dest]);
        startStop(o, t, 0.12);
      }
      /* 転がり続ける尾 */
      var nr = noiseSrc(ctx, 0.9);
      var fr = bq(ctx, 'bandpass', 3100, 3.2);
      fr.frequency.setValueAtTime(3400, t0 + 0.10);
      fr.frequency.exponentialRampToValueAtTime(1500, t0 + 0.95);
      chain([nr, fr, hit(ctx, t0 + 0.10, 0.10 * lv, 0.020, 0.80), dest]);
      startStop(nr, t0 + 0.10, 0.90);
      return 1.05;
    },

    /** 軋む床板を踏んだ: 木が捻れる長い軋み（周波数が上下に揺れる） */
    floorCreak: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1.8 : p.level;
      var rnd = lcg(48819);
      for (var i = 0; i < 3; i++) {
        var t = t0 + i * (0.13 + rnd() * 0.08);
        var o = osc(ctx, 'sawtooth', 150 + rnd() * 90);
        o.frequency.setValueAtTime(210 + rnd() * 120, t);
        o.frequency.linearRampToValueAtTime(118 + rnd() * 60, t + 0.34);
        var f = bq(ctx, 'bandpass', 620 + rnd() * 500, 5.5);
        chain([o, f, swell(ctx, t, 0.17 * lv, 0.035, 0.10, 0.26), dest]);
        startStop(o, t, 0.45);
      }
      /* 釘が抜ける乾いた擦れ */
      var n = noiseSrc(ctx, 0.55);
      chain([n, bq(ctx, 'bandpass', 1450, 3.0), hit(ctx, t0 + 0.02, 0.11 * lv, 0.010, 0.30), dest]);
      startStop(n, t0 + 0.02, 0.40);
      /* 板が床を叩く低音 */
      var lo = osc(ctx, 'sine', 88);
      lo.frequency.setValueAtTime(120, t0);
      lo.frequency.exponentialRampToValueAtTime(62, t0 + 0.20);
      chain([lo, hit(ctx, t0, 0.20 * lv, 0.006, 0.22), dest]);
      startStop(lo, t0, 0.30);
      return 0.85;
    },

    /** 吊るした缶のワイヤーに引っ掛かった: 缶が互いを叩く連打 */
    wireCans: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 3.6 : p.level;
      var rnd = lcg(11507);
      /* 糸が張る（短い唸り） */
      var w = osc(ctx, 'sawtooth', 320);
      w.frequency.setValueAtTime(420, t0);
      w.frequency.exponentialRampToValueAtTime(240, t0 + 0.12);
      chain([w, bq(ctx, 'bandpass', 900, 6), hit(ctx, t0, 0.10 * lv, 0.004, 0.11), dest]);
      startStop(w, t0, 0.20);
      /* 缶どうしの打鍵。減衰しながら14回 */
      for (var i = 0; i < 14; i++) {
        var t = t0 + 0.03 + Math.pow(i / 14, 1.15) * 1.05;
        var g = (0.34 - i * 0.016) * lv;
        if (g < 0.05) g = 0.05;
        var f = 2400 + rnd() * 3000;
        var n = noiseSrc(ctx, 1.1 + rnd() * 0.6);
        chain([n, bq(ctx, 'bandpass', f, 14), hit(ctx, t, g, 0.0015, 0.11 + rnd() * 0.08), dest]);
        startStop(n, t, 0.16);
        var o = osc(ctx, 'square', 520 + rnd() * 420);
        chain([o, bq(ctx, 'bandpass', 1600, 4), hit(ctx, t, g * 0.42, 0.0015, 0.045), dest]);
        startStop(o, t, 0.10);
      }
      return 1.30;
    },

    /** 倒れかけの棚・ロッカーが倒れた: 施設に響く倒壊 */
    furnitureCrash: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 1.3 : p.level;
      var rnd = lcg(70213);
      /* 倒れ始めの軋み */
      var c = osc(ctx, 'sawtooth', 190);
      c.frequency.setValueAtTime(240, t0);
      c.frequency.linearRampToValueAtTime(120, t0 + 0.22);
      chain([c, bq(ctx, 'bandpass', 700, 5), swell(ctx, t0, 0.14 * lv, 0.03, 0.08, 0.14), dest]);
      startStop(c, t0, 0.30);
      /* 着地の衝撃（低音） */
      var b = osc(ctx, 'sine', 74);
      b.frequency.setValueAtTime(132, t0 + 0.22);
      b.frequency.exponentialRampToValueAtTime(46, t0 + 0.62);
      chain([b, hit(ctx, t0 + 0.22, 0.58 * lv, 0.004, 0.46), dest]);
      startStop(b, t0 + 0.22, 0.58);
      var bn = noiseSrc(ctx, 0.45);
      chain([bn, bq(ctx, 'lowpass', 420, 0.9), hit(ctx, t0 + 0.22, 0.26 * lv, 0.004, 0.40), dest]);
      startStop(bn, t0 + 0.22, 0.53);
      /* 鉄板が跳ねる・中身がばら撒かれる */
      for (var i = 0; i < 10; i++) {
        var t = t0 + 0.24 + Math.pow(i / 10, 1.4) * 1.10;
        var g = (0.26 - i * 0.020) * lv;
        if (g < 0.025) g = 0.025;
        var n = noiseSrc(ctx, 0.9 + rnd() * 0.8);
        chain([n, bq(ctx, 'bandpass', 1100 + rnd() * 3200, 5), hit(ctx, t, g, 0.002, 0.10 + rnd() * 0.10), dest]);
        startStop(n, t, 0.24);
      }
      /* 響きの尾（施設全体に届く） */
      var tail = noiseSrc(ctx, 0.5);
      chain([tail, bq(ctx, 'bandpass', 520, 1.2), hit(ctx, t0 + 0.26, 0.16 * lv, 0.030, 1.05), dest]);
      startStop(tail, t0 + 0.26, 1.23);
      return 1.60;
    }
  };

  /* ================================================================
   * 区画ごとの環境ドローン（契約 §4「区画ごとに色味を変える」）
   * ============================================================== */
  var AMB_DEFAULT = { f: 43, f2: 64.5, lp: 175, air: 380, airG: 0.055, g: 0.30 };
  var AMBIENCE = {
    labA:     { f: 54, f2: 81.5, lp: 245, air: 720, airG: 0.075, g: 0.33 },  /* 培養器室: 機械の唸り */
    labB:     { f: 50, f2: 75.5, lp: 230, air: 640, airG: 0.070, g: 0.32 },
    office:   { f: 41, f2: 61.0, lp: 165, air: 300, airG: 0.045, g: 0.26 },
    specimen: { f: 37, f2: 55.8, lp: 145, air: 250, airG: 0.085, g: 0.31 },  /* 飼育檻室: 低く湿る */
    machine:  { f: 58, f2: 87.5, lp: 300, air: 900, airG: 0.095, g: 0.38 },  /* 検体タンク室: 気泡 */
    pump:     { f: 33, f2: 49.8, lp: 130, air: 210, airG: 0.100, g: 0.40 },  /* 循環ポンプ室: 重い */
    control:  { f: 47, f2: 70.8, lp: 260, air: 1150, airG: 0.060, g: 0.29 }, /* 観察モニター室 */
    hall:     { f: 39, f2: 58.2, lp: 190, air: 330, airG: 0.050, g: 0.28 },
    cellroom: { f: 31, f2: 46.6, lp: 120, air: 190, airG: 0.045, g: 0.34 },  /* 拘束室: 圧が下がる */
    lmA:      { f: 44, f2: 66.2, lp: 200, air: 420, airG: 0.060, g: 0.31 },
    lmB:      { f: 42, f2: 63.0, lp: 210, air: 460, airG: 0.062, g: 0.31 },
    lmC:      { f: 40, f2: 60.4, lp: 185, air: 400, airG: 0.058, g: 0.30 },
    rcA:      { f: 30, f2: 45.2, lp: 115, air: 200, airG: 0.075, g: 0.33 },  /* 沈下通路 */
    rcB:      { f: 46, f2: 69.4, lp: 220, air: 500, airG: 0.055, g: 0.29 },
    corrN:    { f: 45, f2: 67.8, lp: 205, air: 430, airG: 0.052, g: 0.29 },
    corrW:    { f: 40, f2: 60.2, lp: 175, air: 340, airG: 0.062, g: 0.30 },
    corrC:    { f: 43, f2: 64.6, lp: 190, air: 390, airG: 0.056, g: 0.30 },
    corrE:    { f: 41, f2: 61.8, lp: 180, air: 360, airG: 0.058, g: 0.30 },
    corrS:    { f: 35, f2: 52.6, lp: 150, air: 260, airG: 0.078, g: 0.33 },  /* 南下層: 水気 */
    /* P4.7 増築ぶん（造形として残置） */
    filter:   { f: 34, f2: 51.2, lp: 135, air: 220, airG: 0.092, g: 0.38 },  /* 濾過槽室: 旧ポンプ室 */
    store:    { f: 36, f2: 54.2, lp: 155, air: 275, airG: 0.048, g: 0.27 },  /* 保管庫: 乾いて静か */
    /* P4.8 増築ぶん（DESIGN.md §4「迷路の根幹＝アリアドネ方式」）。
       排水路(drain)は撤去したので色味も削除した。 */
    director: { f: 38, f2: 57.0, lp: 160, air: 285, airG: 0.040, g: 0.25 },  /* 所長室: 乾いた執務室 */
    /* P4.10: 新マップ Z4 の小部屋。帯＝区画の色味に寄せる
       （A 受入=青白い事務／B 実験=白タイル／C 検体=湿って低い／D 拘束=圧が下がる／F 機械=低い唸り）。
       既定ドローンに落ちる部屋を作らない（区画の見た目と音を必ず一致させる）。 */
    quaran:    { f: 40, f2: 60.2, lp: 178, air: 320, airG: 0.046, g: 0.27 }, /* A 検疫待機室: 乾いた待合 */
    security:  { f: 43, f2: 64.8, lp: 195, air: 380, airG: 0.050, g: 0.28 }, /* A 警備室: monitorの微かな唸り */
    assay:     { f: 51, f2: 76.8, lp: 235, air: 660, airG: 0.068, g: 0.32 }, /* B 検査室: 実験機器の唸り */
    necro:     { f: 36, f2: 54.4, lp: 142, air: 240, airG: 0.088, g: 0.33 }, /* C 剖検室: 冷えて湿る */
    guardpost: { f: 32, f2: 48.2, lp: 125, air: 200, airG: 0.048, g: 0.33 }, /* D 看守室: 圧が下がる */
    visitroom: { f: 30, f2: 45.6, lp: 118, air: 185, airG: 0.042, g: 0.31 }, /* D 面会室: 死んだ空気 */
    elec:      { f: 60, f2: 90.4, lp: 310, air: 940, airG: 0.090, g: 0.39 }  /* F 電気室: 変圧器の低い唸り */
  };

  /* ================================================================
   * P4.13 項目3: 緊迫層のチャンク予約（実機も機械テストもここを通る）
   *
   *   VOICES.tension は「TEN_CYCLE の整数倍」で模様が一巡する。次のチャンクを
   *   ちょうど TEN_HOP（周期の整数倍）ずらして始めれば、両者は同じ模様の同じ位相に
   *   乗る。ただし発振器の位相までは揃わないので、重なりの TEN_XF 秒を
   *   等パワーでクロスフェードして段差（プチッ）を出さない。
   * ============================================================== */
  function fadeCurve(param, t0, dur, up) {
    var N = 8;
    param.setValueAtTime(up ? 0 : 1, t0);
    for (var i = 1; i <= N; i++) {
      var x = i / N;
      /* 等パワー: sin/cos なら無相関な2信号を足しても音量が凹まない */
      var v = up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
      param.linearRampToValueAtTime(v, t0 + dur * x);
    }
  }

  /**
   * 緊迫層を1チャンク予約する。
   *   start   … 鳴り始める時刻（ctx の時間軸）
   *   elapsed … 追跡開始からの経過秒（明るさの傾きを継ぐ）
   *   first   … 先頭のチャンクか（頭のクロスフェードを省く）
   *   hop     … 次のチャンクまでの間隔(s)。既定 TEN_HOP（TEN_CYCLE の整数倍であること）
   * 返り値: { next, elapsed, end }
   */
  function scheduleTensionChunk(ctx, out, start, elapsed, first, hop) {
    var h = hop || TEN_HOP;
    var span = h + TEN_XF;
    var g = ctx.createGain();
    g.gain.value = first ? 1 : 0;
    if (first) g.gain.setValueAtTime(1, start);
    else fadeCurve(g.gain, start, TEN_XF, true);
    fadeCurve(g.gain, start + h, TEN_XF, false);
    g.connect(out);
    VOICES.tension(ctx, g, start, { dur: span, level: 1, t1: elapsed });
    return { next: start + h, elapsed: elapsed + h, end: start + span };
  }

  /* ================================================================
   * P4.12 項目5「鼓動音は敵との距離で強まる」（契約 §4「P4.12 再プレイ差し戻し」）
   *
   *   追跡中に限らず、最も近い個体との距離が HB_START(20m) 以内で鳴り始め、
   *   近いほど速く・大きく（20m=微弱／5m=最大）。追跡中はさらに強調する。
   *   壁越しでも距離だけで判定する＝プレイヤーへの「近い」の情報源。
   *
   * 純関数にしてあるのは、OfflineAudioContext のレンダ検査（距離5/12/20m で
   * RMS が単調増加すること）と、レートの単調性を機械テストで直接見るため。
   * ============================================================== */
  var HB_START = 20.0;          /* 鳴り始める距離(m) */
  var HB_FULL = 5.0;            /* 最大になる距離(m) */
  var HB_BPM_MIN = 62, HB_BPM_MAX = 158;
  /* P4.13 項目3「最大レベルを上げる（現行 HB_LEVEL_CAP の1.5倍を上限目安・クリップ禁止）」
     に合わせて 1.00→1.50 / 1.15→1.725 へ。音色側は最大でも peak<0.98 に収まる配分。 */
  var HB_LEVEL_MIN = 0.10, HB_LEVEL_MAX = 1.50;
  var HB_CURVE = 1.30;          /* 近づくほど急に強まる（遠くは微弱に留める） */
  var HB_CHASE_BPM = 14;        /* 追跡中の上乗せ(bpm) */
  var HB_CHASE_LEVEL = 1.16;    /* 同・音量の倍率 */
  var HB_LEVEL_CAP = 1.725;     /* 心拍の波形が歪まない上限（旧 1.15 の1.5倍） */
  var HB_DUCK_DIST = 5.0;       /* この距離以内で環境音をわずかにダッキング */
  var HB_DUCK_AMOUNT = 0.28;    /* 同・絞る割合（わずか） */

  function heartbeatFor(dist, chase) {
    var d = (typeof dist === 'number' && isFinite(dist)) ? Math.max(0, dist) : Infinity;
    var u = clamp((HB_START - d) / (HB_START - HB_FULL), 0, 1);
    var s = Math.pow(u, HB_CURVE);
    var bpm = HB_BPM_MIN + (HB_BPM_MAX - HB_BPM_MIN) * s;
    var level = HB_LEVEL_MIN + (HB_LEVEL_MAX - HB_LEVEL_MIN) * s;
    if (chase) { bpm += HB_CHASE_BPM; level = Math.min(HB_LEVEL_CAP, level * HB_CHASE_LEVEL); }
    /* near は「胸に響く厚み」の度合い（5m で 1）。音色側 heartbeat の p.near に渡す */
    return { on: !!chase || d <= HB_START, bpm: bpm, level: level, u: u, near: s, dist: d };
  }

  /* ================================================================
   * P4.16 項目3「鼓動の画面表示」（契約 §4「P4.16 再プレイ差し戻し」項目3）
   *
   *   heartbeatFor に同期して**画面の縁が赤く脈打つ**。要素は JS から作る
   *   （index.html はレーンB／メインの領域なので触らない）。既存の周辺減光
   *   （#fx-vignette）とは別レイヤーで、中心から半径40%は常に無着色。
   *
   *   1拍＝2つの衝撃（第1音で強く・第2音で弱く）。それぞれ HBRIM_A で立ち上がり、
   *   HBRIM_TAU で指数減衰する。最速の拍（158+14=172bpm＝周期0.349s）でも
   *   次の拍までにピークの20%以下へ落ちる（契約）。
   * ============================================================== */
  var HBRIM_A = 0.045;        /* 立ち上がり(s) */
  var HBRIM_TAU = 0.090;      /* 減衰の時定数(s) */
  var HBRIM_GAP = 0.145;      /* 第2音までの間(s)。音色側の 120〜160ms に合わせる */
  var HBRIM_SECOND = 0.55;    /* 第2音の強さ（第1音より弱い＝契約） */
  var HBRIM_FAR = 0.12;       /* 20m のピーク不透明度（契約 0.08〜0.15） */
  var HBRIM_NEAR = 0.52;      /* 5m のピーク不透明度（契約 0.45〜0.60） */
  var HBRIM_MAX = 0.60;       /* 追跡中＝最大（契約） */
  var HBRIM_IN_FAR = 72;      /* 20m の無着色半径(%)＝縁だけ薄く光る */
  var HBRIM_IN_NEAR = 40;     /* 5m・追跡中の無着色半径(%)。契約「中心から40%は常に無着色」 */
  var HBRIM_LIFE = 1.2;       /* この秒数を過ぎた衝撃は捨てる */

  /** 1つの衝撃の包絡（0..1）。t<0 は未発火 */
  function hbRimShape(t) {
    if (!(t > 0)) return 0;
    if (t < HBRIM_A) return t / HBRIM_A;
    return Math.exp(-(t - HBRIM_A) / HBRIM_TAU);
  }
  /** 距離・追跡から「縁の赤」のピーク不透明度と無着色半径(%)を出す（純関数） */
  function hbRimFor(dist, chase) {
    var h = heartbeatFor(dist, !!chase);
    var s = clamp(h.near, 0, 1);
    var amp = HBRIM_FAR + (HBRIM_NEAR - HBRIM_FAR) * s;
    var inner = HBRIM_IN_FAR + (HBRIM_IN_NEAR - HBRIM_IN_FAR) * s;
    if (chase) { amp = HBRIM_MAX; inner = HBRIM_IN_NEAR; }
    return { amp: amp, inner: Math.max(HBRIM_IN_NEAR, inner), on: h.on, bpm: h.bpm };
  }
  /** 縁の赤のグラデーション（中心 inner% までは完全に透明＝視認性を保つ） */
  function hbRimGradient(inner) {
    var i0 = Math.max(HBRIM_IN_NEAR, Math.round(inner));
    var i1 = Math.round(i0 + (100 - i0) * 0.55);
    /* 2026-09-10 差し戻し③: 楕円の半径を画面の半幅・半高そのものに合わせる
       （旧 `ellipse 50% 50%` は半径が半分で、赤が中央まで届いてしまう）。
       これで 0〜inner% が完全透明、inner%〜100% が画面端へ向かう赤のグラデーション
       ＝「画面端から内側 (100-inner)% まで赤・中央 inner% は透明」になる。
       色は血に近い暗赤（#7a0a0a 系）。 */
    /* メイン監査（2026-09-10）: 暗い画面に暗赤を重ねても読めなかったため、色を明るい血の赤に上げ、
       要素側を mix-blend-mode:screen（加算寄り）にして黒背景でも縁の赤が立つようにした。
       透明側の停止位置（0%・inner%）は据え置き＝中央の無着色は不変。 */
    return 'radial-gradient(ellipse 100% 100% at 50% 50%, rgba(122,10,10,0) 0%, ' +
      'rgba(122,10,10,0) ' + i0 + '%, rgba(196,24,18,0.55) ' + i1 + '%, rgba(232,34,26,1) 100%)';
  }

  /* ================================================================
   * OfflineAudioContext レンダヘルパー（契約 §4「検証」）
   * ============================================================== */
  function offlineCtor() {
    return global.OfflineAudioContext || global.webkitOfflineAudioContext || null;
  }

  function startRendering(ctx) {
    return new global.Promise(function (resolve, reject) {
      var p = null;
      ctx.oncomplete = function (e) { resolve(e.renderedBuffer); };
      try { p = ctx.startRendering(); } catch (err) { reject(err); return; }
      if (p && p.then) p.then(resolve, reject);
    });
  }

  /* ---------------- スペクトル解析（P4.13 項目3の数値判定用） ----------------
   * 低域比率（<120Hz）とスペクトル重心を出すために、その場で使い捨ての
   * 実数FFT（基数2・反復版）を持つ。外部ライブラリは足さない（$0構成）。
   * ---------------------------------------------------------------- */

  /** 実数列 → パワースペクトル（長さ N/2）。src[from..from+len) に Hann 窓 */
  function powerSpectrum(src, from, len, N) {
    var re = new Float64Array(N), im = new Float64Array(N), i, j;
    var m = Math.min(len, N, src.length - from);
    for (i = 0; i < m; i++) {
      var w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, m - 1));
      re[i] = src[from + i] * w;
    }
    /* ビット反転並べ替え */
    for (i = 1, j = 0; i < N; i++) {
      var bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len2 = 2; len2 <= N; len2 <<= 1) {
      var ang = -2 * Math.PI / len2;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < N; i += len2) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len2 / 2; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + len2 / 2] * cr - im[i + k + len2 / 2] * ci;
          var vi = re[i + k + len2 / 2] * ci + im[i + k + len2 / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len2 / 2] = ur - vr; im[i + k + len2 / 2] = ui - vi;
          var nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
    var out = new Float64Array(N >> 1);
    for (i = 0; i < out.length; i++) out[i] = re[i] * re[i] + im[i] * im[i];
    return out;
  }

  /** [t0,t1) 区間の「fc 未満のエネルギー / 全エネルギー」 */
  function lowRatioIn(d, sr, t0, t1, fc, N) {
    var from = Math.max(0, Math.floor(t0 * sr));
    var len = Math.max(1, Math.floor((t1 - t0) * sr));
    var n = N || 8192;
    var P = powerSpectrum(d, from, len, n);
    var df = sr / n, low = 0, all = 0;
    for (var i = 1; i < P.length; i++) {
      all += P[i];
      if (i * df < fc) low += P[i];
    }
    return all > 0 ? low / all : 0;
  }

  /** 1秒（hop 秒）刻みのスペクトル重心(Hz)の列 */
  function centroidSeries(d, sr, hop, N) {
    var n = N || 8192;
    var win = Math.max(1, Math.floor(hop * sr));
    var out = [];
    for (var s = 0; s + win <= d.length; s += win) {
      var acc = null, blocks = 0;
      for (var b = s; b + n <= s + win; b += n >> 1) {
        var P = powerSpectrum(d, b, n, n);
        if (!acc) acc = P;
        else for (var i = 0; i < acc.length; i++) acc[i] += P[i];
        blocks++;
      }
      if (!blocks) { acc = powerSpectrum(d, s, win, n); }
      var df = sr / n, num = 0, den = 0;
      for (var k = 1; k < acc.length; k++) { num += k * df * acc[k]; den += acc[k]; }
      out.push(den > 0 ? num / den : 0);
    }
    return out;
  }

  /** 振幅包絡の山の数（拍数の判定用）。窓RMS→しきい値超えの極大を数える */
  function envelopePeaks(d, sr, thr, minGap) {
    var hop = Math.max(1, Math.round(sr * 0.005));
    var win = Math.max(1, Math.round(sr * 0.020));
    var env = [];
    for (var i = 0; i + win <= d.length; i += hop) {
      var s = 0;
      for (var k = 0; k < win; k++) { var v = d[i + k]; s += v * v; }
      env.push(Math.sqrt(s / win));
    }
    var max = 0, j;
    for (j = 0; j < env.length; j++) if (env[j] > max) max = env[j];
    if (max <= 0) return { count: 0, times: [] };
    var lim = max * (thr === undefined ? 0.30 : thr);
    var gap = Math.max(1, Math.round((minGap === undefined ? 0.06 : minGap) * sr / hop));
    var times = [], last = -1e9;
    for (j = 1; j < env.length - 1; j++) {
      if (env[j] < lim) continue;
      if (env[j] < env[j - 1] || env[j] < env[j + 1]) continue;
      if (j - last < gap) continue;
      last = j;
      times.push(j * hop / sr);
    }
    return { count: times.length, times: times };
  }

  /** [at-half, at+half) の中で隣り合う標本の差が最大いくらか（波形の段差） */
  function maxStepIn(d, sr, at, half) {
    var a0 = Math.max(1, Math.floor((at - half) * sr));
    var a1 = Math.min(d.length, Math.ceil((at + half) * sr));
    var mx = 0;
    for (var i = a0; i < a1; i++) {
      var dv = Math.abs(d[i] - d[i - 1]);
      if (dv > mx) mx = dv;
    }
    return mx;
  }

  /* ---------------- P4.15 の数値判定（契約「P4.15 声の差し替え」） ----------------
   *   絶叫の基音推移が直線でないこと（1秒内に3回以上の向き変化）を、
   *   自己相関のピッチ追跡で数える。種違い2レンダの相関・区間RMS比もここ。
   * ---------------------------------------------------------------- */

  /** 自己相関（McLeod 風の正規化）で 1 点の基音(Hz)を測る。取れなければ 0 */
  function f0At(d, sr, at, win, fmin, fmax) {
    var n = Math.round(win * sr), s0 = Math.round(at * sr), i, l;
    if (s0 < 0 || s0 + n + Math.ceil(sr / fmin) >= d.length) return 0;
    var mean = 0;
    for (i = 0; i < n; i++) mean += d[s0 + i];
    mean /= n;
    var lMin = Math.max(2, Math.floor(sr / fmax)), lMax = Math.ceil(sr / fmin);
    var e0 = 0, v;
    for (i = 0; i < n; i++) { v = d[s0 + i] - mean; e0 += v * v; }
    if (e0 <= 1e-12) return 0;
    var r = new Float64Array(lMax + 2);
    for (l = lMin; l <= lMax; l++) {
      var num = 0, e1 = 0;
      for (i = 0; i < n; i++) {
        var a = d[s0 + i] - mean, b = d[s0 + i + l] - mean;
        num += a * b; e1 += b * b;
      }
      r[l] = (e1 > 1e-12) ? num / Math.sqrt(e0 * e1) : 0;
    }
    /* 山を拾い、最大の 0.86 倍を超える「最初の」山を採る（オクターブ誤りを避ける） */
    var best = 0, peaks = [];
    for (l = lMin + 1; l < lMax; l++) {
      if (r[l] > r[l - 1] && r[l] >= r[l + 1]) { peaks.push(l); if (r[l] > best) best = r[l]; }
    }
    if (best < 0.30) return 0;
    for (i = 0; i < peaks.length; i++) {
      l = peaks[i];
      if (r[l] >= best * 0.86) {
        var y0 = r[l - 1], y1 = r[l], y2 = r[l + 1];
        var den = (y0 - 2 * y1 + y2);
        return sr / (l + (den !== 0 ? 0.5 * (y0 - y2) / den : 0));
      }
    }
    return 0;
  }

  /** 基音の列（hop 秒刻み） */
  function f0Series(d, sr, t0, t1, hop, fmin, fmax) {
    var out = [];
    for (var t = t0; t + 0.021 < t1; t += hop) out.push(f0At(d, sr, t, 0.021, fmin, fmax));
    return out;
  }

  /** 向き（上り/下り）が変わった回数。dead は無視する相対幅（追跡のゆらぎ対策） */
  function turnsOf(f, dead) {
    var n = 0, dir = 0, ref = 0, i, v;
    for (i = 0; i < f.length; i++) {
      v = f[i];
      if (!(v > 0)) continue;
      if (!ref) { ref = v; continue; }
      if (v > ref) {
        if (dir < 0) { if (v > ref * (1 + dead)) { n++; dir = 1; ref = v; } }
        else { dir = 1; ref = v; }
      } else if (v < ref) {
        if (dir > 0) { if (v < ref * (1 - dead)) { n++; dir = -1; ref = v; } }
        else { dir = -1; ref = v; }
      }
    }
    return n;
  }

  /** [t0,t1) の RMS */
  function rmsIn(d, sr, t0, t1) {
    var a = Math.max(0, Math.round(t0 * sr)), b = Math.min(d.length, Math.round(t1 * sr)), s = 0;
    for (var i = a; i < b; i++) s += d[i] * d[i];
    return (b > a) ? Math.sqrt(s / (b - a)) : 0;
  }

  /** [t0,t1) の絶対値の最大 */
  function peakIn(d, sr, t0, t1) {
    var a = Math.max(0, Math.round(t0 * sr)), b = Math.min(d.length, Math.round(t1 * sr)), m = 0;
    for (var i = a; i < b; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
    return m;
  }

  /** 2つの波形の相関（ラグ0の正規化相互相関） */
  function corrOf(x, y) {
    var n = Math.min(x.length, y.length), sxy = 0, sxx = 0, syy = 0, i;
    for (i = 0; i < n; i++) { sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; }
    return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  /**
   * レンダ結果の数値化。spec を渡すと追加の解析を載せる:
   *   spec.low       = { t0, t1, fc } … その区間の低域エネルギー比率 → m.lowRatio
   *   spec.centroid  = { hop }        … hop 秒刻みのスペクトル重心列 → m.centroids
   *   spec.peaks     = { thr, gap }   … 振幅包絡の山の数           → m.peaks
   *   spec.pitch     = { t0,t1,hop,fmin,fmax,dead } … 基音の列と向きの変化回数
   *                                                  → m.f0 / m.turns / m.f0lo / m.f0hi
   *   spec.rmsWin    = [{ k, t0, t1 }] … 区間ごとの RMS                → m.rmsWin[k]
   *   spec.headPeak  = { t0, t1 }      … その区間のピーク（頭の小ささの検査）→ m.headPeak
   */
  function metricsOf(buf, spec) {
    var d = buf.getChannelData(0);
    var n = d.length, sum = 0, peak = 0, nz = 0, onset = -1;
    for (var i = 0; i < n; i++) {
      var v = d[i], a = v < 0 ? -v : v;
      sum += v * v;
      if (a > peak) peak = a;
      if (a > 0.002) { nz++; if (onset < 0) onset = i; }
    }
    var m = {
      rms: Math.sqrt(sum / n),
      peak: peak,
      duration: buf.duration,
      sampleRate: buf.sampleRate,
      activeRatio: nz / n,
      onset: onset < 0 ? -1 : onset / buf.sampleRate,
      clipped: peak > 1.0
    };
    if (spec) {
      try {
        if (spec.low) m.lowRatio = lowRatioIn(d, buf.sampleRate, spec.low.t0, spec.low.t1, spec.low.fc);
        if (spec.centroid) m.centroids = centroidSeries(d, buf.sampleRate, spec.centroid.hop || 1.0);
        if (spec.peaks) {
          var pk = envelopePeaks(d, buf.sampleRate, spec.peaks.thr, spec.peaks.gap);
          m.peaks = pk.count; m.peakTimes = pk.times;
        }
        if (spec.pitch) {
          var sp = spec.pitch;
          var f = f0Series(d, buf.sampleRate, sp.t0, sp.t1, sp.hop || 0.02, sp.fmin || 380, sp.fmax || 1750);
          m.f0 = f;
          m.turns = turnsOf(f, sp.dead === undefined ? 0.005 : sp.dead);
          var lo = 0, hi = 0, got = 0;
          for (var q = 0; q < f.length; q++) {
            if (!(f[q] > 0)) continue;
            got++;
            if (!lo || f[q] < lo) lo = f[q];
            if (f[q] > hi) hi = f[q];
          }
          m.f0lo = lo; m.f0hi = hi; m.f0got = got + '/' + f.length;
        }
        if (spec.rmsWin) {
          m.rmsWin = {};
          for (var w = 0; w < spec.rmsWin.length; w++) {
            var rw = spec.rmsWin[w];
            m.rmsWin[rw.k] = rmsIn(d, buf.sampleRate, rw.t0, rw.t1);
          }
        }
        if (spec.headPeak) {
          m.headPeak = peakIn(d, buf.sampleRate, spec.headPeak.t0, spec.headPeak.t1);
        }
        if (spec.step) {
          /* 指定した窓の中の「隣り合う標本の最大差」＝波形の段差。
             継ぎ目の窓と、何も起きていない基準窓を比べる＝プチッと鳴っていないことの証拠 */
          m.stepAt = maxStepIn(d, buf.sampleRate, spec.step.at, spec.step.half);
          if (spec.stepRef) {
            m.stepRef = maxStepIn(d, buf.sampleRate, spec.stepRef.at, spec.stepRef.half);
          }
        }
      } catch (e) { m.analysisError = String(e && e.message || e); }
    }
    return m;
  }

  /**
   * 1音を OfflineAudioContext で描画して RMS/peak を返す。
   * 実出力は一切行わない（＝出力デバイス無しの検証環境でも数値判定できる）。
   */
  function renderVoiceBuffer(name, params, seconds, sampleRate) {
    var C = offlineCtor();
    if (!C) return global.Promise.reject(new Error('OfflineAudioContext 非対応'));
    var v = VOICES[name];
    if (!v) return global.Promise.reject(new Error('未知の音: ' + name));
    var sr = sampleRate || 44100;
    var sec = seconds || 1.2;
    var ctx;
    try { ctx = new C(1, Math.ceil(sr * sec), sr); }
    catch (e) { return global.Promise.reject(e); }
    var dest = gainOf(ctx, 1);
    dest.connect(ctx.destination);
    try { v(ctx, dest, 0.02, params || {}); }
    catch (e2) { return global.Promise.reject(e2); }
    return startRendering(ctx);
  }

  function renderVoice(name, params, seconds, sampleRate, spec) {
    return renderVoiceBuffer(name, params, seconds, sampleRate)
      .then(function (b) { return metricsOf(b, spec); });
  }

  /**
   * 同じ音を種違いで2回レンダして波形の相関を返す（P4.15 要件4「毎回同じ音にしない」）。
   * 相関が小さいほど「毎回違う」。契約の判定は 0.9 未満。
   */
  function renderCorrPair(name, pa, pb, seconds, sampleRate) {
    return renderVoiceBuffer(name, pa, seconds, sampleRate).then(function (a) {
      return renderVoiceBuffer(name, pb, seconds, sampleRate).then(function (b) {
        var m = metricsOf(a, null);
        m.corr = Math.abs(corrOf(a.getChannelData(0), b.getChannelData(0)));
        return m;
      });
    });
  }

  /**
   * 任意のグラフ（複数の音を並べる等）を OfflineAudioContext で描画する。
   * build(ctx, dest, t0) に組み立てを任せる。継ぎ目の検査などに使う。
   */
  function renderBuild(build, seconds, sampleRate, spec) {
    var C = offlineCtor();
    if (!C) return global.Promise.reject(new Error('OfflineAudioContext 非対応'));
    var sr = sampleRate || 44100, sec = seconds || 1.2, ctx;
    try { ctx = new C(1, Math.ceil(sr * sec), sr); }
    catch (e) { return global.Promise.reject(e); }
    var dest = gainOf(ctx, 1);
    dest.connect(ctx.destination);
    try { build(ctx, dest, 0.02); }
    catch (e2) { return global.Promise.reject(e2); }
    return startRendering(ctx).then(function (b) { return metricsOf(b, spec); });
  }

  /** 距離から心拍のレンダ引数を作る（level と near を実プレイと同じ組で渡す） */
  function hbParams(dist, chase) {
    var h = heartbeatFor(dist, !!chase);
    return { level: h.level, near: h.near };
  }

  /* 機械テストで数値判定する主要音（契約 §4: 足音3種・発見スティング・心拍・レバー・警報） */
  var PREWARM = [
    { key: 'step_walk',   name: 'footstep', params: { mat: 'tile', level: STEP_GAIN.walk, r: 0.5 }, sec: 0.6 },
    { key: 'step_run',    name: 'footstep', params: { mat: 'tile', level: STEP_GAIN.run, r: 0.5 }, sec: 0.6 },
    { key: 'step_crouch', name: 'footstep', params: { mat: 'tile', level: STEP_GAIN.crouch, r: 0.5 }, sec: 0.6 },
    { key: 'step_metal',  name: 'footstep', params: { mat: 'metal', level: STEP_GAIN.walk, r: 0.5 }, sec: 0.8 },
    { key: 'step_water',  name: 'footstep', params: { mat: 'water', level: STEP_GAIN.walk, r: 0.5 }, sec: 0.8 },
    { key: 'step_glass',  name: 'footstep', params: { mat: 'glass', level: STEP_GAIN.walk, r: 0.5 }, sec: 0.8 },
    { key: 'noise_step',  name: 'noiseStep', params: { mat: 'water', r: 0.5 }, sec: 1.2 },
    { key: 'sting',       name: 'sting', params: {}, sec: 1.4 },
    { key: 'heartbeat',   name: 'heartbeat', params: {}, sec: 0.8 },
    /* P4.12 項目5: 距離連動の鼓動（5m/12m/20m の音量差を数値で見る） */
    { key: 'hb_d20',      name: 'heartbeat', params: hbParams(20), sec: 0.8 },
    { key: 'hb_d12',      name: 'heartbeat', params: hbParams(12), sec: 0.8 },
    { key: 'hb_d5',       name: 'heartbeat', params: hbParams(5), sec: 0.8,
      spec: { low: { t0: 0.0, t1: 0.135, fc: 120 }, peaks: { thr: 0.22, gap: 0.06 } } },
    /* P4.13 項目3: 追跡中・5m（音量の上限＝クリップしないことを見る） */
    { key: 'hb_max',      name: 'heartbeat', params: hbParams(5, true), sec: 0.9,
      spec: { low: { t0: 0.0, t1: 0.135, fc: 120 } } },
    /* P4.13 項目3: 緊迫層（8秒で重心が1秒刻みに単調上昇するか） */
    { key: 'tension8',    name: 'tension', params: { dur: 8, level: 1 }, sec: 8.0,
      spec: { centroid: { hop: 1.0 } } },
    /* P4.13 項目3: 実機と同じ「チャンクの継ぎ足し」を再現し、継ぎ目に段差が無いことを見る */
    { key: 'tension_seam', sec: 12.0,
      build: function (ctx, dest, t0) {
        /* 実機と同じ scheduleTensionChunk を、レンダに収まる短い hop で2つ繋ぐ */
        var r = scheduleTensionChunk(ctx, dest, t0, 0, true, TEN_CYCLE);
        scheduleTensionChunk(ctx, dest, r.next, r.elapsed, false, TEN_CYCLE);
      },
      spec: { centroid: { hop: 1.0 },
              step: { at: 0.02 + TEN_CYCLE + TEN_XF * 0.5, half: TEN_XF * 0.5 + 0.02 },
              stepRef: { at: 0.02 + TEN_CYCLE * 0.5, half: TEN_XF * 0.5 + 0.02 } } },
    { key: 'ragged',      name: 'raggedBreath', params: { r: 0.5 }, sec: 1.0 },
    { key: 'scrape',      name: 'metalScrape', params: { r: 0.5 }, sec: 1.2 },
    /* P4.15: すすり泣き→絶叫（契約の数値判定4点をここで測る） */
    { key: 'sob',         name: 'sobScream', params: { seed: 20260908 }, sec: 4.4, sr: 48000,
      spec: {
        pitch: { t0: 0.02 + SOB_ONSET + 0.03, t1: 0.02 + SOB_ONSET + 1.03,
                 hop: 0.020, fmin: 380, fmax: 1750, dead: 0.005 },
        rmsWin: [{ k: 'sob', t0: 0.04, t1: 0.02 + SOB_ONSET - 0.02 },
                 { k: 'scr', t0: 0.02 + SOB_ONSET, t1: 0.02 + SOB_ONSET + SOB_SCR }],
        headPeak: { t0: 0.0, t1: 0.02 + SOB_ONSET }
      } },
    /* 種違い2レンダ（毎回違う音になっていることの数値） */
    { key: 'sob_corr',    sec: 3.2, sr: 48000,
      pair: { name: 'sobScream', a: { seed: 20260908 }, b: { seed: 99887766 } } },
    { key: 'lever',       name: 'lever', params: {}, sec: 3.4 },
    { key: 'alarm',       name: 'alarm', params: {}, sec: 2.4 },
    { key: 'scream',      name: 'scream', params: {}, sec: 1.4 },
    /* P4.10 罠発火の絶叫（施設全体に響く） */
    { key: 'shriek',      name: 'shriek', params: {}, sec: 2.2 },
    { key: 'boneCrack',   name: 'boneCrack', params: {}, sec: 1.4 },
    { key: 'capture',     name: 'capture', params: {}, sec: 2.2 },
    { key: 'drip',        name: 'drip', params: { r: 0.5 }, sec: 0.8 },
    { key: 'doorRoar',    name: 'doorRoar', params: {}, sec: 3.8 },
    { key: 'enemyMoan',   name: 'enemyMoan', params: { r: 0.5 }, sec: 3.2 },
    { key: 'enemyClaw',   name: 'enemyClaw', params: { r: 0.5 }, sec: 0.4 },
    { key: 'pry',         name: 'pry', params: { r: 0.5 }, sec: 0.9 },
    { key: 'breath',      name: 'breath', params: { level: 0.6, exhale: true }, sec: 0.9 },
    /* P4.6 捕獲シネマティック */
    { key: 'cellDoor',    name: 'cellDoor', params: {}, sec: 2.4 },
    { key: 'cellLock',    name: 'cellLock', params: {}, sec: 1.6 },
    { key: 'bite',        name: 'bite', params: {}, sec: 2.0 },
    /* P4.10b 音の罠（種類ごとの罠音） */
    { key: 'trap_can',    name: 'canRattle', params: {}, sec: 1.4 },
    { key: 'trap_creak',  name: 'floorCreak', params: {}, sec: 1.2 },
    { key: 'trap_wire',   name: 'wireCans', params: {}, sec: 1.6 },
    { key: 'trap_crash',  name: 'furnitureCrash', params: {}, sec: 2.0 }
  ];

  var renderCache = Object.create(null);
  var prewarmPromise = null;
  var prewarmError = null;

  function prewarm() {
    if (prewarmPromise) return prewarmPromise;
    if (!offlineCtor() || !global.Promise) {
      prewarmError = 'OfflineAudioContext 非対応';
      prewarmPromise = global.Promise ? global.Promise.resolve(renderCache) : null;
      return prewarmPromise;
    }
    var chainP = global.Promise.resolve();
    PREWARM.forEach(function (job) {
      chainP = chainP.then(function () {
        var r = job.pair
          ? renderCorrPair(job.pair.name, job.pair.a, job.pair.b, job.sec, job.sr || 0)
          : (job.build
            ? renderBuild(job.build, job.sec, job.sr || 0, job.spec)
            : renderVoice(job.name, job.params, job.sec, job.sr || 0, job.spec));
        return r.then(function (m) {
          renderCache[job.key] = m;
        }, function (err) {
          prewarmError = String(err && err.message || err);
        });
      });
    });
    prewarmPromise = chainP.then(function () { return renderCache; });
    return prewarmPromise;
  }

  /* ================================================================
   * Engine
   * ============================================================== */
  function Engine() {
    this.ctx = null;
    this.game = null;
    this.unlocked = false;
    this.testMode = false;
    this.volume = DEFAULT_VOLUME;
    this.muted = false;
    this.hidden = false;
    this.events = Object.create(null);   /* 発音フックの呼び出し回数（機械テスト用） */
    this.fired = Object.create(null);    /* 音色ごとの発火回数（解錠前でも積む） */
    this.errors = 0;
    this.playedTotal = 0;
    this.dropped = 0;
    this.peakVoices = 0;
    this._live = [];                     /* 発音中のボイスの終了時刻(ms) */
    this._rng = lcg(31337);
    this.fx = null;
    this._resetState();
    this._loadSettings();
  }

  /* ---------------- 設定（localStorage） ---------------- */

  Engine.prototype._loadSettings = function () {
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && typeof d.volume === 'number' && isFinite(d.volume)) this.volume = clamp(d.volume, 0, 1);
      if (d && typeof d.muted === 'boolean') this.muted = d.muted;
    } catch (e) { /* private モード等は既定値のまま */ }
  };

  Engine.prototype._saveSettings = function () {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, volume: this.volume, muted: this.muted }));
    } catch (e) { /* 保存できない環境は無視 */ }
  };

  Engine.prototype.setVolume = function (v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    this._applyMaster();
    this._saveSettings();
    return this.volume;
  };
  Engine.prototype.getVolume = function () { return this.volume; };
  Engine.prototype.setMuted = function (on) {
    this.muted = !!on;
    this._applyMaster();
    this._saveSettings();
    return this.muted;
  };
  Engine.prototype.eraseSettings = function () {
    try { global.localStorage.removeItem(STORE_KEY); } catch (e) { /* 無視 */ }
    this.volume = DEFAULT_VOLUME;
    this.muted = false;
    this._applyMaster();
  };

  Engine.prototype._applyMaster = function () {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : this.volume;
  };

  /* ---------------- 解錠（iOS Safari 対策） ---------------- */

  /** 初回のタップ/クリック/キーで呼ぶ。失敗しても例外を外へ出さない */
  Engine.prototype.unlock = function () {
    if (this.unlocked || this.testMode) return false;
    var C = global.AudioContext || global.webkitAudioContext;
    if (!C) return false;
    try {
      this.ctx = new C();
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
      this._buildBuses();
      this.unlocked = true;
      return true;
    } catch (e) {
      this.ctx = null;
      this.errors++;
      return false;
    }
  };

  /** 停止中のコンテキストを再開する（表示中・非テスト時のみ。呼び出しは1秒に1回に間引く） */
  Engine.prototype.tryResume = function (dt) {
    var ctx = this.ctx;
    if (!ctx || this.hidden || this.testMode) return false;
    if (ctx.state === 'running') return false;
    this._resumeT = (this._resumeT || 0) - (dt || 0);
    if (this._resumeT > 0) return false;
    this._resumeT = 1.0;
    try { var pr = ctx.resume && ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { this.errors++; }
    return true;
  };

  Engine.prototype._buildBuses = function () {
    var ctx = this.ctx;
    this.master = gainOf(ctx, this.muted ? 0 : this.volume);
    /* まとめてコンプレッサを通す＝同時発音が増えても割れない */
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.bus = {
      amb: gainOf(ctx, AMB_BUS_GAIN),
      sfx: gainOf(ctx, 1.0),
      enemy: gainOf(ctx, 1.0),
      self: gainOf(ctx, 1.0)   /* 空間化しない自分の音（足音・呼吸・心拍） */
    };
    for (var k in this.bus) if (this.bus.hasOwnProperty(k)) this.bus[k].connect(this.master);

    this._buildContinuous();
  };

  /** 連続音（環境ドローン・蛍光灯・呼吸）を1本ずつ常設する */
  Engine.prototype._buildContinuous = function () {
    var ctx = this.ctx;

    /* 環境ドローン */
    var a = {};
    a.o1 = osc(ctx, 'sine', AMB_DEFAULT.f);
    a.o2 = osc(ctx, 'sine', AMB_DEFAULT.f2);
    a.g1 = gainOf(ctx, 0.85);
    a.g2 = gainOf(ctx, 0.35);
    a.lp = bq(ctx, 'lowpass', AMB_DEFAULT.lp, 1.0);
    a.n = noiseSrc(ctx, 0.25);
    a.air = bq(ctx, 'bandpass', AMB_DEFAULT.air, 0.7);
    a.airG = gainOf(ctx, AMB_DEFAULT.airG);
    a.out = gainOf(ctx, 0);
    a.o1.connect(a.g1); a.g1.connect(a.lp);
    a.o2.connect(a.g2); a.g2.connect(a.lp);
    a.lp.connect(a.out);
    a.n.connect(a.air); a.air.connect(a.airG); a.airG.connect(a.out);
    a.out.connect(this.bus.amb);
    try { a.o1.start(); a.o2.start(); a.n.start(); } catch (e) { this.errors++; }
    this.amb = a;

    /* 蛍光灯のジー音（明滅に同期。gain はディレクタが毎フレーム書く） */
    var b = {};
    b.o1 = osc(ctx, 'sawtooth', 100);
    b.o2 = osc(ctx, 'sawtooth', 150.7);
    b.bp = bq(ctx, 'bandpass', 1350, 3.0);
    b.n = noiseSrc(ctx, 1.0);
    b.nbp = bq(ctx, 'bandpass', 3400, 1.1);
    b.nG = gainOf(ctx, 0.35);
    b.out = gainOf(ctx, 0);
    b.o1.connect(b.bp); b.o2.connect(b.bp);
    b.bp.connect(b.out);
    b.n.connect(b.nbp); b.nbp.connect(b.nG); b.nG.connect(b.out);
    b.out.connect(this.bus.amb);
    try { b.o1.start(); b.o2.start(); b.n.start(); } catch (e2) { this.errors++; }
    this.buzz = b;

    /* 呼吸（漆黒区画で前に出る） */
    var c = {};
    c.n = noiseSrc(ctx, 0.55);
    c.bp = bq(ctx, 'bandpass', 640, 1.0);
    c.out = gainOf(ctx, 0);
    c.n.connect(c.bp); c.bp.connect(c.out); c.out.connect(this.bus.self);
    try { c.n.start(); } catch (e3) { this.errors++; }
    this.breath = c;
  };

  /** 発音可能な AudioContext。未解錠・テスト中・消音中は null */
  Engine.prototype.ctxLive = function () {
    if (this.testMode || this.muted || this.volume <= 0 || this.hidden) return null;
    return this.ctx;
  };

  /* ---------------- 同時発音数の管理 ---------------- */

  Engine.prototype._nowMs = function () {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  };

  Engine.prototype._prune = function () {
    var now = this._nowMs(), L = this._live, w = 0;
    for (var i = 0; i < L.length; i++) if (L[i] > now) L[w++] = L[i];
    L.length = w;
  };

  /** priority>0 は上限を少し超えても鳴らす（発見・捕獲・警報など） */
  Engine.prototype._alloc = function (priority, durMs) {
    var cap = MAX_VOICES + (priority > 0 ? 6 : 0);
    if (this._live.length >= cap) { this.dropped++; return false; }
    this._live.push(this._nowMs() + durMs);
    if (this._live.length > this.peakVoices) this.peakVoices = this._live.length;
    return true;
  };

  /* ---------------- 空間化 ---------------- */

  /* 空間化の計算そのもの（純関数。機械テストはここを直接検査する） */

  /** 距離減衰（契約 §4「距離で減衰」）。0..1 */
  function attenuationFor(d, maxD) {
    var m = maxD || ATTEN_MAX;
    if (d >= m) return 0;
    var a = 1 / (1 + (d / ATTEN_REF) * (d / ATTEN_REF));
    return a * (1 - d / m);
  }

  /** 距離・遮蔽によるローパス周波数(Hz)（契約 §4「距離で…ローパス」） */
  function lowpassFor(d, occluded) {
    var f = LP_NEAR * Math.exp(-d / LP_FALL);
    if (occluded) f *= OCCLUDE_LP;
    return clamp(f, 180, 18000);
  }

  /** 聴取者の向きから見た左右（契約 §4「StereoPannerで方向」）。-1=左 / +1=右 */
  function panFor(lx, lz, lyaw, x, z) {
    var dx = x - lx, dz = z - lz;
    var d = Math.hypot(dx, dz);
    if (d < 1e-6) return 0;
    var right = dx * Math.cos(lyaw) + dz * (-Math.sin(lyaw));
    return clamp(right / d, -1, 1) * PAN_WIDTH;
  }

  /** P4.10: 絶叫の距離減衰（下限つき）。施設の端でも必ず聞こえることを数値で示す */
  function shriekGainAt(d) {
    if (d >= SHRIEK_MAX_DIST) return 0;
    return Math.max(attenuationFor(d, SHRIEK_MAX_DIST), SHRIEK_ATTEN_FLOOR * (1 - d / SHRIEK_MAX_DIST));
  }

  Engine.prototype._occluded = function (x, z) {
    var g = this.game;
    if (!g || !g.ai || !g.ai.blockedLine) return false;
    try { return g.ai.blockedLine(this.lx, this.lz, x, z); }
    catch (e) { return false; }
  };

  /**
   * 音源を距離減衰＋ローパス＋StereoPanner でバスへ繋ぐ。
   * p.x / p.z が無ければ空間化せず self バスへ直結する。
   * 返り値: 実際に使う音量係数（0 なら聞こえない＝発音を省略してよい）
   */
  Engine.prototype._route = function (node, p) {
    var ctx = this.ctx;
    var bus = this.bus[p.bus || (p.x === undefined ? 'self' : 'sfx')] || this.bus.sfx;
    if (p.x === undefined || p.z === undefined) { node.connect(bus); return 1; }
    var dx = p.x - this.lx, dz = p.z - this.lz;
    var d = Math.hypot(dx, dz);
    var maxD = p.maxDist || ATTEN_MAX;
    if (d >= maxD) return 0;
    var occ = (p.occlude !== false) && this._occluded(p.x, p.z);
    var att = attenuationFor(d, maxD) * (occ ? OCCLUDE_GAIN : 1);
    /* P4.10: 施設全体に届く音（罠発火の絶叫）は距離で消えきらない下限を持つ。
       方向（StereoPanner）と距離感（ローパス）はそのまま効く＝どこから来たかは分かる。 */
    if (p.attenFloor) att = Math.max(att, p.attenFloor * (1 - d / maxD));
    var lpf = lowpassFor(d, occ);
    var lp = bq(ctx, 'lowpass', lpf, 0.7);
    var dg = gainOf(ctx, att);
    node.connect(lp);
    var tail = lp;
    if (ctx.createStereoPanner) {
      var pan = ctx.createStereoPanner();
      pan.pan.value = panFor(this.lx, this.lz, this.lyaw, p.x, p.z);
      lp.connect(pan);
      tail = pan;
    }
    tail.connect(dg);
    dg.connect(bus);
    return att;
  };

  /* ---------------- 発音 ---------------- */

  /**
   * 1音鳴らす。
   * p: { x, z, gain, level, bus, priority, maxDist, occlude, r, ... 音色ごとの引数 }
   * 未解錠・テスト中は何もせず null を返す（例外は出さない）。
   */
  Engine.prototype.play = function (name, p) {
    /* 「ディレクタが鳴らすと決めた」事実は解錠前・テスト中でも記録する
       （＝出力デバイス無しでも発火ロジックを機械テストできる） */
    this.fired[name] = (this.fired[name] || 0) + 1;
    var ctx = this.ctxLive();
    if (!ctx) return null;
    var v = VOICES[name];
    if (!v) return null;
    p = p || {};
    var head = gainOf(ctx, p.gain === undefined ? 1 : p.gain);
    var att = 1;
    try { att = this._route(head, p); }
    catch (e) { this.errors++; return null; }
    if (att <= 0.002) return null;
    var dur = 0.5;
    if (!this._alloc(p.priority || 0, 900)) return null;
    try {
      dur = v(ctx, head, ctx.currentTime + (p.when || 0.012), p) || 0.5;
    } catch (e2) {
      this.errors++;
      return null;
    }
    /* 上限管理の実尺を実際の長さで置き換える */
    this._live[this._live.length - 1] = this._nowMs() + dur * 1000 + 60;
    this.playedTotal++;
    return dur;
  };

  /* ---------------- 発音フック（他モジュールから呼ばれる） ---------------- */

  Engine.prototype._count = function (name) {
    this.events[name] = (this.events[name] || 0) + 1;
  };

  /**
   * 状態遷移・仕掛け操作の発音フック。
   * 解錠前でも「呼ばれた事実」だけは必ず記録する（機械テストの検証点）。
   */
  Engine.prototype.event = function (name, p) {
    this._count(name);
    p = p || {};
    var g = this.game;
    switch (name) {
      case 'spot':                 /* 敵がプレイヤーを発見した */
        this.play('sting', { priority: 1, gain: 0.95 });
        this._flash(0.55, 0.30);      /* 短く鋭く刺す（長く残すと「洗い流し」に見える） */
        this._noiseFx(0.62, 0.75);
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.55);
        break;
      case 'lose':                 /* 追跡解除 */
        this.play('chaseRelease', { gain: 0.75 });
        break;
      /* P4.10（契約 §4「罠が鳴った瞬間」）: 敵の絶叫が施設全体に響く。
         方向が分かる立体音＝空間化はするが、遮蔽で消さない・遠くても届く
         （maxDist を施設の対角より大きく取る）。 */
      case 'shriek':
        this.play('shriek', {
          x: p.x, z: p.z, bus: 'enemy', priority: 1, gain: 1.0,
          maxDist: SHRIEK_MAX_DIST, occlude: false, attenFloor: SHRIEK_ATTEN_FLOOR
        });
        this._flash(0.22, 0.34);
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.42);
        break;
      case 'form':                 /* 形態遷移（骨鳴り＋絶叫） */
        this.play('boneCrack', { x: p.x, z: p.z, bus: 'enemy', priority: 1, gain: 1.0, maxDist: 34 });
        this.play('scream', { x: p.x, z: p.z, bus: 'enemy', priority: 1, gain: 0.9, when: 0.40, maxDist: 40 });
        this._flash(0.20, 0.30);
        break;
      case 'capture':
        this.play('capture', { priority: 1, gain: 1.0 });
        this.fx.shakeImpulse = 1.0;
        this._duck(2.2);
        break;
      /* ---- P4.6 捕獲シネマティック（契約 §4「捕獲演出と駆け引き」） ---- */
      case 'cineStab':             /* 1 追いつき: 大音量の刺し音 */
        this.play('sting', { priority: 1, gain: 1.0, level: 1.35 });
        this.play('scream', { priority: 1, gain: 1.0, level: 1.1, when: 0.04 });
        this._flash(0.80, 0.24);
        this._noiseFx(0.75, 0.60);
        this.fx.shakeImpulse = 1.0;
        this._duck(2.6);
        break;
      case 'cineGrab':             /* 2 首掴み */
        this.play('boneCrack', { priority: 1, gain: 1.0 });
        this.play('enemyMoan', { priority: 1, gain: 1.0, r: 0.2, when: 0.10 });
        this.fx.shakeImpulse = 1.0;
        break;
      case 'cineStruggle':         /* 2 暴れている間の呻き */
        this.play('enemyMoan', { gain: 0.95, r: this._rand() });
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.6);
        break;
      case 'cineDrag':             /* 3 引きずられる（P4.12 で担ぎ運びへ差し替え。互換で残す） */
        this.play('enemyDrag', { gain: 0.95, r: this._rand() });
        this.play('footstep', { gain: 0.55, mat: 'tile', level: 0.7, r: this._rand(), when: 0.22 });
        break;
      case 'cineCarry':            /* 3 担ぎ運び（P4.12 項目3）: 耳元の重い足取りと関節の音 */
        this.play('footstep', { gain: 0.85, mat: 'tile', level: 0.95, r: this._rand() });
        this.play('enemyJoint', { gain: 0.60, r: this._rand(), when: 0.16 });
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.22);
        break;
      case 'cellDoor':             /* 4 牢扉の金属音 */
        this.play('cellDoor', { priority: 1, gain: 1.0 });
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.5);
        break;
      case 'cellLock':             /* 4 鍵の音 */
        this.play('cellLock', { priority: 1, gain: 0.95 });
        break;
      case 'bite':                 /* 3回目: 食われる */
        this.play('bite', { priority: 1, gain: 1.0 });
        this.fx.shakeImpulse = 1.0;
        this._duck(2.4);
        break;
      case 'lockerPeek':           /* ロッカーを開けて覗かれる */
        this.play('lockerDoor', { x: p.x, z: p.z, gain: 1.0, open: true });
        this.play('enemyMoan', { x: p.x, z: p.z, bus: 'enemy', gain: 0.9, r: 0.35, when: 0.18, maxDist: 30 });
        break;
      case 'stall':                /* 敵が板に引っかかった */
        this.play('boardCrash', { x: p.x, z: p.z, bus: 'enemy', gain: 0.7, maxDist: 30 });
        this.play('enemyMoan', { x: p.x, z: p.z, bus: 'enemy', gain: 0.8, when: 0.25, r: 0.2, maxDist: 34 });
        break;
      case 'noiseStep':            /* 音地盤を走って踏んだ */
        this.play('noiseStep', { priority: 1, gain: 1.0, mat: p.mat || 'water', r: this._rand() });
        break;
      case 'sensor':
        this.play('alarm', { x: p.x, z: p.z, priority: 1, gain: 0.9, maxDist: 60, occlude: false });
        this._flash(0.18, 0.25);
        break;
      case 'lever':
        this.play('lever', { x: p.x, z: p.z, priority: 1, gain: 1.0, maxDist: 60, occlude: false });
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.35);
        break;
      case 'terminalKey': this.play('terminalKey', { gain: 0.8 }); break;
      case 'terminalErr': this.play('terminalErr', { gain: 0.9 }); break;
      case 'terminalOk': this.play('terminalOk', { gain: 0.9 }); break;
      case 'handleCreak': this.play('handleCreak', { x: p.x, z: p.z, gain: 0.85, r: this._rand() }); break;
      case 'doorRoar':
        this.play('doorRoar', { x: p.x, z: p.z, priority: 1, gain: 1.0, maxDist: 80, occlude: false });
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.7);
        break;
      case 'pry': this.play('pry', { gain: 0.85, r: this._rand() }); break;
      case 'grateBreak': this.play('grateBreak', { priority: 1, gain: 1.0 }); break;
      case 'lockerIn': this.play('lockerDoor', { gain: 0.8, open: false }); break;
      case 'lockerOut': this.play('lockerDoor', { gain: 0.8, open: true }); break;
      case 'boardTopple': this.play('boardCrash', { gain: 0.95 }); break;
      /* P4.10b 音の罠（契約 §4）。位置つきで鳴らす＝方向が分かる立体音 */
      case 'trapCan':
        this.play('canRattle', { priority: 1, x: p.x, z: p.z, gain: 1.0, maxDist: 34 });
        break;
      case 'trapCreak':
        this.play('floorCreak', { priority: 1, x: p.x, z: p.z, gain: 0.95, maxDist: 26 });
        break;
      case 'trapWire':
        this.play('wireCans', { priority: 1, x: p.x, z: p.z, gain: 1.0, maxDist: 38 });
        break;
      case 'trapShelf':
        this.play('furnitureCrash', { priority: 1, x: p.x, z: p.z, gain: 0.95, maxDist: 46 });
        break;
      case 'trapLocker':
        this.play('furnitureCrash', { priority: 1, x: p.x, z: p.z, gain: 1.05, maxDist: 50 });
        break;
      case 'noteOpen': this.play('paper', { gain: 0.9 }); break;
      case 'noteClose': this.play('paper', { gain: 0.6 }); break;
      case 'checkpoint': this.play('checkpoint', { gain: 0.7 }); break;
      /* ---- P4.7 エリア1脱出フローv2（契約 DESIGN.md §4「エリア1 脱出フロー v2」） ---- */
      case 'pickup': this.play('terminalOk', { gain: 0.62 }); break;
      case 'valveTurn': this.play('handleCreak', { x: p.x, z: p.z, gain: 0.72, r: this._rand() }); break;
      case 'gaugeOk': this.play('terminalOk', { gain: 0.95 }); break;
      case 'grateOff': this.play('grateBreak', { priority: 1, gain: 0.95 }); break;
      case 'spark':                /* 配電の誤順: 火花＋施設に響く大音 */
        this.play('grateBreak', { priority: 1, gain: 1.0 });
        this.play('lever', { x: p.x, z: p.z, priority: 1, gain: 0.95, maxDist: 60, occlude: false, when: 0.06 });
        this._flash(0.42, 0.26);
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.5);
        break;
      case 'lampBurst':            /* 無影灯が落ちる（カードキー取得） */
        this.play('grateBreak', { priority: 1, gain: 0.9 });
        this.play('terminalErr', { gain: 0.9, when: 0.08 });
        this._flash(0.30, 0.22);
        this.fx.shakeImpulse = Math.max(this.fx.shakeImpulse, 0.4);
        break;
      case 'moanNear':             /* 呻きが近づいてくる（スクリプト演出・実捕獲はしない） */
        this.play('enemyMoan', { x: p.x, z: p.z, bus: 'enemy', gain: 0.95, r: this._rand(), maxDist: 40 });
        break;
      default: break;
    }
    return true;
  };

  Engine.prototype._rand = function () { return this._rng(); };

  /* ---------------- 毎フレームのディレクタ ---------------- */

  Engine.prototype._resetState = function () {
    this.time = 0;
    this.lx = 0; this.lz = 0; this.lyaw = 0;
    this.stepAcc = 0;
    this.lastMode = 'walk';
    this.exertion = 0;
    this.breathPhase = 0;
    this.pantT = 0;
    this.hbT = 0;
    this.hbDist = Infinity;      /* P4.12 項目5: 最も近い個体との距離(m) */
    this.hbBpm = 0;
    this.hbLevel = 0;
    this.dragAcc = 0;
    this.moanT = 5.0;
    this.jointT = 3.0;
    this._eSt = null;            /* P4.10: 個体ごとの気配の累積器（作り直す） */
    this.dripT = 4.0;
    this.metalT = 12.0;
    this.duckT = 0;
    /* P4.13 項目3: 追跡中の緊迫層と、至近距離の環境音ダッキング */
    this.chaseNow = false;
    this.tensionOn = false;
    this.tensionLevel = 0;
    this.tensionT = 0;
    this.breathT = 0;
    this.scrapeT = 2.6;
    this.ambDuck = 0;
    this._killTension();
    this._buzzLevel = 0;
    this._buzzPrev = 1;
    this.ambTarget = 0;
    this.ambRegion = null;
    this.buzzTarget = 0;
    this.buzzDist = Infinity;
    this.breathTarget = 0;
    this.breathPeak = 0;
    this._flickerFx = null;
    this._prevEnemyState = 'patrol';
    this._prevForm = 'stand';
    this.fx = {
      vignette: 0, shake: 0, shakeImpulse: 0, fovAdd: 0,
      flash: 0, flashDecay: 1, noise: 0, noiseDecay: 1, black: 0, dread: 0
    };
    /* P4.16 項目3: 鼓動に同期した画面の縁（別レイヤー。fx.vignette とは混ぜない） */
    this.hbRim = { v: 0, amp: HBRIM_FAR, inner: HBRIM_IN_FAR };
    this._hbImp = [];
    this._live.length = 0;
    this._rng = lcg(31337);
  };

  /** 製品初期状態へ戻す（game.reset() から呼ばれる）。鳴りっぱなしを止める */
  Engine.prototype.reset = function () {
    this.panic();
    this._resetState();
    this._applyFxDom(true);
    /* 声・字幕も製品初期状態へ（契約 §6「実行後は初期状態へ完全復帰」） */
    if (ESCAPE.voice && ESCAPE.voice.reset) {
      try { ESCAPE.voice.reset(); } catch (e) { this.errors++; }
    }
  };

  /** 連続音を即座に止める（演出の中断・リセット・非表示時） */
  Engine.prototype.panic = function () {
    if (this.amb) { this.amb.out.gain.value = 0; }
    if (this.buzz) { this.buzz.out.gain.value = 0; }
    if (this.breath) { this.breath.out.gain.value = 0; }
    this._killTension();
    if (this.bus && this.bus.amb) this.bus.amb.gain.value = AMB_BUS_GAIN;
    this.ambDuck = 0;
  };

  /** 緊迫層のノードを即座に落とす（追跡解除・リセット・非表示時） */
  Engine.prototype._killTension = function () {
    var t = this._ten;
    this._ten = null;
    this.tensionLevel = 0;
    this.tensionOn = false;
    if (!t) return;
    try { t.out.gain.cancelScheduledValues(0); t.out.gain.value = 0; } catch (e) { /* 停止済み */ }
    try { t.out.disconnect(); } catch (e2) { /* 既に外れている */ }
  };

  Engine.prototype.attach = function (game) {
    this.game = game;
    this._dom = {
      vignette: document.getElementById('fx-vignette'),
      flash: document.getElementById('fx-flash'),
      noise: document.getElementById('fx-noise'),
      /* P4.16 項目3: 鼓動の縁は JS で作る（index.html は触らない） */
      hbrim: this._ensureHbRim()
    };
    this._domVal = {};
    return this;
  };

  /**
   * P4.16 項目3: 鼓動の縁のレイヤーを作る（1回だけ）。
   * #fx-vignette(z-index:30) より上・#blackout(40) より下に置き、
   * pointer-events:none で操作を一切奪わない。中心 40% は常に無着色。
   */
  Engine.prototype._ensureHbRim = function () {
    if (this._hbRimEl) return this._hbRimEl;
    if (typeof document === 'undefined' || !document.body) return null;
    var el = document.getElementById('fx-hbrim');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fx-hbrim';
      document.body.appendChild(el);
    }
    el.style.position = 'fixed';
    el.style.left = '0'; el.style.top = '0'; el.style.right = '0'; el.style.bottom = '0';
    el.style.zIndex = '34';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    el.style.willChange = 'opacity';
    el.style.mixBlendMode = 'screen';
    el.style.backgroundImage = hbRimGradient(HBRIM_IN_FAR);
    this._hbRimEl = el;
    return el;
  };

  /** 1拍ぶんの衝撃を積む（第1音＝強／第2音＝弱、HBRIM_GAP 秒あと） */
  Engine.prototype._hbRimBeat = function (dist, chase) {
    if (this.testMode) return;
    var r = hbRimFor(dist, chase);
    this.hbRim.amp = r.amp;
    this.hbRim.inner = r.inner;
    var L = this._hbImp;
    if (L.length > 6) L.length = 0;
    L.push({ a: 1, t: 0 });
    L.push({ a: HBRIM_SECOND, t: -HBRIM_GAP });
  };

  /** 縁の脈動を1フレーム進める。鳴っていない時・演出中・テスト中は 0 */
  Engine.prototype._stepHbRim = function (dt, quiet) {
    var L = this._hbImp, R = this.hbRim, v = 0, i;
    if (quiet || this.testMode) { L.length = 0; R.v = 0; return; }
    for (i = L.length - 1; i >= 0; i--) {
      L[i].t += dt;
      if (L[i].t > HBRIM_LIFE) { L.splice(i, 1); continue; }
      v += L[i].a * hbRimShape(L[i].t);
    }
    R.v = clamp(R.amp * v, 0, 1);
  };

  Engine.prototype._duck = function (sec) { this.duckT = Math.max(this.duckT, sec); };
  Engine.prototype._flash = function (v, decay) {
    this.fx.flash = Math.max(this.fx.flash, v);
    this.fx.flashDecay = decay;
  };
  Engine.prototype._noiseFx = function (v, dur) {
    this.fx.noise = Math.max(this.fx.noise, v);
    this.fx.noiseDecay = dur;
  };

  /** 足元の床種（契約 §4: タイル/金属/水たまり/ガラス片） */
  Engine.prototype.floorMaterial = function (col, row) {
    var g = this.game;
    if (!g || !g.map) return 'tile';
    var map = g.map, TILE = ESCAPE.TILE;
    if (map.tileAt(col, row) === TILE.NOISE) {
      if (!this._noiseKind) {
        this._noiseKind = Object.create(null);
        var list = (map.meta && map.meta.noise) || [];
        for (var i = 0; i < list.length; i++) {
          var nk = list[i].kind;
          this._noiseKind[list[i].col + ',' + list[i].row] =
            (nk === 'glass' || nk === 'metal') ? nk : 'water';
        }
      }
      return this._noiseKind[col + ',' + row] || 'water';
    }
    /* 傾斜・段差の通路は鉄板張り */
    var ramps = (map.meta && map.meta.ramps) || [];
    for (var j = 0; j < ramps.length; j++) {
      var a = ramps[j];
      if (col >= a.c0 && col <= a.c1 && row >= a.r0 && row <= a.r1) return 'metal';
    }
    var pls = (map.meta && map.meta.plateaus) || [];
    for (var k = 0; k < pls.length; k++) {
      var b = pls[k];
      if (col >= b.c0 && col <= b.c1 && row >= b.r0 && row <= b.r1) return 'metal';
    }
    return 'tile';
  };

  /** 明滅器具のうち最寄りのもの（音の同期元）。世界が作り直されたら索引も作り直す */
  Engine.prototype._nearestFlicker = function () {
    var g = this.game, w = g && g.world;
    if (!w || !w.fixtures) return null;
    if (this._flickerFx === null || this._flickerSrc !== w) {
      var list = [];
      for (var i = 0; i < w.fixtures.length; i++) {
        if (w.fixtures[i].state === 'flicker') list.push(w.fixtures[i]);
      }
      this._flickerFx = list;
      this._flickerSrc = w;
    }
    var fx = this._flickerFx, best = null, bd = Infinity;
    for (var j = 0; j < fx.length; j++) {
      var dx = fx[j].x - this.lx, dz = fx[j].z - this.lz;
      var d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = fx[j]; }
    }
    if (!best) return null;
    return { f: best, dist: Math.sqrt(bd) };
  };

  /** 1論理ステップ。game.stepFrame() の末尾から呼ばれる */
  Engine.prototype.step = function (dt) {
    var g = this.game;
    if (!g || !g.player) return;
    if (!isFinite(dt) || dt <= 0) dt = 0;
    this.time += dt;
    /* 2026-09-07 音消失バグ対策: タブ切替（visibilitychange→suspend）やOSの割り込みで
       AudioContext が 'suspended'/'interrupted' のまま戻らないと、以後ずっと無音になる。
       表示中でテスト中でなければ毎秒1回だけ resume() を試みる（失敗は握り潰す） */
    this.tryResume(dt);
    if (this.duckT > 0) this.duckT = Math.max(0, this.duckT - dt);

    var p = g.player;
    this.lx = p.x; this.lz = p.z; this.lyaw = p.yaw;
    this._prune();

    var modal = !!(g.progress && g.progress.modalOpen && g.progress.modalOpen());
    var jail = !!(g.stealth && g.stealth.jail && g.stealth.jail.phase !== 'none');
    var locker = !!(g.stealth && g.stealth.inLocker && g.stealth.inLocker());
    /* 演出中（メモ・牢・暗転）は環境音を絞る＝鳴りっぱなしにしない */
    var quiet = modal || jail;

    var col = p.col(), row = p.row();
    var inBlack = !!(g.world && g.world._inBlackZone && g.world._inBlackZone(col, row));

    this._stepAmbient(dt, quiet, inBlack, col, row);
    this._stepBuzz(dt, quiet, inBlack);
    this._stepRandomAmbience(dt, quiet, col, row);
    this._stepFootsteps(dt, quiet || locker, col, row);
    this._stepBreath(dt, inBlack);
    this._stepEnemy(dt, quiet);
    this._stepTension(dt, quiet);
    this._stepFx(dt, quiet, jail);
    /* P4.13 項目4: 声＋字幕（js/voice.js）。音の予約はこの Engine 経由で行う */
    if (ESCAPE.voice && ESCAPE.voice.step) {
      try { ESCAPE.voice.step(dt); } catch (e) { this.errors++; }
    }
  };

  /* 環境ドローン（区画別・漆黒区画で絞る） */
  Engine.prototype._stepAmbient = function (dt, quiet, inBlack, col, row) {
    var a = this.amb;
    var g = this.game;
    var rid = (g.world && g.world._regionAt) ? g.world._regionAt(col, row) : null;
    var t = (rid && AMBIENCE[rid]) || AMB_DEFAULT;
    var k = 1 - Math.exp(-1.6 * dt);            /* 区画をまたぐ時のクロスフェード */
    var scale = 1;
    if (inBlack) scale *= 0.16;                 /* 漆黒区画: 環境音を絞って呼吸だけにする */
    if (quiet) scale *= 0.35;
    if (this.duckT > 0) scale *= 0.25;
    /* P4.13 項目3: 至近距離のダッキング。バス全体（環境の単発音も含む）を少し下げる */
    this.ambDuck = lerp(this.ambDuck, this._duckTarget || 0, 1 - Math.exp(-4.0 * dt));
    if (this.ambDuck < 1e-4) this.ambDuck = 0;
    if (this.bus && this.bus.amb) {
      this.bus.amb.gain.value = AMB_BUS_GAIN * (1 - HB_DUCK_AMOUNT * this.ambDuck);
    }
    /* 「鳴らすべき音量」は出力可否と分けて持つ（未解錠・テスト中でも判定を検証できる） */
    this.ambRegion = rid;
    this.ambTarget = t.g * scale;
    if (!a) return;
    var live = this.ctxLive() ? 1 : 0;
    a.o1.frequency.value = lerp(a.o1.frequency.value, t.f, k);
    a.o2.frequency.value = lerp(a.o2.frequency.value, t.f2, k);
    a.lp.frequency.value = lerp(a.lp.frequency.value, t.lp, k);
    a.air.frequency.value = lerp(a.air.frequency.value, t.air, k);
    a.airG.gain.value = lerp(a.airG.gain.value, t.airG, k);
    a.out.gain.value = lerp(a.out.gain.value, this.ambTarget * live, quiet ? 0.25 : k);
  };

  /* 蛍光灯のジー音（明滅パターンに同期・近接で増大） */
  Engine.prototype._stepBuzz = function (dt, quiet, inBlack) {
    var b = this.buzz;
    var near = this._nearestFlicker();
    var level = 0, prox = 0;
    if (near) {
      var w = this.game.world;
      level = (w && w.flickerLevelAt) ? w.flickerLevelAt(near.f, this.game.simTime) : 1;
      prox = clamp(1 - near.dist / 11.0, 0, 1);
    }
    this._buzzPrev = this._buzzLevel;
    this._buzzLevel = level;
    this.buzzDist = near ? near.dist : Infinity;
    var target = 0.055 * prox * (0.25 + 0.75 * level);
    if (inBlack) target *= 0.2;
    if (quiet) target *= 0.3;
    this.buzzTarget = target;
    if (!b) return;
    var live = this.ctxLive() ? 1 : 0;
    var k = 1 - Math.exp(-22 * dt);             /* 明滅に追従できる速さ */
    b.out.gain.value = lerp(b.out.gain.value, target * live, k);
    b.nG.gain.value = 0.30 + 0.25 * level;
  };

  /* 滴り・遠い金属音（ランダム間隔） */
  Engine.prototype._stepRandomAmbience = function (dt, quiet, col, row) {
    if (quiet) return;
    this.dripT -= dt;
    if (this.dripT <= 0) {
      this.dripT = 5.5 + this._rand() * 9.0;
      var s = this._randomSpot(col, row, 3, 9);
      if (s) this.play('drip', { x: s.x, z: s.z, bus: 'amb', gain: 0.55, r: this._rand(), maxDist: 20 });
    }
    this.metalT -= dt;
    if (this.metalT <= 0) {
      this.metalT = 16 + this._rand() * 26;
      var s2 = this._randomSpot(col, row, 10, 20);
      if (s2) this.play('metalFar', { x: s2.x, z: s2.z, bus: 'amb', gain: 0.45, r: this._rand(), maxDist: 40, occlude: false });
    }
  };

  /** 周囲の歩行可能マスからランダムに1点（環境音の発生地点） */
  Engine.prototype._randomSpot = function (col, row, minR, maxR) {
    var map = this.game.map;
    for (var i = 0; i < 10; i++) {
      var ang = this._rand() * Math.PI * 2;
      var rr = minR + this._rand() * (maxR - minR);
      var c = Math.round(col + Math.cos(ang) * rr / map.tileSize);
      var r = Math.round(row + Math.sin(ang) * rr / map.tileSize);
      if (!map.isWalkable(c, r)) continue;
      var cc = map.cellCenter(c, r);
      return { x: cc.x, z: cc.z };
    }
    return null;
  };

  /* 足音（歩き/走り/しゃがみ×床種）。距離の累積で発火する */
  Engine.prototype._stepFootsteps = function (dt, quiet, col, row) {
    var p = this.game.player;
    if (quiet || p.speed < 0.12) {
      /* 止まったら次の一歩は早めに出す（歩き出しの一歩目） */
      this.stepAcc = Math.max(this.stepAcc, STRIDE.walk * 0.55);
      return;
    }
    var mode = p.mode;
    this.stepAcc += p.speed * dt;
    var stride = STRIDE[mode] || STRIDE.walk;
    if (this.stepAcc < stride) return;
    this.stepAcc -= stride;
    var mat = this.floorMaterial(col, row);
    var lv = (STEP_GAIN[mode] || STEP_GAIN.walk) * (0.9 + this._rand() * 0.2);
    /* 音地盤を走って踏んだ時は Stealth 側の 'noiseStep' フックが強い音を出す */
    var TILE = ESCAPE.TILE;
    var onNoise = this.game.map.tileAt(col, row) === TILE.NOISE;
    if (onNoise && mode === 'run') return;
    this.play('footstep', { mat: mat, level: lv, r: this._rand(), bus: 'self' });
  };

  /* 呼吸・息切れ */
  Engine.prototype._stepBreath = function (dt, inBlack) {
    var p = this.game.player;
    var running = (p.mode === 'run' && p.speed > 0.5);
    this.exertion = clamp(this.exertion + (running ? dt / 5.5 : -dt / 8.0), 0, 1);

    var rate = 0.24 + this.exertion * 0.75;      /* Hz（1秒あたりの呼吸回数） */
    if (inBlack) rate += 0.10;
    this.breathPhase += dt * rate;
    if (this.breathPhase > 1) this.breathPhase -= Math.floor(this.breathPhase);
    var envv = Math.pow(Math.max(0, Math.sin(this.breathPhase * Math.PI * 2)), 2);

    var base = 0.020 + this.exertion * 0.055;
    if (inBlack) base *= 2.6;                    /* 漆黒区画: 自分の呼吸だけが残る */
    base *= (0.55 + 0.45 * clamp(this.fx.dread, 0, 1) * 1.4);
    this.breathTarget = base * envv;
    this.breathPeak = base;
    var b = this.breath;
    if (b) {
      b.out.gain.value = this.ctxLive() ? this.breathTarget : 0;
      b.bp.frequency.value = 560 + this.exertion * 260;
    }
    /* 息切れ（走り続けた時の荒い呼吸） */
    if (this.exertion > 0.42) {
      this.pantT -= dt;
      if (this.pantT <= 0) {
        this.pantT = lerp(0.95, 0.46, clamp((this.exertion - 0.42) / 0.58, 0, 1));
        this.play('pant', { level: 0.4 + this.exertion * 0.7, bus: 'self' });
      }
    } else {
      this.pantT = 0.30;
    }
  };

  /* 敵の気配（距離減衰・壁越しでも聞こえる）＋心拍。
     P4.10: 敵は複数体。気配は個体ごとに（累積器も個体ごとに持つ＝
     1本の累積器を2体で奪い合うと足音が飛ぶ）、心拍は最も近い個体で決める。 */
  Engine.prototype._enemyState = function (i) {
    if (!this._eSt) this._eSt = [];
    if (!this._eSt[i]) this._eSt[i] = { prev: 'patrol', dragAcc: 0, moanT: 5.0 + i * 1.7, jointT: 3.0 + i * 1.1 };
    return this._eSt[i];
  };

  Engine.prototype._stepEnemy = function (dt, quiet) {
    var g = this.game;
    var list = (g.ais && g.ais.list) ? g.ais.list : (g.ai ? [g.ai] : []);
    if (!list.length) return;
    var p = g.player;
    var nd = Infinity, nearChase = false;
    for (var i = 0; i < list.length; i++) {
      var ai = list[i];
      if (!ai || !ai.enemy) continue;
      var e = ai.enemy;
      var d = Math.hypot(e.x - p.x, e.z - p.z);
      var chase = (ai.state === 'chase');
      var caught = (ai.state === 'caught');
      var st = this._enemyState(i);

      /* 形態遷移の検出（AI が setForm した瞬間にアニメ状態が 'trans' になる） */
      if (e.state === 'trans' && st.prev !== 'trans' && e.transDir > 0) {
        this.event('form', { x: e.x, z: e.z });
      }
      st.prev = e.state;
      if (i === 0) this._prevEnemyState = e.state;   /* 既存フックとの互換 */

      if (quiet || caught) { st.dragAcc = 0; continue; }
      if (d < nd) { nd = d; nearChase = chase; }

      /* 引きずる足 / 疾走の爪音: 移動距離で発火する */
      if (ai.speed > 0.05) {
        st.dragAcc += ai.speed * dt;
        var stride = chase ? 0.62 : 0.95;
        if (st.dragAcc >= stride) {
          st.dragAcc -= stride;
          var lv = chase ? 1.0 : 0.85;
          this.play(chase ? 'enemyClaw' : 'enemyDrag',
            { x: e.x, z: e.z, bus: 'enemy', gain: lv, r: this._rand(), maxDist: chase ? 34 : 26 });
        }
      } else {
        st.dragAcc = Math.min(st.dragAcc, 0.5);
      }

      /* 低い呻き（壁越しでも「近くにいる」が分かる情報源） */
      st.moanT -= dt;
      if (st.moanT <= 0) {
        st.moanT = chase ? (2.6 + this._rand() * 2.0) : (6.5 + this._rand() * 7.0);
        if (d < 32) this.play('enemyMoan', { x: e.x, z: e.z, bus: 'enemy', gain: chase ? 1.0 : 0.8, r: this._rand(), maxDist: 34 });
      }
      /* 時折の関節の音 */
      st.jointT -= dt;
      if (st.jointT <= 0) {
        st.jointT = 3.2 + this._rand() * 5.0;
        if (d < 20) this.play('enemyJoint', { x: e.x, z: e.z, bus: 'enemy', gain: 0.7, r: this._rand(), maxDist: 22 });
      }
      if (i === 0) { this.dragAcc = st.dragAcc; this.moanT = st.moanT; this.jointT = st.jointT; }
    }
    /* P4.13 項目3: 追跡中かどうかは緊迫層の駆動に使う（個体を問わず1体でも追跡中なら鳴らす） */
    var anyChase = false;
    for (var ci = 0; ci < list.length; ci++) {
      if (list[ci] && list[ci].state === 'chase' && list[ci].enemy) anyChase = true;
    }
    this.chaseNow = !quiet && anyChase;
    if (quiet || nd === Infinity) { this.hbT = 0; this.hbDist = Infinity; this._duckTarget = 0; return; }
    /* P4.13 項目3: 5m以内は環境音バスをわずかにダッキング（鼓動に場所を空ける） */
    this._duckTarget = clamp((HB_DUCK_DIST + 1 - nd) / 2.0, 0, 1);

    /* 心拍（契約 P4.12 項目5「敵との距離で強まる」）。
       追跡中に限らず HB_START(20m) 以内で鳴り始め、近いほど速く・大きい。
       壁越しでも距離だけで決める＝「近い」を伝える情報源。
       累積器は発火時にしか減らさない＝毎フレームのレート変更で鳴らなくならない */
    this.hbDist = nd;
    var hb = heartbeatFor(nd, nearChase);
    this.hbBpm = hb.bpm;
    this.hbLevel = hb.level;
    if (hb.on) {
      this.hbT += dt;
      var period = 60 / hb.bpm;
      if (this.hbT >= period) {
        this.hbT -= period;
        if (this.hbT > period) this.hbT = 0;    /* 大きな dt で溜まりすぎない */
        this.play('heartbeat', { level: hb.level, near: hb.near, bus: 'self', priority: nearChase ? 1 : 0 });
        /* P4.16 項目3: 同じ拍で画面の縁も脈打たせる（音と絵を1か所で発火させる） */
        this._hbRimBeat(nd, nearChase);
      }
    } else {
      this.hbT = 0;
    }
  };

  /* ================================================================
   * P4.13 項目3「追跡中は緊迫層を常時鳴らす」（契約 §4）
   *
   *   終わりなく上昇する不協和の持続音（VOICES.tension）＋自分の荒い呼吸＋
   *   2〜4秒間隔で不規則に入る金属の擦過スティンガー。
   *   追跡が解けるまで緩めない＝レベルは追跡中ずっと 1 に張り付く。
   *   解除時は既存の chaseRelease（event('lose')）で抜く分だけ減衰させる。
   *
   *   持続音は TEN_CYCLE の整数倍のチャンクで作り、切れる前に同じ位相から
   *   継ぎ足す（シェパードの回り込みが自己写像なので継ぎ目が聞こえない）。
   * ============================================================== */
  Engine.prototype._stepTension = function (dt, quiet) {
    var on = !!this.chaseNow && !quiet;
    this.tensionOn = on;
    /* 追跡中は緩めない（立ち上がりだけ滑らかに）。
       解除後は chaseRelease（1.7秒）と同じ尺で直線的に抜く＝余韻が残り続けない */
    if (on) {
      this.tensionLevel = lerp(this.tensionLevel, 1, 1 - Math.exp(-1.5 * dt));
    } else {
      this.tensionLevel = Math.max(0, this.tensionLevel - dt / TEN_REL);
    }
    this.tensionT = on ? this.tensionT + dt : 0;

    if (on) {
      /* 自分の荒い呼吸（走っていなくても追跡中は上がった息のまま） */
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 1.05 + this._rand() * 0.45;
        this.play('raggedBreath', { bus: 'self', gain: 0.62, r: this._rand() });
      }
      /* 金属の擦過（2〜4秒の不規則な間隔・無定位） */
      this.scrapeT -= dt;
      if (this.scrapeT <= 0) {
        this.scrapeT = 2.0 + this._rand() * 2.0;
        this.play('metalScrape', { bus: 'sfx', gain: 0.52, r: this._rand() });
      }
    } else {
      this.breathT = 0;
      this.scrapeT = 2.6;
    }

    var ctx = this.ctxLive();
    if (!ctx) { if (this._ten) this._killTension(); return; }
    if (this.tensionLevel <= 0 && !on) { if (this._ten) this._killTension(); return; }

    /* 持続音のチャンクを用意・継ぎ足す（切れる TEN_ARM 秒前に次を重ねる） */
    if (on && !this._ten) {
      var out = gainOf(ctx, 0);
      out.connect(this.bus.self);
      this._ten = { out: out, next: -1, elapsed: 0 };
    }
    var T = this._ten;
    if (!T) return;
    if (on && ctx.currentTime >= T.next - TEN_ARM) {
      var first = (T.next < 0);
      var start = first ? (ctx.currentTime + 0.02) : T.next;
      try {
        var r = scheduleTensionChunk(ctx, T.out, start, T.elapsed, first);
        T.next = r.next;
        T.elapsed = r.elapsed;
      } catch (e) { this.errors++; }
    }
    T.out.gain.value = TEN_MIX * this.tensionLevel;
    if (!on && this.tensionLevel <= 0) this._killTension();
  };

  /* 恐怖演出（DOMオーバーレイ＋カメラ揺れ。ポストプロセス不要） */
  Engine.prototype._stepFx = function (dt, quiet, jail) {
    var g = this.game, fx = this.fx;
    /* P4.10: 恐怖の度合いは「個体ごとに出して最も強いもの」を採る
       （1体ぶんで上書きすると、もう1体が真後ろに居ても静かになる） */
    var list = (g.ais && g.ais.list) ? g.ais.list : (g.ai ? [g.ai] : []);
    var dreadTarget = 0, anyChase = false;
    for (var ei = 0; ei < list.length; ei++) {
      var ai = list[ei];
      if (!ai || !ai.enemy) continue;
      var d = Math.hypot(ai.enemy.x - g.player.x, ai.enemy.z - g.player.z);
      var near = clamp(1 - (d - 1.5) / 13, 0, 1);
      var want = (ai.state === 'chase') ? Math.max(0.62, near) : near * 0.72;
      if (ai.state === 'investigate' || ai.state === 'search') want = Math.max(want, near * 0.85);
      if (ai.state === 'chase') anyChase = true;
      if (want > dreadTarget) dreadTarget = want;
    }
    if (jail) dreadTarget = 0;
    var k = 1 - Math.exp(-3.2 * dt);
    fx.dread = lerp(fx.dread, dreadTarget, k);

    /* 周辺減光 */
    fx.vignette = 0.10 + fx.dread * 0.52;

    /* 微振動（衝撃は減衰させる） */
    fx.shakeImpulse = Math.max(0, fx.shakeImpulse - dt * 1.5);
    fx.shake = fx.dread * fx.dread * 0.0085 + fx.shakeImpulse * 0.022;

    /* 追跡中のFOV微増 */
    var fovWant = anyChase ? 7.5 : 0;
    fx.fovAdd = lerp(fx.fovAdd, fovWant, 1 - Math.exp(-2.2 * dt));
    if (fovWant === 0 && fx.fovAdd < 0.01) fx.fovAdd = 0;   /* 収束させて投影行列の再計算を止める */

    /* フラッシュ・ノイズの減衰 */
    if (fx.flash > 0) fx.flash = Math.max(0, fx.flash - dt / Math.max(fx.flashDecay, 0.05));
    if (fx.noise > 0) fx.noise = Math.max(0, fx.noise - dt / Math.max(fx.noiseDecay, 0.05));

    /* 明滅に同期した瞬間暗転（時々）。明滅が落ちる瞬間に確率で暗転を刺す */
    if (fx.black > 0) fx.black = Math.max(0, fx.black - dt * 9.0);
    if (!quiet && this._buzzPrev > 0.30 && this._buzzLevel <= 0.10) {
      var nf = this._nearestFlicker();
      if (nf && nf.dist < 9 && this._rand() < 0.07) fx.black = 0.92;
    }

    /* P4.16 項目3: 鼓動の縁（別レイヤー） */
    this._stepHbRim(dt, quiet || jail);

    this._applyFxDom(false);
  };

  /** DOMへ反映（値が変わった時だけ書く＝スタイル再計算を抑える） */
  Engine.prototype._applyFxDom = function (force) {
    var d = this._dom;
    if (!d) return;
    var fx = this.fx, v = this._domVal;
    /* 瞬間暗転の間は減光を全開にして黒を被せる（牢の #blackout とは別系統） */
    var vig = clamp(Math.max(fx.vignette, fx.black), 0, 1);
    if (d.vignette && (force || Math.abs((v.vig || 0) - vig) > 0.004)) {
      d.vignette.style.opacity = vig.toFixed(3);
      v.vig = vig;
    }
    var fl = clamp(fx.flash, 0, 1);
    if (d.flash && (force || Math.abs((v.fl || 0) - fl) > 0.004)) {
      d.flash.style.opacity = fl.toFixed(3);
      v.fl = fl;
    }
    /* P4.17 段階2: 後処理（系統Z）が動いている間は DOM の粒子ノイズを止める。
       発見スティングのノイズは後処理の粒子（uGrain）が引き取る＝二重にしない。 */
    var ns = (ESCAPE.RQ && ESCAPE.RQ.post) ? 0 : clamp(fx.noise, 0, 1);
    if (d.noise && (force || Math.abs((v.ns || 0) - ns) > 0.004)) {
      d.noise.style.opacity = (ns * 0.55).toFixed(3);
      v.ns = ns;
    }
    /* 瞬間暗転は既存の #blackout を借りず専用に扱う（牢の暗転と混ざらないため
       vignette の要素を一時的に真っ黒にする） */
    /* P4.16 項目3: 鼓動の縁。不透明度は毎拍動き、無着色半径は距離が変わった時だけ書く */
    var R = this.hbRim;
    if (d.hbrim && R) {
      var hv = clamp(R.v, 0, 1);
      if (force || Math.abs((v.hb || 0) - hv) > 0.004) {
        d.hbrim.style.opacity = hv.toFixed(3);
        v.hb = hv;
      }
      var inn = Math.max(HBRIM_IN_NEAR, Math.round(R.inner));
      if (force || v.hbIn !== inn) {
        d.hbrim.style.backgroundImage = hbRimGradient(inn);
        v.hbIn = inn;
      }
    }
    var bk = clamp(fx.black, 0, 1);
    if (d.vignette && (force || Math.abs((v.bk || 0) - bk) > 0.01)) {
      d.vignette.style.background = bk > 0.01
        ? 'rgba(0,0,0,' + (0.55 + bk * 0.45).toFixed(3) + ')'
        : '';
      v.bk = bk;
    }
  };

  /** カメラに乗せる揺れ（game.syncCamera から呼ばれる） */
  Engine.prototype.cameraShake = function (out) {
    var a = this.fx ? this.fx.shake : 0;
    if (!(a > 0.00002)) { out.pitch = 0; out.yaw = 0; out.roll = 0; return out; }
    var t = this.time;
    out.pitch = Math.sin(t * 37.3) * a;
    out.yaw = Math.sin(t * 29.1 + 1.7) * a;
    out.roll = Math.sin(t * 23.7 + 0.4) * a * 0.6;
    return out;
  };

  Engine.prototype.info = function () {
    return {
      unlocked: this.unlocked, testMode: this.testMode, muted: this.muted, volume: this.volume,
      hidden: this.hidden, errors: this.errors,
      played: this.playedTotal, dropped: this.dropped, voices: this._live.length, peakVoices: this.peakVoices,
      exertion: this.exertion, hbT: this.hbT, stepAcc: this.stepAcc,
      hbDist: this.hbDist, hbBpm: this.hbBpm, hbLevel: this.hbLevel,
      buzz: this._buzzLevel, buzzTarget: this.buzzTarget, buzzDist: this.buzzDist,
      ambTarget: this.ambTarget, ambRegion: this.ambRegion, breathTarget: this.breathTarget,
      fired: this.fired,
      fx: { vignette: this.fx.vignette, shake: this.fx.shake, fovAdd: this.fx.fovAdd, flash: this.fx.flash, noise: this.fx.noise, black: this.fx.black, dread: this.fx.dread },
      events: this.events
    };
  };

  /* ================================================================
   * 組み込み
   * ============================================================== */
  var engine = new Engine();
  ESCAPE.audio = engine;
  ESCAPE.Audio = {
    VOICES: VOICES,
    AMBIENCE: AMBIENCE,
    FLOOR_MAT: FLOOR_MAT,
    STEP_GAIN: STEP_GAIN,
    STRIDE: STRIDE,
    MAX_VOICES: MAX_VOICES,
    STORE_KEY: STORE_KEY,
    render: renderVoice,
    renderBuild: renderBuild,
    metricsOf: metricsOf,
    attenuationFor: attenuationFor,
    lowpassFor: lowpassFor,
    panFor: panFor,
    /* P4.10: 施設全体に届く絶叫の音量（純関数。機械テストはここを直接検査する） */
    shriekGainAt: shriekGainAt,
    /* P4.12 項目5: 距離連動の鼓動（純関数。機械テストはここを直接検査する） */
    heartbeatFor: heartbeatFor,
    HB_START: HB_START, HB_FULL: HB_FULL,
    HB_BPM_MIN: HB_BPM_MIN, HB_BPM_MAX: HB_BPM_MAX,
    HB_LEVEL_MIN: HB_LEVEL_MIN, HB_LEVEL_MAX: HB_LEVEL_MAX, HB_LEVEL_CAP: HB_LEVEL_CAP,
    /* P4.15: すすり泣き→絶叫（字幕の同期と機械テストが直接見る） */
    SOB_ONSET: SOB_ONSET, SOB_SCR: SOB_SCR, SOB_WET: SOB_WET, SOB_G: SOB_G, SOB_TRIM: SOB_TRIM,
    /* P4.13 項目3: 緊迫層・ダッキング（機械テストが直接見る） */
    TEN_CYCLE: TEN_CYCLE, TEN_CHUNK: TEN_CHUNK, TEN_MIX: TEN_MIX, TEN_RISE: TEN_RISE,
    TEN_XF: TEN_XF, TEN_HOP: TEN_HOP, TEN_OCT: TEN_OCT,
    scheduleTensionChunk: scheduleTensionChunk,
    HB_DUCK_DIST: HB_DUCK_DIST, HB_DUCK_AMOUNT: HB_DUCK_AMOUNT, AMB_BUS_GAIN: AMB_BUS_GAIN,
    /* P4.16 項目3: 鼓動の画面表示（純関数。機械テストはここを直接検査する） */
    hbRimFor: hbRimFor, hbRimShape: hbRimShape, hbRimGradient: hbRimGradient,
    HBRIM_A: HBRIM_A, HBRIM_TAU: HBRIM_TAU, HBRIM_GAP: HBRIM_GAP, HBRIM_SECOND: HBRIM_SECOND,
    HBRIM_FAR: HBRIM_FAR, HBRIM_NEAR: HBRIM_NEAR, HBRIM_MAX: HBRIM_MAX,
    HBRIM_IN_FAR: HBRIM_IN_FAR, HBRIM_IN_NEAR: HBRIM_IN_NEAR,
    envelopePeaks: envelopePeaks,
    centroidSeries: centroidSeries,
    lowRatioIn: lowRatioIn,
    SHRIEK_MAX_DIST: SHRIEK_MAX_DIST,
    SHRIEK_ATTEN_FLOOR: SHRIEK_ATTEN_FLOOR,
    ATTEN_MAX: ATTEN_MAX,
    OCCLUDE_GAIN: OCCLUDE_GAIN,
    prewarm: prewarm,
    cache: renderCache,
    prewarmList: PREWARM,
    prewarmError: function () { return prewarmError; },
    ready: function () {
      for (var i = 0; i < PREWARM.length; i++) if (!renderCache[PREWARM[i].key]) return false;
      return true;
    }
  };

  /* 解錠: 初回のタップ/クリック/キーで1回だけ */
  function onFirstGesture() {
    if (engine.unlock()) {
      document.removeEventListener('pointerdown', onFirstGesture, true);
      document.removeEventListener('touchstart', onFirstGesture, true);
      document.removeEventListener('mousedown', onFirstGesture, true);
      global.removeEventListener('keydown', onFirstGesture, true);
    }
  }
  document.addEventListener('pointerdown', onFirstGesture, true);
  document.addEventListener('touchstart', onFirstGesture, true);
  document.addEventListener('mousedown', onFirstGesture, true);
  global.addEventListener('keydown', onFirstGesture, true);

  /* 2026-09-07: 解錠後も外さない操作フック。ユーザー操作があれば停止中の
     AudioContext を即座に再開する（ブラウザは操作起点の resume を最も確実に通す） */
  function onAnyGesture() {
    if (!engine.ctx || engine.hidden || engine.testMode) return;
    if (engine.ctx.state !== 'running') { engine._resumeT = 0; engine.tryResume(0); }
  }
  document.addEventListener('pointerdown', onAnyGesture, true);
  document.addEventListener('touchstart', onAnyGesture, true);
  global.addEventListener('keydown', onAnyGesture, true);

  /* ページ非表示で環境音を止める（契約: 鳴りっぱなしにしない） */
  document.addEventListener('visibilitychange', function () {
    engine.hidden = (document.visibilityState === 'hidden');
    if (!engine.ctx) return;
    try {
      if (engine.hidden) { engine.panic(); if (engine.ctx.suspend) engine.ctx.suspend(); }
      else if (engine.ctx.resume && !engine.testMode) engine.ctx.resume();
    } catch (e) { engine.errors++; }
  });

  /** ノイズ演出の下地（画像は使わずCanvasで生成する＝$0構成） */
  function buildNoiseTexture() {
    var el = document.getElementById('fx-noise');
    if (!el || el.style.backgroundImage) return;
    try {
      var s = 96;
      var cv = document.createElement('canvas');
      cv.width = s; cv.height = s;
      var g2 = cv.getContext('2d');
      var img = g2.createImageData(s, s);
      var rnd = lcg(90210);
      for (var i = 0; i < s * s; i++) {
        var v = (rnd() * 255) | 0;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g2.putImageData(img, 0, 0);
      el.style.backgroundImage = 'url(' + cv.toDataURL('image/png') + ')';
    } catch (e) { /* 生成できなければノイズ無しで進む */ }
  }

  function install() {
    if (ESCAPE.game) engine.attach(ESCAPE.game);
    buildNoiseTexture();
    prewarm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }

  /* ================================================================
   * P4.13 項目3 機械テスト（契約 §4「鼓動と追跡音の強化」／§6）
   *   test.js はメイン/レーンBの領域なので、他モジュールと同じ流儀で
   *   ESCAPE.__extraSuites へ積む。署名は test.js の suites と同じ (t, g)。
   * ============================================================== */
  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];

  /** 鼓動の音色と数値（二拍・低域主体・音量上限・クリップ禁止） */
  function testP413Heartbeat(t, g) {
    var A = ESCAPE.Audio, c = A.cache;
    t.near(A.HB_LEVEL_CAP, 1.15 * 1.5, 1e-9,
      'P4.13 項目3: 鼓動の上限が旧上限の1.5倍（契約）', A.HB_LEVEL_CAP);
    t.ok(A.heartbeatFor(5, false).near >= 1 - 1e-9,
      'P4.13 項目3: 5mで「胸に響く厚み」が最大', A.heartbeatFor(5, false).near.toFixed(3));
    t.ok(A.heartbeatFor(20, false).near <= 1e-9,
      'P4.13 項目3: 20mでは厚みなし（微弱な鼓動）');
    t.ok(A.heartbeatFor(5, true).level <= A.HB_LEVEL_CAP + 1e-9,
      'P4.13 項目3: 追跡中の至近でも上限で頭打ち', A.heartbeatFor(5, true).level.toFixed(3));

    if (!t.ok(!!(c.hb_d5 && c.hb_d20 && c.hb_max), 'P4.13 項目3: 鼓動のレンダが揃っている',
      A.prewarmError() || '')) return;
    t.ok(c.hb_d5.rms >= c.hb_d20.rms * 3,
      'P4.13 項目3: 5mのRMSが20mの3倍以上（契約）',
      c.hb_d5.rms.toFixed(5) + ' vs ' + (c.hb_d20.rms * 3).toFixed(5));
    t.ok(c.hb_d5.lowRatio >= 0.5,
      'P4.13 項目3: 第1音は低域(<120Hz)が全体の50%以上（契約）',
      (c.hb_d5.lowRatio * 100).toFixed(1) + '%');
    t.ok(c.hb_max.lowRatio >= 0.5,
      'P4.13 項目3: 最大音量でも第1音は低域主体', (c.hb_max.lowRatio * 100).toFixed(1) + '%');
    t.ok(c.hb_max.peak < 0.98 && !c.hb_max.clipped,
      'P4.13 項目3: 最大音量でもクリップしない（peak<0.98）', c.hb_max.peak.toFixed(4));
    t.ok(c.hb_d5.peaks === 2,
      'P4.13 項目3: 鼓動は二拍（ドッ→クン）', c.hb_d5.peaks + '拍 ' +
      (c.hb_d5.peakTimes || []).map(function (v) { return v.toFixed(3); }).join('/'));
    if (c.hb_d5.peakTimes && c.hb_d5.peakTimes.length === 2) {
      var gap = c.hb_d5.peakTimes[1] - c.hb_d5.peakTimes[0];
      t.ok(gap >= 0.115 && gap <= 0.170,
        'P4.13 項目3: 第2音は120〜160ms後（契約）', (gap * 1000).toFixed(0) + 'ms');
    }
  }

  /** 緊迫層（終わりなき上昇・呼吸・金属の擦過）の数値 */
  function testP413Tension(t, g) {
    var A = ESCAPE.Audio, c = A.cache;
    if (!t.ok(!!(c.tension8 && c.ragged && c.scrape), 'P4.13 項目3: 緊迫層のレンダが揃っている',
      A.prewarmError() || '')) return;
    var cs = c.tension8.centroids || [];
    t.ok(cs.length >= 8, 'P4.13 項目3: 緊迫層を8秒ぶん解析している', cs.length + '区間');
    var mono = true, worst = 0;
    for (var i = 1; i < cs.length; i++) {
      if (!(cs[i] > cs[i - 1])) mono = false;
      var up = cs[i] / Math.max(1, cs[i - 1]);
      if (worst === 0 || up < worst) worst = up;
    }
    t.ok(mono, 'P4.13 項目3: スペクトル重心が1秒刻みで単調上昇（終わりなく上がる層）',
      cs.map(function (v) { return v.toFixed(0); }).join('→'));
    t.ok(cs.length > 1 && cs[cs.length - 1] > cs[0] * 1.15,
      'P4.13 項目3: 8秒で重心がはっきり上がる',
      (cs.length ? (cs[cs.length - 1] / Math.max(1, cs[0])).toFixed(2) : '—') + '倍');
    t.ok(c.tension8.peak < 0.98 && !c.tension8.clipped,
      'P4.13 項目3: 緊迫層がクリップしない（peak<0.98）', c.tension8.peak.toFixed(4));
    t.ok(c.tension8.rms > 0.02, 'P4.13 項目3: 緊迫層が実体のある音量で鳴る', c.tension8.rms.toFixed(4));
    t.ok(c.tension8.activeRatio > 0.95,
      'P4.13 項目3: 緊迫層は途切れず持続する', c.tension8.activeRatio.toFixed(3));
    t.ok(c.ragged.peak < 0.98 && !c.ragged.clipped && c.ragged.rms > 0.008,
      'P4.13 項目3: 荒い呼吸が鳴りクリップしない',
      'rms=' + c.ragged.rms.toFixed(4) + ' peak=' + c.ragged.peak.toFixed(4));
    t.ok(c.scrape.peak < 0.98 && !c.scrape.clipped && c.scrape.rms > 0.008,
      'P4.13 項目3: 金属の擦過が鳴りクリップしない',
      'rms=' + c.scrape.rms.toFixed(4) + ' peak=' + c.scrape.peak.toFixed(4));
    /* 継ぎ目: シェパードの回り込みが自己写像なので、チャンクを継ぎ足しても段差が出ない */
    var sm = c.tension_seam;
    if (t.ok(!!sm, 'P4.13 項目3: 継ぎ足し（2チャンク）のレンダがある')) {
      t.ok(sm.stepAt !== undefined && sm.stepRef > 0 && sm.stepAt <= sm.stepRef * 1.6,
        'P4.13 項目3: チャンクの継ぎ目に段差が出ない（ループ継ぎ目を聞かせない）',
        '継ぎ目=' + (sm.stepAt || 0).toFixed(5) + ' / 平常時=' + (sm.stepRef || 0).toFixed(5));
      var cs2 = sm.centroids || [];
      var mono2 = cs2.length >= 10;
      for (var q = 1; q < cs2.length; q++) if (!(cs2[q] > cs2[q - 1])) mono2 = false;
      t.ok(mono2, 'P4.13 項目3: 継ぎ足した先でも重心は上がり続ける（終わりがない）',
        cs2.map(function (v) { return v.toFixed(0); }).join('→'));
      t.ok(sm.peak < 0.98 && !sm.clipped,
        'P4.13 項目3: 継ぎ足してもクリップしない', (sm.peak || 0).toFixed(4));
    }

    /* バランス: 緊迫層は実際の混ぜ量（TEN_MIX）で他の層を埋めない */
    if (c.shriek && c.enemyClaw && c.hb_d5) {
      var mix = c.tension8.rms * A.TEN_MIX;
      t.ok(mix < c.shriek.rms, 'P4.13 項目3: 緊迫層が絶叫を埋めない',
        mix.toFixed(4) + ' < ' + c.shriek.rms.toFixed(4));
      t.ok(mix < c.hb_d5.rms, 'P4.13 項目3: 緊迫層が至近の鼓動を埋めない',
        mix.toFixed(4) + ' < ' + c.hb_d5.rms.toFixed(4));
      t.ok(mix < c.enemyClaw.rms * 1.6, 'P4.13 項目3: 緊迫層が敵の爪音を埋めない',
        mix.toFixed(4) + ' vs ' + c.enemyClaw.rms.toFixed(4));
    }
  }

  /** 実プレイ: 追跡中は緊迫層が鳴り続け、解除で抜ける。5m以内で環境音がダッキングする */
  function testP413TensionInPlay(t, g) {
    g.reset();
    var au = ESCAPE.audio;
    if (!t.ok(!!au, 'P4.13 項目3: 音響エンジンがある')) return;
    var was = au.testMode;
    au.testMode = true;
    var ai = g.ai, other = (g.ais && g.ais.list[1]) || null;
    if (other) other.manual = true;
    ai.manual = true;                   /* 状態機械を止めて追跡状態だけを作る */
    ai.state = 'chase';
    var b0 = au.fired.raggedBreath || 0, s0 = au.fired.metalScrape || 0;
    for (var i = 0; i < 360; i++) { ai.state = 'chase'; g.stepFrame(ESCAPE.FIXED_DT); }
    t.ok(au.chaseNow === true, 'P4.13 項目3: 追跡中を検出している');
    t.ok(au.tensionOn === true && au.tensionLevel > 0.9,
      'P4.13 項目3: 追跡中は緊迫層が緩まない', au.tensionLevel.toFixed(3));
    t.ok((au.fired.raggedBreath || 0) - b0 >= 3,
      'P4.13 項目3: 追跡中は荒い呼吸が繰り返し鳴る', ((au.fired.raggedBreath || 0) - b0) + '回');
    var scr = (au.fired.metalScrape || 0) - s0;
    t.ok(scr >= 1 && scr <= 4,
      'P4.13 項目3: 金属の擦過が2〜4秒間隔で入る（6秒で1〜4回）', scr + '回');
    /* 追跡解除 → 緊迫層が抜ける */
    ai.state = 'patrol';
    for (var j = 0; j < 240; j++) { ai.state = 'patrol'; g.stepFrame(ESCAPE.FIXED_DT); }
    t.ok(au.tensionOn === false && au.tensionLevel === 0,
      'P4.13 項目3: 追跡が解けると緊迫層が抜ける', au.tensionLevel.toFixed(4));

    /* 5m以内で環境音バスがわずかにダッキングする */
    var cells = g.map.walkableCells(), e = ai.enemy, spot = null;
    for (var k = 0; k < cells.length && !spot; k++) {
      var cc = g.map.cellCenter(cells[k].col, cells[k].row);
      var d = Math.hypot(cc.x - e.x, cc.z - e.z);
      if (d >= 3.0 && d <= 4.5) spot = cc;
    }
    if (t.ok(!!spot, 'P4.13 項目3: 敵から3〜4.5mの立ち位置がある')) {
      for (var m = 0; m < 90; m++) {
        g.player.x = spot.x; g.player.z = spot.z;
        g.stepFrame(ESCAPE.FIXED_DT);
      }
      t.ok(au.ambDuck > 0.5, 'P4.13 項目3: 5m以内で環境音がダッキングする', au.ambDuck.toFixed(3));
      t.ok(au.ambDuck <= 1.0 + 1e-9 && A_DUCK_OK(au),
        'P4.13 項目3: ダッキングはわずか（環境音バスは基準の7割以上を保つ）',
        au.bus ? (au.bus.amb.gain.value / 0.9).toFixed(3) : '未解錠');
    }
    ai.manual = false;
    if (other) other.manual = false;
    au.testMode = was;
    g.reset();
    t.ok(au.ambDuck === 0, 'P4.13 項目3: 復帰でダッキングが戻る', au.ambDuck.toFixed(3));
  }

  /** ダッキング量が「わずか」に収まっているか（未解錠なら判定を通す） */
  function A_DUCK_OK(au) {
    if (!au.bus || !au.bus.amb) return true;
    return au.bus.amb.gain.value >= AMB_BUS_GAIN * 0.70 - 1e-9;
  }


  /* ================================================================
   * P4.16 項目3 機械テスト（契約 §4「P4.16 再プレイ差し戻し」項目3）
   *   距離20/12/5m・追跡での不透明度ピーク／拍間の減衰／中央透明／停止時0。
   *   DOM は computed style で判定する。
   * ============================================================== */

  /** 純関数（距離→ピーク不透明度・無着色半径）と包絡 */
  function testP416HeartRimNumbers(t, g) {
    var A = ESCAPE.Audio;
    var f20 = A.hbRimFor(20, false), f12 = A.hbRimFor(12, false), f5 = A.hbRimFor(5, false);
    var fc = A.hbRimFor(5, true), fc20 = A.hbRimFor(20, true);
    t.ok(f20.amp >= 0.08 && f20.amp <= 0.15,
      'P4.16 項目3: 20m の縁のピーク不透明度は0.08〜0.15（契約）', f20.amp.toFixed(3));
    t.ok(f5.amp >= 0.45 && f5.amp <= 0.60,
      'P4.16 項目3: 5m の縁のピーク不透明度は0.45〜0.60（契約）', f5.amp.toFixed(3));
    t.ok(f12.amp > f20.amp && f12.amp < f5.amp,
      'P4.16 項目3: 12m は20mより濃く5mより薄い（距離で連続に変わる）', f12.amp.toFixed(3));
    t.near(fc.amp, A.HBRIM_MAX, 1e-9, 'P4.16 項目3: 追跡中は最大（0.60）', fc.amp.toFixed(3));
    t.near(fc20.amp, A.HBRIM_MAX, 1e-9, 'P4.16 項目3: 追跡中は距離に依らず最大', fc20.amp.toFixed(3));
    t.ok(A.HBRIM_MAX <= 0.60 + 1e-9, 'P4.16 項目3: 縁は0.60を超えない（中央の視認性）', A.HBRIM_MAX);

    /* 内側への広がり: 近いほど中心へ寄る。ただし常に半径40%は無着色 */
    t.ok(f20.inner > f5.inner, 'P4.16 項目3: 近いほど内側へ広がる',
      f20.inner.toFixed(0) + '% → ' + f5.inner.toFixed(0) + '%');
    var innBad = [];
    for (var d = 0; d <= 24; d += 1) {
      if (A.hbRimFor(d, false).inner < 40 - 1e-9) innBad.push(d + 'm');
      if (A.hbRimFor(d, true).inner < 40 - 1e-9) innBad.push(d + 'm(追跡)');
    }
    t.ok(innBad.length === 0, 'P4.16 項目3: 中心から半径40%は常に無着色（契約）',
      innBad.join(' ') || '0〜24m を検査');

    /* 包絡: 第1音で最大・第2音は弱い・次の拍までに20%以下 */
    var A0 = A.HBRIM_A, GAP = A.HBRIM_GAP, SEC = A.HBRIM_SECOND;
    function sum(tt) { return A.hbRimShape(tt) + SEC * A.hbRimShape(tt - GAP); }
    t.near(sum(A0), 1, 1e-9, 'P4.16 項目3: 第1音の立ち上がりでピーク（=1）', sum(A0).toFixed(4));
    t.ok(sum(GAP + A0) < sum(A0) * 0.85,
      'P4.16 項目3: 第2音は第1音より弱い（ドッ→クン）',
      sum(GAP + A0).toFixed(3) + ' vs ' + sum(A0).toFixed(3));
    var fastBpm = A.HB_BPM_MAX + 14;                 /* 追跡中の最速 */
    var period = 60 / fastBpm;
    t.ok(sum(period) <= 0.20,
      'P4.16 項目3: 最速の拍でも次の拍までにピークの20%以下へ減衰（契約）',
      (sum(period) * 100).toFixed(1) + '% @' + fastBpm.toFixed(0) + 'bpm');
    t.ok(sum(60 / A.hbRimFor(5, false).bpm) <= 0.20,
      'P4.16 項目3: 5m（非追跡）でも拍ごとに減衰しきる',
      (sum(60 / A.hbRimFor(5, false).bpm) * 100).toFixed(1) + '%');
    t.ok(sum(1.0) < 0.001, 'P4.16 項目3: 鳴り止めば縁は消える', sum(1.0).toFixed(5));

    /* グラデーションの中央が透明であること（文字列を直接見る） */
    var gs = A.hbRimGradient(40);
    t.ok(gs.indexOf('rgba(122,10,10,0) 0%') >= 0 && gs.indexOf('rgba(122,10,10,0) 40%') >= 0,
      'P4.16 項目3: 中心40%まで完全に透明なグラデーション', gs.slice(0, 84));
    /* 2026-09-10 差し戻し③: 楕円は画面の半幅・半高いっぱい（旧 50% では赤が中央を侵す） */
    t.ok(gs.indexOf('ellipse 100% 100% at 50% 50%') >= 0,
      'P4.16 項目3: 赤は画面端から内側60%までに広がる（楕円は画面いっぱい）', gs.slice(0, 46));
  }

  /** DOM（computed style）での判定 */
  function testP416HeartRimDom(t, g) {
    var A = ESCAPE.Audio, au = ESCAPE.audio;
    if (!t.ok(!!au, 'P4.16 項目3: 音響エンジンがある')) return;
    var el = au._ensureHbRim ? au._ensureHbRim() : null;
    if (!t.ok(!!el, 'P4.16 項目3: 鼓動の縁の要素が JS から作られている')) return;
    t.ok(el.parentNode === document.body, 'P4.16 項目3: body 直下にある');
    var cs = global.getComputedStyle(el);
    t.ok(cs.position === 'fixed', 'P4.16 項目3: 画面に固定されている', cs.position);
    t.ok(cs.pointerEvents === 'none', 'P4.16 項目3: 操作を奪わない（pointer-events:none）',
      cs.pointerEvents);
    var vg = document.getElementById('fx-vignette');
    var zr = parseInt(cs.zIndex, 10), zv = vg ? parseInt(global.getComputedStyle(vg).zIndex, 10) : 0;
    t.ok(isFinite(zr) && zr > zv, 'P4.16 項目3: 既存の周辺減光より上のレイヤー',
      zr + ' > ' + zv);
    t.ok(vg && vg !== el, 'P4.16 項目3: fx.vignette とは別レイヤー');

    var was = au.testMode, dt = ESCAPE.FIXED_DT;
    au.testMode = true;
    au._hbRimBeat(5, false);
    au._stepHbRim(A.HBRIM_A, false);
    au._applyFxDom(true);
    t.near(parseFloat(global.getComputedStyle(el).opacity), 0, 1e-6,
      'P4.16 項目3: テストモードでは縁は出ない');

    au.testMode = false;
    var cases = [[20, false, 0.08, 0.15], [12, false, 0.15, 0.45], [5, false, 0.45, 0.60],
      [5, true, 0.59, 0.61]];
    for (var i = 0; i < cases.length; i++) {
      var dist = cases[i][0], chase = cases[i][1];
      au._hbImp.length = 0; au.hbRim.v = 0;
      au._hbRimBeat(dist, chase);
      au._stepHbRim(A.HBRIM_A, false);
      au._applyFxDom(true);
      var op = parseFloat(global.getComputedStyle(el).opacity);
      t.ok(op >= cases[i][2] - 1e-6 && op <= cases[i][3] + 1e-6,
        'P4.16 項目3: ' + (chase ? '追跡中' : dist + 'm') + ' のピーク不透明度 ' +
        cases[i][2] + '〜' + cases[i][3], op.toFixed(3));
      /* 無着色半径が距離で変わり、常に40%以上 */
      var bg = global.getComputedStyle(el).backgroundImage;
      /* 透明の停止位置は 0% と inner% の2つ。**最後の**透明停止位置が無着色半径。 */
      var mAll = bg.match(/rgba\(122, ?10, ?10, ?0\) (\d+)%/g);
      var innPct = mAll ? parseInt(/(\d+)%/.exec(mAll[mAll.length - 1])[1], 10) : -1;
      t.ok(innPct >= 40,
        'P4.16 項目3: ' + (chase ? '追跡中' : dist + 'm') + ' も中央40%は無着色',
        innPct >= 0 ? innPct + '%' : bg.slice(0, 60));
      /* 次の拍までに20%以下 */
      var peak = op, elapsed = A.HBRIM_A;
      var per = 60 / A.hbRimFor(dist, chase).bpm;
      while (elapsed < per) { au._stepHbRim(dt, false); elapsed += dt; }
      au._applyFxDom(true);
      var end = parseFloat(global.getComputedStyle(el).opacity);
      t.ok(end <= peak * 0.20 + 1e-6,
        'P4.16 項目3: ' + (chase ? '追跡中' : dist + 'm') + ' 次の拍までにピークの20%以下',
        end.toFixed(4) + ' / ' + peak.toFixed(3));
    }

    /* 第1音で強く・第2音で弱く（実際の時間発展で見る） */
    au._hbImp.length = 0; au.hbRim.v = 0;
    au._hbRimBeat(5, false);
    var v1 = 0, v2 = 0, tt = 0;
    while (tt < A.HBRIM_GAP) { au._stepHbRim(dt, false); tt += dt; if (au.hbRim.v > v1) v1 = au.hbRim.v; }
    while (tt < A.HBRIM_GAP * 2.4) { au._stepHbRim(dt, false); tt += dt; if (au.hbRim.v > v2) v2 = au.hbRim.v; }
    t.ok(v1 > v2 && v2 > 0, 'P4.16 項目3: 第1音で強く・第2音で弱く脈打つ',
      v1.toFixed(3) + ' → ' + v2.toFixed(3));

    /* 鳴っていない時は 0（演出中＝quiet でも 0） */
    au._hbRimBeat(5, false);
    au._stepHbRim(A.HBRIM_A, true);
    au._applyFxDom(true);
    t.near(parseFloat(global.getComputedStyle(el).opacity), 0, 1e-6,
      'P4.16 項目3: 演出中（メモ・牢・暗転）は縁を出さない');
    au._hbImp.length = 0; au.hbRim.v = 0;
    for (var k = 0; k < 90; k++) au._stepHbRim(dt, false);
    au._applyFxDom(true);
    t.near(parseFloat(global.getComputedStyle(el).opacity), 0, 1e-6,
      'P4.16 項目3: 鼓動が鳴っていなければ 0');

    au.testMode = was;
    au._hbImp.length = 0; au.hbRim.v = 0;
    au._applyFxDom(true);
  }

  ESCAPE.__extraSuites.push(testP413Heartbeat, testP413Tension, testP413TensionInPlay,
    testP416HeartRimNumbers, testP416HeartRimDom);

  /* 検証フック（機械テスト・E2E用） */
  global.__audioDebug = {
    engine: function () { return engine; },
    info: function () { return engine.info(); },
    events: function () { return engine.events; },
    fired: function () { return engine.fired; },
    fx: function () { return engine.fx; },
    render: renderVoice,
    prewarm: prewarm,
    cache: function () { return renderCache; },
    ready: function () { return ESCAPE.Audio.ready(); },
    unlock: function () { return engine.unlock(); },
    setVolume: function (v) { return engine.setVolume(v); },
    getVolume: function () { return engine.getVolume(); },
    voices: function () { return Object.keys(VOICES); }
  };
})(window);
