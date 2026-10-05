import * as THREE from "three";

// ---------------------------------------------------------------------------
// The trees of the archipelago.
//
// Berk is the North Atlantic: the islands it borrows from are western Norway,
// the Faroes, the Hebrides and the Highlands, and the wood that grows there is
// a short list of very particular trees. Every one of them is here, grown from
// a skeleton rather than modelled, so no two of a kind are alike:
//
//   Norway spruce   dark, tall, a perfect spire of drooping skirts. The thick
//                   wood of the sheltered valleys, standing in its own gloom.
//   Scots pine      the Caledonian pine. A bare copper trunk and a flat,
//                   broken crown of blue-green clumps, held up high. Ridges,
//                   dry slopes, the edge of the moor.
//   Silver birch    white bark, black scars, a weeping crown of small bright
//                   leaves. First into any gap; the margins of every wood.
//   Rowan           small, upright, feathered leaves and red berries. The tree
//                   of Thor, planted by doors and graves against harm.
//   Sessile oak     low, broad and crooked, in the warm lowland hollows only.
//   Juniper         a dense blue-green shrub, up where nothing else will hold.
//   Wind pine       a Scots pine on an exposed headland, shorn flat and flagged
//                   downwind by a century of gales.
//
// Each species is a small program that grows a skeleton — branches as
// polylines with radii, leaves as cards hung off them — from a seed. The
// skeleton is turned into geometry twice: a HERO model, every branch and
// every leaf card, for the trees round you; and a MID model, the trunk and big
// limbs and a fifth of the leaves made five times the size, for the wood out
// to the draw distance. Beyond that, an IMPOSTER: the hero model photographed
// from the side and from above into an atlas, drawn as three cards.
//
// The textures — every leaf, needle and plate of bark — are painted here on
// canvases at load, so the whole forest is a few hundred kilobytes of code.
// ---------------------------------------------------------------------------

