import { expect } from '@playwright/test';

/** Abre el juego y recoge errores de la página (cualquier error hace fallar el test). */
export async function openGame(context, url = '/') {
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|GL Driver/.test(m.text())) page.errors.push(m.text());
  });
  await page.goto(url);
  return page;
}

export async function chooseMode(page, mode, selects = {}) {
  await page.click(`label:has(input[value=${mode}])`);
  for (const [sel, value] of Object.entries(selects)) await page.selectOption(sel, value);
}

/** Simula que el ratón está capturado (el pointer lock real no existe en headless). */
export async function fakePointerLock(page) {
  await page.evaluate(() => Object.defineProperty(document, 'pointerLockElement', { get: () => window.__game.canvas, configurable: true }));
}

export const game = (page, fn, arg) => page.evaluate(fn, arg);

/** Espera a que haya n zombis vivos y los mata uno a uno (esperando a que desaparezcan). */
export async function killZombies(page, n) {
  await page.waitForFunction((k) => [...window.__game.avatars.values()].filter((a) => a.kind === 'zombie' && !a.dead).length >= k, n, { timeout: 30_000 });
  for (let i = 0; i < n; i++) {
    const id = await page.evaluate(() => {
      const z = [...window.__game.avatars.values()].find((a) => a.kind === 'zombie' && !a.dead);
      window.__game.onEntityHit(z.id, 999, 'rifle');
      return z.id;
    });
    await page.waitForFunction((zid) => !window.__game.avatars.has(zid), id, { timeout: 5000 });
  }
}

export async function waitPlaying(page) {
  await page.waitForFunction(() => window.__game?.active && performance.now() > window.__game.frozenUntil, null, { timeout: 20_000 });
}

export function expectNoErrors(...pages) {
  for (const p of pages) expect(p.errors, 'errores en la página').toEqual([]);
}

/** Host crea sala; el invitado entra escribiendo el código (en minúsculas, a propósito). */
export async function hostAndJoin(browser, mode, selects = {}) {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await openGame(hostCtx);
  await host.fill('#input-name', 'Host');
  await chooseMode(host, mode, selects);
  await host.click('#btn-create');
  const code = await host.textContent('#room-code');
  const guest = await openGame(guestCtx);
  await guest.fill('#input-name', 'Invitado');
  await guest.fill('#input-code', ` ${code.toLowerCase()} `);
  await guest.click('#btn-join');
  await expect(host.locator('#btn-start')).toBeEnabled({ timeout: 30_000 });
  await host.click('#btn-start');
  await waitPlaying(host);
  await waitPlaying(guest);
  const ids = {
    host: await host.evaluate(() => window.__selfId),
    guest: await guest.evaluate(() => window.__selfId),
  };
  return { host, guest, code, ids, close: () => Promise.all([hostCtx.close(), guestCtx.close()]) };
}
