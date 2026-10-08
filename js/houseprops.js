import * as THREE from "three";
import { houseMat, box, canvasTex } from "./longhouse.js";

// ---------------------------------------------------------------------------
// The three things in Hiccup's house the prologue makes you look at closely:
// his bed, Toothless's slab, and the saddle. They were a box, a disc and a
// half-sphere. Built here properly, from the same photographed surfaces as the
// house (longhouse.js) plus leather and linen.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;

function mesh(g, m, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = shadow; o.receiveShadow = true;
  return o;
}
const uv2 = (g) => { g.setAttribute("uv2", g.attributes.uv); return g; };
const ironMat = () => new THREE.MeshStandardMaterial({ color: 0x5e5a55, roughness: 0.38, metalness: 0.85 });

/** A rounded slab of material: an extruded rounded rectangle, bevelled. */
function rounded(w, d, h, r, bevel = 0.02) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  return uv2(g);
}

/** Fur: a canvas of fine strands, for pelts. Alpha at the ragged edge. */
let furCache = null;
function furTextures() {
  if (furCache) return furCache;
  const draw = (alphaOnly) => canvasTex(512, 512, (c, W, H) => {
    if (!alphaOnly) { c.fillStyle = "#6a5440"; c.fillRect(0, 0, W, H); }
    else { c.fillStyle = "#000"; c.fillRect(0, 0, W, H); }
    // Irregular hide outline: a body with four leg lobes and a ragged edge.
    const path = new Path2D();
    for (let a = 0; a <= TAU + 0.01; a += 0.04) {
      const legs = Math.pow(Math.abs(Math.sin(a * 2 + 0.785)), 6) * 0.22;
      const rag = (Math.sin(a * 37) + Math.sin(a * 53 + 1)) * 0.015;
      const r = 0.36 + legs + rag;
      const x = W / 2 + Math.cos(a) * r * W, y = H / 2 + Math.sin(a) * r * H * 0.9;
      a === 0 ? path.moveTo(x, y) : path.lineTo(x, y);
    }
    if (alphaOnly) { c.fillStyle = "#fff"; c.fill(path); return; }
    c.save(); c.clip(path);
    for (let i = 0; i < 26000; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      const dx = x - W / 2, dy = y - H / 2;
      const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.6;
      const L = 4 + Math.random() * 9;
      const v = 60 + Math.random() * 90;
      c.strokeStyle = `rgb(${v * 1.1}, ${v * 0.86}, ${v * 0.64})`;
      c.lineWidth = 0.8 + Math.random();
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); c.stroke();
    }
    // A darker saddle of fur along the spine.
    const g = c.createLinearGradient(W / 2 - 60, 0, W / 2 + 60, 0);
    g.addColorStop(0, "rgba(20,12,6,0)"); g.addColorStop(0.5, "rgba(20,12,6,.35)"); g.addColorStop(1, "rgba(20,12,6,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.restore();
  });
  const map = draw(false), alpha = draw(true);
  alpha.colorSpace = THREE.NoColorSpace;
  furCache = { map, alpha };
  return furCache;
}

/**
 * A pelt draped over whatever is under it: a subdivided plane, each vertex
 * dropped onto `heightAt(x, z)` (local), then a little thickness of fur.
 */
function pelt(size, heightAt, tint = 0xffffff, rotY = 0) {
  const { map, alpha } = furTextures();
  const g = new THREE.PlaneGeometry(size, size, 28, 28);
  g.rotateX(-Math.PI / 2);
  g.rotateY(rotY);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, heightAt(x, z) + 0.025 + Math.random() * 0.012);
  }
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({
    map, alphaMap: alpha, alphaTest: 0.5, color: tint, roughness: 1, side: THREE.DoubleSide,
  });
  return mesh(g, m);
}

// ===========================================================================
// The saddle
// ===========================================================================
/**
 * Toothless's saddle, on a saddle-horse: the leather seat on its padded base,
 * a raised cantle behind and a handle in front, the girth straps hanging down
 * each side with iron buckles and rings, stirrups, a saddlebag, and the long
 * cord that runs back to the tail rig, coiled over the horse.
 */
