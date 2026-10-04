import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------
// The hunters.
//
// The crews on Dragon Hunter Island used to be cold orbs sliding along lines.
// These are men: a spearman who walks the terraces and throws bolas, and an
// archer who stands on the rim and the towers and shoots. Each one sees, gets
// suspicious, raises the alarm, and fights.
//
// LIVING. They are not waiting for him. A crew man has a bunk in a hall or a
// hut and a day: up at half five, eat, work — at the bench, the anvil, the
// smelter's mouth, the cages, hauling crates between them — eat again at noon,
// work, and in the evening sit round the fires until they turn in at ten. A
// few sit up late. At night the island is asleep but for the watch: an archer
// on every tower and lean-to, the ballista crews, and patrols with torches.
// The camp tells this file where things are (`camp`: fires and their seats,
// tables, work spots, crate piles, homes, and how to walk between them).
//
// SEEING. A man can see the dragon if nothing is in the way (the line is
// sampled against the height field — the pit walls and the rim hide a lot),
// if he is facing that way, and if there is light to see by. By day there
// always is. By night it is the torches and fires near the dragon, the torch
// in a patrolman's hand, and the moon, which is very little: in the dark a man
// sees a dragon at a few dozen metres if he is looking straight at it, and a
// man sitting by a fire is blind past its light. What he is DOING matters as
// much — a man asleep sees nothing, one eating or hammering is barely looking,
// a sentry is. Noise is heard rather than seen: no facing needed, but it
// carries only so far. What he gets fills an awareness meter:
//
//      0 .. 0.5   nothing
//      0.5 .. 1   "?" over his head; he stops what he is doing to look
//      1+         "!" — he has him; he shouts, archers draw, and the island
//                 goes to ALARM for a while: every man awake is looking, the
//                 sleepers tumble out of their doors, and the ones who could
//                 not see him before now know roughly where.
//
// DRAWING. Dozens of men at five parts each would be hundreds of meshes and,
// at eight materials a part, a couple of thousand draw calls. Instead every
// part of every kit is one InstancedMesh, its materials baked into vertex
// colour (with the model's own occlusion), and each man is a set of instance
// matrices computed from his pose. All the hunters on the island are ten draw
// calls.
//
// ARROWS are real projectiles: they lead him, they drop, they miss when he is
// fast and far and dark, they stick in the rock when they miss, and they hurt.
// ---------------------------------------------------------------------------

const KITS = ["dh_hunter", "dh_archer"];
const PARTS = ["torso", "arm_l", "arm_r", "leg_l", "leg_r"];
const BASE = "./assets/models/props/";

/** Linear base colours for the slots, baked into the instanced geometry. */
const SLOT_COLOUR = {
  wood: 0x7a5636, wood_dark: 0x3e2c1d, stone: 0x6e6c68, iron: 0x5a5f68,
  rope: 0x8a7650, cloth: 0x5c5546, hide: 0x5a4434, ember: 0xff6a22,
  skin: 0xb98a6e, leather: 0x3a2a1e,
};

const SIGHT = 520;           // m — nobody sees past this, in full daylight
const ARCHER_RANGE = 380;    // m — and nobody shoots past this
const ARROW_SPEED = 95;      // m/s
const ARROW_DAMAGE = 7;
const ALARM_TIME = 22;       // s the island stays roused after the last sighting
const HEARING = 120;         // m — a loud dragon is heard inside this
const WAKE_RANGE = 170;      // m — an alarm this close to his door gets a sleeper up
const MOON = 0.04;           // what there is to see by at midnight away from a fire

/** How much a man is paying attention, by what he is doing. */
const ATTN = { sleep: 0, eat: 0.32, sit: 0.4, chat: 0.38, work: 0.42, tend: 0.5, stoop: 0.3,
               haul: 0.55, walk: 0.65, patrol: 0.85, guard: 1, roused: 1 };

const _m = new THREE.Matrix4(), _p = new THREE.Matrix4(), _r = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const _w = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

