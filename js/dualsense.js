// ---------------------------------------------------------------------------
// DualSense over WebHID
//
// The Gamepad API's `dual-rumble` is a two-channel amplitude interface, and on
// a DualSense it already drives the voice coils — the pad has no rotating-mass
// motors to drive instead. What it can't do is set adaptive trigger tension, and
// on some platforms Chrome's gamepad rumble transport doesn't reach the pad at
// all over Bluetooth. Talking to the device directly sidesteps both.
//
// Report layout below is the one in the Linux hid-playstation driver
// (struct dualsense_output_report_common / _bt). The trigger effect offsets sit
// inside the block that driver calls `reserved2` because Linux doesn't implement
// them; those come from the community mapping, which fits the gap exactly.
//
// Three things the pad insists on, none of which are obvious, and all three of
// which fail silently — the write succeeds and nothing happens:
//
//   1. valid_flag0 needs HAPTICS_SELECT (bit 1) as well as the vibration bit.
//      Without it the pad accepts the amplitudes and routes them nowhere.
//   2. Over Bluetooth it stays in the cut-down compat mode until the host reads
//      feature report 0x05, and in compat mode it ignores 0x31 output entirely.
//   3. The trigger effect parameters are ZONE indices, not bytes. Simple
//      feedback takes a position of 0-9 and a force of 0-8; anything larger is
//      out of range and the effect is dropped.
// ---------------------------------------------------------------------------

const VENDOR_SONY = 0x054c;
const PRODUCT_DUALSENSE      = 0x0ce6;
const PRODUCT_DUALSENSE_EDGE = 0x0df2;

const REPORT_USB = 0x02;
const REPORT_BT  = 0x31;

const COMMON_SIZE   = 47; // the payload both transports carry
const USB_DATA_SIZE = 62; // 0x02 is 63 bytes on the wire, report id included
const BT_DATA_SIZE  = 77; // 0x31 is 78, CRC included
const BT_TAG        = 0x10;
const CRC_SEED      = 0xa2;

// Reading this feature report is what switches a Bluetooth DualSense out of the
// 10-byte compat input report and into full mode. It's a calibration blob we
// don't care about — the side effect is the entire point.
const FEATURE_CALIBRATION = 0x05;

// valid_flag0
const F0_COMPATIBLE_VIBRATION = 1 << 0;
const F0_HAPTICS_SELECT       = 1 << 1; // routes the amplitudes to the coils
const F0_RIGHT_TRIGGER        = 1 << 2;
const F0_LEFT_TRIGGER         = 1 << 3;
// valid_flag1
const F1_LIGHTBAR             = 1 << 2;
// valid_flag2
const F2_LIGHTBAR_SETUP        = 1 << 1;
const F2_COMPATIBLE_VIBRATION2 = 1 << 2; // newer firmware honours this instead

// Offsets within the 47-byte common payload.
const OFF_FLAG0          = 0;
const OFF_FLAG1          = 1;
const OFF_MOTOR_RIGHT    = 2;  // high frequency — the Gamepad API's "weak"
const OFF_MOTOR_LEFT     = 3;  // low frequency  — the Gamepad API's "strong"
const OFF_RIGHT_TRIG     = 10; // 11 bytes: mode then ten parameters
const OFF_LEFT_TRIG      = 21;
const OFF_FLAG2          = 38;
const OFF_LIGHTBAR_SETUP = 41;
const OFF_LIGHTBAR_R     = 44;
const OFF_LIGHTBAR_G     = 45;
const OFF_LIGHTBAR_B     = 46;

// Trigger effect modes, from the "simple" family — the one that takes its
// parameters raw instead of bit-packing ten zones into a bitfield.
const TRIG_OFF     = 0x05; // clean release
const TRIG_RESIST  = 0x01; // [position 0-9][force 0-8] — constant resistance
const TRIG_VIBRATE = 0x06; // [frequency Hz][amplitude 0-8][position 0-9]

const LIGHTBAR_LIGHT_OUT = 0x02; // stops the pad running its own fade animation

