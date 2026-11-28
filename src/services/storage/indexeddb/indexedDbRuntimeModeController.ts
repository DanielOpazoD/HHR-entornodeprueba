export interface LocalPersistenceRuntimeSnapshot {
  indexedDbAvailable: boolean;
  fallbackMode: boolean;
  runtimeState: 'ok' | 'recoverable';
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

export const buildLocalPersistenceRuntimeSnapshot = ({
  indexedDbAvailable,
  isUsingMock,
}: {
  indexedDbAvailable: boolean;
  isUsingMock: boolean;
}): LocalPersistenceRuntimeSnapshot => ({
  indexedDbAvailable,
  fallbackMode: isUsingMock,
  runtimeState: isUsingMock ? 'recoverable' : 'ok',
});
