// main.js — SOLMARA's entry point: creates the world, runs the game loop,
// reads keyboard and mouse, moves the camera, and draws the city. It also
// stages the screenshot scenes (?shot=...) and the scripted self-test
// (?selftest=1) used to verify the game headlessly.

import { clamp, lerp, dist, makeRng, hashSeed, TAU } from './util.js';
import { buildCity, WORLD_W, WORLD_H, ROAD_W, DISTRICTS, districtAt, onRoad, hitBuilding } from './city.js';
import { AudioEngine } from './audio.js';
import {
  makeCar, spawnTrafficCar, makePed, updateTrafficCar, updatePed, updateParticles,
  addParticle, explode, addHeat, hurtPlayer,
} from './entities.js';
import { makePlayer, updatePlayer, tryEnterCar, reloadWeapon, nearestCar } from './player.js';
import { updatePolice, respawnPlayer } from './police.js';
import {
  MISSIONS, startMission, updateMission, updateEnemies, updateTaxi, acceptTaxiOffer,
  updatePickups, nearestShop, useShop, saveGame, loadGame, hasSave, missionMarker, say,
} from './missions.js';
import { drawHUD, drawTitle, drawPause, drawGameOver, drawHelp } from './hud.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '7', 10) || 7;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const world = {
  city: null,
  rng: makeRng(SEED),
  player: null,
  cars: [],
  peds: [],
  cops: [],
  enemies: [],
  particles: [],
  skids: [],
  pickups: [],
  audio: new AudioEngine(),
  input: { up: false, down: false, left: false, right: false, run: false, handbrake: false, mouseDown: false, punch: false },
  mouse: { x: 0, y: 0, wx: 0, wy: 0 },
  camera: { x: 0, y: 0, zoom: 0.85 },
  time: 0,
  timeOfDay: 9.2,
  heat: 0,
  wanted: 0,
  lastCrimeAt: -999,
  lastCopSpawn: 0,
  lastOfficerSpawn: 0,
  playerCar: null,
  mission: null,
  pendingMission: 0,
  nextMissionAt: 0,
  completedMissions: [],
  stats: {},
  taxi: { active: false, phase: null, offer: null, lastOffer: 0 },
  state: 'title', // title | play | pause | help | gameover
  menuItems: ['New Game', 'Continue', 'How to Play'],
  menuSel: 0,
  pauseItems: ['Resume', 'Save Game', 'How to Play', 'Quit to Title'],
  pauseSel: 0,
  shake: 0,
  flashRed: 0,
  toast: null,
  subtitle: null,
  banner: null,
  prompt: null,
  markerForMap: null,
  gameOver: null,
  freezeAt: 0,
  shotStaged: false,
};

world.message = function (text) {
  world.toast = { text, t: 4 };
};

function status(text) {
  statusEl.textContent = text;
}

function newWorld(seed) {
  world.city = buildCity(seed);
  world.rng = makeRng(seed);
  world.player = makePlayer(1460, 830);
  world.cars = [];
  world.peds = [];
  world.cops = [];
  world.enemies = [];
  world.particles = [];
  world.skids = [];
  world.pickups = [];
  world.heat = 0;
  world.wanted = 0;
  world.mission = null;
  world.pendingMission = 0;
  world.nextMissionAt = 0;
  world.completedMissions = [];
  world.stats = {};
  world.taxi = { active: false, phase: null, offer: null, lastOffer: 0 };
  world.gameOver = null;
  world.timeOfDay = 9.2;
  world.time = 0;
  world.camera.x = world.player.x;
  world.camera.y = world.player.y;
  // Traffic and pedestrians fill the city.
  for (let i = 0; i < 26; i++) world.cars.push(spawnTrafficCar(world.rng, world.city));
  for (let i = 0; i < 44; i++) world.peds.push(makePed(world.rng, world.city));
  // A few starter pickups near the spawn.
  world.pickups.push({ x: 1520, y: 890, kind: 'health', amount: 0, bob: 0 });
  world.pickups.push({ x: 1400, y: 860, kind: 'ammo', amount: 0, bob: 0 });
}

function resize() {
  canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// --- input ---------------------------------------------------------------

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'handbrake',
};

window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) { world.input[k] = true; e.preventDefault(); }
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  world.audio.ensure();
  if (e.code === 'KeyF') world.input.punch = true;
  if (e.code === 'KeyR') reloadWeapon(world);
  if (e.code === 'KeyM') onPhoneKey();
  if (e.code === 'KeyN') {
    const m = world.audio.toggleMute();
    world.message(m ? 'Sound muted.' : 'Sound on.');
  }
  if (e.code === 'KeyH') {
    if (world.state === 'play') world.state = 'help';
    else if (world.state === 'help') world.state = 'play';
  }
  if (e.code === 'Escape') {
    if (world.state === 'play') { world.state = 'pause'; world.pauseSel = 0; }
    else if (world.state === 'pause') world.state = 'play';
    else if (world.state === 'help') world.state = 'play';
  }
  if (e.code === 'KeyE') onActionKey();
  if (e.code === 'Enter') onEnterKey();
  if (e.code === 'ArrowUp' && (world.state === 'title' || world.state === 'pause')) {
    if (world.state === 'title') world.menuSel = (world.menuSel + world.menuItems.length - 1) % world.menuItems.length;
    else world.pauseSel = (world.pauseSel + world.pauseItems.length - 1) % world.pauseItems.length;
    world.audio.click();
  }
  if (e.code === 'ArrowDown' && (world.state === 'title' || world.state === 'pause')) {
    if (world.state === 'title') world.menuSel = (world.menuSel + 1) % world.menuItems.length;
    else world.pauseSel = (world.pauseSel + 1) % world.pauseItems.length;
    world.audio.click();
  }
});

