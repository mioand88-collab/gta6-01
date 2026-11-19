// city.js — builds Solmara, the game's city: roads, blocks, buildings, parks,
// the beach and the sea, districts, shops, and the collision queries the rest
// of the game uses. The layout is generated from a seed, so it is the same
// city every time a given seed is used.

import { makeRng, pick, range, intRange, chance, clamp } from './util.js';

export const WORLD_W = 3600;
export const WORLD_H = 2600;
export const ROAD_W = 76;

// District names shown on the HUD when the player crosses into one.
export const DISTRICTS = [
  { name: 'Downtown', x0: 1250, y0: 650, x1: 2350, y1: 1750, ground: '#8a8578' },
  { name: 'Old Solmara', x0: 0, y0: 0, x1: 1250, y1: 2600, ground: '#9a8f7a' },
  { name: 'Palms North', x0: 1250, y0: 0, x1: 3350, y1: 650, ground: '#a89a7c' },
  { name: 'Marina Bay', x0: 2350, y0: 650, x1: 3350, y1: 1750, ground: '#948b74' },
  { name: 'Dockside', x0: 0, y0: 1750, x1: 3350, y1: 2600, ground: '#7e7a72' },
];

const ROOF_COLORS = ['#b5543f', '#c77e4a', '#7d8a99', '#5d7a68', '#a89a6a', '#8a6f8f', '#6b7f9e', '#c2a878'];
const WALL_COLORS = ['#d8c9a8', '#c9b18c', '#b8a58e', '#d0b49a', '#c2b49a', '#e0d0b8', '#bfae90'];
const TOWER_COLORS = ['#6e7f92', '#7d8aa0', '#5f7488', '#8a7f6e', '#74818f'];
const CAR_COLORS = ['#c23b2e', '#2e6fc2', '#e8c832', '#3fae6a', '#e8e8e8', '#22242a', '#c77e2e', '#7a4a9e', '#4aa8b0', '#b0b8c0'];

export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  }
  return DISTRICTS[0];
}

export function buildCity(seed) {
  const rng = makeRng(seed);
  const roadsX = [];
  const roadsY = [];
  for (let x = 260; x < WORLD_W - 260; x += 300) roadsX.push(x);
  for (let y = 260; y < WORLD_H - 260; y += 300) roadsY.push(y);
  // The sea takes the far east strip; no roads or buildings there.
  const seaX = 3350;
  const beachX = 3260;

  const buildings = [];
  const parks = [];
  const trees = [];
  const lots = [];
  const shops = [];
  const hospitals = [];
  const garages = [];
  const payphones = [];

  // Walk every block between neighbouring roads and fill it.
  for (let ix = 0; ix <= roadsX.length; ix++) {
    const bx0 = ix === 0 ? 40 : roadsX[ix - 1] + ROAD_W / 2 + 14;
    const bx1 = ix === roadsX.length ? beachX - 14 : roadsX[ix] - ROAD_W / 2 - 14;
    for (let iy = 0; iy <= roadsY.length; iy++) {
      const by0 = iy === 0 ? 40 : roadsY[iy - 1] + ROAD_W / 2 + 14;
      const by1 = iy === roadsY.length ? WORLD_H - 40 : roadsY[iy] - ROAD_W / 2 - 14;
      const bw = bx1 - bx0;
      const bh = by1 - by0;
      if (bw < 60 || bh < 60) continue;
      const cx = (bx0 + bx1) / 2;
      const cy = (by0 + by1) / 2;
      const downtown = cx > 1250 && cx < 2350 && cy > 650 && cy < 1750;
      const roll = rng();
      if (roll < 0.12) {
        // A park: grass, trees, a pond or a fountain square.
        parks.push({ x: bx0, y: by0, w: bw, h: bh, kind: rng() < 0.5 ? 'trees' : 'plaza' });
        const n = intRange(rng, 6, 12);
        for (let i = 0; i < n; i++) {
          trees.push({ x: range(rng, bx0 + 14, bx1 - 14), y: range(rng, by0 + 14, by1 - 14), r: range(rng, 7, 12) });
        }
        continue;
      }
      if (roll < 0.2) {
        // An open lot: parking or a vacant yard with a few props.
        lots.push({ x: bx0, y: by0, w: bw, h: bh });
        continue;
      }
      // Buildings: one big one, or two to four smaller ones.
      const tall = downtown && chance(rng, 0.55);
      const count = tall ? 1 : intRange(rng, 1, 3);
      if (count === 1) {
        const w = bw * range(rng, 0.55, 0.8);
        const h = bh * range(rng, 0.55, 0.8);
        buildings.push(makeBuilding(rng, bx0 + (bw - w) / 2, by0 + (bh - h) / 2, w, h, tall));
      } else {
        const cols = 2;
        const rows = count > 2 ? 2 : 1;
        const cw = bw / cols;
        const ch = bh / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (r * cols + c >= count) break;
            if (chance(rng, 0.2)) continue;
            const w = cw * range(rng, 0.6, 0.82);
            const h = ch * range(rng, 0.6, 0.82);
            buildings.push(makeBuilding(rng, bx0 + c * cw + (cw - w) / 2, by0 + r * ch + (ch - h) / 2, w, h, false));
          }
        }
      }
    }
  }

  // Shops: a gun store, a burger bar, a clothes shop, a garage, a hospital.
  // Each sits on a road corner so the player can find it from the street.
  const shopDefs = [
    { kind: 'guns', name: 'IRONWORKS', label: 'Guns & Ammo', x: 560, y: 830 },
    { kind: 'food', name: 'BURGER BAY', label: 'Food — heals $8', x: 1760, y: 530 },
    { kind: 'clothes', name: 'THREADS', label: 'Clothes — armor $25', x: 2060, y: 1430 },
    { kind: 'food', name: 'TACO STAND', label: 'Food — heals $8', x: 860, y: 2030 },
    { kind: 'guns', name: 'IRONWORKS', label: 'Guns & Ammo', x: 2660, y: 1130 },
  ];
  for (const s of shopDefs) shops.push({ ...s, r: 46 });
  hospitals.push({ x: 1160, y: 1730, r: 60, name: 'SOLMARA GENERAL' });
  garages.push({ x: 2360, y: 2330, r: 56, name: 'PAYBACK GARAGE' });
  payphones.push({ x: 1460, y: 830 }, { x: 2960, y: 1730 }, { x: 560, y: 1730 });

  // Street props: palms along the beach road, lamps on every corner.
  const lamps = [];
  for (const rx of roadsX) {
    for (const ry of roadsY) {
      lamps.push({ x: rx - ROAD_W / 2 - 6, y: ry - ROAD_W / 2 - 6 });
      lamps.push({ x: rx + ROAD_W / 2 + 6, y: ry + ROAD_W / 2 + 6 });
    }
  }
  const palms = [];
  for (let y = 120; y < WORLD_H; y += 130) {
    palms.push({ x: beachX - 26, y: y + range(rng, -20, 20) });
  }

  return {
    seed, rng, roadsX, roadsY, seaX, beachX,
    buildings, parks, trees, lots, shops, hospitals, garages, payphones,
    lamps, palms,
    carColors: CAR_COLORS,
  };
}

