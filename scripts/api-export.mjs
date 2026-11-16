// Extrae todo un espacio de trabajo por la API pública (/api/v1), solo con lecturas (GET),
// guarda cada respuesta en scripts/export/<espacio>/ y escribe informe.md con el estado de
// cada endpoint. Seguro contra producción: no modifica nada. Uso: node scripts/api-export.mjs
import fs from 'node:fs';
import { api, WS } from './lib.mjs';

const W = `workspaces/${WS}`;
const dir = new URL(`./export/${WS}/`, import.meta.url);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const rows = []; // { path, status, count, ms }
const pattern = (p) => p.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '{id}');
const listOf = (d) => (Array.isArray(d) ? d : Array.isArray(d?.results) ? d.results : null);

// GET con paginación por cursor. Devuelve los datos (o null si no es 2xx) y anota la fila del informe.
async function get(file, path) {
  const t = Date.now();
  let r = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100`);
  let data = r.data;
  const pages = listOf(data) && !Array.isArray(data) ? [data] : null;
  while (pages && r.status === 200 && r.data.next_page_results) {
    r = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&cursor=${r.data.next_cursor}`);
    pages.push(r.data);
  }
  if (pages) data = pages.flatMap((p) => p.results ?? []);
  const ok = r.status >= 200 && r.status < 300;
  const list = listOf(data);
  rows.push({ path: pattern(path), status: r.status, count: ok ? (list ? list.length : 1) : 0, ms: Date.now() - t });
  if (file) fs.writeFileSync(new URL(`${file}.json`, dir), JSON.stringify(data, null, 1));
  return ok ? data : null;
}
const first = (l) => (Array.isArray(l) && l.length ? l[0] : null);

console.log(`Extrayendo ${WS}...`);
await get('usuario', 'users/me/');
await get('miembros', `${W}/members/`);
await get(null, `${W}/members-lite/`);
await get(null, `${W}/projects-lite/`);
const invites = await get('invitaciones', `${W}/invitations/`);
if (first(invites)) await get(null, `${W}/invitations/${first(invites).id}/`);
const stickies = await get('notas', `${W}/stickies/`);
if (first(stickies)) await get(null, `${W}/stickies/${first(stickies).id}/`);
await get(null, `${W}/work-items/search/?search=reserva`);
await get(null, `${W}/issues/search/?search=reserva`);

const projects = (await get('proyectos', `${W}/projects/`)) ?? [];
const summary = [];
for (const p of projects) {
  const P = `${W}/projects/${p.id}`;
  const f = (n) => `${p.identifier}-${n}`;
  await get(f('proyecto'), `${P}/`);
  await get(null, `${P}/summary/`);
  const states = await get(f('estados'), `${P}/states/`);
  if (first(states)) await get(null, `${P}/states/${first(states).id}/`);
  const labels = await get(f('etiquetas'), `${P}/labels/`);
  if (first(labels)) await get(null, `${P}/labels/${first(labels).id}/`);
  const members = await get(f('miembros'), `${P}/members/`);
  await get(null, `${P}/project-members/`);
  await get(null, `${P}/project-members-lite/`);
  await get(null, `${P}/estimates/`);

  const cycles = (await get(f('ciclos'), `${P}/cycles/?cycle_view=all`)) ?? [];
  await get(null, `${P}/cycles-lite/`);
  const archivedCycles = (await get(f('ciclos-archivados'), `${P}/archived-cycles/`)) ?? [];
  const cycleItems = {};
  for (const c of cycles) {
    cycleItems[c.name] = ((await get(f(`ciclo-${c.id}`), `${P}/cycles/${c.id}/cycle-issues/`)) ?? []).length;
  }
  if (first(cycles)) await get(null, `${P}/cycles/${first(cycles).id}/`);

  const modules = (await get(f('modulos'), `${P}/modules/`)) ?? [];
  await get(null, `${P}/modules-lite/`);
  await get(null, `${P}/archived-modules/`);
  for (const m of modules) await get(f(`modulo-${m.id}`), `${P}/modules/${m.id}/module-issues/`);
  if (first(modules)) await get(null, `${P}/modules/${first(modules).id}/`);

  const items = (await get(f('tareas'), `${P}/work-items/?expand=assignees,labels,state`)) ?? [];
  await get(null, `${P}/issues/`); // ruta antigua, sigue activa
  const sub = { comentarios: 0, enlaces: 0, actividad: 0, adjuntos: 0, relaciones: 0 };
  for (const it of items) {
    const I = `${P}/work-items/${it.id}`;
    const n = (l) => (Array.isArray(l) ? l.length : Object.values(l ?? {}).flat().length);
    const c = await get(null, `${I}/comments/`); sub.comentarios += n(c);
    const l = await get(null, `${I}/links/`); sub.enlaces += n(l);
    const a = await get(null, `${I}/activities/`); sub.actividad += n(a);
    const at = await get(null, `${I}/attachments/`); sub.adjuntos += n(at);
    const r = await get(null, `${I}/relations/`); sub.relaciones += n(r);
    fs.writeFileSync(new URL(`${p.identifier}-${it.sequence_id}.json`, dir), JSON.stringify({
      tarea: it, comentarios: c, enlaces: l, actividad: a, adjuntos: at, relaciones: r,
    }, null, 1));
    // Detalle de cada subrecurso con el primer elemento que aparezca
    for (const [kind, list] of [['comments', c], ['links', l], ['activities', a], ['attachments', at]]) {
      if (first(list) && !rows.some((x) => x.path === pattern(`${I}/${kind}/${first(list).id}/`))) {
        await get(null, `${I}/${kind}/${first(list).id}/`);
      }
    }
  }
  const one = first(items);
  if (one) {
    await get(null, `${P}/work-items/${one.id}/`);
    await get(null, `${W}/work-items/${p.identifier}-${one.sequence_id}/`);
  }
  const intake = (await get(f('intake'), `${P}/intake-issues/`)) ?? [];
  if (first(intake)) await get(null, `${P}/intake-issues/${first(intake).issue}/`);

  summary.push({
    proyecto: `${p.identifier} · ${p.name}`, miembros: members?.length ?? 0, estados: states?.length ?? 0,
    etiquetas: labels?.length ?? 0, ciclos: `${cycles.length} + ${archivedCycles.length} archivados`,
    modulos: modules.length, tareas: items.length, intake: intake.length, ...sub, tareasPorCiclo: cycleItems,
  });
}
fs.writeFileSync(new URL('resumen.json', dir), JSON.stringify(summary, null, 1));

