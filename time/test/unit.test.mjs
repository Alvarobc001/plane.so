import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDuration, formatClock } from '../public/js/duration.js';
import { workload, weekStart, range, isoWeekday } from '../src/workload.mjs';

test('parseDuration entiende las formas habituales', () => {
  for (const [input, out] of [
    ['1:30', 90], ['0:05', 5], ['1h 30m', 90], ['1h30m', 90], ['2h', 120], ['45m', 45], ['45 min', 45],
    ['1,5', 90], ['1.5', 90], ['8', 480], ['90', 90], ['1,5h', 90], [' 1H ', 60],
  ]) assert.equal(parseDuration(input), out, input);
  for (const bad of ['', 'abc', '0', '0:00', '25:00', '1:75', '-1', '2000', 'h', 'm']) assert.equal(parseDuration(bad), null, bad);
});

test('formatDuration y formatClock', () => {
  assert.equal(formatDuration(95), '1 h 35 m');
  assert.equal(formatDuration(60), '1 h');
  assert.equal(formatDuration(0), '0 m');
  assert.equal(formatDuration(-97), '-1 h 37 m');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-4), '0:00:00');
});

test('fechas: semana de lunes a domingo', () => {
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // domingo -> lunes anterior
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(isoWeekday('2026-11-16'), 1);
  assert.equal(range('2026-11-16', '2026-11-22').length, 7);
});

const week = range('2026-11-16', '2026-11-22');
const ana = { id: 'ana', minutesPerDay: 480, workdays: [1, 2, 3, 4, 5] };
const leo = { id: 'leo', minutesPerDay: 360, workdays: [1, 2, 3, 4] };

test('reparte la estimación entre los días laborables, no los de fin de semana', () => {
  // 10 h del jueves al lunes siguiente: jueves, viernes y lunes -> 200 m por día
  const { rows } = workload({ people: [ana], days: week, tasks: [
    { id: 't', minutes: 600, assignees: ['ana'], start: '2026-11-19', due: '2026-11-23' },
  ] });
  assert.equal(rows.ana.days['2026-11-19'].planned, 200);
  assert.equal(rows.ana.days['2026-11-20'].planned, 200);
  assert.equal(rows.ana.days['2026-11-21'].planned, 0);
  assert.equal(rows.ana.planned, 400); // el lunes siguiente queda fuera de la semana
  assert.equal(rows.ana.capacity, 5 * 480);
  assert.equal(rows.ana.days['2026-11-22'].capacity, 0);
});

test('divide entre responsables y respeta la capacidad de cada uno', () => {
  const { rows } = workload({ people: [ana, leo], days: week, tasks: [
    { id: 't', minutes: 480, assignees: ['ana', 'leo'], start: '2026-11-20', due: '2026-11-20' },
  ] });
  assert.equal(rows.ana.days['2026-11-20'].planned, 240);
  // Leo no trabaja el viernes: su parte cae en el día de entrega
  assert.equal(rows.leo.days['2026-11-20'].planned, 240);
  assert.equal(rows.leo.days['2026-11-20'].capacity, 0);
});

test('solo fecha de fin o de inicio: todo ese día; sin fechas o sin estimación: se cuentan aparte', () => {
  const r = workload({ people: [ana], days: week, tasks: [
    { id: 'a', minutes: 60, assignees: ['ana'], start: null, due: '2026-11-17' },
    { id: 'b', minutes: 30, assignees: ['ana'], start: '2026-11-18', due: null },
    { id: 'c', minutes: 60, assignees: ['ana'], start: null, due: null },
    { id: 'd', minutes: null, assignees: ['ana'], start: '2026-11-18', due: '2026-11-19' },
    { id: 'e', minutes: 60, assignees: ['otro'], start: '2026-11-18', due: '2026-11-18' },
  ] });
  assert.equal(r.rows.ana.days['2026-11-17'].planned, 60);
  assert.equal(r.rows.ana.days['2026-11-18'].planned, 30);
  assert.equal(r.unscheduled, 1);
  assert.equal(r.unestimated, 1);
  assert.equal(r.rows.ana.planned, 90);
});

test('parseDuration admite un máximo mayor para estimaciones', () => {
  assert.equal(parseDuration('40h', 100000), 2400);
  assert.equal(parseDuration('40h'), null);
  assert.equal(parseDuration('100:00', 100000), 6000);
});
