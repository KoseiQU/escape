/* ESCAPE — P4.8「アリアドネ方式」fog of war ミニマップ
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」＞地図（右上ミニマップ）
 *
 *  - 初期は真っ暗。歩いた通路と入った部屋だけが描かれる。
 *  - 区画銘板を「調べる」と、その区画の A〜F と施設名が記入される（正文 docs/notes.md「区画名」）。
 *  - ロープの軌跡と落ちた結び目は常時表示。
 *  - 画面幅22%・半透明。タップ（PCは M キー）で全画面。
 *
 * スマホ性能への配慮: Canvas 2D に「変わった時だけ」描き直す（毎フレーム描かない）。
 * 踏破の記録は Set 相当の辞書1本だけ＝メモリも O(踏破マス)。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var COL = {
    bg: '#04060a',
    floor: '#28303a',
    room: '#39434f',
    edge: '#151b22',
    rope: 'rgba(226,204,150,0.92)',
    ghost: 'rgba(120,110,88,0.55)',
    knot: '#f4e2ab',
    anchor: '#9fd8ff',
    player: '#eaf4fb',
    exit: '#7fe0a8',
    label: 'rgba(206,226,242,0.92)',
    labelSub: 'rgba(168,192,210,0.78)'
  };
  var MINI_PX = 224;   /* 小さいときのバッキング解像度 */
  var FULL_PX = 616;   /* 全画面のバッキング解像度 */

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

  /** 部屋（zone を持つ region）に入ったらその部屋ごと描かれる */
  Minimap.prototype._enterRegion = function (col, row) {
    var regions = (this.map.meta && this.map.meta.regions) || [];
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      if (!r.zone) continue;
      if (col < r.c0 || col > r.c1 || row < r.r0 || row > r.r1) continue;
      if (this.regionsSeen[r.id]) return;
      this.regionsSeen[r.id] = true;
      for (var c = r.c0; c <= r.c1; c++) {
        for (var w = r.r0; w <= r.r1; w++) this._mark(c, w);
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

  Minimap.prototype.draw = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    var map = this.map, T = map.tileSize;
    var px = this.dom.canvas.width;
    var s = px / map.width;              /* 1マスの画素数 */
    var full = this.full;

    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, px, px);

    /* 踏破マス */
    var roomOf = this._roomMask();
    for (var k in this.explored) {
      var pair = k.split(',');
      var c = +pair[0], r = +pair[1];
      ctx.fillStyle = roomOf[k] ? COL.room : COL.floor;
      ctx.fillRect(c * s, r * s, s + 0.6, s + 0.6);
    }

    /* 出口（隔壁）は踏破済みなら印を出す */
    var ep = map.meta.exitPad;
    if (ep && this.explored[ep.col + ',' + ep.row]) {
      ctx.fillStyle = COL.exit;
      ctx.fillRect(ep.col * s, ep.row * s, s, s);
    }

    var rope = this.game.rope;
    if (rope) {
      /* エリアリセット後も残る古い軌跡 */
      ctx.lineWidth = Math.max(1, s * 0.28);
      ctx.strokeStyle = COL.ghost;
      for (var g = 0; g < rope.ghosts.length; g++) this._stroke(ctx, rope.ghosts[g], s);
      /* いまのロープ */
      ctx.lineWidth = Math.max(1.2, s * 0.36);
      ctx.strokeStyle = COL.rope;
      this._stroke(ctx, rope.stack, s);
      /* 固定結び目（スタート） */
      ctx.fillStyle = COL.anchor;
      ctx.fillRect((rope.anchor.col + 0.28) * s, (rope.anchor.row + 0.28) * s, s * 0.46, s * 0.46);
      /* 落ちた結び目 */
      for (var i = 0; i < rope.knots.length; i++) {
        var kn = rope.knots[i];
        ctx.fillStyle = COL.knot;
        ctx.beginPath();
        ctx.arc((kn.x / T) * s, (kn.z / T) * s, Math.max(2, s * 0.42), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* 区画名（銘板を読んだ区画だけ） */
    this._drawZones(ctx, s, full);

    /* プレイヤー */
    var p = this.game.player;
    var pxp = (p.x / T) * s, pzp = (p.z / T) * s;
    var f = Math.max(3, s * 0.85);
    ctx.fillStyle = COL.player;
    ctx.beginPath();
    ctx.moveTo(pxp - Math.sin(p.yaw) * f, pzp - Math.cos(p.yaw) * f);
    ctx.lineTo(pxp + Math.cos(p.yaw) * f * 0.55, pzp - Math.sin(p.yaw) * f * 0.55);
    ctx.lineTo(pxp - Math.cos(p.yaw) * f * 0.55, pzp + Math.sin(p.yaw) * f * 0.55);
    ctx.closePath();
    ctx.fill();
  };

  Minimap.prototype._stroke = function (ctx, cells, s) {
    if (!cells || cells.length < 2) return;
    ctx.beginPath();
    for (var i = 0; i < cells.length; i++) {
      var x = (cells[i].col + 0.5) * s, y = (cells[i].row + 0.5) * s;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  /** 部屋（zone を持つ region）に属する踏破マスの索引 */
  Minimap.prototype._roomMask = function () {
    if (this._mask && this._maskCount === this.exploredCount) return this._mask;
    var out = Object.create(null);
    var regions = (this.map.meta && this.map.meta.regions) || [];
    for (var k in this.explored) {
      var pair = k.split(',');
      var c = +pair[0], r = +pair[1];
      for (var i = 0; i < regions.length; i++) {
        var g = regions[i];
        if (!g.zone) continue;
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

  Minimap.prototype._drawZones = function (ctx, s, full) {
    var names = ESCAPE.ZONE_NAMES || {};
    var acc = this.zoneAnchors();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var z in acc) {
      if (!this.zones[z]) continue;
      var a = acc[z];
      var x = (a.c / a.n + 0.5) * s, y = (a.r / a.n + 0.5) * s;
      if (full) {
        ctx.font = 'bold ' + Math.round(s * 1.5) + 'px sans-serif';
        ctx.fillStyle = COL.label;
        ctx.fillText(z, x, y - s * 0.9);
        ctx.font = Math.round(s * 0.95) + 'px sans-serif';
        ctx.fillStyle = COL.labelSub;
        ctx.fillText(names[z] || '', x, y + s * 0.9);
      } else {
        ctx.font = 'bold ' + Math.round(s * 2.6) + 'px sans-serif';
        ctx.fillStyle = COL.label;
        ctx.fillText(z, x, y);
      }
    }
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
    return { explored: this.exploredCount, zones: zs, full: this.full, wipes: this.wipes };
  };

  ESCAPE.Minimap = Minimap;

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
