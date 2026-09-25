# Operation Ironveil

A first-person shooter for the browser, in the spirit of Call of Duty. You hold a dawn-lit desert compound against waves of attackers, using four weapons, frag grenades and kill-streak rewards. It's built with [three.js](https://threejs.org). There are no image or sound files: every texture, model and sound is generated in code.

## Play

The game is plain HTML and JavaScript and needs no build step. It loads three.js from a CDN, so you need an internet connection, and the files have to be served over HTTP (not opened as a `file://` URL):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

It also works on GitHub Pages: set Pages to deploy from this branch's root.

Desktop browsers with a keyboard and mouse give the best experience. Phones and tablets get on-screen touch controls.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Left click / right click | Fire / aim down sights |
| `Shift` | Sprint |
| `C` | Crouch; slide while sprinting |
| `Space` | Jump |
| `R` | Reload |
| `1`–`4`, `Q`, mouse wheel | Switch weapon |
| `G` | Throw frag grenade |
| `V` or `F` | Melee |
| `B` | Call in an airstrike on your aim point |
| `Esc` / `P` | Pause |

## What's in it

- **Four weapons, each with its own handling.** AR-7 carbine (red dot), VK-9 suppressed SMG (holographic sight), Brecher-12 pump shotgun (iron sights) and Longbow .338 bolt-action sniper (full scope overlay). Each has its own recoil, spread bloom, damage falloff, ADS zoom, reload animation and synthesized sound. The viewmodels include hands, shell ejection, weapon bob, sway, sprint pose, pump and bolt cycling, and magazine swaps.
- **Movement:** sprint, crouch, jump, and a slide from a sprint. Head bob and footsteps follow your speed.
- **Enemy AI.** Riflemen spread out to flank you. Juggernauts are armored and push to close range. Marksmen take rooftop and tower positions, and their red laser and scope glint warn you about 1.7 seconds before they fire. Enemies hunt, strafe, fire in bursts and react to gunfire. Their accuracy depends on your range, speed and stance, and they navigate around cover.
- **Hit feedback:** headshots and limb multipliers, hitmarkers, helmets knocked off by headshot kills, ragdoll-style falls, blood and impact sparks, bullet-hole decals, and moving tracers.
- **Kill streaks:** a 3-kill streak starts a 30-second UAV sweep that reveals every hostile on the radar. A 6-kill streak earns an airstrike: a jet flies over and drops a line of seven bombs. The streak resets if you drop to critical health.
- **HUD:** a rotating radar that shows enemies when they fire, a heading compass, a kill feed, score pop-ups (headshot, longshot, double and triple kill), a dynamic crosshair that turns red over enemies, damage-direction arcs, a low-health vignette and heartbeat, and an ammo readout.
- **Waves.** Each wave is bigger and adds tougher enemy types. Between waves you get a resupply, and enemies drop ammo crates. Your best score is saved in the browser.
- **Visuals:** HDR rendering with bloom, sun shafts, ACES tone mapping, a cinematic color grade, chromatic aberration and film grain. Surfaces use generated normal maps, and the ground has large-scale color variation to hide tiling. Soft contact shadows sit under every object, and sun shadows follow the player. The scene also has swaying grass, rocks, balconies, wall units, sagging power cables, a procedural sky with clouds, fog and distant mountains, burning wrecks with noise-textured smoke, and drifting dust. The `Low` graphics setting skips post-processing for slower devices.

## Files

- `index.html` contains the page, the menus and the HUD markup and styles.
- `game.js` contains the whole game: renderer, world, physics, AI, weapons, audio and HUD drawing.

## Settings

Look sensitivity, field of view, volume and graphics quality (`High` has shadows and full resolution; `Low` is lighter for laptops and phones) are in the Settings menu and saved per browser.
