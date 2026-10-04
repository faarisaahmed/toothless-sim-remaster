import * as THREE from "three";
import { prop } from "./props.js";
import { mergeStatic, makeLightPool } from "./places.js";
import { makeOrb } from "./placeholder.js";
import { loadKit, createActor } from "./dragonkit.js";
import { pitLayout } from "./terrain.js";
import { createHunters } from "./hunters.js";

// ---------------------------------------------------------------------------
// Dragon Hunter Island — the base.
//
// The island is a pit now (terrain.js): a round floor, a road spiralling up the
// wall in terraces, a rim, a channel to the sea. This dresses it, in sections
// that each do a job in the story and in the stealth:
//
//   THE PIT FLOOR   Bellows' smelter in the middle — the thing the whole
//                   operation exists to feed — and a ring of cages round it.
//                   Braziers, cranes, the clutter of a working yard, the
//                   barracks tents on the channel side. The brightest, busiest
//                   and most watched place on the island: the target.
//   THE SPIRAL      The road up the wall, torch every thirty metres, so from
//                   the air at night it is a coil of fire round a black hole
//                   — the shot from the films. Patrols walk it; small cages
//                   wait on it to be carried down. The torches are what make
//                   the walls dangerous to fly along.
//   THE RIM         Six watchtowers with archers and alarm horns, ballistae,
//                   palisade between them. Coming over the top means coming
//                   past these.
//   THE CHANNEL     The dock and the supply ships, the only way in at sea
//                   level, and the one place everyone is looking.
//   THE CAMP        Where the crews live: barracks halls, huts, tents,
//                   workshops, cook fires and mess tables across the floor,
//                   and huts and lean-to watch posts strung along every
//                   terrace. hunters.js runs their day round it — work,
//                   meals, the fire, bed — so the island is a place with a
//                   routine to read and slip through, not a ring of sentries.
//
// The returned object keeps the shape the story already reads (braziers,
// cages, guards, litFraction), so the chapters drive it unchanged.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// What is in the cages. A glowing orb until the stand-in models load (see
// tools/dragons/); then a dragon of a real species, folded up
// and shifting about, which beats its way up and out when the cage breaks.
// ---------------------------------------------------------------------------
const SPECIES = ["nadder", "gronckle", "nightmare", "thunderdrum", "zippleback"];
/** Adult nose-to-tail, metres. The big cages hold adults; a cage's `fit` is
 *  the fraction of that it holds (the terrace cages hold young ones). The
 *  tail lies along the diagonal and curls past the bars, the way they are
 *  packed in on the ships. */
const LENGTH = { nadder: 14, gronckle: 10.5, nightmare: 16, thunderdrum: 13, zippleback: 16 };

async function fillCages(list, group) {
  const kits = (await Promise.all(SPECIES.map(loadKit))).filter(Boolean);
  if (!kits.length) return;
  list.forEach((cage, i) => {
    // The hatchling is a Nadder chick, always; the rest go round the species.
    const kit = cage.hatch ? (kits.find((k) => k.name === "nadder") || kits[0]) : kits[i % kits.length];
    const actor = createActor(kit, { length: (LENGTH[kit.name] ?? 12) * cage.fit });
    actor.root.rotation.order = "YXZ";
    // Corner to corner: the longest thing that fits in a square box.
    actor.root.position.set(cage.pos.x, cage.gy + 0.25, cage.pos.z);
    actor.root.rotation.y = cage.yaw + Math.PI / 4 + (i % 2 ? Math.PI : 0);
    actor.update(Math.random() * 3);
    group.add(actor.root);
    cage.actor = actor;
    cage.orb.group.visible = false;
  });
}

function updateCage(cage, dt, camera) {
  const a = cage.actor;
  // Far off, nobody can tell a dragon shifting about at six frames a second
  // from one at sixty — and nineteen skinned rigs are not free.
  if (a && !cage.open) {
    cage.acc = (cage.acc ?? 0) + dt;
    const far = camera.position.distanceToSquared(cage.pos) > 220 * 220;
    if (far && cage.acc < 0.16) return;
    dt = cage.acc;
    cage.acc = 0;
  }
  if (!a) {
    cage.orb.update(dt, camera);
    if (cage.open && cage.orb.group.visible) {
      cage.orb.group.position.y += dt * 40;
      cage.orb.group.scale.multiplyScalar(1 - dt * 0.3);
      if (cage.orb.group.position.y > cage.gy + 500) cage.orb.group.visible = false;
    }
    return;
  }
  if (!a.root.visible) return;
  if (cage.open) {
    if (a.mode !== "fly") { a.setMode("fly"); cage.flyT = 0; }
    cage.flyT += dt;
    // Up out of the pit, then away, gathering speed.
    const r = a.root;
    r.position.y += dt * Math.min(30, 6 + cage.flyT * 10);
    r.rotation.x = -0.35;
    r.translateZ(dt * Math.min(40, cage.flyT * 8));
    if (r.position.y > cage.gy + 500) r.visible = false;
  }
  a.update(dt);
}

