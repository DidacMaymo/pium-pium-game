// Mapas: laberinto y arena aleatoria (deterministas a partir de una semilla) y mapas dibujados
// en texto (mapdefs.js). Cada casilla tiene una altura: 0 = suelo, 0.7 = caja baja,
// 1.5 = caja alta, WALL = pared, LAVA = lava (parkour). Además puede haber objetos móviles.
import { ARENA_MAPS, TRAINING_MAP, PARKOUR_LEVELS, ZOMBIE_MAP, ZOMBIE_LEGEND } from './mapdefs.js';

export const TILE = 3; // metros por casilla
export const WALL = Infinity;
export const LOW = 0.7;   // se sube con un salto normal
export const HIGH = 1.5;  // solo con doble salto
export const LAVA = -2;   // suelo de lava del parkour (caer = volver al checkpoint)

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
    base: 0, lava: false, movers: [], barrels: [], navBlocked: new Set(),
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

  return makeMap({ kind: 'arena', seed, W, H, h, exit: null, cells, spawns, wallH: 5, ceiling: false, name: 'Aleatoria' });
}

// ---------- Mapas en texto ----------

const ARENA_CHARS = { '#': WALL, '.': 0, b: LOW, B: HIGH, S: 0, X: 0, E: 0, H: 0, V: 0 };

/** Posición/caja de un objeto móvil en el instante t (s desde el inicio de la ronda). Determinista. */
export function moverBox(m, t) {
  const k = (2 * Math.PI * t) / m.period + m.phase;
  const half = (TILE * 0.96) / 2;
  if (m.type === 'piston') {
    const top = m.h0 + (m.h1 - m.h0) * (0.5 - 0.5 * Math.cos(k));
    return { cx: m.x * TILE, cz: m.y * TILE, hx: half, hz: half, y0: m.base, y1: top };
  }
  const off = m.amp * Math.sin(k);
  return {
    cx: m.x * TILE + (m.axis === 'x' ? off : 0),
    cz: m.y * TILE + (m.axis === 'z' ? off : 0),
    hx: m.axis === 'x' ? half : half * 0.4,
    hz: m.axis === 'z' ? half : half * 0.4,
    y0: m.y0, y1: m.y1,
  };
}

function parseRows(rows, legend) {
  const H = rows.length;
  const W = Math.max(...rows.map((r) => r.length));
  const h = new Float32Array(W * H);
  const tags = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x] ?? ' ';
      const v = legend(ch);
      if (v === undefined) throw new Error(`Carácter desconocido '${ch}' en (${x},${y})`);
      h[y * W + x] = v;
      if (!'#. 123456789b'.includes(ch) || (ch === 'b' && legend === parkourLegend)) tags.push({ ch, x, y });
    }
  }
  return { W, H, h, tags };
}

function arenaLegend(ch) { return ARENA_CHARS[ch]; }

function buildFromRows(def, kind, seed) {
  const { W, H, h, tags } = parseRows(def.rows, arenaLegend);
  const map = { kind, seed, W, H, h, exit: null, wallH: 5, ceiling: false, name: def.name };
  map.spawns = [];
  map.movers = [];
  map.barrels = [];
  map.navBlocked = new Set();
  let nb = 0;
  for (const { ch, x, y } of tags) {
    const phase = (x * 7 + y * 13) % 10;
    if (ch === 'S') map.spawns.push({ x, y });
    else if (ch === 'X') map.barrels.push({ id: `x-${nb++}`, x, y });
    else if (ch === 'E') {
      map.movers.push({ type: 'piston', x, y, base: 0, h0: 0.2, h1: 2.6, period: 6, phase });
      map.navBlocked.add(y * W + x);
    } else if (ch === 'H' || ch === 'V') {
      const axis = ch === 'H' ? 'x' : 'z';
      map.movers.push({ type: 'slide', x, y, axis, amp: TILE, y0: 0, y1: 2.2, period: 5, phase });
      for (const d of [-1, 0, 1]) map.navBlocked.add(axis === 'x' ? y * W + x + d : (y + d) * W + x);
    }
  }
  const barrelSet = new Set(map.barrels.map((b) => b.y * W + b.x));
  map.cells = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (h[i] === 0 && !map.navBlocked.has(i) && !barrelSet.has(i)) map.cells.push({ x, y });
  }
  if (!map.spawns.length) map.spawns = map.cells.slice(0, 4);
  return makeMap(map);
}

