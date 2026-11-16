# Plane en EasyPanel

[Plane](https://plane.so) Community Edition **v1.4.3** (gestión de proyectos: tareas, ciclos, módulos, páginas,
vistas, intake) preparado para desplegarse como servicio **Compose** de [EasyPanel](https://easypanel.io) desde
este repositorio de GitHub.

Está basado en el `docker-compose.yml` oficial de la release (copia sin tocar en [`upstream/`](upstream/)),
adaptado a EasyPanel y con cuatro correcciones que encontraron las pruebas automáticas (ver
[Correcciones](#correcciones-respecto-al-compose-oficial)). Añade un **módulo de tiempo** al estilo de ClickUp
(reloj por tarea, hoja de horas, carga de trabajo frente a capacidad e informes) en `https://tu-dominio/time/`,
con la misma sesión de Plane (ver [sección 6](#6-módulo-de-tiempo)). La batería de Playwright de
[`e2e/`](e2e/) pasa **21/21** sobre este mismo fichero, con un Traefik delante que hace de EasyPanel.

```
docker-compose.yml     el que despliega EasyPanel
.env.example           variables (EasyPanel lo copia a su editor)
patches/               corrección de adjuntos de texto
time/                  módulo de tiempo (servicio Node, se construye en el despliegue)
proxy/Caddyfile        el Caddyfile oficial más la ruta /time/
upstream/              compose, variables y Caddyfile oficiales de la v1.4.3, para comparar al actualizar
local/                 pruebas en tu PC: Traefik (hace de EasyPanel) y Mailpit (correo)
e2e/                   batería Playwright
scripts/               proyecto de ejemplo por la API y extracción de todos los endpoints
```

---

## 1. Servidor

Necesitas un VPS con **Ubuntu 24.04 LTS** (o 22.04) recién instalado:

| | Mínimo | Recomendado |
| --- | --- | --- |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disco | 40 GB SSD | 80 GB SSD |

EasyPanel pide 2 GB y Plane 4 GB; con los dos en la misma máquina, 8 GB van holgados.

En el panel de tu proveedor, abre en su **cortafuegos** solo los puertos **22** (SSH), **80** y **443**, y
temporalmente el **3000** (panel de EasyPanel). Hazlo en el cortafuegos del proveedor y no solo con `ufw`:
Docker publica sus puertos saltándose `ufw`.

### 1.1. Primer acceso y actualización de Ubuntu

Desde tu ordenador (cambia la IP):

```bash
ssh root@IP_DEL_SERVIDOR
```

Ya en el servidor, actualiza todo el sistema:

```bash
apt update && apt full-upgrade -y
```

Activa las actualizaciones de seguridad automáticas:

```bash
apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

Pon la zona horaria (afecta a las fechas de Plane y de los logs):

```bash
timedatectl set-timezone Europe/Madrid
```

Si el servidor tiene 4 GB o menos, añade 4 GB de swap para que no se quede sin memoria:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Si el sistema pide reiniciar (existe `/var/run/reboot-required`), reinicia y vuelve a entrar:

```bash
reboot
```

### 1.2. Usuario de administración y SSH seguro

Crea tu usuario (aquí `deploy`; usa el nombre que quieras) y dale permisos de `sudo`:

```bash
adduser deploy
```

```bash
usermod -aG sudo deploy
```

Copia tus claves SSH de `root` al nuevo usuario:

```bash
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

**Sin cerrar la sesión actual**, abre otra terminal en tu ordenador y comprueba que entras con el usuario
nuevo y que `sudo` funciona:

```bash
ssh deploy@IP_DEL_SERVIDOR
```

```bash
sudo whoami
```

Si responde `root`, desactiva el acceso de `root` y las contraseñas por SSH:

```bash
printf 'PermitRootLogin no\nPasswordAuthentication no\n' | sudo tee /etc/ssh/sshd_config.d/99-seguridad.conf
```

```bash
sudo systemctl restart ssh
```

> Si en tu ordenador no tienes clave SSH, créala antes con `ssh-keygen -t ed25519` y súbela con
> `ssh-copy-id root@IP_DEL_SERVIDOR`. Si no, al desactivar las contraseñas te quedarías fuera.

Cortafuegos del propio servidor como segunda capa, con SSH permitido antes de activarlo:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable
```

### 1.3. DNS

En tu proveedor de dominio, crea dos registros **A** apuntando a la IP del servidor:

| Nombre | Para qué |
| --- | --- |
| `plane.tudominio.com` | Plane |
| `panel.tudominio.com` | El panel de EasyPanel (opcional, recomendado) |

Comprueba que ya resuelven (puede tardar unos minutos):

```bash
getent hosts plane.tudominio.com
```

---

## 2. Instalar EasyPanel

El instalador oficial necesita `root`, instala Docker y arranca EasyPanel:

```bash
curl -sSL https://get.easypanel.io | sudo sh
```

Cuando termine, abre en el navegador `http://IP_DEL_SERVIDOR:3000` y **crea en ese momento la cuenta de
administrador** (hasta que lo hagas, cualquiera que llegue a esa URL podría crearla).

Recomendado: en **Settings** de EasyPanel, pon `panel.tudominio.com` como dominio del panel. A partir de ahí
entrarás por HTTPS y podrás **cerrar el puerto 3000** en el cortafuegos del proveedor.

---

## 3. Subir este proyecto a GitHub

En tu ordenador, crea un repositorio vacío en GitHub (puede ser privado) y, desde la carpeta del proyecto:

```bash
git remote add origin git@github.com:TU_USUARIO/plane-easypanel.git
```

```bash
git push -u origin main
```

El repositorio no contiene ninguna clave: los secretos van solo en EasyPanel.

---

## 4. Desplegar Plane en EasyPanel

### 4.1. Crear el servicio

1. **Create project** → por ejemplo `plane`.
2. Dentro del proyecto: **+ Service** → **Compose**, con nombre `plane`.
3. Pestaña **Source** → **Git**:
   - **Repository URL**: la de tu repositorio (`https://github.com/TU_USUARIO/plane-easypanel.git`, o la
     SSH si es privado).
   - **Branch**: `main`
   - **Build Path**: `/`
   - **Docker Compose File**: `docker-compose.yml`
   - Si el repositorio es **privado**, EasyPanel te mostrará una clave SSH: añádela en GitHub en
     *Settings → Deploy keys* del repositorio (solo lectura).
4. Guarda.

### 4.2. Variables de entorno

En la pestaña **Environment**, EasyPanel carga el contenido de [`.env.example`](.env.example). Deja
activado **Create .env file** y:

1. Pon tu subdominio en `APP_DOMAIN` (sin `https://`), por ejemplo `APP_DOMAIN=plane.tudominio.com`.
2. Genera los secretos en el servidor (por SSH) con este comando, que imprime las seis líneas ya listas para
   pegar:

   ```bash
   for v in POSTGRES_PASSWORD RABBITMQ_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY SECRET_KEY LIVE_SERVER_SECRET_KEY; do echo "$v=$(openssl rand -hex 24)"; done
   ```

3. Sustituye en el editor las seis líneas vacías por las generadas y guarda.
4. Guarda también una copia de esas claves en tu gestor de contraseñas. **`POSTGRES_PASSWORD` y
   `RABBITMQ_PASSWORD` no se pueden cambiar después del primer despliegue**: quedan grabadas en los
   volúmenes de datos.

Si se queda alguna vacía, el despliegue se para con un mensaje como `Falta SECRET_KEY en el .env`.

### 4.3. Dominio

Pestaña **Domains** → **Add domain**:

- **Host**: `plane.tudominio.com`
- **HTTPS**: activado (EasyPanel pide el certificado de Let's Encrypt)
- **Service**: `proxy`
- **Port**: `80`
- **Path**: `/`

Solo se publica el servicio `proxy`; la base de datos, Redis, RabbitMQ y MinIO quedan en la red interna.

### 4.4. Desplegar

Pulsa **Deploy**. La primera vez descarga unos 2 GB de imágenes y construye la del módulo de tiempo
(`time`, menos de un minuto), y el servicio `migrator` tarda 3-4 minutos en preparar la base de datos. Al terminar, `migrator` queda **parado (exit 0)**, que es lo normal;
el resto deben estar en marcha.

Comprueba desde tu ordenador que responde (debe dar `200`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://plane.tudominio.com/api/instances/
```

---

## 5. Configurar Plane

1. **En cuanto responda**, entra en `https://plane.tudominio.com/god-mode/` y crea el **administrador de la
   instancia**. Hasta que lo hagas, el primero que llegue puede quedarse con ella. Puedes desmarcar la
   casilla de telemetría.
2. **Email** (en `god-mode`): activa el correo, pon el SMTP de tu proveedor (host, puerto, usuario,
   contraseña y seguridad TLS o SSL) y pulsa **Send test email**. Sin SMTP no funcionan las invitaciones,
   los códigos de acceso ni los avisos.
3. **Authentication**: si solo debe entrar gente invitada, desactiva **Allow anyone to sign up**; viene
   activado por defecto.
4. Entra en `https://plane.tudominio.com`, inicia sesión con el mismo correo y contraseña, y crea el espacio
   de trabajo.

### Comprobación de seguridad (opcional)

Plane limita a 10 los intentos de acceso por minuto e IP. Este comando hace 13 intentos falseando la IP de
origen; los últimos deben salir `429`. Si salen todos `200`, el proxy deja falsear la IP (ver
`TRUSTED_PROXIES` en [Correcciones](#correcciones-respecto-al-compose-oficial)):

```bash
D=plane.tudominio.com; J=$(mktemp); T=$(curl -s -c $J https://$D/auth/get-csrf-token/ | sed 's/.*"csrf_token": *"\([^"]*\)".*/\1/'); for i in $(seq 1 13); do curl -s -o /dev/null -w '%{http_code} ' -b $J -H "X-CSRFToken: $T" -H "Origin: https://$D" -H "Referer: https://$D/" -H 'Content-Type: application/json' -H "X-Forwarded-For: 198.51.100.$i" -d '{"email":"nadie@ejemplo.com"}' https://$D/auth/email-check/; done; echo
```

---

## 6. Módulo de tiempo

Plane Community no registra horas (los *worklogs* son de sus planes de pago). Este repositorio añade un
servicio `time` que lo hace al estilo de ClickUp. Se abre en `https://plane.tudominio.com/time/` con la
sesión de Plane: si no hay sesión, lleva al login de Plane y vuelve.

| Pantalla | Qué hace |
| --- | --- |
| **Carga de trabajo** | Personas × días de la semana: horas planificadas frente a su capacidad. Las horas estimadas de cada tarea se reparten entre sus responsables y sus días laborables, desde el inicio hasta la entrega. En rojo, quien va sobre capacidad y cuánto. Cada día abre el detalle de sus tareas |
| **Mis horas** | Registro manual rápido (`1:30`, `1h 30m`, `1,5` o `90m`) y la hoja semanal tarea × día, editable |
| **Tareas** | Estimación en horas de cada tarea, tiempo registrado, avance frente a lo estimado y el botón del reloj |
| **Informes** | Horas por persona, proyecto, tarea, ciclo, módulo o día, en cualquier periodo, y exportación a CSV (Excel en español) |
| **Capacidad** | Horas al día y días laborables de cada persona (por defecto, 8 h de lunes a viernes) |

El **reloj** está siempre en la barra superior: se empieza en cualquier tarea, sigue corriendo aunque cierres
la pestaña o cambies de dispositivo (vive en el servidor) y al pararlo registra el tiempo. Empezar otra tarea
para la anterior.

**Desde una tarea de Plane**, este marcador del navegador abre el módulo y propone empezar el reloj en esa
tarea (crea un marcador nuevo y pega esto como URL):

```text
javascript:(()=>{const m=location.pathname.match(/^\/([^/]+)\/browse\/([A-Za-z0-9]+-\d+)/);if(!m)return alert('Abre antes una tarea de Plane (…/browse/CLAVE-123/)');open('/time/#/'+m[1]+'/tareas?start='+m[2])})()
```

**Permisos y datos personales.** Las horas registradas dicen cuánto trabaja cada persona, así que:

- cada persona ve solo sus horas; los **administradores del espacio** ven las de todo el equipo;
- solo se ven tareas de proyectos de los que se es miembro, y los invitados no registran horas;
- cada entrada solo la edita o borra quien la registró;
- las escrituras solo se aceptan desde el propio dominio (protección CSRF).

Los datos van en la misma base de datos de Plane, en un esquema aparte (`time_tracking`) que el servicio crea
al arrancar. No toca ninguna tabla de Plane, y las copias de la sección 7 ya lo incluyen.

---

## 7. Copias de seguridad

Ejecuta los comandos como `root` en el servidor (`sudo -i`). Para que sea diario, añádelos con
`crontab -e`.

Base de datos, comprimida, con la fecha en el nombre:

```bash
mkdir -p /var/backups/plane && docker exec $(docker ps -qf name=plane-db) pg_dump -h /var/run/postgresql -U plane plane | gzip > /var/backups/plane/db-$(date +%F).sql.gz
```

La copia incluye las horas del módulo de tiempo (esquema `time_tracking`). Comprueba que tiene datos
(debe salir un número mayor de 100; si sale 0, la copia está vacía):

```bash
gzip -dc /var/backups/plane/db-$(date +%F).sql.gz | grep -c 'CREATE TABLE'
```

Archivos adjuntos (volumen de MinIO):

```bash
docker run --rm -v $(docker volume ls -q | grep '_uploads$'):/data:ro -v /var/backups/plane:/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Guarda también una copia del `.env` de EasyPanel. Sin `SECRET_KEY` y las contraseñas, la copia de la base
de datos no sirve. Lleva las copias fuera del servidor (otro proveedor, S3, etc.).

---

## 8. Actualizar

- **Ubuntu**: las actualizaciones de seguridad se aplican solas. De vez en cuando:
  `sudo apt update && sudo apt full-upgrade -y`, y reinicia si hace falta.
- **EasyPanel**: se actualiza desde su propio panel (*Settings*).
- **Plane**: haz copia de seguridad y luego:
  1. Descarga el `docker-compose.yml` y el `variables.env` de la nueva release
     ([releases de Plane](https://github.com/makeplane/plane/releases)) en `upstream/` y compáralos con los
     anteriores (`git diff upstream/`).
  2. Lleva a `docker-compose.yml` los cambios: etiquetas de imagen `v1.4.3` → nueva versión, y variables o
     servicios nuevos.
  3. Comprueba si sigue haciendo falta el parche: si la release ya incluye
     [makeplane/plane#10167](https://github.com/makeplane/plane/pull/10167), quita la línea de
     `patches/attachment.py` del servicio `api`. Si no, compara `patches/attachment.py.orig` con el fichero
     de la imagen nueva antes de mantenerlo.
  4. Compara el Caddyfile del proxy nuevo con el anterior y, si cambió, lleva sus cambios a
     `proxy/Caddyfile` conservando las líneas de `/time` (la ruta del módulo de tiempo es el único cambio
     sobre el oficial):

     ```bash
     docker run --rm makeplane/plane-proxy:vX.Y.Z cat /etc/caddy/Caddyfile > upstream/Caddyfile && git diff upstream/Caddyfile
     ```

  5. Pasa las pruebas en local (sección 10), haz `git push` y pulsa **Deploy** en EasyPanel.

Nunca bajes de versión con los mismos volúmenes: las migraciones de la base de datos no se deshacen.

---

## Correcciones respecto al compose oficial

| Problema en el oficial | Efecto | Qué hace este repositorio |
| --- | --- | --- |
| Publica los puertos 80 y 443 y lleva su propio HTTPS | Choca con el Traefik de EasyPanel | Sin `ports`: Caddy escucha en `:80` dentro de la red y EasyPanel pone el dominio y el certificado |
| `TRUSTED_PROXIES` no llega al proxy, que se queda en `0.0.0.0/0` | Falseando `X-Forwarded-For` se salta el límite de intentos de acceso: permite probar contraseñas sin límite (comprobado) | Se pasa al proxy con `private_ranges`: solo se fía del Traefik de la red interna. Si pones **Cloudflare** u otro proxy delante, añade sus rangos de IP |
| Los adjuntos `.txt`, `.md`, `.csv`, `.json` y `.log` se rechazan con *Invalid file type* ([makeplane/plane#10128](https://github.com/makeplane/plane/issues/10128), abierto) | El frontend deduce el tipo por la firma binaria y los ficheros de texto no tienen | [`patches/attachment.py`](patches/attachment.py): si el tipo llega vacío, se deduce por la extensión y se sigue validando contra la lista blanca de Plane |
| `DATABASE_URL` y `AMQP_URL` fijos con `plane:plane` | Al cambiar las contraseñas, la API no conecta | Se construyen con las contraseñas del `.env` |
| `MINIO_ENDPOINT_SSL=0` | Con HTTPS, las subidas van a `http://` y el navegador las bloquea | Fijado a `1` |
| Contraseñas por defecto (`plane`, `secret-key`…) | Instalación insegura si no se cambian | Sin valores por defecto: el despliegue no arranca hasta que se rellenan |

### Fallos menores de Plane v1.4.3 que no se han tocado

- Con 10 intentos de acceso en un minuto, el botón *Continue* deja de responder sin mostrar ningún aviso.
  Espera un minuto.
- Al aceptar una invitación sin sesión iniciada, se pierden los datos del enlace. La invitación aparece
  igualmente en el onboarding después de registrarse.
- En la versión de texto plano del correo de invitación, el enlace sale con `&amp;`.
- *Generate token* no hace nada si no se elige caducidad o *Never expires*.
- Algunos botones de icono no tienen etiqueta accesible, y hay textos sin traducir
  (`aria_labels.app_sidebar...`).

---

## 9. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| El despliegue falla con `Falta ... en el .env` | Hay un secreto vacío en *Environment* |
| `502`/`404` en el dominio | El dominio no apunta al servicio `proxy` puerto `80`, o `migrator` aún no ha terminado |
| La API reinicia en bucle con error de Postgres | Se cambió `POSTGRES_PASSWORD` después del primer despliegue |
| No se suben imágenes ni adjuntos | `APP_DOMAIN` no coincide con el dominio real |
| Las páginas no guardan o no colaboran en tiempo real | El dominio debe apuntar a `proxy` (que enruta `/live/`), no a `web` |
| No llegan correos | SMTP sin configurar o mal configurado en `god-mode` → *Email* |
| Webhooks a una IP privada rechazados | Es la protección contra SSRF; añade el host a `WEBHOOK_ALLOWED_HOSTS` |
| `/time/` da `502` | El servicio `time` no arrancó: mira sus logs (espera a la base de datos hasta 1 minuto) |

Logs de un servicio: en EasyPanel, pestaña **Logs** del servicio, o por SSH:

```bash
docker logs --tail 100 $(docker ps -qf name=-api-1)
```

---

## 10. Probar en tu PC antes de desplegar (opcional)

Requiere Docker Desktop y Node.js. Usa el mismo `docker-compose.yml` que EasyPanel, con Traefik haciendo de
EasyPanel (HTTPS en `https://plane.localhost` con certificado autofirmado) y Mailpit recogiendo los correos
en `http://localhost:8025`.

1. Copia `local/.env.example` a `local/.env` y rellena los secretos (mismo comando de la sección 4.2).
2. Arranca:

   ```bash
   docker compose -p plane-app --env-file local/.env -f docker-compose.yml -f local/docker-compose.local.yml up -d
   ```

3. Copia `e2e/.env.test.example` a `e2e/.env.test`, pon contraseñas de prueba y lanza la batería:

   ```bash
   cd e2e && npm ci && npx playwright install chromium && npx playwright test
   ```

La batería recorre todo Plane: administración, SMTP, onboarding, proyectos, tareas con adjuntos, los cinco
diseños, ciclos, módulos, vistas, páginas en tiempo real, intake, archivado, publicación, búsqueda,
analítica, invitaciones con notificaciones, API REST y webhooks. Solo se ejecuta contra `localhost`, porque
cambia el SMTP a Mailpit y crea datos de prueba, así que no puede apuntarse a producción por error. Entre
dos ejecuciones seguidas espera un minuto, por el límite de intentos de acceso.

### Proyecto de ejemplo y extracción por la API

Para ver Plane y el módulo de tiempo con datos, hay un espacio de ejemplo `acme`, con datos **ficticios**:

- el proyecto *App de Reservas*: 4 sprints (ciclos), 4 fases (módulos) y 29 tareas con responsables, estados,
  prioridades, etiquetas, fechas, subtareas, relaciones, comentarios, enlaces, adjuntos e intake;
- hitos (tareas con la etiqueta *Hito*), estimaciones, páginas y vistas;
- un segundo proyecto de marketing;
- 4 personas, con la contraseña `MEMBER_PASSWORD` de `e2e/.env.test`.

1. Crea un token de la API en Plane (avatar → *Settings* → *Personal access tokens*) y ponlo en
   `scripts/.env` (copia de [`scripts/.env.example`](scripts/.env.example)). Después crea el espacio y el
   equipo, y siembra el resto por la API:

   ```bash
   cd e2e && npx playwright test -c seed.config.mjs
   ```

2. Carga las estimaciones y el historial de horas del módulo de tiempo:

   ```bash
   node scripts/seed-time.mjs | docker exec -i plane-app-plane-db-1 psql -h /var/run/postgresql -U plane plane
   ```

3. Lee todo el espacio por la API pública y genera `scripts/export/<espacio>/informe.md`, con cada endpoint,
   su estado y sus datos. Solo hace peticiones `GET`, así que también sirve contra producción con su propio
   token:

   ```bash
   node scripts/api-export.mjs
   ```

La API pública de Plane v1.4.3 no cubre las estimaciones (sus rutas no están registradas y dan `404`). Tampoco
cubre páginas, vistas, webhooks, tokens ni la creación de espacios: esos los crea la siembra desde la propia
app. La API admite 60 peticiones por minuto por token (`API_KEY_RATE_LIMIT`); en local se sube a 600 para la
siembra.
