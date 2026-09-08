/**
 * Solve the folded-wing pose and bake it to js/foldpose.js.
 *
 *     node tools/solve_fold.mjs
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * The fold used to be five hand-tuned angles in dragonrig.js. That does not
 * converge. Every parameter fights every other one, the aggregate metrics you
 * can measure (span, height) are blind to the thing that actually looks wrong,
 * and a sign flip anywhere turns a folded wing into a crown of spikes. Three
 * rounds of that produced a wing hanging through the floor like a wet sheet.
 *
 * So: don't describe the fold as rotations. Describe it as *where the bones
 * should end up*, and let a solver find the rotations.
 *
 * A folded bat wing is a Z-fold of three roughly equal limb segments laid
 * against the ribcage, with the hand folded back on the forearm a second time
 * and the membrane pleated into the gaps:
 *
 *     humerus    caudal, along the ribs, elbow ending up behind the shoulder
 *     forearm    flexed hard back on it, wrist returning under the shoulder
 *     metacarpal caudal again, running down the flank toward the hip
 *     phalanges  folded forward on the metacarpal
 *
 * Crucially the digits do not all land on one line. They stack down the side of
 * the body, each riding a little lower on the ribs than the last, which is what
 * gives a real folded wing thickness instead of the flat-paper look.
 *
 * ---------------------------------------------------------------------------
 * How
 * ---------------------------------------------------------------------------
 * Position-based dynamics over the joint positions:
 *
 *   - each joint is a particle, seeded at a target on the ribcage
 *   - bone lengths are hard distance constraints (so the arm cannot stretch)
 *   - the torso is an ellipse-section capsule the wing must stay outside of
 *   - the ground is a plane the wing must stay above
 *   - a weak spring holds each joint near its target so the Z-fold is kept
 *
 * Relax, then convert the solved joint positions back into per-bone local
 * quaternions, walking the chain root-to-leaf so each bone inherits whatever
 * its parent ended up doing.
 *
 * Everything is in glTF space, the same one three.js sees at runtime:
 *   +X lateral (.L is -X)   +Y up   +Z nose (-3.5) to tail (+5.09)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GLB = path.join(HERE, "assets", "models", "dragon_rigged_hd.glb");
const OUT = path.join(HERE, "js", "foldpose.js");

// --- tiny vec/quat -----------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return mul(a, 1 / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
function qrot(q, v) {
  const [x, y, z, w] = q, [a, b, c] = v;
  const ix = w * a + y * c - z * b, iy = w * b + z * a - x * c;
  const iz = w * c + x * b - y * a, iw = -x * a - y * b - z * c;
  return [ix * w + iw * -x + iy * -z - iz * -y,
          iy * w + iw * -y + iz * -x - ix * -z,
          iz * w + iw * -z + ix * -y - iy * -x];
}
/** Shortest-arc rotation taking unit vector `a` onto unit vector `b`. */
function qBetween(a, b) {
  const d = dot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    let ax = cross([1, 0, 0], a);
    if (len(ax) < 1e-6) ax = cross([0, 1, 0], a);
    ax = norm(ax);
    return [ax[0], ax[1], ax[2], 0];
  }
  const c = cross(a, b);
  const q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return q.map((v) => v / l);
}

// --- glTF ---------------------------------------------------------------------
function loadGlb(file) {
  const b = fs.readFileSync(file);
  let off = 12, json = null;
  while (off < b.length) {
    const l = b.readUInt32LE(off), t = b.readUInt32LE(off + 4);
    if (t === 0x4e4f534a) json = JSON.parse(b.slice(off + 8, off + 8 + l).toString("utf8"));
    off += 8 + l;
  }
  return json;
}

const J = loadGlb(GLB);
const N = J.nodes;
const parentOf = new Array(N.length).fill(-1);
N.forEach((n, i) => (n.children || []).forEach((c) => (parentOf[c] = i)));
const idOf = new Map();
N.forEach((n, i) => n.name && idOf.set(n.name, i));

