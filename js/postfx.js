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
    varying vec2 vUv;

    // Cheap hash grain. Deterministic per pixel per frame, no texture fetch.
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

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
  composer.addPass(new RenderPass(scene, camera));

  // The resolution the composer treats as 1.0. Render scale is applied on top
  // of this, so the governor can never push past what the display asked for.
  const basePixelRatio = opts.basePixelRatio ?? renderer.getPixelRatio();

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
