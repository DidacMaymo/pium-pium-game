import { TILE, HIGH, mulberry32 } from './maps.js';

const tileDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** ¿Hay línea de visión entre dos puntos (coordenadas de mundo)? Bloquean paredes y cajas altas. */
export function hasLOS(map, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(d / 0.4);
  for (let i = 1; i < n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const z = az + ((bz - az) * i) / n;
    const tx = Math.round(x / TILE), ty = Math.round(z / TILE);
    if (map.height(tx, ty) >= HIGH || map.sightBlocked?.has(ty * map.W + tx)) return false;
  }
  return true;
}

/** Spawns iniciales justos y deterministas para n jugadores. */
export function initialSpawns(map, n) {
  if (map.kind !== 'maze') return Array.from({ length: n }, (_, i) => map.spawns[i % map.spawns.length]);

  const rand = mulberry32(map.seed ^ 0x9e3779b9);
  const far = map.cells.filter((c) => c.d >= map.maxDist * 0.6);
  const pool = far.length >= n ? far : map.cells;
  const chosen = [pool[Math.floor(rand() * pool.length)]];
  while (chosen.length < n) {
    const ref = chosen[0].d;
    let candidates = pool.filter((c) => !chosen.includes(c) && Math.abs(c.d - ref) <= 4);
    if (!candidates.length) candidates = pool.filter((c) => !chosen.includes(c));
    if (!candidates.length) { chosen.push(chosen[chosen.length % chosen.length]); continue; }
    const minD = (c) => Math.min(...chosen.map((s) => tileDist(s, c)));
    candidates.sort((a, b) => minD(b) - minD(a));
    chosen.push(candidates[Math.floor(rand() * Math.min(3, candidates.length))]);
  }
  return chosen;
}

/**
 * Reaparición aleatoria: fuera de la vista de los enemigos y lejos de ellos.
 * En el laberinto además lejos de la salida.
 * enemies: [{x, z}] en coordenadas de mundo.
 */
export function pickRespawn(map, enemies) {
  let pool = map.kind === 'maze' ? map.cells.filter((c) => c.d >= map.maxDist * 0.5) : map.cells;
  if (!pool.length) pool = map.cells;
  if (!enemies.length) return pool[Math.floor(Math.random() * pool.length)];

  const scored = pool.map((c) => {
    const wx = c.x * TILE, wz = c.y * TILE;
    let minD = Infinity, seen = false;
    for (const e of enemies) {
      const d = Math.hypot(e.x - wx, e.z - wz);
      minD = Math.min(minD, d);
      if (d < 35 && hasLOS(map, e.x, e.z, wx, wz)) seen = true;
    }
    const tooClose = minD < 9;
    return { c, score: (seen ? 0 : 100) + (tooClose ? 0 : 50) + Math.min(minD, 30) + Math.random() * 6 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[Math.floor(Math.random() * Math.min(3, scored.length))].c;
}
