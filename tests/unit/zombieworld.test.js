import { describe, it, expect, vi } from 'vitest';
import { buildZombies, applyDoors, TILE, WALL } from '../../src/maps.js';
import { BotManager } from '../../src/bots.js';
import { SHOP, POINTS } from '../../src/shop.js';
import { WEAPONS } from '../../src/weapons.js';
import { MODE_POWERUPS } from '../../src/powerups.js';
import {
  MAX_PLANKS, MAX_AT_WINDOW, WALL_PRICES, BOX_COST, CARPENTER_COST, createZombieWorld, activeWindows, pickWindow, tearPlank,
  repairPlank, repairAll, addWeapon, rollBox, describeUse, findTarget, isBossWave, zombieStats, bossStats,
} from '../../src/zombieworld.js';

const openAll = (map) => applyDoors(map, map.doors.map((d) => d.id));
const player = (points, extra = {}) => ({ points, perks: [], weapons: ['pistol'], ...extra });
const prop = (map, kind) => map.props.find((p) => p.kind === kind);
const machine = (map, item) => map.props.find((p) => p.item === item);
const wall = (map, weapon) => ({ ...map.wallBuys.find((b) => b.weapon === weapon), kind: 'wall' });

describe('mapa de zombis', () => {
  const map = buildZombies(1);

  it('es mucho más grande que las arenas (15x15)', () => {
    expect(map.W).toBeGreaterThanOrEqual(30);
    expect(map.H).toBeGreaterThanOrEqual(25);
  });

  it('no hay plataformas: todo es suelo o pared, los zombis llegan a cualquier sitio', () => {
    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
      expect([0, WALL]).toContain(map.height(x, y));
    }
  });

  it('al empezar solo está accesible la sala inicial', () => {
    const m = buildZombies(1);
    const start = m.cells.length;
    expect(start).toBeGreaterThan(40);
    openAll(m);
    expect(m.cells.length).toBeGreaterThan(start * 5);
  });

  it('con todas las puertas abiertas se llega a todo el suelo', () => {
    const m = buildZombies(1);
    openAll(m);
    const reached = new Set(m.cells.map((c) => `${c.x},${c.y}`));
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      if (m.height(x, y) !== 0 || m.navBlocked.has(y * m.W + x) || m.barrelTiles.has(y * m.W + x)) continue;
      expect(reached.has(`${x},${y}`), `${x},${y}`).toBe(true);
    }
  });

  it('cada puerta abierta da paso a más mapa', () => {
    const m = buildZombies(1);
    const opened = [];
    let last = m.cells.length;
    for (const id of ['1', '2', '3', '4', '5', '6']) {
      opened.push(id);
      applyDoors(m, opened);
      expect(m.cells.length, `puerta ${id}`).toBeGreaterThan(last);
      last = m.cells.length;
    }
  });

  it('hay carpintero y armas en la sala inicial; la electricidad queda lejos', () => {
    const start = new Set(map.cells.map((c) => `${c.x},${c.y}`));
    const nextToStart = (o) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => start.has(`${o.x + dx},${o.y + dy}`));
    expect(nextToStart(prop(map, 'carpenter'))).toBe(true);
    expect(nextToStart(wall(map, 'pistol'))).toBe(true);
    expect(nextToStart(wall(map, 'smg'))).toBe(true);
    expect(nextToStart(prop(map, 'power'))).toBe(false);
    expect(nextToStart(prop(map, 'box'))).toBe(false);
  });

  it('cada mejora tiene su máquina y cada arma de pared su precio', () => {
    for (const item of Object.keys(SHOP)) expect(machine(map, item), item).toBeTruthy();
    expect(map.wallBuys.length).toBeGreaterThanOrEqual(6);
    for (const b of map.wallBuys) expect(WALL_PRICES[b.weapon], b.weapon).toBeGreaterThan(0);
    expect(wall(map, 'sniper').weapon).toBe('sniper');
    expect(WALL_PRICES.sniper).toBeGreaterThan(WALL_PRICES.smg);
  });

  it('hay ventanas y puertas de servicio, todas dan a suelo, y varias en la sala inicial', () => {
    expect(map.windows.some((w) => w.tall)).toBe(true);
    expect(map.windows.some((w) => !w.tall)).toBe(true);
    for (const w of map.windows) expect(map.height(w.in.x, w.in.y)).toBe(0);
    expect(activeWindows(map).length).toBeGreaterThanOrEqual(2);
  });

  it('abrir puertas activa más ventanas', () => {
    const m = buildZombies(1);
    const before = activeWindows(m).length;
    applyDoors(m, ['2']);
    expect(activeWindows(m).length).toBeGreaterThan(before);
  });
});

