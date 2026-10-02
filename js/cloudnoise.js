// ---------------------------------------------------------------------------
// The noise the clouds are made of.
//
// Built once on a worker (cloudworker.js) and uploaded as textures. Every field
// tiles — Worley cells and Perlin gradients are taken modulo the period — so
// the shader can sample them with REPEAT forever.
//
//   SHAPE   96³ RGBA. R: Perlin-Worley, the billow. G/B/A: Worley at rising
//           frequencies, summed into the fBm that carves the billow into
//           lumps. At ~35 m a voxel this is the body of a cumulus.
//   DETAIL  64³ RGBA. R/G/B: fine Worley octaves — cauliflower on the tops,
//           rags on the bottoms, a few metres a voxel. A: an offset Perlin
//           field the shader uses as turbulence to push samples around, which
//           is what turns hard noise edges into wisps.
//   WEATHER 512² RGBA, tiling over ~42 km. This is where the first version
//           went wrong: its coverage was round Worley lumps, so every cloud in
//           the sky was the same round puff. Real cloud fields are clusters
//           and streets with torn edges, so:
//             R  cumulus coverage — domain-warped fBm broken up by cells at
//                the small end; the shader also stretches it downwind
//             G  how tall each cloud may grow
//             B  low mist and stratus — big slow banks
//             A  cirrus — long fibrous streaks
// ---------------------------------------------------------------------------

function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a, n) => ((a % n) + n) % n;

/** Tileable 3D Worley: 1 - distance to the nearest feature point. */
function worley(x, y, z, cells, seed) {
  const px = x * cells, py = y * cells, pz = z * cells;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    const cz = iz + dz, wz = mod(cz, cells);
    for (let dy = -1; dy <= 1; dy++) {
      const cy = iy + dy, wy = mod(cy, cells);
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, wx = mod(cx, cells);
        const fx = cx + hash3(wx, wy, wz, seed) - px;
        const fy = cy + hash3(wx, wy, wz, seed + 17) - py;
        const fz = cz + hash3(wx, wy, wz, seed + 31) - pz;
        const d = fx * fx + fy * fy + fz * fz;
        if (d < best) best = d;
      }
    }
  }
  return Math.max(0, 1 - Math.sqrt(best));
}

// The twelve edge gradients of a cube.
const GX = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];
const GZ = [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Tileable 3D gradient (Perlin) noise, roughly -1..1. */
function perlin(x, y, z, period, seed) {
  const px = x * period, py = y * period, pz = z * period;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const g = (cx, cy, cz, dx, dy, dz) => {
    const h = hash3(mod(cx, period), mod(cy, period), mod(cz, period), seed) * 12 | 0;
    return GX[h] * dx + GY[h] * dy + GZ[h] * dz;
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(g(ix, iy, iz, fx, fy, fz), g(ix + 1, iy, iz, fx - 1, fy, fz), u),
      l(g(ix, iy + 1, iz, fx, fy - 1, fz), g(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u), v),
    l(l(g(ix, iy, iz + 1, fx, fy, fz - 1), g(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u),
      l(g(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), g(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u), v),
    w);
}

function perlinFbm(x, y, z, period, octaves, seed, gain = 0.5) {
  let v = 0, a = 1, n = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    v += perlin(x, y, z, p, seed + o * 7) * a;
    n += a; a *= gain; p *= 2;
  }
  return v / n;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);

/** Stretch one interleaved channel to the full 0..255. */
function normalise(buf, stride, ch) {
  let lo = 255, hi = 0;
  for (let i = ch; i < buf.length; i += stride) { if (buf[i] < lo) lo = buf[i]; if (buf[i] > hi) hi = buf[i]; }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = ch; i < buf.length; i += stride) buf[i] = (buf[i] - lo) * k;
}

export function buildShape(N = 96) {
  const out = new Uint8Array(N * N * N * 4);
  let o = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const p = perlinFbm(u, v, w, 4, 5, 3, 0.55) * 0.5 + 0.5;
    const w1 = worley(u, v, w, 4, 11), w2 = worley(u, v, w, 8, 23), w3 = worley(u, v, w, 16, 41);
    const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    // Perlin-Worley: the Perlin field dilated by the Worley cells, so it reads
    // as rounded, connected billows rather than either noise alone.
    out[o++] = clamp01(remap(p, wf - 1, 1, 0, 1)) * 255;
    out[o++] = w2 * 255;
    out[o++] = w3 * 255;
    out[o++] = worley(u, v, w, 32, 57) * 255;
  }
  for (let c = 0; c < 4; c++) normalise(out, 4, c);
  return out;
}

export function buildDetail(N = 64) {
  const out = new Uint8Array(N * N * N * 4);
  let o = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    out[o++] = worley(u, v, w, 4, 71) * 255;
    out[o++] = worley(u, v, w, 8, 83) * 255;
    out[o++] = worley(u, v, w, 16, 97) * 255;
    out[o++] = (perlinFbm(u, v, w, 4, 3, 211) * 0.5 + 0.5) * 255;
  }
  for (let c = 0; c < 4; c++) normalise(out, 4, c);
  return out;
}

/** 2D tileable fBm as a slice through the 3D field. */
const fbm2 = (u, v, period, oct, seed, gain = 0.5) => perlinFbm(u, v, 0.37, period, oct, seed, gain);

export function buildWeather(N = 512) {
  const out = new Uint8Array(N * N * 4);
  let o = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;

    // Cumulus coverage. The lookup point is pushed around by another noise
    // field first — a domain warp — which turns blobs into the swirled, torn
    // clusters a real cloud field has. The warp is periodic, so it still tiles.
    const qx = fbm2(u, v, 3, 3, 301), qy = fbm2(u, v, 3, 3, 307);
    const wu = u + qx * 0.1, wv = v + qy * 0.1;
    // Regions: where the sky is busy and where it is open.
    const big = fbm2(wu, wv, 3, 4, 311, 0.5) * 0.5 + 0.5;
    // Clumps inside a region, a few hundred metres each.
    const mid = fbm2(wu, wv, 20, 3, 337, 0.6) * 0.5 + 0.5;
    // A little cellular break-up so neighbouring clumps part.
    const cells = worley(wu, wv, 0.21, 40, 331);
    const cov = Math.pow(big, 1.4) * 0.75 + mid * 0.35 + cells * 0.1 - 0.12;
    out[o++] = clamp01(cov) * 255;

    // Tower height.
    out[o++] = clamp01((fbm2(u, v, 6, 3, 351) * 0.5 + 0.5) * 1.5 - 0.25) * 255;

    // Mist and stratus banks: large, slow, warped.
    out[o++] = clamp01(fbm2(u + qx * 0.15, v + qy * 0.15, 3, 4, 367, 0.55) * 0.5 + 0.5) * 255;

    // Cirrus fibres: ridged noise, sharpened, in patches.
    const r = 1 - Math.abs(fbm2(u, v, 8, 3, 373, 0.6));
    out[o++] = clamp01(Math.pow(r, 4) * (big * 1.6 - 0.3)) * 255;
  }
  for (let c = 0; c < 4; c++) normalise(out, 4, c);
  return out;
}
