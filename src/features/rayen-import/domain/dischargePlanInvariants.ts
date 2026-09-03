import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { attachAssociatedClinicalCribDischarges } from './associatedClinicalCribDischarge';

type DischargeEntry = CensusImportDiff['discharges'][number];

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
