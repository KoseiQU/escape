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

    /** 心拍（二拍） */
    heartbeat: function (ctx, dest, t0, p) {
      var lv = (p.level === undefined) ? 0.8 : p.level;
      var pairs = [[0, 1.0, 0.130], [0.155, 0.62, 0.160]];
      for (var i = 0; i < pairs.length; i++) {
        var t = t0 + pairs[i][0];
        var o = osc(ctx, 'sine', 58);
        o.frequency.setValueAtTime(72, t);
        o.frequency.exponentialRampToValueAtTime(34, t + pairs[i][2]);
        chain([o, hit(ctx, t, 0.70 * lv * pairs[i][1], 0.008, pairs[i][2]), dest]);
        startStop(o, t, pairs[i][2] + 0.06);
        /* 胸の内側の擦れ */
        var n = noiseSrc(ctx, 0.35);
        chain([n, bq(ctx, 'lowpass', 180, 0.9), hit(ctx, t, 0.10 * lv * pairs[i][1], 0.006, 0.07), dest]);
        startStop(n, t, 0.10);
      }
      return 0.40;
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
    director: { f: 38, f2: 57.0, lp: 160, air: 285, airG: 0.040, g: 0.25 }   /* 所長室: 乾いた執務室 */
  };

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

  function metricsOf(buf) {
    var d = buf.getChannelData(0);
    var n = d.length, sum = 0, peak = 0, nz = 0, onset = -1;
    for (var i = 0; i < n; i++) {
      var v = d[i], a = v < 0 ? -v : v;
      sum += v * v;
      if (a > peak) peak = a;
      if (a > 0.002) { nz++; if (onset < 0) onset = i; }
    }
    return {
      rms: Math.sqrt(sum / n),
      peak: peak,
      duration: buf.duration,
      sampleRate: buf.sampleRate,
      activeRatio: nz / n,
      onset: onset < 0 ? -1 : onset / buf.sampleRate,
      clipped: peak > 1.0
    };
  }

  /**
   * 1音を OfflineAudioContext で描画して RMS/peak を返す。
   * 実出力は一切行わない（＝出力デバイス無しの検証環境でも数値判定できる）。
   */
  function renderVoice(name, params, seconds, sampleRate) {
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
    return startRendering(ctx).then(metricsOf);
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
    { key: 'bite',        name: 'bite', params: {}, sec: 2.0 }
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
        return renderVoice(job.name, job.params, job.sec).then(function (m) {
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
      amb: gainOf(ctx, 0.9),
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
      case 'cineDrag':             /* 3 引きずられる */
        this.play('enemyDrag', { gain: 0.95, r: this._rand() });
        this.play('footstep', { gain: 0.55, mat: 'tile', level: 0.7, r: this._rand(), when: 0.22 });
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
    this.dragAcc = 0;
    this.moanT = 5.0;
    this.jointT = 3.0;
    this._eSt = null;            /* P4.10: 個体ごとの気配の累積器（作り直す） */
    this.dripT = 4.0;
    this.metalT = 12.0;
    this.duckT = 0;
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
    this._live.length = 0;
    this._rng = lcg(31337);
  };

  /** 製品初期状態へ戻す（game.reset() から呼ばれる）。鳴りっぱなしを止める */
  Engine.prototype.reset = function () {
    this.panic();
    this._resetState();
    this._applyFxDom(true);
  };

  /** 連続音を即座に止める（演出の中断・リセット・非表示時） */
  Engine.prototype.panic = function () {
    if (this.amb) { this.amb.out.gain.value = 0; }
    if (this.buzz) { this.buzz.out.gain.value = 0; }
    if (this.breath) { this.breath.out.gain.value = 0; }
  };

  Engine.prototype.attach = function (game) {
    this.game = game;
    this._dom = {
      vignette: document.getElementById('fx-vignette'),
      flash: document.getElementById('fx-flash'),
      noise: document.getElementById('fx-noise')
    };
    this._domVal = {};
    return this;
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
          this._noiseKind[list[i].col + ',' + list[i].row] = (list[i].kind === 'glass') ? 'glass' : 'water';
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
    this._stepFx(dt, quiet, jail);
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
    if (quiet || nd === Infinity) { this.hbT = 0; return; }

    /* 心拍（最も近い個体との距離で速まる）。
       累積器は発火時にしか減らさない＝毎フレームのレート変更で鳴らなくならない */
    var want = nearChase || nd < 8.5;
    if (want) {
      var bpm = clamp(158 - nd * 3.6, 74, 158);
      this.hbT += dt;
      var period = 60 / bpm;
      if (this.hbT >= period) {
        this.hbT -= period;
        if (this.hbT > period) this.hbT = 0;    /* 大きな dt で溜まりすぎない */
        var near = clamp(1 - nd / 16, 0.25, 1);
        this.play('heartbeat', { level: 0.35 + near * 0.6, bus: 'self', priority: nearChase ? 1 : 0 });
      }
    } else {
      this.hbT = 0;
    }
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
    var ns = clamp(fx.noise, 0, 1);
    if (d.noise && (force || Math.abs((v.ns || 0) - ns) > 0.004)) {
      d.noise.style.opacity = (ns * 0.55).toFixed(3);
      v.ns = ns;
    }
    /* 瞬間暗転は既存の #blackout を借りず専用に扱う（牢の暗転と混ざらないため
       vignette の要素を一時的に真っ黒にする） */
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
    metricsOf: metricsOf,
    attenuationFor: attenuationFor,
    lowpassFor: lowpassFor,
    panFor: panFor,
    /* P4.10: 施設全体に届く絶叫の音量（純関数。機械テストはここを直接検査する） */
    shriekGainAt: shriekGainAt,
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
