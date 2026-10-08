import { keysFor, label } from "./keymap.js";

// ---------------------------------------------------------------------------
// Things to read while it loads: how to fly, how to sneak, what the islands
// hide. Keys are filled in from the live bindings, so the arrows scheme gets
// its own keys. One is picked at random; the loading screen cycles them.
// ---------------------------------------------------------------------------

const k = (a) => `<kbd>${label(keysFor(a)[0] || "")}</kbd>`;

const TIPS = () => [
  // --- Flying
  `Hold ${k("forward")} to fly, let go to hover. Stopped IS the hover.`,
  `${k("up")} climbs and ${k("down")} descends. Double-tap and hold either to commit to a real climb or dive.`,
  `Hold ${k("sprint")} for 400 mph. Hold ${k("burst")} for 750 — flat out, just under the speed of sound.`,
  `Double-tap and hold ${k("burst")} for turbo: through the sound barrier, to 1,600 mph.`,
  `${k("knifeL")} and ${k("knifeR")} roll him onto a wingtip — the way through a gap too narrow for his wings.`,
  `Double-tap ${k("knifeL")} or ${k("knifeR")} for a barrel roll. It dodges bolas and arrows.`,
  `${k("strafeL")} and ${k("strafeR")} slip him sideways without changing his heading.`,
  `Climb hard enough and he stalls at the top — wings wide, hanging on the air. Let him fall, then pull out.`,
  `A dive is the fastest he can go: 900 mph, but only while he's pointing at the ground.`,
  `At cruise he flaps a few strokes and glides, like a big bird. Climb or slow down and he works his wings again.`,
  `Hitting a cliff stops him dead. Skimming along the ground only slows him.`,
  `Press ${k("alignCamera")} to swing the camera round behind him.`,
  `Tab opens the chart. The minimap, top right, always points the way he's facing.`,
  `Lost? The orange marker on the minimap and the compass is where the story wants you.`,
  // --- Ground
  `Hold ${k("landUse")} near the ground, slow, to land. He folds his wings and walks.`,
  `On foot, ${k("forward")} is a trot and ${k("sprint")} a full gallop.`,
  `He can stand on roofs, crates, cages and ledges — anything solid, not just the ground.`,
  `Too steep to hold? He'll slide. Walk off an edge and he opens his wings before he falls far.`,
  `${k("up")} on the ground takes off.`,
  // --- Fire
  `${k("fire")} fires a plasma blast — instantly, whatever he's doing. Six shots, and they come back.`,
  `Hold ${k("sleepfire")} for sleepfire. It costs food and rest, and it does what plasma can't.`,
  `Hungry? Fly low over the shoal and he'll dive for fish.`,
  // --- Stealth
  `Hunters see roughly where they're facing — and almost never look up.`,
  `A "?" over a hunter means he's suspicious. Get out of his sight before it fills.`,
  `Trees hide you. The deeper the wood between you and a hunter, the less of you he sees.`,
  `A plasma blast is loud. Hunters go to where it landed, not to where you are.`,
  `A gallop carries. A trot barely does. Hard wingbeats can be heard a long way off.`,
  `Night, fog and rain all shorten how far a hunter can see.`,
  `There are three wooded gullies into the hunters' pit. The minimap draws them as dotted trails.`,
  `Hunters who lose you search for a few seconds, then shrug and go back to work.`,
  `Hold ${k("aim")} to turn his head without turning his body — and to see the hunters' vision cones.`,
  // --- The world
  `The archipelago is about ten kilometres across. Berk is the biggest island in it.`,
  `Free flight counts every named island you find. There are thirty-three.`,
  `Glacier Island keeps its snow all year. Dragon Peak is a volcano — nothing grows on it.`,
  `The forest isn't one tree: spruce in the valleys, pine on the ridges, birch at the edges, oak in the warm hollows.`,
  `Wind pines grow on the exposed headlands, all bent the same way. That's the prevailing wind.`,
  `Look for the green seams in the rim of Dragon Hunter Island from the air. They aren't natural.`,
  `Hollow Stack has gulls nesting all down its cliffs.`,
  `Some birches and rowans are already turning gold and red. Autumn comes early in the north.`,
  `The aurora is out most clear nights, and some nights it's out a lot.`,
  `Weather changes on its own in free flight: fair, overcast, rain, storm, fog.`,
  `In a storm, the lightning lights the whole sea for a moment. Look down when it strikes.`,
  // --- Story
  `Hiccup's chart has blank edges. Nobody has been there yet.`,
  `The saddle in Hiccup's house has been waiting eleven days.`,
  `The first tail fin flew badly. They laughed about it.`,
  `Something on the metal plate won't burn. Ordinary fire isn't enough.`,
  `A dragon that can't fly can't fish.`,
  `A Stormcutter has four wings. One of Sigrún's is broken.`,
  `Come in slow and low near a frightened dragon, or she'll rear up.`,
  `The hatchling eats first.`,
  // --- Secrets and odd things
  `Open the debug console with the backtick key. Type "help".`,
  `Console: "time 2" and "weather storm" for a night flight through the lightning.`,
  `Console: "photoreal on" for terrain shadows, haze and a camera grade.`,
  `Settings → Graphics → Grass → Ultra puts grass on every meadow out to three kilometres.`,
  `Your saves are plain text: user1.dat to user4.dat, in the browser's Local Storage. You can edit them.`,
  `Export a journey from its menu to get the .dat file itself.`,
  `Break the sound barrier and listen for the crack.`,
  `Fly through a cloud. They're real volumes, not pictures on the sky.`,
  `Fly through the rain at night with the aurora out. Then thank us.`,
  `The sun shafts through the trees in the gullies lean with the time of day.`,
  `Free flight starts over open water. Turn round.`,
  `Gronckles are stubborn, Nadders are proud, and Thunderdrums are loud. Night Furies are rare.`,
  `Hold still over the sea at night and watch the moon's path on the water.`,
  `He blinks. Watch his eyes when he's hovering.`,
  `The minimap's rim turns with him; the N on it is always north.`,
  `In photoreal, mountains cast real shadows — whole valleys go dark before sunset.`,
  `Too dark? Settings → World lets you pick the time of day.`,
];

/** All tips, with the current keys filled in, shuffled. */
export function shuffledTips() {
  const t = TIPS().filter((s) => !s.includes("<kbd></kbd>"));
  for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
  return t;
}
