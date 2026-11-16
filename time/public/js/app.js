// Arranque del módulo: armazón, rutas (#/<espacio>/<pantalla>), reloj global y selector de tareas.
import { h, icon, api, toast, localDay, planeTaskUrl } from './ui.js';
import { formatClock } from './duration.js';
import { views } from './views.js';

export const state = { me: null, workspaces: [], slug: null, role: 0, timer: null, offset: 0 };
// Dentro de Plane (iframe de «Carga de trabajo»): sin barra de iconos propia y con pestañas arriba
export const EMBED = new URLSearchParams(location.search).has('embed') && window.top !== window;
if (EMBED) document.documentElement.classList.add('embed');
const channel = new BroadcastChannel('plane-time'); // cambios hechos desde los campos de las tareas de Plane

const NAV = [
  ['carga', 'Carga de trabajo', 'load'],
  ['horas', 'Mis horas', 'sheet'],
  ['tareas', 'Tareas', 'tasks'],
  ['informes', 'Informes', 'report'],
  ['capacidad', 'Capacidad', 'capacity'],
];

function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [slug, view] = path.split('/');
  return { slug: decodeURIComponent(slug || ''), view: view || 'carga', params: new URLSearchParams(query) };
}
export const go = (view, params) => {
  location.hash = `#/${encodeURIComponent(state.slug)}/${view}${params ? `?${new URLSearchParams(params)}` : ''}`;
};
export const changed = () => {
  window.dispatchEvent(new Event('timechange'));
  channel.postMessage('entries');
};
channel.onmessage = () => loadTimer().then(() => window.dispatchEvent(new Event('timechange'))).catch(() => {});

function renderRail(current) {
  const rail = document.querySelector('.rail');
  rail.replaceChildren(
    h('a', { class: 'mark', href: `/${encodeURIComponent(state.slug)}/`, title: 'Volver a Plane', 'aria-label': 'Volver a Plane' }, icon('clock')),
    ...NAV.map(([id, label, ic]) => h('a', {
      href: `#/${encodeURIComponent(state.slug)}/${id}`, title: label, 'aria-label': label,
      'aria-current': id === current ? 'page' : null,
    }, icon(ic))),
    h('div', { class: 'spacer' }),
  );
}

// Dentro de Plane, las pantallas son pestañas, como las vistas de Plane
function renderTabs(current) {
  document.querySelector('.crumbs').replaceChildren(h('nav', { class: 'tabs', 'aria-label': 'Tiempo' },
    NAV.map(([id, label]) => h('a', { href: `#/${encodeURIComponent(state.slug)}/${id}`, 'aria-current': id === current ? 'page' : null }, label))));
}

function renderCrumbs(label) {
  const select = h('select', {
    'aria-label': 'Espacio de trabajo',
    onchange: (e) => { location.hash = `#/${encodeURIComponent(e.target.value)}/${route().view}`; },
  }, state.workspaces.map((w) => h('option', { value: w.slug, selected: w.slug === state.slug }, w.name)));
  document.querySelector('.crumbs').replaceChildren(select, h('span', { 'aria-hidden': 'true' }, '/'), h('span', { class: 'here' }, label));
}

// ---------- Reloj ----------
let tick;
export async function loadTimer() {
  const t = await api('timer');
  state.timer = t;
  if (t) state.offset = Date.parse(t.server_now) - Date.now();
  renderTimer();
}
const elapsed = () => (Date.now() + state.offset - Date.parse(state.timer.started_at)) / 1000;

export async function startTimer(task) {
  try {
    state.timer = await api(`w/${state.slug}/timer/start`, { method: 'POST', body: { issue_id: task.id, day: localDay() } });
    state.offset = Date.parse(state.timer.server_now) - Date.now();
    renderTimer();
    changed();
    toast(`Reloj en marcha: ${task.ref ?? state.timer.ref}`);
  } catch (e) { toast(e.message); }
}

export async function stopTimer() {
  if (!state.timer) return;
  try {
    const slug = state.timer.slug;
    const e = await api(`w/${slug}/timer/stop`, { method: 'POST', body: {} });
    state.timer = null;
    renderTimer();
    changed();
    toast(`Registrados ${e.minutes} min en ${localDay() === e.day ? 'hoy' : e.day}`);
  } catch (e) { toast(e.message); }
}

function renderTimer() {
  const box = document.querySelector('.timer');
  clearInterval(tick);
  const t = state.timer;
  if (!t) {
    box.replaceChildren(taskPicker({
      align: 'right',
      trigger: (open) => h('button', { class: 'btn primary', onclick: open }, icon('play'), 'Empezar reloj'),
      onPick: startTimer,
    }));
    document.title = 'Tiempo · Plane';
    return;
  }
  const clock = h('span', { class: 'clock num', 'aria-label': 'Tiempo en marcha' }, formatClock(elapsed()));
  tick = setInterval(() => {
    clock.textContent = formatClock(elapsed());
    document.title = `${clock.textContent} · ${t.ref} · Tiempo`;
  }, 1000);
  box.replaceChildren(
    h('span', { class: 'live', 'aria-hidden': 'true' }),
    h('div', { class: 'task' },
      h('b', { title: t.name }, h('a', { href: planeTaskUrl(t.slug, t.ref), target: '_blank', rel: 'noopener' }, `${t.ref} · ${t.name}`)),
      h('span', null, 'Reloj en marcha')),
    clock,
    h('button', { class: 'btn dark', onclick: stopTimer }, icon('stop'), 'Parar'),
    h('button', {
      class: 'btn ghost icon-only', title: 'Descartar sin registrar', 'aria-label': 'Descartar el reloj sin registrar',
      onclick: async () => {
        if (!confirm('¿Descartar este reloj? No se registrará el tiempo.')) return;
        await api(`w/${t.slug}/timer`, { method: 'DELETE', body: {} }).catch((e) => toast(e.message));
        state.timer = null; renderTimer(); changed();
      },
    }, icon('close')),
  );
}

