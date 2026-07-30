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
//   sustain(weak, strong)  — continuous, must be called every frame
//   pulse(weak, strong, s) — one-shot that decays over s seconds
//   triggers(left, right)  — DualSense trigger motors, when the browser has them
// ---------------------------------------------------------------------------
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

  let weak = 0, strong = 0, lTrig = 0, rTrig = 0;
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

  function send(w, s) {
    const act = actuator();
    if (!act) return;

    const params = {
      startDelay: 0,
      duration: RUMBLE_DURATION,
      weakMagnitude: w,
      strongMagnitude: s,
    };

    if (useTriggers && probeTriggers(act) && (lTrig > 0 || rTrig > 0)) {
      params.leftTrigger  = clamp01(lTrig * master);
      params.rightTrigger = clamp01(rTrig * master);
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

    setIntensity(v) { master = clamp01(v); return master; },
    getIntensity: () => master,
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) send(0, 0);
      return enabled;
    },
    isEnabled: () => enabled,
    hasTriggerRumble: () => triggerSupport === true,
    triggersOn: () => useTriggers,
    setTriggerRumble(v) { useTriggers = !!v; return useTriggers; },

    // Straight diagnostic: full power on both motors, and report back what the
    // browser actually said. This is the only way to tell "my code is wrong"
    // apart from "this browser or this connection has no haptics".
    async test() {
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
      weak = strong = lTrig = rTrig = 0;
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

      weak = strong = 0;

      if (!enabled) { lTrig = rTrig = 0; return; }

      w = clamp01(w * master);
      s = clamp01(s * master);
      sinceSend += dt;

      const quiet = w < RUMBLE_SILENCE && s < RUMBLE_SILENCE;
      const alreadyQuiet = sentWeak < RUMBLE_SILENCE && sentStrong < RUMBLE_SILENCE;
      // Once it's stopped, stay stopped — no point re-sending zeroes forever.
      if (quiet && alreadyQuiet) { lTrig = rTrig = 0; return; }

      const jumped = Math.abs(w - sentWeak) > RUMBLE_JUMP
                  || Math.abs(s - sentStrong) > RUMBLE_JUMP;

      if (sinceSend >= RUMBLE_PERIOD || (jumped && sinceSend >= RUMBLE_NUDGE)) {
        send(w, s);
      }

      lTrig = rTrig = 0;
    },
  };
}

// ---------------------------------------------------------------------------

export function setupGamepad() {
  let index = null;   // which slot in getGamepads() we're reading
  let id = "";

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

  const state = {
    // Post-deadzone stick values, refreshed by poll().
    lx: 0, ly: 0, rx: 0, ry: 0,
    rumble,

    connected: () => raw() !== null,
    id: () => id,
    slot: () => index,

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
      const gp = raw() || pick();

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