// --- Input reports ---------------------------------------------------------
// Holding the pad open over WebHID can leave the Gamepad API with nothing to
// report — they're two claims on one device and the browser doesn't promise to
// satisfy both. Since the device is already open, reading the sticks off it
// directly is both the fix and the cheaper path: these reports arrive at the
// pad's own rate rather than being sampled once a frame.
const INPUT_USB = 0x01; // 63 bytes, full state
const INPUT_BT  = 0x31; // the same state one byte further in
const INPUT_STALE = 1000; // ms without a report before we stop believing it

// Where the state block starts, by report. Anything else is ignored.
function inputOffset(reportId, length) {
  if (reportId === INPUT_BT) return 1;
  // A Bluetooth pad that hasn't been switched into full mode still sends 0x01,
  // but as a short DS4-compatible frame with a different layout. Better to read
  // nothing than to read the wrong bytes.
  if (reportId === INPUT_USB && length >= 32) return 0;
  return -1;
}

// hat 0-7 clockwise from north, 8 = centred.
const HAT_UP    = [1, 1, 0, 0, 0, 0, 0, 1];
const HAT_RIGHT = [0, 1, 1, 1, 0, 0, 0, 0];
const HAT_DOWN  = [0, 0, 0, 1, 1, 1, 0, 0];
const HAT_LEFT  = [0, 0, 0, 0, 0, 1, 1, 1];

// Standard-mapping index -> [byte within the state block, bit]. Matches the
// order in gamepad.js's BTN so both input paths produce the same shape.
const BUTTON_BITS = [
  [7, 5], [7, 6], [7, 4], [7, 7],           // cross circle square triangle
  [8, 0], [8, 1], [8, 2], [8, 3],           // L1 R1 L2 R2
  [8, 4], [8, 5], [8, 6], [8, 7],           // create options L3 R3
  null, null, null, null,                   // d-pad, from the hat below
  [9, 0], [9, 1],                           // ps touchpad
];

const axis = (v) => (v - 128) / 127;

// --- CRC-32, needed only for the Bluetooth framing -------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const byte   = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
const zone   = (v) => Math.max(0, Math.min(9, Math.round(v)));
const force  = (v) => Math.max(1, Math.min(8, Math.round(v)));
const OFF    = { mode: "off" };

