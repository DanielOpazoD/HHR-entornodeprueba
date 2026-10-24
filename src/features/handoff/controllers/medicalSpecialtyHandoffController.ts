import { readClinicalTimestamp } from '@/utils/dateDisplayUtils';
import type { AuthUser } from '@/types/authRoleTypes';
import type {
  DailyRecord,
  MedicalHandoffActor,
  MedicalHandoffDailyContinuityEntry,
  MedicalSpecialty,
  MedicalSpecialtyHandoffNote,
} from '@/domain/handoff/recordContracts';
import {
  canEditMedicalHandoffForDate,
  canManageAllMedicalSpecialties,
} from '@/shared/access/operationalAccessPolicy';
import { getMedicalSpecialtyContinuityHint } from '@/shared/handoff/handoffPresentation';

export const MEDICAL_SPECIALTY_ORDER: readonly MedicalSpecialty[] = [
  'cirugia',
  'traumatologia',
  'ginecobstetricia',
  'pediatria',
  'psiquiatria',
  'medicinaInterna',
] as const;

export const DEFAULT_NO_CHANGES_COMMENT =
  'Condición actual sin cambios respecto a última entrega de especialista.';

const MEDICAL_SPECIALTY_LABELS: Record<MedicalSpecialty, string> = {
  cirugia: 'Cirugía',
  traumatologia: 'Traumatología',
  ginecobstetricia: 'Ginecobstetricia',
  pediatria: 'Pediatría',
  psiquiatria: 'Psiquiatría',
  medicinaInterna: 'Medicina Interna',
};

export type MedicalSpecialtyDailyStatus =
  | 'updated_by_specialist'
  | 'confirmed_no_changes'
  | 'pending';

export interface MedicalSpecialtyTabState {
  specialty: MedicalSpecialty;
  label: string;
  status: MedicalSpecialtyDailyStatus;
  isEditable: boolean;
  isActive: boolean;
}

export const getMedicalSpecialtyLabel = (specialty: MedicalSpecialty): string =>
  MEDICAL_SPECIALTY_LABELS[specialty];

export const getMedicalSpecialtyNote = (
  record: Pick<DailyRecord, 'medicalHandoffBySpecialty'>,
  specialty: MedicalSpecialty
): MedicalSpecialtyHandoffNote | undefined => record.medicalHandoffBySpecialty?.[specialty];

export const resolveMedicalSpecialtyDailyStatus = (
  note: MedicalSpecialtyHandoffNote | undefined,
  dateKey: string
): MedicalSpecialtyDailyStatus => {
  if (!note) return 'pending';
  if (readClinicalTimestamp(note.updatedAt || '')?.iso === dateKey) return 'updated_by_specialist';

  const continuity = note.dailyContinuity?.[dateKey];
  if (continuity?.status === 'confirmed_no_changes') return 'confirmed_no_changes';
  if (continuity?.status === 'updated_by_specialist') return 'updated_by_specialist';

  return 'pending';
};

export const resolveEditableMedicalSpecialties = (
  user: AuthUser | null | undefined,
  role: string | undefined,
  options?: {
    readOnly?: boolean;
    recordDate?: string;
    todayISO?: string;
  }
): MedicalSpecialty[] => {
  if (
    !canEditMedicalHandoffForDate({
      role,
      readOnly: options?.readOnly ?? false,
      recordDate: options?.recordDate,
      todayISO: options?.todayISO,
    })
  ) {
    return [];
  }

  const claimedSpecialties = (user?.medicalSpecialties || []).filter(
    (value): value is MedicalSpecialty =>
      MEDICAL_SPECIALTY_ORDER.includes(value as MedicalSpecialty)
  );

  if (claimedSpecialties.length > 0) return claimedSpecialties;
  if (canManageAllMedicalSpecialties(role)) return [...MEDICAL_SPECIALTY_ORDER];

  return [];
};

export const canConfirmMedicalSpecialtyNoChanges = (role: string | undefined): boolean =>
  role === 'admin' || role === 'nurse_hospital' || role === 'editor';

export const buildMedicalSpecialtyActor = (
  user: AuthUser | null | undefined,
  role?: string
): Partial<MedicalHandoffActor> => ({
  uid: user?.uid,
  email: user?.email || undefined,
  displayName: user?.displayName || user?.email || undefined,
  role,
});

