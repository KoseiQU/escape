/* ESCAPE — 敵AI・ステルス機構（P3b / 契約 DESIGN.md §4）
 *
 * 構成:
 *   ENEMY_TUNING … バランス定数を1オブジェクトに集約（P4の通し調整はここだけ触る）
 *   ESCAPE.noise  … 音イベントバス（イベント駆動。常時音量シミュレーションはしない）
 *                   ESCAPE.noise.emit(x, z, radius, kind) が P4 のギミック音用API。
 *   EnemyAI       … 巡回 / 調査 / 追跡 / 探索 / 足止め / 捕獲 の状態機械＋視界判定＋経路探索
 *   Stealth       … プレイヤー側（ロッカー・板・音地盤・センサー・牢送り・HUD）
 *
 * 上書き事故の防止:
 *   - 形態遷移中（enemy.state === 'trans'）は AI が enemy.state / poseT を触らない。
 *     形態は setForm() 経由のみ。毎フレームの anim 指定は遷移が終わってから行う。
 *   - __enemyDebug がモデルを直接操作する間は ai.manual = true になり AI は駆動を止める。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* ================================================================
   * バランス定数（契約 §4 の初期値。P4で通し調整するのでここに集約）
   * ============================================================== */
  var ENEMY_TUNING = {
    /* 速度(m/s) */
    patrolSpeed: 1.60,        // 巡回（ゆっくり歩く）
    /* P4.6（契約 §4「音→敵が飛んでくる」）: 調査は「歩いて見に行く」を廃止し、
       その場で反転形態に落ちて音源へ疾走する。追跡よりごく僅かに遅いだけ。 */
    investigateSpeed: 5.00,   // 調査（音源へ疾走する）
    searchSpeed: 2.20,        // 探索（見失った周辺を探す）
    chaseSpeed: 5.20,         // 追跡（プレイヤー走り4.6より速い）
    lockerHuntSpeed: 5.00,    // P4.6: 見られたロッカーへ向かう（疾走）
    transMoveScale: 0.15,     // 形態遷移中はほぼ止まる（倒れ込みの見せ場）

    /* 視界 */
    fovDeg: 110,              // 視野角（全角）
    sightLit: 12.0,           // 明所の発見距離(m)
    sightDark: 5.0,           // 暗所の発見距離(m)
    crouchFactor: 0.40,       // しゃがみ中の倍率
    lumDark: 0.030,           // これ以下の輝度は「暗所」
    lumLit: 0.170,            // これ以上の輝度は「明所」（間は線形）
                              // area1実測: 歩行可能マスの輝度中央値0.073・p90=0.53。
                              // 闇だまり/漆黒区画は0.014前後で暗所5mに張り付く。
    losStep: 0.35,            // 遮蔽レイキャストのサンプル間隔(m)

    /* 状態遷移 */
    loseSightGrace: 1.20,     // 見失ってすぐは追い続ける(s)
    giveUpDist: 6.0,          // 見失い＋この距離が開いたら探索へ(m)
    giveUpTime: 3.00,         // 距離が開かなくてもこの時間で探索へ(s)
    searchDur: 8.00,          // 探索の持続 → 巡回へ復帰（直立へ戻る）(s)
    investigateLook: 4.00,    // 調査地点に着いてから見回す時間(s)
    lookSweep: 1.15,          // 見回しの振れ幅(rad)
    catchDist: 1.05,          // 捕獲の接触距離(m)
    turnRate: 3.40,           // 旋回(rad/s)
    turnRateChase: 6.00,
    repathInterval: 0.50,     // 経路再計算(s)
    arriveDist: 0.55,         // 目的地到達とみなす距離(m)
    radius: 0.45,             // 経路の見通し判定に使う体の半径(m)

    /* 音イベントの到達半径(m) */
    runNoiseRadius: 18.0,     // 音地盤を走って踏む
    sensorNoiseRadius: 40.0,  // センサー警報
    gimmickNoiseRadius: 30.0, // 仕掛け解除音（P4用の既定値）
    hearMax: 48.0,            // これ以上遠い音は無条件に無視

    /* ステルス機構 */
    /* P4.6（契約 §4「板: 足止め時間を延長」）: 6.00 → 9.00。
       敵が疾走で来るようになったぶん、板1枚で「逃げ切れる」時間を確保する。 */
    boardStallDur: 9.00,      // 板に引っかかって足止めされる時間(s)
    lockerRange: 2.40,        // ロッカーに「調べる」が届く距離(m)
    lockerYawLimit: 0.95,     // ロッカー内で振り向ける角度(rad)
    boardRange: 2.60,         // 板に「調べる」が届く距離(m)
    interactDot: 0.20,        // 対象が視線の前方にある判定（cos）
    /* P4.6 ロッカーの駆け引き（契約 §4） */
    lockerOpenDist: 2.30,     // ロッカーの扉に手が届く距離(m)。隣接マス中心=2m
    lockerHuntTimeout: 14.0,  // 辿り着けない時に諦める(s)
    lockerPeekChance: 0.55,   // 探索中に近くのロッカーを1つ覗く確率
    lockerPeekRadius: 9.0,    // 覗く対象を探す半径(m)

    /* 牢送り */
    captureLimit: 3,          // 同一エリアN回目の捕獲でエリア最初から
    grabDur: 0.70,            // 捕まって暗転しきるまで(s)
    blackDur: 1.10,           // 完全な暗転(s)
    wakeDur: 1.20,            // 明転(s)
    pryPerPress: 0.34,        // 「調べる」1回ぶんの格子こじ開け
    pryHoldRate: 0.55,        // 長押し(1/s)
    pryDecay: 0.10,           // 手を止めると戻る(1/s)

    /* 巡回のランダム停止（P4.5 恐怖演出）。
       通路の先で立ち止まる個体を「目撃」する状況を自然に発生させる。
       最初の停止は必ず firstPause 秒より後（機械テストの巡回移動判定を壊さないため） */
    patrolPauseFirst: 7.0,    // 巡回開始から最初に止まりうるまで(s)
    patrolPauseGap: 11.0,     // 停止後、次に止まりうるまでの最短(s)
    patrolPauseVar: 9.0,      // 上記に足す振れ幅(s)
    patrolPauseDur: 2.6,      // 停止の長さ(s)
    patrolPauseDurVar: 2.2,

    /* ---- P4.6 捕獲シネマティック（契約 §4「捕獲演出と駆け引き」。合計7〜9秒） ---- */
    cineZoomDur: 0.40,        // 1 追いつき: 顔へ強制ズーム
    cineGrabDur: 2.00,        // 2 首掴み
    cineDragDur: 3.50,        // 3 引きずり
    cineBlackDur: 1.50,       // 4 暗転（牢扉→鍵）
    cineMawDur: 1.80,         // 3'（3回目）食われる
    cineEatBlackDur: 1.20,    // 4'（3回目）暗転 → ゲームオーバー画面
    cineFaceDist: 0.95,       // 捕獲時に敵を据える距離(m)
    cineZoomEnd: 0.55,        // 顔とカメラの距離(m)
    cineZoomFov: 46,          // ズーム後のFOV(deg)
    cineMawDist: 0.30,        // 食われる直前の顔との距離(m)
    cineDragSpeed: 2.30,      // 引きずられる見かけの速度(m/s)
    cineDragEye: 0.26,        // 床すれすれの視点高(m)
    cineDragLead: 2.20,       // 引きずる敵が頭側に立つ距離(m)。見上げた画角の端に入る値
    cineShake: 0.030,         // 揺れの基準振幅(rad)
    cineMashGain: 1.10,       // 連打で増える揺れの倍率（結果は変わらない）
    cineMashMax: 14,          // 連打の効き上限（回）
    cineFadeIn: 0.34          // 暗転の落ちきり時間(s)
  };

  /** 音響フックの共通口。音響モジュールが無くても落ちない */
  function sfx(name, p) {
    if (ESCAPE.audio && ESCAPE.audio.event) ESCAPE.audio.event(name, p);
  }

  /* ロッカー内の目線を扉のどれだけ内側に置くか(m)。
     world._locker の箱（奥行0.58・前面から0.12突出）の内側に入る値。 */
  var LOCKER_EYE_INSET = 0.17;

  /* ---------------- 小物 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function forwardOf(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
  function angNorm(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  /** 進行方向ベクトルから facing(yaw) を得る（forward = (-sin, -cos)） */
  function yawOf(dx, dz) { return Math.atan2(-dx, -dz); }

  /* ================================================================
   * 音イベントバス（契約 §4「音システム（イベント駆動）」）
   *   ESCAPE.noise.emit(x, z, radius, kind)  … 世界座標で1発鳴らす
   *   ESCAPE.noise.emitCell(col, row, ...)   … マス指定
   * 敵は step の頭で consume() して聞き取り判定する。
   * ============================================================== */
  function NoiseBus() { this.reset(); }
  NoiseBus.prototype.emit = function (x, z, radius, kind) {
    var ev = {
      x: x, z: z,
      radius: (typeof radius === 'number' && radius > 0) ? radius : ENEMY_TUNING.gimmickNoiseRadius,
      kind: kind || 'gimmick',
      id: ++this.count
    };
    this.pending.push(ev);
    this.last = ev;
    return ev;
  };
  NoiseBus.prototype.emitCell = function (col, row, radius, kind) {
    var map = ESCAPE.game && ESCAPE.game.map;
    var T = map ? map.tileSize : ESCAPE.TILE_SIZE;
    return this.emit((col + 0.5) * T, (row + 0.5) * T, radius, kind);
  };
  NoiseBus.prototype.consume = function () {
    if (!this.pending.length) return EMPTY;
    var p = this.pending;
    this.pending = [];
    return p;
  };
  NoiseBus.prototype.reset = function () {
    this.pending = [];
    this.last = null;
    this.count = 0;
  };
  var EMPTY = [];
  ESCAPE.noise = new NoiseBus();

  /* ================================================================
   * 経路探索（4近傍BFS。55x55=3025マスなので毎回全探索で十分軽い）
   * ============================================================== */
  function Pathfinder(map) {
    this.map = map;
    this.w = map.width; this.h = map.height;
    var n = this.w * this.h;
    this.dist = new Int32Array(n);
    this.prev = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.stamp = 0;
    this.seen = new Int32Array(n);
  }

  /** start から全マスへの距離を張る */
  Pathfinder.prototype.fill = function (c0, r0) {
    var map = this.map, w = this.w, h = this.h;
    this.stamp++;
    var seen = this.seen, dist = this.dist, prev = this.prev, q = this.queue;
    if (!map.isWalkable(c0, r0)) return false;
    var head = 0, tail = 0;
    var s = r0 * w + c0;
    seen[s] = this.stamp; dist[s] = 0; prev[s] = -1;
    q[tail++] = s;
    while (head < tail) {
      var cur = q[head++];
      var cc = cur % w, rr = (cur - cc) / w;
      for (var d = 0; d < 4; d++) {
        var nc = cc + (d === 0 ? 1 : d === 1 ? -1 : 0);
        var nr = rr + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
        var ni = nr * w + nc;
        if (seen[ni] === this.stamp) continue;
        if (!map.isWalkable(nc, nr) || map.isBlocked(nc, nr)) continue;
        /* P4.7: 排水路（しゃがみ専用の細管）には敵は入らない＝裏ルートは追走を回避できる */
        if (map.isCrawl && map.isCrawl(nc, nr)) continue;
        seen[ni] = this.stamp; dist[ni] = dist[cur] + 1; prev[ni] = cur;
        q[tail++] = ni;
      }
    }
    return true;
  };

  /** fill 済みの盤で goal までの経路（マス配列）。到達不能なら最寄りの到達可能マスへ */
  Pathfinder.prototype.pathTo = function (c1, r1) {
    var w = this.w, h = this.h, seen = this.seen, prev = this.prev;
    var gi = r1 * w + c1;
    if (c1 < 0 || r1 < 0 || c1 >= w || r1 >= h || seen[gi] !== this.stamp) {
      /* 到達不能: 目的地に最も近い到達可能マスを選ぶ */
      var best = -1, bestD = Infinity;
      for (var i = 0; i < seen.length; i++) {
        if (seen[i] !== this.stamp) continue;
        var cc = i % w, rr = (i - cc) / w;
        var dd = (cc - c1) * (cc - c1) + (rr - r1) * (rr - r1);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best < 0) return null;
      gi = best;
    }
    var out = [];
    var cur = gi, guard = 0;
    while (cur >= 0 && guard++ < 8192) {
      var c = cur % w;
      out.push({ col: c, row: (cur - c) / w });
      cur = prev[cur];
    }
    out.reverse();
    return out;
  };

  /* ================================================================
   * 敵AI
   * ============================================================== */
  function EnemyAI(game) {
    this.game = game;
    this.T = ENEMY_TUNING;
    this.map = game.map;
    this.enemy = new ESCAPE.Enemy({ seed: 3 });
    this.enemy.group.visible = true;
    game.scene.add(this.enemy.group);
    this.manual = false;          /* __enemyDebug が握っている間は駆動しない */
    this.reset();
  }

  EnemyAI.prototype.reset = function () {
    this.map = this.game.map;
    this.pf = new Pathfinder(this.map);
    this._lum = Object.create(null);
    this._rng = 20260902;
    var meta = this.map.meta || {};
    this.route = meta.patrol || [];
    this.state = 'patrol';
    this.prevState = 'patrol';
    this.stateTime = 0;
    this.routeIdx = 0;
    this.path = null; this.pathI = 0; this.repathT = 0;
    this.goal = null;
    this.lastSeen = null;
    this.lostTime = 0;
    this.stallT = 0;
    this.speed = 0;
    this.arrived = false;
    this.lookT = 0;
    this.lookBase = 0;
    this.form = 'stand';
    this.manual = false;
    this.alerts = 0;
    this.heard = 0;
    this.sees = false;
    /* P4.6: 捕獲シネマティックが敵を握っている間は AI を駆動しない
       （manual は __enemyDebug 専用のまま残す＝役割を混ぜない） */
    this.cine = false;
    this.lockerTarget = null;
    this.lockerOpens = 0;
    this.peekDone = false;
    /* 巡回のランダム停止（P4.5）。pauseNext は「次に止まりうる巡回累積時間」 */
    this.patrolTime = 0;
    this.pauseT = 0;
    this.pauses = 0;
    this.pauseNext = this.T.patrolPauseFirst;

    var sp = meta.enemySpawn || this.route[0] || meta.spawn || { col: 1, row: 1 };
    this.spawn = sp;
    var e = this.enemy;
    e.setForm('stand', true);
    e.poseT = 0;
    e.transTime = 0;
    e.state = 'walk';
    e.placeCell(sp.col, sp.row, (sp.yawDeg === undefined ? 180 : sp.yawDeg), this.map);
    this.routeIdx = this._nearestRouteIdx();
    e.update(0, this.game.simTime);
    e.syncLight(this.game.world, this.map);
  };

  EnemyAI.prototype.rand = function () {
    this._rng = (this._rng * 1103515245 + 12345) & 0x7fffffff;
    return this._rng / 0x7fffffff;
  };

  EnemyAI.prototype._nearestRouteIdx = function () {
    if (!this.route.length) return 0;
    var best = 0, bd = Infinity, e = this.enemy, map = this.map;
    for (var i = 0; i < this.route.length; i++) {
      var c = map.cellCenter(this.route[i].col, this.route[i].row);
      var d = (c.x - e.x) * (c.x - e.x) + (c.z - e.z) * (c.z - e.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  /* ---------------- 明るさ・視界 ---------------- */

  /** マス中心の輝度（world の焼き込みと同じ式）。マス単位でキャッシュ */
  EnemyAI.prototype.luminanceAt = function (x, z) {
    var w = this.game.world, map = this.map;
    var col = map.colOf(x), row = map.rowOf(z);
    var key = col + ',' + row;
    var v = this._lum[key];
    if (v !== undefined) return v;
    v = 1;
    if (w && w._shade && w.lightIndex) {
      var c = map.cellCenter(col, row);
      var owner = w._ownerOf ? w._ownerOf(col, row) : key;
      var out = w._shade(c.x, map.cellFloorY(col, row) + 1.20, c.z, 0, 1, 0, owner, undefined, [0, 0, 0]);
      v = 0.30 * out[0] + 0.59 * out[1] + 0.11 * out[2];
    }
    this._lum[key] = v;
    return v;
  };

  /** いまのプレイヤーに対する発見距離(m)。明暗としゃがみで変わる */
  EnemyAI.prototype.sightRange = function (player) {
    var T = this.T;
    var p = player || this.game.player;
    var lum = this.luminanceAt(p.x, p.z);
    var k = clamp((lum - T.lumDark) / (T.lumLit - T.lumDark), 0, 1);
    var base = T.sightDark + (T.sightLit - T.sightDark) * k;
    if (p.crouching) base *= T.crouchFactor;
    return base;
  };

  /** 2点間にグリッドの実体マスがあるか（両端のマスは無視する） */
  EnemyAI.prototype.blockedLine = function (x0, z0, x1, z1) {
    var map = this.map;
    var dx = x1 - x0, dz = z1 - z0;
    var dist = Math.hypot(dx, dz);
    var steps = Math.ceil(dist / this.T.losStep);
    if (steps < 1) return false;
    var c0 = map.colOf(x0), r0 = map.rowOf(z0);
    var c1 = map.colOf(x1), r1 = map.rowOf(z1);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var c = map.colOf(x0 + dx * t), r = map.rowOf(z0 + dz * t);
      if ((c === c0 && r === r0) || (c === c1 && r === r1)) continue;
      if (map.isSolid(c, r)) return true;
    }
    return false;
  };

  /** 半径ぶんの余裕をみて直進できるか（経路の角丸め用） */
  EnemyAI.prototype._clearLine = function (x0, z0, x1, z1) {
    var map = this.map, r = this.T.radius;
    var dx = x1 - x0, dz = z1 - z0;
    var dist = Math.hypot(dx, dz);
    var steps = Math.ceil(dist / 0.30);
    for (var i = 0; i <= steps; i++) {
      var t = steps ? i / steps : 0;
      var x = x0 + dx * t, z = z0 + dz * t;
      if (map.isSolid(map.colOf(x - r), map.rowOf(z - r))) return false;
      if (map.isSolid(map.colOf(x + r), map.rowOf(z - r))) return false;
      if (map.isSolid(map.colOf(x - r), map.rowOf(z + r))) return false;
      if (map.isSolid(map.colOf(x + r), map.rowOf(z + r))) return false;
    }
    return true;
  };

  /** 視野角＋距離＋遮蔽。ロッカー内・牢演出中は不可視 */
  EnemyAI.prototype.canSeePlayer = function () {
    var g = this.game, p = g.player, e = this.enemy;
    if (g.stealth && g.stealth.hidden()) return false;
    var dx = p.x - e.x, dz = p.z - e.z;
    var dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;
    if (dist > this.sightRange(p)) return false;
    var f = forwardOf(e.facing);
    if ((f.x * dx + f.z * dz) / dist < Math.cos(this.T.fovDeg * Math.PI / 360)) return false;
    return !this.blockedLine(e.x, e.z, p.x, p.z);
  };

  /* ---------------- 移動 ---------------- */

  EnemyAI.prototype._setPath = function (tx, tz) {
    var map = this.map, e = this.enemy;
    var c0 = map.colOf(e.x), r0 = map.rowOf(e.z);
    if (!map.isWalkable(c0, r0)) {
      /* 万一実体マスに乗ってしまったら最寄りの歩行可能マスへ寄せる */
      var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        if (map.isWalkable(c0 + D[i][0], r0 + D[i][1])) {
          var c = map.cellCenter(c0 + D[i][0], r0 + D[i][1]);
          e.x = c.x; e.z = c.z; c0 = map.colOf(e.x); r0 = map.rowOf(e.z);
          break;
        }
      }
    }
    this.path = this.pf.fill(c0, r0) ? this.pf.pathTo(map.colOf(tx), map.rowOf(tz)) : null;
    this.pathI = 0;
    this.repathT = this.T.repathInterval;
    this.goal = { x: tx, z: tz };
  };

  /** 次に向かう点。見通せる範囲の先のノードまで飛ばして角を丸める */
  EnemyAI.prototype._waypoint = function (tx, tz) {
    var path = this.path, map = this.map, e = this.enemy;
    if (!path || !path.length) return { x: tx, z: tz };
    var i = Math.min(this.pathI, path.length - 1);
    var lim = Math.min(path.length - 1, i + 8);
    var best = i;
    for (var k = i; k <= lim; k++) {
      var c = map.cellCenter(path[k].col, path[k].row);
      if (this._clearLine(e.x, e.z, c.x, c.z)) best = k;
    }
    this.pathI = best;
    if (best >= path.length - 1) return { x: tx, z: tz };
    var w = map.cellCenter(path[best].col, path[best].row);
    if (Math.hypot(w.x - e.x, w.z - e.z) < 0.30) {
      this.pathI = best + 1;
      w = map.cellCenter(path[this.pathI].col, path[this.pathI].row);
    }
    return w;
  };

  /** (tx,tz) へ1ステップ寄る。到達したら true */
  EnemyAI.prototype._moveTo = function (dt, tx, tz, speed) {
    var e = this.enemy, map = this.map, T = this.T;
    var d = Math.hypot(tx - e.x, tz - e.z);
    if (d <= T.arriveDist) { this.speed = 0; return true; }
    this.repathT -= dt;
    if (!this.path || this.repathT <= 0 || !this.goal ||
        Math.hypot(this.goal.x - tx, this.goal.z - tz) > 1.50) {
      this._setPath(tx, tz);
    }
    var wp = this._waypoint(tx, tz);
    var dx = wp.x - e.x, dz = wp.z - e.z;
    var len = Math.hypot(dx, dz);
    if (len < 1e-6) { this.speed = 0; return false; }
    var ux = dx / len, uz = dz / len;
    var mv = Math.min(speed * this._speedScale() * dt, len);
    var nx = e.x + ux * mv, nz = e.z + uz * mv;

    /* 倒された板に引っかかる（マスに入る瞬間だけ判定する） */
    var nc = map.colOf(nx), nr = map.rowOf(nz);
    if ((nc !== map.colOf(e.x) || nr !== map.rowOf(e.z)) &&
        this.game.stealth && this.game.stealth.tripBoard(nc, nr)) {
      this._face(dt, { x: ux, z: uz });
      this.toStalled();
      return false;
    }
    e.x = nx; e.z = nz;
    e.floorY = map.floorYAt(nx, nz);
    this.speed = mv / dt;
    this._face(dt, { x: ux, z: uz });
    return false;
  };

  EnemyAI.prototype._speedScale = function () {
    return (this.enemy.state === 'trans') ? this.T.transMoveScale : 1;
  };

  EnemyAI.prototype._face = function (dt, dir) {
    if (!dir) return;
    var want = yawOf(dir.x, dir.z);
    var rate = (this.state === 'chase') ? this.T.turnRateChase : this.T.turnRate;
    var d = angNorm(want - this.enemy.facing);
    var m = rate * dt;
    if (d > m) d = m; else if (d < -m) d = -m;
    this.enemy.facing = angNorm(this.enemy.facing + d);
  };

  /* ---------------- 状態遷移 ---------------- */

  EnemyAI.prototype.toPatrol = function () {
    this.state = 'patrol'; this.stateTime = 0;
    this.peekDone = false;
    this.lockerTarget = null;
    this.path = null; this.goal = null; this.repathT = 0;
    this.lostTime = 0; this.arrived = false;
    this.routeIdx = this._nearestRouteIdx();
    /* 巡回へ戻った直後は必ず歩き出す（立ち止まりは firstPause 秒より後） */
    this.pauseT = 0;
    this.pauseNext = this.patrolTime + this.T.patrolPauseFirst;
  };
  EnemyAI.prototype.toInvestigate = function (x, z) {
    if (this.state === 'chase' || this.state === 'caught') return false;
    /* 見られたロッカーへ向かっている最中は、他の音では逸れない（駆け引きの筋を通す） */
    if (this.state === 'locker' && this.lockerTarget && this.lockerTarget.forced) return false;
    this.state = 'investigate'; this.stateTime = 0;
    this.goal = null; this.path = null; this.repathT = 0;
    this.target = { x: x, z: z };
    this.arrived = false; this.lookT = 0;
    this.peekDone = false;
    this.heard++;
    return true;
  };
  EnemyAI.prototype.toChase = function () {
    if (this.state === 'chase') return;
    this.prevState = this.state;
    this.state = 'chase'; this.stateTime = 0;
    this.lostTime = 0;
    this.peekDone = false;
    var p = this.game.player;
    this.lastSeen = { x: p.x, z: p.z };
    this.path = null; this.goal = null; this.repathT = 0;
    this.alerts++;
    /* 発見スティング（契約 §4: 不協和音の刺し音＋画面の一瞬のフラッシュ/ノイズ） */
    sfx('spot', { x: this.enemy.x, z: this.enemy.z });
  };
  EnemyAI.prototype.toSearch = function () {
    /* 追跡からの離脱＝減衰音（契約 §4「追跡解除で減衰音」） */
    if (this.state === 'chase') sfx('lose', { x: this.enemy.x, z: this.enemy.z });
    this.state = 'search'; this.stateTime = 0;
    this.path = null; this.repathT = 0;
    this.arrived = false; this.lookT = 0;
    this.goal = this.lastSeen ? { x: this.lastSeen.x, z: this.lastSeen.z }
      : { x: this.enemy.x, z: this.enemy.z };
  };
  EnemyAI.prototype.toStalled = function () {
    if (this.state === 'stalled') return;
    this.prevState = (this.state === 'caught') ? 'patrol' : this.state;
    this.state = 'stalled';
    this.stallT = this.T.boardStallDur;
    this.stateTime = 0;
    this.speed = 0;
    sfx('stall', { x: this.enemy.x, z: this.enemy.z });
  };

  /** 捕獲された（Stealth が牢送り演出を持つ） */
  EnemyAI.prototype.onCatch = function () {
    var st = this.game.stealth;
    if (!st || !st.capture()) return;
    this.state = 'caught';
    this.stateTime = 0;
    this.speed = 0;
    this.path = null;
  };

  /** 牢送り演出が終わったら巡回起点へ戻す（＝プレイヤーは別の場所で再開する） */
  EnemyAI.prototype.afterJail = function () {
    var sp = this.spawn;
    var e = this.enemy;
    e.placeCell(sp.col, sp.row, (sp.yawDeg === undefined ? 180 : sp.yawDeg), this.map);
    e.setForm('stand', true);
    e.poseT = 0; e.transTime = 0; e.state = 'walk';
    this.form = 'stand';
    this.lastSeen = null;
    this.toPatrol();
  };

  /* ---------------- 聴覚 ---------------- */

  EnemyAI.prototype._hear = function () {
    var evs = ESCAPE.noise.consume();
    if (!evs.length) return;
    var e = this.enemy;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      var d = Math.hypot(ev.x - e.x, ev.z - e.z);
      if (d > ev.radius || d > this.T.hearMax) continue;
      this.toInvestigate(ev.x, ev.z);
    }
  };

  /* ---------------- 形態（上書き事故の防止つき） ---------------- */

  EnemyAI.prototype._applyForm = function () {
    var e = this.enemy;
    if (e.state === 'trans') return;             /* 遷移アニメ中は一切触らない */
    /* P4.6: 音を聞いた時点で反転形態に落ちる（契約 §4「その場で反転形態に落ちて疾走」）。
       探索・ロッカー狩りも警戒中なので反転のまま。巡回へ戻る時だけ直立に起き上がる。 */
    var s = this.state;
    var want = (s === 'chase' || s === 'investigate' || s === 'search' || s === 'locker') ? 'crawl' : 'stand';
    if (this.form !== want) {
      e.setForm(want === 'crawl' ? 'crawl' : 'stand', false);
      this.form = want;
      return;
    }
    var anim;
    if (want === 'crawl') anim = 'chase';
    else anim = (this.speed > 0.05) ? 'walk' : 'idle';
    if (e.state !== anim) e.state = anim;
  };

  /* ---------------- 1ステップ ---------------- */

  EnemyAI.prototype.step = function (dt) {
    if (this.manual || this.cine) return;
    var g = this.game, T = this.T, e = this.enemy;
    this.stateTime += dt;
    this._hear();

    var st = g.stealth;
    var p = g.player;
    var see = this.canSeePlayer();
    this.sees = see;
    var dist = Math.hypot(p.x - e.x, p.z - e.z);

    switch (this.state) {
      case 'patrol':
        if (see) { this.toChase(); break; }
        this._patrolStep(dt);
        break;

      case 'investigate':
        if (see) { this.toChase(); break; }
        /* 契約 §4: 音源へ疾走 → 到着したら周辺を探索(searchDur) → 直立へ戻り巡回 */
        if (this._moveTo(dt, this.target.x, this.target.z, T.investigateSpeed)) {
          this.arrived = true;
          this.lastSeen = { x: this.target.x, z: this.target.z };
          this.toSearch();
        }
        break;

      case 'locker':
        if (see) { this.toChase(); break; }
        this._lockerHuntStep(dt);
        break;

      case 'chase':
        if (see) { this.lastSeen = { x: p.x, z: p.z }; this.lostTime = 0; }
        else this.lostTime += dt;
        var tgt = this.lastSeen || { x: p.x, z: p.z };
        this._moveTo(dt, tgt.x, tgt.z, T.chaseSpeed);
        if (dist <= T.catchDist && !(st && st.hidden())) { this.onCatch(); break; }
        if ((this.lostTime > T.loseSightGrace && dist > T.giveUpDist) || this.lostTime > T.giveUpTime) {
          this.toSearch();
        }
        break;

      case 'search':
        if (see) { this.toChase(); break; }
        if (this.stateTime >= T.searchDur) { this.toPatrol(); break; }
        /* 契約 §4「探索中の敵は近くのロッカーを1つ開けて覗く（ランダム）」 */
        if (!this.peekDone) {
          this.peekDone = true;
          if (this.rand() < T.lockerPeekChance) {
            var pk = this._pickPeekLocker();
            if (pk) { this.toLockerHunt(pk.col, pk.row, false); break; }
          }
        }
        if (!this.goal) this._pickSearchSpot();
        if (this.arrived) {
          this.lookT += dt;
          this.speed = 0;
          e.facing = angNorm(this.lookBase + Math.sin(this.lookT * 1.9) * T.lookSweep);
          if (this.lookT > 1.10) { this.arrived = false; this._pickSearchSpot(); }
        } else if (this._moveTo(dt, this.goal.x, this.goal.z, T.searchSpeed)) {
          this.arrived = true; this.lookT = 0; this.lookBase = e.facing;
        }
        break;

      case 'stalled':
        this.speed = 0;
        this.stallT -= dt;
        /* もがき: その場で小刻みに向きが揺れる（形態は問わず停止） */
        e.facing = angNorm(e.facing + Math.sin(this.stateTime * 9.0) * 0.010);
        if (this.stallT <= 0) {
          this.lostTime = 0;
          if (this.prevState === 'chase') this.toSearch();
          else if (this.prevState === 'investigate') { this.state = 'investigate'; this.stateTime = 0; }
          else this.toPatrol();
        }
        break;

      case 'caught':
        this.speed = 0;
        break;
    }

    this._applyForm();
    e.update(dt, g.simTime);
    e.syncLight(g.world, this.map);
  };

  EnemyAI.prototype._patrolStep = function (dt) {
    if (!this.route.length) { this.speed = 0; return; }
    var T = this.T;
    /* 巡回のランダム停止（契約 §4「巡回のランダム停止で『目撃』演出を自然に起こす」）。
       止まっている間は通路の先を眺めるように向きだけ僅かに動かす。 */
    this.patrolTime += dt;
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      this.speed = 0;
      this.enemy.facing = angNorm(this.pauseYaw + Math.sin(this.patrolTime * 0.55) * 0.16);
      return;
    }
    if (this.patrolTime >= this.pauseNext) {
      this.pauseT = T.patrolPauseDur + this.rand() * T.patrolPauseDurVar;
      this.pauseNext = this.patrolTime + this.pauseT + T.patrolPauseGap + this.rand() * T.patrolPauseVar;
      this.pauseYaw = this.enemy.facing;
      this.pauses++;
      this.speed = 0;
      return;
    }
    var n = this.route[this.routeIdx % this.route.length];
    var c = this.map.cellCenter(n.col, n.row);
    if (this._moveTo(dt, c.x, c.z, this.T.patrolSpeed)) {
      this.routeIdx = (this.routeIdx + 1) % this.route.length;
      this.path = null; this.goal = null; this.repathT = 0;
    }
  };

  EnemyAI.prototype._pickSearchSpot = function () {
    var map = this.map, base = this.lastSeen || { x: this.enemy.x, z: this.enemy.z };
    var bc = map.colOf(base.x), br = map.rowOf(base.z);
    for (var i = 0; i < 24; i++) {
      var c = bc + Math.round((this.rand() * 2 - 1) * 4);
      var r = br + Math.round((this.rand() * 2 - 1) * 4);
      if (!map.isWalkable(c, r) || map.isBlocked(c, r)) continue;
      var cc = map.cellCenter(c, r);
      this.goal = { x: cc.x, z: cc.z };
      this.path = null; this.repathT = 0;
      return;
    }
    this.goal = { x: base.x, z: base.z };
    this.path = null; this.repathT = 0;
  };

  /* ---------------- P4.6 ロッカーの駆け引き（契約 §4「ロッカーの駆け引き」） ----------------
   *  forced=true … プレイヤーが入る瞬間を見た＝開けて引きずり出す（捕獲）
   *  forced=false … 探索中の「覗き」。開けるだけで捕獲はしない
   */
  EnemyAI.prototype.toLockerHunt = function (col, row, forced) {
    if (this.state === 'caught') return false;
    this.state = 'locker'; this.stateTime = 0;
    this.path = null; this.goal = null; this.repathT = 0;
    this.arrived = false;
    this.lockerTarget = { col: col, row: row, forced: !!forced };
    return true;
  };

  /** プレイヤーがロッカーに入る瞬間を見ていた（Stealth.enterLocker から） */
  EnemyAI.prototype.onLockerSeen = function (col, row) {
    return this.toLockerHunt(col, row, true);
  };

  EnemyAI.prototype._lockerHuntStep = function (dt) {
    var T = this.T, e = this.enemy, map = this.map;
    var lt = this.lockerTarget;
    if (!lt) { this.toSearch(); return; }
    var lc = map.cellCenter(lt.col, lt.row);
    if (Math.hypot(lc.x - e.x, lc.z - e.z) <= T.lockerOpenDist) { this._openLocker(); return; }
    if (this.stateTime > T.lockerHuntTimeout) {
      this.lastSeen = { x: lc.x, z: lc.z };
      this.toSearch();
      return;
    }
    /* ロッカーのマス自体は実体なので、経路は最寄りの到達可能マスで止まる */
    this._moveTo(dt, lc.x, lc.z, T.lockerHuntSpeed);
  };

  EnemyAI.prototype._openLocker = function () {
    var st = this.game.stealth, lt = this.lockerTarget, map = this.map;
    var lc = map.cellCenter(lt.col, lt.row);
    this.speed = 0;
    this.lockerOpens++;
    this.enemy.facing = yawOf(lc.x - this.enemy.x, lc.z - this.enemy.z);
    sfx('lockerPeek', { x: lc.x, z: lc.z });
    var inside = !!(st && st.locker && st.locker.col === lt.col && st.locker.row === lt.row);
    if (inside && lt.forced) {
      /* 契約 §4「見た場合は、そのロッカーを開けて引きずり出す（捕獲）」 */
      if (st.captureFromLocker()) {
        this.state = 'caught'; this.stateTime = 0; this.speed = 0; this.path = null;
        return;
      }
    }
    this.lastSeen = { x: lc.x, z: lc.z };
    this.lockerTarget = null;
    this.toSearch();
  };

  /** 探索中に覗くロッカーを1つ選ぶ。
   *  契約 §4 は「見られずに入れば安全」を保証しているので、
   *  覗き（forced=false）の対象からはプレイヤーが今入っているロッカーを外す。 */
  EnemyAI.prototype._pickPeekLocker = function () {
    var map = this.map, list = (map.meta && map.meta.lockers) || [];
    var st = this.game.stealth, e = this.enemy;
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
      var L = list[i];
      if (st && st.locker && st.locker.col === L.col && st.locker.row === L.row) continue;
      var c = map.cellCenter(L.col, L.row);
      var d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d > this.T.lockerPeekRadius) continue;
      if (d < bd) { bd = d; best = L; }
    }
    return best;
  };

  EnemyAI.prototype.info = function () {
    var e = this.enemy, p = this.game.player;
    return {
      state: this.state, form: this.form, poseT: e.poseT, anim: e.state,
      x: e.x, z: e.z, col: this.map.colOf(e.x), row: this.map.rowOf(e.z),
      facingDeg: e.facing * 180 / Math.PI,
      speed: this.speed, sees: this.sees,
      dist: Math.hypot(p.x - e.x, p.z - e.z),
      sight: this.sightRange(p), lum: this.luminanceAt(p.x, p.z),
      alerts: this.alerts, heard: this.heard, stallT: this.stallT,
      manual: this.manual, cine: this.cine, lockerOpens: this.lockerOpens,
      lockerTarget: this.lockerTarget ? (this.lockerTarget.col + ',' + this.lockerTarget.row +
        (this.lockerTarget.forced ? ':forced' : ':peek')) : null
    };
  };

  ESCAPE.EnemyAI = EnemyAI;
  ESCAPE.ENEMY_TUNING = ENEMY_TUNING;

  /* ================================================================
   * ステルス機構（プレイヤー側）
   *   ロッカー出入り / 板倒し / 音地盤・センサー / 牢送り / HUD
   * ============================================================== */
  function Stealth(game) {
    this.game = game;
    this.T = ENEMY_TUNING;
    this.fx = new THREE.Group();
    this.fx.name = 'stealth-fx';
    game.scene.add(this.fx);
    this._geos = [];
    this._mats = [];
    this.dom = {
      status: document.getElementById('status'),
      prompt: document.getElementById('prompt'),
      blackout: document.getElementById('blackout'),
      gameover: document.getElementById('gameover-overlay')
    };
    this.reset();
    this._bindGameOver();
  }

  Stealth.prototype.reset = function () {
    this.map = this.game.map;
    this._clearFX();
    var meta = this.map.meta || {};
    var bs = meta.boards || [];
    this.boards = [];
    for (var i = 0; i < bs.length; i++) {
      this.boards.push({ col: bs[i].col, row: bs[i].row, toppled: false, used: false });
    }
    this.locker = null;
    this.captures = 0;
    this.jail = { phase: 'none', t: 0, pry: 0, col: 0, row: 0, dir: null, reset: false };
    this.fade = 0;
    this.alarmT = 0;
    this.alarms = 0;
    this.noiseSteps = 0;
    this.topples = 0;
    this.escapes = 0;
    this.areaResets = 0;
    this.lastCell = '';
    this.cellNoised = false;
    this.prompt = '';
    this._domCache = null;
    this._noiseKinds = null;     /* 音地盤の材質索引はマップに紐づくので作り直す */
    this._pryT = 0;              /* 格子こじ開け音の間引き用タイマー */
    this.cine = null;            /* P4.6: 進行中の捕獲シネマティック */
    this.lockerSeen = false;     /* 直近のロッカー侵入を見られていたか */
    this.lockerCaptures = 0;
    this.restarts = 0;
    if (this.game.cinematic) this.game.cinematic.reset();
    this._blockBarredCells();
    this._syncDom();
  };

  /** 鉄格子のある房は通り抜け不可にする（描画はP2の world._cellBars、当たりはここで足す）。
   *  「破られた房」＝ cellOpenings だけが通れる＝牢送り後の出口動線になる。
   *  World の生成後に呼ぶこと（生成前に塞ぐと壁として描画されてしまう）。 */
  Stealth.prototype._blockBarredCells = function () {
    var map = this.map, meta = map.meta || {}, TILE = ESCAPE.TILE;
    map.clearBlocked();
    var open = Object.create(null), oc = meta.cellOpenings || [];
    for (var i = 0; i < oc.length; i++) open[oc[i].col + ',' + oc[i].row] = true;
    var cells = meta.cells || [];
    for (var j = 0; j < cells.length; j++) {
      var c = cells[j];
      if (open[c.col + ',' + c.row]) continue;
      if (map.tileAt(c.col, c.row) !== TILE.CELL) continue;
      map.setBlocked(c.col, c.row, true);
    }
  };

  /* ---------------- 見つからない状態 ---------------- */
  Stealth.prototype.hidden = function () {
    /* P4: メモ・テンキーなどのモーダルを開いている間は中断安全（捕獲を無効化） */
    var pr = this.game.progress;
    return !!this.locker || this.jail.phase !== 'none' || !!(pr && pr.modalOpen && pr.modalOpen());
  };
  Stealth.prototype.inLocker = function () { return !!this.locker; };

  /* ---------------- 1ステップ ---------------- */
  Stealth.prototype.step = function (dt) {
    if (this.alarmT > 0) this.alarmT -= dt;
    if (this.jail.phase !== 'none') this._jailStep(dt);
    else if (this.locker) this._lockerStep(dt);
    else this._footstepNoise();
    this._updatePrompt();
    this._syncDom();
  };

  /* ---------------- 音地盤・センサー（契約 §4「音システム」） ---------------- */
  Stealth.prototype._footstepNoise = function () {
    var p = this.game.player, map = this.map, TILE = ESCAPE.TILE;
    var col = p.col(), row = p.row();
    var key = col + ',' + row;
    if (key !== this.lastCell) { this.lastCell = key; this.cellNoised = false; }
    if (this.cellNoised) return;
    /* 走っている時だけ音が出る。歩き・しゃがみは無音（契約） */
    if (p.mode !== 'run' || p.speed < 0.5) return;
    var tile = map.tileAt(col, row);
    if (tile !== TILE.NOISE && tile !== TILE.SENSOR) return;
    var c = map.cellCenter(col, row);
    if (tile === TILE.NOISE) {
      this.noiseSteps++;
      ESCAPE.noise.emit(c.x, c.z, this.T.runNoiseRadius, 'step');
      /* 契約 §4:「音イベントが起きた」と分かる強い音。床種は meta.noise の kind */
      sfx('noiseStep', { x: c.x, z: c.z, mat: this._noiseKindAt(col, row) });
    } else {
      this.alarms++;
      this.alarmT = 2.2;
      ESCAPE.noise.emit(c.x, c.z, this.T.sensorNoiseRadius, 'sensor');
      sfx('sensor', { x: c.x, z: c.z });
    }
    this.cellNoised = true;
  };

  /** 音地盤マスの材質（meta.noise の kind。既定は水たまり） */
  Stealth.prototype._noiseKindAt = function (col, row) {
    if (!this._noiseKinds) {
      this._noiseKinds = Object.create(null);
      var list = (this.map.meta && this.map.meta.noise) || [];
      for (var i = 0; i < list.length; i++) {
        this._noiseKinds[list[i].col + ',' + list[i].row] = (list[i].kind === 'glass') ? 'glass' : 'water';
      }
    }
    return this._noiseKinds[col + ',' + row] || 'water';
  };

  /* ---------------- ロッカー ---------------- */
  /** ロッカーの開口方向（マスから見て歩行可能な隣。プレイヤーの居る側を優先） */
  Stealth.prototype._lockerDir = function (col, row) {
    var map = this.map, p = this.game.player;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var best = null, bd = -Infinity;
    var c = map.cellCenter(col, row);
    var px = p.x - c.x, pz = p.z - c.z;
    var len = Math.hypot(px, pz) || 1;
    for (var i = 0; i < 4; i++) {
      if (!map.isWalkable(col + D[i][0], row + D[i][1]) || map.isBlocked(col + D[i][0], row + D[i][1])) continue;
      var dot = (D[i][0] * px + D[i][1] * pz) / len;
      if (dot > bd) { bd = dot; best = D[i]; }
    }
    return best || [0, -1];
  };

  Stealth.prototype.enterLocker = function (col, row) {
    var p = this.game.player, map = this.map;
    var ai = this.game.ai;
    /* 契約 §4「敵がプレイヤーがロッカーに入るのを見た場合は開けて引きずり出す」。
       判定は「入る瞬間」＝ プレイヤーをまだ隠す前にここで1度だけ取る。 */
    var seen = !!(ai && !ai.cine && ai.state !== 'caught' && ai.canSeePlayer());
    var c = map.cellCenter(col, row);
    var n = this._lockerDir(col, row);
    /* 目線は扉のすぐ内側（world._locker の箱の中）。扉の割れ目・通気スリットごしに覗く絵になる */
    var off = map.tileSize * 0.5 - LOCKER_EYE_INSET;
    this.locker = {
      col: col, row: row,
      fromX: p.x, fromZ: p.z,
      dir: n,
      x: c.x + n[0] * off, z: c.z + n[1] * off,
      faceYaw: yawOf(n[0], n[1])
    };
    p.x = this.locker.x; p.z = this.locker.z;
    p.y = map.floorYAt(p.x, p.z);
    p.yaw = this.locker.faceYaw;
    p.speed = 0;
    this.locker.seen = seen;
    this.lockerSeen = seen;
    sfx('lockerIn', { x: c.x, z: c.z });
    if (seen && ai) ai.onLockerSeen(col, row);
    return true;
  };

  /** ロッカーごと開けられて引きずり出される（AI._openLocker から） */
  Stealth.prototype.captureFromLocker = function () {
    if (!this.locker || this.jail.phase !== 'none') return false;
    this.exitLocker();
    this.lockerCaptures++;
    return this.capture();
  };

  Stealth.prototype.exitLocker = function () {
    if (!this.locker) return false;
    var p = this.game.player, L = this.locker;
    var x = L.fromX, z = L.fromZ;
    if (p.collidesAt(x, z)) {
      /* 戻り先が塞がっていたら隣接の歩行可能マスへ */
      var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        var nc = L.col + D[i][0], nr = L.row + D[i][1];
        if (this.map.isWalkable(nc, nr)) {
          var c = this.map.cellCenter(nc, nr);
          if (!p.collidesAt(c.x, c.z)) { x = c.x; z = c.z; break; }
        }
      }
    }
    p.x = x; p.z = z;
    p.y = this.map.floorYAt(x, z);
    this.locker = null;
    sfx('lockerOut', { x: x, z: z });
    return true;
  };

  Stealth.prototype._lockerStep = function () {
    var p = this.game.player, L = this.locker, map = this.map;
    p.x = L.x; p.z = L.z;
    p.y = map.floorYAt(L.x, L.z);
    p.speed = 0;
    /* 扉の隙間から覗く: 正面から左右に少しだけ振れる */
    var d = angNorm(p.yaw - L.faceYaw);
    var lim = this.T.lockerYawLimit;
    if (d > lim) p.yaw = angNorm(L.faceYaw + lim);
    else if (d < -lim) p.yaw = angNorm(L.faceYaw - lim);
  };

  /* ---------------- 板 ---------------- */
  Stealth.prototype.boardAt = function (col, row) {
    for (var i = 0; i < this.boards.length; i++) {
      if (this.boards[i].col === col && this.boards[i].row === row) return this.boards[i];
    }
    return null;
  };

  Stealth.prototype.topple = function (b) {
    if (!b || b.toppled) return false;
    b.toppled = true;
    this.topples++;
    this._addFallenBoard(b);
    sfx('boardTopple', {});
    return true;
  };

  /** 敵がそのマスに入った時に呼ぶ。倒れた板を踏んだら true（板は使い切り） */
  Stealth.prototype.tripBoard = function (col, row) {
    var b = this.boardAt(col, row);
    if (!b || !b.toppled || b.used) return false;
    b.used = true;
    return true;
  };

  /* ---------------- 「調べる」 ---------------- */
  Stealth.prototype.findTarget = function () {
    var p = this.game.player, map = this.map, TILE = ESCAPE.TILE, T = this.T;
    var f = forwardOf(p.yaw);
    var best = null, bestD = Infinity;
    var col = p.col(), row = p.row();
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var c = col + dc, r = row + dr;
        if (!map.inBounds(c, r)) continue;
        var tile = map.tileAt(c, r);
        var kind = null;
        if (tile === TILE.LOCKER) kind = 'locker';
        else if (tile === TILE.BOARD) kind = 'board';
        if (!kind) continue;
        var cc = map.cellCenter(c, r);
        var dx = cc.x - p.x, dz = cc.z - p.z;
        var d = Math.hypot(dx, dz);
        var range = (kind === 'locker') ? T.lockerRange : T.boardRange;
        if (d > range) continue;
        if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
        if (kind === 'board') {
          var b = this.boardAt(c, r);
          if (!b || b.toppled) continue;
        }
        if (d < bestD) { bestD = d; best = { kind: kind, col: c, row: r, board: this.boardAt(c, r) }; }
      }
    }
    return best;
  };

  /** 「調べる」1回。処理したら true */
  Stealth.prototype.onInteract = function () {
    var J = this.jail;
    if (J.phase === 'locked') { this._pry(this.T.pryPerPress); return true; }
    /* P4.6: ゲームオーバー画面＝「タップで最初から」（E / 調べる ボタンも同じ経路） */
    if (J.phase === 'over') { this.restartArea(); return true; }
    /* P4.6: 演出中の連打は「暴れ」に回す（揺れが増すだけで結果は変わらない） */
    if (J.phase === 'grab' && this.cine) { this.cine.onInteract(); return true; }
    if (J.phase !== 'none') return true;         /* 暗転演出中は無視（重なり対策） */
    if (this.locker) { this.exitLocker(); return true; }
    var t = this.findTarget();
    if (!t) return false;
    if (t.kind === 'locker') return this.enterLocker(t.col, t.row);
    if (t.kind === 'board') return this.topple(t.board);
    return false;
  };

  Stealth.prototype._updatePrompt = function () {
    var J = this.jail, s = '';
    if (J.phase === 'locked') s = '調べる: 格子をこじ開ける  ' + Math.round(J.pry * 100) + '%';
    else if (J.phase !== 'none') s = '';   /* 演出中・ゲームオーバー中はHUDを出さない */
    else if (this.locker) s = '調べる: ロッカーから出る';
    else {
      var t = this.findTarget();
      if (t && t.kind === 'locker') s = '調べる: ロッカーに隠れる';
      else if (t && t.kind === 'board') s = '調べる: 板を倒す';
    }
    if (this.alarmT > 0 && J.phase === 'none') s = s ? (s + '   ⚠ 警報') : '⚠ 警報';
    this.prompt = s;
  };

  /* ---------------- 牢送り ---------------- */

  /** 敵に捕まった。演出中なら false（多重捕獲の防止） */
  Stealth.prototype.capture = function () {
    if (this.jail.phase !== 'none') return false;
    if (this.locker) return false;
    this.captures++;
    var J = this.jail;
    J.phase = 'grab'; J.t = 0; J.pry = 0;
    J.reset = (this.captures >= this.T.captureLimit);
    this.game.player.speed = 0;
    /* 契約 §4「捕獲時に耳元の音＋暗転」 */
    sfx('capture', {});
    /* P4.6: 捕獲シネマティック（毎回）。3回目は「食われる」に差し替わる。
       演出モジュールが無い環境では従来の短い暗転にフォールバックする。 */
    var cine = this.game.cinematic;
    this.cine = (cine && cine.begin(J.reset ? 'eaten' : 'jail')) ? cine : null;
    return true;
  };

  Stealth.prototype._jailStep = function (dt) {
    var J = this.jail, T = this.T, g = this.game, p = g.player;
    J.t += dt;
    if (J.phase === 'grab') {
      /* P4.6: 'grab' は捕獲シネマティックの持ち時間（顔アップ→首掴み→引きずり→暗転）。
         段階名は演出側（game.cinematic.stage）が持ち、こちらは暗転量だけ受け取る。 */
      p.speed = 0;
      if (this.cine) {
        this.cine.step(dt);
        this.fade = this.cine.fade;
        if (this.cine.done) { this.cine.end(); this.cine = null; this._afterCine(); }
      } else {
        this.fade = clamp(J.t / T.grabDur, 0, 1);
        if (J.t >= T.grabDur) { this.fade = 1; this._afterCine(); }
      }
    } else if (J.phase === 'over') {
      /* 3回目＝食われた。ゲームオーバー画面（正文 docs/notes.md「回収完了」節）で
         タップ / E / クリック待ち。ここでは何も進めない（中断安全） */
      this.fade = 1;
      p.speed = 0;
    } else if (J.phase === 'black') {
      this.fade = 1;
      if (J.t >= T.blackDur) {
        J.t = 0;
        J.phase = J.reset ? 'wake' : 'locked';
      }
    } else if (J.phase === 'locked') {
      this.fade = clamp(1 - J.t / T.wakeDur, 0, 1);
      /* 長押しでも進む（契約: 連打or長押し） */
      if (g.input && g.input.isInteractHeld && g.input.isInteractHeld()) {
        this._pry(T.pryHoldRate * dt);
      } else if (J.pry > 0) {
        J.pry = Math.max(0, J.pry - T.pryDecay * dt);
      }
      this._confineToCell();
      this._shakeGrate(dt);
    } else if (J.phase === 'wake') {
      this.fade = clamp(1 - J.t / T.wakeDur, 0, 1);
      if (J.t >= T.wakeDur) { J.phase = 'none'; this.fade = 0; }
    }
  };

  /** 演出が終わった後の分岐: 通常は房へ、3回目はゲームオーバー画面へ */
  Stealth.prototype._afterCine = function () {
    var J = this.jail, g = this.game;
    this.fade = 1;
    J.t = 0;
    if (J.reset) {
      J.phase = 'over';
      this.game.input.reset();
      this._syncDom();
      return;
    }
    this._toCell();
    if (g.ai) g.ai.afterJail();
    J.phase = 'locked';
  };

  /** ゲームオーバー画面から「エリア最初から」再開する（既存のリセット経路を流用） */
  Stealth.prototype.restartArea = function () {
    var J = this.jail;
    if (J.phase !== 'over') return false;
    this.restarts++;
    if (this.game.cinematic) this.game.cinematic.end();
    this.areaReset();
    J.phase = 'wake'; J.t = 0; J.pry = 0; J.reset = false;
    this.fade = 1;
    this._syncDom();
    return true;
  };

  /** ゲームオーバー画面のタップ（画面のどこでも可） */
  Stealth.prototype._bindGameOver = function () {
    var self = this, el = this.dom.gameover;
    if (!el || el._escBound) return;
    el._escBound = true;
    function tap(e) {
      if (self.jail.phase !== 'over') return;
      e.preventDefault(); e.stopPropagation();
      self.restartArea();
    }
    el.addEventListener('touchstart', tap, { passive: false });
    el.addEventListener('mousedown', tap);
  };

  /** 拘束室の房へ運ぶ（進行状態・所持はそのまま） */
  Stealth.prototype._toCell = function () {
    var map = this.map, meta = map.meta || {}, p = this.game.player;
    var jc = meta.jailCell || (meta.cellOpenings && meta.cellOpenings[0]) ||
      (meta.cells && meta.cells[0]) || meta.spawn;
    var J = this.jail;
    J.col = jc.col; J.row = jc.row;
    var c = map.cellCenter(jc.col, jc.row);
    p.x = c.x; p.z = c.z;
    p.y = map.floorYAt(c.x, c.z);
    p.pitch = 0;
    p.crouching = false;
    p.eyeHeight = ESCAPE.Player.EYE_STAND;
    p.speed = 0;
    /* 房の開口方向（歩行可能な隣接）を向く */
    var D = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
    var dir = [0, 0, -1];
    for (var i = 0; i < 4; i++) {
      var nc = jc.col + D[i][0], nr = jc.row + D[i][1];
      if (map.isWalkable(nc, nr) && map.tileAt(nc, nr) !== ESCAPE.TILE.CELL) { dir = D[i][2]; break; }
    }
    J.dir = dir;
    p.yaw = yawOf(dir[0], dir[2]);
    this.game.input.reset();
    this._addGrate(jc.col, jc.row, dir);
  };

  /** 格子を破るまで房から出られない */
  Stealth.prototype._confineToCell = function () {
    var map = this.map, p = this.game.player, J = this.jail, T = map.tileSize;
    var r = p.radius;
    var x0 = J.col * T + r, x1 = (J.col + 1) * T - r;
    var z0 = J.row * T + r, z1 = (J.row + 1) * T - r;
    if (p.x < x0) p.x = x0; else if (p.x > x1) p.x = x1;
    if (p.z < z0) p.z = z0; else if (p.z > z1) p.z = z1;
    p.y = map.floorYAt(p.x, p.z);
  };

  Stealth.prototype._pry = function (amount) {
    var J = this.jail;
    if (J.phase !== 'locked') return false;
    J.pry = clamp(J.pry + amount, 0, 1);
    this.grateShake = 0.35;
    /* 格子をこじ開ける金属音。長押しの連続呼び出しでは間引く（1発ずつ鳴らさない） */
    this._pryT = (this._pryT || 0) - amount;
    if (this._pryT <= 0) { this._pryT = 0.12; sfx('pry', {}); }
    if (J.pry >= 1) this._breakGrate();
    return true;
  };

  Stealth.prototype._breakGrate = function () {
    var J = this.jail;
    J.phase = 'none'; J.pry = 0; J.t = 0;
    this.fade = 0;
    this.escapes++;
    this._removeGrate();
    sfx('grateBreak', {});
    return true;
  };

  /** 同一エリア N 回目の捕獲: チェックポイントに関係なくエリア最初から */
  Stealth.prototype.areaReset = function () {
    var g = this.game;
    this.areaResets++;
    this.captures = 0;
    this.locker = null;
    this.lockerSeen = false;
    for (var i = 0; i < this.boards.length; i++) {
      this.boards[i].toppled = false;
      this.boards[i].used = false;
    }
    this._clearFX();
    g.player.reset();
    g.input.reset();
    if (g.progress) g.progress.flags = {};
    /* P4: 位置とチェックポイントのみ巻き戻す。仕掛け進行(電源/コード/隔壁)は保持する
       （契約 §4: 牢送りは「進行状態は保持のまま自力脱出して再開」） */
    if (g.progress && g.progress.onAreaReset) g.progress.onAreaReset();
    if (g.ai) g.ai.reset();
  };

  /* ---------------- 演出メッシュ ---------------- */

  Stealth.prototype._box = function (w, h, d) {
    var geo = new THREE.BoxGeometry(w, h, d);
    this._geos.push(geo);
    return geo;
  };

  /** そのマスの明るさに合わせた材質（環境の焼き込みと同じ明度に乗せる。
   *  素の MeshBasicMaterial だと暗がりで浮くため） */
  Stealth.prototype._litMat = function (hex, col, row, minK) {
    var lum = 0.05;
    if (this.game.ai) {
      var c = this.map.cellCenter(col, row);
      lum = this.game.ai.luminanceAt(c.x, c.z);
    }
    var k = clamp((minK === undefined ? 0.22 : minK) + lum * 1.55, 0, 1.05);
    var m = new THREE.MeshBasicMaterial({ color: hex, fog: true });
    /* color は線形空間で保持されるので、見た目の明度を k にするには二乗して掛ける */
    m.color.multiplyScalar(k * k);
    this._mats.push(m);
    return m;
  };

  Stealth.prototype._addFallenBoard = function (b) {
    var map = this.map, T = map.tileSize;
    var cx = (b.col + 0.5) * T, cz = (b.row + 0.5) * T;
    var fy = map.cellFloorY(b.col, b.row);
    var g = new THREE.Group();
    g.name = 'fallen-board-' + b.col + ',' + b.row;
    var mat = this._litMat(0x8a7351, b.col, b.row, 0.20);
    for (var k = 0; k < 3; k++) {
      var m = new THREE.Mesh(this._box(1.86, 0.085, 0.40), mat);
      m.position.set(cx + (k - 1) * 0.16, fy + 0.05 + k * 0.045, cz + (k - 1) * 0.30);
      m.rotation.y = (k - 1) * 0.28 + 0.10;
      g.add(m);
    }
    this.fx.add(g);
    b.mesh = g;
  };

  Stealth.prototype._addGrate = function (col, row, dir) {
    var map = this.map, T = map.tileSize;
    var cx = (col + 0.5) * T, cz = (row + 0.5) * T;
    var fy = map.cellFloorY(col, row);
    var fx = cx + dir[0] * T * 0.5, fz = cz + dir[2] * T * 0.5;
    var along = (dir[0] !== 0) ? 'z' : 'x';
    var g = new THREE.Group();
    g.name = 'jail-grate';
    var mat = this._litMat(0x6d747a, col, row, 0.55);
    for (var k = 0; k < 9; k++) {
      var off = -T / 2 + 0.12 + k * 0.22;
      var m = new THREE.Mesh(this._box(0.075, 2.46, 0.075), mat);
      m.position.set(fx + (along === 'z' ? 0 : off), fy + 1.24, fz + (along === 'z' ? off : 0));
      m.rotation.z = 0.035 * Math.sin(k * 1.7);
      g.add(m);
    }
    var cross = new THREE.Mesh(
      this._box(along === 'z' ? 0.09 : T, 0.12, along === 'z' ? T : 0.09), mat);
    cross.position.set(fx, fy + 1.32, fz);
    g.add(cross);
    this.fx.add(g);
    this.grate = g;
    this.grateBase = { x: fx, z: fz };
    this.grateShake = 0;
  };

  Stealth.prototype._shakeGrate = function (dt) {
    if (!this.grate) return;
    if (this.grateShake > 0) this.grateShake = Math.max(0, this.grateShake - dt * 1.6);
    var a = this.grateShake * 0.035;
    this.grate.position.x = Math.sin(this.game.simTime * 41) * a;
    this.grate.position.z = Math.cos(this.game.simTime * 37) * a;
  };

  Stealth.prototype._removeGrate = function () {
    if (!this.grate) return;
    this.fx.remove(this.grate);
    this.grate = null;
  };

  Stealth.prototype._clearFX = function () {
    while (this.fx.children.length) this.fx.remove(this.fx.children[0]);
    for (var i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    this._geos.length = 0;
    if (this._mats) {
      for (var m = 0; m < this._mats.length; m++) this._mats[m].dispose();
      this._mats.length = 0;
    }
    this.grate = null;
    this.grateShake = 0;
    if (this.boards) {
      for (var b = 0; b < this.boards.length; b++) this.boards[b].mesh = null;
    }
  };

  /* ---------------- HUD ---------------- */
  Stealth.prototype._syncDom = function () {
    var d = this.dom;
    var status = '捕獲 ' + this.captures + ' / ' + this.T.captureLimit;
    if (d.status && d.status.textContent !== status) d.status.textContent = status;
    if (d.prompt && d.prompt.textContent !== this.prompt) d.prompt.textContent = this.prompt;
    if (d.blackout) {
      var o = this.fade.toFixed(3);
      if (d.blackout.style.opacity !== o) d.blackout.style.opacity = o;
    }
    if (d.gameover) {
      var on = (this.jail.phase === 'over');
      if (d.gameover.classList.contains('show') !== on) d.gameover.classList.toggle('show', on);
    }
  };

  Stealth.prototype.info = function () {
    return {
      captures: this.captures, jail: this.jail.phase, pry: this.jail.pry, fade: this.fade,
      locker: this.locker ? (this.locker.col + ',' + this.locker.row) : null,
      boards: this.boards.map(function (b) { return b.col + ',' + b.row + (b.used ? ':used' : (b.toppled ? ':down' : ':up')); }),
      noiseSteps: this.noiseSteps, alarms: this.alarms, topples: this.topples,
      escapes: this.escapes, areaResets: this.areaResets, prompt: this.prompt,
      lockerSeen: this.lockerSeen, lockerCaptures: this.lockerCaptures, restarts: this.restarts,
      cine: this.cine ? this.cine.stage : null
    };
  };

  ESCAPE.Stealth = Stealth;

  /* ================================================================
   * 組み込み
   * ============================================================== */
  function install() {
    var g = ESCAPE.game;
    if (!g || !ESCAPE.Enemy) return;
    g.progress = g.progress || { flags: {} };
    g.ai = new EnemyAI(g);
    /* P4.6: 捕獲シネマティック。Stealth より先に作る（Stealth.reset が参照する） */
    if (ESCAPE.CaptureCinematic) g.cinematic = new ESCAPE.CaptureCinematic(g);
    g.stealth = new Stealth(g);

    /* 検証フック（機械テスト・E2E用） */
    global.__aiDebug = {
      tuning: ENEMY_TUNING,
      ai: function () { return ESCAPE.game.ai; },
      stealth: function () { return ESCAPE.game.stealth; },
      info: function () {
        var o = ESCAPE.game.ai.info();
        o.stealth = ESCAPE.game.stealth.info();
        var p = ESCAPE.game.player;
        o.player = { col: p.col(), row: p.row(), x: p.x, z: p.z, mode: p.mode, crouch: p.crouching };
        return o;
      },
      /** 敵をマス指定で置く（状態も指定可） */
      place: function (col, row, yawDeg, state) {
        var ai = ESCAPE.game.ai;
        ai.enemy.placeCell(col, row, yawDeg === undefined ? 180 : yawDeg, ai.map);
        ai.path = null; ai.goal = null; ai.repathT = 0;
        if (state) { ai.state = state; ai.stateTime = 0; }
        return ai.info();
      },
      state: function (s) { var ai = ESCAPE.game.ai; if (s) { ai.state = s; ai.stateTime = 0; } return ai.state; },
      sees: function () { return ESCAPE.game.ai.canSeePlayer(); },
      sight: function () { return ESCAPE.game.ai.sightRange(); },
      lum: function (col, row) {
        var m = ESCAPE.game.map, c = m.cellCenter(col, row);
        return ESCAPE.game.ai.luminanceAt(c.x, c.z);
      },
      noise: function (col, row, radius) { return ESCAPE.noise.emitCell(col, row, radius, 'debug'); },
      interact: function () { return ESCAPE.game.stealth.onInteract(); },
      cine: function () { return ESCAPE.game.cinematic ? ESCAPE.game.cinematic.info() : null; },
      reset: function () { ESCAPE.game.ai.reset(); ESCAPE.game.stealth.reset(); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(window);
