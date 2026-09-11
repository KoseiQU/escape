/* ESCAPE — エリア1 物語ゲート（DESIGN.md「### P4.17 再プレイ差し戻し」項目2）
 *
 * 進行路上の3地点で「研究員の日記 2〜4」を強制表示する。**地点だけ**を持つデータファイルで、
 * 表示の仕組み（初回のみ・既読はセーブに永続・閉じるまで移動不可・保留）は js/progress.js の領分。
 * 本文の正文は docs/notes.md「P4.17追加（強制メモ＝研究員の日記 2〜4）」（表示タイトルは『研究員の日記』）。
 *
 * ══ 地点の算出（機械的。手置きではない）══════════════════════════════════
 * js/maps/area1.js の rows / meta だけを入力に、Node.js の BFS で算出した。規則:
 *
 *   R1 進行路 = スタート(4,74) →〔金庫の前(1,5)〕→ 出口パッド(77,2) の最短経路（4近傍BFS）。
 *      全長 437 マス（スタート→金庫 314 ＋ 金庫→出口 123）。
 *      「経路距離」は **スタートからの BFS 最短距離** で測る＝最短経路の取り方（タイブレーク）に
 *      依らず一意に決まる。3地点はいずれも「スタート→出口」だけの最短経路(299)の上にも乗る。
 *   R2 ゲートはスタート部屋（受入ホール meta.regions#hall = c1-9 / r70-76）の**外**。
 *      日記1（スタート部屋を出た瞬間・P4.16 項目1）より前に割り込ませない。
 *   R3 番号順に経路距離が単調増加する（日記2 < 日記3 < 日記4）。
 *   R4 日記2 = 経路距離 12 マス（契約「約12マス・初めて暗い通路に入る前後」）。
 *   R5 日記3 = 最初の音の罠（meta.noise の音地盤 か meta.traps kind:'wire'）の3マス手前。
 *   R6 日記4 = 最初のロッカー（meta.lockers。ロッカーは solid なので**経路マスに隣接**した
 *      時点の経路距離で測る）の3マス手前。
 *   R7 ゲートのマスは歩行可能。壁メモを貼るため 4近傍に '#' の壁を1つ以上持つ。
 *      持たないマスは、経路を1マスずつ手前へ戻して最初に持つマスまで寄せる。
 *   R8 壁メモの向き dir は既存の壁メモと同じ規約＝**壁のマスから見て読む側（床）の方角**。
 *
 * ── 結果 ────────────────────────────────────────────────────────────
 *   a1_diary2  (10,68)  経路距離 12（R4ちょうど）
 *              壁メモ (10,67) dir 's'（北側の '#' 壁。南隣の (10,68) から読む）
 *              迂回コスト +4 マス
 *   a1_diary3  (32,72)  経路距離 54。最初の音の罠＝ワイヤー a1_tr217 (32,70) 経路距離 58 の
 *              **4マス手前**。R5 どおりの3マス手前 (33,72) は4近傍に壁が1つも無く（東西南北すべて
 *              床）、R7 により1マス手前へ寄せた。
 *              壁メモ (32,73) dir 'n'（南側の '#' 壁。北隣の (32,72) から読む）
 *              迂回コスト +28 マス
 *   a1_diary4  (31,67)  経路距離 62。最初のロッカー (32,64)（経路マス (31,64) に隣接・経路距離 65）
 *              の3マス手前（R6ちょうど）。
 *              壁メモ (30,67) dir 'e'（西側の '#' 壁。東隣の (31,67) から読む）
 *              迂回コスト +56 マス
 *
 * ── 既知の妥協点 ────────────────────────────────────────────────────
 *  ① 経路距離が最小の音の罠・ロッカーは採れない。ワイヤー(9,69)＝経路距離10 の3マス手前は
 *     (7,70)＝スタート部屋の中（R2違反・日記1より手前）。ロッカー(21,67)＝経路距離27 の
 *     3マス手前は (19,69) で、ここを日記4にすると日記3(54)より手前に来る（R3違反）。
 *     どちらも次に来るものを採った。
 *  ② 日記3だけ「3マス手前」ではなく「4マス手前」（R7の寄せ。上記のとおり）。
 *  ③ 迂回コストが有限＝3地点はいずれも**必ず通る要衝ではない**（この迷路は環状路を持つ）。
 *     遠回りを承知で避ければ素通りできる。特に日記2は +4 マスと安い。経路距離12前後の通路は
 *     (9,70)〜(17,69) までどのマスも +4／+2 で、これ以上強い場所は無かった。
 *
 * ══ 壁メモ（読み返し用）══════════════════════════════════════════════
 * 同じ地点の隣接壁に、既存の壁メモと**同じ造形・同じ「調べる」経路**で貼る。
 * js/maps/area1.js はレーンAの領分で編集できないので、登録済みの定義へ**起動時に**足す:
 *   ① rows の該当マス '#'(WALL) → 'N'(NOTE)   ② meta.notes へ {col,row,dir,id} を追加
 * これで js/world.js の紙の造形も js/progress.js の「調べる」も既存メモと同じ経路に乗る
 * （どちらも meta.notes と NOTE タイルだけを見ているため。world.js には一切触らない）。
 * 壁でないマス（レーンAが別の物に変えた等）は触らずに見送り、その場合でも progress.js 側の
 * 索引（_storyWallAt）だけで「調べる」は成立する。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  var GATES = [
    { id: 'a1_diary2', col: 10, row: 68, dist: 12, wall: { col: 10, row: 67, dir: 's' } },
    { id: 'a1_diary3', col: 32, row: 72, dist: 54, wall: { col: 32, row: 73, dir: 'n' } },
    { id: 'a1_diary4', col: 31, row: 67, dist: 62, wall: { col: 30, row: 67, dir: 'e' } }
  ];

  ESCAPE.STORY_GATES = GATES;

  /** 壁メモを area1 の**定義**（registry の実体）へ焼く。GridMap は毎回 def から作られるので、
   *  ここで def を書き換えておけば reset() やロード後も同じ壁メモが出る。二重実行しても増えない。 */
  function attachWallNotes() {
    if (!ESCAPE || !ESCAPE.Maps || !ESCAPE.Maps.has || !ESCAPE.Maps.has('area1')) return;
    var def = ESCAPE.Maps.load('area1').def;   /* load() が返す GridMap は捨てる。def が本体 */
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
      if (!line || line.charAt(w.col) !== '#') { gate.wallBaked = false; continue; }  /* 壁でなければ触らない */
      def.rows[w.row] = line.slice(0, w.col) + 'N' + line.slice(w.col + 1);
      notes.push({ col: w.col, row: w.row, dir: w.dir, id: gate.id, story: true });
      have[gate.id] = true;
      gate.wallBaked = true;
    }
  }

  attachWallNotes();
  /* 機械テストから焼き直しを確かめられるように公開する（通常の実行では使わない） */
  ESCAPE.STORY_GATES_ATTACH = attachWallNotes;
})(window);
