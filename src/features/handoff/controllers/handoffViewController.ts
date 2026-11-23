import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type {
  DailyRecordBedLayoutState,
  DailyRecordDateRef,
} from '@/types/domain/dailyRecordSlices';
import type { PatientData } from '@/types/domain/patient';
import type { ShiftType } from '@/types/domain/shift';
import { resolveNursingHandoffNovedadesText } from '@/shared/handoff/handoffNovedades';
import { isAdmittedDuringShift } from '@/utils/clinicalDayUtils';
import type { AuditAction } from '@/types/auditActionTypes';

export const resolveHandoffTitle = (selectedShift: ShiftType): string =>
  `Entrega Turno Enfermería - ${selectedShift === 'day' ? 'Día' : 'Noche'} `;

export const resolveHandoffTableHeaderClass = (selectedShift: ShiftType): string =>
  selectedShift === 'day'
    ? 'bg-medical-50 bg-gradient-to-b from-sky-50 to-sky-100/60 text-sky-900 text-[10px] uppercase tracking-[0.06em] font-semibold border-b border-sky-200/60'
    : 'bg-slate-100 bg-gradient-to-b from-slate-50 to-slate-100/80 text-slate-500 text-[10px] uppercase tracking-[0.06em] font-semibold border-b border-slate-200/60';

interface ResolveHandoffNovedadesValueParams {
  selectedShift: ShiftType;
  record: Pick<
    HandoffDailyRecordContract,
    'handoffNovedadesDayShift' | 'handoffNovedadesNightShift'
  >;
}

export const resolveHandoffNovedadesValue = ({
  selectedShift,
  record,
}: ResolveHandoffNovedadesValueParams): string =>
  resolveNursingHandoffNovedadesText({
    selectedShift,
    handoffNovedadesDayShift: record.handoffNovedadesDayShift,
    handoffNovedadesNightShift: record.handoffNovedadesNightShift,
  });

export const shouldShowNightCudyrActions = (selectedShift: ShiftType): boolean =>
  selectedShift === 'night';

export const resolveHandoffAuditDescriptor = (
  selectedShift: ShiftType
): {
  action: AuditAction;
  details: {
    view: 'nursing_handoff';
    shift: ShiftType;
  };
} => ({
  action: 'VIEW_NURSING_HANDOFF',
  details: {
    view: 'nursing_handoff',
    shift: selectedShift,
  },
});

interface HandoffChecklistSectionViewModel {
  showShiftSwitcher: boolean;
  isReceivesEditable: boolean;
  activeChecklistShift: ShiftType;
}

export const buildHandoffChecklistSectionViewModel = ({
  selectedShift,
  readOnly,
  hasShiftSwitcher,
}: {
  selectedShift: ShiftType;
  readOnly: boolean;
  hasShiftSwitcher: boolean;
}): HandoffChecklistSectionViewModel => ({
  showShiftSwitcher: hasShiftSwitcher,
  isReceivesEditable: !readOnly && selectedShift === 'night',
  activeChecklistShift: selectedShift,
});

interface HandoffNovedadesBindings {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}

export const buildHandoffNovedadesBindings = ({
  selectedShift,
  record,
  readOnly,
  onUpdateHandoffNovedades,
}: {
  selectedShift: ShiftType;
  record: Pick<
    HandoffDailyRecordContract,
    'handoffNovedadesDayShift' | 'handoffNovedadesNightShift'
  >;
  readOnly: boolean;
  onUpdateHandoffNovedades: (shift: ShiftType, value: string) => void;
}): HandoffNovedadesBindings => ({
  value: resolveHandoffNovedadesValue({ selectedShift, record }),
  readOnly,
  onChange: value => onUpdateHandoffNovedades(selectedShift, value),
});

interface BedDescriptor {
  id: string;
  isExtra?: boolean;
}

/** Fixed beds always; an extra bed only while the day has it active. */
export const getVisibleHandoffBeds = <TBed extends BedDescriptor>(
  record: Pick<DailyRecordBedLayoutState, 'activeExtraBeds'> | null,
  beds: TBed[]
): TBed[] => {
  if (!record) return [];

  const activeExtras = record.activeExtraBeds || [];
  return beds.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));
};

/** A blocked bed always shows; an occupied bed shows when its patient was there during the shift. */
export const shouldShowHandoffPatient = (
  record: (DailyRecordDateRef & Pick<DailyRecordBedLayoutState, 'beds'>) | null,
  bedId: string,
  selectedShift: ShiftType
): boolean => {
  if (!record) return false;

  const patient = record.beds[bedId];
  if (!patient) return false;
  if (patient.isBlocked) return true;
  if (!patient.patientName) return false;

  return isAdmittedDuringShift(
    record.date,
    patient.admissionDate,
    patient.admissionTime,
    selectedShift
  );
};

type NursingNoteField = 'handoffNoteDayShift' | 'handoffNoteNightShift';

export const resolveNursingNoteField = (selectedShift: ShiftType): NursingNoteField =>
  selectedShift === 'day' ? 'handoffNoteDayShift' : 'handoffNoteNightShift';

/**
 * The fields one nursing note edit writes. A day note is also the night's starting note, so it
 * fills both shifts; a night note only its own. `oldNote` is the edited shift's note before it.
 */
export const buildNursingNoteChange = ({
  selectedShift,
  patient,
  value,
}: {
  selectedShift: ShiftType;
  patient: Pick<PatientData, NursingNoteField> | undefined;
  value: string;
}): { noteKey: NursingNoteField; fields: Partial<PatientData>; oldNote: string } => {
  const noteKey = resolveNursingNoteField(selectedShift);
  return {
    noteKey,
    fields:
      selectedShift === 'day'
        ? { handoffNoteDayShift: value, handoffNoteNightShift: value }
        : { handoffNoteNightShift: value },
    oldNote: patient?.[noteKey] || '',
  };
};
