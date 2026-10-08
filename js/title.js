import * as THREE from "three";
import { loadDragon, normalizeDragon } from "./assets.js";
import * as input from "./input.js";
import { music } from "./audio.js";
import * as saves from "./saves.js";
import { createSettingsPanel } from "./settingspanel.js";
import { CHAPTER_LIST, STORY_TITLE } from "./storyline.js";
import { addNightSky } from "./nightsky.js";

// ---------------------------------------------------------------------------
// Title screen
//
// Its own renderer and its own scene, torn down completely when the player
// picks a slot. That isolation is worth a second WebGL context: nothing here
// has to know the flight sim exists, and the flight sim doesn't have to be
// loaded before the player has decided to play.
//
// The backdrop is a night sea under a low moon with him circling out over the
// water in silhouette. It is doing one job — establishing that this game is
// about a small dark shape a long way from anything.
// ---------------------------------------------------------------------------

// Low and well off to the left, so it lights the frame without sitting behind
// the title. The moon is the only source in the scene; where it goes decides
// where the sea's glitter path goes too.
// Left and UP. It was at y 0.10, which put the disc down at the waterline and
// squarely behind the save-slot list — the one bright object in the frame,
// hidden by the furniture. Raising it also lifts the sea's glint lane and the
// dragon's orbit, both of which are derived from this.
// And now RIGHT: the menu moved to a left-hand column, and the moon — the one
// bright thing in the frame — belongs in the half of the screen that is
// picture rather than behind the furniture.
const MOON_DIR = new THREE.Vector3(0.62, 0.40, -1).normalize();

