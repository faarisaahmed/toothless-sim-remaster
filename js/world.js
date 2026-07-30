import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { Water } from "three/addons/objects/Water.js";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
export const TERRAIN_SIZE = 10000;
const TERRAIN_SEGMENTS = 480;   // ~21 world units per quad
export const SEA_LEVEL = 0;
const SEA_FLOOR        = -190;

const SUN_ELEVATION = 48;  // high summer sun
const SUN_AZIMUTH   = 150;

const CLOUD_COUNT   = 90;
const CLOUD_DRIFT   = 0.12;

const GRID_SPACING = 200;
const GRID_STEP    = 25;
const GRID_LIFT    = 1.5;

// The archipelago. `cliff` is the width of the sheer rim band as a fraction of
// the radius — smaller means a more vertical sea cliff. Anything with a tiny
// radius and a low cliff value comes out as a Berk-style sea stack.
export const ISLANDS = [
  { name: "Berk",        x:     0, z: -1100, r: 1150, h: 520, cliff: 0.30 },
  { name: "Dragon Peak", x: -2900, z: -2000, r:  780, h: 900, cliff: 0.20 },
  { name: "Raven Point", x:  2700, z:   500, r:  860, h: 760, cliff: 0.24 },
  { name: "Outcast Isle",x: -2500, z:  1500, r:  960, h: 430, cliff: 0.38 },
  { name: "Changewing",  x:  1300, z:  3100, r:  720, h: 610, cliff: 0.22 },
  { name: "Itchy Armpit",x:  3500, z: -2500, r:  640, h: 470, cliff: 0.34 },
  { name: "Gronckle I.", x:  -900, z:  3500, r:  560, h: 350, cliff: 0.42 },
  { name: "Fireworm",    x:  4300, z:  2700, r:  680, h: 540, cliff: 0.28 },

  // Sea stacks — narrow spires to thread between.
  { x:  1000, z:   400, r: 150, h: 360, cliff: 0.12 },
  { x:  -750, z:   950, r: 120, h: 300, cliff: 0.10 },
  { x:  1900, z: -1600, r: 170, h: 420, cliff: 0.14 },
  { x: -1600, z:  -400, r: 110, h: 260, cliff: 0.10 },
  { x:  2200, z:  2000, r: 140, h: 330, cliff: 0.12 },
  { x:  -300, z:  1800, r: 130, h: 290, cliff: 0.11 },
  { x:  3100, z:  -600, r: 160, h: 380, cliff: 0.13 },
];

// ---------------------------------------------------------------------------
// Height field
// ---------------------------------------------------------------------------
const perlin = new ImprovedNoise();

function fbm(x, z, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum  += amp * perlin.noise(x * freq, z * freq, 0);
    norm += amp;
    amp  *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Ridged multifractal. Folding the noise at zero (1 - |n|) turns fBm's rounded
// hills into sharp crests with V-cut gullies between them — this is what makes
// rock read as rock instead of as smooth dunes. Returns 0..1.
function ridged(x, z, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlin.noise(x * freq, z * freq, 0));
    sum  += amp * n * n;
    norm += amp;
    amp  *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Single source of truth — builds the mesh AND answers runtime queries.
export function terrainHeight(x, z) {
  // Domain warp, so coastlines wander instead of reading as circles.
  const wx = fbm(x * 0.00075, z * 0.00075, 3) * 320;
  const wz = fbm((x + 4200) * 0.00075, (z - 3100) * 0.00075, 3) * 320;
  const px = x + wx;
  const pz = z + wz;

  // Perturbs where the rim falls off, so cliffs grow buttresses and gullies
  // instead of being a smooth surface of revolution.
  const rim = (ridged(x * 0.0055, z * 0.0055, 3) - 0.5) * 0.13;

  // Tallest island wins, so overlapping ones merge into one landmass.
  let land = 0;
  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    const dx = px - isl.x;
    const dz = pz - isl.z;
    const d = Math.sqrt(dx * dx + dz * dz) / isl.r + rim;
    if (d >= 1) continue;
    // Flat-ish plateau out to the rim, then a sheer drop.
    const f = 1 - THREE.MathUtils.smoothstep(d, 1 - isl.cliff, 1);
    const contribution = isl.h * f;
    if (contribution > land) land = contribution;
  }

  // Undulating sea bed under everything.
  let h = SEA_FLOOR + fbm(x * 0.0005, z * 0.0005, 4) * 70;

  if (land > 0) {
    // Ridged relief gives crests and gullies rather than rolling hills.
    const relief = ridged(x * 0.0016, z * 0.0016, 5);
    h += land * (0.32 + 0.78 * relief);

    // Crags. Scaled by how high the land is, so peaks are broken and jagged
    // while the shoreline stays comparatively even.
    const craggy = 0.25 + 0.75 * (land / 600);
    h += (ridged(x * 0.011, z * 0.011, 4) - 0.45) * 34 * craggy;
    h += (ridged(x * 0.034, z * 0.034, 3) - 0.45) * 9 * craggy;
  }

  return h;
}

