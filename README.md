# Neon Void Runner

A first-person neon space platformer for Chrome, built with Three.js. You play an astronaut on glowing floating platforms: run, double jump, shoot alien drones, collect stars and reach the portal. You get 3 lives and every level is harder than the last.

**▶ Play now:** https://merchantsteam29.github.io/neon-space-runner/

## Run it

ES modules don't load from `file://`, so serve the folder:

```bash
node serve.js
# open http://localhost:8080 in Chrome
```

Any static server works (`npx serve`, VS Code Live Server, GitHub Pages). There's no build step. Three.js 0.160 loads from the unpkg CDN through an import map, so the first load needs internet.

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Move | WASD / arrow keys | Left thumb: a floating joystick appears where you touch |
| Aim | Mouse (pointer lock) | Drag anywhere on the right side |
| Shoot | Left click (hold for auto-fire) | Hold **FIRE**. You can keep dragging on it to aim while shooting |
| Jump / double jump | Space (press again in the air) | **JUMP** (tap again in the air) |
| Pause | Esc / P | ❚❚ button (top right) |
| Mute | M | Pause menu → Sound |

The touch layout keeps the joystick in the bottom-left, JUMP in the bottom-right corner and FIRE just above and to the left of it. They all respect phone safe areas and stay clear of the HUD. Touch mode also adds light aim assist and bigger drone hitboxes. The game switches between touch and mouse automatically based on the last input you used.

## Gameplay

- **Stars**: worth 100 each. Some float over the gaps and you need a double jump to reach them. Grab every star in a level for a +1000 bonus.
- **Drones**: worth 250 or more. They patrol until you get close, then circle you and fire pink plasma bolts. Their eye swells just before they shoot.
- **Shield**: each bolt takes about a third of your shield. It recharges after 3 seconds without a hit. You lose a life when the shield hits zero or when you fall into the void.
- **Lives**: you start with 3. After losing one you respawn on the last solid platform you stood on, with a moment of invulnerability.
- **Portal**: walk into it to clear the level and get 500 × level points. Its light beam shows you where it is from far away.

### Difficulty ramp (levels are endless and procedurally generated)

| Level | What changes |
|---|---|
| 1 | 11 platforms, 2 drones, short gaps |
| 2+ | Moving platforms (sideways and up/down) |
| 4+ | Orange **crumbling** platforms flicker and drop away soon after you land on them, then reappear 3 s later |
| 4, 7, 10… | Drones take one more hit to kill |
| Every level | More platforms (up to 32), smaller platforms, wider gaps, more drones (up to 12) that are faster and fire more often with faster bolts, plus faster music |

Your best score is saved in `localStorage`.

## Files

```
index.html   screens, HUD, touch controls, import map
style.css    neon UI, responsive and safe-area-aware layout
game.js      the whole game (rendering, physics, level generation, AI, audio, input)
serve.js     zero-dependency Node static server
```

## Tech notes

- **Rendering**: Three.js 0.160 with an `EffectComposer`, an `UnrealBloomPass` for the neon glow and ACES tone mapping. Platforms use a canvas-generated grid texture as their emissive map. Edges are drawn as line segments.
- **Physics**: fixed 120 Hz steps and axis-separated AABB collision. Includes coyote time, a jump buffer, a small ledge step-up assist, and riding on moving platforms.
- **Audio**: everything is synthesized with WebAudio, including the sound effects and a synthwave loop (Am–F–C–G) whose tempo rises with the level. There are no audio files.
- Pixel ratio is capped (1.25 on touch devices) to keep the frame rate smooth.
