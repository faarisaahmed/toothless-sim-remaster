import * as THREE from "three";

// ---------------------------------------------------------------------------
// Streaming terrain detail.
//
// The coarse sheet in world.js is 768 quads across ten kilometres, 13 m apiece,
// and it stays exactly as it is: it covers the whole archipelago in 64 draws,
// it is what the far distance and the water's mirror are drawn from, and on a
// low-end machine it is all there is. What this adds is a ring of fine chunks
// around the dragon that replace it where it is close enough to see the
// difference — which, at the heights he flies, is about two kilometres.
//
// The layout: each 1250 m coarse tile splits into 2 x 2 chunks of 625 m. A
// tile is either drawn coarse, or as its four chunks, never half and half,
// so there is no seam within a tile to worry about. Chunks pick a resolution
// by distance, and neighbours at different resolutions — and the border with
// coarse tiles — are stitched by the skirts the worker hangs off every edge.
//
// Building happens on a small worker pool (terrainworker.js), nearest first,
// and a chunk that is not ready yet simply leaves its tile coarse. Nothing ever
// waits on a worker: the worst case is that the detail arrives a moment late.
// ---------------------------------------------------------------------------

const PER_TILE = 2;

/**
 * Detail presets. `refine` is how far from the dragon a coarse tile is
 * replaced; `levels` pick a chunk's resolution by its own distance, first match
 * wins, and the last entry is the fallback for the rest of the ring.
 */
export const TERRAIN_DETAIL = {
  low:    null,
  medium: { refine: 1100, levels: [{ res: 96, r: Infinity }] },
  high:   { refine: 1700, levels: [{ res: 256, r: 650 }, { res: 96, r: Infinity }] },
  ultra:  { refine: 2200, levels: [{ res: 320, r: 550 }, { res: 160, r: 1300 },
                                   { res: 96, r: Infinity }] },
};

const indexCache = new Map();
function indexFor(res, edgeLoop) {
  if (indexCache.has(res)) return indexCache.get(res);
  const side = res + 1, grid = side * side, ring = res * 4;
  const idx = new Uint32Array(res * res * 6 + ring * 6);
  let w = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = i + side * j, b = i + side * (j + 1);
      const c = i + 1 + side * (j + 1), d = i + 1 + side * j;
      idx[w++] = a; idx[w++] = b; idx[w++] = d;
      idx[w++] = b; idx[w++] = c; idx[w++] = d;
    }
  }
  // Skirt quads, wound to face outward all the way round (the loop walks the
  // border in one consistent direction).
  const loop = edgeLoop(res);
  for (let k = 0; k < ring; k++) {
    const k1 = (k + 1) % ring;
    const a = loop[k], b = loop[k1], c = grid + k1, d = grid + k;
    idx[w++] = a; idx[w++] = b; idx[w++] = c;
    idx[w++] = a; idx[w++] = c; idx[w++] = d;
  }
  const attr = new THREE.BufferAttribute(idx, 1);
  indexCache.set(res, attr);
  return attr;
}

/**
 * @param {object} o
 *   parent     Group the chunks go into (the terrain group)
 *   material   the ground material, shared with the coarse tiles
 *   tiles      the coarse tile meshes, row-major, tilesPerSide x tilesPerSide
 *   tilesPerSide, size (world extent in metres)
 *   edgeLoop   from groundpaint.js
 */
