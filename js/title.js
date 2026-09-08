import * as THREE from "three";
import { loadDragon, normalizeDragon } from "./assets.js";
import * as input from "./input.js";
import { music } from "./audio.js";
import * as saves from "./saves.js";
import { SCHEMES, getScheme, toggleScheme } from "./keymap.js";
import { MODES as AIM_MODES, getMode as getAimMode, toggleMode as toggleAimMode } from "./aim.js";
import { isEnabled as touchOn, toggleEnabled as toggleTouch, looksLikeTouch } from "./touch.js";
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
const MOON_DIR = new THREE.Vector3(-0.72, 0.42, -1).normalize();

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
          <div class="title-sub">Chapter One &mdash; The Metal and the Dark</div>
        </header>

        <ul class="slots" id="slots"></ul>
        <ul class="slots opts" id="opts"></ul>

        <footer class="title-foot">
          <span class="title-hint"><kbd>&#8593;</kbd><kbd>&#8595;</kbd> choose</span>
          <span class="title-hint"><kbd>&#8592;</kbd><kbd>&#8594;</kbd> change</span>
          <span class="title-hint"><kbd>Enter</kbd> begin</span>
          <span class="title-hint"><kbd>X</kbd> erase</span>
          <span class="title-hint pad-only"><kbd class="pad shape">&#10005;</kbd> begin
            <kbd class="pad shape">&#9633;</kbd> erase</span>
        </footer>
      </div>
      <div class="title-confirm" id="title-confirm" hidden>
        <div class="confirm-card">
          <div class="confirm-head">Erase this journey?</div>
          <div class="confirm-body" id="confirm-body"></div>
          <div class="confirm-actions">
            <span class="confirm-no">&#9711; / Esc &mdash; keep it</span>
            <span class="confirm-yes">&#10005; / Enter &mdash; erase</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    document.body.classList.add("in-title");

    const slotList = root.querySelector("#slots");
    const optList = root.querySelector("#opts");
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

    moonGroup.lookAt(0, 0, 0);
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

    // --- Slots --------------------------------------------------------------
    let slots = saves.list();
    // One row past the last slot is the controls option. Keeping it in the same
    // cursor space as the slots is what makes it reachable with the same up and
    // down that everything else on this screen uses, on pad as well as keys.
    const CONTROLS_ROW = saves.SLOT_COUNT;
    const AIM_ROW = saves.SLOT_COUNT + 1;
    const TOUCH_ROW = saves.SLOT_COUNT + 2;
    const ROWS = saves.SLOT_COUNT + 3;
    // findIndex returns -1 when every slot is empty, which on a fresh install
    // left the list with nothing highlighted until you pressed a direction.
    let cursor = Math.max(0, slots.findIndex(Boolean));
    if (cursor < 0) cursor = 0;
    let confirming = false;

    function renderSlots() {
      slotList.innerHTML = "";
      slots.forEach((save, i) => {
        const li = document.createElement("li");
        li.className = "slot" + (i === cursor ? " on" : "") + (save ? "" : " empty");

        if (save) {
          const pct = Math.round(saves.progress(save) * 100);
          li.innerHTML = `
            <div class="slot-index">${i + 1}</div>
            <div class="slot-main">
              <div class="slot-title">${saves.sceneTitle(save)}</div>
              <div class="slot-meta">
                <span>Day ${save.day}</span>
                <span class="dot">&middot;</span>
                <span>${saves.playtime(save)}</span>
                <span class="dot">&middot;</span>
                <span>${saves.lastPlayed(save)}</span>
              </div>
              <div class="slot-bar"><i style="width:${pct}%"></i></div>
            </div>
            <div class="slot-go">Continue</div>
          `;
        } else {
          li.innerHTML = `
            <div class="slot-index">${i + 1}</div>
            <div class="slot-main">
              <div class="slot-title empty">Empty</div>
              <div class="slot-meta"><span>No journey here yet</span></div>
            </div>
            <div class="slot-go">Begin</div>
          `;
        }

        li.addEventListener("click", () => {
          if (confirming) return;
          cursor = i;
          renderSlots();
          choose();
        });
        slotList.appendChild(li);
      });

      const sc = SCHEMES[getScheme()];
      const am = AIM_MODES[getAimMode()];
      // Off is the default and stays the default. The hint changes with the
      // machine rather than the setting turning itself on: a laptop with a
      // touchscreen is still a laptop, and deciding for the player is how you
      // get an overlay nobody asked for over the top of a keyboard.
      const on = touchOn();
      const touchHint = on
        ? "every control a keyboard has, on screen. Hide them from the top corner"
        : looksLikeTouch()
          ? "this looks like a touchscreen — turn them on to play without a keyboard"
          : "for a phone or a tablet. Everything a keyboard can do";
      optList.innerHTML =
        optionRow(cursor === CONTROLS_ROW, "&#8646;", `Controls &mdash; ${sc.label}`, sc.hint) +
        optionRow(cursor === AIM_ROW, "&#8853;", `Aiming &mdash; ${am.label}`, am.hint) +
        optionRow(cursor === TOUCH_ROW, "&#9744;",
          `On-screen controls &mdash; ${on ? "On" : "Off"}`, touchHint);
      const [ctrlLi, aimLi, touchLi] = optList.children;
      ctrlLi.addEventListener("click", () => { cursor = CONTROLS_ROW; flipControls(); });
      aimLi.addEventListener("click", () => { cursor = AIM_ROW; flipAim(); });
      touchLi.addEventListener("click", () => { cursor = TOUCH_ROW; flipTouch(); });
    }

    function move(d) {
      cursor = (cursor + d + ROWS) % ROWS;
      renderSlots();
      // The stage scrolls now, so moving the cursor has to bring the row with
      // it. Without this the keyboard and the pad can select a row that is off
      // the bottom of the screen — which is worse than not being able to
      // scroll at all, because the highlight is somewhere you cannot see.
      revealCursor();
      pad?.rumble.pulse(0.22, 0.05, 0.05);
    }

    /** Scroll whichever row the cursor is on into view. */
    function revealCursor() {
      const all = [...slotList.children, ...optList.children];
      const el = all[cursor];
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    /**
     * Flip the control scheme. Persists itself — see keymap.js — so it survives
     * the reload, which matters because this is the screen you are on when you
     * have just discovered that Ctrl+Down threw you out of the game.
     */
    function flipControls() {
      toggleScheme();
      renderSlots();
      pad?.rumble.pulse(0.3, 0.12, 0.08);
    }

    /** Scoped aim or no-scope. Persists itself — see keymap.js and aim.js. */
    function flipAim() {
      toggleAimMode();
      renderSlots();
      pad?.rumble.pulse(0.3, 0.12, 0.08);
    }

    /**
     * On-screen controls. Persists itself — see touch.js — and is read once by
     * main.js when the flight scene builds, so flipping it here takes effect on
     * the way in rather than needing a reload.
     */
    function flipTouch() {
      toggleTouch();
      renderSlots();
      pad?.rumble.pulse(0.3, 0.12, 0.08);
    }

    /** The two settings rows are the same component; only the contents differ. */
    function optionRow(on, glyph, title, hint) {
      return `
        <li class="slot opt${on ? " on" : ""}">
          <div class="slot-index">${glyph}</div>
          <div class="slot-main">
            <div class="slot-title">${title}</div>
            <div class="slot-meta"><span>${hint}</span></div>
          </div>
          <div class="slot-go">Change</div>
        </li>`;
    }

    let done = false;

    function choose() {
      if (done) return;
      if (cursor === CONTROLS_ROW) { flipControls(); return; }
      if (cursor === AIM_ROW) { flipAim(); return; }
      if (cursor === TOUCH_ROW) { flipTouch(); return; }
      done = true;
      const existing = slots[cursor];
      const save = existing || saves.create(cursor);
      pad?.rumble.pulse(0.6, 0.9, 0.35);
      teardown();
      resolve({ slot: cursor, save, isNew: !existing });
    }

    function askErase() {
      if (cursor >= CONTROLS_ROW || !slots[cursor]) return;
      confirming = true;
      confirmBody.textContent =
        `Slot ${cursor + 1} — ${saves.sceneTitle(slots[cursor])}, day ${slots[cursor].day}. This cannot be undone.`;
      confirmEl.hidden = false;
      pad?.rumble.pulse(0.4, 0.3, 0.16);
    }

    function doErase() {
      saves.erase(cursor);
      slots = saves.list();
      confirming = false;
      confirmEl.hidden = true;
      renderSlots();
      pad?.rumble.pulse(0.7, 0.2, 0.3);
    }

    renderSlots();

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
        if (input.pressed("confirm")) doErase();
        else if (input.pressed("back")) { confirming = false; confirmEl.hidden = true; }
      } else {
        if (input.tapped("up")) move(-1);
        if (input.tapped("down")) move(1);
        if (input.tapped("left") || input.tapped("right")) {
          if (cursor === CONTROLS_ROW) flipControls();
          else if (cursor === AIM_ROW) flipAim();
          else if (cursor === TOUCH_ROW) flipTouch();
        }
        if (input.pressed("confirm")) choose();
        if (input.pressed("del")) askErase();
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
