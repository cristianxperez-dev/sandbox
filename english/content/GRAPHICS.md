# English — instructional graphics standard and audit

All lesson diagrams are SVG components in `apps/english/figures.js`, styled by tokens in `apps/english/app.css`
(`--fig-*`, light and dark). Content refers to them by id (`english/content/SCHEMA.md` → Visuals).

## Standard: "schematic but representative"

A graphic **passes** when:
1. someone names the subject within 1–2 seconds, without reading the labels;
2. the teaching point is visually obvious (one emphasis, in oxblood — cream in dark mode);
3. labels support the image; they never rescue it;
4. it looks like a deliberate coaching illustration, not a placeholder;
5. it stays legible on a phone (labels ≥ 11 px rendered, nothing clipped; Expand opens a full-screen sheet);
6. it uses the CP palette only (cream, charcoal, oxblood for emphasis, taupe for secondary), no gradients or effects.

A graphic **fails** when the learner must infer the object, it reads as generic geometry, it needs labels to say what
it is, or it is technically clean but visually unconvincing.

## Drawing vocabulary (reuse these; don't invent new styles)

| Primitive | What it draws | Rules |
| --- | --- | --- |
| `athlete(J, o)` | A filled athletic figure from joint positions: tapered limbs, torso, belt line, capped head, cleated shoes | Near limbs in the body colour, far limbs toned back (taupe); near limbs separated by a knockout outline. Never stick figures. Side view for movement, front view for stance. |
| `glove(cx, cy, rot, scale, {back})` | A fielder's glove: four finger stalls, thumb, laced web, heel, pocket | Rotation shows the cue (0 = fingers up, 180 = fingers down). `back` hides the pocket (glove seen from behind). |
| `ball(cx, cy, r, rot)` / `ballSm` | A baseball with horseshoe seams and red stitching | `rot` 90 = horseshoe across (four-seam view), 0 = seams vertical (two-seam view). |
| `gripHand(variant, highlight)` | A right hand holding the ball, seen from behind: knuckles, fingers with nails and creases, curled ring finger, hidden thumb shown dashed | Variants `four`, `two`, `change` (thumb + index circle). |
| `sideGrip(...)` / `band(...)` | Hand and ball in profile: index finger over the top, thumb under the ball | For thumb placement; a dashed band shows the "before" position. |
| `shoePrint(x, y, rot, {hl, ghost})` | A top-view cleat print | Footwork and stance from above; never ellipses for feet. |
| `label`, `lead`, `arrow` | Bilingual callouts (language being learned first, translation in taupe italic, wrapped), leaders with a dot on the part, cue arrows (straight or curved) | One highlighted label per figure. |

Composition: subject left, callouts right; one emphasis per view; ground line + dirt band under standing figures;
a monospace caption names the view ("From above…", "View: from behind the pitcher's hand"). Illustrated reps are always
labelled "illustration, not a real pitcher".

## Audit (Nov 2026) — 19 figures

| Figure | Before | Verdict | After |
| --- | --- | --- | --- |
| ball-seams | Ball with dashed seams | Pass (weak) | Fuller ball, curved horseshoe seams with stitching, highlight edge |
| seam-orientation | Duplicate of ball-seams | Fail (taught nothing) | Two balls side by side: horseshoe across (four-seam) vs seams vertical (two-seam), with finger guide lines |
| hand-fingers | Detached tubes, box thumb | Fail | Open right hand, palm side: joined palm, tapered fingers with creases and pads, opposable thumb, palm lines; numbered legend |
| grip-4s / grip-2s | Rectangles from above, no hand | Fail | Hand holding the ball from behind: knuckles, nails, curled ring finger, hidden thumb dashed; seam orientation correct for each grip |
| grip-change | Rectangles + ring blob | Fail | Middle + ring on top, pinky on the side, thumb + index forming a circle on the side |
| grip-adjust (+ thumb, spread) | Ghost rectangles | Fail | Profile of the hand gripping the ball (thumb moving from the side to under the ball, curved cue arrow); fingers together → a little apart |
| delivery-side | Jointed stick mannequin | Fail | Pitcher at foot strike on a mound: stride leg, front side with glove, ball in the throwing hand, capped head |
| delivery-a / -b | Lines and dots | Weak | From above: capped head, shoulder and hip bars, cleat prints, direction to the plate |
| ready-position | Stick figure, side | Fail | Front view: wide stance, knees bent, glove out and open, weight forward |
| glove-position | Rounded blocks | Fail | Two fielders: low ball with glove fingers down at the ground; chest-high ball with fingers up; waist line |
| ground-ball | Stick figure, bare triangle | Fail | Fielder low with a flat back, glove out front at the ball, eyes on it; triangle from above with cleat prints and glove |
| footwork-angle | Lines and a circle | Fail | From above: ready prints, highlighted first step, curved route, fielding position with glove, through the ball |
| throwing-setup | Ellipses and a line | Fail | Infielder with feet set in line, glove shoulder at the target, arm back with the ball; throwing lane to first base |
| infield / infield-shade | Diamond with positions | Pass | Grass arc added; unchanged otherwise |

Validation: every figure checked in light and dark at desktop and iPhone widths; browser tests assert labels ≥ 11 px and the
Expand sheet (`english/tests/app.e2e.cjs` §11).
