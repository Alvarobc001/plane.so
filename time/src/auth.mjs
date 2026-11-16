// Quién hace la petición. Se pregunta a Plane, que es quien sabe:
//  - desde el navegador, con la misma cookie de sesión (el módulo vive en el mismo dominio, /time/);
//  - desde Power BI, Excel o un script, con un token de la API de Plane en la cabecera X-API-Key,
//    solo para lecturas (GET): con un token no se puede escribir nada.
import { createHash } from 'node:crypto';
import { one } from './db.mjs';

const PLANE = process.env.PLANE_API_URL || 'http://api:8000';
const cache = new Map(); // hash de la credencial -> { user, until }
const TTL = 30_000;

export async function currentUser(headers, method) {
  const token = headers['x-api-key'];
  if (token && method === 'GET') return whoIs('/api/v1/users/me/', { 'x-api-key': token });
  if (!headers.cookie || !/session-id=/.test(headers.cookie)) return null;
  return whoIs('/api/users/me/', { cookie: headers.cookie });
}

async function whoIs(path, credential) {
  const key = createHash('sha256').update(path + Object.values(credential)[0]).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.user;

  const r = await fetch(`${PLANE}${path}`, { headers: { ...credential, accept: 'application/json' } });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`Plane respondió ${r.status} al pedir el usuario`);
  const u = await r.json();
  const user = { id: u.id, email: u.email, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.display_name };

  if (cache.size > 2000) cache.clear();
  cache.set(key, { user, until: Date.now() + TTL });
  return user;
}

// Rol de la persona en el espacio (20 admin, 15 miembro, 5 invitado) o null si no pertenece
export async function membership(userId, slug) {
  return one(
    `select w.id as workspace_id, w.slug, w.name, wm.role
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where w.slug = $1 and w.deleted_at is null
        and wm.member_id = $2 and wm.is_active and wm.deleted_at is null`,
    [slug, userId],
  );
}
