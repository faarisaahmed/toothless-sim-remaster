// ---------------------------------------------------------------------------
// The noise the clouds are made of.
//
// Three tileable fields, built once on a worker (cloudworker.js) and uploaded
// as textures:
//
//   SHAPE   64³ RGBA. R is Perlin-Worley — billowy blobs with soft insides,
//           the thing that makes a cumulus look like a cumulus rather than a
//           smudge. G, B, A are Worley at three rising frequencies, summed in
//           the shader into an fBm that erodes the blobs into lumps.
//   DETAIL  32³ R. Fine Worley, for the wispy edges. Only read where a sample
//           is already inside a cloud.
//   WEATHER 512² RGBA. R is where clouds are (coverage), G how tall they grow,
//           B a slower field the sky dome uses for its far, flat cloud deck.
//
// Everything wraps — the Worley cells and the Perlin gradients are both taken
// modulo the period — so the textures tile without a seam and the shader can
// sample them with REPEAT forever.
//
// Plain arithmetic, no three.js, so it runs on a worker.
// ---------------------------------------------------------------------------

function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a, n) => ((a % n) + n) % n;

/** Tileable 3D Worley: 1 - distance to the nearest feature point, 0..1. */
function worley(x, y, z, cells, seed) {
  const px = x * cells, py = y * cells, pz = z * cells;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, cz = iz + dz;
    const wx = mod(cx, cells), wy = mod(cy, cells), wz = mod(cz, cells);
    const fx = cx + hash3(wx, wy, wz, seed);
    const fy = cy + hash3(wx, wy, wz, seed + 17);
    const fz = cz + hash3(wx, wy, wz, seed + 31);
    const d = (fx - px) ** 2 + (fy - py) ** 2 + (fz - pz) ** 2;
    if (d < best) best = d;
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
    const wx = mod(cx, period), wy = mod(cy, period), wz = mod(cz, period);
    const h = hash3(wx, wy, wz, seed) * 12 | 0;
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

function perlinFbm(x, y, z, period, octaves, seed) {
  let v = 0, a = 1, n = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    v += perlin(x, y, z, p, seed + o * 7) * a;
    n += a; a *= 0.5; p *= 2;
  }
  return v / n;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);

/** Stretch one interleaved channel to the full 0..255, so the shader's
 *  thresholds mean the same thing whatever the noise happened to span. */
function normalise(buf, stride, ch) {
  let lo = 255, hi = 0;
  for (let i = ch; i < buf.length; i += stride) { if (buf[i] < lo) lo = buf[i]; if (buf[i] > hi) hi = buf[i]; }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = ch; i < buf.length; i += stride) buf[i] = (buf[i] - lo) * k;
}

export function buildShape(N = 64) {
  const out = new Uint8Array(N * N * N * 4);
  let o = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const p = perlinFbm(u, v, w, 4, 4, 3) * 0.5 + 0.5;
    const w1 = worley(u, v, w, 4, 11), w2 = worley(u, v, w, 8, 23), w3 = worley(u, v, w, 16, 41);
    const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    // Perlin-Worley: the Perlin field, remapped so the Worley cells carve it
    // into rounded lobes.
    const pw = clamp01(remap(p, wf - 1, 1, 0, 1));
    out[o++] = pw * 255;
    out[o++] = w2 * 255;
    out[o++] = w3 * 255;
    out[o++] = worley(u, v, w, 32, 57) * 255;
  }
  for (let c = 0; c < 4; c++) normalise(out, 4, c);
  return out;
}

export function buildDetail(N = 32) {
  const out = new Uint8Array(N * N * N);
  let o = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    out[o++] = (worley(u, v, w, 4, 71) * 0.625 + worley(u, v, w, 8, 83) * 0.25
              + worley(u, v, w, 16, 97) * 0.125) * 255;
  }
  normalise(out, 1, 0);
  return out;
}

export function buildWeather(N = 512) {
  const out = new Uint8Array(N * N * 4);
  let o = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    // 2D by taking a slice of the 3D noise at a fixed depth; it still tiles.
    const cov = perlinFbm(u, v, 0.37, 6, 5, 101) * 0.5 + 0.5;
    // Worley lumps on top, so the coverage field breaks into separate clouds
    // rather than one continuous wash.
    const lumps = worley(u, v, 0.21, 12, 131);
    const height = perlinFbm(u, v, 0.71, 4, 3, 151) * 0.5 + 0.5;
    const far = perlinFbm(u, v, 0.53, 3, 4, 171) * 0.5 + 0.5;
    out[o++] = clamp01((cov * 0.7 + lumps * 0.45) - 0.12) * 255;
    out[o++] = clamp01(height * 1.4 - 0.2) * 255;
    out[o++] = far * 255;
    out[o++] = 255;
  }
  for (let c = 0; c < 3; c++) normalise(out, 4, c);
  return out;
}
