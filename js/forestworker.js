import { scatterTile } from "./forestscatter.js";

// ---------------------------------------------------------------------------
// The forest's scatter, off the main thread: one 625 m tile per message.
//
// Message in:  { id, tx, tz }
// Message out: { id, tx, tz, spots: F32 (forestscatter.js SPOT per tree),
//                boulders: F32 (BOULDER per boulder) }, both transferred.
// ---------------------------------------------------------------------------

self.onmessage = ({ data }) => {
  const { id, tx, tz } = data;
  const { spots, boulders } = scatterTile(tx, tz);
  self.postMessage({ id, tx, tz, spots, boulders }, [spots.buffer, boulders.buffer]);
};
