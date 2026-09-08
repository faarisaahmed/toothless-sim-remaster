import * as THREE from "three";
import { loadDragon, normalizeDragon } from "./assets.js";
import { makeOrb } from "./placeholder.js";
import * as tex from "./textures.js";
import * as input from "./input.js";
import { bindDragon, noseSign } from "./dragonrig.js";
import { music } from "./audio.js";
import { setupPost } from "./postfx.js";

// ---------------------------------------------------------------------------
// B1 — The Room
//
// The only interior in the game, and the only time the camera is inside four
// walls. It has to feel small, because everything after it is enormous.
//
// The scene is a walk around a dark room at night with almost nothing to do.
// Looking at things IS the gameplay: five objects, each of which says something
// without anybody speaking. It ends when the player lies back down on the slab,
// which is the only obvious thing to do in a room at night, and doing it is a
// small act of resignation.
//
// Per STORY.md, no narration and no inner monologue. Objects name themselves
// and nothing else. What they mean is the player's job.
// ---------------------------------------------------------------------------

const ROOM = { w: 11.5, d: 13, h: 4.8 };    // metres; he's 3.4 long and needs room to turn around
                                           // in, and not one metre more — this scene is
                                           // about the room being small.

// Where the interesting things are. `face` is the yaw the camera swings to when
// he studies it, so each object gets a composed shot rather than whatever angle
// he happened to arrive from.
const OBJECTS = [
  {
    id: "saddle", label: "The saddle",
    pos: [4.6, 0.62, -2.2], radius: 2.2, face: -1.15,
    note: "Eleven days.",
  },
  {
    id: "fin", label: "The tailfin",
    pos: [-4.9, 0.16, 2.9], radius: 2.2, face: 1.9,
    note: "It flew badly. They laughed about it.",
  },
  {
    id: "hiccup", label: "Hiccup",
    pos: [-3.6, 0.55, -5.4], radius: 2.6, face: 2.6,
    note: "",
  },
  {
    id: "chart", label: "The chart",
    pos: [0.3, 2.4, -7.8], radius: 2.6, face: 0.0,
    note: "The edges are blank.",
  },
  {
    id: "window", label: "The shutter",
    pos: [6.9, 2.4, 1.8], radius: 2.5, face: -1.5,
    note: "",
  },
];

const SLAB = { pos: [-0.6, 0, 5.2], radius: 2.6 };

