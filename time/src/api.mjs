// API del módulo de tiempo. Cada función recibe el contexto ya autenticado:
// { user, ws: { workspace_id, slug, name, role }, admin, query, body }.
// Reglas de acceso (las mismas en todas las rutas):
//  - solo se ven tareas de proyectos de los que la persona es miembro activo;
//  - las horas registradas son datos personales: cada cual ve las suyas y los
//    administradores del espacio (rol 20) las de todos;
//  - registrar horas o estimar exige ser miembro del proyecto (rol 15 o más), no invitado;
//  - cada entrada solo la edita o borra quien la registró.
import { q, one, tx } from './db.mjs';
import { workload, weekStart, addDays, range } from './workload.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuid = (v, what) => { if (!UUID.test(String(v))) throw bad(`${what} no válido`); return v; };
function date(v, what) {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${what}: fecha no válida (AAAA-MM-DD)`);
  return s;
}
function minutes(v, max = 1440) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw bad(`La duración debe estar entre 1 minuto y ${max / 60} horas`);
  return n;
}
function note(v) {
  const s = String(v ?? '').trim();
  if (s.length > 500) throw bad('La nota no puede pasar de 500 caracteres');
  return s;
}
const today = () => new Date().toISOString().slice(0, 10);

// Proyectos que la persona puede ver ($1 usuario, $2 espacio)
const VISIBLE = `
  select pm.project_id from project_members pm
    join projects p on p.id = pm.project_id
   where pm.member_id = $1 and pm.workspace_id = $2 and pm.is_active and pm.deleted_at is null
     and p.deleted_at is null and p.archived_at is null`;

// Tareas vivas: sin borrar, sin archivar, no borradores y fuera de un intake sin aceptar
const LIVE = `
  i.deleted_at is null and i.archived_at is null and not i.is_draft
  and not exists (select 1 from intake_issues ii where ii.issue_id = i.id and ii.status <> 1 and ii.deleted_at is null)`;

const NAME = `coalesce(nullif(trim(u.first_name || ' ' || u.last_name), ''), u.display_name)`;

// La tarea, si la persona puede registrar en ella (miembro del proyecto con rol >= 15)
async function writableIssue(ctx, issueId) {
  const row = await one(
    `select i.id, i.project_id, pm.role
       from issues i
       join project_members pm on pm.project_id = i.project_id and pm.member_id = $1
            and pm.is_active and pm.deleted_at is null
       join projects p on p.id = i.project_id and p.deleted_at is null and p.archived_at is null
      where i.id = $3 and i.workspace_id = $2 and ${LIVE}`,
    [ctx.user.id, ctx.ws.workspace_id, uuid(issueId, 'Tarea')],
  );
  if (!row) throw new HttpError(404, 'Tarea no encontrada');
  if (row.role < 15) throw new HttpError(403, 'Los invitados del proyecto no pueden registrar horas');
  return row;
}

// El día lo pone el navegador (zona de la persona); se acepta con un día de margen sobre UTC
function clientDay(v) {
  const d = date(v ?? today(), 'Día');
  const t = today();
  if (d < addDays(t, -1) || d > addDays(t, 1)) throw bad('El día del reloj no coincide con la fecha actual');
  return d;
}

const ELAPSED = `greatest(1, least(1440, ceil(extract(epoch from now() - started_at) / 60)))::int`;

const TIMER_SQL = `
  select e.id, e.issue_id, e.day, e.started_at, now() as server_now, w.slug,
         p.identifier || '-' || i.sequence_id as ref, i.name
    from time_tracking.entries e
    join issues i on i.id = e.issue_id
    join projects p on p.id = e.project_id
    join workspaces w on w.id = e.workspace_id
   where e.user_id = $1 and e.minutes is null`;

export const routes = {
  // ---------- Reloj ----------
  'GET timer': async (ctx) => one(TIMER_SQL, [ctx.user.id]),

  'POST timer/start': async (ctx) => {
    const issue = await writableIssue(ctx, ctx.body.issue_id);
    const day = clientDay(ctx.body.day);
    await tx(async (run) => {
      // Empezar otra tarea para la que esté en marcha, como en ClickUp
      await run(`update time_tracking.entries set minutes = ${ELAPSED}, updated_at = now()
                  where user_id = $1 and minutes is null`, [ctx.user.id]);
      await run(`insert into time_tracking.entries (workspace_id, project_id, issue_id, user_id, day, started_at, source)
                 values ($1, $2, $3, $4, $5, now(), 'timer')`,
      [ctx.ws.workspace_id, issue.project_id, issue.id, ctx.user.id, day]);
    }).catch((e) => {
      // Dos arranques a la vez (doble clic): el índice único deja solo uno
      if (e.code === '23505') throw new HttpError(409, 'Ya hay un reloj en marcha');
      throw e;
    });
    return one(TIMER_SQL, [ctx.user.id]);
  },

  'POST timer/stop': async (ctx) => {
    const e = await one(
      `update time_tracking.entries set minutes = ${ELAPSED}, note = $2, updated_at = now()
        where user_id = $1 and minutes is null returning id, minutes, day, issue_id`,
      [ctx.user.id, note(ctx.body.note)],
    );
    if (!e) throw new HttpError(409, 'No hay ningún reloj en marcha');
    return e;
  },

  'DELETE timer': async (ctx) => {
    await q('delete from time_tracking.entries where user_id = $1 and minutes is null', [ctx.user.id]);
    return null;
  },

  'GET projects': async (ctx) => q(
    `select p.id, p.name, p.identifier from projects p where p.id in (${VISIBLE}) order by p.name`,
    [ctx.user.id, ctx.ws.workspace_id],
  ),

  // ---------- Tareas ----------
  'GET tasks': async (ctx) => {
    const { scope = 'mine', q: search = '', project } = ctx.query;
    const params = [ctx.user.id, ctx.ws.workspace_id];
    let where = '';
    if (scope === 'mine') where += ' and exists (select 1 from issue_assignees a where a.issue_id = i.id and a.assignee_id = $1 and a.deleted_at is null)';
    if (project) { params.push(uuid(project, 'Proyecto')); where += ` and i.project_id = $${params.length}`; }
    if (search.trim()) {
      params.push(`%${search.trim().slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
      where += ` and (i.name ilike $${params.length} or (p.identifier || '-' || i.sequence_id) ilike $${params.length})`;
    }
    params.push(ctx.admin);
    return q(
      `select i.id, p.identifier || '-' || i.sequence_id as ref, i.name, i.priority,
              i.start_date as start, i.target_date as due,
              p.id as project_id, p.name as project, s.name as state, s."group" as state_group, s.color as state_color,
              coalesce((select array_agg(${NAME} order by ${NAME}) from issue_assignees a join users u on u.id = a.assignee_id
                         where a.issue_id = i.id and a.deleted_at is null), '{}') as assignees,
              est.minutes as estimate,
              coalesce((select sum(minutes) from time_tracking.entries e where e.issue_id = i.id and e.user_id = $1), 0)::int as mine,
              case when $${params.length} then coalesce((select sum(minutes) from time_tracking.entries e where e.issue_id = i.id), 0)::int end as team
         from issues i
         join projects p on p.id = i.project_id
         join states s on s.id = i.state_id
         left join time_tracking.estimates est on est.issue_id = i.id
        where i.project_id in (${VISIBLE}) and ${LIVE} and s."group" not in ('completed', 'cancelled') ${where}
        order by i.target_date nulls last, p.identifier, i.sequence_id
        limit 200`,
      params,
    );
  },

  // Tiempo de una tarea por su código (RES-16): lo que muestran los campos dentro de la tarea de Plane
  'GET tasks/by-ref/:ref': async (ctx) => {
    const m = /^([A-Za-z0-9]{1,12})-(\d{1,9})$/.exec(ctx.params.ref);
    if (!m) throw bad('Código de tarea no válido');
    const t = await one(
      `select i.id, p.identifier || '-' || i.sequence_id as ref, i.name, est.minutes as estimate, pm.role,
              (p.archived_at is null and ${LIVE}) as live,
              coalesce((select sum(minutes) from time_tracking.entries e where e.issue_id = i.id and e.user_id = $1), 0)::int as mine,
              case when $5 then coalesce((select sum(minutes) from time_tracking.entries e where e.issue_id = i.id), 0)::int end as team
         from issues i
         join projects p on p.id = i.project_id and p.deleted_at is null
         join project_members pm on pm.project_id = p.id and pm.member_id = $1 and pm.is_active and pm.deleted_at is null
         left join time_tracking.estimates est on est.issue_id = i.id
        where i.workspace_id = $2 and p.identifier = upper($3) and i.sequence_id = $4 and i.deleted_at is null`,
      [ctx.user.id, ctx.ws.workspace_id, m[1], Number(m[2]), ctx.admin],
    );
    if (!t) throw new HttpError(404, 'Tarea no encontrada');
    // Las entradas: las propias; los administradores, las de todos
    const entries = await q(
      `select e.id, e.day, e.minutes, e.note, e.source, e.user_id, ${NAME} as person
         from time_tracking.entries e join users u on u.id = e.user_id
        where e.issue_id = $1 and e.minutes is not null ${ctx.admin ? '' : 'and e.user_id = $2'}
        order by e.day desc, e.created_at desc limit 50`,
      ctx.admin ? [t.id] : [t.id, ctx.user.id],
    );
    const { role, live, ...task } = t;
    return { ...task, can_log: live && role >= 15, entries }; // lo mismo que exige writableIssue
  },

  'PUT tasks/:id/estimate': async (ctx) => {
    const issue = await writableIssue(ctx, ctx.params.id);
    if (ctx.body.minutes === null) {
      await q('delete from time_tracking.estimates where issue_id = $1', [issue.id]);
      return { minutes: null };
    }
    const m = minutes(ctx.body.minutes, 100000);
    await q(
      `insert into time_tracking.estimates (issue_id, workspace_id, minutes, updated_by) values ($1, $2, $3, $4)
       on conflict (issue_id) do update set minutes = excluded.minutes, updated_by = excluded.updated_by, updated_at = now()`,
      [issue.id, ctx.ws.workspace_id, m, ctx.user.id],
    );
    return { minutes: m };
  },

  // ---------- Entradas de tiempo ----------
  'GET entries': async (ctx) => {
    const from = date(ctx.query.from, 'Desde');
    const to = date(ctx.query.to ?? from, 'Hasta');
    if (range(from, to).length > 93) throw bad('El periodo no puede pasar de tres meses');
    const who = whoFilter(ctx, ctx.query.user);
    return q(
      `select e.id, e.day, e.minutes, e.note, e.source, e.started_at, e.user_id, ${NAME} as person,
              e.issue_id, p.identifier || '-' || i.sequence_id as ref, i.name, p.name as project
         from time_tracking.entries e
         join issues i on i.id = e.issue_id
         join projects p on p.id = e.project_id
         join users u on u.id = e.user_id
        where e.workspace_id = $1 and e.day between $2 and $3 and e.minutes is not null ${who.sql}
        order by e.day, e.created_at`,
      [ctx.ws.workspace_id, from, to, ...who.params],
    );
  },

  'POST entries': async (ctx) => {
    const issue = await writableIssue(ctx, ctx.body.issue_id);
    const day = date(ctx.body.day, 'Día');
    if (day > addDays(today(), 1)) throw bad('No se pueden registrar horas en días futuros');
    return one(
      `insert into time_tracking.entries (workspace_id, project_id, issue_id, user_id, day, minutes, note, source)
       values ($1, $2, $3, $4, $5, $6, $7, 'manual') returning id, day, minutes, note`,
      [ctx.ws.workspace_id, issue.project_id, issue.id, ctx.user.id, day, minutes(ctx.body.minutes), note(ctx.body.note)],
    );
  },

  'PATCH entries/:id': async (ctx) => {
    const e = await ownEntry(ctx);
    const day = ctx.body.day === undefined ? e.day : date(ctx.body.day, 'Día');
    if (day > addDays(today(), 1)) throw bad('No se pueden registrar horas en días futuros');
    return one(
      `update time_tracking.entries set day = $2, minutes = $3, note = $4, updated_at = now()
        where id = $1 returning id, day, minutes, note`,
      [e.id, day, ctx.body.minutes === undefined ? e.minutes : minutes(ctx.body.minutes),
        ctx.body.note === undefined ? e.note : note(ctx.body.note)],
    );
  },

  'DELETE entries/:id': async (ctx) => {
    const e = await ownEntry(ctx);
    await q('delete from time_tracking.entries where id = $1', [e.id]);
    return null;
  },

  // ---------- Carga de trabajo ----------
  'GET workload': async (ctx) => {
    const from = weekStart(date(ctx.query.from ?? today(), 'Semana'));
    const days = range(from, addDays(from, 6));
    const params = [ctx.user.id, ctx.ws.workspace_id];
    if (ctx.query.project) params.push(uuid(ctx.query.project, 'Proyecto'));
    const scope = `select project_id from (${VISIBLE}) v ${ctx.query.project ? 'where v.project_id = $3' : ''}`;

    const people = await q(
      `select u.id, ${NAME} as name, coalesce(c.minutes_per_day, 480) as minutes_per_day,
              coalesce(c.workdays, '{1,2,3,4,5}') as workdays
         from users u
         join workspace_members wm on wm.member_id = u.id and wm.workspace_id = $2 and wm.is_active and wm.deleted_at is null
         left join time_tracking.capacity c on c.workspace_id = $2 and c.user_id = u.id
        where not u.is_bot and exists (
              select 1 from project_members pm where pm.member_id = u.id and pm.is_active and pm.deleted_at is null
                 and pm.project_id in (${scope}))
        order by name`,
      params,
    );
    params.push(days[0], days[6]);
    const tasks = await q(
      `select i.id, p.identifier || '-' || i.sequence_id as ref, i.name, p.name as project,
              i.start_date as start, i.target_date as due, est.minutes,
              coalesce(array_agg(a.assignee_id) filter (where a.assignee_id is not null), '{}') as assignees
         from issues i
         join projects p on p.id = i.project_id
         join states s on s.id = i.state_id
         left join time_tracking.estimates est on est.issue_id = i.id
         left join issue_assignees a on a.issue_id = i.id and a.deleted_at is null
        where i.project_id in (${scope}) and ${LIVE} and s."group" not in ('completed', 'cancelled')
          and ((i.start_date is null and i.target_date is null)
               or (coalesce(i.start_date, i.target_date) <= $${params.length} and coalesce(i.target_date, i.start_date) >= $${params.length - 1}))
        group by i.id, p.identifier, p.name, est.minutes`,
      params,
    );
    const w = workload({
      days,
      people: people.map((p) => ({ id: p.id, minutesPerDay: p.minutes_per_day, workdays: p.workdays })),
      tasks: tasks.map((t) => ({ ...t, assignees: t.assignees })),
    });

    // Horas registradas: las propias siempre; las de los demás, solo para administradores
    const logged = await q(
      `select user_id, day, sum(minutes)::int as minutes from time_tracking.entries
        where workspace_id = $1 and day between $2 and $3 and minutes is not null
          ${ctx.admin ? '' : 'and user_id = $4'}
        group by user_id, day`,
      ctx.admin ? [ctx.ws.workspace_id, days[0], days[6]] : [ctx.ws.workspace_id, days[0], days[6], ctx.user.id],
    );
    const loggedBy = {};
    for (const l of logged) (loggedBy[l.user_id] ??= {})[l.day] = l.minutes;

    const taskInfo = Object.fromEntries(tasks.map((t) => [t.id, { ref: t.ref, name: t.name, project: t.project, start: t.start, due: t.due, minutes: t.minutes }]));
    return {
      days,
      today: today(),
      people: people.map((p) => ({
        id: p.id, name: p.name, minutesPerDay: p.minutes_per_day, workdays: p.workdays, ...w.rows[p.id],
        logged: ctx.admin || p.id === ctx.user.id ? (loggedBy[p.id] ?? {}) : null,
      })),
      tasks: taskInfo,
      unscheduled: w.unscheduled,
      unestimated: w.unestimated,
    };
  },

  // ---------- Informes ----------
  'GET report': async (ctx) => {
    const from = date(ctx.query.from, 'Desde');
    const to = date(ctx.query.to ?? from, 'Hasta');
    if (from > to) throw bad('La fecha de inicio va después de la de fin');
    if (range(from, to).length > 370) throw bad('El periodo no puede pasar de un año');
    const group = ctx.query.group ?? 'person';
    const KEYS = {
      person: [`e.user_id::text`, NAME],
      project: [`p.id::text`, `p.name`],
      task: [`i.id::text`, `p.identifier || '-' || i.sequence_id || ' · ' || i.name`],
      cycle: [`coalesce(c.id::text, '')`, `coalesce(c.name, 'Sin ciclo')`],
      module: [`coalesce(m.id::text, '')`, `coalesce(m.name, 'Sin módulo')`],
      day: [`e.day::text`, `e.day::text`],
    };
    if (!KEYS[group]) throw bad('Agrupación no válida');
    const who = whoFilter(ctx, ctx.query.user, 4);
    // Una tarea puede estar en varios ciclos o módulos: esos cruces solo se hacen al agrupar por ellos
    // (y entonces la tarea cuenta en cada uno); el total se suma aparte, una vez por entrada.
    const JOINS = {
      cycle: `left join cycle_issues ci on ci.issue_id = i.id and ci.deleted_at is null
              left join cycles c on c.id = ci.cycle_id and c.deleted_at is null`,
      module: `left join module_issues mi on mi.issue_id = i.id and mi.deleted_at is null
               left join modules m on m.id = mi.module_id and m.deleted_at is null`,
    };
    const from_ = (joins = '') => `
      from time_tracking.entries e
      join issues i on i.id = e.issue_id
      join projects p on p.id = e.project_id
      join users u on u.id = e.user_id
      ${joins}
     where e.workspace_id = $1 and e.day between $2 and $3 and e.minutes is not null ${who.sql}`;
    const params = [ctx.ws.workspace_id, from, to, ...who.params];

    if (ctx.query.format === 'csv') {
      const rows = await q(
        `select e.day, ${NAME} as person, p.name as project, p.identifier || '-' || i.sequence_id as ref, i.name as task,
                (select string_agg(c.name, ', ' order by c.name) from cycle_issues ci join cycles c on c.id = ci.cycle_id
                  where ci.issue_id = i.id and ci.deleted_at is null and c.deleted_at is null) as cycle,
                e.minutes, e.source, e.note ${from_()} order by e.day, person`, params);
      return { csv: toCsv(rows) };
    }
    const rows = await q(
      `select ${KEYS[group][0]} as key, ${KEYS[group][1]} as label, sum(e.minutes)::int as minutes, count(*)::int as entries
       ${from_(JOINS[group])} group by 1, 2 order by minutes desc`, params);
    const sum = await one(`select coalesce(sum(e.minutes), 0)::int as total, count(*)::int as entries ${from_()}`, params);
    return { group, from, to, rows, total: sum.total, entries: sum.entries, people: ctx.admin ? 'all' : 'me' };
  },

  // ---------- Capacidad ----------
  'GET capacity': async (ctx) => q(
    `select u.id, ${NAME} as name, coalesce(c.minutes_per_day, 480) as minutes_per_day,
            coalesce(c.workdays, '{1,2,3,4,5}') as workdays
       from workspace_members wm join users u on u.id = wm.member_id
       left join time_tracking.capacity c on c.workspace_id = wm.workspace_id and c.user_id = u.id
      where wm.workspace_id = $1 and wm.is_active and wm.deleted_at is null and not u.is_bot
      order by name`,
    [ctx.ws.workspace_id],
  ),

  'PUT capacity/:id': async (ctx) => {
    if (!ctx.admin) throw new HttpError(403, 'Solo los administradores del espacio cambian la capacidad');
    const userId = uuid(ctx.params.id, 'Persona');
    const member = await one(
      'select 1 from workspace_members where workspace_id = $1 and member_id = $2 and is_active and deleted_at is null',
      [ctx.ws.workspace_id, userId]);
    if (!member) throw new HttpError(404, 'Esa persona no es miembro del espacio');
    const perDay = Number(ctx.body.minutes_per_day);
    if (!Number.isInteger(perDay) || perDay < 0 || perDay > 1440) throw bad('Capacidad diaria no válida');
    const days = ctx.body.workdays;
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(days).size !== days.length) {
      throw bad('Días laborables no válidos');
    }
    await q(
      `insert into time_tracking.capacity (workspace_id, user_id, minutes_per_day, workdays) values ($1, $2, $3, $4)
       on conflict (workspace_id, user_id) do update set minutes_per_day = excluded.minutes_per_day, workdays = excluded.workdays`,
      [ctx.ws.workspace_id, userId, perDay, [...days].sort()],
    );
    return { id: userId, minutes_per_day: perDay, workdays: [...days].sort() };
  },
};

