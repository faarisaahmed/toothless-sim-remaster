import * as THREE from "three";

// ---------------------------------------------------------------------------
// Hiccup's house, inside.
//
// The prologue's room was four flat brown planes and a firepit: a cell. A Berk
// house is the opposite — a timber longhouse, every surface worked and used:
//
//   - floor of broad, worn planks; walls of upright boards standing on a
//     dry-stone plinth; heavy hewn posts carrying a beam down the room and
//     rafters up into a smoke-darkened roof, with a smoke hole at the ridge;
//   - a stone-kerbed hearth with a cauldron on an iron tripod;
//   - a sleeping loft over the back of the room on posts, with a ladder;
//   - the life of the place on the walls and along them: round shields,
//     an axe and a hammer, shelves of pots and jars, barrels and crates,
//     a work table under Hiccup's sketches, candles, hanging herbs and rope,
//     furs and a woven rug.
//
// The surfaces are photographs (Poly Haven, CC0, assets/textures/house), mapped
// in metres so nothing stretches. Everything is kept against the walls, out of
// the floor he walks on. buildLonghouse() returns the materials the prologue
// shares and a few things it animates (candle flames).
// ---------------------------------------------------------------------------

const BASE = "./assets/textures/house/";
const loader = new THREE.TextureLoader();
const cache = new Map();

function load(file, srgb) {
  if (cache.has(file)) return cache.get(file);
  const users = [];
  const t = loader.load(BASE + file, () => { for (const u of users) u.needsUpdate = true; });
  t.userData.users = users;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(file, t);
  return t;
}

/**
 * A PBR material from one of the house sets, tiled so one repeat covers `tile`
 * metres on a surface `w` x `h` metres.
 */
export function houseMat(slug, w, h, tile, { tint = 0xffffff, rot = 0, rough = 1, normal = 1 } = {}) {
  // A new Texture sharing the photograph's Source, rather than clone(), which
  // flags an upload before the image has arrived.
  const rep = (t) => {
    const c = new THREE.Texture();
    c.source = t.source;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.anisotropy = t.anisotropy;
    c.colorSpace = t.colorSpace;
    c.repeat.set(w / tile, h / tile);
    if (t.image) c.needsUpdate = true; else t.userData.users.push(c);
    c.rotation = rot;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    map: rep(load(`${slug}_diff.jpg`, true)),
    normalMap: rep(load(`${slug}_nor_gl.jpg`, false)),
    normalScale: new THREE.Vector2(normal, normal),
    roughnessMap: rep(load(`${slug}_arm.jpg`, false)),
    aoMap: rep(load(`${slug}_arm.jpg`, false)),
    color: tint, roughness: rough, metalness: 0,
  });
}

/** A box whose faces carry the texture in metres (so a 4 m beam is not one stretched plank). */
export function box(w, h, d, slug, tile, opts = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  // Rescale each face's UVs to its own size in metres.
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const [fu, fv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * fu / tile, uv.getY(i) * fv / tile);
  }
  g.setAttribute("uv2", uv.clone());
  const m = new THREE.Mesh(g, houseMat(slug, 1 * tile, 1 * tile, tile, opts));
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A Viking round shield: painted boards, an iron rim and boss. */
function shield(r, colours, seed) {
  const g = new THREE.Group();
  const t = canvasTex(256, 256, (c, W) => {
    c.fillStyle = colours[0]; c.fillRect(0, 0, W, W);
    // Painted pattern: quarters, or a band, or a cross.
    c.fillStyle = colours[1];
    const k = seed % 3;
    if (k === 0) { c.beginPath(); c.moveTo(W / 2, W / 2); c.arc(W / 2, W / 2, W, 0, Math.PI / 2); c.fill(); c.beginPath(); c.moveTo(W / 2, W / 2); c.arc(W / 2, W / 2, W, Math.PI, Math.PI * 1.5); c.fill(); }
    else if (k === 1) c.fillRect(W * 0.38, 0, W * 0.24, W);
    else { c.fillRect(W * 0.42, 0, W * 0.16, W); c.fillRect(0, W * 0.42, W, W * 0.16); }
    // Boards and wear.
    c.globalAlpha = 0.25; c.strokeStyle = "#1a120a"; c.lineWidth = 2;
    for (let x = 0; x < W; x += W / 7) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, W); c.stroke(); }
    c.globalAlpha = 0.18;
    for (let i = 0; i < 300; i++) { c.fillStyle = Math.random() < 0.5 ? "#000" : "#d8c8a8"; c.fillRect(Math.random() * W, Math.random() * W, 2 + Math.random() * 6, 1 + Math.random() * 2); }
    c.globalAlpha = 1;
  });
  const face = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 28), [
    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }),
  ]);
  face.rotation.x = Math.PI / 2;
  g.add(face);
  const iron = new THREE.MeshStandardMaterial({ color: 0x55524e, roughness: 0.45, metalness: 0.75 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 32), iron);
  g.add(rim);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), iron);
  boss.rotation.x = Math.PI / 2;
  boss.position.z = 0.02;
  g.add(boss);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** A coopered barrel: staves, iron hoops. */
