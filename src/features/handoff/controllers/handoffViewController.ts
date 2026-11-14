import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { Specialty } from '@/domain/handoff/patientContracts';
import type { BedDefinition } from '@/types/domain/beds';
import type { ShiftType } from '@/types/domain/shift';
import { buildMedicalHandoffSummary } from './medicalSpecialtyHandoffController';
import { resolveHandoffDocumentTitleLabel } from '@/shared/handoff/handoffPresentation';
import { resolveNursingHandoffNovedadesText } from '@/shared/handoff/handoffNovedades';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import type {
  HandoffClinicalEventActions,
  HandoffMedicalActions,
} from '../components/handoffRowContracts';
import {
  resolveInitialMedicalScopeFromSearch,
  resolveInitialMedicalSpecialtyFromSearch,
} from '@/domain/handoff/view';
import { canEditMedicalHandoffForDate } from '@/shared/access/operationalAccessPolicy';
import { MessageSquare, Stethoscope } from 'lucide-react';
import type { UserRole } from '@/types/authRoleTypes';
import type { AuditAction } from '@/types/auditActionTypes';
import {
  resolveMedicalHandoffCapabilities,
  type MedicalHandoffCapabilities,
} from './medicalHandoffAccessController';

interface HandoffTitleParams {
  isMedical: boolean;
  selectedShift: ShiftType;
}

export const resolveHandoffTitle = ({ isMedical, selectedShift }: HandoffTitleParams): string =>
  isMedical
    ? 'Entrega Turno Médicos'
    : `Entrega Turno Enfermería - ${selectedShift === 'day' ? 'Día' : 'Noche'} `;

export const resolveHandoffTableHeaderClass = ({
  isMedical,
  selectedShift,
}: HandoffTitleParams): string => {
  if (isMedical) {
    return 'bg-sky-100 bg-gradient-to-b from-sky-50 to-sky-100/60 text-sky-800 text-[10px] uppercase tracking-[0.06em] font-semibold border-b border-sky-200/60';
  }

  return selectedShift === 'day'
    ? 'bg-medical-50 bg-gradient-to-b from-sky-50 to-sky-100/60 text-sky-900 text-[10px] uppercase tracking-[0.06em] font-semibold border-b border-sky-200/60'
    : 'bg-slate-100 bg-gradient-to-b from-slate-50 to-slate-100/80 text-slate-500 text-[10px] uppercase tracking-[0.06em] font-semibold border-b border-slate-200/60';
};

interface ResolveHandoffDocumentTitleParams {
  isMedical: boolean;
  selectedShift: ShiftType;
  recordDate?: string;
}

export const resolveHandoffDocumentTitle = ({
  isMedical,
  selectedShift,
  recordDate,
}: ResolveHandoffDocumentTitleParams): string | null => {
  return resolveHandoffDocumentTitleLabel({
    isMedical,
    selectedShift,
    recordDate,
  });
};

interface ResolveHandoffNovedadesValueParams {
  isMedical: boolean;
  selectedShift: ShiftType;
  record: Pick<
    HandoffDailyRecordContract,
    | 'date'
    | 'medicalHandoffNovedades'
    | 'medicalHandoffBySpecialty'
    | 'handoffNovedadesDayShift'
    | 'handoffNovedadesNightShift'
  >;
}

export const resolveHandoffNovedadesValue = ({
  isMedical,
  selectedShift,
  record,
}: ResolveHandoffNovedadesValueParams): string => {
  if (isMedical) return buildMedicalHandoffSummary(record);

  return resolveNursingHandoffNovedadesText({
    selectedShift,
    handoffNovedadesDayShift: record.handoffNovedadesDayShift,
    handoffNovedadesNightShift: record.handoffNovedadesNightShift,
  });
};

export const shouldShowNightCudyrActions = ({
  isMedical,
  selectedShift,
}: HandoffTitleParams): boolean => !isMedical && selectedShift === 'night';

export const resolveInitialMedicalSpecialtyFromLocation = (
  search: string | undefined
): Specialty | 'all' => {
  if (!search) {
    return 'all';
  }

  return resolveInitialMedicalSpecialtyFromSearch(search);
};

export const resolveInitialMedicalScopeFromLocation = (
  search: string | undefined
): MedicalHandoffScope => {
  if (!search) {
    return 'all';
  }

  return resolveInitialMedicalScopeFromSearch(search);
};

