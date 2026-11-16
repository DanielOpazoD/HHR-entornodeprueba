import type {
  MedicalHandoffAudit,
  MedicalHandoffAuditActor,
  MedicalHandoffEntry,
  PatientData,
} from '@/types/domain/patient';

/**
 * The fields a specialist note edit wrote before the in-app medical handoff was retired. The
 * queue still replays these edits until stage (c) removes it, so its tests build them here.
 */
type SpecialistNoteFields = Pick<
  PatientData,
  'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'
>;

const hasContent = (entry: MedicalHandoffEntry): boolean =>
  Boolean(
    entry.note.trim() ||
    entry.updatedAt ||
    entry.currentStatus ||
    entry.currentStatusAt ||
    entry.updatedBy
  );

const readEntries = (patient: PatientData): MedicalHandoffEntry[] => {
  if (patient.medicalHandoffEntries?.length) return patient.medicalHandoffEntries;
  const audit = patient.medicalHandoffAudit;
  if (!patient.medicalHandoffNote?.trim() && !audit) return [];
  return [
    {
      id: 'legacy-primary',
      specialty:
        audit?.lastSpecialistUpdateSpecialty ||
        audit?.currentStatusSpecialty ||
        patient.specialty ||
        '',
      note: patient.medicalHandoffNote || '',
      originalNoteAt: audit?.originalNoteAt || audit?.lastSpecialistUpdateAt,
      originalNoteBy: audit?.originalNoteBy || audit?.lastSpecialistUpdateBy,
      updatedAt: audit?.lastSpecialistUpdateAt,
      updatedBy: audit?.lastSpecialistUpdateBy,
      currentStatus: audit?.currentStatus,
      currentStatusDate: audit?.currentStatusDate,
      currentStatusAt: audit?.currentStatusAt,
      currentStatusBy: audit?.currentStatusBy,
    },
  ];
};

const toFields = (patient: PatientData, entries: MedicalHandoffEntry[]): SpecialistNoteFields => {
  const primary =
    entries.find(entry => entry.specialty === patient.specialty && hasContent(entry)) ||
    entries.find(hasContent) ||
    entries.find(entry => entry.specialty === patient.specialty) ||
    entries[0];
  const audit: MedicalHandoffAudit | undefined = primary && {
    lastSpecialistUpdateAt: primary.updatedAt,
    lastSpecialistUpdateBy: primary.updatedBy,
    lastSpecialistUpdateSpecialty: primary.specialty,
    originalNoteAt: primary.originalNoteAt || primary.updatedAt,
    originalNoteBy: primary.originalNoteBy || primary.updatedBy,
    currentStatus: primary.currentStatus,
    currentStatusDate: primary.currentStatusDate,
    currentStatusAt: primary.currentStatusAt,
    currentStatusBy: primary.currentStatusBy,
    currentStatusSpecialty: primary.specialty,
  };
  return {
    medicalHandoffEntries: entries,
    medicalHandoffNote: primary?.note || '',
    medicalHandoffAudit: audit,
  };
};

/** Writes `value` into the entry `entryId`, creating it when the patient has no such entry. */
export const buildMedicalEntryNoteFields = (
  patient: PatientData,
  entryId: string,
  value: string,
  actor: MedicalHandoffAuditActor | null,
  reportDate: string,
  now: string
): { entry: MedicalHandoffEntry; fields: SpecialistNoteFields } => {
  const entries = readEntries(patient);
  const index = entries.findIndex(entry => entry.id === entryId);
  const current = entries[index] ?? { id: entryId, specialty: patient.specialty || '', note: '' };
  const entry: MedicalHandoffEntry = {
    ...current,
    id: index >= 0 ? current.id : crypto.randomUUID(),
    specialty: current.specialty || patient.specialty || '',
    note: value,
    originalNoteAt: now,
    originalNoteBy: actor || current.updatedBy || current.originalNoteBy,
    updatedAt: now,
    updatedBy: actor || current.updatedBy,
    currentStatus: 'updated_by_specialist',
    currentStatusDate: reportDate,
    currentStatusAt: now,
    currentStatusBy: actor || current.currentStatusBy,
  };
  const nextEntries =
    index >= 0 ? entries.map((item, i) => (i === index ? entry : item)) : [...entries, entry];
  return { entry, fields: toFields(patient, nextEntries) };
};
