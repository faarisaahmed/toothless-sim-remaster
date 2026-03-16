import * as THREE from "three";

export function setupWorld(scene) {
  // Ground
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x228B22 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);

  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  // Sun / directional light
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(5, 10, 5);
  scene.add(sun);

  // Clouds array
  const clouds = [];

  function addCloud(x, y, z, size = 2) {
    const geo = new THREE.SphereGeometry(size, 16, 16);
    const mat = new THREE.MeshPhongMaterial({ color: 0xffffff });
    const cloud = new THREE.Mesh(geo, mat);
    cloud.position.set(x, y, z);
    scene.add(cloud);
    clouds.push(cloud);
  }

  // Add a few sample clouds
  addCloud(5, 5, -10);
  addCloud(-7, 6, -15);
  addCloud(10, 7, -20);

  return clouds; // so main.js can animate them
}