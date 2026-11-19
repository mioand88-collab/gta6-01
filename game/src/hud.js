// hud.js — everything drawn on top of the world: the HUD (health, cash,
// wanted stars, clock, weapon, speed), the minimap, objective text, dialogue
// subtitles, banners, and the title / pause / game-over screens.

import { clamp, fmtCash, fmtClock, dist } from './util.js';
import { WORLD_W, WORLD_H, districtAt } from './city.js';
import { MISSIONS } from './missions.js';

const FONT = 'bold 14px "Segoe UI", Arial, sans-serif';
const FONT_BIG = 'bold 22px "Segoe UI", Arial, sans-serif';

export function drawHUD(ctx, world, view) {
  const p = world.player;
  const w = view.w;
  const h = view.h;

  // --- top left: wanted stars ---
  const stars = world.wanted || 0;
  ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < 5; i++) {
    const x = 18 + i * 30;
    ctx.fillStyle = i < stars ? '#ffd23e' : 'rgba(0,0,0,0.45)';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    star(ctx, x + 11, 30, 11, i < stars);
  }

  // --- top right: cash, clock, district ---
  ctx.textAlign = 'right';
  ctx.font = FONT_BIG;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(w - 210, 10, 200, 86);
  ctx.fillStyle = '#7dff8a';
  ctx.fillText(fmtCash(p.cash), w - 20, 16);
  ctx.fillStyle = '#fff';
  ctx.font = FONT;
  ctx.fillText(fmtClock(world.timeOfDay) + '  •  ' + districtAt(p.x, p.y).name, w - 20, 46);
  const next = world.completedMissions.length;
  ctx.fillStyle = '#ffd23e';
  ctx.fillText(next < MISSIONS.length ? 'Job ' + (next + 1) + ' of ' + MISSIONS.length : 'All jobs done', w - 20, 68);

  // --- bottom left: health + armor ---
  bar(ctx, 18, h - 58, 220, 16, p.health / 100, '#e33e2e', 'HEALTH');
  bar(ctx, 18, h - 36, 220, 12, p.armor / 100, '#5aa8e8', 'ARMOR');

  // --- bottom right: weapon + speed (above the minimap) ---
  ctx.textAlign = 'right';
  ctx.font = FONT_BIG;
  ctx.fillStyle = '#fff';
  if (p.weapon === 'pistol') {
    ctx.fillText('PISTOL  ' + p.ammo + ' / ' + p.reserveAmmo, w - 20, h - 226);
  } else {
    ctx.fillText('FISTS', w - 20, h - 226);
  }
  if (p.inCar) {
    const kmh = Math.round(Math.abs(p.inCar.speed) * 0.36);
    ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
    ctx.fillText(kmh + ' km/h', w - 20, h - 200);
    ctx.font = FONT;
    ctx.fillStyle = '#ffd23e';
    ctx.fillText(p.inCar.model.name, w - 20, h - 252);
  }

  // --- objective tracker (top centre) ---
  const step = world.mission ? world.mission.def.steps[world.mission.step] : null;
  if (world.mission && step) {
    ctx.textAlign = 'center';
    ctx.font = FONT_BIG;
    const label = fitLabel(ctx, world.mission.def.title + ': ' + step.label, w - 480);
    const tw = ctx.measureText(label).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(w / 2 - tw / 2, 12, tw, 34);
    ctx.fillStyle = '#ffd23e';
    ctx.fillText(label, w / 2, 18);
    if (step.type === 'collect' && world.mission.timer > 0) {
      const frac = world.mission.timer / step.seconds;
      bar(ctx, w / 2 - 110, 52, 220, 8, frac, '#ffd23e', '');
    }
    if (step.type === 'survive') {
      ctx.font = FONT;
      ctx.fillStyle = '#fff';
      ctx.fillText('Survive: ' + Math.ceil(step.seconds - world.mission.timer) + 's', w / 2, 52);
    }
  } else if (world.pendingMission !== null && world.pendingMission !== undefined) {
    ctx.textAlign = 'center';
    ctx.font = FONT;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const label = 'New job from ' + MISSIONS[world.pendingMission].giver + ' — press M to take it';
    const tw = ctx.measureText(label).width + 28;
    ctx.fillRect(w / 2 - tw / 2, 12, tw, 30);
    ctx.fillStyle = '#ffd23e';
    ctx.fillText(label, w / 2, 18);
  }

  // --- interaction prompt (bottom centre) ---
  if (world.prompt) {
    ctx.textAlign = 'center';
    ctx.font = FONT_BIG;
    const tw = ctx.measureText(world.prompt).width + 30;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(w / 2 - tw / 2, h - 128, tw, 34);
    ctx.fillStyle = '#fff';
    ctx.fillText(world.prompt, w / 2, h - 122);
  }

  // --- toast message ---
  if (world.toast && world.toast.t > 0) {
    ctx.textAlign = 'center';
    ctx.font = FONT;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const tw = ctx.measureText(world.toast.text).width + 24;
    ctx.fillRect(w / 2 - tw / 2, h - 172, tw, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(world.toast.text, w / 2, h - 166);
  }

  // --- subtitle (dialogue), wrapped so long lines never run off-screen ---
  if (world.subtitle && world.subtitle.t > 0) {
    ctx.font = 'italic 17px "Segoe UI", Arial, sans-serif';
    const lines = wrapLines(ctx, world.subtitle.who + ': "' + world.subtitle.text + '"', Math.min(w - 120, 980));
    const lh = 26;
    const boxH = lines.length * lh + 8;
    const boxW = Math.min(w - 80, Math.max(...lines.map((ln) => ctx.measureText(ln).width)) + 30);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(w / 2 - boxW / 2, h - 216 - (lines.length - 1) * lh, boxW, boxH);
    ctx.fillStyle = '#ffe9a8';
    ctx.textAlign = 'center';
    lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h - 209 - (lines.length - 1) * lh + i * lh));
  }

  // --- banner (mission complete / failed), wrapped ---
  if (world.banner && world.banner.t > 0) {
    const a = clamp(world.banner.t, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#ffd23e';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 12;
    ctx.fillText(world.banner.title, w / 2, h * 0.3);
    ctx.shadowBlur = 0;
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    const subLines = wrapLines(ctx, world.banner.sub, Math.min(w - 160, 880));
    ctx.fillStyle = '#fff';
    subLines.forEach((ln, i) => ctx.fillText(ln, w / 2, h * 0.3 + 48 + i * 28));
    ctx.globalAlpha = 1;
  }

  // --- damage vignette ---
  if (world.flashRed > 0) {
    ctx.fillStyle = 'rgba(200,20,20,' + (world.flashRed * 0.45) + ')';
    ctx.fillRect(0, 0, w, h);
  }

  drawMinimap(ctx, world, view);
  drawEdgeArrow(ctx, world, view);
}

