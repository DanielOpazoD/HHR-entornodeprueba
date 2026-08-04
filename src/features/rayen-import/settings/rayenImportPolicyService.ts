import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  RAYEN_IMPORT_POLICY_SCHEMA_VERSION,
  normalizeRayenImportPolicy,
  type RayenImportMode,
  type RayenImportPolicy,
} from './rayenImportSettings';

export interface RayenImportPolicySnapshot {
  policy: RayenImportPolicy | null;
  exists: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface RayenImportPolicySubscription {
  onSnapshot: (snapshot: RayenImportPolicySnapshot) => void;
  onError: (error: unknown) => void;
}

const policyRef = (runtime: FirestoreServiceRuntimePort) =>
  doc(runtime.getDb(), getSettingsDocPath(SETTINGS_DOCS.RAYEN_IMPORT_POLICY));

/** Subscribe with metadata so cached `auto` values can never enable automation. */
export const subscribeToRayenImportPolicy = (
  handlers: RayenImportPolicySubscription,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): (() => void) => {
  let active = true;
  let unsubscribe = () => {};
  void ensureFirestoreRuntimeReady(runtime)
    .then(() => {
      if (!active) return;
      unsubscribe = onSnapshot(
        policyRef(runtime),
        { includeMetadataChanges: true },
        snapshot => {
          handlers.onSnapshot({
            policy: snapshot.exists() ? normalizeRayenImportPolicy(snapshot.data()) : null,
            exists: snapshot.exists(),
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

/** Atomically advances the revision so each run can retain an immutable policy reference. */
export const saveRayenImportPolicy = async ({
  mode,
  updatedByUid,
  runtime = defaultFirestoreServiceRuntime,
}: {
  mode: RayenImportMode;
  updatedByUid: string;
  runtime?: FirestoreServiceRuntimePort;
}): Promise<RayenImportPolicy> => {
  const actorUid = updatedByUid.trim();
  if (!actorUid) throw new Error('Se requiere un administrador autenticado.');
  await ensureFirestoreRuntimeReady(runtime);
  return runTransaction(runtime.getDb(), async transaction => {
    const reference = policyRef(runtime);
    const currentSnapshot = await transaction.get(reference);
    const raw = currentSnapshot.exists() ? currentSnapshot.data() : null;
    const currentRevision =
      raw && Number.isInteger(raw.revision) && Number(raw.revision) >= 1 ? Number(raw.revision) : 0;
    const next: RayenImportPolicy = {
      mode,
      revision: currentRevision + 1,
    };
    transaction.set(reference, {
      schemaVersion: RAYEN_IMPORT_POLICY_SCHEMA_VERSION,
      ...next,
      updatedAt: serverTimestamp(),
      updatedByUid: actorUid,
    });
    return next;
  });
};