export function buildSaddle() {
  const g = new THREE.Group();
  const leather = houseMat("brown_leather", 1, 1, 0.5, { tint: 0xffffff });
  const leatherDark = houseMat("brown_leather", 1, 1, 0.4, { tint: 0xa88a72 });
  const iron = ironMat();

  // The saddle-horse: a beam on two A-frames.
  const beam = box(1.3, 0.12, 0.16, "rough_wood", 1, { tint: 0x9a8068 });
  beam.position.y = 0.92; g.add(beam);
  for (const x of [-0.5, 0.5]) {
    for (const s of [-1, 1]) {
      const leg = box(0.08, 1.0, 0.08, "rough_wood", 1, { tint: 0x8a7058 });
      leg.position.set(x, 0.46, s * 0.18);
      leg.rotation.x = s * 0.32;
      g.add(leg);
    }
    const brace = box(0.06, 0.06, 0.5, "rough_wood", 1, { tint: 0x8a7058 });
    brace.position.set(x, 0.3, 0); g.add(brace);
  }

  // The seat and the skirt under it are saddle surfaces: long along the
  // beam, dipping in the middle, rising to a pommel in front (+x) and a
  // cantle behind (-x), and draping down over both sides of the back.
  const saddleSurface = (len, wid, y0, rise, drape, segX = 32, segZ = 20, back = 1) => {
    const geo = new THREE.PlaneGeometry(len, wid, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i) / (len / 2), z = pp.getZ(i) / (wid / 2);
      const ends = x > 0 ? Math.pow(x, 4) : Math.pow(-x, 3) * back;   // cantle lower than pommel
      const y = y0 + rise * ends - drape * z * z * (1 - 0.3 * Math.abs(x));
      // Taper the outline toward the pommel, so it is a saddle and not a rug.
      pp.setZ(i, pp.getZ(i) * (1 - 0.35 * Math.max(0, x) ** 2));
      pp.setY(i, y);
    }
    geo.computeVertexNormals();
    return uv2(geo);
  };
  const leatherSide = leather.clone(); leatherSide.side = THREE.DoubleSide;
  const darkSide = leatherDark.clone(); darkSide.side = THREE.DoubleSide;
  // Skirt: the wide under-layer that lies on his back.
  const skirt = mesh(saddleSurface(1.0, 0.95, 1.0, 0.05, 0.42, 28, 18, 0.5), darkSide);
  g.add(skirt);
  // Seat: the padded upper layer, a hand's breadth above, with a quilted look
  // from the texture and a stitched seam round it.
  const seatTop = mesh(saddleSurface(0.86, 0.6, 1.07, 0.22, 0.14), leatherSide);
  g.add(seatTop);
  // Seat edge: the thickness between seat and skirt, as a band.
  const edgePts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48 * Math.PI * 2;
    const x = Math.cos(t) * 0.43, zN = Math.sin(t);
    const xn = x / 0.43;
    const ends = xn > 0 ? Math.pow(xn, 4) : Math.pow(-xn, 3);
    const z = zN * 0.3 * (1 - 0.35 * Math.max(0, xn) ** 2);
    const y = 1.07 + 0.22 * ends - 0.14 * zN * zN * (1 - 0.3 * Math.abs(xn));
    edgePts.push(new THREE.Vector3(x, y - 0.02, z));
  }
  const seam = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePts, true), 96, 0.018, 6, true), leatherDark);
  g.add(seam);
  // Handle in front: a curved iron bar wrapped in leather.
  const handle = mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 16, Math.PI), leatherDark);
  handle.position.set(0.4, 1.3, 0);
  handle.rotation.y = Math.PI / 2;
  g.add(handle);
  // Girth straps, buckles, rings and stirrups, both sides.
  for (const s of [-1, 1]) {
    for (const dx of [-0.2, 0.22]) {
      const strap = box(0.07, 0.62, 0.012, "brown_leather", 0.4, { tint: 0x7a563c });
      strap.position.set(dx, 0.72, s * 0.33);
      strap.rotation.x = s * 0.12;
      g.add(strap);
      const buckle = mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 4), iron);
      buckle.rotation.z = Math.PI / 4;
      buckle.position.set(dx, 0.62, s * 0.345);
      buckle.rotation.y = Math.PI / 2;
      g.add(buckle);
    }
    const ring = mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14), iron);
    ring.position.set(0.4, 1.02, s * 0.33);
    g.add(ring);
    // Stirrup: a leather drop and an iron loop.
    const drop = box(0.045, 0.32, 0.01, "brown_leather", 0.4, { tint: 0x7a563c });
    drop.position.set(0.02, 0.86, s * 0.37);
    g.add(drop);
    const stirrup = mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16, Math.PI * 1.3), iron);
    stirrup.rotation.set(0, Math.PI / 2, Math.PI * 1.35);
    stirrup.position.set(0.02, 0.66, s * 0.37);
    g.add(stirrup);
  }
  // Saddlebag on one side, flap buckled down.
  const bag = mesh(rounded(0.3, 0.12, 0.26, 0.05, 0.02), leatherDark);
  bag.rotation.x = Math.PI / 2;
  bag.position.set(-0.26, 0.95, -0.44);
  g.add(bag);
  // The tail cord, coiled over the beam's end.
  const cord = mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 30), new THREE.MeshStandardMaterial({ color: 0x8a7050, roughness: 1 }));
  cord.position.set(-0.58, 0.85, 0.05);
  cord.rotation.y = Math.PI / 2;
  g.add(cord);
  // A lantern on a hook above it: the saddle is the thing he comes back to.
  const lantern = new THREE.Group();
  const cage = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.22, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.5, metalness: 0.7, wireframe: true }), false);
  lantern.add(cage);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc27a }));
  lantern.add(glow);
  const light = new THREE.PointLight(0xffb062, 4.2, 6, 1.6);
  lantern.add(light);
  lantern.position.set(0.1, 2.2, 0.35);
  g.add(lantern);
  return g;
}

