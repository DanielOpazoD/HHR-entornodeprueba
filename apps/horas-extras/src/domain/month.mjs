import { makeShift, overlaps, periodInfo, PERIOD } from './overtime.mjs';

export function initialMonth(period = PERIOD) {
  periodInfo(period);
  const result = {
    period,
    sheets: [
      {
        id: 'ana',
        name: 'Ana Ejemplo',
        rut: '11111111-1',
        group: 'TENS',
        shifts: [
          makeShift({ id: 'a1', date: '2026-09-04', kind: 'night' }),
          makeShift({ id: 'a2', date: '2026-09-15', kind: 'long' }),
        ],
      },
      {
        id: 'luis',
        adminRole: 'Enfermera Coordinadora',
        name: 'Luis Ejemplo',
        rut: '22222222-2',
        group: 'Enfermería',
        shifts: [makeShift({ id: 'l1', date: '2026-09-17', kind: 'night' })],
      },
      {
        id: 'maria',
        name: 'María Ejemplo',
        rut: '33333333-3',
        group: 'TENS',
        shifts: [],
      },
      {
        id: 'pedro',
        name: 'Pedro Ejemplo',
        rut: '44444444-4',
        group: 'Enfermería',
        shifts: [
          makeShift({ id: 'p1', date: '2026-09-16', kind: 'custom', start: '17:30', end: '20:00' }),
        ],
      },
    ],
  };
  if (period !== PERIOD) result.sheets = result.sheets.map(person => ({ ...person, shifts: [] }));
  return result;
}

// Demo-only ownership checks. Enforce these in the server before real use.
export function transition(month, action, actor) {
  const copy = structuredClone(month);
  const sheet = copy.sheets.find(item => item.id === action.sheetId);
  if (!sheet || actor.id !== sheet.id) throw new Error('Solo puedes modificar tus propios turnos.');
  if (action.type === 'save') {
    const shift = makeShift(action.shift);
    if (!shift.date.startsWith(`${copy.period}-`))
      throw new Error('El turno debe pertenecer al mes seleccionado.');
    if (!shift.id) throw new Error('Falta el identificador del turno.');
    if (overlaps(action.adjacentShifts || [], shift) || overlaps(sheet.shifts, shift))
      throw new Error('Este horario se superpone con otro turno. Revisa la fecha y las horas.');
    sheet.shifts = [...sheet.shifts.filter(item => item.id !== shift.id), shift].sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
    );
  } else if (action.type === 'delete') {
    if (!sheet.shifts.some(item => item.id === action.id)) throw new Error('Turno no encontrado.');
    sheet.shifts = sheet.shifts.filter(item => item.id !== action.id);
  } else throw new Error('Acción no disponible.');
  return copy;
}
