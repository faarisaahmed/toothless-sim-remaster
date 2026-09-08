import { setupGamepad } from "./gamepad.js";
import { setupDualSense } from "./dualsense.js";
import * as input from "./input.js";
import * as saves from "./saves.js";
import { runTitle } from "./title.js";
import { runPrologue } from "./prologue.js";

// ---------------------------------------------------------------------------
// Boot
//
// The entry point, in place of main.js. Stages run one at a time, each with its
// own renderer, each torn down before the next starts, and the flight sim is
// imported dynamically so its four megabytes of terrain only load on the route
// that actually needs them.
//
// Default route: flight, straight away.
//
// The title and the prologue are both still here and both still work — they are
// just not in the way of getting to the archipelago. Ask for them by name:
//
//   (nothing)        the flight sim
//   ?stage=title     title -> prologue if the save is new -> flight
//   ?stage=prologue  the prologue on a scratch save -> flight
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

// Which route to take. Default straight to flight; the story stages are opt-in.
const stage = new URLSearchParams(location.search).get("stage") || "flight";

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
    const result = await runPrologue(pad, save);
    save.scene = "morning";
    save.prologueSeen = result.seen;
    saves.write(slot, save);
  }

  return toFlight({ slot, save });
}

main().catch((e) => {
  console.error("boot failed", e);
  toFlight();
});
