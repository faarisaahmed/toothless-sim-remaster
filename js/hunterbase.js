import * as THREE from "three";
import { prop } from "./props.js";
import { mergeStatic, makeLightPool } from "./places.js";
import { makeOrb } from "./placeholder.js";
import { loadKit, createActor } from "./dragonkit.js";
import { pitLayout, PADS, pitPaths, pitPathAt, fertility, terrainSlope } from "./terrain.js";
import { createHunters } from "./hunters.js";

// ---------------------------------------------------------------------------
// Dragon Hunter Island — the base.
//
// The island is a pit now (terrain.js): a round floor, a road spiralling up the
// wall in terraces, a rim, a channel to the sea. This dresses it, in sections
// that each do a job in the story and in the stealth:
//
//   THE YARD        The pit floor, fenced: a palisade with one gate toward the
//                   channel, Bellows' smelter in the middle, the cages round
//                   it, the braziers, a workshop and the yard crew's barracks.
//                   Two men on the gate, one walking the cages; the real
//                   watching is from the towers above it. The target.
//   THE SPIRAL      The road up the wall. Dark, as roads are, but for the
//                   lanterns on the towers that overlook the yard and the
//                   lean-to where the small cages wait to be carried down.
//   THE RIM         Six watchtowers with archers and alarm horns, ballistae,
//                   palisade between them. Coming over the top means coming
//                   past these.
//   THE CHANNEL     The dock and the supply ships, the only way in at sea
//                   level, and the one place everyone is looking.
//   THE HARBOUR     Where they live, outside the pit: a cove cut into the
//                   outer slope beside the channel (terrain.js PADS). Houses
//                   round a square with a fire, the chief's hall on a knoll at
//                   the back with men on its door, a jetty, boats, fish racks,
//                   a net shed. hunters.js gives everyone a day — work, meals,
//                   the fire, bed — and only a handful hold posts at night.
//
// The returned object keeps the shape the story already reads (braziers,
// cages, guards, litFraction), so the chapters drive it unchanged.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/**
 * How thick the wood is at a point, 0..1, for the hunters' sight lines: the
 * same number the forest planted its trees by (terrain.js fertility, which
 * includes the old gullies), turned into the share of spots that got a tree.
 * Fertility is a few noise reads and a slope, so it is cached on an 8 m grid
 * round the island and filled in as the sight lines ask for it.
 */
