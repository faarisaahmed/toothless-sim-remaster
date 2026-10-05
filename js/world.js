import * as THREE from "three";
import {
  terrainHeight, ISLANDS, TERRAIN_SIZE, SEA_LEVEL, WIND_BEARING,
} from "./terrain.js";
import { paintGround, edgeLoop } from "./groundpaint.js";
import { createTerrainLod } from "./terrainlod.js";
import { loadGround, makeTerrainMaterial, applyGround, setGroundLowQuality } from "./terrainmat.js";
import { bakeSeaField } from "./sea_field.js";
import { createOcean } from "./ocean.js";
import { createSurf } from "./surf.js";
import { createFlora } from "./flora.js";
import { createSky } from "./sky.js";
import { createRain, thunder } from "./rain.js";
import { createPhotoreal, sweepPhotoreal } from "./photoreal.js";

// ---------------------------------------------------------------------------
// The world.
//
// The archipelago's SHAPE lives in terrain.js and nothing here may contradict
// it: map.js redraws the coastlines from the same terrainHeight, sea_field.js
// bakes the surf off it, and main.js flies into it. This file is everything
// that turns that height field into something to look at — the sky, the ground
// material, the sea, the forests — plus the four exports the rest of the game
// imports from here and has done since before any of it existed.
//
// Those four are re-exported rather than redefined, so there is exactly one
// definition of each in the codebase:
export { terrainHeight, ISLANDS, TERRAIN_SIZE, SEA_LEVEL };

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
// 768, not the 480 this had. See §5 of ARCHIPELAGO_HANDOFF.md — raising this
// is called out there as the most expensive single change available, and it is:
// 1.18M triangles instead of 460k, a 28 MB vertex buffer, and about 0.7 s of
// load instead of 0.3. It is still ONE draw call and no extra lights, which are
// the two budgets that were actually hurting.
//
// It buys 13 m per quad instead of 21, and the reason that matters is the
// frequency ceiling documented in terrain.js: the mesh spacing is the hard
// limit on how fine the coastline and the crags are allowed to be, and at 21 m
// the islands could not hold a headland under a hundred metres across.
const TERRAIN_SEGMENTS = 768;   // ~13 world units per quad

// The sun, the weather and the clouds belong to sky.js now.

const GRID_SPACING = 200;
const GRID_STEP    = 25;
const GRID_LIFT    = 1.5;

const clamp = THREE.MathUtils.clamp;
const smoothstep = THREE.MathUtils.smoothstep;

