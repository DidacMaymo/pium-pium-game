// Comprueba si cada nivel de parkour se puede completar con la física del juego.
// Uso: npm run check-parkour  (ejecútalo después de editar PARKOUR_LEVELS en src/mapdefs.js)
const m = await import('../src/maps.js');
const T = 3, SIZE = T * 0.96, R = 0.245, G = 20, V = 6.2, SPD = 5.5;
const apex = (V * V) / (2 * G); // 0.961
function landTime(dh, dbl) { // tiempo hasta caer a altura dh (rama descendente)
  if (!dbl) { const d = V * V - 2 * G * dh; return d < 0 ? null : (V + Math.sqrt(d)) / G; }
  const t1 = V / G; const d = V * V + 2 * G * (apex - dh); return d < 0 ? null : t1 + (V + Math.sqrt(d)) / G;
}
function reach(dh, power) {
  const dbl = power.includes('jump');
  const spd = power.includes('hyper') ? SPD * 2 : SPD;
  const t = landTime(dh, dbl);
  return t == null ? -1 : spd * t * 0.85; // 15% de margen
}
const { PARKOUR_LEVELS } = await import('../src/mapdefs.js');
let bad = 0;
for (let L = 0; L < PARKOUR_LEVELS.length; L++) {
  const map = m.buildParkour(L, 1);
  // nodos: plataformas estáticas + posiciones de móviles
  const nodes = [];
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    const hh = map.height(x, y); if (hh > m.LAVA) nodes.push({ x: x * T, z: y * T, hmin: hh, hmax: hh, tag: `${x},${y}` });
  }
  for (const mv of map.movers) {
    if (mv.type === 'piston') nodes.push({ x: mv.x * T, z: mv.y * T, hmin: mv.h0, hmax: mv.h1, tag: `piston ${mv.x},${mv.y}` });
    else for (const o of [-1, 0, 1]) nodes.push({ x: mv.x * T + (mv.axis === 'x' ? o * T : 0), z: mv.y * T + (mv.axis === 'z' ? o * T : 0), hmin: mv.y1, hmax: mv.y1, tag: `mover ${mv.x},${mv.y} off ${o}`, mover: `${mv.x},${mv.y}` });
  }
  const puAt = Object.fromEntries(map.localPowerups.map(p => [`${p.x},${p.y}`, p.type]));
  const idx = (tag) => nodes.findIndex(n => n.tag === tag);
  const start = idx(`${map.start.x},${map.start.y}`), fin = idx(`${map.finish.x},${map.finish.y}`);
  // BFS sobre (nodo, power) — el power-up dura lo suficiente para 2-3 saltos
  const key = (i, p) => i + '|' + p;
  const seen = new Map([[key(start, ''), null]]); const q = [[start, '']];
  let ok = false;
  while (q.length) {
    const [i, p] = q.shift(); if (i === fin) { ok = true; break; }
    const a = nodes[i];
    const pw = puAt[a.tag] ? puAt[a.tag] : p;
    for (let j = 0; j < nodes.length; j++) if (j !== i) {
      const b = nodes[j];
      // los nodos de un mismo móvil están conectados (te lleva)
      if (a.mover && a.mover === b.mover) { if (!seen.has(key(j, pw))) { seen.set(key(j, pw), i); q.push([j, pw]); } continue; }
      const gx = Math.max(0, Math.abs(a.x - b.x) - SIZE), gz = Math.max(0, Math.abs(a.z - b.z) - SIZE);
      const gap = Math.max(0, Math.hypot(gx, gz) - 2 * R);
      let can = false;
      for (const ha of [a.hmin, a.hmax]) for (const hb of [b.hmin, b.hmax]) {
        const dh = hb - ha;
        if (gap === 0 ? dh <= (pw.includes('jump') ? 1.85 : 0.9) : reach(dh, pw) >= gap) can = true;
      }
      if (can && !seen.has(key(j, pw))) { seen.set(key(j, pw), i); q.push([j, pw]); }
    }
  }
  console.log(map.name, ok ? 'SUPERABLE' : 'IMPOSIBLE');
  if (!ok) bad++;
  if (!ok) {
    const reached = new Set([...seen.keys()].map(k => nodes[+k.split('|')[0]].tag));
    console.log('  alcanzado:', [...reached].join(' ; '));
  }
}
process.exit(bad ? 1 : 0);
