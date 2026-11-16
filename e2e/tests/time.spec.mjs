// Módulo de tiempo (/time/) sobre el espacio de la demo "acme".
// Requiere haber cargado la demo: npx playwright test -c seed.config.mjs y node scripts/seed-time.mjs.
import https from 'node:https';
import { test, expect } from '@playwright/test';
import { env, signIn, browserFetch } from './helpers.mjs';
import { PEOPLE } from '../../scripts/demo-data.mjs';

test.describe.configure({ mode: 'serial' });

const API = '/time/api/w/acme';
let admin, member; // páginas con sesión: administrador del espacio y Sofía (miembro)

// POST desde Node a *.localhost (Node no lo resuelve en Windows: se fuerza 127.0.0.1)
function nodePost(path, headers) {
  const url = new URL(path, env.PLANE_URL);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST', rejectUnauthorized: false,
      lookup: (_h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)),
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': 2 },
    }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end('{}');
  });
}

const call = async (page, method, path, body) => {
  const r = await browserFetch(page, `${API}/${path}`, {
    method, body, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
  return { status: r.status, data: r.text ? JSON.parse(r.text) : null };
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  admin = await (await browser.newContext()).newPage();
  await signIn(admin, env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  const me = await browserFetch(admin, '/time/api/me');
  test.skip(!JSON.parse(me.text).workspaces.some((w) => w.slug === 'acme'), 'Falta la demo "acme" (ver README)');
  member = await (await browser.newContext()).newPage();
  await member.waitForTimeout(20_000); // límite de Plane a la comprobación de email al iniciar sesión
  await signIn(member, PEOPLE.sofia, env.MEMBER_PASSWORD);
  await cleanUp();
});
// Borra lo que registran estas pruebas (también lo que dejara una ejecución anterior que falló)
async function cleanUp() {
  const today = new Date().toLocaleDateString('sv');
  const from = new Date(Date.now() - 864e5).toLocaleDateString('sv');
  const mine = (await call(member, 'GET', `entries?from=${from}&to=${today}`)).data;
  for (const e of mine.filter((e) => e.note === 'Prueba E2E' || (e.source === 'timer' && e.minutes <= 2))) {
    await call(member, 'DELETE', `entries/${e.id}`, {});
  }
  await call(member, 'DELETE', 'timer', {});
}
test.afterAll(async () => {
  if (member) await cleanUp();
  await admin?.context().close();
  await member?.context().close();
});

test('sin sesión responde 401 y una escritura desde otro origen, 403', async ({ browser }) => {
  // Las peticiones salen del navegador: Node no resuelve *.localhost en Windows
  const anon = await (await browser.newContext()).newPage();
  await anon.goto('/time/healthz');
  expect((await browserFetch(anon, '/time/api/me')).status).toBe(401);
  await anon.context().close();
  // Con la cookie de sesión de Sofía pero con el Origin de otro sitio: CSRF bloqueado.
  // El navegador no deja falsear Origin, así que esta petición sale de Node con la cookie real.
  const cookie = (await member.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  expect(await nodePost(`${API}/timer/stop`, { cookie, origin: 'https://evil.test' })).toBe(403);
  expect(await nodePost(`${API}/timer/stop`, { cookie, origin: new URL(env.PLANE_URL).origin })).toBe(409);
});

test('reloj: empezar en una tarea desde la barra y pararlo registra el tiempo', async () => {
  await member.goto('/time/#/acme/tareas', { waitUntil: 'networkidle' });
  await member.getByRole('button', { name: 'Empezar reloj' }).click();
  await member.getByRole('combobox', { name: 'Tarea' }).fill('Formulario de reserva');
  await member.getByRole('option', { name: /Formulario de reserva/ }).click();
  const timer = member.locator('.timer');
  await expect(timer).toContainText('Reloj en marcha');
  await expect(timer).toContainText('Formulario de reserva');
  // El reloj sigue en marcha al recargar (vive en el servidor)
  await member.reload({ waitUntil: 'networkidle' });
  await expect(timer).toContainText('Reloj en marcha');
  await timer.getByRole('button', { name: 'Parar' }).click();
  await expect(member.locator('.toast')).toContainText('Registrados 1 min');
  await expect(timer.getByRole('button', { name: 'Empezar reloj' })).toBeVisible();
});

test('registro manual en Mis horas y edición desde la hoja semanal', async () => {
  await member.goto('/time/#/acme/horas', { waitUntil: 'networkidle' });
  await member.locator('#q-task').fill('búsqueda de huecos');
  await member.getByRole('option', { name: /búsqueda de huecos/ }).click();
  await member.locator('#q-dur').fill('1:30');
  await member.locator('#q-note').fill('Prueba E2E');
  await member.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(member.locator('.toast')).toContainText('Registradas 1 h 30 m');
  // Duración no válida: no se envía
  await member.locator('#q-dur').fill('99:00');
  await member.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(member.locator('.toast')).toContainText('Duración no válida');

  const row = member.getByRole('row', { name: /búsqueda de huecos/ });
  await row.getByRole('button', { name: /1 h 30 m\. Editar/ }).click();
  const drawer = member.getByRole('dialog');
  await drawer.getByRole('textbox', { name: 'Duración', exact: true }).fill('2h');
  await drawer.getByRole('button', { name: 'Guardar' }).click();
  await expect(member.locator('.toast')).toContainText('Guardado');
  await member.keyboard.press('Escape');
  await expect(row).toContainText('2 h');
});

test('privacidad: un miembro no ve ni toca las horas de otras personas', async () => {
  const w = await call(member, 'GET', 'workload');
  expect(w.status).toBe(200);
  for (const p of w.data.people) {
    if (p.name.startsWith('Sofia')) expect(p.logged).not.toBeNull();
    else expect(p.logged).toBeNull();
  }
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  expect((await call(member, 'GET', `entries?from=${from}&to=${to}&user=all`)).status).toBe(403);
  expect((await call(member, 'GET', `report?from=${from}&to=${to}&group=person&user=all`)).status).toBe(403);

  // Una entrada de Diego: el administrador la ve; Sofía no puede editarla ni borrarla (404, no se revela)
  const all = await call(admin, 'GET', `entries?from=${from}&to=${to}&user=all`);
  const other = all.data.find((e) => e.person.startsWith('Diego'));
  expect(other).toBeTruthy();
  expect((await call(member, 'PATCH', `entries/${other.id}`, { minutes: 1 })).status).toBe(404);
  expect((await call(member, 'DELETE', `entries/${other.id}`, {})).status).toBe(404);
  // Ni verla desde los campos de la tarea dentro de Plane: ni la entrada ni el total del equipo
  const task = await call(member, 'GET', `tasks/by-ref/${other.ref}`);
  expect(task.status).toBe(200);
  expect(task.data.team).toBeNull();
  expect(task.data.entries.map((e) => e.person)).not.toContain(other.person);
  expect((await call(admin, 'GET', `tasks/by-ref/${other.ref}`)).data.entries.map((e) => e.id)).toContain(other.id);
  // Ni cambiar la capacidad de nadie
  expect((await call(member, 'PUT', `capacity/${other.user_id}`, { minutes_per_day: 60, workdays: [1] })).status).toBe(403);
});

test('carga de trabajo: con menos capacidad, la persona aparece sobre capacidad', async () => {
  const people = (await call(admin, 'GET', 'capacity')).data;
  const sofia = people.find((p) => p.name.startsWith('Sofia'));
  try {
    expect((await call(admin, 'PUT', `capacity/${sofia.id}`, { minutes_per_day: 30, workdays: [1, 2, 3, 4, 5, 6, 7] })).status).toBe(200);
    await admin.goto('/time/#/acme/carga', { waitUntil: 'networkidle' });
    await expect(admin.locator('.finding')).toContainText(/Sofia Ruiz.*supera su capacidad/);
    await expect(admin.getByRole('button', { name: /^Sofia Ruiz, .*sobre capacidad/ }).first()).toBeVisible();
  } finally {
    await call(admin, 'PUT', `capacity/${sofia.id}`, { minutes_per_day: sofia.minutes_per_day, workdays: sofia.workdays });
  }
});

// Dentro de la web de Plane (time/public/embed.js): los campos viven en la propia tarea
test('dentro de Plane: el estimado de la tarea mueve la carga; reloj y registro desde la tarea', async () => {
  const task = (await call(member, 'GET', 'tasks?q=RES-17')).data.find((t) => t.ref === 'RES-17');
  const planned = async () =>
    (await call(member, 'GET', `workload?from=${task.due ?? task.start}`)).data.people.find((p) => p.name.startsWith('Sofia')).planned;
  const before = await planned();
  await member.goto('/acme/browse/RES-17/', { waitUntil: 'networkidle' });
  const estimate = member.locator('[data-time-estimate]');
  await expect(estimate).toHaveText(`${task.estimate / 60} h`);
  try {
    await estimate.click();
    await member.locator('[data-time-row] input').fill(`${task.estimate / 60 + 8}h`);
    await member.keyboard.press('Enter');
    await expect(estimate).toHaveText(`${task.estimate / 60 + 8} h`);
    expect(await planned()).toBeGreaterThan(before);
  } finally {
    await call(member, 'PUT', `tasks/${task.id}/estimate`, { minutes: task.estimate });
  }

  // Reloj desde la tarea: aparece en la cabecera de Plane y se para desde ahí
  await member.locator('[data-time-row] .time-play').click();
  await expect(member.locator('.time-pill')).toContainText('RES-17');
  await member.locator('.time-pill .time-play').click();
  await expect(member.locator('.time-pill')).toHaveCount(0);

  // Registro manual en el desplegable del tiempo registrado
  await member.locator('[data-time-tracked]').click();
  const popover = member.locator('.time-popover');
  await popover.locator('input').first().fill('0:15');
  await popover.locator('input').nth(2).fill('Prueba E2E');
  await popover.locator('button[type=submit]').click();
  await expect(popover).toContainText('Prueba E2E');
});

test('dentro de Plane: «Carga de trabajo» en la barra lateral abre el módulo sobre el contenido', async () => {
  await member.goto('/acme/browse/RES-17/', { waitUntil: 'networkidle' });
  await member.locator('[data-time-nav]').click();
  await expect(member).toHaveURL(/\/acme\/\?tiempo=carga$/);
  await expect(member.frameLocator('iframe.time-frame').locator('.tabs a[aria-current="page"]')).toHaveText('Carga de trabajo');
  await member.goBack();
  await expect(member.locator('iframe.time-frame')).toHaveCount(0);
});

test('informes: exportar CSV con lo registrado hoy', async () => {
  const today = new Date().toLocaleDateString('sv');
  const csv = await browserFetch(member, `${API}/report?from=${today}&to=${today}&format=csv`);
  expect(csv.status).toBe(200);
  expect(csv.text).toContain('Día;Persona;Proyecto;Tarea');
  expect(csv.text).toContain('Prueba E2E');

});
