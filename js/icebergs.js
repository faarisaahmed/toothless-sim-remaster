import * as THREE from "three";
import { glacierFronts, terrainHeight, noise2, SEA_LEVEL } from "./terrain.js";

// ---------------------------------------------------------------------------
// What a calving front leaves on the water.
//
// A tidewater glacier is never alone in its fjord: in front of the ice cliff
// the water is littered with what has come off it — a few real bergs the size
// of a house near the face, bergy bits like upturned boats further out, and
// brash, a scatter of lumps that thins over a kilometre or two down the fjord.
// Densest at the front, drifting out and spreading as it goes, only where the
// water is deep enough to float them.
//
// One InstancedMesh per front, so a fjord the camera is not looking at costs a
// frustum test and nothing else. They ride the swell a little in the vertex
// shader; no per-frame CPU work but one uniform.
// ---------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A lump of ice: a broken, flat-ish polyhedron, most of it under water. */
function bergGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const r = rng(seed);
  const ox = r() * 50, oz = r() * 50;
  // Tabular or pinnacled, and never round.
  const flat = 0.45 + r() * 0.35;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + noise2(v.x * 1.7 + ox, v.z * 1.7 + oz + v.y) * 0.38;
    v.multiplyScalar(k);
    v.y *= flat;
    // Sliced: calved ice breaks on planes, so the top is flattened and a side
    // or two is sheer.
    if (v.y > 0.32) v.y = 0.32 + (v.y - 0.32) * 0.25;
    if (v.x > 0.7) v.x = 0.7 + (v.x - 0.7) * 0.2;
    // Seven-eighths under: the waterline sits high on the shape.
    v.y -= 0.12;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export function createIcebergs(scene) {
  const group = new THREE.Group();
  group.name = "icebergs";
  scene.add(group);
  const uTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.42, metalness: 0, flatShading: true,
    // Ice lets light into itself; a touch of its own blue keeps the shadow
    // side from going grey.
    emissive: 0x16304a, emissiveIntensity: 0.6,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        {
          vec3 ip = vec3( instanceMatrix[ 3 ] );
          float ph = ip.x * 0.071 + ip.z * 0.053;
          transformed.y += sin( uTime * 0.8 + ph ) * 0.06;
          transformed.xz += vec2( sin( uTime * 0.53 + ph * 1.7 ), cos( uTime * 0.47 + ph ) ) * 0.02;
        }`);
  };
  mat.customProgramCacheKey = () => "icebergs-v1";

  const geos = [bergGeometry(11), bergGeometry(29), bergGeometry(47), bergGeometry(83)];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  let total = 0;

  glacierFronts().forEach((f, fi) => {
    const r = rng(1000 + fi * 7919);
    // Bigger fronts calve more. Per variant, so each gets its own mesh.
    const want = Math.round(70 + f.w * 0.35);
    const per = geos.map(() => []);
    const px = -f.dz, pz = f.dx;          // across the fjord
    for (let n = 0, tries = 0; n < want && tries < want * 6; tries++) {
      // Distance out from the face: most of it close in.
      const d = 15 + Math.pow(r(), 1.8) * 1700;
      const spread = f.w * 0.5 + d * 0.45;
      const s = (r() * 2 - 1) * spread;
      const x = f.x + f.dx * d + px * s, z = f.z + f.dz * d + pz * s;
      if (terrainHeight(x, z) > SEA_LEVEL - 4) continue;
      // Size falls off with distance from the face, and most pieces are small.
      const big = Math.pow(r(), 3.2) * (1 - Math.min(1, d / 1400));
      const size = 1.2 + big * 34 + r() * 2.5;
      const yaw = r() * Math.PI * 2;
      q.setFromAxisAngle(up, yaw);
      // A little list on the small pieces, none on the bergs.
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.3 / (1 + big * 4), 0, (r() - 0.5) * 0.3 / (1 + big * 4)));
      q.multiply(tilt);
      sv.set(size * (0.8 + r() * 0.6), size * (0.6 + r() * 0.5), size * (0.8 + r() * 0.6));
      pv.set(x, SEA_LEVEL, z);
      m4.compose(pv, q, sv);
      const v = (r() * geos.length) | 0;
      // Old ice is bluer; fresh breaks are white.
      col.setHSL(0.56 + r() * 0.03, 0.25 + r() * 0.3, 0.8 + r() * 0.12);
      per[v].push(m4.clone(), col.clone());
      n++;
    }
    per.forEach((list, v) => {
      if (!list.length) return;
      const count = list.length / 2;
      const im = new THREE.InstancedMesh(geos[v], mat, count);
      for (let i = 0; i < count; i++) {
        im.setMatrixAt(i, list[i * 2]);
        im.setColorAt(i, list[i * 2 + 1]);
      }
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      im.castShadow = false;
      im.name = `bergs-${fi}-${v}`;
      group.add(im);
      total += count;
    });
  });
  console.info(`icebergs: ${total} pieces off ${glacierFronts().length} calving fronts`);

  return {
    group,
    get count() { return total; },
    update(dt) { uTime.value += dt; },
  };
}