export function buildArena(mapId, seed) {
  const def = ARENA_MAPS[mapId] ?? ARENA_MAPS.aleatoria;
  if (def.procedural) return generateArena(seed);
  return buildFromRows(def, 'arena', seed);
}

export function buildTraining(seed) {
  return buildFromRows(TRAINING_MAP, 'training', seed);
}

/**
 * Mapa de zombis: el dibujo de ZOMBIE_MAP. Las puertas cerradas, las ventanas y los objetos
 * bloquean el paso de los zombis (navBlocked); map.cells son solo las casillas alcanzables.
 */
export function buildZombies(seed) {
  const def = ZOMBIE_MAP;
  const { weapons, machines } = ZOMBIE_LEGEND;
  const H = def.rows.length, W = def.rows[0].length;
  const h = new Float32Array(W * H);
  const at = (x, y) => y * W + x;
  const map = {
    kind: 'zombies', seed, W, H, h, exit: null, wallH: 4, ceiling: true, name: def.name,
    spawns: [], barrels: [], movers: [], doors: [], windows: [], wallBuys: [], props: [],
    navBlocked: new Set(), sightBlocked: new Set(),
  };
  let nb = 0;
  for (let y = 0; y < H; y++) {
    const row = def.rows[y];
    if (row.length !== W) throw new Error(`Fila ${y} de ${row.length} casillas (deberían ser ${W})`);
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      const i = at(x, y);
      if (ch === '#') h[i] = WALL;
      else if (ch === 'S') map.spawns.push({ x, y });
      else if (ch === 'X') map.barrels.push({ id: `x-${nb++}`, x, y });
      else if (def.doors[ch] !== undefined) {
        map.doors.push({ id: ch, x, y, cost: def.doors[ch] });
        map.navBlocked.add(i);
        map.sightBlocked.add(i);
      } else if (ch === 'w' || ch === 'g') {
        map.windows.push({ id: `w-${map.windows.length}`, x, y, tall: ch === 'g' });
        map.navBlocked.add(i);
        map.sightBlocked.add(i);
      } else if (weapons[ch]) {
        h[i] = WALL;
        map.wallBuys.push({ id: `arma-${map.wallBuys.length}`, x, y, weapon: weapons[ch] });
      } else if ('PMACG'.includes(ch) || machines[ch]) {
        const kind = { P: 'power', M: 'box', A: 'ammo', C: 'carpenter', G: 'grenades' }[ch] ?? 'machine';
        map.props.push({ kind, id: `${kind}-${map.props.length}`, x, y, item: machines[ch] });
        map.navBlocked.add(i);
      } else if (ch !== '.') throw new Error(`Carácter desconocido '${ch}' en (${x},${y})`);
    }
  }
  const floor = (x, y) => x >= 0 && y >= 0 && x < W && y < H && h[at(x, y)] === 0 && !map.navBlocked.has(at(x, y));
  const neighbours = (o) => DIRS.map(([dx, dy]) => ({ dx, dy })).filter(({ dx, dy }) => floor(o.x + dx, o.y + dy));
  for (const w of map.windows) {
    const n = neighbours(w)[0];
    if (!n) throw new Error(`La ventana ${w.id} no da a ningún suelo`);
    w.in = { x: w.x + n.dx, y: w.y + n.dy };
  }
  for (const b of map.wallBuys) {
    const n = neighbours(b)[0];
    if (!n) throw new Error(`El arma de pared en (${b.x},${b.y}) no da a ningún suelo`);
    b.face = n;
  }
  for (const p of map.props) {
    // mira hacia el lado contrario a la pared que tiene detrás
    const wall = DIRS.find(([dx, dy]) => def.rows[p.y + dy]?.[p.x + dx] === '#');
    p.face = wall ? { dx: -wall[0], dy: -wall[1] } : { dx: 0, dy: 1 };
  }
  map.barrelTiles = new Set(map.barrels.map((b) => at(b.x, b.y)));
  const built = makeMap(map);
  applyDoors(built, []);
  return built;
}