export function createTerrainLod({ parent, material, tiles, tilesPerSide, size, edgeLoop }) {
  const half = size / 2;
  const tileSize = size / tilesPerSide;
  const chunkSize = tileSize / PER_TILE;
  const chunksPerSide = tilesPerSide * PER_TILE;

  const group = new THREE.Group();
  group.name = "terrain-detail";
  parent.add(group);

  let preset = null;
  // key `${cx},${cz},${res}` -> { mesh, used }
  const cache = new Map();
  const pending = new Map();         // key -> job, queued or running
  const refined = new Uint8Array(tilesPerSide * tilesPerSide);
  let budget = 64;                   // cached chunk meshes, any resolution

  // --- workers ----------------------------------------------------------
  const workers = [];
  let workersFailed = false;
  function ensureWorkers() {
    if (workers.length || workersFailed) return;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL("./terrainworker.js", import.meta.url), { type: "module" });
        w.busy = null;
        w.onmessage = (e) => onBuilt(w, e.data);
        w.onerror = (e) => {
          console.warn("terrainlod: worker failed — staying on the coarse terrain", e.message);
          workersFailed = true;
          for (const x of workers) x.terminate();
          workers.length = 0;
          pending.clear();
        };
        workers.push(w);
      }
    } catch (e) {
      console.warn("terrainlod: no module workers here — coarse terrain only", e);
      workersFailed = true;
    }
  }

  // Finished chunks wait here and go onto the GPU one per frame. Two or three
  // workers finishing in the same frame used to mean two or three 1.6 MB
  // uploads in one frame, which is a missed vsync you can see as a lurch.
  const ready = [];

  function onBuilt(w, data) {
    const job = w.busy;
    w.busy = null;
    if (!job || job.key !== data.id) return;
    pending.delete(job.key);
    if (!preset) return;             // detail was turned off while it built
    ready.push({ job, data });
  }

  function install({ job, data }) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.position, 3));
    g.setAttribute("normal", new THREE.InterleavedBufferAttribute(
      new THREE.InterleavedBuffer(data.normal, 4), 3, 0, true));
    g.setAttribute("color", new THREE.InterleavedBufferAttribute(
      new THREE.InterleavedBuffer(data.color, 4), 3, 0, true));
    g.setAttribute("aSurf", new THREE.InterleavedBufferAttribute(
      new THREE.InterleavedBuffer(data.surf, 4), 3, 0, true));
    g.setIndex(indexFor(job.res, edgeLoop));
    g.computeBoundingSphere();

    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.userData.chunk = job;
    group.add(mesh);
    cache.set(job.key, { mesh, used: performance.now(), cx: job.cx, cz: job.cz, res: job.res });
    dirty = true;
  }

  function dispatch() {
    if (!pending.size) return;
    for (const w of workers) {
      if (w.busy) continue;
      // Nearest first. The queue is a few dozen at most, so a scan beats a heap.
      let best = null;
      for (const job of pending.values()) {
        if (job.running) continue;
        if (!best || job.dist < best.dist) best = job;
      }
      if (!best) return;
      best.running = true;
      w.busy = best;
      w.postMessage({
        id: best.key,
        x0: -half + best.cx * chunkSize,
        z0: -half + best.cz * chunkSize,
        size: chunkSize, res: best.res,
        // Deep enough to cover the worst disagreement between the coarse sheet
        // and the real height field, which is at the lip of a stratum.
        skirt: 12 + chunkSize / best.res * 3,
      });
    }
  }

  // --- selection --------------------------------------------------------
  const rectDist = (x, z, x0, z0, s) => {
    const dx = Math.max(x0 - x, 0, x - (x0 + s));
    const dz = Math.max(z0 - z, 0, z - (z0 + s));
    return Math.hypot(dx, dz);
  };
  const resFor = (d) => {
    for (const l of preset.levels) if (d < l.r) return l.res;
    return preset.levels[preset.levels.length - 1].res;
  };

  let dirty = true;
  let since = 1;
  const shown = new Set();

  function select(focus) {
    const now = performance.now();
    const want = new Set();
    for (const job of pending.values()) job.wanted = false;

    for (let tj = 0; tj < tilesPerSide; tj++) {
      for (let ti = 0; ti < tilesPerSide; ti++) {
        const t = tj * tilesPerSide + ti;
        const d = rectDist(focus.x, focus.z, -half + ti * tileSize, -half + tj * tileSize, tileSize);
        // Hysteresis, so a tile on the boundary does not flick between the two
        // every time he banks.
        const on = preset && !workersFailed && d < preset.refine + (refined[t] ? 200 : 0);

        let complete = on;
        const picks = [];
        if (on) {
          for (let sj = 0; sj < PER_TILE; sj++) {
            for (let si = 0; si < PER_TILE; si++) {
              const cx = ti * PER_TILE + si, cz = tj * PER_TILE + sj;
              const cd = rectDist(focus.x, focus.z,
                -half + cx * chunkSize, -half + cz * chunkSize, chunkSize);
              const res = resFor(cd);
              const key = `${cx},${cz},${res}`;
              let have = cache.get(key);
              if (!have) {
                const job = pending.get(key);
                if (job) { job.wanted = true; job.dist = cd; }
                else pending.set(key, { key, cx, cz, res, dist: cd, wanted: true, running: false });
                // Anything at any resolution beats a hole: show whatever this
                // chunk was last built at while the right one is on its way.
                have = bestCached(cx, cz, res);
              }
              if (have) picks.push(have);
              else complete = false;
            }
          }
        }
        refined[t] = on ? 1 : 0;
        // The tile stays coarse until all four of its chunks can stand in for
        // it — half a tile fine and half coarse would put the seam in view.
        tiles[t].visible = !complete;
        if (complete) {
          for (const c of picks) { c.used = now; want.add(c.mesh); }
        }
      }
    }

    // Jobs nobody asks for any more are dropped before they are started; one
    // already on a worker finishes and goes into the cache, which is cheap.
    for (const [k, job] of pending) if (!job.wanted && !job.running) pending.delete(k);

    for (const m of shown) if (!want.has(m)) m.visible = false;
    for (const m of want) m.visible = true;
    shown.clear();
    for (const m of want) shown.add(m);

    evict(want);
  }

  function bestCached(cx, cz, res) {
    let best = null;
    for (const l of preset.levels) {
      const c = cache.get(`${cx},${cz},${l.res}`);
      // Prefer the finest one available that is not the one being waited for.
      if (c && (!best || Math.abs(l.res - res) < Math.abs(best.res - res))) best = c;
    }
    return best;
  }

  function evict(keep) {
    if (cache.size <= budget) return;
    const old = [...cache.entries()]
      .filter(([, c]) => !keep.has(c.mesh))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [k, c] of old) {
      if (cache.size <= budget) break;
      group.remove(c.mesh);
      // The index is shared per resolution and must outlive any one chunk, so
      // only the per-chunk attributes go.
      const g = c.mesh.geometry;
      g.setIndex(null);
      g.dispose();
      cache.delete(k);
    }
  }

  function clearAll() {
    for (const c of cache.values()) {
      group.remove(c.mesh);
      c.mesh.geometry.setIndex(null);
      c.mesh.geometry.dispose();
    }
    cache.clear();
    pending.clear();
    ready.length = 0;
    shown.clear();
    refined.fill(0);
    for (const t of tiles) t.visible = true;
  }

  // While the water draws its mirror, the coarse sheet stands in everywhere:
  // the reflection is 512 px of rippled blur and a million triangles of chunk
  // would buy nothing in it.
  const hiddenTiles = [];
  return {
    group,
    get detail() { return preset; },

    setDetail(name) {
      const p = TERRAIN_DETAIL[name] ?? null;
      if (p === preset) return;
      clearAll();
      preset = p;
      budget = p ? 40 + p.levels.length * 24 : 0;
      if (p) ensureWorkers();
      dirty = true;
    },

    update(focus, dt) {
      if (!preset || !focus) return;
      since += dt;
      // Selection is cheap but not free, and nothing about it needs to be
      // per-frame: at full sprint he crosses a chunk in two seconds.
      if (dirty || since > 0.12) {
        since = 0;
        dirty = false;
        select(focus);
      }
      dispatch();
      if (ready.length) install(ready.shift());
    },

    beforeReflect() {
      group.visible = false;
      hiddenTiles.length = 0;
      for (const t of tiles) if (!t.visible) { t.visible = true; hiddenTiles.push(t); }
    },
    afterReflect() {
      group.visible = true;
      for (const t of hiddenTiles) t.visible = false;
    },

    stats() {
      let tris = 0;
      for (const m of shown) tris += m.geometry.index.count / 3;
      return { chunks: shown.size, cached: cache.size, queued: pending.size, tris: Math.round(tris) };
    },

    dispose() {
      clearAll();
      for (const w of workers) w.terminate();
      workers.length = 0;
    },
  };
}