export const resolveActiveMedicalSpecialty = ({
  activeSpecialty,
  editableSpecialties,
}: {
  activeSpecialty: MedicalSpecialty;
  editableSpecialties: MedicalSpecialty[];
}): MedicalSpecialty =>
  editableSpecialties.length > 0 && !editableSpecialties.includes(activeSpecialty)
    ? editableSpecialties[0]
    : activeSpecialty;

export const resolveMedicalSpecialtyContinuityDraft = ({
  drafts,
  specialty,
  note,
  dateKey,
}: {
  drafts: Partial<Record<MedicalSpecialty, string>>;
  specialty: MedicalSpecialty;
  note: MedicalSpecialtyHandoffNote | undefined;
  dateKey: string;
}): string =>
  drafts[specialty] || note?.dailyContinuity?.[dateKey]?.comment || DEFAULT_NO_CHANGES_COMMENT;

export const buildMedicalSpecialtyTabState = ({
  specialty,
  record,
  dateKey,
  editableSpecialties,
  readOnly,
  activeSpecialty,
}: {
  specialty: MedicalSpecialty;
  record: Pick<DailyRecord, 'medicalHandoffBySpecialty'>;
  dateKey: string;
  editableSpecialties: MedicalSpecialty[];
  readOnly: boolean;
  activeSpecialty: MedicalSpecialty;
}): MedicalSpecialtyTabState => ({
  specialty,
  label: getMedicalSpecialtyLabel(specialty),
  status: resolveMedicalSpecialtyDailyStatus(getMedicalSpecialtyNote(record, specialty), dateKey),
  isEditable: editableSpecialties.includes(specialty) && !readOnly,
  isActive: activeSpecialty === specialty,
});

export const buildMedicalSpecialtyTabsState = ({
  record,
  dateKey,
  editableSpecialties,
  readOnly,
  activeSpecialty,
}: {
  record: Pick<DailyRecord, 'medicalHandoffBySpecialty'>;
  dateKey: string;
  editableSpecialties: MedicalSpecialty[];
  readOnly: boolean;
  activeSpecialty: MedicalSpecialty;
}): MedicalSpecialtyTabState[] =>
  MEDICAL_SPECIALTY_ORDER.map(specialty =>
    buildMedicalSpecialtyTabState({
      specialty,
      record,
      dateKey,
      editableSpecialties,
      readOnly,
      activeSpecialty,
    })
  );

export const resolveMedicalSpecialtyContinuityEditorState = ({
  role,
  readOnly,
  activeStatus,
}: {
  role?: string;
  readOnly: boolean;
  activeStatus: MedicalSpecialtyDailyStatus;
}): {
  canConfirmToday: boolean;
  isCommentDisabled: boolean;
  helperText: string;
} => {
  const canConfirmToday = canConfirmMedicalSpecialtyNoChanges(role) && !readOnly;

  return {
    canConfirmToday,
    isCommentDisabled: !canConfirmToday || activeStatus === 'updated_by_specialist',
    helperText: canConfirmToday
      ? activeStatus === 'pending'
        ? 'Usa este comentario cuando la condición permanezca sin cambios respecto a la última nota del especialista.'
        : getMedicalSpecialtyContinuityHint(activeStatus)
      : readOnly
        ? 'Solo lectura para este registro.'
        : 'Solo un usuario autorizado puede confirmar continuidad.',
  };
};

export const hasMedicalSpecialtyStructuredData = (
  record: Pick<DailyRecord, 'medicalHandoffBySpecialty'>
): boolean =>
  MEDICAL_SPECIALTY_ORDER.some(specialty => Boolean(getMedicalSpecialtyNote(record, specialty)));

export interface PrintableMedicalSpecialtyBlock {
  specialty: MedicalSpecialty;
  title: string;
  content?: string;
  continuityComment?: string;
}

export interface MedicalSpecialtySectionViewModel {
  tabStates: MedicalSpecialtyTabState[];
  resolvedActiveSpecialty: MedicalSpecialty;
  activeNote: MedicalSpecialtyHandoffNote | undefined;
  activeStatus: MedicalSpecialtyDailyStatus;
  activeContinuity: MedicalHandoffDailyContinuityEntry | undefined;
  canEditActiveSpecialty: boolean;
  activeContinuityDraft: string;
  hasSpecialtyData: boolean;
  printableBlocks: PrintableMedicalSpecialtyBlock[];
  continuityEditorState: ReturnType<typeof resolveMedicalSpecialtyContinuityEditorState>;
}

