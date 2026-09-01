/* ESCAPE — エリア1「研究区画」（DESIGN.md §3・2026-08-30 第2改訂＋第3次改修に対応）
 * 55x55マス（1マス=2m → 110m x 110m）。歩行可能 906 マス
 *
 * 第3次改修（研究所らしさ／牢の中央移設）:
 *   ① 見せ場ルーム6室 — 検体タンク室(20-28,20-24) / 処置室(16-24,4-8) /
 *      培養器室(4-12,4-8) / 檻室(4-8,12-20) / 観察室(40-48,40-44) / 記録室(44-48,4-12)
 *   ② 拘束室（牢）をマップ端(46-48,4-8)から中央 cols 27-33 / rows 26-29 へ移設。
 *      ブロック中心 (30, 27.5) ＝ 中心(27.5,27.5) から幅・高さの ±20%（16.5〜38.5）以内。
 *      房は4室（1x2の深房2＋1x1の房2、CELLタイル計6）。前室の通路は row28 cols26-34。
 *
 * 凡例
 *   #  壁            .  床
 *   F  壁扱いの什器（描画は meta.furniture の小道具に差し替わる）
 *   D  次エリアへの隔壁（施錠・solid）   X  隔壁前の到達判定マス
 *   G  仕掛け端末（壁）  N  壁のメモ    L  ロッカー（壁・隠れ場所）
 *   B  倒せる板        W  音地盤（水たまり・ガラス片）
 *   S  センサー        P  チェックポイント   C  拘束室（牢）
 *
 * 行き止まりは全てに「来た意味」がある（新設ぶん）:
 *   (28,26)(32,26)(28,29)(32,29) 牢の房 / (26,27) 壁のメモ a1_n3
 *   (30,30) ロッカー(29,30)
 *
 * 挙動（仕掛け・メモ表示・板倒し・隠れ・敵）は P3/P4 の領分。本ファイルは配置データのみ。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  ESCAPE.Maps.register({
    id: 'area1',
    name: 'エリア1 研究区画',
    tileSize: 2.0,
    wallHeight: 3.0,
    legend: {
      '#': 'WALL', '.': 'FLOOR', 'F': 'WALL',
      'D': 'DOOR', 'X': 'EXIT', 'G': 'GIMMICK', 'N': 'NOTE', 'L': 'LOCKER',
      'B': 'BOARD', 'W': 'NOISE', 'S': 'SENSOR', 'P': 'CHECKPOINT', 'C': 'CELL'
    },
    rows: [
      '#######################################################',
      '##################################D#######F############',
      '##############################....X....###.############',
      '##############################.####.##.###.############',
      '####.........###.........#####.####.##.###.#.....######',
      '####.F.F.F.F.###.F.....F.#####.####N##.###.....F.######',
      '####...........#....F....L.....###.........#.....######',
      '####.F.F.F...#.#.F....F..#####.###.#######.#...F.######',
      '####.........#...........#####.###.#######.#.....######',
      '##########.###.########.######.###.#######.......######',
      '##########.........###.........###P........#.....######',
      '##############.#N#...F.###.###########.#####.F.F.######',
      '####.....#####.#.#.###.###.###########.#####.....######',
      '####..F..#####.#.#.#W..###.###########.#########.######',
      '####F....#.........###S###.............###.........####',
      '####..F.F#.#######.###.###.###########.###.#######.####',
      '####.....G.#######.###.###.###########.###.#######.####',
      '##N#..F....#######.###.###.###########.###.#######.####',
      '##.#F....#.###....B....###.........###.........###.####',
      '##.#..F.F#.###.##.############.###.#####L#.###...N.####',
      '##.......#.###.##.##.........#.###.#####.#.###.###.####',
      '##.#####.#.###.##L##.F.F.F.F...###.#####.#.###.###.####',
      '##.......WW###.....#.........#.###.###.....#W......####',
      '##.###########.#.#...F.F.F.F.#.###.###.#######.########',
      '##.###########.#W#.#.........#.###.###.#######.########',
      '##.###########.###.###.#######.###.###.#######.########',
      '##.........F##.........#####C#.#C#B###.....###WW...####',
      '##.###.###############...N.#C#.#C#.###.###.#######.####',
      '##.###.###############.###P........###.###.#######.####',
      '##L###.###############.F...#C###C#.###.###.#######.####',
      '######.................###WL#L.###.###.###.........####',
      '######.#################W..###.###.###F###.###.###...F#',
      '######.#####.....#########.###.###.#######.###...F.####',
      '######.#####.F.F.#########.###.###.#######.###.###.####',
      '#F....W....#.....GW........###.###....W....###.....####',
      '##########.#.......###.#######.#######.#######.########',
      '##########.#.....#.###.#######.#######.#######.########',
      '##########.####.##.###.#######.#######.#######.########',
      '##########.###.....###.....###.........##F.........####',
      '##########.###.###.##F####.#######.###.######.####.####',
      '##########.###.###.##.####.#######.###.#.........#.####',
      '##########.###.###.##.####.#######.###...F.F.F.F.#.####',
      '#####F........B###.........##N.........#.........#.####',
      '########.#####.#######.###.#############.......F...####',
      '###F.....###W..#######...F.#############.........#.####',
      '####F....#####.#######.###.#################G#####.####',
      '####....F#P....###.....###................S###.....####',
      '####.......#######.###.###################.###.########',
      '####.....#.#######...F.###################.###.########',
      '##########.#######.###.###################.###.########',
      '##########.........###.##############F.........########',
      '######################L##################.#############',
      '#########################################.#############',
      '#########################################F#############',
      '#######################################################'
    ],
    meta: {
      spawn: { col: 6, row: 46, yawDeg: 0 },
      /* 速度実測など、平坦で広い直線を要する機械テストの基準点（機械室の中央通路） */
      openRoomCenter: { col: 24, row: 22 },

      /* --- 敵（P3b） ---
       * enemySpawn: 巡回の起点。拘束室(中央 27-33/26-29)から十分離した北西の連絡路。
       * patrol: メモ・仕掛け・見せ場ルームを結ぶ巡回路（順に巡ってループする）。
       *         板(18,18)(34,26)は巡回路上に置いてあり、倒せば足止めが効く。 */
      enemySpawn: { col: 16, row: 12, yawDeg: 180 },
      patrol: [
        { col: 16, row: 12 },   /* メモ a1_n2 の前 */
        { col: 10, row: 16 },   /* 仕掛け a1_g1（配電盤）の前 */
        { col: 18, row: 18 },   /* 板のある通路 */
        { col: 24, row: 22 },   /* 検体タンク室 */
        { col: 18, row: 30 },   /* 中央長廊下 */
        { col: 34, row: 26 },   /* 板のある縦長廊下（拘束室の東） */
        { col: 34, row: 19 },   /* 縦長廊下の北端 */
        { col: 34, row: 10 }    /* チェックポイント a1_cp3 */
      ],
      /* 牢送りで放り込まれる房。破られた房＝ここから前室へ出る動線 */
      jailCell: { col: 32, row: 29 },

      /* 床高さ（1マス=2m）。ramps は軸方向に線形補間、plateaus は一定。
       * 端のノードマスは必ず平坦にしてあり、直交分岐との段差はゼロ。
       * 落下・跳躍は無し＝プレイヤーYは floorYAt() に追従するだけ。 */
      plateaus: [
        { c0: 12, r0: 30, c1: 16, r1: 30, y: 2.00 },
        { c0: 31, r0: 14, c1: 33, r1: 14, y: 1.40 },
        { c0: 10, r0: 38, c1: 10, r1: 38, y: -1.80 }
      ],
      ramps: [
        { c0: 7, r0: 30, c1: 11, r1: 30, axis: 'x', y0: 0.00, y1: 2.00 },
        { c0: 17, r0: 30, c1: 21, r1: 30, axis: 'x', y0: 2.00, y1: 0.00 },
        { c0: 27, r0: 14, c1: 30, r1: 14, axis: 'x', y0: 0.00, y1: 1.40 },
        { c0: 34, r0: 14, c1: 37, r1: 14, axis: 'x', y0: 1.40, y1: 0.00 },
        { c0: 10, r0: 35, c1: 10, r1: 37, axis: 'z', y0: 0.00, y1: -1.80 },
        { c0: 10, r0: 39, c1: 10, r1: 41, axis: 'z', y0: -1.80, y1: 0.00 }
      ],
      /* 天井高（床からの高さ）。既定は wallHeight=3.0。断面変化をつける */
      ceilings: [
        { c0: 34, r0: 18, c1: 34, r1: 34, h: 4.30 },
        { c0: 20, r0: 20, c1: 28, r1: 24, h: 4.30 },
        { c0: 4, r0: 44, c1: 8, r1: 48, h: 3.60 },
        { c0: 2, r0: 26, c1: 10, r1: 30, h: 2.40 },
        { c0: 38, r0: 18, c1: 46, r1: 22, h: 2.40 },
        { c0: 18, r0: 38, c1: 28, r1: 42, h: 2.45 },
        /* 拘束室は低く抑えて圧迫感を出す（鉄格子の高さ 2.55m より上に取る） */
        { c0: 27, r0: 26, c1: 33, r1: 29, h: 2.80 }
      ],

      /* 区画。前方一致で最初に当たったものを採用（部屋 → 長廊下 → 通路ゾーン） */
      regions: [
        { id: 'labA', name: '培養器室', c0: 4, r0: 4, c1: 12, r1: 8 },
        { id: 'labB', name: '第二処置室', c0: 16, r0: 4, c1: 24, r1: 8 },
        { id: 'office', name: '記録室', c0: 44, r0: 4, c1: 48, r1: 12 },
        { id: 'cellroom', name: '拘束室', c0: 27, r0: 26, c1: 33, r1: 29 },
        { id: 'specimen', name: '飼育檻室', c0: 4, r0: 12, c1: 8, r1: 20 },
        { id: 'machine', name: '検体タンク室', c0: 20, r0: 20, c1: 28, r1: 24 },
        { id: 'pump', name: '循環ポンプ室', c0: 12, r0: 32, c1: 16, r1: 36 },
        { id: 'control', name: '観察モニター室', c0: 40, r0: 40, c1: 48, r1: 44 },
        { id: 'hall', name: '受入ホール', c0: 4, r0: 44, c1: 8, r1: 48 },
        { id: 'lmA', name: '中央長廊下', c0: 6, r0: 30, c1: 22, r1: 30 },
        { id: 'lmB', name: 'north縦廊下', c0: 34, r0: 18, c1: 34, r1: 34 },
        { id: 'lmC', name: '南長廊下', c0: 26, r0: 46, c1: 42, r1: 46 },
        { id: 'rcA', name: '沈下通路', c0: 10, r0: 34, c1: 10, r1: 42 },
        { id: 'rcB', name: '登り通路', c0: 26, r0: 14, c1: 38, r1: 14 },
        { id: 'corrN', name: '北回廊', c0: 0, r0: 0, c1: 54, r1: 13 },
        { id: 'corrW', name: '西通路', c0: 0, r0: 14, c1: 19, r1: 37 },
        { id: 'corrC', name: '中央連絡路', c0: 20, r0: 14, c1: 37, r1: 37 },
        { id: 'corrE', name: '東通路', c0: 38, r0: 14, c1: 54, r1: 37 },
        { id: 'corrS', name: '南下層通路', c0: 0, r0: 38, c1: 54, r1: 54 }
      ],

      /* 「闇だまり」: 器具を連続消灯させる区画（契約 §3・5箇所以上）。非常灯の赤い微光だけ残る */
      darkZones: [
        { id: 'dz_specimen', c0: 3, r0: 11, c1: 10, r1: 21 },
        { id: 'dz_west', c0: 1, r0: 24, c1: 9, r1: 31 },
        /* 拘束室（中央）は明滅する1灯と非常灯だけ。房の中は闇に沈む */
        { id: 'dz_cell', c0: 26, r0: 25, c1: 33, r1: 30 },
        { id: 'dz_east', c0: 38, r0: 24, c1: 50, r1: 34 },
        { id: 'dz_pump', c0: 11, r0: 31, c1: 19, r1: 38 },
        { id: 'dz_south', c0: 18, r0: 43, c1: 26, r1: 52 }
      ],
      /* 「漆黒区画」: 非常灯すら無い直線の短区間。壁伝いに抜ける（多用禁止・3箇所） */
      blackZones: [
        { id: 'bz_west', c0: 2, r0: 22, c1: 10, r1: 22 },
        { id: 'bz_south', c0: 31, r0: 42, c1: 38, r1: 42 },
        { id: 'bz_deep', c0: 10, r0: 50, c1: 18, r1: 50 }
      ],
      /* 「明滅だけで照らされる通路」: 中の器具は全て flicker になる */
      flickerZones: [
        { id: 'fz_lmC', c0: 26, r0: 45, c1: 42, r1: 47 },
        { id: 'fz_east', c0: 44, r0: 24, c1: 50, r1: 32 }
      ],
      /* 闇だまりでも方向を見失わないための非常灯（微光・赤）。漆黒区画には置かない */
      emergency: [
        { col: 6, row: 16 }, { col: 6, row: 20 }, { col: 4, row: 12 }, { col: 2, row: 26 }, { col: 6, row: 30 },
        { col: 2, row: 30 }, { col: 46, row: 6 }, { col: 44, row: 10 }, { col: 48, row: 12 }, { col: 44, row: 26 },
        { col: 40, row: 30 }, { col: 48, row: 30 }, { col: 14, row: 34 }, { col: 12, row: 32 }, { col: 18, row: 36 },
        { col: 22, row: 46 }, { col: 20, row: 50 }, { col: 24, row: 44 }, { col: 34, row: 22 }, { col: 34, row: 30 },
        /* 拘束室（中央）の前室。房の奥までは届かない微光 */
        { col: 27, row: 28 }, { col: 33, row: 28 }, { col: 30, row: 30 }
      ],

      gimmicks: [
        { col: 9, row: 16, id: 'a1_g1', order: 1, label: '配電盤' },
        { col: 17, row: 34, id: 'a1_g2', order: 2, label: '循環ポンプ' },
        { col: 44, row: 45, id: 'a1_g3', order: 3, label: '隔壁制御卓' }
      ],
      notes: [
        { col: 2, row: 17, id: 'a1_n1' },
        { col: 16, row: 11, id: 'a1_n2' },
        { col: 25, row: 27, id: 'a1_n3' },
        { col: 35, row: 5, id: 'a1_n4' },
        { col: 29, row: 42, id: 'a1_n5' },
        { col: 49, row: 19, id: 'a1_n6' }
      ],
      lockers: [ { col: 2, row: 29 }, { col: 17, row: 21 }, { col: 25, row: 6 }, { col: 40, row: 19 }, { col: 22, row: 51 },
        { col: 27, row: 30 }, { col: 29, row: 30 } ],
      /* 板は「追われた時に通る主要ループ上」に置く */
      boards: [ { col: 18, row: 18 }, { col: 34, row: 26 }, { col: 14, row: 42 } ],
      sensors: [ { col: 22, row: 14 }, { col: 42, row: 46 } ],
      checkpoints: [
        { col: 10, row: 46, id: 'a1_cp1' },
        { col: 26, row: 28, id: 'a1_cp2' },
        { col: 34, row: 10, id: 'a1_cp3' }
      ],
      noise: [
        { col: 16, row: 24, kind: 'glass' }, { col: 20, row: 13, kind: 'glass' }, { col: 24, row: 31, kind: 'water' },
        { col: 12, row: 44, kind: 'water' }, { col: 44, row: 22, kind: 'glass' }, { col: 10, row: 22, kind: 'water' },
        { col: 9, row: 22, kind: 'water' }, { col: 26, row: 30, kind: 'water' },
        { col: 46, row: 26, kind: 'glass' }, { col: 47, row: 26, kind: 'glass' }, { col: 18, row: 34, kind: 'water' },
        { col: 38, row: 34, kind: 'glass' }, { col: 6, row: 34, kind: 'water' }
      ],
      /* 拘束室（牢）＝マップ中央。房4室（1x2 の深房2＋1x1 の房2） */
      cells: [
        { col: 28, row: 26 }, { col: 28, row: 27 },
        { col: 32, row: 26 }, { col: 32, row: 27 },
        { col: 28, row: 29 }, { col: 32, row: 29 }
      ],
      /* 扉がこじ開けられた房（鉄格子を描かない）。牢送り後はここから出る */
      cellOpenings: [ { col: 32, row: 29 } ],
      door: { col: 34, row: 1, id: 'a1_exit_door' },
      exitPad: { col: 34, row: 2 },

      decals: [
        { col: 20, row: 13, type: 'blood' }, { col: 16, row: 24, type: 'blood' }, { col: 35, row: 5, type: 'blood' },
        { col: 24, row: 31, type: 'blood' }, { col: 12, row: 44, type: 'blood' }, { col: 44, row: 22, type: 'blood' },
        { col: 30, row: 26, type: 'blood' }, { col: 8, row: 22, type: 'blood' }, { col: 36, row: 34, type: 'blood' },
        { col: 18, row: 42, type: 'blood' }, { col: 46, row: 46, type: 'blood' }, { col: 34, row: 12, type: 'blood' },
        { col: 26, row: 18, type: 'blood' }, { col: 10, row: 46, type: 'blood' },
        /* 見せ場ルーム: 処置室の術野まわり／拘束室の前室 */
        { col: 19, row: 6, type: 'blood' }, { col: 21, row: 6, type: 'blood' },
        { col: 30, row: 28, type: 'blood' }, { col: 28, row: 28, type: 'blood' },
        { col: 24, row: 22, type: 'blood' }
      ],

      furniture: [
        /* --- 見せ場①「培養器室」(labA): 培養器が両側に並ぶ通路 --- */
        { col: 5, row: 5, type: 'incubator', dir: 's' },
        { col: 7, row: 5, type: 'incubator', dir: 's' },
        { col: 9, row: 5, type: 'incubator', dir: 's' },
        { col: 11, row: 5, type: 'incubator', dir: 's' },
        { col: 5, row: 7, type: 'incubator', dir: 'n' },
        { col: 7, row: 7, type: 'incubator', dir: 'n' },
        { col: 9, row: 7, type: 'cabinet', dir: 'n' },
        /* --- 見せ場②「処置室」(labB): 手術灯の下の処置台 --- */
        { col: 20, row: 6, type: 'opTable', dir: 'e' },
        { col: 17, row: 5, type: 'cabinet', dir: 'n' },
        { col: 23, row: 5, type: 'cabinet', dir: 'n' },
        { col: 17, row: 7, type: 'benchIsland', dir: 's' },
        { col: 22, row: 7, type: 'benchIsland', dir: 's' },
        /* --- 見せ場⑥「記録室」(旧拘束区): 机と書類の山・書庫 --- */
        { col: 47, row: 5, type: 'desk', dir: 'w' },
        { col: 47, row: 7, type: 'desk', dir: 'w' },
        { col: 45, row: 11, type: 'fileCab', dir: 'n' },
        { col: 47, row: 11, type: 'fileCab', dir: 'n' },
        /* --- 見せ場④「飼育檻室」(specimen): 積み上がった檻 --- */
        { col: 6, row: 13, type: 'cageStack', dir: 'e' },
        { col: 6, row: 15, type: 'cageStack', dir: 'e' },
        { col: 6, row: 17, type: 'cageStack', dir: 'e' },
        { col: 6, row: 19, type: 'cageStack', dir: 'e' },
        { col: 4, row: 14, type: 'cageStack', dir: 'e' },
        { col: 4, row: 18, type: 'cageStack', dir: 'e' },
        { col: 8, row: 15, type: 'cageStack', dir: 'w' },
        { col: 8, row: 19, type: 'cageStack', dir: 'w' },
        /* --- 見せ場③「検体タンク室」(machine): 液中のシルエットが並ぶ --- */
        /* variant: 0/2=人型のシルエット 1=丸まった小型個体 3=空になった房 */
        { col: 21, row: 21, type: 'specTank', dir: 's', variant: 0 },
        { col: 23, row: 21, type: 'specTank', dir: 's', variant: 3 },
        { col: 25, row: 21, type: 'specTank', dir: 's', variant: 2 },
        { col: 27, row: 21, type: 'machine', dir: 's' },
        { col: 21, row: 23, type: 'machine', dir: 'n' },
        { col: 23, row: 23, type: 'specTank', dir: 'n', variant: 0 },
        { col: 25, row: 23, type: 'specTank', dir: 'n', variant: 1 },
        { col: 27, row: 23, type: 'specTank', dir: 'n', variant: 2 },
        { col: 13, row: 33, type: 'tank', dir: 'n' },
        { col: 15, row: 33, type: 'tank', dir: 'n' },
        { col: 41, row: 41, type: 'console', dir: 'n' },
        { col: 43, row: 41, type: 'console', dir: 'n' },
        { col: 45, row: 41, type: 'console', dir: 'n' },
        { col: 47, row: 41, type: 'cabinet', dir: 'n' },
        { col: 47, row: 43, type: 'shelf', dir: 's' },
        { col: 4, row: 45, type: 'crate', dir: 'e' },
        { col: 8, row: 46, type: 'crate', dir: 'e' },
        { col: 1, row: 34, type: 'gurney', dir: 'n' },
        { col: 3, row: 44, type: 'crate', dir: 'n' },
        { col: 5, row: 42, type: 'shelf', dir: 'n' },
        { col: 11, row: 26, type: 'shelf', dir: 'n' },
        { col: 21, row: 11, type: 'shelf', dir: 'n' },
        { col: 21, row: 48, type: 'cabinet', dir: 'n' },
        { col: 21, row: 39, type: 'tank', dir: 'n' },
        { col: 23, row: 29, type: 'crate', dir: 'n' },
        { col: 25, row: 44, type: 'crate', dir: 'n' },
        { col: 38, row: 31, type: 'gurney', dir: 'n' },
        { col: 37, row: 50, type: 'gurney', dir: 'n' },
        { col: 41, row: 53, type: 'shelf', dir: 'n' },
        { col: 42, row: 1, type: 'crate', dir: 'n' },
        { col: 41, row: 38, type: 'shelf', dir: 'n' },
        { col: 49, row: 32, type: 'tank', dir: 'n' },
        { col: 53, row: 31, type: 'tank', dir: 'n' }
      ],

      /* 照明の作為的な上書き。gain / reach は「ここだけは明るく」を作る局所ブースト */
      lightOverrides: [
        { col: 4, row: 45, state: 'on', gain: 1.70, reach: 1.30 },
        { col: 7, row: 46, state: 'on', gain: 1.70, reach: 1.30 },
        { col: 7, row: 48, state: 'on', gain: 1.70, reach: 1.30 },
        { col: 4, row: 48, state: 'on', gain: 1.70, reach: 1.30 },
        { col: 34, row: 2, state: 'on', gain: 1.50, reach: 1.25 },
        { col: 34, row: 4, state: 'on', gain: 1.20, reach: 1.10 },
        { col: 7, row: 30, state: 'on', gain: 1.30, reach: 1.20 },
        { col: 13, row: 30, state: 'flicker', gain: 1.20, reach: 1.10 },
        { col: 16, row: 30, state: 'on', gain: 1.30, reach: 1.20 },
        { col: 21, row: 30, state: 'on', gain: 1.30, reach: 1.20 },
        { col: 34, row: 19, state: 'on', gain: 1.40, reach: 1.30 },
        { col: 34, row: 25, state: 'flicker', gain: 1.20, reach: 1.10 },
        { col: 34, row: 31, state: 'on', gain: 1.40, reach: 1.30 },
        { col: 28, row: 14, state: 'on', gain: 1.20, reach: 1.10 },
        { col: 36, row: 14, state: 'flicker', gain: 1.20, reach: 1.10 },
        { col: 10, row: 36, state: 'flicker', gain: 1.20, reach: 1.10 },
        { col: 10, row: 40, state: 'on', gain: 1.20, reach: 1.10 },
        { col: 18, row: 18, state: 'flicker' },
        { col: 14, row: 42, state: 'flicker' },
        { col: 46, row: 18, state: 'flicker' },
        { col: 22, row: 10, state: 'flicker' },

        /* --- 見せ場ルームの照明設計。天井灯は落として「主役だけが光る」構図を作る --- */
        /* 検体タンク室: 天井灯は死に、タンクの緑光だけが部屋を照らす */
        { col: 22, row: 22, state: 'off' },
        { col: 25, row: 22, state: 'flicker', gain: 0.85 },
        { col: 28, row: 22, state: 'off' },
        /* 処置室: 手術灯（extraLights）が主役。天井灯は1本だけ弱く残す */
        { col: 16, row: 4, state: 'off' },
        { col: 19, row: 4, state: 'off' },
        { col: 22, row: 4, state: 'off' },
        { col: 16, row: 7, state: 'on', gain: 0.55 },
        { col: 19, row: 7, state: 'flicker', gain: 0.70 },
        /* 培養器室: 培養器の琥珀色が主役 */
        { col: 4, row: 4, state: 'off' },
        { col: 7, row: 4, state: 'flicker', gain: 0.80 },
        { col: 10, row: 4, state: 'off' },
        { col: 4, row: 7, state: 'off' },
        { col: 10, row: 7, state: 'on', gain: 0.50 },
        /* 飼育檻室（闇だまりの中）: 切れかけの1本だけを戻して檻を浮かせる */
        { col: 7, row: 16, state: 'on', gain: 1.35, reach: 1.20 },
        { col: 4, row: 19, state: 'flicker', gain: 1.20, reach: 1.10 },
        { col: 7, row: 13, state: 'flicker', gain: 1.10, reach: 1.10 },
        /* 観察モニター室: モニタ壁の青光が主役 */
        { col: 40, row: 40, state: 'off' },
        { col: 43, row: 40, state: 'off' },
        { col: 46, row: 40, state: 'off' },
        { col: 40, row: 43, state: 'flicker', gain: 0.80 },
        { col: 43, row: 43, state: 'on', gain: 1.20 },
        { col: 46, row: 43, state: 'off' },
        /* 記録室: 卓上灯（extraLights）＋切れかけの天井灯 */
        { col: 46, row: 4, state: 'off' },
        { col: 46, row: 7, state: 'flicker', gain: 0.85 },
        { col: 46, row: 10, state: 'on', gain: 0.80 },
        /* 拘束室: 前室の1本だけが切れかけで明滅する（房の奥は闇） */
        { col: 30, row: 28, state: 'flicker', gain: 1.15, reach: 1.20 },
        { col: 28, row: 28, state: 'on', gain: 0.48 },
        { col: 32, row: 28, state: 'flicker', gain: 0.62 }
      ],

      /* 器具以外の光源（タンクの液体・手術灯・モニタ壁・卓上灯）。
       * 頂点色に焼き込む点光源で、実ライトは増えない。solid マス（什器）にも置ける。 */
      extraLights: [
        { col: 21, row: 21, y: 1.55, rgb: [0.30, 1.00, 0.62], R: 6.4, gain: 0.44 },
        { col: 23, row: 21, y: 1.55, rgb: [0.30, 1.00, 0.62], R: 6.4, gain: 0.44 },
        { col: 25, row: 21, y: 1.55, rgb: [0.34, 0.98, 0.78], R: 6.4, gain: 0.44 },
        { col: 23, row: 23, y: 1.55, rgb: [0.30, 1.00, 0.62], R: 6.4, gain: 0.44 },
        { col: 25, row: 23, y: 1.55, rgb: [0.34, 0.98, 0.78], R: 6.4, gain: 0.44 },
        { col: 27, row: 23, y: 1.55, rgb: [0.30, 1.00, 0.62], R: 6.4, gain: 0.44 },
        { col: 20, row: 6, y: 2.26, rgb: [1.00, 0.98, 0.93], R: 5.8, gain: 2.20 },
        { col: 7, row: 5, y: 1.45, rgb: [1.00, 0.76, 0.34], R: 5.4, gain: 0.42 },
        { col: 7, row: 7, y: 1.45, rgb: [1.00, 0.76, 0.34], R: 5.4, gain: 0.42 },
        { col: 11, row: 5, y: 1.45, rgb: [1.00, 0.76, 0.34], R: 5.0, gain: 0.36 },
        { col: 42, row: 40, y: 1.86, rgb: [0.44, 0.68, 1.00], R: 6.6, gain: 0.88 },
        { col: 47, row: 40, y: 1.86, rgb: [0.44, 0.68, 1.00], R: 6.6, gain: 0.80 },
        { col: 44, row: 42, y: 1.30, rgb: [0.40, 0.62, 1.00], R: 5.6, gain: 0.46 },
        { col: 46, row: 5, y: 1.30, rgb: [1.00, 0.84, 0.56], R: 5.4, gain: 0.58 }
      ],

      /* 壁付けの造作。col,row は「手前の歩行可能マス」、dir はそこから見た壁の向き */
      wallKit: [
        /* 観察モニター室のモニタ壁 */
        { col: 41, row: 40, dir: 'n', type: 'monitorBank' },
        { col: 42, row: 40, dir: 'n', type: 'monitorBank' },
        { col: 43, row: 40, dir: 'n', type: 'monitorBank' },
        { col: 44, row: 40, dir: 'n', type: 'monitorBank' },
        { col: 46, row: 40, dir: 'n', type: 'monitorBank' },
        { col: 47, row: 40, dir: 'n', type: 'monitorBank' },
        /* 記録室のホワイトボードと掲示板 */
        { col: 45, row: 4, dir: 'n', type: 'whiteboard' },
        { col: 46, row: 4, dir: 'n', type: 'whiteboard' },
        { col: 47, row: 4, dir: 'n', type: 'corkboard' },
        /* 処置室のシャーカステン（X線写真の掲示灯） */
        { col: 18, row: 4, dir: 'n', type: 'xrayBox' },
        { col: 22, row: 4, dir: 'n', type: 'xrayBox' },
        /* 各見せ場の入口・要所のバイオハザード標識と区画銘板 */
        { col: 29, row: 21, dir: 'n', type: 'bioPlacard' },
        { col: 24, row: 20, dir: 'n', type: 'bioPlacard' },
        { col: 20, row: 8, dir: 's', type: 'bioPlacard' },
        { col: 8, row: 8, dir: 's', type: 'bioPlacard' },
        { col: 7, row: 12, dir: 'n', type: 'bioPlacard' },
        { col: 44, row: 8, dir: 'w', type: 'bioPlacard' },
        { col: 31, row: 28, dir: 'n', type: 'bioPlacard' },
        { col: 42, row: 44, dir: 's', type: 'bioPlacard' }
      ],

      /* 天井付けの造作 */
      ceilKit: [
        { col: 20, row: 6, type: 'surgicalLamp' }
      ]
    }
  });
})(window);
