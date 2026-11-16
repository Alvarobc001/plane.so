// Duraciones: lo comparten el navegador y el servidor.

// "1:30", "1h 30m", "1h", "90m", "90", "1,5" o "1.5" (horas) -> minutos enteros; null si no se entiende
// o si se sale de 1 minuto … max (24 h por defecto; las estimaciones admiten más).
export function parseDuration(text, max = 1440) {
  const check = (min) => (min >= 1 && min <= max ? min : null);
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,4}):([0-5]\d)$/))) return check(+m[1] * 60 + +m[2]);
  if ((m = s.match(/^(?:(\d{1,4}(?:[.,]\d+)?) ?h)? ?(?:(\d{1,4}) ?m(?:in)?)?$/)) && (m[1] || m[2])) {
    return check(Math.round(parseFloat((m[1] ?? '0').replace(',', '.')) * 60) + +(m[2] ?? 0));
  }
  // Un número suelto: hasta 12 son horas ("1,5", "8"); a partir de ahí, minutos ("90")
  if ((m = s.match(/^(\d{1,4}(?:[.,]\d+)?)$/))) {
    const n = parseFloat(m[1].replace(',', '.'));
    return check(n <= 12 ? Math.round(n * 60) : Math.round(n));
  }
  return null;
}

// 95 -> "1 h 35 m"; 60 -> "1 h"; 0 -> "0 m"
export function formatDuration(minutes) {
  const t = Math.round(Math.abs(minutes));
  const h = Math.floor(t / 60);
  const m = t % 60;
  const out = h && m ? `${h} h ${m} m` : h ? `${h} h` : `${m} m`;
  return minutes < 0 ? `-${out}` : out;
}

// 3725 segundos -> "1:02:05"
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const p = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
