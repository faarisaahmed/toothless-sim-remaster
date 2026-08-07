// DualSense (and anything else the browser reports with the W3C "standard"
// mapping) support: analog sticks and triggers for flight, plus a small rumble
// mixer so the pad has something to say about what the dragon is doing.
//
// Two things worth knowing about the Gamepad API before reading on:
//   1. getGamepads() hands back a fresh SNAPSHOT every call. Nothing is live —
//      it has to be re-read once a frame or the state never changes.
//   2. Nothing shows up until the player presses a button. That's a deliberate
//      fingerprinting defence in Chrome, not a bug to work around.

// Button indices in the standard mapping. Chrome, Safari and Firefox all report
// a DualSense this way over both USB and Bluetooth, so these are safe to hardcode.
export const BTN = {
  CROSS:    0,
  CIRCLE:   1,
  SQUARE:   2,
  TRIANGLE: 3,
  L1:       4,
  R1:       5,
  L2:       6,
  R2:       7,
  CREATE:   8,
  OPTIONS:  9,
  L3:      10,
  R3:      11,
  DUP:     12,
  DDOWN:   13,
  DLEFT:   14,
  DRIGHT:  15,
  PS:      16,  // the system grabs this one; we never see it
  TOUCHPAD: 17,
};

const STICK_DEADZONE   = 0.10;
const TRIGGER_DEADZONE = 0.045;

// --- Rumble timing ---------------------------------------------------------
// playEffect() replaces whatever is running, so a continuous rumble is really a
// short effect re-issued on a timer. The effect outlives the gap between sends
// so there's no audible stutter between them.
const RUMBLE_PERIOD   = 0.075; // seconds between routine re-sends
const RUMBLE_DURATION = 130;   // ms — longer than the period, on purpose
const RUMBLE_NUDGE    = 0.03;  // seconds — floor on an early re-send
const RUMBLE_JUMP     = 0.10;  // magnitude change that earns an early re-send
const RUMBLE_SILENCE  = 0.004; // below this we stop sending rather than idle-buzz

// The direct HID link has none of playEffect's constraints — no effect to be
// preempted, no duration to outrun — so it just gets driven at a steady rate.
// 50 Hz is well inside what the pad will take and keeps the trigger tension
// tracking the throttle closely enough that it feels mechanical.
const HID_PERIOD = 0.02;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Radial deadzone with a gentle expo curve. Radial (rather than per-axis) is
// what keeps a diagonal from feeling like it snaps to the axes near centre.
function curveStick(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < STICK_DEADZONE) return [0, 0];
  // 0.98 rather than 1 so a slightly worn stick can still reach full deflection.
  const t = Math.min(1, (mag - STICK_DEADZONE) / (0.98 - STICK_DEADZONE));
  // Mostly squared, a little linear blended in — fine control near centre
  // without the last of the travel feeling dead.
  const shaped = t * t * 0.78 + t * 0.22;
  const k = shaped / mag;
  return [x * k, y * k];
}

function curveTrigger(v) {
  if (v < TRIGGER_DEADZONE) return 0;
  return (v - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE);
}

// ---------------------------------------------------------------------------
// Rumble mixer
//
// Everything that wants to rumble contributes to a single pair of magnitudes
// per frame rather than firing effects at the actuator directly. Two callers
// playing their own effects would just cut each other off — the last one to
// call wins and the rest are silently dropped.
//
//   sustain(weak, strong)   — continuous, must be called every frame
//   pulse(weak, strong, s)  — one-shot that decays over s seconds
//   triggers(left, right)   — trigger tension, when the pad can do it
//   triggerBuzz(left, right)— trigger vibration, ditto; wins over tension
// ---------------------------------------------------------------------------

