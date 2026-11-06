import { Game, PALETTE, RULES } from './game.js';
import { createNet, selfId } from './net.js';
import { unlockAudio, applyVolumes, groan } from './audio.js';
import { settings, saveSettings } from './settings.js';
import { POWERUPS, POWERUP_TYPES, RESPAWN_MS, iconCanvas, pickPowerupType } from './powerups.js';
import { MAZE_LABELS, TILE } from './maps.js';
import { ARENA_MAPS, PARKOUR_LEVELS } from './mapdefs.js';
import { WEAPONS, GUNGAME } from './weapons.js';
import { BotManager, BOT_SKILL, botName } from './bots.js';
import { initialSpawns } from './spawn.js';
import { SHOP, POINTS, applyPurchase, losePerks } from './shop.js';
import {
  START_WEAPON, GRENADES_PACK, BOX_SPIN_MS, BOX_TAKE_MS, createZombieWorld, describeUse, findTarget, pickWindow, tearPlank, repairPlank,
  repairAll, addWeapon, rollBox, isBossWave, waveSize, zombieStats, bossStats,
} from './zombieworld.js';
import { cleanCode, randomCode, fmtTime } from './util.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);
const MAX_PLAYERS = 8;
const hex = (c) => '#' + PALETTE[c % PALETTE.length].toString(16).padStart(6, '0');

const MODE_INFO = {
  maze: { name: 'Laberinto', sub: 'Encuentra la salida', online: true, bots: true },
  arena: { name: 'Arena', sub: 'Todos contra todos', online: true, bots: true },
  gungame: { name: 'Juego de armas', sub: 'Cada baja, arma nueva', online: true, bots: true },
  zombies: { name: 'Zombis', sub: 'Sobrevivid juntos', online: true, bots: false },
  parkour: { name: 'Parkour', sub: 'Carrera sobre lava', online: true, bots: false },
  training: { name: 'Entrenamiento', sub: 'Dispara a 5 blancos', online: false, bots: false },
};

// ---------- Records locales ----------

function loadRecords() { try { return JSON.parse(localStorage.getItem('pium-records') || '{}'); } catch { return {}; } }
function saveRecord(key, time) {
  const r = loadRecords();
  const best = r[key] == null || time < r[key];
  if (best) { r[key] = time; try { localStorage.setItem('pium-records', JSON.stringify(r)); } catch { /* sin storage */ } }
  return { best, prev: r[key] };
}

// ---------- HUD ----------

const iconURLs = Object.fromEntries(POWERUP_TYPES.map((t) => [t, iconCanvas(t).toDataURL()]));

const hud = {
  minimap: new Minimap($('minimap')),
  overlay: (show) => ($('overlay').hidden = !show),
  message(main, sub = '') { $('msg-main').textContent = main; $('msg-sub').textContent = sub; },
  dead: (on) => $('dead').classList.toggle('on', on),
  deadCountdown: (n) => ($('dead-count').textContent = n == null ? 'Espera a que te revivan o a que tu equipo supere la oleada' : Math.max(0, n)),
  paused: (on) => ($('pause').hidden = !on),
  hitmarker(hs) {
    const el = $('hitmarker');
    el.classList.toggle('hs', !!hs);
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  },
  hurt() {
    const el = $('hurt');
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  },
  health(hp, show, max = 100) {
    $('health').hidden = !show;
    const frac = Math.max(0, hp) / max;
    $('hp-bar').style.width = `${frac * 100}%`;
    $('hp-bar').style.background = frac > 0.6 ? '#3dff7a' : frac > 0.3 ? '#ffd23d' : '#ff3d5a';
    $('hp-num').textContent = Math.ceil(Math.max(0, hp));
  },
  scope: (on) => { $('scope').hidden = !on; $('crosshair').hidden = on; },
  weapons(list, current) {
    const el = $('weapons');
    el.hidden = !current;
    el.replaceChildren(...(list.length > 1 ? list : [current]).filter(Boolean).map((w, i) => {
      const d = document.createElement('div');
      d.className = w === current ? 'on' : '';
      d.textContent = (list.length > 1 ? `${i + 1} ` : '') + WEAPONS[w].name;
      return d;
    }));
  },
  timer(s) {
    $('timer').hidden = s == null;
    if (s != null) $('timer').textContent = fmtTime(s);
  },
  training(stats) {
    $('train').hidden = !stats;
    if (!stats) return;
    const acc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
    const best = loadRecords()['train-' + stats.weapon];
    $('train').textContent =
      `ENTRENAMIENTO · ${WEAPONS[stats.weapon]?.name ?? ''}\n` +
      `Precisión ${acc}% (${stats.hits}/${stats.shots}) · Blancos ${stats.kills}\n` +
      `Serie ${stats.series}/${stats.total} · ${stats.time.toFixed(1)} s` +
      (stats.last != null ? ` · última ${stats.last.toFixed(2)} s` : '') +
      (best != null ? `\nRécord con esta arma: ${best.toFixed(2)} s` : '') +
      `\n1-6 cambiar arma · R recargar · T reiniciar`;
  },
  trainingRecord(weapon, time) {
    const { best } = saveRecord('train-' + weapon, time);
    hud.toast(best ? `¡RÉCORD! ${time.toFixed(2)} s` : `Serie: ${time.toFixed(2)} s`, best ? '#ffd23d' : '#33e0ff');
  },
  perks(list) {
    $('perks').replaceChildren(...list.map((id) => {
      const d = document.createElement('span');
      d.textContent = SHOP[id]?.name ?? id;
      return d;
    }));
  },
  points(n) {
    $('points').hidden = n == null;
    if (n != null) $('points').textContent = `${n} pts`;
  },
  grenades(n) {
    $('grenades').hidden = n == null;
    if (n != null) $('grenades').textContent = `${n} granadas (G)`;
  },
  ammo(a) {
    const el = $('ammo');
    el.hidden = !a;
    if (!a) return;
    el.classList.toggle('low', a.mag === 0 && a.reserve === 0);
    const reloading = document.createElement('em');
    reloading.textContent = a.reloading ? 'RECARGANDO' : '';
    const reserve = document.createElement('small');
    reserve.textContent = `/ ${a.reserve}`;
    el.replaceChildren(reloading, String(a.mag), reserve);
  },
  prompt(p) {
    const el = $('prompt');
    el.hidden = !p;
    if (!p) return;
    el.classList.toggle('off', !!p.reason);
    el.textContent = p.reason ? `${p.text} (${p.reason})` : p.text;
  },
  boss(frac) {
    $('boss').hidden = frac == null;
    if (frac != null) $('boss-bar').style.width = `${Math.max(0, frac) * 100}%`;
  },
  wave(text) {
    $('wave').hidden = !text;
    $('wave').textContent = text || '';
  },
  toast(text, color) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.color = color;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 1500);
  },
  feed(parts) {
    const row = document.createElement('div');
    for (const [text, color] of parts) {
      const s = document.createElement('span');
      s.textContent = text;
      if (color != null) s.style.color = typeof color === 'string' ? color : hex(color);
      row.appendChild(s);
    }
    $('feed').prepend(row);
    while ($('feed').children.length > 5) $('feed').lastChild.remove();
    setTimeout(() => row.remove(), 6000);
  },
  powerups(list) {
    $('pu-bar').replaceChildren(...list.map(({ type, left, frac }) => {
      const d = document.createElement('div');
      d.className = 'pu';
      const img = document.createElement('img');
      img.src = iconURLs[type];
      const bar = document.createElement('i');
      bar.style.width = `${Math.max(0, frac) * 100}%`;
      bar.style.background = POWERUPS[type].color;
      const t = document.createElement('span');
      t.textContent = Math.ceil(left);
      d.append(img, t, bar);
      return d;
    }));
  },
};

