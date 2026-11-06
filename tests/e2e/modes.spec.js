// Cada modo arranca y funciona en solitario, sin errores.
import { test, expect } from '@playwright/test';
import { openGame, chooseMode, waitPlaying, fakePointerLock, expectNoErrors, game, killZombies, standNextTo, givePoints } from './helpers.js';

test('el menú muestra los 6 modos', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#modes label')).toHaveCount(6);
  await expect(page.locator('#btn-create')).toBeVisible();
});

test('laberinto solo: llegar a la salida gana', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'maze', { '#sel-diff': 'facil' });
  await page.click('#btn-solo');
  await waitPlaying(page);
  expect(await game(page, () => window.__game.map.W)).toBe(13);
  await game(page, () => { const g = window.__game; g.pos = { x: g.map.exit.x * 3, z: g.map.exit.y * 3 }; });
  await expect(page.locator('#msg-main')).toHaveText('¡HAS ESCAPADO!');
  expectNoErrors(page);
});

for (const mapId of ['coliseo', 'torres', 'pasillos', 'aleatoria']) {
  test(`arena contra bots en ${mapId}: los bots pelean`, async ({ context }) => {
    const page = await openGame(context);
    await chooseMode(page, 'arena', { '#sel-map': mapId, '#sel-bots': '4', '#sel-skill': 'dificil' });
    await page.click('#btn-solo');
    await waitPlaying(page);
    await page.waitForFunction(() => Object.values(window.__roster()).some((p) => p.kills > 0), null, { timeout: 45_000 });
    await expect(page.locator('#score')).toContainText('Bot');
    expectNoErrors(page);
  });
}

test('juego de armas: una baja sube de arma', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'gungame', { '#sel-bots': '1' });
  await page.click('#btn-solo');
  await waitPlaying(page);
  expect(await game(page, () => window.__game.currentWeapon)).toBe('pistol');
  await game(page, () => window.__game.onEntityHit('bot-0', 500, 'pistol'));
  await expect.poll(() => game(page, () => window.__game.currentWeapon)).toBe('smg');
  expectNoErrors(page);
});

/** Arranca una partida de zombis en solitario. */
async function startZombies(context) {
  const page = await openGame(context);
  await chooseMode(page, 'zombies');
  await page.click('#btn-solo');
  await waitPlaying(page);
  return page;
}

test('zombis: dan puntos y su vida se ve sobre la cabeza', async ({ context }) => {
  const page = await startZombies(context);
  await expect(page.locator('#opt-map')).toBeHidden(); // el mapa de zombis es uno solo
  // 500 iniciales + 3 × (10 + 100)
  await killZombies(page, 3);
  await expect(page.locator('#points')).toContainText('830 pts');
  await page.waitForFunction(() => [...window.__game.avatars.values()].some((a) => a.kind === 'zombie'), null, { timeout: 30_000 });
  const before = await game(page, () => {
    const z = [...window.__game.avatars.values()].find((a) => a.kind === 'zombie');
    window.__game.onEntityHit(z.id, 20, 'pistol');
    return { id: z.id, hp: z.hp, full: z.hpFg.scale.x };
  });
  await expect.poll(() => game(page, (id) => window.__game.avatars.get(id)?.hp, before.id)).toBe(before.hp - 20);
  expect(await game(page, (id) => window.__game.avatars.get(id).hpFg.scale.x, before.id)).toBeLessThan(before.full);
  expectNoErrors(page);
});

test('zombis: empiezas con pistola y las armas se compran en la pared', async ({ context }) => {
  const page = await startZombies(context);
  expect(await game(page, () => window.__game.allowedWeapons())).toEqual(['pistol']);
  await page.keyboard.press('Digit2');
  expect(await game(page, () => window.__game.currentWeapon)).toBe('pistol');
  // sin puntos suficientes no compra (empiezas con 500, el subfusil vale 800)
  await standNextTo(page, 'wall', { weapon: 'smg' });
  await expect(page.locator('#prompt')).toContainText('Comprar Subfusil');
  await expect(page.locator('#prompt')).toContainText('Faltan puntos');
  await page.keyboard.press('KeyE');
  expect(await game(page, () => window.__game.currentWeapon)).toBe('pistol');
  // con puntos, sí
  await givePoints(page, 1000);
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => window.__game.currentWeapon)).toBe('smg');
  await expect(page.locator('#points')).toContainText('200 pts');
  expect(await game(page, () => window.__game.allowedWeapons())).toEqual(['pistol', 'smg']);
  // munición a mitad de precio, solo si te falta
  await page.keyboard.press('KeyE');
  await expect(page.locator('#points')).toContainText('200 pts');
  await game(page, () => { window.__game.ammoOf('smg').reserve = 3; });
  await givePoints(page, 400);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#points')).toContainText('0 pts');
  expect(await game(page, () => window.__game.ammoOf('smg').reserve)).toBe(256);
  // la tercera arma sustituye a la que llevas en la mano
  await givePoints(page, 1000);
  await standNextTo(page, 'wall', { weapon: 'shotgun' });
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => window.__game.allowedWeapons())).toEqual(['pistol', 'shotgun']);
  expectNoErrors(page);
});

