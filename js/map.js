import { ISLANDS, terrainHeight, TERRAIN_SIZE, SEA_LEVEL } from "./world.js";

// ---------------------------------------------------------------------------
// The chart
//
// A hand-inked Norse sea chart of the archipelago, drawn from the same height
// field the terrain mesh is built from — so the coastlines on the parchment are
// the coastlines you fly over, not a decorative approximation.
//
// It's built once into an offscreen canvas (a few hundred milliseconds of noise
// sampling) and then blitted every frame with only the player marker, his trail
// and the readout drawn live on top.
// ---------------------------------------------------------------------------

const CHART_PX = 1500;  // offscreen resolution; scaled to fit whatever's on screen
const GRID     = 384;   // height-field samples per side — ~26 world units apart
const HALF     = TERRAIN_SIZE / 2;

// --- Palette ---------------------------------------------------------------
const INK       = "#43301b";
const SEA       = "#d2c29b";
const SEA_DEEP  = "#c3b088";
const MARKER    = "#a5372a";

// Elevation bands, shallowest first. Sea is left as bare parchment so the wave
// hatching under it still reads through the shallows.
const BANDS = [
  { h:   0, c: "#f3ecd6" },
  { h: 140, c: "#e7d8ad" },
  { h: 360, c: "#d7c08c" },
  { h: 600, c: "#c1a469" },
  { h: 820, c: "#a6864d" },
];

