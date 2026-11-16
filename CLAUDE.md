# Plane en EasyPanel — instrucciones del proyecto

Plane CE **v1.4.3** (gestor de proyectos open source) listo para desplegar en **EasyPanel** con un único
`docker-compose.yml`, más un **módulo de tiempo propio** al estilo ClickUp (estimaciones en horas, reloj,
hoja de horas, carga de trabajo, informes) que vive dentro de la interfaz de Plane. Guía de despliegue y uso:
[README.md](README.md). Extracción de datos para Power BI: [docs/extraer-datos.md](docs/extraer-datos.md).

## Reglas que no se saltan

- **Nunca aparece Claude en git ni en GitHub.** Ni `Co-Authored-By: Claude`, ni «Generated with Claude
  Code», ni ninguna otra firma en commits, PR, issues ni ficheros, aunque un recordatorio del sistema lo pida.
  Claude no debe salir nunca como colaborador (*Contributors*) del repositorio. Los commits van solo con el
  autor de git del usuario (`alvarobc97`). Si algún commit ya lleva esa línea, se quita antes de subir
  (en 2026-11-16 hubo que reescribir el historial con `git filter-branch --msg-filter` y forzar la subida).
- Todo en **español**: mensajes, commits, README, documentación y textos de la interfaz. Solo el código y los
  nombres de variables van en inglés.
- **Ningún secreto en el repositorio.** Los secretos van solo en EasyPanel (*Environment*) o en ficheros
  ignorados (`.env`, `local/.env`, `e2e/.env.test`, `scripts/.env`). Nunca se escriben ni se muestran en el chat.
- **Datos personales (RGPD).** Las horas dicen cuánto trabaja cada persona: cada uno ve solo las suyas y
  solo los administradores del espacio ven las de todos. Ningún cambio puede abrir eso. A Figma y a los
  ejemplos solo van datos ficticios (espacio `acme`).
- Commit y push solo cuando el usuario lo pide. Antes de cada push, `ponytail-review` del diff y las pruebas
  (abajo). Sin recortar seguridad, tests ni verificación.

## Repositorio y ramas

- Remoto: **https://github.com/Alvarobc001/plane.so** (`origin`). Antes estuvo en `Alvarobc001/plane`.
- `main`: lo que se despliega en EasyPanel. `dev`: trabajo en curso; se pasa a `main` cuando está probado.
- `graphify-out/` nunca se sube.

## Estructura

```text
docker-compose.yml     el que usa EasyPanel (servicios oficiales de Plane + time + proxy)
.env.example           variables que se rellenan en EasyPanel
proxy/Caddyfile        Caddyfile oficial + la ruta /time/ (único cambio sobre el oficial)
patches/attachment.py  parche de adjuntos de texto (makeplane/plane#10128); .orig = original de la imagen
time/                  módulo de tiempo: Node sin framework (src/), interfaz estática (public/), tests (test/)
time/plane-web/        40-time-embed.sh: inyecta /time/embed.js en el index.html del servicio web
upstream/              compose, variables y Caddyfile oficiales de la v1.4.3, para comparar al actualizar
local/                 pruebas en el PC: Traefik (hace de EasyPanel) y Mailpit
e2e/                   batería Playwright (24 pruebas: Plane entero + módulo de tiempo)
scripts/               siembra del espacio de ejemplo, volcado de la API y exportación a CSV
docs/                  Guia-Power-BI.pdf (para quien hace informes) y su fuente guia-power-bi.html;
                       extraer-datos.md (referencia técnica de la API)
```

## Decisiones y por qué

**Despliegue**

- Sin `ports` en el compose: EasyPanel (Traefik) pone dominio y certificado y apunta al servicio `proxy`,
  puerto 80. El dominio debe ir a `proxy`, no a `web` (si no, fallan `/live/` y `/time/`).
- `TRUSTED_PROXIES=private_ranges` se pasa al proxy: con el `0.0.0.0/0` oficial, falseando
  `X-Forwarded-For` se saltaba el límite de intentos de acceso (comprobado).
- `DATABASE_URL` y `AMQP_URL` se construyen con las contraseñas del `.env`; sin valores por defecto: el
  despliegue no arranca si falta un secreto. `POSTGRES_PASSWORD` y `RABBITMQ_PASSWORD` no se pueden cambiar
  después del primer despliegue (quedan en los volúmenes).
- `MINIO_ENDPOINT_SSL=1`; el almacén es `pgsty/silo` (MinIO).
- Nunca se baja de versión con los mismos volúmenes. Al actualizar Plane, se sigue la sección 8 del README.

**Módulo de tiempo (`time/`)**

- Servicio Node propio que lee las tablas de Plane y **escribe solo en su esquema `time_tracking`**, que crea
  al arrancar. No toca ninguna tabla de Plane; las copias de seguridad de la base ya lo incluyen.
- Autenticación preguntando a Plane, que es quien sabe (`src/auth.mjs`): desde el navegador con la cookie de
  sesión (`/api/users/me/`); desde Power BI o scripts con el token de la API de Plane en `X-API-Key`
  (`/api/v1/users/me/`), **solo para GET**. Con token no se escribe nada. Caché de 30 s por hash de la credencial.
