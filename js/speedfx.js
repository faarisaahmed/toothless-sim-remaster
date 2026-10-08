import * as THREE from "three";

// ---------------------------------------------------------------------------
// Making speed visible.
//
// His speed is honest — 750 mph flat out is 335 m/s and that is what he
// covers — but up high over open sea nothing near the camera moves, and the
// eye judges speed only by what streams past close by. A dragon at 750 mph at
// four hundred metres looks like a dragon at 200. So the air gets things in it:
//
//   STREAKS   motes of spray and mist in a box round the camera, fixed in the
//             world, drawn as lines along his motion with a length of a
//             fraction of a second's travel. They pass at exactly his speed,
//             so they are the honest cue: faster is visibly faster.
//   THE CONE  past the speed of sound (343 m/s), the vapour cone: a white
//             condensation shell round his shoulders, and on the frame he
//             crosses Mach 1 a ring of it blown outward and a hard thump.
// ---------------------------------------------------------------------------

const COUNT = 900;
const BOX = 90;              // metres either side of the camera
const MACH = 343;

export function createSpeedFx(scene) {
  // --- Streaks ---------------------------------------------------------------
  const pts = new Float32Array(COUNT * 3);
  const r = () => (Math.random() * 2 - 1) * BOX;
  for (let i = 0; i < COUNT; i++) { pts[i * 3] = r(); pts[i * 3 + 1] = r() * 0.6; pts[i * 3 + 2] = r(); }
  const linePos = new Float32Array(COUNT * 6);
  const lineAlpha = new Float32Array(COUNT * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(lineAlpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.85, 0.9, 1) } },
    vertexShader: /* glsl */`
      attribute float aAlpha;
      varying float vA;
      void main() { vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity; uniform vec3 uColor; varying float vA;
      void main() { gl_FragColor = vec4( uColor, vA * uOpacity ); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  // Off: the streaks read as a cheap effect. Kept in the code in case a
  // subtler version is wanted; ENABLED gates them.
  const ENABLED = false;
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  scene.add(lines);

  // --- Vapour cone -----------------------------------------------------------
  const coneGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main() { vN = normalize( normalMatrix * normal ); vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */`
      uniform float uK, uTime; varying vec3 vN; varying vec3 vP;
      float h( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
      void main() {
        float rim = pow( 1.0 - abs( vN.z ), 2.0 );
        float edge = smoothstep( 0.0, 0.35, vP.y ) * ( 1.0 - smoothstep( 0.75, 1.0, vP.y ) );
        float flick = 0.75 + 0.25 * h( floor( vP.xz * 9.0 ) + floor( uTime * 30.0 ) );
        gl_FragColor = vec4( vec3( 1.0 ), rim * edge * flick * uK * 0.55 );
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.frustumCulled = false;
  cone.renderOrder = 6;
  scene.add(cone);
  // The shock ring at the crossing.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), ringMat);
  ring.frustumCulled = false;
  scene.add(ring);
  let ringT = 9, wasSuper = false, time = 0;

  const vel = new THREE.Vector3(), prev = new THREE.Vector3(), dir = new THREE.Vector3();
  const q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
  let first = true;

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {THREE.Object3D} dragon
   * @param {boolean} flying
   * @returns {boolean} true on the frame he breaks the sound barrier
   */
  function update(dt, camera, dragon, flying) {
    time += dt;
    if (!dragon) return false;
    if (first) { prev.copy(dragon.position); first = false; }
    if (dt > 1e-4) {
      const v = dir.copy(dragon.position).sub(prev).divideScalar(dt);
      if (v.length() > 1500) v.set(0, 0, 0);       // a teleport, not a speed
      vel.lerp(v, 1 - Math.exp(-10 * dt));
    }
    prev.copy(dragon.position);
    const speed = flying ? vel.length() : 0;

    // Streaks: visible from about 90 m/s, full by flat out.
    const k = THREE.MathUtils.smoothstep(speed, 90, 330);
    mat.uniforms.uOpacity.value = k * 0.5;
    lines.visible = ENABLED && k > 0.01;
    if (lines.visible) {
      const c = camera.position;
      // Length: a twentieth of a second of travel, so the stretch grows with speed.
      const len = Math.min(60, speed * 0.05);
      dir.copy(vel).normalize();
      for (let i = 0; i < COUNT; i++) {
        let x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
        // Wrap round the camera, so the box of air goes everywhere with him.
        x = ((x - c.x + BOX) % (2 * BOX) + 2 * BOX) % (2 * BOX) - BOX + c.x;
        y = ((y - c.y + BOX * 0.6) % (1.2 * BOX) + 1.2 * BOX) % (1.2 * BOX) - BOX * 0.6 + c.y;
        z = ((z - c.z + BOX) % (2 * BOX) + 2 * BOX) % (2 * BOX) - BOX + c.z;
        pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
        const o = i * 6;
        linePos[o] = x; linePos[o + 1] = y; linePos[o + 2] = z;
        linePos[o + 3] = x - dir.x * len; linePos[o + 4] = y - dir.y * len; linePos[o + 5] = z - dir.z * len;
        // Fade with distance from the camera so they are a near effect.
        const d = Math.hypot(x - c.x, y - c.y, z - c.z) / BOX;
        const a = Math.max(0, 1 - d) * (0.4 + 0.6 * ((i * 0.6180339) % 1));
        lineAlpha[i * 2] = a; lineAlpha[i * 2 + 1] = 0;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.aAlpha.needsUpdate = true;
    }

    // Vapour cone round his shoulders, past Mach 1.
    const sup = THREE.MathUtils.smoothstep(speed, MACH - 10, MACH + 120);
    coneMat.uniforms.uK.value = sup;
    coneMat.uniforms.uTime.value = time;
    cone.visible = sup > 0.01;
    if (cone.visible) {
      dir.copy(vel).normalize();
      q.setFromUnitVectors(Y, dir);
      cone.quaternion.copy(q);
      // A shell about his chest, nose through the cap.
      cone.position.copy(dragon.position).addScaledVector(dir, 1.5).add(new THREE.Vector3(0, 0.6, 0));
      cone.scale.setScalar(3.6);
    }
    const crossed = speed > MACH && !wasSuper;
    wasSuper = speed > MACH + 5 ? true : speed < MACH - 20 ? false : wasSuper;
    if (crossed) {
      ringT = 0;
      dir.copy(vel).normalize();
      ring.quaternion.setFromUnitVectors(Z, dir);
      ring.position.copy(dragon.position);
    }
    ringT += dt;
    ringMat.opacity = Math.max(0, 0.7 * (1 - ringT / 0.6));
    ring.visible = false;   // the shock ring read as an impact wave; off
    ring.scale.setScalar(4 + ringT * 90);
    return crossed;
  }

  return { update, get speed() { return vel.length(); } };
}
