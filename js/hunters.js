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
// SEEING. A man sees roughly where he is facing: clearly for about fifty
// degrees either side, the corner of his eye out to seventy, nothing behind
// him, and he scans the ground rather than the sky. The sight line is walked
// against the height field (the pit walls and the rim hide a lot), the
// buildings (main.js hands in a raycast) and the wood: every few metres it
// spends among trunks or crowns lets less of the dragon through, so a dragon
// on the floor of a wooded gully is all but invisible from the rim while one
// over the treetops is not hidden at all. Light matters as before — by night
// it is the fires and torches near him and very little moon — and so does
// what there is to see: wings out against the sky he is big and carries a
// long way; on his feet he is a big cat, and a still one is a rock until it
// moves. What a man is DOING matters as much — asleep he sees nothing, eating
// or hammering he is barely looking, a sentry is. Noise is heard rather than
// seen: wingbeats, a gallop, a plasma blast going off.
//
// What he gets fills a meter, and the meter drives a small, dim mind:
//
//      calm         about his day
//      suspicious   "?" filling; he stops and turns toward what he saw or
//                   heard (NOTICE)
//      investigate  he walks to where it WAS — the last place he saw
//                   something, or where the bang came from — not where the
//                   dragon is now
//      search       he pokes about there for a few seconds, then gives up
//                   and goes back to what he was doing
//      alert        "!" — the meter filled while he could see him; he shouts,
//                   the men within earshot come to look, archers draw, and
//                   the island is on ALARM until nobody has seen him for a
//                   while
//
// They are meant to be beatable: they give up quickly, a blast in the rocks
// pulls them off their posts, they do not look up much, and they cannot see
// through a wood.
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

