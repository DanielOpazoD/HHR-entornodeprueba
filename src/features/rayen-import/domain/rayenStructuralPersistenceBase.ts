import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { mergePatientData } from '@/services/repositories/conflictResolutionMergeUtils';
import type { DailyRecordQueuedWriteState } from '@/services/storage/syncQueueTypes';

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  Boolean(patient?.patientName?.trim() && !patient.isBlocked);

const hasBedState = (patient: PatientData | undefined): patient is PatientData =>
  Boolean(patient && (patient.isBlocked || patient.patientName?.trim()));

const normalizeStableIdentifier = (value?: string): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

const matchesAuthoritativeOccupant = (
  localPatient: PatientData | undefined,
  authoritativePatient: PatientData | undefined
): boolean => {
  if (!hasBedState(localPatient) || !hasBedState(authoritativePatient)) return false;
  if (localPatient.isBlocked || authoritativePatient.isBlocked) {
    return Boolean(localPatient.isBlocked && authoritativePatient.isBlocked);
  }
  const localEpisode = localPatient.clinicalEpisodeId?.trim();
  const authoritativeEpisode = authoritativePatient.clinicalEpisodeId?.trim();
  if (localEpisode && authoritativeEpisode) return localEpisode === authoritativeEpisode;

  const localIdentifier = normalizeStableIdentifier(localPatient.rut);
  const authoritativeIdentifier = normalizeStableIdentifier(authoritativePatient.rut);
  const sameIdentifier = Boolean(localIdentifier && localIdentifier === authoritativeIdentifier);
  const sameAdmissionDay = Boolean(
    localPatient.admissionDate && localPatient.admissionDate === authoritativePatient.admissionDate
  );
  const localAdmissionTime = localPatient.admissionTime?.trim();
  const authoritativeAdmissionTime = authoritativePatient.admissionTime?.trim();
  const sameAdmissionTime = Boolean(
    localAdmissionTime &&
    authoritativeAdmissionTime &&
    localAdmissionTime === authoritativeAdmissionTime
  );
  return sameIdentifier && sameAdmissionDay && sameAdmissionTime;
};

const stableStringify = (value: unknown): string => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
};

const haveSamePatientContent = (left: PatientData, right: PatientData): boolean => {
  const { bedId: _leftBedId, ...leftContent } = left;
  const { bedId: _rightBedId, ...rightContent } = right;
  return stableStringify(leftContent) === stableStringify(rightContent);
};

const haveSameMovements = (
  local: Array<{ id?: string }>,
  authoritative: Array<{ id?: string }>
): boolean => {
  if (local.length !== authoritative.length) return false;
  const localMovements = local.map(stableStringify).sort();
  const authoritativeMovements = authoritative.map(stableStringify).sort();
  return localMovements.every((movement, index) => movement === authoritativeMovements[index]);
};

type ReviewedCollisionOutcome =
  | { kind: 'bed'; targetBedId: string }
  | { kind: 'absent'; disposition: 'discharge' | 'transfer' | 'remove' };

const reviewedCollisionOutcome = (
  diff: CensusImportDiff,
  episodeId: string
): ReviewedCollisionOutcome | undefined => {
  const outcomes: ReviewedCollisionOutcome[] = [];
  for (const resolution of diff.bedOccupancyCollisionResolutions ?? []) {
    const collision = (diff.bedOccupancyCollisions ?? []).find(
      item => item.id === resolution.collisionId
    );
    if (!collision) continue;
    const selected = collision.candidates.find(
      candidate => candidate.clinicalEpisodeId === resolution.selectedEpisodeId
    );
    const other = collision.candidates.find(
      candidate => candidate.clinicalEpisodeId !== resolution.selectedEpisodeId
    );
    if (!selected || !other) continue;
    if (selected.clinicalEpisodeId === episodeId) {
      outcomes.push({ kind: 'bed', targetBedId: collision.bedId });
      continue;
    }
    if (other.clinicalEpisodeId !== episodeId) continue;
    outcomes.push(
      resolution.otherDisposition.kind === 'move'
        ? { kind: 'bed', targetBedId: resolution.otherDisposition.targetBedId }
        : { kind: 'absent', disposition: resolution.otherDisposition.kind }
    );
  }
  if (outcomes.length !== 1) return undefined;
  return outcomes[0];
};