function star(ctx, x, y, r, filled) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Wrap text to lines no wider than maxW (uses the caller's current font).
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// Shorten a one-line label with an ellipsis so it fits maxW.
function fitLabel(ctx, label, maxW) {
  if (ctx.measureText(label).width <= maxW) return label;
  let s = label;
  while (s.length > 4 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function bar(ctx, x, y, w, h, frac, color, label) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  if (label) {
    ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + 4, y + 2);
  }
}

function drawMinimap(ctx, world, view) {
  const w = view.w;
  const h = view.h;
  const mw = 200;
  const mh = 146;
  const x0 = w - mw - 16;
  const y0 = h - mh - 16;
  const sx = mw / WORLD_W;
  const sy = mh / WORLD_H;
  ctx.fillStyle = 'rgba(8,10,16,0.78)';
  ctx.fillRect(x0 - 4, y0 - 4, mw + 8, mh + 8);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, mw, mh);
  ctx.clip();
  // Water + beach.
  ctx.fillStyle = '#2e6ea8';
  ctx.fillRect(x0 + world.city.seaX * sx, y0, mw - world.city.seaX * sx, mh);
  ctx.fillStyle = '#d8c08a';
  ctx.fillRect(x0 + world.city.beachX * sx, y0, (world.city.seaX - world.city.beachX) * sx, mh);
  // Ground.
  ctx.fillStyle = '#4a4640';
  ctx.fillRect(x0, y0, world.city.beachX * sx, mh);
  // Parks.
  ctx.fillStyle = '#3f7a44';
  for (const pk of world.city.parks) ctx.fillRect(x0 + pk.x * sx, y0 + pk.y * sy, pk.w * sx, pk.h * sy);
  // Roads.
  ctx.strokeStyle = '#c8c4b8';
  ctx.lineWidth = 2;
  for (const rx of world.city.roadsX) {
    ctx.beginPath(); ctx.moveTo(x0 + rx * sx, y0); ctx.lineTo(x0 + rx * sx, y0 + mh); ctx.stroke();
  }
  for (const ry of world.city.roadsY) {
    ctx.beginPath(); ctx.moveTo(x0, y0 + ry * sy); ctx.lineTo(x0 + mw, y0 + ry * sy); ctx.stroke();
  }
  // Mission marker.
  const marker = world.markerForMap;
  if (marker) {
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.arc(x0 + marker.x * sx, y0 + marker.y * sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Taxi offer.
  if (world.taxi.offer) {
    ctx.fillStyle = '#7dff8a';
    ctx.beginPath();
    ctx.arc(x0 + world.taxi.offer.x * sx, y0 + world.taxi.offer.y * sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Police blips.
  ctx.fillStyle = '#4aa8ff';
  for (const car of world.cars) {
    if (car.kind === 'police') {
      ctx.beginPath();
      ctx.arc(x0 + car.x * sx, y0 + car.y * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Player arrow.
  const px = x0 + world.player.x * sx;
  const py = y0 + world.player.y * sy;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(world.player.angle);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(8, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
  // North indicator.
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('N', x0 + 4, y0 + 14);
}

// Arrow at the screen edge pointing at the mission marker when it is off-screen.
function drawEdgeArrow(ctx, world, view) {
  const marker = world.markerForMap;
  if (!marker || marker.self) return;
  const cam = world.camera;
  const wx = (marker.x - cam.x) * cam.zoom + view.w / 2;
  const wy = (marker.y - cam.y) * cam.zoom + view.h / 2;
  if (wx > 60 && wx < view.w - 60 && wy > 60 && wy < view.h - 60) return;
  const cx = clamp(wx, 70, view.w - 70);
  const cy = clamp(wy, 70, view.h - 70);
  const ang = Math.atan2(wy - view.h / 2, wx - view.w / 2);
  const d = dist(world.player.x, world.player.y, marker.x, marker.y);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = '#ffd23e';
  ctx.beginPath();
  ctx.moveTo(16, 0); ctx.lineTo(-10, -10); ctx.lineTo(-10, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.fillText(Math.round(d) + 'm', cx, cy + 26);
}

// --- screens ----------------------------------------------------------------

export function drawTitle(ctx, world, view) {
  const w = view.w;
  const h = view.h;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1b2a4a');
  g.addColorStop(0.55, '#c96a3a');
  g.addColorStop(1, '#2a1a2e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Sun.
  ctx.fillStyle = '#ffd98a';
  ctx.beginPath();
  ctx.arc(w * 0.72, h * 0.3, 70, 0, Math.PI * 2);
  ctx.fill();
  // Skyline silhouette.
  ctx.fillStyle = '#14101c';
  const base = h * 0.72;
  let x = 0;
  const rngHeights = [120, 200, 150, 260, 180, 300, 140, 220, 170, 280, 130, 210];
  for (let i = 0; x < w; i++) {
    const bw = 60 + ((i * 37) % 50);
    const bh = rngHeights[i % rngHeights.length] * (0.7 + ((i * 13) % 40) / 100);
    ctx.fillRect(x, base - bh, bw, bh);
    x += bw + 8;
  }
  ctx.fillStyle = '#0c0a12';
  ctx.fillRect(0, base, w, h - base);
  // Title.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 92px "Segoe UI", Arial, sans-serif';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 24;
  ctx.fillText('SOLMARA', w / 2, h * 0.3);
  ctx.shadowBlur = 0;
  ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('AN OPEN-WORLD CRIME STORY', w / 2, h * 0.3 + 44);
  ctx.font = '16px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#ffd9a8';
  ctx.fillText('Steal cars. Run jobs. Lose the cops. Pay the debt.', w / 2, h * 0.3 + 74);

  // Menu.
  const items = world.menuItems;
  const sel = world.menuSel;
  ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
  items.forEach((item, i) => {
    const y = h * 0.52 + i * 46;
    if (i === sel) {
      ctx.fillStyle = '#ffd23e';
      ctx.fillText('▶ ' + item, w / 2, y);
    } else {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(item, w / 2, y);
    }
  });

  // Controls.
  ctx.font = '15px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#cfd4de';
  const lines = [
    'WASD / Arrows — move & drive      E — enter / steal a car      Mouse — aim, Click — shoot',
    'F — punch      R — reload      Shift — run      Space — handbrake      M — next job / phone',
    'Esc — pause      H — help      N — mute music      Save: automatic after every job',
  ];
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h * 0.82 + i * 24));
  ctx.font = '13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#8a93a8';
  ctx.fillText('An original game. No affiliation with Rockstar Games or the Grand Theft Auto series.', w / 2, h - 18);
}

export function drawPause(ctx, world, view) {
  const w = view.w;
  const h = view.h;
  ctx.fillStyle = 'rgba(5,8,14,0.72)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
  ctx.fillText('PAUSED', w / 2, h * 0.3);
  ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
  world.pauseItems.forEach((item, i) => {
    const y = h * 0.44 + i * 44;
    ctx.fillStyle = i === world.pauseSel ? '#ffd23e' : '#e8e8e8';
    ctx.fillText((i === world.pauseSel ? '▶ ' : '') + item, w / 2, y);
  });
  ctx.font = '15px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#cfd4de';
  const s = world.stats;
  ctx.fillText('Cash ' + fmtCash(world.player.cash) + '   •   Jobs done ' + (s.missionsDone || 0) + ' / ' + MISSIONS.length +
    '   •   Fares ' + (s.fares || 0) + '   •   Cars stolen ' + (s.carsStolen || 0), w / 2, h * 0.72);
}

export function drawGameOver(ctx, world, view) {
  const w = view.w;
  const h = view.h;
  ctx.fillStyle = world.gameOver === 'busted' ? 'rgba(10,20,60,0.78)' : 'rgba(60,8,8,0.78)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 64px "Segoe UI", Arial, sans-serif';
  ctx.fillText(world.gameOver === 'busted' ? 'BUSTED' : 'WASTED', w / 2, h * 0.4);
  ctx.font = '20px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#ffd9a8';
  ctx.fillText(world.gameOver === 'busted'
    ? 'The Solmara PD took you in. You lost 10% of your cash.'
    : 'Solmara General patched you up. You lost 10% of your cash.', w / 2, h * 0.4 + 44);
  ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#ffd23e';
  ctx.fillText('Press Enter to get back on the streets', w / 2, h * 0.62);
}

export function drawHelp(ctx, world, view) {
  const w = view.w;
  const h = view.h;
  ctx.fillStyle = 'rgba(5,8,14,0.85)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 34px "Segoe UI", Arial, sans-serif';
  ctx.fillText('HOW TO PLAY', w / 2, h * 0.18);
  ctx.font = '17px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#e8e8e8';
  const lines = [
    'You are Jax Moreno, a wheelman back in Solmara with a debt to pay.',
    '',
    '• Follow the yellow marker to your next job. Press M to take a new job when one is offered.',
    '• Press E near any car to get in — if someone is driving it, that counts as stealing.',
    '• Crime raises your wanted level. Police cars chase and ram you; officers arrest you up close.',
    '• Lay low and stay out of trouble for a while and the heat fades.',
    '• Buy a pistol at IRONWORKS, food at BURGER BAY, and armor at THREADS.',
    '• Taxi fares appear while you drive — pick passengers up for quick cash.',
    '• Your progress saves automatically after every job. Press Esc to pause and save.',
    '',
    'Press H or Esc to close.',
  ];
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h * 0.28 + i * 28));
}
