// Nominal local wall-clock minutes. No browser/UTC timezone or DST arithmetic.
export const PERIOD = '2026-09';
import { HOLIDAYS, periodInfo } from './calendar.mjs';
export { HOLIDAYS, periodInfo };
const DAY = 1440;

export function dayNumber(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Fecha inválida.');
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new Error('Fecha inválida.');
  }
  // This prototype deliberately fails closed outside its verified calendar.
  if (date < '2026-01-01' || date > '2028-01-01') {
    throw new Error('El calendario de demostración cubre 2026 y 2027.');
  }
  return value / 86400000;
}

export function nextDate(date) {
  return new Date((dayNumber(date) + 1) * 86400000).toISOString().slice(0, 10);
}

export function isNonBusiness(date) {
  const weekday = new Date(dayNumber(date) * 86400000).getUTCDay();
  return weekday === 0 || weekday === 6 || HOLIDAYS.has(date);
}

export function timeMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Horario inválido.');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function makeShift({ date, kind, start = '', end = '', nextDay = false, note = '', id }) {
  dayNumber(date);
  periodInfo(date.slice(0, 7));
  if (!['long', 'night', 'custom'].includes(kind)) throw new Error('Selecciona el tipo de turno.');
  if (kind === 'long') {
    start = isNonBusiness(date) ? '09:00' : '08:00';
    end = '20:00';
    nextDay = false;
  }
  if (kind === 'night') {
    start = '20:00';
    end = isNonBusiness(nextDate(date)) ? '09:00' : '08:00';
    nextDay = true;
  }
  const shift = {
    id,
    date,
    kind,
    start,
    end,
    endDate: nextDay ? nextDate(date) : date,
    note: note.trim(),
  };
  if (shift.note.length > 200) throw new Error('La observación admite hasta 200 caracteres.');
  interval(shift);
  return shift;
}

export function interval(shift) {
  const start = dayNumber(shift.date) * DAY + timeMinutes(shift.start);
  const end = dayNumber(shift.endDate) * DAY + timeMinutes(shift.end);
  if (end <= start || end - start > DAY)
    throw new Error(
      'El turno debe durar más de 0 y hasta 24 horas. Revisa si termina al día siguiente.'
    );
  return { start, end };
}

export function calculate(shift) {
  const { start, end } = interval(shift);
  let diurnal = 0;
  for (let day = Math.floor(start / DAY); day <= Math.floor((end - 1) / DAY); day++) {
    const date = new Date(day * 86400000).toISOString().slice(0, 10);
    if (!isNonBusiness(date)) {
      diurnal += Math.max(
        0,
        Math.min(end, day * DAY + 21 * 60) - Math.max(start, day * DAY + 7 * 60)
      );
    }
  }
  return { total: end - start, diurnal, nocturnal: end - start - diurnal };
}

export function totals(shifts) {
  return shifts.reduce(
    (sum, shift) => {
      const value = calculate(shift);
      return Object.fromEntries(Object.keys(sum).map(key => [key, sum[key] + value[key]]));
    },
    { total: 0, diurnal: 0, nocturnal: 0 }
  );
}

export function overlaps(shifts, candidate) {
  const b = interval(candidate);
  return shifts.some(shift => {
    if (shift.id === candidate.id) return false;
    const a = interval(shift);
    return a.start < b.end && b.start < a.end;
  });
}

export const hours = minutes =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(minutes / 60);
export const shiftLabel = shift =>
  `${{ long: 'Turno largo', night: 'Turno noche', custom: 'Horario parcial' }[shift.kind]} (${shift.start}–${shift.end})`;
export const dateLabel = date =>
  new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(dayNumber(date) * 86400000));

export function normalizeRut(input) {
  const clean = input.replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(clean)) return null;
  const body = clean.slice(0, -1);
  let sum = 0;
  [...body].reverse().forEach((digit, i) => {
    sum += Number(digit) * (2 + (i % 6));
  });
  const check = 11 - (sum % 11);
  const dv = check === 11 ? '0' : check === 10 ? 'K' : String(check);
  return clean.endsWith(dv) ? `${body}-${dv}` : null;
}
