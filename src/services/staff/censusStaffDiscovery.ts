import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientData } from '@/types/domain/patient';
import type { StaffObservation } from './eloisaStaffIdentity';
import { collectRecordedStaffNames } from './dailyRecordStaffing';
const array = <T>(value: readonly T[] | undefined): readonly T[] =>
  Array.isArray(value) ? value : [];

/** Read only attributable structured fields; never mine names from clinical free text. */
export const collectCensusStaff = (record: Partial<DailyRecord>): StaffObservation[] => {
  const observations: StaffObservation[] = [];
  const append = (author: unknown, role: unknown, recordedAt: unknown) => {
    if (typeof author === 'string' && typeof role === 'string' && typeof recordedAt === 'string')
      observations.push({ author, role, recordedAt });
  };
  const assigned = (names: unknown, role: string) => {
    if (Array.isArray(names)) names.forEach(name => append(name, role, `${record.date}T12:00:00`));
  };
  const staff = collectRecordedStaffNames(record);
  assigned(staff.nurseNames, 'Enfermera');
  assigned(staff.tensNames, 'TENS');
  const visit = (patient: PatientData | undefined) => {
    if (!patient || typeof patient !== 'object') return;
    const scores = patient.evaluationScores;
    const evidence = [
      scores?.braden,
      scores?.downton,
      ...array(scores?.history),
      scores?.braden?.latestApplication,
      scores?.downton?.latestApplication,
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
