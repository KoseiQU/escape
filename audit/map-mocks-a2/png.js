#!/usr/bin/env node
/* ESCAPE — エリア2 下水道 構造モックの俯瞰PNG出力（P5a）
 *
 * 使い方:
 *   node audit/map-mocks-a2/png.js audit/map-mocks-a2/mockA.js        → 同じ場所に mockA.png
 *   node audit/map-mocks-a2/png.js audit/map-mocks-a2/mock*.js
 *
 * npm 不要・ブラウザ不要（Node 標準の zlib で PNG を自前エンコード）。1マス=6px。
 * 色: 壁=黒 / 岩盤F=濃灰 / 床=区画色（A煉瓦 B灰 C緑灰 D橙灰 E茶 F水色灰）/ W=青緑 /
 *     V=濃い青緑 / ランプ=縞 / -2m の窪地=一段暗く / spawn=白丸 / exit=黄 /
 *     ハンドル=赤 / セーブ端末=紫 / 幹線ランドマーク=外周の細い線
 */
'use strict';

var fs = require('fs');
var zlib = require('zlib');
var path = require('path');
var S = require('./stats.js');

var CELL = 6;

var ZONE_FLOOR = {
  A: [176, 132, 112],   /* 流入区画: 煉瓦色 */
  B: [166, 166, 172],   /* 幹線区画: 灰 */
  C: [146, 172, 150],   /* 沈殿区画: 緑灰 */
  D: [198, 158, 116],   /* 機関区画: 橙灰 */
  E: [138, 110, 84],    /* 旧坑区画: 茶 */
  F: [148, 178, 192]    /* 水門区画: 水色灰 */
};
var C_WALL = [10, 10, 12];
var C_ROCK = [46, 46, 52];
var C_WATER = [38, 132, 130];
var C_DEEP = [14, 62, 72];
var C_SPAWN = [255, 255, 255];
var C_EXIT = [250, 214, 40];
var C_DOOR = [180, 150, 30];
var C_HANDLE = [225, 46, 46];
var C_SAVE = [176, 96, 220];
var C_LM = [90, 230, 240];

/* ---------------- PNG エンコーダ ---------------- */

