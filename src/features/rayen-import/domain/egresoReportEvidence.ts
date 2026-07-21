import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { EgresoReportRow } from '../contracts/egresoReport';
import { correctedStamp } from './egresoReportPolicy';

export const eligibleExactEpisodes = (
  rows: EgresoReportRow[],
  recordDay: string | null
): ReadonlySet<string> => new Set(rows.flatMap(row => {
  const episode = String(row.encounterId ?? '').trim();
  const stamp = correctedStamp(row.fechaEgreso, row.correctedDay, row.correctedTime);
  return episode && stamp.correctedDay && stamp.correctedTime &&
    (!recordDay || stamp.correctedDay <= recordDay) ? [episode] : [];
}));

export const findPlannedPatientByEpisode = (
  diff: CensusImportDiff,
  record: DailyRecord,
  episodeId: string
): PatientData | undefined => {
  const admission = diff.admissions.find(entry => entry.source?.encounterId === episodeId);
  if (admission) return admission.patient;
  const update = diff.updates.find(entry => entry.source?.encounterId === episodeId);
  if (update) return update.patient;
  const move = diff.moves.find(entry => entry.source.encounterId === episodeId);
  if (move) return record.beds[move.fromBedId] ?? record.beds[move.toBedId];
  const pending = diff.pendingAdministrativeDischarges.find(entry =>
    entry.encounterId === episodeId || entry.source?.encounterId === episodeId);
  return pending ? record.beds[pending.bedId] : undefined;
};
