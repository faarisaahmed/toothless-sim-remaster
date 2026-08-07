// ---------------------------------------------------------------------------
// Controller overlay — P
//
// A picture of the pad with every input lit up as it's pressed. The point isn't
// decoration: when the haptics work and the dragon doesn't move, the question
// is whether the input is arriving at all, and if it is, where it's getting
// lost. This answers the first half at a glance, and the header says which of
// the two input paths — Gamepad API or WebHID — the answer came from.
//
// It deliberately draws what the GAME sees, deadzone and response curve
// already applied, not the raw axes. A stick that reads 0.04 raw and 0 here is
// working correctly; a stick that reads 0 in both is not.
// ---------------------------------------------------------------------------

import { BTN } from "./gamepad.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Geometry is all in the viewBox below. Front view, sticks at the bottom.
const BODY = `
  M 148 84 L 372 84
  C 404 84 424 98 428 126
  C 433 162 426 192 416 216
  C 406 242 404 276 396 306
  C 385 346 360 366 331 363
  C 303 360 290 340 283 310
  C 277 284 271 272 260 272
  C 249 272 243 284 237 310
  C 230 340 217 360 189 363
  C 160 366 135 346 124 306
  C 116 276 114 242 104 216
  C 94 192 87 162 92 126
  C 96 98 116 84 148 84 Z`;

// The two dome-shaped triggers standing above the shoulders.
const TRIGGER_L = "M 133 68 C 129 38 146 22 164 22 C 182 22 199 38 195 68 Z";
const TRIGGER_R = "M 325 68 C 321 38 338 22 356 22 C 374 22 391 38 387 68 Z";

const DPAD = {
  up:    "M 152 126 L 169 145 L 169 152 L 135 152 L 135 145 Z",
  down:  "M 152 202 L 169 183 L 169 176 L 135 176 L 135 183 Z",
  left:  "M 114 164 L 133 147 L 140 147 L 140 181 L 133 181 Z",
  right: "M 190 164 L 171 147 L 164 147 L 164 181 L 171 181 Z",
};

const FACE = {
  triangle: [368, 124],
  circle:   [408, 164],
  cross:    [368, 204],
  square:   [328, 164],
};

const STICK_L = [204, 252];
const STICK_R = [316, 252];
const STICK_R_OUTER = 34;
const STICK_TRAVEL = 17; // how far the cap moves at full deflection

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

// The glyph inside a face button, drawn rather than typed so it lines up.
function glyph(kind, cx, cy) {
  const g = el("g", { class: "pv-glyph" });
  const r = 8;
  if (kind === "triangle") {
    g.append(el("path", { d: `M ${cx} ${cy - r} L ${cx + r} ${cy + r * 0.7} L ${cx - r} ${cy + r * 0.7} Z` }));
  } else if (kind === "circle") {
    g.append(el("circle", { cx, cy, r: r - 0.5 }));
  } else if (kind === "square") {
    g.append(el("rect", { x: cx - r + 1, y: cy - r + 1, width: (r - 1) * 2, height: (r - 1) * 2, rx: 1.5 }));
  } else {
    g.append(el("path", { d: `M ${cx - r} ${cy - r} L ${cx + r} ${cy + r}` }));
    g.append(el("path", { d: `M ${cx + r} ${cy - r} L ${cx - r} ${cy + r}` }));
  }
  return g;
}

