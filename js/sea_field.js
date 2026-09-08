import * as THREE from "three";
import { terrainHeight, SEA_LEVEL, WIND_BEARING } from "./terrain.js";

// ---------------------------------------------------------------------------
// The sea field.
//
// Everything the ocean does that is not "a flat blue plane" needs to know what
// is under it, and the ocean is a shader, so it needs to know it as a texture.
// This bakes one at load:
//
//   R  sea bed height, -100 m .. +28 m       waves shoal and break on this
//   G  distance to the nearest coastline     the surf band and the wet sand
//   B  shelter from the prevailing wind      calm water in the lee of an island
//
// Baking it honestly at 1024 x 1024 is a million terrainHeight calls, about a
// second of frozen main thread. Nearly all of that is spent on open ocean and
// island interiors where the answer is "deep" or "dry" and the field is smooth.
// So it samples a coarse grid first and only refines the cells that straddle
// something — which is the coast, which is 8% of the map. Same result, an
// eighth of the time.
// ---------------------------------------------------------------------------

export const SEA_FIELD_SIZE = 1024;
export const SEA_FIELD_EXTENT = 10400;      // metres, half-width. Terrain is 10000 wide.

const H_MIN = -100, H_SPAN = 128;           // R channel range, 0.5 m per code
const D_MAX = 600;                          // G channel range, metres

