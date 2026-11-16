// Datos inventados del espacio de ejemplo "Acme". Fechas relativas al día de la siembra
// (0 = hoy) para que siempre haya sprint pasado, actual y futuro. h = horas estimadas.
export const PEOPLE = { laura: 'laura@acme.test', diego: 'diego@acme.test', sofia: 'sofia@acme.test', marco: 'marco@acme.test' };

export const LABELS = [
  ['Frontend', '#3f76ff'], ['Backend', '#8b5cf6'], ['Diseño', '#ec4899'], ['QA', '#14b8a6'],
  ['Bug', '#ef4444'], ['Mejora', '#22c55e'], ['Hito', '#f59e0b'],
];

// Estados propios: los cinco por defecto renombrados y uno nuevo
export const STATES = {
  backlog: 'Backlog', unstarted: 'Por hacer', started: 'En curso', review: 'En revisión',
  completed: 'Hecho', cancelled: 'Cancelado',
};

export const CYCLES = [
  ['Sprint 1 · Descubrimiento', -28, -15],
  ['Sprint 2 · Base técnica', -14, -1],
  ['Sprint 3 · Flujo de reserva', 0, 13],
  ['Sprint 4 · Beta', 14, 27],
];

// Fases del proyecto (módulos). Cada una termina en un hito (tarea con la etiqueta "Hito").
export const MODULES = [
  ['Fase 1 · Descubrimiento y diseño', -28, -10, 'completed', 'marco'],
  ['Fase 2 · Backend y API', -16, 10, 'in-progress', 'diego'],
  ['Fase 3 · App web', -7, 20, 'in-progress', 'sofia'],
  ['Fase 4 · Pruebas y lanzamiento', -1, 35, 'planned', 'laura'],
];

// [ref, nombre, fase, sprint, quién, estado, prioridad, etiquetas, puntos, inicio, fin, h, padre]
export const TASKS = [
  ['T1', 'Entrevistas con 8 clientes piloto', 0, 0, 'laura', 'completed', 'high', ['Diseño'], 3, -28, -24, 10],
  ['T2', 'Mapa del flujo de reserva', 0, 0, 'marco', 'completed', 'medium', ['Diseño'], 2, -26, -22, 6],
  ['T3', 'Prototipo navegable en Figma', 0, 0, 'marco', 'completed', 'high', ['Diseño'], 5, -23, -16, 16],
  ['T4', 'Guía de estilos y componentes', 0, 0, 'sofia', 'completed', 'medium', ['Diseño', 'Frontend'], 3, -22, -17, 12],
  ['T5', 'Hito: diseño aprobado', 0, null, 'laura', 'completed', 'urgent', ['Hito'], 1, -10, -10, 1],
  ['T6', 'Modelo de datos de reservas', 1, 0, 'diego', 'completed', 'high', ['Backend'], 3, -16, -12, 10],
  ['T7', 'API de disponibilidad', 1, 1, 'diego', 'completed', 'high', ['Backend'], 5, -13, -6, 18],
  ['T27', 'Documentación de la API', 1, 1, 'diego', 'unstarted', 'medium', ['Backend'], 2, -8, -2, 5],
  ['T8', 'API de reservas y cancelaciones', 1, 2, 'diego', 'started', 'urgent', ['Backend'], 8, -5, 4, 24],
  ['T8a', 'Validar solapes de horario', 1, 2, 'diego', 'review', 'high', ['Backend'], 2, -3, 0, 6, 'T8'],
  ['T8b', 'Política de cancelación de 24 h', 1, 2, 'diego', 'unstarted', 'medium', ['Backend'], 2, 1, 3, 5, 'T8'],
  ['T9', 'Pasarela de pago en modo pruebas', 1, 2, 'diego', 'unstarted', 'high', ['Backend'], 5, 2, 8, 14],
  ['T10', 'Notificaciones por correo', 1, 3, 'diego', 'backlog', 'medium', ['Backend'], 3, 14, 18, 8],
  ['T11', 'Hito: API en staging', 1, null, 'laura', 'unstarted', 'urgent', ['Hito'], 1, 10, 10, 1],
  ['T12', 'Bug: zona horaria en la disponibilidad', 1, 2, 'diego', 'review', 'urgent', ['Backend', 'Bug'], 2, -1, 1, 4],
  ['T13', 'Pantalla de búsqueda de huecos', 2, 2, 'sofia', 'started', 'high', ['Frontend'], 5, -4, 2, 16],
  ['T14', 'Formulario de reserva', 2, 2, 'sofia', 'started', 'high', ['Frontend'], 5, -2, 3, 14],
  ['T15', 'Área de cliente: mis reservas', 2, 2, 'sofia', 'unstarted', 'medium', ['Frontend'], 5, 1, 6, 15],
  ['T16', 'Accesibilidad AA del flujo de reserva', 2, 2, 'marco', 'unstarted', 'medium', ['Frontend', 'QA'], 3, 3, 7, 8],
  ['T17', 'Modo oscuro', 2, null, 'sofia', 'backlog', 'low', ['Frontend', 'Mejora'], 2, null, null, 6],
  ['T18', 'Bug: el calendario no carga en Safari', 2, 2, 'sofia', 'unstarted', 'high', ['Frontend', 'Bug'], 2, 0, 1, 5],
  ['T19', 'Plan de pruebas de extremo a extremo', 3, 2, 'marco', 'started', 'medium', ['QA'], 3, -1, 4, 10],
  ['T20', 'Pruebas de carga: 500 reservas por minuto', 3, 3, 'marco', 'unstarted', 'high', ['QA', 'Backend'], 5, 14, 18, 12],
  ['T21', 'Beta cerrada con clientes piloto', 3, 3, 'laura', 'backlog', 'high', [], 3, 17, 24, 10],
  ['T22', 'Hito: beta cerrada', 3, null, 'laura', 'backlog', 'urgent', ['Hito'], 1, 24, 24, 1],
  ['T23', 'Textos legales y RGPD', 3, 2, 'laura', 'started', 'high', [], 2, -2, 5, 6],
  ['T24', 'Hito: lanzamiento público', 3, null, 'laura', 'backlog', 'urgent', ['Hito'], 1, 35, 35, 1],
  ['T25', 'Analítica del embudo de reserva', 3, null, 'laura', 'cancelled', 'low', ['Mejora'], 2, null, null, 4],
];