export function setupPadView(pad) {
  const root = document.getElementById("padview");
  if (!root) return { toggle: () => false, update: () => {}, isOpen: () => false };

  const head = document.createElement("div");
  head.className = "pv-head";
  const title = document.createElement("span");
  title.className = "pv-title";
  title.textContent = "Controller";
  const srcTag = document.createElement("span");
  srcTag.className = "pv-src";
  head.append(title, srcTag);

  const svg = el("svg", { viewBox: "0 0 520 400", class: "pv-svg" });

  // --- static shell ---
  svg.append(el("path", { d: BODY, class: "pv-shell" }));

  const touchpad = el("rect", { x: 196, y: 96, width: 128, height: 72, rx: 10, class: "pv-shell" });
  // Shoulder bars sit behind the body's top edge.
  const l1 = el("rect", { x: 112, y: 62, width: 100, height: 20, rx: 9, class: "pv-shell" });
  const r1 = el("rect", { x: 308, y: 62, width: 100, height: 20, rx: 9, class: "pv-shell" });
  svg.append(touchpad, l1, r1);

  // --- triggers, with a fill that tracks the analog pull ---
  const defs = el("defs", {});
  const clips = {};
  for (const side of ["l", "r"]) {
    const clip = el("clipPath", { id: `pv-clip-${side}2` });
    // y is driven from the bottom of the dome upward as the trigger is pulled.
    const rect = el("rect", { x: 120, y: 68, width: 280, height: 0 });
    clip.append(rect);
    defs.append(clip);
    clips[side] = rect;
  }
  svg.append(defs);

  for (const [side, d] of [["l", TRIGGER_L], ["r", TRIGGER_R]]) {
    svg.append(el("path", { d, class: "pv-fill", "clip-path": `url(#pv-clip-${side}2)` }));
    svg.append(el("path", { d, class: "pv-shell" }));
  }

  // --- d-pad ---
  const dpadNodes = {};
  for (const key in DPAD) {
    const node = el("path", { d: DPAD[key], class: "pv-shell" });
    dpadNodes[key] = node;
    svg.append(node);
  }

  // --- face buttons ---
  const faceNodes = {};
  for (const key in FACE) {
    const [cx, cy] = FACE[key];
    const node = el("circle", { cx, cy, r: 17, class: "pv-shell" });
    faceNodes[key] = node;
    svg.append(node);
    svg.append(glyph(key, cx, cy));
  }

  // --- sticks ---
  const stickCaps = {};
  for (const [key, [cx, cy]] of [["l", STICK_L], ["r", STICK_R]]) {
    svg.append(el("circle", { cx, cy, r: STICK_R_OUTER, class: "pv-shell pv-faint" }));
    const cap = el("circle", { cx, cy, r: 20, class: "pv-shell" });
    stickCaps[key] = cap;
    svg.append(cap);
  }

  // --- small buttons ---
  const create = el("path", { d: "M 122 100 L 136 100 L 129 114 Z", class: "pv-shell" });
  const options = el("path", { d: "M 384 100 L 398 100 L 391 114 Z", class: "pv-shell" });
  const ps = el("circle", { cx: 260, cy: 252, r: 11, class: "pv-shell" });
  svg.append(create, options, ps);

  const foot = document.createElement("div");
  foot.className = "pv-foot";

  root.append(head, svg, foot);

  let open = false;
  let lastFoot = "";

  // A button is "lit" when the game would act on it. `held` rather than
  // `pressed` so a button you're leaning on stays lit rather than flashing for
  // a frame — this is a picture of state, not of edges.
  const lit = (node, on) => node.classList.toggle("on", !!on);

  function update() {
    if (!open) return;

    const on = pad.connected();
    const src = pad.source();
    srcTag.textContent = !on
      ? "no controller"
      : src === "hid" ? "WebHID · direct"
      : src === "gamepad" ? "Gamepad API"
      : "—";
    srcTag.classList.toggle("bad", !on);

    lit(faceNodes.cross,    pad.held(BTN.CROSS));
    lit(faceNodes.circle,   pad.held(BTN.CIRCLE));
    lit(faceNodes.square,   pad.held(BTN.SQUARE));
    lit(faceNodes.triangle, pad.held(BTN.TRIANGLE));

    lit(dpadNodes.up,    pad.held(BTN.DUP));
    lit(dpadNodes.down,  pad.held(BTN.DDOWN));
    lit(dpadNodes.left,  pad.held(BTN.DLEFT));
    lit(dpadNodes.right, pad.held(BTN.DRIGHT));

    lit(l1, pad.held(BTN.L1));
    lit(r1, pad.held(BTN.R1));
    lit(touchpad, pad.held(BTN.TOUCHPAD));
    lit(create,  pad.held(BTN.CREATE));
    lit(options, pad.held(BTN.OPTIONS));
    lit(ps,      pad.held(BTN.PS));

    // Triggers: the dome fills from the bottom as it's pulled.
    const l2 = pad.value(BTN.L2);
    const r2 = pad.value(BTN.R2);
    clips.l.setAttribute("y", 68 - 46 * l2);
    clips.l.setAttribute("height", 46 * l2);
    clips.r.setAttribute("y", 68 - 46 * r2);
    clips.r.setAttribute("height", 46 * r2);

    stickCaps.l.setAttribute("cx", STICK_L[0] + pad.lx * STICK_TRAVEL);
    stickCaps.l.setAttribute("cy", STICK_L[1] + pad.ly * STICK_TRAVEL);
    stickCaps.r.setAttribute("cx", STICK_R[0] + pad.rx * STICK_TRAVEL);
    stickCaps.r.setAttribute("cy", STICK_R[1] + pad.ry * STICK_TRAVEL);
    lit(stickCaps.l, pad.held(BTN.L3));
    lit(stickCaps.r, pad.held(BTN.R3));

    // Numbers underneath, because "the stick moved a bit" and "the stick moved
    // 0.02" look identical on a diagram.
    const f = (v) => (v < 0 ? "" : "+") + v.toFixed(2);
    const text =
      `L ${f(pad.lx)} ${f(pad.ly)}   R ${f(pad.rx)} ${f(pad.ry)}   ` +
      `L2 ${l2.toFixed(2)}  R2 ${r2.toFixed(2)}`;
    if (text !== lastFoot) { foot.textContent = text; lastFoot = text; }
  }

  return {
    isOpen: () => open,
    toggle() {
      open = !open;
      root.hidden = !open;
      if (open) update();
      return open;
    },
    update,
  };
}
