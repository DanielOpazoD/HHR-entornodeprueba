import type { PatientData } from './rayenDomainContracts';
import type { RayenEncounter } from './rayenSnapshot';

export interface NeonatalPlacementReview {
  episodeId: string;
  existingBedId?: string;
  existingKind?: 'mother' | 'independent';
  patient: PatientData;
  source: RayenEncounter;
  mothers: Array<{ bedId: string; episodeId: string; name: string; occupiedByEpisodeId?: string }>;
  independentBeds: string[];
  unavailableIndependentBeds?: string[];
}
export interface NeonatalPlacementResolution {
  episodeId: string;
  kind: 'mother' | 'independent' | 'deferred';
  parentEpisodeId?: string;
  bedId: string;
  /** Explicit onset of independent hospital care, in ISO form including offset. */
  effectiveAt?: string;
}
