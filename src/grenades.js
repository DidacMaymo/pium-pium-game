// Granadas: física y daño (sin DOM ni Three.js). El vuelo es determinista: todos los jugadores simulan
// el mismo lanzamiento, y solo quien la lanza calcula el daño.
import { TILE, WALL } from './maps.js';

export const GRENADE = { fuse: 1.8, speed: 15, up: 4, gravity: 20, radius: 6, dmg: 170, max: 4 };

const STEP = 1 / 120;
const SIZE = 0.12;

function solidAt(map, x, z, y) {
  const tx = Math.round(x / TILE), ty = Math.round(z / TILE);
  const h = map.height(tx, ty);
  if (h === WALL || map.sightBlocked?.has(ty * map.W + tx)) return true;
  return y < h;
}

/** Crea una granada en (x, y, z) lanzada en la dirección unitaria dir. */
export function launchGrenade(pos, dir) {
  return {
    x: pos[0], y: pos[1], z: pos[2],
    vx: dir[0] * GRENADE.speed, vy: dir[1] * GRENADE.speed + GRENADE.up, vz: dir[2] * GRENADE.speed,
    t: 0,
  };
}

/** Avanza la granada (muta g): rebota en paredes, suelo y techo. Devuelve true cuando explota. */
export function stepGrenade(map, g, dt) {
  for (let left = dt; left > 0; left -= STEP) {
    const h = Math.min(left, STEP);
    g.t += h;
    g.vy -= GRENADE.gravity * h;
    const nx = g.x + g.vx * h;
    if (solidAt(map, nx, g.z, g.y)) g.vx *= -0.5; else g.x = nx;
    const nz = g.z + g.vz * h;
    if (solidAt(map, g.x, nz, g.y)) g.vz *= -0.5; else g.z = nz;
    const ny = g.y + g.vy * h;
    if (ny < SIZE || solidAt(map, g.x, g.z, ny - SIZE)) {
      g.vy = Math.abs(g.vy) * 0.4;
      g.vx *= 0.6;
      g.vz *= 0.6;
    } else if (map.ceiling && ny > map.wallH - SIZE) {
      g.vy = -Math.abs(g.vy) * 0.3;
    } else g.y = ny;
  }
  return g.t >= GRENADE.fuse;
}

/** Daño según la distancia: máximo en el centro, 0 fuera del radio. */
export function grenadeDamage(dist) {
  if (dist >= GRENADE.radius) return 0;
  return Math.round(GRENADE.dmg * (1 - dist / GRENADE.radius) + 15);
}