function renderScore() {
  const el = $('score');
  if (role === 'solo' && config.mode === 'training') { el.replaceChildren(); return; }
  if (role === 'solo' && !config.bots && config.mode !== 'zombies') {
    const extra = config.mode === 'parkour' ? PARKOUR_LEVELS[config.level]?.name
      : config.mode === 'maze' ? 'Laberinto ' + MAZE_LABELS[config.diff] : MODE_INFO[config.mode].name;
    el.textContent = `PRÁCTICA · ${extra}`;
    return;
  }
  const m = config.mode;
  const sortKey = (p) => m === 'arena' || m === 'zombies' ? p.kills : m === 'gungame' ? p.level * 100 + p.kills : p.wins;
  const rows = Object.entries(roster).sort(([, a], [, b]) => sortKey(b) - sortKey(a));
  const head = document.createElement('div');
  head.className = 'score-head';
  head.textContent = {
    arena: `ARENA · ${ARENA_MAPS[config.mapId]?.name} · primero a ${config.goal}`,
    gungame: `JUEGO DE ARMAS · ${GUNGAME.length} armas`,
    zombies: `ZOMBIS · oleada ${waveInfo.n || 1}`,
    parkour: `PARKOUR · ${PARKOUR_LEVELS[config.level]?.name}`,
    maze: `LABERINTO ${MAZE_LABELS[config.diff]?.toUpperCase()} · victorias`,
  }[m] ?? '';
  const lines = rows.map(([id, p]) => {
    const d = document.createElement('div');
    const sw = document.createElement('b');
    sw.style.background = hex(p.color);
    const name = document.createElement('span');
    name.textContent = (p.name || '???') + (id === selfId ? ' (tú)' : '');
    const stats = document.createElement('em');
    stats.textContent =
      m === 'arena' ? `${p.kills} / ${p.deaths}` :
      m === 'gungame' ? `${Math.min(p.level + 1, GUNGAME.length)}/${GUNGAME.length} ${WEAPONS[GUNGAME[Math.min(p.level, GUNGAME.length - 1)]].name}` :
      m === 'zombies' ? `${p.kills} bajas · ${p.points} pts` :
      `${p.wins}`;
    d.append(sw, name, stats);
    return d;
  });
  el.replaceChildren(head, ...lines);
}

const game = new Game($('app'), hud);
game.selfId = selfId;
game.anyDead = () => anyHumanDown();

// ---------- Estado ----------

let net = null;
let role = null; // 'host' | 'guest' | 'solo'
let hostId = null;
let roomCode = null;
const peers = new Set();
const names = new Map();
let roster = {}; // id -> { name, color, kills, deaths, wins, level, bot } (autoridad: host)
let config = { mode: 'maze', diff: 'media', goal: 10, mapId: 'coliseo', level: 0, bots: 0, skill: 'normal' };
let currentSeed = null;
let roundOver = true;
let powerups = [];
let lastPuType = null;
let puSeq = 0;
const timers = [];
let joinTimeout = null;
let waveInfo = { n: 0 };
let choosingMode = false; // el host está eligiendo modo al acabar una ronda
let zw = null; // mundo zombi (autoridad: host): puertas, electricidad, tablas, caja

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
const myName = () => settings.name.trim().slice(0, 14) || 'Anónimo';
const isHostLike = () => role === 'host' || role === 'solo';
const nameOf = (id) => roster[id]?.name || names.get(id) || (String(id).startsWith('z-') ? 'Zombi' : '???');
const colorOf = (id) => (String(id).startsWith('z-') ? '#6fd13a' : roster[id]?.color ?? 0);
const send = (action, data, target) => net?.send[action](data, target);
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };


// ---------- Bots (solo el host) ----------

const bots = new BotManager({
  hitPlayer(targetId, dmg, byId, w) {
    if (targetId === selfId) game.takeDamage(dmg, byId, w);
    else send('hit', { r: currentSeed, dmg, w, by: byId }, targetId);
  },
  died(victimId, killerId, w) {
    announceKill(killerId, victimId, w);
    send('died', { r: currentSeed, by: killerId, v: victimId, w });
    hostDied(victimId, killerId, w);
  },
  shot(botId, from, ends, w) {
    game.remoteShot(botId, { a: from, e: ends, w });
    send('shot', { a: from, e: ends, w, id: botId });
  },
  reachedExit(botId) { hostEnd(botId); },
  planks: (id) => zw?.planks[id] ?? 0,
  tearPlank(id) {
    if (!zw) return;
    tearPlank(zw, id);
    syncZombieWorld();
  },
});

