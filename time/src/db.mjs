// Conexión a la base de Plane. El módulo lee las tablas de Plane (tareas, miembros, proyectos)
// y escribe solo en su propio esquema, time_tracking, que Plane no toca.
import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v); // date -> 'AAAA-MM-DD' sin pasar por zonas horarias

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export const q = async (sql, params) => (await pool.query(sql, params)).rows;
export const one = async (sql, params) => (await q(sql, params))[0] ?? null;

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn((sql, params) => c.query(sql, params).then((r) => r.rows));
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const SCHEMA = `
create schema if not exists time_tracking;

create table if not exists time_tracking.entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  issue_id uuid not null,
  user_id uuid not null,
  day date not null,                       -- día al que cuenta, en la zona de quien registra
  started_at timestamptz,                  -- solo las del reloj
  minutes integer check (minutes between 1 and 1440), -- null mientras el reloj corre
  note text not null default '' check (length(note) <= 500),
  source text not null check (source in ('timer', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source = 'manual' or started_at is not null),
  check (source = 'timer' or minutes is not null)
);
-- Un solo reloj en marcha por persona
create unique index if not exists entries_one_running on time_tracking.entries (user_id) where minutes is null;
create index if not exists entries_workspace_day on time_tracking.entries (workspace_id, day);
create index if not exists entries_issue on time_tracking.entries (issue_id);

create table if not exists time_tracking.estimates (
  issue_id uuid primary key,
  workspace_id uuid not null,
  minutes integer not null check (minutes between 1 and 100000),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);

create table if not exists time_tracking.capacity (
  workspace_id uuid not null,
  user_id uuid not null,
  minutes_per_day integer not null check (minutes_per_day between 0 and 1440),
  workdays smallint[] not null,
  primary key (workspace_id, user_id)
);
`;

// Crea el esquema al arrancar; reintenta mientras Postgres aún no acepta conexiones.
export async function migrate() {
  for (let i = 1; ; i++) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (e) {
      if (i >= 30) throw e;
      console.error(`Base de datos no disponible (${e.code ?? e.message}); reintento ${i}/30`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
