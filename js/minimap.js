import { terrainHeight, TERRAIN_SIZE, SEA_LEVEL, pitPaths } from "./terrain.js";

// ---------------------------------------------------------------------------
// The minimap.
//
// Top right, always on in flight: a disc of the ground round him, turned so
// that where he is heading is up, with:
//   - the objective — a marker where it is, or pinned to the rim with its
//     distance when it is off the disc;
//   - places he has found;
//   - the forest trails into the hunters' pit, dotted, so the way through the
//     trees is a path you can follow and not a guess;
//   - hunters nearby, with which way each is facing — amber when suspicious,
//     red when he has seen you;
//   - N, E, S and W round the rim, turning with him;
//   - his X, altitude and Z underneath.
//
// The ground image is baked once from the height field, a few rows a frame
// after load so it never stalls a frame.
// ---------------------------------------------------------------------------

const BAKE = 448;                 // texels across the whole archipelago
const HALF = TERRAIN_SIZE / 2;

function colourAt(h) {
  if (h < SEA_LEVEL - 30) return [16, 30, 48];
  if (h < SEA_LEVEL - 4) return [22, 46, 66];
  if (h < SEA_LEVEL) return [36, 70, 86];
  if (h < 6) return [128, 120, 92];
  if (h < 90) return [58, 86, 52];
  if (h < 200) return [74, 90, 60];
  if (h < 320) return [104, 100, 88];
  return [206, 214, 222];
}

/**
 * @param {object} o
 *   getPlayer()      {x, y, z, heading} or null
 *   getObjective()   {x, z, label} or null
 *   getSites()       [{x, z, label, found}]
 *   getHunters()     [{pos, yaw, state, ko, inside}] or null
 */