var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgb: Buffer(width*height*3) */
function encodePNG(width, height, rgb) {
  var raw = Buffer.alloc((width * 3 + 1) * height);
  for (var y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; /* filter: none */
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 描画 ---------------- */

function Canvas(w, h) {
  this.w = w; this.h = h;
  this.buf = Buffer.alloc(w * h * 3);
}
Canvas.prototype.px = function (x, y, rgb) {
  if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  var o = (y * this.w + x) * 3;
  this.buf[o] = rgb[0]; this.buf[o + 1] = rgb[1]; this.buf[o + 2] = rgb[2];
};
Canvas.prototype.rect = function (x0, y0, ww, hh, rgb) {
  for (var y = y0; y < y0 + hh; y++) for (var x = x0; x < x0 + ww; x++) this.px(x, y, rgb);
};
Canvas.prototype.disc = function (cx, cy, rad, rgb) {
  for (var y = cy - rad; y <= cy + rad; y++) {
    for (var x = cx - rad; x <= cx + rad; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad) this.px(x, y, rgb);
    }
  }
};

function shade(rgb, f) {
  return [Math.max(0, Math.min(255, Math.round(rgb[0] * f))),
          Math.max(0, Math.min(255, Math.round(rgb[1] * f))),
          Math.max(0, Math.min(255, Math.round(rgb[2] * f)))];
}

function inRect(rc, c, r) { return c >= rc.c0 && c <= rc.c1 && r >= rc.r0 && r <= rc.r1; }

function render(def) {
  var g = new S.Grid(def), meta = g.meta;
  var margin = 6;
  var W = g.w * CELL + margin * 2, H = g.h * CELL + margin * 2;
  var cv = new Canvas(W, H);
  cv.rect(0, 0, W, H, [4, 4, 6]);

  var regions = meta.regions || [];
  function zoneAt(c, r) {
    for (var i = 0; i < regions.length; i++) if (inRect(regions[i], c, r)) return regions[i].zone;
    return 'B';
  }
  var ramps = meta.ramps || [], plats = meta.plateaus || [];
  function isRamp(c, r) {
    for (var i = 0; i < ramps.length; i++) if (inRect(ramps[i], c, r)) return true;
    return false;
  }
  function lowY(c, r) {
    for (var i = 0; i < ramps.length; i++) if (inRect(ramps[i], c, r)) return Math.min(ramps[i].y0, ramps[i].y1);
    for (var j = 0; j < plats.length; j++) if (inRect(plats[j], c, r)) return plats[j].y;
    return 0;
  }

  for (var r = 0; r < g.h; r++) {
    for (var c = 0; c < g.w; c++) {
      var ch = g.at(c, r);
      var x0 = margin + c * CELL, y0 = margin + r * CELL;
      var col;
      if (ch === '#') col = C_WALL;
      else if (ch === 'F') col = C_ROCK;
      else if (ch === 'V') col = C_DEEP;
      else if (ch === 'W') col = C_WATER;
      else if (ch === 'D') col = C_DOOR;
      else if (ch === 'G') col = C_HANDLE;
      else if (ch === 'P') col = C_SAVE;
      else if (ch === 'X') col = C_EXIT;
      else col = ZONE_FLOOR[zoneAt(c, r)] || ZONE_FLOOR.B;

      /* -2m の窪地は一段暗く（水路・床とも） */
      if (ch === '.' || ch === 'W' || ch === 'X') {
        var y = lowY(c, r);
        if (y <= -0.5) col = shade(col, 0.58);
      }
      cv.rect(x0, y0, CELL, CELL, col);

      /* ランプは縞 */
      if (isRamp(c, r) && (ch === '.' || ch === 'W')) {
        var st = shade(col, 1.55);
        for (var k = 0; k < CELL; k++) {
          if (((c * CELL + k) + (r * CELL)) % 4 < 2) {
            for (var q = 0; q < CELL; q++) if ((k + q) % 4 < 2) cv.px(x0 + k, y0 + q, st);
          }
        }
      }
    }
  }

  /* 幹線ランドマーク: 外周に細い線 */
  var lms = meta.landmarks || [];
  for (var li = 0; li < lms.length; li++) {
    var L = lms[li];
    var horiz = (L.c1 - L.c0) >= (L.r1 - L.r0);
    if (horiz) {
      var yTop = (L.r0 + L.r1) / 2 < g.h / 2 ? 1 : H - 4;
      cv.rect(margin + L.c0 * CELL, yTop, (L.c1 - L.c0 + 1) * CELL, 3, C_LM);
    } else {
      var xL = (L.c0 + L.c1) / 2 < g.w / 2 ? 1 : W - 4;
      cv.rect(xL, margin + L.r0 * CELL, 3, (L.r1 - L.r0 + 1) * CELL, C_LM);
    }
    /* 該当区間の輪郭も薄く */
    for (var lc = L.c0; lc <= L.c1; lc++) {
      cv.px(margin + lc * CELL + 3, margin + L.r0 * CELL, C_LM);
      cv.px(margin + lc * CELL + 3, margin + (L.r1 + 1) * CELL - 1, C_LM);
    }
    for (var lr = L.r0; lr <= L.r1; lr++) {
      cv.px(margin + L.c0 * CELL, margin + lr * CELL + 3, C_LM);
      cv.px(margin + (L.c1 + 1) * CELL - 1, margin + lr * CELL + 3, C_LM);
    }
  }

  /* spawn / exit / ハンドル / 水門 */
  function mark(e, rgb, rad) {
    if (!e) return;
    cv.disc(margin + e.col * CELL + 3, margin + e.row * CELL + 3, rad || 4, rgb);
  }
  mark(meta.exitPad, C_EXIT, 5);
  mark(meta.door, C_DOOR, 4);
  mark(meta.keySafe, C_HANDLE, 5);
  (meta.saves || []).forEach(function (s) { mark(s, C_SAVE, 3); });
  mark(meta.spawn, C_SPAWN, 5);

  return { w: W, h: H, buf: cv.buf };
}

if (require.main === module) {
  var files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node png.js <mock.js> [...]'); process.exit(1); }
  files.forEach(function (f) {
    var def = S.loadMock(f);
    var img = render(def);
    var out = f.replace(/\.js$/, '.png');
    fs.writeFileSync(out, encodePNG(img.w, img.h, img.buf));
    console.log('wrote ' + out + '  (' + img.w + 'x' + img.h + ')');
  });
}

module.exports = { render: render, encodePNG: encodePNG };
