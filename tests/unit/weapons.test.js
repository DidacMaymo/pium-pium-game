import { describe, it, expect } from 'vitest';
import { WEAPONS, LOADOUT, GUNGAME } from '../../src/weapons.js';

describe('armas', () => {
  it.each(Object.entries(WEAPONS))('%s tiene stats válidos', (_, w) => {
    for (const k of ['dmg', 'cd', 'pellets', 'range', 'botAcc']) expect(w[k], k).toBeGreaterThan(0);
    expect(w.spread).toBeGreaterThanOrEqual(0);
    expect(typeof w.name).toBe('string');
  });

  it.each(Object.entries(WEAPONS))('%s tiene munición finita y recarga', (_, w) => {
    expect(w.mag).toBeGreaterThan(0);
    expect(w.reload).toBeGreaterThan(0);
    expect(w.reserve).toBeGreaterThanOrEqual(w.mag * 4); // "bastante"
    expect(Number.isFinite(w.reserve)).toBe(true);
  });

  it('cada arma hace un daño distinto y el francotirador es el que más daña por disparo', () => {
    const total = (w) => w.dmg * w.pellets;
    const list = Object.values(WEAPONS);
    expect(new Set(list.map(total)).size).toBe(list.length);
    for (const [id, w] of Object.entries(WEAPONS)) {
      if (id !== 'sniper') expect(total(WEAPONS.sniper), id).toBeGreaterThan(total(w));
    }
  });

  it('la pistola de rayos solo sale en la caja', () => {
    expect(LOADOUT).not.toContain('raygun');
    expect(GUNGAME).not.toContain('raygun');
  });

  it('el equipo y el juego de armas solo usan armas existentes', () => {
    for (const id of [...LOADOUT, ...GUNGAME]) expect(WEAPONS[id], id).toBeTruthy();
    expect(LOADOUT.length).toBeLessThanOrEqual(9); // teclas 1-9
  });

  it('ninguna arma automática hace más daño por segundo que un tiro de láser cada 0,4 s × 1,5', () => {
    const laserDps = WEAPONS.laser.dmg / WEAPONS.laser.cd;
    for (const w of Object.values(WEAPONS)) expect((w.dmg * w.pellets) / w.cd).toBeLessThanOrEqual(laserDps * 1.5);
  });
});
