#!/usr/bin/env node
/* ESCAPE — エリア2 下水道 構造モックの統計ツール（P5a）
 *
 * 使い方:
 *   node audit/map-mocks-a2/stats.js audit/map-mocks-a2/mockA.js          … 人が読む表
 *   node audit/map-mocks-a2/stats.js audit/map-mocks-a2/mockA.js --json   … JSON
 *   node audit/map-mocks-a2/stats.js audit/map-mocks-a2/mock*.js          … 複数まとめて
 *
 * npm 不要（Node 標準の fs / vm だけ）。モックは `(function(global){...})(window)` の
 * IIFE なので、window.ESCAPE.Maps.register を偽装した vm コンテキストで読み込む。
 * 後工程（P5b-A の area2.js）でも同じ数値を取れるよう、js/map.js の floorYAt / heightSeams と
 * 同じ規則をこのファイル内に再実装してある（ブラウザを使わないため）。
 */
'use strict';

var fs = require('fs');
var vm = require('vm');

/* 歩行可能な文字（legend で walkable:true になるもの）。
 * '.' 床 / 'W' 水路(NOISE) / 'X' 到達パッド(EXIT)
 * 壁扱い: '#' 壁 / 'F' 岩盤・崩落・什器 / 'V' 深水 / 'D' 水門(DOOR) / 'G' ハンドル置き場 / 'P' セーブ端末 */
var WALK = { '.': 1, 'W': 1, 'X': 1, 'B': 1, 'M': 1, 'S': 1 };  /* B 板・M 音地盤・S センサーも歩行可（area2.js 用） */
var SIGHT_LIMIT = 12;      /* 直線見通しの原則上限 */
var LANDMARK_LIMIT = 20;   /* ランドマーク幹線で許す最長 */
var ALT_SLACK = 1.30;      /* 別解と認める最短比 */

/* ---------------- 読み込み ---------------- */

function loadMock(file) {
  var src = fs.readFileSync(file, 'utf8');
  var defs = [];
  var win = { ESCAPE: { Maps: { register: function (d) { defs.push(d); return d; } } } };
  vm.runInNewContext(src, { window: win, console: console });
  if (!defs.length) throw new Error('register されなかった: ' + file);
  return defs[0];
}

/* ---------------- グリッド ---------------- */

function Grid(def) {
  this.def = def;
  this.rows = def.rows;
  this.h = this.rows.length;
  this.w = this.h ? this.rows[0].length : 0;
  this.meta = def.meta || {};
  this.cells = new Array(this.w * this.h);
  for (var r = 0; r < this.h; r++) {
    for (var c = 0; c < this.w; c++) this.cells[r * this.w + c] = this.rows[r].charAt(c);
  }
}
Grid.prototype.at = function (c, r) {
  if (c < 0 || r < 0 || c >= this.w || r >= this.h) return '#';
  return this.cells[r * this.w + c];
};
Grid.prototype.walk = function (c, r) { return !!WALK[this.at(c, r)]; };
Grid.prototype.key = function (c, r) { return r * this.w + c; };

var D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* ---------------- 経路 ---------------- */

function bfs(g, sc, sr, blockedEdge) {
  var n = g.w * g.h, dist = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1);
  if (!g.walk(sc, sr)) return { dist: dist, prev: prev };
  var q = [g.key(sc, sr)], head = 0;
  dist[q[0]] = 0;
  while (head < q.length) {
    var cur = q[head++], c = cur % g.w, r = (cur - c) / g.w;
    for (var i = 0; i < 4; i++) {
      var nc = c + D4[i][0], nr = r + D4[i][1];
      if (!g.walk(nc, nr)) continue;
      var k = g.key(nc, nr);
      if (dist[k] !== -1) continue;
      if (blockedEdge && (blockedEdge[cur + ':' + k] || blockedEdge[k + ':' + cur])) continue;
      dist[k] = dist[cur] + 1; prev[k] = cur; q.push(k);
    }
  }
  return { dist: dist, prev: prev };
}

