import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { attachAssociatedClinicalCribDischarges } from './associatedClinicalCribDischarge';
import {
  findOccupiedBed,
  findOccupiedClinicalCrib,
  type OccupiedBedEvidence,
  type OccupiedClinicalCrib,
} from './egresoReportPolicy';

type DischargeEntry = CensusImportDiff['discharges'][number];

/**
 * Ocupante de cama principal al que apunta una fila del informe o del lookup.
 *
 * `findOccupiedBed` cae al RUN cuando el episodio no está entre las camas
 * principales. Con un RN registrado bajo el RUN de la madre, la fila del RN
 * (episodio exacto de la CUNA) resolvía la cama de la madre y el pipeline
 * construía un SEGUNDO egreso de la madre en la misma cama (alta duplicada en
 * la estadística) mientras el RN quedaba sin egreso. Si el episodio exacto de la
 * fila pertenece a una cuna ocupada, la fila es de la cuna, no de la cama.
 */
export const resolveReportedOccupant = (
  occupied: ReadonlyMap<string, OccupiedBedEvidence>,
  occupiedCribs: ReadonlyMap<string, OccupiedClinicalCrib>,
  run: string | undefined,
  episodeId: string | undefined
): OccupiedBedEvidence | undefined => {
  const reportedEpisode = String(episodeId ?? '').trim();
  const cribByEpisode = reportedEpisode
    ? findOccupiedClinicalCrib(occupiedCribs, undefined, reportedEpisode)
    : undefined;
  return cribByEpisode ? undefined : findOccupiedBed(occupied, run, reportedEpisode || undefined);
};

/**
 * Invariante del plan: una cama se desocupa una sola vez por corrida. Un segundo
 * egreso para la misma cama (otra fila/lookup que resolvió al mismo ocupante)
 * duplicaría el registro de alta al aplicarse; se conserva el primero.
 */
export const dedupeDischargesByBed = (discharges: DischargeEntry[]): DischargeEntry[] => {
  const seen = new Set<string>();
  return discharges.filter(entry => {
    if (seen.has(entry.bedId)) return false;
    seen.add(entry.bedId);
    return true;
  });
};

/** Egresos finales del plan: cuna asociada adjunta y una sola salida por cama. */
export const finalizeDischargePlan = (
  diff: CensusImportDiff,
  discharges: DischargeEntry[],
  record: DailyRecord
): DischargeEntry[] =>
  dedupeDischargesByBed(attachAssociatedClinicalCribDischarges(diff, discharges, record));