/** Small fast seeded generator. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

// ===========================================================================
// Textures
// ===========================================================================

function canvas(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

/** Value noise on a lattice, tileable in x over `px` cells. */
function makeNoise(seed) {
  const r = rng(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2), val = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; val[i] = r(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const h = (x, y) => val[perm[(perm[x & 255] + y) & 255]];
  const s = (t) => t * t * (3 - 2 * t);
  // Tileable in x with period `px` lattice cells.
  return (x, y, px = 256) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
    const a = h(x0, yi), b = h(x1, yi), c = h(x0, yi + 1), d = h(x1, yi + 1);
    const u = s(xf), v = s(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

/**
 * Paint a bark texture from a height function, and a normal map from the
 * same heights. `paint(u, v, n)` returns [height 0..1, r, g, b] in 0..255.
 */
function barkTextures(w, h, paint) {
  const c = canvas(w, h);
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [ht, r, gg, b] = paint(x / w, 1 - y / h, x, y);
      const i = y * w + x;
      H[i] = ht;
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const nc = canvas(w, h);
  const ng = nc.getContext("2d");
  const nimg = ng.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = H[y * w + ((x - 1 + w) % w)], rr = H[y * w + ((x + 1) % w)];
      const u = H[Math.max(0, y - 1) * w + x], d = H[Math.min(h - 1, y + 1) * w + x];
      const nx = (l - rr) * 4.0, ny = (d - u) * 4.0;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      nimg.data[i] = (nx * inv * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const nrm = new THREE.CanvasTexture(nc);
  for (const t of [map, nrm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map, nrm };
}

const BARK = {
  // Grey-brown, small rounded scales.
  spruce: () => {
    const n = makeNoise(11);
    return barkTextures(128, 256, (u, v) => {
      const sc = n(u * 24, v * 40, 24) * 0.6 + n(u * 48, v * 80, 48) * 0.4;
      const plate = Math.pow(sc, 1.6);
      const k = 0.55 + plate * 0.55;
      return [plate, 92 * k, 74 * k, 62 * k];
    });
  },
  // Deep grey-brown furrowed plates low down, peeling copper-orange high up.
  // The texture covers the whole trunk once, bottom to top.
  pine: () => {
    const n = makeNoise(23);
    return barkTextures(128, 512, (u, v) => {
      const plates = n(u * 10, v * 70, 10) * 0.7 + n(u * 30, v * 150, 30) * 0.3;
      const furrow = Math.pow(Math.abs(n(u * 7, v * 22, 7) - 0.5) * 2, 0.6);
      const upper = THREE.MathUtils.smoothstep(v + (n(u * 4, v * 9, 4) - 0.5) * 0.18, 0.38, 0.6);
      const ht = lerp(furrow * 0.7 + plates * 0.3, plates * 0.5 + 0.4, upper);
      const k = 0.45 + ht * 0.7;
      const low = [86 * k, 68 * k, 56 * k];
      const flake = n(u * 40, v * 120, 40);
      const hi = [lerp(176, 214, flake) * (0.7 + ht * 0.4), lerp(96, 128, flake) * (0.7 + ht * 0.4), lerp(58, 76, flake) * (0.7 + ht * 0.35)];
      return [ht, lerp(low[0], hi[0], upper), lerp(low[1], hi[1], upper), lerp(low[2], hi[2], upper)];
    });
  },
  // Chalk white, horizontal lenticels, black diamonds, rough and dark at the foot.
  birch: () => {
    const n = makeNoise(37);
    return barkTextures(128, 256, (u, v, x, y) => {
      const base = 0.86 + n(u * 6, v * 30, 6) * 0.12;
      const len = n(u * 5, v * 90, 5);
      const lent = len > 0.72 && Math.abs(Math.sin(v * 260 + n(u * 8, v * 8, 8) * 4)) > 0.8 ? 1 : 0;
      const scar = Math.pow(clamp((n(u * 3, v * 7, 3) - 0.62) * 4, 0, 1), 0.7);
      const dark = Math.max(lent * 0.85, scar);
      const ht = 0.7 - dark * 0.6 + n(u * 40, v * 60, 40) * 0.1;
      const peel = n(u * 12, v * 24, 12) > 0.7 ? 0.94 : 1;
      const r = lerp(232 * base * peel, 34, dark), gg = lerp(226 * base * peel, 32, dark), b = lerp(212 * base, 30, dark);
      return [ht, r, gg, b];
    });
  },
  // Smooth silver-grey with small lenticels.
  rowan: () => {
    const n = makeNoise(41);
    return barkTextures(128, 256, (u, v) => {
      const k = 0.78 + n(u * 8, v * 18, 8) * 0.22;
      const len = n(u * 18, v * 60, 18) > 0.8 ? 0.7 : 1;
      return [0.5 + (k - 0.78) * 2 - (1 - len) * 0.4, 128 * k * len, 122 * k * len, 112 * k * len];
    });
  },
  // Deep vertical fissures in dark grey.
  oak: () => {
    const n = makeNoise(53);
    return barkTextures(128, 256, (u, v) => {
      const wav = u * 9 + n(u * 4, v * 12, 4) * 1.8;
      const fiss = Math.pow(Math.abs(Math.sin(wav * Math.PI)), 0.35);
      const cross = n(u * 18, v * 26, 18);
      const ht = fiss * (0.75 + cross * 0.25);
      const k = 0.3 + ht * 0.7;
      return [ht, 98 * k, 92 * k, 82 * k];
    });
  },
  // Red-brown and stringy, peeling in long strips.
  juniper: () => {
    const n = makeNoise(67);
    return barkTextures(64, 256, (u, v) => {
      const s = n(u * 16, v * 6, 16) * 0.7 + n(u * 32, v * 12, 32) * 0.3;
      const k = 0.5 + s * 0.6;
      return [s, 120 * k, 74 * k, 56 * k];
    });
  },
};

// --- Foliage ---------------------------------------------------------------
// Every foliage card has its twig entering at the bottom centre and growing
// up, so a card is hung off a branch by its bottom edge.

function hsl(h, s, l) { return `hsl(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`; }

/** A curving twig from (x0,y0) toward angle a; returns sample points. */
function twigPath(r, x0, y0, a, len, steps = 8, bend = 0.25) {
  const pts = [[x0, y0]];
  let x = x0, y = y0, ang = a;
  for (let i = 0; i < steps; i++) {
    ang += (r() - 0.5) * bend;
    x += Math.cos(ang) * len / steps;
    y += Math.sin(ang) * len / steps;
    pts.push([x, y, ang]);
  }
  return pts;
}

function strokePath(g, pts, w0, w1, color) {
  g.strokeStyle = color;
  g.lineCap = "round";
  for (let i = 1; i < pts.length; i++) {
    g.lineWidth = lerp(w0, w1, i / pts.length);
    g.beginPath();
    g.moveTo(pts[i - 1][0], pts[i - 1][1]);
    g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }
}

/** A leaf blade along +y of the current transform, length L, width W. */
function leafBlade(g, L, W, shape, r) {
  g.beginPath();
  g.moveTo(0, 0);
  const N = 14;
  const edge = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let w;
    if (shape === "ovate") w = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9) * (1 - t * 0.25);
    else if (shape === "birch") w = Math.sin(Math.PI * Math.pow(t, 0.62)) * (1.05 - t * 0.5);
    else if (shape === "lance") w = Math.pow(Math.sin(Math.PI * t), 1.2);
    else if (shape === "oak") w = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.7) * (0.72 + 0.28 * Math.abs(Math.sin(t * Math.PI * 4.5)));
    else w = Math.sin(Math.PI * t);
    // A saw edge on the birch, a softer one on the rest.
    const saw = shape === "birch" ? (i % 2 ? 0.92 : 1.0) : 1.0;
    edge.push([w * W * 0.5 * saw, t * L]);
  }
  for (const [x, y] of edge) g.lineTo(x, -y);
  for (let i = edge.length - 1; i >= 0; i--) g.lineTo(-edge[i][0] * (0.94 + r() * 0.06), -edge[i][1]);
  g.closePath();
}

function broadleafCluster({ size = 512, seed, hue, sat, light, shape, leafL, leafW, count, twigs = 4,
                            pinnate = 0, berries = 0, hang = 0 }) {
  const r = rng(seed);
  const c = canvas(size);
  const g = c.getContext("2d");
  const S = size;
  const bark = "rgb(70,54,40)";
  // Main twig up the middle, side twigs off it.
  const main = twigPath(r, S * 0.5, S, -Math.PI / 2 + (r() - 0.5) * 0.3, S * 0.85, 10, 0.18);
  const all = [main];
  for (let i = 0; i < twigs; i++) {
    const p = main[2 + Math.floor(r() * (main.length - 4))];
    const side = r() < 0.5 ? -1 : 1;
    const a = p[2] + side * (0.6 + r() * 0.5) + hang * 0.6 * side;
    all.push(twigPath(r, p[0], p[1], a, S * (0.25 + r() * 0.3), 6, 0.3));
  }
  for (const t of all) strokePath(g, t, S * 0.012, S * 0.004, bark);

  const leafAt = (x, y, ang, scale, dark) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang + Math.PI / 2);
    const L = leafL * S * scale, W = leafW * S * scale;
    if (pinnate) {
      // Compound leaf: a rachis and pairs of leaflets, with one at the tip.
      g.strokeStyle = hsl(hue - 4, sat * 0.6, light * 0.8);
      g.lineWidth = S * 0.003;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L); g.stroke();
      const pairs = pinnate;
      for (let k = 0; k <= pairs; k++) {
        const t = 0.18 + (k / pairs) * 0.82;
        const ll = L * 0.36 * (1 - (k / pairs) * 0.25);
        const lh = hue + (r() - 0.5) * 8, ls = sat * (0.85 + r() * 0.3), lv = light * (0.75 + r() * 0.5) * (dark ? 0.7 : 1);
        for (const side of k === pairs ? [0] : [-1, 1]) {
          g.save();
          g.translate(0, -L * t);
          g.rotate(side * (1.15 + r() * 0.2));
          const gr = g.createLinearGradient(0, 0, 0, -ll);
          gr.addColorStop(0, hsl(lh, ls, lv * 0.85));
          gr.addColorStop(1, hsl(lh + 4, ls, lv * 1.12));
          g.fillStyle = gr;
          leafBlade(g, ll, ll * 0.32, "lance", r);
          g.fill();
          g.restore();
        }
      }
    } else {
      const lh = hue + (r() - 0.5) * 10, ls = sat * (0.8 + r() * 0.35);
      const lv = light * (0.72 + r() * 0.55) * (dark ? 0.65 : 1);
      const gr = g.createLinearGradient(-W * 0.5, 0, W * 0.5, -L);
      gr.addColorStop(0, hsl(lh, ls, lv * 0.82));
      gr.addColorStop(1, hsl(lh + 5, ls * 1.05, lv * 1.15));
      g.fillStyle = gr;
      leafBlade(g, L, W, shape, r);
      g.fill();
      // The midrib, a shade lighter.
      g.strokeStyle = hsl(lh + 6, ls * 0.7, Math.min(0.9, lv * 1.35));
      g.lineWidth = Math.max(1, S * 0.0025);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 0.85); g.stroke();
    }
    g.restore();
  };

  // Two layers: the leaves behind, darker and in shadow, then the ones in front.
  for (const dark of [true, false]) {
    for (let i = 0; i < count / 2; i++) {
      const t = all[Math.floor(r() * all.length)];
      const k = 1 + Math.floor(r() * (t.length - 1));
      const p = t[k];
      const side = r() < 0.5 ? -1 : 1;
      const ang = (p[2] ?? -Math.PI / 2) + side * (0.5 + r() * 0.9) + hang * (r() * 0.8);
      leafAt(p[0], p[1], ang, 0.75 + r() * 0.5, dark);
    }
  }
  // Rowan berries: tight bunches of scarlet, each with a highlight.
  for (let b = 0; b < berries; b++) {
    const t = all[1 + Math.floor(r() * (all.length - 1))];
    const p = t[t.length - 1];
    for (let i = 0; i < 18; i++) {
      const bx = p[0] + (r() - 0.5) * S * 0.07, by = p[1] + (r() - 0.3) * S * 0.06;
      const br = S * (0.007 + r() * 0.004);
      g.fillStyle = hsl(4 + r() * 10, 0.85, 0.36 + r() * 0.12);
      g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255,220,200,0.6)";
      g.beginPath(); g.arc(bx - br * 0.3, by - br * 0.3, br * 0.3, 0, Math.PI * 2); g.fill();
    }
  }
  return c;
}

