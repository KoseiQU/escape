/* ESCAPE — グリッドマップのデータ形式とローダー
 * 契約: DESIGN.md §3「データはグリッド定義（1マス=2m想定）を js/maps/ に1エリア1ファイル」
 *
 * マップ定義（js/maps/*.js が ESCAPE.Maps.register() に渡す素のオブジェクト）:
 * {
 *   id:    'test',
 *   name:  'P1検証用テスト迷路',
 *   tileSize: 2.0,               // 省略時 2.0（契約値）
 *   legend: { '#':'WALL', '.':'FLOOR' },   // 1文字 -> タイル種別名
 *   rows:  [ '#####', '#...#', ... ],      // 上から下（row=+Z方向）
 *   meta:  {
 *     spawn: { col:1, row:1, yawDeg:180 },
 *     // 後続フェーズ用（P1では検証のみ・未使用可）:
 *     // notes:[{col,row,id}], gimmicks:[...], cells:[...], checkpoints:[...]
 *   }
 * }
 *
 * ワールド座標: セル(col,row) は x∈[col*T,(col+1)*T], z∈[row*T,(row+1)*T]。
 *               中心は ((col+0.5)*T, (row+0.5)*T)。y=0 が床。
 */
(function (global) {
  'use strict';

  var ESCAPE = global.ESCAPE || (global.ESCAPE = {});

  /** 契約値: 1マス = 2m */
  var TILE_SIZE = 2.0;
  /** 壁・天井の高さ(m)。P1はプレースホルダ、P2で造形。 */
  var WALL_HEIGHT = 3.0;

  /* タイル種別。P1で使うのは VOID/FLOOR/WALL のみ。
   * それ以外は後続フェーズ用の予約枠（ここに足すだけで拡張できる）。 */
  var TILE_DEFS = [
    /* 0 */ { key: 'VOID',       solid: true,  walkable: false, phase: 'P1' },
    /* 1 */ { key: 'FLOOR',      solid: false, walkable: true,  phase: 'P1' },
    /* 2 */ { key: 'WALL',       solid: true,  walkable: false, phase: 'P1' },
    /* 3 */ { key: 'DOOR',       solid: true,  walkable: false, phase: 'P4' }, // 施錠扉（解錠で通行可に）
    /* 4 */ { key: 'NOISE',      solid: false, walkable: true,  phase: 'P3' }, // 音地盤（水たまり・ガラス片）
    /* 5 */ { key: 'LOCKER',     solid: true,  walkable: false, phase: 'P3' }, // ロッカー（隠れ場所）
    /* 6 */ { key: 'BOARD',      solid: false, walkable: true,  phase: 'P3' }, // 倒せる板
    /* 7 */ { key: 'NOTE',       solid: true,  walkable: false, phase: 'P4' }, // 壁のメモ（壁扱い）
    /* 8 */ { key: 'GIMMICK',    solid: true,  walkable: false, phase: 'P4' }, // 仕掛け端末（壁扱い）
    /* 9 */ { key: 'CHECKPOINT', solid: false, walkable: true,  phase: 'P4' },
    /* 10*/ { key: 'CELL',       solid: false, walkable: true,  phase: 'P3' }, // 拘束室（牢）
    /* 11*/ { key: 'SENSOR',     solid: false, walkable: true,  phase: 'P3' },
    /* 12*/ { key: 'EXIT',       solid: false, walkable: true,  phase: 'P4' }
  ];

  var TILE = {};
  for (var i = 0; i < TILE_DEFS.length; i++) TILE[TILE_DEFS[i].key] = i;

  function defOf(t) {
    return TILE_DEFS[t] || TILE_DEFS[0];
  }

  /* ---------------------------------------------------------------- */

  function GridMap(def) {
    this.id = def.id;
    this.name = def.name || def.id;
    this.tileSize = (typeof def.tileSize === 'number') ? def.tileSize : TILE_SIZE;
    this.wallHeight = (typeof def.wallHeight === 'number') ? def.wallHeight : WALL_HEIGHT;
    this.def = def;
    this.meta = def.meta || {};
    this._plateaus = this.meta.plateaus || [];
    this._ramps = this.meta.ramps || [];
    this._ceilings = this.meta.ceilings || [];

    var rows = def.rows || [];
    this.height = rows.length;
    this.width = this.height ? rows[0].length : 0;

    var legend = def.legend || {};
    this.tiles = new Uint8Array(this.width * this.height);
    this.errors = [];

    for (var r = 0; r < this.height; r++) {
      var line = rows[r];
      if (line.length !== this.width) {
        this.errors.push('row ' + r + ' の長さ ' + line.length + ' が幅 ' + this.width + ' と不一致');
      }
      for (var c = 0; c < this.width; c++) {
        var ch = line.charAt(c);
        var name = legend[ch];
        if (name === undefined) {
          this.errors.push('legend に未定義の文字 "' + ch + '" (col ' + c + ', row ' + r + ')');
          this.tiles[r * this.width + c] = TILE.VOID;
          continue;
        }
        var t = TILE[name];
        if (t === undefined) {
          this.errors.push('未知のタイル種別名 "' + name + '"');
          t = TILE.VOID;
        }
        this.tiles[r * this.width + c] = t;
      }
    }
  }

  GridMap.prototype.inBounds = function (col, row) {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  };

  GridMap.prototype.tileAt = function (col, row) {
    if (!this.inBounds(col, row)) return TILE.VOID;
    return this.tiles[row * this.width + col];
  };

  GridMap.prototype.setTile = function (col, row, t) {
    if (this.inBounds(col, row)) this.tiles[row * this.width + col] = t;
  };

  GridMap.prototype.isSolid = function (col, row) {
    if (!this.inBounds(col, row)) return true; // 場外は常に壁
    return defOf(this.tiles[row * this.width + col]).solid;
  };

  GridMap.prototype.isWalkable = function (col, row) {
    if (!this.inBounds(col, row)) return false;
    return defOf(this.tiles[row * this.width + col]).walkable;
  };

  GridMap.prototype.colOf = function (x) { return Math.floor(x / this.tileSize); };
  GridMap.prototype.rowOf = function (z) { return Math.floor(z / this.tileSize); };

  GridMap.prototype.cellCenter = function (col, row) {
    return { x: (col + 0.5) * this.tileSize, z: (row + 0.5) * this.tileSize };
  };

  /* ---------------- 床高さ（DESIGN.md §3「通路のバラエティ」） ----------------
   * meta.plateaus : [{c0,r0,c1,r1,y}]            一定の高さ
   * meta.ramps    : [{c0,r0,c1,r1,axis,y0,y1}]   軸方向に線形補間（階段/スロープ）
   * meta.ceilings : [{c0,r0,c1,r1,h}]            床からの天井高（既定 wallHeight）
   * ランプ区間の両端は「平坦なマス」に接続すること。連続性は validate() が検査する。
   * 落下・跳躍は無い。プレイヤーYは floorYAt() に追従するだけ。
   */

  /** ワールド座標 (x,z) の床の高さ(m) */
  GridMap.prototype.floorYAt = function (x, z) {
    var T = this.tileSize;
    var c = Math.floor(x / T), r = Math.floor(z / T);
    var rs = this._ramps;
    for (var i = 0; i < rs.length; i++) {
      var a = rs[i];
      if (c < a.c0 || c > a.c1 || r < a.r0 || r > a.r1) continue;
      var t;
      if (a.axis === 'x') t = (x - a.c0 * T) / ((a.c1 - a.c0 + 1) * T);
      else t = (z - a.r0 * T) / ((a.r1 - a.r0 + 1) * T);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      return a.y0 + (a.y1 - a.y0) * t;
    }
    var ps = this._plateaus;
    for (var j = 0; j < ps.length; j++) {
      var b = ps[j];
      if (c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1) return b.y;
    }
    return 0;
  };

  /** マス中心の床高さ */
  GridMap.prototype.cellFloorY = function (col, row) {
    return this.floorYAt((col + 0.5) * this.tileSize, (row + 0.5) * this.tileSize);
  };

  /** そのマスの天井高（床からの高さ） */
  GridMap.prototype.ceilHAt = function (col, row) {
    var cs = this._ceilings;
    for (var i = 0; i < cs.length; i++) {
      var a = cs[i];
      if (col >= a.c0 && col <= a.c1 && row >= a.r0 && row <= a.r1) return a.h;
    }
    return this.wallHeight;
  };

  /** 高さ定義の連続性検査。隣接する歩行可能マスの境界で床が段差にならないこと */
  GridMap.prototype.heightSeams = function () {
    var T = this.tileSize, bad = [];
    var D = [[1, 0], [0, 1]];
    for (var r = 0; r < this.height; r++) {
      for (var c = 0; c < this.width; c++) {
        if (!this.isWalkable(c, r)) continue;
        for (var d = 0; d < 2; d++) {
          var nc = c + D[d][0], nr = r + D[d][1];
          if (!this.isWalkable(nc, nr)) continue;
          for (var k = 0; k < 3; k++) {
            var f = 0.02 + k * 0.48, diff;
            if (D[d][0]) {
              var x = (c + 1) * T, z = (r + f) * T;
              diff = Math.abs(this.floorYAt(x - 1e-4, z) - this.floorYAt(x + 1e-4, z));
            } else {
              var x2 = (c + f) * T, z2 = (r + 1) * T;
              diff = Math.abs(this.floorYAt(x2, z2 - 1e-4) - this.floorYAt(x2, z2 + 1e-4));
            }
            if (diff > 0.01) { bad.push(c + ',' + r + '->' + nc + ',' + nr + ' Δ' + diff.toFixed(3)); k = 3; }
          }
        }
      }
    }
    return bad;
  };

  /** 歩行可能マスの列挙 */
  GridMap.prototype.walkableCells = function () {
    var out = [];
    for (var r = 0; r < this.height; r++) {
      for (var c = 0; c < this.width; c++) {
        if (this.isWalkable(c, r)) out.push({ col: c, row: r });
      }
    }
    return out;
  };

  /** 4近傍 flood-fill。到達したマスの Set（キー "col,row"）を返す */
  GridMap.prototype.floodFrom = function (col, row) {
    var seen = Object.create(null);
    if (!this.isWalkable(col, row)) return seen;
    var stack = [[col, row]];
    seen[col + ',' + row] = true;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (stack.length) {
      var cur = stack.pop();
      for (var i = 0; i < 4; i++) {
        var nc = cur[0] + D[i][0], nr = cur[1] + D[i][1];
        var k = nc + ',' + nr;
        if (!seen[k] && this.isWalkable(nc, nr)) { seen[k] = true; stack.push([nc, nr]); }
      }
    }
    return seen;
  };

  /** 定義の静的検証。問題があれば文字列配列を返す */
  GridMap.prototype.validate = function () {
    var errs = this.errors.slice();
    if (this.width < 3 || this.height < 3) errs.push('マップが小さすぎる');
    if (Math.abs(this.tileSize - TILE_SIZE) > 1e-9) {
      errs.push('tileSize ' + this.tileSize + ' が契約値 ' + TILE_SIZE + 'm と不一致');
    }
    // 外周は必ず solid（場外へ抜けられない）
    for (var c = 0; c < this.width; c++) {
      if (!this.isSolid(c, 0) || !this.isSolid(c, this.height - 1)) {
        errs.push('外周が開いている (col ' + c + ')');
      }
    }
    for (var r = 0; r < this.height; r++) {
      if (!this.isSolid(0, r) || !this.isSolid(this.width - 1, r)) {
        errs.push('外周が開いている (row ' + r + ')');
      }
    }
    // meta 参照整合
    var sp = this.meta.spawn;
    if (!sp) {
      errs.push('meta.spawn が未定義');
    } else if (!this.isWalkable(sp.col, sp.row)) {
      errs.push('spawn (' + sp.col + ',' + sp.row + ') が歩行不可マス');
    }
    // 床高さの連続性（段差＝落下になるので許さない）
    var seams = this.heightSeams();
    if (seams.length) {
      errs.push('床高さが不連続 ' + seams.length + '箇所: ' + seams.slice(0, 4).join(' / '));
    }
    var refLists = ['notes', 'gimmicks', 'cells', 'checkpoints', 'patrol'];
    for (var i = 0; i < refLists.length; i++) {
      var list = this.meta[refLists[i]];
      if (!list) continue;
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (!this.inBounds(e.col, e.row)) {
          errs.push('meta.' + refLists[i] + '[' + j + '] が場外 (' + e.col + ',' + e.row + ')');
        }
      }
    }
    return errs;
  };

  /* ---------------------------------------------------------------- */

  var registry = Object.create(null);

  ESCAPE.TILE = TILE;
  ESCAPE.TILE_DEFS = TILE_DEFS;
  ESCAPE.TILE_SIZE = TILE_SIZE;
  ESCAPE.WALL_HEIGHT = WALL_HEIGHT;
  ESCAPE.GridMap = GridMap;
  ESCAPE.Maps = {
    register: function (def) { registry[def.id] = def; return def; },
    has: function (id) { return !!registry[id]; },
    ids: function () { return Object.keys(registry); },
    /** 定義からGridMapを構築（毎回新規＝リセットで元データを汚さない） */
    load: function (id) {
      var def = registry[id];
      if (!def) throw new Error('map not found: ' + id);
      return new GridMap(def);
    }
  };
})(window);
