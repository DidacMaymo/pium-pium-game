import { describe, it, expect, vi } from 'vitest';
import { BotManager } from '../../src/bots.js';
import { buildArena, generateMaze, TILE } from '../../src/maps.js';

function setup(map, mode = 'arena', skill = 'dificil') {
  const hooks = { hitPlayer: vi.fn(), died: vi.fn(), shot: vi.fn(), reachedExit: vi.fn() };
  const bots = new BotManager(hooks);
  bots.reset(map, mode, { skill, deathMs: 2000, invulnMs: 0 });
  return { bots, hooks };
}

/** Simula `seconds` de juego en pasos de 66 ms (como el host). */
function run(bots, humans, seconds, t0 = 0) {
  let now = t0;
  for (let i = 0; i < seconds / 0.066; i++) { now += 66; bots.update(0.066, now, humans); }
  return now;
}

describe('bots', () => {
  it('van a por un humano visible y le disparan', () => {
    const map = buildArena('coliseo', 1);
    const { bots, hooks } = setup(map);
    bots.addBot('bot-0', 'Bot', map.spawns[1], 'rifle');
    const human = { id: 'h', x: map.spawns[0].x * TILE, y: 0, z: map.spawns[0].y * TILE, alive: true, inv: false };
    run(bots, [human], 20);
    expect(hooks.shot).toHaveBeenCalled();
    expect(hooks.hitPlayer).toHaveBeenCalled();
    expect(hooks.hitPlayer.mock.calls[0][0]).toBe('h');
  });

  it.each(['coliseo', 'torres', 'pasillos', 'aleatoria'])('no atraviesan paredes ni cajas (%s)', (id) => {
    const map = buildArena(id, 3);
    const { bots } = setup(map);
    // varios bots peleando entre sí y con humanos quietos: persiguen, se apartan y se mueven de lado
    const list = map.spawns.slice(0, 6).map((s, i) => bots.addBot(`bot-${i}`, 'Bot', s, 'shotgun'));
    const humans = map.spawns.slice(6, 8).map((s, i) => ({ id: `h${i}`, x: s.x * TILE, y: 0, z: s.y * TILE, alive: true, inv: false }));
    let now = 0;
    for (let i = 0; i < 600; i++) {
      now += 66;
      bots.update(0.066, now, humans);
      for (const b of list) {
        if (b.dead) continue;
        // ninguna esquina del bot (radio 0.35) dentro de una casilla sólida
        for (const [ox, oz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
          const h = map.height(Math.round((b.x + ox) / TILE), Math.round((b.z + oz) / TILE));
          expect(h, `${b.id} en ${b.x.toFixed(2)},${b.z.toFixed(2)}`).toBe(0);
        }
      }
    }
  });

  it('el daño los mata, avisa y reaparecen', () => {
    const map = buildArena('coliseo', 1);
    const { bots, hooks } = setup(map);
    bots.addBot('bot-0', 'Bot', map.spawns[1]);
    expect(bots.damage('bot-0', 40, 'h', 'pistol', 0)).toBe(false);
    expect(bots.damage('bot-0', 70, 'h', 'pistol', 0)).toBe(true);
    expect(hooks.died).toHaveBeenCalledWith('bot-0', 'h', 'pistol');
    expect(bots.bots.get('bot-0').dead).toBe(true);
    bots.update(0.066, 2500, []);
    expect(bots.bots.get('bot-0').dead).toBe(false);
    expect(bots.bots.get('bot-0').hp).toBe(100);
  });

  it('no ven a un fantasma lejano', () => {
    const map = buildArena('coliseo', 1);
    const { bots, hooks } = setup(map);
    bots.addBot('bot-0', 'Bot', map.spawns[1], 'rifle');
    const ghost = { id: 'h', x: map.spawns[0].x * TILE, y: 0, z: map.spawns[0].y * TILE, alive: true, inv: false, ghost: true };
    // se quedan parados lejos (el humano está quieto): no le disparan mientras no se acerquen a 6 m
    let now = 0;
    for (let i = 0; i < 60; i++) {
      now += 66;
      bots.update(0.066, now, [ghost]);
      const b = bots.bots.get('bot-0');
      if (Math.hypot(b.x - ghost.x, b.z - ghost.z) > 6.5) expect(hooks.hitPlayer).not.toHaveBeenCalled();
    }
  });

  it('también recargan: al vaciar el cargador dejan de disparar un rato', () => {
    const map = buildArena('coliseo', 1);
    const { bots } = setup(map);
    const b = bots.addBot('bot-0', 'Bot', map.spawns[1], 'sniper');
    expect(b.mag).toBe(5);
    bots.setWeapon('bot-0', 'smg');
    expect(b.mag).toBe(32);
    b.mag = 1;
    b.reactAt = 0;
    const human = { id: 'h', x: b.x + 6, y: 0, z: b.z, alive: true, inv: false };
    let now = 1000;
    for (let i = 0; i < 60 && b.reloadAt === 0; i++) { now += 66; bots.update(0.066, now, [human]); }
    expect(b.reloadAt).toBeGreaterThan(now);
    expect(b.mag).toBe(32);
  });

  it('en el laberinto buscan la salida', () => {
    const map = generateMaze(5, 6);
    const { bots, hooks } = setup(map, 'maze');
    bots.addBot('bot-0', 'Bot', map.cells[0]);
    run(bots, [], 120);
    expect(hooks.reachedExit).toHaveBeenCalledWith('bot-0');
  });
});

describe('zombis', () => {
  it('persiguen al humano y le muerden', () => {
    const map = buildArena('coliseo', 1);
    const { bots, hooks } = setup(map, 'zombies');
    bots.addZombie('z-0', map.spawns[1], { hp: 60, speed: 4, dmg: 20 });
    const human = { id: 'h', x: map.spawns[0].x * TILE, y: 0, z: map.spawns[0].y * TILE, alive: true, inv: false };
    run(bots, [human], 40);
    expect(hooks.hitPlayer).toHaveBeenCalledWith('h', 20, 'z-0', 'zombie');
  });

  it('no atacan a humanos caídos y desaparecen al morir', () => {
    const map = buildArena('coliseo', 1);
    const { bots, hooks } = setup(map, 'zombies');
    bots.addZombie('z-0', map.spawns[1], { hp: 60, speed: 4, dmg: 20 });
    const dead = { id: 'h', x: map.spawns[0].x * TILE, y: 0, z: map.spawns[0].y * TILE, alive: false, inv: false };
    run(bots, [dead], 20);
    expect(hooks.hitPlayer).not.toHaveBeenCalled();
    expect(bots.aliveZombies).toBe(1);
    bots.damage('z-0', 100, 'h', 'rifle', 0);
    expect(bots.bots.has('z-0')).toBe(false);
    expect(bots.aliveZombies).toBe(0);
  });
});

describe('estado de red', () => {
  it('states() es compacto y serializable', () => {
    const map = buildArena('coliseo', 1);
    const { bots } = setup(map);
    bots.addBot('bot-0', 'Bot', map.spawns[1], 'smg');
    bots.addZombie('z-0', map.spawns[2], { hp: 60, speed: 4, dmg: 20 });
    const s = bots.states(0);
    expect(s).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s[0][7]).toBe('smg');
    expect(s[1][1]).toBe(1);
  });
});
