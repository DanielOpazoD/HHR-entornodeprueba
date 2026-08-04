import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_RAYEN_IMPORT_POLICY,
  type RayenImportMode,
  type RayenImportPolicy,
} from '../settings/rayenImportSettings';
import {
  saveRayenImportPolicy,
  subscribeToRayenImportPolicy,
} from '../settings/rayenImportPolicyService';

export type RayenImportPolicyStatus = 'loading' | 'ready' | 'fallback';

export interface UseRayenImportModeResult {
  policy: RayenImportPolicy;
  mode: RayenImportMode;
  status: RayenImportPolicyStatus;
  isSaving: boolean;
  error: string | null;
  setMode: (mode: RayenImportMode) => Promise<void>;
}

const safePolicy = (): RayenImportPolicy => ({ ...DEFAULT_RAYEN_IMPORT_POLICY });

/**
 * Reads the hospital-wide policy. Only a server-confirmed document can activate `auto`;
 * cache, malformed data and connectivity failures all fail closed to `preview`.
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
            setStatus('ready');
            setError(null);
            return;
          }
          if (!snapshot.policy) {
            setPolicy(safePolicy());
            setStatus('fallback');
            setError('La política global no es válida; se mantuvo la revisión manual.');
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

  return { policy, mode: policy.mode, status, isSaving, error, setMode };
};
