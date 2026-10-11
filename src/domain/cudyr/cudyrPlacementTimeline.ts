import type { CudyrSourcePlacement } from '@/types/domain/cudyrPlacement';

export interface ObservedCudyrPlacement {
  placement: CudyrSourcePlacement;
  observedAt: string;
  censusDate: string;
  captureId: string;
}

/** Offsets are mandatory. Eloísa's year-0001 sentinel is not an effective discharge. */
export const cudyrSourceInstant = (value: string): number | null => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
};

export interface CudyrPlacementResolution {
  status: 'resuelta' | 'conflicto' | 'sin_evidencia';
  evidence: ObservedCudyrPlacement[];
  reason: string;
}

/** Resolve only the requested episode/instant; capture time never becomes a movement time. */
export const resolveCudyrPlacementAt = (
  clinicalEpisodeId: string,
  referenceAt: string,
  observations: ObservedCudyrPlacement[]
): CudyrPlacementResolution => {
  const reference = cudyrSourceInstant(referenceAt);
  const annulled = new Set(
    observations
      .filter(
        ({ placement }) =>
          placement.clinicalEpisodeId === clinicalEpisodeId &&
          placement.isDeleted &&
          placement.sourceMappingId
      )
      .map(({ placement }) => placement.sourceMappingId)
  );
  const evidence = observations.filter(observation => {
    const { placement } = observation;
    if (
      reference === null ||
      placement.clinicalEpisodeId !== clinicalEpisodeId ||
      placement.isDeleted ||
      annulled.has(placement.sourceMappingId)
    )
      return false;
    const start = cudyrSourceInstant(placement.sourceStartAt);
    const end = cudyrSourceInstant(placement.sourceEndAt);
    const seen = cudyrSourceInstant(observation.observedAt);
    if (start === null || seen === null || start > seen || reference < start || reference > seen)
      return false;
    // A stale nested mapping with no real end is evidence of a past assignment, not a bounded stay.
    if (end === null && !placement.currentAssignment) return false;
    return end === null || (end > start && reference < end);
  });
  const distinct = new Set(
    evidence.map(
      ({ placement }) => `${placement.bedId || placement.sourceBedId}:${placement.modality}`
    )
  );
  const conflictingRevision = evidence.some(
    ({ placement: candidate }) =>
      candidate.sourceMappingId &&
      observations.some(({ placement, observedAt }) => {
        if (
          placement.clinicalEpisodeId !== clinicalEpisodeId ||
          placement.sourceMappingId !== candidate.sourceMappingId ||
          placement.isDeleted ||
          reference === null
        )
          return false;
        const seen = cudyrSourceInstant(observedAt);
        const start = cudyrSourceInstant(placement.sourceStartAt);
        const end = cudyrSourceInstant(placement.sourceEndAt);
        return (
          seen !== null &&
          seen >= reference &&
          start !== null &&
          (start > reference || (end !== null && end > start && end <= reference))
        );
      })
  );
  if (!evidence.length)
    return {
      status: 'sin_evidencia',
      evidence,
      reason: 'No hay asignación de cama con vigencia comprobable para esta fecha y hora.',
    };
  if (distinct.size > 1 || conflictingRevision)
    return {
      status: 'conflicto',
      evidence,
      reason: 'La fuente presenta asignaciones o versiones de vigencia contradictorias.',
    };
  return {
    status: 'resuelta',
    evidence,
    reason: 'Asignación respaldada por el intervalo de la fuente y su captura.',
  };
};
