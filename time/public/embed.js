// Módulo de tiempo dentro de la web de Plane (lo carga el index.html de Plane con import(), ver plane-web/).
// Añade, con las mismas clases y colores de Plane:
//  - en el panel de propiedades de cada tarea: «Tiempo estimado» y «Tiempo registrado» con su reloj;
//  - en la cabecera, el reloj en marcha;
//  - en la barra lateral, «Carga de trabajo», que abre el módulo sobre el área de contenido.
// Si una versión de Plane cambia su estructura, estos añadidos dejan de aparecer y Plane sigue igual.
import { parseDuration, formatDuration as fd, formatClock } from './js/duration.js';

const REF = /^[A-Z][A-Z0-9]{0,11}-\d+$/;
const channel = new BroadcastChannel('plane-time'); // avisa al módulo y a otras pestañas de cada cambio
const T = {
  es: { estimate: 'Tiempo estimado', tracked: 'Tiempo registrado', none: 'Sin estimar', start: 'Empezar reloj', stop: 'Parar reloj',
    add: 'Añadir', addHint: 'p. ej. 1:30 o 2h', note: 'Nota (opcional)', empty: 'Sin tiempo registrado', workload: 'Carga de trabajo',
    bad: 'Duración no válida', running: 'Reloj en marcha', del: 'Borrar', day: 'Día' },
  en: { estimate: 'Time estimate', tracked: 'Time tracked', none: 'None', start: 'Start timer', stop: 'Stop timer',
    add: 'Add', addHint: 'e.g. 1:30 or 2h', note: 'Note (optional)', empty: 'No time tracked', workload: 'Workload',
    bad: 'Invalid duration', running: 'Timer running', del: 'Delete', day: 'Day' },
};
let L = T.en;

// Estilos: hoja adoptada, porque Plane rehace el <head> al arrancar y quitaría un <link>
fetch('/time/embed.css').then((r) => r.text()).then((css) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
});

// ---------- utilidades ----------
function h(tag, attrs = {}, ...children) {
  const svg = tag === 'svg' || tag === 'path';
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const ICONS = {
  estimate: 'M8 1.75a6.25 6.25 0 1 0 0 12.5A6.25 6.25 0 0 0 8 1.75ZM8 4.5V8l2.25 1.5',
  tracked: 'M5.5 1.75h5M8 1.75v1.5M8 14.25a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5ZM8 6v3',
  play: 'M5 3.5v9l7-4.5z',
  stop: 'M4.5 4.5h7v7h-7z',
  load: 'M2.5 13.5h11M4 11V7M7 11V3.5M10 11V6M13 11V8.5',
};
const icon = (name, cls = 'size-4 shrink-0') => {
  const filled = name === 'play' || name === 'stop';
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: filled ? 'currentColor' : 'none', stroke: filled ? 'none' : 'currentColor',
    'stroke-width': 1.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: cls, 'aria-hidden': 'true' }, h('path', { d: ICONS[name] }));
};
const localDay = (d = new Date()) => d.toLocaleDateString('sv');
const slug = () => decodeURIComponent(location.pathname.split('/')[1] || '');

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`/time/api/${path}`, {
    method, credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw Object.assign(new Error(data?.error || `Error ${r.status}`), { status: r.status });
  return data;
}

// ---------- sesión y reloj ----------
let me = null; // { user, workspaces }
let timer = null;
let offset = 0;
let checking = null;
async function session() {
  if (me) return me;
  checking ??= api('me').then((r) => (me = r), () => null).finally(() => (checking = null));
  return checking;
}
const workspace = () => me?.workspaces.find((w) => w.slug === slug());

async function loadTimer() {
  timer = await api('timer').catch(() => null);
  if (timer) offset = Date.parse(timer.server_now) - Date.now();
  paintHeader();
  for (const f of fields.values()) f.paint();
}
const elapsed = () => (Date.now() + offset - Date.parse(timer.started_at)) / 1000;

