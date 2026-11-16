// Crea el espacio de ejemplo "Acme" con un equipo ficticio y lo llena por la API.
// Datos inventados: nunca personas ni clientes reales.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { env, open, signIn, content, toast, waitForMail, mailpitHtml, browserFetch } from '../tests/helpers.mjs';
import { TASKS } from '../../scripts/demo-data.mjs';

const PAGES = [
  ['Acta de arranque', '<h2>Objetivo</h2><p>Que los clientes reserven sin llamar. Validado con 8 clientes piloto.</p><ul><li>Lanzamiento público en 5 semanas</li><li>Pagos con tarjeta desde el primer día</li></ul>'],
  ['Arquitectura de la API', '<h2>Servicios</h2><p>Disponibilidad, reservas y pagos. Toda hora viaja en UTC y se pinta en la zona del cliente.</p>'],
  ['Plan de lanzamiento', '<h2>Hitos</h2><ol><li>Diseño aprobado</li><li>API en staging</li><li>Beta cerrada</li><li>Lanzamiento público</li></ol>'],
];

export const SLUG = 'acme';
export const TEAM = [
  { email: 'laura@acme.test', first: 'Laura', last: 'Gomez' },
  { email: 'diego@acme.test', first: 'Diego', last: 'Martin' },
  { email: 'sofia@acme.test', first: 'Sofia', last: 'Ruiz' },
  { email: 'marco@acme.test', first: 'Marco', last: 'Diaz' },
];

test.describe.configure({ mode: 'serial' });
let admin;

test('espacio Acme y equipo invitado por correo', async ({ browser }) => {
  admin = await browser.newContext();
  const page = await admin.newPage();
  await signIn(page, env.ADMIN_EMAIL, env.ADMIN_PASSWORD);

  await open(page, `/${SLUG}/`);
  if (!(await page.getByRole('heading', { name: 'Acme', level: 4 }).count())) {
    await open(page, '/create-workspace/');
    await page.getByRole('textbox', { name: 'Name your workspace*' }).fill('Acme');
    await page.getByRole('textbox', { name: "Set your workspace's URL*" }).fill(SLUG);
    await page.getByRole('button', { name: 'Select a range' }).click();
    await page.getByRole('option', { name: '2-10' }).click();
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL(new RegExp(`/${SLUG}/`));
  }

  for (const p of TEAM) {
    await open(page, `/${SLUG}/settings/members/`);
    if ((await content(page).innerText()).includes(p.email)) continue;

    await content(page).getByRole('button', { name: 'Add member' }).click();
    const d = page.getByRole('dialog').last();
    await d.getByRole('textbox', { name: 'name@company.com' }).fill(p.email);
    await d.getByRole('button', { name: 'Send invitations' }).click();
    await expect(toast(page)).toContainText(/success/i);

    const mail = await waitForMail(`to:${p.email}`);
    const href = (await mailpitHtml(mail.ID)).match(/href="([^"]*workspace-invitations[^"]*)"/)[1].replaceAll('&amp;', '&');
    const ctx = await browser.newContext();
    const m = await ctx.newPage();
    await open(m, href);
    await open(m, '/sign-up/');
    await m.getByRole('textbox', { name: 'Email' }).fill(p.email);
    await m.getByRole('button', { name: 'Continue' }).click();
    await m.getByRole('textbox', { name: 'Set a password' }).fill(env.MEMBER_PASSWORD);
    await m.getByRole('textbox', { name: 'Confirm password' }).fill(env.MEMBER_PASSWORD);
    await m.getByRole('button', { name: 'Create account' }).click();
    await m.waitForURL(/onboarding/);
    await m.waitForLoadState('networkidle');
    await m.getByRole('textbox', { name: 'Name*' }).fill(`${p.first} ${p.last}`);
    await m.getByRole('button', { name: 'Continue' }).click();
    await m.getByRole('main').getByRole('checkbox').first().check();
    await m.getByRole('button', { name: 'Continue' }).click();
    await m.waitForURL(new RegExp(`/${SLUG}/`));
    await ctx.close();
    // Límite de 10 accesos por minuto e IP en la autenticación
    await page.waitForTimeout(20_000);
  }
  await open(page, `/${SLUG}/settings/members/`);
  for (const p of TEAM) await expect(content(page)).toContainText(p.email);
  await page.close();
});

test('proyecto completo por la API pública', async () => {
  execFileSync('node', ['../scripts/seed-demo.mjs', '--reset'], {
    stdio: 'inherit', env: { ...process.env, PLANE_WORKSPACE: SLUG },
  });
});

// Lo que la API pública no cubre se hace con la sesión del navegador (API interna de la app)
test('estimaciones, páginas y vistas', async () => {
  const page = await admin.newPage();
  await open(page, `/${SLUG}/projects/`);
  const ids = JSON.parse(fs.readFileSync(new URL('../../scripts/export/seed-ids.json', import.meta.url)));
  const base = `/api/workspaces/${SLUG}/projects/${ids.project}`;
  const call = async (method, path, body) => {
    const r = await browserFetch(page, `${base}${path}`, { method, body, headers: body ? { 'Content-Type': 'application/json' } : {} });
    expect(r.status, `${method} ${path}: ${r.text.slice(0, 300)}`).toBeLessThan(300);
    return r.text ? JSON.parse(r.text) : null;
  };

  await call('POST', '/estimates/', {
    estimate: { name: 'Puntos', type: 'points', last_used: true },
    estimate_points: [1, 2, 3, 5, 8, 13].map((v, i) => ({ key: i + 1, value: String(v) })),
  });
  const [est] = await call('GET', '/estimates/');
  const point = Object.fromEntries(est.points.map((p) => [Number(p.value), p.id]));
  await call('PATCH', '/', { estimate: est.id });
  for (const t of TASKS) await call('PATCH', `/issues/${ids.tasks[t[0]]}/`, { estimate_point: point[t[8]] });

  for (const [name, html] of PAGES) await call('POST', '/pages/', { name, description_html: html, access: 0 });
  await call('POST', '/views/', {
    name: 'Urgentes y altas', rich_filters: { priority__in: 'urgent,high' },
    display_filters: { layout: 'list', group_by: 'state', order_by: 'sort_order' },
  });
  await call('POST', '/views/', {
    name: 'Tablero por responsable', rich_filters: {},
    display_filters: { layout: 'kanban', group_by: 'assignees', order_by: 'priority' },
  });

  // Se ve en la interfaz: la página abre con su contenido y la tarea muestra sus puntos
  await open(page, `/${SLUG}/projects/${ids.project}/pages/`);
  await content(page).getByText('Acta de arranque').first().click();
  await expect(page.getByText('8 clientes piloto').first()).toBeVisible();
  await page.close();
});