// Relief shading. Light from the north-west, which is where every engraver has
// put it since the seventeenth century.
const LIGHT = (() => {
  const v = [-0.62, -0.66, 0.86];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();
const RELIEF_EXAGGERATION = 2.6;

// Contour levels drawn as ink lines over the wash.
const CONTOURS = [
  { level: SEA_LEVEL, width: 2.2, alpha: 1,    coast: true },
  { level: 260,       width: 1.1, alpha: 0.42, coast: false },
  { level: 560,       width: 1.0, alpha: 0.38, coast: false },
  { level: 820,       width: 0.9, alpha: 0.34, coast: false },
];

// Deterministic value hash. The wobble on the coastline has to be a function of
// POSITION rather than of which segment we're drawing — neighbouring cells share
// an endpoint exactly, so hashing the point keeps the line joined up while still
// looking like it was drawn by a shaky hand.
function wobble(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// --- Marching squares ------------------------------------------------------
// Returns a flat list of x0,y0,x1,y1 in grid space. Cheap, and good enough at
// this resolution that nobody will ever count the segments.
function contourSegments(field, n, level) {
  const segs = [];

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = field[j * n + i];
      const b = field[j * n + i + 1];
      const c = field[(j + 1) * n + i + 1];
      const d = field[(j + 1) * n + i];

      let code = 0;
      if (a > level) code |= 8;
      if (b > level) code |= 4;
      if (c > level) code |= 2;
      if (d > level) code |= 1;
      if (code === 0 || code === 15) continue;

      const t = (v0, v1) => (level - v0) / (v1 - v0);
      const top    = [i + t(a, b), j];
      const right  = [i + 1, j + t(b, c)];
      const bottom = [i + t(d, c), j + 1];
      const left   = [i, j + t(a, d)];
      const put = (p, q) => segs.push(p[0], p[1], q[0], q[1]);

      switch (code) {
        case 1: case 14: put(left, bottom); break;
        case 2: case 13: put(bottom, right); break;
        case 3: case 12: put(left, right); break;
        case 4: case 11: put(top, right); break;
        case 6: case 9:  put(top, bottom); break;
        case 7: case 8:  put(left, top); break;
        // Saddles. Either resolution is defensible; pick one and be consistent.
        case 5:  put(left, top); put(bottom, right); break;
        case 10: put(left, bottom); put(top, right); break;
      }
    }
  }

  return segs;
}

let SITES = [];
/**
 * Tell the chart about mission locations. Each is { x, z, label, found }.
 * Unfound sites are not drawn — the chart shows where you have been, not where
 * the game would like you to go.
 */
export function setMapSites(list) { SITES = list || []; }

export function setupMap(getPlayer) {
  const root   = document.getElementById("map");
  const canvas = document.getElementById("map-canvas");
  const ctx    = canvas.getContext("2d");

  let open = false;
  let chart = null;       // the finished offscreen parchment
  let field = null;
  let size = 0;           // on-screen edge length in CSS pixels
  let clock = 0;

  // Breadcrumbs, kept whether the map is open or not so opening it shows where
  // you've actually been rather than starting blank.
  const TRAIL_MAX = 260;
  const TRAIL_EVERY = 0.4; // seconds
  const trail = [];
  let trailClock = 0;

  // --- Coordinate helpers --------------------------------------------------
  // North is up: world -Z sits at the top of the chart, matching the compass in
  // the HUD which treats -Z as north.
  const worldToChart = (x, z) => [
    ((x + HALF) / TERRAIN_SIZE) * CHART_PX,
    ((z + HALF) / TERRAIN_SIZE) * CHART_PX,
  ];
  const gridToChart = (gx, gy) => [
    (gx / (GRID - 1)) * CHART_PX,
    (gy / (GRID - 1)) * CHART_PX,
  ];

  // =========================================================================
  // Building the parchment
  // =========================================================================
  function sampleField() {
    const f = new Float32Array(GRID * GRID);
    for (let j = 0; j < GRID; j++) {
      const z = -HALF + (j / (GRID - 1)) * TERRAIN_SIZE;
      for (let i = 0; i < GRID; i++) {
        const x = -HALF + (i / (GRID - 1)) * TERRAIN_SIZE;
        f[j * GRID + i] = terrainHeight(x, z);
      }
    }
    return f;
  }

  function bandColour(h) {
    let c = BANDS[0].c;
    for (const band of BANDS) if (h >= band.h) c = band.c;
    return c;
  }

  // The land wash: a tiny bitmap of elevation bands, blown up with smoothing so
  // it lands as soft watercolour rather than as a stair-stepped heightmap. The
  // crisp definition all comes from the ink contours drawn over the top.
  function paintWash(c2d) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = GRID;
    const tctx = tile.getContext("2d");
    const img = tctx.createImageData(GRID, GRID);

    const rgb = {};
    const toRgb = (hex) => {
      if (!rgb[hex]) {
        rgb[hex] = [
          parseInt(hex.slice(1, 3), 16),
          parseInt(hex.slice(3, 5), 16),
          parseInt(hex.slice(5, 7), 16),
        ];
      }
      return rgb[hex];
    };

    const cell = TERRAIN_SIZE / (GRID - 1);

    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const p = j * GRID + i;
        const h = field[p];
        const o = p * 4;

        if (h <= SEA_LEVEL) {
          // Shallows get a hint of colour so the sea isn't uniformly flat.
          const shallow = Math.max(0, 1 + h / 90);
          img.data[o] = 0xc3; img.data[o + 1] = 0xb0; img.data[o + 2] = 0x88;
          img.data[o + 3] = Math.round(shallow * 90);
          continue;
        }

        // Central-difference slope, clamped at the edges of the grid.
        const im = i > 0 ? i - 1 : i, ip = i < GRID - 1 ? i + 1 : i;
        const jm = j > 0 ? j - 1 : j, jp = j < GRID - 1 ? j + 1 : j;
        const gx = (field[j * GRID + ip] - field[j * GRID + im]) / ((ip - im) * cell);
        const gy = (field[jp * GRID + i] - field[jm * GRID + i]) / ((jp - jm) * cell);

        const nx = -gx * RELIEF_EXAGGERATION;
        const ny = -gy * RELIEF_EXAGGERATION;
        const nl = Math.hypot(nx, ny, 1);
        const lit = (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / nl;
        // Lit slopes lift a little, shaded ones drop a lot — the asymmetry is
        // what makes the ridges read as ridges rather than as a grey wash.
        const shade = 0.84 + 0.25 * Math.max(0, lit);

        const [r, g, b] = toRgb(bandColour(h));
        img.data[o]     = Math.min(255, r * shade);
        img.data[o + 1] = Math.min(255, g * shade);
        img.data[o + 2] = Math.min(255, b * shade);
        img.data[o + 3] = 255;
      }
    }

    tctx.putImageData(img, 0, 0);
    c2d.imageSmoothingEnabled = true;
    c2d.imageSmoothingQuality = "high";
    c2d.drawImage(tile, 0, 0, CHART_PX, CHART_PX);
  }

  function strokeContour(c2d, segs, amp) {
    c2d.beginPath();
    for (let k = 0; k < segs.length; k += 4) {
      const [x0, y0] = gridToChart(segs[k], segs[k + 1]);
      const [x1, y1] = gridToChart(segs[k + 2], segs[k + 3]);
      c2d.moveTo(x0 + wobble(segs[k], segs[k + 1]) * amp,
                 y0 + wobble(segs[k + 1], segs[k]) * amp);
      c2d.lineTo(x1 + wobble(segs[k + 2], segs[k + 3]) * amp,
                 y1 + wobble(segs[k + 3], segs[k + 2]) * amp);
    }
    c2d.stroke();
  }

  function paintSeaHatch(c2d) {
    // Long wavy rules across the whole chart. Drawn before the land wash, so the
    // land covers them and they only survive out at sea and through the shallows.
    c2d.save();
    c2d.strokeStyle = "rgba(67, 48, 27, 0.085)";
    c2d.lineWidth = 1;
    for (let y = 20; y < CHART_PX; y += 21) {
      c2d.beginPath();
      // Three sines at unrelated frequencies, so no two rules ever run parallel
      // for long and the whole field stops reading as ruled paper.
      for (let x = 0; x <= CHART_PX; x += 9) {
        const yy = y
          + Math.sin(x * 0.026 + y * 0.09) * 3.1
          + Math.sin(x * 0.0091 + y * 0.031) * 3.6
          + Math.sin(x * 0.0037 + y * 0.007) * 2.4;
        if (x === 0) c2d.moveTo(x, yy); else c2d.lineTo(x, yy);
      }
      c2d.stroke();
    }
    c2d.restore();
  }

  // A cartographer's peak: a stroked triangle with hatching down one flank.
  function paintPeak(c2d, x, y, w, h) {
    c2d.beginPath();
    c2d.moveTo(x - w, y);
    c2d.lineTo(x - w * 0.28, y - h * 0.72);
    c2d.lineTo(x, y - h);
    c2d.lineTo(x + w * 0.34, y - h * 0.64);
    c2d.lineTo(x + w, y);
    c2d.closePath();
    c2d.fillStyle = "rgba(240, 231, 205, 0.75)";
    c2d.fill();
    c2d.strokeStyle = INK;
    c2d.lineWidth = 1.5;
    c2d.stroke();

    // Shade the eastern flank, the way every hand-drawn range on every old
    // chart is shaded.
    c2d.save();
    c2d.beginPath();
    c2d.moveTo(x, y - h);
    c2d.lineTo(x + w * 0.34, y - h * 0.64);
    c2d.lineTo(x + w, y);
    c2d.lineTo(x, y);
    c2d.closePath();
    c2d.clip();
    c2d.strokeStyle = "rgba(67, 48, 27, 0.4)";
    c2d.lineWidth = 0.9;
    for (let k = -h; k < w * 2; k += 3.5) {
      c2d.beginPath();
      c2d.moveTo(x + k, y);
      c2d.lineTo(x + k + h * 0.5, y - h);
      c2d.stroke();
    }
    c2d.restore();
  }

  // Real summits, found in the height field rather than scattered decoratively.
  // A local maximum over a 5x5 window, thinned so two glyphs never sit on top of
  // each other, gives a range that actually follows the ridge lines you fly.
  function findSummits(isl, limit) {
    const g = (GRID - 1) / TERRAIN_SIZE;
    const i0 = Math.max(2, Math.floor((isl.x - isl.r + HALF) * g));
    const i1 = Math.min(GRID - 3, Math.ceil((isl.x + isl.r + HALF) * g));
    const j0 = Math.max(2, Math.floor((isl.z - isl.r + HALF) * g));
    const j1 = Math.min(GRID - 3, Math.ceil((isl.z + isl.r + HALF) * g));
    const floor = isl.h * 0.4;

    const found = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const h = field[j * GRID + i];
        if (h < floor) continue;
        let top = true;
        for (let dj = -2; dj <= 2 && top; dj++) {
          for (let di = -2; di <= 2; di++) {
            if (field[(j + dj) * GRID + i + di] > h) { top = false; break; }
          }
        }
        if (top) found.push({ i, j, h });
      }
    }

    found.sort((a, b) => b.h - a.h);

    const sep = Math.max(3.5, isl.r * g * 0.42);
    const picked = [];
    for (const c of found) {
      if (picked.every((p) => Math.hypot(p.i - c.i, p.j - c.j) > sep)) picked.push(c);
      if (picked.length >= limit) break;
    }
    return picked;
  }

  function paintIslandGlyphs(c2d) {
    for (const isl of ISLANDS) {
      if (!isl.name) {
        // Sea stack — one narrow spire, sat right on it.
        const [cx, cy] = worldToChart(isl.x, isl.z);
        paintPeak(c2d, cx, cy + 3, 5, 9);
        continue;
      }

      const summits = findSummits(isl, 5);
      for (const s of summits) {
        const [px, py] = gridToChart(s.i, s.j);
        // Taller ground gets a taller glyph, so the eye can rank the islands.
        const ph = 7 + 15 * Math.min(1, s.h / 950);
        paintPeak(c2d, px, py + ph * 0.35, ph * 0.62, ph);
      }
    }
  }

  function paintLabels(c2d) {
    c2d.save();
    c2d.textAlign = "center";
    c2d.textBaseline = "middle";

    for (const isl of ISLANDS) {
      if (!isl.name) continue;
      const [cx, cy] = worldToChart(isl.x, isl.z);
      const scale = CHART_PX / TERRAIN_SIZE;
      const y = cy + isl.r * scale * 0.62;
      const label = isl.name.toUpperCase();

      c2d.font = `700 ${Math.round(16 + isl.r * 0.006)}px Cinzel, Georgia, serif`;
      // Knock the wash back behind the text so it stays legible over contours.
      c2d.lineWidth = 5;
      c2d.strokeStyle = "rgba(240, 231, 205, 0.82)";
      c2d.lineJoin = "round";
      c2d.strokeText(label, cx, y);
      c2d.fillStyle = INK;
      c2d.fillText(label, cx, y);

      // Hairline rule under the name, as on an engraved chart.
      const w = c2d.measureText(label).width;
      c2d.beginPath();
      c2d.moveTo(cx - w / 2, y + 12);
      c2d.lineTo(cx + w / 2, y + 12);
      c2d.strokeStyle = "rgba(67, 48, 27, 0.45)";
      c2d.lineWidth = 1;
      c2d.stroke();
    }

    c2d.restore();
  }

  function paintCompass(c2d, cx, cy, r) {
    c2d.save();
    c2d.translate(cx, cy);

    c2d.strokeStyle = "rgba(67, 48, 27, 0.55)";
    c2d.lineWidth = 1.2;
    for (const rr of [r, r * 0.82]) {
      c2d.beginPath();
      c2d.arc(0, 0, rr, 0, Math.PI * 2);
      c2d.stroke();
    }

    // Eight points: four long, four short, each a kite split light/dark down the
    // middle — the standard compass-rose trick for reading direction at a glance.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
      const len = k % 2 === 0 ? r * 0.95 : r * 0.6;
      const wide = r * 0.13;
      const tip = [Math.cos(a) * len, Math.sin(a) * len];
      const l = [Math.cos(a - Math.PI / 2) * wide, Math.sin(a - Math.PI / 2) * wide];
      const rp = [Math.cos(a + Math.PI / 2) * wide, Math.sin(a + Math.PI / 2) * wide];

      c2d.beginPath();
      c2d.moveTo(tip[0], tip[1]); c2d.lineTo(l[0], l[1]); c2d.lineTo(0, 0); c2d.closePath();
      c2d.fillStyle = INK;
      c2d.fill();

      c2d.beginPath();
      c2d.moveTo(tip[0], tip[1]); c2d.lineTo(rp[0], rp[1]); c2d.lineTo(0, 0); c2d.closePath();
      c2d.fillStyle = "rgba(240, 231, 205, 0.9)";
      c2d.fill();
      c2d.strokeStyle = INK;
      c2d.lineWidth = 1;
      c2d.stroke();
    }

    c2d.fillStyle = INK;
    c2d.font = "700 19px Cinzel, Georgia, serif";
    c2d.textAlign = "center";
    c2d.textBaseline = "middle";
    const marks = [["N", 0, -1], ["E", 1, 0], ["S", 0, 1], ["W", -1, 0]];
    for (const [ch, dx, dy] of marks) {
      c2d.fillText(ch, dx * r * 1.2, dy * r * 1.2);
    }

    c2d.restore();
  }

  function paintScaleBar(c2d, x, y) {
    // The bar spans a round number of world units; leagues are invented, but a
    // chart without a scale bar doesn't look like a chart.
    const span = 2000;
    const px = (span / TERRAIN_SIZE) * CHART_PX;
    const segs = 4;

    c2d.save();
    c2d.strokeStyle = INK;
    c2d.fillStyle = INK;
    c2d.lineWidth = 1.3;
    c2d.strokeRect(x, y, px, 8);
    for (let k = 0; k < segs; k += 2) {
      c2d.fillRect(x + (px / segs) * k, y, px / segs, 8);
    }

    c2d.font = "600 15px Rajdhani, system-ui, sans-serif";
    c2d.textAlign = "center";
    c2d.textBaseline = "top";
    c2d.fillText("0", x, y + 13);
    c2d.fillText(`${span} LEAGUES`, x + px, y + 13);
    c2d.restore();
  }

  function paintLongship(c2d, cx, cy, s) {
    c2d.save();
    c2d.translate(cx, cy);
    c2d.scale(s, s);
    c2d.strokeStyle = INK;
    c2d.fillStyle = "rgba(240, 231, 205, 0.85)";
    c2d.lineWidth = 2 / s;
    c2d.lineJoin = "round";

    // Hull, with the prow curling up into a dragon head at the bow.
    c2d.beginPath();
    c2d.moveTo(-34, 0);
    c2d.quadraticCurveTo(0, 20, 34, 0);
    c2d.lineTo(30, -4);
    c2d.quadraticCurveTo(0, 12, -30, -4);
    c2d.closePath();
    c2d.fill();
    c2d.stroke();

    // Stem posts.
    c2d.beginPath();
    c2d.moveTo(-32, -2);
    c2d.quadraticCurveTo(-44, -14, -34, -24);
    c2d.moveTo(32, -2);
    c2d.quadraticCurveTo(44, -16, 33, -27);
    c2d.quadraticCurveTo(28, -22, 30, -18);
    c2d.stroke();

    // Mast and square sail.
    c2d.beginPath();
    c2d.moveTo(0, -4);
    c2d.lineTo(0, -40);
    c2d.stroke();

    c2d.beginPath();
    c2d.moveTo(-18, -36);
    c2d.lineTo(18, -36);
    c2d.lineTo(15, -10);
    c2d.lineTo(-15, -10);
    c2d.closePath();
    c2d.fill();
    c2d.stroke();

    c2d.lineWidth = 1.2 / s;
    for (let k = -12; k <= 12; k += 8) {
      c2d.beginPath();
      c2d.moveTo(k, -35);
      c2d.lineTo(k, -11);
      c2d.stroke();
    }

    // Shields along the gunwale.
    for (let k = -24; k <= 24; k += 12) {
      c2d.beginPath();
      c2d.arc(k, 1, 4.5, 0, Math.PI * 2);
      c2d.stroke();
    }

    c2d.restore();
  }

  function paintFrame(c2d) {
    c2d.save();
    c2d.strokeStyle = INK;

    c2d.lineWidth = 5;
    c2d.strokeRect(22, 22, CHART_PX - 44, CHART_PX - 44);
    c2d.lineWidth = 1.6;
    c2d.strokeRect(34, 34, CHART_PX - 68, CHART_PX - 68);

    // Corner lozenges, so the frame has somewhere to resolve.
    const corners = [[34, 34], [CHART_PX - 34, 34], [34, CHART_PX - 34], [CHART_PX - 34, CHART_PX - 34]];
    for (const [x, y] of corners) {
      c2d.save();
      c2d.translate(x, y);
      c2d.rotate(Math.PI / 4);
      c2d.fillStyle = INK;
      c2d.fillRect(-7, -7, 14, 14);
      c2d.restore();
    }

    c2d.restore();
  }

  function paintCartouche(c2d) {
    c2d.save();
    c2d.textAlign = "left";
    c2d.textBaseline = "alphabetic";

    c2d.fillStyle = INK;
    c2d.font = "700 46px Cinzel, Georgia, serif";
    c2d.fillText("The Archipelago", 88, 130);

    c2d.strokeStyle = "rgba(67, 48, 27, 0.6)";
    c2d.lineWidth = 1.4;
    c2d.beginPath();
    c2d.moveTo(88, 146);
    c2d.lineTo(430, 146);
    c2d.stroke();

    c2d.fillStyle = "rgba(67, 48, 27, 0.72)";
    c2d.font = "600 17px Rajdhani, system-ui, sans-serif";
    c2d.letterSpacing = "3px";
    c2d.fillText("CHART OF THE BARBARIC ISLES", 88, 172);
    c2d.letterSpacing = "0px";

    // The obligatory warning, in the empty water off the west coast.
    c2d.save();
    c2d.translate(CHART_PX * 0.135, CHART_PX * 0.47);
    c2d.rotate(-0.1);
    c2d.textAlign = "center";
    c2d.fillStyle = "rgba(67, 48, 27, 0.5)";
    c2d.font = "italic 700 26px Cinzel, Georgia, serif";
    c2d.fillText("Here be dragons", 0, 0);
    c2d.restore();

    c2d.restore();
  }

  function paintAging(c2d) {
    // Blotches and a soft burn around the edge. Small enough amounts that it
    // reads as age rather than as damage.
    c2d.save();
    for (let k = 0; k < 26; k++) {
      const x = Math.random() * CHART_PX;
      const y = Math.random() * CHART_PX;
      const r = 40 + Math.random() * 160;
      const g = c2d.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(120, 88, 42, 0.055)");
      g.addColorStop(1, "rgba(120, 88, 42, 0)");
      c2d.fillStyle = g;
      c2d.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Fibre specks.
    c2d.fillStyle = "rgba(80, 58, 30, 0.09)";
    for (let k = 0; k < 2600; k++) {
      c2d.fillRect(Math.random() * CHART_PX, Math.random() * CHART_PX, 1.2, 1.2);
    }

    const vig = c2d.createRadialGradient(
      CHART_PX / 2, CHART_PX / 2, CHART_PX * 0.34,
      CHART_PX / 2, CHART_PX / 2, CHART_PX * 0.78
    );
    vig.addColorStop(0, "rgba(90, 62, 26, 0)");
    vig.addColorStop(1, "rgba(90, 62, 26, 0.32)");
    c2d.fillStyle = vig;
    c2d.fillRect(0, 0, CHART_PX, CHART_PX);
    c2d.restore();
  }

  function buildChart() {
    if (chart) return;

    field = sampleField();

    const c = document.createElement("canvas");
    c.width = c.height = CHART_PX;
    const c2d = c.getContext("2d");

    // Parchment, warmer at the edges than in the middle.
    const base = c2d.createLinearGradient(0, 0, CHART_PX, CHART_PX);
    base.addColorStop(0, SEA);
    base.addColorStop(0.5, "#dccfa9");
    base.addColorStop(1, SEA_DEEP);
    c2d.fillStyle = base;
    c2d.fillRect(0, 0, CHART_PX, CHART_PX);

    paintSeaHatch(c2d);
    paintWash(c2d);

    const coast = contourSegments(field, GRID, SEA_LEVEL);

    // Coastal shading: the same coastline stroked several times, wide and faint
    // first, so the ink pools along the shore the way it does when it's drawn by
    // hand with a loaded nib.
    c2d.lineCap = "round";
    for (const [w, a] of [[17, 0.028], [11, 0.038], [6, 0.05]]) {
      c2d.strokeStyle = `rgba(67, 48, 27, ${a})`;
      c2d.lineWidth = w;
      strokeContour(c2d, coast, 1.4);
    }

    for (const spec of CONTOURS) {
      const segs = spec.coast ? coast : contourSegments(field, GRID, spec.level);
      c2d.strokeStyle = spec.coast ? INK : `rgba(67, 48, 27, ${spec.alpha})`;
      c2d.lineWidth = spec.width;
      strokeContour(c2d, segs, spec.coast ? 1.4 : 1.0);
    }

    paintIslandGlyphs(c2d);
    paintLabels(c2d);
    paintCompass(c2d, CHART_PX * 0.13, CHART_PX * 0.845, CHART_PX * 0.072);
    paintScaleBar(c2d, CHART_PX * 0.37, CHART_PX * 0.915);
    paintLongship(c2d, CHART_PX * 0.845, CHART_PX * 0.125, 1.55);
    paintCartouche(c2d);
    paintAging(c2d);
    paintFrame(c2d);

    chart = c;
  }

  // =========================================================================
  // Live layer
  // =========================================================================
  function paintTrail(c2d, toPx) {
    if (trail.length < 2) return;
    c2d.save();
    c2d.strokeStyle = "rgba(165, 55, 42, 0.42)";
    c2d.lineWidth = 2;
    c2d.setLineDash([5, 6]);
    c2d.beginPath();
    for (let k = 0; k < trail.length; k += 2) {
      const [px, py] = toPx(trail[k], trail[k + 1]);
      if (k === 0) c2d.moveTo(px, py); else c2d.lineTo(px, py);
    }
    c2d.stroke();
    c2d.restore();
  }

  function paintDragon(c2d, x, y, angle, t) {
    // Pulsing halo, so the eye finds him immediately on a busy chart.
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.1);
    const r = 17 + pulse * 9;
    const glow = c2d.createRadialGradient(x, y, 0, x, y, r * 1.8);
    glow.addColorStop(0, "rgba(165, 55, 42, 0.34)");
    glow.addColorStop(1, "rgba(165, 55, 42, 0)");
    c2d.fillStyle = glow;
    c2d.beginPath();
    c2d.arc(x, y, r * 1.8, 0, Math.PI * 2);
    c2d.fill();

    c2d.strokeStyle = `rgba(165, 55, 42, ${0.55 - pulse * 0.35})`;
    c2d.lineWidth = 1.6;
    c2d.beginPath();
    c2d.arc(x, y, r, 0, Math.PI * 2);
    c2d.stroke();

    c2d.save();
    c2d.translate(x, y);
    c2d.rotate(angle);
    c2d.scale(1.28, 1.28);

    // Heading needle out ahead of him.
    c2d.strokeStyle = "rgba(165, 55, 42, 0.7)";
    c2d.lineWidth = 1.4;
    c2d.setLineDash([3, 4]);
    c2d.beginPath();
    c2d.moveTo(16, 0);
    c2d.lineTo(44, 0);
    c2d.stroke();
    c2d.setLineDash([]);

    // The dragon himself: nose at +x, wings swept back.
    c2d.beginPath();
    c2d.moveTo(13, 0);
    c2d.quadraticCurveTo(5, -3, 1, -3.5);
    c2d.lineTo(-3, -15);
    c2d.quadraticCurveTo(-10, -9, -8, -2.4);
    c2d.lineTo(-18, -1.2);
    c2d.lineTo(-14, 0);
    c2d.lineTo(-18, 1.2);
    c2d.lineTo(-8, 2.4);
    c2d.quadraticCurveTo(-10, 9, -3, 15);
    c2d.lineTo(1, 3.5);
    c2d.quadraticCurveTo(5, 3, 13, 0);
    c2d.closePath();

    c2d.fillStyle = MARKER;
    c2d.fill();
    c2d.strokeStyle = "rgba(240, 231, 205, 0.9)";
    c2d.lineWidth = 1.3;
    c2d.lineJoin = "round";
    c2d.stroke();

    c2d.restore();
  }

  function whereIs(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const isl of ISLANDS) {
      if (!isl.name) continue;
      const d = Math.hypot(x - isl.x, z - isl.z) / isl.r;
      if (d < bestD) { bestD = d; best = isl; }
    }
    if (!best) return "Open sea";
    if (bestD < 1) return `Over ${best.name}`;
    if (bestD < 2.2) return `Off ${best.name}`;
    return "Open sea";
  }

  function paintReadout(c2d, player, w) {
    const pad = w * 0.055;
    const y = w - pad;

    c2d.save();
    c2d.textAlign = "right";
    c2d.textBaseline = "bottom";

    c2d.fillStyle = INK;
    c2d.font = `700 ${Math.round(w * 0.026)}px Cinzel, Georgia, serif`;
    c2d.fillText(whereIs(player.x, player.z), w - pad, y - w * 0.028);

    const deg = Math.round(
      (Math.atan2(Math.sin(player.heading), -Math.cos(player.heading)) * 180 / Math.PI + 360) % 360
    ) % 360;

    c2d.fillStyle = "rgba(67, 48, 27, 0.72)";
    c2d.font = `600 ${Math.round(w * 0.017)}px Rajdhani, system-ui, sans-serif`;
    c2d.letterSpacing = "2px";
    c2d.fillText(
      `${String(deg).padStart(3, "0")}°   ALT ${Math.round(player.y)}`,
      w - pad, y
    );
    c2d.letterSpacing = "0px";
    c2d.restore();
  }

  // =========================================================================
  // Plumbing
  // =========================================================================
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.min(window.innerWidth, window.innerHeight) * 0.92;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(dt) {
    if (!open || !chart) return;
    clock += dt;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(chart, 0, 0, size, size);

    const toPx = (x, z) => [
      ((x + HALF) / TERRAIN_SIZE) * size,
      ((z + HALF) / TERRAIN_SIZE) * size,
    ];

    paintTrail(ctx, toPx);
    paintSites(ctx, toPx);

    const player = getPlayer();
    if (player) {
      const [px, py] = toPx(player.x, player.z);
      // His nose vector is (sin h, cos h) in world x/z, and the chart puts +x
      // right and +z down — so the screen angle falls straight out of it.
      paintDragon(ctx, px, py, Math.atan2(Math.cos(player.heading), Math.sin(player.heading)), clock);
      paintReadout(ctx, player, size);
    }
  }

  /** Mission sites, inked in the same hand as the rest of the chart. */
  function paintSites(g, toPx) {
    for (const s of SITES) {
      if (!s.found) continue;
      const [x, y] = toPx(s.x, s.z);
      g.save();
      g.strokeStyle = "rgba(150, 60, 28, 0.9)";
      g.fillStyle = "rgba(150, 60, 28, 0.9)";
      g.lineWidth = Math.max(1.2, size * 0.0022);

      // A cross rather than a pin. Somebody drew this with a quill.
      const r = size * 0.010;
      g.beginPath();
      g.moveTo(x - r, y - r); g.lineTo(x + r, y + r);
      g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
      g.stroke();
      g.beginPath();
      g.arc(x, y, r * 1.8, 0, Math.PI * 2);
      g.globalAlpha = 0.55;
      g.stroke();
      g.globalAlpha = 1;

      g.font = `600 ${Math.round(size * 0.017)}px Rajdhani, system-ui, sans-serif`;
      g.textAlign = "center";
      g.fillText(s.label.toUpperCase(), x, y + r * 4.2);
      g.restore();
    }
  }

  function setOpen(v) {
    open = v;
    root.classList.toggle("open", open);
    root.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      buildChart();
      resize();
      document.exitPointerLock();
    }
  }

  window.addEventListener("resize", () => { if (open) resize(); });

  window.addEventListener("keydown", (e) => {
    const typing = document.activeElement?.tagName === "INPUT";
    if (e.code === "Tab" && !typing) {
      e.preventDefault();
      setOpen(!open);
    } else if (e.code === "Escape" && open) {
      setOpen(false);
    }
  });

  // Build during an idle slot rather than on the first press — sampling the
  // height field is a few hundred milliseconds and nobody should watch it
  // happen. Fonts first, or the labels get drawn in a fallback serif.
  document.fonts.ready.then(() => {
    if (window.requestIdleCallback) requestIdleCallback(() => buildChart(), { timeout: 5000 });
    else setTimeout(buildChart, 1200);
  });

  return {
    update(dt) {
      const player = getPlayer();
      trailClock += dt;
      if (player && trailClock >= TRAIL_EVERY) {
        trailClock = 0;
        trail.push(player.x, player.z);
        if (trail.length > TRAIL_MAX * 2) trail.splice(0, 2);
      }
      draw(dt);
    },
    toggle: () => setOpen(!open),
    close:  () => setOpen(false),
    isOpen: () => open,
  };
}