// One trigger's worth of contributions, turned into the single effect the pad
// can actually run. There is one effect slot per trigger and the two kinds
// genuinely can't be layered — vibration mode has no tension component — so a
// buzz preempts the tension for as long as it lasts. That's the same trade the
// driving games make: the pedal is heavy until something happens, and the
// moment it stops happening the weight comes straight back.
//
// Start zone 0 on the tension, not 1: the weight has to be there from the first
// millimetre of travel or the pedal feels loose at the top and only bites late.
function triggerEffect(resist, buzz) {
  if (buzz > 0.02) {
    return {
      mode: "buzz",
      freq: Math.round(22 + 16 * buzz), // a fine texture, not a hammer
      amp: 1 + buzz * 4,                // capped well short of the 8 maximum
      start: 0,
    };
  }
  if (resist > 0.02) return { mode: "resist", start: 0, force: 1 + resist * 7 };
  return { mode: "off" };
}
function createRumble(getPad) {
  let master = 1;
  let enabled = true;
  // Off by default, and deliberately. Only ONE effect can run on an actuator at
  // a time, so a trigger-rumble effect replaces the main-motor one — and on the
  // setups where the browser advertises trigger support but the pad doesn't
  // deliver it, the result is a controller that goes completely dead exactly
  // while you're holding a trigger. Losing the main motors is far worse than
  // missing the trigger flourish, so this is opt-in via `rumble triggers on`.
  let useTriggers = false;
  let hid = null;
  // While a test is running the flight's own contributions are held back —
  // otherwise the frame loop overwrites each stage before you can feel it.
  let testing = false;

  let weak = 0, strong = 0, lTrig = 0, rTrig = 0, lBuzz = 0, rBuzz = 0;
  const pulses = [];

  let sentWeak = 0, sentStrong = 0;
  let sinceSend = RUMBLE_PERIOD;
  let triggerSupport = null; // null = not probed yet

  function actuator() {
    const gp = getPad();
    const act = gp && gp.vibrationActuator;
    return act && typeof act.playEffect === "function" ? act : null;
  }

  function probeTriggers(act) {
    if (triggerSupport !== null) return triggerSupport;
    // Chrome exposes the list; older builds only have the predicate.
    if (Array.isArray(act.effects)) {
      triggerSupport = act.effects.includes("trigger-rumble");
    } else if (typeof act.canPlayEffectType === "function") {
      triggerSupport = !!act.canPlayEffectType("trigger-rumble");
    } else {
      triggerSupport = false;
    }
    return triggerSupport;
  }

  // A direct HID link always wins: it reaches the pad on transports where the
  // Gamepad API's rumble doesn't, and it carries the trigger effects too.
  function sendHID(w, s) {
    hid.setRumble(w, s);
    hid.setTriggerEffect("left",
      triggerEffect(clamp01(lTrig * master), clamp01(lBuzz * master)));
    hid.setTriggerEffect("right",
      triggerEffect(clamp01(rTrig * master), clamp01(rBuzz * master)));
    hid.commit();
    sentWeak = w;
    sentStrong = s;
    sinceSend = 0;
  }

  function send(w, s) {
    if (hid && hid.isReady()) { sendHID(w, s); return; }

    const act = actuator();
    if (!act) return;

    const params = {
      startDelay: 0,
      duration: RUMBLE_DURATION,
      weakMagnitude: w,
      strongMagnitude: s,
    };

    // trigger-rumble is amplitude only — it has no notion of tension or of a
    // frequency — so both kinds of trigger contribution collapse into one number.
    const l = Math.max(lTrig, lBuzz);
    const r = Math.max(rTrig, rBuzz);

    if (useTriggers && probeTriggers(act) && (l > 0 || r > 0)) {
      params.leftTrigger  = clamp01(l * master);
      params.rightTrigger = clamp01(r * master);
      // If the browser lied about supporting it, fall back for good.
      act.playEffect("trigger-rumble", params).catch(() => { triggerSupport = false; });
    } else {
      // A rejection here is almost always "preempted by the next effect",
      // which is the normal cost of re-issuing on a timer. Swallow it.
      act.playEffect("dual-rumble", params).catch(() => {});
    }

    sentWeak = w;
    sentStrong = s;
    sinceSend = 0;
  }

  return {
    sustain(w, s) { weak += w; strong += s; },

    pulse(w, s, seconds = 0.2) {
      if (seconds <= 0) return;
      pulses.push({ w, s, life: seconds, ttl: seconds });
    },

    triggers(left, right) {
      lTrig = Math.max(lTrig, left);
      rTrig = Math.max(rTrig, right);
    },

    triggerBuzz(left, right) {
      lBuzz = Math.max(lBuzz, left);
      rBuzz = Math.max(rBuzz, right);
    },

    setIntensity(v) { master = clamp01(v); return master; },
    getIntensity: () => master,
    setEnabled(v) {
      enabled = !!v;
      // Zero the trigger contributions first, or the send below leaves whatever
      // tension this frame had asked for latched on the pad for good — the
      // triggers hold their last commanded state, they don't decay.
      if (!enabled) { lTrig = rTrig = lBuzz = rBuzz = 0; send(0, 0); }
      return enabled;
    },
    isEnabled: () => enabled,
    hasTriggerRumble: () => triggerSupport === true,
    triggersOn: () => useTriggers,
    setTriggerRumble(v) { useTriggers = !!v; return useTriggers; },
    attachHID(h) { hid = h; },
    hid: () => hid,
    usingHID: () => !!hid && hid.isReady(),

    // Straight diagnostic, and the only way to tell "my code is wrong" apart
    // from "this browser or this connection has no haptics".
    //
    // Over HID it's a sequence rather than one buzz, because "the haptics don't
    // work" is usually only half true — the coils are addressed by different
    // bytes from the triggers, and either half can be dead on its own. Feeling
    // your way down the stages tells you which. `say` narrates them.
    async test(say = () => {}) {
      if (hid && hid.isReady()) {
        testing = true;
        try {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const stages = [
          ["right coil — the fine, buzzy one", () => hid.setRumble(1, 0), 800],
          ["left coil — the deep, thumpy one", () => hid.setRumble(0, 1), 800],
          ["both, ramping up", null, 0], // handled below
          ["L2 stiffening", () => {
            hid.setRumble(0, 0);
            hid.setTriggerEffect("left", { mode: "resist", start: 1, force: 8 });
          }, 900],
          ["R2 buzzing", () => {
            hid.setTriggerEffect("left", { mode: "off" });
            hid.setTriggerEffect("right", { mode: "buzz", freq: 30, amp: 8, start: 1 });
          }, 900],
        ];

        for (const [label, apply, hold] of stages) {
          say(label);
          if (!apply) {
            // The ramp is its own thing: a steady climb is far easier to feel
            // than a step, and it proves the amplitude byte is being read
            // rather than just the "something is on" bit.
            for (let i = 0; i <= 20; i++) {
              hid.setRumble(i / 20, i / 20);
              await hid.commit();
              await wait(45);
            }
            continue;
          }
          apply();
          await hid.commit();
          await wait(hold);
        }

        await hid.stop();
        return {
          ok: hid.status() !== "error",
          result: `${hid.writeCount()} reports written, ${hid.reportSize()}-byte payload`,
          why: hid.error(),
          effects: `WebHID over ${hid.transport()} — rumble and adaptive triggers`,
        };
        } finally { testing = false; }
      }

      const act = actuator();
      if (!act) {
        return { ok: false, why: "no vibrationActuator — this browser exposes no haptics for this pad" };
      }
      const effects = Array.isArray(act.effects) ? act.effects.join(", ") : "(not advertised)";
      try {
        const r = await act.playEffect("dual-rumble", {
          startDelay: 0, duration: 900, weakMagnitude: 1, strongMagnitude: 1,
        });
        return { ok: true, result: String(r), effects };
      } catch (e) {
        return { ok: false, why: String(e?.message ?? e), effects };
      }
    },

    stop() {
      pulses.length = 0;
      weak = strong = lTrig = rTrig = lBuzz = rBuzz = 0;
      sentWeak = sentStrong = 0;
      if (hid && hid.isReady()) { hid.stop(); return; }
      send(0, 0);
    },

    // Called once at the very end of the frame, after every contributor has had
    // its say.
    flush(dt) {
      let w = weak, s = strong;

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.life -= dt;
        if (p.life <= 0) { pulses.splice(i, 1); continue; }
        // Squared falloff — a thump that drops away fast, not a long fade.
        const k = (p.life / p.ttl) ** 2;
        w += p.w * k;
        s += p.s * k;
      }

      const clear = () => { weak = strong = lTrig = rTrig = lBuzz = rBuzz = 0; };
      weak = strong = 0;

      if (testing) { clear(); return; }
      if (!enabled) { clear(); return; }

      w = clamp01(w * master);
      s = clamp01(s * master);
      sinceSend += dt;

      // The HID path is a state push, not an effect queue: there's nothing to
      // re-issue and nothing to preempt, so it's driven at a flat rate and never
      // goes quiet. Skipping the sends while the motors are still would freeze
      // the trigger tension and the lightbar along with them, since all three
      // ride in the same report.
      if (hid && hid.isReady()) {
        if (sinceSend >= HID_PERIOD) sendHID(w, s);
        clear();
        return;
      }

      const quiet = w < RUMBLE_SILENCE && s < RUMBLE_SILENCE;
      const alreadyQuiet = sentWeak < RUMBLE_SILENCE && sentStrong < RUMBLE_SILENCE;
      // Once it's stopped, stay stopped — no point re-sending zeroes forever.
      if (quiet && alreadyQuiet) { clear(); return; }

      const jumped = Math.abs(w - sentWeak) > RUMBLE_JUMP
                  || Math.abs(s - sentStrong) > RUMBLE_JUMP;

      if (sinceSend >= RUMBLE_PERIOD || (jumped && sinceSend >= RUMBLE_NUDGE)) {
        send(w, s);
      }

      clear();
    },
  };
}

