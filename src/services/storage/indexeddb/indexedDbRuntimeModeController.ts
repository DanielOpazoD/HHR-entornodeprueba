import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';

export interface LocalPersistenceRuntimeSnapshot {
  indexedDbAvailable: boolean;
  fallbackMode: boolean;
  stickyFallbackMode: boolean;
  runtimeState: 'ok' | OperationalRuntimeState;
}

export interface IndexedDbRuntimeModeState {
  isUsingMock: boolean;
  stickyFallbackMode: boolean;
}

export const hasE2ERuntimeOverride = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.__HHR_E2E_OVERRIDE__);

export const shouldExposeDatabaseFallbackToUi = ({
  fallbackMode,
  e2eOverrideActive,
}: {
  fallbackMode: boolean;
  e2eOverrideActive: boolean;
}): boolean => fallbackMode && !e2eOverrideActive;

export const shouldSkipReadyCheckForMock = ({
  isUsingMock,
  allowRecoveryWhenMock,
}: {
  isUsingMock: boolean;
  allowRecoveryWhenMock: boolean;
}): boolean => isUsingMock && !allowRecoveryWhenMock;

export const shouldAttemptMockRecovery = ({
  isUsingMock,
  allowRecoveryWhenMock,
  stickyFallbackMode,
}: IndexedDbRuntimeModeState & { allowRecoveryWhenMock: boolean }): boolean =>
  isUsingMock && allowRecoveryWhenMock && !stickyFallbackMode;

export const resolveLocalPersistenceRuntimeState = ({
  isUsingMock,
  stickyFallbackMode,
}: IndexedDbRuntimeModeState): LocalPersistenceRuntimeSnapshot['runtimeState'] => {
  if (stickyFallbackMode) return 'blocked';
  if (isUsingMock) return 'recoverable';
  return 'ok';
};

export const buildLocalPersistenceRuntimeSnapshot = ({
  indexedDbAvailable,
  isUsingMock,
  stickyFallbackMode,
}: IndexedDbRuntimeModeState & {
  indexedDbAvailable: boolean;
}): LocalPersistenceRuntimeSnapshot => ({
  indexedDbAvailable,
  fallbackMode: isUsingMock,
  stickyFallbackMode,
  runtimeState: resolveLocalPersistenceRuntimeState({ isUsingMock, stickyFallbackMode }),
});