// ---------- Informe ----------
const agg = (list) => {
  const m = new Map();
  for (const r of list) {
    const k = `${r.method ?? 'GET'} ${r.path}`;
    const e = m.get(k) ?? { k, calls: 0, statuses: new Set(), count: 0, ms: 0 };
    e.calls++; e.statuses.add(r.status); e.count += r.count ?? 0; e.ms = Math.max(e.ms, r.ms ?? 0);
    m.set(k, e);
  }
  return [...m.values()];
};
const reads = agg(rows);
const seedFile = new URL('./export/seed-calls.json', import.meta.url);
const writes = fs.existsSync(seedFile)
  ? agg(JSON.parse(fs.readFileSync(seedFile, 'utf8')).filter((c) => c.method !== 'GET')) : [];
// 3xx es correcto: el detalle de un adjunto redirige a su descarga firmada en MinIO
const ok = (e) => [...e.statuses].every((s) => s < 400);
const fmt = (e) => `| \`${e.k}\` | ${[...e.statuses].join(', ')} | ${e.calls} |`;

const md = [
  `# Informe de la API de Plane · espacio \`${WS}\``, '',
  `Generado el ${new Date().toLocaleString('es-ES')} contra ${process.env.PLANE_URL}.`, '',
  '## Resumen', '',
  `- Lecturas: ${reads.length} endpoints distintos, ${rows.length} llamadas, ${reads.filter(ok).length} sin errores.`,
  `- Escrituras de la siembra: ${writes.length} endpoints distintos, ${writes.filter(ok).length} sin errores.`, '',
  '| Proyecto | Miembros | Estados | Etiquetas | Ciclos | Módulos | Tareas | Intake | Comentarios | Enlaces | Adjuntos | Relaciones | Actividad |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...summary.map((s) => `| ${s.proyecto} | ${s.miembros} | ${s.estados} | ${s.etiquetas} | ${s.ciclos} | ${s.modulos} | ${s.tareas} | ${s.intake} | ${s.comentarios} | ${s.enlaces} | ${s.adjuntos} | ${s.relaciones} | ${s.actividad} |`),
  '', '## Endpoints con error', '',
  ...([...reads, ...writes].filter((e) => !ok(e)).map(fmt).length
    ? ['| Endpoint | Estado | Llamadas |', '|---|---|---|', ...[...reads, ...writes].filter((e) => !ok(e)).map(fmt)]
    : ['Ninguno.']),
  '', '## Lo que la API pública v1.4.3 no cubre', '',
  '- **Estimaciones:** el código existe pero sus rutas no están registradas (404, también en la rama principal de Plane). Se crean desde la app.',
  '- **Páginas, vistas guardadas, webhooks, tokens, ajustes del espacio y creación de espacios:** solo desde la app.',
  '- **Registro de horas (worklogs) e hitos:** son de los planes de pago de Plane; aquí los cubre el módulo de tiempo.',
  '', '## Lecturas (GET)', '', '| Endpoint | Estado | Llamadas | Registros | ms (máx.) |', '|---|---|---|---|---|',
  ...reads.map((e) => `| \`${e.k}\` | ${[...e.statuses].join(', ')} | ${e.calls} | ${e.count} | ${e.ms} |`),
  '', '## Escrituras probadas por la siembra (POST, PATCH, DELETE)', '',
  ...(writes.length ? ['| Endpoint | Estado | Llamadas |', '|---|---|---|', ...writes.map(fmt)] : ['No hay registro de siembra (scripts/export/seed-calls.json).']),
  '',
];
fs.writeFileSync(new URL('informe.md', dir), md.join('\n'));
console.log(`${rows.length} lecturas en ${reads.length} endpoints; ${reads.filter((e) => !ok(e)).length} con error.`);
console.log(`Informe: scripts/export/${WS}/informe.md`);
