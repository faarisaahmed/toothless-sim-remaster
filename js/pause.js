import { optionsFor, optionRowHtml } from "./settings.js";
import * as keymap from "./keymap.js";

// ---------------------------------------------------------------------------
// The in-game menu.
//
// Opened with - or =, and it does three things: it stops the game, it lets you
// change any setting without leaving, and it lets you go back to the title.
// Until now every one of those was impossible mid-flight — the settings lived
// on the title screen, so changing the control scheme meant reloading, and
// there was no way out of the flight sim at all short of the browser's back
// button.
//
// Two decisions worth writing down.
//
// IT USES THE CAPTURE PHASE. While the menu is open its keys must not also
// reach the game, and main.js, controls.js and half a dozen other modules all
// listen for keydown on `window` in the bubble phase. A keydown's target is the
// focused element rather than the window, so a capture listener on window runs
// before every one of them, and stopPropagation() there means none of them ever
// see it. The alternative — a global "am I paused" flag consulted by every
// listener in the project — is the same thing spelled out in twenty places.
//
// QUIT IS A RELOAD. It navigates to ?stage=title rather than tearing the
// flight scene down and handing control back to boot.js. That is not laziness
// about the teardown: main.js builds a renderer, a world, 64 terrain tiles and
// sixteen thousand trees, and unwinding all of it correctly to get back to a
// menu is a lot of code whose only job is to avoid a reload that takes two
// seconds. Nothing is lost either way, because the flight sim does not persist
// run state — the slot is written on the way IN, by boot.js.
// ---------------------------------------------------------------------------

const KEYS = ["Minus", "Equal"];   // - and =

/**
 * @param {object} hooks
 * @param {() => void} hooks.onOpen   stop the world
 * @param {() => void} hooks.onClose  start it again
 */
export function setupPause({ onOpen, onClose } = {}) {
  let open = false;
  // -1 is Resume, OPTS.length is Quit. The settings sit between them, so
  // the cursor is one range over one list and there is no special-casing.
  // Everything except the rows that only mean something before a game
  // starts. There is exactly one of those and it is the prologue.
  const OPTS = optionsFor("game");
  const RESUME = -1, QUIT = OPTS.length;
  let cursor = 0;

  const root = document.createElement("div");
  root.id = "pause";
  root.hidden = true;
  root.innerHTML = `
    <div class="pause-sheet">
      <div class="pause-head">
        <div class="pause-eyebrow">Paused</div>
        <h2 class="pause-title">Settings</h2>
      </div>
      <ul class="slots" id="pause-opts"></ul>
      <div class="pause-foot">
        <button type="button" class="pause-btn" data-act="resume">Resume</button>
        <button type="button" class="pause-btn pause-quit" data-act="quit">Quit to menu</button>
      </div>
      <div class="pause-legend"></div>
    </div>`;
  document.body.appendChild(root);
  const list = root.querySelector("#pause-opts");
  const legend = root.querySelector(".pause-legend");
  const buttons = [...root.querySelectorAll(".pause-btn")];

  function draw() {
    list.innerHTML = OPTS
      .map((o, i) => optionRowHtml(o, i === cursor))
      .join("");
    // Rebound every draw because the markup is replaced every draw. Cheap, and
    // it keeps the rows and their handlers from ever disagreeing about order.
    [...list.children].forEach((li, i) => {
      li.addEventListener("click", () => { cursor = i; OPTS[i].cycle(1); draw(); });
    });
    for (const b of buttons) {
      const on = (b.dataset.act === "resume" && cursor === RESUME) ||
                 (b.dataset.act === "quit" && cursor === QUIT);
      b.classList.toggle("on", on);
    }
    const k = (a) => keymap.label(keymap.keysFor(a)[0] || "");
    legend.innerHTML =
      `<span><b>${k("forward")}</b><b>${k("back")}</b> or <b>&uarr;</b><b>&darr;</b> move</span>` +
      `<span><b>&larr;</b><b>&rarr;</b> change</span>` +
      `<span><b>Enter</b> pick</span>` +
      `<span><b>&minus;</b> or <b>Esc</b> back to the game</span>`;
    list.children[cursor]?.scrollIntoView({ block: "nearest" });
  }

  function move(d) {
    cursor = Math.max(RESUME, Math.min(QUIT, cursor + d));
    draw();
  }

  const api = {
    get isOpen() { return open; },

    open() {
      if (open) return;
      open = true;
      cursor = 0;
      root.hidden = false;
      // Let the mouse go, or the player cannot click anything and the menu is
      // reading raw pointer deltas it has no use for.
      if (document.pointerLockElement) document.exitPointerLock();
      draw();
      onOpen?.();
    },

    close() {
      if (!open) return;
      open = false;
      root.hidden = true;
      onClose?.();
    },

    toggle() { open ? api.close() : api.open(); },
  };

  buttons.find((b) => b.dataset.act === "resume")
    .addEventListener("click", () => api.close());
  buttons.find((b) => b.dataset.act === "quit")
    .addEventListener("click", () => {
      // Keep the stage in the URL so a reload lands on the title rather than
      // dropping straight back into flight on a dev machine, where the default
      // route is the flight sim.
      location.href = `${location.pathname}?stage=title`;
    });

  window.addEventListener("keydown", (e) => {
    // Never while typing into the debug console.
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;

    if (!open) {
      if (KEYS.includes(e.code)) { e.preventDefault(); e.stopPropagation(); api.open(); }
      return;
    }

    // From here on the menu owns the keyboard. Everything is consumed, whether
    // or not it means something, so a stray W does not fly him into a cliff
    // while somebody reads the settings.
    e.preventDefault();
    e.stopPropagation();

    if (KEYS.includes(e.code) || e.code === "Escape") { api.close(); return; }
    if (e.code === "ArrowUp" || keymap.isAction("forward", e.code)) { move(-1); return; }
    if (e.code === "ArrowDown" || keymap.isAction("back", e.code)) { move(1); return; }
    if (e.code === "ArrowLeft") { if (cursor >= 0 && cursor < QUIT) { OPTS[cursor].cycle(-1); draw(); } return; }
    if (e.code === "ArrowRight") { if (cursor >= 0 && cursor < QUIT) { OPTS[cursor].cycle(1); draw(); } return; }
    if (e.code === "Enter" || e.code === "Space") {
      if (cursor === RESUME) api.close();
      else if (cursor === QUIT) location.href = `${location.pathname}?stage=title`;
      else { OPTS[cursor].cycle(1); draw(); }
    }
  }, { capture: true });

  // The other half of owning the keyboard: a keyUP that the game never saw the
  // keydown for would leave that key stuck down for the rest of the session.
  window.addEventListener("keyup", (e) => {
    if (open) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  return api;
}
