import * as THREE from "three";
import { terrainHeight, berkStream } from "./terrain.js";
import { STREAM, streamFall } from "./berklayout.js";
import { waterMaterial, fallMaterial, buildRibbon, softTexture } from "./rivers.js";

// ---------------------------------------------------------------------------
// Berk's natural features that a height field cannot be: water above the sea.
//
// The burn off the western hills (berklayout.js STREAM): terrain.js finds its
// bed at load and cuts its channel down the gully; this runs the water along
// it and the fall off its lip, hugging the rock down into the harbour, with
// spray where it lands. Positions all come from berklayout.js via terrain.js.
// ---------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The water shaders and the ribbon are shared with every other island's rivers
// (rivers.js).

/** The fall: from the lip on along the stream's line, hugging the rock down to the cove. */
function buildFall(bed, fallMat) {
  const fl = streamFall();
  const lip = bed[bed.length - 1];
  const ux = fl.ux, uz = fl.uz;
  const top = lip.y + 1.0;
  const path = [];
  let y = top;
  for (let s = -4; s <= 260; s += 2) {
    const x = lip.x + ux * s, z = lip.z + uz * s;
    const g = Math.max(terrainHeight(x + ux * 4, z + uz * 4), terrainHeight(x, z));
    // It cannot rise, and it drops no faster than the rock lets it, held a
    // little proud of the face.
    y = Math.min(y, Math.max(g + 1.8, 0));
    path.push({ x, y, z });
    if (s > 0 && y <= 0.4) break;
  }
  const pos = [], uv = [], drop = [], idx = [];
  let along = 0;
  const px = -uz, pz = ux;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i > 0) along += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y, p.z - path[i - 1].z);
    const k = clamp((top - p.y) / Math.max(1, top), 0, 1);
    const w = STREAM.w / 2 * (0.9 + k * 0.9);
    pos.push(p.x - px * w, p.y, p.z - pz * w, p.x + px * w, p.y, p.z + pz * w);
    uv.push(0, along, 1, along);
    drop.push(k, k);
    if (i > 0) { const q = (i - 1) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aDrop", new THREE.Float32BufferAttribute(drop, 1));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, fallMat);
  mesh.name = "berk-waterfall";
  mesh.renderOrder = 2;
  return { mesh, foot: path[path.length - 1], top: { x: lip.x, y: top, z: lip.z }, height: top };
}

/**
 * @param {THREE.Scene} scene
 */
export function createBerkLand(scene) {
  const root = new THREE.Group();
  root.name = "berk-land";
  scene.add(root);
  const bed = berkStream();
  if (bed.length < 3) return { root, update() {} };

  // The burn, a ribbon on its bed.
  const riverMat = waterMaterial(0.5);
  root.add(buildRibbon(bed.map((p) => ({ x: p.x, y: p.y + 0.9, z: p.z, w: STREAM.w / 2 - 6 })), riverMat, "berk-river"));

  // The fall, and the spray where it lands.
  const fallMat = fallMaterial();
  const f = buildFall(bed, fallMat);
  root.add(f.mesh);
  const mistTex = softTexture();
  const mists = [];
  for (let k = 0; k < 7; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, color: 0xeef4f6, transparent: true, depthWrite: false, opacity: 0.4, fog: true }));
    mists.push({ s, base: new THREE.Vector3(f.foot.x, f.foot.y, f.foot.z), size: STREAM.w * (1.4 + k * 0.3) + f.height * 0.05, phase: k / 7, rise: f.height * 0.2 + 15, spread: STREAM.w * 1.2 });
    root.add(s);
  }

  let t = 0;
  return {
    root,
    update(dt) {
      t += dt;
      fallMat.uniforms.uTime.value = t;
      riverMat.uniforms.uTime.value = t;
      for (const m of mists) {
        // Each puff rises off the water, swells and fades, and starts again.
        const ph = (t * 0.09 + m.phase) % 1;
        const a = m.phase * 6.283;
        m.s.position.set(
          m.base.x + Math.cos(a + t * 0.05) * m.spread * (0.3 + ph),
          m.base.y + 3 + ph * m.rise,
          m.base.z + Math.sin(a + t * 0.05) * m.spread * (0.3 + ph));
        m.s.scale.setScalar(m.size * (0.6 + ph * 0.9));
        m.s.material.opacity = 0.3 * Math.sin(ph * Math.PI);
      }
    },
  };
}
