import type { MedicalPatientHandoffContract } from '@/application/handoff/medicalPatientContracts';
import type {
  MedicalHandoffAuditActor,
  MedicalHandoffEntry,
  PatientData,
} from '@/types/domain/patient';

import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { createApplicationSuccess } from '@/shared/contracts/applicationOutcomeFactories';
import {
  buildMedicalEntryAddFields,
  buildMedicalEntryContinuityFields,
  buildMedicalEntryDeleteFields,
  buildMedicalEntryNoteFields,
  buildMedicalEntryRefreshFields,
  buildMedicalEntrySpecialtyFields,
  buildMedicalPrimaryEntryCreateFields,
  buildMedicalPrimaryNoteFields,
} from '@/domain/handoff/patientEntryMutations';
import {
  buildMedicalHandoffFieldsFromEntries,
  getPatientMedicalHandoffEntries,
} from '@/domain/handoff/patientEntries';

import {
  createNoEffectOutcome,
  createUnknownOutcome,
  createValidationOutcome,
} from './handoffUseCaseSupport';

export type MedicalPatientFields = Pick<
  MedicalPatientHandoffContract,
  'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'
>;

interface MedicalPatientMutationInput {
  patient: PatientData | null | undefined;
  persistMedicalFields: (fields: MedicalPatientFields) => Promise<void>;
}

interface MedicalPatientTimedMutationInput extends MedicalPatientMutationInput {
  now?: string;
  recordDate: string;
}

export interface MedicalPatientHandoffMutationOutput {
  entry: MedicalHandoffEntry | null;
  fields: MedicalPatientFields;
  previousEntry: MedicalHandoffEntry | null;
}

interface UpdateMedicalPrimaryNoteInput extends MedicalPatientTimedMutationInput {
  medicalAuditActor: MedicalHandoffAuditActor | null;
  value: string;
}

interface UpdateMedicalEntryNoteInput extends MedicalPatientTimedMutationInput {
  entryId: string;
  medicalAuditActor: MedicalHandoffAuditActor | null;
  value: string;
}

interface UpdateMedicalEntrySpecialtyInput extends MedicalPatientMutationInput {
  entryId: string;
  specialty: string;
}

interface DeleteMedicalEntryInput extends MedicalPatientMutationInput {
  entryId: string;
}

interface ConfirmMedicalEntryContinuityInput extends MedicalPatientTimedMutationInput {
  entryId: string;
  medicalAuditActor: MedicalHandoffAuditActor | null;
}

interface RefreshMedicalEntryAsCurrentInput extends MedicalPatientTimedMutationInput {
  entryId: string;
  medicalAuditActor: MedicalHandoffAuditActor | null;
}

const createMissingPatientOutcome = <T>(data: T, operation: string) =>
  createValidationOutcome(data, operation, 'missing_patient', 'No hay paciente disponible.');

const createMissingEntryOutcome = <T>(data: T, operation: string) =>
  createValidationOutcome(
    data,
    operation,
    'missing_entry',
    'No existe la entrada médica solicitada.'
  );

const findMedicalEntry = (patient: PatientData, entryId: string): MedicalHandoffEntry | null =>
  getPatientMedicalHandoffEntries(patient).find(entry => entry.id === entryId) || null;

const resolveNow = (value?: string): string => value || new Date().toISOString();

const persistMedicalMutation = async (
  operation: string,
  persistMedicalFields: (fields: MedicalPatientFields) => Promise<void>,
  output: MedicalPatientHandoffMutationOutput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  try {
    await persistMedicalFields(output.fields);
    return createApplicationSuccess(output);
  } catch (error) {
    return createUnknownOutcome(
      null,
      operation,
      'No se pudo guardar la entrega médica del paciente.',
      error
    );
  }
};

export const executeUpdateMedicalPrimaryNote = async (
  input: UpdateMedicalPrimaryNoteInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'update_medical_primary_note');
  }

  const previousEntry = getPatientMedicalHandoffEntries(input.patient)[0] || null;
  const { entry, fields } = buildMedicalPrimaryNoteFields(
    input.patient,
    input.value,
    input.medicalAuditActor,
    input.recordDate,
    resolveNow(input.now)
  );

  return persistMedicalMutation('update_medical_primary_note', input.persistMedicalFields, {
    entry,
    fields,
    previousEntry,
  });
};

export const executeUpdateMedicalEntryNote = async (
  input: UpdateMedicalEntryNoteInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'update_medical_entry_note');
  }

  const previousEntry = findMedicalEntry(input.patient, input.entryId);
  if (!previousEntry) {
    return createMissingEntryOutcome(null, 'update_medical_entry_note');
  }

  const { entry, fields } = buildMedicalEntryNoteFields(
    input.patient,
    input.entryId,
    input.value,
    input.medicalAuditActor,
    input.recordDate,
    resolveNow(input.now)
  );

  return persistMedicalMutation('update_medical_entry_note', input.persistMedicalFields, {
    entry,
    fields,
    previousEntry,
  });
};

