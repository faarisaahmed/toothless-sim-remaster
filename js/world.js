import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import {
  terrainHeight, ISLANDS, TERRAIN_SIZE, SEA_LEVEL,
  WIND_BEARING, fertility, islandAt, fbm, noise2,
} from "./terrain.js";
import { loadGround, makeTerrainMaterial } from "./terrainmat.js";
import { bakeSeaField } from "./sea_field.js";
import { createOcean } from "./ocean.js";
import { createSurf } from "./surf.js";
import { createFlora } from "./flora.js";

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

const SUN_ELEVATION = 24;  // late afternoon — noon is the flattest light there is,
                           // and this is a game about weather and long water
const SUN_AZIMUTH   = 150;

const CLOUD_COUNT   = 105;
const CLOUD_DRIFT   = 2.4;      // m/s, downwind

const GRID_SPACING = 200;
const GRID_STEP    = 25;
const GRID_LIFT    = 1.5;

const clamp = THREE.MathUtils.clamp;
const smoothstep = THREE.MathUtils.smoothstep;

// ---------------------------------------------------------------------------
function makeCloudTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  for (let i = 0; i < 48; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.pow(Math.random(), 0.6) * size * 0.32;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d * 0.55;
    const r = size * (0.08 + Math.random() * 0.16);

    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.22)");
    g.addColorStop(0.5, "rgba(255,255,255,0.09)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
    shadowMap: 2048, clouds: CLOUD_COUNT, reflectEvery: 1,
    treeNear: undefined, treeFar: undefined, grass: false,
    ...quality,
  };
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION),
    THREE.MathUtils.degToRad(SUN_AZIMUTH)
  );

  // --- Physical sky ---
  const sky = new Sky();
  sky.scale.setScalar(40000);   // has to enclose a 16 km ocean disc

  const u = sky.material.uniforms;
  // Clear air and strong Rayleigh scattering — a deep summer blue rather than
  // the pale, hazy sky that reads as winter.
  // Turbidity is the haze knob and it was the thing washing the whole picture
  // out: at 2.2 the twenty degrees of sky above the horizon — which is all you
  // ever see from a dragon — came out pure white, and everything reflecting it
  // came out grey. Clean air and hard Rayleigh instead.
  u.turbidity.value       = 1.1;
  u.rayleigh.value        = 3.4;
  u.mieCoefficient.value  = 0.0022;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);

  scene.add(sky);

  // Prefilter the sky into an environment map. This is what gives the ocean
  // real sky reflections and lifts the ambient response on everything else.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  let envRT = null;
  let envElevation = -999;

  function rebuildEnvironment() {
    if (envRT) envRT.texture.dispose();
    scene.remove(sky);
    skyScene.add(sky);
    envRT = pmrem.fromScene(skyScene, 0, 1, 120000);
    skyScene.remove(sky);
    scene.add(sky);
    scene.environment = envRT.texture;
  }
  rebuildEnvironment();

  scene.fog = new THREE.FogExp2(0x8fb2cf, 0.000036);

  // --- Lighting ---
  // scene.environment already supplies the full sky ambient, so the direct
  // lights only need to add the sun's key and a touch of ground bounce.
  // Stacking a bright sun + hemisphere on top of IBL is what blew this out.
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.copy(sunDir).multiplyScalar(500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
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

  // Dark basalt cliffs under mossy green tops — the North Sea look, not chalk.
  const seabed    = new THREE.Color(0x0e2422);
  const shallow   = new THREE.Color(0x3f8578);
  const sandCol   = new THREE.Color(0xb9a887);
  const grassCool = new THREE.Color(0x3a6b28);
  const grassWarm = new THREE.Color(0x6d8434);
  const darkMoss  = new THREE.Color(0x24421d);
  const rockLight = new THREE.Color(0x736a5c);
  const rockDark  = new THREE.Color(0x3b372f);
  const snowCol   = new THREE.Color(0xdfe8ec);
  const c = new THREE.Color();
  const rockTone = new THREE.Color();
  const grass = new THREE.Color();

  const quad = TERRAIN_SIZE / TERRAIN_SEGMENTS;

  for (let i = 0; i < pos.count; i++) {
    const row = Math.floor(i / verts);
    const col = i % verts;
    const h = heights[i];
    const x = pos.getX(i);
    const z = pos.getZ(i);

    const hL = heights[i - (col > 0 ? 1 : 0)];
    const hR = heights[i + (col < verts - 1 ? 1 : 0)];
    const hU = heights[i - (row > 0 ? verts : 0)];
    const hD = heights[i + (row < verts - 1 ? verts : 0)];
    const slope = Math.min(1, Math.hypot(hR - hL, hD - hU) / (quad * 2.2));

    // Cheap ambient occlusion: sit lower than your neighbours and you're in a
    // crevice, so you get less sky. This is what gives the cliffs depth.
    const curvature = h - (hL + hR + hU + hD) / 4;
    const ao = clamp(1 + (curvature / (quad * 1.5)) * 0.45, 0.62, 1.12);

    let veg = 0, sand = 0, snow = 0;

    if (h < SEA_LEVEL - 1.5) {
      // Under water the terrain is only ever seen through the sea, and the sea
      // now goes translucent in the last three metres, so the shallows have to
      // be a colour worth seeing: pale bar, then green, then nothing.
      c.copy(sandCol).lerp(shallow, smoothstep(-h, 1, 11));
      c.lerp(seabed, smoothstep(-h, 8, 85));
      sand = 1 - smoothstep(-h, 1, 9);
    } else {
      const isl = islandAt(x, z);
      const bare = isl ? isl.bare : 0.45;
      const snowLine = 320 - (isl ? isl.snow : 0);

      veg = fertility(x, z, h, slope);

      // Beach: the last few metres above the water, and only where it is not
      // standing on end. A wave-cut bench of bare rock is not a beach.
      sand = (1 - smoothstep(h, 2.5, 9)) * (1 - smoothstep(slope, 0.16, 0.42))
           * (0.35 + 0.65 * (1 - bare));

      snow = smoothstep(h, snowLine, snowLine + 130) * (1 - smoothstep(slope, 0.30, 0.72));

      // Large-scale patchiness so the greens aren't one flat wash.
      const patch = fbm(x * 0.0011, z * 0.0011, 3) * 0.5 + 0.5;
      grass.copy(grassCool).lerp(grassWarm, patch);

      // Horizontal strata on exposed rock, following the terracing that the
      // height field already cut, so the banding lands on the steps rather than
      // across them.
      const band = Math.sin(h * 0.36 + fbm(x * 0.004, z * 0.004, 2) * 2.4) * 0.5 + 0.5;
      rockTone.copy(rockDark).lerp(rockLight, band * 0.75 + 0.12);

      c.copy(rockTone);
      c.lerp(grass, veg * 0.92);
      c.lerp(darkMoss, smoothstep(veg, 0.45, 0.95) * (0.35 + patch * 0.4));
      c.lerp(sandCol, sand);
      // Steep ground is rock whatever grew near it.
      c.lerp(rockTone, smoothstep(slope, 0.26, 0.62) * (1 - snow * 0.6));
      c.lerp(snowCol, snow);
    }

    surf[i * 3] = veg;
    surf[i * 3 + 1] = sand;
    surf[i * 3 + 2] = snow;

    const tint = ao * (1 + noise2(x * 0.02, z * 0.02) * 0.06);
    colors[i * 3]     = c.r * tint;
    colors[i * 3 + 1] = c.g * tint;
    colors[i * 3 + 2] = c.b * tint;
  }

  mark("colours");

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aSurf", new THREE.BufferAttribute(surf, 3));
  // Normals are computed ONCE, across the whole grid, before it is cut up. Doing
  // it per tile afterwards would give each tile its own idea of the normal along
  // its edge, and a lighting seam on every tile boundary — sixteen straight
  // lines across the archipelago, visible from the air, impossible to unsee.
  geo.computeVertexNormals();

  const groundMat = makeTerrainMaterial({}, SEA_LEVEL);

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

  // The photographs are the one thing here that has to come off the network, so
  // the terrain is built with flat stand-ins and they are swapped in when they
  // land. Nothing recompiles: the uniforms already point at a 1x1 texture of the
  // same type, and only the value changes.
  const groundReady = loadGround().then((tex) => {
    const u2 = groundMat.userData.uniforms;
    const set = (key, slot, prop) => {
      const t = slot && slot[prop];
      if (t) u2[key].value = t;
    };
    set("tRockD", tex.rock, "map");     set("tRockN", tex.rock, "normal");
    set("tRockA", tex.rock, "arm");
    set("tScreeD", tex.scree, "map");   set("tScreeN", tex.scree, "normal");
    set("tGrassD", tex.grass, "map");   set("tGrassN", tex.grass, "normal");
    set("tForestD", tex.forest, "map"); set("tForestN", tex.forest, "normal");
    set("tSandD", tex.sand, "map");     set("tSandN", tex.sand, "normal");
    set("tSnowD", tex.snow, "map");     set("tSnowN", tex.snow, "normal");
    groundMat.needsUpdate = false;      // uniform values only — no relink needed
    const have = Object.entries(tex).filter(([, t]) => t && t.map).map(([k]) => k);
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
  const flora = createFlora(scene, {
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

  // --- Clouds ---
  // Two decks. The low one is what he flies through and it drifts fast; the
  // high one barely moves and is mostly there so the sky is not empty above the
  // altitude where the low deck has gone past.
  const cloudTex = makeCloudTexture();
  const clouds = [];
  // One parent for all of them. Cloud sprites are big, transparent and
  // overlapping, which makes them the most fill-rate-hungry thing in the frame
  // per unit of visual interest — and in a 512-pixel reflection they are a
  // white smear. Grouping them is what lets the water skip the lot.
  const cloudGroup = new THREE.Group();
  cloudGroup.name = "clouds";
  scene.add(cloudGroup);
  const windX = Math.sin(WIND_BEARING), windZ = Math.cos(WIND_BEARING);

  const cloudCount = q.clouds;
  for (let i = 0; i < cloudCount; i++) {
    const high = i > cloudCount * 0.62;
    const mat = new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      opacity: high ? 0.13 + Math.random() * 0.12 : 0.20 + Math.random() * 0.24,
      fog: true,
    });
    const cloud = new THREE.Sprite(mat);

    const a = Math.random() * Math.PI * 2;
    const r = 700 + Math.random() * 6000;
    // The low deck used to sit at 460 m with sprites a kilometre across, which
    // meant a single one of them filled the screen with white the moment he
    // climbed off a ridge. Cloud base goes at 900: high enough to fly under all
    // day, low enough to fly INTO on purpose.
    cloud.position.set(
      Math.cos(a) * r,
      high ? 2300 + Math.random() * 1500 : 900 + Math.random() * 700,
      Math.sin(a) * r
    );
    const s = (high ? 1000 : 420) + Math.random() * (high ? 1400 : 700);
    cloud.scale.set(s, s * (0.32 + Math.random() * 0.26), 1);
    cloud.userData.drift = high ? 0.35 : 1;

    cloudGroup.add(cloud);
    clouds.push(cloud);
  }

  // --- Renderer setup that has to match the sky's dynamic range ---
  if (renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.60;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  // One line in the console saying what this actually is, because "the trees
  // did not load" and "the trees loaded and you are too high to see them" look
  // identical from the cockpit.
  mark("clouds");
  console.info(`world: build ${marks.join(", ")}`);
  console.info(
    `world: ${ISLANDS.length} islands (${ISLANDS.filter((i) => i.name).length} named), ` +
    `${flora.treeCount} trees over ${flora.tileCount} tiles, ${flora.boulderCount} boulders, ` +
    `${surfSpray.siteCount} surf sites, ${groundTiles.length} terrain tiles, ` +
    `${clouds.length} clouds, shadows ${q.shadowMap}, grass ${flora.hasGrass ? "on" : "off"}`);

  // -------------------------------------------------------------------------
  // What the sea is allowed to see.
  //
  // The reflection is 512 pixels across, mirrored, and then torn up by a
  // four-layer scrolling normal map before anyone looks at it. What survives
  // that is the sky, the shape of the land and the dragon. Everything else in
  // this list was being drawn a second time every frame to contribute less than
  // a pixel of blur, and the trees alone are ~30 instanced draw calls.
  // -------------------------------------------------------------------------
  ocean.excludeFromReflection(flora.root, cloudGroup, surfSpray.mesh, grid);
  ocean.setReflectionEvery(q.reflectEvery);

  const water = ocean.mesh;

  return {
    /** So main.js can add the compound and the stack once they have loaded. */
    excludeFromReflection: (...o) => ocean.excludeFromReflection(...o),
    groundTiles,
    clouds,
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

    toggleGrid() { grid.visible = !grid.visible; return grid.visible; },
    toggleWireframe() {
      groundMat.wireframe = !groundMat.wireframe;
      return groundMat.wireframe;
    },
    toggleClouds() {
      const v = !clouds[0].visible;
      for (const cl of clouds) cl.visible = v;
      return v;
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

    setSun(elevationDeg, azimuthDeg = SUN_AZIMUTH) {
      sunDir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - elevationDeg),
        THREE.MathUtils.degToRad(azimuthDeg)
      );
      sky.material.uniforms.sunPosition.value.copy(sunDir);
      sun.position.copy(sunDir).multiplyScalar(500);
      ocean.setSun(sunDir);
      // The night transition in main.js drives this once per frame for about
      // three seconds. A PMREM prefilter is six render passes and a mip chain;
      // doing it 180 times to walk the sun down 62 degrees is the difference
      // between a fade and a freeze. The uniforms above are cheap and exact, so
      // only the prefiltered reflection is rate-limited, and two degrees of sun
      // is not visible in a blurred environment map.
      if (Math.abs(elevationDeg - envElevation) > 2) {
        envElevation = elevationDeg;
        rebuildEnvironment();
      }
    },

    update(focus, dt = 0.016) {
      if (focus) {
        sun.target.position.copy(focus);
        sun.position.copy(focus).addScaledVector(sunDir, 500);
      }

      ocean.update(focus, dt);
      surfSpray.update(focus, dt);
      flora.update(focus, dt);

      for (const cloud of clouds) {
        const d = CLOUD_DRIFT * dt * cloud.userData.drift;
        cloud.position.x += windX * d;
        cloud.position.z += windZ * d;
        // Wrap around the player rather than around the origin, so he never
        // flies out from under the weather.
        if (focus) {
          const dx = cloud.position.x - focus.x, dz = cloud.position.z - focus.z;
          if (Math.hypot(dx, dz) > 7000) {
            cloud.position.x = focus.x - dx * 0.92;
            cloud.position.z = focus.z - dz * 0.92;
          }
        }
      }
    },
  };
}
