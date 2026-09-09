import { setupGamepad } from "./gamepad.js";
import { setupDualSense } from "./dualsense.js";
import * as input from "./input.js";
import * as saves from "./saves.js";
import { runTitle } from "./title.js";
import { runPrologue } from "./prologue.js";
import { settings } from "./settings.js";

// ---------------------------------------------------------------------------
// Boot
//
// The entry point, in place of main.js. Stages run one at a time, each with its
// own renderer, each torn down before the next starts, and the flight sim is
// imported dynamically so its four megabytes of terrain only load on the route
// that actually needs them.
//
// Which route we take depends on WHERE the page is being served from, and that
// is not magic for its own sake:
//
//   deployed (GitHub Pages)   the title screen. Somebody arriving at the game
//                             should arrive at the game, with save slots and a
//                             prologue, not be dropped mid-flight over open
//                             water with no idea what they are holding.
//
//   localhost                 straight to flight. This is the development
//                             route and it is the whole reason the default was
//                             ever "flight": clicking through a title screen
//                             and a prologue to check a change to the wing rig
//                             is a tax paid on every single reload, and the
//                             headless tools in tools/ all drive localhost and
//                             need window.__na, which only the flight stage
//                             publishes.
//
// Either way `?stage=` overrides it, so any route is one URL away from either
// machine:
//
//   ?stage=flight    the flight sim
//   ?stage=title     title -> prologue if the save is new -> flight
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

// Anything that is not a local dev server is "deployed". Written as a list of
// the local cases rather than a check for github.io, so it keeps working behind
// a custom domain, on a LAN address, or off the file system.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local)$/i;
const isLocal = location.protocol === "file:" || LOCAL_HOST.test(location.hostname);

// Which route to take. `?stage=` always wins; otherwise it is where we are.
const stage = new URLSearchParams(location.search).get("stage")
  || (isLocal ? "flight" : "title");

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
  return import("./main.js");
}

async function main() {
  document.body.classList.add("pre-flight");

  if (stage === "flight") return toFlight();

  if (stage === "prologue") {
    const save = saves.get(0) || saves.create(0);
    await runPrologue(pad, save);
    return toFlight({ slot: 0, save });
  }

  const { slot, save, isNew } = await runTitle(pad);

  if (isNew || save.scene === "prologue") {
    if (settings.skipPrologue()) {
      // Straight past it, but the save still has to come out of this the way
      // it would have: `scene` is what sends a half-finished save back into
      // B1 next time, so leaving it as "prologue" would replay a scene the
      // player has just said they do not want. `prologueSeen` records that
      // they did not see it, because that is the true thing to record.
      save.scene = "morning";
      save.prologueSeen = false;
    } else {
      const result = await runPrologue(pad, save);
      save.scene = "morning";
      save.prologueSeen = result.seen;
    }
    saves.write(slot, save);
  }

  return toFlight({ slot, save });
}

main().catch((e) => {
  console.error("boot failed", e);
  toFlight();
});
