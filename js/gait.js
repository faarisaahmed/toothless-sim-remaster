import * as THREE from "three";

// ---------------------------------------------------------------------------
// How he moves on the ground.
//
// He is a cat with wings — the film animators built him off a black panther
// and a dog — so this is built off how big cats and other quadrupeds actually
// move, not off a sine wave per leg:
//
//  1. GAITS CHANGE WITH SPEED, and where they change is set by leg length.
//     Across every quadruped from a mouse to a rhino, the walk gives way to the
//     trot at a Froude number (v^2 / g h, h the hip height) of about 0.5, and
//     the trot to the gallop at about 2-2.5 (Alexander & Jayes, 1983). His hips
//     are a metre up, so: walk below ~2 m/s, trot to ~5, then gallop.
//
//       walk    lateral sequence — hind left, fore left, hind right, fore right
//               — each foot down two thirds of the cycle, three feet on the
//               ground most of the time. Head nods twice a stride.
//       trot    diagonal pairs together, each foot down a little under half the
//               cycle, a moment of suspension between pairs. The body bobs
//               twice a stride; the head stays level.
//       gallop  the big cat's rotary gallop: the hind feet land close together,
//               then the fore feet, leading on opposite sides. Each foot is
//               down a quarter of the cycle. The spine does the work — it
//               coils as the hind feet reach forward under the chest
//               (gathered) and stretches as they drive (extended), and the
//               body pitches with it.
//
//  2. FEET DO NOT SLIDE. A foot on the ground is planted at a point in the
//     world and stays there; the leg is solved to it (two-bone IK for the
//     upper and lower leg, the metatarsal set by phase, the toes flat on the
//     ground). A foot in the air flies to where it will next be needed: where
//     the body will be over it half a stance from now, given how fast he is
//     going and turning. Steps lengthen with speed on their own.
//
//  3. THE GROUND IS REAL. Every foot lands on the height field under it, so
//     on a slope the uphill legs bend and the downhill ones reach.
//
//  4. THE BODY MOVES LIKE IT HAS MASS. It bobs at its gait's rhythm, rolls a
//     little over each supporting side at a walk, leans into turns the way a
//     running animal must (tan lean = v·ω / g), and the head is stabilised
//     against all of it — which is the single most "alive" thing an animal's
//     head does.
//
// When he stops, any foot left out of place takes a last settling step.
// ---------------------------------------------------------------------------

const G = 9.81;
// How far the neck lifts when he is on the move, radians spread down the neck.
let HEAD_CARRY = 0.35;
export function _setHeadCarry(v) { HEAD_CARRY = v; }

// Leg order everywhere below: fore left, fore right, hind left, hind right.
const GAITS = {
  walk:   { offsets: [0.25, 0.75, 0.0, 0.5], duty: 0.66, lift: 0.11 },
  trot:   { offsets: [0.5, 0.0, 0.0, 0.5],   duty: 0.44, lift: 0.15 },
  gallop: { offsets: [0.62, 0.5, 0.0, 0.1],  duty: 0.26, lift: 0.22 },
};

/** Gait weights at a speed, for a hip height. Smooth, overlapping blends. */
function gaitWeights(v, hip) {
  const fr = (v * v) / (G * hip);
  const toTrot = THREE.MathUtils.smoothstep(fr, 0.32, 0.62);
  const toGallop = THREE.MathUtils.smoothstep(fr, 1.9, 3.2);
  return { walk: 1 - toTrot, trot: toTrot * (1 - toGallop), gallop: toGallop };
}