function changed(kind = 'entries') {
  channel.postMessage(kind);
  refreshAll();
}
channel.onmessage = () => refreshAll();
function refreshAll() {
  loadTimer();
  for (const f of fields.values()) f.load();
}

// ---------- campos dentro de la tarea ----------
const fields = new Map(); // contenedor de propiedades -> campo
let openPopover = null;

const urlRef = () => location.pathname.match(/\/browse\/([A-Za-z0-9]+-\d+)\/?/)?.[1].toUpperCase() ?? null;
// Devuelve { ref, el }: el es el elemento que muestra el código (null si sale de la URL)
function refOf(container) {
  if (urlRef() && !isPeek(container)) return { ref: urlRef(), el: null };
  let el = container;
  for (let i = 0; i < 14 && el; i++, el = el.parentElement) {
    for (const leaf of el.querySelectorAll('span, p, div, a, button')) {
      if (leaf.children.length === 0 && REF.test(leaf.textContent.trim())) return { ref: leaf.textContent.trim(), el: leaf };
    }
  }
  return null;
}
// El panel lateral de Plane es una capa fija sobre la lista
function isPeek(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === 'fixed' || p === 'absolute') return true;
  }
  return false;
}

function propertyRow(iconName, label, value) {
  return h('div', { class: 'flex items-start gap-2', 'data-time-row': '' },
    h('div', { class: 'flex h-7.5 w-30 shrink-0 items-center gap-1.5 text-body-xs-regular text-tertiary' }, icon(iconName), h('span', null, label)),
    h('div', { class: 'flex grow flex-wrap items-center gap-1' }, value));
}
const BUTTON = 'whitespace-nowrap transition-colors focus-visible:outline-none disabled:pointer-events-none bg-layer-transparent text-secondary hover:bg-layer-transparent-hover focus:bg-layer-transparent-active active:bg-layer-transparent-active disabled:bg-layer-transparent disabled:text-disabled rounded-sm px-1.5 flex h-7.5 w-full items-center justify-between gap-1.5 text-body-xs-regular';

