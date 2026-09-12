/* ESCAPE — 一人称プレイヤー制御とグリッド衝突
 * 歩き / 走り（押下中）/ しゃがみ（トグル・視点低下＋減速）。
 * 衝突は「円 vs グリッドの実体セル」。軸分離で解決するため壁ずり移動になる。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var SPEED_WALK = 2.6;    // m/s
  var SPEED_RUN = 4.6;     // m/s
  var SPEED_CROUCH = 1.25; // m/s
  /* P5 エリア2: 水路（TILE.WATER）の上は遅くなり、走れない（DESIGN.md §4「P5」／
     docs/notes.md「水の中では走れない」）。HUD の一度きりの案内は js/progress.js が出す。 */
  var WATER_SPEED_MUL = 0.75;
  var RADIUS = 0.32;       // m（通路幅2mに対して余裕あり）
  var EYE_STAND = 1.62;    // m
  var EYE_CROUCH = 0.95;   // m
  var EYE_LERP = 12.0;     // 1/s（しゃがみ切替の視点補間レート）
  var PITCH_LIMIT = 1.48;  // rad（約85度）

  function Player(map) {
    this.map = map;
    this.radius = RADIUS;
    this.x = 0; this.z = 0;
    /** 足元の床の高さ(m)。マップの floorYAt に追従する（落下・跳躍は無い） */
    this.y = 0;
    this.yaw = 0; this.pitch = 0;
    this.crouching = false;
    this.eyeHeight = EYE_STAND;
    this.speed = 0;          // 直近フレームの実速度(m/s)
    this.mode = 'walk';      // 'walk' | 'run' | 'crouch'
    /* P5: 直近フレームで水路の上に居たか（HUD案内・機械テストが読む） */
    this.inWater = false;
    this.reset();
  }

  Player.prototype.reset = function () {
    var sp = (this.map.meta && this.map.meta.spawn) || { col: 1, row: 1, yawDeg: 180 };
    var c = this.map.cellCenter(sp.col, sp.row);
    this.x = c.x; this.z = c.z;
    this.y = this.map.floorYAt(this.x, this.z);
    this.yaw = (sp.yawDeg || 0) * Math.PI / 180;
    this.pitch = 0;
    this.crouching = false;
    this.eyeHeight = EYE_STAND;
    this.speed = 0;
    this.mode = 'walk';
    this.inWater = false;
  };

  /** そのマスが水路（TILE.WATER）か。タイルが無い構成（P4以前）では常に false */
  Player.prototype.isWaterCell = function (col, row) {
    var T = ESCAPE.TILE;
    if (!T || T.WATER === undefined) return false;
    return this.map.tileAt(col, row) === T.WATER;
  };
  /** いま立っているマスが水路か */
  Player.prototype.inWaterNow = function () {
    return this.isWaterCell(this.col(), this.row());
  };

  /** yaw から前方ベクトル（Three.jsの既定: yaw=0 で -Z を向く） */
  Player.prototype.forward = function () {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  };
  Player.prototype.right = function () {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  };

  Player.prototype.col = function () { return this.map.colOf(this.x); };
  Player.prototype.row = function () { return this.map.rowOf(this.z); };

  /** 半径rの円が(x,z)にあるとき、実体セルと重なるか */
  Player.prototype.collidesAt = function (x, z, r) {
    var map = this.map, T = map.tileSize;
    if (r === undefined) r = this.radius;
    var c0 = Math.floor((x - r) / T), c1 = Math.floor((x + r) / T);
    var r0 = Math.floor((z - r) / T), r1 = Math.floor((z + r) / T);
    for (var row = r0; row <= r1; row++) {
      for (var col = c0; col <= c1; col++) {
        if (!map.isSolid(col, row)) continue;
        var minX = col * T, maxX = minX + T;
        var minZ = row * T, maxZ = minZ + T;
        var qx = x < minX ? minX : (x > maxX ? maxX : x);
        var qz = z < minZ ? minZ : (z > maxZ ? maxZ : z);
        var dx = x - qx, dz = z - qz;
        if (dx * dx + dz * dz < r * r - 1e-12) return true;
      }
    }
    return false;
  };

  /** 軸分離＋細分の移動。壁抜けなし・壁ずりあり */
  Player.prototype.moveBy = function (dx, dz) {
    var len = Math.hypot(dx, dz);
    if (len < 1e-9) return;
    var steps = Math.max(1, Math.ceil(len / (this.radius * 0.5)));
    var sx = dx / steps, sz = dz / steps;
    for (var i = 0; i < steps; i++) {
      var nx = this.x + sx;
      if (!this.collidesAt(nx, this.z)) this.x = nx;
      var nz = this.z + sz;
      if (!this.collidesAt(this.x, nz)) this.z = nz;
    }
    /* 床高さへ追従。衝突は水平2Dのままなので、坂でも壁抜けの挙動は変わらない */
    this.y = this.map.floorYAt(this.x, this.z);
  };

  /** 目の高さ（ワールドY）。カメラはこれを使う */
  Player.prototype.eyeY = function () { return this.y + this.eyeHeight; };

  /** 視点デルタ(px)を角度に反映 */
  Player.prototype.applyLook = function (dxPx, dyPx, sens) {
    if (!isFinite(dxPx) || !isFinite(dyPx)) return;
    this.yaw -= dxPx * sens;
    this.pitch -= dyPx * sens;
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    // yaw を -PI..PI に正規化（長時間プレイでの精度劣化防止）
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  };

  /**
   * 1ステップ更新。
   * cmd = { moveX, moveY, run:bool, crouch:bool }
   */
  Player.prototype.step = function (dt, cmd) {
    this.crouching = !!cmd.crouch;
    var target = this.crouching ? EYE_CROUCH : EYE_STAND;
    var k = 1 - Math.exp(-EYE_LERP * dt);
    this.eyeHeight += (target - this.eyeHeight) * k;

    var mx = cmd.moveX || 0, my = cmd.moveY || 0;
    var mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; mag = 1; }

    /* P5: 水路の上は走行不可＋速度 x0.75。走るトグル／Shift長押しの状態は変えず、
       「効かない」だけにする（水から出れば元どおり走り出す）。 */
    var wet = this.inWaterNow();
    this.inWater = wet;

    var speed;
    if (this.crouching) { speed = SPEED_CROUCH; this.mode = 'crouch'; }
    else if (cmd.run && !wet) { speed = SPEED_RUN; this.mode = 'run'; }
    else { speed = SPEED_WALK; this.mode = 'walk'; }
    if (wet) speed *= WATER_SPEED_MUL;

    if (mag < 1e-6) { this.speed = 0; return; }

    var f = this.forward(), r = this.right();
    var vx = (r.x * mx + f.x * my) * speed * mag;
    var vz = (r.z * mx + f.z * my) * speed * mag;

    var px = this.x, pz = this.z;
    this.moveBy(vx * dt, vz * dt);
    this.speed = Math.hypot(this.x - px, this.z - pz) / dt;
  };

  Player.SPEED_WALK = SPEED_WALK;
  Player.SPEED_RUN = SPEED_RUN;
  Player.SPEED_CROUCH = SPEED_CROUCH;
  Player.WATER_SPEED_MUL = WATER_SPEED_MUL;
  Player.EYE_STAND = EYE_STAND;
  Player.EYE_CROUCH = EYE_CROUCH;
  Player.RADIUS = RADIUS;
  Player.PITCH_LIMIT = PITCH_LIMIT;
  ESCAPE.Player = Player;
})(window);
