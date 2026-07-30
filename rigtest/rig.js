import * as THREE from "three";

// ---------------------------------------------------------------------------
// Rig abstraction
//
// The problem this solves: every bone has its own roll, so "rotate about local
// X" means something different on the wing than on the tail. Rather than guess
// per-bone conventions, we derive three canonical axes for each bone from its
// REST world geometry:
//
//   flap  — positive rotation lifts the bone's tip           (up / down)
//   sweep — positive rotation swings the tip left, seen from above (fore / aft)
//   twist — rotation about the bone's own length             (roll)
//
// Animation is then authored as flap/sweep/twist regardless of how the rig was
// rolled in Blender, and it survives a re-rig.
// ---------------------------------------------------------------------------

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function boneAxes(bone) {
  bone.updateWorldMatrix(true, false);

  const q = new THREE.Quaternion();
  bone.getWorldQuaternion(q);

  // Direction the bone points, in world space.
  const dir = new THREE.Vector3();
  const child = bone.children.find((c) => c.isBone);
  if (child) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    bone.getWorldPosition(a);
    child.getWorldPosition(b);
    dir.subVectors(b, a);
  }
  // Leaf bones have no child to aim at, so fall back to Blender's convention
  // that a bone runs along its own local +Y.
  if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0).applyQuaternion(q);
  dir.normalize();

  // Rotating about (dir x up) by a positive angle carries the tip toward up:
  //   (dir x up) x dir  ==  up - dir*(dir . up)
  // ...which is world-up with the along-bone component removed.
  const flap = new THREE.Vector3().crossVectors(dir, WORLD_UP);
  if (flap.lengthSq() < 1e-6) flap.set(1, 0, 0); // bone is vertical; any axis will do
  flap.normalize();

  const qi = q.clone().invert();
  return {
    flap:  flap.clone().applyQuaternion(qi),
    sweep: WORLD_UP.clone().applyQuaternion(qi),
    twist: dir.clone().applyQuaternion(qi),
    dirWorld: dir,
  };
}

/**
 * Which sign of `sweep` folds each wing toward the TAIL.
 *
 * Sweep rotates about world up, which is the same axis for both wings — so a
 * positive rotation carries one wingtip backwards and the other forwards. The
 * correct sign per side is decided here from geometry instead of guessed:
 * take the tip's motion under a small positive rotation and check whether it
 * points the same way as the body's head->tail axis.
 */
function computeFoldSigns(bones) {
  const posOf = (name) => {
    const b = bones.get(name);
    if (!b) return null;
    const v = new THREE.Vector3();
    b.getWorldPosition(v);
    return v;
  };

  const head = posOf("Head");
  const tail = posOf("Tail006") || posOf("Tail011") || posOf("Tail_tip");
  const back = head && tail
    ? tail.clone().sub(head).setY(0).normalize()
    : new THREE.Vector3(0, 0, 1);

  const signs = {};
  for (const side of ["L", "R"]) {
    const shoulder = posOf(`Wing_UpperArm${side}`);
    const tip = posOf(`Wing_Finger003${side}`) || posOf(`Wing_Finger002${side}`);
    if (!shoulder || !tip) {
      signs[side] = side === "L" ? 1 : -1;
      continue;
    }
    const radius = tip.clone().sub(shoulder);
    const motion = new THREE.Vector3().crossVectors(WORLD_UP, radius);
    signs[side] = motion.dot(back) > 0 ? 1 : -1;
  }
  return signs;
}