test('zombis: las puertas se abren con puntos y amplían el mapa', async ({ context }) => {
  const page = await startZombies(context);
  const before = await game(page, () => window.__game.map.cells.length);
  await standNextTo(page, 'door', { id: '1' });
  await givePoints(page, 750);
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => window.__zw().doors)).toEqual(['1']);
  await expect(page.locator('#points')).toContainText('0 pts');
  expect(await game(page, () => window.__game.map.cells.length)).toBeGreaterThan(before);
  // ya se puede cruzar: andar hacia la puerta no se queda bloqueado
  const crossed = await game(page, () => {
    const g = window.__game;
    const d = g.map.doors.find((x) => x.id === '1');
    return g.zBoxes.some((b) => b.cx === d.x * 3 && b.cz === d.y * 3);
  });
  expect(crossed).toBe(false);
  expectNoErrors(page);
});

test('zombis: sin electricidad las máquinas no funcionan; con ella, mejora fija hasta caer', async ({ context }) => {
  const page = await startZombies(context);
  await givePoints(page, 5000);
  await standNextTo(page, 'machine', { item: 'armor' });
  await expect(page.locator('#prompt')).toContainText('Sin electricidad');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(200);
  expect(await game(page, () => window.__game.perks.has('armor'))).toBe(false);
  await standNextTo(page, 'power');
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => window.__zw().power)).toBe(true);
  await standNextTo(page, 'machine', { item: 'armor' });
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => window.__game.perks.has('armor'))).toBe(true);
  expect(await game(page, () => window.__game.maxHp)).toBe(200);
  await expect(page.locator('#points')).toContainText('3000 pts');
  expectNoErrors(page);
});

test('zombis: hay power-ups momentáneos en el suelo, ninguno de armas', async ({ context }) => {
  const page = await startZombies(context);
  const types = await game(page, () => [...window.__game.powerupMeshes.values()].map((p) => p.type));
  expect(types.length).toBeGreaterThan(0);
  expect(types).not.toContain('sniper');
  expectNoErrors(page);
});

test('zombis: la caja misteriosa da un arma al azar', async ({ context }) => {
  const page = await startZombies(context);
  await givePoints(page, 1000);
  await standNextTo(page, 'box');
  await expect(page.locator('#prompt')).toContainText('Caja misteriosa');
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => window.__zw().box.state)).toBe('spinning');
  await expect(page.locator('#points')).toContainText('50 pts');
  await page.waitForFunction(() => window.__zw().box.state === 'ready', null, { timeout: 5000 });
  const weapon = await game(page, () => window.__zw().box.weapon);
  await expect(page.locator('#prompt')).toContainText('Coger');
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => window.__game.currentWeapon)).toBe(weapon);
  expect(await game(page, () => window.__zw().box.state)).toBe('idle');
  expectNoErrors(page);
});

test('zombis: entran por las ventanas; se reparan a mano o con el carpintero', async ({ context }) => {
  const page = await startZombies(context);
  // salen de una ventana y se quedan detrás de las tablas
  await page.waitForFunction(() => [...window.__bots.bots.values()].some((z) => z.kind === 'zombie' && z.win &&
    window.__game.map.windows.some((w) => w.x * 3 === z.x && w.y * 3 === z.z)), null, { timeout: 30_000 });
  // reparar a mano da puntos
  const id = await game(page, () => {
    for (const z of window.__bots.bots.values()) window.__bots.remove(z.id);
    Object.assign(window.__wave(), { toSpawn: 0, breakUntil: performance.now() + 60_000 });
    const w = window.__game.map.windows.find((x) => x.y === 26);
    window.__zw().planks[w.id] = 2;
    window.__game.setZombieWorld(window.__zw());
    return w.id;
  });
  await standNextTo(page, 'window', { id });
  await givePoints(page, 0);
  await page.keyboard.down('KeyE');
  await expect.poll(() => game(page, (w) => window.__zw().planks[w], id), { timeout: 5000 }).toBe(5);
  await page.keyboard.up('KeyE');
  await expect(page.locator('#points')).toContainText('30 pts');
  // el carpintero las arregla todas
  await game(page, () => {
    for (const k of Object.keys(window.__zw().planks)) window.__zw().planks[k] = 0;
  });
  await standNextTo(page, 'carpenter');
  await givePoints(page, 500);
  await expect(page.locator('#prompt')).toContainText('Carpintero');
  await page.keyboard.press('KeyE');
  await expect.poll(() => game(page, () => Object.values(window.__zw().planks).every((n) => n === 5))).toBe(true);
  await expect(page.locator('#points')).toContainText('0 pts');
  expectNoErrors(page);
});