function barrel(h, r) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(Math.PI * t)), t * h)); }
  const lathe = new THREE.LatheGeometry(pts, 18);
  const m = new THREE.Mesh(lathe, houseMat("old_planks_02", 1, 1, 0.9, { tint: 0xb89a7a }));
  m.material.map.repeat.set(2.4, 1); m.material.normalMap.repeat.set(2.4, 1);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(r * 0.86, 18), houseMat("dark_wooden_planks", 1, 1, 1));
  lid.rotation.x = -Math.PI / 2; lid.position.y = h - 0.01;
  g.add(lid);
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.55, metalness: 0.7 });
  for (const t of [0.12, 0.5, 0.88]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(r * (0.86 + 0.14 * Math.sin(Math.PI * t)) + 0.006, 0.012, 4, 24), iron);
    hoop.rotation.x = Math.PI / 2; hoop.position.y = t * h;
    g.add(hoop);
  }
  return g;
}

/** Clay pots and jars, a little uneven. */
function pot(h, r, colour) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const rr = r * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (t > 0.85 ? 0.72 : 1) + 0.01;
    pts.push(new THREE.Vector2(rr, t * h));
  }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 14),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A candle with a flame that the caller flickers. */
function candle(h) {
  const g = new THREE.Group();
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, h, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x3a2008, emissiveIntensity: 0.4 }));
  wax.position.y = h / 2;
  g.add(wax);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  flame.scale.set(1, 2.2, 1);
  flame.position.y = h + 0.045;
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

