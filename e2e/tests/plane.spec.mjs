// Recorrido completo de Plane CE: instancia, espacio de trabajo, proyecto, tareas,
// ciclos, módulos, vistas, páginas en tiempo real, intake, publicación, equipo,
// notificaciones, API REST y webhooks. Se puede repetir sobre la misma instancia.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import {
  env, run, open, toast, content, signIn, dayCell, pickOption,
  waitForMail, mailpitHtml, browserFetch,
} from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

const S = {
  slug: 'demo',
  projectName: `Proyecto ${run}`,
  key: `T${run}`.slice(0, 5),
  memberEmail: `miembro-${run.toLowerCase()}@plane.test`,
  memberName: `Miembro ${run.replace(/\d/g, (d) => 'ABCDEFGHIJ'[d])}`, // Plane no admite cifras en el nombre
};
let admin; // contexto del administrador, compartido por las pruebas
let projectUrl;

test.afterAll(async () => { await admin?.close(); });

test('panel god-mode: alta o acceso del administrador de la instancia', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await open(page, '/god-mode/');
  if (await page.getByText('Setup your Plane Instance').isVisible()) {
    await page.getByLabel('First name *').fill('Admin');
    await page.getByLabel('Last name *').fill('Plane');
    await page.getByLabel('Email *').fill(env.ADMIN_EMAIL);
    await page.getByLabel('Company name *').fill('Empresa Demo');
    await page.getByLabel('Set a password *').fill(env.ADMIN_PASSWORD);
    await page.getByLabel('Confirm password *').fill(env.ADMIN_PASSWORD);
    await page.getByRole('checkbox', { name: /anonymously collect/ }).uncheck();
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    await page.getByLabel('Email *').fill(env.ADMIN_EMAIL);
    await page.getByLabel('Password *').fill(env.ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await page.waitForURL(/god-mode\/general/);
  await expect(page.getByRole('textbox', { name: 'Admin email' })).toHaveValue(env.ADMIN_EMAIL);

  // Autenticación: contraseña activa
  await open(page, '/god-mode/authentication/');
  await expect(page.getByText('Passwords').first()).toBeVisible();

  // SMTP contra Mailpit y correo de prueba
  await open(page, '/god-mode/email/');
  const main = page.getByRole('main');
  const sw = main.getByRole('switch');
  if (!(await sw.isChecked())) await sw.click();
  await main.getByRole('textbox', { name: 'email.google.com' }).fill(env.SMTP_HOST || 'mailpit');
  await main.getByRole('textbox', { name: '8080' }).fill(env.SMTP_PORT || '1025');
  await main.getByRole('textbox', { name: 'no-reply@projectplane.so' }).fill('no-reply@plane.test');
  await main.getByRole('button', { name: /^(TLS|SSL|No email security)$/ }).click();
  await page.getByRole('option', { name: 'No email security' }).click();
  const save = main.getByRole('button', { name: 'Save changes' });
  if (await save.isEnabled()) {
    await save.click();
    await expect(toast(page)).toContainText('Email Settings updated successfully');
  }
  await main.getByRole('button', { name: 'Send test email' }).click();
  const to = `smtp-${run.toLowerCase()}@plane.test`;
  await page.getByRole('dialog').getByRole('textbox', { name: 'Receiver email' }).fill(to);
  await page.getByRole('dialog').getByRole('button', { name: 'Send email' }).click();
  await expect(page.getByRole('dialog')).toContainText('We have sent the test email');
  await waitForMail(`to:${to}`);
  await ctx.close();
});

test('app: inicio de sesión y onboarding hasta el espacio de trabajo', async ({ browser }) => {
  admin = await browser.newContext();
  const page = await admin.newPage();
  await signIn(page, env.ADMIN_EMAIL, env.ADMIN_PASSWORD);

  if (page.url().includes('/onboarding')) {
    const name = page.getByRole('textbox', { name: 'Name*' });
    if (await name.isVisible()) {
      await page.getByRole('button', { name: 'Upload image' }).click();
      await page.getByRole('dialog').locator('input[type=file]').setInputFiles('fixtures/avatar.png');
      await page.getByRole('button', { name: 'Upload & Save' }).click();
      await expect(page.getByRole('button', { name: 'Change image' })).toBeVisible();
      await page.getByRole('button', { name: 'Continue' }).click();
    }
    await page.getByRole('textbox', { name: 'Name your workspace*' }).fill('Demo');
    await page.getByRole('textbox', { name: "Set your workspace's URL*" }).fill(S.slug);
    await page.getByRole('button', { name: '2-10' }).click();
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.getByRole('button', { name: 'I’ll do it later' }).click();
  } else if (!page.url().includes(`/${S.slug}/`)) {
    // Plane abre el último espacio visitado (puede ser el de la demo "acme")
    await open(page, `/${S.slug}/`);
  }
  await page.waitForURL(new RegExp(`/${S.slug}/`));
  await expect(page.getByRole('heading', { name: 'Demo', level: 4 })).toBeVisible();

  // El avatar subido a MinIO se sirve de verdad
  await open(page, '/settings/profile/');
  const avatar = page.locator('img[src*="/api/assets/v2/static/"]').first();
  if (await avatar.count()) {
    await expect.poll(() => avatar.evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  }
  await page.close();
});

test('proyecto: creación con todas las funciones activadas', async () => {
  const page = await admin.newPage();
  await open(page, `/${S.slug}/projects/`);
  await page.getByRole('button', { name: 'Add Project', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Project name' }).fill(S.projectName);
  await d.getByRole('textbox', { name: 'Project ID' }).fill(S.key);
  await d.getByRole('textbox', { name: 'Description' }).fill('Proyecto creado por la batería E2E');
  await d.getByRole('button', { name: 'Create project' }).click();
  await expect(toast(page)).toContainText('Project created successfully');

  const features = page.getByRole('dialog').filter({ hasText: 'Projects and work items' });
  const switches = features.getByRole('switch');
  await expect(switches).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    if (!(await switches.nth(i).isChecked())) {
      await switches.nth(i).click();
      await expect(switches.nth(i)).toBeChecked();
    }
  }
  await features.getByRole('link', { name: 'Open project' }).click();
  await page.waitForURL(/\/issues\/$/);
  projectUrl = page.url().replace(/issues\/$/, '').replace(/^https?:\/\/[^/]+/, '');
  await page.close();
});

test('tareas: crear con estado, prioridad, asignado, etiqueta y fecha', async () => {
  const page = await admin.newPage();
  await open(page, `${projectUrl}issues/`);
  await page.getByRole('button', { name: 'Add work item' }).click();
  const d = page.getByRole('dialog').filter({ hasText: 'Create new work item' });
  await d.getByRole('textbox', { name: 'Title' }).fill('Diseñar página de inicio');
  await d.locator('[contenteditable=true]').click();
  await page.keyboard.type('Maqueta de la home con cabecera y pie.');
  await pickOption(page, d.getByRole('button', { name: 'Backlog' }).first(), 'Todo');
  await pickOption(page, d.getByRole('button', { name: 'None' }), 'High');
  await d.getByRole('button', { name: 'Assignees' }).first().click();
  await page.getByRole('option', { name: 'You' }).click();
  await page.keyboard.press('Escape');
  await d.getByRole('button', { name: 'Labels' }).click();
  await page.keyboard.type('frontend');
  await page.getByText('+ Add "frontend" to labels').click();
  await expect(d.getByRole('button', { name: '1 Labels' })).toBeVisible();
  await page.keyboard.press('Escape');
  await d.getByRole('button', { name: 'Due date' }).first().click();
  await dayCell(page, new Date()).click();
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(toast(page)).toContainText('Work item created successfully');
  await expect(content(page).getByRole('link', { name: new RegExp(`${S.key}-1 Diseñar página de inicio`) })).toBeVisible();

  // Segunda tarea, sin prioridad, para comprobar filtros
  await page.getByRole('button', { name: 'Add work item' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Title' }).fill('Revisar textos legales');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(content(page)).toContainText('Revisar textos legales');
  await page.close();
});

test('tarea: comentario, adjuntos (imagen y texto), enlace, subtarea y cambio de estado', async () => {
  const page = await admin.newPage();
  const errors = [];
  page.on('response', (r) => { if (r.status() >= 400 && /attachments/.test(r.url())) errors.push(r.status()); });
  await open(page, `/${S.slug}/browse/${S.key}-1/`);
  const main = content(page);

  await main.locator('.ProseMirror[contenteditable=true]').last().click();
  await page.keyboard.type('Primer comentario de prueba E2E');
  await main.getByRole('button', { name: 'Comment' }).click();
  await expect(main.getByText('Primer comentario de prueba E2E')).toBeVisible();

  // Imagen (con firma binaria) y ficheros de texto (sin firma: makeplane/plane#10128)
  const input = main.locator('input[type=file]').first(); // la sección se vuelve a pintar tras cada subida
  const files = [
    { name: 'foto.png', mimeType: 'image/png', buffer: (await import('node:fs')).readFileSync('fixtures/avatar.png') },
    { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('Notas de prueba\n') },
    { name: 'datos.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') },
    { name: 'leeme.md', mimeType: 'text/markdown', buffer: Buffer.from('# Hola\n') },
  ];
  for (const f of files) {
    const done = page.waitForResponse((r) => r.request().method() === 'PATCH' && /attachments\/[0-9a-f-]+\/$/.test(r.url()));
    await input.setInputFiles(f);
    expect((await done).status()).toBe(204);
    await expect(main.getByText(f.name, { exact: true })).toBeVisible();
  }
  expect(errors, 'subidas de adjuntos rechazadas').toEqual([]);

  // Descarga del adjunto: la API redirige a MinIO con URL firmada
  // (se abre en otra pestaña como descarga, así que se pide la misma URL con la sesión)
  const [req] = await Promise.all([
    admin.waitForEvent('request', (r) => r.method() === 'GET' && /attachments\/[0-9a-f-]+\/?$/.test(r.url())),
    main.getByRole('button', { name: /notas\.txt/ }).click(),
  ]);
  const file = await browserFetch(page, req.url());
  expect(file.status).toBe(200);
  expect(file.text).toContain('Notas de prueba');
  for (const p of admin.pages()) if (p !== page) await p.close();

  await main.getByRole('button', { name: 'Add link' }).first().click();
  const ld = page.getByRole('dialog').last();
  await ld.getByRole('textbox', { name: 'URL' }).fill('https://developers.plane.so');
  await ld.getByRole('textbox', { name: /Display title/ }).fill('Docs de Plane');
  await ld.getByRole('button', { name: 'Add Link' }).click();
  await expect(main.getByRole('button', { name: 'Links 1' })).toBeVisible();

  await main.getByRole('button', { name: 'Add sub-work item' }).first().click();
  await page.getByRole('menuitem', { name: 'Create new' }).click();
  const sd = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Title' }) });
  await sd.getByRole('textbox', { name: 'Title' }).fill('Cabecera responsive');
  await sd.getByRole('button', { name: 'Save' }).click();
  await expect(main.getByText('Cabecera responsive')).toBeVisible();

  await pickOption(page, main.getByRole('button', { name: 'Todo' }).first(), 'In Progress');
  await expect(main.getByRole('button', { name: 'In Progress' }).first()).toBeVisible();
  // La actividad la escribe el worker en segundo plano
  await expect.poll(async () => {
    await page.reload({ waitUntil: 'networkidle' });
    return main.getByText('set the state to In Progress').count();
  }, { timeout: 45_000 }).toBeGreaterThan(0);
  await page.close();
});

test('diseños: lista, tablero, calendario, hoja de cálculo y Gantt', async () => {
  const page = await admin.newPage();
  await open(page, `${projectUrl}issues/`);
  const main = content(page);
  // Los botones de diseño no tienen etiqueta accesible: son los iconos 2 a 6 de la cabecera
  const layout = (i) => main.locator('button').nth(i);
  const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const checks = [
    [3, async () => expect(main.getByText('New work item')).not.toHaveCount(1)],
    [4, async () => expect(main.getByText(month)).toBeVisible()],
    [5, async () => expect(main.getByText('Assignees').first()).toBeVisible()],
    [6, async () => expect(main.getByText('Duration')).toBeVisible()],
    [2, async () => expect(main.getByText('Diseñar página de inicio')).toBeVisible()],
  ];
  for (const [i, check] of checks) {
    await layout(i).click();
    await page.waitForLoadState('networkidle');
    await check();
    await test.info().attach(`diseño-${i}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.close();
});

test('ciclos y módulos: crear y asignar la tarea', async () => {
  const page = await admin.newPage();
  await open(page, `${projectUrl}cycles/`);
  await page.getByRole('button', { name: 'Add cycle' }).click();
  const d = page.getByRole('dialog').last();
  await d.getByRole('textbox', { name: 'Title' }).fill(`Sprint ${run}`);
  await d.getByRole('button', { name: 'Start date End date' }).first().click();
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const [from, to] = tomorrow.getMonth() === today.getMonth() ? [today, tomorrow] : [new Date(Date.now() - 86_400_000), today];
  await dayCell(page, from).click();
  await dayCell(page, to).click();
  await page.getByRole('button', { name: 'Create cycle' }).last().click();
  await expect(toast(page)).toContainText('Cycle created successfully');

  await open(page, `${projectUrl}modules/`);
  await page.getByRole('button', { name: 'Add Module' }).click();
  await page.getByRole('dialog').last().getByRole('textbox', { name: 'Title' }).fill(`Módulo ${run}`);
  await page.getByRole('dialog').last().getByRole('button', { name: 'Create Module' }).click();
  await expect(toast(page)).toContainText('Module created successfully');

  await open(page, `/${S.slug}/browse/${S.key}-1/`);
  const main = content(page);
  await pickOption(page, main.getByRole('button', { name: 'No cycle' }).first(), `Sprint ${run}`);
  await expect(main.getByRole('button', { name: `Sprint ${run}` }).first()).toBeVisible();
  await main.getByRole('button', { name: 'No module' }).first().click();
  await page.getByRole('option', { name: `Módulo ${run}` }).click();
  await page.keyboard.press('Escape');
  await expect(main.getByRole('button', { name: `Módulo ${run}` }).first()).toBeVisible();
  await page.close();
});

test('vistas: guardar una vista filtrada por prioridad', async () => {
  const page = await admin.newPage();
  await open(page, `${projectUrl}views/`);
  await page.getByRole('button', { name: 'Add view' }).click();
  const d = page.getByRole('dialog').last();
  await d.getByRole('textbox', { name: 'Title' }).fill('Alta prioridad');
  await d.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('option', { name: 'Priority' }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Create View' }).click();
  await expect(toast(page)).toContainText('View created successfully');
  await expect(content(page).getByText('Diseñar página de inicio')).toBeVisible();
  await expect(content(page).getByText('Revisar textos legales')).toHaveCount(0);
  await page.close();
});

test('páginas: edición colaborativa en tiempo real y guardado', async () => {
  const page = await admin.newPage();
  await open(page, `${projectUrl}pages/`);
  const ws = page.waitForEvent('websocket', (w) => w.url().includes('/live/collaboration'));
  await page.getByRole('button', { name: 'Add page' }).click();
  await ws;
  const eds = page.locator('.ProseMirror[contenteditable=true]');
  await expect(eds).toHaveCount(2);
  await eds.nth(0).click();
  await page.keyboard.type('Acta de reunión');
  await eds.nth(1).click();
  await page.keyboard.type('Puntos tratados en la reunión de arranque.');

  const other = await admin.newPage();
  await open(other, page.url());
  const eds2 = other.locator('.ProseMirror[contenteditable=true]');
  await expect(eds2.nth(1)).toContainText('Puntos tratados');
  await eds2.nth(1).click();
  await other.keyboard.press('Control+End');
  await other.keyboard.type(' Editado desde otra pestaña.');
  await expect(eds.nth(1)).toContainText('Editado desde otra pestaña');
  await other.close();

  // El servidor live guarda el documento: tras recargar sigue ahí
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(eds.nth(1)).toContainText('Editado desde otra pestaña');
  await expect(eds.nth(0)).toContainText('Acta de reunión');
  await page.close();
});

test('intake: recibir una petición y aceptarla en el proyecto', async () => {
  const page = await admin.newPage();
  await open(page, `${projectUrl}intake/`);
  await page.getByRole('button', { name: 'Add work item' }).click();
  await page.getByRole('dialog').last().getByRole('textbox', { name: 'Title' }).fill('Error en el formulario de contacto');
  await page.getByRole('dialog').last().getByRole('button', { name: 'Create work item' }).click();
  await expect(toast(page)).toContainText('Work item created successfully');
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Add to project' }).click();
  await expect(toast(page)).toContainText('Work item updated successfully');
  await open(page, `${projectUrl}issues/`);
  await expect(content(page).getByText('Error en el formulario de contacto')).toBeVisible();
  await page.close();
});

test('archivar y borrar tareas', async () => {
  const page = await admin.newPage();
  const main = content(page);
  const actions = () => main.locator('button').nth(4); // menú "..." de la cabecera (sin etiqueta)

  await open(page, `/${S.slug}/browse/${S.key}-2/`);
  await pickOption(page, main.getByRole('button', { name: 'Backlog' }).first(), 'Done');
  await actions().click();
  await page.getByRole('menuitem', { name: /Archive/ }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Archive' }).click();
  await expect(toast(page)).toContainText('Archive success');
  await open(page, `${projectUrl}archives/issues/`);
  await expect(main.getByText('Revisar textos legales')).toBeVisible();

  await open(page, `/${S.slug}/browse/${S.key}-3/`);
  await actions().click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Delete' }).click();
  await expect(toast(page)).toContainText('Work item deleted successfully');
  await page.close();
});

test('publicar el proyecto y verlo sin sesión', async ({ browser }) => {
  const page = await admin.newPage();
  await open(page, `${projectUrl}issues/`);
  // Menú rápido del proyecto en la barra lateral (el enlace cambia de nombre si está desplegado)
  const name = page.getByRole('complementary', { name: 'Main sidebar' }).getByText(S.projectName, { exact: true });
  await name.hover();
  await name.locator('xpath=ancestor::*[.//button[@aria-label="Toggle quick actions menu"]][1]')
    .getByRole('button', { name: 'Toggle quick actions menu' }).click();
  await page.getByRole('menuitem', { name: 'Publish project' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Publish' }).click();
  const link = page.getByRole('dialog').last().locator('a[href*="/spaces/issues/"]').first();
  const url = await link.getAttribute('href');
  await page.close();

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await open(p, url);
  await expect(p.getByText('Diseñar página de inicio')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await anon.close();
});

test('búsqueda global y analítica', async () => {
  const page = await admin.newPage();
  await open(page, `/${S.slug}/`);
  await page.getByRole('textbox', { name: 'Search commands...' }).click();
  await page.keyboard.type('Cabecera responsive');
  await expect(page.getByText('Cabecera responsive').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await open(page, `/${S.slug}/analytics/overview/`);
  await expect(content(page)).toContainText('Total Work items');
  await page.close();
});

test('equipo: invitar por correo, registrarse, unirse y recibir notificación', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await admin.newPage();
  await open(page, `/${S.slug}/settings/members/`);
  await content(page).getByRole('button', { name: 'Add member' }).click();
  const d = page.getByRole('dialog').last();
  await d.getByRole('textbox', { name: 'name@company.com' }).fill(S.memberEmail);
  await d.getByRole('button', { name: 'Send invitations' }).click();
  await expect(toast(page)).toContainText(/success/i);

  const mail = await waitForMail(`to:${S.memberEmail}`);
  expect(mail.Subject).toContain('invited you to join');
  const href = (await mailpitHtml(mail.ID)).match(/href="([^"]*workspace-invitations[^"]*)"/)[1].replaceAll('&amp;', '&');

  const mctx = await browser.newContext();
  const m = await mctx.newPage();
  await open(m, href);
  await expect(m.getByRole('heading', { name: 'You have been invited to Demo' })).toBeVisible();
  await open(m, '/sign-up/');
  await m.getByRole('textbox', { name: 'Email' }).fill(S.memberEmail);
  await m.getByRole('button', { name: 'Continue' }).click();
  await m.getByRole('textbox', { name: 'Set a password' }).fill(env.MEMBER_PASSWORD);
  await m.getByRole('textbox', { name: 'Confirm password' }).fill(env.MEMBER_PASSWORD);
  await m.getByRole('button', { name: 'Create account' }).click();
  await m.waitForURL(/onboarding/);
  await m.waitForLoadState('networkidle');
  await m.getByRole('textbox', { name: 'Name*' }).fill(S.memberName);
  await m.getByRole('button', { name: 'Continue' }).click();
  await m.getByRole('main').getByRole('checkbox').first().check();
  await m.getByRole('button', { name: 'Continue' }).click();
  await m.waitForURL(new RegExp(`/${S.slug}/`));

  await open(page, `/${S.slug}/settings/members/`);
  await expect(content(page)).toContainText(S.memberEmail);

  // El admin añade al miembro al proyecto y le asigna una tarea
  await open(page, `${projectUrl}settings/members/`);
  await content(page).getByRole('button', { name: 'Add member' }).click();
  const md = page.getByRole('dialog').last();
  await md.getByRole('button', { name: 'Select co-worker' }).last().click();
  await page.getByRole('option', { name: new RegExp(run, 'i') }).click();
  // El rol se hereda del espacio de trabajo; si sale como invitado, se sube a miembro
  if (await md.getByRole('button', { name: 'Guest' }).count()) {
    await pickOption(page, md.getByRole('button', { name: 'Guest' }).last(), 'Member');
  }
  await md.getByRole('button', { name: 'Add member' }).last().click();
  await expect(toast(page)).toContainText(/success/i);

  await open(page, `/${S.slug}/browse/${S.key}-1/`);
  await content(page).getByRole('button', { name: 'admin admin' }).first().click();
  await page.getByRole('option', { name: new RegExp(run, 'i') }).click();
  await page.keyboard.press('Escape');

  await open(m, `/${S.slug}/notifications/`);
  await expect.poll(async () => {
    await m.reload({ waitUntil: 'networkidle' });
    return (await content(m).innerText()).includes('Diseñar página de inicio');
  }, { timeout: 60_000 }).toBe(true);
  await mctx.close();
  await page.close();
});

test('API REST con token personal y entrega de webhooks', async () => {
  // Receptor local; el worker de Plane lo alcanza por host.docker.internal
  const events = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)).on('end', () => {
      events.push({ event: req.headers['x-plane-event'], signed: !!req.headers['x-plane-signature'], body: b });
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(9998, '0.0.0.0', r));

  try {
    const page = await admin.newPage();
    await open(page, '/settings/profile/api-tokens/');
    await page.getByRole('button', { name: 'Add access token' }).first().click();
    const d = page.getByRole('dialog').last();
    await d.getByRole('textbox', { name: 'Title' }).fill(`Token ${run}`);
    await d.getByRole('switch').click(); // "Never expires": sin elegir caducidad el botón no hace nada
    await d.getByRole('button', { name: 'Generate token' }).click();
    await expect(page.getByText(/plane_api_/).first()).toBeVisible();
    const token = (await page.locator('body').innerText()).match(/plane_api_[A-Za-z0-9]+/)[0];

    const api = `/api/v1/workspaces/${S.slug}`;
    const call = (path, opts = {}) => browserFetch(page, `${api}${path}`, { credentials: 'omit', ...opts });
    expect((await call('/projects/')).status).toBe(401);
    const projects = JSON.parse((await call('/projects/', { headers: { 'X-API-Key': token } })).text);
    const project = (projects.results || projects).find((p) => p.identifier === S.key);
    expect(project).toBeTruthy();

    await open(page, `/${S.slug}/settings/webhooks/`);
    await page.getByRole('button', { name: 'Add webhook' }).first().click();
    await page.getByRole('dialog').last().getByRole('textbox').fill(`http://host.docker.internal:9998/plane-${run}`);
    await page.getByRole('dialog').last().getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog').last()).toContainText(/secret/i);

    const created = await call(`/projects/${project.id}/work-items/`, {
      method: 'POST', headers: { 'X-API-Key': token, 'Content-Type': 'application/json' },
      body: { name: 'Creada por la API REST', priority: 'medium' },
    });
    expect(created.status).toBe(201);
    await expect.poll(() => events.find((e) => e.event === 'issue' && e.body.includes('Creada por la API REST')), { timeout: 60_000 }).toBeTruthy();
    expect(events.find((e) => e.event === 'issue').signed).toBe(true);
    await page.close();
  } finally {
    server.close();
  }
});