let hostTick = null;
let lastTick = 0;
let groanAt = 0;
function startHostLoop() {
  clearInterval(hostTick);
  lastTick = performance.now();
  hostTick = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (!game.active || roundOver || now < game.frozenUntil) return;
    bots.update(dt, now, game.humans(selfId));
    const states = bots.states(now);
    game.setEntities(states);
    send('ents', { r: currentSeed, b: states });
    if (config.mode === 'zombies') zombieTick(now);
    if (now > groanAt && bots.aliveZombies) { groanAt = now + 2500 + Math.random() * 3000; groan(0.5); }
  }, 66);
}

// ---------- Lobby ----------

function readLobby() {
  config = {
    mode: document.querySelector('input[name=mode]:checked').value,
    diff: $('sel-diff').value,
    goal: Number($('sel-goal').value),
    mapId: $('sel-map').value,
    level: Number($('sel-level').value),
    bots: Number($('sel-bots').value),
    skill: $('sel-skill').value,
  };
  settings.name = $('input-name').value || $('input-name-join').value;
  saveSettings();
}

function syncLobbyVisibility() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  const info = MODE_INFO[mode];
  $('opt-diff').hidden = mode !== 'maze';
  $('opt-goal').hidden = mode !== 'arena';
  $('opt-map').hidden = !['arena', 'gungame'].includes(mode);
  $('opt-level').hidden = mode !== 'parkour';
  $('opt-bots').hidden = !info.bots;
  $('opt-skill').hidden = !info.bots || $('sel-bots').value === '0';
  // Unirse no depende del modo seleccionado: es el host quien lo elige
  $('btn-create').hidden = !info.online || choosingMode;
  $('join-row').hidden = choosingMode;
  $('solo-row').hidden = choosingMode;
  $('btn-room-start').hidden = !choosingMode;
  $('btn-room-back').hidden = !choosingMode;
  $('btn-solo').textContent = mode === 'training' ? '¡A entrenar!' : info.bots && $('sel-bots').value !== '0' ? 'Jugar contra bots' : 'Practicar solo';
}

// Cambiar de modo al acabar una ronda, sin salir de la sala
function openModePicker() {
  if (!isHostLike() || !roundOver || !game.active || choosingMode) return;
  choosingMode = true;
  for (const label of $('modes').children) {
    const input = label.querySelector('input');
    const blocked = role === 'host' && !MODE_INFO[input.value].online;
    label.hidden = blocked;
    if (blocked && input.checked) document.querySelector('input[name=mode][value=maze]').checked = true;
  }
  syncLobbyVisibility();
  $('lobby').hidden = false;
  $('join-only').hidden = true;
  $('waiting').hidden = true;
  hud.overlay(true);
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeModePicker() {
  if (!choosingMode) return;
  choosingMode = false;
  for (const label of $('modes').children) label.hidden = false;
  syncLobbyVisibility();
  hud.overlay(false);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat && game.ended && game.active && isHostLike()) openModePicker();
});

function showLobby() {
  $('lobby').hidden = false;
  $('join-only').hidden = true;
  $('waiting').hidden = true;
  hud.overlay(true);
}

function showJoinOnly(code) {
  $('lobby').hidden = true;
  $('waiting').hidden = true;
  $('join-only').hidden = false;
  $('join-code-label').textContent = code;
  $('input-name-join').value = settings.name;
  hud.overlay(true);
}

function showWaiting(title, code) {
  $('lobby').hidden = true;
  $('join-only').hidden = true;
  $('waiting').hidden = false;
  $('wait-title').textContent = title;
  $('share').hidden = !code;
  $('btn-start').hidden = role !== 'host';
  if (code) {
    $('room-code').textContent = code;
    $('room-link').value = `${location.origin}${location.pathname}#${code}`;
    $('wait-mode').textContent = describeConfig();
  } else $('wait-mode').textContent = '';
  updateWaitingList();
  hud.overlay(true);
}

function describeConfig() {
  const c = config;
  const parts = [MODE_INFO[c.mode].name];
  if (c.mode === 'maze') parts.push(MAZE_LABELS[c.diff]);
  if (['arena', 'gungame'].includes(c.mode)) parts.push(ARENA_MAPS[c.mapId]?.name);
  if (c.mode === 'arena') parts.push(`a ${c.goal} bajas`);
  if (c.mode === 'parkour') parts.push(PARKOUR_LEVELS[c.level]?.name);
  if (MODE_INFO[c.mode].bots && c.bots) parts.push(`${c.bots} bots (${BOT_SKILL[c.skill].label})`);
  return parts.join(' · ');
}

function updateWaitingList() {
  const list = [myName() + ' (tú)', ...[...peers].map((id) => names.get(id) || 'conectando…')];
  $('wait-players').textContent = `Jugadores (${list.length}): ${list.join(', ')}`;
  const canStart = role === 'host' && (peers.size > 0 || config.bots > 0);
  $('btn-start').disabled = !canStart;
  $('btn-start').textContent = canStart ? '¡Empezar!' : 'Esperando a alguien…';
}

function leave() {
  net?.leave();
  net = null;
  peers.clear();
  clearInterval(hostTick);
  clearTimeout(joinTimeout);
  for (const id of [...game.avatars.keys()]) game.removePeer(id);
  bots.clear();
  role = null;
  hostId = null;
  roster = {};
  clearTimers();
  game.stop();
  hud.wave(null);
  $('score').replaceChildren();
  history.replaceState(null, '', location.pathname);
  showLobby();
}

// ---------- Host: rondas, marcador, power-ups, barriles ----------

function ensureRoster(id, extra = {}) {
  if (!roster[id]) {
    const used = new Set(Object.values(roster).map((p) => p.color));
    let color = 0;
    while (used.has(color)) color++;
    roster[id] = {
      name: id === selfId ? myName() : names.get(id) || '???', color,
      kills: 0, deaths: 0, wins: 0, level: 0, points: POINTS.start, perks: [], weapons: [START_WEAPON], ...extra,
    };
  }
  return roster[id];
}

function broadcastRoster() {
  send('sc', { roster });
  applyRoster();
}

function applyRoster() {
  for (const [id, p] of Object.entries(roster)) {
    if (id === selfId) game.setMyColor(p.color);
    else game.setPeerInfo(id, p);
  }
  if (config.mode === 'gungame' && roster[selfId]) {
    game.setForcedWeapon(GUNGAME[Math.min(roster[selfId].level, GUNGAME.length - 1)]);
  }
  hud.points(config.mode === 'zombies' && roster[selfId] ? roster[selfId].points : null);
  game.me = roster[selfId] ?? null;
  renderScore();
}

