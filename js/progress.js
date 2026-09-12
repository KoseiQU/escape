/* ESCAPE — P4.8「アリアドネ方式」進行管理（調べるUI・メモ・区画銘板・鍵と隔壁・目的表示・セーブ）
 * 契約 DESIGN.md §4「迷路の根幹＝アリアドネ方式」／docs/notes.md「エリア1 v3 アリアドネ方式」
 *
 * 【P4.8 失効】旧 v2 の7工程（ヒューズ／保管庫／配電パズル／カードキー／端末コード／
 *   バルブ／12秒隔壁の追走／排水路グレーチング）と所持品UIは失効。造形は残置してあるが
 *   「調べる」対象ではない（meta.gimmicks から外してある）。
 *
 * 現行の「調べる」対象は4種類だけ:
 *   1 壁のメモ（6枚）           … 拡大表示
 *   2 区画銘板（A〜F）          … 地図に区画名を記入
 *   3 所長室の金庫              … 隔壁の鍵を手に入れる
 *   4 北の隔壁                  … 鍵で解錠 → EXIT でクリア
 * 【P4.13 失効】「落ちたロープの結び目を拾って結ぶ」は失効。捕獲は Rope 側で
 *   「周回ごとの軌跡」に切り替わり（js/rope.js）、復帰後は拾い直し不要で
 *   自動的にスタートから新しい周が始まる。
 *
 * 既存システムとの結線:
 *   - js/game.js stepFrame(): モーダル中は視点・移動を止める。「調べる」は
 *     progress.onInteract() を先に試し、処理しなければ stealth.onInteract() へ。
 *   - js/enemy_ai.js Stealth.hidden(): モーダル中は捕獲されない（中断安全）。
 *   - js/enemy_ai.js Stealth.areaReset(): 3回目の捕獲でエリア最初から
 *     （Progress.onAreaReset → 鍵・地図の踏破・ロープを規定どおり巻き戻す）。
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;
  var THREE = global.THREE;

  /* ================================================================
   * docs/notes.md 正文（一字一句変更禁止）。
   * 対応表（実位置と最も整合する memo 番号。id の連番とは一致しない）:
   *   a1_n1→memo5 / a1_n2→memo2 / a1_n3→memo6 / a1_n4→memo3 / a1_n5→memo1 / a1_n6→memo4
   * memo1 / memo4 / memo5 は「エリア1 v3 アリアドネ方式」節の差し替え本文が正。
   * memo2 / memo3 / memo6 は旧本文のまま（v3節「旧本文のまま」）。
   * ============================================================== */
  var NOTE_TEXTS_A1 = {
    /* memo1 — 受入ホール（v3差し替え／P4.12改訂: 末行を「ロープの色が濁ったら…」へ。
       ロープ無制限化で旧「ロープが張ったら、それ以上は行くな。戻れ。」は失効） */
    a1_n5: {
      title: '夜勤引継ぎのメモ',
      body: '夜勤の点検員へ\n\n' +
        '隔壁が全部降りた。北の隔壁だけは手動で開くが、鍵がいる。\n' +
        '鍵は所長室の金庫 —— 施設の一番奥だ。\n\n' +
        '腰のロープを外すな。奴らが来る前、俺たちはこれで戻っていた。\n' +
        'ロープの色が濁ったら道を外れている。戻れ。'
    },
    /* memo2 — 病室区画の行き止まり（旧本文のまま） */
    a1_n2: {
      title: '封鎖作業 申し送り',
      body: '第7次封鎖作業 申し送り（抜粋）\n\n' +
        '・移送対象No.6、依然として区画内を徘徊。直立時の視野は広いが、暗がりでは目が利かない。\n' +
        '・接近された場合はロッカーへ。奴は「見た」ものしか追わない。\n' +
        '・通路の資材板は倒せば時間が稼げる。ただし一度きりだ。\n' +
        '・しゃがんで歩け。立って走った者から順に、いなくなった。'
    },
    /* memo3 — 検体タンク室の近く（旧本文のまま） */
    a1_n4: {
      title: '巡回員への警告',
      body: 'B-3区画 巡回員へ\n\n' +
        'タンクの中身について質問するな。記録にも残すな。\n' +
        '廊下の赤いビームは旧警備システムの生き残りだ。走って抜けると警報が鳴り、\n' +
        '「回収班」が来る。回収班はもういない。来るのは別のものだ。\n\n' +
        'ゆっくり歩けば、ビームの手前で必ず気づける。'
    },
    /* memo4 — 記録室（v3差し替え） */
    a1_n6: {
      title: '最終封鎖手順書 控え',
      body: '最終封鎖手順書 控え\n\n' +
        '・隔壁鍵は所長保管。所長室は北の記録区画の西端 —— 記録室のさらに奥。\n' +
        '・区画銘板は撤去せず残す。迷った者の目印になる。\n\n' +
        '……もう戻る者もいない。この控えを残す。\n' +
        '誰かがここまで辿り着いたなら、どうか急いでくれ。奴は音を覚える。'
    },
    /* memo5 — 主電源盤の傍・西区画（v3差し替え） */
    a1_n1: {
      title: '点検員の走り書き',
      body: '点検員の走り書き\n\n' +
        '電源は死んでる。灯りは腰のライトだけだ。\n' +
        '歩けば点く。止まれば消える。\n' +
        '—— 点けたまま奴の前に出るな。光は遠くからでも見える。'
    },
    /* P4.16 項目1 — 研究員の日記（正文 docs/notes.md「P4.16追加（導入・タイトル）」）。
       スタート部屋を初めて出た瞬間に**自動で1回**開く（既読はセーブに永続）。
       壁のメモとしてもスタート部屋の出口脇に置かれ、何度でも読み返せる。 */
    a1_diary: {
      title: '研究員の日記',
      body: '九月　日付は忘れた\n\n' +
        '封鎖区画に「あれ」が残っている。人だったものだ。\n' +
        '二本の足で立って歩く。だが、こちらを見つけると床に伏せて、四つ足で追ってくる。速い。\n\n' +
        '近づかれると、胸が締めつけられる。心臓の音が耳の奥で強くなる。\n' +
        '目で見るより先に、心臓が教えてくれる。速くなったら立ち止まれ。隠れろ。\n' +
        'ロッカーの中なら見つからなかった。板の陰でも、息を殺せば。\n\n' +
        '床のガラス、金属板、水たまり —— 走って踏むな。缶を蹴るな。センサーの前で走るな。\n' +
        '音を立てると、あれは叫ぶ。叫んだら、もう走ってきている。\n\n' +
        '出口は北の隔壁。鍵は所長室の金庫。\n' +
        '三度目はない。'
    },
    /* P4.17 項目2 — 日記2（ライト）（正文 docs/notes.md「P4.17追加」） */
    a1_diary2: {
      title: '研究員の日記',
      body: '九月　何日目かは数えていない\n' +
        '\n' +
        '灯りは腰のライトしかない。歩き出すと勝手に点いて、足を止めると消える。\n' +
        '壊れているのではない。そういう作りだ。点検員が立ち止まる場所で、余計な光を残さないように。\n' +
        '点いている間は遠くまで見える。だが、遠くからもこちらがよく見える。\n' +
        'あれに気づかれたくなければ、止まって、暗いままでいろ。'
    },
    /* P4.17 項目2 — 日記3（音と罠）（正文 docs/notes.md「P4.17追加」） */
    a1_diary3: {
      title: '研究員の日記',
      body: '床を見ろ。\n' +
        '\n' +
        'ガラスの破片、金属の板、水たまり、転がった缶、軋む板。踏むなら歩け。走ればすべて鳴る。\n' +
        '膝の高さに張られた線がある。吊った缶が鳴る。しゃがんで潜れ。\n' +
        '赤い小さな目が点滅している所はセンサーだ。走って前を横切れば警報が鳴る。歩け。\n' +
        '音を立てると、あれは叫ぶ。叫び声が聞こえた時には、もうこちらへ走っている。'
    },
    /* P4.17 項目2 — 日記4（ロッカーと板）（正文 docs/notes.md「P4.17追加」） */
    a1_diary4: {
      title: '研究員の日記',
      body: '今日、通路の端でロッカーに入った。あれは目の前を通り過ぎた。\n' +
        '扉の隙間から、長い髪が揺れるのが見えた。息を止めていた。\n' +
        '\n' +
        'ただし、音を聞かれた後は違う。あれは近くのロッカーを一つずつ開けて回る。\n' +
        '立てかけた板は、倒せば道を塞げる。あれは回り道をする。その間に離れろ。\n' +
        '隠れる場所と塞ぐ板を、通る前に覚えておけ。'
    },
    /* memo6 — 拘束室の前室（旧本文のまま） */
    a1_n3: {
      title: '拘束区画 運用規程',
      body: '拘束区画 運用規程（最終改訂）\n\n' +
        '・回収した対象は必ず施錠房へ。格子の破損は第4房 —— 修理不能。\n' +
        '・房内の対象が暴れても開けるな。三度目の回収後は、上へ報告。\n\n' +
        '余白に手書き:\n' +
        '　「三度目」の後に何が起きたかは、第4房の有様が全てだ。\n' +
        '　俺たちが回収していたのは、俺たちだった。'
    }
  };

  /* ================================================================
   * P5 エリア2「下水道」の正文（docs/notes.md「エリア2『下水道』」。一字一句変更禁止）
   * 壁メモ6枚 a2_n1〜a2_n6 ＋ 強制メモ＝作業員の日誌2枚 a2_diary1 / a2_diary2。
   * ============================================================== */
  var NOTE_TEXTS_A2 = {
    /* a2_n1 — 流入区画・縦坑の下 */
    a2_n1: {
      title: '保守作業員の申し送り',
      body: '保守作業員の申し送り\n\n' +
        '上の隔壁は施設側からしか開かない。降りたら戻れない。\n' +
        'ここから出るには水門を上げるしかない。水門は制御室の操作盤で上げる。\n' +
        '操作ハンドルは持ち歩き式だ。最後の当番が持ったまま、旧坑道の方へ逃げた。'
    },
    /* a2_n2 — 幹線区画 */
    a2_n2: {
      title: '第三幹線 水位記録',
      body: '第三幹線 水位記録\n\n' +
        '歩廊が崩れた区間は水路を渡れ。膝までだ。\n' +
        'ただし水の中は遅い。音も立つ。走るな。\n' +
        '幹線は一つの環だ。どこまで行っても、いつか同じ場所に戻る。'
    },
    /* a2_n3 — 沈殿区画 */
    a2_n3: {
      title: '沈殿槽 点検記録',
      body: '沈殿槽 点検記録\n\n' +
        '槽の水は覗くな。緑に光るのは薬剤じゃない。\n' +
        '上の研究所から流れてきたものだ。\n' +
        '歩廊の鉄板は音が響く。走れば槽の底まで聞こえる。'
    },
    /* a2_n4 — 機関区画・ポンプ室 */
    a2_n4: {
      title: 'ポンプ室 停止手順',
      body: 'ポンプ室 停止手順\n\n' +
        'ポンプは全停止。窪地の水はもう抜けない。\n' +
        'ここは下水道の一番低い場所だ。どの幹線もここへ戻ってくる。\n' +
        '迷ったら流れを見ろ。水は水門へ向かって流れる。'
    },
    /* a2_n5 — 旧坑区画 */
    a2_n5: {
      title: '立入禁止 通知',
      body: '立入禁止 通知\n\n' +
        '旧坑道は崩落の恐れあり。支保工に触れるな。灯りは点かない。\n\n' +
        '……骨がある。人のだ。\n' +
        '研究所ができるより前から、ここにある。'
    },
    /* a2_n6 — 水門区画・制御室 */
    a2_n6: {
      title: '制御室 引継ぎ',
      body: '制御室 引継ぎ\n\n' +
        '水門はハンドルで上げる。軸に嵌めて、止まるまで回せ。\n' +
        '上がりきったら先へ進め。水門の先は本管だ。\n' +
        '—— 戻れない。上がった水門は、下ろす者がいない。'
    },
    /* 強制メモ1 — スタート区画を出た直後（自動表示の id＝DIARY_ID_BY_MAP.area2） */
    a2_diary1: {
      title: '作業員の日誌',
      body: '梯子を降りた。上の隔壁は、もう開かない。\n\n' +
        'ここは施設の下水道だ。研究所の排水が、全部ここへ落ちてくる。\n' +
        '出るには水門を上げるしかない。操作ハンドルは制御室に無い。\n' +
        '最後の当番が持ち出した。旧坑道に逃げ込んだと聞いた。\n\n' +
        '水の中は膝まで。歩ける。だが遅くなる。音も立つ。'
    },
    /* 強制メモ2 — ポンプ室へ降りる直前（地点は js/maps/area2_story.js） */
    a2_diary2: {
      title: '作業員の日誌',
      body: 'ポンプ室に降りる。ここが一番低い。\n' +
        '全部の水がここに集まって、ここから水門へ流れていく。\n\n' +
        '迷ったら流れを見ろ。流れの先に水門がある。\n\n' +
        '暗い。灯りの間隔が広い。\n' +
        '歩いて点けて、止まって消せ。'
    }
  };

  /* 現在のマップ（ページの寿命の間は固定。決定は js/map.js の ESCAPE.currentArea） */
  var MAP_ID = (ESCAPE.currentArea ? ESCAPE.currentArea() : 'area1');
  var NOTE_TEXTS_BY_MAP = { area1: NOTE_TEXTS_A1, area2: NOTE_TEXTS_A2 };
  var NOTE_TEXTS = NOTE_TEXTS_BY_MAP[MAP_ID] || NOTE_TEXTS_A1;

  /* docs/notes.md「区画名」の正文。銘板の表記は `A　受入区画` 形式（間は全角空白）。
     P5: マップ別（area2 は「エリア2『下水道』」節の区画名）。 */
  var ZONE_NAMES_BY_MAP = {
    area1: {
      A: '受入区画', B: '実験区画', C: '検体区画',
      D: '拘束区画', E: '記録区画', F: '機械区画'
    },
    area2: {
      A: '流入区画', B: '幹線区画', C: '沈殿区画',
      D: '機関区画', E: '旧坑区画', F: '水門区画'
    }
  };
  var ZONE_NAMES = ZONE_NAMES_BY_MAP[MAP_ID] || ZONE_NAMES_BY_MAP.area1;
  function zoneLabel(zone) { return zone + '　' + (ZONE_NAMES[zone] || ''); }

  /* docs/notes.md「UI文言」（v3節）の正文 */
  var UI_TEXT_A1 = {
    note: 'メモを読む',
    regionSign: '区画銘板を読む',
    safe: '金庫を開ける',
    keyGot: '隔壁の鍵を手に入れた',
    bulkheadLook: '隔壁を調べる',
    bulkheadLocked: '施錠されている —— 鍵がいる',
    bulkheadUnlock: '隔壁を解錠する',
    /* P4.14 セーブポイント（正文 docs/notes.md「P4.14追加（セーブポイント・地図）」） */
    savePoint: '端末に記録する',
    savedNow: '記録した —— ここから再開できる',
    savedAlready: '記録済み',
    /* 【P4.12 失効】taut: 'ロープが張った' —— ロープ無制限化で表示そのものが失効 */
    /* 【P4.13 失効】knot: 'ロープを拾って結ぶ' —— 結び目の拾い直し自体が失効 */
    mapTitle: '地図'
  };

  /* P5 エリア2の UI文言（docs/notes.md「エリア2『下水道』」の「UI文言」が正文）。
     メモ・銘板・セーブ端末の汎用文言は area1 と同じものを使い回す。 */
  var UI_TEXT_A2 = {
    note: UI_TEXT_A1.note,
    regionSign: UI_TEXT_A1.regionSign,
    /* ハンドル置き場（role 'safe' を流用） */
    safe: 'ハンドルを取る',
    keyGot: '水門の操作ハンドルを手に入れた',
    /* 制御室の操作盤（role 'bulkhead' を流用） */
    bulkheadLook: '操作盤を調べる',
    bulkheadLocked: '軸が空だ —— ハンドルがいる',
    bulkheadUnlock: 'ハンドルを嵌めて回す',
    doorOpened: '水門が上がった',
    /* 水路に入った時（一度だけ・短く） */
    waterNoRun: '水の中では走れない',
    savePoint: UI_TEXT_A1.savePoint,
    savedNow: UI_TEXT_A1.savedNow,
    savedAlready: UI_TEXT_A1.savedAlready,
    mapTitle: UI_TEXT_A1.mapTitle
  };
  var UI_TEXT_BY_MAP = { area1: UI_TEXT_A1, area2: UI_TEXT_A2 };
  var UI_TEXT = UI_TEXT_BY_MAP[MAP_ID] || UI_TEXT_A1;

  /* docs/notes.md「目的表示（画面上部1行）」の正文 */
  var OBJECTIVE_A1 = {
    findKey: '出口の鍵を探す —— 施設の一番奥へ',
    haveKey: '鍵を手に入れた —— 北の隔壁へ戻る',
    /* 【P4.12 失効】taut: 'ロープが張った —— 来た道を戻れ' ／
       ropeShort: 'ロープが足りない —— 戻って巻き戻せ' —— どちらも長さ制限ごと失効。 */
    /* 【P4.13 失効】knot: '落ちたロープの結び目へ戻る' —— 結び目の拾い直し自体が失効。
       復帰後は通常の目的（鍵／隔壁）にそのまま戻る（下の objective() を参照）。 */
    /* 赤（遠回り率超過）に入った瞬間の一時表示。P4.12 でも維持（docs/notes.md P4.12追加） */
    ropeDetour: '遠回りしすぎだ —— 戻って巻き戻せ'
  };

  /* P5 エリア2の目的表示（docs/notes.md「エリア2『下水道』」の「目的表示」が正文）。
     area2 だけ3段（水門開放後の行がある）。area1 に doorOpen は無い＝挙動不変。 */
  var OBJECTIVE_A2 = {
    findKey: '水門の操作ハンドルを探す —— 旧坑道の奥へ',
    haveKey: 'ハンドルを手に入れた —— 水門の制御室へ',
    doorOpen: '水門が上がった —— 先へ',
    ropeDetour: OBJECTIVE_A1.ropeDetour
  };
  var OBJECTIVE_BY_MAP = { area1: OBJECTIVE_A1, area2: OBJECTIVE_A2 };
  var OBJECTIVE = OBJECTIVE_BY_MAP[MAP_ID] || OBJECTIVE_A1;

  /* P4.12 HUD文言（docs/notes.md「P4.12追加（罠の案内・HUD）」）。
     メートル表示は廃止し、ラベル＋色だけで方向判定を伝える。
     P4.13（docs/notes.md「P4.13追加（声・軌跡）」）: ラベルは `ロープ` → `軌跡` に改訂。
     結び目の拾い直しが失効し、周回ごとに色分けした軌跡だけが残る運用に変わったため。 */
  var ROPE_HUD = '軌跡';

  /* P4.12 項目1: 通路を覆う罠の案内（docs/notes.md「P4.12追加（罠の案内・HUD）」の正文）。
     画面下・「調べる」プロンプトとは別の行に出す（competing しない＝互いに消し合わない）。 */
  var TRAP_HINT = {
    wire: 'しゃがんで潜れ —— ワイヤー',
    sensor: '走るな —— センサー'
  };

  /* P4.14 項目1: セーブポイントの案内（正文 docs/notes.md「P4.14追加（セーブポイント・地図）」）。
     TRAP_HINT と同じ表示経路（#trap-hint）に出す。罠の案内（走るな／しゃがめ）は
     即応が要る警告なので、両方成立したときは罠の案内を優先する。 */
  var SAVE_HINT = 'セーブポイント —— 壁の端末を調べて記録しろ';

  /* 壁の掲示（docs/notes.md「掲示（短文・使い回し可のフレーバー）」の正文）。
   * P4.8: 配電順序・制御室・排水路・12秒開放の掲示は失効（該当の仕掛けが無い）。 */
  var SIGN_TEXT_BY_MAP = {
    area1: {
      sg_store: '保管庫　硝子片散乱　走行厳禁',
      sg_bulkhead: '非常隔壁 手動開放は解錠後のみ可 / 開放中は大音響に注意'
    },
    /* P5 エリア2（docs/notes.md「UI文言」の「掲示（飾り・使い回し可）」4種の正文） */
    area2: {
      sg_a2_main: '第三幹線 —— 水位注意',
      sg_a2_old: '立入禁止 旧坑道 崩落の恐れ',
      sg_a2_pump: 'ポンプ室 全停止中',
      sg_a2_settle: '沈殿槽 覗き込み禁止'
    }
  };
  var SIGN_TEXT = SIGN_TEXT_BY_MAP[MAP_ID] || SIGN_TEXT_BY_MAP.area1;

  /* P5 エリア接続: 到達パッドで出す画面（docs/notes.md「遷移画面」「エリア2クリア画面」の正文）。
     area1 は**クリア画面の代わりに遷移画面**（押すと escape.area=area2 を保存してページ再読込）、
     area2 は P6 までの仮のクリア画面（押すとタイトルへ）。 */
  var ENDING_BY_MAP = {
    area1: {
      title: '隔壁の向こう',
      body: '隔壁の先に、地上へ続く階段はなかった。\n' +
        'あったのは、錆びた梯子と、下から上がってくる水の匂いだけだ。\n' +
        '—— 降りるしかない。',
      button: '降りる',
      action: 'nextArea', next: 'area2'
    },
    area2: {
      title: '深部へ',
      body: '水門の先は、さらに下へ続いていた。\n（エリア3は制作中）',
      button: 'タイトルへ',
      action: 'title'
    }
  };

  var NOTE_RANGE = 2.4;
  var GIMMICK_RANGE = 2.6;
  var SIGN_RANGE = 3.2;
  var REGION_SIGN_RANGE = 3.0;
  var NOTE_GLOW_RANGE = 3.4;        /* 本物のメモの縁が淡く光り始める距離(m) */
  var FLASH_DUR = 1.9;              /* 応答表示の持続(s) */

  /* P4.14 セーブポイント（契約 §4「P4.14 再プレイ差し戻し」項目1） */
  var SAVE_RANGE = 2.4;             /* 記録端末を「調べる」ことのできる距離(m)。壁面からの直線 */
  var SAVE_NEAR_CELLS = 2;          /* 案内・地図への記入が起きる距離（マス。正文「2マス以内」） */
  var SAVE_HINT_COOLDOWN = 30.0;    /* 同じ端末で案内を出す間隔(s)。正文「30秒に1回まで」 */
  var SAVE_HINT_DUR = 3.4;          /* 案内の表示持続(s) */
  /* 端末の向き（壁の向き）→ 復帰時に向く方角(deg)。端末（緑のランプ）が正面に来る */
  var SAVE_YAW_DEG = { n: 0, s: 180, e: -90, w: 90 };

  /* P4.16 項目1: 研究員の日記の自動表示（契約 §4「P4.16 再プレイ差し戻し」項目1）。
     スタート部屋（＝spawn を含む「部屋」region）の外へ出た最初のフレームに1回だけ開く。
     ROOM_MAX は js/minimap.js の部屋判定と同じ値。minimap が居ない構成でも
     同じ規則で部屋を選べるようにここにも置く（判定の実体は minimap.roomRegions()）。 */
  var DIARY_ID_BY_MAP = { area1: 'a1_diary', area2: 'a2_diary1' };
  var DIARY_ID = DIARY_ID_BY_MAP[MAP_ID] || DIARY_ID_BY_MAP.area1;
  var ROOM_MAX_FALLBACK = 14;

  /* P5: セーブキーはマップ別（`escape.save.<mapId>.v2`）。
     area1 のキー名は従来と一字も変わらない＝既存のセーブがそのまま読める。 */
  var SAVE_KEY = (ESCAPE.saveKeyOf ? ESCAPE.saveKeyOf(MAP_ID) : 'escape.save.area1.v2');
  var SAVE_KEY_OLD = 'escape.save.area1.v1';   /* P4.7 以前のセーブ（読まずに消す） */

  /** 音響フックの共通口（P4.5）。音響モジュールが無くても落ちない */
  function sfx(name, p) {
    if (ESCAPE.audio && ESCAPE.audio.event) ESCAPE.audio.event(name, p);
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('touchstart', function (e) { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    el.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
  }

  /** 背景（紙の外側）のタップだけで閉じる結線。紙の中は既定のスクロールに任せる */
  function bindBackdropTap(el, inner, fn) {
    if (!el) return;
    var t0 = null;
    function inside(t) { return !!(inner && t && inner.contains(t)); }
    el.addEventListener('touchstart', function (e) {
      if (inside(e.target)) { t0 = null; return; }          /* 紙の中: スクロールを妨げない */
      e.preventDefault(); e.stopPropagation();
      var t = e.touches && e.touches[0];
      t0 = t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
    }, { passive: false });
    el.addEventListener('touchend', function (e) {
      if (inside(e.target) || !t0) return;
      e.preventDefault(); e.stopPropagation();
      var t = e.changedTouches && e.changedTouches[0];
      var moved = t ? Math.hypot(t.clientX - t0.x, t.clientY - t0.y) : 0;
      t0 = null;
      if (moved < 12) fn();
    }, { passive: false });
    el.addEventListener('mousedown', function (e) {
      if (inside(e.target)) return;
      e.preventDefault(); e.stopPropagation(); fn();
    });
  }

  var FACE = { n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0] };

  /* ================================================================
   * Progress
   * ============================================================== */
  function Progress(game) {
    this.game = game;
    this.dom = {
      prompt: document.getElementById('prompt'),
      objective: document.getElementById('objective'),
      ropeHud: document.getElementById('rope-hud'),
      trapHint: document.getElementById('trap-hint'),
      memoOverlay: document.getElementById('memo-overlay'),
      memoTitle: document.getElementById('memo-title'),
      memoBody: document.getElementById('memo-body'),
      endingOverlay: document.getElementById('ending-overlay'),
      endingTitle: document.getElementById('ending-title'),
      endingBody: document.getElementById('ending-body'),
      endingBtn: document.getElementById('ending-btn'),
      dark: document.getElementById('fx-dark')
      /* 【P4.18 項目3 失効】eraseBtn（プレイ画面の `データ全消去`）。
         データ消去はタイトル画面の `データを消す` へ移設（js/menu.js）。DOMも削除済み。 */
    };
    /* 近接したメモの縁の淡い光（本物のメモの見分け・契約 §4「メモの見分け」） */
    this.fx = new THREE.Group();
    this.fx.name = 'progress-fx';
    if (game.scene) game.scene.add(this.fx);
    this._geos = [];
    this._mats = [];
    this._buildNoteGlow();
    /* P4.16 項目1: 日記の自動表示のオン/オフ。製品は常に true。
       機械テストの台本歩行（walkCells 等）は「スタート部屋から歩いて出る」経路を
       何度も通るので、runAll の間だけ false にする（音の罠 g.traps.enabled と同じ扱い。
       自動表示そのものは専用スイート testP416Diary が実経路で検証する）。
       reset() では触らない＝g.reset() を挟んでも runAll の間ずっと止まったまま。 */
    this.diaryAuto = true;
    this.reset();
    this._bind();
  }

  Progress.prototype.reset = function () {
    this.flags = {};                         /* 汎用フラグ（既存テスト互換のため維持） */
    this.notesRead = Object.create(null);    /* {noteId: true} */
    this.signsRead = Object.create(null);    /* {regionSignId: true} */
    this.gimmick = {
      key: false,          /* 所長室の金庫から隔壁の鍵を得た */
      doorOpen: false      /* 北の隔壁を解錠した＝開放 */
    };
    this.cleared = false;
    this.clearedBy = null;                   /* 'main'（アリアドネ方式では正規1本のみ） */
    /* P4.14 項目1: セーブポイント。
       saved            … 記録済みの端末 {id:true}（セーブデータに永続）
       savePointsSeen   … 2マス以内に入って「発見」した端末 {id:true}（地図に四角で出る）
       checkpoint       … 現在の復帰地点の端末id（＝記録済みのうち最も奥。未記録なら null）。
                          【失効】旧「最後に踏んだチェックポイント」の意味は失効した。 */
    this.saved = Object.create(null);
    this.savePointsSeen = Object.create(null);
    this.savePointsSeenCount = 0;
    this.checkpoint = null;
    /* P4.16 項目1: 研究員の日記。diaryRead はセーブに永続する既読フラグ＝
       一度読んだら二度と自動では開かない（壁のメモからは何度でも読める）。
       _diaryArmed は「スポーンの部屋の中に居た」ことの記憶＝自動表示は
       **中→外の遷移**でしか起きない（reset 直後にいきなり外側へ置かれても開かない）。 */
    this.diaryRead = false;
    this._diaryArmed = false;
    /* P4.17 項目2: 物語ゲート（研究員の日記 2〜4）。
       storyRead     … セーブに永続する既読フラグ（id ごと）
       _storyQueue   … 「ゲートのマスに入った」記憶の待ち行列＝タイトル/捕獲/他のモーダル中は
                       保留し、開ける最初の機会に**入った順**で開く。保留中に次のゲートへ
                       進んでも前のぶんを落とさないよう配列で持つ。
       _storyCell    … 前フレームのマス（「入った最初のフレーム」を遷移として捉えるため）。
                       reset 直後は null ＝最初の評価を遷移として扱う（＝復帰でゲートのマスの
                       上に置かれた場合も取りこぼさない。日記1と違い「素通り禁止」が目的なので
                       出し損なう方を避ける）。 */
    this.storyRead = Object.create(null);
    this._storyQueue = [];
    this._storyCell = null;
    /* P5: 水路に初めて入った時の案内（正文「水の中では走れない」）は一度だけ */
    this.waterHinted = false;
    this._wasInWater = false;
    this._t = 0;
    this._saveHintT = 0;
    this._saveHintId = null;
    this._saveHintAt = Object.create(null);
    this.modal = null;                       /* null | 'memo' | 'ending' */
    this.memoId = null;
    this.darkLevel = 0;
    this._flashMsg = ''; this._flashT = 0;
    this._objText = '';
    this._trapHint = '';
    if (this.dom.trapHint) {
      this.dom.trapHint.textContent = '';
      this.dom.trapHint.classList.remove('show');
    }
    this._rebuildLookups();
    this._syncModalDom();
    this.dom._promptText = undefined;
    if (this._glow) this._glow.visible = false;
    this._glowLevel = 0;
    this._syncHud();
  };

  Progress.prototype._rebuildLookups = function () {
    var map = this.game.map, meta = (map && map.meta) || {};
    this.map = map;
    this._noteAt = Object.create(null);
    var notes = meta.notes || [];
    for (var i = 0; i < notes.length; i++) this._noteAt[notes[i].col + ',' + notes[i].row] = notes[i];
    /* P4.17 項目2: 物語ゲートの壁メモ（読み返し用）。js/maps/area1_story.js が area1 の定義へ
       焼いた分は上のループで拾える（＝既存の壁メモと同じ造形・同じ「調べる」経路）。
       焼けなかった構成（壁が '#' でない等）の保険として、ここでも meta.notes 相当として索引する。 */
    this._storyWallAt = Object.create(null);
    var sgs = this.storyGates();
    for (var sg = 0; sg < sgs.length; sg++) {
      var sw = sgs[sg].wall;
      if (!sw) continue;
      var swk = sw.col + ',' + sw.row;
      if (this._noteAt[swk]) continue;
      this._storyWallAt[swk] = { col: sw.col, row: sw.row, dir: sw.dir, id: sgs[sg].id, story: true };
    }
    this._gimmickAt = Object.create(null);
    var gm = meta.gimmicks || [];
    for (var j = 0; j < gm.length; j++) this._gimmickAt[gm[j].col + ',' + gm[j].row] = gm[j];
    /* P4.14: セーブポイント（旧チェックポイント6か所を転用）。
       進行順（＝スタートからの経路距離）と、壁面の端末の座標をここで1回だけ焼く。 */
    this.savePoints = this._buildSavePoints(meta);
    this._savePointById = Object.create(null);
    for (var k = 0; k < this.savePoints.length; k++) {
      this._savePointById[this.savePoints[k].id] = this.savePoints[k];
    }
    this._signAt = Object.create(null);
    var sg = meta.signs || [];
    for (var s = 0; s < sg.length; s++) this._signAt[sg[s].col + ',' + sg[s].row] = sg[s];
    this._regionSignAt = Object.create(null);
    var rs = meta.regionSigns || [];
    for (var r = 0; r < rs.length; r++) this._regionSignAt[rs[r].col + ',' + rs[r].row] = rs[r];
    this.regionSigns = rs;
    /* P4.16 項目1: スポーンの部屋（自動日記の発火境界）。マップを掴み直すたびに1回だけ焼く */
    this.spawnRoom = this._findSpawnRoom(meta);
  };

  /* ================================================================
   * P4.16 項目1: 研究員の日記の自動表示
   *
   * 「スポーンの部屋」= meta.spawn を含む **部屋** region のうち最も小さいもの。
   * 部屋の判定は js/minimap.js roomRegions()（帯ゾーン80×13・ランドマーク長廊下を除く）を
   * 唯一の実体として使い、minimap が居ない構成のためだけに同じ規則のフォールバックを持つ。
   * area1 では受入ホール（hall: 1,70〜9,76）が選ばれ、spawn(4,74) はその中にある。
   * ============================================================== */
  Progress.prototype._findSpawnRoom = function (meta) {
    var sp = meta && meta.spawn;
    if (!sp) return null;
    var mm = this.game.minimap;
    var rooms = (mm && mm.roomRegions) ? mm.roomRegions() : this._roomRegionsFallback(meta);
    var best = null, bestArea = Infinity;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (sp.col < r.c0 || sp.col > r.c1 || sp.row < r.r0 || sp.row > r.r1) continue;
      var area = (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1);
      if (area < bestArea) { bestArea = area; best = r; }
    }
    return best;
  };

  Progress.prototype._roomRegionsFallback = function (meta) {
    var regions = (meta && meta.regions) || [], lm = (meta && meta.landmarks) || [], out = [];
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      if (!r.zone) continue;
      var w = r.c1 - r.c0 + 1, h = r.r1 - r.r0 + 1;
      if (w > ROOM_MAX_FALLBACK || h > ROOM_MAX_FALLBACK || w < 2 || h < 2) continue;
      var isLm = false;
      for (var j = 0; j < lm.length; j++) if (lm[j].id === r.id) { isLm = true; break; }
      if (!isLm) out.push(r);
    }
    return out;
  };

  /** プレイヤーのマスがスポーンの部屋の中にいるか */
  Progress.prototype.inSpawnRoom = function () {
    var r = this.spawnRoom;
    if (!r) return true;                 /* 部屋が特定できない構成では発火させない */
    var p = this.game.player, c = p.col(), w = p.row();
    return (c >= r.c0 && c <= r.c1 && w >= r.r0 && w <= r.r1);
  };

  /** 自動表示を「今」出してよいか。タイトル中・捕獲演出中・他のモーダル中は保留する */
  Progress.prototype._diaryHeld = function () {
    var g = this.game;
    if (this.modal) return true;                                      /* 別のメモ/クリア画面 */
    if (ESCAPE.Title && ESCAPE.Title.blocking && ESCAPE.Title.blocking()) return true;
    if (g.cinematic && g.cinematic.active && g.cinematic.active()) return true;
    if (g.stealth && g.stealth.jail && g.stealth.jail.phase && g.stealth.jail.phase !== 'none') return true;
    return false;
  };

  /** 毎フレーム: スポーンの部屋の中に居た状態から**外へ出た最初のフレーム**に1回だけ開く。
   *
   *  契約の「出た瞬間」は状態ではなく**遷移**なので、部屋の中に居たこと（_diaryArmed）を
   *  前提にする。復帰・ワープのように部屋を通らずに外側から始まった場合は「出た」ではない
   *  ので開かない（次にスタート部屋へ戻って出た時に開く）。
   *  保留（タイトル中・捕獲演出中・他のモーダル中）の間は armed のまま持ち越す。 */
  Progress.prototype._checkDiary = function () {
    if (this.diaryRead) { this._diaryArmed = false; return false; }
    if (!this.diaryAuto) return false;   /* 機械テスト中の台本歩行では止める（下の注記） */
    if (!NOTE_TEXTS[DIARY_ID]) return false;
    if (this.inSpawnRoom()) { this._diaryArmed = true; return false; }
    if (!this._diaryArmed) return false; /* 部屋に居たことが無い＝「出た瞬間」ではない */
    if (this._diaryHeld()) return false; /* 保留。armed のまま次の機会に開く */
    this._diaryArmed = false;
    this.diaryRead = true;               /* _openMemo → save() の前に立てて永続させる */
    this._openMemo(DIARY_ID);
    return true;
  };

  /* ================================================================
   * P4.17 項目2: 物語形式の強制メモ（研究員の日記 2〜4）
   *
   * 契約 DESIGN.md「### P4.17 再プレイ差し戻し」項目2 / 正文 docs/notes.md「P4.17追加」。
   * 地点は js/maps/area1_story.js の ESCAPE.STORY_GATES（スタートからの経路距離で機械的に算出）。
   * 規則は日記1と同じ:
   *   ・ゲート地点のマスに**初めて入った最初のフレーム**に開く
   *   ・それぞれ初回のみ。既読はセーブに永続（壁のメモからは何度でも読み返せる）
   *   ・タイトル中・捕獲演出中・他のモーダル中は保留し、開ける最初の機会に開く
   *   ・開いている間は移動不可（modal の共通仕様＝js/game.js）
   *   ・runAll の台本歩行では diaryAuto=false で止める（専用スイートが実経路で検証する）
   * ============================================================== */

  /** その日記を読み終えているか。壁のメモで先に読んだ場合も既読として扱う（日記1と同じ） */
  Progress.prototype.storyGateRead = function (id) {
    return !!(this.storyRead[id] || this.notesRead[id]);
  };

  /** 現在のマップの物語ゲート（P5: マップ別。ESCAPE.STORY_GATES は現在マップの別名） */
  Progress.prototype.storyGates = function () {
    var byMap = ESCAPE.STORY_GATES_BY_MAP;
    var id = this.game.mapId;
    if (byMap && byMap[id]) return byMap[id];
    if (byMap) return [];
    return ESCAPE.STORY_GATES || [];
  };

  Progress.prototype._checkStoryGates = function () {
    if (!this.diaryAuto) return false;
    var gates = this.storyGates();
    if (!gates.length) return false;
    var p = this.game.player, c = p.col(), r = p.row(), key = c + ',' + r;
    if (key !== this._storyCell) {
      this._storyCell = key;                  /* ここが「マスに入った」遷移 */
      for (var i = 0; i < gates.length; i++) {
        var gt = gates[i];
        if (gt.col !== c || gt.row !== r) continue;
        if (!NOTE_TEXTS[gt.id] || this.storyGateRead(gt.id)) continue;
        if (this._storyQueue.indexOf(gt.id) < 0) this._storyQueue.push(gt.id);
      }
    }
    /* 保留が解けるまで待つ。解けたら**入った順**に1枚ずつ（1フレーム1枚）開く */
    while (this._storyQueue.length && this.storyGateRead(this._storyQueue[0])) this._storyQueue.shift();
    if (!this._storyQueue.length) return false;
    if (this._diaryHeld()) return false;      /* 保留。待ち行列のまま次の機会に開く */
    var id = this._storyQueue.shift();
    this.storyRead[id] = true;                /* _openMemo → save() の前に立てて永続させる */
    this._openMemo(id);
    return true;
  };

  /* ================================================================
   * P4.14 項目1: セーブポイント（契約 §4「P4.14 再プレイ差し戻し」項目1）
   *
   * 旧チェックポイント6か所（meta.checkpoints = a1_cp1〜cp6）をそのまま転用する。
   * 【失効】「マスを踏むと自動で記録＋効果音」「ロード時にチェックポイントへ配置」。
   *
   * データの読み方（js/maps/area1.js meta.checkpoints が唯一の真実）:
   *   col,row … 端末の**前に立つ歩行可能マス**／dir … そのマスから見た**壁の向き**
   *   tx,tz  … 壁面の中心（＝端末そのもの）のワールド座標。「調べる」の距離・向きはここで測る
   *   zone   … 帯（meta.bands）から引いた区画A〜F。地図の表示と報告用
   *   order  … **スタートからの経路距離（マス）**。大きいほど奥＝復帰地点として優先される
   *
   * 「奥」の決め方について（実装の判断・報告に明記した既知の妥協点）:
   *   契約は「区画の進行順（A→F＝スタートから奥）」と書くが、このマップの帯は北から
   *   E/F/D/B/C/A の順に並んでおり、記号の A→F 順では最北（＝鍵と出口がある最奥）の
   *   区画Eが5番目になってしまい「スタートから奥」と矛盾する。そこで**スタートからの
   *   実経路距離**を進行順の実体とした（結果の並びは A→B→C→D→F→E で、Eが最奥）。
   * ============================================================== */

  /** 素の歩行可能判定（牢の鉄格子などの runtime の通行止めを無視する＝進行順は静的） */
  function rawWalkable(map, col, row) {
    if (!map.inBounds(col, row)) return false;
    var d = ESCAPE.TILE_DEFS[map.tileAt(col, row)];
    return !!(d && d.walkable);
  }

  /** スタートからの経路距離（マス）。到達不能は -1 */
  function spawnDistMap(map) {
    var meta = map.meta || {}, sp = meta.spawn;
    var W = map.width, H = map.height;
    var d = new Int32Array(W * H);
    for (var i = 0; i < d.length; i++) d[i] = -1;
    if (!sp || !rawWalkable(map, sp.col, sp.row)) return d;
    d[sp.row * W + sp.col] = 0;
    var q = [sp.col, sp.row], head = 0;
    var D = [1, 0, -1, 0, 0, 1, 0, -1];
    while (head < q.length) {
      var c = q[head++], r = q[head++];
      var d0 = d[r * W + c];
      for (var k = 0; k < 8; k += 2) {
        var nc = c + D[k], nr = r + D[k + 1];
        if (!rawWalkable(map, nc, nr) || d[nr * W + nc] >= 0) continue;
        d[nr * W + nc] = d0 + 1;
        q.push(nc, nr);
      }
    }
    return d;
  }

  Progress.prototype._buildSavePoints = function (meta) {
    var map = this.map || this.game.map;
    var list = (meta && meta.checkpoints) || [];
    if (!list.length) return [];
    var dist = spawnDistMap(map), W = map.width, T = map.tileSize;
    var bands = (meta.bands) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var cp = list[i];
      var v = FACE[cp.dir] || FACE.n;
      var cc = map.cellCenter(cp.col, cp.row);
      /* P5: 区画は meta.regions（マスの矩形）から引く。帯構造でないマップ（area2）でも
         正しい区画になる。area1 は region の zone と帯の zone が一致するので値は不変。 */
      var zone = null;
      var rgs = meta.regions || [];
      for (var rg = 0; rg < rgs.length; rg++) {
        var q = rgs[rg];
        if (!q.zone) continue;
        if (cp.col >= q.c0 && cp.col <= q.c1 && cp.row >= q.r0 && cp.row <= q.r1) { zone = q.zone; break; }
      }
      for (var b = 0; zone === null && b < bands.length; b++) {
        if (cp.row >= bands[b].r0 && cp.row <= bands[b].r1) { zone = bands[b].zone; break; }
      }
      var dd = dist[cp.row * W + cp.col];
      out.push({
        id: cp.id, col: cp.col, row: cp.row, dir: cp.dir || 'n', zone: zone,
        tx: cc.x + v[0] * (T * 0.5), tz: cc.z + v[2] * (T * 0.5),
        yawDeg: (SAVE_YAW_DEG[cp.dir] === undefined) ? 0 : SAVE_YAW_DEG[cp.dir],
        order: (dd >= 0) ? dd : 0
      });
    }
    /* 手前 → 奥（同着は id 順）で並べておく。復帰地点は末尾側が勝つ */
    out.sort(function (a, b2) { return (a.order - b2.order) || (a.id < b2.id ? -1 : 1); });
    return out;
  };

  /** 現在の復帰地点。記録済みのうち**最も奥**（order 最大）。未記録ならスタート */
  Progress.prototype.respawnPoint = function () {
    var list = this.savePoints || [], best = null;
    for (var i = 0; i < list.length; i++) {
      if (!this.saved[list[i].id]) continue;
      if (!best || list[i].order > best.order) best = list[i];
    }
    if (best) {
      return { id: best.id, col: best.col, row: best.row, yawDeg: best.yawDeg,
        zone: best.zone, order: best.order, isSpawn: false };
    }
    var sp = (this.game.map.meta && this.game.map.meta.spawn) || { col: 1, row: 1, yawDeg: 0 };
    return { id: null, col: sp.col, row: sp.row, yawDeg: sp.yawDeg || 0,
      zone: null, order: 0, isSpawn: true };
  };

  /** this.checkpoint（＝復帰地点の端末id）を記録集合から引き直す */
  Progress.prototype._syncRespawn = function () {
    this.checkpoint = this.respawnPoint().id;
    return this.checkpoint;
  };

  Progress.prototype.isSavePointRecorded = function (id) { return !!this.saved[id]; };
  Progress.prototype.isSavePointSeen = function (id) { return !!this.savePointsSeen[id]; };

  /** プレイヤーを復帰地点へ置く（ロード時・捕獲からの復帰時の共通経路） */
  Progress.prototype._placeAtRespawn = function () {
    var rp = this.respawnPoint();
    var map = this.game.map, p = this.game.player;
    var c = map.cellCenter(rp.col, rp.row);
    p.x = c.x; p.z = c.z;
    p.y = map.floorYAt(p.x, p.z);
    p.yaw = (rp.yawDeg || 0) * Math.PI / 180;
    return rp;
  };

  /** 記録端末を「調べる」対象として探す（壁面からの距離＋見ている向き） */
  Progress.prototype._findSaveTerminal = function () {
    var p = this.game.player, T = ESCAPE.ENEMY_TUNING;
    var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    var list = this.savePoints || [], best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var dx = s.tx - p.x, dz = s.tz - p.z;
      var d = Math.hypot(dx, dz);
      if (d > SAVE_RANGE) continue;
      if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  };

  /** 「調べる」で記録する。記録済みなら `記録済み` を返すだけ（どちらも処理した扱い） */
  Progress.prototype._recordSavePoint = function (s) {
    if (this.saved[s.id]) { this._flash(UI_TEXT.savedAlready); return true; }
    this.saved[s.id] = true;
    if (!this.savePointsSeen[s.id]) { this.savePointsSeen[s.id] = true; this.savePointsSeenCount++; }
    this._syncRespawn();
    this._saveHintT = 0;                 /* 記録した端末の案内は即座に消す */
    sfx('checkpoint', {});
    this._flash(UI_TEXT.savedNow);
    this.save();
    return true;
  };

  /** 毎フレーム: 2マス以内で「発見」＋未記録なら案内（同じ端末は30秒に1回まで） */
  Progress.prototype._checkSavePoints = function (dt) {
    this._t += dt;
    if (this._saveHintT > 0) { this._saveHintT -= dt; if (this._saveHintT < 0) this._saveHintT = 0; }
    var g = this.game, p = g.player;
    var st = g.stealth;
    /* 捕獲シネマティック中・モーダル中は案内も発見もしない（中断安全） */
    if (this.modal) return;
    if (st && st.jail && st.jail.phase && st.jail.phase !== 'none') return;
    var col = p.col(), row = p.row();
    var list = this.savePoints || [], near = null, nearD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var dc = Math.abs(s.col - col), dr = Math.abs(s.row - row);
      var d = (dc > dr) ? dc : dr;
      if (d > SAVE_NEAR_CELLS) continue;
      if (!this.savePointsSeen[s.id]) { this.savePointsSeen[s.id] = true; this.savePointsSeenCount++; }
      if (this.saved[s.id]) continue;    /* 記録済みでは案内を出さない */
      if (d < nearD) { nearD = d; near = s; }
    }
    if (!near) return;
    if (this._saveHintId === near.id && this._saveHintT > 0) return;
    var last = this._saveHintAt[near.id];
    if (last !== undefined && this._t - last < SAVE_HINT_COOLDOWN) return;
    this._saveHintAt[near.id] = this._t;
    this._saveHintId = near.id;
    this._saveHintT = SAVE_HINT_DUR;
  };

  /** 案内の本文（表示中でなければ空文字） */
  Progress.prototype.saveHintText = function () {
    if (this._saveHintT <= 0 || !this._saveHintId) return '';
    if (this.saved[this._saveHintId]) return '';
    return SAVE_HINT;
  };

  Progress.prototype.modalOpen = function () { return !!this.modal; };
  /** 隔壁が開いているか（アリアドネ方式では鍵1本で解錠＝即開放） */
  Progress.prototype.unlocked = function () { return !!this.gimmick.doorOpen; };
  Progress.prototype.hasKey = function () { return !!this.gimmick.key; };

  /* ---------------- 対象の検出（メモ・仕掛け・銘板。ロッカー/板は Stealth の領分） ---------------- */
  Progress.prototype._findTarget = function () {
    var g = this.game, p = g.player, map = g.map, TILE = ESCAPE.TILE;
    var T = ESCAPE.ENEMY_TUNING;
    var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    var best = null, bestD = Infinity;
    var col = p.col(), row = p.row();
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var c = col + dc, r = row + dr;
        if (!map.inBounds(c, r)) continue;
        var tile = map.tileAt(c, r);
        var kind = null, entry = null;
        if (tile === TILE.NOTE) {
          entry = this._noteAt[c + ',' + r];
          if (entry) kind = 'note';
        } else if (this._storyWallAt[c + ',' + r] && map.isSolid(c, r)) {
          /* P4.17 項目2: タイルを NOTE に焼けなかった構成の保険（上の索引を参照） */
          entry = this._storyWallAt[c + ',' + r];
          kind = 'note';
        } else if (tile === TILE.GIMMICK || tile === TILE.DOOR) {
          /* P4.8: 失効した仕掛けのタイル（造形だけ残置）は meta に居ないので対象外になる。
             北の隔壁は DOOR タイルそのものが対象。 */
          entry = this._gimmickAt[c + ',' + r];
          if (entry) kind = 'gimmick';
        }
        if (!kind) continue;
        if (kind === 'gimmick' && this._gimmickDone(entry)) continue;
        var cc = map.cellCenter(c, r);
        var dx = cc.x - p.x, dz = cc.z - p.z;
        var d = Math.hypot(dx, dz);
        var range = (kind === 'note') ? NOTE_RANGE : GIMMICK_RANGE;
        if (d > range) continue;
        if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
        if (d < bestD) { bestD = d; best = { kind: kind, col: c, row: r, entry: entry }; }
      }
    }
    return best;
  };

  Progress.prototype._gimmickDone = function (entry) {
    switch (entry.role) {
      case 'safe': return this.gimmick.key;
      case 'bulkhead': return this.gimmick.doorOpen;
      default: return true;      /* 未知の役割＝失効した仕掛け。対象にしない */
    }
  };

  /** 壁の掲示（読むだけ） */
  Progress.prototype._findSign = function () {
    return this._findFacing(this._signAt, SIGN_RANGE);
  };
  /** 区画銘板（「調べる」で地図に記入される） */
  Progress.prototype._findRegionSign = function () {
    var s = this._findFacing(this._regionSignAt, REGION_SIGN_RANGE);
    if (s && this.signsRead[s.id]) return null;
    return s;
  };

  /** dir（＝読む側）を向いた壁の掲示物を探す共通処理 */
  Progress.prototype._findFacing = function (index, range) {
    var g = this.game, p = g.player, map = g.map;
    var T = ESCAPE.ENEMY_TUNING;
    var f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    var col = p.col(), row = p.row();
    var best = null, bestD = Infinity;
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var s = index[(col + dc) + ',' + (row + dr)];
        if (!s) continue;
        var v = FACE[s.dir] || FACE.n;
        var cc = map.cellCenter(s.col, s.row);
        var dx = cc.x - p.x, dz = cc.z - p.z;
        var d = Math.hypot(dx, dz);
        if (d > range) continue;
        if ((-dx) * v[0] + (-dz) * v[2] < 0) continue;      /* 板の裏側にいる */
        if (d > 0.2 && (f.x * dx + f.z * dz) / d < T.interactDot) continue;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    return best;
  };

  /* ---------------- 「調べる」（stepFrame から呼ばれる。処理したら true） ---------------- */
  Progress.prototype.onInteract = function () {
    if (this.modal === 'memo') { this._closeModal(); return true; }
    /* P5: 到達パッドの画面は「調べる」でも進める（タップ/クリックと同じ経路） */
    if (this.modal === 'ending') { this.onEndingTap(); return true; }

    /* 【P4.13 失効】ここにあった「落ちたロープの結び目を拾って結ぶ」処理は失効。
       捕獲は Rope 側で「周回ごとの軌跡」に切り替わり、復帰後は拾い直し不要で
       自動的にスタートから新しい周が始まる（js/rope.js dropKnot() を参照）。 */

    var t = this._findTarget();
    if (t) {
      if (t.kind === 'note') { this._openMemo(t.entry.id); return true; }
      return this._useGimmick(t);
    }
    /* P4.14 項目1: 壁面の記録端末（セーブポイント） */
    var sp = this._findSaveTerminal();
    if (sp) return this._recordSavePoint(sp);
    var rs = this._findRegionSign();
    if (rs) { this._readRegionSign(rs); return true; }
    return false;
  };

  Progress.prototype._useGimmick = function (t) {
    var role = t.entry.role;
    var c = this.game.map.cellCenter(t.col, t.row);

    /* 所長室の金庫 → 隔壁の鍵 */
    if (role === 'safe') {
      if (!this.gimmick.key) {
        this.gimmick.key = true;
        sfx('terminalOk', {});
        ESCAPE.noise.emit(c.x, c.z, ESCAPE.ENEMY_TUNING.gimmickNoiseRadius, 'safe');
        this._flash(UI_TEXT.keyGot);
        this.save();
      }
      return true;
    }
    /* 北の隔壁 */
    if (role === 'bulkhead') {
      if (!this.gimmick.key) { this._flash(UI_TEXT.bulkheadLocked); sfx('handleCreak', { x: c.x, z: c.z }); return true; }
      if (!this.gimmick.doorOpen) {
        this.gimmick.doorOpen = true;
        sfx('doorRoar', { x: c.x, z: c.z });
        ESCAPE.noise.emit(c.x, c.z, ESCAPE.ENEMY_TUNING.hearMax, 'bulkhead');
        /* P5 エリア2: 正文「ハンドルを嵌めて回す」→ 画面表示『水門が上がった』。
           area1 は UI_TEXT.doorOpened を持たない＝表示なし（挙動不変）。 */
        if (UI_TEXT.doorOpened) this._flash(UI_TEXT.doorOpened);
        this.save();
      }
      return true;
    }
    return true;
  };

  /** 区画銘板を読む → 地図に A〜F と施設名が記入される */
  Progress.prototype._readRegionSign = function (s) {
    this.signsRead[s.id] = true;
    if (this.game.minimap) this.game.minimap.learnZone(s.zone);
    sfx('noteOpen', {});
    this._flash(zoneLabel(s.zone));
    this.save();
    return true;
  };

  /* ---------------- 毎フレーム ---------------- */
  Progress.prototype.step = function (dt) {
    if (this._flashT > 0) { this._flashT -= dt; if (this._flashT < 0) this._flashT = 0; }
    /* 【P4.12 失効】ここにあった「ロープが張った」の画面表示は、ロープ無制限化で失効した。 */
    /* P4.14: セーブポイントの発見と案内（【失効】旧「マスを踏むと自動で記録＋効果音」） */
    this._checkSavePoints(dt);
    /* P4.16 項目1: スタート部屋を出た最初のフレームに研究員の日記を自動で開く（1回・既読は永続） */
    this._checkDiary();
    /* P4.17 項目2: 進行路上の3地点で日記2〜4を強制表示（それぞれ初回のみ・既読は永続） */
    this._checkStoryGates();
    /* P5: 水路に初めて入った時だけ「水の中では走れない」を出す */
    this._checkWater();
    this._checkClear();
    this._updateNoteGlow(dt);
    this._updatePrompt();
    this._updateObjective();
    this._updateRopeHud();
    this._updateTrapHint();
    this._syncHud();
  };

  /** P5 水路の案内（docs/notes.md「水路に入った時（一度だけ・短く）」の正文）。
   *  水路へ**入った遷移**で1回だけ。area1 には TILE.WATER が無いので何も起きない。 */
  Progress.prototype._checkWater = function () {
    var p = this.game.player;
    var now = !!(p.inWaterNow && p.inWaterNow());
    var entered = now && !this._wasInWater;
    this._wasInWater = now;
    if (!entered || this.waterHinted || this.modal) return false;
    if (!UI_TEXT.waterNoRun) return false;
    this.waterHinted = true;
    this._flash(UI_TEXT.waterNoRun);
    return true;
  };

  Progress.prototype._checkClear = function () {
    if (this.cleared) return;
    var g = this.game, meta = g.map.meta;
    var col = g.player.col(), row = g.player.row();
    if (!this.gimmick.doorOpen) return;
    if (!meta.exitPad || col !== meta.exitPad.col || row !== meta.exitPad.row) return;
    this.cleared = true;
    this.clearedBy = 'main';
    this._openEnding();
    this.save();
  };

  Progress.prototype._updatePrompt = function () {
    var s = '';
    if (this._flashT > 0) {
      s = this._flashMsg || '';
    } else if (!this.modal) {
      /* 【P4.13 失効】ここにあった「結び目が近ければ拾って結ぶ」の分岐は失効。 */
      var t = this._findTarget();
      if (t) {
        s = (t.kind === 'note') ? UI_TEXT.note : this._gimmickPrompt(t.entry);
      } else {
        /* P4.14: 記録端末は記録済みでもプロンプトを出す（調べると `記録済み` が返る） */
        var stm = this._findSaveTerminal();
        if (stm) s = UI_TEXT.savePoint;
        else {
          var rs = this._findRegionSign();
          if (rs) s = UI_TEXT.regionSign;
          else {
            var sg = this._findSign();
            if (sg) s = SIGN_TEXT[sg.id] || '';
          }
        }
      }
    }
    if (!s) return; /* 何も無ければ Stealth が書いた値をそのまま残す */
    var el = this.dom.prompt;
    /* 比較は「自分のキャッシュ」ではなく実DOMに対して行う。
       Stealth も同じ #prompt を毎フレーム書くため、自前キャッシュだけで判定すると
       「Stealth が空文字で上書き → Progress はキャッシュ一致で書き直さない」で
       プロンプトが消えたままになる（P4.7 の実機確認で発覚）。 */
    if (el && el.textContent !== s) el.textContent = s;
    this.dom._promptText = s;
  };

  Progress.prototype._gimmickPrompt = function (e) {
    switch (e.role) {
      case 'safe': return UI_TEXT.safe;
      case 'bulkhead': return this.gimmick.key ? UI_TEXT.bulkheadUnlock : UI_TEXT.bulkheadLook;
      default: return '';
    }
  };

  /** 目的表示（画面上部1行・正文4種）。メモ・鍵取得・ロープ張りで更新される */
  Progress.prototype.objective = function () {
    var rope = this.game.rope;
    /* 【P4.13 失効】ここにあった「結び目が外れていたら戻る」の分岐は失効。
       復帰後は自動でスタートから新しい周が始まるため、通常の目的（鍵／隔壁）へ
       そのまま戻る。 */
    /* P4.12: 赤（＝大きな遠回り）に入った直後だけ目的表示を差し替える。
       赤の理由は遠回り率のみ＝分岐は1本（旧「余裕不足」の ropeShort は失効）。 */
    if (rope && rope.redT > 0) return OBJECTIVE.ropeDetour;
    /* P5 エリア2: 水門を開けた後の3段目（area1 は doorOpen を持たない＝挙動不変） */
    if (OBJECTIVE.doorOpen && this.gimmick.doorOpen) return OBJECTIVE.doorOpen;
    /* 鍵を得たら以後はずっとこの行（クリア画面が出た後も戻さない） */
    if (this.gimmick.key) return OBJECTIVE.haveKey;
    return OBJECTIVE.findKey;
  };

  Progress.prototype._updateObjective = function () {
    var el = this.dom.objective;
    if (!el) return;
    var s = this.objective();
    if (el.textContent !== s) el.textContent = s;
    var warn = (s === OBJECTIVE.ropeDetour);
    if (el._taut !== warn) { el.classList.toggle('taut', warn); el._taut = warn; }
    this._objText = s;
  };

  /* P4.12 ロープ張力インジケータ＝方向判定（DESIGN.md §4「P4.12」項目4）。
   * 表示は `ロープ` のラベルだけ・状態は色（緑/黄/赤）で示す。
   * 【失効】余裕(m)の表示。GPS的な矢印は今も出さない（手探りを壊さない）。 */
  Progress.prototype.ropeHudText = function () {
    var rope = this.game.rope;
    if (!rope) return '';
    return ROPE_HUD;
  };
  Progress.prototype.ropeHudState = function () {
    var rope = this.game.rope;
    if (!rope) return 'loose';
    return rope.tension().state;
  };
  Progress.prototype._updateRopeHud = function () {
    var el = this.dom.ropeHud;
    if (!el) return;
    var txt = this.ropeHudText();
    if (el.textContent !== txt) el.textContent = txt;
    var st = this.ropeHudState();
    if (el._st !== st) {
      el.className = st;
      el._st = st;
    }
  };

  /* ---------------- P4.12 項目1: 通路を覆う罠の案内 ----------------
   * 契約 §4「P4.12 再プレイ差し戻し」項目1 / 正文 docs/notes.md「P4.12追加（罠の案内・HUD）」。
   *   ワイヤー  … **立位**で 2.5m 以内 → `しゃがんで潜れ —— ワイヤー`（しゃがみ中は消える）
   *   センサー  … **走行中**に 2.5m 以内 → `走るな —— センサー`
   * 判定はプレイヤー側の状態（しゃがみ／走り）と距離だけ。罠の表の走査は js/traps.js が持つ。
   * 「調べる」プロンプト（#prompt）とは**別のDOM行**に出すので互いを消し合わない。
   * 優先順位: 近い方を1つだけ。モーダル中・演出中は出さない。 */
  Progress.prototype.trapHintKind = function () {
    if (this.modal) return null;
    var tr = this.game.traps;
    if (!tr || !tr.hintKind) return null;
    return tr.hintKind();
  };
  Progress.prototype.trapHintText = function () {
    var k = this.trapHintKind();
    return k ? (TRAP_HINT[k] || '') : '';
  };
  /** #trap-hint に実際に出る1行。罠の案内（即応が要る警告）が最優先、次にセーブポイント案内 */
  Progress.prototype.hintLineText = function () {
    if (this.modal) return '';
    return this.trapHintText() || this.saveHintText();
  };
  Progress.prototype._updateTrapHint = function () {
    var el = this.dom.trapHint;
    if (!el) return;
    var s = this.hintLineText();
    if (this._trapHint === s) return;
    this._trapHint = s;
    el.textContent = s;
    el.classList.toggle('show', !!s);
  };

  /* ---------------- 本物のメモの見分け（近接で縁が淡く光る） ---------------- */
  Progress.prototype._buildNoteGlow = function () {
    var geo = new THREE.PlaneGeometry(0.70, 0.92);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffe9b4, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true
    });
    this._geos.push(geo);
    this._mats.push(mat);
    this._glow = new THREE.Mesh(geo, mat);
    this._glow.visible = false;
    this._glowMat = mat;
    this.fx.add(this._glow);
  };

  /** 最寄りの「本物のメモ」を探して、その壁面に淡い光を出す */
  Progress.prototype._updateNoteGlow = function (dt) {
    var g = this.game, p = g.player, map = g.map;
    var best = null, bd = Infinity;
    var col = p.col(), row = p.row();
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var e = this._noteAt[(col + dc) + ',' + (row + dr)];
        if (!e) continue;
        var cc = map.cellCenter(e.col, e.row);
        var d = Math.hypot(cc.x - p.x, cc.z - p.z);
        if (d < bd) { bd = d; best = e; }
      }
    }
    var want = 0;
    if (best && bd <= NOTE_GLOW_RANGE) {
      want = clamp(1 - (bd - NOTE_RANGE) / (NOTE_GLOW_RANGE - NOTE_RANGE), 0, 1);
      var cc2 = map.cellCenter(best.col, best.row);
      /* 面の向き＝メモのマスからプレイヤー側へ出ている歩行可能な向き */
      var n = this._noteFace(best);
      this._glow.position.set(
        cc2.x + n[0] * (map.tileSize * 0.5 + 0.028), 1.45 + map.cellFloorY(best.col, best.row),
        cc2.z + n[2] * (map.tileSize * 0.5 + 0.028));
      this._glow.rotation.set(0, Math.atan2(n[0], n[2]), 0);
    }
    this._glowLevel += (want - this._glowLevel) * clamp(7.0 * dt, 0, 1);
    if (this._glowLevel < 0.004) this._glowLevel = 0;
    var vis = this._glowLevel > 0;
    if (this._glow.visible !== vis) this._glow.visible = vis;
    /* 淡く脈打つ（ゲーム内時刻駆動＝__pumpでも同じ絵になる） */
    this._glowMat.opacity = this._glowLevel * (0.16 + 0.09 * (0.5 + 0.5 * Math.sin(g.simTime * 1.9)));
  };

  Progress.prototype._noteFace = function (e) {
    var map = this.game.map, p = this.game.player;
    var best = [0, 0, 1], bd = Infinity;
    var D = [[1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]]];
    for (var i = 0; i < 4; i++) {
      var nc = e.col + D[i][0], nr = e.row + D[i][1];
      if (!map.isWalkable(nc, nr)) continue;
      var c = map.cellCenter(nc, nr);
      var d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd) { bd = d; best = D[i][2]; }
    }
    return best;
  };

  /* ---------------- HUD ---------------- */
  Progress.prototype._syncHud = function () {
    var d = this.dom;
    if (d.dark) {
      var a = this.darkLevel.toFixed(3);
      if (d.dark._a !== a) { d.dark.style.opacity = a; d.dark._a = a; }
    }
  };

  /* ---------------- モーダル: メモ ---------------- */
  Progress.prototype._openMemo = function (id) {
    var txt = NOTE_TEXTS[id];
    if (!txt) return;
    this.notesRead[id] = true;
    /* P4.16 項目1: 壁のメモとして先に読んだ場合も既読にする＝部屋を出た直後に
       同じ日記をもう一度突きつけない（自動表示は「素通り禁止」のための保険）。 */
    if (id === DIARY_ID) this.diaryRead = true;
    this.modal = 'memo';
    this.memoId = id;
    if (this.dom.memoTitle) this.dom.memoTitle.textContent = txt.title;
    if (this.dom.memoBody) this.dom.memoBody.textContent = txt.body;
    sfx('noteOpen', {});
    this._syncModalDom();
    this.save();
  };

  /* ---------------- モーダル: 到達パッドの画面（遷移 / クリア仮） ----------------
   * P5 エリア接続: area1 は「エンディング画面の代わりに遷移画面」、area2 は仮のクリア画面。
   * 正文は docs/notes.md「遷移画面」「エリア2クリア画面」。DOM は #ending-overlay を
   * そのまま使い回す（見出し・本文・ボタンだけ差し替える）。 */
  Progress.prototype.endingSpec = function () {
    return ENDING_BY_MAP[this.game.mapId] || null;
  };

  Progress.prototype._openEnding = function () {
    var spec = this.endingSpec();
    var d = this.dom;
    if (spec) {
      if (d.endingTitle) d.endingTitle.textContent = spec.title;
      if (d.endingBody) d.endingBody.textContent = spec.body;
      if (d.endingBtn) d.endingBtn.textContent = spec.button;
    }
    this.modal = 'ending';
    this._syncModalDom();
  };

  /** 到達パッドの画面のボタン。area1＝次のエリアへ（保存＋再読込）／area2＝タイトルへ */
  Progress.prototype.onEndingTap = function () {
    if (this.modal !== 'ending') return false;
    var spec = this.endingSpec();
    if (!spec) return false;
    if (spec.action === 'nextArea') {
      this.endingAdvanced = spec.next;          /* 機械テストが読む（再読込を差し替えられる） */
      if (this.reloadPage) { if (ESCAPE.setArea) ESCAPE.setArea(spec.next); this.reloadPage(); }
      else if (ESCAPE.gotoArea) ESCAPE.gotoArea(spec.next);
      return true;
    }
    /* タイトルへ（進行は記録済みのまま残す＝タイトルは `続きから` を出す） */
    this.modal = null;
    this._syncModalDom();
    this.save();
    if (ESCAPE.Menu && ESCAPE.Menu.backToTitle) ESCAPE.Menu.backToTitle();
    else if (ESCAPE.Title && ESCAPE.Title.show) ESCAPE.Title.show();
    return true;
  };

  Progress.prototype._closeModal = function () {
    if (this.modal === 'ending') return; /* クリア画面は自然には閉じない */
    if (this.modal === 'memo') sfx('noteClose', {});
    this.modal = null;
    this._syncModalDom();
  };
  /** タップ/E/Esc いずれからも同じ経路で閉じる */
  Progress.prototype.onCloseTap = function () {
    if (this.modal === 'memo') this._closeModal();
  };

  Progress.prototype._syncModalDom = function () {
    var d = this.dom;
    if (d.memoOverlay) d.memoOverlay.classList.toggle('show', this.modal === 'memo');
    if (d.endingOverlay) d.endingOverlay.classList.toggle('show', this.modal === 'ending');
  };

  Progress.prototype._flash = function (msg) {
    this._flashMsg = msg;
    this._flashT = FLASH_DUR;
  };

  /* ---------------- 3回目の捕獲＝エリアリセットとの整合 ---------------- */
  /** 契約 §4: エリア最初から。地図の踏破は消え、ロープの軌跡は世界に残る。
   *  鍵と読んだメモ（＝知識）は保持する（牢送りの「進行状態は保持」の継承）。 */
  Progress.prototype.onAreaReset = function () {
    /* P4.14 項目1: 3回目の捕獲＝食われた。セーブポイントの記録も**全消去**し、
       復帰地点はスタートへ戻る（地図での発見済み表示も消える）。 */
    this.saved = Object.create(null);
    this.savePointsSeen = Object.create(null);
    this.savePointsSeenCount = 0;
    this._saveHintAt = Object.create(null);
    this._saveHintT = 0;
    this._saveHintId = null;
    this.checkpoint = null;
    this.modal = null;
    this._flashT = 0;
    this._syncModalDom();
    if (this.game.minimap) this.game.minimap.onAreaReset();
    if (this.game.rope) this.game.rope.onAreaReset();
    this.save();
  };

  /* ---------------- セーブ / ロード / データ全消去 ---------------- */
  Progress.prototype.save = function () {
    try {
      var data = {
        v: 4, mapId: this.game.mapId,
        /* P4.14: 記録済み／発見済みのセーブポイント。checkpoint は復帰地点の端末id
           （旧セーブとの後方互換のためキー名はそのまま）。 */
        checkpoint: this.checkpoint,
        savePoints: Object.keys(this.saved),
        savePointsSeen: Object.keys(this.savePointsSeen),
        gimmick: { key: this.gimmick.key, doorOpen: this.gimmick.doorOpen },
        notesRead: Object.keys(this.notesRead),
        signsRead: Object.keys(this.signsRead),
        /* P4.16 項目1: 日記の自動表示は1回きり。既読はセーブに永続する */
        diaryRead: this.diaryRead,
        /* P4.17 項目2: 物語ゲート（日記2〜4）の既読。id ごとに永続する */
        storyRead: Object.keys(this.storyRead),
        cleared: this.cleared,
        rope: this.game.rope ? this.game.rope.save() : null,
        map: this.game.minimap ? this.game.minimap.save() : null
      };
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* privateモード等で保存できない環境は無視する */ }
  };

  /** 起動時1回だけ呼ぶ。セーブがあれば鍵・地図・ロープ・位置を復元する */
  Progress.prototype.load = function () {
    var data = null;
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || data.mapId !== this.game.mapId) return false;
    if (data.gimmick) {
      this.gimmick.key = !!data.gimmick.key;
      this.gimmick.doorOpen = !!data.gimmick.doorOpen;
    }
    var nr = data.notesRead || [];
    for (var i = 0; i < nr.length; i++) this.notesRead[nr[i]] = true;
    var sr = data.signsRead || [];
    for (var j = 0; j < sr.length; j++) this.signsRead[sr[j]] = true;
    /* P4.16 項目1: 既読フラグ。旧セーブ（diaryRead 無し）は「壁のメモとして読んでいれば既読」
       として拾う＝日記を読み終えた人に二度目の自動表示をしない。 */
    this.diaryRead = !!data.diaryRead || !!this.notesRead[DIARY_ID];
    /* P4.17 項目2: 物語ゲートの既読。旧セーブ（storyRead 無し）は空＝未読のまま壊れない。
       壁のメモとして読んでいれば storyGateRead() が notesRead 側で既読と判定する。 */
    var st = data.storyRead || [];
    for (var s3 = 0; s3 < st.length; s3++) this.storyRead[st[s3]] = true;
    this.cleared = !!data.cleared;
    if (this.game.minimap && data.map) this.game.minimap.load(data.map);
    /* P4.14: 記録済みセーブポイント。旧セーブ（v3以前）は checkpoint に文字列が入っている
       だけなので、それを「1本だけ記録済み」として読む＝旧セーブでも壊れない。 */
    var rec = data.savePoints;
    if (!rec && data.checkpoint) rec = [data.checkpoint];
    rec = rec || [];
    for (var s2 = 0; s2 < rec.length; s2++) {
      if (this._savePointById[rec[s2]]) this.saved[rec[s2]] = true;
    }
    var seen = data.savePointsSeen || rec;
    for (var s3 = 0; s3 < seen.length; s3++) {
      if (this._savePointById[seen[s3]] && !this.savePointsSeen[seen[s3]]) {
        this.savePointsSeen[seen[s3]] = true;
        this.savePointsSeenCount++;
      }
    }
    this._syncRespawn();
    /* 【失効】旧「ロード時はチェックポイントへ配置」。復帰地点（＝最も奥の記録済み端末）へ置く */
    if (this.checkpoint) this._placeAtRespawn();
    /* ロープは位置の復元より後（stack の先頭＝現在地の整合を保つ） */
    if (this.game.rope && data.rope) this.game.rope.load(data.rope);
    return true;
  };

  /** 契約 §2「永続フラグには必ずリセット経路」。暫定UI（設定/タイトル前）から呼ぶ */
  Progress.prototype.eraseAllData = function () {
    try {
      /* P5: 全エリアの保存 ＋ 現在エリアの記憶（escape.area）を消す */
      var keys = ESCAPE.saveKeysAll ? ESCAPE.saveKeysAll() : [SAVE_KEY];
      for (var i = 0; i < keys.length; i++) global.localStorage.removeItem(keys[i]);
      global.localStorage.removeItem(SAVE_KEY);
      global.localStorage.removeItem(SAVE_KEY_OLD);
      if (ESCAPE.AREA_KEY) global.localStorage.removeItem(ESCAPE.AREA_KEY);
    } catch (e) { /* 無視 */ }
    if (ESCAPE.audio && ESCAPE.audio.eraseSettings) ESCAPE.audio.eraseSettings();
    this.game.reset();
  };

  /* ---------------- DOM結線（コンストラクタから1回だけ） ---------------- */
  Progress.prototype._bind = function () {
    var self = this;
    /* P4.18 追補（メイン修正）: スマホでメモをスクロールしようとすると最初のタップで閉じていた。
       閉じるのは「紙の外側のタップ」と `閉じる` ボタンだけにし、紙の中は指を動かしてスクロールできるようにする。 */
    bindBackdropTap(this.dom.memoOverlay, document.getElementById('memo-paper'), function () { self.onCloseTap(); });
    bindTap(document.getElementById('memo-close'), function () { self.onCloseTap(); });
    /* P5: 到達パッドの画面のボタン（`降りる` / `タイトルへ`）。背景タップでは進めない */
    bindTap(document.getElementById('ending-btn'), function () { self.onEndingTap(); });

    /* 【P4.18 項目3 失効】プレイ画面の `データ全消去` の結線（window.confirm 経由）。
       消去はタイトルの `データを消す` → 既存モーダル様式の確認 → eraseAllData()（js/menu.js）。 */

    global.addEventListener('keydown', function (e) {
      if (e.code === 'Escape') self.onCloseTap();
    });
  };

  ESCAPE.Progress = Progress;
  ESCAPE.PROGRESS_NOTE_TEXTS = NOTE_TEXTS;
  ESCAPE.PROGRESS_UI_TEXT = UI_TEXT;
  ESCAPE.PROGRESS_OBJECTIVE = OBJECTIVE;
  ESCAPE.PROGRESS_TRAP_HINT = TRAP_HINT;
  ESCAPE.PROGRESS_SAVE_HINT = SAVE_HINT;
  ESCAPE.PROGRESS_SAVE_CONST = {
    SAVE_RANGE: SAVE_RANGE, SAVE_NEAR_CELLS: SAVE_NEAR_CELLS,
    SAVE_HINT_COOLDOWN: SAVE_HINT_COOLDOWN, SAVE_HINT_DUR: SAVE_HINT_DUR
  };
  ESCAPE.PROGRESS_ROPE_HUD = ROPE_HUD;
  ESCAPE.PROGRESS_SIGN_TEXT = SIGN_TEXT;
  ESCAPE.ZONE_NAMES = ZONE_NAMES;
  ESCAPE.zoneLabel = zoneLabel;
  ESCAPE.PROGRESS_SAVE_KEY = SAVE_KEY;
  /* P5: マップ別の表（機械テストと他モジュールが引く） */
  ESCAPE.PROGRESS_NOTE_TEXTS_BY_MAP = NOTE_TEXTS_BY_MAP;
  ESCAPE.PROGRESS_UI_TEXT_BY_MAP = UI_TEXT_BY_MAP;
  ESCAPE.PROGRESS_OBJECTIVE_BY_MAP = OBJECTIVE_BY_MAP;
  ESCAPE.PROGRESS_SIGN_TEXT_BY_MAP = SIGN_TEXT_BY_MAP;
  ESCAPE.ZONE_NAMES_BY_MAP = ZONE_NAMES_BY_MAP;
  ESCAPE.PROGRESS_DIARY_ID_BY_MAP = DIARY_ID_BY_MAP;
  ESCAPE.PROGRESS_ENDING_BY_MAP = ENDING_BY_MAP;
  ESCAPE.PROGRESS_MAP_ID = MAP_ID;
  /* P4.16 項目1: 自動表示する日記のid（機械テストが参照する） */
  ESCAPE.PROGRESS_DIARY_ID = DIARY_ID;

  /* 検証フック（機械テスト・E2E用）。ESCAPE.game.progress への遅延参照のみ。 */
  global.__progressDebug = {
    get: function () { return ESCAPE.game && ESCAPE.game.progress; },
    info: function () {
      var pr = ESCAPE.game && ESCAPE.game.progress;
      if (!pr) return null;
      return {
        modal: pr.modal,
        key: pr.gimmick.key, doorOpen: pr.gimmick.doorOpen,
        checkpoint: pr.checkpoint, cleared: pr.cleared, clearedBy: pr.clearedBy,
        notesRead: Object.keys(pr.notesRead), signsRead: Object.keys(pr.signsRead),
        objective: pr.objective(), prompt: pr.dom.prompt ? pr.dom.prompt.textContent : '',
        ropeHud: pr.ropeHudText(), ropeState: pr.ropeHudState(),
        trapHint: pr.trapHintText(), trapHintKind: pr.trapHintKind(),
        hintLine: pr.hintLineText(), saveHint: pr.saveHintText(),
        saved: Object.keys(pr.saved), seen: Object.keys(pr.savePointsSeen),
        respawn: pr.respawnPoint(),
        /* P4.16 項目1: 日記の自動表示 */
        mapId: pr.game.mapId, waterHinted: pr.waterHinted,
        inWater: !!(pr.game.player.inWaterNow && pr.game.player.inWaterNow()),
        diaryRead: pr.diaryRead, inSpawnRoom: pr.inSpawnRoom(),
        diaryArmed: pr._diaryArmed, diaryAuto: pr.diaryAuto,
        spawnRoom: pr.spawnRoom ? pr.spawnRoom.id : null
      };
    }
  };
})(window);
