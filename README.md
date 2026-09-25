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
- **Visuals:**
  - **Sky and air:** a physically based sky (Preetham scattering) with lit clouds. Height fog thins with altitude and glows toward the sun, so distant ridges fade the way they would in real haze.
  - **Lighting:** ambient light and reflections come from a capture of the compound itself, so warm light bouncing off the sand shows up in metal and shadows. Bloom, sun shafts, ACES tone mapping and a restrained color grade finish the frame.
  - **Surfaces:** every surface is generated from tileable noise, with its own albedo, normal and roughness maps. That covers wind-rippled sand, stucco with reflective windows, cracked asphalt with worn lane paint, formed concrete, rusted containers, wood grain and sandbag fabric. Walls get dirtier near the ground, and a world-space tint keeps repeated buildings from looking identical.
  - **Soldiers:** enemies are a rigged, animated soldier. Idle, walk and run animations blend by speed, and two-bone IK keeps both hands on the rifle while they aim at you.
  - **Shadows and occlusion:** Ultra adds screen-space ambient occlusion and 4096 sun shadows. Every quality level has soft contact shadows under objects.
  - **Impacts:** bullet hits depend on the surface: sparks off metal, splinters off wood, puffs of sand, and grit and dust off stone.
  - **Scene detail:** swaying grass, natural rocks, balconies, power cables, burning wrecks with billowing smoke, and drifting dust.
  - **Quality levels:** there are three, `Ultra`, `High` and `Low`. If the first seconds of a deployment run slowly, the game steps down a level automatically.

## Files

- `index.html` contains the page, the menus and the HUD markup and styles, plus the import map for three.js.
- `game.js` contains the whole game: renderer, world, physics, AI, weapons, audio and HUD drawing.
- `assets/soldier.glb` is the enemy soldier model.

## Credits

The soldier model (`assets/soldier.glb`, Mixamo's "Vanguard" character with its animations) comes from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf). The model is Mixamo content, so check [Adobe's Mixamo terms](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) before redistributing it on its own. If `assets/soldier.glb` is missing, the game falls back to its built-in soldiers. Everything else is generated in code.

## Settings

Look sensitivity, field of view, volume and graphics quality are in the Settings menu and saved per browser. For graphics, `Ultra` adds ambient occlusion and the sharpest shadows, `High` has full post-processing, and `Low` skips post-processing for phones and older laptops.
