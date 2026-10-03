import * as keymap from "./keymap.js";
import { createSettingsPanel } from "./settingspanel.js";

// ---------------------------------------------------------------------------
// The in-game menu.
//
// Opened with Esc, - or =. A column of choices on the left — Resume, the
// Journal (or the island count in free flight), Settings, Restart chapter,
// Save & quit — and whatever the selected one shows on the right. It stops the
// world while it is open; the world keeps rendering behind it, dimmed.
//
// Two decisions worth writing down.
//
// IT USES THE CAPTURE PHASE. While the menu is open its keys must not also
// reach the game, and main.js, controls.js and half a dozen other modules all
// listen for keydown on `window` in the bubble phase. A capture listener on
// window runs before every one of them, and stopPropagation() there means
// none of them ever see it.
//
// QUIT IS A RELOAD. It navigates to the title rather than unwinding the flight
// scene in place — a renderer, a world, 64 terrain tiles and sixteen thousand
// trees is a lot of teardown whose only job would be to save two seconds. The
// session writes its checkpoint first (hooks.onQuit), so nothing is lost.
// ---------------------------------------------------------------------------

// Not P: it is strafe-right in the wasd scheme (keymap.js).
const OPEN_KEYS = ["Minus", "Equal", "Escape"];

/**
 * @param {object} hooks
 *   onOpen, onClose       stop and start the world
 *   journal()             session.journal() — what the Journal page shows
 *   onQuit()              save and leave for the title
 *   onRestart()           restart the current chapter (story only)
 *   canOpen()             false while something else owns Esc (the chart, a cutscene)
 */
