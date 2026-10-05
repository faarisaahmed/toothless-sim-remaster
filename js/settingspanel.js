import { optionsFor, SECTIONS } from "./settings.js";

// ---------------------------------------------------------------------------
// The settings screen, as one component.
//
// The title screen and the pause menu both show it, and before this each of
// them rendered the same flat registry its own way — one long list where the
// graphics options would have been twelve rows below the music. Now it is
// tabs (Graphics, Controls, World, Audio, Game) over rows, and the host only
// has to forward input:
//
//   move(±1)          up / down a row
//   change(±1, wrap)  step the selected row's value (wrap: Enter / confirm
//                     goes round from the last value to the first; the arrows
//                     stop at the ends, since every value is on screen)
//   tab(±1)           previous / next tab
//
// Each row shows ALL of its values at once, so a mouse or a thumb picks one
// directly instead of clicking through them:
//
//   kind "presets"    a row of big buttons (Auto / Low / Medium / High / Max)
//                     plus a "Custom" lamp that lights when you have tweaked
//   choices()         a segmented control — [Off][Low][Medium][Ultra]
//   toggle()          a switch
//   anything else     the old value between two arrows
//
// Every row is re-read after every change, because some rows move others —
// picking a graphics preset rewrites nine of them at once.
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function controlHtml(o, flashing) {
  const fl = flashing ? " flash" : "";
  if (o.kind === "presets") {
    const cur = o.current();
    const known = o.choices().some((c) => c.v === cur);
    return `<span class="ui-presets${fl}" role="radiogroup" aria-label="${esc(o.label)}">${o.choices().map((c, i) => {
      const on = c.v === cur;
      const sub = c.v === "auto" && o.autoTier ? `<small>${o.autoTier()}</small>` : "";
      return `<button type="button" class="ui-preset${on ? " on" : ""}" data-pick="${i}" role="radio" aria-checked="${on}">${c.label}${sub}</button>`;
    }).join("")}<span class="ui-preset custom${known ? "" : " on"}" aria-hidden="${known}" title="Set when you change any single option">Custom</span></span>`;
  }
  if (o.choices) {
    const cur = o.current();
    const list = o.choices();
    return `<span class="ui-seg${fl}${list.length > 4 ? " many" : ""}" role="radiogroup" aria-label="${esc(o.label)}">${list.map((c, i) =>
      `<button type="button" class="${c.v === cur ? "on" : ""}" data-pick="${i}" role="radio" aria-checked="${c.v === cur}">${c.label}</button>`
    ).join("")}</span>`;
  }
  if (o.toggle) {
    const on = o.toggle();
    return `<button type="button" class="ui-switch${on ? " on" : ""}${fl}" data-toggle role="switch" aria-checked="${on}" aria-label="${esc(o.label)}"><i></i><span>${on ? "On" : "Off"}</span></button>`;
  }
  return `<span class="val${fl}">
      <button type="button" data-step="-1" aria-label="previous">&#9664;</button>
      <span>${o.value()}</span>
      <button type="button" data-step="1" aria-label="next">&#9654;</button>
    </span>`;
}

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
    const scroll = rowsEl.scrollTop;
    rowsEl.innerHTML = list.map((o, i) => {
      const kind = o.kind === "presets" ? " presets" : o.choices ? " seg" : o.toggle ? " sw" : "";
      return `
      <li class="ui-row${kind}${i === row ? " on" : ""}" data-row="${i}">
        <span class="glyph">${o.glyph || "&#9670;"}</span>
        <span class="main"><div class="lbl">${o.label}</div><div class="hint">${o.hint()}</div></span>
        <span class="ctl">${controlHtml(o, i === flash)}</span>
      </li>`;
    }).join("");
    rowsEl.scrollTop = scroll;
    flash = -1;
    rowsEl.children[row]?.scrollIntoView({ block: "nearest" });
  }

  function select(i) {
    if (i === row) return;
    row = i;
    for (const c of rowsEl.children) c.classList.toggle("on", +c.dataset.row === row);
  }

  function changed(o) {
    flash = row;
    render();
    onChange?.(o);
  }

  tabsEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    tab = +t.dataset.tab; row = 0; render();
  });
  rowsEl.addEventListener("click", (e) => {
    const li = e.target.closest("[data-row]");
    if (!li) return;
    const i = +li.dataset.row;
    const o = rows()[i];
    if (!o) return;
    row = i;
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      const c = o.choices()[+pick.dataset.pick];
      if (c && c.v !== o.current()) { o.pick(c.v); changed(o); } else render();
      return;
    }
    const step = e.target.closest("[data-step]");
    if (step) { api.change(+step.dataset.step, true); return; }
    // A switch flips wherever the row is clicked; an arrow row steps forward
    // as it always did. A segmented row only takes focus — its value is one
    // of the buttons, and guessing which would be worse than doing nothing.
    if (o.toggle || (!o.choices && o.kind !== "presets")) { api.change(1, true); return; }
    select(i);
  });
  rowsEl.addEventListener("mousemove", (e) => {
    const li = e.target.closest("[data-row]");
    if (li) select(+li.dataset.row);
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
    /**
     * Step the selected row. Left / right stop at the ends of a segmented row
     * (every value is on screen, so going round from Ultra to Off is a
     * surprise, not a shortcut); `wrap` is for Enter / confirm, which has only
     * one direction and so has to go round.
     */
    change(dir, wrap = false) {
      const o = rows()[row];
      if (!o) return;
      if (o.choices && !wrap) {
        const list = o.choices();
        const i = list.findIndex((c) => c.v === o.current());
        if (i >= 0) {
          const j = Math.max(0, Math.min(list.length - 1, i + dir));
          if (j === i) return;
          o.pick(list[j].v);
          changed(o);
          return;
        }
      }
      o.cycle(dir);
      changed(o);
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
