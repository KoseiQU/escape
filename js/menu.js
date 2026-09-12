/* ESCAPE — P4.18 項目3: メニュー（プレイ画面の `メニューに戻る` ／ タイトルの `データを消す`）
 * 契約 DESIGN.md §4「P4.18 iPhone実機評」項目3
 * 正文 docs/notes.md「P4.18追加（メニュー・地図・起床）」（一字一句変更禁止）
 *
 * やること:
 *   1 プレイ画面の左上（＝画面**上部**。スマホは下部だと誤タップが多いという実機評）に
 *     `メニューに戻る`。押すと確認 → タイトルへ。進行はセーブ済みのまま残す
 *     （＝タイトルは `続きから` が出る状態）。PC は Esc でも開く。
 *   2 タイトル画面（メインメニュー）に `データを消す`。押すと確認 → 記録を全消去。
 *   3 確認ダイアログは既存のモーダル様式（#memo-overlay / #gameover-overlay と同じ
 *     .modal-overlay）に揃える。1枚を2用途で使い回す（文言だけ差し替え）。
 *
 * 【失効】プレイ画面の `データ全消去`（#btn-erase）。DOM ごと削除した。
 *
 * 他モジュールとの結線（このファイルからは既存の公開経路しか呼ばない）:
 *   - 消去      … ESCAPE.game.progress.eraseAllData()（P4 からある経路）
 *   - タイトル  … ESCAPE.Title.show()
 *   - 走るトグル… ESCAPE.game.input.releaseRun('title')（P4.18 項目2 の自動解除）
 *   - 起床演出  … ESCAPE.Wake.cancel()（演出の途中でタイトルへ戻れる）
 */