/**
 * Abre las puertas indicadas y recalcula map.cells: las casillas de suelo a las que se puede
 * llegar desde el spawn. Los spawns, la reaparición y las ventanas activas dependen de eso.
 */
export function applyDoors(map, openIds) {
  const { W, H } = map;
  const open = new Set(openIds);
  for (const d of map.doors) {
    const i = d.y * W + d.x;
    if (open.has(d.id)) { map.navBlocked.delete(i); map.sightBlocked.delete(i); }
  }
  const seen = new Uint8Array(W * H);
  const q = [];
  for (const s of map.spawns) { seen[s.y * W + s.x] = 1; q.push(s); }
  map.cells = [];
  for (let k = 0; k < q.length; k++) {
    const { x, y } = q[k];
    if (map.height(x, y) === 0 && !map.barrelTiles.has(y * W + x)) map.cells.push({ x, y });
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx;
      if (seen[i] || map.height(nx, ny) >= HIGH || map.navBlocked.has(i)) continue;
      seen[i] = 1;
      q.push({ x: nx, y: ny });
    }
  }
}

function parkourLegend(ch) {
  if (ch === ' ') return LAVA;
  if (ch === '#') return WALL; // niveles dentro de edificios
  if (ch >= '1' && ch <= '9') return Number(ch) * 0.5;
  if (ch >= 'a' && ch <= 'i') return (ch.charCodeAt(0) - 96) * 0.5; // checkpoint
  if ('SFJZEMN'.includes(ch)) return 0; // se corrige con la definición del nivel
  return undefined;
}

export function buildParkour(levelIdx, seed) {
  const def = PARKOUR_LEVELS[levelIdx] ?? PARKOUR_LEVELS[0];
  const { W, H, h, tags } = parseRows(def.rows, parkourLegend);
  const map = {
    kind: 'parkour', seed, W, H, h, exit: null, wallH: def.wallH ?? 12, ceiling: !!def.wallH, name: def.name, startYaw: def.startYaw ?? 0,
    base: LAVA, lava: true, movers: [], barrels: [], checkpoints: [], localPowerups: [], spawns: [],
  };
  let npu = 0;
  for (const { ch, x, y } of tags) {
    const i = y * W + x;
    const phase = (x * 7 + y * 13) % 10;
    if (ch === 'S') { h[i] = def.startH * 0.5; map.start = { x, y }; map.spawns.push({ x, y }); }
    else if (ch === 'F') { h[i] = def.finishH * 0.5; map.finish = { x, y }; }
    else if (ch >= 'a' && ch <= 'i') map.checkpoints.push({ x, y, h: h[i] });
    else if (ch === 'J' || ch === 'Z') {
      h[i] = def.puH * 0.5;
      map.localPowerups.push({ id: 1000 + npu++, type: ch === 'J' ? 'jump' : 'hyper', x, y });
    } else if (ch === 'E') {
      h[i] = LAVA;
      map.movers.push({ type: 'piston', x, y, base: LAVA, h0: 0.25, h1: def.pistonMax ?? 3, period: 5, phase });
    } else if (ch === 'M' || ch === 'N') {
      h[i] = LAVA;
      const top = def.moverH * 0.5;
      map.movers.push({ type: 'slide', x, y, axis: ch === 'M' ? 'x' : 'z', amp: TILE, y0: top - 0.5, y1: top, period: 4, phase });
    }
  }
  map.cells = [map.start];
  return makeMap(map);
}

export function mapCount(kind) {
  return kind === 'parkour' ? PARKOUR_LEVELS.length : Object.keys(ARENA_MAPS).length;
}
