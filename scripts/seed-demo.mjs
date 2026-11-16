// Llena el espacio de ejemplo con un proyecto completo usando solo la API pública /api/v1.
// Requisito: el espacio y el equipo ya existen (e2e/seed/acme.spec.mjs). Uso: node scripts/seed-demo.mjs
import fs from 'node:fs';
import { must, all, request, stats, callLog, WS } from './lib.mjs';
import {
  PEOPLE, LABELS, STATES, CYCLES, MODULES, TASKS, RELATIONS, COMMENTS, LINKS, INTAKE, MKT_TASKS, day,
} from './demo-data.mjs';

const W = `workspaces/${WS}`;
const log = (m) => console.log(`· ${m}`);

const members = await all(`${W}/members/`);
const who = Object.fromEntries(Object.entries(PEOPLE).map(([k, email]) => {
  const m = members.find((x) => x.email === email);
  if (!m) throw new Error(`Falta ${email} en el espacio ${WS}: ejecuta antes la siembra del equipo.`);
  return [k, m.id];
}));

const existing = (await all(`${W}/projects/`)).filter((p) => ['RES', 'MKT'].includes(p.identifier));
if (existing.length && !process.argv.includes('--reset')) {
  console.log(`Los proyectos de ejemplo ya existen en ${WS}; usa --reset para borrarlos y repetir.`);
  process.exit(0);
}
for (const p of existing) await must('DELETE', `${W}/projects/${p.id}/`);
const STICKIES = ['Daily 9:30', 'Pendiente de legal'];
for (const s of await all(`${W}/stickies/`)) {
  if (STICKIES.includes(s.name)) await must('DELETE', `${W}/stickies/${s.id}/`);
}

async function project(name, identifier, description, lead) {
  const p = await must('POST', `${W}/projects/`, { name, identifier, description, network: 2, project_lead: who[lead] });
  await must('PATCH', `${W}/projects/${p.id}/`, {
    cycle_view: true, module_view: true, issue_views_view: true, page_view: true, intake_view: true,
  });
  const inside = new Set((await must('GET', `${W}/projects/${p.id}/members/`)).map((m) => m.id));
  for (const [k, id] of Object.entries(who)) {
    if (!inside.has(id)) await must('POST', `${W}/projects/${p.id}/members/`, { member: id, role: k === lead ? 20 : 15 });
  }
  log(`proyecto ${identifier} con ${Object.keys(who).length} miembros`);
  return p;
}

// Renombra los estados por defecto y añade "En revisión"
async function states(P) {
  const list = await all(`${P}/states/`);
  const byGroup = (g) => list.find((s) => s.group === g);
  const out = {};
  for (const g of ['backlog', 'unstarted', 'started', 'completed', 'cancelled']) {
    const s = byGroup(g);
    out[g] = (await must('PATCH', `${P}/states/${s.id}/`, { name: STATES[g] })).id;
  }
  out.review = (await must('POST', `${P}/states/`, { name: STATES.review, color: '#a855f7', group: 'started' })).id;
  return out;
}

// ---------- Proyecto principal ----------
const res = await project('App de Reservas', 'RES', 'Reservas online para los clientes de Acme: web, API y pagos.', 'laura');
const P = `${W}/projects/${res.id}`;
const st = await states(P);
log('6 estados');

const label = {};
for (const [name, color] of LABELS) label[name] = (await must('POST', `${P}/labels/`, { name, color })).id;
log(`${LABELS.length} etiquetas`);

// Las estimaciones no están en la API pública v1.4.3 (rutas sin registrar): las pone e2e/seed/acme.spec.mjs.

// Plane no deja añadir tareas a un ciclo ya terminado: se crean en fechas futuras
// provisionales y, con las tareas dentro, se mueven a sus fechas reales.
const cycles = [];
for (const [i, [name]] of CYCLES.entries()) {
  cycles.push(await must('POST', `${P}/cycles/`, {
    name, start_date: day(400 + i * 20), end_date: day(410 + i * 20), owned_by: who.laura, project_id: res.id,
  }));
}

const modules = [];
for (const [name, a, b, status, lead] of MODULES) {
  modules.push(await must('POST', `${P}/modules/`, {
    name, start_date: day(a), target_date: day(b), status, lead: who[lead], members: [who[lead]],
  }));
}
log(`${modules.length} módulos (fases)`);

const ref = {};
for (const [r, name, mod, cyc, person, state, priority, labels, pts, a, b, h, parent] of TASKS) {
  const t = await must('POST', `${P}/work-items/`, {
    name, state: st[state], priority, assignees: [who[person]], labels: labels.map((l) => label[l]),
    start_date: day(a), target_date: day(b),
    parent: parent ? ref[parent].id : null,
    description_html: `<p>Estimación: ${h} h.</p>`,
  });
  ref[r] = t;
  await must('POST', `${P}/modules/${modules[mod].id}/module-issues/`, { issues: [t.id] });
  if (cyc !== null) await must('POST', `${P}/cycles/${cycles[cyc].id}/cycle-issues/`, { issues: [t.id] });
}
log(`${TASKS.length} tareas con fase, sprint, responsable, estado, prioridad y fechas`);

