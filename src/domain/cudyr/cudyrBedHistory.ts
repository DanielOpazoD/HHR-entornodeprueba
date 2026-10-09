import type { CudyrBedHistoryEntry } from '@/types/domain/cudyrReport';
import { cudyrSourceInstant, type ObservedCudyrPlacement } from './cudyrPlacementTimeline';
import { sourceCudyrModality } from './cudyrHospitalAdmission';

/** Display archived assignments, not an invented continuous itinerary. */
export const buildCudyrBedHistory = (
  episode: string,
  observations: ObservedCudyrPlacement[]
): CudyrBedHistoryEntry[] => {
  if (!episode) return [];
  const groups = new Map<string, ObservedCudyrPlacement[]>();
  for (const item of observations) {
    const p = item.placement;
    if (p.clinicalEpisodeId !== episode) continue;
    const key = p.sourceMappingId || JSON.stringify([p.sourceBedId, p.bedId, p.sourceStartAt]);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups]
    .map(([key, values]): CudyrBedHistoryEntry => {
      const sorted = [...values].sort(
        (a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0)
      );
      const { placement: p, observedAt } = sorted[0];
      const closed = values.filter(x => cudyrSourceInstant(x.placement.sourceEndAt) !== null);
      const closureConflict =
        new Set(closed.map(x => cudyrSourceInstant(x.placement.sourceEndAt))).size > 1 ||
        closed.some(x =>
          values.some(
            y =>
              cudyrSourceInstant(y.placement.sourceEndAt) === null &&
              Date.parse(y.observedAt) >= Date.parse(x.observedAt)
          )
        ) ||
        closed.some(
          x =>
            (cudyrSourceInstant(x.placement.sourceEndAt) ?? 0) <=
            (cudyrSourceInstant(x.placement.sourceStartAt) ?? Infinity)
        );
      const contradictory =
        closureConflict ||
        values.some(
          x =>
            x.placement.sourceStartAt !== p.sourceStartAt ||
            x.placement.sourceBedId !== p.sourceBedId ||
            sourceCudyrModality(x.placement) !== sourceCudyrModality(p)
        );
      const endAt = cudyrSourceInstant(p.sourceEndAt) !== null ? p.sourceEndAt : '';
      return {
        key,
        bed: p.sourceBedLabel || p.bedId || 'Cama no informada',
        service: p.sourceDepartmentLabel,
        modality: sourceCudyrModality(p),
        startAt: cudyrSourceInstant(p.sourceStartAt) !== null ? p.sourceStartAt : '',
        endAt,
        observedAt,
        status: values.some(x => x.placement.isDeleted)
          ? 'anulada'
          : contradictory
            ? 'contradictoria'
            : endAt
              ? 'finalizada'
              : 'observada',
      };
    })
    .sort(
      (a, b) =>
        (Date.parse(a.startAt) || 0) - (Date.parse(b.startAt) || 0) || a.key.localeCompare(b.key)
    );
};
