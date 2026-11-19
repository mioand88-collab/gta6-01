// missions.js — the story of SOLMARA and its side work.
// Jax Moreno comes home to Solmara owing money to Dante Kross, who runs the
// Marlin Club. Six story missions pay the debt down; taxi fares and pickups
// earn cash between them. Everything here is original fiction.

import { dist, clamp } from './util.js';
import { addHeat, addParticle, hurtPlayer } from './entities.js';
import { randomRoadPoint, nearestIntersection } from './city.js';

// Mission steps: goto (reach the marker), steal (get in the marked car),
// bringTo (drive the marked car to the marker), fight (defeat all enemies),
// collect (stand in the marker while the timer runs), survive (stay alive
// until the timer ends), deliver (drive the marked car to the marker in time).
export const MISSIONS = [
  {
    id: 1, title: 'Homecoming', giver: 'Mona',
    brief: 'Mona needs a package picked up from Old Solmara and brought to her food truck. Easy money. Drive, don\'t walk — she\'s on a schedule.',
    reward: 150,
    steps: [
      { type: 'goto', label: 'Pick up the package in Old Solmara', x: 560, y: 1130 },
      { type: 'goto', label: 'Deliver it to Mona\'s food truck', x: 860, y: 530 },
    ],
  },
  {
    id: 2, title: 'Wheels for Eddie', giver: 'Big Eddie',
    brief: 'Eddie needs a fast car for a buyer who asks no questions. The red sports coupe parked near the Marina is the one. Take it — quietly — and bring it to Payback Garage.',
    reward: 250,
    steps: [
      { type: 'steal', label: 'Steal the red coupe by the Marina', x: 2960, y: 830, carColor: '#c23b2e', carModel: 'Sports' },
      { type: 'bringTo', label: 'Bring the coupe to Payback Garage', x: 2360, y: 2330 },
    ],
  },
  {
    id: 3, title: 'The Collection', giver: 'Dante Kross',
    brief: 'A dockworker named Pell owes the club four hundred dollars. Go remind him — and his two friends — that debts get paid. Then get out before the police arrive.',
    reward: 400,
    steps: [
      { type: 'goto', label: 'Find Pell at the Dockside warehouses', x: 860, y: 2030, spawnEnemies: 3 },
      { type: 'fight', label: 'Convince Pell and his crew to pay up' },
      { type: 'goto', label: 'Get clear of the docks', x: 1760, y: 1730 },
    ],
  },
  {
    id: 4, title: 'The Getaway', giver: 'Big Eddie',
    brief: 'Eddie\'s crew hit a warehouse and the police are already rolling. Take the getaway car from the garage and lose them. Don\'t stop for anything.',
    reward: 500,
    steps: [
      { type: 'steal', label: 'Take the getaway car at Payback Garage', x: 2360, y: 2330, carColor: '#22242a', carModel: 'Coupe' },
      { type: 'survive', label: 'Lose the police — stay alive for 75 seconds', seconds: 75, setWanted: 3 },
      { type: 'goto', label: 'Lay low at the beach car park', x: 3080, y: 2360 },
    ],
  },
  {
    id: 5, title: 'Dockside Deal', giver: 'Mona',
    brief: 'Mona\'s supplier is being squeezed by the Harbor Boys. Meet the drop at the docks, hold the line, and bring the case back. They will not ask twice.',
    reward: 600,
    steps: [
      { type: 'goto', label: 'Reach the drop at the docks', x: 560, y: 2030, spawnEnemies: 5 },
      { type: 'fight', label: 'Hold the docks — take down the Harbor Boys' },
      { type: 'collect', label: 'Grab the case', x: 560, y: 2030, seconds: 4 },
      { type: 'goto', label: 'Bring the case to Mona', x: 860, y: 530 },
    ],
  },
  {
    id: 6, title: 'The Big Score', giver: 'Dante Kross',
    brief: 'The Solmara National Bank. In, out, and gone before the whole city wakes up. Dante takes his cut; the rest clears your debt. One last job.',
    reward: 1500,
    steps: [
      { type: 'goto', label: 'Reach the Solmara National Bank', x: 1760, y: 1130 },
      { type: 'collect', label: 'Crack the vault — hold the lobby', x: 1760, y: 1130, seconds: 8, setWanted: 4 },
      { type: 'goto', label: 'Escape to Payback Garage', x: 2360, y: 2330 },
    ],
  },
];

export function makeEnemy(rng, x, y, kind) {
  return {
    x, y, angle: 0,
    health: 100,
    speed: 120 + rng() * 40,
    shootAt: 0.6 + rng() * 1.2,
    dead: false,
    kind: kind || 'goon',
    shirt: kind === 'harbor' ? '#3a6ea8' : '#5a3a3a',
  };
}

