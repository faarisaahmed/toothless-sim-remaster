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
  { id: "peacetime", n: "I",    title: "Peacetime",       beats: ["leave"],
    blurb: "A month after the war. Nothing needs him." },
  { id: "wood",      n: "II",   title: "The Wood",        beats: ["woods", "camp"],
    blurb: "The last island on the chart, and something that was done to it." },
  { id: "pit",       n: "III",  title: "The Pit",         beats: ["beyond", "rig-find", "rig-look", "strike", "escape"],
    blurb: "Lights past the edge of the chart, and the men who keep them." },
  { id: "stack",     n: "IV",   title: "Hollow Stack",    beats: ["stack-find", "lab", "sleep", "fire"],
    blurb: "Somewhere to rest, a plate that will not burn, and a night that changes it." },
  { id: "storm",     n: "V",    title: "The Stormcutter", beats: ["hunt", "cry", "approach", "feed", "watch"],
    blurb: "A cry across the water, and somebody else's catastrophe." },
  { id: "plan",      n: "VI",   title: "The Plan",        beats: ["recon"],
    blurb: "Learn the pit before he goes back into it." },
  { id: "lights",    n: "VII",  title: "Lights Out",      beats: ["dusk", "raid", "choice", "caught"],
    blurb: "Sixteen fires, a ring of cages, and the dark on his side — until it isn't." },
  { id: "wings",     n: "VIII", title: "Four Wings",      beats: ["cage", "rescue", "last-cages", "flee"],
    blurb: "He never wins a fight in this story. He doesn't have to." },
  { id: "home",      n: "IX",   title: "After",           beats: ["after"],
    blurb: "Empty cages, and a stack to come back to." },
];

/** Beats that were renamed, so an old save lands somewhere sensible. */
export const BEAT_ALIAS = { "rig-recon": "rig-look" };

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
