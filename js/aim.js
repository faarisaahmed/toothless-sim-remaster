import * as THREE from "three";

// ---------------------------------------------------------------------------
// Aiming.
//
// Until now "aiming was flying": a blast went wherever his BODY pointed, so the
// only way to hit anything was to fly at it. That is a fine idea and a bad
// weapon — a dragon's head is on a neck, and the whole point of a neck is that
// it aims independently of the direction you are travelling.
//
// So the head aims, and there are two ways to use it. They are not difficulty
// settings; they are different games, and which one is better is a matter of
// taste, which is why it is an option rather than a progression unlock.
//
//   SCOPED    Hold aim and the camera goes to his head. The mouse turns the
//             head, the head turns the camera, there is a crosshair, and time
//             slows. It costs stamina, and running the bar out locks you out
//             for three seconds. This is the mode where you can see exactly
//             what you are aiming at, and it is rationed because of that.
//
//   NO SCOPE  Hold aim and the mouse turns his head. That is all. The camera
//             stays where it was, the world runs at full speed, you keep flying
//             normally, and there is NO crosshair. You have to know where his
//             head is pointed by looking at him. Nothing is rationed because
//             nothing is being given to you.
//
// The asymmetry is deliberate. Scoped mode hands the player information, and
// information is the thing worth charging for. No-scope hands over control and
// nothing else, so metering it would be charging for the privilege of being
// good at the game — which is what a stamina bar on a free-look control always
// turns out to be.
// ---------------------------------------------------------------------------

const STORE_KEY = "nightalone.aim.v1";

export const MODES = {
  scoped: {
    id: "scoped", label: "Aim mode",
    hint: "his eyes, a crosshair, slowed time — costs stamina",
  },
  noscope: {
    id: "noscope", label: "No scope",
    hint: "his head only. No slow-down, no stamina, no crosshair",
  },
};

export const DEFAULT_MODE = "scoped";

// How far off his own heading he can look. A neck, not a turret: past about
// seventy degrees he would be looking down his own flank, and the camera in
// scoped mode would be inside his shoulder.
const YAW_LIMIT   = 1.20;   // rad, ~69 deg either side
const PITCH_LIMIT = 0.78;   // rad, ~45 deg up or down

// Scoped mode's budget.
const AIM_SECONDS     = 3.5;   // a full bar, held continuously
const REFILL_SECONDS  = 5.0;   // and how long it takes to come back
const LOCKOUT_SECONDS = 3.0;   // the penalty for running it dry
const TIME_SCALE      = 0.32;  // how slow the world goes
const BLEND_RATE      = 9.0;   // how fast the camera and the clock move over

// The neck carries most of a big turn, the head finishes it. All on one bone it
// reads as an owl; spread evenly it reads as a snake with no skull in it.
const NECK_SHARE = 0.20;   // each of Neck001..003
const HEAD_SHARE = 0.40;

// The mode lives at module scope, not on the instance, because the title screen
// has to read and write it and there is no aim system on the title screen —
// instantiating one just to flip a setting would build a crosshair over the
// menu and start a stamina meter nobody is spending.
function loadMode() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v && MODES[v]) return v;
  } catch { /* storage off */ }
  return DEFAULT_MODE;
}

let mode = loadMode();
const listeners = new Set();

export function getMode() { return mode; }

export function setMode(id) {
  if (!MODES[id] || id === mode) return mode;
  mode = id;
  try { localStorage.setItem(STORE_KEY, id); } catch { /* not fatal */ }
  for (const fn of listeners) fn(mode);
  return mode;
}

export function toggleMode() {
  return setMode(mode === "scoped" ? "noscope" : "scoped");
}

