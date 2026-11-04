import * as THREE from 'three';
import { TILE, generateMaze, pickFairSpawns, pickRespawn } from './maze.js';
import * as sfx from './audio.js';

const WALL_H = 3;
const EYE = 1.6;
const SPEED = 5.5;
const RADIUS = 0.35;
const FIRE_COOLDOWN = 0.35; // s
const DEATH_MS = 3000;
const COUNTDOWN_MS = 3000;
const NET_INTERVAL = 1 / 20; // 20 Hz
const MY_COLOR = 0x33e0ff;
const THEIR_COLOR = 0xff3df2;

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
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
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0x9a8cff, 0x201830, 1.1));

    // Linterna del jugador
    const myLight = new THREE.PointLight(MY_COLOR, 6, 14, 1.2);
    this.camera.add(myLight);

    // Pistola
    this.gun = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.6, roughness: 0.3 })
    );
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: MY_COLOR })
    );
    tip.position.z = -0.2;
    this.gun.add(body, tip);
    this.gun.position.set(0.2, -0.18, -0.5);
    this.camera.add(this.gun);

    // Rival
    this.opponent = new THREE.Group();
    const oMat = new THREE.MeshStandardMaterial({ color: THEIR_COLOR, emissive: THEIR_COLOR, emissiveIntensity: 0.35 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 6, 12), oMat);
    capsule.position.y = 0.85;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    visor.position.set(0, 1.45, -0.28);
    const oGun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x333344 }));
    oGun.position.set(0.35, 1.1, -0.35);
    this.opponent.add(capsule, visor, oGun, new THREE.PointLight(THEIR_COLOR, 5, 10, 1.2));
    this.opponent.visible = false;
    this.scene.add(this.opponent);
    this.opponentHitbox = capsule;

    this.world = null;
    this.beams = [];
    this.raycaster = new THREE.Raycaster();
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.active = false;

    // callbacks que rellena main.js
    this.onReachExit = () => {};
    this.onRematch = () => {};
    this.net = null; // { st, shot, hit, died, exit }

    this.#bindInput();
    window.addEventListener('resize', () => this.#resize());
    this.#resize();
    this.lastT = performance.now();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  // ---------- Ronda ----------

  startRound({ seed, role, solo = false, wins = { me: 0, them: 0 } }) {
    this.wins = wins;
    this.#disposeWorld();
    this.maze = generateMaze(seed);
    this.seed = seed;
    this.role = role;
    this.solo = solo;
    this.#buildWorld();

    const spawns = pickFairSpawns(this.maze);
    const mine = role === 'guest' ? spawns.guest : spawns.host;
    const theirs = role === 'guest' ? spawns.host : spawns.guest;
    this.#placeMe(mine);
    this.#faceOpenDirection(mine);

    this.opp = { x: theirs.x * TILE, z: theirs.y * TILE, yaw: 0, dead: false, tx: theirs.x * TILE, tz: theirs.y * TILE, tyaw: 0 };
    this.opponent.position.set(this.opp.x, 0, this.opp.z);
    this.opponent.visible = !solo;

    this.dead = false;
    this.deadUntil = 0;
    this.ended = false;
    this.exitSent = false;
    this.cooldown = 0;
    this.netTimer = 0;
    this.kills = 0;
    this.deaths = 0;
    this.frozenUntil = performance.now() + COUNTDOWN_MS;
    this.lastCountdown = null;
    this.active = true;
    this.hud.overlay(false);
    this.#updateScore();
  }

  endRound(iWon, wins) {
    if (this.ended) return;
    this.ended = true;
    this.wins = wins;
    (iWon ? sfx.win : sfx.lose)();
    const rematch = this.solo || this.role === 'host' ? 'Pulsa R para otro laberinto' : 'Pulsa R para pedir revancha';
    this.hud.message(iWon ? '¡HAS ESCAPADO!' : 'Tu rival ha escapado...', rematch);
    this.#updateScore();
  }

  stop(msg, sub = '') {
    this.active = false;
    this.ended = true;
    this.opponent.visible = false;
    this.hud.message(msg, sub);
  }

  // ---------- Eventos de red ----------

  remoteState({ p, y, d }) {
    if (!this.opp) return;
    const wasDead = this.opp.dead;
    this.opp.tx = p[0];
    this.opp.tz = p[1];
    this.opp.tyaw = y;
    this.opp.dead = !!d;
    if (wasDead && !d) {
      // reaparición: teletransportar en vez de interpolar a través de las paredes
      this.opp.x = p[0];
      this.opp.z = p[1];
    }
  }

  remoteShot({ a, b }) {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    this.#spawnBeam(from, to, THEIR_COLOR);
    const d = from.distanceTo(this.camera.position);
    sfx.laser(Math.max(0, 1 - d / 40), 0.85);
  }

  gotHit({ r }) {
    if (r !== this.seed || this.dead || this.ended || !this.active) return;
    this.dead = true;
    this.deaths++;
    this.deadUntil = performance.now() + DEATH_MS;
    this.keys.clear();
    sfx.death();
    this.hud.dead(true);
    this.net?.died({ r: this.seed });
    this.#sendState();
    this.#updateScore();
  }

  opponentDied({ r }) {
    if (r !== this.seed) return;
    this.kills++;
    this.#updateScore();
  }

  // ---------- Construcción del mundo ----------

  #buildWorld() {
    const { W, H, isWall, exit } = this.maze;
    const world = new THREE.Group();

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
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
    let count = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isWall(x, y)) count++;
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, WALL_H, TILE), wallMat, count);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isWall(x, y)) continue;
      m.makeTranslation(x * TILE, WALL_H / 2, y * TILE);
      walls.setMatrixAt(i++, m);
    }
    walls.computeBoundingSphere();
    world.add(walls);
    this.walls = walls;

    const floorTex = canvasTexture(32, (g, s) => {
      g.fillStyle = '#120d1c'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#1d1530'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(W, H);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * TILE, H * TILE), new THREE.MeshStandardMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(((W - 1) * TILE) / 2, 0, ((H - 1) * TILE) / 2);
    const ceiling = new THREE.Mesh(floor.geometry, new THREE.MeshStandardMaterial({ color: 0x0b0814 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(floor.position.x, WALL_H, floor.position.z);
    world.add(floor, ceiling);

    // Portal de salida
    const portal = new THREE.Mesh(
      new THREE.BoxGeometry(TILE * 0.8, WALL_H * 0.9, TILE * 0.8),
      new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.35, depthWrite: false })
    );
    portal.position.set(exit.x * TILE, (WALL_H * 0.9) / 2, exit.y * TILE);
    const exitLight = new THREE.PointLight(0x3dff7a, 12, 12, 1.2);
    exitLight.position.set(exit.x * TILE, 1.5, exit.y * TILE);
    world.add(portal, exitLight);
    this.portal = portal;

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
  }

  #faceOpenDirection(tile) {
    const dirs = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];
    const open = dirs.find(([dx, dy]) => !this.maze.isWall(tile.x + dx, tile.y + dy));
    this.yaw = open ? open[2] : 0;
    this.pitch = 0;
  }

  // ---------- Input ----------

  #bindInput() {
    this.canvas.addEventListener('click', () => {
      if (this.active && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.hud.clickToPlay(this.active && !locked);
      if (!locked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && document.pointerLockElement === this.canvas) this.#shoot();
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyR' && this.ended && this.active) this.onRematch();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  // ---------- Bucle ----------

  #frame() {
    const t = performance.now();
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    if (this.active && this.maze) this.#update(dt);
    this.#updateBeams(dt);
    if (this.portal) this.portal.rotation.y += dt;
    this.renderer.render(this.scene, this.camera);
  }

  #update(dt) {
    const now = performance.now();

    // Cuenta atrás inicial
    const frozen = now < this.frozenUntil;
    if (frozen) {
      const n = Math.ceil((this.frozenUntil - now) / 1000);
      if (n !== this.lastCountdown) { this.lastCountdown = n; this.hud.message(String(n), 'Encuentra la salida verde'); sfx.beep(); }
    } else if (this.lastCountdown !== 0) {
      this.lastCountdown = 0;
      this.hud.message('¡YA!', '');
      sfx.beep(true);
      setTimeout(() => { if (!this.ended) this.hud.message('', ''); }, 700);
    }

    // Muerte / reaparición
    if (this.dead) {
      const left = Math.ceil((this.deadUntil - now) / 1000);
      this.hud.deadCountdown(left);
      if (now >= this.deadUntil) {
        const oppTile = this.solo ? null : tileOf(this.opp.x, this.opp.z);
        this.#placeMe(pickRespawn(this.maze, oppTile));
        this.#faceOpenDirection(tileOf(this.pos.x, this.pos.z));
        this.dead = false;
        this.hud.dead(false);
        sfx.respawn();
        this.#sendState();
      }
    }

    // Movimiento
    if (!frozen && !this.dead && !this.ended) {
      let f = 0, s = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
      if (f || s) {
        const len = Math.hypot(f, s);
        const sp = (SPEED * dt) / len;
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const dx = (-sin * f + cos * s) * sp;
        const dz = (-cos * f - sin * s) * sp;
        if (!this.#blocked(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
        if (!this.#blocked(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
      }
      const t = tileOf(this.pos.x, this.pos.z);
      if (t.x === this.maze.exit.x && t.y === this.maze.exit.y && !this.exitSent) {
        this.exitSent = true;
        this.onReachExit();
      }
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
    const bob = !this.dead && (this.keys.size > 0) ? Math.sin(now / 90) * 0.03 : 0;
    this.camera.position.set(this.pos.x, this.dead ? 0.35 : EYE + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.dead ? 0.6 : 0);
    this.gun.visible = !this.dead;

    // Rival (interpolado)
    if (!this.solo && this.opp) {
      const k = 1 - Math.exp(-dt * 15);
      this.opp.x += (this.opp.tx - this.opp.x) * k;
      this.opp.z += (this.opp.tz - this.opp.z) * k;
      let dy = this.opp.tyaw - this.opp.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.opp.yaw += dy * k;
      this.opponent.position.set(this.opp.x, 0, this.opp.z);
      this.opponent.rotation.y = this.opp.yaw;
      this.opponent.visible = !this.opp.dead;
    }

    // Red
    this.netTimer += dt;
    if (this.netTimer >= NET_INTERVAL) { this.netTimer = 0; this.#sendState(); }
  }

  #sendState() {
    if (this.solo || !this.net) return;
    this.net.st({ p: [+this.pos.x.toFixed(2), +this.pos.z.toFixed(2)], y: +this.yaw.toFixed(3), d: this.dead ? 1 : 0 });
  }

  #blocked(x, z) {
    const r = RADIUS, h = TILE / 2;
    const x0 = Math.round((x - r) / TILE), x1 = Math.round((x + r) / TILE);
    const y0 = Math.round((z - r) / TILE), y1 = Math.round((z + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!this.maze.isWall(tx, ty)) continue;
      const cx = Math.max(tx * TILE - h, Math.min(x, tx * TILE + h));
      const cz = Math.max(ty * TILE - h, Math.min(z, ty * TILE + h));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }

  // ---------- Disparo ----------

  #shoot() {
    if (!this.active || this.dead || this.ended || this.cooldown > 0 || performance.now() < this.frozenUntil) return;
    this.cooldown = FIRE_COOLDOWN;
    this.camera.updateMatrixWorld();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.raycaster.set(this.camera.position, dir);
    this.raycaster.far = 120;
    const targets = [this.walls];
    if (!this.solo && this.opponent.visible) targets.push(this.opponentHitbox);
    const hits = this.raycaster.intersectObjects(targets, false);
    const end = hits.length ? hits[0].point : this.camera.position.clone().addScaledVector(dir, 120);
    const muzzle = this.gun.localToWorld(new THREE.Vector3(0, 0, -0.24));
    this.#spawnBeam(muzzle, end, MY_COLOR);
    sfx.laser(1);
    // retroceso
    this.gun.position.z = -0.44;
    setTimeout(() => (this.gun.position.z = -0.5), 60);

    if (!this.solo && this.net) {
      this.net.shot({ a: muzzle.toArray().map((v) => +v.toFixed(2)), b: end.toArray().map((v) => +v.toFixed(2)) });
      if (hits.length && hits[0].object === this.opponentHitbox && !this.opp.dead) {
        this.net.hit({ r: this.seed });
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

  // ---------- Varios ----------

  #updateScore() {
    this.hud.score({ wins: this.wins, kills: this.kills, deaths: this.deaths, solo: this.solo });
  }

  #resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