/** Hiccup's sketches: dragons, a tail rig, the saddle — ink on parchment. */
function sketch(seed, kind) {
  return canvasTex(256, 320, (c, W, H) => {
    const grad = c.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#d9c79c"); grad.addColorStop(1, "#c4ad80");
    c.fillStyle = grad; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(60,40,22,.85)"; c.lineWidth = 2; c.lineCap = "round";
    const r = (() => { let s = seed; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
    if (kind === 0) {
      // A dragon in profile: body, wing, tail.
      c.beginPath(); c.ellipse(W * 0.5, H * 0.55, W * 0.28, H * 0.08, -0.1, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(W * 0.45, H * 0.5); c.quadraticCurveTo(W * 0.3, H * 0.15, W * 0.7, H * 0.3); c.lineTo(W * 0.55, H * 0.5); c.stroke();
      c.beginPath(); c.moveTo(W * 0.78, H * 0.55); c.quadraticCurveTo(W * 0.95, H * 0.62, W * 0.9, H * 0.8); c.stroke();
      c.beginPath(); c.arc(W * 0.24, H * 0.52, 14, 0, Math.PI * 2); c.stroke();
    } else if (kind === 1) {
      // The tail rig: a fin, hinges, cords.
      c.beginPath(); c.moveTo(W * 0.2, H * 0.3); c.lineTo(W * 0.8, H * 0.45); c.lineTo(W * 0.25, H * 0.75); c.closePath(); c.stroke();
      for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(W * 0.2, H * 0.3 + i * 15); c.lineTo(W * (0.6 + i * 0.05), H * 0.48 + i * 6); c.stroke(); }
      c.beginPath(); c.arc(W * 0.2, H * 0.52, 10, 0, Math.PI * 2); c.stroke();
    } else {
      // Notes and measurements.
      c.lineWidth = 1.4;
      for (let y = 30; y < H - 20; y += 18) { c.beginPath(); c.moveTo(20, y); for (let x = 20; x < W - 30; x += 8) c.lineTo(x, y + (r() - 0.5) * 3); c.stroke(); }
      c.beginPath(); c.rect(W * 0.55, H * 0.55, W * 0.3, H * 0.25); c.stroke();
    }
    c.globalAlpha = 0.12;
    for (let i = 0; i < 400; i++) { c.fillStyle = "#3a2810"; c.fillRect(r() * W, r() * H, 2, 2); }
  });
}

/**
 * Hiccup's chart: the islands he knows inked in the middle, a compass, notes —
 * and parchment going blank toward every edge, because nobody has been there.
 */
export function chartTexture() {
  return canvasTex(1024, 720, (c, W, H) => {
    const g = c.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, "#e2d2a8"); g.addColorStop(1, "#b89a68");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    let s = 7; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    // Islands: wobbly closed coastlines, hatched inside, fading out to the edges.
    const isl = [[0.5, 0.5, 70], [0.38, 0.42, 34], [0.6, 0.38, 28], [0.62, 0.62, 40], [0.42, 0.64, 24], [0.3, 0.55, 18], [0.7, 0.5, 16]];
    for (const [ix, iy, rad] of isl) {
      const cx = ix * W, cy = iy * H;
      const fade = 1 - Math.min(1, Math.hypot(ix - 0.5, iy - 0.5) * 2.2);
      c.strokeStyle = `rgba(58,38,20,${0.55 + fade * 0.4})`; c.lineWidth = 2.2;
      c.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
        const rr = rad * (0.75 + 0.45 * Math.sin(a * 3 + ix * 9) * 0.4 + r() * 0.25);
        const x = cx + Math.cos(a) * rr * 1.3, y = cy + Math.sin(a) * rr;
        a === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.closePath(); c.stroke();
      c.lineWidth = 1; c.strokeStyle = "rgba(58,38,20,.25)";
      for (let k = -rad; k < rad; k += 6) { c.beginPath(); c.moveTo(cx - rad + k, cy - rad * 0.4); c.lineTo(cx + k, cy + rad * 0.4); c.stroke(); }
    }
    // Berk, labelled.
    c.fillStyle = "rgba(58,38,20,.85)"; c.font = "italic 26px Georgia, serif"; c.fillText("Berk", W * 0.47, H * 0.53);
    // A compass rose low left, and a few unsure dotted routes that stop.
    c.strokeStyle = "rgba(58,38,20,.7)"; c.lineWidth = 1.5;
    const ox = W * 0.16, oy = H * 0.78;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, L = k % 2 ? 26 : 46; c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + Math.sin(a) * L, oy - Math.cos(a) * L); c.stroke(); }
    c.fillText("N", ox - 8, oy - 54);
    c.setLineDash([6, 8]);
    for (const [a, L] of [[0.6, 210], [2.4, 180], [4.0, 240], [5.4, 160]]) {
      c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(W / 2 + Math.cos(a) * L * 1.4, H / 2 + Math.sin(a) * L); c.stroke();
      c.fillText("?", W / 2 + Math.cos(a) * (L * 1.4 + 18), H / 2 + Math.sin(a) * (L + 14));
    }
    c.setLineDash([]);
    // Stains and wear.
    c.globalAlpha = 0.12;
    for (let i = 0; i < 2500; i++) { c.fillStyle = r() < 0.5 ? "#3a2410" : "#f0e0b8"; c.fillRect(r() * W, r() * H, 2 + r() * 3, 1 + r() * 2); }
    c.globalAlpha = 1;
  });
}

/**
 * @param {THREE.Group} room
 * @param {{w, d, h}} ROOM
 * @returns materials the prologue shares, and update(t) for the candles
 */
