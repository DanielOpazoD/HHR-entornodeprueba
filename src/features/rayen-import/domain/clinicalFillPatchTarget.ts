import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalFillPatchTarget } from '../clinicalFillRunner';

/** Prevents a delayed clinical response from being written to another census or bed occupant. */
export const assertClinicalFillPatchTarget = (
  record: DailyRecord,
  target: ClinicalFillPatchTarget
): void => {
  if (record.date !== target.censusDate) {
    throw new Error('El censo activo cambió durante la sincronización clínica.');
  }

  const currentEpisodeId = record.beds[target.bedId]?.clinicalEpisodeId;
  if (currentEpisodeId !== target.clinicalEpisodeId) {
    throw new Error('El paciente o su cama cambiaron durante la sincronización clínica.');
  }
};
