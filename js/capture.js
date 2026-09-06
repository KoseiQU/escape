/* ESCAPE — P4.6: 捕獲シネマティック（契約 DESIGN.md §4「捕獲演出と駆け引き」）
 *
 * 一人称のまま途切れなく繋ぐ。段階と長さは ENEMY_TUNING に集約（契約の指定）:
 *   1 zoom  0.4s  敵の顔へ強制ズーム＋大音量の刺し音
 *   2 grab  2.0s  視界に敵の手／激しい揺れ／呻き。連打で揺れが増す（結果は変わらない）
 *   3 drag  3.5s  床すれすれの仰向け視点。天井灯が流れ、視界の端に敵と自分の足
 *   4 black 1.5s  暗転＋牢扉の金属音→鍵の音
 *   → 既存の牢システム（第4房・進行保持・こじ開け）へ接続
 * 3回目の捕獲は 3 を「食われる」(maw) に差し替え、暗転後にゲームオーバー画面へ。
 *
 * 上書き事故の防止（重要）:
 *   - カメラは Game.syncCamera() の「最後」に applyCamera() で上書きする。
 *     プレイヤー追従やFOVの毎フレーム更新に負けないのはこの順序のため。
 *   - 演出中は ai.cine = true。敵AIは駆動を止め、モデルの update は当モジュールが持つ。
 *   - 高解像度顔・赤い目・手・口は end() で必ず戻す（機械テストが演出外の残留を見る）。
 *   - 乱数は使わず simTime の三角関数で揺らす＝ __pump 駆動のスクショが決定的になる。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function yawOf(dx, dz) { return Math.atan2(-dx, -dz); }

  function sfx(name, p) {
    if (ESCAPE.audio && ESCAPE.audio.event) ESCAPE.audio.event(name, p || {});
  }

  var UP = new THREE.Vector3(0, 1, 0);
  var _m = new THREE.Matrix4();
  var _v = new THREE.Vector3();
  var _v2 = new THREE.Vector3();
  var _e = new THREE.Euler(0, 0, 0, 'YXZ');

  /* 段階の順序（mode 別）。'done' は演出の終了を意味する仮想段階 */
  var SEQ_JAIL = ['zoom', 'grab', 'drag', 'black'];
  var SEQ_EAT = ['zoom', 'grab', 'maw', 'black'];

  function CaptureCinematic(game) {
    this.game = game;
    this.props = new THREE.Group();
    this.props.name = 'capture-props';
    this.props.visible = false;
    game.scene.add(this.props);
    /* camera 空間に貼り付く演出物（敵の手・自分の足・口） */
    this.camSpace = new THREE.Group();
    this.camSpace.name = 'capture-camspace';
    this.camSpace.visible = false;
    game.scene.add(this.camSpace);
    this._geos = [];
    this._mats = [];
    this.lamps = null;
    this.feet = null;
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.q0 = new THREE.Quaternion();
    this.q1 = new THREE.Quaternion();
    this.qs = new THREE.Quaternion();     /* 揺れ用のスクラッチ（q0/q1 を壊さない） */
    this.headTilt = { x: 0, z: 0, n: 0 };
    this.eyePos = new THREE.Vector3();
    this.facePos = new THREE.Vector3();
    this.nearPos = new THREE.Vector3();
    this.dragDir = new THREE.Vector3(0, 0, -1);
    this.dragOrigin = new THREE.Vector3();
    this.actor = null;                    /* P4.10: 捕まえた個体（演出の主役） */
    this._hard();
  }

  /** 内部状態を「演出していない」へ落とす（DOM・モデルには触らない） */
  CaptureCinematic.prototype._hard = function () {
    this.mode = null;
    this.stage = 'none';
    this.stageT = 0;
    this.total = 0;
    this.seq = null;
    this.seqI = 0;
    this.mash = 0;
    this.fade = 0;
    this.fov = 0;
    this.done = false;
    this.stages = [];          /* 経過した段階の記録（機械テスト用） */
    this._soundAt = 0;
  };

  CaptureCinematic.prototype.active = function () { return this.stage !== 'none'; };
  CaptureCinematic.prototype.blocksInput = function () { return this.stage !== 'none'; };

  CaptureCinematic.prototype.T = function () { return ESCAPE.ENEMY_TUNING; };

  /** 段階の長さ(s) */
  CaptureCinematic.prototype.durOf = function (stage) {
    var T = this.T();
    if (stage === 'zoom') return T.cineZoomDur;
    if (stage === 'grab') return T.cineGrabDur;
    if (stage === 'drag') return T.cineDragDur;
    if (stage === 'maw') return T.cineMawDur;
    if (stage === 'black') return (this.mode === 'eaten') ? T.cineEatBlackDur : T.cineBlackDur;
    return 0;
  };

  /** 演出全体の長さ(s)。契約の「合計7〜9秒」を機械テストで見るために公開する */
  CaptureCinematic.prototype.totalDur = function (mode) {
    var seq = (mode === 'eaten') ? SEQ_EAT : SEQ_JAIL;
    var save = this.mode;
    this.mode = mode;
    var s = 0;
    for (var i = 0; i < seq.length; i++) s += this.durOf(seq[i]);
    this.mode = save;
    return s;
  };

  /* ---------------- 開始 / 終了 ---------------- */

  /** 演出の主役（P4.10: 捕まえた個体）。未設定なら従来どおり game.ai */
  CaptureCinematic.prototype.ai = function () {
    return this.actor || this.game.ai;
  };

  /** mode: 'jail'（牢送り） / 'eaten'（3回目＝食われる）
   *  byAi: P4.10 で捕まえた個体（顔アップ・赤い目・高解像度化はこの個体で動く） */
  CaptureCinematic.prototype.begin = function (mode, byAi) {
    var g = this.game, p = g.player;
    var ai = byAi || g.ai;
    if (!ai || !ai.enemy) return false;
    this.actor = ai;
    this._hard();
    this.mode = (mode === 'eaten') ? 'eaten' : 'jail';
    this.seq = (this.mode === 'eaten') ? SEQ_EAT : SEQ_JAIL;
    this.seqI = 0;
    this.stage = this.seq[0];
    this.stages.push(this.stage);

    /* 敵の駆動を止めて演出側が持つ（AIの毎フレーム更新に負けないため） */
    ai.cine = true;
    var e = ai.enemy;

    /* 目線の起点＝いまのプレイヤーの目 */
    this.eyePos.set(p.x, p.y + p.eyeHeight, p.z);
    _e.set(p.pitch, p.yaw, 0, 'YXZ');
    this.q0.setFromEuler(_e);
    this.camPos.copy(this.eyePos);
    this.camQuat.copy(this.q0);
    this.fov = 75;

    /* 敵を「目の前で覆いかぶさる直立形態」に据える（実座標も動かす＝影・音も整合） */
    var dx = e.x - p.x, dz = e.z - p.z;
    var len = Math.hypot(dx, dz);
    if (len < 1e-3) { var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) }; dx = f.x; dz = f.z; len = 1; }
    dx /= len; dz /= len;
    this.approach = { x: dx, z: dz };
    e.setForm('stand', true);
    e.state = 'idle';
    e.poseT = 0; e.transTime = 0;
    e.placeAt(p.x + dx * this.T().cineFaceDist, p.z + dz * this.T().cineFaceDist,
      yawOf(-dx, -dz), g.map);
    e.setDetail('hi');
    var self = this;
    this.headTilt.x = 0; this.headTilt.z = 0; this.headTilt.n = 0;
    e.poseExtra = function (pose) {
      pose.head[0] += self.headTilt.x;
      pose.head[2] += self.headTilt.z;
      pose.neck[0] += self.headTilt.n;
    };
    e.update(0, g.simTime);
    e.syncLight(g.world, g.map);
    this._faceOf(e);
    this._nearOf(this.T().cineZoomEnd);

    /* 引きずる方向: いま居るマスから最も長く抜けられる軸方向 */
    this._pickDragDir();
    this.dragOrigin.set(p.x, p.y, p.z);

    /* 演出物 */
    this.camSpace.visible = true;
    this.props.visible = true;
    e.createGrabHands();
    this.camSpace.add(e.grabHands);
    e.grabHands.visible = false;
    if (this.mode === 'eaten') {
      e.createMaw();
      this.camSpace.add(e.maw.group);
      e.maw.group.visible = false;
    }
    this._buildFeet();
    this._buildLamps();

    /* 契約 1: 大音量の刺し音 */
    sfx('cineStab', {});
    return true;
  };

  /** 演出を畳んで通常状態へ完全復帰（赤い目・高解像度・演出物を必ず戻す） */
  CaptureCinematic.prototype.end = function () {
    var g = this.game, ai = this.ai();
    if (ai && ai.enemy) {
      var e = ai.enemy;
      e.setDetail('normal');
      e.poseExtra = null;
      e.group.visible = true;
      if (e.grabHands) e.grabHands.scale.set(1, 1, 1);
      if (e.grabHands) { e.grabHands.visible = false; if (e.grabHands.parent) e.grabHands.parent.remove(e.grabHands); }
      if (e.maw) { e.maw.group.visible = false; if (e.maw.group.parent) e.maw.group.parent.remove(e.maw.group); }
      ai.cine = false;
    }
    this.actor = null;
    this.camSpace.visible = false;
    this.props.visible = false;
    this._clearProps();
    this._hard();
  };

  /** game.reset() / stealth.reset() から呼ばれる。end と同義（明示名） */
  CaptureCinematic.prototype.reset = function () { this.end(); };

  /* ---------------- 入力（連打で揺れが増す。結果は変わらない） ---------------- */
  CaptureCinematic.prototype.onInteract = function () {
    if (this.stage === 'none') return false;
    this.mash = Math.min(this.mash + 1, this.T().cineMashMax);
    return true;
  };

  /* ---------------- 毎フレーム ---------------- */

  CaptureCinematic.prototype.step = function (dt) {
    if (this.stage === 'none') return;
    var g = this.game, ai = this.ai(), e = ai.enemy;
    this.stageT += dt;
    this.total += dt;
    var dur = this.durOf(this.stage);

    if (this.stage === 'zoom') this._stepZoom(dt);
    else if (this.stage === 'grab') this._stepGrab(dt);
    else if (this.stage === 'drag') this._stepDrag(dt);
    else if (this.stage === 'maw') this._stepMaw(dt);
    else if (this.stage === 'black') this._stepBlack(dt);

    /* 敵モデルの更新は演出側が持つ（AIは cine で止めてある） */
    e.update(dt, g.simTime);
    e.syncLight(g.world, g.map);
    e.pulseEyes(g.simTime, this.stage === 'black' ? 0.25 : 1);

    /* camera 空間の演出物を追従させる */
    this.camSpace.position.copy(this.camPos);
    this.camSpace.quaternion.copy(this.camQuat);

    if (this.stageT >= dur) this._advance();
  };

  CaptureCinematic.prototype._advance = function () {
    this.seqI++;
    if (this.seqI >= this.seq.length) {
      this.stage = 'none';
      this.done = true;                 /* 呼び出し側（Stealth）が受け取って牢/GAME OVER へ */
      return;
    }
    this.stage = this.seq[this.seqI];
    this.stages.push(this.stage);
    this.stageT = 0;
    this._soundAt = 0;
    var e = this.ai().enemy;
    if (this.stage === 'grab') {
      e.grabHands.visible = true;
      sfx('cineGrab', { x: e.x, z: e.z });
    } else if (this.stage === 'drag') {
      e.grabHands.visible = false;
      this._beginDrag();
    } else if (this.stage === 'maw') {
      e.grabHands.visible = true;
      e.maw.group.visible = true;
    } else if (this.stage === 'black') {
      e.grabHands.visible = false;
      e.group.visible = true;
      if (e.maw) e.maw.group.visible = false;
      if (this.mode === 'eaten') sfx('bite', {});
    }
  };

  /* ---------------- 段階1: 追いつき（顔へ強制ズーム） ---------------- */
  CaptureCinematic.prototype._stepZoom = function () {
    var u = smooth01(this.stageT / Math.max(this.durOf('zoom'), 1e-4));
    var e = this.ai().enemy;
    this._faceOf(e);
    this._nearOf(this.T().cineZoomEnd);
    this.camPos.lerpVectors(this.eyePos, this.nearPos, u);
    this._lookAtFace(this.camPos);
    this.camQuat.copy(this.q0).slerp(this.q1, u);
    this.fov = 75 + (this.T().cineZoomFov - 75) * u;
    /* 覆いかぶさる: 顔をこちらへ倒し込む（-x が「顔が下を向く」向き） */
    this.headTilt.x = -0.34 * u;
  };

  /* ---------------- 段階2: 首掴み ---------------- */
  CaptureCinematic.prototype._stepGrab = function (dt) {
    var g = this.game, e = this.ai().enemy, T = this.T();
    var t = g.simTime;
    var u = this.stageT / Math.max(this.durOf('grab'), 1e-4);
    this._faceOf(e);
    /* 顔が息づく距離で前後する */
    var d = T.cineZoomEnd + 0.055 * Math.sin(t * 3.1) - 0.06 * u;
    this._nearOf(d);
    this.camPos.copy(this.nearPos);
    this._lookAtFace(this.camPos);
    this.camQuat.copy(this.q1);
    this.fov = T.cineZoomFov;
    /* 暴れ: 連打で強まる（結果は変わらない）。乱数は使わず時刻の合成波で決める */
    var k = T.cineShake * (1 + this.mash / T.cineMashMax * T.cineMashGain);
    this._shake(k, t);
    /* 呻き（等間隔で数回） */
    if (this.stageT >= this._soundAt) {
      this._soundAt += 0.85;
      sfx('cineStruggle', { x: e.x, z: e.z });
    }
    this.headTilt.x = -0.34 + 0.05 * Math.sin(t * 5.2);
    this.headTilt.z = 0.10 + 0.09 * Math.sin(t * 3.7 + 1.1);
    /* 手が締まる（掴み込む） */
    var sq = 0.94 + 0.06 * Math.sin(t * 6.3);
    e.grabHands.scale.set(sq, sq, sq);
    if (dt) { /* dt は将来の物理用。いまは時刻駆動で決定的にしている */ }
  };

  /* ---------------- 段階3: 引きずり ---------------- */
  CaptureCinematic.prototype._beginDrag = function () {
    var g = this.game, e = this.ai().enemy;
    var p = g.player;
    this.dragOrigin.set(p.x, g.map.floorYAt(p.x, p.z), p.z);
    this.dragT = 0;
    this._soundAt = 0.9;
    this.headTilt.x = 0; this.headTilt.z = 0;
    this.fov = 82;                     /* カットが変わる＝広角に切り替える */
    e.state = 'walk';
    sfx('cineDrag', { x: e.x, z: e.z });
  };

  CaptureCinematic.prototype._stepDrag = function (dt) {
    var g = this.game, e = this.ai().enemy, T = this.T(), map = g.map;
    var t = g.simTime;
    this.dragT += dt;
    var travel = Math.min(this.dragT * T.cineDragSpeed, this.dragMax);
    var vx = this.dragOrigin.x + this.dragDir.x * travel;
    var vz = this.dragOrigin.z + this.dragDir.z * travel;
    var fy = map.floorYAt(vx, vz);
    /* 床すれすれの仰向け視点 */
    this.camPos.set(vx, fy + T.cineDragEye + 0.018 * Math.sin(t * 7.3), vz);
    /* 見上げる: ほぼ真上。ごく僅かに進行方向側へ倒すと、頭側を歩く敵のシルエットが
       画面上端に入り、自分の足は下端に残る（契約 §4「視界の端に敵のシルエットと自分の足」）。
       進行方向の逆へ倒すと敵が画角から外れる（実測で確認済み）。 */
    _v.set(this.dragDir.x * 0.22, 0.975, this.dragDir.z * 0.22).normalize();
    _v2.copy(this.camPos).add(_v);
    _m.lookAt(this.camPos, _v2, this.dragDir);
    this.camQuat.setFromRotationMatrix(_m);
    this._shake(T.cineShake * 0.42, t * 0.8);
    this.fov = 82;

    /* 敵は頭の側（＝画面の上）を歩いて引きずっていく。
       距離は「見上げた画角の端にシルエットが入る」実測値（近すぎると画面外へ抜ける） */
    e.placeAt(vx + this.dragDir.x * T.cineDragLead, vz + this.dragDir.z * T.cineDragLead,
      yawOf(this.dragDir.x, this.dragDir.z), map);
    e.state = 'walk';

    /* 天井灯が流れる（引きずられている距離はカメラより先に進める＝必ず流れる） */
    this._streamLamps(this.dragT * T.cineDragSpeed);
    /* 自分の足（camera空間で揺れる） */
    if (this.feet) {
      this.feet.visible = true;
      this.feet.rotation.x = 0.10 * Math.sin(t * 2.9);
      this.feet.rotation.z = 0.07 * Math.sin(t * 2.1 + 0.8);
    }
    if (this.stageT >= this._soundAt) {
      this._soundAt += 1.15;
      sfx('cineDrag', { x: e.x, z: e.z });
    }
  };

  /* ---------------- 段階3'（3回目）: 食われる ---------------- */
  CaptureCinematic.prototype._stepMaw = function () {
    var g = this.game, e = this.ai().enemy, T = this.T();
    var t = g.simTime;
    var u = clamp(this.stageT / Math.max(this.durOf('maw'), 1e-4), 0, 1);
    var s = smooth01(u);
    this._faceOf(e);
    /* 顔がさらに近づく（近づきすぎると顔の面の内側に入ってしまうので 0.30m で止める） */
    this._nearOf(T.cineZoomEnd - (T.cineZoomEnd - T.cineMawDist) * s);
    this.camPos.copy(this.nearPos);
    this._lookAtFace(this.camPos);
    this.camQuat.copy(this.q1);
    this.fov = T.cineZoomFov;
    this._shake(T.cineShake * (0.6 + s * 0.9), t);
    /* 口が開く → 歯列が画面を覆う。
       後半は口が画面を覆い切るので、頭の実体を隠して口だけにする
       （顔のポリゴンの内側にカメラが入って面が裏返るのを防ぐ）。 */
    var maw = e.maw;
    maw.setOpen(smooth01(u / 0.55));
    var sc = 0.30 + 3.00 * Math.pow(s, 1.55);
    maw.group.scale.set(sc, sc, sc);
    maw.group.position.set(0, -0.02 + 0.05 * s, -0.40 + 0.33 * s);
    e.group.visible = (s < 0.58);
    /* 覆い切る直前から暗転を始める（歯の隙間から通路が見えたままにしない） */
    this.fade = clamp((u - 0.76) / 0.24, 0, 1) * 0.90;
    this.headTilt.x = -0.30 + 0.10 * Math.sin(t * 4.4);
  };

  /* ---------------- 段階4: 暗転 ---------------- */
  CaptureCinematic.prototype._stepBlack = function () {
    var T = this.T();
    /* 直前の段階（食われる）で始めた暗転から続ける＝明るく戻らない */
    this.fade = Math.max(this.fade, clamp(this.stageT / T.cineFadeIn, 0, 1));
    if (this.mode !== 'eaten') {
      /* 牢扉の金属音 → 鍵の音 */
      if (this._soundAt < 1 && this.stageT >= 0.22) { this._soundAt = 1; sfx('cellDoor', {}); }
      if (this._soundAt < 2 && this.stageT >= 0.86) { this._soundAt = 2; sfx('cellLock', {}); }
    }
  };

  /* ---------------- カメラ（Game.syncCamera の最後から呼ばれる） ---------------- */
  CaptureCinematic.prototype.applyCamera = function (camera) {
    camera.position.copy(this.camPos);
    camera.quaternion.copy(this.camQuat);
  };

  /* ---------------- 補助 ---------------- */

  /** 敵の顔の中心（頭ノード＋顔面側へのオフセット） */
  CaptureCinematic.prototype._faceOf = function (e) {
    e.nodes.head.getWorldPosition(this.facePos);
    var f = { x: -Math.sin(e.facing), z: -Math.cos(e.facing) };
    this.facePos.x += f.x * 0.055;
    this.facePos.z += f.z * 0.055;
    this.facePos.y += 0.015;
    return this.facePos;
  };

  /**
   * 顔の「正面」へ dist だけ離れた点。
   * プレイヤーの目(1.62m)から顔(2.2m)へ真っ直ぐ引くと顎の裏を見上げる構図になるので使わない。
   * 首を掴んで持ち上げられている＝顔と同じ高さまで引き寄せられる、が正しい絵（契約 §4）。
   */
  CaptureCinematic.prototype._nearOf = function (dist) {
    var a = this.approach;                       /* プレイヤー→敵 の水平方向 */
    _v.set(-a.x, 0, -a.z).normalize();           /* 敵→プレイヤー＝顔の正面 */
    this.nearPos.copy(this.facePos).addScaledVector(_v, dist);
    /* ほんの少しだけ下から見上げる（覆いかぶさられている） */
    this.nearPos.y -= dist * 0.34;
    return this.nearPos;
  };

  CaptureCinematic.prototype._lookAtFace = function (from) {
    _m.lookAt(from, this.facePos, UP);
    this.q1.setFromRotationMatrix(_m);
    return this.q1;
  };

  /** 決定的な揺れ（乱数を使わない＝ __pump 駆動のスクショが再現する） */
  CaptureCinematic.prototype._shake = function (k, t) {
    if (k <= 0) return;
    var sp = (Math.sin(t * 27.3) + 0.7 * Math.sin(t * 41.7 + 1.3)) * k;
    var sy = (Math.sin(t * 33.1 + 0.6) + 0.6 * Math.sin(t * 52.3)) * k;
    var sr = (Math.sin(t * 19.7 + 2.1) + 0.8 * Math.sin(t * 37.9 + 0.4)) * k * 1.6;
    _e.set(sp, sy, sr, 'YXZ');
    this.camQuat.multiply(this.qs.setFromEuler(_e));
    this.camPos.x += Math.sin(t * 44.3) * k * 0.10;
    this.camPos.y += Math.sin(t * 51.1 + 1.7) * k * 0.10;
    /* q0 は開始姿勢の保管庫なので壊さない（clone を経由している） */
  };

  /** 引きずる方向: 4方位のうち最も長く抜けられる向き */
  CaptureCinematic.prototype._pickDragDir = function () {
    var g = this.game, map = g.map, p = g.player;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var col = p.col(), row = p.row();
    var best = null, bestN = -1;
    for (var i = 0; i < 4; i++) {
      var n = 0;
      for (var k = 1; k <= 10; k++) {
        if (!map.isWalkable(col + D[i][0] * k, row + D[i][1] * k)) break;
        n++;
      }
      if (n > bestN) { bestN = n; best = D[i]; }
    }
    if (!best) { best = [0, -1]; bestN = 0; }
    this.dragDir.set(best[0], 0, best[1]).normalize();
    this.dragMax = Math.max(0.6, (bestN - 0.4) * map.tileSize);
    this.dragCeil = map.cellFloorY(col, row) + map.ceilHAt(col, row) - 0.10;
  };

  /* ---------------- 演出物 ---------------- */

  CaptureCinematic.prototype._geo = function (g) { this._geos.push(g); return g; };
  CaptureCinematic.prototype._mat = function (m) { this._mats.push(m); return m; };

  /** 流れる天井灯（暗い通路でも「移動している」ことが必ず伝わる） */
  CaptureCinematic.prototype._buildLamps = function () {
    if (this.lamps) return this.lamps;
    var grp = new THREE.Group();
    grp.name = 'cine-lamps';
    var geo = this._geo(new THREE.PlaneGeometry(0.34, 1.30));
    var mat = this._mat(new THREE.MeshBasicMaterial({
      color: 0xbcd2dc, fog: true, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
      depthWrite: false
    }));
    var halo = this._mat(new THREE.MeshBasicMaterial({
      color: 0x5d7480, fog: true, transparent: true, opacity: 0.30, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    var hgeo = this._geo(new THREE.PlaneGeometry(1.05, 2.30));
    for (var i = 0; i < 8; i++) {
      var n = new THREE.Group();
      var m = new THREE.Mesh(geo, mat);
      m.rotation.x = Math.PI / 2;
      n.add(m);
      var h = new THREE.Mesh(hgeo, halo);
      h.rotation.x = Math.PI / 2;
      h.position.y = -0.02;
      n.add(h);
      grp.add(n);
    }
    this.props.add(grp);
    this.lamps = grp;
    return grp;
  };

  CaptureCinematic.prototype._streamLamps = function (travel) {
    if (!this.lamps) return;
    var SP = 3.4, N = this.lamps.children.length;
    var span = SP * N;
    var d = this.dragDir;
    var yaw = Math.atan2(d.x, d.z);
    for (var i = 0; i < N; i++) {
      var off = ((i * SP - travel) % span + span) % span - span * 0.35;
      var n = this.lamps.children[i];
      n.position.set(this.dragOrigin.x + d.x * off, this.dragCeil, this.dragOrigin.z + d.z * off);
      n.rotation.y = yaw;
    }
    this.lamps.visible = true;
  };

  /** 仰向けの自分の足（camera 空間の下端。ズボンと作業靴） */
  CaptureCinematic.prototype._buildFeet = function () {
    if (this.feet) return this.feet;
    var grp = new THREE.Group();
    grp.name = 'cine-feet';
    grp.visible = false;
    var leg = this._geo(new THREE.CylinderGeometry(0.074, 0.060, 0.62, 7, 1));
    var boot = this._geo(new THREE.BoxGeometry(0.160, 0.135, 0.310));
    var legMat = this._mat(new THREE.MeshBasicMaterial({ color: 0x3d454e, fog: true }));
    var bootMat = this._mat(new THREE.MeshBasicMaterial({ color: 0x20262c, fog: true }));
    for (var s = -1; s <= 1; s += 2) {
      var n = new THREE.Group();
      n.position.set(s * 0.140, -0.30, -0.62);
      n.rotation.set(-1.16, 0, s * 0.10);
      var l = new THREE.Mesh(leg, legMat);
      l.position.y = -0.31;
      n.add(l);
      var b = new THREE.Mesh(boot, bootMat);
      b.position.set(0, -0.66, -0.09);
      b.rotation.x = 0.30;
      n.add(b);
      grp.add(n);
    }
    this.camSpace.add(grp);
    this.feet = grp;
    return grp;
  };

  CaptureCinematic.prototype._clearProps = function () {
    if (this.lamps) { this.props.remove(this.lamps); this.lamps = null; }
    if (this.feet) { this.camSpace.remove(this.feet); this.feet = null; }
    while (this.props.children.length) this.props.remove(this.props.children[0]);
    while (this.camSpace.children.length) this.camSpace.remove(this.camSpace.children[0]);
    for (var i = 0; i < this._geos.length; i++) this._geos[i].dispose();
    for (var j = 0; j < this._mats.length; j++) this._mats[j].dispose();
    this._geos.length = 0;
    this._mats.length = 0;
  };

  CaptureCinematic.prototype.info = function () {
    return {
      mode: this.mode, stage: this.stage, stageT: this.stageT, total: this.total,
      mash: this.mash, fade: this.fade, fov: this.fov, done: this.done,
      stages: this.stages.slice(),
      redEyes: !!(this.ai() && this.ai().enemy && this.ai().enemy.redEyesVisible()),
      actor: this.actor ? this.actor.index : null
    };
  };

  ESCAPE.CaptureCinematic = CaptureCinematic;
})(window);
