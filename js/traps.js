/* ESCAPE — 音の罠（契約 DESIGN.md §4「敵2体・音の罠・地図リセット（P4.10）」）
 *
 * 罠は「見て気づける造形」であること（慎重に歩けば回避できる）が契約の要。
 * このモジュールは造形（Three.js のメッシュ）と発火（ESCAPE.noise への emit）だけを持ち、
 * 絶叫・猛スピード・執拗な探索は js/enemy_ai.js（AIManager / EnemyAI）の既存規約に任せる。
 *
 * 罠の種類（5種以上・契約 §4）
 *   踏む系（走った時だけ鳴る。歩き・しゃがみは無音）
 *     ガラス片 / 金属板 / 水たまり … TILE.NOISE（meta.noise）＝既存。kind 'step' を js/enemy_ai.js の
 *                                    Stealth._footstepNoise が emit する。造形は js/world.js。
 *     空き缶の散乱               … meta.traps kind 'can'
 *     軋む床板                   … meta.traps kind 'creak'
 *   引っ掛かる系
 *     吊るした缶のワイヤー       … meta.traps kind 'wire'（立って通ると鳴る／しゃがめば潜れる）
 *     倒れかけの棚               … meta.traps kind 'shelf'（走って触れると倒れる）
 *     倒れかけのロッカー         … meta.traps kind 'locker'（同上）
 *   センサー                     … meta.sensors ＝既存。kind 'sensor'。
 *
 * 逃走路を塞がない（契約 §3）
 *   ・立体物（棚・ロッカー）は壁付きで突出 0.30m 以内。幅1マス通路には置かない（配置データ側の制約）。
 *   ・ワイヤーは 1.18m の高さに張るだけで当たり判定を持たない（しゃがめば潜れる）。
 *   ・空き缶・床板・倒れた什器は床の薄物（デカール相当）。
 *   ・つまり罠は一切 map の実体マスを増やさない＝経路探索・到達性に影響しない。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* ================================================================
   * 定数（契約「半径は種類ごとに定数（TRAP_TUNING に集約）」）
   * ============================================================== */
  var TRAP_TUNING = {
    /* 音イベントの到達半径(m)。kind は js/enemy_ai.js の ENEMY_TUNING.trapKinds に載る値。
       罠は trapHearRadius で施設全体に届くので、この値は「音の大きさの序列」を表す。 */
    radius: {
      can: 24.0,       // 空き缶が転がる
      creak: 16.0,     // 床板の軋み（いちばん小さい）
      wire: 28.0,      // 缶の連打
      shelf: 38.0,     // 什器の倒壊
      locker: 40.0,    // 鉄のロッカーの倒壊（いちばん大きい）
      step: 18.0,      // 音地盤（ENEMY_TUNING.runNoiseRadius と同値）
      sensor: 40.0     // センサー警報（ENEMY_TUNING.sensorNoiseRadius と同値）
    },

    /* 踏む系（can / creak）: 走った時だけ鳴る。歩き・しゃがみは無音（契約 §4「音システム」） */
    runSpeedMin: 0.50,        // これ以上の実速度で「走っている」と見なす(m/s)

    /* 吊るした缶のワイヤー */
    wireHeight: 1.18,         // 糸の高さ(m)。立位(視点1.62m)の胸〜腹に当たる
    wireCanDrop: 0.26,        // 糸から缶を吊るす長さ(m)
    wireCross: 0.62,          // 糸の中心線からこの距離まで寄ると引っ掛かる(m)
    wireMoveMin: 0.15,        // 立ち止まっていると鳴らない(m/s)

    /* 倒れかけの什器（棚・ロッカー）。
       契約 §3「立体物は壁付き（突出0.3m以下）」を守るため、通路側への傾き(lean)は
       ごく浅くし、「倒れかけ」の見た目は**横倒れ(tilt)**で作る（横に傾いても通路への
       張り出しは増えない）。最大突出 = propDepth + sin(propLean)*高さ ≦ 0.30m。 */
    propDepth: 0.215,         // 壁から手前への奥行(m)
    propLean: 0.042,          // 通路側への傾き(rad)。1.86mの高さで +0.078m
    propTilt: 0.135,          // 壁に沿った横倒れ(rad)。「倒れかけ」はこちらで見せる
    propMaxStick: 0.30,       // 突出の上限(m)。契約 §3
    /* 接触の幅。什器の前面から通路側へこの距離までが「ぶつかった」。
       マス(2m)の中央は前面から 0.71m なので、そのマスを走り抜ければ確実に倒れる。
       同じマスの反対の縁は 1.71m、隣のマスの中央は 2.71m ＝ どちらも band の外なので、
       「壁際を避けて走る」「隣の車線を通る」で回避できる（契約「慎重なら回避可」）。 */
    propContact: 1.05,
    propSide: 0.32,           // 幅方向のあたりの余白(m)
    propShelfW: 0.92,         // 棚の幅(m)
    propShelfH: 1.72,         // 棚の高さ(m)
    propLockerW: 0.66,        // ロッカーの幅(m)
    propLockerH: 1.86,        // ロッカーの高さ(m)
    fallenH: 0.16,            // 倒れた什器のデカールの厚み(m)

    /* 再武装（同じ罠を1マスの中で連打しない） */
    rearmDist: 2.60           // 一度鳴った罠から離れる距離(m)。離れれば再び鳴る
  };

  /* 造形の色味（tint）。区画の色に乗る */
  var TINT = {
    can: [1.45, 1.38, 1.14],
    creak: [1.25, 1.02, 0.72],
    wire: [1.30, 1.26, 1.12],
    shelf: [0.92, 0.84, 0.68],
    locker: [0.80, 0.90, 0.86],
    fallen: [0.66, 0.68, 0.66]
  };
  /* 背の低い小物（缶・床板）は接地AOを浅くしないと真っ黒に沈む */
  var AO_LOW = 0.88;

  /** 発火する罠の種類（造形と当たりを Traps が持つもの）。step/sensor は既存モジュールの担当 */
  var OWN_KINDS = ['can', 'creak', 'wire', 'shelf', 'locker'];
  /** 倒せる什器 */
  var PROP_KINDS = ['shelf', 'locker'];

  function has(list, v) { for (var i = 0; i < list.length; i++) if (list[i] === v) return true; return false; }

  /* 壁の向き -> 内向き（通路側）の法線 */
  var DIR_IN = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] };

  /** 音響フックの共通口。音響モジュールが無くても落ちない */
  function sfx(name, p) {
    if (ESCAPE.audio && ESCAPE.audio.event) ESCAPE.audio.event(name, p);
  }

  /* ================================================================
   * Traps
   * ============================================================== */
  function Traps(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'traps';
    this.disposables = [];
    this.list = [];          /* 罠の全体表（meta.traps ＋ meta.noise ＋ meta.sensors） */
    this.own = [];           /* このモジュールが発火させる罠だけ */
    this.props = [];         /* 倒せる什器（shelf / locker） */
    this.byCell = null;
    this.fired = 0;
    this.topples = 0;
    this.firedByKind = null;
    /* 罠の当たりを一時的に止める口。機械テスト（ロープ・地図の台本歩行）が
       「敵に邪魔されずに歩く」ために使う。製品の経路では常に true。 */
    this.enabled = true;
    this.reset();
  }

  /* ---------------- 罠の表 ---------------- */

  /** meta.traps / meta.noise / meta.sensors を1つの表にまとめる（密度・規約の検査もこれを見る） */
  Traps.prototype._collect = function () {
    var meta = this.map.meta || {};
    var out = [];
    var tr = meta.traps || [];
    for (var i = 0; i < tr.length; i++) {
      var t = tr[i];
      out.push({
        col: t.col, row: t.row, kind: t.kind, id: t.id || ('trap' + i),
        axis: t.axis || null, dir: t.dir || null, source: 'traps',
        armed: true, toppled: false, mesh: null, fallenMesh: null
      });
    }
    var nz = meta.noise || [];
    for (var j = 0; j < nz.length; j++) {
      out.push({
        col: nz[j].col, row: nz[j].row, kind: 'step', mat: nz[j].kind || 'water',
        id: 'noise' + j, axis: null, dir: null, source: 'noise', armed: true, toppled: false
      });
    }
    var sn = meta.sensors || [];
    for (var k = 0; k < sn.length; k++) {
      out.push({
        col: sn[k].col, row: sn[k].row, kind: 'sensor', id: 'sensor' + k,
        axis: null, dir: null, source: 'sensors', armed: true, toppled: false
      });
    }
    return out;
  };

  Traps.prototype.reset = function () {
    this.dispose();
    this.map = this.game.map;
    this.list = this._collect();
    this.own = [];
    this.props = [];
    this.byCell = Object.create(null);
    this.fired = 0;
    this.topples = 0;
    this.firedByKind = Object.create(null);
    this.enabled = true;
    for (var i = 0; i < this.list.length; i++) {
      var t = this.list[i];
      var c = this.map.cellCenter(t.col, t.row);
      t.x = c.x; t.z = c.z;
      t.y = this.map.cellFloorY(t.col, t.row);
      if (!has(OWN_KINDS, t.kind)) continue;
      this.own.push(t);
      var key = t.col + ',' + t.row;
      (this.byCell[key] || (this.byCell[key] = [])).push(t);
      if (has(PROP_KINDS, t.kind)) {
        this._propGeom(t);
        this.props.push(t);
      }
    }
    this._build();
    if (this.game.scene && this.group.parent !== this.game.scene) this.game.scene.add(this.group);
  };

  /** 什器の据え位置（壁付き・傾き）。造形と当たりの両方がこの1か所を見る */
  Traps.prototype._propGeom = function (t) {
    var T = this.map.tileSize, K = TRAP_TUNING;
    var din = DIR_IN[t.dir] || DIR_IN.n;
    var w = (t.kind === 'locker') ? K.propLockerW : K.propShelfW;
    var h = (t.kind === 'locker') ? K.propLockerH : K.propShelfH;
    /* 壁からの最大突出（天辺がいちばん出る）。契約 §3 の 0.30m 以内に収まる値 */
    var reach = K.propDepth + Math.sin(K.propLean) * h;
    /* din は「壁から通路へ向かう」法線。背面を預ける壁の面はマスの中心から -din 側にある。
       据え位置・前面はどちらも壁の面を基準に測る（＝壁付き。din 側へ置くと通路の
       真ん中へ浮いてしまう）。 */
    t.prop = {
      w: w, h: h, d: K.propDepth, reach: reach,
      /* 足元（背面が壁の面に接する）の中心 */
      x: t.x - din[0] * (T / 2 - K.propDepth / 2),
      z: t.z - din[1] * (T / 2 - K.propDepth / 2),
      nx: din[0], nz: din[1],
      /* 壁に沿った軸（幅の向き） */
      sx: -din[1], sz: din[0],
      lean: K.propLean, tilt: K.propTilt
    };
    /* 当たりの基準点＝いちばん通路側へ出た前面の中心（壁の面から reach だけ通路側） */
    t.hitX = t.x - din[0] * (T / 2 - reach);
    t.hitZ = t.z - din[1] * (T / 2 - reach);
    t.stick = reach;
  };

  /* ---------------- 造形 ---------------- */

  Traps.prototype._track = function (o) { this.disposables.push(o); return o; };

  Traps.prototype._material = function (tex, isDecal) {
    var TX = ESCAPE.Textures;
    if (isDecal) {
      return this._track(new THREE.MeshBasicMaterial({
        map: TX.get(tex), vertexColors: true, fog: true, transparent: true,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      }));
    }
    return this._track(new THREE.MeshBasicMaterial({ map: TX.get(tex), vertexColors: true, fog: true }));
  };

  Traps.prototype._build = function () {
    var W = ESCAPE.World, world = this.game.world;
    if (!W || !W.Builder || !world || !world.propShader) return;
    var Builder = W.Builder, buildMesh = W.buildMesh, setY = W.setYBias;
    var bags = { metal: new Builder(), wood: new Builder(), litter: new Builder() };

    for (var i = 0; i < this.own.length; i++) {
      var t = this.own[i];
      var low = (t.kind !== 'wire');
      var sh = world.propShader(t.col, t.row, TINT[t.kind], low ? AO_LOW : undefined);
      setY(t.y);
      if (t.kind === 'can') this._shapeCans(bags, t, sh, world);
      else if (t.kind === 'creak') this._shapeCreak(bags, t, sh);
      else if (t.kind === 'wire') this._shapeWire(bags, t, sh);
      setY(0);
    }
    var order = [['metal', 'metal', false], ['wood', 'board', false], ['litter', 'litter', true]];
    for (var m = 0; m < order.length; m++) {
      var b = bags[order[m][0]];
      if (b.isEmpty()) continue;
      var mesh = buildMesh(b, this._material(order[m][1], order[m][2]));
      this._track(mesh.geometry);
      mesh.name = 'trap_' + order[m][0];
      mesh.renderOrder = order[m][2] ? 40 : 1;
      this.group.add(mesh);
    }
    /* 倒せる什器は「立っている姿」と「倒れた姿」を切り替えるので個別メッシュにする */
    for (var p = 0; p < this.props.length; p++) this._buildProp(this.props[p]);
  };

  /** 空き缶の散乱: 床のゴミデカール＋転がった缶4つ（膝より下・逃走路を塞がない） */
  Traps.prototype._shapeCans = function (bags, t, sh, world) {
    var T = this.map.tileSize;
    var lit = world.decalShader(t.col, t.row, [1.15, 1.10, 0.98]);
    var s = 1.86, h = s / 2;
    bags.litter.grid([t.x - h, t.y + 0.014, t.z + h], [s, 0, 0], [0, 0, -s], 1, 1, 1, 1,
      function (x, y, z) { return lit(x, y, z); });
    /* 転がった缶。高さ0.11mの寝かせた円筒（角柱で代用）＝踏むと転がって鳴る見た目 */
    var OFF = [[-0.42, -0.30, 0.0], [0.28, -0.46, 1.0], [0.46, 0.34, 0.4], [-0.20, 0.44, 1.3], [0.02, 0.06, 0.8]];
    for (var i = 0; i < OFF.length; i++) {
      var cx = t.x + OFF[i][0], cz = t.z + OFF[i][1], a = OFF[i][2];
      var L = 0.135, r = 0.066;
      bags.metal.tube(
        [cx - Math.cos(a) * L, t.y + r + 0.012, cz - Math.sin(a) * L],
        [cx + Math.cos(a) * L, t.y + r + 0.012, cz + Math.sin(a) * L],
        r, 6, sh);
    }
    /* 潰れた缶を1つ立てておく（目印になる縦の形） */
    bags.metal.box(t.x + 0.10, t.y + 0.075, t.z - 0.08, 0.095, 0.15, 0.095, 3, sh);
    if (T) { /* T は将来のサイズ変更に備えて参照だけ持つ */ }
  };

  /** 軋む床板: 色の違う板を3枚＋端が浮いた1枚＋錆びた釘。踏むと鳴りそうに見えること */
  Traps.prototype._shapeCreak = function (bags, t, sh) {
    var y = t.y;
    for (var i = 0; i < 3; i++) {
      var off = (i - 1) * 0.56;
      var lift = (i === 1) ? 0.055 : 0.022;      /* 中央の1枚だけ浮いている */
      bags.wood.box(t.x + off, y + lift / 2 + 0.006, t.z, 0.50, lift, 1.78, 1.1, sh);
    }
    /* 浮いた板の端に噛ませた添え木（横から見て段差が分かる） */
    bags.wood.box(t.x, y + 0.075, t.z + 0.80, 0.52, 0.05, 0.14, 1.4, sh);
    /* 抜けかけた釘（頭だけ光る） */
    for (var k = 0; k < 4; k++) {
      bags.metal.box(t.x + ((k % 2) ? 0.42 : -0.42), y + 0.058, t.z + ((k < 2) ? 0.62 : -0.62),
        0.035, 0.030, 0.035, 6, sh);
    }
  };

  /** 吊るした缶のワイヤー: 通路をまたぐ低い糸＋缶3つ。当たり判定は持たない */
  Traps.prototype._shapeWire = function (bags, t, sh) {
    var K = TRAP_TUNING, T = this.map.tileSize;
    var y = t.y + K.wireHeight;
    var ax = (t.axis === 'x');
    var half = T * 0.5;
    var p0 = ax ? [t.x - half, y, t.z] : [t.x, y, t.z - half];
    var p1 = ax ? [t.x + half, y, t.z] : [t.x, y, t.z + half];
    bags.metal.tube(p0, p1, 0.016, 4, sh);
    /* 壁に打った留め具 */
    bags.metal.box(p0[0] + (ax ? 0.06 : 0), y, p0[2] + (ax ? 0 : 0.06), 0.10, 0.08, 0.10, 4, sh);
    bags.metal.box(p1[0] - (ax ? 0.06 : 0), y, p1[2] - (ax ? 0 : 0.06), 0.10, 0.08, 0.10, 4, sh);
    /* 吊るした缶（3つ）。糸で結んである */
    var S = [-0.52, 0.0, 0.54];
    for (var i = 0; i < S.length; i++) {
      var cx = ax ? (t.x + S[i]) : t.x;
      var cz = ax ? t.z : (t.z + S[i]);
      bags.metal.tube([cx, y, cz], [cx, y - K.wireCanDrop, cz], 0.009, 4, sh);
      bags.metal.tube([cx, y - K.wireCanDrop, cz], [cx, y - K.wireCanDrop - 0.15, cz], 0.052, 7, sh);
    }
  };

  /** 倒れかけの棚・ロッカー（立っている姿）。壁付き・突出 propMaxStick 以内・横へ傾く */
  Traps.prototype._buildProp = function (t) {
    var W = ESCAPE.World, world = this.game.world;
    if (!W || !W.Builder || !world || !world.propShader) return;
    var b = new W.Builder();
    var sh = world.propShader(t.col, t.row, TINT[t.kind]);
    W.setYBias(t.y);
    var P = t.prop;
    /**
     * 什器の部品を1つ積む。
     *   cy    中心の高さ(m)
     *   along 壁に沿った幅(m) / hy 高さ(m) / deep 壁からの奥行(m)
     *   side  壁に沿った中心のずらし(m)
     * 高さ cy の断面は「通路側へ sin(lean)*cy」「横へ sin(tilt)*cy」ずれる＝倒れかけ。
     */
    function part(cy, along, hy, deep, side) {
      var fwd = Math.sin(P.lean) * cy;
      var lat = Math.sin(P.tilt) * cy + (side || 0);
      var cx = P.x + P.nx * fwd + P.sx * lat;
      var cz = P.z + P.nz * fwd + P.sz * lat;
      var alongX = (P.nz !== 0);              /* 壁が南北 -> 幅は東西 */
      if (alongX) b.box(cx, cy, cz, along, hy, deep, 1.4, sh);
      else b.box(cx, cy, cz, deep, hy, along, 1.4, sh);
    }
    if (t.kind === 'locker') {
      part(P.h / 2, P.w, P.h, P.d * 0.94, 0);                 /* 本体 */
      part(P.h * 0.88, P.w * 0.74, 0.030, P.d * 0.34, 0);     /* 通気口3枚 */
      part(P.h * 0.83, P.w * 0.74, 0.030, P.d * 0.34, 0);
      part(P.h * 0.78, P.w * 0.74, 0.030, P.d * 0.34, 0);
      part(P.h * 0.50, 0.070, 0.22, P.d * 0.38, P.w * 0.30);  /* 取っ手 */
      part(P.h * 0.50, 0.030, P.h * 0.92, P.d * 0.36, 0);     /* 扉の合わせ目 */
      part(0.045, P.w * 0.96, 0.09, P.d * 0.82, 0);           /* 台輪 */
      /* 浮いた側に噛ませた木片（なぜ傾いているかが分かる） */
      part(0.035, 0.16, 0.07, P.d * 0.50, -P.w * 0.42);
    } else {
      part(P.h / 2, 0.055, P.h, P.d * 0.92, -P.w / 2);        /* 側板 左 */
      part(P.h / 2, 0.055, P.h, P.d * 0.92, P.w / 2);         /* 側板 右 */
      for (var s2 = 0; s2 < 4; s2++) {
        part(0.26 + s2 * 0.46, P.w, 0.045, P.d * 0.90, 0);    /* 棚板4枚 */
      }
      part(P.h * 0.66, P.w * 0.94, 0.030, P.d * 0.18, 0);     /* 背の筋交い */
      part(0.26 + 0.46 + 0.13, P.w * 0.40, 0.20, P.d * 0.58, -P.w * 0.20); /* 書類の束 */
      part(0.26 + 0.13, P.w * 0.26, 0.19, P.d * 0.52, P.w * 0.24);         /* ガラス器具の箱 */
    }
    W.setYBias(0);
    var mesh = W.buildMesh(b, this._material(t.kind === 'locker' ? 'metal' : 'board', false));
    this._track(mesh.geometry);
    mesh.name = 'trap_prop_' + t.id;
    this.group.add(mesh);
    t.mesh = mesh;
    t.standTris = b.idx.length / 3;
  };

  /** 倒れた什器（デカール相当の薄物）。倒した瞬間に作って以後ずっと残す */
  Traps.prototype._buildFallen = function (t) {
    var W = ESCAPE.World, world = this.game.world;
    if (!W || !W.Builder || !world || !world.propShader) return;
    var b = new W.Builder();
    var sh = world.propShader(t.col, t.row, TINT.fallen);
    W.setYBias(t.y);
    var P = t.prop, K = TRAP_TUNING;
    var alongX = (P.nz !== 0);
    /* 壁の足元から通路側へ倒れる。長さ＝元の高さ、ただしマスの外へは出さない */
    var len = Math.min(P.h, this.map.tileSize - 0.30);
    var cx = P.x + P.nx * (len / 2 - P.d / 2);
    var cz = P.z + P.nz * (len / 2 - P.d / 2);
    var sxA = alongX ? P.w : len, szA = alongX ? len : P.w;
    b.box(cx, K.fallenH / 2, cz, sxA, K.fallenH, szA, 1.4, sh);
    /* ひしゃげた面と散らばった中身 */
    b.box(cx - (alongX ? P.w * 0.24 : 0), K.fallenH + 0.03, cz - (alongX ? 0 : P.w * 0.24),
      alongX ? P.w * 0.34 : len * 0.42, 0.06, alongX ? len * 0.42 : P.w * 0.34, 2.0, sh);
    var SC = [[0.42, 0.30], [-0.36, 0.52], [0.10, -0.42]];
    for (var i = 0; i < SC.length; i++) {
      b.box(cx + SC[i][0], 0.055, cz + SC[i][1], 0.16, 0.10, 0.22, 2.4, sh);
    }
    W.setYBias(0);
    var mesh = W.buildMesh(b, this._material(t.kind === 'locker' ? 'metal' : 'board', false));
    this._track(mesh.geometry);
    mesh.name = 'trap_fallen_' + t.id;
    this.group.add(mesh);
    t.fallenMesh = mesh;
  };

  /* ---------------- 発火 ---------------- */

  /** 罠を鳴らす。kind ごとの半径で ESCAPE.noise へ流す（絶叫・疾走は敵AI側の規約） */
  Traps.prototype.fire = function (t) {
    var r = TRAP_TUNING.radius[t.kind] || 24;
    ESCAPE.noise.emit(t.x, t.z, r, t.kind);
    this.fired++;
    this.firedByKind[t.kind] = (this.firedByKind[t.kind] || 0) + 1;
    this.lastFired = t;
    t.armed = false;
    sfx('trap' + t.kind.charAt(0).toUpperCase() + t.kind.slice(1), { x: t.x, z: t.z });
    return t;
  };

  /** 什器を倒す（走って接触した時だけ）。以後その位置は倒れた什器のデカール */
  Traps.prototype.topple = function (t) {
    if (t.toppled) return false;
    t.toppled = true;
    this.topples++;
    if (t.mesh) t.mesh.visible = false;
    if (!t.fallenMesh) this._buildFallen(t);
    else t.fallenMesh.visible = true;
    this.fire(t);
    return true;
  };

  /** 罠の判定を止めるべき状態か（中断安全: ロッカー内・牢・演出・モーダル） */
  Traps.prototype._suspended = function () {
    var g = this.game;
    if (g.stealth && g.stealth.hidden && g.stealth.hidden()) return true;
    if (g.cinematic && g.cinematic.active && g.cinematic.active()) return true;
    return false;
  };

  Traps.prototype.step = function () {
    if (!this.enabled || this._suspended()) return;
    var p = this.game.player;
    var col = p.col(), row = p.row();
    var K = TRAP_TUNING;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var arr = this.byCell[(col + dc) + ',' + (row + dr)];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) this._check(arr[i], p, col, row, K);
      }
    }
  };

  Traps.prototype._check = function (t, p, col, row, K) {
    var dx = p.x - t.x, dz = p.z - t.z;
    /* 再武装: 一度鳴った罠は、離れれば また鳴る */
    if (!t.armed && Math.hypot(dx, dz) > K.rearmDist) t.armed = true;

    if (t.kind === 'can' || t.kind === 'creak') {
      /* 踏む系: 自分のマスに入って「走って」いる時だけ（歩き・しゃがみは無音） */
      if (!t.armed) return;
      if (t.col !== col || t.row !== row) return;
      if (p.mode !== 'run' || p.speed < K.runSpeedMin) return;
      this.fire(t);
      return;
    }
    if (t.kind === 'wire') {
      /* 引っ掛かる系: 立って通れば歩きでも鳴る。しゃがみは潜れる（契約） */
      if (!t.armed) return;
      if (p.crouching) return;
      if (p.speed < K.wireMoveMin) return;
      var half = this.map.tileSize * 0.5;
      if (t.axis === 'x') {
        if (Math.abs(dz) > K.wireCross || Math.abs(dx) > half) return;
      } else {
        if (Math.abs(dx) > K.wireCross || Math.abs(dz) > half) return;
      }
      this.fire(t);
      return;
    }
    /* 倒れかけの什器: 走ってぶつかった時だけ倒れる（歩き・しゃがみでは倒れない） */
    if (t.toppled) return;
    if (p.mode !== 'run' || p.speed < K.runSpeedMin) return;
    var P = t.prop;
    var ex = p.x - t.hitX, ez = p.z - t.hitZ;
    var dn = ex * P.nx + ez * P.nz;                 /* 前面から通路側への距離 */
    var da = ex * P.sx + ez * P.sz;                 /* 壁に沿った距離 */
    if (dn < -0.10 || dn > K.propContact) return;
    if (Math.abs(da) > P.w / 2 + K.propSide) return;
    this.topple(t);
  };

  /* ---------------- 後始末 ---------------- */

  Traps.prototype.dispose = function () {
    for (var i = 0; i < this.disposables.length; i++) {
      var d = this.disposables[i];
      if (d && d.dispose) d.dispose();
    }
    this.disposables.length = 0;
    if (this.group.clear) this.group.clear();
    else this.group.children.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  };

  /* ---------------- 検査用の統計（機械テストと監査が読む） ---------------- */

  /** 通路マス（部屋の外の歩行可能マス）。密度の分母 */
  Traps.prototype.corridorCells = function () {
    if (this._corr) return this._corr;
    var map = this.map, meta = map.meta || {};
    var rooms = [], regions = meta.regions || [];
    var bands = Object.create(null), bs = meta.bands || [];
    for (var b = 0; b < bs.length; b++) bands[bs[b].id] = true;
    var lms = meta.landmarks || [];
    var lm = Object.create(null);
    for (var l = 0; l < lms.length; l++) lm[lms[l].id] = true;
    for (var i = 0; i < regions.length; i++) {
      if (bands[regions[i].id] || lm[regions[i].id]) continue;
      rooms.push(regions[i]);
    }
    var out = [];
    var cells = map.walkableCells();
    for (var c = 0; c < cells.length; c++) {
      var inRoom = false;
      for (var r = 0; r < rooms.length && !inRoom; r++) {
        var g = rooms[r];
        if (cells[c].col >= g.c0 && cells[c].col <= g.c1 && cells[c].row >= g.r0 && cells[c].row <= g.r1) inRoom = true;
      }
      if (!inRoom) out.push(cells[c]);
    }
    this._corr = out;
    return out;
  };

  Traps.prototype.density = function () {
    var n = this.corridorCells().length;
    return n ? this.list.length / n : 0;
  };

  Traps.prototype.countByKind = function () {
    var out = Object.create(null);
    for (var i = 0; i < this.list.length; i++) out[this.list[i].kind] = (out[this.list[i].kind] || 0) + 1;
    return out;
  };

  /**
   * 岩盤帯の通り抜け口。岩盤帯＝ほぼ全列が実体の行のまとまり（帯と帯の境界）。
   * その帯を貫く歩行可能マスの「列のかたまり」1つを1箇所と数える（契約: 10箇所）。
   */
  Traps.prototype.bandOpenings = function () {
    var map = this.map;
    /* 1) 岩盤帯の行を拾う */
    var rock = [];
    for (var r = 0; r < map.height; r++) {
      var walk = 0;
      for (var c = 0; c < map.width; c++) if (map.isWalkable(c, r)) walk++;
      if (walk > 0 && walk <= map.width * 0.10) rock.push(r);
    }
    /* 2) 連続する行を1本の岩盤帯にまとめる */
    var bands = [], cur = null;
    for (var i = 0; i < rock.length; i++) {
      if (cur && rock[i] === cur[cur.length - 1] + 1) cur.push(rock[i]);
      else { cur = [rock[i]]; bands.push(cur); }
    }
    /* 3) 帯ごとに、貫通している列のかたまりを1箇所と数える */
    var out = [];
    for (var b = 0; b < bands.length; b++) {
      var band = bands[b], cols = [];
      for (var c2 = 0; c2 < map.width; c2++) {
        var through = true;
        for (var k = 0; k < band.length; k++) if (!map.isWalkable(c2, band[k])) through = false;
        if (through) cols.push(c2);
      }
      var g0 = null;
      for (var j = 0; j < cols.length; j++) {
        if (g0 === null || cols[j] !== cols[j - 1] + 1) {
          g0 = cols[j];
          out.push({ col: cols[j], row: band[0], rows: band.slice(), band: b });
        } else {
          out[out.length - 1].col = Math.round((g0 + cols[j]) / 2);
        }
      }
    }
    return out;
  };

  ESCAPE.Traps = Traps;
  ESCAPE.TRAP_TUNING = TRAP_TUNING;
  Traps.TUNING = TRAP_TUNING;
  Traps.OWN_KINDS = OWN_KINDS;
  Traps.PROP_KINDS = PROP_KINDS;

  /* ================================================================
   * 機械テスト（契約 §6）。P4.10a と同じく ESCAPE.__extraSuites に積む
   * （runAll が拾う＝罠のテストも runAll の N に入る）
   * ============================================================== */
  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];

  function sim(g, n) { for (var i = 0; i < n; i++) g.stepFrame(ESCAPE.FIXED_DT); }
  function simUntil(g, cond, max) {
    for (var i = 0; i < max; i++) { if (cond()) return i; g.stepFrame(ESCAPE.FIXED_DT); }
    return cond() ? max : -1;
  }
  function place(g, col, row, yawDeg) {
    var c = g.map.cellCenter(col, row), p = g.player;
    p.x = c.x; p.z = c.z; p.y = g.map.floorYAt(c.x, c.z);
    p.yaw = (yawDeg || 0) * Math.PI / 180;
    p.pitch = 0; p.speed = 0; p.crouching = false; p.mode = 'walk';
  }
  /** (col,row) へ2マス手前から直進で入れる立ち位置 */
  function approachTo(map, col, row) {
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var dc = D[i][0], dr = D[i][1];
      if (!map.isWalkable(col + dc, row + dr)) continue;
      if (!map.isWalkable(col + dc * 2, row + dr * 2)) continue;
      return { col: col + dc * 2, row: row + dr * 2, yawDeg: Math.atan2(dc, dr) * 180 / Math.PI };
    }
    return null;
  }
  /** 敵を遠ざけて「罠だけ」を見る（見つかって追われると走行が乱れる） */
  function parkEnemies(g, col, row) {
    var map = g.map, cells = map.walkableCells();
    var target = map.cellCenter(col, row);
    var far = [];
    for (var i = 0; i < cells.length; i++) {
      var c = map.cellCenter(cells[i].col, cells[i].row);
      var d = Math.hypot(c.x - target.x, c.z - target.z);
      if (d > 55) far.push({ cell: cells[i], d: d });
    }
    far.sort(function (a, b) { return b.d - a.d; });
    var ais = g.ais ? g.ais.list : [g.ai];
    for (var k = 0; k < ais.length && k < far.length; k++) {
      var f = far[k * 3] || far[far.length - 1];
      ais[k].enemy.placeCell(f.cell.col, f.cell.row, 180, map);
      ais[k].path = null; ais[k].goal = null; ais[k].repathT = 0;
      ais[k].state = 'patrol'; ais[k].stateTime = 0;
    }
  }
  /** (col,row) を目標に「歩く/走る/しゃがむ」で通り抜ける。到達フレーム数を返す */
  function traverse(g, col, row, mode) {
    var ap = approachTo(g.map, col, row);
    if (!ap) return null;
    parkEnemies(g, col, row);
    place(g, ap.col, ap.row, ap.yawDeg);
    g.input.moveY = 1;
    g.input._keyRun = (mode === 'run');
    g.input.crouchOn = (mode === 'crouch');
    var frames = simUntil(g, function () {
      return g.player.col() === col && g.player.row() === row;
    }, 400);
    /* マスに「入った」だけでは中央を横切っていない。罠はマスの中心線で判定するので、
       通り抜けきるところまで進める（＝実際にその罠の上／脇を通る） */
    sim(g, 26);
    g.input.reset();
    return frames;
  }

  /* ---------------- A: 造形と定数 ---------------- */

  function testTrapKindsAndTuning(t, g) {
    g.reset();
    var tr = g.traps;
    if (!t.ok(!!tr, 'P4.10b 罠: Traps モジュールがゲームに結線されている')) return;
    var E = ESCAPE.ENEMY_TUNING || (g.ai && g.ai.T);
    var kinds = tr.countByKind();
    var names = Object.keys(kinds);
    t.ok(names.length >= 5, 'P4.10b 罠: 5種以上ある（契約 §4）', names.join(',') + ' = ' + names.length + '種');
    /* 契約の5種＋既存2種が全部揃っていること */
    var want = ['can', 'creak', 'wire', 'shelf', 'locker', 'step', 'sensor'];
    var missing = [];
    for (var i = 0; i < want.length; i++) if (!kinds[want[i]]) missing.push(want[i]);
    t.ok(missing.length === 0, 'P4.10b 罠: 契約の全種が配置されている', missing.join(',') || 'なし');

    /* kind は敵AIの規約（絶叫＋疾走を起こす kind）の中だけ */
    var bad = [];
    for (var k = 0; k < names.length; k++) {
      if (!has(E.trapKinds, names[k])) bad.push(names[k]);
    }
    t.ok(bad.length === 0, 'P4.10b 罠: 全ての kind が ENEMY_TUNING.trapKinds の規約内', bad.join(',') || 'なし');

    /* 半径は種類ごとの定数に集約されている */
    var K = ESCAPE.TRAP_TUNING;
    t.ok(!!K && !!K.radius, 'P4.10b 罠: 半径は TRAP_TUNING.radius に集約');
    var noRadius = [];
    for (var m = 0; m < names.length; m++) if (!(K.radius[names[m]] > 0)) noRadius.push(names[m]);
    t.ok(noRadius.length === 0, 'P4.10b 罠: 全種に半径の定数がある', noRadius.join(',') || 'なし');
    t.near(K.radius.step, E.runNoiseRadius, 1e-9, 'P4.10b 罠: 音地盤の半径は既存定数と一致');
    t.near(K.radius.sensor, E.sensorNoiseRadius, 1e-9, 'P4.10b 罠: センサーの半径は既存定数と一致');
    t.ok(K.radius.locker > K.radius.creak, 'P4.10b 罠: 什器の倒壊は床板の軋みより大きく響く',
      K.radius.locker + ' > ' + K.radius.creak);

    /* 音地盤の床種3種（ガラス片・金属板・水たまり）が全部使われている */
    var mats = Object.create(null), nz = g.map.meta.noise || [];
    for (var n = 0; n < nz.length; n++) mats[nz[n].kind || 'water'] = (mats[nz[n].kind || 'water'] || 0) + 1;
    t.ok(mats.glass > 0 && mats.metal > 0 && mats.water > 0,
      'P4.10b 罠: 踏む系の床種3種（硝子/金属板/水）が全部ある',
      'glass=' + (mats.glass | 0) + ' metal=' + (mats.metal | 0) + ' water=' + (mats.water | 0));
    var au = ESCAPE.audio;
    if (au && au.floorMaterial) {
      var got = Object.create(null);
      for (var q = 0; q < nz.length; q++) got[au.floorMaterial(nz[q].col, nz[q].row)] = true;
      t.ok(got.glass && got.metal && got.water,
        'P4.10b 罠: 床種3種が足音の音色として読める', Object.keys(got).join(','));
    }
  }

  /* ---------------- B: 配置密度・通り抜け口・逃走路 ---------------- */

  function testTrapPlacement(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    var map = g.map;
    var corr = tr.corridorCells();
    var d = tr.density();
    t.ok(d >= 0.08 && d <= 0.12, 'P4.10b 配置: 罠の密度は通路マスの8〜12%（契約「約1割」）',
      tr.list.length + '/' + corr.length + ' = ' + (d * 100).toFixed(2) + '%');

    /* 全ての罠が歩行可能マスの上にある（壁の中に埋まっていない） */
    var offMap = 0;
    for (var i = 0; i < tr.list.length; i++) {
      if (!map.isWalkable(tr.list[i].col, tr.list[i].row)) offMap++;
    }
    t.ok(offMap === 0, 'P4.10b 配置: 罠は全て歩行可能マスの上', offMap + '件が壁の中');

    /* 通路（部屋の外）に置く。部屋の中に紛れていないこと */
    var corrSet = Object.create(null);
    for (var c = 0; c < corr.length; c++) corrSet[corr[c].col + ',' + corr[c].row] = true;
    var inRoom = 0;
    for (var j = 0; j < tr.list.length; j++) {
      if (!corrSet[tr.list[j].col + ',' + tr.list[j].row]) inRoom++;
    }
    t.ok(inRoom === 0, 'P4.10b 配置: 罠は通路マスに置く（部屋の中には置かない）', inRoom + '件');

    /* 重複配置がない */
    var seen = Object.create(null), dup = 0;
    for (var k = 0; k < tr.list.length; k++) {
      var key = tr.list[k].col + ',' + tr.list[k].row;
      if (seen[key]) dup++; else seen[key] = true;
    }
    t.ok(dup === 0, 'P4.10b 配置: 同じマスに罠が重なっていない', dup + '件');

    /* 種類ごとに最低数がある（1種だけに偏らない） */
    var kinds = tr.countByKind(), thin = [];
    var own = ['can', 'creak', 'wire', 'shelf', 'locker'];
    for (var m = 0; m < own.length; m++) if ((kinds[own[m]] || 0) < 10) thin.push(own[m] + '=' + (kinds[own[m]] || 0));
    t.ok(thin.length === 0, 'P4.10b 配置: 新設5種はそれぞれ10箇所以上', thin.join(' ') || JSON.stringify(kinds));

    /* 行き止まり・部屋の入口にも散っている */
    var deadHit = 0, entHit = 0;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var n = 0; n < tr.list.length; n++) {
      var tt = tr.list[n], walk = 0, roomAdj = false;
      for (var q = 0; q < 4; q++) {
        var nc = tt.col + D[q][0], nr = tt.row + D[q][1];
        if (!map.isWalkable(nc, nr)) continue;
        walk++;
        if (!corrSet[nc + ',' + nr]) roomAdj = true;
      }
      if (walk === 1) deadHit++;
      if (roomAdj) entHit++;
    }
    t.ok(deadHit >= 8, 'P4.10b 配置: 行き止まりにも罠が散っている', deadHit + '箇所');
    t.ok(entHit >= 20, 'P4.10b 配置: 部屋の入口にも罠が散っている', entHit + '箇所');
  }

  function testTrapBandOpenings(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    var map = g.map;
    var ops = tr.bandOpenings();
    t.ok(ops.length === 10, 'P4.10b 通り抜け口: 岩盤帯の通り抜け口は10箇所', ops.length + '箇所');

    var set = Object.create(null);
    for (var i = 0; i < tr.list.length; i++) set[tr.list[i].col + ',' + tr.list[i].row] = tr.list[i];
    /* 口から歩いて5歩以内に罠があること（契約「必ず1つ」） */
    var worst = 0, missing = [];
    for (var o = 0; o < ops.length; o++) {
      var best = 99;
      var q = [[ops[o].col, ops[o].row, 0]], seen = Object.create(null);
      seen[ops[o].col + ',' + ops[o].row] = true;
      while (q.length) {
        var cur = q.shift();
        if (set[cur[0] + ',' + cur[1]]) { best = cur[2]; break; }
        if (cur[2] >= 6) continue;
        var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d = 0; d < 4; d++) {
          var nc = cur[0] + D[d][0], nr = cur[1] + D[d][1];
          if (!map.isWalkable(nc, nr)) continue;
          var k = nc + ',' + nr;
          if (seen[k]) continue;
          seen[k] = true;
          q.push([nc, nr, cur[2] + 1]);
        }
      }
      if (best > worst) worst = best;
      if (best > 5) missing.push(ops[o].col + ',' + ops[o].row + '(' + best + ')');
    }
    t.ok(missing.length === 0, 'P4.10b 通り抜け口: 全10箇所の近傍（5歩以内）に罠がある',
      missing.join(' ') || ('最遠 ' + worst + '歩'));
  }

  function testTrapDoesNotBlockEscape(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    var map = g.map, K = ESCAPE.TRAP_TUNING;

    /* 幅1マス通路の中央に立体物を置かない（契約 B） */
    function width1(col, row) {
      return (map.isSolid(col - 1, row) && map.isSolid(col + 1, row)) ||
             (map.isSolid(col, row - 1) && map.isSolid(col, row + 1));
    }
    var bad = [];
    for (var i = 0; i < tr.props.length; i++) {
      if (width1(tr.props[i].col, tr.props[i].row)) bad.push(tr.props[i].id);
    }
    t.ok(bad.length === 0, 'P4.10b 逃走路: 幅1マス通路に立体物（棚・ロッカー）を置いていない',
      bad.join(',') || tr.props.length + '件を検査');

    /* 立体物は壁付き＝壁からの突出 0.30m 以内（契約 §3） */
    var far = [], worst = 0;
    for (var j = 0; j < tr.props.length; j++) {
      var p = tr.props[j];
      if (p.stick > worst) worst = p.stick;
      if (p.stick > K.propMaxStick + 1e-9) far.push(p.id + '=' + p.stick.toFixed(3));
      if (!p.dir) far.push(p.id + '=壁なし');
    }
    t.ok(far.length === 0, 'P4.10b 逃走路: 立体物は壁付きで突出0.30m以内（契約 §3）',
      far.join(' ') || ('最大 ' + worst.toFixed(3) + 'm / ' + tr.props.length + '件'));
    t.ok(K.propMaxStick <= 0.30, 'P4.10b 逃走路: 突出の上限は0.30m（契約 §3）', K.propMaxStick);
    t.ok(K.propTilt > K.propLean * 2,
      'P4.10b 逃走路: 「倒れかけ」は横倒れで見せる（通路へ張り出さない）',
      K.propTilt + ' vs ' + K.propLean);

    /* 罠は実体マスを1つも増やさない＝到達性が変わらない */
    var before = map.walkableCells().length;
    var reach = map.floodFrom(map.meta.spawn.col, map.meta.spawn.row);
    var n = 0;
    for (var kk in reach) n++;
    t.ok(n === before, 'P4.10b 逃走路: 罠を置いても全歩行可能マスへ到達できる', n + '/' + before);

    /* ワイヤーは通過可能な高さに張る（しゃがみの視点0.95mより上・立位の視点1.62mより下） */
    t.ok(K.wireHeight > ESCAPE.Player.EYE_CROUCH && K.wireHeight < ESCAPE.Player.EYE_STAND,
      'P4.10b 逃走路: ワイヤーはしゃがみで潜れる高さ', K.wireHeight + 'm');

    /* ワイヤーは糸を張る軸を持つ（壁から壁へ渡っている） */
    var noAxis = 0;
    for (var w = 0; w < tr.own.length; w++) {
      if (tr.own[w].kind !== 'wire') continue;
      if (tr.own[w].axis !== 'x' && tr.own[w].axis !== 'z') noAxis++;
    }
    t.ok(noAxis === 0, 'P4.10b 逃走路: 全てのワイヤーが張る軸を持つ', noAxis + '件');
  }

  /**
   * 什器が「本当に壁に付いているか」を、定数ではなく**据えた座標**から測る。
   * （突出の検査を reach という設計値だけで済ませると、据え位置の符号を間違えても
   *   通ってしまう。ここは必ず placed geometry を測ること。）
   */
  function testTrapPropAgainstWall(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    var map = g.map, K = ESCAPE.TRAP_TUNING, T = map.tileSize;
    var WALL = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };

    /* dir が指す隣のマスが本当に壁（実体）であること */
    var noWall = [];
    for (var i = 0; i < tr.props.length; i++) {
      var p = tr.props[i], d = WALL[p.dir];
      if (!d || !map.isSolid(p.col + d[0], p.row + d[1])) noWall.push(p.id + '(' + p.dir + ')');
    }
    t.ok(noWall.length === 0, 'P4.10b 什器: dir の指す隣マスが実際に壁',
      noWall.join(' ') || tr.props.length + '件を検査');

    /* 背面が壁の面に接しているか＋通路への突出が0.30m以内か（据えた座標から実測） */
    var offWall = [], stickBad = [], worst = 0;
    for (var j = 0; j < tr.props.length; j++) {
      var q = tr.props[j], P = q.prop;
      /* マスの中心から見た「通路向き」の座標。壁の面は -T/2 にある */
      var along = (P.x - q.x) * P.nx + (P.z - q.z) * P.nz;
      var back = along - P.d / 2;
      var stick = (back + P.reach) - (-T / 2);
      if (stick > worst) worst = stick;
      if (Math.abs(back - (-T / 2)) > 1e-6) offWall.push(q.id + '=' + back.toFixed(3));
      if (stick > K.propMaxStick + 1e-9) stickBad.push(q.id + '=' + stick.toFixed(3));
    }
    t.ok(offWall.length === 0, 'P4.10b 什器: 背面が壁の面にぴたりと接している（実測）',
      offWall.slice(0, 6).join(' ') || tr.props.length + '件');
    t.ok(stickBad.length === 0, 'P4.10b 什器: 通路への突出は0.30m以内（据えた座標から実測）',
      stickBad.slice(0, 6).join(' ') || ('最大 ' + worst.toFixed(3) + 'm'));

    /* 当たりの基準点も壁の面から reach だけ通路側にあること */
    var hitBad = [];
    for (var k = 0; k < tr.props.length; k++) {
      var r = tr.props[k], R = r.prop;
      var hitAlong = (r.hitX - r.x) * R.nx + (r.hitZ - r.z) * R.nz;
      if (Math.abs(hitAlong - (-T / 2 + R.reach)) > 1e-6) hitBad.push(r.id);
    }
    t.ok(hitBad.length === 0, 'P4.10b 什器: 当たりの前面が造形と同じ場所にある',
      hitBad.slice(0, 6).join(' ') || tr.props.length + '件');

    /* マスの中央は接触帯の中／同じマスの反対の縁と隣のマスは帯の外
       ＝「走り抜ければ倒れる・寄れば避けられる」が成り立つ幅であること */
    var mid = T / 2 - (K.propDepth + Math.sin(K.propLean) * K.propLockerH);
    t.ok(mid < K.propContact, 'P4.10b 什器: マスの中央を走れば必ず接触する',
      mid.toFixed(3) + ' < ' + K.propContact);
    t.ok(mid + T / 2 > K.propContact, 'P4.10b 什器: 同じマスでも壁際を避ければ通れる',
      (mid + T / 2).toFixed(3) + ' > ' + K.propContact);
    t.ok(mid + T > K.propContact, 'P4.10b 什器: 隣のマス（別の車線）は接触しない',
      (mid + T).toFixed(3) + ' > ' + K.propContact);
  }

  /** 「走ってそのマスを通れば倒れる」を1件ではなく多数で確かめる（据え位置の取りこぼし検出） */
  function testTrapPropToppleCoverage(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    var ids = [];
    for (var i = 0; i < tr.own.length && ids.length < 10; i++) {
      var o = tr.own[i];
      if (o.kind !== 'shelf' && o.kind !== 'locker') continue;
      if (!approachTo(g.map, o.col, o.row)) continue;
      ids.push({ id: o.id, col: o.col, row: o.row });
    }
    if (!t.ok(ids.length >= 8, 'P4.10b 什器: 走行接触の検査に使える什器がある', ids.length + '件')) return;
    var miss = [];
    for (var j = 0; j < ids.length; j++) {
      g.reset();
      traverse(g, ids[j].col, ids[j].row, 'run');
      if (g.traps.topples === 0) miss.push(ids[j].id);
    }
    t.ok(miss.length === 0, 'P4.10b 什器: どの什器も走って通れば倒れる（向きに依らない）',
      miss.join(' ') || ids.length + '件すべて倒れた');
    /* 同じ経路を歩けば1つも倒れない */
    var walkTop = 0;
    for (var k = 0; k < ids.length; k++) {
      g.reset();
      traverse(g, ids[k].col, ids[k].row, 'walk');
      walkTop += g.traps.topples;
    }
    t.ok(walkTop === 0, 'P4.10b 什器: 同じ経路を歩いても1つも倒れない', walkTop + '件');
    g.reset();
  }

  function testTrapMeshes(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    t.ok(tr.group.parent === g.scene, 'P4.10b 造形: 罠のグループがシーンに出ている');
    var names = Object.create(null);
    for (var i = 0; i < tr.group.children.length; i++) {
      var c = tr.group.children[i];
      names[c.name.replace(/_a1_tr\d+$/, '')] = (names[c.name.replace(/_a1_tr\d+$/, '')] || 0) + 1;
    }
    t.ok(names.trap_metal > 0 && names.trap_wood > 0,
      'P4.10b 造形: 缶・床板・ワイヤーのメッシュが積まれている', JSON.stringify(names));
    t.ok((names.trap_prop || 0) === tr.props.length,
      'P4.10b 造形: 倒せる什器は1つずつメッシュを持つ', (names.trap_prop || 0) + '/' + tr.props.length);
    var tris = 0;
    for (var m = 0; m < tr.group.children.length; m++) {
      var geo = tr.group.children[m].geometry;
      if (geo && geo.index) tris += geo.index.count / 3;
    }
    t.ok(tris > 4000, 'P4.10b 造形: 目視で気づける実体を持つ（三角形数）', tris + '三角形');
    /* 什器は最初は立っている */
    var down = 0;
    for (var p = 0; p < tr.props.length; p++) if (tr.props[p].toppled) down++;
    t.ok(down === 0, 'P4.10b 造形: 開始時は什器が全て立っている', down + '件が倒れている');
  }

  /* ---------------- C: 発火 ---------------- */

  function testTrapStepKinds(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    /* can / creak をそれぞれ「歩き」「しゃがみ」「走り」で通る */
    var kinds = ['can', 'creak'];
    for (var k = 0; k < kinds.length; k++) {
      var target = null;
      for (var i = 0; i < tr.own.length && !target; i++) {
        if (tr.own[i].kind !== kinds[k]) continue;
        if (approachTo(g.map, tr.own[i].col, tr.own[i].row)) target = tr.own[i];
      }
      if (!t.ok(!!target, 'P4.10b 発火: ' + kinds[k] + ' の検証に使える罠がある')) continue;

      g.reset();
      var f1 = traverse(g, target.col, target.row, 'walk');
      t.ok(f1 !== null && f1 >= 0, 'P4.10b 発火: ' + kinds[k] + ' を歩いて通り抜けられた', f1);
      t.ok(g.traps.fired === 0, 'P4.10b 発火: ' + kinds[k] + ' は歩きでは鳴らない（契約）', g.traps.fired);

      g.reset();
      var f2 = traverse(g, target.col, target.row, 'crouch');
      t.ok(f2 !== null && f2 >= 0, 'P4.10b 発火: ' + kinds[k] + ' をしゃがんで通り抜けられた', f2);
      t.ok(g.traps.fired === 0, 'P4.10b 発火: ' + kinds[k] + ' はしゃがみでは鳴らない（契約）', g.traps.fired);

      g.reset();
      var f3 = traverse(g, target.col, target.row, 'run');
      t.ok(f3 !== null && f3 >= 0, 'P4.10b 発火: ' + kinds[k] + ' を走って通り抜けられた', f3);
      t.ok(g.traps.fired >= 1 && (g.traps.firedByKind[kinds[k]] || 0) >= 1,
        'P4.10b 発火: ' + kinds[k] + ' は走ると鳴る', JSON.stringify(g.traps.firedByKind));
    }
    g.reset();
  }

  function testTrapWireCrouch(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    var target = null;
    for (var i = 0; i < tr.own.length && !target; i++) {
      if (tr.own[i].kind !== 'wire') continue;
      if (approachTo(g.map, tr.own[i].col, tr.own[i].row)) target = tr.own[i];
    }
    if (!t.ok(!!target, 'P4.10b ワイヤー: 検証に使える罠がある')) return;

    /* しゃがみ＝潜れる＝無音（契約） */
    g.reset();
    var f1 = traverse(g, target.col, target.row, 'crouch');
    t.ok(f1 !== null && f1 >= 0, 'P4.10b ワイヤー: しゃがんで潜り抜けられた', f1);
    t.ok(g.traps.fired === 0, 'P4.10b ワイヤー: しゃがみは無音（契約）', g.traps.fired);

    /* 立って歩く＝鳴る（契約「歩いても鳴る」） */
    g.reset();
    var f2 = traverse(g, target.col, target.row, 'walk');
    t.ok(f2 !== null && f2 >= 0, 'P4.10b ワイヤー: 立って歩いて到達できた', f2);
    t.ok((g.traps.firedByKind.wire || 0) >= 1, 'P4.10b ワイヤー: 立位の歩行で鳴る（契約）',
      JSON.stringify(g.traps.firedByKind));

    /* 立って走る＝鳴る */
    g.reset();
    traverse(g, target.col, target.row, 'run');
    t.ok((g.traps.firedByKind.wire || 0) >= 1, 'P4.10b ワイヤー: 立位の走行でも鳴る',
      JSON.stringify(g.traps.firedByKind));
    g.reset();
  }

  function testTrapPropTopple(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    var target = null;
    for (var i = 0; i < tr.own.length && !target; i++) {
      if (tr.own[i].kind !== 'shelf' && tr.own[i].kind !== 'locker') continue;
      if (approachTo(g.map, tr.own[i].col, tr.own[i].row)) target = tr.own[i];
    }
    if (!t.ok(!!target, 'P4.10b 什器: 検証に使える罠がある')) return;
    var key = target.id;

    function find(gg) {
      for (var j = 0; j < gg.traps.own.length; j++) if (gg.traps.own[j].id === key) return gg.traps.own[j];
      return null;
    }

    /* 歩いて触れても倒れない */
    g.reset();
    traverse(g, target.col, target.row, 'walk');
    var w = find(g);
    t.ok(w && !w.toppled, 'P4.10b 什器: 歩いて触れても倒れない（契約）', w ? w.toppled : 'なし');
    t.ok(g.traps.topples === 0, 'P4.10b 什器: 歩きでは倒壊が起きない', g.traps.topples);

    /* しゃがみでも倒れない */
    g.reset();
    traverse(g, target.col, target.row, 'crouch');
    t.ok(g.traps.topples === 0, 'P4.10b 什器: しゃがみでも倒れない', g.traps.topples);

    /* 走ってぶつかると倒れて大音＋以後はデカール */
    g.reset();
    traverse(g, target.col, target.row, 'run');
    var r = find(g);
    if (t.ok(!!r && r.toppled, 'P4.10b 什器: 走って接触すると倒れる（契約）', r ? r.toppled : 'なし')) {
      t.ok(g.traps.topples === 1, 'P4.10b 什器: 倒壊は1回だけ数える', g.traps.topples);
      t.ok((g.traps.firedByKind[r.kind] || 0) >= 1, 'P4.10b 什器: 倒壊で音イベントが出る',
        JSON.stringify(g.traps.firedByKind));
      t.ok(r.mesh && r.mesh.visible === false, 'P4.10b 什器: 立っていた姿が消える');
      t.ok(!!r.fallenMesh && r.fallenMesh.visible !== false,
        'P4.10b 什器: 以後その位置は倒れた什器のデカール（契約）');
      /* 倒れた什器は逃走路を塞がない（薄物＝当たりを増やさない） */
      var c = g.map.cellCenter(r.col, r.row);
      t.ok(!g.player.collidesAt(c.x, c.z), 'P4.10b 什器: 倒れた後もそのマスを通れる');
      /* 二度は倒れない */
      var before = g.traps.topples;
      g.traps.topple(r);
      t.ok(g.traps.topples === before, 'P4.10b 什器: 倒れた什器は二度倒れない', g.traps.topples);
    }
    g.reset();
    var back = find(g);
    t.ok(back && !back.toppled && back.mesh && back.mesh.visible !== false,
      'P4.10b 什器: reset で立っている姿に戻る');
  }

  function testTrapAlertsBothEnemies(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr || !g.ais || g.ais.list.length < 2) return;
    /* 罠を1つ選び、直接鳴らして両個体の反応を見る（発火経路は他のテストで検証済み） */
    var target = null;
    for (var i = 0; i < tr.own.length && !target; i++) {
      if (tr.own[i].kind === 'wire' || tr.own[i].kind === 'can') target = tr.own[i];
    }
    if (!t.ok(!!target, 'P4.10b 反応: 検証に使える罠がある')) return;
    var a0 = g.ais.list[0], a1 = g.ais.list[1];
    var s0 = a0.screams + a1.screams;
    tr.fire(target);
    sim(g, 2);
    t.ok(a0.state === 'investigate' && a1.state === 'investigate',
      'P4.10b 反応: 罠の音で両個体が調査へ移る（契約「両方が反応」）', a0.state + ' / ' + a1.state);
    t.ok(a0.screams + a1.screams > s0, 'P4.10b 反応: 罠が鳴った瞬間に絶叫が上がる',
      (a0.screams + a1.screams - s0) + '回');
    var T = ESCAPE.ENEMY_TUNING || a0.T;
    t.ok(a0.alert === true && a1.alert === true,
      'P4.10b 反応: 両個体が「罠の音」として警戒状態に入る', a0.alert + ' / ' + a1.alert);
    t.near(T.trapInvestigateSpeed, 6.50, 1e-9, 'P4.10b 反応: 猛スピードは6.5m/s（契約）');
    t.ok(T.trapInvestigateSpeed > T.investigateSpeed,
      'P4.10b 反応: 罠の調査は通常の調査より速い',
      T.trapInvestigateSpeed + ' > ' + T.investigateSpeed);
    t.ok(a0.trapAlerts >= 1 && a1.trapAlerts >= 1, 'P4.10b 反応: 両個体が罠の音として受け取る',
      a0.trapAlerts + ' / ' + a1.trapAlerts);
    g.reset();
  }

  function testTrapInterruptSafety(t, g) {
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    /* ロッカーに隠れている間は罠が鳴らない（中断安全） */
    var lk = (g.map.meta.lockers || [])[0];
    if (lk) {
      var D = [[1, 0], [-1, 0], [0, 1], [0, -1]], adj = null;
      for (var d = 0; d < 4 && !adj; d++) {
        if (g.map.isWalkable(lk.col + D[d][0], lk.row + D[d][1])) adj = { col: lk.col + D[d][0], row: lk.row + D[d][1] };
      }
      if (adj) {
        place(g, adj.col, adj.row, 0);
        g.stealth.enterLocker(lk.col, lk.row);
        var before = tr.fired;
        g.player.mode = 'run'; g.player.speed = 4.6;
        tr.step(ESCAPE.FIXED_DT);
        t.ok(tr.fired === before, 'P4.10b 中断安全: ロッカーに隠れている間は罠が鳴らない');
        g.stealth.onInteract();
      }
    }
    g.reset();
    /* 再武装: 同じ罠の上に居座っても連打しない */
    var target = null;
    for (var i = 0; i < tr.own.length && !target; i++) if (tr.own[i].kind === 'can') target = tr.own[i];
    if (t.ok(!!target, 'P4.10b 再武装: 検証に使える罠がある')) {
      place(g, target.col, target.row, 0);
      g.player.mode = 'run'; g.player.speed = 4.6;
      g.traps.step(ESCAPE.FIXED_DT);
      var n1 = g.traps.fired;
      for (var s = 0; s < 30; s++) g.traps.step(ESCAPE.FIXED_DT);
      t.ok(g.traps.fired === n1 && n1 === 1, 'P4.10b 再武装: 同じ罠は居座っても1回しか鳴らない', g.traps.fired);
      ESCAPE.noise.reset();
    }
    g.reset();
    t.ok(g.traps.fired === 0 && g.traps.topples === 0, 'P4.10b 復帰: reset で罠の発火記録が消える',
      g.traps.fired + '/' + g.traps.topples);
    t.ok(ESCAPE.noise.pending.length === 0, 'P4.10b 復帰: 音イベントのキューが空', ESCAPE.noise.pending.length);
  }

  /* ---------------- D: 音 ---------------- */

  function testTrapAudio(t, g) {
    var A = ESCAPE.Audio, au = ESCAPE.audio;
    if (!t.ok(!!A && !!au, 'P4.10b 音: 音響モジュールがある')) return;
    var voices = A.voices ? A.voices() : Object.keys(A.VOICES || {});
    var want = ['canRattle', 'floorCreak', 'wireCans', 'furnitureCrash'];
    var missing = [];
    for (var i = 0; i < want.length; i++) if (voices.indexOf(want[i]) < 0) missing.push(want[i]);
    t.ok(missing.length === 0, 'P4.10b 音: 罠の音（缶・床板・ワイヤー・倒壊）が定義されている',
      missing.join(',') || want.join(','));

    /* 実際にフックが鳴らすこと（testMode 中はカウントだけ増える） */
    g.reset();
    var tr = g.traps;
    if (!tr) return;
    /* au.fired は「音色（VOICES）の名前」で数える */
    var fires = { can: 'canRattle', creak: 'floorCreak', wire: 'wireCans',
                  shelf: 'furnitureCrash', locker: 'furnitureCrash' };
    var kinds = Object.keys(fires);
    for (var k = 0; k < kinds.length; k++) {
      var target = null;
      for (var m = 0; m < tr.own.length && !target; m++) if (tr.own[m].kind === kinds[k]) target = tr.own[m];
      if (!target) continue;
      var before = (au.fired && au.fired[fires[kinds[k]]]) || 0;
      tr.fire(target);
      var after = (au.fired && au.fired[fires[kinds[k]]]) || 0;
      t.ok(after > before, 'P4.10b 音: ' + kinds[k] + ' の罠音フックが鳴る', before + ' -> ' + after);
    }
    ESCAPE.noise.reset();

    /* OfflineAudioContext のレンダ数値（契約 §4「レンダヘルパーで数値判定」） */
    if (A.ready && A.ready()) {
      var c = A.cache;
      /* 実測（44.1kHz）: can 0.0268/0.294 creak 0.0332/0.355 wire 0.0148/0.248 crash 0.0603/0.754 */
      var gates = [['trap_can', 0.015, 0.18], ['trap_creak', 0.018, 0.22],
                   ['trap_wire', 0.008, 0.14], ['trap_crash', 0.035, 0.50]];
      for (var q = 0; q < gates.length; q++) {
        var mm = c[gates[q][0]];
        if (!t.ok(!!mm, 'P4.10b 音レンダ: ' + gates[q][0] + ' がキャッシュにある')) continue;
        t.ok(mm.rms >= gates[q][1] && mm.peak >= gates[q][2] && mm.peak <= 1.0 && !mm.clipped,
          'P4.10b 音レンダ: ' + gates[q][0] + ' の RMS/peak が範囲内',
          'rms=' + mm.rms.toFixed(4) + ' peak=' + mm.peak.toFixed(4));
        t.ok(mm.onset >= 0 && mm.onset < 0.30, 'P4.10b 音レンダ: ' + gates[q][0] + ' が時間内に発音する',
          'onset=' + mm.onset.toFixed(3));
      }
      if (c.trap_crash && c.trap_creak) {
        t.ok(c.trap_crash.peak > c.trap_creak.peak * 1.8,
          'P4.10b 音レンダ: 什器の倒壊は床板の軋みより遥かに大きい',
          c.trap_crash.peak.toFixed(3) + ' vs ' + c.trap_creak.peak.toFixed(3));
      }
      /* 罠の音は「音イベントが起きた」と分かる強さ（通常の足音より大きい） */
      if (c.step_walk) {
        var weak = [];
        for (var w = 0; w < gates.length; w++) {
          var mw = c[gates[w][0]];
          if (mw && !(mw.rms > c.step_walk.rms)) weak.push(gates[w][0]);
        }
        t.ok(weak.length === 0, 'P4.10b 音レンダ: どの罠音も通常の足音より大きい',
          weak.join(',') || ('足音 rms=' + c.step_walk.rms.toFixed(4)));
      }
      /* 種類ごとに音色が違う（同じ波形を使い回していない） */
      var same = 0;
      for (var q2 = 0; q2 < gates.length; q2++) {
        for (var q3 = q2 + 1; q3 < gates.length; q3++) {
          var A1 = c[gates[q2][0]], B1 = c[gates[q3][0]];
          if (A1 && B1 && Math.abs(A1.rms - B1.rms) < 1e-6) same++;
        }
      }
      t.ok(same === 0, 'P4.10b 音レンダ: 罠の種類ごとに音色が異なる', same + '組が同一');
    }
    g.reset();
  }

  /* ================================================================
   * 組み込み（js/enemy_ai.js と同じ流儀。game.js 側は if (this.traps) で呼ぶだけ）
   * ============================================================== */
  function install() {
    var g = ESCAPE.game;
    if (!g || !g.scene || g.traps) return;
    g.traps = new Traps(g);

    /* 検証フック（機械テスト・E2E用） */
    global.__trapDebug = {
      tuning: TRAP_TUNING,
      traps: function () { return ESCAPE.game.traps; },
      info: function () {
        var tr = ESCAPE.game.traps;
        return {
          total: tr.list.length, own: tr.own.length, props: tr.props.length,
          byKind: tr.countByKind(), density: tr.density(),
          corridor: tr.corridorCells().length, openings: tr.bandOpenings().length,
          fired: tr.fired, firedByKind: tr.firedByKind, topples: tr.topples
        };
      },
      /** 罠を1つ鳴らす（E2E で敵の反応を見る） */
      fire: function (idOrIndex) {
        var tr = ESCAPE.game.traps;
        for (var i = 0; i < tr.own.length; i++) {
          if (tr.own[i].id === idOrIndex || i === idOrIndex) return tr.fire(tr.own[i]);
        }
        return null;
      },
      /** 種類ごとに「見に行ける」罠の座標を返す（スクショ用） */
      spots: function (kind) {
        var tr = ESCAPE.game.traps, out = [];
        for (var i = 0; i < tr.own.length; i++) {
          if (tr.own[i].kind === kind) out.push({ col: tr.own[i].col, row: tr.own[i].row, id: tr.own[i].id });
        }
        return out;
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  ESCAPE.__extraSuites.push(
    testTrapKindsAndTuning,
    testTrapPlacement,
    testTrapBandOpenings,
    testTrapDoesNotBlockEscape,
    testTrapPropAgainstWall,
    testTrapPropToppleCoverage,
    testTrapMeshes,
    testTrapStepKinds,
    testTrapWireCrouch,
    testTrapPropTopple,
    testTrapAlertsBothEnemies,
    testTrapInterruptSafety,
    testTrapAudio
  );
})(window);
