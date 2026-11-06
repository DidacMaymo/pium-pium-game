// Mapas dibujados a mano en texto. ¡Haz los tuyos! Cada carácter es una casilla de 3x3 m.
//
// ARENA / ENTRENAMIENTO
//   #  pared            .  suelo           b  caja baja (salto)   B  caja alta (doble salto)
//   S  spawn            X  barril explosivo
//   E  pistón (sube y baja, te eleva)      H / V  muro deslizante (en eje X / Z)
//
// PARKOUR (todo lo vacío es lava)
//   espacio  lava       1-9  plataforma de altura N x 0.5 m
//   S  salida           F  meta            a-i  checkpoint de altura 1-9
//   E  pistón           M / N  plataforma móvil (eje X / Z) a altura `moverH`
//   J  power-up doble salto   Z  power-up hipervelocidad   (en plataforma de altura `puH`)
//   #  pared (niveles dentro de edificios: con `wallH` el nivel tiene techo a esa altura en metros;
//      `startYaw` es hacia dónde miras al salir: 0 arriba, Math.PI / 2 izquierda, -Math.PI / 2 derecha)

// ZOMBIS (ver ZOMBIE_MAP; sin cajas: los zombis deben poder llegar a cualquier sitio)
//   #  pared o pilar    .  suelo   S  spawn   X  barril
//   1-9, D  puerta (precio en `doors`)
//   w  ventana con tablas   g  puerta de servicio con tablas (por ahí entran los zombis)
//   p s r e f l  arma en la pared: pistola, subfusil, rifle, escopeta, francotirador, láser
//   P  electricidad   M  caja misteriosa   A  munición   C  carpintero   G  granadas
//   J T Q V H K R Y  máquinas (ver ZOMBIE_LEGEND.machines)

export const ZOMBIE_LEGEND = {
  weapons: { p: 'pistol', s: 'smg', r: 'rifle', e: 'shotgun', f: 'sniper', l: 'laser' },
  machines: { J: 'armor', T: 'doubletap', Q: 'revive', V: 'secondlife', H: 'punch', K: 'pap', R: 'fastreload', Y: 'medkit' },
};

export const ZOMBIE_MAP = {
  name: 'Búnker',
  doors: { 1: 750, 2: 750, 3: 750, 4: 1000, 5: 1000, 6: 1250, 7: 1000, 8: 1000, 9: 1500, D: 1500 },
  rows: [
    '####w###w######w##f##g######w#l##w###',
    '#.P........#.J..T...H....#K.........#',
    '#..........#.............#..........#',
    'w....#.....#...#.....#...#.....#....w',
    '#..........#.............#..........#',
    '#.....#....#.............#....#.....#',
    'g..........#...#.....#...#..........g',
    '#..........#.............#..........#',
    '#####9############6###########D######',
    '#Q.........#.............#.........V#',
    'w..........#.A.........#.#..........w',
    '#...#......#...#.....#...#......#...#',
    '#..........#.............#..........#',
    'g..........7......M......8..........g',
    '#..........#.............#..........#',
    '#...#......#...#.....#...#......#...#',
    'w..........#.#.........#.#..........w',
    '#..........#.............#.........R#',
    '#####4############1###########5######',
    '#..........#.............#..........#',
    'w..........#.............#..........w',
    '#...#......#.............#......#...#',
    '#..........2...S.S.S.....3..........#',
    'g..........#.............#..........g',
    '#...X......#..S.S.S.S.S..#......X...#',
    '#..........#C..........GY#..........#',
    '###w#e##w#####w#p#s#w#g#####w##r#w###',
  ],
};

export const ARENA_MAPS = {
  aleatoria:{ name: 'Aleatoria', procedural: true },
  coliseo: {
    name: 'Coliseo',
    rows: [
      '###############',
      '#S...b.S.b...S#',
      '#.##.......##.#',
      '#.#....X....#.#',
      '#.....B.B.....#',
      '#b..BB...BB..b#',
      '#...B.....B...#',
      '#SX.....E...XS#',
      '#...B.....B...#',
      '#b..BB...BB..b#',
      '#.....B.B.....#',
      '#.#....X....#.#',
      '#.##.......##.#',
      '#S...b.S.b...S#',
      '###############',
    ],
  },
  torres: {
    name: 'Torres',
    rows: [
      '###############',
      '#S.....S.....S#',
      '#.BBB.....BBB.#',
      '#.B.E.....E.B.#',
      '#.B...b.b...B.#',
      '#.....b.b.....#',
      '#..bb.....bb..#',
      '#S...X.H.X...S#',
      '#..bb.....bb..#',
      '#.....b.b.....#',
      '#.B...b.b...B.#',
      '#.B.E.....E.B.#',
      '#.BBB.....BBB.#',
      '#S.....S.....S#',
      '###############',
    ],
  },
  pasillos: {
    name: 'Pasillos',
    rows: [
      '###############',
      '#S..#.....#..S#',
      '#.#.#.###.#.#.#',
      '#.#...#S#...#.#',
      '#.###.#.#.###.#',
      '#..H.......H..#',
      '###.#.....#.###',
      '#S..X..E..X..S#',
      '###.#.....#.###',
      '#..H.......H..#',
      '#.###.#.#.###.#',
      '#.#...#S#...#.#',
      '#.#.#.###.#.#.#',
      '#S..#.....#..S#',
      '###############',
    ],
  },
};

