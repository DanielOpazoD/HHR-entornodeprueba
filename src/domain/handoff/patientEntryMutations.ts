import type {
  MedicalHandoffAuditActor,
  MedicalHandoffEntry,
  PatientData,
} from '@/domain/handoff/patientContracts';
import {
  buildMedicalHandoffFieldsFromEntries,
  createMedicalHandoffEntry,
  getNextMedicalHandoffSpecialty,
  getPatientMedicalHandoffEntries,
} from '@/domain/handoff/patientEntries';

interface MedicalEntryMutationResult {
  entry: MedicalHandoffEntry;
  fields: Pick<PatientData, 'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'>;
}

const resolveOriginalNoteBy = (
  entry: MedicalHandoffEntry,
  actor: MedicalHandoffAuditActor | null
): MedicalHandoffAuditActor | undefined => actor || entry.updatedBy || entry.originalNoteBy;

const upsertEntry = (
  entries: MedicalHandoffEntry[],
  nextEntry: MedicalHandoffEntry,
  entryIndex: number
): MedicalHandoffEntry[] =>
  entryIndex >= 0
    ? entries.map((currentEntry, index) => (index === entryIndex ? nextEntry : currentEntry))
    : [...entries, nextEntry];

const resolveEntryForWrite = (
  patient: PatientData,
  entryId?: string
): { entries: MedicalHandoffEntry[]; entry: MedicalHandoffEntry; entryIndex: number } => {
  const entries = getPatientMedicalHandoffEntries(patient);
  if (!entryId) {
    const primaryEntry =
      entries[0] || createMedicalHandoffEntry(patient.specialty || '', { id: 'primary-note' });
    return { entries, entry: primaryEntry, entryIndex: entries.length > 0 ? 0 : -1 };
  }
  const entryIndex = entries.findIndex(entry => entry.id === entryId);
  const entry =
    entryIndex >= 0
      ? entries[entryIndex]
      : createMedicalHandoffEntry(patient.specialty || '', { id: entryId });
  return { entries, entry, entryIndex };
};

export const buildMedicalPrimaryNoteFields = (
  patient: PatientData,
  value: string,
  actor: MedicalHandoffAuditActor | null,
  reportDate: string,
  now: string
): MedicalEntryMutationResult => {
  const { entries, entry, entryIndex } = resolveEntryForWrite(patient);
  const nextEntry: MedicalHandoffEntry = {
    ...entry,
    note: value,
    originalNoteAt: now,
    originalNoteBy: resolveOriginalNoteBy(entry, actor),
    updatedAt: now,
    updatedBy: actor || entry.updatedBy,
    currentStatus: 'updated_by_specialist',
    currentStatusDate: reportDate,
    currentStatusAt: now,
    currentStatusBy: actor || entry.currentStatusBy,
  };
  const nextEntries =
    entries.length > 0
      ? [nextEntry, ...entries.slice(1)]
      : upsertEntry(entries, nextEntry, entryIndex);
  return { entry: nextEntry, fields: buildMedicalHandoffFieldsFromEntries(patient, nextEntries) };
};

export const buildMedicalEntryNoteFields = (
  patient: PatientData,
  entryId: string,
  value: string,
  actor: MedicalHandoffAuditActor | null,
  reportDate: string,
  now: string
): MedicalEntryMutationResult => {
  const { entries, entry, entryIndex } = resolveEntryForWrite(patient, entryId);
  const nextEntry: MedicalHandoffEntry = {
    ...entry,
    id:
      entryIndex >= 0
        ? entry.id
        : createMedicalHandoffEntry(entry.specialty || patient.specialty).id,
    specialty: entry.specialty || patient.specialty || '',
    note: value,
    originalNoteAt: now,
    originalNoteBy: resolveOriginalNoteBy(entry, actor),
    updatedAt: now,
    updatedBy: actor || entry.updatedBy,
    currentStatus: 'updated_by_specialist',
    currentStatusDate: reportDate,
    currentStatusAt: now,
    currentStatusBy: actor || entry.currentStatusBy,
  };
  const nextEntries = upsertEntry(entries, nextEntry, entryIndex);
  return { entry: nextEntry, fields: buildMedicalHandoffFieldsFromEntries(patient, nextEntries) };
};