export const resolveInitialMedicalFiltersFromLocation = (
  search: string | undefined
): {
  initialMedicalSpecialty: Specialty | 'all';
  initialMedicalScope: MedicalHandoffScope;
} => ({
  initialMedicalSpecialty: resolveInitialMedicalSpecialtyFromLocation(search),
  initialMedicalScope: resolveInitialMedicalScopeFromLocation(search),
});

interface ResolveHandoffScreenFrameParams extends HandoffTitleParams {
  role?: UserRole;
  readOnly: boolean;
  recordDate?: string;
  todayISO?: string;
}

export const resolveHandoffScreenFrame = ({
  isMedical,
  selectedShift,
  role,
  readOnly,
  recordDate,
  todayISO,
}: ResolveHandoffScreenFrameParams) => {
  const effectiveReadOnly =
    readOnly ||
    (isMedical &&
      !canEditMedicalHandoffForDate({
        role,
        readOnly,
        recordDate,
        todayISO,
      }));

  return {
    title: resolveHandoffTitle({ isMedical, selectedShift }),
    tableHeaderClass: resolveHandoffTableHeaderClass({ isMedical, selectedShift }),
    documentTitle: resolveHandoffDocumentTitle({ isMedical, selectedShift, recordDate }),
    effectiveReadOnly,
    Icon: isMedical ? Stethoscope : MessageSquare,
  };
};

export const resolveHandoffAuditDescriptor = ({
  isMedical,
  selectedShift,
}: HandoffTitleParams): {
  action: AuditAction;
  details: {
    view: 'medical_handoff' | 'nursing_handoff';
    shift: ShiftType;
  };
} => ({
  action: (isMedical ? 'VIEW_MEDICAL_HANDOFF' : 'VIEW_NURSING_HANDOFF') as AuditAction,
  details: {
    view: isMedical ? 'medical_handoff' : 'nursing_handoff',
    shift: selectedShift,
  },
});

interface HandoffScreenShellModel {
  screenFrame: ReturnType<typeof resolveHandoffScreenFrame>;
  auditDescriptor: ReturnType<typeof resolveHandoffAuditDescriptor>;
  medicalCapabilities: MedicalHandoffCapabilities;
}

interface BuildHandoffScreenShellModelParams extends ResolveHandoffScreenFrameParams {
  selectedShift: ShiftType;
}

export const buildHandoffScreenShellModel = ({
  isMedical,
  selectedShift,
  role,
  readOnly,
  recordDate,
  todayISO,
}: BuildHandoffScreenShellModelParams): HandoffScreenShellModel => {
  const screenFrame = resolveHandoffScreenFrame({
    isMedical,
    selectedShift,
    role,
    readOnly,
    recordDate,
    todayISO,
  });

  return {
    screenFrame,
    auditDescriptor: resolveHandoffAuditDescriptor({
      isMedical,
      selectedShift,
    }),
    medicalCapabilities: resolveMedicalHandoffCapabilities({
      role,
      readOnly: screenFrame.effectiveReadOnly,
      recordDate,
      todayISO,
    }),
  };
};

interface HandoffHeaderBindings {
  isMedical: boolean;
  selectedShift: ShiftType;
  setSelectedShift: (shift: ShiftType) => void;
  readOnly: boolean;
  showMedicalShareActions: boolean;
  medicalSignature?: {
    doctorName: string;
    signedAt: string;
  } | null;
  medicalHandoffSentAt?: string | null;
  onSendWhatsApp?: () => void;
  onShareLink?: (scope: MedicalHandoffScope) => void;
  showNightCudyrAction: boolean;
}

interface HandoffChecklistSectionViewModel {
  shouldRender: boolean;
  showShiftSwitcher: boolean;
  isReceivesEditable: boolean;
  activeChecklistShift: ShiftType;
}