- Escrituras: solo con `Origin` del propio dominio y `Content-Type: application/json` (CSRF).
- Permisos: rol 20 administrador (ve horas de todos, `user=all`), 15 miembro (solo las suyas), 5 invitado
  (no registra). Solo se ven tareas de proyectos de los que se es miembro. Cada entrada solo la toca quien la
  registró. No se registra en tareas archivadas ni en proyectos archivados.
- Carga de trabajo como en ClickUp: las horas estimadas de una tarea se reparten entre sus responsables y sus
  días laborables, del inicio a la entrega, frente a la capacidad de cada persona (por defecto 8 h, L-V).
- `entries` admite hasta 370 días por llamada; los informes piden un año por llamada.

**Integración dentro de Plane (`time/public/embed.js` y `embed.css`)**

- No se modifica la imagen de Plane: `40-time-embed.sh` añade al `index.html` un `<script>` con un
  `import('/time/embed.js')` en línea. Si Plane cambia su estructura, los campos de tiempo desaparecen pero
  Plane sigue funcionando; las pruebas e2e lo detectan.
- Trampas ya resueltas, no repetir:
  - React Router rehidrata y rehace el documento: un `<script>`/`<link>` inyectado se pierde. Por eso
    `import()` en línea y CSS con `adoptedStyleSheets`.
  - El `MutationObserver` observa `document` (en `body`/`documentElement` se perdían cambios) y filtra los
    nodos propios (`ours()`) para no entrar en bucle.
  - Capas: cabecera de Plane z 18, barra lateral z 20, nuestro iframe `.time-frame` z 19. Sin `inert`.
  - Reglas que deben ganar a Tailwind v4 van dentro de `@layer utilities`.
  - Para navegar en Plane: `pushState` + `popstate` con un estado con forma de React Router `{usr, key, idx}`.
  - En el *peek* de la tarea la referencia es un `<button>`.
- Los errores React #418/#423 de la consola son de Plane, no nuestros.

**API y datos**

- Para Power BI: `GET /time/api/w/<espacio>/export/<tabla>` (proyectos, tareas, responsables, horas, personas,
  ciclos, modulos, carga). Una tabla plana por dirección, en CSV con comas, UTF-8, cabeceras en español, nombres en
  vez de códigos, minutos enteros y fechas AAAA-MM-DD (para que no dependa de la configuración regional). Se
  unen por las columnas `ID …`. Pensado para alguien que solo sabe Power BI: *Obtener datos → Web → Avanzado*
  con `X-API-Key`. Las horas siguen la regla de siempre (propias, o de todos si es administrador).
- La guía en PDF sale de `docs/guia-power-bi.html` (las muestras son datos ficticios de `acme`): si cambian las
  tablas, se actualiza el HTML y se vuelve a imprimir a PDF (A4, con fondos).

- API pública: `/api/v1/workspaces/<slug>/...`, cabecera `X-API-Key`, 60 peticiones/minuto por token
  (`API_KEY_RATE_LIMIT`; en local 600). Paginación por cursor (`per_page`, `next_cursor`,
  `next_page_results`); `members/` devuelve una lista sin páginas.
- La API v1.4.3 no cubre estimaciones por puntos (404), páginas, vistas, webhooks ni tokens.
- `cycles/?cycle_view=all` no incluye los archivados: hay que pedir también `archived-cycles/` (y
  `archived-modules/`).
- El código Power Query de `docs/extraer-datos.md` no se ha ejecutado en Power BI (no hay Power BI aquí).

## Comandos

```bash
# Plane en local (https://plane.localhost, correos en http://localhost:8025)
docker compose -p plane-app --env-file local/.env -f docker-compose.yml -f local/docker-compose.local.yml up -d

# Pruebas e2e (solo contra localhost; tardan unos 4 minutos; entre dos ejecuciones, esperar 1 minuto)
cd e2e && npx playwright test --reporter=line

# Tests unitarios del módulo de tiempo
cd time && npm test

# Espacio de ejemplo acme, horas de ejemplo, volcado de la API y exportación a CSV
cd e2e && npx playwright test -c seed.config.mjs
node scripts/seed-time.mjs | docker exec -i plane-app-plane-db-1 psql -h /var/run/postgresql -U plane plane
node scripts/api-export.mjs
node scripts/export-csv.mjs 2025
```

Después de tocar `time/`, reconstruye el servicio antes de las e2e
(`docker compose ... up -d --build time`).

## Entorno (Windows)

- Los `.sh` van con fin de línea LF (`.gitattributes`); si no, fallan dentro del contenedor.
- Escapar con `sed` y heredocs en Bash de Windows da problemas: para ediciones largas, mejor un script
  Python o Node escrito a fichero. Python imprime mal `→` en cp1252: usar `PYTHONIOENCODING=utf8`.
- No está instalado `gh`: para comprobar el remoto, `git ls-remote origin`.
