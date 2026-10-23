import {
  MedicalHandoffAudit,
  MedicalHandoffEntry,
  PatientData,
  Specialty,
} from '@/domain/handoff/patientContracts';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

const MEDICAL_SPECIALTY_OPTIONS = Object.values(Specialty).filter(Boolean) as string[];

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `medical-entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const hasMeaningfulEntry = (entry: MedicalHandoffEntry): boolean =>
  Boolean(
    entry.note.trim() ||
    entry.updatedAt ||
    entry.currentStatus ||
    entry.currentStatusAt ||
    entry.updatedBy
  );

export const formatMedicalHandoffTimestamp = (value?: string): string => {
  if (!value) return '';
  return new Date(value).toLocaleString('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getMedicalHandoffSpecialtyOptions = (): string[] => MEDICAL_SPECIALTY_OPTIONS;

export const formatMedicalHandoffActorLabel = (value?: string): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(' ');
  return `${parts[0]} ${parts[1]}`;
};

export const createMedicalHandoffEntry = (
  specialty: Specialty | string,
  overrides: Partial<MedicalHandoffEntry> = {}
): MedicalHandoffEntry => ({
  id: overrides.id || createId(),
  specialty,
  note: '',
  ...overrides,
});

export const getPatientMedicalHandoffEntries = (patient: PatientData): MedicalHandoffEntry[] => {
  if (patient.medicalHandoffEntries?.length) return patient.medicalHandoffEntries;
  if (!patient.medicalHandoffNote?.trim() && !patient.medicalHandoffAudit) return [];
  return [
    {
      id: 'legacy-primary',
      specialty:
        patient.medicalHandoffAudit?.lastSpecialistUpdateSpecialty ||
        patient.medicalHandoffAudit?.currentStatusSpecialty ||
        patient.specialty ||
        Specialty.EMPTY,
      note: patient.medicalHandoffNote || '',
      originalNoteAt:
        patient.medicalHandoffAudit?.originalNoteAt ||
        patient.medicalHandoffAudit?.lastSpecialistUpdateAt,
      originalNoteBy:
        patient.medicalHandoffAudit?.originalNoteBy ||
        patient.medicalHandoffAudit?.lastSpecialistUpdateBy,
      updatedAt: patient.medicalHandoffAudit?.lastSpecialistUpdateAt,
      updatedBy: patient.medicalHandoffAudit?.lastSpecialistUpdateBy,
      currentStatus: patient.medicalHandoffAudit?.currentStatus,
      currentStatusDate: patient.medicalHandoffAudit?.currentStatusDate,
      currentStatusAt: patient.medicalHandoffAudit?.currentStatusAt,
      currentStatusBy: patient.medicalHandoffAudit?.currentStatusBy,
    },
  ];
};

export const getDisplayMedicalHandoffEntries = (
  patient: PatientData,
  ensureDraft: boolean
): MedicalHandoffEntry[] => {
  const persisted = getPatientMedicalHandoffEntries(patient);
  if (persisted.length > 0) return persisted;
  if (!ensureDraft) return [];

  return [
    createMedicalHandoffEntry(
      patient.specialty || MEDICAL_SPECIALTY_OPTIONS[0] || Specialty.MEDICINA,
      {
        id: 'draft-primary',
      }
    ),
  ];
};

export const getNextMedicalHandoffSpecialty = (
  patient: PatientData,
  entries: MedicalHandoffEntry[]
): string => {
  const used = new Set(entries.map(entry => entry.specialty).filter(Boolean));
  const preferred = [patient.secondarySpecialty, patient.specialty].filter(Boolean);
  for (const specialty of [...preferred, ...MEDICAL_SPECIALTY_OPTIONS]) {
    if (specialty && !used.has(specialty)) return specialty;
  }
  return patient.specialty || MEDICAL_SPECIALTY_OPTIONS[0] || Specialty.MEDICINA;
};

const selectPrimaryMedicalHandoffEntry = (
  patient: PatientData,
  entries: MedicalHandoffEntry[]
): MedicalHandoffEntry | undefined =>
  entries.find(entry => entry.specialty === patient.specialty && hasMeaningfulEntry(entry)) ||
  entries.find(entry => hasMeaningfulEntry(entry)) ||
  entries.find(entry => entry.specialty === patient.specialty) ||
  entries[0];

const buildLegacyAuditFromEntry = (
  entry: MedicalHandoffEntry | undefined
): MedicalHandoffAudit | undefined => {
  if (!entry) return undefined;
  return {
    lastSpecialistUpdateAt: entry.updatedAt,
    lastSpecialistUpdateBy: entry.updatedBy,
    lastSpecialistUpdateSpecialty: entry.specialty,
    originalNoteAt: entry.originalNoteAt || entry.updatedAt,
    originalNoteBy: entry.originalNoteBy || entry.updatedBy,
    currentStatus: entry.currentStatus,
    currentStatusDate: entry.currentStatusDate,
    currentStatusAt: entry.currentStatusAt,
    currentStatusBy: entry.currentStatusBy,
    currentStatusSpecialty: entry.specialty,
  };
};

export const buildMedicalHandoffFieldsFromEntries = (
  patient: PatientData,
  entries: MedicalHandoffEntry[]
): Pick<PatientData, 'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'> => {
  const primaryEntry = selectPrimaryMedicalHandoffEntry(patient, entries);
  return {
    medicalHandoffEntries: entries,
    medicalHandoffNote: primaryEntry?.note || '',
    medicalHandoffAudit: buildLegacyAuditFromEntry(primaryEntry),
  };
};
