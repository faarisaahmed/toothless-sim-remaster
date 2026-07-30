# dragon-flying-sim
A simulator to fly dragons

## Controls

Both schemes sit side by side in the HUD legend. A DualSense (or anything else
the browser reports with the standard mapping) is picked up automatically, and
its column brightens once it connects. Browsers hide gamepads until you press a
button on them, so nothing lights up before that.

| Keyboard | DualSense | |
| --- | --- | --- |
| `A` `D`, `Space` `Shift` | Left stick | Steer — left/right turns, push to climb, pull to dive |
| `J` / `K` | `R2` / `L2` | Accelerate / slow down, analog |
| `W` / `S` | `L3` | Nudge thrust — `L3` drops the trim back to cruise |
| `L` | `✕` | Speed burst |
| `Q` / `E` | `□` / `○` | Strafe sideways, heading unchanged |
| `Z` / `X` | `L1` / `R1` | Hold to knife edge onto a wingtip |
| Mouse | Right stick | Free look |
| `H` | D-pad ↑ | Swing his nose to face the camera |
| `C` | D-pad ↓, `R3` | Swing the camera around behind him |
| — | D-pad ← → | Camera closer / further |
| — | `△` | Toggle the wild flights |
| `Tab` | Touchpad | Chart of the archipelago |
| `G` | — | Terrain contour grid |
| — | `Create` | Hide the HUD |
| `` ` `` | `Options` | Debug console |

D-pad up points him at the camera and D-pad down brings the camera round to him
— the same job from either end. Clouds and water stay console-only (`clouds`,
`water`).

## The chart

`Tab`, or the touchpad on a DualSense, opens a hand-inked Norse sea chart of the
archipelago. The coastlines and relief are traced from the same height field the
terrain mesh is built from, by marching squares over an 384² sample grid — so
what's on the parchment is what you fly over, down to the individual sea stacks.
It's built once into an offscreen canvas during an idle slot after load, and the
only things drawn live are the dragon marker, his heading and the trail of where
he's been.

Rumble is on by default. In the debug console, `rumble <0-1>` and `rumble off`
set the strength, `padsens <n>` and `padsens invert` tune the right stick, and
`pad` prints the connection state.
