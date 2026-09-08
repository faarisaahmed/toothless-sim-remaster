#!/usr/bin/env python3
"""
Prove the game renders, headlessly, and say what it drew.

A --screenshot of this page comes back with the HUD on a black rectangle
whether or not anything is wrong, because headless Chrome on this machine does
not composite the WebGL canvas into the capture. It also does not forward
console to stderr, so a shader that fails to compile fails silently and the
picture looks exactly the same as a shader that works.

So this drives it from inside the page instead. It generates a copy of
index.html with three things spliced in:

  * a console and error recorder, read back out through --dump-dom;
  * a getContext() shim that forces preserveDrawingBuffer, so the frame
    buffer can still be read after the frame that drew it;
  * a sampler that reads the canvas back and reports what is actually on it —
    how much of it is not black, the mean colour, and the renderer's own
    draw-call, triangle and program counts.

    python3 tools/render_check.py [--seconds 26] [--port 8123] [--url ...]
"""
import argparse, base64, http.server, urllib.parse, os, shutil, socketserver, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

HEAD = """<script>
window.__LOG = [];
for (const k of ["log","info","warn","error"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { window.__LOG.push(k.toUpperCase()+": "+a.map(String).join(" ")); orig(...a); };
}
window.onerror = (m,s,l,c,e) => window.__LOG.push("UNCAUGHT: "+m+" @"+s+":"+l+(e&&e.stack?"\\n"+e.stack:""));
window.onunhandledrejection = (e) => window.__LOG.push("REJECT: "+((e.reason&&e.reason.stack)||e.reason));
// Keep the frame buffer around after the frame, or the read-back below is black
// no matter what was drawn.
const _get = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, attrs) {
  if (type && type.indexOf("webgl") === 0) {
    attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    const g = _get.call(this, type, attrs);
    // Record every GL context; three sizes its canvas AFTER getContext, so the
    // one we want is 300x150 at this moment. Pick the biggest at report time.
    if (g) { (window.__gls = window.__gls || []).push([g, this]); }
    return g;
  }
  return _get.call(this, type, attrs);
};
</script>
"""

TAIL = """<pre id="report" style="position:fixed;left:0;top:0;z-index:999;color:#0f0;background:#000;font:11px monospace;max-height:100vh;overflow:auto;white-space:pre-wrap"></pre>
<script>
// Anything passed as ?cmd= runs three quarters of the way through the wait, so
// `go 6` lands you over an island with time to settle before the frame is read.
//
// Most entries are debug console commands. Three are not, because some things
// can only be checked through the same events a player generates — a console
// command that calls the fire path proves the fire path, and proves nothing at
// all about whether the KEY reaches it:
//
//   key:KeyU         a press and release, on window, like a player's
//   hold:KeyU:0.4    the same, held down for that many seconds
//   down:KeyW        press and leave it down — for firing WHILE flying
//   up:KeyW          let it go again
//   wait:0.5         let the game run
//
// The report below waits for the whole sequence rather than firing on its own
// timer, or a `hold` longer than the gap would still be running when the frame
// was read.
window.__cmdsDone = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyEv = (type, code) =>
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

setTimeout(async () => {
  const cmds = new URLSearchParams(location.search).get("cmd");
  if (!cmds) { window.__cmdsDone = true; return; }
  const input = document.getElementById("console-input");
  const consoleOpen = (open) => keyEv("keydown", "Backquote");

  for (const raw of cmds.split(";")) {
    const c = raw.trim();
    if (!c) continue;
    if (c.startsWith("wait:")) { await sleep(parseFloat(c.slice(5)) * 1000); continue; }
    if (c.startsWith("key:")) {
      keyEv("keydown", c.slice(4)); await sleep(50); keyEv("keyup", c.slice(4));
      await sleep(34);
      continue;
    }
    if (c.startsWith("down:")) { keyEv("keydown", c.slice(5)); await sleep(30); continue; }
    if (c.startsWith("up:"))   { keyEv("keyup",   c.slice(3)); await sleep(30); continue; }
    if (c.startsWith("hold:")) {
      const [, code, secs] = c.split(":");
      keyEv("keydown", code); await sleep(parseFloat(secs) * 1000); keyEv("keyup", code);
      await sleep(120);
      continue;
    }
    // A console command. The console is opened and closed around each one so a
    // `key:` entry either side is not typed into the input box instead.
    consoleOpen(true);
    input.value = c;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    consoleOpen(false);
    await sleep(30);
  }
  window.__cmdsDone = true;
}, SECONDS * 750);

setTimeout(async () => {
  // Give a long sequence as much time as it needs, then two more frames.
  //
  // Two, not twenty. The frame is read a moment after the last command, and a
  // plasma bolt covers 655 m in a second — a tenth of a second of politeness
  // here puts it sixty metres off screen and the picture comes back looking
  // like nothing was fired at all.
  for (let i = 0; i < 2400 && !window.__cmdsDone; i++) await sleep(25);
  await sleep(34);
  const out = [];
  let gl = null, canvas = null;
  for (const [g, c] of (window.__gls || [])) if (!canvas || c.width * c.height > canvas.width * canvas.height) { gl = g; canvas = c; }
  if (!gl) out.push("NO GL CONTEXT");
  else {
    out.push("CANVAS=" + canvas.width + "x" + canvas.height +
             " ctxLost=" + gl.isContextLost() + " glErr=" + gl.getError());
    // Straight off the drawing buffer. drawImage() of the canvas goes through
    // the compositor, which in this headless build hands back a blank surface
    // whatever was drawn.
    const W = canvas.width, H = canvas.height;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ROWS = 12, COLS = 12;
    let lit = 0, r = 0, g = 0, b = 0, n = 0;
    const grid = [];
    for (let ry = 0; ry < ROWS; ry++) {
      let rr = 0, rg = 0, rb = 0, rn = 0;
      for (let cx = 0; cx < COLS; cx++) {
        // readPixels is bottom-up, so row 0 here is the top of the picture.
        const y = Math.floor((ROWS - 1 - ry + 0.5) / ROWS * H);
        const x = Math.floor((cx + 0.5) / COLS * W);
        const i = (y * W + x) * 4;
        rr += px[i]; rg += px[i+1]; rb += px[i+2]; rn++;
        if (px[i] + px[i+1] + px[i+2] > 24) lit++;
        n++;
      }
      grid.push([Math.round(rr/rn), Math.round(rg/rn), Math.round(rb/rn)]);
      r += rr; g += rg; b += rb;
    }
    out.push("NON_BLACK=" + (100*lit/n).toFixed(1) + "%");
    out.push("MEAN_RGB=" + Math.round(r/n) + "," + Math.round(g/n) + "," + Math.round(b/n));
    // Top of frame should be sky, bottom should be sea. A frame that is one
    // colour all the way down is a frame with nothing in it.
    for (let ry = 0; ry < ROWS; ry++) out.push("  band" + String(ry).padStart(2) + " rgb " + grid[ry].join(","));
  }
  // The frame itself, flipped back the right way up and shrunk. A histogram
  // tells you the picture is not black; only the picture tells you it is right.
  let png = "";
  if (gl && canvas.width > 200) {
    const W = canvas.width, H = canvas.height;
    const full = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, full);
    const src = document.createElement("canvas");
    src.width = W; src.height = H;
    const sctx = src.getContext("2d");
    const id = sctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const s0 = (H - 1 - y) * W * 4, d0 = y * W * 4;
      for (let i = 0; i < W * 4; i++) id.data[d0 + i] = full[s0 + i];
      for (let x = 0; x < W; x++) id.data[d0 + x * 4 + 3] = 255;
    }
    sctx.putImageData(id, 0, 0);
    const small = document.createElement("canvas");
    small.width = Math.min(W, 900); small.height = Math.round(H * small.width / W);
    small.getContext("2d").drawImage(src, 0, 0, small.width, small.height);
    png = small.toDataURL("image/png");
  }

  // Whatever the debug console printed, so `--cmd perf` reports the draw call
  // and triangle budget the handoff asks to be checked before and after.
  const cl = document.getElementById("console-log");
  if (cl && cl.textContent.trim()) {
    out.push("--- console ---");
    for (const line of cl.textContent.split("\\n")) if (line.trim()) out.push("  " + line.trim());
  }

  out.push("--- log ---");
  const text = out.concat(window.__LOG).join("\\n") + "\\n--- png ---\\n" + png;
  document.getElementById("report").textContent = text;
  // Posted back rather than read out of the DOM. --dump-dom waits for the page
  // to go idle, and a game that asks for another frame forever never does.
  const port = new URLSearchParams(location.search).get("report");\n  fetch("http://127.0.0.1:" + port + "/", { method: "POST", body: text, mode: "no-cors" }).catch(() => {});
}, SECONDS * 1000);
</script>
"""