function startPayload(order) {
  const { mode, diff, goal, mapId, level } = config;
  return { r: currentSeed, mode, diff, goal, mapId, level, order, t: order.length === 1 && role === 'host' ? Math.round(game.elapsed) : 0 };
}

function hostStartRound() {
  closeModePicker();
  currentSeed = newSeed();
  roundOver = false;
  clearTimers();
  const order = [selfId, ...peers];
  ensureRoster(selfId).name = myName();
  for (const id of peers) ensureRoster(id);
  // bots fuera del roster si ya no se usan
  for (const id of Object.keys(roster)) if (roster[id].bot && !id.startsWith('bot-')) delete roster[id];
  for (const p of Object.values(roster)) {
    p.kills = 0; p.deaths = 0; p.level = 0; p.points = POINTS.start; p.perks = []; p.weapons = [START_WEAPON];
  }
  const payload = { ...startPayload(order), t: 0 };
  send('start', payload);
  game.startRound({
    seed: currentSeed, mode: config.mode, diff: config.diff, mapId: config.mapId, level: config.level,
    players: order.length + (MODE_INFO[config.mode].bots ? config.bots : 0), spawnIndex: 0, solo: role === 'solo',
  });

  // Bots
  const rules = RULES[config.mode];
  bots.reset(game.map, config.mode, { skill: config.skill, deathMs: rules.deathMs, invulnMs: rules.invulnMs });
  for (const id of Object.keys(roster)) if (roster[id].bot) delete roster[id];
  if (MODE_INFO[config.mode].bots && config.bots > 0) {
    const spawns = initialSpawns(game.map, order.length + config.bots);
    for (let i = 0; i < config.bots; i++) {
      const id = `bot-${i}`;
      const weapon = config.mode === 'gungame' ? GUNGAME[0] : undefined;
      bots.addBot(id, botName(i), spawns[order.length + i], weapon);
      ensureRoster(id, { name: botName(i), bot: true });
    }
  }
  waveInfo = { n: 0, toSpawn: 0, nextSpawn: 0, breakUntil: performance.now() + 3000, boss: false };
  zw = config.mode === 'zombies' ? createZombieWorld(game.map) : null;
  if (zw) syncZombieWorld();
  hud.wave(null);
  broadcastRoster();
  initPowerups();
  barrelsDead.clear();
  if (bots.bots.size || config.mode === 'zombies') startHostLoop();
  else clearInterval(hostTick);
}

function hostLateJoin(id) {
  ensureRoster(id);
  send('start', startPayload([selfId]), id);
  broadcastRoster();
  send('pus', { r: currentSeed, list: powerups }, id);
  send('brl', { r: currentSeed, dead: [...barrelsDead] }, id);
  if (config.mode === 'zombies') {
    send('wave', { r: currentSeed, n: waveInfo.n, text: waveText() }, id);
    send('zw', { r: currentSeed, zw }, id);
  }
}

function hostEnd(winnerId, extra = {}) {
  if (roundOver) return;
  roundOver = true;
  if (winnerId && roster[winnerId]) roster[winnerId].wins++;
  clearTimers();
  powerups = [];
  send('pus', { r: currentSeed, list: [] });
  game.setPowerups([]);
  send('end', { r: currentSeed, w: winnerId, ...extra });
  broadcastRoster();
  showEnd(winnerId, extra);
}

function hostDied(victimId, killerId, w, revivingSoon = false) {
  if (roundOver) return;
  const v = roster[victimId];
  if (v) {
    v.deaths++;
    if (config.mode === 'zombies' && !revivingSoon) losePerks(v);
  }
  const k = killerId && killerId !== victimId ? roster[killerId] : null;
  if (k) k.kills++;
  if (config.mode === 'zombies' && k && String(victimId).startsWith('z-')) {
    k.points += POINTS.kill;
    if (bots.bots.get(victimId)?.boss) hostBossDown(killerId);
  }
  // Juego de armas: un puñetazo "humilla": el que cae baja un nivel y el que golpea no sube
  if (config.mode === 'gungame' && k && w === 'punch') {
    if (v) {
      v.level = Math.max(0, v.level - 1);
      if (v.bot) bots.setWeapon(victimId, GUNGAME[v.level]);
    }
    hud.toast(`¡${nameOf(victimId)} HUMILLADO!`, '#ff3df2');
  } else if (config.mode === 'gungame' && k) {
    k.level++;
    if (k.level >= GUNGAME.length) { broadcastRoster(); hostEnd(killerId); return; }
    if (k.bot) bots.setWeapon(killerId, GUNGAME[k.level]);
  }
  broadcastRoster();
  if (config.mode === 'arena' && k && k.kills >= config.goal) hostEnd(killerId);
}

function announceKill(killerId, victimId, w) {
  const wname = w === 'barrel' ? 'Barril' : w === 'grenade' ? 'Granada' : w === 'zombie' ? 'Mordisco' : w === 'punch' ? 'Puñetazo' : WEAPONS[w]?.name ?? '';
  hud.feed([[nameOf(killerId), colorOf(killerId)], [` [${wname}] `], [nameOf(victimId), colorOf(victimId)]]);
}

// Power-ups (rotan: máx. 2 del mismo tipo)
function randomFreeCell() {
  const cells = game.map.cells;
  const taken = new Set(powerups.map((p) => `${p.x},${p.y}`));
  const players = [{ x: game.pos.x, z: game.pos.z }, ...[...game.avatars.values()].map((a) => ({ x: a.x, z: a.z }))];
  for (const s of game.map.spawns ?? []) players.push({ x: s.x * TILE, z: s.y * TILE });
  for (let i = 0; i < 40; i++) {
    const c = cells[Math.floor(Math.random() * cells.length)];
    const near = players.some((p) => Math.hypot(p.x - c.x * TILE, p.z - c.y * TILE) < TILE * 2);
    if (!taken.has(`${c.x},${c.y}`) && !near) return c;
  }
  return cells[Math.floor(Math.random() * cells.length)];
}

function spawnPowerup() {
  const type = pickPowerupType(config.mode, powerups, lastPuType);
  if (!type) return;
  lastPuType = type;
  const c = randomFreeCell();
  powerups.push({ id: ++puSeq, type, x: c.x, y: c.y });
}

