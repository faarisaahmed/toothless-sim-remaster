#!/usr/bin/env python3
"""
Dev server for the sim. Same as `python3 -m http.server`, except it tells the
browser not to cache anything.

That is not a nicety. The plain http.server sends Last-Modified and no
Cache-Control, and Chrome will happily reuse an ES module from earlier in the
session on a heuristic freshness guess. Editing js/dragonrig.js and reloading
then shows you the *old* rig behaviour with no indication anything is stale,
which costs a lot more time than it sounds like it should.

    python3 tools/serve.py [port]        # default 8000
"""

import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request, without the date noise.
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"serving {ROOT} on http://localhost:{port}  (no-store)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
