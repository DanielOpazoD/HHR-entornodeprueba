import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { reservedRayenStructuralTargetBedIds } from '../domain/bedOccupancyCollisionPolicy';

export const reservedRayenTargetBedIds = (diff: CensusImportDiff | null): string[] =>
  diff ? reservedRayenStructuralTargetBedIds(diff) : [];