// Dependencias: [tarea, tipo, [otras]]
export const RELATIONS = [
  ['T7', 'blocking', ['T8', 'T13']],
  ['T8', 'blocking', ['T9', 'T14']],
  ['T3', 'relates_to', ['T4']],
  ['T19', 'start_before', ['T20']],
];

export const COMMENTS = [
  ['T8', '<p>He dejado el endpoint de cancelación detrás de una bandera hasta cerrar la política de 24 h.</p>'],
  ['T8', '<p>Revisado con producto: los reembolsos parciales quedan fuera de esta fase.</p>'],
  ['T12', '<p>Se reproduce con clientes en Canarias: la API devolvía horas en UTC.</p>'],
  ['T13', '<p>Falta el estado vacío cuando no hay huecos en la semana.</p>'],
  ['T3', '<p>Aprobado por el comité el día del hito. Siguiente paso: guía de estilos.</p>'],
];

export const LINKS = [
  ['T3', 'https://example.com/figma/prototipo-reservas', 'Prototipo en Figma'],
  ['T7', 'https://example.com/docs/api-disponibilidad', 'Especificación de la API'],
  ['T23', 'https://example.com/legal/plantilla-rgpd', 'Plantilla de cláusulas RGPD'],
];

export const INTAKE = [
  ['Permitir reservas para grupos de más de 6 personas', 'high'],
  ['El botón de pagar se corta en móviles pequeños', 'urgent'],
  ['Exportar mis reservas a Google Calendar', 'low'],
];

// Segundo proyecto, más pequeño, para que la carga de trabajo cruce proyectos
export const MKT_TASKS = [
  ['M1', 'Plan de medios', 'laura', 'completed', 'medium', -6, -2, 6],
  ['M2', 'Landing de lanzamiento', 'marco', 'started', 'high', 0, 5, 12],
  ['M3', 'Vídeo demo de 60 segundos', 'marco', 'unstarted', 'medium', 3, 9, 10],
  ['M4', 'Newsletter a la lista de espera', 'laura', 'unstarted', 'medium', 6, 8, 4],
];

export function day(offset) {
  if (offset === null || offset === undefined) return null;
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('sv'); // AAAA-MM-DD en hora local
}
