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

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
    this.camera.rotation.order = 'YXZ';

    this.map = ESCAPE.Maps.load(this.mapId);
    this.world = new ESCAPE.World(this.map);
    this.scene.add(this.world.group);

    this.player = new ESCAPE.Player(this.map);

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

    // 1) 視点
    var look = input.consumeLook();
    this.player.applyLook(look.dx, look.dy, ESCAPE.Input.LOOK_SENS);

    // 2) 移動
    this.player.step(dt, {
      moveX: input.moveX,
      moveY: input.moveY,
      run: input.isRunning(),
      crouch: input.crouchOn
    });

    // 3) 調べる（ロッカー・板・牢の格子はP3b、メモ・仕掛けはP4）
    var n = input.consumeInteract();
    for (var i = 0; i < n; i++) {
      this.stats.interacts++;
      var handled = this.stealth ? this.stealth.onInteract() : false;
      if (!handled && global.console && console.log) {
        console.log('[ESCAPE] interact: cell(' + this.player.col() + ',' + this.player.row() + ') pos(' +
          this.player.x.toFixed(2) + ',' + this.player.z.toFixed(2) + ')');
      }
    }

    this.simTime += dt;
    this.frameCount++;

    // 4) ステルス機構（音イベント発生・ロッカー・牢）→ 敵AI の順で更新する。
    //    プレイヤーの移動結果を見てから敵が知覚するため、同フレームの音も拾える。
    if (this.stealth) this.stealth.step(dt);
    if (this.ai) this.ai.step(dt);

    /* 蛍光灯のチラつき（ゲーム内時刻駆動＝__pumpでも同じ絵になる） */
    if (this.world && this.world.update) this.world.update(this.simTime);
    this.syncCamera();
  };

  Game.prototype.syncCamera = function () {
    var p = this.player;
    this.camera.position.set(p.x, p.y + p.eyeHeight, p.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0);
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
             (st.inLocker() ? 'ロッカー内' : '—')) : '');
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
    /* P3b: 進行状態・音イベント・ステルス・敵AI も製品初期状態へ戻す
       （stealth → ai の順。ai.reset は新しい map/world を参照する） */
    this.progress = { flags: {} };
    if (ESCAPE.noise) ESCAPE.noise.reset();
    if (this.stealth) this.stealth.reset();
    if (this.ai) this.ai.reset();
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
