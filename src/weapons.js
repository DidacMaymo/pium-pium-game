// Armas: daño, cadencia, dispersión y su modelo 3D. Para añadir un arma, añade una entrada aquí.
import * as THREE from 'three';

export const MAX_HP = 100;
export const HEADSHOT = 1.5; // multiplicador de daño a la cabeza

export const WEAPONS = {
  pistol: {
    name: 'Pistola', dmg: 34, cd: 0.28, auto: false, pellets: 1, spread: 0.006, range: 120,
    width: 0.025, pitch: 1.4, kick: 0.04, botAcc: 0.55,
  },
  smg: {
    name: 'Subfusil', dmg: 15, cd: 0.075, auto: true, pellets: 1, spread: 0.028, range: 60,
    width: 0.02, pitch: 1.8, kick: 0.015, botAcc: 0.4,
  },
  rifle: {
    name: 'Rifle', dmg: 24, cd: 0.12, auto: true, pellets: 1, spread: 0.01, range: 120,
    width: 0.03, pitch: 1.1, kick: 0.02, botAcc: 0.45,
  },
  shotgun: {
    name: 'Escopeta', dmg: 13, cd: 0.85, auto: false, pellets: 9, spread: 0.085, range: 28,
    width: 0.018, pitch: 0.6, kick: 0.09, botAcc: 0.6,
  },
  sniper: {
    name: 'Francotirador', dmg: 110, cd: 1.3, auto: false, pellets: 1, spread: 0.05, zoomSpread: 0, range: 200,
    zoom: 25, width: 0.06, pitch: 0.45, kick: 0.12, botAcc: 0.35, headshot: 2,
  },
  laser: {
    name: 'Láser', dmg: 100, cd: 0.4, auto: false, pellets: 1, spread: 0, range: 150,
    width: 0.04, pitch: 1, kick: 0.05, botAcc: 0.4,
  },
};

/** Teclas 1..6 */
export const LOADOUT = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'laser'];
/** Juego de armas: cada baja te sube de nivel; gana quien mata con la última. */
export const GUNGAME = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'laser'];

// Modelos: cajas simples con proporciones distintas por arma.
const SHAPES = {
  pistol: { body: [0.06, 0.08, 0.22], barrel: 0.1, color: 0x444455 },
  smg: { body: [0.07, 0.1, 0.32], barrel: 0.12, color: 0x335544, mag: true },
  rifle: { body: [0.06, 0.09, 0.5], barrel: 0.18, color: 0x554433, mag: true, stock: true },
  shotgun: { body: [0.09, 0.09, 0.46], barrel: 0.2, color: 0x663322, thick: true },
  sniper: { body: [0.06, 0.08, 0.6], barrel: 0.3, color: 0x223344, scope: true, stock: true },
  laser: { body: [0.06, 0.08, 0.34], barrel: 0.08, color: 0x333344 },
};

/** Devuelve { group, tip, length } — `tip` es la boca del cañón (se colorea con el color del jugador). */
export function makeGunModel(id, color = 0x33e0ff) {
  const s = SHAPES[id] ?? SHAPES.laser;
  const mat = new THREE.MeshStandardMaterial({ color: s.color, metalness: 0.6, roughness: 0.35 });
  const group = new THREE.Group();
  const [w, h, l] = s.body;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  group.add(body);
  const br = s.thick ? 0.03 : 0.018;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(br, br, s.barrel, 8).rotateX(Math.PI / 2), mat);
  barrel.position.z = -l / 2 - s.barrel / 2;
  group.add(barrel);
  if (s.mag) {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.12, 0.06), mat);
    mag.position.set(0, -h / 2 - 0.05, -l * 0.1);
    group.add(mag);
  }
  if (s.stock) {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 1.3, 0.16), mat);
    stock.position.set(0, -0.01, l / 2 + 0.06);
    group.add(stock);
  }
  if (s.scope) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 10).rotateX(Math.PI / 2), mat);
    scope.position.set(0, h / 2 + 0.035, -0.02);
    group.add(scope);
  }
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(br * 1.4, br * 1.4, 0.04, 8).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color })
  );
  const length = l / 2 + s.barrel;
  tip.position.z = -length;
  group.add(tip);
  return { group, tip, length };
}

export function disposeGroup(group) {
  group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
}
