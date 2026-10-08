import * as THREE from "three";
import { shuffledTips } from "./tips.js";

// ---------------------------------------------------------------------------
// The loading screen.
//
// The thing that makes a WebGL page stutter for its first few seconds is almost
// never the download. It is SHADER COMPILATION: three.js compiles a program the
// first time a given material/light-count/shadow combination is actually drawn,
// and it does it on the main thread, mid-frame. So the first time each new kind
// of surface enters the view — terrain, water, the sky dome, the dragon's skin,
// a brazier, a plasma bolt — the frame that reveals it takes tens of
// milliseconds and the game visibly hitches.
//
// Hiding that behind a spinner does not fix it; it just moves it. What fixes it
// is compiling everything BEFORE the first frame is shown, which is what
// renderer.compileAsync exists for. So this screen does three things in order:
//
//   1. waits for the assets a caller says it needs,
//   2. compiles every material in the scene against the real camera,
//   3. renders a couple of throwaway frames to shake out anything left,
//
// and only then fades out. The bar is honest about which of the three it is on,
// because "Compiling shaders" sitting there for two seconds is a lot less
// alarming than a bar that stops moving.
// ---------------------------------------------------------------------------

const CSS = `
.na-load { position:fixed; inset:0; z-index:120;
           background: radial-gradient(ellipse at 50% 40%, #121722 0%, #07090e 62%, #040509 100%);
           display:flex; flex-direction:column; align-items:center; justify-content:center;
           gap:18px; font-family:var(--ui, Rajdhani, system-ui, sans-serif); color:var(--ink, #ece6d8);
           transition:opacity .7s ease; }
.na-load.out { opacity:0; pointer-events:none; }
.na-load .eyebrow { font-size:.7rem; font-weight:700; letter-spacing:.42em; text-transform:uppercase;
                    color:var(--ember-2, #ffb47a); min-height:1em; }
.na-load h1 { font-family:var(--display, Cinzel, serif); font-size:clamp(1.8rem,4.4vw,3rem);
              letter-spacing:.14em; font-weight:600; margin:0; text-shadow:0 0 40px rgba(255,138,61,.15); }
.na-load .bar { width:min(360px,58vw); height:2px; margin-top:8px; background:rgba(236,230,216,.12);
                overflow:hidden; border-radius:2px; }
.na-load .bar i { display:block; height:100%; width:100%; background:var(--ember, #ff8a3d);
                  box-shadow:0 0 12px rgba(255,138,61,.8); transform-origin:0 50%; transform:scaleX(0);
                  will-change:transform; }
.na-load .what { font-size:.68rem; font-weight:600; letter-spacing:.28em; text-transform:uppercase;
                 color:var(--ink-3, #857e71); min-height:1em; }
.na-load .tip { position:absolute; bottom:9vh; font-size:.92rem; font-weight:500; color:var(--ink-2, #b8b0a0);
                letter-spacing:.04em; line-height:1.5; max-width:min(620px,84vw); text-align:center;
                min-height:3em; transition:opacity .5s ease; }
.na-load .tip.fade { opacity:0; }
.na-load .tip-head { position:absolute; bottom:calc(9vh + 3.3rem); font-size:.62rem; font-weight:700; letter-spacing:.4em;
                     text-transform:uppercase; color:var(--ember-2, #ffb47a); opacity:.7; }
.na-load .tip kbd { font:600 .78rem var(--ui, Rajdhani, sans-serif); padding:1px 6px; border-radius:4px;
                    border:1px solid rgba(236,230,216,.3); background:rgba(236,230,216,.08); color:#ece6d8; }
`;

/**
 * @param {object} o
 *   title     what to show while it loads
 *   tip       one line of something to read
 * @returns {{ step, done, fail }}
 */
