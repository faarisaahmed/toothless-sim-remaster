// ---------------------------------------------------------------------------
// Where the water goes.
//
// Every island big enough to catch weather drains: rain runs downhill, gathers
// in the valleys terrain.js already cuts, pools where the ground holds it and
// reaches the sea as a burn, a river or a fall off the cliffs. This finds all
// of that once, at load, on the height field as the generator made it:
//
//   - a priority flood from the sea inwards, which routes water out of every
//     hollow and says how deep each hollow would have to fill to overflow;
//   - steepest descent on the filled surface, and the upstream area of every
//     cell, weighted by how wet the island is;
//   - a channel wherever that area is big enough to keep one running — so a
//     skerry gets nothing, a small island a burn or two, the big ones rivers
//     with tributaries;
//   - a lake wherever a river runs into a hollow deep enough to hold one, and
//     a few tarns in the high corries that hold water with no river through;
//   - a fall wherever the water goes over something steep, including the sea
//     cliffs a stream meets on a high coast.
//
// Pure: handed the height function and the island table rather than importing
// terrain.js, because terrain.js calls it at module load and the import would
// be a cycle. Deterministic, so the main thread and every worker that imports
// terrain.js find the same water.
// ---------------------------------------------------------------------------

const CELL = 75;             // m. The drainage grid; the lines are refined after.
const COARSE = 4;            // fine cells per coarse cell for the land mask

// A channel needs this much catchment (m² of rain, after wetness) to run.
const RIVER_AREA = 0.42e6;
// Half-width of the water from catchment: a burn at the threshold, a river at
// ten times it.
const halfWidth = (a) => Math.min(13, 1.6 + 2.6 * Math.sqrt(a / 1e6));
// How far the bed is cut below the ground it runs over.
const depthOf = (w) => 1.1 + w * 0.16;
// Slope over one 12 m step past which the water is falling, not running.
const FALL_DROP = 8;
const STEP = 12;             // m between refined points

const smooth01 = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {(x:number,z:number)=>number} heightAt  the field as generated
 * @param {object} o
 * @param {number} o.size                         world width, m
 * @param {(x:number,z:number)=>boolean} o.keepOut  true where no water may go
 * @param {(x:number,z:number)=>number} o.wetness   rainfall weight, 0..1
 * @param {(x:number,z:number,h:number)=>boolean} o.frozen  under ice/snow
 */
