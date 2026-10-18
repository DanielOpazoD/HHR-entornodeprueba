import type { DailyRecordStaffingState } from '@/application/shared/dailyRecordStaffContracts';
import {
  getDetailedShiftRoleAssignments,
  resolveDetailedStaffingState,
} from '@/services/staff/dailyRecordDetailedStaffing';
import { getNextDay, getShiftSchedule } from '@/utils/clinicalDayUtils';

const label = (date: string) => date.split('-').reverse().join('-');

/** The census owns its night staff; next-day application does not shift the roster. */
export const CudyrNightStaff = ({
  date,
  record,
}: {
  date: string;
  record: DailyRecordStaffingState | null;
}) => {
  const schedule = getShiftSchedule(date);
  // Date navigation can briefly retain the previous record. Never show its staff.
  const current = record?.date === date ? record : null;
  const staff = current
    ? getDetailedShiftRoleAssignments(
        resolveDetailedStaffingState(current),
        'night',
        'nurse'
      ).filter(person => person.name.trim())
    : [];
  return (
    <aside
      aria-label="Enfermería del turno CUDYR"
      className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
    >
      <p className="font-medium text-slate-700">Enfermería · turno noche</p>
      <p className="text-xs text-slate-500">
        {label(date)} {schedule.nightStart} → {label(getNextDay(date))} {schedule.nightEnd} · Rapa
        Nui
      </p>
      {staff.length ? (
        <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-slate-700">
          {staff.map(person => (
            <li key={person.id}>
              {person.name}
              {(person.startTime !== schedule.nightStart ||
                person.endTime !== schedule.nightEnd) && (
                <span className="ml-1 text-xs text-slate-500">
                  ({person.startTime}–{person.endTime})
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-slate-500">Dotación nocturna no informada para este día.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Fuente: dotación guardada del censo. Identifica el turno, no al responsable de cada
        aplicación.
      </p>
    </aside>
  );
};
