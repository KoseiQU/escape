/* ESCAPE — エリア2「下水道」 案B「格子水路」（DESIGN.md §4「P5 エリア2『下水道』」P5b-A）
 * 79x79マス（1マス=2m → 158m x 158m）。歩行可能 3004 マス / 三叉路以上 1984 / 行き止まり 15
 *
 * 出典: audit/map-mocks-a2/mockB.js（メイン選定「構造の採用: 案B」）。rows の骨格はモックのまま。
 * P5b-A で rows に加えた変更は契約の「載せ替え規則」どおり:
 *   ① 壁マス '#' → 'N'(メモ7枚) / 'L'(ロッカー16基) / 'G'(水門の操作盤1基)  … solid→solid
 *   ② 床マス '.' → 'P'(セーブ端末の立ち位置6) / 'S'(センサー24) / 'B'(倒せる板8) /
 *      'M'(音地盤23＝ガラス片・金属板)                                   … 歩行可→歩行可
 *   （モックが 'P' を壁マスとして置いていた6箇所は '#' に戻し、area1 と同じ
 *     「立つマス＝P・端末は隣の壁」規約で置き直した）
 *   ③ 【契約 追補 2026-09-13】ポンプ室の接続をランプ3本に開通（rows 改変の第4種）。
 *      モックの ramps[1]/[2] は岩盤の中にあり、ポンプ室が入口1本の袋小路だった。
 *        row 54 col 41〜45 を床に（西ランプ 42→45: 0→-2m。col 41 が y=0 の歩廊、col 46 がポンプ室）
 *        row 50 col 59〜63 を床に（東ランプ 59→62: -2→0m。col 63 は y=0 の連絡坑）
 *        ロッカー (63,50) は隣接壁 (63,49) へ移設
 *        ポンプ室の什器 (47,54) を 'F' 化（規則②。西ランプ開通で伸びた直線見通しを 12 に収める）
 *      → ポンプ室は北/西/東の3方向から入れるループの結節点になった（どれか1本を塞いでも
 *        残り2本で到達でき、3本とも塞いだときだけ到達不能＝3入口が互いに独立）。
 * stats.js の再測（P/S/B/M を '.' に戻した等価グリッドで計測）＝全項目合格:
 *   幅高さ 79x79 / 歩行可能 3004 / 水路W 285(9.5%) / 深水V 287マス・18島（対岸が見える18島）
 *   三叉路以上 1984 / 行き止まり 15 / 直線見通し 最大20（12超はランドマーク幹線3本のみ）
 *   spawn→exit 最短 252 / ハンドル経由の必須往復 344（最短x1.365）/ spawn→ハンドル 249
 *   別解成立率 95.6% / 独立サイクル数 1388 / 最大周回路 約240 / ランプ3・台地1（最低床 -2.0m）
 *   段差の継ぎ目 0 / 未到達マス 0 / 区画未被覆 0
 *   区画別マス数 A 274 / B 1267 / C 504 / D 203 / E 441 / F 315
 *   2026-09-13 メイン修正（P5d 監査）: 水門 D が広間の中の1マス壁で脇を素通りできたため、
 *   水門を東の外壁 (77,70) に移し到達パッドを (76,70) へ（エリア1と同じ「扉の前にパッド」規約）。
 *   再測: 歩行可能 2983 / 三叉路 1962 / 行き止まり 15 / 最短 248 / ハンドル往復 346(x1.395) / 別解 95.6% / 未到達 0
 *   （合流槽9枚を region に足したぶん、モックの A293/B1144/C535/D213/E473/F337 から移動している）
 *   ランプ開通前（P5b-A 初版）からの差分: 歩行可能 2995→3004 / 三叉路 1985→1984 /
 *   行き止まり 16→15（(64,50) が通路になった）/ 別解 93.3%→95.6% / サイクル 1389→1388 /
 *   ハンドル往復 398(x1.579)→344(x1.365) / spawn→ハンドル 303→249
 *
 * 区画（regions[].zone・正文 docs/notes.md「エリア2『下水道』」）:
 *   A 流入区画（縦坑と流入口）/ B 幹線区画（格子の幹線水路）/ C 沈殿区画（沈殿槽）/
 *   D 機関区画（ポンプ室 -2m）/ E 旧坑区画（旧坑道）/ F 水門区画（水門と制御室）
 * 見せ場ルーム5: 流入縦坑 / 沈殿槽 / ポンプ室 / 旧坑道の崩落部 / 水門と制御室（＋合流槽9）
 * 仕掛け: 鍵＝水門の操作ハンドル置き場 (15,59)（旧坑区画の奥・role safe）
 *         隔壁＝制御室の操作盤 (67,70)（role bulkhead）。水門 D (71,70) は造形だけで
 *         「調べる」対象ではない（meta.gimmicks に載せない＝area1 の隔壁と違う点）。
 *         到達パッド X (72,70)。
 * 行き止まり15箇所の「来た意味」: 壁メモ2（a2_n1/a2_n5）＋セーブ端末5＋ロッカー8 ＝ 15/15 被覆
 *         （ロッカーは袋小路の隣の壁マス。残る1基のセーブ端末 a2_cp4 はポンプ室の中）。
 *
 * 凡例
 *   #  壁            .  歩廊・坑道       F  岩盤／崩落した煉瓦の山／什器（実体マス）
 *   W  水路（歩行可・足音は水・移動 x0.75・走行不可）   V  深水（渡れない＝solid）
 *   D  水門（施錠・solid）  X  到達パッド   G  仕掛け（ハンドル置き場・操作盤）
 *   N  壁のメモ       L  ロッカー（壁・隠れ場所）   B  倒せる板   M  音地盤（ガラス/金属）
 *   S  センサー       P  セーブ端末の立ち位置（端末そのものは dir の壁）
 *
 * 敵は0体（meta.enemyCount: 0）。罠・音・声は動くが敵は生成されない（契約 P5）。
 * 見た目（素材・灯・小物・水面）は P5b-B / P5c の領分。本ファイルは配置データのみ。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  ESCAPE.Maps.register({
    id: 'area2',
    name: 'エリア2 下水道',
    tileSize: 2.0,
    wallHeight: 3.0,
    legend: {
      '#': 'WALL', '.': 'FLOOR', 'F': 'WALL', 'V': 'DEEP', 'W': 'WATER',
      'D': 'DOOR', 'X': 'EXIT', 'G': 'GIMMICK', 'N': 'NOTE', 'L': 'LOCKER',
      'B': 'BOARD', 'M': 'NOISE', 'S': 'SENSOR', 'P': 'CHECKPOINT'
    },
    rows: [
      '###############################################################################',
      '############.W.######.....###FFF#...##.W.##.......F...........##.W.##.........#',
      '##........##.W.######S###.FF#FFF#.#.##.W.##.###...#.###.#.#.#.##.W.##.#.#.##..#',
      '##......F..M.W.##FFFF.#FF.FF#FFF#...##.W.##.....#.......FM....##.W.##...#.....#',
      '##........##.W.##FFFF.#FF.FF#FFF#.#.##.WW..M#..##.##.##.#.#.#.##.W.##.###.#..##',
      '##......F...WW.##FFFF.LFF..S..#.....##.W.##.......F.......#...##.W.##.FFF.....#',
      '##........##.W.L#FFFF.###.#.#.#.FF####.W.##.#.#.#.#.#.#.###.#....W.##.FFF.###.#',
      '##........##WWW.###.......#.....FF####.W.##.........F...B......#.W.##.........#',
      '##F......F##.W.####.##.##.#B#.#.FF####.W.####..##..##.#.FFFF##.#.W.####.#.#.#.#',
      '##........N#.W.####.......F.....FF###LWW.####...........FFFF##.#.WW####.......#',
      '##.###.L#........##############.####.......##########P########..FFF..###M####.#',
      '##.###N.#...FFF..##############.####..FFF..###################.......###.####L#',
      '#.........F.........VVVVVVVV....FM.........W.....SVVVVVVVV..........F........W#',
      '#WWWWWWWWWF..FF..WWWVVVVVVVVWWWWFWWW...FF..WWWWWWWVVVVVVVVWWWW...FF.FWWWWWWWWW#',
      '#.........F..FF....MVVVVVVVV..F........FF......F..VVVVVVVV..W....FFF...W......#',
      '#.########.......VV#############P###...........###########..##.......VVV#######',
      '#.####P###.......VV#################.......##..###########..##.......VVV#######',
      '#.......###..W.##VVFF.......#FFFF#####.W.VVVN..###########..####.W.#.##.......#',
      '#F##....###..WS##VVFF.#.#.#.#FFFF#####.W.VVV..F.....F.....F..###.W.#.##...#.#.#',
      '#...F........W.##...#.......#.......##WW.###.F......F......F.###SW....F.......#',
      '#...##.......W.##.#.#.FF#.#.#.FFFF#.##.WW###........F........###VVV##.#.FFF.#.#',
      '#S..B..S..##.W.##.....FF#.....FFFF#.##.W.###........F........###VVV##...FFF.#.#',
      '#...###.####VVV##.#.#.FF###.#######....W.###........F........###VVV##.#.###.#.#',
      '#...FF#.FF##VVV##...........FF#M....##.W.###........F........###VVV##.........#',
      '#..FFF#.FF##VVV###FFFF#..##.FF#.#FFF##FFF###........F........###VVV##.#.#####F#',
      '#.......FF##VVV###FFF.....#.FF#.#FFF##.W.############.##L#######VVV##...#FFFF.L',
      '###.FF#F####VVV###FFF.###...FF#.#FFF##.W.############.##########VVV##F#.#FFFF.#',
      '#...FF#...##VVV###FFF.#FF.#.........##.W.##...........F.......##VVV##...#FFFF.#',
      '#...###...##VVV######.#FF.##.######.##SW.##.#S###.###S#.#.#.#.##.W.##.FF#FFFF.#',
      '#...F.....##VVV##FF...#FF.....#FFF#.##.W.##...FFF.FF#...#.....##.W.##.FF#...#.#',
      '#.###..F.....W.##FF.#.#####.#.#FFF#.##.W.####.FFF.FF##.##B######.W.##.FF#.#.#.#',
      '#.#FF........W.##FF.....#FF.#.......##.W.##...FFF.FF#.....#FFF##.W.##.#...#...#',
      '#.#FF.....##.W.####.#.#.#FF.#...######.W....#.FFF.FF#.FF#.#FFF##.W.##.#.FFF##F#',
      '#.#FF.....##.W.####.#...#FF...#.FF####.W.#........F...FF#...####WW......FFF.M.#',
      '#.###...####.WM####.#.FF#FF.#.#.FF####.W.#.##FFF#F#.#.###.#.####.W.####.FFF...#',
      '#.......###L.W.####...FF###.....######.W.#.##FFF#...........####.WW####.......#',
      '##......##...........###############..FFF..######.#.######.###.......###...####',
      '##......##.........#.###N###########.......######.#L######.M....FFF..###...####',
      '#.M.W...F......F....WS....VVVVVVVV...........F...W.....WF..........F..........#',
      '#WWWWWWWFW...FFF.WWWWWWWWWVVVVVVVVWW...FF..WWFWWWWWWWWWWFWWWWW...FFFWWWWWWWWWW#',
      '#......WF....FFF.........WVVVVVVVVS....FF....F.....W....F........FFF.......W..#',
      '####L#####.......###################.......#######.###########.......VVV#####.#',
      '####.#####.......###################.......#######.###########.......VVV#####.#',
      '#.......####.WW#############FF########.W.#########.#############.W.####.......#',
      '#.#####.####.W.VVV##########FF########.W.#########.#############SW.####S#FFFF.#',
      '#.M.#FF...##.W.VVV#########...#FFF####.W.#######N#.#############.W.##...#FFFF.#',
      '#.#.#FF##.##.W.VVV........B.#.#FFF####.W.#####.............#####VVV##...#####.#',
      '#...#FF...B..W.###.......##.......F....W.#####.............#####VVV##.........#',
      '#...#FFMFF##.W.###.......####.#.#.#.##VVV#####....F........#####VVV##........F#',
      '#.#.....FF##.W.....F.....##FF.......##VVV#####.............####LVVV##.........#',
      '#.#FFFF.####VVV###F......##FF.#.FFFF##VVV#####PS....FS..............S..F#FFFF.#',
      '#.#FFFF...##VVV###.......##.....FFFF##VVV#####.............#####VVV##...#FFFF.#',
      '#.#.L##.#.##VVV###.......##.#.#.FFFF##VVV#####F.F.F.F.F.F..L####VVV##...#####.#',
      '#S.....S..##VVV###FFFFFFF#.M#...FFFF##VVV#####.............#####VVV##.........#',
      '#F#.#..##.##VVV###.......#N..F#.###............F..........F#####.W.B........#.#',
      '#...#.....##VVV###.......##.....###L##...#####.............#####.W.##.........#',
      '#.#...#.#.##VVVVVV.......##.#.########.W.#####.............#####.W.########.M.#',
      '#...#.....##VVVVVVF......##...FFFF####.W.#####.............#####.W.####FFFF...#',
      '#.#.#.#.#.##.W.VVV.......##.#.FFFF####WW.#####........F....#####.W.####FFFF..##',
      '#.#.....M.##.W.G##.......##...FFFF####.W.#######################.WF####FFFF...#',
      '#.###.#.####.W.###.......##.#.FFFF####.WW#######################.W.########...#',
      '#.......####.W.....##L#####...########.W.#######################.W.########...#',
      '###.######.......#.#################.......###################.......##########',
      '###.######.......#.#################.......###################.......##########',
      '#.W....W..F.........VVVVVVVVS........F........VVVVVVVV............F...........#',
      '#WWWWWWWWWF..FF..WWWVVVVVVVVWWWWWWWW.F.FF..WWWVVVVVVVVWWWWWWWW...FF.WWWWWWWWWW#',
      '#.S.....S.F..FF.....VVVVVVVV..W...W..FFFF.....VVVVVVVV.W........FFF....M......#',
      '##########....F.....###########.####.......##.P###########...F....F...NF#######',
      '##########..FFS..##.###########.####..........############.###.......F.......##',
      '#.M.#...####.W.VVV#.......F.......####.W.VVV#.......F.......####.W..F..F.....##',
      '#.#.#.#.####.W.VVV#.#####.#.#.#..M####SW.VVV#.#.#.#.#.###.#.####.WFG........XD#',
      '#.........##.W.##...FFFF#.....#...B....W.##...#.......F.......##.W.#.F.......##',
      '#.#FFFF...##.W.##.#.FFFF#.#.FFF##.#.##WW.##.#...#...###M###......W.#.........##',
      '#.#FFFF.#.##.WM##.#.......#.FFF.....##.W.##..M......FF#..........W.#.........##',
      '#.#FFFF.#.##.W.##.#######.#.###.#FF.##.W.##.#.###.#.FF#.###...##.W.#.........##',
      '#.........##.W.##...FF#..M......#FF.##.W.##.........FF#.......##.W.#.........##',
      '#.#.#.#.#....W.##.#.FF#.#...###.###.##.W.##.##.#.##.FF#.#.#...##.WW...F......##',
      '#.........##.W.P#.........F.........##.W.##....F........F........W.#####L######',
      '###############################################################################'
    ],
    meta: {
      spawn: { col: 5, row: 5, yawDeg: 135 },
      /* 速度実測など、平坦で広い直線を要する機械テストの基準点（中央の合流槽） */
      /* P5c 追補2: 中央の合流槽の中心 (39-40,39-40) は集水枡（F）になったので、
         速度計測の基準点は同じ槽の北西の床へ寄せる（南へ 5 マスの直線が取れる） */
      openRoomCenter: { col: 38, row: 38 },

      /* 出口まわり。door は造形だけ（解錠は制御室の操作盤＝meta.gimmicks role bulkhead） */
      door: { col: 77, row: 70, id: 'a2_sluice_gate' },
      exitPad: { col: 76, row: 70 },
      /* 鍵＝水門の操作ハンドル置き場（旧坑区画の奥。スタートから 303 マス） */
      keySafe: { col: 15, row: 59, id: 'a2_valve_handle' },

      /* 敵0体（契約 P5「敵の実装は後回し」）。既定は 2（js/enemy_ai.js ENEMY_TUNING） */
      enemyCount: 0,
      /* 足音の既定素材（js/audio.js floorMaterial）と環境音（下水道） */
      floorDefault: 'stone',
      ambience: 'sewer',

      /* 区画（前方一致で最初に当たったものを採用: 見せ場ルーム → 合流槽 → 幹線 → 帯）。
       * 全歩行可能マスがどれかに入る（未被覆 0）。zone は docs/notes.md「区画名」の A〜F。 */
      regions: [
        { id: "pump", name: "ポンプ室", c0: 46, r0: 46, c1: 58, r1: 58, zone: "D" },
        { id: "inlet_shaft", name: "流入縦坑", c0: 1, r0: 1, c1: 10, r1: 10, zone: "A" },
        { id: "settle_tank", name: "沈殿槽", c0: 43, r0: 17, c1: 61, r1: 25, zone: "C" },
        { id: "old_collapse", name: "旧坑道の崩落部", c0: 17, r0: 45, c1: 25, r1: 61, zone: "E" },
        { id: "sluice_room", name: "水門・制御室", c0: 67, r0: 67, c1: 77, r1: 77, zone: "F" },
        { id: "jn1", name: "北西の合流槽", c0: 10, r0: 10, c1: 16, r1: 16, zone: "B" },
        { id: "jn2", name: "北の合流槽", c0: 36, r0: 10, c1: 42, r1: 16, zone: "B" },
        { id: "jn3", name: "北東の合流槽", c0: 62, r0: 10, c1: 68, r1: 16, zone: "B" },
        { id: "jn4", name: "西の合流槽", c0: 10, r0: 36, c1: 16, r1: 42, zone: "B" },
        { id: "jn5", name: "中央の合流槽", c0: 36, r0: 36, c1: 42, r1: 42, zone: "D" },
        { id: "jn6", name: "東の合流槽", c0: 62, r0: 36, c1: 68, r1: 42, zone: "B" },
        { id: "jn7", name: "南西の合流槽", c0: 10, r0: 62, c1: 16, r1: 68, zone: "B" },
        { id: "jn8", name: "南の合流槽", c0: 36, r0: 62, c1: 42, r1: 68, zone: "B" },
        { id: "jn9", name: "南東の合流槽", c0: 62, r0: 62, c1: 68, r1: 68, zone: "B" },
        { id: "main_h1", name: "北の幹線水路", c0: 0, r0: 12, c1: 78, r1: 14, zone: "B" },
        { id: "main_h2", name: "中央の幹線水路", c0: 0, r0: 38, c1: 78, r1: 40, zone: "B" },
        { id: "main_h3", name: "南の幹線水路", c0: 0, r0: 64, c1: 78, r1: 66, zone: "B" },
        { id: "main_v1", name: "西の幹線水路", c0: 12, r0: 0, c1: 14, r1: 78, zone: "B" },
        { id: "main_v2", name: "中央縦の幹線水路", c0: 38, r0: 0, c1: 40, r1: 78, zone: "B" },
        { id: "main_v3", name: "東の幹線水路", c0: 64, r0: 0, c1: 66, r1: 78, zone: "B" },
        { id: "inlet", name: "流入区画（北西ブロック）", c0: 0, r0: 0, c1: 37, r1: 11, zone: "A" },
        { id: "inlet2", name: "流入区画（西ブロック）", c0: 0, r0: 0, c1: 11, r1: 37, zone: "A" },
        { id: "settle", name: "沈殿区画（北東）", c0: 41, r0: 0, c1: 78, r1: 37, zone: "C" },
        { id: "oldgal", name: "旧坑区画（南西）", c0: 0, r0: 41, c1: 37, r1: 78, zone: "E" },
        { id: "engine", name: "機関区画（中央南東）", c0: 41, r0: 41, c1: 62, r1: 62, zone: "D" },
        { id: "sluice", name: "水門区画（南東）", c0: 41, r0: 41, c1: 78, r1: 78, zone: "F" },
        { id: "main", name: "幹線区画", c0: 0, r0: 0, c1: 78, r1: 78, zone: "B" }
      ],
      /* 「部屋ではない」大きな区画の一覧（id が唯一の意味。js/traps.js の通路マス判定と
       * js/progress.js のセーブ端末の区画解決が読む）。r0/r1 は region と同じ行レンジ。 */
      bands: [
        { zone: "B", id: "main_h1", name: "北の幹線水路", r0: 12, r1: 14 },
        { zone: "B", id: "main_h2", name: "中央の幹線水路", r0: 38, r1: 40 },
        { zone: "B", id: "main_h3", name: "南の幹線水路", r0: 64, r1: 66 },
        { zone: "B", id: "main_v1", name: "西の幹線水路", r0: 0, r1: 78 },
        { zone: "B", id: "main_v2", name: "中央縦の幹線水路", r0: 0, r1: 78 },
        { zone: "B", id: "main_v3", name: "東の幹線水路", r0: 0, r1: 78 },
        { zone: "A", id: "inlet", name: "流入区画（北西ブロック）", r0: 0, r1: 11 },
        { zone: "A", id: "inlet2", name: "流入区画（西ブロック）", r0: 0, r1: 37 },
        { zone: "C", id: "settle", name: "沈殿区画（北東）", r0: 0, r1: 37 },
        { zone: "E", id: "oldgal", name: "旧坑区画（南西）", r0: 41, r1: 78 },
        { zone: "D", id: "engine", name: "機関区画（中央南東）", r0: 41, r1: 62 },
        { zone: "F", id: "sluice", name: "水門区画（南東）", r0: 41, r1: 78 },
        { zone: "B", id: "main", name: "幹線区画", r0: 0, r1: 78 }
      ],
      /* ランドマーク幹線（見通し 13〜20 マスを許した錨） */
      landmarks: [
        { id: "lm_north_main", name: "北の幹線水路", c0: 30, r0: 12, c1: 49, r1: 14 },
        { id: "lm_west_main", name: "西の幹線水路", c0: 12, r0: 30, c1: 14, r1: 49 },
        /* 追補（P5b-A 差し戻し）で開通した東ランプ。ポンプ室の東端から東ランプを上って
           深水の間の細い連絡坑まで 18 マスが一直線に抜ける＝位置の錨になる長い眺め。 */
        /* P5c 追補2: 柱列を撤去してポンプ室が 13x13 の広間になったので、
           ランドマークを「ポンプ室と東連絡坑」へ広げる（本数は3本のまま）。
           契約「中央の機関区画（ポンプ室）＝中央ランドマーク」をそのまま面で表す。 */
        { id: "lm_pump_east", name: "ポンプ室と東連絡坑", c0: 46, r0: 46, c1: 70, r1: 58 }
      ],

      /* 床高さ。ポンプ室は -2.0m の窪地（沈殿槽の歩廊は P5c の plateaus y:0 で足す）。
       * ランプ3本はいずれも全マスが歩行可能で、北(50,42-45)・西(42-45,54)・東(59-62,50)の
       * 3方向からポンプ室へ降りられる（契約 追補「どの幹線もここへ戻ってくる」）。 */
      plateaus: [
        { c0: 46, r0: 46, c1: 58, r1: 58, y: -2.00 }
      ],
      ramps: [
        { c0: 50, r0: 42, c1: 50, r1: 45, axis: 'y', y0: 0.00, y1: -2.00 },
        { c0: 42, r0: 54, c1: 45, r1: 54, axis: 'x', y0: 0.00, y1: -2.00 },
        { c0: 59, r0: 50, c1: 62, r1: 50, axis: 'x', y0: -2.00, y1: 0.00 }
      ],
      /* 天井高: 合流槽 5.0 / 幹線 4.6 / 流入縦坑 6.0 / 沈殿槽・旧坑・制御室 4.3 /
       * ポンプ室 5.2 / 既定（支線＝保守坑道）2.4。前方一致なので並び順が意味を持つ。 */
      ceilings: [
        { c0: 10, r0: 10, c1: 16, r1: 16, h: 5.00 },
        { c0: 36, r0: 10, c1: 42, r1: 16, h: 5.00 },
        { c0: 62, r0: 10, c1: 68, r1: 16, h: 5.00 },
        { c0: 10, r0: 36, c1: 16, r1: 42, h: 5.00 },
        { c0: 36, r0: 36, c1: 42, r1: 42, h: 5.00 },
        { c0: 62, r0: 36, c1: 68, r1: 42, h: 5.00 },
        { c0: 10, r0: 62, c1: 16, r1: 68, h: 5.00 },
        { c0: 36, r0: 62, c1: 42, r1: 68, h: 5.00 },
        { c0: 62, r0: 62, c1: 68, r1: 68, h: 5.00 },
        { c0: 0, r0: 12, c1: 78, r1: 14, h: 4.60 },
        { c0: 0, r0: 38, c1: 78, r1: 40, h: 4.60 },
        { c0: 0, r0: 64, c1: 78, r1: 66, h: 4.60 },
        { c0: 12, r0: 0, c1: 14, r1: 78, h: 4.60 },
        { c0: 38, r0: 0, c1: 40, r1: 78, h: 4.60 },
        { c0: 64, r0: 0, c1: 66, r1: 78, h: 4.60 },
        { c0: 2, r0: 2, c1: 9, r1: 9, h: 6.00 },
        { c0: 44, r0: 18, c1: 60, r1: 24, h: 4.30 },
        { c0: 18, r0: 46, c1: 24, r1: 60, h: 4.30 },
        { c0: 68, r0: 68, c1: 76, r1: 76, h: 4.30 },
        { c0: 46, r0: 46, c1: 58, r1: 58, h: 5.20 },
        { c0: 0, r0: 0, c1: 78, r1: 78, h: 2.40 }
      ],

      /* 闇だまり（契約 §3・5箇所以上）。区画A〜Fに1つずつ */
      darkZones: [
        { id: "dz_A", c0: 18, r0: 2, c1: 32, r1: 8 },
        { id: "dz_B", c0: 20, r0: 38, c1: 34, r1: 40 },
        { id: "dz_C", c0: 44, r0: 28, c1: 58, r1: 34 },
        { id: "dz_D", c0: 46, r0: 50, c1: 58, r1: 57 },
        { id: "dz_E", c0: 2, r0: 66, c1: 12, r1: 74 },
        { id: "dz_F", c0: 68, r0: 44, c1: 76, r1: 52 }
      ],
      /* 漆黒区画（直線・短区間・壁伝いに抜けられる） */
      blackZones: [
        { id: "bz_A", c0: 1, r0: 21, c1: 9, r1: 21 },
        { id: "bz_E", c0: 1, r0: 53, c1: 9, r1: 53 },
        { id: "bz_C", c0: 44, r0: 27, c1: 52, r1: 27 }
      ],
      /* 明滅だけで照らされる通路 */
      flickerZones: [
        { id: "fz_B", c0: 34, r0: 38, c1: 44, r1: 40 },
        { id: "fz_C", c0: 69, r0: 21, c1: 77, r1: 25 },
        { id: "fz_E", c0: 17, r0: 45, c1: 25, r1: 49 }
      ],
      /* 非常灯（闇だまりの中だけ・漆黒区画には置かない） */
      emergency: [
        { col: 22, row: 8 }, { col: 22, row: 38 }, { col: 24, row: 38 }, { col: 34, row: 38 }, { col: 20, row: 40 }, { col: 22, row: 40 },
        { col: 24, row: 40 }, { col: 34, row: 40 }, { col: 54, row: 30 }, { col: 46, row: 50 }, { col: 48, row: 50 }, { col: 50, row: 50 },
        { col: 54, row: 50 }, { col: 56, row: 50 }, { col: 58, row: 50 }, { col: 50, row: 53 }, { col: 58, row: 52 }, { col: 46, row: 54 },
        { col: 48, row: 54 }, { col: 50, row: 54 }, { col: 54, row: 54 }, { col: 56, row: 54 }, { col: 46, row: 56 }, { col: 48, row: 56 },
        { col: 50, row: 56 }, { col: 54, row: 56 }, { col: 56, row: 56 }, { col: 58, row: 56 }, { col: 2, row: 66 }, { col: 4, row: 66 },
        { col: 6, row: 66 }, { col: 8, row: 66 }, { col: 12, row: 66 }, { col: 10, row: 68 }, { col: 12, row: 70 }, { col: 8, row: 72 },
        { col: 12, row: 72 }, { col: 12, row: 74 }, { col: 70, row: 46 }, { col: 70, row: 48 }, { col: 72, row: 48 }, { col: 74, row: 48 },
        { col: 76, row: 48 }, { col: 68, row: 50 }, { col: 70, row: 50 }, { col: 70, row: 52 }
      ],

      /* 仕掛けは2つだけ。① 水門の操作ハンドル置き場 ② 制御室の操作盤 */
      gimmicks: [
        { col: 15, row: 59, dir: 'w', id: 'a2_g_handle', order: 1, role: 'safe', label: '水門の操作ハンドル置き場' },
        { col: 67, row: 70, dir: 'e', id: 'a2_g_bulkhead', order: 2, role: 'bulkhead', label: '水門の操作盤' }
      ],
      /* 壁メモ（本文は docs/notes.md「エリア2『下水道』」の正文）。
       * col,row = 紙を貼る壁マス、dir = 読む側（床）の方角。
       * a2_n1 流入縦坑の袋小路 / a2_n2 中央幹線 / a2_n3 沈殿槽 / a2_n4 ポンプ室の入口 /
       * a2_n5 旧坑の袋小路 / a2_n6 制御室 / a2_diary1 スタート区画の出口の内側（強制メモ1） */
      notes: [
        { col: 6, row: 11, dir: "n", id: "a2_n1" },
        { col: 24, row: 37, dir: "s", id: "a2_n2" },
        { col: 44, row: 17, dir: "s", id: "a2_n3" },
        { col: 48, row: 45, dir: "s", id: "a2_n4" },
        { col: 26, row: 54, dir: "n", id: "a2_n5" },
        { col: 70, row: 67, dir: "s", id: "a2_n6" },
        { col: 10, row: 9, dir: "s", id: "a2_diary1" }
      ],
      /* 区画銘板（「調べる」で地図に区画名が記入される）。各区画の入口付近に1枚ずつ */
      regionSigns: [
        { col: 5, row: 1, dir: "s", id: "rs_A", zone: "A", name: "流入区画" },
        { col: 11, row: 2, dir: "e", id: "rs_B", zone: "B", name: "幹線区画" },
        { col: 43, row: 16, dir: "n", id: "rs_C", zone: "C", name: "沈殿区画" },
        { col: 37, row: 43, dir: "n", id: "rs_D", zone: "D", name: "機関区画" },
        { col: 11, row: 46, dir: "s", id: "rs_E", zone: "E", name: "旧坑区画" },
        { col: 76, row: 41, dir: "e", id: "rs_F", zone: "F", name: "水門区画" }
      ],
      /* 掲示（docs/notes.md「UI文言」の掲示4種の正文。本文は js/progress.js の SIGN_TEXT） */
      signs: [
        { col: 34, row: 37, dir: "s", id: "sg_a2_main" },
        { col: 17, row: 51, dir: "e", id: "sg_a2_old" },
        { col: 49, row: 44, dir: "e", id: "sg_a2_pump" },
        { col: 51, row: 17, dir: "s", id: "sg_a2_settle" }
      ],
      /* セーブ端末（P4.14 と同じ規約: col,row ＝ 端末の前に立つマス、dir ＝ 端末が付いた壁）。
       * 区画A〜Fに1基ずつ。スタートからの経路距離 22 / 125 / 151 / 182 / 213 / 252。
       * 「奥優先」は js/progress.js が経路距離で自動決定する（データに順序は書かない）。 */
      checkpoints: [
        { col: 6, row: 16, dir: "n", id: "a2_cp1" },
        { col: 32, row: 15, dir: "w", id: "a2_cp2" },
        { col: 53, row: 10, dir: "w", id: "a2_cp3" },
        { col: 46, row: 50, dir: "w", id: "a2_cp4" },
        { col: 46, row: 67, dir: "e", id: "a2_cp5" },
        { col: 15, row: 77, dir: "n", id: "a2_cp6" }
      ],
      /* ロッカー（隠れ場所）。16基のうち8基は袋小路の隣の壁＝「来た意味」
         （(63,50) は東ランプの開通で通路になったため隣の壁 (63,49) へ移した） */
      lockers: [
        { col: 15, row: 6 }, { col: 77, row: 11 }, { col: 7, row: 10 }, { col: 78, row: 25 }, { col: 51, row: 37 }, { col: 4, row: 41 },
        { col: 63, row: 49 }, { col: 4, row: 52 }, { col: 35, row: 55 }, { col: 22, row: 5 }, { col: 37, row: 9 }, { col: 56, row: 25 },
        { col: 59, row: 52 }, { col: 21, row: 61 }, { col: 72, row: 77 }, { col: 11, row: 35 }
      ],
      /* 倒せる板（支線の細い通路に8枚） */
      boards: [
        { col: 4, row: 21 }, { col: 27, row: 8 }, { col: 57, row: 30 }, { col: 26, row: 46 },
        { col: 67, row: 54 }, { col: 34, row: 71 }, { col: 10, row: 47 }, { col: 56, row: 7 }
      ],
      /* センサー（暗所多め。闇だまり・漆黒区画に各2基＋幹線の通り抜け口） */
      sensors: [
        { col: 21, row: 2, id: "s_A1" }, { col: 27, row: 5, id: "s_A2" }, { col: 21, row: 38, id: "s_B1" }, { col: 34, row: 40, id: "s_B2" },
        { col: 45, row: 28, id: "s_C1" }, { col: 53, row: 28, id: "s_C2" }, { col: 47, row: 50, id: "s_D1" }, { col: 53, row: 50, id: "s_D2" },
        { col: 2, row: 66, id: "s_E1" }, { col: 8, row: 66, id: "s_E2" }, { col: 71, row: 44, id: "s_F1" }, { col: 68, row: 50, id: "s_F2" },
        { col: 1, row: 21, id: "s_A1" }, { col: 7, row: 21, id: "s_A2" }, { col: 1, row: 53, id: "s_E1" }, { col: 7, row: 53, id: "s_E2" },
        { col: 14, row: 18, id: "s_x1" }, { col: 38, row: 28, id: "s_x2" }, { col: 64, row: 19, id: "s_x3" }, { col: 14, row: 68, id: "s_x4" },
        { col: 38, row: 70, id: "s_x5" }, { col: 64, row: 44, id: "s_x6" }, { col: 28, row: 64, id: "s_x7" }, { col: 49, row: 12, id: "s_x8" }
      ],
      /* 音地盤（TILE.NOISE）。水たまりは水路 W が担うので、ここはガラス片と金属板だけ */
      noise: [
        { col: 11, row: 3, kind: "glass" }, { col: 19, row: 14, kind: "metal" }, { col: 2, row: 38, kind: "glass" },
        { col: 14, row: 34, kind: "metal" }, { col: 7, row: 48, kind: "glass" }, { col: 2, row: 45, kind: "metal" },
        { col: 8, row: 59, kind: "glass" }, { col: 31, row: 23, kind: "metal" }, { col: 27, row: 53, kind: "glass" },
        { col: 33, row: 12, kind: "metal" }, { col: 43, row: 4, kind: "glass" }, { col: 57, row: 3, kind: "metal" },
        { col: 59, row: 37, kind: "glass" }, { col: 72, row: 10, kind: "metal" }, { col: 76, row: 33, kind: "glass" },
        { col: 76, row: 56, kind: "metal" }, { col: 71, row: 66, kind: "glass" }, { col: 55, row: 72, kind: "metal" },
        { col: 45, row: 73, kind: "glass" }, { col: 33, row: 70, kind: "metal" }, { col: 25, row: 75, kind: "glass" },
        { col: 14, row: 73, kind: "metal" }, { col: 2, row: 69, kind: "glass" }
      ],
      /* 音の罠（5種・通路マスの 9.14% ＝ area1 の 9.23% と同程度）。
       * 各合流槽の出入口付近に必ず1つ（先頭9件）。kind/dir/axis の規約は js/traps.js。 */
      traps: [
        { col: 12, row: 9, kind: "can", id: "a2_tr001" }, { col: 40, row: 9, kind: "wire", axis: "z", id: "a2_tr002" },
        { col: 62, row: 9, kind: "can", id: "a2_tr003" }, { col: 12, row: 35, kind: "wire", axis: "z", id: "a2_tr004" },
        { col: 42, row: 35, kind: "can", id: "a2_tr005" }, { col: 64, row: 35, kind: "wire", axis: "z", id: "a2_tr006" },
        { col: 12, row: 61, kind: "can", id: "a2_tr007" }, { col: 38, row: 61, kind: "wire", axis: "z", id: "a2_tr008" },
        { col: 64, row: 61, kind: "can", id: "a2_tr009" }, { col: 30, row: 51, kind: "creak", id: "a2_tr010" },
        { col: 12, row: 74, kind: "can", id: "a2_tr011" }, { col: 26, row: 75, kind: "wire", axis: "z", id: "a2_tr012" },
        { col: 45, row: 12, kind: "creak", id: "a2_tr013" }, { col: 23, row: 23, kind: "can", id: "a2_tr014" },
        { col: 63, row: 6, kind: "creak", id: "a2_tr015" }, { col: 64, row: 57, kind: "creak", id: "a2_tr016" },
        { col: 40, row: 23, kind: "can", id: "a2_tr017" }, { col: 51, row: 69, kind: "wire", axis: "z", id: "a2_tr018" },
        { col: 50, row: 71, kind: "locker", dir: "n", id: "a2_tr019" }, { col: 26, row: 23, kind: "creak", id: "a2_tr020" },
        { col: 72, row: 1, kind: "can", id: "a2_tr021" }, { col: 77, row: 54, kind: "wire", axis: "x", id: "a2_tr022" },
        { col: 23, row: 32, kind: "creak", id: "a2_tr023" }, { col: 24, row: 40, kind: "can", id: "a2_tr024" },
        { col: 66, row: 29, kind: "shelf", dir: "e", id: "a2_tr025" }, { col: 61, row: 74, kind: "creak", id: "a2_tr026" },
        { col: 77, row: 20, kind: "can", id: "a2_tr027" }, { col: 8, row: 47, kind: "wire", axis: "z", id: "a2_tr028" },
        { col: 49, row: 73, kind: "creak", id: "a2_tr029" }, { col: 38, row: 4, kind: "creak", id: "a2_tr030" },
        { col: 11, row: 20, kind: "can", id: "a2_tr031" }, { col: 25, row: 2, kind: "wire", axis: "x", id: "a2_tr032" },
        { col: 39, row: 55, kind: "creak", id: "a2_tr033" }, { col: 5, row: 17, kind: "can", id: "a2_tr034" },
        { col: 32, row: 71, kind: "shelf", dir: "s", id: "a2_tr035" }, { col: 69, row: 55, kind: "creak", id: "a2_tr036" },
        { col: 20, row: 31, kind: "can", id: "a2_tr037" }, { col: 21, row: 25, kind: "wire", axis: "z", id: "a2_tr038" },
        { col: 64, row: 32, kind: "locker", dir: "w", id: "a2_tr039" }, { col: 34, row: 1, kind: "creak", id: "a2_tr040" },
        { col: 19, row: 33, kind: "can", id: "a2_tr041" }, { col: 43, row: 33, kind: "wire", axis: "z", id: "a2_tr042" },
        { col: 1, row: 40, kind: "creak", id: "a2_tr043" }, { col: 48, row: 27, kind: "can", id: "a2_tr044" },
        { col: 53, row: 77, kind: "creak", id: "a2_tr045" }, { col: 46, row: 14, kind: "creak", id: "a2_tr046" },
        { col: 75, row: 5, kind: "can", id: "a2_tr047" }, { col: 69, row: 64, kind: "wire", axis: "z", id: "a2_tr048" },
        { col: 58, row: 16, kind: "locker", dir: "w", id: "a2_tr049" }, { col: 19, row: 72, kind: "creak", id: "a2_tr050" },
        { col: 60, row: 77, kind: "can", id: "a2_tr051" }, { col: 57, row: 2, kind: "wire", axis: "x", id: "a2_tr052" },
        { col: 40, row: 17, kind: "creak", id: "a2_tr053" }, { col: 6, row: 43, kind: "can", id: "a2_tr054" },
        { col: 75, row: 49, kind: "creak", id: "a2_tr055" }, { col: 69, row: 30, kind: "creak", id: "a2_tr056" },
        { col: 71, row: 31, kind: "can", id: "a2_tr057" }, { col: 73, row: 4, kind: "wire", axis: "x", id: "a2_tr058" },
        { col: 29, row: 75, kind: "creak", id: "a2_tr059" }, { col: 72, row: 14, kind: "creak", id: "a2_tr060" },
        { col: 72, row: 18, kind: "can", id: "a2_tr061" }, { col: 46, row: 16, kind: "wire", axis: "z", id: "a2_tr062" },
        { col: 74, row: 7, kind: "creak", id: "a2_tr063" }, { col: 8, row: 57, kind: "can", id: "a2_tr064" },
        { col: 52, row: 9, kind: "creak", id: "a2_tr065" }, { col: 43, row: 72, kind: "creak", id: "a2_tr066" },
        { col: 66, row: 69, kind: "can", id: "a2_tr067" }, { col: 75, row: 33, kind: "wire", axis: "z", id: "a2_tr068" },
        { col: 2, row: 75, kind: "creak", id: "a2_tr069" }, { col: 1, row: 69, kind: "creak", id: "a2_tr070" },
        { col: 40, row: 6, kind: "can", id: "a2_tr071" }, { col: 38, row: 74, kind: "wire", axis: "z", id: "a2_tr072" },
        { col: 71, row: 64, kind: "creak", id: "a2_tr073" }, { col: 12, row: 6, kind: "can", id: "a2_tr074" },
        { col: 7, row: 12, kind: "creak", id: "a2_tr075" }, { col: 64, row: 55, kind: "creak", id: "a2_tr076" },
        { col: 14, row: 75, kind: "can", id: "a2_tr077" }, { col: 3, row: 58, kind: "wire", axis: "x", id: "a2_tr078" },
        { col: 2, row: 25, kind: "locker", dir: "s", id: "a2_tr079" }, { col: 31, row: 75, kind: "creak", id: "a2_tr080" },
        { col: 14, row: 49, kind: "can", id: "a2_tr081" }, { col: 18, row: 67, kind: "wire", axis: "z", id: "a2_tr082" },
        { col: 58, row: 7, kind: "creak", id: "a2_tr083" }, { col: 59, row: 33, kind: "can", id: "a2_tr084" },
        { col: 25, row: 73, kind: "shelf", dir: "e", id: "a2_tr085" }, { col: 51, row: 76, kind: "creak", id: "a2_tr086" },
        { col: 27, row: 32, kind: "can", id: "a2_tr087" }, { col: 32, row: 47, kind: "wire", axis: "z", id: "a2_tr088" },
        { col: 38, row: 33, kind: "locker", dir: "w", id: "a2_tr089" }, { col: 71, row: 48, kind: "creak", id: "a2_tr090" },
        { col: 47, row: 40, kind: "can", id: "a2_tr091" }, { col: 11, row: 31, kind: "wire", axis: "z", id: "a2_tr092" },
        { col: 4, row: 61, kind: "creak", id: "a2_tr093" }, { col: 77, row: 45, kind: "can", id: "a2_tr094" },
        { col: 45, row: 32, kind: "creak", id: "a2_tr095" }, { col: 3, row: 14, kind: "creak", id: "a2_tr096" },
        { col: 53, row: 40, kind: "can", id: "a2_tr097" }, { col: 3, row: 28, kind: "wire", axis: "z", id: "a2_tr098" },
        { col: 5, row: 31, kind: "creak", id: "a2_tr099" }, { col: 17, row: 73, kind: "creak", id: "a2_tr100" },
        { col: 19, row: 8, kind: "can", id: "a2_tr101" }, { col: 14, row: 2, kind: "wire", axis: "z", id: "a2_tr102" },
        { col: 1, row: 33, kind: "creak", id: "a2_tr103" }, { col: 72, row: 23, kind: "can", id: "a2_tr104" },
        { col: 18, row: 64, kind: "creak", id: "a2_tr105" }, { col: 23, row: 73, kind: "creak", id: "a2_tr106" },
        { col: 30, row: 53, kind: "can", id: "a2_tr107" }, { col: 1, row: 50, kind: "wire", axis: "x", id: "a2_tr108" },
        { col: 57, row: 32, kind: "creak", id: "a2_tr109" }, { col: 6, row: 36, kind: "creak", id: "a2_tr110" },
        { col: 53, row: 31, kind: "can", id: "a2_tr111" }, { col: 71, row: 35, kind: "wire", axis: "z", id: "a2_tr112" },
        { col: 32, row: 23, kind: "creak", id: "a2_tr113" }, { col: 40, row: 74, kind: "can", id: "a2_tr114" },
        { col: 1, row: 35, kind: "shelf", dir: "s", id: "a2_tr115" }, { col: 69, row: 27, kind: "creak", id: "a2_tr116" },
        { col: 38, row: 22, kind: "can", id: "a2_tr117" }, { col: 34, row: 19, kind: "wire", axis: "z", id: "a2_tr118" },
        { col: 33, row: 14, kind: "locker", dir: "s", id: "a2_tr119" }, { col: 52, row: 38, kind: "creak", id: "a2_tr120" },
        { col: 6, row: 57, kind: "can", id: "a2_tr121" }, { col: 77, row: 60, kind: "wire", axis: "z", id: "a2_tr122" },
        { col: 66, row: 56, kind: "creak", id: "a2_tr123" }, { col: 1, row: 43, kind: "can", id: "a2_tr124" },
        { col: 17, row: 38, kind: "creak", id: "a2_tr125" }, { col: 71, row: 27, kind: "creak", id: "a2_tr126" },
        { col: 66, row: 7, kind: "can", id: "a2_tr127" }, { col: 5, row: 77, kind: "wire", axis: "z", id: "a2_tr128" },
        { col: 17, row: 71, kind: "locker", dir: "w", id: "a2_tr129" }, { col: 47, row: 38, kind: "creak", id: "a2_tr130" },
        { col: 75, row: 60, kind: "can", id: "a2_tr131" }, { col: 71, row: 7, kind: "wire", axis: "z", id: "a2_tr132" },
        { col: 3, row: 17, kind: "creak", id: "a2_tr133" }, { col: 14, row: 8, kind: "can", id: "a2_tr134" },
        { col: 47, row: 5, kind: "shelf", dir: "n", id: "a2_tr135" }, { col: 49, row: 9, kind: "creak", id: "a2_tr136" },
        { col: 76, row: 57, kind: "can", id: "a2_tr137" }, { col: 7, row: 74, kind: "wire", axis: "x", id: "a2_tr138" },
        { col: 77, row: 10, kind: "creak", id: "a2_tr139" }, { col: 5, row: 40, kind: "creak", id: "a2_tr140" },
        { col: 64, row: 73, kind: "can", id: "a2_tr141" }, { col: 29, row: 27, kind: "wire", axis: "z", id: "a2_tr142" },
        { col: 8, row: 45, kind: "creak", id: "a2_tr143" }, { col: 47, row: 7, kind: "can", id: "a2_tr144" },
        { col: 54, row: 9, kind: "creak", id: "a2_tr145" }, { col: 29, row: 31, kind: "creak", id: "a2_tr146" },
        { col: 66, row: 74, kind: "can", id: "a2_tr147" }, { col: 7, row: 38, kind: "wire", axis: "z", id: "a2_tr148" },
        { col: 25, row: 25, kind: "locker", dir: "n", id: "a2_tr149" }, { col: 64, row: 71, kind: "creak", id: "a2_tr150" },
        { col: 41, row: 4, kind: "can", id: "a2_tr151" }, { col: 44, row: 40, kind: "wire", axis: "z", id: "a2_tr152" },
        { col: 21, row: 29, kind: "creak", id: "a2_tr153" }, { col: 72, row: 55, kind: "can", id: "a2_tr154" },
        { col: 35, row: 27, kind: "shelf", dir: "e", id: "a2_tr155" }, { col: 77, row: 18, kind: "creak", id: "a2_tr156" },
        { col: 3, row: 47, kind: "can", id: "a2_tr157" }, { col: 1, row: 71, kind: "wire", axis: "z", id: "a2_tr158" },
        { col: 1, row: 73, kind: "creak", id: "a2_tr159" }, { col: 9, row: 38, kind: "creak", id: "a2_tr160" },
        { col: 47, row: 3, kind: "can", id: "a2_tr161" }, { col: 31, row: 26, kind: "wire", axis: "x", id: "a2_tr162" },
        { col: 56, row: 27, kind: "creak", id: "a2_tr163" }, { col: 5, row: 38, kind: "can", id: "a2_tr164" },
        { col: 40, row: 21, kind: "shelf", dir: "e", id: "a2_tr165" }, { col: 29, row: 14, kind: "creak", id: "a2_tr166" },
        { col: 69, row: 12, kind: "can", id: "a2_tr167" }, { col: 70, row: 38, kind: "wire", axis: "z", id: "a2_tr168" },
        { col: 77, row: 49, kind: "locker", dir: "e", id: "a2_tr169" }, { col: 54, row: 3, kind: "creak", id: "a2_tr170" },
        { col: 57, row: 69, kind: "can", id: "a2_tr171" }, { col: 35, row: 48, kind: "wire", axis: "x", id: "a2_tr172" },
        { col: 45, row: 68, kind: "creak", id: "a2_tr173" }, { col: 7, row: 59, kind: "can", id: "a2_tr174" },
        { col: 53, row: 34, kind: "creak", id: "a2_tr175" }, { col: 27, row: 19, kind: "creak", id: "a2_tr176" },
        { col: 45, row: 8, kind: "can", id: "a2_tr177" }, { col: 49, row: 7, kind: "wire", axis: "z", id: "a2_tr178" },
        { col: 14, row: 30, kind: "locker", dir: "e", id: "a2_tr179" }, { col: 75, row: 47, kind: "creak", id: "a2_tr180" },
        { col: 44, row: 15, kind: "can", id: "a2_tr181" }, { col: 20, row: 69, kind: "wire", axis: "z", id: "a2_tr182" },
        { col: 9, row: 27, kind: "creak", id: "a2_tr183" }, { col: 46, row: 77, kind: "can", id: "a2_tr184" },
        { col: 74, row: 9, kind: "creak", id: "a2_tr185" }, { col: 35, row: 12, kind: "creak", id: "a2_tr186" },
        { col: 66, row: 2, kind: "can", id: "a2_tr187" }, { col: 45, row: 72, kind: "wire", axis: "z", id: "a2_tr188" },
        { col: 69, row: 6, kind: "creak", id: "a2_tr189" }, { col: 7, row: 25, kind: "creak", id: "a2_tr190" },
        { col: 14, row: 6, kind: "can", id: "a2_tr191" }, { col: 64, row: 75, kind: "wire", axis: "z", id: "a2_tr192" },
        { col: 19, row: 77, kind: "creak", id: "a2_tr193" }
      ],
      /* ロープ（実値は js/rope.js が BFS で再計算する。ここは記録） */
      rope: { shortestTiles: 248, alpha: 0.3, lengthTiles: 322.4, lengthMeters: 644.8,
        keyTiles: 247, keyToExitTiles: 99, farthestTiles: 270 }
    }
  });
})(window);
