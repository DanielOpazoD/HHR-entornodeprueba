import { canCarryClinicalEvidence } from './clinicalCarryoverIdentity';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { seedClinicalCarryover } from './clinicalCarryoverSeed';

const isCarryoverDestination = (date: string): boolean =>
  date === calendarStampInClinicalTimeZone(new Date()).iso;

/**
 * A split source day keeps its vitals history in episode documents (docs/DESIGN_DAILY_RECORD_
 * PHASE1_CLINICAL_DERIVED.md, D10). Only when the destination is today, the one day seeded, the
 * carryover reads an overlaid copy of the source, best effort: on any failure it seeds from the
 * embedded copies, as before. The copy only feeds the seed; it is never saved.
 */
export const readClinicalCarryoverSource = async (
  destinationDate: string,
  source: DailyRecord
): Promise<DailyRecord> => {
  if (!isCarryoverDestination(destinationDate) || source.clinicalDerivedLayout == null) {
    return source;
  }
  try {
    const { readDailyRecordWithClinicalDerived } =
      await import('./dailyRecordClinicalDerivedReadService');
    return (await readDailyRecordWithClinicalDerived(source, { mode: 'bestEffort' })).record;
  } catch {
    return source;
  }
};

/** Loaded only while constructing a missing day; the ordinary copy already owns a fresh clone. */
export const applyClinicalDayCarryover = (
  destination: DailyRecord,
  source: DailyRecord
): DailyRecord => {
  if (!isCarryoverDestination(destination.date)) return destination;
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