function initPowerups() {
  powerups = [];
  if (config.mode === 'training' || config.mode === 'parkour') { syncPowerups(); return; }
  const n = config.mode === 'maze' ? { facil: 3, media: 5, dificil: 7 }[config.diff] : config.mode === 'zombies' ? 3 : 5;
  for (let i = 0; i < n; i++) spawnPowerup();
  syncPowerups();
}

function syncPowerups() {
  send('pus', { r: currentSeed, list: powerups });
  game.setPowerups(powerups);
}

function hostPick(puId, who) {
  const idx = powerups.findIndex((p) => p.id === puId);
  if (idx === -1 || roundOver) return;
  const [pu] = powerups.splice(idx, 1);
  if (who === selfId) game.applyPowerup(pu.type);
  else send('got', { r: currentSeed, type: pu.type }, who);
  syncPowerups();
  const seed = currentSeed;
  later(RESPAWN_MS, () => {
    if (seed !== currentSeed || roundOver) return;
    spawnPowerup();
    syncPowerups();
  });
}

// Barriles explosivos
const barrelsDead = new Set();

function hostBarrel(id, by) {
  if (barrelsDead.has(id) || roundOver) return;
  const b = game.map.barrels.find((x) => x.id === id);
  if (!b) return;
  barrelsDead.add(id);
  const boom = { r: currentSeed, id, x: b.x * TILE, y: 0.6, z: b.y * TILE, by };
  send('boom', boom);
  send('brl', { r: currentSeed, dead: [...barrelsDead] });
  game.setBarrels([...barrelsDead]);
  game.explode(boom);
  // daño a bots y zombis cercanos
  for (const bot of [...bots.bots.values()]) {
    const d = Math.hypot(bot.x - boom.x, bot.z - boom.z);
    if (d < 5) bots.damage(bot.id, Math.round(110 * (1 - d / 5) + 10), by, 'barrel');
  }
  // reacción en cadena
  for (const other of game.map.barrels) {
    if (!barrelsDead.has(other.id) && Math.hypot(other.x - b.x, other.y - b.y) * TILE < 4.5) later(180, () => hostBarrel(other.id, by));
  }
  const seed = currentSeed;
  later(20000, () => {
    if (seed !== currentSeed) return;
    barrelsDead.delete(id);
    send('brl', { r: currentSeed, dead: [...barrelsDead] });
    game.setBarrels([...barrelsDead]);
  });
}

function hostEntityHit(id, dmg, by, w) {
  if (String(id).startsWith('x-')) { hostBarrel(id, by); return; }
  const target = bots.bots.get(id);
  const counts = target && !target.dead && target.kind === 'zombie' && roster[by] && !roster[by].bot;
  bots.damage(id, dmg, by, w);
  if (counts) { roster[by].points += POINTS.hit; scheduleRosterSync(); }
}

// Los puntos cambian con cada impacto: agrupar los envíos del marcador (máx. ~4 por segundo)
let rosterSyncPending = false;
function scheduleRosterSync() {
  if (rosterSyncPending) return;
  rosterSyncPending = true;
  setTimeout(() => { rosterSyncPending = false; broadcastRoster(); }, 250);
}

// ---------- Mundo zombi: puertas, máquinas, caja, ventanas ----------

function anyHumanDown() {
  return game.humans(selfId).some((h) => !h.alive);
}

function hostRevive() {
  send('rev', { r: currentSeed });
  game.revive();
}

function syncZombieWorld() {
  send('zw', { r: currentSeed, zw });
  game.setZombieWorld(zw);
}

/** Efecto en el juego de un jugador: en el mío directamente, en el de otro por red. */
function tell(who, msg) {
  if (who === selfId) applyGot(msg);
  else send('got', { r: currentSeed, ...msg }, who);
}

function applyGot({ type, perk, fail, give, refill, nades }) {
  if (fail) hud.toast(fail, '#ff3d5a');
  else if (nades) game.addGrenades(nades);
  else if (give) game.giveWeapon(give);
  else if (refill) { game.refillAmmo(); hud.toast('¡MUNICIÓN LLENA!', '#3dff7a'); }
  else if (perk) game.applyPerk(perk);
  else game.applyPowerup(type);
}

function hostGive(who, weapon, cur) {
  const p = roster[who];
  p.weapons = addWeapon(p.weapons ?? [], weapon, cur);
  tell(who, { give: weapon });
}

/** El zombi rojo ha caído: premio para quien lo mata y munición llena para todos. */
function hostBossDown(killerId) {
  if (roster[killerId]) roster[killerId].points += POINTS.boss;
  hud.feed([[nameOf(killerId), colorOf(killerId)], [' ha matado al ZOMBI ROJO', '#ff3d3d']]);
  send('got', { r: currentSeed, refill: 1 });
  applyGot({ refill: 1 });
}

function hostOpenBox(who) {
  const owned = roster[who].weapons ?? [];
  zw.box = { state: 'spinning', who, weapon: rollBox(owned) };
  const seed = currentSeed;
  later(BOX_SPIN_MS, () => {
    if (seed !== currentSeed || zw?.box.state !== 'spinning') return;
    zw.box = { ...zw.box, state: 'ready' };
    syncZombieWorld();
    later(BOX_TAKE_MS, () => {
      if (seed !== currentSeed || zw?.box.state !== 'ready' || zw.box.who !== who) return;
      zw.box = { state: 'idle' };
      syncZombieWorld();
    });
  });
}

/** Un compañero ha levantado a otro manteniendo E: el caído sigue donde estaba. */
function hostReviveAlly(who, id) {
  const humans = game.humans(selfId);
  const rescuer = humans.find((h) => h.id === who);
  const downed = humans.find((h) => h.id === id);
  if (!rescuer?.alive || !downed || downed.alive) return;
  if (id === selfId) game.revive(true);
  else send('rev', { r: currentSeed, here: 1 }, id);
  roster[who].points += POINTS.revive;
  hud.feed([[nameOf(who), colorOf(who)], [' ha levantado a '], [nameOf(id), colorOf(id)]]);
  broadcastRoster();
}

