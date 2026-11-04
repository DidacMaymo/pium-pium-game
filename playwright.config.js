import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 960, height: 600 },
    // WebGL por software para que funcione sin GPU (CI, contenedores)
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    { command: 'node tests/e2e/support/relay.mjs', port: 8787, reuseExistingServer: !process.env.CI },
    { command: 'npx vite --config tests/e2e/support/vite.e2e.config.js', port: 5174, reuseExistingServer: !process.env.CI },
  ],
});
