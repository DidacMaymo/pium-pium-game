// Minimapa. En zombis se va descubriendo lo que ves y muestra compañeros y zombis a la vista.
// En arena y juego de armas se ve todo el mapa pero no los rivales: solo un punto rojo donde disparan.
import { TILE, WALL, HIGH } from './maps.js';

export const MINIMAP_MODES = { zombies: 'fog', arena: 'full', gungame: 'full' };
export const SHOT_MS = 2200;

const SIGHT_TILES = 11;
const RAYS = 72;
const COLORS = {
  floor: '#2a2340', wall: '#6a5aa8', hidden: '#08060f', crate: '#4a3a70', door: '#ffd23d', window: '#a0703a',
  machine: '#3dff7a', box: '#3080ff', power: '#33e0ff', other: '#ffa01f', ally: '#33e0ff', foe: '#ff3d3d', me: '#ffffff',
};

/** Marca en `seen` (Set de índices de casilla) lo que se ve desde una posición de mundo. */
export function revealFrom(map, seen, wx, wz) {
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    for (let d = 0; d <= SIGHT_TILES * TILE; d += 0.75) {
      const tx = Math.round((wx + dx * d) / TILE), ty = Math.round((wz + dz * d) / TILE);
      if (tx < 0 || ty < 0 || tx >= map.W || ty >= map.H) break;
      const idx = ty * map.W + tx;
      seen.add(idx);
      if (map.height(tx, ty) >= HIGH || map.sightBlocked?.has(idx)) break;
    }
  }
}

/** Disparos recientes (los más viejos desaparecen). */
export function liveShots(shots, now) {
  return shots.filter((s) => now - s.t < SHOT_MS);
}

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;
    this.map = null;
    this.seen = new Set();
    this.shots = [];
  }

  start(map, mode) {
    const kind = MINIMAP_MODES[mode];
    this.active = !!kind;
    this.fog = kind === 'fog';
    this.canvas.hidden = !this.active;
    if (!this.active) return;
    this.map = map;
    this.seen = new Set();
    this.shots = [];
    this.scale = Math.max(3, Math.floor(190 / Math.max(map.W, map.H)));
    this.canvas.width = map.W * this.scale;
    this.canvas.height = map.H * this.scale;
  }

  stop() {
    this.active = false;
    this.canvas.hidden = true;
  }

  /** Alguien ha disparado aquí (coordenadas de mundo). */
  shot(x, z, now = performance.now()) {
    if (this.active && !this.fog) this.shots.push({ x, z, t: now });
  }

  #tile(g, x, y, color, inset = 0) {
    const s = this.scale;
    g.fillStyle = color;
    g.fillRect(x * s + inset, y * s + inset, s - inset * 2, s - inset * 2);
  }

  #dot(g, wx, wz, color, r) {
    const s = this.scale / TILE;
    g.fillStyle = color;
    g.beginPath();
    g.arc((wx + TILE / 2) * s, (wz + TILE / 2) * s, r, 0, 7);
    g.fill();
  }

  /** me: { x, z, yaw }, allies / foes: [{ x, z }] en mundo, zw: mundo zombi (o null). */
  render({ me, allies = [], foes = [], zw = null, now = performance.now() }) {
    if (!this.active) return;
    const g = this.canvas.getContext('2d');
    const { map, seen, fog } = this;
    if (fog) revealFrom(map, seen, me.x, me.z);
    const known = (x, y) => !fog || seen.has(y * map.W + x);
    const onKnown = (o) => known(Math.round(o.x / TILE), Math.round(o.z / TILE));

    for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
      const h = map.height(x, y);
      if (!known(x, y)) this.#tile(g, x, y, COLORS.hidden);
      else this.#tile(g, x, y, h === WALL ? COLORS.wall : h > 0 ? COLORS.crate : COLORS.floor);
    }
    for (const w of map.windows ?? []) if (known(w.x, w.y)) this.#tile(g, w.x, w.y, COLORS.window);
    for (const d of map.doors ?? []) {
      if (known(d.x, d.y) && !zw?.doors.includes(d.id)) this.#tile(g, d.x, d.y, COLORS.door);
    }
    for (const b of map.wallBuys ?? []) if (known(b.x, b.y)) this.#tile(g, b.x, b.y, COLORS.other, 1);
    for (const p of map.props ?? []) {
      if (!known(p.x, p.y)) continue;
      const c = p.kind === 'machine' ? COLORS.machine : p.kind === 'box' ? COLORS.box : p.kind === 'power' ? COLORS.power : COLORS.other;
      this.#tile(g, p.x, p.y, c, 1);
    }

    for (const f of foes) if (onKnown(f)) this.#dot(g, f.x, f.z, COLORS.foe, Math.max(2, this.scale * 0.35));
    for (const a of allies) this.#dot(g, a.x, a.z, COLORS.ally, Math.max(2, this.scale * 0.4));

    this.shots = liveShots(this.shots, now);
    for (const s of this.shots) {
      const k = 1 - (now - s.t) / SHOT_MS;
      g.globalAlpha = Math.max(0.15, k);
      this.#dot(g, s.x, s.z, COLORS.foe, this.scale * (0.5 + (1 - k)));
      g.globalAlpha = 1;
    }

    // Yo: flecha hacia donde miro (el norte del mapa es -z)
    const s = this.scale / TILE;
    const cx = (me.x + TILE / 2) * s, cy = (me.z + TILE / 2) * s;
    const fx = -Math.sin(me.yaw), fy = -Math.cos(me.yaw);
    const size = Math.max(5, this.scale * 0.8);
    g.fillStyle = COLORS.me;
    g.beginPath();
    g.moveTo(cx + fx * size, cy + fy * size);
    g.lineTo(cx - fx * size * 0.6 - fy * size * 0.6, cy - fy * size * 0.6 + fx * size * 0.6);
    g.lineTo(cx - fx * size * 0.6 + fy * size * 0.6, cy - fy * size * 0.6 - fx * size * 0.6);
    g.closePath();
    g.fill();
  }
}
