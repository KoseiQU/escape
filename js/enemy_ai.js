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
    /* P4.8（契約 §4「ヘッドライト」）: 点灯中は発見距離が伸びる。
       消灯して忍ぶか、点灯して急ぐかの駆け引きの要。P7で調整する。 */
    headlightSightMul: 1.50,
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
    catchDist: 1.05,          // 捕獲の接触距離(m)。等倍の体格に対する値
                              // P4.12 項目6: 実際の判定は体格倍率を掛ける（ai.catchDist()）
    turnRate: 3.40,           // 旋回(rad/s)
    turnRateChase: 6.00,
    repathInterval: 0.50,     // 経路再計算(s)
    arriveDist: 0.55,         // 目的地到達とみなす距離(m)
    radius: 0.45,             // 経路の見通し判定に使う体の半径(m)。等倍の体格に対する値
                              // P4.12 項目6: 実際の判定は体格倍率を掛ける（ai._radius()）。
                              // 反転形態は 0.45×1.35＝0.61m ＝ 幅1マス(2m)の通路の
                              // 中心から左右 0.61m。角を丸める近道が壁へ寄りすぎない。

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
    cineDragDur: 3.50,        // 3 担ぎ運び（P4.12 項目3で「引きずり」から差し替え）
    cineBlackDur: 1.50,       // 4 暗転（牢扉→鍵）
    cineMawDur: 1.80,         // 3'（3回目）食われる
    cineEatBlackDur: 1.20,    // 4'（3回目）暗転 → ゲームオーバー画面
    cineFaceDist: 0.95,       // 捕獲時に敵を据える距離(m)
    cineZoomEnd: 0.55,        // 顔とカメラの距離(m)
    cineZoomFov: 46,          // ズーム後のFOV(deg)
    cineMawDist: 0.30,        // 食われる直前の顔との距離(m)
    /* ---- P4.12 項目3「担ぎ運び」（契約 §4「P4.12 再プレイ差し戻し」項目3） ----
       段階3は床すれすれの引きずりではなく「敵の肩に担がれた視点」。
       敵の頭の後ろ・高さ約1.8m から後方（来た通路）を見る。 */
    cineCarrySpeed: 2.30,     // 運ばれていく見かけの速度(m/s)
    cineCarryEye: 1.80,       // 担がれた視点の高さ(m)。契約「約1.8m」
    cineCarryBack: 0.42,      // 敵の頭より後ろ（＝進行方向の逆）へずらす距離(m)
    cineCarrySide: 0.24,      // 担がれている肩の側への横ずらし(m)
    cineCarryPitch: 0.20,     // 見下ろし角(rad)。通路の床と天井灯が両方入る値
    cineCarryLead: 1.05,      // 敵の実体をカメラの前方（進行方向）へ置く距離(m)
    cineCarryLight: 1.00,     // 演出用ヘッドライトの強さ（契約「点灯扱いで視界を確保」）
    cineShake: 0.030,         // 揺れの基準振幅(rad)
    cineMashGain: 1.10,       // 連打で増える揺れの倍率（結果は変わらない）
    cineMashMax: 14,          // 連打の効き上限（回）
    cineFadeIn: 0.34,         // 暗転の落ちきり時間(s)

    /* ---- P4.10 敵2体（縄張り制）（契約 §4「敵2体・音の罠・地図リセット」） ---- */
    enemyCount: 2,            // 同時に稼働する個体数
    /* 個体差。index 0 が基準（= ENEMY_TUNING そのまま）、1 以降は差分だけ書く。
       契約「敵②は追跡速度やや遅め」。読み出しは ai.T（原型鎖で基準へ落ちる）。 */
    individuals: [
      { name: '敵①', seed: 3 },
      { name: '敵②', seed: 11, chaseSpeed: 4.70, patrolSpeed: 1.45, lockerHuntSpeed: 4.60 }
    ],
    /* 縄張りの外に出た時に戻る判断（追跡中は出てよい。見失ったら戻る） */
    territoryStartClear: 18.0,   // 巡回地点をプレイヤーのスタートから離す最短距離(m)
                              // （復帰＝スタート地点なので、契約§4「復帰直後に鉢合わせない」を保つ）
    territoryMinPoints: 3,       // 縄張り内の巡回地点の最低数（足りなければ自動生成）
    territoryMaxPoints: 6,
    territorySpacing: 6,         // 自動生成する巡回地点どうしの最短マス距離

    /* ---- P4.10-B 罠が鳴った瞬間（絶叫 → 猛スピード → 執拗な探索） ---- */
    /* 罠と見なす音イベントの kind。ここに載る音だけが「絶叫＋猛スピード」を起こす */
    /* 'step' は音地盤（ガラス片/金属板/水たまり）、'sensor' はセンサー警報＝いずれも既存の罠 */
    trapKinds: ['trap', 'step', 'sensor', 'can', 'creak', 'wire', 'shelf', 'plank', 'locker'],
    trapHearRadius: 999,      // 罠は施設全体に届く（契約「両方が反応」）
    trapInvestigateSpeed: 6.50, // 罠に反応した調査の疾走(m/s)。通常の investigateSpeed=5.0 から
    trapSearchDur: 14.00,     // 到着後の執拗な探索(s)。通常の searchDur=8.0 から
    trapLockerPeekChance: 0.92, // 罠の探索中にロッカーを覗く確率（通常0.55から上げる）
    trapPeekRadius: 13.0,     // 罠の探索中に覗く対象を探す半径(m)
    /* 復帰直後の猶予（契約 §4 の「復帰の緊張」は残しつつ、スタート地点に張り付かれる
       理不尽を避ける）。捕獲から復帰した後、結び目を拾うまでの間だけスタート周辺を空ける。 */
    respawnGraceDur: 60.0,    // 猶予の長さ(s)。結び目を拾えば即座に終わる
    respawnGraceRadius: 22.0, // スタート地点からこの距離には入らない(m)
    farReactDelay: 1.20,      // 近い個体が先着する。遠い個体はこの秒数だけ遅れて動く(s)
    farReactGap: 12.0,        // 「遠い個体」と見なす距離差(m)。これ未満なら同時に反応する
    shriekCooldown: 3.00      // 絶叫の連打防止(s)
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

  /** fill 済みの盤で (c,r) までの経路距離（マス数）。到達不能なら Infinity。
   *  P4.10: 音への反応順位と「先着」判定は直線距離ではなくこの経路距離で決める
   *  （迷路では直線で近い個体の方が経路では遠い、が普通に起きる）。 */
  Pathfinder.prototype.cellDist = function (c, r) {
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return Infinity;
    var i = r * this.w + c;
    if (this.seen[i] !== this.stamp) return Infinity;
    return this.dist[i];
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
   * P4.10 縄張り（契約 §4「敵2体（縄張り制）」）
   *
   * 縄張り＝マップの「帯」＝行範囲。定義の出どころは次の優先順で、
   * 新マップに差し替わっても meta を見て自動追従する。
   *   1. meta.territories / meta.enemyTerritories … 明示宣言（{r0,r1} / {rows:[a,b]}
   *      / {zones:['A','B','C']} / {regions:['hall',...]} のいずれでも書ける）
   *   2. meta.zoneBands … 区画帯（{zone,r0,r1}）の宣言があれば人数ぶんに束ねる
   *   3. meta.regions の zone から帯を復元できる場合（帯どうしが行方向で重ならない時のみ）
   *   4. どれも無ければ歩行可能な行範囲を人数ぶんに等分する（現行55x55マップ＝南半分/北半分）
   * 並び順は「プレイヤーのスタートを含む帯」が先頭＝契約の 敵①(南寄り) 側。
   * ============================================================== */

  function Territory(id, r0, r1, zones) {
    this.id = id;
    this.r0 = Math.min(r0, r1);
    this.r1 = Math.max(r0, r1);
    this.zones = zones || [];
  }
  Territory.prototype.contains = function (col, row) {
    return row >= this.r0 && row <= this.r1;
  };
  Territory.prototype.containsXZ = function (map, x, z) {
    return this.contains(map.colOf(x), map.rowOf(z));
  };

  /** meta の1宣言を Territory へ正規化する */
  function normTerritory(d, i, map) {
    var meta = map.meta || {};
    var r0 = null, r1 = null, zones = d.zones || d.zone && [d.zone] || [];
    if (typeof d.r0 === 'number' && typeof d.r1 === 'number') { r0 = d.r0; r1 = d.r1; }
    else if (d.rows && d.rows.length === 2) { r0 = d.rows[0]; r1 = d.rows[1]; }
    else {
      /* zones / regions から行範囲を組み立てる */
      var ids = d.regions || [];
      var list = meta.regions || [];
      for (var k = 0; k < list.length; k++) {
        var reg = list[k], hit = false;
        for (var a = 0; a < zones.length; a++) if (reg.zone === zones[a]) hit = true;
        for (var b = 0; b < ids.length; b++) if (reg.id === ids[b]) hit = true;
        if (!hit) continue;
        r0 = (r0 === null) ? reg.r0 : Math.min(r0, reg.r0);
        r1 = (r1 === null) ? reg.r1 : Math.max(r1, reg.r1);
      }
    }
    if (r0 === null) { r0 = 0; r1 = map.height - 1; }
    var terr = new Territory(d.id || ('t' + i), r0, r1, zones);
    /* マップが個体別の巡回路を宣言しているならその名前を持ち回る（meta.patrols[key]） */
    if (d.patrol && typeof d.patrol === 'string') terr.patrolKey = d.patrol;
    return terr;
  }

  /** meta.regions の zone から「帯」を復元する。帯として成立しない時は null */
  function bandsFromRegions(map) {
    var list = (map.meta && map.meta.regions) || [];
    var byZone = Object.create(null), order = [];
    for (var i = 0; i < list.length; i++) {
      var reg = list[i];
      if (!reg.zone) continue;
      if (!byZone[reg.zone]) { byZone[reg.zone] = { zone: reg.zone, r0: reg.r0, r1: reg.r1 }; order.push(reg.zone); }
      else {
        byZone[reg.zone].r0 = Math.min(byZone[reg.zone].r0, reg.r0);
        byZone[reg.zone].r1 = Math.max(byZone[reg.zone].r1, reg.r1);
      }
    }
    if (order.length < 2) return null;
    var bands = [];
    for (var j = 0; j < order.length; j++) bands.push(byZone[order[j]]);
    bands.sort(function (a, b) { return a.r0 - b.r0; });
    /* 帯として成立する＝行方向で重ならない（現行55x55マップはここで弾かれて等分へ落ちる） */
    for (var k = 1; k < bands.length; k++) if (bands[k].r0 <= bands[k - 1].r1) return null;
    return bands;
  }

  /** 帯の配列を n 個の連続した縄張りへ束ねる */
  function groupBands(bands, n) {
    var out = [], per = Math.ceil(bands.length / n);
    for (var i = 0; i < n; i++) {
      var slice = bands.slice(i * per, Math.min((i + 1) * per, bands.length));
      if (!slice.length) slice = [bands[bands.length - 1]];
      var r0 = slice[0].r0, r1 = slice[0].r1, zones = [];
      for (var j = 0; j < slice.length; j++) {
        r0 = Math.min(r0, slice[j].r0); r1 = Math.max(r1, slice[j].r1);
        if (slice[j].zone) zones.push(slice[j].zone);
      }
      out.push(new Territory(zones.join('') || ('t' + i), r0, r1, zones));
    }
    /* 帯と帯の隙間（岩盤帯・境界の通り抜け口）を取りこぼさないよう境界を詰める */
    for (var m = 1; m < out.length; m++) {
      var mid = Math.floor((out[m - 1].r1 + out[m].r0) / 2);
      out[m - 1].r1 = mid; out[m].r0 = mid + 1;
    }
    return out;
  }

  function resolveTerritories(map, n) {
    var meta = map.meta || {}, out = [], i;
    var decl = meta.territories || meta.enemyTerritories || null;
    if (decl && decl.length) {
      for (i = 0; i < n; i++) out.push(normTerritory(decl[i % decl.length], i, map));
    } else {
      var bands = (meta.zoneBands && meta.zoneBands.length >= 2) ? meta.zoneBands.slice() : bandsFromRegions(map);
      if (bands && bands.length >= n) {
        bands.sort(function (a, b) { return a.r0 - b.r0; });
        out = groupBands(bands, n);
      } else {
        /* 歩行可能な行範囲を等分する */
        var lo = map.height, hi = 0;
        for (var r = 0; r < map.height; r++) {
          for (var c = 0; c < map.width; c++) {
            if (!map.isWalkable(c, r)) continue;
            if (r < lo) lo = r;
            if (r > hi) hi = r;
            break;
          }
        }
        if (lo > hi) { lo = 0; hi = map.height - 1; }
        var span = (hi - lo + 1) / n;
        for (i = 0; i < n; i++) {
          out.push(new Territory('band' + i,
            Math.round(lo + span * i),
            (i === n - 1) ? hi : Math.round(lo + span * (i + 1)) - 1));
        }
      }
    }
    /* 契約: 先頭＝プレイヤーのスタートを含む帯（＝南寄り＝敵①の縄張り） */
    var sp = meta.spawn || { col: 1, row: 1 };
    for (i = 0; i < out.length; i++) {
      if (out[i].contains(sp.col, sp.row)) {
        var head = out.splice(i, 1)[0];
        out.unshift(head);
        break;
      }
    }
    return out;
  }

  /* ---- 縄張りごとの巡回路（meta.patrol を帯で切り分け、足りなければ自動生成） ---- */

  function planRoutes(map, terrs, rngSeed) {
    var meta = map.meta || {}, T = ENEMY_TUNING;
    var all = meta.patrol || [];
    var sp = meta.spawn || { col: 1, row: 1 };
    var reach = map.floodFrom(sp.col, sp.row);
    var tile = map.tileSize;
    var seed = rngSeed || 20260904;
    function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    function farFromStart(col, row) {
      return Math.hypot(col - sp.col, row - sp.row) * tile >= T.territoryStartClear;
    }
    var plans = [];
    for (var i = 0; i < terrs.length; i++) {
      var terr = terrs[i], pts = [];
      /* マップが個体別の巡回路を宣言していればそれが最優先（meta.patrols[key]） */
      var declared = (terr.patrolKey && meta.patrols && meta.patrols[terr.patrolKey]) || null;
      var src = declared || all;
      for (var k = 0; k < src.length; k++) {
        var p = src[k];
        if (!terr.contains(p.col, p.row)) continue;
        if (!map.isWalkable(p.col, p.row) || !reach[p.col + ',' + p.row]) continue;
        if (!farFromStart(p.col, p.row)) continue;
        pts.push({ col: p.col, row: p.row });
      }
      if (pts.length < T.territoryMinPoints) {
        /* 帯の中の歩行可能マスから、互いに離れた地点を拾って巡回路を作る */
        var cand = [];
        for (var r = terr.r0; r <= terr.r1; r++) {
          for (var c = 0; c < map.width; c++) {
            if (!map.isWalkable(c, r) || map.isBlocked(c, r)) continue;
            if (map.isCrawl && map.isCrawl(c, r)) continue;
            if (!reach[c + ',' + r]) continue;
            if (!farFromStart(c, r)) continue;
            cand.push({ col: c, row: r });
          }
        }
        /* 最遠点サンプリング（起点＝スタートから最も遠いマス＝復帰直後に鉢合わせない） */
        var first = null, fd = -1;
        for (var q = 0; q < cand.length; q++) {
          var d0 = Math.hypot(cand[q].col - sp.col, cand[q].row - sp.row);
          if (d0 > fd) { fd = d0; first = cand[q]; }
        }
        if (first) {
          if (!pts.length) pts.push(first);
          var guard = 0;
          while (pts.length < T.territoryMaxPoints && guard++ < 64 && cand.length) {
            var best = null, bd = -1;
            for (var w = 0; w < cand.length; w++) {
              var near = Infinity;
              for (var v = 0; v < pts.length; v++) {
                var dd = Math.hypot(cand[w].col - pts[v].col, cand[w].row - pts[v].row);
                if (dd < near) near = dd;
              }
              if (near > bd) { bd = near; best = cand[w]; }
            }
            if (!best || bd < T.territorySpacing) break;
            pts.push(best);
          }
        }
      }
      /* 近傍順に並べ替えて素直なループにする */
      var route = [];
      if (pts.length) {
        var pool = pts.slice(), cur = pool.shift();
        route.push(cur);
        while (pool.length) {
          var bi = 0, bdd = Infinity;
          for (var z = 0; z < pool.length; z++) {
            var d2 = Math.hypot(pool[z].col - cur.col, pool[z].row - cur.row);
            if (d2 < bdd) { bdd = d2; bi = z; }
          }
          cur = pool.splice(bi, 1)[0];
          route.push(cur);
        }
      }
      plans.push({ territory: terr, route: route, rand: rand });
    }
    /* スポーン: meta.enemySpawns[i] > 縄張りに入る meta.enemySpawn > 巡回路の先頭 */
    var spawns = meta.enemySpawns || null;
    for (var m = 0; m < plans.length; m++) {
      var pl = plans[m], s = null;
      if (spawns) {
        /* territory 名で突き合わせる（宣言順が縄張りの解決順と違っても正しく配る） */
        for (var y0 = 0; y0 < spawns.length && !s; y0++) {
          if (spawns[y0].territory && spawns[y0].territory === pl.territory.id) s = spawns[y0];
        }
        if (!s && spawns[m] && !spawns[m].territory) s = spawns[m];
      }
      if (!s && meta.enemySpawn && pl.territory.contains(meta.enemySpawn.col, meta.enemySpawn.row)) {
        s = meta.enemySpawn;
      }
      if (!s && pl.route.length) s = pl.route[0];
      if (!s) s = meta.enemySpawn || sp;
      pl.spawn = s;
    }
    /* 契約の互換: meta.enemySpawn を持つ個体を list[0]（= game.ai）にする。
       既存の機械テスト「復帰: 敵が巡回起点にいる」と、P4.9 が meta.enemySpawns を
       与えた場合の宣言順の両方を壊さない。 */
    if (spawns && spawns.length) {
      /* 宣言順＝契約の 敵①/敵② の番号。個体差（敵②は遅め）もこの順で当たる */
      var ordered = [];
      for (var z0 = 0; z0 < spawns.length; z0++) {
        for (var z1 = 0; z1 < plans.length; z1++) {
          if (plans[z1] && plans[z1].spawn === spawns[z0]) { ordered.push(plans[z1]); plans[z1] = null; break; }
        }
      }
      for (var z2 = 0; z2 < plans.length; z2++) if (plans[z2]) ordered.push(plans[z2]);
      plans = ordered;
    } else if (meta.enemySpawn) {
      for (var y = 0; y < plans.length; y++) {
        if (plans[y].spawn === meta.enemySpawn) {
          if (y > 0) plans.unshift(plans.splice(y, 1)[0]);
          break;
        }
      }
    }
    return plans;
  }

  /* ================================================================
   * 敵AI
   * ============================================================== */
  /** opts: { index, plan, tuning } — 個体差と縄張りは AIManager が配る */
  function EnemyAI(game, opts) {
    opts = opts || {};
    this.game = game;
    this.index = opts.index || 0;
    /* 個体差は原型鎖で基準へ落ちる（差分だけ持つ＝定数の集約は ENEMY_TUNING 1本のまま） */
    this.T = opts.tuning || ENEMY_TUNING;
    this.name = (this.T.name) || ('敵' + (this.index + 1));
    this.plan = opts.plan || null;
    this.manager = null;
    this.map = game.map;
    this.enemy = new ESCAPE.Enemy({ seed: (this.T.seed || 3) });
    this.enemy.group.name = 'enemy' + this.index;
    this.enemy.group.visible = true;
    game.scene.add(this.enemy.group);
    this.manual = false;          /* __enemyDebug が握っている間は駆動しない */
    this.resetSelf();
  }

  /** 複数個体では list[0]（= game.ai）が全体の窓口。個別は resetSelf */
  EnemyAI.prototype.reset = function () {
    var m = this.manager;
    if (m && m.list[0] === this) { m.reset(); return; }
    this.resetSelf();
  };

  EnemyAI.prototype.resetSelf = function () {
    this.map = this.game.map;
    this.pf = new Pathfinder(this.map);
    this._lum = Object.create(null);
    this._rng = 20260902 + this.index * 7919;
    var meta = this.map.meta || {};
    /* P4.10: 巡回は縄張りの中だけ。plan が無い（単体運用）なら従来どおり meta.patrol 全周 */
    this.territory = this.plan ? this.plan.territory : null;
    this.route = (this.plan && this.plan.route && this.plan.route.length)
      ? this.plan.route : (meta.patrol || []);
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
    /* P4.10: 罠に反応した調査か（絶叫→猛スピード→執拗な探索） */
    this.alert = false;
    this.holdT = 0;              /* 遠い個体が走り出すまでの一拍(s) */
    this.screams = 0;
    this.trapAlerts = 0;
    this.returns = 0;            /* 縄張りの外から戻った回数 */
    this.outside = false;
    this._shriekT = 0;

    var sp = (this.plan && this.plan.spawn) || meta.enemySpawn || this.route[0] ||
      meta.spawn || { col: 1, row: 1 };
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
    /* P4.8: ヘッドライト点灯中は見つかりやすい。点灯判定の持ち主は
       ESCAPE.Headlight ただ1つで、ここは**読むだけ**（毎フレーム上書きの衝突を作らない）。 */
    var hl = this.game.headlight;
    if (hl && hl.on) base *= T.headlightSightMul;
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

  /* ---------------- 体格（P4.12 項目6「敵を大きく」） ----------------
   * 敵は壁と押し合わない（経路が通路の中心を通る）ので、当たりの「半径」は
   * 角を丸める近道の余裕として効く。体格倍率をそのまま掛ける＝大きい個体ほど
   * 通路の中心を通る。捕獲の接触距離も同じ倍率で伸ばす（腕が長くなったぶん）。 */

  /** いまの体格倍率（モデルが持つ実値。天井で縮んでいればそれも反映される） */
  EnemyAI.prototype.bodyScale = function () {
    var e = this.enemy;
    return (e && typeof e.scale === 'number' && e.scale > 0) ? e.scale : 1;
  };
  /** 経路の見通し判定に使う体の半径(m) */
  EnemyAI.prototype._radius = function () { return this.T.radius * this.bodyScale(); };
  /** 捕獲の接触距離(m) */
  EnemyAI.prototype.catchDist = function () { return this.T.catchDist * this.bodyScale(); };

  /** 半径ぶんの余裕をみて直進できるか（経路の角丸め用） */
  EnemyAI.prototype._clearLine = function (x0, z0, x1, z1) {
    var map = this.map, r = this._radius();
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
    /* P4.10: 追跡で縄張りを出ていたなら、巡回へ戻る＝自分の帯へ帰る（route が帯の中にある） */
    if (this.territory && !this.territory.containsXZ(this.map, this.enemy.x, this.enemy.z)) {
      this.returns++;
      this.outside = true;
    }
    this.state = 'patrol'; this.stateTime = 0;
    this.alert = false;
    this.peekDone = false;
    this.lockerTarget = null;
    this.path = null; this.goal = null; this.repathT = 0;
    this.lostTime = 0; this.arrived = false;
    this.routeIdx = this._nearestRouteIdx();
    /* 巡回へ戻った直後は必ず歩き出す（立ち止まりは firstPause 秒より後） */
    this.pauseT = 0;
    this.pauseNext = this.patrolTime + this.T.patrolPauseFirst;
  };
  EnemyAI.prototype.toInvestigate = function (x, z, alert) {
    if (this.state === 'chase' || this.state === 'caught') return false;
    /* 復帰直後の猶予帯で鳴った音には寄らない（結び目を拾うまでの逃げ道を残す） */
    if (this.graceBlocked(x, z)) return false;
    /* 見られたロッカーへ向かっている最中は、他の音では逸れない（駆け引きの筋を通す） */
    if (this.state === 'locker' && this.lockerTarget && this.lockerTarget.forced) return false;
    this.alert = !!alert;
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
    /* P4.10: 捕まえた個体を渡す（演出・赤い目・高解像度顔はこの個体で動く） */
    if (!st || !st.capture(this)) return;
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
    /* P4.10: 捕獲前の音の余韻は捨てる（復帰した途端に古い音源へ走り出さない） */
    this.holdT = 0;
    this._shriekT = 0;
    this.outside = false;
    this.toPatrol();
  };

  /* ---------------- 聴覚 ---------------- */

  /** 音を聞き取れるか（罠は施設全体に届く＝契約「音の罠には両方が反応」） */
  EnemyAI.prototype.hears = function (ev, alert) {
    var e = this.enemy;
    var d = Math.hypot(ev.x - e.x, ev.z - e.z);
    if (alert) return d <= Math.max(ev.radius, this.T.trapHearRadius);
    return d <= ev.radius && d <= this.T.hearMax;
  };

  /**
   * 音イベントを受け取る（配るのは AIManager。単体運用なら _hear が呼ぶ）。
   * delay > 0 の個体は「遠い方」＝**気づくのは同時、走り出すのが遅れる**
   * （契約「近い方が猛スピードで来て遠い方も遅れて寄る」）。
   * 状態を遅らせないので、音に対する反応そのものは常に同じフレームで起きる。
   */
  EnemyAI.prototype.receiveNoise = function (ev, alert, delay) {
    if (this.manual || this.cine || this.state === 'caught') return false;
    var ok = this._applyNoise(ev.x, ev.z, alert);
    if (ok && delay > 0) this.holdT = delay;   /* その場で身構えてから走り出す */
    return ok;
  };

  EnemyAI.prototype._applyNoise = function (x, z, alert) {
    var was = this.state;
    if (!this.toInvestigate(x, z, alert)) return false;
    this.holdT = 0;
    if (alert) {
      this.trapAlerts++;
      /* 契約 §4「罠が鳴った瞬間、敵の絶叫が施設全体に響く（方向が分かる立体音）」 */
      this.shriek();
    } else if (was === 'patrol') {
      /* 通常の音は静かに向かう（形態遷移の骨鳴りは _applyForm 側） */
    }
    return true;
  };

  /** 絶叫（施設全体に届く。連打は cooldown で間引く） */
  EnemyAI.prototype.shriek = function () {
    if (this._shriekT > 0) return false;
    this._shriekT = this.T.shriekCooldown;
    this.screams++;
    sfx('shriek', { x: this.enemy.x, z: this.enemy.z });
    return true;
  };

  /** 単体運用（manager 無し）の互換経路。複数個体では AIManager が配る */
  EnemyAI.prototype._hear = function () {
    if (this.manager) return;
    var evs = ESCAPE.noise.consume();
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      var alert = isTrapKind(ev.kind);
      if (!this.hears(ev, alert)) continue;
      this._applyNoise(ev.x, ev.z, alert);
    }
  };

  /** 復帰直後の猶予帯にいるか（追跡中は例外＝見つかったのは自分の落ち度） */
  EnemyAI.prototype.graceBlocked = function (x, z) {
    var m = this.manager;
    if (!m || m.graceT <= 0) return false;
    if (this.state === 'chase' || this.state === 'caught') return false;
    return Math.hypot(x - m.graceX, z - m.graceZ) < this.T.respawnGraceRadius;
  };

  /** 罠の音か（絶叫＋猛スピードを起こす kind） */
  function isTrapKind(kind) {
    var list = ENEMY_TUNING.trapKinds;
    for (var i = 0; i < list.length; i++) if (list[i] === kind) return true;
    return false;
  }

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

  /** ゲームループの窓口。複数個体では list[0] が全体を回す（game.js は ai.step のみ呼ぶ） */
  EnemyAI.prototype.step = function (dt) {
    var m = this.manager;
    if (m && m.list[0] === this) { m.step(dt); return; }
    this.stepSelf(dt);
  };

  EnemyAI.prototype.stepSelf = function (dt) {
    if (this.manual || this.cine) return;
    var g = this.game, T = this.T, e = this.enemy;
    this.stateTime += dt;
    if (this._shriekT > 0) this._shriekT -= dt;
    if (this.holdT > 0) this.holdT -= dt;
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
        /* P4.10: 経路距離で明らかに遠い個体は、気づいてから走り出すまでに一拍置く
           （＝近い方が先着する）。身構えている間は音源の方を向くだけ。 */
        if (this.holdT > 0) {
          this.speed = 0;
          this._face(dt, { x: this.target.x - e.x, z: this.target.z - e.z });
          break;
        }
        /* 契約 §4: 音源へ疾走 → 到着したら周辺を探索(searchDur) → 直立へ戻り巡回。
           P4.10: 罠が鳴った時は猛スピード（investigateSpeed 5.0 → trapInvestigateSpeed 6.5） */
        if (this._moveTo(dt, this.target.x, this.target.z,
            this.alert ? T.trapInvestigateSpeed : T.investigateSpeed)) {
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
        if (dist <= this.catchDist() && !(st && st.hidden())) { this.onCatch(); break; }
        if ((this.lostTime > T.loseSightGrace && dist > T.giveUpDist) || this.lostTime > T.giveUpTime) {
          this.toSearch();
        }
        break;

      case 'search':
        if (see) { this.toChase(); break; }
        /* P4.10: 罠に反応した探索は執拗（searchDur 8 → trapSearchDur 14） */
        if (this.stateTime >= (this.alert ? T.trapSearchDur : T.searchDur)) { this.toPatrol(); break; }
        /* 契約 §4「探索中の敵は近くのロッカーを1つ開けて覗く（ランダム）」 */
        if (!this.peekDone) {
          this.peekDone = true;
          if (this.rand() < (this.alert ? T.trapLockerPeekChance : T.lockerPeekChance)) {
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
    /* P4.10: 縄張りの外にいる間は寄り道しない＝まっすぐ自分の帯へ帰る。
       巡回路は帯の中にしか無いので、次の巡回地点へ向かうこと自体が「帰還」になる。 */
    if (this.territory) {
      var inside = this.territory.containsXZ(this.map, this.enemy.x, this.enemy.z);
      if (this.outside && inside) this.outside = false;
      else if (!inside) {
        this.outside = true;
        this.patrolTime += dt;
        this.pauseT = 0;
        var back = this.route[this.routeIdx % this.route.length];
        var bc = this.map.cellCenter(back.col, back.row);
        if (this._moveTo(dt, bc.x, bc.z, T.patrolSpeed)) {
          this.routeIdx = (this.routeIdx + 1) % this.route.length;
          this.path = null; this.goal = null; this.repathT = 0;
        }
        return;
      }
    }
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
    /* 復帰直後の猶予: スタート周辺の巡回地点は飛ばす（張り付かない） */
    for (var gi = 0; gi < this.route.length && this.graceBlocked(c.x, c.z); gi++) {
      this.routeIdx = (this.routeIdx + 1) % this.route.length;
      this.path = null; this.goal = null; this.repathT = 0;
      n = this.route[this.routeIdx % this.route.length];
      c = this.map.cellCenter(n.col, n.row);
    }
    if (this.graceBlocked(this.enemy.x, this.enemy.z) &&
        this.graceBlocked(c.x, c.z)) { this.speed = 0; return; }
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
      if (this.graceBlocked(cc.x, cc.z)) continue;
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
      if (st.captureFromLocker(this)) {
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
      if (d > (this.alert ? this.T.trapPeekRadius : this.T.lockerPeekRadius)) continue;
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
      /* P4.10 */
      index: this.index, name: this.name,
      territory: this.territory ? (this.territory.id + ':' + this.territory.r0 + '-' + this.territory.r1) : null,
      inTerritory: this.territory ? this.territory.containsXZ(this.map, e.x, e.z) : true,
      routeLen: this.route.length, alert: this.alert, screams: this.screams,
      trapAlerts: this.trapAlerts, returns: this.returns,
      manual: this.manual, cine: this.cine, lockerOpens: this.lockerOpens,
      lockerTarget: this.lockerTarget ? (this.lockerTarget.col + ',' + this.lockerTarget.row +
        (this.lockerTarget.forced ? ':forced' : ':peek')) : null
    };
  };

  /* ================================================================
   * P4.10 AIManager — 複数個体の窓口
   *   - 音イベントの consume はここ1箇所だけ（個体ごとに consume すると
   *     先に回った個体がイベントを持ち去る＝「片方しか反応しない」事故になる）
   *   - game.js は従来どおり game.ai.step / game.ai.reset しか呼ばない。
   *     list[0].step が全体を回す（上書き事故を作らないよう入口を1本に保つ）。
   * ============================================================== */
  function AIManager(game) {
    this.game = game;
    this.list = [];
    this.T = ENEMY_TUNING;
    this.noiseEvents = 0;
    this.graces = 0;
    this.clearGrace();
    var n = Math.max(1, ENEMY_TUNING.enemyCount | 0);
    var plans = this._plan(game.map, n);
    for (var i = 0; i < n; i++) {
      var ai = new EnemyAI(game, { index: i, plan: plans[i], tuning: tuningFor(i) });
      ai.manager = this;
      this.list.push(ai);
    }
  }

  /** 個体差の定数（原型鎖で ENEMY_TUNING に落ちる） */
  function tuningFor(i) {
    var ind = (ENEMY_TUNING.individuals || [])[i];
    if (!ind) return ENEMY_TUNING;
    var t = Object.create(ENEMY_TUNING);
    for (var k in ind) if (Object.prototype.hasOwnProperty.call(ind, k)) t[k] = ind[k];
    return t;
  }

  AIManager.prototype._plan = function (map, n) {
    this.territories = resolveTerritories(map, n);
    return planRoutes(map, this.territories, 20260904);
  };

  AIManager.prototype.reset = function () {
    var plans = this._plan(this.game.map, this.list.length);
    for (var i = 0; i < this.list.length; i++) {
      this.list[i].plan = plans[i];
      this.list[i].resetSelf();
    }
    this.noiseEvents = 0;
    this.graces = 0;
    this.clearGrace();
  };

  /** 復帰直後の猶予を張る（スタート地点まわりを空ける） */
  AIManager.prototype.beginGrace = function () {
    var meta = this.game.map.meta || {};
    var sp = meta.spawn || { col: 1, row: 1 };
    var c = this.game.map.cellCenter(sp.col, sp.row);
    this.graceX = c.x; this.graceZ = c.z;
    this.graceT = ENEMY_TUNING.respawnGraceDur;
    this.graces = (this.graces || 0) + 1;
  };
  AIManager.prototype.clearGrace = function () {
    this.graceT = 0; this.graceX = 0; this.graceZ = 0;
  };

  AIManager.prototype.afterJail = function () {
    for (var i = 0; i < this.list.length; i++) this.list[i].afterJail();
    /* 契約 §4「復帰後は自分のロープだけが頼り」。拾いに戻る間だけスタートを空ける */
    this.beginGrace();
  };

  /** 個体から (x,z) までの**経路距離(m)**。到達不能なら直線距離で代用する。
   *  盤は個体ごとに1回だけ張る（同じフレームの複数イベントで使い回す）。 */
  AIManager.prototype.pathDistTo = function (ai, x, z, reuse) {
    var map = ai.map;
    var c0 = map.colOf(ai.enemy.x), r0 = map.rowOf(ai.enemy.z);
    if (!reuse || ai._pfFillCell !== (c0 + ',' + r0)) {
      ai._pfFilled = ai.pf.fill(c0, r0);
      ai._pfFillCell = c0 + ',' + r0;
    }
    var straight = Math.hypot(x - ai.enemy.x, z - ai.enemy.z);
    if (!ai._pfFilled) return straight;
    var d = ai.pf.cellDist(map.colOf(x), map.rowOf(z));
    if (!isFinite(d)) return straight;
    return d * map.tileSize;
  };

  /** 音を全個体へ配る。経路距離が近い順に反応し、遠い個体は farReactDelay ぶん遅れて寄る */
  AIManager.prototype.dispatchNoise = function () {
    var evs = ESCAPE.noise.consume();
    if (!evs.length) return;
    var T = ENEMY_TUNING;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      var alert = isTrapKind(ev.kind);
      this.noiseEvents++;
      var resp = [];
      for (var k = 0; k < this.list.length; k++) {
        var ai = this.list[k];
        if (ai.manual || ai.cine || ai.state === 'caught') continue;
        if (!ai.hears(ev, alert)) continue;
        /* 聞こえるか＝直線距離（音は壁を回らない）。誰が先に着くか＝経路距離。 */
        resp.push({ ai: ai, d: this.pathDistTo(ai, ev.x, ev.z, i > 0) });
      }
      resp.sort(function (a, b) { return a.d - b.d; });
      for (var m = 0; m < resp.length; m++) {
        /* 明らかに遠い個体だけが「遅れて寄る」。僅差なら同時に走り出す
           （＝近い方が先着するのは距離の差そのもの） */
        var lag = (m > 0 && alert && (resp[m].d - resp[0].d) > T.farReactGap)
          ? T.farReactDelay * m : 0;
        resp[m].ai.receiveNoise(ev, alert, lag);
      }
    }
  };

  AIManager.prototype.step = function (dt) {
    var st = this.game.stealth;
    /* 猶予は「60秒経つ」か「結び目を拾ってロープに再接続する」かで終わる */
    if (this.graceT > 0) {
      var rope = this.game.rope;
      if (rope && rope.isAttached && rope.isAttached()) this.clearGrace();
      else this.graceT -= dt;
      if (this.graceT < 0) this.graceT = 0;
    }
    /* 捕獲演出中は全個体を止める。演出が画面を握っている間に別個体が歩き回ると、
       復帰した瞬間に理不尽な再捕獲が起きる（契約 §6 の中断安全）。 */
    var frozen = !!(st && st.jail && st.jail.phase !== 'none');
    if (frozen) ESCAPE.noise.consume();      /* 溜め込まない */
    else this.dispatchNoise();
    for (var i = 0; i < this.list.length; i++) {
      var ai = this.list[i];
      if (frozen && ai.state !== 'caught' && !ai.cine) { ai.speed = 0; continue; }
      ai.stepSelf(dt);
    }
  };

  /** 捕まえた個体（演出の主役）。captor が未設定なら list[0] */
  AIManager.prototype.captor = function () {
    for (var i = 0; i < this.list.length; i++) if (this.list[i].state === 'caught') return this.list[i];
    return this.list[0];
  };

  AIManager.prototype.nearest = function (x, z) {
    var best = null, bd = Infinity;
    for (var i = 0; i < this.list.length; i++) {
      var e = this.list[i].enemy;
      var d = Math.hypot(e.x - x, e.z - z);
      if (d < bd) { bd = d; best = this.list[i]; }
    }
    return best;
  };

  AIManager.prototype.info = function () {
    var out = [];
    for (var i = 0; i < this.list.length; i++) out.push(this.list[i].info());
    return out;
  };

  AIManager.prototype.graceInfo = function () {
    return { t: this.graceT, x: this.graceX, z: this.graceZ,
      radius: ENEMY_TUNING.respawnGraceRadius, count: this.graces || 0 };
  };

  ESCAPE.EnemyAI = EnemyAI;
  ESCAPE.AIManager = AIManager;
  ESCAPE.Territory = Territory;
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
    this.capturedBy = null;      /* P4.10: 捕まえた個体（演出の主役） */
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
      /* P4.11 項目3「罠は道の端で回避可能」: 音地盤（ガラス片・金属板・水たまり）も
         造形と発火をマス中央の60%幅に限る。両端 0.4m は素の床＝端を走っても鳴らない。
         幅の定数は js/traps.js の TRAP_TUNING.stepBand が正（造形も同じ値を読む）。 */
      var bh = (ESCAPE.World && ESCAPE.World.stepBandHalf)
        ? ESCAPE.World.stepBandHalf(map, col, row) : { x: 0.60, z: 0.60 };
      if (Math.abs(p.x - c.x) > bh.x || Math.abs(p.z - c.z) > bh.z) return;
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
        var k = list[i].kind;
        this._noiseKinds[list[i].col + ',' + list[i].row] =
          (k === 'glass' || k === 'metal') ? k : 'water';
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
    /* 契約 §4「敵がプレイヤーがロッカーに入るのを見た場合は開けて引きずり出す」。
       判定は「入る瞬間」＝ プレイヤーをまだ隠す前にここで1度だけ取る。
       P4.10: 見たのがどちらの個体でも成立する（見た個体が開けに来る）。 */
    var list = this.game.ais ? this.game.ais.list : (this.game.ai ? [this.game.ai] : []);
    var ai = null;
    for (var q = 0; q < list.length; q++) {
      var cand = list[q];
      if (cand.manual || cand.cine || cand.state === 'caught') continue;
      if (cand.canSeePlayer()) { ai = cand; break; }
    }
    var seen = !!ai;
    if (!ai) ai = this.game.ai;
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
  Stealth.prototype.captureFromLocker = function (byAi) {
    if (!this.locker || this.jail.phase !== 'none') return false;
    this.exitLocker();
    this.lockerCaptures++;
    return this.capture(byAi);
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

  /** 敵に捕まった。演出中なら false（多重捕獲の防止）。byAi = 捕まえた個体（P4.10） */
  Stealth.prototype.capture = function (byAi) {
    if (this.jail.phase !== 'none') return false;
    if (this.locker) return false;
    this.captures++;
    var J = this.jail;
    J.phase = 'grab'; J.t = 0; J.pry = 0;
    J.reset = (this.captures >= this.T.captureLimit);
    this.capturedBy = byAi || this.game.ai;
    this.game.player.speed = 0;
    /* P4.10（契約 §4「捕獲のたびに地図を真っ暗に戻す」）: fog of war の踏破を全消去。
       ロープの軌跡・結び目・錨（rope が持つ）／鍵の取得（progress が持つ）／
       読んだ区画名（minimap.zones）は残る＝復帰後は自分のロープだけが頼りになる。 */
    if (this.game.minimap && this.game.minimap.onCapture) this.game.minimap.onCapture();
    /* P4.8（契約 §4「捕獲時」）: 掴まれた瞬間にロープ端が床に落ちて結び目になる。
       復帰後は自分の敷いたロープを辿って結び目まで戻り「拾って結ぶ」で再接続する。 */
    if (this.game.rope) this.game.rope.dropKnot();
    /* 消した地図と落ちた結び目をこの時点で保存する（次のセーブ機会まで古い踏破が
       残り、再読み込みで地図が戻ってしまうのを防ぐ）。鍵・読んだメモは save が保持する。 */
    if (this.game.progress && this.game.progress.save) this.game.progress.save();
    /* 契約 §4「捕獲時に耳元の音＋暗転」 */
    sfx('capture', {});
    /* P4.6: 捕獲シネマティック（毎回）。3回目は「食われる」に差し替わる。
       演出モジュールが無い環境では従来の短い暗転にフォールバックする。 */
    var cine = this.game.cinematic;
    this.cine = (cine && cine.begin(J.reset ? 'eaten' : 'jail', this.capturedBy)) ? cine : null;
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

  /** 演出が終わった後の分岐（2026-09-03 P4.8 改訂・ユーザー決定）:
   *  通常は**スタート地点（ロープの固定結び目の傍）で目覚める**。3回目はゲームオーバー画面へ。
   *  旧「牢送り（拘束室の房で目覚めて格子をこじ開ける）」は失効＝この経路には現れない。 */
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
    this._toStart();
    /* P4.10: 全個体を巡回起点へ戻す（片方だけ戻すと、もう1体がスタート地点に
       張り付いたままになり復帰した瞬間に再捕獲される） */
    if (g.ais) g.ais.afterJail();
    else if (g.ai) g.ai.afterJail();
    this.capturedBy = null;
    J.phase = 'wake';
  };

  /** P4.8: スタート地点へ戻す（進行状態＝鍵・地図の踏破・読んだメモは保持） */
  Stealth.prototype._toStart = function () {
    var map = this.map, meta = map.meta || {}, p = this.game.player;
    var sp = meta.spawn || { col: 1, row: 1, yawDeg: 0 };
    var J = this.jail;
    J.col = sp.col; J.row = sp.row; J.dir = null;
    var c = map.cellCenter(sp.col, sp.row);
    p.x = c.x; p.z = c.z;
    p.y = map.floorYAt(c.x, c.z);
    p.pitch = 0;
    p.crouching = false;
    p.eyeHeight = ESCAPE.Player.EYE_STAND;
    p.speed = 0;
    p.yaw = (sp.yawDeg || 0) * Math.PI / 180;
    this.game.input.reset();
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

  /** 【P4.8 失効】拘束室の房へ運ぶ（旧・牢送り）。
   *  2026-09-03 のユーザー決定で復帰先はスタート地点になったため、この関数と
   *  jail.phase 'locked'/'black'、_confineToCell / _pry / _breakGrate / 格子メッシュは
   *  **到達不能**になった。拘束室は「場所として残す」契約なので造形と房は残っている。
   *  コードは記録として残すが、通常経路からは呼ばれない。 */
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
    this.capturedBy = null;
    if (g.ais) g.ais.reset();
    else if (g.ai) g.ai.reset();
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
    /* P4.10: 敵は複数体（縄張り制）。game.ai は従来どおり先頭個体を指す＝
       game.js / 既存の検証フックはそのまま動き、全体の駆動は list[0] が回す。 */
    g.ais = new AIManager(g);
    g.ai = g.ais.list[0];
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
      /* ---- P4.10 複数個体 ---- */
      ais: function () { return ESCAPE.game.ais; },
      at: function (i) { return ESCAPE.game.ais.list[i | 0]; },
      infoAll: function () { return ESCAPE.game.ais.info(); },
      territories: function () {
        var ts = ESCAPE.game.ais.territories, out = [];
        for (var i = 0; i < ts.length; i++) out.push({ id: ts[i].id, r0: ts[i].r0, r1: ts[i].r1, zones: ts[i].zones });
        return out;
      },
      /** 個体 i をマス指定で置く */
      placeAt: function (i, col, row, yawDeg, state) {
        var ai = ESCAPE.game.ais.list[i | 0];
        ai.enemy.placeCell(col, row, yawDeg === undefined ? 180 : yawDeg, ai.map);
        ai.path = null; ai.goal = null; ai.repathT = 0;
        if (state) { ai.state = state; ai.stateTime = 0; }
        return ai.info();
      },
      trap: function (col, row, radius) { return ESCAPE.noise.emitCell(col, row, radius || 24, 'trap'); },
      /** 任意のマップに対する縄張り・巡回路の解決結果（マップ差し替えの事前確認用） */
      planFor: function (map, n) {
        var m = map || ESCAPE.game.map;
        var ts = resolveTerritories(m, n || ENEMY_TUNING.enemyCount);
        var plans = planRoutes(m, ts, 20260904);
        var out = [];
        for (var i = 0; i < plans.length; i++) {
          var pl = plans[i], bad = 0;
          for (var k = 0; k < pl.route.length; k++) {
            if (!pl.territory.contains(pl.route[k].col, pl.route[k].row)) bad++;
          }
          out.push({
            territory: pl.territory.id + ':' + pl.territory.r0 + '-' + pl.territory.r1,
            zones: pl.territory.zones.join(''),
            spawn: pl.spawn.col + ',' + pl.spawn.row,
            spawnInside: pl.territory.contains(pl.spawn.col, pl.spawn.row),
            route: pl.route.length, outsideRoutePoints: bad
          });
        }
        return out;
      },
      interact: function () { return ESCAPE.game.stealth.onInteract(); },
      cine: function () { return ESCAPE.game.cinematic ? ESCAPE.game.cinematic.info() : null; },
      reset: function () { ESCAPE.game.ai.reset(); ESCAPE.game.stealth.reset(); }
    };
  }


  /* ================================================================
   * P4.10 機械テスト（契約 §4「敵2体・音の罠・地図リセット」）
   *
   * test.js への結線が済むまでの受け皿として、スイートはここで自前登録する。
   *   ESCAPE.__extraSuites … runAll が拾う登録配列（[fn(t, g), ...]）
   *   window.__test.runExtra() … 単独実行（test.js を触らずに全通過を示せる）
   * 署名は test.js の suites と同じ (t, g) なので、結線は runAll 側の1行で済む。
   * ============================================================== */
  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];

  var DT = function () { return ESCAPE.FIXED_DT; };

  function sim(g, n) { for (var i = 0; i < n; i++) g.stepFrame(ESCAPE.FIXED_DT); }
  function simUntil(g, cond, maxFrames) {
    for (var i = 0; i < maxFrames; i++) {
      if (cond()) return i;
      g.stepFrame(ESCAPE.FIXED_DT);
    }
    return cond() ? maxFrames : -1;
  }
  function placePlayer(g, col, row, yawDeg) {
    var c = g.map.cellCenter(col, row), p = g.player;
    p.x = c.x; p.z = c.z; p.y = g.map.floorYAt(c.x, c.z);
    p.yaw = (yawDeg || 0) * Math.PI / 180;
    p.pitch = 0; p.speed = 0; p.crouching = false;
  }
  function putEnemy(ai, col, row, yawDeg) {
    ai.enemy.placeCell(col, row, yawDeg === undefined ? 180 : yawDeg, ai.map);
    ai.path = null; ai.goal = null; ai.repathT = 0;
  }
  /** プレイヤーを敵から見えない状態にする（ロッカー）。駆け引きを止めずに巡回だけを見たい時用 */
  function hidePlayer(g) {
    var list = (g.map.meta && g.map.meta.lockers) || [];
    var best = null, bd = -1;
    for (var i = 0; i < list.length; i++) {
      var c = g.map.cellCenter(list[i].col, list[i].row);
      var d = Infinity;
      var ais = g.ais.list;
      for (var k = 0; k < ais.length; k++) {
        d = Math.min(d, Math.hypot(ais[k].enemy.x - c.x, ais[k].enemy.z - c.z));
      }
      if (d > bd) { bd = d; best = list[i]; }
    }
    if (!best) return false;
    var cc = g.map.cellCenter(best.col, best.row);
    g.player.x = cc.x; g.player.z = cc.z;
    return g.stealth.enterLocker(best.col, best.row) && g.stealth.hidden();
  }
  /** 敵から 8〜18m 離れ、視線が通らないマスを探す（音源用） */
  function noiseSpot(g, ai, near, far) {
    var cells = g.map.walkableCells(), e = ai.enemy;
    for (var i = 0; i < cells.length; i++) {
      var c = g.map.cellCenter(cells[i].col, cells[i].row);
      var d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d < near || d > far) continue;
      if (!ai.blockedLine(e.x, e.z, c.x, c.z)) continue;
      return { col: cells[i].col, row: cells[i].row, x: c.x, z: c.z, dist: d };
    }
    return null;
  }

  /* ---------------- A: 敵2体・縄張り ---------------- */

  function testEnemyPairContract(t, g) {
    g.reset();
    var T = ENEMY_TUNING;
    t.ok(T.enemyCount === 2, 'P4.10 敵2体: 稼働個体数は2（契約）', T.enemyCount);
    t.ok(!!g.ais && g.ais.list.length === 2, 'P4.10 敵2体: AIManager が2個体を持つ',
      g.ais ? g.ais.list.length : 'なし');
    if (!g.ais || g.ais.list.length < 2) return;
    var a0 = g.ais.list[0], a1 = g.ais.list[1];
    t.ok(g.ai === a0, 'P4.10 敵2体: game.ai は先頭個体を指す（既存の結線を壊さない）');
    t.ok(a0.enemy !== a1.enemy, 'P4.10 敵2体: 個体ごとに実体（モデル）を持つ');
    t.ok(a0.enemy.group.visible && a1.enemy.group.visible, 'P4.10 敵2体: 2体ともシーンに出ている');
    t.ok(a0.enemy.group.parent === g.scene && a1.enemy.group.parent === g.scene,
      'P4.10 敵2体: 2体ともシーンに追加されている');

    /* 個体差（契約「敵②は追跡速度やや遅め」）。定数は ENEMY_TUNING に配列で集約 */
    t.ok((T.individuals || []).length >= 2, 'P4.10 個体差: ENEMY_TUNING.individuals に配列で集約',
      (T.individuals || []).length + '件');
    t.ok(a1.T.chaseSpeed < a0.T.chaseSpeed, 'P4.10 個体差: 敵②の追跡速度は敵①より遅い',
      a1.T.chaseSpeed + ' < ' + a0.T.chaseSpeed);
    t.near(a0.T.chaseSpeed, T.chaseSpeed, 1e-9, 'P4.10 個体差: 敵①は基準値のまま');
    t.ok(a1.T.chaseSpeed > ESCAPE.Player.SPEED_WALK,
      'P4.10 個体差: 遅めでも歩きより速い（逃げ切れてしまわない）', a1.T.chaseSpeed);

    /* 縄張り＝帯（行範囲）。重ならないこと */
    var t0 = a0.territory, t1 = a1.territory;
    t.ok(!!t0 && !!t1, 'P4.10 縄張り: 個体ごとに縄張りが割り当たっている');
    if (!t0 || !t1) return;
    t.ok(t0.r1 < t1.r0 || t1.r1 < t0.r0, 'P4.10 縄張り: 2つの帯は行方向で重ならない',
      t0.r0 + '-' + t0.r1 + ' / ' + t1.r0 + '-' + t1.r1);
    t.ok((t0.r1 - t0.r0) >= 4 && (t1.r1 - t1.r0) >= 4, 'P4.10 縄張り: どちらの帯にも幅がある');

    /* 巡回路は自分の帯の中だけ */
    for (var i = 0; i < 2; i++) {
      var ai = g.ais.list[i], out = 0;
      t.ok(ai.route.length >= 3, 'P4.10 縄張り: 個体' + (i + 1) + 'の巡回地点が3以上',
        ai.route.length + '地点');
      for (var k = 0; k < ai.route.length; k++) {
        var n = ai.route[k];
        if (!ai.territory.contains(n.col, n.row)) out++;
        if (!g.map.isWalkable(n.col, n.row)) out++;
      }
      t.ok(out === 0, 'P4.10 縄張り: 個体' + (i + 1) + 'の巡回地点は全て自分の帯の歩行可能マス', out + '件が違反');
      t.ok(ai.territory.containsXZ(g.map, ai.enemy.x, ai.enemy.z),
        'P4.10 縄張り: 個体' + (i + 1) + 'は自分の帯から始まる',
        g.map.colOf(ai.enemy.x) + ',' + g.map.rowOf(ai.enemy.z));
    }
    /* 復帰＝スタート地点。巡回地点がスタートに張り付いていないこと（鉢合わせ防止） */
    var sp = g.map.meta.spawn, tooNear = 0;
    for (var m = 0; m < 2; m++) {
      var r = g.ais.list[m].route;
      for (var q = 0; q < r.length; q++) {
        if (Math.hypot(r[q].col - sp.col, r[q].row - sp.row) * g.map.tileSize < T.territoryStartClear) tooNear++;
      }
    }
    t.ok(tooNear === 0, 'P4.10 縄張り: 巡回地点はスタート地点から離れている（復帰直後に鉢合わせない）',
      tooNear + '地点が近すぎ');
    g.reset();
  }

  function testTerritoryPatrol(t, g) {
    g.reset();
    if (!t.ok(hidePlayer(g), 'P4.10 巡回: 検証用にプレイヤーを隠せる')) { g.reset(); return; }
    var a0 = g.ais.list[0], a1 = g.ais.list[1];
    var s0 = { x: a0.enemy.x, z: a0.enemy.z }, s1 = { x: a1.enemy.x, z: a1.enemy.z };
    var out0 = 0, out1 = 0, chase = 0;
    for (var i = 0; i < 1800; i++) {
      g.stepFrame(ESCAPE.FIXED_DT);
      if (!a0.territory.containsXZ(g.map, a0.enemy.x, a0.enemy.z)) out0++;
      if (!a1.territory.containsXZ(g.map, a1.enemy.x, a1.enemy.z)) out1++;
      if (a0.state === 'chase' || a1.state === 'chase') chase++;
    }
    t.ok(chase === 0, 'P4.10 巡回: 隠れている間は追跡が起きない（検証条件が成立）', chase + 'フレーム');
    t.ok(out0 === 0, 'P4.10 巡回: 敵①は30秒の巡回で縄張りを出ない', out0 + 'フレーム逸脱');
    t.ok(out1 === 0, 'P4.10 巡回: 敵②は30秒の巡回で縄張りを出ない', out1 + 'フレーム逸脱');
    var d0 = Math.hypot(a0.enemy.x - s0.x, a0.enemy.z - s0.z);
    var d1 = Math.hypot(a1.enemy.x - s1.x, a1.enemy.z - s1.z);
    t.ok(d0 > 2.0, 'P4.10 巡回: 敵①が実際に巡回している', d0.toFixed(1) + 'm');
    t.ok(d1 > 2.0, 'P4.10 巡回: 敵②が実際に巡回している', d1.toFixed(1) + 'm');
    var sep = Math.hypot(a0.enemy.x - a1.enemy.x, a0.enemy.z - a1.enemy.z);
    t.ok(sep > 4.0, 'P4.10 巡回: 2体が別々の場所を巡回している', sep.toFixed(1) + 'm');
    g.stealth.exitLocker();
    g.reset();
  }

  /* ---------------- B: 罠 → 絶叫 → 猛スピード ---------------- */

  function testTrapTuning(t, g) {
    var T = ENEMY_TUNING;
    t.near(T.investigateSpeed, 5.00, 1e-9, 'P4.10 罠: 通常の調査速度は5.0m/sのまま');
    t.near(T.trapInvestigateSpeed, 6.50, 1e-9, 'P4.10 罠: 罠に反応した調査は6.5m/s（契約）');
    t.near(T.searchDur, 8.00, 1e-9, 'P4.10 罠: 通常の探索は8秒のまま');
    t.near(T.trapSearchDur, 14.00, 1e-9, 'P4.10 罠: 罠の後の探索は14秒（契約の延長）');
    t.ok(T.trapLockerPeekChance > T.lockerPeekChance,
      'P4.10 罠: 罠の探索中はロッカーを覗く確率が上がる',
      T.trapLockerPeekChance + ' > ' + T.lockerPeekChance);
    t.ok(T.trapPeekRadius > T.lockerPeekRadius, 'P4.10 罠: 覗く対象を探す半径も広がる',
      T.trapPeekRadius + ' > ' + T.lockerPeekRadius);
    t.ok(T.trapHearRadius > 200, 'P4.10 罠: 罠の音は施設全体に届く', T.trapHearRadius);
    t.ok(isTrapKind('trap') && isTrapKind('step') && isTrapKind('sensor'),
      'P4.10 罠: 音地盤・センサー・罠が「罠の音」として扱われる');
    t.ok(!isTrapKind('gimmick') && !isTrapKind('debug'),
      'P4.10 罠: 仕掛け音や検証用の音は絶叫を起こさない（既存挙動を保つ）');
  }

  function testTrapBothRespond(t, g) {
    g.reset();
    if (!t.ok(hidePlayer(g), 'P4.10 罠: 検証用にプレイヤーを隠せる')) { g.reset(); return; }
    var a0 = g.ais.list[0], a1 = g.ais.list[1], au = ESCAPE.audio;
    var spot = noiseSpot(g, a0, 8, 16);
    if (!t.ok(!!spot, 'P4.10 罠: 検証に使える音源マスがある')) { g.reset(); return; }
    /* 「近い」は経路距離で測る（迷路では直線距離と順位が逆転する） */
    var d0 = g.ais.pathDistTo(a0, spot.x, spot.z, false);
    var d1 = g.ais.pathDistTo(a1, spot.x, spot.z, false);
    var near = (d0 <= d1) ? a0 : a1, farAi = (d0 <= d1) ? a1 : a0;
    var nearName = (d0 <= d1) ? '敵①' : '敵②';
    var screams0 = a0.screams + a1.screams;
    var fired = (au && au.fired && au.fired.shriek) || 0;

    /* 罠が鳴る（半径は既定＝罠なので施設全体に届く） */
    ESCAPE.noise.emit(spot.x, spot.z, ENEMY_TUNING.runNoiseRadius, 'trap');
    sim(g, 1);
    t.ok(near.state === 'investigate' && near.alert === true,
      'P4.10 罠: 経路距離で近い個体が即座に罠へ反応する', near.state + '/alert=' + near.alert);
    t.ok(farAi.state === 'investigate' && farAi.alert === true,
      'P4.10 罠: 遠い個体も同じフレームで反応する（両方が反応する＝契約）',
      farAi.state + '/alert=' + farAi.alert);
    t.ok(near.holdT <= 0, 'P4.10 罠: 近い個体はすぐ走り出す', near.holdT);
    t.ok(farAi.holdT >= 0, 'P4.10 罠: 遠い個体は一拍置いてから走り出す',
      farAi.holdT.toFixed(2) + '秒');
    t.ok(Math.abs(d1 - d0) > 1e-6, 'P4.10 罠: 検証条件（経路距離に差がある）',
      d0.toFixed(1) + ' / ' + d1.toFixed(1) + '（近い方=' + nearName + '）');
    t.ok((a0.screams + a1.screams) > screams0, 'P4.10 罠: 絶叫が上がる',
      (a0.screams + a1.screams) + '回');
    t.ok(((au && au.fired && au.fired.shriek) || 0) > fired,
      'P4.10 罠: 絶叫の音（shriek）が鳴る指示が出る');
    t.ok((au.events && au.events.shriek) > 0, 'P4.10 罠: 音響イベント shriek が記録される');

    /* 一拍置いた個体も必ず動き出す */
    var came = simUntil(g, function () {
      return farAi.holdT <= 0 && farAi.speed > 0.05;
    }, Math.ceil((ENEMY_TUNING.farReactDelay + 3.0) / ESCAPE.FIXED_DT));
    t.ok(came >= 0, 'P4.10 罠: 一拍置いた個体も必ず音源へ走り出す',
      farAi.state + ' speed=' + farAi.speed.toFixed(2));

    /* 経路距離で近い方が先着する */
    var arrN = -1, arrF = -1;
    for (var i = 0; i < 6000 && (arrN < 0 || arrF < 0); i++) {
      g.stepFrame(ESCAPE.FIXED_DT);
      if (arrN < 0 && Math.hypot(near.enemy.x - spot.x, near.enemy.z - spot.z) < 1.8) arrN = i;
      if (arrF < 0 && Math.hypot(farAi.enemy.x - spot.x, farAi.enemy.z - spot.z) < 1.8) arrF = i;
    }
    t.ok(arrN >= 0, 'P4.10 罠: 近い個体が音源へ到着する', arrN + 'フレーム');
    t.ok(arrN >= 0 && (arrF < 0 || arrN <= arrF),
      'P4.10 罠: 経路距離で近い方が先着する',
      nearName + '(' + d0.toFixed(0) + '/' + d1.toFixed(0) + 'm) ' + arrN + ' / 相方 ' + arrF);
    g.stealth.exitLocker();
    g.reset();
  }

  /** 罠の音の方が「通常の音」より速く走る（investigate 5.0 → 6.5 の実測比較） */
  function testTrapSprintSpeed(t, g) {
    /* 音源は「敵①が経路距離でも一番近い」マスを選ぶ。
       こうすると通常の音でも罠の音でも同じ個体が遅延なしで走り出し、速度だけが変わる。 */
    g.reset();
    if (!t.ok(hidePlayer(g), 'P4.10 猛スピード: 検証用にプレイヤーを隠せる')) { g.reset(); return; }
    var a0 = g.ais.list[0], cells = g.map.walkableCells(), spot = null;
    for (var i = 0; i < cells.length && !spot; i++) {
      var c = g.map.cellCenter(cells[i].col, cells[i].row);
      var d = Math.hypot(c.x - a0.enemy.x, c.z - a0.enemy.z);
      if (d < 12 || d > 20) continue;
      if (!a0.blockedLine(a0.enemy.x, a0.enemy.z, c.x, c.z)) continue;
      var mine = g.ais.pathDistTo(a0, c.x, c.z, false), other = Infinity;
      for (var q = 1; q < g.ais.list.length; q++) {
        other = Math.min(other, g.ais.pathDistTo(g.ais.list[q], c.x, c.z, false));
      }
      if (mine > other) continue;              /* 相方の方が経路で近い＝遅延が乗るので使わない */
      spot = { x: c.x, z: c.z, mine: mine, other: other };
    }
    g.stealth.exitLocker();
    if (!t.ok(!!spot, 'P4.10 猛スピード: 比較に使える音源マスがある')) { g.reset(); return; }

    function run(kind) {
      g.reset();
      hidePlayer(g);
      var ai = g.ais.list[0];
      ESCAPE.noise.emit(spot.x, spot.z, 40, kind);
      sim(g, 1);
      if (ai.state !== 'investigate') { g.stealth.exitLocker(); return null; }
      simUntil(g, function () { return ai.enemy.state !== 'trans'; }, 300);
      var x0 = ai.enemy.x, z0 = ai.enemy.z, N = 40;
      sim(g, N);
      var v = Math.hypot(ai.enemy.x - x0, ai.enemy.z - z0) / (N * ESCAPE.FIXED_DT);
      var alert = ai.alert, st = ai.state;
      g.stealth.exitLocker();
      return { v: v, alert: alert, state: st };
    }
    var normal = run('test');
    var trap = run('trap');
    if (!t.ok(!!normal && !!trap, 'P4.10 猛スピード: 双方の音で敵①が走り出す',
      (normal ? 'ok' : '通常の音で不発') + ' / ' + (trap ? 'ok' : '罠の音で不発'))) { g.reset(); return; }
    t.ok(normal.alert === false, 'P4.10 猛スピード: 通常の音では alert にならない');
    t.ok(trap.alert === true, 'P4.10 猛スピード: 罠の音では alert になる');
    t.ok(trap.v > normal.v * 1.15, 'P4.10 猛スピード: 罠の時の方が明確に速い',
      trap.v.toFixed(2) + ' vs ' + normal.v.toFixed(2) + ' m/s');
    var ratio = ENEMY_TUNING.trapInvestigateSpeed / ENEMY_TUNING.investigateSpeed;
    t.ok(trap.v / normal.v > ratio * 0.85, 'P4.10 猛スピード: 実測比が定数比（6.5/5.0）に見合う',
      (trap.v / normal.v).toFixed(2) + ' vs ' + ratio.toFixed(2));
    g.reset();
  }

  /** 到着後の探索が延長される（8秒では巡回に戻らない） */
  function testTrapSearchIsLong(t, g) {
    g.reset();
    if (!t.ok(hidePlayer(g), 'P4.10 執拗な探索: 検証用にプレイヤーを隠せる')) { g.reset(); return; }
    var ai = g.ai;
    var spot = noiseSpot(g, ai, 8, 14);
    if (!t.ok(!!spot, 'P4.10 執拗な探索: 検証に使える音源マスがある')) { g.reset(); return; }
    ESCAPE.noise.emit(spot.x, spot.z, 40, 'trap');
    sim(g, 1);
    var toSearch = simUntil(g, function () { return ai.state === 'search' || ai.state === 'locker'; }, 1800);
    t.ok(toSearch >= 0, 'P4.10 執拗な探索: 到着後に探索へ移る', ai.state);
    var frames = Math.ceil((ENEMY_TUNING.searchDur + 0.6) / ESCAPE.FIXED_DT);
    var backEarly = simUntil(g, function () { return ai.state === 'patrol'; }, frames);
    t.ok(backEarly < 0, 'P4.10 執拗な探索: 通常の探索時間(8秒)では巡回へ戻らない', ai.state);
    t.ok(ai.alert === true, 'P4.10 執拗な探索: 罠の反応が続いている', ai.alert);
    /* いつかは必ず巡回へ戻る（探索が終わらない＝詰みを作らない） */
    var back = simUntil(g, function () { return ai.state === 'patrol'; },
      Math.ceil((ENEMY_TUNING.trapSearchDur * 3 + 30) / ESCAPE.FIXED_DT));
    t.ok(back >= 0, 'P4.10 執拗な探索: 最後は巡回へ戻る（探索が終わらない状態を作らない）', ai.state);
    t.ok(ai.alert === false, 'P4.10 執拗な探索: 巡回へ戻れば罠の反応は解ける');
    g.stealth.exitLocker();
    g.reset();
  }

  /** 追跡では縄張りを出てよい。見失ったら自分の帯へ帰る */
  function testTerritoryLeaveAndReturn(t, g) {
    g.reset();
    var a0 = g.ais.list[0], a1 = g.ais.list[1];
    /* 敵①を自分の帯の境界へ、プレイヤーを帯の外（敵②の帯）へ置いて追跡させる */
    var map = g.map, terr = a0.territory;
    var edge = null, out = null;
    var cells = map.walkableCells();
    /* 帯の境界は上端／下端のどちらでもよい（最南・最北の帯は外壁側に外が無い）。
       内側=自分の帯の縁、外側=帯の外の歩行可能マス、で見通せる組を探す。 */
    var sides = [{ row: terr.r1, dir: 1 }, { row: terr.r0, dir: -1 }];
    for (var si = 0; si < sides.length && !edge; si++) {
      var side = sides[si];
      for (var i = 0; i < cells.length && !edge; i++) {
        var c = cells[i];
        if (c.row !== side.row) continue;
        for (var d = 2; d <= 4 && !edge; d++) {
          var orow = c.row + side.dir * d;
          if (orow < 0 || orow >= map.height) continue;
          if (terr.contains(c.col, orow)) continue;
          if (!map.isWalkable(c.col, orow) || map.isBlocked(c.col, orow)) continue;
          var p0 = map.cellCenter(c.col, c.row), p1 = map.cellCenter(c.col, orow);
          if (a0.blockedLine(p0.x, p0.z, p1.x, p1.z)) continue;
          edge = { col: c.col, row: c.row };
          out = { col: c.col, row: orow, dir: side.dir };
        }
      }
    }
    if (!t.ok(!!edge, 'P4.10 縄張り復帰: 帯の境界に検証点がある')) { g.reset(); return; }
    /* 敵②は遠くへ退避させる（この検証は敵①だけを見る） */
    putEnemy(a1, a1.route[0].col, a1.route[0].row, 0);
    a1.manual = true;
    putEnemy(a0, edge.col, edge.row, 180);
    placePlayer(g, out.col, out.row, 0);
    a0.enemy.facing = yawOf(0, out.dir); /* 帯の外の方向を向く */
    sim(g, 2);
    var chased = simUntil(g, function () { return a0.state === 'chase'; }, 240);
    t.ok(chased >= 0, 'P4.10 縄張り復帰: 帯の外のプレイヤーを追跡する', a0.state);
    var leftFrames = simUntil(g, function () {
      return !a0.territory.containsXZ(g.map, a0.enemy.x, a0.enemy.z);
    }, 600);
    t.ok(leftFrames >= 0, 'P4.10 縄張り復帰: 追跡中は縄張りを出てよい',
      g.map.rowOf(a0.enemy.z) + '行 / 帯' + terr.r0 + '-' + terr.r1);

    /* 見失わせる: プレイヤーを隠す → 探索を経て巡回へ → 自分の帯へ帰る */
    hidePlayer(g);
    var backPatrol = simUntil(g, function () { return a0.state === 'patrol'; },
      Math.ceil((ENEMY_TUNING.giveUpTime + ENEMY_TUNING.searchDur + 12) / ESCAPE.FIXED_DT));
    t.ok(backPatrol >= 0, 'P4.10 縄張り復帰: 見失えば探索を経て巡回へ戻る', a0.state);
    var home = simUntil(g, function () {
      return a0.territory.containsXZ(g.map, a0.enemy.x, a0.enemy.z);
    }, 3000);
    t.ok(home >= 0, 'P4.10 縄張り復帰: 自分の縄張りへ帰る',
      g.map.rowOf(a0.enemy.z) + '行 / 帯' + terr.r0 + '-' + terr.r1);

    /* 「外に居るまま巡回へ戻された」ときに帰還の判断が立つこと（直接検査） */
    putEnemy(a0, out.col, out.row, 0);
    var r0 = a0.returns;
    a0.toPatrol();
    t.ok(a0.returns === r0 + 1 && a0.outside === true,
      'P4.10 縄張り復帰: 帯の外で巡回に戻ると「帰る」判断になる', a0.returns + '/outside=' + a0.outside);
    var home2 = simUntil(g, function () {
      return a0.territory.containsXZ(g.map, a0.enemy.x, a0.enemy.z) && a0.outside === false;
    }, 3000);
    t.ok(home2 >= 0, 'P4.10 縄張り復帰: 寄り道せず帯まで帰りきる', a0.outside);
    a1.manual = false;
    g.stealth.exitLocker();
    g.reset();
  }

  /* ---------------- 捕獲: 個体の特定と演出の整合 ---------------- */

  function testCaptureByEitherEnemy(t, g) {
    for (var idx = 0; idx < 2; idx++) {
      g.reset();
      var captor = g.ais.list[idx], other = g.ais.list[1 - idx];
      /* 捕まえる個体をプレイヤーの目の前に、もう1体は自分の巡回起点で待たせる */
      var sp = g.map.meta.spawn;
      var open = null, cells = g.map.walkableCells();
      for (var i = 0; i < cells.length && !open; i++) {
        var c = cells[i];
        if (!g.map.isWalkable(c.col + 1, c.row) || g.map.isBlocked(c.col + 1, c.row)) continue;
        if (!g.map.isWalkable(c.col + 2, c.row) || g.map.isBlocked(c.col + 2, c.row)) continue;
        if (Math.hypot(c.col - sp.col, c.row - sp.row) < 6) continue;
        open = c;
      }
      if (!t.ok(!!open, 'P4.10 捕獲個体: 検証に使える見通しの3マスがある')) { g.reset(); return; }
      other.manual = true;
      putEnemy(captor, open.col, open.row, -90);
      placePlayer(g, open.col + 2, open.row, 0);
      sim(g, 1);
      g.player.x = captor.enemy.x + 0.55; g.player.z = captor.enemy.z;
      sim(g, 1);

      var label = '敵' + (idx + 1);
      t.ok(g.stealth.jail.phase === 'grab', 'P4.10 捕獲個体: ' + label + 'に捕まると演出が始まる',
        g.stealth.jail.phase);
      t.ok(g.stealth.capturedBy === captor, 'P4.10 捕獲個体: 捕まえた個体が記録される',
        g.stealth.capturedBy ? g.stealth.capturedBy.name : 'なし');
      t.ok(g.cinematic.actor === captor, 'P4.10 捕獲個体: 演出の主役が捕まえた個体',
        g.cinematic.actor ? g.cinematic.actor.name : 'なし');
      t.ok(captor.state === 'caught' && captor.cine === true,
        'P4.10 捕獲個体: 捕まえた個体が演出に入る', captor.state);
      t.ok(other.state !== 'caught' && other.cine === false,
        'P4.10 捕獲個体: もう1体は演出に巻き込まれない', other.state);
      t.ok(captor.enemy.detailHi === true, 'P4.10 捕獲個体: 高解像度化されるのは捕まえた個体');
      t.ok(other.enemy.detailHi === false, 'P4.10 捕獲個体: もう1体は通常解像度のまま');

      var red = false;
      var done = simUntil(g, function () {
        if (captor.enemy.redEyesVisible()) red = true;
        return g.stealth.jail.phase === 'none';
      }, Math.ceil(g.cinematic.totalDur('jail') / ESCAPE.FIXED_DT) + 600);
      t.ok(red, 'P4.10 捕獲個体: 赤い目は捕まえた個体に出る');
      t.ok(done >= 0, 'P4.10 捕獲個体: 演出が終わって操作に戻る', g.stealth.jail.phase);
      t.ok(captor.enemy.detailHi === false && captor.enemy.activeTriangles() === captor.enemy.triangles,
        'P4.10 捕獲個体: 演出ぶんが残らない');
      t.ok(captor.cine === false && g.cinematic.actor === null,
        'P4.10 捕獲個体: 演出の主役が解除される');
      t.ok(g.player.col() === sp.col && g.player.row() === sp.row,
        'P4.10 捕獲個体: 復帰先はスタート地点', g.player.col() + ',' + g.player.row());
      /* 両個体が巡回起点へ戻る（片方が張り付いたままにならない） */
      t.ok(captor.state === 'patrol' && other.state === 'patrol',
        'P4.10 捕獲個体: 捕獲後は2体とも巡回へ戻る', captor.state + '/' + other.state);
      var inHome = captor.territory.containsXZ(g.map, captor.enemy.x, captor.enemy.z);
      t.ok(inHome, 'P4.10 捕獲個体: 復帰後は自分の縄張りに戻っている');
      other.manual = false;
      g.reset();
    }
  }

  /* ---------------- C: 捕獲のたびに地図を真っ暗に ---------------- */

  function testCaptureWipesMap(t, g) {
    g.reset();
    var mm = g.minimap, rope = g.rope, st = g.stealth;
    if (!t.ok(!!mm, 'P4.10 地図リセット: ミニマップが組み込まれている')) { g.reset(); return; }
    var sp = g.map.meta.spawn;
    placePlayer(g, sp.col, sp.row, 0);
    sim(g, 2);
    var base = mm.exploredCount;      /* スタート地点だけを踏破した状態＝「ほぼ真っ暗」の基準 */

    /* 遠くまで歩き回って踏破を作る（製品と同じ記録経路＝minimap.step を通す） */
    var cells = g.map.walkableCells(), far = [];
    for (var i = 0; i < cells.length && far.length < 20; i++) {
      var c = cells[i];
      if (Math.hypot(c.col - sp.col, c.row - sp.row) < 14) continue;
      placePlayer(g, c.col, c.row, 0);
      mm.step(0);
      far.push(c);
    }
    if (!t.ok(far.length >= 10, 'P4.10 地図リセット: 検証用に遠方の踏破を作れる', far.length)) { g.reset(); return; }
    mm.learnZone('C');
    g.progress.gimmick.key = true;
    var explored = mm.exploredCount, zones = mm.info().zones.join('');
    var stack = rope.stack.length, ghosts = rope.ghosts.length, wipes = mm.wipes;
    t.ok(explored > base + 10, 'P4.10 地図リセット: 検証用に踏破が溜まっている', explored + ' / 基準' + base);
    var known = 0;
    for (var k = 0; k < far.length; k++) if (mm.isExplored(far[k].col, far[k].row)) known++;
    t.ok(known === far.length, 'P4.10 地図リセット: 遠方のマスが踏破済みになっている', known + '/' + far.length);

    t.ok(st.capture(g.ais.list[1]) === true, 'P4.10 地図リセット: 捕獲が始まる');
    t.ok(mm.exploredCount === 0, 'P4.10 地図リセット: 捕獲の瞬間に踏破が全消去される',
      mm.exploredCount + ' / ' + explored);
    t.ok(mm.wipes === wipes + 1, 'P4.10 地図リセット: 消去が1回だけ走る', mm.wipes);
    t.ok(mm.info().zones.join('') === zones, 'P4.10 地図リセット: 読んだ区画名は残る',
      mm.info().zones.join(''));
    t.ok(rope.stack.length === stack, 'P4.10 地図リセット: ロープの軌跡は残る',
      rope.stack.length + ' / ' + stack);
    t.ok(rope.ghosts.length === ghosts, 'P4.10 地図リセット: 古い軌跡も残る');
    t.ok(rope.knots.length === 1, 'P4.10 地図リセット: 結び目は落ちて残る', rope.knots.length);
    t.ok(g.progress.gimmick.key === true, 'P4.10 地図リセット: 鍵の取得は残る');

    var done = simUntil(g, function () { return st.jail.phase === 'none'; },
      Math.ceil(g.cinematic.totalDur('jail') / ESCAPE.FIXED_DT) + 600);
    t.ok(done >= 0, 'P4.10 地図リセット: 演出が終わる', st.jail.phase);
    var left = 0;
    for (var m = 0; m < far.length; m++) if (mm.isExplored(far[m].col, far[m].row)) left++;
    t.ok(left === 0, 'P4.10 地図リセット: 復帰後、歩いた先の記憶は残っていない', left + '/' + far.length);
    t.ok(mm.exploredCount <= base + 6, 'P4.10 地図リセット: 復帰直後の地図はスタート周辺だけ',
      mm.exploredCount + ' / 基準' + base);
    t.ok(mm.knowsZone('C') === true, 'P4.10 地図リセット: 復帰後も区画名は残っている');
    t.ok(g.progress.gimmick.key === true, 'P4.10 地図リセット: 復帰後も鍵は残っている');
    t.ok(rope.knots.length === 1 && rope.isAttached() === false,
      'P4.10 地図リセット: 結び目を拾い直す動線は生きている');

    /* 2回目の捕獲でも同じように消える（毎回＝契約） */
    var w2 = mm.wipes;
    for (var q = 0; q < far.length; q++) { placePlayer(g, far[q].col, far[q].row, 0); mm.step(0); }
    t.ok(mm.exploredCount > base, 'P4.10 地図リセット: 歩けばまた踏破が増える', mm.exploredCount);
    st.capture(g.ais.list[0]);
    t.ok(mm.exploredCount === 0 && mm.wipes === w2 + 1,
      'P4.10 地図リセット: 2回目の捕獲でも消える（毎回）', mm.exploredCount + ' / wipes' + mm.wipes);
    simUntil(g, function () { return st.jail.phase === 'none'; },
      Math.ceil(g.cinematic.totalDur('jail') / ESCAPE.FIXED_DT) + 600);
    g.reset();
  }

  /* ---------------- 絶叫の音（OfflineAudioContext の数値判定） ---------------- */

  function testShriekAudio(t, g) {
    var A = ESCAPE.Audio;
    t.ok(typeof A.VOICES.shriek === 'function', 'P4.10 絶叫: 音色 shriek が定義されている');
    if (!t.ok(A.ready(), 'P4.10 絶叫: レンダキャッシュが揃っている（prewarm完了）',
      A.prewarmError() || '')) return;
    var m = A.cache.shriek, sc = A.cache.scream;
    if (!t.ok(!!m, 'P4.10 絶叫: shriek が事前レンダされている')) return;
    t.ok(m.rms >= 0.008 && m.peak >= 0.10 && m.peak <= 1.0 && !m.clipped,
      'P4.10 絶叫: RMS/peak が範囲内', 'rms=' + m.rms.toFixed(4) + ' peak=' + m.peak.toFixed(4));
    t.ok(m.onset >= 0 && m.onset < 0.30, 'P4.10 絶叫: 時間内に発音する', 'onset=' + m.onset.toFixed(3));
    t.ok(m.activeRatio > sc.activeRatio,
      'P4.10 絶叫: 形態遷移の悲鳴より長く尾を引く（施設に響く）',
      m.activeRatio.toFixed(3) + ' > ' + sc.activeRatio.toFixed(3));
    t.ok(Math.abs(m.rms - sc.rms) > 1e-6, 'P4.10 絶叫: 既存の悲鳴とは別の音色');

    /* 方向が分かる立体音＝距離で消えず、左右のパンは付く（純関数で判定） */
    t.ok(typeof A.shriekGainAt === 'function', 'P4.10 絶叫: 距離減衰が純関数で検査できる');
    var near = A.shriekGainAt(2), mid = A.shriekGainAt(40), far = A.shriekGainAt(120);
    t.ok(near > mid && mid > far, 'P4.10 絶叫: 距離で減衰する（近さは分かる）',
      near.toFixed(3) + ' > ' + mid.toFixed(3) + ' > ' + far.toFixed(3));
    t.ok(far > 0.15, 'P4.10 絶叫: 施設の端（120m）でも聞こえる音量が残る', far.toFixed(3));
    t.ok(A.attenuationFor(120, 34) === 0, 'P4.10 絶叫: 通常の敵の音は同じ距離では届かない');
    var right = A.panFor(0, 0, 0, 10, 0), left = A.panFor(0, 0, 0, -10, 0);
    t.ok(right > 0.5 && left < -0.5, 'P4.10 絶叫: 左右のパンで方向が分かる',
      left.toFixed(2) + ' / ' + right.toFixed(2));
  }

  /* 契約 §6「実行後は製品初期状態へ完全復帰」。
     捕獲は「消した地図」を保存するので、スイートが作ったセーブは必ず片付ける。
     runAll から呼ばれた時も runExtra 単体でも同じように効くよう、登録時に噛ませる。 */
  function storageKeys() {
    var out = {};
    try { for (var i = 0; i < global.localStorage.length; i++) out[global.localStorage.key(i)] = 1; }
    catch (e) { /* private モード等 */ }
    return out;
  }
  function dropNewKeys(before) {
    try {
      var kill = [];
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (!before[k]) kill.push(k);
      }
      for (var j = 0; j < kill.length; j++) global.localStorage.removeItem(kill[j]);
    } catch (e) { /* 無視 */ }
  }
  function cleanSuite(fn) {
    var wrapped = function (t, g) {
      var before = storageKeys();
      try { fn(t, g); }
      finally { dropNewKeys(before); }
    };
    try { Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true }); }
    catch (e) { wrapped.suiteName = fn.name; }
    return wrapped;
  }


  /* ================================================================
   * P4.12 レーンA 機械テスト
   *   項目3「捕獲演出の担ぎ運び」／項目5「距離連動の鼓動」／項目6「敵を大きく」
   * （契約 DESIGN.md §4「P4.12 再プレイ差し戻し」）
   *
   * test.js はレーンBが同時に編集しているので、順序ガードとして
   * ここ（ESCAPE.__extraSuites）へ積む。署名は test.js の suites と同じ (t, g)。
   * ============================================================== */

  /** 見通しの効く3マスを探し、そこで実際に捕まる（P4.10 のやり方と同じ） */
  function startCaptureHere(g) {
    var sp = g.map.meta.spawn, cells = g.map.walkableCells(), open = null;
    for (var i = 0; i < cells.length && !open; i++) {
      var c = cells[i];
      if (!g.map.isWalkable(c.col + 1, c.row) || g.map.isBlocked(c.col + 1, c.row)) continue;
      if (!g.map.isWalkable(c.col + 2, c.row) || g.map.isBlocked(c.col + 2, c.row)) continue;
      if (Math.hypot(c.col - sp.col, c.row - sp.row) < 6) continue;
      open = c;
    }
    if (!open) return false;
    if (g.ais && g.ais.list[1]) g.ais.list[1].manual = true;
    putEnemy(g.ai, open.col, open.row, -90);
    placePlayer(g, open.col + 2, open.row, 0);
    sim(g, 1);
    g.player.x = g.ai.enemy.x + 0.55; g.player.z = g.ai.enemy.z;
    sim(g, 1);
    return g.stealth.jail.phase === 'grab';
  }

  /** カメラの前方ベクトル（three の -Z が前） */
  function camForward(g, out) {
    out.set(0, 0, -1).applyQuaternion(g.camera.quaternion);
    return out;
  }

  /* ---------------- 項目3: 担ぎ運び ---------------- */

  function testP412Carry(t, g) {
    var T = ENEMY_TUNING, cine = g.cinematic;
    if (!t.ok(!!cine, 'P4.12 担ぎ運び: 演出モジュールがある')) return;
    t.near(T.cineCarryEye, 1.80, 1e-9, 'P4.12 項目3: 担がれた視点の高さは約1.8m（契約）', T.cineCarryEye);
    t.ok(T.cineCarrySpeed > 0.5, 'P4.12 項目3: 運ばれる見かけの速度がある', T.cineCarrySpeed);
    t.ok(T.cineCarryLead > 0, 'P4.12 項目3: 敵の実体は進行方向の前方に置く', T.cineCarryLead);
    t.ok(T.cineDragDur >= 3.0 && T.cineDragDur <= 4.0,
      'P4.12 項目3: 段階3の長さは現行維持（3〜4秒）', T.cineDragDur);

    g.reset();
    if (!t.ok(startCaptureHere(g), 'P4.12 担ぎ運び: 実捕獲から演出が始まる（前提）', g.stealth.jail.phase)) {
      g.reset(); return;
    }
    var fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
    var seen = {
      frames: 0, minEye: Infinity, maxEye: -Infinity, minBack: 1, light: 0, shoulder: 0,
      lampFirst: null, lampLast: null, enemyBehind: 0, floorBelow: true, ceilOk: true
    };
    var guard = Math.ceil(cine.totalDur('jail') / ESCAPE.FIXED_DT) + 600;
    for (var i = 0; i < guard; i++) {
      if (cine.stage === 'drag') {
        seen.frames++;
        var cam = g.camera.position;
        var fy = g.map.floorYAt(cam.x, cam.z);
        var eye = cam.y - fy;
        if (eye < seen.minEye) seen.minEye = eye;
        if (eye > seen.maxEye) seen.maxEye = eye;
        /* 後方（来た通路）を見ているか: 進行方向とカメラ前方の内積が -1 に近い */
        camForward(g, fwd);
        var back = fwd.x * cine.dragDir.x + fwd.z * cine.dragDir.z;
        if (back < seen.minBack) seen.minBack = back;
        if (cine.headlightOn() && cine.light && cine.light.visible) seen.light++;
        if (cine.shoulder && cine.shoulder.visible) seen.shoulder++;
        /* 敵の実体はカメラの背後（＝進行方向の先）にいる */
        var e = cine.ai().enemy;
        tmp.set(e.x - cam.x, 0, e.z - cam.z);
        if (tmp.x * fwd.x + tmp.z * fwd.z < 0) seen.enemyBehind++;
        if (cam.y >= fy + g.map.ceilHAt(g.map.colOf(cam.x), g.map.rowOf(cam.z))) seen.ceilOk = false;
        if (cam.y <= fy) seen.floorBelow = false;
        /* 天井灯が遠ざかる（カメラからの距離が伸びる） */
        if (cine.lamps && cine.lamps.children.length) {
          var l0 = cine.lamps.children[0].position;
          var d0 = Math.hypot(l0.x - cam.x, l0.z - cam.z);
          if (seen.lampFirst === null) seen.lampFirst = d0;
          seen.lampLast = d0;
        }
      }
      if (g.stealth.jail.phase === 'none' && !cine.active() && seen.frames > 0) break;
      g.stepFrame(ESCAPE.FIXED_DT);
    }
    t.ok(seen.frames > 30, 'P4.12 項目3: 担ぎ運びの段階を通過した', seen.frames + 'フレーム');
    t.ok(seen.minEye > 1.55 && seen.maxEye < 2.05,
      'P4.12 項目3: カメラは床から約1.8m（床すれすれの引きずりではない）',
      seen.minEye.toFixed(2) + '〜' + seen.maxEye.toFixed(2) + 'm');
    t.ok(seen.minBack < -0.85,
      'P4.12 項目3: 進行方向の後方（来た通路）を見ている', seen.minBack.toFixed(3));
    t.ok(seen.shoulder === seen.frames,
      'P4.12 項目3: 全フレームで敵の肩と髪が視界下部にある', seen.shoulder + '/' + seen.frames);
    t.ok(seen.light === seen.frames,
      'P4.12 項目3: 全フレームでヘッドライト点灯扱い（暗くて読めない絵を作らない）',
      seen.light + '/' + seen.frames);
    t.ok(seen.enemyBehind === seen.frames,
      'P4.12 項目3: 敵の実体はカメラの背後（担いでいる側）にいる',
      seen.enemyBehind + '/' + seen.frames);
    t.ok(seen.floorBelow && seen.ceilOk, 'P4.12 項目3: カメラが床下・天井上へ抜けない');
    t.ok(seen.lampLast !== null && seen.lampFirst !== null,
      'P4.12 項目3: 天井灯が出ている');

    /* 演出が終われば演出物は残らない（契約 §6 の中断安全と同じ厳しさで見る） */
    t.ok(!cine.active(), 'P4.12 担ぎ運び: 演出が終わっている', cine.stage);
    t.ok(cine.headlightOn() === false, 'P4.12 項目3: 演出後はヘッドライト点灯扱いが解ける');
    t.ok(cine.shoulder === null && cine.light === null && cine.haze === null,
      'P4.12 項目3: 肩・髪・演出ライトが片付いている');
    t.ok(cine.camSpace.visible === false && cine.props.visible === false,
      'P4.12 項目3: 演出物のグループが消えている');
    g.reset();
  }

  /** 天井灯が「遠ざかる」ことを別に見る（1灯を追跡して距離が単調に伸びる） */
  function testP412CarryLampsFlow(t, g) {
    g.reset();
    var cine = g.cinematic;
    if (!t.ok(startCaptureHere(g), 'P4.12 天井灯: 実捕獲から演出が始まる（前提）')) { g.reset(); return; }
    var guard = Math.ceil(cine.totalDur('jail') / ESCAPE.FIXED_DT) + 600;
    var prev = null, grew = 0, samples = 0;
    for (var i = 0; i < guard; i++) {
      if (cine.stage === 'drag' && cine.lamps) {
        var cam = g.camera.position, best = Infinity;
        for (var k = 0; k < cine.lamps.children.length; k++) {
          var p = cine.lamps.children[k].position;
          var d = Math.hypot(p.x - cam.x, p.z - cam.z);
          if (d < best) best = d;
        }
        if (prev !== null) { samples++; if (best > prev - 1e-6 || best < prev - 2.0) grew++; }
        prev = best;
      }
      if (!cine.active() && samples > 0) break;
      g.stepFrame(ESCAPE.FIXED_DT);
    }
    t.ok(samples > 30 && grew === samples,
      'P4.12 項目3: 天井灯はカメラから遠ざかり続ける（近づいてこない）', grew + '/' + samples);
    g.reset();
  }

  /* ---------------- 項目6: 敵を大きく ---------------- */

  function testP412EnemyScale(t, g) {
    g.reset();
    var S = ESCAPE.EnemyScale;
    if (!t.ok(!!S, 'P4.12 項目6: 体格倍率のAPIがある')) return;
    t.near(S.STAND, 1.10, 1e-9, 'P4.12 項目6: 直立形態は1.10倍（契約）', S.STAND);
    t.near(S.CRAWL, 1.35, 1e-9, 'P4.12 項目6: 反転形態は1.35倍（契約）', S.CRAWL);
    t.near(S.forPose(0), 1.10, 1e-9, 'P4.12 項目6: poseT=0 で直立倍率');
    t.near(S.forPose(1), 1.35, 1e-9, 'P4.12 項目6: poseT=1 で反転倍率');
    var mono = true, prev = S.forPose(0);
    for (var u = 0.05; u <= 1.0001; u += 0.05) {
      var v = S.forPose(u);
      if (v < prev - 1e-9) mono = false;
      prev = v;
    }
    t.ok(mono, 'P4.12 項目6: 倍率は形態遷移で単調に増える（縮んで見える瞬間を作らない）');
    t.ok(S.forPose(0.45) < 1.13,
      'P4.12 項目6: 倒れ込みの途中はまだ太らない（幅1マスの通路の壁抜け対策）',
      S.forPose(0.45).toFixed(3));

    /* モデルに実際に乗っていること（天井の低いマスでは上限が掛かる＝等倍未満にはしない） */
    var e = g.ai.enemy;
    t.ok(Math.abs(e.group.scale.x - e.scale) < 1e-6 && Math.abs(e.group.scale.y - e.scale) < 1e-6,
      'P4.12 項目6: 倍率がモデルのグループに等方で乗っている', e.group.scale.x);
    t.ok(e.scale >= 1.0 && e.scale <= S.CRAWL + 1e-9,
      'P4.12 項目6: 倍率は等倍〜1.35の範囲に収まる', e.scale);

    /* 床接地: 手足の最下点が床（拡大しても浮かない・沈まない） */
    var cells = g.map.walkableCells();
    var flat = null;
    for (var ci = 0; ci < cells.length && !flat; ci++) {
      if (g.map.ceilHAt(cells[ci].col, cells[ci].row) >= 2.95) flat = cells[ci];
    }
    if (flat) {
      var forms = [{ p: 0, n: '直立' }, { p: 1, n: '反転' }];
      for (var fi = 0; fi < forms.length; fi++) {
        e.poseT = forms[fi].p;
        e.state = forms[fi].p ? 'chase' : 'walk';
        e.placeCell(flat.col, flat.row, 180, g.map);
        e.update(0, 12.0);
        var lowest = Infinity, v3 = new THREE.Vector3();
        for (var k = 0; k < e.contacts.length; k++) {
          e.contacts[k].getWorldPosition(v3);
          if (v3.y < lowest) lowest = v3.y;
        }
        t.near(lowest, e.floorY, 2e-3,
          'P4.12 項目6: ' + forms[fi].n + '形態の接地（拡大しても足が床にある）',
          (lowest - e.floorY).toFixed(4) + 'm');
        var want = forms[fi].p ? S.CRAWL : S.STAND;
        t.near(e.scale, want, 1e-6,
          'P4.12 項目6: 天井に余裕のあるマスでは契約どおりの倍率', e.scale.toFixed(3));
      }
      /* 首・顔の高さが倍率ぶん上がる（捕獲ズームのカメラ距離もここに追従する） */
      e.poseT = 0; e.state = 'walk';
      e.placeCell(flat.col, flat.row, 180, g.map);
      e.update(0, 12.0);
      var head = new THREE.Vector3(), neck = new THREE.Vector3();
      e.nodes.head.getWorldPosition(head);
      e.nodes.neck.getWorldPosition(neck);
      t.ok(head.y - e.floorY > 2.35 && head.y - e.floorY < 2.65,
        'P4.12 項目6: 直立形態の顔の高さが上がる（等倍2.27m→約2.5m）',
        (head.y - e.floorY).toFixed(3) + 'm');
      t.ok(neck.y - e.floorY > 1.95,
        'P4.12 項目6: 首の高さも倍率ぶん上がる', (neck.y - e.floorY).toFixed(3) + 'm');
    }

    /* 天井の低いマスでは上限が掛かり、等倍より小さくはならない（＝P4.11 より悪化させない） */
    var low = null;
    for (var li = 0; li < cells.length && !low; li++) {
      if (g.map.ceilHAt(cells[li].col, cells[li].row) <= 2.5) low = cells[li];
    }
    if (low) {
      e.poseT = 0; e.state = 'walk';
      e.placeCell(low.col, low.row, 180, g.map);
      e.update(0, 12.0);
      t.ok(e.scale >= 1.0 && e.scale <= S.STAND + 1e-9,
        'P4.12 項目6: 天井の低いマスでは頭が抜けないよう上限が掛かる（等倍は下回らない）',
        e.scale.toFixed(3) + ' / 天井' + g.map.ceilHAt(low.col, low.row));
    }
    g.reset();
  }

  /** 当たり判定（経路の半径・捕獲の接触距離）が体格に追従する */
  function testP412HitboxScale(t, g) {
    g.reset();
    var ai = g.ai, T = ENEMY_TUNING;
    t.ok(typeof ai._radius === 'function' && typeof ai.catchDist === 'function',
      'P4.12 項目6: 当たり判定が体格倍率を読む口を持つ');
    ai.enemy.setForm('stand', true);
    ai.enemy.update(0, 12.0);
    var rs = ai._radius(), cs = ai.catchDist();
    ai.enemy.setForm('crawl', true);
    ai.enemy.update(0, 12.0);
    var rc = ai._radius(), cc = ai.catchDist();
    t.ok(rc > rs && cc > cs,
      'P4.12 項目6: 反転形態の方が半径も接触距離も大きい',
      rc.toFixed(3) + '/' + rs.toFixed(3) + '・' + cc.toFixed(3) + '/' + cs.toFixed(3));
    t.near(rc, T.radius * ai.enemy.scale, 1e-6, 'P4.12 項目6: 半径＝基準×体格倍率', rc.toFixed(3));
    t.near(cc, T.catchDist * ai.enemy.scale, 1e-6, 'P4.12 項目6: 接触距離＝基準×体格倍率', cc.toFixed(3));
    t.ok(rc < 1.0, 'P4.12 項目6: 半径は幅1マス(2m)の通路の半幅に収まる', rc.toFixed(3));
    g.reset();
  }

  /** 反転形態の体が幅1マス(2m)の通路に収まる（壁にめり込まない） */
  function testP412CrawlFitsCorridor(t, g) {
    g.reset();
    var e = g.ai.enemy, S = ESCAPE.EnemyScale;
    var cells = g.map.walkableCells(), flat = null;
    for (var ci = 0; ci < cells.length && !flat; ci++) {
      if (g.map.ceilHAt(cells[ci].col, cells[ci].row) >= 2.95) flat = cells[ci];
    }
    if (!t.ok(!!flat, 'P4.12 項目6: 検証に使える天井の高いマスがある')) { g.reset(); return; }

    /* 髪は柔らかい房（壁に触れても破綻しない）ので体だけを測る */
    function halfWidth() {
      e.group.updateMatrixWorld(true);
      var box = new THREE.Box3(), tmp = new THREE.Box3(), any = false;
      e.group.traverse(function (o) {
        if (!o.isMesh || o.material === e.mats.hair) return;
        tmp.setFromObject(o);
        if (!any) { box.copy(tmp); any = true; } else { box.union(tmp); }
      });
      if (!any) return 0;
      /* facing=0（-Z が前）で置くので x が通路の横方向 */
      return Math.max(e.x - box.min.x, box.max.x - e.x);
    }
    e.setForm('crawl', true);
    e.placeCell(flat.col, flat.row, 180, g.map);
    var maxRun = 0;
    for (var i = 0; i < 90; i++) { e.state = 'chase'; e.update(1 / 60, 12.0 + i / 60); maxRun = Math.max(maxRun, halfWidth()); }
    t.near(e.scale, S.CRAWL, 1e-6, 'P4.12 項目6: 疾走中は1.35倍が丸ごと乗る', e.scale.toFixed(3));
    t.ok(maxRun < 0.95,
      'P4.12 項目6: 反転形態で疾走しても体は通路の半幅(1.0m)に収まる', maxRun.toFixed(3) + 'm');

    /* 形態遷移（倒れ込み）の軌道。受け身の腕と脚が最も広がる瞬間を見る */
    e.setForm('stand', true);
    e.placeCell(flat.col, flat.row, 180, g.map);
    e.state = 'walk'; e.transTime = 0;
    e.setForm('crawl', false);
    var maxTrans = 0, atPose = 0;
    for (var j = 0; j < 130; j++) {
      e.update(1 / 60, 20.0 + j / 60);
      var w = halfWidth();
      if (w > maxTrans) { maxTrans = w; atPose = e.poseT; }
    }
    t.ok(maxTrans <= 1.05,
      'P4.12 項目6: 倒れ込みの最大幅も通路の半幅にほぼ収まる（倍率を後ろへ寄せた効果）',
      maxTrans.toFixed(3) + 'm @poseT ' + atPose.toFixed(2));
    g.reset();
  }

  /** 耐久: 反転形態で通路を走り回っても実体マスへ入らない（契約の合格条件） */
  function testP412CrawlEndurance(t, g) {
    g.reset();
    var ai = g.ai, e = ai.enemy, map = g.map;
    var cells = map.walkableCells();
    if (!t.ok(cells.length > 50, 'P4.12 耐久: 検証に使えるマップがある')) { g.reset(); return; }
    /* もう1体とプレイヤーは邪魔をしない位置に置き、追跡の動きだけを 6000 フレーム回す */
    if (g.ais && g.ais.list[1]) g.ais.list[1].manual = true;
    ai.manual = true;                       /* AIの状態機械は止め、追跡の移動だけを回す */
    e.setForm('crawl', true);
    e.placeCell(cells[0].col, cells[0].row, 180, map);
    ai.state = 'chase';
    ai.path = null; ai.goal = null; ai.repathT = 0;

    var dt = ESCAPE.FIXED_DT, bad = 0, moved = 0, ti = 7, target = null;
    var lastX = e.x, lastZ = e.z;
    for (var i = 0; i < 6000; i++) {
      if (!target || Math.hypot(target.x - e.x, target.z - e.z) < 1.0) {
        ti = (ti * 7 + 13) % cells.length;            /* 乱数を使わない＝決定的 */
        target = map.cellCenter(cells[ti].col, cells[ti].row);
        ai.path = null; ai.goal = null; ai.repathT = 0;
      }
      ai._moveTo(dt, target.x, target.z, ai.T.chaseSpeed);
      e.update(dt, 30 + i * dt);
      var col = map.colOf(e.x), row = map.rowOf(e.z);
      if (!map.inBounds(col, row) || map.isSolid(col, row) || !map.isWalkable(col, row)) bad++;
      moved += Math.hypot(e.x - lastX, e.z - lastZ);
      lastX = e.x; lastZ = e.z;
    }
    t.ok(bad === 0, 'P4.12 項目6: 6000フレームの追跡で実体マスへの侵入0', bad + '回');
    t.ok(moved > 200, 'P4.12 項目6: 耐久テストで実際に走り回っている', moved.toFixed(0) + 'm');
    t.near(e.scale, ESCAPE.EnemyScale.CRAWL, 1e-6,
      'P4.12 項目6: 耐久テストの間ずっと反転形態の倍率', e.scale.toFixed(3));
    ai.manual = false;
    g.reset();
  }

  /* ---------------- 項目5: 距離連動の鼓動 ---------------- */

  function testP412Heartbeat(t, g) {
    var A = ESCAPE.Audio;
    if (!t.ok(A && typeof A.heartbeatFor === 'function', 'P4.12 項目5: 鼓動の純関数がある')) return;
    t.near(A.HB_START, 20.0, 1e-9, 'P4.12 項目5: 20m以内で鳴り始める（契約）', A.HB_START);
    t.near(A.HB_FULL, 5.0, 1e-9, 'P4.12 項目5: 5mで最大（契約）', A.HB_FULL);
    t.ok(A.heartbeatFor(21, false).on === false, 'P4.12 項目5: 20mより遠いと鳴らない');
    t.ok(A.heartbeatFor(20, false).on === true, 'P4.12 項目5: 20mで鳴り始める');
    t.ok(A.heartbeatFor(6.0, false).on === true, 'P4.12 項目5: 追跡していなくても近ければ鳴る');

    /* 近いほど速く・大きい（単調） */
    var prevB = -1, prevL = -1, mono = true;
    for (var d = 20; d >= 0; d -= 0.5) {
      var h = A.heartbeatFor(d, false);
      if (h.bpm < prevB - 1e-9 || h.level < prevL - 1e-9) mono = false;
      prevB = h.bpm; prevL = h.level;
    }
    t.ok(mono, 'P4.12 項目5: 近づくほど速く・大きくなる（逆行しない）');
    var h20 = A.heartbeatFor(20, false), h12 = A.heartbeatFor(12, false), h5 = A.heartbeatFor(5, false);
    t.ok(h20.level < h12.level && h12.level < h5.level,
      'P4.12 項目5: 20m<12m<5m の順に大きい',
      h20.level.toFixed(3) + '<' + h12.level.toFixed(3) + '<' + h5.level.toFixed(3));
    t.ok(h20.bpm < h12.bpm && h12.bpm < h5.bpm,
      'P4.12 項目5: 20m<12m<5m の順に速い',
      h20.bpm.toFixed(1) + '<' + h12.bpm.toFixed(1) + '<' + h5.bpm.toFixed(1));
    t.near(h5.bpm, A.HB_BPM_MAX, 1e-6, 'P4.12 項目5: 5mで最大のレート', h5.bpm.toFixed(1));
    t.ok(h20.level <= A.HB_LEVEL_MIN + 1e-9, 'P4.12 項目5: 20mは微弱', h20.level.toFixed(3));
    t.ok(A.heartbeatFor(3, false).level >= A.HB_LEVEL_MAX - 1e-9,
      'P4.12 項目5: 5mより近くても最大で頭打ち');
    /* 追跡中はさらに強調 */
    var c8 = A.heartbeatFor(8, true), n8 = A.heartbeatFor(8, false);
    t.ok(c8.bpm > n8.bpm && c8.level > n8.level,
      'P4.12 項目5: 同じ距離でも追跡中はさらに速く・大きい',
      c8.bpm.toFixed(1) + '>' + n8.bpm.toFixed(1));
    t.ok(c8.level <= A.HB_LEVEL_CAP + 1e-9, 'P4.12 項目5: 音量は歪まない上限に収まる', c8.level.toFixed(3));

    /* OfflineAudioContext のレンダ実測（契約「距離5m/12m/20mでRMSが単調増加」） */
    var c = A.cache;
    var r20 = c.hb_d20, r12 = c.hb_d12, r5 = c.hb_d5;
    if (t.ok(!!(r20 && r12 && r5), 'P4.12 項目5: 距離別の心拍が事前レンダされている',
      A.prewarmError() || '')) {
      t.ok(r20.rms < r12.rms && r12.rms < r5.rms,
        'P4.12 項目5: レンダRMSが 20m<12m<5m で単調増加',
        r20.rms.toFixed(5) + ' < ' + r12.rms.toFixed(5) + ' < ' + r5.rms.toFixed(5));
      t.ok(r20.peak < r12.peak && r12.peak < r5.peak,
        'P4.12 項目5: ピークも同じ順', r20.peak.toFixed(4) + ' < ' + r5.peak.toFixed(4));
      t.ok(!r5.clipped, 'P4.12 項目5: 最大でも歪まない（クリップしない）', r5.peak.toFixed(4));
      t.ok(r20.rms > 0.0005, 'P4.12 項目5: 20mでも無音ではない（微弱に鳴る）', r20.rms.toFixed(5));
    }
  }

  /** 実プレイでの鳴り方: 追跡していなくても 20m 以内なら鳴る／壁越しでも鳴る */
  function testP412HeartbeatInPlay(t, g) {
    g.reset();
    var au = ESCAPE.audio;
    if (!t.ok(!!au, 'P4.12 項目5: 音響エンジンがある')) return;
    var was = au.testMode;
    au.testMode = true;
    var cells = g.map.walkableCells(), map = g.map;
    /* 敵から 10〜14m 離れ、視線が通らない（＝壁越しの）位置を探す */
    var ai = g.ai, e = ai.enemy, spot = null;
    for (var i = 0; i < cells.length && !spot; i++) {
      var c = map.cellCenter(cells[i].col, cells[i].row);
      var d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d < 10 || d > 14) continue;
      if (!ai.blockedLine(e.x, e.z, c.x, c.z)) continue;   /* 遮蔽されている＝壁越し */
      spot = { col: cells[i].col, row: cells[i].row, d: d };
    }
    if (!t.ok(!!spot, 'P4.12 項目5: 壁越しで10〜14mの位置がある')) { au.testMode = was; g.reset(); return; }
    if (g.ais && g.ais.list[1]) g.ais.list[1].manual = true;
    ai.manual = true;
    placePlayer(g, spot.col, spot.row, 0);
    var h0 = au.fired.heartbeat || 0;
    for (var k = 0; k < 240; k++) {
      var cc = map.cellCenter(spot.col, spot.row);
      g.player.x = cc.x; g.player.z = cc.z;
      sim(g, 1);
    }
    var beats = (au.fired.heartbeat || 0) - h0;
    t.ok(ai.state !== 'chase', 'P4.12 項目5: 追跡されていない状態で見ている', ai.state);
    t.ok(beats >= 2, 'P4.12 項目5: 追跡中でなくても壁越し10〜14mで鼓動が鳴る', beats + '拍');
    t.ok(au.hbDist < 20.5, 'P4.12 項目5: 最も近い個体との距離を持っている',
      (au.hbDist === undefined ? '—' : au.hbDist.toFixed(1)) + 'm');
    ai.manual = false;
    au.testMode = was;
    g.reset();
  }

  ESCAPE.__extraSuites.push(
    testEnemyPairContract,
    testTerritoryPatrol,
    testTrapTuning,
    testTrapBothRespond,
    testTrapSprintSpeed,
    testTrapSearchIsLong,
    testTerritoryLeaveAndReturn,
    testCaptureByEitherEnemy,
    testCaptureWipesMap,
    testShriekAudio,
    /* P4.12 レーンA（担ぎ運び・敵の拡大・距離連動の鼓動） */
    testP412Carry,
    testP412CarryLampsFlow,
    testP412EnemyScale,
    testP412HitboxScale,
    testP412CrawlFitsCorridor,
    testP412CrawlEndurance,
    testP412Heartbeat,
    testP412HeartbeatInPlay
  );
  for (var si = 0; si < ESCAPE.__extraSuites.length; si++) {
    ESCAPE.__extraSuites[si] = cleanSuite(ESCAPE.__extraSuites[si]);
  }

  /* 単独実行（test.js への結線が済むまでの納品形）。
     t の署名は test.js の Runner と同じ（ok / near）。 */
  function ExtraRunner() { this.results = []; this.passed = 0; this.failed = 0; }
  ExtraRunner.prototype.ok = function (cond, name, detail) {
    var pass = !!cond;
    this.results.push({ name: name, pass: pass, detail: detail === undefined ? '' : String(detail) });
    if (pass) this.passed++; else this.failed++;
    return pass;
  };
  ExtraRunner.prototype.near = function (v, want, eps, name, detail) {
    return this.ok(Math.abs(v - want) <= eps, name,
      detail === undefined ? (v + ' vs ' + want) : detail);
  };

  function runExtra(opts) {
    var g = ESCAPE.game, t = new ExtraRunner();
    if (!g) { t.ok(false, 'ゲームが初期化されている'); return t; }
    var au = ESCAPE.audio, was = au ? au.testMode : false;
    if (au) { au.testMode = true; au.panic(); }
    g.reset();
    var list = ESCAPE.__extraSuites;
    for (var i = 0; i < list.length; i++) {
      try { list[i](t, g); }
      catch (err) { t.ok(false, list[i].name + ' で例外', err && err.message); }
    }
    g.reset();
    if (au) { au.testMode = was; }
    var out = { passed: t.passed, failed: t.failed, total: t.results.length, results: t.results };
    if (!(opts && opts.quiet) && global.console) {
      console.log('[__test.runExtra] ' + t.passed + '/' + t.results.length + ' 通過, 失敗 ' + t.failed);
      for (var j = 0; j < t.results.length; j++) {
        if (!t.results[j].pass) console.error('[__test.runExtra] FAIL: ' + t.results[j].name + ' — ' + t.results[j].detail);
      }
    }
    return out;
  }

  function runExtraAsync(opts) {
    var A = ESCAPE.Audio;
    var wait = (A && A.prewarm) ? A.prewarm() : null;
    if (wait && wait.then) return wait.then(function () { return runExtra(opts); });
    return global.Promise ? global.Promise.resolve(runExtra(opts)) : runExtra(opts);
  }

  ESCAPE.runExtraSuites = runExtra;
  global.__extraTest = { run: runExtra, runAsync: runExtraAsync, suites: ESCAPE.__extraSuites };
  function bindExtra() {
    if (global.__test && !global.__test.runExtra) {
      global.__test.runExtra = runExtra;
      global.__test.runExtraAsync = runExtraAsync;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindExtra);
  else bindExtra();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(window);