// Filtro de persona: por defecto, uno mismo; otra persona o "all" solo para administradores
function whoFilter(ctx, user, n = 4) {
  if (!user || user === 'me' || user === ctx.user.id) return { sql: `and e.user_id = $${n}`, params: [ctx.user.id] };
  if (!ctx.admin) throw new HttpError(403, 'Solo los administradores del espacio ven las horas de otras personas');
  if (user === 'all') return { sql: '', params: [] };
  return { sql: `and e.user_id = $${n}`, params: [uuid(user, 'Persona')] };
}

async function ownEntry(ctx) {
  const e = await one(
    `select id, day, minutes, note from time_tracking.entries
      where id = $1 and workspace_id = $2 and user_id = $3`,
    [uuid(ctx.params.id, 'Entrada'), ctx.ws.workspace_id, ctx.user.id],
  );
  // 404 también si es de otra persona: no se revela que existe
  if (!e) throw new HttpError(404, 'Entrada no encontrada');
  if (e.minutes === null) throw new HttpError(409, 'Para el reloj antes de editar esta entrada');
  return e;
}

// CSV para Excel en español (; como separador). Las celdas que empiezan por = + - @ se
// neutralizan para que una hoja de cálculo no las ejecute como fórmulas.
function toCsv(rows) {
  const head = ['Día', 'Persona', 'Proyecto', 'Tarea', 'Nombre', 'Ciclo', 'Minutos', 'Horas', 'Origen', 'Nota'];
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => [r.day, r.person, r.project, r.ref, r.task, r.cycle, r.minutes,
    (r.minutes / 60).toFixed(2).replace('.', ','), r.source === 'timer' ? 'Reloj' : 'Manual', r.note].map(cell).join(';'));
  return `﻿${[head.join(';'), ...lines].join('\r\n')}\r\n`;
}
