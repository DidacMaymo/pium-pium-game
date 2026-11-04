import { describe, it, expect } from 'vitest';
import { generateMaze, generateArena, buildArena, buildTraining, buildParkour, moverBox, MAZE_SIZES, WALL, LOW, TILE } from '../../src/maps.js';
import { ARENA_MAPS, TRAINING_MAP, PARKOUR_LEVELS } from '../../src/mapdefs.js';

/** Casillas alcanzables andando (suelo y cajas bajas) desde (sx, sy). */
function reachable(map, sx, sy, passable = (h) => h <= LOW) {
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && passable(map.height(nx, ny))) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen;
}
function countPassable(map, passable = (h) => h <= LOW) {
  let n = 0;
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) if (passable(map.height(x, y))) n++;
  return n;
}

describe('laberinto', () => {
  it('es determinista: misma semilla, mismo mapa', () => {
    const a = generateMaze(1234, 9), b = generateMaze(1234, 9);
    expect([...a.h]).toEqual([...b.h]);
    expect(a.exit).toEqual(b.exit);
  });

  it('semillas distintas dan mapas distintos', () => {
    expect([...generateMaze(1, 9).h]).not.toEqual([...generateMaze(2, 9).h]);
  });

  it.each(Object.entries(MAZE_SIZES))('dificultad %s tiene el tamaño correcto', (_, cells) => {
    const m = generateMaze(7, cells);
    expect(m.W).toBe(cells * 2 + 1);
    expect(m.H).toBe(cells * 2 + 1);
  });

  it('la salida está en el borde y todo el suelo está conectado con ella', () => {
    for (let seed = 0; seed < 30; seed++) {
      const m = generateMaze(seed * 97 + 5, 9);
      const { x, y } = m.exit;
      expect(x === 0 || y === 0 || x === m.W - 1 || y === m.H - 1).toBe(true);
      expect(reachable(m, x, y, (h) => h === 0).size).toBe(countPassable(m, (h) => h === 0));
    }
  });

  it('fuera del mapa es pared', () => {
    const m = generateMaze(3, 6);
    expect(m.height(-1, 0)).toBe(WALL);
    expect(m.height(m.W, 0)).toBe(WALL);
  });
});

describe('arenas', () => {
  it('la arena aleatoria siempre está conectada (100 semillas)', () => {
    for (let seed = 0; seed < 100; seed++) {
      const m = generateArena(seed);
      const s = m.spawns[0];
      expect(reachable(m, s.x, s.y).size).toBe(countPassable(m));
    }
  });

  it.each(Object.keys(ARENA_MAPS).filter((k) => !ARENA_MAPS[k].procedural))('mapa %s: bien formado, conectado y con 8 spawns', (id) => {
    const def = ARENA_MAPS[id];
    const width = def.rows[0].length;
    for (const row of def.rows) expect(row.length).toBe(width);
    const m = buildArena(id, 1);
    expect(m.spawns.length).toBeGreaterThanOrEqual(8);
    for (const s of m.spawns) expect(m.height(s.x, s.y)).toBe(0);
    const s = m.spawns[0];
    expect(reachable(m, s.x, s.y).size).toBe(countPassable(m));
    // el borde es pared
    for (let x = 0; x < m.W; x++) { expect(m.height(x, 0)).toBe(WALL); expect(m.height(x, m.H - 1)).toBe(WALL); }
  });

  it('el campo de tiro tiene un spawn', () => {
    expect(TRAINING_MAP.rows.every((r) => r.length === TRAINING_MAP.rows[0].length)).toBe(true);
    expect(buildTraining(1).spawns.length).toBe(1);
  });

  it('los muros deslizantes tienen hueco para moverse', () => {
    for (const id of Object.keys(ARENA_MAPS)) {
      if (ARENA_MAPS[id].procedural) continue;
      const m = buildArena(id, 1);
      for (const mv of m.movers.filter((v) => v.type === 'slide')) {
        for (const d of [-1, 1]) {
          const x = mv.axis === 'x' ? mv.x + d : mv.x, y = mv.axis === 'z' ? mv.y + d : mv.y;
          expect(m.height(x, y), `${id} deslizante en ${mv.x},${mv.y}`).toBe(0);
        }
      }
    }
  });
});

describe('objetos móviles', () => {
  const piston = { type: 'piston', x: 2, y: 3, base: 0, h0: 0.2, h1: 2.6, period: 6, phase: 0 };
  const slide = { type: 'slide', x: 2, y: 3, axis: 'x', amp: TILE, y0: 0, y1: 2.2, period: 4, phase: 1 };

  it('son deterministas y periódicos', () => {
    expect(moverBox(piston, 1.5)).toEqual(moverBox(piston, 1.5));
    expect(moverBox(piston, 1.5).y1).toBeCloseTo(moverBox(piston, 7.5).y1, 6);
    expect(moverBox(slide, 0.3).cx).toBeCloseTo(moverBox(slide, 4.3).cx, 6);
  });

  it('el pistón se mueve entre h0 y h1', () => {
    for (let t = 0; t < 6; t += 0.25) {
      const b = moverBox(piston, t);
      expect(b.y1).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(b.y1).toBeLessThanOrEqual(2.6 + 1e-9);
    }
  });

  it('el deslizante no se sale de su recorrido', () => {
    for (let t = 0; t < 4; t += 0.1) {
      const b = moverBox(slide, t);
      expect(Math.abs(b.cx - slide.x * TILE)).toBeLessThanOrEqual(TILE + 1e-9);
      expect(b.cz).toBe(slide.y * TILE);
    }
  });
});

describe('parkour (estructura)', () => {
  it.each(PARKOUR_LEVELS.map((l, i) => [l.name, i]))('%s: salida, meta y checkpoints', (_, i) => {
    const m = buildParkour(i, 1);
    expect(m.start).toBeTruthy();
    expect(m.finish).toBeTruthy();
    expect(m.lava).toBe(true);
    expect(m.checkpoints.length).toBeGreaterThan(0);
    expect(m.height(m.start.x, m.start.y)).toBeGreaterThan(0);
  });
});
