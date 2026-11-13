# English — instructional graphics standard and audit

Second edition (Nov 2026, "Professional Baseball Graphics Overhaul"). The first edition's geometric SVG figures
(stick/silhouette players) were retired for every figure that shows a person, a hand or equipment. Research behind the
decisions: `english/research/visual-reference.md` (see its caveat — the research agent could read search excerpts
but not open the source pages, so every reference claim there is marked [S] search excerpt or [I] inference).

## Standard

1. **Accuracy before aesthetics.** Every figure has one concept, one moment, one viewing angle and the terms the
   lesson uses. Nothing is drawn as an absolute when coaches treat it as a judgement call (glove orientation at the belt).
2. **Real bodies, real equipment, real motion.** People are a CC0 MakeHuman athlete (the Call the Game asset), posed
   with inverse kinematics or sampled from CMU motion capture (the delivery figures use the pitch clip at foot strike).
   Glove, cleats, cap and ball are procedural models built to real proportions; the ball's seam is the true
   two-lobed seam curve with 108 stitches.
3. **Editorial render.** Physically based colour pass + a soft ink outline (normal/depth edges, 70 % ink) on a
   transparent background with a contact shadow, composed on brand cream `#F2EBDD`. Uniform: charcoal/oxblood/cream kit;
   naturalistic skin, leather and dirt tones where they help recognition.
4. **Text never lives inside the image.** Callouts are numbered pins (fixed 22 px on screen, 26 px in Expand) over the
   image; the words sit in an HTML bilingual legend under it (order follows the learner's target language), so they
   stay legible at phone width, are read by screen readers and can be translated without re-rendering.
   Highlighted lesson keys turn a pin and its legend row oxblood.
5. **Composition.** One subject per panel, ≤ 6 callouts, sequential or before/after panels for anything with two
   states (glove below/above the belt; thumb side/under; fingers together/spread; rep A/rep B).
6. **Diagrams stay diagrams.** The infield, infield-shade and seam-orientation figures are field/ball schematics
   where a vector drawing is the clearest form; they keep the first-edition SVG components.
7. **No third-party art.** References were studied, never traced or incorporated.

## Production workflow

```
english/tools/studio/          three.js studio (runs in headless Chromium)
  studio.js                    athlete rig, IK, hand/finger solver, ball/glove/cleat/cap models, ink renderer
  figs.js                      one function per render: pose, camera, anchors to project
  run.js                       window.RENDER(name, style) → PNG + projected anchors
english/tools/render-figs.cjs  exporter:  python3 -m http.server 4180 --directory .   (repo root)
                               node english/tools/render-figs.cjs <dir> grip-4s:editorial glove-low:editorial …
english/tools/build-plates.py  <dir> → apps/english/figs/*.webp + apps/english/plates.js (panels, pins, overlays, text)
apps/english/figures.js        plate() renderer; falls back to the SVG components for diagrams
english/tests/figs-qa.cjs      every figure × desktop / iPhone / iPhone dark: images load, pins inside the image and
                               ≥ 20 px, text ≥ 11 px, no overflow, no console errors; writes screenshots
```

Plate copy (captions, callouts, notes) is edited in `build-plates.py` (`P`); callout keys match lesson `highlight`
values. Illustration production (studio) and the UI component (plate renderer) are separate, so the hitting course can
add renders (`figs.js`) and plates (`P`) without touching the app.

## Quality gate

Rubric 1–5 on recognition, anatomy, baseball accuracy, clarity, craft, mobile readability, brand; a figure ships only
with ≥ 4 in every row and no serious anatomy or mechanics error. **Scores below are provisional internal ratings by the
developer from rendered screenshots — not user testing and not a coach's review.** No blind recognition test with real
learners has been run; the "blind" check below is the developer naming each plate from the image alone before reading
its caption, which is a weak proxy.

| Figure | Before (first edition) | After | Recog. | Anat. | Baseball | Clarity | Craft | Mobile | Brand |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| glove-position | silhouettes, fingers-up/down absolutes | two posed fielders, real glove, belt line, judgement note | 5 | 4 | 4 | 4 | 4 | 4 | 5 |
| throwing-setup | silhouette + lane | posed fielder + overhead cleats on the target line | 5 | 4 | 4 | 4 | 4 | 4 | 5 |
| ready-position | silhouette | posed fielder, ¾ view | 5 | 4 | 4 | 5 | 4 | 4 | 5 |
| ground-ball | silhouette | posed fielder, side view, ball in front | 5 | 4 | 4 | 4 | 4 | 4 | 5 |
| footwork-angle | arrows | overhead cleats, ready → first step → crossover route | 4 | — | 4 | 4 | 4 | 4 | 5 |
| hand-fingers | outline hand | rendered hand, palm view | 5 | 4 | — | 5 | 4 | 5 | 5 |
| ball-seams | circle + curves | true seam geometry | 5 | — | 5 | 5 | 5 | 5 | 5 |
| grip-4s | schematic | rendered grip, catcher's view + thumb-under view | 4 | 4 | 4 | 4 | 4 | 4 | 5 |
| grip-2s | schematic | rendered grip along the seams | 4 | 4 | 4 | 4 | 4 | 4 | 5 |
| grip-adjust (thumb / spread) | schematic | before/after renders | 4 | 4 | 4 | 4 | 4 | 4 | 5 |
| grip-change | schematic circle | rendered, ball deep in the hand | **3** | 4 | **3** | **3** | 4 | 4 | 5 |
| delivery-side | stick figure | mocap pose at foot strike, third-base side | 5 | 4 | 4 | 4 | 4 | 4 | 5 |
| delivery-a / -b | stick figures | same mocap instant, front side open vs closed | 4 | 4 | 4 | 4 | 4 | 4 | 5 |
| infield, infield-shade, seam-orientation | vector | unchanged (diagrams) | — | — | — | — | — | — | — |

**grip-change fails the gate** (circle not clearly visible from any camera tried — under, side, catcher's view) and is
listed below as below standard; it ships because the first-edition figure was weaker, not because it passes.

## Known limitations

- Changeup circle: the rig's thumb–index closure does not read as an "O"; needs a hand-specific pose pass or a
  photographed reference hand.
- Faces are untextured MakeHuman faces; fine at lesson size, plain at Expand size.
- Grip close-ups crop the knuckles at the top edge.
- Glove-position panels use different camera distances, so the two belt lines are not at the same height.
- Delivery A/B: "open" is a rotation of the same mocap frame, not a second recorded delivery.

## Questions for a qualified coach (not answered here)

From the research document: belt-high glove orientation; fingertips down vs back of the glove to the dirt on low
balls; drop step vs crossover for the first step; shuffle vs replace-feet before a throw; whether "stay closed" is the
right cue at all for rep A/B; changeup depth and circle; slider pressure and cutter offset (not yet drawn); Spanish
vocabulary choices; glove sizes and the exact 2023 rule wording.

Before/after images: `english/content/graphics-qa/`.