/** Un jugador usa algo del mapa. El host valida con la misma lógica que le enseña el aviso. */
function hostUse(who, { kind, id, cur }) {
  if (roundOver || config.mode !== 'zombies' || !zw) return;
  const p = roster[who];
  if (kind === 'ally') { hostReviveAlly(who, id); return; }
  const target = findTarget(game.map, kind, id);
  if (!p || !target) return;
  const alive = !!game.humans(selfId).find((h) => h.id === who)?.alive;
  const info = describeUse(target, { zw, player: p, who, alive, anyDead: anyHumanDown() });
  if (!info) return;
  if (!alive) { tell(who, { fail: 'Estás caído' }); return; }
  if (!info.ok) { tell(who, { fail: info.reason ?? 'No disponible' }); return; }
  if (kind !== 'machine') p.points -= info.cost; // las máquinas descuentan en applyPurchase

  if (kind === 'door') {
    zw.doors = [...zw.doors, id];
    hud.feed([[nameOf(who), colorOf(who)], [' ha abierto una puerta']]);
  } else if (kind === 'power') {
    zw.power = true;
    hud.feed([[nameOf(who), colorOf(who)], [' ha dado la luz']]);
  } else if (kind === 'wall') {
    hostGive(who, target.weapon, cur);
  } else if (kind === 'ammo') {
    tell(who, { refill: 1 });
  } else if (kind === 'grenades') {
    tell(who, { nades: GRENADES_PACK });
  } else if (kind === 'carpenter') {
    repairAll(zw);
    hud.feed([[nameOf(who), colorOf(who)], [' ha llamado al carpintero']]);
  } else if (kind === 'window') {
    if (repairPlank(zw, id)) p.points += POINTS.repair;
  } else if (kind === 'box') {
    if (zw.box.state === 'ready') {
      hostGive(who, zw.box.weapon, cur);
      zw.box = { state: 'idle' };
    } else hostOpenBox(who);
  } else if (kind === 'machine') {
    applyPurchase(p, target.item);
    if (target.item === 'revive') {
      hostRevive();
      hud.feed([[nameOf(who), colorOf(who)], [' ha revivido al equipo']]);
    } else tell(who, { perk: target.item });
  }
  syncZombieWorld();
  broadcastRoster();
  if (kind === 'door') renderScore();
}

// Zombis: oleadas
let zSeq = 0;
function waveText() {
  if (!waveInfo.n) return 'Preparaos…';
  const left = waveInfo.toSpawn + bots.aliveZombies + (waveInfo.boss ? 1 : 0);
  return `OLEADA ${waveInfo.n}${isBossWave(waveInfo.n) ? ' · ¡ZOMBI ROJO!' : ''} · quedan ${left}`;
}

/** Saca un zombi por la ventana más adecuada. Devuelve false si ahora mismo no cabe. */
function spawnZombieAtWindow(stats, humans) {
  const players = humans.filter((h) => h.alive).map((h) => ({ x: h.x / TILE, y: h.z / TILE }));
  const win = pickWindow(game.map, bots.waitingAtWindows(), players);
  if (!win) return false;
  bots.addZombie(`z-${zSeq++}`, win, { ...stats, window: win });
  return true;
}

function zombieTick(now) {
  const humans = game.humans(selfId);
  if (humans.length && humans.every((h) => !h.alive)) {
    hostEnd(null, { zombies: waveInfo.n });
    return;
  }
  if (waveInfo.breakUntil) {
    if (now < waveInfo.breakUntil) return;
    // nueva oleada
    waveInfo.breakUntil = 0;
    waveInfo.n++;
    waveInfo.toSpawn = waveSize(waveInfo.n);
    waveInfo.boss = isBossWave(waveInfo.n);
    send('wave', { r: currentSeed, n: waveInfo.n, text: waveText(), revive: true });
    game.revive();
    hud.message(`OLEADA ${waveInfo.n}`, '');
    later(1500, () => { if (!game.ended) hud.message('', ''); });
    renderScore();
  }
  // El zombi rojo sale el primero de su oleada
  if (waveInfo.boss && spawnZombieAtWindow(bossStats(waveInfo.n), humans)) waveInfo.boss = false;
  if (waveInfo.toSpawn > 0 && now > waveInfo.nextSpawn && bots.aliveZombies < 25) {
    const n = waveInfo.n;
    if (spawnZombieAtWindow(zombieStats(n), humans)) {
      waveInfo.toSpawn--;
      waveInfo.nextSpawn = now + Math.max(250, 900 - n * 50);
    }
  }
  if (waveInfo.toSpawn === 0 && !waveInfo.boss && bots.aliveZombies === 0) {
    waveInfo.breakUntil = now + 6000;
    // bonus a los que siguen en pie
    for (const h of humans) if (h.alive && roster[h.id]) roster[h.id].points += POINTS.wave;
    broadcastRoster();
    hud.toast(`¡Oleada ${waveInfo.n} superada!`, '#3dff7a');
    send('wave', { r: currentSeed, n: waveInfo.n, text: `Oleada ${waveInfo.n} superada · siguiente en 6 s` });
    hud.wave(`Oleada ${waveInfo.n} superada · siguiente en 6 s`);
    return;
  }
  const text = waveText();
  if (text !== waveInfo.lastText) {
    waveInfo.lastText = text;
    hud.wave(text);
    send('wave', { r: currentSeed, n: waveInfo.n, text });
  }
}

// ---------- Eventos locales del juego ----------

function showEnd(winnerId, extra = {}) {
  const iWon = winnerId === selfId;
  const rematch = isHostLike() ? 'R otra ronda · M cambiar de modo' : 'Pulsa R para pedir otra ronda · el host puede cambiar de modo';
  let title;
  if (config.mode === 'zombies') {
    title = `Os han comido en la oleada ${extra.zombies ?? waveInfo.n}`;
  } else if (role === 'solo' && config.mode === 'parkour') {
    const t = extra.time ?? 0;
    const { best } = saveRecord(`parkour-${config.level}`, t);
    title = best ? `¡RÉCORD! ${fmtTime(t)}` : `Meta en ${fmtTime(t)} (récord ${fmtTime(loadRecords()[`parkour-${config.level}`])})`;
  } else if (role === 'solo' && config.mode === 'maze' && !config.bots) title = '¡HAS ESCAPADO!';
  else if (config.mode === 'arena' || config.mode === 'gungame') title = iWon ? '¡HAS GANADO!' : `Gana ${nameOf(winnerId)}`;
  else if (config.mode === 'parkour') {
    title = iWon ? `¡PRIMERO EN LA META! ${fmtTime(extra.time ?? 0)}` : `${nameOf(winnerId)} llega primero (${fmtTime(extra.time ?? 0)})`;
    if (iWon) saveRecord(`parkour-${config.level}`, extra.time ?? 0);
  } else title = iWon ? '¡HAS ESCAPADO!' : `${nameOf(winnerId)} ha escapado…`;
  game.endRound(title, rematch, iWon || (role === 'solo' && config.mode !== 'zombies'));
}

