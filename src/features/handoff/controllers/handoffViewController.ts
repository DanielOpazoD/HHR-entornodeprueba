import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { BedDefinition } from '@/types/domain/beds';
import type { ShiftType } from '@/types/domain/shift';
import { resolveHandoffDocumentTitleLabel } from '@/shared/handoff/handoffPresentation';
import { resolveNursingHandoffNovedadesText } from '@/shared/handoff/handoffNovedades';
import type { HandoffClinicalEventActions } from '../components/handoffRowContracts';
import { canEditSpecialistTodayBoundRecord } from '@/shared/access/specialistAccessPolicy';
import { MessageSquare } from 'lucide-react';
import type { UserRole } from '@/types/authRoleTypes';
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

interface ResolveHandoffScreenFrameParams {
  selectedShift: ShiftType;
  role?: UserRole;
  readOnly: boolean;
  recordDate?: string;
  todayISO?: string;
}

export const resolveHandoffScreenFrame = ({
  selectedShift,
  readOnly,
  recordDate,
}: ResolveHandoffScreenFrameParams) => ({
  title: resolveHandoffTitle(selectedShift),
  tableHeaderClass: resolveHandoffTableHeaderClass(selectedShift),
  documentTitle: resolveHandoffDocumentTitleLabel({ selectedShift, recordDate }),
  effectiveReadOnly: readOnly,
  Icon: MessageSquare,
});

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

interface HandoffScreenShellModel {
  screenFrame: ReturnType<typeof resolveHandoffScreenFrame>;
  auditDescriptor: ReturnType<typeof resolveHandoffAuditDescriptor>;
  canEditClinicalEvents: boolean;
}

export const buildHandoffScreenShellModel = ({
  selectedShift,
  role,
  readOnly,
  recordDate,
  todayISO,
}: ResolveHandoffScreenFrameParams): HandoffScreenShellModel => {
  const screenFrame = resolveHandoffScreenFrame({ selectedShift, readOnly, recordDate });

  return {
    screenFrame,
    auditDescriptor: resolveHandoffAuditDescriptor(selectedShift),
    canEditClinicalEvents: canEditSpecialistTodayBoundRecord({
      role,
      readOnly: screenFrame.effectiveReadOnly,
      recordDate,
      todayISO,
    }),
  };
};

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

interface NursingHandoffContentBindings {
  visibleBeds: BedDefinition[];
  record: HandoffDailyRecordContract;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  tableHeaderClass: string;
  readOnly: boolean;
  hasAnyPatients: boolean;
  shouldShowPatient: (bedId: string) => boolean;
  clinicalEventActions: HandoffClinicalEventActions;
  selectedShift: ShiftType;
  updateHandoffNovedades: (shift: ShiftType, value: string) => void;
}

export const buildNursingHandoffContentBindings = (
  bindings: NursingHandoffContentBindings
): NursingHandoffContentBindings => bindings;
