import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type {
  MedicalHandoffActor,
  MedicalSpecialty,
} from '@/application/shared/dailyRecordMedicalContracts';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import {
  buildUpdatedHandoffStaffRecord,
  buildMedicalNoChangesRecord,
  buildMedicalSpecialtyNoteRecord,
  normalizeMedicalHandoffActor,
} from '@/domain/handoff/management';
import type { ConfirmMedicalSpecialtyNoChangesInput } from '@/hooks/handoffManagementTypes';

type HandoffShift = 'day' | 'night' | 'medical';
type StaffShift = 'day' | 'night';
type StaffType = 'delivers' | 'receives' | 'tens';

export interface HandoffAuditEventPayload {
  action: 'HANDOFF_NOVEDADES_MODIFIED' | 'MEDICAL_HANDOFF_SIGNED' | 'MEDICAL_HANDOFF_RESTORED';
  entityType: 'dailyRecord';
  entityId: string;
  details: Record<string, unknown>;
  recordDate: string;
  authors?: string;
}

export const buildHandoffNovedadesAuditPayload = (
  record: DailyRecord,
  shift: HandoffShift,
  value: string,
  userId: string
): { authors: string; details: Record<string, unknown> } => {
  const authors = getAttributedAuthors(
    userId,
    record,
    shift === 'medical' ? undefined : (shift as 'day' | 'night')
  );
  const previousValue =
    shift === 'day'
      ? record.handoffNovedadesDayShift
      : shift === 'night'
        ? record.handoffNovedadesNightShift
        : record.medicalHandoffNovedades;

  return {
    authors: authors ?? '',
    details: {
      shift,
      content: value,
      changes: {
        novedades: { old: previousValue || '', new: value },
      },
    },
  };
};

export const buildHandoffNovedadesAuditEvent = (
  record: DailyRecord,
  shift: HandoffShift,
  value: string,
  userId: string
): HandoffAuditEventPayload => {
  const { authors, details } = buildHandoffNovedadesAuditPayload(record, shift, value, userId);
  return {
    action: 'HANDOFF_NOVEDADES_MODIFIED',
    entityType: 'dailyRecord',
    entityId: record.date,
    details,
    recordDate: record.date,
    authors,
  };
};

export const buildMedicalSpecialtyNoteAuditPayload = (
  record: DailyRecord,
  specialty: MedicalSpecialty,
  value: string
): Record<string, unknown> => ({
  shift: 'medical',
  specialty,
  value,
  operation: 'specialty_note_update',
  changes: {
    novedades: { old: record.medicalHandoffBySpecialty?.[specialty]?.note || '', new: value },
  },
});

export const buildMedicalSpecialtyPersistencePayload = (
  record: DailyRecord,
  specialty: MedicalSpecialty,
  value: string,
  actor: Partial<MedicalHandoffActor>
): { updatedRecord: DailyRecord; auditDetails: Record<string, unknown> } => {
  const updatedRecord = buildMedicalSpecialtyNoteRecord(record, specialty, value, actor);
  return {
    updatedRecord,
    auditDetails: buildMedicalSpecialtyNoteAuditPayload(record, specialty, value),
  };
};

export const buildMedicalSpecialtyAuditEvent = (
  record: DailyRecord,
  specialty: MedicalSpecialty,
  value: string
): HandoffAuditEventPayload => ({
  action: 'HANDOFF_NOVEDADES_MODIFIED',
  entityType: 'dailyRecord',
  entityId: record.date,
  details: buildMedicalSpecialtyNoteAuditPayload(record, specialty, value),
  recordDate: record.date,
});

export const buildMedicalNoChangesAuditPayload = (
  updatedRecord: DailyRecord,
  specialty: MedicalSpecialty,
  actor: Partial<MedicalHandoffActor>,
  effectiveDateKey: string,
  confirmedAt: string
): Record<string, unknown> => {
  const normalizedActor = normalizeMedicalHandoffActor(actor, specialty);

  return {
    shift: 'medical',
    specialty,
    operation: 'confirm_no_changes',
    comment:
      updatedRecord.medicalHandoffBySpecialty?.[specialty]?.dailyContinuity?.[effectiveDateKey]
        ?.comment,
    confirmedAt,
    confirmedBy: normalizedActor.displayName,
  };
};

