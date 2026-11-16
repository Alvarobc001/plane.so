// Servidor del módulo de tiempo: sirve la interfaz en /time/ y la API en /time/api/.
// Detrás del proxy de Plane, en el mismo dominio, para compartir su sesión.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, q } from './db.mjs';
import { currentUser, membership } from './auth.mjs';
import { routes, HttpError } from './api.mjs';

const PORT = Number(process.env.PORT || 3000);
const ORIGIN = process.env.APP_ORIGIN; // https://plane.tudominio.com
if (!ORIGIN) throw new Error('Falta APP_ORIGIN');
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY,
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body ?? null) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new HttpError(413, 'Petición demasiado grande');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'JSON no válido');
  }
}

// Busca la ruta: "/time/api/w/<espacio>/entries/<id>" -> 'PATCH entries/:id' con params.id
function match(method, rest) {
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const a = pattern.split('/');
    const b = rest.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    if (a.every((part, i) => (part.startsWith(':') ? ((params[part.slice(1)] = decodeURIComponent(b[i])), true) : part === b[i]))) {
      return { handler: routes[key], params };
    }
  }
  return null;
}

async function api(req, res, url) {
  // Las escrituras usan la cookie de sesión: solo se aceptan desde el propio dominio y en JSON (CSRF)
  if (req.method !== 'GET') {
    if (req.headers.origin !== ORIGIN) throw new HttpError(403, 'Origen no permitido');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Se espera JSON');
  }
  const user = await currentUser(req.headers.cookie);
  if (!user) throw new HttpError(401, 'Inicia sesión en Plane');

  const parts = url.pathname.replace(/^\/time\/api\/|\/$/g, '').split('/');
  if (parts[0] === 'me' && parts.length === 1 && req.method === 'GET') {
    const workspaces = await q(
      `select w.slug, w.name, wm.role from workspaces w join workspace_members wm on wm.workspace_id = w.id
        where wm.member_id = $1 and wm.is_active and wm.deleted_at is null and w.deleted_at is null order by w.name`,
      [user.id]);
    return { user, workspaces };
  }
  // El reloj es de la persona, no del espacio: se consulta fuera de /w/<espacio>/
  if (parts[0] === 'timer' && parts.length === 1 && req.method === 'GET') return routes['GET timer']({ user });
  if (parts[0] !== 'w' || parts.length < 3) throw new HttpError(404, 'Ruta no encontrada');
  const ws = await membership(user.id, parts[1]);
  if (!ws) throw new HttpError(404, 'Espacio de trabajo no encontrado');
  const found = match(req.method, parts.slice(2).join('/'));
  if (!found) throw new HttpError(404, 'Ruta no encontrada');

  const ctx = {
    user, ws, admin: ws.role >= 20, params: found.params,
    query: Object.fromEntries(url.searchParams), body: req.method === 'GET' ? {} : await readJson(req),
  };
  return found.handler(ctx);
}

async function file(res, pathname) {
  const rel = pathname.replace(/^\/time\/?/, '') || 'index.html';
  const full = path.normalize(path.join(PUBLIC, rel));
  if (!full.startsWith(PUBLIC + path.sep)) return send(res, 404, 'No encontrado');
  try {
    const data = await fs.readFile(full);
    send(res, 200, data, {
      'Content-Type': TYPES[path.extname(full)] ?? 'application/octet-stream',
      'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=300',
    });
  } catch {
    send(res, 404, 'No encontrado');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname === '/time/healthz') return send(res, 200, 'ok');
    if (url.pathname.startsWith('/time/api/')) {
      const out = await api(req, res, url);
      if (out && typeof out.csv === 'string') {
        return send(res, 200, out.csv, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="horas-${url.searchParams.get('from')}-${url.searchParams.get('to')}.csv"`,
        });
      }
      return send(res, 200, out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return file(res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(new Date().toISOString(), req.method, url.pathname, e);
    return send(res, 500, { error: 'Error interno; inténtalo de nuevo' });
  }
});

await migrate();
server.listen(PORT, () => console.log(`Módulo de tiempo escuchando en :${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
