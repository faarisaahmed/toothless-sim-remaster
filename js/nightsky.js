import * as THREE from "three";

// ---------------------------------------------------------------------------
// The night behind the menu.
//
// The title screen had a sky gradient, a moon and a dark sea, and it read as an
// empty void — the moon was a flat white disc, there was nothing between the
// camera and the horizon, and the heavy vignette over the top crushed what
// little there was. A menu background does one job, which is to say what kind
// of game this is before anybody has pressed anything, and "black" was not
// saying it.
//
// Four things fix it, in order of how much they matter:
//
//   ISLANDS     The archipelago is the game's identity and there was none of it
//               on screen. Three bands of silhouette at different distances,
//               each hazier than the one in front, and suddenly the frame has
//               depth and a place rather than a colour. This is the one that
//               does most of the work.
//
//   STARS       A night sky with no stars reads as an unlit room. Fourteen
//               hundred of them, brightness weighted so a few are much brighter
//               than the rest, faded out near the horizon where the haze would
//               eat them.
//
//   AURORA      One band of cold green high up and off to one side. It is the
//               only saturated colour in the frame, so it does the same job a
//               single warm lamp does in a blue room.
//
//   HAZE        A lift along the horizon line. Distance is a contrast cue
//               before it is anything else, and without this the far islands
//               sit at the same tonal depth as the near ones.
//
// Everything is billboarded flat or built on a sphere and nothing casts a
// shadow, because the camera barely moves — it drifts by about twenty pixels —
// and paying for parallax nobody can see would be paying for nothing.
// ---------------------------------------------------------------------------

/** Deterministic noise, so the skyline is the same one every time. */
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Value noise over one dimension, a few octaves, for the skylines. */
function ridge(x, seed) {
  let v = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    const i = Math.floor(x * freq) + seed * 71;
    const f = x * freq - Math.floor(x * freq);
    const a = hash(i), b = hash(i + 1);
    // Smoothstep between the two, so the skyline has shoulders rather than
    // corners — corners read as low-poly geometry, not as rock.
    const s = f * f * (3 - 2 * f);
    v += (a + (b - a) * s) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.3;
  }
  return v / norm;
}

/**
 * One band of island silhouette: a horizontal strip whose top edge follows the
 * noise above, standing at `dist` from the origin.
 *
 * Built as a triangle strip rather than as geometry-per-island because it is
 * never seen from any other angle. A hundred segments of two triangles is
 * cheaper than one cone and looks considerably more like an island chain.
 */
