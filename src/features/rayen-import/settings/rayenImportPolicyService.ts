import { doc, onSnapshot } from 'firebase/firestore';
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
  let unsubscribe = () => {};
  void ensureFirestoreRuntimeReady(runtime)
    .then(() => {
      if (!active) return;
      unsubscribe = onSnapshot(
        policyRef(runtime),
        { includeMetadataChanges: true },
        snapshot => {
          const data = snapshot.exists() ? snapshot.data() : null;
          const policy = data ? normalizeRayenImportPolicy(data) : null;
          handlers.onSnapshot({
            policy,
            exists: snapshot.exists(),
            requiresMigration: Boolean(policy && data?.schemaVersion === 1),
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
          });
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
