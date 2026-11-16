// Quién hace la petición: se pregunta a Plane con la misma cookie de sesión del navegador.
// El módulo vive en el mismo dominio (/time/), así que no hay segundo login ni claves de API.
import { createHash } from 'node:crypto';
import { one } from './db.mjs';

const PLANE = process.env.PLANE_API_URL || 'http://api:8000';
const cache = new Map(); // hash de la cookie -> { user, until }
const TTL = 30_000;

export async function currentUser(cookie) {
  if (!cookie || !/session-id=/.test(cookie)) return null;
  const key = createHash('sha256').update(cookie).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.user;

  const r = await fetch(`${PLANE}/api/users/me/`, { headers: { cookie, accept: 'application/json' } });
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
