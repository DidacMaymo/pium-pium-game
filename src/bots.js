// Bots y zombis. Solo los simula el host; los demás reciben sus posiciones por red.
import { TILE } from './maps.js';
import { hasLOS, pickRespawn } from './spawn.js';
import { WEAPONS, LOADOUT, MAX_HP } from './weapons.js';

export const BOT_SKILL = {
  facil: { label: 'Fácil', acc: 0.55, react: 750, cdMult: 1.7, speed: 0.8 },
  normal: { label: 'Normal', acc: 0.8, react: 450, cdMult: 1.25, speed: 0.92 },
  dificil: { label: 'Difícil', acc: 1.05, react: 250, cdMult: 1.0, speed: 1.0 },
};

const BOT_NAMES = ['Paco', 'Manolo', 'Lola', 'Pepa', 'Chema', 'Rafa', 'Nuria', 'Fermín', 'Loli', 'Toñi'];
const BOT_SPEED = 5;
const PLANK_TIME = 1; // segundos por tabla
const PLANK_TIME_BOSS = 0.25;
const DIRS =[[1, 0], [-1, 0], [0, 1], [0, -1]];

export const botName = (i) => `Bot ${BOT_NAMES[i % BOT_NAMES.length]}`;

export class BotManager {
  /**
   * hooks: {
   *   hitPlayer(targetId, dmg, byId, weapon)  — daño a un humano
   *   died(victimId, killerId, weapon)        — un bot/zombi ha muerto
   *   shot(botId, from, ends, weapon)         — efecto visual de disparo
   *   reachedExit(botId)                      — laberinto
   *   planks(windowId)                        — tablas que le quedan a una ventana (zombis)
   *   tearPlank(windowId)                     — un zombi arranca una tabla
   * }
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.bots = new Map();
  }

  reset(map, mode, { skill = 'normal', deathMs = 2000, invulnMs = 1500 } = {}) {
    this.map = map;
    this.mode = mode;
    this.skill = BOT_SKILL[skill] ?? BOT_SKILL.normal;
    this.deathMs = deathMs;
    this.invulnMs = invulnMs;
    this.bots.clear();
    const barrels = new Set((map.barrels ?? []).map((b) => b.y * map.W + b.x));
    this.passable = (x, y) =>
      x >= 0 && y >= 0 && x < map.W && y < map.H && map.height(x, y) === 0 &&
      !map.navBlocked?.has(y * map.W + x) && !barrels.has(y * map.W + x);
  }

  clear() { this.bots.clear(); }

  addBot(id, name, spawnTile, weapon) {
    const b = this.#make(id, 'bot', name, spawnTile);
    this.#arm(b, weapon ?? (this.mode === 'maze' ? 'laser' : LOADOUT[Math.floor(Math.random() * 5)]));
    this.bots.set(id, b);
    return b;
  }

  /** window: ventana por la que entra (se queda detrás hasta romper las tablas). */
  addZombie(id, spawnTile, { hp, speed, dmg, boss = false, window = null }) {
    const z = this.#make(id, 'zombie', boss ? 'Zombi Rojo' : 'Zombi', spawnTile);
    z.hp = z.maxHp = hp;
    z.speed = speed;
    z.dmg = dmg;
    z.boss = boss;
    z.win = window;
    this.bots.set(id, z);
    return z;
  }

