// Mundo del modo Zombis: puertas, electricidad, ventanas, caja misteriosa y compras.
// Lógica pura (sin DOM ni Three.js). El host es la autoridad y reparte el estado `zw` a todos.
import { WEAPONS } from './weapons.js';
import { SHOP, canBuy } from './shop.js';

export const MAX_PLANKS = 5;
export const AMMO_COST = 1000;
export const CARPENTER_COST = 500;
export const GRENADES_COST = 500;
export const GRENADES_PACK = 2;
export const BOX_COST = 950;
export const BOX_SPIN_MS = 2600;
export const BOX_TAKE_MS = 9000;
export const MAX_WEAPONS = 2;
export const START_WEAPON = 'pistol';
export const BOSS_EVERY = 7;
export const MAX_AT_WINDOW = 2; // zombis esperando a la vez en una ventana

/** Armas de pared: precio del arma (la munición cuesta la mitad). */
export const WALL_PRICES = { pistol: 200, smg: 800, shotgun: 1000, rifle: 1200, laser: 2000, sniper: 2500 };

/** Caja misteriosa: cuanto más peso, más probable. */
export const BOX_WEIGHTS = { pistol: 3, smg: 5, shotgun: 5, rifle: 5, laser: 3, sniper: 3, raygun: 2 };

export function createZombieWorld(map) {
  const planks = {};
  for (const w of map.windows) planks[w.id] = MAX_PLANKS;
  return { doors: [], power: false, planks, box: { state: 'idle' } };
}

// ---------- Oleadas ----------

export const isBossWave = (n) => n > 0 && n % BOSS_EVERY === 0;

export function waveSize(n) { return 4 + n * 3; }

export function zombieStats(n) {
  return { hp: 50 + n * 12, speed: Math.min(5.8, 2.6 + n * 0.25), dmg: 15 + n * 2 };
}

/** El zombi rojo: mucha más vida y daño que cualquier zombi de su oleada. */
export function bossStats(n) {
  return { hp: 2500 + Math.max(0, n - BOSS_EVERY) * 400, speed: Math.min(5, 3.4 + n * 0.05), dmg: 40 + n, boss: true };
}

// ---------- Ventanas ----------

/**
 * Ventanas en uso: las que dan a una zona ya abierta. map.cells solo contiene las casillas
 * alcanzables con las puertas abiertas (ver applyDoors en maps.js).
 */
export function activeWindows(map) {
  const open = new Set(map.cells.map((c) => `${c.x},${c.y}`));
  return map.windows.filter((w) => open.has(`${w.in.x},${w.in.y}`));
}

/**
 * Elige por qué ventana entra el siguiente zombi: la menos ocupada y, a igualdad, la más cercana
 * a los jugadores. Devuelve null si todas están llenas (el spawn espera).
 * waiting: Map(windowId -> zombis esperando), players: [{x, z}] en casillas.
 */
export function pickWindow(map, waiting, players) {
  const dist = (w) => (players.length ? Math.min(...players.map((p) => Math.hypot(p.x - w.x, p.y - w.y))) : 0);
  const free = activeWindows(map)
    .map((w) => ({ w, n: waiting.get(w.id) ?? 0, d: dist(w) }))
    .filter((c) => c.n < MAX_AT_WINDOW)
    .sort((a, b) => a.n - b.n || a.d - b.d);
  return free[0]?.w ?? null;
}

export function tearPlank(zw, id) {
  zw.planks[id] = Math.max(0, (zw.planks[id] ?? 0) - 1);
  return zw.planks[id];
}

export function repairPlank(zw, id) {
  if ((zw.planks[id] ?? 0) >= MAX_PLANKS) return false;
  zw.planks[id]++;
  return true;
}

/** Devuelve cuántas ventanas ha arreglado. */
export function repairAll(zw) {
  let fixed = 0;
  for (const id of Object.keys(zw.planks)) {
    if (zw.planks[id] < MAX_PLANKS) { zw.planks[id] = MAX_PLANKS; fixed++; }
  }
  return fixed;
}

// ---------- Armas ----------