export function bakeSeaField() {
  const S = SEA_FIELD_SIZE;
  const step = (SEA_FIELD_EXTENT * 2) / (S - 1);
  const h = new Float32Array(S * S);

  // --- Coarse pass, then refine only what matters ------------------------
  const C = 8;                                   // coarse block, in texels
  const cs = S / C + 1;
  const coarse = new Float32Array(cs * cs);
  for (let j = 0; j < cs; j++) {
    const z = -SEA_FIELD_EXTENT + j * C * step;
    for (let i = 0; i < cs; i++) {
      coarse[j * cs + i] = terrainHeight(-SEA_FIELD_EXTENT + i * C * step, z);
    }
  }

  for (let cj = 0; cj < cs - 1; cj++) {
    for (let ci = 0; ci < cs - 1; ci++) {
      const a = coarse[cj * cs + ci],       b = coarse[cj * cs + ci + 1];
      const c = coarse[(cj + 1) * cs + ci], d = coarse[(cj + 1) * cs + ci + 1];
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      // Deep water and high ground are both smooth and both irrelevant to the
      // surf, so interpolate them. Anything that comes near the waterline gets
      // sampled for real.
      const smooth = hi < -88 || lo > 34;
      for (let jj = 0; jj < C; jj++) {
        const ty = jj / C;
        const j = cj * C + jj;
        if (j >= S) break;
        for (let ii = 0; ii < C; ii++) {
          const i = ci * C + ii;
          if (i >= S) break;
          const tx = ii / C;
          h[j * S + i] = smooth
            ? (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
            : terrainHeight(-SEA_FIELD_EXTENT + i * step, -SEA_FIELD_EXTENT + j * step);
        }
      }
    }
  }

  // --- Distance to the coastline ----------------------------------------
  // Two-pass chamfer over the whole grid. Exact Euclidean would be nicer and
  // is not worth it: this feeds a smoothstep whose width is forty metres.
  const dist = new Float32Array(S * S);
  const BIG = 1e9;
  for (let i = 0; i < S * S; i++) {
    // Seed on the texels that actually straddle the waterline, so the distance
    // is to the shore and not to the middle of the nearest island.
    const v = h[i];
    dist[i] = v > SEA_LEVEL - 1.5 && v < SEA_LEVEL + 1.5 ? 0 : BIG;
  }
  // A seed of "within 1.5 m of sea level" misses coasts steeper than 3 m per
  // texel, which is most of the cliffs, so also seed any texel with a neighbour
  // on the other side of the waterline.
  for (let j = 1; j < S - 1; j++) {
    for (let i = 1; i < S - 1; i++) {
      const k = j * S + i;
      if (dist[k] === 0) continue;
      const land = h[k] > SEA_LEVEL;
      if ((h[k - 1] > SEA_LEVEL) !== land || (h[k + 1] > SEA_LEVEL) !== land ||
          (h[k - S] > SEA_LEVEL) !== land || (h[k + S] > SEA_LEVEL) !== land) dist[k] = 0;
    }
  }
  const A = step, B = step * Math.SQRT2;
  for (let j = 1; j < S; j++) {
    for (let i = 1; i < S - 1; i++) {
      const k = j * S + i;
      let v = dist[k];
      v = Math.min(v, dist[k - 1] + A, dist[k - S] + A,
                      dist[k - S - 1] + B, dist[k - S + 1] + B);
      dist[k] = v;
    }
  }
  for (let j = S - 2; j >= 0; j--) {
    for (let i = S - 2; i > 0; i--) {
      const k = j * S + i;
      let v = dist[k];
      v = Math.min(v, dist[k + 1] + A, dist[k + S] + A,
                      dist[k + S + 1] + B, dist[k + S - 1] + B);
      dist[k] = v;
    }
  }

  // --- Shelter ------------------------------------------------------------
  // March upwind from every point and count the land in the way. This is why
  // the water in a bay on the lee side is glassy while the same bay's headland
  // is taking three metres of swell — and it costs one texture channel.
  const SH = 256;                                 // shelter is smooth; bake it coarse
  const shelter = new Float32Array(SH * SH);
  const ux = -Math.sin(WIND_BEARING), uz = -Math.cos(WIND_BEARING);
  const REACH = 1600, STEPS = 16;
  for (let j = 0; j < SH; j++) {
    for (let i = 0; i < SH; i++) {
      const x = -SEA_FIELD_EXTENT + (i / (SH - 1)) * SEA_FIELD_EXTENT * 2;
      const z = -SEA_FIELD_EXTENT + (j / (SH - 1)) * SEA_FIELD_EXTENT * 2;
      let blocked = 0;
      for (let s = 1; s <= STEPS; s++) {
        const t = (s / STEPS) * REACH;
        const gi = Math.round((x + ux * t + SEA_FIELD_EXTENT) / step);
        const gj = Math.round((z + uz * t + SEA_FIELD_EXTENT) / step);
        if (gi < 0 || gj < 0 || gi >= S || gj >= S) continue;
        // Nearer land shelters more, and a 200 m cliff shelters more than a
        // reef that is awash.
        if (h[gj * S + gi] > SEA_LEVEL) {
          blocked += (1 - s / STEPS) * 0.34;
        }
      }
      shelter[j * SH + i] = Math.max(0, 1 - blocked);
    }
  }

  // --- Pack ---------------------------------------------------------------
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    const sj = (j / (S - 1)) * (SH - 1);
    const j0 = Math.floor(sj), jt = sj - j0, j1 = Math.min(SH - 1, j0 + 1);
    for (let i = 0; i < S; i++) {
      const k = j * S + i;
      const si = (i / (S - 1)) * (SH - 1);
      const i0 = Math.floor(si), it = si - i0, i1 = Math.min(SH - 1, i0 + 1);
      const sh = (shelter[j0 * SH + i0] * (1 - it) + shelter[j0 * SH + i1] * it) * (1 - jt)
               + (shelter[j1 * SH + i0] * (1 - it) + shelter[j1 * SH + i1] * it) * jt;
      data[k * 4]     = Math.round(THREE.MathUtils.clamp((h[k] - H_MIN) / H_SPAN, 0, 1) * 255);
      data[k * 4 + 1] = Math.round(Math.min(1, dist[k] / D_MAX) * 255);
      data[k * 4 + 2] = Math.round(THREE.MathUtils.clamp(sh, 0, 1) * 255);
      data[k * 4 + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  return {
    texture: tex,
    size: S,
    extent: SEA_FIELD_EXTENT,
    heights: h,
    distance: dist,
    step,
    // The decode the shaders use, kept here so there is one copy of the numbers.
    hMin: H_MIN, hSpan: H_SPAN, dMax: D_MAX,
  };
}