/** Needles in bundles off a twig: Scots pine clumps, juniper sprigs. */
function needleCluster({ size = 512, seed, hue, sat, light, needleL, perFascicle, fascicles,
                         spread = 2.2, twigs = 3, berries = 0, width = 2, clump = false }) {
  const r = rng(seed);
  const c = canvas(size);
  const g = c.getContext("2d");
  const S = size;
  if (clump) {
    // A Scots pine's foliage is not sprigs but brushes: tufts of paired
    // needles packed round the ends of the shoots, a rounded mass with a
    // bristling edge. Shoots fan up from the bottom into it; every bundle
    // splays outward from the middle of the mass.
    const cx = S * 0.5, cy = S * 0.46, rx = S * 0.36, ry = S * 0.3;
    for (let i = 0; i < 7; i++) {
      const tx = cx + (r() - 0.5) * rx * 1.4, ty = cy + (r() - 0.5) * ry * 1.2;
      strokePath(g, [[S * 0.5, S], [lerp(S * 0.5, tx, 0.5), lerp(S, ty, 0.55)], [tx, ty]], S * 0.016, S * 0.006, "rgb(110,70,46)");
    }
    for (const dark of [true, false]) {
      for (let f = 0; f < fascicles / 2; f++) {
        // Denser in the middle of the mass than at its edge.
        const a0 = r() * TAU, rr = Math.pow(r(), 0.7);
        const px = cx + Math.cos(a0) * rx * rr, py = cy + Math.sin(a0) * ry * rr;
        const out = Math.atan2(py - cy - ry * 0.3, px - cx);
        for (let i = 0; i < perFascicle; i++) {
          const a = out + (r() - 0.5) * spread;
          const L = needleL * S * (0.6 + r() * 0.6) * (dark ? 0.85 : 1);
          const lv = light * (0.72 + r() * 0.55) * (dark ? 0.6 : 1) * (1 + (cy - py) / S * 0.6);
          g.strokeStyle = hsl(hue + (r() - 0.5) * 12, sat * (0.8 + r() * 0.4), lv);
          g.lineWidth = width * (0.8 + r() * 0.5);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(px, py);
          g.quadraticCurveTo(px + Math.cos(a) * L * 0.5, py + Math.sin(a) * L * 0.5 - L * 0.08,
            px + Math.cos(a) * L, py + Math.sin(a) * L);
          g.stroke();
        }
      }
    }
    return c;
  }
  const main = twigPath(r, S * 0.5, S, -Math.PI / 2, S * 0.8, 8, 0.2);
  const all = [main];
  for (let i = 0; i < twigs; i++) {
    const p = main[3 + Math.floor(r() * (main.length - 4))];
    const side = r() < 0.5 ? -1 : 1;
    all.push(twigPath(r, p[0], p[1], p[2] + side * (0.4 + r() * 0.5), S * (0.3 + r() * 0.3), 6, 0.25));
  }
  for (const t of all) strokePath(g, t, S * 0.014, S * 0.006, "rgb(96,64,44)");
  for (const dark of [true, false]) {
    for (let f = 0; f < fascicles / 2; f++) {
      const t = all[Math.floor(r() * all.length)];
      const k = 1 + Math.floor(r() * (t.length - 1));
      const [px, py, pa = -Math.PI / 2] = t[k];
      for (let i = 0; i < perFascicle; i++) {
        const a = pa + (r() - 0.5) * spread;
        const L = needleL * S * (0.7 + r() * 0.5);
        const lv = light * (0.7 + r() * 0.6) * (dark ? 0.62 : 1);
        g.strokeStyle = hsl(hue + (r() - 0.5) * 12, sat * (0.8 + r() * 0.4), lv);
        g.lineWidth = width * (0.8 + r() * 0.5);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(px, py);
        const cx = px + Math.cos(a) * L * 0.5 + (r() - 0.5) * L * 0.15;
        const cy = py + Math.sin(a) * L * 0.5 + (r() - 0.5) * L * 0.15;
        g.quadraticCurveTo(cx, cy, px + Math.cos(a) * L, py + Math.sin(a) * L);
        g.stroke();
      }
    }
  }
  for (let b = 0; b < berries; b++) {
    const x = S * (0.25 + r() * 0.5), y = S * (0.2 + r() * 0.6), br = S * 0.012;
    g.fillStyle = hsl(225, 0.25, 0.32);
    g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(200,210,235,0.55)";
    g.beginPath(); g.arc(x, y, br * 0.75, 0, Math.PI * 2); g.fill();
  }
  return c;
}

/**
 * A spruce spray: a flat frond of short needles packed both sides of a twig
 * and its side shoots, which is what a spruce bough is from any distance.
 */
