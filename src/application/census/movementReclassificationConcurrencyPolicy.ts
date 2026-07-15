import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { MovementClassification } from '@/types/domain/movements';

const MOVEMENT_KEYS = ['discharges', 'transfers', 'cma'] as const;

type MovementKey = (typeof MOVEMENT_KEYS)[number];

const classificationByKey: Record<MovementKey, MovementClassification> = {
  discharges: 'discharge',
  transfers: 'transfer',
  cma: 'cma',
};

interface MovementLike {
  id?: unknown;
  deletedAt?: unknown;
  movementProvenance?: {
    lineageId?: unknown;
  };
}

export interface ActiveMovementLineageConflict {
  lineageId: string;
  classifications: MovementClassification[];
  movementIds: string[];
}

const isActive = (movement: MovementLike): boolean => !String(movement.deletedAt || '').trim();

/**
 * Reclassification updates replace the source list and one destination list in one logical write.
 * Keeping this predicate pure lets persistence opt into stricter cross-client semantics without
 * coupling the UI hook to Firestore.
 */
export const isMovementReclassificationPatch = (patch: DailyRecordPatch): boolean => {
  const movementRoots = new Set(
    Object.keys(patch)
      .map(path => path.split('.')[0])
      .filter((path): path is MovementKey => MOVEMENT_KEYS.includes(path as MovementKey))
  );

  return movementRoots.size >= 2;
};

export const findActiveMovementLineageConflicts = (
  record: Pick<DailyRecord, MovementKey>
): ActiveMovementLineageConflict[] => {
  const activeByLineage = new Map<
    string,
    Array<{ classification: MovementClassification; movementId: string }>
  >();

  MOVEMENT_KEYS.forEach(key => {
    const movements = Array.isArray(record[key]) ? (record[key] as unknown as MovementLike[]) : [];
    movements.filter(isActive).forEach(movement => {
      const lineageId = String(movement.movementProvenance?.lineageId || '').trim();
      if (!lineageId) return;

      const entries = activeByLineage.get(lineageId) ?? [];
      entries.push({
        classification: classificationByKey[key],
        movementId: String(movement.id || '').trim(),
      });
      activeByLineage.set(lineageId, entries);
    });
  });

  return Array.from(activeByLineage.entries()).flatMap(([lineageId, entries]) => {
    const classifications = Array.from(new Set(entries.map(entry => entry.classification)));
    if (classifications.length <= 1) return [];

    return [
      {
        lineageId,
        classifications,
        movementIds: entries.map(entry => entry.movementId).filter(Boolean),
      },
    ];
  });
};