export const buildHandoffChecklistSectionViewModel = ({
  isMedical,
  selectedShift,
  readOnly,
  hasShiftSwitcher,
}: {
  isMedical: boolean;
  selectedShift: ShiftType;
  readOnly: boolean;
  hasShiftSwitcher: boolean;
}): HandoffChecklistSectionViewModel => ({
  shouldRender: !isMedical,
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
  isMedical,
  selectedShift,
  record,
  readOnly,
  onUpdateHandoffNovedades,
}: {
  isMedical: boolean;
  selectedShift: ShiftType;
  record: Pick<
    HandoffDailyRecordContract,
    | 'date'
    | 'medicalHandoffNovedades'
    | 'medicalHandoffBySpecialty'
    | 'handoffNovedadesDayShift'
    | 'handoffNovedadesNightShift'
  >;
  readOnly: boolean;
  onUpdateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
}): HandoffNovedadesBindings => ({
  value: resolveHandoffNovedadesValue({
    isMedical,
    selectedShift,
    record,
  }),
  readOnly,
  onChange: value => onUpdateHandoffNovedades(isMedical ? 'medical' : selectedShift, value),
});

interface BuildHandoffHeaderBindingsParams {
  isMedical: boolean;
  selectedShift: ShiftType;
  setSelectedShift: (shift: ShiftType) => void;
  readOnly: boolean;
  canShareSignatureLinks: boolean;
  medicalSignature?: { doctorName: string; signedAt: string } | null;
  medicalHandoffSentAt?: string | null;
  onSendWhatsApp?: () => void;
  onShareLink?: (scope: MedicalHandoffScope) => void;
}

export const buildHandoffHeaderBindings = ({
  isMedical,
  selectedShift,
  setSelectedShift,
  readOnly,
  canShareSignatureLinks,
  medicalSignature,
  medicalHandoffSentAt,
  onSendWhatsApp,
  onShareLink,
}: BuildHandoffHeaderBindingsParams): HandoffHeaderBindings => ({
  isMedical,
  selectedShift,
  setSelectedShift,
  readOnly,
  showMedicalShareActions: canShareSignatureLinks && !readOnly,
  medicalSignature,
  medicalHandoffSentAt,
  onSendWhatsApp,
  onShareLink,
  showNightCudyrAction: shouldShowNightCudyrActions({ isMedical, selectedShift }),
});

interface MedicalHandoffContentBindings {
  record: HandoffDailyRecordContract;
  effectiveVisibleBeds: BedDefinition[];
  specialtyFilteredBeds: BedDefinition[];
  readOnly: boolean;
  role?: string;
  canCopySpecialistLink: boolean;
  scopedMedicalSignature: { doctorName: string; signedAt: string } | null;
  scopedMedicalHandoffSentAt: string | null;
  showDeliverySection: boolean;
  canEditDoctorName: boolean;
  canSignMedicalHandoff: boolean;
  updateMedicalHandoffDoctor?: (doctorName: string) => Promise<void>;
  markMedicalHandoffAsSent?: (doctorName?: string, scope?: MedicalHandoffScope) => Promise<void>;
  resetMedicalHandoffState?: () => Promise<void>;
  selectedMedicalSpecialty: Specialty | 'all';
  setSelectedMedicalSpecialty: (specialty: Specialty | 'all') => void;
  medicalSpecialties: Specialty[];
  success: (message: string, description?: string) => void;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift' | 'medicalHandoffNote';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  medicalActions: HandoffMedicalActions;
  clinicalEventActions: HandoffClinicalEventActions;
  tableHeaderClass: string;
  shouldShowPatient: (bedId: string) => boolean;
  scopedMedicalScope: MedicalHandoffScope;
  hasAnyVisiblePatients: boolean;
  onSendWhatsApp?: () => void;
  onShareLink?: (scope: MedicalHandoffScope) => void;
  canPrint: boolean;
}

export const buildMedicalHandoffContentBindings = (
  bindings: MedicalHandoffContentBindings
): MedicalHandoffContentBindings => bindings;

interface NursingHandoffContentBindings {
  visibleBeds: BedDefinition[];
  record: HandoffDailyRecordContract;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift' | 'medicalHandoffNote';
  onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
  medicalActions: HandoffMedicalActions;
  tableHeaderClass: string;
  readOnly: boolean;
  hasAnyPatients: boolean;
  shouldShowPatient: (bedId: string) => boolean;
  clinicalEventActions: HandoffClinicalEventActions;
  selectedShift: ShiftType;
  updateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
}

export const buildNursingHandoffContentBindings = (
  bindings: NursingHandoffContentBindings
): NursingHandoffContentBindings => bindings;
