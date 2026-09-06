/* ESCAPE — P4.8「アリアドネ方式」進行管理（調べるUI・メモ・区画銘板・鍵と隔壁・目的表示・セーブ）
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」／docs/notes.md「エリア1 v3 アリアドネ方式」
 *
 * 【P4.8 失効】旧 v2 の7工程（ヒューズ／保管庫／配電パズル／カードキー／端末コード／
 *   バルブ／12秒隔壁の追走／排水路グレーチング）と所持品UIは失効。造形は残置してあるが
 *   「調べる」対象ではない（meta.gimmicks から外してある）。
 *
 * 現行の「調べる」対象は4種類だけ:
 *   1 壁のメモ（6枚）           … 拡大表示
 *   2 区画銘板（A〜F）          … 地図に区画名を記入
 *   3 所長室の金庫              … 隔壁の鍵を手に入れる
 *   4 北の隔壁                  … 鍵で解錠 → EXIT でクリア
 *   ＋ 落ちたロープの結び目     … 拾って結ぶ（Rope へ委譲）
 *
 * 既存システムとの結線:
 *   - js/game.js stepFrame(): モーダル中は視点・移動を止める。「調べる」は
 *     progress.onInteract() を先に試し、処理しなければ stealth.onInteract() へ。
 *   - js/enemy_ai.js Stealth.hidden(): モーダル中は捕獲されない（中断安全）。
 *   - js/enemy_ai.js Stealth.areaReset(): 3回目の捕獲でエリア最初から
 *     （Progress.onAreaReset → 鍵・地図の踏破・ロープを規定どおり巻き戻す）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* ================================================================
   * docs/notes.md 正文（一字一句変更禁止）。
   * 対応表（実位置と最も整合する memo 番号。id の連番とは一致しない）:
   *   a1_n1→memo5 / a1_n2→memo2 / a1_n3→memo6 / a1_n4→memo3 / a1_n5→memo1 / a1_n6→memo4
   * memo1 / memo4 / memo5 は「エリア1 v3 アリアドネ方式」節の差し替え本文が正。
   * memo2 / memo3 / memo6 は旧本文のまま（v3節「旧本文のまま」）。
   * ============================================================== */
  var NOTE_TEXTS = {
    /* memo1 — 受入ホール（v3差し替え） */
    a1_n5: {
      title: '夜勤引継ぎのメモ',
      body: '夜勤の点検員へ\n\n' +
        '隔壁が全部降りた。北の隔壁だけは手動で開くが、鍵がいる。\n' +
        '鍵は所長室の金庫 —— 施設の一番奥だ。\n\n' +
        '腰のロープを外すな。奴らが来る前、俺たちはこれで戻っていた。\n' +
        'ロープが張ったら、それ以上は行くな。戻れ。'
    },
    /* memo2 — 病室区画の行き止まり（旧本文のまま） */
    a1_n2: {
      title: '封鎖作業 申し送り',
      body: '第7次封鎖作業 申し送り（抜粋）\n\n' +
        '・移送対象No.6、依然として区画内を徘徊。直立時の視野は広いが、暗がりでは目が利かない。\n' +
        '・接近された場合はロッカーへ。奴は「見た」ものしか追わない。\n' +
        '・通路の資材板は倒せば時間が稼げる。ただし一度きりだ。\n' +
        '・しゃがんで歩け。立って走った者から順に、いなくなった。'
    },
    /* memo3 — 検体タンク室の近く（旧本文のまま） */
    a1_n4: {
      title: '巡回員への警告',
      body: 'B-3区画 巡回員へ\n\n' +
        'タンクの中身について質問するな。記録にも残すな。\n' +
        '廊下の赤いビームは旧警備システムの生き残りだ。走って抜けると警報が鳴り、\n' +
        '「回収班」が来る。回収班はもういない。来るのは別のものだ。\n\n' +
        'ゆっくり歩けば、ビームの手前で必ず気づける。'
    },
    /* memo4 — 記録室（v3差し替え） */
    a1_n6: {
      title: '最終封鎖手順書 控え',
      body: '最終封鎖手順書 控え\n\n' +
        '・隔壁鍵は所長保管。所長室は北の記録区画の西端 —— 記録室のさらに奥。\n' +
        '・区画銘板は撤去せず残す。迷った者の目印になる。\n\n' +
        '……もう戻る者もいない。この控えを残す。\n' +
        '誰かがここまで辿り着いたなら、どうか急いでくれ。奴は音を覚える。'
    },
    /* memo5 — 主電源盤の傍・西区画（v3差し替え） */
    a1_n1: {
      title: '点検員の走り書き',
      body: '点検員の走り書き\n\n' +
        '電源は死んでる。灯りは腰のライトだけだ。\n' +
        '歩けば点く。止まれば消える。\n' +
        '—— 点けたまま奴の前に出るな。光は遠くからでも見える。'
    },
    /* memo6 — 拘束室の前室（旧本文のまま） */
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

  /* docs/notes.md「区画名」の正文。銘板の表記は `A　受入区画` 形式（間は全角空白） */
  var ZONE_NAMES = {
    A: '受入区画', B: '実験区画', C: '検体区画',
    D: '拘束区画', E: '記録区画', F: '機械区画'
  };
  function zoneLabel(zone) { return zone + '　' + (ZONE_NAMES[zone] || ''); }

  /* docs/notes.md「UI文言」（v3節）の正文 */
  var UI_TEXT = {
    note: 'メモを読む',
    regionSign: '区画銘板を読む',
    safe: '金庫を開ける',
    keyGot: '隔壁の鍵を手に入れた',
    bulkheadLook: '隔壁を調べる',
    bulkheadLocked: '施錠されている —— 鍵がいる',
    bulkheadUnlock: '隔壁を解錠する',
    knot: 'ロープを拾って結ぶ',
    taut: 'ロープが張った',
    mapTitle: '地図'
  };

  /* docs/notes.md「目的表示（画面上部1行）」の正文 */
  var OBJECTIVE = {
    findKey: '出口の鍵を探す —— 施設の一番奥へ',
    haveKey: '鍵を手に入れた —— 北の隔壁へ戻る',
    taut: 'ロープが張った —— 来た道を戻れ',
    knot: '落ちたロープの結び目へ戻る',
    /* P4.9: 張力インジケータが赤に入った瞬間の一時表示（docs/notes.md「目的表示（P4.9追加）」） */
    ropeShort: 'ロープが足りない —— 戻って巻き戻せ'
  };

  /* P4.9 HUD文言（docs/notes.md「HUD文言（P4.9追加）」）。{M} は余裕(m)の整数 */
  var ROPE_HUD = 'ロープ 余裕 {M}m';

  /* 壁の掲示（docs/notes.md「掲示（短文・使い回し可のフレーバー）」の正文）。
   * P4.8: 配電順序・制御室・排水路・12秒開放の掲示は失効（該当の仕掛けが無い）。 */
  var SIGN_TEXT = {
    sg_store: '保管庫　硝子片散乱　走行厳禁',
    sg_bulkhead: '非常隔壁 手動開放は解錠後のみ可 / 開放中は大音響に注意'
  };

  var NOTE_RANGE = 2.4;
  var GIMMICK_RANGE = 2.6;
  var SIGN_RANGE = 3.2;
  var REGION_SIGN_RANGE = 3.0;
  var NOTE_GLOW_RANGE = 3.4;        /* 本物のメモの縁が淡く光り始める距離(m) */
  var FLASH_DUR = 1.9;              /* 応答表示の持続(s) */

  var SAVE_KEY = 'escape.save.area1.v2';
  var SAVE_KEY_OLD = 'escape.save.area1.v1';   /* P4.7 以前のセーブ（読まずに消す） */

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
      objective: document.getElementById('objective'),
      ropeHud: document.getElementById('rope-hud'),
      memoOverlay: document.getElementById('memo-overlay'),
      memoTitle: document.getElementById('memo-title'),
      memoBody: document.getElementById('memo-body'),
      endingOverlay: document.getElementById('ending-overlay'),
      dark: document.getElementById('fx-dark'),
      eraseBtn: document.getElementById('btn-erase')
    };
    /* 近接したメモの縁の淡い光（本物のメモの見分け・契約 §4「メモの見分け」） */
    this.fx = new THREE.Group();
    this.fx.name = 'progress-fx';
    if (game.scene) game.scene.add(this.fx);
    this._geos = [];
    this._mats = [];
    this._buildNoteGlow();
    this.reset();
    this._bind();
  }

  Progress.prototype.reset = function () {
    this.flags = {};                         /* 汎用フラグ（既存テスト互換のため維持） */
    this.notesRead = Object.create(null);    /* {noteId: true} */
    this.signsRead = Object.create(null);    /* {regionSignId: true} */
    this.gimmick = {
      key: false,          /* 所長室の金庫から隔壁の鍵を得た */
      doorOpen: false      /* 北の隔壁を解錠した＝開放 */
    };
    this.cleared = false;
    this.clearedBy = null;                   /* 'main'（アリアドネ方式では正規1本のみ） */
    this.checkpoint = null;
    this.modal = null;                       /* null | 'memo' | 'ending' */
    this.memoId = null;
    this.darkLevel = 0;
    this._flashMsg = ''; this._flashT = 0;
    this._wasTaut = false;
    this._objText = '';
    this._rebuildLookups();
    this._syncModalDom();
    this.dom._promptText = undefined;
    if (this._glow) this._glow.visible = false;
    this._glowLevel = 0;
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
    this._regionSignAt = Object.create(null);
    var rs = meta.regionSigns || [];
    for (var r = 0; r < rs.length; r++) this._regionSignAt[rs[r].col + ',' + rs[r].row] = rs[r];
    this.regionSigns = rs;
  };

  Progress.prototype.modalOpen = function () { return !!this.modal; };
  /** 隔壁が開いているか（アリアドネ方式では鍵1本で解錠＝即開放） */
  Progress.prototype.unlocked = function () { return !!this.gimmick.doorOpen; };
  Progress.prototype.hasKey = function () { return !!this.gimmick.key; };

  /* ---------------- 対象の検出（メモ・仕掛け・銘板。ロッカー/板は Stealth の領分） ---------------- */
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
        if (tile === TILE.NOTE) {
          entry = this._noteAt[c + ',' + r];
          if (entry) kind = 'note';
        } else if (tile === TILE.GIMMICK || tile === TILE.DOOR) {
          /* P4.8: 失効した仕掛けのタイル（造形だけ残置）は meta に居ないので対象外になる。
             北の隔壁は DOOR タイルそのものが対象。 */
          entry = this._gimmickAt[c + ',' + r];
          if (entry) kind = 'gimmick';
        }
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
    switch (entry.role) {
      case 'safe': return this.gimmick.key;
      case 'bulkhead': return this.gimmick.doorOpen;
      default: return true;      /* 未知の役割＝失効した仕掛け。対象にしない */
    }
  };

  /** 壁の掲示（読むだけ） */
  Progress.prototype._findSign = function () {
    return this._findFacing(this._signAt, SIGN_RANGE);
  };
  /** 区画銘板（「調べる」で地図に記入される） */
  Progress.prototype._findRegionSign = function () {
    var s = this._findFacing(this._regionSignAt, REGION_SIGN_RANGE);
    if (s && this.signsRead[s.id]) return null;
    return s;
  };

  /** dir（＝読む側）を向いた壁の掲示物を探す共通処理 */
  Progress.prototype._findFacing = function (index, range) {
    var g = this.game, p = g.player, map = g.map;
    var T = ESCAPE.ENEMY_TUNING;
    var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    var col = p.col(), row = p.row();
    var best = null, bestD = Infinity;
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var s = index[(col + dc) + ',' + (row + dr)];
        if (!s) continue;
        var v = FACE[s.dir] || FACE.n;
        var cc = map.cellCenter(s.col, s.row);
        var dx = cc.x - p.x, dz = cc.z - p.z;
        var d = Math.hypot(dx, dz);
        if (d > range) continue;
        if ((-dx) * v[0] + (-dz) * v[2] < 0) continue;      /* 板の裏側にいる */
        if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    return best;
  };

  /* ---------------- 「調べる」（stepFrame から呼ばれる。処理したら true） ---------------- */
  Progress.prototype.onInteract = function () {
    if (this.modal === 'memo') { this._closeModal(); return true; }
    if (this.modal === 'ending') return true;

    /* 落ちたロープの結び目を拾って結ぶ（契約 §4「捕獲時」） */
    var rope = this.game.rope;
    if (rope && !rope.isAttached() && rope.nearKnot()) {
      if (rope.pickUp()) { this._flash(UI_TEXT.knot); return true; }
    }

    var t = this._findTarget();
    if (t) {
      if (t.kind === 'note') { this._openMemo(t.entry.id); return true; }
      return this._useGimmick(t);
    }
    var rs = this._findRegionSign();
    if (rs) { this._readRegionSign(rs); return true; }
    return false;
  };

  Progress.prototype._useGimmick = function (t) {
    var role = t.entry.role;
    var c = this.game.map.cellCenter(t.col, t.row);

    /* 所長室の金庫 → 隔壁の鍵 */
    if (role === 'safe') {
      if (!this.gimmick.key) {
        this.gimmick.key = true;
        sfx('terminalOk', {});
        ESCAPE.noise.emit(c.x, c.z, ESCAPE.ENEMY_TUNING.gimmickNoiseRadius, 'safe');
        this._flash(UI_TEXT.keyGot);
        this.save();
      }
      return true;
    }
    /* 北の隔壁 */
    if (role === 'bulkhead') {
      if (!this.gimmick.key) { this._flash(UI_TEXT.bulkheadLocked); sfx('handleCreak', { x: c.x, z: c.z }); return true; }
      if (!this.gimmick.doorOpen) {
        this.gimmick.doorOpen = true;
        sfx('doorRoar', { x: c.x, z: c.z });
        ESCAPE.noise.emit(c.x, c.z, ESCAPE.ENEMY_TUNING.hearMax, 'bulkhead');
        this.save();
      }
      return true;
    }
    return true;
  };

  /** 区画銘板を読む → 地図に A〜F と施設名が記入される */
  Progress.prototype._readRegionSign = function (s) {
    this.signsRead[s.id] = true;
    if (this.game.minimap) this.game.minimap.learnZone(s.zone);
    sfx('noteOpen', {});
    this._flash(zoneLabel(s.zone));
    this.save();
    return true;
  };

  /* ---------------- 毎フレーム ---------------- */
  Progress.prototype.step = function (dt) {
    if (this._flashT > 0) { this._flashT -= dt; if (this._flashT < 0) this._flashT = 0; }
    /* ロープが張った瞬間の画面表示（正文『ロープが張った』）。
       目的表示の一時差し替えは objective() 側が rope.taut を見て行う。 */
    var rope = this.game.rope;
    var taut = !!(rope && rope.taut);
    if (taut && !this._wasTaut) this._flash(UI_TEXT.taut);
    this._wasTaut = taut;
    this._checkCheckpoint();
    this._checkClear();
    this._updateNoteGlow(dt);
    this._updatePrompt();
    this._updateObjective();
    this._updateRopeHud();
    this._syncHud();
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
    if (!this.gimmick.doorOpen) return;
    if (!meta.exitPad || col !== meta.exitPad.col || row !== meta.exitPad.row) return;
    this.cleared = true;
    this.clearedBy = 'main';
    this._openEnding();
    this.save();
  };

  Progress.prototype._updatePrompt = function () {
    var s = '';
    if (this._flashT > 0) {
      s = this._flashMsg || '';
    } else if (!this.modal) {
      var rope = this.game.rope;
      if (rope && !rope.isAttached() && rope.nearKnot()) {
        s = UI_TEXT.knot;
      } else {
        var t = this._findTarget();
        if (t) {
          s = (t.kind === 'note') ? UI_TEXT.note : this._gimmickPrompt(t.entry);
        } else {
          var rs = this._findRegionSign();
          if (rs) s = UI_TEXT.regionSign;
          else {
            var sg = this._findSign();
            if (sg) s = SIGN_TEXT[sg.id] || '';
          }
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
      case 'safe': return UI_TEXT.safe;
      case 'bulkhead': return this.gimmick.key ? UI_TEXT.bulkheadUnlock : UI_TEXT.bulkheadLook;
      default: return '';
    }
  };

  /** 目的表示（画面上部1行・正文4種）。メモ・鍵取得・ロープ張りで更新される */
  Progress.prototype.objective = function () {
    var rope = this.game.rope;
    if (rope && !rope.isAttached()) return OBJECTIVE.knot;
    if (rope && rope.taut) return OBJECTIVE.taut;
    /* P4.9: 張力インジケータが赤に入った直後は目的表示を差し替える */
    if (rope && rope.redT > 0) return OBJECTIVE.ropeShort;
    /* 鍵を得たら以後はずっとこの行（クリア画面が出た後も戻さない） */
    if (this.gimmick.key) return OBJECTIVE.haveKey;
    return OBJECTIVE.findKey;
  };

  Progress.prototype._updateObjective = function () {
    var el = this.dom.objective;
    if (!el) return;
    var s = this.objective();
    if (el.textContent !== s) el.textContent = s;
    var taut = (s === OBJECTIVE.taut || s === OBJECTIVE.ropeShort);
    if (el._taut !== taut) { el.classList.toggle('taut', taut); el._taut = taut; }
    this._objText = s;
  };

  /* P4.9 ロープ張力インジケータ（DESIGN.md §4「エリア1 新マップ Z4」）。
   * 表示は余裕(m)のみ・状態は色だけで示す（GPS的な矢印は出さない＝手探りを壊さない）。 */
  Progress.prototype.ropeHudText = function () {
    var rope = this.game.rope;
    if (!rope) return '';
    return ROPE_HUD.replace('{M}', String(Math.round(rope.slack())));
  };
  Progress.prototype.ropeHudState = function () {
    var rope = this.game.rope;
    if (!rope) return 'loose';
    return rope.tension().state;
  };
  Progress.prototype._updateRopeHud = function () {
    var el = this.dom.ropeHud;
    if (!el) return;
    var txt = this.ropeHudText();
    if (el.textContent !== txt) el.textContent = txt;
    var st = this.ropeHudState();
    if (el._st !== st) {
      el.className = st;
      el._st = st;
    }
  };

  /* ---------------- 本物のメモの見分け（近接で縁が淡く光る） ---------------- */
  Progress.prototype._buildNoteGlow = function () {
    var geo = new THREE.PlaneGeometry(0.70, 0.92);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffe9b4, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true
    });
    this._geos.push(geo);
    this._mats.push(mat);
    this._glow = new THREE.Mesh(geo, mat);
    this._glow.visible = false;
    this._glowMat = mat;
    this.fx.add(this._glow);
  };

  /** 最寄りの「本物のメモ」を探して、その壁面に淡い光を出す */
  Progress.prototype._updateNoteGlow = function (dt) {
    var g = this.game, p = g.player, map = g.map;
    var best = null, bd = Infinity;
    var col = p.col(), row = p.row();
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var e = this._noteAt[(col + dc) + ',' + (row + dr)];
        if (!e) continue;
        var cc = map.cellCenter(e.col, e.row);
        var d = Math.hypot(cc.x - p.x, cc.z - p.z);
        if (d < bd) { bd = d; best = e; }
      }
    }
    var want = 0;
    if (best && bd <= NOTE_GLOW_RANGE) {
      want = clamp(1 - (bd - NOTE_RANGE) / (NOTE_GLOW_RANGE - NOTE_RANGE), 0, 1);
      var cc2 = map.cellCenter(best.col, best.row);
      /* 面の向き＝メモのマスからプレイヤー側へ出ている歩行可能な向き */
      var n = this._noteFace(best);
      this._glow.position.set(
        cc2.x + n[0] * (map.tileSize * 0.5 + 0.028), 1.45 + map.cellFloorY(best.col, best.row),
        cc2.z + n[2] * (map.tileSize * 0.5 + 0.028));
      this._glow.rotation.set(0, Math.atan2(n[0], n[2]), 0);
    }
    this._glowLevel += (want - this._glowLevel) * clamp(7.0 * dt, 0, 1);
    if (this._glowLevel < 0.004) this._glowLevel = 0;
    var vis = this._glowLevel > 0;
    if (this._glow.visible !== vis) this._glow.visible = vis;
    /* 淡く脈打つ（ゲーム内時刻駆動＝__pumpでも同じ絵になる） */
    this._glowMat.opacity = this._glowLevel * (0.16 + 0.09 * (0.5 + 0.5 * Math.sin(g.simTime * 1.9)));
  };

  Progress.prototype._noteFace = function (e) {
    var map = this.game.map, p = this.game.player;
    var best = [0, 0, 1], bd = Infinity;
    var D = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
    for (var i = 0; i < 4; i++) {
      var nc = e.col + D[i][0], nr = e.row + D[i][1];
      if (!map.isWalkable(nc, nr)) continue;
      var c = map.cellCenter(nc, nr);
      var d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd) { bd = d; best = D[i][2]; }
    }
    return best;
  };

  /* ---------------- HUD ---------------- */
  Progress.prototype._syncHud = function () {
    var d = this.dom;
    if (d.dark) {
      var a = this.darkLevel.toFixed(3);
      if (d.dark._a !== a) { d.dark.style.opacity = a; d.dark._a = a; }
    }
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
    this.save();
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
    if (this.modal === 'memo') this._closeModal();
  };

  Progress.prototype._syncModalDom = function () {
    var d = this.dom;
    if (d.memoOverlay) d.memoOverlay.classList.toggle('show', this.modal === 'memo');
    if (d.endingOverlay) d.endingOverlay.classList.toggle('show', this.modal === 'ending');
  };

  Progress.prototype._flash = function (msg) {
    this._flashMsg = msg;
    this._flashT = FLASH_DUR;
  };

  /* ---------------- 3回目の捕獲＝エリアリセットとの整合 ---------------- */
  /** 契約 §4: エリア最初から。地図の踏破は消え、ロープの軌跡は世界に残る。
   *  鍵と読んだメモ（＝知識）は保持する（牢送りの「進行状態は保持」の継承）。 */
  Progress.prototype.onAreaReset = function () {
    this.checkpoint = null;
    this.modal = null;
    this._flashT = 0;
    this._syncModalDom();
    if (this.game.minimap) this.game.minimap.onAreaReset();
    if (this.game.rope) this.game.rope.onAreaReset();
    this.save();
  };

  /* ---------------- セーブ / ロード / データ全消去 ---------------- */
  Progress.prototype.save = function () {
    try {
      var data = {
        v: 3, mapId: this.game.mapId,
        checkpoint: this.checkpoint,
        gimmick: { key: this.gimmick.key, doorOpen: this.gimmick.doorOpen },
        notesRead: Object.keys(this.notesRead),
        signsRead: Object.keys(this.signsRead),
        cleared: this.cleared,
        rope: this.game.rope ? this.game.rope.save() : null,
        map: this.game.minimap ? this.game.minimap.save() : null
      };
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* privateモード等で保存できない環境は無視する */ }
  };

  /** 起動時1回だけ呼ぶ。セーブがあれば鍵・地図・ロープ・位置を復元する */
  Progress.prototype.load = function () {
    var data = null;
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || data.mapId !== this.game.mapId) return false;
    if (data.gimmick) {
      this.gimmick.key = !!data.gimmick.key;
      this.gimmick.doorOpen = !!data.gimmick.doorOpen;
    }
    var nr = data.notesRead || [];
    for (var i = 0; i < nr.length; i++) this.notesRead[nr[i]] = true;
    var sr = data.signsRead || [];
    for (var j = 0; j < sr.length; j++) this.signsRead[sr[j]] = true;
    this.cleared = !!data.cleared;
    if (this.game.minimap && data.map) this.game.minimap.load(data.map);
    if (data.checkpoint) {
      this.checkpoint = data.checkpoint;
      this._placeAtCheckpoint(data.checkpoint);
    }
    /* ロープは位置の復元より後（stack の先頭＝現在地の整合を保つ） */
    if (this.game.rope && data.rope) this.game.rope.load(data.rope);
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
    try {
      global.localStorage.removeItem(SAVE_KEY);
      global.localStorage.removeItem(SAVE_KEY_OLD);
    } catch (e) { /* 無視 */ }
    if (ESCAPE.audio && ESCAPE.audio.eraseSettings) ESCAPE.audio.eraseSettings();
    this.game.reset();
  };

  /* ---------------- DOM結線（コンストラクタから1回だけ） ---------------- */
  Progress.prototype._bind = function () {
    var self = this;
    bindTap(this.dom.memoOverlay, function () { self.onCloseTap(); });

    if (this.dom.eraseBtn) {
      bindTap(this.dom.eraseBtn, function () {
        var ok = true;
        try { ok = global.confirm('セーブデータを全て消去します。よろしいですか？'); } catch (e) { ok = true; }
        if (ok) self.eraseAllData();
      });
    }

    global.addEventListener('keydown', function (e) {
      if (e.code === 'Escape') self.onCloseTap();
    });
  };

  ESCAPE.Progress = Progress;
  ESCAPE.PROGRESS_NOTE_TEXTS = NOTE_TEXTS;
  ESCAPE.PROGRESS_UI_TEXT = UI_TEXT;
  ESCAPE.PROGRESS_OBJECTIVE = OBJECTIVE;
  ESCAPE.PROGRESS_SIGN_TEXT = SIGN_TEXT;
  ESCAPE.ZONE_NAMES = ZONE_NAMES;
  ESCAPE.zoneLabel = zoneLabel;
  ESCAPE.PROGRESS_SAVE_KEY = SAVE_KEY;

  /* 検証フック（機械テスト・E2E用）。ESCAPE.game.progress への遅延参照のみ。 */
  global.__progressDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.progress; },
    info: function () {
      var pr = ESCAPE.game && ESCAPE.game.progress;
      if (!pr) return null;
      return {
        modal: pr.modal,
        key: pr.gimmick.key, doorOpen: pr.gimmick.doorOpen,
        checkpoint: pr.checkpoint, cleared: pr.cleared, clearedBy: pr.clearedBy,
        notesRead: Object.keys(pr.notesRead), signsRead: Object.keys(pr.signsRead),
        objective: pr.objective(), prompt: pr.dom.prompt ? pr.dom.prompt.textContent : '',
        ropeHud: pr.ropeHudText(), ropeState: pr.ropeHudState()
      };
    }
  };
})(window);