test('zombis: en la oleada 7 llega el zombi rojo, y matarlo recarga la munición', async ({ context }) => {
  const page = await startZombies(context);
  await game(page, () => { window.__game.invulnUntil = performance.now() + 1e7; window.__startWave(7); });
  await page.waitForFunction(() => [...window.__game.avatars.values()].some((a) => a.boss), null, { timeout: 10_000 });
  await expect(page.locator('#boss')).toBeVisible();
  await expect(page.locator('#wave')).toContainText('ZOMBI ROJO');
  const boss = await game(page, () => {
    const a = [...window.__game.avatars.values()].find((x) => x.boss);
    const normal = window.__bots.bots.get(a.id);
    return { id: a.id, maxHp: normal.maxHp, y: a.body.scale.y };
  });
  expect(boss.maxHp).toBeGreaterThanOrEqual(2500);
  expect(boss.y).toBeGreaterThan(1);
  // medio muerto: la barra grande baja
  await game(page, ({ id, maxHp }) => window.__game.onEntityHit(id, maxHp / 2, 'sniper'), boss);
  await expect.poll(() => page.locator('#boss-bar').evaluate((el) => parseFloat(el.style.width))).toBeLessThan(60);
  // matarlo: premio y munición
  await game(page, () => { window.__game.ammoOf('pistol').reserve = 0; });
  const pts = await game(page, () => window.__roster()[window.__selfId].points);
  await game(page, ({ id, maxHp }) => window.__game.onEntityHit(id, maxHp, 'sniper'), boss);
  await expect(page.locator('#boss')).toBeHidden();
  expect(await game(page, () => window.__roster()[window.__selfId].points)).toBeGreaterThanOrEqual(pts + 1100);
  expect(await game(page, () => window.__game.ammoOf('pistol').reserve)).toBe(96);
  expectNoErrors(page);
});

for (const [mode, weapon] of [['arena', 'pistol'], ['maze', 'laser'], ['gungame', 'pistol'], ['zombies', 'pistol'], ['training', 'pistol']]) {
  test(`munición en ${mode}: se gasta, se recarga y se acaba`, async ({ context }) => {
    const page = await openGame(context);
    await chooseMode(page, mode);
    await page.click('#btn-solo');
    await waitPlaying(page);
    await fakePointerLock(page);
    const { mag, reserve } = await game(page, (w) => window.__game.ammoOf(w), weapon);
    await expect(page.locator('#ammo')).toContainText(`${mag}`);
    await expect(page.locator('#ammo')).toContainText(`/ ${reserve}`);
    // un disparo gasta una bala
    await page.mouse.down();
    await page.mouse.up();
    expect(await game(page, (w) => window.__game.ammoOf(w).mag, weapon)).toBe(mag - 1);
    // R recarga, tarda y coge de la reserva
    await page.keyboard.press('KeyR');
    await expect(page.locator('#ammo')).toContainText('RECARGANDO');
    await page.waitForFunction(() => !window.__game.reloadUntil, null, { timeout: 5000 });
    const after = await game(page, (w) => window.__game.ammoOf(w), weapon);
    expect(after).toEqual({ mag, reserve: reserve - 1 });
    // sin balas ni reserva no dispara
    await game(page, (w) => { const a = window.__game.ammoOf(w); a.mag = 0; a.reserve = 0; window.__game.cooldown = 0; }, weapon);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('#toasts')).toContainText('SIN MUNICIÓN');
    expectNoErrors(page);
  });
}

