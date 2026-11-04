// Comprueba que cada nivel de parkour se puede completar con la física del juego.
// Uso: npm run check-parkour  (después de editar PARKOUR_LEVELS en src/mapdefs.js)
import { buildParkour } from '../src/maps.js';
import { PARKOUR_LEVELS } from '../src/mapdefs.js';
import { checkParkour } from '../src/parkourCheck.js';

let bad = 0;
PARKOUR_LEVELS.forEach((_, i) => {
  const map = buildParkour(i, 1);
  const { ok, reached } = checkParkour(map);
  console.log(`${map.name}: ${ok ? 'SUPERABLE' : 'IMPOSIBLE'}`);
  if (!ok) { bad++; console.log('  se llega hasta:', reached.join(' ; ')); }
});
process.exit(bad ? 1 : 0);
