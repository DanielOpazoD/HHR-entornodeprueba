import { doc, onSnapshot, type DocumentData } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import { normalizeRayenImportPolicy, type RayenImportPolicy } from './rayenImportSettings';

export interface RayenImportPolicySnapshot {
  policy: RayenImportPolicy | null;
  exists: boolean;
  requiresMigration?: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface RayenImportPolicySubscription {
  onSnapshot: (snapshot: RayenImportPolicySnapshot) => void;
  onError: (error: unknown) => void;
}

const policyRef = (runtime: FirestoreServiceRuntimePort) =>
  doc(runtime.getDb(), getSettingsDocPath(SETTINGS_DOCS.RAYEN_IMPORT_POLICY));

const e2ePolicyOverride = (): RayenImportPolicy | null => {
  if (!isE2ERuntimeEnabled() || typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(
      localStorage.getItem('hhr_e2e_rayen_import_policy') || 'null'
    ) as Partial<RayenImportPolicy> | null;
    if (
      !value ||
      value.mode !== 'preview' ||
      value.clinicalBatchMode !== 'enforced' ||
      !Number.isInteger(value.revision) ||
      Number(value.revision) < 1
    ) {
      return null;
    }
    return value as RayenImportPolicy;
  } catch {
    return null;
  }
};

/** Subscribe with metadata so only a server-confirmed policy can authorize a run. */
export const subscribeToRayenImportPolicy = (
  handlers: RayenImportPolicySubscription,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): (() => void) => {
  const e2ePolicy = e2ePolicyOverride();
  if (e2ePolicy) {
    queueMicrotask(() =>
      handlers.onSnapshot({
        policy: e2ePolicy,
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      })
    );
    return () => undefined;
  }
  let active = true;
  let latest = 0;
  let unsubscribe = () => {};
  const deliver = (data?: DocumentData | null, fromCache = false, hasPendingWrites = false) => {
    const policy = data ? normalizeRayenImportPolicy(data) : null;
    handlers.onSnapshot({
      policy,
      exists: !!data,
      requiresMigration: !!policy && data?.schemaVersion === 1,
      fromCache,
      hasPendingWrites,
    });
  };
  void ensureFirestoreRuntimeReady(runtime)
    .then(() => {
      if (!active) return;
      unsubscribe = onSnapshot(
        policyRef(runtime),
        { includeMetadataChanges: true },
        snapshot => {
          const turn = ++latest;
          const { fromCache, hasPendingWrites } = snapshot.metadata;
          if (snapshot.exists() || fromCache) {
            deliver(snapshot.data(), fromCache, hasPendingWrites);
            return;
          }
          // The browser's local copy can keep a stale «does not exist» that the listener reports as
          // confirmed (2026-11-07: right after IndexedDB closed under the app, sync stayed blocked
          // as «not configured» while the server had the policy). Only the server may say missing.
          import('./policyServerRead')
            .then(server => server.default(runtime.getDb()))
            .then(
              confirmed => active && turn === latest && deliver(confirmed),
              error => active && turn === latest && handlers.onError(error)
            );
        },
        handlers.onError
      );
    })
    .catch(handlers.onError);
  return () => {
    active = false;
    unsubscribe();
  };
};
