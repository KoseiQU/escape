#!/usr/bin/env python3
"""検証用の簡易サーバ。GET は静的配信、POST は WAV の保存。

ブラウザから戻す WAV を base64 で会話に載せると重いので、
ページから直接 POST させてディスクに書く。localhost 専用。

  python3 serve.py <配信ディレクトリ> <保存先ディレクトリ> <ポート>
"""
import http.server
import pathlib
import re
import sys

SAFE = re.compile(r"^[0-9A-Za-z_]+\.wav$")


def make(root: pathlib.Path, out: pathlib.Path):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(root), **kw)

        def do_POST(self):  # noqa: N802
            name = self.path.rsplit("/", 1)[-1]
            if not SAFE.match(name):
                self.send_error(400, "bad name")
                return
            n = int(self.headers.get("Content-Length", "0"))
            data = self.rfile.read(n)
            out.mkdir(parents=True, exist_ok=True)
            (out / name).write_bytes(data)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *a):
            pass

    return H


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    out = pathlib.Path(sys.argv[2]).resolve()
    port = int(sys.argv[3])
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), make(root, out))
    print("serving %s on %d -> %s" % (root, port, out), flush=True)
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
