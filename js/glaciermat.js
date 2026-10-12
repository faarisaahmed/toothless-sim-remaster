
// ---------------------------------------------------------------------------
// Glacier ice in the ground material.
//
// The vertex paint (groundpaint.js) gives the ice its colour and its moraines,
// but it is per vertex, and what makes ice read as ice is finer than that:
// crevasses — dark blue slots a metre or two wide and thirty or forty apart,
// running across the flow and bowed down-glacier in the middle where the ice
// moves fastest — and a surface that shines. The shader draws those per
// pixel from where it is on the glacier: distance down it, position across
// it, how crevassed it is there, and how much of the ground is bare ice.
// ---------------------------------------------------------------------------

// Not a texture: the terrain shader is at the limit of sixteen samplers. The
// fields ride on the fine chunks as two vertex attributes instead
// (terrainworker.js), which works because they are smooth — distance down and
// across a glacier interpolate across a triangle almost exactly — and the
// crevasses are drawn per pixel off the interpolated values. The coarse sheet
// does not carry them; its default is "no ice", and from that far out the
// vertex paint is all there is to see anyway.

/** Values for the attributes on geometry that does not have them. */
export const ICE_ATTR_DEFAULTS = { aIceS: [0], aIceP: [0, 0, 0, 0] };

export const ICE_VERT_PARS = /* glsl */`
  attribute float aIceS;
  attribute vec4 aIceP;
  varying float vIceS;
  varying vec4 vIceP;
`;
export const ICE_VERT_MAIN = /* glsl */`
  vIceS = aIceS;
  vIceP = aIceP;
`;

export const ICE_GLSL_PARS = /* glsl */`
  varying float vIceS;
  varying vec4 vIceP;

  // A thin line at every whole period of ph, antialiased, and greyed out to
  // its own average once the period is too fine to resolve.
  float iceLine( float ph, float halfW ) {
    float aa = fwidth( ph );
    float d = abs( fract( ph / 6.2832 ) - 0.5 ) * 6.2832;
    float l = 1.0 - smoothstep( halfW - aa, halfW + aa, d );
    return mix( l, halfW / 3.1416, smoothstep( 0.6, 2.5, aa ) );
  }
`;

// Runs after the ground's albedo, roughness and normal are settled. Expects
// vWPos, macro, albedo, rough, wNormal, slope, dist from the terrain shader.
export const ICE_GLSL_MAIN = /* glsl */`
  {
    float bare = vIceP.y;
    if ( bare > 0.01 ) {
      float cap = step( 50000.0, vIceS );
      float sAl = vIceS - cap * 100000.0;
      float iu = vIceP.x * 4.0 - 2.0;
      float crev = vIceP.z;
      float wn = texture2D( tScreeD, vWPos.xz * 0.0031 ).g * uInvMean[ 1 ].g - 1.0;
      // Grain from the snow photograph, as luminance only: bare ice is
      // smooth, but it is not plastic.
      float grain = dot( texture2D( tSnowD, vWPos.xz * 0.043 ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) * uInvMean[ 5 ].g;
      vec3 ice = macro * mix( 1.0, grain, 0.3 );
      // Ogives: the faint light and dark arcs that come down from an
      // icefall, a year's movement apart.
      ice *= 1.0 + sin( sAl * 0.055 - iu * iu * 3.2 + wn * 2.0 ) * 0.05 * ( 1.0 - cap );
      // Crevasses. Across the flow, bowed down-glacier in the middle; their
      // spacing wanders, and they come in pieces, not as ruled lines.
      float ph = sAl * ( 6.2832 / 36.0 ) - iu * iu * 2.6 + wn * 5.0;
      float seg = smoothstep( 0.85, 1.15, texture2D( tScreeD, vec2( iu * 2.3, sAl * 0.006 ) ).g * uInvMean[ 1 ].g );
      float cr = iceLine( ph, 0.36 ) * seg * crev;
      // Marginal crevasses: the edges drag, and the ice tears at an angle to
      // them, pointing up-glacier.
      float edge = smoothstep( 0.62, 0.92, abs( iu ) ) * ( 1.0 - cap );
      float ph2 = sAl * ( 6.2832 / 30.0 ) + abs( iu ) * 22.0 + wn * 4.0;
      cr = max( cr, iceLine( ph2, 0.3 ) * edge * 0.8 );
      cr *= 1.0 - smoothstep( 2500.0, 6000.0, dist );
      vec3 deep = vec3( 0.035, 0.13, 0.25 );
      ice = mix( ice, deep, cr * 0.85 );
      // Ice cliffs and steep ice: the clean blue of ice that has just been
      // exposed, streaked where meltwater runs down it.
      float steep = smoothstep( 0.35, 0.85, slope );
      float streak = texture2D( tScreeD, vec2( dot( vWPos.xz, vec2( 0.7, 0.7 ) ) * 0.05, vWPos.y * 0.004 ) ).g * uInvMean[ 1 ].g;
      vec3 face = vec3( 0.36, 0.56, 0.72 ) * ( 0.8 + 0.3 * streak );
      ice = mix( ice, face, steep * 0.75 );
      albedo = mix( albedo, ice, bare );
      rough = mix( rough, mix( 0.28, 0.75, cr ), bare );
    }
  }
`;
