// Datos de ejemplo del módulo de tiempo para el espacio de la demo: estimaciones de cada tarea
// e historial de horas registradas (días laborables ya pasados). Escribe SQL por la salida estándar:
//   node scripts/seed-time.mjs | docker exec -i plane-app-plane-db-1 psql -h /var/run/postgresql -U plane plane
// Borra antes el tiempo registrado del espacio, así que se puede repetir.
import { PEOPLE, TASKS, MKT_TASKS, day } from './demo-data.mjs';

const WS = process.env.PLANE_WORKSPACE || 'acme';
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const NOTES = ['', '', 'Revisión con el equipo', 'Ajustes tras la revisión', 'Pruebas en local', '', 'Reunión de seguimiento'];

// [proyecto, nombre, persona, estado, inicio, fin, horas]
const all = [
  ...TASKS.map((t) => ['RES', t[1], t[4], t[5], t[9], t[10], t[11]]),
  ...MKT_TASKS.map((t) => ['MKT', t[1], t[2], t[3], t[5], t[6], t[7]]),
];

// Desviación estable por tarea (0,8 … 1,3): unas acaban por debajo de lo estimado y otras por encima
const factor = (name) => 0.8 + ([...name].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 997, 7) % 11) / 20;
const weekday = (d) => new Date(`${d}T12:00:00`).getDay() % 6 !== 0;
const today = day(0);

const issue = (project, name) => `(select i.id from issues i join projects p on p.id = i.project_id join workspaces w on w.id = p.workspace_id
  where w.slug = ${lit(WS)} and p.identifier = '${project}' and i.name = ${lit(name)} and i.deleted_at is null limit 1)`;
const user = (person) => `(select id from users where email = ${lit(PEOPLE[person])})`;

const out = ['begin;',
  `delete from time_tracking.entries where workspace_id = (select id from workspaces where slug = ${lit(WS)});`,
  `delete from time_tracking.estimates where workspace_id = (select id from workspaces where slug = ${lit(WS)});`];

let n = 0;
for (const [project, name, person, status, start, end, hours] of all) {
  out.push(`insert into time_tracking.estimates (issue_id, workspace_id, minutes, updated_by)
  select i.id, i.workspace_id, ${hours * 60}, ${user(person)} from issues i where i.id = ${issue(project, name)};`);
  if (start === null || status === 'cancelled' || status === 'backlog') continue;
  const days = [];
  for (let o = start; o <= end; o++) if (weekday(day(o))) days.push(day(o));
  const past = days.filter((d) => d < today);
  if (!past.length) continue;
  // Las terminadas reparten todo lo trabajado entre sus días; las abiertas, la parte que les toca hasta hoy
  const per = (hours * 60 * factor(name)) / days.length;
  past.forEach((d, k) => {
    const minutes = Math.max(15, Math.round(per / 15) * 15);
    out.push(`insert into time_tracking.entries (workspace_id, project_id, issue_id, user_id, day, started_at, minutes, note, source)
  select i.workspace_id, i.project_id, i.id, ${user(person)}, '${d}', '${d} 09:00:00+01', ${minutes}, ${lit(NOTES[(n + k) % NOTES.length])}, '${k % 3 ? 'manual' : 'timer'}'
    from issues i where i.id = ${issue(project, name)};`);
    n++;
  });
}
out.push('commit;');
console.log(out.join('\n'));
console.error(`${all.length} estimaciones y ${n} entradas de tiempo`);