  #arm(b, weapon) {
    b.weapon = weapon;
    b.mag = WEAPONS[weapon]?.mag ?? 12;
    b.reloadAt = 0;
  }

  #make(id, kind, name, tile) {
    return {
      id, kind, name, x: tile.x * TILE, z: tile.y * TILE, yaw: 0,
      hp: MAX_HP, maxHp: MAX_HP, dead: false, deadUntil: 0, invUntil: 0, lastHurt: 0,
      weapon: 'pistol', cd: 0, path: [], pathAt: 0, target: null, reactAt: 0,
      strafe: Math.random() < 0.5 ? 1 : -1, strafeAt: 0, speed: BOT_SPEED, dmg: 0,
      mag: 12, reloadAt: 0, boss: false, win: null,
    };
  }

  setWeapon(id, weapon) { const b = this.bots.get(id); if (b) this.#arm(b, weapon); }
  remove(id) { this.bots.delete(id); }
  get aliveZombies() { let n = 0; for (const b of this.bots.values()) if (b.kind === 'zombie' && !b.dead) n++; return n; }

  /** Cuántos zombis siguen detrás de cada ventana: Map(windowId -> n). */
  waitingAtWindows() {
    const out = new Map();
    for (const b of this.bots.values()) if (b.win) out.set(b.win.id, (out.get(b.win.id) ?? 0) + 1);
    return out;
  }

  /** Daño a un bot/zombi. Devuelve true si lo mata. */
  damage(id, dmg, byId, weapon, now = performance.now()) {
    const b = this.bots.get(id);
    if (!b || b.dead || now < b.invUntil) return false;
    b.hp -= dmg;
    b.lastHurt = now;
    // si alguien le dispara, se gira hacia él
    if (byId && byId !== id) b.provokedBy = byId;
    if (b.hp > 0) return false;
    b.dead = true;
    b.deadUntil = now + this.deathMs;
    this.hooks.died(id, byId, weapon);
    if (b.kind === 'zombie') this.bots.delete(id);
    return true;
  }

  /** humans: [{ id, x, y, z, alive, inv }] */
  update(dt, now, humans) {
    const everyone = [
      ...humans.map((h) => ({ ...h, isBot: false })),
      ...[...this.bots.values()].map((b) => ({ id: b.id, x: b.x, y: 0, z: b.z, alive: !b.dead, inv: now < b.invUntil, isBot: true, kind: b.kind })),
    ];
    for (const b of this.bots.values()) {
      if (b.dead) {
        if (b.kind === 'bot' && now >= b.deadUntil && this.respawnAllowed !== false) {
          const enemies = everyone.filter((e) => e.alive && e.id !== b.id);
          const t = pickRespawn(this.map, enemies);
          b.x = t.x * TILE; b.z = t.y * TILE;
          b.hp = b.maxHp; b.dead = false; b.invUntil = now + this.invulnMs; b.path = [];
        }
        continue;
      }
      // regeneración
      if (b.kind === 'bot' && now - b.lastHurt > 4000 && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + 25 * dt);

      if (b.kind === 'zombie') this.#zombie(b, dt, now, everyone);
      else this.#bot(b, dt, now, everyone);
    }
    this.#separate();
  }

  /** Rompe las tablas de su ventana y salta dentro. Devuelve true mientras sigue en la ventana. */
  #enterWindow(z, dt) {
    const win = z.win;
    z.yaw = Math.atan2(-(win.in.x - win.x), -(win.in.y - win.y));
    if ((this.hooks.planks?.(win.id) ?? 0) > 0) {
      z.cd -= dt;
      if (z.cd <= 0) { z.cd = z.boss ? PLANK_TIME_BOSS : PLANK_TIME; this.hooks.tearPlank?.(win.id); }
      return true;
    }
    // La ventana está bloqueada para la navegación normal: entra en línea recta hasta su casilla interior
    const dx = win.in.x * TILE - z.x, dz = win.in.y * TILE - z.z;
    const d = Math.hypot(dx, dz);
    const step = z.speed * dt;
    if (d <= step) {
      z.x = win.in.x * TILE; z.z = win.in.y * TILE;
      z.win = null;
      z.cd = 0;
      return false;
    }
    z.x += (dx / d) * step;
    z.z += (dz / d) * step;
    return true;
  }

  /** ¿Se puede andar en línea recta hasta el objetivo? (la casilla final puede ser una caja) */
  #clearLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / 0.4);
    for (let i = 1; i < n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
      if (!this.passable(Math.round(x / TILE), Math.round(z / TILE))) return false;
    }
    return true;
  }

  #zombie(z, dt, now, everyone) {
    if (z.win && this.#enterWindow(z, dt)) return;
    const targets = everyone.filter((e) => !e.isBot && e.alive && (!e.ghost || Math.hypot(e.x - z.x, e.z - z.z) < 6));
    if (!targets.length) return;
    const t = nearest(z, targets);
    const d = Math.hypot(t.x - z.x, t.z - z.z);
    z.yaw = Math.atan2(-(t.x - z.x), -(t.z - z.z));
    if (d < (z.boss ? 1.9 : 1.4)) {
      z.cd -= dt;
      if (z.cd <= 0) { z.cd = 1; this.hooks.hitPlayer(t.id, z.dmg, z.id, 'zombie'); }
      return;
    }
    // en línea recta si no hay nada en medio, si no por el camino
    if (d < 8 && this.#clearLine(z, t)) this.#moveDir(z, t.x - z.x, t.z - z.z, z.speed * dt);
    else this.#follow(z, t, dt, now, z.speed, 600);
  }

  #bot(b, dt, now, everyone) {
    const w = WEAPONS[b.weapon] ?? WEAPONS.pistol;
    // a un "fantasma" solo lo ven de cerca
    const enemies = everyone.filter((e) => e.id !== b.id && e.alive && !e.inv && e.kind !== 'zombie' &&
      (!e.ghost || Math.hypot(e.x - b.x, e.z - b.z) < 6));
    const maxRange = Math.min(w.range, this.mode === 'maze' ? 25 : 45);
    // objetivo visible más cercano (o quien le haya disparado)
    let target = null, best = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (d > maxRange) continue;
      if (!hasLOS(this.map, b.x, b.z, e.x, e.z)) continue;
      const score = d - (e.id === b.provokedBy ? 15 : 0);
      if (score < best) { best = score; target = e; }
    }
    if (target && b.target !== target.id) { b.target = target.id; b.reactAt = now + this.skill.react; }
    if (!target) b.target = null;

    const speed = BOT_SPEED * this.skill.speed * (this.mode === 'maze' ? 0.75 : 1);

    if (this.mode === 'maze') {
      // ir a la salida; disparar si ve a alguien de camino
      this.#follow(b, { x: this.map.exit.x * TILE, z: this.map.exit.y * TILE }, dt, now, speed, 1500);
      const tx = Math.round(b.x / TILE), ty = Math.round(b.z / TILE);
      if (tx === this.map.exit.x && ty === this.map.exit.y) this.hooks.reachedExit(b.id);
    } else if (target) {
      const d = Math.hypot(target.x - b.x, target.z - b.z);
      const ideal = b.weapon === 'shotgun' ? 5 : b.weapon === 'sniper' ? 20 : 11;
      // acercarse/alejarse y moverse de lado para no ser un blanco fácil
      if (now > b.strafeAt) { b.strafe = -b.strafe; b.strafeAt = now + 700 + Math.random() * 900; }
      const fx = (target.x - b.x) / d, fz = (target.z - b.z) / d;
      const forward = d > ideal + 2 ? 1 : d < ideal - 2 ? -0.6 : 0;
      this.#moveDir(b, fx * forward - fz * b.strafe * 0.8, fz * forward + fx * b.strafe * 0.8, speed * dt);
    } else {
      // buscar al enemigo más cercano (aunque no lo vea)
      const any = everyone.filter((e) => e.id !== b.id && e.alive && e.kind !== 'zombie');
      if (any.length) this.#follow(b, nearest(b, any), dt, now, speed, 1500);
    }

    if (target) {
      b.yaw = Math.atan2(-(target.x - b.x), -(target.z - b.z));
      b.cd -= dt;
      if (now >= b.reactAt && now >= b.reloadAt && b.cd <= 0) {
        b.cd = w.cd * this.skill.cdMult * (w.auto ? 1 : 1.15);
        this.#fire(b, target, w);
        // Los bots también recargan (su reserva no se acaba: si no, se quedarían quietos)
        if (--b.mag <= 0) { b.mag = w.mag; b.reloadAt = now + w.reload * 1000; }
      }
    } else if (b.path.length) {
      const [nx, ny] = b.path[0];
      b.yaw = Math.atan2(-(nx * TILE - b.x), -(ny * TILE - b.z));
    }
  }

  #fire(b, target, w) {
    const d = Math.hypot(target.x - b.x, target.z - b.z);
    const distFactor = Math.max(0.15, 1 - d / (w.range * 0.9));
    const p = Math.min(0.95, w.botAcc * this.skill.acc * distFactor * 1.4);
    let dmg = 0;
    const ends = [];
    const tyChest = (target.y ?? 0) + 1.1;
    for (let i = 0; i < w.pellets; i++) {
      const hit = Math.random() < p;
      if (hit) dmg += w.dmg * (Math.random() < 0.12 ? 1.5 : 1);
      const miss = hit ? 0.25 : 1.2 + Math.random() * 1.5;
      ends.push([
        +(target.x + (Math.random() - 0.5) * miss).toFixed(2),
        +(tyChest + (Math.random() - 0.5) * miss * 0.6).toFixed(2),
        +(target.z + (Math.random() - 0.5) * miss).toFixed(2),
      ]);
    }
    this.hooks.shot(b.id, [+b.x.toFixed(2), 1.4, +b.z.toFixed(2)], ends, b.weapon);
    if (dmg <= 0) return;
    dmg = Math.round(dmg);
    if (target.isBot) this.damage(target.id, dmg, b.id, b.weapon);
    else this.hooks.hitPlayer(target.id, dmg, b.id, b.weapon);
  }

  // ---------- Movimiento ----------

  #follow(b, goal, dt, now, speed, repathMs) {
    const gx = Math.round(goal.x / TILE), gy = Math.round(goal.z / TILE);
    if (now > b.pathAt || !b.path.length) {
      b.path = this.#bfs(Math.round(b.x / TILE), Math.round(b.z / TILE), gx, gy);
      b.pathAt = now + repathMs * (0.8 + Math.random() * 0.4);
    }
    if (!b.path.length) return;
    const [nx, ny] = b.path[0];
    const dx = nx * TILE - b.x, dz = ny * TILE - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) { b.path.shift(); return; }
    // con colisiones: si el bot se ha desviado (esquivando, empujado) no debe cortar esquinas
    this.#moveDir(b, dx, dz, Math.min(d, speed * dt));
  }

  #moveDir(b, dx, dz, step) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = b.x + (dx / len) * step, nz = b.z + (dz / len) * step;
    const r = 0.4;
    const free = (x, z) => [[-r, -r], [r, -r], [-r, r], [r, r]].every(([ox, oz]) =>
      this.passable(Math.round((x + ox) / TILE), Math.round((z + oz) / TILE)));
    if (free(nx, b.z)) b.x = nx;
    if (free(b.x, nz)) b.z = nz;
  }

  #separate() {
    const list = [...this.bots.values()].filter((b) => !b.dead);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      const dx = c.x - a.x, dz = c.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.8) {
        const push = (0.8 - d) / 2;
        this.#moveDir(a, -dx, -dz, push);
        this.#moveDir(c, dx, dz, push);
      }
    }
  }

  #bfs(sx, sy, gx, gy) {
    const { W, H } = this.map;
    if (!this.passable(gx, gy)) {
      // objetivo en una caja o pistón: ir a la casilla libre vecina
      const n = DIRS.map(([dx, dy]) => [gx + dx, gy + dy]).find(([x, y]) => this.passable(x, y));
      if (!n) return [];
      [gx, gy] = n;
    }
    const prev = new Int32Array(W * H).fill(-1);
    const start = sy * W + sx, goal = gy * W + gx;
    prev[start] = start;
    const q = [start];
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      if (cur === goal) break;
      const x = cur % W, y = (cur / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.passable(nx, ny)) continue;
        const ni = ny * W + nx;
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (prev[goal] === -1) return [];
    const path = [];
    for (let c = goal; c !== start; c = prev[c]) path.push([c % W, (c / W) | 0]);
    return path.reverse();
  }

  /** Estado compacto para enviar por red: [id, kind (0 bot, 1 zombi, 2 zombi rojo), x, z, yaw, dead, inv, weapon, hp, maxHp] */
  states(now = performance.now()) {
    return [...this.bots.values()].map((b) => [
      b.id, b.kind === 'zombie' ? (b.boss ? 2 : 1) : 0, +b.x.toFixed(2), +b.z.toFixed(2), +b.yaw.toFixed(2),
      b.dead ? 1 : 0, now < b.invUntil ? 1 : 0, b.kind === 'zombie' ? '' : b.weapon,
      Math.max(0, Math.ceil(b.hp)), b.maxHp,
    ]);
  }
}

function nearest(from, list) {
  let best = null, bd = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - from.x, e.z - from.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
