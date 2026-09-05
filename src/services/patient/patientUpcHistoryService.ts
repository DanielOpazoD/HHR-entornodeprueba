import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import { getRecordsRange } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordsRangeFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { checklistUpcHistory, mergeUpcEvaluationHistory } from '@/domain/upc/upcEvaluationHistory';
import {
  getActiveDischarges,
  getActiveTransfers,
  getActiveCma,
} from '@/application/census/movementTombstonePolicy';

type Patient = Pick<
  PatientData,
  | 'rut'
  | 'documentType'
  | 'clinicalEpisodeId'
  | 'admissionDate'
  | 'admissionTime'
  | 'firstSeenDate'
  | 'upcChecklist'
>;
const normalizedRut = (rut: string) => rut.replace(/[.\-\s]/g, '').toUpperCase();

/** Never join by bed or name: a bed may now belong to another patient or admission. */
export const isSameUpcHistoryEpisode = (target: Patient, candidate: Patient): boolean => {
  const rut = normalizedRut(target.rut);
  const otherRut = normalizedRut(candidate.rut);
  if (rut && otherRut && rut !== otherRut) return false;
  if ((target.documentType || 'RUT') !== (candidate.documentType || 'RUT')) return false;
  if (target.clinicalEpisodeId && candidate.clinicalEpisodeId) {
    return target.clinicalEpisodeId === candidate.clinicalEpisodeId;
  }
  return Boolean(
    rut &&
    rut === otherRut &&
    target.admissionDate &&
    target.admissionDate === candidate.admissionDate &&
    (!target.admissionTime ||
      !candidate.admissionTime ||
      target.admissionTime === candidate.admissionTime)
  );
};

export const collectPatientUpcHistory = (records: DailyRecord[], patient: Patient) =>
  mergeUpcEvaluationHistory(
    records.flatMap(record =>
      [
        ...Object.values(record.beds),
        ...[
          ...getActiveDischarges(record.discharges),
          ...getActiveTransfers(record.transfers),
          ...getActiveCma(record.cma),
        ].flatMap(movement => (movement.originalData ? [movement.originalData] : [])),
      ].flatMap(bed =>
        [bed, bed.clinicalCrib].flatMap(candidate =>
          candidate && isSameUpcHistoryEpisode(patient, candidate)
            ? checklistUpcHistory(candidate.upcChecklist)
            : []
        )
      )
    ),
    checklistUpcHistory(patient.upcChecklist)
  );

/** Read on demand only. Never overwrite the census cache or mutate clinical data. */
export const loadPatientUpcHistory = async (patient: Patient, throughDate: string) => {
  const start = [patient.firstSeenDate, patient.admissionDate]
    .filter((day): day is string => Boolean(day))
    .sort()[0];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start || '') ||
    start > throughDate ||
    (!patient.clinicalEpisodeId && !normalizedRut(patient.rut))
  ) {
    return {
      entries: checklistUpcHistory(patient.upcChecklist),
      warning:
        'Solo se muestra el registro actual: falta una fecha de ingreso o identidad que permita unir la hospitalización.',
    };
  }
  const localPromise = getRecordsRange(start, throughDate);
  const remoteEnabled = isFirestoreEnabled();
  const remotePromise = remoteEnabled
    ? getRecordsRangeFromFirestore(start, throughDate, { requireServer: true })
    : Promise.reject(new Error('Remote disabled'));
  const [local, remote] = await Promise.allSettled([localPromise, remotePromise]);
  if (remote.status === 'fulfilled') {
    // A successful strict read is authoritative, including absent/deleted days.
    // The open census snapshot may be stale and must not reintroduce evaluations.
    return {
      entries: collectPatientUpcHistory(remote.value, { ...patient, upcChecklist: undefined }),
      warning: null,
    };
  }
  return {
    entries: collectPatientUpcHistory(local.status === 'fulfilled' ? local.value : [], patient),
    warning:
      'Historial parcial: no se pudo consultar el servidor. Se muestran las evaluaciones disponibles localmente.',
  };
};
