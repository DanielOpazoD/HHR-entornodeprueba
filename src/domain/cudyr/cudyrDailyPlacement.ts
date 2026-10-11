import {
  reviewedNeonatalHospitalPlacement,
  reviewedNeonatalHospitalAdmission,
} from './cudyrReviewedNeonatalPlacement';
import { resolveCudyrHospitalAdmission, sourceCudyrModality } from './cudyrHospitalAdmission';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import {
  cudyrSourceInstant,
  resolveCudyrPlacementAt,
  type ObservedCudyrPlacement,
} from './cudyrPlacementTimeline';
import {
  resolveCudyrDailyEligibility,
  cudyrModality,
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
  useCensusAdmission?: boolean;
  sourcePlacements: ObservedCudyrPlacement[];
  /** If a result is selected, its original instant owns its bed context, not the sync instant. */
  evaluationAt?: string;
}

const sourceContext = (evidence: ObservedCudyrPlacement): CudyrPlacement => ({
  bedId: evidence.placement.bedId,
  sourceBedId: evidence.placement.sourceBedId,
  bedName: evidence.placement.sourceBedLabel,
  location: evidence.placement.sourceDepartmentLabel,
  bedMode: evidence.placement.modality === 'cuna' ? 'Cuna' : 'Cama',
  section: evidence.placement.modality === 'cma' ? 'cma' : 'census',
  modality: evidence.placement.modality,
});

/** Daily facts stay attached to their own day; a current bed never reclassifies the whole stay. */
export const resolveCudyrDailyPlacement = (input: CudyrDailyPlacementInput) => {
  const cutoffAt = cudyrReferenceInstant(input.date);
  const referenceAt = input.evaluationAt || cutoffAt;
  const source = resolveCudyrPlacementAt(
    input.clinicalEpisodeId ?? '',
    referenceAt ?? '',
    input.sourcePlacements
  );
  // Matching source corrections retain the reviewed onset of independent care.
  // Other source beds/services and conflicting intervals remain authoritative.
  const reviewedCandidate = reviewedNeonatalHospitalPlacement(
    input.placements,
    input.clinicalEpisodeId || '',
    referenceAt || ''
  );
  const reviewed =
    reviewedCandidate &&
    source.status !== 'conflicto' &&
    source.evidence.every(
      item =>
        cudyrModality(sourceContext(item)) === 'cuna' &&
        reviewedCandidate.sourcePlacementKey === `${item.placement.bedId ?? ''}:cuna` &&
        (reviewedCandidate.sourceService || '').trim() ===
          item.placement.sourceDepartmentLabel.trim()
    )
      ? reviewedCandidate
      : undefined;
  const validDailyContexts = input.placements.filter(p => {
    const d = p.neonatalPlacementDecision;
    return !(
      d?.kind === 'independent' &&
      d.clinicalEpisodeId === input.clinicalEpisodeId &&
      referenceAt &&
      Date.parse(d.effectiveAt) > Date.parse(referenceAt)
    );
  });
  const contexts = reviewed
    ? [reviewed.context]
    : source.status === 'resuelta'
      ? [
          ...new Map(
            [...source.evidence]
              .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
              .map(item => [
                JSON.stringify([
                  item.placement.sourceBedId,
                  item.placement.bedId,
                  sourceCudyrModality(item.placement),
                ]),
                sourceContext(item),
              ])
          ).values(),
        ]
      : validDailyContexts;
  let admission = resolveCudyrHospitalAdmission(
    input.clinicalEpisodeId || '',
    input.sourcePlacements,
    cutoffAt || '',
    true,
    input.useCensusAdmission &&
      contexts.length > 0 &&
      contexts.every(context => cudyrModality(context) === 'hospitalizacion')
      ? { date: input.admissionDate || '', time: input.admissionTime || '' }
      : undefined
  );
  if (
    reviewedCandidate &&
    source.status !== 'conflicto' &&
    contexts.length &&
    contexts.every(context => cudyrModality(context) === 'hospitalizacion')
  ) {
    admission = reviewedNeonatalHospitalAdmission(
      input.clinicalEpisodeId || '',
      reviewedCandidate.admissionAt,
      cutoffAt || '',
      input.sourcePlacements,
      reviewedCandidate.context.bedId || ''
    );
  }
  // The patient belongs to this night even when admitted after the CUDYR cutoff.
  // Only a daily hospital census and no prior/invalid source movements may use this fallback.
  if (
    !admission.at &&
    cutoffAt &&
    input.useCensusAdmission &&
    input.admissionDate === getNextDay(input.date) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(input.admissionTime || '') &&
    (input.admissionTime || '') >= '01:00' &&
    resolveClinicalDayForDateTime(input.admissionDate, input.admissionTime) === input.date &&
    contexts.length > 0 &&
    contexts.every(context => cudyrModality(context) === 'hospitalizacion')
  ) {
    // A broad reference only resolves the timestamp. Eligibility still uses the original 01:00.
    const candidate = resolveCudyrHospitalAdmission(
      input.clinicalEpisodeId || '',
      input.sourcePlacements,
      new Date(Date.parse(cutoffAt) + 8 * 60 * 60 * 1000).toISOString(),
      true,
      { date: input.admissionDate, time: input.admissionTime || '' }
    );
    if (candidate.at && Date.parse(candidate.at) >= Date.parse(cutoffAt)) admission = candidate;
  }
  const stamp = admission.at ? calendarStampInClinicalTimeZone(new Date(admission.at)) : null;
  const resolved = resolveCudyrDailyEligibility({
    ...input,
    placements: contexts,
    ...(stamp ? { admissionDate: stamp.iso, admissionTime: stamp.hhmm } : {}),
    unresolvedTransition: input.unresolvedTransition || source.status === 'conflicto',
  });
  // Unknown service admission cannot borrow earlier Urgencias hours to prove eligibility.
  // Preserve explicit modality exclusions and the existing review/conflict reasons.
  let eligibility = resolved;
  if (resolved.modality === 'hospitalizacion' && resolved.eligibility !== 'por_revisar') {
    if (!admission.at || !cutoffAt) {
      eligibility = { ...resolved, eligibility: 'por_revisar', reason: admission.source };
    } else {
      const meetsMinimum = Date.parse(cutoffAt) - Date.parse(admission.at) >= 8 * 60 * 60 * 1000;
      eligibility = {
        ...resolved,
        eligibility: meetsMinimum ? 'elegible' : 'no_elegible',
        reason: meetsMinimum
          ? 'Cumple ocho horas de hospitalización al corte de 01:00 del día siguiente.'
          : 'Hospitalización menor de 8 horas al corte de 01:00 del día siguiente.',
      };
    }
  }
  return {
    ...eligibility,
    ...(reviewed ? { reason: `Ubicación RN confirmada en HHR. ${eligibility.reason}` } : {}),
    referenceAt,
    hospitalStayAdmissionAt: admission.at,
    contexts,
    contextSource: reviewed
      ? ('hhr_daily' as const)
      : source.status === 'resuelta'
        ? ('eloisa_interval' as const)
        : source.status === 'conflicto'
          ? ('unresolved' as const)
          : ('hhr_daily' as const),
    sourceEvidence: source.evidence,
  };
};
