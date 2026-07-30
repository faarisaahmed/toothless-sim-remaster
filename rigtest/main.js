import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildRig, setupWeightView } from "./rig.js";
import { hoverFlap, walk, foldPose, perch, params } from "./anims.js";

// ---------------------------------------------------------------------------
// Scene — neutral studio, because the point is judging deformation, not mood.
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1f24);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 500);
camera.position.set(6, 3, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("viewport").appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(5, 9, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 60;
key.shadow.camera.left = -12;
key.shadow.camera.right = 12;
key.shadow.camera.top = 12;
key.shadow.camera.bottom = -12;
key.shadow.bias = -0.0008;
scene.add(key);
scene.add(new THREE.DirectionalLight(0x9fbcd8, 0.5).translateX(-6).translateY(4).translateZ(-8));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Ground: a plain shadow catcher plus a grid, so you can read the walk contact.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.32 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(60, 60, 0x3a4450, 0x272d35);
grid.material.transparent = true;
grid.material.opacity = 0.5;
scene.add(grid);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);
let model = null;
let rig = null;
let weights = null;
let skeletonHelper = null;
let restY = 0;

const state = {
  mode: "hover",     // hover | walk | fold | rest
  playing: true,
  time: 0,
  foldSlider: 0,
  selectedBone: null,
  manual: { flap: 0, sweep: 0, twist: 0 },
};

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
const MODEL_URL = "../assets/models/toothless_rigged.glb";
const loader = new GLTFLoader();

function loadModel(url) {
  el("loading").style.display = "";
  el("loading").textContent = "Loading model…";

  if (model) {
    scene.remove(model);
    model.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
  }
  if (skeletonHelper) {
    scene.remove(skeletonHelper);
    skeletonHelper = null;
  }
  model = null;
  rig = null;
  weights = null;
  state.selectedBone = null;

  loader.load(
    url,
    (gltf) => {
      model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      scene.add(model);

      rig = buildRig(model);
      weights = setupWeightView(rig);

      // Frame the model and sit it on the grid.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.position.y -= box.min.y;
      restY = model.position.y;
      controls.target.set(0, size.y * 0.5, 0);
      const dist = Math.max(size.x, size.y, size.z) * 1.6;
      camera.position.set(dist * 0.7, size.y * 0.8, dist);

      skeletonHelper = new THREE.SkeletonHelper(model);
      skeletonHelper.material.linewidth = 2;
      skeletonHelper.visible = el("toggle-skeleton").checked;
      scene.add(skeletonHelper);

      buildBoneList();
      el("stat-bones").textContent = rig.names.length;
      el("stat-verts").textContent = weights.vertexTotal.toLocaleString();
      const orphanPct = (weights.orphanTotal / weights.vertexTotal) * 100;
      el("stat-orphans").textContent =
        `${weights.orphanTotal.toLocaleString()} (${orphanPct.toFixed(1)}%)`;
      el("stat-orphans").className = orphanPct > 2 ? "bad" : "good";
      el("mirror-state").textContent =
        `L ${rig.foldSigns.L > 0 ? "+" : "−"}  R ${rig.foldSigns.R > 0 ? "+" : "−"}`;

      // Re-apply display toggles to the new meshes.
      if (el("toggle-weights").checked) weights.setActive(true);
      for (const m of rig.meshes) m.material.wireframe = el("toggle-wire").checked;

      el("loading").style.display = "none";
    },
    (p) => {
      if (p.total) {
        el("loading").textContent =
          `Loading model… ${Math.round((p.loaded / p.total) * 100)}%`;
      }
    },
    (e) => {
      el("loading").textContent = "Failed to load model — check the console.";
      console.error(e);
    }
  );
}

loadModel(MODEL_URL);

// ---------------------------------------------------------------------------
// Bone browser
// ---------------------------------------------------------------------------
function buildBoneList() {
  const sel = el("bone-select");
  sel.innerHTML = '<option value="">— none —</option>';
  for (const name of rig.names) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    state.selectedBone = sel.value || null;
    state.manual.flap = state.manual.sweep = state.manual.twist = 0;
    for (const a of ["flap", "sweep", "twist"]) {
      el(`manual-${a}`).value = 0;
      el(`manual-${a}-val`).textContent = "0.00";
    }
    refreshWeightReadout();
  });
}