function spruceSpray({ size = 512, seed, hue, sat, light }) {
  const r = rng(seed);
  const c = canvas(size);
  const g = c.getContext("2d");
  const S = size;
  const main = twigPath(r, S * 0.5, S * 0.98, -Math.PI / 2, S * 0.92, 10, 0.1);
  const shoots = [main];
  for (let i = 1; i < main.length - 1; i++) {
    for (const side of [-1, 1]) {
      if (r() < 0.1) continue;
      const p = main[i];
      const t = i / main.length;
      const len = S * (0.38 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 0.06) * (0.7 + r() * 0.4);
      // Side shoots point forward and droop: the comb of a Norway spruce.
      shoots.push(twigPath(r, p[0], p[1], p[2] + side * (0.75 + r() * 0.25), len, 6, 0.12));
    }
  }
  for (const t of shoots) strokePath(g, t, S * 0.008, S * 0.003, "rgb(88,66,48)");
  for (const dark of [true, false]) {
    for (const t of shoots) {
      for (let k = 1; k < t.length; k++) {
        const [px, py, pa = -Math.PI / 2] = t[k];
        const n = t === main ? 16 : 12;
        for (let i = 0; i < n / 2; i++) {
          const side = r() < 0.5 ? -1 : 1;
          const a = pa + side * (0.7 + r() * 0.5) - 0.2;
          const L = S * (0.022 + r() * 0.016);
          g.strokeStyle = hsl(hue + (r() - 0.5) * 8, sat * (0.8 + r() * 0.4),
            light * (0.65 + r() * 0.6) * (dark ? 0.6 : 1));
          g.lineWidth = S * 0.006;
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(px + (r() - 0.5) * 3, py + (r() - 0.5) * 3);
          g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
          g.stroke();
        }
      }
    }
  }
  return c;
}

const LEAVES = {
  spruce: () => spruceSpray({ seed: 5, hue: 120, sat: 0.32, light: 0.33 }),
  pine: () => needleCluster({ seed: 7, hue: 140, sat: 0.26, light: 0.4, needleL: 0.1,
    perFascicle: 14, fascicles: 150, spread: 1.6, width: 2.4, clump: true }),
  birch: () => broadleafCluster({ seed: 9, hue: 76, sat: 0.52, light: 0.44, shape: "birch",
    leafL: 0.09, leafW: 0.07, count: 320, twigs: 7, hang: 0.5 }),
  rowan: () => broadleafCluster({ seed: 13, hue: 90, sat: 0.44, light: 0.37, shape: "lance",
    leafL: 0.3, leafW: 0.1, count: 48, twigs: 5, pinnate: 6, berries: 3 }),
  oak: () => broadleafCluster({ seed: 17, hue: 84, sat: 0.42, light: 0.34, shape: "oak",
    leafL: 0.13, leafW: 0.08, count: 220, twigs: 6 }),
  juniper: () => needleCluster({ seed: 19, hue: 160, sat: 0.22, light: 0.44, needleL: 0.05,
    perFascicle: 9, fascicles: 240, spread: 1.7, twigs: 7, berries: 7, width: 3 }),
};

// ===========================================================================
// Skeletons
// ===========================================================================

/**
 * A branch: a polyline grown from p0 along dir, bent each step by gravity
 * (droop), light (lift), wind (a sideways push) and a wobble.
 */
function grow(r, p0, dir, len, segs, { gravity = 0, lift = 0, wobble = 0.1, wind = null, curl = 0 } = {}) {
  const pts = [p0.clone()];
  const dirs = [dir.clone().normalize()];
  const d = dir.clone().normalize();
  const step = len / segs;
  const p = p0.clone();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    d.y += (-gravity + lift * t) * step * 0.1;
    if (curl) d.y += curl * t * t * step * 0.1;
    d.x += (r() - 0.5) * wobble * step * 0.2;
    d.y += (r() - 0.5) * wobble * step * 0.12;
    d.z += (r() - 0.5) * wobble * step * 0.2;
    if (wind) d.addScaledVector(wind, step * 0.1);
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
    dirs.push(d.clone());
  }
  return { pts, dirs, len };
}

/** Point and direction a fraction t along a grown branch. */
function along(b, t) {
  const f = clamp(t, 0, 1) * (b.pts.length - 1);
  const i = Math.min(b.pts.length - 2, Math.floor(f));
  const k = f - i;
  return {
    p: b.pts[i].clone().lerp(b.pts[i + 1], k),
    d: b.dirs[i].clone().lerp(b.dirs[i + 1], k).normalize(),
  };
}

/** A direction at `angle` off `axis`, turned `azimuth` around it. */
function offAxis(axis, angle, azimuth) {
  const a = axis.clone().normalize();
  const ref = Math.abs(a.y) < 0.95 ? UP : V(1, 0, 0);
  const p1 = V().crossVectors(a, ref).normalize();
  const p2 = V().crossVectors(a, p1).normalize();
  const perp = p1.multiplyScalar(Math.cos(azimuth)).addScaledVector(p2, Math.sin(azimuth));
  return a.multiplyScalar(Math.cos(angle)).addScaledVector(perp, Math.sin(angle)).normalize();
}

/** Direction at an elevation above horizontal (radians), bearing az. */
function elevDir(elev, az) {
  return V(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az));
}

/**
 * The skeleton every species builds: branches (polylines with radii, a level,
 * how many sides their tube gets) and leaf cards (where, which way, how big).
 */
class Skeleton {
  constructor() { this.branches = []; this.leaves = []; }
  branch(b, r0, r1, level, sides, vScale = 1) {
    b.r0 = r0; b.r1 = r1; b.level = level; b.sides = sides; b.vScale = vScale;
    this.branches.push(b);
    return b;
  }
  /**
   * A card hung from `at`, growing along `up`, facing roughly `face`.
   * w, h in metres.
   */
  leaf(at, up, face, w, h) {
    const v = up.clone().normalize();
    const n = face.clone().addScaledVector(v, -face.dot(v));
    if (n.lengthSq() < 1e-6) n.copy(offAxis(v, Math.PI / 2, 0));
    n.normalize();
    const u = V().crossVectors(v, n).normalize();
    this.leaves.push({ at: at.clone(), u, v, n, w, h });
  }
}

const TAU = Math.PI * 2;
const GOLD = 2.39996;

const SPECIES = {};

