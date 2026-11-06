import { describe, it, expect } from 'vitest';
import { createMouseFilter } from '../../src/input.js';
import { GRENADE, launchGrenade, stepGrenade, grenadeDamage } from '../../src/grenades.js';
import { revealFrom, liveShots, SHOT_MS, MINIMAP_MODES } from '../../src/minimap.js';
import { buildZombies, buildArena, buildParkour, applyDoors, TILE, WALL } from '../../src/maps.js';
import { PARKOUR_LEVELS } from '../../src/mapdefs.js';
import { describeUse, createZombieWorld, GRENADES_COST } from '../../src/zombieworld.js';
import { checkParkour, PHYSICS } from '../../src/parkourCheck.js';

describe('filtro del ratón (la cámara no gira sola)', () => {
  it('deja pasar el movimiento normal', () => {
    const f = createMouseFilter();
    for (const dx of [2, 5, 12, 30, 60, 120, 180]) expect(f.accept(dx, 0)).toBe(true);
  });

  it('descarta un salto aislado y falso, sea cual sea su dirección', () => {
    const f = createMouseFilter();
    f.accept(3, 1);
    expect(f.accept(-900, 40)).toBe(false);
    expect(f.accept(2, 1)).toBe(true);
    expect(f.accept(1200, -30)).toBe(false);
  });

  it('un giro rápido de verdad, que va acelerando, no se corta', () => {
    const f = createMouseFilter();
    for (const dx of [20, 80, 240, 500, 900, 1100, 700, 300]) expect(f.accept(dx, 0), `dx ${dx}`).toBe(true);
  });

  it('si el segundo evento también es grande, era movimiento real', () => {
    const f = createMouseFilter();
    expect(f.accept(600, 0)).toBe(false);
    expect(f.accept(650, 0)).toBe(true);
  });
});

describe('granadas', () => {
  const fly = (map, g, secs = 3) => { let t = 0; while (t < secs && !stepGrenade(map, g, 1 / 60)) t += 1 / 60; return g; };

  it('explotan a los ~1,8 s', () => {
    const map = buildZombies(1);
    const g = launchGrenade([18 * TILE, 1.5, 22 * TILE], [0, 0, 1]);
    fly(map, g);
    expect(g.t).toBeGreaterThanOrEqual(GRENADE.fuse);
    expect(g.t).toBeLessThan(GRENADE.fuse + 0.1);
  });

  it('no atraviesan paredes ni puertas cerradas', () => {
    const map = buildZombies(1);
    // lanzada al norte contra la puerta 1, cerrada
    const door = map.doors.find((d) => d.id === '1');
    const g = launchGrenade([door.x * TILE, 1.5, (door.y + 1) * TILE], [0, 0, -1]);
    fly(map, g);
    expect(g.z).toBeGreaterThan((door.y + 0.5) * TILE - 0.01);
    // con la puerta abierta, sí pasa
    applyDoors(map, ['1']);
    const g2 = launchGrenade([door.x * TILE, 1.5, (door.y + 1) * TILE], [0, 0, -1]);
    fly(map, g2);
    expect(g2.z).toBeLessThan((door.y - 0.5) * TILE);
  });

  it('acaban en el suelo, dentro del mapa', () => {
    const map = buildArena('coliseo', 1);
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const g = launchGrenade([7 * TILE, 1.6, 3 * TILE], [Math.cos(ang), 0.3, Math.sin(ang)]);
      fly(map, g);
      expect(g.y).toBeGreaterThanOrEqual(0);
      expect(map.height(Math.round(g.x / TILE), Math.round(g.z / TILE))).not.toBe(WALL);
    }
  });

  it('el daño baja con la distancia y es 0 fuera del radio', () => {
    expect(grenadeDamage(0)).toBeGreaterThan(grenadeDamage(3));
    expect(grenadeDamage(3)).toBeGreaterThan(grenadeDamage(5.5));
    expect(grenadeDamage(GRENADE.radius)).toBe(0);
  });

  it('en zombis se compran', () => {
    const map = buildZombies(1);
    const t = map.props.find((p) => p.kind === 'grenades');
    expect(t).toBeTruthy();
    const zw = createZombieWorld(map);
    expect(describeUse(t, { zw, player: { points: GRENADES_COST } }).ok).toBe(true);
    expect(describeUse(t, { zw, player: { points: 1 } }).reason).toBe('Faltan puntos');
    // están en la sala inicial
    expect(map.cells.some((c) => Math.abs(c.x - t.x) + Math.abs(c.y - t.y) === 1)).toBe(true);
  });
});

