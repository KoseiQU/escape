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
      testWallPush, testWallSlide, testSweep, testLook, testPump, testArea1Contract
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
