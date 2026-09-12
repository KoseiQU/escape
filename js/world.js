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

  /* ================================================================
   * P5c: 区画の景観をマップのデータで差し替える（契約 §4 P5「zoneStyles の形」）
   *   map.meta.zoneStyles があれば ZONE_TEX / ZONE_TINT / ZONE_LAMP /
   *   ZONE_FLICKER / ZONE_OFF / ZONE_GAIN の代わりに使う。
   *   map.meta.regionTints があれば REGION_TINT の代わりに使う。
   *   **無ければ上の表をそのまま使う**＝ area1 の見た目は1ピクセルも変わらない。
   * ============================================================== */
  var ZONE_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
  /** 1区画ぶんの景観を正規化する（欠けた項目は既存の表で埋める） */
  function normZoneStyle(z, s) {
    var base = {
      ceil: 'ceil',
      tex: ZONE_TEX[z] || DEFAULT_TEX,
      tint: ZONE_TINT[z] || DEFAULT_TINT,
      lamp: ZONE_LAMP[z] || LAMP_COLORS[0],
      flicker: ZONE_FLICKER[z] || 0,
      off: ZONE_OFF[z] || 0,
      gain: (ZONE_GAIN[z] === undefined) ? 1 : ZONE_GAIN[z],
      reach: 1
    };
    if (!s) return base;
    var tex = base.tex;
    if (s.floor || s.walls) {
      tex = { floor: s.floor || base.tex.floor, walls: s.walls || base.tex.walls };
    }
    return {
      ceil: s.ceil || base.ceil,
      tex: tex,
      tint: s.tint || base.tint,
      lamp: s.lamp || base.lamp,
      flicker: (s.flicker === undefined) ? base.flicker : s.flicker,
      off: (s.off === undefined) ? base.off : s.off,
      gain: (s.gain === undefined) ? base.gain : s.gain,
      /* 灯具の到達半径の倍率。下水道は器具が遠いので広く投げる（既定 1＝area1 不変） */
      reach: (s.reach === undefined) ? base.reach : s.reach
    };
  }
  /** マップ1枚ぶんの景観表（World の生成時に1回だけ作る） */
  function buildStyles(meta) {
    var zs = (meta && meta.zoneStyles) || null;
    var out = Object.create(null);
    for (var i = 0; i < ZONE_KEYS.length; i++) {
      var z = ZONE_KEYS[i];
      out[z] = normZoneStyle(z, zs ? zs[z] : null);
    }
    return out;
  }

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

  /**
   * P4.11 項目3「罠は道の端で回避可能」の帯。マス中心からの半幅を軸ごとに返す。
   * 狭めるのは「壁に挟まれている軸」＝端を歩いて避けられる軸だけ。
   * 例: 東西の通路（南北が壁）なら Z を 0.6m に狭め、X は通路なので全幅のまま
   *     ＝通路を走れば必ず踏み、北/南の壁際を歩けば踏まない。
   * どちらの軸にも壁が無い広間では両軸を狭める（マスの隅を通れば避けられる）。
   * 半幅の値そのものは js/traps.js の TRAP_TUNING.stepBand が正。
   * 造形（world）・発火（traps / enemy_ai）が全部この1か所を見る。
   */
  function stepBandHalf(map, col, row) {
    var T = map.tileSize;
    var b = (ESCAPE.TRAP_TUNING && ESCAPE.TRAP_TUNING.stepBand) || 0.60;
    var bx = map.isSolid(col - 1, row) || map.isSolid(col + 1, row);
    var bz = map.isSolid(col, row - 1) || map.isSolid(col, row + 1);
    if (!bx && !bz) { bx = true; bz = true; }
    return { x: bx ? b : T / 2, z: bz ? b : T / 2, bx: bx, bz: bz };
  }

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

  /* ================================================================
   * P4.17 段階2「質感と光」— js/render_quality.js（ESCAPE.RQ）との連絡
   *   Y（既定）: 大面（床・壁・天井）を MeshStandardMaterial にし、
   *              頂点色＝アルベド／焼き込み光＝bakedLight 属性に分けて持つ。
   *              焼き込み光は uBakedMix 倍だけ残し、残りを近傍灯の実ライトが載せる。
   *   X（退避）: 大面にテクセル・ライトマップ（uv1）を張る。素材は Basic のまま。
   *   off      : P4.16 までと同じ（頂点色＝アルベド×焼き込み光）。
   * ============================================================== */
  var Y_ON = false;          /* 系統Y（大面を PBR にする） */
  var X_ON = false;          /* 系統X（テクセル・ライトマップ） */
  var Y_MIX = 1;             /* 焼き込みに残す割合（残りは実ライト） */
  var Y_PB = 2.70;           /* 二乗則側の基準（灯と同じ減衰形の強さ） */
  var X_AMB = 0;             /* 系統X: ライトマップへ足す環境光の底上げ */
  /* 大面＝Y で PBR・X でライトマップを張る素材キー */
  var BIG_TEX = {
    floor: 1, floorTile: 1, floorWet: 1, floorMetal: 1, ceil: 1,
    wall: 1, wall2: 1, wall3: 1, wallPaint: 1, wallMetal: 1,
    /* P5c エリア2「下水道」の大面（素材は js/textures.js / js/render_quality.js の P5b-B 製） */
    wallBrick: 1, wallStone: 1, wallConcreteWet: 1,
    floorStoneWet: 1, floorBrick: 1, floorMud: 1,
    /* 水底も大面（壁床と同じ明るさ系統に乗せる）。水面は専用材質なので別扱い */
    waterBed: 1,
    /* 水面は RQ.waterMaterial（法線2層）。bakedLight 属性を持たせるためここに入れる */
    sewerWater: 1
  };
  /**
   * shade() が「アルベド」と「焼き込み光」を分けて渡すための一時領域。
   * 大面のビルダーだけがこれを読む。書かない shade（＝既に最終色を返す造形）は
   * on=false のままなので、従来どおり戻り値をそのまま頂点色にする。
   */
  var SPLIT = { on: false, want: false, a: [0, 0, 0], l: [1, 1, 1] };
  function splitSet(tint, ao, light) {
    SPLIT.on = true;
    for (var i = 0; i < 3; i++) {
      var t = tint[i];
      /* アルベドは1を超えさせない。1超ぶんは光側へ回す＝積は元のまま */
      SPLIT.a[i] = (t > 1 ? 1 : t) * ao;
      SPLIT.l[i] = light[i] * (t > 1 ? t : 1);
    }
  }

  /* 系統X: ライトマップの uv1 割り当て。LM が張られている面はその矩形へ、
   * それ以外の面は「白タイル」を指す（白＝1.0＝lightMap が何も変えない）。 */
  var LM_ON = false;
  var LM = null;
  var LM_WHITE_U = 0, LM_WHITE_V = 0;
  function lmWhiteShade() { return [1, 1, 1]; }

  /** u x v の正規化（面の表向き。cross(u,v) が法線と同じ向きに渡す規約） */
  function crossN(u, v) {
    var x = u[1] * v[2] - u[2] * v[1];
    var y = u[2] * v[0] - u[0] * v[2];
    var z = u[0] * v[1] - u[1] * v[0];
    var l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  function Builder(big) {
    this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0;
    /* big=true のときだけ余分に持つ（アルベドと焼き込み光の分離・法線・uv1） */
    this.big = !!big;
    this.bake = []; this.uv1 = []; this.blocks = [];
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
        if (LM_ON) {
          if (LM) this.uv1.push(LM.u0 + LM.du * s, LM.v0 + LM.dv * t);
          else this.uv1.push(LM_WHITE_U, LM_WHITE_V);
        }
        SPLIT.on = false; SPLIT.want = this.big;
        var c = shade(x, y, z);
        if (this.big) {
          if (SPLIT.on) {
            this.col.push(SPLIT.a[0], SPLIT.a[1], SPLIT.a[2]);
            this.bake.push(SPLIT.l[0], SPLIT.l[1], SPLIT.l[2]);
          } else {
            /* 分離を書かない造形（既に最終色）は「アルベド＝その色・光＝1」とする */
            this.col.push(c[0], c[1], c[2]);
            this.bake.push(1, 1, 1);
          }
        } else {
          this.col.push(c[0], c[1], c[2]);
        }
        this.n++;
      }
    }
    if (this.big) this.blocks.push({ b: base, w: nu + 1, h: nv + 1, n: crossN(u, v) });
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
        if (LM_ON) this.uv1.push(LM_WHITE_U, LM_WHITE_V);
        this.uv.push(k / seg * 2, e * len * 0.5);
        SPLIT.on = false; SPLIT.want = false;
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

  /**
   * P4.17 段階2-3 ③「大面の法線スムージング」。
   * 1) 面ごとの格子の**中心差分**で法線を出す（三角形分割に依らない＝
   *    斜路やたわみでも面ごとのフラット陰影にならない）。
   * 2) 同じ位置に重なる頂点（＝隣のマスとの継ぎ目）の法線を、
   *    向きが60度以内のものだけ平均する（壁と床の直角は丸めない）。
   */
  var SMOOTH_COS = 0.5;          /* 60度 */
  Builder.prototype.finishNormals = function () {
    var n = this.n, P = this.pos;
    var N = new Float32Array(n * 3);
    var bl = this.blocks, k, i, j;
    for (k = 0; k < bl.length; k++) {
      var B0 = bl[k], b = B0.b, w = B0.w, h = B0.h, fn = B0.n;
      for (j = 0; j < h; j++) {
        for (i = 0; i < w; i++) {
          var i0 = (i > 0 ? i - 1 : i), i1 = (i < w - 1 ? i + 1 : i);
          var j0 = (j > 0 ? j - 1 : j), j1 = (j < h - 1 ? j + 1 : j);
          var a = (b + j * w + i1) * 3, c = (b + j * w + i0) * 3;
          var d = (b + j1 * w + i) * 3, e = (b + j0 * w + i) * 3;
          var ux = P[a] - P[c], uy = P[a + 1] - P[c + 1], uz = P[a + 2] - P[c + 2];
          var vx = P[d] - P[e], vy = P[d + 1] - P[e + 1], vz = P[d + 2] - P[e + 2];
          var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          var len = Math.hypot(nx, ny, nz);
          if (len < 1e-9) { nx = fn[0]; ny = fn[1]; nz = fn[2]; }
          else {
            nx /= len; ny /= len; nz /= len;
            if (nx * fn[0] + ny * fn[1] + nz * fn[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
          }
          var o = (b + j * w + i) * 3;
          N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
        }
      }
    }
    /* 継ぎ目のスムージング（5mm 格子で同一位置とみなす） */
    var map = new Map(), key;
    var Q = 200;   /* 1m を 200 分割＝5mm */
    for (i = 0; i < n; i++) {
      var p = i * 3;
      key = (Math.round(P[p] * Q) * 32768 + Math.round(P[p + 1] * Q)) * 32768 + Math.round(P[p + 2] * Q);
      var lst = map.get(key);
      if (lst) lst.push(i); else map.set(key, [i]);
    }
    var out = new Float32Array(N.length);
    map.forEach(function (lst) {
      if (lst.length === 1) {
        var s = lst[0] * 3;
        out[s] = N[s]; out[s + 1] = N[s + 1]; out[s + 2] = N[s + 2];
        return;
      }
      for (var q = 0; q < lst.length; q++) {
        var oi = lst[q] * 3;
        var sx = 0, sy = 0, sz = 0;
        for (var r = 0; r < lst.length; r++) {
          var ri = lst[r] * 3;
          if (N[oi] * N[ri] + N[oi + 1] * N[ri + 1] + N[oi + 2] * N[ri + 2] < SMOOTH_COS) continue;
          sx += N[ri]; sy += N[ri + 1]; sz += N[ri + 2];
        }
        var l2 = Math.hypot(sx, sy, sz);
        if (l2 < 1e-9) { out[oi] = N[oi]; out[oi + 1] = N[oi + 1]; out[oi + 2] = N[oi + 2]; }
        else { out[oi] = sx / l2; out[oi + 1] = sy / l2; out[oi + 2] = sz / l2; }
      }
    });
    return out;
  };

  function buildMesh(b, material) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
    if (b.uv1.length === b.n * 2) {
      geo.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(b.uv1), 2));
    }
    if (b.big && b.bake.length === b.n * 3) {
      geo.setAttribute('bakedLight', new THREE.BufferAttribute(new Float32Array(b.bake), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(b.finishNormals(), 3));
    }
    geo.setIndex(b.idx);
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, material);
  }

  /* ================================================================
   * World
   * ============================================================== */
  function World(map) {
    this.map = map;
    /* P5c: 区画の景観（zoneStyles / regionTints）。無ければ既存の表＝area1 は不変 */
    this.styles = buildStyles(map.meta);
    this.regionTints = (map.meta && map.meta.regionTints) || REGION_TINT;
    /* 環境光の倍率（マップ別。既定 1＝area1 は不変）。下水道は器具が遠いので底を少し上げる */
    this._ambK = (map.meta && map.meta.ambientScale) || 1;
    this.group = new THREE.Group();
    this.disposables = [];
    this.flickers = [];
    this.sensorLamps = [];                  /* P4.13: 点滅する表示灯（InstancedMesh 1体） */
    this.saveLamps = [];                    /* P4.14: 記録端末の緑ランプ（InstancedMesh 1体） */
    this.stats = { triangles: 0, drawGroups: 0, fixtures: 0, buildMs: 0,
      lmBytes: 0, lmBakeMs: 0, lmTiles: 0 };
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
          var st0 = this._style(this._zoneAt(c, r));
          var offL = OFF_LEVEL + st0.off;
          var fl = offL + (FLICKER_LEVEL - OFF_LEVEL) + st0.flicker;
          state = (v < offL) ? 'off' : ((v < fl) ? 'flicker' : 'on');
        }
        /* 区画ごとの色温度（契約 §4「区画ごとの景観差」）。管の劣化で更に個体差をつける */
        var zl = this._style(this._zoneAt(c, r)).lamp;
        var wob = (hash2(c + 5, r + 3) < 0.20) ? -0.08 : ((hash2(c + 91, r + 7) < 0.12) ? 0.07 : 0.00);
        var lampCol = { r: Math.min(1, zl.r * (1 + wob)), g: Math.min(1, zl.g), b: Math.min(1, zl.b * (1 - wob)) };
        var fy = map.cellFloorY(c, r), ch = map.ceilHAt(c, r);
        list.push({
          kind: 'lamp',
          col: c, row: r, x: (c + 0.5) * T, z: (r + 0.5) * T,
          fy: fy, ch: ch, y: fy + ch - LIGHT_DROP,
          state: state, color: lampCol,
          R: LIGHT_R * this._style(this._zoneAt(c, r)).reach,
          gain: LIGHT_GAIN * this._style(this._zoneAt(c, r)).gain,
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
        if (ov[o].gain) list[best].gain = LIGHT_GAIN * this._style(this._zoneAt(list[best].col, list[best].row)).gain * ov[o].gain;
        if (ov[o].reach) list[best].R = LIGHT_R * this._style(this._zoneAt(list[best].col, list[best].row)).reach * ov[o].reach;
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
    /* 系統X: 遮蔽格子を 0.5m に詰め、ぼかしを 5x5 に広げて影の縁に半影を作る
     * （テクセル単位の焼き込みでしか見えない差） */
    var fine = X_ON;
    var S = fine ? (VIS_STEP * 0.5) : VIS_STEP, pad = f.R + S;
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
    var K = fine ? 2 : 1;
    for (var jj = 0; jj < h; jj++) {
      for (var ii = 0; ii < w; ii++) {
        var sum = 0, n = 0;
        for (var dj = -K; dj <= K; dj++) {
          for (var di = -K; di <= K; di++) {
            var a = ii + di, b = jj + dj;
            if (a < 0 || b < 0 || a >= w || b >= h) continue;
            var wgt = fine ? (1 / (1 + di * di + dj * dj)) : ((di === 0 && dj === 0) ? 2 : 1);
            sum += raw[b * w + a] * wgt; n += wgt;
          }
        }
        vis[jj * w + ii] = sum / n;
      }
    }
    f.vis = vis; f.vx0 = x0; f.vz0 = z0; f.vw = w; f.vh = h; f.vs = S;
  };

  World.prototype._visAt = function (f, x, z) {
    var S = f.vs || VIS_STEP;
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
  /** 従来の減衰（光溜まりの縁を早く落とす） */
  function classicFall(d, R) {
    var f = 1 - d / R;
    return f * f * (0.35 + 0.65 * f);
  }
  /**
   * P4.17 段階2: 近傍灯（PointLight decay=2・distance=R）と同じ形の減衰。
   * 窓は three.js の getDistanceAttenuation と同式にする＝
   * 実ライトと焼き込みで光の広がりが食い違わない（弱点①の「明るさ二重」対策）。
   */
  function pointFall(d, R) {
    var q = d / R;
    q = 1 - q * q * q * q;
    if (q < 0) q = 0;
    var dd = d * d;
    if (dd < 0.0625) dd = 0.0625;
    return Y_PB * q * q / dd;
  }

  World.prototype._shade = function (px, py, pz, nx, ny, nz, ownerKey, onlyIdx, out, classicOnly) {
    var lights = this.lightIndex[ownerKey];
    var r, g, b;
    if (onlyIdx === undefined) {
      /* 上向き面は床の反射を、下向き面は落ち込みを表現する */
      var up = (ny + 1) * 0.5;
      var amb = (0.62 + 0.5 * up) * this._ambK;
      r = AMBIENT.r * amb; g = AMBIENT.g * amb; b = AMBIENT.b * amb;
      if (X_AMB > 0) { r += X_AMB * 0.82; g += X_AMB * 0.94; b += X_AMB * 1.18; }
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
        var fall = classicFall(d, f.R);
        if (Y_ON && !classicOnly) fall = Y_MIX * fall + (1 - Y_MIX) * pointFall(d, f.R);
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
  /** その区画の景観（zoneStyles か既存の表）。必ず全項目が埋まっている */
  World.prototype._style = function (zone) {
    return this.styles[zone] || this.styles.A;
  };
  World.prototype._zoneTex = function (col, row) { return this._style(this._zoneAt(col, row)).tex; };
  World.prototype._tintAt = function (col, row) {
    var id = this._regionAt(col, row);
    var rt = this.regionTints;
    if (id && rt[id]) return rt[id];
    return this._style(this._zoneAt(col, row)).tint;
  };

  /* ---------------- 本体 ---------------- */

  World.prototype._build = function () {
    var t0 = (global.performance ? performance.now() : Date.now());
    var map = this.map, T = map.tileSize, H = map.wallHeight;
    var TILE = ESCAPE.TILE;
    var self = this;

    /* ---- P4.17 段階2: 描画品質の段階を読む（既定＝Y＋Z） ---- */
    var RQ = ESCAPE.RQ;
    Y_ON = !!(RQ && RQ.isY());
    X_ON = !!(RQ && RQ.isX());
    Y_MIX = RQ ? RQ.bakeMix() : 1;
    Y_PB = RQ ? RQ.tune.pointBase : Y_PB;
    X_AMB = (X_ON && RQ) ? RQ.tune.xamb : 0;
    /* 明滅の加算メッシュも焼き込みと同じ割合に落とす（実ライト側が残りを出す） */
    this.flickScale = (Y_ON ? Y_MIX : 1) * (RQ ? RQ.addLightScale() : 1);
    this.lightingMode = Y_ON ? 'dynamic' : 'baked';
    LM_ON = false; LM = null;

    this._bakeAO();
    this.fixtures = this._placeFixtures();
    this._assignFlickerGroups();
    this.lightIndex = this._buildLightIndex();
    this.stats.fixtures = this.fixtures.length;

    /* ---- 系統X（退避先）: 面ごとの小さなライトマップを1枚のアトラスへ敷き詰める ---- */
    var atlas = null, LMR = 0, LMRW = 0;
    var lmJobs = [];
    if (X_ON) {
      LMR = RQ.lmRes;
      LMRW = Math.round(LMR * (map.wallHeight / T));
      var nFC = 0, nW = 0;
      for (var rz0 = 0; rz0 < map.height; rz0++) {
        for (var cz0 = 0; cz0 < map.width; cz0++) {
          if (map.isWalkable(cz0, rz0)) nFC += 2;
          if (!map.isSolid(cz0, rz0)) continue;
          if (map.isWalkable(cz0 + 1, rz0)) nW++;
          if (map.isWalkable(cz0 - 1, rz0)) nW++;
          if (map.isWalkable(cz0, rz0 + 1)) nW++;
          if (map.isWalkable(cz0, rz0 - 1)) nW++;
        }
      }
      var area = nFC * (LMR + 2) * (LMR + 2) + nW * (LMR + 2) * (LMRW + 2);
      var side = Math.ceil(Math.sqrt(area * 1.22) / 64) * 64;
      if (side > 4096) side = 4096;
      atlas = new RQ.LightmapAtlas(side);
      LM_ON = true; LM = null;
      LM_WHITE_U = atlas.whiteU; LM_WHITE_V = atlas.whiteV;
      this._atlas = atlas;
    }
    /** ライトマップのタイルを確保して uv1 を張る（面の直前に呼ぶ） */
    function lmBegin(w2, h2) {
      if (!atlas) return null;
      var r2 = atlas.alloc(w2, h2);
      if (!r2) { LM = null; return null; }
      LM = { u0: r2.x / atlas.size, v0: r2.y / atlas.size, du: r2.w / atlas.size, dv: r2.h / atlas.size };
      return r2;
    }
    function lmEnd() { LM = null; }
    /** 焼き込みは面を全部積んでから一括で行う（build の山を分ける） */
    function lmJob(r2, o2, u2, v2, deform2, shadeFn) {
      if (r2) lmJobs.push({ r: r2, o: o2, u: u2, v: v2, d: deform2, s: shadeFn });
    }
    self._lmBegin = lmBegin; self._lmEnd = lmEnd; self._lmJob = lmJob;
    self._lmRes = function () { return { r: LMR, rw: LMRW, on: !!atlas }; };

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
      return g2[texKey] || (g2[texKey] = new Builder(Y_ON && !!BIG_TEX[texKey]));
    }
    var B = {};
    Object.defineProperty(B, 'floor', { get: function () { return bag(self._style(curZone).tex.floor); } });
    Object.defineProperty(B, 'wall', { get: function () { return bag(self._style(curZone).tex.walls[0]); } });
    Object.defineProperty(B, 'wall2', { get: function () { return bag(self._style(curZone).tex.walls[1]); } });
    Object.defineProperty(B, 'wall3', { get: function () { return bag(self._style(curZone).tex.walls[2]); } });
    /* 天井も区画ごとに差し替えられる（既定 'ceil'＝area1 の白い天井） */
    Object.defineProperty(B, 'ceil', { get: function () { return bag(self._style(curZone).ceil); } });
    ['litter', 'poster', 'sign', 'zonesign', 'metal', 'dark', 'lamp', 'screen',
      'paper', 'sheet', 'fluid', 'board', 'monitors', 'water', 'glass', 'hatch', 'blood',
      /* P5c エリア2「下水道」: 水面・水底・格子・ぬめり・配管・銘板（area2 版） */
      'sewerWater', 'waterBed', 'grate', 'slime', 'pipe', 'zonesignA2',
      /* P4.16 レーンA: 大型掲示板の紙面と、増補した血痕3種。
         P4.17 項目1: 壁に貼る飛沫は床デカールと別の集合 'bloodSplatWall' にする
         （床デカールの「全三角形が上を向く」検査の対象は床だけ、という意図を保つため）。 */
      'bigboard', 'bloodHand', 'bloodDrag', 'bloodSplat', 'bloodSplatWall']
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
    /* 大面（Y で PBR にする面）の焼き込みは「近傍灯が載せるぶんを含まない素の焼き」
     * ＝ classicOnly。素材側の uBakedMix で残す割合を掛ける。
     * 小道具・什器・デカールは焼き込みのままだが、減衰を灯と同じ形に混ぜて
     * 明るさの系統を壁床に揃える（契約 段階2-3 ①）。 */
    /** shade関数を作る（tint × 接地AO） */
    function shader(ownerKey, tint, only) {
      return function (x, y, z, nx, ny, nz) {
        var a = propAO(y);
        if (Y_ON && SPLIT.want) {
          self._shade(x, y, z, nx, ny, nz, ownerKey, only, scratch, true);
          splitSet(tint, a, scratch);
        }
        self._shade(x, y, z, nx, ny, nz, ownerKey, only, scratch);
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
        var ao = self._aoFloor(x, z);
        var a = ao * lv;
        if (Y_ON && SPLIT.want) {
          self._shade(x, y, z, n[0], n[1], n[2], ownerKey, only, scratch, true);
          scratch[0] *= lv; scratch[1] *= lv; scratch[2] *= lv;
          splitSet(tint, ao, scratch);
        }
        self._shade(x, y, z, n[0], n[1], n[2], ownerKey, only, scratch);
        return [scratch[0] * tint[0] * a, scratch[1] * tint[1] * a, scratch[2] * tint[2] * a];
      };
    }
    /** 壁面用（隅と床際・天井際のAOを焼き込む）。fyFn はそのマスの床高さ */
    function wallShader(ownerKey, tint, n, only, fyBase, chLocal) {
      return function (x, y, z) {
        var fy = (typeof fyBase === 'function') ? fyBase(x, z) : (fyBase || 0);
        var a = self._aoWall(x, y, z, n[0], n[2], fy, chLocal);
        if (Y_ON && SPLIT.want) {
          self._shade(x, y, z, n[0], n[1], n[2], ownerKey, only, scratch, true);
          splitSet(tint, a, scratch);
        }
        self._shade(x, y, z, n[0], n[1], n[2], ownerKey, only, scratch);
        return [scratch[0] * tint[0] * a, scratch[1] * tint[1] * a, scratch[2] * tint[2] * a];
      };
    }
    /* 端に細かい行を入れた分割（接地の暗がりを1マス内で解像する） */
    var FDIV = [0, 0.15, 0.5, 0.85, 1];
    var CDIV = [0, 0.15, 0.85, 1];
    var XDIV = [0, 0.5, 1];      /* 系統X: AOはテクセル側で出るので粗くてよい */
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

    /* 床の散乱物の色味（マップ別。既定は area1 の白い書類のまま＝挙動不変） */
    var litterTint = (map.meta && map.meta.litterTint) || [1.25, 1.25, 1.25];
    var furnAt = Object.create(null);
    var furn = (map.meta && map.meta.furniture) || [];
    for (var fu = 0; fu < furn.length; fu++) furnAt[furn[fu].col + ',' + furn[fu].row] = furn[fu];

    /* ---- 床・天井 ----
     * 什器マスは実体（solid）だが壁を張らないので、床と天井は張っておかないと
     * 抜けて背景が見える。歩行可能マス＋什器マスを対象にする。 */
    var cells = map.walkableCells();
    for (var fz = 0; fz < furn.length; fz++) cells.push({ col: furn[fz].col, row: furn[fz].row });
    /* P5c: 深水 V（solid・歩けない）は「穴」にしてはいけない。天井だけ張り、
     * 床の代わりに水面を張る（_sewerWater）。水路 W は歩行可だが床の代わりに水面を張る。 */
    var waterCells = [], deepCells = [];
    if (map.meta && map.meta.water !== false) {
      for (var wr = 0; wr < map.height; wr++) {
        for (var wc = 0; wc < map.width; wc++) {
          var wt0 = map.tileAt(wc, wr);
          if (wt0 === TILE.WATER) waterCells.push({ col: wc, row: wr });
          else if (wt0 === TILE.DEEP) deepCells.push({ col: wc, row: wr });
        }
      }
    }
    this._waterCells = waterCells; this._deepCells = deepCells;
    for (var dz = 0; dz < deepCells.length; dz++) {
      cells.push({ col: deepCells[dz].col, row: deepCells[dz].row, ceilOnly: true });
    }
    /* P5c: 沈殿槽などの「槽」（meta.basins）。実体マスを掘って水を張る＝歩けないまま
     * 覗き込める窪み。壁は張らず（_wallFace を飛ばす）天井だけ張る。 */
    var basinAt = this._basinAt = Object.create(null);
    var basins = (map.meta && map.meta.basins) || [];
    for (var bi = 0; bi < basins.length; bi++) {
      var bs = basins[bi];
      for (var br = bs.r0; br <= bs.r1; br++) {
        for (var bc = bs.c0; bc <= bs.c1; bc++) {
          if (!map.isSolid(bc, br)) continue;
          basinAt[bc + ',' + br] = bs;
          cells.push({ col: bc, row: br, ceilOnly: true });
        }
      }
    }
    /* 床は floorYAt に、天井は floorYAt + そのマスの天井高に貼る（高低差対応） */
    function defFloor(x, z) { return map.floorYAt(x, z); }
    function defFloorLift(dy) { return function (x, z) { return map.floorYAt(x, z) + dy; }; }
    function defCeil(ch) { return function (x, z) { return map.floorYAt(x, z) + ch; }; }

    for (var i = 0; i < cells.length; i++) {
      var c = cells[i].col, r = cells[i].row;
      /* P5c: 水面を張るマス（水路 W・深水 V）は床を張らない（水面が覆う＝面の重なりを作らない） */
      var noFloor = !!cells[i].ceilOnly || (map.tileAt(c, r) === TILE.WATER);
      bset(c, r);
      var key = this._ownerOf(c, r);
      var tint = this._tintAt(c, r).f;
      var vary = 0.92 + hash2(c, r) * 0.16;
      var ft = [tint[0] * vary, tint[1] * vary, tint[2] * vary];
      var x0 = c * T, x1 = x0 + T, z0 = r * T, z1 = z0 + T;
      var ch = map.ceilHAt(c, r);

      var uvF = uvVariant(hash2(c + 41, r + 7));
      var uvC = uvVariant(hash2(c + 71, r + 23));
      var ct = this._tintAt(c, r).w;
      if (atlas) {
        /* 系統X: 照明はテクセルへ移るので、頂点分割は接地AOのために細かくしなくてよい
         * （＝三角形が減る。床16→4・天井9→4 クアッド） */
        if (!noFloor) {
          var shF = floorShader(key, ft, [0, 1, 0]);
          var rF = lmBegin(LMR, LMR);
          B.floor.gridP([x0, 0, z1], [T, 0, 0], [0, 0, -T], XDIV, XDIV, 1, 1,
            lmWhiteShade, uvF, defFloor);
          lmEnd();
          lmJob(rF, [x0, 0, z1], [T, 0, 0], [0, 0, -T], defFloor, shF);
        }
        var shC = floorShader(key, ct, [0, -1, 0]);
        var dC = defCeil(ch);
        var rC = lmBegin(LMR, LMR);
        B.ceil.gridP([x0, 0, z0], [T, 0, 0], [0, 0, T], XDIV, XDIV, 1, 1,
          lmWhiteShade, uvC, dC);
        lmEnd();
        lmJob(rC, [x0, 0, z0], [T, 0, 0], [0, 0, T], dC, shC);
      } else {
        if (!noFloor) {
          B.floor.gridP([x0, 0, z1], [T, 0, 0], [0, 0, -T], FDIV, FDIV, 1, 1,
            floorShader(key, ft, [0, 1, 0]), uvF, defFloor);
        }
        B.ceil.gridP([x0, 0, z0], [T, 0, 0], [0, 0, T], CDIV, CDIV, 1, 1,
          floorShader(key, ct, [0, -1, 0]), uvC, defCeil(ch));
      }

      var ff = noFloor ? -1 : flickerNear(c, r);
      if (ff >= 0 && litBy(c, r, ff)) {
        fbOf(ff).floor.gridP([x0, 0, z1], [T, 0, 0], [0, 0, -T], ADIV, ADIV, 1, 1,
          floorShader(key, ft, [0, 1, 0], ff), uvF, defFloorLift(0.008));
      }
      /* 床の散乱物（デカール・コリジョン無し）。契約 §3「通路マスの3割程度」 */
      if (map.isWalkable(c, r) && !noFloor) {
        var lh = hash2(c * 31 + 5, r * 17 + 9);
        if (lh < 0.36) {
          var lsz = 1.15 + lh * 2.0;
          var lx = x0 + T / 2 + (hash2(c + 3, r + 8) - 0.5) * 0.5;
          var lz = z0 + T / 2 + (hash2(c + 9, r + 2) - 0.5) * 0.5;
          var quad = (hash2(c + 61, r + 13) * 4) | 0;
          var lu = (quad & 1) * 0.5, lv = (quad >> 1) * 0.5;
          B.litter.gridP([lx - lsz / 2, 0, lz + lsz / 2], [lsz, 0, 0], [0, 0, -lsz],
            [0, 1], [0, 1], 1, 1,
            floorShader(key, litterTint, [0, 1, 0]),
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
        if (basinAt[cc + ',' + rr]) continue;    /* 槽のマスは壁でなく水面（_sewerBasins） */
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

    /* ---- P5c: 水路・深水の水面（契約 §4 P5「水路マス W」「深水 V」）---- */
    this._sewerWater(B, { shader: shader, planeShader: planeShader,
      floorShader: floorShader, wallShader: wallShader });
    this._sewerBasins(B, { shader: shader, planeShader: planeShader,
      floorShader: floorShader, wallShader: wallShader });

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
    this._bigBoard(B, shader, planeShader);
    this._regionSigns(B, shader, planeShader);
    this._ceilKit(B, shader);
    /* ---- P5c エリア2「下水道」の造形（meta.sewerKit のあるマップだけ） ---- */
    this._sewerKit(B, shader, planeShader);

    /* ---- 系統X: ライトマップを焼く（面を全部積んでから一括） ---- */
    var lmTex = null;
    if (atlas) {
      var tb0 = (global.performance ? performance.now() : Date.now());
      for (var lj = 0; lj < lmJobs.length; lj++) {
        (function (jb) {
          var o3 = jb.o, u3 = jb.u, v3 = jb.v, df = jb.d, sf = jb.s;
          atlas.bake(jb.r, function (s3, t3, out3) {
            var x3 = o3[0] + u3[0] * s3 + v3[0] * t3;
            var y3 = o3[1] + u3[1] * s3 + v3[1] * t3;
            var z3 = o3[2] + u3[2] * s3 + v3[2] * t3;
            if (df) y3 = df(x3, z3, t3, s3);
            var c3 = sf(x3, y3, z3);
            out3[0] = c3[0]; out3[1] = c3[1]; out3[2] = c3[2];
          });
        })(lmJobs[lj]);
      }
      this.stats.lmBakeMs = (global.performance ? performance.now() : Date.now()) - tb0;
      lmTex = atlas.texture();
      this._track(lmTex);
      this.stats.lmTiles = atlas.count;
      this.stats.lmBytes = atlas.size * atlas.size * 4;
    }

    /* ---- メッシュ化 ---- */
    var TX = ESCAPE.Textures;
    var bigMats = this._bigMats = { dynamic: Object.create(null), baked: Object.create(null) };
    /**
     * 大面の素材。
     *   Y: MeshStandardMaterial（法線・粗さ・金属度）＋焼き込み光を足すシェーダ改造。
     *      退避用に「焼き込みだけの Basic」も同じテクスチャで作っておき、
     *      setLightingMode('baked') で即座に差し替えられるようにする。
     *   X: MeshBasicMaterial ＋ lightMap（uv1）。
     */
    function bigMaterial(tex, key) {
      var o = { map: TX.get(tex), vertexColors: true, fog: true };
      /* three の Basic は lightMap を BRDF_Lambert（= 1/π）で受けるので π を掛けて戻す
       * ＝ライトマップに焼いた値がそのまま画面の明るさになる（off と同じ露出） */
      if (lmTex) { o.lightMap = lmTex; o.lightMapIntensity = Math.PI; }
      if (Y_ON) {
        var mm = ESCAPE.RQ.materialMaps(tex, ESCAPE.RQ.normalDiv());
        var basic = ESCAPE.RQ.patchBasic(new THREE.MeshBasicMaterial(
          { map: TX.get(tex), vertexColors: true, fog: true }));
        bigMats.baked[key] = basic;
        if (mm) {
          var so = { map: o.map, vertexColors: true, fog: true };
          so.normalMap = mm.normalMap;
          so.normalScale = new THREE.Vector2(1.0, 1.0);
          so.roughnessMap = mm.roughnessMap;
          so.roughness = 1.0;
          so.metalness = mm.profile.metal;
          var std = ESCAPE.RQ.patchStandard(new THREE.MeshStandardMaterial(so));
          bigMats.dynamic[key] = std;
          return std;
        }
        var b2 = ESCAPE.RQ.patchBasic(new THREE.MeshBasicMaterial(o));
        bigMats.dynamic[key] = b2;
        return b2;
      }
      return new THREE.MeshBasicMaterial(o);
    }
    function opaque(tex, extra, key) {
      if (key && BIG_TEX[key]) return bigMaterial(tex, key);
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
      floor: opaque('floor', null, 'floor'), floorTile: opaque('floorTile', null, 'floorTile'),
      floorWet: opaque('floorWet', null, 'floorWet'), floorMetal: opaque('floorMetal', null, 'floorMetal'),
      ceil: opaque('ceiling', null, 'ceil'),
      wall: opaque('wall', null, 'wall'), wall2: opaque('wall2', null, 'wall2'),
      wall3: opaque('wall3', null, 'wall3'),
      wallPaint: opaque('wallPaint', null, 'wallPaint'), wallMetal: opaque('wallMetal', null, 'wallMetal'),
      litter: decal('litter'), poster: decal('poster'), sign: decal('sign'), zonesign: decal('zonesign'),
      metal: opaque('metal'), dark: opaque('metal'), lamp: opaque('lamp'),
      screen: opaque('screen'), paper: opaque('paper'), sheet: opaque('sheet'),
      fluid: opaque('tankfluid'), board: opaque('board'), monitors: opaque('monitors'),
      water: decal('water'), glass: decal('glass'), hatch: decal('hatch'), blood: decal('blood'),
      /* P4.16 レーンA（契約 §4「P4.16 再プレイ差し戻し」項目1・2） */
      bigboard: opaque('bigboard'),
      bloodHand: decal('bloodHand'), bloodDrag: decal('bloodDrag'), bloodSplat: decal('bloodSplat'),
      /* P4.17 項目1: 壁の飛沫。絵は bloodSplat と同じで、集合（メッシュ名）だけ分ける */
      bloodSplatWall: decal('bloodSplat'),
      /* ---- P5c エリア2「下水道」 ---- */
      wallBrick: opaque('wallBrick', null, 'wallBrick'),
      wallStone: opaque('wallStone', null, 'wallStone'),
      wallConcreteWet: opaque('wallConcreteWet', null, 'wallConcreteWet'),
      floorStoneWet: opaque('floorStoneWet', null, 'floorStoneWet'),
      floorBrick: opaque('floorBrick', null, 'floorBrick'),
      floorMud: opaque('floorMud', null, 'floorMud'),
      waterBed: opaque('floorMud', null, 'waterBed'),
      /* 水面（sewerWater）は水のあるマップでだけ作る＝MATS の直後で条件付きに入れる */
      /* 床の格子（下に暗い水面が見える）＝アルファ抜き。デカールでなく実体面なので
         depthWrite は残し alphaTest で抜く（半透明の並び順に依存しない） */
      grate: new THREE.MeshBasicMaterial({
        map: TX.get('metalGrate'), vertexColors: true, fog: true,
        transparent: false, alphaTest: 0.5, side: THREE.DoubleSide
      }),
      /* 水位線のぬめり帯（壁に貼る帯・床の縁） */
      slime: decal('slime'),
      pipe: opaque('pipeRust'),
      /* 区画銘板の area2 版（表記は docs/notes.md「区画名」） */
      zonesignA2: decal('zonesignA2')
    };
    /* P5c: 水面。法線2層スクロール（fallback では静止した Basic に落ちる＝RQ 側の判断）。
       水のあるマップでだけ作る（area1 では uniform の登録もしない＝挙動不変）。
       退避素材（自動退避 setLightingMode('baked') の行き先）も同時に作る。 */
    if ((this._waterCells && this._waterCells.length) || (this._deepCells && this._deepCells.length)) {
      var RQW = ESCAPE.RQ;
      MATS.sewerWater = (RQW && RQW.waterMaterial)
        ? RQW.waterMaterial({ baked: true, vertexColors: true })
        : opaque('waterSewer');
      this._waterMat = MATS.sewerWater;
      if (MATS.sewerWater.isMeshStandardMaterial) {
        bigMats.dynamic.sewerWater = MATS.sewerWater;
        bigMats.baked.sewerWater = RQW.patchBasic(new THREE.MeshBasicMaterial(
          { map: TX.get('waterSewer'), vertexColors: true, fog: true }));
      }
    }
    /* 描画順（不透明 → デカール）。素材は全チャンクで共有する */
    var order = ['floor', 'floorTile', 'floorWet', 'floorMetal',
      'wallBrick', 'wallStone', 'wallConcreteWet', 'floorStoneWet', 'floorBrick', 'floorMud',
      'waterBed', 'sewerWater', 'ceil',
      'wall', 'wall2', 'wall3', 'wallPaint', 'wallMetal', 'metal', 'dark', 'pipe', 'grate',
      'lamp', 'poster',
      'screen', 'paper', 'sheet', 'fluid', 'board', 'monitors', 'bigboard', 'sign', 'zonesign',
      'zonesignA2', 'slime',
      'hatch', 'blood', 'bloodDrag', 'bloodSplat', 'bloodSplatWall', 'bloodHand', 'litter', 'water', 'glass'];
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
    for (var mk in MATS) {
      if (matCache[mk] || !MATS[mk]) continue;
      MATS[mk].dispose();
      if (bigMats.baked[mk]) { bigMats.baked[mk].dispose(); delete bigMats.baked[mk]; }
      delete bigMats.dynamic[mk];
    }
    /* 退避用の素材も World が持つ（dispose で確実に消す） */
    for (var bk in bigMats.baked) this._track(bigMats.baked[bk]);
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
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
          /* 系統Y は明滅の残りを実ライトが出すので、加算メッシュ側は同じ割合まで落とす */
          color: new THREE.Color(this.flickScale, this.flickScale, this.flickScale)
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
      var lmr = this._lmRes ? this._lmRes() : { on: false };
      if (lmr.on) {
        /* 系統X: 壁1面 = ライトマップ1タイル。頂点分割は2クアッドに落とす */
        var shW = wallShader(key, wt, dir.n, undefined, fyAt, H);
        var rW = this._lmBegin(lmr.r, lmr.rw);
        wb.gridP(o, u, v, [0, 0.5, 1], [0, 1], 1, 1, lmWhiteShade, uvW, defWall);
        this._lmEnd();
        this._lmJob(rW, o, u, v, defWall, shW);
      } else {
        wb.gridP(o, u, v, WDIV_S, WDIV_T, 1, 1,
          wallShader(key, wt, dir.n, undefined, fyAt, H), uvW, defWall);
      }
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
      /* P4.8 所長室の金庫（唯一の鍵の在り処）。厚い鋼扉＋ダイヤル＋レバー把手。
         P5c エリア2 は金庫でなく「壁の掛け具に掛かった鉄のハンドル」（meta.safeKit）。 */
      if (map.meta && map.meta.safeKit === 'handleRack') this._handleRack(B, cc, rr, dir, shader, key);
      else this._safe(B, cc, rr, dir, shader, key);
    } else if (tile === TILE.GIMMICK && this._gimmickRoleAt(cc, rr) === 'bulkhead' &&
      map.meta && map.meta.gimmickKit === 'controlPanel' &&
      (function (e) {
        return !e || !e.dir || (FACE_VEC[e.dir][0] === dir.dc && FACE_VEC[e.dir][2] === dir.dr);
      })(this._gimmickAt(cc, rr))) {
      /* P5c エリア2: 制御室の操作盤（軸穴・計器・ランプ） */
      this._controlPanel(B, cc, rr, dir, shader, key);
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
      if (map.meta && map.meta.doorKit === 'sluice') this._sluiceGate(B, cc, rr, dir, shader, key, H);
      else this._bulkhead(B, cc, rr, dir, sh, shDim, H);
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
      /* P5c: 交差点の色帯もマップ別に持てる（meta.regionMarks。無ければ area1 の表） */
      var mkTbl = (map.meta && map.meta.regionMarks) || REGION_MARK;
      var mk = (rid && mkTbl[rid]) || [0.7, 0.72, 0.7];
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

  /** P5c エリア2: 水門の操作ハンドル置き場（役割 safe）。金庫でなく**壁の掛け具**。
   *  取得後は空の掛け具だけが残る（ハンドルは別メッシュで visible を落とす）。
   *  壁からの突出は 0.26m（掛け具 0.16 ＋ ハンドルの軸 0.10）。 */
  World.prototype._handleRack = function (B, cc, rr, dir, shader, key) {
    var T = this.map.tileSize;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var fx = cx + dir.n[0] * T * 0.5, fz = cz + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';
    var base = this.map.cellFloorY(cc + dir.dc, rr + dir.dr);
    var y0 = base + 1.36;
    var shPlate = shader(key, [0.92, 0.94, 0.96]);
    var shHook = shader(key, [1.30, 1.26, 1.12]);
    function P(off, a, b) {
      return [fx + dir.n[0] * off + ((along === 'z') ? 0 : a), y0 + b,
        fz + dir.n[2] * off + ((along === 'z') ? a : 0)];
    }
    function S(w, d) { return [(along === 'z') ? d : w, (along === 'z') ? w : d]; }
    /* 背板（木の裏板＋琺瑯の札） */
    var p0 = P(0.03, 0, -0.10), s0 = S(1.10, 0.06);
    B.dark.box(p0[0], p0[1], p0[2], s0[0], 0.86, s0[1], 1.0, shPlate);
    /* 掛け具（2本のフック） */
    for (var k = 0; k < 2; k++) {
      var a = (k - 0.5) * 0.46;
      var pk = P(0.10, a, 0.14), sk = S(0.07, 0.14);
      B.metal.box(pk[0], pk[1], pk[2], sk[0], 0.07, sk[1], 2, shHook);
      var pk2 = P(0.16, a, 0.08), sk2 = S(0.07, 0.07);
      B.metal.box(pk2[0], pk2[1], pk2[2], sk2[0], 0.18, sk2[1], 2, shHook);
    }
    /* 「ハンドル置き場」の札 */
    var pl = P(0.05, 0, -0.44), sl = S(0.60, 0.02);
    B.metal.box(pl[0], pl[1], pl[2], sl[0], 0.16, sl[1], 2, shHook);

    /* 掛かっている鉄のハンドル（取得すると消える）＝別メッシュ */
    var bld = new Builder(false);
    var shH = this.propShader(cc + dir.dc, rr + dir.dr, [1.16, 1.06, 0.92], 0.80);
    var hy = y0 + 0.16;
    var hub = P(0.20, 0, 0.16);
    /* 軸（壁に対して垂直に突き出す）＋4本スポーク＋輪 */
    bld.tube([hub[0] - dir.n[0] * 0.10, hy, hub[2] - dir.n[2] * 0.10],
      [hub[0] + dir.n[0] * 0.04, hy, hub[2] + dir.n[2] * 0.04], 0.06, 6, shH);
    for (var q = 0; q < 8; q++) {
      var ang = q / 8 * Math.PI * 2;
      var ra = Math.cos(ang) * 0.30, rb = Math.sin(ang) * 0.30;
      var pq = P(0.20, ra, 0.16 + rb), sq = S(0.11, 0.09);
      bld.box(pq[0], pq[1], pq[2], sq[0], 0.11, sq[1], 2, shH);
    }
    var mesh = buildMesh(bld, this._track(new THREE.MeshBasicMaterial(
      { map: ESCAPE.Textures.get('metal'), vertexColors: true, fog: true })));
    this._track(mesh.geometry);
    mesh.name = 'sewerHandle';
    this.group.add(mesh);
    this._handleMesh = mesh;
  };

  /** P5c エリア2: 制御室の操作盤（役割 bulkhead）。軸穴・計器・ランプ。突出 0.26m */
  World.prototype._controlPanel = function (B, cc, rr, dir, shader, key) {
    var T = this.map.tileSize;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var fx = cx + dir.n[0] * T * 0.5, fz = cz + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';
    var base = this.map.cellFloorY(cc + dir.dc, rr + dir.dr);
    var y0 = base + 1.32;
    var shBody = shader(key, [1.00, 1.04, 1.08]);
    var shDark = shader(key, [0.42, 0.44, 0.46]);
    var shTrim = shader(key, [1.90, 1.60, 0.90]);
    var shLamp = shader(key, [2.40, 0.70, 0.40]);
    function P(off, a, b) {
      return [fx + dir.n[0] * off + ((along === 'z') ? 0 : a), y0 + b,
        fz + dir.n[2] * off + ((along === 'z') ? a : 0)];
    }
    function S(w, d) { return [(along === 'z') ? d : w, (along === 'z') ? w : d]; }
    function box(bld, off, a, b, w, h, d, uv, sh) {
      var p = P(off, a, b), q = S(w, d);
      bld.box(p[0], p[1], p[2], q[0], h, q[1], uv, sh);
    }
    /* 盤の筐体＋前面パネル */
    box(B.dark, 0.03, 0, 0, 1.56, 1.34, 0.08, 0.9, shDark);
    box(B.metal, 0.10, 0, 0, 1.38, 1.16, 0.08, 0.8, shBody);
    /* 上段: 計器3つ（丸窓） */
    for (var g = 0; g < 3; g++) {
      var ga = (g - 1) * 0.42;
      box(B.dark, 0.15, ga, 0.34, 0.30, 0.30, 0.04, 1.6, shDark);
      box(B.screen, 0.175, ga, 0.34, 0.24, 0.24, 0.02, 2, shTrim);
      box(B.dark, 0.19, ga, 0.34, 0.13, 0.02, 0.02, 2, shDark);
    }
    /* 中段: 軸穴（ハンドルを嵌める四角い穴）＝奥が暗い */
    box(B.metal, 0.15, -0.30, -0.14, 0.40, 0.40, 0.05, 1.6, shBody);
    box(B.dark, 0.13, -0.30, -0.14, 0.17, 0.17, 0.09, 2.4, shDark);
    /* 中段: 表示灯2つ（赤・橙） */
    box(B.lamp, 0.16, 0.22, -0.10, 0.13, 0.13, 0.03, 2, shLamp);
    box(B.dark, 0.16, 0.44, -0.10, 0.13, 0.13, 0.03, 2, shDark);
    /* 下段: レバー2本と銘板 */
    for (var l = 0; l < 2; l++) {
      box(B.metal, 0.16, 0.14 + l * 0.34, -0.42, 0.06, 0.24, 0.06, 2, shTrim);
      box(B.dark, 0.13, 0.14 + l * 0.34, -0.52, 0.16, 0.07, 0.07, 2, shDark);
    }
    box(B.metal, 0.14, -0.36, -0.46, 0.50, 0.14, 0.02, 2, shTrim);
    /* 盤へ降りる配管 */
    var pt = P(0.06, 0.62, 0.60), pb = P(0.06, 0.62, 0.72);
    B.pipe.tube([pt[0], pt[1], pt[2]], [pb[0], pb[1] + 1.2, pb[2]], 0.07, 5, shDark);
  };

  /** P5c エリア2: 鉄の昇降水門。枠・案内レール・鎖は静止、扉体だけ別メッシュで上がる */
  World.prototype._sluiceGate = function (B, cc, rr, dir, shader, key, H) {
    var map = this.map, T = map.tileSize;
    if (H === undefined) H = map.wallHeight;
    var cx = cc * T + T / 2, cz = rr * T + T / 2;
    var fx = cx + dir.n[0] * T * 0.5, fz = cz + dir.n[2] * T * 0.5;
    var along = (dir.dc !== 0) ? 'z' : 'x';
    var base = map.cellFloorY(cc + dir.dc, rr + dir.dr);
    var shBody = shader(key, [0.92, 0.94, 0.96]);
    var shDark = shader(key, [0.46, 0.48, 0.50]);
    function SX(w, d) { return (along === 'z') ? d : w; }
    function SZ(w, d) { return (along === 'z') ? w : d; }
    /* 開口の枠（上の梁と左右の案内レール） */
    B.metal.box(cx, base + H - 0.22, cz, SX(T, 0.44), 0.44, SZ(T, 0.44), 0.9, shBody);
    for (var k = 0; k < 2; k++) {
      var a = (k ? 1 : -1) * (T * 0.5 - 0.14);
      B.metal.box(cx + ((along === 'z') ? 0 : a), base + H / 2, cz + ((along === 'z') ? a : 0),
        SX(0.28, 0.44), H, SZ(0.28, 0.44), 1.0, shBody);
    }
    /* 巻き上げの鎖2本（枠の上から扉体へ。扉体が上がっても長さは変えない＝簡略） */
    for (var c2 = 0; c2 < 2; c2++) {
      var ax = (c2 ? 1 : -1) * 0.46;
      var px = cx + ((along === 'z') ? 0 : ax), pz = cz + ((along === 'z') ? ax : 0);
      B.dark.tube([px, base + H - 0.40, pz], [px, base + 2.54, pz], 0.045, 4, shDark);
    }

    /* 扉体（鉄板＋リブ＋ボルト）＝別メッシュ。doorOpen で 3 秒かけて上がる */
    var bld = new Builder(false);
    var shG = this.propShader(cc + dir.dc, rr + dir.dr, [1.02, 0.98, 0.92], 0.62);
    var GW = T - 0.34, GH = 2.46, GD = 0.26;
    bld.box(cx, base + GH / 2, cz, SX(GW, GD), GH, SZ(GW, GD), 0.8, shG);
    for (var rb = 0; rb < 4; rb++) {
      bld.box(cx + dir.n[0] * 0.16, base + 0.34 + rb * 0.62, cz + dir.n[2] * 0.16,
        SX(GW - 0.10, 0.08), 0.16, SZ(GW - 0.10, 0.08), 1.6, shG);
    }
    for (var bt = 0; bt < 8; bt++) {
      var ba = ((bt & 1) ? 1 : -1) * (GW * 0.42);
      bld.box(cx + dir.n[0] * 0.15 + ((along === 'z') ? 0 : ba),
        base + 0.22 + (bt >> 1) * 0.66, cz + dir.n[2] * 0.15 + ((along === 'z') ? ba : 0),
        0.10, 0.10, 0.10, 2, shG);
    }
    /* 下端の刃（水を切る縁） */
    bld.box(cx + dir.n[0] * 0.02, base + 0.07, cz + dir.n[2] * 0.02,
      SX(GW, GD + 0.08), 0.14, SZ(GW, GD + 0.08), 1.6, shG);
    var mesh = buildMesh(bld, this._track(new THREE.MeshBasicMaterial(
      { map: ESCAPE.Textures.get('metal'), vertexColors: true, fog: true })));
    this._track(mesh.geometry);
    mesh.name = 'sluiceGate';
    this.group.add(mesh);
    this._sluice = { mesh: mesh, lift: GH + 0.10, t: 0, dur: 3.0 };
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

  /* ================================================================
   * P5c 水（契約 §4「P5 エリア2『下水道』」＞「下水道の通路語彙」「見た目・細部」）
   *   W 水路 … 歩行可。床の代わりに「少し下げた水面」を張る（膝まで浸かって歩く）。
   *   V 深水 … solid。**穴にしない**。同じ高さの水面を張り、周りの壁面も張る
   *             ＝「向こう岸が見えているのに行けない」を成立させる。
   *   水面は RQ.waterMaterial（法線2層スクロール＋粗さ低め＋暗いアルベド）なので、
   *   灯の下だけが光る。fallback では静止した Basic に落ちる（RQ 側の判断）。
   * ============================================================== */
  var WATER_SURF = 0.14;          /* 歩廊の床面から水面までの下がり(m) */
  var WATER_LIP = 0.20;           /* 水面の下へ伸ばす帯(m)。低い視点でも面が抜けない */
  var KERB_H = 0.14, KERB_W = 0.18;  /* 歩廊との境の縁石（突出は水路側＝通行の邪魔にしない） */
  /* 水面のアルベド。暗くして「灯の下だけ光る」を作る。深水は更に落として深さを出す */
  var WATER_TINT = { shallow: [1.05, 1.12, 1.04], deep: [0.62, 0.74, 0.70] };
  var WDIV2 = [0, 0.5, 1];

  /** 境界面の起点・辺（法線が (c,r) の側を向く）。_wallFace と同じ規約で組む */
  function boundaryOU(T, c, r, dc, dr) {
    var cc = c + dc, rr = r + dr;
    var x0 = cc * T, x1 = x0 + T, z0 = rr * T, z1 = z0 + T;
    if (dc === -1) return { o: [x1, 0, z1], u: [0, 0, -T], n: [1, 0, 0] };
    if (dc === 1) return { o: [x0, 0, z0], u: [0, 0, T], n: [-1, 0, 0] };
    if (dr === -1) return { o: [x0, 0, z1], u: [T, 0, 0], n: [0, 0, 1] };
    return { o: [x1, 0, z0], u: [-T, 0, 0], n: [0, 0, -1] };
  }

  World.prototype._sewerWater = function (B, SH) {
    var wcs = this._waterCells || [], dcs = this._deepCells || [];
    if (!wcs.length && !dcs.length) return;
    var map = this.map, T = map.tileSize, TILE = ESCAPE.TILE;
    var bset = this._bset || function () {};
    var D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    function isWaterTile(c, r) {
      var t = map.tileAt(c, r);
      return t === TILE.WATER || t === TILE.DEEP;
    }
    var all = [];
    for (var a = 0; a < wcs.length; a++) all.push({ col: wcs[a].col, row: wcs[a].row, deep: false });
    for (var b = 0; b < dcs.length; b++) all.push({ col: dcs[b].col, row: dcs[b].row, deep: true });

    for (var i = 0; i < all.length; i++) {
      var c = all[i].col, r = all[i].row, deep = all[i].deep;
      bset(c, r);
      setYBias(0);
      var key = this._ownerOf(c, r);
      var fy = map.cellFloorY(c, r);
      var sy = fy - WATER_SURF;
      var x0 = c * T, z0 = r * T;
      var tint = deep ? WATER_TINT.deep : WATER_TINT.shallow;
      /* 水面（タイルいっぱい＝隣と継ぎ目なく1枚に見える） */
      B.sewerWater.gridP([x0, sy, z0 + T], [T, 0, 0], [0, 0, -T], WDIV2, WDIV2, 1, 1,
        SH.floorShader(key, tint, [0, 1, 0]));
      /* 水際（隣が水でない4方向） */
      var wt = this._tintAt(c, r).w;
      for (var d = 0; d < 4; d++) {
        var dc = D4[d][0], dr = D4[d][1];
        var nc = c + dc, nr = r + dr;
        if (isWaterTile(nc, nr)) continue;
        var solidN = map.isSolid(nc, nr);
        var q = boundaryOU(T, c, r, dc, dr);
        var top, tall = false;
        if (solidN) {
          /* 深水の向こうが壁: 壁面は誰も張らない（深水は歩行不可）＝ここで張らないと穴になる */
          top = deep ? (fy + map.ceilHAt(c, r)) : fy;
          tall = deep;
        } else {
          top = map.cellFloorY(nc, nr);
        }
        var by = sy - WATER_LIP;
        var hh = top - by;
        if (hh <= 0.001) continue;
        var o = [q.o[0], by, q.o[2]];
        var shW = tall
          ? SH.wallShader(key, wt, q.n, undefined, by, hh)
          : SH.planeShader(key, [wt[0] * 0.62, wt[1] * 0.66, wt[2] * 0.66], q.n);
        B.wall.gridP(o, q.u, [0, hh, 0], [0, 1], tall ? [0, 0.5, 1] : [0, 1], 1, hh / 3, shW);
        /* 歩廊との境の縁石（水路側へ 0.09m だけ出す＝コリジョンは水平2Dなので影響なし） */
        if (!solidN) {
          var kx = (c + 0.5) * T + dc * (T * 0.5 - KERB_W * 0.5);
          var kz = (r + 0.5) * T + dr * (T * 0.5 - KERB_W * 0.5);
          B.wall.box(kx, top + KERB_H * 0.5 - 0.02, kz,
            dc ? KERB_W : T, KERB_H, dr ? KERB_W : T, 1.2,
            SH.shader(key, [wt[0] * 0.92, wt[1] * 0.95, wt[2] * 0.95]));
        }
      }
    }
    setYBias(0);
  };

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
      var sewerLamp = (map.meta && map.meta.lampKit === 'sewer');
      var lw = sewerLamp ? 0.46 : 1.30, ld = sewerLamp ? 0.46 : 0.30;
      var sx = (f.axis === 'z') ? ld : lw, sz = (f.axis === 'z') ? lw : ld;
      var topY = f.fy + f.ch;
      /* 器具本体 */
      B.dark.box(f.x, topY - 0.06, f.z, sx + 0.06, 0.12, sz + 0.06, 1.2, sh);
      if (sewerLamp) {
        /* P5c: ケージ付きの下水道灯（鋳鉄の笠＋金網）。天井から短い腕で下がる */
        B.metal.box(f.x, topY - 0.22, f.z, 0.42, 0.24, 0.42, 1.4, sh);
      }
      /* 発光面（下向き） */
      var lo, lu, lv;
      if (f.axis === 'z') { lo = [f.x - ld / 2, f.y, f.z - lw / 2]; lu = [ld, 0, 0]; lv = [0, 0, lw]; }
      else { lo = [f.x - lw / 2, f.y, f.z - ld / 2]; lu = [lw, 0, 0]; lv = [0, 0, ld]; }
      var lit = LAMP_EMIT * ((f.state === 'on') ? 1.0 : ((f.state === 'flicker') ? FLICKER_BAKE : 0.06));
      var lampCol = [f.color.r * lit, f.color.g * lit, f.color.b * lit];
      B.lamp.grid(lo, lu, lv, 1, 1, 1, 1, function () { return lampCol; });
      if (sewerLamp && f.state !== 'off') {
        /* 金網（点いている器具だけ＝消灯帯の三角形を増やさない） */
        var shCage = shader(key, [0.46, 0.46, 0.44]);
        for (var cg = 0; cg < 3; cg++) {
          var cgo = (cg - 1) * 0.16;
          B.dark.box(f.x + cgo, f.y - 0.05, f.z, 0.028, 0.10, 0.44, 2, shCage);
        }
        B.dark.box(f.x, f.y - 0.10, f.z, 0.44, 0.028, 0.44, 2, shCage);
      }
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
    /**
     * 血痕専用の面シェーダ（2026-09-10 差し戻し①②）。
     * 差し戻しの合格条件は「3m以内なら増感なしで血痕と分かる濃さ」。ところが血痕は
     * 闇だまり（輝度が 0.02〜0.09 しかない区間）にも置かれるので、焼き込みをそのまま
     * 掛けると壁・床と一緒に沈んで消える。そこで**焼き込みの明るさに下限を与える**。
     * 下限は「乾いた暗赤が読める最小」で、暗部判定（輝度40）は割らない小さな値。
     */
    function bloodShader(ownerKey, tint, n) {
      var base = planeShader(ownerKey, tint, n);
      return function (x, y, z) {
        var c = base(x, y, z);
        var l = (c[0] + c[1] + c[2]) / 3;
        if (l >= BLOOD_MIN_SHADE) return c;
        if (l > 1e-4) {
          var k = BLOOD_MIN_SHADE / l;
          return [c[0] * k, c[1] * k, c[2] * k];
        }
        return [BLOOD_MIN_SHADE * tint[0], BLOOD_MIN_SHADE * tint[1], BLOOD_MIN_SHADE * tint[2]];
      };
    }
    var up = [0, 1, 0];

    var bset = this._bset || function () {};
    function quad(builderFn, col, row, size, y, tintArr, sizeZ) {
      bset(col, row);
      var builder = builderFn();
      var cx = col * T + T / 2, cz = row * T + T / 2;
      var sz = (sizeZ === undefined) ? size : sizeZ;
      var hx = size / 2, hz = sz / 2;
      builder.grid([cx - hx, 0, cz + hz], [size, 0, 0], [0, 0, -sz], 1, 1, 1, 1,
        planeShader(col + ',' + row, tintArr, up), null,
        function (x, z) { return map.floorYAt(x, z) + y; });
    }
    /** quad と同じだが血痕専用シェーダを使う（闇だまりでも沈ませない） */
    function bloodQuad(builderFn, col, row, size, y, tintArr, sizeZ) {
      bset(col, row);
      var builder = builderFn();
      var cx = col * T + T / 2, cz = row * T + T / 2;
      var sz = (sizeZ === undefined) ? size : sizeZ;
      var hx = size / 2, hz = sz / 2;
      builder.grid([cx - hx, 0, cz + hz], [size, 0, 0], [0, 0, -sz], 1, 1, 1, 1,
        bloodShader(col + ',' + row, tintArr, up), null,
        function (x, z) { return map.floorYAt(x, z) + y; });
    }

    var noise = meta.noise || [];
    for (var i = 0; i < noise.length; i++) {
      var n = noise[i];
      /* P4.11 項目3「罠は道の端で回避可能」: 踏む系は通路の幅方向で中央60%（1.2m）に限る。
         両端 0.4m は造形も発火もなし＝端を慎重に歩けば鳴らない。 */
      var bh = stepBandHalf(map, n.col, n.row);
      if (n.kind === 'glass') quad(function () { return B.glass; }, n.col, n.row,
        bh.x * 2 - 0.06, 0.016, [1.5, 1.5, 1.5], bh.z * 2 - 0.06);
      else if (n.kind === 'metal') this._metalPlate(B, n.col, n.row, shader, planeShader);
      else quad(function () { return B.water; }, n.col, n.row,
        bh.x * 2 - 0.04, 0.012, [1.15, 1.15, 1.2], bh.z * 2 - 0.04);
    }
    /* P4.14 項目1: セーブポイント＝**壁面の記録端末**。
       【失効】旧「床のハッチ（自動チェックポイントの目印）＋近くの壁の緑の非常灯」は、
       自動チェックポイントごと失効した（契約 §4「P4.14 再プレイ差し戻し」項目1）。 */
    var cps = meta.checkpoints || [];
    for (var j = 0; j < cps.length; j++) this._saveTerminal(B, cps[j], shader);
    this._buildSaveLamps();
    if (meta.exitPad) {
      quad(function () { return B.hatch; }, meta.exitPad.col, meta.exitPad.row, 1.86, 0.014, [0.95, 0.95, 0.95]);
    }
    /* P4.16 項目2 →【P4.17 項目1で数量・色を改訂】血痕は「たまに見る程度」。
       床の血溜まり / 壁の血痕（押しつけた擦り bloodHand・飛沫 bloodSplat）/ 引きずり跡。
       色はテクスチャ側で乾いた暗赤〜黒に寄せてあるので、ここでは光沢を足さない。
       壁の飛沫は dir を持つと壁面貼り（P4.17）、持たなければ従来どおり床。 */
    var dec = meta.decals || [];
    for (var k = 0; k < dec.length; k++) {
      var dk = dec[k], ty = dk.type || 'blood';
      if (ty === 'blood') {
        /* 差し戻し②「黒ではなく赤みが残る」: 4種が同じ材質に見えるよう床の血溜まりも
           赤側へ持ち上げ、闇だまりでも沈まないよう bloodShader を通す。 */
        bloodQuad(function () { return B.blood; }, dk.col, dk.row, 1.8, 0.018, [1.45, 1.02, 0.98]);
      } else if (ty === 'bloodSplat') {
        if (dk.dir) this._bloodSplatWallDecal(B, dk, bloodShader);
        else bloodQuad(function () { return B.bloodSplat; }, dk.col, dk.row, 1.92, 0.017, [1.15, 0.98, 0.96]);
      } else if (ty === 'bloodDrag') {
        this._bloodDragDecal(B, dk, bloodShader);
      } else if (ty === 'bloodHand') {
        this._bloodHandDecal(B, dk, bloodShader);
      }
    }
    /* センサー */
    var sen = meta.sensors || [];
    for (var s = 0; s < sen.length; s++) this._sensor(B, sen[s].col, sen[s].row, shader);
    this._buildSensorLamps();
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
    /* P4.11 項目3: 造形は通路の幅方向で中央60%（両端0.4mは空ける）に収める */
    var bh = stepBandHalf(this.map, col, row);
    var hx = bh.x, hz = bh.z;
    /* 大判1枚＋めくれた小片2枚。めくれは高さを変えて影の段を作る */
    B.metal.box(cx, 0.022, cz, hx * 1.90, 0.044, hz * 1.60, 0.9, sh);
    B.metal.box(cx - hx * 0.40, 0.060, cz + hz * 0.52, hx * 0.60, 0.040, hz * 0.44, 1.2, sh);
    B.metal.box(cx + hx * 0.38, 0.052, cz - hz * 0.48, hx * 0.52, 0.036, hz * 0.52, 1.2, sh);
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

  /**
   * P4.14 項目1: セーブポイント＝**壁面の記録端末**（契約 §4「P4.14 再プレイ差し戻し」項目1）。
   * cp = { col, row, dir, id }。col,row は端末の前に立つ歩行可能マス、dir はそこから見た壁の向き
   * （データは js/maps/area1.js の meta.checkpoints が唯一の真実。記録の判定＝js/progress.js も
   *  同じ dir を読むので、造形と「調べる」の向きが食い違わない）。
   *
   * 見分けの契約:
   *   区画銘板 … 1.02m角の大きな金属額縁＋明るい銘板面（高さ1.66m）
   *   センサー … 小さな筐体＋**赤**の表示灯＋通路を横切る赤いビーム（高さ1.12m）
   *   記録端末 … 縦長の暗い筐体＋**小さな画面**（自発光の青白）＋**緑**のランプ＋操作卓（高さ1.35m）
   * 壁からの突出は最大 0.15m（契約の 0.16m 以内）。緑のランプは点光源を使わず、
   * _buildSaveLamps() の InstancedMesh（センサー表示灯と同じ方式）で自発光させる。
   */
  World.prototype._saveTerminal = function (B, cp, shader) {
    var map = this.map, T = map.tileSize;
    if (this._bset) this._bset(cp.col, cp.row);
    var n = (cp.dir && FACE_VEC[cp.dir]) ? FACE_VEC[cp.dir] : this._wallDirOf(cp.col, cp.row);
    if (!n) return;
    var m = [-n[0], 0, -n[2]];                       /* 面の外向き法線（部屋の側を向く） */
    var key = cp.col + ',' + cp.row;
    setYBias(map.cellFloorY(cp.col, cp.row));
    var cx = cp.col * T + T / 2, cz = cp.row * T + T / 2;
    var wx = cx + n[0] * (T * 0.5), wz = cz + n[2] * (T * 0.5);   /* 壁面 */
    var along = (n[0] !== 0) ? 'z' : 'x';
    var sh = shader(key, [0.88, 0.90, 0.94]);
    var shD = shader(key, [0.52, 0.56, 0.60]);
    /* 背板（縦長の暗い筐体）。突出 0.06m */
    B.dark.box(wx + m[0] * 0.03, 1.42, wz + m[2] * 0.03,
      (along === 'z') ? 0.06 : 0.62, 0.86, (along === 'z') ? 0.62 : 0.06, 1.1, shD);
    /* 画面の枠（金属）。突出 0.09m */
    B.metal.box(wx + m[0] * 0.06, 1.56, wz + m[2] * 0.06,
      (along === 'z') ? 0.12 : 0.50, 0.40, (along === 'z') ? 0.50 : 0.12, 1.3, sh);
    /* 画面そのもの（自発光の青白＝暗所でも「端末」と分かる）。突出 0.125m */
    facePanel(B.screen, wx + m[0] * 0.125, 1.56, wz + m[2] * 0.125, m, 0.42, 0.32,
      flat([0.46, 0.62, 0.78]));
    /* 操作卓（小さな棚。キー面）。突出 0.14m（＝中心0.07＋厚み0.14の半分） */
    B.metal.box(wx + m[0] * 0.07, 1.24, wz + m[2] * 0.07,
      (along === 'z') ? 0.14 : 0.46, 0.07, (along === 'z') ? 0.46 : 0.14, 1.5, sh);
    /* 緑のランプの台座（暗い縁取り。**ランプより浅く**して埋めない）。突出 0.08m */
    B.dark.box(wx + m[0] * 0.04, 1.86, wz + m[2] * 0.04,
      (along === 'z') ? 0.08 : 0.26, 0.22, (along === 'z') ? 0.26 : 0.08, 1.4, shD);
    /* 焼き込みの緑（InstancedMesh が無い環境でも緑の点が残る保険）。突出 0.145m */
    B.lamp.box(wx + m[0] * 0.115, 1.86, wz + m[2] * 0.115,
      (along === 'z') ? 0.06 : 0.10, 0.10, (along === 'z') ? 0.10 : 0.06, 3,
      function () { return [0.22, 0.78, 0.36]; });
    /* 配線ダクト（壁を伝って天井へ）。突出 0.07m */
    B.dark.tube([wx + m[0] * 0.025, 1.98, wz + m[2] * 0.025],
      [wx + m[0] * 0.025, 2.72, wz + m[2] * 0.025], 0.045, 5, shD);
    /* 自発光の緑ランプ（点光源なし・InstancedMesh 1体にまとめる）。
       焼き込みの緑より僅かに大きくして必ず手前に出す＝Zファイトしない。突出 0.15m */
    this.saveLamps.push({
      id: cp.id,
      x: wx + m[0] * 0.118, y: map.cellFloorY(cp.col, cp.row) + 1.86, z: wz + m[2] * 0.118,
      sx: (along === 'z') ? 0.07 : 0.115, sz: (along === 'z') ? 0.115 : 0.07
    });
    setYBias(0);
  };

  /** P4.14: 記録端末の緑ランプを InstancedMesh 1体にまとめる（ドローコール+1のみ）。
   *  暗所でも場所が分かる自発光。周囲は照らさない（点光源なし）。点滅はしない
   *  （点滅する赤＝センサー、点かない緑＝記録端末、で見分けがつく）。 */
  World.prototype._buildSaveLamps = function () {
    var L = this.saveLamps;
    if (!L.length || typeof THREE.InstancedMesh !== 'function') return;
    var geo = this._track(new THREE.BoxGeometry(1, 0.115, 1));
    var mat = this._track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }));
    var mesh = new THREE.InstancedMesh(geo, mat, L.length);
    var m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (var i = 0; i < L.length; i++) {
      m4.makeScale(L[i].sx, 1, L[i].sz);
      m4.setPosition(L[i].x, L[i].y, L[i].z);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, c.setRGB(0.30, 1.0, 0.45));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this._saveMesh = mesh;
    this.group.add(mesh);
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
      function () { return [0.42, 0.09, 0.08]; });
    /* P4.13: 点滅する表示灯の本体（焼き込みの上に重ねる。update() で明滅） */
    this.sensorLamps.push({
      x: fx - n[0] * 0.10, y: this.map.cellFloorY(col, row) + 1.12, z: fz - n[2] * 0.10,
      sx: (along === 'z') ? 0.076 : 0.096, sz: (along === 'z') ? 0.096 : 0.076,
      phase: ((col * 7 + row * 13) % 10) / 10
    });
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

  /* P4.16 項目1: 大型掲示板の寸法（契約 §4「幅2.4m x 高さ1.6m級」）。
   * 機械テストはこの定数と据えた座標の両方を見る。 */
  var BIGBOARD = { w: 2.40, h: 1.60, cy: 1.62, stick: 0.155, paperOff: 0.060 };

  /**
   * P4.16 項目1: スタート部屋の大型掲示板（契約 §4「P4.16 再プレイ差し戻し」項目1）。
   * meta.bigBoard = { col, row, dir }。col,row は**掲示板の前に立つ歩行可能マス**、
   * dir はそのマスから見た**掲示板が付いている壁の向き**（記録端末 _saveTerminal と同じ流儀）。
   *
   * 見分けの契約: 既存の張り紙（_wallPaper 0.44〜0.72m角）と同じ扱いにしない。
   *   紙面 2.40m x 1.60m ＝ 面積で 5倍以上。金属の枠と庇（フード灯）を持ち、
   *   焼き込みを明るくして「ここだけ照らされている」見え方にする。
   * 壁からの突出は最大 0.155m（プレイヤー半径0.32m未満・契約 §3 の 0.30m以内）。
   */
  World.prototype._bigBoard = function (B, shader, planeShader) {
    var map = this.map, T = map.tileSize;
    var bb = (map.meta && map.meta.bigBoard) || null;
    if (!bb) return;
    var n = (bb.dir && FACE_VEC[bb.dir]) ? FACE_VEC[bb.dir] : this._wallDirOf(bb.col, bb.row);
    if (!n) return;
    if (this._bset) this._bset(bb.col, bb.row);
    var m = [-n[0], 0, -n[2]];                    /* 面の外向き法線（部屋の側を向く） */
    var key = bb.col + ',' + bb.row;
    setYBias(map.cellFloorY(bb.col, bb.row));
    var cx = bb.col * T + T / 2, cz = bb.row * T + T / 2;
    var wx = cx + n[0] * (T * 0.5), wz = cz + n[2] * (T * 0.5);
    var along = (n[0] !== 0) ? 'z' : 'x';
    var CY = BIGBOARD.cy;                         /* 板の中心高さ（目線） */
    var PW = BIGBOARD.w, PH = BIGBOARD.h;         /* 紙面（契約値） */
    var shBody = shader(key, [0.62, 0.64, 0.66]);
    var shTrim = shader(key, [1.34, 1.32, 1.24]);
    var shHood = shader(key, [0.80, 0.82, 0.84]);
    /** 壁面から off だけ手前、横 a・縦 b にずらした箱 */
    function put(bld, off, a, b, w, h, d, uvS, sh) {
      bld.box(wx + m[0] * off + ((along === 'z') ? 0 : a),
        CY + b,
        wz + m[2] * off + ((along === 'z') ? a : 0),
        (along === 'z') ? d : w, h, (along === 'z') ? w : d, uvS, sh);
    }
    /* 背板（掲示板の台。紙面より一回り大きい暗い板）。突出 0.05m */
    put(B.dark, 0.025, 0, 0, PW + 0.20, PH + 0.20, 0.05, 0.8, shBody);
    /* 金属の枠（上下・左右）。突出 0.115m */
    put(B.metal, 0.075, 0, (PH + 0.13) / 2, PW + 0.20, 0.13, 0.08, 1.0, shTrim);
    put(B.metal, 0.075, 0, -(PH + 0.13) / 2, PW + 0.20, 0.13, 0.08, 1.0, shTrim);
    put(B.metal, 0.075, (PW + 0.13) / 2, 0, 0.13, PH + 0.20, 0.08, 1.0, shTrim);
    put(B.metal, 0.075, -(PW + 0.13) / 2, 0, 0.13, PH + 0.20, 0.08, 1.0, shTrim);
    /* 紙面。突出 0.06m（枠より奥＝額装に見える）。
       焼き込みを明るくして「掲示板だけ照らされている」見え方にする（契約 項目1） */
    facePanel(B.bigboard, wx + m[0] * 0.060, CY, wz + m[2] * 0.060, m, PW, PH,
      planeShader(key, [2.05, 2.00, 1.90], m));
    /* 庇（フード灯）。紙面の上に伸びて板だけを照らす体裁。突出 0.155m */
    put(B.dark, 0.085, 0, PH / 2 + 0.30, PW * 0.52, 0.09, 0.17, 1.2, shHood);
    put(B.lamp, 0.075, 0, PH / 2 + 0.235, PW * 0.46, 0.05, 0.10, 2.0,
      function () { return [1.05, 0.98, 0.82]; });
    /* 留め具（四隅のボルト）。突出 0.13m */
    for (var q = 0; q < 4; q++) {
      var ax = ((q & 1) ? 1 : -1) * (PW / 2 + 0.055);
      var by = ((q & 2) ? 1 : -1) * (PH / 2 + 0.055);
      put(B.metal, 0.105, ax, by, 0.07, 0.07, 0.05, 2.4, shTrim);
    }
    setYBias(0);
  };

  /* P4.16 項目2 の実寸（2026-09-10 差し戻し①②）。textures.js の作画寸法と一対一。
   *   HANDPANEL: 手形の面。1024x768px を 1.50 x 1.125m に貼る＝682.7px/m。
   *              手形は 0.19m（130px）＝実物大。
   *   DRAGQUAD : 引きずり跡の面の幅。256px を 0.90m に貼る＝284px/m。
   *              帯そのものは 0.42m（119px）＝契約 30〜45cm。 */
  var HANDPANEL = { w: 1.50, h: 1.125, handLen: 0.19, texW: 1024, texH: 768 };
  var DRAGQUAD = { w: 0.90, band: 0.42, texW: 256, texH: 1024 };
  /* 血痕の焼き込みの下限（bloodShader）。0＝闇に沈めてよい、1＝常に全光量。 */
  var BLOOD_MIN_SHADE = 0.38;

  /**
   * P4.16 項目2: 壁の手形と擦り跡（契約 §4「P4.16」項目2「腰〜肩の高さ」）。
   * d = { col, row, dir }。col,row は歩行可能マス、dir は手形が付く壁の向き
   * （省略時は隣接する壁を自動で探す）。壁から 0.02m しか出ない＝通行に干渉しない。
   */
  World.prototype._bloodHandDecal = function (B, d, planeShader) {
    var map = this.map, T = map.tileSize;
    var n = (d.dir && FACE_VEC[d.dir]) ? FACE_VEC[d.dir] : this._wallDirOf(d.col, d.row);
    if (!n) return;
    if (this._bset) this._bset(d.col, d.row);
    var m = [-n[0], 0, -n[2]];
    var key = d.col + ',' + d.row;
    setYBias(map.cellFloorY(d.col, d.row));
    var cx = d.col * T + T / 2, cz = d.row * T + T / 2;
    var wx = cx + n[0] * (T * 0.5 + 0.02), wz = cz + n[2] * (T * 0.5 + 0.02);
    /* 面の中心 1.22m。手形はテクスチャ上 v=0.30/0.40 にあるので床から 1.45m / 1.33m
       ＝差し戻し①「床から1.2〜1.5m」。手形そのものは実物大（手の長さ0.19m）で、
       面の実寸はテクスチャの PPM（1024px / 1.50m）と一対一で対応させる。
       P4.17 項目1: 鮮やかな赤は失効。tint を 1.60 → 1.18 に落とし、床の血溜まりと同じ
       「赤黒く濃い」色に寄せる（機械テスト: テクスチャ平均R × tintR ≤ 110）。 */
    facePanel(B.bloodHand, wx, 1.22, wz, m, HANDPANEL.w, HANDPANEL.h,
      planeShader(key, WALL_BLOOD_TINT, m));
    setYBias(0);
  };

  /* P4.17 項目1: 壁の血痕の tint（赤黒さを保つ上限。テスト testP417Blood が読む） */
  var WALL_BLOOD_TINT = [1.18, 0.94, 0.92];
  /* 壁の飛沫の面（0.95 x 0.95m・中心高さ1.35m）。テクスチャは 256x256 の飛沫1発 */
  var SPLATPANEL = { w: 0.95, h: 0.95, cy: 1.35 };

  /**
   * P4.17 項目1: 壁の飛沫（壁の血痕2種のうちの「飛沫」）。
   * d = { col, row, dir }。dir はその歩行可能マスから見た壁の向き。
   */
  World.prototype._bloodSplatWallDecal = function (B, d, planeShader) {
    var map = this.map, T = map.tileSize;
    var n = (d.dir && FACE_VEC[d.dir]) ? FACE_VEC[d.dir] : this._wallDirOf(d.col, d.row);
    if (!n) return;
    if (this._bset) this._bset(d.col, d.row);
    var m = [-n[0], 0, -n[2]];
    setYBias(map.cellFloorY(d.col, d.row));
    var cx = d.col * T + T / 2, cz = d.row * T + T / 2;
    var wx = cx + n[0] * (T * 0.5 + 0.02), wz = cz + n[2] * (T * 0.5 + 0.02);
    facePanel(B.bloodSplatWall, wx, SPLATPANEL.cy, wz, m, SPLATPANEL.w, SPLATPANEL.h,
      planeShader(d.col + ',' + d.row + 'sp', WALL_BLOOD_TINT, m));
    setYBias(0);
  };

  /**
   * P4.16 項目2: 引きずり跡（契約 §4「P4.16」項目2「床に2〜4マス続く帯」）。
   * d = { col, row, col2, row2 }。始点(col,row)が濃く、終点(col2,row2)へ細って消える。
   * テクスチャの V を run 全体に割り当てるので、マスの継ぎ目に段差が出ない。
   */
  World.prototype._bloodDragDecal = function (B, d, planeShader) {
    var map = this.map, T = map.tileSize;
    var dc = (d.col2 > d.col) ? 1 : ((d.col2 < d.col) ? -1 : 0);
    var dr = (d.row2 > d.row) ? 1 : ((d.row2 < d.row) ? -1 : 0);
    var len = Math.abs(d.col2 - d.col) + Math.abs(d.row2 - d.row) + 1;
    if (len < 2 || (dc !== 0 && dr !== 0)) return;
    /* 面の幅 0.90m。帯そのものはテクスチャ内で 0.38m に収まり、両脇 0.26m は
       にじみの余白＝マスの端で帯が切れない（差し戻し②）。 */
    var up = [0, 1, 0], BW = DRAGQUAD.w;
    for (var i = 0; i < len; i++) {
      var col = d.col + dc * i, row = d.row + dr * i;
      if (!map.isWalkable(col, row)) continue;
      if (this._bset) this._bset(col, row);
      var cx = col * T + T / 2, cz = row * T + T / 2;
      var v0 = i / len, v1 = (i + 1) / len;
      /* 帯の進行方向を V に、幅方向を U に取る。
         2026-09-10 差し戻し②の原因: U×V が下向きになる向きがあり、表面カリングで
         帯がまったく描かれていなかった（見えていた黒いジグザグは配管・ケーブル）。
         U×V が必ず上（+Y）になるよう U = (-Vz, 0, Vx) で取り直す。 */
      var vx = dc * T, vz = dr * T;
      var ux = -dr * BW, uz = dc * BW;
      var o = [cx - vx / 2 - ux / 2, 0, cz - vz / 2 - uz / 2];
      var u = [ux, 0, uz], v = [vx, 0, vz];
      B.bloodDrag.grid(o, u, v, 1, 1, 1, 1,
        /* 差し戻し②「黒ではなく乾いた暗赤」: 床の明度に対して赤みが残る強さに持ち上げる */
        planeShader(col + ',' + row, [1.45, 1.05, 0.98], up),
        (function (a, b) {
          return function (s, t) { return [s, 1 - (a + (b - a) * t)]; };
        })(v0, v1),
        function (x, z) { return map.floorYAt(x, z) + 0.019; });
    }
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
      } else if (k.type === 'ladder') {
        /* P5c: 鋼の梯子（縦坑・沈殿槽）。壁からの突出 0.26m */
        var shLad = shader(key, [1.10, 1.04, 0.92]);
        var topL = (k.h === undefined ? map.ceilHAt(k.col, k.row) : k.h);
        for (var lr = 0; lr < 2; lr++) {
          var la = (lr ? 1 : -1) * 0.24;
          var lx0 = fx + m[0] * 0.20 + ((along === 'z') ? 0 : la);
          var lz0 = fz + m[2] * 0.20 + ((along === 'z') ? la : 0);
          B.metal.box(lx0, topL / 2, lz0, 0.07, topL, 0.07, 1.2, shLad);
        }
        for (var lg = 0; lg * 0.32 < topL - 0.2; lg++) {
          B.metal.box(fx + m[0] * 0.20, 0.22 + lg * 0.32, fz + m[2] * 0.20,
            (along === 'z') ? 0.06 : 0.54, 0.055, (along === 'z') ? 0.54 : 0.06, 2, shLad);
        }
      } else if (k.type === 'beacon') {
        /* P5c: 赤い回転灯（水門）。台座は静止、回る反射鏡だけ別メッシュ */
        var shBc = shader(key, [0.70, 0.72, 0.74]);
        var by0 = (k.y === undefined ? 2.30 : k.y);
        B.metal.box(fx + m[0] * 0.10, by0 - 0.26, fz + m[2] * 0.10,
          (along === 'z') ? 0.20 : 0.30, 0.16, (along === 'z') ? 0.30 : 0.20, 1.6, shBc);
        B.dark.box(fx + m[0] * 0.16, by0 - 0.15, fz + m[2] * 0.16, 0.30, 0.06, 0.30, 1.6, shBc);
        B.lamp.box(fx + m[0] * 0.16, by0, fz + m[2] * 0.16, 0.28, 0.24, 0.28, 1.4,
          flat([1.30, 0.16, 0.10]));
        B.dark.box(fx + m[0] * 0.16, by0 + 0.15, fz + m[2] * 0.16, 0.32, 0.06, 0.32, 1.6, shBc);
        this._addBeacon(fx + m[0] * 0.16, map.cellFloorY(k.col, k.row) + by0, fz + m[2] * 0.16);
      } else if (k.type === 'gaugeRow') {
        /* P5c: 計器の列（制御室・ポンプ室）。突出 0.16m */
        var shG2 = shader(key, [0.96, 0.98, 1.00]);
        B.dark.box(fx + m[0] * 0.05, 1.66, fz + m[2] * 0.05,
          (along === 'z') ? 0.10 : 1.64, 0.66, (along === 'z') ? 1.64 : 0.10, 1.2, shD);
        for (var gg = 0; gg < 4; gg++) {
          var go = (gg - 1.5) * 0.38;
          B.metal.box(fx + m[0] * 0.11 + ((along === 'z') ? 0 : go), 1.66,
            fz + m[2] * 0.11 + ((along === 'z') ? go : 0), 0.26, 0.26, 0.26, 1.8, shG2);
          B.screen.box(fx + m[0] * 0.14 + ((along === 'z') ? 0 : go), 1.66,
            fz + m[2] * 0.14 + ((along === 'z') ? go : 0), 0.19, 0.19, 0.19, 2, shG2);
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
    /* P5c: 銘板の表記はマップ別（area2 は『A　流入区画』）。既定は area1 の 'zonesign' */
    var signKey = (map.meta && map.meta.zoneSignTex) || 'zonesign';
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
      facePanel(B[signKey], fx + m[0] * 0.052, 1.66, fz + m[2] * 0.052, m, 0.92, 0.92,
        planeShader(key, [1.55, 1.52, 1.44], m), atlasUVR(idx % 3, (idx / 3) | 0, 3, 2));
      setYBias(0);
    }
  };

  /* ================================================================
   * P5c エリア2「下水道」の造形（契約 §4「P5 エリア2『下水道』」＞「造形の語彙」）
   *   すべて meta.sewerKit があるマップでだけ動く＝ area1 は1ピクセルも変わらない。
   *   **移動の障害にしない**: 壁付きの突出は 0.30m 以下、床置きは薄物だけ。
   *   （プレイヤーの当たりはマス単位の水平2Dなので造形は当たりを持たないが、
   *     「通れそうに見えて通れない」を作らないため見た目の側でも守る）
   * ============================================================== */
  var SEWER = {
    pipeR: 0.25,            /* 大径配管の半径(m) ＝ Φ0.50 */
    pipeSeg: 6,
    pipeInset: 0.44,        /* 壁面からの芯の距離(m) */
    pipeDrop: 0.46,         /* 天井からの下がり(m) */
    valveEvery: 9,          /* バルブの間隔(マス) */
    slimeY: 0.30, slimeH: 0.34,   /* 水位線のぬめり帯 */
    timberEvery: 5,         /* 旧坑の支保工の間隔(マス) */
    dripMax: 200            /* 滴りの粒子総数の上限（契約） */
  };

  /** 4近傍 */
  var D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  World.prototype._sewerKit = function (B, shader, planeShader) {
    var map = this.map, meta = map.meta || {}, T = map.tileSize, TILE = ESCAPE.TILE;
    var kit = meta.sewerKit;
    if (!kit) return;
    var self = this;
    var bset = this._bset || function () {};
    function walk(c, r) { return map.isWalkable(c, r); }
    function solid(c, r) { return map.isSolid(c, r); }
    function isWater(c, r) { var t = map.tileAt(c, r); return t === TILE.WATER || t === TILE.DEEP; }
    function nearWater(c, r) {
      if (isWater(c, r)) return true;
      for (var i = 0; i < 4; i++) if (isWater(c + D4[i][0], r + D4[i][1])) return true;
      return false;
    }
    /** その位置が「部屋の中（2x2 が全部通れる）」か */
    function openAt(c, r) {
      for (var oc = c - 1; oc <= c; oc++) {
        for (var orr = r - 1; orr <= r; orr++) {
          if (walk(oc, orr) && walk(oc + 1, orr) && walk(oc, orr + 1) && walk(oc + 1, orr + 1)) return true;
        }
      }
      return false;
    }
    var cells = map.walkableCells();
    var dripSites = [];

    /* ---- ① 天井隅の大径配管とバルブ（幹線に連続）---- */
    if (kit.pipes !== false) {
      var pch = kit.pipeCeil || 4.3;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i].col, r = cells[i].row;
        var ch = map.ceilHAt(c, r);
        if (ch < pch) continue;
        var fy = map.cellFloorY(c, r);
        var py = fy + ch - SEWER.pipeDrop;
        var hx = walk(c - 1, r) && walk(c + 1, r);
        var hz = walk(c, r - 1) && walk(c, r + 1);
        bset(c, r);
        setYBias(0);
        var key = this._ownerOf(c, r);
        var sh = shader(key, [0.86, 0.80, 0.74]);
        var cx = c * T + T / 2, cz = r * T + T / 2;
        if (hx && !hz) {
          var sd = solid(c, r - 1) ? -1 : (solid(c, r + 1) ? 1 : 0);
          if (!sd) continue;
          var pz = cz + sd * (T * 0.5 - SEWER.pipeInset);
          B.pipe.tube([c * T, py, pz], [(c + 1) * T, py, pz], SEWER.pipeR, SEWER.pipeSeg, sh);
          if (c % SEWER.valveEvery === 1) this._sewerValve(B, cx, py, pz, 'x', sh, shader(key, [1.10, 0.72, 0.34]));
          if ((c * 7 + r * 3) % 23 === 0) dripSites.push({ x: cx, z: pz, y: py - SEWER.pipeR, col: c, row: r });
        } else if (hz && !hx) {
          var sd2 = solid(c - 1, r) ? -1 : (solid(c + 1, r) ? 1 : 0);
          if (!sd2) continue;
          var px = cx + sd2 * (T * 0.5 - SEWER.pipeInset);
          B.pipe.tube([px, py, r * T], [px, py, (r + 1) * T], SEWER.pipeR, SEWER.pipeSeg, sh);
          if (r % SEWER.valveEvery === 1) this._sewerValve(B, px, py, cz, 'z', sh, shader(key, [1.10, 0.72, 0.34]));
          if ((c * 3 + r * 7) % 23 === 0) dripSites.push({ x: px, z: cz, y: py - SEWER.pipeR, col: c, row: r });
        }
      }
    }

    /* ---- ② 壁の細部（ぬめり帯・鎖・石灰の垂れ・崩落煉瓦）---- */
    var wc = this.wallCells || [];
    for (var w = 0; w < wc.length; w++) {
      var cc = wc[w].col, rr = wc[w].row;
      var zoneW = this._zoneAt(cc, rr);
      for (var d = 0; d < 4; d++) {
        var nc = cc + D4[d][0], nr = rr + D4[d][1];
        if (!walk(nc, nr)) continue;
        bset(cc, rr);
        var nfy = map.cellFloorY(nc, nr);
        var nch = map.ceilHAt(nc, nr);
        var q = boundaryOU(T, nc, nr, D4[d][0] * -1, D4[d][1] * -1);
        var keyW = nc + ',' + nr;
        var h = hash2(cc * 13 + nc * 5, rr * 11 + nr * 3);
        /* ぬめり帯: 水路の際の壁は必ず、それ以外は時々（水位が下がった跡） */
        var wet = nearWater(nc, nr);
        if (kit.slime !== false && (wet || h < 0.30)) {
          var sy0 = nfy + (wet ? SEWER.slimeY : SEWER.slimeY + 0.22);
          var so = [q.o[0] + q.n[0] * 0.012, sy0, q.o[2] + q.n[2] * 0.012];
          B.slime.gridP(so, q.u, [0, SEWER.slimeH, 0], [0, 1], [0, 1], 1, 1,
            planeShader(keyW, wet ? [1.20, 1.18, 1.06] : [0.86, 0.88, 0.82], q.n));
        }
        /* 鎖・垂れたケーブル（壁から 0.12m。天井から腰の高さまで） */
        if (kit.chains !== false && h > 0.82 && nch > 3.2) {
          var ncnt = (h > 0.93) ? 2 : 1;
          var shC = shader(keyW, [0.52, 0.52, 0.50]);
          for (var k = 0; k < ncnt; k++) {
            var t0 = 0.3 + k * 0.4;
            var chx = q.o[0] + q.u[0] * t0 + q.n[0] * 0.12;
            var chz = q.o[2] + q.u[2] * t0 + q.n[2] * 0.12;
            var bot = nfy + 0.9 + (hash2(cc + k, rr + k) * 0.9);
            B.dark.tube([chx, nfy + nch - 0.15, chz], [chx, bot, chz], 0.035, 4, shC);
            B.dark.box(chx, bot - 0.06, chz, 0.09, 0.12, 0.09, 2, shC);
          }
        }
        /* 石灰の垂れ（つらら状）＝天井際から 0.4m ほど */
        if (kit.lime !== false && h > 0.62 && h < 0.70) {
          var shL = shader(keyW, [1.26, 1.22, 1.10]);
          for (var l = 0; l < 3; l++) {
            var tl = 0.22 + l * 0.28;
            var lx = q.o[0] + q.u[0] * tl + q.n[0] * 0.07;
            var lz = q.o[2] + q.u[2] * tl + q.n[2] * 0.07;
            var hl = 0.22 + hash2(cc * 3 + l, rr * 5 + l) * 0.34;
            B.dark.tube([lx, nfy + nch - 0.02, lz], [lx, nfy + nch - hl, lz], 0.055, 4, shL);
          }
        }
        /* 崩落した煉瓦の山（旧坑区画。壁の足元に積む＝突出 0.28m 以内） */
        if (kit.rubble !== false && zoneW === 'E' && h < 0.26) {
          var shR = shader(keyW, [0.92, 0.78, 0.64]);
          for (var b2 = 0; b2 < 6; b2++) {
            var hb = hash2(cc * 17 + b2 * 3, rr * 19 + b2);
            var tb = 0.12 + hb * 0.76;
            var bx = q.o[0] + q.u[0] * tb + q.n[0] * (0.06 + hb * 0.20);
            var bz = q.o[2] + q.u[2] * tb + q.n[2] * (0.06 + hb * 0.20);
            var by2 = nfy + 0.055 + (b2 % 3) * 0.10;
            B.wall.box(bx, by2, bz, 0.22 + hb * 0.10, 0.10, 0.22 + hb * 0.10, 2.4, shR);
          }
        }
      }
    }

    /* ---- ③ 旧坑の支保工・骨、床の格子、水面のゴミ ---- */
    for (var j = 0; j < cells.length; j++) {
      var c2 = cells[j].col, r2 = cells[j].row;
      var zone2 = this._zoneAt(c2, r2);
      var fy2 = map.cellFloorY(c2, r2);
      var ch2 = map.ceilHAt(c2, r2);
      var cx2 = c2 * T + T / 2, cz2 = r2 * T + T / 2;
      /* 支保工（旧坑の幅1の坑道に一定間隔で。柱は壁付き・突出 0.22m） */
      if (kit.timbers !== false && zone2 === 'E' && !openAt(c2, r2)) {
        var nsT = solid(c2 - 1, r2) && solid(c2 + 1, r2);
        var ewT = solid(c2, r2 - 1) && solid(c2, r2 + 1);
        var hit = (nsT && r2 % SEWER.timberEvery === 2) || (ewT && !nsT && c2 % SEWER.timberEvery === 2);
        if (hit) {
          bset(c2, r2); setYBias(0);
          var keyT = c2 + ',' + r2;
          var shT = shader(keyT, [0.98, 0.80, 0.56]);
          var topT = fy2 + Math.min(ch2 - 0.14, 2.26);
          var ax = nsT ? 1 : 0;          /* 柱が左右（X）に立つ＝南北の坑道 */
          var ox2 = ax ? (T * 0.5 - 0.13) : 0, oz2 = ax ? 0 : (T * 0.5 - 0.13);
          B.pipe.box(cx2 - ox2, fy2 + (topT - fy2) / 2, cz2 - oz2,
            ax ? 0.22 : 0.26, topT - fy2, ax ? 0.26 : 0.22, 1.1, shT);
          B.pipe.box(cx2 + ox2, fy2 + (topT - fy2) / 2, cz2 + oz2,
            ax ? 0.22 : 0.26, topT - fy2, ax ? 0.26 : 0.22, 1.1, shT);
          B.pipe.box(cx2, topT - 0.10, cz2,
            ax ? T : 0.26, 0.20, ax ? 0.26 : T, 1.1, shT);
        }
      }
      /* 骨（旧坑の行き止まり）。床置きは薄物だけ */
      if (kit.bones !== false && zone2 === 'E') {
        var deg = 0;
        for (var dd = 0; dd < 4; dd++) if (walk(c2 + D4[dd][0], r2 + D4[dd][1])) deg++;
        if (deg === 1) {
          bset(c2, r2); setYBias(0);
          var shB2 = this.propShader(c2, r2, [1.32, 1.28, 1.14], 0.90);
          B.sheet.box(cx2 - 0.22, fy2 + 0.07, cz2 + 0.10, 0.62, 0.13, 0.14, 1.6, shB2);
          B.sheet.box(cx2 - 0.10, fy2 + 0.07, cz2 - 0.16, 0.56, 0.12, 0.13, 1.6, shB2);
          B.sheet.box(cx2 + 0.30, fy2 + 0.11, cz2 + 0.02, 0.24, 0.22, 0.22, 1.8, shB2);
          B.dark.box(cx2 + 0.30, fy2 + 0.13, cz2 - 0.09, 0.14, 0.08, 0.05, 2, shB2);
        }
      }
      /* 水面の浮遊ゴミ・油膜（水路マスの上・デカール） */
      if (kit.scum !== false && map.tileAt(c2, r2) === TILE.WATER) {
        var hs = hash2(c2 * 29 + 7, r2 * 31 + 3);
        if (hs < 0.34) {
          bset(c2, r2); setYBias(0);
          var sz2 = 0.9 + hs * 2.2;
          var ox3 = (hash2(c2 + 5, r2 + 2) - 0.5) * 0.5, oz3 = (hash2(c2 + 2, r2 + 5) - 0.5) * 0.5;
          B.litter.gridP([cx2 + ox3 - sz2 / 2, fy2 - WATER_SURF + 0.012, cz2 + oz3 + sz2 / 2],
            [sz2, 0, 0], [0, 0, -sz2], [0, 1], [0, 1], 1, 1,
            planeShader(c2 + ',' + r2, [0.30, 0.30, 0.26], [0, 1, 0]),
            (function (u0, v0) {
              return function (ss, tt) { return [u0 + ss * 0.5, v0 + tt * 0.5]; };
            })(((hash2(c2 + 61, r2 + 13) * 2) | 0) * 0.5, ((hash2(c2 + 13, r2 + 61) * 2) | 0) * 0.5));
        }
      }
    }

    /* ---- ④ 床の格子（下に暗い水面）---- */
    var grates = meta.grates || [];
    for (var gi = 0; gi < grates.length; gi++) this._sewerGrate(B, grates[gi], shader, planeShader);

    /* ---- ⑤ 滴り（落下する雫＋水面の波紋）と回転灯 ---- */
    this._sewerFx = { drips: [], beacons: [] };
    var sites = (meta.dripSites || []).concat(dripSites);
    var want = Math.min(SEWER.dripMax, kit.drips === undefined ? 160 : kit.drips);
    var step = Math.max(1, Math.floor(sites.length / Math.max(1, want)));
    for (var si = 0, n2 = 0; si < sites.length && n2 < want; si += step, n2++) {
      var st = sites[si];
      var gy = map.cellFloorY(st.col, st.row);
      this._sewerFx.drips.push({
        x: st.x, z: st.z, y0: st.y, y1: gy + 0.02,
        period: 1.5 + hash2(st.col * 7 + 1, st.row * 5 + 3) * 2.6,
        phase: hash2(st.col + 3, st.row + 11)
      });
    }
    this._buildDrips();
    setYBias(0);
  };

  /** 大径配管のバルブ（車輪＋フランジ）。軸 'x' / 'z' */
  World.prototype._sewerValve = function (B, x, y, z, axis, sh, shWheel) {
    var ax = (axis === 'x');
    B.pipe.box(x, y, z, ax ? 0.22 : 0.62, 0.62, ax ? 0.62 : 0.22, 1.4, sh);
    /* 車輪: 上に立てた輪（8本のスポークで輪郭を作る＝面の穴が出ない箱組み） */
    var wy = y + 0.44;
    B.metal.tube([x, y + 0.14, z], [x, wy, z], 0.05, 5, shWheel);
    for (var k = 0; k < 8; k++) {
      var a = k / 8 * Math.PI * 2;
      var dx = Math.cos(a) * 0.26, dz = Math.sin(a) * 0.26;
      B.metal.box(x + (ax ? 0 : dx), wy + dz * (ax ? 0 : 1) + (ax ? dz : 0), z + (ax ? dx : 0),
        0.09, 0.09, 0.09, 2, shWheel);
    }
  };

  /** 床の格子（metalGrate・下に暗い水面が見える） */
  World.prototype._sewerGrate = function (B, g, shader, planeShader) {
    var map = this.map, T = map.tileSize;
    if (this._bset) this._bset(g.col, g.row);
    setYBias(0);
    var fy = map.cellFloorY(g.col, g.row);
    var cx = g.col * T + T / 2, cz = g.row * T + T / 2;
    var key = this._ownerOf(g.col, g.row);
    var W = 1.72, D = 0.52;
    /* 下の暗い水（穴の底）。桝の側面4枚で穴を閉じる */
    var shD = shader(key, [0.26, 0.30, 0.30]);
    B.dark.box(cx, fy - D / 2, cz, W, D, W, 1.0, shD);
    /* 格子面（アルファ抜き・床から 2cm 上） */
    B.grate.gridP([cx - W / 2, fy + 0.02, cz + W / 2], [W, 0, 0], [0, 0, -W], [0, 1], [0, 1], 1, 1,
      planeShader(key, [1.06, 1.06, 1.04], [0, 1, 0]));
    /* 縁の鋼枠 */
    var shF = shader(key, [0.88, 0.90, 0.90]);
    for (var k = 0; k < 4; k++) {
      var sx = (k < 2) ? W + 0.16 : 0.10, sz = (k < 2) ? 0.10 : W + 0.16;
      var ox = (k < 2) ? 0 : ((k === 2) ? -(W / 2 + 0.05) : (W / 2 + 0.05));
      var oz = (k < 2) ? ((k === 0) ? -(W / 2 + 0.05) : (W / 2 + 0.05)) : 0;
      B.metal.box(cx + ox, fy + 0.03, cz + oz, sx, 0.08, sz, 1.6, shF);
    }
  };

  /** 滴り（落下する雫）を InstancedMesh 1体にまとめる。総数は契約の 200 以下 */
  World.prototype._buildDrips = function () {
    var fx = this._sewerFx;
    if (!fx || !fx.drips.length || typeof THREE.InstancedMesh !== 'function') return;
    var geo = this._track(new THREE.BoxGeometry(0.035, 0.13, 0.035));
    var mat = this._track(new THREE.MeshBasicMaterial({
      color: 0x9fc4cc, fog: true, transparent: true, opacity: 0.72, depthWrite: false
    }));
    var mesh = new THREE.InstancedMesh(geo, mat, fx.drips.length);
    mesh.name = 'sewerDrips';
    mesh.frustumCulled = false;
    this._dripMesh = mesh;
    this.group.add(mesh);
    this.stats.drips = fx.drips.length;
  };

  /** 滴り・回転灯・水門・ハンドルの更新（ゲーム内時刻駆動＝__pump でも同じ絵になる） */
  World.prototype._updateSewerFx = function (t) {
    /* 水門: doorOpen になったら 3 秒かけて上がる（上がりきったら戻らない） */
    var sl = this._sluice;
    if (sl) {
      var pr = ESCAPE.game && ESCAPE.game.progress;
      var wantOpen = this.sluiceForceOpen || !!(pr && pr.gimmick && pr.gimmick.doorOpen);
      var dt = (this._sluiceT === undefined) ? 0 : (t - this._sluiceT);
      this._sluiceT = t;
      if (wantOpen && sl.t < sl.dur) sl.t = Math.min(sl.dur, sl.t + (dt > 0 && dt < 1 ? dt : 0));
      var u0 = sl.t / sl.dur;
      u0 = u0 * u0 * (3 - 2 * u0);                 /* ゆるやかに動き出して止まる */
      sl.mesh.position.y = sl.lift * u0;
    }
    /* ハンドル: 取得したら掛け具から消える */
    if (this._handleMesh) {
      var pr2 = ESCAPE.game && ESCAPE.game.progress;
      this._handleMesh.visible = !(pr2 && pr2.gimmick && pr2.gimmick.key);
    }
    var fx = this._sewerFx;
    if (!fx) return;
    var m = this._dripMesh;
    if (m) {
      var L = fx.drips, m4 = DRIP_M4;
      for (var i = 0; i < L.length; i++) {
        var d = L[i];
        var u = ((t / d.period) + d.phase) % 1;
        var y = d.y0 + (d.y1 - d.y0) * (u * u);   /* 自由落下＝二次で加速 */
        m4.makeScale(1, 1, 1);
        m4.setPosition(d.x, y, d.z);
        m.setMatrixAt(i, m4);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    for (var b = 0; b < fx.beacons.length; b++) {
      var bc = fx.beacons[b];
      bc.mesh.rotation.y = t * bc.speed;
    }
  };
  var DRIP_M4 = new THREE.Matrix4();

  /** 回転灯の回る反射鏡（別メッシュ・毎フレーム y 回転） */
  World.prototype._addBeacon = function (x, y, z) {
    if (!this._sewerFx) this._sewerFx = { drips: [], beacons: [] };
    var bld = new Builder(false);
    bld.box(x, y, z, 0.10, 0.20, 0.26, 2, flat([2.60, 0.42, 0.26]));
    bld.box(x, y, z, 0.26, 0.20, 0.10, 2, flat([0.60, 0.10, 0.08]));
    var mesh = buildMesh(bld, this._track(new THREE.MeshBasicMaterial(
      { map: ESCAPE.Textures.get('lamp'), vertexColors: true, fog: true })));
    this._track(mesh.geometry);
    mesh.name = 'sewerBeacon';
    /* 回転の中心をランプの位置に置く（頂点は原点周りに寄せ直す） */
    mesh.geometry.translate(-x, -y, -z);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this._sewerFx.beacons.push({ mesh: mesh, speed: 2.2 });
  };

  /* P5c「槽」（沈殿槽・沈砂池）。実体マスを掘り下げて水を張り、縁に笠石を回す。
   * 歩けないまま覗き込める＝正文「槽の水は覗くな」の絵をそのまま作る。 */
  var BASIN_DEPTH = 0.85;     /* 縁の天端から水面までの深さ(m) */
  var BASIN_PARA = 0.52;      /* 笠石の立ち上がり(m) */
  var BASIN_COPE = 0.34;      /* 笠石の天端の幅(m) */

  World.prototype._sewerBasins = function (B, SH) {
    var at = this._basinAt;
    if (!at) return;
    var keys = Object.keys(at);
    if (!keys.length) return;
    var map = this.map, T = map.tileSize;
    var bset = this._bset || function () {};
    for (var i = 0; i < keys.length; i++) {
      var cr = keys[i].split(','), c = +cr[0], r = +cr[1];
      var bs = at[keys[i]];
      var depth = (bs.depth === undefined) ? BASIN_DEPTH : bs.depth;
      var tint = bs.rgb || [0.52, 0.86, 0.62];
      bset(c, r); setYBias(0);
      var key = this._ownerOf(c, r);
      var fy = map.cellFloorY(c, r);
      var sy = fy - depth;
      var top = fy + BASIN_PARA;
      var x0 = c * T, z0 = r * T;
      /* 水面（緑に光る） */
      B.sewerWater.gridP([x0, sy, z0 + T], [T, 0, 0], [0, 0, -T], WDIV2, WDIV2, 1, 1,
        SH.floorShader(key, tint, [0, 1, 0]));
      var wt = this._tintAt(c, r).w;
      for (var d = 0; d < 4; d++) {
        var dc = D4[d][0], dr = D4[d][1];
        var nc = c + dc, nr = r + dr;
        if (at[nc + ',' + nr]) continue;               /* 槽の中どうしは continue */
        var open = map.isWalkable(nc, nr);
        var q = boundaryOU(T, c, r, dc, dr);
        /* 内壁（笠石の幅だけ内側へ寄せる＝外面と同一平面にしない） */
        var ix = -q.n[0] * BASIN_COPE, iz = -q.n[2] * BASIN_COPE;
        B.wall.gridP([q.o[0] + ix, sy - 0.18, q.o[2] + iz], q.u, [0, top - sy + 0.18, 0],
          [0, 1], [0, 0.5, 1], 1, (top - sy) / 3,
          SH.planeShader(key, [wt[0] * 0.66, wt[1] * 0.70, wt[2] * 0.70], q.n));
        if (!open) continue;
        /* 外面（通路側から見える笠石の立ち上がり） */
        var on = [-q.n[0], 0, -q.n[2]];
        B.wall.gridP([q.o[0] + q.u[0], fy, q.o[2] + q.u[2]], [-q.u[0], 0, -q.u[2]],
          [0, top - fy, 0], [0, 1], [0, 1], 1, (top - fy) / 3,
          SH.planeShader(key, [wt[0] * 0.98, wt[1] * 1.00, wt[2] * 1.00], on));
        /* 天端（笠石の上面） */
        var cw = BASIN_COPE;
        B.wall.gridP([q.o[0], top, q.o[2]], q.u, [-q.n[0] * cw, 0, -q.n[2] * cw],
          [0, 1], [0, 1], 1, 1, SH.planeShader(key, [wt[0] * 1.10, wt[1] * 1.12, wt[2] * 1.12], [0, 1, 0]));
      }
    }
    setYBias(0);
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
      if (k.type === 'shaftGrate') {
        /* P5c: 縦坑の天端の格子（上から青白い光が落ちてくる）。
           格子の上に自発光面を置く＝「地上の灯り」。滴りはここから落ちる。 */
        var gy = ch - 0.06;
        B.lamp.grid([cx - 0.92, gy + 0.10, cz + 0.92], [1.84, 0, 0], [0, 0, -1.84], 1, 1, 1, 1,
          flat([0.92, 0.98, 1.10]));
        B.grate.gridP([cx - 0.92, gy, cz + 0.92], [1.84, 0, 0], [0, 0, -1.84], [0, 1], [0, 1], 1, 1,
          flat([0.38, 0.42, 0.48]));
        /* 桁（枠）＝天井の穴の縁 */
        for (var fr = 0; fr < 4; fr++) {
          var sxf = (fr < 2) ? 2.10 : 0.14, szf = (fr < 2) ? 0.14 : 2.10;
          var oxf = (fr < 2) ? 0 : ((fr === 2) ? -0.98 : 0.98);
          var ozf = (fr < 2) ? ((fr === 0) ? -0.98 : 0.98) : 0;
          B.metal.box(cx + oxf, gy - 0.05, cz + ozf, sxf, 0.16, szf, 1.4, shD);
        }
      } else if (k.type === 'surgicalLamp') {
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

  /* P4.11 項目1「見た目と当たり判定の一致（隙間問題）」。
   * 什器マスは当たりがマス全面なのに造形は 1.6m x 0.9m 程度しかなく、
   * 「通れそうに見えて通れない」隙間を大量に作っていた（実測 211マス）。
   * 対処は什器を大きくすることではなく、什器を**設備ベイ**として据え直すこと:
   *   基壇(plinth)  マスいっぱいの台座。床から立ち上がって足元の抜けを塞ぐ
   *   仕切り板(bay) 側面・背面の板。什器同士・什器と壁の隙間を塞ぐ（正面だけ開ける）
   * 什器そのものは基壇の上に載せる（脚が床に埋まらない）。
   * 背の高い什器は天井(3.0m)を突き抜けないよう基壇を低くする。 */
  var PLINTH_H = { specTank: 0.14, cageStack: 0.20, machine: 0.20, tank: 0.20, incubator: 0.24 };
  var PLINTH_DEFAULT = 0.30;
  /** 通路側に見せる仕切り板の高さ(m)。腰高＝跨げないと一目で分かる高さ。
   *  背の低い什器（寝台・机・端末台）は什器そのものが隠れないよう少し低くする。 */
  var BAY_H = 1.16;
  var BAY_LOW = { gurney: 0.90, desk: 0.90, console: 0.90, crate: 0.90, benchIsland: 0.90, opTable: 0.90 };

  /** 什器マスの基壇と仕切り板。什器本体より先に積む（本体は基壇の上へ乗る） */
  World.prototype._furnBase = function (B, f, shader, ph) {
    var map = this.map, T = map.tileSize;
    var base = map.cellFloorY(f.col, f.row);
    var cx = f.col * T + T / 2, cz = f.row * T + T / 2;
    var key = this._ownerOf(f.col, f.row);
    var tint = this._tintAt(f.col, f.row);
    var shBase = shader(key, [0.58, 0.60, 0.62]);
    var shLip = shader(key, [0.94, 0.95, 0.92]);
    var shBay = shader(key, [0.80, 0.82, 0.84]);
    var shWall = shader(key, tint.w);
    setYBias(base);
    /* 基壇: 本体＋天端の張り出し（縁に影の線が出て「段」だと読める） */
    B.dark.box(cx, (ph - 0.06) / 2, cz, T - 0.08, ph - 0.06, T - 0.08, 0.7, shBase);
    B.metal.box(cx, ph - 0.03, cz, T - 0.01, 0.06, T - 0.01, 0.7, shLip);
    /* 仕切り板。隣が実体なら天井まで（＝壁の殻を閉じて向こうを覗かせない）、
       隣が通路なら腰高。正面（dir）だけは開けて什器を見せる。 */
    var ch = map.ceilHAt(f.col, f.row);
    var fv = FACE_VEC[f.dir] || FACE_VEC.n;
    var DD = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < 4; d++) {
      var dc = DD[d][0], dr = DD[d][1];
      var walk = map.isWalkable(f.col + dc, f.row + dr);
      var front = (fv[0] === dc && fv[2] === dr);
      var h, th, bag, sh2;
      if (!walk) { h = ch; th = 0.10; bag = B.wall; sh2 = shWall; }
      else if (front) continue;                 /* 正面は開けたまま */
      else if (!f.open) continue;               /* アルコーブ: 既に壁面が張られている */
      else { h = BAY_LOW[f.type] || BAY_H; th = 0.12; bag = B.metal; sh2 = shBay; }
      bag.box(cx + dc * (T / 2 - th / 2), h / 2, cz + dr * (T / 2 - th / 2),
        dc ? th : T - 0.02, h, dr ? th : T - 0.02, 0.5, sh2);
    }
    setYBias(0);
  };

  World.prototype._furniture = function (B, f, shader) {
    var T = this.map.tileSize;
    if (this._bset) this._bset(f.col, f.row);
    var ph = (PLINTH_H[f.type] === undefined) ? PLINTH_DEFAULT : PLINTH_H[f.type];
    this._furnBase(B, f, shader, ph);
    setYBias(this.map.cellFloorY(f.col, f.row) + ph);
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
      case 'sewerPump': {
        /* P5c: 巨大ポンプ（渦巻ポンプの胴＋電動機＋吐出管）。什器マスの中に収める */
        var pw = L(1.66, 1.10), pd = L(1.10, 1.66);
        B.metal.box(cx, 0.62, cz, pw, 1.14, pd, 0.7, sh);
        B.dark.box(cx, 0.08, cz, pw + 0.10, 0.16, pd + 0.10, 1.2, shD);
        /* 渦巻の胴（横に寝た太い筒） */
        var pa = ew ? [1, 0, 0] : [0, 0, 1];
        B.metal.tube([cx - pa[0] * 0.52, 1.32, cz - pa[2] * 0.52],
          [cx + pa[0] * 0.52, 1.32, cz + pa[2] * 0.52], 0.52, 10, sh);
        /* 電動機 */
        B.dark.box(cx + (ew ? 0 : 0.42), 1.98, cz + (ew ? 0.42 : 0), 0.62, 0.62, 0.62, 1.2, shD);
        /* 吐出管（天井へ抜ける） */
        B.metal.tube([cx - pa[0] * 0.46, 1.84, cz - pa[2] * 0.46],
          [cx - pa[0] * 0.46, 2.90, cz - pa[2] * 0.46], 0.21, 8, sh);
        /* 銘板と点検窓 */
        B.screen.box(cx + (ew ? 0.30 : 0), 1.02, cz + (ew ? 0 : 0.30), 0.30, 0.20, 0.30, 2, sh);
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

  /* P4.13: センサー表示灯を InstancedMesh 1体にまとめる（ドローコール+1のみ）。暗所で
     6m先から読める自発光の赤。周囲は照らさない（点光源なし）。 */
  World.prototype._buildSensorLamps = function () {
    var L = this.sensorLamps;
    if (!L.length || typeof THREE.InstancedMesh !== 'function') return;
    var geo = this._track(new THREE.BoxGeometry(1, 0.096, 1));
    var mat = this._track(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }));
    var mesh = new THREE.InstancedMesh(geo, mat, L.length);
    var m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (var i = 0; i < L.length; i++) {
      m4.makeScale(L[i].sx, 1, L[i].sz);
      m4.setPosition(L[i].x, L[i].y, L[i].z);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, c.setRGB(1.0, 0.25, 0.22));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this._sensorMesh = mesh;
    this.group.add(mesh);
  };

  /**
   * P4.17 段階2: 大面の照明の出し方を切り替える。
   *   'dynamic' 近傍灯＋焼き込みの残り（系統Y の既定）
   *   'baked'   焼き込みだけ（自動退避の行き先。世界は組み直さない＝止まらない）
   * 退避では明滅の加算メッシュも元の強さへ戻す（実ライトが居なくなるため）。
   */
  World.prototype.setLightingMode = function (mode) {
    var mats = this._bigMats;
    if (!mats) return false;
    var baked = (mode === 'baked');
    var table = baked ? mats.baked : mats.dynamic;
    for (var i = 0; i < this.group.children.length; i++) {
      var m = this.group.children[i];
      var want = table[m.name];
      if (want && m.material !== want) m.material = want;
    }
    var RQ2 = ESCAPE.RQ;
    this.flickScale = (baked ? 1 : (Y_ON ? Y_MIX : 1)) * (RQ2 ? RQ2.addLightScale() : 1);
    this.lightingMode = baked ? 'baked' : 'dynamic';
    return true;
  };

  World.prototype.update = function (t) {
    /* P5c: 動く素材（水面の法線2層スクロール）。dt はゲーム内時刻の差分で取る
       ＝ __pump 駆動のスクショでも同じ絵になる。fallback では animate が静止を選ぶ。 */
    var TXA = ESCAPE.Textures;
    if (TXA && TXA.animate) {
      var adt = (this._lastT === undefined) ? 0 : (t - this._lastT);
      this._lastT = t;
      if (adt > 0 && adt < 1) TXA.animate(adt);
    }
    this._updateSewerFx(t);
    for (var i = 0; i < this.flickers.length; i++) {
      var e = this.flickers[i];
      var lvl = flickerLevel(e.pattern, e.phase, t) * (this.flickScale || 1);
      for (var m = 0; m < e.mats.length; m++) e.mats[m].color.setScalar(lvl);
    }
    /* P4.13: センサー表示灯の点滅（約1.25Hz、点灯55%）。位相はマスごとにずらす */
    var sm = this._sensorMesh;
    if (sm && sm.instanceColor) {
      var L = this.sensorLamps, c = SENSOR_TMP_COLOR;
      for (var k = 0; k < L.length; k++) {
        var ph = (t * 1.25 + L[k].phase) % 1;
        var on = ph < 0.55;
        sm.setColorAt(k, on ? c.setRGB(1.0, 0.25, 0.22) : c.setRGB(0.30, 0.06, 0.05));
      }
      sm.instanceColor.needsUpdate = true;
    }
  };
  var SENSOR_TMP_COLOR = new THREE.Color();

  World.prototype.dispose = function () {
    /* P5c: 水面の uniform を Textures.animate の配信先から外す（作り直しで溜めない） */
    var TXD = ESCAPE.Textures;
    if (this._waterMat && TXD && TXD.unbindAnimated) {
      var ud = this._waterMat.userData && this._waterMat.userData.water;
      if (ud && ud.uniforms) TXD.unbindAnimated(ud.uniforms);
    }
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

  /* ================================================================
   * 機械テスト（契約 §6）。P4.11 項目1「見た目と当たり判定の一致（隙間問題）」。
   * runAll は ESCAPE.__extraSuites を拾う（js/traps.js と同じ流儀）。
   * ============================================================== */

  /**
   * 実体マス1つぶんの「造形フットプリント」を測る。
   * 床・天井・デカール・明滅の加算メッシュは数えない（それらは当たりを表さない）。
   * 頂点はプレイヤーが通る高さ帯（床+0.02〜床+2.0m）だけを見る。
   * 戻り値: マスの床面積に対する頂点AABBの被覆率（0..1）
   */
  function footprintCoverage(world) {
    var map = world.map, T = map.tileSize;
    var SKIP = {
      floor: 1, floorTile: 1, floorWet: 1, floorMetal: 1, ceil: 1,
      litter: 1, poster: 1, sign: 1, zonesign: 1, hatch: 1, blood: 1, water: 1, glass: 1
    };
    var furnAt = Object.create(null);
    var furn = (map.meta && map.meta.furniture) || [];
    for (var i = 0; i < furn.length; i++) furnAt[furn[i].col + ',' + furn[i].row] = furn[i];
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var cells = [], index = Object.create(null);
    for (var r = 1; r < map.height - 1; r++) {
      for (var c = 1; c < map.width - 1; c++) {
        if (!map.isSolid(c, r)) continue;
        var nw = 0;
        for (var d = 0; d < 4; d++) if (map.isWalkable(c + D[d][0], r + D[d][1])) nw++;
        if (nw === 0) continue;
        /* 検査対象＝「2方向以上から回り込んで見える実体マス」と全ての什器マス。
           1方向しか露出していない壁は面が当たりの位置そのもの＝隙間になりようがない。 */
        var f = furnAt[c + ',' + r];
        if (nw < 2 && !f) continue;
        var e = { col: c, row: r, nw: nw, furn: f ? f.type : null,
                  x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, n: 0, cov: 0 };
        index[c + ',' + r] = e;
        cells.push(e);
      }
    }
    var EPS = 0.03;
    var kids = world.group.children;
    for (var m = 0; m < kids.length; m++) {
      var mesh = kids[m], nm = mesh.name || '';
      if (SKIP[nm] || nm.indexOf('flick_') === 0) continue;
      var arr = mesh.geometry.getAttribute('position').array;
      for (var v = 0; v < arr.length; v += 3) {
        var x = arr[v], y = arr[v + 1], z = arr[v + 2];
        var cHi = Math.floor((x + EPS) / T), cLo = Math.floor((x - EPS) / T);
        var rHi = Math.floor((z + EPS) / T), rLo = Math.floor((z - EPS) / T);
        for (var cc = cLo; cc <= cHi; cc++) {
          for (var rr = rLo; rr <= rHi; rr++) {
            var e2 = index[cc + ',' + rr];
            if (!e2) continue;
            var fy = map.cellFloorY(cc, rr);
            if (y < fy + 0.02 || y > fy + 2.0) continue;
            var lx = x < cc * T ? cc * T : (x > (cc + 1) * T ? (cc + 1) * T : x);
            var lz = z < rr * T ? rr * T : (z > (rr + 1) * T ? (rr + 1) * T : z);
            if (lx < e2.x0) e2.x0 = lx;
            if (lx > e2.x1) e2.x1 = lx;
            if (lz < e2.z0) e2.z0 = lz;
            if (lz > e2.z1) e2.z1 = lz;
            e2.n++;
          }
        }
      }
    }
    for (var k = 0; k < cells.length; k++) {
      var e3 = cells[k];
      e3.cov = e3.n ? ((e3.x1 - e3.x0) * (e3.z1 - e3.z0)) / (T * T) : 0;
    }
    return cells;
  }

  function testP411FootprintCoverage(t, g) {
    g.reset();
    var cells = footprintCoverage(g.world);
    t.ok(cells.length > 800, 'P4.11 隙間: 検査対象の実体マスを全数拾えている', cells.length + 'マス');
    var bad = [], worst = 1, worstCell = '';
    for (var i = 0; i < cells.length; i++) {
      var e = cells[i];
      if (e.cov < worst) { worst = e.cov; worstCell = e.col + ',' + e.row + (e.furn ? '(' + e.furn + ')' : ''); }
      if (e.cov < 0.90 - 1e-9) bad.push(e.col + ',' + e.row + (e.furn ? '(' + e.furn + ')' : '') + '=' + e.cov.toFixed(3));
    }
    t.ok(bad.length === 0,
      'P4.11 隙間: 全実体マスの造形フットプリントがマスの90%以上を覆う（契約 項目1）',
      bad.slice(0, 8).join(' ') || ('最小 ' + worst.toFixed(3) + ' @' + worstCell));
    /* 什器マスは基壇でマス全面を占める（回帰の芯） */
    var furn = (g.map.meta && g.map.meta.furniture) || [];
    var byCell = Object.create(null);
    for (var c = 0; c < cells.length; c++) byCell[cells[c].col + ',' + cells[c].row] = cells[c];
    var missing = [], low = 1;
    for (var f = 0; f < furn.length; f++) {
      var e2 = byCell[furn[f].col + ',' + furn[f].row];
      if (!e2) { missing.push(furn[f].col + ',' + furn[f].row); continue; }
      if (e2.cov < low) low = e2.cov;
    }
    t.ok(missing.length === 0, 'P4.11 隙間: 什器マスが全て検査対象に入っている', missing.join(' ') || furn.length + '件');
    t.ok(low >= 0.90, 'P4.11 隙間: 什器マスの被覆率の最小値が90%以上', low.toFixed(3));
  }

  /** 什器マスの「殻」が閉じている＝隣が実体の面にも造形がある（向こう側が透けない） */
  function testP411FurnitureShellClosed(t, g) {
    g.reset();
    var map = g.map, T = map.tileSize;
    var furn = (map.meta && map.meta.furniture) || [];
    var kids = g.world.group.children;
    var SKIP = { floor: 1, floorTile: 1, floorWet: 1, floorMetal: 1, ceil: 1,
                 litter: 1, poster: 1, sign: 1, zonesign: 1, hatch: 1, blood: 1, water: 1, glass: 1 };
    /* 面ごとに「境界面から0.16m以内に、床際と目線より上の両方に頂点があるか」を見る。
       箱の面は四隅にしか頂点が無いので、高さ帯の途中に頂点があることは期待しない。
       下(床際)と上(2.2m超)の両方に頂点があれば、その面は立った視線を遮る板が立っている。 */
    var hitLo = Object.create(null);
    var hitHi = Object.create(null);
    var need = Object.create(null);
    var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < furn.length; i++) {
      for (var d = 0; d < 4; d++) {
        var nc = furn[i].col + D[d][0], nr = furn[i].row + D[d][1];
        if (map.isWalkable(nc, nr)) continue;         /* 通路に面する側は見せる面 */
        need[furn[i].col + ',' + furn[i].row + ',' + d] = true;
      }
    }
    for (var m = 0; m < kids.length; m++) {
      var mesh = kids[m], nm = mesh.name || '';
      if (SKIP[nm] || nm.indexOf('flick_') === 0) continue;
      var arr = mesh.geometry.getAttribute('position').array;
      for (var v = 0; v < arr.length; v += 3) {
        var x = arr[v], y = arr[v + 1], z = arr[v + 2];
        var c = Math.floor(x / T), r = Math.floor(z / T);
        for (var cc = c - 1; cc <= c + 1; cc++) {
          for (var rr = r - 1; rr <= r + 1; rr++) {
            var fy = map.cellFloorY(cc, rr);
            var lo = (y <= fy + 0.12), hi = (y >= fy + 2.2);
            if (!lo && !hi) continue;
            var hit = lo ? hitLo : hitHi;
            var lx = x - cc * T, lz = z - rr * T;
            if (lx < -0.02 || lx > T + 0.02 || lz < -0.02 || lz > T + 0.02) continue;
            if (lx > T - 0.16) hit[cc + ',' + rr + ',0'] = true;
            if (lx < 0.16) hit[cc + ',' + rr + ',1'] = true;
            if (lz > T - 0.16) hit[cc + ',' + rr + ',2'] = true;
            if (lz < 0.16) hit[cc + ',' + rr + ',3'] = true;
          }
        }
      }
    }
    var open = [];
    for (var key in need) if (!hitLo[key] || !hitHi[key]) open.push(key);
    t.ok(open.length === 0,
      'P4.11 隙間: 什器マスの実体側の面が全て塞がっている（向こうが透けない）',
      open.slice(0, 8).join(' ') || (Object.keys(need).length + '面を検査'));
  }

  /** P4.11 項目7「質感を一回り上げる」: 解像度と細部の量を数値で固定する */
  function testP411TextureQuality(t, g) {
    var TX = ESCAPE.Textures;
    if (!t.ok(!!TX && !!TX.sizeOf, 'P4.11 質感: テクスチャの計測口がある')) return;
    /* 契約「壁1024・床1024」。壁は 2m x 3m なので 1024 x 1536（＝512 px/m で床と同密度） */
    var walls = ['wall', 'wall2', 'wall3', 'wallPaint', 'wallMetal'];
    var badW = [];
    for (var i = 0; i < walls.length; i++) {
      var s = TX.sizeOf(walls[i]);
      if (s.w !== 1024 || s.h !== 1536) badW.push(walls[i] + '=' + s.w + 'x' + s.h);
    }
    t.ok(badW.length === 0, 'P4.11 質感: 壁テクスチャは 1024 x 1536（契約「壁1024」）',
      badW.join(' ') || walls.length + '種');
    var floors = ['floor', 'floorTile', 'floorWet', 'floorMetal'];
    var badF = [];
    for (var j = 0; j < floors.length; j++) {
      var s2 = TX.sizeOf(floors[j]);
      if (s2.w !== 1024 || s2.h !== 1024) badF.push(floors[j] + '=' + s2.w + 'x' + s2.h);
    }
    t.ok(badF.length === 0, 'P4.11 質感: 床テクスチャは 1024 x 1024（契約「床1024」）',
      badF.join(' ') || floors.length + '種');
    t.ok(TX.sizeOf('ceiling').w >= 768, 'P4.11 質感: 天井も解像度を上げてある（染みが読める）',
      TX.sizeOf('ceiling').w + 'px');
    /* 同じ面積に載る細部の総量。P4.10 時点の実測は 壁 3.1〜3.9 / 床 1.8〜2.3 だった。
       解像度2倍＋汚れ/剥落/擦れ/擬似スペキュラの追加で 3〜4倍になっている。 */
    var thin = [];
    for (var k = 0; k < walls.length; k++) {
      var d = TX.detail(walls[k]);
      if (d.total < 8.0) thin.push(walls[k] + '=' + d.total.toFixed(1));
    }
    t.ok(thin.length === 0, 'P4.11 質感: 壁の細部の総量が P4.10 の2倍以上（8.0以上）',
      thin.join(' ') || '全' + walls.length + '種');
    var thinF = [];
    for (var m = 0; m < floors.length; m++) {
      var d2 = TX.detail(floors[m]);
      if (d2.total < 5.0) thinF.push(floors[m] + '=' + d2.total.toFixed(1));
    }
    t.ok(thinF.length === 0, 'P4.11 質感: 床の細部の総量が P4.10 の2倍以上（5.0以上）',
      thinF.join(' ') || '全' + floors.length + '種');
    /* GPU予算は青天井にしない（実機のためのガード。触るつまみは Textures.setScale） */
    var b = TX.budget();
    t.ok(b.gpuMB < 96, 'P4.11 質感: テクスチャのGPU見積りが上限内（mipmap込み）',
      b.gpuMB.toFixed(1) + 'MB / ' + b.mpx.toFixed(2) + 'MPx');
    if (g) { /* 参照のみ */ }
  }

  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];
  ESCAPE.__extraSuites.push(testP411FootprintCoverage, testP411FurnitureShellClosed,
    testP411TextureQuality);

  World.Builder = Builder;
  World.buildMesh = buildMesh;
  World.setYBias = setYBias;
  World.stepBandHalf = stepBandHalf;

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

  /* ================================================================
   * P4.16 レーンA 機械テスト（契約 DESIGN.md §4「P4.16 再プレイ差し戻し」項目1・2）
   *   test.js はレーンBが同時に編集しているので、他モジュールと同じ流儀で
   *   ESCAPE.__extraSuites へ積む。署名は test.js の suites と同じ (t, g)。
   * ============================================================== */
  ESCAPE.__extraSuites = ESCAPE.__extraSuites || [];

  var FACE = { n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0] };

  /** 項目1: スタート部屋の大型掲示板 */
  function testP416BigBoard(t, g) {
    var map = g.map, meta = map.meta || {}, T = map.tileSize;
    var bb = meta.bigBoard;
    if (!t.ok(!!bb, 'P4.16 項目1: meta.bigBoard がある')) return;
    t.ok(map.isWalkable(bb.col, bb.row),
      'P4.16 項目1: 掲示板の前に立つマスが歩行可能', bb.col + ',' + bb.row);
    var n = FACE[bb.dir];
    if (!t.ok(!!n, 'P4.16 項目1: dir が n/s/e/w')) return;
    t.ok(map.isSolid(bb.col + n[0], bb.row + n[2]),
      'P4.16 項目1: dir の指す隣マスが実際に壁');

    /* 契約寸法（2.4m x 1.6m 級）と、既存の張り紙より一回り以上大きいこと */
    var BB = ESCAPE.World.BIGBOARD;
    t.near(BB.w, 2.40, 1e-9, 'P4.16 項目1: 紙面の幅は2.40m（契約）', BB.w);
    t.near(BB.h, 1.60, 1e-9, 'P4.16 項目1: 紙面の高さは1.60m（契約）', BB.h);
    t.ok(BB.w * BB.h >= 0.72 * 0.98 * 4,
      'P4.16 項目1: 既存の張り紙（最大0.72x0.98m）の4倍以上の面積',
      (BB.w * BB.h).toFixed(2) + 'm2 vs ' + (0.72 * 0.98).toFixed(2) + 'm2');
    t.ok(BB.stick <= 0.16 + 1e-9,
      'P4.16 項目1: 壁からの突出は0.16m以内（通行を妨げない）', BB.stick + 'm');
    t.ok(BB.cy - BB.h / 2 > 0.6 && BB.cy + BB.h / 2 < map.wallHeight,
      'P4.16 項目1: 板が床と天井の間に収まる',
      (BB.cy - BB.h / 2).toFixed(2) + '〜' + (BB.cy + BB.h / 2).toFixed(2) + 'm');

    /* 板を支える壁が板の幅ぶん続いていること（端が宙に浮かない） */
    var side = (n[0] !== 0) ? 'z' : 'x';
    var need = Math.ceil((BB.w + 0.20 - T) / T / 2);
    var gaps = [];
    for (var k = -need; k <= need; k++) {
      var wc = bb.col + n[0] + ((side === 'z') ? 0 : k);
      var wr = bb.row + n[2] + ((side === 'z') ? k : 0);
      if (!map.isSolid(wc, wr)) gaps.push(wc + ',' + wr);
    }
    t.ok(gaps.length === 0, 'P4.16 項目1: 板の幅ぶん壁が続いている（端が宙に浮かない）',
      gaps.join(' ') || (need * 2 + 1) + 'マスを検査');

    /* スポーンの正面に見えること（距離・視線・視野角） */
    var sp = meta.spawn;
    var sc = map.cellCenter(sp.col, sp.row);
    var bcx = (bb.col + 0.5) * T + n[0] * T * 0.5;
    var bcz = (bb.row + 0.5) * T + n[2] * T * 0.5;
    var dist = Math.hypot(bcx - sc.x, bcz - sc.z);
    t.ok(dist <= 8.5, 'P4.16 項目1: スポーンから8.5m以内（遠目でも絵が読める距離）',
      dist.toFixed(2) + 'm');
    var yaw = (sp.yawDeg || 0) * Math.PI / 180;
    /* カメラは yaw=0 で -Z を向く（game.js の camera.rotation.y）。前方ベクトル */
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var ux = (bcx - sc.x) / Math.max(1e-6, dist), uz = (bcz - sc.z) / Math.max(1e-6, dist);
    var cosA = fx * ux + fz * uz;
    t.ok(cosA > 0.94, 'P4.16 項目1: スポーンの視線の正面（±20度以内）',
      (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI).toFixed(1) + '度');
    if (g.ai && g.ai.blockedLine) {
      t.ok(!g.ai.blockedLine(sc.x, sc.z, bcx - n[0] * 0.2, bcz - n[2] * 0.2),
        'P4.16 項目1: スポーンから掲示板まで視線が通る');
    }
    /* スタート部屋（スポーンの部屋）の中にあること */
    var spRegion = g.world._regionAt(sp.col, sp.row);
    t.ok(g.world._regionAt(bb.col, bb.row) === spRegion,
      'P4.16 項目1: 掲示板はスポーンと同じ部屋にある', spRegion);

    /* 造形が実際にシーンに出ていること（紙面のメッシュ） */
    var tri = 0, found = false;
    g.world.group.traverse(function (o) {
      if (o.isMesh && o.name === 'bigboard') {
        found = true;
        if (o.geometry && o.geometry.index) tri += o.geometry.index.count / 3;
      }
    });
    t.ok(found && tri >= 2, 'P4.16 項目1: 掲示板の紙面がシーンに出ている', tri + '三角形');

    /* 紙面テクスチャ（プロシージャル・外部アセットなし） */
    var TX = ESCAPE.Textures, sz = TX.sizeOf('bigboard');
    t.ok(sz.w >= 1000 && sz.h >= 640,
      'P4.16 項目1: 紙面は1024x683級の解像度', sz.w + 'x' + sz.h);
    var det = TX.detail('bigboard');
    /* 目視合格した紙面（2026-09-10 メイン確認）の実測が 6.9。紙面は「余白のある掲示物」
       なので壁テクスチャほど高周波は乗らない。白紙（≒0）と区別できる下限を採る。 */
    t.ok(det.total > 5.5,
      'P4.16 項目1: 紙面に「遠目で絵と分かる」密度がある（高周波の総量）', det.total.toFixed(1));

    /* 日記のメモ（本文と自動表示はレーンB。ここは配置と造形の整合だけ見る） */
    var nl = meta.notes || [], diary = null;
    for (var i = 0; i < nl.length; i++) if (nl[i].id === 'a1_diary') diary = nl[i];
    if (!t.ok(!!diary, 'P4.16 項目1: 日記のメモ a1_diary が meta.notes にある')) return;
    t.ok(map.tileAt(diary.col, diary.row) === ESCAPE.TILE.NOTE,
      'P4.16 項目1: 日記のマスが NOTE タイル', diary.col + ',' + diary.row);
    var dn = FACE[diary.dir];
    t.ok(!!dn && map.isWalkable(diary.col - dn[0], diary.row - dn[2]),
      'P4.16 項目1: 日記を読む側のマスが歩行可能');
    t.ok(g.world._regionAt(diary.col - dn[0], diary.row - dn[2]) === spRegion,
      'P4.16 項目1: 日記はスタート部屋の内側の壁にある');
  }

  /**
   * P4.17 項目1: 血痕を「たまに見る程度」へ減らし、壁の血痕を赤黒くする。
   * （P4.16 項目2 の数量規定 22〜28か所は失効。ここが唯一の正。）
   * 総数と内訳・区画ごとの上限・スタート部屋ゼロ・壁の血痕の色・引きずりの本数を見る。
   */
  function testP417Blood(t, g) {
    var map = g.map, meta = map.meta || {}, W = g.world;
    var dec = meta.decals || [];
    var KINDS = { blood: 1, bloodHand: 1, bloodDrag: 1, bloodSplat: 1 };
    var nFloor = 0, nWall = 0, nDrag = 0;
    for (var c0 = 0; c0 < dec.length; c0++) {
      var t0 = dec[c0].type || 'blood';
      if (t0 === 'bloodDrag') nDrag++;
      else if (t0 === 'bloodHand' || (t0 === 'bloodSplat' && dec[c0].dir)) nWall++;
      else nFloor++;
    }
    var breakdown = '床' + nFloor + ' 壁' + nWall + ' 引きずり' + nDrag;
    t.ok(dec.length >= 8 && dec.length <= 12,
      'P4.17 項目1: 血痕は合計8〜12か所（契約）', dec.length + 'か所（' + breakdown + '）');
    t.ok(nFloor >= 5 && nFloor <= 7, 'P4.17 項目1: 床の血溜まりは5〜7', nFloor + 'か所');
    t.ok(nWall >= 2 && nWall <= 4, 'P4.17 項目1: 壁の血痕は2〜4', nWall + 'か所');
    t.ok(nDrag >= 1 && nDrag <= 2, 'P4.17 項目1: 引きずり跡は1〜2本', nDrag + '本');

    var byZone = {}, drags = [], pts = [], i, j, d;
    var badType = [], offMap = [], noWall = [];
    for (i = 0; i < dec.length; i++) {
      d = dec[i];
      var ty = d.type || 'blood';
      if (!KINDS[ty]) badType.push(ty);
      var cells = [[d.col, d.row]];
      if (ty === 'bloodDrag') cells.push([d.col2, d.row2]);
      for (j = 0; j < cells.length; j++) {
        if (!map.isWalkable(cells[j][0], cells[j][1])) offMap.push(ty + '@' + cells[j]);
      }
      if (ty === 'bloodHand' || (ty === 'bloodSplat' && d.dir)) {
        var n = d.dir ? FACE[d.dir] : null;
        var ok = n ? map.isSolid(d.col + n[0], d.row + n[2]) : !!W._wallDirOf(d.col, d.row);
        if (!ok) noWall.push(d.col + ',' + d.row);
      }
      if (ty === 'bloodDrag') drags.push(d);
      var z = W._zoneAt(d.col, d.row);
      byZone[z] = (byZone[z] || 0) + 1;
      pts.push({ ty: ty, cells: cells });
    }
    t.ok(badType.length === 0, 'P4.16 項目2: 種類は blood/bloodHand/bloodDrag/bloodSplat のみ',
      badType.join(',') || '4種');
    t.ok(offMap.length === 0, 'P4.16 項目2: 全て歩行可能マスの上', offMap.join(' ') || dec.length + '件');
    t.ok(noWall.length === 0, 'P4.17 項目1: 壁の血痕（擦り・飛沫）は壁に接するマスにある', noWall.join(' ') || '全件');

    var zbad = [];
    var ZS = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (i = 0; i < ZS.length; i++) {
      var n2 = byZone[ZS[i]] || 0;
      if (n2 > 2) zbad.push(ZS[i] + '=' + n2);
    }
    t.ok(zbad.length === 0, 'P4.17 項目1: 区画ごと最大2か所',
      zbad.join(' ') || ZS.map(function (z) { return z + (byZone[z] || 0); }).join(' '));

    /* 同種が4マス以内に並ばない */
    var close = [], worst = 1e9;
    for (i = 0; i < pts.length; i++) {
      for (j = i + 1; j < pts.length; j++) {
        if (pts[i].ty !== pts[j].ty) continue;
        var dmin = 1e9;
        for (var a = 0; a < pts[i].cells.length; a++) {
          for (var b = 0; b < pts[j].cells.length; b++) {
            var dd = Math.hypot(pts[i].cells[a][0] - pts[j].cells[b][0],
              pts[i].cells[a][1] - pts[j].cells[b][1]);
            if (dd < dmin) dmin = dd;
          }
        }
        if (dmin < worst) worst = dmin;
        if (dmin <= 4) close.push(pts[i].ty + ' ' + pts[i].cells[0] + '/' + pts[j].cells[0]);
      }
    }
    t.ok(close.length === 0, 'P4.16 項目2: 同種は4マス以内に並ばない',
      close.slice(0, 4).join(' ') || ('最小 ' + worst.toFixed(2) + 'マス'));

    /* 引きずり跡: 3本まで・2〜4マス・軸に沿う・途中も歩行可能 */
    t.ok(drags.length >= 1 && drags.length <= 2,
      'P4.17 項目1: 引きずり跡は1〜2本（契約）', drags.length + '本');
    var dbad = [];
    for (i = 0; i < drags.length; i++) {
      d = drags[i];
      var dc = (d.col2 > d.col) ? 1 : ((d.col2 < d.col) ? -1 : 0);
      var dr = (d.row2 > d.row) ? 1 : ((d.row2 < d.row) ? -1 : 0);
      if (dc !== 0 && dr !== 0) { dbad.push('斜め' + d.col + ',' + d.row); continue; }
      var len = Math.abs(d.col2 - d.col) + Math.abs(d.row2 - d.row) + 1;
      if (len < 2 || len > 4) dbad.push('長さ' + len);
      for (var s2 = 0; s2 < len; s2++) {
        if (!map.isWalkable(d.col + dc * s2, d.row + dr * s2)) dbad.push('壁' + d.col + ',' + d.row);
      }
    }
    t.ok(dbad.length === 0, 'P4.16 項目2: 引きずり跡は2〜4マスの直線で全て歩行可能',
      dbad.join(' ') || drags.length + '本');

    /* スタート部屋には置かない */
    var sp = meta.spawn, spRegion = W._regionAt(sp.col, sp.row), inStart = [];
    for (i = 0; i < dec.length; i++) {
      d = dec[i];
      if (W._regionAt(d.col, d.row) === spRegion) inStart.push(d.col + ',' + d.row);
      if (d.type === 'bloodDrag' && W._regionAt(d.col2, d.row2) === spRegion) {
        inStart.push(d.col2 + ',' + d.row2);
      }
    }
    t.ok(inStart.length === 0, 'P4.16 項目2: スタート部屋（' + spRegion + '）には血痕を置かない',
      inStart.join(' ') || '0件');

    /* 造形が出ていること。P4.17 項目1: 飛沫は壁貼り（bloodSplatWall）と床貼り
       （bloodSplat）のどちらでもよい＝現在の配置は壁1枚だけなので両方を許す。 */
    var seen = {};
    g.world.group.traverse(function (o) {
      if (o.isMesh && (o.name === 'blood' || o.name === 'bloodHand' ||
        o.name === 'bloodDrag' || o.name === 'bloodSplat' ||
        o.name === 'bloodSplatWall')) seen[o.name] = true;
    });
    t.ok(seen.blood && seen.bloodHand && seen.bloodDrag &&
      (seen.bloodSplat || seen.bloodSplatWall),
      'P4.16 項目2: 4種すべてがシーンに出ている', Object.keys(seen).join(','));

    /* 2026-09-10 差し戻し②の原因（帯の裏表が逆で表面カリングに消えていた）に対する
       同類全検出のアサート（契約 §6）。床のデカールは全三角形が上（+Y）を向くこと。
       P4.17 項目1: 壁に貼る血痕は面が垂直なのでこの検査の対象ではない。集合を分けて
       （壁の擦り bloodHand / 壁の飛沫 bloodSplatWall）対象から外し、検査の意図＝
       「床デカールの面が上を向く」をそのまま保つ。壁側は直後に別途 verticality を見る。 */
    var faceBad = [];
    g.world.group.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.name !== 'blood' && o.name !== 'bloodDrag' && o.name !== 'bloodSplat') return;
      if (o.material && o.material.side !== 0) return;      /* 両面なら向きは問わない */
      var pa = o.geometry.attributes.position, idx = o.geometry.index;
      var n3 = idx ? idx.count : pa.count;
      for (var f = 0; f + 2 < n3; f += 3) {
        var i0 = idx ? idx.getX(f) : f, i1 = idx ? idx.getX(f + 1) : f + 1,
          i2 = idx ? idx.getX(f + 2) : f + 2;
        var ax = pa.getX(i1) - pa.getX(i0), az = pa.getZ(i1) - pa.getZ(i0);
        var bx = pa.getX(i2) - pa.getX(i0), bz = pa.getZ(i2) - pa.getZ(i0);
        var ny = az * bx - ax * bz;                          /* (a×b).y */
        if (ny <= 0) { faceBad.push(o.name + '#' + (f / 3)); break; }
      }
    });
    t.ok(faceBad.length === 0,
      'P4.16 項目2: 床の血痕はすべて上を向く（裏返しで消えない）',
      faceBad.slice(0, 5).join(' ') || '全面 +Y');

    /* P4.17 項目1: 壁の血痕（擦り・飛沫）は逆に「垂直で、部屋の側を向く」こと。
       床の検査から外した分をここで拾う（裏返しなら表面カリングで消えるのは同じ）。 */
    var wallFaceBad = [], wallFaceN = 0;
    g.world.group.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.name !== 'bloodHand' && o.name !== 'bloodSplatWall') return;
      var pa = o.geometry.attributes.position, idx = o.geometry.index;
      var n3 = idx ? idx.count : pa.count;
      for (var f = 0; f + 2 < n3; f += 3) {
        var i0 = idx ? idx.getX(f) : f, i1 = idx ? idx.getX(f + 1) : f + 1,
          i2 = idx ? idx.getX(f + 2) : f + 2;
        var ax = pa.getX(i1) - pa.getX(i0), ay = pa.getY(i1) - pa.getY(i0),
          az = pa.getZ(i1) - pa.getZ(i0);
        var bx = pa.getX(i2) - pa.getX(i0), by = pa.getY(i2) - pa.getY(i0),
          bz = pa.getZ(i2) - pa.getZ(i0);
        var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        wallFaceN++;
        if (Math.abs(ny) / len > 0.02) { wallFaceBad.push(o.name + '#' + (f / 3)); break; }
      }
    });
    t.ok(wallFaceN > 0 && wallFaceBad.length === 0,
      'P4.17 項目1: 壁の血痕の面は垂直（床デカールの検査とは別集合）',
      wallFaceBad.slice(0, 5).join(' ') || (wallFaceN + '面が垂直'));

    /* 色: 乾いた暗赤〜黒に近い赤（テクスチャの平均色相を見る）。
       P4.17 項目1: 壁の血痕（擦り bloodHand・飛沫 bloodSplat）は床の血溜まりと同じ
       赤黒く濃い色にする。見えるのは「テクスチャ × 面の tint」なので、そこを判定する
       （テクスチャだけ暗くして tint で明るく戻す、という抜け道を塞ぐ）。 */
    var TX = ESCAPE.Textures, names = ['blood', 'bloodHand', 'bloodDrag', 'bloodSplat'];
    var hueBad = [], wallBad = [], meanOf = {};
    for (i = 0; i < names.length; i++) {
      var im = TX.get(names[i]).image;
      var cx2 = im.getContext ? im.getContext('2d') : null;
      if (!cx2) continue;
      var dat = cx2.getImageData(0, 0, im.width, im.height).data;
      var sr = 0, sg = 0, sb = 0, na = 0;
      for (var q = 0; q < dat.length; q += 4) {
        if (dat[q + 3] < 40) continue;
        sr += dat[q]; sg += dat[q + 1]; sb += dat[q + 2]; na++;
      }
      if (!na) { hueBad.push(names[i] + ':空'); continue; }
      sr /= na; sg /= na; sb /= na;
      meanOf[names[i]] = sr;
      /* 2026-09-10 差し戻し①②「黒ではなく赤みが残ること」: 赤が主で、かつ明度は低い。 */
      var floorMin = (names[i] === 'blood') ? 20 : 60;
      if (!(sr > sg * 1.6 && sr > sb * 1.6 && sr >= floorMin && sr < 150)) {
        hueBad.push(names[i] + '=' + sr.toFixed(0) + ',' + sg.toFixed(0) + ',' + sb.toFixed(0));
      }
      /* 壁に貼る2種は tint を掛けた見え色で判定: 平均R ≤ 110 かつ R > G + 25 */
      if (names[i] === 'bloodHand' || names[i] === 'bloodSplat') {
        var vr = sr * WALL_BLOOD_TINT[0], vg = sg * WALL_BLOOD_TINT[1];
        if (!(vr <= 110 && vr > vg + 25)) {
          wallBad.push(names[i] + ' R' + vr.toFixed(0) + ' G' + vg.toFixed(0));
        }
      }
    }
    t.ok(hueBad.length === 0, 'P4.17 項目1: 乾いた暗赤（赤が主・黒ではない・明度は低い）',
      hueBad.join(' ') || names.join(','));
    t.ok(wallBad.length === 0,
      'P4.17 項目1: 壁の血痕は赤黒く濃い（tint込みの平均R≤110 かつ R>G+25）',
      wallBad.join(' ') || ('擦りR' + (meanOf.bloodHand * WALL_BLOOD_TINT[0]).toFixed(0) +
        ' 飛沫R' + (meanOf.bloodSplat * WALL_BLOOD_TINT[0]).toFixed(0)));
    /* 壁の血痕の垂れ: 20cm以内・1〜2本（P4.17 項目1。旧・長い垂れは失効） */
    var wm = TX.wallBloodMetrics ? TX.wallBloodMetrics() : null;
    t.ok(!!wm && wm.drips >= 1 && wm.drips <= 2 && wm.dripM <= 0.20 && wm.smearM <= 0.20,
      'P4.17 項目1: 壁の血痕の垂れは1〜2本・20cm以内',
      wm ? (wm.drips + '本 ' + (wm.dripM * 100).toFixed(0) + 'cm（擦り ' +
        (wm.smearM * 100).toFixed(0) + 'cm）') : '未公開');
    /* 実測: 壁の擦りテクスチャに「長い縦の筋」が残っていないこと。
       アルファ40以上の縦の連続長が 0.30m（手形0.19m＋擦り0.07m の実寸上限）を超えたら失格。 */
    var hi2 = TX.get('bloodHand').image, hc2 = hi2.getContext ? hi2.getContext('2d') : null;
    if (hc2) {
      var hd = hc2.getImageData(0, 0, hi2.width, hi2.height).data;
      var ppmH = hi2.width / HANDPANEL.w, maxRun = 0;
      for (var hx = 0; hx < hi2.width; hx += 2) {
        var run = 0;
        for (var hy = 0; hy < hi2.height; hy++) {
          if (hd[(hy * hi2.width + hx) * 4 + 3] >= 40) {
            run++; if (run > maxRun) maxRun = run;
          } else run = 0;
        }
      }
      t.ok(maxRun / ppmH <= 0.30,
        'P4.17 項目1: 壁の擦りに長い縦筋が無い（縦の連続長 ≤ 30cm）',
        (maxRun / ppmH * 100).toFixed(1) + 'cm');
    }

    /* ---- 2026-09-10 差し戻し①: 壁の手形は実物大（手の長さ 0.19m） ---- */
    var himg = TX.get('bloodHand').image;
    t.ok(himg.width === HANDPANEL.texW && himg.height === HANDPANEL.texH,
      'P4.16 項目2: 手形の紙面は ' + HANDPANEL.texW + 'x' + HANDPANEL.texH,
      himg.width + 'x' + himg.height);
    var ppmX = himg.width / HANDPANEL.w, ppmY = himg.height / HANDPANEL.h;
    t.ok(Math.abs(ppmX - ppmY) / ppmX < 0.01,
      'P4.16 項目2: 手形の面は縦横の px/m が一致（歪ませない）',
      ppmX.toFixed(1) + ' / ' + ppmY.toFixed(1) + ' px/m');
    t.ok(HANDPANEL.handLen >= 0.17 && HANDPANEL.handLen <= 0.21,
      'P4.16 項目2: 手形は実物大（手の長さ 0.17〜0.21m）', HANDPANEL.handLen + 'm');
    /* 面に対する手形の占有比 = 実寸 / 面の実寸。ここが崩れると「巨大な手形」になる */
    t.near(HANDPANEL.handLen / HANDPANEL.h, 0.169, 0.02,
      'P4.16 項目2: 手形は面の高さの約17%（実寸比）',
      (HANDPANEL.handLen / HANDPANEL.h).toFixed(3));
    /* 手形の中心高さは床から 1.2〜1.5m（差し戻し①）。テクスチャ上 v=0.32 / 0.43
       （P4.17 で長い指の筋を消した際、手形を少しだけ下げた） */
    var hCy = 1.22, hTop = hCy + HANDPANEL.h / 2, hBad = [];
    [0.32, 0.43].forEach(function (vv) {
      var yy = hTop - vv * HANDPANEL.h;
      if (yy < 1.20 || yy > 1.50) hBad.push(yy.toFixed(2) + 'm');
    });
    t.ok(hBad.length === 0, 'P4.16 項目2: 手形の高さは床から1.2〜1.5m',
      hBad.join(' ') || (hTop - 0.32 * HANDPANEL.h).toFixed(2) + 'm / ' +
      (hTop - 0.43 * HANDPANEL.h).toFixed(2) + 'm');

    /* ---- 2026-09-10 差し戻し②: 引きずり跡は幅30〜45cmの連続した擦り帯 ---- */
    var dimg = TX.get('bloodDrag').image;
    t.ok(DRAGQUAD.band >= 0.30 && DRAGQUAD.band <= 0.45,
      'P4.16 項目2: 引きずり帯の幅は30〜45cm', (DRAGQUAD.band * 100).toFixed(0) + 'cm');
    t.ok(DRAGQUAD.band < DRAGQUAD.w * 0.75,
      'P4.16 項目2: 帯の両脇ににじみの余白がある（面の端で切れない）',
      DRAGQUAD.band + 'm / ' + DRAGQUAD.w + 'm');
    /* 実測: 各行の「目に見える端から端まで」（アルファ24以上）の幅が契約に収まり、
       帯が途切れず、縁が切り立っていないことを見る。 */
    var dc2 = dimg.getContext ? dimg.getContext('2d') : null;
    if (dc2) {
      var dd = dc2.getImageData(0, 0, dimg.width, dimg.height).data;
      var pxPerM = dimg.width / DRAGQUAD.w;
      var VIS = 24;                                  /* 「見える」しきい値 */
      var rows = 0, wSum = 0, wMin = 1e9, wMax = 0, hardEdge = 0, empty = 0;
      for (var ry = 2; ry < dimg.height * 0.86; ry += 4) {
        var lo = -1, hi = -1, mx = 0, xx, av;
        for (xx = 0; xx < dimg.width; xx++) {
          av = dd[(ry * dimg.width + xx) * 4 + 3];
          if (av > mx) mx = av;
          if (av >= VIS) { if (lo < 0) lo = xx; hi = xx; }
        }
        if (mx < VIS) { empty++; continue; }
        var wpx = hi - lo + 1;
        rows++; wSum += wpx;
        if (wpx < wMin) wMin = wpx;
        if (wpx > wMax) wMax = wpx;
        /* 縁の硬さ: 見える端のすぐ内側 3px でアルファが 96 を超えていたら「切り立った縁」 */
        if (dd[(ry * dimg.width + Math.min(dimg.width - 1, lo + 3)) * 4 + 3] > 96) hardEdge++;
        if (dd[(ry * dimg.width + Math.max(0, hi - 3)) * 4 + 3] > 96) hardEdge++;
      }
      var wAvg = (wSum / Math.max(rows, 1)) / pxPerM;
      t.ok(wAvg >= 0.30 && wAvg <= 0.45,
        'P4.16 項目2: 実測の帯幅（見える端から端）の平均が30〜45cm',
        (wAvg * 100).toFixed(1) + 'cm');
      t.ok(empty <= (rows + empty) * 0.06,
        'P4.16 項目2: 帯は連続している（空の行がほぼ無い）', empty + '/' + (rows + empty) + '行');
      t.ok(hardEdge <= rows * 0.20,
        'P4.16 項目2: 縁がにじんで薄れる（切り立った縁がない）',
        hardEdge + ' / ' + (rows * 2) + '辺');
      t.ok((wMax - wMin) / pxPerM > 0.04,
        'P4.16 項目2: 帯の幅が一定でない（絵筆1本に見せない）',
        ((wMax - wMin) / pxPerM * 100).toFixed(1) + 'cm');
    }
    /* 帯の中の濃淡: 帯の内側で明度（アルファ）の分散があること */
    if (dc2) {
      var dd2 = dc2.getImageData(0, 0, dimg.width, dimg.height).data;
      var n3 = 0, s1 = 0, s2v = 0;
      for (var y3 = Math.floor(dimg.height * 0.15); y3 < dimg.height * 0.7; y3 += 3) {
        for (var x3 = Math.floor(dimg.width * 0.42); x3 < dimg.width * 0.58; x3++) {
          var a3 = dd2[(y3 * dimg.width + x3) * 4 + 3];
          n3++; s1 += a3; s2v += a3 * a3;
        }
      }
      var mean3 = s1 / n3, sd3 = Math.sqrt(Math.max(0, s2v / n3 - mean3 * mean3));
      t.ok(sd3 > 14, 'P4.16 項目2: 帯の中に濃淡の筋がある（アルファの標準偏差）',
        sd3.toFixed(1) + ' (平均 ' + mean3.toFixed(0) + ')');
    }
  }

  /**
   * P4.17 項目1: 壁テクスチャの錆だれ（赤い縦筋）を大幅に減らす。
   * ①本数は P4.16 までの1/4以下 ②遠目に赤く読めない（正面視の壁1面＝テクスチャ1枚で
   * R−G>40 の画素が3%未満。実測は1%を大きく下回るので、実質の歯止めとして
   * 「赤茶寄り」の画素（R−G>25）も1.5%未満に抑える）。
   * 錆の点・水の垂れ跡（無彩色）は対象外＝残してよい。
   */
  function testP417WallRust(t, g) {
    var TX = ESCAPE.Textures;
    var RR = TX.rustRunCounts ? TX.rustRunCounts() : null;
    t.ok(!!RR, 'P4.17 項目1: 錆だれの本数が公開されている', RR ? 'あり' : '無し');
    if (!RR) return;
    var now = { wall: RR.wall, wallPaint: RR.wallPaint,
      wallMetal: RR.wallMetalA + RR.wallMetalB, metal: RR.metal };
    var cntBad = [], cntTxt = [];
    ['wall', 'wallPaint', 'wallMetal', 'metal'].forEach(function (k) {
      cntTxt.push(k + ' ' + RR.prev[k] + '→' + now[k]);
      if (now[k] > RR.prev[k] / 4) cntBad.push(k + '=' + now[k] + '/' + RR.prev[k]);
    });
    t.ok(cntBad.length === 0, 'P4.17 項目1: 錆だれの本数は旧値の1/4以下',
      cntBad.join(' ') || cntTxt.join(' '));

    var names = ['wall', 'wall2', 'wall3', 'wallPaint', 'wallMetal'];
    var redBad = [], warmBad = [], txt = [];
    for (var i = 0; i < names.length; i++) {
      var im = TX.get(names[i]).image;
      var cx = im.getContext ? im.getContext('2d') : null;
      if (!cx) continue;
      var d = cx.getImageData(0, 0, im.width, im.height).data;
      var red = 0, warm = 0, tot = 0;
      for (var q = 0; q < d.length; q += 4) {
        var dr = d[q] - d[q + 1];
        tot++;
        if (dr > 40) red++;
        if (dr > 25) warm++;
      }
      var pr = 100 * red / tot, pw = 100 * warm / tot;
      txt.push(names[i] + ' ' + pr.toFixed(2) + '%/' + pw.toFixed(2) + '%');
      if (!(pr < 3)) redBad.push(names[i] + '=' + pr.toFixed(2) + '%');
      if (!(pw < 1.5)) warmBad.push(names[i] + '=' + pw.toFixed(2) + '%');
    }
    t.ok(redBad.length === 0, 'P4.17 項目1: 壁1面の赤み画素（R−G>40）が3%未満',
      redBad.join(' ') || txt.join(' '));
    t.ok(warmBad.length === 0, 'P4.17 項目1: 赤茶寄りの画素（R−G>25）も1.5%未満',
      warmBad.join(' ') || txt.join(' '));
  }

  ESCAPE.__extraSuites.push(testP416BigBoard, testP417Blood, testP417WallRust);

  World.BIGBOARD = BIGBOARD;
  ESCAPE.World = World;
})(window);
