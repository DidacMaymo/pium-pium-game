// Tienda del modo Zombis: puntos por impacto/baja y compras. Lógica pura (sin DOM) para poder testearla.
// La autoridad es el host: valida y descuenta; el comprador aplica el efecto en su juego.

export const POINTS = { hit: 10, kill: 100, wave: 250 };

export const SHOP = {
  medkit: { name: 'Botiquín', desc: 'Vida al máximo', cost: 250, kind: 'instant' },
  revive: { name: 'Revivir equipo', desc: 'Levanta ya a los compañeros caídos', cost: 1000, kind: 'team' },
  secondlife: { name: 'Segunda Vida', desc: 'Si caes, te levantas a los 3 s (una vez)', cost: 1500, kind: 'perk' },
  punch: { name: 'Puño de Hierro', desc: 'El puñetazo (V) revienta zombis', cost: 1000, kind: 'perk' },
  armor: { name: 'Refresco Blindado', desc: 'Vida máxima 200', cost: 2000, kind: 'perk' },
  doubletap: { name: 'Cola Doble Tiro', desc: 'Disparas un 50 % más rápido', cost: 2000, kind: 'perk' },
  pap: { name: 'Pack-a-Pium', desc: 'Todas tus armas hacen el doble de daño', cost: 3000, kind: 'perk' },
};

/**
 * ¿Puede comprar? player: { points, perks: [] }, ctx: { alive, anyDead }
 * Devuelve { ok: true } o { ok: false, reason }.
 */
export function canBuy(player, itemId, { alive = true, anyDead = false } = {}) {
  const item = SHOP[itemId];
  if (!item) return { ok: false, reason: 'No existe' };
  if (!player) return { ok: false, reason: 'Jugador desconocido' };
  if (!alive) return { ok: false, reason: 'Estás caído' };
  if ((player.points ?? 0) < item.cost) return { ok: false, reason: 'Faltan puntos' };
  if (item.kind === 'perk' && (player.perks ?? []).includes(itemId)) return { ok: false, reason: 'Ya lo tienes' };
  if (item.kind === 'team' && !anyDead) return { ok: false, reason: 'No hay nadie caído' };
  return { ok: true };
}

/** Descuenta y registra la compra (muta player). Llamar solo si canBuy dio ok. */
export function applyPurchase(player, itemId) {
  const item = SHOP[itemId];
  player.points -= item.cost;
  if (item.kind === 'perk') player.perks = [...(player.perks ?? []), itemId];
  return player;
}

/** Al caer se pierden las mejoras (salvo que te levante la Segunda Vida). */
export function losePerks(player) {
  player.perks = [];
  return player;
}