async function loadKit(loader, name) {
  const gltf = await loader.loadAsync(BASE + name + ".glb");
  const parts = {};
  gltf.scene.updateMatrixWorld(true);
  for (const pname of PARTS) {
    const node = gltf.scene.getObjectByName(pname);
    if (!node) continue;
    const geos = [];
    node.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      // Bring each primitive into the part's own frame (pivot at the origin).
      _m.copy(node.matrixWorld).invert().multiply(o.matrixWorld);
      g.applyMatrix4(_m);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const base = new THREE.Color(SLOT_COLOUR[o.material?.name] ?? 0x808080);
      const ao = g.attributes.color;
      for (let i = 0; i < n; i++) {
        const k = ao ? ao.getX(i) : 1;
        col[i * 3] = base.r * k; col[i * 3 + 1] = base.g * k; col[i * 3 + 2] = base.b * k;
      }
      for (const key of Object.keys(g.attributes)) {
        if (key !== "position" && key !== "normal") g.deleteAttribute(key);
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geos.push(g.index ? g.toNonIndexed() : g);
    });
    if (!geos.length) continue;
    parts[pname] = {
      geometry: mergeGeometries(geos, false),
      pivot: node.position.clone(),
    };
  }
  return parts;
}


const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * @param {object} o
 *   scene, getHeightAt
 *   getLights()   [{pos: Vector3, lit: bool, r: number}] near the base
 *   onArrowHit(arrow) called when one lands on him
 *   camp          where the crews live and work (hunterbase.js): {fires, tables,
 *                 works, piles, homes, route(zone, from, to) -> [Vector3...]}
 */