test('granadas: se lanzan con G, explotan, dañan y en zombis se compran', async ({ context }) => {
  const page = await startZombies(context);
  await expect(page.locator('#grenades')).toContainText('2 granadas');
  // un zombi justo al lado de donde caerá la granada
  await page.waitForFunction(() => [...window.__game.avatars.values()].some((a) => a.kind === 'zombie' && a.group.visible), null, { timeout: 30_000 });
  const before = await game(page, () => {
    const g = window.__game;
    const z = [...g.avatars.values()].find((a) => a.kind === 'zombie');
    const w = window.__bots.bots.get(z.id).win;
    window.__bots.bots.get(z.id).win = null;
    window.__bots.bots.get(z.id).x = w.in.x * 3;
    window.__bots.bots.get(z.id).z = w.in.y * 3;
    window.__bots.bots.get(z.id).speed = 0;
    g.pos = { x: w.in.x * 3, z: (w.in.y - 3) * 3 };
    g.yaw = Math.PI;
    g.pitch = -0.2;
    return { id: z.id, hp: z.hp };
  });
  await page.keyboard.press('KeyG');
  await expect(page.locator('#grenades')).toContainText('1 granadas');
  await expect.poll(() => game(page, (id) => window.__game.avatars.get(id)?.hp ?? 0, before.id), { timeout: 8000 }).toBeLessThan(before.hp);
  // comprar más (empiezas con 500)
  await standNextTo(page, 'grenades');
  await expect(page.locator('#prompt')).toContainText('granadas');
  await givePoints(page, 500);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#grenades')).toContainText('3 granadas');
  expectNoErrors(page);
});

test('minimapa en zombis: se descubre al andar', async ({ context }) => {
  const page = await startZombies(context);
  await expect(page.locator('#minimap')).toBeVisible();
  await page.waitForFunction(() => window.__game.minimap.seen.size > 0);
  const known = await game(page, () => window.__game.minimap.seen.size);
  const power = await game(page, () => { const m = window.__game.map; const p = m.props.find((x) => x.kind === 'power'); return p.y * m.W + p.x; });
  expect(await game(page, (i) => window.__game.minimap.seen.has(i), power)).toBe(false);
  await standNextTo(page, 'power');
  await page.waitForFunction((i) => window.__game.minimap.seen.has(i), power);
  expect(await game(page, () => window.__game.minimap.seen.size)).toBeGreaterThan(known);
  expectNoErrors(page);
});

test('minimapa en arena: marca en rojo donde disparan; no sale en parkour', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'arena', { '#sel-bots': '3', '#sel-skill': 'dificil' });
  await page.click('#btn-solo');
  await waitPlaying(page);
  await expect(page.locator('#minimap')).toBeVisible();
  await page.waitForFunction(() => window.__game.minimap.shots.length > 0, null, { timeout: 45_000 });
  await game(page, () => document.getElementById('btn-quit').click());
  await chooseMode(page, 'parkour');
  await page.click('#btn-solo');
  await waitPlaying(page);
  await expect(page.locator('#minimap')).toBeHidden();
  expectNoErrors(page);
});

for (const level of [3, 4, 5, 6]) {
  test(`parkour dentro de edificio (nivel ${level + 1}): arranca, tiene techo y la lava devuelve al inicio`, async ({ context }) => {
    const page = await openGame(context);
    await chooseMode(page, 'parkour', { '#sel-level': String(level) });
    await page.click('#btn-solo');
    await waitPlaying(page);
    expect(await game(page, () => window.__game.map.ceiling)).toBe(true);
    const start = await game(page, () => ({ ...window.__game.pos }));
    await game(page, () => { const g = window.__game; const m = g.map; g.pos = { x: (m.start.x + 1) * 3, z: m.start.y * 3 }; g.feetY = 0.2; });
    await expect.poll(() => game(page, () => window.__game.pos.x)).toBe(start.x);
    await game(page, () => { const g = window.__game; const f = g.map.finish; g.pos = { x: f.x * 3, z: f.y * 3 }; g.feetY = g.map.height(f.x, f.y) + 0.3; });
    await expect(page.locator('#msg-main')).toContainText(/RÉCORD|Meta/);
    expectNoErrors(page);
  });
}

test('unirse con código: el campo está siempre, también con Entrenamiento seleccionado', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'training');
  await expect(page.locator('#input-code')).toBeVisible();
  await page.locator('#input-code').click();
  await page.keyboard.type('ab2cd');
  await expect(page.locator('#input-code')).toHaveValue('ab2cd');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wait-title')).toContainText('AB2CD');
  expectNoErrors(page);
});

