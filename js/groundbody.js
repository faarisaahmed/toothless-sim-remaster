import * as THREE from "three";

// ---------------------------------------------------------------------------
// His body on the ground, as a body.
//
// Landing used to be a drop straight down onto the height field, a plane
// fitted through four samples a body length out, and a walk that wrote his
// position onto that plane. On flat grass it was fine. On anything else — a
// boulder, a ledge, a roof, the lip of a cliff, a slope too steep to stand on —
// it was wrong in ways the eye catches at once: he floated over a rock with
// one foot in it, stood level on a ridge with his paws in the air, or stood on
// a sixty-degree face as if it were a floor.
//
// Now he is a rigid body with mass, carried on four legs, and the ground pushes
// back:
//
//   LEGS ARE SPRINGS. Each one runs from its hip down to whatever solid thing
//   is under its foot (surfaces.js: terrain, roofs, decks, crates). Compressed,
//   it pushes, along the surface's normal, with damping. Too far to reach, it
//   pushes nothing. So a landing is an impact the legs absorb and rebound
//   from; a rock under one forefoot pitches him up over it; a ledge with his
//   hind feet off it tips him.
//
//   FRICTION IS LIMITED. Grip at the feet is Coulomb friction — it can resist
//   up to mu times the load and no more. On a gentle slope it holds him; on a
//   steep one the downhill push beats it and he slides; on a deck it is a
//   little slipperier than rock. Driving him (walking, running) goes through
//   the same budget, so he cannot sprint up a cliff.
//
//   HE KEEPS HIS MOMENTUM. He touches down with the speed he flared to, and
//   runs it out — the gait sees the speed and does the running.
//
//   NOTHING UNDER HIM, HE FALLS. Off an edge the legs find nothing, gravity
//   wins, and after a moment of falling he opens his wings (the caller's
//   takeOff), which is what a dragon would do.
//
// Attitude comes from the leg forces' torques about his centre of mass, so the
// tilt on rough ground is the tilt the ground actually puts him at.
// ---------------------------------------------------------------------------

const G = 9.81;
// main.js's rotation convention, measured rather than assumed: with the
// dragon turned (-pitch, yaw + PI, roll), a POSITIVE pitch lowers his nose and
// a positive roll lifts his +x side (the model's right). So a higher front
// wants negative pitch, and a higher -x side wants negative roll.
const PITCH_SIGN = -1;
const ROLL_SIGN = -1;

// Mass only scales the springs; what matters is the ratios.
const MASS = 1;
const LEG_HZ = 2.0;                 // stance stiffness, as a natural frequency
const LEG_ZETA = 0.85;              // damping ratio: settles, does not bounce
const OMEGA = 2 * Math.PI * LEG_HZ;
const K_LEG = MASS * OMEGA * OMEGA / 4;
const D_LEG = 2 * LEG_ZETA * OMEGA * MASS / 4;
// Pitch and roll. A four-legged animal does not balance its body on the ground
// like a plank on rocks: it sets its legs to the ground and the body follows
// the plane of its feet. So the attitude is a damped spring toward the plane
// through the four footholds (the reachable ones), and the leg springs only
// add the jolt of an impact on top. Pure rigid-body torque on a single foot
// spun him to his limit on the first touch of a roof.
const ATT_HZ = 3.0, ATT_ZETA = 0.8;
const ATT_K = (2 * Math.PI * ATT_HZ) ** 2;
const ATT_C = 2 * ATT_ZETA * 2 * Math.PI * ATT_HZ;
const ATT_MAX = 0.7;                // radians of pitch or roll he can be put at
// With two feet or fewer holding him and his weight hanging off them, he goes
// over: the share of gravity that tips him off, as an acceleration.
const TOPPLE = 0.7 * 9.81;
// While the wings are still flaring on the way down.
// While the wings are still flaring on the way down they hold most of his
// weight: he sinks at a controlled rate, slowing as the ground comes up, and
// sheds his forward speed into the flare — he does not drop like a stone.
const FLARE_SINK = 9;               // m/s of sink high up
const FLARE_TOUCH = 1.8;            // ...easing to this by touchdown
const FLARE_BRAKE = 2.2;            // horizontal speed shed per second, as a rate
const STEP_MAX = 1.1;               // the tallest thing he simply steps up onto

/**
 * @param {object} o
 *   surfaces   createSurfaces(): .at(x, z, below)
 *   feet       [{ x, z }] four foot positions in the model's frame (nose at -z)
 *   hipY       hip height above the soles, standing, metres
 */