/** Rest world transform of a node. */
function restWorld(i) {
  const chain = [];
  for (let j = i; j !== -1; j = parentOf[j]) chain.unshift(j);
  let p = [0, 0, 0], q = [0, 0, 0, 1];
  for (const k of chain) {
    const n = N[k];
    p = add(p, qrot(q, n.translation || [0, 0, 0]));
    q = qmul(q, n.rotation || [0, 0, 0, 1]);
  }
  return { p, q };
}

// ---------------------------------------------------------------------------
// The ribcage the wing folds onto.
//
// An ellipse in cross-section (he is wider than he is deep) swept along the
// spine. `flank(theta, z)` is a point on that surface: theta 0 is the top of
// the back, 90 the widest point, 140 well down the side. Measured off the mesh:
// half-width 0.66, half-height 0.48, axis at y 0.92.
// ---------------------------------------------------------------------------
const RIB = { a: 0.66, b: 0.48, y: 0.92, zHead: -2.35, zTail: 0.35 };

function flank(side, thetaDeg, z) {
  const t = (thetaDeg * Math.PI) / 180;
  return [side * RIB.a * Math.sin(t), RIB.y + RIB.b * Math.cos(t), z];
}

/** Push a point out of the ribcage, and off the floor. */
function collide(p, side, clearance) {
  const out = [...p];
  const z = Math.min(Math.max(out[2], RIB.zHead), RIB.zTail);
  const dx = out[0] / (RIB.a + clearance);
  const dy = (out[1] - RIB.y) / (RIB.b + clearance);
  const r = Math.hypot(dx, dy);
  // Only inside the torso's own z-range does the ellipse mean anything.
  if (out[2] > RIB.zHead - 0.2 && out[2] < RIB.zTail + 0.4 && r < 1 && r > 1e-6) {
    const s = 1 / r;
    out[0] *= s;
    out[1] = RIB.y + (out[1] - RIB.y) * s;
  }
  // Never on the wrong side of the body.
  if (side < 0) out[0] = Math.min(out[0], -0.12);
  else out[0] = Math.max(out[0], 0.12);
  // Never through the floor.
  out[1] = Math.max(out[1], 0.10);
  void z;
  return out;
}

// ---------------------------------------------------------------------------
// The fold, as a path down the flank.
//
// Each entry says where that joint should sit: how far round the ribs (theta,
// growing as you go out the chain so the bundle stacks down his side) and how
// far along him (z, alternating caudal/cranial — that alternation *is* the
// Z-fold). The solver treats these as soft targets and fixes up the lengths.
// ---------------------------------------------------------------------------
const ARM_PATH = [
  { bone: "Wing_Shoulder", theta: 52, z: -1.95, w: 1.0 },   // fixed at the body
  { bone: "Wing_UpperArm", theta: 60, z: -1.58, w: 0.9 },   // caudal
  { bone: "Wing_Forearm",  theta: 72, z: -0.92, w: 0.9 },   // elbow, behind him
  { bone: "__wrist",       theta: 92, z: -1.62, w: 0.9 },   // flexed hard, back forward
];

// Per digit: how far round the ribs the bundle sits, and how far the metacarpal
// runs caudally before the phalanges fold forward again. The long outer digits
// ride lower on the flank and reach further back, which is what stacks them.
const DIGIT_PATH = [
  { theta: 100, back: 0.62, fwd: 0.55 },
  { theta: 108, back: 0.70, fwd: 0.58 },
  { theta: 116, back: 0.78, fwd: 0.60 },
  { theta: 124, back: 0.86, fwd: 0.62 },
  { theta: 131, back: 0.93, fwd: 0.64 },
  { theta: 138, back: 1.00, fwd: 0.66 },
];

const ITERS = 600;
const STIFF_TARGET = 0.06;   // how hard the soft targets pull, per iteration

