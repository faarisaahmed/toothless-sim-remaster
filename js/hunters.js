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
// SEEING. A man can see the dragon if nothing is in the way (the line is
// sampled against the height field — the pit walls and the rim hide a lot),
// if he is facing that way (an alerted man is looking everywhere), and if
// there is light to see by. By day there always is. By night it is the torches
// and braziers near the dragon, plus a little moonlight, which is the whole
// reason putting the lights out matters. Noise — powered flight, a fast pass —
// adds to it. What he sees fills an awareness meter:
//
//      0 .. 0.5   nothing
//      0.5 .. 1   "?" over his head; he turns to look
//      1+         "!" — he has him; he shouts, archers draw, and the island
//                 goes to ALARM for a while: every man is looking, and the
//                 ones who could not see him before now know roughly where.
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

const SIGHT = 520;           // m — nobody sees past this
const ARCHER_RANGE = 380;    // m — and nobody shoots past this
const ARROW_SPEED = 95;      // m/s
const ARROW_DAMAGE = 7;
const ALARM_TIME = 22;       // s the island stays roused after the last sighting

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

/**
 * @param {object} o
 *   scene, getHeightAt
 *   getLights()   [{pos: Vector3, lit: bool, r: number}] near the base
 *   onArrowHit(arrow) called when one lands on him
 */