class Collector(http.server.BaseHTTPRequestHandler):
    """One endpoint, one job: catch the report the page posts and hand it back."""
    report = None

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        Collector.report = self.rfile.read(n).decode("utf-8", "replace")
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=26)
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--query", default="")
    ap.add_argument("--png", default="/tmp/render_check.png")
    ap.add_argument("--cmd", default="",
                    help="debug console commands to run before capturing, ; separated "
                         "(e.g. 'go 4' to fly to island 4)")
    a = ap.parse_args()

    src = open(os.path.join(ROOT, "index.html")).read()
    src = src.replace('<script type="importmap">', HEAD + '  <script type="importmap">')
    src = src.replace("</body>", TAIL.replace("SECONDS", str(a.seconds)) + "</body>")
    open(os.path.join(ROOT, "_render_check.html"), "w").write(src)

    srv = socketserver.TCPServer(("127.0.0.1", 0), Collector)
    srv.timeout = 1
    port = srv.server_address[1]

    url = f"http://localhost:{a.port}/_render_check.html{a.query}"
    profile = tempfile.mkdtemp(prefix="rendercheck-")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--use-angle=metal", "--enable-gpu",
         # Headless treats its window as occluded, and an occluded renderer gets
         # its timers throttled to about one wake a minute. The page then never
         # reaches the setTimeout that posts the report and this exits with
         # "no report" no matter how long you wait, which looks exactly like the
         # game failing to load.
         "--disable-background-timer-throttling",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--user-data-dir=" + profile, "--window-size=1000,620", "--hide-scrollbars",
         "--allow-running-insecure-content", f"--unsafely-treat-insecure-origin-as-secure=http://localhost:{port}",
         url + ("&" if "?" in a.query else "?") + "report=" + str(port) +
         ("&cmd=" + urllib.parse.quote(a.cmd) if a.cmd else "")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    deadline = time.time() + a.seconds + 150
    try:
        while Collector.report is None and time.time() < deadline:
            srv.handle_request()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        srv.server_close()
        shutil.rmtree(profile, ignore_errors=True)

    if Collector.report is None:
        print("no report - the page never got as far as posting one")
        return 1
    text = Collector.report
    if "--- png ---" in text:
        text, png = text.split("--- png ---", 1)
        png = png.strip()
        if png.startswith("data:image/png;base64,"):
            with open(a.png, "wb") as f:
                f.write(base64.b64decode(png.split(",", 1)[1]))
            print(f"(frame written to {a.png})")
    print(text)
    bad = [l for l in text.splitlines() if l.startswith(("UNCAUGHT", "REJECT", "ERROR"))]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
