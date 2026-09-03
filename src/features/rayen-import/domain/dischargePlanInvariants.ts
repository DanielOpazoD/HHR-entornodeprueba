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
  // Una cama principal con ESE episodio exacto (RN ya promovido a cama propia) gana
  // sobre una cuna rancia con el mismo episodio bajo la cama de la madre.
  return (
    (reportedEpisode ? occupied.get(`episode:${reportedEpisode}`) : undefined) ??
    (cribByEpisode ? undefined : findOccupiedBed(occupied, run, reportedEpisode || undefined))
  );
};

/**
 * Invariante del plan: una cama se desocupa una sola vez por corrida. Un segundo
 * egreso para la misma cama (otra fila/lookup que resolvió al mismo ocupante)
 * duplicaría el registro de alta al aplicarse. Se prefiere la entrada cuyo
 * episodio es el del ocupante actual de la cama; si ninguna, la primera.
 */
export const dedupeDischargesByBed = (
  discharges: DischargeEntry[],
  record: DailyRecord
): DischargeEntry[] => {
  const kept = new Map<string, DischargeEntry>();
  for (const entry of discharges) {
    const previous = kept.get(entry.bedId);
    if (!previous) {
      kept.set(entry.bedId, entry);
      continue;
    }
    const occupantEpisode = String(record.beds[entry.bedId]?.clinicalEpisodeId ?? '').trim();
    const previousMatches = Boolean(occupantEpisode) && previous.encounterId === occupantEpisode;
    if (!previousMatches && Boolean(occupantEpisode) && entry.encounterId === occupantEpisode) {
      kept.set(entry.bedId, entry);
    }
  }
  const survivors = new Set(kept.values());
  return discharges.filter(entry => survivors.has(entry));
};

/** Egresos finales del plan: cuna asociada adjunta y una sola salida por cama. */
export const finalizeDischargePlan = (
  diff: CensusImportDiff,
  discharges: DischargeEntry[],
  record: DailyRecord
): DischargeEntry[] =>
  dedupeDischargesByBed(attachAssociatedClinicalCribDischarges(diff, discharges, record), record);
