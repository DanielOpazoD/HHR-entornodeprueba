import { readClinicalTimestamp } from '@/utils/dateDisplayUtils';
import type { AuthUser } from '@/types/authRoleTypes';
import type { DailyRecordMedicalHandoffSummaryState } from '@/types/domain/dailyRecordSlices';
import type {
  MedicalSpecialty,
  MedicalSpecialtyHandoffNote,
} from '@/types/domain/dailyRecordMedicalHandoff';
import { canManageAllMedicalSpecialties } from '@/shared/access/operationalAccessPolicy';

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

export const getMedicalSpecialtyLabel = (specialty: MedicalSpecialty): string =>
  MEDICAL_SPECIALTY_LABELS[specialty];

export const getMedicalSpecialtyNote = (
  record: Pick<DailyRecordMedicalHandoffSummaryState, 'medicalHandoffBySpecialty'>,
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
  role: string | undefined
): MedicalSpecialty[] => {
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
  record: DailyRecordMedicalHandoffSummaryState
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
