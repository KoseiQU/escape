/* ESCAPE — P4.8 ヘッドライト（腰のライト）／P4.11 で形状を全面改訂
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」＞ヘッドライト
 *   - 歩行・走行中のみ自動点灯（停止・しゃがみで消灯）。
 *   - 前方約4mの弱い円錐光。点灯中は敵の発見距離が 1.5倍（ENEMY_TUNING.headlightSightMul）。
 *   docs/notes.md memo5「歩けば点く。止まれば消える。—— 点けたまま奴の前に出るな。」
 *
 * 契約 §4「P4.11 実プレイ差し戻し」項目5（2026-09-07）:
 *   **円形スプライト禁止**。懐中電灯の照射＝前方に伸びる縦長の楕円/くさび形。
 *   床に落ちる光は前方へ伸び、縁はソフト、中心が明るい。壁に当たると壁面にも楕円が出る。
 *   旧実装（半径1.3mのほぼ真円の「光溜まり」を足元2.1m前に置く）は真下を向くと
 *   円盤に見えたため失効。
 *
 * 実装方針: 世界の陰影は頂点色に焼き込んであり実ライトは0本（契約 §2）。
 * ライトの代わりに加算合成のメッシュを3枚置く。
 *   1) 床のくさび（beam）: プレイヤーの足元から前方 BEAM_LEN m へ伸びる帯。
 *      幅は前方ほど広がり、中心線が明るく両縁で0になる。頂点は毎フレーム
 *      **ワールド座標で書き直す**ので、傾斜（ramp/plateau）にも吸い付き、
 *      壁に当たる手前で切れる。**カメラのピッチには一切依存しない**＝真下を
 *      向いても円盤にならず、前方へ伸びるくさびのまま。
 *   2) 壁のしみ（wall）: くさびが壁に当たった時だけ、その壁面に横長の楕円を出す。
 *   3) 空中の帯（cone）: カメラ前方の扁平なくさび（縦横比 0.5）。うっすらとした散乱。
 *
 * 「Aが状態設定→Bの毎フレーム更新が上書き」回帰への予防:
 *   点灯判定を持つのはこのモジュールだけ（唯一の真実）。敵AIは sightRange() で
 *   game.headlight.on を**読むだけ**。逆向きの書き込みは無い。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  var HEADLIGHT_TUNING = {
    range: 4.0,          /* 空中の帯の長さ(m)。契約「前方約4m」 */
    coneRx: 0.92,        /* 空中の帯の先端の半幅(m) */
    coneRy: 0.46,        /* 同・半高(m)。rx の半分＝扁平なくさび（円錐禁止） */
    beamNear: 0.25,      /* 床のくさびの手前端までの距離(m) */
    beamLen: 6.20,       /* 床のくさびの長さ(m)。前方へ伸びる＝形が向きを語る */
    beamHalfNear: 0.26,  /* 手前端の半幅(m) */
    beamHalfFar: 1.42,   /* 先端の半幅(m)。前方ほど広がる */
    beamLift: 0.045,     /* 床からの浮かせ量(m)。Zファイト回避 */
    beamSegs: 14,        /* 長さ方向の分割（傾斜追従と壁での切断のため） */
    coneGain: 0.075,     /* 空中の帯の強さ。契約「弱い光」 */
    beamGain: 0.34,      /* 床のくさびの強さ */
    wallGain: 0.30,      /* 壁のしみの強さ */
    wallHeight: 1.12,    /* 壁のしみの中心高さ（床から・m） */
    wallRyRatio: 0.78,   /* 壁のしみの縦横比（<1＝横長の楕円） */
    conePitchFull: 0.50, /* このピッチ(rad)までは空中の帯を全開で出す */
    conePitchZero: 1.05, /* このピッチを超えたら空中の帯を消す（真下/真上で床に刺さって
                            棒状に見えるのを防ぐ。床のくさびは出たままなので暗くならない） */
    rayStep: 0.10,       /* 壁までの距離を測る刻み(m) */
    fade: 6.5,           /* 点灯・消灯の追従レート(1/s) */
    moveThreshold: 0.30  /* この速度(m/s)以上で「歩いている」 */
  };
  var TINT = [1.00, 0.93, 0.78];   /* 弱い電球色 */
  var CROSS = [-1, -0.55, 0, 0.55, 1];   /* くさびの横方向サンプル（中心が明るい） */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /** 長さ方向の明るさ（手前で立ち上がり、先端で0へ） */
  function lengthProfile(t) {
    if (t <= 0.16) return 0.55 + 0.45 * (t / 0.16);
    var u = (t - 0.16) / 0.84;
    return Math.pow(1 - u, 1.45);
  }
  /** 横方向の明るさ（中心1・両縁0のソフトな縁） */
  function crossProfile(u) {
    var a = 1 - u * u;
    return a <= 0 ? 0 : Math.pow(a, 1.25);
  }

  function Headlight(game) {
    this.game = game;
    this.T = HEADLIGHT_TUNING;
    this.group = new THREE.Group();
    this.group.name = 'headlight';
    if (game.scene) game.scene.add(this.group);
    this.hitDist = HEADLIGHT_TUNING.beamLen;   /* 前方の壁までの距離（テストから読む） */
    this.hitNormal = null;
    this._build();
    this.reset();
  }

  Headlight.prototype.reset = function () {
    this.on = false;
    this.level = 0;
    this.hitDist = this.T.beamLen;
    this.hitNormal = null;
    this._place();
    this._apply();
  };

  Headlight.prototype._build = function () {
    var T = this.T;

    /* --- 1) 床のくさび（ワールド座標で毎フレーム書き直す格子） --- */
    var NL = T.beamSegs, NW = CROSS.length;
    var vN = (NL + 1) * NW;
    var pos = new Float32Array(vN * 3);
    var col = new Float32Array(vN * 3);
    var idx = [];
    for (var i = 0; i < NL; i++) {
      for (var j = 0; j < NW - 1; j++) {
        var a = i * NW + j, b = a + 1, c = a + NW, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    this._beamGeo = geo;
    this._beamPos = pos;
    /* 頂点色（明るさの分布）は静的＝1回だけ焼く */
    for (var li = 0; li <= NL; li++) {
      var t = li / NL;
      var lp = lengthProfile(t);
      for (var wj = 0; wj < NW; wj++) {
        var b2 = lp * crossProfile(CROSS[wj]);
        var o = (li * NW + wj) * 3;
        col[o] = TINT[0] * b2; col[o + 1] = TINT[1] * b2; col[o + 2] = TINT[2] * b2;
      }
    }
    this._beamMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    this.beam = new THREE.Mesh(geo, this._beamMat);
    this.beam.frustumCulled = false;
    this.group.add(this.beam);

    /* --- 2) 壁のしみ（横長の楕円。中心が明るく縁で消える） --- */
    var M = 24;
    var p2 = [0, 0, 0], c2 = [TINT[0], TINT[1], TINT[2]], i2 = [];
    for (var k = 0; k <= M; k++) {
      var ang = k / M * Math.PI * 2;
      p2.push(Math.cos(ang), Math.sin(ang) * T.wallRyRatio, 0);
      c2.push(0, 0, 0);
    }
    for (var m = 1; m <= M; m++) i2.push(0, m, m + 1);
    var geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
    geo2.setAttribute('color', new THREE.Float32BufferAttribute(c2, 3));
    geo2.setIndex(i2);
    this._wallGeo = geo2;
    this._wallMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    this.wall = new THREE.Mesh(geo2, this._wallMat);
    this.wall.frustumCulled = false;
    this.group.add(this.wall);

    /* --- 3) 空中の帯（カメラ前方の扁平なくさび。円錐ではない） --- */
    var N = 20;
    var p3 = [0, 0, -0.35], c3 = [TINT[0] * 0.5, TINT[1] * 0.5, TINT[2] * 0.5], i3 = [];
    for (var n = 0; n <= N; n++) {
      var an = n / N * Math.PI * 2;
      p3.push(Math.cos(an) * T.coneRx, Math.sin(an) * T.coneRy, -T.range);
      c3.push(0, 0, 0);
    }
    for (var q = 1; q <= N; q++) i3.push(0, q, q + 1);
    var geo3 = new THREE.BufferGeometry();
    geo3.setAttribute('position', new THREE.Float32BufferAttribute(p3, 3));
    geo3.setAttribute('color', new THREE.Float32BufferAttribute(c3, 3));
    geo3.setIndex(i3);
    this._coneGeo = geo3;
    this._coneMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    this.cone = new THREE.Mesh(geo3, this._coneMat);
    this.cone.frustumCulled = false;
    this.group.add(this.cone);
  };

  /** 点灯条件（唯一の判定箇所） */
  Headlight.prototype._want = function () {
    var g = this.game, p = g.player;
    if (g.progress && g.progress.modalOpen && g.progress.modalOpen()) return false;
    if (g.cinematic && g.cinematic.active()) return false;
    if (g.stealth && (g.stealth.inLocker() || g.stealth.jail.phase !== 'none')) return false;
    if (p.crouching) return false;               /* しゃがみで消灯 */
    return p.speed >= this.T.moveThreshold;      /* 歩行・走行中のみ点灯 */
  };

  Headlight.prototype.step = function (dt) {
    this.on = this._want();
    var want = this.on ? 1 : 0;
    this.level += (want - this.level) * clamp(this.T.fade * dt, 0, 1);
    if (this.level < 0.002) this.level = 0;
    this._place();
    this._apply();
  };

  /** 前方の壁までの距離（と壁の法線）。床のくさびをそこで切る */
  Headlight.prototype._castForward = function (x, z, fx, fz, maxD) {
    var map = this.game.map, T = this.T;
    var col = Math.floor(x / map.tileSize), row = Math.floor(z / map.tileSize);
    var d = 0, lastAxis = 0;
    while (d < maxD) {
      d += T.rayStep;
      var nc = Math.floor((x + fx * d) / map.tileSize);
      var nr = Math.floor((z + fz * d) / map.tileSize);
      if (nc === col && nr === row) continue;
      lastAxis = (nc !== col) ? 0 : 1;
      col = nc; row = nr;
      if (!map.inBounds(col, row) || map.isSolid(col, row)) {
        return {
          dist: Math.max(0, d - T.rayStep),
          normal: (lastAxis === 0) ? { x: (fx > 0 ? -1 : 1), z: 0 } : { x: 0, z: (fz > 0 ? -1 : 1) }
        };
      }
    }
    return { dist: maxD, normal: null };
  };

  Headlight.prototype._place = function () {
    var g = this.game, p = g.player, cam = g.camera, T = this.T, map = g.map;
    /* 空中の帯はカメラに追従（見ている方向の散乱） */
    if (cam) {
      this.cone.position.copy(cam.position);
      this.cone.quaternion.copy(cam.quaternion);
    } else {
      this.cone.position.set(p.x, p.y + p.eyeHeight, p.z);
    }

    /* 床のくさびは yaw だけに従う（ピッチ非依存＝真下を向いても円盤にならない） */
    var f = p.forward();
    var rx = -f.z, rz = f.x;                       /* 右手方向 */
    var hit = this._castForward(p.x, p.z, f.x, f.z, T.beamNear + T.beamLen);
    this.hitDist = hit.dist;
    this.hitNormal = hit.normal;
    /* 壁の手前で切る。壁に張り付いた時でも最小限の長さは残す（真っ暗にしない） */
    var end = Math.max(T.beamNear + 0.10, Math.min(T.beamNear + T.beamLen, hit.dist - 0.06));
    var NL = T.beamSegs, NW = CROSS.length, pos = this._beamPos;
    for (var i = 0; i <= NL; i++) {
      var t = i / NL;
      var d = T.beamNear + (end - T.beamNear) * t;
      /* 幅は「実距離」で決める（壁で切られた時に扇のまま広がらない） */
      var hw = T.beamHalfNear + (T.beamHalfFar - T.beamHalfNear) *
        clamp((d - T.beamNear) / T.beamLen, 0, 1);
      var cx = p.x + f.x * d, cz = p.z + f.z * d;
      for (var j = 0; j < NW; j++) {
        var wx = cx + rx * hw * CROSS[j], wz = cz + rz * hw * CROSS[j];
        var o = (i * NW + j) * 3;
        pos[o] = wx;
        pos[o + 1] = map.floorYAt(wx, wz) + T.beamLift;
        pos[o + 2] = wz;
      }
    }
    this._beamGeo.attributes.position.needsUpdate = true;
    this._beamGeo.computeBoundingSphere();

    /* 壁のしみ: 前方に壁がある時だけ、その壁面に楕円を出す */
    var wallOn = !!hit.normal && hit.dist <= T.beamNear + T.beamLen - 0.05;
    this._wallOn = wallOn;
    if (wallOn) {
      var wx2 = p.x + f.x * hit.dist, wz2 = p.z + f.z * hit.dist;
      var tt = clamp((hit.dist - T.beamNear) / T.beamLen, 0, 1);
      var rad = clamp(T.beamHalfNear + (T.beamHalfFar - T.beamHalfNear) * tt, 0.35, 1.6);
      this.wall.position.set(
        wx2 + hit.normal.x * 0.035,
        map.floorYAt(wx2, wz2) + T.wallHeight,
        wz2 + hit.normal.z * 0.035
      );
      this.wall.rotation.set(0, Math.atan2(hit.normal.x, hit.normal.z), 0);
      this.wall.scale.set(rad, rad, 1);
      this._wallFade = 1 - tt * 0.55;
    }
  };

  /** 空中の帯は視線が水平に近い時だけ出す（真下を向くと床に刺さって棒に見えるため） */
  Headlight.prototype.conePitchFade = function () {
    var pit = Math.abs(this.game.player.pitch), T = this.T;
    if (pit <= T.conePitchFull) return 1;
    if (pit >= T.conePitchZero) return 0;
    return 1 - (pit - T.conePitchFull) / (T.conePitchZero - T.conePitchFull);
  };

  Headlight.prototype._apply = function () {
    var T = this.T;
    /* P4.17 段階2: 後処理（系統Z）は線形空間で露出を掛けてから ACES を通す。
       加算合成のライトはそのままだと白飛びするので、後処理がある間だけ
       露出ぶんを打ち消して見た目を現行に揃える（形・広がりは一切変えない）。 */
    var lv = this.level * ((ESCAPE.RQ && ESCAPE.RQ.post) ? ESCAPE.RQ.addLightScale() : 1);
    var cf = this.conePitchFade();
    this._coneMat.opacity = lv * T.coneGain * cf;
    this._beamMat.opacity = lv * T.beamGain;
    this._wallMat.opacity = (this._wallOn ? lv * T.wallGain * (this._wallFade || 1) : 0);
    var vis = lv > 0.004;
    var cvis = vis && cf > 0.004;
    if (this.cone.visible !== cvis) this.cone.visible = cvis;
    if (this.beam.visible !== vis) this.beam.visible = vis;
    var wvis = vis && !!this._wallOn;
    if (this.wall.visible !== wvis) this.wall.visible = wvis;
  };

  /** 床のくさびの形（機械テスト用）: 前方長さ・最大幅・プレイヤーからの前後の張り出し */
  Headlight.prototype.beamShape = function () {
    var p = this.game.player, f = p.forward();
    var rx = -f.z, rz = f.x;
    var pos = this._beamPos, n = pos.length / 3;
    var fMin = Infinity, fMax = -Infinity, sMin = Infinity, sMax = -Infinity;
    for (var i = 0; i < n; i++) {
      var dx = pos[i * 3] - p.x, dz = pos[i * 3 + 2] - p.z;
      var fwd = dx * f.x + dz * f.z, side = dx * rx + dz * rz;
      if (fwd < fMin) fMin = fwd;
      if (fwd > fMax) fMax = fwd;
      if (side < sMin) sMin = side;
      if (side > sMax) sMax = side;
    }
    return {
      forwardMin: fMin, forwardMax: fMax, length: fMax - fMin,
      width: sMax - sMin, ratio: (fMax - fMin) / Math.max(1e-6, sMax - sMin),
      vertices: n
    };
  };

  Headlight.prototype.dispose = function () {
    if (this._beamGeo) this._beamGeo.dispose();
    if (this._wallGeo) this._wallGeo.dispose();
    if (this._coneGeo) this._coneGeo.dispose();
    if (this._beamMat) this._beamMat.dispose();
    if (this._wallMat) this._wallMat.dispose();
    if (this._coneMat) this._coneMat.dispose();
  };

  Headlight.prototype.info = function () {
    return {
      on: this.on, level: this.level, mul: ESCAPE.ENEMY_TUNING.headlightSightMul,
      hitDist: this.hitDist, wallOn: !!this._wallOn, shape: this.beamShape()
    };
  };

  ESCAPE.Headlight = Headlight;
  ESCAPE.HEADLIGHT_TUNING = HEADLIGHT_TUNING;

  global.__lightDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.headlight; },
    info: function () {
      var h = ESCAPE.game && ESCAPE.game.headlight;
      return h ? h.info() : null;
    }
  };
})(window);
