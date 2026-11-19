// police.js — the Solmara Police Department: wanted levels, pursuit cars
// that ram the player, roadblocks at high heat, and officers on foot who
// arrest or shoot. The heat decays when the player stays out of trouble.

import { clamp, dist, angleToward, angleDiff, pick, range } from './util.js';
import { nearestIntersection, resolveBuilding, clampToLand } from './city.js';
import { makeCar, addParticle, addHeat, hurtPlayer, explode } from './entities.js';

const COP_COLORS = ['#1d2126', '#e8e8e8'];

export function makeCopCar(rng, city, x, y) {
  const car = makeCar(rng, city, {
    x, y, angle: 0, kind: 'police',
    color: pick(rng, COP_COLORS),
    model: { name: 'Interceptor', len: 46, wid: 22, max: 560, accel: 900 },
  });
  car.targetSpeed = 480;
  car.ramAt = 0;
  return car;
}

export function makeOfficer(rng, x, y) {
  return {
    x, y, angle: 0,
    health: 100,
    shootAt: range(rng, 0.5, 1.5),
    arrestAt: 0,
    dead: false,
    speed: 165,
  };
}

// Spawn police near the player, at the nearest intersections, up to the
// count the current wanted level calls for.
export function updatePolice(world, dt) {
  const p = world.player;
  if (p.dead || world.gameOver) return;

  // Heat decays when no crime has happened recently.
  if (world.time - (world.lastCrimeAt || -999) > 14 && world.heat > 0) {
    world.heat = Math.max(0, world.heat - 2.2 * dt);
    world.wanted = Math.min(5, Math.floor(world.heat / 20));
  }

  const wanted = world.wanted || 0;
  if (wanted === 0) {
    // Cops already out there give up and drive away.
    for (const car of world.cars) {
      if (car.kind === 'police') car.givingUp = true;
    }
    for (const cop of world.cops) cop.givingUp = true;
    return;
  }

  const wantCars = Math.min(6, wanted + 1);
  const wantCops = wanted >= 2 ? Math.min(5, wanted + 1) : 0;

  let policeCars = world.cars.filter((c) => c.kind === 'police' && !c.givingUp);
  if (policeCars.length < wantCars && world.time - (world.lastCopSpawn || 0) > 1.2) {
    world.lastCopSpawn = world.time;
    const spot = nearestIntersection(world.city, p.x + (Math.random() - 0.5) * 900, p.y + (Math.random() - 0.5) * 900);
    const sx = spot.x + (Math.random() - 0.5) * 120;
    const sy = spot.y + (Math.random() - 0.5) * 120;
    const car = makeCopCar(world.rng, world.city, sx, sy);
    world.cars.push(car);
    policeCars.push(car);
  }
  if (world.cops.length < wantCops && world.time - (world.lastOfficerSpawn || 0) > 2) {
    world.lastOfficerSpawn = world.time;
    const a = Math.random() * Math.PI * 2;
    const ox = p.x + Math.cos(a) * 260;
    const oy = p.y + Math.sin(a) * 260;
    world.cops.push(makeOfficer(world.rng, ox, oy));
  }

  // Police cars chase and ram. Far away they pursue along the road grid
  // (beelining through blocks would smash them into buildings); up close
  // they switch to a direct ram.
  for (const car of world.cars) {
    if (car.kind !== 'police') continue;
    if (car.givingUp) {
      car.speed = Math.max(0, car.speed - 200 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      if (car.speed <= 0) car.remove = true;
      continue;
    }
    const d = dist(car.x, car.y, p.x, p.y);
    if (d < 240) {
      // Close-range direct chase.
      const lead = 0.35;
      const tx = p.x + (p.inCar ? Math.cos(p.angle) * (p.inCar.speed || 0) * lead : 0);
      const ty = p.y + (p.inCar ? Math.sin(p.angle) * (p.inCar.speed || 0) * lead : 0);
      const aim = Math.atan2(ty - car.y, tx - car.x);
      car.angle += clamp(angleDiff(car.angle, aim), -2.4 * dt, 2.4 * dt);
      const wantSpeed = d > 90 ? 480 : 300;
      car.speed += (wantSpeed - car.speed) * Math.min(1, 1.6 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      // Bumping a wall at close range only slows the car down.
      if (resolveBuilding(world.city, car, 22)) car.speed *= -0.2;
      clampToLand(world.city, car, 24);
    } else {
      // Road pursuit: retarget the player's nearest intersection each second.
      if (!car.roadTarget || world.time - (car.roadTargetAt || 0) > 1) {
        car.roadTarget = nearestIntersection(world.city, p.x, p.y);
        car.roadTargetAt = world.time;
      }
      driveRoadToward(world, car, car.roadTarget.x, car.roadTarget.y, dt);
    }
    // Ram the player's car: damage it and slow the player down.
    if (p.inCar && d < 46) {
      p.inCar.health -= 6 * dt * 10;
      p.inCar.speed *= 0.94;
      car.speed *= 0.9;
      addParticle(world, car.x, car.y, 'sparks', 3);
      world.shake = Math.max(world.shake, 3);
    }
    // Ram the player on foot: knock them down (busted if slow, hurt if fast).
    if (!p.inCar && d < 30) {
      if (Math.abs(car.speed) > 120) {
        hurtPlayer(world, 18);
        p.x += Math.cos(car.angle) * 40;
        p.y += Math.sin(car.angle) * 40;
        world.shake = Math.max(world.shake, 6);
      } else {
        car.arrestAt = (car.arrestAt || 0) + dt;
        if (car.arrestAt > 1.6) {
          bustPlayer(world);
          return;
        }
      }
    } else {
      car.arrestAt = 0;
    }
    if (car.health <= 0 && !car.exploded) {
      car.exploded = true;
      explode(world, car.x, car.y, 120, 40);
    }
  }
  world.cars = world.cars.filter((c) => !c.remove && !(c.exploded && c.health <= 0 && c.kind === 'police' && Math.random() < 0.02));

  // Officers on foot: close in, shoot at range, arrest up close.
  for (const cop of world.cops) {
    if (cop.dead) continue;
    if (cop.givingUp) {
      cop.remove = true;
      continue;
    }
    const d = dist(cop.x, cop.y, p.x, p.y);
    const aim = Math.atan2(p.y - cop.y, p.x - cop.x);
    cop.angle = aim;
    if (d > 260) {
      cop.x += Math.cos(aim) * cop.speed * dt;
      cop.y += Math.sin(aim) * cop.speed * dt;
    } else if (d < 46) {
      cop.arrestAt += dt;
      if (cop.arrestAt > 1.4) {
        bustPlayer(world);
        return;
      }
    } else {
      cop.arrestAt = 0;
      cop.shootAt -= dt;
      if (cop.shootAt <= 0 && wanted >= 2) {
        cop.shootAt = 0.9 + Math.random() * 0.7;
        // Inaccurate shots: some hit, most miss and spark nearby.
        if (Math.random() < 0.35) {
          hurtPlayer(world, 7);
          addParticle(world, p.x, p.y, 'sparks', 3);
        } else {
          addParticle(world, p.x + (Math.random() - 0.5) * 60, p.y + (Math.random() - 0.5) * 60, 'sparks', 2);
        }
        if (world.audio) world.audio.shoot();
      }
    }
    resolveBuilding(world.city, cop, 12);
    clampToLand(world.city, cop, 12);
  }
  world.cops = world.cops.filter((c) => !c.dead && !c.remove);
}

// Drive a police car along the road grid toward (tx, ty): at each
// intersection turn onto the road that gets it closer to the target.
function driveRoadToward(world, car, tx, ty, dt) {
  const city = world.city;
  // Make sure the car has road state: snap to the nearest road.
  if (!car.axis) {
    const rx = city.roadsX.reduce((a, b) => Math.abs(b - car.x) < Math.abs(a - car.x) ? b : a);
    const ry = city.roadsY.reduce((a, b) => Math.abs(b - car.y) < Math.abs(a - car.y) ? b : a);
    if (Math.abs(car.x - rx) < Math.abs(car.y - ry)) {
      car.axis = 'y'; car.line = rx; car.dir = ty > car.y ? 1 : -1;
    } else {
      car.axis = 'x'; car.line = ry; car.dir = tx > car.x ? 1 : -1;
    }
  }
  const speed = 430;
  car.speed = speed;
  // Advance along the current road.
  if (car.axis === 'y') {
    car.y += car.dir * speed * dt;
    car.x = car.line + (car.dir > 0 ? 17 : -17);
    car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    car.x += car.dir * speed * dt;
    car.y = car.line + (car.dir > 0 ? 17 : -17);
    car.angle = car.dir > 0 ? 0 : Math.PI;
  }
  // At an intersection, turn if the other axis gets closer to the target.
  const pos = car.axis === 'y' ? car.y : car.x;
  const cross = car.axis === 'y' ? city.roadsY : city.roadsX;
  for (const c of cross) {
    const ahead = (pos - c) * car.dir;
    if (ahead > -4 && ahead < 26) {
      const alongHere = car.axis === 'y' ? Math.abs(ty - pos) : Math.abs(tx - pos);
      const alongOther = car.axis === 'y' ? Math.abs(tx - car.x) : Math.abs(ty - car.y);
      if (alongOther > 40 && alongOther > alongHere) {
        if (car.axis === 'y') {
          car.axis = 'x'; car.line = c;
          car.dir = tx > car.x ? 1 : -1;
          car.y = c + (car.dir > 0 ? 17 : -17);
          car.angle = car.dir > 0 ? 0 : Math.PI;
        } else {
          car.axis = 'y'; car.line = c;
          car.dir = ty > car.y ? 1 : -1;
          car.x = c + (car.dir > 0 ? 17 : -17);
          car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      }
      break;
    }
  }
  clampToLand(city, car, 24);
}

export function bustPlayer(world) {
  const p = world.player;
  if (p.dead || world.gameOver) return;
  p.dead = true;
  world.gameOver = 'busted';
  if (world.audio) world.audio.busted();
}

// Called when the player is wasted or busted: hospital respawn, cash lost.
export function respawnPlayer(world) {
  const p = world.player;
  const hosp = world.city.hospitals[0];
  p.x = hosp.x; p.y = hosp.y + 70;
  p.health = 100;
  p.armor = 0;
  p.dead = false;
  p.cash = Math.max(0, Math.floor(p.cash * 0.9));
  p.weapon = 'fists';
  p.ammo = 0;
  p.reserveAmmo = 0;
  if (p.inCar) {
    p.inCar.kind = 'traffic';
    p.inCar = null;
    world.playerCar = null;
  }
  world.heat = 0;
  world.wanted = 0;
  world.cops = [];
  for (const car of world.cars) {
    if (car.kind === 'police') car.givingUp = true;
  }
  world.gameOver = null;
  world.timeOfDay = (world.timeOfDay + 1.5) % 24;
  world.message('Solmara General patched you up. You lost 10% of your cash.');
}
