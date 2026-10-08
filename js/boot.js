import { setupGamepad } from "./gamepad.js";
import { setupDualSense } from "./dualsense.js";
import * as input from "./input.js";
import * as saves from "./saves.js";
import { runTitle } from "./title.js";
import { runPrologue } from "./prologue.js";
import { settings } from "./settings.js";
import { showLoading } from "./loading.js";

// ---------------------------------------------------------------------------
// Boot
//
// The entry point, in place of main.js. Stages run one at a time, each with its
// own renderer, each torn down before the next starts, and the flight sim is
// imported dynamically so its four megabytes of terrain only load on the route
// that actually needs them.
//
// The route is the title screen, everywhere. It used to drop a localhost
// straight into flight, which kept the development loop short and meant that
// anyone playing it locally never saw a save slot, a chapter or a setting —
// and the story could not be continued, only restarted. The dev route is one
// query string away:
//
//   ?stage=flight    the flight sim, story from the top, nothing saved
//   ?stage=free      free flight, nothing saved but the islands found
//   ?stage=title     the default
//   ?stage=prologue  the prologue on a scratch save -> flight
//
// And "Prologue: Skip" on the title screen takes B1 out of the title route,
// for anybody who is starting new saves all day and does not need to walk
// around the room again. It deliberately does NOT override `?stage=prologue`:
// a URL that asks for the prologue by name is asking on purpose, which is what
// makes that route usable for working on the prologue itself.
//
// The pad is set up once, here, and handed down. Two stages both calling
// setupGamepad would poll the same device twice and fight over rumble.
// ---------------------------------------------------------------------------

const pad = setupGamepad();
const dualsense = setupDualSense();
pad.rumble.attachHID(dualsense);
dualsense.reattach();
input.attachPad(pad);

// Stages drive their own frames and bracket them with input.beginFrame() /
// input.finishFrame(). Only one stage runs at a time, so exactly one thing is
// ever polling the pad — which matters, because getGamepads() returns a
// snapshot and two pollers would each see half the presses.

// Which route to take. `?stage=` always wins.
const stage = new URLSearchParams(location.search).get("stage") || "title";

/**
 * Hand off to the flight sim.
 *
 * The pad goes with it, always. main.js will happily build its own if this is
 * missing, and then two setupGamepad()s each poll getGamepads() — which returns
 * a snapshot, not a live object — so the presses land in one of them and not
 * the other, and half your inputs vanish.
 */
function toFlight(extra = {}) {
  document.body.classList.remove("pre-flight");
  document.body.classList.add("in-flight");
  window.__nightAlone = { pad, dualsense, ...extra };
  // Cover the screen NOW. main.js and its whole module graph take a moment to
  // arrive, and until then the page's own HUD sat on a black screen; main.js
  // picks this screen up and carries on with it.
  window.__naLoading = showLoading({ title: "Night Alone", sub: extra.mode === "free" ? "Free flight" : "" });
  window.__naLoading.step(0.02, "Loading the game");
  return import("./main.js");
}

async function main() {
  document.body.classList.add("pre-flight");

  if (stage === "flight") return toFlight({ mode: "story" });
  if (stage === "free") return toFlight({ mode: "free" });

  // "Restart chapter" from the pause menu: a reload that skips the menus. The
  // request rides in sessionStorage and is used once.
  if (stage === "launch") {
    let req = null;
    try {
      req = JSON.parse(sessionStorage.getItem("nightalone.launch") || "null");
      sessionStorage.removeItem("nightalone.launch");
    } catch { /* fall through to the title */ }
    if (req?.chapter) {
      const slot = Number.isInteger(req.slot) ? req.slot : null;
      const save = slot !== null ? saves.get(slot) : null;
      history.replaceState(null, "", `${location.pathname}?stage=title`);
      return toFlight({ mode: "story", slot: save ? slot : null, save, chapter: req.chapter });
    }
  }

  if (stage === "prologue") {
    const save = saves.get(0) || saves.create(0);
    await runPrologue(pad, save);
    return toFlight({ mode: "story", slot: 0, save });
  }

  const pick = await runTitle(pad);
  if (pick.mode === "free") return toFlight({ mode: "free" });

  const { slot, save, isNew, chapter } = pick;
  // A chapter replay never goes through the room: it was asked for by name.
  if (!chapter && (isNew || save.scene === "prologue")) {
    if (settings.skipPrologue()) {
      // Straight past it, but the save still has to come out of this the way
      // it would have: `scene` is what sends a half-finished save back into
      // the room next time. `prologueSeen` records that they did not see it,
      // because that is the true thing to record.
      save.scene = "flight";
      save.prologueSeen = false;
    } else {
      const result = await runPrologue(pad, save);
      save.scene = "flight";
      save.prologueSeen = result.seen;
    }
    saves.write(slot, save);
  }

  return toFlight({ mode: "story", slot, save, chapter: chapter || null });
}

main().catch((e) => {
  console.error("boot failed", e);
  toFlight();
});
