import * as THREE from 'three';
import { TILE, WALL, generateMaze, generateArena, MAZE_SIZES } from './maps.js';
import { initialSpawns, pickRespawn } from './spawn.js';
import { POWERUPS, makePowerupMesh, animatePowerup } from './powerups.js';
import * as sfx from './audio.js';
import { settings } from './settings.js';

export const PALETTE = [0x33e0ff, 0xff3df2, 0xffd23d, 0x3dff7a, 0xff7a3d, 0xa07aff, 0xff3d5a, 0xffffff];

const EYE = 1.6;
const RADIUS = 0.35;
const SPEED = 5.5;
const SPEED_BOOST = 1.75;
const GRAVITY = 20;
const JUMP_V = 6.2; // ~0.95 m de salto; con doble salto se llega a las cajas altas
const FIRE_CD = 0.35;
const AUTO_CD = 0.09;
const COUNTDOWN_MS = 3000;
const NET_INTERVAL = 1 / 20;

export const RULES = {
  maze: { deathMs: 3000, invulnMs: 0 },
  arena: { deathMs: 2000, invulnMs: 1500 },
};

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
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
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 300);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0x9a8cff, 0x201830, 1.1));

    this.myColor = PALETTE[0];
    this.myLight = new THREE.PointLight(this.myColor, 6, 14, 1.2);
    this.camera.add(this.myLight);

    // Pistola
    this.gun = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.6, roughness: 0.3 })
    );
    this.gunTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.myColor })
    );
    this.gunTip.position.z = -0.2;
    this.gun.add(body, this.gunTip);
    this.gun.position.set(0.2, -0.18, -0.5);
    this.camera.add(this.gun);

    this.avatars = new Map(); // peerId -> avatar
    this.powerupMeshes = new Map(); // id -> { mesh, type, x, y }
    this.world = null;
    this.beams = [];
    this.raycaster = new THREE.Raycaster();
    this.keys = new Set();
    this.mouseHeld = false;
    this.yaw = 0;
    this.pitch = 0;
    this.active = false;
    this.ended = true;
    this.active_pu = {}; // tipo -> timestamp de expiración

    // Callbacks que rellena main.js
    this.onReachExit = () => {};
    this.onRematch = () => {};
    this.onDied = () => {};
    this.onPick = () => {};
    this.net = null; // { st, shot, hit }

    this.#bindInput();
    window.addEventListener('resize', () => this.#resize());
    this.#resize();
    this.lastT = performance.now();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  // ---------- Jugadores ----------

  setMyColor(colorIdx) {
    this.myColor = PALETTE[colorIdx % PALETTE.length];
    this.myLight.color.set(this.myColor);
    this.gunTip.material.color.set(this.myColor);
  }

  addPeer(id) {
    if (this.avatars.has(id)) return this.avatars.get(id);
    const color = PALETTE[1];
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, transparent: true });
    const body = new THREE.Group();
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 6, 12), mat);
    capsule.position.y = 0.85;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    visor.position.set(0, 1.45, -0.28);
    const oGun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x333344 }));
    oGun.position.set(0.35, 1.1, -0.35);
    body.add(capsule, visor, oGun);
    const light = new THREE.PointLight(color, 5, 10, 1.2);
    light.position.y = 1.2;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
    label.scale.set(2, 0.5, 1);
    label.position.y = 2.25;
    group.add(body, light, label);
    group.visible = false;
    this.scene.add(group);
    capsule.userData.peerId = id;
    const a = {
      id, group, body, mat, light, label, hitbox: capsule, color, name: '',
      x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0,
      dead: true, inv: false, r: null, fresh: true,
    };
    this.avatars.set(id, a);
    return a;
  }

  removePeer(id) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    a.group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    this.avatars.delete(id);
  }

  setPeerInfo(id, { name, color }) {
    const a = this.addPeer(id);
    const c = PALETTE[color % PALETTE.length];
    if (a.color !== c) {
      a.color = c;
      a.mat.color.set(c);
      a.mat.emissive.set(c);
      a.light.color.set(c);
      a.name = null; // forzar re-render de la etiqueta
    }
    if (name !== a.name) {
      a.name = name;
      a.label.material.map?.dispose();
      a.label.material.map = labelTexture(name || '???', c);
      a.label.material.needsUpdate = true;
    }
  }

  // ---------- Ronda ----------

  /**
   * mode: 'maze' | 'arena'; spawnIndex: índice en los spawns iniciales, o -1 para reaparecer aleatorio.
   */
  startRound({ seed, mode, diff = 'dificil', players = 1, spawnIndex = 0, solo = false }) {
    this.#disposeWorld();
    this.mode = mode;
    this.rules = RULES[mode];
    this.map = mode === 'arena' ? generateArena(seed) : generateMaze(seed, MAZE_SIZES[diff] ?? 12);
    this.seed = seed;
    this.solo = solo;
    this.#buildWorld();

    for (const a of this.avatars.values()) { a.r = null; a.group.visible = false; a.fresh = true; }

    const spawn = spawnIndex >= 0
      ? initialSpawns(this.map, Math.max(players, spawnIndex + 1))[spawnIndex]
      : pickRespawn(this.map, this.#enemyPositions());
    this.#placeMe(spawn);

    this.dead = false;
    this.deadUntil = 0;
    this.invulnUntil = 0;
    this.ended = false;
    this.exitSent = false;
    this.cooldown = 0;
    this.netTimer = 0;
    this.active_pu = {};
    this.picked = new Set();
    this.setPowerups([]);
    this.frozenUntil = spawnIndex >= 0 ? performance.now() + COUNTDOWN_MS : performance.now();
    this.lastCountdown = spawnIndex >= 0 ? null : 0;
    this.active = true;
    this.hud.overlay(false);
    this.hud.dead(false);
    this.hud.message('', '');
  }

  endRound(title, sub, iWon) {
    if (this.ended) return;
    this.ended = true;
    this.mouseHeld = false;
    this.hud.dead(false);
    (iWon ? sfx.win : sfx.lose)();
    this.hud.message(title, sub);
  }

  stop(msg = '', sub = '') {
    this.active = false;
    this.ended = true;
    for (const a of this.avatars.values()) a.group.visible = false;
    this.setPowerups([]);
    this.hud.message(msg, sub);
    this.hud.dead(false);
    this.hud.powerups([]);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  lock() {
    if (this.active) this.canvas.requestPointerLock();
  }

  // ---------- Eventos de red ----------

  remoteState(id, { r, p, yw, d, i }) {
    const a = this.avatars.get(id);
    if (!a || r !== this.seed) return;
    const wasDead = a.dead;
    a.tx = p[0]; a.ty = p[1]; a.tz = p[2]; a.tyaw = yw;
    a.dead = !!d;
    a.inv = !!i;
    if (a.r !== r || a.fresh || (wasDead && !d)) {
      // primera vez o reaparición: teletransporte en vez de interpolar a través de las paredes
      a.x = a.tx; a.y = a.ty; a.z = a.tz; a.yaw = yw;
      a.fresh = false;
    }
    a.r = r;
    a.lastSeen = performance.now();
  }

  remoteShot(id, { a: from, b: to }) {
    const av = this.avatars.get(id);
    const color = av ? av.color : PALETTE[1];
    const va = new THREE.Vector3(...from);
    const vb = new THREE.Vector3(...to);
    this.#spawnBeam(va, vb, color);
    const d = va.distanceTo(this.camera.position);
    sfx.laser(Math.max(0, 1 - d / 40) * 0.8, 0.85);
  }

  gotHit(fromId, { r }) {
    const now = performance.now();
    if (r !== this.seed || this.dead || this.ended || !this.active || now < this.invulnUntil) return;
    this.dead = true;
    this.deadUntil = now + this.rules.deathMs;
    this.keys.clear();
    this.mouseHeld = false;
    if (Object.keys(this.active_pu).length) this.active_pu = {};
    sfx.death();
    this.hud.dead(true);
    this.#sendState();
    this.onDied(fromId);
  }

  // ---------- Power-ups ----------

  /** list: [{ id, type, x, y }] en casillas. Sincroniza los modelos 3D. */
  setPowerups(list) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, pu] of this.powerupMeshes) {
      if (!ids.has(id)) { this.scene.remove(pu.mesh); this.powerupMeshes.delete(id); }
    }
    for (const p of list) {
      if (this.powerupMeshes.has(p.id)) continue;
      const mesh = makePowerupMesh(p.type);
      mesh.position.set(p.x * TILE, this.map ? this.map.height(p.x, p.y) || 0 : 0, p.y * TILE);
      this.scene.add(mesh);
      this.powerupMeshes.set(p.id, { mesh, ...p });
    }
  }

  applyPowerup(type) {
    if (this.dead || !POWERUPS[type]) return;
    this.active_pu[type] = performance.now() + POWERUPS[type].duration * 1000;
    sfx.powerup();
    this.hud.toast(POWERUPS[type].label + '!', POWERUPS[type].color);
  }

  has(type) {
    return (this.active_pu[type] ?? 0) > performance.now();
  }

  // ---------- Construcción del mundo ----------

  #buildWorld() {
    const map = this.map;
    const { W, H, wallH } = map;
    const world = new THREE.Group();
    const arena = map.kind === 'arena';

    this.scene.fog.near = arena ? 18 : 3;
    this.scene.fog.far = arena ? 70 : 26;
    this.scene.background.set(arena ? 0x0a0518 : 0x06030c);
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

    // Agrupar casillas por altura -> un InstancedMesh por altura
    const groups = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = map.height(x, y);
      if (v === 0) continue;
      const key = v === WALL ? 'wall' : String(v);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([x, y]);
    }
    this.solids = [];
    const m = new THREE.Matrix4();
    for (const [key, tiles] of groups) {
      const isWall = key === 'wall';
      const height = isWall ? wallH : Number(key);
      const size = isWall ? TILE : TILE * 0.96;
      const mat = new THREE.MeshStandardMaterial({ map: isWall ? wallTex : crateTex, roughness: 0.85 });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, height, size), mat, tiles.length);
      tiles.forEach(([x, y], i) => {
        m.makeTranslation(x * TILE, height / 2, y * TILE);
        mesh.setMatrixAt(i, m);
      });
      mesh.computeBoundingSphere();
      world.add(mesh);
      this.solids.push(mesh);
    }

    const floorTex = canvasTexture(32, (g, s) => {
      g.fillStyle = '#120d1c'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#1d1530'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(W, H);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE, H * TILE), new THREE.MeshStandardMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(((W - 1) * TILE) / 2, 0, ((H - 1) * TILE) / 2);
    world.add(floor);

    if (map.ceiling) {
      const ceiling = new THREE.Mesh(floor.geometry, new THREE.MeshStandardMaterial({ color: 0x0b0814 }));
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(floor.position.x, wallH, floor.position.z);
      world.add(ceiling);
    } else {
      // Cielo con estrellas
      const pts = [];
      for (let i = 0; i < 600; i++) {
        const v = new THREE.Vector3().randomDirection();
        v.y = Math.abs(v.y) * 0.8 + 0.1;
        v.normalize().multiplyScalar(140);
        pts.push(v.x + floor.position.x, v.y, v.z + floor.position.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      world.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, fog: false })));
    }

    this.portal = null;
    if (map.exit) {
      const { exit } = map;
      const portal = new THREE.Mesh(
        new THREE.BoxGeometry(TILE * 0.8, wallH * 0.9, TILE * 0.8),
        new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.35, depthWrite: false })
      );
      portal.position.set(exit.x * TILE, (wallH * 0.9) / 2, exit.y * TILE);
      world.add(portal);
      this.portal = portal;
    }
    // Siempre una luz extra (salida o centro de la arena) para no cambiar el nº de luces entre modos
    const extraLight = new THREE.PointLight(map.exit ? 0x3dff7a : 0xa07aff, map.exit ? 12 : 20, map.exit ? 12 : 30, 1.2);
    extraLight.position.set(
      map.exit ? map.exit.x * TILE : floor.position.x,
      map.exit ? 1.5 : 4,
      map.exit ? map.exit.y * TILE : floor.position.z
    );
    world.add(extraLight);

    this.scene.add(world);
    this.world = world;
  }

  #disposeWorld() {
    if (!this.world) return;
    this.world.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.scene.remove(this.world);
    this.world = null;
  }

  #placeMe(tile) {
    this.pos = { x: tile.x * TILE, z: tile.y * TILE };
    this.feetY = this.map.height(tile.x, tile.y) || 0;
    this.vy = 0;
    this.jumps = 0;
    this.onGround = true;
    const dirs = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];
    if (this.map.kind === 'arena') {
      // mirar hacia el centro
      const c = ((this.map.W - 1) * TILE) / 2;
      this.yaw = Math.atan2(-(c - this.pos.x), -(c - this.pos.z));
    } else {
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

  // ---------- Input ----------

  #bindInput() {
    this.canvas.addEventListener('click', () => this.lock());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.hud.paused(this.active && !locked);
      if (!locked) { this.keys.clear(); this.mouseHeld = false; }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      const k = 0.0022 * settings.sens;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * k));
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || document.pointerLockElement !== this.canvas) return;
      this.mouseHeld = true;
      this.#shoot();
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseHeld = false; });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.#jump(); }
      this.keys.add(e.code);
      if (e.code === 'KeyR' && this.ended && this.active) this.onRematch();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  #jump() {
    if (!this.active || this.dead || this.ended || performance.now() < this.frozenUntil) return;
    if (this.onGround) {
      this.vy = JUMP_V; this.jumps = 1; this.onGround = false; sfx.jump();
    } else if (this.has('jump') && this.jumps < 2) {
      this.vy = JUMP_V; this.jumps = 2; sfx.jump();
    }
  }

  // ---------- Bucle ----------

  #frame() {
    const t = performance.now();
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    if (this.active && this.map) this.#update(dt, t);
    this.#updateBeams(dt);
    if (this.portal) this.portal.rotation.y += dt;
    for (const pu of this.powerupMeshes.values()) animatePowerup(pu.mesh, t / 1000);
    this.renderer.render(this.scene, this.camera);
  }

  #update(dt, now) {
    // Cuenta atrás inicial
    const frozen = now < this.frozenUntil;
    if (frozen) {
      const n = Math.ceil((this.frozenUntil - now) / 1000);
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        this.hud.message(String(n), this.mode === 'arena' ? 'Todos contra todos' : 'Encuentra la salida verde');
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
      this.hud.deadCountdown(Math.ceil((this.deadUntil - now) / 1000));
      if (now >= this.deadUntil && !this.ended) {
        this.#placeMe(pickRespawn(this.map, this.#enemyPositions()));
        this.dead = false;
        this.invulnUntil = now + this.rules.invulnMs;
        this.hud.dead(false);
        sfx.respawn();
        this.#sendState();
      }
    }

    // Power-ups que expiran
    for (const [type, until] of Object.entries(this.active_pu)) {
      if (until <= now) { delete this.active_pu[type]; sfx.powerdown(); }
    }

    // Movimiento
    const canMove = !frozen && !this.dead && !this.ended;
    if (canMove) {
      let f = 0, s = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
      if (f || s) {
        const len = Math.hypot(f, s);
        const sp = (SPEED * (this.has('speed') ? SPEED_BOOST : 1) * dt) / len;
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const dx = (-sin * f + cos * s) * sp;
        const dz = (-cos * f - sin * s) * sp;
        if (!this.#blocked(this.pos.x + dx, this.pos.z, this.feetY)) this.pos.x += dx;
        if (!this.#blocked(this.pos.x, this.pos.z + dz, this.feetY)) this.pos.z += dz;
      }
    }

    // Gravedad y suelo (las cajas tienen altura)
    if (!this.dead) {
      this.vy -= GRAVITY * dt;
      let ny = this.feetY + this.vy * dt;
      const ground = this.#groundAt(this.pos.x, this.pos.z);
      if (ny <= ground) { ny = ground; this.vy = 0; this.onGround = true; this.jumps = 0; } else this.onGround = false;
      if (this.map.ceiling && ny + EYE + 0.15 > this.map.wallH) { ny = this.map.wallH - EYE - 0.15; this.vy = Math.min(this.vy, 0); }
      this.feetY = ny;
    }

    // Salida (laberinto)
    if (canMove && this.map.exit) {
      const t = tileOf(this.pos.x, this.pos.z);
      if (t.x === this.map.exit.x && t.y === this.map.exit.y && !this.exitSent) {
        this.exitSent = true;
        this.onReachExit();
      }
    }

    // Recoger power-ups
    if (canMove) {
      for (const [id, pu] of this.powerupMeshes) {
        if (this.picked.has(id)) continue;
        const d = Math.hypot(pu.x * TILE - this.pos.x, pu.y * TILE - this.pos.z);
        if (d < 1.2 && Math.abs(this.feetY - pu.mesh.position.y) < 1.5) {
          this.picked.add(id);
          this.onPick(id);
        }
      }
    }

    // Disparo automático
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.mouseHeld && this.has('auto')) this.#shoot();

    // Cámara
    const moving = canMove && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => this.keys.has(k));
    const bob = moving && this.onGround ? Math.sin(now / (this.has('speed') ? 60 : 90)) * 0.03 : 0;
    this.camera.position.set(this.pos.x, this.dead ? this.feetY + 0.35 : this.feetY + EYE + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.dead ? 0.6 : 0);
    this.gun.visible = !this.dead;
    const targetFov = settings.fov + (this.has('speed') ? 12 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    const inv = now < this.invulnUntil;
    this.gunTip.material.color.set(inv && Math.floor(now / 120) % 2 ? 0xffffff : this.myColor);

    // Rivales (interpolados)
    const k = 1 - Math.exp(-dt * 15);
    for (const a of this.avatars.values()) {
      // sin datos en 3 s (pestaña cerrada, desconexión): ocultar en vez de dejar un fantasma
      if (a.r !== this.seed || now - (a.lastSeen ?? 0) > 3000) { a.group.visible = false; continue; }
      a.x += (a.tx - a.x) * k;
      a.y += (a.ty - a.y) * k;
      a.z += (a.tz - a.z) * k;
      let dy = a.tyaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.yaw += dy * k;
      a.group.visible = true;
      a.group.position.set(a.x, a.y, a.z);
      a.body.rotation.y = a.yaw;
      a.body.visible = !a.dead;
      a.label.visible = !a.dead;
      a.light.intensity = a.dead ? 0 : 5; // no ocultar la luz: cambiar el nº de luces recompila shaders
      a.mat.opacity = a.inv ? 0.35 + 0.25 * Math.sin(now / 60) : 1;
    }

    // HUD de power-ups (~10 Hz)
    this.puHudTimer = (this.puHudTimer ?? 0) + dt;
    if (this.puHudTimer > 0.1) {
      this.puHudTimer = 0;
      this.hud.powerups(Object.entries(this.active_pu).map(([type, until]) => ({
        type, left: (until - now) / 1000, frac: (until - now) / (POWERUPS[type].duration * 1000),
      })));
    }

    // Red
    this.netTimer += dt;
    if (this.netTimer >= NET_INTERVAL) { this.netTimer = 0; this.#sendState(); }
  }

  #sendState() {
    if (this.solo || !this.net) return;
    this.net.st({
      r: this.seed,
      p: [+this.pos.x.toFixed(2), +this.feetY.toFixed(2), +this.pos.z.toFixed(2)],
      yw: +this.yaw.toFixed(3),
      d: this.dead ? 1 : 0,
      i: performance.now() < this.invulnUntil ? 1 : 0,
    });
  }

  /** ¿Choca un círculo en (x,z) con alguna casilla más alta que los pies? */
  #blocked(x, z, feetY) {
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
    return false;
  }

  /** Altura del suelo bajo el jugador (la caja más alta que pisa). */
  #groundAt(x, z) {
    const r = RADIUS * 0.7, h = (TILE / 2) * 0.96;
    let g = 0;
    const x0 = Math.round((x - r) / TILE), x1 = Math.round((x + r) / TILE);
    const y0 = Math.round((z - r) / TILE), y1 = Math.round((z + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const th = this.map.height(tx, ty);
      if (th === WALL || th <= g) continue;
      const cx = Math.max(tx * TILE - h, Math.min(x, tx * TILE + h));
      const cz = Math.max(ty * TILE - h, Math.min(z, ty * TILE + h));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) g = th;
    }
    return g;
  }

  // ---------- Disparo ----------

  #shoot() {
    if (!this.active || this.dead || this.ended || this.cooldown > 0 || performance.now() < this.frozenUntil) return;
    const auto = this.has('auto');
    this.cooldown = auto ? AUTO_CD : FIRE_CD;
    this.camera.updateMatrixWorld();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (auto) { // un poco de dispersión con la automática
      dir.x += (Math.random() - 0.5) * 0.02;
      dir.y += (Math.random() - 0.5) * 0.02;
      dir.z += (Math.random() - 0.5) * 0.02;
      dir.normalize();
    }
    this.raycaster.set(this.camera.position, dir);
    this.raycaster.far = 150;
    const targets = [...this.solids];
    for (const a of this.avatars.values()) if (a.group.visible && !a.dead && !a.inv) targets.push(a.hitbox);
    const hits = this.raycaster.intersectObjects(targets, false);
    const end = hits.length ? hits[0].point : this.camera.position.clone().addScaledVector(dir, 150);
    const muzzle = this.gun.localToWorld(new THREE.Vector3(0, 0, -0.24));
    this.#spawnBeam(muzzle, end, this.myColor);
    sfx.laser(auto ? 0.6 : 1, auto ? 1.3 : 1);
    this.gun.position.z = -0.44;
    setTimeout(() => (this.gun.position.z = -0.5), 50);

    if (!this.solo && this.net) {
      this.net.shot({ a: muzzle.toArray().map((v) => +v.toFixed(2)), b: end.toArray().map((v) => +v.toFixed(2)) });
      const target = hits[0]?.object.userData.peerId;
      if (target) {
        this.net.hit({ r: this.seed }, target);
        sfx.hit();
        this.hud.hitmarker();
      }
    }
  }

  #spawnBeam(a, b, color) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.01) return;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, len, 6, 1, true),
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

  #resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

