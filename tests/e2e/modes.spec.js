// Cada modo arranca y funciona en solitario, sin errores.
import { test, expect } from '@playwright/test';
import { openGame, chooseMode, waitPlaying, fakePointerLock, expectNoErrors, game, killZombies } from './helpers.js';

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

test('zombis: llegan, muerden, dan puntos y la tienda vende', async ({ context }) => {
  const page = await openGame(context);
  await chooseMode(page, 'zombies', { '#sel-map': 'coliseo' });
  await page.click('#btn-solo');
  await waitPlaying(page);
  // matar 3 zombis (tiros simulados a su id) -> 3 × (10 + 100) puntos
  await killZombies(page, 3);
  await expect(page.locator('#points')).toContainText('330 pts');
  // tienda: comprar un botiquín (250)
  await page.keyboard.press('KeyB');
  await expect(page.locator('#shop')).toBeVisible();
  await page.locator('.shop-item', { hasText: 'Botiquín' }).click();
  await expect(page.locator('#shop-points')).toHaveText('80 puntos');
  await page.keyboard.press('KeyB');
  await expect(page.locator('#shop')).toBeHidden();
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
