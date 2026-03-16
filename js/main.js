import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { setupDragonControls } from "./controls.js";
import { setupWorld } from "./world.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Third person camera state
let camYaw   = 0
let camPitch = 0.3;
const CAM_DIST      = 14;
const CAM_SENSITIVITY = 0.003;

document.addEventListener("click", () => document.body.requestPointerLock());
window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== document.body) return;
  
  camYaw   -= e.movementX * CAM_SENSITIVITY;
  camPitch -= e.movementY * CAM_SENSITIVITY;

  // Clamp slightly BEFORE 90 degrees (1.57 is roughly PI/2)
  // Use 1.5 radians to stay safe and avoid the "flicker zone"
  const limit = 1.5; 
  camPitch = Math.max(-limit, Math.min(limit, camPitch));
});

const clouds = setupWorld(scene);

let updateDragon = () => {};
let dragon = null;
let wingLeft  = null;
let wingRight = null;
let tick = 0;

const loader = new GLTFLoader();
loader.load(
  "./assets/models/dragon_rigged.glb",
  (gltf) => {
    dragon = gltf.scene;
    dragon.position.set(0, 5, 0);
    scene.add(dragon);

    let skel = null;
    dragon.traverse((obj) => {
      if (obj.isSkinnedMesh) skel = obj.skeleton;
    });

    if (skel) {
      wingLeft  = skel.getBoneByName("Bone004");
      wingRight = skel.getBoneByName("Bone005");
    }

    updateDragon = setupDragonControls(dragon, () => camYaw);
  },
  undefined,
  (e) => console.error(e)
);

function animate() {
  requestAnimationFrame(animate);
  tick++;

  updateDragon();

    if (dragon) {
    // 1. Calculate the horizontal radius (how far away from the center)
    // As pitch goes up, horizontalDist gets smaller (camera moves inward)
    const horizontalDist = CAM_DIST * Math.cos(camPitch);
    const verticalDist = CAM_DIST * Math.sin(camPitch);

    // 2. Apply the coordinates
    const tx = dragon.position.x + horizontalDist * Math.sin(camYaw);
    const ty = dragon.position.y + verticalDist + 2; // +2 to stay above ground
    const tz = dragon.position.z + horizontalDist * Math.cos(camYaw);

    camera.position.set(tx, ty, tz);
    
    // 3. Look slightly above the dragon's feet
    camera.lookAt(dragon.position.x, dragon.position.y + 1, dragon.position.z);
    }

  clouds.forEach(c => c.position.x += 0.01);

  if (wingLeft && wingRight) {
    const flap = Math.sin(tick * 0.05) * 0.3;
    wingLeft.rotation.set(0,  flap,  Math.PI / 2);
    wingRight.rotation.set(0, -flap, -Math.PI / 2);
  }

  renderer.render(scene, camera);
}

animate();