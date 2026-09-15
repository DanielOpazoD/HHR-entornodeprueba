/**
 * Catálogo compartido versionado de reglas de especialidad (reglas base +
 * memoria diagnóstica). Vive en `settings/specialtyRulesCatalog` del
 * hospital: lectura para todos los roles clínicos, escritura solo admin
 * (firestore.rules) con incremento transaccional de revisión.
 */
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getSettingsDocPath, SETTINGS_DOCS } from '@/constants/firestorePaths';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  EMPTY_RULE_CATALOG,
  normalizeRuleCatalog,
  type SpecialtyRuleCatalog,
} from '@/domain/specialtyAssignment/ruleCatalog';
import type { SpecialtyRule } from '@/domain/specialtyAssignment/ruleContracts';
import type { SpecialtyRuleCatalogStore } from '@/application/specialtyAssignment/ports';
import { CatalogConflictError } from '@/application/specialtyAssignment/ports';

export interface SpecialtyRuleCatalogSnapshot {
  catalog: SpecialtyRuleCatalog | null;
  exists: boolean;
  droppedRules: number;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface SpecialtyRuleCatalogSubscription {
  onSnapshot: (snapshot: SpecialtyRuleCatalogSnapshot) => void;
  onError: (error: unknown) => void;
}

const catalogRef = (runtime: FirestoreServiceRuntimePort) =>
  doc(runtime.getDb(), getSettingsDocPath(SETTINGS_DOCS.SPECIALTY_RULES_CATALOG));

export const subscribeToSpecialtyRuleCatalog = (
  handlers: SpecialtyRuleCatalogSubscription,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): (() => void) => {
  let active = true;
  let unsubscribe = () => {};
  void ensureFirestoreRuntimeReady(runtime)
    .then(() => {
      if (!active) return;
      unsubscribe = onSnapshot(
        catalogRef(runtime),
        { includeMetadataChanges: true },
        snapshot => {
          const data = snapshot.exists() ? snapshot.data() : null;
          const { catalog, droppedRules } = normalizeRuleCatalog(data);
          handlers.onSnapshot({
            catalog: snapshot.exists() ? catalog : null,
            exists: snapshot.exists(),
            droppedRules,
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

/**
 * Puerto del catálogo sobre Firestore: `publish` corre en transacción y
 * aborta si la revisión remota cambió — concurrencia optimista real.
 */
export const createFirestoreRuleCatalogStore = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): SpecialtyRuleCatalogStore => ({
  read: async () => {
    await ensureFirestoreRuntimeReady(runtime);
    const { getDoc } = await import('firebase/firestore');
    const snapshot = await getDoc(catalogRef(runtime));
    if (!snapshot.exists()) return null;
    return normalizeRuleCatalog(snapshot.data()).catalog;
  },
  publish: async (expectedRevision, build, actorUid) => {
    await ensureFirestoreRuntimeReady(runtime);
    return runTransaction(runtime.getDb(), async transaction => {
      const reference = catalogRef(runtime);
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists()
        ? normalizeRuleCatalog(snapshot.data()).catalog
        : EMPTY_RULE_CATALOG;
      if (current.revision !== expectedRevision) {
        throw new CatalogConflictError(
          `El catálogo de reglas cambió (revisión remota ${current.revision}, esperada ${expectedRevision}). Recarga antes de publicar.`
        );
      }
      const next = build(current);
      if (next.revision !== expectedRevision + 1) {
        throw new CatalogConflictError(
          'La publicación del catálogo debe avanzar la revisión exactamente en uno.'
        );
      }
      transaction.set(reference, {
        schemaVersion: next.schemaVersion,
        revision: next.revision,
        rules: next.rules,
        updatedAt: serverTimestamp(),
        updatedByUid: actorUid,
      });
      return next;
    });
  },
});

/** Serializa una regla para persistencia (Firestore rechaza `undefined`). */
export const serializeRuleForPersistence = (rule: SpecialtyRule): Record<string, unknown> =>
  JSON.parse(JSON.stringify(rule)) as Record<string, unknown>;
