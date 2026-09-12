/* ESCAPE — P4.16 項目4: タイトル画面
 * 契約 DESIGN.md §4「P4.16 再プレイ差し戻し」項目4 ／ 正文 docs/notes.md「P4.16追加（導入・タイトル）」
 *
 * やること:
 *   1 起動時に黒背景のタイトル `Escape` を最前面に出す（字体の崩しと滲みは index.html の CSS）。
 *   2 数秒に一度だけグリッチ（3〜6秒間隔で 0.2〜0.4秒。常時ではない）。
 *   3 タップ/クリック/キーで AudioContext を解錠 → 1秒の暗転 → ゲーム開始。
 *   4 セーブ（escape.save.<mapId>.v2）がある時は `続きから`／`最初から` の2択。
 *     `最初から` は**全エリアの**セーブを消し、`escape.area` を area1 に戻して新規開始
 *     （確認なし＝契約）。`続きから` は `escape.area` のエリアをそのまま続ける。
 *   5 タイトル中はゲームの更新を止める（js/game.js stepFrame の頭でゲート）。
 *     ＝ step が回らないので声・鼓動・環境音は鳴らない（voice.js/audio.js は編集しない）。
 *
 * 【編集していないモジュールとの結線】
 *   - 解錠: ESCAPE.audio.unlock()（audio.js が公開している既存の経路）を呼ぶだけ。
 *     audio.js 自身も document の capture フェーズで解錠フックを張っているので、
 *     タイトルの上のタップでも二重に確実に解錠される。
 *   - ポインタロック: タイトルは canvas を覆うので、要求はタイトルを抜けた**後の**
 *     最初のクリックで起きる（js/input.js の canvas mousedown。既存挙動を壊さない）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var FADE_MS = 1000;          /* 契約「1秒の暗転を挟んでゲームへ」 */
  var GLITCH_MIN = 3000;       /* グリッチの間隔(ms)。契約 3〜6秒に一度 */
  var GLITCH_MAX = 6000;
  var GLITCH_DUR_MIN = 200;    /* グリッチの持続(ms)。契約 0.2〜0.4秒 */
  var GLITCH_DUR_MAX = 400;

  function Title() {
    this.game = null;
    this.state = 'title';      /* 'title' | 'fading' | 'playing' */
    this.mode = null;          /* 'new' | 'continue' | null（セーブ無しの単純開始） */
    this.dom = null;
    this._timer = null;
    this._glitchTimer = null;
    this._glitchOffTimer = null;
    this._bound = false;
    this.glitches = 0;         /* 発火回数（機械テスト用） */
  }

  /* ---------------- 起動 ---------------- */

  Title.prototype.install = function (game) {
    this.game = game || (ESCAPE && ESCAPE.game) || null;
    var d = this.dom = {
      overlay: document.getElementById('title-overlay'),
      stack: document.getElementById('title-stack'),
      word: document.querySelector('#title-stack .title-word.base'),
      actions: document.getElementById('title-actions'),
      tap: document.getElementById('title-tap'),
      choice: document.getElementById('title-choice'),
      btnContinue: document.getElementById('title-continue'),
      btnNew: document.getElementById('title-new')
    };
    if (!d.overlay) return this;
    this._buildGhosts();
    if (!this._bound) { this._bind(); this._bound = true; }
    this.show();
    return this;
  };

  /** 色ずれの分身（赤/シアン）を本体の複製で作る。綴りを二重に持たないため */
  Title.prototype._buildGhosts = function () {
    var d = this.dom;
    if (!d.stack || !d.word) return;
    if (d.stack.querySelector('.title-ghost')) return;
    var kinds = ['g-r', 'g-c'];
    for (var i = 0; i < kinds.length; i++) {
      var ghost = d.word.cloneNode(true);
      ghost.classList.remove('base');
      ghost.classList.add('title-ghost', kinds[i]);
      ghost.setAttribute('aria-hidden', 'true');
      d.stack.appendChild(ghost);
    }
  };

  /* ---------------- セーブの有無 ---------------- */

  Title.prototype.hasSave = function () {
    try {
      var key = ESCAPE.PROGRESS_SAVE_KEY || 'escape.save.area1.v2';
      return !!global.localStorage.getItem(key);
    } catch (e) { return false; }
  };

  /* ---------------- 表示／非表示 ---------------- */

  /** タイトルを出す（＝製品初期状態）。セーブの有無で選択肢を切り替える */
  Title.prototype.show = function () {
    var d = this.dom;
    if (!d || !d.overlay) return false;
    this._clearTimers();
    this.state = 'title';
    this.mode = null;
    /* P4.18: タイトルへ戻る＝起床演出は畳み、走るトグルは自動解除する（項目2の4条件） */
    if (ESCAPE.Wake && ESCAPE.Wake.cancel) ESCAPE.Wake.cancel();
    var gT = this.game || (ESCAPE && ESCAPE.game);
    if (gT && gT.input && gT.input.releaseRun) gT.input.releaseRun('title');
    d.overlay.classList.remove('hidden', 'fading');
    d.overlay.classList.toggle('has-save', this.hasSave());
    this._scheduleGlitch();
    return true;
  };

  /** 実際に画面へ出ているか（computed style で見る＝契約の判定方法） */
  Title.prototype.visible = function () {
    var el = this.dom && this.dom.overlay;
    if (!el || !global.getComputedStyle) return false;
    var cs = global.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return parseFloat(cs.opacity || '1') > 0.01;
  };

  /** ゲームの更新を止めるべきか（js/game.js stepFrame がこれを見る） */
  Title.prototype.blocking = function () {
    return this.state === 'title' || this.state === 'fading';
  };

  /* ---------------- 開始 ---------------- */

  /**
   * タイトルを抜ける。mode='new' はセーブを消して新規開始（確認なし＝契約）。
   * AudioContext を解錠 → 1秒の暗転 → ゲーム開始。
   */
  Title.prototype.start = function (mode) {
    if (this.state !== 'title') return false;
    this.mode = mode || (this.hasSave() ? 'continue' : null);
    if (this.mode === 'new') this._eraseSave();
    this._unlockAudio();
    this._clearTimers();
    this.state = 'fading';
    var d = this.dom;
    if (d && d.overlay) {
      d.overlay.classList.remove('glitch');
      if (d.stack) d.stack.classList.remove('glitch');
      d.overlay.classList.add('fading');
    }
    var self = this;
    this._timer = global.setTimeout(function () { self._timer = null; self._finish(); }, FADE_MS);
    return true;
  };

  /** 暗転の待ちを飛ばして即座に開始まで進める（機械テスト用。タップ経路そのものは同じ） */
  Title.prototype.flush = function () {
    if (this._timer) { global.clearTimeout(this._timer); this._timer = null; }
    if (this.state === 'fading') this._finish();
    return this.state;
  };

  /** タイトルを出さずに最初から遊べる状態にする（runAll の入口） */
  Title.prototype.skip = function () {
    if (this.state === 'playing') return false;
    /* runAll の入口。起床演出は挟まない（機械テストは演出を専用スイートで検証する） */
    if (ESCAPE.Wake && ESCAPE.Wake.cancel) ESCAPE.Wake.cancel();
    this._clearTimers();
    this.state = 'playing';
    var d = this.dom;
    if (d && d.overlay) {
      d.overlay.classList.remove('fading');
      d.overlay.classList.add('hidden');
    }
    return true;
  };

  /** 製品初期状態（＝タイトル表示）へ戻す（runAll の後始末） */
  Title.prototype.restore = function () { return this.show(); };

  Title.prototype._finish = function () {
    var d = this.dom;
    this.state = 'playing';
    if (d && d.overlay) {
      d.overlay.classList.remove('fading');
      d.overlay.classList.add('hidden');
    }
    /* タイトル中に溜まった視点・移動入力を捨てる（開始直後に視点が飛ばない） */
    var g = this.game || (ESCAPE && ESCAPE.game);
    if (g) {
      if (g.input && g.input.reset) g.input.reset();
      g._accum = 0;
      g._last = (global.performance ? performance.now() : Date.now());
    }
    /* P4.18 項目4: ここから目覚めの演出へ入る。
       `続きから` は短い瞬き(1.2秒)、それ以外（`最初から`／セーブ無しの開始＝新規）は
       約4秒の起床演出。捕獲後の復帰は現行の暗転のまま（こちらは通らない）。
       P5 エリア接続: **エリア1以外は起床演出を出さない**（契約「エリア2は起床演出なし＝
       『続きから』と同じ 1.2 秒の瞬き」）。目を覚ますのはエリア1の導入だけ。 */
    if (ESCAPE.Wake && ESCAPE.Wake.begin) {
      var home = ESCAPE.DEFAULT_AREA || 'area1';
      var firstArea = !g || !g.mapId || g.mapId === home;
      ESCAPE.Wake.begin((this.mode === 'continue' || !firstArea) ? 'blink' : 'new');
    }
  };

  /** P5 エリア接続: `最初から` は **全エリアの保存**を消し、`escape.area` を area1 に戻す。
   *  いま別のエリアを開いているなら、エリアはページ再読込でしか変わらないので読み直す。 */
  Title.prototype._eraseSave = function () {
    try {
      var keys = ESCAPE.saveKeysAll ? ESCAPE.saveKeysAll()
        : [ESCAPE.PROGRESS_SAVE_KEY || 'escape.save.area1.v2'];
      for (var i = 0; i < keys.length; i++) global.localStorage.removeItem(keys[i]);
      global.localStorage.removeItem(ESCAPE.PROGRESS_SAVE_KEY || 'escape.save.area1.v2');
    } catch (e) { /* 無視 */ }
    var home = ESCAPE.DEFAULT_AREA || 'area1';
    if (ESCAPE.setArea) ESCAPE.setArea(home);
    /* 音量などの設定は消さない（消すのは「データ全消去」ボタンの領分）。
       セーブを消したうえで進行・地図・ロープ・敵を製品初期状態へ戻す＝新規開始。 */
    var g = this.game || (ESCAPE && ESCAPE.game);
    if (g && g.mapId && g.mapId !== home) {
      if (ESCAPE.gotoArea) ESCAPE.gotoArea(home);
      else if (ESCAPE.reloadPage) ESCAPE.reloadPage();
      return;
    }
    if (g && g.reset) g.reset();
  };

  /** AudioContext の解錠。audio.js は編集しないので既存の公開経路を呼ぶだけ */
  Title.prototype._unlockAudio = function () {
    var au = ESCAPE.audio;
    if (!au) return false;
    try {
      if (au.unlock) au.unlock();
      if (au.ctx && au.ctx.state !== 'running' && au.tryResume) { au._resumeT = 0; au.tryResume(0); }
    } catch (e) { return false; }
    return true;
  };

  /* ---------------- グリッチ（3〜6秒に一度・0.2〜0.4秒） ---------------- */

  Title.prototype._scheduleGlitch = function () {
    var self = this;
    if (this._glitchTimer) global.clearTimeout(this._glitchTimer);
    var wait = GLITCH_MIN + Math.random() * (GLITCH_MAX - GLITCH_MIN);
    this._glitchTimer = global.setTimeout(function () {
      self._glitchTimer = null;
      if (self.state !== 'title') return;
      self.glitchNow();
      self._scheduleGlitch();
    }, wait);
  };

  /** グリッチを1回起こす。ms 省略時は 200〜400ms の乱数（機械テスト・監査スクショから直接呼べる） */
  Title.prototype.glitchNow = function (ms) {
    var d = this.dom;
    if (!d || !d.stack) return 0;
    var dur = (typeof ms === 'number' && ms > 0)
      ? ms : (GLITCH_DUR_MIN + Math.random() * (GLITCH_DUR_MAX - GLITCH_DUR_MIN));
    var self = this;
    d.stack.classList.remove('glitch');
    /* 直前のアニメーションを確実に打ち切ってから付け直す（連続発火でも必ず走る） */
    void d.stack.offsetWidth;
    d.stack.style.setProperty('--tg', dur.toFixed(0) + 'ms');
    d.stack.classList.add('glitch');
    this.glitches++;
    if (this._glitchOffTimer) global.clearTimeout(this._glitchOffTimer);
    this._glitchOffTimer = global.setTimeout(function () {
      self._glitchOffTimer = null;
      if (d.stack) d.stack.classList.remove('glitch');
    }, dur);
    return dur;
  };

  Title.prototype._clearTimers = function () {
    if (this._timer) { global.clearTimeout(this._timer); this._timer = null; }
    if (this._glitchTimer) { global.clearTimeout(this._glitchTimer); this._glitchTimer = null; }
    if (this._glitchOffTimer) { global.clearTimeout(this._glitchOffTimer); this._glitchOffTimer = null; }
    if (this.dom && this.dom.stack) this.dom.stack.classList.remove('glitch');
  };

  /* ---------------- 入力（スマホのタップを含む） ---------------- */

  Title.prototype._bind = function () {
    var self = this, d = this.dom;

    /* セーブがある時は2択のボタンだけが開始する（画面のどこでも開始 では選択の意味が無い） */
    function tapAnywhere(e) {
      if (self.state !== 'title') return;
      if (e) { if (e.cancelable) e.preventDefault(); e.stopPropagation(); }
      if (self.hasSave()) return;
      self.start(null);
    }
    function bindStart(el, fn) {
      if (!el) return;
      el.addEventListener('pointerdown', fn, { passive: false });
      el.addEventListener('touchstart', fn, { passive: false });
      el.addEventListener('mousedown', fn);
      /* 実際の指の動きで発火するのは pointerdown/touchstart のどちらか一方だけ＝
         state を見て弾いているので二重発火にはならない */
      el.addEventListener('touchend', function (e) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    }

    bindStart(d.overlay, tapAnywhere);
    bindStart(d.btnContinue, function (e) {
      if (self.state !== 'title') return;
      if (e) { if (e.cancelable) e.preventDefault(); e.stopPropagation(); }
      self.start('continue');
    });
    bindStart(d.btnNew, function (e) {
      if (self.state !== 'title') return;
      if (e) { if (e.cancelable) e.preventDefault(); e.stopPropagation(); }
      self.start('new');
    });

    /* キー: セーブが無ければ何のキーでも開始。有る時は Enter/Space を `続きから` に当てる
       （`最初から` はセーブの破棄なのでキー1つでは起こさない） */
    global.addEventListener('keydown', function (e) {
      if (self.state !== 'title') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (self.hasSave()) {
        if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
        e.preventDefault();
        self.start('continue');
        return;
      }
      e.preventDefault();
      self.start(null);
    });
  };

  /* ---------------- 検証フック ---------------- */

  Title.prototype.info = function () {
    var d = this.dom;
    var cs = (d && d.overlay && global.getComputedStyle) ? global.getComputedStyle(d.overlay) : null;
    return {
      state: this.state, mode: this.mode, visible: this.visible(),
      blocking: this.blocking(), hasSave: this.hasSave(),
      display: cs ? cs.display : null, visibility: cs ? cs.visibility : null,
      opacity: cs ? cs.opacity : null,
      choiceShown: !!(d && d.choice && global.getComputedStyle &&
        global.getComputedStyle(d.choice).display !== 'none'),
      tapShown: !!(d && d.tap && global.getComputedStyle &&
        global.getComputedStyle(d.tap).display !== 'none'),
      glitching: !!(d && d.stack && d.stack.classList.contains('glitch')),
      glitches: this.glitches,
      word: d && d.word ? d.word.textContent : '',
      fadeMs: FADE_MS
    };
  };

  var title = new Title();
  ESCAPE.Title = title;
  ESCAPE.TITLE_CONST = {
    FADE_MS: FADE_MS,
    GLITCH_MIN: GLITCH_MIN, GLITCH_MAX: GLITCH_MAX,
    GLITCH_DUR_MIN: GLITCH_DUR_MIN, GLITCH_DUR_MAX: GLITCH_DUR_MAX
  };
  global.__titleDebug = {
    get: function () { return title; },
    info: function () { return title.info(); }
  };

  function install() { title.install(ESCAPE.game); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(window);
