// ---------------------------------------------------------------------------
// How big the world is, on its own so that modules terrain.js imports (the
// Berk layout) can know it without importing terrain.js. See terrain.js.
//
//   WORLD_SCALE  how much bigger every island is than the old ten-kilometre
//                chart drew it
//   PEAK_SCALE   ...and how much taller its summits
//   SPREAD       how much further apart the islands stand again, on top of
//                WORLD_SCALE: the sea between them
//   CHART_SCALE  old-chart positions to metres
// ---------------------------------------------------------------------------
export const WORLD_SCALE = 3;
export const PEAK_SCALE = 1.5;
export const SPREAD = 1.5;
export const CHART_SCALE = WORLD_SCALE * SPREAD;
