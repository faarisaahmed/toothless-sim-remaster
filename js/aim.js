import * as THREE from "three";

// ---------------------------------------------------------------------------
// Aiming.
//
// Hold aim and the camera comes in over his shoulder, a crosshair goes up in
// the middle of the screen, and the blast goes where the crosshair is. The
// mouse (or the right stick) moves the camera exactly as it does when you are
// not aiming — aiming changes how close the camera sits, never what the mouse
// does.
//
// This replaced two modes that both fought the player. "Scoped" put the camera
// inside his skull — near enough that you could see the backs of his eyes —
// slowed time, and rationed all of it with a stamina bar and a three-second
// lockout. "No scope" handed the mouse to his NECK instead of the camera, so
// the moment you held aim the same hand did a different thing and the view
// stopped following it. Both were interesting ideas and both were annoying to
// play. The rule now is one control, one meaning: the mouse is the camera, the
// crosshair is the camera's centre, the shot goes to the crosshair.
//
// His head still turns — toward whatever the crosshair is on, as far as a neck
// can — so you can see him look at it. That is a picture of the aim, not the
// aim itself: the shot is aimed from his mouth at the crosshair's point, so a
// target out past his neck's reach is still hit.
// ---------------------------------------------------------------------------

// How far off his own heading his head will follow the crosshair. A neck, not
// a turret: past about seventy degrees he would be looking down his own flank.
const YAW_LIMIT   = 1.20;   // rad, ~69 deg either side
const PITCH_LIMIT = 0.78;   // rad, ~45 deg up or down

const BLEND_RATE = 9.0;     // how fast the camera moves in and out
const HEAD_RATE  = 10.0;    // how fast his head follows the crosshair

