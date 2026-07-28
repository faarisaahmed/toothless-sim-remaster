import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { setupWings } from "./wings.js";

// Wild dragons flying aerobatic routines in small family groups.
//
// The leader improvises from a maneuver table; everyone behind replays the
// leader's recorded path a fraction of a second later, offset to the side.
// That's how real formation aerobatics work — followers fly the leader's line,
// not their own — and it costs one ring buffer instead of a steering solver.
// Hatchlings trail further back on a wobblier line and beat their wings faster.

const HISTORY_LEN  = 220;   // frames of leader path retained
const ADULT_LAG    = 15;    // frames of delay per wingman
const BABY_LAG     = 42;    // hatchlings hang further back
const ADULT_SIDE   = 13;
const BABY_SIDE    = 7;
const BABY_SCALE   = 0.42;
const CEILING      = 1500;
const FLOOR_MARGIN = 150;   // start pulling up this far above the ground
const ROAM_RADIUS  = 4400;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d >  Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// yaw is rad/sec, pitch is a held nose attitude. Cruise is listed twice so
// they spend more time flying than showing off.
const MANEUVERS = [
  { n: "cruise",   dur: [4, 8],     yaw: () => rand(-0.25, 0.25),               pitch: () => rand(-0.08, 0.08), roll: "bank" },
  { n: "cruise",   dur: [4, 8],     yaw: () => rand(-0.3, 0.3),                 pitch: () => rand(-0.1, 0.1),   roll: "bank" },
  { n: "carve",    dur: [3, 5.5],   yaw: () => pick([1, -1]) * rand(0.55, 0.9), pitch: () => rand(-0.05, 0.2),  roll: "bank" },
  { n: "climb",    dur: [2.5, 4],   yaw: () => rand(-0.45, 0.45),               pitch: () => rand(0.4, 0.62),   roll: "bank" },
  { n: "dive",     dur: [2, 3.5],   yaw: () => rand(-0.4, 0.4),                 pitch: () => rand(-0.62, -0.38),roll: "bank" },
  { n: "roll",     dur: [1.8, 3],   yaw: () => rand(-0.12, 0.12),               pitch: () => rand(0, 0.12),     roll: "spin" },
  { n: "knife",    dur: [1.8, 2.8], yaw: () => pick([1, -1]) * rand(0.45, 0.75),pitch: () => rand(0.05, 0.2),   roll: "knife" },
  { n: "wingover", dur: [2.5, 3.5], yaw: () => pick([1, -1]) * rand(0.85, 1.15),pitch: () => rand(0.25, 0.5),   roll: "bank" },
];

// Per-dragon view over the shared tuning, so hatchlings can beat faster without
// needing their own copy of every knob.
function wingTuning(base, rateMul, ampMul) {
  return {
    get flapAmplitude() { return base.flapAmplitude * ampMul; },
    get flapSpeed()     { return base.flapSpeed * rateMul; },
    get sweepAmount()   { return base.sweepAmount; },
    get tuckSign()      { return base.tuckSign; },
  };
}

function makeDragon(template, tuning, isBaby) {
  const obj = cloneSkinned(template);
  obj.rotation.order = "YXZ";
  obj.scale.setScalar(isBaby ? BABY_SCALE * 2 : 2);

  let skel = null;
  obj.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
    if (o.isSkinnedMesh) {
      skel = o.skeleton;
      // Culling is left ON here (unlike the player) because there are a lot of
      // these — the shared bounding sphere is inflated below so wings can't pop.
      o.frustumCulled = true;
    }
  });

  let updateWings = null;
  if (skel) {
    const wl = skel.getBoneByName("Bone004");
    const wr = skel.getBoneByName("Bone005");
    // Small wings beat faster and deeper. Most of what makes them read as babies.
    if (wl && wr) {
      updateWings = setupWings(wl, wr, isBaby ? wingTuning(tuning, 2.0, 1.15) : tuning);
    }
  }

  return {
    obj,
    updateWings,
    isBaby,
    lag: 0,
    side: 0,
    wobblePhase: rand(0, Math.PI * 2),
    wobbleRate: rand(1.1, 1.9),
  };
}

// How many groups get placed right on top of the player's spawn, so there's
// something in frame the moment the world loads rather than only at distance.
const NEAR_SPAWN_FLIGHTS = 2;