game.onReachExit = (time) => {
  if (role === 'solo' && !bots.bots.size) { roundOver = true; showEnd(selfId, { time }); }
  else if (isHostLike()) hostEnd(selfId, { time });
  else send('exit', { r: currentSeed, t: time }, hostId);
};

game.onDied = (killerId, w, revivingSoon) => {
  announceKill(killerId, selfId, w);
  send('died', { r: currentSeed, by: killerId, w, rv: revivingSoon ? 1 : 0 });
  if (isHostLike()) hostDied(selfId, killerId, w, revivingSoon);
  if (revivingSoon) hud.toast('¡SEGUNDA VIDA!', '#3dff7a');
};

game.onUse = (use) => {
  if (isHostLike()) hostUse(selfId, use);
  else send('use', { r: currentSeed, ...use }, hostId);
};

game.onPick = (puId) => {
  if (isHostLike()) hostPick(puId, selfId);
  else send('pick', { r: currentSeed, id: puId }, hostId);
};

game.onEntityHit = (id, dmg, w) => {
  if (isHostLike()) hostEntityHit(id, dmg, selfId, w);
  else send('ehit', { r: currentSeed, id, dmg, w }, hostId);
};

game.onRematch = () => {
  if (isHostLike()) hostStartRound();
  else { send('again', {}, hostId); hud.message('Otra ronda pedida…', 'Esperando al host'); }
};

// ---------- Red ----------

function connect(code) {
  roomCode = code;
  net = createNet(code, {
    peerJoin(id) {
      if (peers.size + 1 >= MAX_PLAYERS) return;
      peers.add(id);
      game.addPeer(id);
      send('hi', { name: myName() }, id);
      if (role === 'host' && !roundOver) hostLateJoin(id);
      updateWaitingList();
    },
    peerLeave(id) {
      peers.delete(id);
      game.removePeer(id);
      names.delete(id);
      if (id === hostId) {
        leave();
        showWaiting('El host se ha ido.', null);
        $('btn-cancel').textContent = 'Volver';
        return;
      }
      if (role === 'host') {
        delete roster[id];
        broadcastRoster();
        if (!roundOver && peers.size === 0 && !bots.bots.size) {
          roundOver = true;
          clearTimers();
          game.stop('Te has quedado solo', '');
          showWaiting('Todos se han ido. Esperando…', roomCode);
        }
      }
      updateWaitingList();
    },
    hi({ name }, from) {
      names.set(from, String(name).slice(0, 14));
      if (role === 'host' && roster[from]) { roster[from].name = names.get(from); broadcastRoster(); }
      updateWaitingList();
    },
    start(data, from) {
      if (role !== 'guest') return;
      clearTimeout(joinTimeout);
      hostId = from;
      config = { ...config, mode: data.mode, diff: data.diff, goal: data.goal, mapId: data.mapId, level: data.level };
      currentSeed = data.r;
      roundOver = false;
      waveInfo = { n: 0 };
      hud.wave(null);
      game.startRound({
        seed: data.r, mode: data.mode, diff: data.diff, mapId: data.mapId, level: data.level,
        players: data.order.length, spawnIndex: data.order.indexOf(selfId), elapsed: data.t || 0,
      });
      renderScore();
    },
    sc({ roster: r }, from) {
      if (from !== hostId) return;
      roster = r;
      applyRoster();
    },
    st: (data, from) => game.remoteState(from, data),
    shot: (data, from) => game.remoteShot(data.id ?? from, data),
    hit: (data, from) => game.gotHit(from, data),
    ents({ r, b }, from) { if (from === hostId && r === currentSeed) game.setEntities(b); },
    ehit({ r, id, dmg, w }, from) { if (role === 'host' && r === currentSeed) hostEntityHit(id, dmg, from, w); },
    boom(data, from) { if (from === hostId && data.r === currentSeed) game.explode(data); },
    brl({ r, dead }, from) { if (from === hostId && r === currentSeed) game.setBarrels(dead); },
    wave({ r, n, text, revive }, from) {
      if (from !== hostId || r !== currentSeed) return;
      waveInfo.n = n;
      hud.wave(text);
      if (revive) { game.revive(); hud.message(`OLEADA ${n}`, ''); setTimeout(() => { if (!game.ended) hud.message('', ''); }, 1500); }
      renderScore();
    },
    died({ r, by, v, w, rv }, from) {
      if (r !== currentSeed) return;
      const victim = v ?? from;
      if (victim !== selfId) announceKill(by, victim, w);
      if (role === 'host' && !v) hostDied(from, by, w, !!rv);
    },
    use({ r, kind, id, cur }, from) {
      if (role === 'host' && r === currentSeed) hostUse(from, { kind, id, cur });
    },
    zw({ r, zw: state }, from) {
      if (from === hostId && r === currentSeed) game.setZombieWorld(state);
    },
    rev({ r, here }, from) {
      if (from === hostId && r === currentSeed) game.revive(!!here);
    },
    gren: (data) => game.remoteGrenade(data),
    exit({ r, t }, from) {
      if (role === 'host' && r === currentSeed && (config.mode === 'maze' || config.mode === 'parkour')) hostEnd(from, { time: t });
    },
    end({ w, r, ...extra }, from) {
      if (role === 'guest' && from === hostId && r === currentSeed) { roundOver = true; showEnd(w, extra); }
    },
    again(_, from) {
      if (role === 'host' && roundOver && peers.has(from)) hostStartRound();
    },
    pus({ r, list }, from) {
      if (from === hostId && r === currentSeed) game.setPowerups(list);
    },
    pick({ r, id }, from) {
      if (role === 'host' && r === currentSeed) hostPick(id, from);
    },
    got({ r, ...msg }, from) {
      if (from !== hostId || r !== currentSeed) return;
      applyGot(msg);
    },
  });
  game.net = {
    st: (d) => net.send.st(d),
    shot: (d) => net.send.shot(d),
    hit: (d, target) => net.send.hit(d, target),
    gren: (d) => net.send.gren(d),
  };
}