for (const [i, [, a, b]] of CYCLES.entries()) {
  await must('PATCH', `${P}/cycles/${cycles[i].id}/`, { start_date: day(a), end_date: day(b) });
}
log(`${cycles.length} ciclos: uno terminado, uno recién cerrado, el actual y el siguiente`);

for (const [r, type, others] of RELATIONS) {
  await must('POST', `${P}/work-items/${ref[r].id}/relations/`, { relation_type: type, issues: others.map((o) => ref[o].id) });
}
for (const [r, html] of COMMENTS) await must('POST', `${P}/work-items/${ref[r].id}/comments/`, { comment_html: html });
for (const [r, url, title] of LINKS) await must('POST', `${P}/work-items/${ref[r].id}/links/`, { url, title });
log(`${RELATIONS.length} dependencias, ${COMMENTS.length} comentarios, ${LINKS.length} enlaces`);

// Adjuntos: la API da una subida firmada a MinIO y luego se marca como subido
async function attach(task, name, type, buf) {
  const a = await must('POST', `${P}/work-items/${task.id}/attachments/`, { name, type, size: buf.length });
  const { url, fields } = a.upload_data;
  const b = `----plane${Date.now()}`;
  const parts = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  const body = Buffer.concat([
    Buffer.from(parts.join('') + `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    buf, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const up = await request('POST', url, { headers: { 'Content-Type': `multipart/form-data; boundary=${b}` }, body });
  if (up.status >= 300) throw new Error(`subida ${name} -> ${up.status} ${up.body}`);
  await must('PATCH', `${P}/work-items/${task.id}/attachments/${a.asset_id ?? a.id}/`, { is_uploaded: true });
}
await attach(ref.T3, 'captura-prototipo.png', 'image/png', fs.readFileSync(new URL('../e2e/fixtures/avatar.png', import.meta.url)));
await attach(ref.T1, 'acta-entrevistas.md', 'text/markdown', Buffer.from('# Acta\n\n- 8 entrevistas\n- Dolor principal: llamar para reservar\n'));
log('2 adjuntos subidos a MinIO');

// El sprint 2 ya terminó: lo que quedó sin hacer pasa al sprint actual
await must('POST', `${P}/cycles/${cycles[1].id}/transfer-issues/`, { new_cycle_id: cycles[2].id });
await must('POST', `${P}/cycles/${cycles[0].id}/archive/`);
log('sprint 2 traspasado al 3 y sprint 1 archivado');

const intake = [];
for (const [name, priority] of INTAKE) {
  intake.push(await must('POST', `${P}/intake-issues/`, { issue: { name, priority, description_html: `<p>${name}</p>` } }));
}
const intakeIssue = (i) => i.issue?.id ?? i.issue ?? i.issue_detail?.id;
await must('PATCH', `${P}/intake-issues/${intakeIssue(intake[1])}/`, { status: 1 });
await must('PATCH', `${P}/intake-issues/${intakeIssue(intake[2])}/`, { status: -1 });
log('3 peticiones de intake: 1 aceptada, 1 rechazada, 1 pendiente');

for (const [name, html] of [
  [STICKIES[0], '<p>Bloqueos primero, después lo de ayer.</p>'],
  [STICKIES[1], '<p>Revisar la cláusula de cancelación antes de la beta.</p>'],
]) await must('POST', `${W}/stickies/`, { name, description_html: html });
log('2 notas rápidas');

// ---------- Segundo proyecto ----------
const mkt = await project('Campaña de lanzamiento', 'MKT', 'Marketing del lanzamiento de la app de reservas.', 'laura');
const PM = `${W}/projects/${mkt.id}`;
const stm = await states(PM);
const launch = await must('POST', `${PM}/modules/`, { name: 'Lanzamiento', start_date: day(-6), target_date: day(9), status: 'in-progress', lead: who.laura });
for (const [, name, person, state, priority, a, b, h] of MKT_TASKS) {
  const t = await must('POST', `${PM}/work-items/`, {
    name, state: stm[state], priority, assignees: [who[person]], start_date: day(a), target_date: day(b),
    description_html: `<p>Estimación: ${h} h.</p>`,
  });
  await must('POST', `${PM}/modules/${launch.id}/module-issues/`, { issues: [t.id] });
}
log(`proyecto MKT con ${MKT_TASKS.length} tareas`);

// Movimiento real: unas tareas avanzan de estado (queda en la actividad)
await must('PATCH', `${P}/work-items/${ref.T12.id}/`, { state: st.completed });
await must('PATCH', `${P}/work-items/${ref.T13.id}/`, { priority: 'urgent' });
log('cambios de estado y prioridad registrados en la actividad');

fs.mkdirSync(new URL('./export/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./export/seed-ids.json', import.meta.url), JSON.stringify({
  project: res.id, mkt: mkt.id, tasks: Object.fromEntries(Object.entries(ref).map(([k, t]) => [k, t.id])),
}, null, 1));
fs.writeFileSync(new URL('./export/seed-calls.json', import.meta.url), JSON.stringify(callLog));

console.log(`\nListo: ${stats()} llamadas a la API. Abre ${process.env.PLANE_URL}/${WS}/projects/`);