// ---------------------------------------------------------------------------
export function setupWorld(scene, renderer, quality = {}) {
  // Load timing. All of this is synchronous work on the main thread, which
  // means every millisecond of it is a millisecond the tab is unresponsive —
  // and when a load stall and a runtime stall look identical from the outside,
  // the only way to tell them apart is to have written down which one it was.
  const marks = [];
  let markT = performance.now();
  const mark = (label) => {
    const now = performance.now();
    marks.push(`${label} ${Math.round(now - markT)}ms`);
    markT = now;
  };
  const q = {
    shadowMap: 2048, reflectEvery: 1,
    treeNear: undefined, treeFar: undefined, grass: false, terrainDetail: "high",
    ...quality,
  };
  // Which way the shadow-casting light shines from: the sun by day, the moon
  // by night. sky.js writes it every frame.
  const sunDir = new THREE.Vector3(0.4, 0.6, -0.5).normalize();

  // --- Lighting ---
  // scene.environment already supplies the full sky ambient, so the direct
  // lights only need to add the sun's key and a touch of ground bounce.
  // Stacking a bright sun + hemisphere on top of IBL is what blew this out.
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.copy(sunDir).multiplyScalar(500);
  sun.castShadow = q.shadowMap > 0;
  sun.shadow.mapSize.set(q.shadowMap || 1024, q.shadowMap || 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1500;
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  // Kept low deliberately — this is a warm bounce on top of the IBL, not the
  // main ambient source.
  const hemi = new THREE.HemisphereLight(0x9ec8f5, 0x6d7a48, 0.28);
  scene.add(hemi);

  // -------------------------------------------------------------------------
  // Terrain
  // -------------------------------------------------------------------------
  const geo = new THREE.PlaneGeometry(
    TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS
  );
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const verts = TERRAIN_SEGMENTS + 1;
  const colors = new Float32Array(pos.count * 3);
  // What is growing on / lying on each vertex: vegetation, sand, snow. The
  // ground material blends its six textures with these, so the forest floor is
  // under the forest and the beach texture is on the beach — the alternative is
  // deciding that per pixel from height and slope alone, which puts sand
  // halfway up a hill because the hill happens to be flat there.
  const surf = new Float32Array(pos.count * 3);

  // Height once per vertex, then slope from grid neighbours — three times
  // cheaper than re-evaluating the noise for finite differences.
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = terrainHeight(pos.getX(i), pos.getZ(i));
    heights[i] = h;
    pos.setY(i, h);
  }
  mark("heights");

  // What every vertex is coloured, and what is lying on it, comes from
  // groundpaint.js — shared with the worker that builds the fine chunks, so
  // the two meshes agree about the ground wherever they meet.
  const quad = TERRAIN_SIZE / TERRAIN_SEGMENTS;
  const paint = new Float32Array(6);

  for (let i = 0; i < pos.count; i++) {
    const row = Math.floor(i / verts);
    const col = i % verts;
    const h = heights[i];

    const hL = heights[i - (col > 0 ? 1 : 0)];
    const hR = heights[i + (col < verts - 1 ? 1 : 0)];
    const hU = heights[i - (row > 0 ? verts : 0)];
    const hD = heights[i + (row < verts - 1 ? verts : 0)];
    const slope = Math.min(1, Math.hypot(hR - hL, hD - hU) / (quad * 2.2));
    const curvature = h - (hL + hR + hU + hD) / 4;

    paintGround(pos.getX(i), pos.getZ(i), h, slope, curvature, paint, 0);
    colors[i * 3]     = paint[0];
    colors[i * 3 + 1] = paint[1];
    colors[i * 3 + 2] = paint[2];
    surf[i * 3]     = paint[3];
    surf[i * 3 + 1] = paint[4];
    surf[i * 3 + 2] = paint[5];
  }

  mark("colours");

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aSurf", new THREE.BufferAttribute(surf, 3));
  // Normals are computed ONCE, across the whole grid, before it is cut up. Doing
  // it per tile afterwards would give each tile its own idea of the normal along
  // its edge, and a lighting seam on every tile boundary — sixteen straight
  // lines across the archipelago, visible from the air, impossible to unsee.
  geo.computeVertexNormals();

  // Photoreal's terrain shadows and sky occlusion are baked from these same
  // heights, so the shadow of a ridge falls from the ridge the mesh has.
  const photoreal = renderer
    ? createPhotoreal(renderer, { heights, verts, size: TERRAIN_SIZE })
    : null;

  const groundMat = makeTerrainMaterial({}, SEA_LEVEL);
  let sweepT = 0;

  // -------------------------------------------------------------------------
  // Cut the terrain into tiles.
  //
  // It was one 768 x 768 mesh: 1.18 million triangles in a single draw call,
  // which sounds efficient and is the most expensive thing in the frame. A mesh
  // is culled as a unit, and this one's bounding sphere is ten kilometres
  // across, so it is never off screen — every triangle in the archipelago was
  // being transformed every frame no matter where the camera pointed, and then
  // again for the water's reflection.
  //
  // Cut into 8 x 8, each tile is 1.25 km across with its own bounding sphere,
  // and three's frustum culling does the obvious thing: flying level you see
  // maybe a third of them, and the mirror camera sees fewer. The cost is 64
  // draw calls instead of 1, which is nothing — draw calls are cheap and
  // vertices are not. Same vertices, same normals, same colours; the only thing
  // that changes is how much of it can be skipped.
  // -------------------------------------------------------------------------
  const GROUND_TILES = 8;
  const TSEG = TERRAIN_SEGMENTS / GROUND_TILES;      // 96 quads per tile
  const TVERT = TSEG + 1;

  const gpos = geo.attributes.position.array;
  const gnrm = geo.attributes.normal.array;
  const guv  = geo.attributes.uv.array;

  // Every tile is the same grid, so they share one index buffer — one upload,
  // one GPU allocation, 64 users. (Which is also why no tile is ever disposed
  // on its own: three would free the shared buffer out from under the rest.)
  const tileIdx = new Uint16Array(TSEG * TSEG * 6);
  let w = 0;
  for (let iy = 0; iy < TSEG; iy++) {
    for (let ix = 0; ix < TSEG; ix++) {
      const a = ix + TVERT * iy;
      const b = ix + TVERT * (iy + 1);
      const c = ix + 1 + TVERT * (iy + 1);
      const d = ix + 1 + TVERT * iy;
      tileIdx[w++] = a; tileIdx[w++] = b; tileIdx[w++] = d;
      tileIdx[w++] = b; tileIdx[w++] = c; tileIdx[w++] = d;
    }
  }
  const sharedIndex = new THREE.BufferAttribute(tileIdx, 1);

  const ground = new THREE.Group();
  ground.name = "terrain";
  const groundTiles = [];

  for (let tj = 0; tj < GROUND_TILES; tj++) {
    for (let ti = 0; ti < GROUND_TILES; ti++) {
      const n = TVERT * TVERT;
      const tp = new Float32Array(n * 3), tn = new Float32Array(n * 3);
      const tc = new Float32Array(n * 3), ts = new Float32Array(n * 3);
      const tu = new Float32Array(n * 2);

      let o3 = 0, o2 = 0;
      for (let ly = 0; ly < TVERT; ly++) {
        // Rows are contiguous in the source grid, so a tile row is one straight
        // run of 97 vertices — no per-vertex index arithmetic in the inner loop.
        let s3 = ((tj * TSEG + ly) * verts + ti * TSEG) * 3;
        let s2 = ((tj * TSEG + ly) * verts + ti * TSEG) * 2;
        for (let lx = 0; lx < TVERT; lx++, o3 += 3, s3 += 3, o2 += 2, s2 += 2) {
          tp[o3] = gpos[s3]; tp[o3 + 1] = gpos[s3 + 1]; tp[o3 + 2] = gpos[s3 + 2];
          tn[o3] = gnrm[s3]; tn[o3 + 1] = gnrm[s3 + 1]; tn[o3 + 2] = gnrm[s3 + 2];
          tc[o3] = colors[s3]; tc[o3 + 1] = colors[s3 + 1]; tc[o3 + 2] = colors[s3 + 2];
          ts[o3] = surf[s3]; ts[o3 + 1] = surf[s3 + 1]; ts[o3 + 2] = surf[s3 + 2];
          tu[o2] = guv[s2]; tu[o2 + 1] = guv[s2 + 1];
        }
      }

      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.BufferAttribute(tp, 3));
      tg.setAttribute("normal", new THREE.BufferAttribute(tn, 3));
      tg.setAttribute("uv", new THREE.BufferAttribute(tu, 2));
      tg.setAttribute("color", new THREE.BufferAttribute(tc, 3));
      tg.setAttribute("aSurf", new THREE.BufferAttribute(ts, 3));
      tg.setIndex(sharedIndex);
      tg.computeBoundingSphere();

      const tile = new THREE.Mesh(tg, groundMat);
      tile.receiveShadow = true;
      tile.castShadow = false;    // 1.18M triangles into a 360 m shadow box
      tile.matrixAutoUpdate = false;
      ground.add(tile);
      groundTiles.push(tile);
    }
  }
  scene.add(ground);
  geo.dispose();                  // the uncut original has done its job
  mark("tiles");

  // Fine chunks streamed in around the dragon, over the top of the sheet above.
  const detail = createTerrainLod({
    parent: ground, material: groundMat, tiles: groundTiles,
    tilesPerSide: GROUND_TILES, size: TERRAIN_SIZE, edgeLoop,
  });
  detail.setDetail(q.terrainDetail);
  setGroundLowQuality(groundMat, q.terrainDetail === "low");

  // The photographs are the one thing here that has to come off the network, so
  // the terrain is built with flat stand-ins and they are swapped in when they
  // land. Nothing recompiles: the uniforms already point at a 1x1 texture of the
  // same type, and only the value changes.
  const groundReady = loadGround().then((tex) => {
    const have = applyGround(groundMat, tex);
    console.info(`world: ground textures in — ${have.join(", ") || "none"}`);
    return tex;
  }).catch((e) => { console.warn("world: ground textures failed", e); return null; });

  // -------------------------------------------------------------------------
  // Sea
  // -------------------------------------------------------------------------
  const seaField = bakeSeaField();
  mark("seaField");
  const ocean = createOcean({ scene, renderer, seaField, sunDirection: sunDir });
  const surfSpray = createSurf({ scene, seaField, foamTexture: ocean.foamTexture });
  mark("ocean+surf");

  // -------------------------------------------------------------------------
  // Forests
  // -------------------------------------------------------------------------
  // The vegetation paint per terrain vertex, for the Ultra grass field to
  // read on the GPU: grows / sand / snow, the same numbers the ground shader
  // blends its textures by.
  const surfBytes = new Uint8Array(verts * verts * 4);
  for (let i = 0; i < verts * verts; i++) {
    surfBytes[i * 4] = Math.round(Math.min(1, Math.max(0, surf[i * 3])) * 255);
    surfBytes[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, surf[i * 3 + 1])) * 255);
    surfBytes[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, surf[i * 3 + 2])) * 255);
    surfBytes[i * 4 + 3] = 255;
  }
  const surfTex = new THREE.DataTexture(surfBytes, verts, verts);
  surfTex.magFilter = surfTex.minFilter = THREE.LinearFilter;
  surfTex.needsUpdate = true;
  // And the ground's colour, so the grass is the green of the turf it is on.
  // Stored sRGB for precision in the darks; sampling decodes it to linear.
  const colBytes = new Uint8Array(verts * verts * 4);
  const enc = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  for (let i = 0; i < verts * verts; i++) {
    colBytes[i * 4] = enc(Math.min(1, Math.max(0, colors[i * 3])));
    colBytes[i * 4 + 1] = enc(Math.min(1, Math.max(0, colors[i * 3 + 1])));
    colBytes[i * 4 + 2] = enc(Math.min(1, Math.max(0, colors[i * 3 + 2])));
    colBytes[i * 4 + 3] = 255;
  }
  const colourTex = new THREE.DataTexture(colBytes, verts, verts);
  colourTex.colorSpace = THREE.SRGBColorSpace;
  colourTex.magFilter = colourTex.minFilter = THREE.LinearFilter;
  colourTex.needsUpdate = true;

  const flora = createFlora(scene, {
    renderer,
    field: photoreal ? {
      heightTex: photoreal.textures.height, surfTex, colourTex, verts, size: TERRAIN_SIZE,
    } : null,
    grass: q.grass,
    nearLod: q.treeNear,
    farLod: q.treeFar,
  });
  mark("flora");

  // --- Contour grid overlay (G) ---
  const half = TERRAIN_SIZE / 2;
  const gridPts = [];

  for (let x = -half; x <= half; x += GRID_SPACING) {
    for (let z = -half; z < half; z += GRID_STEP) {
      gridPts.push(x, terrainHeight(x, z) + GRID_LIFT, z);
      gridPts.push(x, terrainHeight(x, z + GRID_STEP) + GRID_LIFT, z + GRID_STEP);
    }
  }
  for (let z = -half; z <= half; z += GRID_SPACING) {
    for (let x = -half; x < half; x += GRID_STEP) {
      gridPts.push(x, terrainHeight(x, z) + GRID_LIFT, z);
      gridPts.push(x + GRID_STEP, terrainHeight(x + GRID_STEP, z) + GRID_LIFT, z);
    }
  }

  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  mark("contourGrid");
  const grid = new THREE.LineSegments(
    gridGeo,
    new THREE.LineBasicMaterial({
      color: 0x6ff0ff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      fog: true,
    })
  );
  grid.visible = false;
  scene.add(grid);

  // --- Sky, weather, rain ---
  const sky = createSky({ scene, renderer, sun, hemi, ocean, lightDir: sunDir });
  const rain = createRain(scene);
  sky.setRain(rain);
  sky.onThunder((d) => thunder(d));
  mark("sky");

  // --- Renderer setup that has to match the sky's dynamic range ---
  if (renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  // One line in the console saying what this actually is, because "the trees
  // did not load" and "the trees loaded and you are too high to see them" look
  // identical from the cockpit.

  console.info(`world: build ${marks.join(", ")}`);
  console.info(
    `world: ${ISLANDS.length} islands (${ISLANDS.filter((i) => i.name).length} named), ` +
    `${flora.treeCount} trees over ${flora.tileCount} tiles, ${flora.boulderCount} boulders, ` +
    `${surfSpray.siteCount} surf sites, ${groundTiles.length} terrain tiles, ` +
    `shadows ${q.shadowMap}, grass ${flora.hasGrass ? "on" : "off"}`);

  // -------------------------------------------------------------------------
  // What the sea is allowed to see.
  //
  // The reflection is 512 pixels across, mirrored, and then torn up by a
  // four-layer scrolling normal map before anyone looks at it. What survives
  // that is the sky, the shape of the land and the dragon. Everything else in
  // this list was being drawn a second time every frame to contribute less than
  // a pixel of blur, and the trees alone are ~30 instanced draw calls.
  // -------------------------------------------------------------------------
  ocean.excludeFromReflection(flora.root, surfSpray.mesh, grid, rain.mesh);
  ocean.setReflectionEvery(q.reflectEvery);
  ocean.setReflectionHooks(
    () => { detail.beforeReflect(); sky.beforeReflect(); },
    () => { detail.afterReflect(); sky.afterReflect(); });

  const water = ocean.mesh;

  return {
    /** So main.js can add the compound and the stack once they have loaded. */
    excludeFromReflection: (...o) => ocean.excludeFromReflection(...o),
    groundTiles,
    detail,
    ground,
    water,
    ocean,
    surf: surfSpray,
    flora,
    seaField,
    grid,
    sun,
    hemi,
    sky,
    islands: ISLANDS,
    getHeightAt: terrainHeight,
    seaLevel: SEA_LEVEL,
    size: TERRAIN_SIZE,
    /** Resolves when the downloaded ground textures are in. Nothing waits on it. */
    ready: groundReady,

    // --- graphics settings, all live --------------------------------------
    /** Shadow map size in texels, or 0 for none. */
    setShadows(size) {
      // Turning the sun's shadow on or off changes the light hash, and three
      // recompiles what it has to on its own.
      sun.castShadow = size > 0;
      if (size > 0 && sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        // The map is allocated at the old size on first use; drop it and the
        // next shadow pass allocates one at the new size.
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    },
    setTerrainDetail(name) {
      detail.setDetail(name);
      setGroundLowQuality(groundMat, name === "low");
    },
    setTrees({ near, far }) { flora.setLod(near, far); },
    setGrass(on) { flora.setGrass(on); },
    setReflectionEvery(n) { ocean.setReflectionEvery(n); },
    /** Terrain shadows, sky occlusion, height haze, and the terrain's own extras. */
    setPhotoreal(on) {
      photoreal?.setEnabled(on);
      if (scene.fog && "height" in scene.fog) scene.fog.height = on ? 380 : 0;
      if (on) { photoreal?.update(sunDir); sweepPhotoreal(scene); }
    },
    photoreal,
    toggleGrid() { grid.visible = !grid.visible; return grid.visible; },
    toggleWireframe() {
      groundMat.wireframe = !groundMat.wireframe;
      return groundMat.wireframe;
    },
    toggleClouds() {
      this._cloudsHidden = !this._cloudsHidden;
      sky.setWeather(this._cloudsHidden ? "clear" : "fair", { transition: 0 });
      return !this._cloudsHidden;
    },
    toggleWater() { water.visible = !water.visible; return water.visible; },
    toggleTrees() {
      const v = !flora.enabled;
      flora.setEnabled(v);
      return v;
    },
    toggleSpray() {
      surfSpray.mesh.visible = !surfSpray.mesh.visible;
      return surfSpray.mesh.visible;
    },

    /** Debug console: put the sun at an elevation, in degrees. */
    setSun(elevationDeg) { return sky.debugSun(elevationDeg); },

    update(focus, dt = 0.016) {
      if (focus) {
        sun.target.position.copy(focus);
        sun.position.copy(focus).addScaledVector(sunDir, 500);
      }

      // Ground wetness follows the rain, drying slower than it soaks.
      const rainNow = sky.state?.rain ?? 0;
      const wu = groundMat.userData.uniforms.uWet;
      wu.value += (rainNow - wu.value) * Math.min(1, dt * (rainNow > wu.value ? 0.25 : 0.04));
      if (photoreal?.enabled) {
        photoreal.update(sunDir);
        // Things arrive after the switch — the dragon's model, a camp built
        // for a chapter — so look again now and then.
        sweepT += dt;
        if (sweepT > 3) { sweepT = 0; sweepPhotoreal(scene); }
      }
      detail.update(focus, dt);
      ocean.update(focus, dt);
      surfSpray.update(focus, dt);
      flora.update(focus, dt);
    },
  };
}
