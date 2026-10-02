import { buildShape, buildDetail, buildWeather } from "./cloudnoise.js";

// Builds the cloud noise off the main thread — about a second of arithmetic
// that would otherwise land as one long frame during the load. See cloudnoise.js.
self.onmessage = () => {
  const weather = buildWeather();
  self.postMessage({ kind: "weather", data: weather }, [weather.buffer]);
  const shape = buildShape();
  const detail = buildDetail();
  self.postMessage({ kind: "volume", shape, detail }, [shape.buffer, detail.buffer]);
};