export function startMission(world, index) {
  const def = MISSIONS[index];
  if (!def) return false;
  world.mission = {
    def, index,
    step: 0,
    timer: 0,
    active: true,
    markedCar: null,
    enemiesSpawned: false,
  };
  world.banner = { title: def.title, sub: def.giver + ' — ' + def.brief, t: 6 };
  say(world, def.giver, def.brief);
  if (world.audio) world.audio.click();
  return true;
}

export function say(world, who, text) {
  world.subtitle = { who, text, t: 5 };
}

export function currentStep(world) {
  if (!world.mission || !world.mission.active) return null;
  return world.mission.def.steps[world.mission.step] || null;
}

export function missionMarker(world) {
  const step = currentStep(world);
  if (!step) return null;
  if (step.type === 'fight' || step.type === 'survive') {
    // Fight and survive steps have no fixed marker: point at the player.
    return { x: world.player.x, y: world.player.y, label: step.label, self: true };
  }
  return { x: step.x, y: step.y, label: step.label };
}

export function advanceStep(world) {
  const m = world.mission;
  m.step += 1;
  m.timer = 0;
  m.enemiesSpawned = false;
  if (m.step >= m.def.steps.length) {
    completeMission(world);
  } else {
    const step = m.def.steps[m.step];
    world.message(step.label);
    if (step.spawnEnemies) spawnStepEnemies(world, step);
  }
}

function spawnStepEnemies(world, step) {
  const m = world.mission;
  if (m.enemiesSpawned) return;
  m.enemiesSpawned = true;
  const kind = m.def.id === 5 ? 'harbor' : 'goon';
  for (let i = 0; i < step.spawnEnemies; i++) {
    const a = (i / step.spawnEnemies) * Math.PI * 2;
    world.enemies.push(makeEnemy(world.rng, step.x + Math.cos(a) * 110, step.y + Math.sin(a) * 110, kind));
  }
  say(world, 'Harbor Boys', 'This is our turf, Moreno. Walk away.');
  addHeat(world, 8);
}

export function completeMission(world) {
  const m = world.mission;
  const reward = m.def.reward;
  world.player.cash += reward;
  world.completedMissions.push(m.def.id);
  world.stats.missionsDone = (world.stats.missionsDone || 0) + 1;
  world.banner = { title: 'MISSION COMPLETE', sub: m.def.title + ' — +' + '$' + reward, t: 4 };
  if (world.audio) { world.audio.missionDone(); world.audio.cash(); }
  world.mission = null;
  world.enemies = [];
  // The next mission unlocks; the phone (M) or the marker starts it.
  if (m.index + 1 < MISSIONS.length) {
    world.nextMissionAt = world.time + 4;
  }
  saveGame(world);
}

export function updateMission(world, dt) {
  const m = world.mission;
  if (!m || !m.active) {
    // Offer the next mission a few seconds after the last one ended.
    if (world.nextMissionAt && world.time >= world.nextMissionAt && !world.gameOver) {
      world.nextMissionAt = 0;
      const next = world.completedMissions.length;
      if (next < MISSIONS.length) {
        world.pendingMission = next;
        world.message('New job from ' + MISSIONS[next].giver + ' — press M to take it.');
      }
    }
    return;
  }
  const step = m.def.steps[m.step];
  if (!step) return;
  const p = world.player;

  if (step.setWanted && world.wanted < step.setWanted) {
    addHeat(world, (step.setWanted * 20) - world.heat);
  }

  switch (step.type) {
    case 'goto': {
      const d = dist(p.x, p.y, step.x, step.y);
      if (d < 70) {
        if (step.spawnEnemies && !m.enemiesSpawned) {
          spawnStepEnemies(world, step);
          // The goto completes only once the fight is done: turn it into fight.
          m.step += 1;
          if (m.step >= m.def.steps.length) { completeMission(world); return; }
          // Insert a fight step by re-pointing: the next step is already fight.
          world.message(m.def.steps[m.step].label);
        } else {
          advanceStep(world);
        }
      }
      break;
    }
    case 'steal': {
      if (!m.markedCar) {
        // Spawn the marked car at the step location if it is not there yet.
        const near = world.cars.find((c) => c.model.name === step.carModel && dist(c.x, c.y, step.x, step.y) < 260);
        if (near) {
          m.markedCar = near;
        } else {
          const spot = nearestIntersection(world.city, step.x, step.y);
          const car = {
            x: step.x, y: step.y, angle: 0, speed: 0,
            model: { name: step.carModel, len: 44, wid: 22, max: 600, accel: 980 },
            color: step.carColor || '#c23b2e', kind: 'parked', driver: false,
            health: 100, axis: 'y', line: spot.x, dir: 1, targetSpeed: 170,
            waitAt: 0, brakeLight: false, smoke: 0, siren: false, steer: 0, skid: 0, honkAt: 0,
          };
          world.cars.push(car);
          m.markedCar = car;
        }
      }
      if (p.inCar === m.markedCar) advanceStep(world);
      break;
    }
    case 'bringTo':
    case 'deliver': {
      const car = m.markedCar || p.inCar;
      if (p.inCar && dist(p.x, p.y, step.x, step.y) < 80) {
        if (step.type === 'deliver' && m.timer > 0 && world.time > m.timer) {
          world.message('Too slow — the client walked away.');
          failMission(world, 'Too slow');
          return;
        }
        advanceStep(world);
      }
      break;
    }
    case 'fight': {
      if (world.enemies.length === 0) advanceStep(world);
      break;
    }
    case 'collect': {
      const d = dist(p.x, p.y, step.x, step.y);
      if (d < 70) {
        m.timer += dt;
        if (m.timer >= step.seconds) advanceStep(world);
      } else {
        m.timer = Math.max(0, m.timer - dt * 2);
      }
      break;
    }
    case 'survive': {
      m.timer += dt;
      if (m.timer >= step.seconds) advanceStep(world);
      break;
    }
  }
}

