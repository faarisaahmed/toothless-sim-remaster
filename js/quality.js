// ---------------------------------------------------------------------------
// Quality tiers and the frame-rate governor.
//
// Two separate jobs that people usually conflate:
//
//   TIER is decided once, at boot, from what the machine is. It sets the things
//   that cannot change without rebuilding something — shadow map size, cloud
//   count, whether bloom is in the stack at all. Getting it wrong is survivable
//   because the governor picks up the slack.
//
//   THE GOVERNOR runs every frame and owns exactly one dial: render scale. It
//   is what actually delivers a steady frame rate, because it is the only knob
//   whose cost is continuous — every other quality setting is a cliff.
//
// Why render scale and not "turn things off": what this scene is short of is
// fill rate and post-process bandwidth, and both are linear in pixel count. A
// drop from 1.0 to 0.75 is 44% fewer pixels through the terrain shader, the
// bloom chain and the grade, and on a moving camera at 60 Hz it is very close
// to invisible. Turning the trees off is visible immediately and buys less.
//
// The governor is deliberately slow to react and quick to retreat. Dropping
// resolution the instant one frame runs long makes the picture pump, which
// reads worse than the stutter it is fixing, so it decides on a median over
// most of a second and will not act twice inside a cooldown.
// ---------------------------------------------------------------------------

/** Objects on this layer are skipped by the water's reflection pass. */
export const LAYER_NO_REFLECT = 1;

/**
 * What kind of machine is this. Conservative on purpose: the cost of guessing
 * LOW on a fast GPU is a slightly soft image for a second until the governor
 * scales back up, and the cost of guessing HIGH on an integrated one is ten
 * seconds of a locked-up tab while the first frames compile.
 */
export function detectTier() {
  let gpu = "";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "");
  } catch { /* blocked by the browser — fall through to the heuristics */ }

  const g = gpu.toLowerCase();
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;

  // Apple's own naming is the most reliable signal available in a browser: an
  // M-series Pro/Max/Ultra will hold this scene at native res, a base M-chip
  // will hold it at about three quarters, and anything Intel integrated will
  // not hold it at all without help.
  const appleHigh = /apple m\d+ (pro|max|ultra)/.test(g);
  const appleBase = /apple m\d/.test(g);
  const discrete  = /nvidia|geforce|rtx|gtx|radeon rx|arc a\d/.test(g);
  const weak      = /intel|uhd|iris|hd graphics|swiftshader|llvmpipe|mali|adreno/.test(g);

  if (/swiftshader|llvmpipe/.test(g)) return "low";        // software GL, no hope
  if (appleHigh || discrete) return "high";
  if (weak && !appleBase) return "low";
  if (appleBase || cores >= 8) return "medium";
  return dpr > 2 ? "low" : "medium";
}

/**
 * Everything a tier decides. Read once at boot; nothing here is live.
 *
 * maxScale is under 1.0 on the lower tiers deliberately. A Retina panel asks
 * for four times the pixels of the panel it is pretending to be, and no part
 * of this scene is sharp enough to repay that — the terrain is a normal-mapped
 * height field and the sea is a normal map. 0.85 of native on a 2x display is
 * still 1.7x supersampled relative to CSS pixels.
 */
export function tierSettings(tier) {
  switch (tier) {
    case "high":
      return { maxDpr: 2.0, maxScale: 1.0, minScale: 0.70, shadowMap: 2048,
               bloom: true, clouds: 105, reflectEvery: 1, treeNear: 420, treeFar: 2600 };
    case "medium":
      return { maxDpr: 1.75, maxScale: 0.92, minScale: 0.60, shadowMap: 1024,
               bloom: true, clouds: 80, reflectEvery: 2, treeNear: 300, treeFar: 2200 };
    default:
      return { maxDpr: 1.25, maxScale: 0.85, minScale: 0.50, shadowMap: 1024,
               bloom: false, clouds: 55, reflectEvery: 3, treeNear: 220, treeFar: 1700 };
  }
}

