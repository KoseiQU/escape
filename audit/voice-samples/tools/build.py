#!/usr/bin/env python3
"""index.tpl.html に samples.js を埋め込んで index.html を書き出す。

index.html は「外部読み込みなし・1ファイルで動く」ことが要件だが、
音色の正は samples.js 側に1つだけ置きたい（採用案をそのまま製品へ移植するため）。
そこで生成時に埋め込む＝二重管理にならない。
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
MARK = "/* @@SAMPLES_JS@@ */"


def main() -> int:
    tpl = (HERE / "index.tpl.html").read_text(encoding="utf-8")
    js = (ROOT / "samples.js").read_text(encoding="utf-8")
    if MARK not in tpl:
        print("差し込み位置 %s が無い" % MARK, file=sys.stderr)
        return 1
    out = tpl.replace(MARK, js.rstrip())
    (ROOT / "index.html").write_text(out, encoding="utf-8")
    print("index.html: %d bytes" % len(out.encode("utf-8")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