// ===========================================================================
// The bed
// ===========================================================================
/** A carved Norse box-bed: four posts with turned finials, a planked headboard
 *  carved with knotwork, side rails, a straw mattress in linen, a wool blanket,
 *  a pillow and a fur thrown over the foot. Long side along x. */
export function buildBed() {
  const g = new THREE.Group();
  const L = 2.4, Wd = 1.4;
  const wood = (w, h, d) => box(w, h, d, "rough_wood", 1.2, { tint: 0xa88a6c });
  // Posts and finials.
  for (const [x, z, h] of [[-L / 2, -Wd / 2, 1.25], [-L / 2, Wd / 2, 1.25], [L / 2, -Wd / 2, 0.75], [L / 2, Wd / 2, 0.75]]) {
    const post = wood(0.14, h, 0.14); post.position.set(x, h / 2, z); g.add(post);
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.05 + Math.sin(t * Math.PI * 2) * 0.025 + (1 - t) * 0.03, t * 0.22)); }
    const fin = mesh(uv2(new THREE.LatheGeometry(pts, 12)), houseMat("rough_wood", 1, 1, 0.5, { tint: 0x8a6a50 }));
    fin.position.set(x, h, z); g.add(fin);
  }
  // Rails.
  for (const z of [-Wd / 2, Wd / 2]) { const r = wood(L, 0.2, 0.06); r.position.set(0, 0.32, z); g.add(r); }
  for (const x of [-L / 2, L / 2]) { const r = wood(0.06, 0.2, Wd); r.position.set(x, 0.32, 0); g.add(r); }
  // Headboard: planks with carved knotwork (a canvas normal-ish shading in the map).
  const carve = canvasTex(512, 256, (c, W, H) => {
    c.fillStyle = "#6a4a30"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#3a2414"; c.lineWidth = 9; c.lineCap = "round";
    // Interlaced loops: the knot the Norse carved on everything.
    for (let k = 0; k < 4; k++) {
      const cx = W * (0.15 + k * 0.233), cy = H / 2;
      c.beginPath(); c.ellipse(cx, cy, 44, 70, 0.6, 0, TAU); c.stroke();
      c.beginPath(); c.ellipse(cx, cy, 44, 70, -0.6, 0, TAU); c.stroke();
    }
    c.strokeStyle = "rgba(255,220,180,.25)"; c.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      const cx = W * (0.15 + k * 0.233), cy = H / 2;
      c.beginPath(); c.ellipse(cx - 2, cy - 3, 44, 70, 0.6, 3.6, 5.2); c.stroke();
    }
    c.fillStyle = "rgba(0,0,0,.25)";
    for (let x = 0; x < W; x += W / 5) c.fillRect(x, 0, 3, H);
  });
  const head = mesh(new THREE.BoxGeometry(0.06, 0.75, Wd - 0.1), [
    houseMat("rough_wood", 1, 1, 1, { tint: 0x8a6a50 }),
    new THREE.MeshStandardMaterial({ map: carve, roughness: 0.8 }),
    houseMat("rough_wood", 1, 1, 1, { tint: 0x8a6a50 }),
    houseMat("rough_wood", 1, 1, 1, { tint: 0x8a6a50 }),
    houseMat("rough_wood", 1, 1, 1, { tint: 0x8a6a50 }),
    houseMat("rough_wood", 1, 1, 1, { tint: 0x8a6a50 }),
  ]);
  head.position.set(-L / 2 + 0.02, 0.82, 0); g.add(head);
  // Slats and the straw mattress in linen.
  const slats = wood(L - 0.08, 0.04, Wd - 0.08); slats.position.y = 0.38; g.add(slats);
  const linen = houseMat("rough_linen", 1, 1, 0.5, { tint: 0xd8cbb0 });
  const mattress = mesh(rounded(L - 0.12, Wd - 0.12, 0.16, 0.12, 0.05), linen);
  mattress.position.y = 0.4; g.add(mattress);
  // Wool blanket over two thirds of it, falling over the side.
  const blanket = mesh(rounded(L * 0.62, Wd + 0.04, 0.025, 0.04, 0.02), houseMat("rough_linen", 1, 1, 0.4, { tint: 0x7a3a2a }));
  blanket.position.set(0.32, 0.62, 0); g.add(blanket);
  // Pillow.
  const pillow = mesh(new THREE.SphereGeometry(0.28, 18, 10), linen);
  pillow.scale.set(0.6, 0.32, 1.1); pillow.position.set(-L / 2 + 0.38, 0.66, 0); g.add(pillow);
  // A fur thrown over the foot, draped down the end.
  const foot = pelt(1.4, (x, z) => {
    const lx = x + 0.75;          // pelt centred near the foot
    return lx < L / 2 - 0.05 ? 0.62 - Math.max(0, Math.abs(z) - Wd / 2) * 1.5 : 0.62 - (lx - L / 2) * 2.2;
  }, 0xd8c8b8, 0.3);
  foot.position.set(0.75, 0, 0);
  g.add(foot);
  return g;
}

