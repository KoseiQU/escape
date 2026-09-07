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
    /* P4.8: 仕掛けは金庫(GIMMICK)と北の隔壁(DOOR)の2つ。種別が違うので個別に見る */
    var gimBad = [];
    var gimList = map.meta.gimmicks || [];
    for (var gi = 0; gi < gimList.length; gi++) {
      var ge = gimList[gi];
      var want = (ge.role === 'bulkhead') ? TILE.DOOR : TILE.GIMMICK;
      if (!map.inBounds(ge.col, ge.row)) { gimBad.push(ge.id + ':場外'); continue; }
      if (map.tileAt(ge.col, ge.row) !== want) { gimBad.push(ge.id + ':種別不一致'); continue; }
      var gReach = seen[(ge.col + 1) + ',' + ge.row] || seen[(ge.col - 1) + ',' + ge.row] ||
        seen[ge.col + ',' + (ge.row + 1)] || seen[ge.col + ',' + (ge.row - 1)];
      if (!gReach) gimBad.push(ge.id + ':隣接到達不可');
    }
    t.ok(gimBad.length === 0, 'area1: 仕掛けの参照整合', gimBad.join(' / '));
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
  /** P4.6: 捕獲シネマティック（7〜9秒）が終わって牢/ゲームオーバーに落ち着くまで進める */
  function simCapture(g, extra) {
    var dur = (g.cinematic && g.cinematic.totalDur)
      ? g.cinematic.totalDur(g.stealth.jail.reset ? 'eaten' : 'jail') : 3;
    var frames = Math.ceil(dur / ESCAPE.FIXED_DT) + 120 + (extra || 0);
    return simUntil(g, function () {
      return g.stealth.jail.phase === 'locked' || g.stealth.jail.phase === 'over';
    }, frames);
  }

  /** 実際の追跡→接触で捕獲まで持っていく（pre = 事前の捕獲回数） */
  function startCapture(g, pre) {
    g.reset();
    if (pre) g.stealth.captures = pre;
    var open = findTriple(g.map, false);
    placeEnemy(g, open.col, open.row, -90);
    place(g, open.col + 2, open.row, 0);
    g.player.crouching = false;
    sim(g, 1);
    g.player.x = g.ai.enemy.x + 0.55; g.player.z = g.ai.enemy.z;
    sim(g, 1);
    return g.stealth.jail.phase === 'grab';
  }

  /** 演出の段階ごとの所要時間を実測する */
  function traceCinematic(g, maxFrames) {
    var cine = g.cinematic;
    var out = { seq: [], durs: {}, frames: 0, camDrag: null, camGrab: null,
      handsSeen: false, mawSeen: false, lampsSeen: false, shoulderSeen: false,
      carryLightSeen: false, camCarryY: 0,
      redEyesSeen: false, triPeak: 0, fovGrab: 0 };
    var last = cine.stage, n = 0;
    for (var i = 0; i < maxFrames; i++) {
      if (cine.stage !== last) {
        out.seq.push(last);
        out.durs[last] = n * ESCAPE.FIXED_DT;
        last = cine.stage; n = 0;
        if (last === 'none') break;
      }
      var e = g.ai.enemy;
      if (e.redEyesVisible()) out.redEyesSeen = true;
      out.triPeak = Math.max(out.triPeak, e.activeTriangles());
      if (cine.stage === 'grab') {
        if (e.grabHands && e.grabHands.visible) out.handsSeen = true;
        out.camGrab = { x: g.camera.position.x, y: g.camera.position.y, z: g.camera.position.z };
        out.fovGrab = g.camera.fov;
      }
      if (cine.stage === 'maw' && e.maw && e.maw.group.visible) out.mawSeen = true;
      if (cine.stage === 'drag') {
        if (cine.lamps && cine.lamps.visible) out.lampsSeen = true;
        /* P4.12 項目3: 担ぎ運び（敵の肩と髪／演出用ヘッドライト） */
        if (cine.shoulder && cine.shoulder.visible) out.shoulderSeen = true;
        if (cine.headlightOn && cine.headlightOn()) out.carryLightSeen = true;
        out.camCarryY = g.camera.position.y - g.map.floorYAt(g.camera.position.x, g.camera.position.z);
        out.camDrag = { x: g.camera.position.x, y: g.camera.position.y, z: g.camera.position.z };
      }
      g.stepFrame(ESCAPE.FIXED_DT);
      n++; out.frames++;
    }
    return out;
  }

  /** 直線で並ぶ3マス（間が壁 / 間が床）を探す。
   *  P4.7: 音地盤・しゃがみ専用通路は「普通の通路」ではないので除く
   *  （保管庫の硝子片・排水路が row1-2 に増えて先頭に来るようになったため）。 */
  function findTriple(map, wallBetween) {
    var cells = map.walkableCells(), TILE = ESCAPE.TILE;
    function plain(c, r) {
      return map.tileAt(c, r) === TILE.FLOOR && !(map.isCrawl && map.isCrawl(c, r));
    }
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (!plain(c.col, c.row)) continue;
      var midSolid = map.isSolid(c.col + 1, c.row);
      if (!map.isWalkable(c.col + 2, c.row) || !plain(c.col + 2, c.row)) continue;
      if (!wallBetween && !plain(c.col + 1, c.row)) continue;
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
  /** (col,row) に隣接する歩行可能マスから、それへ向く yaw で立てる位置を返す（P4: 調べる範囲の検証用。
   *  approachTo は「2マス手前から直進で入れる」ことまで要求するため、1マス四方しか
   *  歩行可能マスがない壁付きの仕掛け（隔壁ハンドル等）では使えない） */
  function adjacentTo(map, col, row) {
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var dc = D[i][0], dr = D[i][1];
      if (!map.isWalkable(col + dc, row + dr)) continue;
      var yaw = Math.atan2(dc, dr) * 180 / Math.PI;
      return { col: col + dc, row: row + dr, yawDeg: yaw };
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
      /* P4.6: 入る瞬間を見られると敵が開けに来る（駆け引き）。
         ここは移動ロックの検証なので敵を巡回起点へ退かしてから測る
         （見られた場合の挙動は testLockerSeen が受け持つ） */
      var esp0 = g.map.meta.enemySpawn;
      placeEnemy(g, esp0.col, esp0.row, 180);
      ai.lockerTarget = null;
      ai.toPatrol();
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
    /* 暗所では発見距離が落ちる。基準マスは meta から取る（マップ差し替えに強くする） */
    /* 漆黒区画（非常灯すら置かない区間）の中心を使う＝確実に暗い */
    var dz = (g.map.meta.blackZones || g.map.meta.darkZones || [])[0];
    var dark = { col: Math.round((dz.c0 + dz.c1) / 2), row: Math.round((dz.r0 + dz.r1) / 2) };
    if (!g.map.isWalkable(dark.col, dark.row)) {
      var found = false;
      for (var dr0 = dz.r0; dr0 <= dz.r1 && !found; dr0++) {
        for (var dc0 = dz.c0; dc0 <= dz.c1 && !found; dc0++) {
          if (g.map.isWalkable(dc0, dr0)) { dark = { col: dc0, row: dr0 }; found = true; }
        }
      }
    }
    /* 明所: lightOverrides で強く点灯させたマス（受入ホール等） */
    var lit = { col: 7, row: 46 };
    var ovs = g.map.meta.lightOverrides || [];
    for (var oi = 0; oi < ovs.length; oi++) {
      if (ovs[oi].state === 'on' && (ovs[oi].gain || 1) >= 1.5 && g.map.isWalkable(ovs[oi].col, ovs[oi].row)) {
        lit = { col: ovs[oi].col, row: ovs[oi].row }; break;
      }
    }
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
      if (ai.territory && (list[i].row < ai.territory.r0 || list[i].row > ai.territory.r1)) continue;
      if (approachTo(g.map, list[i].col, list[i].row)) noiseCell = list[i];
    }
    for (var i2 = 0; i2 < list.length && !noiseCell; i2++) {
      if (approachTo(g.map, list[i2].col, list[i2].row)) noiseCell = list[i2];
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
    /* P4.10: 敵が複数いるので、検証する個体（g.ai）自身の縄張りの中のセンサーを使う */
    var sensors = g.map.meta.sensors || [], sc = null;
    for (var j = 0; j < sensors.length && !sc; j++) {
      if (ai.territory && (sensors[j].row < ai.territory.r0 || sensors[j].row > ai.territory.r1)) continue;
      if (approachTo(g.map, sensors[j].col, sensors[j].row)) sc = sensors[j];
    }
    for (var j2 = 0; j2 < sensors.length && !sc; j2++) {
      if (approachTo(g.map, sensors[j2].col, sensors[j2].row)) sc = sensors[j2];
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

    /* P4.8（2026-09-03改訂）: 復帰先はスタート地点。旧「牢送り（拘束室で格子をこじ開ける）」は失効。 */
    var toStart = simUntil(g, function () { return st.jail.phase === 'none'; },
      Math.ceil((g.cinematic ? g.cinematic.totalDur('jail') : 3) / ESCAPE.FIXED_DT) + 400);
    t.ok(toStart >= 0, '状態機械: 暗転を経て操作可能に戻る', st.jail.phase);
    var sp2 = g.map.meta.spawn;
    t.ok(g.player.col() === sp2.col && g.player.row() === sp2.row,
      '捕獲復帰: スタート地点で目覚める', g.player.col() + ',' + g.player.row());
    t.ok(g.progress.flags.p3bTest === 'keep', '捕獲復帰: 進行状態が保持される');
    t.ok(ai.state === 'patrol' && ai.form === 'stand', '捕獲復帰: 敵は直立形態で巡回へ戻る',
      ai.state + '/' + ai.form);
    t.near(g.stealth.fade, 0, 1e-9, '捕獲復帰: 明転しきっている', g.stealth.fade);
    /* 拘束室は「場所として残す」契約。房のマスは残っているが動線としては使わない */
    var jc = g.map.meta.jailCell;
    t.ok(g.map.tileAt(jc.col, jc.row) === ESCAPE.TILE.CELL,
      '拘束室: 場所としては残っている（契約 §4）');
    g.input.moveY = 1;
    var moved = simUntil(g, function () {
      return g.player.col() !== sp2.col || g.player.row() !== sp2.row;
    }, 240);
    g.input.reset();
    t.ok(moved >= 0, '捕獲復帰: そのまま歩き出せる', g.player.col() + ',' + g.player.row());
    t.ok(g.progress.flags.p3bTest === 'keep', '捕獲復帰: 復帰後も進行状態は保持されている');
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

  /** 捕獲の回数制限。P4.8（2026-09-03改訂）で復帰先は「スタート地点」になった
   *  （旧・牢送り＝拘束室で格子をこじ開けて復帰 は失効）。 */
  function testCaptureLimit(t, g) {
    g.reset();
    var st = g.stealth, ai = g.ai, T = ESCAPE.ENEMY_TUNING;
    var sp0 = g.map.meta.spawn;
    g.progress.gimmick.key = true;
    for (var i = 0; i < T.captureLimit - 1; i++) {
      t.ok(st.capture(), '捕獲' + (i + 1) + '回目: 捕獲演出が始まる');
      var back = simUntil(g, function () { return st.jail.phase === 'none'; },
        Math.ceil((g.cinematic ? g.cinematic.totalDur('jail') : 3) / ESCAPE.FIXED_DT) + 400);
      t.ok(back >= 0, '捕獲' + (i + 1) + '回目: 演出のあと操作可能に戻る', st.jail.phase);
      t.ok(g.player.col() === sp0.col && g.player.row() === sp0.row,
        '捕獲' + (i + 1) + '回目: スタート地点で目覚める', g.player.col() + ',' + g.player.row());
      t.ok(st.jail.phase === 'none', '捕獲' + (i + 1) + '回目: 牢のフェーズが残らない');
    }
    t.ok(g.progress.gimmick.key === true, '捕獲（3回目未満）は進行状態を保持する');
    t.ok(st.captures === T.captureLimit - 1, '捕獲回数が積み上がる', st.captures);

    /* 3回目 = 食われる → ゲームオーバー画面 → タップでエリア最初から（P4.6） */
    t.ok(st.capture(), '捕獲3回目: 発生する');
    var over = simCapture(g);
    t.ok(over >= 0 && st.jail.phase === 'over', '捕獲3回目: ゲームオーバー画面になる', st.jail.phase);
    t.ok(st.onInteract() === true, '捕獲3回目: 操作でエリア最初から再開できる');
    var done = simUntil(g, function () { return st.jail.phase === 'none'; }, 400);
    t.ok(done >= 0, '捕獲3回目: 暗転を経て復帰する', st.jail.phase);
    t.ok(st.areaResets === 1, '捕獲3回目: エリアがリセットされる', st.areaResets);
    t.ok(st.captures === 0, '捕獲3回目: 捕獲回数がリセットされる', st.captures);
    /* P4.13: エリアリセットで軌跡（laps）は全消去され1周目からやり直す */
    t.ok(g.rope.laps.length === 0 && g.rope.lapIndex === 0,
      '捕獲3回目: エリアリセットで軌跡は全消去され1周目に戻る（P4.13）', g.rope.laps.length);
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

  /* ================================================================
   * P4: 調べるUI統合・メモ・仕掛け連鎖・チェックポイント/セーブ（契約 DESIGN.md §4 / §6）
   * ============================================================== */

  var SAVE_KEY = 'escape.save.area1.v2';   /* P4.8 でセーブ形式が変わったため v2 */

  /* ================================================================
   * P4.8 アリアドネ方式（契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」/ §6）
   *
   * 【失効したテスト】P4.7 v2 の7工程を検査していた testGimmickOrderAndNotes /
   *   testHandleHoldInterrupt / testInventoryHud / testCardKeyLightsOut /
   *   testValveGauge / testBulkheadTimer / testDrainRoute / testArea1V2Contract は、
   *   2026-09-03 のピボットで**仕掛け自体が失効**したため削除した（ヒューズ・配電・
   *   カードキー・端末コード・バルブ・12秒隔壁・排水路グレーチング・所持品UI）。
   *   代わりに「旧仕掛けが『調べる』対象から消えている」ことを testRetiredGimmicks で検査する。
   *   牢送り（拘束室で格子をこじ開けて復帰）も失効し、復帰先はスタート地点になった。
   * ============================================================== */

  /** role で仕掛けを引く */
  function gimmickOf(g, role) {
    var gm = g.map.meta.gimmicks || [];
    for (var i = 0; i < gm.length; i++) if (gm[i].role === role) return gm[i];
    return null;
  }
  /** 実際の「調べる」経路（progress→stealth の順）を通す */
  function interactAt(g, col, row) {
    var ap = adjacentTo(g.map, col, row);
    if (!ap) return null;
    place(g, ap.col, ap.row, ap.yawDeg);
    var handled = g.progress.onInteract();
    if (!handled) handled = g.stealth.onInteract();
    return handled;
  }
  /** マス列を「実際に歩いて」たどる（ロープの繰り出し・巻き戻しを本番と同じ経路で動かす） */
  function walkCells(g, cells, maxFramesPerCell) {
    var dt = ESCAPE.FIXED_DT, p = g.player, frames = 0;
    var per = maxFramesPerCell || 240;
    /* P4.10b: 台本歩行の間だけ音の罠を止める。ワイヤーは契約どおり「歩いても鳴る」ので、
       長い経路を歩くロープ/地図のテストが罠→絶叫→捕獲に巻き込まれてしまう。
       罠そのものの発火は js/traps.js の専用スイートが実経路で検証している。 */
    var trapsWas = g.traps ? g.traps.enabled : null;
    if (g.traps) g.traps.enabled = false;
    for (var i = 0; i < cells.length; i++) {
      var c = g.map.cellCenter(cells[i].col, cells[i].row);
      var guard = 0;
      while (guard++ < per) {
        var dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.30) break;
        p.yaw = Math.atan2(-dx, -dz);
        g.input.moveX = 0; g.input.moveY = 1;
        g.stepFrame(dt);
        frames++;
      }
    }
    g.input.moveX = 0; g.input.moveY = 0;
    if (g.traps && trapsWas !== null) g.traps.enabled = trapsWas;
    return frames;
  }
  /** spawn から (col,row) への最短マス列（runtime の通行止めも含めた実際の歩行可能性で） */
  function routeTo(g, sc, sr, tc, tr) {
    var prev = Object.create(null), k = sc + ',' + sr;
    prev[k] = null;
    var q = [[sc, sr]], h = 0, D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (h < q.length) {
      var cu = q[h++];
      if (cu[0] === tc && cu[1] === tr) break;
      for (var i = 0; i < 4; i++) {
        var nc = cu[0] + D[i][0], nr = cu[1] + D[i][1], kk = nc + ',' + nr;
        if (prev[kk] !== undefined || !g.map.isWalkable(nc, nr)) continue;
        prev[kk] = cu[0] + ',' + cu[1];
        q.push([nc, nr]);
      }
    }
    var tk = tc + ',' + tr;
    if (prev[tk] === undefined) return null;
    var out = [];
    while (tk) { var pp = tk.split(','); out.push({ col: +pp[0], row: +pp[1] }); tk = prev[tk]; }
    out.reverse();
    return out.slice(1);
  }

  /** 【P4.12 改訂】旧「L = 最短 × (1+α)」は契約 §4「P4.12」項目4 で**失効**（L=無制限）。
   *  残るのは「最短経路長が正しく求まっていること」＝張力インジケータの基準の健全性だけ。 */
  function testRopeLength(t, g) {
    g.reset();
    var rope = g.rope, T = ESCAPE.ROPE_TUNING;
    if (!t.ok(!!rope, 'ロープ: モジュールが組み込まれている')) return;
    t.ok(T.alpha === undefined, 'P4.12: 定数 α は失効して消えている（L=無制限）', String(T.alpha));
    /* 独立に BFS して最短経路長を出し直す（Rope の実装と別経路で確かめる） */
    var meta = g.map.meta;
    var route = routeTo(g, meta.spawn.col, meta.spawn.row, meta.exitPad.col, meta.exitPad.row);
    if (!t.ok(!!route, 'ロープ: スタート→出口の経路が存在する')) return;
    var shortest = route.length * g.map.tileSize;
    t.near(rope.shortest, shortest, 1e-6, 'ロープ: 最短経路長がBFSと一致する',
      rope.shortest + ' vs ' + shortest);
    t.ok(rope.L === Infinity, 'P4.12: ロープの長さは無制限（Infinity）', String(rope.L));
    t.near(rope.used, 0, 1e-9, 'ロープ: 開始時は繰り出しゼロ');
    /* 【失効】「開始時の余裕は L と等しい」（余裕の概念そのものが失効） */
    t.ok(rope.isAttached() === true, 'ロープ: 開始時はスタートの結び目に結ばれている');
    t.ok(rope.stack.length === 1 && rope.stack[0].col === meta.spawn.col &&
      rope.stack[0].row === meta.spawn.row, 'ロープ: 錨はスタート地点');
    g.reset();
  }

  /** 繰り出しと巻き戻しの整合（往復すると余裕が完全に戻る） */
  function testRopePayoutRewind(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var rope = g.rope, meta = g.map.meta;
    var out = routeTo(g, meta.spawn.col, meta.spawn.row, 10, 46);
    if (!t.ok(!!out && out.length > 2, '巻き戻し: 往復用の経路がある')) return;
    walkCells(g, out);
    var usedOut = rope.used;
    t.ok(usedOut > 0, '繰り出し: 前進でロープが繰り出される', usedOut.toFixed(1) + 'm');
    t.near(usedOut, (rope.stack.length - 1) * g.map.tileSize, 1e-6,
      '繰り出し: 繰り出し量 = 敷いたマス数 × 1マス', usedOut);
    /* 【P4.12 失効】「余裕 = L - 繰り出し量」。L=無制限なので余裕は常に Infinity。
       代わりに「どれだけ歩いても余裕が減らない＝止まらない」ことを確かめる。 */
    t.ok(rope.slack() === Infinity, 'P4.12: どれだけ繰り出しても余裕は減らない（無制限）', String(rope.slack()));
    t.ok(rope.blocks === 0, 'P4.12: 前進が拒否されない', rope.blocks);
    /* 来た道を戻る */
    var back = out.slice(0, out.length - 1).reverse();
    back.push({ col: meta.spawn.col, row: meta.spawn.row });
    walkCells(g, back);
    t.near(rope.used, 0, 1e-6, '巻き戻し: 敷いたロープの上を戻ると余裕が完全に回復する', rope.used);
    t.ok(rope.stack.length === 1, '巻き戻し: 敷かれたロープが錨まで巻き取られる', rope.stack.length);
    t.ok(rope.rewinds > 0, '巻き戻し: 巻き戻しが実際に起きている', rope.rewinds);
    g.reset();
  }

  /** 【P4.12 全面失効】旧 testRopeTautBlocks「余裕0で前進不可（腰を引かれる）」。
   *  契約 §4「P4.12 再プレイ差し戻し」項目4 でロープの長さ制限が撤廃されたため、
   *  「張った」状態・前進不可・腰を引かれる演出・正文「ロープが張った」は**すべて失効**。
   *  代わりに「無制限であること」＝どれだけ歩いても止まらない・巻き戻し以外で used が減らない
   *  ことを、旧テストと同じ経路（スタート→10,46）で確かめる。 */
  function testP412RopeUnlimited(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var rope = g.rope, meta = g.map.meta, T = ESCAPE.ROPE_TUNING;
    t.ok(rope.L === Infinity, 'P4.12 無制限: L は Infinity', String(rope.L));
    t.ok(T.alpha === undefined && T.redSlackRatio === undefined,
      'P4.12 無制限: α・余裕不足の閾値は定数ごと失効している');
    t.ok(typeof rope._onTaut !== 'function' && typeof rope._pullBack !== 'function',
      'P4.12 無制限: 「張った」演出・腰を引かれる演出のコードが到達不能化（削除）されている');
    t.ok(ESCAPE.PROGRESS_UI_TEXT.taut === undefined &&
      ESCAPE.PROGRESS_OBJECTIVE.taut === undefined &&
      ESCAPE.PROGRESS_OBJECTIVE.ropeShort === undefined,
      'P4.12 無制限: 正文「ロープが張った」「ロープが足りない」が失効している');

    var route = routeTo(g, meta.spawn.col, meta.spawn.row, 10, 46);
    if (!t.ok(!!route && route.length >= 4, 'P4.12 無制限: 試験用の経路がある')) return;
    /* 旧テストで「余裕0」を作っていた長さ（3マス分）よりはるかに長く歩く */
    walkCells(g, route);
    var usedA = rope.used, cellA = g.player.col() + ',' + g.player.row();
    t.ok(usedA > 3 * g.map.tileSize,
      'P4.12 無制限: 旧Lの何倍歩いても繰り出しが続く', usedA.toFixed(0) + 'm');
    t.ok(rope.blocks === 0, 'P4.12 無制限: 前進が一度も拒否されない', rope.blocks);
    t.ok(rope.slack() === Infinity, 'P4.12 無制限: slack が減らない（常に Infinity）', String(rope.slack()));
    t.ok(cellA === route[route.length - 1].col + ',' + route[route.length - 1].row,
      'P4.12 無制限: 目的のマスまで実際に到達できる（腰を引き戻されない）', cellA);
    t.ok(rope.head().col + ',' + rope.head().row === cellA,
      'P4.12 無制限: ロープの先端が現在地に追随している');

    /* さらに大回り（戻って再び行く）でも止まらない。
       ※道中の捕獲は敵AI側の都合で起こり得るので、位置ではなく
         「一度も前進が拒否されない・余裕が減らない」で判定する。 */
    var far = routeTo(g, g.player.col(), g.player.row(), meta.spawn.col, meta.spawn.row);
    if (far && far.length) walkCells(g, far);
    var again = routeTo(g, g.player.col(), g.player.row(), 10, 46);
    if (again && again.length) walkCells(g, again);
    t.ok(rope.blocks === 0, 'P4.12 無制限: 往復を重ねても一度も止まらない', rope.blocks);
    t.ok(rope.slack() === Infinity && rope.payouts > 40,
      'P4.12 無制限: 往復のあとも余裕は無制限のまま', 'payouts=' + rope.payouts);
    /* HUD/目的表示に「張った」系が現れない */
    g.stepFrame(ESCAPE.FIXED_DT);
    var obj = g.progress.objective();
    t.ok(obj.indexOf('張った') < 0 && obj.indexOf('ロープが足りない') < 0,
      'P4.12 無制限: 目的表示に失効した文言が出ない', obj);
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** P4.13: 捕獲で現在の周の軌跡が確定して残り、スタート復帰後は新しい周をスタートから引き始める
   *  （旧「結び目を拾い直して再接続」は失効） */
  function testRopeKnotReattach(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var rope = g.rope, meta = g.map.meta, st = g.stealth;
    var route = routeTo(g, meta.spawn.col, meta.spawn.row, 10, 46);
    walkCells(g, route);
    var stackAtCapture = rope.stack.length;
    g.progress.gimmick.key = true;                 /* 進行状態の保持を確かめるための印 */
    st.captures = 0;
    var beforeExplored = g.minimap.exploredCount;
    var farCell = { col: g.player.col(), row: g.player.row() };

    t.ok(st.capture() === true, '捕獲: 捕獲が始まる');
    t.ok(rope.knots.length === 0, 'P4.13: 結び目は落ちない（拾い直しは失効）', rope.knots.length);
    t.ok(rope.laps.length === 1, 'P4.13: 捕まった周の軌跡が laps に残る', rope.laps.length);
    var lap = rope.laps[0] || { stack: [] };
    t.ok(lap.stack.length === stackAtCapture, 'P4.13: 残った軌跡の形は捕獲時のまま',
      lap.stack.length + ' / ' + stackAtCapture);
    var endCell = lap.stack[lap.stack.length - 1] || {};
    t.ok(endCell.col === farCell.col && endCell.row === farCell.row,
      'P4.13: 軌跡は捕まったマスで途切れる', endCell.col + ',' + endCell.row + ' vs ' + farCell.col + ',' + farCell.row);
    t.ok(rope.lapIndex === 1, 'P4.13: 2周目に進む', rope.lapIndex);

    var done = simUntil(g, function () { return st.jail.phase === 'none'; },
      Math.ceil((g.cinematic ? g.cinematic.totalDur('jail') : 3) / ESCAPE.FIXED_DT) + 400);
    t.ok(done >= 0, '捕獲: 演出が終わって操作可能に戻る', st.jail.phase);
    t.ok(g.player.col() === meta.spawn.col && g.player.row() === meta.spawn.row,
      '捕獲: 復帰先はスタート地点（2026-09-03改訂・牢送りは失効）',
      g.player.col() + ',' + g.player.row());
    t.ok(g.progress.gimmick.key === true, '捕獲: 進行状態（鍵）は保持される');
    t.ok(g.minimap.isExplored(farCell.col, farCell.row) === false,
      '捕獲: 地図の踏破が消える（P4.10改訂・旧「保持される」は失効）',
      farCell.col + ',' + farCell.row + ' explored=' + g.minimap.isExplored(farCell.col, farCell.row) +
      ' / 捕獲前 ' + beforeExplored);
    t.ok(!/結び目/.test(String(g.progress.objective())),
      'P4.13: 目的表示は結び目へ戻らず通常の目的に戻る', g.progress.objective());
    t.ok(rope.isAttached() === true && rope.stack.length === 1,
      'P4.13: 復帰直後は新しい周がスタート（錨）だけの状態で始まる', rope.stack.length);
    t.near(rope.used, 0, 1e-9, 'P4.13: 復帰直後の周は使用長0');

    /* 新しい周はスタートから繰り出す（旧「結び目まで戻る間は無消費」は失効） */
    walkCells(g, route);
    t.ok(rope.used > 0 && rope.stack.length === stackAtCapture,
      'P4.13: 復帰後は新しい周がスタートから繰り出される', rope.used + ' / ' + rope.stack.length);
    t.ok(rope.laps.length === 1 && rope.laps[0].stack.length === stackAtCapture,
      'P4.13: 過去の周は固定のまま（現在の周の繰り出しで変わらない）');
    t.ok(rope.pickUp() === false && rope.nearKnot() === null, 'P4.13: 結び目API は失効の残骸（何もしない）');
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 3回目の捕獲（エリアリセット）で、地図の踏破は消え・軌跡（laps）も全消去される（P4.13改訂） */
  function testAreaResetFogAndGhost(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var rope = g.rope, mm = g.minimap, st = g.stealth, T = ESCAPE.ENEMY_TUNING, meta = g.map.meta;
    var route = routeTo(g, meta.spawn.col, meta.spawn.row, 10, 46);
    walkCells(g, route);
    var explored = mm.exploredCount, cells = rope.stack.length;
    g.progress.gimmick.key = true;
    mm.learnZone('A');
    t.ok(explored > 20 && cells > 1, 'リセット前: 踏破とロープが積み上がっている',
      explored + ' / ' + cells);

    st.captures = T.captureLimit - 1;
    t.ok(st.capture() === true, '3回目の捕獲が発生する（前提）');
    t.ok(simCapture(g) >= 0 && st.jail.phase === 'over',
      '3回目の捕獲: ゲームオーバー画面まで進む', st.jail.phase);
    st.restartArea();
    var done = simUntil(g, function () { return st.jail.phase === 'none'; }, 400);
    t.ok(done >= 0, '3回目の捕獲: エリアリセットが完了する');
    t.ok(st.areaResets === 1, 'エリアリセットが記録される');
    t.ok(mm.exploredCount < explored, 'エリアリセット: 地図の踏破が消える（契約）',
      mm.exploredCount + ' / ' + explored);
    t.ok(mm.knowsZone('A') === true, 'エリアリセット: 銘板で得た区画名は残る（知識は失われない）');
    t.ok(rope.laps.length === 0 && rope.lapIndex === 0,
      'エリアリセット: 軌跡は全消去され1周目からやり直す（P4.13改訂・旧「世界に残る」は失効）',
      rope.laps.length + ' laps, lapIndex ' + rope.lapIndex);
    t.near(rope.used, 0, 1e-9, 'エリアリセット: ロープは巻き取られて再スタートする');
    t.ok(rope.isAttached() === true && rope.knots.length === 0,
      'エリアリセット: 結び直された状態で再開する');
    t.ok(g.progress.gimmick.key === true, 'エリアリセット: 鍵（進行状態）は保持される');
    var sp = meta.spawn;
    t.ok(g.player.col() === sp.col && g.player.row() === sp.row, 'エリアリセット: 位置はエリア最初へ戻る');
    g.reset();
    t.ok(g.rope.laps.length === 0 && g.rope.lapIndex === 0, '復帰: game.reset() で軌跡も初期化される', g.rope.laps.length);
    localStorage.removeItem(SAVE_KEY);
  }

  /** fog of war: 歩いた通路と入った部屋だけが描かれる */
  function testFogOfWar(t, g) {
    g.reset();
    var mm = g.minimap, meta = g.map.meta;
    if (!t.ok(!!mm, '地図: モジュールが組み込まれている')) return;
    var sp = meta.spawn;
    sim(g, 1);
    t.ok(mm.isExplored(sp.col, sp.row) === true, '地図: 立っているマスは踏破済みになる');
    var far = { col: 34, row: 2 };
    t.ok(mm.isExplored(far.col, far.row) === false, '地図: 行っていないマスは真っ暗のまま');
    var before = mm.exploredCount;
    walkCells(g, routeTo(g, sp.col, sp.row, 10, 46));
    t.ok(mm.exploredCount > before, '地図: 歩いた通路が記録される', mm.exploredCount + ' / ' + before);
    t.ok(mm.isExplored(10, 46) === true, '地図: 通った通路が踏破済みになる');
    /* 部屋に入ったらその部屋ごと描かれる（受入ホールはスポーン地点の部屋） */
    var hall = null, rs = meta.regions || [];
    for (var i = 0; i < rs.length; i++) if (rs[i].id === 'hall') hall = rs[i];
    if (hall) {
      var all = true;
      for (var c = hall.c0; c <= hall.c1; c++) {
        for (var r = hall.r0; r <= hall.r1; r++) {
          if (!g.map.isWalkable(c, r)) continue;
          if (!mm.isExplored(c, r)) all = false;
        }
      }
      t.ok(all, '地図: 入った部屋は部屋ごと描かれる（受入ホール）');
    }
    t.ok(mm.info().zones.length === 0, '地図: 銘板を読むまで区画名は入らない');
    g.reset();
    t.ok(g.minimap.exploredCount <= 30, '復帰: 踏破が初期化される', g.minimap.exploredCount);
  }

  /** 区画銘板を「調べる」と地図に A〜F と施設名が記入される（正文どおり） */
  function testRegionSigns(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var list = g.map.meta.regionSigns || [], U = ESCAPE.PROGRESS_UI_TEXT;
    t.ok(list.length === 6, '銘板: 区画A〜Fの6枚が配置されている', list.length);
    var zones = {}, ok = 0;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      zones[s.zone] = true;
      t.ok(g.map.isSolid(s.col, s.row), '銘板 ' + s.zone + ': 壁のマスに付いている');
      t.ok(ESCAPE.ZONE_NAMES[s.zone] === s.name,
        '銘板 ' + s.zone + ': 施設名が正文と一致する', s.name);
      var D = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s.dir];
      var rc = s.col + D[0], rr = s.row + D[1];
      if (!t.ok(g.map.isWalkable(rc, rr), '銘板 ' + s.zone + ': 読む側が歩行可能')) continue;
      place(g, rc, rr, Math.atan2(D[0], D[1]) * 180 / Math.PI);
      g.progress._flashT = 0; g.progress._flashMsg = '';   /* 直前の銘板の応答表示を消す */
      sim(g, 1);
      var found = g.progress._findRegionSign();
      t.ok(!!found && found.id === s.id, '銘板 ' + s.zone + ': 近づくと対象になる');
      t.ok(g.progress.dom.prompt.textContent === U.regionSign,
        '銘板 ' + s.zone + ': プロンプトが「' + U.regionSign + '」', g.progress.dom.prompt.textContent);
      var handled = g.progress.onInteract();
      t.ok(handled === true, '銘板 ' + s.zone + ': 「調べる」が消費される');
      t.ok(g.minimap.knowsZone(s.zone) === true, '銘板 ' + s.zone + ': 地図に区画名が記入される');
      t.ok(g.progress._flashMsg === s.zone + '　' + s.name,
        '銘板 ' + s.zone + ': 表記が `' + s.zone + '　' + s.name + '` 形式', g.progress._flashMsg);
      t.ok(g.progress._findRegionSign() === null, '銘板 ' + s.zone + ': 一度読んだら対象から外れる');
      ok++;
    }
    t.ok(ok === 6, '銘板: 6枚すべてを読める', ok);
    t.ok(Object.keys(zones).sort().join('') === 'ABCDEF', '銘板: A〜Fが重複なく揃っている',
      Object.keys(zones).sort().join(''));
    t.ok(g.minimap.info().zones.join('') === 'ABCDEF', '地図: 6区画すべてが記入された',
      g.minimap.info().zones.join(''));
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 鍵 → 隔壁解錠 → EXIT でクリア（唯一の仕掛け） */
  function testKeyAndBulkhead(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, U = ESCAPE.PROGRESS_UI_TEXT, TILE = ESCAPE.TILE;
    var safe = gimmickOf(g, 'safe'), bulk = gimmickOf(g, 'bulkhead');
    if (!t.ok(!!safe && !!bulk, '仕掛け: 金庫と隔壁の2つだけが定義されている')) return;
    t.ok((g.map.meta.gimmicks || []).length === 2, '仕掛け: 仕掛けは2つに絞られている',
      (g.map.meta.gimmicks || []).length);
    t.ok(g.map.tileAt(safe.col, safe.row) === TILE.GIMMICK, '金庫: GIMMICK タイルに載っている');
    t.ok(g.map.tileAt(bulk.col, bulk.row) === TILE.DOOR, '隔壁: DOOR タイル（北の隔壁）に載っている');
    t.ok(bulk.col === g.map.meta.door.col && bulk.row === g.map.meta.door.row,
      '隔壁: meta.door と同じマス');

    /* 鍵なしで隔壁を調べる → 施錠の応答 */
    var ap = adjacentTo(g.map, bulk.col, bulk.row);
    place(g, ap.col, ap.row, ap.yawDeg);
    sim(g, 1);
    t.ok(pr.dom.prompt.textContent === U.bulkheadLook,
      '隔壁(鍵なし): プロンプトが「' + U.bulkheadLook + '」', pr.dom.prompt.textContent);
    var h = pr.onInteract();
    t.ok(h === true, '隔壁(鍵なし): 「調べる」は消費される（応答のみ）');
    t.ok(pr.gimmick.doorOpen === false, '隔壁(鍵なし): 開かない');
    t.ok(pr._flashMsg === U.bulkheadLocked, '隔壁(鍵なし): 「' + U.bulkheadLocked + '」で応答', pr._flashMsg);
    pr._flashT = 0; pr._flashMsg = '';

    /* 所長室の金庫 → 鍵 */
    var apS = adjacentTo(g.map, safe.col, safe.row);
    place(g, apS.col, apS.row, apS.yawDeg);
    sim(g, 1);
    t.ok(pr.dom.prompt.textContent === U.safe, '金庫: プロンプトが「' + U.safe + '」',
      pr.dom.prompt.textContent);
    t.ok(pr.onInteract() === true, '金庫: 「調べる」で開けられる');
    t.ok(pr.gimmick.key === true, '金庫: 隔壁の鍵を手に入れる');
    t.ok(pr._flashMsg === U.keyGot, '金庫: 「' + U.keyGot + '」を表示', pr._flashMsg);
    t.ok(pr.objective() === ESCAPE.PROGRESS_OBJECTIVE.haveKey,
      '金庫: 目的表示が「' + ESCAPE.PROGRESS_OBJECTIVE.haveKey + '」に変わる', pr.objective());
    t.ok(pr._findTarget() === null || pr._findTarget().entry.role !== 'safe',
      '金庫: 開けたら「調べる」対象から消える');
    /* 所長室は記録室の奥（東端）・区画E */
    var dir = null, rs = g.map.meta.regions || [];
    for (var i = 0; i < rs.length; i++) if (rs[i].id === 'director') dir = rs[i];
    t.ok(!!dir && dir.zone === 'E', '所長室: 区画Eに属する', dir && dir.zone);
    t.ok(!!dir && safe.col >= dir.c0 - 1 && safe.col <= dir.c1 + 1 &&
      safe.row >= dir.r0 - 1 && safe.row <= dir.r1 + 1,
      '所長室: 金庫は所長室の壁にある', safe.col + ',' + safe.row);

    /* 鍵あり → 解錠 → EXIT でクリア */
    place(g, ap.col, ap.row, ap.yawDeg);
    pr._flashT = 0; pr._flashMsg = '';
    sim(g, 1);
    t.ok(pr.dom.prompt.textContent === U.bulkheadUnlock,
      '隔壁(鍵あり): プロンプトが「' + U.bulkheadUnlock + '」', pr.dom.prompt.textContent);
    t.ok(pr.onInteract() === true, '隔壁(鍵あり): 「調べる」で解錠できる');
    t.ok(pr.gimmick.doorOpen === true, '隔壁(鍵あり): 開放される');
    var ep = g.map.meta.exitPad;
    place(g, ep.col, ep.row, 0);
    sim(g, 3);
    t.ok(pr.cleared === true, 'クリア: EXIT到達でクリアになる');
    t.ok(pr.clearedBy === 'main', 'クリア: 正規ルートとして記録される', pr.clearedBy);
    t.ok(pr.modal === 'ending', 'クリア: CLEAR画面が出る', pr.modal);
    t.ok(pr.dom.endingOverlay.classList.contains('show'), 'クリア: CLEAR画面が表示される');
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** ヘッドライト: 歩行中だけ点灯し、点灯中は敵の発見距離が1.5倍になる */
  function testHeadlight(t, g) {
    g.reset();
    var hl = g.headlight, T = ESCAPE.ENEMY_TUNING;
    if (!t.ok(!!hl, 'ライト: モジュールが組み込まれている')) return;
    t.near(T.headlightSightMul, 1.50, 1e-9, 'ライト: 発見距離の倍率は1.5（契約）', T.headlightSightMul);
    /* findTriple は +X 方向に3マス並ぶ場所を返す。その向き（yaw=-90）へ歩かせる */
    /* 発見距離はその場の明るさで変わるので、期待値は同じ式で独立に計算する
       （位置が変わってもズレない＝倍率だけを検査できる） */
    function baseSight(p) {
      var lum = g.ai.luminanceAt(p.x, p.z);
      var k = Math.max(0, Math.min(1, (lum - T.lumDark) / (T.lumLit - T.lumDark)));
      var b = T.sightDark + (T.sightLit - T.sightDark) * k;
      if (p.crouching) b *= T.crouchFactor;
      return b;
    }
    var open = findTriple(g.map, false);
    place(g, open.col, open.row, -90);
    g.player.crouching = false;
    sim(g, 3);
    t.ok(hl.on === false, 'ライト: 停止中は消灯');
    var offRange = g.ai.sightRange(g.player);
    t.near(offRange, baseSight(g.player), 1e-9, 'ライト: 消灯中は倍率がかからない', offRange);

    /* 歩く → 点灯 */
    g.input.moveX = 0; g.input.moveY = 1;
    sim(g, 20);
    t.ok(hl.on === true, 'ライト: 歩行中は自動点灯', g.player.speed.toFixed(2) + ' m/s');
    var onRange = g.ai.sightRange(g.player);
    t.near(onRange / baseSight(g.player), T.headlightSightMul, 1e-6,
      'ライト: 点灯中は発見距離が1.5倍', onRange.toFixed(2));
    t.ok(hl.level > 0.5, 'ライト: 実際に光が出ている', hl.level.toFixed(2));

    /* しゃがむ → 消灯（移動していても） */
    g.input.crouchOn = true;
    sim(g, 20);
    t.ok(hl.on === false, 'ライト: しゃがみ中は消灯（移動していても）');
    g.input.crouchOn = false;

    /* 止まる → 消灯 */
    g.input.moveY = 0;
    sim(g, 90);
    t.ok(hl.on === false, 'ライト: 停止で消灯');
    t.near(g.ai.sightRange(g.player), baseSight(g.player), 1e-9,
      'ライト: 消灯で発見距離が元に戻る', g.ai.sightRange(g.player));
    t.ok(hl.level < 0.01, 'ライト: 消灯すると光が消える', hl.level);

    /* 同類バグ検出（Aが設定→Bの毎フレーム更新が上書き）:
       ヘッドライトの状態を持つのは Headlight だけで、敵AIは読むだけであること。
       stepFrame を何度回しても on と倍率の対応が崩れないことで検出する。 */
    g.input.moveY = 1;
    var consistent = true;
    for (var i = 0; i < 40; i++) {
      sim(g, 1);
      var want = baseSight(g.player) * (hl.on ? T.headlightSightMul : 1);
      if (Math.abs(g.ai.sightRange(g.player) - want) > 1e-9) consistent = false;
    }
    t.ok(consistent, 'ライト: 毎フレーム更新しても点灯状態と発見距離の対応が崩れない');
    g.input.reset();
    g.reset();
  }

  /** 失効した旧仕掛けが「調べる」対象から消えている（契約 §4 失効宣言） */
  function testRetiredGimmicks(t, g) {
    g.reset();
    var meta = g.map.meta, TILE = ESCAPE.TILE;
    var roles = {};
    var gm = meta.gimmicks || [];
    for (var i = 0; i < gm.length; i++) roles[gm[i].role] = true;
    var retired = ['lever', 'terminal', 'handle', 'fuse', 'wrench', 'corpse', 'valve', 'grating'];
    var found = [];
    for (var r = 0; r < retired.length; r++) if (roles[retired[r]]) found.push(retired[r]);
    t.ok(found.length === 0, '失効: 旧7工程の仕掛けが meta.gimmicks に残っていない', found.join(','));
    t.ok(!meta.gates, '失効: 施錠(gates)が撤去されている');
    t.ok(!meta.crawl, '失効: 排水路(crawl)が撤去されている');
    t.ok(!meta.exitPad2, '失効: 裏ルートの出口(exitPad2)が撤去されている');
    t.ok(!g.progress.items, '失効: 所持品（ヒューズ/スパナ/カードキー）が無くなっている');
    t.ok(!g.progress.valves, '失効: バルブの状態が無くなっている');
    t.ok(document.getElementById('inventory') === null, '失効: 所持品UIがDOMから消えている');
    t.ok(document.getElementById('keypad-overlay') === null, '失効: テンキーUIがDOMから消えている');
    t.ok(document.getElementById('breaker-overlay') === null, '失効: ブレーカーUIがDOMから消えている');
    t.ok(document.getElementById('gauge') === null, '失効: 圧力計がDOMから消えている');

    /* 造形として残った GIMMICK タイルが「調べる」対象にならないこと */
    var stray = 0, checked = 0;
    for (var row = 0; row < g.map.height; row++) {
      for (var col = 0; col < g.map.width; col++) {
        if (g.map.tileAt(col, row) !== TILE.GIMMICK) continue;
        var isLive = false;
        for (var k = 0; k < gm.length; k++) if (gm[k].col === col && gm[k].row === row) isLive = true;
        if (isLive) continue;
        var ap = adjacentTo(g.map, col, row);
        if (!ap) continue;
        checked++;
        place(g, ap.col, ap.row, ap.yawDeg);
        sim(g, 1);
        var tgt = g.progress._findTarget();
        if (tgt && tgt.col === col && tgt.row === row) stray++;
      }
    }
    t.ok(checked > 0 && stray === 0,
      '失効: 残置した旧仕掛けの造形は「調べる」対象にならない', stray + '/' + checked);
    g.reset();
  }

  function testMemoNotes(t, g) {
    g.reset();
    var notes = g.map.meta.notes || [];
    t.ok(notes.length === 6, 'メモ: area1に6枚に絞られている（契約 §4 継承リスト）', notes.length);
    var seenMemoTitles = {};
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var text = ESCAPE.PROGRESS_NOTE_TEXTS[n.id];
      if (!t.ok(!!text, 'メモ ' + n.id + ': 本文の対応がある')) continue;
      var ap = adjacentTo(g.map, n.col, n.row);
      if (!t.ok(!!ap, 'メモ ' + n.id + ': 「調べる」が届く隣接マスがある')) continue;
      place(g, ap.col, ap.row, ap.yawDeg);
      var target = g.progress._findTarget();
      t.ok(!!target && target.kind === 'note' && target.entry.id === n.id,
        'メモ ' + n.id + ': 「調べる」対象として検出される');
      var h = g.progress.onInteract();
      t.ok(h === true && g.progress.modal === 'memo', 'メモ ' + n.id + ': 「調べる」で拡大表示が開く');
      t.ok(g.progress.dom.memoBody.textContent === text.body, 'メモ ' + n.id + ': 本文が docs/notes.md と一致する');
      t.ok(g.progress.notesRead[n.id] === true, 'メモ ' + n.id + ': 既読として記録される');
      seenMemoTitles[text.title] = true;
      var h2 = g.progress.onInteract();
      t.ok(h2 === true && g.progress.modal === null, 'メモ ' + n.id + ': 「調べる」で閉じる');
    }
    t.ok(Object.keys(seenMemoTitles).length === 6, 'メモ: 6枚が重複なく1枚ずつ対応している',
      Object.keys(seenMemoTitles).length);
    /* P4.8 で差し替えた3枚（memo1/4/5）が v3 の正文になっていること */
    t.ok(ESCAPE.PROGRESS_NOTE_TEXTS.a1_n5.body.indexOf('鍵は所長室の金庫') >= 0,
      'メモ: memo1 が v3 の差し替え本文（所長室の金庫）');
    /* P4.9: 正文が Z4 に合わせて改訂された（所長室＝北の記録区画の西端） */
    t.ok(ESCAPE.PROGRESS_NOTE_TEXTS.a1_n6.body.indexOf('所長室は北の記録区画の西端 —— 記録室のさらに奥') >= 0,
      'メモ: memo4 が正文どおり（所長室は北の記録区画の西端）');
    t.ok(ESCAPE.PROGRESS_NOTE_TEXTS.a1_n1.title === '点検員の走り書き',
      'メモ: memo5 が v3 の差し替え（点検員の走り書き）', ESCAPE.PROGRESS_NOTE_TEXTS.a1_n1.title);
    t.ok(!ESCAPE.PROGRESS_NOTE_TEXTS.a1_n7 && !ESCAPE.PROGRESS_NOTE_TEXTS.a1_n8 &&
      !ESCAPE.PROGRESS_NOTE_TEXTS.a1_n9, 'メモ: 失効した memo7〜9 が残っていない');
    g.reset();
  }

  function testMemoCloseGestures(t, g) {
    g.reset();
    var notes = g.map.meta.notes || [];
    var n = notes[0];
    var ap = adjacentTo(g.map, n.col, n.row);
    if (!t.ok(!!ap, 'メモを開く準備ができる')) return;

    /* Esc 相当（onCloseTap 経由）で閉じる */
    place(g, ap.col, ap.row, ap.yawDeg);
    g.progress.onInteract();
    t.ok(g.progress.modal === 'memo', 'メモが開いている（前提）');
    g.progress.onCloseTap();
    t.ok(g.progress.modal === null, 'メモ: Esc相当（onCloseTap）で閉じる');

    /* タップ（オーバーレイのbindTap経路と同じ処理）で閉じる */
    place(g, ap.col, ap.row, ap.yawDeg);
    g.progress.onInteract();
    t.ok(g.progress.modal === 'memo', 'メモが開いている（前提2）');
    g.progress.onCloseTap();
    t.ok(g.progress.modal === null, 'メモ: タップ相当で閉じる');
    g.reset();
  }

  /** メモ表示中は「中断安全」= 視点・移動停止＋捕獲されない */
  function testModalInterruptSafety(t, g) {
    g.reset();
    var notes = g.map.meta.notes || [];
    var n = notes[0];
    var ap = adjacentTo(g.map, n.col, n.row);
    if (!t.ok(!!ap, 'メモを開く準備ができる')) return;
    place(g, ap.col, ap.row, ap.yawDeg);
    g.progress.onInteract();
    if (!t.ok(g.progress.modal === 'memo', 'メモが開いている（前提）')) return;

    var x0 = g.player.x, z0 = g.player.z, yaw0 = g.player.yaw;
    g.input.moveY = 1; g.input.lookDX = 800;
    sim(g, 20);
    t.ok(g.player.x === x0 && g.player.z === z0, 'メモ表示中: 移動が止まる');
    t.ok(g.player.yaw === yaw0, 'メモ表示中: 視点が止まる');
    t.ok(g.headlight.on === false, 'メモ表示中: ヘッドライトは点かない');
    g.input.reset();

    /* 敵がすぐ隣に来ても捕獲されない */
    placeEnemy(g, g.player.col(), g.player.row(), 0);
    g.ai.enemy.x = g.player.x + 0.3; g.ai.enemy.z = g.player.z;
    g.ai.state = 'chase';
    sim(g, 30);
    t.ok(g.stealth.captures === 0, 'メモ表示中: 敵が隣接しても捕獲されない');
    t.ok(g.stealth.hidden() === true, 'メモ表示中: Stealth.hidden()がtrueになる（P4フック）');

    g.progress.onCloseTap();
    t.ok(g.progress.modal === null, 'メモを閉じられる（後始末）');
    g.reset();
  }

  /* ================================================================
   * P4.14 項目1: セーブポイント（契約 §4「P4.14 再プレイ差し戻し」項目1）
   *
   * 【失効】旧 testCheckpointAutoSave（マスを踏むと自動でチェックポイント記録＋効果音）。
   * 自動チェックポイントは契約ごと失効したので、その検査は「踏んでも記録されない」の
   * 検査（testP414AutoCheckpointRetired）へ置き換えてある。
   * ============================================================== */

  /** 記録端末の正面に立つ（端末＝壁面。yawDeg は progress が持つ「端末を向く角度」） */
  function standAtTerminal(g, sp) {
    var c = g.map.cellCenter(sp.col, sp.row);
    g.player.x = c.x; g.player.z = c.z;
    g.player.y = g.map.floorYAt(c.x, c.z);
    g.player.yaw = (sp.yawDeg || 0) * Math.PI / 180;
    g.player.pitch = 0;
    g.player.crouching = false;
  }
  /** id からセーブポイントの定義を引く */
  function savePointOf(g, id) {
    var list = g.progress.savePoints || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  /** 実UI経路で記録する（「調べる」＝progress.onInteract）。処理されたら true */
  function recordAt(g, sp) {
    standAtTerminal(g, sp);
    return g.progress.onInteract();
  }

  /** データ: 端末は壁付きで、進行順（スタートからの経路距離）が一意に決まる */
  function testP414SavePointData(t, g) {
    g.reset();
    var meta = g.map.meta, TILE = ESCAPE.TILE, map = g.map;
    var cps = meta.checkpoints || [];
    if (!t.ok(cps.length === 6, 'P4.14 データ: セーブポイントは6か所（旧チェックポイント転用）',
      cps.length)) { g.reset(); return; }
    var FV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    var bad = [];
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      if (map.tileAt(cp.col, cp.row) !== TILE.CHECKPOINT) bad.push(cp.id + ' タイル');
      if (!cp.dir || !FV[cp.dir]) { bad.push(cp.id + ' dirなし'); continue; }
      var v = FV[cp.dir];
      if (!map.isSolid(cp.col + v[0], cp.row + v[1])) bad.push(cp.id + ' 壁なし');
    }
    t.ok(bad.length === 0, 'P4.14 データ: 全端末が歩行可能マス＋dir の先が壁（壁付けできる）',
      bad.join(' / ') || '6/6');

    var list = g.progress.savePoints;
    t.ok(list.length === 6, 'P4.14 データ: progress が6本のセーブポイントを持つ', list.length);
    var inc = true, zones = {}, dup = 0;
    for (var j = 1; j < list.length; j++) if (list[j].order <= list[j - 1].order) inc = false;
    for (var k = 0; k < list.length; k++) {
      if (zones[list[k].zone]) dup++;
      zones[list[k].zone] = true;
    }
    t.ok(inc, 'P4.14 データ: 進行順（スタートからの経路距離）が一意に定まる（同着なし）',
      list.map(function (e) { return e.zone + ':' + e.order; }).join(' '));
    t.ok(dup === 0, 'P4.14 データ: 区画A〜Fに1本ずつ行き渡っている', Object.keys(zones).sort().join(''));
    var deepest = list[list.length - 1];
    t.ok(deepest.zone === 'E', 'P4.14 データ: 最も奥は区画E（鍵と出口のある最北の帯）', deepest.zone);
    var nearest = list[0];
    t.ok(nearest.zone === 'A', 'P4.14 データ: 最も手前は区画A（スタートの帯）', nearest.zone);
    g.reset();
  }

  /** 案内: 2マス以内で `セーブポイント —— 壁の端末を調べて記録しろ`／30秒に1回／記録済みは出ない */
  function testP414SavePointHint(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, C = ESCAPE.PROGRESS_SAVE_CONST;
    var sp = pr.savePoints[0];
    var el = document.getElementById('trap-hint');
    t.near(C.SAVE_HINT_COOLDOWN, 30.0, 1e-9, 'P4.14 案内: 同じ端末の間隔は30秒', C.SAVE_HINT_COOLDOWN);
    t.ok(C.SAVE_NEAR_CELLS === 2, 'P4.14 案内: 発動距離は2マス以内', C.SAVE_NEAR_CELLS);

    /* 3マス離れた地点では出ない */
    var far = null, cells = g.map.walkableCells();
    for (var i = 0; i < cells.length; i++) {
      var d = Math.max(Math.abs(cells[i].col - sp.col), Math.abs(cells[i].row - sp.row));
      if (d === 3) { far = cells[i]; break; }
    }
    if (far) {
      place(g, far.col, far.row, 0);
      sim(g, 2);
      t.ok(pr.saveHintText() === '', 'P4.14 案内: 3マス離れていれば出ない', pr.saveHintText());
    }
    /* 2マス以内へ入ると出る（正文どおり） */
    place(g, sp.col, sp.row, 0);
    sim(g, 2);
    t.ok(pr.saveHintText() === ESCAPE.PROGRESS_SAVE_HINT,
      'P4.14 案内: 2マス以内で正文が出る', pr.saveHintText());
    t.ok(ESCAPE.PROGRESS_SAVE_HINT === 'セーブポイント —— 壁の端末を調べて記録しろ',
      'P4.14 正文: 案内の文言が docs/notes.md と一字一句一致する', ESCAPE.PROGRESS_SAVE_HINT);
    t.ok(!!el && el.textContent === ESCAPE.PROGRESS_SAVE_HINT && el.classList.contains('show'),
      'P4.14 案内: TRAP_HINT と同じ表示経路（#trap-hint）に出る',
      el ? (el.textContent + ' show=' + el.classList.contains('show')) : 'DOMなし');
    t.ok(pr.savePointsSeen[sp.id] === true, 'P4.14 地図: 2マス以内に入ると「発見」される');

    /* 表示が切れた後、30秒経つまでは再度出ない */
    var firstAt = pr._saveHintAt[sp.id];
    sim(g, Math.ceil((C.SAVE_HINT_DUR + 0.2) / ESCAPE.FIXED_DT));
    t.ok(pr.saveHintText() === '', 'P4.14 案内: 数秒で消える', pr.saveHintText());
    sim(g, Math.ceil(10 / ESCAPE.FIXED_DT));
    t.ok(pr.saveHintText() === '', 'P4.14 案内: 10秒後もまだ出ない（30秒に1回まで）', pr.saveHintText());
    var again = simUntil(g, function () { return pr.saveHintText() !== ''; },
      Math.ceil(40 / ESCAPE.FIXED_DT));
    t.ok(again >= 0, 'P4.14 案内: 30秒を越えると同じ端末で再び出る',
      (again >= 0) ? ((again * ESCAPE.FIXED_DT).toFixed(1) + 's 後に再表示') : '出なかった');
    t.ok(pr._saveHintAt[sp.id] - firstAt >= C.SAVE_HINT_COOLDOWN - 1e-6,
      'P4.14 案内: 前回の表示からちょうど30秒以上あけて出る',
      (pr._saveHintAt[sp.id] - firstAt).toFixed(2) + 's');
    t.ok(pr.saveHintText() === ESCAPE.PROGRESS_SAVE_HINT,
      'P4.14 案内: 再表示の文言も正文のまま', pr.saveHintText());

    /* 記録済みでは出ない */
    recordAt(g, sp);
    place(g, sp.col, sp.row, 0);
    sim(g, Math.ceil(35 / ESCAPE.FIXED_DT));
    t.ok(pr.saveHintText() === '', 'P4.14 案内: 記録済みの端末では出ない', pr.saveHintText());
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 記録: 「調べる」で記録＋正文の応答／記録済みは `記録済み`／セーブに永続する */
  function testP414SavePointRecord(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, U = ESCAPE.PROGRESS_UI_TEXT;
    t.ok(U.savePoint === '端末に記録する', 'P4.14 正文: プロンプトは `端末に記録する`', U.savePoint);
    t.ok(U.savedNow === '記録した —— ここから再開できる',
      'P4.14 正文: 記録の応答は `記録した —— ここから再開できる`', U.savedNow);
    t.ok(U.savedAlready === '記録済み', 'P4.14 正文: 記録済みの応答は `記録済み`', U.savedAlready);

    var sp = pr.savePoints[2];
    standAtTerminal(g, sp);
    sim(g, 2);
    var prompt = document.getElementById('prompt');
    t.ok(!!prompt && prompt.textContent === U.savePoint,
      'P4.14 記録: 端末を向くとプロンプトが出る', prompt ? prompt.textContent : 'DOMなし');

    t.ok(pr.onInteract() === true, 'P4.14 記録: 「調べる」が端末を処理する');
    t.ok(pr.saved[sp.id] === true, 'P4.14 記録: 記録集合に入る');
    t.ok(pr._flashMsg === U.savedNow, 'P4.14 記録: 応答が正文', pr._flashMsg);
    t.ok(pr.checkpoint === sp.id, 'P4.14 記録: 復帰地点がその端末になる', pr.checkpoint);

    /* 記録済みの端末を再度調べると `記録済み` */
    t.ok(recordAt(g, sp) === true, 'P4.14 記録: 記録済みでも「調べる」は処理される');
    t.ok(pr._flashMsg === U.savedAlready, 'P4.14 記録: 2回目の応答は `記録済み`', pr._flashMsg);

    /* セーブ→ロードで永続する */
    var raw = localStorage.getItem(SAVE_KEY);
    if (!t.ok(!!raw, 'P4.14 永続: 記録した瞬間にセーブされる')) { g.reset(); return; }
    var data = JSON.parse(raw);
    t.ok((data.savePoints || []).indexOf(sp.id) >= 0,
      'P4.14 永続: セーブデータに記録済み端末が入る', JSON.stringify(data.savePoints));
    t.ok(data.checkpoint === sp.id, 'P4.14 永続: 復帰地点も保存される', data.checkpoint);
    pr.reset(); g.rope.reset(); g.minimap.reset();
    t.ok(pr.checkpoint === null && Object.keys(pr.saved).length === 0,
      'P4.14 永続: reset() 直後は未記録（前提）');
    t.ok(pr.load() === true, 'P4.14 永続: セーブから復元できる');
    t.ok(pr.saved[sp.id] === true, 'P4.14 永続: 記録が復元される');
    t.ok(pr.checkpoint === sp.id, 'P4.14 永続: 復帰地点が復元される', pr.checkpoint);
    t.ok(g.player.col() === sp.col && g.player.row() === sp.row,
      'P4.14 永続: ロード時は復帰地点に配置される（旧「チェックポイントへ配置」は失効）',
      g.player.col() + ',' + g.player.row());

    /* 旧セーブ（checkpoint 文字列だけ）でも壊れない */
    pr.reset(); g.rope.reset(); g.minimap.reset();
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 3, mapId: g.mapId, checkpoint: sp.id,
      gimmick: { key: false, doorOpen: false }, notesRead: [], signsRead: [], cleared: false
    }));
    var threw = false, ok = false;
    try { ok = pr.load(); } catch (e) { threw = true; }
    t.ok(!threw && ok === true, 'P4.14 旧セーブ互換: checkpoint 文字列だけでも load() が通る');
    t.ok(pr.saved[sp.id] === true && pr.checkpoint === sp.id,
      'P4.14 旧セーブ互換: 旧 checkpoint は「記録済み端末1本」として読まれる', pr.checkpoint);
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 優先順: 手前の端末を後から記録しても、復帰地点は奥のまま */
  function testP414DeepestWins(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, list = pr.savePoints;
    var shallow = list[1], deep = list[4];
    t.ok(deep.order > shallow.order, 'P4.14 優先順: 検証用に手前と奥の端末が取れる',
      shallow.zone + '(' + shallow.order + ') < ' + deep.zone + '(' + deep.order + ')');
    t.ok(pr.respawnPoint().isSpawn === true,
      'P4.14 優先順: 未記録なら復帰地点はスタート', JSON.stringify(pr.respawnPoint()));
    recordAt(g, deep);
    t.ok(pr.checkpoint === deep.id, 'P4.14 優先順: 奥を記録すると復帰地点はそこ', pr.checkpoint);
    recordAt(g, shallow);
    t.ok(pr.saved[shallow.id] === true, 'P4.14 優先順: 手前も記録自体はされる');
    t.ok(pr.checkpoint === deep.id,
      'P4.14 優先順: 手前を**後から**記録しても復帰地点は奥のまま', pr.checkpoint);
    var rp = pr.respawnPoint();
    t.ok(rp.col === deep.col && rp.row === deep.row && rp.isSpawn === false,
      'P4.14 優先順: respawnPoint() が奥の端末を返す', rp.col + ',' + rp.row);
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 捕獲→復帰地点で目覚める／ロープの錨が移る／過去の周は残る／猶予の中心も復帰地点 */
  function testP414CaptureRespawn(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, rope = g.rope, st = g.stealth;
    var deep = pr.savePoints[4];
    recordAt(g, deep);
    /* 記録した端末から少し歩いて現在の周を伸ばす */
    var route = routeTo(g, deep.col, deep.row, deep.col, deep.row);
    if (route === null) { /* 同一マス。何もしない */ }
    var cells = g.map.walkableCells(), tgt = null;
    for (var i = 0; i < cells.length; i++) {
      if (Math.hypot(cells[i].col - deep.col, cells[i].row - deep.row) > 4 &&
          Math.hypot(cells[i].col - deep.col, cells[i].row - deep.row) < 7) { tgt = cells[i]; break; }
    }
    var path = tgt ? routeTo(g, g.player.col(), g.player.row(), tgt.col, tgt.row) : null;
    if (path && path.length) walkCells(g, path);
    var lapsBefore = rope.laps.length, stackBefore = rope.stack.length;
    t.ok(stackBefore > 1, 'P4.14 復帰: 検証用に現在の周を伸ばせた', stackBefore);

    t.ok(st.capture(g.ais.list[0]) === true, 'P4.14 復帰: 捕獲が始まる');
    t.ok(rope.laps.length === lapsBefore + 1, 'P4.14 復帰: 捕まった周は軌跡として残る',
      rope.laps.length);
    t.ok(rope.anchor.col === deep.col && rope.anchor.row === deep.row,
      'P4.14 復帰: 新しい周の錨が復帰地点へ移る',
      rope.anchor.col + ',' + rope.anchor.row + ' / ' + deep.col + ',' + deep.row);
    t.ok(rope.stack.length === 1 && rope.stack[0].col === deep.col && rope.stack[0].row === deep.row,
      'P4.14 復帰: 新しい周は復帰地点だけの状態で始まる');

    var done = simUntil(g, function () { return st.jail.phase === 'none'; },
      Math.ceil(g.cinematic.totalDur('jail') / ESCAPE.FIXED_DT) + 600);
    t.ok(done >= 0, 'P4.14 復帰: 演出が終わる', st.jail.phase);
    t.ok(g.player.col() === deep.col && g.player.row() === deep.row,
      'P4.14 復帰: 復帰地点で目覚める（スタートではない）',
      g.player.col() + ',' + g.player.row());
    var gr = g.ais.graceInfo ? g.ais.graceInfo() : null;
    if (gr) {
      var c = g.map.cellCenter(deep.col, deep.row);
      t.near(Math.hypot(gr.x - c.x, gr.z - c.z), 0, 1e-6,
        'P4.14 復帰: 復帰猶予の中心が復帰地点になる', gr.x.toFixed(1) + ',' + gr.z.toFixed(1));
    }
    t.ok(rope.laps.length === lapsBefore + 1, 'P4.14 復帰: 過去の周は復帰後も残っている',
      rope.laps.length);
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 方向色の連続性: 錨が移っても「最短ルートを進んでいれば緑」の意味が変わらない */
  function testP414TensionContinuity(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, rope = g.rope, map = g.map, meta = map.meta;
    var deep = pr.savePoints[4];
    rope._buildDistMaps();
    var W = map.width;
    var dSpawn = rope._distMap(meta.spawn.col, meta.spawn.row);
    var dAnchor = rope._distMap(deep.col, deep.row);
    var lead = dSpawn[deep.row * W + deep.col];
    t.ok(lead > 20, 'P4.14 連続性: 検証用に錨がスタートから十分離れている', lead);

    /* 錨から数マス離れた地点で、両方の錨のもとで「最短で来た」状態を作り比べる */
    var target = null, cells = map.walkableCells();
    for (var i = 0; i < cells.length; i++) {
      var e = cells[i], da = dAnchor[e.row * W + e.col];
      if (da >= 5 && da <= 9) { target = e; break; }
    }
    if (!t.ok(!!target, 'P4.14 連続性: 検証用の到達地点が取れる')) { g.reset(); return; }

    /* ケース1: 錨＝スタート／使用長＝スタートからの最短 */
    rope._setAnchor(meta.spawn.col, meta.spawn.row);
    rope.stack = [{ col: target.col, row: target.row }];
    rope._index = Object.create(null); rope._index[target.col + ',' + target.row] = 0;
    rope.used = dSpawn[target.row * W + target.col] * map.tileSize;
    rope._tension = null;
    var a = rope.computeTension();

    /* ケース2: 錨＝復帰地点／使用長＝錨からの最短 */
    rope._setAnchor(deep.col, deep.row);
    rope.stack = [{ col: target.col, row: target.row }];
    rope._index = Object.create(null); rope._index[target.col + ',' + target.row] = 0;
    rope.used = dAnchor[target.row * W + target.col] * map.tileSize;
    rope._tension = null;
    var b = rope.computeTension();

    t.near(a.ratio, 1.0, 1e-6, 'P4.14 連続性: 錨＝スタートで最短どおりなら率は1.00', a.ratio);
    t.near(b.ratio, 1.0, 1e-6, 'P4.14 連続性: 錨＝復帰地点でも最短どおりなら率は1.00', b.ratio);
    t.near(b.ratio, a.ratio, 1e-6, 'P4.14 連続性: 錨を変えても同じ位置で同じ tension 値',
      a.ratio.toFixed(6) + ' / ' + b.ratio.toFixed(6));
    t.ok(a.state === b.state && a.state === 'green',
      'P4.14 連続性: 錨を変えても同じ位置で同じ色（緑のまま）', a.state + ' / ' + b.state);
    t.near(b.leadTiles, lead, 1e-9, 'P4.14 連続性: 基準にスタート→錨の最短が足されている', b.leadTiles);
    t.near(a.leadTiles, 0, 1e-9, 'P4.14 連続性: 錨がスタートなら lead は0（従来と完全一致）');

    /* 錨に立った瞬間（使用長0）も緑（赤で目覚めない） */
    rope.stack = [{ col: deep.col, row: deep.row }];
    rope._index = Object.create(null); rope._index[deep.col + ',' + deep.row] = 0;
    rope.used = 0; rope._tension = null;
    t.ok(rope.computeTension().state === 'green',
      'P4.14 連続性: 復帰した瞬間（錨の上・使用長0）は緑', rope.computeTension().state);

    /* 遠回りすれば錨が移っていても黄/赤になる（判定が死んでいない） */
    var best = rope.computeTension().best;
    rope.stack = [{ col: target.col, row: target.row }];
    rope._index = Object.create(null); rope._index[target.col + ',' + target.row] = 0;
    rope.used = (dAnchor[target.row * W + target.col] * map.tileSize) * 1.0 +
      (b.best * 0.60);
    rope._tension = null;
    var c2 = rope.computeTension();
    t.ok(c2.ratio > ESCAPE.ROPE_TUNING.yellowRatio && c2.state === 'red',
      'P4.14 連続性: 錨が移っていても大きく遠回りすれば赤になる',
      c2.state + ' ratio=' + c2.ratio.toFixed(3) + ' best=' + best.toFixed(0));
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 3回目の捕獲＝エリアリセットで記録を全消去し、復帰地点がスタートへ戻る */
  function testP414AreaResetWipesSaves(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, rope = g.rope, meta = g.map.meta;
    recordAt(g, pr.savePoints[3]);
    recordAt(g, pr.savePoints[5]);
    t.ok(Object.keys(pr.saved).length === 2 && pr.checkpoint === pr.savePoints[5].id,
      'P4.14 リセット: 検証用に2本記録できた', pr.checkpoint);
    rope._setAnchor(pr.savePoints[5].col, pr.savePoints[5].row);
    g.stealth.areaReset();
    t.ok(Object.keys(pr.saved).length === 0, 'P4.14 リセット: 記録が全消去される',
      Object.keys(pr.saved).length);
    t.ok(pr.savePointsSeenCount === 0, 'P4.14 リセット: 地図の「発見済み」も消える',
      pr.savePointsSeenCount);
    t.ok(pr.checkpoint === null && pr.respawnPoint().isSpawn === true,
      'P4.14 リセット: 復帰地点がスタートへ戻る', pr.checkpoint);
    t.ok(rope.anchor.col === meta.spawn.col && rope.anchor.row === meta.spawn.row,
      'P4.14 リセット: ロープの錨もスタートへ戻る', rope.anchor.col + ',' + rope.anchor.row);
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 地図: 発見した端末だけが出る／復帰地点が縁取られる／星が目標に追従する */
  function testP414MapStarAndTerminals(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, mm = g.minimap, meta = g.map.meta;
    var goal0 = mm.goalCell();
    t.ok(!!goal0 && goal0.col === meta.keySafe.col && goal0.row === meta.keySafe.row &&
      goal0.kind === 'key',
      'P4.14 星: 鍵未取得なら目標は所長室の金庫', JSON.stringify(goal0));
    pr.gimmick.key = true;
    var goal1 = mm.goalCell();
    t.ok(!!goal1 && goal1.col === meta.exitPad.col && goal1.row === meta.exitPad.row &&
      goal1.kind === 'exit',
      'P4.14 星: 鍵取得後は目標が北の出口へ移る', JSON.stringify(goal1));
    pr.gimmick.key = false;

    var v = mm.view();
    t.ok(mm.goalStarSize(v) >= 6, 'P4.14 星: ミニマップでも読める大きさ', mm.goalStarSize(v).toFixed(1));
    /* 未踏破でも描かれる（踏破マスに依存しない） */
    t.ok(mm.isExplored(goal0.col, goal0.row) === false,
      'P4.14 星: 目標地点は未踏破のまま（前提）');
    var drew = false;
    try { mm.draw(); drew = true; } catch (e) { drew = false; }
    t.ok(drew, 'P4.14 星: 未踏破でも描画が通る（常時表示）');

    /* 端末は「発見したもの」だけ */
    t.ok(pr.savePointsSeenCount === 0, 'P4.14 地図: 初期は端末を1つも発見していない');
    var sp = pr.savePoints[0];
    place(g, sp.col, sp.row, 0);
    sim(g, 2);
    t.ok(pr.savePointsSeen[sp.id] === true && pr.savePointsSeenCount === 1,
      'P4.14 地図: 2マス以内に入った端末だけが発見済みになる', pr.savePointsSeenCount);
    recordAt(g, sp);
    t.ok(pr.checkpoint === sp.id, 'P4.14 地図: 記録した端末が現在の復帰地点（明るく縁取る対象）',
      pr.checkpoint);
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 【失効】自動チェックポイント: マスを踏んでも記録されない */
  function testP414AutoCheckpointRetired(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var pr = g.progress, sp = pr.savePoints[2];
    place(g, sp.col, sp.row, 0);
    sim(g, 6);
    t.ok(pr.saved[sp.id] !== true,
      'P4.14 失効: セーブポイントのマスを踏んでも自動記録されない');
    t.ok(pr.checkpoint === null,
      'P4.14 失効: 踏んだだけでは復帰地点が動かない', String(pr.checkpoint));
    t.ok(pr.respawnPoint().isSpawn === true,
      'P4.14 失効: 復帰地点はスタートのまま（記録しなければ変わらない）');
    t.ok(typeof pr._checkCheckpoint !== 'function',
      'P4.14 失効: 自動チェックポイントの処理そのものが消えている');
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** セーブ→(同一インスタンスで)ロード復元。新規タブでの「リロードで再開」に相当する経路 */
  function testSaveLoadRestore(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var cps = g.map.meta.checkpoints || [];
    var cp = cps[1] || cps[0];
    var meta = g.map.meta;
    /* 実際に歩いてロープと踏破を作る（保存対象の中身を本物にする） */
    walkCells(g, routeTo(g, meta.spawn.col, meta.spawn.row, 10, 46));
    var ropeCells = g.rope.stack.length, ropeUsed = g.rope.used;
    var explored = g.minimap.exploredCount;
    g.progress.gimmick.key = true;
    g.minimap.learnZone('C');
    g.progress.notesRead.a1_n5 = true;
    g.progress.signsRead.rs_C = true;
    /* P4.14: 復帰地点は「記録済みセーブポイントのうち最も奥」から引かれる */
    g.progress.saved[cp.id] = true;
    g.progress._syncRespawn();
    g.progress.save();

    var raw = localStorage.getItem(SAVE_KEY);
    if (!t.ok(!!raw, 'セーブデータが書き込まれている')) return;
    var parsed = JSON.parse(raw);
    t.ok(parsed.gimmick.key === true && parsed.gimmick.doorOpen === false,
      'セーブ内容: 鍵と隔壁の状態が記録される');
    t.ok(!!parsed.rope && parsed.rope.stack.length === ropeCells * 2,
      'セーブ内容: ロープの軌跡が記録される', parsed.rope && parsed.rope.stack.length);
    t.near(parsed.rope.used, ropeUsed, 1e-9, 'セーブ内容: 繰り出し量が記録される');
    t.ok(!!parsed.map && parsed.map.explored.length === explored,
      'セーブ内容: 地図の踏破が記録される', parsed.map && parsed.map.explored.length);
    t.ok(parsed.map.zones.join('') === 'C', 'セーブ内容: 判明した区画名が記録される',
      parsed.map.zones.join(''));
    t.ok(parsed.notesRead.join('') === 'a1_n5', 'セーブ内容: 既読メモが記録される');

    /* 「リロード」を模す: 同じインスタンスをメモリ上だけ初期状態へ戻してから load() する
       （実際のリロードは新しい Progress を作るが、DOM二重結線を避けるため経路のみ共有） */
    g.progress.reset();
    g.rope.reset();
    g.minimap.reset();
    t.ok(g.progress.gimmick.key === false && g.progress.checkpoint === null,
      'reset()直後は初期状態（前提）');
    var loaded = g.progress.load();
    t.ok(loaded === true, 'load(): セーブから復元できる');
    t.ok(g.progress.gimmick.key === true, 'load(): 鍵が復元される');
    t.ok(g.progress.notesRead.a1_n5 === true, 'load(): 既読メモが復元される');
    t.ok(g.progress.signsRead.rs_C === true, 'load(): 読んだ銘板が復元される');
    t.ok(g.minimap.exploredCount === explored, 'load(): 地図の踏破が復元される',
      g.minimap.exploredCount + ' / ' + explored);
    t.ok(g.minimap.knowsZone('C') === true, 'load(): 区画名が復元される');
    t.ok(g.rope.stack.length === ropeCells, 'load(): ロープの軌跡が復元される',
      g.rope.stack.length + ' / ' + ropeCells);
    t.near(g.rope.used, ropeUsed, 1e-9, 'load(): 繰り出し量が復元される');
    t.ok(g.progress.checkpoint === cp.id, 'load(): 復帰地点（セーブポイント）が復元される');
    t.ok(g.player.col() === cp.col && g.player.row() === cp.row,
      'load(): プレイヤーが復帰地点へ復元される', g.player.col() + ',' + g.player.row());

    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 契約 §2: 永続フラグには必ずリセット経路（データ全消去） */
  function testEraseAllData(t, g) {
    g.reset();
    g.progress.gimmick.key = true;
    g.progress.saved[g.map.meta.checkpoints[0].id] = true;
    g.progress._syncRespawn();
    g.progress.save();
    t.ok(!!localStorage.getItem(SAVE_KEY), 'セーブデータがある（前提）');
    g.progress.eraseAllData();
    t.ok(localStorage.getItem(SAVE_KEY) === null, 'データ全消去: localStorageから消える');
    t.ok(localStorage.getItem('escape.save.area1.v1') === null,
      'データ全消去: P4.7以前の旧セーブも消える');
    t.ok(g.progress.gimmick.key === false && g.progress.checkpoint === null,
      'データ全消去: 進行状態が初期化される');
    var sp = g.map.meta.spawn;
    t.ok(g.player.col() === sp.col && g.player.row() === sp.row,
      'データ全消去: プレイヤーがスポーンへ戻る（game.reset()経由）');
    g.reset();
  }

  /* ================================================================
   * P4.5: 音響＋恐怖演出（契約 DESIGN.md §4「音響と恐怖演出」）
   *
   * 検証方針:
   *   出力デバイスの無い環境では AudioContext の clock が凍結し gain 自動化が
   *   反映されない。したがって「音が鳴っているか」は OfflineAudioContext の
   *   レンダ結果（RMS/peak）でのみ数値判定する。ライブ側は
   *   「発火ロジックが正しく回るか・例外ゼロか」だけを見る。
   *   runAll 中は engine.testMode = true にして実出力を止める（runAll 側で設定）。
   * ============================================================== */

  var AUDIO_KEY = 'escape.audio.v1';

  /** 契約に列挙された音が全て実装されているか */
  function testAudioContract(t, g) {
    var A = ESCAPE.Audio, au = ESCAPE.audio;
    if (!t.ok(!!A && !!au, '音響: ESCAPE.Audio / ESCAPE.audio が存在する')) return;
    t.ok(typeof A.render === 'function', '音響: OfflineAudioContext レンダヘルパーがある');
    t.ok(A.MAX_VOICES > 0 && A.MAX_VOICES <= 48, '音響: 同時発音数の上限が設定されている', A.MAX_VOICES);
    /* 契約 §4 に列挙された音がすべて音色として存在すること */
    var need = ['footstep', 'noiseStep', 'breath', 'pant', 'heartbeat',
      'drip', 'metalFar',
      'enemyDrag', 'enemyMoan', 'enemyJoint', 'enemyClaw', 'boneCrack', 'scream',
      'sting', 'chaseRelease', 'capture',
      'lever', 'terminalKey', 'terminalErr', 'terminalOk',
      'handleCreak', 'doorRoar', 'alarm', 'pry', 'grateBreak',   /* pry/grateBreak は P4.8 で未使用（実装は残す） */
      'lockerDoor', 'boardCrash', 'paper', 'checkpoint',
      /* P4.6 捕獲シネマティック（契約 §4「金属の牢扉が閉まる音→鍵の音」「食われる」） */
      'cellDoor', 'cellLock', 'bite'];
    var missing = [];
    for (var i = 0; i < need.length; i++) if (typeof A.VOICES[need[i]] !== 'function') missing.push(need[i]);
    t.ok(missing.length === 0, '音響: 契約 §4 の全ての音が実装されている', missing.join(' / '));
    /* 床種4種（契約: タイル/金属/水たまり/ガラス片） */
    var mats = ['tile', 'metal', 'water', 'glass'], mm = [];
    for (var j = 0; j < mats.length; j++) if (!A.FLOOR_MAT[mats[j]]) mm.push(mats[j]);
    t.ok(mm.length === 0, '音響: 床種4種の足音パラメータがある', mm.join(' / '));
    /* 区画（帯）ごとの環境ドローン。P4.9: 帯 A〜F の6区画に必ず色味があり、互いに異なること
     * （個々の小部屋は既定のドローンにフォールバックしてよい）。 */
    var bands = (g.map.meta && g.map.meta.bands) || [];
    var noAmb = [], fset = {};
    for (var k = 0; k < bands.length; k++) {
      var amb = A.AMBIENCE[bands[k].id];
      if (!amb) { noAmb.push(bands[k].zone); continue; }
      fset[amb.f + '/' + amb.lp] = (fset[amb.f + '/' + amb.lp] || 0) + 1;
    }
    t.ok(bands.length === 6, '音響: 区画（帯）が6つ定義されている', bands.length);
    t.ok(noAmb.length === 0, '音響: 全ての区画（帯）に環境ドローンの色味が定義されている', noAmb.join(','));
    t.ok(Object.keys(fset).length === bands.length,
      '音響: 区画（帯）ごとにドローンの色味が異なる', Object.keys(fset).length + '/' + bands.length);
    /* 恐怖演出のDOM */
    t.ok(!!document.getElementById('fx-vignette') && !!document.getElementById('fx-flash') &&
      !!document.getElementById('fx-noise'), '演出: 減光・フラッシュ・ノイズのDOMが結線されている');
  }

  /** OfflineAudioContext レンダの RMS/peak を数値判定（契約 §4「検証」） */
  function testAudioRender(t) {
    var A = ESCAPE.Audio, C = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!t.ok(!!C, '音響: OfflineAudioContext が使える環境')) return;
    if (!t.ok(A.ready(), '音響: レンダキャッシュが揃っている（prewarm完了）',
      (A.prewarmError() || Object.keys(A.cache).length + '/' + A.prewarmList.length) +
      ' — 事前レンダは約0.25秒かかる。読み込み直後に実行するなら __test.runAllAsync() を使う')) return;
    var c = A.cache;

    function gate(key, minRms, minPeak) {
      var m = c[key];
      if (!m) { t.ok(false, '音響レンダ: ' + key + ' が無い'); return null; }
      t.ok(m.rms >= minRms && m.peak >= minPeak && m.peak <= 1.0 && !m.clipped,
        '音響レンダ: ' + key + ' の RMS/peak が範囲内',
        'rms=' + m.rms.toFixed(4) + ' peak=' + m.peak.toFixed(4) + ' (min ' + minRms + '/' + minPeak + ')');
      t.ok(m.onset >= 0 && m.onset < 0.30, '音響レンダ: ' + key + ' が時間内に発音する', 'onset=' + m.onset.toFixed(3));
      return m;
    }

    /* 足音3種（歩き/走り/しゃがみ） */
    var w = gate('step_walk', 0.004, 0.05);
    var r = gate('step_run', 0.008, 0.10);
    var cr = gate('step_crouch', 0.001, 0.01);
    if (w && r && cr) {
      t.ok(r.peak > w.peak && w.peak > cr.peak,
        '音響レンダ: 足音の大きさが 走り > 歩き > しゃがみ',
        r.peak.toFixed(3) + ' > ' + w.peak.toFixed(3) + ' > ' + cr.peak.toFixed(3));
      t.ok(r.rms > w.rms && w.rms > cr.rms, '音響レンダ: 足音のRMSも同じ順',
        r.rms.toFixed(4) + ' > ' + w.rms.toFixed(4) + ' > ' + cr.rms.toFixed(4));
    }
    /* 床種で音色が変わる（同じ音量指定でも波形が違う＝RMSが一致しない） */
    var mats = ['step_metal', 'step_water', 'step_glass'];
    var same = 0;
    for (var i = 0; i < mats.length; i++) {
      gate(mats[i], 0.002, 0.02);
      if (c[mats[i]] && w && Math.abs(c[mats[i]].rms - w.rms) < 1e-6) same++;
    }
    t.ok(same === 0, '音響レンダ: 床種ごとに音色（RMS）が異なる', same + '種がタイルと同一');
    /* 音地盤を走った時は強い音（普通の足音より大きい） */
    var ns = gate('noise_step', 0.010, 0.20);
    if (ns && w) t.ok(ns.peak > w.peak * 1.5, '音響レンダ: 音地盤踏みは通常の足音より明確に大きい',
      ns.peak.toFixed(3) + ' vs ' + w.peak.toFixed(3));
    /* 発見スティング・心拍・レバー・警報 */
    var st = gate('sting', 0.020, 0.30);
    var hb = gate('heartbeat', 0.010, 0.10);
    var lv = gate('lever', 0.030, 0.30);
    gate('alarm', 0.010, 0.10);
    gate('scream', 0.008, 0.10);
    gate('boneCrack', 0.004, 0.05);
    gate('capture', 0.020, 0.30);
    gate('drip', 0.004, 0.05);
    gate('doorRoar', 0.020, 0.30);
    gate('enemyMoan', 0.010, 0.10);
    gate('enemyClaw', 0.004, 0.05);
    gate('pry', 0.003, 0.03);
    gate('breath', 0.001, 0.01);
    /* P4.6: 牢扉・鍵・食われる */
    var cd = gate('cellDoor', 0.020, 0.40);
    gate('cellLock', 0.008, 0.15);
    var bt = gate('bite', 0.020, 0.40);
    if (cd && w) t.ok(cd.peak > w.peak * 2, '音響レンダ: 牢扉の金属音は足音より遥かに大きい',
      cd.peak.toFixed(3) + ' vs ' + w.peak.toFixed(3));
    if (bt && st) t.ok(bt.rms > st.rms * 0.8, '音響レンダ: 食われる音は刺し音に匹敵する厚み',
      bt.rms.toFixed(4) + ' vs ' + st.rms.toFixed(4));
    if (st && w) t.ok(st.peak > w.peak * 2, '音響レンダ: 発見スティングは足音より遥かに大きい',
      st.peak.toFixed(3) + ' vs ' + w.peak.toFixed(3));
    if (lv) t.ok(lv.activeRatio > 0.25, '音響レンダ: レバーは長く響く駆動音', lv.activeRatio.toFixed(3));
    if (hb) t.ok(hb.activeRatio > 0.05 && hb.activeRatio < 0.60, '音響レンダ: 心拍は二拍の短い音',
      hb.activeRatio.toFixed(3));
  }

  /** 音の情報設計（契約 §4「StereoPannerで方向、距離で減衰＋ローパス」） */
  function testAudioSpatial(t) {
    var A = ESCAPE.Audio;
    /* 方向: yaw=0 では前方が -Z・右が +X */
    t.ok(A.panFor(0, 0, 0, 5, 0) > 0.5, '空間化: 右にある音は右へ振れる', A.panFor(0, 0, 0, 5, 0).toFixed(3));
    t.ok(A.panFor(0, 0, 0, -5, 0) < -0.5, '空間化: 左にある音は左へ振れる', A.panFor(0, 0, 0, -5, 0).toFixed(3));
    t.near(A.panFor(0, 0, 0, 0, -5), 0, 1e-6, '空間化: 正面の音は中央');
    t.near(A.panFor(0, 0, 0, 0, 0), 0, 1e-9, '空間化: 同一地点は中央（0除算しない）');
    /* 180度振り向くと左右が入れ替わる。90度振り向くと真横の音は正面/背面になる */
    t.ok(A.panFor(0, 0, Math.PI, 5, 0) < -0.5, '空間化: 振り向くと左右が入れ替わる',
      A.panFor(0, 0, Math.PI, 5, 0).toFixed(3));
    t.near(A.panFor(0, 0, -Math.PI / 2, 5, 0), 0, 1e-6,
      '空間化: 音の方へ向き直すと中央に来る');
    t.ok(Math.abs(A.panFor(0, 0, 0, 5, 0)) <= 1, '空間化: パンは -1..1 に収まる');

    /* 距離減衰: 単調減少・上限距離でゼロ */
    var prev = Infinity, mono = true;
    for (var d = 0; d <= 30; d += 0.5) {
      var a = A.attenuationFor(d);
      if (a > prev + 1e-12) mono = false;
      prev = a;
      if (a < 0) mono = false;
    }
    t.ok(mono, '空間化: 距離減衰が単調に減る');
    t.near(A.attenuationFor(0), 1, 1e-9, '空間化: 距離0で減衰なし');
    t.near(A.attenuationFor(A.ATTEN_MAX), 0, 1e-9, '空間化: 上限距離でゼロ');
    t.near(A.attenuationFor(A.ATTEN_MAX + 5), 0, 1e-9, '空間化: 上限距離より遠くもゼロ');
    t.ok(A.attenuationFor(3) > A.attenuationFor(12) * 3, '空間化: 近い音が明確に大きい',
      A.attenuationFor(3).toFixed(3) + ' vs ' + A.attenuationFor(12).toFixed(3));

    /* ローパス: 遠いほど・遮蔽されるほど籠もる */
    t.ok(A.lowpassFor(1, false) > A.lowpassFor(12, false),
      '空間化: 遠い音ほど高域が落ちる', A.lowpassFor(1, false).toFixed(0) + ' > ' + A.lowpassFor(12, false).toFixed(0));
    t.ok(A.lowpassFor(6, true) < A.lowpassFor(6, false),
      '空間化: 壁越しは高域が落ちる（壁越しでも聞こえる＝無音にはしない）',
      A.lowpassFor(6, true).toFixed(0) + ' < ' + A.lowpassFor(6, false).toFixed(0));
    t.ok(A.lowpassFor(40, true) >= 180, '空間化: ローパスの下限を割らない', A.lowpassFor(40, true).toFixed(0));
    t.ok(A.OCCLUDE_GAIN > 0 && A.OCCLUDE_GAIN < 1,
      '空間化: 壁越しは減衰するが無音にはならない（敵の位置が分かる）', A.OCCLUDE_GAIN);
  }

  /** 状態遷移ごとの発音フックが呼ばれる（契約 §4） */
  function testAudioHooks(t, g) {
    g.reset();
    var au = ESCAPE.audio, ai = g.ai, st = g.stealth;
    var before = au.errors;

    function counted(name) { return au.events[name] || 0; }
    function delta(name, fn, label) {
      var n0 = counted(name);
      fn();
      t.ok(counted(name) > n0, '音響フック: ' + label + ' で ' + name + ' が発火する',
        n0 + ' -> ' + counted(name));
    }

    /* 発見 → 追跡（形態遷移は同じフレームで始まるので先に基準を取る） */
    var open = findTriple(g.map, false);
    var n0form = counted('form');
    delta('spot', function () {
      placeEnemy(g, open.col, open.row, -90);
      place(g, open.col + 2, open.row, 0);
      g.player.crouching = false;
      sim(g, 1);
    }, '巡回→追跡（発見）');
    t.ok(ai.state === 'chase', '音響フック: 追跡状態になっている（前提）', ai.state);

    /* 形態遷移（骨鳴り＋絶叫） */
    simUntil(g, function () { return (au.events.form || 0) > n0form; }, 60);
    t.ok((au.events.form || 0) > n0form, '音響フック: 形態遷移で form（骨鳴り＋絶叫）が発火する',
      n0form + ' -> ' + counted('form'));

    /* 追跡解除 */
    delta('lose', function () {
      var sp = g.map.meta.spawn;
      place(g, sp.col, sp.row, 0);
      simUntil(g, function () { return ai.state === 'search'; }, 400);
    }, '見失い→探索');

    /* 捕獲 */
    g.reset();
    delta('capture', function () { st.capture(); }, '捕獲');
    /* 【P4.8 失効】格子こじ開け(pry)・格子の破壊(grateBreak) は牢送りの廃止で
       到達不能になったため、フックの発火検査から外した。VOICES 側の実装は残っている。 */
    simUntil(g, function () { return st.jail.phase === 'none'; },
      Math.ceil((g.cinematic ? g.cinematic.totalDur('jail') : 3) / ESCAPE.FIXED_DT) + 400);

    /* 音地盤・センサー */
    g.reset();
    var noiseCell = (g.map.meta.noise || [])[0];
    delta('noiseStep', function () {
      place(g, noiseCell.col, noiseCell.row, 0);
      g.stealth.lastCell = ''; g.stealth.cellNoised = false;
      g.player.mode = 'run'; g.player.speed = 4.6;
      g.stealth._footstepNoise();
    }, '音地盤を走って踏む');
    var sensorCell = (g.map.meta.sensors || [])[0];
    delta('sensor', function () {
      place(g, sensorCell.col, sensorCell.row, 0);
      g.stealth.lastCell = ''; g.stealth.cellNoised = false;
      g.player.mode = 'run'; g.player.speed = 4.6;
      g.stealth._footstepNoise();
    }, 'センサーを走って通る');

    /* ロッカー・板 */
    g.reset();
    var lockers = g.map.meta.lockers || [], D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var lk = null, side = null;
    for (var i = 0; i < lockers.length && !lk; i++) {
      for (var d = 0; d < 4; d++) {
        var nc = lockers[i].col + D[d][0], nr = lockers[i].row + D[d][1];
        if (g.map.isWalkable(nc, nr)) { lk = lockers[i]; side = { col: nc, row: nr }; break; }
      }
    }
    if (lk) {
      delta('lockerIn', function () {
        place(g, side.col, side.row, 0);
        g.player.yaw = Math.atan2(-(lk.col - side.col), -(lk.row - side.row));
        st.onInteract();
      }, 'ロッカーに入る');
      delta('lockerOut', function () { st.onInteract(); }, 'ロッカーから出る');
    }
    var bd = (g.map.meta.boards || [])[0];
    var ap = bd ? approachTo(g.map, bd.col, bd.row) : null;
    if (ap) {
      delta('boardTopple', function () {
        place(g, bd.col + (ap.col - bd.col) / 2, bd.row + (ap.row - bd.row) / 2, ap.yawDeg);
        st.onInteract();
      }, '板を倒す');
    }
    /* 敵の足止め */
    g.reset();
    var b2 = g.stealth.boardAt(bd.col, bd.row);
    if (b2) {
      delta('stall', function () {
        g.stealth.topple(b2);
        placeEnemy(g, bd.col, bd.row - 4, 180);
        place(g, bd.col, bd.row + 6, 0);
        if (!g.map.isWalkable(bd.col, bd.row + 6)) place(g, bd.col, bd.row + 3, 0);
        ai.toChase();
        simUntil(g, function () { return ai.state === 'stalled'; }, 600);
      }, '敵が板に引っかかる');
    }

    /* 仕掛け（P4.8: 金庫 → 隔壁。旧7工程の音響フックは仕掛けごと失効した） */
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var safeG = gimmickOf(g, 'safe'), bulkG = gimmickOf(g, 'bulkhead');
    delta('terminalOk', function () { interactAt(g, safeG.col, safeG.row); }, '金庫を開けて鍵を得る');
    delta('handleCreak', function () {
      g.progress.gimmick.key = false;
      interactAt(g, bulkG.col, bulkG.row);          /* 鍵なし＝施錠の応答 */
      g.progress.gimmick.key = true;
    }, '施錠された隔壁を調べる');
    delta('doorRoar', function () { interactAt(g, bulkG.col, bulkG.row); }, '隔壁の解錠（轟音）');
    t.ok(g.progress.gimmick.doorOpen === true, '音響フック: 隔壁が実際に開いている（前提）');
    /* 【P4.12 失効】「ロープが張った瞬間の軋み(handleCreak)」。長さ制限の撤廃で鳴らなくなった。
       【P4.13 失効】結び目の拾い上げ(pickup)。ロープ側の音は「赤に入った瞬間の警告(terminalErr)」だけになる。 */
    g.reset();

    /* メモ・チェックポイント */
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var note = (g.map.meta.notes || [])[0];
    delta('noteOpen', function () { interactAt(g, note.col, note.row); }, 'メモを開く');
    delta('noteClose', function () { g.progress.onCloseTap(); }, 'メモを閉じる');
    /* P4.14: 効果音 checkpoint は「壁の記録端末に記録した瞬間」に鳴る
       （旧「チェックポイントのマスを踏んだ瞬間」は自動チェックポイントごと失効） */
    var cp = g.progress.savePoints[0];
    delta('checkpoint', function () {
      standAtTerminal(g, cp);
      g.progress.onInteract();
    }, 'セーブポイントに記録する');

    t.ok(au.errors === before, '音響: フックの一連で例外ゼロ', au.errors + ' (before ' + before + ')');
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** AudioContext 未解錠でも例外ゼロ・無音で通る（iOS Safari の既定状態） */
  function testAudioLocked(t, g) {
    g.reset();
    var au = ESCAPE.audio;
    var e0 = au.errors;
    t.ok(au.ctxLive() === null, '音響: テスト中は実出力しない（ctxLive が null）');
    /* 未解錠でも全ての音色を play() できる（例外ゼロ・null が返る） */
    var names = Object.keys(ESCAPE.Audio.VOICES), threw = null;
    try {
      for (var i = 0; i < names.length; i++) au.play(names[i], { x: g.player.x + 3, z: g.player.z });
      for (var j = 0; j < names.length; j++) au.play(names[j], {});
      au.event('spot', {}); au.event('unknown-event-name', {});
      au.step(1 / 60);
      au.cameraShake({ pitch: 0, yaw: 0, roll: 0 });
    } catch (err) { threw = err && err.message; }
    t.ok(threw === null, '音響: 未解錠でも発音呼び出しで例外が出ない', threw);
    t.ok(au.errors === e0, '音響: 未解錠での発音がエラーを積まない', au.errors + ' (before ' + e0 + ')');
    /* 未解錠でも「鳴らすと決めた」記録は積む＝発火ロジックを検証できる */
    t.ok((au.fired.footstep || 0) >= 0 && typeof au.fired === 'object', '音響: 発火カウンタが取れる');
    g.reset();
  }

  /** 同時発音数の上限管理（スマホ想定） */
  function testAudioVoiceCap(t) {
    var au = ESCAPE.audio, A = ESCAPE.Audio;
    au._live.length = 0;
    var d0 = au.dropped;
    var ok = 0;
    for (var i = 0; i < A.MAX_VOICES + 5; i++) if (au._alloc(0, 5000)) ok++;
    t.ok(ok === A.MAX_VOICES, '音響: 同時発音数が上限で頭打ちになる', ok + '/' + A.MAX_VOICES);
    t.ok(au.dropped > d0, '音響: 上限超過が記録される', (au.dropped - d0) + '件');
    /* 優先度つきは少しだけ通る（発見・捕獲・警報を落とさない） */
    t.ok(au._alloc(1, 5000) === true, '音響: 優先度つきの音は上限を超えても鳴らせる');
    au._live.length = 0;
    au.dropped = d0;
    t.ok(au._live.length === 0, '音響: ボイス管理を初期化できる');
  }

  /** 音量設定の保存・復元（契約 §4「マスター音量は設定に保持」） */
  function testAudioSettings(t) {
    var au = ESCAPE.audio;
    var keep = null;
    try { keep = global.localStorage.getItem(AUDIO_KEY); } catch (e) { /* noop */ }
    var v0 = au.getVolume();
    au.setVolume(0.42);
    t.near(au.getVolume(), 0.42, 1e-9, '音量: 設定できる');
    var raw = null;
    try { raw = global.localStorage.getItem(AUDIO_KEY); } catch (e2) { /* noop */ }
    if (t.ok(!!raw, '音量: localStorage へ保存される')) {
      var d = JSON.parse(raw);
      t.near(d.volume, 0.42, 1e-9, '音量: 保存内容が一致する');
    }
    au.volume = 0; au.muted = true;
    au._loadSettings();
    t.near(au.getVolume(), 0.42, 1e-9, '音量: 起動時に復元される');
    t.ok(au.muted === false, '音量: 消音状態も復元される');
    au.setVolume(1.5);
    t.near(au.getVolume(), 1, 1e-9, '音量: 範囲外は 0..1 に丸められる');
    au.setVolume(-1);
    t.near(au.getVolume(), 0, 1e-9, '音量: 負値は0に丸められる');
    /* 後始末（テストが利用者の設定を書き換えたままにしない） */
    au.setVolume(v0);
    try {
      if (keep === null) global.localStorage.removeItem(AUDIO_KEY);
      else global.localStorage.setItem(AUDIO_KEY, keep);
    } catch (e3) { /* noop */ }
  }

  /**
   * 音響ディレクタの発火ロジック。
   * 「Aが状態設定→Bの毎フレーム更新が上書き」型の回帰を検出する:
   *   心拍レートは距離で毎フレーム変わるが、累積器は発火時にしか減らないので鳴り続ける。
   */
  function testAudioDirector(t, g) {
    g.reset();
    var au = ESCAPE.audio, sp = g.map.meta.spawn;
    var open = findTriple(g.map, false);

    /**
     * 同じ通路を走り/歩き続ける（音響ディレクタは stepFrame 経由でしか動かないので
     * player.step() を直接叩く drive() は使えない）。
     * 進みすぎたら開始点へ戻す＝短い通路でも速度を保ったまま走り続けられる。
     */
    function travel(frames, running) {
      var sx = g.player.x, sz = g.player.z;
      g.input.moveY = 1;
      g.input._keyRun = !!running;
      for (var i = 0; i < frames; i++) {
        if (Math.hypot(g.player.x - sx, g.player.z - sz) > 2.4) { g.player.x = sx; g.player.z = sz; }
        sim(g, 1);
      }
      g.input.reset();
    }

    /* 足音: 歩けば鳴る・止まれば鳴らない。敵は止めて捕獲による中断を避ける */
    g.ai.manual = true;
    place(g, open.col, open.row, -90);           /* -90° = 前方が +X（findTriple の向き） */
    var f0 = au.fired.footstep || 0;
    travel(120, false);
    var nWalk = (au.fired.footstep || 0) - f0;
    t.ok(nWalk >= 2, '音響ディレクタ: 歩くと足音が繰り返し鳴る', nWalk + '歩');
    var f1 = au.fired.footstep || 0;
    sim(g, 60);
    t.ok((au.fired.footstep || 0) === f1, '音響ディレクタ: 止まると足音は鳴らない');

    /* 走ると歩きより歩数が増える（同じフレーム数で） */
    place(g, open.col, open.row, -90);
    var fr0 = au.fired.footstep || 0;
    travel(120, true);
    var nRun = (au.fired.footstep || 0) - fr0;
    t.ok(nRun > nWalk, '音響ディレクタ: 走ると足音の間隔が詰まる', nRun + ' > ' + nWalk);

    /* しゃがみでも鳴る（音量は小さい＝レンダ側で検証済み） */
    place(g, open.col, open.row, -90);
    var fc0 = au.fired.footstep || 0;
    g.input.crouchOn = true;
    travel(120, false);
    g.input.crouchOn = false;
    t.ok((au.fired.footstep || 0) > fc0, '音響ディレクタ: しゃがみ移動でも足音が鳴る',
      ((au.fired.footstep || 0) - fc0) + '歩');

    /* 息切れ: 走り続けると exertion が上がって pant が鳴る */
    place(g, open.col, open.row, -90);
    var p0 = au.fired.pant || 0;
    travel(300, true);
    t.ok(au.exertion > 0.42, '音響ディレクタ: 走り続けると息が上がる', au.exertion.toFixed(3));
    t.ok((au.fired.pant || 0) > p0, '音響ディレクタ: 息切れの音が鳴る',
      ((au.fired.pant || 0) - p0) + '回');
    /* 休むと息が戻る */
    g.input.reset();
    sim(g, 300);
    t.ok(au.exertion < 0.42, '音響ディレクタ: 休むと息が整う', au.exertion.toFixed(3));
    g.ai.manual = false;

    /* 心拍: 追跡中は鳴り続け、距離で速まる（毎フレームのレート更新で止まらない） */
    g.reset();
    placeEnemy(g, open.col, open.row, -90);
    place(g, open.col + 2, open.row, 0);
    g.player.crouching = false;
    sim(g, 1);
    var h0 = au.fired.heartbeat || 0;
    /* プレイヤーを固定したまま120フレーム（2秒）進める */
    for (var i = 0; i < 120; i++) {
      g.player.x = g.map.cellCenter(open.col + 2, open.row).x;
      g.player.z = g.map.cellCenter(open.col + 2, open.row).z;
      sim(g, 1);
    }
    var beats = (au.fired.heartbeat || 0) - h0;
    t.ok(beats >= 2, '音響ディレクタ: 追跡中は心拍が鳴り続ける（レート再設定で止まらない）', beats + '拍');
    t.ok(beats <= 8, '音響ディレクタ: 心拍が過剰に鳴らない', beats + '拍');

    /* 敵の徘徊音: 巡回で歩くたびに鳴る（プレイヤーは離れた位置＝捕獲されない） */
    g.reset();
    var d0 = (au.fired.enemyDrag || 0) + (au.fired.enemyClaw || 0);
    place(g, sp.col, sp.row, 0);
    sim(g, 240);
    t.ok((au.fired.enemyDrag || 0) + (au.fired.enemyClaw || 0) > d0,
      '音響ディレクタ: 敵の徘徊音が鳴る',
      ((au.fired.enemyDrag || 0) + (au.fired.enemyClaw || 0) - d0) + '回 / 敵 ' + g.ai.state);
    t.ok(g.stealth.jail.phase === 'none', '音響ディレクタ: 徘徊音の検証中に捕獲されていない');

    /* 床種の判定（音地盤のマスで water/glass が返る） */
    var noises = g.map.meta.noise || [];
    var kinds = {};
    for (var k = 0; k < noises.length; k++) kinds[au.floorMaterial(noises[k].col, noises[k].row)] = true;
    t.ok(kinds.water && kinds.glass, '音響ディレクタ: 音地盤の床種（水/硝子）を判定できる',
      Object.keys(kinds).join(','));
    var ramp = (g.map.meta.ramps || [])[0];
    t.ok(au.floorMaterial(ramp.c0 + 1, ramp.r0) === 'metal', '音響ディレクタ: 傾斜路は金属床の音になる');
    t.ok(au.floorMaterial(sp.col, sp.row) === 'tile', '音響ディレクタ: 通常の通路はタイルの音になる');

    /* 環境ドローン: 区画をまたぐと目標値が変わる */
    var w = g.world;
    var ra = w._regionAt(sp.col, sp.row);
    var rb = null;
    var regions = g.map.meta.regions || [];
    for (var r2 = 0; r2 < regions.length && !rb; r2++) if (regions[r2].id !== ra) rb = regions[r2].id;
    t.ok(!!ESCAPE.Audio.AMBIENCE[ra] && !!ESCAPE.Audio.AMBIENCE[rb] &&
      ESCAPE.Audio.AMBIENCE[ra].f !== ESCAPE.Audio.AMBIENCE[rb].f,
      '音響ディレクタ: 区画ごとにドローンの色味が違う', ra + ' vs ' + rb);

    /* 蛍光灯: 明滅器具の明滅レベルが時間で変化する（ジー音の同期元） */
    var flick = null;
    for (var fi = 0; fi < w.fixtures.length && !flick; fi++) if (w.fixtures[fi].state === 'flicker') flick = w.fixtures[fi];
    if (t.ok(!!flick, '音響ディレクタ: 明滅器具がある（ジー音の同期元）')) {
      var lvls = {};
      for (var ti = 0; ti < 40; ti++) lvls[w.flickerLevelAt(flick, ti * 0.037).toFixed(3)] = true;
      t.ok(Object.keys(lvls).length > 3, '音響ディレクタ: 明滅レベルが時間で変化する',
        Object.keys(lvls).length + '値');
      t.near(w.flickerLevelAt({ state: 'off' }, 0), 0, 1e-9, '音響ディレクタ: 消灯器具の明滅レベルは0');
    }
    g.reset();
  }

  /**
   * 環境音の情報設計（契約 §4）:
   *   区画ごとのドローン／明滅に同期する蛍光灯のジー音（近接で増大）／
   *   漆黒区画では環境音を絞って呼吸だけにする／ページ非表示で一時停止。
   * 出力デバイスに依存しないよう「鳴らすべき音量（target）」で判定する。
   */
  function testAudioAmbience(t, g) {
    g.reset();
    var au = ESCAPE.audio, w = g.world, map = g.map;

    function standAt(x, z, frames) {
      g.player.x = x; g.player.z = z;
      g.player.y = map.floorYAt(x, z);
      for (var i = 0; i < (frames || 30); i++) {
        g.player.x = x; g.player.z = z;
        sim(g, 1);
      }
    }
    function cellAt(col, row) { return map.cellCenter(col, row); }

    /* 区画をまたぐとドローンの目標音量・参照区画が切り替わる */
    var sp = map.meta.spawn;
    var c0 = cellAt(sp.col, sp.row);
    standAt(c0.x, c0.z, 40);
    var regionA = au.ambRegion, ambA = au.ambTarget;
    t.ok(ambA > 0, '環境音: 通常の通路でドローンが鳴る', ambA.toFixed(4));

    /* 漆黒区画: 環境音を絞り、呼吸を前に出す */
    var bz = (map.meta.blackZones || [])[0];
    if (t.ok(!!bz, '環境音: 漆黒区画がある（前提）')) {
      var cb = cellAt(bz.c0 + 1, bz.r0);
      t.ok(!!w._inBlackZone(bz.c0 + 1, bz.r0), '環境音: 漆黒区画の判定が効く');
      /* 呼吸の山を拾うため十分な時間を取る（呼吸周期は約4秒） */
      var peakNormal = 0;
      standAt(c0.x, c0.z, 1);
      for (var i = 0; i < 600; i++) { g.player.x = c0.x; g.player.z = c0.z; sim(g, 1); peakNormal = Math.max(peakNormal, au.breathTarget); }
      var ambNormal = au.ambTarget;
      var peakBlack = 0;
      for (var j = 0; j < 600; j++) { g.player.x = cb.x; g.player.z = cb.z; sim(g, 1); peakBlack = Math.max(peakBlack, au.breathTarget); }
      t.ok(au.ambTarget < ambNormal * 0.5, '環境音: 漆黒区画では環境音が絞られる',
        au.ambTarget.toFixed(4) + ' < ' + ambNormal.toFixed(4));
      t.ok(peakBlack > peakNormal * 1.5, '環境音: 漆黒区画では呼吸が前に出る',
        peakBlack.toFixed(5) + ' > ' + peakNormal.toFixed(5));
    }

    /* 蛍光灯のジー音: 明滅パターンに同期し、近接で増大・遠ざかると消える */
    g.reset();
    var flick = null;
    for (var fi = 0; fi < w.fixtures.length && !flick; fi++) if (w.fixtures[fi].state === 'flicker') flick = w.fixtures[fi];
    if (t.ok(!!flick, '環境音: 明滅器具がある（前提）')) {
      var lo = 1, hi = 0, tLo = 1, tHi = 0;
      g.player.x = flick.x; g.player.z = flick.z;
      for (var k = 0; k < 240; k++) {
        g.player.x = flick.x; g.player.z = flick.z;
        sim(g, 1);
        lo = Math.min(lo, au._buzzLevel); hi = Math.max(hi, au._buzzLevel);
        tLo = Math.min(tLo, au.buzzTarget); tHi = Math.max(tHi, au.buzzTarget);
      }
      t.ok(au.buzzDist < 1.5, '環境音: 直下の明滅器具を同期元にする', au.buzzDist.toFixed(2) + 'm');
      t.ok(lo < 0.30 && hi > 0.70, '環境音: 明滅レベルが上下する（ジー音の同期元）',
        lo.toFixed(3) + '..' + hi.toFixed(3));
      t.ok(tHi > tLo, '環境音: ジー音の音量が明滅に同期して上下する',
        tLo.toFixed(5) + '..' + tHi.toFixed(5));
      t.ok(tHi > 0.01, '環境音: 明滅器具の近くではジー音が聞こえる音量になる', tHi.toFixed(5));
      /* 遠ざかると消える。「最寄りの明滅器具」から最も遠い歩行可能マスで判定する
         （特定の1灯から遠いだけでは別の灯が近い場合があるので同期元の距離で選ぶ） */
      var flicks = [];
      for (var fj = 0; fj < w.fixtures.length; fj++) if (w.fixtures[fj].state === 'flicker') flicks.push(w.fixtures[fj]);
      var far = null, best = -1;
      var cells = map.walkableCells();
      for (var ci = 0; ci < cells.length; ci++) {
        var cc = map.cellCenter(cells[ci].col, cells[ci].row);
        var nd = Infinity;
        for (var fk = 0; fk < flicks.length; fk++) {
          var dd = Math.hypot(cc.x - flicks[fk].x, cc.z - flicks[fk].z);
          if (dd < nd) nd = dd;
        }
        if (nd > best) { best = nd; far = cc; }
      }
      standAt(far.x, far.z, 30);
      t.ok(au.buzzDist > 8, '環境音: 明滅器具から最も遠いマスを検証に使う', best.toFixed(1) + 'm');
      t.ok(au.buzzTarget < tHi * 0.25, '環境音: 明滅器具から離れるとジー音がほぼ消える',
        au.buzzTarget.toFixed(5) + ' << ' + tHi.toFixed(5));
      /* 到達半径の外では完全に無音になる（同期元を人為的に遠くへ置いて確認する） */
      var keepX = flicks[0].x, keepZ = flicks[0].z, moved = [];
      for (var fm = 0; fm < flicks.length; fm++) {
        moved.push([flicks[fm].x, flicks[fm].z]);
        flicks[fm].x += 10000; flicks[fm].z += 10000;
      }
      au._flickerFx = null;                    /* 索引を作り直させる */
      standAt(far.x, far.z, 5);
      t.near(au.buzzTarget, 0, 1e-12, '環境音: 到達半径の外ではジー音が完全に消える');
      for (var fr = 0; fr < flicks.length; fr++) { flicks[fr].x = moved[fr][0]; flicks[fr].z = moved[fr][1]; }
      au._flickerFx = null;
      t.ok(flicks[0].x === keepX && flicks[0].z === keepZ, '環境音: 検証で動かした器具を元に戻す');
    }

    /* 滴り・遠い金属音がランダム間隔で鳴る */
    g.reset();
    var d0 = au.fired.drip || 0, m0 = au.fired.metalFar || 0;
    g.ai.manual = true;                       /* 捕獲による中断を避ける */
    sim(g, 60 * 60);                          /* 60秒 */
    g.ai.manual = false;
    t.ok((au.fired.drip || 0) > d0, '環境音: 配管の滴りがランダム間隔で鳴る',
      ((au.fired.drip || 0) - d0) + '回/60s');
    t.ok((au.fired.metalFar || 0) > m0, '環境音: 遠い金属音が鳴る',
      ((au.fired.metalFar || 0) - m0) + '回/60s');

    /* ページ非表示で環境音を一時停止する */
    g.reset();
    var wasHidden = au.hidden;
    au.hidden = true;
    sim(g, 30);
    t.ok(au.ctxLive() === null, '環境音: 非表示中は発音経路を止める');
    au.hidden = wasHidden;
    sim(g, 5);
    t.ok(au.hidden === false, '環境音: 表示に戻ると再開できる状態になる');
    g.reset();
  }

  /** 恐怖演出（軽量）: 減光・微振動・FOV微増・フラッシュ／リセットで完全復帰 */
  function testFearFx(t, g) {
    g.reset();
    var au = ESCAPE.audio, fx = au.fx;
    t.near(fx.vignette, 0, 1e-9, '演出: リセット直後は減光ゼロ');
    t.near(fx.fovAdd, 0, 1e-9, '演出: リセット直後はFOV加算ゼロ');
    t.near(g.camera.fov, 75, 1e-6, '演出: リセット直後のFOVは基準値', g.camera.fov);

    /* 遠くにいる間は演出が控えめ */
    var sp = g.map.meta.spawn;
    place(g, sp.col, sp.row, 0);
    sim(g, 30);
    var farVig = au.fx.vignette;

    /* 発見されるとスティングのフラッシュ・ノイズ・振動が立つ */
    var open = findTriple(g.map, false);
    placeEnemy(g, open.col, open.row, -90);
    place(g, open.col + 2, open.row, 0);
    g.player.crouching = false;
    sim(g, 1);
    t.ok(au.fx.flash > 0.2, '演出: 発見でフラッシュが立つ', au.fx.flash.toFixed(3));
    t.ok(au.fx.noise > 0.2, '演出: 発見でノイズが立つ', au.fx.noise.toFixed(3));
    t.ok(au.fx.shakeImpulse > 0.2, '演出: 発見で振動が立つ', au.fx.shakeImpulse.toFixed(3));
    sim(g, 40);
    t.ok(au.fx.vignette > farVig, '演出: 敵が近いと周辺が減光する',
      au.fx.vignette.toFixed(3) + ' > ' + farVig.toFixed(3));
    t.ok(au.fx.fovAdd > 0.5, '演出: 追跡中はFOVが少し広がる', au.fx.fovAdd.toFixed(3));
    t.ok(g.camera.fov > 75.4, '演出: カメラのFOVに反映される', g.camera.fov.toFixed(2));
    var sh = { pitch: 0, yaw: 0, roll: 0 };
    au.cameraShake(sh);
    t.ok(Math.abs(sh.pitch) + Math.abs(sh.yaw) + Math.abs(sh.roll) > 0,
      '演出: カメラ揺れの値が出る');
    t.ok(Math.abs(sh.pitch) < 0.05 && Math.abs(sh.roll) < 0.05, '演出: 揺れは微振動の範囲',
      sh.pitch.toFixed(4));
    /* フラッシュ・ノイズは時間で減衰して消える */
    sim(g, 120);
    t.ok(au.fx.flash === 0 && au.fx.noise === 0, '演出: フラッシュ・ノイズが減衰して消える',
      au.fx.flash + '/' + au.fx.noise);

    /* 牢送り演出中は減光を敵に引っ張られない（暗転と二重にしない） */
    g.stealth.capture();
    sim(g, 30);
    t.ok(au.fx.dread < 0.55, '演出: 牢送り演出中は敵由来の恐怖演出を止める', au.fx.dread.toFixed(3));

    /* リセットで完全復帰 */
    g.reset();
    t.near(au.fx.vignette, 0, 1e-9, '演出: リセットで減光が戻る');
    t.near(au.fx.shake, 0, 1e-9, '演出: リセットで振動が戻る');
    t.near(au.fx.flash, 0, 1e-9, '演出: リセットでフラッシュが戻る');
    t.near(au.fx.black, 0, 1e-9, '演出: リセットで瞬間暗転が戻る');
    t.near(g.camera.fov, 75, 1e-6, '演出: リセットでFOVが基準値に戻る', g.camera.fov);
    var vg = document.getElementById('fx-vignette');
    t.ok(vg && (vg.style.opacity === '0.000' || Number(vg.style.opacity) === 0),
      '演出: リセットでDOMの減光も消える', vg && vg.style.opacity);
  }

  /** 巡回のランダム停止（「目撃」演出の素）。停止しても巡回は再開する */
  function testPatrolPause(t, g) {
    g.reset();
    var ai = g.ai, T = ESCAPE.ENEMY_TUNING;
    t.ok(T.patrolPauseFirst >= 5, '巡回停止: 最初の停止は巡回開始から十分後', T.patrolPauseFirst + 's');
    /* 3秒（=既存テストの巡回移動判定の長さ）では止まらない */
    var x0 = ai.enemy.x, z0 = ai.enemy.z;
    sim(g, 180);
    t.ok(ai.pauses === 0, '巡回停止: 開始直後は止まらない（既存の巡回テストを壊さない）', ai.pauses);
    t.ok(Math.hypot(ai.enemy.x - x0, ai.enemy.z - z0) > 1.0, '巡回停止: その間は歩いている');
    /* 十分な時間を進めれば必ず1回以上止まり、その間は動かない */
    var paused = simUntil(g, function () { return ai.pauseT > 0; },
      Math.ceil((T.patrolPauseFirst + 6) / ESCAPE.FIXED_DT));
    if (t.ok(paused >= 0, '巡回停止: 一定時間後に立ち止まる', ai.pauses + '回')) {
      var px = ai.enemy.x, pz = ai.enemy.z;
      sim(g, 30);
      t.ok(ai.state === 'patrol', '巡回停止: 停止中も巡回状態のまま', ai.state);
      t.ok(Math.hypot(ai.enemy.x - px, ai.enemy.z - pz) < 0.02, '巡回停止: 停止中は動かない',
        Math.hypot(ai.enemy.x - px, ai.enemy.z - pz).toFixed(4));
      t.near(ai.speed, 0, 1e-9, '巡回停止: 停止中の速度はゼロ');
      var resumed = simUntil(g, function () { return ai.pauseT <= 0 && ai.speed > 0.05; },
        Math.ceil((T.patrolPauseDur + T.patrolPauseDurVar + 3) / ESCAPE.FIXED_DT));
      t.ok(resumed >= 0, '巡回停止: 一定時間で巡回を再開する');
    }
    /* 発見されたら停止は無視して追跡へ */
    var open = findTriple(g.map, false);
    placeEnemy(g, open.col, open.row, -90);
    ai.pauseT = 5;
    place(g, open.col + 2, open.row, 0);
    g.player.crouching = false;
    sim(g, 1);
    t.ok(ai.state === 'chase', '巡回停止: 停止中でも発見すれば追跡へ移る', ai.state);
    g.reset();
    t.ok(ai.pauses === 0 && ai.pauseT === 0, '巡回停止: リセットで初期化される');
  }

  /* ---------------- 実行本体 ---------------- */


  /* ================================================================
   * P4.6: 捕獲シネマティック＋駆け引き強化（契約 DESIGN.md §4「捕獲演出と駆け引き」）
   * ============================================================== */

  /** 演出の段階遷移と所要時間（契約: 顔アップ0.4 → 首掴み2 → 引きずり3〜4 → 暗転1.5／合計7〜9秒） */
  function testCaptureCinematic(t, g) {
    var T = ESCAPE.ENEMY_TUNING, cine = g.cinematic;
    if (!t.ok(!!cine, '捕獲演出: モジュールが組み込まれている')) return;
    t.ok(T.cineZoomDur === 0.40, '捕獲演出: 追いつきは0.4秒（契約）', T.cineZoomDur);
    t.ok(T.cineGrabDur === 2.00, '捕獲演出: 首掴みは2秒（契約）', T.cineGrabDur);
    t.ok(T.cineDragDur >= 3.0 && T.cineDragDur <= 4.0, '捕獲演出: 引きずりは3〜4秒（契約）', T.cineDragDur);
    t.ok(T.cineBlackDur === 1.50, '捕獲演出: 暗転は1.5秒（契約）', T.cineBlackDur);
    var total = cine.totalDur('jail');
    t.ok(total >= 7.0 && total <= 9.0, '捕獲演出: 合計7〜9秒（契約）', total.toFixed(2) + 's');

    if (!t.ok(startCapture(g), '捕獲演出: 実追跡→接触で捕獲が始まる（前提）', g.stealth.jail.phase)) {
      g.reset(); return;
    }
    t.ok(cine.active() && cine.mode === 'jail', '捕獲演出: 牢送りモードで起動する', cine.mode);
    t.ok(cine.stage === 'zoom', '捕獲演出: 最初の段階は顔へのズーム', cine.stage);
    t.ok(g.ai.cine === true, '捕獲演出: 演出中は敵AIの駆動が止まる');
    var pe = { x: g.player.x, y: g.player.y + g.player.eyeHeight, z: g.player.z };

    var tr = traceCinematic(g, 1200);
    t.ok(tr.seq.join('>') === 'zoom>grab>drag>black',
      '捕獲演出: 段階が 顔アップ→首掴み→引きずり→暗転 の順で進む', tr.seq.join('>'));
    var names = ['zoom', 'grab', 'drag', 'black'];
    var keys = { zoom: T.cineZoomDur, grab: T.cineGrabDur, drag: T.cineDragDur, black: T.cineBlackDur };
    for (var i = 0; i < names.length; i++) {
      var got = tr.durs[names[i]];
      t.ok(got !== undefined && Math.abs(got - keys[names[i]]) <= 0.05,
        '捕獲演出: ' + names[i] + ' の所要時間が契約どおり',
        (got === undefined ? '未到達' : got.toFixed(3)) + 's / ' + keys[names[i]] + 's');
    }
    var real = tr.frames * ESCAPE.FIXED_DT;
    t.ok(real >= 7.0 && real <= 9.0, '捕獲演出: 実測の合計が7〜9秒', real.toFixed(2) + 's');

    t.ok(tr.handsSeen, '捕獲演出: 首掴みで敵の手が一人称視界に入る');
    t.ok(tr.lampsSeen, '捕獲演出: 引きずりで天井灯が流れる');
    t.ok(tr.shoulderSeen, 'P4.12 捕獲演出: 担ぎ運びで敵の肩と髪が視界下部に入る');
    t.ok(tr.carryLightSeen, 'P4.12 捕獲演出: 担ぎ運びの間はヘッドライト点灯扱い（暗くて読めない絵を作らない）');
    t.ok(tr.camGrab !== null && Math.hypot(tr.camGrab.x - pe.x, tr.camGrab.z - pe.z) > 0.12,
      '捕獲演出: 首掴みのカメラはプレイヤー位置から離れて敵の顔へ寄る');
    t.ok(Math.abs(tr.fovGrab - T.cineZoomFov) < 0.01, '捕獲演出: ズーム後のFOVが演出値になる', tr.fovGrab);
    t.ok(tr.camDrag !== null && tr.camCarryY > 1.55 && tr.camCarryY < 2.05,
      'P4.12 捕獲演出: 担ぎ運びのカメラは床から約1.8m（肩に担がれた視点）',
      tr.camCarryY.toFixed(2) + 'm');

    /* 暗転しきって「スタート地点での目覚め」へ接続される（P4.8改訂・旧牢送りは失効） */
    t.ok(g.stealth.jail.phase === 'wake' || g.stealth.jail.phase === 'none',
      '捕獲演出: 暗転の後は明転（wake）へ接続する', g.stealth.jail.phase);
    t.near(g.stealth.fade, 1, 0.06, '捕獲演出: 目覚めた瞬間は暗転しきっている');
    var sp3 = g.map.meta.spawn;
    t.ok(g.player.col() === sp3.col && g.player.row() === sp3.row,
      '捕獲演出: スタート地点で目が覚める', g.player.col() + ',' + g.player.row());
    t.ok(!cine.active(), '捕獲演出: 演出が終わっている');
    t.ok(g.ai.cine === false, '捕獲演出: 敵AIの駆動が戻る');
    var wake = simUntil(g, function () { return g.stealth.jail.phase === 'none'; }, 400);
    t.ok(wake >= 0, '捕獲演出: 明転して操作可能に戻る', g.stealth.jail.phase);
    g.reset();
  }

  /** 捕獲時限定の高解像度顔＋赤い目（契約: 通常時は絶対に出さない） */
  function testCaptureFaceDetail(t, g) {
    g.reset();
    var e = g.ai.enemy;
    t.ok(e.detailHi === false, '高解像度顔: 通常時は差し替わっていない');
    t.ok(e.redEyesVisible() === false, '赤い目: 通常時は出ない');
    var baseTri = e.activeTriangles();
    t.ok(baseTri === e.triangles, '赤い目: 通常時の三角形数に演出ぶんが乗らない', baseTri);
    var loGeo = e.faceMesh.geometry, loTex = e.mats.head.map;

    if (!t.ok(startCapture(g), '高解像度顔: 捕獲が始まる（前提）')) { g.reset(); return; }
    sim(g, 6);
    t.ok(e.detailHi === true, '高解像度顔: 演出中は高密度メッシュへ差し替わる');
    t.ok(e.faceMesh.geometry !== loGeo, '高解像度顔: 顔メッシュの実体が入れ替わっている');
    t.ok(e.faceMesh.geometry.index.count > loGeo.index.count,
      '高解像度顔: 演出用の顔の方が高密度',
      (e.faceMesh.geometry.index.count / 3) + ' vs ' + (loGeo.index.count / 3));
    t.ok(e.mats.head.map !== loTex, '高解像度顔: 頭部テクスチャも高解像度へ差し替わる');
    t.ok(e.mats.head.map.image.width >= 2048, '高解像度顔: 2048以上のテクスチャ',
      e.mats.head.map.image.width);
    t.ok(e.redEyesVisible() === true, '赤い目: 演出中は眼窩の奥に灯る');
    var add = e.activeTriangles() - e.triangles;
    t.ok(add > 0 && add <= 8000, '高解像度顔: 演出中の追加三角形は+8000以内（契約）', '+' + add);

    /* P4.6差し戻し: 「平坦な赤い円盤（LED）」への逆戻り検出。
       瞳は必ず暗く（sRGBの赤成分 <= 64）、発光は縁で 0 に落ちる加算層で作る。 */
    var srgb = function (v) { return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
    var ballMax = 0, opMax = 0, edgeMax = 0, k, L, s2;
    for (k = 0; k < 120; k++) {
      e.pulseEyes(k * 0.037, 1);
      ballMax = Math.max(ballMax, srgb(e.matEyeBall.color.r));
      for (s2 = 0; s2 < e.eyeSprites.length; s2++) {
        for (L = 0; L < e.eyeSprites[s2].length; L++) {
          opMax = Math.max(opMax, e.eyeSprites[s2][L].material.opacity);
        }
      }
    }
    /* 素材の縁（左端の中央）はアルファ0＝輪郭の立った円盤にならない */
    for (L = 0; L < e.eyeSprites[0].length; L++) {
      var im = e.eyeSprites[0][L].material.map.image;
      edgeMax = Math.max(edgeMax, im.getContext('2d').getImageData(0, im.height >> 1, 1, 1).data[3]);
    }
    t.ok(ballMax <= 64 && opMax <= 0.95 && edgeMax === 0,
      '赤い目: 瞳は暗いまま・発光は縁で消える加算層（赤いLED円盤への逆戻り検出）',
      '瞳' + ballMax + ' / 不透明度' + opMax.toFixed(2) + ' / 縁' + edgeMax);

    var tr = traceCinematic(g, 1200);
    t.ok(tr.redEyesSeen, '赤い目: 演出中に実際に表示されている');
    t.ok(tr.triPeak - e.triangles <= 8000, '高解像度顔: 演出中のピークでも+8000以内',
      '+' + (tr.triPeak - e.triangles));
    t.ok(e.detailHi === false, '高解像度顔: 演出後は通常の顔へ戻る');
    t.ok(e.redEyesVisible() === false, '赤い目: 演出後に残らない（契約）');
    t.ok(e.faceMesh.geometry === loGeo, '高解像度顔: 顔メッシュが元の実体に戻る');
    t.ok(e.mats.head.map === loTex, '高解像度顔: 頭部テクスチャが元に戻る');

    /* 演出の途中で reset しても残らない */
    startCapture(g);
    sim(g, 30);
    t.ok(e.redEyesVisible() === true, '赤い目: 途中中断の前提（表示中）');
    g.reset();
    t.ok(e.detailHi === false && e.redEyesVisible() === false,
      '赤い目: 演出途中のリセットでも残らない');
    t.ok(e.activeTriangles() === e.triangles, '高解像度顔: リセット後の三角形数が通常時に戻る');
    g.reset();
  }

  /** 連打は揺れを増すだけで結果を変えない（契約） */
  function testCaptureMash(t, g) {
    var T = ESCAPE.ENEMY_TUNING;
    function run(mash) {
      startCapture(g);
      var frames = Math.ceil((T.cineZoomDur + T.cineGrabDur * 0.5) / ESCAPE.FIXED_DT);
      for (var i = 0; i < frames; i++) {
        if (i === 3) for (var k = 0; k < mash; k++) g.stealth.onInteract();
        g.stepFrame(ESCAPE.FIXED_DT);
      }
      /* 揺れは「顔を見る基準姿勢」からのズレで測る */
      var d = g.camera.quaternion.angleTo(g.cinematic.q1);
      var out = { dev: d, mash: g.cinematic.mash, stage: g.cinematic.stage };
      simCapture(g);
      out.phase = g.stealth.jail.phase;
      out.captures = g.stealth.captures;
      out.cell = g.player.col() + ',' + g.player.row();
      return out;
    }
    var a = run(0), b = run(12);
    t.ok(a.stage === 'grab' && b.stage === 'grab', '連打: 首掴みの最中で比較している', a.stage + '/' + b.stage);
    t.ok(b.mash > a.mash, '連打: 連打が演出に届いている', a.mash + ' -> ' + b.mash);
    t.ok(b.dev > a.dev * 1.15, '連打: 揺れが強まる',
      a.dev.toFixed(4) + ' -> ' + b.dev.toFixed(4));
    t.ok(a.phase === b.phase && a.captures === b.captures && a.cell === b.cell,
      '連打: 結果（牢送り先・捕獲回数）は変わらない',
      a.phase + '/' + a.cell + ' vs ' + b.phase + '/' + b.cell);
    g.reset();
  }

  /** 3回目は食われる → GAME OVER（正文）→ エリア最初から */
  function testEatenGameOver(t, g) {
    var T = ESCAPE.ENEMY_TUNING, cine = g.cinematic, st = g.stealth;
    if (!t.ok(startCapture(g, T.captureLimit - 1), '食われる: 3回目の捕獲が始まる（前提）')) { g.reset(); return; }
    t.ok(cine.mode === 'eaten', '食われる: 3回目は食われる演出に差し替わる', cine.mode);
    var tr = traceCinematic(g, 1200);
    t.ok(tr.seq.join('>') === 'zoom>grab>maw>black',
      '食われる: 顔アップ→首掴み→口→暗転 の順で進む', tr.seq.join('>'));
    t.ok(tr.mawSeen, '食われる: 歯列（口）が画面に出る');
    t.ok(tr.triPeak - g.ai.enemy.triangles <= 8000,
      '食われる: 顔＋赤い目＋手＋口を同時に出しても追加三角形は+8000以内（契約）',
      '+' + (tr.triPeak - g.ai.enemy.triangles));
    t.ok(tr.redEyesSeen, '食われる: 赤い目が出ている');
    t.ok(st.jail.phase === 'over', '食われる: ゲームオーバー状態になる', st.jail.phase);

    /* 正文（docs/notes.md「回収完了」節）が一字一句そのまま出る */
    var ov = document.getElementById('gameover-overlay');
    t.ok(!!ov && ov.classList.contains('show'), 'ゲームオーバー: 画面が表示される');
    t.ok(document.getElementById('gameover-title').textContent === '回収完了',
      'ゲームオーバー: 見出しが正文どおり', document.getElementById('gameover-title').textContent);
    t.ok(document.getElementById('gameover-sub').textContent === '移送対象 No.7 —— 拘束区画へ',
      'ゲームオーバー: 副題が正文どおり', document.getElementById('gameover-sub').textContent);
    t.ok(document.getElementById('gameover-hint').textContent === 'タップで最初から',
      'ゲームオーバー: 操作案内が正文どおり', document.getElementById('gameover-hint').textContent);

    /* 待っても勝手に進まない（入力待ち） */
    sim(g, 180);
    t.ok(st.jail.phase === 'over', 'ゲームオーバー: 入力があるまで待ち続ける', st.jail.phase);
    t.near(st.fade, 1, 1e-9, 'ゲームオーバー: 暗転したまま');

    /* タップ/E/クリック → エリア最初から（既存のリセット経路） */
    g.progress.flags.eatTest = 1;
    t.ok(st.onInteract() === true, 'ゲームオーバー: 操作を受け付ける');
    t.ok(st.areaResets >= 1, 'ゲームオーバー: エリアリセットが走る', st.areaResets);
    t.ok(st.captures === 0, 'ゲームオーバー: 捕獲回数が戻る', st.captures);
    t.ok(!g.progress.flags.eatTest, 'ゲームオーバー: エリア最初からの扱いになる');
    t.ok(!ov.classList.contains('show'), 'ゲームオーバー: 画面が閉じる');
    var sp = g.map.meta.spawn;
    t.ok(g.player.col() === sp.col && g.player.row() === sp.row,
      'ゲームオーバー: エリア最初のスポーンへ戻る', g.player.col() + ',' + g.player.row());
    var done = simUntil(g, function () { return st.jail.phase === 'none'; }, 300);
    t.ok(done >= 0, 'ゲームオーバー: 明転して操作可能に戻る', st.jail.phase);
    t.ok(g.ai.state === 'patrol' && g.ai.form === 'stand', 'ゲームオーバー: 敵も初期状態へ戻る', g.ai.state);
    t.ok(g.ai.enemy.redEyesVisible() === false, 'ゲームオーバー: 赤い目が残らない');
    g.reset();
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 無効環境は対象外 */ }
  }

  /** 演出中の割り込み（再捕獲・音イベント・runAllのreset）で状態が壊れない */
  function testCaptureInterrupt(t, g) {
    var st = g.stealth, ai = g.ai, cine = g.cinematic;
    if (!t.ok(startCapture(g), '演出割り込み: 捕獲が始まる（前提）')) { g.reset(); return; }
    sim(g, 20);
    var ex = ai.enemy.x, ez = ai.enemy.z;
    t.ok(st.capture() === false, '演出割り込み: 演出中の再捕獲は無視される');
    t.ok(st.captures === 1, '演出割り込み: 再捕獲で回数が増えない', st.captures);
    /* 音イベントが飛んでも敵は演出から抜けない */
    ESCAPE.noise.emit(ai.enemy.x + 3, ai.enemy.z + 1, 30, 'test');
    sim(g, 10);
    t.ok(ai.state === 'caught', '演出割り込み: 音イベントで状態が動かない', ai.state);
    t.ok(cine.active(), '演出割り込み: 演出は続いている', cine.stage);
    /* プレイヤーは動かない（中断安全） */
    var px = g.player.x, pz = g.player.z;
    g.input.moveY = 1;
    sim(g, 30);
    g.input.reset();
    t.near(Math.hypot(g.player.x - px, g.player.z - pz), 0, 1e-9, '演出割り込み: 操作しても動かない');
    t.ok(st.onInteract() === true, '演出割り込み: 演出中の「調べる」は握り潰される');
    t.ok(st.jail.pry === 0, '演出割り込み: こじ開けは進まない', st.jail.pry);

    /* 演出の途中で reset（runAll と同じ経路） */
    g.reset();
    t.ok(!cine.active() && cine.stage === 'none', '演出割り込み: リセットで演出が解除される', cine.stage);
    t.ok(st.jail.phase === 'none' && st.fade === 0, '演出割り込み: 暗転が消える', st.jail.phase);
    t.ok(ai.cine === false, '演出割り込み: 敵AIの駆動が戻る');
    t.ok(ai.enemy.redEyesVisible() === false, '演出割り込み: 赤い目が残らない');
    t.near(g.camera.fov, 75, 1e-6, '演出割り込み: カメラのFOVが基準値へ戻る', g.camera.fov);
    var ov = document.getElementById('gameover-overlay');
    t.ok(!ov.classList.contains('show'), '演出割り込み: ゲームオーバー画面が残らない');
    /* 演出後のカメラがプレイヤー追従に戻る */
    sim(g, 2);
    t.near(g.camera.position.x, g.player.x, 1e-6, '演出割り込み: カメラがプレイヤー追従へ戻る');

    /* ゲームオーバー画面の途中で reset しても壊れない */
    startCapture(g, ESCAPE.ENEMY_TUNING.captureLimit - 1);
    simCapture(g);
    t.ok(st.jail.phase === 'over', '演出割り込み: ゲームオーバー中である（前提）', st.jail.phase);
    g.reset();
    t.ok(st.jail.phase === 'none' && !ov.classList.contains('show'),
      '演出割り込み: ゲームオーバー中のリセットで完全復帰する', st.jail.phase);
    t.ok(ex !== undefined && ez !== undefined, '演出割り込み: 検証が最後まで走った');
    g.reset();
    try { localStorage.removeItem(SAVE_KEY); } catch (e2) { /* 無効環境は対象外 */ }
  }

  /** 音 → 反転形態に落ちて疾走（契約 §4「音→敵が飛んでくる」。歩く調査は廃止） */
  function testNoiseSprint(t, g) {
    g.reset();
    var ai = g.ai, T = ESCAPE.ENEMY_TUNING;
    t.ok(T.investigateSpeed >= T.chaseSpeed * 0.90,
      '音→疾走: 調査速度が追跡並みに引き上げられている',
      T.investigateSpeed + ' / ' + T.chaseSpeed);
    t.ok(T.investigateSpeed > T.patrolSpeed * 2.5,
      '音→疾走: 歩く調査（旧仕様）ではない', T.investigateSpeed + ' vs 巡回' + T.patrolSpeed);

    /* 遠くで音を鳴らす（見えない位置） */
    var e = ai.enemy;
    var cells = g.map.walkableCells(), spot = null;
    for (var i = 0; i < cells.length && !spot; i++) {
      var c = g.map.cellCenter(cells[i].col, cells[i].row);
      var d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d < 10 || d > 16) continue;
      if (!ai.blockedLine(e.x, e.z, c.x, c.z)) continue;
      /* P4.10: 敵が複数いるので、検証する個体（g.ai）自身の縄張りの中に音源を取る */
      if (ai.territory && (cells[i].row < ai.territory.r0 || cells[i].row > ai.territory.r1)) continue;
      spot = { col: cells[i].col, row: cells[i].row, x: c.x, z: c.z };
    }
    if (!t.ok(!!spot, '音→疾走: 検証に使える音源マスがある')) { g.reset(); return; }
    /* プレイヤーは音源とは無関係の遠方に置く（発見されないこと） */
    var sp = g.map.meta.spawn;
    place(g, sp.col, sp.row, 0);
    ESCAPE.noise.emit(spot.x, spot.z, 40, 'test');
    sim(g, 1);
    t.ok(ai.state === 'investigate', '音→疾走: 音で調査状態になる', ai.state);
    t.ok(ai.form === 'crawl', '音→疾走: その場で反転形態へ落ちる（契約）', ai.form);
    var toCrawl = simUntil(g, function () { return ai.enemy.state !== 'trans'; }, 240);
    t.ok(toCrawl >= 0, '音→疾走: 形態遷移が完走する', ai.enemy.state);
    t.near(ai.enemy.poseT, 1, 1e-9, '音→疾走: 反転形態になりきる');

    /* 遷移後の実速度を測る */
    var x0 = ai.enemy.x, z0 = ai.enemy.z, N = 45;
    sim(g, N);
    var v = Math.hypot(ai.enemy.x - x0, ai.enemy.z - z0) / (N * ESCAPE.FIXED_DT);
    t.ok(v > T.patrolSpeed * 1.8, '音→疾走: 音源へ疾走する（巡回より遥かに速い）',
      v.toFixed(2) + ' m/s');
    t.ok(ai.state === 'investigate' || ai.state === 'search',
      '音→疾走: 音源へ向かっている', ai.state);

    /* 到着 → 探索8秒 → 直立へ戻り巡回（契約）。
     * P4.9: マップが80x80になったので「音源まで走る時間」を距離から見積もる（固定枠だと足りない）。 */
    var far = Math.hypot(ai.enemy.x - spot.x, ai.enemy.z - spot.z);
    var travel = Math.ceil(far / Math.max(0.5, T.investigateSpeed || T.chaseSpeed || 5) / ESCAPE.FIXED_DT * 2.5) + 900;
    var toSearch = simUntil(g, function () { return ai.state === 'search'; }, travel);
    t.ok(toSearch >= 0, '音→疾走: 到着後は音源周辺の探索へ移る', ai.state);
    var toPatrol = simUntil(g, function () { return ai.state === 'patrol'; },
      Math.round(T.searchDur / ESCAPE.FIXED_DT) + travel);
    t.ok(toPatrol >= 0, '音→疾走: 探索の後は巡回へ戻る', ai.state);
    var back = simUntil(g, function () { return ai.form === 'stand' && ai.enemy.poseT < 1e-6; }, 300);
    t.ok(back >= 0, '音→疾走: 巡回では直立へ戻る', 'poseT=' + ai.enemy.poseT.toFixed(3));
    g.reset();
  }

  /** ロッカーの駆け引き（契約 §4「見た＝開けて引きずり出す / 見られていなければ安全」） */
  function testLockerSeen(t, g) {
    var T = ESCAPE.ENEMY_TUNING;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    /* 隣接マスから入れるロッカーを探す */
    function lockerWithSide() {
      var lockers = g.map.meta.lockers || [];
      for (var i = 0; i < lockers.length; i++) {
        for (var d = 0; d < 4; d++) {
          var nc = lockers[i].col + D[d][0], nr = lockers[i].row + D[d][1];
          if (g.map.isWalkable(nc, nr) && !g.map.isBlocked(nc, nr)) {
            return { lk: lockers[i], side: { col: nc, row: nr } };
          }
        }
      }
      return null;
    }
    /* プレイヤー位置(px,pz)を見通せる敵の立ち位置 */
    function watchSpot(px, pz, maxD) {
      var cells = g.map.walkableCells();
      for (var i = 0; i < cells.length; i++) {
        var c = g.map.cellCenter(cells[i].col, cells[i].row);
        var d = Math.hypot(c.x - px, c.z - pz);
        if (d < 2.4 || d > maxD) continue;
        if (g.ai.blockedLine(c.x, c.z, px, pz)) continue;
        return cells[i];
      }
      return null;
    }
    function faceLocker(lk, side) {
      place(g, side.col, side.row, 0);
      g.player.yaw = Math.atan2(-(lk.col - side.col), -(lk.row - side.row));
      g.player.crouching = false;
    }

    g.reset();
    var found = lockerWithSide();
    if (!t.ok(!!found, 'ロッカー: 検証に使えるロッカーがある')) { g.reset(); return; }
    var lk = found.lk, side = found.side;
    var sc = g.map.cellCenter(side.col, side.row);

    /* --- ケースA: 見られずに入る → 安全 --- */
    g.reset();
    var far = g.map.meta.enemySpawn;
    placeEnemy(g, far.col, far.row, 180);
    faceLocker(lk, side);
    t.ok(g.stealth.onInteract(), 'ロッカー（安全）: 入れる');
    t.ok(g.stealth.inLocker(), 'ロッカー（安全）: 隠れている');
    t.ok(g.stealth.lockerSeen === false, 'ロッカー（安全）: 入る瞬間を見られていない');
    t.ok(g.ai.state !== 'locker', 'ロッカー（安全）: 敵はロッカーへ来ない', g.ai.state);
    sim(g, 600);
    t.ok(g.stealth.captures === 0, 'ロッカー（安全）: 見られずに入れば捕まらない（契約）', g.stealth.captures);
    t.ok(g.stealth.inLocker(), 'ロッカー（安全）: 隠れたままでいられる');

    /* --- ケースB: 入る瞬間を見られる → 開けられて引きずり出される --- */
    g.reset();
    var spot = watchSpot(sc.x, sc.z, 4.2);
    if (!t.ok(!!spot, 'ロッカー（見られる）: 敵の見張り位置が取れる')) { g.reset(); return; }
    placeEnemy(g, spot.col, spot.row, 0);
    faceLocker(lk, side);
    var ec = g.map.cellCenter(spot.col, spot.row);
    g.ai.enemy.facing = Math.atan2(-(sc.x - ec.x), -(sc.z - ec.z));
    g.ai.state = 'patrol'; g.ai.stateTime = 0;
    if (!t.ok(g.ai.canSeePlayer(), 'ロッカー（見られる）: 敵から見えている（前提）',
      'd=' + Math.hypot(sc.x - ec.x, sc.z - ec.z).toFixed(2) + ' 視界' + g.ai.sightRange().toFixed(2))) {
      g.reset(); return;
    }
    t.ok(g.stealth.onInteract(), 'ロッカー（見られる）: 入れる');
    t.ok(g.stealth.lockerSeen === true, 'ロッカー（見られる）: 入る瞬間を見られた判定になる');
    t.ok(g.ai.state === 'locker', 'ロッカー（見られる）: 敵がそのロッカーへ向かう', g.ai.state);
    t.ok(g.ai.lockerTarget.col === lk.col && g.ai.lockerTarget.row === lk.row,
      'ロッカー（見られる）: 対象は入られたロッカー');
    var caught = simUntil(g, function () { return g.stealth.captures > 0; }, 1400);
    t.ok(caught >= 0, 'ロッカー（見られる）: 開けて引きずり出される（捕獲）',
      'ai=' + g.ai.state + ' opens=' + g.ai.lockerOpens);
    t.ok(g.stealth.lockerCaptures === 1, 'ロッカー（見られる）: ロッカーからの捕獲として記録される',
      g.stealth.lockerCaptures);
    t.ok(!g.stealth.inLocker(), 'ロッカー（見られる）: ロッカーから引きずり出されている');
    t.ok(g.cinematic.active() || g.stealth.jail.phase !== 'none',
      'ロッカー（見られる）: 捕獲シネマティックへ繋がる', g.stealth.jail.phase);
    simUntil(g, function () { return g.stealth.jail.phase === 'none'; },
      Math.ceil((g.cinematic ? g.cinematic.totalDur('jail') : 3) / ESCAPE.FIXED_DT) + 400);
    t.ok(g.stealth.jail.phase === 'none' &&
      g.player.col() === g.map.meta.spawn.col && g.player.row() === g.map.meta.spawn.row,
      'ロッカー（見られる）: 捕獲からスタート復帰まで通る',
      g.stealth.jail.phase + ' ' + g.player.col() + ',' + g.player.row());

    /* --- 探索中の「覗き」: 近くのロッカーを1つ開ける --- */
    g.reset();
    t.ok(T.lockerPeekChance > 0 && T.lockerPeekChance <= 1,
      'ロッカー覗き: 確率が調整定数にある', T.lockerPeekChance);
    var near = watchSpot(g.map.cellCenter(lk.col, lk.row).x, g.map.cellCenter(lk.col, lk.row).z, 7.0);
    if (near) {
      placeEnemy(g, near.col, near.row, 0);
      place(g, g.map.meta.spawn.col, g.map.meta.spawn.row, 0);
      var lcc = g.map.cellCenter(lk.col, lk.row);
      var peeked = -1, wasHunt = false;
      /* 覗きは確率なので、毎回ロッカーの近くへ置き直して何度か試す
         （試行のたびに敵が巡回で離れると対象が見つからなくなるため） */
      for (var k = 0; k < 10 && peeked < 0; k++) {
        placeEnemy(g, near.col, near.row, 0);
        g.ai.lastSeen = { x: lcc.x, z: lcc.z };
        g.ai.toSearch();
        g.ai.peekDone = false;
        peeked = simUntil(g, function () {
          if (g.ai.state === 'locker') wasHunt = true;
          return g.ai.lockerOpens > 0;
        }, 600);
      }
      t.ok(peeked >= 0, 'ロッカー覗き: 探索中に近くのロッカーを開けて覗く', g.ai.lockerOpens);
      t.ok(wasHunt, 'ロッカー覗き: 覗きに行く状態を経由する');
      t.ok(g.stealth.captures === 0, 'ロッカー覗き: 覗きだけでは捕獲しない', g.stealth.captures);
    }
    g.reset();
  }

  /* ================================================================
   * P4.8: アリアドネ方式のマップ改訂（契約 DESIGN.md §4 / §3 / §6）
   *
   * 【失効】testArea1V2Contract（保管庫・ポンプ室・排水路・カードキー施錠の検査）は
   *   排水路と施錠の撤去により失効。所長室の増築と迷路の数値基準を以下で検査する。
   * ============================================================== */

  /** 所長室の増築・排水路の撤去のあとも §3 の迷路数値基準を満たすこと */
  function testArea1V3Contract(t) {
    var map = ESCAPE.Maps.load('area1'), TILE = ESCAPE.TILE, meta = map.meta;

    var store = null, pump = null, director = null, office = null, drain = null;
    var rs = meta.regions || [];
    for (var i = 0; i < rs.length; i++) {
      if (rs[i].id === 'store') store = rs[i];
      if (rs[i].id === 'pump') pump = rs[i];
      if (rs[i].id === 'director') director = rs[i];
      if (rs[i].id === 'office') office = rs[i];
      if (rs[i].id === 'drain') drain = rs[i];
    }
    t.ok(!!director, 'v3: 所長室の区画が定義されている');
    t.ok(!!office, 'v3: 記録室の区画が残っている');
    t.ok(!drain, 'v3: 排水路の区画が撤去されている');
    t.ok(!!store && !!pump, 'v3: 保管庫・循環ポンプ室の造形は残置されている');
    /* P4.9（DESIGN.md §4「エリア1 新マップ Z4」／docs/notes.md「所長室」）:
     * 所長室は **区画E（北の帯）の西端**。旧 v3 の「記録室の東（奥）」は失効。 */
    t.ok(!!director && !!office && director.c1 < office.c0,
      'P4.9: 所長室は記録室より西（区画Eの西端）',
      director && office && (director.c1 + ' < ' + office.c0));
    t.ok(!!director && director.c1 <= map.width * 0.25,
      'P4.9: 所長室は北の帯の西端にある', director && (director.c1 + ' <= ' + (map.width * 0.25)));
    t.ok(!!director && director.zone === 'E', 'v3: 所長室は区画E（記録区画）', director && director.zone);

    var cells = map.walkableCells();
    var inDir = [];
    for (var c = 0; c < cells.length; c++) {
      var e = cells[c];
      if (e.col < director.c0 || e.col > director.c1 || e.row < director.r0 || e.row > director.r1) continue;
      inDir.push(e);
    }
    t.ok(inDir.length >= 5, 'v3: 所長室に歩ける床がある', inDir.length + 'マス');

    /* 数値基準（§3）を再検査 */
    t.ok(cells.length >= 900, 'v3: 歩行可能900マス以上を維持', cells.length + 'マス');
    var seen = map.floodFrom(meta.spawn.col, meta.spawn.row);
    var missing = 0;
    for (var k = 0; k < cells.length; k++) {
      if (!seen[cells[k].col + ',' + cells[k].row]) missing++;
    }
    t.ok(missing === 0, 'v3: 排水路撤去後も全マスがspawnから到達可能', missing);
    function degree(c2, r2) {
      var n = 0;
      if (map.isWalkable(c2 + 1, r2)) n++;
      if (map.isWalkable(c2 - 1, r2)) n++;
      if (map.isWalkable(c2, r2 + 1)) n++;
      if (map.isWalkable(c2, r2 - 1)) n++;
      return n;
    }
    var junctions = 0, deadends = 0;
    for (var j = 0; j < cells.length; j++) {
      var dg = degree(cells[j].col, cells[j].row);
      if (dg >= 3) junctions++;
      if (dg === 1) deadends++;
    }
    t.ok(junctions >= 35, 'v3: 分岐交差点35箇所以上を維持', junctions + '箇所');
    t.ok(deadends >= 12, 'v3: 行き止まり12箇所以上を維持', deadends + '箇所');

    /* 出口の鍵は「迷路の深部」に置く。スタートからの最短距離で確かめる */
    var safe = null, gm = meta.gimmicks || [];
    for (var s = 0; s < gm.length; s++) if (gm[s].role === 'safe') safe = gm[s];
    if (t.ok(!!safe, 'v3: 金庫が定義されている')) {
      t.ok(map.tileAt(safe.col, safe.row) === TILE.GIMMICK, 'v3: 金庫は GIMMICK タイル');
      var dist = Object.create(null);
      dist[meta.spawn.col + ',' + meta.spawn.row] = 0;
      var q = [[meta.spawn.col, meta.spawn.row]], h = 0, D2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var far = 0;
      while (h < q.length) {
        var cu = q[h++], d0 = dist[cu[0] + ',' + cu[1]];
        if (d0 > far) far = d0;
        for (var m = 0; m < 4; m++) {
          var nc2 = cu[0] + D2[m][0], nr2 = cu[1] + D2[m][1], kk = nc2 + ',' + nr2;
          if (dist[kk] !== undefined || !map.isWalkable(nc2, nr2)) continue;
          dist[kk] = d0 + 1;
          q.push([nc2, nr2]);
        }
      }
      var best = Infinity;
      var DD = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var a = 0; a < 4; a++) {
        var v = dist[(safe.col + DD[a][0]) + ',' + (safe.row + DD[a][1])];
        if (v !== undefined && v < best) best = v;
      }
      t.ok(best >= far * 0.9, 'v3: 鍵はスタートから最も遠い側（深部）にある',
        best + ' / 最遠 ' + far);
      var exitD = dist[meta.exitPad.col + ',' + meta.exitPad.row];
      var alpha = (ESCAPE.ROPE_TUNING && ESCAPE.ROPE_TUNING.alpha) || 0.35;
      t.ok(best <= exitD * (1 + alpha), 'v3: 鍵の位置はロープ長 L の内側にある（詰まない）',
        best + ' <= ' + (exitD * (1 + alpha)).toFixed(1));
    }

    /* 区画銘板の参照整合 */
    var rsg = meta.regionSigns || [], bad = [];
    for (var b = 0; b < rsg.length; b++) {
      var e2 = rsg[b];
      if (!map.inBounds(e2.col, e2.row)) { bad.push(e2.id + ':場外'); continue; }
      if (!map.isSolid(e2.col, e2.row)) { bad.push(e2.id + ':壁でない'); continue; }
      var FD = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[e2.dir];
      if (!FD) { bad.push(e2.id + ':dir不正'); continue; }
      if (!seen[(e2.col + FD[0]) + ',' + (e2.row + FD[1])]) bad.push(e2.id + ':読む側が到達不可');
    }
    t.ok(bad.length === 0, 'v3: 区画銘板の参照整合', bad.join(' / '));
  }

  /** 掲示（正文）が近づくと読めること */
  function testSignTexts(t, g) {
    g.reset();
    var signs = g.map.meta.signs || [], ST = ESCAPE.PROGRESS_SIGN_TEXT;
    var shown = 0, checked = 0;
    for (var i = 0; i < signs.length; i++) {
      var sg = signs[i];
      var D = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[sg.dir];
      var rc = sg.col + D[0], rr = sg.row + D[1];
      if (!g.map.isWalkable(rc, rr)) continue;
      checked++;
      var yaw = Math.atan2(D[0], D[1]) * 180 / Math.PI;
      place(g, rc, rr, yaw);
      sim(g, 1);
      var found = g.progress._findSign();
      if (found && found.id === sg.id) shown++;
      t.ok(!!ST[sg.id], '掲示 ' + sg.id + ': 本文が正文にある', ST[sg.id]);
    }
    t.ok(checked > 0 && shown === checked, '掲示: 読む側に立つと本文が出る', shown + '/' + checked);
    /* 同類バグ検出: Stealth も同じ #prompt を毎フレーム書くため、Progress が
       自前キャッシュだけで判定すると「一度書いた文言が二度と出ない」ことがある。
       Stealth に空文字で上書きさせた直後でも実DOMに出ることを確かめる。 */
    var el = g.progress.dom.prompt;
    var seenAgain = 0, tried = 0;
    for (var q = 0; q < signs.length; q++) {
      var s2 = signs[q];
      var D2 = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s2.dir];
      var rc2 = s2.col + D2[0], rr2 = s2.row + D2[1];
      if (!g.map.isWalkable(rc2, rr2)) continue;
      place(g, rc2, rr2, Math.atan2(D2[0], D2[1]) * 180 / Math.PI);
      sim(g, 1);
      /* 操作できる対象（仕掛け・銘板）が同時に間合いにある掲示は
         そちらの文言が優先されるので、この検査の対象外にする */
      if (g.progress._findTarget() || g.progress._findRegionSign()) continue;
      tried++;
      /* いったん Stealth 側の経路で消してから、次のフレームで戻ること */
      g.stealth.prompt = ''; g.stealth._domCache = null; el.textContent = '';
      sim(g, 1);
      if (el.textContent === ST[s2.id]) seenAgain++;
    }
    t.ok(tried > 0 && seenAgain === tried,
      '掲示: #prompt を他所から空にされても次のフレームで再表示される（キャッシュ不整合の検出）',
      seenAgain + '/' + tried);
    t.ok(ST.sg_store === '保管庫　硝子片散乱　走行厳禁',
      '掲示: 保管庫の掲示が正文どおり', ST.sg_store);
    t.ok(ST.sg_bulkhead === '非常隔壁 手動開放は解錠後のみ可 / 開放中は大音響に注意',
      '掲示: 隔壁前の掲示が正文どおり（12秒開放は失効）', ST.sg_bulkhead);
    t.ok(!ST.sg_breaker && !ST.sg_control && !ST.sg_drain,
      '掲示: 失効した掲示（配電順序・制御室・排水路）が消えている');
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /* ================================================================
   * P4.9: 新マップ Z4 の載せ替え（DESIGN.md §4「エリア1 新マップ Z4」）
   * ============================================================== */

  /** 帯（区画）A〜F・銘板・メモ・見せ場ルームの区画単位の充足 */
  function testP49Zones(t, g) {
    var map = ESCAPE.Maps.load('area1'), meta = map.meta;
    var ZONES = ['A', 'B', 'C', 'D', 'E', 'F'];

    t.ok(map.width === 80 && map.height === 80, 'P4.9: マップは80x80（Z4）', map.width + 'x' + map.height);
    var cells = map.walkableCells();
    t.ok(cells.length >= 2000, 'P4.9: 歩行可能2000マス以上（Z4の実測3135）', cells.length + 'マス');

    /* 帯: 6本・行レンジが隙間なく全80行を覆う・zoneが重複なくA〜F */
    var bands = (meta.bands || []).slice().sort(function (a, b) { return a.r0 - b.r0; });
    t.ok(bands.length === 6, 'P4.9: 帯（区画）が6本ある', bands.length);
    var covered = true, prev = 0, zseen = {};
    for (var i = 0; i < bands.length; i++) {
      if (bands[i].r0 !== prev) covered = false;
      prev = bands[i].r1 + 1;
      zseen[bands[i].zone] = (zseen[bands[i].zone] || 0) + 1;
    }
    t.ok(covered && prev === map.height, 'P4.9: 帯が全行を隙間なく覆う', prev + '/' + map.height);
    var zdup = 0;
    for (var z = 0; z < ZONES.length; z++) if (zseen[ZONES[z]] !== 1) zdup++;
    t.ok(zdup === 0, 'P4.9: 帯の区画名がA〜Fで重複なく揃っている', JSON.stringify(zseen));

    /* 区画銘板: A〜F 各1枚・その帯の中にある */
    var signs = meta.regionSigns || [];
    t.ok(signs.length === 6, 'P4.9: 区画銘板が6枚', signs.length);
    var badBand = [];
    for (var si = 0; si < signs.length; si++) {
      var b = null;
      for (var bi = 0; bi < bands.length; bi++) if (bands[bi].zone === signs[si].zone) b = bands[bi];
      if (!b) { badBand.push(signs[si].id + ':帯なし'); continue; }
      if (signs[si].row < b.r0 - 1 || signs[si].row > b.r1 + 1) badBand.push(signs[si].id + ':帯外');
    }
    t.ok(badBand.length === 0, 'P4.9: 区画銘板が自分の帯の入口付近にある', badBand.join(' / '));

    /* メモ: 6枚が区画A〜Fに1枚ずつ（どの帯に居るかで数える） */
    function zoneOfRow(row) {
      for (var k = 0; k < bands.length; k++) if (row >= bands[k].r0 && row <= bands[k].r1) return bands[k].zone;
      return null;
    }
    var notes = meta.notes || [], nz = {};
    for (var ni = 0; ni < notes.length; ni++) {
      var zz = zoneOfRow(notes[ni].row);
      nz[zz] = (nz[zz] || 0) + 1;
    }
    t.ok(notes.length === 6, 'P4.9: メモは6枚', notes.length);
    var nmiss = [];
    for (var nz2 = 0; nz2 < ZONES.length; nz2++) if (!nz[ZONES[nz2]]) nmiss.push(ZONES[nz2]);
    t.ok(nmiss.length === 0, 'P4.9: メモが区画A〜Fに行き渡っている', JSON.stringify(nz));
    /* メモの dir は「読む側」が歩行可能であること */
    var F4 = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    var ndir = [];
    for (var nd = 0; nd < notes.length; nd++) {
      var v = F4[notes[nd].dir];
      if (!v) { ndir.push(notes[nd].id + ':dir不正'); continue; }
      if (!map.isWalkable(notes[nd].col + v[0], notes[nd].row + v[1])) ndir.push(notes[nd].id + ':読む側が壁');
    }
    t.ok(ndir.length === 0, 'P4.9: メモの向き（読む側）が歩行可能', ndir.join(' / '));

    /* 見せ場ルーム: 各区画に最低1室、その部屋に什器がある */
    var rooms = [], regions = meta.regions || [];
    for (var ri = 0; ri < regions.length; ri++) {
      var r = regions[ri];
      if (!r.zone) continue;
      if (r.c1 - r.c0 >= 40) continue;           /* 帯ゾーンは除く */
      rooms.push(r);
    }
    var furn = meta.furniture || [];
    var roomZone = {};
    for (var rm = 0; rm < rooms.length; rm++) {
      var q = rooms[rm], nf = 0;
      for (var f = 0; f < furn.length; f++) {
        if (furn[f].col >= q.c0 - 2 && furn[f].col <= q.c1 + 2 &&
            furn[f].row >= q.r0 - 2 && furn[f].row <= q.r1 + 2) nf++;
      }
      if (nf >= 3) roomZone[q.zone] = (roomZone[q.zone] || 0) + 1;
    }
    var rmiss = [];
    for (var rz = 0; rz < ZONES.length; rz++) if (!roomZone[ZONES[rz]]) rmiss.push(ZONES[rz]);
    t.ok(rmiss.length === 0, 'P4.9: 各区画に見せ場ルーム（什器3点以上の部屋）が1室以上',
      JSON.stringify(roomZone));

    /* 闇だまり5箇所以上・漆黒2〜3箇所・明滅通路1〜3本（契約 §3） */
    t.ok((meta.darkZones || []).length >= 5, 'P4.9: 闇だまりが5箇所以上', (meta.darkZones || []).length);
    var bz = (meta.blackZones || []).length;
    t.ok(bz >= 2 && bz <= 3, 'P4.9: 漆黒区画は2〜3箇所', bz);
    var fz = (meta.flickerZones || []).length;
    t.ok(fz >= 1 && fz <= 3, 'P4.9: 明滅だけの通路は1〜3本', fz);
    /* 闇だまり・漆黒が見せ場ルームを潰していないこと */
    var overlap = [];
    for (var dz = 0; dz < (meta.darkZones || []).length; dz++) {
      var d = meta.darkZones[dz];
      for (var rr = 0; rr < rooms.length; rr++) {
        var o = rooms[rr];
        if (!(d.c1 < o.c0 || d.c0 > o.c1 || d.r1 < o.r0 || d.r0 > o.r1)) overlap.push(d.id + 'x' + o.id);
      }
    }
    t.ok(overlap.length === 0, 'P4.9: 闇だまりが見せ場ルームに被っていない', overlap.join(' / '));
  }

  /** 区画ごとの景観差（床/壁テクスチャ・蛍光灯の色温度・金属床の足音） */
  function testP49Look(t, g) {
    g.reset();
    var w = g.world, map = g.map;
    var ZONES = ['A', 'B', 'C', 'D', 'E', 'F'];

    /* 区画ごとに床・壁のテクスチャの組み合わせが違う */
    var texKey = {}, floors = {}, dup = 0;
    for (var i = 0; i < ZONES.length; i++) {
      var tx = w._zoneTexOf ? w._zoneTexOf(ZONES[i]) : null;
      /* 内部表を直接触らず、帯の代表マスから引く */
      var band = null, bands = map.meta.bands || [];
      for (var b = 0; b < bands.length; b++) if (bands[b].zone === ZONES[i]) band = bands[b];
      var cell = null;
      for (var r = band.r0; r <= band.r1 && !cell; r++) {
        for (var c = 1; c < map.width - 1; c++) if (map.isWalkable(c, r)) { cell = { c: c, r: r }; break; }
      }
      var zt = w._zoneTex(cell.c, cell.r);
      var key = zt.floor + '|' + zt.walls.join(',');
      if (texKey[key]) dup++;
      texKey[key] = ZONES[i];
      floors[ZONES[i]] = zt.floor;
    }
    t.ok(dup === 0, 'P4.9: 区画ごとに床・壁テクスチャの組み合わせが異なる', JSON.stringify(floors));
    t.ok(floors.B === 'floorTile', 'P4.9: 実験区画は白タイルの床', floors.B);
    t.ok(floors.C === 'floorWet', 'P4.9: 検体区画は湿った床', floors.C);
    t.ok(floors.F === 'floorMetal', 'P4.9: 機械区画は金属床', floors.F);

    /* 蛍光灯の色温度が区画ごとに違う */
    var cols = {}, seen = {}, samedup = 0;
    for (var f2 = 0; f2 < w.fixtures.length; f2++) {
      var fx = w.fixtures[f2];
      if (fx.kind !== 'lamp') continue;
      var z = w._zoneAt(fx.col, fx.row);
      if (cols[z]) continue;
      cols[z] = [fx.color.r.toFixed(2), fx.color.g.toFixed(2), fx.color.b.toFixed(2)].join(',');
    }
    for (var zk in cols) { if (seen[cols[zk]]) samedup++; seen[cols[zk]] = true; }
    t.ok(Object.keys(cols).length === 6, 'P4.9: 6区画すべてに蛍光灯がある', Object.keys(cols).length);
    t.ok(samedup === 0, 'P4.9: 区画ごとに蛍光灯の色温度が異なる', JSON.stringify(cols));

    /* 機械区画は金属床＝足音が変わる（契約の言語どおり） */
    var au = ESCAPE.audio;
    if (au && au.floorMaterial) {
      var mf = map.meta.metalFloors || [];
      t.ok(mf.length > 0, 'P4.9: 金属床の宣言がある', mf.length);
      var mc = null;
      for (var mr = mf[0].r0; mr <= mf[0].r1 && !mc; mr++) {
        for (var mcc = mf[0].c0; mcc <= mf[0].c1; mcc++) {
          if (map.isWalkable(mcc, mr) && map.tileAt(mcc, mr) !== ESCAPE.TILE.NOISE) { mc = { c: mcc, r: mr }; break; }
        }
      }
      t.ok(!!mc && au.floorMaterial(mc.c, mc.r) === 'metal',
        'P4.9: 機械区画の床は金属の足音になる', mc && au.floorMaterial(mc.c, mc.r));
      /* 他区画はタイル音のまま */
      var other = null;
      for (var orr = 44; orr <= 50 && !other; orr++) {
        for (var occ = 2; occ < 70; occ++) {
          if (map.isWalkable(occ, orr) && map.tileAt(occ, orr) !== ESCAPE.TILE.NOISE) { other = { c: occ, r: orr }; break; }
        }
      }
      t.ok(!!other && au.floorMaterial(other.c, other.r) === 'tile',
        'P4.9: 実験区画の床はタイルの足音のまま', other && au.floorMaterial(other.c, other.r));
    }

    /* 金属床の宣言（y=0 の平板）が高さの段差を作っていない */
    t.ok(map.heightSeams().length === 0, 'P4.9: 金属床の宣言で床高さの段差が生まれていない');
    g.reset();
  }

  /** 行き止まり44箇所すべてに「来た意味」がある（契約 §3） */
  function testP49DeadEnds(t, g) {
    var map = ESCAPE.Maps.load('area1'), meta = map.meta;
    function deg(c, r) {
      var n = 0;
      if (map.isWalkable(c + 1, r)) n++;
      if (map.isWalkable(c - 1, r)) n++;
      if (map.isWalkable(c, r + 1)) n++;
      if (map.isWalkable(c, r - 1)) n++;
      return n;
    }
    var mark = Object.create(null);
    function put(list) { for (var i = 0; i < (list || []).length; i++) mark[list[i].col + ',' + list[i].row] = true; }
    put(meta.lockers); put(meta.notes); put(meta.furniture); put(meta.decals);
    put(meta.checkpoints); put(meta.boards); put(meta.regionSigns); put(meta.gimmicks);
    var kit = meta.wallKit || [];
    for (var k = 0; k < kit.length; k++) mark[kit[k].col + ',' + kit[k].row] = true;
    var cells = map.walkableCells(), dead = [], bad = [];
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i2 = 0; i2 < cells.length; i2++) {
      var e = cells[i2];
      if (deg(e.col, e.row) !== 1) continue;
      dead.push(e);
      var okc = !!mark[e.col + ',' + e.row];
      for (var d = 0; d < 4 && !okc; d++) if (mark[(e.col + D[d][0]) + ',' + (e.row + D[d][1])]) okc = true;
      if (!okc) bad.push(e.col + ',' + e.row);
    }
    t.ok(dead.length >= 12, 'P4.9: 行き止まりが12箇所以上（Z4実測44）', dead.length + '箇所');
    t.ok(bad.length === 0, 'P4.9: 行き止まりすべてに「来た意味」がある',
      bad.length + '箇所が空: ' + bad.slice(0, 8).join(' '));
  }

  /** 什器・壁付け造作・天井付けの参照整合 */
  function testP49Props(t, g) {
    var map = ESCAPE.Maps.load('area1'), meta = map.meta;
    var F4 = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    var furn = meta.furniture || [], bad = [], seen = Object.create(null);
    for (var i = 0; i < furn.length; i++) {
      var f = furn[i], key = f.col + ',' + f.row;
      if (!map.inBounds(f.col, f.row)) { bad.push(key + ':場外'); continue; }
      if (!map.isSolid(f.col, f.row)) { bad.push(key + ':歩けるマスに立体物'); continue; }
      if (seen[key]) { bad.push(key + ':重複'); continue; }
      seen[key] = true;
      var v = F4[f.dir];
      if (!v) { bad.push(key + ':dir不正'); continue; }
      if (!map.isWalkable(f.col + v[0], f.row + v[1])) bad.push(key + ':正面が壁');
    }
    t.ok(bad.length === 0, 'P4.9: 什器の参照整合（実体マス・重複なし・正面が歩ける）',
      bad.length + '件 ' + bad.slice(0, 6).join(' / '));
    t.ok(furn.length >= 60, 'P4.9: 什器が十分な数ある', furn.length + '点');

    var kit = meta.wallKit || [], kbad = [];
    for (var k = 0; k < kit.length; k++) {
      var e = kit[k], v2 = F4[e.dir];
      if (!v2) { kbad.push(e.col + ',' + e.row + ':dir不正'); continue; }
      if (!map.isWalkable(e.col, e.row)) { kbad.push(e.col + ',' + e.row + ':手前が壁'); continue; }
      if (!map.isSolid(e.col + v2[0], e.row + v2[1])) kbad.push(e.col + ',' + e.row + ':貼る先が壁でない');
    }
    t.ok(kbad.length === 0, 'P4.9: 壁付け造作の参照整合', kbad.length + '件 ' + kbad.slice(0, 6).join(' / '));

    var ck = meta.ceilKit || [], cbad = [];
    for (var c = 0; c < ck.length; c++) {
      if (!map.inBounds(ck[c].col, ck[c].row)) cbad.push(ck[c].col + ',' + ck[c].row + ':場外');
    }
    t.ok(cbad.length === 0, 'P4.9: 天井付け造作の参照整合', cbad.join(' / '));
  }

  /** ロープ張力インジケータ（緑/黄/赤）と赤の警告（DESIGN.md §4・2026-09-04改訂） */
  function testP49RopeTension(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var rope = g.rope, meta = g.map.meta, T = ESCAPE.ROPE_TUNING;
    t.near(T.greenRatio, 1.10, 1e-9, 'P4.11: 緑の判定は最短×1.10（契約・緩和）', T.greenRatio);
    t.near(T.yellowRatio, 1.50, 1e-9, 'P4.11: 黄の判定は最短×1.50（契約・緩和）', T.yellowRatio);
    /* 【P4.12 失効】α = 0.70 ／「赤は余裕が L の8%未満でも立つ」（redSlackRatio）。
       ロープ無制限化により色は遠回り率だけで決まる。 */
    t.ok(T.alpha === undefined && T.redSlackRatio === undefined,
      'P4.12: α と余裕不足の閾値が失効している（色は遠回り率だけ）');
    t.ok(T.tensionInterval <= 0.5 + 1e-9, 'P4.9: 張力の再計算は0.5秒以下の間引き', T.tensionInterval);

    /* スタート地点は必ず緑（使用長0＝最短） */
    var t0 = rope.computeTension();
    t.ok(t0.state === 'green', 'P4.9 緑: スタート地点は最短経路上', t0.state);

    /* 最短経路上を実際に歩いても緑のまま */
    var route = routeTo(g, meta.spawn.col, meta.spawn.row, meta.spawn.col, meta.spawn.row - 6);
    if (route && route.length) walkCells(g, route);
    var tg = rope.computeTension();
    t.ok(tg.best > 0, 'P4.9: 最短距離が積み上がっている', tg.best.toFixed(0) + 'm');
    t.ok(tg.state === 'green', 'P4.9 緑: 最短経路上を進んでいる間は緑',
      tg.state + ' ratio=' + tg.ratio.toFixed(3));

    /* 遠回り率だけを動かして 緑→黄→赤 の閾値を検証する */
    var usedSave = rope.used;
    var best = tg.best;
    rope.used = best * 1.08; rope._tension = null;
    t.ok(rope.computeTension().state === 'green', 'P4.11 緑: 最短×1.08 は緑（1.10まで緑）');
    rope.used = best * 1.20; rope._tension = null;
    var ty = rope.computeTension();
    t.ok(ty.state === 'yellow', 'P4.11 黄: 最短×1.20 は黄（遠回り中）', ty.state);
    rope.used = best * 1.49; rope._tension = null;
    t.ok(rope.computeTension().state === 'yellow', 'P4.11 黄: 最短×1.49 まで黄');
    rope.used = best * 1.55; rope._tension = null;
    var tr = rope.computeTension();
    t.ok(tr.state === 'red', 'P4.11 赤: 最短×1.55 は赤（大きな遠回り）', tr.state);
    t.ok(tr.lowSlack === false, 'P4.12 赤: 赤は「遠回り」だけで立つ（余裕不足の赤は失効）');

    /* 【P4.12 失効】「余裕が L の8%を切っても赤」。L=無制限なので lowSlack は常に false。
       どれだけ繰り出しても、遠回り率が小さければ赤にならないことを確かめる。 */
    rope.used = best * 1.05;
    rope._tension = null;
    var tr2 = rope.computeTension();
    t.ok(tr2.state === 'green' && tr2.lowSlack === false,
      'P4.12: 繰り出し量が大きくても遠回り率が小さければ緑（余裕不足の赤は失効）',
      tr2.state + ' slack=' + String(tr2.slack));
    rope.used = best * 1.55;

    /* 赤に入った瞬間の警告は1回だけ／赤の間は繰り返さない／解除できる */
    rope.redT = 0;
    var warns0 = rope.redWarns;
    rope._tension = null; rope._tenCell = null;
    rope._tickTension(0.6);
    t.ok(rope.redWarns === warns0 + 1, 'P4.9 赤: 赤に入った瞬間に警告が1回だけ出る', rope.redWarns);
    t.ok(rope.redT > 0, 'P4.9 赤: 目的表示の一時差し替えが立つ', rope.redT.toFixed(2));
    t.ok(g.progress.objective() === ESCAPE.PROGRESS_OBJECTIVE.ropeDetour,
      'P4.12 赤: 目的表示が「遠回りしすぎだ —— 戻って巻き戻せ」（正文・維持）', g.progress.objective());
    rope._tickTension(0.6);
    t.ok(rope.redWarns === warns0 + 1, 'P4.9 赤: 赤のままなら警告は繰り返さない', rope.redWarns);
    /* 巻き戻し相当（使用長を戻す）で赤が解ける */
    rope.used = usedSave;
    rope._tension = null;
    rope._tickTension(0.6);
    t.ok(rope.tension().state !== 'red', 'P4.9: 巻き戻して最短に近づけば赤が解ける', rope.tension().state);

    /* 鍵を取っただけでは赤にならない（改訂の主眼。旧定義はここで必ず赤になっていた） */
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    rope = g.rope;
    var safe = null, gl = g.map.meta.gimmicks || [];
    for (var gi = 0; gi < gl.length; gi++) if (gl[gi].role === 'safe') safe = gl[gi];
    var ks = rope._keyStand();
    var toKey = routeTo(g, meta.spawn.col, meta.spawn.row, ks.col, ks.row);
    if (t.ok(!!toKey, 'P4.9: 金庫の前まで実経路がある')) {
      walkCells(g, toKey);
      g.progress.gimmick.key = true;
      rope._tension = null; rope._tenCell = null;
      rope._tickTension(0.6);
      var tk = rope.computeTension();
      t.ok(tk.state !== 'red',
        'P4.9: 最短で鍵まで来ただけでは赤にならない（旧定義の欠陥を作り込まない）',
        tk.state + ' ratio=' + tk.ratio.toFixed(3) + ' slack=' + tk.slack.toFixed(0) +
        ' / L*0.08=' + (tk.L * T.redSlackRatio).toFixed(0));
    }

    /* HUD: 文言と色クラス */
    g.stepFrame(ESCAPE.FIXED_DT);
    var el = document.getElementById('rope-hud');
    t.ok(!!el, 'P4.9: ロープHUDのDOMが結線されている');
    /* 【P4.12 改訂】旧「ロープ 余裕 {M}m」は失効。ラベルだけ＋色で示す。 */
    t.ok(g.progress.ropeHudText() === '軌跡',
      'P4.13: HUD文言は `軌跡` のラベルのみ（P4.12の `ロープ` から改訂・メートル表示は失効）', g.progress.ropeHudText());
    t.ok(!/\d/.test(g.progress.ropeHudText()) && g.progress.ropeHudText().indexOf('m') < 0,
      'P4.12: HUDに数値（余裕のメートル）を出さない', g.progress.ropeHudText());
    t.ok(['green', 'yellow', 'red', 'loose'].indexOf(g.progress.ropeHudState()) >= 0,
      'P4.9: HUDの色は緑/黄/赤（未接続はloose）', g.progress.ropeHudState());
    t.ok(el.className === g.progress.ropeHudState(), 'P4.9: HUDのクラスが状態に追従する', el.className);
    /* GPS的な矢印は出さない（契約） */
    t.ok(g.progress.ropeHudText().indexOf('→') < 0 && g.progress.ropeHudText().indexOf('↑') < 0,
      'P4.9: HUDに方向の矢印を出さない（迷路の手探りを壊さない）');
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 鍵経由の踏破がロープ長 L の内側で成立する（詰まない） */
  function testP49RopeFeasible(t, g) {
    var map = ESCAPE.Maps.load('area1'), meta = map.meta;
    var W = map.width, H = map.height;
    function raw(c, r) {
      if (!map.inBounds(c, r)) return false;
      var d = ESCAPE.TILE_DEFS[map.tileAt(c, r)];
      return !!(d && d.walkable);
    }
    function bfs(sc, sr) {
      var d = new Int32Array(W * H);
      for (var i = 0; i < d.length; i++) d[i] = -1;
      d[sr * W + sc] = 0;
      var q = [sc, sr], h = 0, D = [1, 0, -1, 0, 0, 1, 0, -1];
      while (h < q.length) {
        var c = q[h++], r = q[h++], d0 = d[r * W + c];
        for (var k = 0; k < 8; k += 2) {
          var nc = c + D[k], nr = r + D[k + 1];
          if (!raw(nc, nr) || d[nr * W + nc] >= 0) continue;
          d[nr * W + nc] = d0 + 1; q.push(nc, nr);
        }
      }
      return d;
    }
    var safe = null, gl = meta.gimmicks || [];
    for (var i2 = 0; i2 < gl.length; i2++) if (gl[i2].role === 'safe') safe = gl[i2];
    var F4 = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }, v = F4[safe.dir] || [0, 0];
    var ks = { col: safe.col + v[0], row: safe.row + v[1] };
    var ds = bfs(meta.spawn.col, meta.spawn.row);
    var dk = bfs(ks.col, ks.row);
    var de = bfs(meta.exitPad.col, meta.exitPad.row);
    var shortest = ds[meta.exitPad.row * W + meta.exitPad.col];
    /* 【P4.12 改訂】L = 最短×(1+α) は失効（L=無制限）。「鍵がロープ長の内側にあるか」
       「巻き戻しを使えば届くか」という詰みの検査は、長さ制限ごと不要になった。
       残るのは経路そのものの健全性＝到達できること・最短が有限であること。 */
    var toKey = ds[ks.row * W + ks.col];
    t.ok(toKey > 0, 'P4.9: 鍵まで到達できる', toKey + 'マス');
    t.ok(shortest > 0, 'P4.9: スタート→出口の最短が有限', shortest + 'マス');
    t.ok(g.rope.L === Infinity,
      'P4.12: ロープ長で詰むことは起きない（L=無制限。旧「Lの内側」検査は失効）', String(g.rope.L));
    /* 巻き戻しの「最小ピーク」= min_j d_s(j)+max(d_key(j), d_exit(j))。値の健全性だけ見る */
    var peak = Infinity;
    for (var r2 = 0; r2 < H; r2++) {
      for (var c2 = 0; c2 < W; c2++) {
        var a = ds[r2 * W + c2], b = dk[r2 * W + c2], e2 = de[r2 * W + c2];
        if (a < 0 || b < 0 || e2 < 0) continue;
        var val = a + Math.max(b, e2);
        if (val < peak) peak = val;
      }
    }
    t.ok(peak > 0 && isFinite(peak),
      'P4.9: 鍵経由で出口へ至る経路が実在する（巻き戻しの最小ピークが有限）', peak + 'マス');
  }

  /* ================================================================
   * P4.11 レーンB（契約 DESIGN.md §4「P4.11 実プレイ差し戻し」項目2・4・5・6）
   *   2: ロープ判定の緩和（α=0.7・緑1.10/黄1.50）
   *   4: 地図の踏破記録の不整合
   *   5: ヘッドライトの形（円形スプライト禁止・前方へ伸びるくさび）
   *   6: ミニマップ（画面幅32%・向きの分かる矢印・コントラスト）
   * ============================================================== */

  /** 実際に歩きながら「立ったマス」を全フレーム記録する（踏破の正解データ） */
  function walkRecorded(g, cells, stood) {
    var dt = ESCAPE.FIXED_DT, p = g.player;
    var trapsWas = g.traps ? g.traps.enabled : null;
    if (g.traps) g.traps.enabled = false;
    stood[p.col() + ',' + p.row()] = true;
    for (var i = 0; i < cells.length; i++) {
      var c = g.map.cellCenter(cells[i].col, cells[i].row), guard = 0;
      while (guard++ < 240) {
        var dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.30) break;
        p.yaw = Math.atan2(-dx, -dz);
        g.input.moveX = 0; g.input.moveY = 1;
        g.stepFrame(dt);
        stood[p.col() + ',' + p.row()] = true;
      }
    }
    g.input.moveX = 0; g.input.moveY = 0;
    if (g.traps && trapsWas !== null) g.traps.enabled = trapsWas;
  }

  /** 素の歩行可能判定（runtime の通行止めを無視）＝距離場の計算用 */
  function rawWalk(map, c, r) {
    if (!map.inBounds(c, r)) return false;
    var d = ESCAPE.TILE_DEFS[map.tileAt(c, r)];
    return !!(d && d.walkable);
  }
  /** 任意マスからの距離場（マス数。未到達 -1） */
  function distField(map, col, row) {
    var W = map.width, H = map.height, d = new Int32Array(W * H);
    for (var i = 0; i < d.length; i++) d[i] = -1;
    if (!rawWalk(map, col, row)) return d;
    d[row * W + col] = 0;
    var q = [col, row], h = 0, D = [1, 0, -1, 0, 0, 1, 0, -1];
    while (h < q.length) {
      var c = q[h++], r = q[h++], d0 = d[r * W + c];
      for (var k = 0; k < 8; k += 2) {
        var nc = c + D[k], nr = r + D[k + 1];
        if (!rawWalk(map, nc, nr) || d[nr * W + nc] >= 0) continue;
        d[nr * W + nc] = d0 + 1; q.push(nc, nr);
      }
    }
    return d;
  }
  /** 距離場を降りて (sc,sr) から (tc,tr) の最短マス列（開始マスを含まない） */
  function pathBetween(map, sc, sr, tc, tr) {
    var W = map.width, d = distField(map, sc, sr);
    if (d[tr * W + tc] < 0) return null;
    var out = [], c = tc, r = tr, D = [1, 0, -1, 0, 0, 1, 0, -1];
    while (!(c === sc && r === sr)) {
      out.push({ col: c, row: r });
      var cur = d[r * W + c], moved = false;
      for (var k = 0; k < 8; k += 2) {
        var nc = c + D[k], nr = r + D[k + 1];
        if (!map.inBounds(nc, nr) || d[nr * W + nc] !== cur - 1) continue;
        c = nc; r = nr; moved = true; break;
      }
      if (!moved) return null;
    }
    out.reverse();
    return out;
  }
  /** ロープ本体（_enter＝繰り出し/巻き戻し）にマス列を通し、張力の推移を集計する。
   *  台本歩行より速く、判定は本番と同じコードを通る。 */
  function ropeScan(g, cells, hasKeyAt) {
    var rope = g.rope, worst = 'green', maxRatio = 0, order = { green: 0, yellow: 1, red: 2, loose: 3 };
    var states = { green: 0, yellow: 0, red: 0 };
    for (var i = 0; i < cells.length; i++) {
      if (!rope._enter(cells[i].col, cells[i].row)) return { blocked: i, worst: worst, maxRatio: maxRatio, states: states };
      if (hasKeyAt !== undefined && i === hasKeyAt) g.progress.gimmick.key = true;
      var st = rope.computeTension();
      states[st.state] = (states[st.state] || 0) + 1;
      if (st.ratio > maxRatio) maxRatio = st.ratio;
      if (order[st.state] > order[worst]) worst = st.state;
    }
    return { blocked: -1, worst: worst, maxRatio: maxRatio, states: states, used: rope.used, slack: rope.slack() };
  }

  /** 項目2: ロープ判定の緩和（α=0.7 / 緑1.10 / 黄1.50）と実経路での数値 */
  function testP411RopeRelax(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var T = ESCAPE.ROPE_TUNING, rope = g.rope, map = g.map, meta = map.meta;
    t.near(T.greenRatio, 1.10, 1e-9, 'P4.11 項目2: 緑は最短×1.10まで（契約・P4.12でも維持）', T.greenRatio);
    t.near(T.yellowRatio, 1.50, 1e-9, 'P4.11 項目2: 黄は最短×1.50まで（契約・P4.12でも維持）', T.yellowRatio);
    /* 【P4.12 失効】α = 0.70 ／ L = 最短 × 1.7 ／ 赤は余裕 < L×0.08。L は無制限になった。 */
    t.ok(rope.L === Infinity, 'P4.12: L = 無制限（旧「最短×1.7」は失効）', String(rope.L));

    /* --- 最短ルートで 鍵 → 出口 まで通す（黄にならないこと） --- */
    var ks = rope._keyStand();
    var toKey = pathBetween(map, meta.spawn.col, meta.spawn.row, ks.col, ks.row);
    var keyToExit = pathBetween(map, ks.col, ks.row, meta.exitPad.col, meta.exitPad.row);
    if (!t.ok(!!toKey && !!keyToExit, 'P4.11: 鍵経由の最短経路が取れる')) return;
    /* 前半（スタート→鍵）は最短そのもの＝全マス緑 */
    var scanA = ropeScan(g, toKey);
    t.ok(scanA.blocked < 0, 'P4.11: 鍵までの最短ルートで止まらない（詰まない）', scanA.blocked);
    t.ok(scanA.worst === 'green',
      'P4.11 項目2: 最短ルートで鍵まで黄にならない',
      '緑' + scanA.states.green + '/黄' + scanA.states.yellow + '/赤' + scanA.states.red +
      ' 最大遠回り率=' + scanA.maxRatio.toFixed(3));
    /* 後半（鍵→出口）: 契約P4.11項目2追記（2026-09-07）で基準最短が
       「スタート→鍵＋鍵→現在地」になったため、最短で戻る間は緑のまま。 */
    g.progress.gimmick.key = true;
    var scanB = ropeScan(g, keyToExit);
    t.ok(scanB.blocked < 0, 'P4.11: 鍵→出口でロープが尽きない（詰まない）', scanB.blocked);
    t.ok(scanB.worst === 'green',
      'P4.11 項目2: 最短ルートで鍵→出口まで黄にならない（基準最短は鍵経由）',
      '緑' + scanB.states.green + '/黄' + scanB.states.yellow + '/赤' + scanB.states.red +
      ' 最大遠回り率=' + scanB.maxRatio.toFixed(3) +
      ' 使用=' + scanB.used.toFixed(0) + 'm/L=' + rope.L.toFixed(0) +
      'm');
    /* 【P4.12 失効】「最短ルートを通しても余裕が15%以上残る」。長さ制限が無いので常に成立する。 */
    t.ok(scanB.slack === Infinity, 'P4.12: 最短ルートを通しても余裕は無制限のまま');

    /* --- 通り抜け口を1回間違える程度の遠回り（赤にならないこと） --- */
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    rope = g.rope;
    var W = map.width;
    var ds = distField(map, meta.spawn.col, meta.spawn.row);
    var de = distField(map, meta.exitPad.col, meta.exitPad.row);
    var direct = ds[meta.exitPad.row * W + meta.exitPad.col];
    /* 遠回りが 直行の +12%〜+25%（＝通り抜け口1回ぶんの読み違い）になる中継マスを選ぶ */
    var via = null, viaCost = 0;
    for (var r2 = 1; r2 < map.height - 1 && !via; r2++) {
      for (var c2 = 1; c2 < W - 1; c2++) {
        var a = ds[r2 * W + c2], b = de[r2 * W + c2];
        if (a < 0 || b < 0) continue;
        var cost = a + b;
        if (cost >= direct * 1.14 && cost <= direct * 1.22) { via = { col: c2, row: r2 }; viaCost = cost; break; }
      }
    }
    if (t.ok(!!via, 'P4.11: 「通り抜け口を1回間違える」相当の迂回路が取れる',
      via ? (via.col + ',' + via.row + ' cost=' + viaCost + ' vs 直行' + direct) : '')) {
      var p1 = pathBetween(map, meta.spawn.col, meta.spawn.row, via.col, via.row);
      var p2 = pathBetween(map, via.col, via.row, meta.exitPad.col, meta.exitPad.row);
      var scan2 = ropeScan(g, p1.concat(p2));
      t.ok(scan2.blocked < 0, 'P4.11: 遠回りしてもロープが尽きない（詰まない）', scan2.blocked);
      t.ok(scan2.worst !== 'red',
        'P4.11 項目2: 通り抜け口1回ぶんの遠回りでも赤にならない',
        '最悪=' + scan2.worst + ' 最大遠回り率=' + scan2.maxRatio.toFixed(3) +
        ' 迂回=' + ((viaCost / direct - 1) * 100).toFixed(1) + '% 使用=' + scan2.used.toFixed(0) +
        'm/L=' + rope.L.toFixed(0) + 'm');
    }
    /* 旧α（0.35 / 0.70）のどのLよりも長い＝長さで詰むことが二度と起きない */
    t.ok(rope.shortest * 1.7 < rope.L, 'P4.12: 新Lは旧α=0.70のLより長い（無制限）',
      (rope.shortest * 1.7).toFixed(0) + ' < ' + String(rope.L));
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 項目4: 実歩行した経路と地図の開示範囲が一致する（帯の一括開示バグの検出） */
  function testP411FogTruth(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var mm = g.minimap, map = g.map, meta = map.meta;
    var stood = Object.create(null);
    var route = routeTo(g, meta.spawn.col, meta.spawn.row, 10, 46);
    if (!t.ok(!!route && route.length > 40, 'P4.11 項目4: 検証用の長い経路がある')) return;
    walkRecorded(g, route, stood);

    /* 正解データ: 立ったマス＋その4近傍＋「入った部屋の中で繋がっている範囲」 */
    var allowed = Object.create(null);
    function allow(c, r) { if (rawWalk(map, c, r)) allowed[c + ',' + r] = true; }
    var k, pr;
    for (k in stood) {
      pr = k.split(','); var c = +pr[0], r = +pr[1];
      allow(c, r); allow(c + 1, r); allow(c - 1, r); allow(c, r + 1); allow(c, r - 1);
    }
    var rooms = mm.roomRegions(), entered = {};
    for (var i = 0; i < rooms.length; i++) {
      var R = rooms[i];
      for (k in stood) {
        pr = k.split(','); var cc = +pr[0], rr = +pr[1];
        if (cc < R.c0 || cc > R.c1 || rr < R.r0 || rr > R.r1) continue;
        entered[R.id] = true;
        var seen = Object.create(null), q = [cc, rr], h = 0, D = [1, 0, -1, 0, 0, 1, 0, -1];
        seen[cc + ',' + rr] = true;
        while (h < q.length) {
          var a = q[h++], b = q[h++];
          allow(a, b);
          for (var d = 0; d < 8; d += 2) {
            var nc = a + D[d], nr = b + D[d + 1];
            if (nc < R.c0 || nc > R.c1 || nr < R.r0 || nr > R.r1) continue;
            if (seen[nc + ',' + nr] || !map.isWalkable(nc, nr)) continue;
            seen[nc + ',' + nr] = true; q.push(nc, nr);
          }
        }
        break;
      }
    }
    var missing = [], extra = [];
    for (k in stood) if (!mm.isExplored(+k.split(',')[0], +k.split(',')[1])) missing.push(k);
    for (k in mm.explored) if (!allowed[k]) extra.push(k);
    t.ok(missing.length === 0, 'P4.11 項目4: 実歩行した全マスが開示される',
      '未開示' + missing.length + ' ' + missing.slice(0, 6).join(' '));
    t.ok(extra.length === 0, 'P4.11 項目4: 歩いた経路＋隣接＋入った部屋の外は開示されない',
      '余分' + extra.length + ' ' + extra.slice(0, 8).join(' '));
    t.ok(mm.exploredCount === Object.keys(allowed).length,
      'P4.11 項目4: 開示マス数が正解データと一致する',
      mm.exploredCount + ' / ' + Object.keys(allowed).length);

    /* 同じ帯（区画）の遠いマスが開示されていないこと＝帯の一括開示バグの直接検出 */
    var bands = [], regions = meta.regions || [];
    for (var b = 0; b < regions.length; b++) {
      if (!regions[b].zone) continue;
      if (mm._isRoom(regions[b])) continue;
      if ((regions[b].c1 - regions[b].c0 + 1) < map.width * 0.5) continue;
      bands.push(regions[b]);
    }
    t.ok(bands.length >= 5, 'P4.11 項目4: 帯ゾーン（区画A〜F）が region に存在する（前提）', bands.length);
    var spBand = null;
    for (var s2 = 0; s2 < bands.length; s2++) {
      if (meta.spawn.row >= bands[s2].r0 && meta.spawn.row <= bands[s2].r1) spBand = bands[s2];
    }
    var farInBand = 0, farTotal = 0;
    if (spBand) {
      for (var rr2 = spBand.r0; rr2 <= spBand.r1; rr2++) {
        for (var cc2 = 0; cc2 < map.width; cc2++) {
          if (!rawWalk(map, cc2, rr2) || allowed[cc2 + ',' + rr2]) continue;
          farTotal++;
          if (mm.isExplored(cc2, rr2)) farInBand++;
        }
      }
    }
    t.ok(farTotal > 100, 'P4.11 項目4: スタートの帯に「歩いていないマス」が十分ある（前提）', farTotal);
    t.ok(farInBand === 0,
      'P4.11 項目4: 同じ帯にいるだけで帯が丸ごと開示されない（旧欠陥の直接検出）', farInBand + '/' + farTotal);

    /* 別の帯・入っていない部屋が開示されていないこと */
    var otherRoom = null;
    for (var q2 = 0; q2 < rooms.length; q2++) if (!entered[rooms[q2].id]) { otherRoom = rooms[q2]; break; }
    if (t.ok(!!otherRoom, 'P4.11 項目4: 入っていない部屋がある（前提）')) {
      var leak = 0, tot = 0;
      for (var c3 = otherRoom.c0; c3 <= otherRoom.c1; c3++) {
        for (var r3 = otherRoom.r0; r3 <= otherRoom.r1; r3++) {
          if (!rawWalk(map, c3, r3) || allowed[c3 + ',' + r3]) continue;
          tot++;
          if (mm.isExplored(c3, r3)) leak++;
        }
      }
      t.ok(leak === 0, 'P4.11 項目4: 入っていない部屋（' + otherRoom.id + '）は真っ暗のまま', leak + '/' + tot);
    }

    /* 帯・長廊下は「部屋」ではない（開示の単位にしない） */
    var lm = meta.landmarks || [];
    for (var l = 0; l < lm.length; l++) {
      var reg = null;
      for (var rg = 0; rg < regions.length; rg++) if (regions[rg].id === lm[l].id) reg = regions[rg];
      if (reg) t.ok(mm._isRoom(reg) === false, 'P4.11 項目4: 長廊下 ' + lm[l].id + ' は部屋扱いしない');
    }
    for (var bb = 0; bb < bands.length; bb++) {
      t.ok(mm._isRoom(bands[bb]) === false, 'P4.11 項目4: 帯ゾーン ' + bands[bb].id + ' は部屋扱いしない');
    }
    /* 部屋に入れば、その部屋の中は（繋がっている範囲が）開示される */
    var hall = null;
    for (var hh = 0; hh < rooms.length; hh++) if (rooms[hh].id === 'hall') hall = rooms[hh];
    if (hall) {
      t.ok(mm.regionsSeen['hall'] === true, 'P4.11 項目4: スタートの部屋（受入ホール）に入った記録が立つ');
      var inHall = 0, hallWalk = 0;
      for (var hc = hall.c0; hc <= hall.c1; hc++) {
        for (var hr = hall.r0; hr <= hall.r1; hr++) {
          if (!rawWalk(map, hc, hr)) continue;
          hallWalk++;
          if (mm.isExplored(hc, hr)) inHall++;
        }
      }
      t.ok(inHall >= 12 && inHall >= hallWalk * 0.6,
        'P4.11 項目4: 入った部屋は奥まで（繋がっている範囲が）開示される',
        inHall + '/' + hallWalk);
    }
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 項目4（描画側）: マス→画素の変換が往復で一致し、canvas の画素が実座標と合う */
  function testP411MapPixels(t, g) {
    g.reset();
    localStorage.removeItem(SAVE_KEY);
    var mm = g.minimap, map = g.map, meta = map.meta;
    var route = routeTo(g, meta.spawn.col, meta.spawn.row, 10, 46);
    walkCells(g, route.slice(0, 60));

    /* 1) 座標変換の往復（全踏破マス） */
    var v = mm.view();
    t.near(v.s, v.px / Math.max(map.width, map.height), 1e-9, 'P4.11: 1マスの画素数 = 解像度 / 最大辺', v.s);
    var bad = 0, k;
    for (k in mm.explored) {
      var pr = k.split(','), c = +pr[0], r = +pr[1];
      var q = mm.cellToPx(c, r, v);
      var back = mm.pxToCell(q.x, q.y, v);
      if (back.col !== c || back.row !== r) bad++;
    }
    t.ok(bad === 0, 'P4.11 項目4: マス→画素→マスの往復が全踏破マスで一致する', bad + '件ずれ');
    /* 端のマスも canvas の内側に落ちる */
    var c00 = mm.cellToPx(0, 0, v), c11 = mm.cellToPx(map.width - 1, map.height - 1, v);
    t.ok(c00.x > 0 && c00.y > 0 && c11.x < v.px && c11.y < v.px,
      'P4.11 項目4: 地図の四隅が canvas の内側に収まる',
      c00.x.toFixed(1) + ',' + c00.y.toFixed(1) + ' / ' + c11.x.toFixed(1) + ',' + c11.y.toFixed(1));
    /* ワールド座標の変換もマスの変換と一致する（プレイヤー印がずれない） */
    var pcell = mm.cellToPx(g.player.col(), g.player.row(), v);
    var pw = mm.worldToPx(g.player.x, g.player.z, v);
    t.ok(Math.abs(pcell.x - pw.x) <= v.s * 0.5 + 1e-6 && Math.abs(pcell.y - pw.y) <= v.s * 0.5 + 1e-6,
      'P4.11 項目4: ワールド座標の変換がマスの変換と同じ枠に落ちる',
      (pw.x - pcell.x).toFixed(2) + ',' + (pw.y - pcell.y).toFixed(2));

    /* 2) canvas の画素を読んで、開示領域が実座標と一致することを確かめる */
    mm._dirty = true; mm.draw();
    var ctx = mm.ctx, px = v.px;
    var img = ctx.getImageData(0, 0, px, px).data;
    function lumAt(x, y) {
      var i = ((y | 0) * px + (x | 0)) * 4;
      return 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
    }
    /* ロープ・プレイヤー・出口の印が乗っていないマスだけを標本にする */
    var onRope = Object.create(null), rope = g.rope;
    for (var i2 = 0; i2 < rope.stack.length; i2++) {
      var sc = rope.stack[i2].col, sr = rope.stack[i2].row;
      for (var dc = -1; dc <= 1; dc++) for (var dr = -1; dr <= 1; dr++) onRope[(sc + dc) + ',' + (sr + dr)] = true;
    }
    var pc = g.player.col(), prow = g.player.row();
    var bgLum = lumAt(2, 2);
    var litOk = 0, litNg = 0, sample = [];
    for (k in mm.explored) {
      var p2 = k.split(','), cc = +p2[0], rr = +p2[1];
      if (onRope[k]) continue;
      if (Math.abs(cc - pc) < 6 && Math.abs(rr - prow) < 6) continue;
      if (meta.exitPad && cc === meta.exitPad.col && rr === meta.exitPad.row) continue;
      var qq = mm.cellToPx(cc, rr, v);
      var lum = lumAt(qq.x, qq.y);
      if (lum > bgLum + 30) { litOk++; if (sample.length < 3) sample.push(k + '=' + lum.toFixed(0)); }
      else { litNg++; if (sample.length < 6) sample.push('NG ' + k + '=' + lum.toFixed(0)); }
    }
    t.ok(litOk > 30 && litNg === 0,
      'P4.11 項目4: 開示マスの画素が実座標どおり明るい', litOk + '明 / ' + litNg + '暗 ' + sample.join(' '));
    /* 未踏破の歩行可能マス（経路から遠いもの）は背景色のまま */
    var darkOk = 0, darkNg = 0, dsample = [];
    for (var r4 = 1; r4 < map.height - 1 && darkOk + darkNg < 200; r4++) {
      for (var c4 = 1; c4 < map.width - 1; c4++) {
        if (!rawWalk(map, c4, r4) || mm.isExplored(c4, r4)) continue;
        if (onRope[c4 + ',' + r4]) continue;
        var near = false;
        for (var dc2 = -2; dc2 <= 2 && !near; dc2++) {
          for (var dr2 = -2; dr2 <= 2; dr2++) if (mm.isExplored(c4 + dc2, r4 + dr2)) { near = true; break; }
        }
        if (near) continue;
        var q4 = mm.cellToPx(c4, r4, v);
        var l4 = lumAt(q4.x, q4.y);
        if (l4 <= bgLum + 6) darkOk++;
        else { darkNg++; if (dsample.length < 6) dsample.push(c4 + ',' + r4 + '=' + l4.toFixed(0)); }
        if (darkOk + darkNg >= 200) break;
      }
    }
    t.ok(darkOk > 50 && darkNg === 0,
      'P4.11 項目4: 未踏破のマスは背景色のまま（描画が実座標とずれていない）',
      darkOk + '暗 / ' + darkNg + '明 ' + dsample.join(' '));

    /* 3) 全画面に切り替えても同じ変換で描ける（解像度が変わる） */
    var wasFull = mm.full;
    if (!wasFull) mm.toggle();
    var v2 = mm.view();
    t.ok(v2.px > v.px, 'P4.11: 全画面ではバッキング解像度が上がる', v.px + ' → ' + v2.px);
    var bad2 = 0;
    for (k in mm.explored) {
      var p5 = k.split(','), c5 = +p5[0], r5 = +p5[1];
      var q5 = mm.cellToPx(c5, r5, v2), b5 = mm.pxToCell(q5.x, q5.y, v2);
      if (b5.col !== c5 || b5.row !== r5) bad2++;
    }
    t.ok(bad2 === 0, 'P4.11 項目4: 全画面でも往復変換が一致する', bad2);
    if (mm.full !== wasFull) mm.toggle();
    g.reset();
    localStorage.removeItem(SAVE_KEY);
  }

  /** 項目6: ミニマップの大きさ・矢印・コントラスト */
  function testP411MinimapUi(t, g) {
    g.reset();
    var mm = g.minimap, C = ESCAPE.MINIMAP_CONST;
    var wrap = document.getElementById('minimap-wrap');
    if (!t.ok(!!wrap, 'P4.11 項目6: ミニマップの枠が結線されている')) return;

    /* --- 幅は画面の32%（横持ちで画面を覆わないよう 62vh でだけ頭を押さえる） --- */
    var cs = global.getComputedStyle(wrap);
    var vw = global.innerWidth, vh = global.innerHeight;
    var want = Math.max(118, Math.min(vw * 0.32, vh * 0.62));
    var got = parseFloat(cs.width);
    t.near(got, want, 1.5, 'P4.11 項目6: ミニマップ幅 = min(32vw, 62vh)',
      got.toFixed(1) + 'px / 画面 ' + vw + 'x' + vh + ' → ' + (got / vw * 100).toFixed(1) + '%');
    t.ok(got / vw >= 0.28 || vw * 0.32 > vh * 0.62,
      'P4.11 項目6: 画面幅の32%相当（縦持ちでは 32vw がそのまま効く）',
      (got / vw * 100).toFixed(1) + '%');
    var box = wrap.getBoundingClientRect();
    /* 画面サイズが取れない環境（非表示のオフスクリーン等）では判定できないので
       その旨を detail に残して通す。実機・E2E は必ず実寸で通る。 */
    var measurable = vw >= 320 && vh >= 320;
    t.ok(!measurable || (box.right <= vw + 0.5 && box.top >= 0 && box.bottom <= vh + 0.5),
      'P4.11 項目6: 画面からはみ出さない（縦持ち/横持ちとも）',
      measurable ? (box.left.toFixed(0) + ',' + box.top.toFixed(0) + ' ' +
        box.width.toFixed(0) + 'x' + box.height.toFixed(0) + ' / ' + vw + 'x' + vh)
        : ('画面サイズ未確定のため判定省略 ' + vw + 'x' + vh));
    t.ok(parseFloat(cs.paddingLeft) <= 3, 'P4.11 項目6: 余白は最小', cs.padding);

    /* --- 全画面地図: 余白最小・画面いっぱい --- */
    var wasFull = mm.full;
    if (!wasFull) mm.toggle();
    var cs2 = global.getComputedStyle(wrap);
    var full = parseFloat(cs2.width);
    t.ok(full >= Math.min(vw, vh) * 0.90, 'P4.11 項目6: 全画面地図は余白最小（短辺の90%以上）',
      full.toFixed(0) + ' / ' + Math.min(vw, vh));
    t.ok(parseFloat(cs2.paddingLeft) <= 4, 'P4.11 項目6: 全画面地図の余白も最小', cs2.padding);
    if (mm.full !== wasFull) mm.toggle();

    /* --- プレイヤー矢印: P4.12 項目2 で 2.80 → 1.8マス（旧比 約2倍）へ縮小 ---
       【P4.11 失効】「旧サイズの3倍以上」は実プレイで大きすぎたため失効。 */
    t.near(C.PLAYER_ARROW, 1.80, 1e-9, 'P4.12 項目2: プレイヤー矢印は 1.8マス（契約）', C.PLAYER_ARROW);
    t.ok(C.PLAYER_ARROW < 2.80, 'P4.12 項目2: 旧2.80マスより小さい', C.PLAYER_ARROW);
    t.ok(C.PLAYER_ARROW >= C.PLAYER_ARROW_LEGACY * 2 &&
      C.PLAYER_ARROW <= C.PLAYER_ARROW_LEGACY * 2.4,
      'P4.12 項目2: 元（0.85マス）の約2倍に収まっている',
      C.PLAYER_ARROW + ' / ' + C.PLAYER_ARROW_LEGACY +
      ' = ×' + (C.PLAYER_ARROW / C.PLAYER_ARROW_LEGACY).toFixed(2));
    var v = mm.view();
    t.ok(mm.playerArrowSize(v) > mm.legacyArrowSize(v),
      'P4.12 項目2: 実描画サイズでも旧実装より大きい（読める大きさは保つ）',
      mm.playerArrowSize(v).toFixed(1) + ' / ' + mm.legacyArrowSize(v).toFixed(1));

    /* 向きが分かる＝yaw を変えると矢印の先端が動き、先端は前方 */
    var p = g.player;
    place(g, g.map.meta.spawn.col, g.map.meta.spawn.row, 0);
    mm._dirty = true; mm.draw();
    var q = mm.worldToPx(p.x, p.z, v), f = mm.playerArrowSize(v);
    function tipOf(yaw) {
      return { x: q.x + (-Math.sin(yaw)) * f, y: q.y + (-Math.cos(yaw)) * f };
    }
    var ctx = mm.ctx, px = v.px;
    function lum(x, y) {
      var d = ctx.getImageData(x | 0, y | 0, 1, 1).data;
      return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
    }
    var tip0 = tipOf(p.yaw);
    var backOf = { x: q.x - (-Math.sin(p.yaw)) * f * 1.15, y: q.y - (-Math.cos(p.yaw)) * f * 1.15 };
    var inTip = { x: tip0.x - (-Math.sin(p.yaw)) * 2, y: tip0.y - (-Math.cos(p.yaw)) * 2 };
    t.ok(lum(inTip.x, inTip.y) > 140,
      'P4.11 項目6: 矢印の先端（前方）が明るく描かれている',
      '先端の2px内側 lum=' + lum(inTip.x, inTip.y).toFixed(0));
    t.ok(lum(backOf.x, backOf.y) < 120,
      'P4.11 項目6: 矢印の後方は空いている（＝向きが読める）',
      '後方 lum=' + lum(backOf.x, backOf.y).toFixed(0));
    p.yaw = Math.PI / 2;
    mm._dirty = true; mm.draw();
    var tip90 = tipOf(p.yaw);
    t.ok(Math.hypot(tip90.x - tip0.x, tip90.y - tip0.y) > f,
      'P4.11 項目6: 向きを変えると矢印の先端が動く（円ではない）');

    /* --- コントラスト: 踏破/未踏破/ロープ/結び目/区画名 --- */
    function rgbOf(css) {
      var m = css.match(/^#([0-9a-f]{6})$/i);
      if (m) {
        var n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      var m2 = css.match(/rgba?\(([^)]+)\)/);
      var a = m2[1].split(',');
      return [+a[0], +a[1], +a[2]];
    }
    function rel(css) {
      var c = rgbOf(css);
      function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    }
    function ratio(a, b) {
      var la = rel(a), lb = rel(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    var pairs = [
      ['floor', C.COL.floor, 3.0], ['room', C.COL.room, 4.5],
      ['rope', C.COL.rope, 8.0], ['knot', C.COL.knot, 8.0],
      ['anchor', C.COL.anchor, 7.0], ['label', C.COL.label, 8.0],
      ['exit', C.COL.exit, 7.0], ['ghost', C.COL.ghost, 2.5]
    ];
    for (var i = 0; i < pairs.length; i++) {
      var rr = ratio(pairs[i][1], C.COL.bg);
      t.ok(rr >= pairs[i][2],
        'P4.11 項目6: ' + pairs[i][0] + ' が暗い背景に対して読める（コントラスト比 ≥ ' + pairs[i][2] + '）',
        rr.toFixed(2) + ':1');
    }
    t.ok(ratio(C.COL.room, C.COL.floor) >= 1.25,
      'P4.11 項目6: 部屋と通路が塗り分けられている', ratio(C.COL.room, C.COL.floor).toFixed(2));
    t.ok(C.MINI_PX >= 320 && C.FULL_PX >= 700,
      'P4.11 項目6: バッキング解像度を上げてある（線がぼけない）', C.MINI_PX + '/' + C.FULL_PX);
    g.reset();
  }

  /** 項目5: ヘッドライトは前方へ伸びるくさび（円形スプライト禁止） */
  function testP411Headlight(t, g) {
    g.reset();
    var hl = g.headlight, T = ESCAPE.HEADLIGHT_TUNING;
    if (!t.ok(!!hl, 'P4.11 項目5: ヘッドライトが組み込まれている')) return;

    /* スプライトを使っていない（円形スプライト禁止の直接検出） */
    var sprites = 0, meshes = 0;
    hl.group.traverse(function (o) {
      if (o.isSprite || (o.type === 'Sprite')) sprites++;
      if (o.isMesh) meshes++;
    });
    t.ok(sprites === 0, 'P4.11 項目5: 円形スプライトを使っていない', sprites);
    t.ok(meshes >= 3, 'P4.11 項目5: 床のくさび・壁のしみ・空中の帯の3枚がある', meshes);
    t.ok(T.coneRy / T.coneRx <= 0.6,
      'P4.11 項目5: 空中の帯は扁平（真円の円錐ではない）', (T.coneRy / T.coneRx).toFixed(2));
    t.ok(T.beamHalfFar > T.beamHalfNear * 2,
      'P4.11 項目5: 前方ほど広がる（くさび形）', T.beamHalfNear + ' → ' + T.beamHalfFar);

    /* 開けた場所（3マス直線）で点灯させ、床の光の形を測る */
    var open = findTriple(g.map, false);
    place(g, open.col, open.row, -90);
    g.input.moveX = 0; g.input.moveY = 1;
    sim(g, 24);
    t.ok(hl.on === true, 'P4.11 項目5: 歩行中は点灯（挙動は維持）', hl.level.toFixed(2));
    var sh = hl.beamShape();
    t.ok(sh.forwardMin >= 0, 'P4.11 項目5: 光は足元より後ろへ出ない（前方に伸びる）',
      sh.forwardMin.toFixed(2) + 'm');
    t.ok(sh.forwardMax >= 2.0, 'P4.11 項目5: 前方へ2m以上伸びる', sh.forwardMax.toFixed(2) + 'm');
    t.ok(sh.length / Math.max(0.001, sh.width) >= 1.4,
      'P4.11 項目5: 縦長（前後 > 左右）＝円盤ではない',
      '長さ' + sh.length.toFixed(2) + 'm 幅' + sh.width.toFixed(2) + 'm 比' + sh.ratio.toFixed(2));
    t.ok(hl.beam.visible === true && hl._beamMat.opacity > 0.05,
      'P4.11 項目5: 床のくさびが実際に描かれている', hl._beamMat.opacity.toFixed(3));

    /* 中心が明るく縁がソフト（頂点色の分布で検査） */
    var colAttr = hl._beamGeo.attributes.color;
    var mid = Math.floor(hl.T.beamSegs / 3) * 5;      /* 5 = 横方向サンプル数 */
    var cCenter = colAttr.array[(mid + 2) * 3], cEdge = colAttr.array[(mid + 0) * 3];
    var cHalf = colAttr.array[(mid + 1) * 3];
    t.ok(cCenter > cHalf && cHalf > cEdge && cEdge <= 1e-6,
      'P4.11 項目5: 中心が明るく縁は0（ソフトな縁）',
      cCenter.toFixed(3) + ' > ' + cHalf.toFixed(3) + ' > ' + cEdge.toFixed(3));
    var tail = (hl.T.beamSegs * 5 + 2) * 3;
    t.ok(colAttr.array[tail] < cCenter,
      'P4.11 項目5: 先端に向かって減衰する', colAttr.array[tail].toFixed(3) + ' < ' + cCenter.toFixed(3));

    /* カメラのピッチに依存しない（真下を向いても形が変わらない＝円盤にならない） */
    var before = Array.prototype.slice.call(hl._beamPos);
    g.player.pitch = -1.45;
    sim(g, 1);
    var same = true;
    for (var i = 0; i < before.length; i++) {
      if (Math.abs(before[i] - hl._beamPos[i]) > 0.35) { same = false; break; }
    }
    t.ok(same, 'P4.11 項目5: 真下を向いても床の光の形が変わらない（ピッチ非依存）');
    var sh2 = hl.beamShape();
    t.ok(sh2.forwardMin >= 0 && sh2.length / Math.max(0.001, sh2.width) >= 1.4,
      'P4.11 項目5: 真下を向いても円盤に見えない', sh2.ratio.toFixed(2));
    g.player.pitch = 0;

    /* yaw に追従する（向きを変えれば光も回る） */
    var yaw0 = g.player.yaw;
    var f0 = g.player.forward();
    g.player.yaw = yaw0 + Math.PI / 2;
    sim(g, 1);
    var f1 = g.player.forward();
    t.ok(Math.abs(f1.x - f0.x) > 0.5 || Math.abs(f1.z - f0.z) > 0.5, 'P4.11: 向きが変わった（前提）');
    /* 光の重心が「新しい前方」に乗っている（壁が近くて短く切れていても向きは分かる） */
    var pos = hl._beamPos, n = pos.length / 3, gx = 0, gz = 0;
    for (var v2 = 0; v2 < n; v2++) { gx += pos[v2 * 3]; gz += pos[v2 * 3 + 2]; }
    gx = gx / n - g.player.x; gz = gz / n - g.player.z;
    var glen = Math.hypot(gx, gz);
    var dot = (gx * f1.x + gz * f1.z) / Math.max(1e-6, glen);
    t.ok(glen > 0.2 && dot > 0.98,
      'P4.11 項目5: 向きを変えても光は「その向きの前方」に伸びる',
      '重心距離' + glen.toFixed(2) + 'm 前方一致' + dot.toFixed(3));
    var sh3 = hl.beamShape();
    t.ok(sh3.forwardMin >= 0, 'P4.11 項目5: 向きを変えても光は後方へ回り込まない', sh3.forwardMin.toFixed(2));
    g.player.yaw = yaw0;

    /* 壁に当たると壁面に楕円が出て、床の光はそこで切れる */
    var wallCell = null, map = g.map;
    var cells = map.walkableCells();
    for (var w = 0; w < cells.length && !wallCell; w++) {
      var c = cells[w];
      if (map.isSolid(c.col + 1, c.row) && map.isWalkable(c.col - 1, c.row)) wallCell = c;
    }
    if (t.ok(!!wallCell, 'P4.11 項目5: 壁に正対できるマスがある')) {
      place(g, wallCell.col, wallCell.row, -90);   /* yaw=-90° → +X 方向を向く */
      g.input.moveY = 1;
      sim(g, 12);
      t.ok(hl.hitDist < T.beamNear + T.beamLen,
        'P4.11 項目5: 前方の壁を検出する', hl.hitDist.toFixed(2) + 'm');
      t.ok(hl.wall.visible === true && hl._wallMat.opacity > 0.02,
        'P4.11 項目5: 壁に当たると壁面にも楕円が出る', hl._wallMat.opacity.toFixed(3));
      var ws = hl.wall.scale;
      t.ok(Math.abs(ws.x - ws.y * 1) > 1e-9 || T.wallRyRatio !== 1,
        'P4.11 項目5: 壁のしみは楕円（真円ではない）', T.wallRyRatio);
      var shw = hl.beamShape();
      t.ok(shw.forwardMax <= hl.hitDist + 0.01,
        'P4.11 項目5: 床の光は壁の手前で切れる（壁を突き抜けない）',
        shw.forwardMax.toFixed(2) + ' <= ' + hl.hitDist.toFixed(2));
    }
    /* 消灯すれば全部消える（挙動は維持） */
    g.input.moveY = 0;
    sim(g, 120);
    t.ok(hl.on === false && hl.level < 0.01, 'P4.11 項目5: 停止で消灯（挙動は維持）', hl.level);
    t.ok(hl.beam.visible === false && hl.wall.visible === false && hl.cone.visible === false,
      'P4.11 項目5: 消灯中は光のメッシュが消える');
    t.near(ESCAPE.ENEMY_TUNING.headlightSightMul, 1.5, 1e-9,
      'P4.11 項目5: 点灯中の発見距離1.5倍は維持', ESCAPE.ENEMY_TUNING.headlightSightMul);
    /* 空中の帯は真下を向くと消える（床に刺さって棒に見えるのを防ぐ） */
    g.player.pitch = 0;
    t.near(hl.conePitchFade(), 1, 1e-9, 'P4.11 項目5: 水平を見ている時は空中の帯が出る');
    g.player.pitch = -1.45;
    t.near(hl.conePitchFade(), 0, 1e-9, 'P4.11 項目5: 真下を向くと空中の帯は消える（棒にならない）');
    g.player.pitch = 0;
    g.input.reset();
    g.reset();
  }

  function runAll(opts) {
    var g = ESCAPE.game;
    var t = new Runner();
    if (!g) {
      t.ok(false, 'ゲームが初期化されている');
      return summarize(t);
    }

    /* P4.5: 機械テスト中は実出力しない（契約）。連続音も即座に止めてから始める。
       finally 相当で必ず戻す＝runAll 後の通常操作で音が出なくならないこと。 */
    var au = ESCAPE.audio;
    var audioWasTest = au ? au.testMode : false;
    if (au) { au.testMode = true; au.panic(); }

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
      testBoardStall, testCaptureLimit, testChaseGiveUp, testInterruptSafety, testEnemyDebugCoexist,
      /* P4/P4.8: 調べるUI統合・メモ・チェックポイント/セーブ */
      testMemoNotes, testMemoCloseGestures, testModalInterruptSafety,
      testSaveLoadRestore, testEraseAllData,
      /* P4.14: セーブポイント（奥優先の復帰地点・軌跡の錨移動）＋地図にゴールの星 */
      testP414SavePointData, testP414SavePointHint, testP414SavePointRecord,
      testP414DeepestWins, testP414CaptureRespawn, testP414TensionContinuity,
      testP414AreaResetWipesSaves, testP414MapStarAndTerminals, testP414AutoCheckpointRetired,
      /* P4.5: 音響＋恐怖演出 */
      testAudioContract, testAudioRender, testAudioSpatial, testAudioHooks, testAudioLocked, testAudioVoiceCap,
      testAudioSettings, testAudioDirector, testAudioAmbience, testFearFx, testPatrolPause,
      /* P4.6: 捕獲シネマティック＋駆け引き強化 */
      testCaptureCinematic, testCaptureFaceDetail, testCaptureMash, testEatenGameOver,
      testCaptureInterrupt, testNoiseSprint, testLockerSeen,
      /* P4.8: アリアドネ方式（ロープ・地図・銘板・鍵と隔壁・ヘッドライト） */
      testRopeLength, testRopePayoutRewind, testP412RopeUnlimited, testRopeKnotReattach,
      testAreaResetFogAndGhost, testFogOfWar, testRegionSigns, testKeyAndBulkhead,
      testHeadlight, testRetiredGimmicks, testArea1V3Contract, testSignTexts,
      /* P4.9: 新マップZ4・区画ごとの景観差・ロープ張力インジケータ */
      testP49Zones, testP49Look, testP49DeadEnds, testP49Props,
      testP49RopeTension, testP49RopeFeasible,
      /* P4.11 レーンB: ロープ緩和・地図の踏破記録・ヘッドライトの形・ミニマップ */
      testP411RopeRelax, testP411FogTruth, testP411MapPixels, testP411MinimapUi, testP411Headlight
    ];
    /* 他モジュールが登録した追加スイート（P4.10a の敵2体・絶叫・地図リセット等）も runAll に乗せる */
    if (ESCAPE.__extraSuites && ESCAPE.__extraSuites.length) suites = suites.concat(ESCAPE.__extraSuites);
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
      t.ok(g.stealth.captures === 0 && g.stealth.jail.phase === 'none', '復帰: 捕獲・演出の状態が初期化',
        g.stealth.captures + '/' + g.stealth.jail.phase);
      t.ok(g.stealth.fade === 0 && !g.stealth.inLocker(), '復帰: 暗転もロッカーも解除');
      t.ok(upAll, '復帰: 倒した板が元に戻る');
      t.ok(ESCAPE.noise.pending.length === 0, '復帰: 音イベントのキューが空', ESCAPE.noise.pending.length);
    }
    /* P4.6: 捕獲シネマティック・高解像度顔・赤い目・ゲームオーバー画面も初期状態へ */
    if (g.cinematic) {
      t.ok(!g.cinematic.active() && g.cinematic.stage === 'none',
        '復帰: 捕獲シネマティックが動いていない', g.cinematic.stage);
      t.near(g.cinematic.fade, 0, 1e-9, '復帰: 演出の暗転がゼロ');
      t.ok(g.cinematic.mash === 0, '復帰: 連打の蓄積がゼロ', g.cinematic.mash);
      t.ok(g.ai.cine === false, '復帰: 敵AIが演出から戻っている');
      t.ok(g.ai.enemy.detailHi === false, '復帰: 顔が通常解像度へ戻っている');
      t.ok(g.ai.enemy.redEyesVisible() === false, '復帰: 赤い目が残っていない');
      t.ok(g.ai.enemy.activeTriangles() === g.ai.enemy.triangles,
        '復帰: 演出ぶんの三角形が残っていない',
        g.ai.enemy.activeTriangles() + ' vs ' + g.ai.enemy.triangles);
      t.ok(g.ai.lockerOpens === 0 && g.ai.lockerTarget === null,
        '復帰: ロッカー狩りの状態が初期化', g.ai.lockerOpens);
      var gov = document.getElementById('gameover-overlay');
      t.ok(!!gov && !gov.classList.contains('show'), '復帰: ゲームオーバー画面が閉じている');
    }
    /* P4: 進行状態(仕掛け・メモ・モーダル)も製品初期状態へ戻ること */
    if (g.progress) {
      var pr = g.progress;
      t.ok(!pr.gimmick.key && !pr.gimmick.doorOpen,
        '復帰: 鍵と隔壁の状態が初期化', JSON.stringify(pr.gimmick));
      t.near(pr.darkLevel, 0, 1e-9, '復帰: 画面の暗転オーバーレイが解除');
      t.ok(pr.clearedBy === null, '復帰: クリア経路の記録が消えている', pr.clearedBy);
      t.ok(Object.keys(pr.notesRead).length === 0, '復帰: 既読メモが消えている');
      t.ok(Object.keys(pr.signsRead).length === 0, '復帰: 読んだ銘板が消えている');
      t.ok(pr.objective() === ESCAPE.PROGRESS_OBJECTIVE.findKey,
        '復帰: 目的表示が開始時の正文に戻る', pr.objective());
      t.ok(pr.checkpoint === null, '復帰: 復帰地点が未設定（セーブポイント未記録）');
      t.ok(Object.keys(pr.saved).length === 0 && pr.savePointsSeenCount === 0,
        '復帰: セーブポイントの記録・発見が残っていない（P4.14）');
      t.ok(pr.modal === null, '復帰: モーダルが閉じている');
      t.ok(!pr.cleared, '復帰: クリア扱いが解除');
      t.ok(pr.dom.memoOverlay.classList.contains('show') === false &&
        pr.dom.endingOverlay.classList.contains('show') === false,
        '復帰: メモ/クリアのオーバーレイが全て非表示');
      try {
        t.ok(global.localStorage.getItem(SAVE_KEY) === null,
          '復帰: 機械テストが残したセーブデータが残っていない');
      } catch (e) { /* localStorage無効環境は対象外 */ }
    }
    /* P4.8: ロープ・地図・ヘッドライトも製品初期状態へ戻ること */
    if (g.rope) {
      t.near(g.rope.used, 0, 1e-9, '復帰: ロープの繰り出しがゼロ', g.rope.used);
      t.ok(g.rope.stack.length === 1, '復帰: ロープが錨まで巻き取られている', g.rope.stack.length);
      t.ok(g.rope.anchor.col === g.map.meta.spawn.col && g.rope.anchor.row === g.map.meta.spawn.row,
        '復帰: 錨がスタートへ戻っている（P4.14）', g.rope.anchor.col + ',' + g.rope.anchor.row);
      t.ok(g.rope.isAttached() && g.rope.knots.length === 0 && g.rope.laps.length === 0 && g.rope.lapIndex === 0,
        '復帰: 過去の周の軌跡が残っていない（P4.13）');
      t.ok(g.rope.taut === undefined && g.rope.blocks === 0,
        '復帰: 前進不可のカウンタがゼロ（P4.12: 「張り」状態そのものが失効）', g.rope.blocks);
    }
    if (g.minimap) {
      t.ok(g.minimap.info().zones.length === 0, '復帰: 地図の区画名が消えている');
      t.ok(g.minimap.full === false, '復帰: 地図の全画面表示が閉じている');
    }
    if (g.headlight) {
      t.ok(g.headlight.on === false, '復帰: ヘッドライトが消灯している');
      t.near(g.headlight.level, 0, 1e-9, '復帰: ヘッドライトの光量がゼロ');
    }
    /* P4.5: 音響・恐怖演出も製品初期状態へ戻ること */
    if (au) {
      au.testMode = audioWasTest;                 /* 実出力の停止を必ず解除する */
      t.ok(au.testMode === false, '復帰: 機械テストの無音モードが解除される', au.testMode);
      t.near(au.fx.vignette, 0, 1e-9, '復帰: 周辺減光がゼロ');
      t.near(au.fx.shake, 0, 1e-9, '復帰: 画面振動がゼロ');
      t.near(au.fx.fovAdd, 0, 1e-9, '復帰: FOV加算がゼロ');
      t.near(g.camera.fov, 75, 1e-6, '復帰: カメラのFOVが基準値', g.camera.fov);
      t.near(au.exertion, 0, 1e-9, '復帰: 息切れの蓄積がゼロ');
      t.near(au.hbT, 0, 1e-9, '復帰: 心拍の累積器がゼロ');
      t.ok(au._live.length === 0, '復帰: 発音中のボイスが残っていない', au._live.length);
      t.ok(au.errors === 0, '復帰: 音響の例外がゼロ', au.errors);
      if (au.amb) {
        t.near(au.amb.out.gain.value, 0, 1e-9, '復帰: 環境ドローンが止まっている');
        t.near(au.buzz.out.gain.value, 0, 1e-9, '復帰: 蛍光灯のジー音が止まっている');
        t.near(au.breath.out.gain.value, 0, 1e-9, '復帰: 呼吸音が止まっている');
      }
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

  /**
   * P4.5: 音の数値判定は OfflineAudioContext の事前レンダ（約0.25秒・非同期）に依るため、
   * ページ読み込み直後に走らせる場合はこちらを使う。完了を待ってから runAll する。
   */
  function runAllAsync(opts) {
    var A = ESCAPE.Audio;
    var wait = (A && A.prewarm) ? A.prewarm() : null;
    if (wait && wait.then) return wait.then(function () { return runAll(opts); });
    return global.Promise ? global.Promise.resolve(runAll(opts)) : runAll(opts);
  }

  global.__test = {
    runAll: runAll,
    runAllAsync: runAllAsync,
    /** 個別デバッグ用 */
    _place: function (col, row, yawDeg) { place(ESCAPE.game, col, row, yawDeg); ESCAPE.game.syncCamera(); }
  };
})(window);
