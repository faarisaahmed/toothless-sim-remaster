import * as THREE from "three";

// ---------------------------------------------------------------------------
// Plasma blasts.
//
// STORY.md §2.3 already lists "plasma burst" as one of his fire types, so this
// is not a new weapon — it is the ordinary one, and it is deliberately NOT
// sleepfire. Sleepfire is the spine of the game: held, slow, expensive, paid
// for in food and rest, and it is what opens a cage. This is the thing he does
// without thinking about it, and its whole job is to be immediate.
//
// Two consequences that matter:
//
//   Shot limit    The franchise's own stat card gives a Night Fury six shots,
//                 and a weapon you cannot spam is a weapon a stealth level can
//                 be designed around. They come back on their own, slowly.
//
//   It is loud    §2.2's rule for sleepfire applies here too — firing is a
//                 decision that changes the level. The blast lights the ground
//                 it passes over, which is exactly the thing you are trying not
//                 to do on the approach to the compound.
//
// Everything is pooled. A blast is a mesh, a light and a bit of state, and the
// pool is reused rather than reallocated, because the alternative is a garbage
// collection pause in the middle of the one action the player times precisely.
// ---------------------------------------------------------------------------

// MUZZLE speed — how fast the bolt leaves him, not how fast it crosses the
// world. Whatever he is already doing along the line of fire gets added on top,
// which is both what a real projectile does and the only way this works at all:
// he tops out at 335 m/s and the bolt used to travel at a flat 260, so at full
// speed he OUTRAN HIS OWN SHOT. It fell behind him the instant it left, could
// never reach anything in front, and the whole thing read as "firing does not
// work when you are going fast". Adding his airspeed on fixed that: it always
// pulls away from him at SPEED, no matter how fast he is going.
//
// SPEED itself was 260 for a while, and 260 did not read as a BLAST. He cruises
// at a hundred and tops out at 335, so a bolt at 260 was something he threw
// rather than something he fired — you could watch it go, and at speed it
// barely pulled away from him at all. At 600 it leaves at nearly twice his own
// top speed, crosses four hundred metres in well under a second, and the thing
// you see is the streak, not the ball.
const SPEED       = 600;   // m/s relative to the dragon
const RANGE       = 1800;  // m before it burns out on its own
// The visible bolt.
//
// It was 1.7 m of core with a 5.8 m halo around it and a streak up to 37 m
// long, which is not a plasma blast — it is a comet. His shots are a tight
// violet knot with a hard white centre and barely any width to them, and the
// thing that sells one is the CONTRAST between a very small very hot core and
// the dark it is crossing, not the area it covers. So: a third of the size,
// and the brightness put back in (see boltMat below), which is the trade a
// bloom pass exists to make.
const RADIUS      = 0.62;  // m, the visible bolt — ~1.2 m across
const HALO_MUL    = 2.6;   // and the glow around it, ~3.2 m across
export const BLAST_R = 26; // m, what an impact actually affects
const POOL        = 10;

// How far the bolt is allowed to move between two hit tests.
//
// This exists entirely because of the speed above. At 600 m/s — 935 with his
// own airspeed behind it — a frame is ten to sixteen metres, and a single test
// per frame means the bolt is only ever LOOKED at in ten-metre stops. It would
// step clean over a ridge, or straight through the metre-thick shell above the
// height field, and come out the far side of a hill still flying. So the frame
// is walked in short hops. Only the testing is subdivided; the flight itself is
// still one straight line at one speed.
const SWEEP_STEP  = 6;     // m

// Frames' worth of travel the streak covers. Just over one, so consecutive
// frames touch and the bolt reads as a continuous line without becoming a
// tail — see where it is used for the arithmetic.
const STREAK_OVERLAP = 1.25;

export const MAX_SHOTS   = 6;     // the franchise's own number
const RECHARGE_TIME      = 2.6;   // seconds per shot returning
// Between shots. The fire key repeats while it is held, so this is the rate a
// leaned-on button gets — six shots in a second and a bit, then the empty click
// while the recharge catches up. Short enough that the weapon never feels like
// it is arguing with you, long enough that the burst is a burst.
const FIRE_COOLDOWN      = 0.22;

