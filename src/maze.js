// Generación de laberinto determinista a partir de una semilla.
// Ambos jugadores reciben la misma semilla => mismo laberinto sin enviar el mapa.

export const TILE = 3; // metros por casilla

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Laberinto en rejilla de casillas (1 = pared, 0 = suelo).
 * Celdas lógicas cellsW x cellsH => rejilla (2*cellsW+1) x (2*cellsH+1).
 */
export function generateMaze(seed, cellsW = 12, cellsH = 12, loopChance = 0.1) {
  const rand = mulberry32(seed);
  const W = cellsW * 2 + 1;
  const H = cellsH * 2 + 1;
  const grid = new Uint8Array(W * H).fill(1);
  const at = (x, y) => y * W + x;

  // Backtracker iterativo
  const visited = new Uint8Array(cellsW * cellsH);
  const stack = [[Math.floor(rand() * cellsW), Math.floor(rand() * cellsH)]];
  visited[stack[0][1] * cellsW + stack[0][0]] = 1;
  grid[at(stack[0][0] * 2 + 1, stack[0][1] * 2 + 1)] = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = dirs.filter(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return nx >= 0 && ny >= 0 && nx < cellsW && ny < cellsH && !visited[ny * cellsW + nx];
    });
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy] = options[Math.floor(rand() * options.length)];
    const nx = cx + dx, ny = cy + dy;
    grid[at(cx * 2 + 1 + dx, cy * 2 + 1 + dy)] = 0;
    grid[at(nx * 2 + 1, ny * 2 + 1)] = 0;
    visited[ny * cellsW + nx] = 1;
    stack.push([nx, ny]);
  }

  // Algunos bucles para que haya rutas alternativas (persecuciones, emboscadas)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!grid[at(x, y)]) continue;
      const horiz = x % 2 === 0 && y % 2 === 1; // separa celdas izquierda/derecha
      const vert = x % 2 === 1 && y % 2 === 0;  // separa celdas arriba/abajo
      if ((horiz || vert) && rand() < loopChance) grid[at(x, y)] = 0;
    }
  }

  // Salida: hueco en el borde exterior
  const side = Math.floor(rand() * 4);
  const cx = Math.floor(rand() * cellsW) * 2 + 1;
  const cy = Math.floor(rand() * cellsH) * 2 + 1;
  const exit =
    side === 0 ? { x: cx, y: 0 } :
    side === 1 ? { x: W - 1, y: cy } :
    side === 2 ? { x: cx, y: H - 1 } :
                 { x: 0, y: cy };
  grid[at(exit.x, exit.y)] = 0;

  const isWall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || grid[at(x, y)] === 1;

  // Distancia (en pasos) de cada casilla a la salida
  const dist = new Int32Array(W * H).fill(-1);
  const queue = [exit.x, exit.y];
  dist[at(exit.x, exit.y)] = 0;
  for (let i = 0; i < queue.length; i += 2) {
    const x = queue[i], y = queue[i + 1];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (!isWall(nx, ny) && dist[at(nx, ny)] === -1) {
        dist[at(nx, ny)] = dist[at(x, y)] + 1;
        queue.push(nx, ny);
      }
    }
  }
  let maxDist = 0;
  for (const d of dist) if (d > maxDist) maxDist = d;

  const cells = [];
  for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) cells.push({ x, y, d: dist[at(x, y)] });

  return { seed, W, H, grid, exit, isWall, dist, maxDist, cells, distAt: (x, y) => dist[at(x, y)] };
}

const tileDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Spawns iniciales justos: misma distancia (aprox.) a la salida y lejos entre sí. Determinista. */
export function pickFairSpawns(maze) {
  const rand = mulberry32(maze.seed ^ 0x9e3779b9);
  const far = maze.cells.filter((c) => c.d >= maze.maxDist * 0.6);
  const pool = far.length >= 2 ? far : maze.cells;
  const a = pool[Math.floor(rand() * pool.length)];
  const candidates = pool
    .filter((c) => c !== a && Math.abs(c.d - a.d) <= 4 && tileDist(c, a) >= maze.W / 3)
    .sort((p, q) => Math.abs(p.d - a.d) - Math.abs(q.d - a.d));
  const b = candidates.length
    ? candidates[Math.floor(rand() * Math.min(candidates.length, 5))]
    : pool.filter((c) => c !== a).sort((p, q) => tileDist(q, a) - tileDist(p, a))[0];
  return { host: a, guest: b };
}

/** Reaparición aleatoria: lejos de la salida y lejos del rival. */
export function pickRespawn(maze, opponentTile) {
  const ok = (minExit, minOpp) =>
    maze.cells.filter(
      (c) => c.d >= maze.maxDist * minExit && (!opponentTile || tileDist(c, opponentTile) >= minOpp)
    );
  const pool = [ok(0.5, 8), ok(0.35, 5), ok(0.2, 0), maze.cells].find((p) => p.length);
  return pool[Math.floor(Math.random() * pool.length)];
}
