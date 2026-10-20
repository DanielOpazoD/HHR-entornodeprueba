import { canCarryClinicalEvidence } from './clinicalCarryoverIdentity';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { seedClinicalCarryover } from './clinicalCarryoverSeed';

/** Loaded only while constructing a missing day; the ordinary copy already owns a fresh clone. */
export const applyClinicalDayCarryover = (
  destination: DailyRecord,
  source: DailyRecord
): DailyRecord => {
  if (destination.date !== calendarStampInClinicalTimeZone(new Date()).iso) return destination;
  const patients = Object.values(source.beds);
  const cribs = patients.flatMap(patient => (patient.clinicalCrib ? [patient.clinicalCrib] : []));
  const carry = (patient: PatientData, candidates: PatientData[]): PatientData => {
    const matches = candidates.filter(previous =>
      canCarryClinicalEvidence(previous, patient, source.date, destination.date)
    );
    return matches.length === 1
      ? seedClinicalCarryover(matches[0], patient, source.date, destination.date)
      : patient;
  };
  for (const [bedId, patient] of Object.entries(destination.beds)) {
    const seeded = carry(patient, patients);
    if (seeded.clinicalCrib) seeded.clinicalCrib = carry(seeded.clinicalCrib, cribs);
    destination.beds[bedId] = seeded;
  }
  return destination;
};