export function setupFlights(scene, template, tuning, world, flightCount = 7, spawn = null) {
  // Bind-pose bounds are too tight once the wings move, so inflate the shared
  // geometry's sphere rather than disabling culling on two dozen meshes.
  template.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    o.geometry.boundingSphere.radius *= 1.9;
  });

  const flights = [];

  for (let i = 0; i < flightCount; i++) {
    const adults  = Math.random() < 0.45 ? 3 : 2;      // leader included
    const babies  = Math.random() < 0.65 ? (Math.random() < 0.4 ? 2 : 1) : 0;

    let startPos, startHeading;
    if (spawn && i < NEAR_SPAWN_FLIGHTS) {
      // Just ahead of the player, who spawns pointed down -Z toward Berk.
      startPos = new THREE.Vector3(
        spawn.x + rand(-300, 300),
        spawn.y + rand(-70, 160),
        spawn.z - rand(220, 700)
      );
      // Crossing his line of sight rather than flying away from him.
      startHeading = pick([Math.PI / 2, -Math.PI / 2]) + rand(-0.45, 0.45);
    } else {
      const a = (i / flightCount) * Math.PI * 2 + rand(-0.35, 0.35);
      const r = rand(700, 4000);
      startPos = new THREE.Vector3(Math.cos(a) * r, rand(300, 900), Math.sin(a) * r);
      startHeading = rand(0, Math.PI * 2);
    }

    const leader = {
      pos: startPos,
      heading: startHeading,
      pitch: 0,
      roll: 0,
      yawRate: 0,
      baseSpeed: rand(24, 40),
      spinDir: pick([1, -1]),
      man: MANEUVERS[0],
      targetYaw: 0,
      targetPitch: 0,
      rollMode: "bank",
      timer: rand(0, 3),
      history: [],
    };

    const members = [];
    for (let k = 0; k < adults; k++) {
      const m = makeDragon(template, tuning, false);
      m.lag = k * ADULT_LAG;
      m.side = k === 0 ? 0 : (k % 2 === 1 ? ADULT_SIDE : -ADULT_SIDE);
      members.push(m);
    }
    for (let k = 0; k < babies; k++) {
      const m = makeDragon(template, tuning, true);
      m.lag = BABY_LAG + k * 16;
      m.side = (k % 2 === 0 ? 1 : -1) * rand(BABY_SIDE * 0.5, BABY_SIDE);
      members.push(m);
    }

    for (const m of members) scene.add(m.obj);
    flights.push({ leader, members });
  }

  const dir = new THREE.Vector3();
  let visible = true;
  let elapsed = 0;

  function stepLeader(f, dt) {
    f.timer -= dt;
    if (f.timer <= 0) {
      f.man = pick(MANEUVERS);
      f.timer = rand(f.man.dur[0], f.man.dur[1]);
      f.targetYaw = f.man.yaw();
      f.targetPitch = f.man.pitch();
      f.rollMode = f.man.roll;
      if (f.rollMode === "spin") f.spinDir = pick([1, -1]);
    }

    let tYaw = f.targetYaw;
    let tPitch = f.targetPitch;

    // Safety overrides beat whatever trick is in progress.
    const ground = Math.max(world.getHeightAt(f.pos.x, f.pos.z), world.seaLevel);
    if (f.pos.y - ground < FLOOR_MARGIN) {
      tPitch = Math.max(tPitch, 0.5);
      if (f.rollMode !== "bank") f.rollMode = "bank";
    } else if (f.pos.y > CEILING) {
      tPitch = Math.min(tPitch, -0.2);
    }

    // Turn back if they wander off the archipelago.
    if (Math.hypot(f.pos.x, f.pos.z) > ROAM_RADIUS) {
      const home = Math.atan2(-f.pos.x, -f.pos.z);
      tYaw = THREE.MathUtils.clamp(angleDelta(f.heading, home) * 1.4, -1.2, 1.2);
    }

    f.yawRate += (tYaw - f.yawRate) * damp(2.2, dt);
    f.pitch   += (tPitch - f.pitch) * damp(1.8, dt);
    f.heading += f.yawRate * dt;

    // Roll: bank into the turn, hold a wingtip, or spin right through.
    if (f.rollMode === "spin") {
      f.roll += 4.2 * dt * f.spinDir;
    } else if (f.rollMode === "knife") {
      f.roll += (1.42 * Math.sign(f.yawRate || 1) - f.roll) * damp(2.8, dt);
    } else {
      f.roll += ((f.yawRate / 1.2) * 0.75 - f.roll) * damp(2.6, dt);
    }

    // Trade height for speed the way a real glide does.
    const speed = f.baseSpeed * (1 - f.pitch * 0.55);
    const cp = Math.cos(f.pitch);
    dir.set(Math.sin(f.heading) * cp, Math.sin(f.pitch), Math.cos(f.heading) * cp);
    f.pos.addScaledVector(dir, speed * dt);

    f.history.push({
      x: f.pos.x, y: f.pos.y, z: f.pos.z,
      heading: f.heading, pitch: f.pitch, roll: f.roll,
      speed,
    });
    if (f.history.length > HISTORY_LEN) f.history.shift();
  }

  function poseMember(m, sample, f, dt) {
    // Hatchlings can't hold a line — they drift and bob around the slot.
    let side = m.side;
    let lift = m.side === 0 ? 0 : -2;
    if (m.isBaby) {
      side += Math.sin(elapsed * m.wobbleRate + m.wobblePhase) * 3.5;
      lift += Math.sin(elapsed * m.wobbleRate * 1.7 + m.wobblePhase) * 2.5 - 4;
    }

    // forward = (sin h, cos h), so right = (-cos h, 0, sin h).
    m.obj.position.set(
      sample.x - Math.cos(sample.heading) * side,
      sample.y + lift,
      sample.z + Math.sin(sample.heading) * side
    );
    m.obj.rotation.set(sample.pitch, sample.heading + Math.PI, sample.roll);

    if (m.updateWings) {
      m.updateWings(dt, {
        climb: THREE.MathUtils.clamp(sample.pitch / 0.6, -1, 1),
        speedT: THREE.MathUtils.clamp((sample.speed - 22) / 60, 0, 1),
        knife: f.rollMode === "knife" ? Math.min(1, Math.abs(sample.roll) / 1.42) : 0,
      });
    }
  }

  return {
    setVisible(v) {
      visible = v;
      for (const f of flights) for (const m of f.members) m.obj.visible = v;
      return visible;
    },
    isVisible: () => visible,
    count() {
      let adults = 0, babies = 0;
      for (const f of flights) {
        for (const m of f.members) m.isBaby ? babies++ : adults++;
      }
      return { adults, babies, total: adults + babies, flights: flights.length };
    },

    update(dt) {
      if (!visible) return;
      elapsed += dt;

      for (const f of flights) {
        stepLeader(f.leader, dt);
        const h = f.leader.history;
        if (!h.length) continue;

        for (const m of f.members) {
          const lag = Math.min(m.lag, h.length - 1);
          poseMember(m, h[h.length - 1 - lag], f.leader, dt);
        }
      }
    },
  };
}
