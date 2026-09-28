import type { ApplyResult } from '../domain/applyCensusImportDiff';
import type { CensusImportDiff } from '../contracts/censusImportDiff';

export interface RayenImportState {
  diff: CensusImportDiff | null;
  isPreviewOpen: boolean;
  isBusy: boolean;
  isSyncing: boolean;
  result: ApplyResult | null;
  hasSkippedItems: boolean;
  error: string | null;
}

export const INITIAL_RAYEN_IMPORT_STATE: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  isBusy: false,
  isSyncing: false,
  result: null,
  hasSkippedItems: false,
  error: null,
};

export const getRayenImportErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Specialty change requires explicit intent.') {
    return 'No se pudo completar la sincronización porque se intentó modificar una especialidad protegida. Actualiza la aplicación y vuelve a capturar el censo. No necesitas asignar una especialidad para sincronizar.';
  }
  return message;
};