export function setupMinimap({ getPlayer, getObjective, getSites, getHunters }) {
  const wrap = document.createElement("div");
  wrap.id = "minimap";
  wrap.innerHTML = `<canvas></canvas><div class="mm-xyz"></div>`;
  document.body.appendChild(wrap);
  const canvas = wrap.querySelector("canvas");
  const xyz = wrap.querySelector(".mm-xyz");
  const g = canvas.getContext("2d");

  // --- Bake ---------------------------------------------------------------
  const base = document.createElement("canvas");
  base.width = base.height = BAKE;
  const bg = base.getContext("2d");
  const img = bg.createImageData(BAKE, BAKE);
  let row = 0;
  function bakeSome() {
    const end = Math.min(BAKE, row + 12);
    for (; row < end; row++) {
      const z = -HALF + (row + 0.5) / BAKE * TERRAIN_SIZE;
      for (let i = 0; i < BAKE; i++) {
        const x = -HALF + (i + 0.5) / BAKE * TERRAIN_SIZE;
        const h = terrainHeight(x, z);
        // A touch of hill shading from the next sample east.
        const he = terrainHeight(x + TERRAIN_SIZE / BAKE, z);
        const shade = Math.max(0.7, Math.min(1.25, 1 + (h - he) * 0.02));
        const [r, gg, b] = colourAt(h);
        const k = (row * BAKE + i) * 4;
        img.data[k] = r * (h > 0 ? shade : 1); img.data[k + 1] = gg * (h > 0 ? shade : 1);
        img.data[k + 2] = b * (h > 0 ? shade : 1); img.data[k + 3] = 255;
      }
    }
    if (row < BAKE) setTimeout(bakeSome, 0);
    else bg.putImageData(img, 0, 0);
  }
  setTimeout(bakeSome, 1500);

  let size = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.round(Math.max(150, Math.min(220, Math.min(window.innerWidth, window.innerHeight) * 0.24)));
    canvas.style.width = canvas.style.height = `${size}px`;
    canvas.width = canvas.height = Math.round(size * dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  let range = 700;                 // metres from centre to rim
  let visible = true;

  function update(dt, { speed = 0, flying = true } = {}) {
    if (!visible) return;
    const p = getPlayer();
    if (!p) return;
    // Zoom out with speed and height, so you see further when you go further.
    const want = flying ? 600 + Math.min(1600, speed * 4 + Math.max(0, p.agl ?? 0) * 1.2) : 260;
    range += (want - range) * Math.min(1, dt * 1.5);

    const R = size / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#101e30"; g.fillRect(0, 0, size, size);

    // Heading-up: his nose is (sin h, cos h) in x/z; on screen x is right and
    // +z is down, so turn the world by this to put his nose straight up.
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(p.heading), Math.sin(p.heading));
    const k = R / range;                                 // px per metre
    const toScreen = (x, z) => {
      const dx = (x - p.x) * k, dz = (z - p.z) * k;
      const c = Math.cos(rot), s = Math.sin(rot);
      return [R + dx * c - dz * s, R + dx * s + dz * c];
    };

    g.save();
    g.translate(R, R);
    g.rotate(rot);
    const texPerM = BAKE / TERRAIN_SIZE;
    g.imageSmoothingEnabled = true;
    g.drawImage(base,
      (p.x + HALF) * texPerM - range * texPerM, (p.z + HALF) * texPerM - range * texPerM,
      range * 2 * texPerM, range * 2 * texPerM,
      -R, -R, size, size);
    g.restore();

    // Forest trails into the pit, dotted.
    g.setLineDash([3, 4]);
    g.strokeStyle = "rgba(170, 230, 140, 0.9)";
    g.lineWidth = 2;
    for (const path of pitPaths()) {
      g.beginPath();
      for (let i = 0; i < path.x.length; i += 2) {
        const [sx, sy] = toScreen(path.x[i], path.z[i]);
        if (i === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
      }
      g.stroke();
    }
    g.setLineDash([]);

    // Sites found.
    for (const s of getSites() || []) {
      if (!s.found) continue;
      const [sx, sy] = toScreen(s.x, s.z);
      g.strokeStyle = "rgba(236, 200, 150, 0.9)"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(sx - 4, sy - 4); g.lineTo(sx + 4, sy + 4); g.moveTo(sx + 4, sy - 4); g.lineTo(sx - 4, sy + 4); g.stroke();
    }

    // Hunters within range: a dot and a facing tick.
    const men = getHunters?.() || [];
    for (const m of men) {
      if (m.inside || m.ko > 0) continue;
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      if (d > range) continue;
      const [sx, sy] = toScreen(m.pos.x, m.pos.z);
      const col = m.state === "alert" ? "#ff4a3a" : m.state === "calm" || !m.state ? "#e8e2d4" : "#ffb03a";
      const [fx, fy] = toScreen(m.pos.x + Math.sin(m.yaw) * range * 0.06, m.pos.z + Math.cos(m.yaw) * range * 0.06);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(fx, fy); g.stroke();
      g.beginPath(); g.arc(sx, sy, 2.4, 0, Math.PI * 2); g.fill();
    }

    // The objective: on the disc, or pinned to the rim.
    const o = getObjective();
    if (o) {
      let [sx, sy] = toScreen(o.x, o.z);
      const dx = sx - R, dy = sy - R, dd = Math.hypot(dx, dy);
      const off = dd > R - 12;
      if (off) { sx = R + dx / dd * (R - 12); sy = R + dy / dd * (R - 12); }
      g.fillStyle = "#ff7a28"; g.strokeStyle = "#ff7a28";
      g.shadowColor = "rgba(255,120,40,.8)"; g.shadowBlur = 6;
      if (off) {
        const a = Math.atan2(dy, dx);
        g.save(); g.translate(sx, sy); g.rotate(a);
        g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -5); g.lineTo(-5, 5); g.closePath(); g.fill();
        g.restore();
      } else {
        g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(sx, sy, 2, 0, Math.PI * 2); g.fill();
      }
      g.shadowBlur = 0;
    }

    // Him, in the middle, nose up.
    g.fillStyle = "#ffffff";
    g.beginPath(); g.moveTo(R, R - 8); g.lineTo(R + 5.5, R + 6); g.lineTo(R, R + 3); g.lineTo(R - 5.5, R + 6); g.closePath(); g.fill();
    g.restore();

    // Rim and compass letters, turning with him.
    g.strokeStyle = "rgba(236, 230, 216, 0.35)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
    g.font = "700 12px Rajdhani, system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    // North is world -z.
    for (const [lbl, x, z] of [["N", 0, -1], ["E", 1, 0], ["S", 0, 1], ["W", -1, 0]]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const vx = x * c - z * s, vy = x * s + z * c;
      const tx = R + vx * (R - 10), ty = R + vy * (R - 10);
      g.fillStyle = "rgba(10, 14, 22, 0.75)";
      g.beginPath(); g.arc(tx, ty, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = lbl === "N" ? "#ff7a28" : "rgba(236, 230, 216, 0.85)";
      g.fillText(lbl, tx, ty + 0.5);
    }

    xyz.innerHTML = `<span><b>X</b> ${Math.round(p.x)}</span><span><b>Y</b> ${Math.round(p.y)}</span><span><b>Z</b> ${Math.round(p.z)}</span>`;
  }

  return {
    update,
    setVisible(v) { visible = !!v; wrap.style.display = v ? "" : "none"; },
  };
}
