/* ESCAPE — 機械テスト基盤（契約 DESIGN.md §6）
 *   window.__test.runAll()  : 全アサート実行 → 実行後は製品初期状態へ完全復帰
 *   window.__pump(n)        : 手動フレーム駆動（js/game.js で定義。更新＋描画ワンセット）
 * バグ修正1件につき同類全検出のアサートを1つ追加すること。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var EPS = 1e-6;

  /* 未処理のPromise拒否とスクリプトエラーを常時監視する。
   * （requestPointerLock が Promise を返す環境で未処理拒否がコンソールに出た件の再発防止。
   *   同類＝「非同期APIの失敗を握り潰し損ねる」バグを全て検出する） */
  var runtimeErrors = { rejections: [], errors: [] };
  global.addEventListener('unhandledrejection', function (e) {
    runtimeErrors.rejections.push(String((e.reason && (e.reason.message || e.reason.name)) || e.reason));
  });
  global.addEventListener('error', function (e) {
    runtimeErrors.errors.push(String(e.message || e.error));
  });

  function Runner() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
  }
  Runner.prototype.ok = function (cond, name, detail) {
    var r = { name: name, pass: !!cond, detail: detail === undefined ? '' : String(detail) };
    this.results.push(r);
    if (r.pass) this.passed++; else this.failed++;
    return r.pass;
  };
  Runner.prototype.near = function (a, b, tol, name) {
    return this.ok(Math.abs(a - b) <= tol, name, 'got ' + a + ' expected ' + b + ' ±' + tol);
  };

  /* ---------------- 個々のテスト ---------------- */

  function testContract(t, g) {
    t.ok(ESCAPE.TILE_SIZE === 2.0, '契約: 1マス=2m', ESCAPE.TILE_SIZE);
    t.ok(g.map.tileSize === 2.0, '契約: マップの tileSize が2m', g.map.tileSize);
    t.ok(typeof global.__pump === 'function', '__pump が存在');
    t.ok(ESCAPE.FIXED_DT > 0 && ESCAPE.FIXED_DT <= 1 / 30, '固定タイムステップが妥当', ESCAPE.FIXED_DT);
  }

  function testMapData(t, g) {
    var errs = g.map.validate();
    t.ok(errs.length === 0, 'マップ定義の静的検証', errs.join(' / '));
    t.ok(g.map.width >= 20 && g.map.height >= 20, 'テスト迷路は20x20以上', g.map.width + 'x' + g.map.height);

    // 行き止まり（歩行可能な隣接が1つだけ）が存在する＝迷路として成立
    var dead = 0, cells = g.map.walkableCells();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], n = 0;
      if (g.map.isWalkable(c.col + 1, c.row)) n++;
      if (g.map.isWalkable(c.col - 1, c.row)) n++;
      if (g.map.isWalkable(c.col, c.row + 1)) n++;
      if (g.map.isWalkable(c.col, c.row - 1)) n++;
      if (n === 1) dead++;
    }
    t.ok(dead >= 3, '行き止まりが3か所以上ある', dead + '箇所');

    // 小部屋（3x3以上の開けた領域）が存在する
    var room = false;
    for (var r = 1; r < g.map.height - 1 && !room; r++) {
      for (var c2 = 1; c2 < g.map.width - 1 && !room; c2++) {
        var all = true;
        for (var dr = 0; dr < 3 && all; dr++) {
          for (var dc = 0; dc < 3 && all; dc++) {
            if (!g.map.isWalkable(c2 + dc, r + dr)) all = false;
          }
        }
        if (all) room = true;
      }
    }
    t.ok(room, '3x3以上の小部屋がある');
  }

  function testReachability(t, g) {
    var sp = g.map.meta.spawn;
    var seen = g.map.floodFrom(sp.col, sp.row);
    var cells = g.map.walkableCells();
    var missing = [];
    for (var i = 0; i < cells.length; i++) {
      if (!seen[cells[i].col + ',' + cells[i].row]) missing.push(cells[i].col + ',' + cells[i].row);
    }
    t.ok(missing.length === 0, 'flood-fill: 全歩行可能マスが spawn から到達可能',
      cells.length + 'マス中 未到達' + missing.length + ' ' + missing.slice(0, 8).join(' '));
  }

  function testCollisionMatchesData(t, g) {
    var p = g.player, map = g.map;
    var badSolid = 0, badFloor = 0;
    for (var r = 0; r < map.height; r++) {
      for (var c = 0; c < map.width; c++) {
        var ctr = map.cellCenter(c, r);
        var hit = p.collidesAt(ctr.x, ctr.z);
        if (map.isSolid(c, r)) { if (!hit) badSolid++; }
        else { if (hit) badFloor++; }
      }
    }
    t.ok(badSolid === 0, '壁データとコリジョン整合: 実体マス中心は必ず衝突', badSolid + '件不一致');
    t.ok(badFloor === 0, '壁データとコリジョン整合: 床マス中心は衝突しない', badFloor + '件不一致');
  }

  function testSpawn(t, g) {
    var sp = g.map.meta.spawn;
    t.ok(g.map.inBounds(sp.col, sp.row), 'スポーンが場内');
    t.ok(g.map.isWalkable(sp.col, sp.row), 'スポーンが歩行可能マス');
    g.player.reset();
    t.ok(!g.player.collidesAt(g.player.x, g.player.z), 'スポーン位置で壁に埋まっていない');
    var ctr = g.map.cellCenter(sp.col, sp.row);
    t.near(g.player.x, ctr.x, 1e-9, 'スポーンX=マス中心');
    t.near(g.player.z, ctr.z, 1e-9, 'スポーンZ=マス中心');
    // スポーンから動ける向きが1つ以上ある
    var open = 0;
    if (g.map.isWalkable(sp.col + 1, sp.row)) open++;
    if (g.map.isWalkable(sp.col - 1, sp.row)) open++;
    if (g.map.isWalkable(sp.col, sp.row + 1)) open++;
    if (g.map.isWalkable(sp.col, sp.row - 1)) open++;
    t.ok(open >= 1, 'スポーンから出られる隣接マスがある', open);
  }

  /* 入力を直接組んで n ステップ進める（本番と同じ Player.step を通る） */
  function drive(g, opt, steps) {
    var dt = ESCAPE.FIXED_DT;
    for (var i = 0; i < steps; i++) {
      g.player.step(dt, opt);
    }
  }

  function place(g, col, row, yawDeg) {
    var c = g.map.cellCenter(col, row);
    g.player.x = c.x; g.player.z = c.z;
    g.player.yaw = (yawDeg || 0) * Math.PI / 180;
    g.player.pitch = 0;
  }

  function testSpeeds(t, g) {
    var room = g.map.meta.openRoomCenter || { col: 15, row: 15 };
    var dt = ESCAPE.FIXED_DT, steps = Math.round(0.5 / dt);
    var modes = [
      { name: '歩き', cmd: { moveX: 0, moveY: 1, run: false, crouch: false } },
      { name: '走り', cmd: { moveX: 0, moveY: 1, run: true, crouch: false } },
      { name: 'しゃがみ', cmd: { moveX: 0, moveY: 1, run: false, crouch: true } }
    ];
    var out = {};
    for (var i = 0; i < modes.length; i++) {
      place(g, room.col, room.row, -90);   // yaw=-90° → 前方は +X
      var x0 = g.player.x;
      g.player.crouching = false;
      g.player.eyeHeight = ESCAPE.Player.EYE_STAND;
      drive(g, modes[i].cmd, steps);
      var d = g.player.x - x0;
      out[modes[i].name] = d / (steps * dt);
      t.ok(Math.abs(g.player.z - g.map.cellCenter(room.col, room.row).z) < 1e-6,
        modes[i].name + ': 横滑りしない', g.player.z);
    }
    t.near(out['歩き'], ESCAPE.Player.SPEED_WALK, 0.02, '歩き速度の実測');
    t.near(out['走り'], ESCAPE.Player.SPEED_RUN, 0.02, '走り速度の実測');
    t.near(out['しゃがみ'], ESCAPE.Player.SPEED_CROUCH, 0.02, 'しゃがみ速度の実測');
    t.ok(out['歩き'] < out['走り'], '歩き < 走り', out['歩き'].toFixed(3) + ' < ' + out['走り'].toFixed(3));
    t.ok(out['しゃがみ'] < out['歩き'], 'しゃがみ < 歩き', out['しゃがみ'].toFixed(3) + ' < ' + out['歩き'].toFixed(3));
    t._speeds = out;
  }

  function testCrouchEye(t, g) {
    g.player.reset();
    drive(g, { moveX: 0, moveY: 0, run: false, crouch: true }, 60);
    t.near(g.player.eyeHeight, ESCAPE.Player.EYE_CROUCH, 0.02, 'しゃがみで視点が下がる');
    drive(g, { moveX: 0, moveY: 0, run: false, crouch: false }, 60);
    t.near(g.player.eyeHeight, ESCAPE.Player.EYE_STAND, 0.02, '立ちで視点が戻る');
    t.ok(ESCAPE.Player.EYE_CROUCH < ESCAPE.Player.EYE_STAND, 'しゃがみ視点 < 立ち視点');
  }

  /* 全ての「床マス→隣接する壁マス」方向へ押し込み、壁抜けが起きないことを確認 */
  function testWallPush(t, g) {
    var map = g.map, p = g.player, r = p.radius, T = map.tileSize;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var pen = 0, over = 0, checked = 0, worst = 0;
    var cells = map.walkableCells();
    for (var i = 0; i < cells.length; i++) {
      for (var d = 0; d < 4; d++) {
        var c = cells[i], dc = dirs[d][0], dr = dirs[d][1];
        if (!map.isSolid(c.col + dc, c.row + dr)) continue;
        checked++;
        place(g, c.col, c.row, 0);
        // 走り速度で0.5秒ぶん壁へ押し込む（yawではなく直接ベクトルで）
        var steps = 30, dt = ESCAPE.FIXED_DT, sp = ESCAPE.Player.SPEED_RUN;
        for (var s = 0; s < steps; s++) p.moveBy(dc * sp * dt, dr * sp * dt);
        if (p.collidesAt(p.x, p.z)) pen++;
        if (map.isSolid(map.colOf(p.x), map.rowOf(p.z))) over++;
        // 壁面までの距離が半径以上あること
        var faceGap;
        if (dc === 1) faceGap = (c.col + 1) * T - p.x;
        else if (dc === -1) faceGap = p.x - c.col * T;
        else if (dr === 1) faceGap = (c.row + 1) * T - p.z;
        else faceGap = p.z - c.row * T;
        if (faceGap < r - 1e-4) worst = Math.max(worst, r - faceGap);
      }
    }
    t.ok(checked > 50, '壁押し込み検査の対象が十分ある', checked + '方向');
    t.ok(pen === 0, '壁抜けなし: 押し込み後に壁と重ならない', pen + '件');
    t.ok(over === 0, '壁抜けなし: 押し込み後に実体マスへ侵入していない', over + '件');
    t.ok(worst === 0, '壁面から半径ぶん離れている', '最大めり込み ' + worst.toFixed(5) + 'm');
  }

  /* 壁ずり移動: 壁へ斜めに押し当てると、壁方向は止まり接線方向は進む */
  function testWallSlide(t, g) {
    var map = g.map, p = g.player, T = map.tileSize;
    // 北が壁・東が床 の床マスを探す
    var target = null, cells = map.walkableCells();
    for (var i = 0; i < cells.length && !target; i++) {
      var c = cells[i];
      if (map.isSolid(c.col, c.row - 1) && map.isWalkable(c.col + 1, c.row)) target = c;
    }
    if (!t.ok(!!target, '壁ずり検証に使えるマスがある')) return;
    place(g, target.col, target.row, 0);
    var z0 = p.z, x0 = p.x;
    var dt = ESCAPE.FIXED_DT, sp = ESCAPE.Player.SPEED_WALK;
    var k = Math.SQRT1_2;
    for (var s = 0; s < 60; s++) p.moveBy(k * sp * dt, -k * sp * dt);
    t.ok(p.x - x0 > 0.5, '壁ずり: 接線方向に進む', (p.x - x0).toFixed(3) + 'm');
    t.ok(p.z < z0, '壁ずり: 壁方向にも寄れている', (z0 - p.z).toFixed(3) + 'm');
    var face = target.row * T + p.radius;
    t.ok(p.z >= face - 1e-9 && p.z < face + 0.06, '壁ずり: 壁面で正しく停止',
      'z=' + p.z.toFixed(4) + ' 期待 ' + face.toFixed(4) + '〜' + (face + 0.06).toFixed(4));
    t.ok(!p.collidesAt(p.x, p.z), '壁ずり: 壁と重なっていない');
  }

  /* 全方位スイープ: 迷路内を高速で走り回っても実体マスへ入らない */
  function testSweep(t, g) {
    var map = g.map, p = g.player;
    var bad = 0, outOfBounds = 0, dt = ESCAPE.FIXED_DT, sp = ESCAPE.Player.SPEED_RUN;
    var starts = [map.meta.spawn, map.meta.openRoomCenter || { col: 15, row: 15 }];
    for (var si = 0; si < starts.length; si++) {
      for (var a = 0; a < 32; a++) {
        place(g, starts[si].col, starts[si].row, 0);
        var ang = a * Math.PI * 2 / 32;
        var dx = Math.cos(ang), dz = Math.sin(ang);
        for (var s = 0; s < 240; s++) {
          p.moveBy(dx * sp * dt, dz * sp * dt);
          if (p.collidesAt(p.x, p.z)) bad++;
          if (p.x < 0 || p.z < 0 || p.x > map.width * map.tileSize || p.z > map.height * map.tileSize) outOfBounds++;
        }
      }
    }
    t.ok(bad === 0, '全方位スイープ: 壁と重なる瞬間がない', bad + '件');
    t.ok(outOfBounds === 0, '全方位スイープ: マップ外に出ない', outOfBounds + '件');
  }

  function testLook(t, g) {
    g.player.reset();
    var y0 = g.player.yaw;
    g.player.applyLook(100, 0, ESCAPE.Input.LOOK_SENS);
    t.ok(Math.abs(g.player.yaw - y0) > 1e-4, '視点: 横スワイプでyawが変わる');
    g.player.applyLook(0, 100000, ESCAPE.Input.LOOK_SENS);
    t.ok(g.player.pitch >= -ESCAPE.Player.PITCH_LIMIT - EPS, '視点: pitch下限クランプ', g.player.pitch);
    g.player.applyLook(0, -200000, ESCAPE.Input.LOOK_SENS);
    t.ok(g.player.pitch <= ESCAPE.Player.PITCH_LIMIT + EPS, '視点: pitch上限クランプ', g.player.pitch);
    g.player.applyLook(NaN, NaN, ESCAPE.Input.LOOK_SENS);
    t.ok(isFinite(g.player.yaw) && isFinite(g.player.pitch), '視点: NaN入力で角度が壊れない');
    g.player.reset();
  }

  /* __pump が「更新＋描画ワンセット」であること */
  function testPump(t, g) {
    g.reset();
    var f0 = g.frameCount;
    var r0 = g.renderCount;
    var d0 = g.renderer.info.render.frame;
    global.__pump(5);
    t.ok(g.frameCount - f0 === 5, '__pump(5) で5ステップ更新される', g.frameCount - f0);
    t.ok(g.renderCount - r0 === 5, '__pump(5) で5回描画される', g.renderCount - r0);
    t.ok(g.renderer.info.render.frame - d0 === 5, '__pump(5) でWebGL描画が5回走る',
      g.renderer.info.render.frame - d0);
    t.near(g.simTime, 5 * ESCAPE.FIXED_DT, 1e-9, '__pump のシミュレーション時間');

    // 入力→__pump→移動 の実経路（入力オブジェクト経由）
    g.reset();
    var x0 = g.player.x, z0 = g.player.z;
    g.input.moveY = 1;
    global.__pump(30);
    var moved = Math.hypot(g.player.x - x0, g.player.z - z0);
    t.ok(moved > 0.5, '入力→__pump で実際に移動する', moved.toFixed(3) + 'm');
    t.ok(!g.player.collidesAt(g.player.x, g.player.z), '移動後に壁と重なっていない');
    g.input.reset();

    // 「調べる」が押下として消化される
    var n0 = g.stats.interacts;
    g.input.interactQueued = 2;
    global.__pump(1);
    t.ok(g.stats.interacts - n0 === 2, '調べる押下がステップで消化される', g.stats.interacts - n0);
    t.ok(g.input.interactQueued === 0, '調べるキューが消費されている');
  }

  function testDomWiring(t, g) {
    var ids = ['view', 'stick-base', 'stick-knob', 'btn-run', 'btn-crouch', 'btn-interact', 'orientation'];
    var missing = [];
    for (var i = 0; i < ids.length; i++) if (!document.getElementById(ids[i])) missing.push(ids[i]);
    t.ok(missing.length === 0, 'UI要素が揃っている', missing.join(','));
    t.ok(g.viewW > 0 && g.viewH > 0, 'ビューポートサイズが正', g.viewW + 'x' + g.viewH);
    t.ok(isFinite(g.camera.aspect) && g.camera.aspect > 0, 'カメラのアスペクトが有限', g.camera.aspect);
    // ポインタロックはヘッドレスでは許可されないため、API結線と失敗時の安全性のみ確認する
    t.ok(typeof g.canvas.requestPointerLock === 'function', 'ポインタロックAPIが使える');
    t.ok('pointerLockElement' in document, 'pointerLockElement を参照できる');
    var threw = false, ret;
    try { ret = g.input.requestPointerLock(); } catch (err) { threw = true; }
    t.ok(!threw && typeof ret === 'boolean', 'ポインタロック要求が例外を投げない', ret);
    t.ok(runtimeErrors.rejections.length === 0, '未処理のPromise拒否がない',
      runtimeErrors.rejections.slice(0, 3).join(' / '));
    t.ok(runtimeErrors.errors.length === 0, '未捕捉のスクリプトエラーがない',
      runtimeErrors.errors.slice(0, 3).join(' / '));
  }

  function testRenderedWallsMatchData(t, g) {
    var bad = 0, wc = g.world.wallCells;
    for (var i = 0; i < wc.length; i++) {
      if (!g.map.isSolid(wc[i].col, wc[i].row)) bad++;
    }
    t.ok(bad === 0, '描画された壁が全て実体マス上にある', bad + '件');
    t.ok(wc.length > 0, '壁メッシュが生成されている', wc.length + '個');
  }

  /* エリア1の数値ゲート（契約 DESIGN.md §3）。後続フェーズが変更しても area1 自体の
   * 造形基準が壊れていないかを常に検査できるよう、g.map ではなく 'area1' を明示ロードする。 */
  function testArea1Contract(t) {
    var map = ESCAPE.Maps.load('area1');
    var TILE = ESCAPE.TILE;

    t.ok(map.width >= 55 && map.height >= 55, 'area1: 55x55マス以上', map.width + 'x' + map.height);

    var cells = map.walkableCells();
    t.ok(cells.length >= 900, 'area1: 歩行可能900マス以上', cells.length + 'マス');

    var sp = map.meta.spawn;
    var seen = map.floodFrom(sp.col, sp.row);
    var missing = [];
    for (var i = 0; i < cells.length; i++) {
      var k = cells[i].col + ',' + cells[i].row;
      if (!seen[k]) missing.push(k);
    }
    t.ok(missing.length === 0, 'area1: flood-fillで全歩行可能マスがspawnから到達可能',
      cells.length + 'マス中 未到達' + missing.length + ' ' + missing.slice(0, 8).join(' '));

    function degree(c, r) {
      var n = 0;
      if (map.isWalkable(c + 1, r)) n++;
      if (map.isWalkable(c - 1, r)) n++;
      if (map.isWalkable(c, r + 1)) n++;
      if (map.isWalkable(c, r - 1)) n++;
      return n;
    }
    var junctions = 0, deadends = 0;
    for (var j = 0; j < cells.length; j++) {
      var d = degree(cells[j].col, cells[j].row);
      if (d >= 3) junctions++;
      if (d === 1) deadends++;
    }
    t.ok(junctions >= 35, 'area1: 三叉路以上の分岐交差点が35箇所以上', junctions + '箇所');
    t.ok(deadends >= 12, 'area1: 行き止まりが12箇所以上', deadends + '箇所');

    /* 主要地点の参照整合: 存在しないマスを指さない・全て到達可能。
     * 実体マス（メモ・仕掛け・ロッカー・扉）は「隣接する歩行可能マスが到達可能」、
     * 歩行可能マス（板・チェックポイント・拘束室）は「そのマス自体が到達可能」で判定する。 */
    function checkSolidPoints(name, list, expectTile) {
      var bad = [];
      for (var p = 0; p < list.length; p++) {
        var e = list[p];
        if (!map.inBounds(e.col, e.row)) { bad.push(e.col + ',' + e.row + ':場外'); continue; }
        if (map.tileAt(e.col, e.row) !== expectTile) { bad.push(e.col + ',' + e.row + ':種別不一致'); continue; }
        var reach = seen[(e.col + 1) + ',' + e.row] || seen[(e.col - 1) + ',' + e.row] ||
          seen[e.col + ',' + (e.row + 1)] || seen[e.col + ',' + (e.row - 1)];
        if (!reach) bad.push(e.col + ',' + e.row + ':隣接到達不可');
      }
      t.ok(bad.length === 0, 'area1: ' + name + 'の参照整合', bad.join(' / '));
    }
    function checkWalkablePoints(name, list, expectTile) {
      var bad = [];
      for (var p = 0; p < list.length; p++) {
        var e = list[p];
        if (!map.inBounds(e.col, e.row)) { bad.push(e.col + ',' + e.row + ':場外'); continue; }
        if (map.tileAt(e.col, e.row) !== expectTile) { bad.push(e.col + ',' + e.row + ':種別不一致'); continue; }
        if (!seen[e.col + ',' + e.row]) bad.push(e.col + ',' + e.row + ':到達不可');
      }
      t.ok(bad.length === 0, 'area1: ' + name + 'の参照整合', bad.join(' / '));
    }

    checkSolidPoints('メモ', map.meta.notes || [], TILE.NOTE);
    checkSolidPoints('仕掛け', map.meta.gimmicks || [], TILE.GIMMICK);
    checkWalkablePoints('板', map.meta.boards || [], TILE.BOARD);
    checkSolidPoints('ロッカー', map.meta.lockers || [], TILE.LOCKER);
    checkWalkablePoints('チェックポイント', map.meta.checkpoints || [], TILE.CHECKPOINT);
    checkWalkablePoints('拘束室(牢)', map.meta.cells || [], TILE.CELL);

    var doorBad = [];
    var door = map.meta.door;
    if (!door || !map.inBounds(door.col, door.row) || map.tileAt(door.col, door.row) !== TILE.DOOR) {
      doorBad.push('door不正');
    } else {
      var dReach = seen[(door.col + 1) + ',' + door.row] || seen[(door.col - 1) + ',' + door.row] ||
        seen[door.col + ',' + (door.row + 1)] || seen[door.col + ',' + (door.row - 1)];
      if (!dReach) doorBad.push('door隣接到達不可');
    }
    var exitPad = map.meta.exitPad;
    if (!exitPad || !map.inBounds(exitPad.col, exitPad.row) || !seen[exitPad.col + ',' + exitPad.row]) {
      doorBad.push('exitPad不正/到達不可');
    }
    t.ok(doorBad.length === 0, 'area1: 出口(隔壁扉・前面パッド)の参照整合', doorBad.join(' / '));

    /* 拘束室（牢）の重心がマップ中心±20%以内 */
    var cellList = map.meta.cells || [];
    var sx = 0, sy = 0;
    for (var ci = 0; ci < cellList.length; ci++) { sx += cellList[ci].col; sy += cellList[ci].row; }
    var cx = sx / cellList.length, cy = sy / cellList.length;
    var midC = (map.width - 1) / 2, midR = (map.height - 1) / 2;
    var tolC = map.width * 0.2, tolR = map.height * 0.2;
    t.ok(Math.abs(cx - midC) <= tolC, 'area1: 拘束室の重心（列）がマップ中心±20%以内',
      'cx=' + cx.toFixed(1) + ' 中心=' + midC + ' 許容=±' + tolC.toFixed(1));
    t.ok(Math.abs(cy - midR) <= tolR, 'area1: 拘束室の重心（行）がマップ中心±20%以内',
      'cy=' + cy.toFixed(1) + ' 中心=' + midR + ' 許容=±' + tolR.toFixed(1));

    /* 床高さの隣接不連続ゼロ（GridMap.validate() も内部で呼ぶが単独でも明示検査する） */
    var seams = map.heightSeams();
    t.ok(seams.length === 0, 'area1: 床高さの隣接不連続がゼロ', seams.slice(0, 5).join(' / '));

    /* 通路の直線見通し: 12マス超の直線は、meta宣言済みの長廊下等に限り4本以内・最長20マス */
    function longRuns() {
      var out = [];
      for (var r = 0; r < map.height; r++) {
        var c = 0;
        while (c < map.width) {
          if (map.isWalkable(c, r)) {
            var start = c;
            while (c < map.width && map.isWalkable(c, r)) c++;
            if (c - start > 12) out.push({ c0: start, c1: c - 1, r0: r, r1: r });
          } else c++;
        }
      }
      for (var col = 0; col < map.width; col++) {
        var rr = 0;
        while (rr < map.height) {
          if (map.isWalkable(col, rr)) {
            var start2 = rr;
            while (rr < map.height && map.isWalkable(col, rr)) rr++;
            if (rr - start2 > 12) out.push({ c0: col, c1: col, r0: start2, r1: rr - 1 });
          } else rr++;
        }
      }
      return out;
    }
    var runs = longRuns();
    t.ok(runs.length <= 4, 'area1: 12マス超の直線見通しは長廊下等4本以内', runs.length + '本');
    var over20 = 0;
    for (var ri = 0; ri < runs.length; ri++) {
      var len = Math.max(runs[ri].c1 - runs[ri].c0, runs[ri].r1 - runs[ri].r0) + 1;
      if (len > 20) over20++;
    }
    t.ok(over20 === 0, 'area1: 長廊下の最長は20マス以内', over20 + '本が超過');

    var regions = map.meta.regions || [];
    var undeclared = 0;
    for (var rj = 0; rj < runs.length; rj++) {
      var run = runs[rj], covered = false;
      for (var rk = 0; rk < regions.length; rk++) {
        var reg = regions[rk];
        if (run.c0 >= reg.c0 && run.c1 <= reg.c1 && run.r0 >= reg.r0 && run.r1 <= reg.r1) { covered = true; break; }
      }
      if (!covered) undeclared++;
    }
    t.ok(undeclared === 0, 'area1: 12マス超の直線は全てmeta.regionsで宣言済み', undeclared + '本が未宣言');
  }

  /* ================================================================
   * P3b: 敵AI・ステルス機構（契約 DESIGN.md §4 / §6）
   * ============================================================== */

  /** 本番と同じ1論理ステップを n 回（stepFrame は敵AIまで含む） */
  function sim(g, n) {
    var dt = ESCAPE.FIXED_DT;
    for (var i = 0; i < n; i++) g.stepFrame(dt);
  }
  /** 条件が満たされるまで進める。満たせたフレーム数、駄目なら -1 */
  function simUntil(g, cond, maxFrames) {
    var dt = ESCAPE.FIXED_DT;
    for (var i = 0; i < maxFrames; i++) {
      if (cond()) return i;
      g.stepFrame(dt);
    }
    return cond() ? maxFrames : -1;
  }
  /** 敵をマスに置いて経路を捨てる */
  function placeEnemy(g, col, row, yawDeg) {
    g.ai.enemy.placeCell(col, row, yawDeg === undefined ? 180 : yawDeg, g.map);
    g.ai.path = null; g.ai.goal = null; g.ai.repathT = 0;
  }
  /** 直線で並ぶ3マス（間が壁 / 間が床）を探す */
  function findTriple(map, wallBetween) {
    var cells = map.walkableCells();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var midSolid = map.isSolid(c.col + 1, c.row);
      if (!map.isWalkable(c.col + 2, c.row)) continue;
      if (wallBetween ? midSolid : !midSolid) return c;
    }
    return null;
  }
  /** (col,row) へ2マス手前から直進で入れる開始点を探す */
  function approachTo(map, col, row) {
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var dc = D[i][0], dr = D[i][1];
      if (!map.isWalkable(col + dc, row + dr)) continue;
      if (!map.isWalkable(col + dc * 2, row + dr * 2)) continue;
      /* 開始点から (col,row) へ向く yaw（forward = (-sin,-cos)） */
      var yaw = Math.atan2(dc, dr) * 180 / Math.PI;
      return { col: col + dc * 2, row: row + dr * 2, yawDeg: yaw };
    }
    return null;
  }

  function testEnemyTuning(t, g) {
    var T = ESCAPE.ENEMY_TUNING;
    if (!t.ok(!!T, '敵AI: バランス定数が1オブジェクトに集約されている')) return;
    t.ok(T.chaseSpeed > ESCAPE.Player.SPEED_RUN, '敵AI: 追跡速度がプレイヤー走りより速い',
      T.chaseSpeed + ' > ' + ESCAPE.Player.SPEED_RUN);
    t.ok(T.patrolSpeed < ESCAPE.Player.SPEED_WALK, '敵AI: 巡回速度は歩きより遅い', T.patrolSpeed);
    t.near(T.fovDeg, 110, 1e-9, '敵AI: 視野角110度');
    t.near(T.sightLit, 12, 1e-9, '敵AI: 明所の発見距離12m');
    t.near(T.sightDark, 5, 1e-9, '敵AI: 暗所の発見距離5m');
    t.near(T.crouchFactor, 0.40, 1e-9, '敵AI: しゃがみで発見距離40%');
    t.near(T.searchDur, 8, 1e-9, '敵AI: 探索8秒で巡回へ復帰');
    t.ok(T.captureLimit === 3, '敵AI: 同一エリア3回目の捕獲でエリア最初から', T.captureLimit);
    t.ok(!!g.ai && !!g.ai.enemy, '敵AI: area1で敵1体が常時稼働');
    t.ok(!!g.ai && g.ai.enemy.group.visible, '敵AI: 敵がシーンに出ている');
    t.ok(typeof ESCAPE.noise.emit === 'function', '音イベントAPI ESCAPE.noise.emit(x,z,radius) が存在');
    t.ok(typeof ESCAPE.noise.emitCell === 'function', '音イベントAPI emitCell が存在');
  }

  function testPatrolData(t, g) {
    var map = ESCAPE.Maps.load('area1'), meta = map.meta;
    var route = meta.patrol || [];
    t.ok(route.length >= 4, 'area1: 巡回路が4地点以上ある', route.length + '地点');
    var seen = map.floodFrom(meta.spawn.col, meta.spawn.row);
    var bad = [];
    for (var i = 0; i < route.length; i++) {
      var n = route[i];
      if (!map.isWalkable(n.col, n.row) || !seen[n.col + ',' + n.row]) bad.push(n.col + ',' + n.row);
    }
    t.ok(bad.length === 0, 'area1: 巡回地点が全て歩行可能かつ到達可能', bad.join(' / '));
    var sp = meta.enemySpawn;
    t.ok(!!sp && map.isWalkable(sp.col, sp.row) && seen[sp.col + ',' + sp.row],
      'area1: 敵スポーンが歩行可能かつ到達可能');
    /* 巡回起点は拘束室から離す（契約: 牢送り直後に鉢合わせない） */
    var cells = meta.cells || [], cx = 0, cz = 0;
    for (var j = 0; j < cells.length; j++) { cx += cells[j].col; cz += cells[j].row; }
    cx /= cells.length; cz /= cells.length;
    var d = Math.hypot(sp.col - cx, sp.row - cz) * map.tileSize;
    t.ok(d >= 20, 'area1: 敵スポーンが拘束室から20m以上離れている', d.toFixed(1) + 'm');
    /* センサー・板は壁付きの造形（表示灯/ビーム・立てかけた板）を持てる位置にあること。
       壁が無いマスに置くと造形が丸ごと描かれず「見えない罠」になる（P3bで実際に踏んだ不具合の同類検出）。 */
    var noWall = [];
    var lists = [['センサー', meta.sensors || []], ['板', meta.boards || []]];
    for (var li = 0; li < lists.length; li++) {
      for (var mi = 0; mi < lists[li][1].length; mi++) {
        var e2 = lists[li][1][mi];
        if (!g.world._wallDirOf(e2.col, e2.row)) noWall.push(lists[li][0] + '(' + e2.col + ',' + e2.row + ')');
      }
    }
    t.ok(noWall.length === 0, 'area1: センサー・板が壁付きの造形を持てる位置にある', noWall.join(' / '));

    var jc = meta.jailCell;
    t.ok(!!jc && map.tileAt(jc.col, jc.row) === ESCAPE.TILE.CELL, 'area1: 牢送り先が拘束室(CELL)マス');
    /* 鉄格子のある房は通り抜け不可・破られた房だけ通れる（描画と当たりの整合） */
    var barred = 0, openable = 0, cellsList = meta.cells || [];
    for (var ci = 0; ci < cellsList.length; ci++) {
      var cc2 = cellsList[ci];
      var isOpen = false, oc2 = meta.cellOpenings || [];
      for (var oi = 0; oi < oc2.length; oi++) if (oc2[oi].col === cc2.col && oc2[oi].row === cc2.row) isOpen = true;
      if (g.map.isBlocked(cc2.col, cc2.row)) barred++;
      if (isOpen && !g.map.isBlocked(cc2.col, cc2.row)) openable++;
    }
    t.ok(barred === cellsList.length - (meta.cellOpenings || []).length,
      'area1: 鉄格子のある房は当たり判定でも通れない', barred + '房');
    t.ok(openable === (meta.cellOpenings || []).length, 'area1: 破られた房は通れる', openable + '房');
    /* 実際に押し込んでも房に入れないこと */
    var barCell = null;
    for (var bi = 0; bi < cellsList.length && !barCell; bi++) {
      if (g.map.isBlocked(cellsList[bi].col, cellsList[bi].row)) barCell = cellsList[bi];
    }
    if (barCell) {
      var D2 = [[1, 0], [-1, 0], [0, 1], [0, -1]], from = null;
      for (var di = 0; di < 4; di++) {
        var nc2 = barCell.col + D2[di][0], nr2 = barCell.row + D2[di][1];
        if (g.map.isWalkable(nc2, nr2) && !g.map.isBlocked(nc2, nr2) &&
            g.map.tileAt(nc2, nr2) !== ESCAPE.TILE.CELL) { from = { c: nc2, r: nr2, d: D2[di] }; }
      }
      if (from) {
        place(g, from.c, from.r, 0);
        for (var s2 = 0; s2 < 40; s2++) g.player.moveBy(-from.d[0] * 0.08, -from.d[1] * 0.08);
        t.ok(!(g.player.col() === barCell.col && g.player.row() === barCell.row),
          'area1: 鉄格子を押しても房に入れない', g.player.col() + ',' + g.player.row());
        g.player.reset();
      }
    }
    var opened = false, oc = meta.cellOpenings || [];
    for (var k = 0; k < oc.length; k++) if (oc[k].col === jc.col && oc[k].row === jc.row) opened = true;
    t.ok(opened, 'area1: 牢送り先は「破られた房」＝出る動線がある');
  }

  function testVision(t, g) {
    g.reset();
    var ai = g.ai, T = ESCAPE.ENEMY_TUNING;
    /* 見通しのある3マス: 4m先のプレイヤーは（暗所の5mでも）見える */
    var open = findTriple(g.map, false);
    if (t.ok(!!open, '視界検証に使える見通しの3マスがある')) {
      placeEnemy(g, open.col, open.row, -90);          /* yaw -90° → 前方は +X */
      place(g, open.col + 2, open.row, 0);
      g.player.crouching = false;
      t.ok(ai.canSeePlayer(), '視界: 正面4mのプレイヤーを見つける');
      /* 視野角の外（真後ろ）は見えない */
      placeEnemy(g, open.col, open.row, 90);
      t.ok(!ai.canSeePlayer(), '視界: 視野角の外（背後）は見つけない');
      /* しゃがみは発見距離が大幅に減る */
      placeEnemy(g, open.col, open.row, -90);
      var rStand = ai.sightRange();
      g.player.crouching = true;
      var rCrouch = ai.sightRange();
      g.player.crouching = false;
      t.near(rCrouch / rStand, T.crouchFactor, 1e-6, '視界: しゃがみで発見距離が40%になる');
      t.ok(rCrouch < rStand, '視界: しゃがみ距離 < 立ち距離', rCrouch.toFixed(2) + ' < ' + rStand.toFixed(2));
    }
    /* 壁越しには見えない */
    var wall = findTriple(g.map, true);
    if (t.ok(!!wall, '視界検証に使える壁ごしの3マスがある')) {
      placeEnemy(g, wall.col, wall.row, -90);
      place(g, wall.col + 2, wall.row, 0);
      t.ok(!ai.canSeePlayer(), '視界: 壁越しには見つからない（遮蔽レイキャスト）');
    }
    /* ロッカー内は不可視 */
    var lockers = g.map.meta.lockers || [], lk = null, side = null;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < lockers.length && !lk; i++) {
      for (var d = 0; d < 4; d++) {
        var nc = lockers[i].col + D[d][0], nr = lockers[i].row + D[d][1];
        if (g.map.isWalkable(nc, nr)) { lk = lockers[i]; side = { col: nc, row: nr }; break; }
      }
    }
    if (t.ok(!!lk, '視界検証に使えるロッカーがある')) {
      place(g, side.col, side.row, 0);
      g.player.yaw = Math.atan2(-(lk.col - side.col), -(lk.row - side.row));
      placeEnemy(g, side.col, side.row, 0);
      g.ai.enemy.x = g.player.x + 1.6; g.ai.enemy.z = g.player.z;
      g.ai.enemy.facing = Math.PI / 2;          /* 前方 -X ＝ プレイヤーの方を向く */
      t.ok(ai.canSeePlayer(), '視界: ロッカーに入る前は見つかる（前提）');
      t.ok(g.stealth.onInteract(), 'ロッカー: 「調べる」で入れる');
      t.ok(g.stealth.inLocker(), 'ロッカー: 中に入っている');
      t.ok(!ai.canSeePlayer(), '視界: ロッカー内は不可視');
      /* 中では移動できない */
      var lx = g.player.x, lz = g.player.z;
      g.input.moveY = 1;
      sim(g, 30);
      g.input.reset();
      t.ok(Math.hypot(g.player.x - lx, g.player.z - lz) < 1e-6, 'ロッカー: 中では移動できない');
      t.ok(g.stealth.onInteract(), 'ロッカー: 「調べる」で出られる');
      t.ok(!g.stealth.inLocker(), 'ロッカー: 外に出ている');
      t.ok(!g.player.collidesAt(g.player.x, g.player.z), 'ロッカー: 出た先で壁に埋まっていない');
    }
    /* 暗所では発見距離が落ちる */
    var dark = { col: 4, row: 22 }, lit = { col: 7, row: 46 };
    place(g, dark.col, dark.row, 0);
    var rDark = ai.sightRange();
    place(g, lit.col, lit.row, 0);
    var rLit = ai.sightRange();
    t.ok(rDark <= T.sightDark + 0.3, '視界: 暗い区画では発見距離が5m相当まで落ちる', rDark.toFixed(2) + 'm');
    t.ok(rLit >= 9.0, '視界: 明るい区画では発見距離が伸びる', rLit.toFixed(2) + 'm');
    t.ok(rLit > rDark + 3, '視界: 明所 > 暗所', rLit.toFixed(2) + ' > ' + rDark.toFixed(2));
    g.reset();
  }

  function testNoiseEvents(t, g) {
    var TILE = ESCAPE.TILE, ai = g.ai, st = g.stealth;

    /* 音地盤: 走って踏むと敵が調査に来る / 歩きでは無音 */
    function runOver(col, row, running) {
      g.reset();
      var ap = approachTo(g.map, col, row);
      if (!ap) return null;
      /* 敵は音は届くが姿は見えない位置に置く（壁越し） */
      var target = g.map.cellCenter(col, row);
      var start = g.map.cellCenter(ap.col, ap.row);
      var cells = g.map.walkableCells(), spot = null;
      for (var i = 0; i < cells.length && !spot; i++) {
        var c = g.map.cellCenter(cells[i].col, cells[i].row);
        var d = Math.hypot(c.x - target.x, c.z - target.z);
        if (d < 6 || d > 15) continue;
        if (!ai.blockedLine(c.x, c.z, target.x, target.z)) continue;
        if (!ai.blockedLine(c.x, c.z, start.x, start.z)) continue;
        spot = cells[i];
      }
      if (!spot) return null;
      placeEnemy(g, spot.col, spot.row, 0);
      ai.state = 'patrol'; ai.stateTime = 0;
      place(g, ap.col, ap.row, ap.yawDeg);
      g.input.moveY = 1;
      g.input._keyRun = !!running;
      var frames = simUntil(g, function () {
        return g.player.col() === col && g.player.row() === row;
      }, 200);
      sim(g, 2);
      g.input.reset();
      return { frames: frames, state: ai.state };
    }

    var noiseCell = null, list = g.map.meta.noise || [];
    for (var i = 0; i < list.length && !noiseCell; i++) {
      if (approachTo(g.map, list[i].col, list[i].row)) noiseCell = list[i];
    }
    if (t.ok(!!noiseCell, '音地盤の検証に使えるマスがある')) {
      var r1 = runOver(noiseCell.col, noiseCell.row, true);
      if (t.ok(!!r1 && r1.frames >= 0, '音地盤: 走って踏むまで実移動できた')) {
        t.ok(st.noiseSteps === 1, '音地盤: 走って踏むと音イベントが1回鳴る', st.noiseSteps);
        t.ok(r1.state === 'investigate', '音地盤: 走って踏むと敵が調査状態になる', r1.state);
      }
      var r2 = runOver(noiseCell.col, noiseCell.row, false);
      if (t.ok(!!r2 && r2.frames >= 0, '音地盤: 歩いて踏むまで実移動できた')) {
        t.ok(st.noiseSteps === 0, '音地盤: 歩き（走らない）は無音', st.noiseSteps);
        t.ok(r2.state === 'patrol', '音地盤: 歩きでは敵は巡回のまま', r2.state);
      }
    }

    /* センサー: 走って通ると警報 / 歩けば鳴らない */
    var sensors = g.map.meta.sensors || [], sc = null;
    for (var j = 0; j < sensors.length && !sc; j++) {
      if (approachTo(g.map, sensors[j].col, sensors[j].row)) sc = sensors[j];
    }
    if (t.ok(!!sc, 'センサーの検証に使えるマスがある')) {
      t.ok(g.map.tileAt(sc.col, sc.row) === TILE.SENSOR, 'センサー: タイル種別が SENSOR');
      var r3 = runOver(sc.col, sc.row, true);
      if (t.ok(!!r3 && r3.frames >= 0, 'センサー: 走って通過するまで実移動できた')) {
        t.ok(st.alarms === 1, 'センサー: 走って通ると警報が鳴る', st.alarms);
        t.ok(r3.state === 'investigate', 'センサー: 警報で敵が調査に来る', r3.state);
      }
      var r4 = runOver(sc.col, sc.row, false);
      if (t.ok(!!r4 && r4.frames >= 0, 'センサー: 歩いて通過するまで実移動できた')) {
        t.ok(st.alarms === 0, 'センサー: 歩けば警報は鳴らない', st.alarms);
      }
    }

    /* P4向けAPI: 任意地点の音で調査に来る */
    g.reset();
    var e = ai.enemy;
    ESCAPE.noise.emit(e.x + 4, e.z, 20, 'gimmick');
    sim(g, 1);
    t.ok(ai.state === 'investigate', '音API: ESCAPE.noise.emit で調査状態になる', ai.state);
    /* 遠すぎる音は聞こえない */
    g.reset();
    ESCAPE.noise.emit(ai.enemy.x + 60, ai.enemy.z + 60, 4, 'far');
    sim(g, 1);
    t.ok(ai.state === 'patrol', '音API: 半径外の音には反応しない', ai.state);
    g.reset();
  }

  function testEnemyStateMachine(t, g) {
    g.reset();
    var ai = g.ai, st = g.stealth, T = ESCAPE.ENEMY_TUNING;
    t.ok(ai.state === 'patrol', '状態機械: 初期は巡回', ai.state);
    t.ok(ai.form === 'stand', '状態機械: 巡回は直立形態', ai.form);

    var x0 = ai.enemy.x, z0 = ai.enemy.z;
    sim(g, 180);
    var moved = Math.hypot(ai.enemy.x - x0, ai.enemy.z - z0);
    t.ok(moved > 1.0, '状態機械: 巡回で経路上を歩く', moved.toFixed(2) + 'm');
    t.ok(ai.state === 'patrol', '状態機械: 誰も居なければ巡回のまま', ai.state);

    /* 調査 */
    ESCAPE.noise.emit(ai.enemy.x + 5, ai.enemy.z + 2, 20, 'test');
    sim(g, 1);
    t.ok(ai.state === 'investigate', '状態機械: 巡回 → 調査', ai.state);

    /* 追跡（見通しのある3マスで正面に立つ） */
    var open = findTriple(g.map, false);
    placeEnemy(g, open.col, open.row, -90);
    place(g, open.col + 2, open.row, 0);
    g.player.crouching = false;
    sim(g, 1);
    t.ok(ai.state === 'chase', '状態機械: 発見で追跡へ', ai.state);
    t.ok(ai.form === 'crawl', '状態機械: 追跡は反転形態へ遷移する', ai.form);
    t.ok(ai.enemy.state === 'trans' || ai.enemy.poseT > 0, '状態機械: 形態遷移が始まっている',
      ai.enemy.state + ' poseT=' + ai.enemy.poseT.toFixed(2));
    /* 遷移が完走して反転形態になる（毎フレーム更新で上書きされない）。
       完了判定は poseT ではなくアニメ状態で見る（transTime の丸め誤差で
       poseT は1フレーム早く 1 に到達しうる） */
    var done = simUntil(g, function () { return ai.enemy.state !== 'trans'; }, 200);
    t.ok(done >= 0, '状態機械: 形態遷移が完走して反転形態になる', 'poseT=' + ai.enemy.poseT.toFixed(3));
    t.near(ai.enemy.poseT, 1, 1e-9, '状態機械: 反転形態のポーズになりきる');
    t.ok(ai.enemy.state === 'chase', '状態機械: 反転形態では疾走アニメになる',
      ai.enemy.state + ' / AI=' + ai.state + ' / frames=' + done + ' / poseT=' + ai.enemy.poseT.toFixed(3) +
      ' / jail=' + st.jail.phase);

    /* 捕獲 → 牢送り */
    g.progress.flags.p3bTest = 'keep';
    place(g, open.col, open.row, 0);
    g.player.x = ai.enemy.x + 0.55; g.player.z = ai.enemy.z;
    sim(g, 1);
    t.ok(st.captures === 1, '状態機械: 接触で捕獲される', st.captures);
    t.ok(st.jail.phase === 'grab', '状態機械: 牢送り演出が始まる', st.jail.phase);
    t.ok(ai.state === 'caught', '状態機械: 捕獲中の敵は停止する', ai.state);
    /* 演出中の再捕獲は無視される（重なり対策） */
    t.ok(st.capture() === false, '牢送り: 演出中の再捕獲は無視される');
    t.ok(st.captures === 1, '牢送り: 演出中の再捕獲で回数が増えない', st.captures);

    var toLocked = simUntil(g, function () { return st.jail.phase === 'locked'; }, 240);
    t.ok(toLocked >= 0, '状態機械: 暗転を経て拘束室で復帰する', st.jail.phase);
    var jc = g.map.meta.jailCell;
    t.ok(g.player.col() === jc.col && g.player.row() === jc.row, '牢送り: 拘束室の房の中で復帰する',
      g.player.col() + ',' + g.player.row());
    t.ok(g.progress.flags.p3bTest === 'keep', '牢送り: 進行状態が保持される');
    t.ok(ai.state === 'patrol' && ai.form === 'stand', '牢送り: 敵は直立形態で巡回へ戻る',
      ai.state + '/' + ai.form);
    t.ok(Math.abs(g.stealth.fade - 1) < 0.35 || g.stealth.fade < 1, '牢送り: 明転していく', g.stealth.fade);

    /* 房から出られない → 「調べる」連打で格子を破る */
    var px = g.player.x, pz = g.player.z;
    g.input.moveY = 1;
    sim(g, 60);
    g.input.reset();
    t.ok(g.player.col() === jc.col && g.player.row() === jc.row, '牢: 格子を破るまで房から出られない');
    var presses = 0;
    while (st.jail.phase === 'locked' && presses < 12) { st.onInteract(); presses++; }
    t.ok(st.jail.phase === 'none', '牢: 「調べる」連打で脱出できる', presses + '回');
    t.ok(st.escapes === 1, '牢: 自力脱出が記録される', st.escapes);
    g.input.moveY = 1;
    var out = simUntil(g, function () { return g.player.row() !== jc.row || g.player.col() !== jc.col; }, 200);
    g.input.reset();
    t.ok(out >= 0, '牢: 脱出後は房から出て動ける',
      g.player.col() + ',' + g.player.row());
    t.ok(g.progress.flags.p3bTest === 'keep', '牢: 脱出後も進行状態は保持されている');
    g.reset();
  }

  function testBoardStall(t, g) {
    g.reset();
    var ai = g.ai, st = g.stealth, T = ESCAPE.ENEMY_TUNING;
    var boards = g.map.meta.boards || [];
    t.ok(boards.length > 0, '板: 配置がある', boards.length + '枚');
    /* 巡回路（縦長廊下）上の板を使う */
    var b = null;
    for (var i = 0; i < boards.length; i++) if (boards[i].col === 34 && boards[i].row === 26) b = boards[i];
    if (!b) b = boards[0];
    var rec = st.boardAt(b.col, b.row);
    /* 隣接マスから「調べる」で倒す */
    var ap = approachTo(g.map, b.col, b.row);
    if (!t.ok(!!ap && !!rec, '板: 検証に使える板がある')) return;
    place(g, b.col + (ap.col - b.col) / 2, b.row + (ap.row - b.row) / 2, ap.yawDeg);
    t.ok(g.stealth.onInteract(), '板: 「調べる」で倒せる');
    t.ok(rec.toppled === true, '板: 倒れた状態になる');
    t.ok(st.topples === 1, '板: 倒した回数が記録される', st.topples);

    /* 敵が経路上で踏む → 足止め */
    placeEnemy(g, b.col, b.row - 4, 180);
    var far = g.map.cellCenter(b.col, b.row + 6);
    place(g, b.col, b.row + 6, 0);
    if (!g.map.isWalkable(b.col, b.row + 6)) place(g, b.col, b.row + 3, 0);
    ai.toChase();
    var hit = simUntil(g, function () { return ai.state === 'stalled'; }, 600);
    t.ok(hit >= 0, '板: 敵が倒れた板に引っかかって足止めされる', ai.state);
    var ex = ai.enemy.x, ez = ai.enemy.z;
    sim(g, 60);
    t.ok(Math.hypot(ai.enemy.x - ex, ai.enemy.z - ez) < 0.02, '板: 足止め中は動かない',
      Math.hypot(ai.enemy.x - ex, ai.enemy.z - ez).toFixed(4) + 'm');
    t.ok(rec.used === true, '板: 使い切り（一度踏むと消費される）');
    t.ok(st.tripBoard(b.col, b.row) === false, '板: 二度目は足止めしない');
    var free = simUntil(g, function () { return ai.state !== 'stalled'; }, 700);
    t.ok(free >= 0, '板: 一定時間で足止めが解ける', ai.state);
    /* 上で 60 フレーム（＝1秒）進めているぶんを足す */
    var stalledSec = (free + 60) * ESCAPE.FIXED_DT;
    t.ok(stalledSec >= T.boardStallDur - 0.2 && stalledSec <= T.boardStallDur + 0.4,
      '板: 足止め時間が調整値どおり', stalledSec.toFixed(2) + 's / ' + T.boardStallDur + 's');
    g.reset();
    t.ok(st.boards[0].toppled === false, '板: リセットで元に戻る');
  }

  function testCaptureLimit(t, g) {
    g.reset();
    var st = g.stealth, ai = g.ai, T = ESCAPE.ENEMY_TUNING;
    g.progress.flags.keepMe = 1;
    for (var i = 0; i < T.captureLimit - 1; i++) {
      t.ok(st.capture(), '捕獲' + (i + 1) + '回目: 牢送りが始まる');
      var toLocked = simUntil(g, function () { return st.jail.phase === 'locked'; }, 240);
      t.ok(toLocked >= 0, '捕獲' + (i + 1) + '回目: 拘束室で復帰する', st.jail.phase);
      var guard = 0;
      while (st.jail.phase === 'locked' && guard++ < 12) st.onInteract();
      t.ok(st.jail.phase === 'none', '捕獲' + (i + 1) + '回目: 自力脱出できる');
    }
    t.ok(g.progress.flags.keepMe === 1, '牢送り（3回目未満）は進行状態を保持する');
    t.ok(st.captures === T.captureLimit - 1, '捕獲回数が積み上がる', st.captures);

    /* 3回目 = エリア最初から（チェックポイントは無関係） */
    t.ok(st.capture(), '捕獲3回目: 発生する');
    var done = simUntil(g, function () { return st.jail.phase === 'none'; }, 400);
    t.ok(done >= 0, '捕獲3回目: 暗転を経て復帰する', st.jail.phase);
    t.ok(st.areaResets === 1, '捕獲3回目: エリアがリセットされる', st.areaResets);
    t.ok(st.captures === 0, '捕獲3回目: 捕獲回数がリセットされる', st.captures);
    t.ok(!g.progress.flags.keepMe, '捕獲3回目: 進行状態がクリアされる');
    var sp = g.map.meta.spawn;
    t.ok(g.player.col() === sp.col && g.player.row() === sp.row, '捕獲3回目: エリア最初のスポーンへ戻る',
      g.player.col() + ',' + g.player.row());
    t.ok(ai.state === 'patrol' && ai.form === 'stand', '捕獲3回目: 敵も初期状態へ戻る', ai.state);
    t.ok(st.fade === 0, '捕獲3回目: 暗転が明けている', st.fade);
    g.reset();
  }

  function testChaseGiveUp(t, g) {
    g.reset();
    var ai = g.ai, T = ESCAPE.ENEMY_TUNING;
    var open = findTriple(g.map, false);
    placeEnemy(g, open.col, open.row, -90);
    place(g, open.col + 2, open.row, 0);
    sim(g, 1);
    t.ok(ai.state === 'chase', '見失い: まず追跡状態にする', ai.state);
    /* プレイヤーを遠くの別区画へ飛ばす（＝完全に見失う） */
    var sp = g.map.meta.spawn;
    place(g, sp.col, sp.row, 0);
    var toSearch = simUntil(g, function () { return ai.state === 'search'; }, 400);
    t.ok(toSearch >= 0, '見失い: 一定時間で追跡をやめて探索へ', ai.state);
    var toPatrol = simUntil(g, function () { return ai.state === 'patrol'; },
      Math.round(T.searchDur / ESCAPE.FIXED_DT) + 180);
    t.ok(toPatrol >= 0, '見失い: 探索の後は巡回へ復帰する', ai.state);
    var back = simUntil(g, function () { return ai.form === 'stand' && ai.enemy.poseT < 1e-6; }, 240);
    t.ok(back >= 0, '見失い: 直立形態へ戻る', 'poseT=' + ai.enemy.poseT.toFixed(3));
    g.reset();
  }

  /** 演出の途中で割り込みが入っても状態が壊れないこと */
  function testInterruptSafety(t, g) {
    g.reset();
    var st = g.stealth, ai = g.ai;
    st.capture();
    sim(g, 20);                        /* 暗転の途中 */
    t.ok(st.jail.phase !== 'none', '割り込み: 演出中である（前提）', st.jail.phase);
    t.ok(st.onInteract() === true, '割り込み: 演出中の「調べる」は握り潰される');
    t.ok(st.jail.pry === 0, '割り込み: 演出中はこじ開けが進まない', st.jail.pry);
    /* 演出の途中で reset（runAll と同じ経路） */
    g.reset();
    t.ok(st.jail.phase === 'none', '割り込み: リセットで牢演出が解除される', st.jail.phase);
    t.ok(st.fade === 0, '割り込み: リセットで暗転が消える', st.fade);
    t.ok(st.captures === 0, '割り込み: リセットで捕獲回数が戻る', st.captures);
    var sp = g.map.meta.spawn;
    t.ok(g.player.col() === sp.col && g.player.row() === sp.row, '割り込み: リセットでスポーンに戻る');
    /* ロッカーに入ったまま捕獲されない・リセットで出る */
    var lockers = g.map.meta.lockers || [];
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var lk = null, side = null;
    for (var i = 0; i < lockers.length && !lk; i++) {
      for (var d = 0; d < 4; d++) {
        var nc = lockers[i].col + D[d][0], nr = lockers[i].row + D[d][1];
        if (g.map.isWalkable(nc, nr)) { lk = lockers[i]; side = { col: nc, row: nr }; break; }
      }
    }
    place(g, side.col, side.row, 0);
    g.player.yaw = Math.atan2(-(lk.col - side.col), -(lk.row - side.row));
    st.onInteract();
    t.ok(st.inLocker(), '割り込み: ロッカーに入っている（前提）');
    t.ok(st.capture() === false, '割り込み: ロッカー内では捕獲されない');
    g.ai.enemy.x = g.player.x; g.ai.enemy.z = g.player.z;
    ai.state = 'chase';
    sim(g, 5);
    t.ok(st.captures === 0, '割り込み: 敵が重なっても捕獲されない', st.captures);
    g.reset();
    t.ok(!st.inLocker(), '割り込み: リセットでロッカーから出る');
  }

  /** __enemyDebug（P3a）と敵AIの両立 */
  function testEnemyDebugCoexist(t, g) {
    g.reset();
    if (!t.ok(typeof global.__enemyDebug === 'object', '__enemyDebug が存在する')) return;
    var e = global.__enemyDebug.get();
    t.ok(e === g.ai.enemy, '__enemyDebug: AIの個体を操作対象にする（2体作らない）');
    var info = global.__enemyDebug.info();
    t.ok(typeof info.triangles === 'number' && typeof info.poseT === 'number',
      '__enemyDebug: info のシグネチャが維持されている');
    global.__enemyDebug.setPose(1);
    t.ok(g.ai.manual === true, '__enemyDebug: 直接操作するとAIの駆動が止まる');
    sim(g, 30);
    t.near(e.poseT, 1, 1e-9, '__enemyDebug: AIにポーズを上書きされない');
    global.__enemyDebug.release();
    t.ok(g.ai.manual === false, '__enemyDebug: release でAIへ操作が戻る');
    g.reset();
  }

  /* ---------------- 実行本体 ---------------- */

  function runAll(opts) {
    var g = ESCAPE.game;
    var t = new Runner();
    if (!g) {
      t.ok(false, 'ゲームが初期化されている');
      return summarize(t);
    }

    // 実行前スナップショット（＝製品初期状態）
    g.reset();
    var snap = {
      x: g.player.x, z: g.player.z, yaw: g.player.yaw, pitch: g.player.pitch,
      eye: g.player.eyeHeight, crouch: g.player.crouching, interacts: g.stats.interacts
    };

    var suites = [
      testContract, testMapData, testReachability, testCollisionMatchesData, testSpawn,
      testDomWiring, testRenderedWallsMatchData, testSpeeds, testCrouchEye,
      testWallPush, testWallSlide, testSweep, testLook, testPump, testArea1Contract,
      /* P3b: 敵AI・ステルス */
      testEnemyTuning, testPatrolData, testVision, testNoiseEvents, testEnemyStateMachine,
      testBoardStall, testCaptureLimit, testChaseGiveUp, testInterruptSafety, testEnemyDebugCoexist
    ];
    for (var i = 0; i < suites.length; i++) {
      try {
        suites[i](t, g);
      } catch (err) {
        t.ok(false, suites[i].name + ' で例外', err && err.message);
      }
    }

    // 製品初期状態へ完全復帰
    g.reset();
    t.near(g.player.x, snap.x, 1e-9, '復帰: プレイヤーX');
    t.near(g.player.z, snap.z, 1e-9, '復帰: プレイヤーZ');
    t.near(g.player.yaw, snap.yaw, 1e-9, '復帰: yaw');
    t.near(g.player.pitch, snap.pitch, 1e-9, '復帰: pitch');
    t.near(g.player.eyeHeight, snap.eye, 1e-9, '復帰: 視点高');
    t.ok(g.player.crouching === snap.crouch, '復帰: しゃがみ解除');
    t.ok(g.stats.interacts === snap.interacts, '復帰: 調べる回数');
    t.ok(g.input.moveX === 0 && g.input.moveY === 0, '復帰: 移動入力ゼロ');
    t.ok(g.input.lookDX === 0 && g.input.lookDY === 0, '復帰: 視点入力ゼロ');
    t.ok(g.input.crouchOn === false && g.input.isRunning() === false, '復帰: ボタン状態オフ');
    t.ok(g.running === true, '復帰: ループが動作中');
    /* P3b: 敵AI・ステルスも製品初期状態へ戻ること */
    if (g.ai) {
      var esp = g.map.meta.enemySpawn, ec = g.map.cellCenter(esp.col, esp.row);
      t.ok(g.ai.state === 'patrol' && g.ai.form === 'stand', '復帰: 敵が巡回・直立形態', g.ai.state);
      t.ok(g.ai.manual === false, '復帰: 敵AIがデバッグ操作から戻っている');
      t.near(Math.hypot(g.ai.enemy.x - ec.x, g.ai.enemy.z - ec.z), 0, 1e-6, '復帰: 敵が巡回起点にいる');
      t.near(g.ai.enemy.poseT, 0, 1e-9, '復帰: 敵の形態が直立');
    }
    if (g.stealth) {
      var upAll = true;
      for (var bi = 0; bi < g.stealth.boards.length; bi++) {
        if (g.stealth.boards[bi].toppled || g.stealth.boards[bi].used) upAll = false;
      }
      t.ok(g.stealth.captures === 0 && g.stealth.jail.phase === 'none', '復帰: 捕獲・牢の状態が初期化',
        g.stealth.captures + '/' + g.stealth.jail.phase);
      t.ok(g.stealth.fade === 0 && !g.stealth.inLocker(), '復帰: 暗転もロッカーも解除');
      t.ok(upAll, '復帰: 倒した板が元に戻る');
      t.ok(ESCAPE.noise.pending.length === 0, '復帰: 音イベントのキューが空', ESCAPE.noise.pending.length);
    }

    return summarize(t, opts);
  }

  function summarize(t, opts) {
    var quiet = opts && opts.quiet;
    var out = { passed: t.passed, failed: t.failed, total: t.results.length, results: t.results, speeds: t._speeds };
    if (!quiet && global.console) {
      var fails = [];
      for (var i = 0; i < t.results.length; i++) if (!t.results[i].pass) fails.push(t.results[i]);
      console.log('[__test] ' + t.passed + '/' + t.results.length + ' 通過, 失敗 ' + t.failed);
      for (var j = 0; j < fails.length; j++) {
        console.error('[__test] FAIL: ' + fails[j].name + ' — ' + fails[j].detail);
      }
    }
    return out;
  }

  global.__test = {
    runAll: runAll,
    /** 個別デバッグ用 */
    _place: function (col, row, yawDeg) { place(ESCAPE.game, col, row, yawDeg); ESCAPE.game.syncCamera(); }
  };
})(window);
