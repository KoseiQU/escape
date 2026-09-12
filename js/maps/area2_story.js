/* ESCAPE — エリア2 物語ゲート（DESIGN.md §4「P5 エリア2『下水道』」の強制メモ＝作業員の日誌2枚）
 *
 * 本文の正文は docs/notes.md「エリア2『下水道』」の「強制メモ＝作業員の日誌」（表示タイトルは
 * どちらも『作業員の日誌』）。表示の仕組み（初回のみ・既読はセーブに永続・閉じるまで移動不可・
 * 保留）は js/progress.js の領分で、area1 とまったく同じ経路に乗る。
 *
 * ══ 2枚の受け持ちが違う ════════════════════════════════════════════
 *   日誌1（a2_diary1）… 契約「スタート区画を出た直後」。**地点ではなく遷移**なので、
 *     area1 の a1_diary と同じ「スポーンの部屋（meta.regions の最小の部屋）の中 → 外」の
 *     遷移で発火する（js/progress.js _checkDiary）。この表には載せない。
 *     読み返し用の壁メモは js/maps/area2.js の meta.notes に直接入れてある
 *     （(10,9) dir 's'。スタート部屋 inlet_shaft = 1,1〜10,10 の出口の内側の壁。
 *      出口は (10,3)/(10,5)/(2,10)/(9,10)/(10,10) の5口で、スタート(5,5)からの
 *      経路距離が最小の口の並びは 8/8/9/10/11。掲示は最も広い (10,10)→(11,10) の口の壁）。
 *   日誌2（a2_diary2）… 契約「ポンプ室に降りる直前」。下の規則で機械算出した1点。
 *
 * ══ 地点の算出（機械的。手置きではない）══════════════════════════════════
 * js/maps/area2.js の rows / meta だけを入力に、Node.js の BFS で算出した。
 * 規則は js/maps/area1_story.js の R1〜R8 をそのまま使い、R5/R6（最初の音の罠・最初の
 * ロッカーの3マス手前）の代わりに、契約が名指しした地点を採る R5' を置いた。
 *
 *   R1 進行路 = スタート(5,5) →〔ハンドル置き場の前(14,59)〕→ 到達パッド(72,70) の最短経路
 *      （4近傍BFS）。全長 344 マス（スタート→ハンドル 249 ＋ ハンドル→出口 95）。
 *      「経路距離」は **スタートからの BFS 最短距離** で測る＝最短経路の取り方に依らない。
 *   R2 ゲートはスタート部屋（inlet_shaft = c1-10 / r1-10）の**外**。日誌1より前に割り込ませない。
 *   R3 番号順に経路距離が単調増加する（日誌1 < 日誌2）。
 *   R5' 日誌2 = **進行路が最初に通るランプの入口から、進行路を 3 マス戻ったマス**。
 *      （契約の「ポンプ室に降りる直前」。ランプは北・西・東の3本あるので、R1 の進行路が
 *        最初に踏むランプを採る＝北ランプの入口 (50,42)・経路距離 170）
 *   R7 ゲートのマスは歩行可能。壁メモを貼るため 4近傍に '#' の壁を1つ以上持つ。
 *      持たないマスは、経路を1マスずつ**手前へ戻して**最初に持つマスまで寄せる。
 *   R8 壁メモの向き dir は既存の壁メモと同じ規約＝**壁のマスから見て読む側（床）の方角**。
 *
 * ── 結果（2026-09-13 契約 追補「ランプ3本の開通」を受けて再算出）────────────────
 *   進行路はポンプ室を**通る**ようになった: スタート(5,5) → 北ランプ (50,42-45) を降りて
 *   ポンプ室を横切り → 西ランプ (45-42,54) を上って旧坑区画へ → ハンドルの前(14,59)
 *   → 到達パッド(72,70)。全長 344 マス（スタート→ハンドル 249 ＋ ハンドル→出口 95）。
 *   ポンプ室の中を通る区間は 15 マス（(50,46)〜(46,54)）。
 *
 *   a2_diary2  (50,38)  経路距離 166
 *              北ランプの入口 (50,42)（経路距離 170）の **4マス手前**。
 *              R5' どおりの3マス手前 (50,39)＝経路距離 167 は幹線の**水路マス 'W'** で
 *              4近傍が水路と歩廊だけ＝R7 を満たさないため、R7 の寄せで1マス手前にした。
 *              壁メモ (50,37) dir 's'（北側の '#' 壁。南隣の (50,38) から読む）
 *              迂回コスト 0（下記の妥協点①）
 *
 * ── 既知の妥協点 ────────────────────────────────────────────────────
 *  ① 迂回コストが 0 ＝**必ず通る要衝ではない**。(50,38) を塞いでもポンプ室へも出口へも
 *     ハンドルへも同じ距離で行ける（幹線 row 38-40 は幅3で、南側の歩廊 row 40 から
 *     col 50 の降り口へ回り込めるため）。area1 の日記2〜4 と同じ性質（あちらも迂回コスト
 *     +4〜+56 で素通りできる）で、契約が地点を「ポンプ室に降りる直前」と名指ししている
 *     以上、要衝性より地点の正しさを優先した。
 *     ＝ 進行路をまっすぐ歩けば必ず読む／幅3の幹線の反対側の歩廊を通れば読まずに済む。
 *  ② 「3マス手前」は満たせず「4マス手前」になった（R7 の寄せ。area1 の a1_diary3 と同じ事情）。
 *  ③ ランプ3本の開通でハンドルが近くなった（スタート→ハンドル 303→249／往復比 1.579→1.365）。
 *     契約の 1.35〜1.60 には収まっているが下限寄り。
 *
 * ══ 壁メモ（読み返し用）══════════════════════════════════════════════
 * area1_story.js と同じ作法で、登録済みの area2 の定義へ**起動時に**足す:
 *   ① rows の該当マス '#'(WALL) → 'N'(NOTE)   ② meta.notes へ {col,row,dir,id} を追加
 * これで js/world.js の紙の造形も js/progress.js の「調べる」も既存メモと同じ経路に乗る。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var GATES = [
    { id: 'a2_diary2', col: 50, row: 38, dist: 166, wall: { col: 50, row: 37, dir: 's' } }
  ];

  /* 物語ゲートはマップ別（js/progress.js は現在のマップのぶんだけ読む）。
     ESCAPE.STORY_GATES は「現在のマップのゲート」を指す後方互換の別名（js/test.js が読む）。
     js/maps/area1_story.js は編集禁止なので、そこが置いた ESCAPE.STORY_GATES を
     **area1 のぶんとしてここで登録し直す**（このファイルは area1_story.js の直後に読まれる）。 */
  var BY_MAP = ESCAPE.STORY_GATES_BY_MAP || (ESCAPE.STORY_GATES_BY_MAP = {});
  if (!BY_MAP.area1 && ESCAPE.STORY_GATES) BY_MAP.area1 = ESCAPE.STORY_GATES;
  BY_MAP.area2 = GATES;
  var CUR = ESCAPE.currentArea ? ESCAPE.currentArea() : 'area1';
  if (BY_MAP[CUR]) ESCAPE.STORY_GATES = BY_MAP[CUR];

  /** 壁メモを area2 の**定義**（registry の実体）へ焼く。二重実行しても増えない。 */
  function attachWallNotes() {
    if (!ESCAPE || !ESCAPE.Maps || !ESCAPE.Maps.has || !ESCAPE.Maps.has('area2')) return;
    var def = ESCAPE.Maps.load('area2').def;   /* load() が返す GridMap は捨てる。def が本体 */
    if (!def || !def.rows) return;
    var meta = def.meta || (def.meta = {});
    var notes = meta.notes || (meta.notes = []);
    var have = Object.create(null);
    for (var i = 0; i < notes.length; i++) have[notes[i].id] = true;

    for (var g = 0; g < GATES.length; g++) {
      var gate = GATES[g], w = gate.wall;
      if (!w) { gate.wallBaked = false; continue; }
      if (have[gate.id]) { gate.wallBaked = true; continue; }   /* 二重実行 */
      var line = def.rows[w.row];
      if (!line || line.charAt(w.col) !== '#') { gate.wallBaked = false; continue; }
      def.rows[w.row] = line.slice(0, w.col) + 'N' + line.slice(w.col + 1);
      notes.push({ col: w.col, row: w.row, dir: w.dir, id: gate.id, story: true });
      have[gate.id] = true;
      gate.wallBaked = true;
    }
  }

  attachWallNotes();
  ESCAPE.STORY_GATES_ATTACH_A2 = attachWallNotes;
})(window);
