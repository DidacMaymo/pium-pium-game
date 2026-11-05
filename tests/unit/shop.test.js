import { describe, it, expect } from 'vitest';
import { SHOP, canBuy, applyPurchase, losePerks } from '../../src/shop.js';

const player = (points, perks = []) => ({ points, perks });

describe('tienda zombi', () => {
  it('no deja comprar sin puntos', () => {
    expect(canBuy(player(100), 'medkit')).toEqual({ ok: false, reason: 'Faltan puntos' });
  });

  it('descuenta puntos y guarda la mejora', () => {
    const p = player(5000);
    expect(canBuy(p, 'pap').ok).toBe(true);
    applyPurchase(p, 'pap');
    expect(p.points).toBe(5000 - SHOP.pap.cost);
    expect(p.perks).toContain('pap');
  });

  it('no deja comprar dos veces la misma mejora', () => {
    expect(canBuy(player(9999, ['armor']), 'armor').reason).toBe('Ya lo tienes');
  });

  it('el botiquín se puede comprar varias veces', () => {
    const p = player(1000);
    applyPurchase(p, 'medkit');
    expect(canBuy(p, 'medkit').ok).toBe(true);
    expect(p.perks).toEqual([]);
  });

  it('revivir solo si hay alguien caído', () => {
    expect(canBuy(player(5000), 'revive', { anyDead: false }).ok).toBe(false);
    expect(canBuy(player(5000), 'revive', { anyDead: true }).ok).toBe(true);
  });

  it('un jugador caído no puede comprar', () => {
    expect(canBuy(player(5000), 'medkit', { alive: false }).ok).toBe(false);
  });

  it('sin electricidad las máquinas no venden', () => {
    expect(canBuy(player(5000), 'pap', { power: false }).reason).toBe('Sin electricidad');
  });

  it('artículos desconocidos', () => {
    expect(canBuy(player(5000), 'nuke').ok).toBe(false);
    expect(canBuy(undefined, 'medkit').ok).toBe(false);
  });

  it('al caer se pierden las mejoras', () => {
    expect(losePerks(player(10, ['pap', 'armor'])).perks).toEqual([]);
  });
});
