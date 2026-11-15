Original prompt: Act as the senior gameplay engineer improving the existing Concrete Jungle project. Make Concrete Jungle a fun, browser-playable WebXR action game: fast rooftop traversal, playful arcade shooting, a compact open-city feel, and stable VR performance. (React + Vite, Three.js, static delivery, native WebXR; two-hand grip locomotion in VR, desktop grapple fallback, wandering NPCs, one car, superhero gauntlets, vibrant low-poly visuals, 72–90 fps.)

## Status
- The Replit source was not accessible. The only upload is the compiled build (concrete-jungle-game.zip), so this is a fresh source build of the same brief.
- Done: start, pause, finish and restart flow; onboarding hints; ring compass; desktop movement with coyote time, jump buffer and mantle; grapple with reel, taut-rope pull and a zip-launch over ledges; pulse shooting with comic popups and combos; 48-pedestrian crowd with knockdown and get-up; arcade car with drift; touch controls; WebXR grip locomotion, snap turn, vignette and haptics.
- Test hooks: window.advanceTime(ms) (switches to manual stepping), window.render_game_to_text(), window.__game.

## Graphics pass (AAA-style look)
- New src/game/graphics.ts with cinematic and performance tiers. The tier is chosen automatically, VR forces performance, and the choice is saved in localStorage as cj-quality.
- Facade, asphalt and pavement PBR shaders; urban palette; parked cars as colliders; traffic signals; road markings.
- QA: SwiftShader is too slow to give meaningful fps numbers for the cinematic tier, so it was checked visually only. The gameplay flow test runs on the performance tier.

## Known limitations
- WebXR has been checked in code only, not on a headset.
- VR collision uses the rig position rather than the head offset. There is no VR HUD yet.
- Music is a simple procedural loop.