// --- Sea --------------------------------------------------------------------
// A plane and a shader. Cheap, and a real water sim would be louder than the
// scene wants — what matters is the moon path, because that's the only thing
// separating sea from sky at this light level.
const SEA_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SEA_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uGlint;
  uniform vec2 uLaneDir;
  varying vec2 vUv;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  void main() {
    // Chop, running slowly toward the camera.
    vec2 p = vWorld.xz * 0.035;
    float w = noise(p + vec2(0.0, uTime * 0.18)) * 0.6
            + noise(p * 2.7 - vec2(uTime * 0.09, 0.0)) * 0.3
            + noise(p * 6.1 + vec2(uTime * 0.26, uTime * 0.05)) * 0.1;

    // The moon path. It has to run along the moon's actual bearing — a glitter
    // lane straight up the middle with the moon off to one side reads as a
    // mistake even to someone who couldn't say why.
    float perp = vWorld.x * uLaneDir.y - vWorld.z * uLaneDir.x;
    float lane = exp(-pow(perp * 0.0022, 2.0));
    float glint = pow(smoothstep(0.62, 0.98, w), 3.0) * lane;

    // Horizon haze so the plane's far edge never becomes a hard line.
    float far = smoothstep(-1400.0, -120.0, vWorld.z);

    vec3 col = uDeep + uGlint * glint * 1.7;
    col = mix(uDeep * 1.35, col, far);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function runTitle(pad = null) {
  music.play("title");
  return new Promise((resolve) => {
    // --- DOM ----------------------------------------------------------------
    // One stage, one panel. The panel's contents swap between screens — the
    // main menu, the save slots, a slot's actions, its chapters, the settings —
    // and the breadcrumb over it says where you are.
    const root = document.createElement("div");
    root.id = "title";
    root.innerHTML = `
      <canvas id="title-canvas"></canvas>
      <div class="title-vignette"></div>
      <div class="title-stage">
        <header class="title-mark">
          <div class="title-over">A dragon alone, in the year before</div>
          <h1 class="title-name"><span>Night</span><span>Alone</span></h1>
          <div class="title-rule"></div>
          <div class="title-sub">Mission One &mdash; ${STORY_TITLE}</div>
        </header>

        <section class="title-panel ui-panel" id="title-panel">
          <div class="tp-head">
            <div class="ui-eyebrow" id="tp-crumb"></div>
            <h2 class="ui-title" id="tp-title"></h2>
          </div>
          <div class="tp-body" id="tp-body"></div>
        </section>

        <footer class="title-foot ui-legend" id="title-legend"></footer>
      </div>
      <div class="title-confirm" id="title-confirm" hidden>
        <div class="confirm-card ui-panel">
          <div class="ui-eyebrow">Delete</div>
          <div class="confirm-head">Delete this journey?</div>
          <div class="confirm-body" id="confirm-body"></div>
          <div class="confirm-actions">
            <button type="button" class="ui-btn ghost" data-c="no">Keep it</button>
            <button type="button" class="ui-btn danger" data-c="yes">Delete</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    document.body.classList.add("in-title");

    const panel = root.querySelector("#title-panel");
    const crumbEl = root.querySelector("#tp-crumb");
    const titleEl = root.querySelector("#tp-title");
    const bodyEl = root.querySelector("#tp-body");
    const legendEl = root.querySelector("#title-legend");
    const confirmEl = root.querySelector("#title-confirm");
    const confirmBody = root.querySelector("#confirm-body");

    // --- Three --------------------------------------------------------------
    const canvas = root.querySelector("#title-canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    // Light fog. Enough to lose the far sea into the sky, not enough to eat the
    // dragon — at 0.0016 he was down to half contrast before he'd even arrived.
    scene.fog = new THREE.FogExp2(0x0a1120, 0.00075);

    const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1, 6000);
    camera.position.set(0, 34, 190);
    camera.lookAt(0, 46, -400);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    // Sky: a big inverted sphere with a vertical gradient, so the moon has
    // something to sit in that isn't flat black.
    const skyGeo = new THREE.SphereGeometry(4000, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x03050b) },
        uBottom: { value: new THREE.Color(0x121c2e) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP;
        void main(){
          float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.75)), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;      // paint it first; everything else sits on top
    scene.add(sky);

    // Moon — a disc plus a soft falloff halo. It is the only real light in the
    // frame, so it has to be big enough to read as a source: at 120 units from
    // 2600 away it was a pinprick, and the halos read as a dark smudge.
    const moonGroup = new THREE.Group();
    const moonPos = MOON_DIR.clone().multiplyScalar(2600);
    moonGroup.position.copy(moonPos);

    // depthTest off on both, with an explicit renderOrder. The disc and the
    // halo sit at the same depth, and letting the depth buffer arbitrate gave
    // radial z-fighting spokes straight out of the triangle fan.
    const moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(110, 64),
      new THREE.MeshBasicMaterial({
        color: 0xf2f6ff, fog: false, depthTest: false, depthWrite: false,
      })
    );
    moonDisc.renderOrder = 2;
    moonGroup.add(moonDisc);

    // Halo as a real gradient rather than stacked flat discs — flat additive
    // circles have a hard edge that reads as a ring, which is worse than none.
    const haloTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0.00, "rgba(210,226,255,0.85)");
      grad.addColorStop(0.18, "rgba(160,190,245,0.30)");
      grad.addColorStop(0.45, "rgba(120,155,220,0.10)");
      grad.addColorStop(1.00, "rgba(90,120,190,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1700, 1700),
      new THREE.MeshBasicMaterial({
        map: haloTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false, fog: false, opacity: 0.85,
      })
    );
    halo.renderOrder = 1;
    moonGroup.add(halo);

    // Face the camera, not the origin: off to the side of the frame, a disc
    // turned towards the middle of the world reads as an egg.
    moonGroup.lookAt(0, 34, 190);
    scene.add(moonGroup);

    // Sea
    const seaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x111c31) },
        uGlint: { value: new THREE.Color(0xbcd2f5) },
        uLaneDir: { value: new THREE.Vector2(MOON_DIR.x, MOON_DIR.z).normalize() },
      },
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -30;
    scene.add(sea);

    // Stars, the island bands, the aurora and the horizon haze. Everything in
    // the frame that is not the moon, the sea, the clouds or him.
    // NOT `sky` — that is the gradient sphere above, and shadowing it is a
    // SyntaxError that takes the whole module graph down without a word.
    const night = addNightSky(scene, MOON_DIR);

    // Lights. One cold key from the moon, one very dim fill so the silhouette
    // doesn't go completely to paste.
    const key = new THREE.DirectionalLight(0xbfd0f5, 2.6);
    key.position.copy(moonPos);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x22304d, 0x05070c, 0.5));

    // Rim from behind and below, cold and weak. Without it he's a hole in the
    // frame rather than a shape — a silhouette still needs one lit edge to be
    // legible as an animal.
    const rim = new THREE.DirectionalLight(0x8fb0ee, 3.4);
    rim.position.set(-600, -80, -1400);
    scene.add(rim);

    // Clouds — a few big soft planes drifting across the moon.
    const cloudTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(128, 128, 10, 128, 128, 126);
      grad.addColorStop(0, "rgba(255,255,255,0.5)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.16)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();

    const clouds = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: cloudTex, transparent: true, depthWrite: false,
          opacity: 0.10 + Math.random() * 0.16, color: 0x8ea4cc,
        })
      );
      const s = 340 + Math.random() * 700;
      m.scale.set(s, s * (0.42 + Math.random() * 0.3), 1);
      m.position.set(
        -1400 + Math.random() * 2800,
        60 + Math.random() * 320,
        -400 - Math.random() * 1600
      );
      m.userData.drift = 4 + Math.random() * 9;
      scene.add(m);
      clouds.push(m);
    }

    // --- Him ----------------------------------------------------------------
    let dragon = null;
    let dragonReady = false;

    loadDragon().then(({ gltf, path }) => {
      dragon = gltf.scene;

      // Silhouette treatment: near-black, slightly rough, so the moon rakes a
      // rim off the leading edges and nothing else reads at all.
      dragon.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return;
        o.frustumCulled = false;
        o.material = new THREE.MeshStandardMaterial({
          color: 0x151a24, roughness: 0.46, metalness: 0.0,
        });
      });

      // Same Z-up correction as the room, at title scale. Without it he came
      // out standing on his tail, which reads as a smear rather than a dragon.
      dragon = normalizeDragon(dragon, 150, path);
      scene.add(dragon);
      dragonReady = true;
    }).catch((e) => console.warn("title: no dragon model", e));

    // --- Menu -----------------------------------------------------------------
    let slots = saves.list();
    let screen = "main";
    let cursor = 0;
    let slotSel = 0;          // which slot the slot / chapter screens are about
    let confirming = false;
    let confirmSel = 0;
    let done = false;
    const settingsPanel = createSettingsPanel("title");

    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

    /** The items on the current screen: { html, act, disabled? }. */
    function items() {
      if (screen === "main") {
        const out = [];
        const last = saves.latest();
        if (last >= 0 && slots[last] && !slots[last].damaged) {
          const sv = slots[last];
          out.push({
            label: "Continue",
            sub: `${esc(saves.sceneTitle(sv))} &nbsp;·&nbsp; Journey ${last + 1} &nbsp;·&nbsp; ${saves.playtime(sv)}`,
            act: () => begin({ mode: "story", slot: last, save: sv, isNew: false }),
          });
        }
        out.push({ label: "Story", sub: "Four journeys. Begin one, continue one, or replay a chapter.",
                   act: () => go("story") });
        out.push({ label: "Free Flight", sub: "The whole archipelago, and no story. Find every island.",
                   act: () => begin({ mode: "free" }) });
        out.push({ label: "Settings", sub: "Graphics, controls and sound.", act: () => go("settings") });
        return out;
      }
      if (screen === "story") {
        return [
          ...slots.map((sv, i) => sv ? {
            slot: i, sv,
            label: `Journey ${i + 1} <span class="slot-file">${saves.fileName(i)}</span>`,
            sub: sv.damaged ? "This file could not be read — fix it in Local Storage, or delete it." : `${esc(saves.sceneTitle(sv))} &nbsp;·&nbsp; Day ${sv.day} &nbsp;·&nbsp; ${saves.playtime(sv)} &nbsp;·&nbsp; ${saves.lastPlayed(sv)}`,
            pct: Math.round(saves.progress(sv) * 100),
            act: () => { slotSel = i; go("slot"); },
          } : {
            slot: i, label: `Journey ${i + 1} <span class="slot-file">${saves.fileName(i)}</span>`, sub: "Empty &mdash; begin a new story here", empty: true,
            act: () => begin({ mode: "story", slot: i, save: saves.create(i), isNew: true }),
          }),
          { label: "Back", back: true, act: () => go("main") },
        ];
      }
      if (screen === "slot") {
        const sv = slots[slotSel];
        return [
          { label: sv?.finished ? "Fly on" : "Continue",
            sub: sv?.finished ? "The story is done. Pick up where it ended." : `From ${esc(saves.sceneTitle(sv))}`,
            act: () => begin({ mode: "story", slot: slotSel, save: sv, isNew: false }) },
          { label: "Chapters", sub: "Replay any chapter this journey has reached.", act: () => go("chapters") },
          { label: "Export save", sub: `Download ${saves.fileName(slotSel)} — plain text you can edit.`, act: () => saves.exportSlot(slotSel) },
          { label: "Import save", sub: `Replace this journey with a .dat file.`, act: async () => {
              if (await saves.importSlot(slotSel)) { slots = saves.list(); render(); }
            } },
          { label: "Delete", sub: "Remove this journey. Asks first.", danger: true, act: () => askErase() },
          { label: "Back", back: true, act: () => go("story") },
        ];
      }
      if (screen === "chapters") {
        const sv = slots[slotSel];
        const open = new Set(saves.unlockedChapters(sv));
        const doneSet = new Set(sv?.chapters || []);
        return [
          ...CHAPTER_LIST.map((c) => ({
            label: `<span class="ch-n">${c.n}</span>${c.title}`,
            sub: open.has(c.id) ? esc(c.blurb) : "Not reached yet",
            disabled: !open.has(c.id),
            tag: doneSet.has(c.id) ? "Done" : open.has(c.id) ? "Play" : "&#128274;",
            act: () => begin({ mode: "story", slot: slotSel, save: sv, isNew: false, chapter: c.id }),
          })),
          { label: "Back", back: true, act: () => go("slot") },
        ];
      }
      return [];
    }

    const HEADS = {
      main:     ["", "Begin"],
      story:    ["Story", "Choose a journey"],
      slot:     ["Story", ""],
      chapters: ["Story", "Chapters"],
      settings: ["", "Settings"],
    };

    function render() {
      const [crumb, title] = HEADS[screen];
      crumbEl.textContent = screen === "slot" || screen === "chapters"
        ? `Story · Journey ${slotSel + 1}` : crumb;
      titleEl.textContent = screen === "slot" ? saves.sceneTitle(slots[slotSel]) : title;
      panel.dataset.screen = screen;
      // Past the main menu the name steps back, so the panel has the room.
      root.querySelector(".title-stage").classList.toggle("compact", screen !== "main");

      if (screen === "settings") {
        if (!bodyEl.contains(settingsPanel.el)) {
          bodyEl.innerHTML = "";
          bodyEl.appendChild(settingsPanel.el);
        }
        settingsPanel.render();
      } else {
        const list = items();
        bodyEl.innerHTML = `<ul class="ui-menu tp-menu">${list.map((it, i) => `
          <li class="ui-item${i === cursor ? " on" : ""}${it.disabled ? " disabled" : ""}${it.back ? " back" : ""}${it.empty ? " empty" : ""}${it.danger ? " danger" : ""}" data-i="${i}">
            <div class="it-main">
              <div class="it-label">${it.label}</div>
              ${it.sub ? `<small>${it.sub}</small>` : ""}
              ${it.pct !== undefined ? `<div class="ui-bar it-bar"><i style="width:${it.pct}%"></i></div>` : ""}
            </div>
            ${it.sv && screen === "story" ? `<button type="button" class="slot-del" data-del="${it.slot}" title="Delete ${saves.fileName(it.slot)}">Delete</button>` : ""}
            <span class="go">${it.tag ?? (it.back ? "" : it.empty ? "Begin" : "&rsaquo;")}</span>
          </li>`).join("")}</ul>`;
        bodyEl.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (e) => {
          e.stopPropagation();
          slotSel = +b.dataset.del;
          askErase();
        }));
        bodyEl.querySelectorAll("[data-i]").forEach((li) => {
          const i = +li.dataset.i;
          li.addEventListener("click", () => { cursor = i; activate(); });
          li.addEventListener("mouseenter", () => {
            if (cursor === i) return;
            cursor = i;
            bodyEl.querySelectorAll("[data-i]").forEach((x) => x.classList.toggle("on", +x.dataset.i === i));
          });
        });
        bodyEl.querySelector(".ui-item.on")?.scrollIntoView({ block: "nearest" });
      }

      const padLive = document.body.classList.contains("pad-live");
      const k = (key, padKey) => padLive ? `<kbd class="pad shape">${padKey}</kbd>` : `<kbd>${key}</kbd>`;
      legendEl.innerHTML = screen === "settings"
        ? `<span>${k("&uarr;", "&#8597;")}${padLive ? "" : "<kbd>&darr;</kbd>"} choose</span>
           <span>${k("&larr;", "&#8596;")}${padLive ? "" : "<kbd>&rarr;</kbd>"} change</span>
           <span>${k("Q", "L1")}${k("E", "R1")} tabs</span>
           <span>${k("Esc", "&#9711;")} back</span>`
        : `<span>${k("&uarr;", "&#8597;")}${padLive ? "" : "<kbd>&darr;</kbd>"} choose</span>
           <span>${k("Enter", "&#10005;")} select</span>
           ${screen !== "main" ? `<span>${k("Esc", "&#9711;")} back</span>` : ""}`;
    }

    function go(next) {
      screen = next;
      // Re-read the files: they may have been edited, imported or deleted.
      if (next === "story" || next === "slot") slots = saves.list();
      cursor = 0;
      if (next === "settings") settingsPanel.reset();
      panel.classList.remove("swap");
      void panel.offsetWidth;
      panel.classList.add("swap");
      render();
      pad?.rumble.pulse(0.3, 0.12, 0.06);
    }

    function back() {
      const up = { story: "main", slot: "story", chapters: "slot", settings: "main" }[screen];
      if (up) {
        go(up);
        // Land back on the thing you came from rather than the top.
        if (up === "story") { cursor = slotSel; render(); }
      }
    }

    function move(d) {
      if (screen === "settings") { settingsPanel.move(d); pad?.rumble.pulse(0.18, 0.04, 0.04); return; }
      const list = items();
      let i = cursor;
      for (let n = 0; n < list.length; n++) {
        i = (i + d + list.length) % list.length;
        if (!list[i].disabled) break;
      }
      cursor = i;
      render();
      pad?.rumble.pulse(0.22, 0.05, 0.05);
    }

    function activate() {
      if (done) return;
      if (screen === "settings") { settingsPanel.change(1, true); return; }
      const it = items()[cursor];
      if (!it || it.disabled) return;
      it.act();
    }

    function begin(pick) {
      if (done) return;
      done = true;
      pad?.rumble.pulse(0.6, 0.9, 0.35);
      teardown();
      resolve(pick);
    }

    function askErase() {
      if (!slots[slotSel]) return;
      confirming = true;
      confirmSel = 0;
      confirmBody.textContent =
        `Journey ${slotSel + 1} (${saves.fileName(slotSel)}) — ${saves.sceneTitle(slots[slotSel])}, day ${slots[slotSel].day}. This cannot be undone.`;
      confirmEl.hidden = false;
      drawConfirm();
      pad?.rumble.pulse(0.4, 0.3, 0.16);
    }
    const confirmBtns = [...confirmEl.querySelectorAll("[data-c]")];
    function drawConfirm() { confirmBtns.forEach((b, i) => b.classList.toggle("on", i === confirmSel)); }
    function closeConfirm(erase) {
      confirming = false;
      confirmEl.hidden = true;
      if (erase) {
        saves.erase(slotSel);
        slots = saves.list();
        pad?.rumble.pulse(0.7, 0.2, 0.3);
        if (screen !== "story") go("story");
        cursor = slotSel;
        render();
      }
    }
    confirmBtns.forEach((b) => b.addEventListener("click", () => closeConfirm(b.dataset.c === "yes")));

    render();

    // --- Loop ---------------------------------------------------------------
    const clock = new THREE.Clock();
    let t = 0;
    let raf = 0;

    function frame() {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      t += dt;

      input.beginFrame(dt);
      document.body.classList.toggle("pad-live", !!pad?.connected());

      // Input
      if (confirming) {
        if (input.tapped("left") || input.tapped("right")) { confirmSel ^= 1; drawConfirm(); }
        if (input.pressed("confirm")) closeConfirm(confirmSel === 1);
        else if (input.pressed("back")) closeConfirm(false);
      } else if (!done) {
        if (input.tapped("up")) move(-1);
        if (input.tapped("down")) move(1);
        if (screen === "settings") {
          if (input.tapped("left")) settingsPanel.change(-1);
          if (input.tapped("right")) settingsPanel.change(1);
          if (input.pressed("tabPrev")) settingsPanel.tab(-1);
          if (input.pressed("tabNext")) settingsPanel.tab(1);
        } else if (input.tapped("right")) {
          activate();
        }
        if (input.pressed("confirm")) activate();
        if (input.pressed("back") || (screen !== "settings" && input.tapped("left"))) back();
        if (input.pressed("del") && screen === "slot") askErase();
        if (input.pressed("del") && screen === "story") {
          const it = items()[cursor];
          if (it?.sv) { slotSel = it.slot; askErase(); }
        }
      }

      // Sea, sky and clouds
      seaMat.uniforms.uTime.value = t;
      night.update(t, renderer.getPixelRatio());
      for (const c of clouds) {
        c.position.x += c.userData.drift * dt;
        if (c.position.x > 1600) c.position.x = -1600;
        c.lookAt(camera.position);
      }

      // Him: a long, slow, banked circle out over the moon path, far enough
      // away to stay a shape.
      if (dragonReady && dragon) {
        // Orbit centred on the moon's bearing, so most of the circle has him
        // crossing the disc or its halo rather than empty sky.
        // Centre sits exactly on the moon's bearing at his depth (x/z matches
        // MOON_DIR), and the horizontal swing is kept under the distance to
        // frame edge — at 1.5x he sailed off the left of the screen.
        const r = 340;
        const a = t * 0.16;
        const cz = -1500;
        const cx = cz * (MOON_DIR.x / MOON_DIR.z);
        dragon.position.set(
          cx + Math.sin(a) * r * 0.75,
          128 + Math.sin(t * 0.5) * 16,
          cz + Math.cos(a) * r
        );
        dragon.rotation.set(
          Math.sin(t * 0.5) * 0.08,
          -a + Math.PI * 0.5,
          Math.sin(a * 1.0) * 0.30
        );
      }

      // Camera: a slow breathing drift. Nothing dramatic — it just must not be
      // perfectly still, or the whole thing reads as a screenshot.
      camera.position.x = Math.sin(t * 0.07) * 26;
      camera.position.y = 34 + Math.sin(t * 0.05) * 5;
      camera.lookAt(Math.sin(t * 0.04) * 40, 60, -700);
      // Parallel to the image plane, so it projects as a circle wherever it is
      // in the frame. Turned to face the camera it is still a flat disc seen
      // off-axis, and on the right-hand side of a wide frame that is an egg.
      moonGroup.quaternion.copy(camera.quaternion);

      renderer.render(scene, camera);
      input.finishFrame(dt);
    }

    function teardown() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      input.popContext();

      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();

      root.classList.add("out");
      document.body.classList.remove("in-title");
      setTimeout(() => root.remove(), 700);
    }

    input.pushContext("menu");
    frame();
  });
}