export const buildMedicalNoChangesPersistencePayload = (
  record: DailyRecord,
  input: ConfirmMedicalSpecialtyNoChangesInput
): {
  updatedRecord: DailyRecord;
  auditDetails: Record<string, unknown>;
  effectiveDateKey: string;
  confirmedAt: string;
} => {
  const effectiveDateKey = input.dateKey || record.date;
  const confirmedAt = new Date().toISOString();
  const updatedRecord = buildMedicalNoChangesRecord(
    record,
    input.specialty,
    input.actor,
    input.comment,
    effectiveDateKey
  );

  return {
    updatedRecord,
    auditDetails: buildMedicalNoChangesAuditPayload(
      updatedRecord,
      input.specialty,
      input.actor,
      effectiveDateKey,
      confirmedAt
    ),
    effectiveDateKey,
    confirmedAt,
  };
};

export const buildMedicalNoChangesAuditEvent = (
  record: DailyRecord,
  auditDetails: Record<string, unknown>
): HandoffAuditEventPayload => ({
  action: 'HANDOFF_NOVEDADES_MODIFIED',
  entityType: 'dailyRecord',
  entityId: record.date,
  details: auditDetails,
  recordDate: record.date,
});

export const buildUpdatedHandoffStaffPersistencePayload = (
  currentRecord: DailyRecord,
  shift: StaffShift,
  type: StaffType,
  staffList: string[]
): { updatedRecord: DailyRecord } => ({
  updatedRecord: buildUpdatedHandoffStaffRecord(currentRecord, shift, type, staffList),
});

export { buildUpdatedHandoffStaffRecord };

export const buildMedicalSignatureAuditPayload = (
  updatedRecord: DailyRecord,
  doctorName: string,
  scope: MedicalHandoffScope
): Record<string, unknown> => ({
  doctorName,
  signedAt: updatedRecord.medicalSignatureByScope?.[scope]?.signedAt,
  scope,
});

export const buildMedicalSignatureAuditEvent = (
  record: DailyRecord,
  updatedRecord: DailyRecord,
  doctorName: string,
  scope: MedicalHandoffScope
): HandoffAuditEventPayload => ({
  action: 'MEDICAL_HANDOFF_SIGNED',
  entityType: 'dailyRecord',
  entityId: record.date,
  details: buildMedicalSignatureAuditPayload(updatedRecord, doctorName, scope),
  recordDate: record.date,
});

export const buildUpdatedMedicalHandoffDoctorRecord = (
  currentRecord: DailyRecord,
  doctorName: string
): DailyRecord => ({
  ...currentRecord,
  medicalHandoffDoctor: doctorName,
  lastUpdated: new Date().toISOString(),
});

export const buildMedicalHandoffDoctorPersistencePayload = (
  currentRecord: DailyRecord,
  doctorName: string
): { updatedRecord: DailyRecord } => ({
  updatedRecord: buildUpdatedMedicalHandoffDoctorRecord(currentRecord, doctorName),
});

export const buildResetMedicalHandoffAuditPayload = (
  record: DailyRecord
): Record<string, unknown> => {
  const clearedFields: string[] = [];

  if (record.medicalHandoffSentAt) {
    clearedFields.push('entrega');
  }

  if (record.medicalSignature) {
    clearedFields.push('firma');
  }

  return {
    clearedFields,
    hadMedicalHandoffSentAt: Boolean(record.medicalHandoffSentAt),
    hadMedicalSignature: Boolean(record.medicalSignature),
    hadScopedMedicalHandoffSentAt: Boolean(
      record.medicalHandoffSentAtByScope &&
      Object.keys(record.medicalHandoffSentAtByScope).length > 0
    ),
    hadScopedMedicalSignature: Boolean(
      record.medicalSignatureByScope && Object.keys(record.medicalSignatureByScope).length > 0
    ),
    doctorName: record.medicalHandoffDoctor || '',
  };
};

export const buildResetMedicalHandoffAuditEvent = (
  record: DailyRecord
): HandoffAuditEventPayload => ({
  action: 'MEDICAL_HANDOFF_RESTORED',
  entityType: 'dailyRecord',
  entityId: record.date,
  details: buildResetMedicalHandoffAuditPayload(record),
  recordDate: record.date,
});
