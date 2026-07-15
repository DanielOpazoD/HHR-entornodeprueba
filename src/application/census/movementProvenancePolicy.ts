import type { MovementClassification, MovementProvenance } from '@/types/domain/movements';

interface MovementProvenanceSeedBase {
  actor?: string;
  at: string;
}

interface ManualMovementProvenanceSeed extends MovementProvenanceSeedBase {
  source: 'manual';
  syncRunId?: never;
}

interface BedManagementMovementProvenanceSeed extends MovementProvenanceSeedBase {
  source: 'gestion_camas';
  syncRunId: string;
}

export type MovementProvenanceSeed =
  | ManualMovementProvenanceSeed
  | BedManagementMovementProvenanceSeed;

type BuildMovementProvenanceInput = MovementProvenanceSeed & { movementId: string };

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
  const shared = {
    lineageId: movementId,
    classifiedAt: at,
    ...(classifiedBy ? { classifiedBy } : {}),
  };
  if (source === 'gestion_camas') {
    const normalizedSyncRunId = optionalText(syncRunId);
    if (!normalizedSyncRunId) {
      throw new Error('Gestion de Camas movement provenance requires a synchronization run id.');
    }
    return {
      ...shared,
      source,
      syncRunId: normalizedSyncRunId,
    };
  }
  return {
    ...shared,
    source,
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
): ManualMovementProvenanceSeed => ({ source: 'manual', actor, at });

export const stableReclassifiedMovementId = (
  previousMovementId: string,
  target: MovementClassification,
  fallback: () => string
): string => {
  const normalized = previousMovementId.trim();
  return normalized ? `reclassified:${normalized}:${target}` : fallback();
};
