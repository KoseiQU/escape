/* ESCAPE — P4/P4.7: 調べるUI統合・メモ拡大・脱出フローv2（7工程）・所持品・チェックポイント/セーブ
 * 契約 DESIGN.md §4「エリア1 脱出フロー v2」「メモ（ヒントシステム）」「操作」
 *      docs/notes.md「エリア1 脱出フロー v2」（メモ本文・掲示・端末表示・UI文言・所持品表示の正文）
 *
 * 工程（DESIGN.md §4 v2）:
 *   1 主電源盤のレバー … ヒューズ欠落で空回り
 *   2 保管庫 … ヒューズとスパナを回収（床一面がガラス片＝音地盤）
 *   3 配電パズル … 3系統ブレーカーを掲示の順（循環→照明→隔壁）に投入
 *   4 処置室 … 遺体の胸ポケットからカードキー（取得で無影灯が落ちる演出）→ 制御室が開く
 *   5 制御室端末 … コード2739 →「排気圧異常」
 *   6 循環ポンプ室 … 3バルブで圧力計を緑域へ → 排水路の水が抜ける
 *   7a 隔壁ハンドル … 長押し3秒 → 12秒かけて開く（最大半径の音イベントで敵が疾走）
 *   7b 排水路 … グレーチング（スパナ＋排水済み）→ しゃがみ専用の狭い通路 → 隔壁の向こう側
 *
 * 既存システムとの結線:
 *   - js/game.js の stepFrame(): モーダル中は視点・移動を止める→「調べる」は
 *     progress.onInteract() を先に試し、処理しなければ stealth.onInteract() へ。
 *     排水路の中では crouchLock()/runLocked() で走行と立ち上がりを禁じる。
 *   - js/enemy_ai.js の Stealth.hidden(): モーダル中は捕獲されない（中断安全）。
 *   - js/enemy_ai.js の Stealth.areaReset(): 牢送りでも所持品・工程は保持し、
 *     チェックポイントのみ巻き戻す（Progress.onAreaReset）。
 *   - 施錠（制御室の扉2枚・排水路のグレーチング）は map.setBlocked による runtime の封鎖。
 *     Stealth._blockBarredCells() が clearBlocked() するため、毎フレーム貼り直す（_applyGates）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* ================================================================
   * docs/notes.md 正文（一字一句変更禁止）。
   * 対応表（実位置と最も整合する memo 番号。id の連番とは一致しない）:
   *   a1_n1→memo5 / a1_n2→memo2 / a1_n3→memo6 / a1_n4→memo3 / a1_n5→memo1 / a1_n6→memo4
   *   a1_n7→memo7（保管庫） / a1_n8→memo8（処置室） / a1_n9→memo9（循環ポンプ室）
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
    /* P4.7 改訂: docs/notes.md memo5（v2 で保管庫・ブレーカー順・カードキーに言及する版が正） */
    a1_n1: {
      title: '主電源盤 作業注意',
      body: '主電源盤 作業注意\n\n' +
        'ヒューズは封鎖時に抜いてある。予備は北西の保管庫。\n' +
        'ブレーカーは盤の上の掲示の順に入れろ。順を間違えると火花が飛ぶ。\n' +
        '投入時、施設全体に駆動音が響く。音は必ず「あれ」を呼ぶ。\n' +
        '入れたらその場を離れ、物陰で待て。\n\n' +
        '電源が入れば制御室（南東・緑の銘板）の端末が起動する。\n' +
        '制御室の扉はカードキーがないと開かない。'
    },
    a1_n3: {
      title: '拘束区画 運用規程',
      body: '拘束区画 運用規程（最終改訂）\n\n' +
        '・回収した対象は必ず施錠房へ。格子の破損は第4房 —— 修理不能。\n' +
        '・房内の対象が暴れても開けるな。三度目の回収後は、上へ報告。\n\n' +
        '余白に手書き:\n' +
        '　「三度目」の後に何が起きたかは、第4房の有様が全てだ。\n' +
        '　俺たちが回収していたのは、俺たちだった。'
    },
    a1_n7: {
      title: '保管庫 入庫記録',
      body: '保管庫 入庫記録（最終）\n\n' +
        '・予備ヒューズ 30A ×1 …… 棚B-2\n' +
        '・工具 スパナ（配管用）×1 …… 棚B-3\n' +
        '・割れた検体瓶 多数 …… 床（片付ける者なし）\n\n' +
        '注意: 床の硝子を踏むな。音で来る。'
    },
    a1_n8: {
      title: '処置記録 No.7',
      body: '処置記録 No.7\n\n' +
        '被験者は処置台上で心停止。制御室のカードキーは\n' +
        '胸ポケットに入れたまま —— 誰も取りに行こうとしなかった。\n\n' +
        '無影灯の回路は主電源に直結。灯が落ちたら、\n' +
        'それは電源の問題ではない。'
    },
    a1_n9: {
      title: '排気系 保守メモ',
      body: '排気系 保守メモ\n\n' +
        '隔壁の解錠は排気圧が緑域にないと弾かれる。\n' +
        'バルブは3つ。圧力計を見ながら、赤に振れたら戻せ。\n\n' +
        '排水路のグレーチングはボルト止め。スパナがあれば外せる。\n' +
        '水が抜けていれば、隔壁の向こうまで這って行ける。\n' +
        '　　　　　　　　　　　　—— 走るな。狭い。'
    }
  };

  /* UI文言（docs/notes.md「UI文言（調べる系）」「UI文言（v2追加）」の正文をそのまま使用） */
  var UI_TEXT = {
    note: 'メモを読む',
    lever: 'レバーを投入する',
    leverPull: 'レバーを引く',
    fuseSet: 'ヒューズを装着する',
    fuseTake: 'ヒューズを取る',
    wrenchTake: 'スパナを取る',
    breaker1: 'ブレーカー①を入れる',
    breaker2: 'ブレーカー②を入れる',
    breaker3: 'ブレーカー③を入れる',
    corpse: '胸ポケットを探る',
    doorOpenTry: '扉を開ける',
    valve: 'バルブを回す',
    grating: 'グレーチングを外す（スパナ）',
    crawl: '狭い —— しゃがんで進め',
    terminal: '端末を操作する',
    handle: 'ハンドルを回す（長押し）'
  };
  /* 掲示・応答（同じく docs/notes.md の正文） */
  var PLACARD = {
    noPower: 'NO POWER',
    codePrompt: '隔壁解錠コードを入力してください',
    bulkhead: '非常隔壁 手動開放は解錠後のみ可 / 開放中は大音響に注意',
    leverIdle: '空回りする —— ヒューズがない',
    sparks: '火花が散った',
    locked: '施錠されている —— カードキーが要る',
    pressureBad: '排気圧異常　循環ポンプ室で調整してください',
    unlocked: '隔壁解錠完了　手動開放ハンドルを操作してください',
    gauge: '排気圧',
    opening: '隔壁開放中　残り{SEC}秒'
  };
  /* 壁の掲示（docs/notes.md「掲示・銘板」の正文）。meta.signs の id と対応 */
  var SIGN_TEXT = {
    sg_breaker: '投入順序　① 循環　② 照明　③ 隔壁',
    sg_store: '保管庫　硝子片散乱　走行厳禁',
    sg_control: '制御室　カードキー専用',
    sg_control2: '制御室　カードキー専用',
    sg_control3: '制御室　カードキー専用',
    sg_bulkhead: '開放中は退避不可　開放後12秒で再閉鎖',
    sg_drain: '排水路　立入禁止'
  };
  /* 所持品表示（docs/notes.md「所持品表示」の正文） */
  var ITEM_TEXT = { fuse: 'ヒューズ', wrench: 'スパナ', card: 'カードキー' };
  /* 正文に無い最小限の応答（掲示・UI文言の一覧に該当項目が無いものだけ） */
  var EXTRA_TEXT = {
    drainFlooded: '水が満ちている —— 先に排水しろ',
    needWrench: 'ボルトが固い —— 工具が要る',
    cardUsed: 'カードキーで解錠した'
  };
  var DOOR_CODE = '2739';

  var NOTE_RANGE = 2.4;
  var GIMMICK_RANGE = 2.6;
  var SIGN_RANGE = 3.2;
  var LEVER_NOISE_RADIUS = 44;      /* 契約: 配電は「大半径」。施設全体に響く駆動音 */
  var SPARK_NOISE_RADIUS = 44;      /* 誤順の火花＋大音（契約 §4 v2 工程3） */
  var CLIMAX_NOISE_RADIUS = 48;     /* 契約 §4 6a「音イベント最大半径で疾走」= hearMax */
  var HANDLE_HOLD_SECONDS = 3.0;    /* docs/notes.md: 長押し3秒 */
  var HANDLE_HOLD_DECAY = 1.0;      /* 手を離すと1秒で0へ戻る */
  var HANDLE_NOISE_INTERVAL = 0.40; /* 回している間、音が鳴り続ける（周期発火） */
  var BULKHEAD_OPEN_SECONDS = 12.0; /* 契約 §4 6a「隔壁は12秒かけて開く」 */
  var FLASH_DUR = 1.6;              /* 「未通電」等の応答表示の持続(s) */
  var KEYPAD_ERR_DUR = 0.6;         /* 誤入力表示の持続(s) */

  /* バルブパズル（契約 §4 工程5B「圧力計を緑域に合わせる。赤に振れたら戻す」） */
  var VALVE_STEPS = 5;                          /* 各バルブは 0..4 を巡回する */
  var VALVE_WEIGHT = [3, 2, 1];                 /* 針への効き（粗調整・中調整・微調整） */
  var VALVE_MAX = 3 * 4 + 2 * 4 + 1 * 4;        /* = 24 */
  var GREEN_LO = 0.44, GREEN_HI = 0.56;         /* 緑域 */
  var RED_LO = 0.08, RED_HI = 0.78;             /* この外は赤（振り切れ） */

  /* カードキー取得時の演出（契約 §4 工程4「無影灯が落ちて漆黒化＋呻きが近づく」） */
  var LIGHTS_OUT_DUR = 4.6;
  var DARK_ROOM_LEVEL = 0.62;       /* 演出後、処置室に留まる間の残留の暗さ */

  var SAVE_KEY = 'escape.save.area1.v1';

  /** 音響フックの共通口（P4.5）。音響モジュールが無くても落ちない */
  function sfx(name, p) {
    if (ESCAPE.audio && ESCAPE.audio.event) ESCAPE.audio.event(name, p);
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    el.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
  }

  var FACE = { n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0] };

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
      breakerOverlay: document.getElementById('breaker-overlay'),
      breakerMsg: document.getElementById('breaker-msg'),
      bkKeys: Array.prototype.slice.call(document.querySelectorAll('#breaker-grid .bk-key')),
      endingOverlay: document.getElementById('ending-overlay'),
      inventory: document.getElementById('inventory'),
      invFuse: document.getElementById('inv-fuse'),
      invWrench: document.getElementById('inv-wrench'),
      invCard: document.getElementById('inv-card'),
      gauge: document.getElementById('gauge'),
      gaugeNeedle: document.getElementById('gauge-needle'),
      gaugeLabel: document.getElementById('gauge-label'),
      opening: document.getElementById('opening'),
      dark: document.getElementById('fx-dark'),
      eraseBtn: document.getElementById('btn-erase')
    };
    /* 施錠扉・グレーチングの実体（World は静的メッシュなので別グループで持つ） */
    this.fx = new THREE.Group();
    this.fx.name = 'progress-fx';
    if (game.scene) game.scene.add(this.fx);
    this._geos = [];
    this._mats = [];
    this.reset();
    this._bind();
  }

  Progress.prototype.reset = function () {
    this.flags = {};                         /* 汎用フラグ（既存テスト互換のため維持） */
    this.notesRead = Object.create(null);    /* {noteId: true} */
    /* 所持品（契約 §4「所持品（ヒューズ／スパナ／カードキー）」） */
    this.items = { fuse: false, wrench: false, card: false };
    this.gimmick = {
      fuseSet: false,      /* 主電源盤にヒューズを装着した */
      power: false,        /* 3系統ブレーカーを正順で投入した */
      code: false,         /* 端末に 2739 を入力した */
      drained: false,      /* バルブで排気圧が緑域＝排水路の水が抜けた */
      cardUsed: false,     /* 制御室の扉をカードキーで解錠した */
      grating: false,      /* 排水路のグレーチングを外した */
      doorOpen: false,     /* 隔壁が開ききった */
      handleHold: 0,
      opening: 0           /* 隔壁の開放にかかる残り時間(s) */
    };
    this.breakerSeq = [];                    /* 押されたブレーカーの順 */
    this.valves = [0, 0, 0];
    this.cleared = false;
    this.clearedBy = null;                   /* 'main' | 'drain' */
    this.checkpoint = null;
    this.modal = null;                       /* null | 'memo' | 'keypad' | 'breaker' | 'ending' */
    this.memoId = null;
    this.keypadDigits = '';
    this.keypadErr = false;
    this.script = null;                      /* 無影灯が落ちる演出 */
    this.darkRoom = false;
    this.darkLevel = 0;
    this._flashMsg = ''; this._flashT = 0;
    this._kpErrT = 0;
    this._bkMsg = '';
    this._handleNoiseT = 0;
    this._moanT = 0;
    this._rebuildLookups();
    this._clearFX();
    this._buildGateFX();
    this._applyGates();
    this._syncModalDom();
    if (this.dom.keypadDisplay) { this.dom.keypadDisplay.classList.remove('err'); }
    this.dom._kpErrOn = false;
    for (var i = 0; i < this.dom.kpCells.length; i++) this.dom.kpCells[i].textContent = '';
    this.dom._promptText = undefined;
    this._syncInventory();
    this._syncHud();
  };

  Progress.prototype._rebuildLookups = function () {
    var map = this.game.map, meta = (map && map.meta) || {};
    this.map = map;
    this._noteAt = Object.create(null);
    var notes = meta.notes || [];
    for (var i = 0; i < notes.length; i++) this._noteAt[notes[i].col + ',' + notes[i].row] = notes[i];
    this._gimmickAt = Object.create(null);
    var gm = meta.gimmicks || [];
    for (var j = 0; j < gm.length; j++) this._gimmickAt[gm[j].col + ',' + gm[j].row] = gm[j];
    this._checkpointAt = Object.create(null);
    var cps = meta.checkpoints || [];
    for (var k = 0; k < cps.length; k++) this._checkpointAt[cps[k].col + ',' + cps[k].row] = cps[k];
    this._signAt = Object.create(null);
    var sg = meta.signs || [];
    for (var s = 0; s < sg.length; s++) this._signAt[sg[s].col + ',' + sg[s].row] = sg[s];
    this.gates = meta.gates || [];
    /* 処置室（漆黒化する部屋）の範囲 */
    this._darkRegion = null;
    var rs = meta.regions || [];
    for (var r = 0; r < rs.length; r++) if (rs[r].id === 'labB') this._darkRegion = rs[r];
  };

  Progress.prototype.modalOpen = function () { return !!this.modal; };

  /** 隔壁の解錠が済んでいるか（コード入力＋排気圧が緑域） */
  Progress.prototype.unlocked = function () { return this.gimmick.code && this.gimmick.drained; };
  /** 排水路が通れる状態か（グレーチングを外した＋排水済み） */
  Progress.prototype.drainOpen = function () { return this.gimmick.grating && this.gimmick.drained; };

  /* ---------------- 施錠・封鎖（runtime の通行止め） ---------------- */
  /** 契約 §4: 制御室はカードキー、排水路はグレーチング。map.setBlocked で塞ぐ。
   *  Stealth._blockBarredCells() が clearBlocked() するため毎フレーム貼り直す。 */
  Progress.prototype._applyGates = function () {
    var map = this.game.map;
    if (!map || !map.setBlocked) return;
    for (var i = 0; i < this.gates.length; i++) {
      var g = this.gates[i];
      var open = (g.requires === 'grating') ? this.gimmick.grating : !!this.gimmick[g.requires];
      map.setBlocked(g.col, g.row, !open);
    }
  };

  Progress.prototype._gateOpen = function (id) {
    for (var i = 0; i < this.gates.length; i++) {
      if (this.gates[i].id !== id) continue;
      var g = this.gates[i];
      return (g.requires === 'grating') ? this.gimmick.grating : !!this.gimmick[g.requires];
    }
    return false;
  };

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

  /** 施錠された扉（gates の door）が目の前にあるか。「扉を開ける」の受け口 */
  Progress.prototype._findGate = function () {
    var g = this.game, p = g.player, map = g.map;
    var T = ESCAPE.ENEMY_TUNING;
    var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    var best = null, bestD = Infinity;
    for (var i = 0; i < this.gates.length; i++) {
      var gt = this.gates[i];
      if (this._gateOpen(gt.id)) continue;
      var cc = map.cellCenter(gt.col, gt.row);
      var dx = cc.x - p.x, dz = cc.z - p.z;
      var d = Math.hypot(dx, dz);
      if (d > GIMMICK_RANGE + 0.4) continue;
      if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
      if (d < bestD) { bestD = d; best = gt; }
    }
    return best;
  };

  /** 掲示（読むだけ。操作は不要） */
  Progress.prototype._findSign = function () {
    var g = this.game, p = g.player, map = g.map;
    var T = ESCAPE.ENEMY_TUNING;
    var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    var col = p.col(), row = p.row();
    var best = null, bestD = Infinity;
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var s = this._signAt[(col + dc) + ',' + (row + dr)];
        if (!s) continue;
        /* dir は「読む側」。読む側から見えていること（背面からは読めない） */
        var v = FACE[s.dir] || FACE.n;
        var cc = map.cellCenter(s.col, s.row);
        var dx = cc.x - p.x, dz = cc.z - p.z;
        var d = Math.hypot(dx, dz);
        if (d > SIGN_RANGE) continue;
        if ((-dx) * v[0] + (-dz) * v[2] < 0) continue;      /* 板の裏側にいる */
        if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    return best;
  };

  Progress.prototype._gimmickDone = function (entry) {
    switch (entry.role) {
      case 'lever': return this.gimmick.power;
      case 'fuse': return this.items.fuse;
      case 'wrench': return this.items.wrench;
      case 'corpse': return this.items.card;
      case 'grating': return this.gimmick.grating;
      case 'handle': return this.gimmick.doorOpen;
      case 'terminal': return false;   /* 端末は段階表示のため常に対象 */
      case 'valve': return false;      /* バルブは何度でも回せる */
      default: return false;
    }
  };

  /* ---------------- 「調べる」（stepFrame から呼ばれる。処理したら true） ---------------- */
  Progress.prototype.onInteract = function () {
    if (this.modal === 'memo') { this._closeModal(); return true; }
    if (this.modal === 'keypad') { this._closeModal(); return true; }
    if (this.modal === 'breaker') { this._closeModal(); return true; }
    if (this.modal === 'ending') return true;

    var t = this._findTarget();
    if (t) {
      if (t.kind === 'note') { this._openMemo(t.entry.id); return true; }
      return this._useGimmick(t);
    }
    /* 施錠扉（カードキー） */
    var gt = this._findGate();
    if (gt && gt.kind === 'door') {
      if (this.items.card) {
        this.gimmick.cardUsed = true;
        this._applyGates();
        this._buildGateFX();
        this._flash(EXTRA_TEXT.cardUsed);
        sfx('terminalOk', {});
        this.save();
      } else {
        this._flash(PLACARD.locked);
      }
      return true;
    }
    return false;
  };

  Progress.prototype._useGimmick = function (t) {
    var role = t.entry.role;
    var c = this.game.map.cellCenter(t.col, t.row);

    if (role === 'fuse') {
      this.items.fuse = true;
      sfx('pickup', {});
      this._syncInventory();
      this.save();
      return true;
    }
    if (role === 'wrench') {
      this.items.wrench = true;
      sfx('pickup', {});
      this._syncInventory();
      this.save();
      return true;
    }
    if (role === 'corpse') {
      if (!this.items.card) {
        this.items.card = true;
        this._syncInventory();
        this._startLightsOut();
        this.save();
      }
      return true;
    }
    if (role === 'lever') {
      if (!this.gimmick.fuseSet) {
        if (this.items.fuse) {
          this.gimmick.fuseSet = true;
          this.items.fuse = false;          /* 盤に装着＝所持から外れる */
          sfx('pickup', {});
          this._syncInventory();
          this.save();
        } else {
          /* 契約 §4 工程1: ヒューズ欠落でレバーは空回りする */
          this._flash(PLACARD.leverIdle);
          sfx('handleCreak', { x: c.x, z: c.z });
        }
        return true;
      }
      if (!this.gimmick.power) { this._openBreaker(); return true; }
      return true;
    }
    if (role === 'valve') {
      var idx = t.entry.valve | 0;
      this.valves[idx] = (this.valves[idx] + 1) % VALVE_STEPS;
      sfx('valveTurn', { x: c.x, z: c.z });
      this._checkPressure();
      return true;
    }
    if (role === 'grating') {
      if (!this.items.wrench) { this._flash(EXTRA_TEXT.needWrench); return true; }
      if (!this.gimmick.drained) { this._flash(EXTRA_TEXT.drainFlooded); return true; }
      if (!this.gimmick.grating) {
        this.gimmick.grating = true;
        this._applyGates();
        this._buildGateFX();
        sfx('grateOff', { x: c.x, z: c.z });
        ESCAPE.noise.emit(c.x, c.z, ESCAPE.ENEMY_TUNING.gimmickNoiseRadius, 'grating');
        this.save();
      }
      return true;
    }
    if (role === 'terminal') {
      if (!this.gimmick.power) { this._flash(PLACARD.noPower); return true; }
      if (!this.gimmick.code) { this._openKeypad(); return true; }
      if (!this.gimmick.drained) { this._flash(PLACARD.pressureBad); return true; }
      this._flash(PLACARD.unlocked);
      return true;
    }
    if (role === 'handle') {
      /* 開放は長押し（step() 側で isInteractHeld() を見て進める）。単発タップは応答のみ */
      if (!this.unlocked()) { this._flash(PLACARD.bulkhead); return true; }
      return true;
    }
    return true;
  };

  /* ---------------- 配電パズル（3系統ブレーカー） ---------------- */
  Progress.prototype._openBreaker = function () {
    this.modal = 'breaker';
    this.breakerSeq = [];
    this._bkMsg = '';
    this._syncModalDom();
    this._syncBreakerDom();
  };

  /** 契約 §4 工程3: 正順=①循環 ②照明 ③隔壁。誤順は火花＋大音。 */
  Progress.prototype._bkPress = function (n) {
    if (this.modal !== 'breaker') return;
    if (this.gimmick.power) return;
    n = n | 0;
    var lv = this.game.map.cellCenter(9, 16);
    var gm = this.game.map.meta.gimmicks || [];
    for (var i = 0; i < gm.length; i++) {
      if (gm[i].role === 'lever') lv = this.game.map.cellCenter(gm[i].col, gm[i].row);
    }
    var expect = this.breakerSeq.length + 1;
    if (n !== expect) {
      /* 誤順: 火花が散り、大きな音が施設に響く（敵が疾走してくる） */
      this.breakerSeq = [];
      this._bkMsg = PLACARD.sparks;
      this._flash(PLACARD.sparks);
      sfx('spark', { x: lv.x, z: lv.z });
      ESCAPE.noise.emit(lv.x, lv.z, SPARK_NOISE_RADIUS, 'spark');
      this._syncBreakerDom();
      return;
    }
    this.breakerSeq.push(n);
    this._bkMsg = '';
    sfx('terminalKey', {});
    if (this.breakerSeq.length === 3) {
      this.gimmick.power = true;
      /* 正順でも駆動音は響く（契約: 同じく来る） */
      ESCAPE.noise.emit(lv.x, lv.z, LEVER_NOISE_RADIUS, 'lever');
      sfx('lever', { x: lv.x, z: lv.z });
      this._closeModal();
      this.save();
    }
    this._syncBreakerDom();
  };

  Progress.prototype._syncBreakerDom = function () {
    var d = this.dom;
    if (d.breakerMsg && d.breakerMsg.textContent !== this._bkMsg) d.breakerMsg.textContent = this._bkMsg;
    for (var i = 0; i < d.bkKeys.length; i++) {
      var n = parseInt(d.bkKeys[i].getAttribute('data-b'), 10);
      var on = this.breakerSeq.indexOf(n) >= 0;
      if (d.bkKeys[i]._on !== on) { d.bkKeys[i].classList.toggle('on', on); d.bkKeys[i]._on = on; }
    }
  };

  /* ---------------- バルブ／圧力計 ---------------- */
  Progress.prototype.pressure = function () {
    var v = this.valves;
    return (VALVE_WEIGHT[0] * v[0] + VALVE_WEIGHT[1] * v[1] + VALVE_WEIGHT[2] * v[2]) / VALVE_MAX;
  };
  Progress.prototype.pressureZone = function () {
    var p = this.pressure();
    if (p >= GREEN_LO && p <= GREEN_HI) return 'green';
    if (p < RED_LO || p > RED_HI) return 'red';
    return 'amber';
  };
  Progress.prototype._checkPressure = function () {
    if (this.gimmick.drained) return;
    if (this.pressureZone() !== 'green') return;
    this.gimmick.drained = true;
    sfx('gaugeOk', {});
    this._flash(PLACARD.unlocked);
    this.save();
  };

  /* ---------------- カードキー取得の演出（無影灯が落ちる） ---------------- */
  Progress.prototype._startLightsOut = function () {
    this.script = { name: 'lightsOut', t: 0 };
    this._moanT = 0.55;
    sfx('lampBurst', {});
  };

  Progress.prototype._stepScript = function (dt) {
    /* 残留の暗さ: 演出後、処置室にいる間はほぼ漆黒になる */
    var want = 0;
    if (this.script && this.script.name === 'lightsOut') {
      var s = this.script;
      s.t += dt;
      var k = s.t / LIGHTS_OUT_DUR;
      /* 0.0-0.35s で一気に落ち、以降ゆっくり残留レベルへ戻る */
      want = (s.t < 0.35) ? (0.97 * (s.t / 0.35)) : (0.97 - (0.97 - DARK_ROOM_LEVEL) * clamp((s.t - 0.35) / (LIGHTS_OUT_DUR - 0.35), 0, 1));
      this._moanT -= dt;
      if (this._moanT <= 0) {
        /* 呻きが近づいてくる（音だけ。実捕獲はしない＝スクリプト演出） */
        var p = this.game.player;
        var d = Math.max(0.6, 6.5 - s.t * 1.4);
        sfx('moanNear', { x: p.x + d * 0.7, z: p.z - d * 0.7 });
        this._moanT = 1.35;
      }
      if (k >= 1) { this.script = null; this.darkRoom = true; }
    } else if (this.darkRoom && this._inDarkRegion()) {
      want = DARK_ROOM_LEVEL;
    }
    var rate = (want > this.darkLevel) ? 10.0 : 2.4;
    this.darkLevel += (want - this.darkLevel) * clamp(rate * dt, 0, 1);
    if (this.darkLevel < 0.002) this.darkLevel = 0;
  };

  Progress.prototype._inDarkRegion = function () {
    var r = this._darkRegion;
    if (!r) return false;
    var c = this.game.player.col(), w = this.game.player.row();
    return c >= r.c0 && c <= r.c1 && w >= r.r0 && w <= r.r1;
  };

  /* ---------------- 排水路（しゃがみ専用・走行不可） ---------------- */
  /** その位置が排水路の中か */
  Progress.prototype.inCrawl = function () {
    var map = this.game.map, p = this.game.player;
    return !!(map.isCrawl && map.isCrawl(p.col(), p.row()));
  };

  /* ---------------- 毎フレーム ---------------- */
  Progress.prototype.step = function (dt) {
    /* Stealth._blockBarredCells() が clearBlocked() するので毎フレーム貼り直す */
    this._applyGates();
    if (this._flashT > 0) { this._flashT -= dt; if (this._flashT < 0) this._flashT = 0; }
    if (this._kpErrT > 0) {
      this._kpErrT -= dt;
      if (this._kpErrT <= 0) { this._kpErrT = 0; this.keypadDigits = ''; this.keypadErr = false; }
    }
    this._updateHandleHold(dt);
    this._updateOpening(dt);
    this._stepScript(dt);
    this._checkCheckpoint();
    this._checkClear();
    this._updatePrompt();
    this._syncKeypadDigits();
    this._syncHud();
  };

  Progress.prototype._updateHandleHold = function (dt) {
    var g = this.game, input = g.input;
    /* 中断安全（契約 §6）: モーダル中／捕獲演出・牢送り中はハンドルが回らない。 */
    var busy = !!this.modal || !!(g.stealth && g.stealth.jail && g.stealth.jail.phase !== 'none');
    var t = !busy ? this._findTarget() : null;
    var onHandle = !!(t && t.kind === 'gimmick' && t.entry.role === 'handle');
    var active = onHandle && this.unlocked() && !this.gimmick.doorOpen && this.gimmick.opening <= 0 &&
      input && input.isInteractHeld && input.isInteractHeld();
    if (active) {
      this.gimmick.handleHold = Math.min(1, this.gimmick.handleHold + dt / HANDLE_HOLD_SECONDS);
      this._handleNoiseT -= dt;
      if (this._handleNoiseT <= 0) {
        var c = g.map.cellCenter(t.col, t.row);
        ESCAPE.noise.emit(c.x, c.z, ESCAPE.ENEMY_TUNING.gimmickNoiseRadius, 'handle');
        sfx('handleCreak', { x: c.x, z: c.z });
        this._handleNoiseT = HANDLE_NOISE_INTERVAL;
      }
      if (this.gimmick.handleHold >= 1) {
        this.gimmick.handleHold = 1;
        this._startOpening(t.col, t.row);
      }
    } else {
      this.gimmick.handleHold = Math.max(0, this.gimmick.handleHold - dt / HANDLE_HOLD_DECAY);
      this._handleNoiseT = 0;
    }
  };

  /** 契約 §4 6a: 轟音 → 12秒かけて開く。敵は最大半径の音イベントで殺到する */
  Progress.prototype._startOpening = function (col, row) {
    if (this.gimmick.doorOpen || this.gimmick.opening > 0) return;
    this.gimmick.opening = BULKHEAD_OPEN_SECONDS;
    var d = this.game.map.meta.door || { col: col, row: row };
    var c = this.game.map.cellCenter(d.col, d.row);
    sfx('doorRoar', { x: c.x, z: c.z });
    ESCAPE.noise.emit(c.x, c.z, CLIMAX_NOISE_RADIUS, 'bulkhead');
    this.save();
  };

  Progress.prototype._updateOpening = function (dt) {
    if (this.gimmick.opening <= 0) return;
    this.gimmick.opening -= dt;
    if (this.gimmick.opening > 0) return;
    this.gimmick.opening = 0;
    this.gimmick.doorOpen = true;
    var d = this.game.map.meta.door;
    if (d) {
      var c = this.game.map.cellCenter(d.col, d.row);
      sfx('doorRoar', { x: c.x, z: c.z });
    }
    this.save();
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
    if (this.cleared) return;
    var g = this.game, meta = g.map.meta;
    var col = g.player.col(), row = g.player.row();
    /* 正規ルート: 隔壁が開ききってから隙間へ */
    if (this.gimmick.doorOpen && meta.exitPad && col === meta.exitPad.col && row === meta.exitPad.row) {
      this.clearedBy = 'main';
    } else if (meta.exitPad2 && col === meta.exitPad2.col && row === meta.exitPad2.row) {
      /* 裏ルート: 排水路を這って隔壁の向こう側へ出た（隔壁の開放を要さない） */
      this.clearedBy = 'drain';
    } else {
      return;
    }
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
        s = (t.kind === 'note') ? UI_TEXT.note : this._gimmickPrompt(t.entry);
      } else {
        var gt = this._findGate();
        if (gt && gt.kind === 'door') s = UI_TEXT.doorOpenTry;
        else {
          var sg = this._findSign();
          if (sg) s = SIGN_TEXT[sg.id] || '';
          else if (this.inCrawl()) s = UI_TEXT.crawl;
        }
      }
    }
    if (!s) return; /* 何も無ければ Stealth が書いた値をそのまま残す */
    var el = this.dom.prompt;
    /* 比較は「自分のキャッシュ」ではなく実DOMに対して行う。
       Stealth も同じ #prompt を毎フレーム書くため、自前キャッシュだけで判定すると
       「Stealth が空文字で上書き → Progress はキャッシュ一致で書き直さない」で
       プロンプトが消えたままになる（P4.7 の実機確認で発覚）。 */
    if (el && el.textContent !== s) el.textContent = s;
    this.dom._promptText = s;
  };

  Progress.prototype._gimmickPrompt = function (e) {
    switch (e.role) {
      case 'fuse': return UI_TEXT.fuseTake;
      case 'wrench': return UI_TEXT.wrenchTake;
      case 'corpse': return UI_TEXT.corpse;
      case 'valve': return UI_TEXT.valve;
      case 'grating': return UI_TEXT.grating;
      case 'lever':
        if (!this.gimmick.fuseSet) return this.items.fuse ? UI_TEXT.fuseSet : UI_TEXT.leverPull;
        return UI_TEXT.lever;
      case 'terminal': return this.gimmick.power ? UI_TEXT.terminal : PLACARD.noPower;
      case 'handle':
        if (!this.unlocked()) return PLACARD.bulkhead;
        return UI_TEXT.handle + '  ' + Math.round(this.gimmick.handleHold * 100) + '%';
      default: return '';
    }
  };

  /* ---------------- HUD（所持品・圧力計・隔壁開放） ---------------- */
  Progress.prototype._syncInventory = function () {
    var d = this.dom;
    var set = function (el, on) {
      if (!el || el._on === on) return;
      el.classList.toggle('on', on);
      el._on = on;
    };
    set(d.invFuse, !!this.items.fuse);
    set(d.invWrench, !!this.items.wrench);
    set(d.invCard, !!this.items.card);
    if (d.invFuse && d.invFuse.textContent !== ITEM_TEXT.fuse) d.invFuse.textContent = ITEM_TEXT.fuse;
    if (d.invWrench && d.invWrench.textContent !== ITEM_TEXT.wrench) d.invWrench.textContent = ITEM_TEXT.wrench;
    if (d.invCard && d.invCard.textContent !== ITEM_TEXT.card) d.invCard.textContent = ITEM_TEXT.card;
  };

  Progress.prototype._syncHud = function () {
    var d = this.dom;
    /* 圧力計はポンプ室（バルブの近く）でだけ出す */
    var showGauge = !this.gimmick.drained && this._nearValves();
    if (d.gauge && d.gauge._show !== showGauge) { d.gauge.classList.toggle('show', showGauge); d.gauge._show = showGauge; }
    if (showGauge && d.gaugeNeedle) {
      var p = this.pressure();
      var deg = -90 + p * 180;
      if (d.gaugeNeedle._deg !== deg) {
        d.gaugeNeedle.style.transform = 'translate(-50%,-100%) rotate(' + deg.toFixed(1) + 'deg)';
        d.gaugeNeedle._deg = deg;
      }
      var zone = this.pressureZone();
      if (d.gauge._zone !== zone) {
        d.gauge.classList.toggle('red', zone === 'red');
        d.gauge.classList.toggle('green', zone === 'green');
        d.gauge._zone = zone;
      }
    }
    if (d.gaugeLabel && d.gaugeLabel.textContent !== PLACARD.gauge) d.gaugeLabel.textContent = PLACARD.gauge;
    /* 隔壁開放中の残り秒（正文: 隔壁開放中　残り{SEC}秒） */
    var opening = this.gimmick.opening > 0;
    if (d.opening) {
      if (d.opening._show !== opening) { d.opening.classList.toggle('show', opening); d.opening._show = opening; }
      if (opening) {
        var sec = Math.max(1, Math.ceil(this.gimmick.opening));
        var txt = PLACARD.opening.replace('{SEC}', String(sec));
        if (d.opening.textContent !== txt) d.opening.textContent = txt;
      }
    }
    /* 処置室の漆黒化 */
    if (d.dark) {
      var a = this.darkLevel.toFixed(3);
      if (d.dark._a !== a) { d.dark.style.opacity = a; d.dark._a = a; }
    }
  };

  Progress.prototype._nearValves = function () {
    var p = this.game.player, map = this.game.map;
    var gm = map.meta.gimmicks || [];
    for (var i = 0; i < gm.length; i++) {
      if (gm[i].role !== 'valve') continue;
      var c = map.cellCenter(gm[i].col, gm[i].row);
      if (Math.hypot(c.x - p.x, c.z - p.z) < 9.0) return true;
    }
    return false;
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
      /* 契約 §4 工程5: コード正解でも排気圧が緑域でなければ弾かれる */
      this._flash(this.gimmick.drained ? PLACARD.unlocked : PLACARD.pressureBad);
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
    if (this.modal === 'memo' || this.modal === 'keypad' || this.modal === 'breaker') this._closeModal();
  };

  Progress.prototype._syncModalDom = function () {
    var d = this.dom;
    if (d.memoOverlay) d.memoOverlay.classList.toggle('show', this.modal === 'memo');
    if (d.keypadOverlay) d.keypadOverlay.classList.toggle('show', this.modal === 'keypad');
    if (d.breakerOverlay) d.breakerOverlay.classList.toggle('show', this.modal === 'breaker');
    if (d.endingOverlay) d.endingOverlay.classList.toggle('show', this.modal === 'ending');
  };

  Progress.prototype._flash = function (msg) {
    this._flashMsg = msg;
    this._flashT = FLASH_DUR;
  };

  /* ---------------- 施錠扉・グレーチングの実体（FXメッシュ） ---------------- */
  Progress.prototype._box = function (w, h, d) {
    var geo = new THREE.BoxGeometry(w, h, d);
    this._geos.push(geo);
    return geo;
  };
  Progress.prototype._litMat = function (hex, col, row, minK) {
    var lum = 0.05;
    if (this.game.ai) {
      var c = this.game.map.cellCenter(col, row);
      lum = this.game.ai.luminanceAt(c.x, c.z);
    }
    var k = clamp((minK === undefined ? 0.24 : minK) + lum * 1.55, 0, 1.05);
    var m = new THREE.MeshBasicMaterial({ color: hex, fog: true });
    m.color.multiplyScalar(k * k);
    this._mats.push(m);
    return m;
  };
  Progress.prototype._clearFX = function () {
    while (this.fx.children.length) this.fx.remove(this.fx.children[0]);
    for (var i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    for (var j = 0; j < this._mats.length; j++) this._mats[j].dispose();
    this._geos = []; this._mats = [];
  };

  /** 閉じているゲートだけ実体を描く（開いたら消す） */
  Progress.prototype._buildGateFX = function () {
    this._clearFX();
    var map = this.game.map, T = map.tileSize;
    for (var i = 0; i < this.gates.length; i++) {
      var g = this.gates[i];
      if (this._gateOpen(g.id)) continue;
      var cx = (g.col + 0.5) * T, cz = (g.row + 0.5) * T;
      var fy = map.cellFloorY(g.col, g.row);
      var grp = new THREE.Group();
      grp.name = 'gate-' + g.id;
      if (g.kind === 'grate') {
        /* 床のグレーチング（ボルト止めの格子板） */
        var mg = this._litMat(0x7c848a, g.col, g.row, 0.42);
        for (var k = 0; k < 7; k++) {
          var b = new THREE.Mesh(this._box(1.86, 0.06, 0.10), mg);
          b.position.set(cx, fy + 0.06, cz - 0.78 + k * 0.26);
          grp.add(b);
        }
        for (var k2 = 0; k2 < 3; k2++) {
          var b2 = new THREE.Mesh(this._box(0.10, 0.07, 1.86), mg);
          b2.position.set(cx - 0.7 + k2 * 0.7, fy + 0.065, cz);
          grp.add(b2);
        }
        var frame = new THREE.Mesh(this._box(1.98, 0.10, 1.98), this._litMat(0x4e565c, g.col, g.row, 0.36));
        frame.position.set(cx, fy + 0.02, cz);
        grp.add(frame);
      } else {
        /* 施錠扉（カードキー用のリーダーつきシャッター） */
        var open = map.isWalkable(g.col + 1, g.row) || map.isWalkable(g.col - 1, g.row);
        var alongX = !open;   /* 東西が壁なら扉板は南北方向に張る */
        var md = this._litMat(0x69727a, g.col, g.row, 0.42);
        var panel = new THREE.Mesh(
          this._box(alongX ? T : 0.22, 2.42, alongX ? 0.22 : T), md);
        panel.position.set(cx, fy + 1.21, cz);
        grp.add(panel);
        for (var r2 = 0; r2 < 3; r2++) {
          var rib = new THREE.Mesh(this._box(alongX ? T - 0.16 : 0.28, 0.12, alongX ? 0.28 : T - 0.16),
            this._litMat(0x3d444a, g.col, g.row, 0.34));
          rib.position.set(cx, fy + 0.55 + r2 * 0.80, cz);
          grp.add(rib);
        }
        /* カードリーダー（赤く小さく光る） */
        var rd = new THREE.Mesh(this._box(0.16, 0.22, 0.16),
          new THREE.MeshBasicMaterial({ color: 0x8c1c1c, fog: true }));
        this._mats.push(rd.material);
        rd.position.set(cx + (alongX ? 0.62 : 0.20), fy + 1.28, cz + (alongX ? 0.20 : 0.62));
        grp.add(rd);
      }
      this.fx.add(grp);
    }
  };

  /* ---------------- 牢送りのエリアリセットとの整合 ---------------- */
  /** 契約 §4: 所持品・仕掛け進行は保持し、位置とチェックポイントのみ巻き戻す */
  Progress.prototype.onAreaReset = function () {
    this.checkpoint = null;
    this.modal = null;
    /* 開放中だった隔壁は巻き戻す（開ききっていれば開いたまま） */
    this.gimmick.opening = 0;
    this.gimmick.handleHold = 0;
    this._syncModalDom();
    this._applyGates();
    this.save();
  };

  /* ---------------- セーブ / ロード / データ全消去 ---------------- */
  Progress.prototype.save = function () {
    try {
      var data = {
        v: 2, mapId: this.game.mapId,
        checkpoint: this.checkpoint,
        items: { fuse: this.items.fuse, wrench: this.items.wrench, card: this.items.card },
        valves: this.valves.slice(),
        gimmick: {
          fuseSet: this.gimmick.fuseSet, power: this.gimmick.power, code: this.gimmick.code,
          drained: this.gimmick.drained, cardUsed: this.gimmick.cardUsed,
          grating: this.gimmick.grating, doorOpen: this.gimmick.doorOpen
        },
        darkRoom: this.darkRoom,
        cleared: this.cleared
      };
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* privateモード等で保存できない環境は無視する */ }
  };

  /** 起動時1回だけ呼ぶ。セーブがあれば工程・所持品・チェックポイント位置を復元する */
  Progress.prototype.load = function () {
    var data = null;
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || data.mapId !== this.game.mapId) return false;
    if (data.items) {
      this.items.fuse = !!data.items.fuse;
      this.items.wrench = !!data.items.wrench;
      this.items.card = !!data.items.card;
    }
    if (data.valves && data.valves.length === 3) {
      this.valves = [data.valves[0] | 0, data.valves[1] | 0, data.valves[2] | 0];
    }
    if (data.gimmick) {
      this.gimmick.fuseSet = !!data.gimmick.fuseSet;
      this.gimmick.power = !!data.gimmick.power;
      this.gimmick.code = !!data.gimmick.code;
      this.gimmick.drained = !!data.gimmick.drained;
      this.gimmick.cardUsed = !!data.gimmick.cardUsed;
      this.gimmick.grating = !!data.gimmick.grating;
      this.gimmick.doorOpen = !!data.gimmick.doorOpen;
    }
    this.darkRoom = !!data.darkRoom;
    this.cleared = !!data.cleared;
    if (data.checkpoint) {
      this.checkpoint = data.checkpoint;
      this._placeAtCheckpoint(data.checkpoint);
    }
    this._applyGates();
    this._buildGateFX();
    this._syncInventory();
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
    for (var b = 0; b < this.dom.bkKeys.length; b++) {
      (function (btn) {
        bindTap(btn, function () { self._bkPress(parseInt(btn.getAttribute('data-b'), 10)); });
      })(this.dom.bkKeys[b]);
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
      } else if (self.modal === 'breaker') {
        var b2 = /^Digit([1-3])$/.exec(code);
        if (b2) self._bkPress(parseInt(b2[1], 10));
      }
    });
  };

  ESCAPE.Progress = Progress;
  ESCAPE.PROGRESS_NOTE_TEXTS = NOTE_TEXTS;
  ESCAPE.PROGRESS_UI_TEXT = UI_TEXT;
  ESCAPE.PROGRESS_PLACARD = PLACARD;
  ESCAPE.PROGRESS_SIGN_TEXT = SIGN_TEXT;
  ESCAPE.PROGRESS_ITEM_TEXT = ITEM_TEXT;
  ESCAPE.PROGRESS_EXTRA_TEXT = EXTRA_TEXT;
  ESCAPE.PROGRESS_DOOR_CODE = DOOR_CODE;
  ESCAPE.PROGRESS_TUNING = {
    valveSteps: VALVE_STEPS, valveWeight: VALVE_WEIGHT, valveMax: VALVE_MAX,
    greenLo: GREEN_LO, greenHi: GREEN_HI, redLo: RED_LO, redHi: RED_HI,
    handleHoldSeconds: HANDLE_HOLD_SECONDS, bulkheadOpenSeconds: BULKHEAD_OPEN_SECONDS,
    climaxNoiseRadius: CLIMAX_NOISE_RADIUS, sparkNoiseRadius: SPARK_NOISE_RADIUS,
    lightsOutDur: LIGHTS_OUT_DUR, darkRoomLevel: DARK_ROOM_LEVEL
  };

  /* 検証フック（機械テスト・E2E用）。ESCAPE.game.progress への遅延参照のみ。 */
  global.__progressDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.progress; },
    info: function () {
      var pr = ESCAPE.game && ESCAPE.game.progress;
      if (!pr) return null;
      return {
        modal: pr.modal,
        items: { fuse: pr.items.fuse, wrench: pr.items.wrench, card: pr.items.card },
        gimmick: {
          fuseSet: pr.gimmick.fuseSet, power: pr.gimmick.power, code: pr.gimmick.code,
          drained: pr.gimmick.drained, cardUsed: pr.gimmick.cardUsed, grating: pr.gimmick.grating,
          doorOpen: pr.gimmick.doorOpen, handleHold: pr.gimmick.handleHold, opening: pr.gimmick.opening
        },
        valves: pr.valves.slice(), pressure: pr.pressure(), zone: pr.pressureZone(),
        unlocked: pr.unlocked(), drainOpen: pr.drainOpen(),
        checkpoint: pr.checkpoint, cleared: pr.cleared, clearedBy: pr.clearedBy,
        notesRead: Object.keys(pr.notesRead), keypadDigits: pr.keypadDigits, keypadErr: pr.keypadErr,
        breakerSeq: pr.breakerSeq.slice(), darkLevel: pr.darkLevel
      };
    }
  };
})(window);