function pathOf(res, k) {
  var out = [];
  while (k !== -1) { out.push(k); k = res.prev[k]; }
  return out.reverse();
}

/* 壁マス（ハンドル・水門など）に隣接する歩行可能マス */
function adjWalk(g, e) {
  var out = [];
  if (!e) return out;
  for (var i = 0; i < 4; i++) {
    var nc = e.col + D4[i][0], nr = e.row + D4[i][1];
    if (g.walk(nc, nr)) out.push({ col: nc, row: nr });
  }
  return out;
}

/* ---------------- 床高さ（js/map.js と同じ規則） ---------------- */

function floorYAt(meta, T, x, z) {
  var c = Math.floor(x / T), r = Math.floor(z / T);
  var rs = meta.ramps || [];
  for (var i = 0; i < rs.length; i++) {
    var a = rs[i];
    if (c < a.c0 || c > a.c1 || r < a.r0 || r > a.r1) continue;
    var t = (a.axis === 'x') ? (x - a.c0 * T) / ((a.c1 - a.c0 + 1) * T)
                             : (z - a.r0 * T) / ((a.r1 - a.r0 + 1) * T);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return a.y0 + (a.y1 - a.y0) * t;
  }
  var ps = meta.plateaus || [];
  for (var j = 0; j < ps.length; j++) {
    var b = ps[j];
    if (c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1) return b.y;
  }
  return 0;
}

function heightSeams(g) {
  var T = g.def.tileSize || 2.0, meta = g.meta, bad = [];
  var DD = [[1, 0], [0, 1]];
  for (var r = 0; r < g.h; r++) {
    for (var c = 0; c < g.w; c++) {
      if (!g.walk(c, r)) continue;
      for (var d = 0; d < 2; d++) {
        var nc = c + DD[d][0], nr = r + DD[d][1];
        if (!g.walk(nc, nr)) continue;
        for (var k = 0; k < 3; k++) {
          var f = 0.02 + k * 0.48, diff;
          if (DD[d][0]) {
            var x = (c + 1) * T, z = (r + f) * T;
            diff = Math.abs(floorYAt(meta, T, x - 1e-4, z) - floorYAt(meta, T, x + 1e-4, z));
          } else {
            var x2 = (c + f) * T, z2 = (r + 1) * T;
            diff = Math.abs(floorYAt(meta, T, x2, z2 - 1e-4) - floorYAt(meta, T, x2, z2 + 1e-4));
          }
          if (diff > 0.01) { bad.push(c + ',' + r + '->' + nc + ',' + nr + ' d' + diff.toFixed(2)); k = 3; }
        }
      }
    }
  }
  return bad;
}

/* ---------------- 統計本体 ---------------- */

function inRect(rc, c, r) { return c >= rc.c0 && c <= rc.c1 && r >= rc.r0 && r <= rc.r1; }

