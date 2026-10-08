import { terrainHeight } from "./terrain.js";
import { paintGround, edgeLoop, CURV_SPAN } from "./groundpaint.js";

// ---------------------------------------------------------------------------
// Builds one fine terrain chunk off the main thread.
//
// The coarse sheet is 13 m a quad, which is the reason the ground looked like a
// grid: the coastline was a saw blade of 13 m triangles cutting the waterline,
// the strata steps were smeared across two quads, and vertex colour interpolated
// over a triangle that size draws its own diamonds. terrainHeight() itself is
// exact at any resolution — it was only ever the mesh throwing it away.
//
// A 256-quad chunk is ~70k samples of terrainHeight, about a tenth of a second,
// which is fine on a worker and a dropped frame on the main thread. Everything
// the material needs comes back in compact typed arrays, transferred rather
// than copied.
//
// Message in:  { id, x0, z0, size, res, skirt }
// Message out: { id, position: F32, normal: I8, color: U16, surf: U8 }
// ---------------------------------------------------------------------------

self.onmessage = ({ data }) => {
  // A plain grid of heights, n x n with both edges included -- the chart's
  // field (map.js), which over thirty kilometres is too many samples to take
  // on the main thread while the game is running.
  if (data.kind === "grid") {
    const { id, x0, z0, size, n } = data;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = z0 + (j / (n - 1)) * size;
      for (let i = 0; i < n; i++) heights[j * n + i] = terrainHeight(x0 + (i / (n - 1)) * size, z);
    }
    self.postMessage({ id, heights }, [heights.buffer]);
    return;
  }
  const { id, x0, z0, size, res, skirt } = data;
  const step = size / res;
  // Padding: one cell for the normals, and enough cells to reach CURV_SPAN for
  // the occlusion term, so every vertex sees the same neighbourhood it would on
  // the coarse sheet.
  const K = Math.max(1, Math.round(CURV_SPAN / step));
  const PAD = K;
  const W = res + 1 + PAD * 2;
  const H = new Float32Array(W * W);
  for (let j = 0; j < W; j++) {
    const z = z0 + (j - PAD) * step;
    for (let i = 0; i < W; i++) {
      H[j * W + i] = terrainHeight(x0 + (i - PAD) * step, z);
    }
  }

  const side = res + 1;
  const grid = side * side;
  const ring = res * 4;                    // skirt vertices, one per edge vertex
  const total = grid + ring;
  const position = new Float32Array(total * 3);
  const normal = new Int8Array(total * 4);           // xyz + pad, 4-byte aligned
  const color = new Uint16Array(total * 4);          // rgb + pad
  const surf = new Uint8Array(total * 4);            // veg, sand, snow + pad
  const tmp = new Float32Array(6);
  const kStep = K * step;

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const gi = (j + PAD) * W + (i + PAD);
      const h = H[gi];
      const x = x0 + i * step, z = z0 + j * step;
      const v = j * side + i;

      position[v * 3] = x;
      position[v * 3 + 1] = h;
      position[v * 3 + 2] = z;

      const dx = (H[gi + 1] - H[gi - 1]) / (2 * step);
      const dz = (H[gi + W] - H[gi - W]) / (2 * step);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      normal[v * 4] = Math.round(-dx * inv * 127);
      normal[v * 4 + 1] = Math.round(inv * 127);
      normal[v * 4 + 2] = Math.round(-dz * inv * 127);

      // Slope over the coarse grid's span, not one fine cell: the paint was
      // tuned against 13 m differences, and a 2 m difference across a stratum
      // edge reads as a cliff and paints a bare stripe along every terrace.
      const sx = (H[gi + K] - H[gi - K]) / (2 * kStep);
      const sz = (H[gi + K * W] - H[gi - K * W]) / (2 * kStep);
      const slope = Math.min(1, Math.hypot(sx, sz) / 1.1);
      const curv = h - (H[gi + K] + H[gi - K] + H[gi + K * W] + H[gi - K * W]) * 0.25;

      paintGround(x, z, h, slope, curv * (CURV_SPAN / kStep), tmp, 0);
      color[v * 4] = Math.min(65535, tmp[0] * 65535);
      color[v * 4 + 1] = Math.min(65535, tmp[1] * 65535);
      color[v * 4 + 2] = Math.min(65535, tmp[2] * 65535);
      surf[v * 4] = tmp[3] * 255;
      surf[v * 4 + 1] = tmp[4] * 255;
      surf[v * 4 + 2] = tmp[5] * 255;
    }
  }

  // The skirt: a copy of the border dropped straight down. A fine chunk next to
  // a coarse tile, or next to a chunk at another resolution, does not share its
  // edge vertices, so there is a hairline gap along the seam wherever the
  // coarse sheet cut a corner the fine one did not. A curtain hanging under the
  // edge, shaded like the ground above it, fills it from every angle the camera
  // can actually reach.
  const border = edgeLoop(res);
  for (let k = 0; k < ring; k++) {
    const s = border[k], d = grid + k;
    position[d * 3] = position[s * 3];
    position[d * 3 + 1] = position[s * 3 + 1] - skirt;
    position[d * 3 + 2] = position[s * 3 + 2];
    for (let c = 0; c < 4; c++) {
      normal[d * 4 + c] = normal[s * 4 + c];
      color[d * 4 + c] = color[s * 4 + c];
      surf[d * 4 + c] = surf[s * 4 + c];
    }
  }

  self.postMessage({ id, position, normal, color, surf },
    [position.buffer, normal.buffer, color.buffer, surf.buffer]);
};