// --- Norway spruce ---------------------------------------------------------
SPECIES.spruce = {
  sway: 1.0,
  build(r) {
    const S = new Skeleton();
    const H = 15 + r() * 6;
    const trunk = grow(r, V(), V((r() - 0.5) * 0.04, 1, (r() - 0.5) * 0.04), H, 9, { wobble: 0.03 });
    S.branch(trunk, H * 0.014, 0.02, 0, 7, 0.25);
    const y0 = H * (0.06 + r() * 0.06);
    let az = r() * TAU;
    for (let y = y0; y < H * 0.97; y += 0.42 + r() * 0.25) {
      const t = (y - y0) / (H - y0);
      const n = 4 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        az += TAU / n + (r() - 0.5) * 0.5;
        const L = (H * 0.25 * Math.pow(1 - t, 0.9) + 0.4) * (0.8 + r() * 0.35);
        const { p } = along(trunk, y / H);
        const elev = lerp(-0.3, 0.35, t) + (r() - 0.5) * 0.2;
        // Down from the trunk, then the tip turns up: a spruce's skirt.
        const b = grow(r, p, elevDir(elev, az), L, 4, { gravity: 0.9, lift: 2.2, wobble: 0.15 });
        S.branch(b, 0.025 + L * 0.012, 0.006, 1, 3);
        const sprays = Math.max(2, Math.round(L / 0.55));
        for (let i = 0; i < sprays; i++) {
          const tt = 0.2 + (i / sprays) * 0.8;
          const { p: sp, d } = along(b, tt);
          const side = V().crossVectors(d, UP).normalize();
          const len = Math.min(1.9, L * 0.45 + 0.3) * (0.85 + r() * 0.3);
          // Two cards per spray: one lying flat along the bough, one hanging
          // off it at an angle, so it has a curtain and not just a shelf.
          const flat = side.clone().cross(d).normalize();
          if (flat.y < 0) flat.negate();
          S.leaf(sp, d, flat.clone().lerp(V(0, -1, 0), 0.25), len * 0.75, len);
          S.leaf(sp, d.clone().lerp(V(0, -1, 0), 0.35), side.clone().multiplyScalar(r() < 0.5 ? 1 : -1), len * 0.6, len * 0.85);
        }
      }
    }
    // The leader: an upright spray or two at the very top.
    const top = trunk.pts[trunk.pts.length - 1];
    for (let k = 0; k < 2; k++) S.leaf(top.clone().addScaledVector(UP, -1.1), UP, elevDir(0, k * Math.PI / 2), 0.9, 1.6);
    return S;
  },
};

// --- Scots pine ------------------------------------------------------------
function pine(r, { H, windward = null }) {
  const S = new Skeleton();
  const lean = windward ? windward.clone().multiplyScalar(0.18 + r() * 0.12) : V((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);
  const trunk = grow(r, V(), V(lean.x, 1, lean.z), H, 9, { wobble: 0.22, wind: windward ? windward.clone().multiplyScalar(0.05) : null });
  // v covers the trunk once, bottom to top: the bark texture is grey below
  // and copper above.
  S.branch(trunk, H * 0.022, H * 0.006, 0, 7, 1 / H * 6.5);
  const c0 = windward ? 0.45 : 0.5 + r() * 0.12;
  const n1 = windward ? 9 + Math.floor(r() * 4) : 11 + Math.floor(r() * 5);
  for (let i = 0; i < n1; i++) {
    const t = c0 + (1 - c0) * (i / n1) * 0.97 + (r() - 0.5) * 0.03;
    const ct = (t - c0) / (1 - c0);
    const { p } = along(trunk, t);
    const az = i * GOLD + r() * 0.7;
    let dir = elevDir(lerp(0.2, 0.55, r()) - ct * 0.15, az);
    let L = H * 0.3 * (0.55 + 0.45 * Math.sin(Math.PI * (0.25 + 0.7 * ct))) * (0.75 + r() * 0.45);
    if (windward) {
      // Flagged: the windward side is shorn, the lee side streams.
      const lee = -dir.x * windward.x - dir.z * windward.z;
      L *= lee > 0 ? 0.35 + (1 - lee) * 0.3 : 1 + -lee * 0.4;
      dir = dir.addScaledVector(windward, 0.6).normalize();
      dir.y *= 0.5;
    }
    const b = grow(r, p, dir, L, 4, { lift: 1.2, gravity: 0.25, wobble: 0.5, wind: windward ? windward.clone().multiplyScalar(0.3) : null });
    S.branch(b, 0.04 + L * 0.018, 0.012, 1, 4);
    const n2 = 3 + Math.floor(r() * 3);
    const tips = [b];
    for (let k = 0; k < n2; k++) {
      const tt = 0.35 + (k / n2) * 0.6;
      const { p: q, d } = along(b, tt);
      const d2 = offAxis(d, 0.55 + r() * 0.4, r() * TAU);
      d2.y = Math.abs(d2.y) * 0.6 + 0.15;
      const b2 = grow(r, q, d2, L * (0.35 + r() * 0.2), 3, { lift: 1.5, wobble: 0.6, wind: windward ? windward.clone().multiplyScalar(0.3) : null });
      S.branch(b2, 0.02, 0.006, 2, 3);
      tips.push(b2);
    }
    // Needles in rounded clumps at the ends, held up to the light.
    for (const tb of tips) {
      const end = tb.pts[tb.pts.length - 1];
      const sz = (1.3 + r() * 0.9) * (windward ? 0.85 : 1);
      const c = end.clone().addScaledVector(UP, sz * 0.15);
      for (let k = 0; k < 3; k++) {
        const face = elevDir(0, k * (TAU / 3) + r());
        const upd = UP.clone().lerp(tb.dirs[tb.dirs.length - 1], 0.4).normalize();
        S.leaf(c.clone().addScaledVector(upd, -sz * 0.45), upd, face, sz * 1.15, sz);
      }
      S.leaf(c.clone().addScaledVector(UP, -0.1), V(0, 0.15, 1).normalize(), UP, sz * 1.1, sz);
    }
  }
  return S;
}
SPECIES.pine = { sway: 0.8, build: (r) => pine(r, { H: 13 + r() * 6 }) };
// Wind blows toward +x in the model; the scatter turns each one to the gale.
SPECIES.windpine = { sway: 0.5, build: (r) => pine(r, { H: 6 + r() * 3, windward: V(1, 0, 0) }) };

// --- Silver birch ----------------------------------------------------------
SPECIES.birch = {
  sway: 1.4,
  build(r) {
    const S = new Skeleton();
    const H = 11 + r() * 6;
    const stems = r() < 0.3 ? 2 : 1;
    for (let s = 0; s < stems; s++) {
      const lean = stems > 1 ? elevDir(1.35, s * Math.PI + r()) : V((r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12);
      const h = H * (s ? 0.85 : 1);
      const trunk = grow(r, V(), lean, h, 8, { wobble: 0.25, lift: 0.3 });
      S.branch(trunk, h * 0.013, 0.015, 0, 6, 0.35);
      const n1 = 16 + Math.floor(r() * 7);
      for (let i = 0; i < n1; i++) {
        const t = 0.32 + (i / n1) * 0.66;
        const ct = (t - 0.32) / 0.68;
        const { p } = along(trunk, t);
        const L = h * 0.3 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * ct)), 0.7) * (0.75 + r() * 0.4);
        // Up and out, arching over, then falling: a weeping birch.
        const b = grow(r, p, elevDir(0.75 + r() * 0.35 - ct * 0.2, i * GOLD), L, 4, { gravity: 1.3, lift: 0.4, wobble: 0.4 });
        S.branch(b, 0.025 + L * 0.008, 0.006, 1, 3);
        const n2 = 5 + Math.floor(r() * 3);
        for (let k = 0; k < n2; k++) {
          const { p: q, d } = along(b, 0.25 + (k / n2) * 0.75);
          const d2 = offAxis(d, 0.5, r() * TAU);
          const hangL = L * (0.4 + r() * 0.3);
          const tw = grow(r, q, d2, hangL, 2, { gravity: 4.0, wobble: 0.3 });
          S.branch(tw, 0.009, 0.003, 2, 3);
          const nl = 4 + Math.floor(r() * 2);
          for (let j = 0; j < nl; j++) {
            const { p: lp, d: ld } = along(tw, 0.25 + (j / nl) * 0.75);
            const out = lp.clone().setY(0).normalize();
            S.leaf(lp, ld.clone().lerp(V(0, -1, 0), 0.3), out.lengthSq() ? out : V(1, 0, 0), 0.75 + r() * 0.25, 0.8 + r() * 0.25);
          }
        }
      }
    }
    return S;
  },
};

