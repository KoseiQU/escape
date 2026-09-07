/* ESCAPE — P4.8「アリアドネ方式」ロープ（P4.12 で長さ制限を撤廃／P4.13 で結び目を失効し「周回ごとの軌跡」へ）
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」＋「P4.12 再プレイ差し戻し」項目4
 *   ＋「P4.13 再プレイ差し戻し」項目2
 *
 *  - スタート地点の結び目（＝錨）に固定され、腰で結ばれている。常時接続（P4.13）。
 *  - **長さ L は無制限（Infinity）**。どれだけ歩いても張らない・止まらない（P4.12）。
 *  - 前進で繰り出し、敷いたロープの上を戻ると巻き戻る（＝道しるべとしての巻き取り）。
 *  - 残るのは**張力インジケータ（方向判定）**だけ: 緑=遠回り率≤1.10 / 黄=≤1.50 / 赤=>1.50。
 *  - 敵には不可視・干渉なし（敵AIはこのモジュールを一切参照しない）。
 *
 * 【P4.12 失効】L = 最短×(1+α)／「ロープが張った」停止／腰を引かれる演出／余裕(m)の表示／
 *   余裕不足による赤（redSlackRatio）は**すべて失効**。定数 alpha・redSlackRatio・
 *   tautMsgDur・tautPullDur・tautPullSpeed は削除し、_enter() の余裕判定・_onTaut()・
 *   _pullBack() は到達不能化（コードごと削除）した。slack() は Infinity を返す互換用の残骸。
 *
 * 【P4.13 失効・全面改訂】捕獲時に「ロープ端が床に落ちて結び目になる／復帰後に結び目へ
 *   戻って拾って結ぶ」規定は失効した。代わりに「周回ごとの軌跡」方式にする:
 *     - 捕獲の瞬間、その時点までの軌跡（stack）を**その周の色で固定**し、世界（床リボン）
 *       と地図（ミニマップ・全画面地図）に残す（this.laps に積む）。
 *     - 新しい周は復帰の瞬間、スタート（錨）から即座に始まる。「拾い直し」は無い
 *       （isAttached() は常に true・nearKnot()/pickUp() は何もしない残骸）。
 *     - 色は周ごとに固定: 1周目=淡い黄／2周目=青白／3周目=赤紫（LAP_COLORS）。
 *       過去の周は現在の周より不透明度を下げて表示する。
 *     - 巻き戻し（自分の軌跡を引き返すと消える）は**現在の周（this.stack）だけ**に効く。
 *       過去の周（this.laps）は固定＝一切書き換えない。
 *     - 3回目捕獲のエリアリセット（onAreaReset）で this.laps を全消去し、1周目の色から
 *       やり直す。
 *   関数名 dropKnot() は enemy_ai.js の呼び出し口（Stealth.capture()）をそのまま使うため
 *   名前だけ残し、中身を「現在の周を確定して次の周を開始する」処理に差し替えた。
 *
 * 内部モデル（重要）:
 *   敷かれたロープ＝「マスの列（stack）」。プレイヤーが新しいマスへ入ると1マス分(=tileSize)
 *   繰り出し、既に列に載っているマスへ入ると**そのマスまで列を切り詰める**（＝巻き戻し）。
 *   これにより stack は常に錨から現在地までの単純路になり、used = その路の長さになる。
 *   ループを一周した場合もロープは角で引き締まって短くなる（物理的にもこれが自然）。
 *   this.stack は常に「現在の周」だけを表す。確定済みの周は this.laps（不変の点列）に移る。
 *
 * 毎フレームの上書き事故を避けるための約束:
 *   このモジュールはプレイヤー位置を**一切書き換えない**（P4.12 で前進不可が失効したため）。
 *   game.stepFrame() は player.step() の直後に update() を一度だけ呼ぶ。
 *   【P4.13】捕獲シネマティック〜復帰（stealth.jail.phase !== 'none'）の間は update() が
 *   一切 stack を触らない（下記の理由）。dropKnot() は捕獲の瞬間（演出の開始前）に
 *   呼ばれ、その場で stack を錨だけへ戻す。だが実際のプレイヤー座標はまだ捕獲地点に
 *   居残ったまま（_toStart() が演出後半で動くまで）なので、ガード無しで update() が
 *   毎フレーム動くと「錨からまだ捕獲地点にいる」という差分を**新しい周の移動**と誤認し、
 *   _relocate() で錨を失ってしまう。jail.phase!=='none' の間は完全に凍結し、
 *   _toStart() が実座標を錨へ運び終えてから追跡を再開させることでこれを避けている。
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
    trailWidth: 0.075,       /* 床に敷かれたロープの見かけの太さ(m) */
    trailLift: 0.035,        /* 床からの浮かせ量(m)。Zファイト回避 */
    maxSegments: 512,        /* 折れ線の上限（周1本ぶん。現在の周・過去の周それぞれで別バッファ） */
    curLapOpacity: 0.62,     /* 現在の周の不透明度 */
    pastLapOpacity: 0.32     /* P4.13: 過去の周は現在の周より薄く表示（契約 §4「P4.13」項目2） */
  };

  /** P4.12: ロープの長さは無制限。L は Infinity で固定（HUDにも出さない） */
  var ROPE_LENGTH_UNLIMITED = Infinity;

  /* P4.13（契約 §4「P4.13」項目2）: 周ごとに固定の色。1周目=淡い黄（P4.12までの ROPE_COLOR
     を継承）／2周目=青白／3周目=赤紫。4周目以降が一瞬でも生じた場合（3回目捕獲の直後、
     onAreaReset が走るまでの一瞬）は最後の色を使い回す（_lapColor がクランプする）。
     床リボン（このファイル）とミニマップ・全画面地図（js/minimap.js）は同じ配列を見る。 */
  var LAP_COLORS = [0xc9b489, 0xaee4ff, 0xc45fce];

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
    this._pastRibbons = [];
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
    this.attached = true;    /* P4.13: 結び目の拾い直しが失効し、常時接続に統一 */
    this.knots = [];         /* P4.13: 恒久的に空（互換のためプロパティ自体は残す） */
    this.ghosts = [];        /* P4.13: 旧「軌跡の残骸」概念は laps に統合。恒久的に空（互換） */
    this.laps = [];          /* P4.13: 確定した過去の周（{stack, lapIndex, color} の配列） */
    this.lapIndex = 0;       /* 現在の周（0=1周目/1=2周目/2=3周目）。色は _lapColor() が持つ */
    this.payouts = 0;
    this.rewinds = 0;
    this.blocks = 0;         /* P4.12 失効: 前進不可は起きないので常に 0 */
    this.picks = 0;          /* P4.13 失効: 拾い直しは起きないので常に 0（互換のため残す） */
    this.drops = 0;          /* 周を確定させた回数（旧名のまま。実質「捕獲で周が変わった回数」） */
    this.redWarns = 0;
    this.redT = 0;
    this._tension = null;
    this._tenT = 0;
    this._tenCell = null;
    this._dirty = true;
    this._lastX = 0; this._lastZ = 0;
    this._pastRibbons = [];
    this._clearFX();
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
    /* P4.12: 色は遠回り率だけで決まる（余裕不足の赤＝lowSlack は失効。常に false）。
       P4.13: 「結び目に外れている＝loose」状態も失効（常時接続のため）。 */
    var state;
    if (ratio > this.T.yellowRatio + 1e-9) state = 'red';
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
  /** いま結ばれているか。P4.13: 拾い直しの失効により常に true（互換のため残す） */
  Rope.prototype.isAttached = function () { return this.attached; };
  Rope.prototype.head = function () { return this.stack[this.stack.length - 1]; };

  /* ---------------- マス遷移（繰り出し・巻き戻し） ---------------- */

  /**
   * player.step() の直後に1回だけ呼ぶ。prevX/prevZ は移動前の座標（P4.12 以降は未使用）。
   * 【P4.12】長さ制限の撤廃により、このメソッドはプレイヤー位置を**一切書き換えない**。
   * 【P4.13】捕獲シネマティック〜復帰の間（jail.phase !== 'none'）は完全に凍結する
   *   （ファイル冒頭の注記を参照。dropKnot() が確定させた「新しい周の起点」を、
   *   まだ捕獲地点に居残っているプレイヤー座標で壊さないため）。
   */
  Rope.prototype.update = function (dt, prevX, prevZ) {
    if (this.redT > 0) { this.redT -= dt; if (this.redT < 0) this.redT = 0; }
    var st = this.game.stealth;
    if (st && st.jail && st.jail.phase && st.jail.phase !== 'none') return;
    var p = this.game.player;
    var c = p.col(), r = p.row();
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
    var hk = hh.col + ',' + hh.row;
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
      /* 既に敷いてあるロープの上＝そこまで巻き戻る（余裕が回復する）。
         【P4.13】this.stack は常に「現在の周」だけなので、これは現在の周にしか効かない
         （契約 §4「P4.13」項目2「巻き戻しは現在の周の軌跡だけに効く」）。 */
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

  /* ---------------- 周回ごとの軌跡（P4.13：結び目の拾い直しは失効） ---------------- */

  /** 周番号(0始まり) → その周の固定色。範囲外はクランプ（3回目捕獲の直後、
   *  onAreaReset が走るまでの一瞬だけ 3周目超の状態が生じうるが、色は最後のものを使い回す） */
  Rope.prototype._lapColor = function (idx) {
    var i = idx | 0;
    if (i < 0) i = 0;
    if (i > LAP_COLORS.length - 1) i = LAP_COLORS.length - 1;
    return LAP_COLORS[i];
  };

  /** 確定した周の点列を、書き換わらない静的リボンとして焼く（過去の周は薄く表示） */
  Rope.prototype._freezeLap = function (stackCells, color) {
    if (!stackCells || stackCells.length < 2) return;
    var pts = [];
    for (var i = 0; i < stackCells.length; i++) {
      var c = this.map.cellCenter(stackCells[i].col, stackCells[i].row);
      pts.push({ x: c.x, z: c.z });
    }
    var rb = this._makeRibbon(color, this.T.pastLapOpacity);
    var seg = this._writeRibbon(rb, pts, 0);
    rb.geo.attributes.position.needsUpdate = true;
    rb.geo.setDrawRange(0, seg * 6);
    rb.count = seg;
    this._pastRibbons.push(rb);
  };

  /**
   * 捕獲の瞬間に呼ばれる（enemy_ai.js Stealth.capture() の呼び出し口はそのまま）。
   * 【P4.13 全面改訂】旧「ロープ端が床に落ちて結び目になる」は失効。代わりに
   * 「現在の周を確定して固定表示に回し、次の周をスタートから始める」処理にする。
   * 呼び出し側（enemy_ai.js）は一切変更していない。 */
  Rope.prototype.dropKnot = function () {
    var finished = this.stack.slice();
    var color = this._lapColor(this.lapIndex);
    if (finished.length > 1) {
      this.laps.push({ stack: finished, lapIndex: this.lapIndex, color: color });
      this._freezeLap(finished, color);
    }
    this.lapIndex++;
    this.stack = [{ col: this.anchor.col, row: this.anchor.row }];
    this._index = Object.create(null);
    this._index[this.anchor.col + ',' + this.anchor.row] = 0;
    this.used = 0;
    this.drops++;
    this._tension = null; this._tenCell = null; this._tenT = 0;
    if (this._trail) {
      /* 次の周の色へ塗り替え、点列は空にしておく（_toStart() が実座標を錨へ運ぶまでは
         update() が凍結されているので、次に _syncTrail() が走った時に錨から描き直る） */
      this._trail.mesh.material.color.setHex(this._lapColor(this.lapIndex));
      this._trail.geo.setDrawRange(0, 0);
      this._trail.count = 0;
    }
    this._dirty = true;
    return null;
  };

  /** 【P4.13 失効】結び目に「調べる」で拾い直す動線そのものが失効。恒久的に null（互換のため残す） */
  Rope.prototype.nearKnot = function () { return null; };
  /** 【P4.13 失効】常に false（拾う結び目が存在しない） */
  Rope.prototype.pickUp = function () { return false; };

  /** 3回目の捕獲＝エリアリセット。契約 §4「P4.13」項目2: 軌跡を全消去して1周目の色から
   *  始める（旧「地図の踏破だけ消える／ロープの軌跡は残す」は失効。ロープ側は全消去に統一）。 */
  Rope.prototype.onAreaReset = function () {
    this.stack = [{ col: this.anchor.col, row: this.anchor.row }];
    this._index = Object.create(null);
    this._index[this.anchor.col + ',' + this.anchor.row] = 0;
    this.used = 0;
    this.laps = [];
    this.lapIndex = 0;
    this.knots = [];
    this.ghosts = [];
    this.redT = 0; this._tension = null; this._tenCell = null; this._tenT = 0;
    this._pastRibbons = [];
    this._clearFX();
    this._dirty = true;
  };

  /* ---------------- セーブ/ロード ---------------- */
  Rope.prototype.save = function () {
    function packStack(s) {
      var out = [];
      for (var i = 0; i < s.length; i++) out.push(s[i].col, s[i].row);
      return out;
    }
    var laps = [];
    for (var i = 0; i < this.laps.length; i++) {
      laps.push({ stack: packStack(this.laps[i].stack), lapIndex: this.laps[i].lapIndex });
    }
    return { stack: packStack(this.stack), used: this.used, lapIndex: this.lapIndex, laps: laps };
  };

  /** 【P4.13】旧セーブ（escape.save.area1.v2）に knots/ghosts/attached:false が残っていても
   *  壊れない: それらのフィールドは読まずに無視する（結び目の概念自体が失効したため）。 */
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
    this.attached = true;    /* P4.13: 旧セーブの attached:false があっても常時接続に統一 */
    this.knots = [];         /* 旧セーブの knots があっても無視（恒久的に空） */
    this.ghosts = [];
    this.lapIndex = (d.lapIndex | 0) || 0;
    this.laps = [];
    var oldLaps = d.laps || [];
    for (var j = 0; j < oldLaps.length; j++) {
      var st = unpack(oldLaps[j].stack || []);
      var li = oldLaps[j].lapIndex | 0;
      if (st.length > 1) this.laps.push({ stack: st, lapIndex: li, color: this._lapColor(li) });
    }
    this._tension = null; this._tenCell = null; this._tenT = 0; this.redT = 0;
    this._pastRibbons = [];
    this._clearFX();
    for (var k = 0; k < this.laps.length; k++) this._freezeLap(this.laps[k].stack, this.laps[k].color);
    if (this._trail) this._trail.mesh.material.color.setHex(this._lapColor(this.lapIndex));
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
    this._pastRibbons = [];
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

  /** stack（現在の周）を折れ線の点列にする */
  Rope.prototype.points = function () {
    var pts = [], map = this.map;
    for (var i = 0; i < this.stack.length; i++) {
      var c = map.cellCenter(this.stack[i].col, this.stack[i].row);
      pts.push({ x: c.x, z: c.z });
    }
    var p = this.game.player;
    pts.push({ x: p.x, z: p.z });
    return pts;
  };

  /** 現在の周（this.stack）だけを毎フレーム同期する。過去の周（_pastRibbons）は
   *  確定した瞬間（_freezeLap）に1回だけ書かれる静的メッシュなので、ここでは触らない。 */
  Rope.prototype._syncTrail = function () {
    var p = this.game.player;
    var moved = Math.hypot(p.x - this._lastX, p.z - this._lastZ);
    if (!this._dirty && moved < 0.12) return;
    this._lastX = p.x; this._lastZ = p.z;
    this._dirty = false;

    if (!this._trail) this._trail = this._makeRibbon(this._lapColor(this.lapIndex), this.T.curLapOpacity);
    var seg = this._writeRibbon(this._trail, this.points(), 0);
    this._trail.geo.attributes.position.needsUpdate = true;
    this._trail.geo.setDrawRange(0, seg * 6);
    this._trail.count = seg;
  };

  /** 【P4.13】結び目の明滅演出は失効（結び目自体が無い）。game.js から dt 付きで
   *  呼ばれ続けるため関数自体は残すが、何もしない。 */
  Rope.prototype.step = function () {};

  Rope.prototype.info = function () {
    return {
      L: this.L, shortest: this.shortest, used: this.used, slack: this.slack(),
      attached: this.attached, cells: this.stack.length,
      knots: this.knots.length, ghosts: this.ghosts.length,
      laps: this.laps.length, lapIndex: this.lapIndex,
      payouts: this.payouts, rewinds: this.rewinds, blocks: this.blocks,
      picks: this.picks, drops: this.drops,
      tension: this.tension(), redWarns: this.redWarns, redT: this.redT
    };
  };

  ESCAPE.Rope = Rope;
  ESCAPE.ROPE_TUNING = ROPE_TUNING;
  ESCAPE.ROPE_LAP_COLORS = LAP_COLORS;

  /* ================================================================
   * 機械テスト（契約 §6）。runAll が拾う ESCAPE.__extraSuites に積む。
   * ここに置くのは「ロープ」に直結する検査だけ（他は js/test.js が持つ）。
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

  /** 正文の追従: memo1（P4.12改訂）と HUDラベル（P4.13で `ロープ`→`軌跡`） */
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
    t.ok(ESCAPE.PROGRESS_ROPE_HUD === '軌跡',
      'P4.13 正文: HUDラベルは `軌跡`（P4.12までの `ロープ` から改訂）', ESCAPE.PROGRESS_ROPE_HUD);
    t.ok(ESCAPE.PROGRESS_OBJECTIVE.ropeDetour === '遠回りしすぎだ —— 戻って巻き戻せ',
      'P4.12 正文: 赤突入時の目的表示は維持', ESCAPE.PROGRESS_OBJECTIVE.ropeDetour);
    g.reset();
  }

  /** P4.13 項目2: dropKnot() が「周を確定して次の周を開始する」処理になっている */
  function testP413LapAdvance(t, g) {
    g.reset();
    var rope = g.rope, meta = g.map.meta;
    var sp = meta.spawn;
    /* いくつか歩いて stack を伸ばす */
    var d = rope._distMap(sp.col, sp.row), W = g.map.width, map = g.map, cell = null;
    for (var r = 0; r < map.height && !cell; r++) {
      for (var c = 0; c < map.width; c++) {
        if (d[r * W + c] >= 5 && d[r * W + c] <= 9) { cell = { col: c, row: r }; break; }
      }
    }
    if (!t.ok(!!cell, 'P4.13 周: 検証用に歩ける先マスが取れる')) { g.reset(); return; }
    /* BFS経路に沿って1マスずつ enter する（stack が単純路になっている前提を壊さない） */
    var path = [];
    { /* 逆再構成 */
      var cur = cell, D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var cd = d[cur.row * W + cur.col];
      path.push(cur);
      while (cd > 0) {
        for (var k = 0; k < 4; k++) {
          var nc = cur.col + D[k][0], nr = cur.row + D[k][1];
          if (nc < 0 || nr < 0 || nc >= W || nr >= map.height) continue;
          if (d[nr * W + nc] === cd - 1) { cur = { col: nc, row: nr }; cd--; path.push(cur); break; }
        }
      }
      path.reverse();
    }
    for (var i = 0; i < path.length; i++) rope._enter(path[i].col, path[i].row);
    var stackBefore = rope.stack.length, lapsBefore = rope.laps.length, lapIdxBefore = rope.lapIndex;
    t.ok(stackBefore > 1, 'P4.13 周: 検証用に現在の周へ移動を積めた', stackBefore);

    rope.dropKnot();

    t.ok(rope.laps.length === lapsBefore + 1,
      'P4.13 周: 捕獲で現在の周が laps に1本積まれる（結び目にはならない）',
      rope.laps.length + ' / ' + (lapsBefore + 1));
    var frozen = rope.laps[rope.laps.length - 1];
    t.ok(frozen.stack.length === stackBefore, 'P4.13 周: 積まれた周の形が確定直前と一致する',
      frozen.stack.length + ' / ' + stackBefore);
    t.ok(rope.lapIndex === lapIdxBefore + 1, 'P4.13 周: 周番号が進む', rope.lapIndex);
    t.ok(rope.stack.length === 1 && rope.stack[0].col === rope.anchor.col && rope.stack[0].row === rope.anchor.row,
      'P4.13 周: 新しい周はスタート（錨）だけの状態で始まる（拾い直し不要）',
      JSON.stringify(rope.stack));
    t.ok(rope.used === 0, 'P4.13 周: 新しい周は使用長0から始まる', rope.used);
    t.ok(rope.isAttached() === true, 'P4.13 周: 常時接続（isAttached は常に true）');
    t.ok(rope.nearKnot() === null && rope.pickUp() === false,
      'P4.13 周: 結び目API は失効の残骸（何もしない）');
    g.reset();
  }

  /** P4.13 項目2: 周ごとに固定の色（LAP_COLORS）が割り当たる */
  function testP413LapColors(t, g) {
    g.reset();
    var rope = g.rope, map = g.map;
    t.ok(rope._lapColor(0) === ESCAPE.ROPE_LAP_COLORS[0] &&
      rope._lapColor(1) === ESCAPE.ROPE_LAP_COLORS[1] &&
      rope._lapColor(2) === ESCAPE.ROPE_LAP_COLORS[2],
      'P4.13 色: 1/2/3周目それぞれに固定色が割り当たる（淡い黄/青白/赤紫）');
    /* 錨の歩ける隣マスへ1歩進めて、現在の周のリボンに実体を持たせる */
    function stepFromAnchor() {
      var h = rope.head(), D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var k = 0; k < 4; k++) {
        var nc = h.col + D[k][0], nr = h.row + D[k][1];
        if (map.isWalkable(nc, nr)) { rope._enter(nc, nr); return; }
      }
    }
    stepFromAnchor();
    rope._syncTrail();
    if (!t.ok(!!rope._trail, 'P4.13 色: 現在の周のリボンが生成される')) { g.reset(); return; }
    t.ok(rope._trail.mesh.material.color.getHex() === rope._lapColor(0),
      'P4.13 色: 1周目のリボンは1周目色');
    rope.dropKnot();
    stepFromAnchor();
    rope._syncTrail();
    t.ok(rope._trail.mesh.material.color.getHex() === rope._lapColor(1),
      'P4.13 色: 捕獲後は2周目色に塗り替わる');
    var past = rope._pastRibbons[rope._pastRibbons.length - 1];
    t.ok(!!past && past.mesh.material.color.getHex() === rope._lapColor(0),
      'P4.13 色: 確定した過去の周（1周目）は1周目色で固定表示される');
    t.ok(!!past && past.mesh.material.opacity < rope._trail.mesh.material.opacity,
      'P4.13 色: 過去の周は現在の周より不透明度が低い（薄く表示）',
      past ? (past.mesh.material.opacity + ' < ' + rope._trail.mesh.material.opacity) : 'past なし');
    g.reset();
  }

  /** P4.13 項目2: 巻き戻しは現在の周だけに効く（過去の周は固定・書き換わらない） */
  function testP413RewindCurrentLapOnly(t, g) {
    g.reset();
    var rope = g.rope, sp = g.map.meta.spawn;
    var d = rope._distMap(sp.col, sp.row), W = g.map.width, map = g.map, target = null;
    for (var r = 0; r < map.height && !target; r++) {
      for (var c = 0; c < map.width; c++) {
        if (d[r * W + c] >= 4 && d[r * W + c] <= 8) { target = { col: c, row: r }; break; }
      }
    }
    if (!t.ok(!!target, 'P4.13 巻き戻し: 検証用の到達先が取れる')) { g.reset(); return; }
    var path = [target], cur = target, D = [[1, 0], [-1, 0], [0, 1], [0, -1]], cd = d[target.row * W + target.col];
    while (cd > 0) {
      for (var k = 0; k < 4; k++) {
        var nc = cur.col + D[k][0], nr = cur.row + D[k][1];
        if (nc < 0 || nr < 0 || nc >= W || nr >= map.height) continue;
        if (d[nr * W + nc] === cd - 1) { cur = { col: nc, row: nr }; cd--; path.push(cur); break; }
      }
    }
    path.reverse();
    for (var i = 0; i < path.length; i++) rope._enter(path[i].col, path[i].row);
    rope.dropKnot(); /* 1周目を確定（past lap） */
    var frozenStackRef = rope.laps[0].stack.slice();
    /* 2周目: 同じ経路を歩いてから、途中まで引き返す（巻き戻し） */
    for (var j = 0; j < path.length; j++) rope._enter(path[j].col, path[j].row);
    var lenBefore = rope.stack.length;
    /* 1つ手前のマスへ戻る＝巻き戻し */
    var back = rope.stack[rope.stack.length - 2];
    rope._enter(back.col, back.row);
    t.ok(rope.stack.length === lenBefore - 1,
      'P4.13 巻き戻し: 現在の周（2周目）は引き返すと縮む', rope.stack.length + ' / ' + (lenBefore - 1));
    t.ok(JSON.stringify(rope.laps[0].stack) === JSON.stringify(frozenStackRef),
      'P4.13 巻き戻し: 過去の周（1周目）は一切変化しない（固定）');
    g.reset();
  }

  /** P4.13 項目2: 3回目捕獲のエリアリセットで軌跡を全消去し、1周目の色からやり直す */
  function testP413AreaResetWipesLaps(t, g) {
    g.reset();
    var rope = g.rope, map = g.map, sp = g.map.meta.spawn;
    /* 錨の歩ける隣マスへ1歩進めてから確定する、を2回繰り返して laps を2本作る */
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var pass = 0; pass < 2; pass++) {
      var h = rope.head();
      for (var k = 0; k < 4; k++) {
        var nc = h.col + D[k][0], nr = h.row + D[k][1];
        if (map.isWalkable(nc, nr)) { rope._enter(nc, nr); break; }
      }
      rope.dropKnot();
    }
    if (!t.ok(rope.laps.length === 2 && rope.lapIndex === 2,
      'P4.13 リセット: 検証用に周を2回進めて laps を2本作れた',
      rope.laps.length + ' laps / lapIndex=' + rope.lapIndex)) { g.reset(); return; }
    rope.onAreaReset();
    t.ok(rope.laps.length === 0, 'P4.13 リセット: 軌跡（laps）が全消去される', rope.laps.length);
    t.ok(rope.lapIndex === 0, 'P4.13 リセット: 周番号が1周目（0）に戻る', rope.lapIndex);
    t.ok(rope._pastRibbons.length === 0, 'P4.13 リセット: 過去の周のリボンも消える', rope._pastRibbons.length);
    t.ok(rope.stack.length === 1 && rope.stack[0].col === rope.anchor.col && rope.stack[0].row === rope.anchor.row,
      'P4.13 リセット: 現在の周はスタートからやり直す');
    g.reset();
  }

  /** P4.13: 旧セーブ（escape.save.area1.v2 に knots/ghosts/attached:false が残る形）を
   *  読んでも壊れない（結び目の概念自体が失効したため、それらは無視される） */
  function testP413OldSaveCompat(t, g) {
    g.reset();
    var rope = g.rope, sp = g.map.meta.spawn;
    var oldSave = {
      stack: [sp.col, sp.row, sp.col + 1, sp.row],
      used: 2, attached: false,
      knots: [{ x: 0, z: 0, col: sp.col, row: sp.row, used: 0, stack: [sp.col, sp.row] }],
      ghosts: [[sp.col, sp.row, sp.col + 1, sp.row]]
    };
    var threw = false;
    try { rope.load(oldSave); } catch (e) { threw = true; }
    t.ok(!threw, 'P4.13 旧セーブ互換: knots/ghosts/attached:false が残っていても load() が例外を投げない');
    t.ok(rope.isAttached() === true, 'P4.13 旧セーブ互換: 読み込み後は常時接続（isAttached=true）');
    t.ok(rope.knots.length === 0, 'P4.13 旧セーブ互換: knots は恒久的に空へ正規化される', rope.knots.length);
    t.ok(rope.stack.length === 2 && rope.stack[1].col === sp.col + 1 && rope.stack[1].row === sp.row,
      'P4.13 旧セーブ互換: stack 自体は正しく読み込める');
    g.reset();
  }

  /** P4.13: 捕獲シネマティック中（jail.phase!=='none'）は rope.update() が stack を一切動かさない */
  function testP413FreezeDuringJail(t, g) {
    g.reset();
    var rope = g.rope, st = g.stealth;
    if (!t.ok(!!st && !!st.jail, 'P4.13 凍結: stealth.jail がある')) { g.reset(); return; }
    var before = JSON.stringify(rope.stack);
    var savedPhase = st.jail.phase;
    st.jail.phase = 'grab';
    /* プレイヤーを離れた場所へワープさせても、jail中は追跡されない */
    var map = g.map, far = null, cells = map.walkableCells();
    for (var i = 0; i < cells.length; i++) {
      if (Math.hypot(cells[i].col - rope.head().col, cells[i].row - rope.head().row) > 8) { far = cells[i]; break; }
    }
    if (far) {
      var c = map.cellCenter(far.col, far.row);
      g.player.x = c.x; g.player.z = c.z;
    }
    rope.update(ESCAPE.FIXED_DT, g.player.x, g.player.z);
    t.ok(JSON.stringify(rope.stack) === before,
      'P4.13 凍結: jail.phase!==\'none\' の間は stack が一切変化しない（錨を失わない）');
    st.jail.phase = savedPhase;
    g.reset();
  }

  ESCAPE.__extraSuites.push(
    testP412TensionByRatioOnly, testP412RopeTexts,
    testP413LapAdvance, testP413LapColors, testP413RewindCurrentLapOnly,
    testP413AreaResetWipesLaps, testP413OldSaveCompat, testP413FreezeDuringJail
  );

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
