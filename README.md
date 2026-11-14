# Concrete Jungle

A browser-playable WebXR action sandbox: fast rooftop traversal, playful arcade shooting and a compact open-city district. Built with React + Vite, Three.js and native WebXR, and delivered as a static page.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (relative paths, works on any static host)
npm run typecheck  # tsc --noEmit
npm test           # vitest unit tests (physics, grip locomotion, city layout)
```

On Replit, import this repo and press Run. The `.replit` file runs `npm run dev` on port 5173.
WebXR needs HTTPS or localhost.

## Goal

Collect all 12 sky rings as fast as you can. Knock pedestrians over with kinetic pulses (non-graphic: they tumble, bounce and get back up) to build combos and score.

## Controls

| Action | Desktop | Touch | VR |
| --- | --- | --- | --- |
| Move | WASD (Shift sprints) | Left stick | Left stick, or grip locomotion |
| Look | Mouse (click to lock) | Drag the right side | Head + snap turn (right stick) |
| Jump / air hop | Space | JUMP | Grip-release launch |
| Fire pulse | Left click | FIRE | Trigger |
| Grapple swing | Right click or Q (hold); Space reels in faster | SWING (hold) | Grip air or surfaces and pull |
| Car enter / exit | F | CAR | A/X to enter, B/Y to exit |
| Horn / handbrake drift | H / Space | JUMP drifts | |
| Pause / restart | Esc or P / R | II | |
| Mute | M | | |

VR traversal: hold one or both grips, pull your hands, and your body moves the opposite way. Release while moving to launch with that momentum.
On desktop, the grapple stands in for this. Grappling a roof edge reels you in and pops you up over the ledge.

Add `?debug` to the URL (or press the backtick key) to show fps and draw calls.

## Structure

- `src/game/Game.ts`: engine loop, modes, movement, grapple, combat, car, rings, VR input
- `src/game/physics.ts`: AABB collision, broadphase grid, raycasts
- `src/game/grip.ts`: VR two-hand grip locomotion
- `src/game/city.ts`, `cityMesh.ts`: seeded district layout and instanced low-poly meshes
- `src/game/npcs.ts`, `car.ts`, `fx.ts`, `audio.ts`, `gauntlet.ts`: crowd, vehicle, effects, procedural audio, hands
- `src/App.tsx`, `src/TouchControls.tsx`: menu, HUD, pause and finish screens, touch controls

`concrete-jungle-game.zip` is the earlier compiled Replit build, kept for reference. It has no source.

## Roadmap

1. Traffic, plus a second vehicle
2. VR wrist HUD and comfort settings (vignette strength, snap-turn angle)
3. Roof-edge grab and ledge system, with grip-on-surface feedback
4. Later: planes and an in-game phone or menu. Multiplayer and tag rules come after the single-player loop is solid.