describe('qué se puede usar y cuánto cuesta', () => {
  const map = buildZombies(1);

  it('puerta: cuesta puntos y deja de ofrecerse al abrirla', () => {
    const zw = createZombieWorld(map);
    const door = findTarget(map, 'door', '1');
    expect(describeUse(door, { zw, player: player(100) })).toMatchObject({ ok: false, reason: 'Faltan puntos' });
    expect(describeUse(door, { zw, player: player(door.cost) }).ok).toBe(true);
    zw.doors.push('1');
    expect(describeUse(door, { zw, player: player(9999) })).toBeNull();
  });

  it('electricidad: gratis y una sola vez', () => {
    const zw = createZombieWorld(map);
    const power = prop(map, 'power');
    expect(describeUse(power, { zw, player: player(0) })).toMatchObject({ ok: true, cost: 0 });
    zw.power = true;
    expect(describeUse(power, { zw, player: player(0) })).toBeNull();
  });

  it('las máquinas no funcionan sin electricidad', () => {
    const zw = createZombieWorld(map);
    const armor = machine(map, 'armor');
    expect(describeUse(armor, { zw, player: player(9999) })).toMatchObject({ ok: false, reason: 'Sin electricidad' });
    zw.power = true;
    expect(describeUse(armor, { zw, player: player(9999) }).ok).toBe(true);
    expect(describeUse(armor, { zw, player: player(9999, { perks: ['armor'] }) }).reason).toBe('Ya lo tienes');
    expect(describeUse(armor, { zw, player: player(1) }).reason).toBe('Faltan puntos');
  });

  it('arma de pared: comprarla o, si la tienes, munición a mitad de precio', () => {
    const zw = createZombieWorld(map);
    const smg = wall(map, 'smg');
    expect(describeUse(smg, { zw, player: player(5000) })).toMatchObject({ cost: WALL_PRICES.smg, ok: true });
    expect(describeUse(smg, { zw, player: player(5000, { weapons: ['smg'] }) }).cost).toBe(WALL_PRICES.smg / 2);
  });

  it('carpintero: solo si hay algo roto', () => {
    const zw = createZombieWorld(map);
    const c = prop(map, 'carpenter');
    expect(describeUse(c, { zw, player: player(9999) })).toMatchObject({ ok: false, reason: 'Nada que arreglar' });
    tearPlank(zw, map.windows[0].id);
    expect(describeUse(c, { zw, player: player(CARPENTER_COST) }).ok).toBe(true);
    expect(repairAll(zw)).toBe(1);
    expect(zw.planks[map.windows[0].id]).toBe(MAX_PLANKS);
  });

  it('ventana: solo se repara si le faltan tablas', () => {
    const zw = createZombieWorld(map);
    const w = findTarget(map, 'window', map.windows[0].id);
    expect(describeUse(w, { zw, player: player(0) })).toBeNull();
    expect(repairPlank(zw, w.id)).toBe(false);
    tearPlank(zw, w.id);
    expect(describeUse(w, { zw, player: player(0) }).ok).toBe(true);
    expect(repairPlank(zw, w.id)).toBe(true);
  });

  it('caja: se paga, gira y solo la recoge quien la abrió', () => {
    const zw = createZombieWorld(map);
    const box = prop(map, 'box');
    expect(describeUse(box, { zw, player: player(BOX_COST) }).cost).toBe(BOX_COST);
    zw.box = { state: 'spinning', who: 'a', weapon: 'raygun' };
    expect(describeUse(box, { zw, player: player(9999), who: 'a' })).toBeNull();
    zw.box = { state: 'ready', who: 'a', weapon: 'raygun' };
    expect(describeUse(box, { zw, player: player(0), who: 'a' })).toMatchObject({ ok: true, cost: 0 });
    expect(describeUse(box, { zw, player: player(9999), who: 'b' })).toBeNull();
  });
});

describe('armas de zombis', () => {
  it('llevas 2 como máximo: la tercera sustituye a la de la mano', () => {
    expect(addWeapon(['pistol'], 'smg', 'pistol')).toEqual(['pistol', 'smg']);
    expect(addWeapon(['pistol', 'smg'], 'rifle', 'pistol')).toEqual(['rifle', 'smg']);
    expect(addWeapon(['pistol', 'smg'], 'smg', 'pistol')).toEqual(['pistol', 'smg']);
  });

  it('la caja puede dar cualquier arma, incluida la pistola de rayos, y nunca una que ya llevas', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(rollBox(['pistol']));
    expect(seen).toContain('raygun');
    expect(seen).toContain('sniper');
    expect(seen).toContain('smg');
    expect(seen).not.toContain('pistol');
    for (const id of seen) expect(WEAPONS[id], id).toBeTruthy();
  });

  it('los power-ups del suelo son momentáneos y no regalan armas', () => {
    expect(MODE_POWERUPS.zombies.length).toBeGreaterThan(0);
    expect(MODE_POWERUPS.zombies).not.toContain('sniper');
  });
});

describe('zombi rojo', () => {
  it('sale cada 7 oleadas', () => {
    expect([1, 6, 8].map(isBossWave)).toEqual([false, false, false]);
    expect([7, 14].map(isBossWave)).toEqual([true, true]);
  });

  it('mucho más fuerte que un zombi de su oleada', () => {
    const z = zombieStats(7), b = bossStats(7);
    expect(b.hp).toBeGreaterThan(z.hp * 10);
    expect(b.dmg).toBeGreaterThan(z.dmg);
    expect(POINTS.boss).toBeGreaterThan(POINTS.kill);
  });
});

