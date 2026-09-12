/* ESCAPE — エリア2「下水道」の景観データ（DESIGN.md §4「P5 エリア2『下水道』」＞ P5c）
 *
 * js/maps/area2.js に**登録済みの定義の meta に後から足す**（js/maps/area1_story.js と同じ作法）。
 * rows は一切触らない。構造・配置（P5b-A）と素材・音（P5b-B）はそれぞれの領分のまま。
 *
 * ここで足すのは「見た目」だけ:
 *   zoneStyles   区画A〜Fの床/壁テクスチャ・基調色・灯の色温度・明滅率・消灯率・明るさ
 *   regionTints  部屋・合流槽ごとの色味の上書き（合流槽9つは全て違う色味＝§3⑥）
 *   regionMarks  交差点の壁に塗る色帯（同じ交差点が続く感覚を壊す）
 *   sewerKit     下水道の造形の一括スイッチ（配管・ぬめり・鎖・石灰・崩落・支保工・骨・浮きゴミ）
 *   basins       「槽」（実体マスを掘って水を張る＝覗き込める窪み）
 *   grates       床の格子（下に暗い水）
 *   wallKit/ceilKit/furniture/extraLights/lightOverrides/dripSites
 *   lampKit / doorKit / safeKit / gimmickKit / zoneSignTex  造形の差し替えスイッチ
 *
 * 契約の対応:
 *   A 流入 = 煉瓦・錆・縦坑の梯子・上からの青白い光と滴り
 *   B 幹線 = 暗灰の石ヴォールト・黒緑の水路・遠く離れたナトリウム橙（灯具間隔 8〜12マス）
 *   C 沈殿 = コンクリ槽・緑の水面発光・泡・金属歩廊
 *   D 機関 = ポンプ室 -2m・巨大ポンプ・橙の警告灯・油膜の浸水床
 *   E 旧坑 = 煉瓦崩落・支保工の木材・骨・最も暗い（灯りはほぼ無い）
 *   F 水門 = コンクリ・制御室・鉄の水門・赤い回転灯
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  if (!ESCAPE || !ESCAPE.Maps || !ESCAPE.Maps.has || !ESCAPE.Maps.has('area2')) return;

  /* ============================================================
   * 区画A〜Fの景観（world.js は map.meta.zoneStyles があればこれを使う）
   * ========================================================== */
  var zoneStyles = {
    /* A 流入区画 — 湿った古煉瓦。上の格子から落ちる青白い光だけが頼り */
    A: {
      floor: 'floorBrick', walls: ['wallBrick', 'wallBrick', 'wallStone'], ceil: 'wallBrick',
      tint: { f: [1.02, 0.90, 0.76], w: [0.92, 0.80, 0.66] },
      lamp: { r: 0.76, g: 0.90, b: 1.00 },
      flicker: 0.04, off: -0.14, gain: 2.60, reach: 1.90
    },
    /* B 幹線区画 — 暗灰の切石ヴォールト。ナトリウム橙の灯が遠く離れて並ぶ */
    B: {
      floor: 'floorStoneWet', walls: ['wallStone', 'wallStone', 'wallConcreteWet'], ceil: 'wallStone',
      tint: { f: [0.60, 0.62, 0.58], w: [0.52, 0.56, 0.58] },
      lamp: { r: 1.00, g: 0.64, b: 0.26 },
      flicker: 0.04, off: 0.08, gain: 3.60, reach: 2.30
    },
    /* C 沈殿区画 — 打放しコンクリ。槽の緑の発光が下から壁を舐める */
    C: {
      floor: 'floorStoneWet', walls: ['wallConcreteWet', 'wallConcreteWet', 'wallStone'], ceil: 'wallConcreteWet',
      tint: { f: [0.58, 0.68, 0.62], w: [0.70, 0.80, 0.76] },
      lamp: { r: 0.60, g: 1.00, b: 0.74 },
      flicker: 0.08, off: -0.18, gain: 2.50, reach: 1.80
    },
    /* D 機関区画 — 鋼とコンクリ。油膜の浮いた浸水床に橙の警告灯 */
    D: {
      floor: 'floorStoneWet', walls: ['wallConcreteWet', 'wallStone', 'wallConcreteWet'], ceil: 'wallConcreteWet',
      tint: { f: [0.58, 0.58, 0.56], w: [0.68, 0.68, 0.72] },
      lamp: { r: 1.00, g: 0.54, b: 0.18 },
      flicker: 0.10, off: -0.16, gain: 2.05, reach: 1.55
    },
    /* E 旧坑区画 — 崩れかけた煉瓦と泥。灯りはほぼ点かない（最も暗い） */
    E: {
      floor: 'floorMud', walls: ['wallBrick', 'wallBrick', 'wallBrick'], ceil: 'wallBrick',
      tint: { f: [0.94, 0.82, 0.66], w: [0.90, 0.78, 0.62] },
      lamp: { r: 1.00, g: 0.82, b: 0.56 },
      flicker: 0.06, off: 0.18, gain: 3.60, reach: 1.80
    },
    /* F 水門区画 — 打放しコンクリと鋼。赤い回転灯が回る */
    F: {
      floor: 'floorStoneWet', walls: ['wallConcreteWet', 'wallConcreteWet', 'wallStone'], ceil: 'wallConcreteWet',
      tint: { f: [0.64, 0.63, 0.62], w: [0.76, 0.76, 0.78] },
      lamp: { r: 1.00, g: 0.78, b: 0.54 },
      flicker: 0.05, off: -0.26, gain: 2.60, reach: 1.80
    }
  };

  /* ============================================================
   * 部屋・合流槽の色味（§3⑥「似た見た目の交差点が連続しないよう記号差を強める」）
   *   合流槽9つは**全部違う**色味にする（位置の錨）。
   * ========================================================== */
  var regionTints = {
    /* 見せ場ルーム */
    inlet_shaft:  { f: [1.04, 0.88, 0.70], w: [1.02, 0.86, 0.68] },  /* 縦坑＝煉瓦の赤茶 */
    settle_tank:  { f: [0.62, 0.72, 0.66], w: [0.80, 0.88, 0.82] },  /* 沈殿槽＝病的な緑白 */
    pump:         { f: [0.56, 0.55, 0.54], w: [0.80, 0.78, 0.76] },  /* ポンプ室＝油の灰 */
    old_collapse: { f: [0.88, 0.70, 0.52], w: [0.90, 0.72, 0.52] },  /* 崩落部＝乾いた煉瓦 */
    sluice_room:  { f: [0.64, 0.63, 0.63], w: [0.88, 0.86, 0.86] },  /* 制御室＝白いコンクリ */
    /* 合流槽9つ（時計回りに色相をずらす） */
    jn1: { f: [0.72, 0.60, 0.46], w: [0.96, 0.82, 0.62] },   /* 北西＝琥珀 */
    jn2: { f: [0.64, 0.66, 0.48], w: [0.86, 0.90, 0.64] },   /* 北＝枯草 */
    jn3: { f: [0.50, 0.68, 0.54], w: [0.68, 0.92, 0.72] },   /* 北東＝青緑 */
    jn4: { f: [0.70, 0.54, 0.45], w: [0.94, 0.74, 0.60] },   /* 西＝赤錆 */
    jn5: { f: [0.58, 0.60, 0.70], w: [0.80, 0.82, 0.94] },   /* 中央＝鋼の青 */
    jn6: { f: [0.48, 0.63, 0.71], w: [0.66, 0.86, 0.96] },   /* 東＝冷たい青 */
    jn7: { f: [0.66, 0.50, 0.51], w: [0.90, 0.68, 0.70] },   /* 南西＝血の赤茶 */
    jn8: { f: [0.65, 0.59, 0.71], w: [0.88, 0.80, 0.96] },   /* 南＝藤 */
    jn9: { f: [0.54, 0.57, 0.50], w: [0.74, 0.78, 0.68] },   /* 南東＝苔 */
    /* 幹線6本（縦横で色味を分ける＝どちらの軸に居るか分かる） */
    main_h1: { f: [0.62, 0.60, 0.54], w: [0.74, 0.72, 0.68] },
    main_h2: { f: [0.62, 0.60, 0.54], w: [0.74, 0.72, 0.68] },
    main_h3: { f: [0.62, 0.60, 0.54], w: [0.74, 0.72, 0.68] },
    main_v1: { f: [0.54, 0.60, 0.64], w: [0.66, 0.72, 0.78] },
    main_v2: { f: [0.54, 0.60, 0.64], w: [0.66, 0.72, 0.78] },
    main_v3: { f: [0.54, 0.60, 0.64], w: [0.66, 0.72, 0.78] }
  };

  /* 交差点の壁の色帯（区画・部屋の記号差） */
  var regionMarks = {
    inlet_shaft: [0.92, 0.66, 0.34], settle_tank: [0.36, 0.92, 0.62],
    pump: [0.98, 0.56, 0.14], old_collapse: [0.76, 0.50, 0.28],
    sluice_room: [0.94, 0.24, 0.20],
    jn1: [0.96, 0.74, 0.30], jn2: [0.84, 0.92, 0.34], jn3: [0.34, 0.94, 0.70],
    jn4: [0.94, 0.50, 0.30], jn5: [0.52, 0.62, 0.98], jn6: [0.30, 0.76, 0.98],
    jn7: [0.92, 0.34, 0.38], jn8: [0.74, 0.56, 0.96], jn9: [0.56, 0.78, 0.44],
    main_h1: [0.94, 0.62, 0.22], main_h2: [0.94, 0.62, 0.22], main_h3: [0.94, 0.62, 0.22],
    main_v1: [0.46, 0.74, 0.92], main_v2: [0.46, 0.74, 0.92], main_v3: [0.46, 0.74, 0.92],
    inlet: [0.90, 0.62, 0.36], inlet2: [0.90, 0.62, 0.36],
    settle: [0.40, 0.88, 0.66], oldgal: [0.70, 0.46, 0.26],
    engine: [0.96, 0.54, 0.18], sluice: [0.90, 0.30, 0.26], main: [0.72, 0.74, 0.72]
  };

  /* ============================================================
   * 造形の一括スイッチ（world.js の _sewerKit が読む）
   * ========================================================== */
  var sewerKit = {
    pipes: true, pipeCeil: 4.2,   /* 天井 4.2m 以上の通路＝幹線・合流槽・縦坑・ポンプ室に配管 */
    slime: true,                  /* 水位線のぬめり帯 */
    chains: true,                 /* 鎖・垂れケーブル */
    lime: true,                   /* 石灰の垂れ（つらら状） */
    rubble: true,                 /* 崩落した煉瓦の山（旧坑区画） */
    timbers: true,                /* 支保工の木材（旧坑区画） */
    bones: true,                  /* 骨（旧坑区画の行き止まり） */
    scum: true,                   /* 水面の浮遊ゴミ・油膜 */
    drips: 150                    /* 滴りの粒子数（契約の上限 200 以内） */
  };

  /* 「槽」＝実体マスを掘って水を張る（歩けないまま覗き込める）。
     沈殿槽の中心の隔壁列（col 52 / row 18-24）を沈殿池そのものにする。 */
  var basins = [
    { c0: 52, r0: 18, c1: 52, r1: 24, depth: 0.95, rgb: [0.44, 1.05, 0.62] },  /* 沈殿槽（緑に光る） */
    { c0: 46, r0: 52, c1: 49, r1: 52, depth: 0.70, rgb: [0.34, 0.34, 0.36] }   /* ポンプ室の油溜まり */
  ];

  /* 床の格子（下に暗い水面）。歩ける床マスの上に置く＝薄物なので通行の邪魔にならない */
  var grates = [
    { col: 7, row: 3 }, { col: 4, row: 7 },
    { col: 48, row: 21 }, { col: 56, row: 21 },
    { col: 48, row: 48 }, { col: 56, row: 56 },
    { col: 73, row: 72 }, { col: 74, row: 74 },
    { col: 20, row: 47 }, { col: 22, row: 57 }
  ];

  /* 壁付けの造作（突出はすべて 0.30m 以下） */
  var wallKit = [
    /* 流入縦坑の梯子（上の隔壁から降りてきた梯子） */
    { col: 9, row: 4, dir: 'e', type: 'ladder', h: 6.0 },
    /* 沈殿槽の点検梯子 */
    { col: 60, row: 20, dir: 'e', type: 'ladder', h: 4.3 },
    /* 旧坑の竪坑の梯子（塞がれている） */
    { col: 18, row: 47, dir: 'w', type: 'ladder', h: 4.3 },
    /* ポンプ室の計器（制御室は操作盤そのものが主役なので計器列は置かない） */
    { col: 47, row: 50, dir: 'n', type: 'gaugeRow' },
    { col: 70, row: 74, dir: 'e', type: 'gaugeRow' },
    /* 水門の赤い回転灯2基 */
    { col: 70, row: 69, dir: 'e', type: 'beacon', y: 2.45 },
    { col: 70, row: 71, dir: 'w', type: 'beacon', y: 2.45 }
  ];

  /* 天井付けの造作 */
  var ceilKit = [
    { col: 5, row: 5, type: 'shaftGrate' }     /* 流入縦坑の天端の格子（上からの青白い光） */
  ];

  /* 巨大ポンプ（実体マス＝什器。通路は一切塞がない） */
  var furniture = [
    { col: 52, row: 47, dir: 'w', type: 'sewerPump' },
    { col: 52, row: 49, dir: 'e', type: 'sewerPump' },
    { col: 52, row: 55, dir: 'w', type: 'sewerPump' },
    { col: 52, row: 57, dir: 'e', type: 'sewerPump' },
    { col: 54, row: 52, dir: 'n', type: 'sewerPump' },
    { col: 56, row: 52, dir: 's', type: 'sewerPump' }
  ];

  /* 器具以外の光源（槽の発光・警告灯・縦坑の落光）。明滅比率の母数には数えない */
  var extraLights = [
    /* 流入縦坑: 上から落ちてくる青白い光 */
    { col: 5, row: 5, rgb: [0.70, 0.86, 1.00], y: 4.6, R: 13.0, gain: 1.05 },
    { col: 5, row: 5, rgb: [0.66, 0.82, 1.00], y: 1.2, R: 9.5, gain: 0.62 },
    /* 沈殿槽: 槽そのものが緑に光る */
    { col: 52, row: 19, rgb: [0.36, 1.00, 0.58], y: 0.6, R: 7.5, gain: 0.34 },
    { col: 52, row: 21, rgb: [0.36, 1.00, 0.58], y: 0.6, R: 7.5, gain: 0.34 },
    { col: 52, row: 23, rgb: [0.36, 1.00, 0.58], y: 0.6, R: 7.5, gain: 0.34 },
    /* ポンプ室: 橙の警告灯 */
    { col: 48, row: 50, rgb: [1.00, 0.50, 0.14], y: 2.6, R: 9.0, gain: 0.58 },
    { col: 56, row: 54, rgb: [1.00, 0.50, 0.14], y: 2.6, R: 9.0, gain: 0.58 },
    { col: 50, row: 56, rgb: [1.00, 0.52, 0.16], y: 2.6, R: 9.0, gain: 0.52 },
    { col: 54, row: 48, rgb: [1.00, 0.52, 0.16], y: 2.6, R: 9.0, gain: 0.52 },
    { col: 52, row: 52, rgb: [1.00, 0.54, 0.18], y: 3.2, R: 10.0, gain: 0.44 },
    /* 水門: 赤い回転灯の照り返し */
    { col: 70, row: 69, rgb: [1.00, 0.16, 0.10], y: 2.45, R: 8.5, gain: 0.40 },
    { col: 70, row: 71, rgb: [1.00, 0.16, 0.10], y: 2.45, R: 8.5, gain: 0.40 },
    { col: 70, row: 70, rgb: [1.00, 0.84, 0.62], y: 2.2, R: 7.0, gain: 0.22 },
    /* 制御室の盤の灯り */
    { col: 68, row: 70, rgb: [1.00, 0.72, 0.40], y: 1.6, R: 5.5, gain: 0.26 },
    /* 旧坑のハンドル置き場（唯一の手掛かりなので僅かに照らす） */
    { col: 14, row: 59, rgb: [1.00, 0.88, 0.68], y: 1.8, R: 5.0, gain: 0.24 }
  ];

  /* 合流槽9つは「位置の錨」＝必ず灯りが点いている（消灯帯に埋もれさせない）。
     各槽の4隅の器具のうち2つを点灯に固定し、残りは帯ノイズに任せる。 */
  var jnLights = (function () {
    var out = [], base = [[10, 10], [36, 10], [62, 10], [10, 36], [36, 36], [62, 36],
      [10, 62], [36, 62], [62, 62]];
    for (var i = 0; i < base.length; i++) {
      var c0 = base[i][0], r0 = base[i][1];
      /* 器具は (c%3===1 && r%3===1) に立つ。槽 7x7 の中の該当2x2から対角2つを採る */
      var cs = [], rs = [];
      for (var c = c0; c <= c0 + 6; c++) if (c % 3 === 1) cs.push(c);
      for (var r = r0; r <= r0 + 6; r++) if (r % 3 === 1) rs.push(r);
      if (!cs.length || !rs.length) continue;
      out.push({ col: cs[0], row: rs[0], state: 'on', gain: 1.25, reach: 1.15 });
      out.push({ col: cs[cs.length - 1], row: rs[rs.length - 1], state: 'on', gain: 1.10 });
      if (cs.length > 1) out.push({ col: cs[cs.length - 1], row: rs[0], state: 'flicker' });
    }
    return out;
  })();

  /* 器具の作為的な上書き（見せ場だけ点け、暗区間は消す） */
  var lightOverrides = [
    { col: 4, row: 4, state: 'on', gain: 1.10 },
    { col: 7, row: 7, state: 'on', gain: 0.95 },
    { col: 52, row: 20, state: 'on', gain: 1.10 },
    { col: 46, row: 22, state: 'flicker' },
    { col: 58, row: 19, state: 'flicker' },
    { col: 49, row: 47, state: 'on', gain: 1.25 },
    { col: 55, row: 57, state: 'on', gain: 1.10 },
    { col: 70, row: 73, state: 'on', gain: 1.15 },
    { col: 73, row: 69, state: 'on', gain: 1.05 },
    { col: 22, row: 46, state: 'flicker' },
    { col: 19, row: 59, state: 'off' },
    { col: 22, row: 59, state: 'off' },
    /* 旧坑の崩落部だけは見せ場として1灯だけ残す（区画Eの「灯りはほぼ無い」の例外） */
    { col: 22, row: 49, state: 'on', gain: 1.25, reach: 1.20 },
    { col: 19, row: 55, state: 'flicker' },
    /* 流入縦坑・沈殿槽・ポンプ室・制御室の見せ場を確実に点ける */
    { col: 55, row: 22, state: 'on', gain: 1.25, reach: 1.2 },
    { col: 49, row: 19, state: 'on', gain: 1.20, reach: 1.2 },
    { col: 49, row: 22, state: 'on', gain: 1.15 },
    { col: 49, row: 55, state: 'on', gain: 1.15 },
    { col: 55, row: 49, state: 'on', gain: 1.10 },
    { col: 73, row: 73, state: 'on', gain: 1.10 },
    /* 深水の両岸を点ける＝「向こう岸が見えているのに行けない」が成立する */
    { col: 49, row: 13, state: 'on', gain: 1.35, reach: 1.25 },
    { col: 58, row: 13, state: 'on', gain: 1.35, reach: 1.25 },
    { col: 49, row: 16, state: 'on', gain: 1.10 },
    { col: 58, row: 10, state: 'on', gain: 1.10 }
  ].concat(jnLights);

  /* 手置きの滴り（見せ場に落ちる雫。配管からの滴りは _sewerKit が自動で足す） */
  var dripSites = [
    { col: 5, row: 5, x: 11.0, z: 11.0, y: 5.6 },
    { col: 4, row: 6, x: 9.2, z: 13.2, y: 5.6 },
    { col: 6, row: 4, x: 13.2, z: 9.2, y: 5.6 },
    { col: 48, row: 21, x: 97.0, z: 43.0, y: 3.9 },
    { col: 56, row: 22, x: 113.0, z: 45.0, y: 3.9 },
    { col: 20, row: 50, x: 41.0, z: 101.0, y: 3.9 },
    { col: 22, row: 56, x: 45.0, z: 113.0, y: 3.9 },
    { col: 70, row: 72, x: 141.0, z: 145.0, y: 3.9 }
  ];

  /** 登録済みの def の meta に足す（二重実行しても増えない） */
  function attach() {
    var def = ESCAPE.Maps.load('area2').def;   /* load() の GridMap は捨て、def を掴む */
    if (!def || !def.meta || def.meta.__p5cLook) return;
    var m = def.meta;
    m.ambientScale = 3.5;              /* 環境光の底上げ（灯具が遠い下水道で「何も見えない」を防ぐ） */
    m.litterTint = [0.19, 0.17, 0.14]; /* 散乱物は白い書類でなく黒ずんだ泥・木片 */
    m.wallSigns = false;           /* 研究区画の標識（除染注意など）は下水道に出さない */
    m.zoneStyles = zoneStyles;
    m.regionTints = regionTints;
    m.regionMarks = regionMarks;
    m.sewerKit = sewerKit;
    m.basins = basins;
    m.grates = grates;
    m.wallKit = (m.wallKit || []).concat(wallKit);
    m.ceilKit = (m.ceilKit || []).concat(ceilKit);
    m.furniture = (m.furniture || []).concat(furniture);
    m.extraLights = (m.extraLights || []).concat(extraLights);
    m.lightOverrides = (m.lightOverrides || []).concat(lightOverrides);
    m.dripSites = (m.dripSites || []).concat(dripSites);
    /* 造形の差し替え（world.js のスイッチ） */
    m.lampKit = 'sewer';          /* ケージ付きの下水道灯 */
    m.doorKit = 'sluice';         /* 鉄の昇降水門（doorOpen で3秒かけて上がる） */
    m.safeKit = 'handleRack';     /* 金庫でなく壁の掛け具に掛かった鉄のハンドル */
    m.gimmickKit = 'controlPanel';/* 制御室の壁面パネル（軸穴・計器・ランプ） */
    m.zoneSignTex = 'zonesignA2'; /* 銘板は正文の area2 名（A 流入区画 …） */
    m.__p5cLook = true;
  }

  attach();
  ESCAPE.AREA2_LOOK_ATTACH = attach;
})(window);
