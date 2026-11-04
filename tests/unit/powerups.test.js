import { describe, it, expect } from 'vitest';
import { POWERUPS, MODE_POWERUPS, MAX_SAME, pickPowerupType } from '../../src/powerups.js';

describe('power-ups', () => {
  it('todos los tipos por modo existen', () => {
    for (const list of Object.values(MODE_POWERUPS)) for (const t of list) expect(POWERUPS[t]).toBeTruthy();
  });

  it.each(Object.keys(MODE_POWERUPS))('modo %s: nunca más de MAX_SAME iguales y solo tipos permitidos', (mode) => {
    const current = [];
    let last = null;
    for (let i = 0; i < 200; i++) {
      const t = pickPowerupType(mode, current, last);
      if (!t) break;
      expect(MODE_POWERUPS[mode]).toContain(t);
      current.push({ type: t });
      last = t;
      expect(current.filter((p) => p.type === t).length).toBeLessThanOrEqual(MAX_SAME);
    }
    // se llena hasta MAX_SAME de cada tipo y entonces devuelve null
    expect(current.length).toBe(MODE_POWERUPS[mode].length * MAX_SAME);
    expect(pickPowerupType(mode, current, last)).toBeNull();
  });

  it('rota: los primeros N son todos distintos', () => {
    const current = [];
    let last = null;
    for (let i = 0; i < MODE_POWERUPS.arena.length; i++) {
      last = pickPowerupType('arena', current, last);
      current.push({ type: last });
    }
    expect(new Set(current.map((p) => p.type)).size).toBe(MODE_POWERUPS.arena.length);
  });

  it('el juego de armas no reparte armas extra', () => {
    expect(MODE_POWERUPS.gungame).not.toContain('sniper');
    expect(MODE_POWERUPS.gungame).not.toContain('auto');
  });
});