/**
 * Holds a frame rate by moving render scale.
 *
 * @param {object} o
 *   targetFps   what to aim for
 *   minScale    floor; below this the picture is too soft to be worth it
 *   maxScale    ceiling
 *   onScale     called with the new scale, only when it actually changes
 */
export function createGovernor({ targetFps = 60, minScale = 0.6, maxScale = 1.0, onScale } = {}) {
  const WINDOW = 48;          // frames in the median — a bit under a second
  const COOLDOWN = 40;        // frames to wait after acting, so it cannot oscillate
  const samples = new Float32Array(WINDOW);
  const sorted = new Float32Array(WINDOW);

  // Frames cannot arrive faster than the display swaps, so the fastest interval
  // ever seen IS this machine's floor — on a 60 Hz panel every healthy frame
  // reads as 16.7 ms no matter how much headroom the GPU has left. Without
  // this the governor can only ever ratchet down: it would wait for a median
  // under 13 ms to climb back, and vsync guarantees that never happens.
  const CLIMB_BLOCK = 240;    // ~4 s of no climbing after a retreat
  const FLOOR_MS = 6;         // sanity floor — nothing here runs at 165 Hz

  const budget = 1000 / targetFps;   // the frame time we are asking for

  let filled = 0, cursor = 0, cooldown = 0, climbBlock = 0;
  let scale = maxScale;
  let enabled = true;
  let lastMedian = budget;
  let fastest = budget;

  return {
    get scale() { return scale; },
    get fps() { return lastMedian > 0 ? 1000 / lastMedian : 0; },
    get frameMs() { return lastMedian; },
    get vsyncMs() { return fastest; },
    get enabled() { return enabled; },

    /** Turn the governor off and pin the scale — for screenshots and profiling. */
    setEnabled(v, pinned = maxScale) {
      enabled = v;
      if (!v) { scale = pinned; onScale?.(scale); }
    },

    /** One frame's wall time, in milliseconds. */
    submit(ms) {
      // A frame that took a fifth of a second was a texture upload or a GC, not
      // the renderer being slow, and feeding it to the median only makes the
      // governor twitchy. The clamp keeps it in the window as "slow" without
      // letting it dominate.
      samples[cursor] = Math.min(ms, 200);
      cursor = (cursor + 1) % WINDOW;
      if (ms > FLOOR_MS && ms < fastest) fastest = ms;
      if (climbBlock > 0) climbBlock--;
      if (filled < WINDOW) { filled++; return; }
      if (cooldown > 0) { cooldown--; return; }

      sorted.set(samples);
      Array.prototype.sort.call(sorted, (a, b) => a - b);
      const median = sorted[WINDOW >> 1];
      lastMedian = median;
      if (!enabled) return;

      // What a good frame actually costs here: the asked-for budget, or the
      // display's swap interval if that is slower. Asking for 60 on a 50 Hz
      // panel is asking for something the browser will not hand out.
      const frameTarget = Math.max(budget, fastest);

      const before = scale;
      if (median > frameTarget * 1.25) {
        // Behind. Retreat in a big enough step to actually land inside budget —
        // creeping down 2% at a time means twenty bad seconds before it helps.
        scale = Math.max(minScale, scale - 0.09);
        // And do not come straight back up. The failure mode of an eager
        // governor is not stutter, it is PUMPING: resolution walking up and
        // down every second or two, which the eye tracks far more readily than
        // a slightly soft image and cannot stop watching once it has noticed.
        climbBlock = CLIMB_BLOCK;
      } else if (median < frameTarget * 1.08 && scale < maxScale && climbBlock === 0) {
        // Riding the swap interval with room to spare. Climb slowly: the cost
        // of guessing wrong upward is a stutter, downward is nothing.
        scale = Math.min(maxScale, scale + 0.04);
      }

      if (scale !== before) {
        cooldown = COOLDOWN;
        onScale?.(scale);
      }
    },
  };
}
