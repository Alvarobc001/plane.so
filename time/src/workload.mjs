// Carga de trabajo, igual que la de ClickUp: la estimación de cada tarea se reparte a partes
// iguales entre sus responsables y, para cada uno, entre sus días laborables desde la fecha de
// inicio hasta la de fin. Fechas como texto AAAA-MM-DD; los cálculos van en UTC.

const DAY = 86_400_000;
const toTime = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const toDate = (t) => new Date(t).toISOString().slice(0, 10);
export const isoWeekday = (d) => new Date(toTime(d)).getUTCDay() || 7; // 1 = lunes … 7 = domingo

export function addDays(d, n) {
  return toDate(toTime(d) + n * DAY);
}

// Lunes de la semana de la fecha dada
export function weekStart(d) {
  return addDays(d, 1 - isoWeekday(d));
}

export function range(from, to) {
  const out = [];
  for (let t = toTime(from), end = toTime(to); t <= end && out.length < 3700; t += DAY) out.push(toDate(t));
  return out;
}

/**
 * @param tasks  [{ id, minutes, assignees: [userId], start, due }]  (start/due pueden ser null)
 * @param people [{ id, minutesPerDay, workdays: [1..7] }]
 * @param days   días visibles, en orden
 * @returns { rows: { [userId]: { days: { [day]: { planned, capacity, tasks: [{ id, minutes }] } }, planned, capacity } },
 *            unscheduled, unestimated }
 */
export function workload({ tasks, people, days }) {
  const rows = {};
  for (const p of people) {
    const work = new Set(p.workdays);
    const ds = {};
    for (const d of days) ds[d] = { planned: 0, capacity: work.has(isoWeekday(d)) ? p.minutesPerDay : 0, tasks: [] };
    rows[p.id] = { days: ds, planned: 0, capacity: days.reduce((s, d) => s + ds[d].capacity, 0), work };
  }
  let unscheduled = 0;
  let unestimated = 0;
  const visible = new Set(days);

  for (const t of tasks) {
    const who = t.assignees.filter((a) => rows[a]);
    if (!who.length) continue;
    if (!t.start && !t.due) { unscheduled++; continue; }
    if (!t.minutes) { unestimated++; continue; }
    let start = t.start ?? t.due;
    let end = t.due ?? t.start;
    if (start > end) [start, end] = [end, start];
    const share = t.minutes / t.assignees.length; // también cuenta la parte de quien no está a la vista
    for (const a of who) {
      const row = rows[a];
      const span = range(start, end);
      let worked = span.filter((d) => row.work.has(isoWeekday(d)));
      if (!worked.length) worked = [end]; // todo en fin de semana: cae en el día de entrega
      const perDay = share / worked.length;
      for (const d of worked) {
        if (!visible.has(d)) continue;
        row.days[d].planned += perDay;
        row.days[d].tasks.push({ id: t.id, minutes: perDay });
        row.planned += perDay;
      }
    }
  }
  for (const r of Object.values(rows)) delete r.work;
  return { rows, unscheduled, unestimated };
}