export const TRAINING_MAP = {
  name: 'Campo de tiro',
  rows: [
    '###########',
    '#.........#',
    '#.........#',
    '#..B...B..#',
    '#.........#',
    '#.........#',
    '#.........#',
    '#..b...b..#',
    '#.........#',
    '#.........#',
    '#.........#',
    '#.........#',
    '#...X.X...#',
    '#.........#',
    '#.........#',
    '#....S....#',
    '###########',
  ],
};

export const PARKOUR_LEVELS = [
  {
    name: '1 · Calentamiento',
    startH: 1, finishH: 4, moverH: 3, puH: 2,
    rows: [
      '         ',
      '    F    ',
      '    4    ',
      '    d    ',
      '   3 3   ',
      '  3   3  ',
      '  2   2  ',
      '  c   c  ',
      '   2 2   ',
      '    2    ',
      '   1 1   ',
      '  1   1  ',
      '  b   1  ',
      '   1 1   ',
      '    1    ',
      '    S    ',
      '         ',
    ],
  },
  {
    name: '2 · Lava saltarina',
    startH: 1, finishH: 6, moverH: 4, puH: 3, pistonMax: 3,
    rows: [
      '         ',
      '    F    ',
      '    6    ',
      '         ',
      '    6    ',
      '    5    ',
      '    E    ',
      '  4 d 4  ',
      '    4    ',
      '         ',
      '         ',
      '    N    ',
      '         ',
      '    4    ',
      '  3 J 3  ',
      '    2    ',
      '         ',
      '    c    ',
      '   2 2   ',
      '    1    ',
      '         ',
      '    S    ',
      '         ',
    ],
  },
  {
    name: '3 · Pesadilla',
    startH: 2, finishH: 8, moverH: 6, puH: 6, pistonMax: 3.5,
    rows: [
      '         ',
      '    F    ',
      '    8    ',
      '    E    ',
      '    g    ',
      '         ',
      '    6    ',
      '    J    ',
      '         ',
      '         ',
      '    N    ',
      '         ',
      '    6    ',
      '    f    ',
      '    5    ',
      '         ',
      '         ',
      '    5    ',
      '    Z    ',
      '    5    ',
      '   4     ',
      '    3    ',
      '    E    ',
      '    2    ',
      '         ',
      '    S    ',
      '         ',
    ],
  },
  {
    name: '4 · Almacén (edificio)',
    startH: 1, finishH: 8, moverH: 4, puH: 2, pistonMax: 3.5, wallH: 7.5, startYaw: -Math.PI / 2,
    rows: [
      '#############',
      '###########F#',
      '#5 5 E 77 78#',
      '#e###########',
      '#44 M 4 43 3#',
      '###########c#',
      '#S 1 12 2 23#',
      '#############',
    ],
  },
  {
    name: '5 · Torre de oficinas (edificio)',
    startH: 1, finishH: 8, moverH: 4, puH: 2, pistonMax: 3.5, wallH: 7.5, startYaw: Math.PI / 2,
    rows: [
      '###########',
      '# 4 45 E 6#',
      '#4       6#',
      '#3 #####  #',
      '#  ##### 6#',
      '#c ##### f#',
      '#2 #####  #',
      '#  ##### 6#',
      '#2       7#',
      '# 21 S F7 #',
      '###########',
    ],
  },
  {
    name: '6 · Hospital (edificio, difícil)',
    startH: 1, finishH: 5, moverH: 4, puH: 2, wallH: 8, startYaw: Math.PI / 2,
    rows: [
      '#############',
      '#6 Z  23 34F#',
      '#f###########',
      '#65 5 5     #',
      '######e######',
      '#     J1 1 S#',
      '#############',
    ],
  },
  {
    name: '7 · Sótano (edificio, difícil)',
    startH: 2, finishH: 7, moverH: 2, puH: 2, pistonMax: 3, wallH: 6.5, startYaw: -Math.PI / 2,
    rows: [
      '###############',
      '#F 76 E 54 E 3#',
      '#############c#',
      '#S 2  M  23 33#',
      '###############',
    ],
  },
];
