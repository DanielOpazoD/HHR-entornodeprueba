import { createCensusDialogRuntime } from '@/features/census/controllers/censusBrowserRuntimeAdapter';

export interface SharedCensusBrowserRuntime {
  alert: (message: string) => void;
  open: (url: string, target?: string) => void;
}

export const defaultSharedCensusBrowserRuntime: SharedCensusBrowserRuntime =
  createCensusDialogRuntime();