test('unirse con enlace: también se puede escribir el nombre', async ({ context }) => {
  const page = await openGame(context, '/#ab12c');
  await page.locator('#input-name-join').click();
  await page.keyboard.type('Pepa');
  await expect(page.locator('#input-name-join')).toHaveValue('Pepa');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wait-title')).toContainText('AB12C');
  expectNoErrors(page);
});

test('unirse con código: desde un enlace antiguo se puede escribir otro', async ({ context }) => {
  const page = await openGame(context, '/#viejo');
  await expect(page.locator('#join-only')).toBeVisible();
  await page.locator('#input-code-other').click();
  await page.keyboard.type('nuevo');
  await page.click('#btn-join-other');
  await expect(page.locator('#wait-title')).toContainText('NUEVO');
  expect(page.url()).toContain('#NUEVO');
  expectNoErrors(page);
});

test('munición: al vaciar el cargador recarga solo', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'training');
  await page.click('#btn-solo');
  await waitPlaying(page);
  await fakePointerLock(page);
  await game(page, () => { window.__game.ammoOf('pistol').mag = 1; });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#ammo')).toContainText('RECARGANDO');
  await page.waitForFunction(() => window.__game.ammoOf('pistol').mag === 12, null, { timeout: 5000 });
  expectNoErrors(page);
});

test('zombis solo: si caes, se acaba (no reapareces a mitad de oleada)', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'zombies');
  await page.click('#btn-solo');
  await waitPlaying(page);
  await game(page, () => window.__game.takeDamage(999, 'z-0', 'zombie'));
  await expect(page.locator('#msg-main')).toContainText('Os han comido', { timeout: 5000 });
  expectNoErrors(page);
});

test('zombis: Segunda Vida te levanta', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'zombies');
  await page.click('#btn-solo');
  await waitPlaying(page);
  await game(page, () => window.__game.applyPerk('secondlife'));
  await game(page, () => window.__game.takeDamage(999, 'z-0', 'zombie'));
  expect(await game(page, () => window.__game.dead)).toBe(true);
  await page.waitForFunction(() => !window.__game.dead, null, { timeout: 6000 });
  await expect(page.locator('#msg-main')).not.toContainText('Os han comido');
  expectNoErrors(page);
});

test('parkour: la lava devuelve al checkpoint y la meta para el crono', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'parkour', { '#sel-level': '1' });
  await page.click('#btn-solo');
  await waitPlaying(page);
  const start = await game(page, () => ({ ...window.__game.pos }));
  await game(page, () => { const g = window.__game; g.pos.x += 6; g.feetY = 0.2; });
  await expect.poll(() => game(page, () => window.__game.pos.x)).toBe(start.x);
  await game(page, () => { const g = window.__game; const f = g.map.finish; g.pos = { x: f.x * 3, z: f.y * 3 }; g.feetY = g.map.height(f.x, f.y) + 0.3; });
  await expect(page.locator('#msg-main')).toContainText(/RÉCORD|Meta/);
  expectNoErrors(page);
});

test('entrenamiento: disparar a los blancos cuenta precisión', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'training');
  await page.click('#btn-solo');
  await waitPlaying(page);
  await fakePointerLock(page);
  await page.keyboard.press('Digit1');
  for (let i = 0; i < 6; i++) {
    await game(page, () => {
      const g = window.__game;
      const t = g.targets.find((x) => x.group.visible);
      const p = t.disc.getWorldPosition(g.camera.position.clone());
      const d = p.sub(g.camera.position);
      g.yaw = Math.atan2(-d.x, -d.z);
      g.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    });
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(320);
  }
  await expect(page.locator('#train')).toContainText(/Precisión [1-9]\d*%/);
  expectNoErrors(page);
});

test('francotirador: clic derecho activa la mira', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'training');
  await page.click('#btn-solo');
  await waitPlaying(page);
  await fakePointerLock(page);
  await page.keyboard.press('Digit5');
  await page.mouse.down({ button: 'right' });
  await expect(page.locator('#scope')).toBeVisible();
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('#scope')).toBeHidden();
  expectNoErrors(page);
});

test('ajustes: se guardan entre visitas', async ({ context }) => {
  const page = await openGame(context);
  await page.click('#btn-settings');
  await page.locator('#set-sens').fill('2.5');
  await page.click('#btn-settings-close');
  await page.reload();
  await page.click('#btn-settings');
  await expect(page.locator('#val-sens')).toHaveText('2.50x');
  expectNoErrors(page);
});
