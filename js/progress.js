/* ESCAPE — P4: 調べるUI統合・メモ拡大・仕掛け連鎖・チェックポイント/セーブ
 * 契約 DESIGN.md §4「メモ（ヒントシステム）」「操作」／docs/notes.md「エリア1の仕掛け連鎖」。
 *
 * 構成:
 *   NOTE_TEXTS  … docs/notes.md 本文の一字一句そのままの写し（改行位置のみ調整可の範囲で保持）
 *   Progress    … 「調べる」統合ディスパッチ（メモ・仕掛け）／メモ拡大UI／テンキーUI／
 *                 チェックポイント自動保存／localStorage セーブ・ロード／データ全消去
 *
 * 既存システムとの結線:
 *   - js/game.js の stepFrame(): モーダル中は視点・移動を止める→「調べる」は
 *     progress.onInteract() を先に試し、処理しなければ stealth.onInteract() へ。
 *   - js/enemy_ai.js の Stealth.hidden(): モーダル中は捕獲されない（中断安全）。
 *   - js/enemy_ai.js の Stealth.areaReset(): 3回目の牢送りでも仕掛け進行(gimmick)は
 *     保持し、チェックポイントのみ巻き戻す（Progress.onAreaReset）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  /* ================================================================
   * docs/notes.md 正文（一字一句変更禁止）。
   * 対応表（実位置と最も整合する memo 番号。id の連番とは一致しない）:
   *   a1_n1→memo5 / a1_n2→memo2 / a1_n3→memo6 / a1_n4→memo3 / a1_n5→memo1 / a1_n6→memo4
   * ============================================================== */
  var NOTE_TEXTS = {
    a1_n5: {
      title: '夜勤引継ぎのメモ',
      body: '夜勤の点検員へ\n\n' +
        '隔壁が全部降りた。非常電源が落ちている限り、北の隔壁は開かない。\n' +
        '主電源盤は西の区画にある。地図はないが、壁の区画銘板を辿れ。\n\n' +
        '走るな。あれは耳がいいわけじゃない。だが、水と硝子の音は別だ。'
    },
    a1_n2: {
      title: '封鎖作業 申し送り',
      body: '第7次封鎖作業 申し送り（抜粋）\n\n' +
        '・移送対象No.6、依然として区画内を徘徊。直立時の視野は広いが、暗がりでは目が利かない。\n' +
        '・接近された場合はロッカーへ。奴は「見た」ものしか追わない。\n' +
        '・通路の資材板は倒せば時間が稼げる。ただし一度きりだ。\n' +
        '・しゃがんで歩け。立って走った者から順に、いなくなった。'
    },
    a1_n4: {
      title: '巡回員への警告',
      body: 'B-3区画 巡回員へ\n\n' +
        'タンクの中身について質問するな。記録にも残すな。\n' +
        '廊下の赤いビームは旧警備システムの生き残りだ。走って抜けると警報が鳴り、\n' +
        '「回収班」が来る。回収班はもういない。来るのは別のものだ。\n\n' +
        'ゆっくり歩けば、ビームの手前で必ず気づける。'
    },
    a1_n6: {
      title: '最終封鎖手順書 控え',
      body: '最終封鎖手順書 控え\n\n' +
        '主電源投入後、制御室端末より隔壁解錠を実行のこと。\n' +
        '解錠コードは所長の指示により毎月変更 —— 最終月は「2739」。\n\n' +
        '……もう変更する者もいない。この控えを残す。\n' +
        '誰かがここまで辿り着いたなら、どうか急いでくれ。奴は音を覚える。'
    },
    a1_n1: {
      title: '主電源盤 作業注意',
      body: '主電源盤 作業注意\n\n' +
        '主電源盤のレバーは固い。投入時、施設全体に駆動音が響く。\n' +
        '音は必ず「あれ」を呼ぶ。投入したらその場を離れ、物陰で待て。\n\n' +
        '電源が入れば制御室（南東・緑の銘板）の端末が起動する。'
    },
    a1_n3: {
      title: '拘束区画 運用規程',
      body: '拘束区画 運用規程（最終改訂）\n\n' +
        '・回収した対象は必ず施錠房へ。格子の破損は第4房 —— 修理不能。\n' +
        '・房内の対象が暴れても開けるな。三度目の回収後は、上へ報告。\n\n' +
        '余白に手書き:\n' +
        '　「三度目」の後に何が起きたかは、第4房の有様が全てだ。\n' +
        '　俺たちが回収していたのは、俺たちだった。'
    }
  };

  /* UI文言・掲示（docs/notes.md「UI文言」「掲示」の該当箇所を一字一句そのまま使用） */
  var UI_TEXT = {
    note: 'メモを読む',
    lever: 'レバーを投入する',
    terminal: '端末を操作する',
    handle: 'ハンドルを回す（長押し）'
  };
  var PLACARD = {
    noPower: 'NO POWER',
    codePrompt: '隔壁解錠コードを入力してください',
    bulkhead: '非常隔壁 手動開放は解錠後のみ可 / 開放中は大音響に注意'
  };
  var DOOR_CODE = '2739';

  var NOTE_RANGE = 2.4;
  var GIMMICK_RANGE = 2.6;
  var LEVER_NOISE_RADIUS = 44;      /* 契約: 仕掛け1は「大半径」。施設全体に響く駆動音 */
  var HANDLE_HOLD_SECONDS = 3.0;    /* docs/notes.md: 長押し3秒 */
  var HANDLE_HOLD_DECAY = 1.0;      /* 手を離すと1秒で0へ戻る */
  var HANDLE_NOISE_INTERVAL = 0.40; /* 回している間、音が鳴り続ける（周期発火） */
  var FLASH_DUR = 1.6;              /* 「未通電」等の応答表示の持続(s) */
  var KEYPAD_ERR_DUR = 0.6;         /* 誤入力表示の持続(s) */

  var SAVE_KEY = 'escape.save.area1.v1';

  /** 音響フックの共通口（P4.5）。音響モジュールが無くても落ちない */
  function sfx(name, p) {
    if (ESCAPE.audio && ESCAPE.audio.event) ESCAPE.audio.event(name, p);
  }

  function bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    el.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
  }

  /* ================================================================
   * Progress
   * ============================================================== */
  function Progress(game) {
    this.game = game;
    this.dom = {
      prompt: document.getElementById('prompt'),
      memoOverlay: document.getElementById('memo-overlay'),
      memoTitle: document.getElementById('memo-title'),
      memoBody: document.getElementById('memo-body'),
      keypadOverlay: document.getElementById('keypad-overlay'),
      keypadDisplay: document.getElementById('keypad-display'),
      kpCells: Array.prototype.slice.call(document.querySelectorAll('#keypad-display .kd')),
      endingOverlay: document.getElementById('ending-overlay'),
      eraseBtn: document.getElementById('btn-erase')
    };
    this.reset();
    this._bind();
  }

  Progress.prototype.reset = function () {
    this.flags = {};                         /* 汎用フラグ（既存テスト互換のため維持） */
    this.notesRead = Object.create(null);    /* {noteId: true} */
    this.gimmick = { power: false, code: false, doorOpen: false, handleHold: 0 };
    this.cleared = false;
    this.checkpoint = null;
    this.modal = null;                       /* null | 'memo' | 'keypad' | 'ending' */
    this.memoId = null;
    this.keypadDigits = '';
    this.keypadErr = false;
    this._flashMsg = ''; this._flashT = 0;
    this._kpErrT = 0;
    this._handleNoiseT = 0;
    this._rebuildLookups();
    this._syncModalDom();
    if (this.dom.keypadDisplay) { this.dom.keypadDisplay.classList.remove('err'); }
    this.dom._kpErrOn = false;
    for (var i = 0; i < this.dom.kpCells.length; i++) this.dom.kpCells[i].textContent = '';
    this.dom._promptText = undefined;
  };

  Progress.prototype._rebuildLookups = function () {
    var map = this.game.map, meta = (map && map.meta) || {};
    this._noteAt = Object.create(null);
    var notes = meta.notes || [];
    for (var i = 0; i < notes.length; i++) this._noteAt[notes[i].col + ',' + notes[i].row] = notes[i];
    this._gimmickAt = Object.create(null);
    var gm = meta.gimmicks || [];
    for (var j = 0; j < gm.length; j++) this._gimmickAt[gm[j].col + ',' + gm[j].row] = gm[j];
    this._checkpointAt = Object.create(null);
    var cps = meta.checkpoints || [];
    for (var k = 0; k < cps.length; k++) this._checkpointAt[cps[k].col + ',' + cps[k].row] = cps[k];
  };

  Progress.prototype.modalOpen = function () { return !!this.modal; };

  /* ---------------- 対象の検出（メモ・仕掛け。ロッカー/板は Stealth の領分） ---------------- */
  Progress.prototype._findTarget = function () {
    var g = this.game, p = g.player, map = g.map, TILE = ESCAPE.TILE;
    var T = ESCAPE.ENEMY_TUNING;
    var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    var best = null, bestD = Infinity;
    var col = p.col(), row = p.row();
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var c = col + dc, r = row + dr;
        if (!map.inBounds(c, r)) continue;
        var tile = map.tileAt(c, r);
        var kind = null, entry = null;
        if (tile === TILE.NOTE) { entry = this._noteAt[c + ',' + r]; if (entry) kind = 'note'; }
        else if (tile === TILE.GIMMICK) { entry = this._gimmickAt[c + ',' + r]; if (entry) kind = 'gimmick'; }
        if (!kind) continue;
        if (kind === 'gimmick' && this._gimmickDone(entry)) continue;
        var cc = map.cellCenter(c, r);
        var dx = cc.x - p.x, dz = cc.z - p.z;
        var d = Math.hypot(dx, dz);
        var range = (kind === 'note') ? NOTE_RANGE : GIMMICK_RANGE;
        if (d > range) continue;
        if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
        if (d < bestD) { bestD = d; best = { kind: kind, col: c, row: r, entry: entry }; }
      }
    }
    return best;
  };

  Progress.prototype._gimmickDone = function (entry) {
    if (entry.role === 'lever') return this.gimmick.power;
    if (entry.role === 'terminal') return this.gimmick.code;
    if (entry.role === 'handle') return this.gimmick.doorOpen;
    return false;
  };

  /* ---------------- 「調べる」（stepFrame から呼ばれる。処理したら true） ---------------- */
  Progress.prototype.onInteract = function () {
    if (this.modal === 'memo') { this._closeModal(); return true; }
    if (this.modal === 'keypad') { this._closeModal(); return true; }
    if (this.modal === 'ending') return true;

    var t = this._findTarget();
    if (!t) return false;

    if (t.kind === 'note') { this._openMemo(t.entry.id); return true; }

    var role = t.entry.role;
    if (role === 'lever') {
      if (!this.gimmick.power) {
        this.gimmick.power = true;
        var c1 = this.game.map.cellCenter(t.col, t.row);
        ESCAPE.noise.emit(c1.x, c1.z, LEVER_NOISE_RADIUS, 'lever');
        /* 契約 §4「レバー投入の重い駆動音が施設全体に響く」 */
        sfx('lever', { x: c1.x, z: c1.z });
        this.save();
      }
      return true;
    }
    if (role === 'terminal') {
      if (!this.gimmick.power) { this._flash(PLACARD.noPower); return true; }
      if (!this.gimmick.code) { this._openKeypad(); return true; }
      return true;
    }
    if (role === 'handle') {
      /* 開放は長押し（step() 側で isInteractHeld() を見て進める）。単発タップは応答のみ */
      if (!this.gimmick.code) { this._flash(PLACARD.bulkhead); return true; }
      return true;
    }
    return true;
  };

  /* ---------------- 毎フレーム ---------------- */
  Progress.prototype.step = function (dt) {
    if (this._flashT > 0) { this._flashT -= dt; if (this._flashT < 0) this._flashT = 0; }
    if (this._kpErrT > 0) {
      this._kpErrT -= dt;
      if (this._kpErrT <= 0) { this._kpErrT = 0; this.keypadDigits = ''; this.keypadErr = false; }
    }
    this._updateHandleHold(dt);
    this._checkCheckpoint();
    this._checkClear();
    this._updatePrompt();
    this._syncKeypadDigits();
  };

  Progress.prototype._updateHandleHold = function (dt) {
    var g = this.game, input = g.input;
    /* 中断安全（契約 §6）: モーダル中／捕獲演出・牢送り中はハンドルが回らない。
       P4.6 で演出が7〜9秒に伸び、「掴まれている間もハンドルが回り続けて隔壁が開く」
       という上書き事故が起きたための明示ガード（同類＝演出中に進む仕掛けを全て止める）。 */
    var busy = !!this.modal || !!(g.stealth && g.stealth.jail && g.stealth.jail.phase !== 'none');
    var t = !busy ? this._findTarget() : null;
    var onHandle = !!(t && t.kind === 'gimmick' && t.entry.role === 'handle');
    var active = onHandle && this.gimmick.code && !this.gimmick.doorOpen &&
      input && input.isInteractHeld && input.isInteractHeld();
    if (active) {
      this.gimmick.handleHold = Math.min(1, this.gimmick.handleHold + dt / HANDLE_HOLD_SECONDS);
      this._handleNoiseT -= dt;
      if (this._handleNoiseT <= 0) {
        var c = g.map.cellCenter(t.col, t.row);
        ESCAPE.noise.emit(c.x, c.z, ESCAPE.ENEMY_TUNING.gimmickNoiseRadius, 'handle');
        /* 契約 §4「隔壁ハンドルの軋み」。回している間だけ周期発火する */
        sfx('handleCreak', { x: c.x, z: c.z });
        this._handleNoiseT = HANDLE_NOISE_INTERVAL;
      }
      if (this.gimmick.handleHold >= 1) {
        this.gimmick.handleHold = 1;
        this.gimmick.doorOpen = true;
        var co = g.map.cellCenter(t.col, t.row);
        /* 契約 §4「開放の轟音」 */
        sfx('doorRoar', { x: co.x, z: co.z });
        this.save();
      }
    } else {
      this.gimmick.handleHold = Math.max(0, this.gimmick.handleHold - dt / HANDLE_HOLD_DECAY);
      this._handleNoiseT = 0;
    }
  };

  Progress.prototype._checkCheckpoint = function () {
    var g = this.game, TILE = ESCAPE.TILE;
    if (g.map.tileAt(g.player.col(), g.player.row()) !== TILE.CHECKPOINT) return;
    var entry = this._checkpointAt[g.player.col() + ',' + g.player.row()];
    if (!entry || entry.id === this.checkpoint) return;
    this.checkpoint = entry.id;
    sfx('checkpoint', {});
    this.save();
  };

  Progress.prototype._checkClear = function () {
    if (this.cleared || !this.gimmick.doorOpen) return;
    var g = this.game, ep = g.map.meta.exitPad;
    if (!ep) return;
    if (g.player.col() !== ep.col || g.player.row() !== ep.row) return;
    this.cleared = true;
    this._openEnding();
    this.save();
  };

  Progress.prototype._updatePrompt = function () {
    var s = '';
    if (this._flashT > 0) {
      s = this._flashMsg || '';
    } else if (!this.modal) {
      var t = this._findTarget();
      if (t) {
        if (t.kind === 'note') {
          s = UI_TEXT.note;
        } else {
          var role = t.entry.role;
          if (role === 'lever') s = UI_TEXT.lever;
          else if (role === 'terminal') s = this.gimmick.power ? UI_TEXT.terminal : PLACARD.noPower;
          else if (role === 'handle') {
            s = this.gimmick.code ?
              (UI_TEXT.handle + '  ' + Math.round(this.gimmick.handleHold * 100) + '%') :
              PLACARD.bulkhead;
          }
        }
      }
    }
    if (!s) return; /* 何も無ければ Stealth が書いた値をそのまま残す */
    var el = this.dom.prompt;
    if (el && this.dom._promptText !== s) { el.textContent = s; this.dom._promptText = s; }
    else if (el) { this.dom._promptText = s; }
  };

  /* ---------------- モーダル: メモ ---------------- */
  Progress.prototype._openMemo = function (id) {
    var txt = NOTE_TEXTS[id];
    if (!txt) return;
    this.notesRead[id] = true;
    this.modal = 'memo';
    this.memoId = id;
    if (this.dom.memoTitle) this.dom.memoTitle.textContent = txt.title;
    if (this.dom.memoBody) this.dom.memoBody.textContent = txt.body;
    sfx('noteOpen', {});
    this._syncModalDom();
  };

  /* ---------------- モーダル: テンキー ---------------- */
  Progress.prototype._openKeypad = function () {
    this.modal = 'keypad';
    this.keypadDigits = '';
    this.keypadErr = false;
    this._kpErrT = 0;
    this._syncModalDom();
  };

  Progress.prototype._kpPress = function (k) {
    if (this.modal !== 'keypad') return;
    if (k === 'clear') { this.keypadDigits = ''; this.keypadErr = false; this._kpErrT = 0; return; }
    if (k === 'back') { this.keypadDigits = this.keypadDigits.slice(0, -1); this.keypadErr = false; this._kpErrT = 0; return; }
    if (this._kpErrT > 0) return;               /* 誤入力表示中は入力を受け付けない */
    if (this.keypadDigits.length >= 4) return;
    this.keypadDigits += k;
    sfx('terminalKey', {});
    if (this.keypadDigits.length === 4) this._submitCode();
  };

  Progress.prototype._submitCode = function () {
    if (this.keypadDigits === DOOR_CODE) {
      this.gimmick.code = true;
      this.keypadErr = false;
      this._closeModal();
      sfx('terminalOk', {});
      this.save();
    } else {
      this.keypadErr = true;
      this._kpErrT = KEYPAD_ERR_DUR;
      sfx('terminalErr', {});
    }
  };

  Progress.prototype._syncKeypadDigits = function () {
    if (!this.dom.kpCells.length) return;
    var s = (this.modal === 'keypad') ? this.keypadDigits : '';
    for (var i = 0; i < 4; i++) {
      var v = s.charAt(i) || '';
      if (this.dom.kpCells[i].textContent !== v) this.dom.kpCells[i].textContent = v;
    }
    var errOn = (this.modal === 'keypad') && !!this.keypadErr;
    if (this.dom._kpErrOn !== errOn) {
      this.dom.keypadDisplay.classList.toggle('err', errOn);
      this.dom._kpErrOn = errOn;
    }
  };

  /* ---------------- モーダル: クリア ---------------- */
  Progress.prototype._openEnding = function () {
    this.modal = 'ending';
    this._syncModalDom();
  };

  Progress.prototype._closeModal = function () {
    if (this.modal === 'ending') return; /* クリア画面は自然には閉じない */
    if (this.modal === 'memo') sfx('noteClose', {});
    this.modal = null;
    this._syncModalDom();
  };
  /** タップ/E/Esc いずれからも同じ経路で閉じる */
  Progress.prototype.onCloseTap = function () {
    if (this.modal === 'memo' || this.modal === 'keypad') this._closeModal();
  };

  Progress.prototype._syncModalDom = function () {
    var d = this.dom;
    if (d.memoOverlay) d.memoOverlay.classList.toggle('show', this.modal === 'memo');
    if (d.keypadOverlay) d.keypadOverlay.classList.toggle('show', this.modal === 'keypad');
    if (d.endingOverlay) d.endingOverlay.classList.toggle('show', this.modal === 'ending');
  };

  Progress.prototype._flash = function (msg) {
    this._flashMsg = msg;
    this._flashT = FLASH_DUR;
  };

  /* ---------------- 牢送り3回目のエリアリセットとの整合 ---------------- */
  /** 仕掛け進行(power/code/doorOpen)は保持し、位置とチェックポイントのみ巻き戻す */
  Progress.prototype.onAreaReset = function () {
    this.checkpoint = null;
    this.modal = null;
    this._syncModalDom();
    this.save();
  };

  /* ---------------- セーブ / ロード / データ全消去 ---------------- */
  Progress.prototype.save = function () {
    try {
      var data = {
        v: 1, mapId: this.game.mapId,
        checkpoint: this.checkpoint,
        gimmick: { power: this.gimmick.power, code: this.gimmick.code, doorOpen: this.gimmick.doorOpen },
        cleared: this.cleared
      };
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* privateモード等で保存できない環境は無視する */ }
  };

  /** 起動時1回だけ呼ぶ。セーブがあればチェックポイント位置・仕掛け進行を復元する */
  Progress.prototype.load = function () {
    var data = null;
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || data.mapId !== this.game.mapId) return false;
    if (data.gimmick) {
      this.gimmick.power = !!data.gimmick.power;
      this.gimmick.code = !!data.gimmick.code;
      this.gimmick.doorOpen = !!data.gimmick.doorOpen;
    }
    this.cleared = !!data.cleared;
    if (data.checkpoint) {
      this.checkpoint = data.checkpoint;
      this._placeAtCheckpoint(data.checkpoint);
    }
    return true;
  };

  Progress.prototype._placeAtCheckpoint = function (id) {
    var list = (this.game.map.meta && this.game.map.meta.checkpoints) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        var c = this.game.map.cellCenter(list[i].col, list[i].row);
        var p = this.game.player;
        p.x = c.x; p.z = c.z; p.y = this.game.map.floorYAt(p.x, p.z);
        return true;
      }
    }
    return false;
  };

  /** 契約 §2「永続フラグには必ずリセット経路」。暫定UI（設定/タイトル前）から呼ぶ */
  Progress.prototype.eraseAllData = function () {
    try { global.localStorage.removeItem(SAVE_KEY); } catch (e) { /* 無視 */ }
    /* P4.5: 音量設定も永続化しているので同じ経路で消す */
    if (ESCAPE.audio && ESCAPE.audio.eraseSettings) ESCAPE.audio.eraseSettings();
    this.game.reset();
  };

  /* ---------------- DOM結線（コンストラクタから1回だけ） ---------------- */
  Progress.prototype._bind = function () {
    var self = this;
    bindTap(this.dom.memoOverlay, function () { self.onCloseTap(); });

    var keys = document.querySelectorAll('#keypad-grid .kp-key');
    for (var i = 0; i < keys.length; i++) {
      (function (btn) {
        bindTap(btn, function () { self._kpPress(btn.getAttribute('data-k')); });
      })(keys[i]);
    }

    if (this.dom.eraseBtn) {
      bindTap(this.dom.eraseBtn, function () {
        var ok = true;
        try { ok = global.confirm('セーブデータを全て消去します。よろしいですか？'); } catch (e) { ok = true; }
        if (ok) self.eraseAllData();
      });
    }

    global.addEventListener('keydown', function (e) {
      var code = e.code;
      if (!code) return;
      if (code === 'Escape') { self.onCloseTap(); return; }
      if (self.modal === 'keypad') {
        var m = /^Digit([0-9])$/.exec(code);
        if (m) { self._kpPress(m[1]); return; }
        if (code === 'Backspace') self._kpPress('back');
      }
    });
  };

  ESCAPE.Progress = Progress;
  ESCAPE.PROGRESS_NOTE_TEXTS = NOTE_TEXTS;
  ESCAPE.PROGRESS_UI_TEXT = UI_TEXT;
  ESCAPE.PROGRESS_PLACARD = PLACARD;
  ESCAPE.PROGRESS_DOOR_CODE = DOOR_CODE;

  /* 検証フック（機械テスト・E2E用）。ESCAPE.game.progress への遅延参照のみで、
     このスクリプト自身はDOM構築を待たない（Progressの生成はgame.jsのinit()が行う）。 */
  global.__progressDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.progress; },
    info: function () {
      var pr = ESCAPE.game && ESCAPE.game.progress;
      if (!pr) return null;
      return {
        modal: pr.modal, gimmick: { power: pr.gimmick.power, code: pr.gimmick.code, doorOpen: pr.gimmick.doorOpen, handleHold: pr.gimmick.handleHold },
        checkpoint: pr.checkpoint, cleared: pr.cleared,
        notesRead: Object.keys(pr.notesRead), keypadDigits: pr.keypadDigits, keypadErr: pr.keypadErr
      };
    }
  };
})(window);
