import { setupGamepad } from "./gamepad.js";
import { setupDualSense } from "./dualsense.js";
import * as input from "./input.js";
import * as saves from "./saves.js";
import { runTitle } from "./title.js";
import { runPrologue } from "./prologue.js";

// ---------------------------------------------------------------------------
// Boot
//
// The entry point now, in place of main.js. Stages run one at a time, each with
// its own renderer, each torn down before the next starts. The flight sim is
// imported dynamically at the end — so nothing loads four megabytes of terrain
// before the player has decided whether they're playing.
//
//   title  ->  prologue (new game only)  ->  flight
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

// Dev shortcut: ?stage=prologue drops straight into a scene on a scratch save,
// skipping the title. Worth the six lines — the alternative is clicking through
// the title screen every time you want to look at the room.
const forced = new URLSearchParams(location.search).get("stage");

async function main() {
  document.body.classList.add("pre-flight");

  if (forced === "prologue") {
    await runPrologue(pad, saves.get(0) || saves.create(0));
    document.body.classList.remove("pre-flight");
    document.body.classList.add("in-flight");
    await import("./main.js");
    return;
  }

  const { slot, save, isNew } = await runTitle(pad);

  if (isNew || save.scene === "prologue") {
    const result = await runPrologue(pad, save);
    save.scene = "morning";
    save.prologueSeen = result.seen;
    saves.write(slot, save);
  }

  // Hand off. main.js still owns the flight sim end to end; it just doesn't
  // start until here any more.
  document.body.classList.remove("pre-flight");
  document.body.classList.add("in-flight");

  window.__nightAlone = { slot, save, pad, dualsense };
  await import("./main.js");
}

main().catch((e) => {
  console.error("boot failed", e);
  document.body.classList.remove("pre-flight");
  document.body.classList.add("in-flight");
  import("./main.js");
});
