import * as THREE from "three";
import { TILE, lathe, taperTube } from "./berkkit.js";

// ---------------------------------------------------------------------------
// The two stone Vikings at the mouth of Berk's harbour.
//
// Sculpted, not stacked: every part is a surface of revolution or a tapered
// tube along a curve, smooth-shaded, in pale carved stone weathered by vertex
// colour (moss on everything that faces the sky, the sea's dark tide line
// round the feet, soot under the fire). Each is a bearded chieftain in a fur
// mantle and a long cloak, a horned (or winged) helmet, the right arm raised
// with a great iron brazier held over his head, the left hand resting on the
// pommel of a sword planted point-down at his feet, and a round shield slung
// on his back — the side the village sees.
//
// Modelled 120 m to the crown of the helmet in its own frame (origin on the
// plinth top, facing +z); buildStatue() scales to the layout's `h`.
// ---------------------------------------------------------------------------

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function hash3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v),
           L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

/** Weathered stone, as a colour function of where a vertex is and which way it faces. */
function stoneColour(seed) {
  const c = new THREE.Color();
  return (p, n) => {
    const big = vnoise(p.x * 0.05 + seed, p.y * 0.05, p.z * 0.05);
    const fine = vnoise(p.x * 0.4, p.y * 0.4 + seed, p.z * 0.4);
    let r = 0.50 + big * 0.12 + fine * 0.06, g = r * 0.985, b = r * 0.95;
    // Moss and lichen where rain sits.
    const moss = THREE.MathUtils.smoothstep(n.y, 0.35, 0.85) * THREE.MathUtils.smoothstep(big + fine * 0.6, 0.45, 0.9);
    r = THREE.MathUtils.lerp(r, 0.30, moss); g = THREE.MathUtils.lerp(g, 0.37, moss); b = THREE.MathUtils.lerp(b, 0.20, moss);
    // Streaks where it runs off, darker down the faces turned from the sky.
    const streak = THREE.MathUtils.smoothstep(vnoise(p.x * 0.9 + seed, p.y * 0.04, p.z * 0.9), 0.55, 0.9) * (1 - Math.abs(n.y)) * 0.25;
    // The tide line and the spray round the feet.
    const wet = 1 - THREE.MathUtils.smoothstep(p.y, 2, 16);
    const k = 1 - streak - wet * 0.35;
    return c.setRGB(r * k, g * k, b * k);
  };
}

/**
 * @param {{h:number, plinthR:number}} S  the layout entry
 * @param {boolean} mirror  the west statue raises its left arm, so the pair frame the mouth
 * @param {'horns'|'wings'} helm
 * @returns {{ builder: Builder, fire: THREE.Vector3, fireSize: number }}  in the
 *   statue's own frame (scaled), origin on the plinth top, facing +z
 */