// --- Rowan -----------------------------------------------------------------
SPECIES.rowan = {
  sway: 1.2,
  build(r) {
    const S = new Skeleton();
    const H = 6 + r() * 3.5;
    const trunk = grow(r, V(), V((r() - 0.5) * 0.15, 1, (r() - 0.5) * 0.15), H * 0.55, 5, { wobble: 0.3 });
    S.branch(trunk, H * 0.022, H * 0.012, 0, 6, 0.4);
    const top = trunk.pts[trunk.pts.length - 1];
    const n1 = 5 + Math.floor(r() * 3);
    for (let i = 0; i < n1; i++) {
      const start = i < 2 ? top : along(trunk, 0.55 + r() * 0.4).p;
      const L = H * (0.4 + r() * 0.25);
      const b = grow(r, start, elevDir(0.85 + r() * 0.45, i * GOLD + r()), L, 4, { lift: 0.6, wobble: 0.45 });
      S.branch(b, H * 0.01, 0.01, 1, 4);
      const n2 = 3 + Math.floor(r() * 2);
      for (let k = 0; k < n2; k++) {
        const { p: q, d } = along(b, 0.35 + (k / n2) * 0.65);
        const b2 = grow(r, q, offAxis(d, 0.6, r() * TAU), L * 0.4, 2, { lift: 0.8, wobble: 0.5 });
        S.branch(b2, 0.015, 0.005, 2, 3);
        const end = b2.pts[b2.pts.length - 1];
        for (let j = 0; j < 3; j++) {
          const { p: lp, d: ld } = along(b2, 0.4 + j * 0.3);
          S.leaf(lp, ld.clone().lerp(UP, 0.3), elevDir(0, r() * TAU), 1.0 + r() * 0.3, 1.0 + r() * 0.3);
        }
        S.leaf(end, UP.clone().lerp(ld0(b2), 0.5), elevDir(0, r() * TAU), 1.1, 1.1);
      }
    }
    return S;
  },
};
function ld0(b) { return b.dirs[b.dirs.length - 1]; }