export async function buildHunterBase(scene, { groundAt, seaLevel = 0 } = {}) {
  const L = pitLayout();
  const group = new THREE.Group();
  group.name = "dragon-hunter-base";
  scene.add(group);

  const names = ["rig_cage_large", "rig_cage_small", "rig_brazier", "rig_crane", "rig_crate",
    "rig_barrel", "rig_chain_coil", "rig_net_pile", "dh_watchtower", "dh_ballista", "dh_torch",
    "dh_forge", "dh_palisade", "dh_tent", "boat_supply", "berk_dock", "rig_mooring_post",
    "dh_hut", "dh_longhouse", "dh_leanto", "dh_shed", "dh_campfire", "dh_table"];
  const P = Object.fromEntries(
    await Promise.all(names.map(async (n) => [n, await prop(n)])));
  // Some props were built for people; a dragon is eight and a half metres
  // long. A cage that holds one has to be built for one, and the smelter at
  // the heart of an industry is the size of a hall, not a kiln.
  const SCALE = { rig_cage_large: 3.1, rig_cage_small: 2.1, dh_forge: 2.0, rig_brazier: 1.8,
                  dh_torch: 1.4, dh_tent: 1.4, rig_crane: 1.4 };
  const clone = (n) => {
    const o = P[n].clone(true);
    if (SCALE[n]) o.scale.setScalar(SCALE[n]);
    return o;
  };

  const statics = [];
  const cx = L.x, cz = L.z;
  const floorY = groundAt(cx, cz);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const onGround = (x, z, lift = 0) => V(x, groundAt(x, z) + lift, z);
  const polar = (a, r) => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  const place = (obj, x, z, yaw = 0, lift = 0, stat = true) => {
    obj.position.copy(onGround(x, z, lift));
    obj.rotation.y = yaw;
    (stat ? statics : group.children).push(obj);
    if (!stat) group.add(obj);
    return obj;
  };
  const roughness = (x, z, r = 3) =>
    Math.abs(groundAt(x + r, z) - groundAt(x - r, z)) + Math.abs(groundAt(x, z + r) - groundAt(x, z - r));

  // --- the channel: lowest bearing through the rim ----------------------------
  let gateA = 0, low = Infinity;
  for (let a = 0; a < TAU; a += 0.03) {
    const [x, z] = polar(a, L.rimR);
    const h = groundAt(x, z);
    if (h < low) { low = h; gateA = a; }
  }
  // Where the water starts, walking out from the floor along the channel.
  let waterR = L.topR;
  for (let r = L.floorR; r < L.rimR + 300; r += 4) {
    const [x, z] = polar(gateA, r);
    if (groundAt(x, z) < seaLevel + 0.5) { waterR = r; break; }
  }

  // --- the smelter -------------------------------------------------------------
  const forge = clone("dh_forge");
  // Mouth toward the channel, so the glow is what you see coming in by sea.
  place(forge, cx, cz, -gateA + Math.PI / 2, -0.4, false);
  const mouth = forge.getObjectByName("mouth");
  if (mouth) mouth.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });

  // --- cages round the pit floor ----------------------------------------------
  const cages = [];
  const CAGE_N = 12;
  for (let i = 0; i < CAGE_N; i++) {
    const a = gateA + (i + 0.5) * TAU / CAGE_N;
    if (Math.abs(Math.atan2(Math.sin(a - gateA), Math.cos(a - gateA))) < 0.35) continue;
    const r = L.floorR * 0.55 + (i % 2) * 16;
    const [x, z] = polar(a, r);
    const c = clone("rig_cage_large");
    place(c, x, z, -a - Math.PI / 2, 0.05, false);
    const orb = makeOrb({ color: 0x7fd0ff, radius: 1.2, intensity: 2.4, name: "caged", castLight: false });
    const gy = groundAt(x, z);
    orb.setPosition(x, gy + 5.0, z);
    orb.state.bob = 0.12; orb.state.pulse = 0.22; orb.state.pulseRate = 0.9;
    orb.group.scale.setScalar(2.0);
    group.add(orb.group);
    cages.push({
      obj: c, orb, open: false, pos: V(x, gy + 5.0, z), yaw: -a - Math.PI / 2, gy, fit: 1,
      release() { if (this.open) return false; this.open = true; return true; },
      update(dt, camera) { updateCage(this, dt, camera); },
    });
  }
  // Smaller cages waiting on the second terrace — the last ones, in the
  // finale. One of them, high on the far side, holds a hatchling: it is the
  // cage behind him when the alarm goes and the way out is open.
  const terraceCages = [];
  const makeCage = (x, z, yaw, kind, colour, list) => {
    const c = clone(kind);
    place(c, x, z, yaw, 0.05, false);
    const gy = groundAt(x, z);
    const orb = makeOrb({ color: colour, radius: 1.0, intensity: 2.2, name: "caged", castLight: false });
    orb.setPosition(x, gy + 2.2, z);
    orb.state.bob = 0.14; orb.state.pulse = 0.3; orb.state.pulseRate = 1.2;
    group.add(orb.group);
    const cage = {
      obj: c, orb, open: false, pos: V(x, gy + 2.2, z), yaw, gy, fit: 0.36,
      release() { if (this.open) return false; this.open = true; return true; },
      update(dt, camera) { updateCage(this, dt, camera); },
    };
    list.push(cage);
    return cage;
  };
  for (let i = 0; i < 8; i++) {
    const a = gateA + 0.9 + i * 0.62;
    const p = L.roadAt(1, Math.atan2(Math.sin(a), Math.cos(a)));
    if (roughness(p.x, p.z) > 2 || groundAt(p.x, p.z) < 8) continue;
    makeCage(p.x, p.z, -a, "rig_cage_small", 0x9fd8ff, terraceCages);
  }
  let hatchCage = null;
  {
    const a = gateA + Math.PI;
    const p = L.roadAt(2, Math.atan2(Math.sin(a), Math.cos(a)));
    hatchCage = makeCage(p.x, p.z, -a, "rig_cage_small", 0xffb0d8, []);
    hatchCage.orb.state.pulseRate = 3.0;     // it is frightened
    hatchCage.orb.group.scale.setScalar(0.7);
    hatchCage.fit = 0.2;
    hatchCage.hatch = true;
  }
  fillCages([...cages, ...terraceCages, hatchCage].filter(Boolean), group);
  // The cage they put HIM in: the biggest, next to the smelter.
  const [pxw, pzw] = polar(gateA + Math.PI * 0.5, L.floorR * 0.2);
  const prisonAt = V(pxw, groundAt(pxw, pzw), pzw);
  const prison = clone("rig_cage_large");
  prison.scale.setScalar(3.0);
  prison.position.copy(prisonAt);
  prison.rotation.y = -gateA;
  group.add(prison);

  // --- braziers: the lights the story is about ----------------------------------
  const braziers = [];
  const addBrazier = (x, z) => {
    const b = clone("rig_brazier");
    const gy = groundAt(x, z);
    b.position.set(x, gy + 0.05, z);
    group.add(b);
    const coals = b.getObjectByName("coals");
    if (coals) coals.material = coals.material.clone();
    braziers.push({
      obj: b, coals, lit: true, intensity: 190,
      local: V(x, gy + 3.2, z), pos: V(x, gy + 3.2, z),
      snuff() {
        if (!this.lit) return false;
        this.lit = false; this.intensity = 0;
        if (this.coals) this.coals.material.emissiveIntensity = 0.05;
        return true;
      },
      relight() {
        this.lit = true; this.intensity = 190;
        if (this.coals) this.coals.material.emissiveIntensity = 2.2;
      },
    });
  };
  for (let i = 0; i < 8; i++) addBrazier(...polar(gateA + (i + 0.25) * TAU / 8, L.floorR * 0.32));
  for (let i = 0; i < 8; i++) addBrazier(...polar(gateA + (i + 0.75) * TAU / 8, L.floorR * 0.84));

  // --- the camp ------------------------------------------------------------------
  // Where the crews live and work. The floor was a yard with a ring of cages
  // and nowhere to go indoors; a camp this size has a barracks hall, huts,
  // workshops, fires with something cooking, and lean-tos up on the terraces
  // for the watch. Every structure takes a circle of ground, so nothing is
  // built through anything else, and every one has a torch at its door —
  // they work into the night here.
  const taken = [];                                      // {x, z, r}
  const take = (x, z, r) => taken.push({ x, z, r });
  const free = (x, z, r) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
  const flatFor = (x, z, r) => {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 9; k++) {
      const a = k * TAU / 8;
      const h = k === 8 ? groundAt(x, z) : groundAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo;
  };
  /** The nearest free, flat-enough spot to (x, z), searching outward. */
  const site = (x, z, r, { flat = 1.6, reach = 30, minY = seaLevel + 4 } = {}) => {
    for (let d = 0; d <= reach; d += 3) {
      const n = d === 0 ? 1 : Math.max(6, Math.round(d * 0.8));
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n + d * 0.37;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (groundAt(px, pz) < minY || !free(px, pz, r) || flatFor(px, pz, r) > flat) continue;
        return { x: px, z: pz };
      }
    }
    return null;
  };
  take(cx, cz, 19);                                      // the smelter
  for (const c of cages) take(c.pos.x, c.pos.z, 9);
  for (const c of terraceCages) take(c.pos.x, c.pos.z, 3.5);
  if (hatchCage) take(hatchCage.pos.x, hatchCage.pos.z, 3.5);
  take(prisonAt.x, prisonAt.z, 9);
  for (const b of braziers) take(b.pos.x, b.pos.z, 2.5);

  const torches = [];
  const addTorch = (x, z) => {
    const gy = groundAt(x, z);
    place(clone("dh_torch"), x, z, 0, 0);
    torches.push({ pos: V(x, gy + 4.8, z), lit: true, r: 15 });
    take(x, z, 0.8);
  };
  const fires = [];                                      // campfires: {pos, seats, lit, r}
  const addFire = (x, z, zone) => {
    const gy = groundAt(x, z);
    const f = clone("dh_campfire");
    place(f, x, z, Math.random() * TAU, 0, false);
    const flame = f.getObjectByName("flame");
    const seats = [];
    for (let k = 0; k < 7; k++) {
      const a = k * TAU / 7 + 0.2;
      const sx = x + Math.cos(a) * 2.6, sz = z + Math.sin(a) * 2.6;
      seats.push({ pos: V(sx, groundAt(sx, sz), sz), yaw: Math.atan2(x - sx, z - sz), ground: true, by: null });
    }
    const fire = { pos: V(x, gy + 1.0, z), lit: true, r: 20, seats, zone, flame };
    fires.push(fire);
    take(x, z, 3.6);
    return fire;
  };
  // A building: placed, its ground taken, a torch beside its door, and its
  // door and inside remembered for the men who sleep there.
  const homes = [], works = [], tables = [], leantos = [];
  const door = (x, z, yaw, out) => V(x + Math.sin(yaw) * out, 0, z + Math.cos(yaw) * out);
  const build = (kind, x, z, yaw, r, { doorOut = 0, beds = 0, zone = null, torch = true } = {}) => {
    place(clone(kind), x, z, yaw, -0.25);
    take(x, z, r);
    const d = door(x, z, yaw, doorOut);
    d.y = groundAt(d.x, d.z);
    if (torch) {
      const side = V(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(1.9);
      const tx = d.x + side.x + Math.sin(yaw) * 0.8, tz = d.z + side.z + Math.cos(yaw) * 0.8;
      addTorch(tx, tz);
    }
    if (beds) homes.push({ door: d, yaw, beds, zone });
    return d;
  };
  const facing = (fromX, fromZ, toX, toZ) => Math.atan2(toX - fromX, toZ - fromZ);

  // The floor: barracks halls on the channel side, long side to the pit.
  const floorZone = { kind: "floor" };
  for (const da of [-0.42, 0.42, 1.95, -2.2]) {
    const s0 = site(...polar(gateA + da, L.floorR * 0.8), 9);
    if (!s0) continue;
    const a = Math.atan2(s0.z - cz, s0.x - cx);
    // Door ends face along the tangent; +Z of the model is a gable door.
    build("dh_longhouse", s0.x, s0.z, -a, 9, { doorOut: 8.3, beds: 12, zone: floorZone });
  }
  // Huts for the crew bosses round the far side.
  for (const [da, rr] of [[-0.95, 0.88], [-0.45, 0.9], [0.05, 0.88], [0.55, 0.9], [1.05, 0.88],
                          [-0.7, 0.66], [-0.2, 0.68], [0.3, 0.66], [0.8, 0.68], [2.3, 0.88], [-2.6, 0.9],
                          [2.6, 0.66], [-2.0, 0.66]]) {
    const s0 = site(...polar(gateA + Math.PI + da, L.floorR * rr), 3.6, { reach: 14 });
    if (!s0) continue;
    build("dh_hut", s0.x, s0.z, facing(s0.x, s0.z, cx, cz), 3.6, { doorOut: 3.2, beds: 4, zone: floorZone });
  }
  // Workshops, by the cranes.
  for (const [da, rr] of [[1.2, 0.62], [-1.6, 0.6], [2.5, 0.42], [-0.9, 0.42]]) {
    const s0 = site(...polar(gateA + da, L.floorR * rr), 5.5);
    if (!s0) continue;
    const yaw = facing(s0.x, s0.z, cx, cz) + Math.PI / 2;
    build("dh_shed", s0.x, s0.z, yaw, 5.5, { torch: true });
    // The bench runs along the shed's -X side; men stand at it facing it.
    const ax = Math.cos(yaw), az = -Math.sin(yaw);       // the shed's +X in the world
    for (const off of [-1.8, 0, 1.8]) {
      const px = s0.x - ax * 1.1 + Math.sin(yaw) * off, pz = s0.z - az * 1.1 + Math.cos(yaw) * off;
      works.push({ pos: V(px, groundAt(px, pz), pz), yaw: Math.atan2(-ax, -az), zone: floorZone, act: "work" });
    }
    const anx = s0.x + ax * 0.6 + Math.sin(yaw) * 0.6, anz = s0.z + az * 0.6 + Math.cos(yaw) * 0.6;
    works.push({ pos: V(anx, groundAt(anx, anz), anz), yaw: yaw + Math.PI, zone: floorZone, act: "work" });
  }
  for (const [a, r, yaw] of [[gateA + 1.2, L.floorR * 0.78, 0.6], [gateA - 1.6, L.floorR * 0.74, -1.1],
                             [gateA + Math.PI, L.floorR * 0.8, 2.2]]) {
    const s0 = site(...polar(a, r), 4.5, { flat: 3 });
    if (!s0) continue;
    place(clone("rig_crane"), s0.x, s0.z, yaw, 0);
    take(s0.x, s0.z, 4.5);
  }
  // The mess: a fire and tables between the halls; more fires by the huts
  // and the workshops.
  {
    const s0 = site(...polar(gateA, L.floorR * 0.62), 3.6);
    if (s0) {
      addFire(s0.x, s0.z, floorZone);
      for (const side of [-1, 1]) {
        const a = Math.atan2(s0.z - cz, s0.x - cx) + side * 0.14;
        const t0 = site(cx + Math.cos(a) * Math.hypot(s0.x - cx, s0.z - cz), cz + Math.sin(a) * Math.hypot(s0.x - cx, s0.z - cz), 2.6);
        if (!t0) continue;
        const yaw = -a;
        place(clone("dh_table"), t0.x, t0.z, yaw, 0);
        take(t0.x, t0.z, 2.6);
        const seats = [];
        const ax = Math.cos(yaw), az = -Math.sin(yaw);
        for (const sd of [-1, 1]) {
          for (const along of [-1.3, 0, 1.3]) {
            const px = t0.x + ax * 0.85 * sd + Math.sin(yaw) * along, pz = t0.z + az * 0.85 * sd + Math.cos(yaw) * along;
            seats.push({ pos: V(px, groundAt(px, pz) + 0.0, pz), yaw: Math.atan2(-ax * sd, -az * sd), ground: false, by: null });
          }
        }
        tables.push({ seats, zone: floorZone });
      }
    }
  }
  for (const [da, rr] of [[Math.PI, 0.72], [1.2, 0.45], [-1.6, 0.45], [Math.PI * 0.5, 0.42]]) {
    const s0 = site(...polar(gateA + da, L.floorR * rr), 3.6);
    if (s0) addFire(s0.x, s0.z, floorZone);
  }
  // Tending the cages: a man at each door, and at the smelter's mouth.
  for (const c of cages) {
    const a = Math.atan2(c.pos.z - cz, c.pos.x - cx);
    const px = c.pos.x - Math.cos(a) * 9, pz = c.pos.z - Math.sin(a) * 9;
    works.push({ pos: V(px, groundAt(px, pz), pz), yaw: facing(px, pz, c.pos.x, c.pos.z), zone: floorZone, act: "tend" });
  }
  {
    // In front of the smelter's mouth (the forge faces the channel).
    const ax = Math.cos(gateA), az = Math.sin(gateA);
    for (const off of [-3, 0, 3]) {
      const px = cx + ax * 20 - az * off, pz = cz + az * 20 + ax * off;
      works.push({ pos: V(px, groundAt(px, pz), pz), yaw: facing(px, pz, cx, cz), zone: floorZone, act: "work" });
    }
  }

  // The terraces: a lean-to watch post with a fire on every turn, a hut or
  // two, and the small cages' keepers.
  const terraceZones = [];
  for (let k = 0; k < L.turns; k++) {
    const zone = { kind: "road", k };
    terraceZones.push(zone);
    for (let j = 0; j < 5; j++) {
      const a0 = gateA + 0.5 + j * TAU / 5 + k * 0.9;
      const a = Math.atan2(Math.sin(a0), Math.cos(a0));
      const p = L.roadAt(k, a);
      if (groundAt(p.x, p.z) < seaLevel + 6) continue;
      const s0 = site(p.x, p.z, 2.6, { reach: 12, flat: 1.8 });
      if (!s0) continue;
      // Open side to the pit: looking out over it is the job.
      const yaw = facing(s0.x, s0.z, cx, cz);
      build("dh_leanto", s0.x, s0.z, yaw, 2.7, { torch: false, zone });
      const at = (lz) => { const x = s0.x + Math.sin(yaw) * lz, z = s0.z + Math.cos(yaw) * lz; return V(x, groundAt(x, z), z); };
      leantos.push({ post: at(2.4), seat: { pos: at(-0.95), yaw }, yaw, zone });
      const fa = a + 14 / p.r;
      const fp = L.roadAt(k, Math.atan2(Math.sin(fa), Math.cos(fa)));
      const f0 = site(fp.x, fp.z, 3.6, { reach: 10, flat: 1.8 });
      if (f0) addFire(f0.x, f0.z, zone);
      if (j < 4) {
        const ha = a - 18 / p.r;
        const hp = L.roadAt(k, Math.atan2(Math.sin(ha), Math.cos(ha)));
        const h0 = site(hp.x, hp.z, 3.6, { reach: 12, flat: 1.8 });
        if (h0) build("dh_hut", h0.x, h0.z, facing(h0.x, h0.z, cx, cz), 3.6, { doorOut: 3.2, beds: 3, zone });
      }
    }
  }
  for (const c of terraceCages) {
    works.push({ pos: V(c.pos.x, groundAt(c.pos.x, c.pos.z), c.pos.z).add(V(cx - c.pos.x, 0, cz - c.pos.z).normalize().multiplyScalar(3.5)),
      yaw: 0, zone: terraceZones[1] ?? null, act: "tend", look: c.pos });
  }

  // And then the rest of the settlement, filling in: a camp that has grown
  // for years round the work, not a few buildings on a parade ground. Huts,
  // tents, sheds and lean-tos in clusters across the floor, and strung along
  // every terrace on the pit side of the road. An avenue stays open from the
  // channel to the smelter (the way the cages come in), and a lane round
  // the cage ring. Only some have anyone living in them; the rest are stores.
  {
    let fs = 31;
    const fr = () => ((fs = (fs * 48271) % 2147483647) / 2147483647);
    const avenue = (x, z, w) => {
      const ux = Math.cos(gateA), uz = Math.sin(gateA);
      const along = (x - cx) * ux + (z - cz) * uz;
      return along > 0 && Math.abs(-(x - cx) * uz + (z - cz) * ux) < w;
    };
    const KINDS = [["dh_hut", 3.6, 0.42], ["dh_tent", 3.0, 0.3], ["dh_leanto", 2.7, 0.14], ["dh_shed", 5.5, 0.14]];
    const pickKind = () => { let r = fr(); for (const k of KINDS) { if ((r -= k[2]) <= 0) return k; } return KINDS[0]; };
    const putOne = (x, z, zone, yawTo) => {
      const [kind, rad] = pickKind();
      if (avenue(x, z, 14) || !free(x, z, rad + 2.5) || flatFor(x, z, rad) > 1.6 || groundAt(x, z) < seaLevel + 4) return false;
      const yaw = yawTo(x, z) + (fr() - 0.5) * 0.5;
      const lived = kind === "dh_hut" && fr() < 0.5;
      build(kind, x, z, yaw, rad, { doorOut: kind === "dh_hut" ? 3.2 : 0, beds: lived ? 2 : 0, zone,
                                     torch: kind !== "dh_tent" && fr() < 0.6 });
      return true;
    };
    // The floor: rings of candidates, each one the seed of a little cluster.
    for (let r = 30; r < L.floorR - 8; r += 13) {
      const n = Math.floor(TAU * r / 17);
      for (let i = 0; i < n; i++) {
        const a = gateA + (i + fr() * 0.6) * TAU / n;
        const [x, z] = polar(a, r + (fr() - 0.5) * 6);
        if (fr() < 0.35) continue;
        putOne(x, z, floorZone, (px, pz) => facing(px, pz, cx, cz));
      }
    }
    // The terraces: along the road, on the pit side of it.
    for (let k = 0; k < L.turns; k++) {
      for (let a = -Math.PI; a < Math.PI; ) {
        const p = L.roadAt(k, a);
        a += (11 + fr() * 10) / p.r;
        if (fr() < 0.3) continue;
        const inward = 4 + fr() * 12;
        const x = p.x - Math.cos(a) * inward, z = p.z - Math.sin(a) * inward;
        putOne(x, z, terraceZones[k], (px, pz) => facing(px, pz, cx, cz));
      }
    }
  }

  // Clutter, round everything else.
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const piles = [];
  for (let i = 0; i < 140; i++) {
    const a = rnd() * TAU, r = 24 + rnd() * (L.floorR - 30);
    const [x, z] = polar(a, r);
    if (!free(x, z, 1.4) || roughness(x, z) > 1.5) continue;
    const kind = i % 7 === 0 ? "rig_net_pile" : i % 5 === 0 ? "rig_chain_coil" : i % 3 ? "rig_crate" : "rig_barrel";
    place(clone(kind), x, z, rnd() * TAU, 0.02);
    take(x, z, 1.4);
    if (kind === "rig_crate" && piles.length < 14) piles.push(V(x, groundAt(x, z), z));
  }
  // A few tents for the overflow, out by the halls.
  for (let i = 0; i < 6; i++) {
    const s0 = site(...polar(gateA + (i - 2.5) * 0.2, L.floorR * 0.93), 3, { reach: 12 });
    if (!s0) continue;
    const a = Math.atan2(s0.z - cz, s0.x - cx);
    place(clone("dh_tent"), s0.x, s0.z, -a, 0);
    take(s0.x, s0.z, 3);
  }

  // --- torches -------------------------------------------------------------------------
  // The spiral road gets one every eighteen metres, on the outer edge against
  // the wall: the coil of fire round a black hole.
  for (let k = 0; k < L.turns; k++) {
    for (let a = -Math.PI; a < Math.PI; ) {
      const p = L.roadAt(k, a);
      a += 18 / p.r;
      const gy = groundAt(p.x, p.z);
      if (gy < seaLevel + 4 || roughness(p.x, p.z) > 2.2) continue;
      const ox = p.x + Math.cos(a) * 8, oz = p.z + Math.sin(a) * 8;
      if (Math.abs(groundAt(ox, oz) - gy) > 3 || !free(ox, oz, 0.8)) continue;
      addTorch(ox, oz);
    }
  }
  // Round the floor's edge, and a ring between the cages and the smelter.
  for (let i = 0; i < 28; i++) {
    const [x, z] = polar(gateA + i * TAU / 28, L.floorR - 8);
    if (roughness(x, z) > 2 || !free(x, z, 0.8)) continue;
    addTorch(x, z);
  }
  for (let i = 0; i < 12; i++) {
    const [x, z] = polar(gateA + (i + 0.5) * TAU / 12, L.floorR * 0.47);
    if (!free(x, z, 0.8)) continue;
    addTorch(x, z);
  }

  // --- the rim: towers, ballistae, palisade ----------------------------------------------
  const towers = [];
  for (let i = 0; i < 6; i++) {
    const a0 = gateA + (i + 0.5) * TAU / 6;
    // Search a little band for somewhere flat enough to stand a tower.
    let best = null;
    for (let da = -0.25; da <= 0.25; da += 0.05) {
      for (let r = L.topR + 25; r < L.rimR + 90; r += 10) {
        const [x, z] = polar(a0 + da, r);
        const rough = roughness(x, z, 3);
        const h = groundAt(x, z);
        if (h < 60) continue;
        const score = rough * 4 - h * 0.02 + Math.abs(da) * 10;
        if (!best || score < best.score) best = { x, z, a: a0 + da, score };
      }
    }
    if (!best) continue;
    const t = clone("dh_watchtower");
    place(t, best.x, best.z, -best.a + Math.PI / 2, -0.3);
    towers.push({ pos: onGround(best.x, best.z), a: best.a });
  }
  const ballistae = [];
  for (let i = 0; i < 3; i++) {
    const a = gateA + 0.6 + i * TAU / 3;
    const p = L.roadAt(Math.min(2, L.turns - 1), Math.atan2(Math.sin(a), Math.cos(a)));
    if (roughness(p.x, p.z) > 2.5) continue;
    const b = clone("dh_ballista");
    // Facing out of the pit and up: they are there for anything coming over the rim.
    place(b, p.x, p.z, -a + Math.PI / 2, 0);
    ballistae.push({ pos: onGround(p.x, p.z), a });
  }
  for (const t of towers) {
    for (const side of [-1, 1]) {
      const a = t.a + side * 0.09;
      const r = Math.hypot(t.pos.x - cx, t.pos.z - cz);
      const [x, z] = polar(a, r);
      if (groundAt(x, z) < 50) continue;
      place(clone("dh_palisade"), x, z, -a, -0.2);
    }
  }

  // --- the channel: dock and ships ----------------------------------------------------------
  {
    const [dx, dz] = polar(gateA, waterR - 4);
    const dock = clone("berk_dock");
    dock.position.set(dx, Math.max(groundAt(dx, dz), seaLevel) + 0.2, dz);
    dock.rotation.y = -gateA + Math.PI / 2;
    statics.push(dock);
    for (const [off, along] of [[14, 30], [-14, 58]]) {
      const ax = Math.cos(gateA), az = Math.sin(gateA);
      const x = dx + ax * along - az * off, z = dz + az * along + ax * off;
      if (groundAt(x, z) > seaLevel - 2) continue;
      const ship = clone("boat_supply");
      ship.position.set(x, seaLevel - 0.6, z);
      ship.rotation.y = -gateA + Math.PI / 2 + (off > 0 ? 0.05 : -0.08);
      statics.push(ship);
      const [mx, mz] = [x - ax * 9 + az * off * 0.3, z - az * 9 - ax * off * 0.3];
      if (groundAt(mx, mz) > seaLevel) place(clone("rig_mooring_post"), mx, mz, 0, 0);
    }
  }

  // The supply ship that comes in the night of the raid — not here until the
  // recon spots it arriving, which is the thing the plan could not know.
  const supply = clone("boat_supply");
  {
    const ax = Math.cos(gateA), az = Math.sin(gateA);
    const [dx, dz] = polar(gateA, waterR + 20);
    supply.position.set(dx + az * 2, seaLevel - 0.6, dz - ax * 2);
    supply.rotation.y = -gateA + Math.PI / 2;
    supply.visible = false;
    group.add(supply);
  }

  for (const m of mergeStatic(statics)) group.add(m);

  // --- the men ----------------------------------------------------------------------------
  const lightList = () => [
    ...braziers.map((b) => ({ pos: b.pos, lit: b.lit, r: 60 })),
    ...torches,
    ...fires,
  ];
  // How a man gets from one place to another: across the floor in a line
  // (round the smelter, not through it), along a terrace by the road.
  const route = (zone, from, to) => {
    if (!zone || zone.kind === "floor") {
      const ax = from.x - cx, az = from.z - cz, bx = to.x - cx, bz = to.z - cz;
      const dx = bx - ax, dz = bz - az;
      const t = THREE.MathUtils.clamp(-(ax * dx + az * dz) / Math.max(1e-6, dx * dx + dz * dz), 0, 1);
      const px = ax + dx * t, pz = az + dz * t;
      if (Math.hypot(px, pz) < 24 && t > 0.05 && t < 0.95) {
        const pr = Math.hypot(px, pz) || 1;
        const wx = px / pr * 27, wz = pz / pr * 27;
        const side = Math.hypot(px, pz) > 0.01 ? [wx, wz] : [-dz / Math.hypot(dx, dz) * 27, dx / Math.hypot(dx, dz) * 27];
        return [onGround(cx + side[0], cz + side[1]), to.clone()];
      }
      return [to.clone()];
    }
    const a0 = Math.atan2(from.z - cz, from.x - cx), a1 = Math.atan2(to.z - cz, to.x - cx);
    const da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
    const pts = [];
    const n = Math.floor(Math.abs(da) / 0.08);
    for (let i = 1; i <= n; i++) {
      const a = a0 + da * i / (n + 1);
      // Stay at his own distance from the wall, eased toward the target's.
      const r = Math.hypot(from.x - cx, from.z - cz) * (1 - i / (n + 1)) + Math.hypot(to.x - cx, to.z - cz) * (i / (n + 1));
      pts.push(onGround(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
    pts.push(to.clone());
    return pts;
  };
  const camp = { fires, tables, works, piles, homes, route, leantos };
  console.info(`hunterbase: ${homes.length} homes, ${leantos.length} lean-tos, ${fires.length} fires, ${tables.length} tables, ${works.length} work spots, ${torches.length} torches`);
  const hunters = await createHunters(scene, {
    getHeightAt: groundAt,
    getLights: lightList,
    onArrowHit: (a) => base.onArrowHit?.(a),
    camp,
  });

  // --- who is here, and what they do -----------------------------------------------
  // The WATCH holds posts round the clock: towers, ballistae, the lean-tos on
  // the terraces. PATROLS walk the cage ring and the road, torches in hand
  // after dark. Everybody else is CREW: a bunk, and a day's work.
  for (const t of towers) {
    const yaw = Math.atan2(t.pos.x - cx, t.pos.z - cz);   // looking out
    hunters.add({ kind: "archer", role: "watch", pos: V(t.pos.x, t.pos.y + 7.9, t.pos.z), facing: yaw, post: "tower" });
  }
  for (const b of ballistae) {
    const [x, z] = [b.pos.x - Math.cos(b.a) * 3, b.pos.z - Math.sin(b.a) * 3];
    hunters.add({ kind: "spear", role: "watch", pos: onGround(x, z), facing: Math.atan2(Math.cos(b.a), Math.sin(b.a)),
                  post: "ballista", ballista: b, torch: true });
  }
  for (const l of leantos) {
    hunters.add({ kind: "archer", role: "watch", pos: l.post, facing: l.yaw, seat: l.seat, post: "terrace" });
  }
  // Floor patrols round the cage ring, the yard and the halls.
  for (let i = 0; i < 6; i++) {
    const a0 = gateA + i * TAU / 6;
    const r = L.floorR * (i % 2 ? 0.4 : 0.72);
    const route = [];
    for (let k = 0; k <= 5; k++) route.push(onGround(...polar(a0 + k * 0.18, r + (k % 2) * 10)));
    for (let k = 5; k >= 0; k--) route.push(onGround(...polar(a0 + k * 0.18, r - 6)));
    hunters.add({ kind: "spear", role: "patrol", route, post: "pit floor" });
  }
  // Road patrols: up and down a stretch of each terrace.
  for (let k = 0; k < Math.min(3, L.turns); k++) {
    for (let j = 0; j < 2; j++) {
      const a0 = gateA + 0.8 + j * Math.PI + k * 0.7;
      const route = [];
      for (let q = 0; q <= 6; q++) {
        const a = a0 + q * 0.16;
        const p = L.roadAt(k, Math.atan2(Math.sin(a), Math.cos(a)));
        route.push(onGround(p.x, p.z));
      }
      const back = route.slice(0, -1).reverse();
      hunters.add({ kind: "spear", role: "patrol", route: route.concat(back), post: `terrace ${k + 1}` });
    }
  }
  // The crews. A hall sleeps nine, a hut three on the floor and two on a
  // terrace; one in four of them is an archer.
  let n = 0;
  for (const h of homes) {
    const beds = h.beds >= 12 ? 8 : h.beds === 4 ? 3 : h.beds === 3 ? 2 : 1;
    for (let b = 0; b < beds && hunters.men.length < 170; b++) {
      hunters.add({ kind: n++ % 4 === 3 ? "archer" : "spear", role: "crew", home: h, post: "crew" });
    }
  }
  // Start the day where it is: men who should be asleep are, and the rest
  // are scattered about their work rather than all walking out of one door.
  for (const m of hunters.men) {
    if (m.role !== "crew") continue;
    const w = camp.works.filter((x) => x.zone === m.zone);
    if (w.length && Math.random() < 0.7) m.pos.copy(w[Math.floor(Math.random() * w.length)].pos);
  }

  // The spearmen are the ones who throw bolas; main.js reads them as `guards`.
  const guards = hunters.men.filter((m) => m.kind === "spear");

  const lightPool = makeLightPool(group, 7, { color: 0xff8a3a, distance: 78, decay: 1.7 });
  const forgeLight = { pos: V(cx, floorY + 8, cz), intensity: 900, colour: 0xff7a2a };
  const staticEmitters = [
    ...braziers.map((b) => ({ pos: b.local, src: b, full: b.intensity, intensity: 0 })),
    { ...forgeLight, src: {}, full: forgeLight.intensity },
    ...torches.map((x) => ({ pos: x.pos, src: x, full: 90, intensity: 0 })),
    ...fires.map((x) => ({ pos: x.pos, src: x, full: 70, intensity: 0 })),
  ];
  const near = [], carriedEm = [];

  // Glow: every flame on the island as a soft additive sprite, so from the
  // air at night the pit is a coil of fire round a black hole — the lights are
  // geometry a few hand-widths across, and from a kilometre up geometry that
  // size is nothing. One Points draw for all of them.
  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,220,160,1)"); gr.addColorStop(0.25, "rgba(255,150,60,0.55)");
    gr.addColorStop(1, "rgba(255,90,20,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flames = [...torches.map((t) => ({ pos: t.pos, src: t, k: 1 })),
                  ...braziers.map((b) => ({ pos: b.pos, src: b, k: 1.8 })),
                  ...fires.map((f) => ({ pos: f.pos, src: f, k: 1.5 }))];
  const glowPos = new Float32Array(flames.length * 3);
  const glowSize = new Float32Array(flames.length);
  flames.forEach((f, i) => { glowPos.set([f.pos.x, f.pos.y, f.pos.z], i * 3); glowSize[i] = f.k; });
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute("position", new THREE.BufferAttribute(glowPos, 3));
  glowGeo.setAttribute("aSize", new THREE.BufferAttribute(glowSize, 1));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { tGlow: { value: glowTex }, uNight: { value: 1 }, uScale: { value: 900 } },
    vertexShader: `attribute float aSize; uniform float uScale; varying float vS;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vS = aSize;
        // About a two-metre halo up close, never under a few pixels far
        // off, so the coil still reads from high above the island.
        gl_PointSize = clamp(uScale * aSize * 1.6 / -mv.z, 2.5, 18.0) * (aSize > 0.0 ? 1.0 : 0.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D tGlow; uniform float uNight; varying float vS;
      void main(){ vec4 c = texture2D(tGlow, gl_PointCoord); gl_FragColor = vec4(c.rgb * (0.35 + uNight * 1.4), c.a * (0.35 + uNight * 0.65)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.renderOrder = 6;
  group.add(glow);

  // Pools of firelight on the ground. Seven real lights follow the camera
  // round a pit with three hundred flames in it, so most of the floor got
  // none and the camp was black between torches. Each flame also lays a
  // soft disc of warm light on the ground under it — a quad tilted to the
  // slope, additive, faded out by day — which is what lights a camp at night
  // as far as the eye is concerned, and costs one draw for all of them. The
  // night watch's torches get one each that follows them about.
  const poolTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Roughly inverse-square near the flame, easing to nothing at the rim.
    for (let i = 0; i <= 16; i++) {
      const r = i / 16, v = Math.pow(1 - r, 2.2) / (1 + r * r * 6);
      gr.addColorStop(r, `rgba(255,255,255,${v.toFixed(3)})`);
    }
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const pools = [...torches.map((x) => ({ src: x, pos: x.pos, size: 22 })),
                 ...braziers.map((x) => ({ src: x, pos: x.pos, size: 40 })),
                 ...fires.map((x) => ({ src: x, pos: x.pos, size: 24 })),
                 { src: { lit: true }, pos: V(cx, floorY, cz), size: 95 }];
  const CARRY = 48;
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex, color: 0x000000, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat,
    pools.length + CARRY);
  poolMesh.frustumCulled = false;
  poolMesh.renderOrder = 2;
  const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pn = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0), _ps = new THREE.Vector3(), _pp = new THREE.Vector3();
  const poolAt = (i, x, z, size) => {
    const e = 1.5;
    _pn.set(groundAt(x - e, z) - groundAt(x + e, z), 2 * e, groundAt(x, z - e) - groundAt(x, z + e)).normalize();
    // Steep ground (a wall behind a torch): lay it flat; the depth test
    // trims it where it meets the rock.
    if (_pn.y < 0.6) _pn.set(0, 1, 0);
    _pq.setFromUnitVectors(_up, _pn);
    _pm.compose(_pp.set(x, groundAt(x, z) + 0.15, z), _pq, _ps.set(size, 1, size));
    poolMesh.setMatrixAt(i, _pm);
  };
  pools.forEach((p, i) => { poolAt(i, p.pos.x, p.pos.z, p.size); poolMesh.setColorAt(i, new THREE.Color(1, 1, 1)); });
  for (let i = 0; i < CARRY; i++) poolMesh.setColorAt(pools.length + i, new THREE.Color(0.7, 0.7, 0.7));
  poolMesh.count = pools.length;
  group.add(poolMesh);
  const _pc = new THREE.Color();
  let poolNight = 1;
  let t = 0;

  const base = {
    group, hunters, braziers, cages, guards, towers, torches,
    terraceCages, hatchCage, prison, prisonAt, supply,
    /** Where things are, for the recon marks and the exit. */
    marks: {
      towers: towers.length ? towers[0].pos.clone() : V(cx, floorY, cz),
      cageRing: V(cx, floorY, cz),
      dock: onGround(...polar(gateA, waterR)),
      exit: (() => { const [x, z] = polar(gateA, L.rimR + 380); return V(x, 30, z); })(),
    },
    layout: L, gateA,
    deckY: floorY,
    centre: V(cx, floorY, cz),
    extent: { x: L.floorR, z: L.floorR },
    get litFraction() {
      return braziers.filter((b) => b.lit).length / braziers.length;
    },
    onArrowHit: null,
    update(dt, camera) {
      t += dt;
      for (const c of cages) c.update(dt, camera);
      for (const c of terraceCages) c.update(dt, camera);
      hatchCage?.update(dt, camera);
      // The smelter breathes.
      if (mouth) mouth.traverse((o) => {
        if (o.isMesh && o.material.emissiveIntensity !== undefined) {
          o.material.emissiveIntensity = 2.0 + Math.sin(t * 1.3) * 0.4 + Math.sin(t * 3.7) * 0.15;
        }
      });
      // A snuffed brazier's glow goes out with it.
      for (let i = 0; i < flames.length; i++) {
        const lit = flames[i].src.lit;
        if ((glowSize[i] > 0) !== lit) {
          glowSize[i] = lit ? flames[i].k : 0;
          glowGeo.attributes.aSize.needsUpdate = true;
        }
      }
      // Only the flames near the camera are candidates for the seven real
      // lights; the pool sorts what it is given, and four hundred torches a
      // frame is most of a millisecond for lights that could never win.
      near.length = 0;
      const cp = camera.position;
      for (const e of staticEmitters) {
        const lit = e.src.lit !== false;
        e.intensity = lit ? (e.src.intensity ?? e.full) : 0;
        if (lit && e.pos.distanceToSquared(cp) < 240 * 240) near.push(e);
      }
      const held = hunters.carried;
      for (let i = 0; i < held.length; i++) {
        const e = carriedEm[i] ??= { pos: new THREE.Vector3(), intensity: 55 };
        e.pos.copy(held[i].pos);
        if (e.pos.distanceToSquared(cp) < 240 * 240) near.push(e);
      }
      lightPool.update(camera, near);
      // Fires flicker.
      for (const f of fires) if (f.flame) f.flame.scale.setScalar(0.9 + Math.sin(t * 9 + f.pos.x) * 0.06 + Math.sin(t * 13.7 + f.pos.z) * 0.05);
      // The pools: out with their flame, faded by day, and following the
      // torches that walk.
      poolMat.color.setRGB(1.0, 0.48, 0.18).multiplyScalar(0.32 * THREE.MathUtils.smoothstep(poolNight, 0.25, 0.85)
        * (0.94 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 11.1) * 0.03));
      poolMesh.visible = poolNight > 0.25;
      let dirty = false;
      pools.forEach((p, i) => {
        const on = p.src.lit !== false;
        if (p.on !== on) { p.on = on; poolMesh.setColorAt(i, _pc.setScalar(on ? 1 : 0)); dirty = true; }
      });
      if (dirty) poolMesh.instanceColor.needsUpdate = true;
      const carried = hunters.carried;
      const nc = Math.min(CARRY, carried.length);
      for (let i = 0; i < nc; i++) poolAt(pools.length + i, carried[i].pos.x, carried[i].pos.z, 16);
      poolMesh.count = pools.length + nc;
      if (nc) poolMesh.instanceMatrix.needsUpdate = true;
    },
    setVisible(v) { group.visible = v; hunters.setVisible(v); },
    /** 0 day .. 1 night: how hard the glows burn. */
    setNight(n) { glowMat.uniforms.uNight.value = n; poolNight = n; },
    dispose() { scene.remove(group); },
  };
  return base;
}