class Field {
  constructor(container, { ref, el }) {
    this.container = container;
    this.ref = ref;
    this.refEl = el;
    this.task = null;
    this.estimateSlot = h('div', { class: 'h-full w-full grow' });
    this.trackedSlot = h('div', { class: 'h-full w-full grow' });
    this.rows = [propertyRow('estimate', L.estimate, this.estimateSlot), propertyRow('tracked', L.tracked, this.trackedSlot)];
    this.mount();
    this.load();
  }
  mount() {
    if (this.rows[0].isConnected && this.rows[0].parentElement === this.container) return;
    // Debajo de «Estimate» si el proyecto lo usa; si no, al final de las propiedades
    const rows = [...this.container.children].filter((r) => !r.hasAttribute('data-time-row'));
    const anchor = rows.find((r) => /^(Estimate|Estimación|Estimaciones)$/i.test(r.firstElementChild?.textContent.trim() ?? ''));
    if (anchor) anchor.after(...this.rows); else this.container.append(...this.rows);
  }
  async load() {
    if (!workspace()) return;
    try {
      this.task = await api(`w/${encodeURIComponent(slug())}/tasks/by-ref/${encodeURIComponent(this.ref)}`);
    } catch {
      this.task = null;
    }
    this.paint();
    if (openPopover?.field === this) openPopover.fill();
  }
  // ¿Sigue siendo la misma tarea? (el panel lateral reutiliza el contenedor al pasar a otra)
  same() {
    return this.refEl ? this.refEl.isConnected && this.refEl.textContent.trim() === this.ref : urlRef() === this.ref;
  }
  paint() {
    const t = this.task;
    if (!t) { this.rows.forEach((r) => (r.hidden = true)); return; }
    this.rows.forEach((r) => (r.hidden = false));
    // Estimado: se edita en el sitio, como los demás campos de Plane
    const est = h('button', { type: 'button', class: BUTTON, disabled: !t.can_log, 'data-time-estimate': '', onclick: () => this.editEstimate(),
      'aria-label': `${L.estimate}: ${t.estimate ? fd(t.estimate) : L.none}` },
      t.estimate ? h('span', { class: 'truncate' }, fd(t.estimate)) : h('span', { class: 'truncate text-placeholder' }, L.none));
    this.estimateSlot.replaceChildren(est);

    const logged = t.team ?? t.mine; // team solo llega a administradores
    const running = timer && timer.issue_id === t.id;
    const over = t.estimate && logged > t.estimate;
    const toggle = h('button', {
      type: 'button', class: `time-play${running ? ' running' : ''}`, disabled: !t.can_log,
      'aria-label': running ? L.stop : L.start, title: running ? L.stop : L.start,
      onclick: () => (running ? stopTimer() : startTimer(t)),
    }, icon(running ? 'stop' : 'play', 'size-3'));
    const total = h('span', { class: `truncate${over ? ' time-over' : ''}` },
      running ? h('span', { class: 'time-clock', 'data-time-clock': '' }, formatClock(elapsed())) : fd(logged),
      t.estimate ? h('span', { class: 'text-placeholder' }, ` / ${fd(t.estimate)}`) : null);
    const open = h('button', { type: 'button', class: BUTTON, 'data-time-tracked': '', 'aria-haspopup': 'dialog', onclick: () => this.popover(open) }, total);
    this.trackedSlot.replaceChildren(h('div', { class: 'flex w-full items-center gap-1' }, toggle, open));
  }
  editEstimate() {
    const t = this.task;
    const input = h('input', { class: 'time-input', value: t.estimate ? fd(t.estimate) : '', placeholder: L.addHint, 'aria-label': L.estimate });
    let done = false;
    const save = async () => {
      if (done) return; done = true;
      const v = input.value.trim();
      const minutes = v ? parseDuration(v, 100000) : null;
      if (v && !minutes) { input.setAttribute('aria-invalid', 'true'); done = false; input.title = L.bad; return; }
      try { await api(`w/${encodeURIComponent(slug())}/tasks/${t.id}/estimate`, { method: 'PUT', body: { minutes } }); changed('estimate'); }
      catch (e) { alert(e.message); this.paint(); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { done = true; this.paint(); }
    });
    input.addEventListener('blur', save);
    this.estimateSlot.replaceChildren(input);
    input.focus(); input.select();
  }
  // Detalle del tiempo: entradas y registro manual, como el desplegable de ClickUp
  popover(anchor) {
    openPopover?.close();
    const t = this.task;
    const dur = h('input', { class: 'time-input', placeholder: L.addHint, 'aria-label': L.addHint });
    const day = h('input', { class: 'time-input', type: 'date', value: localDay(), max: localDay(), 'aria-label': L.day });
    const note = h('input', { class: 'time-input', placeholder: L.note, maxlength: 500, 'aria-label': L.note });
    const add = async (e) => {
      e.preventDefault();
      const minutes = parseDuration(dur.value);
      if (!minutes) { dur.setAttribute('aria-invalid', 'true'); dur.focus(); return; }
      try {
        await api(`w/${encodeURIComponent(slug())}/entries`, { method: 'POST', body: { issue_id: t.id, day: day.value, minutes, note: note.value } });
        dur.value = ''; note.value = '';
        changed();
      } catch (err) { alert(err.message); }
    };
    const list = h('ul', { class: 'time-entries' });
    const fill = () => list.replaceChildren(...(this.task.entries.length ? this.task.entries.map((e) => h('li', null,
      h('span', { class: 'time-entry-main' }, h('b', null, fd(e.minutes)), ' ', h('span', { class: 'text-tertiary' }, `${e.day}${e.user_id === me.user.id ? '' : ` · ${e.person}`}`)),
      e.note ? h('span', { class: 'time-entry-note text-tertiary' }, e.note) : null,
      e.user_id === me.user.id ? h('button', { type: 'button', class: 'time-link', onclick: async () => {
        await api(`w/${encodeURIComponent(slug())}/entries/${e.id}`, { method: 'DELETE', body: {} }).catch((err) => alert(err.message));
        changed();
      } }, L.del) : null)) : [h('li', { class: 'text-tertiary' }, L.empty)]));
    fill();
    const box = h('div', { class: 'time-popover', role: 'dialog', 'aria-label': L.tracked },
      t.can_log ? h('form', { class: 'time-add', onsubmit: add }, dur, day, note, h('button', { type: 'submit', class: 'time-primary' }, L.add)) : null,
      list);
    const r = anchor.getBoundingClientRect();
    box.style.top = `${Math.min(r.bottom + 4, innerHeight - 320)}px`;
    box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 348))}px`;
    document.body.append(box);
    const onDoc = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
    const close = () => { box.remove(); document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); openPopover = null; };
    setTimeout(() => document.addEventListener('mousedown', onDoc));
    document.addEventListener('keydown', onKey);
    openPopover = { close, fill, field: this };
    if (t.can_log) dur.focus();
  }
}

async function startTimer(task) {
  try {
    timer = await api(`w/${encodeURIComponent(slug())}/timer/start`, { method: 'POST', body: { issue_id: task.id, day: localDay() } });
    offset = Date.parse(timer.server_now) - Date.now();
    changed('timer');
  } catch (e) { alert(e.message); }
}
async function stopTimer() {
  if (!timer) return;
  try { await api(`w/${encodeURIComponent(timer.slug)}/timer/stop`, { method: 'POST', body: {} }); timer = null; changed('timer'); }
  catch (e) { alert(e.message); }
}

// ---------- reloj en la cabecera ----------
let pill = null;
function paintHeader() {
  const bell = document.querySelector('a[href$="/notifications/"]');
  if (!timer || !bell) { pill?.remove(); pill = null; return; }
  if (pill?.dataset.timer !== timer.id) pill = h('div', { class: 'time-pill', role: 'status', 'aria-label': L.running, 'data-timer': timer.id },
    h('span', { class: 'time-dot', 'aria-hidden': 'true' }),
    h('a', { href: `/${encodeURIComponent(timer.slug)}/browse/${timer.ref}/`, class: 'time-pill-task', title: timer.name }, timer.ref),
    h('span', { class: 'time-clock', 'data-time-clock': '' }, formatClock(elapsed())),
    h('button', { type: 'button', class: 'time-play running', 'aria-label': L.stop, title: L.stop, onclick: stopTimer }, icon('stop', 'size-3')));
  const bar = bell.parentElement;
  if (pill.parentElement !== bar) { document.querySelector('.time-pill')?.remove(); bar.prepend(pill); }
}
setInterval(() => {
  if (!timer) return;
  for (const c of document.querySelectorAll('[data-time-clock]')) c.textContent = formatClock(elapsed());
}, 1000);

// ---------- «Carga de trabajo» en la barra lateral ----------
let overlay = null;
const viewParam = () => new URLSearchParams(location.search).get('tiempo');

function paintSidebar() {
  const s = slug();
  if (!workspace()) return;
  const projects = document.querySelector(`a[href="/${CSS.escape(s)}/projects/"]`);
  if (!projects || projects.parentElement.querySelector('[data-time-nav]')) return;
  const item = projects.cloneNode(true);
  item.setAttribute('href', `/${encodeURIComponent(s)}/?tiempo=carga`);
  item.setAttribute('data-time-nav', '');
  item.removeAttribute('data-discover');
  item.querySelector('svg')?.replaceWith(icon('load', 'size-4 flex-shrink-0'));
  const text = [...item.querySelectorAll('*')].find((e) => !e.children.length && e.textContent.trim());
  if (text) text.textContent = L.workload;
  item.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    // Como un enlace de Plane: su router (React Router) cambia de página al recibir el popstate
    history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: (history.state?.idx ?? 0) + 1 }, '', item.getAttribute('href'));
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
  projects.after(item);
}

// Panel de contenido de Plane (a la derecha de la barra lateral): el <main> que no contiene otro
const contentPane = () => [...document.querySelectorAll('main')].find((m) => !m.querySelector('main'));
function route() {
  const nav = document.querySelector('[data-time-nav]');
  const view = viewParam();
  nav?.toggleAttribute('aria-current', !!view);
  // Debajo queda el Inicio de Plane: que su enlace no parezca el activo
  document.querySelector(`a[href="/${CSS.escape(slug())}/"]`)?.toggleAttribute('data-time-muted', !!view);
  if (!view || !workspace()) { overlay?.remove(); overlay = null; return; }
  const main = contentPane();
  if (!main) return;
  const src = `/time/?embed=1#/${encodeURIComponent(slug())}/${view.replace(/[^a-z]/g, '')}`;
  if (!overlay) {
    overlay = h('iframe', { class: 'time-frame', title: L.workload, src });
    document.body.append(overlay);
  }
  resized.observe(main); // p. ej. al plegar la barra lateral
  const r = main.getBoundingClientRect();
  Object.assign(overlay.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
}
// Plane navega sin recargar: se vigila el cambio de dirección
for (const fn of ['pushState', 'replaceState']) {
  const orig = history[fn];
  history[fn] = function (...args) { const out = orig.apply(this, args); queueMicrotask(scan); return out; };
}
addEventListener('popstate', scan);
const resized = new ResizeObserver(() => overlay && route());