export function createGroundBody({ surfaces, feet, hipY = 0.98 }) {
  // Centre of mass: the middle of the four feet, at hip height.
  const com = new THREE.Vector3(
    feet.reduce((a, f) => a + f.x, 0) / 4, hipY,
    feet.reduce((a, f) => a + f.z, 0) / 4);
  const hips = feet.map((f) => new THREE.Vector3(f.x - com.x, 0, f.z - com.z));
  // A leg at rest, unloaded: long enough that his weight squashes it to hipY.
  const L0 = hipY + MASS * G / (4 * K_LEG);
  const LMAX = hipY * 1.18;           // past this the foot leaves the ground

  const pos = new THREE.Vector3();     // centre of mass, world
  const vel = new THREE.Vector3();
  let pitch = 0, roll = 0, pitchV = 0, rollV = 0;
  let yaw = 0;
  let airborne = 0;                     // seconds with no foot on anything
  let flaring = false;
  const contacts = feet.map(() => ({ on: false, y: 0, force: 0, normal: new THREE.Vector3(0, 1, 0) }));
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, "YXZ");
  const _h = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
  const _t = new THREE.Vector3(), _sum = new THREE.Vector3(), _torque = new THREE.Vector3();
  let prevLen = feet.map(() => hipY);

  function orient() {
    // Same convention as main.js: rotation (-pitch, yaw + PI, roll), YXZ.
    e.set(-pitch, yaw + Math.PI, roll, "YXZ");
    q.setFromEuler(e);
  }

  /**
   * Start a landing from flight.
   * @param {THREE.Object3D} dragon   where he is now (origin, not COM)
   * @param {THREE.Vector3} v         his velocity coming in, m/s
   * @param {number} heading          walkYaw convention
   */
  function begin(dragon, v, heading) {
    yaw = heading;
    pitch = 0; roll = 0; pitchV = 0; rollV = 0;
    orient();
    pos.copy(com).applyQuaternion(q).add(dragon.position);
    vel.copy(v);
    flaring = true;
    airborne = 0;
    prevLen = feet.map(() => hipY);
  }

  /**
   * One step.
   * @param {number} dt
   * @param {object} drive
   *   want     THREE.Vector2-ish {x, z}: the horizontal velocity he is trying for
   *   accel    how hard he drives toward it, 1/s
   *   yaw      his heading (the caller turns him)
   * @returns {{ supported:boolean, airborne:number, landed:boolean, steep:number }}
   */
  function step(dt, drive) {
    dt = Math.min(dt, 1 / 30);
    yaw = drive.yaw;
    orient();

    // --- The legs ------------------------------------------------------------
    _sum.set(0, flaring ? 0 : -MASS * G, 0);
    _torque.set(0, 0, 0);
    let load = 0, mu = 0, steep = 0, nOn = 0;
    for (let i = 0; i < 4; i++) {
      _h.copy(hips[i]).applyQuaternion(q).add(pos);         // hip, world
      // Nothing above the hip counts as ground: that is a wall, not a floor.
      const s = surfaces.at(_h.x, _h.z, _h.y + 0.25);
      const c = contacts[i];
      const len = _h.y - s.y;
      const lenV = (len - prevLen[i]) / dt;
      prevLen[i] = len;
      c.y = s.y;
      c.normal.copy(s.normal);
      // A foot is ON the ground for as long as the leg can reach it — an
      // extending leg keeps its foot planted, it just stops pushing.
      if (len < LMAX) {
        const comp = L0 - len;
        const f = comp > 0 ? Math.max(0, K_LEG * comp - D_LEG * lenV) : 0;
        c.on = true;
        c.force = f;
        // The push is along the surface's normal: on a slope part of it is
        // downhill, and friction has to hold that.
        _f.copy(s.normal).multiplyScalar(f);
        _sum.add(_f);
        _r.copy(_h).sub(pos);
        _torque.add(_t.crossVectors(_r, _f));
        load += f; mu += s.friction * f; nOn++;
        steep = Math.max(steep, Math.acos(Math.min(1, s.normal.y)));
      } else {
        c.on = false; c.force = 0;
      }
    }
    const supported = nOn > 0;
    if (supported) mu /= Math.max(load, 1e-6);

    // --- Grip ------------------------------------------------------------------
    // What he wants horizontally, minus what the slope is already doing,
    // limited to what the feet can hold.
    if (supported) {
      const want = drive.want || { x: 0, z: 0 };
      const accel = drive.accel ?? 6;
      let fx = MASS * (want.x - vel.x) * accel - _sum.x;
      let fz = MASS * (want.z - vel.z) * accel - _sum.z;
      const cap = mu * load;
      const m = Math.hypot(fx, fz);
      if (m > cap) { fx *= cap / m; fz *= cap / m; }
      _sum.x += fx; _sum.z += fz;
      flaring = false;
      airborne = 0;
    } else {
      airborne += dt;
      if (flaring) {
        // Wings still out: shed speed into the flare, the way a bird brakes
        // before its feet are down, and sink under control.
        const k = Math.exp(-FLARE_BRAKE * dt);
        vel.x *= k; vel.z *= k;
        const below = pos.y - hipY - surfaces.at(pos.x, pos.z, pos.y, false).y;
        const sink = THREE.MathUtils.lerp(FLARE_TOUCH, FLARE_SINK, THREE.MathUtils.clamp(below / 8, 0, 1));
        vel.y += (-sink - vel.y) * (1 - Math.exp(-4 * dt));
      }
    }

    // --- Walls -------------------------------------------------------------------
    // Something ahead taller than a stride can step — a palisade, a hut wall,
    // a rock face — stops him: the part of his motion into it is taken away.
    const hs = Math.hypot(vel.x, vel.z);
    if (supported && hs > 0.2) {
      const dx = vel.x / hs, dz = vel.z / hs;
      // From the front (or back) of him, half a metre on.
      const reach = 1.25 + 0.5;
      const sx = pos.x + dx * reach, sz = pos.z + dz * reach;
      const feetY = pos.y - hipY;
      const ahead = surfaces.at(sx, sz, feetY + 3, false).y;
      if (ahead > feetY + STEP_MAX) {
        const into = vel.x * dx + vel.z * dz;
        if (into > 0) { vel.x -= dx * into; vel.z -= dz * into; }
      }
    }

    // --- Integrate -------------------------------------------------------------
    vel.addScaledVector(_sum, dt / MASS);
    pos.addScaledVector(vel, dt);
    // The legs have a bottom. Past it his chest and belly meet the ground, and
    // that contact does not spring back: it just stops him going further.
    const floor = surfaces.at(pos.x, pos.z, pos.y + 0.5, false).y + hipY * 0.5;
    if (pos.y < floor) {
      pos.y = floor;
      if (vel.y < 0) vel.y = 0;
      vel.x *= 0.92; vel.z *= 0.92;
    }

    // Attitude: toward the plane of his footholds. A foot with nothing in
    // reach counts as hanging at full stretch, so a forefoot over an edge
    // drops the front, and a rock under one forefoot lifts it.
    // A foot that cannot reach yet but has ground within a couple of metres
    // pulls the body round toward it (that is how he comes to lie along a
    // slope); with nothing near, it counts as hanging at full stretch.
    const gy = contacts.map((c, i) => {
      const hy = _h.copy(hips[i]).applyQuaternion(q).add(pos).y;
      return c.on || hy - c.y < 2.5 ? c.y : hy - LMAX;
    });
    const front = (gy[0] + gy[1]) / 2, hind = (gy[2] + gy[3]) / 2;
    const left = (gy[0] + gy[2]) / 2, right = (gy[1] + gy[3]) / 2;
    const span = Math.abs(hips[0].z - hips[2].z) || 1, width = Math.abs(hips[0].x - hips[1].x) || 1;
    const wantPitch = supported ? Math.atan2(front - hind, span) * PITCH_SIGN : 0;
    const wantRoll = supported ? Math.atan2(left - right, width) * ROLL_SIGN : 0;
    pitchV += (ATT_K * (THREE.MathUtils.clamp(wantPitch, -ATT_MAX, ATT_MAX) - pitch) - ATT_C * pitchV) * dt;
    rollV += (ATT_K * (THREE.MathUtils.clamp(wantRoll, -ATT_MAX, ATT_MAX) - roll) - ATT_C * rollV) * dt;
    pitch = THREE.MathUtils.clamp(pitch + pitchV * dt, -ATT_MAX, ATT_MAX);
    roll = THREE.MathUtils.clamp(roll + rollV * dt, -ATT_MAX, ATT_MAX);

    // Toppling: held by two feet or fewer, with his centre of mass outside
    // them, he goes over the edge — off a ledge, a ridge, the back of a cage.
    if (supported && nOn <= 2 && !flaring) {
      let cx = 0, cz = 0;
      for (let i = 0; i < 4; i++) if (contacts[i].on) {
        _h.copy(hips[i]).applyQuaternion(q).add(pos); cx += _h.x; cz += _h.z;
      }
      cx /= nOn; cz /= nOn;
      const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
      if (d > 0.08) {
        vel.x += (dx / d) * TOPPLE * dt;
        vel.z += (dz / d) * TOPPLE * dt;
      }
    }

    return { supported, airborne, steep, load: load / (MASS * G) };
  }

  /** Write the body onto the dragon: origin from the centre of mass. */
  function apply(dragon) {
    orient();
    dragon.rotation.set(-pitch, yaw + Math.PI, roll, "YXZ");
    _h.copy(com).applyQuaternion(q);
    dragon.position.copy(pos).sub(_h);
  }

  return {
    begin, step, apply,
    get velocity() { return vel; },
    get pitch() { return pitch; },
    get roll() { return roll; },
    get contacts() { return contacts; },
    get flaring() { return flaring; },
    /** Speed along the ground, m/s. */
    get speed() { return Math.hypot(vel.x, vel.z); },
  };
}
