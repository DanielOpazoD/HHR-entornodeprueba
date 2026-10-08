import { makeShift, overlaps, periodInfo, PERIOD } from './overtime.mjs';

export const STATUS = {
  draft: 'En borrador',
  submitted: 'Enviado',
  approved: 'Aprobado',
  observed: 'Con observaciones',
};
export const editable = (month, sheet) =>
  !month.closed && ['draft', 'observed'].includes(sheet.status);

export function initialMonth(period = PERIOD) {
  periodInfo(period);
  const result = {
    period,
    closed: false,
    audit: [],
    sheets: [
      {
        id: 'ana',
        name: 'Ana Ejemplo',
        rut: '11111111-1',
        group: 'TENS',
        status: 'draft',
        noExtras: false,
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
        status: 'submitted',
        noExtras: false,
        shifts: [makeShift({ id: 'l1', date: '2026-09-17', kind: 'night' })],
      },
      {
        id: 'maria',
        name: 'María Ejemplo',
        rut: '33333333-3',
        group: 'TENS',
        status: 'submitted',
        noExtras: true,
        shifts: [],
      },
      {
        id: 'pedro',
        name: 'Pedro Ejemplo',
        rut: '44444444-4',
        group: 'Enfermería',
        status: 'observed',
        reason: 'Confirma el horario realizado.',
        noExtras: false,
        shifts: [
          makeShift({ id: 'p1', date: '2026-09-16', kind: 'custom', start: '17:30', end: '20:00' }),
        ],
      },
    ],
  };
  if (period !== PERIOD)
    result.sheets = result.sheets.map(({ reason, ...person }) => ({
      ...person,
      status: 'draft',
      noExtras: false,
      shifts: [],
    }));
  return result;
}

// Demo-only workflow. Production authorization must run in the isolated server.
export function transition(month, action, actor, timestamp = new Date().toISOString()) {
  const copy = structuredClone(month);
  const sheet = copy.sheets.find(item => item.id === action.sheetId);
  const admin =
    actor.role === 'admin' && Boolean(copy.sheets.find(item => item.id === actor.id)?.adminRole);
  const requireAdmin = () => {
    if (!admin) throw new Error('Esta acción requiere administración.');
  };
  if (action.type === 'reopen') {
    requireAdmin();
    if (!copy.closed) throw new Error('El mes ya está abierto.');
    if (!action.reason?.trim()) throw new Error('Escribe el motivo de reapertura.');
    copy.closed = false;
  } else {
    if (copy.closed) throw new Error('El mes está cerrado. Reábrelo antes de modificarlo.');
    if (action.type === 'close') {
      requireAdmin();
      if (copy.sheets.some(item => item.status !== 'approved'))
        throw new Error(
          'Todos los funcionarios deben tener su mes aprobado, incluso quienes declaren no tener horas extras.'
        );
      copy.closed = true;
    } else {
      if (!sheet) throw new Error('Funcionario no encontrado.');
      if (['approve', 'return'].includes(action.type)) {
        requireAdmin();
        if (action.type === 'approve') {
          if (sheet.status !== 'submitted') throw new Error('Solo puedes aprobar un mes enviado.');
          sheet.status = 'approved';
        } else {
          if (!['submitted', 'approved'].includes(sheet.status))
            throw new Error('Solo puedes devolver un mes enviado o aprobado.');
          if (!action.reason?.trim()) throw new Error('Escribe la corrección solicitada.');
          sheet.status = 'observed';
          sheet.reason = action.reason.trim();
        }
      } else {
        if (actor.id !== sheet.id || !editable(copy, sheet))
          throw new Error('Este mes no admite cambios del funcionario.');
        if (action.type === 'save') {
          const shift = makeShift(action.shift);
          if (!shift.date.startsWith(`${copy.period}-`))
            throw new Error('El turno debe pertenecer al mes seleccionado.');
          if (overlaps(action.adjacentShifts || [], shift))
            throw new Error('Este horario se superpone con un turno de otro mes.');
          if (!shift.id) throw new Error('Falta el identificador del turno.');
          if (overlaps(sheet.shifts, shift))
            throw new Error(
              'Este horario se superpone con otro turno. Revisa la fecha y las horas.'
            );
          sheet.shifts = [...sheet.shifts.filter(item => item.id !== shift.id), shift].sort(
            (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
          );
          sheet.noExtras = false;
        } else if (action.type === 'delete') {
          if (!sheet.shifts.some(item => item.id === action.id))
            throw new Error('Turno no encontrado.');
          sheet.shifts = sheet.shifts.filter(item => item.id !== action.id);
        } else if (action.type === 'no-extras') {
          if (sheet.shifts.length)
            throw new Error(
              'Hay turnos registrados. Revisa los registros antes de declarar que no realizaste horas extras.'
            );
          sheet.noExtras = true;
        } else if (action.type === 'submit') {
          if (!sheet.shifts.length && !sheet.noExtras)
            throw new Error('Registra tus turnos o declara que no realizaste horas extras.');
          sheet.status = 'submitted';
          delete sheet.reason;
        } else throw new Error('Acción no reconocida.');
      }
    }
  }
  copy.audit.unshift({
    type: action.type,
    actor: actor.name,
    sheetId: action.sheetId,
    reason: action.reason?.trim(),
    timestamp,
  });
  return copy;
}
