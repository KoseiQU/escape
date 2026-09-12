/* ESCAPE — P4.18 項目4: 目覚めの演出（起床）
 * 契約 DESIGN.md §4「P4.18 iPhone実機評」項目4
 *
 *  `最初から`（＝新規開始）… 約4.0秒
 *     暗転 → まぶたが開く（上下から黒が引く・途中で瞬き2回）→ 視点は床に伏せた
 *     高さ0.35m・少し傾いた状態から目線の高さ(1.62m)へイージングで起き上がる →
 *     視界のぼけは最初強く、晴れていく → 荒い呼吸と衣擦れ → 操作可能。
 *  `続きから` … 短い瞬き（1.2秒）だけ。カメラは目線の高さのまま動かさない。
 *  捕獲後の復帰は現行の暗転のまま（このモジュールは関与しない）。
 *
 * 演出中は入力を受けない（js/input.js の setLocked。画面タップで短縮**不可**。
 * 機械テスト用の skip() だけが飛ばせる）。
 * 敵AI・鼓動・声は動かない: js/game.js の stepFrame はタイトルと同じゲートで止まり、
 * この演出だけが専用の更新（Wake.step）で回る＝ simTime も frameCount も進まない。
 *
 * 視界のぼけ: 後処理（P4.17 の系統Z）は既定で無効なので、契約が認める代替
 * 「DOM の白/黒のフェード」側を採る。#view への CSS filter: blur() ＋ 黒の veil で出す。
 *
 * 決定性: 時間は固定ステップ(1/60秒)の積算だけで進む＝ __pump 駆動のスクショでも
 * 同じ絵になる（乱数も CSS 遷移も使わない）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var DUR_NEW = 4.0;          /* 契約「約4秒の起床演出」 */
  var DUR_BLINK = 1.2;        /* 契約「`続きから` は短い瞬き（1.2秒）だけ」 */
  var EYE_FLOOR = 0.35;       /* 契約「床に伏せた低い位置（高さ0.35m）」 */
  var TILT = 0.17;            /* 契約「少し傾き」（roll, rad） */
  var PITCH0 = -0.26;         /* 起き抜けは床側を向いている（rad・下向き） */
  var RISE_T0 = 0.55, RISE_T1 = 3.20;   /* 起き上がりの区間(s) */
  var LID_T0 = 0.42, LID_T1 = 1.05;     /* まぶたが引く区間(s) */
  var BLINK1 = 1.40, BLINK2 = 2.10, BLINK_HALF = 0.15;  /* 瞬き2回の中心と半幅(s) */
  var BLUR_MAX = 9;           /* 視界のぼけ(px)。最初だけ強く、晴れる */
  var BLUR_T1 = 2.60;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function easeOut(t) { t = clamp01(t); var u = 1 - t; return 1 - u * u * u; }
  function span(t, a, b) { return clamp01((t - a) / (b - a)); }
  /** 瞬き1回（中心 c・半幅 h の三角形。頂点で完全に閉じる） */
  function blinkAt(t, c, h) {
    var d = Math.abs(t - c);
    if (d >= h) return 0;
    return 0.5 * (1 - d / h);
  }

  function eyeStand() {
    return (ESCAPE.Player && ESCAPE.Player.EYE_STAND) || 1.62;
  }

  /* ---------------- 演出の形（純関数。機械テストはこれを直接読む） ---------------- */

  /**
   * mode: 'new' | 'blink'
   * 戻り値: { lid, veil, blur, eye, roll, pitch }
   *   lid   … 上下の黒帯それぞれが画面高に占める割合（0.5 で完全に閉じる）
   *   veil  … 全面の黒の不透明度
   *   blur  … #view にかけるぼけ(px)
   *   eye   … カメラの目線の高さ(m)
   *   roll  … カメラの傾き(rad)
   *   pitch … 通常の視線からの上下オフセット(rad)
   */
  function frameOf(t, mode) {
    var dur = durationOf(mode);
    if (t < 0) t = 0;
    if (t > dur) t = dur;
    var stand = eyeStand();
    if (mode === 'blink') {
      var lidB = Math.max(0.5 * (1 - easeOut(span(t, 0.06, 0.42))), blinkAt(t, 0.74, 0.13));
      return {
        lid: lidB,
        veil: 1 - easeOut(span(t, 0.06, 0.42)),
        blur: 4 * (1 - easeOut(span(t, 0.06, 0.70))),
        eye: stand, roll: 0, pitch: 0
      };
    }
    /* 'new' */
    var base = 0.5 * (1 - easeOut(span(t, LID_T0, LID_T1)));
    var lid = Math.max(base, blinkAt(t, BLINK1, BLINK_HALF), blinkAt(t, BLINK2, BLINK_HALF));
    var rise = easeOut(span(t, RISE_T0, RISE_T1));
    return {
      lid: lid,
      veil: 1 - easeOut(span(t, 0.30, 1.30)),
      blur: BLUR_MAX * (1 - easeOut(span(t, LID_T0, BLUR_T1))),
      eye: EYE_FLOOR + (stand - EYE_FLOOR) * rise,
      roll: TILT * (1 - rise),
      pitch: PITCH0 * (1 - rise)
    };
  }

  function durationOf(mode) { return (mode === 'blink') ? DUR_BLINK : DUR_NEW; }

  /* 音（既存音色の流用＝契約で可）。
     荒い呼吸 = raggedBreath（P4.13 で作った自分の息）／衣擦れ = paper を小さく鳴らす
     （紙の擦れ＝広帯域ノイズの短い擦過。布擦れとして通る唯一の既存音色） */
  var CUES_NEW = [
    { t: 0.45, name: 'raggedBreath', gain: 0.95 },
    { t: 1.15, name: 'paper', gain: 0.30 },
    { t: 1.75, name: 'raggedBreath', gain: 0.80 },
    { t: 2.45, name: 'paper', gain: 0.24 },
    { t: 3.05, name: 'raggedBreath', gain: 0.60 }
  ];
  var CUES_BLINK = [{ t: 0.12, name: 'raggedBreath', gain: 0.45 }];

  /* ---------------- 本体 ---------------- */

  function Wake() {
    this.mode = null;        /* null | 'new' | 'blink' */
    this.t = 0;
    this.dom = null;
    this.runs = 0;           /* 演出を始めた回数（機械テスト用） */
    this.skips = 0;
    this.cues = 0;           /* 鳴らした音の数 */
    this._cueI = 0;
    this._pitch0 = 0;
  }

  Wake.prototype.install = function () {
    this.dom = {
      root: document.getElementById('wake'),
      veil: document.getElementById('wake-veil'),
      top: document.getElementById('wake-lid-top'),
      bottom: document.getElementById('wake-lid-bottom')
    };
    return this;
  };

  Wake.prototype.active = function () { return this.mode !== null; };
  /** ゲームの更新を止めるべきか（js/game.js stepFrame がタイトルと同じゲートで見る） */
  Wake.prototype.blocking = function () { return this.mode !== null; };
  Wake.prototype.duration = function (mode) { return durationOf(mode === undefined ? this.mode : mode); };
  Wake.prototype.frame = function (t, mode) { return frameOf(t, mode === undefined ? this.mode : mode); };

  /** 演出を開始する。mode: 'new'（約4秒）/ 'blink'（1.2秒） */
  Wake.prototype.begin = function (mode) {
    var g = ESCAPE.game;
    if (!g) return false;
    if (!this.dom) this.install();
    this.mode = (mode === 'blink') ? 'blink' : 'new';
    this.t = 0;
    this._cueI = 0;
    this.runs++;
    this._pitch0 = g.player.pitch;
    if (g.input && g.input.setLocked) g.input.setLocked(true);
    if (this.dom.root) this.dom.root.classList.add('on');
    this._apply(frameOf(0, this.mode));
    return true;
  };

  /** 固定ステップの更新（js/game.js stepFrame の先頭から呼ばれる。演出専用の更新） */
  Wake.prototype.step = function (dt) {
    if (this.mode === null) return false;
    this.t += dt;
    var mode = this.mode, dur = durationOf(mode);
    this._fireCues(mode);
    if (this.t >= dur) { this._finish(); return true; }
    this._apply(frameOf(this.t, mode));
    return true;
  };

  /** 演出を飛ばして終わりの状態にする（機械テスト用。タップからは呼ばない） */
  Wake.prototype.skip = function () {
    if (this.mode === null) return false;
    this.skips++;
    this.t = durationOf(this.mode);
    this._finish();
    return true;
  };

  /** タイトルへ戻る等で演出を畳む（skip と同じ後始末。回数だけ数えない） */
  Wake.prototype.cancel = function () {
    if (this.mode === null) return false;
    this.t = durationOf(this.mode);
    this._finish();
    return true;
  };

  Wake.prototype._fireCues = function (mode) {
    var list = (mode === 'blink') ? CUES_BLINK : CUES_NEW;
    var au = ESCAPE.audio;
    while (this._cueI < list.length && list[this._cueI].t <= this.t) {
      var c = list[this._cueI++];
      this.cues++;
      if (au && au.play) {
        try { au.play(c.name, { bus: 'self', gain: c.gain, r: 0.5 }); }
        catch (e) { /* 解錠前・出力デバイス無しは無視（fired の記録だけ残る） */ }
      }
    }
  };

  /** 1フレームぶんの見た目を書く（CSS遷移に頼らない＝ __pump でも同じ絵） */
  Wake.prototype._apply = function (f) {
    var g = ESCAPE.game, d = this.dom;
    if (d) {
      var h = (f.lid * 100).toFixed(3) + '%';
      if (d.top) d.top.style.height = h;
      if (d.bottom) d.bottom.style.height = h;
      if (d.veil) d.veil.style.opacity = clamp01(f.veil).toFixed(3);
    }
    if (g && g.canvas) {
      g.canvas.style.filter = (f.blur > 0.05) ? ('blur(' + f.blur.toFixed(2) + 'px)') : '';
    }
    if (!g) return;
    g.player.eyeHeight = f.eye;
    g.player.pitch = this._pitch0 + f.pitch;
    g.syncCamera();
    /* 傾きは syncCamera（揺れ）の後に握る＝上書き事故を防ぐ（捕獲演出と同じ流儀） */
    g.camera.rotation.z = f.roll;
  };

  Wake.prototype._finish = function () {
    var g = ESCAPE.game, d = this.dom;
    this.mode = null;
    this.t = 0;
    if (d) {
      if (d.root) d.root.classList.remove('on');
      if (d.top) d.top.style.height = '0%';
      if (d.bottom) d.bottom.style.height = '0%';
      if (d.veil) d.veil.style.opacity = '0';
    }
    if (!g) return;
    if (g.canvas) g.canvas.style.filter = '';
    g.player.eyeHeight = eyeStand();
    g.player.pitch = this._pitch0;
    g.syncCamera();
    g.camera.rotation.z = 0;
    if (g.input && g.input.setLocked) g.input.setLocked(false);
    /* 演出の間に溜まった実時間を捨てる（明けた瞬間に何フレームも一気に進まない） */
    g._accum = 0;
    g._last = (global.performance ? performance.now() : Date.now());
  };

  /* ---------------- 検証フック ---------------- */

  Wake.prototype.info = function () {
    var d = this.dom, cs = null;
    if (d && d.top && global.getComputedStyle) cs = global.getComputedStyle(d.top);
    var g = ESCAPE.game;
    return {
      mode: this.mode, t: this.t, dur: this.mode ? durationOf(this.mode) : 0,
      active: this.active(), blocking: this.blocking(),
      runs: this.runs, skips: this.skips, cues: this.cues,
      lidPx: cs ? parseFloat(cs.height) : 0,
      eye: g ? g.player.eyeHeight : 0,
      roll: g ? g.camera.rotation.z : 0,
      filter: (g && g.canvas) ? (g.canvas.style.filter || '') : '',
      locked: !!(g && g.input && g.input.locked)
    };
  };

  var wake = new Wake();
  ESCAPE.Wake = wake;
  ESCAPE.WAKE_CONST = {
    DUR_NEW: DUR_NEW, DUR_BLINK: DUR_BLINK, EYE_FLOOR: EYE_FLOOR,
    TILT: TILT, PITCH0: PITCH0, RISE_T0: RISE_T0, RISE_T1: RISE_T1,
    LID_T0: LID_T0, LID_T1: LID_T1, BLINK1: BLINK1, BLINK2: BLINK2,
    BLINK_HALF: BLINK_HALF, BLUR_MAX: BLUR_MAX,
    CUES_NEW: CUES_NEW, CUES_BLINK: CUES_BLINK,
    frameOf: frameOf, durationOf: durationOf
  };
  global.__wakeDebug = {
    get: function () { return wake; },
    info: function () { return wake.info(); }
  };

  function install() { wake.install(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(window);