export const buildPrintableMedicalSpecialtyBlocks = (
  record: Pick<DailyRecord, 'date' | 'medicalHandoffBySpecialty'>
): PrintableMedicalSpecialtyBlock[] =>
  MEDICAL_SPECIALTY_ORDER.flatMap(specialty => {
    const note = getMedicalSpecialtyNote(record, specialty);
    const status = resolveMedicalSpecialtyDailyStatus(note, record.date);
    const continuity = note?.dailyContinuity?.[record.date];
    const content = note?.note?.trim();
    const continuityComment =
      status === 'confirmed_no_changes'
        ? continuity?.comment?.trim() || DEFAULT_NO_CHANGES_COMMENT
        : undefined;

    if (!content && !continuityComment) {
      return [];
    }

    return [
      {
        specialty,
        title: getMedicalSpecialtyLabel(specialty),
        content,
        continuityComment,
      },
    ];
  });

export const buildMedicalSpecialtySectionViewModel = ({
  record,
  role,
  readOnly,
  activeSpecialty,
  editableSpecialties,
  continuityDrafts,
}: {
  record: Pick<DailyRecord, 'date' | 'medicalHandoffBySpecialty'>;
  role?: string;
  readOnly: boolean;
  activeSpecialty: MedicalSpecialty;
  editableSpecialties: MedicalSpecialty[];
  continuityDrafts: Partial<Record<MedicalSpecialty, string>>;
}): MedicalSpecialtySectionViewModel => {
  const resolvedActiveSpecialty = resolveActiveMedicalSpecialty({
    activeSpecialty,
    editableSpecialties,
  });
  const activeNote = getMedicalSpecialtyNote(record, resolvedActiveSpecialty);
  const activeStatus = resolveMedicalSpecialtyDailyStatus(activeNote, record.date);

  return {
    tabStates: buildMedicalSpecialtyTabsState({
      record,
      dateKey: record.date,
      editableSpecialties,
      readOnly,
      activeSpecialty: resolvedActiveSpecialty,
    }),
    resolvedActiveSpecialty,
    activeNote,
    activeStatus,
    activeContinuity: activeNote?.dailyContinuity?.[record.date],
    canEditActiveSpecialty: !readOnly && editableSpecialties.includes(resolvedActiveSpecialty),
    activeContinuityDraft: resolveMedicalSpecialtyContinuityDraft({
      drafts: continuityDrafts,
      specialty: resolvedActiveSpecialty,
      note: activeNote,
      dateKey: record.date,
    }),
    hasSpecialtyData: hasMedicalSpecialtyStructuredData(record),
    printableBlocks: buildPrintableMedicalSpecialtyBlocks(record),
    continuityEditorState: resolveMedicalSpecialtyContinuityEditorState({
      role,
      readOnly,
      activeStatus,
    }),
  };
};

const buildSpecialtySummaryBlock = (
  specialty: MedicalSpecialty,
  note: MedicalSpecialtyHandoffNote,
  dateKey: string
): string => {
  const lines = [getMedicalSpecialtyLabel(specialty)];
  const trimmedNote = note.note?.trim();
  const continuity = note.dailyContinuity?.[dateKey];
  const status = resolveMedicalSpecialtyDailyStatus(note, dateKey);

  if (trimmedNote) {
    lines.push(trimmedNote);
  }

  if (status === 'confirmed_no_changes') {
    lines.push(continuity?.comment?.trim() || DEFAULT_NO_CHANGES_COMMENT);
  }

  return lines.join('\n');
};

export const buildMedicalHandoffSummary = (
  record: Pick<DailyRecord, 'date' | 'medicalHandoffNovedades' | 'medicalHandoffBySpecialty'>
): string => {
  const specialtyBlocks = MEDICAL_SPECIALTY_ORDER.map(specialty => {
    const note = record.medicalHandoffBySpecialty?.[specialty];
    if (!note) return null;

    const hasNote = Boolean(note.note?.trim());
    const hasContinuity = Boolean(note.dailyContinuity?.[record.date]);
    if (!hasNote && !hasContinuity) return null;

    return buildSpecialtySummaryBlock(specialty, note, record.date);
  }).filter((value): value is string => Boolean(value));

  if (specialtyBlocks.length > 0) {
    return specialtyBlocks.join('\n\n');
  }

  return record.medicalHandoffNovedades || '';
};
