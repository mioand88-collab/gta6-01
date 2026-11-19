// entities.js — cars, pedestrians and particles.
// Cars are either driven by the player (arcade physics) or by the traffic AI
// (they follow the road grid and turn at intersections). Pedestrians walk the
// sidewalks and flee from gunfire. Particles carry smoke, sparks and fire.

import { clamp, lerp, dist, angleDiff, angleToward, pick, range, intRange, TAU } from './util.js';
import { ROAD_W, WORLD_W, WORLD_H, onRoad, hitBuilding, resolveBuilding, clampToLand, randomRoadPoint, nearestIntersection } from './city.js';

export const CAR_W = 46;
export const CAR_H = 22;

const CAR_MODELS = [
  { name: 'Sedan', len: 46, wid: 22, max: 430, accel: 700 },
  { name: 'Coupe', len: 44, wid: 21, max: 520, accel: 820 },
  { name: 'Van', len: 54, wid: 24, max: 360, accel: 560 },
  { name: 'Truck', len: 58, wid: 25, max: 340, accel: 520 },
  { name: 'Taxi', len: 46, wid: 22, max: 440, accel: 720 },
  { name: 'Sports', len: 44, wid: 22, max: 600, accel: 980 },
];

export function makeCar(rng, city, opts) {
  const model = opts.model || pick(rng, CAR_MODELS);
  return {
    id: opts.id || ('car' + Math.floor(rng() * 1e9)),
    x: opts.x, y: opts.y, angle: opts.angle || 0,
    speed: 0, // signed forward speed (units/s)
    model,
    color: opts.color || pick(rng, city.carColors),
    kind: opts.kind || 'traffic', // traffic | player | police | mission
    driver: opts.driver !== undefined ? opts.driver : true,
    health: 100,
    // Traffic AI state: which road it is on and which way it travels.
    axis: opts.axis || 'y', // 'x' = travels along a horizontal road (y fixed)
    line: opts.line || 0,   // the road centreline coordinate
    dir: opts.dir || 1,
    targetSpeed: opts.targetSpeed || range(rng, 130, 210),
    waitAt: 0,
    brakeLight: false,
    smoke: 0,
    siren: opts.kind === 'police',
    // Player-car state
    steer: 0,
    skid: 0,
    honkAt: 0,
  };
}

export function spawnTrafficCar(rng, city, kind) {
  const p = randomRoadPoint(rng, city);
  const vertical = rng() < 0.5;
  const dir = rng() < 0.5 ? 1 : -1;
  let line, axis, angle;
  if (vertical) {
    const rx = city.roadsX.reduce((a, b) => Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a);
    line = rx; axis = 'y'; angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    const ry = city.roadsY.reduce((a, b) => Math.abs(b - p.y) < Math.abs(a - p.y) ? b : a);
    line = ry; axis = 'x'; angle = dir > 0 ? 0 : Math.PI;
  }
  const car = makeCar(rng, city, {
    x: axis === 'y' ? line + (dir > 0 ? 17 : -17) : p.x,
    y: axis === 'x' ? line + (dir > 0 ? 17 : -17) : p.y,
    angle, axis, line, dir,
    kind: kind || 'traffic',
    color: kind === 'taxi' ? '#f2c230' : undefined,
    model: kind === 'taxi' ? CAR_MODELS[4] : undefined,
  });
  // Keep the car on its lane.
  if (axis === 'y') car.x = line + (dir > 0 ? 17 : -17);
  else car.y = line + (dir > 0 ? 17 : -17);
  car.speed = car.targetSpeed;
  return car;
}

// --- player driving -------------------------------------------------------

export function drivePlayerCar(car, input, dt, city, world) {
  const m = car.model;
  const forward = input.up ? 1 : input.down ? -1 : 0;
  const accel = forward > 0 ? m.accel : m.accel * 0.7;
  if (forward !== 0) {
    car.speed += forward * accel * dt;
  } else {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 320 * dt);
  }
  if (input.handbrake) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 1400 * dt);
  }
  car.speed = clamp(car.speed, -m.max * 0.45, m.max);
  // Steering: stronger at low speed, weaker at high speed; none when stopped.
  const steerInput = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  const speedNorm = clamp(Math.abs(car.speed) / m.max, 0, 1);
  const steerRate = lerp(2.6, 1.5, speedNorm) * (car.speed >= 0 ? 1 : -1);
  if (Math.abs(car.speed) > 12) {
    car.angle += steerInput * steerRate * dt * (0.35 + 0.65 * speedNorm);
    car.steer = lerp(car.steer, steerInput, 1 - Math.pow(0.001, dt));
  }
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  car.x = nx; car.y = ny;
  // Skid marks + smoke when turning hard at speed or handbraking.
  const skidding = (Math.abs(steerInput) > 0 && Math.abs(car.speed) > 300) || (input.handbrake && Math.abs(car.speed) > 120);
  car.skid = skidding ? 1 : 0;
  if (skidding && world) {
    const bx = car.x - Math.cos(car.angle) * car.model.len * 0.4;
    const by = car.y - Math.sin(car.angle) * car.model.len * 0.4;
    addSkid(world, bx, by, car.angle);
    if (Math.random() < 0.3) addParticle(world, bx, by, 'smoke');
  }
  // Collisions with buildings and the map edge.
  const before = { x: car.x, y: car.y };
  if (resolveBuilding(city, car, 22)) {
    // Hit a wall: kill most of the speed, spark, thud.
    const hitSpeed = Math.abs(car.speed);
    car.speed *= -0.25;
    if (hitSpeed > 180 && world) {
      addParticle(world, before.x, before.y, 'sparks', 10);
      car.health -= Math.min(18, hitSpeed / 40);
      world.shake = Math.min(10, hitSpeed / 60);
    }
  }
  clampToLand(city, car, 24);
  car.brakeLight = input.down || input.handbrake;
  return car;
}

