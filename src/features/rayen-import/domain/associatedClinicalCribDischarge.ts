import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff, DischargeEntry } from '../contracts/censusImportDiff';
import { hasRecordedMovement } from './egresoReportPolicy';
import type { OccupiedClinicalCrib } from './egresoReportPolicy';
import type { PromotionCandidate } from './egresoReportEligibility';
import { normalizeRut } from '@/utils/rutUtils';

const episodeIdOf = (value: unknown): string => String(value ?? '').trim();

const samePrincipal = (
  patient: { clinicalEpisodeId?: string; rut?: string } | undefined,
  entry: DischargeEntry
): boolean => {
  if (!patient) return false;
  const entryEpisode = episodeIdOf(entry.encounterId ?? entry.source?.encounterId);
  const patientEpisode = episodeIdOf(patient.clinicalEpisodeId);
  if (entryEpisode && patientEpisode) return entryEpisode === patientEpisode;
  const entryRun = normalizeRut(entry.rut);
  return Boolean(entryRun && entryRun === normalizeRut(patient.rut));
};

const parentBedCandidates = (
  diff: CensusImportDiff,
  entry: DischargeEntry,
  record: DailyRecord
): string[] => {
  const candidates = [entry.bedId];
  for (const move of diff.moves) {
    if (move.toBedId !== entry.bedId || !samePrincipal(record.beds[move.fromBedId], entry))
      continue;
    candidates.push(move.fromBedId);
  }
  return [...new Set(candidates)];
};

const activeClinicalEpisodes = (diff: CensusImportDiff): Set<string> =>
  new Set(
    [
      ...(diff.activeClinicalEpisodeIds ?? []),
      ...(diff.activeClinicalCribs ?? []).flatMap(entry => [
        entry.source.encounterId,
        entry.patient.clinicalEpisodeId,
      ]),
    ]
      .map(episodeIdOf)
      .filter(Boolean)
  );

export const buildClinicalCribPromotionCandidates = (
  diff: CensusImportDiff,
  occupiedCribs: ReadonlyMap<string, OccupiedClinicalCrib>
): Map<string, PromotionCandidate> => {
  const candidates = new Map<string, PromotionCandidate>();
  for (const crib of diff.activeClinicalCribs ?? []) candidates.set(crib.parentBedId, crib);

  const activeEpisodes = activeClinicalEpisodes(diff);
  for (const crib of occupiedCribs.values()) {
    const cribEpisode = episodeIdOf(crib.patient.clinicalEpisodeId);
    // A complete snapshot is authoritative: a missing exact episode is stale local state, not a
    // newborn that should be promoted into the mother's newly released bed.
    if (diff.snapshotComplete === true && !activeEpisodes.has(cribEpisode)) continue;
    const parentRun = normalizeRut(crib.parent?.rut);
    const parentMove = diff.moves.find(
      entry => entry.fromBedId === crib.parentBedId && normalizeRut(entry.rut) === parentRun
    );
    const parentBedId = parentMove?.toBedId ?? crib.parentBedId;
    if (!candidates.has(parentBedId)) {
      candidates.set(parentBedId, {
        principalRut: crib.parent.rut,
        patient: crib.patient,
      });
    }
  }
  return candidates;
};

/**
 * Attaches a traceable, non-statistical newborn departure to a confirmed maternal discharge.
 * Absence is used only with a complete Ficha snapshot and an exact Eloisa episode id. If any crib
 * placement is ambiguous, the existing conflict remains authoritative and no inference is made.
 */
export const attachAssociatedClinicalCribDischarges = (
  diff: CensusImportDiff,
  discharges: DischargeEntry[],
  record: DailyRecord
): DischargeEntry[] => {
  if (diff.snapshotComplete !== true) return discharges;

  const activeEpisodes = activeClinicalEpisodes(diff);
  const conflictedParentBeds = new Set(
    diff.conflicts
      .filter(entry => entry.scope === 'clinical-crib')
      .flatMap(entry => entry.bedId ?? [])
  );

  return discharges.map(entry => {
    const candidateBeds = parentBedCandidates(diff, entry, record);
    if (
      entry.kind !== 'alta' ||
      entry.status !== 'Vivo' ||
      candidateBeds.some(bedId => conflictedParentBeds.has(bedId))
    ) {
      return entry;
    }

    const parentBedId = candidateBeds.find(bedId => samePrincipal(record.beds[bedId], entry));
    const crib = parentBedId ? record.beds[parentBedId]?.clinicalCrib : undefined;
    const clinicalEpisodeId = episodeIdOf(crib?.clinicalEpisodeId);
    if (!crib?.patientName?.trim() || !clinicalEpisodeId || activeEpisodes.has(clinicalEpisodeId)) {
      return entry;
    }
    if (hasRecordedMovement(record, crib.rut, clinicalEpisodeId)) return entry;

    return {
      ...entry,
      associatedClinicalCrib: {
        clinicalEpisodeId,
        patientName: crib.patientName,
        rut: crib.rut,
      },
    };
  });
};
