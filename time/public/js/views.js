// Pantallas del módulo. Cada una recibe { main, params, slug, admin } y devuelve { dispose }.
import { h, icon, api, toast, localDay, shiftDay, mondayOf, dayShort, dayNum, dayLong, weekLabel, shortDate, avatar, planeTaskUrl } from './ui.js';
import { parseDuration, formatDuration } from './duration.js';
import { state, go, taskPicker, startTimer, stopTimer, changed } from './app.js';

const fd = formatDuration;
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Recarga la pantalla cuando cambia el tiempo registrado (reloj parado, entrada nueva…)
function onTimeChange(fn) {
  window.addEventListener('timechange', fn);
  return () => window.removeEventListener('timechange', fn);
}

function weekNav({ monday, onChange }) {
  const today = mondayOf(localDay());
  return h('div', { class: 'tools' },
    h('button', { class: 'btn icon-only', 'aria-label': 'Semana anterior', onclick: () => onChange(shiftDay(monday, -7)) }, icon('back')),
    h('span', { class: 'week-label num' }, weekLabel(monday)),
    h('button', { class: 'btn icon-only', 'aria-label': 'Semana siguiente', onclick: () => onChange(shiftDay(monday, 7)) }, icon('next')),
    h('button', { class: 'btn', disabled: monday === today, onclick: () => onChange(today) }, 'Hoy'));
}

async function projectSelect(slug, value, onChange) {
  const projects = await api(`w/${slug}/projects`);
  return h('select', { class: 'input', 'aria-label': 'Proyecto', onchange: (e) => onChange(e.target.value) },
    h('option', { value: '' }, 'Todos los proyectos'),
    projects.map((p) => h('option', { value: p.id, selected: p.id === value }, p.name)));
}

function errorBox(main, title, e, retry) {
  main.replaceChildren(h('h1', null, title), h('div', { class: 'empty-box', style: { marginTop: '16px' } },
    `No se pudieron cargar los datos: ${e.message}. `, h('button', { class: 'btn', onclick: retry }, 'Reintentar')));
}

