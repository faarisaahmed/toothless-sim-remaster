import * as THREE from "three";

// ---------------------------------------------------------------------------
// Procedural canvas textures
//
// There are no image assets in this project and adding a texture pipeline for
// one interior would be the wrong trade. Canvas gets us most of the way: an
// untextured three.js room reads as grey boxes no matter how good the lighting
// is, and grain plus a matching roughness map fixes about eighty percent of
// that for a few hundred lines.
//
// Every generator returns { map, roughnessMap, normalScale-ish bumpMap } so the
// caller can hand them straight to MeshStandardMaterial.
// ---------------------------------------------------------------------------

const cache = new Map();

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function toTexture(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Value noise on a canvas, used as the base for most of these.
function noiseCanvas(size, scale, octaves = 4) {
  const c = canvas(size);
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);

  const grid = [];
  for (let o = 0; o < octaves; o++) {
    const n = Math.max(2, Math.floor(scale * Math.pow(2, o)));
    const vals = new Float32Array(n * n);
    for (let i = 0; i < vals.length; i++) vals[i] = Math.random();
    grid.push({ n, vals });
  }

  const sample = (layer, x, y) => {
    const { n, vals } = layer;
    // Tiling bilinear sample.
    const fx = x * n, fy = y * n;
    const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = vals[y0 * n + x0], b = vals[y0 * n + x1];
    const cc = vals[y1 * n + x0], d = vals[y1 * n + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (cc * (1 - sx) + d * sx) * sy;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1, norm = 0;
      for (const layer of grid) {
        v += sample(layer, x / size, y / size) * amp;
        norm += amp;
        amp *= 0.5;
      }
      v /= norm;
      const i = (y * size + x) * 4;
      const b = Math.floor(v * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Grey-scale canvas -> a bump map three can use directly. */
function bumpFrom(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// --- Wood -------------------------------------------------------------------
// Longitudinal grain with knots, plus plank seams. The seams do most of the
// work — a wall of continuous grain still reads as wallpaper.
export function wood({ size = 512, planks = 6, warm = 1 } = {}) {
  const key = `wood:${size}:${planks}:${warm}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(size);
  const g = c.getContext("2d");
  const n = noiseCanvas(size, 5, 4);
  const ng = n.getContext("2d").getImageData(0, 0, size, size).data;

  const base = [96 * warm, 66 * warm, 42 * warm];
  const img = g.createImageData(size, size);

  const plankH = size / planks;

  for (let y = 0; y < size; y++) {
    const plank = Math.floor(y / plankH);
    // Every plank gets its own tone and its own grain phase.
    const tone = 0.82 + ((plank * 0.37) % 1) * 0.36;
    const phase = (plank * 91.7) % size;

    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nv = ng[i] / 255;

      // Grain: rings running along the plank, wobbled by the noise.
      const rings = Math.sin((x + phase) * 0.16 + nv * 7.5) * 0.5 + 0.5;
      let v = 0.62 + rings * 0.24 + (nv - 0.5) * 0.22;
      v *= tone;

      // Seams, dark and slightly soft.
      const dy = y - plank * plankH;
      const edge = Math.min(dy, plankH - dy);
      if (edge < 2.0) v *= 0.34 + edge * 0.22;

      img.data[i]     = Math.min(255, base[0] * v);
      img.data[i + 1] = Math.min(255, base[1] * v);
      img.data[i + 2] = Math.min(255, base[2] * v);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // Knots — a few, dark, elliptical.
  for (let k = 0; k < planks; k++) {
    if (Math.random() > 0.55) continue;
    const kx = Math.random() * size;
    const ky = (Math.floor(Math.random() * planks) + 0.5) * plankH;
    const r = 5 + Math.random() * 9;
    for (let ring = 4; ring >= 1; ring--) {
      g.beginPath();
      g.ellipse(kx, ky, r * ring * 0.5, r * ring * 0.32, 0, 0, Math.PI * 2);
      g.strokeStyle = `rgba(38,24,14,${0.30 / ring})`;
      g.lineWidth = 2.2;
      g.stroke();
    }
    g.beginPath();
    g.ellipse(kx, ky, r * 0.4, r * 0.25, 0, 0, Math.PI * 2);
    g.fillStyle = "rgba(30,19,11,0.72)";
    g.fill();
  }

  const out = { map: toTexture(c), bumpMap: bumpFrom(n) };
  cache.set(key, out);
  return out;
}

// --- Stone ------------------------------------------------------------------
// Irregular blocks with mortar. Used for the hearth and the sleeping slab.
export function stone({ size = 512, cols = 5, rows = 7 } = {}) {
  const key = `stone:${size}:${cols}:${rows}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(size);
  const g = c.getContext("2d");
  const n = noiseCanvas(size, 9, 4);

  g.fillStyle = "#2b2b2c";           // mortar
  g.fillRect(0, 0, size, size);

  const cw = size / cols, ch = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * cw * 0.5;
    for (let i = -1; i <= cols; i++) {
      const x = i * cw + offset + 2;
      const y = r * ch + 2;
      const w = cw - 4 - Math.random() * 5;
      const h = ch - 4 - Math.random() * 3;
      const tone = 78 + Math.random() * 44;
      g.fillStyle = `rgb(${tone},${tone * 0.97},${tone * 0.92})`;
      g.beginPath();
      // Slightly irregular corners so nothing reads as a tiled rectangle.
      const j = () => (Math.random() - 0.5) * 4;
      g.moveTo(x + j(), y + j());
      g.lineTo(x + w + j(), y + j());
      g.lineTo(x + w + j(), y + h + j());
      g.lineTo(x + j(), y + h + j());
      g.closePath();
      g.fill();
    }
  }

  // Grain over the top, multiplied in.
  g.globalAlpha = 0.34;
  g.globalCompositeOperation = "multiply";
  g.drawImage(n, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  const out = { map: toTexture(c), bumpMap: bumpFrom(n) };
  cache.set(key, out);
  return out;
}

// --- Fur / hide -------------------------------------------------------------
// The bedding and the pelts. Short directional strokes over a mottled base.
export function fur({ size = 512, tint = [92, 74, 58] } = {}) {
  const key = `fur:${size}:${tint.join(",")}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(size);
  const g = c.getContext("2d");
  const n = noiseCanvas(size, 7, 4);

  g.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  g.fillRect(0, 0, size, size);
  g.globalAlpha = 0.5;
  g.globalCompositeOperation = "overlay";
  g.drawImage(n, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  for (let i = 0; i < size * 9; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const len = 4 + Math.random() * 11;
    const a = -0.5 + Math.random() * 1.0;
    const light = Math.random() > 0.5;
    g.strokeStyle = light
      ? `rgba(${tint[0] + 55},${tint[1] + 48},${tint[2] + 40},0.13)`
      : `rgba(${tint[0] * 0.4},${tint[1] * 0.4},${tint[2] * 0.4},0.15)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.sin(a) * len, y + Math.cos(a) * len);
    g.stroke();
  }

  const out = { map: toTexture(c), bumpMap: bumpFrom(n) };
  cache.set(key, out);
  return out;
}

// --- Parchment --------------------------------------------------------------
// For the chart on the wall. Same visual family as map.js so the two read as
// the same hand.
export function parchment({ size = 512 } = {}) {
  const key = `parchment:${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = canvas(size);
  const g = c.getContext("2d");
  const n = noiseCanvas(size, 6, 5);

  g.fillStyle = "#d8c6a0";
  g.fillRect(0, 0, size, size);
  g.globalAlpha = 0.28;
  g.globalCompositeOperation = "multiply";
  g.drawImage(n, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  // Foxing and edge burn.
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 3 + Math.random() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(120,88,44,0.10)");
    grad.addColorStop(1, "rgba(120,88,44,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const edge = g.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.72);
  edge.addColorStop(0, "rgba(90,64,30,0)");
  edge.addColorStop(1, "rgba(70,48,22,0.42)");
  g.fillStyle = edge;
  g.fillRect(0, 0, size, size);

  const out = { map: toTexture(c, 1), bumpMap: bumpFrom(n) };
  cache.set(key, out);
  return out;
}

/** Convenience: a MeshStandardMaterial wired to one of the generators above. */
export function material(gen, { repeat = 1, roughness = 0.85, bumpScale = 0.35, color = 0xffffff } = {}) {
  const { map, bumpMap } = gen;
  const m = map.clone();
  m.needsUpdate = true;
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  m.repeat.set(repeat, repeat);
  m.colorSpace = THREE.SRGBColorSpace;

  const b = bumpMap.clone();
  b.needsUpdate = true;
  b.wrapS = b.wrapT = THREE.RepeatWrapping;
  b.repeat.set(repeat, repeat);

  return new THREE.MeshStandardMaterial({
    map: m, bumpMap: b, bumpScale, roughness, metalness: 0, color,
  });
}
