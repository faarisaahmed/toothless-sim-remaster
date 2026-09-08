import * as THREE from "three";

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
.na-load { position:fixed; inset:0; z-index:120; background:#05060a;
           display:flex; flex-direction:column; align-items:center; justify-content:center;
           gap:20px; font-family:Inter,system-ui,sans-serif; color:#e8e2d4;
           transition:opacity .7s ease; }
.na-load.out { opacity:0; pointer-events:none; }
.na-load h1 { font-family:Cinzel,serif; font-size:clamp(1.6rem,4vw,2.6rem);
              letter-spacing:.16em; font-weight:600; margin:0; opacity:.92; }
.na-load .bar { width:min(340px,54vw); height:2px; background:rgba(232,226,212,.14);
                overflow:hidden; }
.na-load .bar i { display:block; height:100%; width:0%; background:#ff8a3d;
                  box-shadow:0 0 12px rgba(255,138,61,.8); transition:width .3s ease; }
.na-load .what { font-size:.66rem; letter-spacing:.26em; text-transform:uppercase;
                 color:#8d8677; min-height:1em; }
.na-load .tip { position:absolute; bottom:8vh; font-size:.76rem; color:#6f6a5f;
                letter-spacing:.06em; max-width:min(560px,80vw); text-align:center; }
`;

/**
 * @param {object} o
 *   title     what to show while it loads
 *   tip       one line of something to read
 * @returns {{ step, done, fail }}
 */
export function showLoading({ title = "Night Alone", tip = "" } = {}) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.className = "na-load";
  el.innerHTML =
    `<h1>${title}</h1>` +
    `<div class="bar"><i></i></div>` +
    `<div class="what">Loading</div>` +
    (tip ? `<div class="tip">${tip}</div>` : "");
  document.body.appendChild(el);

  const bar = el.querySelector(".bar i");
  const what = el.querySelector(".what");

  return {
    /** @param {number} t 0..1 @param {string} label what is happening */
    step(t, label) {
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, t)) * 100)}%`;
      if (label) what.textContent = label;
    },
    done() {
      bar.style.width = "100%";
      what.textContent = "Ready";
      el.classList.add("out");
      setTimeout(() => { el.remove(); style.remove(); }, 800);
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