(function (global) {
  'use strict';
  var ESCAPE = global.ESCAPE;

  /* 正文（docs/notes.md「P4.18追加（メニュー・地図・起床）」）。ここが唯一の持ち場 */
  var TEXT = {
    menuBtn: 'メニューに戻る',
    menuConfirm: 'メニューに戻る —— 進行は記録されている',
    menuYes: '戻る',
    menuNo: '続ける',
    eraseBtn: 'データを消す',
    eraseConfirm: '記録をすべて消す —— 元には戻せない',
    eraseYes: '消す',
    eraseNo: 'やめる'
  };

  function bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation(); fn();
    }, { passive: false });
    el.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
  }

  function Menu() {
    this.kind = null;        /* null | 'menu' | 'erase' */
    this.dom = null;
    this.backs = 0;          /* タイトルへ戻った回数（機械テスト用） */
    this.erases = 0;         /* 消去した回数 */
    this.cancels = 0;        /* やめる/続ける の回数 */
    this._bound = false;
  }

  Menu.prototype.install = function () {
    var d = this.dom = {
      btnMenu: document.getElementById('btn-menu'),
      overlay: document.getElementById('confirm-overlay'),
      text: document.getElementById('confirm-text'),
      yes: document.getElementById('confirm-yes'),
      no: document.getElementById('confirm-no'),
      titleErase: document.getElementById('title-erase')
    };
    if (d.btnMenu) d.btnMenu.textContent = TEXT.menuBtn;
    if (d.titleErase) d.titleErase.textContent = TEXT.eraseBtn;
    if (!this._bound) { this._bind(); this._bound = true; }
    this._sync();
    return this;
  };

  /* ---------------- 開けるか ---------------- */

  /** `メニューに戻る` を今押せるか（演出中・タイトル中は押させない） */
  Menu.prototype.canOpenMenu = function () {
    var g = ESCAPE.game;
    if (!g) return false;
    if (ESCAPE.Title && ESCAPE.Title.blocking && ESCAPE.Title.blocking()) return false;
    if (ESCAPE.Wake && ESCAPE.Wake.blocking && ESCAPE.Wake.blocking()) return false;
    if (g.cinematic && g.cinematic.active()) return false;
    if (g.stealth && g.stealth.jail && g.stealth.jail.phase !== 'none') return false;
    return true;
  };

  /* ---------------- 確認ダイアログ ---------------- */

  /** kind: 'menu'（メニューに戻る） / 'erase'（データを消す） */
  Menu.prototype.open = function (kind) {
    if (this.kind) return false;
    if (kind === 'menu' && !this.canOpenMenu()) return false;
    this.kind = (kind === 'erase') ? 'erase' : 'menu';
    this._sync();
    return true;
  };

  /** `続ける` / `やめる`（＝何もせず閉じる） */
  Menu.prototype.cancel = function () {
    if (!this.kind) return false;
    this.kind = null;
    this.cancels++;
    this._sync();
    return true;
  };

  /** `戻る` / `消す`（＝実行して閉じる） */
  Menu.prototype.accept = function () {
    var kind = this.kind;
    if (!kind) return false;
    this.kind = null;
    this._sync();
    if (kind === 'erase') this.eraseData();
    else this.backToTitle();
    return true;
  };

  Menu.prototype.isOpen = function () { return !!this.kind; };

  /** 数えずに畳む（g.reset() の製品初期状態復帰から。ユーザー操作ではない） */
  Menu.prototype.forceClose = function () {
    if (!this.kind) return false;
    this.kind = null;
    this._sync();
    return true;
  };

  /** 画面へ出ているか（computed style で見る＝契約の判定方法） */
  Menu.prototype.visible = function () {
    var el = this.dom && this.dom.overlay;
    if (!el || !global.getComputedStyle) return false;
    var cs = global.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return parseFloat(cs.opacity || '1') > 0.01;
  };

  Menu.prototype._sync = function () {
    var d = this.dom;
    if (!d || !d.overlay) return;
    var k = this.kind;
    if (d.text) d.text.textContent = k ? (k === 'erase' ? TEXT.eraseConfirm : TEXT.menuConfirm) : '';
    if (d.yes) d.yes.textContent = (k === 'erase') ? TEXT.eraseYes : TEXT.menuYes;
    if (d.no) d.no.textContent = (k === 'erase') ? TEXT.eraseNo : TEXT.menuNo;
    d.overlay.classList.toggle('show', !!k);
  };

  /* ---------------- 実行 ---------------- */

  /** タイトルへ戻る。セーブは保持（＝タイトルに `続きから` が出る） */
  Menu.prototype.backToTitle = function () {
    var g = ESCAPE.game;
    this.backs++;
    if (!g) return false;
    /* 演出・全画面地図・メモを畳んでから戻す（戻った先に残骸を出さない） */
    if (ESCAPE.Wake && ESCAPE.Wake.cancel) ESCAPE.Wake.cancel();
    if (g.minimap && g.minimap.close) g.minimap.close();
    if (g.progress && g.progress.onCloseTap) g.progress.onCloseTap();
    if (g.input) {
      g.input.releaseRun('title');     /* P4.18 項目2: 自動解除4条件のひとつ */
      g.input.reset();
    }
    /* 「進行は記録されている」（正文）。ここで1回書いておけば、この時点までの
       鍵・読んだメモ・地図・軌跡が残り、タイトルは `続きから` を出せる。 */
    if (g.progress && g.progress.save) g.progress.save();
    if (ESCAPE.Title && ESCAPE.Title.show) ESCAPE.Title.show();
    return true;
  };

  /** 記録をすべて消す（セーブ＋音量などの設定）。消したらタイトルの表示も作り直す */
  Menu.prototype.eraseData = function () {
    var g = ESCAPE.game;
    this.erases++;
    if (g && g.input) g.input.releaseRun('title');
    if (g && g.progress && g.progress.eraseAllData) g.progress.eraseAllData();
    if (ESCAPE.Title && ESCAPE.Title.show) ESCAPE.Title.show();
    return true;
  };

  /* ---------------- 結線 ---------------- */

  Menu.prototype._bind = function () {
    var self = this, d = this.dom;

    bindTap(d.btnMenu, function () { self.open('menu'); });
    bindTap(d.titleErase, function () { self.open('erase'); });
    bindTap(d.yes, function () { self.accept(); });
    bindTap(d.no, function () { self.cancel(); });

    /* Esc（PC）。捕獲フェーズで **先に** 判定したいので capture フェーズで受ける:
       全画面地図（js/minimap.js）とメモ（js/progress.js）は同じ window の
       bubble フェーズで Esc を処理するので、そちらが担当する状況ではここは何もしない。 */
    global.addEventListener('keydown', function (e) {
      if (e.code !== 'Escape') return;
      if (self.kind) { self.cancel(); e.stopPropagation(); e.preventDefault(); return; }
      var g = ESCAPE.game;
      if (g && g.minimap && g.minimap.full) return;                      /* 地図を閉じる番 */
      if (g && g.progress && g.progress.modalOpen && g.progress.modalOpen()) return; /* メモを閉じる番 */
      if (!self.canOpenMenu()) return;
      e.preventDefault();
      self.open('menu');
    }, true);
  };

  /* ---------------- 検証フック ---------------- */

  Menu.prototype.info = function () {
    var d = this.dom;
    return {
      kind: this.kind, open: this.isOpen(), visible: this.visible(),
      text: d && d.text ? d.text.textContent : '',
      yes: d && d.yes ? d.yes.textContent : '',
      no: d && d.no ? d.no.textContent : '',
      menuLabel: d && d.btnMenu ? d.btnMenu.textContent : '',
      eraseLabel: d && d.titleErase ? d.titleErase.textContent : '',
      backs: this.backs, erases: this.erases, cancels: this.cancels,
      canOpenMenu: this.canOpenMenu()
    };
  };

  var menu = new Menu();
  ESCAPE.Menu = menu;
  ESCAPE.MENU_TEXT = TEXT;
  global.__menuDebug = {
    get: function () { return menu; },
    info: function () { return menu.info(); }
  };

  function install() { menu.install(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(window);
