# Story, missions and cutscenes — what the research says

Notes from reading around quest design, narrative design and cutscene direction,
written against *this* game rather than in the abstract. Sources at the bottom.

STORY.md is the bible — what happens and why. This is the craft layer: how to
deliver any of it without losing the player. Where the two disagree, STORY.md
wins on content and this wins on presentation.

---

## 1. Clarity is not the enemy of mystery

The single most repeated finding, and the one this game was failing: **the player
must always know what to do and where to go, even when they do not know why it
matters yet.** Ambiguity about the *goal* reads as a broken game. Ambiguity about
the *meaning* is the thing you are actually selling.

Those are separable, and this project had them tangled. "Do it awake." is a
gorgeous objective line and a terrible instruction. The fix is not to explain the
theme — it is to keep the poetry on the objective line and put the verb somewhere
else on screen.

Concretely, three layers, and the game now has all three:

| Layer | Says | Example here |
|---|---|---|
| Objective | *why*, in the game's own voice | "Do it awake." |
| Sub-line | *what*, plainly | "Hold **F**." |
| Prompt | *how, right now*, contextual | "Too fast to land — let go of **W**" |

The third layer was the missing one. A prompt that goes blank when you are doing
the wrong thing teaches nothing; a prompt that names the failing condition and
the key that fixes it is a tutorial that never has to be a tutorial.

## 2. Signpost the destination, not the route

The guidance is to make the next goal visible enough to remove frustration
without removing the exploration. A waypoint that says *there* is good. A line on
the ground that says *this way* is not, in a game whose whole premise is that the
edges of the chart are blank.

For this game that means the waypoint marker and its distance stay, and route
signposting should be done with **light and sound** instead: the furnace glow on
the inside of the caldera rim, the noise of the compound before you can see it.
Those are already in STORY.md ("sound before sight") and they are the correct
tool. The island's rim is a better signpost than any arrow, because it is visible
from 3 km and it is also the obstacle.

## 3. Environmental storytelling is the cheap, strong option

Repeated everywhere: environmental storytelling is *active discovery* where a
cutscene is *passive reception*, and players value what they assemble themselves
far more than what they are handed. It is also, for a project this size, an order
of magnitude cheaper than cinematics.

This game is unusually well set up for it and is under-using it. The cages, the
braziers, the guard routes and the crates are all already there and all already
say something. Things that would cost almost nothing and pay well:

- **Empty cages next to full ones.** Says the operation is working without a line
  of dialogue.
- **A cage too small for what is in it.**
- **Scorch marks that are not his.** Somebody else has fired here.
- **The compound visibly bigger on a second visit** — M2's "rebuilt properly"
  beat in STORY.md §7 is exactly this, and it lands only if the first visit was
  legible enough to compare against.

Rule of thumb from the reading: use gameplay/environment for world-building and
routine discovery; reserve taking the camera away for things that genuinely
cannot be played.

## 4. Cutscenes: short, skippable, and never a competence demo

The consensus:

- **Always skippable**, and on a *hold* rather than a press, so nobody skips by
  accident on a first playthrough.
- **In-engine, not pre-rendered**, for consistency and file size. This game
  already does this and should keep doing it.
- **Never take control to show the character doing something the player could
  have done.** That is the cardinal sin — it tells the player their skill is not
  the point.
- Consider making one or two genuine emotional beats unskippable, and no others.

STORY.md §5 already says "under 45 seconds, never takes the controls to show
competence, never explains", which matches the research almost exactly. The gap was implementation: `playCutscene` had **no skip at all** and ran on a
bare `setTimeout`. It now resolves early when Space, Escape or Enter is *held*
for half a second, with a bar that fills as you hold and a prompt that appears a
beat late so a short scene is not advertising its own exit. Hold rather than
press, because this game drops you into a cutscene straight out of flight with
your fingers already on the keys.

## 5. Structure and pacing

Three-act structure (setup / confrontation / resolution) is the default scaffold,
with the advice to **alternate high-intensity and low-intensity beats** so the
player can process what just happened.

Mission 1's beat list is already shaped like this and the alternation is good:
`leave → beyond → rig-find → rig-recon → stack-find → lab → sleep → fire → hunt
→ raid → after`. Quiet, quiet, tense, tense, quiet, quiet, quiet, tense...

Two pacing notes specific to it:

- **`rig-recon` and `raid` are the two spikes.** Everything either side should
  stay slow on purpose. Resist adding action to the lab or the shoal.
- **Distance is pacing.** The compound is now ~1.7 km from Hollow Stack, which
  at cruise is about half a minute of flying. That gap is not dead time — it is
  the decompression between spikes, and it is why the island should not be moved
  closer for convenience.

## 6. Make the quest mean something

"Tie quests to lore, characters and progression so they do not feel like filler."
This game's version of progression is unusually strong and worth protecting:
**befriending a species is acquiring a key** (§2.2). No shops, no upgrade trees.
Every mission should end with the player holding something they did not have,
and it should be a relationship rather than an item.

The corollary the research implies and STORY.md already states bluntly: if
destroying a rig accomplishes almost nothing (§7's own admission — it is running
again by M2), the *player* has to be told that in a way that reads as tragedy
rather than as the game wasting their time. That is a narrative problem, not a
mission-design one, and the answer is that the second visit must be visibly,
specifically *better built* than the first — a consequence of his own attack.

---

## What was actually changed off the back of this

- Three-layer guidance: objective / sub-line / contextual prompt, with the prompt
  now naming the blocking condition and the key that clears it.
- Waypoint distance shown on the objective panel as well as on the marker, since
  the marker is usually clamped to a screen edge behind you.
- A "blocked" prompt style distinct from an "act now" prompt, so the difference
  is learnable without reading.
- The compound moved onto land so the player can be *in* it — the precondition
  for every environmental-storytelling idea in §3 above.

## Still outstanding

- Cutscenes cannot be interrupted by damage or death, because neither exists yet.
- Nothing is marked unskippable yet. The reading suggests one or two genuine
  emotional beats should be — `playCutscene({ skippable: false })` is wired for it.
- No second-visit state for the compound, so M2's central beat has nothing to
  compare against.

---

## Sources

- [Game Quest Design: Definition, Process, Examples — gamedesignskills.com](https://gamedesignskills.com/game-design/quest-design/)
- [17 Types of Game Quests — gamedesignskills.com](https://gamedesignskills.com/game-design/game-quest-types/)
- [Environmental Storytelling in Video Games — gamedesignskills.com](https://gamedesignskills.com/game-design/environmental-storytelling/)
- [My Level Design Guidelines — Michael Barclay](https://mikebarclay.co.uk/my-level-design-guidelines/)
- [Better Game Design Through Cutscenes — Game Developer](https://www.gamedeveloper.com/design/better-game-design-through-cutscenes)
- [When Cutscenes Enhance or Disrupt the Gaming Flow — Algoryte](https://www.algoryte.com/blogs/when-cutscenes-enhance-or-disrupt-the-gaming-flow/)
- [Cutscene Direction & Game Cinematics Guide — MoCap Online](https://mocaponline.com/blogs/mocap-news/cutscene-direction-game-cinematics)
- [Reclaiming the Narrative: Environmental Storytelling — Wayline](https://www.wayline.io/blog/reclaiming-narrative-reviving-environmental-storytelling)
- [Storytelling in Game Design — Wayline](https://www.wayline.io/blog/storytelling-in-game-design-techniques-for-narrative-games)
- [The Art of Writing Game Quests and Missions — ELVTR](https://elvtr.com/blog/the-art-of-writing-game-quests-and-missions)