function computeStats(def) {
  var g = new Grid(def), meta = g.meta, S = {};
  S.id = def.id; S.name = def.name;
  S.width = g.w; S.height = g.h;

  /* --- マス数 --- */
  var counts = {}, walkCells = [];
  for (var r = 0; r < g.h; r++) {
    for (var c = 0; c < g.w; c++) {
      var ch = g.at(c, r);
      counts[ch] = (counts[ch] || 0) + 1;
      if (WALK[ch]) walkCells.push([c, r]);
    }
  }
  S.charCounts = counts;
  S.walkable = walkCells.length;
  S.waterW = counts['W'] || 0;
  S.waterRatio = +(S.waterW / S.walkable * 100).toFixed(1);
  S.deepV = counts['V'] || 0;

  /* --- 次数（分岐・行き止まり） --- */
  var junctions = 0, deadEnds = [], deg = new Int8Array(g.w * g.h);
  for (var i = 0; i < walkCells.length; i++) {
    var cc = walkCells[i][0], rr = walkCells[i][1], d = 0;
    for (var k = 0; k < 4; k++) if (g.walk(cc + D4[k][0], rr + D4[k][1])) d++;
    deg[g.key(cc, rr)] = d;
    if (d >= 3) junctions++;
    if (d === 1) deadEnds.push({ col: cc, row: rr });
  }
  S.junctions = junctions;
  S.deadEnds = deadEnds.length;
  S.deadEndList = deadEnds;

  /* --- 直線見通し --- */
  var landmarks = meta.landmarks || [];
  function inLandmark(c0, r0, c1, r1) {
    for (var li = 0; li < landmarks.length; li++) {
      var L = landmarks[li];
      if (inRect(L, c0, r0) && inRect(L, c1, r1)) return L.id || L.name || ('lm' + li);
    }
    return null;
  }
  var runs = [], hist = {};
  function scanRun(cells) {
    var run = [];
    function flush() {
      if (run.length) {
        hist[run.length] = (hist[run.length] || 0) + 1;
        if (run.length > SIGHT_LIMIT) {
          var a = run[0], b = run[run.length - 1];
          runs.push({ len: run.length, c0: a[0], r0: a[1], c1: b[0], r1: b[1], landmark: inLandmark(a[0], a[1], b[0], b[1]) });
        }
      }
      run = [];
    }
    for (var i = 0; i < cells.length; i++) {
      if (g.walk(cells[i][0], cells[i][1])) run.push(cells[i]); else flush();
    }
    flush();
  }
  for (var rr2 = 0; rr2 < g.h; rr2++) {
    var line = []; for (var c2 = 0; c2 < g.w; c2++) line.push([c2, rr2]); scanRun(line);
  }
  for (var cc2 = 0; cc2 < g.w; cc2++) {
    var col = []; for (var r3 = 0; r3 < g.h; r3++) col.push([cc2, r3]); scanRun(col);
  }
  var maxRun = 0; Object.keys(hist).forEach(function (k) { if (+k > maxRun) maxRun = +k; });
  S.sightMax = maxRun;
  S.sightHist = hist;
  S.sightOver12 = runs.sort(function (a, b) { return b.len - a.len; });
  S.sightOver12NonLandmark = runs.filter(function (x) { return !x.landmark; }).length;
  S.sightLandmarkMax = runs.reduce(function (m, x) { return x.landmark ? Math.max(m, x.len) : m; }, 0);

  /* --- 到達性 --- */
  var sp = meta.spawn, ex = meta.exitPad;
  var res = bfs(g, sp.col, sp.row);
  var unreached = 0, unreachedSample = [];
  for (var wi = 0; wi < walkCells.length; wi++) {
    if (res.dist[g.key(walkCells[wi][0], walkCells[wi][1])] === -1) {
      unreached++; if (unreachedSample.length < 8) unreachedSample.push(walkCells[wi].join(','));
    }
  }
  S.unreached = unreached; S.unreachedSample = unreachedSample;

  var exK = g.key(ex.col, ex.row);
  S.shortest = res.dist[exK];

  /* --- ハンドル経由の必須往復 --- */
  var safeAdj = adjWalk(g, meta.keySafe);
  var best = Infinity, bestVia = null;
  var exRes = bfs(g, ex.col, ex.row);
  for (var si = 0; si < safeAdj.length; si++) {
    var k2 = g.key(safeAdj[si].col, safeAdj[si].row);
    if (res.dist[k2] < 0 || exRes.dist[k2] < 0) continue;
    var tot = res.dist[k2] + exRes.dist[k2];
    if (tot < best) { best = tot; bestVia = safeAdj[si]; }
  }
  S.viaHandle = (best === Infinity) ? -1 : best;
  S.viaHandleVia = bestVia;
  S.viaRatio = (S.shortest > 0 && best !== Infinity) ? +(best / S.shortest).toFixed(3) : -1;
  S.spawnToHandle = bestVia ? res.dist[g.key(bestVia.col, bestVia.row)] : -1;

  /* --- 別解成立率（最短経路の各辺を1本ずつ塞ぐ） --- */
  var path = pathOf(res, exK);
  var okAlt = 0, total = 0, worstEdges = [];
  for (var pi = 0; pi + 1 < path.length; pi++) {
    var a1 = path[pi], b1 = path[pi + 1], blk = {};
    blk[a1 + ':' + b1] = 1;
    var r2 = bfs(g, sp.col, sp.row, blk);
    var d2 = r2.dist[exK];
    total++;
    if (d2 >= 0 && d2 <= S.shortest * ALT_SLACK) okAlt++;
    else {
      var ac = a1 % g.w, ar = (a1 - ac) / g.w;
      worstEdges.push({ at: ac + ',' + ar, alt: d2 });
    }
  }
  S.altEdges = total;
  S.altOk = okAlt;
  S.altRate = total ? +(okAlt / total * 100).toFixed(1) : 0;
  S.altFailSample = worstEdges.slice(0, 10);

  /* --- サイクル --- */
  var V = walkCells.length, E = 0;
  for (var ei = 0; ei < walkCells.length; ei++) {
    var ec = walkCells[ei][0], er = walkCells[ei][1];
    if (g.walk(ec + 1, er)) E++;
    if (g.walk(ec, er + 1)) E++;
  }
  /* 連結成分数 */
  var seen = new Uint8Array(g.w * g.h), comps = 0;
  for (var ci = 0; ci < walkCells.length; ci++) {
    var ck = g.key(walkCells[ci][0], walkCells[ci][1]);
    if (seen[ck]) continue;
    comps++;
    var st = [ck]; seen[ck] = 1;
    while (st.length) {
      var cu = st.pop(), cu_c = cu % g.w, cu_r = (cu - cu_c) / g.w;
      for (var di = 0; di < 4; di++) {
        var xc = cu_c + D4[di][0], xr = cu_r + D4[di][1];
        if (!g.walk(xc, xr)) continue;
        var xk = g.key(xc, xr);
        if (!seen[xk]) { seen[xk] = 1; st.push(xk); }
      }
    }
  }
  S.edges = E; S.components = comps;
  S.cycles = E - V + comps;

  /* --- 最大周回路の周長（BFS木の基本サイクルの最大長＝概算） --- */
  var depth = res.dist, parent = res.prev, maxCycle = 0;
  for (var mi = 0; mi < walkCells.length; mi++) {
    var mc = walkCells[mi][0], mr = walkCells[mi][1], mk = g.key(mc, mr);
    if (depth[mk] < 0) continue;
    var nbr = [[mc + 1, mr], [mc, mr + 1]];
    for (var ni = 0; ni < 2; ni++) {
      var nc2 = nbr[ni][0], nr2 = nbr[ni][1];
      if (!g.walk(nc2, nr2)) continue;
      var nk = g.key(nc2, nr2);
      if (depth[nk] < 0) continue;
      if (parent[nk] === mk || parent[mk] === nk) continue; /* 木の辺 */
      /* LCA まで登る */
      var u = mk, v = nk, du = depth[u], dv = depth[v], up = 0, vp = 0;
      while (du > dv) { u = parent[u]; du--; up++; }
      while (dv > du) { v = parent[v]; dv--; vp++; }
      var guard = 0;
      while (u !== v && u !== -1 && v !== -1 && guard++ < 10000) { u = parent[u]; v = parent[v]; up++; vp++; }
      var len = up + vp + 1;
      if (len > maxCycle) maxCycle = len;
    }
  }
  S.maxCycle = maxCycle;

  /* --- 段差 --- */
  var seams = heightSeams(g);
  S.seams = seams.length;
  S.seamSample = seams.slice(0, 6);
  S.ramps = (meta.ramps || []).length;
  S.plateaus = (meta.plateaus || []).length;
  S.basinY = (meta.plateaus || []).reduce(function (m, p) { return Math.min(m, p.y); }, 0);

  /* --- 区画（zone）被覆 --- */
  var regions = meta.regions || [];
  var zoneCount = {}, noZone = 0, noZoneSample = [];
  for (var zi = 0; zi < walkCells.length; zi++) {
    var zc = walkCells[zi][0], zr = walkCells[zi][1], z = null;
    for (var ri = 0; ri < regions.length; ri++) {
      if (inRect(regions[ri], zc, zr)) { z = regions[ri].zone; break; }
    }
    if (!z) { noZone++; if (noZoneSample.length < 8) noZoneSample.push(zc + ',' + zr); }
    else zoneCount[z] = (zoneCount[z] || 0) + 1;
  }
  S.noZone = noZone; S.noZoneSample = noZoneSample;
  S.zoneCount = zoneCount;
  S.regions = regions.length;

  /* --- 深水 V の島（向こう岸が見えるか） --- */
  var vseen = {}, vclusters = [];
  for (var vr = 0; vr < g.h; vr++) {
    for (var vc = 0; vc < g.w; vc++) {
      if (g.at(vc, vr) !== 'V' || vseen[vc + ',' + vr]) continue;
      var stack = [[vc, vr]], cells = [];
      vseen[vc + ',' + vr] = 1;
      while (stack.length) {
        var cu2 = stack.pop(); cells.push(cu2);
        for (var vd = 0; vd < 4; vd++) {
          var xc2 = cu2[0] + D4[vd][0], xr2 = cu2[1] + D4[vd][1];
          if (g.at(xc2, xr2) === 'V' && !vseen[xc2 + ',' + xr2]) { vseen[xc2 + ',' + xr2] = 1; stack.push([xc2, xr2]); }
        }
      }
      /* 対岸判定: クラスタの左右または上下の両側に歩行可能マスが接するか */
      var sides = { left: 0, right: 0, up: 0, down: 0 };
      for (var q2 = 0; q2 < cells.length; q2++) {
        if (g.walk(cells[q2][0] - 1, cells[q2][1])) sides.left++;
        if (g.walk(cells[q2][0] + 1, cells[q2][1])) sides.right++;
        if (g.walk(cells[q2][0], cells[q2][1] - 1)) sides.up++;
        if (g.walk(cells[q2][0], cells[q2][1] + 1)) sides.down++;
      }
      var facing = (sides.left > 0 && sides.right > 0) || (sides.up > 0 && sides.down > 0);
      vclusters.push({ size: cells.length, at: cells[0][0] + ',' + cells[0][1], facing: facing });
    }
  }
  S.vClusters = vclusters.length;
  S.vFacing = vclusters.filter(function (x) { return x.facing; }).length;
  S.vClusterList = vclusters;

  /* --- 契約チェック --- */
  var chk = S.checks = {};
  chk.size = (g.w >= 70 && g.w <= 80 && g.h >= 70 && g.h <= 80);
  chk.walkable = S.walkable >= 1500;
  chk.junctions = S.junctions >= 35;
  chk.deadEnds = S.deadEnds >= 12 && S.deadEnds <= 40;
  chk.sight = (S.sightOver12NonLandmark === 0) && (S.sightMax <= LANDMARK_LIMIT) && (landmarks.length >= 2 && landmarks.length <= 3);
  chk.shortest = S.shortest >= 220 && S.shortest <= 320;
  chk.viaRatio = S.viaRatio >= 1.35 && S.viaRatio <= 1.60;
  chk.altRate = S.altRate >= 90;
  chk.cycles = S.cycles >= 200;
  chk.ramps = S.ramps >= 3 && S.basinY <= -2.0 + 1e-9;
  chk.seams = S.seams === 0;
  chk.unreached = S.unreached === 0;
  chk.zone = S.noZone === 0;
  chk.water = S.waterRatio >= 8 && S.waterRatio <= 15;
  chk.deep = S.vFacing >= 4;
  S.allPass = Object.keys(chk).every(function (k) { return chk[k]; });
  return S;
}

