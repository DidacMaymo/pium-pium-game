// Mapas deterministas a partir de una semilla: todos los jugadores generan el mismo mapa.
// Cada casilla tiene una altura: 0 = suelo, 0.7 = caja baja, 1.5 = caja alta, WALL = pared.

export const TILE = 3; // metros por casilla
export const WALL = Infinity;
export const LOW = 0.7;   // se sube con un salto normal
export const HIGH = 1.5;  // solo con doble salto

export const MAZE_SIZES = { facil: 6, media: 9, dificil: 12 };
export const MAZE_LABELS = { facil: 'Fácil', media: 'Media', dificil: 'Difícil' };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeMap(props) {
  const { W, H, h } = props;
  const map = {
    ...props,
    height: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? WALL : h[y * W + x]),
    isWall: (x, y) => map.height(x, y) === WALL,
  };
  return map;
}

/** Laberinto clásico. `cells` celdas lógicas por lado (6 fácil, 9 media, 12 difícil). */
export function generateMaze(seed, cells = 12, loopChance = 0.1) {
  const rand = mulberry32(seed);
  const cw = cells, ch = cells;
  const W = cw * 2 + 1, H = ch * 2 + 1;
  const h = new Float32Array(W * H).fill(WALL);
  const at = (x, y) => y * W + x;

  const visited = new Uint8Array(cw * ch);
  const start = [Math.floor(rand() * cw), Math.floor(rand() * ch)];
  const stack = [start];
  visited[start[1] * cw + start[0]] = 1;
  h[at(start[0] * 2 + 1, start[1] * 2 + 1)] = 0;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = DIRS.filter(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return nx >= 0 && ny >= 0 && nx < cw && ny < ch && !visited[ny * cw + nx];
    });
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy] = options[Math.floor(rand() * options.length)];
    const nx = cx + dx, ny = cy + dy;
    h[at(cx * 2 + 1 + dx, cy * 2 + 1 + dy)] = 0;
    h[at(nx * 2 + 1, ny * 2 + 1)] = 0;
    visited[ny * cw + nx] = 1;
    stack.push([nx, ny]);
  }

  // Bucles: rutas alternativas para persecuciones y emboscadas
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (h[at(x, y)] !== WALL) continue;
      const between = (x % 2 === 0 && y % 2 === 1) || (x % 2 === 1 && y % 2 === 0);
      if (between && rand() < loopChance) h[at(x, y)] = 0;
    }
  }

  // Salida en el borde exterior
  const side = Math.floor(rand() * 4);
  const ex = Math.floor(rand() * cw) * 2 + 1;
  const ey = Math.floor(rand() * ch) * 2 + 1;
  const exit =
    side === 0 ? { x: ex, y: 0 } :
    side === 1 ? { x: W - 1, y: ey } :
    side === 2 ? { x: ex, y: H - 1 } :
                 { x: 0, y: ey };
  h[at(exit.x, exit.y)] = 0;

  // Distancia (pasos) de cada casilla a la salida
  const dist = new Int32Array(W * H).fill(-1);
  const queue = [exit.x, exit.y];
  dist[at(exit.x, exit.y)] = 0;
  for (let i = 0; i < queue.length; i += 2) {
    const x = queue[i], y = queue[i + 1];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (h[at(nx, ny)] !== WALL && dist[at(nx, ny)] === -1) {
        dist[at(nx, ny)] = dist[at(x, y)] + 1;
        queue.push(nx, ny);
      }
    }
  }
  let maxDist = 0;
  for (const d of dist) if (d > maxDist) maxDist = d;

  const cellList = [];
  for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) cellList.push({ x, y, d: dist[at(x, y)] });

  return makeMap({
    kind: 'maze', seed, W, H, h, exit, maxDist, cells: cellList,
    wallH: 4, ceiling: true,
    distAt: (x, y) => dist[at(x, y)],
  });
}

/** Arena pequeña para todos contra todos: pilares y cajas con simetría 4x (justa para todos). */
export function generateArena(seed, size = 13) {
  const W = size, H = size, half = (size - 1) / 2;
  const at = (x, y) => y * W + x;
  const spawns = [
    { x: 1, y: 1 }, { x: W - 2, y: H - 2 }, { x: W - 2, y: 1 }, { x: 1, y: H - 2 },
    { x: half, y: 1 }, { x: half, y: H - 2 }, { x: 1, y: half }, { x: W - 2, y: half },
  ];
  const reserved = new Set();
  for (const s of spawns) reserved.add(at(s.x, s.y));
  reserved.add(at(half, half));

  let h;
  for (let attempt = 0; attempt < 40; attempt++) {
    const rand = mulberry32(seed + attempt * 7919);
    h = new Float32Array(W * H).fill(0);
    for (let i = 0; i < W; i++) {
      h[at(i, 0)] = h[at(i, H - 1)] = h[at(0, i)] = h[at(W - 1, i)] = WALL;
    }
    for (let y = 1; y <= half; y++) {
      for (let x = 1; x <= half; x++) {
        if (x <= 2 && y <= 2) continue; // esquina de spawn despejada
        const r = rand();
        const v = r < 0.1 ? WALL : r < 0.18 ? HIGH : r < 0.32 ? LOW : 0;
        for (const [mx, my] of [[x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]]) {
          if (!reserved.has(at(mx, my))) h[at(mx, my)] = v;
        }
      }
    }
    // Comprobar que todo lo transitable (suelo y cajas bajas) está conectado
    const ok = (x, y) => h[at(x, y)] <= LOW;
    let total = 0;
    for (let i = 0; i < h.length; i++) if (h[i] <= LOW) total++;
    const seen = new Uint8Array(W * H);
    const q = [1, 1];
    seen[at(1, 1)] = 1;
    for (let i = 0; i < q.length; i += 2) {
      for (const [dx, dy] of DIRS) {
        const nx = q[i] + dx, ny = q[i + 1] + dy;
        if (ok(nx, ny) && !seen[at(nx, ny)]) { seen[at(nx, ny)] = 1; q.push(nx, ny); }
      }
    }
    if (q.length / 2 === total) break;
  }

  const cells = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (h[at(x, y)] === 0) cells.push({ x, y });

  return makeMap({ kind: 'arena', seed, W, H, h, exit: null, cells, spawns, wallH: 5, ceiling: false });
}