/** Stride frequency, Hz, for a speed and hip height. */
function strideHz(v, hip, w) {
  // Frequencies scale with sqrt(g / h); these are for a 1 m hip and fitted to
  // the ranges measured on horses, dogs and big cats.
  const s = Math.sqrt(1 / hip);
  const walk = 0.75 + 0.42 * v;
  const trot = 1.55 + 0.16 * v;
  const gallop = 2.3 + 0.07 * v;
  return s * (walk * w.walk + trot * w.trot + gallop * w.gallop);
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3();
const _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _posW = new THREE.Vector3(), _qW = new THREE.Quaternion(), _fz = new THREE.Vector3();

/** Turn `bone` about its own origin so its child at `childW` would sit at `targetW`. */
function aim(bone, childW, targetW) {
  const P = bone.getWorldPosition(_a);
  const u = _b.copy(childW).sub(P);
  const v = _c.copy(targetW).sub(P);
  if (u.lengthSq() < 1e-10 || v.lengthSq() < 1e-10) return;
  u.normalize(); v.normalize();
  _q.setFromUnitVectors(u, v);
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(_q);                               // new world rotation
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

const wpos = (b) => b.getWorldPosition(new THREE.Vector3());

/**
 * @param {THREE.Object3D} root   the dragon (what main.js moves and turns)
 * @param {Map} bones             name -> bone, from bindDragon
 * @param {Map} restQ             name -> bind quaternion
 */
export function createGait(root, bones, restQ) {
  const get = (n) => bones.get(n) || null;
  const legs = [
    { name: "FL", a: get("UpperArmL"), b: get("ForearmL"), c: get("WristL"), d: get("Front_ToeL"), e: get("Front_Digit002L") || get("Front_Digit001L"), fore: true },
    { name: "FR", a: get("UpperArmR"), b: get("ForearmR"), c: get("WristR"), d: get("Front_ToeR"), e: get("Front_Digit002R") || get("Front_Digit001R"), fore: true },
    { name: "HL", a: get("ThighL"), b: get("ShinL"), c: get("AnkleL"), d: get("ToeL"), e: get("Hind_Digit002L") || get("Hind_Digit001L"), fore: false },
    { name: "HR", a: get("ThighR"), b: get("ShinR"), c: get("AnkleR"), d: get("ToeR"), e: get("Hind_Digit002R") || get("Hind_Digit001R"), fore: false },
  ];
  if (legs.some((l) => !l.a || !l.b || !l.c || !l.d)) return null;

  const hips = get("Hips");
  const spines = [get("Spine"), get("Spine001"), get("Spine002")].filter(Boolean);
  const neck = [get("Neck001"), get("Neck002"), get("Neck003")].filter(Boolean);
  const head = get("Head");
  const tail = [];
  for (let i = 1; i <= 11; i++) { const b = get(`Tail${String(i).padStart(3, "0")}`); if (b) tail.push(b); }

  // --- Measure the bind pose ----------------------------------------------
  // Lengths and heights in world units (the root may be scaled, as it is in
  // the prologue); directions in the root's own frame, so they turn with him.
  for (const L of legs) for (const b of [L.a, L.b, L.c, L.d]) { const q0 = restQ.get(b.name); if (q0) b.quaternion.copy(q0); }
  root.updateMatrixWorld(true);
  const rootW = root.getWorldPosition(new THREE.Vector3());
  const toLocal = (b) => root.worldToLocal(wpos(b));
  for (const L of legs) {
    const Aw = wpos(L.a), Bw = wpos(L.b), Cw = wpos(L.c), Dw = wpos(L.d);
    L.l1 = Aw.distanceTo(Bw);
    L.l2 = Bw.distanceTo(Cw);
    L.l3 = Cw.distanceTo(Dw);
    L.toeLen = L.e ? Dw.distanceTo(wpos(L.e)) : 0.12;
    L.toeH = Dw.y - rootW.y;                  // the toe joint's height off the ground
    const A = toLocal(L.a), B = toLocal(L.b), C = toLocal(L.c), D = toLocal(L.d);
    L.home = D.clone();                       // where the toe joint stands
    // Which way the knee/elbow bends: the bind knee off the hip-ankle line.
    const axis = C.clone().sub(A).normalize();
    const kb = B.clone().sub(A);
    L.pole = kb.sub(axis.multiplyScalar(kb.dot(axis))).normalize();
    // The metatarsal's lean in the bind pose, from vertical toward the tail.
    const md = C.clone().sub(D);
    L.meta0 = Math.atan2(md.z * TAILWARD_SIGN(root), md.y);
    // State.
    L.plant = null;                           // world point while on the ground
    L.liftFrom = new THREE.Vector3();
    L.foot = new THREE.Vector3();             // current toe-joint target, world
    L.down = true;
    L.wasDown = true;
  }
  const hipH = (wpos(legs[2].a).y + wpos(legs[3].a).y) / 2 - rootW.y;
  const worldScale = root.getWorldScale(new THREE.Vector3()).y || 1;
  const hipsRestPos = hips ? hips.position.clone() : null;
  console.info(`gait: hip ${hipH.toFixed(2)} m, legs ${legs.map((l) => `${l.name} ${(l.l1 + l.l2 + l.l3).toFixed(2)}`).join(" ")}, toe ${legs[0].toeH.toFixed(2)}`);

  let phase = 0;
  let still = true;
  let lean = 0, pitchK = 0, bobK = 0;
  let headYawLag = 0;
  let carry = 0;
  const vel = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  let prevYaw = null, yawRate = 0;
  let first = true;

  function resetBone(b) {
    const q = restQ.get(b.name);
    if (q) b.quaternion.copy(q);
  }

  /**
   * @param {number} dt
   * @param {object} o
   *   groundAt(x, z)  height of the ground
   *   moveAmt         0..1 how much he is trying to move (for idle)
   */
  function update(rawDt, o) {
    // Velocity is measured over the real frame; everything that integrates is
    // clamped, so a hitch does not throw the legs half a stride.
    const dt = Math.min(rawDt, 0.05);
    const groundAt = o.groundAt;

    // --- Where is he going? Measured, not told, so it can never disagree
    // with how he actually moved this frame.
    const pos = root.getWorldPosition(_posW);
    root.getWorldQuaternion(_qW);
    const fz = _fz.set(0, 0, 1).applyQuaternion(_qW);
    const yawNow = Math.atan2(fz.x, fz.z);
    if (first) { prevPos.copy(pos); prevYaw = yawNow; first = false; }
    _v.copy(pos).sub(prevPos).divideScalar(Math.max(rawDt, 1e-4));
    _v.y = 0;
    vel.lerp(_v, 1 - Math.exp(-14 * dt));
    let dy = yawNow - prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yawRate += (dy / Math.max(rawDt, 1e-4) - yawRate) * (1 - Math.exp(-10 * dt));
    prevPos.copy(pos); prevYaw = yawNow;
    const speed = vel.length();

    const w = gaitWeights(speed, hipH);
    const duty = GAITS.walk.duty * w.walk + GAITS.trot.duty * w.trot + GAITS.gallop.duty * w.gallop;
    const lift = (GAITS.walk.lift * w.walk + GAITS.trot.lift * w.trot + GAITS.gallop.lift * w.gallop) * hipH;
    const offsets = [0, 1, 2, 3].map((i) =>
      GAITS.walk.offsets[i] * w.walk + GAITS.trot.offsets[i] * w.trot + GAITS.gallop.offsets[i] * w.gallop);

    // Turning on the spot is a walk too: the feet have to step round.
    const turning = Math.abs(yawRate) * 1.4;
    const effV = Math.max(speed, turning);
    const hz = strideHz(Math.max(effV, 0.6), hipH, w);
    const T = 1 / hz;

    // --- Reset the bones the gait owns to bind, then pose the body. -------
    for (const L of legs) for (const b of [L.a, L.b, L.c, L.d]) resetBone(b);
    for (const b of spines) resetBone(b);
    for (const b of neck) resetBone(b);
    if (head) resetBone(head);
    for (const b of tail) resetBone(b);

    // Stopped with every foot where it belongs? Then stand.
    const moving = effV > 0.12;
    if (moving) still = false;
    else if (!still) {
      // Keep stepping until every foot has come home.
      let settled = true;
      for (const L of legs) {
        const home = root.localToWorld(L.home.clone());
        if (!L.down || (L.plant && Math.hypot(L.plant.x - home.x, L.plant.z - home.z) > 0.12)) settled = false;
      }
      if (settled) still = true;
    }
    if (!still) phase = (phase + dt / T) % 1;

    const gallopK = w.gallop, trotK = w.trot, walkK = w.walk;
    const amp = still ? 0 : THREE.MathUtils.clamp(effV / 1.2, 0.35, 1);

    // Body: bob, pitch, roll.
    //   walk   — two shallow dips a stride, a sway over the supporting side
    //   trot   — two bounces a stride
    //   gallop — one big heave: up and nose-up as the fore feet push off,
    //            down and nose-down onto them
    const ph = phase * Math.PI * 2;
    const size = hipH;                          // everything below is for a 1 m hip
    const bob = size * (still ? 0 :
      (-Math.cos(ph * 2) * 0.012 * walkK + -Math.cos(ph * 2) * 0.03 * trotK +
       (Math.sin(ph - 0.6) * 0.05 + 0.045) * gallopK) * amp);
    const sway = still ? 0 : Math.sin(ph) * 0.035 * walkK * amp;
    const heave = still ? 0 : Math.sin(ph + 0.9) * 0.03 * gallopK;
    // Lean into the turn: what a running animal has to do to not fall over.
    const wantLean = THREE.MathUtils.clamp(Math.atan2(speed * yawRate, G), -0.38, 0.38);
    lean += (wantLean - lean) * (1 - Math.exp(-6 * dt));

    if (hips && hipsRestPos) {
      hips.position.copy(hipsRestPos);
      hips.position.y += bob / worldScale;
    }
    // Spine: the gallop's coil and stretch, split along the back; a walk's
    // gentle side-to-side, which a quadruped's spine does as each hind leg
    // swings.
    // The flex is a bend in the middle of the back, not a tilt of the whole
    // body: the loins arch and the chest counter-bends, so the shoulders stay
    // nearly level while the hind legs swing far under him and back out.
    const flex = still ? 0 : Math.sin(ph + 0.4) * 0.14 * gallopK;
    const FLEX_SPLIT = [1.0, 0.25, -0.85];
    spines.forEach((b, i) => {
      b.rotateX(flex * FLEX_SPLIT[i] + (i === 0 ? heave : 0));
      b.rotateY(Math.sin(ph) * 0.05 * walkK * amp * (i === 1 ? 1 : 0.5) - yawRate * 0.05);
      b.rotateZ((sway + lean * 0.6) * (i === 0 ? 1 : 0.4));
    });

    // Breath, when standing.
    const breath = Math.sin(performance.now() * 0.0011) * 0.012;
    if (spines[1]) spines[1].rotateX(breath * (still ? 1 : 0.3));

    root.updateMatrixWorld(true);

    // --- Feet ---------------------------------------------------------------
    const fwd = _w.set(0, 0, 1).applyQuaternion(_qW);
    fwd.y = 0; fwd.normalize();
    const nose = TAILWARD_SIGN(root) > 0 ? fwd.clone().negate() : fwd.clone();
    const upW = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < 4; i++) {
      const L = legs[i];
      const p = still ? 0 : ((phase - offsets[i]) % 1 + 1) % 1;
      const down = still || p < duty;
      const home = root.localToWorld(L.home.clone());
      // Where this foot is carried by the body's motion: its own velocity,
      // including the part from turning (v + omega x r).
      const r = home.clone().sub(pos);
      const footVel = vel.clone().add(new THREE.Vector3(r.z * yawRate, 0, -r.x * yawRate).multiplyScalar(0.6));
      // Land so that mid-stance has the foot under its hip.
      const reach = footVel.clone().multiplyScalar(duty * T * 0.5);
      const target = home.clone().add(reach);
      target.y = groundAt(target.x, target.z) + L.toeH;

      if (first || !L.plant) {
        L.plant = home.clone();
        L.plant.y = groundAt(home.x, home.z) + L.toeH;
      }

      if (down) {
        if (!L.wasDown) {
          // Touchdown: plant where the swing was heading.
          L.plant.copy(target);
        }
        if (still) {
          // Standing: settle each foot gently onto the ground under it.
          L.plant.y = groundAt(L.plant.x, L.plant.z) + L.toeH;
        }
        L.foot.copy(L.plant);
      } else {
        if (L.wasDown) L.liftFrom.copy(L.plant);
        const s = (p - duty) / (1 - duty);
        const k = s * s * (3 - 2 * s);
        L.foot.lerpVectors(L.liftFrom, target, k);
        // Lift: highest a little before the middle — the foot snaps up off the
        // ground and reaches out low.
        L.foot.y += Math.sin(Math.PI * Math.pow(s, 0.8)) * lift * amp;
      }
      L.p = p; L.s = down ? p / Math.max(duty, 1e-3) : (p - duty) / (1 - duty);
      L.wasDown = down;
      L.down = down;
    }

    // --- Solve the legs -----------------------------------------------------
    for (const L of legs) {
      // The metatarsal (hind) or the pastern (fore): its lean through the
      // stride. Touchdown near its bind angle, then the heel comes up as the
      // foot rolls through to push off, and in the air the foot flexes and
      // trails before swinging forward.
      let meta;
      if (L.down) {
        const s = still ? 0.4 : L.s;
        meta = L.meta0 + THREE.MathUtils.lerp(0.18, -0.55, Math.pow(s, 1.6)) * amp * (L.fore ? 0.9 : 1);
      } else {
        const s = L.s;
        meta = L.meta0 + (L.fore ? -0.85 : -0.7) * Math.sin(Math.PI * Math.min(1, s * 1.2)) * amp
             + THREE.MathUtils.lerp(-0.55, 0.18, s) * amp * 0.6;
      }
      const back = nose.clone().negate();
      const C = L.foot.clone()
        .addScaledVector(upW, Math.cos(meta) * L.l3)
        .addScaledVector(back, Math.sin(meta) * L.l3);

      // Two-bone IK, hip (or shoulder) to the hock (or wrist).
      const A = wpos(L.a);
      const toT = C.clone().sub(A);
      let d = toT.length();
      const maxD = (L.l1 + L.l2) * 0.999, minD = Math.abs(L.l1 - L.l2) + 0.01;
      d = THREE.MathUtils.clamp(d, minD, maxD);
      const axis = toT.normalize();
      const Ct = A.clone().addScaledVector(axis, d);
      const along = (L.l1 * L.l1 - L.l2 * L.l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L.l1 * L.l1 - along * along));
      const poleW = L.pole.clone().transformDirection(root.matrixWorld);
      poleW.addScaledVector(axis, -poleW.dot(axis)).normalize();
      const knee = A.clone().addScaledVector(axis, along).addScaledVector(poleW, h);

      aim(L.a, wpos(L.b), knee);
      aim(L.b, wpos(L.c), Ct);
      aim(L.c, wpos(L.d), L.foot);
      // Toes: flat on the ground while it carries weight, curled in the air.
      if (L.e) {
        const curl = L.down ? 0 : 0.7 * Math.sin(Math.PI * L.s) * amp;
        const tip = L.foot.clone()
          .addScaledVector(nose, Math.cos(curl) * L.toeLen)
          .addScaledVector(upW, -Math.sin(curl) * L.toeLen);
        tip.y = Math.max(tip.y, L.down ? groundAt(tip.x, tip.z) + L.toeH * 0.5 : -1e9);
        aim(L.d, wpos(L.e), tip);
      }
    }

    // --- Head and tail -------------------------------------------------------
    // The head holds its line in the world while the body moves under it: it
    // counters the bob and the pitch, and looks a little into a turn before
    // the body gets there.
    headYawLag += (THREE.MathUtils.clamp(yawRate * 0.35, -0.4, 0.4) - headYawLag) * (1 - Math.exp(-5 * dt));
    const nod = still ? 0 : Math.sin(ph * 2 + 0.5) * 0.05 * walkK * amp;
    // Moving, he carries his head up and out, level with his back, the way a
    // trotting dog or cat does; standing, he lets it sink to his rest pose.
    carry += ((still ? 0 : HEAD_CARRY) - carry) * (1 - Math.exp(-3 * dt));
    neck.forEach((b, i) => {
      b.rotateX(-heave * 0.5 + flex * 0.15 + nod * 0.4 + carry * (i === 0 ? 0.5 : 0.25));
      b.rotateY(headYawLag * 0.3);
      b.rotateZ(-(sway + lean * 0.6) * 0.3);
    });
    if (head) {
      head.rotateX(-heave * 0.4 + nod * 0.6 - bob * 0.8);
      head.rotateY(headYawLag * 0.35 + Math.sin(performance.now() * 0.00031) * (still ? 0.06 : 0.015));
    }
    // Tail: a counterweight. It swings out of a turn, lifts and streams at
    // the gallop, and lazily sways at a walk.
    tail.forEach((b, i) => {
      const k = i / tail.length;
      b.rotateY(-yawRate * 0.12 * (0.4 + k) +
        Math.sin(ph - k * 2.4) * (0.05 * walkK + 0.03 * trotK) * amp +
        Math.sin(performance.now() * 0.0009 - k * 2) * (still ? 0.03 : 0.01));
      b.rotateX(-0.06 * gallopK * (1 - k) + Math.sin(ph * 2 - k * 2) * 0.03 * gallopK);
    });

    return { speed, gait: w, phase, still, lean };
  }

  return { update, get legs() { return legs; } };
}

// His nose is toward local -Z in this model (head at z = -2.8 in the bind
// pose), so "toward the tail" is +Z. Kept as a function in case a rig ever
// arrives facing the other way.
function TAILWARD_SIGN() { return 1; }