// Enemy AI: close in on the player and shoot with poor aim.
export function updateEnemies(world, dt) {
  const p = world.player;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const d = dist(e.x, e.y, p.x, p.y);
    const aim = Math.atan2(p.y - e.y, p.x - e.x);
    e.angle = aim;
    if (d > 240) {
      e.x += Math.cos(aim) * e.speed * dt;
      e.y += Math.sin(aim) * e.speed * dt;
    } else if (d < 120) {
      e.x -= Math.cos(aim) * e.speed * 0.4 * dt;
      e.y -= Math.sin(aim) * e.speed * 0.4 * dt;
    }
    e.shootAt -= dt;
    if (e.shootAt <= 0 && d < 420 && !p.dead) {
      e.shootAt = 0.8 + Math.random() * 0.9;
      if (Math.random() < 0.3) {
        hurtPlayer(world, 6);
        addParticle(world, p.x, p.y, 'sparks', 3);
      } else {
        addParticle(world, p.x + (Math.random() - 0.5) * 70, p.y + (Math.random() - 0.5) * 70, 'sparks', 2);
      }
      if (world.audio) world.audio.shoot();
    }
  }
  world.enemies = world.enemies.filter((e) => !e.dead);
}

export function failMission(world, reason) {
  const m = world.mission;
  world.banner = { title: 'MISSION FAILED', sub: reason || m.def.title, t: 4 };
  world.mission = null;
  world.enemies = [];
  world.pendingMission = m.index;
  if (world.audio) world.audio.busted();
}

// --- taxi side work -------------------------------------------------------

export function updateTaxi(world, dt) {
  const p = world.player;
  const t = world.taxi;
  if (!t.active) {
    // A fare appears every so often while the player drives.
    if (p.inCar && world.time - (t.lastOffer || 0) > 25 && Math.random() < dt * 0.05) {
      t.lastOffer = world.time;
      const spot = randomRoadPoint(world.rng, world.city);
      // The fare must be reasonably close to the player.
      if (dist(spot.x, spot.y, p.x, p.y) < 900) {
        t.offer = { x: spot.x, y: spot.y, t: 20 };
        world.message('Someone is waving for a cab — drive up to them.');
      }
    }
    return;
  }
  if (t.phase === 'pickup') {
    if (p.inCar && dist(p.x, p.y, t.fare.x, t.fare.y) < 60) {
      t.phase = 'dropoff';
      t.dest = randomRoadPoint(world.rng, world.city);
      t.timer = 75;
      world.message('Passenger aboard. Take them to the marker — quick, the meter is running.');
    }
  } else if (t.phase === 'dropoff') {
    t.timer -= dt;
    if (t.timer <= 0) {
      world.message('The passenger stormed out. No fare.');
      t.active = false;
      t.offer = null;
      return;
    }
    if (p.inCar && dist(p.x, p.y, t.dest.x, t.dest.y) < 70) {
      const fare = 20 + Math.floor(dist(t.fare.x, t.fare.y, t.dest.x, t.dest.y) / 40);
      const bonus = t.timer > 40 ? 15 : 0;
      p.cash += fare + bonus;
      world.stats.fares = (world.stats.fares || 0) + 1;
      world.banner = { title: 'FARE PAID', sub: '+' + '$' + (fare + bonus), t: 2.5 };
      if (world.audio) world.audio.cash();
      t.active = false;
      t.offer = null;
    }
  }
}