// --- Sessile oak -----------------------------------------------------------
SPECIES.oak = {
  sway: 0.7,
  build(r) {
    const S = new Skeleton();
    const H = 10 + r() * 4;
    const bole = H * (0.28 + r() * 0.12);
    const trunk = grow(r, V(), V((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), bole, 4, { wobble: 0.4 });
    S.branch(trunk, H * 0.045, H * 0.032, 0, 8, 0.45);
    const top = trunk.pts[trunk.pts.length - 1];
    const limbs = 3 + Math.floor(r() * 2);
    for (let i = 0; i < limbs; i++) {
      // Big crooked limbs, each one going its own way.
      const L = H * (0.42 + r() * 0.15);
      const b = grow(r, top.clone().addScaledVector(UP, -r() * 0.6), elevDir(0.55 + r() * 0.5, i * (TAU / limbs) + r() * 0.8), L, 5, { lift: 0.4, gravity: 0.2, wobble: 1.1 });
      S.branch(b, H * 0.026, H * 0.008, 1, 5);
      const n2 = 4 + Math.floor(r() * 3);
      for (let k = 0; k < n2; k++) {
        const { p: q, d } = along(b, 0.3 + (k / n2) * 0.7);
        const b2 = grow(r, q, offAxis(d, 0.6 + r() * 0.4, r() * TAU), L * (0.45 + r() * 0.2), 3, { lift: 0.5, wobble: 1.0 });
        b2.dirs.forEach((dd) => { dd.y = Math.max(dd.y, -0.2); });
        S.branch(b2, 0.05, 0.015, 2, 3);
        // Leaves along the bough as well as at its twigs: an oak crown is
        // a dense, lumpy dome, not a few tufts on sticks.
        for (let j = 0; j < 3; j++) {
          const { p: lp, d: ld } = along(b2, 0.35 + j * 0.25);
          S.leaf(lp, ld.clone().lerp(UP, 0.5), elevDir(0, r() * TAU), 1.4 + r() * 0.4, 1.3 + r() * 0.4);
        }
        for (let j = 0; j < 4; j++) {
          const { p: q3, d: d3 } = along(b2, 0.3 + j * 0.22);
          const b3 = grow(r, q3, offAxis(d3, 0.7, r() * TAU), 1.2 + r() * 0.8, 2, { lift: 0.6, wobble: 1.0 });
          S.branch(b3, 0.018, 0.005, 3, 3);
          const end = b3.pts[b3.pts.length - 1];
          for (let m = 0; m < 3; m++) {
            S.leaf(end.clone().addScaledVector(UP, -0.6), UP.clone().lerp(ld0(b3), 0.4), elevDir(0, r() * TAU), 1.6 + r() * 0.5, 1.5 + r() * 0.5);
          }
        }
      }
    }
    return S;
  },
};

// --- Juniper ---------------------------------------------------------------
SPECIES.juniper = {
  sway: 0.4,
  build(r) {
    const S = new Skeleton();
    const H = 2.8 + r() * 2.4;
    const stems = 9 + Math.floor(r() * 4);
    for (let i = 0; i < stems; i++) {
      const b = grow(r, V((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3), elevDir(1.1 + r() * 0.35, i * GOLD), H * (0.75 + r() * 0.3), 3, { lift: 0.8, wobble: 0.6 });
      S.branch(b, 0.04, 0.01, 1, 3);
      const n = 8 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const { p, d } = along(b, 0.05 + (k / n) * 0.9);
        const out = p.clone().setY(0);
        if (out.lengthSq() < 1e-4) out.set(Math.cos(i), 0, Math.sin(i));
        out.normalize().applyAxisAngle(UP, (r() - 0.5) * 1.2);
        S.leaf(p.clone().addScaledVector(out, -0.15), d.clone().lerp(UP, 0.6), out, 1.0 + r() * 0.35, 1.1 + r() * 0.4);
      }
    }
    return S;
  },
};

export const SPECIES_NAMES = ["spruce", "pine", "birch", "rowan", "oak", "juniper", "windpine"];

// ===========================================================================
// Geometry
// ===========================================================================

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  vert(p, n, u, v, ao) {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(u, v); this.col.push(ao, ao, ao);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** A tapered tube along a branch, parallel-transport framed. */
function tube(B, br, sides, segStride, aoFn) {
  const pts = br.pts;
  const count = pts.length;
  const keep = [];
  for (let i = 0; i < count; i += segStride) keep.push(i);
  if (keep[keep.length - 1] !== count - 1) keep.push(count - 1);
  let n = offAxis(br.dirs[0], Math.PI / 2, 0);
  let prevD = br.dirs[0].clone();
  const base = B.n;
  let vAcc = 0;
  const circ = TAU * br.r0;
  keep.forEach((i, row) => {
    const d = br.dirs[i];
    // Parallel transport: turn the frame by the turn of the tangent.
    const q = new THREE.Quaternion().setFromUnitVectors(prevD, d);
    n.applyQuaternion(q);
    prevD = d.clone();
    const b = V().crossVectors(d, n).normalize();
    n = V().crossVectors(b, d).normalize();
    const t = i / (count - 1);
    const rad = lerp(br.r0, br.r1, Math.pow(t, 0.8));
    if (row > 0) vAcc += pts[i].distanceTo(pts[keep[row - 1]]);
    const v = (vAcc / Math.max(circ, 0.05)) * br.vScale * (br.level === 0 && br.vScale < 0.2 ? 1 : 0.5);
    const ao = aoFn(pts[i]);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * TAU;
      const dir = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      B.vert(pts[i].clone().addScaledVector(dir, rad), dir, s / sides, br.vScale < 0.2 ? vAcc * br.vScale : v, ao);
    }
  });
  const ring = sides + 1;
  for (let row = 0; row < keep.length - 1; row++) {
    for (let s = 0; s < sides; s++) {
      const a = base + row * ring + s, b = a + ring, c = b + 1, d = a + 1;
      B.idx.push(a, b, d, b, c, d);
    }
  }
}

/**
 * Turn a skeleton into geometry. `lod` 0 is the hero model; 1 the mid model.
 * Returns { bark, leaves, info } with info = height, crown centre and radius.
 */
function buildGeometry(S, lod, r) {
  // Crown: centroid and mean radius of the leaves, for the leaf normals and AO.
  const c = V();
  for (const l of S.leaves) c.add(l.at);
  c.multiplyScalar(1 / Math.max(1, S.leaves.length));
  let R = 0, top = 0, minLeafY = Infinity, maxR = 0;
  for (const l of S.leaves) {
    R += l.at.distanceTo(c);
    top = Math.max(top, l.at.y + l.h);
    minLeafY = Math.min(minLeafY, l.at.y);
    maxR = Math.max(maxR, Math.hypot(l.at.x, l.at.z) + l.w * 0.5);
  }
  R = R / Math.max(1, S.leaves.length) * 1.25 + 0.3;
  for (const b of S.branches) for (const p of b.pts) top = Math.max(top, p.y);

  const inCrown = (p) => {
    const d = p.distanceTo(c) / R;
    return THREE.MathUtils.smoothstep(d, 0.1, 1.05);
  };

  const bark = new Builder();
  for (const br of S.branches) {
    if (lod === 1 && br.level >= (S.midLevels ?? 2)) continue;
    const sides = lod === 0 ? br.sides : Math.max(3, br.sides - 2);
    const stride = lod === 0 ? 1 : 2;
    tube(bark, br, sides, stride, (p) => {
      // Dark at the foot and deep in the crown, lit where it reaches out.
      const foot = THREE.MathUtils.smoothstep(p.y, 0, 2.5);
      return (0.45 + 0.55 * inCrown(p)) * (0.6 + 0.4 * foot) * (br.level === 0 ? 1 : 0.92);
    });
  }

  const leaves = new Builder();
  const keep = lod === 0 ? 1 : (S.midKeep ?? 0.22);
  const grow = lod === 0 ? 1 : Math.min(2.4, 0.85 / Math.sqrt(keep));
  for (const l of S.leaves) {
    if (lod === 1 && r() > keep) continue;
    const w = l.w * grow, h = l.h * grow;
    const ao = 0.55 + 0.45 * inCrown(l.at);
    // Lower crown darker: the light comes from above.
    const hk = 0.8 + 0.2 * THREE.MathUtils.smoothstep(l.at.y, minLeafY, top);
    const tint = 0.88 + r() * 0.24;
    const base = leaves.n;
    for (let k = 0; k < 4; k++) {
      const uu = k === 1 || k === 2 ? 1 : 0;
      const vv = k >= 2 ? 1 : 0;
      const p = l.at.clone().addScaledVector(l.u, (uu - 0.5) * w).addScaledVector(l.v, vv * h);
      // Mostly the normal of a sphere round the crown: a crown is lit as one
      // soft mass, not as a few hundred flat cards.
      const sph = p.clone().sub(c).normalize();
      const nn = l.n.clone().multiplyScalar(0.3).addScaledVector(sph, 0.7).normalize();
      leaves.vert(p, nn, uu, vv, ao * hk * tint);
    }
    leaves.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    bark: bark.geometry(),
    leaves: leaves.geometry(),
    info: { height: top, crown: c, crownR: R, width: maxR * 2 },
  };
}

// ===========================================================================
// Kinds: species x variant
// ===========================================================================

const VARIANTS = { spruce: 4, pine: 4, birch: 3, rowan: 3, oak: 3, juniper: 3, windpine: 3 };

/**
 * Build every kind of tree. Each kind has a hero and a mid geometry pair and
 * a reference to its species' materials.
 */
export function buildKinds() {
  const kinds = [];
  let seed = 1000;
  for (const name of SPECIES_NAMES) {
    const sp = SPECIES[name];
    for (let v = 0; v < VARIANTS[name]; v++) {
      const r = rng(seed += 7919);
      const S = sp.build(r);
      S.midLevels = { spruce: 1, pine: 2, birch: 2, rowan: 2, oak: 2, juniper: 2, windpine: 2 }[name];
      S.midKeep = { spruce: 0.3, pine: 0.4, birch: 0.18, rowan: 0.3, oak: 0.25, juniper: 0.35, windpine: 0.4 }[name];
      const hero = buildGeometry(S, 0, rng(seed + 1));
      const mid = buildGeometry(S, 1, rng(seed + 2));
      kinds.push({ species: name, variant: v, hero, mid, info: hero.info, sway: sp.sway });
    }
  }
  return kinds;
}

/** Bark and foliage textures, one set per species (windpine shares pine's). */
export function buildTextures() {
  const out = {};
  for (const name of SPECIES_NAMES) {
    const key = name === "windpine" ? "pine" : name;
    if (out[key]) { out[name] = out[key]; continue; }
    const bark = BARK[key]();
    const lc = LEAVES[key]();
    const leaf = new THREE.CanvasTexture(lc);
    leaf.colorSpace = THREE.SRGBColorSpace;
    leaf.anisotropy = 4;
    out[name] = { bark: bark.map, barkN: bark.nrm, leaf };
  }
  return out;
}

// ===========================================================================
// Imposters
// ===========================================================================

export const ATLAS = { w: 2048, h: 2304, sideW: 256, sideH: 512, topS: 256, cols: 8 };

/**
 * Photograph every kind from the side and from above into one atlas. Unlit
 * albedo with the baked AO, which the far cards then light as a crown.
 *
 * Returns the atlas texture, and per kind: the side card's size in metres at
 * scale 1 and the two uv rectangles.
 */
export function bakeImposters(renderer, kinds, textures) {
  const { w, h, sideW, sideH, topS, cols } = ATLAS;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const mats = {};
  for (const name of SPECIES_NAMES) {
    const t = textures[name];
    mats[name] = {
      bark: new THREE.MeshBasicMaterial({ map: t.bark, vertexColors: true }),
      leaf: new THREE.MeshBasicMaterial({ map: t.leaf, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide }),
    };
  }

  const prev = {
    rt: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(), tone: renderer.toneMapping,
  };
  renderer.toneMapping = THREE.NoToneMapping;
  // A clear colour close to the foliage, at zero alpha, so the mips that blend
  // the card's edge into nothing blend into green and not into black.
  renderer.setClearColor(0x26331f, 0);
  renderer.setRenderTarget(rt);
  renderer.clear(true, true, true);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const out = [];
  kinds.forEach((k, i) => {
    const meshB = new THREE.Mesh(k.hero.bark, mats[k.species].bark);
    const meshL = new THREE.Mesh(k.hero.leaves, mats[k.species].leaf);
    scene.add(meshB, meshL);
    const box = new THREE.Box3().setFromObject(meshL).union(new THREE.Box3().setFromObject(meshB));
    const half = Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z) * 1.02;
    let cw = half * 2, ch = box.max.y * 1.02;
    // Fit to the 1:2 cell without distorting: whichever side is short grows.
    if (ch > cw * 2) cw = ch / 2; else ch = cw * 2;

    // Side.
    const col = i % cols, row = Math.floor(i / cols);
    const sx = col * sideW, sy = row * sideH;
    cam.left = -cw / 2; cam.right = cw / 2; cam.bottom = 0; cam.top = ch;
    cam.near = 0.1; cam.far = 200;
    cam.position.set(0, 0, 100); cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    rt.viewport.set(sx, sy, sideW, sideH);
    rt.scissor.set(sx, sy, sideW, sideH);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);

    // Top.
    const ty = 3 * sideH + row * topS, tx = col * topS;
    cam.left = -cw / 2; cam.right = cw / 2; cam.bottom = -cw / 2; cam.top = cw / 2;
    cam.position.set(0, 120, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    rt.viewport.set(tx, ty, topS, topS);
    rt.scissor.set(tx, ty, topS, topS);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    cam.up.set(0, 1, 0);

    scene.remove(meshB, meshL);
    // A half-texel inset, so bilinear filtering never reads the next cell.
    const ix = 0.5 / w, iy = 0.5 / h;
    out.push({
      cardW: cw, cardH: ch,
      side: [sx / w + ix, sy / h + iy, (sx + sideW) / w - ix, (sy + sideH) / h - iy],
      top: [tx / w + ix, ty / h + iy, (tx + topS) / w - ix, (ty + topS) / h - iy],
      // Where the top card hangs: the crown's middle, as a fraction of the card.
      canopy: clamp(k.info.crown.y / ch, 0.2, 0.9),
    });
  });

  rt.scissorTest = false;
  rt.viewport.set(0, 0, w, h);
  rt.scissor.set(0, 0, w, h);
  renderer.setRenderTarget(prev.rt);
  renderer.setClearColor(prev.clear, prev.alpha);
  renderer.toneMapping = prev.tone;
  for (const m of Object.values(mats)) { m.bark.dispose(); m.leaf.dispose(); }
  return { texture: rt.texture, cards: out, target: rt };
}
