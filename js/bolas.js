import * as THREE from "three";

// ---------------------------------------------------------------------------
// What the hunters throw.
//
// Until now the compound was scenery with a stealth score painted on it: the
// guards walked their routes, the braziers lit the deck, and nothing that
// happened down there could reach him. So the dark was a number rather than a
// resource, and the raid — the one beat STORY.md asks to be "genuinely
// frightening" (§7) — was a lap of a model.
//
// A bola is the right weapon for that and the wrong one for a shooter. It is
// not a bullet: it is slow, it arcs, you can see it leave the man's hand, and
// what it does when it lands is take his WINGS away for a few seconds rather
// than take a number off a bar. That makes the exchange about flying — height,
// speed and the dark — instead of about trading damage, which is the only kind
// of combat this game has the verbs for.
//
// Three rules, the same ones health.js works to:
//
//   HE HAS TO SEE IT COMING  It leaves on a visible arc and it spins, and at
//                            the far edge of their range that is a second and a
//                            half of warning. You can outrun it, shoot it out of
//                            the air — a bola in the air is a blast target like
//                            any other — or barrel-roll off the line it was
//                            aimed at, which only works if you leave the roll
//                            late enough to still be in it when the weight
//                            arrives. See the note in controls.js.
//
//   IT HAS TO BE HIS FAULT   They only throw at what they can see. That test
//                            lives in main.js with the rest of the stealth
//                            economy; this file only ever does as it is told.
//
//   IT HAS TO END            Snared is a few seconds of a dragon with bound
//                            wings, not a death. See controls.snare().
// ---------------------------------------------------------------------------

const POOL      = 14;
/**
 * m/s out of the thrower.
 *
 * This started at 78 — a man's arm, which is what a bola actually is — and a
 * man's arm cannot touch a dragon. He cruises at 100 m/s and tops out at 335,
 * so a 78 m/s weight is something he outruns by standing still, and the lead
 * solver below correctly reported that there was no shot: every throw at
 * anything but a hover came out as a stern chase it could never close.
 *
 * So they are not thrown by hand. The compound has cranes, winches and a cage
 * works — these come off a torsion launcher on the walkway, which is the kind
 * of thing the place would obviously have and the only kind of thing that can
 * reach him. 165 m/s still leaves a second and a half of flight at the far edge
 * of their range, which is the warning the whole weapon depends on.
 */
const SPEED     = 165;
/** m/s^2. Not 9.81: at this speed a true arc is almost a straight line, and the
 *  drop is most of what tells you the thing is heavy. Exaggerated until you can
 *  see it bend. */
const GRAVITY   = 16;
const LIFE      = 3.4;          // s before the cords come apart in the air
/** ...and they do not loose at all beyond this much flight time. Past it he is
 *  simply outrunning them, and a launcher that fires anyway is a launcher
 *  throwing weights at where he used to be. Outrunning them is a real answer
 *  and it should look like one. */
const MAX_FLIGHT = 2.8;         // s
/** Hit radius. He is 14 m across the wings; this is a little under half of it,
 *  so clipping the very tip does not count and the middle does. */
const HIT_R     = 6.2;
/** No more than this far between two hit tests, so a fast pass cannot slip
 *  through the gap between frames. Same sweep the plasma bolts use. */
const SWEEP_STEP = 7;

const WEIGHT_R  = 0.4;          // m, one iron ball
const CORD_LEN  = 2.2;          // m, hub to weight
const SPIN      = 15.5;         // rad/s about the flight axis

/**
 * How far a throw can wander, in metres at the aim point.
 *
 * It grows with range and with how fast he is going, which is the lesson the
 * whole system is for: high, fast and far is safe, and low and slow over a lit
 * deck is not. At 60 m off a hovering dragon they barely miss; at 240 m off one
 * doing 400 mph they mostly do.
 */
const SPREAD_NEAR = 2.0;
const SPREAD_FAR  = 26.0;
const SPREAD_RANGE = 240;
const SPREAD_SPEED = 18.0;      // ...plus this much at full tilt

