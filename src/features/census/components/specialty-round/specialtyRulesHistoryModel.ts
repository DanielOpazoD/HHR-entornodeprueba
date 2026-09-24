import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';

export interface DiagnosisAssociation {
  code: string;
  specialty: string;
  observations: number;
  lastDate: string;
}

export interface CurrentDiagnosis {
  code: string;
  description: string;
  patients: number;
  suggestedSpecialty: string;
}

export const normalizeDiagnosisCode = (value: string | undefined): string =>
  (value ?? '').trim().toUpperCase().replace(/\s+/g, '');

export const isValidDiagnosisCode = (code: string): boolean =>
  /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(code);

const allowedSpecialty = (value: string | undefined): value is string =>
  Boolean(value && value !== 'Otro' && SPECIALTY_OPTIONS.includes(value as never));

const occupied = (beds: Record<string, PatientData> | null | undefined): PatientData[] =>
  Object.values(beds ?? {}).flatMap(bed => [bed, bed.clinicalCrib].filter(
    (patient): patient is PatientData => Boolean(patient?.patientName?.trim() && !patient.isBlocked)
  ));

/** Historical specialties are observed pairings, never proof that a diagnosis caused them. */
export const summarizeHistoricalAssociations = (records: DailyRecord[]): DiagnosisAssociation[] => {
  const entries = new Map<string, DiagnosisAssociation>();
  for (const record of records) {
    for (const patient of occupied(record.beds)) {
      const code = normalizeDiagnosisCode(patient.cie10Code);
      const specialty = patient.specialty?.trim();
      if (!isValidDiagnosisCode(code) || !allowedSpecialty(specialty)) continue;
      const key = `${code}|${specialty}`;
      const previous = entries.get(key);
      if (previous) {
        previous.observations += 1;
        if (record.date > previous.lastDate) previous.lastDate = record.date;
      } else entries.set(key, { code, specialty, observations: 1, lastDate: record.date });
    }
  }
  return [...entries.values()].sort((a, b) =>
    b.lastDate.localeCompare(a.lastDate) || a.code.localeCompare(b.code) ||
    a.specialty.localeCompare(b.specialty));
};

export const summarizeCurrentDiagnoses = (
  beds: Record<string, PatientData> | null | undefined
): CurrentDiagnosis[] => {
  const entries = new Map<string, CurrentDiagnosis & { specialties: Set<string> }>();
  for (const patient of occupied(beds)) {
    const code = normalizeDiagnosisCode(patient.cie10Code);
    if (!isValidDiagnosisCode(code)) continue;
    const previous = entries.get(code);
    const specialty = patient.specialty?.trim();
    if (previous) {
      previous.patients += 1;
      if (allowedSpecialty(specialty)) previous.specialties.add(specialty);
    } else entries.set(code, { code, description: patient.cie10Description?.trim() ?? '',
      patients: 1, suggestedSpecialty: '',
      specialties: new Set(allowedSpecialty(specialty) ? [specialty] : []) });
  }
  return [...entries.values()].map(({ specialties, ...entry }) => ({ ...entry,
    suggestedSpecialty: specialties.size === 1 ? [...specialties][0] : '' }))
    .sort((a, b) => a.code.localeCompare(b.code));
};

export const historicalMonthRange = (month: string, today: string): {
  start: string; end: string;
} | null => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7)) return null;
  const start = `${month}-01`;
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString().slice(0, 10);
  const end = monthEnd < yesterday ? monthEnd : yesterday;
  return start <= end ? { start, end } : null;
};
