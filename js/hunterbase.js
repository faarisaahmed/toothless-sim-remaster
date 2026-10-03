import * as THREE from "three";
import { prop } from "./props.js";
import { mergeStatic, makeLightPool } from "./places.js";
import { makeOrb } from "./placeholder.js";
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
//
// The returned object keeps the shape the story already reads (braziers,
// cages, guards, litFraction), so the chapters drive it unchanged.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

export async function buildHunterBase(scene, { groundAt, seaLevel = 0 } = {}) {
  const L = pitLayout();
  const group = new THREE.Group();
  group.name = "dragon-hunter-base";
  scene.add(group);

  const names = ["rig_cage_large", "rig_cage_small", "rig_brazier", "rig_crane", "rig_crate",
    "rig_barrel", "rig_chain_coil", "rig_net_pile", "dh_watchtower", "dh_ballista", "dh_torch",
    "dh_forge", "dh_palisade", "dh_tent", "boat_supply", "berk_dock", "rig_mooring_post"];
  const P = Object.fromEntries(
    await Promise.all(names.map(async (n) => [n, await prop(n)])));
  // Some props were built for people; a dragon is eight and a half metres
  // long. A cage that holds one has to be built for one, and the smelter at
  // the heart of an industry is the size of a hall, not a kiln.
  const SCALE = { rig_cage_large: 2.3, rig_cage_small: 1.6, dh_forge: 2.0, rig_brazier: 1.8,
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
    orb.setPosition(x, gy + 4.0, z);
    orb.state.bob = 0.12; orb.state.pulse = 0.22; orb.state.pulseRate = 0.9;
    orb.group.scale.setScalar(2.0);
    group.add(orb.group);
    cages.push({
      obj: c, orb, open: false, pos: V(x, gy + 4.0, z),
      release() { if (this.open) return false; this.open = true; return true; },
      update(dt, camera) {
        this.orb.update(dt, camera);
        if (this.open) {
          this.orb.group.position.y += dt * 40;
          this.orb.group.scale.multiplyScalar(1 - dt * 0.3);
          if (this.orb.group.position.y > gy + 500) this.orb.group.visible = false;
        }
      },
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
      obj: c, orb, open: false, pos: V(x, gy + 2.2, z),
      release() { if (this.open) return false; this.open = true; return true; },
      update(dt, camera) {
        this.orb.update(dt, camera);
        if (this.open) {
          this.orb.group.position.y += dt * 40;
          this.orb.group.scale.multiplyScalar(1 - dt * 0.3);
          if (this.orb.group.position.y > gy + 500) this.orb.group.visible = false;
        }
      },
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
  }
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

  // --- the yard ---------------------------------------------------------------------
  for (const [a, r, yaw] of [[gateA + 1.2, L.floorR * 0.78, 0.6], [gateA - 1.6, L.floorR * 0.74, -1.1],
                             [gateA + Math.PI, L.floorR * 0.8, 2.2]]) {
    place(clone("rig_crane"), ...polar(a, r), yaw, 0);
  }
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * TAU, r = 28 + rnd() * (L.floorR - 36);
    if (Math.abs(r - L.floorR * 0.55 - 8) < 18) continue;   // keep the cage ring clear
    const [x, z] = polar(a, r);
    if (roughness(x, z) > 1.5) continue;
    const kind = i % 7 === 0 ? "rig_net_pile" : i % 5 === 0 ? "rig_chain_coil" : i % 3 ? "rig_crate" : "rig_barrel";
    place(clone(kind), x, z, rnd() * TAU, 0.02);
  }
  // Barracks: tents in rows on the channel side of the floor.
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 4; k++) {
      const a = gateA + (k - 1.5) * 0.16 + row * 0.08;
      const [x, z] = polar(a, L.floorR * 0.86 + row * 9);
      if (roughness(x, z) > 2) continue;
      place(clone("dh_tent"), x, z, -a, 0);
    }
  }

  // --- the spiral road: torches -------------------------------------------------------
  const torches = [];
  for (let k = 0; k < L.turns; k++) {
    for (let a = -Math.PI; a < Math.PI; ) {
      const p = L.roadAt(k, a);
      a += 30 / p.r;
      const gy = groundAt(p.x, p.z);
      if (gy < seaLevel + 4 || roughness(p.x, p.z) > 2.2) continue;
      // On the outer edge of the tread, against the wall.
      const ox = p.x + Math.cos(a) * 8, oz = p.z + Math.sin(a) * 8;
      if (Math.abs(groundAt(ox, oz) - gy) > 3) continue;
      const t = clone("dh_torch");
      place(t, ox, oz, 0, 0);
      torches.push({ pos: V(ox, groundAt(ox, oz) + 4.8, oz), lit: true, r: 26 });
    }
  }
  // And round the floor.
  for (let i = 0; i < 16; i++) {
    const [x, z] = polar(gateA + i * TAU / 16, L.floorR - 8);
    if (roughness(x, z) > 2) continue;
    place(clone("dh_torch"), x, z, 0, 0);
    torches.push({ pos: onGround(x, z, 4.8), lit: true, r: 26 });
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
  ];
  const hunters = await createHunters(scene, {
    getHeightAt: groundAt,
    getLights: lightList,
    onArrowHit: (a) => base.onArrowHit?.(a),
  });

  // Floor patrols: loops round the cage ring and through the yard.
  for (let i = 0; i < 8; i++) {
    const a0 = gateA + i * TAU / 8;
    const r = L.floorR * (i % 2 ? 0.4 : 0.75);
    const route = [];
    for (let k = 0; k <= 5; k++) route.push(onGround(...polar(a0 + k * 0.18, r + (k % 2) * 12)));
    for (let k = 5; k >= 0; k--) route.push(onGround(...polar(a0 + k * 0.18, r - 6)));
    hunters.add({ kind: "spear", route, post: "pit floor" });
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
      hunters.add({ kind: "spear", route: route.concat(back), post: `terrace ${k + 1}` });
    }
  }
  // Archers: one on every tower, a line along the top terrace, a few in the yard.
  for (const t of towers) {
    const yaw = Math.atan2(t.pos.x - cx, t.pos.z - cz);   // looking out
    hunters.add({ kind: "archer", pos: V(t.pos.x, t.pos.y + 7.9, t.pos.z), facing: yaw, post: "tower" });
  }
  for (let i = 0; i < 8; i++) {
    const a = gateA + 0.3 + i * TAU / 8;
    const p = L.roadAt(Math.min(2, L.turns - 1), Math.atan2(Math.sin(a), Math.cos(a)));
    if (roughness(p.x, p.z) > 2.5 || groundAt(p.x, p.z) < 8) continue;
    const yaw = Math.atan2(cx - p.x, cz - p.z) + (i % 2 ? Math.PI : 0);
    hunters.add({ kind: "archer", pos: onGround(p.x, p.z), facing: yaw, post: "terrace" });
  }
  for (let i = 0; i < 4; i++) {
    const [x, z] = polar(gateA + 0.4 + i * TAU / 4, L.floorR * 0.25);
    hunters.add({ kind: "archer", pos: onGround(x, z), facing: gateA + i, post: "yard" });
  }
  for (const b of ballistae) {
    const [x, z] = [b.pos.x - Math.cos(b.a) * 3, b.pos.z - Math.sin(b.a) * 3];
    hunters.add({ kind: "spear", pos: onGround(x, z), facing: Math.atan2(Math.cos(b.a), Math.sin(b.a)),
                  post: "ballista", ballista: b });
  }

  // The spearmen are the ones who throw bolas; main.js reads them as `guards`.
  const guards = hunters.men.filter((m) => m.kind === "spear");

  const lightPool = makeLightPool(group, 7, { color: 0xff8a3a, distance: 78, decay: 1.7 });
  const forgeLight = { pos: V(cx, floorY + 8, cz), intensity: 900, colour: 0xff7a2a };

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
                  ...braziers.map((b) => ({ pos: b.pos, src: b, k: 1.8 }))];
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
      const emitters = braziers.map((b) => ({ pos: b.local, intensity: b.lit ? b.intensity : 0 }));
      emitters.push(forgeLight);
      for (const tor of torches) emitters.push({ pos: tor.pos, intensity: tor.lit ? 90 : 0 });
      lightPool.update(camera, emitters);
    },
    setVisible(v) { group.visible = v; hunters.setVisible(v); },
    /** 0 day .. 1 night: how hard the glows burn. */
    setNight(n) { glowMat.uniforms.uNight.value = n; },
    dispose() { scene.remove(group); },
  };
  return base;
}