export function onModeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function createAim() {

  let held = false;        // the button is down
  let active = false;      // ...and we are allowed to be aiming
  let blend = 0;           // 0 = not aiming, 1 = fully in. Drives camera + clock
  let yaw = 0, pitch = 0;  // offsets from his own heading and flight path
  let stamina = 1;         // scoped only
  let lockout = 0;         // seconds of enforced non-aiming
  let bones = null;

  const _dir = new THREE.Vector3();
  const _head = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  // Which of the Head bone's own axes runs down his snout. MEASURED at bind
  // time rather than assumed, because a bone's local axes are whatever the
  // exporter wrote and the answer changes the day someone re-rigs him. Null
  // means it could not be established, and everything falls back to the maths.
  let nose = null;

  // --- The reticle and the bar --------------------------------------------
  // Built here rather than in index.html: they belong to this system, they are
  // only ever shown by it, and the crosshair in particular must not exist in
  // no-scope mode — a stray element with opacity 0 is exactly the kind of thing
  // that comes back on after someone edits a stylesheet.
  const root = document.createElement("div");
  root.id = "aim-ui";
  root.innerHTML = `
    <svg id="aim-reticle" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="15" />
      <line x1="50" y1="26" x2="50" y2="38" /><line x1="50" y1="62" x2="50" y2="74" />
      <line x1="26" y1="50" x2="38" y2="50" /><line x1="62" y1="50" x2="74" y2="50" />
      <circle cx="50" cy="50" r="1.6" class="pip" />
    </svg>
    <div id="aim-bar"><i></i></div>`;
  document.body.appendChild(root);
  const reticleEl = root.querySelector("#aim-reticle");
  const barEl = root.querySelector("#aim-bar");
  const barFill = barEl.querySelector("i");

  // Changing mode mid-aim would leave the camera stuck in his head with no
  // button held down to get it out, so the instance drops the aim when it hears
  // about a change.
  onModeChange(() => { held = active = false; stamina = 1; lockout = 0; });

  return {
    get mode() { return mode; },
    setMode,
    toggleMode,

    get active() { return active; },
    /** True only in the mode that takes the camera and slows the clock. */
    get scoped() { return active && mode === "scoped"; },
    get blend() { return blend; },
    get stamina() { return stamina; },
    get lockout() { return lockout; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },

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
     * Mouse delta, in the same units the camera look uses.
     *
     * Yaw used to SUBTRACT dx, like pitch does, and pushing the mouse right
     * swung his head left. It was hard to spot because everything downstream
     * agreed with it — the bones turned the way `yaw` said, the shot went where
     * the bones went, and the whole aiming system was confidently wrong
     * together. Measured through the real rig, the four directions now come out
     * as: mouse right, head right; mouse down, head down.
     *
     * The remaining asymmetry between the two lines is not a typo. `yaw` and
     * `pitch` are fed the same deltas main.js gives the camera, but they run
     * through a chain of neck bones whose own axes decide which way each of
     * them ends up turning, and those axes are the rig's business rather than
     * this file's. The signs here are the ones that come out right at the
     * skull. `node tools/aimcheck.mjs` is how that is checked.
     */
    look(dx, dy) {
      if (!active) return false;
      yaw = THREE.MathUtils.clamp(yaw + dx, -YAW_LIMIT, YAW_LIMIT);
      pitch = THREE.MathUtils.clamp(pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
      return true;
    },

    /**
     * @param {number} dt REAL seconds — never the slowed clock. A stamina bar
     *   that drains on the same clock it slows would last 1/TIME_SCALE times
     *   longer the moment you used it, which is the opposite of a cost.
     * @param {boolean} allowed false while grounded, in a cutscene, etc.
     */
    update(dt, allowed = true) {
      if (lockout > 0) lockout = Math.max(0, lockout - dt);

      const canAim = allowed && held && lockout <= 0 &&
                     (mode === "noscope" || stamina > 0);
      active = canAim;

      if (mode === "scoped") {
        if (active) {
          stamina = Math.max(0, stamina - dt / AIM_SECONDS);
          if (stamina <= 0) {
            active = false;
            lockout = LOCKOUT_SECONDS;
          }
        } else if (lockout <= 0) {
          stamina = Math.min(1, stamina + dt / REFILL_SECONDS);
        }
      } else {
        stamina = 1;
      }

      // Only scoped mode moves the camera and the clock, so only scoped mode
      // blends. No-scope has to be instant or it is not the same input.
      const want = (active && mode === "scoped") ? 1 : 0;
      blend += (want - blend) * (1 - Math.exp(-BLEND_RATE * dt));
      if (Math.abs(blend - want) < 0.002) blend = want;

      // Let the head come back on its own when he stops aiming. Same rate as
      // the blend, so the camera and the neck arrive together.
      if (!active) {
        const k = 1 - Math.exp(-6 * dt);
        yaw -= yaw * k;
        pitch -= pitch * k;
      }

      // --- UI ---
      const showReticle = active && mode === "scoped";
      reticleEl.style.opacity = showReticle ? "1" : "0";
      const showBar = mode === "scoped" && (active || stamina < 0.999 || lockout > 0);
      barEl.style.opacity = showBar ? "1" : "0";
      barFill.style.transform = `scaleX(${lockout > 0 ? lockout / LOCKOUT_SECONDS : stamina})`;
      barEl.classList.toggle("locked", lockout > 0);
    },

    /** How fast the world should run this frame. */
    timeScale() { return 1 + (TIME_SCALE - 1) * blend; },

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

    /** World position of his head, for the muzzle and the scoped camera. */
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