// ===========================================================================
// The slab
// ===========================================================================
/**
 * Toothless's slab: a broad low block of the island's dark rock, roughly
 * dressed, its top worn into a hollow by years of a dragon lying on it, with
 * pelts thrown over it. Warm: the hearth heats it.
 */
export function buildSlab() {
  const g = new THREE.Group();
  const R = 1.55, H = 0.42;
  const geo = new THREE.CylinderGeometry(R, R * 1.06, H, 36, 6, false);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    // Roughly dressed: the outline lumpy, the sides chipped.
    const k = 1 + Math.sin(a * 5 + 1.3) * 0.05 + Math.sin(a * 11) * 0.025 + (Math.random() - 0.5) * 0.012;
    v.x *= k; v.z *= k;
    if (v.y > H / 2 - 0.01) {
      // The hollow worn into the top.
      const d = Math.hypot(v.x, v.z) / R;
      v.y -= (1 - smooth(d, 0.1, 0.85)) * 0.1;
    }
    v.y += H / 2;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  // Planar UVs from above for the top, wrapped for the sides.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.y > H - 0.12) uv.setXY(i, v.x * 0.6 + 0.5, v.z * 0.6 + 0.5);
    else uv.setXY(i, (Math.atan2(v.z, v.x) / TAU + 0.5) * 5, v.y * 0.8);
  }
  uv2(geo);
  const loader = new THREE.TextureLoader();
  const t = (f, srgb) => { const x = loader.load("./assets/textures/" + f); x.wrapS = x.wrapT = THREE.RepeatWrapping; if (srgb) x.colorSpace = THREE.SRGBColorSpace; return x; };
  const rockMat = new THREE.MeshStandardMaterial({
    map: t("dark_rock_02_diff.jpg", true), normalMap: t("dark_rock_02_nor_gl.jpg"),
    color: 0x9a8a7c, roughness: 0.85,
  });
  g.add(mesh(geo, rockMat));
  // Pelts: a big one in the hollow, a second over the edge.
  const top = (x, z) => {
    const d = Math.hypot(x, z) / R;
    return d < 1 ? H - (1 - smooth(d, 0.1, 0.85)) * 0.1 : H - (d - 1) * R * 2.5;
  };
  g.add(pelt(2.4, top, 0xe0d0c0, 0.4));
  const second = pelt(1.5, (x, z) => top(x + 0.9, z - 0.5) + 0.02, 0x9a8070, 1.9);
  second.position.set(0.9, 0, -0.5);
  g.add(second);
  return g;
}
