/* ESCAPE — 入力（スマホ: 仮想スティック＋スワイプ視点＋ボタン3つ / PC: WASD＋マウス）
 * 契約 DESIGN.md §4:
 *   スマホ = 左半分スティック（タッチ位置起点のフローティング式）／右半分スワイプ視点／
 *            ボタン3つ（走る=押下中・しゃがむ=トグル・調べる）
 *   PC     = WASD＋Shift走り＋Ctrlしゃがみ＋E調べる＋ポインタロック視点。キー判定は e.code 方式で統一。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var STICK_RADIUS = 64;   // CSS px。この距離で入力最大
  var STICK_DEAD = 0.14;   // デッドゾーン（正規化後）
  var LOOK_SENS = 0.0032;  // rad / px（タッチ）
  var MOUSE_SENS = 0.0022; // rad / px（マウス）

  function Input(opts) {
    this.dom = opts.dom;              // { root, stickBase, stickKnob, btnRun, btnCrouch, btnInteract }
    this.canvas = opts.canvas;

    // 出力される入力状態
    this.moveX = 0;      // -1..1 右
    this.moveY = 0;      // -1..1 前
    this.runHeld = false;
    this.crouchOn = false;
    this.lookDX = 0;     // 未消費の視点デルタ(px)
    this.lookDY = 0;
    this.interactQueued = 0;

    // 内部状態
    this._keys = Object.create(null);
    this._keyRun = false;
    this._touchStickId = null;
    this._stickOrigin = { x: 0, y: 0 };
    this._touchLookId = null;
    this._lookLast = { x: 0, y: 0 };
    this._btnRunTouchId = null;
    this._mouseDragging = false;
    this.pointerLocked = false;
    this.touchSeen = false;

    this._bind();
  }

  Input.prototype.isTouchActive = function () {
    return this._touchStickId !== null || this._touchLookId !== null;
  };

  /** 視点デルタを取り出して0に戻す */
  Input.prototype.consumeLook = function () {
    var d = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return d;
  };

  /** 「調べる」押下回数を取り出して0に戻す */
  Input.prototype.consumeInteract = function () {
    var n = this.interactQueued;
    this.interactQueued = 0;
    return n;
  };

  /** 走り入力（キー or ボタン） */
  Input.prototype.isRunning = function () {
    return this._keyRun || this._btnRunTouchId !== null || this._btnRunMouse === true;
  };

  /** 全入力を初期状態へ（runAll後の完全復帰・フォーカス喪失時に使用） */
  Input.prototype.reset = function () {
    this.moveX = 0; this.moveY = 0;
    this.runHeld = false;
    this.crouchOn = false;
    this.lookDX = 0; this.lookDY = 0;
    this.interactQueued = 0;
    this._keys = Object.create(null);
    this._keyRun = false;
    this._touchStickId = null;
    this._touchLookId = null;
    this._btnRunTouchId = null;
    this._btnRunMouse = false;
    this._mouseDragging = false;
    this._updateStickVisual(false, 0, 0);
    this._syncButtonVisual();
  };

  /* ------------------------- キーボード ------------------------- */

  Input.prototype._onKeyDown = function (e) {
    var code = e.code;
    if (!code) return;
    this._keys[code] = true;
    if (code === 'ShiftLeft' || code === 'ShiftRight') this._keyRun = true;
    if ((code === 'ControlLeft' || code === 'ControlRight') && !e.repeat) {
      this.crouchOn = !this.crouchOn;
      this._syncButtonVisual();
    }
    if (code === 'KeyE' && !e.repeat) this.interactQueued++;
    if (code === 'Tab' || code === 'Space') e.preventDefault();
    this._recomputeKeyMove();
  };

  Input.prototype._onKeyUp = function (e) {
    var code = e.code;
    if (!code) return;
    this._keys[code] = false;
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      this._keyRun = !!(this._keys.ShiftLeft || this._keys.ShiftRight);
    }
    this._recomputeKeyMove();
  };

  Input.prototype._recomputeKeyMove = function () {
    // タッチスティックが握られている間はキー入力で上書きしない
    if (this._touchStickId !== null) return;
    var k = this._keys;
    var x = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    var y = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    var len = Math.hypot(x, y);
    if (len > 1e-6) { x /= len; y /= len; }
    this.moveX = x; this.moveY = y;
  };

  /* --------------------------- マウス --------------------------- */

  Input.prototype._onPointerLockChange = function () {
    this.pointerLocked = (document.pointerLockElement === this.canvas);
  };

  /* ポインタロック要求。新しいChromeは Promise を返すので同期throwと
   * Promise reject の両方を握り潰す（iframe・ヘッドレス等では必ず失敗するため）。
   * 失敗してもマウスドラッグ視点で操作できる。 */
  Input.prototype.requestPointerLock = function () {
    var el = this.canvas;
    if (!el || typeof el.requestPointerLock !== 'function') return false;
    try {
      var p = el.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(function () { /* 未許可環境は無視 */ });
    } catch (err) {
      return false;
    }
    return true;
  };

  Input.prototype._onMouseMove = function (e) {
    if (this.pointerLocked) {
      this.lookDX += (e.movementX || 0) * (MOUSE_SENS / LOOK_SENS);
      this.lookDY += (e.movementY || 0) * (MOUSE_SENS / LOOK_SENS);
    } else if (this._mouseDragging) {
      this.lookDX += (e.movementX || (e.clientX - this._lookLast.x)) * (MOUSE_SENS / LOOK_SENS);
      this.lookDY += (e.movementY || (e.clientY - this._lookLast.y)) * (MOUSE_SENS / LOOK_SENS);
      this._lookLast.x = e.clientX; this._lookLast.y = e.clientY;
    }
  };

  /* ---------------------------- タッチ --------------------------- */

  function isControlButton(el) {
    while (el && el !== document) {
      if (el.classList && el.classList.contains('ctrl-btn')) return true;
      el = el.parentNode;
    }
    return false;
  }

  Input.prototype._onTouchStart = function (e) {
    if (!isControlButton(e.target)) e.preventDefault();
    this.touchSeen = true;
    var half = (global.innerWidth || 1) * 0.5;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (isControlButton(t.target)) continue;            // ボタンは各自で処理
      if (t.clientX < half) {
        if (this._touchStickId === null) {
          this._touchStickId = t.identifier;
          this._stickOrigin.x = t.clientX;
          this._stickOrigin.y = t.clientY;
          this._updateStickVisual(true, 0, 0);
        }
      } else {
        if (this._touchLookId === null) {
          this._touchLookId = t.identifier;
          this._lookLast.x = t.clientX;
          this._lookLast.y = t.clientY;
        }
      }
    }
  };

  Input.prototype._onTouchMove = function (e) {
    if (!isControlButton(e.target)) e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === this._touchStickId) {
        var dx = t.clientX - this._stickOrigin.x;
        var dy = t.clientY - this._stickOrigin.y;
        var nx = dx / STICK_RADIUS, ny = -dy / STICK_RADIUS;
        var len = Math.hypot(nx, ny);
        if (len > 1) { nx /= len; ny /= len; len = 1; }
        if (len < STICK_DEAD) { nx = 0; ny = 0; }
        this.moveX = nx; this.moveY = ny;
        this._updateStickVisual(true, nx * STICK_RADIUS, -ny * STICK_RADIUS);
      } else if (t.identifier === this._touchLookId) {
        this.lookDX += (t.clientX - this._lookLast.x);
        this.lookDY += (t.clientY - this._lookLast.y);
        this._lookLast.x = t.clientX;
        this._lookLast.y = t.clientY;
      }
    }
  };

  Input.prototype._onTouchEnd = function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === this._touchStickId) {
        this._touchStickId = null;
        this.moveX = 0; this.moveY = 0;
        this._updateStickVisual(false, 0, 0);
        this._recomputeKeyMove();
      } else if (t.identifier === this._touchLookId) {
        this._touchLookId = null;
      } else if (t.identifier === this._btnRunTouchId) {
        this._btnRunTouchId = null;
        this._syncButtonVisual();
      }
    }
  };

  Input.prototype._updateStickVisual = function (visible, px, py) {
    var base = this.dom.stickBase, knob = this.dom.stickKnob;
    if (!base || !knob) return;
    if (visible) {
      base.style.display = 'block';
      base.style.left = this._stickOrigin.x + 'px';
      base.style.top = this._stickOrigin.y + 'px';
      knob.style.transform = 'translate(-50%,-50%) translate(' + px + 'px,' + py + 'px)';
    } else {
      base.style.display = 'none';
      knob.style.transform = 'translate(-50%,-50%)';
    }
  };

  Input.prototype._syncButtonVisual = function () {
    if (this.dom.btnCrouch) this.dom.btnCrouch.classList.toggle('on', !!this.crouchOn);
    if (this.dom.btnRun) this.dom.btnRun.classList.toggle('on', this.isRunning());
  };

  /* ---------------------------- 束ね ---------------------------- */

  Input.prototype._bind = function () {
    var self = this;
    var d = this.dom;

    // キーボード（window に1回だけ）
    this._hKeyDown = function (e) { self._onKeyDown(e); };
    this._hKeyUp = function (e) { self._onKeyUp(e); };
    global.addEventListener('keydown', this._hKeyDown);
    global.addEventListener('keyup', this._hKeyUp);
    global.addEventListener('blur', function () { self.reset(); });

    // マウス（ポインタロック＋ドラッグ視点フォールバック）
    document.addEventListener('pointerlockchange', function () { self._onPointerLockChange(); });
    document.addEventListener('mousemove', function (e) { self._onMouseMove(e); });
    this.canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      self._mouseDragging = true;
      self._lookLast.x = e.clientX; self._lookLast.y = e.clientY;
      self.requestPointerLock();
    });
    document.addEventListener('mouseup', function () { self._mouseDragging = false; });

    // タッチ（document に1回だけ。二重dispatch防止のため window には付けない）
    document.addEventListener('touchstart', function (e) { self._onTouchStart(e); }, { passive: false });
    document.addEventListener('touchmove', function (e) { self._onTouchMove(e); }, { passive: false });
    document.addEventListener('touchend', function (e) { self._onTouchEnd(e); }, { passive: false });
    document.addEventListener('touchcancel', function (e) { self._onTouchEnd(e); }, { passive: false });

    // ボタン3つ
    function bindHold(el, onDown, onUp) {
      if (!el) return;
      el.addEventListener('touchstart', function (e) {
        e.preventDefault(); e.stopPropagation();
        self.touchSeen = true;
        self._btnRunTouchId = e.changedTouches[0].identifier;
        onDown();
      }, { passive: false });
      el.addEventListener('touchend', function (e) {
        e.preventDefault(); e.stopPropagation();
        self._btnRunTouchId = null;
        onUp();
      }, { passive: false });
      el.addEventListener('touchcancel', function () { self._btnRunTouchId = null; onUp(); });
      el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); onDown(); });
      document.addEventListener('mouseup', function () { onUp(); });
    }

    bindHold(d.btnRun,
      function () { self._btnRunMouse = true; self._syncButtonVisual(); },
      function () { self._btnRunMouse = false; self._btnRunTouchId = null; self._syncButtonVisual(); });

    function bindTap(el, fn) {
      if (!el) return;
      el.addEventListener('touchstart', function (e) {
        e.preventDefault(); e.stopPropagation(); self.touchSeen = true; fn();
      }, { passive: false });
      el.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
      el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
    }

    bindTap(d.btnCrouch, function () { self.crouchOn = !self.crouchOn; self._syncButtonVisual(); });
    bindTap(d.btnInteract, function () { self.interactQueued++; });
  };

  Input.STICK_RADIUS = STICK_RADIUS;
  Input.LOOK_SENS = LOOK_SENS;
  ESCAPE.Input = Input;
})(window);