export function setupPause(hooks = {}) {
  const { onOpen, onClose } = hooks;
  let open = false;
  let page = 0;           // which item in the left column
  let focus = "nav";      // "nav" or "page" — where up/down go
  let confirmQuit = false;

  const settingsPanel = createSettingsPanel("game");

  const root = document.createElement("div");
  root.id = "pause";
  root.hidden = true;
  root.innerHTML = `
    <div class="pz-shade"></div>
    <div class="pz-wrap">
      <nav class="pz-nav ui-panel">
        <div class="ui-eyebrow">Paused</div>
        <ul class="ui-menu" id="pz-items"></ul>
        <div class="pz-legend ui-legend"></div>
      </nav>
      <section class="pz-page ui-panel" id="pz-page"></section>
    </div>`;
  document.body.appendChild(root);
  const itemsEl = root.querySelector("#pz-items");
  const pageEl = root.querySelector("#pz-page");
  const legend = root.querySelector(".pz-legend");

  const ITEMS = () => {
    const j = hooks.journal?.();
    const story = j?.mode !== "free";
    return [
      { id: "resume", label: "Resume" },
      { id: "journal", label: story ? "Journal" : "Islands" },
      { id: "settings", label: "Settings" },
      ...(story && j?.chapter ? [{ id: "restart", label: "Restart chapter" }] : []),
      { id: "quit", label: story ? "Save &amp; quit" : "Quit to title" },
    ];
  };

  // --- pages ------------------------------------------------------------------
  function journalHtml() {
    const j = hooks.journal?.();
    if (!j) return `<p class="pz-empty">Nothing written yet.</p>`;
    if (j.mode === "free") {
      const found = new Set(j.discovered);
      const n = j.islands.filter((i) => found.has(i)).length;
      return `
        <div class="ui-eyebrow">Free flight</div>
        <h2 class="ui-title">The Archipelago</h2>
        <div class="pz-count"><b>${n}</b> of ${j.islands.length} islands found</div>
        <div class="ui-bar"><i style="width:${(n / j.islands.length) * 100}%"></i></div>
        <ul class="pz-isles ui-scroll">${j.islands.map((name) =>
          `<li class="${found.has(name) ? "on" : ""}">${found.has(name) ? name : "Unknown"}</li>`).join("")}</ul>`;
    }
    const ch = j.chapter;
    const food = { fed: "Fed", thin: "Thin", empty: "Empty" }[j.food] || j.food;
    const results = j.samples.flatMap((s) => s.results.map((r) =>
      `<li><span>${r.fire}, ${r.condition}</span><b class="r-${r.result.replace(/\s/g, "-")}">${r.result}</b></li>`));
    return `
      <div class="ui-eyebrow">${j.finished ? "Mission one — complete" : ch ? `Chapter ${ch.n}` : "Journal"}</div>
      <h2 class="ui-title">${ch ? ch.title : "The Metal and the Dark"}</h2>
      ${ch ? `<p class="pz-blurb">${ch.blurb}</p>` : ""}
      ${j.objective && !j.finished ? `<div class="pz-obj"><span>Now</span>${j.objective}</div>` : ""}
      <div class="pz-cols">
        <div>
          <h3>Chapters</h3>
          <ol class="pz-chapters">${j.chapters.map((c) => `
            <li class="${c.state}"><i></i><span class="n">${c.n}</span>${c.title}</li>`).join("")}</ol>
        </div>
        <div>
          <h3>Condition</h3>
          <dl class="pz-cond">
            <div><dt>Day</dt><dd>${j.day}</dd></div>
            <div><dt>Food</dt><dd class="f-${j.food}">${food}</dd></div>
            <div><dt>Rested</dt><dd>${j.rested ? "Yes" : "No"}</dd></div>
          </dl>
          <h3>Charted</h3>
          <p class="pz-sites">${j.sites.length ? j.sites.join(" &middot; ") : "Nothing past Berk yet."}</p>
          ${results.length ? `<h3>The lab wall</h3><ul class="pz-lab">${results.join("")}</ul>` : ""}
        </div>
      </div>`;
  }

  function draw() {
    const items = ITEMS();
    if (page >= items.length) page = items.length - 1;
    itemsEl.innerHTML = items.map((it, i) =>
      `<li class="ui-item${i === page ? " on" : ""}${focus === "page" && i === page ? " held" : ""}" data-i="${i}">${it.label}</li>`
    ).join("");
    itemsEl.querySelectorAll("[data-i]").forEach((li) => {
      li.addEventListener("click", () => { page = +li.dataset.i; focus = "nav"; activate(); });
    });

    const id = items[page].id;
    root.dataset.page = id;
    if (id === "settings") {
      if (!pageEl.contains(settingsPanel.el)) { pageEl.innerHTML = ""; pageEl.appendChild(settingsPanel.el); }
      settingsPanel.render();
    } else if (id === "journal") {
      pageEl.innerHTML = journalHtml();
    } else if (id === "restart") {
      pageEl.innerHTML = `<div class="ui-eyebrow">Restart</div><h2 class="ui-title">From the top of this chapter</h2>
        <p class="pz-blurb">Back to where the chapter started, with what you had then. Progress past it is kept.</p>
        <button type="button" class="ui-btn${focus === "page" ? " on" : ""}" data-act="restart">Restart chapter</button>`;
    } else if (id === "quit") {
      const story = hooks.journal?.()?.mode !== "free";
      pageEl.innerHTML = `<div class="ui-eyebrow">${story ? "Save &amp; quit" : "Quit"}</div>
        <h2 class="ui-title">Back to the title?</h2>
        <p class="pz-blurb">${story
          ? "Your journey is saved here, where you are. Continue picks it up from this spot."
          : "The islands you have found stay found."}</p>
        <button type="button" class="ui-btn${focus === "page" || confirmQuit ? " on" : ""}" data-act="quit">${story ? "Save and quit" : "Quit"}</button>`;
    } else {
      const j = hooks.journal?.();
      pageEl.innerHTML = `<div class="ui-eyebrow">${j?.mode === "free" ? "Free flight" : j?.chapter ? `Chapter ${j.chapter.n} · ${j.chapter.title}` : ""}</div>
        <h2 class="ui-title">${j?.objective && !j?.finished ? j.objective : "Paused"}</h2>
        <p class="pz-blurb">The world is holding still. ${keyHelp()}</p>`;
    }
    pageEl.querySelector("[data-act=restart]")?.addEventListener("click", () => hooks.onRestart?.());
    pageEl.querySelector("[data-act=quit]")?.addEventListener("click", () => hooks.onQuit?.());

    legend.innerHTML = id === "settings" && focus === "page"
      ? `<span><kbd>&uarr;</kbd><kbd>&darr;</kbd> choose</span><span><kbd>&larr;</kbd><kbd>&rarr;</kbd> change</span>
         <span><kbd>Q</kbd><kbd>E</kbd> tabs</span><span><kbd>Esc</kbd> back</span>`
      : `<span><kbd>&uarr;</kbd><kbd>&darr;</kbd> choose</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> resume</span>`;
  }

  function keyHelp() {
    const k = (a) => keymap.label(keymap.keysFor(a)[0] || "");
    return `<kbd>${k("forward")}</kbd> to fly, <kbd>Tab</kbd> for the chart, <kbd>/</kbd> for the controls.`;
  }

  function activate() {
    const id = ITEMS()[page].id;
    if (id === "resume") return api.close();
    if (id === "settings") { focus = "page"; settingsPanel.reset(); draw(); return; }
    if (id === "restart" || id === "quit") {
      if (focus === "page") return id === "quit" ? hooks.onQuit?.() : hooks.onRestart?.();
      focus = "page"; draw(); return;
    }
    draw();
  }

  function moveNav(d) {
    const n = ITEMS().length;
    page = (page + d + n) % n;
    focus = "nav";
    draw();
  }

  const api = {
    get isOpen() { return open; },
    open() {
      if (open) return;
      open = true;
      page = 0;
      focus = "nav";
      root.hidden = false;
      // Let the mouse go, or the player cannot click anything.
      if (document.pointerLockElement) document.exitPointerLock();
      draw();
      requestAnimationFrame(() => root.classList.add("on"));
      onOpen?.();
    },
    close() {
      if (!open) return;
      open = false;
      root.classList.remove("on");
      root.hidden = true;
      onClose?.();
    },
    toggle() { open ? api.close() : api.open(); },
  };

  window.addEventListener("keydown", (e) => {
    // Never while typing into the debug console.
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;

    if (!open) {
      if (OPEN_KEYS.includes(e.code) && (hooks.canOpen?.() ?? true)) {
        e.preventDefault(); e.stopPropagation(); api.open();
      }
      return;
    }

    // From here on the menu owns the keyboard. Everything is consumed, whether
    // or not it means something, so a stray W does not fly him into a cliff
    // while somebody reads the settings.
    e.preventDefault();
    e.stopPropagation();
    const up = e.code === "ArrowUp" || keymap.isAction("forward", e.code);
    const down = e.code === "ArrowDown" || keymap.isAction("back", e.code);
    const left = e.code === "ArrowLeft", right = e.code === "ArrowRight";
    const enter = e.code === "Enter" || e.code === "Space";
    const id = ITEMS()[page].id;

    if (focus === "page") {
      if (e.code === "Escape" || e.code === "Backspace" || (left && id !== "settings")) { focus = "nav"; draw(); return; }
      if (id === "settings") {
        if (up) settingsPanel.move(-1);
        else if (down) settingsPanel.move(1);
        else if (left) settingsPanel.change(-1);
        else if (right || enter) settingsPanel.change(1);
        else if (e.code === "KeyQ" || e.code === "PageUp") settingsPanel.tab(-1);
        else if (e.code === "KeyE" || e.code === "PageDown") settingsPanel.tab(1);
        return;
      }
      if (enter) activate();
      return;
    }

    if (OPEN_KEYS.includes(e.code)) { api.close(); return; }
    if (up) moveNav(-1);
    else if (down) moveNav(1);
    else if (enter || right) activate();
  }, { capture: true });

  // The other half of owning the keyboard: a keyUP that the game never saw the
  // keydown for would leave that key stuck down for the rest of the session.
  window.addEventListener("keyup", (e) => {
    if (open) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  root.querySelector(".pz-shade").addEventListener("click", () => api.close());

  return api;
}
