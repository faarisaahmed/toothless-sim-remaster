import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------------------------------------------------------------------------
// One post stack, shared by every scene in the game.
//
// Two effects, both chosen because the art is procedural and untextured and
// needs the help:
//
//   Bloom     Every light source in this game is a small bright thing in a dark
//             place — a hearth, an ember, a brazier on a rig, a placeholder orb,
//             a plasma blast. Untouched, those read as flat white circles.
//             Bloom is what makes them read as *emitting*.
//
//   Grade     A vignette and a very slight grain, plus a lift/gain that pulls
//             the shadows cool and the highlights warm. This is the single
//             cheapest thing that stops a room lit by one orange fire looking
//             like brown soup, because it puts blue in the corners for free.
//
// Deliberately not here: SSAO (too slow for what it buys on faceted geometry),
// depth of field (this is a flying game, you need to see), motion blur.
// ---------------------------------------------------------------------------

/** Vignette + grain + a split-tone lift. One pass, no textures. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime:    { value: 0 },
    uVignette:{ value: 1.0 },   // 0 off, 1 normal
    uGrain:   { value: 0.018 },
    uCool:    { value: new THREE.Color(0x2a3a52) },  // pushed into shadow
    uWarm:    { value: new THREE.Color(0x2a1a08) },  // pushed into highlight
    uMix:     { value: 1.0 },
    // White balance and saturation, set by the sky for the time of day: a
    // northern day is a cold, slightly muted one.
    uWhite:   { value: new THREE.Vector3(1, 1, 1) },
    uSat:     { value: 1.0 },
    // The sun as the lens sees it: where it is on screen, how much of it is
    // showing, and its colour. Drives a glare and a few faint ghosts.
    uSunUv:   { value: new THREE.Vector2(0.5, 0.5) },
    uSunGlare:{ value: new THREE.Vector3(0, 0, 0) },
    uAspect:  { value: 1.6 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uMix;
    uniform vec3 uCool, uWarm;
    uniform vec3 uWhite;
    uniform float uSat;
    uniform vec2 uSunUv;
    uniform vec3 uSunGlare;
    uniform float uAspect;
    varying vec2 vUv;

    // Cheap hash grain. Deterministic per pixel per frame, no texture fetch.
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // The sun in the lens: a soft glare round it, a six-point starburst
      // from the aperture, and a few dim ghosts strung back through the
      // middle of the frame. All of it scaled by how much sun is showing, so
      // a ridge or a cloud across the disc puts it out.
      if (uSunGlare.x + uSunGlare.y + uSunGlare.z > 0.0001) {
        vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
        float r = length(d);
        float a = atan(d.y, d.x);
        float glare = exp(-r * 5.5) * 0.10 + exp(-r * 22.0) * 0.28;
        float burst = pow(abs(cos(a * 3.0 + 0.4)), 90.0) * exp(-r * 4.0) * 0.16
                    + pow(abs(cos(a * 3.0 + 1.45)), 140.0) * exp(-r * 6.0) * 0.08;
        vec3 add = uSunGlare * (glare + burst);
        vec2 axis = vec2(0.5) - uSunUv;
        for (int i = 0; i < 4; i++) {
          float k = float(i) * 0.45 + 0.55;
          vec2 gp = (vUv - (uSunUv + axis * k * 2.0)) * vec2(uAspect, 1.0);
          float rad = 0.03 + float(i) * 0.025;
          float ghost = smoothstep(rad, rad * 0.6, length(gp)) * 0.018;
          add += uSunGlare * ghost * vec3(0.7 + 0.3 * float(i == 1), 0.85, 1.0 - 0.2 * float(i == 2));
        }
        c.rgb += add;
      }

      // White balance, then saturation about luminance.
      c.rgb *= uWhite;
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(vec3(0.0), mix(vec3(lum), c.rgb, uSat));

      // Split tone: luminance decides how much cool vs warm gets added. Adding
      // rather than mixing keeps it out of the way of saturated colour.
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = mix(uCool, uWarm, smoothstep(0.15, 0.75, l));
      c.rgb += tint * uMix * (0.34 - 0.22 * l);

      // Vignette, elliptical so it suits a wide frame.
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      float v = smoothstep(0.78, 0.24, length(d));
      c.rgb *= mix(1.0, 0.42 + 0.58 * v, uVignette);

      // Grain, scaled down in the highlights where it would look like noise
      // rather than film.
      float g = hash(vUv * 900.0 + fract(uTime) * 91.7) - 0.5;
      c.rgb += g * uGrain * (0.35 + 0.65 * smoothstep(0.0, 0.35, l));

      gl_FragColor = c;
    }
  `,
};

/**
 * Sun shafts. The bright part of the frame — the sun, its aureole, the lit
 * edges of cloud — smeared outward along lines from the sun's position on
 * screen, so that anything dark in front of it (a ridge, a sea stack, the
 * edge of a cloud) cuts shadows into the light. The old GPU Gems trick, in
 * HDR before tone mapping, which is what lets it key on the sun alone: the
 * sky is a few units bright and the sun is ninety.
 */
