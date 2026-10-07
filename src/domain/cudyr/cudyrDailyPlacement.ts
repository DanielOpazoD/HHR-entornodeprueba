import { getNextDay } from '@/utils/clinicalDayUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import {
  cudyrSourceInstant,
  resolveCudyrPlacementAt,
  type ObservedCudyrPlacement,
} from './cudyrPlacementTimeline';
import {
  resolveCudyrDailyEligibility,
  type CudyrDailyEligibilityInput,
  type CudyrPlacement,
} from './cudyrStatisticalContext';

/** Resolve the fixed hospital cutoff independently of the browser timezone and DST offset. */
export const cudyrReferenceInstant = (censusDate: string): string | null => {
  if (cudyrSourceInstant(`${censusDate}T00:00:00Z`) === null) return null;
  const nextDay = getNextDay(censusDate);
  const nominal = Date.parse(`${nextDay}T01:00:00Z`);
  if (!Number.isFinite(nominal)) return null;
  // IANA timezone conversion, including half/quarter-hour offsets; require a unique wall instant.
  const matches: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(nominal + offset * 60_000);
    const stamp = calendarStampInClinicalTimeZone(candidate);
    if (stamp.iso === nextDay && stamp.hhmm === '01:00') matches.push(candidate.toISOString());
  }
  return matches.length === 1 ? matches[0] : null;
};

export interface CudyrDailyPlacementInput extends CudyrDailyEligibilityInput {
  clinicalEpisodeId?: string;
  sourcePlacements: ObservedCudyrPlacement[];
  /** If a result is selected, its original instant owns its bed context, not the sync instant. */
  evaluationAt?: string;
}

const sourceContext = (evidence: ObservedCudyrPlacement): CudyrPlacement => ({
  bedId: evidence.placement.bedId,
  bedName: evidence.placement.sourceBedLabel,
  location: evidence.placement.sourceDepartmentLabel,
  bedMode: evidence.placement.modality === 'cuna' ? 'Cuna' : 'Cama',
  section: evidence.placement.modality === 'cma' ? 'cma' : 'census',
  modality: evidence.placement.modality,
});

/** Daily facts stay attached to their own day; a current bed never reclassifies the whole stay. */
export const resolveCudyrDailyPlacement = (input: CudyrDailyPlacementInput) => {
  const referenceAt = input.evaluationAt || cudyrReferenceInstant(input.date);
  const source = resolveCudyrPlacementAt(
    input.clinicalEpisodeId ?? '',
    referenceAt ?? '',
    input.sourcePlacements
  );
  const contexts =
    source.status === 'resuelta' ? source.evidence.map(sourceContext) : input.placements;
  const resolved = resolveCudyrDailyEligibility({
    ...input,
    placements: contexts,
    unresolvedTransition: input.unresolvedTransition || source.status === 'conflicto',
  });
  // Moving from an excluded modality into hospitalization needs an explicit hours policy for
  // the transition day. Do not silently equate birth, hospital admission and service admission.
  const transition =
    source.status === 'resuelta' &&
    resolved.modality === 'hospitalizacion' &&
    source.evidence.some(({ placement }) => {
      const start = cudyrSourceInstant(placement.sourceStartAt);
      if (start === null) return false;
      const startDay = calendarStampInClinicalTimeZone(new Date(start)).iso;
      return (
        startDay >= input.date &&
        startDay <= getNextDay(input.date) &&
        input.sourcePlacements.some(
          ({ placement: prior }) =>
            prior.clinicalEpisodeId === input.clinicalEpisodeId &&
            !prior.isDeleted &&
            ['cuna', 'cma'].includes(prior.modality) &&
            cudyrSourceInstant(prior.sourceEndAt) === start
        )
      );
    });
  const eligibility = transition
    ? {
        ...resolved,
        eligibility: 'por_revisar' as const,
        reason: 'Cambio de cuna/CMA a hospitalización: revisar inicio de las horas elegibles.',
      }
    : resolved;
  return {
    ...eligibility,
    referenceAt,
    contexts,
    contextSource:
      source.status === 'resuelta'
        ? ('eloisa_interval' as const)
        : source.status === 'conflicto'
          ? ('unresolved' as const)
          : ('hhr_daily' as const),
    sourceEvidence: source.evidence,
  };
};