// Panel lateral no modal (como el de Plane): recibe el foco, se cierra con Escape y lo devuelve al origen
function drawer(title, subtitle, body) {
  const prev = document.activeElement;
  const close = () => { el.classList.remove('open'); setTimeout(() => el.remove(), 150); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const el = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': title },
    h('header', null,
      h('div', null, h('h2', null, title), subtitle && h('p', { class: 'finding', style: { margin: 0 } }, subtitle)),
      h('button', { class: 'btn ghost icon-only', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
    h('div', { class: 'body' }, body));
  document.querySelectorAll('.drawer').forEach((d) => d.remove());
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  document.addEventListener('keydown', onKey);
  el.querySelector('button').focus();
  return { el, close };
}

// =====================================================================
// Carga de trabajo: personas × días, horas planificadas frente a capacidad
// =====================================================================
function carga({ main, params, slug }) {
  let monday = mondayOf(params.get('semana') || localDay());
  let project = params.get('proyecto') || '';
  let data;

  async function load() {
    main.replaceChildren(h('h1', null, 'Carga de trabajo'), h('p', { class: 'finding' }, h('span', { class: 'skeleton', style: { width: '320px' } })));
    try {
      data = await api(`w/${slug}/workload?from=${monday}${project ? `&project=${project}` : ''}`);
      await render();
    } catch (e) { errorBox(main, 'Carga de trabajo', e, load); }
  }

  // Minutos redondeados por día; los totales salen de los mismos valores que se ven
  const dayMin = (p, d) => Math.round(p.days[d].planned);
  const overDays = (p) => data.days.filter((d) => dayMin(p, d) > p.days[d].capacity);

  function finding() {
    const over = data.people.filter((p) => overDays(p).length);
    if (!over.length) {
      const planned = data.people.reduce((s, p) => s + data.days.reduce((a, d) => a + dayMin(p, d), 0), 0);
      const cap = data.people.reduce((s, p) => s + p.capacity, 0);
      return ['Nadie supera su capacidad esta semana: el equipo tiene planificadas ', h('strong', { class: 'num' }, fd(planned)), ` de ${fd(cap)}.`];
    }
    const parts = over.slice(0, 2).map((p) => {
      const days = overDays(p);
      const extra = days.reduce((s, d) => s + dayMin(p, d) - p.days[d].capacity, 0);
      const names = days.map((d) => dayLong(d).split(',')[0]);
      return [h('strong', null, p.name), ` supera su capacidad el ${names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0]} `, h('span', { class: 'over num' }, `(+${fd(extra)})`)];
    });
    const rest = over.length - parts.length;
    return [parts[0], parts[1] ? ['; ', parts[1]] : '', rest > 0 ? ` y ${rest} persona${rest > 1 ? 's' : ''} más` : '', '.'];
  }

  function cell(p, d) {
    const planned = dayMin(p, d);
    const cap = p.days[d].capacity;
    const logged = p.logged ? p.logged[d] ?? 0 : null;
    const off = cap === 0 && planned === 0;
    const over = planned > cap;
    const pct = cap ? Math.min(planned / cap, 1) : over ? 1 : 0;
    const label = `${p.name}, ${dayLong(d)}: ${off ? 'no trabaja' : `${fd(planned)} planificadas de ${fd(cap)}`}${over ? `, ${fd(planned - cap)} sobre capacidad` : ''}${logged ? `, ${fd(logged)} registradas` : ''}`;
    return h('button', {
      class: `cell${off ? ' off' : ''}${over ? ' over' : ''}${!over && cap && planned >= cap ? ' full' : ''}${d === localDay() ? ' today' : ''}`,
      'aria-label': label, disabled: off && !logged ? true : null,
      onclick: () => detail(p, d),
    },
    off ? h('span', { class: 'planned' }, logged ? '' : '—')
      : h('span', { class: `planned num${planned ? '' : ' zero'}` }, fd(planned), h('span', { class: 'muted', style: { fontWeight: 400 } }, ` / ${fd(cap)}`)),
    over ? h('span', { class: 'over-label num' }, `+${fd(planned - cap)}`) : null,
    off ? null : h('span', { class: 'bar', 'aria-hidden': 'true' }, pct ? h('i', { style: { height: `${pct * 100}%` } }) : null),
    logged ? h('span', { class: 'logged num' }, `Registradas ${fd(logged)}`) : null);
  }

  function detail(p, d) {
    const items = p.days[d].tasks.map((t) => ({ ...data.tasks[t.id], id: t.id, today: Math.round(t.minutes) })).sort((a, b) => b.today - a.today);
    const planned = dayMin(p, d);
    const cap = p.days[d].capacity;
    drawer(`${p.name} · ${dayLong(d)}`, `${fd(planned)} planificadas de ${fd(cap)}${planned > cap ? ` · ${fd(planned - cap)} sobre capacidad` : ''}`,
      items.length ? h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Tarea'), h('th', { class: 'num' }, 'Este día'), h('th', null, h('span', { class: 'sr-only' }, 'Acciones')))),
        h('tbody', null, items.map((t) => h('tr', null,
          h('td', null, h('span', { class: 'ref' }, t.ref), ' ', h('span', { class: 'task-name' }, h('a', { href: planeTaskUrl(slug, t.ref), target: '_blank', rel: 'noopener' }, t.name)),
            h('span', { class: 'sub' }, `${t.project} · ${fd(t.minutes)} estimadas · ${shortDate(t.start)} – ${shortDate(t.due)}`)),
          h('td', { class: 'num' }, fd(t.today)),
          h('td', null, h('button', { class: 'btn ghost icon-only', 'aria-label': `Empezar el reloj en ${t.ref}`, title: 'Empezar reloj', onclick: () => startTimer(t) }, icon('play')))))))
        : h('p', { class: 'empty-box' }, 'Sin tareas planificadas este día.'));
  }

  async function render() {
    const tools = weekNav({ monday, onChange: (m) => { monday = m; sync(); load(); } });
    tools.append(await projectSelect(slug, project, (v) => { project = v; sync(); load(); }));
    const head = h('div', { class: 'load-grid load-head' },
      h('div', null, h('b', { style: { fontWeight: 500, color: 'var(--text)' } }, `${data.people.length} personas`), 'Planificado / capacidad'),
      data.days.map((d) => h('div', { class: `day${d === localDay() ? ' today' : ''}` }, dayShort(d), h('b', { class: 'num' }, dayNum(d)))));
    const rows = data.people.map((p) => {
      const planned = data.days.reduce((s, d) => s + dayMin(p, d), 0);
      const over = planned > p.capacity;
      return h('div', { class: 'load-grid' },
        h('div', { class: 'person' }, avatar(p),
          h('div', { class: 'who' },
            h('span', { class: 'name' }, p.name),
            h('span', { class: `sum num${over ? ' over' : ''}` }, `${fd(planned)} de ${fd(p.capacity)}`),
            h('span', { class: `meter${over ? ' over' : ''}`, 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.min(p.capacity ? planned / p.capacity : 0, 1) * 100}%` } })))),
        data.days.map((d) => cell(p, d)));
    });
    const foot = [];
    if (data.unscheduled || data.unestimated) {
      foot.push(h('div', { class: 'load-foot' },
        [data.unestimated ? `${data.unestimated} tarea${data.unestimated > 1 ? 's' : ''} sin horas estimadas` : '',
          data.unscheduled ? `${data.unscheduled} ${data.unestimated ? '' : `tarea${data.unscheduled > 1 ? 's' : ''} `}sin fechas` : ''].filter(Boolean).join(' y '),
        data.unestimated + data.unscheduled > 1 ? ' no cuentan en la carga. ' : ' no cuenta en la carga. ',
        h('a', { href: `#/${encodeURIComponent(slug)}/tareas?ambito=equipo&orden=estimacion` }, 'Estimar tareas')));
    }
    main.replaceChildren(
      h('div', { class: 'title-row' },
        h('div', null, h('h1', null, 'Carga de trabajo'), h('p', { class: 'finding' }, finding())),
        tools),
      data.people.length
        ? h('section', { class: 'load', 'aria-label': 'Carga de trabajo por persona y día' }, head, rows, foot)
        : h('p', { class: 'empty-box' }, 'No hay nadie en los proyectos visibles.'),
      h('div', { class: 'legend', style: { marginTop: '12px' } },
        h('span', null, h('i', { class: 'k-plan' }), 'Horas estimadas de sus tareas, repartidas entre inicio y entrega'),
        h('span', null, h('i', { class: 'k-over' }), 'Sobre capacidad'),
        h('span', null, h('i', { class: 'k-off' }), 'No laborable'),
        h('span', null, state.role >= 20 ? 'Registradas: horas apuntadas (ves las de todo el equipo)' : 'Registradas: solo ves las tuyas')));
  }

  function sync() {
    const q = new URLSearchParams();
    if (monday !== mondayOf(localDay())) q.set('semana', monday);
    if (project) q.set('proyecto', project);
    history.replaceState(null, '', `#/${encodeURIComponent(slug)}/carga${q.size ? `?${q}` : ''}`);
  }

  load();
  return { dispose: onTimeChange(load) };
}

// =====================================================================
// Mis horas: hoja semanal de la persona, con registro rápido
// =====================================================================
function horas({ main, params, slug }) {
  let monday = mondayOf(params.get('semana') || localDay());
  let entries = [];
  let capacity = null;
  const extraTasks = new Map(); // tareas añadidas a la hoja sin horas todavía
  let form = null; // el formulario se conserva al recargar la semana (no pierde la tarea elegida)

  async function load() {
    try {
      const [e, cap] = await Promise.all([
        api(`w/${slug}/entries?from=${monday}&to=${shiftDay(monday, 6)}`),
        capacity ? null : api(`w/${slug}/capacity`),
      ]);
      entries = e;
      if (cap) capacity = cap.find((c) => c.id === state.me.id) ?? { minutes_per_day: 480, workdays: [1, 2, 3, 4, 5] };
      render();
    } catch (err) { errorBox(main, 'Mis horas', err, load); }
  }

  const days = () => Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
  const sum = (list) => list.reduce((s, e) => s + e.minutes, 0);

  function quickForm() {
    let task = null;
    const today = localDay();
    const daySel = h('select', { class: 'input', id: 'q-day' }, days().filter((d) => d <= today).map((d) => h('option', { value: d, selected: d === (today < shiftDay(monday, 7) ? today : monday) }, `${dayShort(d)} ${shortDate(d)}`)));
    if (!daySel.options.length) daySel.append(h('option', { value: '' }, 'Semana futura'));
    const dur = h('input', { class: 'input num', id: 'q-dur', placeholder: '1:30', inputmode: 'decimal', autocomplete: 'off' });
    const note = h('input', { class: 'input', id: 'q-note', maxlength: 500, placeholder: 'Qué hiciste (opcional)' });
    const picker = taskPicker({ onPick: (t) => { task = t; }, placeholder: 'Busca la tarea' });
    picker.querySelector('input').id = 'q-task';
    const submit = async (ev) => {
      ev.preventDefault();
      const minutes = parseDuration(dur.value);
      dur.setAttribute('aria-invalid', minutes ? 'false' : 'true');
      if (!task) return toast('Elige una tarea de la lista');
      if (!minutes) return toast('Duración no válida: escribe por ejemplo 1:30, 1h 30m o 1,5');
      if (!daySel.value) return toast('No se pueden registrar horas en días futuros');
      try {
        await api(`w/${slug}/entries`, { method: 'POST', body: { issue_id: task.id, day: daySel.value, minutes, note: note.value } });
        toast(`Registradas ${fd(minutes)} en ${task.ref}`);
        dur.value = ''; note.value = '';
        changed();
      } catch (e) { toast(e.message); }
    };
    return h('form', { class: 'quick', onsubmit: submit, 'aria-label': 'Registrar horas' },
      h('div', { class: 'field wide' }, h('label', { for: 'q-task' }, 'Tarea'), picker),
      h('div', { class: 'field' }, h('label', { for: 'q-day' }, 'Día'), daySel),
      h('div', { class: 'field' }, h('label', { for: 'q-dur' }, 'Duración'), dur),
      h('div', { class: 'field wide' }, h('label', { for: 'q-note' }, 'Nota'), note),
      h('button', { class: 'btn primary', type: 'submit', style: { height: '32px' } }, icon('plus'), 'Registrar'));
  }

  // Detalle de una tarea en un día: editar o borrar sus entradas
  function dayDetail(task, d) {
    const list = entries.filter((e) => e.issue_id === task.id && e.day === d);
    const rows = list.map((e) => {
      const dur = h('input', { class: 'input num est-input', value: `${Math.floor(e.minutes / 60)}:${String(e.minutes % 60).padStart(2, '0')}`, 'aria-label': 'Duración' });
      const note = h('input', { class: 'input', value: e.note, maxlength: 500, 'aria-label': 'Nota', style: { width: '100%' } });
      const save = async () => {
        const minutes = parseDuration(dur.value);
        dur.setAttribute('aria-invalid', minutes ? 'false' : 'true');
        if (!minutes) return toast('Duración no válida');
        try { await api(`w/${slug}/entries/${e.id}`, { method: 'PATCH', body: { minutes, note: note.value } }); toast('Guardado'); changed(); } catch (err) { toast(err.message); }
      };
      return h('div', { style: { display: 'grid', gridTemplateColumns: '84px 1fr auto auto', gap: '8px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--rule)' } },
        dur, note,
        h('button', { class: 'btn', onclick: save }, 'Guardar'),
        h('button', { class: 'btn ghost icon-only danger', 'aria-label': 'Borrar entrada', onclick: async () => {
          if (!confirm(`¿Borrar ${fd(e.minutes)} de ${task.ref}?`)) return;
          try { await api(`w/${slug}/entries/${e.id}`, { method: 'DELETE', body: {} }); toast('Entrada borrada'); changed(); d$.close(); } catch (err) { toast(err.message); }
        } }, icon('trash')),
        h('span', { class: 'sub', style: { gridColumn: '1 / -1' } }, e.source === 'timer' ? 'Con el reloj' : 'Manual'));
    });
    const add = h('input', { class: 'input num est-input', placeholder: '0:30', 'aria-label': 'Añadir duración' });
    const d$ = drawer(`${task.ref} · ${dayLong(d)}`, task.name, [
      rows.length ? rows : h('p', { class: 'muted' }, 'Sin horas este día.'),
      d > localDay() ? null : h('form', { style: { display: 'flex', gap: '8px', marginTop: '16px' }, onsubmit: async (ev) => {
        ev.preventDefault();
        const minutes = parseDuration(add.value);
        if (!minutes) return toast('Duración no válida');
        try { await api(`w/${slug}/entries`, { method: 'POST', body: { issue_id: task.id, day: d, minutes, note: '' } }); toast(`Registradas ${fd(minutes)}`); changed(); d$.close(); } catch (err) { toast(err.message); }
      } }, add, h('button', { class: 'btn primary', type: 'submit' }, 'Añadir')),
    ]);
  }

  function render() {
    const ds = days();
    const tasks = new Map(extraTasks);
    for (const e of entries) if (!tasks.has(e.issue_id)) tasks.set(e.issue_id, { id: e.issue_id, ref: e.ref, name: e.name, project: e.project });
    const total = sum(entries);
    const cap = ds.filter((d) => capacity.workdays.includes(((new Date(`${d}T12:00:00`).getDay()) || 7))).length * capacity.minutes_per_day;
    const today = localDay();

    const table = tasks.size ? h('table', { class: 'table sheet-table' },
      h('thead', null, h('tr', null, h('th', null, 'Tarea'),
        ds.map((d) => h('th', { class: 'day num' }, `${dayShort(d)} ${dayNum(d)}`)), h('th', { class: 'num' }, 'Total'))),
      h('tbody', null, [...tasks.values()].map((t) => {
        const mine = entries.filter((e) => e.issue_id === t.id);
        return h('tr', null,
          h('td', null, h('span', { class: 'ref' }, t.ref), ' ', h('span', { class: 'task-name' }, h('a', { href: planeTaskUrl(slug, t.ref), target: '_blank', rel: 'noopener' }, t.name)), h('span', { class: 'sub' }, t.project)),
          ds.map((d) => {
            const m = sum(mine.filter((e) => e.day === d));
            return h('td', { class: 'day' }, h('button', {
              class: `slot num${m ? '' : ' empty'}`, disabled: d > today && !m ? true : null,
              'aria-label': `${t.ref}, ${dayLong(d)}: ${m ? fd(m) : 'sin horas'}. Editar`,
              onclick: () => dayDetail(t, d),
            }, m ? fd(m) : '—'));
          }),
          h('td', { class: 'num' }, h('b', { style: { fontWeight: 500 } }, fd(sum(mine)))));
      })),
      h('tfoot', null, h('tr', null, h('td', null, 'Total del día'),
        ds.map((d) => { const m = sum(entries.filter((e) => e.day === d)); return h('td', { class: `num${m ? '' : ' muted'}` }, m ? fd(m) : '—'); }),
        h('td', { class: 'num' }, fd(total)))))
      : h('p', { class: 'empty-box', style: { margin: '16px' } }, 'Aún no hay horas esta semana. Regístralas arriba o pon el reloj en marcha desde una tarea.');

    main.replaceChildren(
      h('div', { class: 'title-row' },
        h('div', null, h('h1', null, 'Mis horas'),
          h('p', { class: 'finding' }, 'Esta semana llevas ', h('strong', { class: 'num' }, fd(total)), ` de ${fd(cap)} de capacidad`,
            total > cap ? h('span', { class: 'over num' }, ` (+${fd(total - cap)})`) : '', '.')),
        weekNav({ monday, onChange: (m) => { monday = m; form = null; history.replaceState(null, '', `#/${encodeURIComponent(slug)}/horas?semana=${m}`); load(); } })),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Registrar horas')), form ??= quickForm()),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Semana'),
        taskPicker({ align: 'right', scope: 'mine', trigger: (open) => h('button', { class: 'btn', onclick: open }, icon('plus'), 'Añadir fila'),
          onPick: (t) => { extraTasks.set(t.id, t); render(); } })),
      h('div', { style: { overflowX: 'auto' } }, table)));
  }

  load();
  return { dispose: onTimeChange(load) };
}

// =====================================================================
// Tareas: estimación, tiempo registrado y reloj por tarea
// =====================================================================
function tareas({ main, params, slug, admin }) {
  let scope = params.get('ambito') === 'equipo' ? 'all' : 'mine';
  let search = params.get('q') || '';
  let project = '';
  const startRef = params.get('start');
  let tasks = [];

  async function load() {
    try {
      tasks = await api(`w/${slug}/tasks?scope=${scope}&q=${encodeURIComponent(search)}${project ? `&project=${project}` : ''}`);
      if (params.get('orden') === 'estimacion') tasks.sort((a, b) => (a.estimate ? 1 : 0) - (b.estimate ? 1 : 0));
      await render();
    } catch (e) { errorBox(main, 'Tareas', e, load); }
  }

  function estimateInput(t) {
    const input = h('input', {
      class: 'input num est-input', value: t.estimate ? fd(t.estimate) : '', placeholder: '—', 'aria-label': `Estimación de ${t.ref}`,
      onchange: async () => {
        const v = input.value.trim();
        const minutes = v ? parseDuration(v, 100000) : null;
        if (v && !minutes) { input.setAttribute('aria-invalid', 'true'); return toast('Estimación no válida: escribe por ejemplo 6h o 1:30'); }
        input.setAttribute('aria-invalid', 'false');
        try {
          await api(`w/${slug}/tasks/${t.id}/estimate`, { method: 'PUT', body: { minutes } });
          t.estimate = minutes; input.value = minutes ? fd(minutes) : '';
          toast(minutes ? `${t.ref}: ${fd(minutes)} estimadas` : `${t.ref}: sin estimación`);
          render();
        } catch (e) { toast(e.message); }
      },
    });
    return input;
  }

  async function render() {
    const tools = h('div', { class: 'tools' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Qué tareas' },
        [['mine', 'Mías'], ['all', 'Equipo']].map(([v, l]) => h('button', { 'aria-pressed': String(scope === v), onclick: () => { scope = v; load(); } }, l))),
      h('input', { class: 'input', type: 'search', placeholder: 'Buscar', value: search, 'aria-label': 'Buscar tareas',
        onchange: (e) => { search = e.target.value; load(); } }),
      await projectSelect(slug, project, (v) => { project = v; load(); }));

    const loggedOf = (t) => (admin ? t.team : t.mine);
    const running = state.timer?.issue_id;
    const notice = startRef ? await (async () => {
      const found = (await api(`w/${slug}/tasks?scope=all&q=${encodeURIComponent(startRef)}`)).find((t) => t.ref === startRef);
      if (!found) return h('div', { class: 'notice' }, `No encuentro la tarea ${startRef} entre tus proyectos.`);
      return h('div', { class: 'notice' }, h('span', null, '¿Empezar el reloj en ', h('strong', null, `${found.ref} · ${found.name}`), '?'),
        h('span', { class: 'tools' },
          h('button', { class: 'btn primary', onclick: () => { startTimer(found); go('tareas'); } }, icon('play'), 'Empezar'),
          h('button', { class: 'btn', onclick: () => go('tareas') }, 'Ahora no')));
    })() : null;

    main.replaceChildren(
      h('div', { class: 'title-row' },
        h('div', null, h('h1', null, 'Tareas'), h('p', { class: 'finding' },
          tasks.length >= 200 ? 'Se muestran las 200 primeras tareas abiertas; usa la búsqueda o el filtro de proyecto' : `${tasks.length} tarea${tasks.length === 1 ? '' : 's'} abierta${tasks.length === 1 ? '' : 's'}`,
          tasks.filter((t) => !t.estimate).length ? `, ${tasks.filter((t) => !t.estimate).length} sin estimación` : '',
          tasks.filter((t) => t.estimate && loggedOf(t) > t.estimate).length ? [', ', h('span', { class: 'over' }, `${tasks.filter((t) => t.estimate && loggedOf(t) > t.estimate).length} por encima de lo estimado`)] : '', '.')),
        tools),
      notice ?? '',
      h('section', { class: 'panel' }, h('div', { style: { overflowX: 'auto' } }, tasks.length ? h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Tarea'), h('th', { class: 'hide-sm' }, 'Estado'), h('th', { class: 'hide-sm' }, 'Entrega'),
          h('th', { class: 'num' }, 'Estimación'), h('th', { class: 'num' }, admin ? 'Equipo' : 'Tu tiempo'),
          h('th', { class: 'hide-sm' }, 'Avance'), h('th', null, h('span', { class: 'sr-only' }, 'Reloj')))),
        h('tbody', null, tasks.map((t) => {
          const logged = loggedOf(t);
          const over = t.estimate && logged > t.estimate;
          const isRunning = running === t.id;
          return h('tr', null,
            h('td', null, h('span', { class: 'ref' }, t.ref), ' ', h('span', { class: 'task-name' }, h('a', { href: planeTaskUrl(slug, t.ref), target: '_blank', rel: 'noopener' }, t.name)),
              h('span', { class: 'sub' }, `${t.project}${t.assignees.length ? ` · ${t.assignees.join(', ')}` : ' · sin responsable'}`)),
            h('td', { class: 'hide-sm' }, h('span', { class: 'state' }, h('i', { style: { background: t.state_color } }), t.state)),
            h('td', { class: 'hide-sm num' }, shortDate(t.due)),
            h('td', { class: 'num' }, estimateInput(t)),
            h('td', { class: 'num' }, logged ? fd(logged) : h('span', { class: 'muted' }, '0 m'),
              admin && t.mine ? h('span', { class: 'sub' }, `tuyas ${fd(t.mine)}`) : null),
            h('td', { class: 'hide-sm' }, t.estimate
              ? h('span', { class: 'progress-cell' }, h('span', { class: `progress${over ? ' over' : ''}`, role: 'img', 'aria-label': `${Math.round((logged / t.estimate) * 100)} % de lo estimado` }, h('i', { style: { width: `${Math.min(logged / t.estimate, 1) * 100}%` } })),
                over ? h('span', { class: 'sub over-text num' }, `+${fd(logged - t.estimate)} sobre lo estimado`) : h('span', { class: 'sub num' }, `${Math.round((logged / t.estimate) * 100)} %`))
              : h('span', { class: 'muted' }, '—')),
            h('td', null, isRunning
              ? h('button', { class: 'btn dark icon-only', 'aria-label': `Parar el reloj de ${t.ref}`, title: 'Parar', onclick: stopTimer }, icon('stop'))
              : h('button', { class: 'btn icon-only', 'aria-label': `Empezar el reloj en ${t.ref}`, title: 'Empezar reloj', onclick: () => startTimer(t) }, icon('play'))));
        }))) : h('p', { class: 'empty-box', style: { margin: '16px' } }, scope === 'mine'
          ? ['No tienes tareas abiertas asignadas. ', h('button', { class: 'link', onclick: () => { scope = 'all'; load(); } }, 'Ver las del equipo')]
          : 'No hay tareas abiertas que coincidan.'))));
  }

  load();
  return { dispose: onTimeChange(load) };
}

// =====================================================================
// Informes: horas registradas por persona, proyecto, tarea, ciclo, módulo o día
// =====================================================================
function informes({ main, slug, admin }) {
  const today = localDay();
  const monthStart = today.slice(0, 8) + '01';
  const prevMonthEnd = shiftDay(monthStart, -1);
  const PRESETS = {
    'Últimos 30 días': [shiftDay(today, -29), today],
    'Esta semana': [mondayOf(today), shiftDay(mondayOf(today), 6)],
    'Semana pasada': [shiftDay(mondayOf(today), -7), shiftDay(mondayOf(today), -1)],
    'Este mes': [monthStart, today],
    'Mes pasado': [prevMonthEnd.slice(0, 8) + '01', prevMonthEnd],
  };
  const GROUPS = [['person', 'Persona'], ['project', 'Proyecto'], ['task', 'Tarea'], ['cycle', 'Ciclo'], ['module', 'Módulo'], ['day', 'Día']]
    .filter(([g]) => admin || g !== 'person');
  let [from, to] = PRESETS['Últimos 30 días'];
  let group = admin ? 'person' : 'project';
  let user = admin ? 'all' : 'me';
  let people = [];

  async function load() {
    try {
      if (admin && !people.length) people = await api(`w/${slug}/capacity`);
      const data = await api(`w/${slug}/report?from=${from}&to=${to}&group=${group}&user=${user}`);
      render(data);
    } catch (e) { errorBox(main, 'Informes', e, load); }
  }

  function render(data) {
    const preset = Object.entries(PRESETS).find(([, [a, b]]) => a === from && b === to)?.[0];
    const max = Math.max(1, ...data.rows.map((r) => r.minutes));
    const csv = `/time/api/w/${encodeURIComponent(slug)}/report?${new URLSearchParams({ from, to, user, format: 'csv' })}`;
    const dateInput = (v, label, set) => h('input', { class: 'input num', type: 'date', value: v, 'aria-label': label, onchange: (e) => { if (e.target.value) { set(e.target.value); load(); } } });
    const entries = data.entries;
    main.replaceChildren(
      h('div', { class: 'title-row' },
        h('div', null, h('h1', null, 'Informes'), h('p', { class: 'finding' }, admin ? 'Horas registradas por el equipo.' : 'Tus horas registradas. Las del resto del equipo solo las ven los administradores.')),
        h('div', { class: 'tools' },
          h('div', { class: 'segmented', role: 'group', 'aria-label': 'Periodo' },
            Object.entries(PRESETS).map(([l, [a, b]]) => h('button', { 'aria-pressed': String(preset === l), onclick: () => { from = a; to = b; load(); } }, l))),
          dateInput(from, 'Desde', (v) => (from = v)), dateInput(to, 'Hasta', (v) => (to = v)),
          admin ? h('select', { class: 'input', 'aria-label': 'Persona', onchange: (e) => { user = e.target.value; load(); } },
            h('option', { value: 'all' }, 'Todo el equipo'), people.map((p) => h('option', { value: p.id, selected: p.id === user }, p.name))) : null,
          h('a', { class: 'btn', href: csv, download: true }, icon('download'), 'Exportar CSV'))),
      h('section', { class: 'panel' },
        h('div', { class: 'report-total' }, h('b', { class: 'num' }, fd(data.total)),
          h('span', { class: 'muted' }, `en ${entries} entrada${entries === 1 ? '' : 's'} · ${shortDate(from)} – ${shortDate(to)}`)),
        h('div', { class: 'panel-head', style: { borderBottom: 0, paddingBottom: 0 } },
          h('h2', null, `Por ${GROUPS.find(([g]) => g === group)[1].toLowerCase()}`),
          h('div', { class: 'segmented', role: 'group', 'aria-label': 'Agrupar por' },
            GROUPS.map(([g, l]) => h('button', { 'aria-pressed': String(group === g), onclick: () => { group = g; load(); } }, l)))),
        data.rows.length ? h('ul', { class: 'bars' }, data.rows.map((r) => h('li', null,
          h('span', { class: 'label', title: r.label }, r.label),
          h('span', { class: 'track', 'aria-hidden': 'true' }, h('i', { style: { width: `${(r.minutes / max) * 100}%` } })),
          h('span', { class: 'num', style: { textAlign: 'right' } }, fd(r.minutes), h('span', { class: 'sub' }, `${Math.round((r.minutes / data.total) * 100)} %`)))))
          : h('p', { class: 'empty-box', style: { margin: '16px' } }, 'No hay horas registradas en este periodo.'),
        group === 'module' ? h('p', { class: 'sub', style: { padding: '0 16px 16px' } }, 'Una tarea que está en varios módulos suma sus horas en cada uno.') : null));
  }

  load();
  return { dispose: onTimeChange(load) };
}

// =====================================================================
// Capacidad: horas al día y días laborables de cada persona
// =====================================================================
function capacidad({ main, slug, admin }) {
  async function load() {
    try { render(await api(`w/${slug}/capacity`)); } catch (e) { errorBox(main, 'Capacidad', e, load); }
  }
  function render(people) {
    const row = (p) => {
      const status = h('span', { class: 'saved', 'aria-live': 'polite' });
      let days = [...p.workdays];
      const save = async () => {
        const minutes = perDay.value.trim() === '0' ? 0 : parseDuration(perDay.value);
        if (minutes === null) { perDay.setAttribute('aria-invalid', 'true'); return toast('Horas al día no válidas: escribe por ejemplo 8 o 7:30'); }
        perDay.setAttribute('aria-invalid', 'false');
        try {
          await api(`w/${slug}/capacity/${p.id}`, { method: 'PUT', body: { minutes_per_day: minutes, workdays: days } });
          week.textContent = fd(minutes * days.length);
          status.textContent = 'Guardado'; setTimeout(() => (status.textContent = ''), 2000);
        } catch (e) { toast(e.message); }
      };
      const week = h('span', null, fd(p.minutes_per_day * p.workdays.length));
      const perDay = h('input', { class: 'input num est-input', value: fd(p.minutes_per_day), disabled: !admin, 'aria-label': `Horas al día de ${p.name}`, onchange: save });
      const toggles = h('span', { class: 'days-toggle', role: 'group', 'aria-label': `Días laborables de ${p.name}` },
        WEEKDAYS.map((l, i) => h('button', {
          'aria-pressed': String(days.includes(i + 1)), disabled: !admin, 'aria-label': ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][i],
          onclick: (e) => {
            days = days.includes(i + 1) ? days.filter((d) => d !== i + 1) : [...days, i + 1].sort();
            e.currentTarget.setAttribute('aria-pressed', String(days.includes(i + 1)));
            save();
          },
        }, l)));
      return h('tr', null, h('td', null, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } }, avatar(p), p.name)),
        h('td', { class: 'num' }, perDay), h('td', null, toggles),
        h('td', { class: 'num' }, week), h('td', null, status));
    };
    main.replaceChildren(
      h('div', { class: 'title-row' }, h('div', null, h('h1', null, 'Capacidad'),
        h('p', { class: 'finding' }, admin ? 'Horas que cada persona puede dedicar al día y qué días trabaja. La carga de trabajo se compara con esto.'
          : 'Solo los administradores del espacio cambian la capacidad.'))),
      h('section', { class: 'panel' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Persona'), h('th', { class: 'num' }, 'Horas al día'), h('th', null, 'Días laborables'), h('th', { class: 'num' }, 'A la semana'), h('th', { style: { width: '96px' } }, h('span', { class: 'sr-only' }, 'Estado')))),
        h('tbody', null, people.map(row)))));
  }
  load();
  return {};
}

export const views = { carga, horas, tareas, informes, capacidad };