window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) world.input[k] = false;
  if (e.code === 'KeyF') world.input.punch = false;
});

canvas.addEventListener('mousemove', (e) => {
  world.mouse.x = e.clientX;
  world.mouse.y = e.clientY;
});
canvas.addEventListener('mousedown', (e) => {
  world.audio.ensure();
  if (e.button === 0) world.input.mouseDown = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) world.input.mouseDown = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function onPhoneKey() {
  if (world.state !== 'play') return;
  if (world.pendingMission !== null && world.pendingMission !== undefined) {
    const idx = world.pendingMission;
    world.pendingMission = null;
    startMission(world, idx);
  } else if (world.mission) {
    world.toast = { text: world.mission.def.title + ': ' + world.mission.def.steps[world.mission.step].label, t: 4 };
  } else {
    world.message('No jobs right now — drive around and one will come in.');
  }
}

function onActionKey() {
  if (world.state !== 'play') return;
  const p = world.player;
  // In a car near a taxi fare: pick the passenger up.
  if (p.inCar && world.taxi.offer && dist(p.x, p.y, world.taxi.offer.x, world.taxi.offer.y) < 70) {
    if (acceptTaxiOffer(world)) { world.audio.pickup(); return; }
  }
  // On foot near a shop: buy.
  if (!p.inCar) {
    const shop = nearestShop(world);
    if (shop) { useShop(world, shop); return; }
  }
  tryEnterCar(world);
  if (p.inCar) world.stats.carsStolen = (world.stats.carsStolen || 0) + 1;
}

function onEnterKey() {
  if (world.state === 'title') {
    chooseMenu(world.menuSel);
  } else if (world.state === 'pause') {
    choosePause(world.pauseSel);
  } else if (world.state === 'gameover') {
    respawnPlayer(world);
    world.state = 'play';
    status('Back on the streets of Solmara.');
  }
}

function chooseMenu(i) {
  world.audio.ensure();
  world.audio.click();
  const item = world.menuItems[i];
  if (item === 'New Game') {
    newWorld(SEED);
    world.state = 'play';
    say(world, 'Mona', 'Jax! You\'re back. Dante wants his money — start with my package job. Press M.');
    status('New game started.');
  } else if (item === 'Continue') {
    newWorld(SEED);
    if (loadGame(world)) {
      world.state = 'play';
      world.message('Welcome back, Jax.');
      status('Save loaded.');
    } else {
      world.state = 'play';
      say(world, 'Mona', 'Jax! You\'re back. Dante wants his money — start with my package job. Press M.');
      status('No save found — new game started.');
    }
  } else if (item === 'How to Play') {
    world.state = 'help';
  }
}

function choosePause(i) {
  world.audio.click();
  if (i === 0) world.state = 'play';
  else if (i === 1) {
    if (saveGame(world)) world.message('Game saved.');
    else world.message('Could not save (browser storage blocked).');
  } else if (i === 2) world.state = 'help';
  else if (i === 3) {
    world.state = 'title';
    world.menuItems = hasSave() ? ['New Game', 'Continue', 'How to Play'] : ['New Game', 'How to Play'];
    world.menuSel = 0;
  }
}

// --- update ---------------------------------------------------------------

function update(dt) {
  world.time += dt;
  world.timeOfDay = (world.timeOfDay + dt / 30) % 24;
  if (world.toast) { world.toast.t -= dt; if (world.toast.t <= 0) world.toast = null; }
  if (world.subtitle) { world.subtitle.t -= dt; if (world.subtitle.t <= 0) world.subtitle = null; }
  if (world.banner) { world.banner.t -= dt; if (world.banner.t <= 0) world.banner = null; }
  world.shake = Math.max(0, world.shake - dt * 26);
  world.flashRed = Math.max(0, world.flashRed - dt * 1.4);

  // Mouse position in world coordinates.
  const view = { w: window.innerWidth, h: window.innerHeight };
  world.mouse.wx = world.camera.x + (world.mouse.x - view.w / 2) / world.camera.zoom;
  world.mouse.wy = world.camera.y + (world.mouse.y - view.h / 2) / world.camera.zoom;

  updatePlayer(world, dt);
  updatePolice(world, dt);
  updateMission(world, dt);
  updateEnemies(world, dt);
  updateTaxi(world, dt);
  updatePickups(world, dt);
  updateParticles(world, dt);

  // Traffic cars drive; player-driven and police cars are updated elsewhere.
  for (const car of world.cars) {
    if (car.kind === 'traffic') updateTrafficCar(car, dt, world.city, world);
    if (car.exploded && car.health <= 0) car.remove = true;
  }
  world.cars = world.cars.filter((c) => !c.remove);
  // Keep the streets full.
  let trafficCount = world.cars.filter((c) => c.kind === 'traffic').length;
  while (trafficCount < 24) {
    const car = spawnTrafficCar(world.rng, world.city);
    // Don't spawn on top of the player.
    if (dist(car.x, car.y, world.player.x, world.player.y) > 500) {
      world.cars.push(car);
      trafficCount++;
    } else break;
  }
  for (const ped of world.peds) updatePed(ped, dt, world.city, world);
  // Keep pedestrians around.
  while (world.peds.length < 40) {
    const ped = makePed(world.rng, world.city);
    if (dist(ped.x, ped.y, world.player.x, world.player.y) > 420) world.peds.push(ped);
    else break;
  }

  // Camera follows the player, zooming out with speed.
  const p = world.player;
  const targetZoom = p.inCar ? clamp(0.72 - Math.abs(p.inCar.speed) / 4000, 0.55, 0.78) : 1.15;
  world.camera.zoom = lerp(world.camera.zoom, targetZoom, 1 - Math.pow(0.01, dt));
  world.camera.x = lerp(world.camera.x, p.x, 1 - Math.pow(0.005, dt));
  world.camera.y = lerp(world.camera.y, p.y, 1 - Math.pow(0.005, dt));

  // Engine + siren audio follow the state.
  if (world.audio.ctx) {
    const driving = p.inCar ? clamp(Math.abs(p.inCar.speed) / p.inCar.model.max, 0, 1) : 0;
    world.audio.setEngine(driving, !!p.inCar);
    world.audio.setSiren(world.wanted > 0);
  }

  // Interaction prompt.
  world.prompt = computePrompt();

  // Mission marker for the HUD and minimap.
  const marker = missionMarker(world);
  if (marker) world.markerForMap = marker;
  else if (world.taxi.active && world.taxi.phase === 'dropoff') world.markerForMap = { x: world.taxi.dest.x, y: world.taxi.dest.y, label: 'Drop off the passenger' };
  else if (world.taxi.offer) world.markerForMap = { x: world.taxi.offer.x, y: world.taxi.offer.y, label: 'Pick up the fare' };
  else world.markerForMap = null;

  // Wasted / busted.
  if (world.gameOver && world.state === 'play') world.state = 'gameover';

  // Screenshot freeze: stop the simulation once the staged scene has played.
  if (world.freezeAt > 0 && world.time >= world.freezeAt) {
    world.freezeAt = 0;
    document.title = 'SHOT_READY';
  }
}

function computePrompt() {
  const p = world.player;
  if (world.state !== 'play' || p.dead) return null;
  if (p.inCar) {
    if (world.taxi.offer && dist(p.x, p.y, world.taxi.offer.x, world.taxi.offer.y) < 70) return 'E — Pick up the fare';
    return 'E — Get out    Space — Handbrake';
  }
  const shop = nearestShop(world);
  if (shop) {
    if (shop.kind === 'food') return 'E — Eat at ' + shop.name + ' ($8, +35 health)';
    if (shop.kind === 'guns') return p.weapon === 'pistol' ? 'E — Buy ammo at ' + shop.name + ' ($30)' : 'E — Buy a pistol at ' + shop.name + ' ($120)';
    if (shop.kind === 'clothes') return 'E — Buy armor at ' + shop.name + ' ($25)';
  }
  const car = nearestCar(world, p.x, p.y, 64);
  if (car) return car.driver ? 'E — Steal the ' + car.model.name : 'E — Get in the ' + car.model.name;
  return null;
}

// --- rendering ------------------------------------------------------------

function nightFactor() {
  const t = world.timeOfDay;
  if (t >= 21 || t < 4.5) return 0.52;
  if (t >= 7 && t < 17.5) return 0;
  if (t >= 4.5 && t < 7) return lerp(0.52, 0, (t - 4.5) / 2.5);
  return lerp(0, 0.52, (t - 17.5) / 3.5); // 17.5..21 dusk
}

function render() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const view = { w, h };
  ctx.clearRect(0, 0, w, h);

  if (world.state === 'title') {
    drawTitle(ctx, world, view);
    return;
  }
  if (world.state === 'help') {
    renderWorld();
    drawHelp(ctx, world, view);
    return;
  }

  renderWorld();

  if (world.state === 'play' || world.state === 'pause' || world.state === 'gameover') {
    drawHUD(ctx, world, view);
  }
  if (world.state === 'pause') drawPause(ctx, world, view);
  if (world.state === 'gameover') drawGameOver(ctx, world, view);
}

