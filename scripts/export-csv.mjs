// Exporta un espacio de trabajo de Plane a CSV, una tabla por fichero, para Power BI, Excel o cualquier
// herramienta de informes: scripts/export/<espacio>/csv/. Solo lee (GET), así que vale contra producción.
// Con el token de un administrador del espacio incluye las horas de todo el equipo; con el de un
// miembro, solo las suyas. Guía: docs/extraer-datos.md
// Uso: node scripts/export-csv.mjs [año desde el que exportar horas; por defecto, el actual]
import fs from 'node:fs';
import { all, must, WS, BASE } from './lib.mjs';

const W = `workspaces/${WS}`;
const TIME = new URL(`/time/api/w/${encodeURIComponent(WS)}/`, BASE).href;
const dir = new URL(`./export/${WS}/csv/`, import.meta.url);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

// CSV estándar: separado por comas, UTF-8 con BOM, fechas ISO y números sin decimales
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function save(name, rows, cols) {
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))];
  fs.writeFileSync(new URL(`${name}.csv`, dir), `﻿${lines.join('\r\n')}\r\n`);
  console.log(`  ${name}.csv: ${rows.length} filas`);
}

console.log(`Exportando ${WS} a scripts/export/${WS}/csv/ ...`);
const t = { estados: [], etiquetas: [], tareas: [], responsables: [], tareaEtiquetas: [], ciclos: [], cicloTareas: [], modulos: [], moduloTareas: [] };

const proyectos = await all(`${W}/projects/`);
for (const p of proyectos) {
  const P = `${W}/projects/${p.id}`;
  for (const s of await all(`${P}/states/`)) t.estados.push({ ...s, project: p.id });
  for (const l of await all(`${P}/labels/`)) t.etiquetas.push({ ...l, project: p.id });
  for (const i of await all(`${P}/work-items/?expand=assignees,labels`)) {
    t.tareas.push({ ...i, project: p.id, ref: `${p.identifier}-${i.sequence_id}` });
    for (const a of i.assignees) t.responsables.push({ tarea_id: i.id, miembro_id: a.id });
    for (const l of i.labels) t.tareaEtiquetas.push({ tarea_id: i.id, etiqueta_id: l.id });
  }
  const ciclos = [...await all(`${P}/cycles/?cycle_view=all`), ...await all(`${P}/archived-cycles/`)];
  for (const c of ciclos) {
    t.ciclos.push({ ...c, project: p.id });
    for (const i of await all(`${P}/cycles/${c.id}/cycle-issues/`)) t.cicloTareas.push({ ciclo_id: c.id, tarea_id: i.id });
  }
  const modulos = [...await all(`${P}/modules/`), ...await all(`${P}/archived-modules/`)];
  for (const m of modulos) {
    t.modulos.push({ ...m, project: p.id });
    for (const i of await all(`${P}/modules/${m.id}/module-issues/`)) t.moduloTareas.push({ modulo_id: m.id, tarea_id: i.id });
  }
}

save('miembros', await all(`${W}/members/`), ['id', 'display_name', 'first_name', 'last_name', 'email', 'role']);
save('proyectos', proyectos, ['id', 'identifier', 'name', 'project_lead', 'created_at', 'archived_at']);
save('estados', t.estados, ['id', 'project', 'name', 'group', 'color']);
save('etiquetas', t.etiquetas, ['id', 'project', 'name', 'parent', 'color']);
save('tareas', t.tareas, ['id', 'project', 'ref', 'name', 'state', 'priority', 'start_date', 'target_date',
  'completed_at', 'created_at', 'created_by', 'parent', 'archived_at']);
save('tarea_responsables', t.responsables, ['tarea_id', 'miembro_id']);
save('tarea_etiquetas', t.tareaEtiquetas, ['tarea_id', 'etiqueta_id']);
save('ciclos', t.ciclos, ['id', 'project', 'name', 'start_date', 'end_date', 'archived_at']);
save('ciclo_tareas', t.cicloTareas, ['ciclo_id', 'tarea_id']);
save('modulos', t.modulos, ['id', 'project', 'name', 'status', 'start_date', 'target_date', 'lead', 'archived_at']);
save('modulo_tareas', t.moduloTareas, ['modulo_id', 'tarea_id']);

// Módulo de tiempo: horas por año (la API da como mucho un año por llamada)
const me = await must('GET', new URL('/time/api/me', BASE).href);
const admin = me.workspaces.find((w) => w.slug === WS)?.role >= 20;
const desde = Number(process.argv[2]) || new Date().getFullYear();
const horas = [];
for (let y = desde; y <= new Date().getFullYear(); y++) {
  horas.push(...await must('GET', `${TIME}entries?from=${y}-01-01&to=${y}-12-31${admin ? '&user=all' : ''}`));
}
save('horas', horas, ['id', 'day', 'minutes', 'source', 'note', 'user_id', 'issue_id']);
save('estimaciones', await must('GET', `${TIME}estimates`), ['issue_id', 'minutes']);
save('capacidad', (await must('GET', `${TIME}capacity`)).map((c) => ({ ...c, workdays: c.workdays.join(' ') })),
  ['id', 'minutes_per_day', 'workdays']);
if (!admin) console.log('Aviso: el token no es de un administrador del espacio; horas.csv solo trae las suyas.');