// --- traffic AI -----------------------------------------------------------

export function updateTrafficCar(car, dt, city, world) {
  if (car.waitAt > 0) {
    car.waitAt -= dt;
    car.speed = lerp(car.speed, 0, 1 - Math.pow(0.001, dt));
    return;
  }
  // Car ahead in the same lane? Slow down.
  let ahead = Infinity;
  for (const other of world.cars) {
    if (other === car || other.kind === 'player') continue;
    if (other.axis !== car.axis || other.line !== car.line || other.dir !== car.dir) continue;
    const along = car.axis === 'y' ? (other.y - car.y) * car.dir : (other.x - car.x) * car.dir;
    if (along > 0 && along < ahead) ahead = along;
  }
  // Also watch the player's car if it is in front on the same road.
  const pc = world.playerCar;
  if (pc && pc !== car) {
    const along = car.axis === 'y'
      ? (Math.abs(pc.x - car.x) < 30 ? (pc.y - car.y) * car.dir : -1)
      : (Math.abs(pc.y - car.y) < 30 ? (pc.x - car.x) * car.dir : -1);
    if (along > 0 && along < ahead) ahead = along;
  }
  const want = ahead < 70 ? 0 : car.targetSpeed;
  car.speed = lerp(car.speed, want, 1 - Math.pow(0.01, dt));
  if (car.speed < 4 && ahead < 70 && car.honkAt <= 0) {
    car.honkAt = 4 + Math.random() * 4;
    if (world.audio) world.audio.horn();
  }
  car.honkAt -= dt;

  // Move along the road.
  if (car.axis === 'y') car.y += car.dir * car.speed * dt;
  else car.x += car.dir * car.speed * dt;

  // At an intersection, sometimes turn onto the crossing road.
  const pos = car.axis === 'y' ? car.y : car.x;
  const cross = car.axis === 'y' ? city.roadsY : city.roadsX;
  for (const c of cross) {
    const d = (pos - c) * car.dir;
    if (d > -2 && d < 14 && Math.random() < 0.35) {
      turnTrafficCar(car, c, city);
      break;
    }
  }
  // Wrap around the map edges so traffic never runs out.
  if (car.axis === 'y' && (car.y < 30 || car.y > WORLD_H - 30)) car.y = car.dir > 0 ? 40 : WORLD_H - 40;
  if (car.axis === 'x' && (car.x < 30 || car.x > city.beachX - 30)) car.x = car.dir > 0 ? 40 : city.beachX - 40;
}

