import { resolveClinicalEpisodeIdentifier } from '@/application/patient-flow/clinicalEpisode';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

export interface MedicalIndicationsPatientOption {
  bedId: string;
  label: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  age: string;
  birthDate: string;
  allergies: string;
  admissionDate: string;
  admissionTime?: string;
  clinicalEpisodeId?: string;
  sourceDailyRecordDate?: string;
  daysOfStay: string;
  treatingDoctor: string;
}

export type MedicalIndicationsKineType = 'motora' | 'respiratoria' | 'ambas' | 'ninguna';

export interface MedicalIndicationTemplate {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  lastUsedAt?: string | null;
  useCount: number;
  isArchived: boolean;
}

export interface MedicalIndicationRecordContent {
  reposo: string;
  regimen: string;
  kineType: MedicalIndicationsKineType;
  kineTimes: string;
  treatingDoctor: string;
  pendingNotes: string;
  indications: string[];
}

export interface MedicalIndicationRecord extends MedicalIndicationRecordContent {
  id: string;
  patientRut: string;
  patientName: string;
  episodeId: string;
  bedId: string;
  targetDate: string;
  generatedAt: string;
  generatedByUserId: string;
  generatedByName: string;
  generatedByRole?: string;
  generatedFromTemplateIds: string[];
  admissionDate: string;
  daysOfStayForTargetDate: string;
  pdfPrintedAt: string | null;
}

export interface MedicalIndicationRecordAuditEvent {
  userId: string;
  action: AuditAction;
  entityType: AuditLogEntry['entityType'];
  entityId: string;
  details: Record<string, unknown>;
  patientRut?: string;
  recordDate?: string;
  authors?: string;
}

const DATE_KEY_MATCH = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLINICAL_DATE_MATCH = /^(\d{2})[-/](\d{2})[-/](\d{4})$/;

const sanitizeRutForEpisode = (rut: string): string => rut.replace(/\./g, '').trim();

const toUtcDate = (dateKey: string): Date | null => {
  const normalized = normalizeMedicalIndicationsDateKey(dateKey);
  const match = normalized.match(DATE_KEY_MATCH);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
};

export const normalizeMedicalIndicationsDateKey = (rawDate: string): string => {
  const trimmed = rawDate.trim();
  if (!trimmed) return '';

  const isoMatch = trimmed.match(DATE_KEY_MATCH);
  if (isoMatch) return trimmed;

  const clinicalMatch = trimmed.match(CLINICAL_DATE_MATCH);
  if (clinicalMatch) {
    const [, day, month, year] = clinicalMatch;
    return `${year}-${month}-${day}`;
  }

  return trimmed;
};

export const formatMedicalIndicationsDate = (rawDate: string): string => {
  if (!rawDate) return '';

  const isoMatch = rawDate.match(DATE_KEY_MATCH);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}-${month}-${year}`;
  }

  const clinicalDateMatch = rawDate.match(CLINICAL_DATE_MATCH);
  if (clinicalDateMatch) {
    const [, day, month, year] = clinicalDateMatch;
    return `${day}-${month}-${year}`;
  }

  return rawDate;
};

export const calculateMedicalIndicationsStayDays = (
  admissionDate: string,
  targetDate: string
): string => {
  const admission = toUtcDate(admissionDate);
  const target = toUtcDate(targetDate);
  if (!admission || !target) return '';

  const diffDays = Math.floor((target.getTime() - admission.getTime()) / 86400000) + 1;
  return String(Math.max(diffDays, 1));
};

export const buildMedicalIndicationsEpisodeId = (
  patient: Pick<
    MedicalIndicationsPatientOption,
    'patientName' | 'rut' | 'admissionDate' | 'admissionTime' | 'clinicalEpisodeId'
  >
): string => {
  return resolveClinicalEpisodeIdentifier(
    {
      clinicalEpisodeId: patient.clinicalEpisodeId,
      rut: sanitizeRutForEpisode(patient.rut),
      patientName: patient.patientName,
      admissionDate: normalizeMedicalIndicationsDateKey(patient.admissionDate),
      admissionTime: patient.admissionTime,
    },
    { source: 'medical-indications' }
  );
};

export const buildMedicalIndicationRecordId = ({
  episodeId,
  targetDate,
  generatedAt,
}: {
  episodeId: string;
  targetDate: string;
  generatedAt: string;
}): string => {
  const safeGeneratedAt = generatedAt.replace(/[:.]/g, '-');
  return [episodeId, normalizeMedicalIndicationsDateKey(targetDate), safeGeneratedAt].join('__');
};

export const buildMedicalIndicationTemplateId = ({
  userId,
  text,
  now,
}: {
  userId: string;
  text: string;
  now: string;
}): string => {
  const readableText = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  return [userId, now.replace(/[:.]/g, '-'), readableText || 'indicacion'].join('__');
};
