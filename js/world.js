/* ESCAPE — グリッドマップの造形・質感・照明（P2）
 *
 * 方針（DESIGN.md §2「iPhoneで実用フレームレート」）:
 *  - 実ライトは0本。蛍光灯の明かりは**頂点色に焼き込む**（ライトマップ相当）。
 *    材質は MeshBasicMaterial（map × vertexColors）のみ＝ライト数に依存しない。
 *  - チラつく蛍光灯だけ、その周囲の面を加算合成の「光溜まりメッシュ」として重ね、
 *    マテリアル色1個を毎フレーム変えることで明滅させる（頂点バッファの再送なし）。
 *  - 面は種別ごとに1つのマージ済みジオメトリにまとめる（ドローコール20前後）。
 *  - 什器はグリッド上の実体マス（solid）に置く。歩けるマスに置くとすり抜けるため、
 *    歩けるマスには「床デカール」「壁付け(突出0.3m以下)」「天井付け(高さ2.2m以上)」しか置かない。
 *    プレイヤー半径0.32mなので、この規則を守る限り小道具にめり込まない。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  var FOG_COLOR = 0x05070a;

  /* ---- 照明パラメータ（契約 §3「明るい場所が例外」） ---- */
  var LIGHT_R = 7.6;                       /* 蛍光灯の到達半径(m)。狭くして光溜まりを締める */
  var LIGHT_DROP = 0.14;                   /* 天井から発光面までの下がり(m) */
  var LIGHT_GAIN = 0.80;                   /* 光溜まりの中心の強さ */
  var LIGHT_WRAP = 0.20;                   /* 法線に関係なく回り込む分（壁が黒く落ちすぎないように） */
  var FLOOR_LEVEL = 0.80;                  /* 床は真上から照らされて浮きやすいので落とす */
  var LAMP_EMIT = 0.55;                    /* 発光面そのものの明るさ（白飛び3%未満のため抑える） */
  var VIS_STEP = 1.0;                      /* 遮蔽マップの格子間隔(m) */
  var AMBIENT = { r: 0.0105, g: 0.0122, b: 0.0165 };
  var FLICKER_BAKE = 0.26;                 /* チラつき灯を焼き込む割合（残りは加算メッシュ） */
  var LAMP_COLORS = [
    { r: 0.86, g: 0.93, b: 1.00 },         /* 標準の蛍光灯 */
    { r: 0.90, g: 1.00, b: 0.92 },         /* 少し青緑に振れた古い管 */
    { r: 1.00, g: 0.96, b: 0.86 }          /* 暖色に劣化した管 */
  ];
  var EMERG_COLOR = { r: 1.00, g: 0.20, b: 0.14 };
  var EMERG_R = 8.6;                       /* 非常灯の到達半径(m) */
  var EMERG_GAIN = 0.52;                   /* 非常灯の強さ（P4.9: 拘束区画の赤が主役になる強さ） */

  /* 灯の間引き。通路は LAMP_SPACING マス(=6m)に1本 */
  var LAMP_SPACING = 3;
  /* P4.9: 80x80 のブレイド迷路は1マス幅の通路と角が多く、同じ設定だと光がほとんど届かない。
   * 消灯帯を薄くし、到達半径と環境光を上げて契約 §3 の輝度ゲート（暗部35〜65%）に合わせた。
   * 数値は LIGHT_TUNING に集約する（P7 で再調整する前提）。 */
  var OFF_LEVEL = 0.30;                    /* 帯状ノイズがこの値未満なら消灯＝消灯帯 */
  var FLICKER_LEVEL = 0.47;                 /* 点灯器具の20%以上が明滅になるよう広めに取る */
  var BLACK_MARGIN = 2;                     /* 漆黒区画の周囲何マスまで消灯させるか */
  var FLICKER_GROUPS = 8;                   /* 明滅は8グループに束ねて描画コールを抑える
                                               （4パターン x 2位相。近接する器具は別グループ） */

  /* ---- AO（環境遮蔽）パラメータ・契約 §3 ---- */
  var AO_STEP = 0.25;                      /* 遮蔽率フィールドの格子(m) */
  var AO_RADIUS = 0.75;                    /* 遮蔽を集める半径(m)＝接地の暗がりの幅 */
  var AO_FLOOR_K = 0.86;                   /* 床・天井の効き */
  var AO_WALL_K = 0.80;                    /* 壁（隅）の効き */
  var AO_MIN = 0.20;                       /* 下限（真っ黒にはしない） */
  var AO_WALL_BASE = 0.26;                 /* 平坦な壁面での遮蔽率＝ここを基準に隅だけ落とす */
  var AO_VERT = 0.62;                      /* 壁の床際・天井際の落とし幅(m) */

  /* ================================================================
   * 区画（帯）ごとの景観（DESIGN.md §4「エリア1 新マップ Z4」＞区画ごとの景観差）
   *   A 受入 : 青白い蛍光灯・事務的な白壁・掲示物
   *   B 実験 : 白タイル・明滅多め・実験台・ガラス器具
   *   C 検体 : 緑の微発光（タンク・培養液）・湿った床
   *   D 拘束 : 赤い非常灯・鉄格子・拘束具
   *   E 記録 : 木製什器・暖色の卓上灯・書類の山
   *   F 機械 : 配管・蒸気・オレンジの警告灯・金属床（足音が変わる）
   * ============================================================== */

  /* 床・壁のテクスチャを区画ごとに差し替える。walls は3枚を混ぜる（§3「壁テクスチャ3種以上」） */
  var ZONE_TEX = {
    A: { floor: 'floor',      walls: ['wallPaint', 'wall2', 'wallPaint'] },
    B: { floor: 'floorTile',  walls: ['wall', 'wall2', 'wall3'] },
    C: { floor: 'floorWet',   walls: ['wall3', 'wallPaint', 'wall2'] },
    D: { floor: 'floorWet',   walls: ['wallPaint', 'wallMetal', 'wall2'] },
    E: { floor: 'floor',      walls: ['wallPaint', 'wall2', 'wall'] },
    F: { floor: 'floorMetal', walls: ['wallMetal', 'wallPaint', 'wall3'] }
  };
  var DEFAULT_TEX = ZONE_TEX.A;

  /* 区画の基調色（床 f / 壁・天井 w）。部屋ごとの上書きは REGION_TINT が優先 */
  var ZONE_TINT = {
    A: { f: [1.00, 1.00, 1.02], w: [1.02, 1.03, 1.06] },   /* 事務的な白 */
    B: { f: [0.94, 1.00, 1.02], w: [0.97, 1.02, 1.05] },   /* 白タイル・やや青白 */
    C: { f: [0.76, 0.94, 0.84], w: [0.80, 0.96, 0.88] },   /* 湿った緑白 */
    D: { f: [0.96, 0.86, 0.84], w: [0.92, 0.88, 0.87] },   /* 彩度を抜いた灰（色は赤い非常灯が付ける） */
    E: { f: [1.04, 0.96, 0.84], w: [1.06, 0.98, 0.86] },   /* 古い書類の暖色 */
    F: { f: [0.86, 0.88, 0.90], w: [0.88, 0.90, 0.93] }    /* 鋼と配管の冷たい灰 */
  };

  /* 区画ごとの蛍光灯の色温度（契約の言語どおり）。glow / emergency には掛けない */
  var ZONE_LAMP = {
    A: { r: 0.80, g: 0.90, b: 1.00 },   /* 青白い蛍光灯 */
    B: { r: 0.92, g: 0.99, b: 1.00 },   /* 実験室の白 */
    C: { r: 0.72, g: 1.00, b: 0.86 },   /* 緑に振れた古い管 */
    D: { r: 1.00, g: 0.58, b: 0.50 },   /* 非常灯に寄った赤み */
    E: { r: 1.00, g: 0.92, b: 0.76 },   /* 暖色の卓上灯に寄せる */
    F: { r: 1.00, g: 0.82, b: 0.54 }    /* オレンジの警告灯 */
  };
  /* 区画ごとの明滅比率の底上げ（B 実験区画は「明滅多め」が契約） */
  var ZONE_FLICKER = { A: 0.00, B: 0.10, C: 0.03, D: 0.05, E: 0.00, F: 0.04 };
  /* 区画ごとの消灯帯のずらし（負＝点く器具が増える）と明るさの倍率。
   * 契約 §3 の輝度ゲート（暗部35〜65%）を**区画単位で**満たすためのキャリブレーション値。 */
  var ZONE_OFF = { A: 0.11, B: 0.03, C: -0.06, D: -0.22, E: -0.09, F: -0.14 };
  var ZONE_GAIN = { A: 0.84, B: 0.98, C: 1.10, D: 1.42, E: 1.12, F: 1.20 };

  /* 部屋ごとの色味の上書き（区画の基調からさらに振る＝似た交差点が続かない） */
  var REGION_TINT = {
    director: { f: [1.06, 0.94, 0.76], w: [1.10, 0.97, 0.78] },   /* 所長室＝木質の暖色 */
    office:   { f: [1.04, 0.96, 0.84], w: [1.08, 0.99, 0.86] },   /* 記録室＝古い書類 */
    control:  { f: [0.84, 0.90, 1.06], w: [0.86, 0.93, 1.09] },   /* 観察室＝青白 */
    pump:     { f: [0.80, 0.86, 0.90], w: [0.84, 0.90, 0.95] },   /* ポンプ室＝鋼 */
    store:    { f: [0.94, 0.92, 0.86], w: [0.98, 0.95, 0.88] },   /* 保管庫＝乾いた倉庫 */
    elec:     { f: [0.90, 0.86, 0.78], w: [0.94, 0.89, 0.80] },   /* 電気室 */
    cellroom: { f: [0.94, 0.84, 0.82], w: [0.90, 0.85, 0.84] },   /* 拘束室＝灰（赤い非常灯で染まる） */
    guardpost:{ f: [0.92, 0.86, 0.84], w: [0.90, 0.86, 0.85] },
    visitroom:{ f: [0.94, 0.86, 0.84], w: [0.92, 0.86, 0.85] },
    labB:     { f: [0.96, 1.02, 1.04], w: [0.99, 1.04, 1.07] },   /* 処置室＝白タイル */
    labA:     { f: [1.00, 0.96, 0.86], w: [1.02, 0.99, 0.90] },   /* 培養器室＝琥珀 */
    assay:    { f: [0.94, 1.00, 1.02], w: [0.97, 1.03, 1.05] },
    machine:  { f: [0.70, 0.92, 0.80], w: [0.74, 0.94, 0.84] },   /* 検体タンク室＝冷たい緑白 */
    specimen: { f: [1.02, 0.94, 0.80], w: [1.05, 0.96, 0.82] },   /* 飼育檻室＝黄ばんだ白 */
    necro:    { f: [0.78, 0.94, 0.86], w: [0.82, 0.96, 0.90] },
    hall:     { f: [1.02, 1.02, 1.00], w: [1.06, 1.06, 1.04] },   /* 受入ホール＝明るい白 */
    quaran:   { f: [0.98, 1.00, 1.02], w: [1.01, 1.03, 1.05] },
    security: { f: [0.90, 0.94, 1.04], w: [0.92, 0.96, 1.07] },
    lmA:      { f: [1.02, 1.00, 0.96], w: [1.06, 1.04, 0.99] },   /* 南の受入長廊下 */
    lmB:      { f: [0.90, 1.00, 1.02], w: [0.92, 1.03, 1.06] },   /* 実験区画の中央長廊下 */
    lmC:      { f: [0.94, 0.88, 0.74], w: [0.98, 0.91, 0.76] }    /* 機械区画の長回廊＝アンバー */
  };
  var DEFAULT_TINT = { f: [0.92, 0.93, 0.92], w: [0.96, 0.97, 0.97] };

  /* ---- UVの向き替え（同じテクスチャの反復が目立たないようにする） ---- */
  /** 床・天井用: 90度単位の回転＋反転（8通り） */
  function uvVariant(seed) {
    var k = (seed * 8) | 0;
    var rot = k & 3, flip = (k & 4) !== 0;
    return function (s, t) {
      var u = s, v = t;
      if (flip) u = 1 - u;
      for (var i = 0; i < rot; i++) { var nu = v, nv = 1 - u; u = nu; v = nv; }
      return [u, v];
    };
  }
  /** 壁用: 上下は変えられないので左右反転のみ（2通り） */
  function uvFlipU(seed) {
    if (seed < 0.5) return null;
    return function (s, t) { return [1 - s, t]; };
  }

  /** 面（法線 m）に貼る1枚板。cx,cy,cz は板の中心。 */
  function facePanel(builder, cx, cy, cz, m, w, h, shade, uvf) {
    var ux = m[2], uz = -m[0];
    builder.grid([cx - ux * w / 2, cy - h / 2, cz - uz * w / 2],
      [ux * w, 0, uz * w], [0, h, 0], 1, 1, 1, 1, shade, uvf);
  }
  /** n x n アトラスの (i,j) セルを引くUV関数（j=0 が上段） */
  function atlasUV(i, j, n) {
    var s = 1 / n;
    return function (u, v) { return [(i + u) * s, (n - 1 - j + v) * s]; };
  }
  /** nx x ny アトラス版（P4.8 区画銘板は 3x2） */
  function atlasUVR(i, j, nx, ny) {
    return function (u, v) { return [(i + u) / nx, (ny - 1 - j + v) / ny]; };
  }
  /** 一定色（自発光面用） */
  function flat(rgb) { return function () { return rgb; }; }

  var FACE_VEC = { n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0] };

  /* ---- 決定的ハッシュ ---- */
  function hash2(a, b) {
    var h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ================================================================
   * ジオメトリ組み立て
   * ============================================================== */
  /* 小道具を描くときの床高さオフセット。マスごとに setYBias() して戻す。
   * （床・壁・天井は deform で1頂点ずつ高さを引くので bias は使わない） */
  var Y_BIAS = 0;
  function setYBias(v) { Y_BIAS = v; }

  function Builder() {
    this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0;
  }
  Builder.prototype.isEmpty = function () { return this.n === 0; };

  /**
   * 分割した平面を1枚追加する。
   * o=起点, u/v=辺ベクトル（全長）, nu/nv=分割数, uRep/vRep=UVの繰り返し数,
   * nrm=法線, shade(px,py,pz)->[r,g,b] 頂点色
   * cross(u,v) が nrm と同じ向きになるように渡すこと（表裏が反転する）。
   */
  Builder.prototype.grid = function (o, u, v, nu, nv, uRep, vRep, shade, uvf, deform) {
    var sa = [], ta = [], i;
    for (i = 0; i <= nu; i++) sa.push(i / nu);
    for (i = 0; i <= nv; i++) ta.push(i / nv);
    this.gridP(o, u, v, sa, ta, uRep, vRep, shade, uvf, deform);
  };

  /**
   * grid の分割位置を明示する版。端に細かい行を入れて接地のAOを効かせる。
   * sArr / tArr は 0..1 の昇順配列。
   */
  Builder.prototype.gridP = function (o, u, v, sArr, tArr, uRep, vRep, shade, uvf, deform) {
    var base = this.n;
    var nu = sArr.length - 1, nv = tArr.length - 1;
    for (var j = 0; j <= nv; j++) {
      var t = tArr[j];
      for (var i = 0; i <= nu; i++) {
        var s = sArr[i];
        var x = o[0] + u[0] * s + v[0] * t;
        var y = o[1] + u[1] * s + v[1] * t;
        var z = o[2] + u[2] * s + v[2] * t;
        if (deform) y = deform(x, z, t, s);
        y += Y_BIAS;
        this.pos.push(x, y, z);
        if (uvf) { var q = uvf(s, t); this.uv.push(q[0] * uRep, q[1] * vRep); }
        else this.uv.push(s * uRep, t * vRep);
        var c = shade(x, y, z);
        this.col.push(c[0], c[1], c[2]);
        this.n++;
      }
    }
    var w = nu + 1;
    for (var jj = 0; jj < nv; jj++) {
      for (var ii = 0; ii < nu; ii++) {
        var a = base + jj * w + ii, b2 = a + 1, c2 = a + w, d = c2 + 1;
        this.idx.push(a, b2, c2, b2, d, c2);
      }
    }
  };

  /** 軸並行の直方体。shade(px,py,pz,nx,ny,nz) */
  Builder.prototype.box = function (cx, cy, cz, sx, sy, sz, uvS, shade) {
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    var x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    var self = this;
    function f(o, u, v, nx, ny, nz, ur, vr) {
      self.grid(o, u, v, 1, 1, ur, vr, function (x, y, z) { return shade(x, y, z, nx, ny, nz); });
    }
    f([x1, y0, z1], [0, 0, -sz], [0, sy, 0], 1, 0, 0, sz * uvS, sy * uvS);   /* +X */
    f([x0, y0, z0], [0, 0, sz], [0, sy, 0], -1, 0, 0, sz * uvS, sy * uvS);   /* -X */
    f([x0, y1, z1], [sx, 0, 0], [0, 0, -sz], 0, 1, 0, sx * uvS, sz * uvS);   /* +Y */
    f([x0, y0, z0], [sx, 0, 0], [0, 0, sz], 0, -1, 0, sx * uvS, sz * uvS);   /* -Y */
    f([x0, y0, z1], [sx, 0, 0], [0, sy, 0], 0, 0, 1, sx * uvS, sy * uvS);    /* +Z */
    f([x1, y0, z0], [-sx, 0, 0], [0, sy, 0], 0, 0, -1, sx * uvS, sy * uvS);  /* -Z */
  };

  /** 角柱（配管）。p0->p1、半径r、seg角。 */
  Builder.prototype.tube = function (p0, p1, r, seg, shade) {
    var ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    var len = Math.hypot(ax, ay, az);
    if (len < 1e-6) return;
    ax /= len; ay /= len; az /= len;
    /* 軸に直交する2ベクトル */
    var ux, uy, uz;
    if (Math.abs(ay) < 0.9) { ux = -az; uy = 0; uz = ax; } else { ux = 1; uy = 0; uz = 0; }
    var ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    var vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    var base = this.n;
    for (var k = 0; k <= seg; k++) {
      var a = k / seg * Math.PI * 2;
      var ca = Math.cos(a), sa = Math.sin(a);
      var nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
      for (var e = 0; e < 2; e++) {
        var px = (e ? p1[0] : p0[0]) + nx * r;
        var py = (e ? p1[1] : p0[1]) + ny * r;
        var pz = (e ? p1[2] : p0[2]) + nz * r;
        py += Y_BIAS;
        this.pos.push(px, py, pz);
        this.uv.push(k / seg * 2, e * len * 0.5);
        var c = shade(px, py, pz, nx, ny, nz);
        this.col.push(c[0], c[1], c[2]);
        this.n++;
      }
    }
    for (var k2 = 0; k2 < seg; k2++) {
      var i0 = base + k2 * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
      this.idx.push(i0, i2, i1, i1, i2, i3);
    }
  };

  function buildMesh(b, material) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
    geo.setIndex(b.idx);
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, material);
  }

  /* ================================================================
   * World
   * ============================================================== */
  function World(map) {
    this.map = map;
    this.group = new THREE.Group();
    this.disposables = [];
    this.flickers = [];
    this.stats = { triangles: 0, drawGroups: 0, fixtures: 0, buildMs: 0 };
    this._build();
  }

  World.prototype._track = function (o) { this.disposables.push(o); return o; };

  /* ---------------- AO（環境遮蔽）----------------
   * 実体マスを 0.25m 格子のマスクにし、積分画像で「半径0.75m以内が
   * どれだけ塞がっているか」を O(1) で引けるようにする。
   * 壁の根元・什器の際・部屋の隅が自動的に濃くなる（什器も実体マスなので同じ式で効く）。
   */
  World.prototype._bakeAO = function () {
    var map = this.map, T = map.tileSize, S = AO_STEP;
    var gw = Math.ceil(map.width * T / S) + 1;
    var gh = Math.ceil(map.height * T / S) + 1;
    var mask = new Float32Array(gw * gh);
    for (var j = 0; j < gh; j++) {
      var z = (j + 0.5) * S;
      var r = map.rowOf(z);
      for (var i = 0; i < gw; i++) {
        var x = (i + 0.5) * S;
        mask[j * gw + i] = map.isSolid(map.colOf(x), r) ? 1 : 0;
      }
    }
    /* 積分画像 (gw+1) x (gh+1) */
    var sat = new Float32Array((gw + 1) * (gh + 1));
    for (var jj = 0; jj < gh; jj++) {
      var rowSum = 0;
      for (var ii = 0; ii < gw; ii++) {
        rowSum += mask[jj * gw + ii];
        sat[(jj + 1) * (gw + 1) + (ii + 1)] = sat[jj * (gw + 1) + (ii + 1)] + rowSum;
      }
    }
    this._ao = { sat: sat, gw: gw, gh: gh, S: S, rad: Math.max(1, Math.round(AO_RADIUS / S)) };
  };

  /** (x,z) を中心とした正方領域の実体率 0..1 */
  World.prototype._coverage = function (x, z) {
    var a = this._ao, gw = a.gw, gh = a.gh, S = a.S, R = a.rad;
    var ci = Math.floor(x / S), cj = Math.floor(z / S);
    var i0 = ci - R, i1 = ci + R + 1, j0 = cj - R, j1 = cj + R + 1;
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
    if (i1 > gw) i1 = gw; if (j1 > gh) j1 = gh;
    var w = i1 - i0, h = j1 - j0;
    if (w <= 0 || h <= 0) return 1;
    var st = gw + 1;
    var s = sat_(a.sat, st, i1, j1) - sat_(a.sat, st, i0, j1) - sat_(a.sat, st, i1, j0) + sat_(a.sat, st, i0, j0);
    return s / (w * h);
  };
  function sat_(sat, stride, i, j) { return sat[j * stride + i]; }

  /** 床・天井のAO（水平方向の遮蔽） */
  World.prototype._aoFloor = function (x, z) {
    var cov = this._coverage(x, z);
    var k = cov / 0.60;
    if (k > 1) k = 1;
    var ao = 1 - AO_FLOOR_K * k;
    return ao < AO_MIN ? AO_MIN : ao;
  };

  /** 壁面のAO。面から少し前へ出した点で測り、平坦な壁ぶんを差し引いて隅だけ落とす */
  World.prototype._aoWall = function (x, y, z, nx, nz, fy, ch) {
    var cov = this._coverage(x + nx * 0.34, z + nz * 0.34);
    var k = (cov - AO_WALL_BASE) / 0.34;
    if (k < 0) k = 0; if (k > 1) k = 1;
    var ao = 1 - AO_WALL_K * k;
    /* 床際・天井際（そのマスのローカルな床/天井で測る） */
    if (fy === undefined) fy = 0;
    if (ch === undefined) ch = this.map.wallHeight;
    var vy = Math.min(y - fy, fy + ch - y);
    var vk = vy / AO_VERT;
    if (vk > 1) vk = 1;
    ao *= 0.38 + 0.62 * vk;
    return ao < AO_MIN ? AO_MIN : ao;
  };

  /* ---------------- 照明 ---------------- */

  /** 2点間（水平面）に実体マスがあるか。始点・終点のマスは無視する */
  World.prototype._blocked = function (x0, z0, x1, z1) {
    var map = this.map, T = map.tileSize;
    var dx = x1 - x0, dz = z1 - z0;
    var dist = Math.hypot(dx, dz);
    var steps = Math.ceil(dist / (T * 0.25));
    if (steps < 1) return false;
    var c0 = map.colOf(x0), r0 = map.rowOf(z0), c1 = map.colOf(x1), r1 = map.rowOf(z1);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var c = map.colOf(x0 + dx * t), r = map.rowOf(z0 + dz * t);
      if ((c === c0 && r === r0) || (c === c1 && r === r1)) continue;
      if (map.isSolid(c, r)) return true;
    }
    return false;
  };

  /** 低周波の帯ノイズ（0..1）。消灯が塊で起きる＝「消灯帯」を作るために使う */
  function bandNoise(c, r) {
    var S = 7.0;
    var fx = c / S, fz = r / S;
    var i = Math.floor(fx), j = Math.floor(fz);
    var tx = fx - i, tz = fz - j;
    tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
    var a = hash2(i, j), b = hash2(i + 1, j), cc = hash2(i, j + 1), d = hash2(i + 1, j + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (cc * (1 - tx) + d * tx) * tz;
  }

  function inZones(zs, col, row) {
    for (var i = 0; i < zs.length; i++) {
      var z = zs[i];
      if (col >= z.c0 && col <= z.c1 && row >= z.r0 && row <= z.r1) return z.id;
    }
    return null;
  }
  World.prototype._inDarkZone = function (col, row) {
    return inZones((this.map.meta && this.map.meta.darkZones) || [], col, row);
  };
  /** 漆黒区画（非常灯すら置かない・輝度40未満95%以上を狙う短い直線区間）
   *  margin を付けると「周囲の器具も消す」判定になる（漏れ光を止める） */
  World.prototype._inBlackZone = function (col, row, margin) {
    var zs = (this.map.meta && this.map.meta.blackZones) || [];
    var mg = margin || 0;
    for (var i = 0; i < zs.length; i++) {
      var z = zs[i];
      if (col >= z.c0 - mg && col <= z.c1 + mg && row >= z.r0 - mg && row <= z.r1 + mg) return z.id;
    }
    return null;
  };
  /** 明滅だけで照らされる通路 */
  World.prototype._inFlickerZone = function (col, row) {
    return inZones((this.map.meta && this.map.meta.flickerZones) || [], col, row);
  };

  /** 蛍光灯・非常灯の自動配置＋状態決定 */
  World.prototype._placeFixtures = function () {
    var map = this.map, T = map.tileSize;
    var list = [];
    function walk(c, r) { return map.isWalkable(c, r); }
    /** 2x2 が全て通行可＝「広い場所」。通路のルールと分ける */
    function openAt(c, r) {
      for (var oc = c - 1; oc <= c; oc++) {
        for (var orr = r - 1; orr <= r; orr++) {
          if (walk(oc, orr) && walk(oc + 1, orr) && walk(oc, orr + 1) && walk(oc + 1, orr + 1)) return true;
        }
      }
      return false;
    }
    for (var r = 0; r < map.height; r++) {
      for (var c = 0; c < map.width; c++) {
        if (!walk(c, r)) continue;
        var ns = !walk(c - 1, r) && !walk(c + 1, r);
        var ew = !walk(c, r - 1) && !walk(c, r + 1);
        var put;
        if (openAt(c, r)) put = (c % 3 === 1 && r % 3 === 1);      /* 部屋・広場 */
        else if (ns && !ew) put = (r % LAMP_SPACING === 1);
        else if (ew && !ns) put = (c % LAMP_SPACING === 1);
        else put = true;                                           /* 角・交差点 */
        if (!put) continue;
        var state;
        if (this._inBlackZone(c, r, BLACK_MARGIN)) {
          state = 'off';                                /* 漆黒区画（周囲2マスの漏れ光も止める） */
        } else if (this._inFlickerZone(c, r)) {
          state = 'flicker';                            /* 明滅だけの通路 */
        } else if (this._inDarkZone(c, r)) {
          state = 'off';                                /* 闇だまり */
        } else {
          var v = bandNoise(c, r);
          var zz = this._zoneAt(c, r);
          var offL = OFF_LEVEL + (ZONE_OFF[zz] || 0);
          var fl = offL + (FLICKER_LEVEL - OFF_LEVEL) + (ZONE_FLICKER[zz] || 0);
          state = (v < offL) ? 'off' : ((v < fl) ? 'flicker' : 'on');
        }
        /* 区画ごとの色温度（契約 §4「区画ごとの景観差」）。管の劣化で更に個体差をつける */
        var zl = ZONE_LAMP[this._zoneAt(c, r)] || LAMP_COLORS[0];
        var wob = (hash2(c + 5, r + 3) < 0.20) ? -0.08 : ((hash2(c + 91, r + 7) < 0.12) ? 0.07 : 0.00);
        var lampCol = { r: Math.min(1, zl.r * (1 + wob)), g: Math.min(1, zl.g), b: Math.min(1, zl.b * (1 - wob)) };
        var fy = map.cellFloorY(c, r), ch = map.ceilHAt(c, r);
        list.push({
          kind: 'lamp',
          col: c, row: r, x: (c + 0.5) * T, z: (r + 0.5) * T,
          fy: fy, ch: ch, y: fy + ch - LIGHT_DROP,
          state: state, color: lampCol, R: LIGHT_R, gain: LIGHT_GAIN * (ZONE_GAIN[this._zoneAt(c, r)] || 1),
          axis: ns ? 'z' : 'x', phase: hash2(c * 3 + 1, r * 7 + 2) * 6.283
        });
      }
    }
    /* 作為的な上書き（最寄りの器具に適用） */
    var ov = (map.meta && map.meta.lightOverrides) || [];
    for (var o = 0; o < ov.length; o++) {
      var best = -1, bd = 1e9;
      for (var i = 0; i < list.length; i++) {
        var d = Math.abs(list[i].col - ov[o].col) + Math.abs(list[i].row - ov[o].row);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0 && bd <= 3) {
        list[best].state = ov[o].state;
        /* gain/reach は「ここだけは明るく」を作るための局所ブースト */
        if (ov[o].gain) list[best].gain = LIGHT_GAIN * (ZONE_GAIN[this._zoneAt(list[best].col, list[best].row)] || 1) * ov[o].gain;
        if (ov[o].reach) list[best].R = LIGHT_R * ov[o].reach;
      }
    }
    /* 非常灯: 闇だまりでも「向こうに何かある」ことだけは分かる微光。漆黒区画には置かない */
    var em = (map.meta && map.meta.emergency) || [];
    for (var e = 0; e < em.length; e++) {
      var ec = em[e].col, er = em[e].row;
      if (!map.isWalkable(ec, er) || this._inBlackZone(ec, er, BLACK_MARGIN)) continue;
      var efy = map.cellFloorY(ec, er);
      list.push({
        kind: 'emergency',
        col: ec, row: er, fy: efy, ch: map.ceilHAt(ec, er),
        x: (ec + 0.5) * T, z: (er + 0.5) * T, y: efy + 2.28,
        state: 'on', color: EMERG_COLOR, R: EMERG_R, gain: EMERG_GAIN,
        axis: 'x', phase: 0
      });
    }
    /* 器具以外の光源（検体タンクの液体・手術灯・モニタ壁・卓上灯）。
     * 天井灯とは別枠で、什器マス（solid）にも置ける。明滅比率の母数には数えない。 */
    var ex = (map.meta && map.meta.extraLights) || [];
    for (var g = 0; g < ex.length; g++) {
      var e2 = ex[g];
      var gfy = map.cellFloorY(e2.col, e2.row);
      list.push({
        kind: 'glow',
        col: e2.col, row: e2.row, fy: gfy, ch: map.ceilHAt(e2.col, e2.row),
        x: (e2.col + 0.5) * T, z: (e2.row + 0.5) * T,
        y: gfy + (e2.y === undefined ? 1.5 : e2.y),
        state: e2.state || 'on',
        color: { r: e2.rgb[0], g: e2.rgb[1], b: e2.rgb[2] },
        R: e2.R || 5.0, gain: e2.gain === undefined ? 0.30 : e2.gain,
        axis: 'x', phase: 0
      });
    }
    return list;
  };

  /**
   * 明滅器具をグループに割り当てる。近く（18m以内）の器具は別グループにして
   * 同じ点滅が並んで見えないようにする。グループ数だけ加算メッシュが増える。
   */
  World.prototype._assignFlickerGroups = function () {
    var fx = this.fixtures, placed = [];
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      if (f.state !== 'flicker') continue;
      var taken = Object.create(null);
      for (var j = 0; j < placed.length; j++) {
        var p = placed[j];
        if (Math.hypot(p.x - f.x, p.z - f.z) < 18) taken[p.fgroup] = true;
      }
      var start = (hash2(f.col * 7 + 1, f.row * 5 + 3) * FLICKER_GROUPS) | 0;
      var g = start;
      for (var k = 0; k < FLICKER_GROUPS; k++) {
        var cand = (start + k) % FLICKER_GROUPS;
        if (!taken[cand]) { g = cand; break; }
      }
      f.fgroup = g;
      placed.push(f);
    }
  };

  /**
   * 器具ごとに「遮蔽マップ」を焼く。VIS_STEP刻みの格子で可視/不可視を求め、
   * 3x3で1度ぼかしてから頂点位置でバイリニア補間する。
   * ＝マス単位の二値判定にすると影の境界がマス目に沿って角張るのを防ぐ。
   */
  World.prototype._bakeVisibility = function (f) {
    var S = VIS_STEP, pad = f.R + S;
    var x0 = Math.floor((f.x - pad) / S) * S, z0 = Math.floor((f.z - pad) / S) * S;
    var w = Math.ceil((pad * 2) / S) + 1, h = w;
    var raw = new Float32Array(w * h);
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var px = x0 + i * S, pz = z0 + j * S;
        raw[j * w + i] = this._blocked(f.x, f.z, px, pz) ? 0 : 1;
      }
    }
    var vis = new Float32Array(w * h);
    for (var jj = 0; jj < h; jj++) {
      for (var ii = 0; ii < w; ii++) {
        var sum = 0, n = 0;
        for (var dj = -1; dj <= 1; dj++) {
          for (var di = -1; di <= 1; di++) {
            var a = ii + di, b = jj + dj;
            if (a < 0 || b < 0 || a >= w || b >= h) continue;
            var wgt = (di === 0 && dj === 0) ? 2 : 1;
            sum += raw[b * w + a] * wgt; n += wgt;
          }
        }
        vis[jj * w + ii] = sum / n;
      }
    }
    f.vis = vis; f.vx0 = x0; f.vz0 = z0; f.vw = w; f.vh = h;
  };

  World.prototype._visAt = function (f, x, z) {
    var S = VIS_STEP;
    var fx = (x - f.vx0) / S, fz = (z - f.vz0) / S;
    var i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= f.vw - 1 || j >= f.vh - 1) return 0;
    var tx = fx - i, tz = fz - j;
    var v = f.vis, w = f.vw;
    var a = v[j * w + i], b = v[j * w + i + 1], c = v[(j + 1) * w + i], d = v[(j + 1) * w + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  /** マスごとに「届きうる」器具の索引（遮蔽は頂点ごとに評価する） */
  World.prototype._buildLightIndex = function () {
    var map = this.map, T = map.tileSize;
    var fx = this.fixtures;
    var idx = Object.create(null);
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      if (f.state === 'off') continue;
      this._bakeVisibility(f);
      var reach = Math.ceil(f.R / T) + 1;
      for (var dr = -reach; dr <= reach; dr++) {
        for (var dc = -reach; dc <= reach; dc++) {
          var c = f.col + dc, r = f.row + dr;
          if (!map.isWalkable(c, r)) continue;
          var cc = map.cellCenter(c, r);
          if (Math.hypot(cc.x - f.x, cc.z - f.z) > f.R + T) continue;
          /* マス内5点のどこかが見えていれば候補に入れる */
          var seen = false;
          var OFF = [[0, 0], [-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]];
          for (var s = 0; s < 5 && !seen; s++) {
            if (this._visAt(f, cc.x + OFF[s][0], cc.z + OFF[s][1]) > 0.02) seen = true;
          }
          if (!seen) continue;
          var k = c + ',' + r;
          (idx[k] || (idx[k] = [])).push(i);
        }
      }
    }
    return idx;
  };

  /** 実体マスの「照明の持ち主」＝隣接する歩行可能マス */
  World.prototype._ownerOf = function (col, row) {
    var map = this.map;
    if (map.isWalkable(col, row)) return col + ',' + row;
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      if (map.isWalkable(col + D[i][0], row + D[i][1])) return (col + D[i][0]) + ',' + (row + D[i][1]);
    }
    return col + ',' + row;
  };

  /**
   * 焼き込み用の明るさ。ownerKey のマスから見える器具だけを積算する。
   * skipIdx を渡すとその器具を除外（チラつき分の分離に使う）。
   * onlyIdx を渡すとその器具だけ（＝加算メッシュ用）。
   */
  World.prototype._shade = function (px, py, pz, nx, ny, nz, ownerKey, onlyIdx, out) {
    var lights = this.lightIndex[ownerKey];
    var r, g, b;
    if (onlyIdx === undefined) {
      /* 上向き面は床の反射を、下向き面は落ち込みを表現する */
      var up = (ny + 1) * 0.5;
      var amb = 0.62 + 0.5 * up;
      r = AMBIENT.r * amb; g = AMBIENT.g * amb; b = AMBIENT.b * amb;
    } else {
      r = g = b = 0;
    }
    if (lights) {
      for (var i = 0; i < lights.length; i++) {
        var fi = lights[i];
        if (onlyIdx !== undefined && fi !== onlyIdx) continue;
        var f = this.fixtures[fi];
        var dx = f.x - px, dy = f.y - py, dz = f.z - pz;
        var d = Math.hypot(dx, dy, dz);
        if (d > f.R) continue;
        var inv = 1 / (d + 1e-6);
        var ndl = (dx * nx + dy * ny + dz * nz) * inv;
        if (ndl < 0) ndl = 0;
        var vis = this._visAt(f, px, pz);
        if (vis <= 0.001) continue;
        var fall = 1 - d / f.R;
        fall = fall * fall * (0.35 + 0.65 * fall);   /* 光溜まりの縁を早く落とす */
        var k = fall * vis * (LIGHT_WRAP + (1 - LIGHT_WRAP) * ndl) * f.gain;
        if (f.state === 'flicker') {
          k *= (onlyIdx === undefined) ? FLICKER_BAKE : (1 - FLICKER_BAKE);
        } else if (onlyIdx !== undefined) {
          continue;
        }
        r += f.color.r * k; g += f.color.g * k; b += f.color.b * k;
      }
    }
    out[0] = r > 1 ? 1 : r; out[1] = g > 1 ? 1 : g; out[2] = b > 1 ? 1 : b;
    return out;
  };

  /* ---------------- 区画 ---------------- */

  World.prototype._regionAt = function (col, row) {
    var rs = (this.map.meta && this.map.meta.regions) || [];
    for (var i = 0; i < rs.length; i++) {
      var g = rs[i];
      if (col >= g.c0 && col <= g.c1 && row >= g.r0 && row <= g.r1) return g.id;
    }
    return null;
  };
  /** その位置の区画（A〜F）。meta.regions の zone → meta.bands の行レンジ の順で解決する */
  World.prototype._zoneAt = function (col, row) {
    var meta = this.map.meta || {};
    var rs = meta.regions || [];
    for (var i = 0; i < rs.length; i++) {
      var g = rs[i];
      if (!g.zone) continue;
      if (col >= g.c0 && col <= g.c1 && row >= g.r0 && row <= g.r1) return g.zone;
    }
    var bs = meta.bands || [];
    for (var b = 0; b < bs.length; b++) if (row >= bs[b].r0 && row <= bs[b].r1) return bs[b].zone;
    return 'A';
  };
  World.prototype._zoneTex = function (col, row) { return ZONE_TEX[this._zoneAt(col, row)] || DEFAULT_TEX; };
  World.prototype._tintAt = function (col, row) {
    var id = this._regionAt(col, row);
    if (id && REGION_TINT[id]) return REGION_TINT[id];
    return ZONE_TINT[this._zoneAt(col, row)] || DEFAULT_TINT;
  };

  /* ---------------- 本体 ---------------- */

  World.prototype._build = function () {
    var t0 = (global.performance ? performance.now() : Date.now());
    var map = this.map, T = map.tileSize, H = map.wallHeight;
    var TILE = ESCAPE.TILE;
    var self = this;

    this._bakeAO();
    this.fixtures = this._placeFixtures();
    this._assignFlickerGroups();
    this.lightIndex = this._buildLightIndex();
    this.stats.fixtures = this.fixtures.length;

    /* --- 空間チャンク × 素材 でメッシュを分ける（P4.9・80x80対応） ---
     * 80x80 を CHUNK マス角に切り、チャンクごとにマージ済みメッシュを作る。
     * 霧の到達は 15.5m ＝ 8マスなので、視錐台カリングで遠景のチャンクが丸ごと落ちる
     * （マップ全体を1メッシュにすると 41万三角形が毎フレーム描かれてしまう）。
     * B は「今のチャンク × 今の区画のテクスチャ」へ委譲するプロキシで、
     * 呼び出し側（B.floor.gridP(...) 等）は一切変えずに済む。 */
    var CHUNK = 12;
    var CHUNK_COLS = Math.ceil(map.width / CHUNK);
    var chunkBags = Object.create(null);
    var curChunk = 0, curZone = 'A';
    function chunkKey(col, row) {
      var cc2 = col < 0 ? 0 : (col >= map.width ? map.width - 1 : col);
      var rr2 = row < 0 ? 0 : (row >= map.height ? map.height - 1 : row);
      return ((rr2 / CHUNK) | 0) * CHUNK_COLS + ((cc2 / CHUNK) | 0);
    }
    /** これから積む面の所属（チャンクと区画）を決める。造形の直前に必ず呼ぶ */
    function bset(col, row) { curChunk = chunkKey(col, row); curZone = self._zoneAt(col, row); }
    self._bset = bset;
    function bag(texKey) {
      var g2 = chunkBags[curChunk] || (chunkBags[curChunk] = Object.create(null));
      return g2[texKey] || (g2[texKey] = new Builder());
    }
    var B = {};
    Object.defineProperty(B, 'floor', { get: function () { return bag((ZONE_TEX[curZone] || DEFAULT_TEX).floor); } });
    Object.defineProperty(B, 'wall', { get: function () { return bag((ZONE_TEX[curZone] || DEFAULT_TEX).walls[0]); } });
    Object.defineProperty(B, 'wall2', { get: function () { return bag((ZONE_TEX[curZone] || DEFAULT_TEX).walls[1]); } });
    Object.defineProperty(B, 'wall3', { get: function () { return bag((ZONE_TEX[curZone] || DEFAULT_TEX).walls[2]); } });
    ['ceil', 'litter', 'poster', 'sign', 'zonesign', 'metal', 'dark', 'lamp', 'screen',
      'paper', 'sheet', 'fluid', 'board', 'monitors', 'water', 'glass', 'hatch', 'blood']
      .forEach(function (n) {
        Object.defineProperty(B, n, { get: function () { return bag(n); } });
      });
    /* チラつきの加算メッシュはグループ単位（描画コールを抑える） */
    var flickBuilders = [];
    for (var fi = 0; fi < FLICKER_GROUPS; fi++) {
      flickBuilders.push({ floor: new Builder(), wall: new Builder(), lamp: new Builder() });
    }
    /** 器具index -> 加算ビルダー */
    function fbOf(fidx) {
      var f = self.fixtures[fidx];
      return (f && f.state === 'flicker') ? flickBuilders[f.fgroup] : null;
    }

    var scratch = [0, 0, 0];
    /** 小道具用の簡易AO: 足元ほど暗い（床との接地を締める） */
    function propAO(y) {
      var k = y / 0.95;
      if (k > 1) k = 1;
      if (k < 0) k = 0;
      return 0.42 + 0.58 * k;
    }
    /** shade関数を作る（tint × 接地AO） */
    function shader(ownerKey, tint, only) {
      return function (x, y, z, nx, ny, nz) {
        self._shade(x, y, z, nx, ny, nz, ownerKey, only, scratch);
        var a = propAO(y);
        return [scratch[0] * tint[0] * a, scratch[1] * tint[1] * a, scratch[2] * tint[2] * a];
      };
    }
    /** 法線固定版（平面用・AOなし） */
    function planeShader(ownerKey, tint, n, only) {
      return function (x, y, z) {
        self._shade(x, y, z, n[0], n[1], n[2], ownerKey, only, scratch);
        return [scratch[0] * tint[0], scratch[1] * tint[1], scratch[2] * tint[2]];
      };
    }
    /** 床・天井用（水平面のAOを焼き込む） */
    function floorShader(ownerKey, tint, n, only) {
      var lv = (n[1] > 0) ? FLOOR_LEVEL : 1;
      return function (x, y, z) {
        self._shade(x, y, z, n[0], n[1], n[2], ownerKey, only, scratch);
        var a = self._aoFloor(x, z) * lv;
        return [scratch[0] * tint[0] * a, scratch[1] * tint[1] * a, scratch[2] * tint[2] * a];
      };
    }
    /** 壁面用（隅と床際・天井際のAOを焼き込む）。fyFn はそのマスの床高さ */
    function wallShader(ownerKey, tint, n, only, fyBase, chLocal) {
      return function (x, y, z) {
        self._shade(x, y, z, n[0], n[1], n[2], ownerKey, only, scratch);
        var fy = (typeof fyBase === 'function') ? fyBase(x, z) : (fyBase || 0);
        var a = self._aoWall(x, y, z, n[0], n[2], fy, chLocal);
        return [scratch[0] * tint[0] * a, scratch[1] * tint[1] * a, scratch[2] * tint[2] * a];
      };
    }
    /* 端に細かい行を入れた分割（接地の暗がりを1マス内で解像する） */
    var FDIV = [0, 0.15, 0.5, 0.85, 1];
    var CDIV = [0, 0.15, 0.85, 1];
    var ADIV = [0, 0.5, 1];      /* 加算合成の光溜まりは粗くてよい */

    /** その器具が (col,row) を照らしているか（加算メッシュを張る範囲の判定） */
    function litBy(col, row, fidx) {
      var l = self.lightIndex[col + ',' + row];
      if (!l) return false;
      for (var i = 0; i < l.length; i++) if (l[i] === fidx) return true;
      return false;
    }
    function flickerNear(col, row) {
      var l = self.lightIndex[col + ',' + row];
      if (!l) return -1;
      for (var i = 0; i < l.length; i++) if (self.fixtures[l[i]].state === 'flicker') return l[i];
      return -1;
    }

    var furnAt = Object.create(null);
    var furn = (map.meta && map.meta.furniture) || [];
    for (var fu = 0; fu < furn.length; fu++) furnAt[furn[fu].col + ',' + furn[fu].row] = furn[fu];

    /* ---- 床・天井 ----
     * 什器マスは実体（solid）だが壁を張らないので、床と天井は張っておかないと
     * 抜けて背景が見える。歩行可能マス＋什器マスを対象にする。 */
    var cells = map.walkableCells();
    for (var fz = 0; fz < furn.length; fz++) cells.push({ col: furn[fz].col, row: furn[fz].row });
    /* 床は floorYAt に、天井は floorYAt + そのマスの天井高に貼る（高低差対応） */
    function defFloor(x, z) { return map.floorYAt(x, z); }
    function defFloorLift(dy) { return function (x, z) { return map.floorYAt(x, z) + dy; }; }
    function defCeil(ch) { return function (x, z) { return map.floorYAt(x, z) + ch; }; }

    for (var i = 0; i < cells.length; i++) {
      var c = cells[i].col, r = cells[i].row;
      bset(c, r);
      var key = this._ownerOf(c, r);
      var tint = this._tintAt(c, r).f;
      var vary = 0.92 + hash2(c, r) * 0.16;
      var ft = [tint[0] * vary, tint[1] * vary, tint[2] * vary];
      var x0 = c * T, x1 = x0 + T, z0 = r * T, z1 = z0 + T;
      var ch = map.ceilHAt(c, r);

      var uvF = uvVariant(hash2(c + 41, r + 7));
      var uvC = uvVariant(hash2(c + 71, r + 23));
      B.floor.gridP([x0, 0, z1], [T, 0, 0], [0, 0, -T], FDIV, FDIV, 1, 1,
        floorShader(key, ft, [0, 1, 0]), uvF, defFloor);
      var ct = this._tintAt(c, r).w;
      B.ceil.gridP([x0, 0, z0], [T, 0, 0], [0, 0, T], CDIV, CDIV, 1, 1,
        floorShader(key, ct, [0, -1, 0]), uvC, defCeil(ch));

      var ff = flickerNear(c, r);
      if (ff >= 0 && litBy(c, r, ff)) {
        fbOf(ff).floor.gridP([x0, 0, z1], [T, 0, 0], [0, 0, -T], ADIV, ADIV, 1, 1,
          floorShader(key, ft, [0, 1, 0], ff), uvF, defFloorLift(0.008));
      }
      /* 床の散乱物（デカール・コリジョン無し）。契約 §3「通路マスの3割程度」 */
      if (map.isWalkable(c, r)) {
        var lh = hash2(c * 31 + 5, r * 17 + 9);
        if (lh < 0.36) {
          var lsz = 1.15 + lh * 2.0;
          var lx = x0 + T / 2 + (hash2(c + 3, r + 8) - 0.5) * 0.5;
          var lz = z0 + T / 2 + (hash2(c + 9, r + 2) - 0.5) * 0.5;
          var quad = (hash2(c + 61, r + 13) * 4) | 0;
          var lu = (quad & 1) * 0.5, lv = (quad >> 1) * 0.5;
          B.litter.gridP([lx - lsz / 2, 0, lz + lsz / 2], [lsz, 0, 0], [0, 0, -lsz],
            [0, 1], [0, 1], 1, 1,
            floorShader(key, [1.25, 1.25, 1.25], [0, 1, 0]),
            function (ss, tt) { return [lu + ss * 0.5, lv + tt * 0.5]; },
            defFloorLift(0.02));
        }
      }
    }

    /* ---- 天井高が変わる境界の埋め（低天井→高天井の段差） ---- */
    for (var ci = 0; ci < cells.length; ci++) {
      var cc0 = cells[ci].col, rr0 = cells[ci].row;
      bset(cc0, rr0);
      var h0 = map.ceilHAt(cc0, rr0);
      var SD = [[1, 0], [0, 1]];
      for (var sd = 0; sd < 2; sd++) {
        var nc0 = cc0 + SD[sd][0], nr0 = rr0 + SD[sd][1];
        if (!map.isWalkable(nc0, nr0) && !furnAt[nc0 + ',' + nr0]) continue;
        var h1 = map.ceilHAt(nc0, nr0);
        if (Math.abs(h1 - h0) < 1e-6) continue;
        var lo = Math.min(h0, h1), hi = Math.max(h0, h1);
        var kk = this._ownerOf(cc0, rr0);
        var stTint = this._tintAt(cc0, rr0).w;
        var nrm = (h1 > h0) ? [SD[sd][0], 0, SD[sd][1]] : [-SD[sd][0], 0, -SD[sd][1]];
        var so, su;
        if (SD[sd][0]) {
          so = (h1 > h0) ? [(cc0 + 1) * T, 0, rr0 * T] : [(cc0 + 1) * T, 0, (rr0 + 1) * T];
          su = (h1 > h0) ? [0, 0, T] : [0, 0, -T];
        } else {
          so = (h1 > h0) ? [(cc0 + 1) * T, 0, (rr0 + 1) * T] : [cc0 * T, 0, (rr0 + 1) * T];
          su = (h1 > h0) ? [-T, 0, 0] : [T, 0, 0];
        }
        var stepDef = (function (a, b2) {
          return function (x, z, t) { return map.floorYAt(x, z) + a + (b2 - a) * t; };
        })(lo, hi);
        /* 天井段差の帯。両面ぶん出す（どちら側から見ても穴にならない） */
        B.wall.gridP(so, su, [0, hi - lo, 0], [0, 1], [0, 0.5, 1], 1, (hi - lo) / 3,
          wallShader(kk, stTint, nrm, undefined, lo, hi - lo), null, stepDef);
        B.wall.gridP([so[0] + su[0], so[1], so[2] + su[2]], [-su[0], 0, -su[2]], [0, hi - lo, 0],
          [0, 1], [0, 0.5, 1], 1, (hi - lo) / 3,
          wallShader(kk, stTint, [-nrm[0], 0, -nrm[2]], undefined, lo, hi - lo), null, stepDef);
      }
    }

    /* ---- 壁面 ---- */
    var DIRS = [
      { dc: 1, dr: 0, n: [1, 0, 0] },
      { dc: -1, dr: 0, n: [-1, 0, 0] },
      { dc: 0, dr: 1, n: [0, 0, 1] },
      { dc: 0, dr: -1, n: [0, 0, -1] }
    ];
    var wallCells = [];

    for (var rr = 0; rr < map.height; rr++) {
      for (var cc = 0; cc < map.width; cc++) {
        if (!map.isSolid(cc, rr)) continue;
        bset(cc, rr);
        var t = map.tileAt(cc, rr);
        var furnHere = furnAt[cc + ',' + rr];
        var any = false;
        for (var d = 0; d < 4; d++) {
          var nc = cc + DIRS[d].dc, nr = rr + DIRS[d].dr;
          if (!map.isWalkable(nc, nr)) continue;
          any = true;
          /* 什器マス: 什器が向いている面だけ壁を落として「アルコーブに置かれた什器」にする。
           * open:true の什器は四方の壁面を落として独立した什器にする（旧来の挙動）。 */
          if (furnHere) {
            var fv2 = FACE_VEC[furnHere.dir] || FACE_VEC.n;
            if (furnHere.open || (fv2[0] === DIRS[d].dc && fv2[2] === DIRS[d].dr)) continue;
          }
          this._wallFace(B, flickBuilders, cc, rr, nc, nr, DIRS[d], t, shader, planeShader, wallShader, flickerNear, litBy);
        }
        if (any) wallCells.push({ col: cc, row: rr });
      }
    }
    this.wallCells = wallCells;

    /* ---- 天井の設備（蛍光灯・配管・ケーブルラック） ---- */
    this._ceilingKit(B, flickBuilders, shader, planeShader);

    /* ---- 床の意匠（水たまり・ガラス片・チェックポイント・血痕） ---- */
    this._floorDecals(B, shader, planeShader);

    /* ---- 什器 ---- */
    for (var q = 0; q < furn.length; q++) this._furniture(B, furn[q], shader);

    /* ---- 拘束室の鉄格子 ---- */
    this._cellBars(B, shader);

    /* ---- 壁付け・天井付けの造作（モニタ壁・ホワイトボード・標識・手術灯） ---- */
    this._wallKit(B, shader, planeShader);
    this._signs(B, shader, planeShader);
    this._regionSigns(B, shader, planeShader);
    this._ceilKit(B, shader);

    /* ---- メッシュ化 ---- */
    var TX = ESCAPE.Textures;
    function opaque(tex, extra) {
      var o = { map: TX.get(tex), vertexColors: true, fog: true };
      if (extra) for (var k in extra) o[k] = extra[k];
      return new THREE.MeshBasicMaterial(o);
    }
    function decal(tex) {
      return new THREE.MeshBasicMaterial({
        map: TX.get(tex), vertexColors: true, fog: true, transparent: true,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      });
    }
    var MATS = {
      floor: opaque('floor'), floorTile: opaque('floorTile'),
      floorWet: opaque('floorWet'), floorMetal: opaque('floorMetal'),
      ceil: opaque('ceiling'),
      wall: opaque('wall'), wall2: opaque('wall2'), wall3: opaque('wall3'),
      wallPaint: opaque('wallPaint'), wallMetal: opaque('wallMetal'),
      litter: decal('litter'), poster: decal('poster'), sign: decal('sign'), zonesign: decal('zonesign'),
      metal: opaque('metal'), dark: opaque('metal'), lamp: opaque('lamp'),
      screen: opaque('screen'), paper: opaque('paper'), sheet: opaque('sheet'),
      fluid: opaque('tankfluid'), board: opaque('board'), monitors: opaque('monitors'),
      water: decal('water'), glass: decal('glass'), hatch: decal('hatch'), blood: decal('blood')
    };
    /* 描画順（不透明 → デカール）。素材は全チャンクで共有する */
    var order = ['floor', 'floorTile', 'floorWet', 'floorMetal', 'ceil',
      'wall', 'wall2', 'wall3', 'wallPaint', 'wallMetal', 'metal', 'dark', 'lamp', 'poster',
      'screen', 'paper', 'sheet', 'fluid', 'board', 'monitors', 'sign', 'zonesign',
      'hatch', 'blood', 'litter', 'water', 'glass'];
    var matCache = Object.create(null);
    var tris = 0, groups = 0;
    var chunkKeys = Object.keys(chunkBags);
    for (var ck = 0; ck < chunkKeys.length; ck++) {
      var bagn = chunkBags[chunkKeys[ck]];
      for (var m = 0; m < order.length; m++) {
        var name = order[m], b = bagn[name];
        if (!b || b.isEmpty()) continue;
        var mat = matCache[name] || (matCache[name] = this._track(MATS[name]));
        var mesh = buildMesh(b, mat);
        this._track(mesh.geometry);
        mesh.name = name;                 /* 監査で天井だけ隠す等に使う */
        mesh.renderOrder = m;
        mesh.frustumCulled = true;
        this.group.add(mesh);
        tris += b.idx.length / 3; groups++;
      }
    }
    /* 未使用の素材は破棄しておく（テクスチャは Textures 側のキャッシュが持つ） */
    for (var mk in MATS) if (!matCache[mk]) MATS[mk].dispose();
    this.stats.chunks = chunkKeys.length;

    /* チラつき灯: 加算合成の光溜まり */
    for (var k2 = 0; k2 < flickBuilders.length; k2++) {
      var fb = flickBuilders[k2];
      if (!fb) continue;
      var entry = { group: k2, pattern: k2 % 4, phase: (k2 * 0.618) % 1, mats: [] };
      /* 光溜まりは元の面と同じテクスチャで加算する（無地だと平坦に浮く） */
      var sub = [['floor', 'floor'], ['wall', 'wall'], ['lamp', 'lamp']];
      for (var s = 0; s < sub.length; s++) {
        var bb = fb[sub[s][0]];
        if (bb.isEmpty()) continue;
        var fm = this._track(new THREE.MeshBasicMaterial({
          map: sub[s][1] ? TX.get(sub[s][1]) : null, vertexColors: true, fog: true,
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
        }));
        var fmesh = buildMesh(bb, fm);
        this._track(fmesh.geometry);
        fmesh.name = 'flick_' + sub[s][0];
        this.group.add(fmesh);
        entry.mats.push(fm);
        tris += bb.idx.length / 3; groups++;
      }
      if (entry.mats.length) this.flickers.push(entry);
    }

    this.stats.triangles = tris;
    this.stats.drawGroups = groups;
    this.stats.buildMs = (global.performance ? performance.now() : Date.now()) - t0;
  };

  /* ---------------- 壁1面 ---------------- */

  /* 壁の分割位置。両端と床際・天井際に行を寄せて接地のAOを出す */
  var WDIV_S = [0, 0.12, 0.88, 1];
  var WDIV_T = [0, 0.08, 0.5, 0.93, 1];
  var ADIV_W = [0, 0.5, 1];

  World.prototype._wallFace = function (B, flickBuilders, cc, rr, nc, nr, dir, tile, shader, planeShader, wallShader, flickerNear, litBy) {
    var map = this.map, T = map.tileSize;
    /* 壁は「隣の歩行可能マス」の床高さから、そのマスの天井高まで張る */
    var H = map.ceilHAt(nc, nr);
    var fyAt = function (x, z) { return map.floorYAt(x + dir.n[0] * 0.03, z + dir.n[2] * 0.03); };
    var defWall = function (x, z, t) { return fyAt(x, z) + H * t; };
    var baseY = map.cellFloorY(nc, nr);
    var TILE = ESCAPE.TILE;
    var key = nc + ',' + nr;
    var tint = this._tintAt(cc, rr).w;
    var vary = 0.88 + hash2(cc + 3, rr + 5) * 0.20;
    var wt = [tint[0] * vary, tint[1] * vary, tint[2] * vary];
    var x0 = cc * T, x1 = x0 + T, z0 = rr * T, z1 = z0 + T;

    /* 面の起点・辺ベクトル（cross(u,v)=法線 になる向き） */
    var o, u, v = [0, H, 0];
    if (dir.dc === 1) { o = [x1, 0, z1]; u = [0, 0, -T]; }
    else if (dir.dc === -1) { o = [x0, 0, z0]; u = [0, 0, T]; }
    else if (dir.dr === 1) { o = [x0, 0, z1]; u = [T, 0, 0]; }
    else { o = [x1, 0, z0]; u = [-T, 0, 0]; }

    /* ロッカー・隔壁も背後の壁は張る（張らないと上部が抜けて背景が見える） */
    var isPlain = (tile === TILE.WALL || tile === TILE.NOTE || tile === TILE.GIMMICK ||
      tile === TILE.LOCKER || tile === TILE.DOOR);
    if (isPlain) {
      var uvW = uvFlipU(hash2(cc * 5 + nc, rr * 3 + nr));
      /* 壁テクスチャは2種を混ぜる（1種だと欠けタイルの位置が反復して目立つ） */
      var wpick = hash2(cc * 17 + 3, rr * 23 + 11);
      var wb = (wpick < 0.34) ? B.wall : ((wpick < 0.67) ? B.wall2 : B.wall3);
      wb.gridP(o, u, v, WDIV_S, WDIV_T, 1, 1, wallShader(key, wt, dir.n, undefined, fyAt, H), uvW, defWall);
      var ff = flickerNear(nc, nr);
      if (ff >= 0 && litBy(nc, nr, ff)) {
        var eo = [o[0] + dir.n[0] * 0.01, o[1], o[2] + dir.n[2] * 0.01];
        flickBuilders[this.fixtures[ff].fgroup].wall.gridP(eo, u, v, ADIV_W, ADIV_W, 1, 1,
          wallShader(key, wt, dir.n, ff, fyAt, H), uvW,
          function (x, z, t) { return fyAt(x, z) + H * t + 0.006; });
      }
      setYBias(baseY);
      this._wallDetail(B, cc, rr, nc, nr, dir, shader, H);
      this._wallPaper(B, cc, rr, nc, nr, dir, planeShader, key);
      setYBias(0);
    }

    setYBias(baseY);

    var sh = shader(key, [1, 1, 1]);
    var shDim = shader(key, [0.82, 0.84, 0.86]);
    var cxw = (x0 + x1) / 2, czw = (z0 + z1) / 2;
    /* 面の中心（壁面上） */
    var fx = cxw + dir.n[0] * T * 0.5, fz = czw + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';

    var noteEntry = (tile === TILE.NOTE) ? this._noteEntryAt(cc, rr) : null;
    var noteFace = !noteEntry || !noteEntry.dir ||
      (FACE_VEC[noteEntry.dir][0] === dir.dc && FACE_VEC[noteEntry.dir][2] === dir.dr);
    if (tile === TILE.NOTE && noteFace) {
      /* 壁のメモ: 目に付くよう少し明るく描く */
      var pw = 0.52, ph = 0.72, py = 1.45;
      var no = [], nu = [], nv = [0, ph, 0];
      if (along === 'z') { no = [fx + dir.n[0] * 0.022, py - ph / 2, czw + pw / 2 * dir.n[0]]; nu = [0, 0, -pw * dir.n[0]]; }
      else { no = [cxw - pw / 2 * dir.n[2], py - ph / 2, fz + dir.n[2] * 0.022]; nu = [pw * dir.n[2], 0, 0]; }
      /* 台紙（紙より薄く・手前に出さない） */
      B.dark.box(fx + dir.n[0] * 0.005, py, fz + dir.n[2] * 0.005,
        (along === 'z') ? 0.01 : pw + 0.09, ph + 0.09, (along === 'z') ? pw + 0.09 : 0.01, 0.7, shDim);
      B.paper.grid(no, nu, nv, 1, 1, 1, 1, function (x, y, z) {
        var c = planeShader(key, [1.35, 1.32, 1.24], dir.n)(x, y, z);
        return [Math.min(1, c[0] + 0.12), Math.min(1, c[1] + 0.12), Math.min(1, c[2] + 0.11)];
      });
      /* P4.8 契約「メモの見分け」: 本物のメモは画鋲で留めてある（四隅の小さな金属）。
         近接すると縁が淡く光る（その光は Progress._updateNoteGlow が出す）。 */
      var pin = shader(key, [2.10, 2.02, 1.70]);
      for (var pk = 0; pk < 4; pk++) {
        var pu = ((pk & 1) ? 1 : -1) * (pw * 0.40);
        var pv = ((pk & 2) ? 1 : -1) * (ph * 0.40);
        B.metal.box(
          fx + dir.n[0] * 0.045 + ((along === 'z') ? 0 : pu),
          py + pv,
          fz + dir.n[2] * 0.045 + ((along === 'z') ? pu : 0),
          (along === 'z') ? 0.035 : 0.055, 0.055, (along === 'z') ? 0.055 : 0.035, 3, pin);
      }
    } else if (tile === TILE.GIMMICK && this._gimmickRoleAt(cc, rr) === 'safe' &&
      (function (e) {
        return !e || !e.dir || (FACE_VEC[e.dir][0] === dir.dc && FACE_VEC[e.dir][2] === dir.dr);
      })(this._gimmickAt(cc, rr))) {
      /* P4.8 所長室の金庫（唯一の鍵の在り処）。厚い鋼扉＋ダイヤル＋レバー把手 */
      this._safe(B, cc, rr, dir, shader, key);
    } else if (tile === TILE.GIMMICK) {
      /* 仕掛け端末: 筐体＋発光画面＋レバー（P4.8 で失効した仕掛けの造形もこれで残る） */
      var by = 1.24;
      var dw = (along === 'z') ? 0.16 : 1.10, dd = (along === 'z') ? 1.10 : 0.16;
      B.metal.box(fx + dir.n[0] * 0.08, by, fz + dir.n[2] * 0.08, dw, 0.92, dd, 0.9, sh);
      var sw = 0.62, shh = 0.40, sy = 1.34;
      var so, su, sv = [0, shh, 0];
      if (along === 'z') { so = [fx + dir.n[0] * 0.17, sy - shh / 2, czw + sw / 2 * dir.n[0]]; su = [0, 0, -sw * dir.n[0]]; }
      else { so = [cxw - sw / 2 * dir.n[2], sy - shh / 2, fz + dir.n[2] * 0.17]; su = [sw * dir.n[2], 0, 0]; }
      B.screen.grid(so, su, sv, 1, 1, 1, 1, function () { return [1, 1, 1]; });
      B.metal.box(fx + dir.n[0] * 0.20, 0.98, fz + dir.n[2] * 0.20, 0.10, 0.22, 0.10, 2, sh);
    } else if (tile === TILE.LOCKER) {
      this._locker(B, cc, rr, dir, sh, shDim);
    } else if (tile === TILE.DOOR) {
      this._bulkhead(B, cc, rr, dir, sh, shDim, H);
    }
    setYBias(0);
  };

  /**
   * 壁の貼り紙（警告文・書類・掲示）。契約 §3「味気ない通路を禁止」。
   * 面は壁から0.015mしか出ないのでプレイヤーに干渉しない。
   */
  World.prototype._wallPaper = function (B, cc, rr, nc, nr, dir, planeShader, key) {
    var h = hash2(cc * 41 + nr * 7, rr * 29 + nc * 3);
    if (h > 0.21) {
      /* 契約 §3「バイオハザード標識・区画銘板・注意書きで全域を意味づけ」。
       * 貼り紙より低い頻度で標識を混ぜる（施設全体が研究所だと分かるように） */
      if (h < 0.272) this._wallSign(B, cc, rr, nc, nr, dir, planeShader, key);
      return;
    }
    var T = this.map.tileSize;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var fx = cx + dir.n[0] * (T * 0.5 + 0.016), fz = cz + dir.n[2] * (T * 0.5 + 0.016);
    var along = (dir.dc !== 0) ? 'z' : 'x';
    var big = h < 0.10;
    var pw = big ? 0.72 : 0.44, ph = big ? 0.98 : 0.58;
    var py = 1.35 + (hash2(cc + 7, rr + 21) - 0.5) * 0.55;
    var off = (hash2(cc + 13, rr + 4) - 0.5) * 0.9;
    var q = (hash2(cc * 3 + 1, rr * 5 + 2) * 4) | 0;
    var u0 = (q & 1) * 0.5, v0 = (q >> 1) * 0.5;
    var o, u;
    if (along === 'z') { o = [fx, py - ph / 2, cz + off + pw / 2 * dir.n[0]]; u = [0, 0, -pw * dir.n[0]]; }
    else { o = [cx + off - pw / 2 * dir.n[2], py - ph / 2, fz]; u = [pw * dir.n[2], 0, 0]; }
    /* P4.8 契約「メモの見分け」: 飾りの貼り紙は彩度と明度を落として沈める。
       本物のメモ（NOTEタイル）は明るい紙＋画鋲＋近接の淡い光で見分けがつく。 */
    B.poster.gridP(o, u, [0, ph, 0], [0, 1], [0, 1], 1, 1,
      planeShader(key, [0.60, 0.61, 0.62], dir.n),
      function (ss, tt) { return [u0 + ss * 0.5, v0 + (1 - tt) * 0.5]; });
  };


  /**
   * 壁の標識（バイオハザード / 区画銘板 / 立入禁止 / 除染注意）。
   * 板は壁から0.018mしか出ないのでプレイヤーに干渉しない。
   * 区画ごとに出やすい種類を変えて「どの区画にいるか」の手掛かりにする。
   */
  World.prototype._wallSign = function (B, cc, rr, nc, nr, dir, planeShader, key) {
    var T = this.map.tileSize;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var m = dir.n;                                  /* 壁面の外向き法線 */
    var fx = cx + m[0] * (T * 0.5 + 0.018), fz = cz + m[2] * (T * 0.5 + 0.018);
    var zone = this._zoneAt(nc, nr);
    var pick = hash2(cc * 7 + 13, rr * 19 + 5);
    var i, j;
    if (zone === 'B' || zone === 'C') {
      i = 0; j = (pick < 0.62) ? 0 : 1;             /* 実験・検体区画はバイオハザード / 立入禁止 */
    } else if (zone === 'D') {
      i = 0; j = 1;                                 /* 拘束区画は立入禁止 */
    } else if (zone === 'A' || zone === 'E') {
      i = 1; j = (pick < 0.55) ? 0 : 1;             /* 受入・記録区画は銘板と注意書き */
    } else if (pick < 0.34) { i = 1; j = 0; }       /* 区画銘板 */
    else if (pick < 0.60) { i = 0; j = 0; }
    else if (pick < 0.82) { i = 0; j = 1; }
    else { i = 1; j = 1; }
    var sz = (pick < 0.30) ? 0.78 : 0.60;
    var off = (hash2(cc + 29, rr + 17) - 0.5) * 0.82;
    var py = 1.58 + (hash2(cc + 5, rr + 31) - 0.5) * 0.30;
    var px = fx + ((m[0] !== 0) ? 0 : off), pz = fz + ((m[0] !== 0) ? off : 0);
    facePanel(B.sign, px, py, pz, m, sz, sz,
      planeShader(key, [1.18, 1.16, 1.12], m), atlasUV(i, j, 2));
  };

  /* 区画ごとの標識帯の色。交差点の壁に塗って「同じ交差点が続く」感覚を壊す */
  var REGION_MARK = {
    /* 部屋 */
    director: [0.96, 0.72, 0.30], office: [0.92, 0.80, 0.44], control: [0.60, 0.56, 0.94],
    pump: [0.98, 0.58, 0.16], store: [0.86, 0.78, 0.52], elec: [1.00, 0.66, 0.12],
    cellroom: [0.88, 0.24, 0.20], guardpost: [0.82, 0.30, 0.28], visitroom: [0.86, 0.36, 0.32],
    labB: [0.42, 0.76, 0.92], labA: [0.94, 0.78, 0.30], assay: [0.46, 0.82, 0.96],
    machine: [0.34, 0.90, 0.62], specimen: [0.62, 0.94, 0.46], necro: [0.30, 0.86, 0.70],
    hall: [0.94, 0.90, 0.60], quaran: [0.70, 0.88, 0.98], security: [0.40, 0.70, 0.98],
    /* ランドマーク長廊下 */
    lmA: [0.98, 0.90, 0.44], lmB: [0.40, 0.70, 0.98], lmC: [0.98, 0.66, 0.20],
    /* 帯（区画）ゾーン */
    corrE: [0.34, 0.72, 0.96],   /* A 受入 */
    corrW: [0.62, 0.86, 0.98],   /* B 実験 */
    corrS: [0.34, 0.90, 0.56],   /* C 検体 */
    corrC: [0.92, 0.26, 0.22],   /* D 拘束 */
    corrN: [0.98, 0.78, 0.34],   /* E 記録 */
    filter: [1.00, 0.58, 0.14]   /* F 機械 */
  };

  /**
   * 壁面の付帯物（配管・換気口・銘板・区画標識）。白タイルが延々と続くのを避ける。
   * 突出は最大0.13mに収める（プレイヤー半径0.32mより十分小さい＝めり込まない）。
   */
  World.prototype._wallDetail = function (B, cc, rr, nc, nr, dir, shader, H) {
    var map = this.map, T = map.tileSize;
    if (H === undefined) H = map.wallHeight;
    var key = nc + ',' + nr;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var fx = cx + dir.n[0] * T * 0.5, fz = cz + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';

    /* 交差点の壁には区画の色帯を塗る（目印＝迷路内で位置を思い出せる） */
    var d4 = 0;
    if (map.isWalkable(nc + 1, nr)) d4++;
    if (map.isWalkable(nc - 1, nr)) d4++;
    if (map.isWalkable(nc, nr + 1)) d4++;
    if (map.isWalkable(nc, nr - 1)) d4++;
    /* 部屋の中（2x2が全て通行可）は交差点ではないので塗らない */
    var openHere = false;
    for (var oc = nc - 1; oc <= nc && !openHere; oc++) {
      for (var orr = nr - 1; orr <= nr && !openHere; orr++) {
        if (map.isWalkable(oc, orr) && map.isWalkable(oc + 1, orr) &&
            map.isWalkable(oc, orr + 1) && map.isWalkable(oc + 1, orr + 1)) openHere = true;
      }
    }
    if (d4 >= 3 && !openHere) {
      var rid = this._regionAt(nc, nr);
      var mk = (rid && REGION_MARK[rid]) || [0.7, 0.72, 0.7];
      var shMark = shader(key, [mk[0] * 1.6, mk[1] * 1.6, mk[2] * 1.6]);
      B.metal.box(fx - dir.n[0] * 0.012, 1.52, fz - dir.n[2] * 0.012,
        (along === 'z') ? 0.03 : T - 0.06, 0.17, (along === 'z') ? T - 0.06 : 0.03, 1.2, shMark);
    }

    var h = hash2(cc * 13 + nc * 7, rr * 11 + nr * 5);
    if (h > 0.26) return;
    var sh = shader(key, [0.70, 0.72, 0.74]);
    var off = (hash2(cc + 2, rr + 9) - 0.5) * 1.1;
    var ox = (along === 'z') ? 0 : off, oz = (along === 'z') ? off : 0;

    if (h < 0.11) {
      /* 立ち上がりの配管2本 */
      for (var k = 0; k < 2; k++) {
        var s2 = (k - 0.5) * 0.22;
        var px = fx - dir.n[0] * 0.075 + ox + ((along === 'z') ? 0 : s2);
        var pz = fz - dir.n[2] * 0.075 + oz + ((along === 'z') ? s2 : 0);
        B.dark.tube([px, 0.08, pz], [px, H - 0.38, pz], 0.055, 4, sh);
        B.dark.tube([px, 1.30, pz], [px, 1.42, pz], 0.075, 4, sh);
      }
    } else if (h < 0.19) {
      /* 換気口 */
      var vy = Math.min(2.34, H - 0.42);
      B.metal.box(fx - dir.n[0] * 0.03 + ox, vy, fz - dir.n[2] * 0.03 + oz,
        (along === 'z') ? 0.06 : 0.60, 0.40, (along === 'z') ? 0.60 : 0.06, 1.6, sh);
      for (var v2 = 0; v2 < 3; v2++) {
        B.dark.box(fx - dir.n[0] * 0.065 + ox, vy - 0.12 + v2 * 0.11, fz - dir.n[2] * 0.065 + oz,
          (along === 'z') ? 0.02 : 0.52, 0.04, (along === 'z') ? 0.52 : 0.02, 2, sh);
      }
    } else {
      /* 区画銘板と非常時の配電箱 */
      B.metal.box(fx - dir.n[0] * 0.02 + ox, 1.94, fz - dir.n[2] * 0.02 + oz,
        (along === 'z') ? 0.04 : 0.44, 0.30, (along === 'z') ? 0.44 : 0.04, 2.2, sh);
      B.metal.box(fx - dir.n[0] * 0.06 + ox, 1.20, fz - dir.n[2] * 0.06 + oz,
        (along === 'z') ? 0.12 : 0.30, 0.40, (along === 'z') ? 0.30 : 0.12, 2, sh);
    }
  };

  /* ---------------- 個別の造形 ---------------- */

  /** meta.gimmicks のそのマスの役割（P4.8: 'safe' / 'bulkhead' / undefined） */
  World.prototype._gimmickAt = function (col, row) {
    if (!this._gimAt) {
      this._gimAt = Object.create(null);
      var gl = (this.map.meta && this.map.meta.gimmicks) || [];
      for (var gi = 0; gi < gl.length; gi++) this._gimAt[gl[gi].col + ',' + gl[gi].row] = gl[gi];
    }
    return this._gimAt[col + ',' + row] || null;
  };
  /** 壁のメモ（meta.notes）。dir を持つメモはその面にだけ紙を貼る */
  World.prototype._noteEntryAt = function (col, row) {
    if (!this._noteAtMap) {
      this._noteAtMap = Object.create(null);
      var nl = (this.map.meta && this.map.meta.notes) || [];
      for (var ni = 0; ni < nl.length; ni++) this._noteAtMap[nl[ni].col + ',' + nl[ni].row] = nl[ni];
    }
    return this._noteAtMap[col + ',' + row] || null;
  };

  World.prototype._gimmickRoleAt = function (col, row) {
    if (!this._gimRole) {
      this._gimRole = Object.create(null);
      var list = (this.map.meta && this.map.meta.gimmicks) || [];
      for (var i = 0; i < list.length; i++) this._gimRole[list[i].col + ',' + list[i].row] = list[i].role;
    }
    return this._gimRole[col + ',' + row];
  };

  /** P4.8 金庫（所長室・東端の壁）。壁からの突出は0.20mに収める（プレイヤー半径0.32m未満）。
   *  面が欠けないよう箱だけで組む（tube は端が開いていて正面から見ると穴になる）。 */
  World.prototype._safe = function (B, cc, rr, dir, shader, key) {
    var T = this.map.tileSize;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var fx = cx + dir.n[0] * T * 0.5, fz = cz + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';
    var y0 = 1.20;
    var shBody = shader(key, [1.20, 1.24, 1.28]);
    var shDoor = shader(key, [1.70, 1.68, 1.62]);
    var shTrim = shader(key, [2.60, 2.20, 1.30]);   /* 真鍮のダイヤルと把手 */
    var shDark = shader(key, [0.55, 0.57, 0.60]);
    /** 壁面から off だけ手前、横 a・縦 b にずらした箱 */
    function put(bld, off, a, b, w, h, d, uvS, sh) {
      bld.box(fx + dir.n[0] * off + ((along === 'z') ? 0 : a),
        y0 + b,
        fz + dir.n[2] * off + ((along === 'z') ? a : 0),
        (along === 'z') ? d : w, h, (along === 'z') ? w : d, uvS, sh);
    }
    /* 埋め込みの筐体（枠） */
    put(B.dark, 0.02, 0, 0, 1.22, 1.22, 0.12, 0.9, shDark);
    /* 鋼の扉 */
    put(B.metal, 0.085, 0, 0, 1.00, 1.00, 0.09, 0.7, shDoor);
    /* 扉の段（面取り） */
    put(B.metal, 0.125, 0, 0, 0.84, 0.84, 0.05, 0.8, shBody);
    /* ダイヤル: 台座 → 目盛環 → 中央のハブ → 十字のスポーク */
    put(B.metal, 0.150, 0, 0, 0.44, 0.44, 0.04, 1.0, shBody);
    for (var k = 0; k < 12; k++) {
      var a2 = k / 12 * Math.PI * 2;
      put(B.dark, 0.170, Math.cos(a2) * 0.185, Math.sin(a2) * 0.185, 0.035, 0.035, 0.02, 2, shDark);
    }
    put(B.metal, 0.185, 0, 0, 0.26, 0.26, 0.05, 1.4, shTrim);
    put(B.metal, 0.200, 0, 0, 0.40, 0.062, 0.03, 1.6, shTrim);
    put(B.metal, 0.200, 0, 0, 0.062, 0.40, 0.03, 1.6, shTrim);
    /* レバー把手（縦棒＋上下の受け） */
    put(B.metal, 0.150, 0.40, 0, 0.075, 0.46, 0.075, 1.8, shTrim);
    put(B.metal, 0.115, 0.40, 0.25, 0.10, 0.08, 0.10, 2, shBody);
    put(B.metal, 0.115, 0.40, -0.25, 0.10, 0.08, 0.10, 2, shBody);
    /* 蝶番 */
    put(B.dark, 0.105, -0.46, 0.36, 0.13, 0.16, 0.09, 2, shBody);
    put(B.dark, 0.105, -0.46, -0.36, 0.13, 0.16, 0.09, 2, shBody);
  };

  World.prototype._locker = function (B, cc, rr, dir, sh, shDim) {
    var T = this.map.tileSize;
    var x0 = cc * T, z0 = rr * T;
    var cx = x0 + T / 2, cz = z0 + T / 2;
    var fx = cx + dir.n[0] * T * 0.5, fz = cz + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';
    var W = 1.76, D = 0.58, HH = 1.92;
    /* 本体は実体マスの中に沈める（突出0.12m）＝プレイヤーにめり込まない */
    var bx = fx - dir.n[0] * (D / 2 - 0.12), bz = fz - dir.n[2] * (D / 2 - 0.12);
    var sx = (along === 'z') ? D : W, sz = (along === 'z') ? W : D;
    B.metal.box(bx, HH / 2, bz, sx, HH, sz, 0.8, sh);
    /* 扉の割りと通気スリット */
    for (var k = 0; k < 3; k++) {
      var off = (k - 1) * (W / 3);
      var dx2 = (along === 'z') ? 0 : off, dz2 = (along === 'z') ? off : 0;
      /* 縦の割れ目 */
      B.dark.box(fx + dir.n[0] * 0.121 + dx2 - ((along === 'z') ? 0 : W / 6), HH / 2,
        fz + dir.n[2] * 0.121 + dz2 - ((along === 'z') ? W / 6 : 0),
        (along === 'z') ? 0.012 : 0.03, HH - 0.06, (along === 'z') ? 0.03 : 0.012, 2, shDim);
      /* 取手 */
      B.dark.box(fx + dir.n[0] * 0.15 + dx2 * 1.0 + ((along === 'z') ? 0 : 0.22),
        1.15, fz + dir.n[2] * 0.15 + dz2 * 1.0 + ((along === 'z') ? 0.22 : 0),
        (along === 'z') ? 0.05 : 0.07, 0.22, (along === 'z') ? 0.07 : 0.05, 2, shDim);
      /* 通気スリット */
      for (var s = 0; s < 3; s++) {
        B.dark.box(fx + dir.n[0] * 0.125 + dx2, 1.62 + s * 0.09, fz + dir.n[2] * 0.125 + dz2,
          (along === 'z') ? 0.012 : 0.42, 0.035, (along === 'z') ? 0.42 : 0.012, 2, shDim);
      }
    }
  };

  World.prototype._bulkhead = function (B, cc, rr, dir, sh, shDim, H) {
    var T = this.map.tileSize;
    if (H === undefined) H = this.map.wallHeight;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var fx = cx + dir.n[0] * T * 0.5, fz = cz + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';
    var W = 1.98, D = 0.28;
    var sx = (along === 'z') ? D : W, sz = (along === 'z') ? W : D;
    var bx = fx - dir.n[0] * (D / 2 - 0.10), bz = fz - dir.n[2] * (D / 2 - 0.10);
    /* 隔壁本体 */
    B.metal.box(bx, 1.30, bz, sx, 2.60, sz, 0.6, sh);
    /* 補強リブ3本 */
    for (var k = 0; k < 3; k++) {
      B.dark.box(bx + dir.n[0] * 0.09, 0.55 + k * 0.85, bz + dir.n[2] * 0.09,
        (along === 'z') ? 0.06 : W - 0.16, 0.16, (along === 'z') ? W - 0.16 : 0.06, 1.5, shDim);
    }
    /* 覗き窓（暗い） */
    B.dark.box(bx + dir.n[0] * 0.10, 1.72, bz + dir.n[2] * 0.10,
      (along === 'z') ? 0.06 : 0.52, 0.30, (along === 'z') ? 0.52 : 0.06, 2, shDim);
    /* 枠 */
    B.dark.box(cx, H - 0.15, cz, (along === 'z') ? T : T, 0.30, (along === 'z') ? T : T, 0.6, shDim);
  };

  World.prototype._cellBars = function (B, shader) {
    var map = this.map, T = map.tileSize, TILE = ESCAPE.TILE;
    var open = Object.create(null);
    var oc = (map.meta && map.meta.cellOpenings) || [];
    for (var i = 0; i < oc.length; i++) open[oc[i].col + ',' + oc[i].row] = true;
    var D = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
    for (var r = 0; r < map.height; r++) {
      for (var c = 0; c < map.width; c++) {
        if (map.tileAt(c, r) !== TILE.CELL) continue;
        if (open[c + ',' + r]) continue;
        if (this._bset) this._bset(c, r);
        for (var d = 0; d < 4; d++) {
          var nc = c + D[d][0], nr = r + D[d][1];
          if (!map.isWalkable(nc, nr)) continue;
          if (map.tileAt(nc, nr) === TILE.CELL) continue;
          var n = D[d][2];
          var cx = c * T + T / 2, cz = r * T + T / 2;
          var fx = cx + n[0] * T * 0.5, fz = cz + n[2] * T * 0.5;
          var sh = shader(this._ownerOf(nc, nr), [0.9, 0.9, 0.92]);
          var along = (n[0] !== 0) ? 'z' : 'x';
          setYBias(map.cellFloorY(c, r));
          for (var k = 0; k < 9; k++) {
            var off = -T / 2 + 0.12 + k * 0.22;
            var bx = fx + ((along === 'z') ? 0 : off), bz = fz + ((along === 'z') ? off : 0);
            B.dark.tube([bx, 0, bz], [bx, 2.55, bz], 0.035, 4, sh);
          }
          B.dark.box(fx, 2.62, fz, (along === 'z') ? 0.09 : T, 0.14, (along === 'z') ? T : 0.09, 1.5, sh);
          B.dark.box(fx, 1.30, fz, (along === 'z') ? 0.07 : T, 0.10, (along === 'z') ? T : 0.07, 1.5, sh);
          setYBias(0);
        }
      }
    }
    /* 房の中身（寝台・バケツ・排水口）。「牢」だと一目で分かるように置く */
    for (var r2 = 0; r2 < map.height; r2++) {
      for (var c2 = 0; c2 < map.width; c2++) {
        if (map.tileAt(c2, r2) !== TILE.CELL) continue;
        if (this._bset) this._bset(c2, r2);
        /* 3方が塞がった「奥のマス」にだけ置く（前室側には置かない） */
        var solid = 0, openDir = null;
        for (var d2 = 0; d2 < 4; d2++) {
          var ac = c2 + D[d2][0], ar = r2 + D[d2][1];
          if (map.isSolid(ac, ar)) solid++; else openDir = D[d2][2];
        }
        if (solid < 3 || !openDir) continue;
        var kx = this._ownerOf(c2, r2);
        var shc = shader(kx, [0.86, 0.86, 0.88]);
        var shs = shader(kx, [0.96, 0.94, 0.88]);
        var ccx = c2 * T + T / 2, ccz = r2 * T + T / 2;
        /* 開口の反対側の壁ぎわに寝台を寄せる */
        var bx2 = ccx - openDir[0] * 0.42, bz2 = ccz - openDir[2] * 0.42;
        var alongC = (openDir[0] !== 0) ? 'z' : 'x';
        setYBias(map.cellFloorY(c2, r2));
        B.metal.box(bx2, 0.42, bz2, (alongC === 'z') ? 0.86 : 1.62, 0.07,
          (alongC === 'z') ? 1.62 : 0.86, 1.0, shc);
        B.sheet.box(bx2, 0.50, bz2, (alongC === 'z') ? 0.76 : 1.50, 0.11,
          (alongC === 'z') ? 1.50 : 0.76, 0.8, shs);
        for (var lg = 0; lg < 4; lg++) {
          var lx2 = bx2 + ((lg & 1) ? 1 : -1) * ((alongC === 'z') ? 0.36 : 0.72);
          var lz2 = bz2 + ((lg & 2) ? 1 : -1) * ((alongC === 'z') ? 0.72 : 0.36);
          B.dark.tube([lx2, 0, lz2], [lx2, 0.40, lz2], 0.028, 4, shc);
        }
        /* バケツと排水口 */
        B.dark.tube([ccx + openDir[0] * 0.55, 0, ccz + openDir[2] * 0.55],
          [ccx + openDir[0] * 0.55, 0.28, ccz + openDir[2] * 0.55], 0.17, 7, shc);
        B.dark.tube([ccx, 0.012, ccz], [ccx, 0.03, ccz], 0.18, 8, shc);
        setYBias(0);
      }
    }
  };

  /* ---------------- 天井まわり ---------------- */

  World.prototype._ceilingKit = function (B, flickBuilders, shader, planeShader) {
    var map = this.map, T = map.tileSize, H = map.wallHeight;
    var self = this;
    var bset = this._bset || function () {};

    /* 蛍光灯・非常灯 */
    for (var i = 0; i < this.fixtures.length; i++) {
      var f = this.fixtures[i];
      bset(f.col, f.row);
      var key = f.col + ',' + f.row;
      var sh = shader(key, [1, 1, 1]);
      if (f.kind === 'emergency') {
        /* 非常灯は壁付け。闇だまりの中で「方向」だけを示す赤い点 */
        this._wallLamp(B, f.col, f.row, [EMERG_COLOR.r * 0.72, EMERG_COLOR.g * 0.72, EMERG_COLOR.b * 0.72], shader);
        continue;
      }
      /* glow は什器・造作そのものが発光体なので器具は描かない */
      if (f.kind === 'glow') continue;
      var lw = 1.30, ld = 0.30;
      var sx = (f.axis === 'z') ? ld : lw, sz = (f.axis === 'z') ? lw : ld;
      var topY = f.fy + f.ch;
      /* 器具本体 */
      B.dark.box(f.x, topY - 0.06, f.z, sx + 0.06, 0.12, sz + 0.06, 1.2, sh);
      /* 発光面（下向き） */
      var lo, lu, lv;
      if (f.axis === 'z') { lo = [f.x - ld / 2, f.y, f.z - lw / 2]; lu = [ld, 0, 0]; lv = [0, 0, lw]; }
      else { lo = [f.x - lw / 2, f.y, f.z - ld / 2]; lu = [lw, 0, 0]; lv = [0, 0, ld]; }
      var lit = LAMP_EMIT * ((f.state === 'on') ? 1.0 : ((f.state === 'flicker') ? FLICKER_BAKE : 0.06));
      var lampCol = [f.color.r * lit, f.color.g * lit, f.color.b * lit];
      B.lamp.grid(lo, lu, lv, 1, 1, 1, 1, function () { return lampCol; });
      if (f.state === 'flicker' && flickBuilders[f.fgroup]) {
        var addCol = [f.color.r * LAMP_EMIT * (1 - FLICKER_BAKE), f.color.g * LAMP_EMIT * (1 - FLICKER_BAKE),
          f.color.b * LAMP_EMIT * (1 - FLICKER_BAKE)];
        flickBuilders[f.fgroup].lamp.grid([lo[0], lo[1] - 0.004, lo[2]], lu, lv, 1, 1, 1, 1,
          function () { return addCol; });
      }
    }

    /* 通路の配管とケーブルラック */
    var cells = map.walkableCells();
    for (var q = 0; q < cells.length; q++) {
      var c = cells[q].col, r = cells[q].row;
      bset(c, r);
      var ns = !map.isWalkable(c - 1, r) && !map.isWalkable(c + 1, r);
      var ew = !map.isWalkable(c, r - 1) && !map.isWalkable(c, r + 1);
      if (!ns && !ew) continue;
      var key2 = c + ',' + r;
      var sh2 = shader(key2, [0.86, 0.86, 0.84]);
      var x0 = c * T, z0 = r * T;
      var cx = x0 + T / 2, cz = z0 + T / 2;
      var chL = map.ceilHAt(c, r);
      var py = chL - 0.38, py2 = chL - 0.34;
      setYBias(map.cellFloorY(c, r));
      if (ns) {
        B.dark.tube([cx - 0.62, py, z0], [cx - 0.62, py, z0 + T], 0.085, 4, sh2);
        if (hash2(c, r + 17) < 0.30) B.dark.box(cx + 0.66, py2, cz, 0.34, 0.06, T, 1.2, sh2);
      } else {
        B.dark.tube([x0, py, cz - 0.62], [x0 + T, py, cz - 0.62], 0.085, 4, sh2);
        if (hash2(c + 17, r) < 0.30) B.dark.box(cx, py2, cz + 0.66, T, 0.06, 0.34, 1.2, sh2);
      }
      setYBias(0);
    }
  };

  /* ---------------- 床の意匠 ---------------- */

  World.prototype._floorDecals = function (B, shader, planeShader) {
    var map = this.map, T = map.tileSize, meta = map.meta || {};
    var self = this;
    var up = [0, 1, 0];

    var bset = this._bset || function () {};
    function quad(builderFn, col, row, size, y, tintArr) {
      bset(col, row);
      var builder = builderFn();
      var cx = col * T + T / 2, cz = row * T + T / 2, h = size / 2;
      builder.grid([cx - h, 0, cz + h], [size, 0, 0], [0, 0, -size], 1, 1, 1, 1,
        planeShader(col + ',' + row, tintArr, up), null,
        function (x, z) { return map.floorYAt(x, z) + y; });
    }

    var noise = meta.noise || [];
    for (var i = 0; i < noise.length; i++) {
      var n = noise[i];
      if (n.kind === 'glass') quad(function () { return B.glass; }, n.col, n.row, 1.9, 0.016, [1.5, 1.5, 1.5]);
      else if (n.kind === 'metal') this._metalPlate(B, n.col, n.row, shader, planeShader);
      else quad(function () { return B.water; }, n.col, n.row, 1.94, 0.012, [1.15, 1.15, 1.2]);
    }
    var cps = meta.checkpoints || [];
    for (var j = 0; j < cps.length; j++) {
      quad(function () { return B.hatch; }, cps[j].col, cps[j].row, 1.6, 0.014, [0.85, 0.85, 0.85]);
      /* 非常灯（緑）を近くの壁に */
      this._wallLamp(B, cps[j].col, cps[j].row, [0.35, 1.0, 0.5], shader);
    }
    if (meta.exitPad) {
      quad(function () { return B.hatch; }, meta.exitPad.col, meta.exitPad.row, 1.86, 0.014, [0.95, 0.95, 0.95]);
    }
    var dec = meta.decals || [];
    for (var k = 0; k < dec.length; k++) {
      if (dec[k].type === 'blood') quad(function () { return B.blood; }, dec[k].col, dec[k].row, 1.8, 0.018, [1, 1, 1]);
    }
    /* センサー */
    var sen = meta.sensors || [];
    for (var s = 0; s < sen.length; s++) this._sensor(B, sen[s].col, sen[s].row, shader);
    /* 板 */
    var bd = meta.boards || [];
    for (var b = 0; b < bd.length; b++) this._board(B, bd[b].col, bd[b].row, shader);
  };

  /**
   * 剥がれた金属板（音地盤 kind='metal'）。契約 §4 の踏む系の罠のひとつ。
   * 床から 4cm だけ浮かせた板＝「踏むと鳴りそう」と見て分かる造形にする。
   * 板の厚みぶんは段差になるが立体物ではない（プレイヤーの当たりは水平2Dのみ）。
   */
  World.prototype._metalPlate = function (B, col, row, shader, planeShader) {
    if (this._bset) this._bset(col, row);
    var T = this.map.tileSize;
    setYBias(this.map.cellFloorY(col, row));
    var cx = col * T + T / 2, cz = row * T + T / 2;
    var sh = shader(col + ',' + row, [1.05, 1.06, 1.10]);
    /* 大判1枚＋めくれた小片2枚。めくれは高さを変えて影の段を作る */
    B.metal.box(cx, 0.022, cz, T * 0.86, 0.044, T * 0.72, 0.9, sh);
    B.metal.box(cx - T * 0.30, 0.060, cz + T * 0.26, T * 0.26, 0.040, T * 0.20, 1.2, sh);
    B.metal.box(cx + T * 0.28, 0.052, cz - T * 0.24, T * 0.22, 0.036, T * 0.24, 1.2, sh);
    setYBias(0);
  };

  /** 歩行可能マスに隣接する壁の向きを返す */
  World.prototype._wallDirOf = function (col, row) {
    var map = this.map;
    var D = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
    for (var i = 0; i < 4; i++) {
      if (map.isSolid(col + D[i][0], row + D[i][1])) return D[i][2];
    }
    return null;
  };

  World.prototype._wallLamp = function (B, col, row, rgb, shader) {
    if (this._bset) this._bset(col, row);
    var n = this._wallDirOf(col, row);
    if (!n) return;
    var T = this.map.tileSize;
    setYBias(this.map.cellFloorY(col, row));
    var cx = col * T + T / 2, cz = row * T + T / 2;
    var fx = cx + n[0] * (T * 0.5 - 0.06), fz = cz + n[2] * (T * 0.5 - 0.06);
    var along = (n[0] !== 0) ? 'z' : 'x';
    var sh = shader(col + ',' + row, [0.9, 0.9, 0.9]);
    B.dark.box(fx, 2.30, fz, (along === 'z') ? 0.12 : 0.44, 0.20, (along === 'z') ? 0.44 : 0.12, 1.5, sh);
    B.lamp.box(fx - n[0] * 0.05, 2.30, fz - n[2] * 0.05,
      (along === 'z') ? 0.05 : 0.34, 0.13, (along === 'z') ? 0.34 : 0.05, 2,
      function () { return rgb; });
    setYBias(0);
  };

  World.prototype._sensor = function (B, col, row, shader) {
    if (this._bset) this._bset(col, row);
    var n = this._wallDirOf(col, row);
    if (!n) return;
    var T = this.map.tileSize;
    setYBias(this.map.cellFloorY(col, row));
    var cx = col * T + T / 2, cz = row * T + T / 2;
    var fx = cx + n[0] * (T * 0.5 - 0.05), fz = cz + n[2] * (T * 0.5 - 0.05);
    var sh = shader(col + ',' + row, [0.85, 0.86, 0.88]);
    var along = (n[0] !== 0) ? 'z' : 'x';
    B.metal.box(fx, 1.12, fz, (along === 'z') ? 0.10 : 0.20, 0.20, (along === 'z') ? 0.20 : 0.10, 2, sh);
    /* 表示灯。筐体の前面から確実に出す（暗い区画でも赤い点として見える） */
    B.lamp.box(fx - n[0] * 0.10, 1.12, fz - n[2] * 0.10,
      (along === 'z') ? 0.07 : 0.09, 0.09, (along === 'z') ? 0.09 : 0.07, 3,
      function () { return [1.0, 0.25, 0.22]; });
    /* 感知ビーム。通路を横切る細い赤い線＝「歩けば目視で気づいて回避できる見た目」（契約 §4）。
       当たり判定は持たない（走って横切ると警報＝ステルス側の判定） */
    /* ビームは壁から通路を横切る向き（＝法線 n の軸）に張る */
    var bl = T * 0.92;
    B.lamp.box(cx, 1.12, cz,
      (n[0] !== 0) ? bl : 0.022, 0.022, (n[2] !== 0) ? bl : 0.022, 1,
      function () { return [0.85, 0.16, 0.13]; });
    setYBias(0);
  };

  World.prototype._board = function (B, col, row, shader) {
    if (this._bset) this._bset(col, row);
    var n = this._wallDirOf(col, row);
    if (!n) return;
    var T = this.map.tileSize;
    setYBias(this.map.cellFloorY(col, row));
    var cx = col * T + T / 2, cz = row * T + T / 2;
    var sh = shader(col + ',' + row, [0.95, 0.88, 0.74]);
    /* 壁に立てかけた板。突出は0.26m以内に収める */
    for (var k = 0; k < 3; k++) {
      var lean = 0.09 + k * 0.055;
      var px = cx + n[0] * (T * 0.5 - lean), pz = cz + n[2] * (T * 0.5 - lean);
      var along = (n[0] !== 0) ? 'z' : 'x';
      var off = (k - 1) * 0.42;
      B.dark.box(px + ((along === 'z') ? 0 : off), 1.02 - k * 0.04, pz + ((along === 'z') ? off : 0),
        (along === 'z') ? 0.05 : 0.34, 2.02, (along === 'z') ? 0.34 : 0.05, 1.1, sh);
    }
    setYBias(0);
  };

  /* ---------------- 壁付け・天井付けの造作 ---------------- */

  /**
   * meta.wallKit の描画。col,row は「手前の歩行可能マス」、dir はそこから見た壁の向き。
   * 突出は最大0.16mに収める（プレイヤー半径0.32mより十分小さい）。
   */
  World.prototype._wallKit = function (B, shader, planeShader) {
    var map = this.map, T = map.tileSize;
    var list = (map.meta && map.meta.wallKit) || [];
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (this._bset) this._bset(k.col, k.row);
      var v = FACE_VEC[k.dir] || FACE_VEC.n;            /* 手前マス -> 壁 */
      var m = [-v[0], 0, -v[2]];                        /* 面の外向き法線 */
      var key = k.col + ',' + k.row;
      setYBias(map.cellFloorY(k.col, k.row));
      var cx = k.col * T + T / 2, cz = k.row * T + T / 2;
      var fx = cx + v[0] * (T * 0.5), fz = cz + v[2] * (T * 0.5);
      var along = (v[0] !== 0) ? 'z' : 'x';
      var sh = shader(key, [0.92, 0.94, 0.96]);
      var shD = shader(key, [0.62, 0.65, 0.68]);
      var wideX = (along === 'z') ? 0.14 : 1.0, wideZ = (along === 'z') ? 1.0 : 0.14;

      if (k.type === 'monitorBank') {
        /* 監視モニタの壁。画面は自発光（照明の焼き込みに依存しない） */
        B.metal.box(fx + m[0] * 0.07, 1.74, fz + m[2] * 0.07,
          (along === 'z') ? 0.14 : 1.86, 1.22, (along === 'z') ? 1.86 : 0.14, 1.0, shD);
        /* 同じ絵が並ばないよう、面ごとにUVを反転・上下入れ替えする */
        var mv = (hash2(k.col * 13 + 3, k.row * 7 + 1) * 4) | 0;
        facePanel(B.monitors, fx + m[0] * 0.145, 1.74, fz + m[2] * 0.145, m, 1.74, 1.10,
          flat([0.86, 0.88, 0.92]),
          function (u, vv) { return [(mv & 1) ? 1 - u : u, (mv & 2) ? 1 - vv : vv]; });
        /* 下に配線トレー */
        B.dark.box(fx + m[0] * 0.09, 1.02, fz + m[2] * 0.09,
          (along === 'z') ? 0.18 : 1.86, 0.08, (along === 'z') ? 1.86 : 0.18, 1.4, shD);
      } else if (k.type === 'whiteboard') {
        B.dark.box(fx + m[0] * 0.035, 1.62, fz + m[2] * 0.035,
          (along === 'z') ? 0.07 : 1.92, 1.24, (along === 'z') ? 1.92 : 0.07, 1.0, shD);
        facePanel(B.board, fx + m[0] * 0.075, 1.63, fz + m[2] * 0.075, m, 1.80, 1.12,
          function (x, y, z) {
            var c = planeShader(key, [1.30, 1.30, 1.28], m)(x, y, z);
            return [Math.min(1, c[0] + 0.10), Math.min(1, c[1] + 0.10), Math.min(1, c[2] + 0.10)];
          });
        /* ペン受け */
        B.metal.box(fx + m[0] * 0.10, 0.98, fz + m[2] * 0.10,
          (along === 'z') ? 0.16 : 1.60, 0.05, (along === 'z') ? 1.60 : 0.16, 1.6, sh);
      } else if (k.type === 'corkboard') {
        B.dark.box(fx + m[0] * 0.04, 1.62, fz + m[2] * 0.04,
          (along === 'z') ? 0.08 : 1.60, 1.16, (along === 'z') ? 1.60 : 0.08, 1.2, shD);
        for (var p = 0; p < 6; p++) {
          var hq = hash2(k.col * 11 + p, k.row * 5 + p);
          var qa = (hq * 4) | 0;
          var ox = (hq - 0.5) * 1.16, oy = 1.62 + ((hash2(p, k.col) - 0.5) * 0.72);
          facePanel(B.poster, fx + m[0] * 0.085 + ((along === 'z') ? 0 : ox), oy,
            fz + m[2] * 0.085 + ((along === 'z') ? ox : 0), m, 0.38, 0.50,
            planeShader(key, [1.05, 1.03, 0.98], m), atlasUV(qa & 1, qa >> 1, 2));
        }
      } else if (k.type === 'xrayBox') {
        /* シャーカステン: 白く光る面にX線写真が挟んである */
        B.metal.box(fx + m[0] * 0.05, 1.62, fz + m[2] * 0.05,
          (along === 'z') ? 0.10 : 1.16, 0.94, (along === 'z') ? 1.16 : 0.10, 1.2, shD);
        facePanel(B.lamp, fx + m[0] * 0.105, 1.62, fz + m[2] * 0.105, m, 1.04, 0.82,
          flat([0.64, 0.66, 0.70]));
        for (var xf = 0; xf < 3; xf++) {
          var fo = (xf - 1) * 0.34;
          B.dark.box(fx + m[0] * 0.115 + ((along === 'z') ? 0 : fo), 1.62,
            fz + m[2] * 0.115 + ((along === 'z') ? fo : 0),
            (along === 'z') ? 0.01 : 0.28, 0.66, (along === 'z') ? 0.28 : 0.01, 2, shD);
        }
      } else if (k.type === 'supplyShelf') {
        /* P4.7 保管庫の棚（B-2 / B-3）。突出0.30m以内＝通行の邪魔にならない */
        var shWood = shader(key, [0.86, 0.78, 0.62]);
        for (var tsh = 0; tsh < 4; tsh++) {
          var ty = 0.34 + tsh * 0.52;
          B.metal.box(fx + m[0] * 0.15, ty, fz + m[2] * 0.15,
            (along === 'z') ? 0.30 : 1.84, 0.05, (along === 'z') ? 1.84 : 0.30, 1.4, sh);
          /* 棚に載る箱・瓶（左右にばらけさせる） */
          for (var it = 0; it < 3; it++) {
            var hq2 = hash2(k.col * 7 + tsh * 3 + it, k.row * 11 + it);
            if (hq2 < 0.34) continue;
            var oa = (it - 1) * 0.56 + (hq2 - 0.5) * 0.18;
            B.sheet.box(fx + m[0] * 0.15 + ((along === 'z') ? 0 : oa), ty + 0.16,
              fz + m[2] * 0.15 + ((along === 'z') ? oa : 0),
              (along === 'z') ? 0.22 : 0.34, 0.26, (along === 'z') ? 0.34 : 0.22, 1.4, shWood);
          }
        }
        /* 側板と棚札 */
        for (var sd2 = 0; sd2 < 2; sd2++) {
          var so2 = (sd2 ? 1 : -1) * 0.92;
          B.dark.box(fx + m[0] * 0.15 + ((along === 'z') ? 0 : so2), 1.05,
            fz + m[2] * 0.15 + ((along === 'z') ? so2 : 0),
            (along === 'z') ? 0.30 : 0.05, 2.10, (along === 'z') ? 0.05 : 0.30, 1.6, shD);
        }
        facePanel(B.sign, fx + m[0] * 0.305, 1.72, fz + m[2] * 0.305, m, 0.42, 0.30,
          planeShader(key, [1.30, 1.28, 1.22], m), atlasUV(1, 0, 2));
      } else if (k.type === 'valveWheel') {
        /* P4.7 循環ポンプ室のバルブ（ハンドル車＋配管） */
        var shV = shader(key, [1.10, 0.72, 0.42]);
        B.metal.box(fx + m[0] * 0.10, 1.05, fz + m[2] * 0.10,
          (along === 'z') ? 0.20 : 0.52, 0.52, (along === 'z') ? 0.52 : 0.20, 1.4, shD);
        var vx = fx + m[0] * 0.24, vz = fz + m[2] * 0.24;
        B.dark.tube([fx + m[0] * 0.10, 1.05, fz + m[2] * 0.10], [vx, 1.05, vz], 0.05, 6, shD);
        /* ハンドル車は暗がりでも輪郭が読めるよう自発光の縁を持たせる */
        B.lamp.tube([vx, 1.05, vz], [vx + m[0] * 0.07, 1.05, vz + m[2] * 0.07], 0.32, 14,
          flat([0.62, 0.30, 0.09]));
        B.metal.tube([vx, 1.05, vz], [vx + m[0] * 0.05, 1.05, vz + m[2] * 0.05], 0.26, 12, shV);
        for (var sp2 = 0; sp2 < 4; sp2++) {
          var a2 = sp2 * Math.PI / 4;
          var ax = Math.cos(a2) * 0.28, ay = Math.sin(a2) * 0.28;
          B.lamp.box(vx + m[0] * 0.03 + ((along === 'z') ? 0 : ax), 1.05 + ay,
            vz + m[2] * 0.03 + ((along === 'z') ? ax : 0),
            (along === 'z') ? 0.07 : 0.60, 0.06, (along === 'z') ? 0.60 : 0.07, 2,
            flat([0.58, 0.28, 0.08]));
        }
        B.metal.box(vx + m[0] * 0.05, 1.05, vz + m[2] * 0.05,
          (along === 'z') ? 0.12 : 0.14, 0.14, (along === 'z') ? 0.14 : 0.12, 2, shV);
        /* 立ち上がり配管 */
        B.dark.tube([fx + m[0] * 0.09 - ((along === 'z') ? 0 : 0.62), 0.02,
          fz + m[2] * 0.09 - ((along === 'z') ? 0.62 : 0)],
          [fx + m[0] * 0.09 - ((along === 'z') ? 0 : 0.62), 2.30,
            fz + m[2] * 0.09 - ((along === 'z') ? 0.62 : 0)], 0.09, 6, shD);
      } else if (k.type === 'breakerPanel') {
        /* P4.7 主電源盤の3系統ブレーカー（盤の脇の配電箱） */
        B.metal.box(fx + m[0] * 0.10, 1.42, fz + m[2] * 0.10,
          (along === 'z') ? 0.20 : 1.12, 1.00, (along === 'z') ? 1.12 : 0.20, 1.2, sh);
        for (var bk = 0; bk < 3; bk++) {
          var bo = (bk - 1) * 0.32;
          B.dark.box(fx + m[0] * 0.21 + ((along === 'z') ? 0 : bo), 1.42,
            fz + m[2] * 0.21 + ((along === 'z') ? bo : 0),
            (along === 'z') ? 0.06 : 0.20, 0.46, (along === 'z') ? 0.20 : 0.06, 2, shD);
          B.lamp.box(fx + m[0] * 0.23 + ((along === 'z') ? 0 : bo), 1.78,
            fz + m[2] * 0.23 + ((along === 'z') ? bo : 0), 0.07, 0.07, 0.07, 2,
            flat([0.42, 0.10, 0.10]));
        }
        B.dark.tube([fx + m[0] * 0.06, 1.92, fz + m[2] * 0.06],
          [fx + m[0] * 0.06, 2.66, fz + m[2] * 0.06], 0.07, 6, shD);
      } else if (k.type === 'pipeBank') {
        /* P4.7 ポンプ室の配管群（横走りの太管＋バルブ座） */
        var shP = shader(key, [0.74, 0.78, 0.80]);
        for (var pb = 0; pb < 3; pb++) {
          var py2 = 0.60 + pb * 0.72;
          var a0 = [fx + m[0] * 0.16 - ((along === 'z') ? 0 : 0.98), py2,
            fz + m[2] * 0.16 - ((along === 'z') ? 0.98 : 0)];
          var a1 = [fx + m[0] * 0.16 + ((along === 'z') ? 0 : 0.98), py2,
            fz + m[2] * 0.16 + ((along === 'z') ? 0.98 : 0)];
          B.metal.tube(a0, a1, 0.13, 7, shP);
          B.dark.box(fx + m[0] * 0.16, py2, fz + m[2] * 0.16,
            (along === 'z') ? 0.32 : 0.16, 0.32, (along === 'z') ? 0.16 : 0.32, 1.6, shD);
        }
      } else if (k.type === 'filePile') {
        /* P4.9 記録区画: 壁ぎわに積み上がった書類の山とファイル箱（突出0.30m以内） */
        var shBox = shader(key, [0.94, 0.84, 0.62]);
        var shPaper = shader(key, [1.28, 1.24, 1.10]);
        for (var fp = 0; fp < 4; fp++) {
          var hq4 = hash2(k.col * 5 + fp, k.row * 9 + fp * 3);
          var fo2 = (fp - 1.5) * 0.46;
          var stack = 2 + ((hq4 * 3) | 0);
          for (var sy3 = 0; sy3 < stack; sy3++) {
            var yy = 0.11 + sy3 * 0.22;
            var jitter = (hash2(fp * 3 + sy3, k.col) - 0.5) * 0.06;
            B.sheet.box(fx + m[0] * 0.16 + ((along === 'z') ? 0 : fo2 + jitter), yy,
              fz + m[2] * 0.16 + ((along === 'z') ? fo2 + jitter : 0),
              (along === 'z') ? 0.30 : 0.42, 0.20, (along === 'z') ? 0.42 : 0.30, 1.6, shBox);
            /* 箱から溢れた紙束 */
            if (hq4 > 0.55 && sy3 === stack - 1) {
              B.paper.box(fx + m[0] * 0.16 + ((along === 'z') ? 0 : fo2), yy + 0.13,
                fz + m[2] * 0.16 + ((along === 'z') ? fo2 : 0),
                (along === 'z') ? 0.26 : 0.34, 0.07, (along === 'z') ? 0.34 : 0.26, 2.2, shPaper);
            }
          }
        }
        /* 床に散った書類（薄物） */
        B.paper.box(fx + m[0] * 0.26, 0.012, fz + m[2] * 0.26,
          (along === 'z') ? 0.42 : 1.30, 0.012, (along === 'z') ? 1.30 : 0.42, 1.6, shPaper);
      } else if (k.type === 'labBench') {
        /* P4.9 実験区画: 壁付けの実験台（天板0.30m）＋ガラス器具 */
        var shTop = shader(key, [1.02, 1.04, 1.02]);
        var shGlass2 = shader(key, [1.55, 1.62, 1.58]);
        B.metal.box(fx + m[0] * 0.15, 0.90, fz + m[2] * 0.15,
          (along === 'z') ? 0.30 : 1.86, 0.06, (along === 'z') ? 1.86 : 0.30, 1.4, shTop);
        B.dark.box(fx + m[0] * 0.15, 0.44, fz + m[2] * 0.15,
          (along === 'z') ? 0.28 : 1.78, 0.60, (along === 'z') ? 1.78 : 0.28, 1.2, shD);
        for (var gb = 0; gb < 5; gb++) {
          var hq5 = hash2(k.col * 7 + gb * 5, k.row * 3 + gb);
          if (hq5 < 0.25) continue;
          var go = (gb - 2) * 0.36;
          var gx2 = fx + m[0] * 0.15 + ((along === 'z') ? 0 : go);
          var gz2 = fz + m[2] * 0.15 + ((along === 'z') ? go : 0);
          if (hq5 < 0.6) {
            /* ビーカー */
            B.glass.tube([gx2, 0.93, gz2], [gx2, 1.10 + hq5 * 0.10, gz2], 0.055, 8, shGlass2);
          } else {
            /* フラスコ（台形＝2段のtube） */
            B.glass.tube([gx2, 0.93, gz2], [gx2, 1.02, gz2], 0.075, 8, shGlass2);
            B.glass.tube([gx2, 1.02, gz2], [gx2, 1.22, gz2], 0.028, 6, shGlass2);
          }
        }
        /* 台の下の吊り棚 */
        B.metal.box(fx + m[0] * 0.13, 1.62, fz + m[2] * 0.13,
          (along === 'z') ? 0.26 : 1.70, 0.05, (along === 'z') ? 1.70 : 0.26, 1.4, shTop);
      } else if (k.type === 'crateRow') {
        /* P4.9 受入・機械区画: 壁ぎわに積まれた搬送箱とドラム缶（突出0.30m以内） */
        var shWood = shader(key, [0.92, 0.78, 0.54]);
        var shDrum = shader(key, [0.86, 0.72, 0.46]);
        for (var cr2 = 0; cr2 < 3; cr2++) {
          var hq6 = hash2(k.col * 11 + cr2 * 7, k.row * 13 + cr2);
          var co2 = (cr2 - 1) * 0.62;
          var cx3 = fx + m[0] * 0.16 + ((along === 'z') ? 0 : co2);
          var cz3 = fz + m[2] * 0.16 + ((along === 'z') ? co2 : 0);
          if (hq6 < 0.4) {
            B.dark.tube([cx3, 0, cz3], [cx3, 0.86, cz3], 0.28, 10, shDrum);
            B.metal.tube([cx3, 0.28, cz3], [cx3, 0.32, cz3], 0.30, 10, shDrum);
            B.metal.tube([cx3, 0.60, cz3], [cx3, 0.64, cz3], 0.30, 10, shDrum);
          } else {
            var hgt = 0.42 + hq6 * 0.36;
            B.sheet.box(cx3, hgt / 2, cz3,
              (along === 'z') ? 0.30 : 0.56, hgt, (along === 'z') ? 0.56 : 0.30, 1.4, shWood);
            if (hq6 > 0.72) {
              B.sheet.box(cx3, hgt + 0.18, cz3,
                (along === 'z') ? 0.26 : 0.44, 0.34, (along === 'z') ? 0.44 : 0.26, 1.6, shWood);
            }
          }
        }
      } else if (k.type === 'restraintRack') {
        /* P4.9 拘束区画: 拘束具（革帯＋鋼の手枷）を掛けた壁ラック。突出0.22m以内。
         * 「板が並んでいる」ように見えないよう、帯は細く・長さをばらし・金具を目立たせる。 */
        var shLeather = shader(key, [0.34, 0.22, 0.16]);
        var shSteel = shader(key, [1.35, 1.32, 1.28]);
        B.metal.tube(
          [fx + m[0] * 0.06 - ((along === 'z') ? 0 : 0.78), 1.94, fz + m[2] * 0.06 - ((along === 'z') ? 0.78 : 0)],
          [fx + m[0] * 0.06 + ((along === 'z') ? 0 : 0.78), 1.94, fz + m[2] * 0.06 + ((along === 'z') ? 0.78 : 0)],
          0.035, 6, shSteel);
        var nRack = 3 + ((hash2(k.col, k.row) * 2) | 0);
        for (var rk = 0; rk < nRack; rk++) {
          var hq3 = hash2(k.col * 13 + rk * 7, k.row * 11 + rk);
          var ro = (rk - (nRack - 1) / 2) * (1.52 / nRack) + (hq3 - 0.5) * 0.10;
          var rx = fx + m[0] * 0.08 + ((along === 'z') ? 0 : ro);
          var rz = fz + m[2] * 0.08 + ((along === 'z') ? ro : 0);
          /* S字フック */
          B.metal.tube([rx, 1.94, rz], [rx, 1.84, rz], 0.018, 5, shSteel);
          /* 垂れた革帯（細く・長さをばらす・幅も変える） */
          var rl = 0.34 + hq3 * 0.62;
          var rw = 0.055 + hq3 * 0.03;
          B.sheet.box(rx, 1.84 - rl / 2, rz,
            (along === 'z') ? 0.035 : rw, rl, (along === 'z') ? rw : 0.035, 2.6, shLeather);
          /* 先端の手枷（鋼のリング） */
          B.metal.tube([rx - ((along === 'z') ? 0 : 0.045), 1.84 - rl, rz - ((along === 'z') ? 0.045 : 0)],
            [rx + ((along === 'z') ? 0 : 0.045), 1.84 - rl, rz + ((along === 'z') ? 0.045 : 0)], 0.062, 8, shSteel);
        }
        /* 下に落ちた拘束帯（薄物・壁際） */
        B.sheet.box(fx + m[0] * 0.13, 0.04, fz + m[2] * 0.04,
          (along === 'z') ? 0.24 : 0.72, 0.04, (along === 'z') ? 0.72 : 0.24, 2.0, shLeather);
      } else if (k.type === 'steamVent') {
        /* P4.9 機械区画: 蒸気の噴き出す排気口。蒸気は加算合成の薄板を重ねる */
        B.metal.box(fx + m[0] * 0.06, 1.06, fz + m[2] * 0.06,
          (along === 'z') ? 0.12 : 0.72, 0.56, (along === 'z') ? 0.72 : 0.12, 1.4, shD);
        for (var sv = 0; sv < 3; sv++) {
          var svy = 0.88 + sv * 0.18;
          B.dark.tube([fx + m[0] * 0.14, svy, fz + m[2] * 0.14],
            [fx + m[0] * 0.20, svy, fz + m[2] * 0.20], 0.055, 6, shD);
        }
        /* 蒸気: 上へ広がる半透明の板（sheet は不透明なので lamp で淡く光らせる） */
        for (var st = 0; st < 3; st++) {
          var sw2 = 0.55 + st * 0.30, sy2 = 1.38 + st * 0.46;
          facePanel(B.lamp, fx + m[0] * (0.24 + st * 0.10), sy2, fz + m[2] * (0.24 + st * 0.10),
            m, sw2, 0.52, flat([0.16 - st * 0.04, 0.17 - st * 0.04, 0.18 - st * 0.045]));
        }
        /* 足元の結露 */
        B.dark.box(fx + m[0] * 0.10, 0.02, fz + m[2] * 0.10,
          (along === 'z') ? 0.20 : 1.10, 0.02, (along === 'z') ? 1.10 : 0.20, 1.2, shD);
      } else {
        /* bioPlacard: 大きなバイオハザード標識＋区画銘板 */
        B.metal.box(fx + m[0] * 0.03, 1.72, fz + m[2] * 0.03,
          (along === 'z') ? 0.06 : 1.06, 1.06, (along === 'z') ? 1.06 : 0.06, 1.2, shD);
        facePanel(B.sign, fx + m[0] * 0.068, 1.76, fz + m[2] * 0.068, m, 0.94, 0.94,
          planeShader(key, [1.30, 1.28, 1.22], m), atlasUV(0, 0, 2));
        facePanel(B.sign, fx + m[0] * 0.068, 1.02, fz + m[2] * 0.068, m, 0.86, 0.86,
          planeShader(key, [1.22, 1.20, 1.16], m), atlasUV(1, 0, 2));
      }
      setYBias(0);
    }
  };

  /**
   * P4.7 掲示（docs/notes.md「掲示・銘板」）。col,row は実体マス、dir はそれを読む側。
   * 板は壁から0.05mしか出ないのでプレイヤーに干渉しない。本文は Progress が近接時に出す。
   */
  World.prototype._signs = function (B, shader, planeShader) {
    var map = this.map, T = map.tileSize;
    var list = (map.meta && map.meta.signs) || [];
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      var m = FACE_VEC[k.dir] || FACE_VEC.n;            /* 実体マス -> 読む側 = 面の外向き法線 */
      var nc = k.col + (m[0] | 0), nr = k.row + (m[2] | 0);
      if (this._bset) this._bset(k.col, k.row);
      var key = this._ownerOf(nc, nr);
      setYBias(map.cellFloorY(nc, nr));
      var cx = k.col * T + T / 2, cz = k.row * T + T / 2;
      var fx = cx + m[0] * (T * 0.5), fz = cz + m[2] * (T * 0.5);
      var along = (m[0] !== 0) ? 'z' : 'x';
      var shD = shader(key, [0.55, 0.58, 0.60]);
      /* 台座（枠）＋読める明度の面。掲示は必ず目に入るよう明るめに焼く */
      B.dark.box(fx + m[0] * 0.014, 2.06, fz + m[2] * 0.014,
        (along === 'z') ? 0.03 : 1.30, 0.44, (along === 'z') ? 1.30 : 0.03, 1.2, shD);
      facePanel(B.sign, fx + m[0] * 0.036, 2.06, fz + m[2] * 0.036, m, 1.16, 0.34,
        planeShader(key, [1.45, 1.42, 1.32], m), atlasUV(1, 1, 2));
      setYBias(0);
    }
  };

  /**
   * P4.8 区画銘板（DESIGN.md §4「地図」／docs/notes.md「区画名」）。
   * col,row は実体マス、dir はそれを読む側。表記は `A　受入区画` 形式で
   * zonesign テクスチャに焼き込んである（3x2 アトラス、A..F）。
   * 板は壁から0.06mしか出ないのでプレイヤーに干渉しない。
   */
  World.prototype._regionSigns = function (B, shader, planeShader) {
    var map = this.map, T = map.tileSize;
    var list = (map.meta && map.meta.regionSigns) || [];
    var ORDER = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      var idx = ORDER[k.zone];
      if (idx === undefined) continue;
      if (this._bset) this._bset(k.col, k.row);
      var m = FACE_VEC[k.dir] || FACE_VEC.n;
      var nc = k.col + (m[0] | 0), nr = k.row + (m[2] | 0);
      var key = this._ownerOf(nc, nr);
      setYBias(map.cellFloorY(nc, nr));
      var cx = k.col * T + T / 2, cz = k.row * T + T / 2;
      var fx = cx + m[0] * (T * 0.5), fz = cz + m[2] * (T * 0.5);
      var along = (m[0] !== 0) ? 'z' : 'x';
      var shD = shader(key, [0.62, 0.66, 0.70]);
      /* 金属の額縁 → 銘板面。銘板は迷路の錨なので明るめに焼く */
      B.metal.box(fx + m[0] * 0.018, 1.66, fz + m[2] * 0.018,
        (along === 'z') ? 0.04 : 1.02, 1.02, (along === 'z') ? 1.02 : 0.04, 1.1, shD);
      facePanel(B.zonesign, fx + m[0] * 0.052, 1.66, fz + m[2] * 0.052, m, 0.92, 0.92,
        planeShader(key, [1.55, 1.52, 1.44], m), atlasUVR(idx % 3, (idx / 3) | 0, 3, 2));
      setYBias(0);
    }
  };

  /** meta.ceilKit の描画（手術灯など天井付け） */
  World.prototype._ceilKit = function (B, shader) {
    var map = this.map, T = map.tileSize;
    var list = (map.meta && map.meta.ceilKit) || [];
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (this._bset) this._bset(k.col, k.row);
      var key = this._ownerOf(k.col, k.row);
      setYBias(map.cellFloorY(k.col, k.row));
      var cx = k.col * T + T / 2, cz = k.row * T + T / 2;
      var ch = map.ceilHAt(k.col, k.row);
      var sh = shader(key, [0.94, 0.95, 0.96]);
      var shD = shader(key, [0.58, 0.60, 0.62]);
      if (k.type === 'surgicalLamp') {
        /* 天井から降りるアーム＋皿状の手術灯（下面が自発光） */
        B.dark.box(cx, ch - 0.09, cz, 0.42, 0.18, 0.42, 1.2, shD);
        B.dark.tube([cx, ch - 0.18, cz], [cx, 2.62, cz], 0.055, 5, shD);
        B.metal.tube([cx, 2.62, cz], [cx, 2.48, cz], 0.76, 12, sh);
        B.metal.box(cx, 2.56, cz, 1.46, 0.14, 1.46, 0.9, sh);
        B.metal.tube([cx, 2.44, cz], [cx, 2.58, cz], 0.86, 12, sh);
        /* 反射皿の下面（真下を向かせる＝cross(u,v) が -Y になる向き） */
        B.lamp.grid([cx - 0.66, 2.46, cz - 0.66], [1.32, 0, 0], [0, 0, 1.32], 1, 1, 1, 1,
          flat([1.00, 0.99, 0.94]));
        for (var b = 0; b < 4; b++) {
          var bx = cx + ((b & 1) ? 0.40 : -0.40), bz = cz + ((b & 2) ? 0.40 : -0.40);
          B.lamp.box(bx, 2.43, bz, 0.34, 0.05, 0.34, 2, flat([1.00, 0.98, 0.92]));
        }
        /* 補助アーム */
        B.dark.tube([cx + 0.72, 2.58, cz], [cx + 1.05, 2.86, cz], 0.045, 4, shD);
      }
      setYBias(0);
    }
  };

  /* ---------------- 什器 ---------------- */

  World.prototype._furniture = function (B, f, shader) {
    var T = this.map.tileSize;
    if (this._bset) this._bset(f.col, f.row);
    setYBias(this.map.cellFloorY(f.col, f.row));
    var cx = f.col * T + T / 2, cz = f.row * T + T / 2;
    var key = this._ownerOf(f.col, f.row);
    var sh = shader(key, [1, 1, 1]);
    var shD = shader(key, [0.78, 0.80, 0.82]);
    var shW = shader(key, [1.05, 1.02, 0.95]);
    var shCard = shader(key, [1.00, 0.80, 0.56]);
    var ew = (f.dir === 'e' || f.dir === 'w');   /* 長辺の向き */

    function L(a, b) { return ew ? b : a; }      /* 長辺=Z(南北) のとき a、X のとき b */

    /* 見せ場ルームの什器は dir を「正面の向き」として扱う（fv=正面, av=横） */
    var fv = FACE_VEC[f.dir] || FACE_VEC.n;
    var av = [-fv[2], 0, fv[0]];
    /** 中心から 横a・前d の位置 */
    function PX(a, d) { return cx + av[0] * a + fv[0] * d; }
    function PZ(a, d) { return cz + av[2] * a + fv[2] * d; }
    /** 横w・奥行dの箱サイズ */
    function SX(w, d) { return Math.abs(av[0]) * w + Math.abs(fv[0]) * d; }
    function SZ(w, d) { return Math.abs(av[2]) * w + Math.abs(fv[2]) * d; }

    switch (f.type) {
      case 'benchIsland': {
        var w = L(1.66, 0.92), d = L(0.92, 1.66);
        B.metal.box(cx, 0.90, cz, w, 0.07, d, 0.9, sh);
        B.dark.box(cx, 0.42, cz, w - 0.22, 0.05, d - 0.22, 0.9, shD);
        for (var i = 0; i < 4; i++) {
          var lx = cx + ((i & 1) ? 1 : -1) * (w / 2 - 0.1);
          var lz = cz + ((i & 2) ? 1 : -1) * (d / 2 - 0.1);
          B.dark.tube([lx, 0, lz], [lx, 0.88, lz], 0.035, 4, shD);
        }
        /* 台上の器具 */
        B.metal.box(cx - w * 0.25, 1.06, cz, 0.26, 0.26, 0.26, 2, sh);
        B.dark.tube([cx + w * 0.22, 0.94, cz - 0.1], [cx + w * 0.22, 1.28, cz - 0.1], 0.05, 5, shD);
        B.metal.box(cx + w * 0.05, 0.98, cz + d * 0.2, 0.38, 0.10, 0.26, 2, sh);
        break;
      }
      case 'gurney': {
        var gw = L(0.86, 1.94), gd = L(1.94, 0.86);
        B.metal.box(cx, 0.74, cz, gw, 0.06, gd, 1.0, sh);
        B.sheet.box(cx, 0.83, cz, gw - 0.10, 0.13, gd - 0.14, 0.8, shW);
        for (var g = 0; g < 4; g++) {
          var gx = cx + ((g & 1) ? 1 : -1) * (gw / 2 - 0.09);
          var gz = cz + ((g & 2) ? 1 : -1) * (gd / 2 - 0.09);
          B.dark.tube([gx, 0.06, gz], [gx, 0.72, gz], 0.028, 4, shD);
          B.dark.tube([gx, 0, gz], [gx, 0.09, gz], 0.07, 5, shD);
        }
        /* 柵 */
        var rz = L(gd / 2 - 0.35, 0), rx = L(0, gw / 2 - 0.35);
        B.dark.box(cx + rx, 0.99, cz + rz, L(gw, 0.06), 0.05, L(0.06, gd), 1.2, shD);
        B.dark.box(cx - rx, 0.99, cz - rz, L(gw, 0.06), 0.05, L(0.06, gd), 1.2, shD);
        /* 点滴スタンド */
        B.dark.tube([cx + gw * 0.42, 0, cz - gd * 0.36], [cx + gw * 0.42, 1.72, cz - gd * 0.36], 0.026, 4, shD);
        break;
      }
      case 'cabinet': {
        B.metal.box(cx, 0.98, cz, L(1.34, 0.66), 1.96, L(0.66, 1.34), 0.8, sh);
        B.dark.box(cx, 0.98, cz + L(0, 0.34), L(0.02, 0.02), 1.86, L(0.02, 0.02), 2, shD);
        B.dark.box(cx + L(0.3, 0), 1.16, cz + L(0, 0.34) * 1.02, 0.06, 0.24, 0.06, 2, shD);
        break;
      }
      case 'shelf': {
        var sw = L(1.72, 0.78), sd = L(0.78, 1.72);
        for (var s = 0; s < 4; s++) {
          B.metal.box(cx, 0.28 + s * 0.58, cz, sw, 0.05, sd, 0.9, sh);
        }
        for (var p = 0; p < 4; p++) {
          var px = cx + ((p & 1) ? 1 : -1) * (sw / 2 - 0.05);
          var pz = cz + ((p & 2) ? 1 : -1) * (sd / 2 - 0.05);
          B.dark.box(px, 1.02, pz, 0.07, 2.04, 0.07, 1.5, shD);
        }
        /* 棚の上の標本瓶・箱 */
        for (var q = 0; q < 7; q++) {
          var h = hash2(f.col * 7 + q, f.row * 13 + q);
          var lvl = 0.28 + ((q % 3) + 1) * 0.58;
          var ox = (h - 0.5) * (sw - 0.3), oz = (hash2(q, f.row) - 0.5) * (sd - 0.3);
          if (h < 0.5) B.dark.tube([cx + ox, lvl + 0.03, cz + oz], [cx + ox, lvl + 0.27, cz + oz], 0.09, 6, sh);
          else B.sheet.box(cx + ox, lvl + 0.15, cz + oz, 0.28, 0.24, 0.22, 2, shCard);
        }
        break;
      }
      case 'machine': {
        B.metal.box(cx, 0.82, cz, L(1.46, 1.12), 1.64, L(1.12, 1.46), 0.7, sh);
        B.dark.box(cx, 1.70, cz, L(1.10, 0.80), 0.14, L(0.80, 1.10), 1.0, shD);
        B.dark.tube([cx, 1.76, cz], [cx, 2.62, cz], 0.10, 6, shD);
        if (ew) {
          B.screen.grid([cx + 0.57, 1.18, cz + 0.30], [0, 0, -0.60], [0, 0.34, 0], 1, 1, 1, 1,
            function () { return [0.9, 0.9, 0.9]; });
        } else {
          B.screen.grid([cx - 0.30, 1.18, cz + 0.57], [0.60, 0, 0], [0, 0.34, 0], 1, 1, 1, 1,
            function () { return [0.9, 0.9, 0.9]; });
        }
        B.dark.box(cx + L(0.5, 0.4), 0.30, cz + L(0.4, 0.5), 0.24, 0.60, 0.24, 1.5, shD);
        break;
      }
      case 'tank': {
        B.metal.tube([cx, 0.18, cz], [cx, 2.18, cz], 0.58, 10, sh);
        B.dark.tube([cx, 2.18, cz], [cx, 2.30, cz], 0.62, 10, shD);
        B.dark.tube([cx, 0.06, cz], [cx, 0.20, cz], 0.62, 10, shD);
        B.dark.tube([cx + 0.5, 2.24, cz], [cx + 0.5, 2.66, cz], 0.07, 5, shD);
        B.dark.box(cx, 1.20, cz - 0.60, 0.34, 0.46, 0.06, 1.5, shD);
        break;
      }
      case 'console': {
        B.metal.box(cx, 0.38, cz, L(1.62, 0.86), 0.76, L(0.86, 1.62), 0.8, sh);
        B.dark.box(cx, 0.78, cz, L(1.66, 0.90), 0.06, L(0.90, 1.66), 0.8, shD);
        /* 斜めの操作盤の代わりに立てた画面2枚 */
        B.metal.box(cx, 1.06, cz - L(0, 0.30), L(1.30, 0.10), 0.50, L(0.10, 1.30), 1.0, sh);
        B.screen.grid(
          ew ? [cx - 0.06, 0.86, cz + 0.56] : [cx - 0.56, 0.86, cz - 0.26],
          ew ? [0, 0, -1.12] : [1.12, 0, 0], [0, 0.42, 0], 1, 1, 1, 1,
          function () { return [0.95, 0.95, 0.95]; });
        B.dark.box(cx, 0.84, cz + L(0, 0.28), L(0.9, 0.4), 0.05, L(0.4, 0.9), 2, shD);
        break;
      }
      /* ---- 見せ場①: 検体タンク（液中のシルエット・気泡・微発光） ---- */
      case 'specTank': {
        var tw = 1.56, td = 0.94, th = 2.66;
        /* 架台 */
        B.dark.box(cx, 0.13, cz, SX(tw + 0.12, td + 0.12), 0.26, SZ(tw + 0.12, td + 0.12), 1.2, shD);
        /* 筐体（前面だけ液体パネルに置き換わる） */
        B.metal.box(cx, 0.26 + th / 2, cz, SX(tw, td), th, SZ(tw, td), 0.8, sh);
        /* 前面の液体（自発光）。4種のアトラスからマスごとに選ぶ */
        var vi = (f.variant === undefined) ? ((hash2(f.col * 3 + 7, f.row * 5 + 1) * 4) | 0) : f.variant;
        facePanel(B.fluid, PX(0, td / 2 + 0.014), 0.26 + th / 2 - 0.06, PZ(0, td / 2 + 0.014),
          fv, tw - 0.26, th - 0.40, flat([1.00, 1.02, 1.00]), atlasUV(vi & 1, vi >> 1, 2));
        /* ガラスの押さえ枠 */
        B.dark.box(PX(0, td / 2 + 0.02), 0.26 + th - 0.14, PZ(0, td / 2 + 0.02),
          SX(tw - 0.18, 0.05), 0.10, SZ(tw - 0.18, 0.05), 2, shD);
        B.dark.box(PX(0, td / 2 + 0.02), 0.44, PZ(0, td / 2 + 0.02),
          SX(tw - 0.18, 0.05), 0.10, SZ(tw - 0.18, 0.05), 2, shD);
        B.dark.box(PX(tw / 2 - 0.09, td / 2 + 0.02), 1.55, PZ(tw / 2 - 0.09, td / 2 + 0.02),
          SX(0.10, 0.05), th - 0.42, SZ(0.10, 0.05), 2, shD);
        B.dark.box(PX(-tw / 2 + 0.09, td / 2 + 0.02), 1.55, PZ(-tw / 2 + 0.09, td / 2 + 0.02),
          SX(0.10, 0.05), th - 0.42, SZ(0.10, 0.05), 2, shD);
        /* 上部の機械と天井へ抜ける給液管 */
        B.dark.box(cx, 0.26 + th + 0.10, cz, SX(tw - 0.3, td - 0.2), 0.20, SZ(tw - 0.3, td - 0.2), 1.2, shD);
        B.dark.tube([PX(0.42, 0), 0.26 + th + 0.18, PZ(0.42, 0)], [PX(0.42, 0), 4.28, PZ(0.42, 0)], 0.075, 5, shD);
        B.dark.tube([PX(-0.42, 0), 0.26 + th + 0.18, PZ(-0.42, 0)], [PX(-0.42, 0), 4.28, PZ(-0.42, 0)], 0.06, 5, shD);
        /* 側面の制御端末 */
        B.metal.box(PX(tw / 2 + 0.05, -0.1), 1.28, PZ(tw / 2 + 0.05, -0.1),
          SX(0.10, 0.44), 0.36, SZ(0.10, 0.44), 1.6, sh);
        facePanel(B.screen, PX(tw / 2 + 0.11, -0.1), 1.30, PZ(tw / 2 + 0.11, -0.1),
          av, 0.34, 0.24, flat([0.88, 0.90, 0.88]));
        break;
      }
      /* ---- 見せ場②: 処置台（手術灯の下） ---- */
      case 'opTable': {
        var ow = 2.02, od = 0.94;
        var shDrape = shader(key, [1.30, 1.42, 1.58]);   /* 布地の黄ばみを打ち消して術野の白を出す */
        B.metal.box(cx, 0.82, cz, SX(ow, od), 0.08, SZ(ow, od), 1.0, sh);
        B.sheet.box(cx, 0.91, cz, SX(ow - 0.12, od - 0.10), 0.14, SZ(ow - 0.12, od - 0.10), 0.7, shDrape);
        /* 枕と拘束帯 */
        B.sheet.box(PX(-ow / 2 + 0.32, 0), 1.02, PZ(-ow / 2 + 0.32, 0),
          SX(0.42, 0.52), 0.14, SZ(0.42, 0.52), 1.4, shDrape);
        for (var st = 0; st < 3; st++) {
          B.dark.box(PX(-0.52 + st * 0.56, 0), 0.99, PZ(-0.52 + st * 0.56, 0),
            SX(0.09, od - 0.02), 0.06, SZ(0.09, od - 0.02), 2, shD);
        }
        /* 支柱と足 */
        B.dark.box(cx, 0.40, cz, SX(0.36, 0.36), 0.80, SZ(0.36, 0.36), 1.2, shD);
        B.dark.box(cx, 0.06, cz, SX(1.20, 0.66), 0.12, SZ(1.20, 0.66), 1.2, shD);
        /* 器械台と点滴スタンド */
        B.metal.box(PX(ow / 2 - 0.18, od / 2 + 0.24), 0.98, PZ(ow / 2 - 0.18, od / 2 + 0.24),
          SX(0.56, 0.40), 0.05, SZ(0.56, 0.40), 1.4, sh);
        B.dark.tube([PX(ow / 2 - 0.18, od / 2 + 0.24), 0, PZ(ow / 2 - 0.18, od / 2 + 0.24)],
          [PX(ow / 2 - 0.18, od / 2 + 0.24), 0.96, PZ(ow / 2 - 0.18, od / 2 + 0.24)], 0.028, 4, shD);
        for (var ins = 0; ins < 4; ins++) {
          B.dark.box(PX(ow / 2 - 0.36 + ins * 0.12, od / 2 + 0.24), 1.02,
            PZ(ow / 2 - 0.36 + ins * 0.12, od / 2 + 0.24), 0.045, 0.03, 0.24, 2, shD);
        }
        B.dark.tube([PX(-ow / 2 + 0.1, -od / 2 - 0.22), 0, PZ(-ow / 2 + 0.1, -od / 2 - 0.22)],
          [PX(-ow / 2 + 0.1, -od / 2 - 0.22), 1.86, PZ(-ow / 2 + 0.1, -od / 2 - 0.22)], 0.026, 4, shD);
        B.sheet.box(PX(-ow / 2 + 0.1, -od / 2 - 0.22), 1.66, PZ(-ow / 2 + 0.1, -od / 2 - 0.22),
          0.16, 0.28, 0.16, 2, shCard);
        /* P4.7: 処置台の上の遺体（DESIGN.md §4「処置室でカードキー」）。
           布に覆われた胴体・落ちた腕・胸ポケットのカードが正面から一目で読める構図。 */
        if (f.corpse) {
          var shSkin = shader(key, [1.16, 0.92, 0.84]);
          var shCloth = shader(key, [1.10, 1.16, 1.24]);
          var shPock = shader(key, [0.66, 0.72, 0.80]);
          /* 覆布に包まれた胴体（頭側が高く、脚側へ細くなる） */
          B.sheet.box(PX(-0.30, 0), 1.14, PZ(-0.30, 0), SX(0.94, 0.62), 0.34, SZ(0.94, 0.62), 1.0, shCloth);
          B.sheet.box(PX(0.52, 0), 1.06, PZ(0.52, 0), SX(0.86, 0.46), 0.20, SZ(0.86, 0.46), 1.0, shCloth);
          /* 露出した頭部と顎（布の縁から覗く） */
          B.metal.box(PX(-0.84, 0), 1.12, PZ(-0.84, 0), SX(0.30, 0.30), 0.30, SZ(0.30, 0.30), 1.6, shSkin);
          B.dark.box(PX(-0.90, 0), 1.09, PZ(-0.90, 0), SX(0.10, 0.20), 0.09, SZ(0.10, 0.20), 2, shD);
          /* 台から垂れた腕（指先が床に近い） */
          B.metal.tube([PX(-0.18, od / 2 - 0.06), 1.02, PZ(-0.18, od / 2 - 0.06)],
            [PX(-0.10, od / 2 + 0.30), 0.44, PZ(-0.10, od / 2 + 0.30)], 0.065, 6, shSkin);
          B.metal.box(PX(-0.08, od / 2 + 0.34), 0.38, PZ(-0.08, od / 2 + 0.34),
            SX(0.16, 0.18), 0.10, SZ(0.16, 0.18), 2, shSkin);
          /* 胸ポケットとカードキーの端（黄色い縁が布の上に出ている） */
          B.dark.box(PX(-0.52, 0.14), 1.32, PZ(-0.52, 0.14), SX(0.26, 0.20), 0.05, SZ(0.26, 0.20), 2, shPock);
          B.lamp.box(PX(-0.52, 0.14), 1.36, PZ(-0.52, 0.14), 0.16, 0.02, 0.16, 2,
            flat([0.52, 0.42, 0.10]));
        }
        break;
      }
      /* ---- 見せ場③: 培養器（琥珀色に光る棚が並ぶ） ---- */
      case 'incubator': {
        var iw = 1.46, id = 0.82, ih = 2.06;
        B.metal.box(cx, ih / 2, cz, SX(iw, id), ih, SZ(iw, id), 0.8, sh);
        B.dark.box(cx, 0.06, cz, SX(iw + 0.06, id + 0.06), 0.12, SZ(iw + 0.06, id + 0.06), 1.2, shD);
        /* 前面のガラス（発光）＋トレイの棚板 */
        facePanel(B.lamp, PX(0, id / 2 + 0.012), 1.22, PZ(0, id / 2 + 0.012), fv, iw - 0.26, 1.36,
          flat([0.40, 0.28, 0.11]));
        for (var tr = 0; tr < 4; tr++) {
          B.dark.box(PX(0, id / 2 + 0.02), 0.62 + tr * 0.36, PZ(0, id / 2 + 0.02),
            SX(iw - 0.24, 0.05), 0.055, SZ(iw - 0.24, 0.05), 2, shD);
          /* 棚のシャーレ */
          for (var dsh = 0; dsh < 3; dsh++) {
            var da = -0.42 + dsh * 0.42 + (hash2(f.col + tr, f.row + dsh) - 0.5) * 0.12;
            B.dark.box(PX(da, id / 2 + 0.03), 0.68 + tr * 0.36, PZ(da, id / 2 + 0.03),
              SX(0.22, 0.05), 0.07, SZ(0.22, 0.05), 2, shD);
          }
        }
        /* 枠と操作パネル */
        B.dark.box(PX(iw / 2 - 0.07, id / 2 + 0.02), 1.22, PZ(iw / 2 - 0.07, id / 2 + 0.02),
          SX(0.10, 0.05), 1.44, SZ(0.10, 0.05), 2, shD);
        B.dark.box(PX(-iw / 2 + 0.07, id / 2 + 0.02), 1.22, PZ(-iw / 2 + 0.07, id / 2 + 0.02),
          SX(0.10, 0.05), 1.44, SZ(0.10, 0.05), 2, shD);
        facePanel(B.screen, PX(0.36, id / 2 + 0.02), 2.20 - 0.28, PZ(0.36, id / 2 + 0.02),
          fv, 0.36, 0.20, flat([0.82, 0.84, 0.82]));
        break;
      }
      /* ---- 見せ場④: 動物実験の檻（3段積み） ---- */
      case 'cageStack': {
        var gw2 = 1.52, gd2 = 0.90;
        B.dark.box(cx, 0.10, cz, SX(gw2 + 0.08, gd2 + 0.08), 0.20, SZ(gw2 + 0.08, gd2 + 0.08), 1.2, shD);
        var shBar = shader(key, [1.35, 1.36, 1.34]);      /* 格子は周りより明るい金属 */
        var shIn = shader(key, [0.055, 0.060, 0.058]);    /* 檻の中は光が回らない＝格子が白く浮く */
        var shSide = shader(key, [0.42, 0.43, 0.42]);
        for (var tier = 0; tier < 3; tier++) {
          var by2 = 0.20 + tier * 0.78;
          /* 骨組みだけの檻: 背面・側面・上下の板と、正面の縦格子 */
          B.metal.box(PX(0, -gd2 / 2 + 0.04), by2 + 0.36, PZ(0, -gd2 / 2 + 0.04),
            SX(gw2, 0.08), 0.72, SZ(gw2, 0.08), 1.0, shIn);                       /* 背板 */
          B.metal.box(PX(gw2 / 2 - 0.04, 0), by2 + 0.36, PZ(gw2 / 2 - 0.04, 0),
            SX(0.08, gd2), 0.72, SZ(0.08, gd2), 1.0, shSide);                     /* 側板 */
          B.metal.box(PX(-gw2 / 2 + 0.04, 0), by2 + 0.36, PZ(-gw2 / 2 + 0.04, 0),
            SX(0.08, gd2), 0.72, SZ(0.08, gd2), 1.0, shSide);
          B.metal.box(cx, by2 + 0.70, cz, SX(gw2, gd2), 0.06, SZ(gw2, gd2), 1.0, shIn);  /* 天板 */
          B.metal.box(cx, by2 + 0.04, cz, SX(gw2, gd2), 0.08, SZ(gw2, gd2), 1.0, shIn);  /* 底の受け皿 */
          /* 中に残されたもの（毛布のかたまり・餌皿） */
          if (hash2(f.col * 5 + tier, f.row + tier * 7) < 0.6) {
            B.sheet.box(PX((hash2(tier, f.col) - 0.5) * 0.5, -0.06), by2 + 0.18,
              PZ((hash2(tier, f.col) - 0.5) * 0.5, -0.06),
              SX(0.50, 0.38), 0.20, SZ(0.50, 0.38), 1.6, shIn);
          }
          B.dark.tube([PX(gw2 / 2 - 0.36, 0.06), by2 + 0.09, PZ(gw2 / 2 - 0.36, 0.06)],
            [PX(gw2 / 2 - 0.36, 0.06), by2 + 0.14, PZ(gw2 / 2 - 0.36, 0.06)], 0.11, 6, shD);
          /* 正面の縦格子（7本）と横桟 */
          for (var bar = 0; bar < 7; bar++) {
            var ba = -gw2 / 2 + 0.13 + bar * ((gw2 - 0.26) / 6);
            B.dark.box(PX(ba, gd2 / 2 - 0.03), by2 + 0.37, PZ(ba, gd2 / 2 - 0.03),
              SX(0.05, 0.05), 0.62, SZ(0.05, 0.05), 3.0, shBar);
          }
          B.dark.box(PX(0, gd2 / 2 - 0.03), by2 + 0.66, PZ(0, gd2 / 2 - 0.03),
            SX(gw2 - 0.10, 0.06), 0.06, SZ(gw2 - 0.10, 0.06), 2, shBar);
          B.dark.box(PX(0, gd2 / 2 - 0.03), by2 + 0.08, PZ(0, gd2 / 2 - 0.03),
            SX(gw2 - 0.10, 0.06), 0.06, SZ(gw2 - 0.10, 0.06), 2, shBar);
          /* 掛け金と個体札 */
          B.metal.box(PX(gw2 / 2 - 0.18, gd2 / 2 + 0.03), by2 + 0.36, PZ(gw2 / 2 - 0.18, gd2 / 2 + 0.03),
            SX(0.07, 0.07), 0.18, SZ(0.07, 0.07), 2, shBar);
          if (hash2(f.col + tier, f.row * 3 + tier) < 0.7) {
            facePanel(B.paper, PX(-gw2 / 2 + 0.24, gd2 / 2 + 0.04), by2 + 0.50,
              PZ(-gw2 / 2 + 0.24, gd2 / 2 + 0.04), fv, 0.22, 0.28, shCard);
          }
        }
        /* 積み上がった檻の支柱 */
        for (var pst = 0; pst < 4; pst++) {
          var pa = ((pst & 1) ? 1 : -1) * (gw2 / 2 - 0.03);
          var pd = ((pst & 2) ? 1 : -1) * (gd2 / 2 - 0.03);
          B.dark.box(PX(pa, pd), 1.30, PZ(pa, pd), SX(0.07, 0.07), 2.60, SZ(0.07, 0.07), 1.5, shSide);
        }
        break;
      }
      /* ---- 見せ場⑤: 事務机（書類の山とモニタ） ---- */
      case 'desk': {
        var dw2 = 1.62, dd2 = 0.86;
        B.metal.box(cx, 0.74, cz, SX(dw2, dd2), 0.06, SZ(dw2, dd2), 0.9, sh);
        B.dark.box(PX(-dw2 / 2 + 0.30, 0), 0.36, PZ(-dw2 / 2 + 0.30, 0),
          SX(0.52, dd2 - 0.10), 0.70, SZ(0.52, dd2 - 0.10), 1.0, shD);
        for (var dl = 0; dl < 2; dl++) {
          var dx3 = dw2 / 2 - 0.08;
          B.dark.tube([PX(dx3, dd2 / 2 - 0.1 - dl * (dd2 - 0.2)), 0, PZ(dx3, dd2 / 2 - 0.1 - dl * (dd2 - 0.2))],
            [PX(dx3, dd2 / 2 - 0.1 - dl * (dd2 - 0.2)), 0.72, PZ(dx3, dd2 / 2 - 0.1 - dl * (dd2 - 0.2))],
            0.03, 4, shD);
        }
        /* 書類の山 */
        for (var pl = 0; pl < 4; pl++) {
          var ph2 = 0.06 + hash2(f.col + pl, f.row + pl * 3) * 0.20;
          B.sheet.box(PX(-0.30 + pl * 0.34, (hash2(pl, f.col) - 0.5) * 0.3), 0.77 + ph2 / 2,
            PZ(-0.30 + pl * 0.34, (hash2(pl, f.col) - 0.5) * 0.3),
            SX(0.30, 0.40), ph2, SZ(0.30, 0.40), 1.6, shCard);
        }
        /* モニタとキーボード */
        B.dark.box(PX(0.44, -0.16), 1.02, PZ(0.44, -0.16), SX(0.52, 0.10), 0.42, SZ(0.52, 0.10), 1.2, shD);
        facePanel(B.screen, PX(0.44, -0.16 + 0.06), 1.03, PZ(0.44, -0.16 + 0.06), fv, 0.46, 0.34,
          flat([0.30, 0.32, 0.30]));
        B.dark.tube([PX(0.44, -0.16), 0.77, PZ(0.44, -0.16)], [PX(0.44, -0.16), 0.82, PZ(0.44, -0.16)], 0.09, 5, shD);
        B.dark.box(PX(0.40, 0.24), 0.79, PZ(0.40, 0.24), SX(0.42, 0.18), 0.03, SZ(0.42, 0.18), 2, shD);
        /* 卓上灯（笠つき。光る面は下向きだけ） */
        B.dark.tube([PX(-0.62, -0.22), 0.77, PZ(-0.62, -0.22)], [PX(-0.62, -0.22), 1.16, PZ(-0.62, -0.22)], 0.022, 4, shD);
        B.dark.box(PX(-0.62, -0.10), 1.20, PZ(-0.62, -0.10), SX(0.34, 0.26), 0.13, SZ(0.34, 0.26), 2, shD);
        B.lamp.grid([PX(-0.62, -0.10) - 0.13, 1.135, PZ(-0.62, -0.10) - 0.10],
          [0.26, 0, 0], [0, 0, 0.20], 1, 1, 1, 1, flat([0.78, 0.66, 0.40]));
        break;
      }
      /* ---- 見せ場⑤: 書庫（書類箱が溢れている） ---- */
      case 'fileCab': {
        var fw = 1.10, fd = 0.72, fh = 1.86;
        B.metal.box(cx, fh / 2, cz, SX(fw, fd), fh, SZ(fw, fd), 0.9, sh);
        for (var dr = 0; dr < 4; dr++) {
          B.dark.box(PX(0, fd / 2 + 0.012), 0.30 + dr * 0.44, PZ(0, fd / 2 + 0.012),
            SX(fw - 0.10, 0.03), 0.36, SZ(fw - 0.10, 0.03), 1.6, shD);
          B.dark.box(PX(0, fd / 2 + 0.04), 0.30 + dr * 0.44, PZ(0, fd / 2 + 0.04),
            SX(0.30, 0.05), 0.05, SZ(0.30, 0.05), 2, shD);
        }
        /* 最上段が開いて書類がはみ出している */
        B.sheet.box(PX(0, fd / 2 + 0.16), 1.66, PZ(0, fd / 2 + 0.16),
          SX(fw - 0.18, 0.34), 0.22, SZ(fw - 0.18, 0.34), 1.6, shCard);
        /* 上に積まれた箱 */
        B.sheet.box(PX(-0.16, 0), fh + 0.18, PZ(-0.16, 0), SX(0.74, 0.56), 0.36, SZ(0.74, 0.56), 1.2, shCard);
        B.sheet.box(PX(0.22, 0.08), fh + 0.44, PZ(0.22, 0.08), SX(0.52, 0.44), 0.26, SZ(0.52, 0.44), 1.2, shCard);
        break;
      }
      case 'crate':
      default: {
        B.sheet.box(cx - 0.18, 0.36, cz, 0.84, 0.72, 0.84, 1.0, shCard);
        B.sheet.box(cx + 0.36, 0.26, cz + 0.32, 0.60, 0.52, 0.56, 1.0, shCard);
        B.dark.box(cx - 0.2, 0.85, cz, 0.96, 0.03, 0.96, 1.5, shD);
        break;
      }
    }
    setYBias(0);
  };

  /* ---------------- 毎フレーム ---------------- */

  /**
   * 明滅のパターン（契約 §3 第2改訂「パターンを複数持たせる」）。
   *   0 不規則な瞬き / 1 バースト（長い消灯→連続明滅）/ 2 切れかけの断続 / 3 脈動＋ジッタ
   * t はゲーム内時刻(s)。__pump でも実時間でも同じ絵になるよう絶対時刻で駆動する。
   */
  function flickerLevel(pattern, phase, t) {
    var u = t + phase * 13.7;
    var lvl;
    if (pattern === 0) {
      var step = Math.floor(u * 17);
      var r = hash2(step, (phase * 1000) | 0);
      lvl = (r > 0.28) ? 1 : 0.04;
      if (r > 0.28 && r < 0.40) lvl = 0.42;
      lvl *= 0.86 + 0.14 * Math.sin(u * 61);
    } else if (pattern === 1) {
      var cyc = 3.4, p = (u % cyc) / cyc;
      if (p < 0.62) {
        lvl = 0.03 + 0.02 * Math.sin(u * 3.1);
      } else {
        var st = Math.floor(u * 26);
        lvl = (hash2(st, 77) > 0.35) ? 1 : 0.10;
      }
    } else if (pattern === 2) {
      var st2 = Math.floor(u * 9);
      var h = hash2(st2, 131);
      lvl = (h > 0.80) ? 1 : ((h > 0.62) ? 0.30 : 0.05);
      lvl *= 0.80 + 0.20 * Math.sin(u * 47);
    } else {
      lvl = 0.42 + 0.42 * Math.sin(u * 2.6) + 0.12 * Math.sin(u * 23.3);
      if (hash2(Math.floor(u * 7), 211) > 0.90) lvl = 0.05;
      if (lvl < 0.03) lvl = 0.03;
      if (lvl > 1) lvl = 1;
    }
    return lvl;
  }

  /**
   * 器具1つの現在の明るさ(0..1)。P4.5の蛍光灯ジー音が明滅に同期するための参照口。
   * flicker 以外は状態そのままの固定値を返す。
   */
  World.prototype.flickerLevelAt = function (f, t) {
    if (!f) return 0;
    if (f.state === 'off') return 0;
    if (f.state !== 'flicker') return 1;
    if (this._flickByGroup === undefined || this._flickByGroupN !== this.flickers.length) {
      this._flickByGroup = Object.create(null);
      for (var i = 0; i < this.flickers.length; i++) this._flickByGroup[this.flickers[i].group] = this.flickers[i];
      this._flickByGroupN = this.flickers.length;
    }
    var e = this._flickByGroup[f.fgroup];
    if (!e) return 1;
    return flickerLevel(e.pattern, e.phase, t);
  };

  World.prototype.update = function (t) {
    for (var i = 0; i < this.flickers.length; i++) {
      var e = this.flickers[i];
      var lvl = flickerLevel(e.pattern, e.phase, t);
      for (var m = 0; m < e.mats.length; m++) e.mats[m].color.setScalar(lvl);
    }
  };

  World.prototype.dispose = function () {
    for (var i = 0; i < this.disposables.length; i++) {
      var d = this.disposables[i];
      if (d && d.dispose) d.dispose();
    }
    this.disposables.length = 0;
    this.group.clear ? this.group.clear() : (this.group.children.length = 0);
    if (this.group.parent) this.group.parent.remove(this.group);
  };

  /* ================================================================
   * 外部モジュール向けの公開フック（P4.10b の罠が同じ焼き込み照明で小物を積む）。
   * World 自身は使わない。造形の流儀（Builder / 接地AO / 区画の色味）を共有するための口。
   * ============================================================== */

  /**
   * 小物用の shade 関数。col,row のマスから見える器具だけを積む＋接地AO＋区画の色味。
   * aoBase は足元の暗さ（既定 0.42＝什器の流儀）。缶や床板のような**背の低い小物**は
   * 全高が接地AOの帯に収まってしまい真っ黒に沈むので、0.85 前後を渡して浅くする。
   */
  World.prototype.propShader = function (col, row, tint, aoBase) {
    var self = this, scratch = [0, 0, 0];
    var owner = this._ownerOf(col, row);
    var ti = tint || this._tintAt(col, row);
    var base = this.map.cellFloorY(col, row);
    var a0 = (aoBase === undefined) ? 0.42 : aoBase;
    return function (x, y, z, nx, ny, nz) {
      self._shade(x, y, z, nx === undefined ? 0 : nx, ny === undefined ? 1 : ny,
        nz === undefined ? 0 : nz, owner, undefined, scratch);
      var a = (y - base) / 0.95;
      if (a > 1) a = 1; else if (a < 0) a = 0;
      a = a0 + (1 - a0) * a;
      return [scratch[0] * ti[0] * a, scratch[1] * ti[1] * a, scratch[2] * ti[2] * a];
    };
  };

  /** 床デカール用（法線は上向き固定・接地AOなし） */
  World.prototype.decalShader = function (col, row, tint) {
    var self = this, scratch = [0, 0, 0];
    var owner = this._ownerOf(col, row);
    var ti = tint || [1, 1, 1];
    return function (x, y, z) {
      self._shade(x, y, z, 0, 1, 0, owner, undefined, scratch);
      return [scratch[0] * ti[0], scratch[1] * ti[1], scratch[2] * ti[2]];
    };
  };

  World.Builder = Builder;
  World.buildMesh = buildMesh;
  World.setYBias = setYBias;

  World.FOG_COLOR = FOG_COLOR;
  World.LIGHT_R = LIGHT_R;
  /* 照明の調整定数（契約 §3 の輝度ゲートに合わせる。P7 で全エリア通しで再調整する）。
   * 値を書き換えて new ESCAPE.World(map) し直すと効く＝キャリブレーションに使える。 */
  World.LIGHT_TUNING = {
    get offLevel() { return OFF_LEVEL; }, set offLevel(v) { OFF_LEVEL = v; },
    get flickerLevel() { return FLICKER_LEVEL; }, set flickerLevel(v) { FLICKER_LEVEL = v; },
    get lightR() { return LIGHT_R; }, set lightR(v) { LIGHT_R = v; },
    get lightGain() { return LIGHT_GAIN; }, set lightGain(v) { LIGHT_GAIN = v; },
    get ambient() { return AMBIENT; }, set ambient(v) { AMBIENT = v; },
    zoneOff: ZONE_OFF, zoneGain: ZONE_GAIN, zoneFlicker: ZONE_FLICKER
  };
  ESCAPE.World = World;
})(window);
