// ---------------------------------------------------------------------------
// A rim of sky light round the dragon.
//
// He is near-black, and most of what he is seen against — cloud, a slate sea,
// a hazy island, anything at night — is a dark grey. Flat-lit, he dissolved
// into it: you could lose the one thing you are steering. The films light him
// the way every black creature on screen is lit, with a thin cool edge where
// his surface turns away from the camera, and this is that.
//
// It is the hemisphere light's sky colour, so it is already the right colour
// and brightness for the hour — pale by day, a faint moonlit blue at night —
// and needs nothing driving it. Grazing angles only, so his face and the top
// of his back keep their own shading.
// ---------------------------------------------------------------------------

const RIM_POWER = 3.0;

/**
 * Patch every lit material under `root` once.
 * @param {THREE.Object3D} root
 * @param {number} [strength]  how much of the sky's irradiance the edge gets
 */
export function addRimLight(root, strength = 0.8) {
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || seen.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial)) continue;
      seen.add(m);
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
          #if NUM_HEMI_LIGHTS > 0
          {
            float rimK = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.directDiffuse += hemisphereLights[ 0 ].skyColor
              * pow( rimK, ${RIM_POWER.toFixed(1)} ) * ${strength.toFixed(3)};
          }
          #endif`);
      };
      const key = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () => (key ? key() : "") + "|rim";
      m.needsUpdate = true;
    }
  });
}
