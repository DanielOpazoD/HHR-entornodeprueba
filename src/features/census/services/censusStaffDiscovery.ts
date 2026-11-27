import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import type { StaffObservation } from '@/services/staff/eloisaStaffIdentity';
import { collectRecordedStaffNames } from '@/services/staff/dailyRecordStaffing';
import { evaluationScaleStampInRapaNui } from '../domain/evaluationScaleClock';
const array = <T>(value: readonly T[] | null | undefined): readonly T[] =>
  Array.isArray(value) ? value : [];

/** The attributable fields the collector reads: a patient's, or a clinicalDerived episode's. */
interface StaffEvidenceSource {
  evaluationScores?: PatientData['evaluationScores'];
  vitalSigns?: PatientData['vitalSigns'];
  /** An episode document stores an absent history as null. */
  vitalSignsHistory?: readonly PatientVitalSigns[] | null;
  upcChecklist?: PatientData['upcChecklist'];
  clinicalCrib?: StaffEvidenceSource;
}

const createStaffCollector = () => {
  const observations: StaffObservation[] = [];
  const append = (author: unknown, role: unknown, recordedAt: unknown) => {
    if (typeof author === 'string' && typeof role === 'string' && typeof recordedAt === 'string')
      observations.push({ author, role, recordedAt });
  };
  const visit = (patient: StaffEvidenceSource | undefined) => {
    if (!patient || typeof patient !== 'object') return;
    const scores = patient.evaluationScores;
    // Stored Braden/Downton applications keep Eloísa's printed clock (TIME-02); convert to Rapa Nui.
    const scaleEvidence = [
      scores?.braden,
      scores?.downton,
      ...array(scores?.history),
      scores?.braden?.latestApplication,
      scores?.downton?.latestApplication,
    ];
    for (const item of scaleEvidence) {
      if (!item) continue;
      append(
        item.author,
        item.authorRole,
        typeof item.recordedAt === 'string' ? evaluationScaleStampInRapaNui(item.recordedAt) : null
      );
    }
    const evidence = [
      scores?.cudyr,
      ...array(scores?.cudyr?.history),
      patient.vitalSigns,
      ...array(patient.vitalSignsHistory),
    ];
    for (const item of evidence) if (item) append(item.author, item.authorRole, item.recordedAt);
    for (const evaluation of [patient.upcChecklist, ...array(patient.upcChecklist?.history)])
      if (evaluation)
        append(evaluation.responsibleNurse?.name, 'Enfermera', evaluation.evaluatedAt);
    if (patient.clinicalCrib) visit(patient.clinicalCrib);
  };
  return { observations, append, visit };
};

/** Read only attributable structured fields; never mine names from clinical free text. */
export const collectCensusStaff = (record: Partial<DailyRecord>): StaffObservation[] => {
  const { observations, append, visit } = createStaffCollector();
  const assigned = (names: unknown, role: string) => {
    if (Array.isArray(names)) names.forEach(name => append(name, role, `${record.date}T12:00:00`));
  };
  const staff = collectRecordedStaffNames(record);
  assigned(staff.nurseNames, 'Enfermera');
  assigned(staff.tensNames, 'TENS');
  Object.values(record.beds ?? {}).forEach(visit);
  for (const movement of [
    ...array(record.discharges),
    ...array(record.transfers),
    ...array(record.cma),
  ]) {
    if (movement && 'originalData' in movement) visit(movement.originalData);
  }
  return observations;
};

/**
 * A split day keeps each episode's vitals history in its own document, discharged, transferred
 * and CMA episodes included (their movement snapshots no longer carry it): each document is
 * visited as a patient of its own.
 */
export const collectClinicalDerivedStaff = (
  docs: readonly ClinicalDerivedEpisodeDoc[]
): StaffObservation[] => {
  const { observations, visit } = createStaffCollector();
  docs.forEach(doc => visit(doc));
  return observations;
};
