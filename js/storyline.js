// ---------------------------------------------------------------------------
// The story's table of contents.
//
// Plain data with no imports, so the title screen and the save slots can name
// chapters and measure progress without loading the flight sim. chapters.js
// owns the beats themselves and attaches what a chapter needs at runtime —
// where a replay starts, what the world must look like — to these same ids.
// ---------------------------------------------------------------------------

export const STORY_TITLE = "The Metal and the Dark";

export const CHAPTER_LIST = [
  { id: "peacetime", n: "I",   title: "Peacetime",     beats: ["leave"],
    blurb: "A month after the war. Nothing needs him." },
  { id: "wood",      n: "II",  title: "The Wood",      beats: ["woods", "camp"],
    blurb: "The last island on the chart, and something that was done to it." },
  { id: "edge",      n: "III", title: "Past the Edge", beats: ["beyond", "rig-find", "rig-recon"],
    blurb: "A drag mark to the water, and lights where there should be none." },
  { id: "stack",     n: "IV",  title: "Hollow Stack",  beats: ["stack-find", "lab", "sleep", "fire"],
    blurb: "Somewhere to rest, a plate that will not burn, and a night that changes it." },
  { id: "hunger",    n: "V",   title: "Hunger",        beats: ["hunt"],
    blurb: "Fire costs. He has paid, and now he has to eat." },
  { id: "lights",    n: "VI",  title: "Lights Out",    beats: ["dusk", "raid"],
    blurb: "Sixteen fires, eight cages, and the dark on his side." },
  { id: "home",      n: "VII", title: "After",         beats: ["after"],
    blurb: "Empty cages, and a stack to come back to." },
];

/** Every beat, in play order. */
export const BEAT_ORDER = CHAPTER_LIST.flatMap((c) => c.beats);

export function chapterOfBeat(beatId) {
  return CHAPTER_LIST.find((c) => c.beats.includes(beatId)) || null;
}

export function chapterById(id) {
  return CHAPTER_LIST.find((c) => c.id === id) || null;
}

/** 0..1 through the whole story, by beat. */
export function beatProgress(beatId, finished = false) {
  if (finished) return 1;
  const i = BEAT_ORDER.indexOf(beatId);
  return i < 0 ? 0 : i / BEAT_ORDER.length;
}
