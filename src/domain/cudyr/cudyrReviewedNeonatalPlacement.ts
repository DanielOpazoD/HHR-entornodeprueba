import { resolveCudyrHospitalAdmission, sourceCudyrModality } from './cudyrHospitalAdmission';
import type { ObservedCudyrPlacement } from './cudyrPlacementTimeline';
import type { CudyrPlacement } from './cudyrStatisticalContext';
import { cudyrStatisticalGroup } from './cudyrStatisticalContext';

/** A reviewed care transition affects only its exact episode and effective time, never the whole stay. */
export const reviewedNeonatalHospitalPlacement = (
  placements: CudyrPlacement[],
  episode: string,
  referenceAt: string
):
  | {
      context: CudyrPlacement;
      admissionAt: string;
      sourceService?: string;
      sourcePlacementKey?: string;
    }
  | undefined => {
  if (!episode || !Number.isFinite(Date.parse(referenceAt))) return;
  const matches = placements.filter(p => {
    const d = p.neonatalPlacementDecision;
    return (
      d?.kind === 'independent' &&
      d.clinicalEpisodeId === episode &&
      d.bedId === p.bedId &&
      p.section === 'census' &&
      p.bedMode === 'Cama' &&
      cudyrStatisticalGroup(p.bedId) !== 'sin_grupo' &&
      Number.isFinite(Date.parse(d.effectiveAt)) &&
      Number.isFinite(Date.parse(d.reviewedAt)) &&
      Date.parse(d.effectiveAt) <= Date.parse(d.reviewedAt) &&
      Date.parse(d.effectiveAt) <= Date.parse(referenceAt)
    );
  });
  if (
    !matches.length ||
    new Set(matches.map(p => JSON.stringify(p.neonatalPlacementDecision))).size !== 1 ||
    placements.some(p => p.section === 'crib' || p.bedId !== matches[0].bedId)
  )
    return;
  return {
    context: {
      bedId: matches[0].bedId,
      section: 'census',
      bedMode: 'Cama',
      modality: 'hospitalizacion',
    },
    admissionAt: matches[0].neonatalPlacementDecision!.effectiveAt,
    sourceService: matches[0].neonatalPlacementDecision!.sourceService,
    sourcePlacementKey: matches[0].neonatalPlacementDecision!.sourcePlacementKey,
  };
};

/** Seed the confirmed independent-care onset; later excluded tranches or gaps still reset a stay. */
export const reviewedNeonatalHospitalAdmission = (
  episode: string,
  admissionAt: string,
  referenceAt: string,
  history: ObservedCudyrPlacement[],
  bedId: string
) => {
  const onset = Date.parse(admissionAt);
  const own = history.filter(item => item.placement.clinicalEpisodeId === episode);
  const subsequent = own.flatMap(item => {
    const start = Date.parse(item.placement.sourceStartAt);
    if (!Number.isFinite(start)) return [item];
    if (start >= onset) return [item];
    // The reviewed onset supersedes an older erroneous crib assignment. Other evidence is preserved.
    if (sourceCudyrModality(item.placement) === 'cuna') return [];
    if (sourceCudyrModality(item.placement) !== 'hospitalizacion') return [item];
    const end = Date.parse(item.placement.sourceEndAt);
    if (Number.isFinite(end) && end <= onset) return [];
    return [{ ...item, placement: { ...item.placement, sourceStartAt: admissionAt } }];
  });
  const reviewed: ObservedCudyrPlacement = {
    observedAt: referenceAt,
    censusDate: '',
    captureId: 'reviewed-care-onset',
    placement: {
      clinicalEpisodeId: episode,
      sourceMappingId: `reviewed:${episode}:${admissionAt}`,
      sourceBedId: bedId,
      sourceBedLabel: bedId,
      sourceDepartmentId: '',
      sourceDepartmentLabel: '',
      sourceVersion: 'hhr-reviewed-care',
      sourceStartAt: admissionAt,
      sourceEndAt: '',
      bedId,
      modality: 'hospitalizacion',
      currentAssignment: true,
      isDeleted: false,
    },
  };
  return resolveCudyrHospitalAdmission(episode, [...subsequent, reviewed], referenceAt, true);
};