const assertNoPendingLocalStructure = (authoritative: DailyRecord, local: DailyRecord): void => {
  const hasPendingMovement =
    !haveSameMovements(local.discharges, authoritative.discharges) ||
    !haveSameMovements(local.transfers, authoritative.transfers) ||
    !haveSameMovements(local.cma, authoritative.cma);
  const localExtraBeds = [...local.activeExtraBeds].sort();
  const authoritativeExtraBeds = [...authoritative.activeExtraBeds].sort();
  const hasPendingExtraBed =
    localExtraBeds.length !== authoritativeExtraBeds.length ||
    localExtraBeds.some((bedId, index) => bedId !== authoritativeExtraBeds[index]);
  if (hasPendingMovement || hasPendingExtraBed) {
    throw new Error(
      'Hay movimientos locales sin confirmar. Actualiza el censo antes de continuar.'
    );
  }
};

const indexAuthoritativeEpisodes = (authoritative: DailyRecord): Map<string, string> => {
  const episodes = new Map<string, string>();
  Object.entries(authoritative.beds).forEach(([bedId, patient]) => {
    if (!isOccupied(patient) || !patient.clinicalEpisodeId) return;
    const previousBed = episodes.get(patient.clinicalEpisodeId);
    if (previousBed && previousBed !== bedId) {
      throw new Error(
        `El censo autoritativo contiene el episodio ${patient.clinicalEpisodeId} en ${previousBed} y ${bedId}.`
      );
    }
    episodes.set(patient.clinicalEpisodeId, bedId);
  });
  return episodes;
};

/**
 * Retains pending local notes/clinical fields while keeping the remote episode-to-bed placement.
 *
 * The ordinary repository read intentionally unions local and remote state. That is useful for
 * offline editing, but it can temporarily expose one episode in its old and new bed. Structural
 * Rayen persistence must instead use the remote placement as its single base, then carry local
 * content by clinicalEpisodeId before applying the reviewed admissions/moves/egresos.
 */
