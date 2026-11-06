// Dos navegadores reales conectados por WebRTC (señalización por un relay local).
import { test, expect } from '@playwright/test';
import { openGame, hostAndJoin, expectNoErrors, game, killZombies, standNextTo, givePoints } from './helpers.js';

test('con enlace solo se ve "Unirse"', async ({ context }) => {
  const page = await openGame(context, '/#ab12c');
  await expect(page.locator('#join-only')).toBeVisible();
  await expect(page.locator('#lobby')).toBeHidden();
  await expect(page.locator('#join-code-label')).toHaveText('AB12C');
  await page.click('#btn-own-game');
  await expect(page.locator('#lobby')).toBeVisible();
  expectNoErrors(page);
});

test('arena: entrar con código, verse, matar y marcador', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'arena', { '#sel-map': 'coliseo', '#sel-goal': '5' });
  // se ven el uno al otro
  await s.guest.waitForFunction((id) => window.__game.avatars.get(id)?.group.visible, s.ids.host);
  await s.host.waitForFunction((id) => window.__game.avatars.get(id)?.group.visible, s.ids.guest);
  // el host le da un tiro letal al invitado
  await game(s.host, (t) => window.__game.net.hit({ r: window.__game.seed, dmg: 200, w: 'sniper' }, t), s.ids.guest);
  await s.guest.waitForFunction(() => window.__game.dead);
  await expect(s.guest.locator('#score')).toContainText('Host');
  await expect.poll(() => game(s.host, () => window.__roster()[window.__selfId].kills)).toBe(1);
  // reaparece
  await s.guest.waitForFunction(() => !window.__game.dead, null, { timeout: 6000 });
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('laberinto: el primero en salir gana para los dos', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'maze', { '#sel-diff': 'facil' });
  expect(await game(s.guest, () => window.__game.seed)).toBe(await game(s.host, () => window.__game.seed));
  await game(s.guest, () => { const g = window.__game; g.pos = { x: g.map.exit.x * 3, z: g.map.exit.y * 3 }; });
  await expect(s.guest.locator('#msg-main')).toHaveText('¡HAS ESCAPADO!');
  await expect(s.host.locator('#msg-main')).toContainText('Invitado ha escapado');
  // revancha pedida por el invitado
  await s.guest.keyboard.press('KeyR');
  await s.host.waitForFunction(() => !window.__game.ended);
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('zombis en equipo: puntos, puertas, electricidad, armas y revivir', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'zombies');
  await killZombies(s.guest, 3);
  await expect(s.guest.locator('#points')).toContainText('830 pts');
  // el invitado abre una puerta y el host la ve abierta
  await standNextTo(s.guest, 'door', { id: '1' });
  await s.guest.keyboard.press('KeyE');
  await expect.poll(() => game(s.host, () => window.__zw().doors)).toEqual(['1']);
  await expect.poll(() => game(s.guest, () => window.__game.zw.doors)).toEqual(['1']);
  await expect(s.guest.locator('#points')).toContainText('80 pts');
  // el host da la luz y el invitado lo nota
  await standNextTo(s.host, 'power');
  await s.host.keyboard.press('KeyE');
  await expect.poll(() => game(s.guest, () => window.__game.zw.power)).toBe(true);
  // el invitado compra un arma: la paga en el host y le llega a él
  await givePoints(s.host, 1000, s.ids.guest);
  await expect(s.guest.locator('#points')).toContainText('1000 pts');
  await standNextTo(s.guest, 'wall', { weapon: 'smg' });
  await s.guest.keyboard.press('KeyE');
  await expect.poll(() => game(s.guest, () => window.__game.currentWeapon)).toBe('smg');
  expect(await game(s.host, (id) => window.__roster()[id].weapons, s.ids.guest)).toEqual(['pistol', 'smg']);
  // ...y su máquina: la mejora le llega a él
  await givePoints(s.host, 2000, s.ids.guest);
  await expect(s.guest.locator('#points')).toContainText('2000 pts');
  await standNextTo(s.guest, 'machine', { item: 'doubletap' });
  await s.guest.keyboard.press('KeyE');
  await expect.poll(() => game(s.guest, () => window.__game.perks.has('doubletap'))).toBe(true);
  // si el invitado cae, el host sigue vivo: no se acaba la partida
  await game(s.guest, () => window.__game.takeDamage(999, 'z-0', 'zombie'));
  await s.host.waitForTimeout(1500);
  expect(await game(s.host, () => window.__game.ended)).toBe(false);
  // el host usa la máquina de revivir y el invitado se levanta
  await givePoints(s.host, 5000);
  await standNextTo(s.host, 'machine', { item: 'revive' });
  await s.host.keyboard.press('KeyE');
  await s.guest.waitForFunction(() => !window.__game.dead, null, { timeout: 5000 });
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('zombis en equipo: el invitado ve la vida de los zombis y las tablas', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'zombies');
  await s.guest.waitForFunction(() => [...window.__game.avatars.values()].some((a) => a.kind === 'zombie' && a.maxHp > 0), null, { timeout: 30_000 });
  // los zombis rompen tablas de una ventana y el invitado lo ve
  await s.guest.waitForFunction(() => Object.values(window.__game.zw.planks).some((n) => n < 5), null, { timeout: 20_000 });
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('zombis en equipo: revivir a un compañero manteniendo E, en el sitio donde cayó', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'zombies');
  await game(s.guest, () => { const g = window.__game; g.pos = { x: 15 * 3, z: 22 * 3 }; });
  await s.guest.waitForTimeout(300);
  await game(s.guest, () => window.__game.takeDamage(999, 'z-0', 'zombie'));
  await s.guest.waitForFunction(() => window.__game.dead);
  await expect(s.guest.locator('#dead')).toBeVisible();
  // el host lo ve tumbado, pidiendo ayuda
  await s.host.waitForFunction((id) => { const a = window.__game.avatars.get(id); return a.dead && a.downed && a.body.visible; }, s.ids.guest);
  await game(s.host, () => { const g = window.__game; g.pos = { x: 16 * 3, z: 22 * 3 }; });
  await expect(s.host.locator('#prompt')).toContainText('revivir');
  const pts = await game(s.host, () => window.__roster()[window.__selfId].points);
  // pulsar un momento no basta
  await s.host.keyboard.press('KeyE');
  await s.host.waitForTimeout(500);
  expect(await game(s.guest, () => window.__game.dead)).toBe(true);
  await s.host.keyboard.down('KeyE');
  await s.guest.waitForFunction(() => !window.__game.dead, null, { timeout: 12_000 });
  await s.host.keyboard.up('KeyE');
  expect(await game(s.guest, () => window.__game.pos.x)).toBe(15 * 3);
  await expect.poll(() => game(s.host, () => window.__roster()[window.__selfId].points)).toBeGreaterThanOrEqual(pts + 100);
  await s.host.waitForFunction((id) => !window.__game.avatars.get(id).downed, s.ids.guest);
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('cambiar de modo al acabar, sin salir de la sala ni reenviar el enlace', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'maze', { '#sel-diff': 'facil' });
  await game(s.guest, () => { const g = window.__game; g.pos = { x: g.map.exit.x * 3, z: g.map.exit.y * 3 }; });
  await expect(s.host.locator('#msg-sub')).toContainText('M cambiar de modo');
  // el invitado no puede abrirlo
  await s.guest.keyboard.press('KeyM');
  await expect(s.guest.locator('#lobby')).toBeHidden();
  await s.host.keyboard.press('KeyM');
  await expect(s.host.locator('#btn-room-start')).toBeVisible();
  await expect(s.host.locator('#btn-create')).toBeHidden();
  await expect(s.host.locator('label:has(input[value=training])')).toBeHidden(); // no se juega en red
  // volver sin cambiar nada
  await s.host.click('#btn-room-back');
  await expect(s.host.locator('#overlay')).toBeHidden();
  await s.host.keyboard.press('KeyM');
  await s.host.click('label:has(input[value=zombies])');
  await s.host.click('#btn-room-start');
  await s.host.waitForFunction(() => window.__game.mode === 'zombies' && !window.__game.ended);
  await s.guest.waitForFunction(() => window.__game.mode === 'zombies' && !window.__game.ended);
  await expect(s.host.locator('#overlay')).toBeHidden();
  await expect(s.guest.locator('#overlay')).toBeHidden();
  await s.guest.waitForFunction((id) => window.__game.avatars.get(id)?.group.visible, s.ids.host, { timeout: 15_000 });
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('granada en red: la ven los dos y daña al otro en arena', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'arena', { '#sel-map': 'coliseo', '#sel-goal': '5' });
  await s.guest.waitForFunction((id) => window.__game.avatars.get(id)?.group.visible, s.ids.host);
  // el invitado, justo delante del host
  await game(s.guest, () => { const g = window.__game; g.invulnUntil = 0; g.pos = { x: 21, z: 9 }; });
  await game(s.host, () => { const g = window.__game; g.invulnUntil = 0; g.pos = { x: 21, z: 3 * 3 + 6 }; g.yaw = 0; g.pitch = -0.3; });
  await s.host.waitForFunction((id) => { const a = window.__game.avatars.get(id); return Math.abs(a.z - 9) < 0.5 && !a.inv; }, s.ids.guest, { timeout: 10_000 });
  await s.host.keyboard.press('KeyG');
  await s.guest.waitForFunction(() => window.__game.grenades.length === 1, null, { timeout: 5000 });
  await s.guest.waitForFunction(() => window.__game.hp < 100 || window.__game.dead, null, { timeout: 8000 });
  expect(await game(s.host, () => window.__game.nades)).toBe(1);
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('juego de armas en red: el arma del invitado sigue a su nivel', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'gungame', { '#sel-map': 'coliseo' });
  await game(s.host, (t) => window.__game.net.hit({ r: window.__game.seed, dmg: 200, w: 'pistol' }, t), s.ids.guest);
  await expect.poll(() => game(s.host, () => window.__game.currentWeapon)).toBe('smg');
  expect(await game(s.guest, () => window.__game.currentWeapon)).toBe('pistol');
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('barriles: explotan para todos', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'arena', { '#sel-map': 'coliseo' });
  const id = await game(s.guest, () => window.__game.map.barrels[0].id);
  await game(s.guest, (b) => window.__game.onEntityHit(b, 30, 'pistol'), id);
  await expect.poll(() => game(s.host, (b) => window.__game.deadBarrels.has(b), id)).toBe(true);
  await expect.poll(() => game(s.guest, (b) => window.__game.deadBarrels.has(b), id)).toBe(true);
  expectNoErrors(s.host, s.guest);
  await s.close();
});

test('si el host se va, el invitado vuelve al menú con aviso', async ({ browser }) => {
  const s = await hostAndJoin(browser, 'arena');
  await s.host.evaluate(() => document.getElementById('btn-quit').click());
  await expect(s.guest.locator('#wait-title')).toHaveText('El host se ha ido.', { timeout: 15_000 });
  expectNoErrors(s.host, s.guest);
  await s.close();
});
