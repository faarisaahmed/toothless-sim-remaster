// Render the dragon as a flat top-down silhouette, for the favicon.
//
// The icon is built from THIS dragon rather than from a drawing of one, and
// this is the probe that gets him out of the game: it hides everything in the
// scene except him, swaps every material for flat white, points an orthographic
// camera straight down, and renders to a transparent 512 square. What comes
// back is a clean alpha mask — the wing PLAN, which is the shape everybody
// recognises and the only one that survives being sixteen pixels wide.
//
// Orthographic on purpose: a perspective camera foreshortens the far wing and
// the silhouette comes out subtly lopsided.
//
//   node tools/inspect.mjs --watch 24 --eval "$(cat tools/icon_silhouette.js)"
//
// then decode the returned data URL into assets/icon/dragon-plan.png and run
// tools/make_icons.py. Only needed again if the model changes.

(async () => {
  const THREE = await import("three");
  const { dragon } = window.__na;
  const scene = dragon?.parent;
  if (!dragon) return "no dragon";

  // Everything but him, out of the way. Restored below.
  const hidden = [];
  for (const child of scene.children) {
    if (child !== dragon && child.visible) { hidden.push(child); child.visible = false; }
  }

  // Straight down on him, orthographic, so the silhouette is the wing PLAN and
  // not a perspective of it. That is the shape everybody recognises.
  const box = new THREE.Box3().setFromObject(dragon);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const half = Math.max(size.x, size.z) * 0.56;      // a little margin
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 4000);
  cam.position.set(mid.x, mid.y + 600, mid.z);
  cam.up.set(0, 0, -1);                               // nose toward the top
  cam.lookAt(mid);

  // A fresh renderer at icon resolution with a transparent clear, so what comes
  // back is a clean alpha mask rather than a dragon on a sky.
  const S = 512;
  const r2 = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r2.setSize(S, S, false);
  r2.setClearColor(0x000000, 0);
  // Flat white, unlit, so every lit pixel is "dragon" and nothing is lost to
  // shading — the colour comes later, in the icon itself.
  const swapped = [];
  dragon.traverse((o) => {
    if (o.isMesh) {
      swapped.push([o, o.material]);
      o.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    }
  });
  r2.render(scene, cam);
  const url = r2.domElement.toDataURL("image/png");

  for (const [o, m] of swapped) o.material = m;
  for (const c of hidden) c.visible = true;
  r2.dispose();
  return url;
})()
