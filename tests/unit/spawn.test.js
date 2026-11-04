import { describe, it, expect } from 'vitest';
import { generateMaze, buildArena, TILE } from '../../src/maps.js';
import { initialSpawns, pickRespawn, hasLOS } from '../../src/spawn.js';

describe('spawns', () => {
  it('spawns iniciales del laberinto: distintos, deterministas y lejos de la salida', () => {
    const m = generateMaze(42, 9);
    const a = initialSpawns(m, 4), b = initialSpawns(m, 4);
    expect(a).toEqual(b);
    expect(new Set(a.map((s) => `${s.x},${s.y}`)).size).toBe(4);
    for (const s of a) expect(m.distAt(s.x, s.y)).toBeGreaterThanOrEqual(m.maxDist * 0.5);
  });

  it('spawns iniciales de arena usan los puntos del mapa', () => {
    const m = buildArena('coliseo', 1);
    const sp = initialSpawns(m, 3);
    expect(sp).toEqual(m.spawns.slice(0, 3));
  });

  it('la línea de visión la cortan las paredes', () => {
    const m = buildArena('pasillos', 1);
    // de una esquina a la contraria hay paredes en medio
    expect(hasLOS(m, 1 * TILE, 1 * TILE, 13 * TILE, 13 * TILE)).toBe(false);
    // dos casillas libres contiguas se ven
    expect(hasLOS(m, 1 * TILE, 1 * TILE, 2 * TILE, 1 * TILE)).toBe(true);
  });

  it('reaparecer: lejos del enemigo y fuera de su vista cuando es posible', () => {
    const m = buildArena('pasillos', 1);
    const enemy = { x: 7 * TILE, z: 7 * TILE };
    for (let i = 0; i < 50; i++) {
      const t = pickRespawn(m, [enemy]);
      const wx = t.x * TILE, wz = t.y * TILE;
      expect(Math.hypot(wx - enemy.x, wz - enemy.z)).toBeGreaterThanOrEqual(9);
      expect(hasLOS(m, enemy.x, enemy.z, wx, wz)).toBe(false);
      expect(m.height(t.x, t.y)).toBe(0);
    }
  });

  it('reaparecer en el laberinto: lejos de la salida', () => {
    const m = generateMaze(9, 9);
    for (let i = 0; i < 50; i++) {
      const t = pickRespawn(m, []);
      expect(m.distAt(t.x, t.y)).toBeGreaterThanOrEqual(m.maxDist * 0.5);
    }
  });
});