export const SunShaftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uThreshold: { value: 5.0 },
    uTint: { value: new THREE.Color(1, 0.95, 0.85) },
    uAspect: { value: 1.6 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uStrength, uThreshold, uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.0) { gl_FragColor = base; return; }
      const int N = 36;
      vec2 delta = (vUv - uSun) * (0.92 / float(N));
      // Jitter the start so the steps do not band; the grain hides the noise.
      vec2 p = vUv - delta * hash(vUv * 811.0);
      float decay = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < N; i++) {
        p -= delta;
        vec3 sc = texture2D(tDiffuse, clamp(p, 0.001, 0.999)).rgb;
        float l = dot(sc, vec3(0.2126, 0.7152, 0.0722));
        acc += min(vec3(8.0), sc * max(0.0, l - uThreshold) / max(l, 1e-3)) * decay;
        decay *= 0.955;
      }
      acc /= float(N);
      float r = length((vUv - uSun) * vec2(uAspect, 1.0));
      gl_FragColor = vec4(base.rgb + acc * uTint * uStrength * exp(-r * 1.3), base.a);
    }
  `,
};

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {object} [opts]
 *   bloom     {strength, radius, threshold}
 *   vignette  0..1
 *   grain     0..1
 *   tint      {cool, warm, mix}
 */
export function setupPost(renderer, scene, camera, opts = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  // Depth on both ping-pong targets, so a pass after the scene can read how
  // far away each pixel is. The clouds need it to stop at the terrain.
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
    rt.depthTexture.type = THREE.UnsignedIntType;
  }
  composer.addPass(new RenderPass(scene, camera));

  // The resolution the composer treats as 1.0. Render scale is applied on top
  // of this, so the governor can never push past what the display asked for.
  let basePixelRatio = opts.basePixelRatio ?? renderer.getPixelRatio();

  // `bloom: false` drops the pass entirely rather than setting its strength to
  // zero. UnrealBloomPass is a five-target mip chain and it costs the same to
  // run whether or not anything in the frame is bright enough to survive it.
  const b = opts.bloom === false ? null : (opts.bloom || {});
  const bloom = b && new UnrealBloomPass(
    size,
    b.strength ?? 0.55,
    b.radius ?? 0.5,
    // Threshold is the important dial. Too low and the whole image glows and
    // everything goes milky; this wants to catch fire and orbs and nothing else.
    b.threshold ?? 0.72
  );
  if (bloom) composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  if (opts.vignette !== undefined) grade.uniforms.uVignette.value = opts.vignette;
  if (opts.grain !== undefined) grade.uniforms.uGrain.value = opts.grain;
  if (opts.tint) {
    if (opts.tint.cool) grade.uniforms.uCool.value.set(opts.tint.cool);
    if (opts.tint.warm) grade.uniforms.uWarm.value.set(opts.tint.warm);
    if (opts.tint.mix !== undefined) grade.uniforms.uMix.value = opts.tint.mix;
  }
  composer.addPass(grade);

  composer.addPass(new OutputPass());

  let t = 0;
  let scale = 1;
  let cssW = size.width, cssH = size.height;

  // Both the renderer and the composer have to be told, and they mean slightly
  // different things by it: the renderer's pixel ratio sizes the canvas backing
  // store (so the browser scales the finished frame up to the window for free,
  // on the display controller), the composer's sizes every intermediate target.
  // Setting only one of them gets you a sharp composite of a blurry render, or
  // a full-resolution post chain over a quarter-resolution scene.
  function applyScale() {
    const r = basePixelRatio * scale;
    renderer.setPixelRatio(r);
    // updateStyle stays on: the backing store shrinks, the canvas keeps
    // filling the window, and the upscale is free on the display controller.
    renderer.setSize(cssW, cssH);
    if (composer.setPixelRatio) composer.setPixelRatio(r);
    else composer.setSize(cssW, cssH);
  }

  return {
    composer,
    bloom,
    grade,
    get scale() { return scale; },
    /** Call instead of renderer.render(). */
    render(dt = 0.016) {
      t += dt;
      grade.uniforms.uTime.value = t;
      composer.render();
    },
    /** 0..1 of native. The frame-rate governor owns this. */
    setScale(s) {
      if (Math.abs(s - scale) < 1e-3) return;
      scale = s;
      applyScale();
    },
    /** The resolution that counts as 1.0 — the graphics menu's pixel-ratio cap. */
    setBasePixelRatio(r) {
      if (Math.abs(r - basePixelRatio) < 1e-3) return;
      basePixelRatio = r;
      applyScale();
    },
    /** Bloom costs a five-target mip chain whether or not anything is bright. */
    setBloom(on) { if (bloom) bloom.enabled = !!on; },
    setSize(w, h) {
      cssW = w; cssH = h;
      applyScale();
      // Note: composer.setSize() already forwards the *effective* (post pixel
      // ratio) size to every pass, so bloom must NOT be resized again here with
      // CSS pixels — doing that is what silently drops it to 1/dpr resolution.
    },
    dispose() {
      composer.renderTarget1?.dispose();
      composer.renderTarget2?.dispose();
    },
  };
}
