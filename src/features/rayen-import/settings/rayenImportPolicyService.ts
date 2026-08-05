import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  RAYEN_IMPORT_POLICY_SCHEMA_VERSION,
  DEFAULT_RAYEN_IMPORT_POLICY,
  normalizeRayenImportPolicy,
  type ClinicalEnrichmentBatchMode,
  type RayenImportMode,
  type RayenImportPolicy,
} from './rayenImportSettings';

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

/** Atomically advances the revision so each run can retain an immutable policy reference. */
const saveRayenPolicyUpdate = async ({
  update,
  updatedByUid,
  expectedSchemaVersion,
  runtime = defaultFirestoreServiceRuntime,
}: {
  update: Partial<Pick<RayenImportPolicy, 'mode' | 'clinicalBatchMode'>>;
  updatedByUid: string;
  expectedSchemaVersion?: number;
  runtime?: FirestoreServiceRuntimePort;
}): Promise<RayenImportPolicy> => {
  const actorUid = updatedByUid.trim();
  if (!actorUid) throw new Error('Se requiere un administrador autenticado.');
  await ensureFirestoreRuntimeReady(runtime);
  return runTransaction(runtime.getDb(), async transaction => {
    const reference = policyRef(runtime);
    const currentSnapshot = await transaction.get(reference);
    const raw = currentSnapshot.exists() ? currentSnapshot.data() : null;
    if (expectedSchemaVersion !== undefined && raw?.schemaVersion !== expectedSchemaVersion) {
      throw new Error('La política global cambió. Recarga antes de migrarla.');
    }
    const current = normalizeRayenImportPolicy(raw) ?? DEFAULT_RAYEN_IMPORT_POLICY;
    const currentRevision =
      raw && Number.isInteger(raw.revision) && Number(raw.revision) >= 1 ? Number(raw.revision) : 0;
    const next: RayenImportPolicy = {
      mode: update.mode ?? current.mode,
      clinicalBatchMode: update.clinicalBatchMode ?? current.clinicalBatchMode,
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

export const saveRayenImportPolicy = async ({
  mode,
  updatedByUid,
  runtime,
}: {
  mode: RayenImportMode;
  updatedByUid: string;
  runtime?: FirestoreServiceRuntimePort;
}): Promise<RayenImportPolicy> =>
  saveRayenPolicyUpdate({ update: { mode }, updatedByUid, runtime });

export const saveRayenClinicalBatchMode = async ({
  clinicalBatchMode,
  updatedByUid,
  runtime,
}: {
  clinicalBatchMode: ClinicalEnrichmentBatchMode;
  updatedByUid: string;
  runtime?: FirestoreServiceRuntimePort;
}): Promise<RayenImportPolicy> =>
  saveRayenPolicyUpdate({ update: { clinicalBatchMode }, updatedByUid, runtime });

/** Atomically preserves the structural mode while converting a confirmed v1 policy to v2/off. */
export const migrateRayenImportPolicy = async ({
  updatedByUid,
  runtime,
}: {
  updatedByUid: string;
  runtime?: FirestoreServiceRuntimePort;
}): Promise<RayenImportPolicy> =>
  saveRayenPolicyUpdate({ update: {}, updatedByUid, expectedSchemaVersion: 1, runtime });

/** Creates the global policy only with the safe rollout defaults. */
export const initializeRayenImportPolicy = async ({
  updatedByUid,
  runtime = defaultFirestoreServiceRuntime,
}: {
  updatedByUid: string;
  runtime?: FirestoreServiceRuntimePort;
}): Promise<RayenImportPolicy> => {
  const actorUid = updatedByUid.trim();
  if (!actorUid) throw new Error('Se requiere un administrador autenticado.');
  await ensureFirestoreRuntimeReady(runtime);
  return runTransaction(runtime.getDb(), async transaction => {
    const reference = policyRef(runtime);
    const currentSnapshot = await transaction.get(reference);
    if (currentSnapshot.exists()) {
      throw new Error('La política global ya fue configurada. Recarga antes de editarla.');
    }
    const initialPolicy: RayenImportPolicy = {
      ...DEFAULT_RAYEN_IMPORT_POLICY,
      revision: 1,
    };
    transaction.set(reference, {
      schemaVersion: RAYEN_IMPORT_POLICY_SCHEMA_VERSION,
      ...initialPolicy,
      updatedAt: serverTimestamp(),
      updatedByUid: actorUid,
    });
    return initialPolicy;
  });
};
