// ---------------------------------------------------------------------------
// Folded-wing candidates, derived by probing the rig (see _probe.html).
//
// Three facts came out of the probe, none of them guessable from bone names:
//
//   1. Wing_Finger.016 -> .017 -> .018 is the MAIN SPAR — it carries the
//      wingtip and moves the span as much as the upper arm does. Digits
//      001-015 are short struts that barely move the tip at all. Rotating all
//      six chains hard is what splayed the membrane into flat sheets.
//   2. Wing_Shoulder on Z is the SWEEP, and it dominates. Sweep alone takes the
//      span from 3.10 to 0.76.
//   3. Both sides take the SAME sign on X and mirror only on Z. Negating X on
//      the right measured worse (2.74 vs 0.40).
//
// So a pose is four numbers: sweep, arm, the three spar angles, and an optional
// small amount on the minor struts. Measured spans are in each note.
// ---------------------------------------------------------------------------

const MINOR_RE = /^Wing_Finger(001|002|004|005|007|008|010|011|013|014)([LR])$/;

function pose(sweep, arm, spar, minor = 0) {
  return (bones) => {
    for (const [name, bone] of bones) {
      const side = name.endsWith("L") ? 1 : -1;

      if (/^Wing_Shoulder[LR]$/.test(name)) bone.rotation.z += sweep * side;
      else if (/^Wing_UpperArm[LR]$/.test(name)) bone.rotation.x += arm;
      else if (/^Wing_Finger016[LR]$/.test(name)) bone.rotation.x += spar[0];
      else if (/^Wing_Finger017[LR]$/.test(name)) bone.rotation.x += spar[1];
      else if (/^Wing_Finger018[LR]$/.test(name)) bone.rotation.x += spar[2];
      else if (minor && MINOR_RE.test(name)) bone.rotation.x += minor;
    }
  };
}

export const POSES = [
  { name: "Tucked", note: "Span 0.40 m. The tightest clean fold — wings packed along the flank. Current default.",
    apply: pose(1.80, 1.00, [1.10, 0.70, 0.35]) },

  { name: "Resting", note: "Span 0.76 m. A touch looser; the membrane still reads as a wing rather than a bundle.",
    apply: pose(1.60, 0.90, [1.00, 0.60, 0.30]) },

  { name: "Loose", note: "Span 0.92 m. Folded but not packed — he hasn't settled yet.",
    apply: pose(1.40, 0.80, [0.90, 0.50, 0.25]) },

  { name: "Very Tight", note: "Past Tucked. Check for the wing clipping into the body before using this one.",
    apply: pose(2.00, 1.10, [1.20, 0.80, 0.40]) },

  { name: "Sweep Only", note: "Shoulder Z alone, nothing else. Proves how much of the fold the sweep is doing.",
    apply: pose(1.80, 0, [0, 0, 0]) },

  { name: "Arm Led", note: "Upper arm does the work instead of the sweep. Higher shoulder line.",
    apply: pose(1.00, 2.00, [1.00, 0.60, 0.30]) },

  { name: "Tucked + Struts", note: "Tucked, plus a little curl on the minor struts so the membrane creases.",
    apply: pose(1.80, 1.00, [1.10, 0.70, 0.35], 0.30) },

  { name: "Half Open", note: "Landing or about to leave. The transition pose, not a resting one.",
    apply: pose(0.90, 0.50, [0.60, 0.30, 0.15]) },

  { name: "Old: Flat Rotate", note: "Every finger bone by the same angle. Kept to show what was wrong before.",
    apply(bones) {
      for (const [name, bone] of bones) {
        if (/^Wing_(Shoulder|UpperArm)[LR]$/.test(name)) bone.rotation.x += -2.0;
        else if (/^Wing_Finger\d+[LR]$/.test(name)) bone.rotation.x += -0.85;
      }
    } },

  { name: "Old: Scale Collapse", note: "Struts shrunk instead of rotated. Cheap, and wrong.",
    apply(bones) {
      for (const [name, bone] of bones) {
        if (/^Wing_(Shoulder|UpperArm)[LR]$/.test(name)) bone.rotation.x += -1.90;
        else if (/^Wing_Finger\d+[LR]$/.test(name)) bone.scale.setScalar(0.18);
      }
    } },
];

/** Reset the wing bones to bind, then apply pose `i`. */
export function applyPose(bones, rest, i) {
  for (const [name, bone] of bones) {
    if (!/^Wing_/.test(name)) continue;
    const r = rest.get(name);
    if (r) bone.rotation.set(r.x, r.y, r.z);
    bone.scale.setScalar(1);
  }
  const p = POSES[i];
  if (p) p.apply(bones);
  return p;
}
