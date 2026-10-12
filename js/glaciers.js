// ---------------------------------------------------------------------------
// Ice on the ice islands.
//
// Before this, "glacier island" meant a lowered snow line: the whole island
// was its ordinary crumpled relief painted white, every crag and every sheer
// coastal face included, and from the air it read as a block of sugar. Real
// glaciated islands — Svalbard, east Greenland, South Georgia — are the other
// way round. The ice is SMOOTH: a cap over the high interior that buries the
// relief, with only the highest peaks standing out of it as dark nunataks,
// and the ice draining off it down the valleys as outlet glaciers that end in
// the sea as ice cliffs, or on land as a dirty snout in its own rubble. It is
// the rock between them that is dark.
//
// So this works out, once, where the ice is and what shape its surface has,
// from the island's own ground:
//
//   1. the bed, sampled on a 32 m raster (terrainHeight with no ice);
//   2. the cap: a Vialov-ish dome — thin at its margin, thickening fast, flat
//      across the top — over a heavily smoothed copy of the bed, only where
//      the ground is high and well back from the sea;
//   3. the outlets: ice flows downhill on the smoothed ice surface, so flow
//      is routed across the raster (steepest descent) and accumulated from
//      everything above the equilibrium line. Wherever enough has gathered,
//      there is a glacier, as wide as the square root of its catchment, and
//      it runs on down until it has lost what it gained or reaches the sea.
//      Tributaries joining leave a medial moraine where they meet.
//   4. each glacier stamped back onto the raster as a smooth, slightly convex
//      ribbon with a signed inside-distance, so the margins and the calving
//      front come out crisp at any mesh resolution: the distance interpolates
//      linearly and the edge is decided on it per sample, not per cell.
//
// It is pure maths over (x, z) with no three.js, because terrain.js runs in
// the workers too and each one has to arrive at the same ice.
// ---------------------------------------------------------------------------

const CELL = 32;
const NONE_IN = -200;          // "inside distance" for no ice, metres

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Per-island character. Absent = no glaciers. */
const ICE_ISLANDS = {
  // An island under an ice cap, the outlets reaching the sea in the fjords.
  "Glacier Island": {
    ela: 250,            // equilibrium line: firn above, bare ice below
    capBed: [60,260],  // smoothed bed height over which the cap thickens in
    capCoast: [60,900], // metres from the sea over which it thickens in
    capT: 260,           // full cap thickness
    minCatch: 120,       // cells of catchment before ice counts as a glacier
    reach: 3.2,          // how far below the ELA a glacier runs, in its own widths
    reachMin: 900,
    widthK: 0.32, widthMin: 130, widthMax: 650,
  },
  // A volcano with ice on its summit, and a few short glaciers off it that
  // die on the mountainside in their own moraine.
  "Dragon Peak": {
    ela: 560,
    capBed: [520, 720],
    capCoast: [900, 1600],
    capT: 70,
    minCatch: 70,
    reach: 2.2,
    reachMin: 350,
    widthK: 0.3, widthMin: 100, widthMax: 450,
  },
};

/**
 * @param {object[]} islands   terrain.js ISLANDS (scaled)
 * @param {(x:number,z:number)=>number} bedAt   terrainHeight with no ice
 * @param {(x:number,z:number)=>number} noise2
 */
export function buildGlaciers(islands, bedAt, noise2) {
  const fields = [];
  const fronts = [];
  for (const isl of islands) {
    const P = ICE_ISLANDS[isl.name];
    if (!P) continue;
    fields.push(buildOne(isl, P, bedAt, noise2, fronts));
  }
  return { fields, fronts };
}