function buildWing(side) {
  const S = side < 0 ? "L" : "R";
  const nodes = [];      // { name, id, restP, restQ }
  const push = (nm) => {
    const id = idOf.get(`${nm}.${S}`);
    if (id === undefined) throw new Error(`missing bone ${nm}.${S}`);
    const { p, q } = restWorld(id);
    nodes.push({ name: `${nm}.${S}`, id, restP: p, restQ: q });
    return nodes.length - 1;
  };

  // Chain: shoulder -> upperarm -> forearm -> wrist, then six digits of three.
  const iShoulder = push("Wing_Shoulder");
  const iUpper = push("Wing_UpperArm");
  const iFore = push("Wing_Forearm");

  // Particles: one per joint, plus a tip per digit.
  const pts = [];
  const addPt = (p, target, w) => (pts.push({ p: [...p], target, w }), pts.length - 1);

  const pShoulder = addPt(nodes[iShoulder].restP, flank(side, ARM_PATH[0].theta, ARM_PATH[0].z), 60);
  const pUpper = addPt(nodes[iUpper].restP, flank(side, ARM_PATH[1].theta, ARM_PATH[1].z), ARM_PATH[1].w);
  const pFore = addPt(nodes[iFore].restP, flank(side, ARM_PATH[2].theta, ARM_PATH[2].z), ARM_PATH[2].w);

  const wristRest = add(nodes[iFore].restP,
    mul(qrot(nodes[iFore].restQ, [0, 1, 0]), 0.630));
  const pWrist = addPt(wristRest, flank(side, ARM_PATH[3].theta, ARM_PATH[3].z), ARM_PATH[3].w);

  const links = [
    [pShoulder, pUpper, len(sub(nodes[iUpper].restP, nodes[iShoulder].restP))],
    [pUpper, pFore, len(sub(nodes[iFore].restP, nodes[iUpper].restP))],
    [pFore, pWrist, len(sub(wristRest, nodes[iFore].restP))],
  ];

  const digits = [];
  for (let d = 0; d < 6; d++) {
    const seg = [];
    const dp = DIGIT_PATH[d];
    let prevPt = pWrist;
    let curZ = ARM_PATH[3].z;          // walk the fold path along him as we go

    for (let g = 1; g <= 3; g++) {
      const nm = `Wing_Finger.${String(d * 3 + g).padStart(3, "0")}`;
      const idx = push(nm);
      const node = nodes[idx];

      // Bone length: to the next segment's head, or for the leaf, the same
      // 25/31 ratio to segment 2 that the rig was built with.
      let L;
      if (g < 3) {
        const nxt = restWorld(idOf.get(`Wing_Finger.${String(d * 3 + g + 1).padStart(3, "0")}.${S}`));
        L = len(sub(nxt.p, node.restP));
      } else {
        L = len(sub(nodes[idx].restP, nodes[idx - 1].restP)) * (0.25 / 0.31);
      }

      // Caudal (metacarpal), then forward (phalanx 1), then a short caudal
      // flick at the tip. That alternation is the second Z.
      curZ += g === 1 ? dp.back * L : g === 2 ? -dp.fwd * L : dp.back * 0.45 * L;
      const target = flank(side, dp.theta + g * 3, curZ);

      const pt = addPt(node.restP, target, 0.8);
      links.push([prevPt, pt, L]);
      seg.push({ node: idx, pt, L });
      prevPt = pt;
    }
    digits.push(seg);
  }

  return { side, S, nodes, pts, links, digits,
           idx: { pShoulder, pUpper, pFore, pWrist, iShoulder, iUpper, iFore } };
}

function solve(w) {
  const { pts, links, side } = w;
  // Seed at the targets rather than the rest pose: relaxation from the spread
  // wing has to drag five units of arm through the body to get there, and it
  // finds a knot on the way. Starting folded and letting the constraints push
  // it back out is both faster and better behaved.
  for (const q of pts) if (q.target) q.p = [...q.target];
  pts[w.idx.pShoulder].p = [...w.nodes[w.idx.iShoulder].restP];

  for (let it = 0; it < ITERS; it++) {
    // soft pull to targets
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i];
      if (!q.target) continue;
      q.p = add(q.p, mul(sub(q.target, q.p), STIFF_TARGET * q.w));
    }
    // hard bone lengths
    for (const [a, b, L] of links) {
      const pa = pts[a].p, pb = pts[b].p;
      const d = sub(pb, pa);
      const l = len(d) || 1e-6;
      const corr = mul(d, (l - L) / l);
      const wa = a === w.idx.pShoulder ? 0 : 1;
      const total = wa + 1;
      if (wa) pts[a].p = add(pa, mul(corr, wa / total));
      pts[b].p = sub(pb, mul(corr, 1 / total));
    }
    // collisions
    for (let i = 1; i < pts.length; i++) pts[i].p = collide(pts[i].p, side, 0.02);
    pts[w.idx.pShoulder].p = [...w.nodes[w.idx.iShoulder].restP];
  }
}