export function setupBolas(scene, { getHeightAt = null, seaLevel = 0 } = {}) {
  // --- Making it visible ---------------------------------------------------
  // The raid happens at night on a deck the player has just put into darkness,
  // which is exactly the condition under which an unlit iron ball is nothing at
  // all. So the weights are lit metal AND carry a little emissive of their own:
  // enough to read as a moving object against black water, not enough to look
  // like it is on fire. The silhouette and the SPIN are what sell it.
  const weightGeo = new THREE.SphereGeometry(WEIGHT_R, 8, 6);
  const weightMat = new THREE.MeshStandardMaterial({
    color: 0x2a2622, roughness: 0.55, metalness: 0.85,
    emissive: 0x4a3a2a, emissiveIntensity: 0.55,
  });
  // One cord, modelled as a thin box rather than a cylinder: it is two metres
  // long and a centimetre thick, it is spinning, and nobody will ever see the
  // difference. Eight vertices instead of ninety-six, times three, times
  // fourteen in the pool.
  const cordGeo = new THREE.BoxGeometry(0.05, 0.05, CORD_LEN);
  cordGeo.translate(0, 0, CORD_LEN / 2);
  const cordMat = new THREE.MeshStandardMaterial({
    color: 0x6b5a44, roughness: 0.95, metalness: 0.0,
  });

  const _n = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const AXIS = new THREE.Vector3(0, 0, 1);

  const pool = [];
  for (let i = 0; i < POOL; i++) {
    // Hub, three arms at 120 degrees. The hub spins about the direction of
    // flight, so the whole thing whirls the way a thrown bola does rather than
    // tumbling end over end — which is the one motion that makes it legible at
    // a distance, because the outline changes every frame.
    const group = new THREE.Group();
    const hub = new THREE.Group();
    group.add(hub);
    for (let k = 0; k < 3; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI * 2) / 3;
      const cord = new THREE.Mesh(cordGeo, cordMat);
      // Laid down +Z and then swung out sideways, so the arm sweeps a disc
      // across the line of flight.
      cord.rotation.y = Math.PI / 2;
      const w = new THREE.Mesh(weightGeo, weightMat);
      w.position.x = CORD_LEN;
      arm.add(cord, w);
      hub.add(arm);
    }
    group.visible = false;
    scene.add(group);
    pool.push({
      group, hub,
      live: false, t: 0,
      vel: new THREE.Vector3(),
      /** Set from outside so main.js can bill the right thing for the hit. */
      from: null,
    });
  }

  // Blast targets. A bola in the air is something a plasma bolt can take out,
  // and that is deliberately the most satisfying answer to being shot at: it
  // costs one of six shots and it needs a lead on a moving target. Reused
  // rather than reallocated, because this is read every frame by plasma.js.
  const _targets = [];

  const listeners = [];

  /**
   * How long the weight is in the air, and where he will be when it lands.
   *
   * Solved rather than iterated. "Guess a flight time from the present
   * distance, look at where he will be by then, re-time it" is the obvious way
   * to do this and it does not converge: against a dragon closing at 150 m/s it
   * oscillates between half a second and a second and never settles, and the
   * lead point and the flight time end up describing different throws. The
   * throw lands fifty metres behind him and it looks like the aiming is broken.
   *
   * The closed form is two lines and it is exact. He is at D from the launcher
   * and moving at V; the weight covers S·t; so |D + V·t| = S·t, and squaring
   * that is a quadratic in t. The smallest positive root is the first moment
   * the two can meet, and no positive root means there is no shot at all —
   * which is the honest answer when he is going faster than the weight.
   */
  const _d = new THREE.Vector3();
  function lead(from, targetPos, targetVel, out) {
    _d.copy(targetPos).sub(from);
    const a = targetVel.lengthSq() - SPEED * SPEED;
    const b = 2 * _d.dot(targetVel);
    const c = _d.lengthSq();
    let t;
    if (Math.abs(a) < 1e-4) {
      // He is going exactly the speed of the weight: the quadratic degenerates
      // and there is one answer, if b is pointing the right way.
      t = Math.abs(b) < 1e-6 ? -1 : -c / b;
    } else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return -1;
      const q = Math.sqrt(disc);
      const t1 = (-b - q) / (2 * a), t2 = (-b + q) / (2 * a);
      // The earliest meeting that is actually in the future.
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      t = lo > 0 ? lo : hi;
    }
    if (!(t > 0)) return -1;
    out.copy(targetVel).multiplyScalar(t).add(targetPos);
    return Math.max(0.12, t);
  }

  /**
   * The launch velocity that puts the weight on `aim` exactly `t` from now.
   *
   * Straight out of the displacement equation — p = v·t − ½g·t², so
   * v = (p − from)/t + ½g·t — and worth writing down because the obvious
   * alternative is wrong in a way that is hard to see. Aiming ABOVE the target
   * by the drop and then throwing at a fixed speed along that new line does not
   * work: the line is steeper, so the same speed puts less of itself into
   * closing the horizontal distance and the weight arrives late and short. This
   * form hits the point at the stated time whatever the speed comes out as,
   * which is the right trade — a throw a few per cent fast is invisible and a
   * throw that misses by fifteen metres is the feature not working.
   */
  function launch(from, aim, t, out) {
    out.copy(aim).sub(from).divideScalar(t);
    out.y += 0.5 * GRAVITY * t;
    return out;
  }

  const api = {
    /** Live bolas, as things a plasma bolt can hit. Do not hold on to it. */
    targets() {
      _targets.length = 0;
      for (const b of pool) {
        if (!b.live) continue;
        _targets.push({
          pos: b.group.position,
          hit: () => { b.live = false; b.group.visible = false; },
        });
      }
      return _targets;
    },

    /** Called with (bola position) every time one lands on him. */
    onHit(fn) { listeners.push(fn); },

    get liveCount() { return pool.reduce((n, b) => n + (b.live ? 1 : 0), 0); },

    /**
     * @param {THREE.Vector3} from       the hand it leaves
     * @param {THREE.Vector3} targetPos  where he is now
     * @param {THREE.Vector3} targetVel  and how fast, so the throw can lead him
     * @param {number} accuracy 0..1 — 1 is a perfect throw, 0 is the full
     *   spread. main.js works this out from range, speed and how much light
     *   there is on him.
     * @returns {boolean} whether one was actually thrown
     */
    fire(from, targetPos, targetVel, accuracy = 1) {
      const b = pool.find((x) => !x.live);
      if (!b) return false;

      const aim = new THREE.Vector3();
      const t = lead(from, targetPos, targetVel, aim);
      // No shot. He is faster than the weight, so there is nowhere to aim.
      if (t < 0 || t > MAX_FLIGHT) return false;

      // Miss by a disc across the line of the throw rather than by a sphere:
      // a throw that lands short or long is a throw that still crosses his
      // path, and the near miss is most of what this weapon is for.
      _n.copy(aim).sub(from);
      const range = _n.length();
      _n.normalize();
      const spread = (1 - THREE.MathUtils.clamp(accuracy, 0, 1)) *
        THREE.MathUtils.lerp(SPREAD_NEAR, SPREAD_FAR,
          THREE.MathUtils.clamp(range / SPREAD_RANGE, 0, 1));
      if (spread > 0) {
        // Any two vectors across the throw. World up is never parallel to a
        // throw at a flying dragon, so one cross product is enough.
        _p.set(0, 1, 0).cross(_n).normalize();
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread;
        aim.addScaledVector(_p, Math.cos(a) * r);
        _p.crossVectors(_n, _p).normalize();
        aim.addScaledVector(_p, Math.sin(a) * r);
      }

      launch(from, aim, t, b.vel);
      _n.copy(b.vel).normalize();

      b.live = true;
      b.t = 0;
      b.group.position.copy(from);
      b.group.visible = true;
      b.group.quaternion.setFromUnitVectors(AXIS, _n);
      b.hub.rotation.z = Math.random() * Math.PI * 2;
      return true;
    },

    /**
     * @param {number} dt
     * @param {{pos:THREE.Vector3}|null} target  the dragon, or null if he is
     *   on the ground or in a cutscene — in which case nothing can land.
     */
    update(dt, target = null) {
      for (const b of pool) {
        if (!b.live) continue;
        b.t += dt;
        b.hub.rotation.z += SPIN * dt;

        const span = b.vel.length() * dt;
        const steps = Math.max(1, Math.ceil(span / SWEEP_STEP));
        const hdt = dt / steps;
        let done = false, landed = false;

        for (let s = 0; s < steps && !done; s++) {
          b.vel.y -= GRAVITY * hdt;
          const p = b.group.position.addScaledVector(b.vel, hdt);

          if (target && p.distanceTo(target.pos) < HIT_R) { done = true; landed = true; }
          else if (getHeightAt) {
            const ground = Math.max(getHeightAt(p.x, p.z), seaLevel);
            if (p.y <= ground + 0.6) done = true;
          }
        }

        // Keep the weights streaming behind the hub: the group is re-pointed
        // down the current velocity every frame so the arc reads as an arc
        // rather than as a flat line that happens to be falling.
        if (!done) {
          _n.copy(b.vel).normalize();
          b.group.quaternion.setFromUnitVectors(AXIS, _n);
        }

        if (done || b.t > LIFE) {
          b.live = false;
          b.group.visible = false;
          if (landed) for (const fn of listeners) fn(b.group.position.clone());
        }
      }
    },

    /** Everything out of the air — a cutscene, a fade, a chapter jump. */
    clear() {
      for (const b of pool) { b.live = false; b.group.visible = false; }
    },

    dispose() {
      for (const b of pool) scene.remove(b.group);
      weightGeo.dispose(); cordGeo.dispose();
      weightMat.dispose(); cordMat.dispose();
    },
  };

  return api;
}
