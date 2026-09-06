/* ESCAPE — メインループとシーン基盤
 * 固定タイムステップ(1/60秒)で更新し、フレーム末に1回描画する。
 * 契約 DESIGN.md §6: window.__pump(n) は「更新＋描画ワンセット」を n 回。
 * 本物のrAFループと __pump は同じ stepFrame()/render() を同じ順で呼ぶ。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  var FIXED_DT = 1 / 60;
  var MAX_FRAME = 0.25;   // 1フレームで消化する最大実時間(s)
  var BASE_FOV = 75;      // 通常時の視野角。追跡中だけ音響ディレクタが少し広げる

  function Game() {
    this.mapId = 'area1';
    this.running = false;
    this.frameCount = 0;
    this.renderCount = 0;
    this.simTime = 0;
    this.stats = { interacts: 0 };
    this._accum = 0;
    this._last = 0;
  }

  Game.prototype.init = function () {
    var self = this;
    this.canvas = document.getElementById('view');

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    /* テクスチャの異方性はGPU上限内で控えめに（スマホ優先） */
    if (ESCAPE.Textures) {
      ESCAPE.Textures.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(ESCAPE.World.FOG_COLOR);
    this.scene.fog = new THREE.Fog(ESCAPE.World.FOG_COLOR, 1.6, 15.5);

    /* far は霧の到達（15.5m）の少し先で切る。それより遠くは完全に霧色で見えないので、
     * 遠クリップを詰めるほど world のチャンク（P4.9）が視錐台カリングで落ちる。 */
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 30);
    this.camera.rotation.order = 'YXZ';

    this.map = ESCAPE.Maps.load(this.mapId);
    this.world = new ESCAPE.World(this.map);
    this.scene.add(this.world.group);

    this.player = new ESCAPE.Player(this.map);
    /* P4.8 アリアドネ方式: ロープ → 地図 → ヘッドライト の順に作る（Progress が参照する） */
    this.rope = ESCAPE.Rope ? new ESCAPE.Rope(this) : null;
    this.minimap = ESCAPE.Minimap ? new ESCAPE.Minimap(this) : null;
    this.headlight = ESCAPE.Headlight ? new ESCAPE.Headlight(this) : null;
    this.progress = ESCAPE.Progress ? new ESCAPE.Progress(this) : { flags: {} };
    /* 起動時1回だけ: セーブがあればチェックポイント位置・仕掛け進行を復元する
       （g.reset() は機械テストの製品初期状態復帰であり、ここでは呼ばない＝
       セーブの読み込みは「本当の起動」でしか起きない） */
    if (this.progress.load) this.progress.load();

    this.dom = {
      root: document.body,
      stickBase: document.getElementById('stick-base'),
      stickKnob: document.getElementById('stick-knob'),
      btnRun: document.getElementById('btn-run'),
      btnCrouch: document.getElementById('btn-crouch'),
      btnInteract: document.getElementById('btn-interact'),
      debug: document.getElementById('debug'),
      orientation: document.getElementById('orientation')
    };

    this.input = new ESCAPE.Input({ dom: this.dom, canvas: this.canvas });

    global.addEventListener('resize', function () { self.resize(); });
    global.addEventListener('orientationchange', function () { self.resize(); });
    this.resize();
    this.syncCamera();
    this.updateChrome();

    this.running = true;
    this._last = (global.performance ? performance.now() : Date.now());
    this._loop = function (t) {
      if (!self.running) return;
      global.requestAnimationFrame(self._loop);
      self.tick(t);
    };
    global.requestAnimationFrame(this._loop);
    return this;
  };

  Game.prototype.resize = function () {
    var w = global.innerWidth || this.canvas.clientWidth || 1;
    var h = global.innerHeight || this.canvas.clientHeight || 1;
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    this.viewW = w; this.viewH = h;
    /* updateStyle=true が必須。canvas は置換要素なので inset:0 だけでは
       CSSサイズが決まらず、devicePixelRatio>1 の端末で描画面が画面より大きくなる。 */
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateChrome();
  };

  /** 端末種別・向きに応じたUIの出し分け（縦持ち警告 / タッチ操作系の表示） */
  Game.prototype.updateChrome = function () {
    var touchLike = (navigator.maxTouchPoints > 0) || ('ontouchstart' in global) ||
      (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) ||
      (this.input && this.input.touchSeen);
    var portrait = (this.viewH || 0) > (this.viewW || 0);
    document.body.classList.toggle('touch', !!touchLike);
    document.body.classList.toggle('portrait-warn', !!touchLike && portrait);
  };

  /** rAFループ本体（実時間を固定ステップに割る） */
  Game.prototype.tick = function (t) {
    var now = (typeof t === 'number') ? t : (global.performance ? performance.now() : Date.now());
    var dt = (now - this._last) / 1000;
    this._last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    this._accum += dt;
    var guard = 0;
    while (this._accum >= FIXED_DT && guard++ < 8) {
      this.stepFrame(FIXED_DT);
      this._accum -= FIXED_DT;
    }
    this.render();
  };

  /** 1論理ステップ。__pump もrAFループもここを通る */
  Game.prototype.stepFrame = function (dt) {
    var input = this.input;
    /* メモ・テンキーが開いている間は「中断安全」= 視点・移動を止める
       （敵AI・音イベントは止めない＝メモを読んでいる間に敵が接近する状況を再現できる。
       捕獲そのものは Stealth.hidden() 側で無効化する＝P4） */
    var modal = this.progress && this.progress.modalOpen && this.progress.modalOpen();
    /* P4.6: 捕獲シネマティック中も同じ「中断安全」に乗せる＝視点・移動を止める。
       （演出カメラをプレイヤー追従が上書きしないよう、カメラ側も syncCamera の最後で握る） */
    var frozen = modal || !!(this.cinematic && this.cinematic.blocksInput());

    // 1) 視点
    var look = input.consumeLook();
    if (!frozen) this.player.applyLook(look.dx, look.dy, ESCAPE.Input.LOOK_SENS);

    // 2) 移動
    /* P4.8: ロープの張り判定は「移動前の座標」を必要とする。ここで1回だけ控える。 */
    var prevX = this.player.x, prevZ = this.player.z;
    if (!frozen) {
      this.player.step(dt, {
        moveX: input.moveX,
        moveY: input.moveY,
        run: input.isRunning(),
        crouch: input.crouchOn
      });
    } else {
      this.player.speed = 0;
    }
    /* 2') ロープ（契約 §4「余裕0で前進不可」）。移動制限を判断するのはここだけ＝
       以降のモジュールはプレイヤー位置を書き換えない（上書き事故の防止）。 */
    if (this.rope) this.rope.update(dt, prevX, prevZ);

    // 3) 調べる（ロッカー・板・牢の格子はP3b／メモ・仕掛け・出口はP4が先に受ける）
    var n = input.consumeInteract();
    for (var i = 0; i < n; i++) {
      this.stats.interacts++;
      var handled = this.progress ? this.progress.onInteract() : false;
      if (!handled) handled = this.stealth ? this.stealth.onInteract() : false;
      if (!handled && global.console && console.log) {
        console.log('[ESCAPE] interact: cell(' + this.player.col() + ',' + this.player.row() + ') pos(' +
          this.player.x.toFixed(2) + ',' + this.player.z.toFixed(2) + ')');
      }
    }

    this.simTime += dt;
    this.frameCount++;

    // 4) ステルス機構（音イベント発生・ロッカー・牢）→ 敵AI → 進行(P4) の順で更新する。
    //    プレイヤーの移動結果を見てから敵が知覚するため、同フレームの音も拾える。
    if (this.stealth) this.stealth.step(dt);
    /* P4.10b: 音の罠（空き缶・軋む床板・ワイヤー・倒れかけの什器）。
       Stealth（音地盤・センサー）と同じく「敵が知覚する前」に鳴らす＝同フレームで伝わる。 */
    if (this.traps) this.traps.step(dt);
    if (this.ai) this.ai.step(dt);
    if (this.progress) this.progress.step(dt);
    /* P4.8: ロープの明滅と fog of war の記録（地図は「変わった時だけ」描き直す） */
    if (this.rope) this.rope.step(dt);
    if (this.minimap) this.minimap.step(dt);

    /* 蛍光灯のチラつき（ゲーム内時刻駆動＝__pumpでも同じ絵になる） */
    if (this.world && this.world.update) this.world.update(this.simTime);
    /* 5) 音響ディレクタ＋恐怖演出（P4.5）。世界の更新後＝明滅レベルが確定してから */
    if (ESCAPE.audio && ESCAPE.audio.step) ESCAPE.audio.step(dt);
    this.syncCamera();
    /* 6) ヘッドライト（契約 §4）。カメラが確定してから前に置く。
       点灯判定を持つのはこのモジュールだけで、敵AIは sightRange() で読むだけ。 */
    if (this.headlight) this.headlight.step(dt);
  };

  /** カメラ揺れの一時受け（毎フレームの生成を避ける） */
  var SHAKE = { pitch: 0, yaw: 0, roll: 0 };

  Game.prototype.syncCamera = function () {
    var p = this.player;
    var au = ESCAPE.audio;
    var s = SHAKE;
    s.pitch = 0; s.yaw = 0; s.roll = 0;
    if (au && au.cameraShake) au.cameraShake(s);
    this.camera.position.set(p.x, p.y + p.eyeHeight, p.z);
    this.camera.rotation.set(p.pitch + s.pitch, p.yaw + s.yaw, s.roll);
    /* 追跡中のFOV微増（契約 §4「恐怖演出（軽量）」）。変化した時だけ行列を作り直す */
    var want = BASE_FOV + ((au && au.fx) ? au.fx.fovAdd : 0);
    /* P4.6: 捕獲シネマティックは「最後」にカメラを握る（上書き事故の防止）。
       演出が終われば want は BASE_FOV に戻る＝ FOV も自動で復帰する。 */
    var cine = this.cinematic;
    if (cine && cine.active()) {
      cine.applyCamera(this.camera);
      if (cine.fov > 0) want = cine.fov;
    }
    if (Math.abs(this.camera.fov - want) > 0.0008) {
      this.camera.fov = want;
      this.camera.updateProjectionMatrix();
    }
  };

  Game.prototype.render = function () {
    this.updateChrome();
    this.updateDebug();
    this.renderer.render(this.scene, this.camera);
    this.renderCount++;
  };

  Game.prototype.updateDebug = function () {
    var el = this.dom.debug;
    if (!el) return;
    var p = this.player;
    var w = this.world && this.world.stats;
    var ai = this.ai, st = this.stealth;
    el.textContent =
      'ESCAPE P3b / ' + this.map.name + '\n' +
      'cell (' + p.col() + ',' + p.row() + ')  pos ' + p.x.toFixed(2) + ', ' + p.z.toFixed(2) +
        '  floorY ' + p.y.toFixed(2) + '\n' +
      'yaw ' + (p.yaw * 180 / Math.PI).toFixed(0) + '°  ' + p.mode + '  ' + p.speed.toFixed(2) + ' m/s' +
      (w ? ('\ntri ' + w.triangles + '  draw ' + this.renderer.info.render.calls +
            '  灯 ' + w.fixtures + '  build ' + w.buildMs.toFixed(0) + 'ms') : '') +
      (ai ? ('\n敵 ' + ai.state + '/' + ai.form + '  d ' +
             Math.hypot(ai.enemy.x - p.x, ai.enemy.z - p.z).toFixed(1) + 'm  視界 ' +
             ai.sightRange(p).toFixed(1) + 'm  ' + (ai.sees ? '発見中' : '未発見')) : '') +
      (st ? ('\n牢 ' + st.jail.phase + '  捕獲' + st.captures + '  ' +
             (st.inLocker() ? 'ロッカー内' : '—') +
             (this.cinematic && this.cinematic.active()
               ? ('  演出 ' + this.cinematic.mode + '/' + this.cinematic.stage) : '')) : '') +
      (this.progress && this.progress.gimmick ? ('\n鍵' + (this.progress.gimmick.key ? '○' : '×') +
             '  隔壁' + (this.progress.gimmick.doorOpen ? '開' : '施錠') +
             '  CP:' + (this.progress.checkpoint || '—')) : '') +
      (this.rope ? ('\nロープ ' + this.rope.used.toFixed(0) + '/' + this.rope.L.toFixed(0) + 'm  余裕 ' +
             this.rope.slack().toFixed(0) + 'm' + (this.rope.isAttached() ? '' : ' [外れている]') +
             (this.rope.taut ? '  張った' : '')) : '') +
      (this.minimap ? ('  踏破 ' + this.minimap.exploredCount) : '') +
      (this.headlight ? ('  ライト' + (this.headlight.on ? '点' : '消')) : '');
  };

  /** 製品初期状態へ完全復帰（runAll の後始末にも使う） */
  Game.prototype.reset = function () {
    this.map = ESCAPE.Maps.load(this.mapId);
    if (this.world) this.world.dispose();
    this.world = new ESCAPE.World(this.map);
    this.scene.add(this.world.group);
    this.player.map = this.map;
    this.player.reset();
    this.input.reset();
    this.stats.interacts = 0;
    this.simTime = 0;
    this.frameCount = 0;
    this._accum = 0;
    this._last = (global.performance ? performance.now() : Date.now());
    /* P3b/P4: 進行状態・音イベント・ステルス・敵AI も製品初期状態へ戻す
       （progress → stealth → ai の順。ai.reset は新しい map/world を参照する） */
    /* P4.8: ロープ・地図・ヘッドライトも新しい map を掴み直して初期状態へ */
    if (this.rope) this.rope.reset();
    if (this.minimap) this.minimap.reset();
    if (this.headlight) this.headlight.reset();
    if (this.progress) this.progress.reset(); else this.progress = { flags: {} };
    /* P4.10b: 罠の造形は world の焼き込み照明を読むので、world の作り直しより後に張り直す */
    if (this.traps) this.traps.reset();
    if (ESCAPE.noise) ESCAPE.noise.reset();
    if (this.stealth) this.stealth.reset();
    if (this.ai) this.ai.reset();
    /* P4.5: 音響ディレクタ・恐怖演出も初期状態へ（連続音の鳴りっぱなしを止める） */
    if (ESCAPE.audio && ESCAPE.audio.reset) ESCAPE.audio.reset();
    this.syncCamera();
    this.updateChrome();
    return this;
  };

  ESCAPE.Game = Game;
  ESCAPE.FIXED_DT = FIXED_DT;

  function boot() {
    var g = new Game();
    ESCAPE.game = g;
    g.init();

    /* 契約 §6: 手動フレーム駆動（更新＋描画ワンセット） */
    global.__pump = function (n) {
      var count = (n === undefined) ? 1 : (n | 0);
      for (var i = 0; i < count; i++) {
        g.stepFrame(FIXED_DT);
        g.render();
      }
      return g.frameCount;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
