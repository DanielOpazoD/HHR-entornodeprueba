import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { reservedRayenStructuralTargetBedIds } from '../domain/bedOccupancyCollisionPolicy';
import type { RayenSyncStage } from '../hooks/rayenSyncExecutionState';

export const presentRayenWorkingMessage = (stage?: RayenSyncStage | null): string | null => {
  if (stage?.type === 'persisting_structure') return 'Guardando los cambios del censo…';
  if (stage?.type === 'verifying_structure') return 'Confirmando la versión guardada…';
  if (stage?.type === 'syncing_clinical') {
    return 'Completando signos vitales, escalas y dispositivos…';
  }
  return null;
};

export const reservedRayenTargetBedIds = (diff: CensusImportDiff | null): string[] =>
  diff ? reservedRayenStructuralTargetBedIds(diff) : [];