// ---------- Selector de tareas (combobox accesible) ----------
let pickerId = 0;
export function taskPicker({ onPick, trigger, align, placeholder = 'Busca una tarea por nombre o código', scope = 'all', value }) {
  const id = `picker-${++pickerId}`;
  const wrap = h('div', { class: 'picker' });
  const list = h('ul', { id, role: 'listbox', class: `picker-list ${align === 'right' ? 'right' : ''}`, hidden: true });
  let items = [];
  let active = -1;
  let timer;
  const input = h('input', {
    class: 'input', type: 'search', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': id,
    'aria-autocomplete': 'list', placeholder, autocomplete: 'off', value: value ?? '', 'aria-label': 'Tarea',
    oninput: () => { clearTimeout(timer); timer = setTimeout(search, 200); },
    onfocus: () => search(),
    onkeydown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        paint();
      } else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
      else if (e.key === 'Escape') close();
    },
  });
  const close = () => {
    list.hidden = true; input.setAttribute('aria-expanded', 'false');
    if (trigger) wrap.replaceChildren(trigger(open));
  };
  const pick = (t) => {
    close();
    if (!trigger) input.value = `${t.ref} · ${t.name}`;
    onPick(t);
  };
  function paint() {
    list.replaceChildren(...(items.length ? items.map((t, i) => h('li', {
      role: 'option', id: `${id}-${i}`, 'aria-selected': i === active ? 'true' : 'false',
      onmousedown: (e) => { e.preventDefault(); pick(t); },
    }, h('span', { class: 'ref' }, t.ref), h('span', null, t.name))) : [h('li', { class: 'empty' }, 'Ninguna tarea abierta coincide')]));
    input.setAttribute('aria-activedescendant', active >= 0 ? `${id}-${active}` : '');
  }
  async function search() {
    try {
      items = await api(`w/${state.slug}/tasks?scope=${scope}&q=${encodeURIComponent(input.value.replace(/^\S+ · /, ''))}`);
      items = items.slice(0, 30);
      active = items.length ? 0 : -1;
      paint();
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    } catch (e) { toast(e.message); }
  }
  input.addEventListener('blur', () => setTimeout(() => { if (!wrap.contains(document.activeElement)) close(); }, 120));
  function open() { wrap.replaceChildren(input, list); input.focus(); }
  if (trigger) wrap.append(trigger(open)); else wrap.append(input, list);
  return wrap;
}

// ---------- Rutas ----------
let current = null;
async function render() {
  const r = route();
  if (!state.workspaces.some((w) => w.slug === r.slug)) {
    const first = state.workspaces[0];
    if (!first) {
      document.getElementById('view').replaceChildren(h('p', { class: 'empty-box' }, 'No perteneces a ningún espacio de trabajo de Plane.'));
      return;
    }
    location.replace(`#/${encodeURIComponent(first.slug)}/${r.view}`);
    return;
  }
  const ws = state.workspaces.find((w) => w.slug === r.slug);
  state.slug = ws.slug;
  state.role = ws.role;
  const nav = NAV.find(([id]) => id === r.view) ?? NAV[0];
  renderRail(nav[0]);
  if (EMBED) renderTabs(nav[0]); else renderCrumbs(nav[1]);
  const main = document.getElementById('view');
  current?.dispose?.();
  document.querySelectorAll('.drawer').forEach((d) => d.remove());
  // Mientras carga la pantalla nueva no se queda a la vista la anterior
  main.replaceChildren(h('h1', null, nav[1]), h('p', { class: 'finding' }, h('span', { class: 'skeleton', style: { width: '280px' } })));
  current = views[nav[0]]({ main, params: r.params, slug: state.slug, admin: state.role >= 20 });
}

async function boot() {
  try {
    const me = await api('me');
    state.me = me.user;
    state.workspaces = me.workspaces;
    await loadTimer();
  } catch (e) {
    if (e.status !== 401) document.getElementById('view').replaceChildren(h('p', { class: 'empty-box' }, `No se pudo cargar el módulo: ${e.message}`));
    return;
  }
  window.addEventListener('hashchange', render);
  // Los enlaces a Plane se abren en Plane, no dentro del iframe
  if (EMBED) document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]');
    if (a && !a.getAttribute('href').startsWith('/time/')) a.target = '_top';
  });
  // Al volver a la pestaña, el reloj puede haber cambiado desde otro dispositivo
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadTimer().catch(() => {}); });
  render();
}
boot();