export function findWater(heightAt, o) {
  const N = Math.ceil(o.size / CELL);
  const X0 = -N * CELL / 2;
  const cx = (i) => X0 + (i + 0.5) * CELL;
  const H = new Float32Array(N * N).fill(-200);

  // --- Heights, only where there is land ------------------------------------
  // Coarse corners first; a block of fine cells is sampled only if one of its
  // corners is near the surface. The open sea is two thirds of the chart.
  const NC = Math.ceil(N / COARSE);
  const corner = new Float32Array((NC + 1) * (NC + 1));
  for (let j = 0; j <= NC; j++) for (let i = 0; i <= NC; i++)
    corner[j * (NC + 1) + i] = heightAt(X0 + i * CELL * COARSE, X0 + j * CELL * COARSE);
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
    const k = j * (NC + 1) + i;
    const top = Math.max(corner[k], corner[k + 1], corner[k + NC + 1], corner[k + NC + 2]);
    if (top < -30) continue;
    for (let jj = j * COARSE; jj < Math.min(N, (j + 1) * COARSE); jj++)
      for (let ii = i * COARSE; ii < Math.min(N, (i + 1) * COARSE); ii++)
        H[jj * N + ii] = heightAt(cx(ii), cx(jj));
  }

  // --- Priority flood ------------------------------------------------------
  const F = new Float32Array(N * N);
  const seen = new Uint8Array(N * N);
  const order = new Int32Array(N * N);
  let nOrder = 0;
  const heap = new Int32Array(N * N);
  let hn = 0;
  const push = (c) => {
    let k = hn++;
    heap[k] = c;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[heap[p]] <= F[c]) break;
      heap[k] = heap[p]; heap[p] = c; k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap[--hn];
    let k = 0;
    heap[0] = last;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < hn && F[heap[l]] < F[heap[m]]) m = l;
      if (r < hn && F[heap[r]] < F[heap[m]]) m = r;
      if (m === k) break;
      const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
    }
    return top;
  };
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = j * N + i;
    if (H[c] > 0) continue;
    // All of the sea is settled before it starts: only land gets flooded.
    seen[c] = 1; F[c] = H[c];
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii >= 0 && jj >= 0 && ii < N && jj < N && H[jj * N + ii] > 0) { push(c); break; }
    }
  }
  while (hn) {
    const c = pop();
    order[nOrder++] = c;
    const i = c % N, j = (c - i) / N;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const n = jj * N + ii;
      if (seen[n]) continue;
      seen[n] = 1;
      F[n] = Math.max(H[n], F[c] + 0.01);
      push(n);
    }
  }

  // --- Flow: steepest descent on the filled surface -------------------------
  const R = new Int32Array(N * N).fill(-1);
  for (let k = 0; k < nOrder; k++) {
    const c = order[k];
    if (H[c] <= 0) continue;
    const i = c % N, j = (c - i) / N;
    let best = -1, bs = 0;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const n = jj * N + ii;
      const s = (F[c] - F[n]) / (d < 4 ? 1 : Math.SQRT2);
      if (s > bs) { bs = s; best = n; }
    }
    R[c] = best;
  }

  // --- Upstream area --------------------------------------------------------
  const A = new Float32Array(N * N);
  for (let k = nOrder - 1; k >= 0; k--) {
    const c = order[k];
    if (H[c] <= 0) continue;
    const i = c % N, j = (c - i) / N;
    A[c] += CELL * CELL * o.wetness(cx(i), cx(j));
    if (R[c] >= 0 && H[R[c]] > 0) A[R[c]] += A[c];
  }

  // --- Which channels reach the sea without crossing somewhere they may not --
  // Walked downstream from every channel cell, memoised: a river that would run
  // through Berk's village or into the hunters' pit is not drawn at all, rather
  // than drawn up to the edge and stopped dead.
  const isRiver = (c) => H[c] > 0 && A[c] >= RIVER_AREA;
  const ok = new Int8Array(N * N);          // 0 unknown, 1 ok, -1 not
  const okDown = (c0) => {
    const path = [];
    let c = c0, v = 1;
    while (c >= 0 && H[c] > 0) {
      if (ok[c]) { v = ok[c]; break; }
      path.push(c);
      const i = c % N, j = (c - i) / N;
      if (o.keepOut(cx(i), cx(j))) { v = -1; break; }
      c = R[c];
    }
    for (const p of path) ok[p] = v;
    return v > 0;
  };

  // --- Chains: one per source, downstream to the sea or to a bigger river ----
  // Trunks first (largest catchment at the mouth), so a tributary always ends
  // on a channel that already exists.
  const onChain = new Int32Array(N * N).fill(-1);
  const sources = [];
  const hasUp = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) if (isRiver(c) && R[c] >= 0) hasUp[R[c]] = 1;
  for (let c = 0; c < N * N; c++) if (isRiver(c) && !hasUp[c] && okDown(c)) sources.push(c);
  const mouthArea = (c) => { let m = c; while (R[m] >= 0 && H[R[m]] > 0) m = R[m]; return A[m]; };
  sources.sort((a, b) => mouthArea(b) - mouthArea(a) || a - b);

  const chains = [];
  for (const s of sources) {
    const cells = [];
    let c = s, join = -1;
    while (c >= 0) {
      if (H[c] <= 0) { cells.push(c); break; }               // into the sea
      if (onChain[c] >= 0) { join = onChain[c]; cells.push(c); break; }
      cells.push(c);
      onChain[c] = chains.length;
      c = R[c];
    }
    if (cells.length >= 3) chains.push({ cells, join });
  }

  // --- Hollows on the rivers -----------------------------------------------
  // The generator's relief leaves hollows everywhere, some a hundred metres
  // deep, and a river that runs into one has to come out of it at the lip. A
  // couple to an island — the biggest — hold lakes. The rest are filled to a
  // flat floor a little under the lip, which is what a hollow on a river
  // becomes once it has silted up: a level flat with the river across it.
  // Hollows off the rivers are left as they are: dry ground holds hollows.
  const basinOf = new Int32Array(N * N).fill(-1);
  const basins = [];
  function basinFrom(c0) {
    const lvl0 = F[c0];
    const st = [c0], cells = [c0];
    basinOf[c0] = basins.length;
    let lvl = lvl0, deep = 0, i0 = N, i1 = 0, j0 = N, j1 = 0;
    while (st.length) {
      const c = st.pop();
      const i = c % N, j = (c - i) / N;
      lvl = Math.min(lvl, F[c]); deep = Math.max(deep, F[c] - H[c]);
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      for (let d = 0; d < 8; d++) {
        const ii = i + DI[d], jj = j + DJ[d];
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const n = jj * N + ii;
        if (basinOf[n] >= 0 || H[n] <= 0) continue;
        if (F[n] - H[n] > 0.05 && Math.abs(F[n] - lvl0) < 2) { basinOf[n] = basins.length; st.push(n); cells.push(n); }
      }
    }
    const b = { id: basins.length, cells, level: lvl, depth: deep, i0, i1, j0, j1, lake: -1,
                key: o.islandKey(cx(c0 % N), cx((c0 - c0 % N) / N)) };
    basins.push(b);
    return b;
  }
  for (const ch of chains) for (const c of ch.cells) {
    if (H[c] > 0 && F[c] - H[c] > 0.6 && basinOf[c] < 0) basinFrom(c);
  }

  const lakes = [];
  const lakeAt = (x, z) => {
    for (let k = 0; k < lakes.length; k++) {
      const L = lakes[k];
      if (x < L.x0 || z < L.z0 || x >= L.x0 + L.n * L.s || z >= L.z0 + L.n * L.s) continue;
      const i = Math.floor((x - L.x0) / L.s), j = Math.floor((z - L.z0) / L.s);
      if (L.mask[j * L.n + i]) return k;
    }
    return -1;
  };
  // The lake proper, on a 25 m grid round the hollow with its own little
  // flood, so the level is the real lip rather than the 60 m grid's guess at
  // it — a level a metre high spills the water over a saddle that is not there.
  function makeLake(b) {
    const s = 25;
    const x0 = cx(b.i0) - CELL * 2.5, z0 = cx(b.j0) - CELL * 2.5;
    const n = Math.ceil((Math.max(b.i1 - b.i0, b.j1 - b.j0) + 5) * CELL / s);
    if (n > 110) return -1;
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = heightAt(x0 + (i + 0.5) * s, z0 + (j + 0.5) * s);
    const inBasin = (k) => {
      const ci = Math.floor((x0 + (k % n + 0.5) * s - X0) / CELL), cj = Math.floor((z0 + (Math.floor(k / n) + 0.5) * s - X0) / CELL);
      return basinOf[cj * N + ci] === b.id;
    };
    let deep = -1;
    for (let k = 0; k < n * n; k++) if ((deep < 0 || h[k] < h[deep]) && inBasin(k)) deep = k;
    if (deep < 0) return -1;
    // Lowest first from the deepest point: the highest ground the flood has to
    // climb to reach the edge of the window is the lip it would spill over.
    const inQ = new Uint8Array(n * n);
    const hq = new Int32Array(n * n);
    let hqn = 0;
    const hpush = (c) => {
      let k = hqn++; hq[k] = c;
      while (k > 0) { const p = (k - 1) >> 1; if (h[hq[p]] <= h[c]) break; hq[k] = hq[p]; hq[p] = c; k = p; }
    };
    const hpop = () => {
      const top = hq[0], last = hq[--hqn];
      let k = 0; hq[0] = last;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hqn && h[hq[l]] < h[hq[m]]) m = l;
        if (r < hqn && h[hq[r]] < h[hq[m]]) m = r;
        if (m === k) break;
        const t = hq[m]; hq[m] = hq[k]; hq[k] = t; k = m;
      }
      return top;
    };
    hpush(deep); inQ[deep] = 1;
    let level = h[deep], spilt = false;
    while (hqn) {
      const c = hpop();
      level = Math.max(level, h[c]);
      const i = c % n, j = (c - i) / n;
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) { spilt = true; break; }
      for (const [a, bb] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const m = (j + bb) * n + i + a;
        if (!inQ[m]) { inQ[m] = 1; hpush(m); }
      }
    }
    if (!spilt) return -1;
    const L = level - 0.2;
    if (L - h[deep] < 3 || L <= 0.5) return -1;
    const mask = new Uint8Array(n * n);
    const st2 = [deep]; mask[deep] = 1;
    let area = 0;
    while (st2.length) {
      const c = st2.pop(); area++;
      const i = c % n, j = (c - i) / n;
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) return -1;   // leaked
      for (const [a, bb] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const m = (j + bb) * n + i + a;
        if (!mask[m] && h[m] < L) { mask[m] = 1; st2.push(m); }
      }
    }
    if (area * s * s < 15000) return -1;
    for (let k = 0; k < n * n; k++) if (mask[k]) {
      const x = x0 + (k % n + 0.5) * s, z = z0 + (Math.floor(k / n) + 0.5) * s;
      if (o.keepOut(x, z) || o.frozen(x, z, L)) return -1;
    }
    lakes.push({ level: L, x0, z0, s, n, mask, area: area * s * s, depth: L - h[deep] });
    return lakes.length - 1;
  }
  {
    const byIsland = new Map();
    for (const b of basins) (byIsland.get(b.key) || byIsland.set(b.key, []).get(b.key)).push(b);
    for (const list of byIsland.values()) {
      list.sort((a, b) => b.cells.length - a.cells.length || b.depth - a.depth);
      let made = 0, tries = 0;
      for (const b of list) {
        if (made >= 2 || tries >= 4 || b.cells.length < 4 || b.depth < 4) break;
        tries++;
        const id = makeLake(b);
        if (id >= 0) { b.lake = id; made++; }
      }
    }
  }
  // Everything else on a river is filled: a level for every cell of it, read
  // back bilinearly by fillAt so the floor has no 60 m steps in it.
  const FILL = new Float32Array(N * N).fill(-1e9);
  for (const b of basins) if (b.lake < 0) for (const c of b.cells) FILL[c] = b.level - 1.2;
  const fillAt = (x, z) => fillLookup(FILL, N, X0, x, z);
  const ground = (x, z) => {
    const h = heightAt(x, z);
    const f = fillAt(x, z);
    return f.w > 0 && f.level > h ? h + (f.level - h) * f.w : h;
  };

  // --- Refine: walk each line down the real valley floor ------------------
  // The drainage grid is 75 m and the valleys terrain.js cuts are narrower
  // than that, so its path keeps climbing onto the valley side — and water
  // that cannot run uphill then has to be cut a gorge through every rise. So
  // the line is walked again on the ground itself: from the source, a step at
  // a time, each step the lowest of a fan of headings, held near the grid's
  // line so it still ends where the drainage says it ends.
  const rivers = [];
  const falls = [];
  const chainLine = [];
  const INCISE = [];
  const FAN = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];
  for (const ch of chains) {
    const C = ch.cells.map((c) => {
      const i = c % N, j = (c - i) / N;
      return { x: cx(i), z: cx(j), a: A[c] };
    });
    const res = [{ x: C[0].x, z: C[0].z, a: C[0].a }];
    let x = C[0].x, z = C[0].z, ti = 1;
    let hx = C[1].x - x, hz = C[1].z - z;
    { const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l; }
    const maxSteps = Math.ceil(C.length * CELL * 2.2 / STEP);
    // Where it has been, on a 20 m grid: on flat ground the lowest step can
    // lead it round in a circle and back across itself, which would put the
    // same river through one place twice at two levels.
    const been = new Set();
    const cellKey = (px, pz) => Math.floor(px / 20) * 100003 + Math.floor(pz / 20);
    const recent = [];
    for (let n = 0; n < maxSteps && ti < C.length; n++) {
      // Aim: the next grid point not yet reached.
      while (ti < C.length - 1 && Math.hypot(C[ti].x - x, C[ti].z - z) < CELL * 0.7) ti++;
      const aim = C[ti];
      let ax = aim.x - x, az = aim.z - z;
      const al = Math.hypot(ax, az);
      if (ti === C.length - 1 && al < STEP * 1.2) break;
      ax /= al || 1; az /= al || 1;
      // Heading: mostly the way it was going, pulled toward the aim.
      let dx = hx * 0.5 + ax * 0.5, dz = hz * 0.5 + az * 0.5;
      { const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
      const prev = C[Math.max(0, ti - 1)];
      let best = null, bs = Infinity;
      for (const t of FAN) {
        const c = Math.cos(t), sn = Math.sin(t);
        const ux = dx * c - dz * sn, uz = dx * sn + dz * c;
        const px = x + ux * STEP, pz = z + uz * STEP;
        // Off the grid's line costs a little; turning away from the aim more.
        const sx = aim.x - prev.x, sz = aim.z - prev.z, sl2 = sx * sx + sz * sz || 1;
        let tt = ((px - prev.x) * sx + (pz - prev.z) * sz) / sl2;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const off = Math.hypot(px - prev.x - sx * tt, pz - prev.z - sz * tt);
        const score = ground(px, pz) + Math.max(0, off - CELL * 0.6) * 0.25 + (1 - (ux * ax + uz * az)) * 3
          + (been.has(cellKey(px, pz)) ? 1e4 : 0);
        if (score < bs) { bs = score; best = { x: px, z: pz, ux, uz }; }
      }
      x = best.x; z = best.z; hx = best.ux; hz = best.uz;
      // Marked a few steps late, so the cell it is standing in does not
      // forbid the next step out of it.
      recent.push(cellKey(x, z));
      if (recent.length > 3) been.add(recent.shift());
      res.push({ x, z, a: prev.a + (aim.a - prev.a) * 0.5 });
    }
    res.push({ ...C[C.length - 1] });
    // A tributary ends ON its trunk — the trunk's walked line, which can be
    // most of a grid cell off the cell the two met in.
    if (ch.join >= 0 && chainLine[ch.join]) {
      const T = chainLine[ch.join], e = res[res.length - 1];
      let bk = 0, bd = Infinity;
      for (let k = 0; k < T.length; k++) {
        const d = (T[k].x - e.x) ** 2 + (T[k].z - e.z) ** 2;
        if (d < bd) { bd = d; bk = k; }
      }
      e.x = T[bk].x; e.z = T[bk].z;
    }
    // A light smoothing takes out the step-to-step jitter of the fan.
    for (let r = 0; r < 2; r++) {
      for (let k = 1; k < res.length - 1; k++) {
        res[k].sx = (res[k - 1].x + 2 * res[k].x + res[k + 1].x) / 4;
        res[k].sz = (res[k - 1].z + 2 * res[k].z + res[k + 1].z) / 4;
      }
      for (let k = 1; k < res.length - 1; k++) { res[k].x = res[k].sx; res[k].z = res[k].sz; }
    }
    chainLine.push(res);
  }

  // --- Surfaces, beds, lakes and falls along each line ----------------------
  for (let ci = 0; ci < chains.length; ci++) {
    const res = chainLine[ci];
    const ch = chains[ci];
    let run = [];
    let bed = Infinity;
    let fromLake = -1;
    const flush = (into) => {
      if (run.length >= 2) rivers.push({ pts: run, intoLake: into, fromLake });
      run = [];
    };
    for (let k = 0; k < res.length; k++) {
      const p = res[k];
      const w = halfWidth(p.a);
      const a = res[Math.max(0, k - 1)], b = res[Math.min(res.length - 1, k + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const g = Math.min(ground(p.x, p.z), ground(p.x - tz * w * 0.7, p.z + tx * w * 0.7),
                         ground(p.x + tz * w * 0.7, p.z - tx * w * 0.7));
      // Ice: nothing runs on top of a glacier. The water starts at the snout.
      if (o.frozen(p.x, p.z, g)) { flush(-1); bed = Infinity; continue; }
      const lk = lakeAt(p.x, p.z);
      if (lk >= 0) {
        // Into a lake: the run ends at its shore and the next starts at its
        // outlet, at its level.
        if (run.length) { run.push({ x: p.x, z: p.z, y: lakes[lk].level, w, a: p.a }); flush(lk); }
        fromLake = lk;
        bed = lakes[lk].level - depthOf(w);
        continue;
      }
      if (g <= 0.3) {
        // The sea. If the water is still well above it, it goes over the edge.
        if (run.length) {
          const last = run[run.length - 1];
          if (last.y > 5) falls.push({ x: last.x, z: last.z, top: last.y, w: last.w, dx: tx, dz: tz, sea: true });
          run.push({ x: p.x, z: p.z, y: Math.min(last.y, 0.35), w, a: p.a, mouth: true });
        }
        break;
      }
      const d = depthOf(w);
      const prevBed = bed;
      bed = Math.min(bed === Infinity ? g - d : bed - 0.03, g - d);
      const inc = Math.max(0, g - d - bed);
      INCISE.push(inc);
      const y = bed + d * 0.55;
      p.bed = bed;
      // Over something steep: a fall. Steps within a few points of each other
      // are one fall down a broken face, not a staircase of little ones.
      if (run.length && prevBed !== Infinity && prevBed - bed > FALL_DROP) {
        const last = run[run.length - 1];
        const f = falls[falls.length - 1];
        if (f && !f.sea && f.run === rivers.length && run.length - f.k <= 4) { f.bottom = y; f.k = run.length; f.x1 = p.x; f.z1 = p.z; }
        else falls.push({ x: last.x, z: last.z, x1: p.x, z1: p.z, top: last.y, bottom: y, w, dx: tx, dz: tz, run: rivers.length, k: run.length });
      }
      run.push({ x: p.x, z: p.z, y, w, a: p.a, bed, inc });
      if (fromLake >= 0 && run.length === 1) run[0].y = Math.min(run[0].y, lakes[fromLake].level);
    }
    // A tributary ends on its trunk: the last point is pulled down to the
    // trunk's water so the two meet rather than one stepping onto the other.
    flush(-1);
    void ch;
  }

  // Lines that came to nothing (one point between two lakes) are dropped above.
  return { rivers, lakes, falls, fill: { grid: FILL, N, X0, CELL },
    stats: { sources: sources.length, chains: chains.length, basins: basins.length, incise: INCISE } };
}

/**
 * The silted floor of a filled hollow at (x, z): its level and how much of it
 * is here (0 outside, 1 well inside), bilinear over the drainage grid.
 */
export function fillLookup(grid, N, X0, x, z) {
  const fx = (x - X0) / CELL - 0.5, fz = (z - X0) / CELL - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return NO_FILL;
  const tx = fx - i, tz = fz - j;
  const k = j * N + i;
  let w = 0, lv = 0;
  const add = (c, wt) => { if (grid[c] > -1e8 && wt > 0) { w += wt; lv += grid[c] * wt; } };
  add(k, (1 - tx) * (1 - tz)); add(k + 1, tx * (1 - tz));
  add(k + N, (1 - tx) * tz); add(k + N + 1, tx * tz);
  if (w <= 0) return NO_FILL;
  _fill.w = w; _fill.level = lv / w;
  return _fill;
}
const NO_FILL = { w: 0, level: 0 };
const _fill = { w: 0, level: 0 };

export const WATER_STEP = STEP;
export { smooth01 };

// ---------------------------------------------------------------------------
// The carve: what terrain.js does to the ground with all of the above, in the
// hot path of every height sample. A hollow on a river is silted up to its
// floor; a channel is cut along every run, flat-bedded, with banks that lie
// back the further they are from the water. Never raised except by the silt,
// and the silt only ever fills.
// ---------------------------------------------------------------------------
const HASH = 96;            // m per spatial-hash cell
// How far out the carve reaches. Where the river has had to cut down through
// a rise, the cut lies back further — a V through the rise as wide as it is
// deep, which is what a river does to one, and wide enough for the ground
// mesh to draw rather than a slot it bridges straight over.
const bankOf = (w, inc = 0) => 9 + w * 1.6 + Math.min(inc, 40) * 1.7;

export function makeCarver(W) {
  // Every segment of every run, in flat arrays.
  const ax = [], az = [], bx = [], bz = [], ya = [], yb = [], wa = [], wb = [], ia = [], ib = [];
  for (const r of W.rivers) {
    const P = r.pts;
    for (let k = 0; k < P.length - 1; k++) {
      const p = P[k], q = P[k + 1];
      if (p.bed === undefined && q.bed === undefined) continue;
      ax.push(p.x); az.push(p.z); bx.push(q.x); bz.push(q.z);
      const pb = p.bed ?? (q.bed + 0.2), qb = q.bed ?? p.bed;
      ya.push(pb); yb.push(qb); wa.push(p.w); wb.push(q.w);
      ia.push(p.inc ?? 0); ib.push(q.inc ?? p.inc ?? 0);
    }
  }
  const S = ax.length;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < S; k++) {
    minX = Math.min(minX, ax[k], bx[k]); maxX = Math.max(maxX, ax[k], bx[k]);
    minZ = Math.min(minZ, az[k], bz[k]); maxZ = Math.max(maxZ, az[k], bz[k]);
  }
  let maxInc = 0;
  for (let k = 0; k < S; k++) maxInc = Math.max(maxInc, ia[k], ib[k]);
  const pad = bankOf(14, maxInc) + 20;
  minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const NX = Math.max(1, Math.ceil((maxX - minX) / HASH)), NZ = Math.max(1, Math.ceil((maxZ - minZ) / HASH));
  const buckets = new Map();
  for (let k = 0; k < S; k++) {
    const r = Math.max(wa[k], wb[k]) + bankOf(Math.max(wa[k], wb[k]), Math.max(ia[k], ib[k]));
    const i0 = Math.floor((Math.min(ax[k], bx[k]) - r - minX) / HASH), i1 = Math.floor((Math.max(ax[k], bx[k]) + r - minX) / HASH);
    const j0 = Math.floor((Math.min(az[k], bz[k]) - r - minZ) / HASH), j1 = Math.floor((Math.max(az[k], bz[k]) + r - minZ) / HASH);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = j * NX + i;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(k);
    }
  }
  const cellSeg = new Map();
  let most = 1;
  for (const v of buckets.values()) most = Math.max(most, v.length);
  const _e = new Float64Array(most), _t = new Float64Array(most);
  for (const [k, v] of buckets) cellSeg.set(k, Int32Array.from(v));
  const F = W.fill;

  // Nearest channel to a point: distance past its edge, its bed, its width.
  const near = { e: Infinity, bed: 0, w: 0, d: Infinity, inc: 0 };
  function nearest(x, z) {
    near.e = Infinity; near.d = Infinity;
    if (x < minX || z < minZ || x >= maxX || z >= maxZ) return near;
    const list = cellSeg.get(Math.floor((z - minZ) / HASH) * NX + Math.floor((x - minX) / HASH));
    if (!list) return near;
    for (let n = 0; n < list.length; n++) {
      const k = list[n];
      const dx = bx[k] - ax[k], dz = bz[k] - az[k];
      const L2 = dx * dx + dz * dz || 1;
      let t = ((x - ax[k]) * dx + (z - az[k]) * dz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax[k] + dx * t - x, pz = az[k] + dz * t - z;
      const d = Math.sqrt(px * px + pz * pz);
      const w = wa[k] + (wb[k] - wa[k]) * t;
      const e = d - w;
      if (e < near.e) { near.e = e; near.d = d; near.w = w; near.bed = ya[k] + (yb[k] - ya[k]) * t; near.inc = ia[k] + (ib[k] - ia[k]) * t; }
    }
    return near;
  }

  return {
    nearest,
    carve(x, z, h) {
      if (F) {
        const f = fillLookup(F.grid, F.N, F.X0, x, z);
        if (f.w > 0 && f.level > h) h += (f.level - h) * f.w;
      }
      if (x < minX || z < minZ || x >= maxX || z >= maxZ) return h;
      const list = cellSeg.get(Math.floor((z - minZ) / HASH) * NX + Math.floor((x - minX) / HASH));
      if (!list) return h;
      // The nearest channel cuts — and any other as near as it, so where a
      // burn joins a river the deeper cut wins and neither one's bank fills
      // the other. Only as near: the run below a fall passes within a bank's
      // width of the water above the lip, and must not dig the ground out
      // from under it.
      let eMin = Infinity;
      for (let n = 0; n < list.length; n++) {
        const k = list[n];
        const dx = bx[k] - ax[k], dz = bz[k] - az[k];
        const L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax[k]) * dx + (z - az[k]) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax[k] + dx * t - x, pz = az[k] + dz * t - z;
        const ee = Math.sqrt(px * px + pz * pz) - (wa[k] + (wb[k] - wa[k]) * t);
        _e[n] = ee; _t[n] = t;
        if (ee < eMin) eMin = ee;
      }
      let out = h;
      for (let n = 0; n < list.length; n++) {
        const ee = _e[n];
        if (ee > eMin + 2) continue;
        const k = list[n], t = _t[n];
        const w = wa[k] + (wb[k] - wa[k]) * t;
        const bank = bankOf(w, ia[k] + (ib[k] - ia[k]) * t);
        if (ee >= bank) continue;
        const bed = ya[k] + (yb[k] - ya[k]) * t;
        // Flat bed across the water, a lip at its edge, then the bank lying back.
        const e = ee > 0 ? ee : 0;
        const tgt = bed + (ee < 0 ? 0.35 * (1 + ee / w) : 0.35 + e * 0.75 + e * e * 0.025);
        const kk = smooth01(e, bank * 0.55, bank);
        const v = Math.min(h, tgt) * (1 - kk) + h * kk;
        if (v < out) out = v;
      }
      return out;
    },
    /** 0..1: how close (x, z, ground h) is to water's edge, for wet ground. */
    wet(x, z, h) {
      let w = 0;
      const n = nearest(x, z);
      if (n.e !== Infinity) w = 1 - smooth01(n.e, 0, 6 + n.w * 1.2);
      // A lake's shore: the last couple of metres above its level, inside the
      // hollow it fills.
      for (const L of W.lakes) {
        if (x < L.x0 || z < L.z0 || x >= L.x0 + L.n * L.s || z >= L.z0 + L.n * L.s) continue;
        if (h === undefined || h > L.level + 3) continue;
        w = Math.max(w, 1 - smooth01(h - L.level, 0.3, 3));
      }
      return w;
    },
  };
}
