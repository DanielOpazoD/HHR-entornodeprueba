import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
export const clinicalCribConflictBeds = (
  diff: CensusImportDiff,
  record?: DailyRecord
): Set<string> => {
  const conflicts = diff.conflicts.filter(
    entry =>
      entry.bedId &&
      (entry.code === 'principal-bed-collision' ||
        (entry.scope === 'clinical-crib' && entry.code !== 'unconfirmed-principal-bed'))
  );
  const beds = new Set(conflicts.map(entry => entry.bedId as string));
  // Maternal identity reconciliation can point at the mother's planned bed. Her
  // current occupied crib remains protected until that conflict is resolved.
  for (const entry of conflicts) {
    if (entry.scope !== 'clinical-crib') continue;
    for (const move of diff.moves) {
      if (
        move.toBedId === entry.bedId &&
        record?.beds[move.fromBedId]?.clinicalCrib?.patientName?.trim()
      )
        beds.add(move.fromBedId);
    }
    for (const [bedId, parent] of Object.entries(record?.beds ?? {})) {
      if (
        entry.source?.encounterId &&
        parent.clinicalCrib?.clinicalEpisodeId === entry.source.encounterId
      )
        beds.add(bedId);
    }
  }
  return beds;
};