// ---------------------------------------------------------------------------

export function setupGamepad() {
  let index = null;   // which slot in getGamepads() we're reading
  let id = "";
  let source = "";    // "gamepad" | "hid" — which one poll() actually read
  // "auto" reads the direct HID link whenever it's live and falls back to the
  // Gamepad API. That order round the way it is because an open WebHID handle
  // is exactly what can leave the Gamepad API reporting nothing — preferring
  // the path we know is up beats discovering the other one is down. The other
  // two settings exist so `padsrc` can prove which is which.
  let prefer = "auto";

  const held    = new Array(20).fill(false);
  const rising  = new Array(20).fill(false);
  const values  = new Array(20).fill(0);

  function raw() {
    if (index === null) return null;
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = list[index];
    return gp && gp.connected ? gp : null;
  }

  const rumble = createRumble(raw);

  // The direct HID link, when there is one. Holding the pad open over WebHID
  // can leave the Gamepad API reporting nothing at all — two claims, one
  // device — and the symptom is a pad whose haptics work perfectly while the
  // sticks do nothing. Reading input off the same open device sidesteps it.
  const hidInput = () => rumble.hid()?.input() ?? null;

  const state = {
    // Post-deadzone stick values, refreshed by poll().
    lx: 0, ly: 0, rx: 0, ry: 0,
    rumble,

    connected: () => raw() !== null || hidInput() !== null,
    id: () => id,
    slot: () => index,
    source: () => source,
    preference: () => prefer,
    setSource(v) {
      prefer = v === "hid" || v === "gamepad" ? v : "auto";
      return prefer;
    },

    // Everything the browser will admit to, whether we've claimed it or not.
    // The distinction that matters when a pad "won't connect": an empty list
    // means the browser itself sees nothing, which is never something this
    // code can cause.
    survey() {
      const list = navigator.getGamepads ? navigator.getGamepads() : [];
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const gp = list[i];
        if (!gp) continue;
        out.push({
          index: gp.index,
          id: gp.id || "(no id)",
          mapping: gp.mapping || "(none)",
          connected: !!gp.connected,
          axes: gp.axes ? gp.axes.length : 0,
          buttons: gp.buttons ? gp.buttons.length : 0,
          haptics: !!gp.vibrationActuator,
        });
      }
      return out;
    },

    held:    (i) => held[i] === true,
    pressed: (i) => rising[i] === true,   // rising edge, true for one frame
    value:   (i) => values[i] || 0,       // analog for triggers, 0/1 otherwise

    // Swallow a press so a later reader this frame never sees it — for buttons
    // that mean one thing in an overlay and another in flight.
    consume(i) { rising[i] = false; held[i] = false; values[i] = 0; },

    poll(dt) {
      // Claim a slot either way, so the id and the Gamepad-API rumble path stay
      // available even when the input itself is coming off the HID link.
      const api = raw() || pick();
      const direct = prefer === "gamepad" ? null : hidInput();

      const gp = prefer === "hid" ? direct : (direct || api);
      source = !gp ? "" : gp === direct ? "hid" : "gamepad";
      if (source === "hid" && !id) id = "DualSense (HID)";

      if (!gp) {
        for (let i = 0; i < held.length; i++) {
          held[i] = rising[i] = false;
          values[i] = 0;
        }
        state.lx = state.ly = state.rx = state.ry = 0;
        return false;
      }

      for (let i = 0; i < held.length; i++) {
        const b = gp.buttons[i];
        const down = b ? (b.pressed || b.value > 0.5) : false;
        rising[i] = down && !held[i];
        held[i] = down;
        values[i] = b ? b.value : 0;
      }

      const axes = gp.axes;
      const [lx, ly] = curveStick(axes[0] || 0, axes[1] || 0);
      const [rx, ry] = curveStick(axes[2] || 0, axes[3] || 0);
      state.lx = lx; state.ly = ly;
      state.rx = rx; state.ry = ry;

      // Some drivers report the triggers as buttons only, some as axes too. The
      // button value is the one that's consistent across all of them.
      values[BTN.L2] = curveTrigger(values[BTN.L2]);
      values[BTN.R2] = curveTrigger(values[BTN.R2]);

      return true;
    },

    flush(dt) { rumble.flush(dt); },
  };

  // Claim the first connected pad. Called from poll() so a pad plugged in
  // mid-session gets picked up even if the connect event was missed.
  function pick() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (gp && gp.connected) {
        index = i;
        id = gp.id || "gamepad";
        return gp;
      }
    }
    index = null;
    id = "";
    return null;
  }

  window.addEventListener("gamepadconnected", (e) => {
    if (index === null) { index = e.gamepad.index; id = e.gamepad.id || "gamepad"; }
  });

  window.addEventListener("gamepaddisconnected", (e) => {
    if (e.gamepad.index === index) { index = null; id = ""; }
  });

  // A pad left buzzing while the tab is hidden keeps buzzing. Kill it.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) rumble.stop();
  });
  window.addEventListener("blur", () => rumble.stop());

  return state;
}
