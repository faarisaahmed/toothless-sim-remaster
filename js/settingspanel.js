import { optionsFor, SECTIONS } from "./settings.js";

// ---------------------------------------------------------------------------
// The settings screen, as one component.
//
// The title screen and the pause menu both show it, and before this each of
// them rendered the same flat registry its own way — one long list where the
// graphics options would have been twelve rows below the music. Now it is
// tabs (Graphics, Controls, Audio, Game) over rows that show their value
// between two arrows, and the host only has to forward input:
//
//   move(±1)     up / down a row
//   change(±1)   step the selected row's value
//   tab(±1)      previous / next tab
//
// Mouse and touch work on their own: tabs and rows are clickable, and each
// row's arrows step it either way.
//
// Every row is re-read after every change, because some rows move others —
// picking a graphics preset rewrites six of them at once.
// ---------------------------------------------------------------------------

export function createSettingsPanel(where, { onChange } = {}) {
  const all = optionsFor(where);
  const tabs = SECTIONS.filter((s) => all.some((o) => (o.section || "Game") === s));
  let tab = 0;
  let row = 0;
  let flash = -1;

  const el = document.createElement("div");
  el.className = "ui-settings";
  el.innerHTML = `
    <div class="ui-tabs" role="tablist"></div>
    <ul class="ui-rows ui-scroll"></ul>`;
  const tabsEl = el.querySelector(".ui-tabs");
  const rowsEl = el.querySelector(".ui-rows");

  const rows = () => all.filter((o) => (o.section || "Game") === tabs[tab]);

  function render() {
    tabsEl.innerHTML = tabs.map((t, i) =>
      `<div class="ui-tab${i === tab ? " on" : ""}" data-tab="${i}" role="tab">${t}</div>`).join("") +
      `<span class="ui-tabkeys"><kbd>Q</kbd><kbd>E</kbd></span>`;
    const list = rows();
    if (row >= list.length) row = list.length - 1;
    rowsEl.innerHTML = list.map((o, i) => `
      <li class="ui-row${i === row ? " on" : ""}${i === flash ? " flash" : ""}" data-row="${i}">
        <span class="glyph">${o.glyph || "&#9670;"}</span>
        <span class="main"><div class="lbl">${o.label}</div><div class="hint">${o.hint()}</div></span>
        <span class="val">
          <button type="button" data-step="-1" aria-label="previous">&#9664;</button>
          <span>${o.value()}</span>
          <button type="button" data-step="1" aria-label="next">&#9654;</button>
        </span>
      </li>`).join("");
    flash = -1;
    rowsEl.children[row]?.scrollIntoView({ block: "nearest" });
  }

  tabsEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    tab = +t.dataset.tab; row = 0; render();
  });
  rowsEl.addEventListener("click", (e) => {
    const li = e.target.closest("[data-row]");
    if (!li) return;
    row = +li.dataset.row;
    const step = e.target.closest("[data-step]");
    api.change(step ? +step.dataset.step : 1);
  });
  rowsEl.addEventListener("mousemove", (e) => {
    const li = e.target.closest("[data-row]");
    if (!li || +li.dataset.row === row) return;
    row = +li.dataset.row;
    for (const c of rowsEl.children) c.classList.toggle("on", +c.dataset.row === row);
  });

  const api = {
    el,
    get tabName() { return tabs[tab]; },
    get row() { return row; },
    /** Returns false at either end, so the host can move focus off the list. */
    move(d) {
      const n = rows().length;
      const next = row + d;
      if (next < 0 || next >= n) return false;
      row = next;
      render();
      return true;
    },
    change(dir) {
      const o = rows()[row];
      if (!o) return;
      o.cycle(dir);
      flash = row;
      render();
      onChange?.(o);
    },
    tab(d) {
      tab = (tab + d + tabs.length) % tabs.length;
      row = 0;
      render();
    },
    reset() { row = 0; render(); },
    render,
  };
  render();
  return api;
}
