import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
const envFile = new URL('./.env.test', import.meta.url);
if (!fs.existsSync(envFile)) throw new Error('Falta e2e/.env.test: cópialo de .env.test.example.');
for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = l.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim();
}
// La batería cambia el SMTP a Mailpit y crea datos de prueba: nunca contra producción.
const host = new URL(process.env.PLANE_URL).hostname;
if (!/^(localhost|127\.0\.0\.1)$|\.localhost$/.test(host)) {
  throw new Error(`PLANE_URL=${process.env.PLANE_URL}: la batería E2E solo se ejecuta contra localhost.`);
}

export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLANE_URL,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true, // ensayo HTTPS local con la CA interna de Caddy
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