/* ---------------- 出力 ---------------- */

function fmt(S) {
  var L = [];
  var mark = function (b) { return b ? 'OK ' : 'NG '; };
  L.push('== ' + S.id + ' / ' + S.name + ' ==');
  L.push(mark(S.checks.size) + '幅高さ           : ' + S.width + ' x ' + S.height + '  (70-80)');
  L.push(mark(S.checks.walkable) + '歩行可能         : ' + S.walkable + '  (>=1500)   壁 ' + (S.charCounts['#'] || 0) + ' / 岩盤F ' + (S.charCounts['F'] || 0));
  L.push(mark(S.checks.water) + '水路W            : ' + S.waterW + ' (' + S.waterRatio + '%)  (8-15%)');
  L.push(mark(S.checks.deep) + '深水V            : ' + S.deepV + 'マス / 島 ' + S.vClusters + ' / 対岸が見える島 ' + S.vFacing + '  (>=4)');
  L.push(mark(S.checks.junctions) + '三叉路以上       : ' + S.junctions + '  (>=35)');
  L.push(mark(S.checks.deadEnds) + '行き止まり       : ' + S.deadEnds + '  (12-40)');
  L.push(mark(S.checks.sight) + '直線見通し       : 最大 ' + S.sightMax + ' / 12超でランドマーク外 ' + S.sightOver12NonLandmark + ' / ランドマーク最長 ' + S.sightLandmarkMax);
  L.push(mark(S.checks.shortest) + 'spawn→exit 最短  : ' + S.shortest + '  (220-320)');
  L.push(mark(S.checks.viaRatio) + 'ハンドル往復     : ' + S.viaHandle + '  = 最短 x ' + S.viaRatio + '  (1.35-1.60)   spawn→ハンドル ' + S.spawnToHandle);
  L.push(mark(S.checks.altRate) + '別解成立率       : ' + S.altRate + '%  (' + S.altOk + '/' + S.altEdges + ', +30%以内)  (>=90%)');
  L.push(mark(S.checks.cycles) + '独立サイクル数   : ' + S.cycles + '  (>=200)   最大周回路 ' + S.maxCycle + ' マス');
  L.push(mark(S.checks.ramps) + 'ランプ/台地      : ランプ ' + S.ramps + ' 本 / 台地 ' + S.plateaus + ' 枚 / 最低床 ' + S.basinY.toFixed(1) + 'm');
  L.push(mark(S.checks.seams) + '段差の継ぎ目     : ' + S.seams + '  (0)' + (S.seams ? ' 例: ' + S.seamSample.join(' ') : ''));
  L.push(mark(S.checks.unreached) + '未到達マス       : ' + S.unreached + '  (0)' + (S.unreached ? ' 例: ' + S.unreachedSample.join(' ') : ''));
  L.push(mark(S.checks.zone) + '区画未被覆       : ' + S.noZone + '  (0)  region ' + S.regions + ' 枚');
  var zk = Object.keys(S.zoneCount).sort();
  L.push('   区画別マス数     : ' + zk.map(function (k) { return k + ' ' + S.zoneCount[k]; }).join(' / '));
  if (S.sightOver12.length) {
    L.push('   12超の区間       : ' + S.sightOver12.map(function (x) {
      return x.len + '(' + x.c0 + ',' + x.r0 + '-' + x.c1 + ',' + x.r1 + (x.landmark ? ':' + x.landmark : ':**') + ')';
    }).join(' '));
  }
  L.push((S.allPass ? '>>> 全項目合格' : '>>> 未達あり: ' + Object.keys(S.checks).filter(function (k) { return !S.checks[k]; }).join(',')));
  return L.join('\n');
}

if (require.main === module) {
  var args = process.argv.slice(2);
  var json = args.indexOf('--json') >= 0;
  var files = args.filter(function (a) { return a !== '--json'; });
  if (!files.length) {
    console.error('usage: node stats.js <mock.js> [...] [--json]');
    process.exit(1);
  }
  var out = [];
  files.forEach(function (f) {
    var S = computeStats(loadMock(f));
    S.file = f;
    out.push(S);
    if (!json) console.log(fmt(S) + '\n');
  });
  if (json) console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
}

module.exports = { loadMock: loadMock, computeStats: computeStats, fmt: fmt, Grid: Grid, WALK: WALK };
