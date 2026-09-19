/* ESCAPE — エリア2「下水道」の機械テスト（DESIGN.md §4「P5」の「機械テスト（P5b-A・段階2）」）
 *
 * runAll は **area1 のページ**で走るので、ここは `ESCAPE.Maps.load('area2')` で素の定義を
 * 取り出してデータ検査を行う（ライブの game には触らない）。挙動のうち area1 のページでも
 * 確かめられるもの（エリア切替の決定関数・保存キーの分離・敵0体の分岐・水路の速度）は、
 * 純関数と使い捨ての Player で検査する。
 *
 * 契約 §6「runAll の実行後は製品初期状態へ完全復帰」: localStorage（escape.area を含む）は
 * このスイートの入口で控えて出口で必ず戻す。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];

  var D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var FACE = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

  function bfs(map, sc, sr, blockKey) {
    var W = map.width, H = map.height;
    var d = new Int32Array(W * H);
    for (var i = 0; i < d.length; i++) d[i] = -1;
    if (!map.isWalkable(sc, sr)) return d;
    d[sr * W + sc] = 0;
    var q = [sr * W + sc], head = 0;
    while (head < q.length) {
      var cur = q[head++], c = cur % W, r = (cur - c) / W;
      for (var k = 0; k < 4; k++) {
        var nc = c + D4[k][0], nr = r + D4[k][1];
        if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
        if (!map.isWalkable(nc, nr)) continue;
        var nk = nr * W + nc;
        if (d[nk] >= 0) continue;
        if (blockKey && (blockKey[cur + ':' + nk] || blockKey[nk + ':' + cur])) continue;
        d[nk] = d[cur] + 1;
        q.push(nk);
      }
    }
    return d;
  }
  function pathBack(map, d, c, r) {
    var W = map.width, out = [], k = r * W + c;
    if (d[k] < 0) return out;
    while (d[k] > 0) {
      out.push(k);
      var cc = k % W, rr = (k - cc) / W, best = -1;
      for (var i = 0; i < 4; i++) {
        var nc = cc + D4[i][0], nr = rr + D4[i][1];
        if (nc < 0 || nr < 0 || nc >= map.width || nr >= map.height) continue;
        var nk = nr * W + nc;
        if (d[nk] === d[k] - 1) { best = nk; break; }
      }
      if (best < 0) break;
      k = best;
    }
    out.push(k);
    return out.reverse();
  }
  function degOf(map, c, r) {
    var n = 0;
    for (var i = 0; i < 4; i++) if (map.isWalkable(c + D4[i][0], r + D4[i][1])) n++;
    return n;
  }
  function inBox(b, c, r) { return c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1; }

  /* ================================================================
   * 1) 構造（契約の数値一覧）
   * ============================================================== */
  function testA2Structure(t, g) {
    if (!t.ok(ESCAPE.Maps.has('area2'), 'P5 area2: マップが登録されている')) return;
    var map = ESCAPE.Maps.load('area2');
    var meta = map.meta;
    t.ok(map.validate().length === 0, 'P5 area2: 静的検証（外周・参照・段差）', map.validate().join(' / '));
    t.ok(map.width >= 70 && map.height >= 70, 'P5 area2: 70x70 以上', map.width + 'x' + map.height);

    var cells = map.walkableCells();
    t.ok(cells.length >= 1500, 'P5 area2: 歩行可能 1500 マス以上', cells.length);

    var junctions = 0, dead = 0, i, c;
    for (i = 0; i < cells.length; i++) {
      var n = degOf(map, cells[i].col, cells[i].row);
      if (n >= 3) junctions++;
      if (n === 1) dead++;
    }
    t.ok(junctions >= 35, 'P5 area2: 三叉路以上の分岐 35 箇所以上', junctions);
    t.ok(dead >= 12 && dead <= 40, 'P5 area2: 行き止まり 12〜40', dead);

    /* 直線見通し: 12 マス超はランドマーク幹線の中だけ・最長 20 */
    var lms = meta.landmarks || [];
    var maxRun = 0, outside = 0;
    function run(c0, r0, dc, dr) {
      var len = 0, cc = c0, rr = r0;
      while (map.isWalkable(cc, rr)) { len++; cc += dc; rr += dr; }
      return len;
    }
    for (var r = 0; r < map.height; r++) {
      for (c = 0; c < map.width; c++) {
        if (!map.isWalkable(c, r)) continue;
        var starts = [];
        if (!map.isWalkable(c - 1, r)) starts.push([1, 0]);
        if (!map.isWalkable(c, r - 1)) starts.push([0, 1]);
        for (var s = 0; s < starts.length; s++) {
          var L = run(c, r, starts[s][0], starts[s][1]);
          if (L <= 12) continue;
          if (L > maxRun) maxRun = L;
          var ec = c + starts[s][0] * (L - 1), er = r + starts[s][1] * (L - 1);
          var ok = false;
          for (var q = 0; q < lms.length; q++) {
            if (inBox(lms[q], c, r) && inBox(lms[q], ec, er)) { ok = true; break; }
          }
          if (!ok) outside++;
        }
      }
    }
    t.ok(outside === 0, 'P5 area2: 12マス超の直線はランドマーク幹線だけ', outside + '本が外');
    t.ok(maxRun <= 20, 'P5 area2: ランドマーク幹線の最長は20マス以下', maxRun);

    /* 到達性・スタート→出口・ハンドル経由の往復 */
    var sp = meta.spawn, ep = meta.exitPad;
    var dS = bfs(map, sp.col, sp.row);
    var unreached = 0;
    for (i = 0; i < cells.length; i++) if (dS[cells[i].row * map.width + cells[i].col] < 0) unreached++;
    t.ok(unreached === 0, 'P5 area2: 未到達マス 0（深水Vが到達性を壊していない）', unreached);
    var dExit = dS[ep.row * map.width + ep.col];
    t.ok(dExit >= 220 && dExit <= 320, 'P5 area2: スタート→出口 最短 220〜320 マス', dExit);

    /* ハンドル（keySafe＝壁マス）の前に立つマス */
    var ks = meta.keySafe, kAdj = null;
    for (i = 0; i < 4; i++) {
      var kc = ks.col + D4[i][0], kr = ks.row + D4[i][1];
      if (map.isWalkable(kc, kr)) { kAdj = { col: kc, row: kr }; break; }
    }
    if (t.ok(!!kAdj, 'P5 area2: ハンドル置き場に隣接する歩行可能マスがある')) {
      var dKey = dS[kAdj.row * map.width + kAdj.col];
      var dK = bfs(map, kAdj.col, kAdj.row);
      var total = dKey + dK[ep.row * map.width + ep.col];
      var ratio = total / dExit;
      t.ok(ratio >= 1.35 && ratio <= 1.60,
        'P5 area2: ハンドル経由の必須往復が最短の 1.35〜1.60 倍', total + ' / ' + ratio.toFixed(3));
      t.ok(dKey > dExit * 0.8, 'P5 area2: ハンドルは最短経路から外れた奥にある', dKey);
    }

    /* ループ: 独立サイクル数 */
    var W = map.width, edges = 0;
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      if (map.isWalkable(c.col + 1, c.row)) edges++;
      if (map.isWalkable(c.col, c.row + 1)) edges++;
    }
    var cycles = edges - cells.length + 1;
    t.ok(cycles >= 200, 'P5 area2: 独立サイクル数 200 以上（逃げ道のループ）', cycles);

    /* 別解成立率: 最短経路の辺を1本ずつ塞いで +30% 以内の迂回が残る割合 */
    var path = pathBack(map, dS, ep.col, ep.row);
    var okAlt = 0, tried = 0;
    for (i = 0; i + 1 < path.length; i++) {
      var blk = Object.create(null);
      blk[path[i] + ':' + path[i + 1]] = true;
      var d2 = bfs(map, sp.col, sp.row, blk);
      var nd = d2[ep.row * W + ep.col];
      tried++;
      if (nd >= 0 && nd <= dExit * 1.30) okAlt++;
    }
    var rate = tried ? okAlt / tried : 0;
    t.ok(rate >= 0.90, 'P5 area2: 別解成立率 90% 以上（+30%以内の迂回）',
      (rate * 100).toFixed(1) + '% (' + okAlt + '/' + tried + ')');

    /* 段差の継ぎ目 */
    t.ok(map.heightSeams().length === 0, 'P5 area2: 段差の継ぎ目 0', map.heightSeams().join(' / '));
    t.ok((meta.ramps || []).length >= 3, 'P5 area2: ランプ 3 本以上', (meta.ramps || []).length);
    var lowest = 0;
    for (i = 0; i < (meta.plateaus || []).length; i++) lowest = Math.min(lowest, meta.plateaus[i].y);
    t.ok(lowest <= -2.0, 'P5 area2: ポンプ室は -2m の窪地', lowest);
  }

  /* ================================================================
   * 2) 深水 V（TILE.DEEP）と水路 W（TILE.WATER）
   * ============================================================== */
  function testA2Tiles(t, g) {
    var TILE = ESCAPE.TILE, DEFS = ESCAPE.TILE_DEFS;
    t.ok(TILE.WATER !== undefined && TILE.DEEP !== undefined, 'P5 タイル: WATER / DEEP が定義されている');
    t.ok(DEFS[TILE.WATER].walkable === true && DEFS[TILE.WATER].solid === false,
      'P5 タイル: WATER は歩行可');
    t.ok(DEFS[TILE.DEEP].solid === true && DEFS[TILE.DEEP].walkable === false,
      'P5 タイル: DEEP は solid（渡れない）');
    /* 既存タイルの番号が動いていない（セーブ・既存テストの前提） */
    t.ok(TILE.VOID === 0 && TILE.FLOOR === 1 && TILE.WALL === 2 && TILE.DOOR === 3 &&
      TILE.NOISE === 4 && TILE.LOCKER === 5 && TILE.BOARD === 6 && TILE.NOTE === 7 &&
      TILE.GIMMICK === 8 && TILE.CHECKPOINT === 9 && TILE.CELL === 10 &&
      TILE.SENSOR === 11 && TILE.EXIT === 12, 'P5 タイル: 既存タイルの番号が不変');

    if (!ESCAPE.Maps.has('area2')) return;
    var map = ESCAPE.Maps.load('area2');
    var water = 0, deep = 0;
    for (var r = 0; r < map.height; r++) {
      for (var c = 0; c < map.width; c++) {
        var tl = map.tileAt(c, r);
        if (tl === TILE.WATER) water++;
        else if (tl === TILE.DEEP) deep++;
      }
    }
    t.ok(water > 0, 'P5 area2: 水路マスがある', water);
    t.ok(deep > 0, 'P5 area2: 深水マスがある', deep);
    var walk = map.walkableCells().length;
    var ratio = water / walk;
    t.ok(ratio >= 0.08 && ratio <= 0.15, 'P5 area2: 水路は歩行可能マスの 8〜15%',
      water + ' / ' + walk + ' = ' + (ratio * 100).toFixed(1) + '%');
    /* 深水は必ず solid として扱われる */
    var bad = 0;
    for (r = 0; r < map.height; r++) {
      for (c = 0; c < map.width; c++) {
        if (map.tileAt(c, r) !== TILE.DEEP) continue;
        if (!map.isSolid(c, r) || map.isWalkable(c, r)) bad++;
      }
    }
    t.ok(bad === 0, 'P5 area2: 深水マスは全て solid かつ歩行不可', bad);
  }

  /* ================================================================
   * 3) 配置物の参照整合と密度
   * ============================================================== */
  function testA2Placement(t, g) {
    if (!ESCAPE.Maps.has('area2')) return;
    var map = ESCAPE.Maps.load('area2'), meta = map.meta, TILE = ESCAPE.TILE;
    var i, e, bad;

    function faceWalkable(x) {
      var v = FACE[x.dir] || FACE.n;
      return map.isWalkable(x.col + v[0], x.row + v[1]);
    }

    /* 壁メモ（正文の6枚＋日誌2枚） */
    var notes = meta.notes || [];
    bad = 0;
    for (i = 0; i < notes.length; i++) {
      if (map.tileAt(notes[i].col, notes[i].row) !== TILE.NOTE) bad++;
      else if (!faceWalkable(notes[i])) bad++;
    }
    t.ok(bad === 0, 'P5 area2: 壁メモは全て NOTE タイル＋読む側が歩行可能', bad);
    var wallNotes = 0;
    for (i = 0; i < notes.length; i++) if (/^a2_n[1-6]$/.test(notes[i].id)) wallNotes++;
    t.ok(wallNotes === 6, 'P5 area2: 壁メモ a2_n1〜a2_n6 の6枚', wallNotes);

    /* メモ id が全て本文表を持つ（正文） */
    var TX = (ESCAPE.PROGRESS_NOTE_TEXTS_BY_MAP && ESCAPE.PROGRESS_NOTE_TEXTS_BY_MAP.area2) || {};
    bad = [];
    for (i = 0; i < notes.length; i++) if (!TX[notes[i].id]) bad.push(notes[i].id);
    t.ok(bad.length === 0, 'P5 area2: 全てのメモ id に正文の本文がある', bad.join(','));
    t.ok(!!TX.a2_diary1 && !!TX.a2_diary2 && TX.a2_diary1.title === '作業員の日誌' &&
      TX.a2_diary2.title === '作業員の日誌', 'P5 area2: 作業員の日誌2枚の表示タイトルが正文');

    /* 仕掛け（ハンドル＝safe / 操作盤＝bulkhead） */
    var gm = meta.gimmicks || [];
    var safe = null, bulk = null;
    for (i = 0; i < gm.length; i++) {
      if (gm[i].role === 'safe') safe = gm[i];
      if (gm[i].role === 'bulkhead') bulk = gm[i];
    }
    t.ok(!!safe && !!bulk, 'P5 area2: 仕掛けは safe（ハンドル）と bulkhead（操作盤）の2つ');
    if (safe) {
      t.ok(map.tileAt(safe.col, safe.row) === TILE.GIMMICK, 'P5 area2: ハンドル置き場は GIMMICK タイル');
      t.ok(meta.keySafe.col === safe.col && meta.keySafe.row === safe.row,
        'P5 area2: meta.keySafe と role safe が同じマス');
    }
    if (bulk) {
      t.ok(map.tileAt(bulk.col, bulk.row) === TILE.GIMMICK, 'P5 area2: 操作盤は GIMMICK タイル');
      t.ok(!(bulk.col === meta.door.col && bulk.row === meta.door.row),
        'P5 area2: 操作盤は水門そのものとは別のマス');
      t.ok(faceWalkable(bulk), 'P5 area2: 操作盤の前に立てる');
    }
    t.ok(map.isSolid(meta.door.col, meta.door.row), 'P5 area2: 水門は solid');
    t.ok(map.tileAt(meta.exitPad.col, meta.exitPad.row) === TILE.EXIT, 'P5 area2: 到達パッドは EXIT タイル');

    /* セーブ端末（立つマス＝歩行可能・dir の先が壁） */
    var cps = meta.checkpoints || [];
    t.ok(cps.length >= 5 && cps.length <= 6, 'P5 area2: セーブ端末 5〜6 基', cps.length);
    bad = 0;
    for (i = 0; i < cps.length; i++) {
      var v = FACE[cps[i].dir] || FACE.n;
      if (!map.isWalkable(cps[i].col, cps[i].row)) bad++;
      else if (!map.isSolid(cps[i].col + v[0], cps[i].row + v[1])) bad++;
    }
    t.ok(bad === 0, 'P5 area2: セーブ端末は歩行可能マス＋壁付き', bad);

    /* ロッカー・板・センサー・音地盤 */
    var lk = meta.lockers || [];
    t.ok(lk.length >= 10, 'P5 area2: ロッカー 10 基以上', lk.length);
    bad = 0;
    for (i = 0; i < lk.length; i++) {
      if (map.tileAt(lk[i].col, lk[i].row) !== TILE.LOCKER) { bad++; continue; }
      var open = 0;
      for (var k = 0; k < 4; k++) if (map.isWalkable(lk[i].col + D4[k][0], lk[i].row + D4[k][1])) open++;
      if (!open) bad++;
    }
    t.ok(bad === 0, 'P5 area2: ロッカーは LOCKER タイル＋通路に面している', bad);

    var bd = meta.boards || [];
    t.ok(bd.length >= 6, 'P5 area2: 倒せる板 6 枚以上', bd.length);
    bad = 0;
    for (i = 0; i < bd.length; i++) if (map.tileAt(bd[i].col, bd[i].row) !== TILE.BOARD) bad++;
    t.ok(bad === 0, 'P5 area2: 板は BOARD タイル', bad);

    var sn = meta.sensors || [];
    t.ok(sn.length >= 12, 'P5 area2: センサー 12 基以上', sn.length);
    bad = 0;
    for (i = 0; i < sn.length; i++) if (map.tileAt(sn[i].col, sn[i].row) !== TILE.SENSOR) bad++;
    t.ok(bad === 0, 'P5 area2: センサーは SENSOR タイル', bad);

    var nz = meta.noise || [];
    bad = 0;
    for (i = 0; i < nz.length; i++) {
      if (map.tileAt(nz[i].col, nz[i].row) !== TILE.NOISE) bad++;
      else if (nz[i].kind !== 'glass' && nz[i].kind !== 'metal') bad++;
    }
    t.ok(nz.length > 0 && bad === 0, 'P5 area2: 音地盤は NOISE タイル＋ガラス/金属', nz.length + ' / ' + bad);

    /* 罠（5種・通路の約1割） */
    var tr = meta.traps || [];
    var kinds = Object.create(null);
    bad = 0;
    for (i = 0; i < tr.length; i++) {
      kinds[tr[i].kind] = (kinds[tr[i].kind] || 0) + 1;
      if (!map.isWalkable(tr[i].col, tr[i].row)) bad++;
      if ((tr[i].kind === 'shelf' || tr[i].kind === 'locker') && !tr[i].dir) bad++;
      if (tr[i].kind === 'wire' && !tr[i].axis) bad++;
    }
    t.ok(bad === 0, 'P5 area2: 罠は全て歩行可能マス＋必要な dir/axis を持つ', bad);
    t.ok(Object.keys(kinds).length >= 5, 'P5 area2: 罠は5種類以上', Object.keys(kinds).join(','));
    /* 通路マス（部屋の外）の密度。判定は js/traps.js の corridorCells と同じ規則 */
    var bands = Object.create(null), bs = meta.bands || [];
    for (i = 0; i < bs.length; i++) bands[bs[i].id] = true;
    var lmIds = Object.create(null), lms = meta.landmarks || [];
    for (i = 0; i < lms.length; i++) lmIds[lms[i].id] = true;
    var rooms = [];
    var rgs = meta.regions || [];
    for (i = 0; i < rgs.length; i++) if (!bands[rgs[i].id] && !lmIds[rgs[i].id]) rooms.push(rgs[i]);
    var cells = map.walkableCells(), corr = 0;
    for (i = 0; i < cells.length; i++) {
      var inR = false;
      for (var rq = 0; rq < rooms.length && !inR; rq++) {
        if (inBox(rooms[rq], cells[i].col, cells[i].row)) inR = true;
      }
      if (!inR) corr++;
    }
    var dens = corr ? tr.length / corr : 0;
    t.ok(dens >= 0.06 && dens <= 0.13, 'P5 area2: 罠の密度が通路マスの約1割（area1 は 0.092）',
      tr.length + ' / ' + corr + ' = ' + dens.toFixed(4));

    /* 闇だまり・漆黒・明滅 */
    t.ok((meta.darkZones || []).length >= 5, 'P5 area2: 闇だまり 5 箇所以上', (meta.darkZones || []).length);
    t.ok((meta.blackZones || []).length >= 2, 'P5 area2: 漆黒区画がある', (meta.blackZones || []).length);
    t.ok((meta.flickerZones || []).length >= 1, 'P5 area2: 明滅だけの通路がある', (meta.flickerZones || []).length);
    bad = 0;
    var em = meta.emergency || [];
    for (i = 0; i < em.length; i++) if (!map.isWalkable(em[i].col, em[i].row)) bad++;
    t.ok(em.length > 0 && bad === 0, 'P5 area2: 非常灯は歩行可能マスの上', em.length + ' / ' + bad);

    /* 掲示（正文の本文表を持つ） */
    var ST = (ESCAPE.PROGRESS_SIGN_TEXT_BY_MAP && ESCAPE.PROGRESS_SIGN_TEXT_BY_MAP.area2) || {};
    var sg = meta.signs || [];
    bad = [];
    for (i = 0; i < sg.length; i++) {
      if (!ST[sg[i].id]) bad.push(sg[i].id);
      else if (map.isWalkable(sg[i].col, sg[i].row) || !faceWalkable(sg[i])) bad.push(sg[i].id + '(面)');
    }
    t.ok(sg.length >= 4 && bad.length === 0, 'P5 area2: 掲示4種が正文の本文を持ち壁に付いている',
      sg.length + ' / ' + bad.join(','));
  }

  /* ================================================================
   * 4) 区画（全歩行可能マスの被覆・正文の区画名・銘板）
   * ============================================================== */
  function testA2Regions(t, g) {
    if (!ESCAPE.Maps.has('area2')) return;
    var map = ESCAPE.Maps.load('area2'), meta = map.meta;
    var regions = meta.regions || [];
    var cells = map.walkableCells();
    var uncovered = 0, zc = Object.create(null), i;
    for (i = 0; i < cells.length; i++) {
      var z = null;
      for (var q = 0; q < regions.length; q++) {
        if (inBox(regions[q], cells[i].col, cells[i].row)) { z = regions[q].zone; break; }
      }
      if (!z) uncovered++;
      else zc[z] = (zc[z] || 0) + 1;
    }
    t.ok(uncovered === 0, 'P5 area2: 全ての歩行可能マスが区画を持つ', uncovered);
    var zones = ['A', 'B', 'C', 'D', 'E', 'F'], missing = [];
    for (i = 0; i < zones.length; i++) if (!zc[zones[i]]) missing.push(zones[i]);
    t.ok(missing.length === 0, 'P5 area2: 区画A〜Fが全て存在する',
      zones.map(function (z2) { return z2 + ':' + (zc[z2] || 0); }).join(' '));

    /* 合流槽9つが別 id を持つ */
    var jn = 0, ids = Object.create(null), dupe = 0;
    for (i = 0; i < regions.length; i++) {
      if (ids[regions[i].id]) dupe++;
      ids[regions[i].id] = true;
      if (/合流槽/.test(regions[i].name || '')) jn++;
    }
    t.ok(dupe === 0, 'P5 area2: region の id が重複していない', dupe);
    t.ok(jn === 9, 'P5 area2: 合流槽9つが別 id で登録されている', jn);

    /* 区画銘板 = 正文の区画名（docs/notes.md「区画名」） */
    var NAMES = (ESCAPE.ZONE_NAMES_BY_MAP && ESCAPE.ZONE_NAMES_BY_MAP.area2) || {};
    t.ok(NAMES.A === '流入区画' && NAMES.B === '幹線区画' && NAMES.C === '沈殿区画' &&
      NAMES.D === '機関区画' && NAMES.E === '旧坑区画' && NAMES.F === '水門区画',
      'P5 area2: 区画名6つが正文どおり');
    var rs = meta.regionSigns || [], seen = Object.create(null), bad = [];
    for (i = 0; i < rs.length; i++) {
      seen[rs[i].zone] = true;
      if (NAMES[rs[i].zone] !== rs[i].name) bad.push(rs[i].id);
      var v = FACE[rs[i].dir] || FACE.n;
      if (map.isWalkable(rs[i].col, rs[i].row)) bad.push(rs[i].id + '(壁でない)');
      else if (!map.isWalkable(rs[i].col + v[0], rs[i].row + v[1])) bad.push(rs[i].id + '(読めない)');
    }
    t.ok(rs.length === 6 && bad.length === 0,
      'P5 area2: 銘板6枚の zone/name が正文と一致し壁に付いている', rs.length + ' / ' + bad.join(','));
    for (i = 0; i < zones.length; i++) if (!seen[zones[i]]) bad.push('銘板なし:' + zones[i]);
    t.ok(bad.length === 0, 'P5 area2: 銘板が区画A〜Fに1枚ずつある', bad.join(','));

    /* 天井高（幹線 4.6 / 支線 2.4 / 合流槽 5.0） */
    var cl = meta.ceilings || [], h46 = 0, h50 = 0, dflt = 0;
    for (i = 0; i < cl.length; i++) {
      if (Math.abs(cl[i].h - 4.6) < 1e-6) h46++;
      if (Math.abs(cl[i].h - 5.0) < 1e-6) h50++;
      if (Math.abs(cl[i].h - 2.4) < 1e-6) dflt++;
    }
    t.ok(h46 >= 6 && h50 === 9 && dflt >= 1,
      'P5 area2: 天井高 幹線4.6×6 / 合流槽5.0×9 / 支線2.4', h46 + '/' + h50 + '/' + dflt);
  }

  /* ================================================================
   * 5) 行き止まりの「来た意味」（契約 §3③）
   * ============================================================== */
  function testA2DeadEnds(t, g) {
    if (!ESCAPE.Maps.has('area2')) return;
    var map = ESCAPE.Maps.load('area2'), meta = map.meta;
    var cells = map.walkableCells(), i, k;
    var notesFace = Object.create(null);
    var notes = meta.notes || [];
    for (i = 0; i < notes.length; i++) {
      var v = FACE[notes[i].dir] || FACE.n;
      notesFace[(notes[i].col + v[0]) + ',' + (notes[i].row + v[1])] = true;
    }
    var cpAt = Object.create(null), cps = meta.checkpoints || [];
    for (i = 0; i < cps.length; i++) cpAt[cps[i].col + ',' + cps[i].row] = true;
    var lkAt = Object.create(null), lk = meta.lockers || [];
    for (i = 0; i < lk.length; i++) lkAt[lk[i].col + ',' + lk[i].row] = true;
    /* 見せ場ルーム（部屋 region）の中も「来た意味」を満たす */
    var bands = Object.create(null), bs = meta.bands || [];
    for (i = 0; i < bs.length; i++) bands[bs[i].id] = true;
    var rooms = [], rgs = meta.regions || [];
    for (i = 0; i < rgs.length; i++) if (!bands[rgs[i].id]) rooms.push(rgs[i]);

    var dead = 0, naked = [];
    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (degOf(map, c.col, c.row) !== 1) continue;
      dead++;
      var key = c.col + ',' + c.row;
      var has = !!(notesFace[key] || cpAt[key]);
      for (k = 0; k < 4 && !has; k++) {
        if (lkAt[(c.col + D4[k][0]) + ',' + (c.row + D4[k][1])]) has = true;
      }
      for (k = 0; k < rooms.length && !has; k++) if (inBox(rooms[k], c.col, c.row)) has = true;
      if (!has) naked.push(key);
    }
    t.ok(naked.length === 0,
      'P5 area2: 行き止まり' + dead + '箇所すべてに「来た意味」（メモ/ロッカー/端末/見せ場）',
      naked.join(' '));
  }

  /* ================================================================
   * 6) 物語ゲート（日誌1＝スタート区画の外／日誌2＝ポンプ室へ降りる直前）
   * ============================================================== */
  function testA2Story(t, g) {
    if (!ESCAPE.Maps.has('area2')) return;
    var map = ESCAPE.Maps.load('area2'), meta = map.meta;
    var byMap = ESCAPE.STORY_GATES_BY_MAP || {};
    var gates = byMap.area2 || [];
    t.ok(!!byMap.area1 && !!byMap.area2, 'P5: 物語ゲートがマップ別に登録されている');
    t.ok(byMap.area1 !== byMap.area2, 'P5: area1 と area2 のゲートが別の配列');
    if (!t.ok(gates.length === 1 && gates[0].id === 'a2_diary2',
      'P5 area2: 物語ゲートは日誌2の1点', gates.length)) return;
    var gt = gates[0];
    t.ok(map.isWalkable(gt.col, gt.row), 'P5 area2: ゲートのマスは歩行可能');
    var wallNear = 0;
    for (var i = 0; i < 4; i++) {
      if (map.tileAt(gt.col + D4[i][0], gt.row + D4[i][1]) === ESCAPE.TILE.WALL ||
        map.tileAt(gt.col + D4[i][0], gt.row + D4[i][1]) === ESCAPE.TILE.NOTE) wallNear++;
    }
    t.ok(wallNear >= 1, 'P5 area2: ゲートのマスは壁メモを貼れる（4近傍に壁）', wallNear);

    /* ポンプ室（-2m の台地）へ降りる者が必ず通るマスであること */
    var plats = meta.plateaus || [], low = null;
    for (i = 0; i < plats.length; i++) if (plats[i].y <= -1.9) low = plats[i];
    if (t.ok(!!low, 'P5 area2: -2m の窪地（ポンプ室）がある')) {
      var target = null;
      for (var r = low.r0; r <= low.r1 && !target; r++) {
        for (var c = low.c0; c <= low.c1 && !target; c++) if (map.isWalkable(c, r)) target = { col: c, row: r };
      }
      var sp = meta.spawn;
      var d0 = bfs(map, sp.col, sp.row);
      var W = map.width;
      t.ok(d0[target.row * W + target.col] >= 0, 'P5 area2: ポンプ室へ到達できる');
      t.ok(d0[gt.row * W + gt.col] === gt.dist,
        'P5 area2: ゲートの経路距離がヘッダーの算出値と一致', d0[gt.row * W + gt.col] + ' vs ' + gt.dist);
      /* R5': 進行路が最初に踏むランプの入口の 3〜4 マス手前（R7 の寄せを許す） */
      var ramps = meta.ramps || [], entry = null, bestD = Infinity;
      for (i = 0; i < ramps.length; i++) {
        for (var rr2 = ramps[i].r0; rr2 <= ramps[i].r1; rr2++) {
          for (var cc2 = ramps[i].c0; cc2 <= ramps[i].c1; cc2++) {
            var dd2 = d0[rr2 * W + cc2];
            if (dd2 >= 0 && dd2 < bestD) { bestD = dd2; entry = { col: cc2, row: rr2 }; }
          }
        }
      }
      if (t.ok(!!entry, 'P5 area2: 進行路が最初に踏むランプの入口が求まる')) {
        var back = bestD - gt.dist;
        t.ok(back >= 3 && back <= 4,
          'P5 area2: 日誌2はランプ入口の3〜4マス手前（R7の寄せを含む）',
          'ランプ入口 d' + bestD + ' / ゲート d' + gt.dist + ' = ' + back + 'マス手前');
      }
      /* 進行路（spawn→ハンドル→出口）がポンプ室を通ること（契約 追補） */
      var ks2 = meta.keySafe, kAdj2 = null;
      for (i = 0; i < 4; i++) {
        var kc2 = ks2.col + D4[i][0], kr2 = ks2.row + D4[i][1];
        if (map.isWalkable(kc2, kr2)) { kAdj2 = { col: kc2, row: kr2 }; break; }
      }
      if (kAdj2) {
        var route = pathBack(map, d0, kAdj2.col, kAdj2.row);
        var through = 0;
        for (i = 0; i < route.length; i++) {
          var rc = route[i] % W, rr3 = (route[i] - rc) / W;
          if (rc >= low.c0 && rc <= low.c1 && rr3 >= low.r0 && rr3 <= low.r1) through++;
        }
        t.ok(through > 0, 'P5 area2: 進行路がポンプ室（-2m の窪地）を通る', through + 'マス');
      }
    }

    /* 日誌1 はスタート部屋（spawn を含む最小の部屋 region）の外への遷移で開く */
    var sp2 = meta.spawn, best = null, bestA = Infinity;
    var rgs = meta.regions || [];
    for (i = 0; i < rgs.length; i++) {
      var q = rgs[i];
      if (!q.zone || !inBox(q, sp2.col, sp2.row)) continue;
      var w = q.c1 - q.c0 + 1, h = q.r1 - q.r0 + 1;
      if (w > 14 || h > 14 || w < 2 || h < 2) continue;
      var a = w * h;
      if (a < bestA) { bestA = a; best = q; }
    }
    t.ok(!!best, 'P5 area2: スタート区画（部屋）が特定できる', best ? best.id : 'なし');
    var DID = (ESCAPE.PROGRESS_DIARY_ID_BY_MAP || {}).area2;
    t.ok(DID === 'a2_diary1', 'P5 area2: 自動表示する日誌の id', DID);
    var hasNote = false;
    for (i = 0; i < (meta.notes || []).length; i++) if (meta.notes[i].id === DID) hasNote = true;
    t.ok(hasNote, 'P5 area2: 日誌1が壁メモとしても読み返せる');
  }

  /* ================================================================
   * 6.5) ランプ3本の開通とポンプ室の3入口（契約 追補 2026-09-13）
   * ============================================================== */
  function testA2Ramps(t, g) {
    if (!ESCAPE.Maps.has('area2')) return;
    var map = ESCAPE.Maps.load('area2'), meta = map.meta, W = map.width;
    var ramps = meta.ramps || [];
    t.ok(ramps.length >= 3, 'P5 area2: ランプ 3 本以上', ramps.length);
    /* ① 3本とも全マスが歩行可能（岩盤の中に埋まっていない） */
    var bad = [], i, c, r;
    for (i = 0; i < ramps.length; i++) {
      var a = ramps[i];
      for (r = a.r0; r <= a.r1; r++) {
        for (c = a.c0; c <= a.c1; c++) if (!map.isWalkable(c, r)) bad.push(c + ',' + r);
      }
    }
    t.ok(bad.length === 0, 'P5 area2: ランプのマスは全て歩行可能（袋小路にしない）', bad.join(' '));
    /* ② 各ランプの両端が高さの違う床に連続して接続している（段差ゼロは heightSeams が見る） */
    var lows = 0, highs = 0;
    for (i = 0; i < ramps.length; i++) {
      if (Math.abs(ramps[i].y0 - ramps[i].y1) < 1.9) continue;
      if (ramps[i].y0 < ramps[i].y1) lows++; else highs++;
    }
    t.ok(lows + highs === 3, 'P5 area2: 3本とも ±2m の高低差を持つ', lows + '本が上り / ' + highs + '本が下り');
    t.ok(map.heightSeams().length === 0, 'P5 area2: ランプ開通後も段差の継ぎ目 0');

    /* ③ ポンプ室は3方向から入れる＝どれか1本を塞いでも到達でき、3本とも塞ぐと到達不能 */
    var plats = meta.plateaus || [], low = null;
    for (i = 0; i < plats.length; i++) if (plats[i].y <= -1.9) low = plats[i];
    if (!t.ok(!!low, 'P5 area2: -2m の窪地（ポンプ室）がある')) return;
    var target = null;
    for (r = low.r0; r <= low.r1 && !target; r++) {
      for (c = low.c0; c <= low.c1 && !target; c++) if (map.isWalkable(c, r)) target = { col: c, row: r };
    }
    var sp = meta.spawn;
    /* ランプごとの「ポンプ室の外側の1マス」＝塞ぐ場所 */
    var gates = [];
    for (i = 0; i < ramps.length; i++) {
      var a2 = ramps[i], out = null, bestD = -1;
      for (r = a2.r0; r <= a2.r1; r++) {
        for (c = a2.c0; c <= a2.c1; c++) {
          var inLow = (c >= low.c0 && c <= low.c1 && r >= low.r0 && r <= low.r1);
          if (inLow) continue;
          /* 窪地から遠い端＝外側の入口 */
          var dd = Math.abs(c - (low.c0 + low.c1) / 2) + Math.abs(r - (low.r0 + low.r1) / 2);
          if (dd > bestD) { bestD = dd; out = { col: c, row: r }; }
        }
      }
      if (out) gates.push(out);
    }
    t.ok(gates.length === 3, 'P5 area2: ランプ3本それぞれの外側の入口が求まる', gates.length);
    function blockOf(list) {
      var blk = Object.create(null);
      for (var k = 0; k < list.length; k++) {
        var gk = list[k].row * W + list[k].col;
        for (var q = 0; q < 4; q++) {
          var nc = list[k].col + D4[q][0], nr = list[k].row + D4[q][1];
          if (nc < 0 || nr < 0 || nc >= map.width || nr >= map.height) continue;
          blk[gk + ':' + (nr * W + nc)] = true;
        }
      }
      return blk;
    }
    var okEach = 0;
    for (i = 0; i < gates.length; i++) {
      var d1 = bfs(map, sp.col, sp.row, blockOf([gates[i]]));
      if (d1[target.row * W + target.col] >= 0) okEach++;
    }
    t.ok(okEach === 3, 'P5 area2: どのランプ1本を塞いでもポンプ室へ行ける（3入口が互いに独立）',
      okEach + '/3');
    var dAll = bfs(map, sp.col, sp.row, blockOf(gates));
    t.ok(dAll[target.row * W + target.col] < 0,
      'P5 area2: 3本とも塞いだときだけポンプ室が到達不能（入口はこの3本だけ）',
      dAll[target.row * W + target.col]);
  }

  /* ================================================================
   * 7) エリア切替・保存キー・敵0体・水路の挙動
   * ============================================================== */
  function testA2Engine(t, g) {
    /* --- 切替の決定関数（純関数） --- */
    var R = ESCAPE.resolveArea;
    if (t.ok(typeof R === 'function', 'P5 切替: ESCAPE.resolveArea がある')) {
      t.ok(R('?area=area2', null) === 'area2', 'P5 切替: ?area= が最優先');
      t.ok(R('?area=area1', 'area2') === 'area1', 'P5 切替: ?area= は localStorage より強い');
      t.ok(R('', 'area2') === 'area2', 'P5 切替: ?area= が無ければ localStorage');
      t.ok(R('', null) === 'area1', 'P5 切替: どちらも無ければ area1');
      t.ok(R('?area=area9', null) === 'area1', 'P5 切替: 存在しない id は area1 に落ちる');
      t.ok(R('', 'area9') === 'area1', 'P5 切替: localStorage の不正値も area1 に落ちる');
      t.ok(R('?x=1&area=area2&y=2', null) === 'area2', 'P5 切替: 他のクエリが混ざっても拾える');
    }
    t.ok(ESCAPE.currentArea() === g.mapId, 'P5 切替: currentArea と game.mapId が一致', g.mapId);
    /* 次のエリアを開くときは `?area=` を落とす（残すとクエリが escape.area より強く、戻ってしまう） */
    var UW = ESCAPE.urlWithoutArea;
    if (t.ok(typeof UW === 'function', 'P5 切替: ESCAPE.urlWithoutArea がある')) {
      t.ok(UW('http://x/i.html?area=area1') === 'http://x/i.html', 'P5 切替: ?area= だけなら ? ごと落とす');
      t.ok(UW('http://x/i.html?a=1&area=area2&b=2') === 'http://x/i.html?a=1&b=2',
        'P5 切替: 他のクエリは残す', UW('http://x/i.html?a=1&area=area2&b=2'));
      t.ok(UW('http://x/i.html?area=area2#top') === 'http://x/i.html#top', 'P5 切替: ハッシュは残す');
      t.ok(UW('http://x/i.html') === 'http://x/i.html', 'P5 切替: クエリが無ければそのまま');
    }

    /* --- 保存キーの分離 --- */
    t.ok(ESCAPE.saveKeyOf('area1') === 'escape.save.area1.v2',
      'P5 保存: area1 のキー名は従来どおり（互換）', ESCAPE.saveKeyOf('area1'));
    t.ok(ESCAPE.saveKeyOf('area2') === 'escape.save.area2.v2',
      'P5 保存: area2 は別のキー', ESCAPE.saveKeyOf('area2'));
    t.ok(ESCAPE.saveKeyOf('area1') !== ESCAPE.saveKeyOf('area2'), 'P5 保存: エリアごとに分かれている');
    var all = ESCAPE.saveKeysAll();
    t.ok(all.length === 2 && all.indexOf('escape.save.area1.v2') >= 0 &&
      all.indexOf('escape.save.area2.v2') >= 0, 'P5 保存: 全エリアのキーを列挙できる', all.join(','));
    t.ok(ESCAPE.PROGRESS_SAVE_KEY === ESCAPE.saveKeyOf(g.mapId),
      'P5 保存: Progress は現在のエリアのキーを使う', ESCAPE.PROGRESS_SAVE_KEY);

    /* --- 「最初から」で全エリアの保存と escape.area が消える --- */
    var K1 = ESCAPE.saveKeyOf('area1'), K2 = ESCAPE.saveKeyOf('area2'), AK = ESCAPE.AREA_KEY;
    var snap = {};
    try {
      snap[K1] = global.localStorage.getItem(K1);
      snap[K2] = global.localStorage.getItem(K2);
      snap[AK] = global.localStorage.getItem(AK);
      global.localStorage.setItem(K1, '{"v":4,"mapId":"area1"}');
      global.localStorage.setItem(K2, '{"v":4,"mapId":"area2"}');
      global.localStorage.setItem(AK, 'area2');
      var reloads = 0, realReload = ESCAPE.reloadPage;
      ESCAPE.reloadPage = function () { reloads++; };
      ESCAPE.Title._eraseSave();
      ESCAPE.reloadPage = realReload;
      t.ok(global.localStorage.getItem(K1) === null && global.localStorage.getItem(K2) === null,
        'P5 保存:「最初から」で両エリアの保存が消える');
      t.ok(global.localStorage.getItem(AK) === 'area1',
        'P5 保存:「最初から」で escape.area が area1 に戻る', global.localStorage.getItem(AK));
      t.ok(reloads === 0, 'P5 保存: area1 を開いている時は再読込しない', reloads);

      /* 「データを消す」は escape.area ごと消える */
      global.localStorage.setItem(K1, '{"v":4}');
      global.localStorage.setItem(K2, '{"v":4}');
      global.localStorage.setItem(AK, 'area2');
      ESCAPE.reloadPage = function () { reloads++; };
      g.progress.eraseAllData();
      ESCAPE.reloadPage = realReload;
      t.ok(global.localStorage.getItem(K1) === null && global.localStorage.getItem(K2) === null &&
        global.localStorage.getItem(AK) === null,
        'P5 保存:「データを消す」で全エリア＋escape.area が消える');
    } catch (e) {
      t.ok(false, 'P5 保存: localStorage の検査で例外', e && e.message);
    } finally {
      try {
        for (var kk in snap) {
          if (snap[kk] === null || snap[kk] === undefined) global.localStorage.removeItem(kk);
          else global.localStorage.setItem(kk, snap[kk]);
        }
      } catch (e2) { /* 無視 */ }
    }

    /* --- 敵の体数（meta.enemyCount）。P5e-2b で area2 は 0 → 3 になった --- */
    var A2 = ESCAPE.Maps.has('area2') ? ESCAPE.Maps.load('area2') : null;
    t.ok(!!ESCAPE.AIManager && typeof ESCAPE.AIManager.countFor === 'function',
      'P5 体数: 体数の決定関数がある');
    if (ESCAPE.AIManager && A2) {
      t.ok(ESCAPE.AIManager.countFor(A2) === 3, 'P5e-2b: area2 は敵3体',
        ESCAPE.AIManager.countFor(A2));
      t.ok(ESCAPE.AIManager.countFor(g.map) === 2, 'P5 体数: area1 は従来どおり2体（未指定＝既定）',
        ESCAPE.AIManager.countFor(g.map));
      t.ok(ESCAPE.AIManager.countFor({ meta: {} }) === ESCAPE.ENEMY_TUNING.enemyCount,
        'P5 体数: meta.enemyCount 未指定は ENEMY_TUNING の既定');
    }
    t.ok(A2 && A2.meta.enemyCount === 3, 'P5e-2b: area2 の meta.enemyCount が 3');
    t.ok(A2 && A2.meta.floorDefault === 'stone', 'P5 音: area2 の既定の足音素材が石');
    t.ok(A2 && A2.meta.ambience === 'sewer', 'P5 音: area2 の環境音が下水道');

    /* --- 水路の挙動（使い捨ての Player で実測。ライブの game は触らない） --- */
    if (A2) {
      var TILE = ESCAPE.TILE, wcell = null, dcell = null;
      for (var r = 0; r < A2.height && !wcell; r++) {
        for (var c = 0; c < A2.width && !wcell; c++) {
          if (A2.tileAt(c, r) !== TILE.WATER) continue;
          /* 前後に同じ水路が続くマスを選ぶ（1フレームで壁に当たらない） */
          if (A2.tileAt(c - 1, r) === TILE.WATER && A2.tileAt(c + 1, r) === TILE.WATER) wcell = { col: c, row: r };
        }
      }
      for (r = 0; r < A2.height && !dcell; r++) {
        for (c = 0; c < A2.width && !dcell; c++) {
          if (A2.tileAt(c, r) !== TILE.FLOOR) continue;
          if (A2.tileAt(c - 1, r) === TILE.FLOOR && A2.tileAt(c + 1, r) === TILE.FLOOR) dcell = { col: c, row: r };
        }
      }
      if (t.ok(!!wcell && !!dcell, 'P5 水路: 実測用の水路マスと乾いた通路マスが見つかる')) {
        var dt = ESCAPE.FIXED_DT;
        var measure = function (cell, run) {
          var p = new ESCAPE.Player(A2);
          var cc = A2.cellCenter(cell.col, cell.row);
          p.x = cc.x; p.z = cc.z;
          p.y = A2.floorYAt(p.x, p.z);
          p.yaw = -Math.PI / 2;                 /* +X 方向を向く */
          var x0 = p.x;
          for (var i = 0; i < 10; i++) p.step(dt, { moveX: 0, moveY: 1, run: run, crouch: false });
          return { v: Math.abs(p.x - x0) / (10 * dt), mode: p.mode, wet: p.inWater };
        };
        var dry = measure(dcell, false);
        var dryRun = measure(dcell, true);
        var wet = measure(wcell, false);
        var wetRun = measure(wcell, true);
        t.near(dry.v, ESCAPE.Player.SPEED_WALK, 0.05, 'P5 水路: 乾いた通路の歩行速度');
        t.near(dryRun.v, ESCAPE.Player.SPEED_RUN, 0.05, 'P5 水路: 乾いた通路では走れる');
        t.near(wet.v, ESCAPE.Player.SPEED_WALK * 0.75, 0.05, 'P5 水路: 水路の歩行速度は x0.75');
        t.near(wetRun.v, ESCAPE.Player.SPEED_WALK * 0.75, 0.05,
          'P5 水路: 水路では走るを押しても歩き（x0.75）のまま');
        t.ok(wetRun.mode === 'walk' && dryRun.mode === 'run',
          'P5 水路: 水路では mode が run にならない', wetRun.mode + ' / ' + dryRun.mode);
        t.ok(wet.wet === true && dry.wet === false, 'P5 水路: inWater の判定');
        t.ok(ESCAPE.Player.WATER_SPEED_MUL === 0.75, 'P5 水路: 速度係数は 0.75',
          ESCAPE.Player.WATER_SPEED_MUL);
      }
    }

    /* --- 遷移画面・クリア仮画面の正文 --- */
    var E = ESCAPE.PROGRESS_ENDING_BY_MAP || {};
    t.ok(!!E.area1 && !!E.area2, 'P5 接続: 到達パッドの画面がマップ別にある');
    if (E.area1) {
      t.ok(E.area1.title === '隔壁の向こう' && E.area1.button === '降りる',
        'P5 接続: area1 の遷移画面の正文', E.area1.title + ' / ' + E.area1.button);
      t.ok(E.area1.body.indexOf('錆びた梯子と、下から上がってくる水の匂いだけだ') >= 0 &&
        E.area1.body.indexOf('—— 降りるしかない。') >= 0, 'P5 接続: 遷移画面の本文が正文');
      t.ok(E.area1.action === 'nextArea' && E.area1.next === 'area2',
        'P5 接続: 遷移画面のボタンは escape.area=area2 を保存して再読込');
    }
    if (E.area2) {
      t.ok(E.area2.title === '深部へ' && E.area2.button === 'タイトルへ',
        'P5 接続: area2 のクリア仮画面の正文', E.area2.title + ' / ' + E.area2.button);
      t.ok(E.area2.body.indexOf('水門の先は、さらに下へ続いていた。') >= 0 &&
        E.area2.body.indexOf('（エリア3は制作中）') >= 0, 'P5 接続: クリア仮画面の本文が正文');
    }

    /* --- area2 の UI文言・目的表示の正文 --- */
    var U = (ESCAPE.PROGRESS_UI_TEXT_BY_MAP || {}).area2;
    var O = (ESCAPE.PROGRESS_OBJECTIVE_BY_MAP || {}).area2;
    if (t.ok(!!U && !!O, 'P5 area2: UI文言と目的表示の表がある')) {
      t.ok(U.safe === 'ハンドルを取る' && U.keyGot === '水門の操作ハンドルを手に入れた',
        'P5 area2: ハンドルの文言が正文');
      t.ok(U.bulkheadLook === '操作盤を調べる' && U.bulkheadLocked === '軸が空だ —— ハンドルがいる' &&
        U.bulkheadUnlock === 'ハンドルを嵌めて回す' && U.doorOpened === '水門が上がった',
        'P5 area2: 操作盤の文言が正文');
      t.ok(U.waterNoRun === '水の中では走れない', 'P5 area2: 水路の案内が正文', U.waterNoRun);
      t.ok(O.findKey === '水門の操作ハンドルを探す —— 旧坑道の奥へ' &&
        O.haveKey === 'ハンドルを手に入れた —— 水門の制御室へ' &&
        O.doorOpen === '水門が上がった —— 先へ', 'P5 area2: 目的表示3行が正文');
    }
    /* area1 の文言は不変 */
    var U1 = (ESCAPE.PROGRESS_UI_TEXT_BY_MAP || {}).area1;
    t.ok(U1 && U1.safe === '金庫を開ける' && U1.doorOpened === undefined,
      'P5: area1 の UI文言は不変（doorOpened を持たない）');
  }

  ESCAPE.__extraSuites.push(
    testA2Structure, testA2Tiles, testA2Placement, testA2Regions,
    testA2DeadEnds, testA2Ramps, testA2Story, testA2Engine
  );

  /* ================================================================
   * 段階2「runArea2」（契約 DESIGN.md「P5 エリア2『下水道』」段階2）。
   * `?area=area2` の**実ページ**で `window.__test.runArea2()` から呼ばれる（js/test.js が
   * 結線する。js/test.js の変更はその結線と輝度ゲート helper の共有だけ＝実体はここ）。
   * runAll の __extraSuites（上の8関数）は area1 ページの静的データ検査で、これとは別物。
   * ============================================================== */

  /** 最小限の Runner（js/test.js の Runner と同じ形。あちらは内部クロージャで取り出せない） */
  function A2Runner() { this.results = []; this.passed = 0; this.failed = 0; }
  A2Runner.prototype.ok = function (cond, name, detail) {
    var r = { name: name, pass: !!cond, detail: detail === undefined ? '' : String(detail) };
    this.results.push(r);
    if (r.pass) this.passed++; else this.failed++;
    return r.pass;
  };
  /** 数値の近さ（js/test.js の Runner と同じ形。P5e-2b の数値検査が使う） */
  A2Runner.prototype.near = function (v, want, tol, name, detail) {
    return this.ok(Math.abs(v - want) <= tol, name,
      detail === undefined ? (v + ' vs ' + want) : detail);
  };
  function a2Summarize(t) {
    return { passed: t.passed, failed: t.failed, total: t.results.length, results: t.results };
  }

  /** キー入力。実ブラウザと同じ経路（body から発火 → window の bubble）で流す */
  function a2SendKey(type, code) {
    document.body.dispatchEvent(new KeyboardEvent(type, { code: code, bubbles: true, cancelable: true }));
  }
  /** 「調べる」1回ぶん（keydown → 1ポンプ → keyup） */
  function a2PressInteract() {
    a2SendKey('keydown', 'KeyE');
    global.__pump(1);
    a2SendKey('keyup', 'KeyE');
  }
  /** computed style での可視判定（契約「罠」節：表示は computed style で見る） */
  function a2Visible(el) {
    if (!el || !global.getComputedStyle) return false;
    var cs = global.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return parseFloat(cs.opacity || '1') > 0.01;
  }

  /** 視点を置いて1枚描く準備（js/test.js の p417Place と同じ手順。ロープ線は伏せる） */
  function a2PlaceCam(g, c) {
    var pos = g.map.cellCenter(c.col, c.row);
    g.player.x = pos.x; g.player.z = pos.z;
    g.player.yaw = (c.yawDeg || 0) * Math.PI / 180;
    g.player.pitch = 0;
    g.player.y = g.map.floorYAt(g.player.x, g.player.z);
    g.player.speed = 0;
    g.syncCamera();
    if (g.rope && g.rope.group) g.rope.group.visible = false;
    if (g.headlight) {
      g.headlight.on = !!c.light;
      g.headlight.level = c.light ? 1 : 0;
      if (g.headlight._place) g.headlight._place();
      if (g.headlight._apply) g.headlight._apply();
    }
    if (ESCAPE.RQ && ESCAPE.RQ.snapLights) ESCAPE.RQ.snapLights();
  }

  /** yaw(deg): forward()=( -sin(yaw), -cos(yaw) ) なので dr=-1(北)→0 / dr=+1(南)→180 /
   *  dc=-1(西)→90 / dc=+1(東)→270（js/maps/area2.js のギミックの向きと同じ換算）。 */
  function a2YawTo(dc, dr) {
    if (dr === -1) return 0;
    if (dr === 1) return 180;
    if (dc === -1) return 90;
    return 270;
  }

  /** マス中心から次のマス中心まで、実入力（moveY=前進）で歩かせる。
   *  onModal(memoId) が渡された場合、途中で開いたメモを即座に閉じて歩行を続ける。
   *  各マスの到達後にそのマス中心へ軽く寄せる（隅を曲がる際の僅かなズレが積算し、
   *  何十マスも先で壁に張り付いて動けなくなる事故を防ぐ。見た目は「そのマスへ歩いて
   *  入った」のままで、通過した実マス自体は変えない）。
   *  戻り値: 実際に開いたメモ id の配列（順番どおり）。 */
  function a2WalkPath(g, path, onModal) {
    g.input.moveX = 0; g.input.moveY = 0;
    var opened = [];
    function checkModal() {
      if (g.progress && g.progress.modal === 'memo') {
        var id = g.progress.memoId;
        opened.push(id);
        if (onModal) onModal(id);
        g.progress.onCloseTap();
      }
    }
    for (var i = 1; i < path.length; i++) {
      var cur = path[i - 1], nxt = path[i];
      var dc = nxt.col - cur.col, dr = nxt.row - cur.row;
      g.player.yaw = a2YawTo(dc, dr) * Math.PI / 180;
      g.input.moveX = 0; g.input.moveY = 1;
      var guard = 0;
      while (guard < 90 && !(g.player.col() === nxt.col && g.player.row() === nxt.row)) {
        global.__pump(1);
        guard++;
        checkModal();
      }
      var c = g.map.cellCenter(nxt.col, nxt.row);
      g.player.x = c.x; g.player.z = c.z;
      global.__pump(1);
      checkModal();
    }
    g.input.moveX = 0; g.input.moveY = 0;
    return opened;
  }

  /* ---------------- 1) 輝度ゲート3視点 ---------------- */
  function testA2RunLuma(t, g) {
    var util = ESCAPE.__testUtil;
    if (!t.ok(!!util && typeof util.lumaGate === 'function',
      'P5 段階2 輝度ゲート: lumaGate helper が js/test.js から共有されている')) return;
    var sp = g.map.meta.spawn;
    var cams = [
      { col: sp.col, row: sp.row, yawDeg: sp.yawDeg, light: false, name: 'スタート地点(spawn)' },
      { col: 39, row: 16, yawDeg: 180, light: false, name: '幹線の合流槽(39,16)' },
      { col: 21, row: 51, yawDeg: 0, light: true, name: '旧坑の暗部（ハンドル付近・ライト点灯）' }
    ];
    for (var i = 0; i < cams.length; i++) {
      a2PlaceCam(g, cams[i]);
      global.__pump(3);
      var q = util.lumaGate(g);
      t.ok(q.dark >= 35 && q.dark <= 65,
        'P5 段階2 輝度ゲート(' + cams[i].name + '): 暗部35〜65%', q.dark.toFixed(1) + '%');
      t.ok(q.mid >= 20,
        'P5 段階2 輝度ゲート(' + cams[i].name + '): 中間調20%以上', q.mid.toFixed(1) + '%');
      t.ok(q.hot < 3,
        'P5 段階2 輝度ゲート(' + cams[i].name + '): 白飛び3%未満', q.hot.toFixed(2) + '%');
    }
    if (g.rope && g.rope.group) g.rope.group.visible = true;
    if (g.headlight) g.headlight.reset();
  }

  /* ---------------- 2) 通し（ハンドル→操作盤→水門→到達パッド→クリア仮画面） ---------------- */
  function testA2RunPlaythrough(t, g) {
    g.reset();
    var pr = g.progress, U = ESCAPE.PROGRESS_UI_TEXT, O = ESCAPE.PROGRESS_OBJECTIVE;

    global.__test._place(14, 59, 270);
    global.__pump(60);
    t.ok(pr.dom.prompt.textContent === U.safe,
      'P5 段階2 通し: ハンドル前のプロンプトが「' + U.safe + '」', pr.dom.prompt.textContent);
    a2PressInteract();
    t.ok(pr.gimmick.key === true, 'P5 段階2 通し: KeyE でハンドルを取得');
    t.ok(pr.dom.objective.textContent === O.haveKey,
      'P5 段階2 通し: 目的表示が「' + O.haveKey + '」', pr.dom.objective.textContent);
    /* 「ハンドルを手に入れた」の応答表示（1.9秒）が残ったままだと次のプロンプト判定を
       上書きしてしまう（#prompt は _flashT>0 の間はそちらを優先する仕様）ので、
       js/test.js の既存テストと同じ流儀で明示的に消してから次へ進む。 */
    pr._flashT = 0; pr._flashMsg = '';

    global.__test._place(68, 70, 90);
    global.__pump(3);
    t.ok(pr.dom.prompt.textContent === U.bulkheadUnlock,
      'P5 段階2 通し: 操作盤前のプロンプトが「' + U.bulkheadUnlock + '」', pr.dom.prompt.textContent);
    a2PressInteract();
    t.ok(pr.gimmick.doorOpen === true, 'P5 段階2 通し: KeyE で水門を開放');
    t.ok(pr.dom.objective.textContent === O.doorOpen,
      'P5 段階2 通し: 目的表示が「' + O.doorOpen + '」', pr.dom.objective.textContent);

    global.__test._place(68, 70, 270);
    global.__pump(2);
    a2SendKey('keydown', 'KeyW');
    var frames = 0, guard = 500;
    while (frames < guard && !pr.cleared) { global.__pump(1); frames++; }
    a2SendKey('keyup', 'KeyW');
    t.ok(pr.cleared === true, 'P5 段階2 通し: 到達パッド(76,70)へ歩いてクリア', frames + 'フレーム');
    t.ok(pr.clearedBy === 'main', 'P5 段階2 通し: 正規ルートとして記録される', pr.clearedBy);

    var eo = document.getElementById('ending-overlay');
    t.ok(a2Visible(eo), 'P5 段階2 通し: クリア画面が可視（computed style）');
    var et = document.getElementById('ending-title'), eb = document.getElementById('ending-btn');
    t.ok(!!et && et.textContent === '深部へ', 'P5 段階2 通し: 見出しが「深部へ」', et && et.textContent);
    t.ok(!!eb && eb.textContent === 'タイトルへ', 'P5 段階2 通し: ボタンが「タイトルへ」', eb && eb.textContent);
  }

  /* ---------------- 3) 水路の速度 x0.75・走行不可 ---------------- */
  function testA2RunWater(t, g) {
    g.reset();
    function measure(col, row, useShift) {
      global.__test._place(col, row, 270);
      g.player.y = g.map.floorYAt(g.player.x, g.player.z);
      global.__pump(2);
      var x0 = g.player.x, z0 = g.player.z;
      if (useShift) a2SendKey('keydown', 'ShiftLeft');
      a2SendKey('keydown', 'KeyW');
      global.__pump(60);
      a2SendKey('keyup', 'KeyW');
      if (useShift) a2SendKey('keyup', 'ShiftLeft');
      global.__pump(1);
      return Math.hypot(g.player.x - x0, g.player.z - z0);
    }
    var dry = measure(1, 12, false);
    var wetWalk = measure(1, 13, false);
    var wetRun = measure(1, 13, true);
    var mul = ESCAPE.Player.WATER_SPEED_MUL;
    var r1 = wetWalk / dry, r2 = wetRun / dry;
    t.ok(dry > 0, 'P5 段階2 水路: 乾いた歩廊(1,12)の実測距離が0でない', dry.toFixed(3) + 'm');
    t.ok(r1 >= mul * 0.95 && r1 <= mul * 1.05,
      'P5 段階2 水路: 水路(1,13)の実移動が乾いた歩廊の' + mul + '倍(±5%)', r1.toFixed(3));
    t.ok(r2 >= mul * 0.95 && r2 <= mul * 1.05,
      'P5 段階2 水路: Shift併用でも' + mul + '倍のまま（走れない）', r2.toFixed(3));
    g.input.reset();
  }

  /* ================================================================
   * 4) 敵3体（契約 DESIGN.md §4「P5e-2」の P5e-2b「機械テスト」）
   * ============================================================== */

  function a2Sim(g, n) { for (var i = 0; i < n; i++) g.stepFrame(ESCAPE.FIXED_DT); }
  function a2SimUntil(g, cond, max) {
    for (var i = 0; i < max; i++) { if (cond()) return i; g.stepFrame(ESCAPE.FIXED_DT); }
    return cond() ? max : -1;
  }
  function a2Player(g, col, row, yawDeg) {
    var c = g.map.cellCenter(col, row), p = g.player;
    p.x = c.x; p.z = c.z; p.y = g.map.floorYAt(c.x, c.z);
    p.yaw = (yawDeg || 0) * Math.PI / 180;
    p.pitch = 0; p.speed = 0; p.crouching = false;
  }
  function a2Put(ai, col, row, yawDeg) {
    ai.enemy.placeCell(col, row, yawDeg === undefined ? 180 : yawDeg, ai.map);
    ai.path = null; ai.goal = null; ai.repathT = 0;
  }
  /** kind で個体を引く */
  function a2Ai(g, kind) {
    var L = g.ais.list;
    for (var i = 0; i < L.length; i++) if (L[i].kind === kind) return L[i];
    return null;
  }
  /** 主役以外を凍結する（駆け引きを1体ぶんだけ見たいとき）。解除は g.reset() */
  function a2Solo(g, ai) {
    var L = g.ais.list;
    for (var i = 0; i < L.length; i++) L[i].manual = (L[i] !== ai);
  }
  /** その体の縄張りの中で、条件 fn を満たす歩行可能マスを探す */
  function a2CellIn(g, ai, fn) {
    var map = g.map;
    for (var r = 1; r < map.height - 1; r++) {
      for (var c = 1; c < map.width - 1; c++) {
        if (!map.isWalkable(c, r)) continue;
        if (ai.territory && !ai.territory.contains(c, r)) continue;
        if (fn && !fn(c, r)) continue;
        return { col: c, row: r };
      }
    }
    return null;
  }

  /* ---- 4-1) 3体の生成・種類・縄張りの被覆 ---- */
  function testA2Enemies(t, g) {
    g.reset();
    var L = g.ais.list, map = g.map, i, c, r;
    if (!t.ok(L.length === 3, 'P5e-2b 生成: 敵が3体いる', L.length)) return;
    t.ok(g.ai === L[0], 'P5e-2b 生成: game.ai は先頭の個体（窓口は1本）');
    var kinds = [];
    for (i = 0; i < L.length; i++) kinds.push(L[i].kind);
    t.ok(kinds.join(',') === 'D,E,F', 'P5e-2b 生成: 種類が meta.enemyKinds どおり', kinds.join(','));
    var modelOk = true, terrOk = true;
    for (i = 0; i < L.length; i++) {
      if (L[i].enemy.kind !== L[i].kind) modelOk = false;
      if (!L[i].territory || L[i].territory.kind !== L[i].kind) terrOk = false;
    }
    t.ok(modelOk, 'P5e-2b 生成: モデルの kind が AI の kind と一致（EnemyFactory 経由）');
    t.ok(terrOk, 'P5e-2b 生成: 体と縄張りが対応している（解決順が変わってもずれない）');
    var tri = 0;
    for (i = 0; i < L.length; i++) tri += L[i].enemy.activeTriangles();
    t.ok(tri <= 90000, 'P5e-2b 生成: 3体同時の三角形合計が 90k 以内', tri);

    /* 縄張りの和が歩行可能マスを被覆する（契約） */
    var bad = 0, firstBad = '';
    for (r = 0; r < map.height; r++) {
      for (c = 0; c < map.width; c++) {
        if (!map.isWalkable(c, r)) continue;
        var hit = false;
        for (i = 0; i < L.length && !hit; i++) if (L[i].territory.contains(c, r)) hit = true;
        if (!hit) { bad++; if (!firstBad) firstBad = c + ',' + r; }
      }
    }
    t.ok(bad === 0, 'P5e-2b 縄張り: 3枚の和が歩行可能マスを被覆（未被覆0）',
      bad ? (bad + '件 例:' + firstBad) : '0件');

    /* 契約の内訳: D＝幹線と合流槽／E＝沈殿槽・ポンプ室／F＝旧坑と天井2.4の支線 */
    var W = function (col, row) {
      var rs = map.meta.regions || [];
      for (var k = 0; k < rs.length; k++) {
        var q = rs[k];
        if (col < q.c0 || col > q.c1 || row < q.r0 || row > q.r1) continue;
        return q.zone || null;
      }
      return null;
    };
    var D = a2Ai(g, 'D'), E = a2Ai(g, 'E'), F = a2Ai(g, 'F');
    t.ok(!!a2CellIn(g, D, function (c2, r2) { return W(c2, r2) === 'B' && map.ceilHAt(c2, r2) >= 4.6; }),
      'P5e-2b 縄張り: D の中に幹線（区画B・天井4.6以上）のマスがある');
    t.ok(!!a2CellIn(g, E, function (c2, r2) { return W(c2, r2) === 'C'; }) &&
         !!a2CellIn(g, E, function (c2, r2) { return W(c2, r2) === 'D'; }),
      'P5e-2b 縄張り: E の中に沈殿区画(C)とポンプ室のある機関区画(D)のマスがある');
    t.ok(!!a2CellIn(g, F, function (c2, r2) { return W(c2, r2) === 'E'; }),
      'P5e-2b 縄張り: F の中に旧坑区画(E)のマスがある');
    var lowOut = 0;
    for (r = 1; r < map.height - 1; r++) {
      for (c = 1; c < map.width - 1; c++) {
        if (!map.isWalkable(c, r) || map.ceilHAt(c, r) > 2.4) continue;
        if (!F.territory.contains(c, r)) lowOut++;
      }
    }
    t.ok(lowOut === 0, 'P5e-2b 縄張り: 天井2.4の支線は全て F の縄張り', lowOut + '件が外');

    /* 出現地点は互いに離れ、プレイヤーの spawn から BFS で 40 マス以上（契約） */
    var sp = map.meta.spawn, far = true, apart = true, minD = 1e9;
    var dSp = bfs(map, sp.col, sp.row);
    for (i = 0; i < L.length; i++) {
      var s = L[i].spawn;
      var dd = dSp[s.row * map.width + s.col];
      if (dd < 0 || dd < 40) far = false;
      if (dd >= 0 && dd < minD) minD = dd;
      for (var j = i + 1; j < L.length; j++) {
        var s2 = L[j].spawn;
        if (Math.hypot(s.col - s2.col, s.row - s2.row) < 25) apart = false;
      }
    }
    t.ok(far, 'P5e-2b 出現: 3体ともプレイヤーの spawn から BFS 40 マス以上', '最小 ' + minD);
    t.ok(apart, 'P5e-2b 出現: 3体が互いに離れて出る');
    g.reset();
  }

  /* ---- 4-2) 各体の状態機械（巡回 → 調査 → 追跡 → 捕獲 → 復帰） ---- */
  function testA2StateMachine(t, g) {
    var KINDS = ['D', 'E', 'F'];
    for (var k = 0; k < KINDS.length; k++) {
      g.reset();
      var ai = a2Ai(g, KINDS[k]), nm = 'P5e-2b 状態機械(' + KINDS[k] + ')';
      a2Solo(g, ai);
      /* 巡回: 縄張りの中を歩く */
      var x0 = ai.enemy.x, z0 = ai.enemy.z;
      a2Player(g, g.map.meta.spawn.col, g.map.meta.spawn.row, 0);
      a2Sim(g, 240);
      t.ok(Math.hypot(ai.enemy.x - x0, ai.enemy.z - z0) > 1.5,
        nm + ': 巡回で動いている', Math.hypot(ai.enemy.x - x0, ai.enemy.z - z0).toFixed(2) + 'm');
      t.ok(ai.state === 'patrol' && ai.territory.contains(ai.map.colOf(ai.enemy.x), ai.map.rowOf(ai.enemy.z)),
        nm + ': 巡回中は自分の縄張りの中にいる', ai.state);

      /* 調査: 音イベント（罠）に反応して音源へ向かう */
      var e = ai.enemy, near = null, cells = g.map.walkableCells();
      for (var i = 0; i < cells.length; i++) {
        var cc = g.map.cellCenter(cells[i].col, cells[i].row);
        var d = Math.hypot(cc.x - e.x, cc.z - e.z);
        if (d <= 8 || d >= 20) continue;
        if (!ai.blockedLine(e.x, e.z, cc.x, cc.z)) continue;
        /* 経路で辿り着ける音源だけを使う（深水の対岸は直線では近くても歩いて行けない） */
        if (g.ais.pathDistTo(ai, cc.x, cc.z, false) > 32) continue;
        near = cc; break;
      }
      if (t.ok(!!near, nm + ': 音源に使える見えないマスがある')) {
        ESCAPE.noise.emit(near.x, near.z, 40, 'trap');
        a2Sim(g, 2);
        t.ok(ai.state === 'investigate', nm + ': 罠の音で調査へ入る', ai.state);
        t.ok(ai.screams >= 1, nm + ': 罠の音には絶叫で応える', ai.screams);
        var got = a2SimUntil(g, function () {
          return Math.hypot(ai.enemy.x - near.x, ai.enemy.z - near.z) < 2.5 || ai.state === 'search';
        }, 900);
        t.ok(got >= 0, nm + ': 音源へ辿り着く', got + 'フレーム');
      }

      /* 追跡: 目の前に立つと見つかる */
      g.reset(); a2Solo(g, ai);
      var ec = { col: ai.map.colOf(ai.enemy.x), row: ai.map.rowOf(ai.enemy.z) };
      var pc = null, dir = null, D4b = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var m = 0; m < 4; m++) {
        /* 途中のマスも歩行可能＝視線が通る（遮蔽で見つからない偽の失敗を作らない） */
        if (!g.map.isWalkable(ec.col + D4b[m][0], ec.row + D4b[m][1])) continue;
        if (!g.map.isWalkable(ec.col + D4b[m][0] * 2, ec.row + D4b[m][1] * 2)) continue;
        pc = { col: ec.col + D4b[m][0] * 2, row: ec.row + D4b[m][1] * 2 };
        dir = D4b[m]; break;
      }
      if (t.ok(!!pc, nm + ': 敵の目の前に立てるマスがある')) {
        a2Player(g, pc.col, pc.row, 0);
        /* 敵をその場に据え、プレイヤーの方を向かせる（巡回で余所を向いたまま始めない） */
        a2Put(ai, ec.col, ec.row, a2YawTo(dir[0], dir[1]));
        if (g.headlight) { g.headlight.on = true; g.headlight.level = 1; }
        var saw = a2SimUntil(g, function () { return ai.state === 'chase'; }, 180);
        t.ok(saw >= 0, nm + ': 目の前のプレイヤーを見つけて追跡へ入る', ai.state);
        /* 捕獲: 逃げずに立っていれば捕まる */
        var caught = a2SimUntil(g, function () {
          return g.stealth.captures >= 1;
        }, 900);
        t.ok(caught >= 0, nm + ': 追いつかれて捕獲される（演出が始まる）',
          caught + 'フレーム / ' + ai.state);
      }

      /* 復帰: 演出が終わると巡回起点へ戻る */
      ai.afterJail();
      a2Sim(g, 2);
      t.ok(ai.state === 'patrol' && ai.form === 'stand',
        nm + ': 復帰で巡回・直立形態へ戻る', ai.state + '/' + ai.form);
      t.ok(ai.map.colOf(ai.enemy.x) === ai.spawn.col && ai.map.rowOf(ai.enemy.z) === ai.spawn.row,
        nm + ': 復帰で出現地点に戻る',
        ai.map.colOf(ai.enemy.x) + ',' + ai.map.rowOf(ai.enemy.z));
    }
    g.reset();
  }

  /* ---- 4-3) D: 天井→床の落下（1.2秒の猶予・当たり判定は床）・壁面姿勢・水路で減速なし ---- */
  function testA2KindD(t, g) {
    g.reset();
    var ai = a2Ai(g, 'D'), T = ai.T, map = g.map, e = ai.enemy;
    a2Solo(g, ai);
    t.ok(T.patrolSpeed === 1.40 && T.chaseSpeed === 5.40 && T.fovDeg === 140 &&
         T.sightDark === 7.0 && T.sightLit === 14.0,
      'P5e-2b D: 契約の数値（巡回1.4／追跡5.4／fov140／暗所7／明所14）',
      T.patrolSpeed + '/' + T.chaseSpeed + '/' + T.fovDeg + '/' + T.sightDark + '/' + T.sightLit);
    t.ok(T.waterSpeedMul === 1 && ESCAPE.ENEMY_TUNING.waterSpeedMul < 1,
      'P5e-2b D: 水路で減速しない（既定は減速する）', T.waterSpeedMul);

    /* 天井の高い幹線へ置く。stand は天井、crawl は床。落下の 1.2 秒は移動しない */
    var cell = a2CellIn(g, ai, function (c, r) {
      return map.ceilHAt(c, r) >= 4.6 && map.isWalkable(c, r + 1) && map.isWalkable(c, r - 1);
    });
    if (!t.ok(!!cell, 'P5e-2b D: 天井の高い検証用マスがある')) { g.reset(); return; }
    a2Put(ai, cell.col, cell.row, 180);
    ai.state = 'patrol'; ai.form = 'stand'; e.setForm('stand', true);
    e.update(0, 10); e.group.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(e.group);
    var floorY = map.floorYAt(e.x, e.z);
    t.ok(box.min.y > floorY + 1.0,
      'P5e-2b D: 直立形態（stand）では体が天井側にあり床から浮いている',
      (box.min.y - floorY).toFixed(2) + 'm');

    /* 発見 → 落下の遷移。遷移中は動かず、捕まえもしない */
    ai.state = 'chase'; ai.lastSeen = { x: e.x + 4, z: e.z };
    ai._applyForm();
    t.ok(e.state === 'trans', 'P5e-2b D: 追跡へ入ると落下の遷移が始まる', e.state);
    t.near(e.transDur, 1.20, 1e-6, 'P5e-2b D: 落下の遷移は 1.2 秒', e.transDur);
    var bx = e.x, bz = e.z, moved = 0, frames = 0;
    while (e.state === 'trans' && frames < 200) {
      ai.stepSelf(ESCAPE.FIXED_DT);
      moved = Math.max(moved, Math.hypot(e.x - bx, e.z - bz));
      frames++;
    }
    ai.stepSelf(ESCAPE.FIXED_DT);      /* 落ちきった次のフレーム＝着地 */
    t.ok(moved < 0.02, 'P5e-2b D: 落下中は移動しない（契約の 1.2 秒の猶予）', moved.toFixed(4) + 'm');
    t.ok(frames >= 70 && frames <= 76, 'P5e-2b D: 落下は約72フレーム（1.2秒）', frames);
    t.ok(ai._lands >= 1, 'P5e-2b D: 着地の音が鳴る（水路なら水しぶき）', ai._lands);
    e.update(0, 12); e.group.updateMatrixWorld(true);
    var box2 = new THREE.Box3().setFromObject(e.group);
    t.ok(Math.abs(box2.min.y - map.floorYAt(e.x, e.z)) < 0.35,
      'P5e-2b D: 落ちきると当たり判定（接地）が床に戻る',
      (box2.min.y - map.floorYAt(e.x, e.z)).toFixed(3) + 'm');

    /* 支線（天井2.4）では壁面姿勢: AI が壁の向きを渡す */
    var low = a2CellIn(g, ai, function (c, r) { return map.ceilHAt(c, r) <= 2.4; });
    if (t.ok(!!low && typeof e.setWall === 'function',
      'P5e-2b D: 支線のマスとモデルの壁面姿勢の口がある')) {
      a2Put(ai, low.col, low.row, 180);
      ai.state = 'patrol'; ai.form = 'stand'; e.setForm('stand', true);
      e.wallOn = 0;
      ai._syncWallPose();
      t.ok(e.wallOn === 1, 'P5e-2b D: 支線では壁の向きを受け取って壁面姿勢になる', e.wallOn);
      a2Put(ai, cell.col, cell.row, 180);
      ai._syncWallPose();
      t.ok(e.wallOn === 0, 'P5e-2b D: 幹線（天井が高い）では壁面姿勢を解く', e.wallOn);
    }
    g.reset();
  }

  /* ---- 4-4) E: 板を踏み潰す・水路で減速しない・執拗（探索2倍・最後の位置を再訪）・咆哮 ---- */
  function testA2KindE(t, g) {
    g.reset();
    var ai = a2Ai(g, 'E'), T = ai.T, map = g.map, e = ai.enemy, B = ESCAPE.ENEMY_TUNING;
    a2Solo(g, ai);
    t.ok(T.patrolSpeed === 1.10 && T.chaseSpeed === 3.80,
      'P5e-2b E: 契約の数値（巡回1.1／追跡3.8＝プレイヤー走り4.6より遅い）',
      T.patrolSpeed + '/' + T.chaseSpeed);
    t.ok(T.chaseSpeed < ESCAPE.Player.SPEED_RUN,
      'P5e-2b E: 走れば逃げ切れる', T.chaseSpeed + ' < ' + ESCAPE.Player.SPEED_RUN);
    t.ok(T.hearMul === 1.5 && T.searchDurMul === 2 && T.revisitLastSeen === true,
      'P5e-2b E: 聴覚1.5倍・探索2倍・最後の位置へ来続ける');
    t.ok(T.lockerPeekChance === 0 && T.trapLockerPeekChance === 0,
      'P5e-2b E: ロッカーを覗かない');
    t.ok(T.waterSpeedMul === 1, 'P5e-2b E: 水路で減速しない', T.waterSpeedMul);

    /* 聴覚: 同じ音イベントを E は聞き取り、基準の距離では届かない */
    var ev = { x: e.x + (B.hearMax * 1.2), z: e.z, radius: B.hearMax * 1.2 };
    t.ok(ai.hears(ev, false) === true, 'P5e-2b E: 基準の聴取距離より遠い音も聞こえる');

    /* 水路: 同じ距離を D/E は速く、F（既定 0.75）は遅く歩く */
    var wcell = null, TILE = ESCAPE.TILE;
    for (var r = 1; r < map.height - 1 && !wcell; r++) {
      for (var c = 1; c < map.width - 1; c++) {
        if (map.tileAt(c, r) === TILE.WATER && ai.territory.contains(c, r)) { wcell = { col: c, row: r }; break; }
      }
    }
    if (t.ok(!!wcell, 'P5e-2b E: 縄張りの中に水路のマスがある')) {
      a2Put(ai, wcell.col, wcell.row, 180);
      t.ok(Math.abs(ai._speedScale() - 1) < 1e-9,
        'P5e-2b E: 水路の上でも速度係数が 1（減速なし）', ai._speedScale().toFixed(3));
      var F = a2Ai(g, 'F');
      a2Put(F, wcell.col, wcell.row, 180);
      t.ok(F._speedScale() < 0.9,
        'P5e-2b E: 比較 — 既定の体（F）は水路で減速する', F._speedScale().toFixed(3));
    }

    /* 板: 倒した板の上を E は止まらずに通る（板は消費される） */
    var boards = g.stealth.boards, bd = null;
    for (var i = 0; i < boards.length; i++) {
      if (ai.territory.contains(boards[i].col, boards[i].row)) { bd = boards[i]; break; }
    }
    if (!bd && boards.length) bd = boards[0];
    if (t.ok(!!bd, 'P5e-2b E: 検証に使える板がある')) {
      bd.toppled = true; bd.used = false;
      var from = null, D4c = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var m = 0; m < 4; m++) {
        if (map.isWalkable(bd.col + D4c[m][0], bd.row + D4c[m][1])) {
          from = { col: bd.col + D4c[m][0], row: bd.row + D4c[m][1] }; break;
        }
      }
      a2Put(ai, from.col, from.row, 180);
      ai.state = 'chase'; ai.stateTime = 0;
      var tc = map.cellCenter(bd.col, bd.row), crushed0 = ai._crushed;
      for (var f = 0; f < 120 && ai.state === 'chase'; f++) {
        ai._moveTo(ESCAPE.FIXED_DT, tc.x, tc.z, T.chaseSpeed);
      }
      t.ok(ai.state !== 'stalled', 'P5e-2b E: 板で足止めされない（踏み潰して通る）', ai.state);
      t.ok(ai._crushed > crushed0, 'P5e-2b E: 踏み潰した板を数えている', ai._crushed);
      t.ok(bd.used === true, 'P5e-2b E: 踏み潰された板は消費される（再利用不可）');
      /* 比較: 既定の体（D）は同じ板で足止めされる */
      var D = a2Ai(g, 'D');
      bd.used = false;
      a2Put(D, from.col, from.row, 180);
      D.state = 'chase'; D.stateTime = 0;
      for (var f2 = 0; f2 < 120 && D.state === 'chase'; f2++) {
        D._moveTo(ESCAPE.FIXED_DT, tc.x, tc.z, D.T.chaseSpeed);
      }
      t.ok(D.state === 'stalled', 'P5e-2b E: 比較 — 既定の体は板で足止めされる', D.state);
    }

    /* 咆哮と、見失った最後の位置の再訪 */
    g.reset(); ai = a2Ai(g, 'E'); a2Solo(g, ai);
    ai.state = 'chase'; ai.form = 'stand'; ai.enemy.setForm('stand', true);
    ai._applyForm();
    t.ok(ai._roars >= 1, 'P5e-2b E: 形態遷移で咆哮が鳴る', ai._roars);
    t.near(ai.enemy.transDur, 0.80, 1e-6, 'P5e-2b E: 咆哮の遷移は 0.8 秒', ai.enemy.transDur);
    ai.lastSeen = { x: ai.enemy.x + 3, z: ai.enemy.z };
    ai._revisit = false;
    ai._pickSearchSpot();
    t.ok(Math.abs(ai.goal.x - ai.lastSeen.x) < 1e-6 && (ai.revisits || 0) >= 1,
      'P5e-2b E: 探索では見失った最後の位置そのものへ戻る', ai.revisits);
    g.reset();
  }

  /* ---- 4-5) F: 低天井での速度切替・ワイヤーを越える・聴覚最鋭・視野が狭い ---- */
  function testA2KindF(t, g) {
    g.reset();
    var ai = a2Ai(g, 'F'), T = ai.T, map = g.map;
    a2Solo(g, ai);
    t.ok(T.patrolSpeed === 1.80 && T.fovDeg === 80 && T.hearMul === 2.0,
      'P5e-2b F: 契約の数値（巡回1.8／fov80／聴覚2.0倍）',
      T.patrolSpeed + '/' + T.fovDeg + '/' + T.hearMul);
    t.ok(T.hearMul > a2Ai(g, 'E').T.hearMul, 'P5e-2b F: 聴覚は3体で最も鋭い');

    var low = a2CellIn(g, ai, function (c, r) { return map.ceilHAt(c, r) <= 2.4; });
    var high = a2CellIn(g, ai, function (c, r) { return map.ceilHAt(c, r) >= 4.3; });
    if (t.ok(!!low && !!high, 'P5e-2b F: 低天井と高天井のマスが縄張りの中にある')) {
      a2Put(ai, low.col, low.row, 180);
      var vLow = ai.chaseSpeedNow();
      a2Put(ai, high.col, high.row, 180);
      var vHigh = ai.chaseSpeedNow();
      t.ok(Math.abs(vLow - 5.80) < 1e-9, 'P5e-2b F: 低天井の支線では追跡 5.8', vLow);
      t.ok(Math.abs(vHigh - 3.60) < 1e-9, 'P5e-2b F: それ以外では追跡 3.6', vHigh);
      t.ok(vLow > ESCAPE.Player.SPEED_RUN && vHigh < ESCAPE.Player.SPEED_RUN,
        'P5e-2b F: 支線では逃げられず、幹線では逃げられる');
    }

    /* ワイヤー罠: F は引っかからず越える（他の体は屈む一拍を払う） */
    var wire = null, traps = (map.meta.traps || []);
    for (var i = 0; i < traps.length; i++) if (traps[i].kind === 'wire') { wire = traps[i]; break; }
    if (t.ok(!!wire, 'P5e-2b F: ワイヤー罠がマップにある')) {
      a2Put(ai, wire.col, wire.row, 180);
      t.ok(Math.abs(ai._speedScale() - 1) < 1e-9,
        'P5e-2b F: ワイヤーのマスでも減速しない（壁を伝って越える）', ai._speedScale().toFixed(3));
      var D = a2Ai(g, 'D');
      a2Put(D, wire.col, wire.row, 180);
      t.ok(D._speedScale() < 0.5,
        'P5e-2b F: 比較 — 他の体はワイヤーを潜る一拍を払う', D._speedScale().toFixed(3));
      t.ok(ai._wireAt(wire.col, wire.row) && !ai._wireAt(0, 0),
        'P5e-2b F: ワイヤーのマス索引は meta.traps から引いている');
    }
    g.reset();
  }

  /* ---- 4-6) 3体が同じ罠に反応し、近い順に到着する ---- */
  function testA2TrapOrder(t, g) {
    g.reset();
    var L = g.ais.list, map = g.map, i;
    /* プレイヤーは遠くのロッカーへ隠す（見つかって追跡に化けないように） */
    var sp = map.meta.spawn;
    a2Player(g, sp.col, sp.row, 0);
    /* 音源＝中央の合流槽（3体の縄張りが重なる場所の近く） */
    var src = map.cellCenter(39, 39);
    ESCAPE.noise.emit(src.x, src.z, 40, 'trap');
    a2Sim(g, 2);
    var reacted = 0, screams = 0;
    for (i = 0; i < L.length; i++) {
      if (L[i].state === 'investigate' || L[i].state === 'chase') reacted++;
      screams += L[i].screams;
    }
    t.ok(reacted === 3, 'P5e-2b 罠: 3体とも同じ罠に反応する', reacted + '/3');
    t.ok(screams >= 1, 'P5e-2b 罠: 絶叫が鳴る（P4.10 据え置き）', screams);

    /* 近い順に走り出す（P4.10 の規約: 明らかに遠い個体だけが一拍遅れる） */
    var d0 = [];
    for (i = 0; i < L.length; i++) {
      d0.push({ ai: L[i], d: g.ais.pathDistTo(L[i], src.x, src.z, false) });
    }
    d0.sort(function (a, b) { return a.d - b.d; });
    t.ok(d0[0].ai.holdT === 0, 'P5e-2b 罠: 経路距離が最も近い体は一拍も置かずに走り出す',
      d0[0].ai.kind + ' holdT=' + d0[0].ai.holdT);
    t.ok(d0[2].d - d0[0].d <= ESCAPE.ENEMY_TUNING.farReactGap || d0[2].ai.holdT > 0,
      'P5e-2b 罠: 明らかに遠い体は一拍置いてから寄る',
      d0[2].ai.kind + ' 差' + (d0[2].d - d0[0].d).toFixed(1) + 'm holdT=' + d0[2].ai.holdT.toFixed(2));
    /* 「順に到着」＝同時に着かず、時間差をもって次々に来る（距離と疾走速度の両方で決まるので
       どの体が先かは場所しだい。ここで見るのは “順に来ること” そのもの）。 */
    var order = [], arrived = {}, at = [];
    for (var f = 0; f < 5400 && order.length < 3; f++) {
      g.stepFrame(ESCAPE.FIXED_DT);
      for (i = 0; i < L.length; i++) {
        if (arrived[L[i].kind]) continue;
        if (Math.hypot(L[i].enemy.x - src.x, L[i].enemy.z - src.z) < 4.0) {
          arrived[L[i].kind] = true; order.push(L[i].kind); at.push(f);
        }
      }
    }
    t.ok(order.length >= 2, 'P5e-2b 罠: 少なくとも2体が音源へ到着する', order.join('→'));
    if (order.length >= 2) {
      t.ok(at[1] - at[0] >= 30,
        'P5e-2b 罠: 同時ではなく順に到着する（間隔0.5秒以上）',
        order.join('→') + ' @' + at.join('/') + 'フレーム');
    }
    g.reset();
  }

  /* ---- 4-7) 敵3体でも通しクリアできる（板・ロッカーで回避） ---- */
  function testA2ClearWithEnemies(t, g) {
    g.reset();
    var pr = g.progress, map = g.map;
    t.ok(g.ais.list.length === 3, 'P5e-2b 通し: 3体を凍結せずに走らせる', g.ais.list.length);
    /* ハンドル → 操作盤 → 到達パッド。敵は動いたまま（捕獲されたら復帰して続ける） */
    global.__test._place(14, 59, 270);
    global.__pump(30);
    a2PressInteract();
    t.ok(pr.gimmick.key === true, 'P5e-2b 通し: 敵3体が動いている中でハンドルを取得');
    pr._flashT = 0; pr._flashMsg = '';
    global.__test._place(68, 70, 90);
    global.__pump(10);
    a2PressInteract();
    t.ok(pr.gimmick.doorOpen === true, 'P5e-2b 通し: 水門を開放');
    global.__test._place(68, 70, 270);
    global.__pump(2);
    a2SendKey('keydown', 'KeyW');
    var frames = 0;
    while (frames < 900 && !pr.cleared) { global.__pump(1); frames++; }
    a2SendKey('keyup', 'KeyW');
    t.ok(pr.cleared === true, 'P5e-2b 通し: 敵3体のままエリア2をクリアできる', frames + 'フレーム');
    /* 板とロッカーが回避手段として生きている（板は敵を止め、ロッカーは姿を消す） */
    var bd = g.stealth.boards[0];
    t.ok(!!bd, 'P5e-2b 通し: 倒せる板がある');
    var lk = (map.meta.lockers || [])[0];
    if (t.ok(!!lk, 'P5e-2b 通し: 隠れられるロッカーがある')) {
      var c = map.cellCenter(lk.col, lk.row);
      g.player.x = c.x; g.player.z = c.z;
      var ok = g.stealth.enterLocker(lk.col, lk.row);
      t.ok(ok && g.stealth.hidden(), 'P5e-2b 通し: ロッカーに入れば敵から見えなくなる');
      g.stealth.exitLocker();
    }
    g.reset();
  }

  /* ---------------- 5) 日誌1・2の発火地点 ---------------- */
  function testA2RunDiaries(t, g) {
    g.reset();
    var pr = g.progress, wasAuto = pr.diaryAuto;
    pr.diaryAuto = true;

    var map = g.map, sp = map.meta.spawn, target = { col: 50, row: 38 };
    var d = bfs(map, sp.col, sp.row);
    if (!t.ok(d[target.row * map.width + target.col] >= 0,
      'P5 段階2 日誌: spawnから日誌2の地点(50,38)へ到達できる')) {
      pr.diaryAuto = wasAuto; g.reset(); return;
    }
    var idxPath = pathBack(map, d, target.col, target.row);
    var path = [];
    for (var i = 0; i < idxPath.length; i++) {
      var k = idxPath[i], c = k % map.width, r = (k - c) / map.width;
      path.push({ col: c, row: r });
    }

    var diary1Seen = false, diary2Seen = false, unexpected = [];
    a2WalkPath(g, path, function (id) {
      if (id === 'a2_diary1') {
        diary1Seen = true;
        var mt1 = document.getElementById('memo-title');
        t.ok(!!mt1 && mt1.textContent === '作業員の日誌', 'P5 段階2 日誌1: 表示タイトルが正文',
          mt1 && mt1.textContent);
        var b1 = ((document.getElementById('memo-body') || {}).textContent || '').split('\n')[0];
        t.ok(b1 === '梯子を降りた。上の隔壁は、もう開かない。', 'P5 段階2 日誌1: 本文1行目が正文', b1);
      } else if (id === 'a2_diary2') {
        diary2Seen = true;
        var mt2 = document.getElementById('memo-title');
        t.ok(!!mt2 && mt2.textContent === '作業員の日誌', 'P5 段階2 日誌2: 表示タイトルが正文',
          mt2 && mt2.textContent);
        var b2 = ((document.getElementById('memo-body') || {}).textContent || '').split('\n')[0];
        t.ok(b2 === 'ポンプ室に降りる。ここが一番低い。', 'P5 段階2 日誌2: 本文1行目が正文', b2);
      } else {
        unexpected.push(id);
      }
    });
    t.ok(diary1Seen, 'P5 段階2 日誌1: スタート区画を出た瞬間に自動表示された（経路上で）');
    t.ok(diary2Seen, 'P5 段階2 日誌2: (50,38) 到達で自動表示された');
    t.ok(unexpected.length === 0, 'P5 段階2 日誌: 想定外のメモは開かなかった', unexpected.join(','));

    /* 再訪では開かない（各1回だけ）: 短い区間だけ歩き直して確かめる */
    var reopened1 = 0;
    a2WalkPath(g, [{ col: 9, row: 9 }, { col: 9, row: 10 }, { col: 9, row: 11 }],
      function () { reopened1++; });
    t.ok(reopened1 === 0, 'P5 段階2 日誌1: 部屋を出直しても再表示されない', reopened1);

    var prev = path[path.length - 2];
    var reopened2 = 0;
    a2WalkPath(g, [prev, target], function () { reopened2++; });
    t.ok(reopened2 === 0, 'P5 段階2 日誌2: 同じマスに再度入っても再表示されない', reopened2);

    pr.diaryAuto = wasAuto;
    g.reset();
  }

  /* ---------------- 本体 ---------------- */
  function runArea2(opts) {
    var t = new A2Runner();
    var g = ESCAPE.game;
    if (!t.ok(!!g, 'P5 段階2: ゲームが初期化されている')) {
      return global.Promise ? global.Promise.resolve(a2Summarize(t)) : a2Summarize(t);
    }
    if (g.mapId !== 'area2') {
      t.ok(false, 'runArea2 は ?area=area2 のページで実行せよ（現在: ' + g.mapId + '）');
      return global.Promise ? global.Promise.resolve(a2Summarize(t)) : a2Summarize(t);
    }

    /* 実行前の localStorage 全キーを控える（契約: 実行後はキー集合も値も元どおり） */
    var lsBefore = Object.create(null);
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        lsBefore[k] = global.localStorage.getItem(k);
      }
    } catch (e0) { /* localStorage 無効環境は対象外 */ }
    var areaBefore = ESCAPE.currentArea ? ESCAPE.currentArea() : g.mapId;

    var TITLE = ESCAPE.Title, WAKE = ESCAPE.Wake;
    if (TITLE && TITLE.skip) TITLE.skip();
    if (WAKE && WAKE.skip) WAKE.skip();
    var au = ESCAPE.audio;
    var audioWasTest = au ? au.testMode : false;
    if (au) { au.testMode = true; au.panic(); }

    try {
      testA2RunLuma(t, g);
      testA2RunPlaythrough(t, g);
      testA2RunWater(t, g);
      testA2Enemies(t, g);
      testA2StateMachine(t, g);
      testA2KindD(t, g);
      testA2KindE(t, g);
      testA2KindF(t, g);
      testA2TrapOrder(t, g);
      testA2ClearWithEnemies(t, g);
      testA2RunDiaries(t, g);
    } catch (err) {
      t.ok(false, 'runArea2 実行中に例外', err && (err.message || String(err)));
    }

    /* ---------------- 後始末: 製品初期状態へ完全復帰 ---------------- */
    g.reset();
    if (au) au.testMode = audioWasTest;
    if (TITLE && TITLE.restore) TITLE.restore();

    try {
      var cur = Object.create(null), kk;
      for (i = 0; i < global.localStorage.length; i++) cur[global.localStorage.key(i)] = true;
      for (kk in cur) if (!(kk in lsBefore)) global.localStorage.removeItem(kk);
      for (kk in lsBefore) global.localStorage.setItem(kk, lsBefore[kk]);
    } catch (e1) { /* 無視 */ }

    t.ok((ESCAPE.currentArea ? ESCAPE.currentArea() : g.mapId) === areaBefore,
      'P5 段階2 復帰: escape.area が実行前のまま', areaBefore);
    t.ok(g.progress ? g.progress.modal === null : true, 'P5 段階2 復帰: モーダルが閉じている');
    var sp2 = g.map.meta.spawn;
    t.ok(g.player.col() === sp2.col && g.player.row() === sp2.row,
      'P5 段階2 復帰: プレイヤーが spawn にいる',
      g.player.col() + ',' + g.player.row() + ' vs ' + sp2.col + ',' + sp2.row);

    return global.Promise ? global.Promise.resolve(a2Summarize(t)) : a2Summarize(t);
  }

  ESCAPE.__runArea2 = runArea2;
})(window);
