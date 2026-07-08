import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { MedicalHandoffEntry, PatientData } from '@/domain/handoff/patientContracts';

type MedicalHandoffRecord = {
  date: string;
  beds: Record<string, PatientData>;
} | null;

const SILENT_MEDICAL_PATIENT_OUTCOME_REASONS = new Set([
  'missing_patient',
  'missing_audit_actor',
  'missing_entry',
  'empty_entry_note',
  'no_effect',
]);

export interface ResolveMedicalHandoffMutationContextInput {
  bedId: string;
  isNested: boolean;
  isMedical: boolean;
  canMutateCurrentMedicalRecord: boolean;
  record: MedicalHandoffRecord;
}

export interface MedicalHandoffMutationContext {
  bedId: string;
  isNested: boolean;
  patient: PatientData | undefined;
  recordDate: string;
}

export const resolveMedicalHandoffMutationContext = ({
  bedId,
  isNested,
  isMedical,
  canMutateCurrentMedicalRecord,
  record,
}: ResolveMedicalHandoffMutationContextInput): MedicalHandoffMutationContext | null => {
  if (!record || !isMedical || !canMutateCurrentMedicalRecord) {
    return null;
  }

  const bed = record.beds[bedId];
  return {
    bedId,
    isNested,
    patient: isNested ? bed?.clinicalCrib : bed,
    recordDate: record.date,
  };
};

export const shouldLogMedicalHandoffOutcome = <T>(outcome: ApplicationOutcome<T>): boolean =>
  !(outcome.reason && SILENT_MEDICAL_PATIENT_OUTCOME_REASONS.has(outcome.reason));

export const isSuccessfulMedicalHandoffOutcome = <T>(
  outcome: ApplicationOutcome<T>
): outcome is ApplicationOutcome<NonNullable<T>> & { status: 'success'; data: NonNullable<T> } =>
  outcome.status === 'success' && Boolean(outcome.data);

export const createMedicalFieldsPersister =
  <TFields>(
    persistMedicalFields: (bedId: string, fields: TFields, isNested: boolean) => Promise<void>,
    bedId: string,
    isNested: boolean
  ) =>
  (fields: TFields) =>
    persistMedicalFields(bedId, fields, isNested);

export const resolveRefreshableMedicalEntry = (
  patient: PatientData | null | undefined,
  entryId: string
): MedicalHandoffEntry | null => {
  const entry =
    patient?.medicalHandoffEntries?.find(currentEntry => currentEntry.id === entryId) || null;
  if (!entry?.note.trim()) {
    return null;
  }

  return entry;
};

// ─────────────────────────────────────────────────────────────────────────
// Audit payload builders for MEDICAL_HANDOFF_MODIFIED.
//
// Centralised here so the handler hook does not duplicate large inline
// objects across each handler and so the payload shape is reviewed in one
// place. Each builder returns the `details` object expected by
// useAudit().logDebouncedEvent('MEDICAL_HANDOFF_MODIFIED', 'patient', ...).
// ─────────────────────────────────────────────────────────────────────────

const resolvePatientNameForAudit = (
  patient: PatientData | null | undefined,
  isNested: boolean
): string => patient?.patientName || (isNested ? 'Cuna' : 'ANONYMOUS');

export const buildPrimaryNoteChangeAuditPayload = ({
  patient,
  isNested,
  value,
  previousNote,
}: {
  patient: PatientData | null | undefined;
  isNested: boolean;
  value: string;
  previousNote: string;
}): Record<string, unknown> => ({
  patientName: resolvePatientNameForAudit(patient, isNested),
  note: value,
  changes: {
    medicalHandoffNote: { old: previousNote, new: value },
  },
});

export const buildEntryNoteChangeAuditPayload = ({
  patient,
  specialty,
  value,
  previousNote,
}: {
  patient: PatientData | null | undefined;
  specialty: string | undefined;
  value: string;
  previousNote: string;
}): Record<string, unknown> => ({
  patientName: patient?.patientName || '',
  specialty,
  note: value,
  changes: {
    medicalHandoffNote: { old: previousNote, new: value },
  },
});

export const buildEntryDeleteAuditPayload = ({
  patient,
  specialty,
  previousNote,
}: {
  patient: PatientData | null | undefined;
  specialty: string | undefined;
  previousNote: string;
}): Record<string, unknown> => ({
  patientName: patient?.patientName || '',
  specialty,
  operation: 'delete_medical_handoff_entry',
  changes: {
    medicalHandoffNote: { old: previousNote, new: '' },
  },
});

export const buildEntryRefreshAuditPayload = ({
  patient,
  specialty,
  previousUpdatedAt,
  newUpdatedAt,
}: {
  patient: PatientData | null | undefined;
  specialty: string | undefined;
  previousUpdatedAt: string;
  newUpdatedAt: string;
}): Record<string, unknown> => ({
  patientName: patient?.patientName || '',
  specialty,
  operation: 'refresh_medical_entry_as_current',
  changes: {
    medicalHandoffNoteTimestamp: { old: previousUpdatedAt, new: newUpdatedAt },
  },
});
