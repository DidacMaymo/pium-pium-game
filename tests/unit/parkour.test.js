import { describe, it, expect } from 'vitest';
import { buildParkour } from '../../src/maps.js';
import { PARKOUR_LEVELS } from '../../src/mapdefs.js';
import { checkParkour } from '../../src/parkourCheck.js';

describe('niveles de parkour', () => {
  it.each(PARKOUR_LEVELS.map((l, i) => [l.name, i]))('%s se puede superar', (_, i) => {
    const { ok, reached } = checkParkour(buildParkour(i, 1));
    expect(ok, `solo se llega hasta: ${reached.join(' ; ')}`).toBe(true);
  });

  it('detecta un nivel imposible', () => {
    // un hueco de 3 casillas de lava sin ayudas no se puede saltar
    const map = buildParkour(0, 1);
    const fake = { ...map, movers: [], localPowerups: [], height: (x, y) => {
      if (x === map.start.x && y === map.start.y) return 0.5;
      if (x === map.finish.x && y === map.finish.y) return 0.5;
      return -2;
    } };
    expect(checkParkour(fake).ok).toBe(false);
  });
});
