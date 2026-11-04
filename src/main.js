import { Game, PALETTE } from './game.js';
import { createNet, selfId } from './net.js';
import { unlockAudio, applyVolumes } from './audio.js';
import { settings, saveSettings } from './settings.js';
import { POWERUPS, POWERUP_TYPES, RESPAWN_MS, iconCanvas } from './powerups.js';
import { MAZE_LABELS, TILE } from './maps.js';

const $ = (id) => document.getElementById(id);
const MAX_PLAYERS = 8;

// ---------- HUD ----------

const iconURLs = Object.fromEntries(POWERUP_TYPES.map((t) => [t, iconCanvas(t).toDataURL()]));

const hud = {
  overlay: (show) => ($('overlay').hidden = !show),
  message(main, sub = '') { $('msg-main').textContent = main; $('msg-sub').textContent = sub; },
  dead: (on) => $('dead').classList.toggle('on', on),
  deadCountdown: (n) => ($('dead-count').textContent = Math.max(0, n)),
  paused: (on) => ($('pause').hidden = !on),
  hitmarker() {
    const el = $('hitmarker');
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
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
      if (color != null) s.style.color = '#' + PALETTE[color % PALETTE.length].toString(16).padStart(6, '0');
      row.appendChild(s);
    }
    $('feed').prepend(row);
    while ($('feed').children.length > 5) $('feed').lastChild.remove();
    setTimeout(() => row.remove(), 6000);
  },
  powerups(list) {
    const el = $('pu-bar');
    el.replaceChildren(...list.map(({ type, left, frac }) => {
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
  if (role === 'solo') { el.textContent = `PRÁCTICA · ${config.mode === 'arena' ? 'Arena' : 'Laberinto ' + MAZE_LABELS[config.diff]}`; return; }
  const rows = Object.entries(roster)
    .sort(([, a], [, b]) => (config.mode === 'arena' ? b.kills - a.kills : b.wins - a.wins) || b.kills - a.kills);
  const head = document.createElement('div');
  head.className = 'score-head';
  head.textContent = config.mode === 'arena'
    ? `ARENA · primero a ${config.goal} bajas`
    : `LABERINTO ${MAZE_LABELS[config.diff].toUpperCase()} · victorias`;
  const lines = rows.map(([id, p]) => {
    const d = document.createElement('div');
    const sw = document.createElement('b');
    sw.style.background = '#' + PALETTE[p.color % PALETTE.length].toString(16).padStart(6, '0');
    const name = document.createElement('span');
    name.textContent = (p.name || '???') + (id === selfId ? ' (tú)' : '');
    const stats = document.createElement('em');
    stats.textContent = config.mode === 'arena' ? `${p.kills} / ${p.deaths}` : `${p.wins} · ${p.kills}K`;
    d.append(sw, name, stats);
    return d;
  });
  el.replaceChildren(head, ...lines);
}

const game = new Game($('app'), hud);

// ---------- Estado ----------

let net = null;
let role = null; // 'host' | 'guest' | 'solo'
let hostId = null;
let roomCode = null;
const peers = new Set();
const names = new Map();
let roster = {}; // id -> { name, color, kills, deaths, wins } (autoridad: host)
let config = { mode: 'maze', diff: 'media', goal: 10 };
let currentSeed = null;
let roundOver = true;
let powerups = []; // solo host: [{ id, type, x, y }]
let puSeq = 0;
const puTimers = [];

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
const randomCode = () =>
  Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const myName = () => settings.name.trim().slice(0, 14) || 'Anónimo';
const isHostLike = () => role === 'host' || role === 'solo';
const nameOf = (id) => roster[id]?.name || names.get(id) || '???';
const colorOf = (id) => roster[id]?.color ?? 0;
const send = (action, data, target) => net?.send[action](data, target);

// ---------- Lobby ----------

function readLobby() {
  config = {
    mode: document.querySelector('input[name=mode]:checked').value,
    diff: $('sel-diff').value,
    goal: Number($('sel-goal').value),
  };
  settings.name = $('input-name').value;
  saveSettings();
}

function syncLobbyVisibility() {
  const arena = document.querySelector('input[name=mode]:checked').value === 'arena';
  $('opt-diff').hidden = arena;
  $('opt-goal').hidden = !arena;
}

function showLobby() {
  $('lobby').hidden = false;
  $('waiting').hidden = true;
  hud.overlay(true);
}

function showWaiting(title, code) {
  $('lobby').hidden = true;
  $('waiting').hidden = false;
  $('wait-title').textContent = title;
  $('share').hidden = !code;
  $('btn-start').hidden = role !== 'host';
  if (code) {
    $('room-code').textContent = code;
    $('room-link').value = `${location.origin}${location.pathname}#${code}`;
  }
  updateWaitingList();
  hud.overlay(true);
}

function updateWaitingList() {
  const list = [myName() + ' (tú)', ...[...peers].map((id) => names.get(id) || 'conectando…')];
  $('wait-players').textContent = `Jugadores (${list.length}): ${list.join(', ')}`;
  $('btn-start').disabled = role === 'host' && peers.size === 0;
  $('btn-start').textContent = peers.size ? '¡Empezar!' : 'Esperando a alguien…';
}

function leave() {
  net?.leave();
  net = null;
  peers.clear();
  for (const id of [...game.avatars.keys()]) game.removePeer(id);
  role = null;
  hostId = null;
  roster = {};
  clearPuTimers();
  game.stop();
  $('score').replaceChildren();
  history.replaceState(null, '', location.pathname);
  showLobby();
}

// ---------- Host: rondas, marcador, power-ups ----------

function ensureRoster(id) {
  if (!roster[id]) {
    const used = new Set(Object.values(roster).map((p) => p.color));
    let color = 0;
    while (used.has(color)) color++;
    roster[id] = { name: id === selfId ? myName() : names.get(id) || '???', color, kills: 0, deaths: 0, wins: 0 };
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
  renderScore();
}

function startPayload(spawnOrder) {
  return { r: currentSeed, mode: config.mode, diff: config.diff, goal: config.goal, order: spawnOrder };
}

function hostStartRound() {
  currentSeed = newSeed();
  roundOver = false;
  const order = [selfId, ...peers];
  ensureRoster(selfId).name = myName();
  for (const id of peers) ensureRoster(id);
  for (const p of Object.values(roster)) { p.kills = 0; p.deaths = 0; }
  send('start', startPayload(order));
  game.startRound({
    seed: currentSeed, mode: config.mode, diff: config.diff,
    players: order.length, spawnIndex: 0, solo: role === 'solo',
  });
  broadcastRoster();
  initPowerups();
}

function hostLateJoin(id) {
  // Alguien entra con la ronda empezada: le metemos directamente (reaparece en sitio aleatorio)
  ensureRoster(id);
  send('start', startPayload([selfId]), id);
  broadcastRoster();
  send('pus', { r: currentSeed, list: powerups }, id);
}

function hostEnd(winnerId) {
  if (roundOver) return;
  roundOver = true;
  ensureRoster(winnerId).wins++;
  clearPuTimers();
  powerups = [];
  send('pus', { r: currentSeed, list: [] });
  game.setPowerups([]);
  send('end', { r: currentSeed, w: winnerId });
  broadcastRoster();
  showEnd(winnerId);
}

function hostDied(victimId, killerId) {
  if (roundOver) return;
  ensureRoster(victimId).deaths++;
  if (killerId && roster[killerId]) roster[killerId].kills++;
  broadcastRoster();
  if (config.mode === 'arena' && killerId && roster[killerId]?.kills >= config.goal) hostEnd(killerId);
}

function randomFreeCell() {
  const cells = game.map.cells;
  const taken = new Set(powerups.map((p) => `${p.x},${p.y}`));
  const players = [{ x: game.pos.x, z: game.pos.z }, ...[...game.avatars.values()].map((a) => ({ x: a.x, z: a.z }))];
  for (const s of game.map.spawns ?? []) players.push({ x: s.x * TILE, z: s.y * TILE }); // spawns de la arena
  for (let i = 0; i < 40; i++) {
    const c = cells[Math.floor(Math.random() * cells.length)];
    const near = players.some((p) => Math.hypot(p.x - c.x * TILE, p.z - c.y * TILE) < TILE * 2);
    if (!taken.has(`${c.x},${c.y}`) && !near) return c;
  }
  return cells[0];
}

function spawnPowerup() {
  const c = randomFreeCell();
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  powerups.push({ id: ++puSeq, type, x: c.x, y: c.y });
}

function clearPuTimers() {
  while (puTimers.length) clearTimeout(puTimers.pop());
}

function initPowerups() {
  clearPuTimers();
  powerups = [];
  const n = config.mode === 'arena' ? 4 : { facil: 3, media: 5, dificil: 7 }[config.diff];
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
  puTimers.push(setTimeout(() => {
    if (seed !== currentSeed || roundOver) return;
    spawnPowerup();
    syncPowerups();
  }, RESPAWN_MS));
}

// ---------- Eventos locales del juego ----------

function showEnd(winnerId) {
  const iWon = winnerId === selfId;
  const rematch = isHostLike() ? 'Pulsa R para otra ronda' : 'Pulsa R para pedir otra ronda';
  let title;
  if (role === 'solo') title = '¡HAS ESCAPADO!';
  else if (config.mode === 'arena') title = iWon ? '¡HAS GANADO LA ARENA!' : `Gana ${nameOf(winnerId)}`;
  else title = iWon ? '¡HAS ESCAPADO!' : `${nameOf(winnerId)} ha escapado…`;
  game.endRound(title, rematch, iWon);
}

game.onReachExit = () => {
  if (role === 'solo') { roundOver = true; showEnd(selfId); }
  else if (role === 'host') hostEnd(selfId);
  else send('exit', { r: currentSeed }, hostId);
};

game.onDied = (killerId) => {
  hud.feed([[nameOf(killerId), colorOf(killerId)], [' 🔫 '], [nameOf(selfId), colorOf(selfId)]]);
  send('died', { r: currentSeed, by: killerId });
  if (role === 'host') hostDied(selfId, killerId);
};

game.onPick = (puId) => {
  if (isHostLike()) hostPick(puId, selfId);
  else send('pick', { r: currentSeed, id: puId }, hostId);
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
        if (!roundOver && peers.size === 0) {
          roundOver = true;
          clearPuTimers();
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
      hostId = from;
      config = { mode: data.mode, diff: data.diff, goal: data.goal };
      currentSeed = data.r;
      roundOver = false;
      game.startRound({
        seed: data.r, mode: data.mode, diff: data.diff,
        players: data.order.length, spawnIndex: data.order.indexOf(selfId),
      });
      renderScore();
    },
    sc({ roster: r }, from) {
      if (from !== hostId) return;
      roster = r;
      applyRoster();
    },
    st: (data, from) => game.remoteState(from, data),
    shot: (data, from) => game.remoteShot(from, data),
    hit: (data, from) => game.gotHit(from, data),
    died({ r, by }, from) {
      if (r !== currentSeed) return;
      hud.feed([[nameOf(by), colorOf(by)], [' 🔫 '], [nameOf(from), colorOf(from)]]);
      if (role === 'host') hostDied(from, by);
    },
    exit({ r }, from) {
      if (role === 'host' && r === currentSeed && config.mode === 'maze') hostEnd(from);
    },
    end({ w, r }, from) {
      if (role === 'guest' && from === hostId && r === currentSeed) { roundOver = true; showEnd(w); }
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
    got({ r, type }, from) {
      if (from === hostId && r === currentSeed) game.applyPowerup(type);
    },
  });
  game.net = {
    st: (d) => net.send.st(d),
    shot: (d) => net.send.shot(d),
    hit: (d, target) => net.send.hit(d, target),
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
  if (role === 'host' && peers.size) hostStartRound();
};

function join(code) {
  code = code.trim().toUpperCase();
  if (!code) return;
  unlockAudio();
  readLobby();
  role = 'guest';
  hostId = null;
  history.replaceState(null, '', `#${code}`);
  showWaiting(`Buscando la sala ${code}… (el host elige el modo)`, null);
  connect(code);
}

$('btn-join').onclick = () => join($('input-code').value);
$('input-code').onkeydown = (e) => e.key === 'Enter' && join($('input-code').value);

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

// Pausa: clic en el fondo vuelve al juego
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

// Avisar a los demás al cerrar la pestaña (si no, tardan ~10 s en enterarse)
window.addEventListener('pagehide', () => net?.leave());

$('input-name').value = settings.name;
const hashCode = location.hash.slice(1);
if (hashCode) {
  $('input-code').value = hashCode;
  $('btn-join').focus();
}
syncLobbyVisibility();
showLobby();

if (import.meta.env.DEV) Object.assign(window, { __game: game, __selfId: selfId }); // depuración desde la consola
