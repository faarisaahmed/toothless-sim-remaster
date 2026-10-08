import { terrainHeight, fertility, woodland, noise2,
         SEA_LEVEL, TERRAIN_SIZE, WIND_BEARING } from "./terrain.js";

// ---------------------------------------------------------------------------
// Where the trees stand, one 625 m tile at a time.
//
// Pure functions of the height field and nothing else, so the same code runs
// on the forest's worker pool (forestworker.js) and, if workers are not to be
// had, on the main thread (forest.js). No THREE: a worker cannot import it.
//
// The archipelago is three times the width it was and nine times the land, and
// at the old density that is a million trees and a ten-second scatter. Two
// things keep it in hand. The woods themselves are rarer -- open country
// between stands, terrain.js woodland() -- and the scatter does not pay for
// the open country: each 64 m block is tested once, on its centre, against the
// best the wood could possibly be there, and skipped whole if that is nothing.
// Most of the archipelago is sea, heath or bare rock, and none of it costs a
// height sample per tree any more.
// ---------------------------------------------------------------------------

export const FOREST_TILE_SIZE = 625;
export const FOREST_TILES = Math.round(TERRAIN_SIZE / FOREST_TILE_SIZE);
export const FOREST_TILE = TERRAIN_SIZE / FOREST_TILES;
// A tree per 115 m2 of woodland, as it was: the woods keep their density, there
// is just less of them.
export const AREA_PER_TREE = 115;
export const TILE_TREE_CAP = 9000;
/** Floats per spot in scatterTile's output: x, z, h, f, slope, j, exposed. */
export const SPOT = 7;
/** ...and per boulder: x, z, h, nx, ny, nz, s. */
export const BOULDER = 7;

const BLOCK = 64;
const windX = Math.sin(WIND_BEARING), windZ = Math.cos(WIND_BEARING);

/**
 * Every tree and boulder in tile (tx, tz), as flat Float32Arrays.
 * @returns {{ spots: Float32Array, boulders: Float32Array }}
 */
export function scatterTile(tx, tz) {
  const TILE = FOREST_TILE;
  const x0 = -TERRAIN_SIZE / 2 + tx * TILE;
  const z0 = -TERRAIN_SIZE / 2 + tz * TILE;
  const none = { spots: new Float32Array(0), boulders: new Float32Array(0) };

  let anyLand = false;
  for (let py = 0; py <= 4 && !anyLand; py++) {
    for (let px = 0; px <= 4; px++) {
      if (terrainHeight(x0 + px * TILE / 4, z0 + py * TILE / 4) > SEA_LEVEL + 5) { anyLand = true; break; }
    }
  }
  if (!anyLand) return none;

  const spacing = Math.sqrt(AREA_PER_TREE);
  const spots = [];
  const boulders = [];
  for (let bz = 0; bz < TILE; bz += BLOCK) {
    for (let bx = 0; bx < TILE; bx += BLOCK) {
      // The block test. woodland() only rises as the ground falls, so at
      // sea level it is the most it can be anywhere in the block; a block
      // whose centre is deep water or above the tree line has nothing in it;
      // and the centre's own height, less what a slope can drop in 32 m,
      // bounds it again. Boulders live on bare ground, so a block that fails
      // only on the wood still gets a look for them, at the top few percent
      // of the jitter roll rather than every candidate.
      const cx = x0 + bx + BLOCK / 2, cz = z0 + bz + BLOCK / 2;
      let wooded = woodland(cx, cz, 0) >= 0.02;
      const hc = terrainHeight(cx, cz);
      if (hc < -45 || hc > 430) continue;
      if (wooded && woodland(cx, cz, hc - 70) < 0.02) wooded = false;

      const gz0 = Math.ceil(bz / spacing) * spacing, gx0 = Math.ceil(bx / spacing) * spacing;
      const gz1 = Math.min(TILE, bz + BLOCK), gx1 = Math.min(TILE, bx + BLOCK);
      for (let gz = gz0; gz < gz1; gz += spacing) {
        for (let gx = gx0; gx < gx1; gx += spacing) {
          const jx = (noise2((x0 + gx) * 0.31, (z0 + gz) * 0.29) * 0.5 + 0.5);
          // Not a wood, and not a boulder roll: nothing to look at.
          if (!wooded && jx <= 0.93) continue;
          const jz = (noise2((x0 + gx) * 0.27 + 40, (z0 + gz) * 0.33 - 12) * 0.5 + 0.5);
          const x = x0 + gx + jx * spacing;
          const z = z0 + gz + jz * spacing;
          const h = terrainHeight(x, z);
          if (h < SEA_LEVEL + 5) continue;
          const wd = wooded ? woodland(x, z, h) : 0;
          // Slope only ever lowers fertility, so a spot that fails on flat
          // ground fails on any slope too -- and the four height samples a
          // normal costs are a good part of a candidate. Same trees, same
          // boulders (those want jx > 0.86 and always take the full path).
          if (jx <= 0.86) {
            const f0 = fertility(x, z, h, 0) * wd;
            if (f0 < 0.16 || jx * 0.9 + 0.1 > f0 * 1.15) continue;
          }
          // Forward differences off the height already in hand: two samples
          // instead of four.
          const nx0 = h - terrainHeight(x + 7, z), nz0 = h - terrainHeight(x, z + 7);
          const len = Math.hypot(nx0, 7, nz0);
          const nx = nx0 / len, ny = 7 / len, nz = nz0 / len;
          const slope = Math.min(1, (1 - ny) * 2.6);
          const fr = fertility(x, z, h, slope);
          if (fr < 0.05 && slope > 0.10 && slope < 0.5 && jx > 0.86) {
            boulders.push(x, z, h, nx, ny, nz, 0.5 + jz * 2.2);
            continue;
          }
          const f = fr * wd;
          if (f < 0.16) continue;
          if (jx * 0.9 + 0.1 > f * 1.15) continue;
          // Open water a little upwind and low ground: a headland in the gale.
          const exposed = h < 45 && terrainHeight(x - windX * 70, z - windZ * 70) < SEA_LEVEL + 1
            && terrainHeight(x - windX * 140, z - windZ * 140) < SEA_LEVEL + 1;
          spots.push(x, z, h, f, slope, jz, exposed ? 1 : 0);
        }
      }
    }
  }

  let n = spots.length / SPOT;
  let out = spots;
  if (n > TILE_TREE_CAP) {
    const stride = n / TILE_TREE_CAP;
    out = [];
    for (let i = 0, k = 0; k < TILE_TREE_CAP; i += stride, k++) {
      const s = Math.floor(i) * SPOT;
      for (let e = 0; e < SPOT; e++) out.push(spots[s + e]);
    }
    n = TILE_TREE_CAP;
  }
  return { spots: Float32Array.from(out), boulders: Float32Array.from(boulders) };
}