function refreshWeightReadout() {
  const box = el("weight-readout");
  if (!state.selectedBone) {
    box.textContent = "Select a bone to inspect its influence.";
    return;
  }
  const s = weights.paint(state.selectedBone);
  if (!s) return;
  const pct = (s.influenced / weights.vertexTotal) * 100;
  const kids = rig.descendantCount(state.selectedBone);
  const total = rig.names.length;

  box.innerHTML =
    `<b>${s.influenced.toLocaleString()}</b> verts influenced (${pct.toFixed(2)}%)<br>` +
    `peak weight <b>${s.maxWeight.toFixed(2)}</b> · total <b>${s.totalWeight.toFixed(1)}</b><br>` +
    `carries <b>${kids}</b> / ${total} bones` +
    (s.influenced === 0
      ? '<br><span class="bad">No influence — this bone deforms nothing.</span>'
      : "") +
    (kids > total * 0.5
      ? '<br><span class="bad">Trunk bone — rotating this moves most of the skeleton.</span>'
      : "");
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
for (const btn of document.querySelectorAll("[data-mode]")) {
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode;
    for (const b of document.querySelectorAll("[data-mode]")) {
      b.classList.toggle("active", b === btn);
    }
    el("fold-row").style.display = state.mode === "fold" ? "" : "none";
  });
}

el("play").addEventListener("click", () => {
  state.playing = !state.playing;
  el("play").textContent = state.playing ? "Pause" : "Play";
});

el("toggle-skeleton").addEventListener("change", (e) => {
  if (skeletonHelper) skeletonHelper.visible = e.target.checked;
});

el("toggle-wire").addEventListener("change", (e) => {
  if (!rig) return;
  for (const m of rig.meshes) m.material.wireframe = e.target.checked;
});

el("toggle-weights").addEventListener("change", (e) => {
  if (!weights) return;
  weights.setActive(e.target.checked);
  el("toggle-wire").checked = false;
  if (e.target.checked) refreshWeightReadout();
});

el("toggle-grid").addEventListener("change", (e) => {
  grid.visible = e.target.checked;
  ground.visible = e.target.checked;
});

// Sliders bound straight to the params object.
for (const input of document.querySelectorAll("[data-param]")) {
  const name = input.dataset.param;
  input.value = params[name];
  const out = el(`${input.id}-val`);
  if (out) out.textContent = Number(params[name]).toFixed(2);
  input.addEventListener("input", () => {
    params[name] = parseFloat(input.value);
    if (out) out.textContent = params[name].toFixed(2);
  });
}

el("fold-slider").addEventListener("input", (e) => {
  state.foldSlider = parseFloat(e.target.value);
  el("fold-slider-val").textContent = state.foldSlider.toFixed(2);
});

for (const axis of ["flap", "sweep", "twist"]) {
  el(`manual-${axis}`).addEventListener("input", (e) => {
    state.manual[axis] = parseFloat(e.target.value);
    el(`manual-${axis}-val`).textContent = state.manual[axis].toFixed(2);
  });
}

el("mirror-flip").addEventListener("click", () => {
  params.wingSweepMirror *= -1;
  if (!rig) return;
  const s = params.wingSweepMirror;
  el("mirror-state").textContent =
    `L ${rig.foldSigns.L * s > 0 ? "+" : "−"}  R ${rig.foldSigns.R * s > 0 ? "+" : "−"}`;
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.playing) state.time += dt;

  if (rig) {
    rig.reset();

    let offset = { bob: 0, sway: 0, yaw: 0 };
    if (state.mode === "hover")      offset = hoverFlap(rig, state.time);
    else if (state.mode === "walk")  offset = walk(rig, state.time);
    else if (state.mode === "fold")  offset = foldPose(rig, state.foldSlider);
    else if (state.mode === "perch") offset = perch(rig, state.time);

    // Manual override composes on top of whatever the animation did, so you can
    // stress a joint mid-cycle and watch the skin react.
    if (state.selectedBone) {
      rig.pose(state.selectedBone, state.manual);
    }

    model.position.y = restY + offset.bob;
    model.position.x = offset.sway;
    model.rotation.y = offset.yaw;
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