export function setupDualSense() {
  const available = typeof navigator !== "undefined" && "hid" in navigator;

  let device = null;
  let bluetooth = false;
  let dataSize = USB_DATA_SIZE;
  let seq = 0;
  let status = available ? "idle" : "unsupported";
  let lastError = "";
  let writes = 0;
  let candidates = 0;

  // A write can fail transiently — the transport stalls, the pad is mid
  // handshake — and the old code treated the first failure as permanent, which
  // left a pad that had "connected" fine sitting there doing nothing until it
  // was physically replugged. Failures have to be consecutive to count.
  const MAX_FAILURES = 6;
  let failures = 0;

  // Desired state, written out together on each commit.
  let weak = 0, strong = 0;
  let trigL = OFF, trigR = OFF;
  let led = [0, 0, 0];
  let ledOn = false;
  let ledSetup = false; // one-shot: take the lightbar off its own animation

  // Shaped like a Gamepad so the rest of the game can't tell which path it came
  // from. Rebuilt in place — one object, not one per report, at 250Hz.
  const snapshot = {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
  };
  let lastReport = 0;
  let reportsIn = 0;

  function onInputReport(e) {
    const off = inputOffset(e.reportId, e.data.byteLength);
    if (off < 0 || e.data.byteLength < off + 10) return;
    const d = e.data;

    snapshot.axes[0] = axis(d.getUint8(off));
    snapshot.axes[1] = axis(d.getUint8(off + 1));
    snapshot.axes[2] = axis(d.getUint8(off + 2));
    snapshot.axes[3] = axis(d.getUint8(off + 3));

    const l2 = d.getUint8(off + 4) / 255;
    const r2 = d.getUint8(off + 5) / 255;
    const raw = [d.getUint8(off + 7), d.getUint8(off + 8), d.getUint8(off + 9)];

    for (let i = 0; i < BUTTON_BITS.length; i++) {
      const at = BUTTON_BITS[i];
      if (!at) continue;
      const b = snapshot.buttons[i];
      b.pressed = (raw[at[0] - 7] & (1 << at[1])) !== 0;
      b.value = b.pressed ? 1 : 0;
    }

    // The d-pad is a hat value in the low nibble, not four bits.
    const hat = raw[0] & 0x0f;
    const dirs = hat < 8
      ? [HAT_UP[hat], HAT_DOWN[hat], HAT_LEFT[hat], HAT_RIGHT[hat]]
      : [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const b = snapshot.buttons[12 + i];
      b.pressed = !!dirs[i];
      b.value = dirs[i];
    }

    // The analog reading is the useful one; the digital bit is just the switch
    // at the bottom of the travel, and it's already been read above.
    snapshot.buttons[6].value = l2;
    snapshot.buttons[7].value = r2;
    snapshot.buttons[6].pressed = snapshot.buttons[6].pressed || l2 > 0.5;
    snapshot.buttons[7].pressed = snapshot.buttons[7].pressed || r2 > 0.5;

    lastReport = performance.now();
    reportsIn++;
  }

  // A write already in flight doesn't cancel the next one — it defers it, so the
  // newest state always reaches the pad. Dropping it instead leaves the trigger
  // tension a frame stale every time the transport hiccups.
  let inFlight = false;
  let pending = false;

  // How long the device says its reports are. Trusting the descriptor rather
  // than the constant above means a firmware that sizes them differently still
  // gets a report it will accept.
  function declaredLength(dev, id) {
    for (const c of dev.collections ?? []) {
      for (const r of c.outputReports ?? []) {
        if (r.reportId !== id) continue;
        let bits = 0;
        for (const it of r.items ?? []) {
          bits += (it.reportSize ?? 0) * (it.reportCount ?? 0);
        }
        if (bits >= COMMON_SIZE * 8) return bits >> 3;
      }
    }
    return 0;
  }

  function pickTransport(dev) {
    const outIds = new Set();
    const inIds = new Set();
    for (const c of dev.collections ?? []) {
      for (const r of c.outputReports ?? []) outIds.add(r.reportId);
      for (const r of c.inputReports  ?? []) inIds.add(r.reportId);
    }
    // USB descriptors carry 0x02 and input 0x01; Bluetooth ones carry 0x31 for
    // both. Output first, input as the tiebreak when a descriptor lists both.
    if (outIds.has(REPORT_USB)) return false;
    if (outIds.has(REPORT_BT)) return true;
    if (inIds.has(REPORT_BT) && !inIds.has(REPORT_USB)) return true;
    return false;
  }

  // Writes one effect into the 11 bytes at `base`. Anything the pad would
  // consider out of range is clamped rather than passed through — an out-of-range
  // parameter makes the pad discard the whole effect without complaint.
  function writeTrigger(c, base, fx) {
    if (!fx || fx.mode === "off") { c[base] = TRIG_OFF; return; }

    if (fx.mode === "buzz") {
      c[base]     = TRIG_VIBRATE;
      c[base + 1] = Math.max(1, Math.min(255, Math.round(fx.freq ?? 20)));
      c[base + 2] = force(fx.amp ?? 4);
      c[base + 3] = zone(fx.start ?? 1);
      return;
    }

    c[base]     = TRIG_RESIST;
    c[base + 1] = zone(fx.start ?? 1);
    c[base + 2] = force(fx.force ?? 4);
  }

  function buildCommon() {
    const c = new Uint8Array(COMMON_SIZE);

    // HAPTICS_SELECT is the one that actually arms the coils. Both vibration
    // flags are set because which one a pad honours depends on its firmware
    // revision, and the one it doesn't want is ignored rather than rejected.
    c[OFF_FLAG0] = F0_COMPATIBLE_VIBRATION | F0_HAPTICS_SELECT
                 | F0_RIGHT_TRIGGER | F0_LEFT_TRIGGER;
    c[OFF_FLAG2] = F2_COMPATIBLE_VIBRATION2;
    c[OFF_MOTOR_RIGHT] = byte(weak);
    c[OFF_MOTOR_LEFT]  = byte(strong);

    writeTrigger(c, OFF_RIGHT_TRIG, trigR);
    writeTrigger(c, OFF_LEFT_TRIG,  trigL);

    if (ledOn) {
      c[OFF_FLAG1]      = F1_LIGHTBAR;
      c[OFF_LIGHTBAR_R] = led[0];
      c[OFF_LIGHTBAR_G] = led[1];
      c[OFF_LIGHTBAR_B] = led[2];
      // Until the pad is told to put its own light out it keeps fading between
      // its idle colours and ours, which reads as the lightbar ignoring us.
      if (!ledSetup) {
        c[OFF_FLAG2] |= F2_LIGHTBAR_SETUP;
        c[OFF_LIGHTBAR_SETUP] = LIGHTBAR_LIGHT_OUT;
        ledSetup = true;
      }
    }

    return c;
  }

  async function transmit(common) {
    if (!bluetooth) {
      const data = new Uint8Array(dataSize);
      data.set(common.subarray(0, Math.min(common.length, dataSize)), 0);
      await device.sendReport(REPORT_USB, data);
      return;
    }

    // 0x31 framing: seq_tag, tag, the common payload, padding, then a CRC-32
    // over [seed, report id, everything before the CRC].
    const data = new Uint8Array(dataSize);
    data[0] = (seq << 4) | 0x00;
    seq = (seq + 1) & 0x0f;
    data[1] = BT_TAG;
    data.set(common, 2);

    const signed = new Uint8Array(2 + dataSize - 4);
    signed[0] = CRC_SEED;
    signed[1] = REPORT_BT;
    signed.set(data.subarray(0, dataSize - 4), 2);

    const crc = crc32(signed);
    const at = dataSize - 4;
    data[at]     =  crc         & 0xff;
    data[at + 1] = (crc >>> 8)  & 0xff;
    data[at + 2] = (crc >>> 16) & 0xff;
    data[at + 3] = (crc >>> 24) & 0xff;

    await device.sendReport(REPORT_BT, data);
  }

  async function write() {
    if (!device || !device.opened) return;
    if (inFlight) { pending = true; return; }

    inFlight = true;
    try {
      do {
        pending = false;
        await transmit(buildCommon());
        writes++;
        failures = 0;
        if (status !== "connected") { status = "connected"; lastError = ""; }
      } while (pending);
    } catch (e) {
      lastError = String(e?.message ?? e);
      pending = false;
      failures++;
      if (!device.opened) {
        // Pulled out from under us. Idle rather than error — there's nothing
        // wrong here, and the connect handler will pick it up again.
        device = null;
        status = "idle";
      } else if (failures >= MAX_FAILURES) {
        status = "error";
      }
    } finally {
      inFlight = false;
    }
  }

  async function adopt(dev) {
    try {
      if (!dev.opened) await dev.open();
    } catch (e) {
      lastError = String(e?.message ?? e);
      return false;
    }

    device = dev;
    bluetooth = pickTransport(dev);

    const declared = declaredLength(dev, bluetooth ? REPORT_BT : REPORT_USB);
    dataSize = declared || (bluetooth ? BT_DATA_SIZE : USB_DATA_SIZE);

    // Over Bluetooth this is mandatory, not diagnostic: the pad ignores every
    // output report until something reads this feature report. Over USB it's
    // harmless, so it isn't worth branching on.
    try { await dev.receiveFeatureReport(FEATURE_CALIBRATION); }
    catch { /* some stacks refuse it; USB doesn't need it anyway */ }

    seq = 0;
    failures = 0;
    ledSetup = false;
    lastReport = 0;

    // Same reference every time, so re-adopting the same entry can't stack up
    // duplicate handlers.
    dev.removeEventListener("inputreport", onInputReport);
    dev.addEventListener("inputreport", onInputReport);

    // Prove the link with a real report before claiming it. Saying "connected"
    // on the strength of open() alone is what produced a link that reported
    // fine and then did nothing: a device entry can open cleanly and still
    // refuse the output report, and the only way to find out is to send one.
    try {
      await transmit(buildCommon());
      writes++;
      status = "connected";
      lastError = "";
      return true;
    } catch (e) {
      lastError = String(e?.message ?? e);
      try { await dev.close(); } catch { /* nothing to release */ }
      device = null;
      status = "idle";
      return false;
    }
  }

  const isDualSense = (d) =>
    d.vendorId === VENDOR_SONY &&
    (d.productId === PRODUCT_DUALSENSE || d.productId === PRODUCT_DUALSENSE_EDGE);

  // One physical pad can surface as more than one HID entry — a separate one
  // per top-level collection, and another again when it's both plugged in and
  // paired over Bluetooth. Only one of them will take an output report, and it
  // isn't reliably the first. So try them all and keep whichever answers.
  async function adoptAny(list) {
    const pads = list.filter(isDualSense);
    candidates = pads.length;
    for (const d of pads) {
      if (await adopt(d)) return true;
    }
    if (pads.length && status !== "error") status = "error";
    return false;
  }

  if (available) {
    navigator.hid.addEventListener("disconnect", (e) => {
      if (device && e.device === device) {
        device = null;
        status = "idle";
      }
    });

    // Replugging the pad shouldn't cost a page reload. This only ever fires for
    // devices already granted, so re-adopting here needs no user gesture.
    navigator.hid.addEventListener("connect", (e) => {
      if (device || !isDualSense(e.device)) return;
      adoptAny([e.device]);
    });
  }

  return {
    isAvailable: () => available,
    isReady: () => !!device && device.opened && status === "connected",
    status: () => status,
    error: () => lastError,
    transport: () => (bluetooth ? "bluetooth" : "usb"),
    name: () => device?.productName ?? "",
    reportSize: () => dataSize,
    writeCount: () => writes,
    candidates: () => candidates,
    failures: () => failures,
    reportsIn: () => reportsIn,

    // Live input straight off the pad, or null if it isn't currently talking.
    // Shaped like a Gamepad, so it can stand in for one.
    input: () =>
      lastReport && performance.now() - lastReport < INPUT_STALE ? snapshot : null,

    // Devices the user has already granted come back without a prompt, so a
    // reload doesn't cost another permission dialog. Safe to call on a timer:
    // it does nothing while a link is up, and getDevices() shows no UI.
    async reattach() {
      if (!available || (device && device.opened && status !== "error")) return false;
      try {
        return await adoptAny(await navigator.hid.getDevices());
      } catch (e) {
        lastError = String(e?.message ?? e);
        return false;
      }
    },

    // Must be called from a user gesture — a keypress in the console counts.
    async request() {
      if (!available) return false;
      try {
        const devices = await navigator.hid.requestDevice({
          filters: [
            { vendorId: VENDOR_SONY, productId: PRODUCT_DUALSENSE },
            { vendorId: VENDOR_SONY, productId: PRODUCT_DUALSENSE_EDGE },
          ],
        });
        if (!devices.length) { status = "idle"; lastError = "no device chosen"; return false; }
        if (await adoptAny(devices)) return true;
        // Nothing matched the DualSense ids — take the picker's word for it.
        return devices.some(isDualSense) ? false : await adopt(devices[0]);
      } catch (e) {
        lastError = String(e?.message ?? e);
        status = "error";
        return false;
      }
    },

    setRumble(w, s) { weak = w; strong = s; },

    // Amount 0..1 on each trigger, as plain resistance. The nuanced effects go
    // through setTriggerEffect.
    setTriggers(l, r) {
      trigL = l > 0.02 ? { mode: "resist", start: 0, force: 1 + l * 7 } : OFF;
      trigR = r > 0.02 ? { mode: "resist", start: 0, force: 1 + r * 7 } : OFF;
    },

    // fx is {mode:"off"} | {mode:"resist", start, force} | {mode:"buzz", freq, amp, start}
    setTriggerEffect(side, fx) {
      if (side === "left") trigL = fx || OFF;
      else trigR = fx || OFF;
    },

    setLightbar(r, g, b) { led = [r, g, b]; ledOn = true; },
    clearLightbar() { ledOn = false; },

    commit: write,

    async stop() {
      weak = strong = 0;
      trigL = trigR = OFF;
      await write();
    },

    async close() {
      await this.stop();
      try { await device?.close(); } catch { /* already gone */ }
      device = null;
      status = available ? "idle" : "unsupported";
    },
  };
}