export function buildLonghouse(room, ROOM) {
  const W = ROOM.w, D = ROOM.d, H = ROOM.h;
  const flames = [];

  // --- Floor -----------------------------------------------------------------
  const floorMat = houseMat("weathered_brown_planks", W, D, 2.2, { tint: 0xd8c4a8 });
  floorMat.map.rotation = floorMat.normalMap.rotation = Math.PI / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.geometry.setAttribute("uv2", floor.geometry.attributes.uv);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);

  // --- Walls: dry-stone plinth, upright boards above ---------------------------
  const PLINTH = 0.85;
  const wallSpecs = [
    [W, 0, -D / 2, 0], [W, 0, D / 2, Math.PI], [D, -W / 2, 0, Math.PI / 2], [D, W / 2, 0, -Math.PI / 2],
  ];
  for (const [len, x, z, ry] of wallSpecs) {
    const stone = new THREE.Mesh(new THREE.BoxGeometry(len, PLINTH, 0.35), houseMat("stone_wall", len, PLINTH, 1.6, { tint: 0xbcb4a8 }));
    stone.geometry.setAttribute("uv2", stone.geometry.attributes.uv);
    stone.position.set(x, PLINTH / 2, z); stone.rotation.y = ry;
    // Pull it in a touch so it stands proud of the boards.
    stone.translateZ(0.12);
    stone.castShadow = stone.receiveShadow = true;
    room.add(stone);
    const boardsH = H - PLINTH;
    const boards = new THREE.Mesh(new THREE.PlaneGeometry(len, boardsH), houseMat("old_planks_02", len, boardsH, 1.8, { tint: 0xc8a888 }));
    boards.geometry.setAttribute("uv2", boards.geometry.attributes.uv);
    boards.position.set(x, PLINTH + boardsH / 2, z); boards.rotation.y = ry;
    boards.receiveShadow = true;
    room.add(boards);
    // A rail where the boards meet the stone.
    const rail = box(len, 0.14, 0.12, "rough_wood", 1.4, { tint: 0x9a8068 });
    rail.position.set(x, PLINTH + 0.07, z); rail.rotation.y = ry; rail.translateZ(0.08);
    room.add(rail);
  }

  // --- Roof: smoke-dark boards on rafters, a ridge beam, a smoke hole -------
  const PITCH = 0.62, halfW = W / 2;
  const slopeLen = halfW / Math.cos(PITCH);
  const ridgeY = H + Math.tan(PITCH) * halfW;
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(slopeLen, D);
    g.setAttribute("uv2", g.attributes.uv);
    g.rotateX(-Math.PI / 2);
    g.rotateZ(-s * PITCH);
    const m = new THREE.Mesh(g, houseMat("dark_wooden_planks", slopeLen, D, 2.0, { tint: 0x6a5a4a }));
    m.material.side = THREE.DoubleSide;
    m.position.set(s * halfW / 2, (ridgeY + H) / 2, 0);
    m.receiveShadow = true;
    room.add(m);
  }
  // Gable ends.
  for (const z of [-D / 2, D / 2]) {
    const shape = new THREE.Shape([new THREE.Vector2(-halfW, H), new THREE.Vector2(halfW, H), new THREE.Vector2(0, ridgeY)]);
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.8, uv.getY(i) / 1.8);
    g.setAttribute("uv2", uv);
    const m = new THREE.Mesh(g, houseMat("old_planks_02", 1.8, 1.8, 1.8, { tint: 0xa88a70 }));
    m.material.side = THREE.DoubleSide;
    m.position.z = z;
    room.add(m);
  }
  const ridge = box(0.32, 0.36, D + 0.4, "rough_wood", 1.6, { tint: 0x8a7058 });
  ridge.position.set(0, ridgeY - 0.25, 0);
  room.add(ridge);
  // Rafters, every 1.3 m.
  for (let z = -D / 2 + 0.4; z <= D / 2 - 0.3; z += 1.3) {
    for (const s of [-1, 1]) {
      const r = box(0.16, 0.2, slopeLen + 0.3, "rough_wood", 1.4, { tint: 0x7a6250 });
      r.rotation.y = Math.PI / 2;
      r.rotation.x = 0;
      r.rotation.z = 0;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * PITCH));
      r.quaternion.premultiply(q);
      r.position.set(s * halfW / 2, (ridgeY + H) / 2 - 0.16, z);
      room.add(r);
    }
  }
  // Tie beams across, and the long wall plates.
  for (const z of [-4.2, -0.6, 3.0]) {
    const tb = box(W - 0.1, 0.32, 0.3, "rough_wood", 1.6, { tint: 0x8a7058 });
    tb.position.set(0, H - 0.18, z);
    room.add(tb);
  }
  for (const x of [-halfW + 0.2, halfW - 0.2]) {
    const plate = box(0.28, 0.28, D, "rough_wood", 1.6, { tint: 0x8a7058 });
    plate.position.set(x, H - 0.1, 0);
    room.add(plate);
  }
  // Posts under the tie beams, against the long walls, with carved caps.
  for (const z of [-4.2, -0.6, 3.0]) {
    for (const x of [-halfW + 0.35, halfW - 0.35]) {
      const post = box(0.34, H, 0.34, "rough_wood", 1.6, { tint: 0x8a7058 });
      post.position.set(x, H / 2, z);
      room.add(post);
      const cap = box(0.5, 0.22, 0.5, "rough_wood", 1, { tint: 0x6a5240 });
      cap.position.set(x, H - 0.45, z);
      room.add(cap);
    }
  }
  // Smoke hole: an opening at the ridge over the hearth, faint sky through it.
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9),
    new THREE.MeshBasicMaterial({ color: 0x1a2a48 }));
  hole.position.set(-0.9, ridgeY - 0.35, -0.5);
  hole.rotation.set(-Math.PI / 2 + 0.6, 0, 0);
  room.add(hole);

  // --- Sleeping loft over the back of the room ------------------------------
  // Over the back-left half only, so the chart on the back wall stays clear.
  const LOFT_Y = 2.6, LOFT_D = 3.1;
  const LX0 = -halfW + 0.3, LX1 = -0.7, LW = LX1 - LX0, LXC = (LX0 + LX1) / 2;
  const loft = box(LW, 0.16, LOFT_D, "weathered_brown_planks", 2.0, { tint: 0xb89a7c });
  loft.position.set(LXC, LOFT_Y, -D / 2 + LOFT_D / 2 + 0.05);
  room.add(loft);
  for (const x of [LX0 + 0.2, LX1 - 0.15]) {
    const p = box(0.26, LOFT_Y, 0.26, "rough_wood", 1.4, { tint: 0x8a7058 });
    p.position.set(x, LOFT_Y / 2, -D / 2 + LOFT_D);
    room.add(p);
  }
  const lrail = box(LW, 0.1, 0.1, "rough_wood", 1.4, { tint: 0x8a7058 });
  lrail.position.set(LXC, LOFT_Y + 0.75, -D / 2 + LOFT_D + 0.02);
  room.add(lrail);
  // ...and along its open side.
  const srail = box(0.1, 0.1, LOFT_D, "rough_wood", 1.4, { tint: 0x8a7058 });
  srail.position.set(LX1, LOFT_Y + 0.75, -D / 2 + LOFT_D / 2);
  room.add(srail);
  for (let x = LX0 + 0.5; x < LX1; x += 0.9) {
    const b = box(0.06, 0.75, 0.06, "rough_wood", 1, { tint: 0x8a7058 });
    b.position.set(x, LOFT_Y + 0.38, -D / 2 + LOFT_D + 0.02);
    room.add(b);
  }
  // Ladder up to it, leaning on the right side.
  const ladder = new THREE.Group();
  for (const sx of [-0.25, 0.25]) {
    const rail = box(0.07, LOFT_Y + 0.9, 0.07, "rough_wood", 1, { tint: 0x9a8068 });
    rail.position.set(sx, (LOFT_Y + 0.9) / 2, 0);
    ladder.add(rail);
  }
  for (let y = 0.35; y < LOFT_Y + 0.6; y += 0.38) {
    const rung = box(0.5, 0.05, 0.05, "rough_wood", 1, { tint: 0x9a8068 });
    rung.position.set(0, y, 0);
    ladder.add(rung);
  }
  ladder.position.set(LX1 - 0.9, 0, -D / 2 + LOFT_D + 0.35);
  ladder.rotation.x = -0.28;
  room.add(ladder);
  // On the loft: a chest, a bundle of furs, a barrel.
  const chest = box(0.9, 0.5, 0.55, "dark_wooden_planks", 1, { tint: 0x9a7a60 });
  chest.position.set(LXC + 0.6, LOFT_Y + 0.33, -D / 2 + 0.6);
  room.add(chest);
  const lb = barrel(0.8, 0.3); lb.position.set(LX0 + 0.6, LOFT_Y + 0.08, -D / 2 + 0.55); room.add(lb);

  // --- Walls dressed ----------------------------------------------------------
  const SHIELDS = [
    [["#8a2a1e", "#d8c49a"], 0], [["#2a4a6a", "#c8b890"], 1], [["#d8c49a", "#3a5a3a"], 2], [["#5a3a22", "#c89a3a"], 0],
  ];
  // Along the right wall, high up.
  SHIELDS.forEach(([cols, k], i) => {
    const s = shield(0.42, cols, i * 7 + 3);
    s.position.set(halfW - 0.08, 3.4, -3.3 + i * 1.7);
    s.rotation.y = -Math.PI / 2;
    if (i === 2) s.position.z += 0.6;   // clear of the shutter
    room.add(s);
  });
  // An axe and a hammer crossed under the chart on the back wall.
  const iron = new THREE.MeshStandardMaterial({ color: 0x6a6762, roughness: 0.4, metalness: 0.8 });
  const haft = (len) => box(0.05, len, 0.05, "rough_wood", 0.6, { tint: 0xa0846a });
  for (const [x, rz, head] of [[-1.9, 0.5, "axe"], [-1.4, -0.5, "hammer"]]) {
    const g = new THREE.Group();
    const h = haft(1.0); g.add(h);
    const hd = head === "axe"
      ? new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 3, 1, false, 0, Math.PI), iron)
      : new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.12), iron);
    if (head === "axe") hd.rotation.x = Math.PI / 2;
    hd.position.y = 0.45;
    g.add(hd);
    g.position.set(x, 1.7, -D / 2 + 0.1);
    g.rotation.z = rz;
    room.add(g);
  }

  // Shelves on the left wall, between the posts, with pots and jars.
  const potCols = [0x7a4a30, 0x5a4a3a, 0x8a6a4a, 0x4a3a30, 0x9a7a5a];
  for (const [z0, y] of [[-3.2, 1.55], [-3.2, 2.2], [1.0, 1.6]]) {
    const shelf = box(0.36, 0.06, 1.8, "dark_wooden_planks", 1, { tint: 0xa08060 });
    shelf.position.set(-halfW + 0.3, y, z0);
    room.add(shelf);
    for (let k = 0; k < 5; k++) {
      const p = pot(0.18 + (k % 3) * 0.08, 0.08 + (k % 2) * 0.04, potCols[(k + Math.round(y * 3)) % potCols.length]);
      p.position.set(-halfW + 0.3, y + 0.03, z0 - 0.7 + k * 0.35);
      room.add(p);
    }
  }
  // Hanging herbs and a coil of rope from the tie beam by the left wall.
  const herbMat = new THREE.MeshStandardMaterial({ color: 0x5a6a3a, roughness: 1 });
  for (let k = 0; k < 5; k++) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 6), herbMat);
    h.position.set(-halfW + 0.9 + k * 0.32, H - 0.62, -0.6);
    h.rotation.x = Math.PI;
    room.add(h);
  }
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 20),
    new THREE.MeshStandardMaterial({ color: 0x9a8058, roughness: 1 }));
  rope.position.set(halfW - 0.12, 1.5, -4.6);
  rope.rotation.y = Math.PI / 2;
  room.add(rope);

  // Barrels and crates in the front-right corner.
  for (const [x, z, s] of [[halfW - 0.55, D / 2 - 0.6, 1], [halfW - 1.25, D / 2 - 0.55, 0.85], [halfW - 0.6, D / 2 - 1.35, 0.9]]) {
    const b = barrel(0.95 * s, 0.34 * s); b.position.set(x, 0, z); room.add(b);
  }
  const crate = box(0.7, 0.55, 0.6, "old_planks_02", 0.8, { tint: 0xb89878 });
  crate.position.set(halfW - 0.5, 0.28, D / 2 - 2.2);
  crate.rotation.y = 0.2;
  room.add(crate);
  const crate2 = box(0.5, 0.4, 0.45, "old_planks_02", 0.8, { tint: 0xa88868 });
  crate2.position.set(halfW - 0.55, 0.75, D / 2 - 2.2);
  crate2.rotation.y = -0.3;
  room.add(crate2);

  // Work table under the sketches on the right wall, back of the window.
  const table = new THREE.Group();
  const top = box(0.8, 0.08, 2.0, "dark_wooden_planks", 1.2, { tint: 0xb09070 });
  top.position.y = 0.95; table.add(top);
  for (const [dx, dz] of [[-0.32, -0.9], [0.32, -0.9], [-0.32, 0.9], [0.32, 0.9]]) {
    const leg = box(0.08, 0.95, 0.08, "rough_wood", 1, { tint: 0x9a8068 });
    leg.position.set(dx, 0.475, dz); table.add(leg);
  }
  // Papers, a pot of ink, tools.
  const paper = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.95 });
  for (let k = 0; k < 4; k++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.42), paper);
    p.rotation.set(-Math.PI / 2, 0, (k - 1.5) * 0.3);
    p.position.set(-0.05 + (k % 2) * 0.1, 1.0 + k * 0.002, -0.5 + k * 0.32);
    table.add(p);
  }
  const ink = pot(0.09, 0.05, 0x1a1a22); ink.position.set(0.2, 0.99, 0.6); table.add(ink);
  const tc = candle(0.22); tc.position.set(-0.2, 0.99, 0.8); table.add(tc); flames.push(tc);
  table.position.set(halfW - 0.55, 0, 4.4);
  room.add(table);
  // Hiccup's sketches pinned above it.
  [0, 1, 2, 0].forEach((kind, k) => {
    const sk = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.52),
      new THREE.MeshStandardMaterial({ map: sketch(17 + k * 31, kind), roughness: 0.95 }));
    sk.position.set(halfW - 0.03, 1.75 + (k % 2) * 0.55, 3.7 + k * 0.45);
    sk.rotation.set(0, -Math.PI / 2, (k - 1.5) * 0.06);
    room.add(sk);
  });

  // Candles on the loft posts and a shelf; their light is the prologue's lamp.
  for (const [x, y, z] of [[LX1 - 0.15, 1.45, -D / 2 + LOFT_D + 0.15], [LX0 + 0.2, 1.45, -D / 2 + LOFT_D + 0.15], [-halfW + 0.35, 2.29, -2.6]]) {
    const c = candle(0.18); c.position.set(x, y, z); room.add(c); flames.push(c);
    if (y < 2) {
      const bracket = box(0.14, 0.04, 0.14, "rough_wood", 1, { tint: 0x7a6250 });
      bracket.position.set(x, y - 0.02, z); room.add(bracket);
    }
  }

  // Woven rug by the hearth and furs by the slab.
  const rugTex = canvasTex(256, 384, (c, Wd, Hd) => {
    c.fillStyle = "#6a2a1e"; c.fillRect(0, 0, Wd, Hd);
    const bands = ["#c8a060", "#2a3a4a", "#d8c8a0", "#3a2a1a"];
    for (let y = 0; y < Hd; y += 24) { c.fillStyle = bands[(y / 24) % bands.length]; c.fillRect(0, y, Wd, 6); }
    c.strokeStyle = "#d8c8a0"; c.lineWidth = 3;
    for (let y = 40; y < Hd - 30; y += 48) { c.beginPath(); for (let x = 10; x < Wd; x += 24) { c.lineTo(x, y + ((x / 24) % 2 ? -10 : 10)); } c.stroke(); }
    c.globalAlpha = 0.25;
    for (let i = 0; i < 3000; i++) { c.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; c.fillRect(Math.random() * Wd, Math.random() * Hd, 1, 2); }
  });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.6), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(-2.6, 0.012, -0.4); rug.receiveShadow = true;
  room.add(rug);

  // Cauldron on a tripod over the hearth (the prologue owns the hearth at -5, -0.5).
  const tripod = new THREE.Group();
  const ironDark = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6, metalness: 0.7 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 6), ironDark);
    leg.position.set(Math.cos(a) * 0.55, 0.95, Math.sin(a) * 0.55);
    leg.lookAt(0, 2.2, 0); leg.rotateX(Math.PI / 2);
    tripod.add(leg);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 5), ironDark);
  chain.position.y = 1.4; tripod.add(chain);
  const caul = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.6), ironDark);
  caul.position.y = 0.95; caul.castShadow = true; tripod.add(caul);
  tripod.position.set(-5.0, 0, -0.5);
  room.add(tripod);

  return {
    /** Shared materials the prologue's own props use, now photographic. */
    mats: {
      beam: houseMat("rough_wood", 1, 1, 1, { tint: 0x9a8068 }),
      stone: houseMat("stone_wall", 1, 1, 0.8, { tint: 0xbcb4a8 }),
    },
    floor,
    loftY: LOFT_Y,
    update(t) {
      for (const f of flames) {
        const s = 1 + Math.sin(t * 13 + f.position.x * 7) * 0.12 + Math.sin(t * 29 + f.position.z) * 0.06;
        f.userData.flame.scale.set(s, 2.2 * s, s);
      }
    },
  };
}