export function showLoading({ title = "Night Alone", sub = "", tip = "" } = {}) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.className = "na-load";
  el.innerHTML =
    `<div class="eyebrow">${sub}</div>` +
    `<h1>${title}</h1>` +
    `<div class="bar"><i></i></div>` +
    `<div class="what">Loading</div>` +
    `<div class="tip-head">Did you know</div><div class="tip"></div>`;
  document.body.appendChild(el);

  const bar = el.querySelector(".bar i");
  const what = el.querySelector(".what");

  // --- The bar ---------------------------------------------------------------
  // Animated on the compositor (transform, via the Web Animations API), not by
  // script or width transitions: the slow parts of loading — building the
  // archipelago, compiling shaders — block the main thread for seconds at a
  // time on a weak machine, and anything driven from the main thread freezes
  // with it and then jumps. A compositor animation keeps running through that.
  //
  // Each step glides from wherever the bar is to the new value, and then keeps
  // CREEPING toward the next milestone, easing off as it nears it, so the bar
  // is always visibly moving and never runs ahead of the real work.
  let shown = 0, anim = null;
  const now = () => {
    const m = getComputedStyle(bar).transform;
    const v = m && m.startsWith("matrix(") ? parseFloat(m.slice(7)) : shown;
    return Number.isFinite(v) ? v : shown;
  };
  function glide(to) {
    const from = Math.min(to, now());
    shown = to;
    anim?.cancel();
    const creep = Math.min(0.985, to + (1 - to) * 0.45);
    const reach = 0.35 + (to - from) * 1.2;           // seconds to reach the step
    anim = bar.animate([
      { transform: `scaleX(${from})`, offset: 0 },
      { transform: `scaleX(${to})`, offset: Math.min(0.5, reach / 14) },
      { transform: `scaleX(${creep})`, offset: 1 },
    ], { duration: 14000, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" });
  }

  // --- Tips ------------------------------------------------------------------
  const tipEl = el.querySelector(".tip");
  const tips = shuffledTips();
  let tipI = 0;
  const showTip = () => { tipEl.innerHTML = tips[tipI % tips.length]; tipI++; };
  showTip();
  const tipTimer = setInterval(() => {
    tipEl.classList.add("fade");
    setTimeout(() => { showTip(); tipEl.classList.remove("fade"); }, 500);
  }, 5200);

  return {
    /** Change the line above the title (main.js knows the chapter; boot does not). */
    setSub(t) { const e = el.querySelector(".eyebrow"); if (e) e.innerHTML = t; },
    /** @param {number} t 0..1 @param {string} label what is happening */
    step(t, label) {
      t = Math.max(0, Math.min(1, t));
      if (t > shown + 0.001) glide(t);
      if (label) what.textContent = label;
    },
    done() {
      glide(1);
      what.textContent = "Ready";
      clearInterval(tipTimer);
      setTimeout(() => {
        el.classList.add("out");
        setTimeout(() => { el.remove(); style.remove(); }, 800);
      }, 350);
    },
    fail(msg) {
      what.textContent = msg || "Something did not load";
      bar.style.background = "#d97a63";
    },
  };
}

/**
 * Compile everything, then prove it by drawing it.
 *
 * compileAsync walks the scene and builds a program for every material it finds
 * under the given camera's lighting. It is the supported way to pay that cost
 * up front. The extra rendered frames afterwards catch the stragglers —
 * anything whose program depends on state that only exists once it is drawn.
 */
export async function warmUp(renderer, scene, camera, onProgress = () => {}, budgetMs = 12000) {
  // compileAsync is only actually async when KHR_parallel_shader_compile is
  // there to make it so. Without the extension it is a SYNCHRONOUS compile
  // wearing a promise — it blocks the main thread, which means a timeout cannot
  // save you from it either, because the timer cannot fire while it runs. On a
  // software renderer that is minutes, and the player sits on this screen with
  // a bar that will never move.
  //
  // So: precompile only where it is genuinely parallel. Everywhere else, skip
  // it and let shaders compile lazily as they always did. Precompiling is an
  // optimisation, and an optimisation that can hang the game is a bug.
  const gl = renderer.getContext?.();
  const parallel = !!gl?.getExtension?.("KHR_parallel_shader_compile");

  if (parallel && renderer.compileAsync) {
    onProgress(0.55, "Compiling shaders");
    try {
      let timer;
      await Promise.race([
        renderer.compileAsync(scene, camera),
        new Promise((r) => { timer = setTimeout(r, budgetMs); }),
      ]);
      clearTimeout(timer);
    } catch (e) {
      console.warn("loading: shader precompile failed, continuing", e);
    }
  } else {
    console.info("loading: no parallel shader compile, skipping precompile");
  }

  onProgress(0.8, "Warming up");
  // Two frames, with a yield between them, so the browser can also do its own
  // first-draw work (texture upload, buffer orphaning) while nobody is looking.
  for (let i = 0; i < 2; i++) {
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
  }
  onProgress(1, "Ready");
}