const SIGHT = 340;           // m — nobody notices him on the ground past this, in full daylight
const SIGHT_AIR = 420;       // m — ...or in the air, wings out against the sky
const ARCHER_RANGE = 380;    // m — and nobody shoots past this
const ARROW_SPEED = 95;      // m/s
const ARROW_DAMAGE = 7;
const ALARM_TIME = 14;       // s the island stays roused after the last sighting
const HEARING = 120;         // m — a loud dragon is heard inside this
const WAKE_RANGE = 170;      // m — an alarm this close to his door gets a sleeper up
const MOON = 0.04;           // what there is to see by at midnight away from a fire
// Where a man looks. Straight ahead he sees clearly for about fifty degrees
// either side; out to seventy he catches movement and little else; behind him
// he is blind. He scans the ground, not the sky: well above eye level he has
// to happen to look up.
const FOV_CLEAR = 0.85;      // rad either side of his facing
const FOV_EDGE = 1.22;       // rad — the corner of his eye ends here
const LOOK_UP = 0.5;         // rad above level before he stops looking
// The meter. Below NOTICE he has not noticed anything; between it and 1 he is
// suspicious; at 1 he has him.
const NOTICE = 0.3;
const RATE = 1.35;           // meter per second at full visibility
const FORGET = 0.13;         // ...and what it loses per second when he sees nothing
const SHOUT = 150;           // m — a man who has him brings the others within this
const SEARCH_TIME = [4, 7];  // s he pokes about where he thought it was, then gives up
const INVESTIGATE_MAX = 25;  // s he walks toward something before he loses interest

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
export async function createHunters(scene, { getHeightAt, getLights = () => [], onArrowHit = () => {}, camp = null,
                                              cover = null } = {}) {
  // Things that block a sight line besides the ground: buildings (set by the
  // caller once they are solid — main.js), and how thick the wood is at a
  // point (0..1), which thins it rather than cutting it.
  let occluder = null;
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

  // --- where they are looking ---------------------------------------------------
  // A faint fan on the ground in front of the men near him while he is on foot
  // or aiming: pale while they are about their business, amber when something
  // has caught their eye, red when they have him. It is a hint of which way a
  // man faces, not a map of what he can see — it fades out long before his
  // sight does.
  const CONES = 24, CONE_LEN = 30;
  const coneGeo = (() => {
    // Soft all round: brightest just in front of his feet, fading out with
    // distance and toward the corners of his eye, no hard edge anywhere.
    const P = [0, 0, 0], F = [0.6], I = [];
    const N = 28, RINGS = [0.2, 0.45, 0.72, 1];
    const sm = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (const rr of RINGS) {
      for (let i = 0; i <= N; i++) {
        const a = -FOV_EDGE + (i / N) * FOV_EDGE * 2;
        P.push(Math.sin(a) * rr, 0, Math.cos(a) * rr);
        const side = 1 - sm(Math.abs(a), FOV_CLEAR * 0.55, FOV_EDGE);
        F.push(side * Math.pow(1 - rr, 1.3) * 0.9 + side * 0.05 * (rr < 1 ? 1 : 0));
      }
    }
    for (let i = 0; i < N; i++) I.push(0, 2 + i, 1 + i);
    for (let r = 0; r < RINGS.length - 1; r++) {
      for (let i = 0; i < N; i++) {
        const a = 1 + r * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
        I.push(a, b, d, a, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("aFade", new THREE.Float32BufferAttribute(F, 1));
    g.setIndex(I);
    return g;
  })();
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.2 } },
    vertexShader: `attribute float aFade; varying float vFade; varying vec3 vCol;
      void main() {
        vFade = aFade;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3( 1.0 );
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: `uniform float uOpacity; varying float vFade; varying vec3 vCol;
      void main() { gl_FragColor = vec4( vCol, vFade * uOpacity ); }`,
    // Drawn over the ground rather than into it: a flat fan laid on rough
    // rock is cut to ribbons by every lump it passes through. It reads as a
    // HUD hint, like the marks over their heads.
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  });
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, CONES);
  cones.count = 0;
  cones.frustumCulled = false;
  cones.renderOrder = 3;
  cones.setColorAt(0, new THREE.Color(1, 1, 1));
  group.add(cones);
  let coneFocus = null, coneShow = 0;
  const CONE_COLOUR = { calm: new THREE.Color(0.62, 0.7, 0.85), alert: new THREE.Color(1, 0.28, 0.18) };
  const CONE_SUS = new THREE.Color(1, 0.72, 0.28);

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
      // What he is looking into: where he saw something or heard it, how long
      // since he last had eyes on the dragon, and his clock in this state.
      poi: new THREE.Vector3(), hasPoi: false, stateT: 0, lostT: 99, searchYaw: 0, searchFor: 5,
      mobile: null, trans: 1, los: false, vis: 0,
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
  /**
   * How much of the dragon gets through from `from` to `to`: 0 when the
   * ground or a building is in the way, 1 across open ground, and in between
   * through trees. The line is walked in steps of about five metres, and
   * every step that passes through a crown or among the trunks lets less
   * through (exponential in the wood's density there). A dragon on the floor
   * of a wooded gully is all but invisible from the rim; one flying over the
   * treetops is not hidden at all.
   */
  function sightLine(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    const steps = Math.max(6, Math.min(48, Math.ceil(d / 5)));
    const seg = d / steps;
    let trans = 1;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
      const g = getHeightAt(x, z);
      // The last few metres to a dragon on the ground may graze it: a ridge
      // of soil under his chin does not hide him.
      if (g > y + (d * (1 - t) < 4 ? 1.6 : 0.4)) return 0;
      if (cover) {
        const c = cover(x, z);
        if (c > 0.02) {
          const agl = y - g;
          const top = 5 + 13 * c;          // the canopy's height, roughly
          if (agl < top) {
            // Crowns are thicker than the trunk zone under them.
            const k = agl < 2.6 ? 0.06 : 0.12;
            trans *= Math.exp(-c * k * seg);
            if (trans < 0.02) return 0;
          }
        }
      }
    }
    // Undergrowth: ferns and bushes round a dragon lying low in them.
    if (cover) {
      const c = cover(to.x, to.z);
      if (c > 0.02 && to.y - getHeightAt(to.x, to.z) < 2.6) trans *= 1 - 0.5 * c;
    }
    if (trans > 0.02 && occluder && occluder(from, to)) return 0;
    return trans;
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
  const _step = new THREE.Vector3();

  /** Can he leave where he stands? A man on a tower deck or a roof stays put. */
  function mobileNow(man) {
    return man.label !== "tower" && Math.abs(getHeightAt(man.pos.x, man.pos.z) - man.pos.y) < 2.2;
  }

  /** Something caught his attention at `at`: stop and look that way. */
  function notice(man, at, level) {
    man.poi.copy(at);
    man.hasPoi = true;
    man.awareness = Math.max(man.awareness, level);
    if (man.state === "calm" || man.state === "search") { man.state = "suspicious"; man.stateT = 0; }
  }

  /** Walk straight at the point he is looking into. False when he cannot go
   *  further — there, or the ground ahead is a drop or a wall. */
  function walkToward(man, at, dt, speed) {
    const dx = at.x - man.pos.x, dz = at.z - man.pos.z;
    const dl = Math.hypot(dx, dz);
    man.wantYaw = Math.atan2(dx, dz);
    if (dl < 3) return false;
    const step = Math.min(dl, speed * dt);
    _step.set(man.pos.x + (dx / dl) * step, 0, man.pos.z + (dz / dl) * step);
    const g = getHeightAt(_step.x, _step.z);
    // A metre up for every metre on is a scramble, and he is not going to.
    // (Read ahead, so he stops at the lip rather than over it.)
    const ahead = getHeightAt(man.pos.x + (dx / dl) * 2.5, man.pos.z + (dz / dl) * 2.5);
    if (Math.abs(ahead - man.pos.y) > 2.2 || Math.abs(g - man.pos.y) > step * 1.2 + 0.3) return false;
    man.pos.set(_step.x, g, _step.z);
    man.moving = true;
    return true;
  }

  /**
   * @param {object} t   the dragon: { pos, vel, loud, hidden, speedT,
   *                     grounded (on his feet), move (0 still .. 1 flat out),
   *                     noise (metres his footfalls carry, on foot) }
   * @param {number} night  0 day .. 1 night
   * @param {number} h      the hour, 0..24
   * @param {number} haze   0..1, how much of the daylight range the weather
   *                        leaves (fog, rain)
   */
  function update(dt, t, night = 0, h = hour, haze = 1) {
    time += dt;
    hour = h;
    alarm = Math.max(0, alarm - dt);
    const seenNow = [];
    const dark = night > 0.5;
    // How lit the dragon is: the same for every man, so once.
    const tLight = t && !t.hidden ? lightAt(t.pos, night) : 0;
    // How much of him there is to see. Flying, wings out, he is fourteen
    // metres of black against the sky; on his feet he is a big cat, and a
    // still one is a rock until it moves.
    const air = !t?.grounded;
    const size = air ? 1.3 : 0.55;
    const reach = air ? SIGHT_AIR : SIGHT;
    const motion = t?.grounded ? 0.45 + 0.55 * Math.min(1, t.move ?? 0) : 0.85 + 0.15 * (t?.speedT ?? 0);

    for (const man of men) {
      if (man.ko > 0) {
        man.ko = Math.max(0, man.ko - dt);
        man.koT = Math.min(1, man.koT + dt * 3);
        // Gets up wondering what hit him, and has a look round where he fell.
        if (man.ko === 0) { notice(man, man.pos, 0.5); man.state = "search"; man.stateT = 0; man.searchFor = 6; man.searchYaw = man.yaw; }
        continue;
      }
      man.koT = Math.max(0, man.koT - dt * 2);
      man.torch = dark && man.torchAtNight && !man.inside;
      man.stateT += dt;

      // --- what he sees -----------------------------------------------------
      let vis = 0;
      if (t && !t.hidden && !man.inside) {
        const eye = _eye.copy(man.pos); eye.y += man.sit > 0.5 ? 1.0 : 1.65;
        const d = eye.distanceTo(t.pos);
        const keen = man.state !== "calm";
        // Half asleep over his supper, or watching for it. Once something is
        // up he is looking properly.
        const attention = Math.max(ATTN[man.act] ?? 0.6, keen ? 1 : 0);
        if (d < reach && attention > 0) {
          const light = tLight;
          // How far he can see depends on how lit the dragon is: a few dozen
          // metres in the dark, the whole pit by day or over a fire — and the
          // weather takes its share.
          const range = reach * (0.12 + 0.88 * light) * haze;
          const toX = t.pos.x - eye.x, toZ = t.pos.z - eye.z;
          const flat = Math.hypot(toX, toZ);
          const bearing = Math.atan2(toX, toZ);
          const off = Math.abs(Math.atan2(Math.sin(bearing - man.yaw), Math.cos(bearing - man.yaw)));
          // A man who knows something is about looks wider; nobody has eyes
          // in the back of his head.
          const clear = keen ? FOV_CLEAR + 0.25 : FOV_CLEAR, edge = keen ? FOV_EDGE + 0.3 : FOV_EDGE;
          let fov = off < clear ? 1 : off < edge ? 0.35 * (1 - (off - clear) / (edge - clear)) : 0;
          // ...and he scans the ground, not the sky.
          const elev = Math.atan2(t.pos.y - eye.y, flat);
          // (A dragon overhead is big and moving, so it still catches the eye.)
          if (!keen && elev > LOOK_UP) fov *= 1 - (air ? 0.5 : 0.7) * THREE.MathUtils.smoothstep(elev, LOOK_UP, 1.2);
          // Right behind him, he hears it breathe.
          if (d < 5) fov = Math.max(fov, 0.5);
          // A man standing in firelight is blind to the dark beyond it.
          // (His own light changes slowly — he walks — so it is re-read about
          // once a second rather than every frame for every man.)
          if (dark && light < 0.3 && (man.lightT = (man.lightT ?? 0) - dt) <= 0) {
            man.ownLight = lightAt(eye, night);
            man.lightT = 0.8 + Math.random() * 0.4;
          }
          const dazzle = dark && light < 0.3 && (man.ownLight ?? 0) > 0.55 ? 0.4 : 1;
          // Heard rather than seen: wingbeats in the air, a gallop on the
          // ground. No facing needed, but he only knows roughly where.
          const loudR = t.grounded ? (t.noise ?? 0) : t.loud ? HEARING : 0;
          const heard = loudR > 0 && d < loudR ? 0.5 * (1 - d / loudR) : 0;
          let seen = 0;
          if ((d < range && fov > 0) || heard > 0) {
            // The sight line is a few dozen height and wood samples; the
            // dragon moves a few metres between checks at four a second,
            // which nobody can see.
            if ((man.losT = (man.losT ?? 0) - dt) <= 0) {
              man.trans = sightLine(eye, t.pos);
              man.losT = 0.2 + Math.random() * 0.1;
            }
            man.los = man.trans > 0;
            if (man.los && d < range) {
              // A shape against the sky fades out with distance more slowly
              // than one against rock and scrub.
              const near = d < 10 ? 1 : Math.pow(Math.max(0, 1 - (d - 10) / (range - 10)), air ? 1 : 1.4);
              seen = light * fov * near * size * motion * man.trans * dazzle;
            }
          }
          vis = (seen * 1.7 + heard * (man.los ? 1 : 0.6)) * attention;
          if (heard > 0 && seen < 0.05 && man.awareness < NOTICE) notice(man, t.pos, man.awareness);
        }
      }
      man.vis = vis;
      const sees = vis > 0.12;
      man.awareness += (vis * RATE - (sees ? 0 : man.state === "alert" ? FORGET * 0.6 : FORGET)) * dt;
      man.awareness = THREE.MathUtils.clamp(man.awareness, 0, 1.6);
      if (sees) { man.poi.copy(t.pos); man.hasPoi = true; man.lostT = 0; } else man.lostT += dt;

      // --- what he makes of it ------------------------------------------------
      // calm -> suspicious (stop, turn, "?") -> investigate (walk to where it
      // was) -> search (poke about) -> give up; or, if the meter fills, alert.
      // Dim on purpose: he gives up quickly, he looks where it WAS, and a
      // noise somewhere else is more interesting than a shadow he half saw.
      const was = man.state;
      if (man.awareness >= 1 && sees) {
        man.state = "alert";
      } else if (man.state === "alert") {
        if (man.awareness < 1) {
          man.state = (man.mobile ??= mobileNow(man)) ? "investigate" : "suspicious";
          man.stateT = 0;
        }
      } else if (man.state === "calm") {
        if (man.awareness >= NOTICE) { man.state = "suspicious"; man.stateT = 0; if (!man.hasPoi && t) man.poi.copy(t.pos); }
      } else if (man.state === "suspicious") {
        if (man.awareness < 0.1 && man.stateT > 1) man.state = "calm";
        else if (!sees && man.stateT > 1.8) {
          man.mobile ??= mobileNow(man);
          if (man.mobile && man.pos.distanceTo(man.poi) > 4) { man.state = "investigate"; man.stateT = 0; }
          else if (man.stateT > 4.5) { man.state = "calm"; man.awareness = Math.min(man.awareness, 0.15); }
        }
      } else if (man.state === "investigate") {
        // He keeps the meter up while he is going to look; he is not going to
        // forget on the way.
        man.awareness = Math.max(man.awareness, 0.32);
        if (man.stateT > INVESTIGATE_MAX || man.arrived) {
          man.state = "search"; man.stateT = 0; man.arrived = false;
          man.searchYaw = man.yaw; man.searchFor = rand(...SEARCH_TIME);
        }
      } else if (man.state === "search") {
        man.awareness = Math.max(man.awareness, 0.3 * (1 - man.stateT / man.searchFor));
        if (man.stateT > man.searchFor) {
          // Must have been the wind. Back to it.
          man.state = "calm"; man.awareness = 0; man.hasPoi = false;
          man.steps.length = 0; man.path.length = 0; man.planned = false;
        }
      }
      if (man.state === "alert") {
        alarm = ALARM_TIME;
        lastSeenAt.copy(t.pos);
        man.alerted = 2;
        if (was !== "alert") {
          seenNow.push(man);
          // He shouts, and the men in earshot come to look — at where he
          // says it is, not where it is by the time they get there.
          for (const o of men) {
            if (o === man || o.ko > 0 || o.state === "alert") continue;
            const dd = o.pos.distanceTo(man.pos);
            if (o.inside ? o.home.door.distanceTo(man.pos) < WAKE_RANGE : dd < SHOUT) {
              notice(o, t.pos, 0.75);
              o.state = "suspicious"; o.stateT = 0;
            }
          }
        }
      }

      // --- what he does about it ----------------------------------------------
      man.arrived = false;
      if (man.state === "calm") {
        live(man, dt, false);
      } else if (man.inside || man.state === "suspicious" || man.state === "alert") {
        // Stop everything and look. The sleepers come out first.
        live(man, dt, true);
      } else {
        man.moving = false;
        man.act = "roused";
        if (man.state === "investigate") {
          if (!walkToward(man, man.poi, dt, man.speed * 1.2)) man.arrived = true;
        } else {
          // Searching: turns this way and that, takes a step or two.
          man.wantYaw = man.searchYaw + Math.sin(man.stateT * 1.25 + man.phase) * 1.5;
        }
      }
      let wantYaw = man.wantYaw;
      if ((man.state === "suspicious" || man.state === "alert") && !man.inside) {
        const look = man.state === "alert" && sees ? t.pos : man.poi;
        wantYaw = Math.atan2(look.x - man.pos.x, look.z - man.pos.z);
      }
      const dy = Math.atan2(Math.sin(wantYaw - man.yaw), Math.cos(wantYaw - man.yaw));
      const turnRate = man.state === "alert" ? 8 : man.state === "suspicious" ? 2.2 : 3;
      man.yaw += dy * Math.min(1, dt * turnRate);
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

    // The vision fans, nearest men first.
    let nc = 0;
    if (coneFocus && coneShow > 0.01) {
      const near = [];
      for (const man of men) {
        if (man.ko > 0 || man.inside) continue;
        const d = man.pos.distanceTo(coneFocus);
        if (d < 90) near.push([d, man]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [, man] of near) {
        if (nc >= CONES) break;
        _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, man.yaw);
        _pos.copy(man.pos); _pos.y += 0.3;
        _m.compose(_pos, _q, _v.set(CONE_LEN, 1, CONE_LEN));
        cones.setMatrixAt(nc, _m);
        cones.setColorAt(nc, man.state === "alert" ? CONE_COLOUR.alert : man.state === "calm" ? CONE_COLOUR.calm : CONE_SUS);
        nc++;
      }
    }
    cones.count = nc;
    coneMat.uniforms.uOpacity.value = 0.3 * coneShow;
    if (nc) { cones.instanceMatrix.needsUpdate = true; cones.instanceColor.needsUpdate = true; }
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
    raiseAlarm(at) {
      alarm = ALARM_TIME;
      if (at) lastSeenAt.copy(at);
      for (const m of men) if (!m.inside && m.ko === 0) { notice(m, at ?? lastSeenAt, 0.75); m.state = "suspicious"; m.stateT = 0; }
    },
    /**
     * A noise at `at` — a blast going off, something falling. Every man in
     * earshot who is not already on to the dragon stops and looks that way,
     * then goes to see. It is the point of the noise he goes to, not the
     * dragon, which is how a shot into the rocks pulls a guard off his post.
     * Returns how many came to look.
     */
    noise(at, radius = 110) {
      let n = 0;
      for (const m of men) {
        if (m.ko > 0 || m.state === "alert") continue;
        const d = m.inside ? m.home.door.distanceTo(at) : m.pos.distanceTo(at);
        if (d > (m.inside ? radius * 0.5 : radius)) continue;
        // Not quite where it was: a bang in a rock bowl comes off the walls.
        _w.set(at.x + (Math.random() - 0.5) * d * 0.08, at.y, at.z + (Math.random() - 0.5) * d * 0.08);
        notice(m, _w, Math.max(NOTICE + 0.05, 0.6 * (1 - d / radius) + NOTICE));
        m.state = "suspicious"; m.stateT = Math.random() * 0.6;
        n++;
      }
      return n;
    },
    /** The vision fans: round `pos`, faded in while `show` (he is on foot, or
     *  aiming), out otherwise. */
    setConeFocus(pos, show, dt = 0.016) {
      coneFocus = pos;
      coneShow += ((show ? 1 : 0) - coneShow) * Math.min(1, dt * 3);
    },
    /** What blocks a sight line besides the ground: (from, to) => bool. */
    setOccluder(fn) { occluder = fn; },
    /** Debug: how much of the dragon a man would see from where he stands. */
    sightLine: (from, to) => sightLine(from, to),
    /** The hour he last read, and what a man is doing — for the console. */
    get hour() { return hour; },
    lightAt: (p, night) => lightAt(p, night),
    calm() {
      alarm = 0;
      for (const m of men) {
        m.awareness = 0; m.hasPoi = false; m.lostT = 99;
        if (m.state !== "calm") { m.state = "calm"; m.steps.length = 0; m.path.length = 0; }
      }
      arrows.length = 0;
    },
    clearArrows() { arrows.length = 0; },
    setVisible(v) { group.visible = v; },
  };
}