export function acceptTaxiOffer(world) {
  const t = world.taxi;
  if (!t.offer) return false;
  t.active = true;
  t.phase = 'pickup';
  t.fare = { x: t.offer.x, y: t.offer.y };
  t.offer = null;
  return true;
}

// --- pickups --------------------------------------------------------------

export function updatePickups(world, dt) {
  const p = world.player;
  for (const pk of world.pickups) {
    pk.bob = (pk.bob || 0) + dt * 3;
    if (dist(p.x, p.y, pk.x, pk.y) < 34) {
      pk.taken = true;
      if (pk.kind === 'cash') {
        p.cash += pk.amount;
        world.message('+$' + pk.amount);
        if (world.audio) world.audio.cash();
      } else if (pk.kind === 'health') {
        p.health = clamp(p.health + 40, 0, 100);
        world.message('Health +40');
        if (world.audio) world.audio.pickup();
      } else if (pk.kind === 'armor') {
        p.armor = clamp(p.armor + 50, 0, 100);
        world.message('Armor +50');
        if (world.audio) world.audio.pickup();
      } else if (pk.kind === 'ammo') {
        p.reserveAmmo += 24;
        world.message('+24 pistol ammo');
        if (world.audio) world.audio.pickup();
      }
    }
  }
  world.pickups = world.pickups.filter((pk) => !pk.taken);
}

export function dropPickup(world, x, y, kind, amount) {
  world.pickups.push({ x, y, kind, amount: amount || 0, bob: 0 });
}

// --- shops ----------------------------------------------------------------

export function nearestShop(world) {
  const p = world.player;
  for (const s of world.city.shops) {
    if (dist(p.x, p.y, s.x, s.y) < s.r + 14) return s;
  }
  return null;
}

export function useShop(world, shop) {
  const p = world.player;
  if (shop.kind === 'food') {
    if (p.cash < 8) { world.message('Not enough cash for food.'); return; }
    if (p.health >= 100) { world.message('Already at full health.'); return; }
    p.cash -= 8;
    p.health = clamp(p.health + 35, 0, 100);
    world.message('Ate well. Health +35.');
    if (world.audio) world.audio.pickup();
  } else if (shop.kind === 'guns') {
    if (p.weapon !== 'pistol') {
      if (p.cash < 120) { world.message('A pistol costs $120.'); return; }
      p.cash -= 120;
      p.weapon = 'pistol';
      p.ammo = 12;
      p.reserveAmmo = 24;
      world.message('Bought a pistol with 36 rounds. Click to shoot, R to reload.');
      if (world.audio) world.audio.cash();
    } else {
      if (p.cash < 30) { world.message('Ammo costs $30.'); return; }
      p.cash -= 30;
      p.reserveAmmo += 36;
      world.message('Bought 36 rounds.');
      if (world.audio) world.audio.cash();
    }
  } else if (shop.kind === 'clothes') {
    if (p.cash < 25) { world.message('A vest costs $25.'); return; }
    if (p.armor >= 100) { world.message('Armor already full.'); return; }
    p.cash -= 25;
    p.armor = clamp(p.armor + 50, 0, 100);
    world.message('Bought a vest. Armor +50.');
    if (world.audio) world.audio.pickup();
  }
}

// --- save / load ----------------------------------------------------------

const SAVE_KEY = 'solmara-save-v1';

export function saveGame(world) {
  try {
    const p = world.player;
    const data = {
      cash: p.cash, health: p.health, armor: p.armor,
      weapon: p.weapon, ammo: p.ammo, reserveAmmo: p.reserveAmmo,
      x: p.x, y: p.y,
      completedMissions: world.completedMissions,
      stats: world.stats,
      timeOfDay: world.timeOfDay,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadGame(world) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    const p = world.player;
    p.cash = data.cash ?? 250;
    p.health = data.health ?? 100;
    p.armor = data.armor ?? 0;
    p.weapon = data.weapon || 'fists';
    p.ammo = data.ammo || 0;
    p.reserveAmmo = data.reserveAmmo || 0;
    p.x = data.x ?? 1460;
    p.y = data.y ?? 830;
    world.completedMissions = data.completedMissions || [];
    world.stats = data.stats || {};
    world.timeOfDay = data.timeOfDay ?? 9;
    return true;
  } catch (e) {
    return false;
  }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