// The neck carries most of a big turn, the head finishes it. All on one bone it
// reads as an owl; spread evenly it reads as a snake with no skull in it.
const NECK_SHARE = 0.20;   // each of Neck001..003
const HEAD_SHARE = 0.40;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createAim() {

  let held = false;        // the button is down
  let active = false;      // ...and we are allowed to be aiming
  let blend = 0;           // 0 = not aiming, 1 = fully in over his shoulder
  let yaw = 0, pitch = 0;  // where his head is turned, off heading and path
  let wantYaw = 0, wantPitch = 0;
  let target = null;       // the crosshair's point in the world, while aiming
  let bones = null;

  const _dir = new THREE.Vector3();
  const _head = new THREE.Vector3();
  const _target = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  // Which of the Head bone's own axes runs down his snout. MEASURED at bind
  // time rather than assumed, because a bone's local axes are whatever the
  // exporter wrote and the answer changes the day someone re-rigs him. Null
  // means it could not be established, and everything falls back to the maths.
  let nose = null;

  // --- The reticle ---------------------------------------------------------
  // Built here rather than in index.html: it belongs to this system and is
  // only ever shown by it.
  const root = document.createElement("div");
  root.id = "aim-ui";
  root.innerHTML = `
    <svg id="aim-reticle" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="15" />
      <line x1="50" y1="26" x2="50" y2="38" /><line x1="50" y1="62" x2="50" y2="74" />
      <line x1="26" y1="50" x2="38" y2="50" /><line x1="62" y1="50" x2="74" y2="50" />
      <circle cx="50" cy="50" r="1.6" class="pip" />
    </svg>`;
  document.body.appendChild(root);
  const reticleEl = root.querySelector("#aim-reticle");

  return {
    get active() { return active; },
    get blend() { return blend; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    /** Where the crosshair is in the world while aiming, else null. */
    get target() { return target; },

    /** Find the neck and skull once, off the loaded model. */
    bind(dragonRoot) {
      const want = new Set(["Neck001", "Neck002", "Neck003", "Head"]);
      const found = new Map();
      dragonRoot.traverse((o) => { if (o.isBone && want.has(o.name)) found.set(o.name, o); });
      bones = found.size ? found : null;

      // --- Which way is his nose? ------------------------------------------
      // Try all six of the skull's own axes against the direction the model
      // faces and keep the closest. On the HD rig the answer is +Y, which is
      // the Blender convention of a bone pointing from head to tail — but that
      // is a fact about this export and not a law, so it is checked rather
      // than written down.
      nose = null;
      const head = bones?.get("Head");
      if (head) {
        dragonRoot.updateWorldMatrix(true, true);
        // The model is authored facing -z; main.js turns him by heading + PI.
        const fwd = _v.set(0, 0, -1)
          .applyQuaternion(dragonRoot.getWorldQuaternion(_q)).normalize();
        const hq = head.getWorldQuaternion(new THREE.Quaternion());
        let best = -2, bestAxis = null;
        for (let a = 0; a < 3; a++) {
          for (const sign of [1, -1]) {
            const axis = new THREE.Vector3(a === 0 ? sign : 0, a === 1 ? sign : 0,
                                           a === 2 ? sign : 0);
            const d = _v2.copy(axis).applyQuaternion(hq).dot(fwd);
            if (d > best) { best = d; bestAxis = axis; }
          }
        }
        // Within 45 degrees of his own forward, or it is not a snout and
        // something about the rig has moved under us.
        if (best >= Math.SQRT1_2) nose = bestAxis;
        else console.warn(
          "aim: no head axis points forward — closest is " +
          `${(Math.acos(Math.max(-1, best)) * 57.3).toFixed(0)}° off. ` +
          "Falling back to aiming along the flight path.");
      }
      return !!bones;
    },

    setHeld(v) { held = !!v; },

    /**
     * Where the crosshair is, in the world. main.js finds it — it owns the
     * camera and the height field — and hands it over every frame while
     * aiming, with his heading and flight path so the head can turn toward it.
     * Null when there is nothing to aim at (not aiming).
     */
    setTarget(point, from, heading, pathAngle) {
      if (!point) { target = null; return; }
      target = _target.copy(point);
      const d = _v.copy(point).sub(from);
      const len = d.length();
      if (len < 1e-3) return;
      d.divideScalar(len);
      // +yaw is a turn toward +x, which is how heading counts too.
      wantYaw = THREE.MathUtils.clamp(wrap(Math.atan2(d.x, d.z) - heading), -YAW_LIMIT, YAW_LIMIT);
      wantPitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) - pathAngle,
                                        -PITCH_LIMIT, PITCH_LIMIT);
    },

    /** @param {boolean} allowed false while grounded, in a cutscene, etc. */
    update(dt, allowed = true) {
      active = allowed && held;
      if (!active) { target = null; wantYaw = wantPitch = 0; }

      const want = active ? 1 : 0;
      blend += (want - blend) * (1 - Math.exp(-BLEND_RATE * dt));
      if (Math.abs(blend - want) < 0.002) blend = want;

      // The head follows the crosshair while aiming and comes home after.
      const k = 1 - Math.exp(-HEAD_RATE * dt);
      yaw += (wantYaw - yaw) * k;
      pitch += (wantPitch - pitch) * k;

      reticleEl.style.opacity = active ? "1" : "0";
    },

    /** The world no longer slows down while aiming. Kept so callers need not care. */
    timeScale() { return 1; },

    /**
     * Where he is actually pointing his mouth, in world space.
     *
     * READ OFF THE SKULL, not rebuilt from heading and flight path. This used
     * to be the other way round, on the reasoning that the crosshair, the
     * camera and the shot all have to agree and a bone whose local axes depend
     * on the exporter is a bad single source of truth. They do all have to
     * agree — but they were agreeing with each other and disagreeing with the
     * dragon, which is the one thing the player can actually see.
     *
     * The gap is his ANGLE OF ATTACK. `pathAngle` is where he is going and his
     * nose is where he is pointing, and those are only the same number when he
     * is neither slow nor fast: controls.js holds his nose up by AOA_SLOW when
     * he is hanging on his wings, and the flight rig leans the neck on top of
     * that. Measured over the real model, the nose sat 6.7° off the shot line
     * in a hover, 0.4° at cruise and 6.0° flat out — so the shot missed by an
     * amount that changed with the throttle, and no amount of leading it would
     * teach you where it went.
     *
     * Reading the bone makes the error zero by construction, at any speed, in
     * any attitude, on the ground included. What it buys in exchange is that
     * his idle animation is now in the line of fire — measured at 1.07° of
     * wander in a hover and 0.05° flat out, which is a dragon breathing, and
     * at that scale it is texture rather than error.
     *
     * `heading` and `pathAngle` are still the fallback for a model with no
     * skull on it, which is every rig older than this one.
     */
    direction(heading, pathAngle, out = _dir) {
      // Aiming: from his mouth to the crosshair's point, whatever his neck
      // managed. The crosshair is the promise; the head is the picture of it.
      if (active && target) {
        const head = bones?.get("Head");
        if (head) {
          head.getWorldPosition(_v2);
          const d = out.copy(target).sub(_v2);
          if (d.lengthSq() > 1) return d.normalize();
        }
      }
      // Runs after applyToRig has written this frame's yaw and pitch onto the
      // bones, so the skull is already pointed where the player asked.
      const head = nose && bones?.get("Head");
      if (head) {
        return out.copy(nose).applyQuaternion(head.getWorldQuaternion(_q)).normalize();
      }
      const h = heading + yaw;
      const p = THREE.MathUtils.clamp(pathAngle + pitch, -1.45, 1.45);
      return out.set(
        Math.sin(h) * Math.cos(p),
        Math.sin(p),
        Math.cos(h) * Math.cos(p)
      );
    },

    /** World position of his head, for the muzzle. */
    headPosition(out = _head) {
      const head = bones?.get("Head");
      if (!head) return null;
      return head.getWorldPosition(out);
    },

    /**
     * Turn the neck and skull. Runs AFTER the flight rig, which writes those
     * same bones from rest every frame — so this adds, and would be erased if
     * it ran first.
     */
    applyToRig() {
      if (!bones) return;
      // +z is a look to his left and -x is a look up, matching the conventions
      // js/flightrig.js already uses on these bones.
      for (let i = 1; i <= 3; i++) {
        const b = bones.get(`Neck${String(i).padStart(3, "0")}`);
        if (!b) continue;
        b.rotation.z += yaw * NECK_SHARE;
        b.rotation.x -= pitch * NECK_SHARE;
      }
      const head = bones.get("Head");
      if (head) {
        head.rotation.z += yaw * HEAD_SHARE;
        head.rotation.x -= pitch * HEAD_SHARE;
      }
    },

    /** Hard stop — cutscenes, landing, losing the window. */
    release() {
      held = false;
      active = false;
    },
  };
}
