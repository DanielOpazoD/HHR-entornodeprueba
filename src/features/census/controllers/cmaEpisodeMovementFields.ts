import { deepClone } from '@/utils/deepClone';

interface CmaEpisodeMovementData<PatientSnapshot> {
  clinicalEpisodeId?: string;
  originalData?: PatientSnapshot;
}

interface PatientEpisodeSnapshot {
  clinicalEpisodeId?: string;
}

export const buildCmaEpisodeMovementFields = <PatientSnapshot extends PatientEpisodeSnapshot>(
  data: CmaEpisodeMovementData<PatientSnapshot>,
  sourcePatient?: PatientSnapshot | null
): Partial<
  Pick<CmaEpisodeMovementData<PatientSnapshot>, 'clinicalEpisodeId' | 'originalData'>
> => ({
  clinicalEpisodeId: data.clinicalEpisodeId || sourcePatient?.clinicalEpisodeId,
  originalData: data.originalData || (sourcePatient ? deepClone(sourcePatient) : undefined),
});