function buildOne(isl, P, bedAt, noise2, fronts) {
  const R = isl.r * 1.04 + 300;
  const x0 = isl.x - R, z0 = isl.z - R;
  const n = Math.ceil((2 * R) / CELL) + 1;
  const N = n * n;
  const idx = (i, j) => j * n + i;

  // --- 1. The bed -----------------------------------------------------------
  const B = new Float32Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) B[idx(i, j)] = bedAt(x0 + i * CELL, z0 + j * CELL);

  // Distance to the sea, metres (two-pass chamfer).
  const D = new Float32Array(N);
  for (let k = 0; k < N; k++) D[k] = B[k] < 0 ? 0 : 1e9;
  const a1 = CELL, a2 = CELL * Math.SQRT2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = idx(i, j); let d = D[k];
    if (i > 0) d = Math.min(d, D[k - 1] + a1);
    if (j > 0) {
      d = Math.min(d, D[k - n] + a1);
      if (i > 0) d = Math.min(d, D[k - n - 1] + a2);
      if (i < n - 1) d = Math.min(d, D[k - n + 1] + a2);
    }
    D[k] = d;
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = idx(i, j); let d = D[k];
    if (i < n - 1) d = Math.min(d, D[k + 1] + a1);
    if (j < n - 1) {
      d = Math.min(d, D[k + n] + a1);
      if (i < n - 1) d = Math.min(d, D[k + n + 1] + a2);
      if (i > 0) d = Math.min(d, D[k + n - 1] + a2);
    }
    D[k] = d;
  }

  // Smoothed bed: what the ice "sees". Ice hundreds of metres thick does not
  // follow the crags, it bridges them.
  const Bc = new Float32Array(N);
  for (let k = 0; k < N; k++) Bc[k] = Math.max(B[k], -40);
  const Bs = blur(blur(Bc, n, 4), n, 4);          // ~ 200 m
  const Bss = blur(blur(Bs, n, 7), n, 7);         // ~ 500 m, for the cap

  // --- 2. The cap -----------------------------------------------------------
  const T = new Float32Array(N);                  // cap thickness
  for (let k = 0; k < N; k++) {
    const m = sstep(Bss[k], P.capBed[0], P.capBed[1]);
    const c = clamp((D[k] - P.capCoast[0]) / (P.capCoast[1] - P.capCoast[0]), 0, 1);
    // Vialov: thickness goes as a root of distance from the margin — steep
    // at the edge, flat on top.
    T[k] = P.capT * Math.pow(m * c, 0.7);
    // Ice thins over the bed's highs — it flows off them — so the crests of
    // the ridges under the cap stand out of it as nunataks instead of being
    // buried under one even blanket.
    T[k] *= 1 - sstep(B[k] - Bss[k], 45, 140);
  }
  // The ice surface the flow runs on.
  const S = new Float32Array(N);
  for (let k = 0; k < N; k++) S[k] = Math.max(Bs[k], Bss[k] + T[k]);

  // --- 3. Flow -----------------------------------------------------------------
  // Fill the hollows first (priority flood from the sea and the raster's
  // edge), or the flat top of the cap is a field of little pits that every
  // flow line stops in, and the ice never leaves the middle of the island.
  // ...and route it on the bed more than on the cap's own dome: ice thick
  // enough to flow still finds the troughs under it, which is why an ice cap
  // drains through a few big outlets rather than evenly off every side.
  const Rf = new Float32Array(N);
  for (let k = 0; k < N; k++) Rf[k] = Bs[k] + T[k] * 0.35;
  fillPits(Rf, n, B);
  const down = new Int32Array(N).fill(-1);
  const stepLen = new Float32Array(N);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = idx(i, j);
    if (B[k] < 0) continue;                     // the sea is a sink
    let best = -1, bestDrop = 0, bl = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const kk = k + dj * n + di;
      const L = di && dj ? a2 : a1;
      const drop = (Rf[k] - Rf[kk]) / L;
      if (drop > bestDrop) { bestDrop = drop; best = kk; bl = L; }
    }
    down[k] = best; stepLen[k] = bl;
  }
  const order = new Int32Array(N);
  for (let k = 0; k < N; k++) order[k] = k;
  order.sort((p, q) => Rf[q] - Rf[p]);
  const acc = new Float32Array(N);
  for (const k of order) {
    if (B[k] < 0) continue;
    acc[k] += sstep(S[k], P.ela - 60, P.ela + 120);
    if (down[k] >= 0) acc[down[k]] += acc[k];
  }

  // Walk the channels top-down, carrying each glacier's state with it.
  const isCh = new Uint8Array(N);
  const alive = new Uint8Array(N);
  const W = new Float32Array(N);
  const sAlong = new Float32Array(N);
  const below = new Float32Array(N);
  const sCh = new Float32Array(N);
  const med = new Float32Array(N).fill(9);
  const confl = new Float32Array(N);              // metres since a confluence
  const main = new Int32Array(N).fill(-1);        // the biggest donor channel
  const term = new Int32Array(N).fill(-1);
  const termini = [];
  for (const k of order) {
    if (B[k] < 0 || acc[k] < P.minCatch) continue;
    // Donors that are live channels.
    let m = -1, mAcc = 0;
    let trib = -1, tAcc = 0;
    const i = k % n, j = (k - i) / n;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const kk = idx(ii, jj);
      if (down[kk] !== k || !isCh[kk] || !alive[kk]) continue;
      if (acc[kk] > mAcc) { trib = m; tAcc = mAcc; m = kk; mAcc = acc[kk]; }
      else if (acc[kk] > tAcc) { trib = kk; tAcc = acc[kk]; }
    }
    const area = acc[k] * CELL * CELL;
    const w = clamp(Math.sqrt(area) * P.widthK, P.widthMin, P.widthMax);
    const thick = 20 + w * 0.12;
    let s = 0, bel = 0, top = Infinity;
    if (m >= 0) {
      s = sAlong[m] + stepLen[m];
      bel = below[m];
      top = sCh[m];
      med[k] = med[m];
      confl[k] = confl[m] + stepLen[m];
    } else if (S[k] < P.ela) {
      continue;                                    // ice does not start below the ELA
    }
    if (trib >= 0 && tAcc > 0.12 * acc[k] && down[k] >= 0) {
      // Which side the tributary came in on, and how much of the width is its.
      const dx = (down[k] % n) - i, dz = ((down[k] - (down[k] % n)) / n) - j;
      const ti = trib % n, tj = (trib - ti) / n;
      const side = Math.sign(dx * (tj - j) - dz * (ti - i)) || 1;
      med[k] = side * (1 - 2 * tAcc / acc[k]);
      confl[k] = 0;
    }
    let surf = Math.max(S[k], B[k] + thick);
    if (top < Infinity) surf = Math.min(surf, top - 0.01 * stepLen[m]);
    if (surf < P.ela) bel += stepLen[m] || CELL;
    isCh[k] = 1; W[k] = w; sAlong[k] = s; below[k] = bel; sCh[k] = surf; main[k] = m;
    const lim = Math.max(P.reachMin, w * P.reach);
    alive[k] = bel <= lim ? 1 : 0;
    const d = down[k];
    if (!alive[k] || d < 0 || B[d] < 0) {
      termini.push(k);
      if (globalThis.__iceDbg) globalThis.__iceDbg.push({ name: isl.name, acc: acc[k], w, bel, lim, sea: d >= 0 && B[d] < 0, surf, S: S[k], B: B[k], D: D[k] });
      alive[k] = 0;   // nothing flows on from a terminus
      term[k] = k;
    }
  }
  // Each channel cell's terminus, by following it down.
  for (let q = order.length - 1; q >= 0; q--) {
    const k = order[q];
    if (!isCh[k] || term[k] >= 0) continue;
    let c = k, guard = 0;
    while (c >= 0 && isCh[c] && term[c] < 0 && guard++ < 4000) c = down[c];
    const t = c >= 0 && isCh[c] ? term[c] : -1;
    c = k; guard = 0;
    while (c >= 0 && isCh[c] && term[c] < 0 && guard++ < 4000) { term[c] = t; c = down[c]; }
  }

  // The profile a glacier actually has near its end. A parabola from the
  // front (Nye: h = sqrt(2 tau L / rho g), about 4.7 sqrt(L) for ordinary
  // ice), so a tongue comes down to the water as ice tens of metres thick and
  // not as the cap's surface carried out to the clifftop.
  const toFront = new Float32Array(N);
  for (let q = order.length - 1; q >= 0; q--) {
    const k = order[q];
    if (!isCh[k]) continue;
    const d = down[k];
    toFront[k] = term[k] === k || d < 0 || !isCh[d] ? 0 : toFront[d] + stepLen[k];
  }
  for (let k = 0; k < N; k++) {
    if (!isCh[k] || term[k] < 0) continue;
    const t = term[k], d = down[t];
    const sea = d >= 0 && B[d] < 0;
    const F = sea ? 26 + W[t] * 0.03 : B[t] + 6;
    sCh[k] = Math.min(sCh[k], F + 4.7 * Math.sqrt(toFront[k]));
  }

  // Smoothed centreline: D8 paths are staircases of 45° steps, so average each
  // cell's position (and surface) along its own path.
  const nextCh = (k) => { const d = down[k]; return d >= 0 && isCh[d] && term[k] !== k ? d : -1; };
  const pts = [];
  for (let k = 0; k < N; k++) {
    if (!isCh[k]) continue;
    let sx = 0, sz = 0, ss = 0, c = 0;
    const add = (q) => { sx += q % n; sz += (q - (q % n)) / n; ss += sCh[q]; c++; };
    add(k);
    let q = k;
    for (let t = 0; t < 4 && (q = main[q]) >= 0; t++) add(q);
    q = k;
    for (let t = 0; t < 4 && (q = nextCh(q)) >= 0; t++) add(q);
    pts.push({ k, x: x0 + (sx / c) * CELL, z: z0 + (sz / c) * CELL, surf: ss / c });
  }
  const P_OF = new Map(pts.map((p) => [p.k, p]));
  for (const p of pts) {
    // Direction of flow at this point, off its smoothed neighbours.
    const a = P_OF.get(main[p.k]) || p;
    const nx = nextCh(p.k);
    const b = (nx >= 0 && P_OF.get(nx)) || p;
    let dx = b.x - a.x, dz = b.z - a.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-3) {
      const d = down[p.k];
      dx = d >= 0 ? (d % n) - (p.k % n) : 1; dz = d >= 0 ? ((d - (d % n)) / n) - ((p.k - (p.k % n)) / n) : 0;
    }
    const l = Math.hypot(dx, dz) || 1;
    p.dx = dx / l; p.dz = dz / l;
  }

  // Crevassing: steep reaches (icefalls), the last few hundred metres to a
  // snout, and below a confluence.
  const crevOf = new Map();
  for (const p of pts) {
    const k = p.k, m = main[k];
    const up = m >= 0 ? P_OF.get(m) : null;
    const slope = up ? (up.surf - p.surf) / Math.max(1, stepLen[m]) : 0;
    let c = sstep(slope, 0.05, 0.2);
    c = Math.max(c, (1 - sstep(confl[k], 0, 350)) * 0.45 * (med[k] !== 9 ? 1 : 0));
    crevOf.set(k, c);
  }
  // Snouts: walk up from each terminus.
  for (const t of termini) {
    let q = t, dist = 0;
    while (q >= 0 && dist < 420) {
      crevOf.set(q, Math.max(crevOf.get(q) || 0, 0.7 * (1 - dist / 420)));
      dist += main[q] >= 0 ? stepLen[main[q]] : CELL;
      q = main[q];
    }
  }

  // Tidewater fronts: carry the tongue on out over the water and end it as a
  // cliff; land snouts end where they are.
  const ext = [];
  const frontOf = new Map();      // terminus k -> {x, z, dx, dz}
  for (const t of termini) {
    const p = P_OF.get(t);
    if (!p) continue;
    const d = down[t];
    const tidewater = d >= 0 && B[d] < 0 && below[t] <= Math.max(P.reachMin, W[t] * P.reach);
    if (!tidewater) {
      frontOf.set(t, { x: p.x + p.dx * W[t] * 0.15, z: p.z + p.dz * W[t] * 0.15, dx: p.dx, dz: p.dz, sea: false });
      continue;
    }
    const L = clamp(W[t] * 0.7, 120, 480);
    const cliff = 26 + W[t] * 0.03;
    let x = p.x, z = p.z, last = null;
    for (let s = CELL; s <= L; s += CELL) {
      x = p.x + p.dx * s; z = p.z + p.dz * s;
      const fi = Math.round((x - x0) / CELL), fj = Math.round((z - z0) / CELL);
      if (fi < 0 || fj < 0 || fi >= n || fj >= n) break;
      if (B[idx(fi, fj)] > 12) break;           // ran into the far shore
      const k = s / L;
      last = { k: t, x, z, surf: p.surf + (cliff - p.surf) * Math.min(1, k * 3), dx: p.dx, dz: p.dz,
               w: W[t], s: sAlong[t] + s, crev: 0.75, med: med[t] };
      ext.push(last);
    }
    const f = last || p;
    // Fronts wander: a straight calving face reads as a cut.
    frontOf.set(t, { x: f.x, z: f.z, dx: p.dx, dz: p.dz, sea: true });
    fronts.push({ x: f.x, z: f.z, dx: p.dx, dz: p.dz, w: W[t] });
  }

  // --- 4. Stamp -------------------------------------------------------------------
  const IN = new Float32Array(N).fill(NONE_IN);
  const SURF = new Float32Array(N);
  const SA = new Float32Array(N), U = new Float32Array(N), MED = new Float32Array(N).fill(9);
  const CREV = new Float32Array(N);
  const CAP = new Float32Array(N);       // 1 where the cap, not a glacier, is the ice
  const wsum = new Float32Array(N);
  // The wander of the margins and fronts, once per cell rather than once per
  // cell per stamp (the stamps overlap twenty deep).
  const WOB = new Float32Array(N), RAG = new Float32Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const cx = x0 + i * CELL, cz = z0 + j * CELL;
    WOB[idx(i, j)] = 1 + noise2(cx * 0.004 + 13.1, cz * 0.004 - 6.2) * 0.12;
    RAG[idx(i, j)] = noise2(cx * 0.011 - 2.7, cz * 0.011 + 8.8);
  }
  const stamp = (p, w, surf, sAl, crevV, medV, front) => {
    const r = w + 90;
    const i0 = Math.max(0, Math.floor((p.x - r - x0) / CELL)), i1 = Math.min(n - 1, Math.ceil((p.x + r - x0) / CELL));
    const j0 = Math.max(0, Math.floor((p.z - r - z0) / CELL)), j1 = Math.min(n - 1, Math.ceil((p.z + r - z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = x0 + i * CELL, cz = z0 + j * CELL;
      const ox = cx - p.x, oz = cz - p.z;
      const d = Math.hypot(ox, oz);
      // A margin that wanders, so it is not drawn with compasses.
      const k = idx(i, j);
      let inside = w * WOB[k] - d;
      if (front) {
        const fwd = (cx - front.x) * front.dx + (cz - front.z) * front.dz;
        inside = Math.min(inside, -fwd + RAG[k] * (front.sea ? 14 : 40) - (front.sea ? 0 : 20));
      }
      if (inside < -90) continue;
      if (inside > IN[k]) IN[k] = inside;
      if (inside <= -40) continue;
      // Convex across: a glacier is higher in the middle than at its sides.
      const across = (ox * -p.dz + oz * p.dx) / w;
      const conv = 1 - across * across;
      const wt = (inside + 40) * (inside + 40);
      SURF[k] += (surf + conv * w * 0.04) * wt;
      SA[k] += sAl * wt;
      U[k] += clamp(across, -1.2, 1.2) * wt;
      CREV[k] += crevV * wt;
      if (medV !== 9 && wt > wsum[k] * 0.5) MED[k] = medV;
      wsum[k] += wt;
    }
  };
  for (const p of pts) {
    const k = p.k;
    stamp(p, W[k], p.surf, sAlong[k], crevOf.get(k) || 0, med[k], frontOf.get(term[k]) || null);
  }
  for (const e of ext) stamp(e, e.w, e.surf, e.s, e.crev, e.med, frontOf.get(e.k) || null);
  for (let k = 0; k < N; k++) {
    if (wsum[k] > 0) {
      SURF[k] /= wsum[k]; SA[k] /= wsum[k]; U[k] /= wsum[k]; CREV[k] /= wsum[k];
    } else {
      SURF[k] = -9999; U[k] = 0;
    }
  }

  // One ice surface, not two. An outlet draws the cap down toward it: the
  // cap's surface can stand no higher above a glacier than a gentle ramp
  // (about 7 degrees) from the glacier's edge — otherwise every outlet is a
  // slot two hundred metres deep in the cap. Chamfer-propagated outward.
  const isG = (k) => IN[k] > 0 && wsum[k] > 0;
  const ramp = (seed, RAMP) => {
    const G = new Float32Array(N).fill(1e9);
    for (let k = 0; k < N; k++) if (isG(k)) G[k] = seed[k];
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = idx(i, j);
        G[k] = Math.min(G[k], G[k - 1] + a1 * RAMP, G[k - n] + a1 * RAMP, G[k - n - 1] + a2 * RAMP, G[k - n + 1] + a2 * RAMP);
      }
      for (let j = n - 2; j > 0; j--) for (let i = n - 2; i > 0; i--) {
        const k = idx(i, j);
        G[k] = Math.min(G[k], G[k + 1] + a1 * RAMP, G[k + n] + a1 * RAMP, G[k + n + 1] + a2 * RAMP, G[k + n - 1] + a2 * RAMP);
      }
    }
    return G;
  };
  // Glaciers against each other first: where two footprints meet, an upper
  // reach can stand no more than a steep icefall above the trunk beside it.
  // Where that bites, the ice is broken up — crevassed.
  const Gg = ramp(SURF, 0.3);
  for (let k = 0; k < N; k++) if (isG(k) && Gg[k] < SURF[k]) SURF[k] = Gg[k];
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = idx(i, j);
    if (!isG(k)) continue;
    const gx = (SURF[k + 1] - SURF[k - 1]) / (2 * CELL), gz = (SURF[k + n] - SURF[k - n]) / (2 * CELL);
    if (isG(k + 1) && isG(k - 1) && isG(k + n) && isG(k - n)) CREV[k] = Math.max(CREV[k], sstep(Math.hypot(gx, gz), 0.12, 0.28));
  }
  const G = ramp(SURF, 0.22);

  // The glaciers on their own, before the cap is filled in round them: the
  // valley walls are cut down to THIS surface wherever they stand, cap or
  // not. Without it the cap's cells kept their rock at full height right up
  // to an outlet's edge, and a 700 m wall stood where the two met.
  const GIN = IN.slice();
  const GS = new Float32Array(N);
  for (let k = 0; k < N; k++) GS[k] = wsum[k] > 0 ? SURF[k] : -9999;

  // The glacier surface carried well out past its margins (the walls reach
  // ~0.8 of their height out from the edge), copying the cap's own fixes:
  // GS stays a glacier's surface rather than the cap's, and GIN its distance.
  for (let k = 0; k < N; k++) if (GIN[k] === NONE_IN) GIN[k] = -1e4;
  for (let k = 0; k < N; k++) if (GS[k] === -9999) GIN[k] = Math.min(GIN[k], -1e4);
  {
    // Nearest-glacier surface by chamfer, so the walls far from an outlet
    // still know which ice they come down to.
    const far = new Float32Array(N);
    for (let k = 0; k < N; k++) far[k] = GS[k] !== -9999 ? 0 : 1e9;
    const sweep = (fw) => {
      const js = fw ? [1, n - 1, 1] : [n - 2, 0, -1];
      for (let j = js[0]; fw ? j < js[1] : j > js[1]; j += js[2]) {
        for (let i = fw ? 1 : n - 2; fw ? i < n - 1 : i > 0; i += fw ? 1 : -1) {
          const k = idx(i, j);
          const nb = fw ? [k - 1, k - n, k - n - 1, k - n + 1] : [k + 1, k + n, k + n + 1, k + n - 1];
          for (let q = 0; q < 4; q++) {
            const kk = nb[q], L = q < 2 ? a1 : a2;
            if (far[kk] + L < far[k]) { far[k] = far[kk] + L; GS[k] = GS[kk]; }
          }
        }
      }
    };
    sweep(true); sweep(false); sweep(true);
    for (let k = 0; k < N; k++) {
      if (GS[k] === -9999) { GS[k] = B[k]; continue; }
      if (far[k] > 0) GIN[k] = Math.min(GIN[k] > -1e3 ? GIN[k] : -far[k], -far[k] * 0.999);
    }
  }

  // The bed as the glaciers left it: the same wall iceGround() cuts per
  // sample, on the raster, so the cap is laid over the valleys the outlets
  // cut and not over the rock that used to be there.
  const BC = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const d = B[k] - GS[k];
    BC[k] = d > 0 && GIN[k] > -1200 ? B[k] - d * sstep(GIN[k], -3 - 0.85 * d, 6) : B[k];
  }

  // The cap fills in round the glaciers. A glacier keeps its own surface —
  // the cap is drawn down to it (G above), never the other way round, or a
  // trunk running through high ground is lifted back up out of its valley.
  for (let k = 0; k < N; k++) {
    if (T[k] < 4 || isG(k)) continue;
    const bk = Math.max(BC[k], 0);
    const t = T[k];
    let capS = bk + t + (Bss[k] - bk) * sstep(t, 25, P.capT * 0.75);
    // Drawn down toward the outlets, but never thinner than a skin.
    capS = Math.max(Math.min(capS, G[k]), bk + Math.min(t, 35));
    const capIn = clamp((T[k] - 10) * 5, -200, 200);
    if (capIn > IN[k] || SURF[k] === -9999) {
      SURF[k] = capS; CAP[k] = 1; IN[k] = Math.max(IN[k], capIn);
    }
  }

  // Extrapolate the surface a few cells past the ice, so interpolating at the
  // margin does not drag it down toward the "no ice" value.
  for (let pass = 0; pass < 4; pass++) {
    const next = SURF.slice();
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = idx(i, j);
      if (SURF[k] !== -9999) continue;
      let s = 0, c = 0, v;
      if ((v = SURF[k - 1]) !== -9999) { s += v; c++; }
      if ((v = SURF[k + 1]) !== -9999) { s += v; c++; }
      if ((v = SURF[k - n]) !== -9999) { s += v; c++; }
      if ((v = SURF[k + n]) !== -9999) { s += v; c++; }
      if (c) next[k] = s / c;
    }
    SURF.set(next);
  }
  for (let k = 0; k < N; k++) if (SURF[k] === -9999) SURF[k] = B[k] - 60;

  return { name: isl.name, x0, z0, n, cell: CELL, ela: P.ela, IN, SURF, SA, U, MED, CREV, CAP, GIN, GS };
}

