import React from 'react';
import type {
  BedOccupancyCollisionResolution,
  CmaAdmissionResolution,
  CensusImportDiff,
} from '../contracts/censusImportDiff';
import type {
  NeonatalPlacementReview,
  NeonatalPlacementResolution,
} from '../contracts/neonatalPlacementReview';

export const RayenImportConfirmButton: React.FC<{
  onConfirm: (
    previous: boolean,
    collisions?: BedOccupancyCollisionResolution[],
    cma?: CmaAdmissionResolution[],
    neonatal?: NeonatalPlacementResolution[],
    neonatalSourceAcknowledgements?: string[]
  ) => void;
  previousDays: boolean;
  collisions: BedOccupancyCollisionResolution[];
  hasCollisions: boolean;
  cma: CmaAdmissionResolution[];
  needsCma: boolean;
  neonatal: NeonatalPlacementResolution[];
  neonatalReviews: NeonatalPlacementReview[];
  neonatalSourceChanges: NonNullable<CensusImportDiff['neonatalSourceChanges']>;
  neonatalSourceAcknowledgements: string[];
  disabled: boolean;
  label: string;
}> = ({
  onConfirm,
  previousDays,
  collisions,
  hasCollisions,
  cma,
  needsCma,
  neonatal,
  neonatalReviews,
  neonatalSourceChanges,
  neonatalSourceAcknowledgements,
  disabled,
  label,
}) => (
  <button
    type="button"
    disabled={
      disabled ||
      neonatalSourceChanges.some(c => !neonatalSourceAcknowledgements.includes(c.episodeId)) ||
      neonatalReviews.some(r => neonatal.filter(c => c.episodeId === r.episodeId).length !== 1) ||
      neonatal.some(c => c.kind === 'independent' && !c.effectiveAt)
    }
    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
    onClick={() => {
      if (neonatalSourceChanges.length)
        onConfirm(
          previousDays,
          hasCollisions ? collisions : undefined,
          needsCma ? cma : undefined,
          neonatal,
          neonatalSourceAcknowledgements
        );
      else if (neonatal.length)
        onConfirm(
          previousDays,
          hasCollisions ? collisions : undefined,
          needsCma ? cma : undefined,
          neonatal
        );
      else if (needsCma) onConfirm(previousDays, hasCollisions ? collisions : undefined, cma);
      else if (hasCollisions) onConfirm(previousDays, collisions);
      else onConfirm(previousDays);
    }}
  >
    {label}
  </button>
);
