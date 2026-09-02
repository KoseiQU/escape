/* ESCAPE — P4.8 ヘッドライト（腰のライト）
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」＞ヘッドライト
 *   - 歩行・走行中のみ自動点灯（停止・しゃがみで消灯）。
 *   - 前方約4mの弱い円錐光。
 *   - 点灯中は敵の発見距離が 1.5倍（ENEMY_TUNING.headlightSightMul）。
 *   docs/notes.md memo5「歩けば点く。止まれば消える。—— 点けたまま奴の前に出るな。」
 *
 * 実装方針: 世界の陰影は頂点色に焼き込んであり実ライトは0本（契約 §2）。
 * そこでライトの代わりに **加算合成の円錐メッシュ＋足元の光溜まり** を毎フレーム
 * カメラの前に置く。ジオメトリは起動時に1回だけ作り、行列と材質色だけ更新する。
 *
 * 「Aが状態設定→Bの毎フレーム更新が上書き」回帰への予防:
 *   点灯判定を持つのはこのモジュールだけ（唯一の真実）。敵AIは sightRange() で
 *   game.headlight.on を**読むだけ**。逆向きの書き込みは無い。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  var HEADLIGHT_TUNING = {
    range: 4.0,          /* 円錐の長さ(m)。契約「前方約4m」 */
    radius: 1.45,        /* 先端の半径(m) */
    poolDist: 2.10,      /* 足元の光溜まりの中心までの距離(m) */
    poolRadius: 1.30,    /* 光溜まりの半径(m) */
    coneGain: 0.085,     /* 円錐（空気中のうっすらした帯）の強さ。契約「弱い光」 */
    poolGain: 0.30,      /* 光溜まりの強さ */
    fade: 6.5,           /* 点灯・消灯の追従レート(1/s) */
    moveThreshold: 0.30  /* この速度(m/s)以上で「歩いている」 */
  };
  var TINT = [1.00, 0.93, 0.78];   /* 弱い電球色 */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function Headlight(game) {
    this.game = game;
    this.T = HEADLIGHT_TUNING;
    this.group = new THREE.Group();
    this.group.name = 'headlight';
    if (game.scene) game.scene.add(this.group);
    this._build();
    this.reset();
  }

  Headlight.prototype.reset = function () {
    this.on = false;
    this.level = 0;
    this._apply();
  };

  Headlight.prototype._build = function () {
    var T = this.T;
    /* --- 円錐（頂点＝カメラ、先端＝前方 range m）。頂点色で先細りに減衰させる --- */
    var N = 20;
    var pos = [], col = [], idx = [];
    /* 頂点はカメラの直前。画面中央が白く飛ばないよう頂点色を抑える */
    pos.push(0, 0, -0.35); col.push(TINT[0] * 0.55, TINT[1] * 0.55, TINT[2] * 0.55);
    for (var i = 0; i <= N; i++) {
      var a = i / N * Math.PI * 2;
      pos.push(Math.cos(a) * T.radius, Math.sin(a) * T.radius * 0.72, -T.range);
      col.push(0, 0, 0);
    }
    for (var j = 1; j <= N; j++) idx.push(0, j, j + 1);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    this._coneGeo = geo;
    this._coneMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    this.cone = new THREE.Mesh(geo, this._coneMat);
    this.cone.frustumCulled = false;
    this.group.add(this.cone);

    /* --- 足元の光溜まり（床に落ちる楕円）。中心が明るく縁で消える --- */
    var M = 22;
    var p2 = [0, 0, 0], c2 = [TINT[0] * 0.85, TINT[1] * 0.85, TINT[2] * 0.85], i2 = [];
    for (var k = 0; k <= M; k++) {
      var b = k / M * Math.PI * 2;
      p2.push(Math.cos(b) * T.poolRadius, 0, Math.sin(b) * T.poolRadius * 1.30);
      c2.push(0, 0, 0);
    }
    for (var m = 1; m <= M; m++) i2.push(0, m, m + 1);
    var geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
    geo2.setAttribute('color', new THREE.Float32BufferAttribute(c2, 3));
    geo2.setIndex(i2);
    this._poolGeo = geo2;
    this._poolMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    this.pool = new THREE.Mesh(geo2, this._poolMat);
    this.pool.frustumCulled = false;
    this.group.add(this.pool);
  };

  /** 点灯条件（唯一の判定箇所） */
  Headlight.prototype._want = function () {
    var g = this.game, p = g.player;
    if (g.progress && g.progress.modalOpen && g.progress.modalOpen()) return false;
    if (g.cinematic && g.cinematic.active()) return false;
    if (g.stealth && (g.stealth.inLocker() || g.stealth.jail.phase !== 'none')) return false;
    if (p.crouching) return false;               /* しゃがみで消灯 */
    return p.speed >= this.T.moveThreshold;      /* 歩行・走行中のみ点灯 */
  };

  Headlight.prototype.step = function (dt) {
    this.on = this._want();
    var want = this.on ? 1 : 0;
    this.level += (want - this.level) * clamp(this.T.fade * dt, 0, 1);
    if (this.level < 0.002) this.level = 0;
    this._place();
    this._apply();
  };

  Headlight.prototype._place = function () {
    var g = this.game, p = g.player, cam = g.camera;
    if (cam) {
      this.cone.position.copy(cam.position);
      this.cone.quaternion.copy(cam.quaternion);
    } else {
      this.cone.position.set(p.x, p.y + p.eyeHeight, p.z);
    }
    /* 光溜まりは視線のピッチに関係なく「足元の前方」に置く */
    var f = p.forward();
    var px = p.x + f.x * this.T.poolDist, pz = p.z + f.z * this.T.poolDist;
    this.pool.position.set(px, this.game.map.floorYAt(px, pz) + 0.03, pz);
    this.pool.rotation.y = p.yaw;
  };

  Headlight.prototype._apply = function () {
    var lv = this.level;
    this._coneMat.opacity = lv * this.T.coneGain;
    this._poolMat.opacity = lv * this.T.poolGain;
    var vis = lv > 0.004;
    if (this.cone.visible !== vis) this.cone.visible = vis;
    if (this.pool.visible !== vis) this.pool.visible = vis;
  };

  Headlight.prototype.dispose = function () {
    if (this._coneGeo) this._coneGeo.dispose();
    if (this._poolGeo) this._poolGeo.dispose();
    if (this._coneMat) this._coneMat.dispose();
    if (this._poolMat) this._poolMat.dispose();
  };

  Headlight.prototype.info = function () {
    return { on: this.on, level: this.level, mul: ESCAPE.ENEMY_TUNING.headlightSightMul };
  };

  ESCAPE.Headlight = Headlight;
  ESCAPE.HEADLIGHT_TUNING = HEADLIGHT_TUNING;

  global.__lightDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.headlight; },
    info: function () {
      var h = ESCAPE.game && ESCAPE.game.headlight;
      return h ? h.info() : null;
    }
  };
})(window);