function turnTrafficCar(car, crossCoord, city) {
  // Turn onto the crossing road, picking a new direction at random.
  const newDir = Math.random() < 0.5 ? 1 : -1;
  if (car.axis === 'y') {
    car.axis = 'x';
    car.line = crossCoord;
    car.dir = newDir;
    car.y = crossCoord + (newDir > 0 ? 17 : -17);
    car.angle = newDir > 0 ? 0 : Math.PI;
  } else {
    car.axis = 'y';
    car.line = crossCoord;
    car.dir = newDir;
    car.x = crossCoord + (newDir > 0 ? 17 : -17);
    car.angle = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}

// --- pedestrians ----------------------------------------------------------

export function makePed(rng, city) {
  const p = randomRoadPoint(rng, city);
  const shirt = pick(rng, ['#d94f3d', '#3d7dd9', '#e8c832', '#5aa85a', '#d97fb0', '#e8e8e8', '#8a5fd9', '#f08a2e']);
  return {
    x: p.x, y: p.y, angle: rng() * TAU,
    speed: range(rng, 28, 52),
    shirt, pants: pick(rng, ['#2a2d34', '#4a3a2a', '#33415c', '#5c5c5c']),
    skin: pick(rng, ['#e8b98a', '#c98d5f', '#8a5a3a', '#f0c8a0']),
    state: 'walk', // walk | flee | down | taxi
    fleeX: 0, fleeY: 0, waitAt: 0,
    target: null, // taxi fare destination
    bob: rng() * TAU,
  };
}

export function updatePed(ped, dt, city, world) {
  ped.bob += dt * 8;
  if (ped.state === 'down') return;
  if (ped.state === 'flee') {
    const dx = ped.x - ped.fleeX;
    const dy = ped.y - ped.fleeY;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    ped.x += (dx / d) * 130 * dt;
    ped.y += (dy / d) * 130 * dt;
    ped.angle = Math.atan2(dy, dx);
    clampToLand(city, ped, 10);
    if (d > 320) ped.state = 'walk';
    return;
  }
  if (ped.waitAt > 0) { ped.waitAt -= dt; return; }
  // Walk along the sidewalk: keep to a road edge, turn at intersections.
  const step = ped.speed * dt;
  const nx = ped.x + Math.cos(ped.angle) * step;
  const ny = ped.y + Math.sin(ped.angle) * step;
  // If the next step leaves the sidewalk (hits a building or the sea), turn.
  if (hitBuilding(city, nx, ny, 10) || nx > city.beachX - 12 || nx < 12 || ny < 12 || ny > WORLD_H - 12) {
    ped.angle += (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.6);
    ped.waitAt = 0.2 + Math.random() * 0.5;
    return;
  }
  // Prefer staying near a road: if we drifted into a block, steer back.
  if (!onRoad(city, nx, ny)) {
    const near = nearestIntersection(city, nx, ny);
    ped.angle = angleToward(ped.angle, Math.atan2(near.y - ny, near.x - nx), 2.2 * dt);
  }
  ped.x = nx; ped.y = ny;
  // Randomly change direction at intersections.
  if (Math.random() < dt * 0.12) {
    ped.angle += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
  }
}

export function scarePeds(world, x, y, radius) {
  for (const ped of world.peds) {
    if (ped.state === 'down') continue;
    if (dist(ped.x, ped.y, x, y) < radius) {
      ped.state = 'flee';
      ped.fleeX = x; ped.fleeY = y;
    }
  }
}

// --- particles ------------------------------------------------------------

export function addParticle(world, x, y, type, n) {
  const count = n || 1;
  for (let i = 0; i < count; i++) {
    world.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * (type === 'smoke' ? 30 : 260),
      vy: (Math.random() - 0.5) * (type === 'smoke' ? 30 : 260),
      life: type === 'smoke' ? 0.9 : type === 'fire' ? 0.6 : 0.35,
      maxLife: type === 'smoke' ? 0.9 : type === 'fire' ? 0.6 : 0.35,
      size: type === 'smoke' ? 9 + Math.random() * 8 : 2 + Math.random() * 3,
      type,
    });
  }
}

export function addSkid(world, x, y, angle) {
  world.skids.push({ x, y, angle, life: 6 });
  if (world.skids.length > 400) world.skids.splice(0, world.skids.length - 400);
}

export function updateParticles(world, dt) {
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const p = world.particles[i];
    p.life -= dt;
    if (p.life <= 0) { world.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= (1 - 2.2 * dt);
    p.vy *= (1 - 2.2 * dt);
    if (p.type === 'smoke') p.size += 14 * dt;
  }
  for (let i = world.skids.length - 1; i >= 0; i--) {
    world.skids[i].life -= dt;
    if (world.skids[i].life <= 0) world.skids.splice(i, 1);
  }
}

export function explode(world, x, y, radius, damage) {
  addParticle(world, x, y, 'fire', 26);
  addParticle(world, x, y, 'smoke', 14);
  addParticle(world, x, y, 'sparks', 18);
  world.shake = Math.max(world.shake, 14);
  if (world.audio) world.audio.explosion();
  scarePeds(world, x, y, 420);
  // Damage the player, nearby cars and pedestrians.
  const p = world.player;
  if (p && dist(p.x, p.y, x, y) < radius) hurtPlayer(world, damage);
  for (const car of world.cars) {
    if (dist(car.x, car.y, x, y) < radius) {
      car.health -= damage;
      if (car.health <= 0 && !car.exploded) {
        car.exploded = true;
        explode(world, car.x, car.y, 90, 40);
      }
    }
  }
  for (const ped of world.peds) {
    if (ped.state !== 'down' && dist(ped.x, ped.y, x, y) < radius) {
      ped.state = 'down';
      world.stats.pedsDown = (world.stats.pedsDown || 0) + 1;
    }
  }
  if (world.wanted !== undefined) addHeat(world, 34);
}

export function hurtPlayer(world, dmg) {
  const p = world.player;
  if (!p || p.dead) return;
  let left = dmg;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, left * 0.6);
    p.armor -= absorbed;
    left -= absorbed;
  }
  p.health -= left;
  world.flashRed = Math.min(0.55, world.flashRed + 0.3);
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
    world.gameOver = 'wasted';
    if (world.audio) world.audio.busted();
  }
}

// Heat feeds the wanted level; crimes call this.
export function addHeat(world, amount) {
  world.heat = clamp((world.heat || 0) + amount, 0, 100);
  world.wanted = Math.min(5, Math.floor(world.heat / 20));
  world.lastCrimeAt = world.time;
}