/**
 * Priority flood (Barnes et al.): raise every closed hollow in `S` to its
 * spill height plus a whisker, so steepest descent always reaches the sea.
 */
function fillPits(S, n, B) {
  const N = n * n;
  const done = new Uint8Array(N);
  // Binary heap of cell indices keyed on S.
  const heap = new Int32Array(N);
  let size = 0;
  const less = (a, b) => S[a] < S[b];
  const push = (k) => {
    let i = size++;
    heap[i] = k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      const t = heap[i]; heap[i] = heap[p]; heap[p] = t; i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    heap[0] = heap[--size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < size && less(heap[l], heap[m])) m = l;
      if (r < size && less(heap[r], heap[m])) m = r;
      if (m === i) break;
      const t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m;
    }
    return top;
  };
  for (let k = 0; k < N; k++) {
    const i = k % n, j = (k - i) / n;
    if (B[k] < 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) { done[k] = 1; push(k); }
  }
  while (size) {
    const k = pop();
    const i = k % n, j = (k - i) / n;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const kk = jj * n + ii;
      if (done[kk]) continue;
      done[kk] = 1;
      if (S[kk] <= S[k]) S[kk] = S[k] + 0.02;
      push(kk);
    }
  }
}

/** Box blur, separable, radius r cells, edges clamped. Running sums. */
function blur(src, n, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let j = 0; j < n; j++) {
    const row = j * n;
    let s = 0;
    for (let d = -r; d <= r; d++) s += src[row + clamp(d, 0, n - 1)];
    for (let i = 0; i < n; i++) {
      tmp[row + i] = s * inv;
      s += src[row + Math.min(n - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[clamp(d, 0, n - 1) * n + i];
    for (let j = 0; j < n; j++) {
      out[j * n + i] = s * inv;
      s += tmp[Math.min(n - 1, j + r + 1) * n + i] - tmp[Math.max(0, j - r) * n + i];
    }
  }
  return out;
}

// --- Sampling ---------------------------------------------------------------------

const _s = { inside: NONE_IN, surf: 0, s: 0, u: 0, med: 9, crev: 0, cap: 0, ela: 0, gin: NONE_IN, gs: 0 };

/** Bilinear read of one field's arrays at (x, z); null outside every field. */
export function sampleIce(fields, x, z) {
  for (const f of fields) {
    const fx = (x - f.x0) / f.cell, fz = (z - f.z0) / f.cell;
    if (fx < 0 || fz < 0 || fx >= f.n - 1 || fz >= f.n - 1) continue;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = j * f.n + i;
    const n = f.n;
    const bl = (A) => {
      const a = A[k] + (A[k + 1] - A[k]) * tx;
      const b = A[k + n] + (A[k + n + 1] - A[k + n]) * tx;
      return a + (b - a) * tz;
    };
    const inside = bl(f.IN);
    const gin = bl(f.GIN);
    if (inside < -120 && gin < -1200) return null;
    _s.inside = inside;
    _s.surf = bspline(f.SURF, n, i, j, tx, tz);
    _s.s = bl(f.SA);
    _s.u = bl(f.U);
    _s.crev = bl(f.CREV);
    _s.cap = bl(f.CAP);
    _s.gin = gin;
    _s.gs = bl(f.GS);
    // Medial moraine position is a label, not a quantity: nearest, not mixed.
    _s.med = f.MED[k + (tz > 0.5 ? n : 0) + (tx > 0.5 ? 1 : 0)];
    _s.ela = f.ela;
    return _s;
  }
  return null;
}

/**
 * Cubic B-spline read of the surface. Bilinear is only C0: across a 32 m
 * raster its creases are a quilt in the lighting of every snowfield. The
 * B-spline is C2, so the ice is as smooth as ice is.
 */
function bspline(A, n, i, j, tx, tz) {
  const wx = bw(tx), wz = bw(tz);
  let out = 0;
  for (let b = 0; b < 4; b++) {
    const jj = Math.min(n - 1, Math.max(0, j + b - 1));
    let row = 0;
    for (let a = 0; a < 4; a++) {
      const ii = Math.min(n - 1, Math.max(0, i + a - 1));
      row += A[jj * n + ii] * wx[a];
    }
    out += row * wz[b];
  }
  return out;
}
const _bw = [new Float64Array(4), new Float64Array(4)];
let _bwi = 0;
function bw(t) {
  const w = _bw[_bwi++ & 1];
  const t2 = t * t, t3 = t2 * t;
  w[0] = (1 - 3 * t + 3 * t2 - t3) / 6;
  w[1] = (4 - 6 * t2 + 3 * t3) / 6;
  w[2] = (1 + 3 * t + 3 * t2 - 3 * t3) / 6;
  w[3] = t3 / 6;
  return w;
}

/** How much of the ice margin's weight applies, from the inside distance. */
export function iceWeight(inside) { return sstep(inside, -3, 9); }

/**
 * The ground with the ice on it. Where the cap is the ice, rock higher than
 * its surface stands out of it (nunataks). Where a glacier is, the ice IS the
 * valley floor — it cut it — and the rock either side comes down to it in a
 * wall about sixty degrees steep, which is the U of a glaciated valley; where
 * the rock is lower (the sea, under a tongue), the ice ends in a cliff.
 */
export function iceGround(s, h) {
  // 1. The glaciers cut their valleys: rock standing above a glacier's surface
  //    comes down to it in a wall about fifty degrees steep — the U — however
  //    far up the side that takes it (gin is the distance in from the glacier's
  //    edge, negative outside it). Under the glacier, the ice is the ground.
  let g = h;
  if (s.gin > -1200) {
    const d = h - s.gs;
    const wG = d > 0 ? sstep(s.gin, -3 - 0.85 * d, 6)
      // Lower than the ice (the sea under a tongue, a hollow): on land the
      // ice edge comes down to the ground at about forty-five degrees; over
      // water it ends as a cliff.
      : sstep(s.gin, -2, 6 + (h > 0 ? -d * 0.9 : 0));
    g = h + (s.gs - h) * wG;
  }
  // 2. The cap lies over what is left, and whatever rock stands higher than
  //    its surface stands out of it: nunataks.
  if (s.cap <= 0.001) return g;
  const wCap = sstep(s.inside, -3, 9);
  const capH = g + (Math.max(g, s.surf) - g) * wCap;
  return g + (capH - g) * s.cap;
}