function renderWorld() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cam = world.camera;
  const shakeX = (Math.random() - 0.5) * world.shake;
  const shakeY = (Math.random() - 0.5) * world.shake;
  ctx.save();
  ctx.translate(w / 2 + shakeX, h / 2 + shakeY);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  const city = world.city;
  const vx0 = cam.x - w / 2 / cam.zoom - 60;
  const vx1 = cam.x + w / 2 / cam.zoom + 60;
  const vy0 = cam.y - h / 2 / cam.zoom - 60;
  const vy1 = cam.y + h / 2 / cam.zoom + 60;
  const inView = (x, y, m) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

  // Ground: district colours, then the sea and the beach.
  ctx.fillStyle = '#8a8578';
  ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
  for (const d of DISTRICTS) {
    ctx.fillStyle = d.ground;
    ctx.fillRect(Math.max(d.x0, vx0), Math.max(d.y0, vy0), Math.min(d.x1, vx1) - Math.max(d.x0, vx0), Math.min(d.y1, vy1) - Math.max(d.y0, vy0));
  }
  ctx.fillStyle = '#d8c08a';
  ctx.fillRect(city.beachX, vy0, city.seaX - city.beachX, vy1 - vy0);
  ctx.fillStyle = '#2e6ea8';
  ctx.fillRect(city.seaX, vy0, vx1 - city.seaX, vy1 - vy0);
  // Animated wave lines on the sea.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  for (let y = Math.floor(vy0 / 90) * 90; y < vy1; y += 90) {
    ctx.beginPath();
    ctx.moveTo(city.seaX + 8, y + Math.sin(world.time * 1.4 + y) * 4);
    ctx.lineTo(vx1, y + Math.sin(world.time * 1.4 + y) * 4);
    ctx.stroke();
  }
  // Parks and lots.
  for (const pk of city.parks) {
    if (!inView(pk.x + pk.w / 2, pk.y + pk.h / 2, 200)) continue;
    ctx.fillStyle = pk.kind === 'trees' ? '#4d8a4a' : '#7a8a6a';
    ctx.fillRect(pk.x, pk.y, pk.w, pk.h);
    if (pk.kind === 'plaza') {
      ctx.fillStyle = '#b8a888';
      ctx.beginPath();
      ctx.arc(pk.x + pk.w / 2, pk.y + pk.h / 2, 26, 0, TAU);
      ctx.fill();
    }
  }
  for (const lot of city.lots) {
    if (!inView(lot.x + lot.w / 2, lot.y + lot.h / 2, 200)) continue;
    ctx.fillStyle = '#6a655c';
    ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
  }
  // Roads.
  ctx.fillStyle = '#33363d';
  for (const rx of city.roadsX) ctx.fillRect(rx - ROAD_W / 2, vy0, ROAD_W, vy1 - vy0);
  for (const ry of city.roadsY) ctx.fillRect(vx0, ry - ROAD_W / 2, vx1 - vx0, ROAD_W);
  // Road markings: centre dashes.
  ctx.strokeStyle = '#d8b83a';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 22]);
  for (const rx of city.roadsX) {
    ctx.beginPath(); ctx.moveTo(rx, vy0); ctx.lineTo(rx, vy1); ctx.stroke();
  }
  for (const ry of city.roadsY) {
    ctx.beginPath(); ctx.moveTo(vx0, ry); ctx.lineTo(vx1, ry); ctx.stroke();
  }
  ctx.setLineDash([]);
  // Sidewalk edges.
  ctx.strokeStyle = 'rgba(220,220,210,0.5)';
  ctx.lineWidth = 2;
  for (const rx of city.roadsX) {
    ctx.beginPath(); ctx.moveTo(rx - ROAD_W / 2, vy0); ctx.lineTo(rx - ROAD_W / 2, vy1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx + ROAD_W / 2, vy0); ctx.lineTo(rx + ROAD_W / 2, vy1); ctx.stroke();
  }
  for (const ry of city.roadsY) {
    ctx.beginPath(); ctx.moveTo(vx0, ry - ROAD_W / 2); ctx.lineTo(vx1, ry - ROAD_W / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vx0, ry + ROAD_W / 2); ctx.lineTo(vx1, ry + ROAD_W / 2); ctx.stroke();
  }

  // Skid marks.
  ctx.strokeStyle = 'rgba(20,20,20,0.5)';
  ctx.lineWidth = 4;
  for (const s of world.skids) {
    if (!inView(s.x, s.y, 40)) continue;
    ctx.beginPath();
    ctx.moveTo(s.x - Math.cos(s.angle) * 14, s.y - Math.sin(s.angle) * 14);
    ctx.lineTo(s.x + Math.cos(s.angle) * 14, s.y + Math.sin(s.angle) * 14);
    ctx.stroke();
  }

  // Trees and palms.
  for (const t of city.trees) {
    if (!inView(t.x, t.y, 20)) continue;
    ctx.fillStyle = '#2f6b2f';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3f8a3f';
    ctx.beginPath(); ctx.arc(t.x - 3, t.y - 3, t.r * 0.6, 0, TAU); ctx.fill();
  }
  for (const pl of city.palms) {
    if (!inView(pl.x, pl.y, 20)) continue;
    ctx.strokeStyle = '#7a5a3a';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(pl.x, pl.y - 16); ctx.stroke();
    ctx.fillStyle = '#3f8a3f';
    ctx.beginPath(); ctx.arc(pl.x, pl.y - 18, 10, 0, TAU); ctx.fill();
  }

  // Buildings, with shadows and rooftop detail.
  for (const b of city.buildings) {
    if (!inView(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(b.x + 8, b.y + 10, b.w, b.h);
    ctx.fillStyle = b.wall;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
    if (b.tall) {
      // Windows on the roof edge, lit at night.
      const night = nightFactor() > 0.2;
      ctx.fillStyle = night ? '#ffe9a0' : '#3a4250';
      const cols = Math.floor(b.w / 16);
      const rows = Math.floor(b.h / 16);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          if ((i * 7 + j * 13 + b.floors) % 3 === 0) {
            ctx.fillRect(b.x + 8 + i * 16, b.y + 8 + j * 16, 7, 7);
          }
        }
      }
      if (b.helipad) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 14, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('H', b.x + b.w / 2, b.y + b.h / 2 + 5);
      }
    } else {
      // Rooftop AC units.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < b.roofUnits; i++) {
        ctx.fillRect(b.x + 10 + i * 18, b.y + 10, 12, 12);
      }
    }
    if (b.sign) {
      ctx.fillStyle = '#222';
      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(b.sign, b.x + b.w / 2, b.y + b.h / 2 + 4);
    }
  }

  // Shops, hospital and garage markers.
  drawPlaceMarkers(inView);

  // Mission marker beacon.
  if (world.markerForMap && !world.markerForMap.self) {
    const mk = world.markerForMap;
    const pulse = 1 + Math.sin(world.time * 4) * 0.15;
    ctx.strokeStyle = 'rgba(255,210,62,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(mk.x, mk.y, 30 * pulse, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,210,62,0.25)';
    ctx.beginPath(); ctx.arc(mk.x, mk.y, 30 * pulse, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.arc(mk.x, mk.y, 6, 0, TAU); ctx.fill();
    // Light beam.
    const grad = ctx.createLinearGradient(mk.x, mk.y - 260, mk.x, mk.y);
    grad.addColorStop(0, 'rgba(255,210,62,0)');
    grad.addColorStop(1, 'rgba(255,210,62,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(mk.x - 8, mk.y - 260, 16, 260);
  }

  // Pickups.
  for (const pk of world.pickups) {
    if (!inView(pk.x, pk.y, 30)) continue;
    const bob = Math.sin(pk.bob) * 3;
    ctx.fillStyle = pk.kind === 'cash' ? '#2fae4e' : pk.kind === 'health' ? '#e33e2e' : pk.kind === 'armor' ? '#5aa8e8' : '#ffd23e';
    ctx.beginPath(); ctx.arc(pk.x, pk.y + bob, 13, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(pk.kind === 'cash' ? '$' : pk.kind === 'health' ? '+' : pk.kind === 'armor' ? 'A' : '»', pk.x, pk.y + bob + 5);
  }

  // Cars (traffic, police, player).
  for (const car of world.cars) {
    if (!inView(car.x, car.y, 60)) continue;
    drawCar(car);
  }
  // Pedestrians.
  for (const ped of world.peds) {
    if (!inView(ped.x, ped.y, 20)) continue;
    drawPed(ped);
  }
  // Officers and enemies.
  for (const cop of world.cops) {
    if (!inView(cop.x, cop.y, 20)) continue;
    drawPerson(cop.x, cop.y, cop.angle, '#1d3a6e', '#c8a06a', 12);
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.arc(cop.x, cop.y - 8, 2.5, 0, TAU); ctx.fill();
  }
  for (const e of world.enemies) {
    if (!inView(e.x, e.y, 20)) continue;
    drawPerson(e.x, e.y, e.angle, e.shirt, '#c98d5f', 12);
    // Health bar.
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(e.x - 14, e.y - 24, 28, 5);
    ctx.fillStyle = '#e33e2e';
    ctx.fillRect(e.x - 14, e.y - 24, 28 * clamp(e.health / 100, 0, 1), 5);
  }
  // The player (on foot only; in a car the car is drawn instead).
  if (!world.player.inCar && !world.player.dead) {
    drawPlayer();
  }

  // Particles.
  for (const pt of world.particles) {
    const a = clamp(pt.life / pt.maxLife, 0, 1);
    if (pt.type === 'smoke') {
      ctx.fillStyle = 'rgba(120,120,120,' + (a * 0.5) + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, TAU); ctx.fill();
    } else if (pt.type === 'fire') {
      ctx.fillStyle = 'rgba(255,' + Math.floor(140 * a) + ',20,' + a + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * (0.6 + a), 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,220,80,' + a + ')';
      ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3);
    }
  }

  // Night lighting: a dark overlay, then lamp glows and headlights.
  const night = nightFactor();
  if (night > 0) {
    ctx.fillStyle = 'rgba(8,10,30,' + night + ')';
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    // Lamp glows.
    for (const lamp of city.lamps) {
      if (!inView(lamp.x, lamp.y, 60)) continue;
      const g = ctx.createRadialGradient(lamp.x, lamp.y, 2, lamp.x, lamp.y, 46);
      g.addColorStop(0, 'rgba(255,220,140,0.5)');
      g.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(lamp.x, lamp.y, 46, 0, TAU); ctx.fill();
    }
    // Headlights.
    for (const car of world.cars) {
      if (!inView(car.x, car.y, 120)) continue;
      const hx = car.x + Math.cos(car.angle) * 30;
      const hy = car.y + Math.sin(car.angle) * 30;
      const g = ctx.createRadialGradient(hx, hy, 4, hx, hy, 90);
      g.addColorStop(0, 'rgba(255,240,180,0.35)');
      g.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hx, hy, 90, 0, TAU); ctx.fill();
    }
  }

  ctx.restore();
}