function skyline({ dist, width, height, base, colour, opacity, seed, gaps, rim }) {
  const SEG = 220;
  const pos = [], idx = [], uvs = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const x = (u - 0.5) * width;
    // `gaps` carves the strip into separate islands instead of one long wall,
    // which is the difference between an archipelago and a coastline.
    const island = Math.max(0, Math.sin(u * Math.PI * gaps + seed) ** 2 - 0.12) / 0.88;
    const h = base + ridge(u * 9, seed) * height * island;
    pos.push(x, base, -dist, x, h, -dist);
    uvs.push(u, 0, u, 1);
    if (i < SEG) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);

  // Darker at the top, hazier at the waterline — the opposite of what a lit
  // object does, and correct for a silhouette against a lighter sky.
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // DoubleSide, and this is not belt-and-braces. The strip is wound
    // bottom-left, top-left, bottom-right, which with x increasing to the
    // right gives a normal along -z — pointing AWAY from the camera. Every
    // triangle was back-face culled, so all three bands were being built,
    // uploaded and drawn to nothing at all. The giveaway was the horizon haze
    // rendering as an unbroken straight line: if any island had been in front
    // of it, it would have had a bite taken out of it.
    side: THREE.DoubleSide,
    uniforms: {
      uColour: { value: new THREE.Color(colour) },
      uOpacity: { value: opacity },
      uRim: { value: rim },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColour; uniform float uOpacity; uniform float uRim;
      varying vec2 vUv;
      void main() {
        // vUv.y is 0 at the waterline and 1 at the ridge. Fade the bottom few
        // percent so the island sits IN the sea rather than on top of it.
        float foot = smoothstep(0.0, 0.10, vUv.y);
        // A cold edge along the ridge. Not decoration: a silhouette whose
        // colour is within a few values of the sky behind it is invisible no
        // matter how big it is, and that is exactly what these were — 0x05080e
        // rock against a 0x070b14 sky. One lit edge is what makes a shape read.
        float rim = smoothstep(0.80, 1.0, vUv.y) * uRim;
        vec3 col = uColour + vec3(0.42, 0.50, 0.68) * rim;
        gl_FragColor = vec4(col, min(1.0, uOpacity * foot + rim * 0.8));
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} moonDir  unit vector at the moon, so the aurora and
 *   the haze can sit away from it rather than fighting it for attention.
 */
export function addNightSky(scene, moonDir) {
  const group = new THREE.Group();
  group.name = "nightsky";

  // --- Stars ---------------------------------------------------------------
  const COUNT = 1400;
  const p = new Float32Array(COUNT * 3);
  const bright = new Float32Array(COUNT);
  const phase = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    // Weighted to the upper hemisphere and away from straight down.
    const a = hash(i * 3.1) * Math.PI * 2;
    const y = 0.04 + hash(i * 7.7) * 0.96;      // sin of elevation
    const r = Math.sqrt(1 - y * y);
    p[i * 3] = Math.cos(a) * r * 3400;
    p[i * 3 + 1] = y * 3400;
    p[i * 3 + 2] = Math.sin(a) * r * 3400;
    // Cubed, so most are faint and a handful are properly bright. A uniform
    // distribution gives you a flat field of identical dots, which reads as
    // noise on the lens rather than as a sky.
    bright[i] = Math.pow(hash(i * 13.3), 3.0);
    phase[i] = hash(i * 19.1) * Math.PI * 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  starGeo.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
    vertexShader: `
      attribute float aBright; attribute float aPhase;
      uniform float uTime; uniform float uPixel;
      varying float vI;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // Twinkle: slow, and different per star, or the whole field pulses
        // together like a string of fairy lights.
        float tw = 0.78 + 0.22 * sin(uTime * 1.4 + aPhase);
        // Faded out near the horizon, where the haze below would swallow them.
        float horizon = smoothstep(0.0, 0.20, normalize(position).y);
        vI = (0.16 + aBright) * tw * horizon;
        gl_PointSize = (1.1 + aBright * 3.4) * uPixel;
      }`,
    fragmentShader: `
      varying float vI;
      void main() {
        // Round, with a soft edge. Square stars are unmistakably square.
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        float a = smoothstep(0.5, 0.06, r);
        gl_FragColor = vec4(vec3(0.85, 0.90, 1.0) * vI, a * vI);
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  group.add(stars);

  // --- Islands -------------------------------------------------------------
  // Three bands. Each further one is lighter and flatter, which is the whole
  // trick: aerial perspective is what says "far", not size.
  const bands = [
    skyline({ dist: 1500, width: 6200, height: 480, base: -30,
              colour: 0x05080e, opacity: 0.99, seed: 3, gaps: 4, rim: 0.55 }),
    skyline({ dist: 2400, width: 8200, height: 360, base: -30,
              colour: 0x0e1626, opacity: 0.92, seed: 11, gaps: 6, rim: 0.34 }),
    skyline({ dist: 3400, width: 10500, height: 250, base: -30,
              colour: 0x1a2440, opacity: 0.70, seed: 23, gaps: 9, rim: 0.18 }),
  ];
  for (const b of bands) group.add(b);

  // --- Aurora --------------------------------------------------------------
  // High, cold, and on the opposite side of the frame from the moon, so the two
  // bright things are not competing for the same corner.
  const auroraMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      // Three drifting sine ribbons, multiplied by a vertical falloff. Cheaper
      // than noise and, for something this soft and this far away, no worse.
      float ribbon(float x, float y, float sp, float w, float o) {
        float c = 0.5 + 0.14 * sin(x * 3.1 + uTime * sp + o)
                      + 0.07 * sin(x * 7.3 - uTime * sp * 0.7 + o);
        return smoothstep(w, 0.0, abs(y - c));
      }
      void main() {
        float a = ribbon(vUv.x, vUv.y, 0.10, 0.20, 0.0) * 0.55
                + ribbon(vUv.x, vUv.y, 0.07, 0.13, 2.1) * 0.40
                + ribbon(vUv.x, vUv.y, 0.13, 0.09, 4.4) * 0.30;
        // Vertical streaking. It was sin(vUv.x * 210.0), which at this size is
        // finer than the pixel grid and aliased into a barcode across the
        // middle of the frame — a moire pattern, not an aurora. Two low
        // frequencies, softened, read as curtains instead.
        a *= 0.68 + 0.32 * (0.5 + 0.5 * sin(vUv.x * 26.0 + uTime * 0.2))
                  * (0.6 + 0.4 * sin(vUv.x * 9.0 - uTime * 0.11));
        // Ends tapered, so the band does not stop at a hard edge.
        a *= smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
        vec3 col = mix(vec3(0.16, 0.62, 0.44), vec3(0.32, 0.44, 0.72), vUv.y);
        // Weak. It is the only saturated thing in the frame and the game's own
        // name has to stay readable over it.
        gl_FragColor = vec4(col * a, a * 0.26);
      }`,
  });
  const aurora = new THREE.Mesh(new THREE.PlaneGeometry(4200, 1300, 1, 1), auroraMat);
  // Opposite side from the moon, and high. The middle of the sky is where it
  // was sitting and the middle of the frame belongs to the title.
  aurora.position.set(-moonDir.x * 3000, 1150, -3200);
  group.add(aurora);

  // --- Horizon haze --------------------------------------------------------
  // A lift along the waterline. Additive and very weak: it is standing in for
  // twenty kilometres of air, and air is not a colour you should be able to
  // point at.
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uWarm: { value: new THREE.Color(0x3d5488) } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uWarm; varying vec2 vUv;
      void main() {
        // A BAND, not a wash. A gradient fading upward from the waterline put
        // its brightest part below the horizon where there is sea in front of
        // it, so it lifted nothing the islands are seen against. A Gaussian
        // centred just above the waterline is moonlit haze over water, and it
        // is the light the silhouettes stand in front of.
        float d = (vUv.y - 0.34) / 0.17;
        float a = exp(-d * d) * 0.95;
        gl_FragColor = vec4(uWarm * a, a);
      }`,
  });
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(13000, 1100, 1, 1), hazeMat);
  // Behind every island band, so all three are seen against it.
  haze.position.set(0, 350, -3900);
  group.add(haze);

  scene.add(group);

  return {
    group,
    /** @param {number} t seconds since the scene opened */
    update(t, pixelRatio = 1) {
      starMat.uniforms.uTime.value = t;
      starMat.uniforms.uPixel.value = pixelRatio;
      auroraMat.uniforms.uTime.value = t;
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    },
  };
}
