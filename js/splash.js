import * as THREE from "three";

// ---------------------------------------------------------------------------
// Splashes: something big hitting the sea, or leaving it.
//
// Three parts, all cheap:
//   SPRAY    a few hundred droplets thrown up and out in a crown, falling back
//            under gravity, drawn as soft additive points;
//   SHEET    a ring of white water rising round the hole and collapsing;
//   FOAM     a flat ring on the surface spreading out and fading.
// splash(at, size) fires one; update(dt) runs them all.
// ---------------------------------------------------------------------------

const MAX = 1400;

export function createSplashes(scene) {
  // Spray as points.
  const pos = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3), life = new Float32Array(MAX);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
  const dot = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(240,248,255,.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const mat = new THREE.ShaderMaterial({
    uniforms: { tDot: { value: dot }, uScale: { value: 380 } },
    vertexShader: /* glsl */`
      attribute float aLife; varying float vL;
      uniform float uScale;
      void main() {
        vL = aLife;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        gl_PointSize = aLife > 0.0 ? uScale * ( 0.35 + 0.65 * aLife ) / -mv.z : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDot; varying float vL;
      void main() { vec4 t = texture2D( tDot, gl_PointCoord ); gl_FragColor = vec4( vec3( 0.92, 0.96, 1.0 ), t.a * min( 1.0, vL * 2.0 ) * 0.85 ); }`,
    transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  scene.add(points);
  let cursor = 0;

  // Sheets and foam rings, pooled.
  const rings = [];
  const ringGeo = new THREE.CylinderGeometry(1, 1.15, 1, 32, 1, true);
  const foamGeo = new THREE.RingGeometry(0.6, 1, 48).rotateX(-Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const sheet = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xeef6ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const foam = new THREE.Mesh(foamGeo, new THREE.MeshBasicMaterial({ color: 0xf4f8fb, transparent: true, opacity: 0, depthWrite: false }));
    sheet.visible = foam.visible = false;
    scene.add(sheet, foam);
    rings.push({ sheet, foam, t: 9, size: 1, at: new THREE.Vector3() });
  }
  let ringI = 0;

  function splash(at, size = 1) {
    const n = Math.round(420 * size);
    for (let k = 0; k < n; k++) {
      const i = cursor; cursor = (cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6 * size;
      pos[i * 3] = at.x + Math.cos(a) * r; pos[i * 3 + 1] = at.y + 0.2; pos[i * 3 + 2] = at.z + Math.sin(a) * r;
      // A crown: most of it up and out, a column straight up in the middle.
      const up = (r < 0.5 * size ? 14 : 7 + Math.random() * 6) * Math.sqrt(size);
      const out = (2 + Math.random() * 5) * Math.sqrt(size);
      vel[i * 3] = Math.cos(a) * out; vel[i * 3 + 1] = up * (0.6 + Math.random() * 0.6); vel[i * 3 + 2] = Math.sin(a) * out;
      life[i] = 1;
    }
    const R = rings[ringI]; ringI = (ringI + 1) % rings.length;
    R.t = 0; R.size = size; R.at.copy(at);
    R.sheet.visible = R.foam.visible = true;
  }

  function update(dt) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      any = true;
      vel[i * 3 + 1] -= 9.81 * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      life[i] -= dt * 0.8;
      if (pos[i * 3 + 1] < 0 && vel[i * 3 + 1] < 0) life[i] = 0;
    }
    if (any) { g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; }
    for (const R of rings) {
      if (!R.sheet.visible) continue;
      R.t += dt;
      const s = R.size, t = R.t;
      // The sheet rises fast and collapses; the foam spreads and fades.
      const rise = Math.sin(Math.min(1, t / 0.9) * Math.PI);
      R.sheet.position.set(R.at.x, 0.01 + rise * 1.6 * s, R.at.z);
      R.sheet.scale.set(1.5 * s + t * 3 * s, Math.max(0.01, rise * 3.2 * s), 1.5 * s + t * 3 * s);
      R.sheet.material.opacity = 0.55 * rise;
      R.foam.position.set(R.at.x, 0.05, R.at.z);
      const fr = 2 * s + t * 6 * s;
      R.foam.scale.set(fr, 1, fr);
      R.foam.material.opacity = 0.7 * Math.max(0, 1 - t / 3.5);
      if (t > 3.5) R.sheet.visible = R.foam.visible = false;
    }
  }

  return { splash, update };
}
