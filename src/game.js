import * as THREE from 'three';
import {
  TILE, WALL, LAVA, generateMaze, buildArena, buildTraining, buildParkour, buildZombies, applyDoors, moverBox, MAZE_SIZES,
} from './maps.js';
import { MAX_PLANKS, START_WEAPON, BOX_WEIGHTS, WALL_PRICES, createZombieWorld, describeUse, addWeapon } from './zombieworld.js';
import { SHOP } from './shop.js';
import { createMouseFilter } from './input.js';
import { GRENADE, launchGrenade, stepGrenade, grenadeDamage } from './grenades.js';
import { initialSpawns, pickRespawn, hasLOS } from './spawn.js';
import { POWERUPS, makePowerupMesh, animatePowerup } from './powerups.js';
import { WEAPONS, LOADOUT, MAX_HP, HEADSHOT, makeGunModel, disposeGroup } from './weapons.js';
import * as sfx from './audio.js';
import { settings } from './settings.js';

export const PALETTE = [0x33e0ff, 0xff3df2, 0xffd23d, 0x3dff7a, 0xff7a3d, 0xa07aff, 0xff3d5a, 0xffffff, 0x7affd8, 0xffa0c8];

const EYE = 1.6;
const RADIUS = 0.35;
const SPEED = 5.5;
const GRAVITY = 20;
const JUMP_V = 6.2; // ~0.95 m de salto; con doble salto se llega a las cajas altas
const COUNTDOWN_MS = 3000;
const NET_INTERVAL = 1 / 20;
const REGEN_DELAY = 4000;
const REGEN_RATE = 25; // vida por segundo
const BARREL_RADIUS = 5;
const BARREL_DMG = 110;
const MELEE = { range: 2.4, dmg: 50, punchDmg: 600, cd: 0.7 };
const SECOND_LIFE_MS = 3000;
const REPAIR_MS = 600; // una tabla cada 0,6 s mientras mantienes E
const USE_RANGE = 3.4; // metros hasta el centro de la casilla del objeto (la casilla de al lado está a 3; al otro lado de una pared, a 6)
const BAR_W = 1.2;
const REVIVE_MS = 2500; // manteniendo E junto a un compañero caído

/** Reglas por modo: tiempo muerto, invulnerabilidad al reaparecer y armas disponibles. */
export const RULES = {
  maze: { deathMs: 3000, invulnMs: 0, weapons: ['laser'] },
  arena: { deathMs: 2000, invulnMs: 1500, weapons: LOADOUT, grenades: 2 },
  gungame: { deathMs: 2000, invulnMs: 1500, weapons: null }, // el arma la marca tu nivel
  // caído hasta superar la oleada (o que te revivan); empiezas con pistola y el resto se compra
  zombies: { deathMs: Infinity, invulnMs: 2000, weapons: [START_WEAPON], keepAmmo: true, grenades: 2 },
  training: { deathMs: 0, invulnMs: 0, weapons: LOADOUT },
  parkour: { deathMs: 0, invulnMs: 0, weapons: [] },
};

// Entrenamiento: 5 blancos (en casillas del Campo de tiro)
const TRAINING_TARGETS = [
  { x: 3.5, y: 11, r: 0.6, move: null },
  { x: 7, y: 9, r: 0.55, move: null },
  { x: 5, y: 6.5, r: 0.55, move: { axis: 'x', amp: 2.2, period: 4 } },
  { x: 5, y: 3.5, r: 0.5, move: { axis: 'y', amp: 1.1, period: 2.6 } },
  { x: 5, y: 1.2, r: 0.4, move: null },
];

function canvasTexture(size, draw, nearest = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (nearest) tex.magFilter = THREE.NearestFilter;
  return tex;
}

function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px ui-monospace, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = '#000';
  g.strokeText(text, 128, 32);
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const tileOf = (x, z) => ({ x: Math.round(x / TILE), y: Math.round(z / TILE) });

