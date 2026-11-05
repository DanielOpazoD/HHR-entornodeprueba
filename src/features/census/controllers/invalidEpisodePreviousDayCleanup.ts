import {
  defaultDailyRecordRepositoryPort,
  type DailyRecordRepositoryPort,
} from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  tombstoneMovementsWhere,
  type TombstonableMovement,
} from '@/application/census/movementTombstonePolicy';
import { buildAtomicPatientMovementPatch } from '@/application/census/atomicPatientMovementPatchController';
import { buildClearPatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { buildConfirmedBedOccupantIdentity } from '@/hooks/controllers/intentionalBedClearController';
import { assertDailyRecordWriteAccepted } from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import { getPreviousDay, resolveCurrentClinicalDay } from '@/utils/clinicalDayUtils';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

/** The owner's window: a census day stays editable for 48 h from its midnight in Rapa Nui. */
const EDITING_WINDOW_MS = 48 * 60 * 60 * 1000;

export type PreviousDayCleanupOutcome =
  /** Nothing to do: a past census day, or the previous day never held the episode. */
  | { status: 'not_applicable' }
  | { status: 'cleaned'; day: string }
  /** A signed day or a newborn's crib is left for a person to review. */
  | { status: 'skipped'; day: string; reason: 'signed' | 'clinical_crib' }
  | { status: 'failed'; day: string };

type CleanupRepository = Pick<
  DailyRecordRepositoryPort,
  'getAuthoritativeForDate' | 'updatePartialDetailed'
>;

const MOVEMENT_KEYS = ['discharges', 'transfers', 'cma'] as const;

const namesEpisode = (
  movement: { clinicalEpisodeId?: string; deletedAt?: string | null },
  id: string
) => !movement.deletedAt && movement.clinicalEpisodeId === id;

/**
 * «Paciente no válido» also removes the episode from the previous census day while it is still
 * editable. With the 48 h window measured from the start of the census day, that is only the day
 * before today (owner decision 2026-11-05); older or signed days are not touched.
 *
 * Writes use the same guarded paths as «Limpiar» and «Eliminar», one at a time, each confirmed by
 * the server. The mark already exists, so a failure here never brings the patient back.
 */
export const cleanInvalidEpisodeFromPreviousDay = async ({
  repository,
  censusDate,
  clinicalEpisodeId,
  now = new Date(),
}: {
  repository: CleanupRepository;
  censusDate: string;
  clinicalEpisodeId: string;
  now?: Date;
}): Promise<PreviousDayCleanupOutcome> => {
  if (censusDate !== resolveCurrentClinicalDay(now)) return { status: 'not_applicable' };
  const day = getPreviousDay(censusDate);
  // Before the morning handoff today's census is still yesterday's, so its previous day is already
  // past the window. Checked here for every role: the server does not limit admin writes.
  if (now.getTime() - clinicalWallClockToDate(day, '00:00').getTime() >= EDITING_WINDOW_MS) {
    return { status: 'not_applicable' };
  }
  try {
    let record: DailyRecord | null = await repository.getAuthoritativeForDate(day);
    if (!record) return { status: 'not_applicable' };
    const bedIds = Object.entries(record.beds)
      .filter(([, patient]) => patient?.clinicalEpisodeId === clinicalEpisodeId)
      .map(([bedId]) => bedId);
    const inCrib = Object.values(record.beds).some(
      patient => patient?.clinicalCrib?.clinicalEpisodeId === clinicalEpisodeId
    );
    const movements = MOVEMENT_KEYS.some(key =>
      (record?.[key] ?? []).some(movement => namesEpisode(movement, clinicalEpisodeId))
    );
    if (!bedIds.length && !inCrib && !movements) return { status: 'not_applicable' };
    if (record.medicalSignature) return { status: 'skipped', day, reason: 'signed' };
    // The newborn is another person (ID-03): its crib is never removed with this episode.
    if (inCrib || bedIds.some(bedId => record?.beds[bedId]?.clinicalCrib)) {
      return { status: 'skipped', day, reason: 'clinical_crib' };
    }
    for (const bedId of bedIds) {
      const current: DailyRecord = record;
      assertDailyRecordWriteAccepted(
        await repository.updatePartialDetailed(day, buildClearPatientPatches(current, bedId), {
          requireConfirmedRecord: true,
          requireRemoteAuthorityFirst: true,
          optimisticRemoteConfirmed: true,
          intentionalBedClear: {
            bedId,
            confirmedLastUpdated: current.lastUpdated,
            confirmedOccupant: buildConfirmedBedOccupantIdentity(current.beds[bedId]),
          },
        })
      );
      record = (await repository.getAuthoritativeForDate(day)) ?? current;
    }
    for (const key of MOVEMENT_KEYS) {
      const list: TombstonableMovement[] = record[key] ?? [];
      if (!list.some(movement => namesEpisode(movement, clinicalEpisodeId))) continue;
      const updatedRecord = {
        ...record,
        [key]: tombstoneMovementsWhere(
          list,
          movement => namesEpisode(movement, clinicalEpisodeId),
          {
            deletedReason: 'invalid_episode',
          }
        ),
      } as DailyRecord;
      assertDailyRecordWriteAccepted(
        await repository.updatePartialDetailed(
          day,
          buildAtomicPatientMovementPatch({ updatedRecord, movementKey: key, sourceBedIds: [] }),
          { requireConfirmedRecord: true, requireRemoteAuthorityFirst: true }
        )
      );
    }
    return { status: 'cleaned', day };
  } catch {
    return { status: 'failed', day };
  }
};

/** What a person must still review on the previous day, or null when nothing is left. */
export const describePreviousDayCleanup = (outcome: PreviousDayCleanupOutcome): string | null => {
  if (outcome.status === 'not_applicable' || outcome.status === 'cleaned') return null;
  const day = formatDateDDMMYYYY(outcome.day);
  if (outcome.status === 'failed')
    return `Se eliminó de este día, pero no se pudo limpiar el ${day}. Ábrelo y usa «Paciente no válido».`;
  return outcome.reason === 'signed'
    ? `El ${day} está firmado y no se modificó.`
    : `El ${day} tiene una cuna asociada al paciente y no se modificó; revísalo.`;
};

/** Cleans the previous day and returns the notice for the person, if any. */
export const cleanAndDescribePreviousDay = async ({
  repository = defaultDailyRecordRepositoryPort,
  ...input
}: Omit<Parameters<typeof cleanInvalidEpisodeFromPreviousDay>[0], 'repository'> & {
  repository?: CleanupRepository;
}): Promise<string | null> =>
  describePreviousDayCleanup(await cleanInvalidEpisodeFromPreviousDay({ repository, ...input }));
