// Máquinas del modo Zombis: puntos por impacto/baja y mejoras. Lógica pura (sin DOM) para poder testearla.
// La autoridad es el host: valida y descuenta; el comprador aplica el efecto en su juego.

export const POINTS = { start: 500, hit: 10, kill: 100, wave: 250, repair: 10, boss: 1000, revive: 100 };

/** Cada entrada es una máquina del mapa. Todas necesitan electricidad. */
export const SHOP = {
  medkit: { name: 'Botiquín', desc: 'Vida al máximo', cost: 250, kind: 'instant', color: 0xff5a8a },
  revive: { name: 'Revivir equipo', desc: 'Levanta ya a los compañeros caídos', cost: 1000, kind: 'team', color: 0x3dff7a },
  secondlife: { name: 'Segunda Vida', desc: 'Si caes, te levantas a los 3 s (una vez)', cost: 1500, kind: 'perk', color: 0x7affd8 },
  punch: { name: 'Puño de Hierro', desc: 'El puñetazo (V) revienta zombis', cost: 1000, kind: 'perk', color: 0xa07aff },
  armor: { name: 'Refresco Blindado', desc: 'Vida máxima 200', cost: 2000, kind: 'perk', color: 0xff3d5a },
  doubletap: { name: 'Cola Doble Tiro', desc: 'Disparas un 50 % más rápido', cost: 2000, kind: 'perk', color: 0xffa01f },
  fastreload: { name: 'Recarga Exprés', desc: 'Recargas el doble de rápido', cost: 1500, kind: 'perk', color: 0x33e0ff },
  pap: { name: 'Pack-a-Pium', desc: 'Todas tus armas hacen el doble de daño', cost: 3000, kind: 'perk', color: 0xffd23d },
};

/**
 * ¿Puede comprar? player: { points, perks: [] }, ctx: { alive, anyDead, power }
 * Devuelve { ok: true } o { ok: false, reason }.
 */
export function canBuy(player, itemId, { alive = true, anyDead = false, power = true } = {}) {
  const item = SHOP[itemId];
  if (!item) return { ok: false, reason: 'No existe' };
  if (!player) return { ok: false, reason: 'Jugador desconocido' };
  if (!alive) return { ok: false, reason: 'Estás caído' };
  if (!power) return { ok: false, reason: 'Sin electricidad' };
  if (item.kind === 'perk' && (player.perks ?? []).includes(itemId)) return { ok: false, reason: 'Ya lo tienes' };
  if (item.kind === 'team' && !anyDead) return { ok: false, reason: 'No hay nadie caído' };
  if ((player.points ?? 0) < item.cost) return { ok: false, reason: 'Faltan puntos' };
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
