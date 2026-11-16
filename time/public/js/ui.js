// Utilidades de la interfaz: construir nodos, llamar a la API, iconos y formatos.

// h('div', { class: 'x', onclick }, hijo, 'texto', [más hijos]) — nunca usa innerHTML con datos
export function h(tag, attrs = {}, ...children) {
  const el = document.createElementNS(tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'rect' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Iconos de trazo (24x24, 1.5 px), del mismo estilo que los de Plane
const PATHS = {
  load: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sheet: 'M3 5h18v15H3zM3 10h18M8 5V3M16 5V3M8 14h2M14 14h2M8 17h2',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  report: 'M4 4h16v16H4zM8 15v2M12 11v6M16 8v9',
  capacity: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
};
export function icon(name, label) {
  const svg = h('svg', { viewBox: '0 0 24 24', class: 'icon', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': label ? null : 'true', role: label ? 'img' : null, 'aria-label': label });
  svg.append(h('path', { d: PATHS[name] }));
  if (name === 'play' || name === 'stop') svg.setAttribute('fill', 'currentColor');
  return svg;
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Llamada a la API del módulo. Si la sesión de Plane caducó, vuelve al login de Plane.
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`/time/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) {
    location.href = `/?next_path=${encodeURIComponent('/time/' + location.hash)}`;
    throw new ApiError(401, 'Sesión caducada');
  }
  const type = r.headers.get('content-type') || '';
  const data = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, data?.error || `Error ${r.status}`);
  return data;
}

let toastTimer;
export function toast(message) {
  const el = document.querySelector('.toast');
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.textContent = ''), 4000);
}

// Fechas: AAAA-MM-DD en hora local
export const localDay = (d = new Date()) => d.toLocaleDateString('sv');
export function shiftDay(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}
export function mondayOf(day) {
  const d = new Date(`${day}T12:00:00`);
  return shiftDay(day, 1 - (d.getDay() || 7));
}
const fmt = (opts) => new Intl.DateTimeFormat('es-ES', opts);
export const dayShort = (day) => fmt({ weekday: 'short' }).format(new Date(`${day}T12:00:00`)).replace('.', '');
export const dayNum = (day) => Number(day.slice(8, 10));
export const dayLong = (day) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00`));
export function weekLabel(monday) {
  const sunday = shiftDay(monday, 6);
  const m = fmt({ month: 'short' });
  const a = new Date(`${monday}T12:00:00`);
  const b = new Date(`${sunday}T12:00:00`);
  const left = a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${m.format(a).replace('.', '')}`;
  return `${left}–${b.getDate()} ${m.format(b).replace('.', '')} ${b.getFullYear()}`;
}
export const shortDate = (day) => (day ? fmt({ day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`)).replace('.', '') : '—');

// Cada persona, su inicial y un tono pálido estable (identidad, no dato)
export function avatar(person) {
  let hash = 0;
  for (const c of person.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = (hash % 12) * 30;
  const initials = person.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return h('span', { class: 'avatar', 'aria-hidden': 'true', style: { background: `oklch(0.93 0.04 ${hue})`, color: `oklch(0.36 0.09 ${hue})` } }, initials);
}

export const planeTaskUrl = (slug, ref) => `/${encodeURIComponent(slug)}/browse/${encodeURIComponent(ref)}/`;
