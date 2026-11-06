// Comprueba si un nivel de parkour se puede completar con la física del juego.
// Lo usan los tests y `npm run check-parkour`. Las constantes deben coincidir con game.js.
import { TILE, LAVA, WALL } from './maps.js';

export const PHYSICS = { gravity: 20, jumpV: 6.2, speed: 5.5, radius: 0.35 };
const SIZE = TILE * 0.96;
const R = PHYSICS.radius * 0.7; // radio con el que se detecta el suelo
const MARGIN = 0.85; // 15 % de margen: no exigir saltos perfectos
// Los power-ups caducan: cuántos saltos dan de sí (≈ duración / 1,8 s por salto)
const POWER_HOPS = { jump: 6, hyper: 2 };

function landTime(dh, dbl) {
  const { gravity: G, jumpV: V } = PHYSICS;
  if (!dbl) { const d = V * V - 2 * G * dh; return d < 0 ? null : (V + Math.sqrt(d)) / G; }
  const apex = (V * V) / (2 * G);
  const d = V * V + 2 * G * (apex - dh);
  return d < 0 ? null : V / G + (V + Math.sqrt(d)) / G;
}

/** ¿Hay una pared entre dos puntos? (solo en niveles dentro de edificios) */
function wallBetween(map, a, b) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
  for (let i = 1; i < n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
    if (map.height(Math.round(x / TILE), Math.round(z / TILE)) === WALL) return true;
  }
  return false;
}

function reach(dh, power) {
  const t = landTime(dh, power.includes('jump'));
  const spd = power.includes('hyper') ? PHYSICS.speed * 2 : PHYSICS.speed;
  return t == null ? -1 : spd * t * MARGIN;
}

/** Devuelve { ok, reached: [etiquetas de plataformas alcanzadas] } */
export function checkParkour(map) {
  const nodes = [];
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    const h = map.height(x, y);
    if (h > LAVA && h !== WALL) nodes.push({ x: x * TILE, z: y * TILE, hmin: h, hmax: h, tag: `${x},${y}` });
  }
  for (const mv of map.movers) {
    if (mv.type === 'piston') nodes.push({ x: mv.x * TILE, z: mv.y * TILE, hmin: mv.h0, hmax: mv.h1, tag: `piston ${mv.x},${mv.y}` });
    else for (const o of [-1, 0, 1]) {
      nodes.push({
        x: mv.x * TILE + (mv.axis === 'x' ? o * mv.amp : 0), z: mv.y * TILE + (mv.axis === 'z' ? o * mv.amp : 0),
        hmin: mv.y1, hmax: mv.y1, tag: `mover ${mv.x},${mv.y} ${o}`, mover: `${mv.x},${mv.y}`,
      });
    }
  }
  const puAt = Object.fromEntries(map.localPowerups.map((p) => [`${p.x},${p.y}`, p.type]));
  const idx = (tag) => nodes.findIndex((n) => n.tag === tag);
  const start = idx(`${map.start.x},${map.start.y}`);
  const fin = idx(`${map.finish.x},${map.finish.y}`);
  const key = (i, p, hops) => `${i}|${p}|${hops}`;
  const seen = new Set([key(start, '', 0)]);
  const queue = [[start, '', 0]];
  let ok = false;
  while (queue.length) {
    const [i, p, hopsLeft] = queue.shift();
    if (i === fin) { ok = true; break; }
    const a = nodes[i];
    const picked = puAt[a.tag];
    const pw = picked ?? (hopsLeft > 0 ? p : '');
    const hops = picked ? POWER_HOPS[picked] ?? 0 : hopsLeft;
    for (let j = 0; j < nodes.length; j++) {
      if (j === i) continue;
      const b = nodes[j];
      let can = a.mover && a.mover === b.mover; // un móvil te lleva de un extremo a otro
      if (!can && !wallBetween(map, a, b)) {
        const gx = Math.max(0, Math.abs(a.x - b.x) - SIZE), gz = Math.max(0, Math.abs(a.z - b.z) - SIZE);
        const gap = Math.max(0, Math.hypot(gx, gz) - 2 * R);
        for (const ha of [a.hmin, a.hmax]) for (const hb of [b.hmin, b.hmax]) {
          const dh = hb - ha;
          if (gap === 0 ? dh <= (pw.includes('jump') ? 1.85 : 0.9) : reach(dh, pw) >= gap) can = true;
        }
      }
      const next = Math.max(0, hops - 1);
      if (can && !seen.has(key(j, pw, next))) { seen.add(key(j, pw, next)); queue.push([j, pw, next]); }
    }
  }
  const reached = [...new Set([...seen].map((k) => nodes[+k.split('|')[0]].tag))];
  return { ok, reached };
}