// ---------- UI ----------

$('btn-create').onclick = () => {
  unlockAudio();
  readLobby();
  role = 'host';
  hostId = selfId;
  roster = {};
  ensureRoster(selfId);
  const code = randomCode();
  history.replaceState(null, '', `#${code}`);
  showWaiting('Esperando jugadores…', code);
  connect(code);
};

$('btn-start').onclick = () => {
  if (role === 'host' && (peers.size || config.bots)) hostStartRound();
};

function join(raw) {
  const code = cleanCode(raw);
  if (code.length < 4) { hud.toast('Código no válido', '#ff3d5a'); return; }
  unlockAudio();
  settings.name = ($('join-only').hidden ? $('input-name').value : $('input-name-join').value) || settings.name;
  saveSettings();
  role = 'guest';
  hostId = null;
  history.replaceState(null, '', `#${code}`);
  showWaiting(`Buscando la sala ${code}…`, null);
  connect(code);
  clearTimeout(joinTimeout);
  joinTimeout = setTimeout(() => {
    if (role === 'guest' && !hostId && !peers.size) {
      $('wait-title').textContent = `No encuentro la sala ${code}. ¿Está bien el código y sigue abierta? Sigo buscando…`;
    }
  }, 20000);
}

$('btn-join').onclick = () => join($('input-code').value);
// Ojo: un manejador on... que devuelve false cancela la tecla (no se podría escribir). Usa siempre llaves.
const onEnter = (id, fn) => { $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(); }); };
onEnter('input-code', () => join($('input-code').value));
$('btn-join-only').onclick = () => join($('join-code-label').textContent);
onEnter('input-name-join', () => join($('join-code-label').textContent));
$('btn-join-other').onclick = () => join($('input-code-other').value);
onEnter('input-code-other', () => join($('input-code-other').value));
$('btn-room-start').onclick = () => { readLobby(); hostStartRound(); };
$('btn-room-back').onclick = () => { closeModePicker(); game.lock(); };
$('btn-own-game').onclick = () => { history.replaceState(null, '', location.pathname); showLobby(); };

$('btn-solo').onclick = () => {
  unlockAudio();
  readLobby();
  role = 'solo';
  hostId = selfId;
  game.net = null;
  roster = {};
  ensureRoster(selfId);
  hostStartRound();
};

$('btn-copy').onclick = () => {
  navigator.clipboard?.writeText($('room-link').value);
  $('btn-copy').textContent = '¡Copiado!';
  setTimeout(() => ($('btn-copy').textContent = 'Copiar'), 1200);
};

$('btn-cancel').onclick = () => { $('btn-cancel').textContent = 'Cancelar'; leave(); };
$('btn-quit').onclick = (e) => { e.stopPropagation(); leave(); };
document.querySelectorAll('input[name=mode]').forEach((r) => (r.onchange = syncLobbyVisibility));
$('sel-bots').onchange = syncLobbyVisibility;

$('pause').onclick = (e) => { if (e.target === $('pause')) game.lock(); };

// ---------- Ajustes ----------

function openSettings(e) {
  e?.stopPropagation();
  $('set-sens').value = settings.sens;
  $('set-fov').value = settings.fov;
  $('set-music').value = settings.music;
  $('set-sfx').value = settings.sfx;
  updateSettingLabels();
  $('settings').hidden = false;
}
function updateSettingLabels() {
  $('val-sens').textContent = Number(settings.sens).toFixed(2) + 'x';
  $('val-fov').textContent = settings.fov + '°';
  $('val-music').textContent = Math.round(settings.music * 100) + '%';
  $('val-sfx').textContent = Math.round(settings.sfx * 100) + '%';
}
for (const key of ['sens', 'fov', 'music', 'sfx']) {
  $('set-' + key).oninput = (e) => {
    settings[key] = Number(e.target.value);
    updateSettingLabels();
    unlockAudio();
    applyVolumes();
    saveSettings();
  };
}
$('btn-settings').onclick = openSettings;
$('btn-settings-pause').onclick = openSettings;
$('btn-settings-close').onclick = () => ($('settings').hidden = true);

// ---------- Arranque ----------

// Selectores rellenados desde los datos (para que añadir un mapa o nivel no requiera tocar el HTML)
$('sel-map').replaceChildren(...Object.entries(ARENA_MAPS).map(([id, m]) => new Option(m.name, id, id === 'coliseo', id === 'coliseo')));
$('sel-level').replaceChildren(...PARKOUR_LEVELS.map((l, i) => new Option(l.name, i)));
$('sel-skill').replaceChildren(...Object.entries(BOT_SKILL).map(([id, s]) => new Option(s.label, id, id === 'normal', id === 'normal')));
$('modes').replaceChildren(...Object.entries(MODE_INFO).map(([id, m], i) => {
  const label = document.createElement('label');
  label.innerHTML = `<input type="radio" name="mode" value="${id}" ${i === 0 ? 'checked' : ''} /><span><b></b><small></small></span>`;
  label.querySelector('b').textContent = m.name;
  label.querySelector('small').textContent = m.sub;
  label.querySelector('input').onchange = syncLobbyVisibility;
  return label;
}));

// Avisar a los demás al cerrar la pestaña (si no, tardan ~10 s en enterarse)
window.addEventListener('pagehide', () => net?.leave());

$('input-name').value = settings.name;
syncLobbyVisibility();
const hashCode = cleanCode(location.hash);
if (hashCode.length >= 4) showJoinOnly(hashCode);
else showLobby();

if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: game, __selfId: selfId, __bots: bots, __roster: () => roster, __zw: () => zw, __wave: () => waveInfo,
    // Pasa directamente a la oleada n (para probar el zombi rojo)
    __startWave(n) {
      for (const b of [...bots.bots.values()]) if (b.kind === 'zombie') bots.remove(b.id);
      Object.assign(waveInfo, { n: n - 1, toSpawn: 0, boss: false, breakUntil: 1 });
    },
    __sync: () => { broadcastRoster(); },
  });
}
