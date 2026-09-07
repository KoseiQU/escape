/* ESCAPE — P4.8「アリアドネ方式」fog of war ミニマップ
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」＞地図（右上ミニマップ）
 *
 *  - 初期は真っ暗。歩いた通路と入った部屋だけが描かれる。
 *  - 区画銘板を「調べる」と、その区画の A〜F と施設名が記入される（正文 docs/notes.md「区画名」）。
 *  - ロープの軌跡と落ちた結び目は常時表示。
 *  - 画面幅32%（P4.11 で 22%→32%）・半透明。タップ（PCは M キー）で全画面。
 *
 * P4.11（契約 §4「P4.11 実プレイ差し戻し」項目4・6）:
 *   踏破の記録は「歩いたマス＋その4近傍」＋「入った"部屋"の中」だけ。帯ゾーン
 *   （区画A〜Fの 80×13 の region）に入っただけで帯が丸ごと開示される欠陥を修正した。
 *   描画座標は view()/cellToPx()/pxToCell() の1か所に集約し、往復テストで検証する。
 *
 * スマホ性能への配慮: Canvas 2D に「変わった時だけ」描き直す（毎フレーム描かない）。
 * 踏破の記録は Set 相当の辞書1本だけ＝メモリも O(踏破マス)。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  /* P4.11 項目6: 暗い背景でも読めるコントラストへ引き上げた（未踏破＝ほぼ黒に対し
     踏破は明度3倍以上）。旧値（floor #28303a / room #39434f）は実機で沈んでいた。 */
  var COL = {
    bg: '#04060a',
    floor: '#55687d',
    room: '#6f8599',
    edge: '#151b22',
    rope: 'rgba(255,228,158,0.98)',
    ghost: 'rgba(158,146,114,0.70)',
    knot: '#ffeeb4',
    anchor: '#a9e0ff',
    player: '#ffffff',
    playerEdge: 'rgba(0,0,0,0.85)',
    exit: '#8dffc2',
    label: 'rgba(232,244,255,0.98)',
    labelSub: 'rgba(200,222,240,0.92)',
    labelShadow: 'rgba(0,0,0,0.95)'
  };
  var MINI_PX = 320;   /* 小さいときのバッキング解像度（P4.11: 224→320） */
  var FULL_PX = 760;   /* 全画面のバッキング解像度（P4.11: 616→760） */
  /* プレイヤー矢印の大きさ（マス単位）。P4.11「現行の3倍以上」＝旧 0.85 の3倍超 */
  var PLAYER_ARROW = 2.80;
  var PLAYER_ARROW_LEGACY = 0.85;
  /* 「部屋」と見なす region の上限（マス）。これを超える region は帯ゾーン/長廊下であり、
     入っただけで開示してはならない（P4.11 項目4 の真因） */
  var ROOM_MAX = 14;

  function Minimap(game) {
    this.game = game;
    this.dom = {
      wrap: document.getElementById('minimap-wrap'),
      canvas: document.getElementById('minimap')
    };
    this.ctx = this.dom.canvas ? this.dom.canvas.getContext('2d') : null;
    this.full = false;
    this.reset();
    this._bind();
  }

  Minimap.prototype.reset = function () {
    this.map = this.game.map;
    this.explored = Object.create(null);
    this.exploredCount = 0;
    this.wipes = 0;                         /* P4.10: 踏破を消した回数（捕獲・エリアリセット） */
    this.zones = Object.create(null);       /* 銘板で判明した区画（A〜F） */
    this.zoneCount = 0;
    this.regionsSeen = Object.create(null);
    this.full = false;
    this._sig = '';
    this._lastX = -999; this._lastZ = -999; this._lastYaw = 999;
    if (this.dom.wrap) this.dom.wrap.classList.remove('full');
    this._resize();
    this._dirty = true;
  };

  /** 契約「エリアリセット時に踏破は消える」。区画名（銘板で得た知識）は残す */
  Minimap.prototype.onAreaReset = function () {
    this.explored = Object.create(null);
    this.exploredCount = 0;
    this.regionsSeen = Object.create(null);
    this.wipes++;
    this._dirty = true;
  };

  /** P4.10（契約 §4「捕獲のたびに地図を真っ暗に戻す」・2026-09-04ユーザー指示）
   *  捕獲のたびに fog of war の踏破を全消去する。エリアリセット（3回目）と同じ挙動。
   *  残るもの: ロープの軌跡・結び目・錨（rope が持つ）／鍵の取得（progress が持つ）／
   *            読んだ区画名（this.zones）。復帰後は自分のロープだけが頼りになる。 */
  Minimap.prototype.onCapture = function () {
    this.onAreaReset();
  };

  Minimap.prototype._resize = function () {
    var c = this.dom.canvas;
    if (!c) return;
    var px = this.full ? FULL_PX : MINI_PX;
    if (c.width !== px) { c.width = px; c.height = px; }
  };

  Minimap.prototype._bind = function () {
    var self = this;
    var w = this.dom.wrap;
    if (w && !w._escBound) {
      w._escBound = true;
      var tap = function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.toggle();
      };
      w.addEventListener('touchstart', tap, { passive: false });
      w.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
      w.addEventListener('mousedown', tap);
    }
    global.addEventListener('keydown', function (e) {
      if (e.code === 'KeyM') self.toggle();
      else if (e.code === 'Escape' && self.full) self.toggle();
    });
  };

  Minimap.prototype.toggle = function () {
    this.full = !this.full;
    if (this.dom.wrap) this.dom.wrap.classList.toggle('full', this.full);
    this._resize();
    this._dirty = true;
    this.draw();
    return this.full;
  };

  /* ---------------- 踏破の記録 ---------------- */

  Minimap.prototype._mark = function (col, row) {
    var k = col + ',' + row;
    if (this.explored[k]) return;
    if (!this.map.inBounds(col, row)) return;
    var d = ESCAPE.TILE_DEFS[this.map.tileAt(col, row)];
    if (!d || !d.walkable) return;
    this.explored[k] = true;
    this.exploredCount++;
    this._dirty = true;
  };

  /** その region が「部屋」か（帯ゾーン・ランドマーク長廊下は部屋ではない）
   *  P4.11 項目4 の真因: meta.regions には区画A〜Fの帯（80×13）と長廊下（19×1）も
   *  入っている。旧実装は「zone を持つ region に入ったら丸ごと開示」だったので、
   *  通路を1歩でも歩くと帯が丸ごと開示され、歩いていない別の帯・遠い部屋まで
   *  地図に描かれていた。部屋＝両辺が ROOM_MAX 以下、かつ長廊下リストに無いもの。 */
  Minimap.prototype._isRoom = function (r) {
    if (!r || !r.zone) return false;
    var w = r.c1 - r.c0 + 1, h = r.r1 - r.r0 + 1;
    if (w > ROOM_MAX || h > ROOM_MAX) return false;
    if (w < 2 || h < 2) return false;                    /* 幅1＝廊下 */
    var lm = (this.map.meta && this.map.meta.landmarks) || [];
    for (var i = 0; i < lm.length; i++) if (lm[i].id === r.id) return false;
    return true;
  };

  /** 部屋の一覧（判定を1か所に集約する。テストからも参照する） */
  Minimap.prototype.roomRegions = function () {
    var regions = (this.map.meta && this.map.meta.regions) || [];
    var out = [];
    for (var i = 0; i < regions.length; i++) if (this._isRoom(regions[i])) out.push(regions[i]);
    return out;
  };

  /** 部屋に入ったら、その部屋の「中で繋がっている範囲」だけが描かれる。
   *  （箱の外・壁の向こう側・別の部屋には広がらない＝flood-fill を箱で刈る） */
  Minimap.prototype._enterRegion = function (col, row) {
    var rooms = this.roomRegions();
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (col < r.c0 || col > r.c1 || row < r.r0 || row > r.r1) continue;
      if (this.regionsSeen[r.id]) return;
      if (!this.map.isWalkable(col, row)) return;
      this.regionsSeen[r.id] = true;
      var seen = Object.create(null), q = [col, row], h = 0;
      seen[col + ',' + row] = true;
      var D = [1, 0, -1, 0, 0, 1, 0, -1];
      while (h < q.length) {
        var c = q[h++], w = q[h++];
        this._mark(c, w);
        for (var k = 0; k < 8; k += 2) {
          var nc = c + D[k], nw = w + D[k + 1];
          if (nc < r.c0 || nc > r.c1 || nw < r.r0 || nw > r.r1) continue;
          if (seen[nc + ',' + nw] || !this.map.isWalkable(nc, nw)) continue;
          seen[nc + ',' + nw] = true;
          q.push(nc, nw);
        }
      }
      return;
    }
  };

  /** 区画銘板を読んだ（Progress から呼ばれる） */
  Minimap.prototype.learnZone = function (zone) {
    if (!zone || this.zones[zone]) return false;
    this.zones[zone] = true;
    this.zoneCount++;
    this._dirty = true;
    return true;
  };

  Minimap.prototype.knowsZone = function (zone) { return !!this.zones[zone]; };
  Minimap.prototype.isExplored = function (col, row) { return !!this.explored[col + ',' + row]; };

  /* ---------------- 毎フレーム ---------------- */

  Minimap.prototype.step = function () {
    var p = this.game.player;
    var col = p.col(), row = p.row();
    /* P4.10: 捕獲演出〜復帰の間は踏破を記録しない。
       fog of war は「自分の足で歩いた記録」であって、引きずられている間の座標ではない。
       ここを記録すると、捕獲で消したはずの区画が演出中に描き直されてしまう。 */
    var st = this.game.stealth;
    var frozen = !!(st && st.jail && st.jail.phase !== 'none');
    if (!frozen) {
      this._mark(col, row);
      this._mark(col + 1, row); this._mark(col - 1, row);
      this._mark(col, row + 1); this._mark(col, row - 1);
      this._enterRegion(col, row);
    }

    /* 「変更時のみ再描画」。プレイヤー印は 0.6m / 0.25rad 単位で追従させる */
    var rope = this.game.rope;
    var sig = this.exploredCount + '|' + this.zoneCount + '|' +
      (rope ? (rope.stack.length + ',' + rope.knots.length + ',' + rope.ghosts.length + ',' + (rope.attached ? 1 : 0)) : '');
    var moved = Math.hypot(p.x - this._lastX, p.z - this._lastZ) > 0.6;
    var turned = Math.abs(p.yaw - this._lastYaw) > 0.25;
    if (!this._dirty && sig === this._sig && !moved && !turned) return;
    this._sig = sig;
    this._lastX = p.x; this._lastZ = p.z; this._lastYaw = p.yaw;
    this._dirty = false;
    this.draw();
  };

  /* ---------------- 描画 ---------------- */

  /** 座標変換の唯一の真実（マス ⇄ canvas 画素）。
   *  P4.11 項目4: 旧実装は s = px / map.width 決め打ちで、幅と高さが違うマップでは
   *  縦方向がずれた。ここで正方の余白（ox,oy）まで含めて1か所に集約し、
   *  往復テスト（cellToPx → pxToCell）で検証する。 */
  Minimap.prototype.view = function () {
    var map = this.map;
    var px = (this.dom.canvas ? this.dom.canvas.width : 0) || (this.full ? FULL_PX : MINI_PX);
    var n = Math.max(map.width, map.height);
    var s = px / n;
    return { px: px, s: s, ox: (px - map.width * s) / 2, oy: (px - map.height * s) / 2 };
  };
  /** マス中心 → 画素 */
  Minimap.prototype.cellToPx = function (col, row, v) {
    v = v || this.view();
    return { x: v.ox + (col + 0.5) * v.s, y: v.oy + (row + 0.5) * v.s };
  };
  /** ワールド座標 → 画素 */
  Minimap.prototype.worldToPx = function (x, z, v) {
    v = v || this.view();
    var T = this.map.tileSize;
    return { x: v.ox + (x / T) * v.s, y: v.oy + (z / T) * v.s };
  };
  /** 画素 → マス（往復テスト用。範囲外は場外の値をそのまま返す） */
  Minimap.prototype.pxToCell = function (x, y, v) {
    v = v || this.view();
    return { col: Math.floor((x - v.ox) / v.s), row: Math.floor((y - v.oy) / v.s) };
  };

  Minimap.prototype.draw = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    var map = this.map;
    var v = this.view(), s = v.s, px = v.px;
    var full = this.full;

    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, px, px);

    /* 踏破マス（マスの左上＝中心 - s/2。cellToPx と同じ変換で描く） */
    var roomOf = this._roomMask();
    for (var k in this.explored) {
      var pair = k.split(',');
      var c = +pair[0], r = +pair[1];
      var q = this.cellToPx(c, r, v);
      ctx.fillStyle = roomOf[k] ? COL.room : COL.floor;
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s + 0.6, s + 0.6);
    }

    /* 出口（隔壁）は踏破済みなら印を出す */
    var ep = map.meta.exitPad;
    if (ep && this.explored[ep.col + ',' + ep.row]) {
      var qe = this.cellToPx(ep.col, ep.row, v);
      ctx.fillStyle = COL.exit;
      ctx.fillRect(qe.x - s / 2, qe.y - s / 2, s, s);
    }

    var rope = this.game.rope;
    if (rope) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      /* エリアリセット後も残る古い軌跡 */
      ctx.lineWidth = Math.max(2, s * 0.42);
      ctx.strokeStyle = COL.ghost;
      for (var g = 0; g < rope.ghosts.length; g++) this._stroke(ctx, rope.ghosts[g], v);
      /* いまのロープ（P4.11: 太く・不透明に） */
      ctx.lineWidth = Math.max(3, s * 0.58);
      ctx.strokeStyle = COL.rope;
      this._stroke(ctx, rope.stack, v);
      /* 固定結び目（スタート） */
      var qa = this.cellToPx(rope.anchor.col, rope.anchor.row, v);
      var as = Math.max(4, s * 0.72);
      ctx.fillStyle = COL.anchor;
      ctx.fillRect(qa.x - as / 2, qa.y - as / 2, as, as);
      /* 落ちた結び目 */
      for (var i = 0; i < rope.knots.length; i++) {
        var kn = rope.knots[i];
        var qk = this.worldToPx(kn.x, kn.z, v);
        ctx.fillStyle = COL.knot;
        ctx.beginPath();
        ctx.arc(qk.x, qk.y, Math.max(3, s * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* 区画名（銘板を読んだ区画だけ） */
    this._drawZones(ctx, v, full);

    /* プレイヤー（P4.11 項目6: 向きの分かる矢印・旧比3.3倍） */
    this._drawPlayer(ctx, v);
  };

  /** プレイヤー矢印の一辺（画素）。テストから比率を検査できるよう関数に切り出す */
  Minimap.prototype.playerArrowSize = function (v) {
    v = v || this.view();
    return Math.max(11, v.s * PLAYER_ARROW);
  };
  Minimap.prototype.legacyArrowSize = function (v) {
    v = v || this.view();
    return Math.max(3, v.s * PLAYER_ARROW_LEGACY);
  };

  Minimap.prototype._drawPlayer = function (ctx, v) {
    var p = this.game.player;
    var q = this.worldToPx(p.x, p.z, v);
    var f = this.playerArrowSize(v);
    /* 前方（player.forward() と同じ向き）と右手 */
    var fx = -Math.sin(p.yaw), fy = -Math.cos(p.yaw);
    var rx = -fy, ry = fx;
    var tip = { x: q.x + fx * f, y: q.y + fy * f };
    var bl = { x: q.x - fx * f * 0.62 - rx * f * 0.62, y: q.y - fy * f * 0.62 - ry * f * 0.62 };
    var br = { x: q.x - fx * f * 0.62 + rx * f * 0.62, y: q.y - fy * f * 0.62 + ry * f * 0.62 };
    var tail = { x: q.x - fx * f * 0.22, y: q.y - fy * f * 0.22 };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = COL.player;
    ctx.strokeStyle = COL.playerEdge;
    ctx.lineWidth = Math.max(1.5, f * 0.16);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
  };

  Minimap.prototype._stroke = function (ctx, cells, v) {
    if (!cells || cells.length < 2) return;
    ctx.beginPath();
    for (var i = 0; i < cells.length; i++) {
      var q = this.cellToPx(cells[i].col, cells[i].row, v);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  };

  /** 「部屋」に属する踏破マスの索引（帯ゾーンは部屋ではない＝通路と塗り分ける） */
  Minimap.prototype._roomMask = function () {
    if (this._mask && this._maskCount === this.exploredCount) return this._mask;
    var out = Object.create(null);
    var rooms = this.roomRegions();
    for (var k in this.explored) {
      var pair = k.split(',');
      var c = +pair[0], r = +pair[1];
      for (var i = 0; i < rooms.length; i++) {
        var g = rooms[i];
        if (c >= g.c0 && c <= g.c1 && r >= g.r0 && r <= g.r1) { out[k] = true; break; }
      }
    }
    this._mask = out;
    this._maskCount = this.exploredCount;
    return out;
  };

  /** 区画名の記入位置＝その区画に属する region 群の重心 */
  Minimap.prototype.zoneAnchors = function () {
    var regions = (this.map.meta && this.map.meta.regions) || [];
    var acc = Object.create(null);
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      if (!r.zone) continue;
      var a = acc[r.zone] || (acc[r.zone] = { c: 0, r: 0, n: 0, names: [] });
      a.c += (r.c0 + r.c1) / 2;
      a.r += (r.r0 + r.r1) / 2;
      a.n++;
    }
    return acc;
  };

  Minimap.prototype._drawZones = function (ctx, v, full) {
    var names = ESCAPE.ZONE_NAMES || {};
    var acc = this.zoneAnchors();
    var s = v.s;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* 暗い背景でも読めるよう、影を敷いてから塗る（P4.11 項目6） */
    ctx.shadowColor = COL.labelShadow;
    ctx.shadowBlur = Math.max(3, s * 0.9);
    for (var z in acc) {
      if (!this.zones[z]) continue;
      var a = acc[z];
      var q = this.cellToPx(a.c / a.n, a.r / a.n, v);
      if (full) {
        ctx.font = 'bold ' + Math.round(s * 1.8) + 'px sans-serif';
        ctx.fillStyle = COL.label;
        ctx.fillText(z, q.x, q.y - s * 1.0);
        ctx.font = 'bold ' + Math.round(s * 1.05) + 'px sans-serif';
        ctx.fillStyle = COL.labelSub;
        ctx.fillText(names[z] || '', q.x, q.y + s * 1.0);
      } else {
        ctx.font = 'bold ' + Math.round(s * 3.0) + 'px sans-serif';
        ctx.fillStyle = COL.label;
        ctx.fillText(z, q.x, q.y);
      }
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  };

  /* ---------------- セーブ/ロード ---------------- */
  Minimap.prototype.save = function () {
    var ex = [];
    for (var k in this.explored) ex.push(k);
    var zs = [];
    for (var z in this.zones) zs.push(z);
    return { explored: ex, zones: zs };
  };
  Minimap.prototype.load = function (d) {
    if (!d) return false;
    var ex = d.explored || [];
    for (var i = 0; i < ex.length; i++) {
      if (!this.explored[ex[i]]) { this.explored[ex[i]] = true; this.exploredCount++; }
    }
    var zs = d.zones || [];
    for (var j = 0; j < zs.length; j++) this.learnZone(zs[j]);
    this._dirty = true;
    return true;
  };

  Minimap.prototype.info = function () {
    var zs = [];
    for (var z in this.zones) zs.push(z);
    zs.sort();
    var v = this.view();
    return {
      explored: this.exploredCount, zones: zs, full: this.full, wipes: this.wipes,
      px: v.px, scale: v.s, arrow: this.playerArrowSize(v), arrowLegacy: this.legacyArrowSize(v),
      rooms: this.roomRegions().length
    };
  };

  ESCAPE.Minimap = Minimap;
  /* 機械テスト用の定数公開（唯一の真実はこのファイルの上端） */
  ESCAPE.MINIMAP_CONST = {
    MINI_PX: MINI_PX, FULL_PX: FULL_PX,
    PLAYER_ARROW: PLAYER_ARROW, PLAYER_ARROW_LEGACY: PLAYER_ARROW_LEGACY,
    ROOM_MAX: ROOM_MAX, COL: COL
  };

  global.__mapDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.minimap; },
    info: function () {
      var m = ESCAPE.game && ESCAPE.game.minimap;
      return m ? m.info() : null;
    },
    toggle: function () {
      var m = ESCAPE.game && ESCAPE.game.minimap;
      return m ? m.toggle() : null;
    }
  };
})(window);