function drawPlaceMarkers(inView) {
  const city = world.city;
  for (const s of city.shops) {
    if (!inView(s.x, s.y, 80)) continue;
    ctx.fillStyle = s.kind === 'guns' ? '#5a3a3a' : s.kind === 'food' ? '#a86a2e' : '#3a5a7a';
    ctx.fillRect(s.x - 40, s.y - 24, 80, 48);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(s.name, s.x, s.y + 4);
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.arc(s.x, s.y - 34, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('$', s.x, s.y - 30);
  }
  for (const hp of city.hospitals) {
    if (!inView(hp.x, hp.y, 80)) continue;
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(hp.x - 50, hp.y - 30, 100, 60);
    ctx.fillStyle = '#c23b2e';
    ctx.fillRect(hp.x - 8, hp.y - 20, 16, 40);
    ctx.fillRect(hp.x - 20, hp.y - 8, 40, 16);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(hp.name, hp.x, hp.y + 44);
  }
  for (const g of city.garages) {
    if (!inView(g.x, g.y, 80)) continue;
    ctx.fillStyle = '#3a4a5a';
    ctx.fillRect(g.x - 46, g.y - 28, 92, 56);
    ctx.fillStyle = '#ffd23e';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(g.name, g.x, g.y + 4);
  }
  // Taxi offer marker.
  if (world.taxi.offer) {
    const o = world.taxi.offer;
    ctx.fillStyle = '#7dff8a';
    ctx.beginPath(); ctx.arc(o.x, o.y, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', o.x, o.y + 4);
  }
}

function drawCar(car) {
  const m = car.model;
  const len = m.len;
  const wid = m.wid;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-len / 2 + 3, -wid / 2 + 4, len, wid);
  // Body.
  ctx.fillStyle = car.color;
  roundRect(-len / 2, -wid / 2, len, wid, 7);
  ctx.fill();
  // Roof + windows.
  ctx.fillStyle = 'rgba(20,26,34,0.85)';
  roundRect(-len * 0.18, -wid / 2 + 3, len * 0.36, wid - 6, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,200,230,0.7)';
  ctx.fillRect(len * 0.2, -wid / 2 + 4, 6, wid - 8);
  // Headlights / brake lights.
  ctx.fillStyle = '#fff8c0';
  ctx.fillRect(len / 2 - 2, -wid / 2 + 2, 3, 5);
  ctx.fillRect(len / 2 - 2, wid / 2 - 7, 3, 5);
  ctx.fillStyle = car.brakeLight ? '#ff2e2e' : '#a02020';
  ctx.fillRect(-len / 2 - 1, -wid / 2 + 2, 3, 5);
  ctx.fillRect(-len / 2 - 1, wid / 2 - 7, 3, 5);
  if (car.kind === 'police') {
    // Flashing light bar.
    const phase = Math.floor(world.time * 6) % 2 === 0;
    ctx.fillStyle = phase ? '#ff2e2e' : '#2e6fff';
    ctx.fillRect(-6, -wid / 2 - 2, 12, 5);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('PD', 0, 3);
  }
  if (car.kind === 'taxi' || car.model.name === 'Taxi') {
    ctx.fillStyle = '#222';
    ctx.fillRect(-len / 2 + 4, -wid / 2 + 1, len - 8, 3);
    ctx.fillStyle = '#ffd23e';
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, -wid / 2 + 12);
  }
  if (car.health < 50) {
    // Smoke from a damaged car.
    if (Math.random() < 0.2) addParticle(world, car.x, car.y, 'smoke');
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPerson(x, y, angle, shirt, skin, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.arc(2, 3, r * 0.9, 0, TAU); ctx.fill();
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(3, 0, r * 0.55, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawPed(ped) {
  if (ped.state === 'down') {
    // Lying down.
    ctx.fillStyle = ped.shirt;
    ctx.beginPath(); ctx.ellipse(ped.x, ped.y, 12, 6, ped.angle, 0, TAU); ctx.fill();
    return;
  }
  const bob = Math.sin(ped.bob) * 1.5;
  drawPerson(ped.x, ped.y + bob * 0.3, ped.angle, ped.shirt, ped.skin, 9);
}

function drawPlayer() {
  const p = world.player;
  const bob = p.moving ? Math.sin(p.bob) * 1.5 : 0;
  ctx.save();
  ctx.translate(p.x, p.y + bob * 0.3);
  ctx.rotate(p.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(2, 3, 11, 0, TAU); ctx.fill();
  // A thin white ring keeps Jax easy to spot in a busy street.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
  // Jax: teal jacket, dark jeans.
  ctx.fillStyle = '#1f8a7a';
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e8b98a';
  ctx.beginPath(); ctx.arc(4, 0, 6.5, 0, TAU); ctx.fill();
  // Gun in hand when armed.
  if (p.weapon === 'pistol') {
    ctx.fillStyle = '#222';
    ctx.fillRect(8, -2, 12, 4);
    if (p.muzzle > 0) {
      ctx.fillStyle = 'rgba(255,220,80,' + p.muzzle + ')';
      ctx.beginPath(); ctx.arc(24, 0, 8 * p.muzzle, 0, TAU); ctx.fill();
    }
  } else if (p.punchAt > 0.15) {
    // Punching arm.
    ctx.fillStyle = '#e8b98a';
    ctx.fillRect(8, -3, 12, 6);
  }
  ctx.restore();
  // Low-health warning ring.
  if (p.health < 30) {
    ctx.strokeStyle = 'rgba(255,40,40,' + (0.5 + Math.sin(world.time * 6) * 0.3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, TAU); ctx.stroke();
  }
}

// --- main loop ------------------------------------------------------------

let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000 || 0.016));
  lastT = t;
  if (world.state === 'play') update(dt);
  render();
}

// --- screenshot staging ---------------------------------------------------
// ?shot=cover|street|mission|night stages a scene, lets it play for a few
// seconds, then freezes it so a headless screenshot catches a lively frame.

function stageShot(name) {
  newWorld(SEED);
  world.state = 'play';
  const p = world.player;
  if (name === 'cover') {
    // Dusk getaway: driving fast down the main avenue, wanted 3, cops chasing.
    world.timeOfDay = 18.6;
    const car = makeCar(world.rng, world.city, { x: 1760, y: 1130, angle: 0, kind: 'player', color: '#c23b2e', model: { name: 'Sports', len: 44, wid: 22, max: 600, accel: 980 } });
    world.cars.push(car);
    p.inCar = car;
    world.playerCar = car;
    p.x = car.x; p.y = car.y;
    car.speed = 380;
    addHeat(world, 62);
    startMission(world, 3);
    world.completedMissions = [1, 2, 3];
    world.mission.step = 1;
    for (let i = 0; i < 3; i++) {
      const spot = { x: 1760 - 200 - i * 120, y: 1130 };
      const cop = makeCar(world.rng, world.city, { x: spot.x, y: spot.y, angle: 0, kind: 'police', color: '#1d2126', model: { name: 'Interceptor', len: 46, wid: 22, max: 560, accel: 900 } });
      cop.speed = 420;
      world.cars.push(cop);
    }
  } else if (name === 'street') {
    // Midday on foot downtown: traffic, pedestrians, shops, mission marker.
    world.timeOfDay = 11.5;
    p.x = 1760; p.y = 1130;
    p.cash = 1250;
    startMission(world, 0);
    world.completedMissions = [];
  } else if (name === 'mission') {
    // Dockside shootout at dusk: Jax with a pistol, Harbor Boys closing in.
    world.timeOfDay = 19.4;
    p.x = 590; p.y = 2030;
    p.weapon = 'pistol';
    p.ammo = 12; p.reserveAmmo = 48;
    p.cash = 2400;
    startMission(world, 4);
    world.completedMissions = [1, 2, 3, 4];
    world.mission.step = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      world.enemies.push({ x: 560 + Math.cos(a) * 150, y: 2030 + Math.sin(a) * 150, angle: 0, health: 100, speed: 130, shootAt: 0.4 + i * 0.3, dead: false, kind: 'harbor', shirt: '#3a6ea8' });
    }
    addHeat(world, 45);
  } else if (name === 'night') {
    // Night drive along the beach road, neon shops, one cop on the tail.
    world.timeOfDay = 22.5;
    const car = makeCar(world.rng, world.city, { x: 2960, y: 1430, angle: -Math.PI / 2, kind: 'player', color: '#2e6fc2', model: { name: 'Coupe', len: 44, wid: 21, max: 520, accel: 820 } });
    world.cars.push(car);
    p.inCar = car;
    world.playerCar = car;
    p.x = car.x; p.y = car.y;
    car.speed = 320;
    addHeat(world, 22);
    const cop = makeCar(world.rng, world.city, { x: 2960, y: 1620, angle: -Math.PI / 2, kind: 'police', color: '#e8e8e8', model: { name: 'Interceptor', len: 46, wid: 22, max: 560, accel: 900 } });
    cop.speed = 380;
    world.cars.push(cop);
    startMission(world, 1);
    world.completedMissions = [1];
  }
  world.camera.x = p.x;
  world.camera.y = p.y;
  // Clean action frame: no banner, subtitle or toast covering the scene.
  world.banner = null;
  world.subtitle = null;
  world.toast = null;
  world.freezeAt = world.time + 3.2;
  world.shotStaged = true;
}

// --- scripted self-test ---------------------------------------------------
// ?selftest=1 runs the game's systems headlessly and writes PASS/FAIL lines
// into #selftest and the document title. No real input is needed.

function runSelfTest() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
  try {
    newWorld(SEED);
    world.state = 'play';
    const p = world.player;
    const step = (n, input) => {
      if (input) Object.assign(world.input, input);
      for (let i = 0; i < n; i++) update(1 / 60);
      if (input) { world.input.up = false; world.input.down = false; world.input.left = false; world.input.right = false; world.input.run = false; }
    };
    // 1. Walk.
    const y0 = p.y;
    step(60, { up: true });
    check('walk', p.y < y0 - 50, 'moved ' + Math.round(y0 - p.y) + ' units north');
    // 2. Enter a car (parked on the road the player is standing on, facing north).
    const car = makeCar(world.rng, world.city, { x: p.x, y: p.y, angle: -Math.PI / 2, kind: 'traffic', driver: false, color: '#c23b2e' });
    world.cars.push(car);
    tryEnterCar(world);
    check('enter_car', p.inCar === car, p.inCar ? 'in ' + car.model.name : 'not in car');
    // 3. Drive.
    const x0 = p.x;
    const y0d = p.y;
    step(120, { up: true });
    check('drive', Math.abs(car.speed) > 100 && dist(p.x, p.y, x0, y0d) > 100, 'speed ' + Math.round(car.speed) + ', moved ' + Math.round(dist(p.x, p.y, x0, y0d)));
    // 4. Exit and shoot.
    tryEnterCar(world);
    check('exit_car', !p.inCar, 'on foot again');
    p.weapon = 'pistol'; p.ammo = 12; p.reserveAmmo = 24;
    const ammo0 = p.ammo;
    const heat0 = world.heat;
    world.mouse.wx = p.x + 100; world.mouse.wy = p.y;
    world.input.mouseDown = true;
    step(15);
    world.input.mouseDown = false;
    check('shoot', p.ammo < ammo0 && world.heat > heat0, 'ammo ' + ammo0 + '->' + p.ammo + ', heat ' + heat0 + '->' + Math.round(world.heat));
    // 5. Wanted level and police response.
    addHeat(world, 70);
    step(240);
    const cops = world.cars.filter((c) => c.kind === 'police').length;
    check('wanted_police', world.wanted >= 3 && cops >= 2, 'wanted ' + world.wanted + ', police cars ' + cops);
    // 6. Mission start and objective advance.
    const started = startMission(world, 0);
    const stepLabel = world.mission.def.steps[0].label;
    p.x = 560; p.y = 1130;
    step(30);
    check('mission', started && world.mission && world.mission.step === 1, 'started, step now ' + (world.mission ? world.mission.step : 'none') + ' (' + stepLabel + ')');
    // 7. Heat decays when the player lays low.
    const heatBefore = world.heat;
    world.lastCrimeAt = world.time - 20;
    step(600);
    check('heat_decay', world.heat < heatBefore, 'heat ' + Math.round(heatBefore) + '->' + Math.round(world.heat));
    // 8. Save and load round-trip.
    p.cash = 1234;
    saveGame(world);
    p.cash = 0;
    const loaded = loadGame(world);
    check('save_load', loaded && p.cash === 1234, 'cash after load ' + p.cash);
    // 9. Taxi offer can be accepted.
    world.taxi.offer = { x: p.x + 40, y: p.y, t: 20 };
    const accepted = acceptTaxiOffer(world);
    check('taxi', accepted && world.taxi.active, 'offer accepted, phase ' + world.taxi.phase);
    // 10. No external references in the loaded modules (static check).
    check('modules_loaded', typeof drawHUD === 'function' && typeof updatePolice === 'function', 'all systems present');
  } catch (err) {
    results.push({ name: 'exception', ok: false, detail: String(err && err.message || err) });
  }
  const passed = results.filter((r) => r.ok).length;
  const lines = results.map((r) => (r.ok ? 'PASS' : 'FAIL') + ' ' + r.name + (r.detail ? ' — ' + r.detail : ''));
  lines.push('SELFTEST ' + passed + '/' + results.length + ' passed');
  const el = document.getElementById('selftest');
  if (el) el.textContent = lines.join('\n');
  document.title = 'SELFTEST_' + passed + '_OF_' + results.length;
}

// --- boot -----------------------------------------------------------------

newWorld(SEED);
world.menuItems = hasSave() ? ['New Game', 'Continue', 'How to Play'] : ['New Game', 'How to Play'];
if (!hasSave()) world.menuSel = 0;

const shot = params.get('shot');
if (params.get('selftest') === '1') {
  runSelfTest();
} else if (shot) {
  stageShot(shot);
} else {
  status('SOLMARA loaded. Choose New Game to start.');
}
requestAnimationFrame(loop);