export async function createHunters(scene, { getHeightAt, getLights = () => [], onArrowHit = () => {}, camp = null } = {}) {
  const loader = new GLTFLoader();
  const kits = {};
  for (const k of KITS) {
    try { kits[k] = await loadKit(loader, k); } catch (e) { console.warn("hunters: no", k, e); }
  }

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 });
  const group = new THREE.Group();
  group.name = "hunters";
  scene.add(group);

  const men = [];
  const meshes = {};       // `${kit}/${part}` -> InstancedMesh
  const CAP = 128;         // men per kit

  // --- arrows ---------------------------------------------------------------
  const ARROWS = 96;
  const arrowGeo = (() => {
    const shaft = new THREE.BoxGeometry(0.04, 0.04, 0.9);
    const head = new THREE.ConeGeometry(0.05, 0.16, 4).rotateX(Math.PI / 2).translate(0, 0, 0.52);
    const flet = new THREE.BoxGeometry(0.12, 0.005, 0.14).translate(0, 0, -0.4);
    const g = mergeGeometries([shaft.toNonIndexed(), head.toNonIndexed(), flet.toNonIndexed()], false);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3).fill(0.32);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  })();
  const arrowMesh = new THREE.InstancedMesh(arrowGeo, material, ARROWS);
  arrowMesh.frustumCulled = false;
  arrowMesh.count = 0;
  group.add(arrowMesh);
  const arrows = [];
  // A streak behind every arrow in the air, so you can see them coming.
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(ARROWS * 6);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({
    color: 0xffe2b0, transparent: true, opacity: 0.55, depthWrite: false }));
  trail.frustumCulled = false;
  group.add(trail);

  // --- hand torches ------------------------------------------------------------
  // The night watch carries fire: a stick in the left hand and a flame on it,
  // which is also a light — he sees what is near him, and he can be seen.
  const TORCHES = 48;
  const stickGeo = (() => {
    const g = new THREE.CylinderGeometry(0.03, 0.025, 0.75, 5).translate(0, 0.375, 0).toNonIndexed();
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = 0.16; col[i + 1] = 0.1; col[i + 2] = 0.06; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    return g;
  })();
  const stickMesh = new THREE.InstancedMesh(stickGeo, material, TORCHES);
  stickMesh.frustumCulled = false;
  stickMesh.count = 0;
  group.add(stickMesh);
  const flameGeo = new THREE.BufferGeometry();
  const flamePos = new Float32Array(TORCHES * 3);
  flameGeo.setAttribute("position", new THREE.BufferAttribute(flamePos, 3));
  const flameTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,230,170,1)"); gr.addColorStop(0.3, "rgba(255,150,60,0.6)");
    gr.addColorStop(1, "rgba(255,90,20,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flames = new THREE.Points(flameGeo, new THREE.PointsMaterial({
    map: flameTex, size: 1.1, sizeAttenuation: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xffb070 }));
  flames.frustumCulled = false;
  flames.renderOrder = 6;
  group.add(flames);
  /** Lights carried by men, for the base's light pool and for seeing by. */
  const carried = [];

  let alarm = 0;
  let lastSeenAt = new THREE.Vector3();
  let time = 0;
  let hour = 12;

  function meshFor(kit, part) {
    const key = `${kit}/${part}`;
    if (meshes[key]) return meshes[key];
    const p = kits[kit]?.[part];
    if (!p) return null;
    const m = new THREE.InstancedMesh(p.geometry, material, CAP);
    m.frustumCulled = false;
    m.castShadow = true;
    m.count = 0;
    group.add(m);
    meshes[key] = m;
    return m;
  }

  /**
   * Add a man.
   *   kind      "spear" | "archer"
   *   role      "watch" (a post, day and night), "patrol" (a route), or "crew"
   *             (a home and a day's work round the camp)
   *   pos       where he stands (Vector3, on the ground or a deck)
   *   facing    radians, which way his post looks
   *   route     [Vector3...] a patrol walks round, looping
   *   seat      a watchman's place to sit at night: {pos, yaw}
   *   home      a crew man's bunk: {door, zone}
   *   post      a name for the story ("tower 3")
   */
  function add({ kind = "spear", role = null, pos, facing = 0, route = null, post = "", ballista = null,
                 seat = null, home = null, torch = false }) {
    role ??= route ? "patrol" : "watch";
    const start = (pos || route?.[0] || home?.door).clone();
    const man = {
      kind, kit: kind === "archer" ? "dh_archer" : "dh_hunter", role,
      pos: start, post: start.clone(), facing, yaw: facing, route, leg: 0, label: post, ballista,
      seat, home, zone: home?.zone ?? null, torchAtNight: torch || role === "patrol",
      walk: 0, speed: 1.5 + Math.random() * 0.4,
      awareness: 0, state: "calm",
      reload: 1.5 + Math.random() * 2.5, draw: 0,
      ko: 0, koT: 0,
      alerted: 0,
      id: men.length,
      // The day.
      act: role === "patrol" ? "patrol" : role === "watch" ? "guard" : "walk",
      steps: [], path: [], stepT: 0, sit: 0, lean: 0, inside: false, wake: 0,
      owl: Math.random() < 0.18, seatRef: null, torch: false,
      phase: Math.random() * 10,
    };
    men.push(man);
    return man;
  }

  // --- the day ------------------------------------------------------------------
  const isNight = (h) => h >= 22 || h < 5.5;
  const isMeal = (h) => (h >= 6 && h < 7.2) || (h >= 12 && h < 13) || (h >= 18.5 && h < 22);
  const inZone = (list, zone) => list.filter((x) => !x.zone || !zone || x.zone === zone);

  function freeSeat(zone, firesOnly = false) {
    const seats = [];
    for (const f of inZone(camp?.fires ?? [], zone)) for (const s of f.seats) if (!s.by) seats.push(s);
    if (!firesOnly) for (const t of inZone(camp?.tables ?? [], zone)) for (const s of t.seats) if (!s.by) seats.push(s);
    return seats.length ? pick(seats) : null;
  }
  function release(man) { if (man.seatRef) { man.seatRef.by = null; man.seatRef = null; } }

  /** Decide what a crew man does next, as a list of steps. */
  const dayPart = (h) => isNight(h) ? (h >= 22 || h < 1 ? "late" : "night") : isMeal(h) ? "meal" : "work";
  function plan(man) {
    release(man);
    man.steps = [];
    const h = hour;
    man.planPart = dayPart(h);
    if (man.role === "watch") {
      // Sentries stand their post; at night the ones with somewhere to sit
      // spend some of it sitting.
      if (man.seat && isNight(h) && Math.random() < 0.55) {
        man.steps.push({ to: man.seat.pos, act: "sit", dur: rand(40, 90), yaw: man.seat.yaw, ground: false });
      } else {
        man.steps.push({ to: man.post, act: "guard", dur: rand(40, 80), yaw: man.facing });
      }
      return;
    }
    if (man.role !== "crew" || !camp) return;
    const zone = man.zone;
    if (isNight(h) && !(man.owl && (h >= 22 || h < 1))) {
      man.steps.push({ to: man.home.door, act: "sleep", dur: 1e9 });
      return;
    }
    if (isMeal(h) || isNight(h)) {
      // The owls only ever sit up by a fire; nobody works in the dark.
      const seat = Math.random() < 0.75 || isNight(h) ? freeSeat(zone, isNight(h)) : null;
      if (seat) {
        seat.by = man; man.seatRef = seat;
        man.steps.push({ to: seat.pos, act: "eat", dur: rand(40, 110), yaw: seat.yaw, ground: seat.ground });
        return;
      }
      if (isNight(h)) {
        const f = inZone(camp.fires, zone)[0];
        const a = Math.random() * Math.PI * 2;
        const at = f ? f.pos.clone().add(new THREE.Vector3(Math.sin(a) * 3.6, 0, Math.cos(a) * 3.6)) : man.home.door;
        at.y = getHeightAt(at.x, at.z);
        man.steps.push({ to: at, act: "chat", dur: rand(30, 60), look: f?.pos });
        return;
      }
    }
    // Work, haul, tend, or stand about talking.
    const r = Math.random();
    const works = inZone(camp.works, zone);
    const piles = zone?.kind === "floor" ? camp.piles : [];
    const others = men.filter((m) => m !== man && m.role === "crew" && m.zone === zone && !m.inside &&
      m.act !== "walk" && m.act !== "sleep" && m.ko === 0);
    if (r < 0.18 && others.length) {
      const o = pick(others);
      const a = Math.random() * Math.PI * 2;
      const at = o.pos.clone().add(new THREE.Vector3(Math.sin(a) * 1.7, 0, Math.cos(a) * 1.7));
      man.steps.push({ to: at, act: "chat", dur: rand(15, 40), face: o });
    } else if (r < 0.45 && piles.length && works.length) {
      const from = pick(piles), to = pick(works);
      for (let k = 0; k < 2; k++) {
        man.steps.push({ to: from, act: "stoop", dur: 2.5, near: 1.6 });
        man.steps.push({ to: to.pos, act: "stoop", dur: 2.0, carry: true, near: 1.2 });
      }
    } else if (works.length) {
      const w = pick(works);
      man.steps.push({ to: w.pos, act: w.act, dur: rand(35, 90), yaw: w.yaw, look: w.look });
    } else {
      man.steps.push({ to: man.home.door, act: "chat", dur: rand(10, 20) });
    }
  }

  function startStep(man) {
    const st = man.steps[0];
    man.stepT = 0;
    man.path = camp && man.zone ? camp.route(man.zone, man.pos, st.to) : [st.to.clone()];
  }

  /** Walk along the path; true when he has arrived. */
  function walkPath(man, dt, speed) {
    const target = man.path[0];
    if (!target) return true;
    const dx = target.x - man.pos.x, dz = target.z - man.pos.z;
    const dl = Math.hypot(dx, dz);
    const near = man.path.length === 1 ? (man.steps[0]?.near ?? 0.5) : 1.2;
    if (dl < near) { man.path.shift(); return man.path.length === 0; }
    const step = Math.min(dl, speed * dt);
    man.pos.x += (dx / dl) * step;
    man.pos.z += (dz / dl) * step;
    const g = getHeightAt(man.pos.x, man.pos.z);
    man.pos.y = Math.abs(g - man.pos.y) < 6 ? g : target.y;
    man.wantYaw = Math.atan2(dx, dz);
    man.moving = true;
    return false;
  }

  /** One frame of a man's day. Sets moving, wantYaw, act. */
  function live(man, dt, roused) {
    man.moving = false;
    man.wantYaw = man.yaw;

    if (roused) {
      // Stop everything and look. The sleepers come out first.
      if (man.inside) {
        man.wake -= dt;
        if (man.wake > 0) return;
        man.inside = false;
        man.pos.copy(man.home.door);
      }
      release(man);
      man.steps.length = 0;
      man.path.length = 0;
      man.act = "roused";
      man.planned = false;
      return;
    }
    if (man.act === "roused") { man.act = "walk"; man.planned = false; }

    if (man.role === "patrol") {
      man.act = "patrol";
      const route = man.route;
      if (!route?.length) return;
      if (man.pause > 0) { man.pause -= dt; man.wantYaw = man.yaw + Math.sin(time * 0.7 + man.phase) * 0.02; return; }
      const target = route[(man.leg + 1) % route.length];
      const dx = target.x - man.pos.x, dz = target.z - man.pos.z;
      const dl = Math.hypot(dx, dz);
      if (dl < 1.2) {
        man.leg = (man.leg + 1) % route.length;
        // Every so often he stops and has a look round.
        if (man.leg % 3 === 0) man.pause = rand(3, 7);
        return;
      }
      const step = Math.min(dl, man.speed * dt);
      man.pos.x += (dx / dl) * step;
      man.pos.z += (dz / dl) * step;
      const g = getHeightAt(man.pos.x, man.pos.z);
      man.pos.y = Math.abs(g - man.pos.y) < 6 ? g : target.y;
      man.wantYaw = Math.atan2(dx, dz);
      man.moving = true;
      return;
    }

    if (man.inside) {
      // Asleep. Up at half five (or when the owls turn in, for nobody).
      if (!isNight(hour)) { man.inside = false; man.pos.copy(man.home.door); man.steps.length = 0; }
      else return;
    }
    // The bell goes — supper, or bed — and whatever he was doing can wait.
    if (man.steps.length && man.planPart !== dayPart(hour)) man.steps.length = 0;
    if (!man.steps.length) { plan(man); if (man.steps.length) startStep(man); else return; }
    const st = man.steps[0];
    if (man.path.length) {
      man.act = st.carry ? "haul" : "walk";
      if (!walkPath(man, dt, man.speed)) return;
    }
    // There. Do the thing.
    man.act = st.act;
    man.stepT += dt;
    if (st.act === "sleep") {
      man.inside = true;
      man.wake = rand(1.5, 6);
      man.steps.length = 0;
      return;
    }
    if (st.face) man.wantYaw = Math.atan2(st.face.pos.x - man.pos.x, st.face.pos.z - man.pos.z);
    else if (st.look) man.wantYaw = Math.atan2(st.look.x - man.pos.x, st.look.z - man.pos.z);
    else if (st.yaw !== undefined) {
      man.wantYaw = st.yaw;
      // A sentry does not stare at one spot: he looks round, slowly.
      if (st.act === "guard") man.wantYaw += Math.sin(time * 0.23 + man.phase) * 1.1 + Math.sin(time * 0.61 + man.phase * 2) * 0.3;
    }
    // Time up — or, for a meal, the meal is over — and on to the next thing.
    if (man.stepT > st.dur || (st.act === "eat" && !isMeal(hour) && !(man.owl && isNight(hour)) && man.stepT > 10)) {
      man.steps.shift();
      if (man.steps.length) startStep(man);
      else release(man);
    }
  }

  // --- seeing ----------------------------------------------------------------
  function lineOfSight(from, to) {
    const steps = 9;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      if (getHeightAt(x, z) > y + 1.5) return false;
    }
    return true;
  }

  function lightAt(p, night) {
    // Daylight is everywhere; at night it is the fires, the torches — the ones
    // on posts and the ones in hands — and a little moon.
    let l = 1 - night * (1 - MOON);
    for (const L of getLights()) {
      if (!L.lit) continue;
      const d = L.pos.distanceTo(p);
      if (d < L.r) l = Math.max(l, 1 - d / L.r);
    }
    for (const L of carried) {
      const d = L.pos.distanceTo(p);
      if (d < L.r) l = Math.max(l, 1 - d / L.r);
    }
    return Math.min(1, l);
  }

  // --- shooting -------------------------------------------------------------
  function fire(from, target, tvel, accuracy) {
    if (arrows.length >= ARROWS) return false;
    // Lead him: where will he be when an arrow at this speed gets there?
    const d = from.distanceTo(target);
    const t = d / ARROW_SPEED;
    _v.copy(target).addScaledVector(tvel, t * 0.92);
    // Spread grows with everything that makes him hard to hit.
    const spread = (1 - accuracy) * 0.09 * d;
    _v.x += (Math.random() - 0.5) * spread;
    _v.y += (Math.random() - 0.5) * spread * 0.6;
    _v.z += (Math.random() - 0.5) * spread;
    const dir = _w.copy(_v).sub(from);
    const flat = Math.hypot(dir.x, dir.z);
    // Aim up to cancel the drop over the flight time.
    dir.y += 0.5 * 9.8 * t * t;
    dir.normalize().multiplyScalar(ARROW_SPEED);
    arrows.push({ pos: from.clone(), prev: from.clone(), vel: dir.clone(), life: 6, stuck: 0, flat });
    return true;
  }

  // --- per frame ------------------------------------------------------------
  const _eye = new THREE.Vector3();
  /**
   * @param {object} t   the dragon: { pos, vel, loud, hidden }
   * @param {number} night  0 day .. 1 night
   * @param {number} h      the hour, 0..24
   */
  function update(dt, t, night = 0, h = hour) {
    time += dt;
    hour = h;
    alarm = Math.max(0, alarm - dt);
    const seenNow = [];
    const dark = night > 0.5;
    // How lit the dragon is: the same for every man, so once.
    const tLight = t && !t.hidden ? lightAt(t.pos, night) : 0;

    for (const man of men) {
      if (man.ko > 0) {
        man.ko = Math.max(0, man.ko - dt);
        man.koT = Math.min(1, man.koT + dt * 3);
        if (man.ko === 0) man.awareness = 0.8;   // gets up wondering what hit him
        continue;
      }
      man.koT = Math.max(0, man.koT - dt * 2);
      man.torch = dark && man.torchAtNight && !man.inside;

      // --- awareness --------------------------------------------------------
      let vis = 0;
      if (t && !t.hidden && !man.inside) {
        const eye = _eye.copy(man.pos); eye.y += man.sit > 0.5 ? 1.0 : 1.65;
        const d = eye.distanceTo(t.pos);
        const attention = Math.max(ATTN[man.act] ?? 0.6, man.awareness > 0.5 || alarm > 0 ? 0.9 : 0);
        if (d < SIGHT && attention > 0) {
          const light = tLight;
          // How far he can see depends on how lit the dragon is: a few dozen
          // metres in the dark, the whole pit by day or over a fire.
          const range = SIGHT * (0.12 + 0.88 * light);
          const toX = t.pos.x - man.pos.x, toZ = t.pos.z - man.pos.z;
          const bearing = Math.atan2(toX, toZ);
          const off = Math.abs(Math.atan2(Math.sin(bearing - man.yaw), Math.cos(bearing - man.yaw)));
          const fov = man.awareness > 0.5 || alarm > 0 ? 1 : off < 0.95 ? 1 : off < 1.7 ? 0.3 : 0;
          // A man standing in firelight is blind to the dark beyond it.
          // (His own light changes slowly — he walks — so it is re-read about
          // once a second rather than every frame for every man.)
          if (dark && light < 0.3 && (man.lightT = (man.lightT ?? 0) - dt) <= 0) {
            man.ownLight = lightAt(eye, night);
            man.lightT = 0.8 + Math.random() * 0.4;
          }
          const dazzle = dark && light < 0.3 && (man.ownLight ?? 0) > 0.55 ? 0.4 : 1;
          const heard = t.loud && d < HEARING ? 0.3 * (1 - d / HEARING) : 0;
          let seen = 0;
          if ((d < range && fov > 0) || heard > 0) {
            // The sight line is twelve height samples; the dragon moves a few
            // metres between checks at four a second, which nobody can see.
            if ((man.losT = (man.losT ?? 0) - dt) <= 0) {
              man.los = lineOfSight(eye, t.pos);
              man.losT = 0.2 + Math.random() * 0.1;
            }
            if (man.los) {
              if (d < range) seen = light * 0.9 * Math.pow(1 - d / range, 0.7) * fov * dazzle;
              // Close enough and he cannot be missed — if he is looking.
              if (d < (dark ? 9 : 24) && fov >= 1) seen = Math.max(seen, 0.8);
            }
          }
          vis = Math.min(1.5, (seen + heard) * attention * 1.6);
        }
      }
      const rise = vis > 0.15 ? vis * 1.1 : -0.3;
      man.awareness = THREE.MathUtils.clamp(man.awareness + rise * dt,
        alarm > 0 && !man.inside ? 0.55 : 0, 1.6);
      const was = man.state;
      man.state = man.awareness >= 1 ? "alert" : man.awareness >= 0.5 ? "suspicious" : "calm";
      if (man.state === "alert") {
        alarm = ALARM_TIME;
        lastSeenAt.copy(t.pos);
        man.alerted = 2;
        if (was !== "alert") seenNow.push(man);
      }

      // --- what he is doing ---------------------------------------------------
      // An alarm gets the sleepers up only if it is near enough to hear the
      // shouting; the far side of the pit sleeps through a scare on this one.
      const near = !man.inside || man.home.door.distanceTo(lastSeenAt) < WAKE_RANGE;
      live(man, dt, (alarm > 0 && near) || man.state !== "calm");
      let wantYaw = man.wantYaw;
      if (man.state !== "calm" && t && !man.inside) {
        const look = man.state === "alert" ? t.pos : lastSeenAt.lengthSq() > 0 ? lastSeenAt : t.pos;
        wantYaw = Math.atan2(look.x - man.pos.x, look.z - man.pos.z);
      } else if (alarm > 0 && lastSeenAt.lengthSq() > 0 && !man.inside) {
        wantYaw = Math.atan2(lastSeenAt.x - man.pos.x, lastSeenAt.z - man.pos.z);
      }
      const dy = Math.atan2(Math.sin(wantYaw - man.yaw), Math.cos(wantYaw - man.yaw));
      man.yaw += dy * Math.min(1, dt * (man.state === "alert" ? 8 : 3));
      if (man.moving) man.walk += dt * man.speed * 3.2;
      else man.walk += (Math.round(man.walk / Math.PI) * Math.PI - man.walk) * Math.min(1, dt * 6);
      const sitting = !man.moving && (man.act === "eat" || man.act === "sit");
      man.sit += ((sitting ? 1 : 0) - man.sit) * Math.min(1, dt * 3);
      man.lean += ((man.act === "stoop" && !man.moving ? 0.55 : man.act === "work" ? 0.12 : 0) - man.lean) * Math.min(1, dt * 4);
      man.groundSeat = man.steps[0]?.ground ?? true;

      // --- archers shoot ----------------------------------------------------
      if (man.kind === "archer" && !man.inside) {
        man.reload -= dt;
        const d = t ? man.pos.distanceTo(t.pos) : 1e9;
        if (man.state === "alert" && d < ARCHER_RANGE && vis > 0.15) {
          if (man.reload <= 0.8) man.draw = Math.min(1, man.draw + dt * 1.6);
          if (man.reload <= 0) {
            const from = _w.set(0, 1.5, 0.5).applyAxisAngle(THREE.Object3D.DEFAULT_UP, man.yaw).add(man.pos);
            const acc = THREE.MathUtils.clamp(vis * (1 - d / ARCHER_RANGE) * (1 - (t.speedT ?? 0) * 0.5) + 0.15, 0.08, 0.95);
            fire(from.clone(), t.pos, t.vel, acc);
            man.reload = 2.4 + Math.random() * 1.8;
            man.draw = 0;
          }
        } else {
          man.draw = Math.max(0, man.draw - dt * 2);
          if (man.reload < 0.6) man.reload = 0.6 + Math.random();
        }
      }
    }

    // --- arrows -----------------------------------------------------------------
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.life -= dt;
      if (a.stuck > 0) {
        a.stuck -= dt;
        if (a.stuck <= 0 || a.life <= 0) arrows.splice(i, 1);
        continue;
      }
      a.prev.copy(a.pos);
      a.vel.y -= 9.8 * dt;
      a.pos.addScaledVector(a.vel, dt);
      // Hit him? Segment against a sphere round his body.
      if (t && !t.hidden) {
        const seg = _v.copy(a.pos).sub(a.prev);
        const len = seg.length();
        const toC = _w.copy(t.pos).sub(a.prev);
        const k = len > 1e-4 ? THREE.MathUtils.clamp(toC.dot(seg) / (len * len), 0, 1) : 0;
        const closest = seg.multiplyScalar(k).add(a.prev);
        if (closest.distanceTo(t.pos) < 3.6) {
          arrows.splice(i, 1);
          onArrowHit(a);
          continue;
        }
      }
      const g = getHeightAt ? getHeightAt(a.pos.x, a.pos.z) : -1e9;
      if (a.pos.y <= Math.max(g, 0) || a.life <= 0) {
        if (a.pos.y <= 0.2 && g < 0) { arrows.splice(i, 1); continue; }   // into the sea
        a.pos.y = Math.max(g, a.pos.y);
        a.stuck = 6;
      }
    }

    draw();
    return seenNow;
  }

  // --- drawing -----------------------------------------------------------------
  const _hand = new THREE.Matrix4(), _tip = new THREE.Vector3(), _pos = new THREE.Vector3();
  function draw() {
    const counts = {};
    let nt = 0;
    carried.length = 0;
    for (const man of men) {
      const kit = man.kit;
      const parts = kits[kit];
      if (!parts || man.inside) continue;
      // The whole man: stand him at his position, turned to his yaw, sat
      // down, bent over his work, or knocked flat if he has been.
      const ground = man.groundSeat !== false;
      _pos.copy(man.pos);
      _pos.y -= man.sit * (ground ? 0.78 : 0.42);
      _q.setFromEuler(_e.set(-man.koT * Math.PI / 2 + man.lean, man.yaw, 0, "YXZ"));
      _m.compose(_pos, _q, _s);
      const swing = Math.sin(man.walk) * (1 - man.sit);
      const tt = time + man.phase;
      for (const pname of PARTS) {
        const p = parts[pname];
        if (!p) continue;
        const mesh = meshFor(kit, pname);
        if (!mesh) continue;
        let rx = 0, rz = 0;
        const sitLeg = (ground ? -1.45 : -1.1) * man.sit;
        if (pname === "leg_l") rx = swing * 0.55 + sitLeg + (ground ? 0 : 0);
        else if (pname === "leg_r") rx = -swing * 0.55 + sitLeg;
        else if (pname === "arm_l") {
          rx = -swing * 0.35;
          if (man.kind === "archer" && (man.state === "alert" || man.draw > 0)) {
            rx = -1.35; rz = 0.15;            // bow arm out in front
          } else if (man.torch) { rx = -1.05; rz = 0.1; }    // torch held up
          else if (man.state === "alert") rx = -0.9;
          else if (man.act === "haul" || man.act === "stoop") rx = -1.0;
          else if (man.act === "eat") rx = -0.55;
          else if (man.act === "work") rx = -0.5;
        } else if (pname === "arm_r") {
          rx = swing * 0.35;
          if (man.kind === "archer" && man.draw > 0) { rx = -1.2 - man.draw * 0.25; rz = -0.6 * man.draw; }
          else if (man.state === "alert" && man.kind === "spear") rx = -1.9;   // arm up to throw
          else if (man.act === "work") rx = -1.45 + Math.sin(tt * 7.5) * 0.75;        // hammering
          else if (man.act === "tend") rx = -0.8 + Math.sin(tt * 1.6) * 0.35;
          else if (man.act === "eat") rx = -0.7 - Math.max(0, Math.sin(tt * 1.1)) * 1.0;  // to his mouth
          else if (man.act === "chat") rx = -0.35 + Math.sin(tt * 2.3) * 0.35 * Math.max(0, Math.sin(tt * 0.4));
          else if (man.act === "haul" || man.act === "stoop") rx = -1.0;
        }
        _r.makeRotationFromEuler(_e.set(rx, 0, rz));
        _p.makeTranslation(p.pivot.x, p.pivot.y, p.pivot.z).multiply(_r);
        const i = counts[`${kit}/${pname}`] ?? 0;
        counts[`${kit}/${pname}`] = i + 1;
        if (i < mesh.instanceMatrix.count) mesh.setMatrixAt(i, _r.multiplyMatrices(_m, _p));
        // The torch: from his left hand, straight up.
        if (pname === "arm_l" && man.torch && nt < TORCHES) {
          _hand.multiplyMatrices(_m, _p);
          _tip.set(0, -0.6, 0.07).applyMatrix4(_hand);
          _q.identity();
          stickMesh.setMatrixAt(nt, _r.compose(_tip, _q, _s));
          flamePos[nt * 3] = _tip.x; flamePos[nt * 3 + 1] = _tip.y + 0.85; flamePos[nt * 3 + 2] = _tip.z;
          const L = { pos: new THREE.Vector3(_tip.x, _tip.y + 0.85, _tip.z), lit: true, r: 14 };
          carried.push(L);
          nt++;
        }
      }
    }
    for (const [key, mesh] of Object.entries(meshes)) {
      mesh.count = Math.min(counts[key] ?? 0, mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
    }
    stickMesh.count = nt;
    stickMesh.instanceMatrix.needsUpdate = true;
    flameGeo.setDrawRange(0, nt);
    flameGeo.attributes.position.needsUpdate = true;

    // Arrows and their streaks.
    let n = 0;
    for (const a of arrows) {
      _w.copy(a.vel).normalize();
      _q.setFromUnitVectors(_v.set(0, 0, 1), _w);
      _m.compose(a.pos, _q, _s);
      arrowMesh.setMatrixAt(n, _m);
      const o = n * 6;
      // A stuck arrow has no streak: both ends of its segment at the tip.
      const k = a.stuck > 0 ? 0 : 0.05;
      trailPos[o] = a.pos.x; trailPos[o + 1] = a.pos.y; trailPos[o + 2] = a.pos.z;
      trailPos[o + 3] = a.pos.x - a.vel.x * k;
      trailPos[o + 4] = a.pos.y - a.vel.y * k;
      trailPos[o + 5] = a.pos.z - a.vel.z * k;
      n++;
    }
    arrowMesh.count = n;
    arrowMesh.instanceMatrix.needsUpdate = true;
    trailGeo.setDrawRange(0, n * 2);
    trailGeo.attributes.position.needsUpdate = true;
  }

  return {
    group, men,
    add,
    update,
    fire,
    /** Torches in the hands of the night watch: [{pos, lit, r}]. */
    get carried() { return carried; },
    get alarm() { return alarm; },
    get arrowsInFlight() { return arrows.filter((a) => !a.stuck).length; },
    /** The man nearest a point, within range, who is still standing. */
    nearest(p, range = 12) {
      let best = null, bd = range;
      for (const m of men) {
        if (m.ko > 0 || m.inside) continue;
        const d = m.pos.distanceTo(p);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    },
    /** Tail-strike: put a man down for a while. */
    knockOut(man, seconds = 45) { man.ko = seconds; man.awareness = 0; man.state = "calm"; },
    raiseAlarm(at) { alarm = ALARM_TIME; if (at) lastSeenAt.copy(at); for (const m of men) if (!m.inside) m.awareness = Math.max(m.awareness, 0.6); },
    /** The hour he last read, and what a man is doing — for the console. */
    get hour() { return hour; },
    lightAt: (p, night) => lightAt(p, night),
    calm() { alarm = 0; for (const m of men) m.awareness = 0; arrows.length = 0; },
    clearArrows() { arrows.length = 0; },
    setVisible(v) { group.visible = v; },
  };
}
