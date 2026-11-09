import { expect } from '@playwright/test';

export const env = process.env;
export const MAILPIT = env.MAILPIT_URL || 'http://localhost:8025';
export const run = Date.now().toString(36).slice(-5).toUpperCase(); // sufijo único por ejecución

// Espera a que la app termine de hidratar: si se escribe antes, React borra los campos.
export async function open(page, path) {
  await page.goto(path, { waitUntil: 'networkidle' });
}

export const toast = (page) => page.getByRole('region', { name: 'Notifications' });
export const content = (page) => page.getByRole('main').last();

export async function signIn(page, email, password) {
  await open(page, '/');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: /^(Go to workspace|Continue)$/ }).click();
  await page.waitForURL((u) => u.pathname !== '/');
  await page.waitForLoadState('networkidle');
}

// Fecha de un gridcell del calendario de Plane: "November 22nd, 2026"
export function dayCell(page, date) {
  const d = date.getDate();
  const suf = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  const label = `${date.toLocaleString('en-US', { month: 'long' })} ${d}${suf}, ${date.getFullYear()}`;
  return page.getByRole('gridcell', { name: new RegExp(label) }).getByRole('button').first();
}

export async function pickOption(page, trigger, option) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function mailpitMessages(query) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  return (await r.json()).messages || [];
}

export async function mailpitHtml(id) {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()).HTML;
}

export async function waitForMail(query, timeout = 30_000) {
  let msgs = [];
  await expect.poll(async () => (msgs = await mailpitMessages(query)).length, { timeout }).toBeGreaterThan(0);
  return msgs[0];
}

// Petición HTTP hecha desde el navegador (resuelve *.localhost y usa su sesión si credentials='include')
export async function browserFetch(page, url, { method = 'GET', headers = {}, body, credentials = 'include' } = {}) {
  return page.evaluate(async ({ url, method, headers, body, credentials }) => {
    const r = await fetch(url, { method, headers, body: body && JSON.stringify(body), credentials });
    return { status: r.status, text: await r.text() };
  }, { url, method, headers, body, credentials });
}
