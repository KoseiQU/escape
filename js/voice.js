/**
 * js/voice.js — P4.13 項目4「音を鳴らすと『声』が聞こえる（字幕つき）」
 *
 * 契約 DESIGN.md §4「P4.13 再プレイ差し戻し」項目4 ／ 正文 docs/notes.md「P4.13追加（声・軌跡）」。
 *
 *   ・トリガー … ESCAPE.noise.emit に乗る音すべて（sensor/trap/step/glass/water…）。
 *                kind は問わない。emitCell も内部で emit を呼ぶので同じ経路に乗る。
 *                enemy_ai.js は触らずに、ここで emit を包んで通知を受ける。
 *   ・声       … WebAudio で合成した囁き（js/audio.js の VOICES.whisper）。
 *                拍数に合わせた振幅包絡・無定位・長めの残響。音声ファイルは使わない（$0）。
 *   ・出し分け … そのプレイの最初の1回は必ず「みーつけた」。以降はランダムで
 *                直前と同じ文は連続させない。クールダウン25秒。
 *   ・字幕     … #voice-sub。声の開始0.3秒後に出て2.5秒で消える。
 *   ・鳴らさない … 捕獲シネマティック中・ゲームオーバー中・タイトル/未開始・テストモード。
 *
 * 時間はゲーム内の dt を積んだ自前の時計で数える（Engine.step から呼ばれる）。
 * setTimeout に頼らない＝非アクティブタブの節流や __pump 駆動でも同じ挙動になる。
 */
