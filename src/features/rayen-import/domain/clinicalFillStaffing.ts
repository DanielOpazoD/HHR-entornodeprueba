import type { ClinicalFillDeps, ClinicalFillError } from '../contracts/clinicalFillContracts';
import { inferNursingShifts, type NursingActivityObservation } from './inferNursingShifts';
import { buildClinicalFillError } from '../observability/rayenSyncDiagnostics';

/** Run only when history was requested; an omitted read must preserve the earlier proposal. */
export const collectClinicalFillStaffing = async (
  observations: NursingActivityObservation[],
  censusDate: string,
  deps: Pick<ClinicalFillDeps, 'registerStaff' | 'nurseCatalog' | 'tensCatalog'>
) => {
  let staffingObservations = observations;
  let error: ClinicalFillError | undefined;
  if (deps.registerStaff) {
    try {
      staffingObservations = await deps.registerStaff(observations);
    } catch {
      staffingObservations = [];
      error = buildClinicalFillError({
        bedId: '*',
        source: 'staffing',
        error:
          'No se pudo confirmar el catálogo compartido de Enfermería/TENS. Los nombres locales se conservan; reintenta la sincronización.',
      });
    }
  }
  return {
    proposal: inferNursingShifts(
      staffingObservations,
      censusDate,
      deps.nurseCatalog ?? [],
      deps.tensCatalog ?? []
    ),
    error,
  };
};