export function runPrologue(pad = null, save = null) {
  music.play("prologue");
  return new Promise((resolve) => {
    // --- DOM ----------------------------------------------------------------
    const root = document.createElement("div");
    root.id = "prologue";
    root.innerHTML = `
      <canvas id="prologue-canvas"></canvas>
      <div class="pro-vignette"></div>
      <div class="pro-letterbox top"></div>
      <div class="pro-letterbox bottom"></div>

      <div class="pro-label" id="pro-label" hidden>
        <div class="pro-label-name"></div>
        <div class="pro-label-note"></div>
      </div>

      <div class="pro-prompt" id="pro-prompt" hidden>
        <kbd>R</kbd><kbd class="pad shape">&#9651;</kbd>
        <span></span>
      </div>

      <div class="pro-objective" id="pro-objective">
        <div class="pro-obj-line">Look around the room</div>
        <div class="pro-obj-count"><b id="pro-seen">0</b> <i>of</i> <b>5</b></div>
      </div>

      <div class="pro-hint" id="pro-hint">
        <span class="k"><kbd>W</kbd><kbd>S</kbd> walk</span>
        <span class="k"><kbd>A</kbd><kbd>D</kbd> turn</span>
        <span class="k"><kbd>R</kbd> look at what you're near</span>
        <span class="p"><kbd class="pad">L&#9679;</kbd> walk</span>
        <span class="p"><kbd class="pad shape">&#9651;</kbd> look at</span>
      </div>

      <div class="pro-open" id="pro-open">
        <div class="pro-open-line">He has not slept.</div>
      </div>

      <div class="pro-fade" id="pro-fade"></div>
    `;
    document.body.appendChild(root);
    document.body.classList.add("in-prologue");

    const labelEl = root.querySelector("#pro-label");
    const labelName = root.querySelector(".pro-label-name");
    const labelNote = root.querySelector(".pro-label-note");
    const promptEl = root.querySelector("#pro-prompt");
    const promptText = promptEl.querySelector("span");
    const hintEl = root.querySelector("#pro-hint");
    const objectiveEl = root.querySelector("#pro-objective");
    const seenEl = root.querySelector("#pro-seen");
    const openEl = root.querySelector("#pro-open");
    const fadeEl = root.querySelector("#pro-fade");

    // --- Renderer -----------------------------------------------------------
    const canvas = root.querySelector("#prologue-canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.85;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.Fog(0x0d1018, 16, 46);

    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 160);

    // Bloom for the hearth and the orb, vignette and split-tone for the corners.
    // Threshold is low here because the only bright things in the room are ones
    // that should glow.
    const post = setupPost(renderer, scene, camera, {
      bloom: { strength: 0.62, radius: 0.62, threshold: 0.42 },
      vignette: 0.80,
      grain: 0.016,
      tint: { cool: 0x1c2740, warm: 0x2a1a08, mix: 0.55 },
    });

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      post.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // --- Materials ----------------------------------------------------------
    const woodDark  = tex.material(tex.wood({ planks: 5, warm: 0.82 }), { repeat: 2.2, roughness: 0.92, bumpScale: 0.05 });
    const woodFloor = tex.material(tex.wood({ planks: 7, warm: 0.95 }), { repeat: 3.0, roughness: 0.86, bumpScale: 0.06 });
    const woodBeam  = tex.material(tex.wood({ planks: 2, warm: 0.7 }),  { repeat: 1.4, roughness: 0.95, bumpScale: 0.07 });
    const stoneMat  = tex.material(tex.stone(),  { repeat: 1.6, roughness: 0.95, bumpScale: 0.09 });
    const slabMat   = tex.material(tex.stone({ cols: 2, rows: 2 }), { repeat: 1, roughness: 0.8, bumpScale: 0.06 });
    const furMat    = tex.material(tex.fur(),    { repeat: 1.6, roughness: 1.0, bumpScale: 0.10 });
    const hideMat   = tex.material(tex.fur({ tint: [70, 52, 40] }), { repeat: 1.2, roughness: 1.0, bumpScale: 0.10 });

    // --- Shell --------------------------------------------------------------
    const room = new THREE.Group();
    scene.add(room);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), woodFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    room.add(floor);

    function wall(w, h, x, y, z, ry) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), woodDark);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      room.add(m);
      return m;
    }
    wall(ROOM.w, ROOM.h, 0, ROOM.h / 2, -ROOM.d / 2, 0);                 // back
    wall(ROOM.w, ROOM.h, 0, ROOM.h / 2, ROOM.d / 2, Math.PI);            // front
    wall(ROOM.d, ROOM.h, -ROOM.w / 2, ROOM.h / 2, 0, Math.PI / 2);       // left
    wall(ROOM.d, ROOM.h, ROOM.w / 2, ROOM.h / 2, 0, -Math.PI / 2);       // right

    // Pitched roof — two planes and a ridge. Longhouses aren't flat-ceilinged
    // and the slope is most of what makes the space feel like a house.
    // Two slopes meeting at a ridge. Each starts flat (rotateX) and then tips
    // about Z; doing it on the geometry keeps the object transform readable.
    const PITCH = 0.62;                       // radians of slope
    const halfW = ROOM.w / 2;
    const slopeLen = halfW / Math.cos(PITCH);
    const ridgeY = ROOM.h + Math.tan(PITCH) * halfW;

    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(slopeLen, ROOM.d);
      g.rotateX(-Math.PI / 2);                // lay it flat
      g.rotateZ(-s * PITCH);                  // tip it toward the ridge
      const m = new THREE.Mesh(g, woodDark);
      // Midpoint of this slope: halfway out from the ridge, halfway down.
      m.position.set(s * halfW / 2, (ridgeY + ROOM.h) / 2, 0);
      m.receiveShadow = true;
      room.add(m);
    }

    // Beams across, and two uprights. Cheap, and they catch the firelight.
    for (let i = -1; i <= 1; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.4, 0.26, 0.3), woodBeam);
      beam.position.set(0, ROOM.h - 0.2, i * 3.1);
      beam.castShadow = beam.receiveShadow = true;
      room.add(beam);
    }
    for (const x of [-ROOM.w / 2 + 0.5, ROOM.w / 2 - 0.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, ROOM.h, 0.34), woodBeam);
      post.position.set(x, ROOM.h / 2, -3.1);
      post.castShadow = true;
      room.add(post);
    }

    // --- Hearth -------------------------------------------------------------
    const hearth = new THREE.Group();
    hearth.position.set(-5.0, 0, -0.5);
    room.add(hearth);

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.34, 16, 1, true), stoneMat);
    ring.position.y = 0.17;
    ring.castShadow = ring.receiveShadow = true;
    hearth.add(ring);

    const ash = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20),
      new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: 1 }));
    ash.rotation.x = -Math.PI / 2;
    ash.position.y = 0.04;
    hearth.add(ash);

    // Embers: a handful of small emissive lumps. No particles — at this light
    // level a dozen glowing stones is more convincing than a sprite sheet.
    const embers = [];
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.78;
      const e = new THREE.Mesh(
        new THREE.SphereGeometry(0.035 + Math.random() * 0.05, 6, 5),
        new THREE.MeshStandardMaterial({
          color: 0x2a0f06, emissive: 0xff5a18,
          emissiveIntensity: 0.6 + Math.random(), roughness: 1,
        })
      );
      e.position.set(Math.cos(a) * r, 0.06 + Math.random() * 0.05, Math.sin(a) * r);
      e.userData.phase = Math.random() * 10;
      e.userData.rate = 0.5 + Math.random() * 1.4;
      hearth.add(e);
      embers.push(e);
    }
    // A couple of half-burnt logs.
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 7), woodBeam);
      log.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI + 0.4);
      log.position.set(Math.cos(i * 2.1) * 0.3, 0.12, Math.sin(i * 2.1) * 0.3);
      log.castShadow = true;
      hearth.add(log);
    }

    const fireLight = new THREE.PointLight(0xff8c3c, 26, 20, 1.5);
    fireLight.position.set(0, 0.5, 0);
    fireLight.castShadow = true;
    fireLight.shadow.mapSize.set(1024, 1024);
    fireLight.shadow.bias = -0.004;
    fireLight.shadow.camera.near = 0.1;
    fireLight.shadow.camera.far = 20;
    hearth.add(fireLight);

    // --- Window and the moon shaft -----------------------------------------
    const winFrame = new THREE.Group();
    winFrame.position.set(ROOM.w / 2 - 0.02, 2.4, 1.8);
    room.add(winFrame);

    // The night outside — deliberately a shade lighter than the room, so the
    // opening reads as a way out rather than a hole.
    const opening = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.1),
      new THREE.MeshBasicMaterial({ color: 0x16233d })
    );
    opening.rotation.y = -Math.PI / 2;
    winFrame.add(opening);

    const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 1.55), woodBeam);
    shutter.position.set(-0.06, 0, 0);
    shutter.castShadow = true;
    winFrame.add(shutter);

    // The shaft: a stretched, additive cone of cold light. Fake, and the single
    // biggest thing separating "dark room" from "night".
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0x9dbaf0, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.5, 7.5, 12, 1, true), shaftMat);
    shaft.position.set(2.4, 1.5, 0.4);
    shaft.rotation.set(0, 0, Math.PI / 2.3);
    shaft.visible = false;   // only once the shutter is open
    room.add(shaft);

    const moonLight = new THREE.DirectionalLight(0x9dbaf0, 0.0);
    moonLight.position.set(8, 4, 3);
    moonLight.target.position.set(-1, 0, 0);
    room.add(moonLight, moonLight.target);

    // Cold spill through the shutter gaps, on before it is ever opened. This is
    // the counterweight to the fire and it is doing most of the work in the
    // frame: without a cold source the whole room is one warm value and reads
    // as brown, however good the textures are.
    const leak = new THREE.PointLight(0x7fa0e0, 6.5, 13, 1.6);
    leak.position.set(ROOM.w / 2 - 0.6, 2.5, 1.8);
    room.add(leak);

    // And a low cold bounce off the floorboards on that side, so the darkness
    // in the corners is blue rather than black.
    const coldFill = new THREE.DirectionalLight(0x6f8fd0, 0.22);
    coldFill.position.set(6, 3, 4);
    coldFill.target.position.set(-2, 0.6, -1);
    room.add(coldFill, coldFill.target);

    const bounce = new THREE.PointLight(0xffbb84, 3.2, 16, 1.8);
    bounce.position.set(-3.0, 2.9, 0.4);
    room.add(bounce);

    // Ambient floor. Low, but not so low that half the room is pure void —
    // "dark" has to still mean "you can see the shape of the place".
    scene.add(new THREE.HemisphereLight(0x3f5480, 0x14100c, 0.62));

    // Wall lamps. A longhouse at night has more than one fire in it, and two
    // practicals on the far walls stop the corners reading as void.
    for (const [lx, lz] of [[-ROOM.w / 2 + 0.5, -4.0]]) {
      const lamp = new THREE.PointLight(0xffb268, 5.5, 15, 1.9);
      lamp.position.set(lx, 3.0, lz);
      room.add(lamp);
      const bowl = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 10),
        new THREE.MeshStandardMaterial({
          color: 0x2a1c10, emissive: 0xff8a3a, emissiveIntensity: 2.4, roughness: 1,
        })
      );
      bowl.position.set(lx, 3.0, lz);
      room.add(bowl);
    }

    // --- Furniture ----------------------------------------------------------
    // Hiccup's bed
    const bed = new THREE.Group();
    bed.position.set(-3.6, 0, -5.4);
    room.add(bed);
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.42, 1.5), woodBeam);
    bedFrame.position.y = 0.21;
    bedFrame.castShadow = bedFrame.receiveShadow = true;
    bed.add(bedFrame);
    const bedding = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 1.42), furMat);
    bedding.position.y = 0.56;
    bedding.castShadow = bedding.receiveShadow = true;
    bed.add(bedding);

    // His slab — warm stone, a hollow worn into it, pelts around the edge.
    const slab = new THREE.Group();
    slab.position.set(...SLAB.pos);
    room.add(slab);
    const slabTop = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.34, 20), slabMat);
    slabTop.position.y = 0.17;
    slabTop.receiveShadow = slabTop.castShadow = true;
    slab.add(slabTop);
    const pelt = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 20), hideMat);
    pelt.position.y = 0.36;
    pelt.receiveShadow = true;
    slab.add(pelt);

    // Saddle on a stand
    const saddleGrp = new THREE.Group();
    saddleGrp.position.set(4.6, 0, -2.2);
    room.add(saddleGrp);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.9, 8), woodBeam);
    stand.position.y = 0.45;
    stand.castShadow = true;
    saddleGrp.add(stand);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.16), woodBeam);
    cross.position.y = 0.9;
    cross.castShadow = true;
    saddleGrp.add(cross);
    const seat = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4a3120, roughness: 0.62, metalness: 0.05 }));
    seat.scale.set(1, 0.62, 1.25);
    seat.position.y = 0.92;
    seat.castShadow = true;
    saddleGrp.add(seat);
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x33210f, roughness: 0.8 }));
      strap.position.set(s * 0.36, 0.62, 0.1);
      strap.castShadow = true;
      saddleGrp.add(strap);
    }

    // Bench, with the prototype fin half under it
    const benchGrp = new THREE.Group();
    benchGrp.position.set(-5.0, 0, 3.3);
    room.add(benchGrp);
    const benchTop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 2.4), woodBeam);
    benchTop.position.y = 0.62;
    benchTop.castShadow = benchTop.receiveShadow = true;
    benchGrp.add(benchTop);
    for (const z of [-1.0, 1.0]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 0.14), woodBeam);
      leg.position.set(0, 0.31, z);
      leg.castShadow = true;
      benchGrp.add(leg);
    }

    // The fin itself — a red leather half-fin on a hinged frame, lying flat and
    // dusty. Deliberately not glamorous.
    const fin = new THREE.Group();
    fin.position.set(-4.9, 0.05, 2.9);
    fin.rotation.set(0, 0.5, 0);
    room.add(fin);
    const finSkin = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 3),
      new THREE.MeshStandardMaterial({ color: 0x8d2c22, roughness: 0.72, side: THREE.DoubleSide })
    );
    finSkin.rotation.x = -Math.PI / 2;
    finSkin.scale.set(1, 1.35, 1);
    finSkin.castShadow = true;
    fin.add(finSkin);
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.72),
        new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.4, metalness: 0.7 }));
      rib.position.set(0.02, 0.03, 0);
      rib.rotation.y = -0.5 + i * 0.5;
      fin.add(rib);
    }

    // The chart on the back wall
    const chart = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.8),
      tex.material(tex.parchment(), { repeat: 1, roughness: 0.95, bumpScale: 0.02 })
    );
    chart.position.set(0.3, 2.4, -ROOM.d / 2 + 0.06);
    chart.receiveShadow = true;
    room.add(chart);

    // --- Him ----------------------------------------------------------------
    let dragon = null;
    let pose = null;
    let baseScale = 1;
    const body = new THREE.Group();     // yaw lives here; the model hangs off it
    body.position.set(0.9, 0, 1.8);
    room.add(body);

    // Travels with him, points down his back from above and behind. Cool, so it
    // reads as separate from the hearth rather than as more firelight.
    const charKey = new THREE.PointLight(0xe4dac9, 5.0, 18, 1.5);
    charKey.position.set(0.5, 3.6, -2.6);
    body.add(charKey);

    loadDragon().then(({ gltf, path }) => {
      const model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
          // Keep whatever the export shipped, but make sure it reacts to light.
          // Toothless is black, the room is dark, and the honest result is an
          // invisible protagonist. Lift the base and keep it fairly glossy so
          // the firelight actually catches along his back.
          o.material = new THREE.MeshStandardMaterial({
            color: 0x343b47, roughness: 0.52, metalness: 0.05,
          });
        }
      });
      // ~3.4m nose to tail, feet on the floor, Y-up regardless of export.
      const rig = normalizeDragon(model, 3.4, path);
      baseScale = rig.scale.x;
      dragon = rig;
      body.add(rig);

      // 95 bones, no clips — every pose in this scene is made in dragonrig.js.
      pose = bindDragon(model);
      pose.snapFold(1);            // wings tucked from frame one; he's indoors

      // Movement runs along +Z of the body group, so his nose has to point that
      // way too. This export's does not, which is what made W walk him
      // tail-first. Measured off the skeleton rather than hard-coded.
      if (noseSign(rig) < 0) rig.rotation.y += Math.PI;
    }).catch((e) => console.warn("prologue: no dragon model", e));

    // --- Hiccup -------------------------------------------------------------
    // A warm orb, asleep: low, slow, barely pulsing.
    const hiccup = makeOrb({ color: 0xffb765, radius: 0.42, intensity: 1.5, name: "hiccup" });
    hiccup.setPosition(-3.6, 0.95, -5.4);
    hiccup.state.bob = 0.03;
    hiccup.state.bobRate = 0.45;
    hiccup.state.pulse = 0.10;
    hiccup.state.pulseRate = 0.5;
    room.add(hiccup.group);

    // --- State --------------------------------------------------------------
    let yaw = Math.PI;
    let camYaw = Math.PI;
    let camPitch = 0.24;          // radians above the horizontal
    let orbit = 0;                // player's own offset from behind-his-back
    let orbitPitch = 0;
    let camDist = 5.8;

    let groundSpeed = 0;          // m/s, measured from actual displacement
    const lastPos = new THREE.Vector3();
    const seen = new Set();
    let studying = null;       // object being looked at
    let studyT = 0;
    let near = null;           // object in range
    let nearSlab = false;
    let ending = false;
    let elapsed = 0;

    const clock = new THREE.Clock();
    let raf = 0;

    // --- Free look ----------------------------------------------------------
    // Click to capture, same as the flight sim. The offset is the PLAYER's, and
    // nothing else writes it — the camera still follows him, but where it sits
    // around him is theirs. Drifts back to behind his shoulder when they stop.
    const SHOULDER = 0.62;   // radians off dead-astern. Straight behind a dragon is a
                             // view of a tail — and his tail fins are the palest thing
                             // on him, so dead astern is also the worst-lit angle.
    const LOOK_SENS = 0.0026;
    const PITCH_MIN = -0.35, PITCH_MAX = 0.95;
    let lookIdle = 0;

    function onMouseMove(e) {
      if (document.pointerLockElement !== document.body) return;
      if (Math.abs(e.movementX) > 180 || Math.abs(e.movementY) > 180) return;
      orbit -= e.movementX * LOOK_SENS;
      orbitPitch = THREE.MathUtils.clamp(
        orbitPitch - e.movementY * LOOK_SENS, PITCH_MIN, PITCH_MAX);
      lookIdle = 0;
    }
    function onClick(e) {
      if (e.target.closest(".pro-label, .pro-hint, .pro-objective")) return;
      const req = document.body.requestPointerLock?.({ unadjustedMovement: true });
      if (req && typeof req.catch === "function") {
        req.catch(() => document.body.requestPointerLock());
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    root.addEventListener("click", onClick);

    function damp(l, dt) { return 1 - Math.exp(-l * dt); }

    function showLabel(obj) {
      labelName.textContent = obj.label;
      labelNote.textContent = obj.note || "";
      labelNote.style.display = obj.note ? "" : "none";
      labelEl.hidden = false;
      labelEl.classList.remove("out");
    }

    function hideLabel() {
      labelEl.classList.add("out");
      setTimeout(() => { if (labelEl.classList.contains("out")) labelEl.hidden = true; }, 400);
    }

    function openShutter() {
      shutter.rotation.y = -1.15;
      shutter.position.z = 0.75;
      shaft.visible = true;
      moonLight.intensity = 0.55;
      pad?.rumble.pulse(0.35, 0.5, 0.5);
    }

    function finish() {
      if (ending) return;
      ending = true;
      input.popContext();
      hideLabel();
      promptEl.hidden = true;
      hintEl.classList.remove("on");
      pad?.rumble.pulse(0.5, 0.25, 0.9);

      fadeEl.classList.add("on");
      setTimeout(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("mousemove", onMouseMove);
        if (document.pointerLockElement === document.body) document.exitPointerLock();
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) m.dispose();
          }
        });
        renderer.dispose();
        renderer.forceContextLoss();
        document.body.classList.remove("in-prologue");
        root.remove();
        resolve({ seen: [...seen] });
      }, 2200);
    }

    function frame() {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;

      input.beginFrame(dt);
      document.body.classList.toggle("pad-live", !!pad?.connected());

      // --- Movement ---------------------------------------------------------
      // Heavy and quiet. He is a large animal in a small room at night and the
      // movement should say so: slow top speed, long ramp, no strafe.
      if (!ending && !studying) {
        const turn = input.axis("turnL", "turnR", "lx");
        const walk = input.axis("back", "forward", "ly");

        yaw -= turn * 2.2 * dt;

        if (Math.abs(walk) > 0.01) {
          const speed = 2.3 * (walk > 0 ? 1 : 0.72);
          const step = walk * speed * dt;
          const nx = body.position.x + Math.sin(yaw) * step;
          const nz = body.position.z + Math.cos(yaw) * step;
          // Keep him off the walls and out of the fire.
          const margin = 1.0;
          const inRoom = Math.abs(nx) < ROOM.w / 2 - margin && Math.abs(nz) < ROOM.d / 2 - margin;
          const clearFire = Math.hypot(nx - hearth.position.x, nz - hearth.position.z) > 1.8;
          if (inRoom && clearFire) {
            body.position.x = nx;
            body.position.z = nz;
          }
          // Footfalls: a low thump on a slow cadence, scaled by how fast he's
          // actually moving. Same idea as the wingbeat rumble in flight.
          const cadence = Math.sin(elapsed * 6.5 * Math.abs(walk));
          const fall = Math.max(0, -cadence) ** 4;
          pad?.rumble.sustain(0.10 * fall, 0.05 * fall);
        }
      }
      body.rotation.y = yaw;

      // Ground speed from actual displacement rather than from input, so the
      // gait stays in step when he's blocked by a wall or the hearth.
      const moved = body.position.distanceTo(lastPos);
      lastPos.copy(body.position);
      groundSpeed += (moved / Math.max(dt, 1e-4) - groundSpeed) * (1 - Math.exp(-12 * dt));

      if (pose) pose.update(dt, { speed: groundSpeed, maxSpeed: 2.3 });

      // --- Proximity --------------------------------------------------------
      near = null;
      let bestD = Infinity;
      for (const o of OBJECTS) {
        const d = Math.hypot(body.position.x - o.pos[0], body.position.z - o.pos[2]);
        if (d < o.radius && d < bestD) { bestD = d; near = o; }
      }
      nearSlab = Math.hypot(body.position.x - SLAB.pos[0], body.position.z - SLAB.pos[2]) < SLAB.radius;

      if (!ending) {
        if (studying) {
          promptEl.hidden = true;
        } else if (nearSlab && seen.size >= 3) {
          promptText.textContent = "Lie down";
          promptEl.hidden = false;
        } else if (nearSlab) {
          promptText.textContent = `Look around first — ${seen.size} of 3`;
          promptEl.hidden = false;
        } else if (near) {
          promptText.textContent = `Look at ${near.label.toLowerCase()}`;
          promptEl.hidden = false;
        } else {
          promptEl.hidden = true;
        }
      }

      // --- Interaction ------------------------------------------------------
      if (!ending) {
        if (studying) {
          studyT += dt;
          // Hold to keep looking; release to come out of it. A study is over
          // when the player decides it is, not on a timer.
          if (!input.held("look") && !input.held("confirm") && studyT > 0.4) {
            studying = null;
            hideLabel();
          }
        } else if (input.pressed("confirm") || input.pressed("look")) {
          if (nearSlab && seen.size >= 3) {
            finish();
          } else if (near) {
            studying = near;
            studyT = 0;
            if (!seen.has(near.id)) {
              seen.add(near.id);
              pad?.rumble.pulse(0.3, 0.12, 0.18);
            }
            showLabel(near);
            if (near.id === "window") openShutter();
            if (near.id === "hiccup") {
              // He nudges him. Hiccup shifts, mumbles, doesn't wake.
              hiccup.state.agitation = 1;
              hiccup.state.pulse = 0.3;
              pad?.rumble.pulse(0.45, 0.2, 0.4);
              setTimeout(() => {
                hiccup.state.agitation = 0;
                hiccup.state.pulse = 0.10;
              }, 1400);
            }
          }
        }

        // The counter is the whole tutorial. Once it's full the objective
        // changes to the only thing left to do, and the control hints retire.
        if (seenEl.textContent !== String(seen.size)) {
          seenEl.textContent = String(seen.size);
          objectiveEl.classList.add("tick");
          setTimeout(() => objectiveEl.classList.remove("tick"), 420);
        }
        if (seen.size >= 3 && !objectiveEl.classList.contains("done")) {
          objectiveEl.classList.add("done");
          objectiveEl.querySelector(".pro-obj-line").textContent = "Lie back down when you're ready";
          hintEl.classList.remove("on");
        }
      }

      // --- Fire ------------------------------------------------------------
      // Embers breathe independently, and the key light flickers on a sum of
      // two incommensurate sines so it never finds a loop.
      const flick = 0.82
        + Math.sin(elapsed * 7.3) * 0.06
        + Math.sin(elapsed * 2.1) * 0.09
        + Math.sin(elapsed * 13.7) * 0.03;
      fireLight.intensity = 26 * flick;
      fireLight.position.x = Math.sin(elapsed * 1.7) * 0.06;
      for (const e of embers) {
        e.material.emissiveIntensity =
          0.5 + 0.9 * (0.5 + 0.5 * Math.sin(elapsed * e.userData.rate + e.userData.phase));
      }

      hiccup.update(dt, camera);

      // --- Camera -----------------------------------------------------------
      // Low, close, and behind. When he studies something the camera swings to
      // a composed angle for it — the shot is authored, not whatever he walked
      // in on.
      // Right stick mirrors the mouse, so a pad player gets the same control.
      if (pad?.connected() && (pad.rx || pad.ry)) {
        orbit -= pad.rx * 2.4 * dt;
        orbitPitch = THREE.MathUtils.clamp(orbitPitch - pad.ry * 1.5 * dt, PITCH_MIN, PITCH_MAX);
        lookIdle = 0;
      }

      // Let the offset relax back behind him once they stop looking around, so
      // the camera never stays somewhere awkward on its own.
      lookIdle += dt;
      if (lookIdle > 2.5 && !studying) {
        const k = damp(0.9, dt);
        orbit -= orbit * k;
        orbitPitch -= orbitPitch * k;
      }

      let targetYaw = yaw + Math.PI + orbit + SHOULDER;
      let targetDist = 5.8;
      let pitch = 0.24 + orbitPitch;

      if (studying) {
        targetYaw = studying.face;
        targetDist = 2.9;
        pitch = 0.10;
      }

      camYaw += (((targetYaw - camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * damp(6.5, dt);
      camDist += (targetDist - camDist) * damp(2.6, dt);
      camPitch += (pitch - camPitch) * damp(6.5, dt);

      const LEAD = 1.15;   // metres ahead of his origin, i.e. at his shoulders
      const focusX = studying ? studying.pos[0] : body.position.x + Math.sin(yaw) * LEAD;
      const focusY = studying ? studying.pos[1] + 0.3 : 0.80;
      const focusZ = studying ? studying.pos[2] : body.position.z + Math.cos(yaw) * LEAD;

      // Orbit on a sphere around him rather than at a fixed height, so looking
      // up and down actually moves the camera instead of just tilting it.
      const flat = camDist * Math.cos(camPitch);
      camera.position.set(
        focusX + Math.sin(camYaw) * flat,
        focusY + 0.95 + camDist * Math.sin(camPitch),
        focusZ + Math.cos(camYaw) * flat
      );
      // Never let the camera get outside the house or inside the floor.
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, -ROOM.w / 2 + 0.4, ROOM.w / 2 - 0.4);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, -ROOM.d / 2 + 0.4, ROOM.d / 2 - 0.4);
      camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.7, ROOM.h - 0.4);
      camera.lookAt(focusX, focusY, focusZ);

      post.render(dt);
      input.finishFrame(dt);
    }

    // Open on black and come up slowly. The player should arrive in the middle
    // of a night that was already happening.
    fadeEl.classList.add("on");
    requestAnimationFrame(() => fadeEl.classList.remove("on"));

    // One line, once, then never again. It is the only text in the scene that
    // isn't the name of an object.
    setTimeout(() => openEl.classList.add("on"), 900);
    setTimeout(() => openEl.classList.remove("on"), 5200);
    setTimeout(() => { objectiveEl.classList.add("on"); hintEl.classList.add("on"); }, 5600);

    input.pushContext("room");
    frame();
  });
}
