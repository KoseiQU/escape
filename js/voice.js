/**
 * js/voice.js — 音を鳴らすと「声」が聞こえる（字幕つき）
 *
 * 契約 DESIGN.md §4「P4.13 再プレイ差し戻し」項目4 ＋「P4.15 声の差し替え」／
 * 正文 docs/notes.md「P4.13追加（声・軌跡）」「P4.15追加（声）」。
 *
 *   ・トリガー … ESCAPE.noise.emit に乗る音すべて（sensor/trap/step/glass/water…）。
 *                kind は問わない。emitCell も内部で emit を呼ぶので同じ経路に乗る。
 *                enemy_ai.js は触らずに、ここで emit を包んで通知を受ける。
 *   ・声       … P4.15: WebAudio で合成した「すすり泣き→絶叫」（VOICES.sobScream）。
 *                P4.13 の囁き（whisper）は失効し、音色ごと削除した。音声ファイルは使わない（$0）。
 *                再生のたびに種（seed）を変える＝同じ音が二度と完全一致しない。
 *   ・出し分け … そのプレイの最初の1回は必ず「みーつけた」。以降はランダムで
 *                直前と同じ文は連続させない。クールダウン25秒。
 *   ・字幕     … #voice-sub。P4.15: 絶叫の開始（声の開始から SOB_ONSET 秒後）に出して
 *                2.5秒で消える。すすり泣きの間は出さない。
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

  var COOLDOWN = 25.0;      /* 声と声の最短間隔(s)（契約） */
  /* P4.15: 字幕は「絶叫の開始」に合わせる＝声の開始から SOB_ONSET 秒後。
     すすり泣き（それより前）の間は出さない。値は音色側の定数と必ず同じものを使う。 */
  var SUB_AT = (ESCAPE.Audio && typeof ESCAPE.Audio.SOB_ONSET === 'number')
    ? ESCAPE.Audio.SOB_ONSET : 1.20;
  var SUB_HOLD = 2.50;      /* 字幕が出ている長さ(s)（契約） */
  /* P4.15: master の DynamicsCompressor（-18dB / 5:1）へ深く突っ込むと絶叫だけが
     潰れて「静→爆」が縮む。0.95 から下げてコンプの効きを浅くしてある
     （音色側のピークが上がったので、聞こえる大きさは以前より大きい）。 */
  var VOICE_GAIN = 0.62;

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
    this.lastSeed = 0;
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

    /* 音は必ず Engine 経由（バス・マスター・visibilitychange の一元管理を壊さない）。
       seed を毎回変える＝同じ声が二度と完全一致しない（契約 P4.15 要件4）。 */
    var au = ESCAPE.audio;
    this.lastSeed = ((this._rng() * 4294967296) >>> 0) || 1;
    if (au && au.play) {
      au.play('sobScream', {
        bus: 'self', gain: VOICE_GAIN, priority: 1,
        seed: this.lastSeed, r: this._rng()
      });
    }
    /* 字幕は絶叫の開始に合わせて出し、2.5秒で消える（すすり泣き中は出さない） */
    this.subText = LINES[idx];
    this.subShowAt = this.t + SUB_AT;
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
      lastSeed: this.lastSeed, subAt: SUB_AT,
      allowInTest: this.allowInTest
    };
  };

  var voice = new Voice();
  ESCAPE.voice = voice;
  ESCAPE.VOICE_LINES = LINES;
  ESCAPE.VOICE_SUB_AT = SUB_AT;

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
    t.near(COOLDOWN, 25.0, 1e-9, 'P4.13 項目4: クールダウン25秒（契約）', COOLDOWN);
    t.near(SUB_HOLD, 2.50, 1e-9, 'P4.13 項目4: 字幕は2.5秒で消える（契約）', SUB_HOLD);
    /* P4.15: 発声は「すすり泣き→絶叫」。囁きは失効＝音色ごと消えている */
    t.ok(typeof ESCAPE.Audio.VOICES.sobScream === 'function',
      'P4.15: 発声が sobScream（すすり泣き→絶叫）になっている');
    t.ok(ESCAPE.Audio.VOICES.whisper === undefined,
      'P4.15: 失効した囁き（whisper）は残っていない');
    t.ok(String(Voice.prototype.onNoise).indexOf("'sobScream'") >= 0,
      'P4.15: 声の再生が sobScream を鳴らしている');
    t.near(SUB_AT, ESCAPE.Audio.SOB_ONSET, 1e-9,
      'P4.15: 字幕は絶叫の開始と同じ時刻に出す（音色側の定数と一致）', SUB_AT);
    t.ok(SUB_AT > 1.0, 'P4.15: すすり泣きの間（1秒以上）は字幕を出さない', SUB_AT + 's');
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
    var f0 = au.fired.sobScream || 0;
    ping('sensor');
    t.ok((au.fired.sobScream || 0) === f0, 'P4.13 項目4: テストモード中は声が鳴らない');
    t.ok(V.blockedBy === 'test', 'P4.13 項目4: 抑止の理由がテストモード', V.blockedBy);

    /* 以降は「実プレイと同じ経路」を機械テストから踏むための許可を立てる */
    V.allowInTest = true;
    V.reset();

    /* 2) 音イベント → 声＋字幕。最初は必ず「みーつけた」 */
    var f1 = au.fired.sobScream || 0;
    ping('trap');
    t.ok((au.fired.sobScream || 0) === f1 + 1, 'P4.13 項目4: 音イベントで声が鳴る',
      ((au.fired.sobScream || 0) - f1) + '回');
    t.ok(V.lastLine === 'みーつけた', 'P4.13 項目4: そのプレイの最初は必ず「みーつけた」', V.lastLine);

    /* 3) 字幕は「絶叫の開始」に合わせて出る（すすり泣きの間は出ない）＝P4.15 */
    simSec(g, 0.32);
    t.ok(!V.subVisible && !(el && el.classList.contains('show')),
      'P4.15: 旧仕様の0.3秒後にはまだ字幕が出ていない');
    simSec(g, SUB_AT - 0.32 - 0.06);
    t.ok(!V.subVisible && !(el && el.classList.contains('show')),
      'P4.15: 絶叫の直前（すすり泣き中）は字幕が出ていない',
      V.t.toFixed(2) + 's / 絶叫 ' + SUB_AT + 's');
    simSec(g, 0.10);
    t.ok(V.subVisible && !!el && el.classList.contains('show'),
      'P4.15: 絶叫の開始に合わせて字幕が出る', V.t.toFixed(2) + 's');
    t.ok(!!el && el.textContent === 'みーつけた',
      'P4.13 項目4: 字幕は括弧なしのセリフそのまま', el ? el.textContent : '—');
    if (el) {
      var cs = global.getComputedStyle(el);
      t.ok(cs.visibility === 'visible', 'P4.13 項目4: 字幕が実際に可視になっている', cs.visibility);
    }

    /* 4) 絶叫の開始から2.5秒で消える */
    simSec(g, 2.0);
    t.ok(V.subVisible, 'P4.13 項目4: 2.5秒たつまでは字幕が残る');
    simSec(g, 0.7);
    t.ok(!V.subVisible && !!el && !el.classList.contains('show'),
      'P4.13 項目4: 字幕は2.5秒で消える');

    /* 5) クールダウン中は不発（25秒） */
    var f2 = au.fired.sobScream || 0;
    ping('step');
    t.ok((au.fired.sobScream || 0) === f2, 'P4.13 項目4: クールダウン中は鳴らない');
    t.ok(V.blockedBy === 'cooldown', 'P4.13 項目4: 抑止の理由がクールダウン', V.blockedBy);
    simSec(g, 21.0);
    ping('glass');
    t.ok((au.fired.sobScream || 0) === f2, 'P4.13 項目4: 25秒たつまでは鳴らない',
      V.info().cooldownLeft.toFixed(1) + 's残り');
    simSec(g, 1.6);
    ping('water');
    t.ok((au.fired.sobScream || 0) === f2 + 1, 'P4.13 項目4: 25秒たてばまた鳴る');

    /* 6) 直前と同じ文を連続させない（kind を問わず全ての音イベントが対象） */
    var kinds = ['sensor', 'trap', 'step', 'glass', 'water', 'gimmick', 'bulkhead', 'safe'];
    var seq = [V.lastLine], dup = 0, fired = 0;
    for (var i = 0; i < kinds.length * 2; i++) {
      V.nextAt = V.t;                       /* クールダウンだけ外す＝経路は実物のまま */
      var before = au.fired.sobScream || 0;
      ping(kinds[i % kinds.length]);
      if ((au.fired.sobScream || 0) > before) fired++;
      if (V.lastLine === seq[seq.length - 1]) dup++;
      seq.push(V.lastLine);
    }
    t.ok(fired === kinds.length * 2, 'P4.13 項目4: kind を問わず全ての音イベントで鳴る',
      fired + '/' + (kinds.length * 2));
    t.ok(dup === 0, 'P4.13 項目4: 直前と同じ文を連続させない', seq.join('→'));
    /* P4.15 要件4: 再生のたびに種が変わる（同じ音が二度と完全一致しない） */
    var seeds = {}, sn = 0, sk;
    for (sk = 0; sk < 12; sk++) {
      V.nextAt = V.t;
      ping('trap');
      if (V.lastSeed) { seeds[V.lastSeed] = 1; sn++; }
    }
    t.ok(sn === 12 && Object.keys(seeds).length === 12,
      'P4.15: 再生のたびに種が変わる（12回すべて別の種）',
      Object.keys(seeds).length + '/' + sn);
    var seen = {};
    for (var k = 0; k < seq.length; k++) seen[seq[k]] = 1;
    t.ok(Object.keys(seen).length === 3, 'P4.13 項目4: 3本とも出る（偏らない）',
      Object.keys(seen).join('／'));

    /* 7) 捕獲シネマティック中・ゲームオーバー中は不発（契約） */
    var f3 = au.fired.sobScream || 0;
    var jailWas = g.stealth.jail.phase;
    g.stealth.jail.phase = 'grab';
    V.nextAt = V.t;
    ping('trap');
    t.ok((au.fired.sobScream || 0) === f3, 'P4.13 項目4: 捕獲中は鳴らない');
    t.ok(V.blockedBy === 'jail', 'P4.13 項目4: 抑止の理由が捕獲演出', V.blockedBy);
    g.stealth.jail.phase = 'over';
    ping('trap');
    t.ok((au.fired.sobScream || 0) === f3, 'P4.13 項目4: ゲームオーバー中は鳴らない');
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

  /**
   * レンダ（OfflineAudioContext）で P4.15 の数値判定を行う。
   * 契約 DESIGN.md「P4.15 声の差し替え」の4点:
   *   ピーク0.85〜0.92・クリップなし ／ 絶叫の基音推移が直線でない（1秒に3回以上の向き変化）
   *   ／ 種違い2レンダの波形相関 < 0.9 ／ すすり泣きと絶叫の RMS 比 1:4 以上
   */
  function testP415VoiceRender(t, g) {
    var A = ESCAPE.Audio, c = A.cache, m = c.sob;
    if (!t.ok(!!(m && c.sob_corr), 'P4.15: すすり泣き→絶叫のレンダが揃っている',
      A.prewarmError() || '')) return;

    t.ok(m.peak >= 0.85 && m.peak <= 0.92,
      'P4.15: ピークが 0.85〜0.92 に収まる（契約）', m.peak.toFixed(4));
    t.ok(!m.clipped && m.peak <= 1.0, 'P4.15: クリップしない', m.peak.toFixed(4));

    t.ok(m.turns >= 3,
      'P4.15: 絶叫の基音が直線でない（1秒に3回以上の向き変化）', m.turns + '回 / 1s');
    t.ok(m.f0lo > 0 && m.f0hi > m.f0lo * 1.5,
      'P4.15: 絶叫の基音が跳ね上がって落ちる（追跡できている）',
      Math.round(m.f0lo) + '〜' + Math.round(m.f0hi) + 'Hz ' + m.f0got);

    var corr = c.sob_corr.corr;
    t.ok(corr < 0.9, 'P4.15: 種違いの2レンダは同じ波形にならない（相関 < 0.9）',
      corr.toFixed(4));

    var ratio = m.rmsWin.scr / Math.max(m.rmsWin.sob, 1e-9);
    t.ok(ratio >= 4, 'P4.15: すすり泣きと絶叫の RMS 比が 1:4 以上（静→爆）',
      '1:' + ratio.toFixed(1));

    /* 妥協点の明示: 冒頭のしゃくり上げはピークの30%以下（「静→爆」を優先） */
    t.ok(m.headPeak <= m.peak * 0.30,
      'P4.15: 冒頭のしゃくり上げはピークの30%以下（静→爆を壊さない）',
      (m.headPeak / m.peak * 100).toFixed(1) + '%');
    /* 立ち上がりは絶叫の位置（＝すすり泣きが十分に静か） */
    t.ok(m.onset >= 0 && m.onset < A.SOB_ONSET,
      'P4.15: すすり泣きから始まる（無音ではない）', m.onset.toFixed(3) + 's');
    t.ok(m.duration > A.SOB_ONSET + A.SOB_SCR,
      'P4.15: 絶叫の終わりまで鳴り切る長さがある',
      m.duration.toFixed(2) + 's ≧ ' + (A.SOB_ONSET + A.SOB_SCR).toFixed(2) + 's');
  }

  /** 声の音色そのものの結線検査（周期的な揺れを使っていないこと等） */
  function testP415VoiceShape(t, g) {
    var src = String(ESCAPE.Audio.VOICES.sobScream);
    t.ok(src.indexOf('vibrato') < 0 && src.indexOf('createOscillator') < 0,
      'P4.15 要件1: 声の揺れに固定周波数のLFOを使っていない');
    t.ok(src.indexOf('walk(') >= 0 || src.indexOf('voicePair(') >= 0,
      'P4.15 要件1: 揺れはランダムウォーク（walk）で作っている');
    t.ok(src.indexOf('voicePair(') >= 0 && src.indexOf('driftFormants(') >= 0,
      'P4.15 要件2: 主声＋副声とフォルマントの漂いが入っている');
    t.ok(src.indexOf('p.seed') >= 0, 'P4.15 要件4: 種（seed）で音が変わる');
    t.ok(src.indexOf('reverb(') >= 0, 'P4.15 要件5: 残響を通している');
    t.ok(src.indexOf('curveTo(') >= 0, 'P4.15 要件6: 包絡は曲線（curveTo）で書いている');
    t.near(ESCAPE.Audio.SOB_ONSET, 1.20, 1e-9,
      'P4.15: すすり泣きは約1.2秒（契約）', ESCAPE.Audio.SOB_ONSET);
  }

  ESCAPE.__extraSuites.push(testP413VoiceContract, testP413VoiceTrigger,
    testP415VoiceRender, testP415VoiceShape);

  /* 検証フック（E2E・手動確認用） */
  global.__voiceDebug = {
    voice: function () { return voice; },
    info: function () { return voice.info(); },
    lines: LINES,
    subAt: SUB_AT,
    ping: function (kind) { return ESCAPE.noise.emit(-900, -900, 0.5, kind || 'debug'); },
    reset: function () { return voice.reset(); }
  };
})(window);
