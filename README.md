# SOLMARA — An Open-World Crime Story

[![Make GTA 6](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/mioand88-collab/gta6-01/rank.svg)](https://make.fun/c/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/mioand88-collab/gta6-01/reward.svg)](https://make.fun/c/gta6-01)

**SOLMARA** is an original open-world crime game in the spirit of GTA 6, built
for the make.fun "Make GTA 6" competition. It runs entirely from static files —
open `game/index.html` in desktop Chrome and play. No build step, no network
requests, no downloads: every sound and song is synthesised live with WebAudio.

## The story

Jax Moreno, a wheelman, comes home to the sun-soaked coastal city of Solmara
with a debt to pay to Dante Kross, who runs the Marlin Club. Six story jobs
take him from a simple package pickup to a bank heist — stealing cars,
collecting debts, losing the police, and holding the docks against the Harbor
Boys.

## What is in the game

- **A living city**: five districts (Downtown, Old Solmara, Palms North,
  Marina Bay, Dockside), a beach and the sea, parks, shops, a hospital and a
  garage — all generated from a seed, so the same city every time.
- **Driving**: steal any car on the street (E), arcade handling with drift,
  handbrake and skid marks, and a damage model — wreck a car and it burns.
- **Traffic and pedestrians**: cars follow the road grid and honk when stuck;
  pedestrians walk the sidewalks and flee from gunfire.
- **Wanted level**: five stars. Crime draws police cars that pursue along the
  roads and ram you, and officers on foot who shoot or arrest you. Lay low
  and the heat fades; get caught and you wake up in Solmara General, 10% of
  your cash lighter.
- **Missions and story**: six jobs with dialogue, objectives, a marker beacon
  and an edge arrow, plus repeatable taxi fares for quick cash.
- **Combat**: fists and a pistol (buy one at IRONWORKS), mouse aim, reload,
  enemy gang members with health bars.
- **HUD and minimap**: health and armor, cash, clock and district, wanted
  stars, speed, weapon and ammo, a live minimap with police blips and the
  mission marker.
- **Day and night**: a full clock cycle — dusk, street lamps, headlights and
  lit windows after dark.
- **Sound and music**: a looping synth track, engine hum, two-tone sirens,
  gunshots and explosions, all synthesised in the browser (N mutes).
- **Save**: progress saves automatically after every job; continue from the
  title screen.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Move on foot, drive |
| Mouse + Click | Aim, shoot |
| E | Enter / steal a car, use a shop, pick up a fare |
| F | Punch |
| R | Reload |
| Shift | Run |
| Space | Handbrake |
| M | Take the next job (phone) |
| H | Help |
| N | Mute |
| Esc | Pause / save |

## How to play

Serve the game folder with any static server — for example, from this
repository run `node serve.ts` and open http://localhost:8080 — or open
`game/index.html` directly from disk.

## Screenshots

The four screenshots in `screenshots/` are real renders of this game, taken
in headless Chromium from the staged scenes the game itself provides
(`?shot=cover|street|mission|night`).

## Credits

SOLMARA is an original work: its city, characters, vehicles, story, art,
sounds and music were all made for this entry. It has no affiliation with
Rockstar Games or the Grand Theft Auto series, and uses none of their names,
characters, maps, art or music.

Licensed under the MIT License — see `LICENSE`.