function makeCover(L, groundAt) {
  const CELL = 8, HALF = 1150, N = Math.ceil(HALF * 2 / CELL);
  const grid = new Float32Array(N * N).fill(-1);
  const x0 = L.x - HALF, z0 = L.z - HALF;
  return (x, z) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    const k = j * N + i;
    let c = grid[k];
    if (c < 0) {
      const cx = x0 + (i + 0.5) * CELL, cz = z0 + (j + 0.5) * CELL;
      const f = fertility(cx, cz, groundAt(cx, cz), terrainSlope(cx, cz));
      // forest.js keeps a spot when its roll is under f * 1.15.
      c = grid[k] = f < 0.16 ? 0 : Math.min(1, Math.max(0, (f * 1.15 - 0.1) / 0.9));
    }
    return c;
  };
}

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
    "dh_hut", "dh_longhouse", "dh_leanto", "dh_shed", "dh_campfire", "dh_table", "dh_hall", "dh_fishrack"];
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
  // The old gullies (terrain.js pitPaths) are nobody's: nothing is built in
  // one or on its lip, and the yard fence is broken where each comes out.
  const inGully = (x, z, pad = 8) => { const g = pitPathAt(x, z); return g.path >= 0 && g.d < g.depth * 0.6 + 17 + pad; };
  const gullyEnds = pitPaths().map((p) => Math.atan2(p.z[p.z.length - 1] - cz, p.x[p.x.length - 1] - cx));

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
    if (roughness(p.x, p.z) > 2 || groundAt(p.x, p.z) < 8 || inGully(p.x, p.z)) continue;
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
  for (let i = 0; i < 8; i++) addBrazier(...polar(gateA + (i + 0.75) * TAU / 8, L.floorR * 0.72));

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
  for (const p of pitPaths()) {
    for (let i = 0; i < p.x.length; i += 3) take(p.x[i], p.z[i], p.half + 6);
  }
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

  const addTable = (x, z, yaw, zone) => {
    place(clone("dh_table"), x, z, yaw, 0);
    take(x, z, 2.6);
    const seats = [];
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    for (const sd of [-1, 1]) {
      for (const along of [-1.3, 0, 1.3]) {
        const px = x + ax * 0.85 * sd + Math.sin(yaw) * along, pz = z + az * 0.85 * sd + Math.cos(yaw) * along;
        seats.push({ pos: V(px, groundAt(px, pz), pz), yaw: Math.atan2(-ax * sd, -az * sd), ground: false, by: null });
      }
    }
    tables.push({ seats, zone });
  };
  const workAt = (x, z, yaw, zone, act = "work", look = null) =>
    works.push({ pos: V(x, groundAt(x, z), z), yaw, zone, act, look });
  // A flame with no prop of its own — a lantern on a tower, a brazier built
  // into a model — that still lights the ground and the men round it.
  const lamp = (x, y, z, r = 15) => { const t = { pos: V(x, y, z), lit: true, r }; torches.push(t); return t; };

  // ===========================================================================
  // THE YARD. The pit floor is where the dragons are kept and worked, and
  // nothing else: a palisade round it with one gate toward the channel, the
  // smelter in the middle, the cages round it, the braziers, a workshop and a
  // barracks for the yard crew. A few men on the gate and one walking the
  // cages; the watching is done from above — two towers at the gate and three
  // on the terraces looking straight down into it.
  // ===========================================================================
  const yardZone = { kind: "floor" };
  const YARD_R = L.floorR - 13;
  const gateHalf = 0.075;
  for (let a = gateA + gateHalf + 0.03; a < gateA + TAU - gateHalf - 0.03; a += 6 / YARD_R) {
    // Fallen in where a gully comes down to it: a gap a dragon can get through.
    if (gullyEnds.some((e) => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))) < 0.06)) continue;
    const [x, z] = polar(a, YARD_R);
    place(clone("dh_palisade"), x, z, -a, -0.2);
    take(x, z, 2);
  }
  const yardTowers = [];
  for (const side of [-1, 1]) {
    const a = gateA + side * (gateHalf + 0.07);
    const [x, z] = polar(a, YARD_R - 6);
    const t = clone("dh_watchtower");
    place(t, x, z, -gateA + Math.PI / 2, -0.3);
    take(x, z, 4);
    const pos = onGround(x, z);
    yardTowers.push({ pos, a: gateA, look: gateA });
    lamp(x, pos.y + 9.5, z, 16);
  }
  const gateAt = (off) => onGround(...polar(gateA + off, YARD_R + 4));
  for (const off of [-gateHalf * 1.2, gateHalf * 1.2]) addTorch(...polar(gateA + off, YARD_R + 2.5));
  // Barracks and the cook fire, just inside the gate.
  {
    const s0 = site(...polar(gateA + 0.45, YARD_R - 14), 9);
    if (s0) {
      const a = Math.atan2(s0.z - cz, s0.x - cx);
      build("dh_longhouse", s0.x, s0.z, -a, 9, { doorOut: 8.3, beds: 12, zone: yardZone });
    }
    const f0 = site(...polar(gateA + 0.22, YARD_R - 22), 3.6);
    if (f0) {
      addFire(f0.x, f0.z, yardZone);
      const t0 = site(f0.x + 6, f0.z, 2.6);
      if (t0) addTable(t0.x, t0.z, facing(t0.x, t0.z, cx, cz), yardZone);
    }
  }
  // The workshop, with the bench and the anvil to work at.
  {
    const s0 = site(...polar(gateA - 0.5, YARD_R - 16), 5.5);
    if (s0) {
      const yaw = facing(s0.x, s0.z, cx, cz) + Math.PI / 2;
      build("dh_shed", s0.x, s0.z, yaw, 5.5, { torch: false });
      const ax = Math.cos(yaw), az = -Math.sin(yaw);
      for (const off of [-1.8, 0, 1.8]) {
        workAt(s0.x - ax * 1.1 + Math.sin(yaw) * off, s0.z - az * 1.1 + Math.cos(yaw) * off, Math.atan2(-ax, -az), yardZone);
      }
      workAt(s0.x + ax * 0.6 + Math.sin(yaw) * 0.6, s0.z + az * 0.6 + Math.cos(yaw) * 0.6, yaw + Math.PI, yardZone);
    }
  }
  for (const [a, rr, yaw] of [[gateA + 1.3, 0.7, 0.6], [gateA - 1.7, 0.66, -1.1], [gateA + Math.PI, 0.72, 2.2]]) {
    const s0 = site(...polar(a, L.floorR * rr), 4.5, { flat: 3 });
    if (!s0) continue;
    place(clone("rig_crane"), s0.x, s0.z, yaw, 0);
    take(s0.x, s0.z, 4.5);
  }
  // Feeding and watering the cages, and stoking the smelter.
  for (const c of cages) {
    const a = Math.atan2(c.pos.z - cz, c.pos.x - cx);
    const px = c.pos.x - Math.cos(a) * 10, pz = c.pos.z - Math.sin(a) * 10;
    workAt(px, pz, facing(px, pz, c.pos.x, c.pos.z), yardZone, "tend");
  }
  {
    const ax = Math.cos(gateA), az = Math.sin(gateA);
    for (const off of [-3, 0, 3]) {
      const px = cx + ax * 21 - az * off, pz = cz + az * 21 + ax * off;
      workAt(px, pz, facing(px, pz, cx, cz), yardZone);
    }
  }
  // Stores: crates, barrels, chain and nets, stacked against the palisade
  // where a yard keeps them, not scattered across it.
  const piles = [];
  {
    let r0 = 7;
    const rnd = () => ((r0 = (r0 * 16807) % 2147483647) / 2147483647);
    for (const a0 of [gateA + 0.9, gateA + 2.2, gateA - 1.1, gateA - 2.6]) {
      for (let i = 0; i < 9; i++) {
        const a = a0 + (rnd() - 0.5) * 0.35, r = YARD_R - 5 - rnd() * 7;
        const [x, z] = polar(a, r);
        if (!free(x, z, 1.3)) continue;
        const kind = i % 6 === 0 ? "rig_net_pile" : i % 4 === 0 ? "rig_chain_coil" : i % 2 ? "rig_crate" : "rig_barrel";
        place(clone(kind), x, z, rnd() * TAU, 0.02);
        take(x, z, 1.3);
        if (kind === "rig_crate" && piles.length < 10) piles.push(V(x, groundAt(x, z), z));
      }
    }
  }

  // ===========================================================================
  // THE TERRACES. The road up the wall, and the towers that overlook the
  // yard. A road is not lit end to end: there is a lean-to and a fire where
  // the small cages wait, and the rest is dark.
  // ===========================================================================
  const terraceZones = [];
  for (let k = 0; k < L.turns; k++) terraceZones.push({ kind: "road", k });
  const overTowers = [];
  for (let i = 0; i < 3; i++) {
    const a0 = gateA + 1.1 + i * TAU / 3;
    const p = L.roadAt(1, Math.atan2(Math.sin(a0), Math.cos(a0)));
    // On the pit edge of the tread, where the drop is.
    const s0 = site(p.x - Math.cos(a0) * 8, p.z - Math.sin(a0) * 8, 4, { reach: 14, flat: 2.2 });
    if (!s0) continue;
    const t = clone("dh_watchtower");
    place(t, s0.x, s0.z, facing(s0.x, s0.z, cx, cz), -0.3);
    take(s0.x, s0.z, 4);
    const pos = onGround(s0.x, s0.z);
    overTowers.push({ pos, look: Math.atan2(cz - s0.z, cx - s0.x) });
    lamp(s0.x, pos.y + 9.5, s0.z, 16);
  }
  {
    // The lean-to by the small cages on the second terrace.
    const c = terraceCages[Math.floor(terraceCages.length / 2)];
    if (c) {
      const a = Math.atan2(c.pos.z - cz, c.pos.x - cx) + 0.06;
      const p = L.roadAt(1, a);
      const s0 = site(p.x, p.z, 2.6, { reach: 14, flat: 1.8 });
      if (s0) {
        const yaw = facing(s0.x, s0.z, cx, cz);
        build("dh_leanto", s0.x, s0.z, yaw, 2.7, { torch: false });
        const at = (lz) => { const x = s0.x + Math.sin(yaw) * lz, z = s0.z + Math.cos(yaw) * lz; return V(x, groundAt(x, z), z); };
        leantos.push({ post: at(2.4), seat: { pos: at(-0.95), yaw }, yaw, zone: terraceZones[1] });
        const f0 = site(s0.x + Math.sin(yaw + 1.6) * 6, s0.z + Math.cos(yaw + 1.6) * 6, 3.6, { reach: 8, flat: 1.8 });
        if (f0) addFire(f0.x, f0.z, terraceZones[1]);
      }
    }
  }

  // ===========================================================================
  // THE HARBOUR. Where they live: a cove cut into the outer slope beside the
  // channel (terrain.js PADS), at the water. Houses round a square with a
  // fire in it, the chief's hall on the knoll at the back with two men on its
  // door, the boats and the fish racks along the shore, a net shed. Lit the
  // way a village is at night — the hall's door, the square, the jetty —
  // and dark between.
  // ===========================================================================
  const villageZone = { kind: "village" };
  const H = PADS.find((p) => p.name === "harbour");
  const K = PADS.find((p) => p.name === "hall");
  let hall = null;
  const villageWatch = [];
  if (H) {
    // Which way is the sea from the middle of the cove?
    let seaA = 0, lowH = Infinity;
    for (let k = 0; k < 32; k++) {
      const a = k * TAU / 32;
      const h = groundAt(H.x + Math.cos(a) * (H.r + 40), H.z + Math.sin(a) * (H.r + 40));
      if (h < lowH) { lowH = h; seaA = a; }
    }
    const sx = Math.cos(seaA), sz = Math.sin(seaA);          // toward the water
    const px = -sz, pz = sx;                                // along the shore
    // Laid out tight round the square, the way a village is — a hundred and
    // eighty metres of level ground does not mean houses a stone's throw apart.
    const at = (along, out) => [H.x + px * along + sx * out, H.z + pz * along + sz * out];
    const atc = (along, out) => at(along * 0.62, out * 0.62);
    const sq = at(0, 2);                                     // the square
    take(H.x, H.z, 0);
    // The chief's hall, on its knoll, door toward the square.
    if (K) {
      const yaw = facing(K.x, K.z, sq[0], sq[1]);
      place(clone("dh_hall"), K.x, K.z, yaw, -0.3);
      take(K.x, K.z, 14);
      const d = V(K.x + Math.sin(yaw) * 17, 0, K.z + Math.cos(yaw) * 17);
      d.y = groundAt(d.x, d.z);
      hall = { door: d, yaw, pos: V(K.x, groundAt(K.x, K.z), K.z) };
      homes.push({ door: d, yaw, beds: 4, zone: villageZone });
      // The two braziers by its door are part of the model; their light is not.
      for (const side of [-1, 1]) {
        const lx = K.x + Math.sin(yaw) * 16.3 + Math.cos(yaw) * side * 3.4;
        const lz = K.z + Math.cos(yaw) * 16.3 - Math.sin(yaw) * side * 3.4;
        lamp(lx, groundAt(lx, lz) + 2.6, lz, 18);
      }
    }
    // The square: a fire and two tables.
    addFire(sq[0], sq[1], villageZone);
    for (const side of [-1, 1]) {
      const [tx, tz] = at(side * 8, 4);
      addTable(tx, tz, Math.atan2(px, pz), villageZone);
    }
    // Houses in an arc round the square, doors in.
    const houses = [[-30, -10, "dh_longhouse"], [30, -10, "dh_longhouse"],
                    [-56, -4, "dh_hut"], [56, -4, "dh_hut"], [-13, -30, "dh_hut"], [13, -30, "dh_hut"],
                    [-38, -36, "dh_hut"], [38, -36, "dh_hut"], [-64, -28, "dh_hut"], [64, -28, "dh_hut"],
                    [-56, 30, "dh_hut"], [56, 30, "dh_hut"], [-74, 6, "dh_longhouse"], [74, 6, "dh_longhouse"],
                    [-36, 50, "dh_tent"], [36, 50, "dh_tent"], [-24, 56, "dh_tent"]];
    for (const [along, out, kind] of houses) {
      const [x, z] = atc(along, out);
      const r = kind === "dh_longhouse" ? 9 : kind === "dh_tent" ? 3 : 3.6;
      const s0 = site(x, z, r, { reach: 10, flat: 1.4, minY: seaLevel + 2 });
      if (!s0) continue;
      const toSq = facing(s0.x, s0.z, sq[0], sq[1]);
      if (kind === "dh_longhouse") {
        // A hall's doors are in its gables: turn it end-on to the square.
        build(kind, s0.x, s0.z, toSq, r, { doorOut: 8.3, beds: 6, zone: villageZone, torch: false });
      } else if (kind === "dh_tent") {
        place(clone(kind), s0.x, s0.z, toSq, 0);
        take(s0.x, s0.z, 3);
      } else {
        build(kind, s0.x, s0.z, toSq, r, { doorOut: 3.2, beds: 3, zone: villageZone, torch: false });
      }
    }
    // The shore: a jetty, the boats, the racks and the net shed.
    {
      const [jx, jz] = at(0, H.r + 2);
      const jetty = clone("berk_dock");
      jetty.position.set(jx, Math.max(groundAt(jx, jz), seaLevel) + 0.2, jz);
      jetty.rotation.y = -seaA + Math.PI / 2;
      statics.push(jetty);
      take(jx, jz, 8);
      lamp(jx, seaLevel + 3.5, jz, 14);
      addTorch(...at(-6, H.r - 6));
      for (const [along, out] of [[16, 26], [-18, 34]]) {
        const [bx, bz] = at(along, H.r + out);
        if (groundAt(bx, bz) > seaLevel - 2) continue;
        const boat = clone("boat_supply");
        boat.position.set(bx, seaLevel - 0.6, bz);
        boat.rotation.y = -seaA + Math.PI / 2 + along * 0.004;
        boat.scale.setScalar(0.8);
        statics.push(boat);
      }
    }
    for (const along of [-40, -30, 26, 36, 46]) {
      const [x, z] = at(along, H.r - 18);
      const s0 = site(x, z, 3, { reach: 8, flat: 1.4, minY: seaLevel + 1.5 });
      if (!s0) continue;
      const yaw = Math.atan2(px, pz);
      place(clone("dh_fishrack"), s0.x, s0.z, yaw, 0);
      take(s0.x, s0.z, 3);
      workAt(s0.x - sx * 1.3, s0.z - sz * 1.3, Math.atan2(sx, sz), villageZone);
    }
    {
      const [x, z] = at(-14, H.r - 22);
      const s0 = site(x, z, 5.5, { reach: 10, flat: 1.4, minY: seaLevel + 1.5 });
      if (s0) {
        const yaw = Math.atan2(sx, sz) + Math.PI / 2;
        build("dh_shed", s0.x, s0.z, yaw, 5.5, { torch: false });
        workAt(s0.x, s0.z, yaw, villageZone);
        workAt(s0.x + px * 2, s0.z + pz * 2, yaw + Math.PI, villageZone);
      }
    }
    // Woodpile and stores behind the houses.
    let r1 = 11;
    const rnd = () => ((r1 = (r1 * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 16; i++) {
      const [x, z] = at((rnd() - 0.5) * 120, -40 - rnd() * 25);
      if (!free(x, z, 1.3) || flatFor(x, z, 1.3) > 1.2) continue;
      place(clone(i % 3 ? "rig_crate" : "rig_barrel"), x, z, rnd() * TAU, 0.02);
      take(x, z, 1.3);
      if (i % 4 === 0) workAt(x + 1.5, z, rnd() * TAU, villageZone, "stoop");
    }
    // The night watch's round: the square, the shore, the hall.
    const round = [at(0, 20), at(-40, 30), at(-50, 0), at(-20, -40), at(20, -40), at(50, 0), at(40, 30)]
      .map(([x, z]) => onGround(x, z));
    villageWatch.push(round);
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
        const rough = roughness(x, z, 3) + (inGully(x, z, 14) ? 100 : 0);
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
    lamp(best.x, groundAt(best.x, best.z) + 9.5, best.z, 16);     // a lantern on the deck
  }
  const ballistae = [];
  for (let i = 0; i < 3; i++) {
    const a = gateA + 0.6 + i * TAU / 3;
    const p = L.roadAt(Math.min(2, L.turns - 1), Math.atan2(Math.sin(a), Math.cos(a)));
    if (roughness(p.x, p.z) > 2.5 || inGully(p.x, p.z)) continue;
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
      if (groundAt(x, z) < 50 || inGully(x, z, 2)) continue;
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
    if (zone?.kind === "village") return [to.clone()];
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
    cover: makeCover(L, groundAt),
    getLights: lightList,
    onArrowHit: (a) => base.onArrowHit?.(a),
    camp,
  });

  // --- who is here, and what they do -----------------------------------------------
  // Not an army standing in a ring. A working island of about fifty: the
  // yard crew and the villagers have homes and a day; a handful hold posts
  // round the clock — the towers, the yard gate, the ballistae, the chief's
  // door — and three walk rounds, with torches after dark.
  for (const t of towers) {
    const yaw = Math.atan2(t.pos.x - cx, t.pos.z - cz);   // looking out
    hunters.add({ kind: "archer", role: "watch", pos: V(t.pos.x, t.pos.y + 7.9, t.pos.z), facing: yaw, post: "tower" });
  }
  for (const t of [...yardTowers, ...overTowers]) {
    // Looking down into the yard.
    const yaw = Math.atan2(cx - t.pos.x, cz - t.pos.z);
    hunters.add({ kind: "archer", role: "watch", pos: V(t.pos.x, t.pos.y + 7.9, t.pos.z), facing: yaw, post: "tower" });
  }
  for (const side of [-1, 1]) {
    const g = gateAt(side * gateHalf * 0.55);
    hunters.add({ kind: "spear", role: "watch", pos: g, facing: Math.atan2(g.x - cx, g.z - cz),
                  post: "yard gate", torch: true });
  }
  for (const b of ballistae) {
    const [x, z] = [b.pos.x - Math.cos(b.a) * 3, b.pos.z - Math.sin(b.a) * 3];
    hunters.add({ kind: "spear", role: "watch", pos: onGround(x, z), facing: Math.atan2(Math.cos(b.a), Math.sin(b.a)),
                  post: "ballista", ballista: b });
  }
  for (const l of leantos) {
    hunters.add({ kind: "archer", role: "watch", pos: l.post, facing: l.yaw, seat: l.seat, post: "terrace" });
  }
  if (hall) {
    for (const side of [-1, 1]) {
      const p = hall.door.clone().add(V(Math.cos(hall.yaw) * side * 2.6, 0, -Math.sin(hall.yaw) * side * 2.6));
      p.y = groundAt(p.x, p.z);
      hunters.add({ kind: "spear", role: "watch", pos: p, facing: hall.yaw, post: "chief's door", torch: true });
    }
  }
  // Rounds: one man walking the cages, one on the road, one in the village.
  {
    const route = [];
    for (let k = 0; k < 12; k++) route.push(onGround(...polar(gateA + 0.35 + k * (TAU - 0.7) / 11, L.floorR * 0.5)));
    hunters.add({ kind: "spear", role: "patrol", route: route.concat(route.slice(0, -1).reverse()), post: "yard" });
  }
  {
    const route = [];
    for (let q = 0; q <= 8; q++) {
      const a = gateA + 0.6 + q * 0.14;
      const p = L.roadAt(1, Math.atan2(Math.sin(a), Math.cos(a)));
      route.push(onGround(p.x, p.z));
    }
    hunters.add({ kind: "spear", role: "patrol", route: route.concat(route.slice(0, -1).reverse()), post: "road" });
  }
  for (const round of villageWatch) hunters.add({ kind: "spear", role: "patrol", route: round, post: "village" });
  // The ones who live here. A barracks sleeps the yard crew; a village house
  // its family's men; the chief's hall the chief and his own.
  for (const h of homes) {
    const beds = h.beds >= 12 ? 8 : h.beds >= 6 ? 3 : h.beds >= 4 ? 3 : 2;
    for (let b = 0; b < beds; b++) {
      hunters.add({ kind: b === 1 && h.zone === yardZone ? "archer" : "spear", role: "crew", home: h, post: "crew" });
    }
  }
  // Start the day where it is: the men are about their work, not all walking
  // out of one door.
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
