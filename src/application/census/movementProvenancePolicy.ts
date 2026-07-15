import type {
  MovementClassification,
  MovementProvenance,
  MovementProvenanceSource,
} from '@/types/domain/movements';

export interface MovementProvenanceSeed {
  source: Exclude<MovementProvenanceSource, 'reclassified'>;
  actor?: string;
  at: string;
  syncRunId?: string;
}

interface BuildMovementProvenanceInput extends MovementProvenanceSeed {
  movementId: string;
}

interface BuildReclassifiedMovementProvenanceInput {
  previousMovementId: string;
  previousClassification: MovementClassification;
  previousProvenance?: MovementProvenance;
  actor?: string;
  at: string;
}

const optionalText = (value?: string): string | undefined => value?.trim() || undefined;

export const buildMovementProvenance = ({
  movementId,
  source,
  actor,
  at,
  syncRunId,
}: BuildMovementProvenanceInput): MovementProvenance => {
  const classifiedBy = optionalText(actor);
  const normalizedSyncRunId = optionalText(syncRunId);
  return {
    source,
    lineageId: movementId,
    classifiedAt: at,
    ...(classifiedBy ? { classifiedBy } : {}),
    ...(normalizedSyncRunId ? { syncRunId: normalizedSyncRunId } : {}),
  };
};

export const buildReclassifiedMovementProvenance = ({
  previousMovementId,
  previousClassification,
  previousProvenance,
  actor,
  at,
}: BuildReclassifiedMovementProvenanceInput): MovementProvenance => {
  const classifiedBy = optionalText(actor);
  const syncRunId = optionalText(previousProvenance?.syncRunId);
  return {
    source: 'reclassified',
    lineageId: previousProvenance?.lineageId || previousMovementId,
    classifiedAt: at,
    ...(classifiedBy ? { classifiedBy } : {}),
    ...(syncRunId ? { syncRunId } : {}),
    previousMovementId,
    previousClassification,
  };
};

export const buildManualMovementProvenanceSeed = (
  actor: string | undefined,
  at: string = new Date().toISOString()
): MovementProvenanceSeed => ({ source: 'manual', actor, at });

export const stableReclassifiedMovementId = (
  previousMovementId: string,
  target: MovementClassification,
  fallback: () => string
): string => {
  const normalized = previousMovementId.trim();
  return normalized ? `reclassified:${normalized}:${target}` : fallback();
};
