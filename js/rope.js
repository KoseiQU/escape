/* ESCAPE — P4.8「アリアドネ方式」ロープ（P4.12 で長さ制限を撤廃）
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」＋「P4.12 再プレイ差し戻し」項目4
 *
 *  - スタート地点の結び目に固定され、腰で結ばれている。
 *  - **長さ L は無制限（Infinity）**。どれだけ歩いても張らない・止まらない（P4.12）。
 *  - 前進で繰り出し、敷いたロープの上を戻ると巻き戻る（＝道しるべとしての巻き取り）。
 *  - 残るのは**張力インジケータ（方向判定）**だけ: 緑=遠回り率≤1.10 / 黄=≤1.50 / 赤=>1.50。
 *  - 捕獲でロープ端が床に落ちて結び目になる。復帰後に「拾って結ぶ」と再接続。
 *  - 敵には不可視・干渉なし（敵AIはこのモジュールを一切参照しない）。
 *
 * 【P4.12 失効】L = 最短×(1+α)／「ロープが張った」停止／腰を引かれる演出／余裕(m)の表示／
 *   余裕不足による赤（redSlackRatio）は**すべて失効**。定数 alpha・redSlackRatio・
 *   tautMsgDur・tautPullDur・tautPullSpeed は削除し、_enter() の余裕判定・_onTaut()・
 *   _pullBack() は到達不能化（コードごと削除）した。slack() は Infinity を返す互換用の残骸。
 *
 * 内部モデル（重要）:
 *   敷かれたロープ＝「マスの列（stack）」。プレイヤーが新しいマスへ入ると1マス分(=tileSize)
 *   繰り出し、既に列に載っているマスへ入ると**そのマスまで列を切り詰める**（＝巻き戻し）。
 *   これにより stack は常に錨から現在地までの単純路になり、used = その路の長さになる。
 *   ループを一周した場合もロープは角で引き締まって短くなる（物理的にもこれが自然）。
 *
 * 毎フレームの上書き事故を避けるための約束:
 *   このモジュールはプレイヤー位置を**一切書き換えない**（P4.12 で前進不可が失効したため）。
 *   game.stepFrame() は player.step() の直後に update() を一度だけ呼ぶ。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* 契約 §4「P4.12 再プレイ差し戻し」項目4（2026-09-07）:
     L=無制限。3色は**遠回り率だけ**で決まる（緑 ≤×1.10 ／黄 ≤×1.50 ／赤 >×1.50）。
     【失効】alpha（P4.8 0.30 → P4.9 0.35 → P4.11 0.70）・redSlackRatio（0.08）・
     tautMsgDur・tautPullDur・tautPullSpeed。長さ制限そのものが無くなったため定数ごと削除。 */
  var ROPE_TUNING = {
    greenRatio: 1.10,        /* 緑: 使用長 ≤ 基準最短 × これ（P4.11 1.05→1.10） */
    yellowRatio: 1.50,       /* 黄: 遠回り中（≤ 基準最短 × これ）。超えたら赤（P4.11 1.35→1.50） */
    tensionInterval: 0.50,   /* 張力インジケータの再計算間隔(s)。マス変化時は即時 */
    redWarnDur: 3.20,        /* 赤に入った時の目的表示の一時差し替え(s) */
    knotPickRange: 2.30,     /* 結び目に「調べる」が届く距離(m) */
    trailWidth: 0.075,       /* 床に敷かれたロープの見かけの太さ(m) */
    trailLift: 0.035,        /* 床からの浮かせ量(m)。Zファイト回避 */
    maxSegments: 512         /* 折れ線の上限（stack + ghost をまとめて格納する） */
  };

  /** P4.12: ロープの長さは無制限。L は Infinity で固定（HUDにも出さない） */
  var ROPE_LENGTH_UNLIMITED = Infinity;

  var ROPE_COLOR = 0xc9b489;
  var GHOST_COLOR = 0x6b6152;
  var KNOT_COLOR = 0xf0dda6;

  function sfx(name, p) {
    if (ESCAPE.audio && ESCAPE.audio.event) ESCAPE.audio.event(name, p);
  }
  /** 音響ディレクタの衝撃値を底上げする（ディレクタは毎フレーム減衰させてから使う） */
  function shakeKick(v) {
    var au = ESCAPE.audio;
    if (au && au.fx) au.fx.shakeImpulse = Math.max(au.fx.shakeImpulse, v);
  }
  /** runtime の通行止め（牢の鉄格子）を無視した素の歩行可能判定＝経路長の算出用 */
  function rawWalkable(map, col, row) {
    if (!map.inBounds(col, row)) return false;
    var d = ESCAPE.TILE_DEFS[map.tileAt(col, row)];
    return !!(d && d.walkable);
  }

  /* ================================================================
   * Rope
   * ============================================================== */
  function Rope(game) {
    this.game = game;
    this.T = ROPE_TUNING;
    this.group = new THREE.Group();
    this.group.name = 'rope';
    if (game.scene) game.scene.add(this.group);
    this._geos = [];
    this._mats = [];
    this._trail = null;
    this._ghost = null;
    this.reset();
  }

  /** スタート→出口の最短経路長（マス数）。P4.12 で L の算出には使わなくなったが、
   *  基準最短の妥当性検査（機械テスト）と情報表示のために残す。 */
  Rope.prototype.shortestCells = function () {
    var map = this.game.map, meta = map.meta || {};
    var sp = meta.spawn, ex = meta.exitPad;
    if (!sp || !ex) return 0;
    var dist = Object.create(null);
    dist[sp.col + ',' + sp.row] = 0;
    var q = [[sp.col, sp.row]], head = 0;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < q.length) {
      var cur = q[head++];
      var d0 = dist[cur[0] + ',' + cur[1]];
      for (var i = 0; i < 4; i++) {
        var nc = cur[0] + D[i][0], nr = cur[1] + D[i][1], k = nc + ',' + nr;
        if (dist[k] !== undefined || !rawWalkable(map, nc, nr)) continue;
        dist[k] = d0 + 1;
        q.push([nc, nr]);
      }
    }
    var v = dist[ex.col + ',' + ex.row];
    return (v === undefined) ? 0 : v;
  };

  Rope.prototype.reset = function () {
    var map = this.game.map, meta = map.meta || {};
    this.map = map;
    this.anchor = { col: meta.spawn.col, row: meta.spawn.row };
    this.shortest = this.shortestCells() * map.tileSize;
    /* P4.12: L は無制限。旧「最短×(1+α)」は失効 */
    this.L = ROPE_LENGTH_UNLIMITED;
    this.stack = [{ col: this.anchor.col, row: this.anchor.row }];
    this._index = Object.create(null);
    this._index[this.anchor.col + ',' + this.anchor.row] = 0;
    this.used = 0;
    this.attached = true;
    this.knots = [];
    this.ghosts = [];
    this.payouts = 0;
    this.rewinds = 0;
    this.blocks = 0;          /* P4.12 失効: 前進不可は起きないので常に 0 */
    this.picks = 0;
    this.drops = 0;
    this.redWarns = 0;
    this.redT = 0;
    this._tension = null;
    this._tenT = 0;
    this._tenCell = null;
    this._dirty = true;
    this._lastX = 0; this._lastZ = 0;
    this._clearFX();
    this._buildKnots();
  };

  /* ---------------- 張力インジケータ＝方向判定（DESIGN.md §4「P4.12」項目4） ----------------
   * P4.12 改訂。ロープの長さが無制限になったので、色は**遠回り率だけ**で決まる。
   *   緑 = 正解ルートに沿っている（使用長 ≤ 基準最短 × 1.10）
   *   黄 = 遠回り中                （≤ 基準最短 × 1.50）
   *   赤 = 大きく外れている        （> 基準最短 × 1.50）
   *   【失効】「余裕 < L × 0.08 で赤」（P4.9 redSlackRatio）は長さ制限ごと失効。
   *   （閾値は ROPE_TUNING が唯一の真実）
   * 距離場（スタート／鍵／出口）は静的なので BFS はリセット時に3枚だけ焼き、以後は O(1) 参照。
   * 鍵・出口までの距離は状態判定には使わない（情報表示と機械テスト用に残す）。
   * 状態の再評価はマスが変わった時と 0.5 秒ごと（契約の「間引き計算」）。 */

  /** 任意のマスからの距離場（マス数。未到達は -1） */
  Rope.prototype._distMap = function (col, row) {
    var map = this.map || this.game.map;
    var W = map.width, H = map.height;
    var d = new Int32Array(W * H);
    for (var i = 0; i < d.length; i++) d[i] = -1;
    if (!rawWalkable(map, col, row)) return d;
    d[row * W + col] = 0;
    var q = [col, row], head = 0;
    var D = [1, 0, -1, 0, 0, 1, 0, -1];
    while (head < q.length) {
      var c = q[head++], r = q[head++];
      var d0 = d[r * W + c];
      for (var k = 0; k < 8; k += 2) {
        var nc = c + D[k], nr = r + D[k + 1];
        if (!rawWalkable(map, nc, nr) || d[nr * W + nc] >= 0) continue;
        d[nr * W + nc] = d0 + 1;
        q.push(nc, nr);
      }
    }
    return d;
  };

  /** 金庫（鍵）に「調べる」ために立つマス */
  Rope.prototype._keyStand = function () {
    var map = this.map || this.game.map, meta = map.meta || {};
    var safe = null, gl = meta.gimmicks || [];
    for (var i = 0; i < gl.length; i++) if (gl[i].role === 'safe') safe = gl[i];
    if (!safe) safe = meta.keySafe;
    if (!safe) return null;
    var F = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    if (safe.dir && F[safe.dir]) {
      var v = F[safe.dir];
      if (rawWalkable(map, safe.col + v[0], safe.row + v[1])) {
        return { col: safe.col + v[0], row: safe.row + v[1] };
      }
    }
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < 4; d++) {
      if (rawWalkable(map, safe.col + D[d][0], safe.row + D[d][1])) {
        return { col: safe.col + D[d][0], row: safe.row + D[d][1] };
      }
    }
    return null;
  };

  Rope.prototype._buildDistMaps = function () {
    var map = this.map, meta = map.meta || {};
    this._W = map.width;
    this._dFromSpawn = this._distMap(meta.spawn.col, meta.spawn.row);
    this._dToExit = meta.exitPad ? this._distMap(meta.exitPad.col, meta.exitPad.row) : null;
    var ks = this._keyStand();
    this._dToKey = ks ? this._distMap(ks.col, ks.row) : null;
    this._keyStandCell = ks;
  };

  /** 鍵を取ったか（progress が無い状況＝単体テストでも落ちない） */
  Rope.prototype._hasKey = function () {
    var pr = this.game.progress;
    return !!(pr && pr.gimmick && pr.gimmick.key);
  };

  /** 張力インジケータの状態を計算する（緑/黄/赤 と数値） */
  Rope.prototype.computeTension = function () {
    var map = this.map, T = map.tileSize;
    if (!this._dFromSpawn) this._buildDistMaps();
    var h = this.head();
    var idx = h.row * this._W + h.col;
    var slack = this.slack();
    var goal = this._hasKey() ? 'exit' : 'key';
    var field = (goal === 'exit') ? this._dToExit : this._dToKey;
    var needTiles = (field && field[idx] >= 0) ? field[idx] : -1;
    var need = (needTiles >= 0) ? needTiles * T : 0;
    /* 遠回り率の基準最短（契約 P4.11 項目2 追記）:
       鍵未取得＝スタート→現在地の最短／鍵取得後＝スタート→鍵の最短＋鍵→現在地の最短
       （鍵に寄った分を遠回りに数えない。最短で鍵→出口へ戻る間は緑のまま） */
    var bestTiles = this._dFromSpawn ? this._dFromSpawn[idx] : -1;
    if (goal === 'exit' && this._dToKey && this._keyStandCell && this._dFromSpawn) {
      var kIdx = this._keyStandCell.row * this._W + this._keyStandCell.col;
      var sk = this._dFromSpawn[kIdx], kh = this._dToKey[idx];
      if (sk >= 0 && kh >= 0) bestTiles = sk + kh;
    }
    var best = (bestTiles >= 0) ? bestTiles * T : 0;
    var ratio = (best > 1e-6) ? (this.used / best) : 1;
    /* P4.12: 色は遠回り率だけで決まる（余裕不足の赤＝lowSlack は失効。常に false） */
    var state;
    if (!this.attached) state = 'loose';
    else if (ratio > this.T.yellowRatio + 1e-9) state = 'red';
    else if (ratio <= this.T.greenRatio + 1e-9) state = 'green';
    else state = 'yellow';
    return {
      state: state, goal: goal, slack: slack, used: this.used, L: this.L,
      need: need, needTiles: needTiles, best: best, bestTiles: bestTiles,
      ratio: ratio, lowSlack: false
    };
  };

  /** 直近の張力（毎フレーム BFS を舐めないよう間引いたキャッシュ） */
  Rope.prototype.tension = function () {
    if (!this._tension) this._refreshTension();
    return this._tension;
  };

  Rope.prototype._refreshTension = function () {
    var prev = this._tension;
    this._tension = this.computeTension();
    this._tenT = 0;
    /* 赤に入った瞬間: 短い警告音＋目的表示の一時差し替え（正文は docs/notes.md P4.9追加） */
    if (this._tension.state === 'red' && (!prev || prev.state !== 'red')) {
      this.redT = this.T.redWarnDur;
      this.redWarns++;
      sfx('terminalErr', {});
      shakeKick(0.18);
    }
    return this._tension;
  };

  /** 残りの余裕(m)。P4.12 で L が無制限になったため常に Infinity（表示には使わない） */
  Rope.prototype.slack = function () { return Math.max(0, this.L - this.used); };
  /** いま結ばれているか */
  Rope.prototype.isAttached = function () { return this.attached; };
  Rope.prototype.head = function () { return this.stack[this.stack.length - 1]; };

  /* ---------------- マス遷移（繰り出し・巻き戻し） ---------------- */

  /**
   * player.step() の直後に1回だけ呼ぶ。prevX/prevZ は移動前の座標（P4.12 以降は未使用）。
   * 【P4.12】長さ制限の撤廃により、このメソッドはプレイヤー位置を**一切書き換えない**。
   */
  Rope.prototype.update = function (dt, prevX, prevZ) {
    if (this.redT > 0) { this.redT -= dt; if (this.redT < 0) this.redT = 0; }
    var p = this.game.player;
    var c = p.col(), r = p.row();
    if (!this.attached) {
      /* 結び目まで戻る区間はロープ無し＝繰り出さない（契約） */
      this._syncTrail();
      this._tickTension(dt);
      return;
    }
    var h = this.head();
    if (c !== h.col || r !== h.row) {
      var steps = this._stepsTo(h, c, r);
      if (!steps) {
        /* 想定外の飛び（テレポート等）。ロープを現在地から張り直す＝壊れた状態を作らない */
        this._relocate(c, r);
      } else {
        for (var i = 0; i < steps.length; i++) this._enter(steps[i].col, steps[i].row);
      }
    }
    this._syncTrail();
    this._tickTension(dt);
  };

  /** 張力インジケータ: マスが変わった時と 0.5 秒ごとにだけ BFS 距離場を引き直す（間引き計算） */
  Rope.prototype._tickTension = function (dt) {
    this._tenT += dt;
    var hh = this.head();
    var hk = hh.col + ',' + hh.row + (this.attached ? '+' : '-');
    if (!this._tension || hk !== this._tenCell || this._tenT >= this.T.tensionInterval) {
      this._refreshTension();
      this._tenCell = hk;
    }
  };

  /** head から (c,r) までの1マスずつの経路（斜め移動は軸で分解する） */
  Rope.prototype._stepsTo = function (h, c, r) {
    var dc = c - h.col, dr = r - h.row;
    var ad = Math.abs(dc) + Math.abs(dr);
    if (ad === 1) return [{ col: c, row: r }];
    if (ad === 2 && dc !== 0 && dr !== 0) {
      /* 角を斜めに抜けた1フレーム。通れる側の中間マスを経由させる */
      if (this.map.isWalkable(c, h.row)) return [{ col: c, row: h.row }, { col: c, row: r }];
      if (this.map.isWalkable(h.col, r)) return [{ col: h.col, row: r }, { col: c, row: r }];
    }
    return null;
  };

  /** 1マス進む。P4.12: 長さ制限が失効したので**必ず true**（呼び側の分岐は残骸） */
  Rope.prototype._enter = function (col, row) {
    var key = col + ',' + row;
    var at = this._index[key];
    if (at !== undefined) {
      /* 既に敷いてあるロープの上＝そこまで巻き戻る（余裕が回復する） */
      while (this.stack.length - 1 > at) {
        var top = this.stack.pop();
        delete this._index[top.col + ',' + top.row];
        this.used -= this.map.tileSize;
        this.rewinds++;
      }
      if (this.used < 0) this.used = 0;
      this._dirty = true;
      return true;
    }
    /* 【P4.12 失効】ここにあった「余裕不足なら blocks++ して false」は到達不能化した
       （L=無制限。契約 §4「P4.12 再プレイ差し戻し」項目4）。 */
    this.stack.push({ col: col, row: row });
    this._index[key] = this.stack.length - 1;
    this.used += this.map.tileSize;
    this.payouts++;
    this._dirty = true;
    return true;
  };

  Rope.prototype._relocate = function (col, row) {
    this.stack = [{ col: col, row: row }];
    this._index = Object.create(null);
    this._index[col + ',' + row] = 0;
    this._dirty = true;
  };

  /* 【P4.12 失効】_onTaut()（「ロープが張った」＋軋み音＋画面揺れ）と
     _pullBack()（腰を引かれる演出）はここにあった。長さ制限の撤廃で到達不能になったため削除。 */

  /* ---------------- 結び目（捕獲・拾い直し） ---------------- */

  /** 捕獲の瞬間: ロープ端が床に落ちて結び目になる */
  Rope.prototype.dropKnot = function () {
    if (!this.attached) return null;
    var p = this.game.player, h = this.head();
    var k = {
      col: h.col, row: h.row,
      x: p.x, z: p.z, y: this.map.floorYAt(p.x, p.z),
      used: this.used,
      stack: this.stack.slice()
    };
    this.knots.push(k);
    this.attached = false;
    this.drops++;
    this._buildKnots();
    this._dirty = true;
    return k;
  };

  /** 近くの結び目（「調べる」の対象） */
  Rope.prototype.nearKnot = function () {
    if (this.attached) return null;
    var p = this.game.player, best = null, bd = Infinity;
    for (var i = 0; i < this.knots.length; i++) {
      var k = this.knots[i];
      var d = Math.hypot(k.x - p.x, k.z - p.z);
      if (d <= this.T.knotPickRange && d < bd) { bd = d; best = k; }
    }
    return best;
  };

  /** 結び目を拾って結ぶ＝再接続。true=拾えた */
  Rope.prototype.pickUp = function () {
    var k = this.nearKnot();
    if (!k) return false;
    this.stack = k.stack.slice();
    this._index = Object.create(null);
    for (var i = 0; i < this.stack.length; i++) {
      this._index[this.stack[i].col + ',' + this.stack[i].row] = i;
    }
    this.used = k.used;
    this.attached = true;
    this.picks++;
    this._tension = null; this._tenCell = null; this._tenT = 0;
    var idx = this.knots.indexOf(k);
    if (idx >= 0) this.knots.splice(idx, 1);
    sfx('pickup', {});
    this._buildKnots();
    this._dirty = true;
    return true;
  };

  /** 3回目の捕獲＝エリアリセット。契約: ロープの軌跡は世界に残す（地図の踏破だけ消える） */
  Rope.prototype.onAreaReset = function () {
    var ghost = this.stack.slice();
    for (var i = 0; i < this.knots.length; i++) {
      if (this.knots[i].stack.length > ghost.length) ghost = this.knots[i].stack.slice();
    }
    if (ghost.length > 1) this.ghosts.push(ghost);
    this.stack = [{ col: this.anchor.col, row: this.anchor.row }];
    this._index = Object.create(null);
    this._index[this.anchor.col + ',' + this.anchor.row] = 0;
    this.used = 0;
    this.attached = true;
    this.knots.length = 0;
    this.redT = 0; this._tension = null; this._tenCell = null; this._tenT = 0;
    this._buildKnots();
    this._dirty = true;
  };

  /* ---------------- セーブ/ロード ---------------- */
  Rope.prototype.save = function () {
    function packStack(s) {
      var out = [];
      for (var i = 0; i < s.length; i++) out.push(s[i].col, s[i].row);
      return out;
    }
    var knots = [];
    for (var i = 0; i < this.knots.length; i++) {
      var k = this.knots[i];
      knots.push({ x: k.x, z: k.z, col: k.col, row: k.row, used: k.used, stack: packStack(k.stack) });
    }
    var gh = [];
    for (var j = 0; j < this.ghosts.length; j++) gh.push(packStack(this.ghosts[j]));
    return { stack: packStack(this.stack), used: this.used, attached: this.attached, knots: knots, ghosts: gh };
  };

  Rope.prototype.load = function (d) {
    if (!d || !d.stack || !d.stack.length) return false;
    function unpack(a) {
      var out = [];
      for (var i = 0; i + 1 < a.length; i += 2) out.push({ col: a[i] | 0, row: a[i + 1] | 0 });
      return out;
    }
    this.stack = unpack(d.stack);
    this._index = Object.create(null);
    for (var i = 0; i < this.stack.length; i++) this._index[this.stack[i].col + ',' + this.stack[i].row] = i;
    this.used = +d.used || 0;
    this.attached = (d.attached !== false);
    this.knots = [];
    var kn = d.knots || [];
    for (var j = 0; j < kn.length; j++) {
      this.knots.push({
        col: kn[j].col | 0, row: kn[j].row | 0, x: +kn[j].x, z: +kn[j].z,
        y: this.map.floorYAt(+kn[j].x, +kn[j].z),
        used: +kn[j].used || 0, stack: unpack(kn[j].stack || [])
      });
    }
    this.ghosts = [];
    var gh = d.ghosts || [];
    for (var g = 0; g < gh.length; g++) this.ghosts.push(unpack(gh[g]));
    this._tension = null; this._tenCell = null; this._tenT = 0; this.redT = 0;
    this._buildKnots();
    this._dirty = true;
    return true;
  };

  /* ---------------- 描画（折れ線を薄いリボンで敷く） ---------------- */

  Rope.prototype._clearFX = function () {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    for (var i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    for (var j = 0; j < this._mats.length; j++) this._mats[j].dispose();
    this._geos.length = 0;
    this._mats.length = 0;
    this._trail = null;
    this._ghost = null;
    this._knotFX = null;
  };

  /** 上限本数ぶん確保した固定バッファのリボン（毎フレームの再生成をしない） */
  Rope.prototype._makeRibbon = function (color, opacity) {
    var n = this.T.maxSegments;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(n * 4 * 3);
    var idx = new Uint16Array(n * 6);
    for (var i = 0; i < n; i++) {
      var v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    var mat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity, fog: true,
      depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this._geos.push(geo);
    this._mats.push(mat);
    this.group.add(mesh);
    return { mesh: mesh, geo: geo, pos: pos, count: 0 };
  };

  /** points（{x,z}の列）をリボンに書き込む */
  Rope.prototype._writeRibbon = function (rb, pts, startSeg) {
    var w = this.T.trailWidth * 0.5, lift = this.T.trailLift, map = this.map;
    var seg = startSeg || 0, max = this.T.maxSegments;
    for (var i = 0; i + 1 < pts.length && seg < max; i++) {
      var a = pts[i], b = pts[i + 1];
      var dx = b.x - a.x, dz = b.z - a.z;
      var d = Math.hypot(dx, dz);
      if (d < 1e-5) continue;
      var px = -dz / d * w, pz = dx / d * w;
      var o = seg * 12;
      var ay = map.floorYAt(a.x, a.z) + lift, by = map.floorYAt(b.x, b.z) + lift;
      rb.pos[o] = a.x + px; rb.pos[o + 1] = ay; rb.pos[o + 2] = a.z + pz;
      rb.pos[o + 3] = a.x - px; rb.pos[o + 4] = ay; rb.pos[o + 5] = a.z - pz;
      rb.pos[o + 6] = b.x - px; rb.pos[o + 7] = by; rb.pos[o + 8] = b.z - pz;
      rb.pos[o + 9] = b.x + px; rb.pos[o + 10] = by; rb.pos[o + 11] = b.z + pz;
      seg++;
    }
    return seg;
  };

  /** stack（＋結び目から先の落ちたロープ）を折れ線の点列にする */
  Rope.prototype.points = function () {
    var pts = [], map = this.map;
    for (var i = 0; i < this.stack.length; i++) {
      var c = map.cellCenter(this.stack[i].col, this.stack[i].row);
      pts.push({ x: c.x, z: c.z });
    }
    if (this.attached) {
      var p = this.game.player;
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };

  Rope.prototype._syncTrail = function () {
    var p = this.game.player;
    var moved = Math.hypot(p.x - this._lastX, p.z - this._lastZ);
    if (!this._dirty && moved < 0.12) return;
    this._lastX = p.x; this._lastZ = p.z;
    this._dirty = false;

    if (!this._trail) this._trail = this._makeRibbon(ROPE_COLOR, 0.62);
    var seg = this._writeRibbon(this._trail, this.points(), 0);
    /* 未接続のときは「落ちたロープ」として結び目までを描き続ける（stack のまま） */
    this._trail.geo.attributes.position.needsUpdate = true;
    this._trail.geo.setDrawRange(0, seg * 6);
    this._trail.count = seg;

    if (this.ghosts.length) {
      if (!this._ghost) this._ghost = this._makeRibbon(GHOST_COLOR, 0.30);
      var gs = 0;
      for (var i = 0; i < this.ghosts.length; i++) {
        var pts = [];
        for (var j = 0; j < this.ghosts[i].length; j++) {
          var c = this.map.cellCenter(this.ghosts[i][j].col, this.ghosts[i][j].row);
          pts.push({ x: c.x, z: c.z });
        }
        gs = this._writeRibbon(this._ghost, pts, gs);
      }
      this._ghost.geo.attributes.position.needsUpdate = true;
      this._ghost.geo.setDrawRange(0, gs * 6);
      this._ghost.count = gs;
    }
  };

  /** 落ちた結び目（淡く光る小メッシュ） */
  Rope.prototype._buildKnots = function () {
    if (this._knotFX) {
      this.group.remove(this._knotFX);
      this._knotFX = null;
    }
    if (!this.knots.length) return;
    var g = new THREE.Group();
    g.name = 'rope-knots';
    for (var i = 0; i < this.knots.length; i++) {
      var k = this.knots[i];
      var mat = new THREE.MeshBasicMaterial({ color: KNOT_COLOR, transparent: true, opacity: 0.92, fog: true });
      this._mats.push(mat);
      var geo = new THREE.SphereGeometry(0.115, 8, 6);
      this._geos.push(geo);
      var m = new THREE.Mesh(geo, mat);
      m.position.set(k.x, k.y + 0.10, k.z);
      g.add(m);
      /* 足元に広がる「解けた輪」。結び目を見つけやすくする */
      var rgeo = new THREE.RingGeometry(0.20, 0.30, 14);
      this._geos.push(rgeo);
      var rmat = new THREE.MeshBasicMaterial({
        color: KNOT_COLOR, transparent: true, opacity: 0.40, fog: true,
        side: THREE.DoubleSide, depthWrite: false
      });
      this._mats.push(rmat);
      var ring = new THREE.Mesh(rgeo, rmat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(k.x, k.y + 0.045, k.z);
      g.add(ring);
      k.mesh = m;
      k.ring = ring;
    }
    this.group.add(g);
    this._knotFX = g;
  };

  /** 結び目の淡い明滅（ゲーム内時刻駆動＝__pumpでも同じ絵になる） */
  Rope.prototype.step = function () {
    if (!this.knots.length) return;
    var t = this.game.simTime;
    for (var i = 0; i < this.knots.length; i++) {
      var k = this.knots[i];
      var a = 0.62 + 0.32 * (0.5 + 0.5 * Math.sin(t * 2.1 + i));
      if (k.mesh) k.mesh.material.opacity = a;
      if (k.ring) k.ring.material.opacity = a * 0.45;
    }
  };

  Rope.prototype.info = function () {
    return {
      L: this.L, shortest: this.shortest, used: this.used, slack: this.slack(),
      attached: this.attached, cells: this.stack.length,
      knots: this.knots.length, ghosts: this.ghosts.length,
      payouts: this.payouts, rewinds: this.rewinds, blocks: this.blocks,
      picks: this.picks, drops: this.drops,
      tension: this.tension(), redWarns: this.redWarns, redT: this.redT
    };
  };

  ESCAPE.Rope = Rope;
  ESCAPE.ROPE_TUNING = ROPE_TUNING;

  /* ================================================================
   * P4.12 レーンB の機械テスト（契約 §6）。runAll が拾う ESCAPE.__extraSuites に積む。
   * ここに置くのは「ロープ無制限化」に直結する検査だけ（他は js/test.js が持つ）。
   * ============================================================== */
  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];

  /** 3色が**遠回り率だけ**で決まる（余裕・L・繰り出し量に一切依存しない） */
  function testP412TensionByRatioOnly(t, g) {
    g.reset();
    var rope = g.rope, T = ESCAPE.ROPE_TUNING;
    /* 基準最短を持つ地点まで進める（スタートは best=0 で率が定義されない） */
    var meta = g.map.meta;
    rope._enter(meta.spawn.col, meta.spawn.row);
    var base = rope.computeTension();
    if (!base) return;
    /* used を直接動かして率だけを振る。L は Infinity のまま触らない。 */
    rope._buildDistMaps();
    /* 現在地から数マス進めて best > 0 を作る */
    var d = rope._dFromSpawn, W = rope._W, map = g.map;
    var cell = null;
    for (var r = 0; r < map.height && !cell; r++) {
      for (var c = 0; c < map.width; c++) {
        if (d[r * W + c] >= 6 && d[r * W + c] <= 10) { cell = { col: c, row: r }; break; }
      }
    }
    if (!t.ok(!!cell, 'P4.12 色: 基準最短が積み上がるマスが取れる')) return;
    rope.stack = [{ col: cell.col, row: cell.row }];
    rope._index = Object.create(null);
    rope._index[cell.col + ',' + cell.row] = 0;
    var best = rope.computeTension().best;
    if (!t.ok(best > 0, 'P4.12 色: 基準最短 > 0', best.toFixed(1))) return;

    var CASES = [[1.00, 'green'], [1.10, 'green'], [1.11, 'yellow'], [1.50, 'yellow'],
                 [1.51, 'red'], [3.00, 'red'], [20.0, 'red']];
    var bad = [];
    for (var i = 0; i < CASES.length; i++) {
      rope.used = best * CASES[i][0];
      rope._tension = null;
      var st = rope.computeTension();
      if (st.state !== CASES[i][1]) bad.push('×' + CASES[i][0] + '→' + st.state);
      if (st.lowSlack !== false) bad.push('×' + CASES[i][0] + ' lowSlack=true');
      if (st.L !== Infinity) bad.push('×' + CASES[i][0] + ' L≠Infinity');
    }
    t.ok(bad.length === 0,
      'P4.12 色: 緑/黄/赤が遠回り率だけで決まる（1.10/1.50 が境目・余裕不足の赤は無い）',
      bad.join(' / ') || '全ケース一致');
    /* 繰り出し量をどれだけ増やしても、率が小さければ緑のまま */
    rope.used = best * 1.05;
    rope._tension = null;
    t.ok(rope.computeTension().state === 'green' && rope.slack() === Infinity,
      'P4.12 色: 何m繰り出しても率が小さければ緑（長さは色に影響しない）');
    g.reset();
  }

  /** 正文の追従: memo1（P4.12改訂）と ロープHUDの文言 */
  function testP412RopeTexts(t, g) {
    g.reset();
    var N = ESCAPE.PROGRESS_NOTE_TEXTS, memo1 = N && N.a1_n5;
    if (!t.ok(!!memo1, 'P4.12 正文: memo1（a1_n5）がある')) return;
    var WANT = '夜勤の点検員へ\n\n' +
      '隔壁が全部降りた。北の隔壁だけは手動で開くが、鍵がいる。\n' +
      '鍵は所長室の金庫 —— 施設の一番奥だ。\n\n' +
      '腰のロープを外すな。奴らが来る前、俺たちはこれで戻っていた。\n' +
      'ロープの色が濁ったら道を外れている。戻れ。';
    t.ok(memo1.title === '夜勤引継ぎのメモ', 'P4.12 正文: memo1 の表示タイトル', memo1.title);
    t.ok(memo1.body === WANT, 'P4.12 正文: memo1 本文が改訂版と一字一句一致する',
      memo1.body === WANT ? 'OK' : JSON.stringify(memo1.body));
    t.ok(memo1.body.indexOf('ロープが張ったら') < 0,
      'P4.12 正文: 旧末行「ロープが張ったら、それ以上は行くな。」が残っていない');
    t.ok(/ロープの色が濁ったら道を外れている。戻れ。$/.test(memo1.body),
      'P4.12 正文: 末行が「ロープの色が濁ったら道を外れている。戻れ。」');
    t.ok(ESCAPE.PROGRESS_ROPE_HUD === 'ロープ',
      'P4.12 正文: ロープHUDは `ロープ` のラベルのみ', ESCAPE.PROGRESS_ROPE_HUD);
    t.ok(ESCAPE.PROGRESS_OBJECTIVE.ropeDetour === '遠回りしすぎだ —— 戻って巻き戻せ',
      'P4.12 正文: 赤突入時の目的表示は維持', ESCAPE.PROGRESS_OBJECTIVE.ropeDetour);
    g.reset();
  }

  ESCAPE.__extraSuites.push(testP412TensionByRatioOnly, testP412RopeTexts);

  /* 検証フック（機械テスト・E2E用）。ESCAPE.game.rope への遅延参照のみ */
  global.__ropeDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.rope; },
    info: function () {
      var r = ESCAPE.game && ESCAPE.game.rope;
      return r ? r.info() : null;
    },
    tension: function () {
      var r = ESCAPE.game && ESCAPE.game.rope;
      return r ? r.computeTension() : null;
    }
  };
})(window);
