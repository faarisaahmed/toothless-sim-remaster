import * as THREE from "three";

// ---------------------------------------------------------------------------
// Placeholder characters
//
// Everyone who isn't Toothless is a ball of light with a question mark in it.
// This is a stated art rule rather than a stopgap (STORY.md §11, "Placeholder
// art rule"), so it gets built properly: a soft core, a fresnel shell that
// actually reads as volume, a real light so the orb lights the room it's in,
// and a crisp billboarded glyph.
//
// The acting happens through four dials — scale, colour, bob and pulse. That's
// enough to play warm/cold, calm/agitated, present/absent, which covers every
// character beat in the buildable cut.
// ---------------------------------------------------------------------------

const GLYPH_PX = 512;   // generous; the glyph is often close to camera

// One canvas texture shared by every orb. Drawn once, on first use.
let glyphTexture = null;

function makeGlyphTexture() {
  if (glyphTexture) return glyphTexture;

  const c = document.createElement("canvas");
  c.width = c.height = GLYPH_PX;
  const g = c.getContext("2d");

  g.clearRect(0, 0, GLYPH_PX, GLYPH_PX);
  g.translate(GLYPH_PX / 2, GLYPH_PX / 2);

  // Drawn white; the material tints it. Two passes — a wide soft bloom under a
  // hard core — so it survives additive blending without turning into mush.
  g.textAlign = "center";
  g.textBaseline = "middle";

  g.font = `700 ${GLYPH_PX * 0.62}px Cinzel, Georgia, serif`;
  g.shadowColor = "rgba(255,255,255,0.85)";
  g.shadowBlur = GLYPH_PX * 0.09;
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillText("?", 0, GLYPH_PX * 0.02);

  g.shadowBlur = 0;
  g.fillStyle = "rgba(255,255,255,1)";
  g.fillText("?", 0, GLYPH_PX * 0.02);

  glyphTexture = new THREE.CanvasTexture(c);
  glyphTexture.colorSpace = THREE.SRGBColorSpace;
  glyphTexture.anisotropy = 4;
  glyphTexture.needsUpdate = true;
  return glyphTexture;
}

// Fresnel shell. Transparent facing the camera, bright at the silhouette —
// which is what stops it looking like a billiard ball with a lamp inside.
const SHELL_VERT = /* glsl */`
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SHELL_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uIntensity;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    float f = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewW)));
    f = pow(clamp(f, 0.0, 1.0), uPower);
    gl_FragColor = vec4(uColor * f * uIntensity, f);
  }
`;

/**
 * @param {object} opts
 *   color       THREE.Color-ish. Warm means well-meaning, cold means it doesn't.
 *   radius      world units
 *   intensity   light intensity
 *   glyph       show the question mark (a distant crowd orb doesn't need one)
 *   castLight   attach a real PointLight (expensive; off for background orbs)
 */
export function makeOrb(opts = {}) {
  const {
    color = 0xffc27a,
    radius = 0.55,
    intensity = 2.4,
    glyph = true,
    castLight = true,
    name = "orb",
  } = opts;

  const tint = new THREE.Color(color);
  const group = new THREE.Group();
  group.name = name;

  // Core — small, bright, unlit so it reads as a source rather than a surface.
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.42, 24, 18),
    new THREE.MeshBasicMaterial({
      color: tint.clone().lerp(new THREE.Color(0xffffff), 0.55),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
  );
  group.add(core);

  // Shell — the volume.
  const shellMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: tint.clone() },
      uPower: { value: 2.1 },
      uIntensity: { value: 1.35 },
    },
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), shellMat);
  group.add(shell);

  // A second, larger shell at low intensity gives it atmosphere without a
  // post-processing pass.
  const haloMat = shellMat.clone();
  haloMat.uniforms = THREE.UniformsUtils.clone(shellMat.uniforms);
  haloMat.uniforms.uPower.value = 1.35;
  haloMat.uniforms.uIntensity.value = 0.42;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.85, 24, 18), haloMat);
  group.add(halo);

  // Glyph — billboarded in update(), additive so it sits *in* the light.
  let glyphMesh = null;
  if (glyph) {
    glyphMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 1.15, radius * 1.15),
      new THREE.MeshBasicMaterial({
        map: makeGlyphTexture(),
        color: tint.clone().lerp(new THREE.Color(0xffffff), 0.75),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.92,
      })
    );
    glyphMesh.renderOrder = 3;
    group.add(glyphMesh);
  }

  let light = null;
  if (castLight) {
    light = new THREE.PointLight(tint.clone(), intensity, radius * 34, 1.8);
    group.add(light);
  }

  // --- Acting dials ---------------------------------------------------------
  const state = {
    bob: 0.05,          // vertical drift amplitude, world units
    bobRate: 0.9,
    pulse: 0.06,        // brightness wobble, 0..1
    pulseRate: 1.4,
    agitation: 0,       // 0 calm .. 1 frantic; speeds and deepens everything
    presence: 1,        // 0 gone .. 1 fully there; fades the whole orb
  };

  let t = Math.random() * 100;   // desync orbs that share a scene
  const baseY = { v: 0 };

  function update(dt, camera) {
    t += dt * (1 + state.agitation * 2.2);

    const bobAmt = state.bob * (1 + state.agitation * 1.6);
    group.position.y = baseY.v + Math.sin(t * state.bobRate) * bobAmt
                     + Math.sin(t * state.bobRate * 2.7) * bobAmt * 0.3;

    const p = 1 + Math.sin(t * state.pulseRate) * state.pulse * (1 + state.agitation);
    const vis = state.presence;

    shellMat.uniforms.uIntensity.value = 1.35 * p * vis;
    haloMat.uniforms.uIntensity.value = 0.42 * p * vis;
    core.material.opacity = 0.95 * vis;
    if (light) light.intensity = intensity * p * vis;
    if (glyphMesh) {
      glyphMesh.material.opacity = 0.92 * vis;
      if (camera) glyphMesh.quaternion.copy(camera.quaternion);
    }
    group.visible = vis > 0.01;
  }

  return {
    group,
    update,
    state,
    setPosition(x, y, z) {
      group.position.set(x, y, z);
      baseY.v = y;
    },
    setColor(c) {
      const col = new THREE.Color(c);
      shellMat.uniforms.uColor.value.copy(col);
      haloMat.uniforms.uColor.value.copy(col);
      core.material.color.copy(col.clone().lerp(new THREE.Color(0xffffff), 0.55));
      if (glyphMesh) glyphMesh.material.color.copy(col.clone().lerp(new THREE.Color(0xffffff), 0.75));
      if (light) light.color.copy(col);
    },
    setScale(s) {
      group.scale.setScalar(s);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
