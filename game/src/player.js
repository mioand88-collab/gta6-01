// player.js — Jax Moreno on foot and behind the wheel: walking, running,
// stealing and driving cars, shooting and fighting, and using shops.
// The player object lives on the world; this module updates it each tick.

import { clamp, dist, angleToward, angleDiff } from './util.js';
import { resolveBuilding, clampToLand, hitBuilding } from './city.js';
import { drivePlayerCar, addParticle, addHeat, hurtPlayer, scarePeds, explode } from './entities.js';

export function makePlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2,
    vx: 0, vy: 0,
    health: 100, armor: 0,
    cash: 250,
    weapon: 'fists', // fists | pistol
    ammo: 0, reserveAmmo: 0,
    inCar: null, // the car object when driving, else null
    dead: false,
    punchAt: 0, shootAt: 0, muzzle: 0,
    moving: false,
    bob: 0,
  };
}

export function nearestCar(world, x, y, maxD) {
  let best = null;
  let bestD = maxD;
  for (const car of world.cars) {
    if (car.kind === 'police') continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// Try to enter the nearest car; stealing an occupied one is a crime.
export function tryEnterCar(world) {
  const p = world.player;
  if (p.inCar) {
    exitCar(world);
    return;
  }
  const car = nearestCar(world, p.x, p.y, 64);
  if (!car) return;
  if (car.driver) {
    // Yank the driver out: they run off, and witnesses call the cops.
    car.driver = false;
    const ped = world.peds.find((q) => q.state !== 'down' && dist(q.x, q.y, car.x, car.y) < 120);
    if (ped) { ped.state = 'flee'; ped.fleeX = car.x; ped.fleeY = car.y; }
    addHeat(world, 12);
    world.message('You stole the ' + car.model.name + '! The owner is calling it in.');
    if (world.audio) world.audio.horn();
  }
  p.inCar = car;
  car.kind = 'player';
  world.playerCar = car;
  p.x = car.x; p.y = car.y;
  if (world.audio) world.audio.click();
}

export function exitCar(world) {
  const p = world.player;
  const car = p.inCar;
  if (!car) return;
  // Step out to the side of the car.
  const sx = car.x - Math.sin(car.angle) * 34;
  const sy = car.y + Math.cos(car.angle) * 34;
  p.x = sx; p.y = sy;
  p.inCar = null;
  world.playerCar = null;
  if (car.speed > 60) {
    // Bailed out of a moving car: it rolls on driverless for a moment.
    car.driver = false;
  } else {
    car.speed = 0;
    car.driver = false;
  }
  car.kind = 'traffic';
}

export function updatePlayer(world, dt) {
  const p = world.player;
  const input = world.input;
  if (p.dead) return;
  p.punchAt -= dt;
  p.shootAt -= dt;
  p.muzzle = Math.max(0, p.muzzle - dt * 6);

  if (p.inCar) {
    const car = p.inCar;
    drivePlayerCar(car, input, dt, world.city, world);
    p.x = car.x; p.y = car.y;
    p.angle = car.angle;
    // Running over a pedestrian is a crime and a mess.
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      if (dist(ped.x, ped.y, car.x, car.y) < 24 && Math.abs(car.speed) > 60) {
        ped.state = 'down';
        addHeat(world, 18);
        addParticle(world, ped.x, ped.y, 'sparks', 6);
        world.shake = Math.max(world.shake, 5);
        world.stats.pedsDown = (world.stats.pedsDown || 0) + 1;
        world.message('You ran someone over! The heat is on.');
      }
    }
    // Bumping traffic cars: dent them, and the other driver may honk.
    for (const other of world.cars) {
      if (other === car || other.kind === 'player') continue;
      const d = dist(other.x, other.y, car.x, car.y);
      if (d < 44) {
        const push = (44 - d) / 2;
        const dx = (other.x - car.x) / (d || 1);
        const dy = (other.y - car.y) / (d || 1);
        other.x += dx * push; other.y += dy * push;
        car.x -= dx * push * 0.4; car.y -= dy * push * 0.4;
        if (Math.abs(car.speed) > 140) {
          other.health -= 8;
          car.health -= 3;
          addParticle(world, car.x, car.y, 'sparks', 5);
          if (world.audio && Math.abs(car.speed) > 260) world.audio.punch();
        }
        car.speed *= 0.92;
      }
    }
    if (car.health <= 0 && !car.exploded) {
      car.exploded = true;
      exitCar(world);
      explode(world, car.x, car.y, 130, 55);
    }
    return;
  }

  // --- on foot ---
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const mag = Math.sqrt(mx * mx + my * my);
  if (mag > 0) { mx /= mag; my /= mag; }
  const run = input.run ? 235 : 150;
  const tx = mx * run;
  const ty = my * run;
  p.vx += (tx - p.vx) * Math.min(1, 12 * dt);
  p.vy += (ty - p.vy) * Math.min(1, 12 * dt);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.moving = mag > 0;
  if (p.moving) p.bob += dt * 11;
  if (p.moving) p.angle = Math.atan2(p.vy, p.vx);
  resolveBuilding(world.city, p, 13);
  clampToLand(world.city, p, 13);

  // Aim with the mouse; click to shoot, F to punch.
  const aimDx = world.mouse.wx - p.x;
  const aimDy = world.mouse.wy - p.y;
  if (Math.abs(aimDx) + Math.abs(aimDy) > 12) {
    p.angle = Math.atan2(aimDy, aimDx);
  }
  if (input.mouseDown && p.weapon === 'pistol' && p.shootAt <= 0) {
    shoot(world);
  }
  if (input.punch && p.punchAt <= 0) {
    punch(world);
  }
}

function shoot(world) {
  const p = world.player;
  if (p.ammo <= 0) {
    world.message('Out of ammo — press R to reload, or visit IRONWORKS.');
    p.shootAt = 0.35;
    if (world.audio) world.audio.click();
    return;
  }
  p.ammo -= 1;
  p.shootAt = 0.22;
  p.muzzle = 1;
  const spread = (Math.random() - 0.5) * 0.09;
  const a = p.angle + spread;
  const gx = p.x + Math.cos(a) * 14;
  const gy = p.y + Math.sin(a) * 14;
  if (world.audio) world.audio.shoot();
  addParticle(world, gx, gy, 'sparks', 2);
  world.shake = Math.max(world.shake, 1.5);
  scarePeds(world, p.x, p.y, 260);
  addHeat(world, 6);
  // Hitscan: first thing along the bullet's path within 520 units.
  let bestD = 520;
  let hit = null;
  let hitKind = null;
  const consider = (x, y, r, obj, kind) => {
    const dx = x - p.x;
    const dy = y - p.y;
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    if (along < 0 || along > bestD) return;
    const perp = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
    if (perp < r + 4) { bestD = along; hit = obj; hitKind = kind; }
  };
  for (const e of world.enemies) consider(e.x, e.y, 14, e, 'enemy');
  for (const ped of world.peds) if (ped.state !== 'down') consider(ped.x, ped.y, 12, ped, 'ped');
  for (const cop of world.cops) consider(cop.x, cop.y, 13, cop, 'cop');
  for (const car of world.cars) {
    if (car === p.inCar) continue;
    consider(car.x, car.y, 24, car, 'car');
  }
  // A building stops the bullet.
  for (const b of world.city.buildings) {
    const cx = clamp(p.x + Math.cos(a) * bestD, b.x, b.x + b.w);
    const cy = clamp(p.y + Math.sin(a) * bestD, b.y, b.y + b.h);
    const dx = cx - p.x;
    const dy = cy - p.y;
    const along = dx * Math.cos(a) + dy * Math.sin(a);
    if (along > 0 && along < bestD) {
      const perp = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
      if (perp < 6) { bestD = along; hit = null; hitKind = 'wall'; }
    }
  }
  const ex = p.x + Math.cos(a) * bestD;
  const ey = p.y + Math.sin(a) * bestD;
  addParticle(world, ex, ey, 'sparks', 3);
  if (hitKind === 'enemy') {
    hit.health -= 34;
    addParticle(world, hit.x, hit.y, 'sparks', 6);
    if (hit.health <= 0) {
      hit.dead = true;
      world.stats.kills = (world.stats.kills || 0) + 1;
      world.message('Target down.');
    }
  } else if (hitKind === 'ped') {
    hit.state = 'down';
    world.stats.pedsDown = (world.stats.pedsDown || 0) + 1;
    addHeat(world, 20);
  } else if (hitKind === 'cop') {
    hit.health -= 34;
    addHeat(world, 22);
    if (hit.health <= 0) hit.dead = true;
  } else if (hitKind === 'car') {
    hit.health -= 20;
    addParticle(world, hit.x, hit.y, 'sparks', 6);
    if (hit.health <= 0 && !hit.exploded) {
      hit.exploded = true;
      explode(world, hit.x, hit.y, 130, 45);
    }
  }
  world.lastShotAt = world.time;
}

function punch(world) {
  const p = world.player;
  p.punchAt = 0.4;
  if (world.audio) world.audio.punch();
  const reach = 34;
  const tx = p.x + Math.cos(p.angle) * reach;
  const ty = p.y + Math.sin(p.angle) * reach;
  addParticle(world, tx, ty, 'sparks', 2);
  for (const e of world.enemies) {
    if (dist(e.x, e.y, tx, ty) < 26) {
      e.health -= 22;
      if (e.health <= 0) { e.dead = true; world.stats.kills = (world.stats.kills || 0) + 1; }
    }
  }
  for (const cop of world.cops) {
    if (dist(cop.x, cop.y, tx, ty) < 26) {
      cop.health -= 22;
      addHeat(world, 10);
      if (cop.health <= 0) cop.dead = true;
    }
  }
  for (const ped of world.peds) {
    if (ped.state !== 'down' && dist(ped.x, ped.y, tx, ty) < 24) {
      ped.state = 'down';
      addHeat(world, 14);
      world.stats.pedsDown = (world.stats.pedsDown || 0) + 1;
    }
  }
}

export function reloadWeapon(world) {
  const p = world.player;
  if (p.weapon !== 'pistol') return;
  const need = 12 - p.ammo;
  if (need <= 0 || p.reserveAmmo <= 0) return;
  const take = Math.min(need, p.reserveAmmo);
  p.ammo += take;
  p.reserveAmmo -= take;
  world.message('Reloaded. ' + p.ammo + '/12 in the mag, ' + p.reserveAmmo + ' in reserve.');
  if (world.audio) world.audio.click();
}
