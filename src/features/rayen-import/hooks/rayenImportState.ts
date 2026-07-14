import type { ApplyResult } from '../domain/applyCensusImportDiff';
import type { CensusImportDiff } from '../contracts/censusImportDiff';

export interface RayenImportState {
  diff: CensusImportDiff | null;
  isPreviewOpen: boolean;
  isBusy: boolean;
  isSyncing: boolean;
  result: ApplyResult | null;
  error: string | null;
}

export const INITIAL_RAYEN_IMPORT_STATE: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  isBusy: false,
  isSyncing: false,
  result: null,
  error: null,
};

export const getRayenImportErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
