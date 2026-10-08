import { makeTipDeck } from "./tips.js";
import { settings } from "./settings.js";

// ---------------------------------------------------------------------------
// When he goes down.
//
// A card over the game: what brought him down, a reassurance that nothing is
// lost, a hint (the first one, as it happens, about exactly this), and
// Continue — which wakes him on the nearest island with full health and the
// story where it was.
// ---------------------------------------------------------------------------

const HEADS = {
  arrow: "Shot down", bola: "Brought down", dive: "Down hard", wall: "Into the rock",
  scrape: "Worn down", water: "Into the sea",
};

export function createDownScreen({ onContinue }) {
  const el = document.createElement("div");
  el.id = "na-down";
  el.innerHTML = `
    <div class="eyebrow">He's down</div>
    <h2></h2>
    <div class="why"></div>
    <div class="keep">Nothing is lost. He'll wake on the nearest island.</div>
    <button type="button" class="go">Continue</button>
    <div class="tipbox">
      <div class="tip-head">Did you know</div>
      <div class="tip"></div>
      <div class="tip-nav"><button type="button" data-tip="-1" aria-label="Previous tip">&lsaquo;</button>
        <button type="button" data-tip="1" aria-label="Next tip">&rsaquo;</button></div>
    </div>`;
  document.body.appendChild(el);
  const head = el.querySelector("h2"), why = el.querySelector(".why"), tip = el.querySelector(".tip");
  let deck = null, open = false, ready = 0;

  const close = () => {
    if (!open || performance.now() < ready) return;
    open = false;
    el.classList.remove("on");
    onContinue?.();
  };
  el.querySelector(".go").addEventListener("click", close);
  el.querySelectorAll("[data-tip]").forEach((b) => b.addEventListener("click", () => {
    tip.innerHTML = +b.dataset.tip < 0 ? deck.prev() : deck.next();
  }));
  window.addEventListener("keydown", (e) => {
    if (!open) return;
    if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); close(); }
    else if (e.code === "ArrowRight") tip.innerHTML = deck.next();
    else if (e.code === "ArrowLeft") tip.innerHTML = deck.prev();
  });

  return {
    get open() { return open; },
    show(cause, reason) {
      open = true;
      // A moment before Continue answers, so a key still held from flying
      // does not dismiss the card before it has been read.
      ready = performance.now() + 1200;
      head.textContent = HEADS[cause] || "Brought down";
      why.textContent = reason || "";
      deck = makeTipDeck({ damage: settings.damage(), cause });
      tip.innerHTML = deck.next();
      el.classList.add("on");
    },
    /** Pad: confirm to continue. */
    confirm() { close(); },
  };
}