describe('zombis entrando por las ventanas', () => {
  function setup(planks = MAX_PLANKS) {
    const map = buildZombies(1);
    const zw = createZombieWorld(map);
    for (const id of Object.keys(zw.planks)) zw.planks[id] = planks;
    const hooks = {
      hitPlayer: vi.fn(), died: vi.fn(), shot: vi.fn(), reachedExit: vi.fn(),
      planks: (id) => zw.planks[id], tearPlank: vi.fn((id) => tearPlank(zw, id)),
    };
    const bots = new BotManager(hooks);
    bots.reset(map, 'zombies', { deathMs: Infinity, invulnMs: 0 });
    const win = activeWindows(map)[0];
    const human = { id: 'h', x: map.spawns[0].x * TILE, y: 0, z: map.spawns[0].y * TILE, alive: true, inv: false };
    return { map, zw, hooks, bots, win, human };
  }
  const run = (bots, humans, seconds) => {
    let now = 0;
    for (let i = 0; i < seconds / 0.066; i++) { now += 66; bots.update(0.066, now, humans); }
  };

  it('primero rompen las tablas, luego entran y muerden', () => {
    const { bots, hooks, win, human, zw } = setup();
    const z = bots.addZombie('z-0', win, { hp: 60, speed: 4, dmg: 20, window: win });
    run(bots, [human], 2.5);
    expect(z.win).toBe(win); // sigue en la ventana
    expect(z.x).toBe(win.x * TILE);
    expect(hooks.hitPlayer).not.toHaveBeenCalled();
    run(bots, [human], 30);
    expect(zw.planks[win.id]).toBe(0);
    expect(z.win).toBeNull();
    expect(hooks.hitPlayer).toHaveBeenCalledWith('h', 20, 'z-0', 'zombie');
  });

  it('el zombi rojo arranca las tablas mucho más rápido', () => {
    const { bots, win, human, zw } = setup();
    bots.addZombie('z-0', win, { ...bossStats(7), window: win });
    run(bots, [human], 1.6);
    expect(zw.planks[win.id]).toBe(0);
  });

  it('no cruzan una puerta cerrada, sí una abierta', () => {
    const { map, bots, hooks } = setup(0);
    const far = map.windows.find((w) => w.y === 0); // al otro extremo del mapa
    const inside = { id: 'h', x: far.in.x * TILE, y: 0, z: far.in.y * TILE, alive: true, inv: false };
    const start = map.spawns[0];
    const z = bots.addZombie('z-0', start, { hp: 60, speed: 5, dmg: 20 });
    run(bots, [inside], 15);
    expect(hooks.hitPlayer).not.toHaveBeenCalled();
    expect(Math.round(z.z / TILE)).toBeGreaterThan(18); // no ha salido de la sala inicial
    openAll(map);
    run(bots, [inside], 40);
    expect(hooks.hitPlayer).toHaveBeenCalled();
  });

  it('nunca pisan paredes, puertas cerradas ni objetos', () => {
    const { map, bots, win, human } = setup(0);
    for (let i = 0; i < 4; i++) bots.addZombie(`z-${i}`, win, { hp: 60, speed: 5, dmg: 1, window: win });
    const list = [...bots.bots.values()];
    let now = 0;
    for (let i = 0; i < 500; i++) {
      now += 66;
      bots.update(0.066, now, [human]);
      for (const z of list) {
        if (z.win) continue;
        const t = Math.round(z.z / TILE) * map.W + Math.round(z.x / TILE);
        expect(map.navBlocked.has(t)).toBe(false);
        expect(map.height(Math.round(z.x / TILE), Math.round(z.z / TILE))).toBe(0);
      }
    }
  });

  it('el reparto de ventanas evita amontonar zombis', () => {
    const { map } = setup();
    const active = activeWindows(map);
    const near = { x: active[0].x, y: active[0].y };
    expect(pickWindow(map, new Map(), [near])).toBe(active[0]);
    const busy = new Map([[active[0].id, 1]]);
    expect(pickWindow(map, busy, [near])).not.toBe(active[0]);
    const full = new Map(active.map((w) => [w.id, MAX_AT_WINDOW]));
    expect(pickWindow(map, full, [near])).toBeNull();
  });

  it('el estado de red lleva la vida de cada zombi y marca al rojo', () => {
    const { bots, win } = setup();
    bots.addZombie('z-0', win, { hp: 60, speed: 4, dmg: 20, window: win });
    bots.addZombie('z-1', win, { ...bossStats(7), window: win });
    bots.damage('z-0', 25, 'h', 'pistol', 0);
    const [normal, boss] = bots.states(0);
    expect(normal[1]).toBe(1);
    expect(normal.slice(8)).toEqual([35, 60]);
    expect(boss[1]).toBe(2);
    expect(boss[9]).toBe(bossStats(7).hp);
  });
});