export const executeUpdateMedicalEntrySpecialty = async (
  input: UpdateMedicalEntrySpecialtyInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'update_medical_entry_specialty');
  }

  const previousEntry = findMedicalEntry(input.patient, input.entryId);
  if (!previousEntry) {
    return createMissingEntryOutcome(null, 'update_medical_entry_specialty');
  }

  const { entry, fields } = buildMedicalEntrySpecialtyFields(
    input.patient,
    input.entryId,
    input.specialty
  );

  return persistMedicalMutation('update_medical_entry_specialty', input.persistMedicalFields, {
    entry,
    fields,
    previousEntry,
  });
};

export const executeAddMedicalEntry = async (
  input: MedicalPatientMutationInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'add_medical_entry');
  }

  const previousEntries = getPatientMedicalHandoffEntries(input.patient);
  const fields = buildMedicalEntryAddFields(input.patient);
  const entry =
    fields.medicalHandoffEntries?.find(
      candidate => !previousEntries.some(previous => previous.id === candidate.id)
    ) ||
    fields.medicalHandoffEntries?.[fields.medicalHandoffEntries.length - 1] ||
    null;

  return persistMedicalMutation('add_medical_entry', input.persistMedicalFields, {
    entry,
    fields,
    previousEntry: null,
  });
};

export const executeCreateMedicalPrimaryEntry = async (
  input: MedicalPatientMutationInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'create_medical_primary_entry');
  }

  const previousEntries = getPatientMedicalHandoffEntries(input.patient);
  if (previousEntries.length > 0) {
    return createNoEffectOutcome(
      {
        entry: previousEntries[0] || null,
        fields: buildMedicalHandoffFieldsFromEntries(input.patient, previousEntries),
        previousEntry: previousEntries[0] || null,
      },
      'create_medical_primary_entry',
      'La entrega médica primaria ya existe para este paciente.'
    );
  }

  const fields = buildMedicalPrimaryEntryCreateFields(input.patient);
  return persistMedicalMutation('create_medical_primary_entry', input.persistMedicalFields, {
    entry: fields.medicalHandoffEntries?.[0] || null,
    fields,
    previousEntry: null,
  });
};

export const executeDeleteMedicalEntry = async (
  input: DeleteMedicalEntryInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'delete_medical_entry');
  }

  const mutation = buildMedicalEntryDeleteFields(input.patient, input.entryId);
  if (!mutation) {
    return createMissingEntryOutcome(null, 'delete_medical_entry');
  }

  return persistMedicalMutation('delete_medical_entry', input.persistMedicalFields, {
    entry: mutation.entry,
    fields: mutation.fields,
    previousEntry: mutation.entry,
  });
};

export const executeConfirmMedicalEntryContinuity = async (
  input: ConfirmMedicalEntryContinuityInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'confirm_medical_entry_continuity');
  }

  if (!input.medicalAuditActor) {
    return createValidationOutcome(
      null,
      'confirm_medical_entry_continuity',
      'missing_audit_actor',
      'No hay usuario disponible para confirmar continuidad.'
    );
  }

  const previousEntry = findMedicalEntry(input.patient, input.entryId);
  if (!previousEntry) {
    return createMissingEntryOutcome(null, 'confirm_medical_entry_continuity');
  }

  if (!previousEntry.note.trim()) {
    return createValidationOutcome(
      null,
      'confirm_medical_entry_continuity',
      'empty_entry_note',
      'La entrada médica no tiene contenido para confirmar continuidad.'
    );
  }

  const mutation = buildMedicalEntryContinuityFields(
    input.patient,
    input.entryId,
    input.medicalAuditActor,
    input.recordDate,
    resolveNow(input.now)
  );
  if (!mutation) {
    return createValidationOutcome(
      null,
      'confirm_medical_entry_continuity',
      'missing_entry',
      'No existe la entrada médica solicitada.'
    );
  }

  return persistMedicalMutation('confirm_medical_entry_continuity', input.persistMedicalFields, {
    entry: mutation.entry,
    fields: mutation.fields,
    previousEntry,
  });
};

export const executeRefreshMedicalEntryAsCurrent = async (
  input: RefreshMedicalEntryAsCurrentInput
): Promise<ApplicationOutcome<MedicalPatientHandoffMutationOutput | null>> => {
  if (!input.patient) {
    return createMissingPatientOutcome(null, 'refresh_medical_entry_as_current');
  }

  const previousEntry =
    getPatientMedicalHandoffEntries(input.patient).find(entry => entry.id === input.entryId) ||
    null;
  if (!previousEntry) {
    return createValidationOutcome(
      null,
      'refresh_medical_entry_as_current',
      'missing_entry',
      'No existe la entrada médica solicitada.'
    );
  }

  if (!previousEntry.note.trim()) {
    return createValidationOutcome(
      null,
      'refresh_medical_entry_as_current',
      'empty_entry_note',
      'La entrada médica no tiene contenido para marcarla como actual.'
    );
  }

  const mutation = buildMedicalEntryRefreshFields(
    input.patient,
    input.entryId,
    input.medicalAuditActor,
    input.recordDate,
    resolveNow(input.now)
  );
  if (!mutation) {
    return createValidationOutcome(
      null,
      'refresh_medical_entry_as_current',
      'missing_entry',
      'No existe la entrada médica solicitada.'
    );
  }

  return persistMedicalMutation('refresh_medical_entry_as_current', input.persistMedicalFields, {
    entry: mutation.entry,
    fields: mutation.fields,
    previousEntry,
  });
};