// ---------------------------------------------------------------------------
// Procedural textures
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

// Swell built from integer-frequency sines, so the texture tiles seamlessly
// however far we repeat it across the ocean.
function makeWaterNormals() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);

  const wave = (ix, iy) => {
    const u = (ix / size) * Math.PI * 2;
    const v = (iy / size) * Math.PI * 2;
    return Math.sin(u * 3 + Math.sin(v * 2) * 0.8) * 0.5
         + Math.sin(v * 5 - Math.sin(u * 3) * 0.6) * 0.3
         + Math.sin((u + v) * 7) * 0.15;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = wave(x + 1, y) - wave(x - 1, y);
      const dy = wave(x, y + 1) - wave(x, y - 1);
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;

      const i = (y * size + x) * 4;
      img.data[i]     = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex; // Water drives its own tiling through the `size` uniform
}


// ---------------------------------------------------------------------------
export function setupWorld(scene, renderer) {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION),
    THREE.MathUtils.degToRad(SUN_AZIMUTH)
  );

  // --- Physical sky ---
  const sky = new Sky();
  sky.scale.setScalar(20000);

  const u = sky.material.uniforms;
  // Clear air and strong Rayleigh scattering — a deep summer blue rather than
  // the pale, hazy sky that reads as winter.
  u.turbidity.value       = 2.2;
  u.rayleigh.value        = 2.5;
  u.mieCoefficient.value  = 0.003;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDir);

  scene.add(sky);

  // Prefilter the sky into an environment map. This is what gives the ocean
  // real sky reflections and lifts the ambient response on everything else.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  let envRT = null;

  function rebuildEnvironment() {
    if (envRT) envRT.texture.dispose();
    scene.remove(sky);
    skyScene.add(sky);
    envRT = pmrem.fromScene(skyScene, 0, 1, 60000);
    skyScene.remove(sky);
    scene.add(sky);
    scene.environment = envRT.texture;
  }
  rebuildEnvironment();

  scene.fog = new THREE.FogExp2(0x8fb4d4, 0.00007);

  // --- Lighting ---
  // scene.environment already supplies the full sky ambient, so the direct
  // lights only need to add the sun's key and a touch of ground bounce.
  // Stacking a bright sun + hemisphere on top of IBL is what blew this out.
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.copy(sunDir).multiplyScalar(500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
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

  // --- Terrain ---
  const geo = new THREE.PlaneGeometry(
    TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS
  );
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const verts = TERRAIN_SEGMENTS + 1;
  const colors = new Float32Array(pos.count * 3);

  // Height once per vertex, then slope from grid neighbours — three times
  // cheaper than re-evaluating the noise for finite differences.
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = terrainHeight(pos.getX(i), pos.getZ(i));
    heights[i] = h;
    pos.setY(i, h);
  }

  // Dark basalt cliffs under mossy green tops — the North Sea look, not chalk.
  const seabed    = new THREE.Color(0x142b28);
  const shallow   = new THREE.Color(0x4d8b7e);
  const sand      = new THREE.Color(0xb8a47c);
  const grassCool = new THREE.Color(0x3a6b28);
  const grassWarm = new THREE.Color(0x6b8232);
  const darkMoss  = new THREE.Color(0x264a20);
  const rockLight = new THREE.Color(0x5e564a);
  const rockDark  = new THREE.Color(0x2e2b26);
  const snow      = new THREE.Color(0xdde6ea);
  const c = new THREE.Color();
  const rockTone = new THREE.Color();

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
    const ao = THREE.MathUtils.clamp(1 + (curvature / (quad * 1.5)) * 0.45, 0.62, 1.12);

    if (h < SEA_LEVEL - 2) {
      c.copy(shallow).lerp(sand, THREE.MathUtils.smoothstep(-h, 0, 10));
      c.lerp(seabed, THREE.MathUtils.smoothstep(-h, 6, 90));
    } else {
      const alt = h / 700;

      // Large-scale patchiness so the greens aren't one flat wash.
      const patch = fbm(x * 0.0011, z * 0.0011, 3) * 0.5 + 0.5;
      const grass = grassCool.clone().lerp(grassWarm, patch);

      // Horizontal strata on exposed rock.
      const band = Math.sin(h * 0.055 + fbm(x * 0.004, z * 0.004, 2) * 2.2) * 0.5 + 0.5;
      rockTone.copy(rockDark).lerp(rockLight, band);

      c.copy(sand);
      c.lerp(grass, THREE.MathUtils.smoothstep(h, 5, 28));        // beach line
      c.lerp(darkMoss, THREE.MathUtils.smoothstep(alt, 0.12, 0.45) * (0.3 + patch * 0.45));
      c.lerp(rockTone, THREE.MathUtils.smoothstep(slope, 0.26, 0.66));
      // Summer: snow clings only to the highest peaks, and not on steep faces.
      c.lerp(snow, THREE.MathUtils.smoothstep(alt, 0.95, 1.15) * (1 - slope * 0.8));
    }

    const tint = ao * (1 + perlin.noise(x * 0.02, z * 0.02, 5) * 0.07);
    colors[i * 3]     = c.r * tint;
    colors[i * 3 + 1] = c.g * tint;
    colors[i * 3 + 2] = c.b * tint;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // No tiling normal map here on purpose. The terrain's UVs are planar, so any
  // tiled texture stretches to vertical smears on a cliff face — exactly where
  // you most want detail. The relief is carried by geometry instead.
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      envMapIntensity: 0.4, // rock shouldn't mirror the sky back at you
    })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Ocean ---
  // three's Water does a real planar reflection pass plus sun glitter and
  // refraction distortion, which is the difference between "blue plane" and
  // something that reads as sea.
  const waterNormals = makeWaterNormals();
  const water = new Water(
    new THREE.PlaneGeometry(TERRAIN_SIZE * 3, TERRAIN_SIZE * 3),
    {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals,
      sunDirection: sunDir.clone(),
      sunColor: 0xfff1d6,
      waterColor: 0x0a3a4c,
      distortionScale: 5.5,
      fog: true,
    }
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA_LEVEL;
  water.material.uniforms.size.value = 6;
  scene.add(water);

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
  const cloudTex = makeCloudTexture();
  const clouds = [];

  for (let i = 0; i < CLOUD_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.35 + Math.random() * 0.3,
      fog: true,
    });
    const cloud = new THREE.Sprite(mat);

    const a = Math.random() * Math.PI * 2;
    const r = 300 + Math.random() * 4400;
    cloud.position.set(
      Math.cos(a) * r,
      520 + Math.random() * 1100,
      Math.sin(a) * r
    );
    const s = 500 + Math.random() * 850;
    cloud.scale.set(s, s * (0.45 + Math.random() * 0.25), 1);

    scene.add(cloud);
    clouds.push(cloud);
  }

  // --- Renderer setup that has to match the sky's dynamic range ---
  if (renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.62;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  return {
    clouds,
    ground,
    water,
    grid,
    sun,
    hemi,
    sky,
    islands: ISLANDS,
    getHeightAt: terrainHeight,
    seaLevel: SEA_LEVEL,

    toggleGrid() { grid.visible = !grid.visible; return grid.visible; },
    toggleWireframe() {
      ground.material.wireframe = !ground.material.wireframe;
      return ground.material.wireframe;
    },
    toggleClouds() {
      const v = !clouds[0].visible;
      for (const c of clouds) c.visible = v;
      return v;
    },
    toggleWater() { water.visible = !water.visible; return water.visible; },

    setSun(elevationDeg, azimuthDeg = SUN_AZIMUTH) {
      sunDir.setFromSphericalCoords(
        1,
        THREE.MathUtils.degToRad(90 - elevationDeg),
        THREE.MathUtils.degToRad(azimuthDeg)
      );
      sky.material.uniforms.sunPosition.value.copy(sunDir);
      sun.position.copy(sunDir).multiplyScalar(500);
      water.material.uniforms.sunDirection.value.copy(sunDir);
      rebuildEnvironment(); // reflections have to follow the sun
    },

    update(focus, dt = 0.016) {
      if (focus) {
        sun.target.position.copy(focus);
        sun.position.copy(focus).addScaledVector(sunDir, 500);
        water.position.x = focus.x;
        water.position.z = focus.z;
      }

      // Water animates itself off this uniform — it scrolls four noise layers
      // at different rates internally, so there's no visible repeat.
      water.material.uniforms.time.value += dt * 0.55;

      for (const cloud of clouds) {
        cloud.position.x += CLOUD_DRIFT;
        if (cloud.position.x > half) cloud.position.x -= TERRAIN_SIZE;
      }
    },
  };
}
