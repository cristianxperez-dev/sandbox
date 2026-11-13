# Call the Game — 3D rendering architecture, assets and licences

## Architecture

- **Renderer:** three.js 0.180.0 (MIT). It is vendored in `apps/call-the-game/vendor/` because the page's CSP allows same-origin scripts only.
  - Vendored files: `three.module.min.js`, `three.core.min.js`, `GLTFLoader.js`, `BufferGeometryUtils.js` and `SkeletonUtils.js`.
  - There is no framework and no build step.
- **Modules** (all ES modules in `apps/call-the-game/`):
  - `world3d.js`: coordinates, player rig, equipment, uniform shader, renderer and camera.
  - `stadium3d.js`: the ballpark.
  - `scene3d.js`: the game choreography. It exposes the same `window.CTGScene.create()` interface as the old 2D scene. `engine.js` (rules, simulation, grading) and `app.js` are untouched apart from a test hook and the reticle drawing on the pad.
- **Coordinate system:** metres.
  - Axes: x is the catcher's right, y is up, z points toward the catcher.
  - The front of home plate is at z = 0. The rubber is at z = −18.44 m (60 ft 6 in) on a 10-inch mound.
  - The engine works in feet: its (x, y, z) maps to (x, z, −y) × 0.3048.
- **Camera:** 6.4 m behind the front of the plate (just behind the umpire), 1.6 m high, with a 27–40° vertical field of view depending on aspect ratio.
  - The hitter looks large and the pitcher small purely because of distance.
  - No asset is scaled for effect.

## Players: real bodies, real motion

| Asset | Source | Licence |
| --- | --- | --- |
| Body mesh (`base.obj`, 13,380 body vertices), macro shape targets (male, young, muscular, height, ideal proportions, ethnic blend) | MakeHuman 1.x system assets — [makehumancommunity/makehuman](https://github.com/makehumancommunity/makehuman), `makehuman/data/` | **CC0 1.0** (explicitly released Sept 2020, `LICENSE.ASSETS.md`) |
| Skeleton (MakeHuman default rig, 163 bones → 74 kept) and skin weights (`default.mhskel`, `default_weights.mhw`) | same | **CC0 1.0** |
| Motion capture: **124_07 Baseball Swing**, **124_01 Baseball Pitch** (subject 124, 120 Hz, optical mocap of a real performer) | CMU Graphics Lab Motion Capture Database, cgspeed BVH conversion by B. Hahne, mirrored at [sfd158/cmu-mocap](https://github.com/sfd158/cmu-mocap) | "free for use in research and **commercial** projects worldwide" (CMU). Requested acknowledgement: *The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.* |
| three.js | npm `three@0.180.0` | MIT (`vendor/three-LICENSE.txt`) |

No game assets, marketplace models or unlicensed files are used. Equipment is modelled procedurally at regulation size:
- 34-inch bat (lathe profile)
- batting helmet with an ear flap on the side facing the pitcher
- fitted cap
- glove
- ball with seams

### Pipeline (`call-the-game/pipeline/`, Python + numpy)

1. **`mh.py`:** applies the macro targets the way MakeHuman's modifiers blend them. It then computes joints from the rig's vertex groups (so the skeleton fits the morphed body) and folds facial, toe and breast bones into their parents.
2. **`garment.py`:** builds the uniform.
   - A **UV-space region mask** with crisp cut lines that don't follow mesh topology: collar, sleeve end, belt, knee, sock and shoe lines, plus a number on the back of the jersey.
   - A **cloth proxy**: the surface under fabric is Laplacian-smoothed per fabric and given a thickness, so anatomy doesn't show through.
   - The runtime shader colours each region from a per-team palette.
3. **`retarget.py`:** rest-pose-alignment retargeting.
   - Each MakeHuman bone follows one CMU joint: `R_b(t) = D_J(t) · C_b`.
   - `D_J` is the actor's rotation away from the T-pose (frame 0 of every cgspeed file).
   - `C_b` aligns the MakeHuman rest bone with the same segment in that T-pose.
   - The hips' translation is scaled by leg length.
   - **Left-handed hitter and pitcher:** the capture is reflected across the actor's sagittal plane and left/right joints are swapped *before* retargeting. The result is a genuine left-handed motion (left hand on top of the bat, flap on the correct ear), not a negatively scaled mesh.
4. **`build.py`:** writes `assets/player.glb` (skinned mesh plus 4 clips at 60 fps, 1.97 MB), `assets/player.json` (clip events, hand frames, bat axis) and `assets/uniform-mask.png`.

### The bat

The capture has no bat. Its axis comes from the **bottom hand's captured orientation**: a fixed direction across the palm in that hand's frame.

This is a data-driven bat path. During the swing the two hands' independent estimates agree within 6–18°, which is what a real grip would produce.

At runtime:
- The bat is a child of the bottom hand bone and passes through the fist.
- Two-bone IK closes the top hand on the handle directly above the bottom hand.

### Runtime choreography (driven by engine records, never the reverse)

1. **Release:** the ball stays in the throwing hand's palm until the capture's release frame.
2. **Flight:** `p(k) = R + (E − R)k + B(k² − k)`.
   - `R` is the hand's actual release point.
   - `E` is the engine's simulated endpoint, which the ball reaches exactly.
   - `B` is the engine's pitch movement.
   - The flight time is the engine's.
3. **Swing timing:** the contact instant is calibrated from the bat's geometry, at the moment the barrel is square across the plate. The swing clip is aligned so contact coincides with the ball's arrival.
   - The last 0.3 s before contact runs 25% faster, mapped continuously with no jump in the pose.
4. **Pitch height:** matched by a calibrated mix of trunk flexion and barrel tilt at the bottom hand. A whiff passes about 11–13 cm over or under the ball.
5. **Take:** load and stride, hold, then cross-fade back to the stance.
6. **Ball after the plate:** fouls and balls in play follow the engine's batted-ball type, spray and quality. The camera eases to follow lofted balls.

## Known limitations

- **Two captured motions.** There is one swing and one delivery, mirrored for each hand.
  - Every hitter swings the same way, and every pitcher throws from the same windup (no stretch delivery).
  - Stance variety is limited to body height, skin tone and a small open/closed rotation.
- **Amateur performer.** The CMU actor is a recreational athlete.
  - The swing is quick enough once the last 0.3 s are sped up.
  - The delivery's leg kick and arm path are real, but slower than a big-league fastball delivery.
- **No catcher or umpire model.** You are the catcher, so pitches finish at the plate and the result is announced.
- **Faces** are MakeHuman base faces with no textures (skin colour only). The helmet and cap hide most of the head.
- **Next step for higher quality:** licensed professional baseball motion capture would raise the ceiling the most.
  - Options include a mocap shoot, or commercial packs such as Mixamo's "Baseball Pitching" and "Baseball Hit" clips, which are free under Adobe's terms but need an Adobe account to download.
  - Marketplace baseball animation packs are another option, but each one's licence must be verified before use.
  - A sculpted, textured player model would also help.
  - The pipeline can retarget any BVH or FBX onto the same rig.