// ---------- barrido: cada vez que Plane cambia la página ----------
let lastPath = '';
let pending = false;
async function scan() {
  pending = false;
  if (!/^\/[^/]+\//.test(location.pathname) || location.pathname.startsWith('/time/') || location.pathname.startsWith('/god-mode')) return;
  if (location.pathname !== lastPath && !me) { lastPath = location.pathname; await session(); if (me) loadTimer(); }
  if (!me) return;

  // Idioma de Plane: el de su propia barra lateral
  const projects = document.querySelector('a[href$="/projects/"]');
  if (projects) L = /Proyectos/.test(projects.textContent) ? T.es : T.en;

  // Paneles de propiedades de tareas: filas con la columna de etiqueta de Plane (w-30)
  const containers = new Set();
  for (const label of document.querySelectorAll('div.w-30.shrink-0')) {
    const row = label.parentElement;
    if (row && !row.hasAttribute('data-time-row') && row.parentElement) containers.add(row.parentElement);
  }
  for (const container of containers) {
    const f = fields.get(container);
    if (f && f.same()) { f.mount(); continue; }
    const found = refOf(container);
    if (!found) continue;
    f?.rows.forEach((r) => r.remove());
    fields.set(container, new Field(container, found));
  }
  for (const [c, f] of fields) if (!c.isConnected) fields.delete(c);
  paintSidebar();
  paintHeader();
  route();
}
// Solo los cambios de Plane: los nuestros (reloj que avanza, filas, píldora) no vuelven a barrer
const OURS = '[data-time-row], .time-pill, .time-popover, [data-time-nav], .time-frame';
const ours = (n) => (n.nodeType === 1 ? n : n.parentElement)?.closest(OURS);
new MutationObserver((records) => {
  if (pending || records.every((r) => ours(r.target) || [...r.addedNodes, ...r.removedNodes].every(ours))) return;
  pending = true;
  requestAnimationFrame(scan);
}).observe(document, { childList: true, subtree: true }); // el documento entero: Plane rehace hasta el <html> al arrancar
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) refreshAll(); });
scan();