export const buildMedicalEntrySpecialtyFields = (
  patient: PatientData,
  entryId: string,
  specialty: string
): MedicalEntryMutationResult => {
  const { entries, entry, entryIndex } = resolveEntryForWrite(patient, entryId);
  const nextEntry: MedicalHandoffEntry = {
    ...entry,
    id: entryIndex >= 0 ? entry.id : createMedicalHandoffEntry(specialty).id,
    specialty,
  };
  const nextEntries = upsertEntry(entries, nextEntry, entryIndex);
  return { entry: nextEntry, fields: buildMedicalHandoffFieldsFromEntries(patient, nextEntries) };
};

export const buildMedicalEntryAddFields = (
  patient: PatientData
): Pick<PatientData, 'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'> => {
  const entries = getPatientMedicalHandoffEntries(patient);
  const nextEntries =
    entries.length === 0
      ? [
          createMedicalHandoffEntry(
            patient.specialty || getNextMedicalHandoffSpecialty(patient, [])
          ),
          createMedicalHandoffEntry(
            getNextMedicalHandoffSpecialty(patient, [
              createMedicalHandoffEntry(patient.specialty || '', { id: 'primary-entry' }),
            ])
          ),
        ]
      : [...entries, createMedicalHandoffEntry(getNextMedicalHandoffSpecialty(patient, entries))];
  return buildMedicalHandoffFieldsFromEntries(patient, nextEntries);
};

export const buildMedicalPrimaryEntryCreateFields = (
  patient: PatientData
): Pick<PatientData, 'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'> => {
  const entries = getPatientMedicalHandoffEntries(patient);
  if (entries.length > 0) {
    return buildMedicalHandoffFieldsFromEntries(patient, entries);
  }

  return buildMedicalHandoffFieldsFromEntries(patient, [
    createMedicalHandoffEntry(patient.specialty || getNextMedicalHandoffSpecialty(patient, []), {
      id: 'primary-entry',
    }),
  ]);
};

export const buildMedicalEntryDeleteFields = (
  patient: PatientData,
  entryId: string
): MedicalEntryMutationResult | null => {
  const entries = getPatientMedicalHandoffEntries(patient);
  const entry = entries.find(currentEntry => currentEntry.id === entryId);
  if (!entry) return null;
  const nextEntries = entries.filter(currentEntry => currentEntry.id !== entryId);
  return { entry, fields: buildMedicalHandoffFieldsFromEntries(patient, nextEntries) };
};

export const buildMedicalEntryContinuityFields = (
  patient: PatientData,
  entryId: string,
  actor: MedicalHandoffAuditActor,
  reportDate: string,
  now: string
): MedicalEntryMutationResult | null => {
  const entries = getPatientMedicalHandoffEntries(patient);
  const entryIndex = entries.findIndex(entry => entry.id === entryId);
  if (entryIndex < 0) return null;
  const currentEntry = entries[entryIndex];
  const nextEntry: MedicalHandoffEntry = {
    ...currentEntry,
    currentStatus: 'confirmed_current',
    currentStatusDate: reportDate,
    currentStatusAt: now,
    currentStatusBy: actor,
  };
  const nextEntries = upsertEntry(entries, nextEntry, entryIndex);
  return { entry: nextEntry, fields: buildMedicalHandoffFieldsFromEntries(patient, nextEntries) };
};

export const buildMedicalEntryRefreshFields = (
  patient: PatientData,
  entryId: string,
  actor: MedicalHandoffAuditActor | null,
  reportDate: string,
  now: string
): MedicalEntryMutationResult | null => {
  const entries = getPatientMedicalHandoffEntries(patient);
  const entryIndex = entries.findIndex(entry => entry.id === entryId);
  if (entryIndex < 0) return null;

  const currentEntry = entries[entryIndex];
  const nextEntry: MedicalHandoffEntry = {
    ...currentEntry,
    originalNoteAt: currentEntry.originalNoteAt || currentEntry.updatedAt,
    originalNoteBy: currentEntry.originalNoteBy || currentEntry.updatedBy,
    updatedAt: now,
    updatedBy: actor || currentEntry.updatedBy,
    currentStatus: 'updated_by_specialist',
    currentStatusDate: reportDate,
    currentStatusAt: now,
    currentStatusBy: actor || currentEntry.currentStatusBy,
  };
  const nextEntries = upsertEntry(entries, nextEntry, entryIndex);
  return { entry: nextEntry, fields: buildMedicalHandoffFieldsFromEntries(patient, nextEntries) };
};