export class Game {
  constructor(container, hud) {
    this.hud = hud;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06030c);
    this.scene.fog = new THREE.Fog(0x06030c, 3, 26);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0x9a8cff, 0x201830, 1.1));

    this.myColor = PALETTE[0];
    this.myLight = new THREE.PointLight(this.myColor, 6, 14, 1.2);
    this.camera.add(this.myLight);

    this.gunHolder = new THREE.Group();
    this.gunHolder.position.set(0.22, -0.2, -0.46);
    this.camera.add(this.gunHolder);
    this.gun = null;
    this.weapon = null;

    this.avatars = new Map(); // id -> avatar (jugadores remotos, bots y zombis)
    this.powerupMeshes = new Map();
    this.world = null;
    this.beams = [];
    this.effects = [];
    this.raycaster = new THREE.Raycaster();
    this.keys = new Set();
    this.mouseHeld = false;
    this.zoomed = false;
    this.yaw = 0;
    this.pitch = 0;
    this.active = false;
    this.ended = true;
    this.activePu = {};
    this.mode = 'maze';
    this.hp = MAX_HP;

    // Callbacks que rellena main.js
    this.onReachExit = () => {};
    this.onRematch = () => {};
    this.onDied = () => {};
    this.onPick = () => {};
    this.onEntityHit = () => {}; // (id, dmg, weapon) — bots, zombis, barriles
    this.onUse = () => {}; // ({ kind, id, cur }) — usar algo del mapa zombi
    this.net = null; // { st, shot, hit }
    this.selfId = null;
    this.me = null; // mi entrada en el marcador (puntos, mejoras, armas)
    this.ammo = {};
    this.owned = [];
    this.reloadUntil = 0;
    this.zw = null;
    this.z = null; // objetos 3D del mapa zombi
    this.minimap = hud.minimap ?? null;
    this.mouseFilter = createMouseFilter();
    this.grenades = [];
    this.nades = 0;
    this.reviveMs = 0;

    this.#bindInput();
    window.addEventListener('resize', () => this.#resize());
    this.#resize();
    this.lastT = performance.now();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  // ---------- Jugadores y entidades ----------

  setMyColor(colorIdx) {
    this.myColor = PALETTE[colorIdx % PALETTE.length];
    this.myLight.color.set(this.myColor);
    this.gun?.tip.material.color.set(this.myColor);
  }

  addPeer(id, kind = 'player', boss = false) {
    if (this.avatars.has(id)) return this.avatars.get(id);
    const zombie = kind === 'zombie';
    const color = boss ? 0xff2020 : zombie ? 0x6fd13a : PALETTE[1];
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: boss ? 0.6 : zombie ? 0.15 : 0.35, transparent: true });
    const body = new THREE.Group();
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 6, 12), mat);
    capsule.position.y = 0.85;
    body.add(capsule);
    if (zombie) {
      const armMat = new THREE.MeshStandardMaterial({ color: boss ? 0xa01010 : 0x4f9a2a });
      for (const sx of [-0.25, 0.25]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), armMat);
        arm.position.set(sx, 1.25, -0.4);
        body.add(arm);
      }
      for (const sx of [-0.12, 0.12]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
        eye.position.set(sx, 1.5, -0.32);
        body.add(eye);
      }
    } else {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      visor.position.set(0, 1.45, -0.28);
      body.add(visor);
    }
    const gunSlot = new THREE.Group();
    gunSlot.position.set(0.35, 1.1, -0.3);
    gunSlot.scale.setScalar(1.5);
    body.add(gunSlot);
    // los zombis no tienen luz: con 25 a la vez se dispararía el coste
    const light = zombie ? null : new THREE.PointLight(color, 5, 10, 1.2);
    if (light) { light.position.y = 1.2; group.add(light); }
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
    label.scale.set(2, 0.5, 1);
    const scale = boss ? 1.5 : 1;
    body.scale.setScalar(scale);
    label.position.y = boss ? 3.25 : 2.35;
    group.add(body, label);
    group.visible = false;
    this.scene.add(group);
    capsule.userData.peerId = id;
    const a = {
      id, kind, boss, group, body, mat, light, label, hitbox: capsule, gunSlot, gunId: null, color, name: '',
      x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0,
      dead: true, inv: false, r: null, fresh: true, lastSeen: 0,
      headY: 1.38 * scale, hp: null, maxHp: null, hpBg: null, hpFg: null,
    };
    if (zombie) {
      // Barra de vida sobre la cabeza (siempre mirando a la cámara)
      const barY = boss ? 3 : 2.1;
      const barW = BAR_W * scale;
      a.hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.75, transparent: true, depthWrite: false }));
      a.hpBg.scale.set(barW + 0.06, 0.16, 1);
      a.hpBg.position.y = barY;
      a.hpBg.renderOrder = 1;
      a.hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x3dff7a, transparent: true, depthWrite: false }));
      a.hpFg.scale.set(barW, 0.1, 1);
      a.hpFg.position.y = barY;
      a.hpFg.renderOrder = 2;
      a.barW = barW;
      group.add(a.hpBg, a.hpFg);
    }
    this.avatars.set(id, a);
    if (zombie) this.#setLabel(a, boss ? 'ZOMBI ROJO' : 'Zombi', color);
    return a;
  }

  /** Vida de un zombi: barra y número sobre su cabeza. */
  #setZombieHp(a, hp, maxHp) {
    if (a.hp === hp && a.maxHp === maxHp) return;
    a.hp = hp;
    a.maxHp = maxHp;
    const frac = Math.max(0.001, Math.min(1, hp / maxHp));
    a.hpFg.scale.x = a.barW * frac;
    a.hpFg.center.x = 0.5 / frac; // la barra se vacía hacia la izquierda
    a.hpFg.material.color.set(frac > 0.6 ? 0x3dff7a : frac > 0.3 ? 0xffd23d : 0xff3d5a);
    this.#setLabel(a, `${hp}/${maxHp}`, a.color);
  }

  removePeer(id) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    a.group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    this.avatars.delete(id);
  }

  #setLabel(a, text, color) {
    a.label.material.map?.dispose();
    a.label.material.map = labelTexture(text, color);
    a.label.material.needsUpdate = true;
  }

  setPeerInfo(id, { name, color, bot }) {
    const a = this.avatars.get(id) ?? this.addPeer(id, bot ? 'bot' : 'player');
    if (a.kind === 'zombie') return;
    const c = PALETTE[color % PALETTE.length];
    if (a.color !== c || name !== a.name) {
      a.color = c;
      a.mat.color.set(c);
      a.mat.emissive.set(c);
      a.light?.color.set(c);
      a.name = name;
      this.#setLabel(a, name || '???', c);
    }
  }

  #setAvatarGun(a, w) {
    if (a.gunId === w) return;
    a.gunId = w;
    for (const c of [...a.gunSlot.children]) { a.gunSlot.remove(c); disposeGroup(c); }
    if (w && WEAPONS[w]) a.gunSlot.add(makeGunModel(w, a.color).group);
  }

  /** Bots y zombis (los manda el host): [id, kind, x, z, yaw, dead, inv, weapon, hp, maxHp] */
  setEntities(list) {
    const seen = new Set();
    const now = performance.now();
    let boss = null;
    for (const [id, kind, x, z, yaw, dead, inv, w, hp, maxHp] of list) {
      seen.add(id);
      const a = this.avatars.get(id) ?? this.addPeer(id, kind === 0 ? 'bot' : 'zombie', kind === 2);
      if (a.kind === 'zombie') this.#setZombieHp(a, hp, maxHp);
      if (kind === 2 && !dead) boss = a;
      const wasDead = a.dead;
      a.tx = x; a.ty = 0; a.tz = z; a.tyaw = yaw;
      a.dead = !!dead; a.inv = !!inv;
      if (a.fresh || a.r !== this.seed || (wasDead && !dead)) { a.x = x; a.y = 0; a.z = z; a.yaw = yaw; a.fresh = false; }
      a.r = this.seed;
      a.lastSeen = now;
      this.#setAvatarGun(a, w);
    }
    for (const [id, a] of this.avatars) if (a.kind !== 'player' && !seen.has(id)) this.removePeer(id);
    this.#setBoss(boss);
  }

  /** El zombi rojo: aviso, ambiente rojo y barra de vida grande mientras siga vivo. */
  #setBoss(a) {
    const id = a?.id ?? null;
    if (id !== this.bossId) {
      this.bossId = id;
      const sky = id ? 0x2a0408 : this.baseBg;
      if (sky != null) {
        this.scene.background.set(sky);
        this.scene.fog.color.copy(this.scene.background);
      }
      if (id) {
        sfx.bossRoar();
        this.shake = 1;
        this.hud.message('¡ZOMBI ROJO!', 'Mucha más vida y muerde fuerte. Matadlo y recargáis toda la munición');
        setTimeout(() => { if (!this.ended) this.hud.message('', ''); }, 3000);
      } else if (this.bossLight) {
        this.bossLight.intensity = 0;
      }
    }
    this.hud.boss(a ? a.hp / a.maxHp : null);
  }

  // ---------- Ronda ----------

  /**
   * opts: { seed, mode, diff, mapId, level, players, spawnIndex (-1 = aleatorio), solo, elapsed (ms) }
   */
  startRound({ seed, mode, diff = 'media', mapId = 'coliseo', level = 0, players = 1, spawnIndex = 0, solo = false, elapsed = 0 }) {
    this.#disposeWorld();
    this.mode = mode;
    this.rules = RULES[mode];
    this.map =
      mode === 'maze' ? generateMaze(seed, MAZE_SIZES[diff] ?? 9) :
      mode === 'training' ? buildTraining(seed) :
      mode === 'parkour' ? buildParkour(level, seed) :
      mode === 'zombies' ? buildZombies(seed) :
      buildArena(mapId, seed);
    this.seed = seed;
    this.solo = solo;
    this.roundStart = performance.now() - elapsed;
    this.#buildWorld();

    for (const a of this.avatars.values()) { a.r = null; a.group.visible = false; a.fresh = true; }
    for (const [id, a] of this.avatars) if (a.kind !== 'player') this.removePeer(id);

    const late = spawnIndex < 0;
    const spawn = mode === 'parkour' ? this.map.start
      : late ? pickRespawn(this.map, this.#enemyPositions())
      : initialSpawns(this.map, Math.max(players, spawnIndex + 1))[spawnIndex];
    this.#placeMe(spawn);
    this.checkpoint = mode === 'parkour' ? { ...this.map.start, h: this.map.height(this.map.start.x, this.map.start.y) } : null;

    this.dead = false;
    this.deadUntil = 0;
    this.invulnUntil = 0;
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.perks = new Set();
    this.reviving = false;
    this.meleeCd = 0;
    this.hud.perks([]);
    this.lastHurt = 0;
    this.ended = false;
    this.exitSent = false;
    this.cooldown = 0;
    this.netTimer = 0;
    this.activePu = {};
    this.picked = new Set();
    this.forcedWeapon = null;
    this.zoomed = false;
    this.setPowerups([]);
    this.deadBarrels = new Set();
    this.localPuHidden = new Map();
    this.frozenUntil = late || mode === 'training' ? performance.now() : performance.now() + COUNTDOWN_MS;
    this.lastCountdown = late || mode === 'training' ? 0 : null;
    this.timerStart = this.frozenUntil;
    this.weapon = null;
    this.ammo = {};
    this.reloadUntil = 0;
    this.owned = [...(this.rules.weapons ?? [])];
    this.bossId = null;
    this.useTarget = null;
    this.repairAt = 0;
    this.hud.boss(null);
    this.hud.prompt(null);
    this.reviveMs = 0;
    this.reviveStart = 0;
    this.#clearGrenades();
    this.nades = this.rules.grenades ?? 0;
    this.hud.grenades(this.rules.grenades ? this.nades : null);
    this.minimap?.start(this.map, mode);
    this.selectWeapon(this.rules.weapons?.[0] ?? (mode === 'gungame' ? 'pistol' : null));
    this.#ammoHud();
    if (mode === 'training') this.#resetTraining();
    this.active = true;
    this.hud.overlay(false);
    this.hud.dead(false);
    this.hud.scope(false);
    this.hud.message('', '');
    this.hud.health(this.hp, mode !== 'parkour' && mode !== 'training', this.maxHp);
    this.hud.timer(mode === 'parkour' ? 0 : null);
  }

  endRound(title, sub, iWon) {
    if (this.ended) return;
    this.ended = true;
    this.mouseHeld = false;
    this.setZoom(false);
    this.hud.dead(false);
    (iWon ? sfx.win : sfx.lose)();
    this.hud.message(title, sub);
  }

  stop(msg = '', sub = '') {
    this.active = false;
    this.ended = true;
    this.setZoom(false);
    for (const [id, a] of this.avatars) { a.group.visible = false; if (a.kind !== 'player') this.removePeer(id); }
    this.setPowerups([]);
    this.hud.message(msg, sub);
    this.hud.dead(false);
    this.hud.powerups([]);
    this.hud.health(0, false);
    this.hud.timer(null);
    this.hud.training(null);
    this.hud.ammo(null);
    this.hud.prompt(null);
    this.hud.boss(null);
    this.hud.grenades(null);
    this.minimap?.stop();
    this.#clearGrenades();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  lock() {
    if (this.active) this.canvas.requestPointerLock();
  }

  get elapsed() { return performance.now() - this.roundStart; }
  get alive() { return this.active && !this.dead; }

  // ---------- Armas ----------

  allowedWeapons() {
    if (this.mode === 'gungame') return [this.forcedWeapon ?? 'pistol'];
    return this.owned;
  }

  // ---------- Munición ----------

  ammoOf(id) {
    this.ammo[id] ??= { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    return this.ammo[id];
  }

  /** Rellena una arma (o todas las que tienes si no dices cuál). */
  refillAmmo(id) {
    const ids = id ? [id] : Object.keys(this.ammo);
    for (const w of ids) this.ammo[w] = { mag: WEAPONS[w].mag, reserve: WEAPONS[w].reserve };
    this.reloadUntil = 0;
    this.#ammoHud();
  }

  ammoFull(id) {
    const a = this.ammoOf(id);
    return a.mag === WEAPONS[id].mag && a.reserve === WEAPONS[id].reserve;
  }

  reload() {
    const id = this.currentWeapon;
    if (!id || !this.alive || this.ended || this.reloadUntil) return;
    const a = this.ammoOf(id);
    if (a.mag >= WEAPONS[id].mag || a.reserve <= 0) return;
    this.setZoom(false);
    this.reloadUntil = performance.now() + WEAPONS[id].reload * 1000 * (this.perks?.has('fastreload') ? 0.5 : 1);
    sfx.reloadSound();
    this.#ammoHud();
  }

  #finishReload() {
    const id = this.currentWeapon;
    this.reloadUntil = 0;
    if (id) {
      const a = this.ammoOf(id);
      const n = Math.min(WEAPONS[id].mag - a.mag, a.reserve);
      a.mag += n;
      a.reserve -= n;
    }
    this.#ammoHud();
  }

  #ammoHud() {
    const id = this.currentWeapon;
    if (!id) { this.hud.ammo(null); return; }
    const a = this.ammoOf(id);
    this.hud.ammo({ mag: a.mag, reserve: a.reserve, reloading: !!this.reloadUntil });
  }

  /** Zombis: coges un arma. Si ya la tienes se rellena; con 2 armas, sustituye a la de la mano. */
  giveWeapon(id) {
    if (this.owned.includes(id)) {
      this.refillAmmo(id);
    } else {
      const next = addWeapon(this.owned, id, this.weapon);
      for (const w of this.owned) if (!next.includes(w)) delete this.ammo[w];
      this.owned = next;
    }
    this.weapon = id;
    this.reloadUntil = 0;
    this.#refreshGun(true);
    sfx.buySound();
    this.hud.toast(WEAPONS[id].name.toUpperCase(), '#ffd23d');
  }

  /** Arma real en uso (el power-up de francotirador la sustituye temporalmente). */
  get currentWeapon() {
    if (this.has('sniper') && this.mode !== 'parkour') return 'sniper';
    return this.weapon;
  }

  selectWeapon(id) {
    if (id && !this.allowedWeapons().includes(id) && !(id === 'sniper' && this.has('sniper'))) return;
    this.weapon = id;
    this.#refreshGun();
  }

  setForcedWeapon(id) {
    this.forcedWeapon = id;
    if (this.weapon !== id) {
      this.weapon = id;
      delete this.ammo[id]; // cada arma nueva llega con la munición llena
      this.#refreshGun();
      if (this.active) this.hud.toast(WEAPONS[id].name.toUpperCase(), '#ffd23d');
    }
  }

  #refreshGun(force = false) {
    const id = this.currentWeapon;
    if (this.gun?.id === id && !force) return;
    if (this.gun) { this.gunHolder.remove(this.gun.group); disposeGroup(this.gun.group); }
    this.gun = null;
    this.reloadUntil = 0; // cambiar de arma cancela la recarga
    this.setZoom(false);
    if (id) {
      const m = makeGunModel(id, this.perks?.has('pap') ? 0xffd23d : this.myColor);
      this.gun = { id, ...m };
      this.gunHolder.add(m.group);
    }
    this.hud.weapons(this.allowedWeapons(), id);
    if (this.rules) this.#ammoHud();
  }

  setZoom(on) {
    const w = WEAPONS[this.currentWeapon];
    on = !!on && !!w?.zoom && this.alive && !this.ended && !this.reloadUntil;
    if (on === this.zoomed) return;
    this.zoomed = on;
    this.hud.scope(on);
    if (this.gun) this.gun.group.visible = !on;
  }

  // ---------- Eventos de red ----------

  remoteState(id, { r, p, yw, d, i, w, rv, g }) {
    const a = this.avatars.get(id);
    if (!a || r !== this.seed) return;
    const wasDead = a.dead;
    a.tx = p[0]; a.ty = p[1]; a.tz = p[2]; a.tyaw = yw;
    a.dead = !!d;
    a.inv = !!i;
    a.rv = !!rv;
    a.ghost = !!g;
    if (a.r !== r || a.fresh || (wasDead && !d)) {
      a.x = a.tx; a.y = a.ty; a.z = a.tz; a.yaw = yw;
      a.fresh = false;
    }
    a.r = r;
    a.lastSeen = performance.now();
    this.#setAvatarGun(a, w);
  }

  remoteShot(id, { a: from, e: ends, w }) {
    const av = this.avatars.get(id);
    const color = av ? av.color : PALETTE[1];
    const va = new THREE.Vector3(...from);
    for (const end of ends) this.#spawnBeam(va, new THREE.Vector3(...end), color, WEAPONS[w]?.width ?? 0.035);
    this.minimap?.shot(va.x, va.z);
    const d = va.distanceTo(this.camera.position);
    sfx.laser(Math.max(0, 1 - d / 45) * 0.8, (WEAPONS[w]?.pitch ?? 1) * 0.9);
  }

  /** Daño recibido. by = quien lo causa (jugador, bot, zombi). */
  takeDamage(dmg, by, weapon) {
    const now = performance.now();
    if (!this.alive || this.ended || now < this.invulnUntil || now < this.frozenUntil || dmg <= 0) return;
    if (this.mode === 'parkour' || this.mode === 'training') return;
    this.hp -= dmg;
    this.lastHurt = now;
    this.hud.hurt();
    this.hud.health(Math.max(0, this.hp), true, this.maxHp);
    if (this.hp > 0) { sfx.hurt(); return; }
    this.dead = true;
    // Segunda Vida: te levantas en el sitio y conservas tus mejoras
    this.reviving = this.perks.has('secondlife');
    if (this.reviving) {
      this.perks.delete('secondlife');
      this.deadUntil = now + SECOND_LIFE_MS;
    } else {
      this.deadUntil = now + this.rules.deathMs;
      this.perks.clear();
      this.maxHp = MAX_HP;
    }
    this.hud.perks([...this.perks]);
    this.keys.clear();
    this.mouseHeld = false;
    this.setZoom(false);
    this.activePu = {};
    this.reloadUntil = 0;
    this.#refreshGun();
    this.hud.prompt(null);
    sfx.death();
    this.hud.dead(true);
    this.#sendState();
    this.onDied(by, weapon, this.reviving);
  }

  gotHit(fromId, { r, dmg = 100, w, by }) {
    if (r !== this.seed) return;
    this.takeDamage(dmg, by ?? fromId, w);
  }

  /** El host revive a todos (zombis: nueva oleada). */
  revive(here = false) {
    if (!this.dead || this.ended) return;
    if (here) this.reviving = true; // te levanta un compañero: sigues donde caíste
    this.deadUntil = performance.now();
  }

  // ---------- Granadas ----------

  addGrenades(n) {
    this.nades = Math.min(GRENADE.max, this.nades + n);
    this.hud.grenades(this.nades);
    sfx.buySound();
  }

  #throwGrenade() {
    if (!this.alive || this.ended || performance.now() < this.frozenUntil) return;
    if (this.nades <= 0) { if (this.rules.grenades) this.hud.toast('Sin granadas', '#ff3d5a'); return; }
    this.nades--;
    this.hud.grenades(this.nades);
    this.punchAnim = 1;
    sfx.punch();
    this.camera.updateMatrixWorld();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const pos = this.camera.position.clone().addScaledVector(dir, 0.4);
    const data = { r: this.seed, a: pos.toArray(), d: dir.toArray() };
    this.#addGrenade(data, true);
    if (!this.solo) this.net?.gren(data);
  }

  remoteGrenade(data) {
    if (data.r === this.seed) this.#addGrenade(data, false);
  }

  #addGrenade({ a, d }, mine) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ color: 0x35602a, emissive: 0xff2020, emissiveIntensity: 0.3 }));
    this.scene.add(mesh);
    this.grenades.push({ g: launchGrenade(a, d), mesh, mine });
  }

  #clearGrenades() {
    for (const n of this.grenades) { this.scene.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh.material.dispose(); }
    this.grenades = [];
  }

  #updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const n = this.grenades[i];
      const boom = stepGrenade(this.map, n.g, dt);
      n.mesh.position.set(n.g.x, n.g.y, n.g.z);
      if (!boom) continue;
      this.scene.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh.material.dispose();
      this.grenades.splice(i, 1);
      this.#blastFx(new THREE.Vector3(n.g.x, Math.max(0.3, n.g.y), n.g.z), GRENADE.radius);
      if (n.mine) this.#grenadeBlast(n.g);
    }
  }

  /** Solo quien la lanza calcula el daño. Las paredes protegen. En zombis no daña a los compañeros. */
  #grenadeBlast(g) {
    const zombies = this.mode === 'zombies';
    const reach = (x, z) => (hasLOS(this.map, g.x, g.z, x, z) ? grenadeDamage(Math.hypot(x - g.x, z - g.z)) : 0);
    let hitAny = false;
    for (const a of this.avatars.values()) {
      if (!a.group.visible || a.dead || a.inv) continue;
      const dmg = reach(a.x, a.z);
      if (!dmg) continue;
      if (a.kind !== 'player') { this.onEntityHit(a.id, dmg, 'grenade'); hitAny = true; }
      else if (!zombies) { this.net?.hit({ r: this.seed, dmg, w: 'grenade' }, a.id); hitAny = true; }
    }
    for (const b of this.barrelMeshes ?? []) {
      if (!this.deadBarrels.has(b.id) && reach(b.x, b.z)) this.onEntityHit(b.id, 50, 'grenade');
    }
    if (hitAny) { sfx.hit(); this.hud.hitmarker(false); }
    const self = reach(this.pos.x, this.pos.z);
    if (self) this.takeDamage(Math.round(self * (zombies ? 0.25 : 0.6)), this.selfId, 'grenade');
  }

  // ---------- Mejoras de la tienda (zombis) ----------

  applyPerk(id) {
    sfx.powerup();
    if (id === 'medkit') { this.hp = this.maxHp; this.hud.health(this.hp, true, this.maxHp); return; }
    if (id === 'revive') return; // lo gestiona el host
    this.perks.add(id);
    if (id === 'armor') { this.maxHp = 200; this.hp = 200; this.hud.health(this.hp, true, this.maxHp); }
    if (id === 'pap') this.#refreshGun(true);
    this.hud.perks([...this.perks]);
  }

  // ---------- Barriles ----------

  setBarrels(deadIds) {
    this.deadBarrels = new Set(deadIds);
    for (const b of this.barrelMeshes ?? []) b.mesh.visible = !this.deadBarrels.has(b.id);
  }

  explode({ x, y, z, by }) {
    const pos = new THREE.Vector3(x, y, z);
    this.#blastFx(pos, BARREL_RADIUS);
    // daño a mí
    const me = new THREE.Vector3(this.pos.x, this.feetY + 1, this.pos.z);
    const dist = me.distanceTo(pos);
    if (dist < BARREL_RADIUS) this.takeDamage(Math.round(BARREL_DMG * (1 - dist / BARREL_RADIUS) + 10), by, 'barrel');
  }

  #blastFx(pos, radius) {
    // efecto: esfera que crece y se desvanece + luz ya existente no (evitar recompilar shaders)
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, dur: 0.5, grow: radius });
    const d = pos.distanceTo(this.camera.position);
    sfx.explosion(Math.max(0.15, 1 - d / 50));
    if (d < 12) this.shake = Math.max(this.shake ?? 0, (12 - d) / 12);
  }

  // ---------- Power-ups ----------

  setPowerups(list) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, pu] of this.powerupMeshes) {
      if (pu.local) continue;
      if (!ids.has(id)) { this.scene.remove(pu.mesh); this.powerupMeshes.delete(id); }
    }
    for (const p of list) this.#addPowerupMesh(p, false);
  }

  #addPowerupMesh(p, local) {
    if (this.powerupMeshes.has(p.id)) return;
    const mesh = makePowerupMesh(p.type);
    const h = this.map ? Math.max(0, this.map.height(p.x, p.y)) : 0;
    mesh.position.set(p.x * TILE, h, p.y * TILE);
    this.scene.add(mesh);
    this.powerupMeshes.set(p.id, { mesh, local, ...p });
  }

  applyPowerup(type) {
    if (this.dead || !POWERUPS[type]) return;
    sfx.powerup();
    this.hud.toast(POWERUPS[type].label + '!', POWERUPS[type].color);
    if (type === 'medkit') { this.hp = this.maxHp; this.hud.health(this.hp, true, this.maxHp); return; }
    this.activePu[type] = performance.now() + POWERUPS[type].duration * 1000;
    if (type === 'sniper') { delete this.ammo.sniper; this.#refreshGun(); }
  }

  has(type) {
    return (this.activePu[type] ?? 0) > performance.now();
  }

  // ---------- Construcción del mundo ----------

  #buildWorld() {
    const map = this.map;
    const { W, H, wallH } = map;
    const world = new THREE.Group();
    const open = !map.ceiling;
    const parkour = map.kind === 'parkour';
    const zombies = map.kind === 'zombies';

    const indoorParkour = parkour && map.ceiling;
    this.scene.fog.near = indoorParkour ? 14 : parkour ? 25 : open ? 18 : zombies ? 4 : 3;
    this.scene.fog.far = indoorParkour ? 60 : parkour ? 110 : open ? 75 : zombies ? 30 : 26;
    this.baseBg = parkour ? 0x1a0610 : open ? 0x0a0518 : 0x06030c;
    this.scene.background.set(this.baseBg);
    this.scene.fog.color.copy(this.scene.background);

    const hue = (this.seed % 360) / 360;
    const wallColor = new THREE.Color().setHSL(hue, 0.6, 0.55);
    const wallTex = canvasTexture(64, (g, s) => {
      g.fillStyle = '#1b1430';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#' + wallColor.getHexString();
      g.lineWidth = 3;
      g.strokeRect(2, 2, s - 4, s - 4);
      g.globalAlpha = 0.35;
      for (let i = 0; i < 6; i++) g.fillRect(Math.random() * s, Math.random() * s, 6, 6);
    });
    const crateTex = canvasTexture(64, (g, s) => {
      g.fillStyle = '#2a1840';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#ff3df2';
      g.lineWidth = 4;
      g.strokeRect(3, 3, s - 6, s - 6);
      g.beginPath(); g.moveTo(3, 3); g.lineTo(s - 3, s - 3); g.moveTo(s - 3, 3); g.lineTo(3, s - 3); g.stroke();
    });
    const platTex = canvasTexture(64, (g, s) => {
      g.fillStyle = '#20183a';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#33e0ff';
      g.lineWidth = 4;
      g.strokeRect(3, 3, s - 6, s - 6);
    });
    const moverTex = canvasTexture(64, (g, s) => {
      g.fillStyle = '#3a2a08';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#ffd23d';
      for (let i = -s; i < s * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i - s + 8, s); g.lineTo(i - s, s); g.fill(); }
    });

    // Casillas agrupadas por altura -> un InstancedMesh por altura
    const groups = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = map.height(x, y);
      if (v === 0 || v === LAVA) continue;
      const key = v === WALL ? 'wall' : String(v);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([x, y]);
    }
    this.solids = [];
    const m = new THREE.Matrix4();
    for (const [key, tiles] of groups) {
      const isWall = key === 'wall';
      const top = isWall ? wallH : Number(key);
      const height = top - map.base;
      const size = isWall ? TILE : TILE * 0.96;
      const mat = new THREE.MeshStandardMaterial({ map: isWall ? wallTex : parkour ? platTex : crateTex, roughness: 0.85 });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, height, size), mat, tiles.length);
      tiles.forEach(([x, y], i) => {
        m.makeTranslation(x * TILE, map.base + height / 2, y * TILE);
        mesh.setMatrixAt(i, m);
      });
      mesh.computeBoundingSphere();
      world.add(mesh);
      this.solids.push(mesh);
    }

    const cx = ((W - 1) * TILE) / 2, cz = ((H - 1) * TILE) / 2;
    if (parkour) {
      // Lava
      const lavaTex = canvasTexture(64, (g, s) => {
        const grad = g.createLinearGradient(0, 0, s, s);
        grad.addColorStop(0, '#ff3d00'); grad.addColorStop(0.5, '#ffae00'); grad.addColorStop(1, '#ff3d00');
        g.fillStyle = grad; g.fillRect(0, 0, s, s);
        g.fillStyle = '#ffe06688';
        for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 3 + Math.random() * 5, 0, 7); g.fill(); }
      }, false);
      lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping;
      lavaTex.repeat.set(W * 2, H * 2);
      this.lavaTex = lavaTex;
      const lava = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE * 4, H * TILE * 2), new THREE.MeshBasicMaterial({ map: lavaTex }));
      lava.rotation.x = -Math.PI / 2;
      lava.position.set(cx, -0.6, cz);
      world.add(lava);
      if (map.ceiling) {
        const roof = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE, H * TILE), new THREE.MeshStandardMaterial({ color: 0x1a1020 }));
        roof.rotation.x = Math.PI / 2;
        roof.position.set(cx, wallH, cz);
        world.add(roof);
      }
    } else {
      const floorTex = canvasTexture(32, (g, s) => {
        g.fillStyle = '#120d1c'; g.fillRect(0, 0, s, s);
        g.fillStyle = '#1d1530'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
      });
      floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
      floorTex.repeat.set(W, H);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE, H * TILE), new THREE.MeshStandardMaterial({ map: floorTex }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0, cz);
      world.add(floor);
      if (map.ceiling) {
        const ceiling = new THREE.Mesh(floor.geometry, new THREE.MeshStandardMaterial({ color: 0x0b0814 }));
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(cx, wallH, cz);
        world.add(ceiling);
      }
    }
    if (open) {
      const pts = [];
      for (let i = 0; i < 700; i++) {
        const v = new THREE.Vector3().randomDirection();
        v.y = Math.abs(v.y) * 0.8 + 0.1;
        v.normalize().multiplyScalar(180);
        pts.push(v.x + cx, v.y, v.z + cz);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      world.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, fog: false })));
    }

    // Objetos móviles
    this.movers = map.movers.map((mv) => {
      const box = moverBox(mv, 0);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: moverTex, emissive: 0x332200, roughness: 0.6 })
      );
      mesh.scale.set(box.hx * 2, 1, box.hz * 2);
      world.add(mesh);
      return { def: mv, mesh, box, prev: box };
    });
    this.solids.push(...this.movers.map((m) => m.mesh));

    // Barriles explosivos
    this.barrelMeshes = (map.barrels ?? []).map((b) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 1.1, 14),
        new THREE.MeshStandardMaterial({ color: 0xc81e1e, emissive: 0x400000, roughness: 0.5 })
      );
      body.position.y = 0.55;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.14, 14), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
      band.position.y = 0.75;
      group.add(body, band);
      group.position.set(b.x * TILE, 0, b.y * TILE);
      body.userData.entityId = b.id;
      band.userData.entityId = b.id;
      world.add(group);
      return { id: b.id, mesh: group, hit: [body, band], x: b.x * TILE, z: b.y * TILE };
    });

    // Salida del laberinto / meta del parkour
    this.portal = null;
    const goal = map.exit ?? map.finish;
    if (goal) {
      const gh = Math.max(0, map.height(goal.x, goal.y));
      const portal = new THREE.Mesh(
        new THREE.BoxGeometry(TILE * 0.8, 3.6, TILE * 0.8),
        new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.35, depthWrite: false })
      );
      portal.position.set(goal.x * TILE, gh + 1.8, goal.y * TILE);
      world.add(portal);
      this.portal = portal;
    }
    this.checkpointMeshes = (map.checkpoints ?? []).map((c) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.1, 0.06, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x33e0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(c.x * TILE, c.h + 0.1, c.y * TILE);
      world.add(ring);
      return { ...c, ring };
    });
    // Siempre una luz extra (no cambiar el nº de luces entre modos: recompilaría shaders)
    const lightPos = goal ? [goal.x * TILE, 2, goal.y * TILE] : [cx, 4, cz];
    const extraLight = new THREE.PointLight(goal ? 0x3dff7a : 0xa07aff, goal ? 12 : 20, goal ? 14 : 30, 1.2);
    extraLight.position.set(...lightPos);
    world.add(extraLight);
    this.extraLight = extraLight;

    // Zombis: puertas, ventanas, máquinas...
    this.z = null;
    this.zw = null;
    this.bossLight = null;
    this.zBoxes = [];
    if (zombies) this.#buildZombieWorld(world, wallTex);

    // Entrenamiento: blancos
    this.targets = [];
    if (map.kind === 'training') {
      for (const [i, t] of TRAINING_TARGETS.entries()) {
        const group = new THREE.Group();
        const face = canvasTexture(128, (g, s) => {
          const rings = ['#ffffff', '#ff3d5a', '#ffffff', '#ff3d5a', '#ffd23d'];
          rings.forEach((c, k) => { g.fillStyle = c; g.beginPath(); g.arc(s / 2, s / 2, (s / 2) * (1 - k * 0.2), 0, 7); g.fill(); });
        }, false);
        const disc = new THREE.Mesh(
          new THREE.CylinderGeometry(t.r, t.r, 0.08, 24).rotateX(Math.PI / 2),
          [new THREE.MeshStandardMaterial({ color: 0xdddddd }), new THREE.MeshBasicMaterial({ map: face }), new THREE.MeshBasicMaterial({ map: face })]
        );
        disc.position.y = 1.5;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5), new THREE.MeshStandardMaterial({ color: 0x555566 }));
        pole.position.y = 0.75;
        group.add(disc, pole);
        disc.userData.targetIdx = i;
        world.add(group);
        this.targets.push({ ...t, idx: i, group, disc, hp: 100, downUntil: 0 });
      }
    }

    this.scene.add(world);
    this.world = world;
  }

  #buildZombieWorld(world, wallTex) {
    const map = this.map;
    const { wallH } = map;
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
    const signTexture = (lines, bg, fg) => canvasTexture(128, (g, s) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, s, s);
      g.strokeStyle = fg;
      g.lineWidth = 6;
      g.strokeRect(4, 4, s - 8, s - 8);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      lines.forEach((text, i) => {
        g.font = `bold ${Math.min(26, Math.floor(210 / Math.max(6, text.length)))}px ui-monospace, monospace`;
        g.fillText(text, s / 2, s / 2 + (i - (lines.length - 1) / 2) * 30);
      });
    }, false);
    const add = (geo, mat, x, y, z, parent = world) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const yawOf = ({ dx, dy }) => Math.atan2(dx, dy);
    const z = { doors: new Map(), windows: new Map(), machines: [], lever: null, leverMat: null, box: null, power: false };

    // Puertas: bloquean el paso y las balas hasta que se abren
    const doorTex = canvasTexture(64, (g, s) => {
      g.fillStyle = '#3a2a08';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#ffd23d';
      for (let i = -s; i < s * 2; i += 20) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 10, 0); g.lineTo(i - s + 10, s); g.lineTo(i - s, s); g.fill(); }
    });
    for (const d of map.doors) {
      const mesh = add(new THREE.BoxGeometry(TILE, wallH, TILE), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.6 }), d.x * TILE, wallH / 2, d.y * TILE);
      this.solids.push(mesh);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(`${d.cost} pts`, 0xffd23d), transparent: true, depthWrite: false, depthTest: false }));
      sign.scale.set(2.4, 0.6, 1);
      sign.position.set(d.x * TILE, 2.6, d.y * TILE);
      world.add(sign);
      z.doors.set(d.id, { mesh, sign, open: false, box: { cx: d.x * TILE, cz: d.y * TILE, hx: TILE / 2, hz: TILE / 2, y0: 0, y1: wallH } });
    }

    // Ventanas y puertas de servicio: hueco en la pared tapado con tablas; el zombi espera detrás
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
    const backMat = new THREE.MeshBasicMaterial({ color: 0x020104 });
    for (const w of map.windows) {
      const cx = w.x * TILE, cz = w.y * TILE;
      const sill = w.tall ? 0 : 0.7;
      const top = w.tall ? 2.9 : 2.6;
      if (sill) this.solids.push(add(new THREE.BoxGeometry(TILE, sill, TILE), wallMat, cx, sill / 2, cz));
      this.solids.push(add(new THREE.BoxGeometry(TILE, wallH - top, TILE), wallMat, cx, (wallH + top) / 2, cz));
      const ix = w.in.x - w.x, iy = w.in.y - w.y; // hacia dentro
      const back = add(new THREE.PlaneGeometry(TILE, wallH), backMat, cx - ix * (TILE / 2 - 0.02), wallH / 2, cz - iy * (TILE / 2 - 0.02));
      back.rotation.y = Math.atan2(ix, iy);
      const yaw = Math.atan2(iy, ix) * -1 + Math.PI / 2; // el largo de la tabla, paralelo a la pared
      const planks = [];
      for (let i = 0; i < MAX_PLANKS; i++) {
        const y = sill + 0.2 + (i * (top - sill - 0.4)) / (MAX_PLANKS - 1);
        const p = add(new THREE.BoxGeometry(TILE * 0.98, 0.26, 0.08), plankMat, cx + ix * (TILE / 2 - 0.06), y, cz + iy * (TILE / 2 - 0.06));
        p.rotation.y = yaw;
        p.rotation.z = (i % 2 ? 1 : -1) * 0.05;
        planks.push(p);
      }
      z.windows.set(w.id, { planks });
      z.windowBox ??= [];
      z.windowBox.push({ cx, cz, hx: TILE / 2, hz: TILE / 2, y0: 0, y1: wallH });
    }

    // Armas en la pared: cartel con su precio y el arma colgada
    for (const b of map.wallBuys) {
      const { dx, dy } = b.face;
      const px = b.x * TILE + dx * (TILE / 2 + 0.02), pz = b.y * TILE + dy * (TILE / 2 + 0.02);
      const poster = add(
        new THREE.PlaneGeometry(1.8, 1.3),
        new THREE.MeshBasicMaterial({ map: signTexture([WEAPONS[b.weapon].name, `${WALL_PRICES[b.weapon]} pts`], '#141018', '#ffd23d') }),
        px, 1.7, pz
      );
      poster.rotation.y = yawOf(b.face);
      const gun = makeGunModel(b.weapon, 0xffd23d);
      gun.group.position.set(px + dx * 0.08, 2.6, pz + dy * 0.08);
      gun.group.rotation.y = yawOf(b.face) + Math.PI / 2;
      gun.group.scale.setScalar(2);
      world.add(gun.group);
    }

    // Objetos sobre una alfombra de 1 casilla, que ocupan por completo: nadie se sube a ellos ni se esconde detrás
    const matTex = canvasTexture(64, (g, s) => {
      g.fillStyle = '#17121f';
      g.fillRect(0, 0, s, s);
      g.strokeStyle = '#ffd23d';
      g.lineWidth = 3;
      g.strokeRect(2, 2, s - 4, s - 4);
    });
    z.propBoxes = [];
    for (const p of map.props) {
      const cx = p.x * TILE, cz = p.y * TILE;
      z.propBoxes.push({ cx, cz, hx: TILE / 2, hz: TILE / 2, y0: 0, y1: wallH });
      const floorMat = add(new THREE.PlaneGeometry(TILE, TILE), new THREE.MeshStandardMaterial({ map: matTex }), cx, 0.02, cz);
      floorMat.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.position.set(cx, 0, cz);
      g.rotation.y = yawOf(p.face);
      world.add(g);
      if (p.kind === 'machine') {
        const item = SHOP[p.item];
        const mat = new THREE.MeshStandardMaterial({ color: item.color, emissive: item.color, emissiveIntensity: 0.03, roughness: 0.4 });
        add(new THREE.BoxGeometry(1.5, 2.3, 1), mat, 0, 1.15, 0, g);
        const face = new THREE.MeshBasicMaterial({ map: signTexture([...item.name.split(' '), `${item.cost} pts`], '#141018', '#' + new THREE.Color(item.color).getHexString()) });
        face.color.setScalar(0.3);
        add(new THREE.PlaneGeometry(1.3, 1.3), face, 0, 1.5, 0.51, g);
        z.machines.push({ mat, face });
      } else if (p.kind === 'power') {
        add(new THREE.BoxGeometry(1.4, 2.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x444455, metalness: 0.5, roughness: 0.4 }), 0, 1.2, -0.3, g);
        z.leverMat = new THREE.MeshStandardMaterial({ color: 0xff3d5a, emissive: 0xff3d5a, emissiveIntensity: 0.8 });
        z.lever = add(new THREE.BoxGeometry(0.14, 0.8, 0.14), z.leverMat, 0, 1.5, 0.1, g);
        z.lever.rotation.x = 0.7;
        add(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshBasicMaterial({ map: signTexture(['ELECTRI', 'CIDAD'], '#141018', '#ffd23d') }), 0, 2, -0.04, g);
      } else if (p.kind === 'ammo') {
        add(new THREE.BoxGeometry(1.5, 0.9, 1), new THREE.MeshStandardMaterial({ color: 0x35602a, roughness: 0.8 }), 0, 0.45, 0, g);
        add(new THREE.PlaneGeometry(1.3, 0.7), new THREE.MeshBasicMaterial({ map: signTexture(['MUNICIÓN', '1000 pts'], '#141018', '#6fd13a') }), 0, 0.5, 0.51, g);
      } else if (p.kind === 'grenades') {
        add(new THREE.BoxGeometry(1.5, 0.9, 1), new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.8 }), 0, 0.45, 0, g);
        add(new THREE.PlaneGeometry(1.3, 0.7), new THREE.MeshBasicMaterial({ map: signTexture(['GRANADAS', '500 pts'], '#141018', '#ff8a1f') }), 0, 0.5, 0.51, g);
      } else if (p.kind === 'box') {
        const mat = new THREE.MeshStandardMaterial({ color: 0x2040a0, emissive: 0x3060ff, emissiveIntensity: 0.5, roughness: 0.5 });
        add(new THREE.BoxGeometry(2, 1, 1.1), mat, 0, 0.5, 0, g);
        add(new THREE.PlaneGeometry(1.8, 0.8), new THREE.MeshBasicMaterial({ map: signTexture(['? 950 pts ?'], '#101838', '#ffd23d') }), 0, 0.5, 0.56, g);
        z.box = { x: cx, z: cz, holder: new THREE.Group(), gun: null, gunId: null, state: 'idle', nextSwap: 0 };
        z.box.holder.position.set(cx, 1.6, cz);
        world.add(z.box.holder);
      } else if (p.kind === 'carpenter') {
        // El carpintero: un señor con casco y martillo
        add(new THREE.CapsuleGeometry(0.35, 1, 6, 12), new THREE.MeshStandardMaterial({ color: 0xb06a20 }), 0, 0.85, 0, g);
        add(new THREE.CylinderGeometry(0.34, 0.38, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xffd23d }), 0, 1.72, 0, g);
        add(new THREE.BoxGeometry(0.08, 0.6, 0.08), new THREE.MeshStandardMaterial({ color: 0x6a4a20 }), 0.5, 1, 0.2, g);
        add(new THREE.BoxGeometry(0.28, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.7 }), 0.5, 1.3, 0.2, g);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('Carpintero', 0xffd23d), transparent: true, depthWrite: false }));
        label.scale.set(2, 0.5, 1);
        label.position.set(0, 2.2, 0);
        g.add(label);
      }
    }

    // Luz que acompaña al zombi rojo (siempre existe: añadir luces a media partida recompila shaders)
    this.bossLight = new THREE.PointLight(0xff2020, 0, 16, 1.2);
    this.bossLight.position.y = 2.5;
    world.add(this.bossLight);
    this.extraLight.intensity = 6;

    this.z = z;
    this.zw = createZombieWorld(map);
    this.#rebuildZBoxes();
  }

  #rebuildZBoxes() {
    const z = this.z;
    this.zBoxes = [...z.windowBox, ...z.propBoxes];
    for (const d of z.doors.values()) if (!d.open) this.zBoxes.push(d.box);
  }

  /** Estado del mundo zombi (lo reparte el host). */
  setZombieWorld(zw) {
    const z = this.z;
    if (!z) return;
    this.zw = zw;
    applyDoors(this.map, zw.doors);
    for (const id of zw.doors) {
      const d = z.doors.get(id);
      if (!d || d.open) continue;
      d.open = true;
      d.mesh.visible = false;
      d.sign.visible = false;
      this.solids = this.solids.filter((m) => m !== d.mesh);
      if (this.frozenUntil < performance.now()) sfx.doorSound();
    }
    for (const [id, w] of z.windows) {
      const left = zw.planks[id] ?? MAX_PLANKS;
      w.planks.forEach((p, i) => { p.visible = i < left; });
    }
    if (zw.power && !z.power) this.#powerOn();
    this.#setBoxState(zw.box);
    this.#rebuildZBoxes();
  }

  #powerOn() {
    const z = this.z;
    z.power = true;
    for (const m of z.machines) {
      m.mat.emissiveIntensity = 0.55;
      m.face.color.setScalar(1);
    }
    z.lever.rotation.x = -0.7;
    z.leverMat.color.set(0x3dff7a);
    z.leverMat.emissive.set(0x3dff7a);
    this.extraLight.intensity = 45;
    this.extraLight.distance = 70;
    this.scene.fog.near = 8;
    this.scene.fog.far = 46;
    sfx.powerOnSound();
    this.hud.toast('¡HAY ELECTRICIDAD! Las máquinas funcionan', '#33e0ff');
  }

  #setBoxState(box) {
    const b = this.z.box;
    if (!b || b.state === box.state) return;
    b.state = box.state;
    if (box.state === 'ready') this.#showBoxGun(box.weapon);
    if (box.state === 'idle') this.#showBoxGun(null);
    if (box.state === 'spinning') b.nextSwap = 0;
  }

  #showBoxGun(id) {
    const b = this.z.box;
    if (b.gunId === id) return;
    if (b.gun) { b.holder.remove(b.gun); disposeGroup(b.gun); }
    b.gun = null;
    b.gunId = id;
    if (id) {
      const m = makeGunModel(id, 0xffd23d);
      m.group.scale.setScalar(2.2);
      b.holder.add(m.group);
      b.gun = m.group;
    }
  }

  #updateBox(dt, now) {
    const b = this.z?.box;
    if (!b) return;
    if (b.state === 'spinning' && now >= b.nextSwap) {
      const ids = Object.keys(BOX_WEIGHTS);
      this.#showBoxGun(ids[Math.floor(Math.random() * ids.length)]);
      b.nextSwap = now + 140;
    }
    b.holder.rotation.y += dt * 2;
  }

  /** Lo más cercano que puedo usar (y qué pasaría): { kind, id, ..., info }. */
  #findUseTarget() {
    if (!this.z || !this.zw || !this.alive || this.ended || performance.now() < this.frozenUntil) return null;
    const map = this.map;
    const ctx = { zw: this.zw, player: this.me, who: this.selfId, alive: true, anyDead: this.anyDead?.() ?? false };
    let best = null, bestD = USE_RANGE;
    const check = (t) => {
      const d = Math.hypot(t.x * TILE - this.pos.x, t.y * TILE - this.pos.z);
      if (d >= bestD) return;
      const info = describeUse(t, ctx);
      if (!info) return;
      best = { ...t, info };
      bestD = d;
    };
    for (const d of map.doors) check({ ...d, kind: 'door' });
    for (const w of map.windows) check({ ...w, kind: 'window' });
    for (const b of map.wallBuys) check({ ...b, kind: 'wall' });
    for (const p of map.props) check(p);
    for (const a of this.avatars.values()) {
      if (a.kind === 'player' && a.dead && !a.rv && a.r === this.seed) check({ kind: 'ally', id: a.id, name: a.name, x: a.x / TILE, y: a.z / TILE });
    }
    return best;
  }

  #updatePrompt() {
    const t = this.#findUseTarget();
    this.useTarget = t;
    if (!t) { this.hud.prompt(null); return; }
    const { text, cost, ok, reason } = t.info;
    const progress = t.kind === 'ally' && this.reviveMs > 0 ? ` · ${Math.round((this.reviveMs / REVIVE_MS) * 100)} %` : '';
    this.hud.prompt({ text: `E · ${text}` + (cost ? ` · ${cost} pts` : '') + progress, reason: ok ? null : reason });
  }

  /** Pulsar E (o mantenerlo en una ventana). */
  #use() {
    const t = this.#findUseTarget();
    if (!t || t.kind === 'ally') return; // revivir es manteniendo pulsado (ver #update)
    if (!t.info.ok) { this.hud.toast(t.info.reason, '#ff3d5a'); return; }
    if (t.kind === 'grenades' && this.nades >= GRENADE.max) {
      this.hud.toast('Granadas al máximo', '#ffd23d');
      return;
    }
    if (t.kind === 'wall' && this.owned.includes(t.weapon) && this.ammoFull(t.weapon)) {
      this.hud.toast('Munición llena', '#ffd23d');
      return;
    }
    if (t.kind === 'ammo' && this.owned.every((w) => this.ammoFull(w))) {
      this.hud.toast('Munición llena', '#ffd23d');
      return;
    }
    if (t.kind === 'window') this.repairAt = performance.now() + REPAIR_MS;
    this.onUse({ kind: t.kind, id: t.id, cur: this.weapon });
  }

  #disposeWorld() {
    if (!this.world) return;
    this.world.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mt of mats) { mt.map?.dispose(); mt.dispose(); }
    });
    this.scene.remove(this.world);
    this.world = null;
    for (const pu of this.powerupMeshes.values()) this.scene.remove(pu.mesh);
    this.powerupMeshes.clear();
  }

  #placeMe(tile, h) {
    this.pos = { x: tile.x * TILE, z: tile.y * TILE };
    this.feetY = h ?? Math.max(0, this.map.height(tile.x, tile.y) || 0);
    this.vy = 0;
    this.jumps = 0;
    this.onGround = true;
    this.riding = null;
    if (this.map.kind === 'arena' || this.map.kind === 'training') {
      const c = ((this.map.W - 1) * TILE) / 2;
      const tz = this.map.kind === 'training' ? 0 : c;
      this.yaw = Math.atan2(-(c - this.pos.x), -(tz - this.pos.z));
    } else if (this.map.kind === 'parkour') {
      this.yaw = this.map.startYaw ?? 0; // por defecto la meta está "arriba" (-z)
    } else {
      const dirs = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];
      const open = dirs.find(([dx, dy]) => this.map.height(tile.x + dx, tile.y + dy) === 0);
      this.yaw = open ? open[2] : 0;
    }
    this.pitch = 0;
  }

  #enemyPositions() {
    const out = [];
    for (const a of this.avatars.values()) if (a.group.visible && !a.dead) out.push({ x: a.x, z: a.z });
    return out;
  }

  /** Humanos (para la IA de los bots, solo en el host). */
  humans(selfId) {
    const out = [];
    if (this.active) {
      out.push({
        id: selfId, x: this.pos.x, y: this.feetY, z: this.pos.z,
        alive: !this.dead || this.reviving, inv: performance.now() < this.invulnUntil, ghost: this.has('ghost'),
      });
    }
    for (const a of this.avatars.values()) {
      if (a.kind !== 'player' || a.r !== this.seed || performance.now() - a.lastSeen > 3000) continue;
      out.push({ id: a.id, x: a.x, y: a.y, z: a.z, alive: !a.dead || a.rv, inv: a.inv, ghost: a.ghost });
    }
    return out;
  }

  // ---------- Input ----------

  #bindInput() {
    this.canvas.addEventListener('click', () => this.lock());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.mouseFilter.reset();
      this.hud.paused(this.active && !locked);
      if (!locked) { this.keys.clear(); this.mouseHeld = false; this.setZoom(false); }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (!this.mouseFilter.accept(e.movementX, e.movementY)) return;
      const zoomK = this.zoomed ? WEAPONS[this.currentWeapon].zoom / settings.fov : 1;
      const k = 0.0022 * settings.sens * zoomK;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * k));
    });
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (e.button === 2) { this.setZoom(true); return; }
      if (e.button !== 0) return;
      this.mouseHeld = true;
      this.#shoot();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
      if (e.button === 2) this.setZoom(false);
    });
    document.addEventListener('wheel', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      const list = this.allowedWeapons();
      if (list.length < 2) return;
      const i = list.indexOf(this.weapon);
      this.selectWeapon(list[(i + (e.deltaY > 0 ? 1 : -1) + list.length) % list.length]);
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.#jump(); }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && this.active) {
        const slot = this.allowedWeapons()[Number(digit[1]) - 1];
        if (slot) this.selectWeapon(slot); // hueco vacío: te quedas con la que llevas
      }
      this.keys.add(e.code);
      if (e.code === 'KeyV' && !e.repeat) this.#melee();
      if (e.code === 'KeyE' && !e.repeat && this.active) this.#use();
      if (e.code === 'KeyG' && !e.repeat && this.active) this.#throwGrenade();
      if (e.code === 'KeyR' && this.active && !e.repeat) {
        if (this.ended) this.onRematch();
        else this.reload();
      }
      if (e.code === 'KeyT' && this.active && this.mode === 'training') {
        this.#resetTraining();
        this.refillAmmo();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  #jump() {
    if (!this.active || this.dead || this.ended || performance.now() < this.frozenUntil) return;
    if (this.onGround) {
      this.vy = JUMP_V; this.jumps = 1; this.onGround = false; this.riding = null; sfx.jump();
    } else if (this.has('jump') && this.jumps < 2) {
      this.vy = JUMP_V; this.jumps = 2; sfx.jump();
    }
  }

  // ---------- Bucle ----------

  #frame() {
    const t = performance.now();
    const elapsed = (t - this.lastT) / 1000;
    const dt = Math.min(elapsed, 0.05);
    this.lastT = t;
    if (this.active && this.map) this.#update(dt, t);
    // En tiempo real: con pocos fps dt va limitado y la espoleta duraría mucho más
    if (this.active && this.map) this.#updateGrenades(Math.min(elapsed, 0.25));
    this.#updateBeams(dt);
    this.#updateEffects(dt);
    if (this.portal) this.portal.rotation.y += dt;
    if (this.lavaTex) this.lavaTex.offset.set(Math.sin(t / 3000) * 0.3, t / 20000);
    for (const pu of this.powerupMeshes.values()) animatePowerup(pu.mesh, t / 1000);
    this.renderer.render(this.scene, this.camera);
  }

  #updateMovers() {
    const t = this.elapsed / 1000;
    for (const m of this.movers) {
      m.prev = m.box;
      m.box = moverBox(m.def, t);
      const b = m.box;
      m.mesh.scale.y = Math.max(0.05, b.y1 - b.y0);
      m.mesh.position.set(b.cx, (b.y0 + b.y1) / 2, b.cz);
    }
  }

  /** Cajas dinámicas: objetos móviles + barriles vivos. */
  #dynamicBoxes() {
    const out = this.movers.map((m) => m.box);
    // En zombis no se puede subir a los barriles (los zombis no llegarían a morderte)
    const barrelTop = this.mode === 'zombies' ? this.map.wallH : 1.1;
    for (const b of this.barrelMeshes) if (!this.deadBarrels.has(b.id)) out.push({ cx: b.x, cz: b.z, hx: 0.45, hz: 0.45, y0: 0, y1: barrelTop });
    out.push(...this.zBoxes);
    return out;
  }

  #update(dt, now) {
    this.#updateMovers();

    // Cuenta atrás inicial
    const frozen = now < this.frozenUntil;
    if (frozen) {
      const n = Math.ceil((this.frozenUntil - now) / 1000);
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        const subs = { arena: 'Todos contra todos', gungame: 'Juego de armas: cada baja, arma nueva', zombies: 'Sobrevivid juntos', parkour: 'Llega a la meta sin tocar la lava', maze: 'Encuentra la salida verde' };
        this.hud.message(String(n), subs[this.mode] ?? '');
        sfx.beep();
      }
    } else if (this.lastCountdown !== 0) {
      this.lastCountdown = 0;
      this.hud.message('¡YA!', '');
      sfx.beep(true);
      setTimeout(() => { if (!this.ended) this.hud.message('', ''); }, 700);
    }

    // Muerte / reaparición
    if (this.dead) {
      this.hud.deadCountdown(Number.isFinite(this.deadUntil) ? Math.ceil((this.deadUntil - now) / 1000) : null);
      if (now >= this.deadUntil && !this.ended) {
        // con Segunda Vida te levantas donde caíste; si no, lejos de los enemigos
        if (!this.reviving) this.#placeMe(pickRespawn(this.map, this.#enemyPositions()));
        this.reviving = false;
        this.dead = false;
        this.hp = this.maxHp;
        this.invulnUntil = now + Math.max(this.rules.invulnMs, this.mode === 'zombies' ? 2000 : 0);
        this.hud.dead(false);
        this.hud.health(this.hp, true, this.maxHp);
        sfx.respawn();
        if (!this.rules.keepAmmo) this.refillAmmo(); // al reaparecer, munición llena (en zombis la conservas)
        this.#refreshGun();
        this.#sendState();
      }
    }

    // Regeneración de vida
    if (!this.dead && this.hp < this.maxHp && now - this.lastHurt > REGEN_DELAY) {
      this.hp = Math.min(this.maxHp, this.hp + REGEN_RATE * dt);
      this.hud.health(this.hp, this.mode !== 'parkour' && this.mode !== 'training', this.maxHp);
    }

    // Power-ups que expiran
    for (const [type, until] of Object.entries(this.activePu)) {
      if (until <= now) {
        delete this.activePu[type];
        sfx.powerdown();
        if (type === 'sniper') this.#refreshGun();
      }
    }

    const canMove = !frozen && !this.dead && !this.ended;
    const boxes = this.#dynamicBoxes();

    // Me lleva un objeto móvil
    if (this.riding && this.onGround) {
      const m = this.movers[this.riding];
      if (m) { this.pos.x += m.box.cx - m.prev.cx; this.pos.z += m.box.cz - m.prev.cz; }
    }

    // Movimiento
    if (canMove) {
      let f = 0, s = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
      if (f || s) {
        const len = Math.hypot(f, s);
        const boost = this.has('hyper') ? 2 : this.has('speed') ? 1.75 : 1;
        const sp = (SPEED * boost * (this.zoomed ? 0.5 : 1) * dt) / len;
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const dx = (-sin * f + cos * s) * sp;
        const dz = (-cos * f - sin * s) * sp;
        if (!this.#blocked(this.pos.x + dx, this.pos.z, this.feetY, boxes)) this.pos.x += dx;
        if (!this.#blocked(this.pos.x, this.pos.z + dz, this.feetY, boxes)) this.pos.z += dz;
      }
    }
    // Empujón de muros deslizantes
    if (!this.dead) this.#pushOut(boxes);

    // Gravedad y suelo
    if (!this.dead) {
      this.vy -= GRAVITY * (this.has('moon') ? 0.35 : 1) * dt;
      let ny = this.feetY + this.vy * dt;
      const { h: ground, mover } = this.#groundAt(this.pos.x, this.pos.z, this.feetY);
      if (ny <= ground) {
        ny = ground; this.vy = 0; this.onGround = true; this.jumps = 0; this.riding = mover;
      } else { this.onGround = false; this.riding = null; }
      if (this.map.ceiling && ny + EYE + 0.15 > this.map.wallH) { ny = this.map.wallH - EYE - 0.15; this.vy = Math.min(this.vy, 0); }
      this.feetY = ny;
      // Lava: vuelta al último checkpoint
      if (this.map.lava && this.feetY < -0.4) {
        this.#placeMe(this.checkpoint, this.checkpoint.h);
        sfx.death();
        this.hud.hurt();
        this.hud.toast('¡LAVA!', '#ff6a00');
      }
    }

    // Parkour: checkpoints, cronómetro, power-ups locales
    if (this.mode === 'parkour' && canMove) {
      const t = tileOf(this.pos.x, this.pos.z);
      for (const c of this.checkpointMeshes) {
        if (c.x === t.x && c.y === t.y && this.onGround && (this.checkpoint.x !== c.x || this.checkpoint.y !== c.y)) {
          this.checkpoint = { x: c.x, y: c.y, h: c.h };
          c.ring.material.color.set(0x3dff7a);
          sfx.powerup();
          this.hud.toast('CHECKPOINT', '#33e0ff');
        }
      }
      this.hud.timer((now - this.timerStart) / 1000);
    }
    if (this.map.localPowerups) this.#localPowerups(now);

    // Salida / meta
    const goal = this.map.exit ?? this.map.finish;
    if (canMove && goal) {
      const t = tileOf(this.pos.x, this.pos.z);
      if (t.x === goal.x && t.y === goal.y && !this.exitSent && (this.mode !== 'parkour' || this.onGround)) {
        this.exitSent = true;
        this.onReachExit((now - this.timerStart) / 1000);
      }
    }

    // Recoger power-ups (los de red)
    if (canMove) {
      for (const [id, pu] of this.powerupMeshes) {
        if (pu.local || this.picked.has(id)) continue;
        const d = Math.hypot(pu.x * TILE - this.pos.x, pu.y * TILE - this.pos.z);
        if (d < 1.2 && Math.abs(this.feetY - pu.mesh.position.y) < 1.5) {
          this.picked.add(id);
          this.onPick(id);
        }
      }
    }

    // Recarga
    if (this.reloadUntil && now >= this.reloadUntil) this.#finishReload();

    // Zombis: mantener E repara la ventana; la caja gira
    if (this.z) {
      this.#updateBox(dt, now);
      if (this.keys.has('KeyE') && this.useTarget?.kind === 'window' && now >= this.repairAt) this.#use();
      // Revivir: mantener E junto a un compañero caído
      if (this.keys.has('KeyE') && this.useTarget?.kind === 'ally' && this.alive) {
        this.reviveStart ||= now; // en tiempo real: no debe tardar más con pocos fps
        this.reviveMs = now - this.reviveStart;
        if (this.reviveMs >= REVIVE_MS) {
          this.reviveStart = 0;
          this.reviveMs = 0;
          this.onUse({ kind: 'ally', id: this.useTarget.id });
          this.useTarget = null;
        }
      } else { this.reviveStart = 0; this.reviveMs = 0; }
      if (this.bossLight && this.bossId) {
        const boss = this.avatars.get(this.bossId);
        if (boss) { this.bossLight.position.set(boss.x, 2.5, boss.z); this.bossLight.intensity = 40; }
      }
    }

    // Disparo automático
    this.cooldown = Math.max(0, this.cooldown - dt);
    const w = WEAPONS[this.currentWeapon];
    if (this.mouseHeld && w && (w.auto || this.has('auto'))) this.#shoot();

    // Entrenamiento
    if (this.mode === 'training') this.#updateTraining(now);

    // Cámara
    const moving = canMove && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => this.keys.has(k));
    const fast = this.has('hyper') || this.has('speed');
    const bob = moving && this.onGround ? Math.sin(now / (fast ? 60 : 90)) * 0.03 : 0;
    this.shake = Math.max(0, (this.shake ?? 0) - dt * 2);
    const sh = this.shake * 0.15;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * sh,
      (this.dead ? this.feetY + 0.35 : this.feetY + EYE + bob) + (Math.random() - 0.5) * sh,
      this.pos.z
    );
    this.camera.rotation.set(this.pitch + (this.recoil ?? 0), this.yaw, this.dead ? 0.6 : 0);
    this.recoil = Math.max(0, (this.recoil ?? 0) - dt * 0.6);
    this.gunHolder.visible = !this.dead;
    const targetFov = this.zoomed ? w.zoom : settings.fov + (this.has('hyper') ? 18 : this.has('speed') ? 12 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * (this.zoomed ? 20 : 8));
      this.camera.updateProjectionMatrix();
    }
    if (this.gun) {
      const inv = now < this.invulnUntil;
      this.gun.tip.material.color.set(inv && Math.floor(now / 120) % 2 ? 0xffffff : this.perks.has('pap') ? 0xffd23d : this.myColor);
      this.gunHolder.position.z += (-0.46 - this.gunHolder.position.z) * Math.min(1, dt * 15);
      // animación del puñetazo: el arma baja hacia un lado
      this.punchAnim = Math.max(0, (this.punchAnim ?? 0) - dt * 4);
      this.gunHolder.rotation.z = this.punchAnim * 0.9;
      this.gunHolder.position.x = 0.22 - this.punchAnim * 0.15;
      // animación de recarga: el arma baja e inclina
      const rk = this.reloadUntil ? 1 : 0;
      this.gunHolder.rotation.x += (rk * -0.8 - this.gunHolder.rotation.x) * Math.min(1, dt * 12);
      this.gunHolder.position.y += (-0.2 - rk * 0.12 - this.gunHolder.position.y) * Math.min(1, dt * 12);
    }

    // Avatares (interpolados)
    const k = 1 - Math.exp(-dt * 15);
    for (const a of this.avatars.values()) {
      if (a.r !== this.seed || now - a.lastSeen > 3000) { a.group.visible = false; continue; }
      a.x += (a.tx - a.x) * k;
      a.y += (a.ty - a.y) * k;
      a.z += (a.tz - a.z) * k;
      let dy = a.tyaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.yaw += dy * k;
      a.group.visible = true;
      a.group.position.set(a.x, a.y + (a.kind === 'zombie' ? Math.abs(Math.sin(now / 150 + a.x)) * 0.08 : 0), a.z);
      a.body.rotation.y = a.yaw;
      // Zombis: un compañero caído se queda tumbado y pide ayuda
      const downed = a.dead && a.kind === 'player' && this.mode === 'zombies';
      if (downed !== !!a.downed) {
        a.downed = downed;
        a.body.rotation.x = downed ? Math.PI / 2 : 0;
        a.body.position.y = downed ? 0.4 : 0;
        this.#setLabel(a, downed ? '¡REVÍVEME!' : a.name || '???', downed ? 0xff3d5a : a.color);
      }
      a.body.visible = !a.dead || downed;
      a.label.visible = (!a.dead || downed) && !a.ghost;
      if (a.hpBg) { a.hpBg.visible = !a.dead; a.hpFg.visible = !a.dead; }
      if (a.light) a.light.intensity = a.dead || a.ghost ? 0 : 5; // nunca quitar luces: recompila shaders
      a.mat.opacity = a.ghost ? 0.12 : a.inv ? 0.35 + 0.25 * Math.sin(now / 60) : 1;
    }

    // HUD de power-ups (~10 Hz)
    this.puHudTimer = (this.puHudTimer ?? 0) + dt;
    if (this.puHudTimer > 0.1) {
      this.puHudTimer = 0;
      if (this.z) this.#updatePrompt();
      this.#updateMinimap(now);
      this.hud.powerups(Object.entries(this.activePu).map(([type, until]) => ({
        type, left: (until - now) / 1000, frac: (until - now) / (POWERUPS[type].duration * 1000),
      })));
    }

    // Red
    this.netTimer += dt;
    if (this.netTimer >= NET_INTERVAL) { this.netTimer = 0; this.#sendState(); }
  }

  #updateMinimap(now) {
    if (!this.minimap?.active) return;
    const allies = [], foes = [];
    for (const a of this.avatars.values()) {
      if (!a.group.visible) continue;
      if (a.kind === 'zombie' && !a.dead) foes.push(a);
      else if (a.kind === 'player' && this.mode === 'zombies') allies.push(a);
    }
    this.minimap.render({ me: { x: this.pos.x, z: this.pos.z, yaw: this.yaw }, allies, foes, zw: this.zw, now });
  }

  #localPowerups(now) {
    for (const p of this.map.localPowerups) {
      const hiddenUntil = this.localPuHidden.get(p.id) ?? 0;
      const has = this.powerupMeshes.has(p.id);
      if (!has && now >= hiddenUntil) this.#addPowerupMesh(p, true);
      if (has && this.alive) {
        const pu = this.powerupMeshes.get(p.id);
        const d = Math.hypot(p.x * TILE - this.pos.x, p.y * TILE - this.pos.z);
        if (d < 1.4 && Math.abs(this.feetY - pu.mesh.position.y) < 1.5) {
          this.scene.remove(pu.mesh);
          this.powerupMeshes.delete(p.id);
          this.localPuHidden.set(p.id, now + 4000);
          this.applyPowerup(p.type);
        }
      }
    }
  }

  #sendState() {
    if (this.solo || !this.net) return;
    this.net.st({
      r: this.seed,
      p: [+this.pos.x.toFixed(2), +this.feetY.toFixed(2), +this.pos.z.toFixed(2)],
      yw: +this.yaw.toFixed(3),
      d: this.dead ? 1 : 0,
      i: performance.now() < this.invulnUntil ? 1 : 0,
      rv: this.dead && this.reviving ? 1 : 0,
      g: this.has('ghost') ? 1 : 0,
      w: this.currentWeapon ?? '',
    });
  }

  // ---------- Colisiones ----------

  #blocked(x, z, feetY, boxes) {
    const r = RADIUS, h = TILE / 2;
    const x0 = Math.round((x - r) / TILE), x1 = Math.round((x + r) / TILE);
    const y0 = Math.round((z - r) / TILE), y1 = Math.round((z + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const th = this.map.height(tx, ty);
      if (th <= feetY + 0.05) continue;
      const half = th === WALL ? h : h * 0.96;
      const cx = Math.max(tx * TILE - half, Math.min(x, tx * TILE + half));
      const cz = Math.max(ty * TILE - half, Math.min(z, ty * TILE + half));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    for (const b of boxes) {
      if (b.y1 <= feetY + 0.05 || b.y0 >= feetY + 1.7) continue;
      if (circleBox(x, z, r, b)) return true;
    }
    return false;
  }

  /** Si un muro deslizante se me mete encima, me empuja fuera. */
  #pushOut(boxes) {
    for (const b of boxes) {
      if (b.y1 <= this.feetY + 0.05 || b.y0 >= this.feetY + 1.7) continue;
      const cx = Math.max(b.cx - b.hx, Math.min(this.pos.x, b.cx + b.hx));
      const cz = Math.max(b.cz - b.hz, Math.min(this.pos.z, b.cz + b.hz));
      let dx = this.pos.x - cx, dz = this.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= RADIUS) continue;
      if (d < 1e-4) { dx = this.pos.x - b.cx; dz = this.pos.z - b.cz; }
      const len = Math.hypot(dx, dz) || 1;
      const push = RADIUS - d + 0.01;
      this.pos.x += (dx / len) * push;
      this.pos.z += (dz / len) * push;
    }
  }

  /** Altura del suelo bajo el jugador (y si es un objeto móvil, cuál). */
  #groundAt(x, z, feetY) {
    const r = RADIUS * 0.7, h = (TILE / 2) * 0.96;
    let g = this.map.lava ? LAVA - 5 : 0;
    let mover = null;
    const x0 = Math.round((x - r) / TILE), x1 = Math.round((x + r) / TILE);
    const y0 = Math.round((z - r) / TILE), y1 = Math.round((z + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const th = this.map.height(tx, ty);
      if (th === WALL || th <= g || th === LAVA) continue;
      const cx = Math.max(tx * TILE - h, Math.min(x, tx * TILE + h));
      const cz = Math.max(ty * TILE - h, Math.min(z, ty * TILE + h));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) g = th;
    }
    // objetos móviles y barriles: se puede estar encima (y un pistón que sube te eleva)
    const boxes = this.#dynamicBoxes();
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.y1 <= g || b.y1 > feetY + 0.4) continue;
      if (circleBox(x, z, r, b)) { g = b.y1; mover = i < this.movers.length ? i : null; }
    }
    return { h: g, mover };
  }

  // ---------- Disparo ----------

  #shoot() {
    const id = this.currentWeapon;
    const w = WEAPONS[id];
    if (!w || !this.active || this.dead || this.ended || this.cooldown > 0 || performance.now() < this.frozenUntil) return;
    if (this.reloadUntil) return;
    const ammo = this.ammoOf(id);
    if (ammo.mag <= 0) {
      this.cooldown = 0.3;
      if (ammo.reserve > 0) this.reload();
      else { sfx.emptyClick(); this.hud.toast('¡SIN MUNICIÓN!', '#ff3d5a'); }
      return;
    }
    ammo.mag--;
    const burst = this.has('auto');
    this.cooldown = w.cd * (burst ? (w.auto ? 0.7 : 0.45) : 1) * (this.perks.has('doubletap') ? 0.66 : 1);
    const dmgMult = this.perks.has('pap') ? 2 : 1;
    this.camera.updateMatrixWorld();
    const base = new THREE.Vector3();
    this.camera.getWorldDirection(base);
    const spread = this.zoomed ? (w.zoomSpread ?? 0) : w.spread;
    const muzzle = this.zoomed
      ? this.camera.position.clone().addScaledVector(base, 0.3).add(new THREE.Vector3(0, -0.15, 0))
      : this.gun.tip.getWorldPosition(new THREE.Vector3());

    const targets = [...this.solids];
    for (const a of this.avatars.values()) if (a.group.visible && !a.dead && !a.inv) targets.push(a.hitbox);
    for (const b of this.barrelMeshes) if (!this.deadBarrels.has(b.id)) targets.push(...b.hit);
    for (const t of this.targets) if (t.group.visible) targets.push(t.disc);

    const ends = [];
    this.trainHit = false;
    const dmgTo = new Map(); // id -> { dmg, hs }
    let anyHit = false, anyHs = false;
    for (let p = 0; p < w.pellets; p++) {
      const dir = base.clone();
      if (spread > 0) {
        dir.x += (Math.random() - 0.5) * spread * 2;
        dir.y += (Math.random() - 0.5) * spread * 2;
        dir.z += (Math.random() - 0.5) * spread * 2;
        dir.normalize();
      }
      this.raycaster.set(this.camera.position, dir);
      this.raycaster.far = w.range;
      const hit = this.raycaster.intersectObjects(targets, false)[0];
      const end = hit ? hit.point : this.camera.position.clone().addScaledVector(dir, w.range);
      ends.push(end);
      if (!hit) continue;
      const ud = hit.object.userData;
      if (ud.peerId) {
        const a = this.avatars.get(ud.peerId);
        const hs = a && hit.point.y - a.y > (a.headY ?? 1.38);
        const dmg = w.dmg * dmgMult * (hs ? (w.headshot ?? HEADSHOT) : 1);
        const prev = dmgTo.get(ud.peerId) ?? { dmg: 0, hs: false };
        dmgTo.set(ud.peerId, { dmg: prev.dmg + dmg, hs: prev.hs || hs });
        anyHit = true; anyHs ||= hs;
      } else if (ud.entityId) {
        dmgTo.set(ud.entityId, { dmg: (dmgTo.get(ud.entityId)?.dmg ?? 0) + w.dmg * dmgMult, hs: false });
      } else if (ud.targetIdx !== undefined) {
        const t = this.targets[ud.targetIdx];
        const local = t.disc.worldToLocal(hit.point.clone());
        const hs = Math.hypot(local.x, local.y) < t.r * 0.25;
        this.#hitTarget(t, w.dmg * dmgMult * (hs ? HEADSHOT : 1), hs);
        anyHit = true; anyHs ||= hs;
      }
    }
    const beamColor = this.perks.has('pap') ? 0xffd23d : this.myColor;
    for (const end of ends) this.#spawnBeam(muzzle, end, beamColor, w.width * (this.perks.has('pap') ? 1.6 : 1));
    sfx.laser(burst ? 0.7 : 1, w.pitch);
    this.gunHolder.position.z = -0.46 + w.kick;
    this.recoil = Math.min(0.12, (this.recoil ?? 0) + w.kick * 0.25);
    if (this.mode === 'training') { this.trainStats.shots++; if (this.trainHit) this.trainStats.hits++; }

    for (const [targetId, { dmg, hs }] of dmgTo) {
      const a = this.avatars.get(targetId);
      if (a?.kind === 'player') {
        if (this.net) this.net.hit({ r: this.seed, dmg: Math.round(dmg), w: id }, targetId);
      } else {
        this.onEntityHit(targetId, Math.round(dmg), id);
      }
      if (a) { anyHit = true; anyHs ||= hs; }
    }
    if (anyHit) { sfx.hit(); this.hud.hitmarker(anyHs); }
    if (ammo.mag <= 0 && ammo.reserve > 0) this.reload();
    this.#ammoHud();

    if (!this.solo && this.net) {
      this.net.shot({ a: muzzle.toArray().map((v) => +v.toFixed(2)), e: ends.map((e) => e.toArray().map((v) => +v.toFixed(2))), w: id });
    }
  }

  /** Puñetazo (V): corto alcance, sirve en todos los modos con armas. */
  #melee() {
    const now = performance.now();
    if (!this.alive || this.ended || now < this.frozenUntil || now < this.meleeCd) return;
    if (this.mode === 'parkour') return;
    this.meleeCd = now + MELEE.cd * 1000;
    this.punchAnim = 1;
    sfx.punch();
    this.camera.updateMatrixWorld();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.raycaster.set(this.camera.position, dir);
    this.raycaster.far = MELEE.range;
    const targets = [];
    for (const a of this.avatars.values()) if (a.group.visible && !a.dead && !a.inv) targets.push(a.hitbox);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return;
    const id = hit.object.userData.peerId;
    const a = this.avatars.get(id);
    const dmg = this.perks.has('punch') ? MELEE.punchDmg : MELEE.dmg;
    if (a.kind === 'player') this.net?.hit({ r: this.seed, dmg, w: 'punch' }, id);
    else this.onEntityHit(id, dmg, 'punch');
    sfx.hit();
    this.hud.hitmarker(this.perks.has('punch'));
  }

  #spawnBeam(a, b, color, width = 0.035) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.01) return;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(width, width, len, 6, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.scene.add(mesh);
    this.beams.push({ mesh, t: 0 });
  }

  #updateBeams(dt) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      b.mesh.material.opacity = Math.max(0, 1 - b.t / 0.18);
      if (b.t >= 0.18) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.beams.splice(i, 1);
      }
    }
  }

  #updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      const k = e.t / e.dur;
      e.mesh.scale.setScalar(0.5 + k * e.grow);
      e.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  // ---------- Entrenamiento ----------

  #resetTraining() {
    this.trainStats = { shots: 0, hits: 0, kills: 0, seriesStart: performance.now(), downInSeries: new Set(), lastSeries: null };
    for (const t of this.targets ?? []) { t.hp = 100; t.downUntil = 0; t.group.visible = true; }
    this.#trainingHud();
  }

  #hitTarget(t, dmg, hs) {
    const s = this.trainStats;
    this.trainHit = true;
    t.hp -= dmg;
    if (t.hp > 0) return;
    s.kills++;
    t.hp = 100;
    t.downUntil = performance.now() + 1200;
    t.group.visible = false;
    s.downInSeries.add(t.idx);
    if (hs) this.hud.toast('¡DIANA!', '#ffd23d');
    if (s.downInSeries.size === this.targets.length) {
      const time = (performance.now() - s.seriesStart) / 1000;
      s.lastSeries = time;
      this.hud.trainingRecord(this.currentWeapon, time);
      s.downInSeries.clear();
      s.seriesStart = performance.now();
      sfx.win();
    }
    this.#trainingHud();
  }

  #updateTraining(now) {
    const t = this.elapsed / 1000;
    for (const tg of this.targets) {
      if (!tg.group.visible && now >= tg.downUntil) tg.group.visible = true;
      let x = tg.x * TILE, y = 0;
      const z = tg.y * TILE;
      if (tg.move?.axis === 'x') x += Math.sin((2 * Math.PI * t) / tg.move.period) * tg.move.amp * TILE;
      if (tg.move?.axis === 'y') y = (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / tg.move.period)) * tg.move.amp - 0.6;
      tg.group.position.set(x, y, z);
      tg.group.rotation.y = Math.atan2(this.pos.x - x, this.pos.z - z);
    }
    this.trainHudT = (this.trainHudT ?? 0) + 1;
    if (this.trainHudT % 10 === 0) this.#trainingHud();
  }

  #trainingHud() {
    const s = this.trainStats;
    this.hud.training({
      weapon: this.currentWeapon,
      shots: s.shots, hits: s.hits, kills: s.kills,
      series: s.downInSeries.size, total: this.targets.length,
      time: (performance.now() - s.seriesStart) / 1000, last: s.lastSeries,
    });
  }

  #resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

function circleBox(x, z, r, b) {
  const cx = Math.max(b.cx - b.hx, Math.min(x, b.cx + b.hx));
  const cz = Math.max(b.cz - b.hz, Math.min(z, b.cz + b.hz));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}