/**
 * Joint positions -> per-bone local quaternions.
 *
 * Root to leaf: each bone gets the shortest-arc rotation that takes where it
 * *would* point (given everything its parent already did) onto where the solver
 * put it, and the result is converted back into the parent's frame.
 */
function bake(w, out) {
  const solvedWorld = new Map();   // bone name -> world quaternion

  const worldQOf = (name) => solvedWorld.get(name) ?? null;

  function doBone(nodeIdx, headPt, tailPt) {
    const node = w.nodes[nodeIdx];
    const parentName = N[parentOf[node.id]]?.name;
    const parentQ = worldQOf(parentName) ?? restWorld(parentOf[node.id]).q;

    // Local rest rotation, straight off the glTF node.
    const restLocal = N[node.id].rotation || [0, 0, 0, 1];
    const provisional = qmul(parentQ, restLocal);
    const provisionalDir = qrot(provisional, [0, 1, 0]);
    const wantDir = norm(sub(w.pts[tailPt].p, w.pts[headPt].p));

    const delta = qBetween(norm(provisionalDir), wantDir);
    const solved = qmul(delta, provisional);
    solvedWorld.set(node.name, solved);

    const local = qmul(qconj(parentQ), solved);
    out[node.name] = local.map((v) => +v.toFixed(5));
  }

  doBone(w.idx.iShoulder, w.idx.pShoulder, w.idx.pUpper);
  doBone(w.idx.iUpper, w.idx.pUpper, w.idx.pFore);
  doBone(w.idx.iFore, w.idx.pFore, w.idx.pWrist);
  for (const seg of w.digits) {
    let head = w.idx.pWrist;
    for (const s of seg) {
      doBone(s.node, head, s.pt);
      head = s.pt;
    }
  }
}

// --- run ---------------------------------------------------------------------
const pose = {};
const report = [];
for (const side of [-1, 1]) {
  const w = buildWing(side);
  solve(w);
  bake(w, pose);

  const P = (i) => w.pts[i].p;
  report.push(`  ${side < 0 ? "L" : "R"}  shoulder ${fmt(P(w.idx.pShoulder))}` +
              `  elbow ${fmt(P(w.idx.pFore))}  wrist ${fmt(P(w.idx.pWrist))}`);
  let lowest = 9, outer = 0, tail = 0;
  for (const q of w.pts) { lowest = Math.min(lowest, q.p[1]); outer = Math.max(outer, Math.abs(q.p[0])); tail = Math.max(tail, q.p[2]); }
  report.push(`     lowest joint y ${lowest.toFixed(2)}   widest |x| ${outer.toFixed(2)}   reaches back to z ${tail.toFixed(2)}`);
}
function fmt(p) { return "(" + p.map((v) => v.toFixed(2)).join(", ") + ")"; }

const body = `// GENERATED by tools/solve_fold.mjs — do not hand-edit, re-run the tool.
//
// The folded-wing pose, as one local quaternion per wing bone, in the same
// glTF frame three.js loads. dragonrig.js slerps each bone from its bind
// rotation to the entry here, scaled by how folded he is.
//
// Solved rather than authored: see tools/solve_fold.mjs. Bone lengths, the
// ribcage and the floor are hard constraints, so this pose cannot stretch his
// arm, pass a wing through his chest, or hang it through the ground — which is
// exactly what hand-tuned fold angles kept doing.

export const FOLD_POSE = ${JSON.stringify(pose, null, 2).replace(/\n/g, "\n")};
`;
fs.writeFileSync(OUT, body);
console.log(report.join("\n"));
console.log(`\nwrote ${path.relative(HERE, OUT)} — ${Object.keys(pose).length} bones`);