/**
 * Coge un arma con límite de 2: si ya estás lleno, sustituye a la que llevas en la mano.
 * Devuelve la lista nueva (sin mutar).
 */
export function addWeapon(owned, weapon, current) {
  if (owned.includes(weapon)) return [...owned];
  if (owned.length < MAX_WEAPONS) return [...owned, weapon];
  const out = [...owned];
  const i = out.indexOf(current);
  out[i === -1 ? out.length - 1 : i] = weapon;
  return out;
}

/** Arma al azar de la caja. Nunca te da una que ya llevas. */
export function rollBox(owned = [], rng = Math.random) {
  const pool = Object.entries(BOX_WEIGHTS).filter(([id]) => !owned.includes(id));
  let r = rng() * pool.reduce((sum, [, w]) => sum + w, 0);
  for (const [id, w] of pool) {
    r -= w;
    if (r < 0) return id;
  }
  return pool[pool.length - 1][0];
}

// ---------- Objetos con los que se interactúa ----------

export function findTarget(map, kind, id) {
  if (kind === 'door') return map.doors.find((d) => d.id === id) && { ...map.doors.find((d) => d.id === id), kind };
  if (kind === 'window') { const w = map.windows.find((x) => x.id === id); return w && { ...w, kind }; }
  if (kind === 'wall') { const w = map.wallBuys.find((x) => x.id === id); return w && { ...w, kind }; }
  return map.props.find((p) => p.kind === kind && p.id === id) ?? null;
}

/**
 * Qué pasa si `who` usa este objeto. Lo calculan igual el jugador (para el aviso en pantalla) y
 * el host (para validar). Devuelve null si no hay nada que hacer con él, o { text, cost, ok, reason }.
 * ctx: { zw, player: { points, perks, weapons }, who, alive, anyDead }
 */
export function describeUse(target, { zw, player, who, alive = true, anyDead = false }) {
  const points = player?.points ?? 0;
  const paid = (text, cost) => ({
    text, cost, ok: points >= cost, reason: points >= cost ? null : 'Faltan puntos',
  });
  switch (target.kind) {
    case 'door':
      return zw.doors.includes(target.id) ? null : paid('Abrir puerta', target.cost);
    case 'power':
      return zw.power ? null : { text: 'Activar la electricidad', cost: 0, ok: true, reason: null };
    case 'window': {
      if ((zw.planks[target.id] ?? MAX_PLANKS) >= MAX_PLANKS) return null;
      return { text: 'Mantén E para reparar la ventana', cost: 0, ok: true, reason: null };
    }
    case 'carpenter': {
      const broken = Object.values(zw.planks).some((n) => n < MAX_PLANKS);
      if (!broken) return { text: 'Carpintero: reparar todas las ventanas', cost: CARPENTER_COST, ok: false, reason: 'Nada que arreglar' };
      return paid('Carpintero: reparar todas las ventanas', CARPENTER_COST);
    }
    case 'ammo':
      return paid('Munición para todas tus armas', AMMO_COST);
    case 'grenades':
      return paid(`${GRENADES_PACK} granadas`, GRENADES_COST);
    case 'ally':
      return { text: `Mantén E para revivir a ${target.name || 'tu compañero'}`, cost: 0, ok: true, reason: null };
    case 'wall': {
      const w = WEAPONS[target.weapon];
      const price = WALL_PRICES[target.weapon];
      if ((player?.weapons ?? []).includes(target.weapon)) return paid(`Munición de ${w.name}`, Math.ceil(price / 2));
      return paid(`Comprar ${w.name}`, price);
    }
    case 'machine': {
      const item = SHOP[target.item];
      const check = canBuy(player, target.item, { alive, anyDead, power: zw.power });
      return { text: `${item.name}: ${item.desc}`, cost: item.cost, ok: check.ok, reason: check.reason ?? null };
    }
    case 'box': {
      const box = zw.box;
      if (box.state === 'spinning') return null;
      if (box.state === 'ready') {
        return box.who === who ? { text: `Coger ${WEAPONS[box.weapon].name}`, cost: 0, ok: true, reason: null } : null;
      }
      return paid('Caja misteriosa: un arma al azar', BOX_COST);
    }
    default:
      return null;
  }
}