export async function createHunters(scene, { getHeightAt, getLights = () => [], onArrowHit = () => {} } = {}) {
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

  let alarm = 0;
  let lastSeenAt = new THREE.Vector3();
  let time = 0;

  function meshFor(kit, part, cap) {
    const key = `${kit}/${part}`;
    if (meshes[key]) return meshes[key];
    const p = kits[kit]?.[part];
    if (!p) return null;
    const m = new THREE.InstancedMesh(p.geometry, material, cap);
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
   *   pos       where he stands (Vector3, on the ground or a deck)
   *   facing    radians, which way he looks when nothing is happening
   *   route     optional [Vector3...] he walks round, looping
   *   post      a name for the story ("tower 3")
   */
  function add({ kind = "spear", pos, facing = 0, route = null, post = "", ballista = null }) {
    const man = {
      kind, kit: kind === "archer" ? "dh_archer" : "dh_hunter",
      pos: (pos || route[0]).clone(), facing, yaw: facing, route, leg: 0, post, ballista,
      walk: 0, speed: 1.7 + Math.random() * 0.4,
      awareness: 0, state: "calm",
      reload: 1.5 + Math.random() * 2.5, draw: 0,
      ko: 0, koT: 0,
      alerted: 0,
      id: men.length,
    };
    if (route && route.length) man.pos.copy(route[0]);
    men.push(man);
    return man;
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
    // Daylight is everywhere; at night it is the fires near him, and the moon.
    let l = 1 - night * 0.82;
    for (const L of getLights()) {
      if (!L.lit) continue;
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
  /**
   * @param {object} t   the dragon: { pos, vel, loud, hidden }
   * @param {number} night  0 day .. 1 night
   */
  function update(dt, t, night = 0) {
    time += dt;
    alarm = Math.max(0, alarm - dt);
    const seenNow = [];

    for (const man of men) {
      if (man.ko > 0) {
        man.ko = Math.max(0, man.ko - dt);
        man.koT = Math.min(1, man.koT + dt * 3);
        if (man.ko === 0) man.awareness = 0.8;   // gets up wondering what hit him
        continue;
      }
      man.koT = Math.max(0, man.koT - dt * 2);

      // --- awareness --------------------------------------------------------
      let vis = 0;
      if (t && !t.hidden) {
        const eye = _v.copy(man.pos); eye.y += 1.65;
        const d = eye.distanceTo(t.pos);
        if (d < SIGHT) {
          const toX = t.pos.x - man.pos.x, toZ = t.pos.z - man.pos.z;
          const bearing = Math.atan2(toX, toZ);
          const off = Math.abs(Math.atan2(Math.sin(bearing - man.yaw), Math.cos(bearing - man.yaw)));
          const fov = man.awareness > 0.5 || alarm > 0 ? 1 : off < 1.3 ? 1 : 0.25;
          if (lineOfSight(eye, t.pos)) {
            const light = lightAt(t.pos, night);
            const noise = t.loud ? 0.55 : 0;
            const near = Math.pow(1 - d / SIGHT, 0.8);
            // Close enough and he cannot be missed, dark or not.
            const brush = d < 35 ? 1 : 0;
            vis = Math.min(1.5, Math.max(brush, (light * 0.85 + noise) * near * fov * 1.7));
          }
        }
      }
      const rise = vis > 0.12 ? vis * 1.4 : -0.35;
      man.awareness = THREE.MathUtils.clamp(man.awareness + rise * dt, alarm > 0 ? 0.55 : 0, 1.6);
      const was = man.state;
      man.state = man.awareness >= 1 ? "alert" : man.awareness >= 0.5 ? "suspicious" : "calm";
      if (man.state === "alert") {
        alarm = ALARM_TIME;
        lastSeenAt.copy(t.pos);
        man.alerted = 2;
        if (was !== "alert") seenNow.push(man);
      }

      // --- facing and moving ------------------------------------------------
      let wantYaw = man.facing;
      let moving = false;
      if (man.state !== "calm" && t) {
        const look = man.state === "alert" ? t.pos : lastSeenAt.lengthSq() > 0 ? lastSeenAt : t.pos;
        wantYaw = Math.atan2(look.x - man.pos.x, look.z - man.pos.z);
      } else if (man.route && man.route.length > 1) {
        const target = man.route[(man.leg + 1) % man.route.length];
        const dx = target.x - man.pos.x, dz = target.z - man.pos.z;
        const dl = Math.hypot(dx, dz);
        if (dl < 1.2) man.leg = (man.leg + 1) % man.route.length;
        else {
          const step = Math.min(dl, man.speed * dt);
          man.pos.x += (dx / dl) * step;
          man.pos.z += (dz / dl) * step;
          man.pos.y = target.y + (man.pos.y - target.y) * 0.9;
          if (getHeightAt) {
            const g = getHeightAt(man.pos.x, man.pos.z);
            if (Math.abs(g - man.pos.y) < 6) man.pos.y = g;
          }
          wantYaw = Math.atan2(dx, dz);
          moving = true;
        }
      }
      const dy = Math.atan2(Math.sin(wantYaw - man.yaw), Math.cos(wantYaw - man.yaw));
      man.yaw += dy * Math.min(1, dt * (man.state === "alert" ? 8 : 3));
      if (moving) man.walk += dt * man.speed * 3.2;
      else man.walk += (Math.round(man.walk / Math.PI) * Math.PI - man.walk) * Math.min(1, dt * 6);

      // --- archers shoot ----------------------------------------------------
      if (man.kind === "archer") {
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
  function draw() {
    const counts = {};
    for (const man of men) {
      const kit = man.kit;
      const parts = kits[kit];
      if (!parts) continue;
      // The whole man: stand him at his position, turned to his yaw, and
      // knocked flat if he has been.
      _q.setFromEuler(_e.set(-man.koT * Math.PI / 2, man.yaw, 0, "YXZ"));
      _m.compose(man.pos, _q, _s);
      const swing = Math.sin(man.walk);
      for (const pname of PARTS) {
        const p = parts[pname];
        if (!p) continue;
        const mesh = meshFor(kit, pname, 64);
        if (!mesh) continue;
        let rx = 0, rz = 0;
        if (pname === "leg_l") rx = swing * 0.55;
        else if (pname === "leg_r") rx = -swing * 0.55;
        else if (pname === "arm_l") {
          rx = -swing * 0.35;
          if (man.kind === "archer" && (man.state === "alert" || man.draw > 0)) {
            rx = -1.35; rz = 0.15;            // bow arm out in front
          } else if (man.state === "alert") rx = -0.9;
        } else if (pname === "arm_r") {
          rx = swing * 0.35;
          if (man.kind === "archer" && man.draw > 0) { rx = -1.2 - man.draw * 0.25; rz = -0.6 * man.draw; }
          else if (man.state === "alert" && man.kind === "spear") rx = -1.9;   // arm up to throw
        }
        _r.makeRotationFromEuler(_e.set(rx, 0, rz));
        _p.makeTranslation(p.pivot.x, p.pivot.y, p.pivot.z).multiply(_r);
        const i = counts[`${kit}/${pname}`] ?? 0;
        counts[`${kit}/${pname}`] = i + 1;
        if (i < mesh.instanceMatrix.count) mesh.setMatrixAt(i, _r.multiplyMatrices(_m, _p));
      }
    }
    for (const [key, mesh] of Object.entries(meshes)) {
      mesh.count = Math.min(counts[key] ?? 0, mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
    }

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
    get alarm() { return alarm; },
    get arrowsInFlight() { return arrows.filter((a) => !a.stuck).length; },
    /** The man nearest a point, within range, who is still standing. */
    nearest(p, range = 12) {
      let best = null, bd = range;
      for (const m of men) {
        if (m.ko > 0) continue;
        const d = m.pos.distanceTo(p);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    },
    /** Tail-strike: put a man down for a while. */
    knockOut(man, seconds = 45) { man.ko = seconds; man.awareness = 0; man.state = "calm"; },
    raiseAlarm(at) { alarm = ALARM_TIME; if (at) lastSeenAt.copy(at); for (const m of men) m.awareness = Math.max(m.awareness, 0.6); },
    calm() { alarm = 0; for (const m of men) m.awareness = 0; arrows.length = 0; },
    clearArrows() { arrows.length = 0; },
    setVisible(v) { group.visible = v; },
  };
}