const COLOUR      = 0x8f6bff;
const COLOUR_HOT  = 0xe6d9ff;

export function setupPlasma(scene, { getHeightAt = null, seaLevel = 0 } = {}) {
  // --- Making it visible ---------------------------------------------------
  // A 1.15 m sphere two hundred metres away is three pixels, and three pixels
  // of additive violet over a bright sea is nothing. Three things fix that, and
  // the third is the one that matters:
  //
  //   * bigger, which is the cheap half of it;
  //   * brighter than white. The scene renders into the composer's half-float
  //     target, and three only tone-maps when it is drawing to the canvas — so
  //     the RenderPass output is linear HDR where the sky already sits at 5-20.
  //     A colour scaled past 1 therefore survives, and the bloom pass upstream
  //     has a threshold of 2.4. At 1.0 the bolt was under it and never glowed
  //     at all; the core is now well over and the halo sits just below, so the
  //     core flares and the halo stays a halo instead of smearing.
  //   * a STREAK. A point of light crossing 10 m per frame reads as a stutter
  //     of dots; stretching it along its own velocity is what turns it into a
  //     shot. Done by scaling the group, so it costs no extra geometry.
  const boltGeo = new THREE.SphereGeometry(RADIUS, 12, 10);
  const boltMat = new THREE.MeshBasicMaterial({
    color: COLOUR_HOT, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  // Well over the 2.4 bloom threshold, and further over it than it used to be:
  // a core a third the width has a ninth of the area, so it has to be hotter to
  // read at the same distance. The bloom is what gives a 1.2 m ball its size on
  // screen, and bloom off a small bright thing is a flare, where bloom off a
  // big dim thing is a smear.
  boltMat.color.multiplyScalar(9.0);
  // The halo is a second, bigger, dimmer sphere. Cheaper than a sprite sheet
  // and it reads correctly from every angle, which a billboard would not while
  // the camera is rolling through a carve.
  const haloGeo = new THREE.SphereGeometry(RADIUS * HALO_MUL, 10, 8);
  const haloMat = new THREE.MeshBasicMaterial({
    color: COLOUR, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  haloMat.color.multiplyScalar(2.0);          // under it, so it glows without smearing

  // Spheres, so any axis will do — the streak is applied down local +Z.
  const STREAK_AXIS = new THREE.Vector3(0, 0, 1);
  const _n = new THREE.Vector3();

  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const group = new THREE.Group();
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    group.add(bolt, halo);
    group.visible = false;
    scene.add(group);
    pool.push({
      group, bolt, halo,
      live: false, t: 0, travelled: 0, lightI: 0, rank: 0, speed: SPEED,
      vel: new THREE.Vector3(),
      onHit: null,
    });
  }

  // Impact flashes get their own tiny pool for the same reason.
  const flashes = [];
  for (let i = 0; i < 6; i++) {
    const ring = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({
        color: COLOUR, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    ring.visible = false;
    scene.add(ring);
    flashes.push({ ring, t: 0, live: false, lightI: 0, rank: 0 });
  }

  // -------------------------------------------------------------------------
  // The lights, and why there are five of them instead of sixteen.
  //
  // This used to be one PointLight per pooled bolt and one per impact flash,
  // hidden with `visible = false` until needed — on the reasoning that a light
  // at intensity zero still costs a loop iteration in every fragment shader,
  // which is true and is the wrong thing to optimise for.
  //
  // What it misses is that three compiles the light COUNT into every shader as
  // #define NUM_POINT_LIGHTS, and hiding a light takes it out of the count.
  // Firing a burst walked the scene's point-light total up and down through a
  // dozen different values, and each new value meant compiling a fresh variant
  // of every material in the game — the ocean, the terrain, the whole forest,
  // the dragon. That is the freeze in the middle of a firefight.
  //
  // So: a fixed number of lights, permanently in the scene, permanently
  // visible, only ever changing position and intensity. The count never moves,
  // nothing ever recompiles, and the constant per-pixel cost is capped at five
  // lights instead of sixteen.
  //
  // When more things want a light than there are lights, they are ranked and
  // the lowest rank wins: bolts by how far they have flown and flashes by age.
  // Distance flown is the right key because a bolt is fired from the dragon, so
  // the least-travelled bolt is the one nearest the camera — and a bolt's own
  // brightness is a constant flicker around 210, which would have made
  // "brightest first" an arbitrary choice dressed up as a sensible one.
  // -------------------------------------------------------------------------
  const BOLT_LIGHTS = 3, FLASH_LIGHTS = 2;
  const boltLights = [], flashLights = [];
  for (let i = 0; i < BOLT_LIGHTS; i++) {
    // Distance 0 would mean "no falloff limit", which lights the entire
    // archipelago from one bolt. It is a flare, so give it a real radius.
    const l = new THREE.PointLight(COLOUR, 0, 110, 1.8);
    scene.add(l); boltLights.push(l);
  }
  for (let i = 0; i < FLASH_LIGHTS; i++) {
    const l = new THREE.PointLight(COLOUR_HOT, 0, 420, 1.7);
    scene.add(l); flashLights.push(l);
  }

  const boltWant = [], flashWant = [];

  /** Hand `lights` to the lowest-ranked few of `items`; dim the rest to zero. */
  function lend(lights, items, posOf) {
    if (items.length > lights.length) items.sort((a, b) => a.rank - b.rank);
    for (let i = 0; i < lights.length; i++) {
      const e = items[i];
      if (e) { lights[i].position.copy(posOf(e)); lights[i].intensity = e.lightI; }
      else lights[i].intensity = 0;
    }
  }
  const boltPos = (b) => b.group.position;
  const flashPos = (f) => f.ring.position;

  let shots = MAX_SHOTS;
  let recharge = 0;
  let cooldown = 0;
  const listeners = [];

  function flashAt(p) {
    const f = flashes.find((x) => !x.live) || flashes[0];
    f.live = true; f.t = 0;
    f.ring.position.copy(p);
    f.ring.visible = true;
  }

  const api = {
    get shots() { return shots; },
    get maxShots() { return MAX_SHOTS; },
    /** 0..1 toward the next shot returning. Drives the HUD pips. */
    get rechargeT() { return shots >= MAX_SHOTS ? 1 : recharge / RECHARGE_TIME; },
    get ready() { return shots > 0 && cooldown <= 0; },

    /** Called with the impact point every time a blast lands. */
    onImpact(fn) { listeners.push(fn); },

    /**
     * @param {THREE.Vector3} from  muzzle, world space
     * @param {THREE.Vector3} dir   unit vector down the barrel
     * @param {THREE.Vector3} [carry] the shooter's own velocity. Only the part
     *   along `dir` is added, so the bolt always flies exactly where it was
     *   aimed — inheriting the sideways part too is what a real gun does and it
     *   would send a shot fired across his own flight path curving off the
     *   crosshair, which is a physics lesson nobody asked for.
     * @returns {boolean} whether a shot was actually spent
     */
    fire(from, dir, carry = null) {
      if (!api.ready) return false;
      const b = pool.find((x) => !x.live);
      if (!b) return false;

      shots--;
      cooldown = FIRE_COOLDOWN;
      if (shots === MAX_SHOTS - 1) recharge = 0;

      b.live = true; b.t = 0; b.travelled = 0;
      b.group.position.copy(from);
      b.group.visible = true;
      _n.copy(dir).normalize();
      const along = carry ? Math.max(0, carry.dot(_n)) : 0;
      b.speed = SPEED + along;
      b.vel.copy(_n).multiplyScalar(b.speed);
      // Point the streak down the barrel once, here — the direction never
      // changes after launch, so there is nothing to update per frame.
      b.group.quaternion.setFromUnitVectors(STREAK_AXIS, _n);
      // The streak, worked out from how far it moves rather than from a magic
      // number. A bolt jumps `speed / 60` metres between frames, so anything
      // shorter than that renders as a dotted line — you see the stutter, not
      // the shot. STREAK_OVERLAP is how many frames' worth of length it gets,
      // and it is the smallest number that still joins up, because on a bolt
      // this small every extra metre of streak is length the shot did not ask
      // for. The scale is against the DIAMETER, since that is what stretches.
      b.group.scale.set(1, 1,
        Math.max(1, (b.speed / 60) * STREAK_OVERLAP / (RADIUS * 2)));
      b.lightI = 260;
      return true;
    },

    /**
     * @param {number} dt
     * @param {Array<{pos:THREE.Vector3, hit:Function}>} targets
     *   Anything a blast can land on. The rig's braziers are the ones that
     *   matter — a snuffed brazier is the whole stealth economy of §2.6.
     */
    update(dt, targets = []) {
      if (cooldown > 0) cooldown -= dt;
      if (shots < MAX_SHOTS) {
        recharge += dt;
        if (recharge >= RECHARGE_TIME) { recharge = 0; shots++; }
      }

      for (const b of pool) {
        if (!b.live) continue;
        b.t += dt;
        // Flickers rather than glows, so it reads as combustion.
        b.lightI = 210 + Math.sin(b.t * 47) * 60;
        b.halo.scale.setScalar(1 + Math.sin(b.t * 31) * 0.12);

        // The frame, in hops of no more than SWEEP_STEP. Everything inside the
        // loop is the old per-frame body; the only change is that it now runs
        // two or three times on a fast shot and once on a slow one.
        const span  = b.speed * dt;
        const steps = Math.max(1, Math.ceil(span / SWEEP_STEP));
        const hdt   = dt / steps;
        let hit = null;

        for (let s = 0; s < steps; s++) {
          b.travelled += b.speed * hdt;
          const p = b.group.position.addScaledVector(b.vel, hdt);

          for (const t of targets) {
            if (!t || t.dead) continue;
            if (p.distanceTo(t.pos) < BLAST_R) { hit = t; break; }
          }

          if (!hit && getHeightAt) {
            const ground = Math.max(getHeightAt(p.x, p.z), seaLevel);
            if (p.y <= ground + 1) hit = { pos: p.clone(), ground: true };
          }

          if (hit || b.travelled > RANGE) break;
        }

        if (hit || b.travelled > RANGE) {
          b.live = false;
          b.group.visible = false;
          b.group.scale.set(1, 1, 1);
          b.lightI = 0;
          if (hit) {
            const at = hit.ground ? hit.pos : hit.pos.clone();
            flashAt(at);
            if (typeof hit.hit === "function") hit.hit();
            for (const fn of listeners) fn(at, hit);
          }
        }
      }

      for (const f of flashes) {
        if (!f.live) continue;
        f.t += dt;
        const k = f.t / 0.42;
        if (k >= 1) {
          f.live = false; f.ring.visible = false; f.lightI = 0;
          continue;
        }
        // Reaches about half of BLAST_R rather than most of it. The old one
        // bloomed out to a 42 m dome, which read as an explosion; this is the
        // crack of something small arriving very fast.
        f.ring.scale.setScalar(1 + k * BLAST_R * 0.42);
        f.ring.material.opacity = 0.75 * (1 - k) * (1 - k);
        f.lightI = 2600 * (1 - k);
      }

      // Reused arrays, emptied rather than reallocated — this runs every frame
      // and the whole point of pooling was to keep the collector out of a shot.
      boltWant.length = 0;
      for (const b of pool) if (b.live) { b.rank = b.travelled; boltWant.push(b); }
      lend(boltLights, boltWant, boltPos);

      flashWant.length = 0;
      for (const f of flashes) if (f.live) { f.rank = f.t; flashWant.push(f); }
      lend(flashLights, flashWant, flashPos);
    },

    /** Story hook: the lab, or a night's sleep, hands them all back. */
    refill() { shots = MAX_SHOTS; recharge = 0; },

    /** Debug: what is in the air right now, and how fast. */
    liveBolts: () => pool.filter((b) => b.live)
      .map((b) => ({ pos: b.group.position.clone(), speed: b.speed, travelled: b.travelled })),
  };

  return api;
}