export const buildRayenStructuralPersistenceBase = (
  authoritative: DailyRecord,
  local: DailyRecord | null,
  diff: CensusImportDiff,
  options: { localWriteState?: DailyRecordQueuedWriteState } = {}
): DailyRecord => {
  const authoritativeEpisodes = indexAuthoritativeEpisodes(authoritative);
  if (!local) return authoritative;

  if (options.localWriteState === 'failed' || options.localWriteState === 'conflict') {
    throw new Error(
      'Hay cambios locales que no pudieron guardarse. Resuélvelos antes de sincronizar con Eloísa.'
    );
  }

  const localUpdatedAt = Date.parse(local.lastUpdated);
  const authoritativeUpdatedAt = Date.parse(authoritative.lastUpdated);
  if (!Number.isFinite(localUpdatedAt) || !Number.isFinite(authoritativeUpdatedAt)) {
    if (options.localWriteState === 'active') {
      throw new Error(
        'No se pudo verificar la versión local pendiente. Actualiza el censo antes de continuar.'
      );
    }
    return authoritative;
  }

  // A timestamp alone does not prove that this local version is still pending. Only an active
  // exact outbox version may contribute app-managed fields to the structural Rayen commit.
  if (options.localWriteState !== 'active') return authoritative;
  const preferLocalContent = localUpdatedAt >= authoritativeUpdatedAt;

  // An exact active outbox version is unconfirmed regardless of timestamp ordering. Its
  // app-managed fields may be retained, but any structural difference must first be part of the
  // reviewed Rayen plan; otherwise the pending write could later restore stale beds or movements.
  assertNoPendingLocalStructure(authoritative, local);
  const merged = resolveDailyRecordConflict(authoritative, local);
  // The reviewed diff was planned against the authoritative layout. Never carry a local-only
  // occupant into that commit: it was not shown to the user and could also block an approved move.
  const beds: Record<string, PatientData> = { ...authoritative.beds };
  const localByEpisode = new Map<string, PatientData[]>();

  Object.values(local.beds).forEach(patient => {
    if (!isOccupied(patient) || !patient.clinicalEpisodeId) return;
    const candidates = localByEpisode.get(patient.clinicalEpisodeId) ?? [];
    candidates.push(patient);
    localByEpisode.set(patient.clinicalEpisodeId, candidates);
  });

  const isReviewedLocalMove = (
    episodeId: string,
    authoritativeBedId: string,
    expectedLocalBedId?: string
  ): boolean => {
    const regularMove = diff.moves.some(move => {
      if (
        move.source.encounterId !== episodeId ||
        move.fromBedId !== authoritativeBedId ||
        (expectedLocalBedId && move.toBedId !== expectedLocalBedId)
      ) {
        return false;
      }
      const localTarget = local.beds[move.toBedId];
      return isOccupied(localTarget) && localTarget.clinicalEpisodeId === episodeId;
    });
    if (regularMove) return true;
    const outcome = reviewedCollisionOutcome(diff, episodeId);
    if (outcome?.kind !== 'bed') return false;
    if (expectedLocalBedId && outcome.targetBedId !== expectedLocalBedId) return false;
    const localTarget = local.beds[outcome.targetBedId];
    return isOccupied(localTarget) && localTarget.clinicalEpisodeId === episodeId;
  };

  const isReviewedLocalRemoval = (episodeId: string): boolean => {
    const outcome = reviewedCollisionOutcome(diff, episodeId);
    return (
      outcome?.kind === 'absent' &&
      outcome.disposition === 'remove' &&
      !Object.values(local.beds).some(
        patient => isOccupied(patient) && patient.clinicalEpisodeId?.trim() === episodeId
      )
    );
  };

  const unmatchedLocalBeds = Object.entries(local.beds)
    .filter(([, patient]) => hasBedState(patient))
    .filter(([bedId, patient]) => {
      const episodeId = patient.clinicalEpisodeId?.trim();
      const authoritativeBedId = episodeId ? authoritativeEpisodes.get(episodeId) : undefined;
      if (episodeId && authoritativeBedId) {
        if (bedId === authoritativeBedId) return false;
        return !isReviewedLocalMove(episodeId, authoritativeBedId, bedId);
      }
      return !matchesAuthoritativeOccupant(patient, authoritative.beds[bedId]);
    })
    .map(([bedId]) => bedId);
  const unmatchedAuthoritativeBeds = Object.entries(authoritative.beds)
    .filter(([, patient]) => hasBedState(patient))
    .filter(([bedId, patient]) => {
      if (matchesAuthoritativeOccupant(local.beds[bedId], patient)) return false;
      const episodeId = patient.clinicalEpisodeId?.trim();
      return !(
        episodeId &&
        (isReviewedLocalMove(episodeId, bedId) || isReviewedLocalRemoval(episodeId))
      );
    })
    .map(([bedId]) => bedId);
  const unmatchedBeds = [...new Set([...unmatchedLocalBeds, ...unmatchedAuthoritativeBeds])];
  if (unmatchedBeds.length > 0) {
    throw new Error(
      `Hay cambios locales de cama sin confirmar en ${unmatchedBeds.join(', ')}. Actualiza el censo antes de continuar.`
    );
  }

  if (!preferLocalContent) {
    for (const [episodeId, bedId] of authoritativeEpisodes) {
      const authoritativePatient = authoritative.beds[bedId];
      const concurrentLocalEdit = (localByEpisode.get(episodeId) ?? []).some(
        localPatient => !haveSamePatientContent(authoritativePatient, localPatient)
      );
      if (concurrentLocalEdit) {
        throw new Error(
          'El censo remoto cambió mientras había datos locales pendientes. Actualiza el censo antes de continuar.'
        );
      }
    }
  }

  Object.entries(authoritative.beds).forEach(([bedId, authoritativePatient]) => {
    const localPatient = local.beds[bedId];
    if (
      !hasBedState(authoritativePatient) ||
      !hasBedState(localPatient) ||
      !matchesAuthoritativeOccupant(localPatient, authoritativePatient)
    ) {
      return;
    }
    if (authoritativePatient.isBlocked && localPatient.isBlocked) {
      beds[bedId] = {
        ...(preferLocalContent ? authoritativePatient : localPatient),
        ...(preferLocalContent ? localPatient : authoritativePatient),
        bedId,
      };
      return;
    }
    beds[bedId] = {
      ...mergePatientData(
        authoritativePatient,
        localPatient,
        preferLocalContent,
        undefined,
        `beds.${bedId}`
      ),
      bedId,
    };
  });

  authoritativeEpisodes.forEach((bedId, episodeId) => {
    let patient = beds[bedId];
    for (const localPatient of localByEpisode.get(episodeId) ?? []) {
      if (localPatient === local.beds[bedId]) continue;
      patient = mergePatientData(
        patient,
        localPatient,
        preferLocalContent,
        undefined,
        `beds.${bedId}`
      );
    }

    beds[bedId] = { ...patient, bedId, clinicalEpisodeId: episodeId };
  });

  return {
    ...merged,
    date: authoritative.date,
    beds,
    discharges: authoritative.discharges,
    transfers: authoritative.transfers,
    cma: authoritative.cma,
    activeExtraBeds: authoritative.activeExtraBeds,
    // The structural save still compares against the exact remote revision.
    lastUpdated: authoritative.lastUpdated,
  };
};
