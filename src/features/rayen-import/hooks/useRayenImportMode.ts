import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_RAYEN_IMPORT_POLICY,
  type ClinicalEnrichmentBatchMode,
  type RayenImportMode,
  type RayenImportPolicy,
} from '../settings/rayenImportSettings';
import {
  initializeRayenImportPolicy,
  migrateRayenImportPolicy,
  saveRayenClinicalBatchMode,
  saveRayenImportPolicy,
  subscribeToRayenImportPolicy,
} from '../settings/rayenImportPolicyService';

export type RayenImportPolicyStatus =
  | 'loading'
  | 'ready'
  | 'unconfigured'
  | 'migration-required'
  | 'fallback';

export interface UseRayenImportModeResult {
  policy: RayenImportPolicy;
  mode: RayenImportMode;
  clinicalBatchMode: ClinicalEnrichmentBatchMode;
  status: RayenImportPolicyStatus;
  isSaving: boolean;
  error: string | null;
  initializeSafePolicy: () => Promise<void>;
  migrateLegacyPolicy: () => Promise<void>;
  setMode: (mode: RayenImportMode) => Promise<void>;
  setClinicalBatchMode: (mode: ClinicalEnrichmentBatchMode) => Promise<void>;
}

const safePolicy = (): RayenImportPolicy => ({ ...DEFAULT_RAYEN_IMPORT_POLICY });

/**
 * Reads the hospital-wide policy. Only a server-confirmed document can authorize a new sync run;
 * cache, missing/malformed data and connectivity failures remain visibly non-authoritative.
 */
export const useRayenImportMode = (updatedByUid?: string | null): UseRayenImportModeResult => {
  const [policy, setPolicy] = useState<RayenImportPolicy>(safePolicy);
  const [status, setStatus] = useState<RayenImportPolicyStatus>('loading');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToRayenImportPolicy({
        onSnapshot: snapshot => {
          if (snapshot.fromCache || snapshot.hasPendingWrites) {
            setPolicy(safePolicy());
            setStatus('fallback');
            setError('No se pudo confirmar la política global con el servidor.');
            return;
          }
          if (!snapshot.exists) {
            setPolicy(safePolicy());
            setStatus('unconfigured');
            setError(
              'La política global aún no está configurada. Inicialízala antes de sincronizar.'
            );
            return;
          }
          if (!snapshot.policy) {
            setPolicy(safePolicy());
            setStatus('fallback');
            setError('La política global no es válida; se mantuvo la revisión manual.');
            return;
          }
          if (snapshot.requiresMigration) {
            setPolicy(snapshot.policy);
            setStatus('migration-required');
            setError(
              'La política global usa el contrato anterior. Migra a v2 antes de sincronizar.'
            );
            return;
          }
          setPolicy(snapshot.policy);
          setStatus('ready');
          setError(null);
        },
        onError: () => {
          setPolicy(safePolicy());
          setStatus('fallback');
          setError('No se pudo leer la política global; se mantuvo la revisión manual.');
        },
      }),
    []
  );

  const setMode = useCallback(
    async (mode: RayenImportMode): Promise<void> => {
      if (!updatedByUid || status !== 'ready') {
        throw new Error('La política global aún no está disponible para edición.');
      }
      setIsSaving(true);
      setError(null);
      try {
        await saveRayenImportPolicy({ mode, updatedByUid });
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : 'No se pudo guardar la política global.'
        );
        throw saveError;
      } finally {
        setIsSaving(false);
      }
    },
    [status, updatedByUid]
  );

  const setClinicalBatchMode = useCallback(
    async (clinicalBatchMode: ClinicalEnrichmentBatchMode): Promise<void> => {
      if (!updatedByUid || status !== 'ready') {
        throw new Error('La política global aún no está disponible para edición.');
      }
      setIsSaving(true);
      setError(null);
      try {
        await saveRayenClinicalBatchMode({ clinicalBatchMode, updatedByUid });
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : 'No se pudo guardar la política global.'
        );
        throw saveError;
      } finally {
        setIsSaving(false);
      }
    },
    [status, updatedByUid]
  );

  const initializeSafePolicy = useCallback(async (): Promise<void> => {
    if (!updatedByUid || status !== 'unconfigured') {
      throw new Error('La política global no requiere inicialización.');
    }
    setIsSaving(true);
    setError(null);
    try {
      await initializeRayenImportPolicy({ updatedByUid });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'No se pudo inicializar la política global.'
      );
      throw saveError;
    } finally {
      setIsSaving(false);
    }
  }, [status, updatedByUid]);

  const migrateLegacyPolicy = useCallback(async (): Promise<void> => {
    if (!updatedByUid || status !== 'migration-required') {
      throw new Error('La política global no requiere migración.');
    }
    setIsSaving(true);
    setError(null);
    try {
      await migrateRayenImportPolicy({ updatedByUid });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'No se pudo migrar la política global.'
      );
      throw saveError;
    } finally {
      setIsSaving(false);
    }
  }, [status, updatedByUid]);

  return {
    policy,
    mode: policy.mode,
    clinicalBatchMode: policy.clinicalBatchMode,
    status,
    isSaving,
    error,
    initializeSafePolicy,
    migrateLegacyPolicy,
    setMode,
    setClinicalBatchMode,
  };
};
