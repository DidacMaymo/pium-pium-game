// Power-ups: definición, iconos dibujados en canvas (sin imágenes) y su modelo 3D flotante.
import * as THREE from 'three';

export const POWERUPS = {
  speed: { label: 'Turbo', color: '#ffd23d', duration: 8 },
  hyper: { label: 'HIPERVELOCIDAD x2', color: '#ff9a1f', duration: 5 },
  jump: { label: 'Doble salto', color: '#3dff7a', duration: 12 },
  auto: { label: 'Ráfaga', color: '#ff4a3d', duration: 8 },
  sniper: { label: 'Francotirador', color: '#4aa8ff', duration: 15 },
  medkit: { label: 'Botiquín', color: '#ff5a8a', duration: 0 },
};
export const POWERUP_TYPES = Object.keys(POWERUPS);
export const RESPAWN_MS = 12000;
export const MAX_SAME = 2; // nunca más de 2 del mismo tipo en el mapa

/** Qué power-ups salen en cada modo. */
export const MODE_POWERUPS = {
  maze: ['speed', 'hyper', 'jump', 'auto', 'sniper'],
  arena: ['speed', 'hyper', 'jump', 'auto', 'sniper', 'medkit'],
  gungame: ['speed', 'hyper', 'jump', 'medkit'], // sin armas extra: rompería la progresión
  zombies: ['speed', 'hyper', 'jump', 'auto', 'sniper', 'medkit'],
};

/**
 * Elige el siguiente tipo para que roten: entre los permitidos con menos copias en el mapa
 * (máx. MAX_SAME), evitando repetir el último que salió.
 */
export function pickPowerupType(mode, current, last) {
  const allowed = MODE_POWERUPS[mode] ?? POWERUP_TYPES;
  const count = (t) => current.filter((p) => p.type === t).length;
  let pool = allowed.filter((t) => count(t) < MAX_SAME);
  if (!pool.length) return null;
  const min = Math.min(...pool.map(count));
  pool = pool.filter((t) => count(t) === min);
  if (pool.length > 1) pool = pool.filter((t) => t !== last);
  return pool[Math.floor(Math.random() * pool.length)];
}

function drawIcon(g, type, s) {
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const c = s / 2;
  if (type === 'speed') {
    // rayo
    g.beginPath();
    g.moveTo(c + 6, c - 34); g.lineTo(c - 18, c + 4); g.lineTo(c - 2, c + 4);
    g.lineTo(c - 8, c + 34); g.lineTo(c + 18, c - 6); g.lineTo(c + 2, c - 6);
    g.closePath();
    g.fill();
  } else if (type === 'jump') {
    // doble flecha hacia arriba
    g.lineWidth = 9;
    for (const off of [-12, 10]) {
      g.beginPath();
      g.moveTo(c - 20, c + off + 12); g.lineTo(c, c + off - 8); g.lineTo(c + 20, c + off + 12);
      g.stroke();
    }
  } else if (type === 'hyper') {
    // dos rayos
    for (const dx of [-14, 14]) {
      g.beginPath();
      g.moveTo(c + dx + 4, c - 30); g.lineTo(c + dx - 13, c + 3); g.lineTo(c + dx - 1, c + 3);
      g.lineTo(c + dx - 6, c + 30); g.lineTo(c + dx + 13, c - 5); g.lineTo(c + dx + 1, c - 5);
      g.closePath();
      g.fill();
    }
  } else if (type === 'sniper') {
    // mira telescópica
    g.lineWidth = 7;
    g.beginPath(); g.arc(c, c, 24, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(c - 36, c); g.lineTo(c + 36, c); g.moveTo(c, c - 36); g.lineTo(c, c + 36); g.stroke();
  } else if (type === 'medkit') {
    // cruz
    g.fillRect(c - 9, c - 30, 18, 60);
    g.fillRect(c - 30, c - 9, 60, 18);
  } else if (type === 'auto') {
    // tres balas
    for (const dx of [-18, 0, 18]) {
      g.beginPath();
      g.roundRect(c + dx - 6, c - 18, 12, 34, [6, 6, 2, 2]);
      g.fill();
    }
    g.fillRect(c - 26, c + 20, 52, 6);
  }
}

const iconCache = {};
/** Canvas 128x128 con el icono sobre un círculo de color. Se reutiliza en el HUD. */
export function iconCanvas(type) {
  if (iconCache[type]) return iconCache[type];
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const color = POWERUPS[type].color;
  g.fillStyle = color;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#ffffffcc';
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); g.stroke();
  g.globalCompositeOperation = 'destination-out'; // icono "recortado" para que se vea el brillo detrás
  drawIcon(g, type, s);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 0.25;
  drawIcon(g, type, s);
  iconCache[type] = cv;
  return cv;
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

const matCache = {};
function materials(type) {
  if (matCache[type]) return matCache[type];
  const color = new THREE.Color(POWERUPS[type].color);
  const iconTex = new THREE.CanvasTexture(iconCanvas(type));
  iconTex.colorSpace = THREE.SRGBColorSpace;
  matCache[type] = {
    icon: new THREE.SpriteMaterial({ map: iconTex, depthWrite: false }),
    glow: new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    ring: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    beam: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  return matCache[type];
}

const ringGeo = new THREE.TorusGeometry(0.55, 0.035, 8, 40);
const beamGeo = new THREE.CylinderGeometry(0.35, 0.6, 2.4, 16, 1, true);

/** Modelo flotante. Sin luces reales (cambiar el nº de luces recompila shaders y da tirones). */
export function makePowerupMesh(type) {
  const m = materials(type);
  const group = new THREE.Group();
  const bob = new THREE.Group();
  const glow = new THREE.Sprite(m.glow);
  glow.scale.set(2.2, 2.2, 1);
  const icon = new THREE.Sprite(m.icon);
  icon.scale.set(1.0, 1.0, 1);
  const ring1 = new THREE.Mesh(ringGeo, m.ring);
  const ring2 = new THREE.Mesh(ringGeo, m.ring);
  ring2.scale.setScalar(0.8);
  bob.add(glow, icon, ring1, ring2);
  const beam = new THREE.Mesh(beamGeo, m.beam);
  beam.position.y = 1.2;
  group.add(bob, beam);
  group.userData = { bob, glow, ring1, ring2, phase: Math.random() * 10 };
  return group;
}

export function animatePowerup(group, t) {
  const { bob, glow, ring1, ring2, phase } = group.userData;
  const k = t + phase;
  bob.position.y = 1.1 + Math.sin(k * 2.2) * 0.18;
  ring1.rotation.set(k * 1.3, k * 0.9, 0);
  ring2.rotation.set(-k * 0.8, 0, k * 1.6);
  const pulse = 2.1 + Math.sin(k * 5) * 0.3;
  glow.scale.set(pulse, pulse, 1);
}
