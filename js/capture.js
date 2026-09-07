/* ESCAPE — P4.6: 捕獲シネマティック（契約 DESIGN.md §4「捕獲演出と駆け引き」）
 *
 * 一人称のまま途切れなく繋ぐ。段階と長さは ENEMY_TUNING に集約（契約の指定）:
 *   1 zoom  0.4s  敵の顔へ強制ズーム＋大音量の刺し音
 *   2 grab  2.0s  視界に敵の手／激しい揺れ／呻き。連打で揺れが増す（結果は変わらない）
 *   3 drag  3.5s  担ぎ運び（P4.12 項目3）。敵の肩に担がれ、頭の後ろ・高さ約1.8m から
 *                 後方（来た通路）を見る。視界下部に敵の肩と髪、通路と天井灯が遠ざかる。
 *                 段階IDは 'drag' のまま（既存の結線・記録を壊さないため。中身だけ差し替え）
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
 *   - P4.12: 敵の体格倍率（enemy.scale）は敵モデル側が毎フレーム決める。演出は
 *     「顔の位置・カメラ距離」をその倍率で割り増して読む＝拡大後も構図が崩れない。
 *
 * ヘッドライトの扱い（契約 P4.12 項目3「点灯扱いで視界を確保」）:
 *   js/headlight.js は演出中を消灯と判定する（唯一の点灯判定箇所・こちらからは触らない）。
 *   代わりに担ぎ運びの間だけ、同じ流儀（加算合成の床のくさび＋空気のもや）の
 *   演出専用ライトをこのモジュールが出す。暗くて通路が読めない絵を作らない。
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
    this.shoulder = null;        /* P4.12: 担ぎ運びの「敵の肩と髪」 */
    this.light = null;           /* P4.12: 演出用ヘッドライト（床のくさび） */
    this.haze = null;            /* 同・空気のもや（camera空間） */
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
    this.carryLight = 0;       /* P4.12: 演出用ヘッドライトの強さ（0=消灯扱い） */
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
    /* P4.12 項目6: 体格倍率が乗ったぶんだけ据える距離も伸ばす（顔が画面を割らない）。
       倍率はマスの天井にも依るので、一度置いて実値を読んでから置き直す。 */
    e.placeAt(p.x + dx * this.T().cineFaceDist * e.scale, p.z + dz * this.T().cineFaceDist * e.scale,
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
    this._nearOf(this._d(this.T().cineZoomEnd));

    /* 運ばれていく方向: いま居るマスから最も長く抜けられる軸方向 */
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
      /* 担ぎ運びの演出物は暗転で必ず畳む（残留を機械テストが見る） */
      if (this.shoulder) this.shoulder.visible = false;
      this.carryLight = 0;
      if (this.light) this.light.visible = false;
      if (this.haze) this.haze.visible = false;
      if (this.mode === 'eaten') sfx('bite', {});
    }
  };

  /* ---------------- 段階1: 追いつき（顔へ強制ズーム） ---------------- */
  CaptureCinematic.prototype._stepZoom = function () {
    var u = smooth01(this.stageT / Math.max(this.durOf('zoom'), 1e-4));
    var e = this.ai().enemy;
    this._faceOf(e);
    this._nearOf(this._d(this.T().cineZoomEnd));
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
    var d = this._d(T.cineZoomEnd) + this._d(0.055) * Math.sin(t * 3.1) - this._d(0.06) * u;
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

  /* ---------------- 段階3: 担ぎ運び（P4.12 項目3） ----------------
   * 敵の肩に担がれ、頭の後ろ・高さ約1.8m から後方（来た通路）を見る。
   * 実移動はしない＝演出用のカメラ経路（dragOrigin から dragDir へ伸ばすだけ）。
   * 敵の実体は進行方向の前方に置く（＝背後になる）ので、視界下部の「肩と髪」は
   * camera 空間の演出物で作る。自分の足は担がれた側（敵の前）にあるので出さない。 */
  CaptureCinematic.prototype._beginDrag = function () {
    var g = this.game, e = this.ai().enemy;
    var p = g.player;
    this.dragOrigin.set(p.x, g.map.floorYAt(p.x, p.z), p.z);
    this.dragT = 0;
    this._soundAt = 0.55;
    this.headTilt.x = 0; this.headTilt.z = 0;
    this.fov = 78;                     /* カットが変わる＝通路が両端まで入る画角 */
    e.state = 'walk';
    e.grabHands.visible = false;
    this._buildShoulder().visible = true;
    this.carryLight = 1;               /* 契約: ヘッドライト点灯扱い */
    this._buildLight();
    sfx('cineCarry', { x: e.x, z: e.z });
    /* カットの切り替わる最初の1フレームを首掴みのカメラで描かない
       （_advance は step() の最後＝camSpace 同期の後に走るので、ここで先に合わせる）。 */
    this._stepDrag(0);
    this.camSpace.position.copy(this.camPos);
    this.camSpace.quaternion.copy(this.camQuat);
  };

  CaptureCinematic.prototype._stepDrag = function (dt) {
    var g = this.game, e = this.ai().enemy, T = this.T(), map = g.map;
    var t = g.simTime;
    this.dragT += dt;
    var travel = Math.min(this.dragT * T.cineCarrySpeed, this.dragMax);
    var d = this.dragDir;
    /* 担がれている肩の側へ僅かにずらす（真後ろ一直線にしない） */
    var rx = d.z, rz = -d.x;
    var vx = this.dragOrigin.x + d.x * travel + rx * T.cineCarrySide;
    var vz = this.dragOrigin.z + d.z * travel + rz * T.cineCarrySide;
    var fy = map.floorYAt(vx, vz);
    /* 歩の上下動（担がれて揺すられる）。乱数は使わない＝スクショが決定的になる */
    var bob = 0.035 * Math.sin(t * 4.6) + 0.012 * Math.sin(t * 9.1 + 0.7);
    this.camPos.set(vx, fy + T.cineCarryEye + bob, vz);
    /* 後方（来た通路）を見る。少し見下ろすと床と天井灯が同じ画に入る */
    var yaw = yawOf(-d.x, -d.z);
    _e.set(-T.cineCarryPitch + 0.030 * Math.sin(t * 4.6 + 1.2), yaw,
      0.045 * Math.sin(t * 2.3) + 0.020 * Math.sin(t * 5.1 + 0.4), 'YXZ');
    this.camQuat.setFromEuler(_e);
    this._shake(T.cineShake * 0.30, t * 0.8);
    this.fov = 78;

    /* 敵の実体は進行方向の前方（＝カメラの背後）を歩く。音・影・照明の整合のため実座標も動かす */
    e.placeAt(this.dragOrigin.x + d.x * (travel + T.cineCarryLead),
      this.dragOrigin.z + d.z * (travel + T.cineCarryLead),
      yawOf(d.x, d.z), map);
    e.state = 'walk';

    /* 天井灯が遠ざかる（カメラの後方＝視界の奥へ流れていく） */
    this._streamLamps(travel);
    /* 担がれた視界: 敵の肩と髪が下部で揺れる */
    this._stepShoulder(t);
    /* 演出用ヘッドライト（契約: 点灯扱いで視界を確保） */
    this._placeLight(vx, fy, vz, yaw);

    if (this.stageT >= this._soundAt) {
      this._soundAt += 0.78;           /* 敵の歩の間隔 */
      sfx('cineCarry', { x: e.x, z: e.z });
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
    this._nearOf(this._d(T.cineZoomEnd - (T.cineZoomEnd - T.cineMawDist) * s));
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

  /** P4.12 項目6: 敵の体格倍率。顔の大きさに比例して寄り引きの距離を割り増す */
  CaptureCinematic.prototype.bodyScale = function () {
    var ai = this.ai();
    var e = ai && ai.enemy;
    return (e && typeof e.scale === 'number' && e.scale > 0) ? e.scale : 1;
  };

  /** 体格倍率を掛けた距離(m) */
  CaptureCinematic.prototype._d = function (v) { return v * this.bodyScale(); };

  /** 敵の顔の中心（頭ノード＋顔面側へのオフセット）。オフセットも体格倍率に乗る */
  CaptureCinematic.prototype._faceOf = function (e) {
    e.nodes.head.getWorldPosition(this.facePos);
    var k = (typeof e.scale === 'number' && e.scale > 0) ? e.scale : 1;
    var f = { x: -Math.sin(e.facing), z: -Math.cos(e.facing) };
    this.facePos.x += f.x * 0.055 * k;
    this.facePos.z += f.z * 0.055 * k;
    this.facePos.y += 0.015 * k;
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

  /**
   * P4.12: 担ぎ運びのカメラは後方を見るので、灯りは「カメラより手前（＝進行方向の逆）」
   * にだけ並べる。世界に固定したまま travel が伸びるぶん遠ざかり、一番遠いものが
   * 一巡してカメラの直下へ戻る＝必ず流れて見える。
   */
  CaptureCinematic.prototype._streamLamps = function (travel) {
    if (!this.lamps) return;
    var SP = 3.4, N = this.lamps.children.length;
    var span = SP * N;
    var d = this.dragDir;
    var yaw = Math.atan2(d.x, d.z);
    for (var i = 0; i < N; i++) {
      /* i*SP と合同で travel 以下の最大値＝カメラの後ろに等間隔で並ぶ */
      var off = travel - (((travel - i * SP) % span) + span) % span;
      var n = this.lamps.children[i];
      n.position.set(this.dragOrigin.x + d.x * off, this.dragCeil, this.dragOrigin.z + d.z * off);
      n.rotation.y = yaw;
    }
    this.lamps.visible = true;
  };

  /* ---------------- P4.12 担ぎ運びの演出物 ---------------- */

  /**
   * 敵の肩と髪（camera 空間の下部）。
   * 敵の実体はカメラの背後を歩いているので、担がれている実感はここで作る。
   * 色は敵のマテリアル（syncLight が毎フレーム環境光に合わせている）から拾う＝
   * 区画ごとの明るさ・色味とずれない。
   */
  /** 頂点色を焼く（形が読めるよう下面ほど暗く）。敵と同じマテリアルに載せるため必須 */
  function paintGeo(geo, lo, hi) {
    var pos = geo.attributes.position, n = pos.count;
    var col = new Float32Array(n * 3);
    var box = geo.boundingBox;
    if (!box) { geo.computeBoundingBox(); box = geo.boundingBox; }
    var y0 = box.min.y, y1 = box.max.y, dy = (y1 - y0) || 1;
    for (var i = 0; i < n; i++) {
      var u = (pos.getY(i) - y0) / dy;
      var v = lo + (hi - lo) * u * u;
      col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }

  CaptureCinematic.prototype._buildShoulder = function () {
    if (this.shoulder) return this.shoulder;
    var e = this.ai().enemy;
    var grp = new THREE.Group();
    grp.name = 'cine-shoulder';
    grp.visible = false;
    /* 敵そのもののマテリアルを使う（syncLight が毎フレーム環境光に合わせている）＝
       区画の明るさ・色味・肌のテクスチャが本体と完全に一致する。
       ※ 敵の持ち物なので this._mats には積まない（end() で捨てるのは自前のぶんだけ） */
    var skinMat = e.mats.skin, hairMat = e.mats.hair, clothMat = e.mats.cloth;

    /* 担いでいる側の肩と、その内側の背中の隆起（カメラの手前下に来る） */
    var sh = new THREE.Group();
    sh.position.set(0.44, -1.12, -1.34);
    var ball = this._geo(paintGeo(new THREE.SphereGeometry(0.44, 14, 10), 0.07, 0.26));
    var m1 = new THREE.Mesh(ball, skinMat);
    m1.scale.set(1.25, 0.85, 1.10);
    sh.add(m1);
    var m2 = new THREE.Mesh(ball, skinMat);       /* 首から肩へ落ちる僧帽筋 */
    m2.scale.set(0.95, 0.70, 1.40);
    m2.position.set(-0.34, 0.06, 0.16);
    sh.add(m2);
    /* 肩にかかる襤褸 */
    var cgeo = this._geo(paintGeo(new THREE.CylinderGeometry(0.47, 0.64, 0.74, 16, 1, true), 0.04, 0.18));
    var m3 = new THREE.Mesh(cgeo, clothMat);
    m3.position.set(-0.06, -0.30, 0.05);
    m3.rotation.z = 0.18;
    sh.add(m3);
    grp.add(sh);
    this._shBody = sh;

    /* 長い黒髪。背中側＝カメラの手前へ、視界の下部を横切って垂れる */
    var hair = new THREE.Group();
    hair.position.set(-0.30, -0.24, -0.86);
    var hgeo = this._geo(paintGeo(new THREE.PlaneGeometry(0.070, 1.45, 1, 6), 0.015, 0.085));
    for (var i = 0; i < 26; i++) {
      var piv = new THREE.Group();
      var a = (i / 25 - 0.5);
      /* 房ごとに根元の高さと長さを散らす（同じ丈が並ぶと鋸歯の縁になる）。
         乱数は使わない＝ __pump 駆動のスクショが決定的になる。 */
      var j = (i * 0.6180339887) % 1;
      var lift = -0.10 + 0.20 * Math.sin(i * 2.3999) * (0.6 + 0.4 * j);
      piv.position.set(a * 0.62, lift - Math.abs(a) * 0.10, 0.04 + Math.abs(a) * 0.26);
      piv.rotation.set(0.26 + Math.abs(a) * 0.34, a * 0.55, -a * 0.46);
      var st = new THREE.Mesh(hgeo, hairMat);
      st.position.y = -0.80;
      st.rotation.y = a * 0.7;
      st.scale.set(0.80 + 0.55 * j, 0.78 + 0.44 * ((i * 0.3819) % 1), 1);
      piv.add(st);
      piv.userData.base = { x: piv.rotation.x, z: piv.rotation.z, k: 0.7 + (i % 5) * 0.23, ph: i * 0.77 };
      hair.add(piv);
    }
    grp.add(hair);
    this._shHair = hair;

    this.camSpace.add(grp);
    this.shoulder = grp;
    return grp;
  };

  /** 歩に合わせて肩が上下し、髪が遅れて揺れる（決定的な時刻駆動） */
  CaptureCinematic.prototype._stepShoulder = function (t) {
    var grp = this.shoulder;
    if (!grp) return;
    grp.visible = true;
    /* 色は敵本体のマテリアルをそのまま共有しているので、ここでは触らない
       （syncLight が毎フレーム環境光に合わせる＝暗い区画で肩だけ白く浮かない） */
    var step = Math.sin(t * 4.6);
    if (this._shBody) {
      this._shBody.position.y = -1.12 + 0.050 * step;
      this._shBody.rotation.z = 0.10 * Math.sin(t * 2.3);
    }
    if (this._shHair) {
      this._shHair.position.y = -0.24 + 0.040 * Math.sin(t * 4.6 - 0.5);
      for (var i = 0; i < this._shHair.children.length; i++) {
        var p = this._shHair.children[i], b = p.userData.base;
        p.rotation.x = b.x + 0.10 * Math.sin(t * (2.1 + b.k) + b.ph);
        p.rotation.z = b.z + 0.08 * Math.sin(t * (1.6 + b.k * 0.7) + b.ph * 1.4);
      }
    }
  };

  /* ---------------- 演出用ヘッドライト（契約 P4.12 項目3「点灯扱い」） ----------------
   * js/headlight.js と同じ流儀（加算合成・頂点色で減衰・深度書き込みなし）で、
   * カメラの見ている方向へ床のくさびを敷き、空気のもやを重ねる。
   * headlight.js 側は一切触らない（点灯判定の唯一性を壊さない）。 */
  var LIGHT_TINT = [1.00, 0.93, 0.78];
  var LIGHT_NEAR = 0.30, LIGHT_LEN = 7.20, LIGHT_HALF_NEAR = 0.30, LIGHT_HALF_FAR = 1.65;
  var LIGHT_SEGS = 14;
  var LIGHT_CROSS = [-1, -0.55, 0, 0.55, 1];

  function lightLengthProfile(t) {
    if (t <= 0.16) return 0.55 + 0.45 * (t / 0.16);
    var u = (t - 0.16) / 0.84;
    return Math.pow(1 - u, 1.35);
  }
  function lightCrossProfile(u) {
    var a = 1 - u * u;
    return a <= 0 ? 0 : Math.pow(a, 1.25);
  }

  CaptureCinematic.prototype._buildLight = function () {
    if (this.light) { this.light.visible = true; return this.light; }
    var NL = LIGHT_SEGS, NW = LIGHT_CROSS.length;
    var vN = (NL + 1) * NW;
    var pos = new Float32Array(vN * 3), col = new Float32Array(vN * 3), idx = [];
    for (var i = 0; i < NL; i++) {
      for (var j = 0; j < NW - 1; j++) {
        var a = i * NW + j, b = a + 1, c = a + NW, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    for (var li = 0; li <= NL; li++) {
      var tt = li / NL;
      var lp = lightLengthProfile(tt);
      var half = LIGHT_HALF_NEAR + (LIGHT_HALF_FAR - LIGHT_HALF_NEAR) * tt;
      for (var wj = 0; wj < NW; wj++) {
        var o = (li * NW + wj) * 3;
        pos[o] = LIGHT_CROSS[wj] * half;
        pos[o + 1] = 0;
        pos[o + 2] = -(LIGHT_NEAR + LIGHT_LEN * tt);      /* ローカル -Z ＝ 前方 */
        var br = lp * lightCrossProfile(LIGHT_CROSS[wj]);
        col[o] = LIGHT_TINT[0] * br; col[o + 1] = LIGHT_TINT[1] * br; col[o + 2] = LIGHT_TINT[2] * br;
      }
    }
    var geo = this._geo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    var mat = this._mat(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    }));
    var grp = new THREE.Group();
    grp.name = 'cine-light';
    var beam = new THREE.Mesh(geo, mat);
    beam.frustumCulled = false;
    grp.add(beam);
    this.props.add(grp);
    this.light = grp;
    this._lightMat = mat;

    /* 空気のもや（camera 空間の扁平なくさび） */
    var N = 20;
    var p3 = [0, 0, -0.35], c3 = [LIGHT_TINT[0] * 0.5, LIGHT_TINT[1] * 0.5, LIGHT_TINT[2] * 0.5], i3 = [];
    for (var n = 0; n <= N; n++) {
      var an = n / N * Math.PI * 2;
      p3.push(Math.cos(an) * 1.05, Math.sin(an) * 0.52, -4.2);
      c3.push(0, 0, 0);
    }
    for (var q = 1; q <= N; q++) i3.push(0, q, q + 1);
    var geo3 = this._geo(new THREE.BufferGeometry());
    geo3.setAttribute('position', new THREE.Float32BufferAttribute(p3, 3));
    geo3.setAttribute('color', new THREE.Float32BufferAttribute(c3, 3));
    geo3.setIndex(i3);
    var mat3 = this._mat(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.085,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    }));
    var haze = new THREE.Mesh(geo3, mat3);
    haze.frustumCulled = false;
    haze.name = 'cine-haze';
    this.camSpace.add(haze);
    this.haze = haze;
    this._hazeMat = mat3;
    return grp;
  };

  /** 床のくさびをカメラの足元へ置き、見ている方向（yaw）へ向ける */
  CaptureCinematic.prototype._placeLight = function (x, floorY, z, yaw) {
    if (!this.light) return;
    var k = this.carryLight * this.T().cineCarryLight;
    this.light.visible = k > 0.001;
    this.light.position.set(x, floorY + 0.045, z);
    this.light.rotation.y = yaw;
    if (this._lightMat) this._lightMat.opacity = 0.34 * k;
    if (this.haze) { this.haze.visible = k > 0.001; this._hazeMat.opacity = 0.085 * k; }
  };

  /** 演出用ヘッドライトが点いているか（契約の「点灯扱い」の読み出し口） */
  CaptureCinematic.prototype.headlightOn = function () {
    return this.stage === 'drag' && this.carryLight > 0;
  };

  CaptureCinematic.prototype._clearProps = function () {
    if (this.lamps) { this.props.remove(this.lamps); this.lamps = null; }
    if (this.shoulder) { this.camSpace.remove(this.shoulder); this.shoulder = null; }
    if (this.light) { this.props.remove(this.light); this.light = null; }
    if (this.haze) { this.camSpace.remove(this.haze); this.haze = null; }
    this._shBody = null; this._shHair = null;
    this._lightMat = null; this._hazeMat = null;
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
      /* P4.12 項目3: 担ぎ運びの読み出し口（機械テスト・E2E） */
      camY: this.camPos.y, carryLight: this.carryLight,
      headlightOn: this.headlightOn(),
      shoulderVisible: !!(this.shoulder && this.shoulder.visible),
      lightVisible: !!(this.light && this.light.visible),
      bodyScale: this.bodyScale(),
      redEyes: !!(this.ai() && this.ai().enemy && this.ai().enemy.redEyesVisible()),
      actor: this.actor ? this.actor.index : null
    };
  };

  ESCAPE.CaptureCinematic = CaptureCinematic;
})(window);