function makeBuilding(rng, x, y, w, h, tall) {
  const wall = tall ? pick(rng, TOWER_COLORS) : pick(rng, WALL_COLORS);
  return {
    x, y, w, h,
    tall,
    floors: tall ? intRange(rng, 8, 18) : intRange(rng, 1, 3),
    wall, roof: pick(rng, ROOF_COLORS),
    // Rooftop clutter drawn for taller buildings.
    roofUnits: tall ? intRange(rng, 1, 4) : 0,
    helipad: tall && chance(rng, 0.25),
    sign: chance(rng, 0.3) ? pick(rng, ['HOTEL', 'OFFICES', 'APTS', 'MALL', 'BANK', 'CASINO']) : null,
  };
}

// Is the point on a road (including the sidewalk edge used by pedestrians)?
export function onRoad(city, x, y) {
  for (const rx of city.roadsX) {
    if (Math.abs(x - rx) <= ROAD_W / 2) return true;
  }
  for (const ry of city.roadsY) {
    if (Math.abs(y - ry) <= ROAD_W / 2) return true;
  }
  return false;
}

export function inSea(city, x, y) {
  return x >= city.seaX;
}

export function onBeach(city, x, y) {
  return x >= city.beachX && x < city.seaX;
}

// Circle (x, y, r) against every building; returns the first building hit or null.
export function hitBuilding(city, x, y, r) {
  for (const b of city.buildings) {
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return b;
  }
  return null;
}

// Push a circle out of a building AABB; returns true when a push happened.
export function resolveBuilding(city, obj, r) {
  const b = hitBuilding(city, obj.x, obj.y, r);
  if (!b) return false;
  const cx = clamp(obj.x, b.x, b.x + b.w);
  const cy = clamp(obj.y, b.y, b.y + b.h);
  let dx = obj.x - cx;
  let dy = obj.y - cy;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0) {
    // Centre is inside the building: push out along the smallest penetration.
    const pl = obj.x - b.x + r;
    const pr = b.x + b.w - obj.x + r;
    const pt = obj.y - b.y + r;
    const pb = b.y + b.h - obj.y + r;
    const m = Math.min(pl, pr, pt, pb);
    if (m === pl) obj.x = b.x - r;
    else if (m === pr) obj.x = b.x + b.w + r;
    else if (m === pt) obj.y = b.y - r;
    else obj.y = b.y + b.h + r;
    return true;
  }
  dx /= d; dy /= d;
  obj.x = cx + dx * r;
  obj.y = cy + dy * r;
  return true;
}

// Keep a point inside the playable land (not in the sea, not off the map).
export function clampToLand(city, obj, r) {
  obj.x = clamp(obj.x, r + 8, city.beachX - r - 4);
  obj.y = clamp(obj.y, r + 8, WORLD_H - r - 8);
}

// A random point on a road, for spawning cars and pedestrians.
export function randomRoadPoint(rng, city) {
  if (rng() < 0.5) {
    const rx = pick(rng, city.roadsX);
    return { x: rx + range(rng, -ROAD_W / 4, ROAD_W / 4), y: range(rng, 60, WORLD_H - 60) };
  }
  const ry = pick(rng, city.roadsY);
  return { x: range(rng, 60, city.beachX - 60), y: ry + range(rng, -ROAD_W / 4, ROAD_W / 4) };
}

// Nearest intersection to a point (used for police spawns and navigation).
export function nearestIntersection(city, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const rx of city.roadsX) {
    for (const ry of city.roadsY) {
      const d = (rx - x) * (rx - x) + (ry - y) * (ry - y);
      if (d < bestD) { bestD = d; best = { x: rx, y: ry }; }
    }
  }
  return best;
}
