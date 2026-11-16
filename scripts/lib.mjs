// Cliente mínimo de la API REST de Plane (/api/v1) para los scripts de este repo.
// Lee scripts/.env (PLANE_URL, PLANE_API_KEY, PLANE_WORKSPACE) o las variables de entorno.
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const envFile = new URL('./.env', import.meta.url);
if (fs.existsSync(envFile)) {
  for (const l of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].trim();
  }
}
for (const v of ['PLANE_URL', 'PLANE_API_KEY', 'PLANE_WORKSPACE']) {
  if (!process.env[v]) throw new Error(`Falta ${v} (en scripts/.env o en el entorno).`);
}
export const BASE = new URL(process.env.PLANE_URL);
export const WS = process.env.PLANE_WORKSPACE;
const KEY = process.env.PLANE_API_KEY;

// *.localhost no lo resuelve Windows y su certificado es autofirmado: solo en ese caso
// se fuerza 127.0.0.1 y se acepta el certificado.
const local = /(^|\.)localhost$/.test(BASE.hostname);
const lookup = (_h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4));

export function request(method, url, { headers = {}, body } = {}) {
  const u = new URL(url, BASE);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    if (body) headers = { ...headers, 'Content-Length': Buffer.byteLength(body) };
    const req = lib.request(u, { method, headers, ...(local && { lookup, rejectUnauthorized: false }) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let calls = 0;
export const stats = () => calls;
// Registro de cada llamada (ruta con los UUID cambiados por {id}) para el informe de endpoints
export const callLog = [];
const pattern = (p) => p.split('?')[0].replace(/^\/api\/v1\//, '')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '{id}');

// Llamada a /api/v1 con la clave. Respeta el límite de peticiones (429 + Retry-After).
export async function api(method, path, data) {
  const url = path.startsWith('http') ? path : `/api/v1/${path.replace(/^\//, '')}`;
  for (;;) {
    calls++;
    const body = data === undefined ? undefined : JSON.stringify(data);
    const res = await request(method, url, {
      headers: { 'X-API-Key': KEY, ...(body && { 'Content-Type': 'application/json' }) },
      body,
    });
    if (res.status === 429) {
      const wait = Number(res.headers['retry-after'] || 10);
      process.stdout.write(`  (límite de peticiones, espero ${wait}s)\n`);
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    callLog.push({ method, path: pattern(url), status: res.status });
    const text = res.body.toString('utf8');
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, data: json };
  }
}

// Igual que api() pero falla si la respuesta no es 2xx.
export async function must(method, path, data) {
  const r = await api(method, path, data);
  if (r.status < 200 || r.status > 299) {
    throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  return r.data;
}

// Recorre todas las páginas de un listado paginado por cursor.
export async function all(path) {
  const out = [];
  let cursor = '';
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await must('GET', `${path}${sep}per_page=100${cursor && `&cursor=${cursor}`}`);
    if (!r || !Array.isArray(r.results)) return Array.isArray(r) ? r : out.concat(r ?? []);
    out.push(...r.results);
    if (!r.next_page_results) return out;
    cursor = r.next_cursor;
  }
}
