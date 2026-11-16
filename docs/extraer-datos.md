# Extraer los datos de Plane para tus informes

Cómo sacar **todos** los datos de Plane (proyectos, tareas, estados, responsables, ciclos, módulos…) y del
módulo de tiempo (horas registradas, estimaciones en horas y capacidad) para montar tus propios informes en
Power BI, Excel o cualquier otra herramienta.

Todo se lee con **un token de la API de Plane** y **solo se puede leer**: con un token no se modifica nada.

| Forma | Para quién | Se actualiza |
| --- | --- | --- |
| [A. Carpeta de CSV](#a-carpeta-de-csv) | Lo más sencillo: un comando genera una tabla por fichero y Power BI o Excel las abren | Cada vez que ejecutas el comando (o con una tarea programada) |
| [B. Power BI directo a la API](#b-power-bi-o-excel-directo-a-la-api) | Informes que se actualizan solos, también en Power BI Service | Al pulsar *Actualizar* o con la actualización programada |
| [C. La API a mano](#c-la-api-a-mano) | Scripts propios o herramientas que llaman a una API REST | Como lo programes |

---

## 1. Crear el token

1. En Plane: avatar (abajo a la izquierda) → **Settings** → **Personal access tokens** → **Add access token**.
2. Ponle un nombre (por ejemplo `Power BI`) y elige una caducidad o *Never expires* (sin elegir una, el
   botón *Generate token* no hace nada).
3. Copia el token (empieza por `plane_api_`). **Solo se muestra una vez**; si lo pierdes, crea otro.

El token ve exactamente lo mismo que la persona que lo crea:

- solo los proyectos de los que es miembro;
- las **horas de todo el equipo** solo si es **administrador del espacio** de trabajo. Si es miembro, solo
  las suyas.

Para informes de toda la empresa, créalo con un usuario administrador. Trátalo como una contraseña: quien lo
tenga puede leer todo lo que ve ese usuario. Si se filtra, bórralo en la misma pantalla y crea otro.

> **Datos personales (RGPD).** Las horas registradas dicen cuánto trabaja cada persona. Comparte los informes
> con horas por persona solo con quien deba verlas, y nunca con *Publicar en la web* de Power BI.

**Límite de peticiones:** cada token puede hacer 60 peticiones por minuto. Si al actualizar sale el error
`429`, sube `API_KEY_RATE_LIMIT` en las variables de EasyPanel (por ejemplo a `300/minute`) y vuelve a
desplegar. Ver la sección 4.2 del [README](../README.md#42-variables-de-entorno).

---

## 2. Qué datos hay y cómo se relacionan

```text
Proyectos ─┬─< Tareas >── Estados
           │     │ ├─< Responsables >── Miembros ──< Horas
           │     │ ├─< Etiquetas de la tarea >── Etiquetas
           │     │ ├─< Tareas del ciclo >── Ciclos
           │     │ └─< Tareas del módulo >── Módulos
           │     ├── Estimación (horas)
           │     └─< Horas (registros de tiempo)
Miembros ── Capacidad (horas al día, días laborables)
```

`─<` es «uno a muchos»: un proyecto tiene muchas tareas, una tarea muchos registros de horas.

| Tabla | Clave | Se une con | Campos útiles |
| --- | --- | --- | --- |
| Proyectos | `id` | | `identifier` (RES, MKT…), `name`, `project_lead`, `created_at`, `archived_at` |
| Tareas | `id` | `project` → Proyectos, `state` → Estados, `parent` → Tareas | `ref` (RES-16), `name`, `priority` (`urgent`, `high`, `medium`, `low`, `none`), `start_date`, `target_date` (entrega), `completed_at`, `created_at` |
| Estados | `id` | `project` → Proyectos | `name`, `group`: `backlog`, `unstarted`, `started`, `completed`, `cancelled` |
| Miembros | `id` | | `display_name`, `first_name`, `last_name`, `email`, `role` (20 administrador, 15 miembro, 5 invitado) |
| Responsables | `tarea_id` + `miembro_id` | Tareas, Miembros | Una fila por tarea y responsable |
| Etiquetas | `id` | `project` → Proyectos | `name`, `parent`, `color` |
| Ciclos | `id` | `project` → Proyectos | `name`, `start_date`, `end_date`, `archived_at` |
| Módulos | `id` | `project` → Proyectos | `name`, `status`, `start_date`, `target_date`, `lead` |
| Horas | `id` | `issue_id` → Tareas, `user_id` → Miembros | `day`, `minutes`, `source` (`manual` o `timer`), `note` |
| Estimaciones | `issue_id` | Tareas (una por tarea) | `minutes` estimados |
| Capacidad | `id` (de la persona) | Miembros | `minutes_per_day`, `workdays` (1 lunes … 7 domingo) |

Las horas y las estimaciones están en **minutos**: divide entre 60 para tener horas.

**Lo que la API no da:** las páginas (*Pages*), las vistas guardadas, los webhooks y la estimación en puntos de
Plane (el campo `estimate_point` es solo un identificador; Plane no publica su tabla). La estimación en horas
del módulo de tiempo sí está, en *Estimaciones*.

---

## A. Carpeta de CSV

El script [`scripts/export-csv.mjs`](../scripts/export-csv.mjs) lee todo el espacio y deja una tabla por
fichero en `scripts/export/<espacio>/csv/`:

```text
proyectos.csv  tareas.csv  estados.csv  etiquetas.csv  miembros.csv
tarea_responsables.csv  tarea_etiquetas.csv  ciclos.csv  ciclo_tareas.csv
modulos.csv  modulo_tareas.csv  horas.csv  estimaciones.csv  capacidad.csv
```

Los ficheros son CSV estándar: separados por comas, en UTF-8, con fechas ISO (`2026-11-16`) y los minutos sin
decimales.

**Una vez:**

1. Instala [Node.js](https://nodejs.org) 22 o superior y descarga el repositorio (`git clone` o *Code →
   Download ZIP* en GitHub).
2. Copia [`scripts/.env.example`](../scripts/.env.example) a `scripts/.env` y rellénalo:

   ```text
   PLANE_URL=https://plane.tudominio.com
   PLANE_WORKSPACE=slug-de-tu-espacio
   PLANE_API_KEY=plane_api_...
   ```

   El *slug* es lo que va detrás del dominio en la dirección de Plane: en `https://plane.tudominio.com/acme/`,
   es `acme`. `scripts/.env` no se sube nunca al repositorio.

**Cada vez que quieras datos nuevos**, desde la carpeta del proyecto (el número es el año desde el que traer
horas; sin él, solo el año actual):

```bash
node scripts/export-csv.mjs 2025
```

**En Power BI:** *Obtener datos* → **Texto o CSV** para cada fichero (origen: *65001: Unicode (UTF-8)*,
delimitador: *Coma*). Después crea las relaciones de la [sección 2](#2-qué-datos-hay-y-cómo-se-relacionan)
en la vista de **Modelo**, como en [B.4](#b4-relaciones-y-medidas). Para refrescar con datos nuevos, vuelve a
ejecutar el comando y pulsa *Actualizar*.

**En Excel:** *Datos* → **Desde texto/CSV** para cada fichero (o *Obtener datos* → *Desde archivo* → *Desde
carpeta*). Al abrir el CSV con doble clic, un Excel en español lo muestra todo en una columna; por eso hay
que importarlo así.

Para tenerlo al día sin acordarte, prográmalo (en Windows, el *Programador de tareas*, con el comando
`node scripts/export-csv.mjs` y la carpeta del proyecto como «Iniciar en»), y en Power BI pulsa *Actualizar*.

---

## B. Power BI o Excel directo a la API

Power Query (el editor de consultas de Power BI y de Excel) llama a la API, recorre todas las páginas y
construye las tablas. El informe se actualiza solo, también en Power BI Service con actualización programada.

> Este código sigue la API tal y como responde Plane v1.4.3 (comprobada en este repositorio), pero no se ha
> ejecutado dentro de Power BI. Si alguna consulta da error, la [forma A](#a-carpeta-de-csv) da las mismas tablas.

### B.1. Parámetros

En Power BI Desktop: **Transformar datos** → **Administrar parámetros** → **Nuevo parámetro**, y crea:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `PlaneUrl` | Texto | `https://plane.tudominio.com/` (con la barra final) |
| `Espacio` | Texto | El slug de tu espacio, por ejemplo `acme` |
| `Token` | Texto | Tu token `plane_api_...` |
| `AnioInicio` | Número decimal | El primer año del que quieres horas, por ejemplo `2025` |

> El token queda guardado dentro del `.pbix`. No compartas ese fichero; comparte el informe publicado.

### B.2. Funciones

En Excel, todo esto está en *Datos* → *Obtener datos* → *Iniciar el Editor de Power Query*.

Crea cada una con **Nuevo origen** → **Consulta en blanco** → **Editor avanzado**, pega el código y cambia el
nombre de la consulta por el indicado.

**`fnPlane`**: cualquier listado de la API de Plane, con todas sus páginas:

```powerquery
(ruta as text, optional consulta as nullable record) as list =>
let
    Base = [per_page = "100"] & (if consulta = null then [] else consulta),
    Pagina = (cursor as nullable text) =>
        Json.Document(Web.Contents(PlaneUrl, [
            RelativePath = "api/v1/" & ruta,
            Query = if cursor = null then Base else Base & [cursor = cursor],
            Headers = [#"X-API-Key" = Token]
        ])),
    Paginas = List.Generate(
        () => Pagina(null),
        each _ <> null,
        each if Value.Is(_, type record) and _[next_page_results] then Pagina(_[next_cursor]) else null
    ),
    Filas = List.Combine(List.Transform(Paginas, each if Value.Is(_, type list) then _ else _[results]))
in
    Filas
```

**`fnTiempo`**: los datos del módulo de tiempo:

```powerquery
(ruta as text, optional consulta as nullable record) as list =>
    Json.Document(Web.Contents(PlaneUrl, [
        RelativePath = "time/api/w/" & Espacio & "/" & ruta,
        Query = if consulta = null then [] else consulta,
        Headers = [#"X-API-Key" = Token]
    ]))
```

`RelativePath` y `Query` son lo que permite la actualización programada en Power BI Service: si la dirección
se construyera entera con `&`, Service la rechazaría por «origen de datos dinámico».

### B.3. Tablas

Una consulta en blanco por tabla, con estos nombres.

**`Proyectos`**

```powerquery
let
    Filas = fnPlane("workspaces/" & Espacio & "/projects/"),
    Tabla = Table.FromRecords(Filas, {"id", "identifier", "name", "project_lead", "created_at", "archived_at"}, MissingField.UseNull)
in
    Tabla
```

**`TareasBase`** (auxiliar: clic derecho → desmarca *Habilitar carga*)

```powerquery
let
    Proyectos = fnPlane("workspaces/" & Espacio & "/projects/"),
    PorProyecto = List.Transform(Proyectos, (p) =>
        List.Transform(
            fnPlane("workspaces/" & Espacio & "/projects/" & p[id] & "/work-items/", [expand = "assignees,labels"]),
            (t) => t & [ref = p[identifier] & "-" & Text.From(t[sequence_id])])),
    Tabla = Table.FromRecords(List.Combine(PorProyecto),
        {"id", "project", "ref", "name", "state", "priority", "start_date", "target_date", "completed_at",
         "created_at", "parent", "assignees", "labels"},
        MissingField.UseNull)
in
    Tabla
```

**`Tareas`**

```powerquery
let
    Tabla = Table.RemoveColumns(TareasBase, {"assignees", "labels"}),
    Tipos = Table.TransformColumnTypes(Tabla, {
        {"start_date", type date}, {"target_date", type date},
        {"completed_at", type datetimezone}, {"created_at", type datetimezone}})
in
    Tipos
```

**`Responsables`** (una fila por tarea y responsable)

```powerquery
let
    Filas = Table.ExpandListColumn(Table.SelectColumns(TareasBase, {"id", "assignees"}), "assignees"),
    ConPersona = Table.SelectRows(Filas, each [assignees] <> null),
    Tabla = Table.ExpandRecordColumn(ConPersona, "assignees", {"id"}, {"miembro_id"}),
    Fin = Table.RenameColumns(Tabla, {{"id", "tarea_id"}})
in
    Fin
```

**`Estados`**

```powerquery
let
    Proyectos = fnPlane("workspaces/" & Espacio & "/projects/"),
    Filas = List.Combine(List.Transform(Proyectos, (p) => fnPlane("workspaces/" & Espacio & "/projects/" & p[id] & "/states/"))),
    Tabla = Table.FromRecords(Filas, {"id", "project", "name", "group", "color"}, MissingField.UseNull)
in
    Tabla
```

**`Miembros`**

```powerquery
let
    Filas = fnPlane("workspaces/" & Espacio & "/members/"),
    Tabla = Table.FromRecords(Filas, {"id", "display_name", "first_name", "last_name", "email", "role"}, MissingField.UseNull)
in
    Tabla
```

**`Horas`** (con un token que no sea de administrador, quita `, user = "all"`)

```powerquery
let
    Anios = {AnioInicio .. Date.Year(DateTime.LocalNow())},
    Listas = List.Transform(Anios, (a) => fnTiempo("entries",
        [from = Text.From(a) & "-01-01", to = Text.From(a) & "-12-31", user = "all"])),
    Tabla = Table.FromRecords(List.Combine(Listas),
        {"id", "day", "minutes", "source", "note", "user_id", "issue_id"}, MissingField.UseNull),
    Tipos = Table.TransformColumnTypes(Tabla, {{"day", type date}, {"minutes", Int64.Type}}),
    ConHoras = Table.AddColumn(Tipos, "hours", each [minutes] / 60, type number)
in
    ConHoras
```

**`Estimaciones`**

```powerquery
let
    Tabla = Table.FromRecords(fnTiempo("estimates"), {"issue_id", "minutes"}, MissingField.UseNull),
    ConHoras = Table.AddColumn(Tabla, "hours", each [minutes] / 60, type number)
in
    ConHoras
```

**`Capacidad`**

```powerquery
let
    Tabla = Table.FromRecords(fnTiempo("capacity"), {"id", "minutes_per_day", "workdays"}, MissingField.UseNull),
    Dias = Table.TransformColumns(Tabla, {{"workdays", each Text.Combine(List.Transform(_, Text.From), " "), type text}})
in
    Dias
```

Ciclos, módulos y etiquetas se hacen igual que *Estados*, con `/cycles/?cycle_view=all` (y
`/archived-cycles/`), `/modules/` (y `/archived-modules/`) y `/labels/`. Las tareas de cada ciclo salen de
`/cycles/{id}/cycle-issues/` y las de cada módulo, de `/modules/{id}/module-issues/`.

### B.4. Relaciones y medidas

En la vista de **Modelo**, une:

| Desde (muchos) | Hacia (uno) |
| --- | --- |
| `Tareas[project]` | `Proyectos[id]` |
| `Tareas[state]` | `Estados[id]` |
| `Horas[issue_id]` | `Tareas[id]` |
| `Horas[user_id]` | `Miembros[id]` |
| `Estimaciones[issue_id]` | `Tareas[id]` (uno a uno) |
| `Responsables[tarea_id]` | `Tareas[id]` |
| `Responsables[miembro_id]` | `Miembros[id]` |
| `Capacidad[id]` | `Miembros[id]` (uno a uno) |

Medidas de ejemplo (en *Horas* y *Estimaciones*):

```dax
Horas registradas = SUM ( Horas[hours] )
```

```dax
Horas estimadas = SUM ( Estimaciones[hours] )
```

```dax
Desviación % = DIVIDE ( [Horas registradas] - [Horas estimadas], [Horas estimadas] )
```

Para analizar por semanas o meses, añade una tabla de calendario (*Modelado* → *Nueva tabla*:
`Calendario = CALENDARAUTO()`) y únela con `Horas[day]`.

### B.5. Publicar y actualizar en Power BI Service

1. Publica el informe.
2. En el conjunto de datos → **Configuración** → **Credenciales del origen de datos** → editar: autenticación
   **Anónima** (el token ya va en la cabecera) y nivel de privacidad **Organizativo**. Si da error al
   probar la conexión, marca **Omitir conexión de prueba**.
3. En **Actualización programada**, elige la frecuencia.

No hace falta puerta de enlace (*gateway*): Plane está en Internet.

---

## C. La API a mano

Dos APIs, el mismo token en la cabecera `X-API-Key`:

| API | Dirección base | Qué tiene |
| --- | --- | --- |
| Plane | `https://plane.tudominio.com/api/v1/` | Todo lo de Plane |
| Módulo de tiempo | `https://plane.tudominio.com/time/api/w/<espacio>/` | Horas, estimaciones en horas y capacidad |

Prueba el token (debe devolver tu usuario):

```bash
curl -H "X-API-Key: plane_api_..." https://plane.tudominio.com/api/v1/users/me/
```

En Windows, con PowerShell:

```powershell
Invoke-RestMethod -Uri https://plane.tudominio.com/api/v1/users/me/ -Headers @{ "X-API-Key" = "plane_api_..." }
```

### Paginación de la API de Plane

Los listados vienen por páginas. Pide `per_page=100` y sigue `next_cursor` mientras `next_page_results`
sea `true`:

```text
GET /api/v1/workspaces/acme/projects/<id>/work-items/?per_page=100
{ "results": [ ... ], "next_page_results": true, "next_cursor": "100:1:0", "total_results": 240, ... }

GET /api/v1/workspaces/acme/projects/<id>/work-items/?per_page=100&cursor=100:1:0
```

`/members/` es la excepción: devuelve la lista directamente, sin páginas. Las rutas del módulo de tiempo
tampoco paginan.

### Endpoints de lectura

Con `W` = `/api/v1/workspaces/<espacio>` y `P` = `W/projects/<id del proyecto>`:

| Datos | Endpoint |
| --- | --- |
| Tu usuario | `GET /api/v1/users/me/` |
| Miembros del espacio | `GET W/members/` |
| Proyectos | `GET W/projects/` |
| Un proyecto y su resumen | `GET P/`, `GET P/summary/` |
| Miembros del proyecto | `GET P/members/` |
| Estados | `GET P/states/` |
| Etiquetas | `GET P/labels/` |
| Tareas | `GET P/work-items/?expand=assignees,labels` (con `state` en `expand`, el estado viene completo) |
| Una tarea por su código | `GET W/work-items/RES-16/` |
| Buscar tareas | `GET W/work-items/search/?search=texto` |
| Comentarios, enlaces, adjuntos, relaciones e historial de una tarea | `GET P/work-items/<id>/comments/`, `/links/`, `/attachments/`, `/relations/`, `/activities/` |
| Ciclos | `GET P/cycles/?cycle_view=all`, archivados en `GET P/archived-cycles/` |
| Tareas de un ciclo | `GET P/cycles/<id>/cycle-issues/` |
| Módulos | `GET P/modules/`, archivados en `GET P/archived-modules/` |
| Tareas de un módulo | `GET P/modules/<id>/module-issues/` |
| Intake (peticiones de entrada) | `GET P/intake-issues/` |
| Notas (*stickies*) | `GET W/stickies/` |

Y del módulo de tiempo, con `T` = `/time/api/w/<espacio>`:

| Datos | Endpoint |
| --- | --- |
| Horas registradas | `GET T/entries?from=2026-01-01&to=2026-12-31` (un año como mucho por llamada). Añade `&user=all` para las de todo el equipo (solo administradores) |
| Estimaciones en horas | `GET T/estimates` |
| Capacidad de cada persona | `GET T/capacity` |
| Carga de trabajo de una semana | `GET T/workload?from=2026-11-16` |
| Informe en CSV (para Excel en español: `;` y coma decimal) | `GET T/report?from=2026-01-01&to=2026-12-31&format=csv&user=all` |

El comentario de cada tarea, su historial y sus adjuntos piden una llamada por tarea: con miles de tareas,
tarda (60 por minuto). Para un volcado completo de todo en JSON, incluidos esos detalles, está
[`scripts/api-export.mjs`](../scripts/api-export.mjs) (ver *Proyecto de ejemplo y extracción por la API* en el
[README](../README.md)).

---

## Problemas frecuentes

| Error | Causa | Solución |
| --- | --- | --- |
| `401` | Token mal copiado, caducado o borrado | Crea otro token (sección 1) |
| `403` en las horas | `user=all` con un token que no es de administrador del espacio | Usa un token de administrador o quita `user=all` |
| `404` en `/time/api/...` | El *slug* del espacio está mal o el usuario del token no es miembro | Revisa el slug en la dirección de Plane |
| `429` | Límite de 60 peticiones por minuto del token | Sube `API_KEY_RATE_LIMIT` (sección 1). El script de CSV espera y reintenta solo |
| `400` «El periodo no puede pasar de un año» | `from` y `to` separados más de un año | Pide un año por llamada, como hacen el script y la consulta *Horas* |
| Power BI Service: «origen de datos dinámico» | La dirección se construye entera con `&` | Usa `RelativePath` y `Query` como en `fnPlane` |
