import type { AuthRuntimeSnapshot } from '@/services/auth/authRuntimeSnapshot';
import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';
import type { LocalPersistenceRuntimeSnapshot } from '@/services/storage/indexeddb/indexedDbCore';
import type { SyncQueueTelemetry } from '@/services/storage/sync';

export type ClientOperationalRuntimeState = 'ok' | OperationalRuntimeState;

export interface ClientOperationalRuntimeSnapshot {
  auth: AuthRuntimeSnapshot;
  localPersistence: LocalPersistenceRuntimeSnapshot;
  sync: SyncQueueTelemetry;
  runtimeState: ClientOperationalRuntimeState;
  degradedLocalPersistence: boolean;
  syncReadUnavailable: boolean;
  issues: string[];
}

const RUNTIME_PRIORITY: Array<ClientOperationalRuntimeState> = [
  'unauthorized',
  'blocked',
  'recoverable',
  'retryable',
  'degraded',
  'ok',
];

const resolveHighestPriorityRuntimeState = (
  states: ClientOperationalRuntimeState[]
): ClientOperationalRuntimeState => RUNTIME_PRIORITY.find(state => states.includes(state)) || 'ok';

const mapSyncRuntimeState = (sync: SyncQueueTelemetry): ClientOperationalRuntimeState => {
  if (sync.readState === 'unavailable') {
    return 'blocked';
  }

  if (sync.runtimeState === 'blocked') {
    return 'blocked';
  }

  if (sync.runtimeState === 'degraded') {
    return 'degraded';
  }

  return 'ok';
};

export const buildClientOperationalRuntimeSnapshot = ({
  auth,
  localPersistence,
  sync,
}: {
  auth: AuthRuntimeSnapshot;
  localPersistence: LocalPersistenceRuntimeSnapshot;
  sync: SyncQueueTelemetry;
}): ClientOperationalRuntimeSnapshot => {
  const syncRuntimeState = mapSyncRuntimeState(sync);
  const runtimeState = resolveHighestPriorityRuntimeState([
    auth.runtimeState,
    localPersistence.runtimeState,
    syncRuntimeState,
  ]);
  const degradedLocalPersistence =
    localPersistence.runtimeState !== 'ok' || sync.readState === 'unavailable';
  const issues = [
    ...(auth.issues || []),
    ...(sync.issues || []),
    ...(sync.readState === 'unavailable'
      ? ['La cola de sincronizacion no pudo inspeccionarse desde runtime local.']
      : []),
  ];

  return {
    auth,
    localPersistence,
    sync,
    runtimeState,
    degradedLocalPersistence,
    syncReadUnavailable: sync.readState === 'unavailable',
    issues,
  };
};