export function buildStatue(b, matrix, { seed = 1, helm = "horns", h = 120 } = {}) {
  const k = h / 120;
  const M = new THREE.Matrix4().multiplyMatrices(matrix, new THREE.Matrix4().makeScale(k, k, k));
  const stone = stoneColour(seed * 3.1);
  const S = { tile: TILE.ROCK, colour: stone, matrix: M };
  const dark = { tile: TILE.ROCK, colour: (p, n) => stone(p, n).multiplyScalar(0.55), matrix: M };
  const ironC = { tile: TILE.IRON, colour: 0x8a8580, matrix: M };
  const add = (g, opts = S) => b.add(g, opts.matrix ?? M, opts);
  const limb = (p0, p1, r0, r1, opts = {}) => b.limb(p0, p1, r0, r1, { seg: 18, ...S, ...opts, matrix: M });
  const ball = (x, y, z, rx, ry, rz, opts = {}) => b.ball(x, y, z, rx, ry, rz, { seg: 18, hseg: 12, ...S, ...opts, matrix: M });
  const tube = (pts, radii, o = {}) => add(taperTube(pts, radii, { seg: o.seg ?? 12, flatten: o.flatten ?? 1 }), o.opts ?? S);

  // --- pedestal: dressed stone, stepped, on the plinth's top --------------
  add(lathe([[31, -6], [31, -1.2], [29.5, -0.6], [29.5, 0.2], [27, 0.6], [26.5, 1.2], [0, 1.2]], { seg: 40 }));
  const ped = 1.2;

  // --- boots and legs ----------------------------------------------------------
  for (const s of [-1, 1]) {
    ball(9 * s, ped + 3.6, 7, 6.2, 4.6, 10.5);
    limb(V(9 * s, ped + 3, 2), V(9 * s, ped + 17, 1), 6.8, 6.4);
    // Boot cuff, a fur roll.
    add(lathe([[7.4, ped + 15], [8.2, ped + 17], [7.6, ped + 19]], { seg: 18, fn: (t, y) => 1 + 0.06 * Math.sin(t * 19) }),
      { ...S, matrix: new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(9 * s, 0, 1)) });
    limb(V(9 * s, ped + 17, 1), V(8.5 * s, ped + 40, 0), 7, 9);
  }

  // --- tunic skirt, belt, torso ------------------------------------------------------
  add(lathe([[18.5, 22], [19.5, 26], [18.8, 36], [18, 46], [17.6, 52]], { seg: 40, sz: 0.66,
    fn: (t, y, tv) => 1 + 0.045 * Math.sin(t * 13 + 0.6) * (1 - tv) }));
  // The hem's underside, so the skirt is not a hollow tube from below.
  add(lathe([[0.1, 22], [18.5, 22]], { seg: 40, sz: 0.66, flip: true }));
  add(lathe([[18.4, 49.5], [18.9, 50.5], [18.9, 54.5], [18.2, 55.5]], { seg: 40, sz: 0.68 }), { ...S, colour: (p, n) => stone(p, n).multiplyScalar(0.8) });
  b.box(7, 6, 2.5, 0, 52.5, 12.7, { ...S, matrix: M });             // buckle
  b.box(4, 3.4, 2.6, 0, 52.5, 13.3, { ...dark, matrix: M });
  // Chest: barrel-broad, deep at the ribs.
  add(lathe([[17.6, 54], [19.5, 60], [21.5, 68], [22.5, 75], [21.5, 81], [17, 86], [9, 89], [0.1, 89.5]], { seg: 40, sz: 0.56,
    fn: (t, y) => 1 + (Math.cos(t) > 0 ? 0.05 * Math.max(0, Math.cos(t)) * Math.max(0, 1 - Math.abs(y - 75) / 9) : 0) }));
  // A baldric across the chest, studded.
  b.box(5, 46, 2.2, 1, 69, 11.8, { ...S, colour: (p, n) => stone(p, n).multiplyScalar(0.82), matrix: M }, 0, -0.18, -0.62);
  for (let i = -3; i <= 3; i++) ball(1 + i * 4.6 * Math.sin(0.62) * 1.0, 69 - i * 4.6 * Math.cos(0.62), 13.4 - Math.abs(i) * 0.4, 1.0, 1.0, 0.8, { seg: 8, hseg: 6 });

  // --- the fur mantle over the shoulders -------------------------------------------
  // Round the shoulders and the back only; the front is the beard's.
  add(lathe([[20, 74], [24.5, 78], [26, 82], [24.5, 86], [18, 89.5], [9, 91]], { seg: 40, sz: 0.66,
    t0: Math.PI * 0.32, tl: Math.PI * 1.36,
    fn: (t, y) => 1 + 0.07 * Math.sin(t * 23 + y * 0.7) * Math.sin(y * 1.1 + t * 3) }));
  add(lathe([[19.5, 74], [24, 78], [25.5, 82], [24, 86], [17.5, 89.5], [8.5, 91]], { seg: 40, sz: 0.66,
    t0: Math.PI * 0.32, tl: Math.PI * 1.36, flip: true }));

  // --- the cloak, falling behind to the plinth -------------------------------------
  const cloakFn = (t, y) => 1 + 0.07 * Math.sin(t * 9 + y * 0.03) + 0.025 * Math.sin(t * 23);
  const cloakProf = [[22, 84], [24, 70], [26, 50], [28.5, 28], [30.5, 8], [31.5, ped + 0.5]];
  add(lathe(cloakProf, { seg: 40, sz: 0.66, t0: Math.PI * 0.55, tl: Math.PI * 0.9, fn: cloakFn }));
  add(lathe(cloakProf.map(([r, y]) => [r - 1.4, y]), { seg: 40, sz: 0.66, t0: Math.PI * 0.55, tl: Math.PI * 0.9, fn: cloakFn, flip: true }));

  // --- the shield on his back -----------------------------------------------------
  {
    const sm = new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().compose(V(1, 62, -20.5),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - 0.12, 0, 0)), V(1, 1, 1)));
    b.add(lathe([[0.1, 0], [13, 0.4], [14, 0.2], [14, -1.2], [0.1, -1.2]], { seg: 40 }), sm, S);
    b.add(lathe([[0.1, 2.4], [2.6, 2.0], [3.6, 0.9], [4.2, 0.3]], { seg: 20 }), sm, ironC);
    // Iron rim.
    b.add(lathe([[13.4, -0.4], [14.5, -0.2], [14.5, 0.7], [13.4, 0.9]], { seg: 40 }), sm, ironC);
  }

  // --- neck, head, face -----------------------------------------------------------
  const hz = 5.5;                                 // the head sits forward of the spine
  limb(V(0, 86, 0), V(0, 93, hz * 0.6), 7.4, 6.8);
  ball(0, 98, hz, 7.2, 8.6, 7.6);
  ball(0, 95.6, hz + 7.0, 1.9, 3.2, 2.4, { rx: -0.25 });                      // nose
  ball(0, 93.6, hz + 7.0, 1.9, 1.1, 1.4);                                     // nostrils' bulb
  b.box(12.5, 2.4, 3.4, 0, 99.4, hz + 5.9, { ...S, matrix: M }, 0, -0.3);       // brow
  for (const s of [-1, 1]) {
    ball(2.9 * s, 97.8, hz + 6.2, 1.25, 0.75, 0.6, { ...S, colour: (p, n) => stone(p, n).multiplyScalar(0.7) });   // eyes, deep-set
    ball(3.9 * s, 95.4, hz + 5.2, 2.6, 2.1, 1.8);                             // cheekbones
    ball(7.0 * s, 97.5, hz + 0.5, 1.4, 2.6, 1.8);                             // ears
  }

  // --- the beard: a mass at the jaw, then locks down the chest ----------------------
  ball(0, 90.5, hz + 4.2, 7.4, 5.6, 4.8);
  {
    const rnd = (i) => hash3(i, seed, 3.3);
    for (let i = -5; i <= 5; i++) {
      const x0 = i * 1.35, a = Math.abs(i);
      const len = 22 - a * 1.4 + rnd(i) * 4;
      const top = V(x0, 92 - a * 0.3, hz + 5.0 + (5 - a) * 0.25);
      const mid = V(x0 * 1.3, 84 - a * 0.4, hz + 8.6 - a * 0.25);
      const low = V(x0 * 1.2, 92 - len * 0.75, hz + 9.6 - a * 0.3);
      const tip = V(x0 * 0.9 + (rnd(i + 9) - 0.5) * 1.5, 92 - len, hz + 9.0 - a * 0.3);
      tube([top, mid, low, tip], [3.0, 3.2, 2.2, 0.6], { seg: 10 });
    }
    // Two plaits, banded.
    for (const s of [-1, 1]) {
      const pts = [V(5.6 * s, 88, hz + 7.6), V(6.6 * s, 80, hz + 9.4), V(6.4 * s, 70, hz + 9.6), V(5.8 * s, 60, hz + 9.0)];
      tube(pts, [1.9, 1.8, 1.6, 1.2], { seg: 10 });

    }
    // Moustache, swept down into the beard.
    for (const s of [-1, 1]) {
      tube([V(0.4 * s, 93.3, hz + 7.7), V(3.2 * s, 92.8, hz + 7.4), V(5.6 * s, 90.5, hz + 6.6), V(6.6 * s, 86.5, hz + 6.4)],
        [1.5, 1.6, 1.2, 0.5], { seg: 10 });
    }
  }

  // --- the helmet --------------------------------------------------------------------
  {
    const hm = new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(0, 0, hz - 0.3));
    const HS = { ...S, matrix: hm };
    b.add(lathe([[8.0, 99.2], [8.2, 101.5], [7.7, 104], [6.1, 106.4], [3.4, 108], [0.1, 108.6]], { seg: 36, sz: 1.04 }), hm, S);
    b.add(lathe([[8.1, 98.6], [8.9, 99.0], [8.9, 101.0], [8.1, 101.4]], { seg: 36, sz: 1.04 }), hm, S);   // brow band
    // A raised crest front to back, and the nose guard.
    b.add(taperTube([V(0, 100.5, 8.3), V(0, 106, 6.5), V(0, 108.8, 0), V(0, 106.4, -6), V(0, 101, -8.5)],
      [0.9, 1.1, 1.2, 1.1, 0.9], { seg: 8 }), hm, S);
    b.box(1.6, 5.4, 1.2, 0, 97.4, 8.75, HS, 0, -0.08);
    // Rivets round the band.
    for (let i = 0; i < 14; i++) {
      const t = (i / 14) * Math.PI * 2;
      b.ball(Math.sin(t) * 9.0, 100, Math.cos(t) * 9.3, 0.55, 0.55, 0.55, { seg: 6, hseg: 4, ...HS });
    }
    if (helm === "horns") {
      for (const s of [-1, 1]) {
        const pts = [V(7.0 * s, 102.5, 0.2), V(10.5 * s, 103.3, 0.8), V(14.5 * s, 105.5, 1.8),
                     V(17.4 * s, 109.5, 3.0), V(18.6 * s, 114.5, 4.6), V(18.0 * s, 119.5, 6.6), V(16.2 * s, 123.2, 8.6)];
        b.add(taperTube(pts, [2.9, 2.7, 2.4, 2.0, 1.5, 0.9, 0.2], { seg: 14 }), hm,
          { ...S, colour: (p, n) => stone(p, n).multiplyScalar(0.92) });
        // Ridged where the horn meets the helm.
        b.add(taperTube([V(6.6 * s, 102.4, 0.2), V(8.6 * s, 102.9, 0.5)], [3.4, 3.4], { seg: 14 }), hm, S);
      }
    } else {
      // Wings: a fan of carved feathers each side.
      for (const s of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const a = 0.42 + i * 0.2, len = 10 + i * 1.6 - (i > 3 ? (i - 3) * 2.4 : 0);
          const dx = Math.sin(a) * s, dy = Math.cos(a);
          const root = V(7.4 * s, 102.5 + i * 0.3, -1.2 - i * 0.9);
          const tip = root.clone().add(V(dx * len, dy * len, -len * 0.18));
          b.add(taperTube([root, root.clone().lerp(tip, 0.5), tip], [1.3, 1.5, 0.3], { seg: 8, flatten: 0.38 }), hm, S);
        }
      }
    }
  }

  // --- arms -----------------------------------------------------------------------------
  // The raised arm: shoulder, elbow, wrist, fist, then the brazier above it.
  const sh = V(20.5, 81.5, 0), el = V(28, 99, 3.5), wr = V(26, 114, 5.5), fist = V(25.6, 117.5, 6);
  ball(sh.x, sh.y + 1, sh.z, 9.2, 8.6, 8.4, { ...S, fn: null });
  limb(sh, el, 7.4, 6.4); ball(el.x, el.y, el.z, 6.3, 6.3, 6.3);
  limb(el, wr, 6.3, 5.2);
  limb(el.clone().lerp(wr, 0.22), el.clone().lerp(wr, 0.85), 6.9, 6.0, { caps: true, colour: (p, n) => stone(p, n).multiplyScalar(0.86) });
  ball(fist.x, fist.y, fist.z, 5.4, 5.8, 5.4);
  // Fingers wrapped round the brazier's haft.
  for (let i = 0; i < 4; i++) ball(fist.x + 4.4, fist.y + 2.3 - i * 1.6, fist.z + 1.5, 1.6, 1.0, 1.9);
  // The brazier: a haft through the fist, a great iron bowl, a ring of claws.
  const bowlY = 124;
  limb(V(fist.x, fist.y - 5, fist.z), V(fist.x, bowlY + 1, fist.z), 1.7, 1.9, ironC);
  {
    const bm = new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(fist.x, bowlY, fist.z));
    // A carved stone bowl, ribbed, soot-black inside.
    b.add(lathe([[1.8, -0.8], [4, 0.2], [8, 2.4], [10.6, 5.2], [11.4, 7.6], [11.0, 8.1]], { seg: 32, fn: (t) => 1 + 0.025 * Math.sin(t * 16) }), bm,
      { tile: TILE.ROCK, colour: (p, n) => stone(p, n).multiplyScalar(0.8) });
    b.add(lathe([[10.4, 8.1], [9.9, 6.0], [7.4, 3.2], [0.1, 2.4]], { seg: 32, flip: true }), bm,
      { tile: TILE.ROCK, colour: 0x2a2420 });
    // Coals heaped in the bowl.
    b.add(lathe([[9.6, 5.2], [7, 6.6], [3.5, 7.6], [0.1, 8.0]], { seg: 20, fn: (t) => 1 + 0.08 * Math.sin(t * 7) }), bm,
      { tile: TILE.IRON, colour: 0x2a1610, glow: 1 });
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      const p0 = V(Math.sin(t) * 10.8, 7.8, Math.cos(t) * 10.8), p1 = V(Math.sin(t) * 12.4, 10.8, Math.cos(t) * 12.4);
      b.add(taperTube([p0, p1.clone().lerp(p0, 0.4).add(V(0, 0.8, 0)), p1], [0.9, 0.7, 0.15], { seg: 6 }), bm, ironC);
    }
    b.add(taperTube([V(0, -0.8, 0), V(0, -3, 0)], [2.4, 1.8], { seg: 12 }), bm, ironC);
  }

  // The lowered arm, its hand on the sword's pommel.
  const sh2 = V(-20.5, 81.5, 0), el2 = V(-26.5, 64, 4), wr2 = V(-16, 55.5, 13.5), hand = V(-13.4, 55, 15.2);
  ball(sh2.x, sh2.y + 1, sh2.z, 9.2, 8.6, 8.4);
  limb(sh2, el2, 7.4, 6.4); ball(el2.x, el2.y, el2.z, 6.2, 6.2, 6.2);
  limb(el2, wr2, 6.2, 5.2);
  limb(el2.clone().lerp(wr2, 0.25), el2.clone().lerp(wr2, 0.88), 6.8, 5.9, { caps: true, colour: (p, n) => stone(p, n).multiplyScalar(0.86) });
  ball(hand.x, hand.y, hand.z, 5.6, 4.6, 5.4);
  // The sword: diamond blade planted in the pedestal, crossguard, grip, pommel.
  {
    const sx = -12.5, sz = 16.5;
    const sm = new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().compose(V(sx, ped, sz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)), V(1, 1, 1)));
    b.add(lathe([[0.2, -1], [3.2, 5], [3.4, 40], [3.0, 43.5]], { seg: 4, sx: 1, sz: 0.28 }), sm, S);
    const gy = ped + 44;
    b.box(17, 2.2, 3, sx, gy, sz, { ...S, matrix: M });
    for (const s of [-1, 1]) b.ball(sx + 8.6 * s, gy, sz, 1.4, 1.6, 1.6, { seg: 8, hseg: 6, ...S, matrix: M });
    limb(V(sx, gy + 1, sz), V(sx, gy + 7.5, sz), 1.6, 1.5, { colour: (p, n) => stone(p, n).multiplyScalar(0.8) });
    ball(sx, gy + 8.6, sz, 2.8, 2.2, 2.8);
  }

  const fire = V(fist.x, bowlY + 7.4, fist.z).multiplyScalar(k).applyMatrix4(matrix);
  return { fire, fireSize: 17 * k };
}