describe('revivir a un compañero', () => {
  it('es gratis y lleva su nombre en el aviso', () => {
    const map = buildZombies(1);
    const zw = createZombieWorld(map);
    const info = describeUse({ kind: 'ally', id: 'x', name: 'Paco' }, { zw, player: { points: 0 } });
    expect(info).toMatchObject({ ok: true, cost: 0 });
    expect(info.text).toContain('Paco');
  });
});

describe('minimapa', () => {
  it('en zombis se descubre por lo que ves: ni más allá de paredes ni de puertas cerradas', () => {
    const map = buildZombies(1);
    const seen = new Set();
    const s = map.spawns[0];
    revealFrom(map, seen, s.x * TILE, s.y * TILE);
    const has = (x, y) => seen.has(y * map.W + x);
    expect(has(s.x, s.y)).toBe(true);
    const door = map.doors.find((d) => d.id === '1');
    expect(has(door.x, door.y)).toBe(true); // la puerta se ve...
    expect(has(door.x, door.y - 2)).toBe(false); // ...pero no lo que hay detrás
    const power = map.props.find((p) => p.kind === 'power');
    expect(has(power.x, power.y)).toBe(false);
  });

  it('al abrir una puerta se ve el otro lado', () => {
    const map = buildZombies(1);
    applyDoors(map, ['1']);
    const door = map.doors.find((d) => d.id === '1');
    const seen = new Set();
    revealFrom(map, seen, door.x * TILE, (door.y + 1) * TILE);
    expect(seen.has((door.y - 2) * map.W + door.x)).toBe(true);
  });

  it('solo en los modos previstos', () => {
    expect(Object.keys(MINIMAP_MODES).sort()).toEqual(['arena', 'gungame', 'zombies']);
  });

  it('los disparos desaparecen a los pocos segundos', () => {
    const shots = [{ x: 0, z: 0, t: 1000 }, { x: 1, z: 1, t: 3000 }];
    expect(liveShots(shots, 2000)).toHaveLength(2);
    expect(liveShots(shots, 1000 + SHOT_MS + 1)).toEqual([shots[1]]);
  });
});

describe('parkour dentro de edificios', () => {
  const indoor = PARKOUR_LEVELS.map((l, i) => [l.name, i, l]).filter(([, , l]) => l.wallH);

  it('hay varios', () => {
    expect(indoor.length).toBeGreaterThanOrEqual(4);
  });

  it.each(indoor)('%s: paredes, techo y sitio para saltar', (_, i, def) => {
    const m = buildParkour(i, 1);
    expect(m.ceiling).toBe(true);
    expect(m.wallH).toBe(def.wallH);
    let walls = 0, top = 0;
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const h = m.height(x, y);
      if (h === WALL) walls++;
      else top = Math.max(top, h);
    }
    expect(walls).toBeGreaterThan(m.W * 2);
    // desde la plataforma más alta se puede saltar sin dar con la cabeza en el techo
    const jump = (PHYSICS.jumpV * PHYSICS.jumpV) / (2 * PHYSICS.gravity);
    expect(top + jump + 1.75).toBeLessThanOrEqual(m.wallH);
  });

  it.each(indoor)('%s: necesita saltos (no se llega a la meta de un paso)', (_, i) => {
    const m = buildParkour(i, 1);
    const dist = Math.hypot(m.start.x - m.finish.x, m.start.y - m.finish.y);
    const reached = checkParkour(m).reached.length;
    expect(dist + reached).toBeGreaterThan(8);
  });

  it('la comprobación no deja saltar a través de una pared', () => {
    const m = buildParkour(0, 1);
    const at = (x, y) => (x === 2 && y === 0 ? 0.5 : x === 4 && y === 0 ? 0.5 : x === 3 && y === 0 ? WALL : -2);
    const base = { ...m, W: 7, H: 1, movers: [], localPowerups: [], start: { x: 2, y: 0 }, finish: { x: 4, y: 0 } };
    expect(checkParkour({ ...base, height: at }).ok).toBe(false);
    expect(checkParkour({ ...base, height: (x, y) => (x === 3 ? -2 : at(x, y)) }).ok).toBe(true);
  });
});