(function (global) {
  'use strict';

  var ESCAPE = global.ESCAPE || (global.ESCAPE = {});

  /* 正文 docs/notes.md の3本そのまま（追加・改変禁止。字幕は括弧なしで表示） */
  var LINES = ['みーつけた', 'そこにいるのね', '聞こえたよ'];
  /* 各セリフの拍数（囁きの振幅包絡を刻む数） */
  var BEATS = [5, 7, 5];

  var COOLDOWN = 25.0;      /* 声と声の最短間隔(s)（契約） */
  var SUB_DELAY = 0.30;     /* 声の開始から字幕が出るまで(s)（契約） */
  var SUB_HOLD = 2.50;      /* 字幕が出ている長さ(s)（契約） */
  var VOICE_GAIN = 0.95;

  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ================================================================
   * Voice
   * ============================================================== */
  function Voice() {
    this.el = null;
    this.allowInTest = false;   /* 機械テストだけが立てる（製品経路では常に false） */
    this._rng = lcg(70713);
    this._prevCaptures = 0;
    this.reset();
  }

  /** 製品初期状態へ（ページロード直後と同じ）。Engine.reset から呼ばれる */
  Voice.prototype.reset = function () {
    this.t = 0;
    this.firstDone = false;     /* このプレイでまだ一度も声が出ていない */
    this.lastIdx = -1;
    this.nextAt = 0;
    this.count = 0;
    this.lastLine = '';
    this.blockedBy = '';
    this.subText = '';
    this.subShowAt = -1;
    this.subHideAt = -1;
    this.subVisible = false;
    this._prevCaptures = this._captures();
    this._hideSub(true);
  };

  /** 新しい周（ページロード後・エリアリセット後）の始まり: 次の声は必ず「みーつけた」 */
  Voice.prototype.newPlay = function () {
    this.firstDone = false;
    this.lastIdx = -1;
    this.nextAt = this.t;
  };

  Voice.prototype._dom = function () {
    if (!this.el) this.el = document.getElementById('voice-sub');
    return this.el;
  };

  Voice.prototype._captures = function () {
    var g = ESCAPE.game;
    return (g && g.stealth && typeof g.stealth.captures === 'number') ? g.stealth.captures : 0;
  };

  /**
   * 声を出してはいけない状態。理由の文字列を返す（鳴らせるなら空文字）。
   * 捕獲シネマティック中・牢送り/ゲームオーバー中・タイトル/未開始・テストモード。
   */
  Voice.prototype.blocked = function () {
    var g = ESCAPE.game, au = ESCAPE.audio;
    if (!g || !g.running) return 'title';                      /* タイトル/未開始 */
    if (au && au.testMode && !this.allowInTest) return 'test'; /* 機械テスト中 */
    if (g.cinematic && g.cinematic.active()) return 'cine';    /* 捕獲シネマティック中 */
    if (g.stealth && g.stealth.jail && g.stealth.jail.phase !== 'none') {
      return (g.stealth.jail.phase === 'over') ? 'gameover' : 'jail';
    }
    return '';
  };

  /** 次に囁く文の番号（最初は必ず「みーつけた」／以降は直前と違う文） */
  Voice.prototype.pick = function () {
    if (!this.firstDone) return 0;
    var i = Math.floor(this._rng() * LINES.length);
    if (i >= LINES.length) i = LINES.length - 1;
    if (i === this.lastIdx) i = (i + 1 + Math.floor(this._rng() * (LINES.length - 1))) % LINES.length;
    return i;
  };

  /**
   * 音イベント（ESCAPE.noise.emit）を受けた瞬間の処理。
   * 返り値: 実際に囁いたセリフ（鳴らさなかったときは空文字）
   */
  Voice.prototype.onNoise = function (ev) {
    var why = this.blocked();
    this.blockedBy = why;
    if (why) return '';
    if (this.t < this.nextAt) { this.blockedBy = 'cooldown'; return ''; }

    var idx = this.pick();
    this.firstDone = true;
    this.lastIdx = idx;
    this.nextAt = this.t + COOLDOWN;
    this.count++;
    this.lastLine = LINES[idx];
    this.lastKind = (ev && ev.kind) || '';

    /* 音は必ず Engine 経由（バス・マスター・visibilitychange の一元管理を壊さない） */
    var au = ESCAPE.audio;
    if (au && au.play) {
      au.play('whisper', {
        beats: BEATS[idx], bus: 'self', gain: VOICE_GAIN,
        priority: 1, r: this._rng()
      });
    }
    /* 字幕は声の0.3秒後に出て2.5秒で消える */
    this.subText = LINES[idx];
    this.subShowAt = this.t + SUB_DELAY;
    this.subHideAt = this.subShowAt + SUB_HOLD;
    return this.lastLine;
  };

  Voice.prototype._showSub = function () {
    this.subVisible = true;
    var el = this._dom();
    if (!el) return;
    if (el.textContent !== this.subText) el.textContent = this.subText;
    if (!el.classList.contains('show')) el.classList.add('show');
  };

  Voice.prototype._hideSub = function (clear) {
    this.subVisible = false;
    var el = this._dom();
    if (!el) return;
    if (el.classList.contains('show')) el.classList.remove('show');
    if (clear && el.textContent !== '') el.textContent = '';
  };

  /** 1論理ステップ（js/audio.js の Engine.step の末尾から呼ばれる） */
  Voice.prototype.step = function (dt) {
    if (!isFinite(dt) || dt < 0) dt = 0;
    this.t += dt;

    /* エリアリセット（3回目の捕獲後の再開）を検出して「最初の1回」を戻す */
    var cap = this._captures();
    if (cap < this._prevCaptures) this.newPlay();
    this._prevCaptures = cap;

    /* 演出・ゲームオーバーに入ったら字幕は引っ込める */
    var why = this.blocked();
    if (why && why !== 'test' && this.subShowAt >= 0) {
      this.subShowAt = -1; this.subHideAt = -1;
      this._hideSub(false);
      return;
    }
    if (this.subShowAt >= 0 && this.t >= this.subShowAt) {
      if (this.t >= this.subHideAt) {
        this.subShowAt = -1; this.subHideAt = -1;
        this._hideSub(false);
      } else if (!this.subVisible) {
        this._showSub();
      }
    }
  };

  Voice.prototype.info = function () {
    return {
      t: this.t, count: this.count, lastLine: this.lastLine, lastKind: this.lastKind || '',
      firstDone: this.firstDone, cooldownLeft: Math.max(0, this.nextAt - this.t),
      subVisible: this.subVisible, subText: this.subText, blockedBy: this.blockedBy,
      allowInTest: this.allowInTest
    };
  };

  var voice = new Voice();
  ESCAPE.voice = voice;
  ESCAPE.VOICE_LINES = LINES;
  ESCAPE.VOICE_BEATS = BEATS;

  /* ================================================================
   * ESCAPE.noise.emit の包み込み
   *   enemy_ai.js は編集禁止なので、こちらでインスタンスの emit を差し替える。
   *   元の関数をそのまま呼んでから通知するだけ＝敵の聞き取りには一切触れない。
   *   emitCell は内部で this.emit を呼ぶので、この差し替えを必ず通る。
   *   reset() は emit を触らないので、包みが外れることもない。
   * ============================================================== */
  function wrapNoiseBus() {
    var bus = ESCAPE.noise;
    if (!bus || typeof bus.emit !== 'function' || bus.emit.__escVoiceWrapped) return false;
    var orig = bus.emit;
    var wrapped = function (x, z, radius, kind) {
      var ev = orig.call(this, x, z, radius, kind);
      try { voice.onNoise(ev); } catch (e) { /* 声で世界を壊さない */ }
      return ev;
    };
    wrapped.__escVoiceWrapped = true;
    wrapped.__escOriginal = orig;
    bus.emit = wrapped;
    return true;
  }
  var wrapped = wrapNoiseBus();

  /* ================================================================
   * 機械テスト（契約 §6）。runAll が拾う ESCAPE.__extraSuites へ積む。
   * 署名は test.js の suites と同じ (t, g)。
   * 実行後は製品状態へ完全復帰する（初回フラグ・クールダウン・字幕DOM）。
   * ============================================================== */
  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];

  var DT = function () { return ESCAPE.FIXED_DT; };
  function sim(g, n) { for (var i = 0; i < n; i++) g.stepFrame(DT()); }
  function simSec(g, sec) { sim(g, Math.ceil(sec / DT())); }
  /** 敵から遠い場所で1回音を鳴らす（敵の行動を乱さない） */
  function ping(kind) { return ESCAPE.noise.emit(-900, -900, 0.5, kind || 'test'); }

  function testP413VoiceContract(t, g) {
    t.ok(!!ESCAPE.voice, 'P4.13 項目4: 声のモジュールが結線されている');
    t.ok(wrapped || (ESCAPE.noise.emit && ESCAPE.noise.emit.__escVoiceWrapped),
      'P4.13 項目4: ESCAPE.noise.emit を包んで音イベントを拾っている');
    t.ok(typeof ESCAPE.noise.emitCell === 'function' &&
      String(ESCAPE.noise.emitCell).indexOf('this.emit(') >= 0,
      'P4.13 項目4: emitCell も同じ emit を通る（漏れがない）');
    t.ok(LINES.length === 3, 'P4.13 項目4: セリフは3本だけ（追加禁止）', LINES.length);
    t.ok(LINES[0] === 'みーつけた' && LINES[1] === 'そこにいるのね' && LINES[2] === '聞こえたよ',
      'P4.13 項目4: セリフが正文どおり（一字一句）', LINES.join('／'));
    t.ok(BEATS[0] === 5 && BEATS[1] === 7 && BEATS[2] === 5,
      'P4.13 項目4: 拍数が 5／7／5', BEATS.join(','));
    t.near(COOLDOWN, 25.0, 1e-9, 'P4.13 項目4: クールダウン25秒（契約）', COOLDOWN);
    t.near(SUB_DELAY, 0.30, 1e-9, 'P4.13 項目4: 字幕は0.3秒後（契約）', SUB_DELAY);
    t.near(SUB_HOLD, 2.50, 1e-9, 'P4.13 項目4: 字幕は2.5秒で消える（契約）', SUB_HOLD);
    var el = document.getElementById('voice-sub');
    if (t.ok(!!el, 'P4.13 項目4: #voice-sub のDOMが結線されている')) {
      var cs = global.getComputedStyle(el);
      t.ok(cs.position === 'absolute' || cs.position === 'fixed',
        'P4.13 項目4: 字幕は画面に固定して置かれている', cs.position);
      t.ok(cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.01,
        'P4.13 項目4: 既定では字幕は見えない', cs.visibility + '/' + cs.opacity);
      var hint = document.getElementById('trap-hint');
      if (hint) {
        var zs = parseInt(cs.zIndex, 10) || 0;
        var zh = parseInt(global.getComputedStyle(hint).zIndex, 10) || 0;
        t.ok(zs > zh, 'P4.13 項目4: 字幕は罠案内より上の層にある', zs + ' > ' + zh);
        t.ok(cs.bottom !== global.getComputedStyle(hint).bottom,
          'P4.13 項目4: 罠案内と重ならない高さに置く（両方読める）',
          cs.bottom + ' / ' + global.getComputedStyle(hint).bottom);
      }
    }
  }

  function testP413VoiceTrigger(t, g) {
    g.reset();
    var V = ESCAPE.voice, au = ESCAPE.audio;
    var wasAllow = V.allowInTest;
    var el = document.getElementById('voice-sub');

    /* 1) テストモード中は鳴らない（契約） */
    V.allowInTest = false;
    var f0 = au.fired.whisper || 0;
    ping('sensor');
    t.ok((au.fired.whisper || 0) === f0, 'P4.13 項目4: テストモード中は声が鳴らない');
    t.ok(V.blockedBy === 'test', 'P4.13 項目4: 抑止の理由がテストモード', V.blockedBy);

    /* 以降は「実プレイと同じ経路」を機械テストから踏むための許可を立てる */
    V.allowInTest = true;
    V.reset();

    /* 2) 音イベント → 声＋字幕。最初は必ず「みーつけた」 */
    var f1 = au.fired.whisper || 0;
    ping('trap');
    t.ok((au.fired.whisper || 0) === f1 + 1, 'P4.13 項目4: 音イベントで声が鳴る',
      ((au.fired.whisper || 0) - f1) + '回');
    t.ok(V.lastLine === 'みーつけた', 'P4.13 項目4: そのプレイの最初は必ず「みーつけた」', V.lastLine);

    /* 3) 字幕は0.3秒後に出る（それより前は出ていない） */
    simSec(g, 0.22);
    t.ok(!V.subVisible && !(el && el.classList.contains('show')),
      'P4.13 項目4: 0.3秒より前は字幕が出ていない');
    simSec(g, 0.20);
    t.ok(V.subVisible && !!el && el.classList.contains('show'),
      'P4.13 項目4: 声の0.3秒後に字幕が出る');
    t.ok(!!el && el.textContent === 'みーつけた',
      'P4.13 項目4: 字幕は括弧なしのセリフそのまま', el ? el.textContent : '—');
    if (el) {
      var cs = global.getComputedStyle(el);
      t.ok(cs.visibility === 'visible', 'P4.13 項目4: 字幕が実際に可視になっている', cs.visibility);
    }

    /* 4) 2.5秒で消える */
    simSec(g, 2.0);
    t.ok(V.subVisible, 'P4.13 項目4: 2.5秒たつまでは字幕が残る');
    simSec(g, 0.7);
    t.ok(!V.subVisible && !!el && !el.classList.contains('show'),
      'P4.13 項目4: 字幕は2.5秒で消える');

    /* 5) クールダウン中は不発（25秒） */
    var f2 = au.fired.whisper || 0;
    ping('step');
    t.ok((au.fired.whisper || 0) === f2, 'P4.13 項目4: クールダウン中は鳴らない');
    t.ok(V.blockedBy === 'cooldown', 'P4.13 項目4: 抑止の理由がクールダウン', V.blockedBy);
    simSec(g, 21.0);
    ping('glass');
    t.ok((au.fired.whisper || 0) === f2, 'P4.13 項目4: 25秒たつまでは鳴らない',
      V.info().cooldownLeft.toFixed(1) + 's残り');
    simSec(g, 1.6);
    ping('water');
    t.ok((au.fired.whisper || 0) === f2 + 1, 'P4.13 項目4: 25秒たてばまた鳴る');

    /* 6) 直前と同じ文を連続させない（kind を問わず全ての音イベントが対象） */
    var kinds = ['sensor', 'trap', 'step', 'glass', 'water', 'gimmick', 'bulkhead', 'safe'];
    var seq = [V.lastLine], dup = 0, fired = 0;
    for (var i = 0; i < kinds.length * 2; i++) {
      V.nextAt = V.t;                       /* クールダウンだけ外す＝経路は実物のまま */
      var before = au.fired.whisper || 0;
      ping(kinds[i % kinds.length]);
      if ((au.fired.whisper || 0) > before) fired++;
      if (V.lastLine === seq[seq.length - 1]) dup++;
      seq.push(V.lastLine);
    }
    t.ok(fired === kinds.length * 2, 'P4.13 項目4: kind を問わず全ての音イベントで鳴る',
      fired + '/' + (kinds.length * 2));
    t.ok(dup === 0, 'P4.13 項目4: 直前と同じ文を連続させない', seq.join('→'));
    var seen = {};
    for (var k = 0; k < seq.length; k++) seen[seq[k]] = 1;
    t.ok(Object.keys(seen).length === 3, 'P4.13 項目4: 3本とも出る（偏らない）',
      Object.keys(seen).join('／'));

    /* 7) 捕獲シネマティック中・ゲームオーバー中は不発（契約） */
    var f3 = au.fired.whisper || 0;
    var jailWas = g.stealth.jail.phase;
    g.stealth.jail.phase = 'grab';
    V.nextAt = V.t;
    ping('trap');
    t.ok((au.fired.whisper || 0) === f3, 'P4.13 項目4: 捕獲中は鳴らない');
    t.ok(V.blockedBy === 'jail', 'P4.13 項目4: 抑止の理由が捕獲演出', V.blockedBy);
    g.stealth.jail.phase = 'over';
    ping('trap');
    t.ok((au.fired.whisper || 0) === f3, 'P4.13 項目4: ゲームオーバー中は鳴らない');
    t.ok(V.blockedBy === 'gameover', 'P4.13 項目4: 抑止の理由がゲームオーバー', V.blockedBy);
    g.stealth.jail.phase = jailWas;

    /* 8) エリアリセット（捕獲回数が0へ戻る）で「最初の1回」が戻る */
    var capWas = g.stealth.captures;
    g.stealth.captures = 3;
    sim(g, 2);
    g.stealth.captures = 0;
    sim(g, 2);
    t.ok(V.firstDone === false, 'P4.13 項目4: エリアリセット後は初回が戻る');
    V.nextAt = V.t;
    ping('sensor');
    t.ok(V.lastLine === 'みーつけた', 'P4.13 項目4: エリアリセット後の最初も「みーつけた」', V.lastLine);
    g.stealth.captures = capWas;

    /* 9) 製品状態へ完全復帰 */
    V.allowInTest = wasAllow;
    V.reset();
    ESCAPE.noise.reset();
    g.reset();
    t.ok(V.count === 0 && V.firstDone === false && V.lastLine === '',
      'P4.13 項目4: 復帰: 声の状態が初期化される');
    t.ok(!V.subVisible && !!el && !el.classList.contains('show') && el.textContent === '',
      'P4.13 項目4: 復帰: 字幕のDOMが消える');
    t.ok(V.allowInTest === false, 'P4.13 項目4: 復帰: テスト用の許可が外れる');
    t.ok(ESCAPE.noise.pending.length === 0, 'P4.13 項目4: 復帰: 音イベントのキューが空');
  }

  /** レンダ（OfflineAudioContext）で囁きの厚みと拍数を数値判定する */
  function testP413VoiceRender(t, g) {
    var A = ESCAPE.Audio, c = A.cache;
    if (!t.ok(!!(c.wh_dry5 && c.wh_dry7 && c.wh_wet5), 'P4.13 項目4: 囁きのレンダが揃っている',
      A.prewarmError() || '')) return;
    t.ok(c.wh_dry5.peaks === 5, 'P4.13 項目4: 5拍のセリフは包絡の山が5つ',
      c.wh_dry5.peaks + '山');
    t.ok(c.wh_dry7.peaks === 7, 'P4.13 項目4: 7拍のセリフは包絡の山が7つ',
      c.wh_dry7.peaks + '山');
    t.ok(c.wh_wet5.rms > 0.004 && c.wh_wet5.peak > 0.03,
      'P4.13 項目4: 囁きが聞こえる音量で鳴る',
      'rms=' + c.wh_wet5.rms.toFixed(4) + ' peak=' + c.wh_wet5.peak.toFixed(4));
    t.ok(c.wh_wet5.peak < 0.98 && !c.wh_wet5.clipped,
      'P4.13 項目4: 囁きがクリップしない', c.wh_wet5.peak.toFixed(4));
    /* 拍数が多い＝長い（そこにいるのね > みーつけた） */
    var d5 = c.wh_dry5.activeRatio * c.wh_dry5.duration;
    var d7 = c.wh_dry7.activeRatio * c.wh_dry7.duration;
    t.ok(d7 > d5 * 1.2, 'P4.13 項目4: 7拍のセリフは5拍より明らかに長い',
      d5.toFixed(3) + 's → ' + d7.toFixed(3) + 's');
    /* 残響が長め（乾いた音より尾を引く） */
    var wet = c.wh_wet5.activeRatio * c.wh_wet5.duration;
    t.ok(wet > d5 * 1.5, 'P4.13 項目4: 残響で尾を引く（無響より長く残る）',
      d5.toFixed(3) + 's → ' + wet.toFixed(3) + 's');
    /* 囁き＝低域が主体ではない（帯域整形ノイズが1.2kHz より上に寄っている） */
    t.ok(c.wh_dry5.lowRatio !== undefined && c.wh_dry5.lowRatio < 0.35,
      'P4.13 項目4: 帯域整形が高い方に寄っている（囁きの帯域）',
      ((c.wh_dry5.lowRatio || 0) * 100).toFixed(1) + '% が1.2kHz未満');
  }

  ESCAPE.__extraSuites.push(testP413VoiceContract, testP413VoiceTrigger, testP413VoiceRender);

  /* 検証フック（E2E・手動確認用） */
  global.__voiceDebug = {
    voice: function () { return voice; },
    info: function () { return voice.info(); },
    lines: LINES,
    beats: BEATS,
    ping: function (kind) { return ESCAPE.noise.emit(-900, -900, 0.5, kind || 'debug'); },
    reset: function () { return voice.reset(); }
  };
})(window);