export function buildRig(root) {
  const meshes = [];
  let skeleton = null;

  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      meshes.push(o);
      skeleton = skeleton || o.skeleton;
      o.frustumCulled = false;
    }
  });
  if (!skeleton) throw new Error("no skinned mesh found");

  // GLTFLoader strips [ ] . : / from names, so "Wing_Finger.001.L" arrives as
  // "Wing_Finger001L". Index by both so lookups can use either spelling.
  const bones = new Map();
  const rest = new Map();
  const axes = new Map();

  for (const b of skeleton.bones) {
    bones.set(b.name, b);
    rest.set(b.name, b.quaternion.clone());
    axes.set(b.name, boneAxes(b));
  }

  const tmp = new THREE.Quaternion();
  const accum = new Map(); // name -> quaternion delta for this frame
  const foldSigns = computeFoldSigns(bones);

  return {
    meshes,
    skeleton,
    foldSigns,
    names: skeleton.bones.map((b) => b.name),
    get(name) { return bones.get(name); },
    axesFor(name) { return axes.get(name); },

    /**
     * How many bones ride along when this one rotates. A high count on
     * something you think of as a neck or a limb means the armature is rooted
     * somewhere unexpected.
     */
    descendantCount(name) {
      const bone = bones.get(name);
      if (!bone) return 0;
      let n = 0;
      bone.traverse((o) => { if (o.isBone && o !== bone) n++; });
      return n;
    },

    /** Clear every bone back to its bind pose. Call once per frame. */
    reset() {
      accum.clear();
      for (const b of skeleton.bones) b.quaternion.copy(rest.get(b.name));
    },

    /**
     * Rotate a bone relative to its rest pose. Multiple calls on the same bone
     * compose, so a walk cycle and a manual override can both drive one joint.
     */
    pose(name, { flap = 0, sweep = 0, twist = 0 } = {}) {
      const bone = bones.get(name);
      if (!bone) return false;
      const ax = axes.get(name);

      let delta = accum.get(name);
      if (!delta) {
        delta = new THREE.Quaternion();
        accum.set(name, delta);
      }

      if (flap)  delta.multiply(tmp.setFromAxisAngle(ax.flap, flap));
      if (sweep) delta.multiply(tmp.setFromAxisAngle(ax.sweep, sweep));
      if (twist) delta.multiply(tmp.setFromAxisAngle(ax.twist, twist));

      bone.quaternion.copy(rest.get(name)).multiply(delta);
      return true;
    },

    /** Bones whose name matches a prefix, in skeleton order. */
    matching(prefix) {
      return skeleton.bones.map((b) => b.name).filter((n) => n.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// Weight visualisation — the point of the whole bench.
//
// Recolours the mesh by how much the selected bone influences each vertex,
// using Blender's weight-paint ramp (blue = 0, green = 0.5, red = 1). Vertices
// with no influence from ANY bone are flagged magenta, since those are the ones
// that will hang in space when the rig moves.
// ---------------------------------------------------------------------------

const RAMP = [
  { t: 0.0,  c: new THREE.Color(0x101a3a) },
  { t: 0.25, c: new THREE.Color(0x0066cc) },
  { t: 0.5,  c: new THREE.Color(0x11bb55) },
  { t: 0.75, c: new THREE.Color(0xdddd22) },
  { t: 1.0,  c: new THREE.Color(0xee2222) },
];
const UNWEIGHTED = new THREE.Color(0xff00ff);

function rampColor(w, out) {
  for (let i = 1; i < RAMP.length; i++) {
    if (w <= RAMP[i].t || i === RAMP.length - 1) {
      const a = RAMP[i - 1];
      const b = RAMP[i];
      const u = THREE.MathUtils.clamp((w - a.t) / (b.t - a.t), 0, 1);
      return out.copy(a.c).lerp(b.c, u);
    }
  }
  return out.copy(RAMP[0].c);
}

export function setupWeightView(rig) {
  const originals = rig.meshes.map((m) => m.material);
  const painted = rig.meshes.map(
    () => new THREE.MeshBasicMaterial({ vertexColors: true })
  );

  // Cache which vertices have no bone influence at all — same for every bone,
  // so it only has to be computed once.
  const orphanCounts = rig.meshes.map((m) => {
    const w = m.geometry.attributes.skinWeight;
    let n = 0;
    for (let i = 0; i < w.count; i++) {
      if (w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) < 1e-4) n++;
    }
    return n;
  });

  let active = false;
  const c = new THREE.Color();

  return {
    orphanTotal: orphanCounts.reduce((a, b) => a + b, 0),
    vertexTotal: rig.meshes.reduce((a, m) => a + m.geometry.attributes.position.count, 0),

    isActive: () => active,

    setActive(v) {
      active = v;
      rig.meshes.forEach((m, i) => { m.material = v ? painted[i] : originals[i]; });
    },

    /** Repaint for a given bone name. Returns stats for the readout. */
    paint(boneName) {
      const boneIndex = rig.skeleton.bones.findIndex((b) => b.name === boneName);
      if (boneIndex < 0) return null;

      let influenced = 0;
      let maxWeight = 0;
      let totalWeight = 0;

      for (const m of rig.meshes) {
        const geo = m.geometry;
        const si = geo.attributes.skinIndex;
        const sw = geo.attributes.skinWeight;
        const count = geo.attributes.position.count;

        let colors = geo.attributes.color;
        if (!colors || colors.count !== count) {
          colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
          geo.setAttribute("color", colors);
        }

        for (let i = 0; i < count; i++) {
          let w = 0;
          let total = 0;
          for (let k = 0; k < 4; k++) {
            const idx = si.getComponent(i, k);
            const wt = sw.getComponent(i, k);
            total += wt;
            if (idx === boneIndex) w += wt;
          }

          if (total < 1e-4) {
            c.copy(UNWEIGHTED);
          } else {
            rampColor(w, c);
            if (w > 1e-4) {
              influenced++;
              totalWeight += w;
              if (w > maxWeight) maxWeight = w;
            }
          }
          colors.setXYZ(i, c.r, c.g, c.b);
        }
        colors.needsUpdate = true;
      }

      return { influenced, maxWeight, totalWeight };
    },
  };
}
