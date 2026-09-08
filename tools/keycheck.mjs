// Which pairs of controls can your HAND actually do at once?
//
// This is the check that was missing when fire and burst both ended up on the
// index finger — U over J in the wasd scheme, F over V in arrows. Nothing in
// the code was wrong: pressing fire while bursting simply never happened,
// because one finger cannot hold two keys, and the key that was never pressed
// looked exactly like a weapon that had stopped working.
//
// So: a finger map of a US board, the real bindings out of js/keymap.js, and a
// list of the combinations the game is supposed to support. An action counts as
// reachable if ANY of its keys is on a free finger, which is why sprint passes
// on Shift — it is bound to both of them and the hands are different.
//
//   node tools/keycheck.mjs
import { SCHEMES, setScheme, keysFor, label } from "../js/keymap.js";

// Left hand is L, right is R. The arrow cluster is its own thing, off to the
// right of the board and played with the whole right hand.
const F = {};
const row = (hand, keys, fingers) =>
  keys.forEach((k, i) => (F[k] = hand + fingers[i]));
const P = "pinky", RI = "ring", M = "middle", I = "index";

row("L", ["Digit1","Digit2","Digit3","Digit4","Digit5"], [P,RI,M,I,I]);
row("L", ["KeyQ","KeyW","KeyE","KeyR","KeyT"],           [P,RI,M,I,I]);
row("L", ["KeyA","KeyS","KeyD","KeyF","KeyG"],           [P,RI,M,I,I]);
row("L", ["KeyZ","KeyX","KeyC","KeyV","KeyB"],           [P,RI,M,I,I]);
row("R", ["Digit6","Digit7","Digit8","Digit9","Digit0"],  [I,I,M,RI,P]);
row("R", ["KeyY","KeyU","KeyI","KeyO","KeyP"],            [I,I,M,RI,P]);
row("R", ["KeyH","KeyJ","KeyK","KeyL","Semicolon","Quote"], [I,I,M,RI,P,P]);
row("R", ["KeyN","KeyM","Comma","Period","Slash"],        [I,I,M,RI,P]);
F.ShiftLeft = "L" + P;  F.ShiftRight = "R" + P;
F.Space = "thumb";      // either one, and never contended
for (const a of ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]) F[a] = "arrows:" + a;
// The mouse, which is not in BINDINGS because it is not a key — main.js wires
// the buttons straight to the actions. It matters here because it is the whole
// answer to "how do I fire while holding flat out": the left hand is on W and
// J, the right hand is on the mouse, and nothing is contended.
F.Mouse1 = "mouse" + I;  F.Mouse2 = "mouse" + M;
const ALSO_ON = { fire: ["Mouse1"], aim: ["Mouse2"] };
const allKeys = (a) => keysFor(a).concat(ALSO_ON[a] || []);

// Two keys clash when they need the same finger. The arrow cluster is the
// exception: it is four keys under one hand and they are played together, so
// arrows never clash with each other and never clash with a letter.
const clash = (a, b) => {
  const fa = F[a], fb = F[b];
  if (!fa || !fb) return false;              // unmapped: assume reachable
  if (fa.startsWith("arrows:") || fb.startsWith("arrows:")) return false;
  if (fa === "thumb" || fb === "thumb") return false;
  return fa === fb;
};

/**
 * Can both actions be held at once by SOME choice of their inputs?
 * @param {boolean} keysOnly ignore the mouse — what a keyboard-only player gets
 */
function together(x, y, keysOnly = false) {
  const A = keysOnly ? keysFor(x) : allKeys(x);
  const B = keysOnly ? keysFor(y) : allKeys(y);
  // Returns the pair that WORKS, not just true. Naming it matters: "fire +
  // burst is fine" is misleading when what is fine is U + B and the pair the
  // player actually reaches for is U + J.
  for (const a of A) for (const b of B) if (!clash(a, b)) return [a, b];
  return null;
}
const shown = (c) => c === "Mouse1" ? "left click" : c === "Mouse2" ? "right click" : label(c);

// What the game promises. Fire is in nearly all of them on purpose — it is the
// reflex action and it is supposed to work whatever else he is doing.
const MUST = [
  ["fire", "burst"], ["fire", "forward"], ["fire", "down"], ["fire", "up"],
  ["fire", "sprint"], ["fire", "turnL"], ["fire", "knifeL"], ["fire", "knifeR"],
  ["burst", "forward"], ["burst", "down"], ["burst", "turnL"],
  ["burst", "knifeL"], ["burst", "knifeR"], ["burst", "sprint"],
  ["down", "knifeL"], ["down", "knifeR"], ["down", "turnL"],
];
// Known and accepted. Fire + burst is the deliberate one: they are both the
// index finger (U over J) and the mouse is what covers it — see the note at the
// top of js/keymap.js. The rest are combinations nobody asks for.
const ALLOWED = [
  ["fire", "strafeL"], ["fire", "strafeR"], ["burst", "strafeL"],
  ["burst", "strafeR"], ["fire", "sleepfire"], ["landUse", "down"],
  // Sleepfire is a two-second deliberate hold from a hover. You are not
  // strafing through it, and you are not shooting through it either.
  ["sleepfire", "strafeL"], ["sleepfire", "strafeR"], ["sleepfire", "burst"],
  // Strafe and knife edge share the ring and the pinky. Strafe trims a line up
  // for a pass and knife edge rolls him onto a wingtip; they are two ways of
  // doing the same job and you pick one.
  ["strafeL", "knifeL"], ["strafeR", "knifeR"],
  // The point of the layout, not a casualty of it: knife-left and knife-right
  // are never both held, which is what lets them share the pinky and free a
  // whole finger for burst.
  ["knifeL", "knifeR"],
];
const seen = (list, x, y) =>
  list.some(([a, b]) => (a === x && b === y) || (a === y && b === x));

let bad = 0;
for (const id of Object.keys(SCHEMES)) {
  setScheme(id);
  console.log(`\n== ${SCHEMES[id].label} ==`);
  for (const [x, y] of MUST) {
    const any = together(x, y);
    const onKeys = together(x, y, true);
    if (!any) bad++;
    const k = (a) => keysFor(a).map(label).join("/") || "—";
    // "mouse" means the combination exists but not on the keyboard alone. That
    // is a real answer, not a failure — but it is worth seeing, because it is
    // the difference between a control and a control you need a mouse for.
    const mark = !any ? "FAIL " : onKeys ? "ok   " : "mouse";
    const use = any ? `   ← ${shown(any[0])} + ${shown(any[1])}` : "";
    console.log(`  ${mark} ${x} + ${y}`.padEnd(31) + `${k(x)} + ${k(y)}`.padEnd(16) + use);
  }
  // Anything else that cannot be held, so a new collision shows up here rather
  // than in the middle of a fight.
  const acts = ["fire", "sleepfire", "burst", "down", "up", "sprint", "landUse",
                "strafeL", "strafeR", "knifeL", "knifeR", "forward", "turnL"];
  const extra = [];
  for (let i = 0; i < acts.length; i++)
    for (let j = i + 1; j < acts.length; j++) {
      const [x, y] = [acts[i], acts[j]];
      if (together(x, y, true) || seen(MUST, x, y)) continue;
      extra.push(`${x} + ${y}` + (seen(ALLOWED, x, y) ? "" : "   <- NEW"));
    }
  console.log(`  one finger on the keyboard, so mutually exclusive:`);
  for (const e of extra) console.log(`    ${e}`);
}
console.log(bad ? `\n${bad} promised combination(s) impossible` : `\nall promised combinations reachable`);
process.exitCode = bad ? 1 : 0;
