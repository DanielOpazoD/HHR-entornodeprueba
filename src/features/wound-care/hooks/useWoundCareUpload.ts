/**
 * Hook: Orchestrate wound care photo and consent uploads.
 *
 * Provides a unified interface for the UI to upload photos and consent
 * documents, handling authentication checks, file validation, progress
 * tracking, and error reporting.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import type {
  WoundCareAuditActor,
  WoundCareConsent,
  WoundCarePhoto,
} from '@/types/domain/woundCare';
import type { EpisodeContext } from '@/features/wound-care/use-cases/woundCareUseCases';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import {
  executeUploadWoundCareConsent,
  executeUploadWoundCarePhoto,
  executeDeleteWoundCarePhoto,
} from '@/features/wound-care/use-cases/woundCareUseCases';
import {
  validatePhotoForUpload,
  validateConsentForUpload,
  type UploadProgress,
} from '../controllers/photoUploadController';

interface UseWoundCareUploadReturn {
  uploadPhoto: (
    file: File,
    episodeContext: EpisodeContext,
    options?: { description?: string; bodyLocation?: string; takenAt?: string }
  ) => Promise<{ success: boolean; data?: WoundCarePhoto | null; error?: string }>;
  uploadConsent: (
    file: File,
    episodeContext: EpisodeContext
  ) => Promise<{ success: boolean; data?: WoundCareConsent | null; error?: string }>;
  deletePhoto: (
    photoId: string,
    storagePath: string,
    thumbnailStoragePath: string
  ) => Promise<{ success: boolean; error?: string }>;
  cancelPendingRetries: () => void;
  progress: UploadProgress | null;
  isUploading: boolean;
}

const buildActor = (
  user: { uid: string; email: string | null; displayName: string | null },
  role: string
): WoundCareAuditActor => ({
  uid: user.uid,
  email: user.email || 'sin-email',
  displayName: user.displayName || 'Sin nombre',
  role,
});

/**
 * Orchestrates wound care photo and consent upload operations.
 *
 * Handles file validation, progress tracking, and error reporting.
 * Requires an authenticated user; all operations return a
 * `{ success, error? }` result for the caller to act on.
 *
 * @returns uploadPhoto   - Validates, compresses, and uploads a wound care photo.
 * @returns uploadConsent - Validates and uploads a signed consent document.
 * @returns deletePhoto   - Soft-deletes a photo with best-effort storage cleanup.
 * @returns progress      - Current upload stage for UI feedback (`null` when idle).
 * @returns isUploading   - Whether an upload operation is in progress.
 */
export const useWoundCareUpload = (): UseWoundCareUploadReturn => {
  const { currentUser, role } = useAuth();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const isMountedRef = useRef(true);
  const retryGenerationRef = useRef(0);
  const pendingRetryCleanupRef = useRef<(() => void) | null>(null);

  const cancelPendingRetries = useCallback(() => {
    retryGenerationRef.current += 1;
    pendingRetryCleanupRef.current?.();
    pendingRetryCleanupRef.current = null;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelPendingRetries();
    };
  }, [cancelPendingRetries]);

  const waitForRetryDelay = useCallback(
    (delayMs: number, generation: number): Promise<boolean> =>
      new Promise(resolve => {
        if (!isMountedRef.current || retryGenerationRef.current !== generation) {
          resolve(false);
          return;
        }
        let settled = false;
        const finish = (shouldContinue: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (pendingRetryCleanupRef.current === abort) {
            pendingRetryCleanupRef.current = null;
          }
          resolve(shouldContinue);
        };
        const abort = () => finish(false);
        const timer = setTimeout(() => {
          finish(isMountedRef.current && retryGenerationRef.current === generation);
        }, delayMs);
        pendingRetryCleanupRef.current = abort;
      }),
    []
  );

  /**
   * Retry wrapper for upload operations.
   * Re-runs `fn` up to `maxRetries` times when the failure is retryable
   * (i.e. not a validation error). Shows retry progress to the user.
   */
  const executeWithRetry = useCallback(
    async <T>(
      fn: () => Promise<ApplicationOutcome<T>>,
      maxRetries: number = 1
    ): Promise<ApplicationOutcome<T>> => {
      const generation = retryGenerationRef.current;
      let lastResult = await fn();
      let attempts = 0;

      while (lastResult.status === 'failed' && attempts < maxRetries) {
        if (!isMountedRef.current || retryGenerationRef.current !== generation) break;
        const isRetryable = lastResult.issues.some(i => i.kind !== 'validation');
        if (!isRetryable) break;

        attempts++;
        setProgress({
          stage: 'uploading',
          message: `Reintentando... (${attempts}/${maxRetries})`,
        });

        // Small delay before retry — aborted if the caller cancels or unmounts.
        const shouldContinue = await waitForRetryDelay(1500, generation);
        if (!shouldContinue || !isMountedRef.current || retryGenerationRef.current !== generation) {
          break;
        }
        lastResult = await fn();
      }

      return lastResult;
    },
    [waitForRetryDelay]
  );

  const uploadPhoto = useCallback(
    async (
      file: File,
      episodeContext: EpisodeContext,
      options?: { description?: string; bodyLocation?: string; takenAt?: string }
    ): Promise<{ success: boolean; data?: WoundCarePhoto | null; error?: string }> => {
      if (!currentUser) {
        return { success: false, error: 'Debe iniciar sesión para subir fotos.' };
      }

      const validation = validatePhotoForUpload(file);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      setIsUploading(true);
      setProgress({ stage: 'uploading', message: 'Comprimiendo y subiendo...' });

      try {
        const result = await executeWithRetry(() =>
          executeUploadWoundCarePhoto({
            file,
            episodeContext,
            description: options?.description,
            bodyLocation: options?.bodyLocation,
            takenAt: options?.takenAt,
            actor: buildActor(currentUser, role),
            hospitalId: getActiveHospitalId(),
          })
        );

        if (result.status === 'success') {
          setProgress({ stage: 'done', message: 'Fotografía guardada correctamente.' });
          return { success: true, data: result.data };
        }

        const errorMsg =
          result.issues[0]?.userSafeMessage ||
          result.issues[0]?.message ||
          'Error al subir la fotografía.';
        setProgress({ stage: 'error', message: errorMsg });
        return { success: false, error: errorMsg };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error inesperado.';
        setProgress({ stage: 'error', message: msg });
        return { success: false, error: msg };
      } finally {
        setIsUploading(false);
      }
    },
    [currentUser, role, executeWithRetry]
  );

  const uploadConsent = useCallback(
    async (
      file: File,
      episodeContext: EpisodeContext
    ): Promise<{ success: boolean; data?: WoundCareConsent | null; error?: string }> => {
      if (!currentUser) {
        return { success: false, error: 'Debe iniciar sesión para subir el consentimiento.' };
      }

      const validation = validateConsentForUpload(file);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      setIsUploading(true);
      setProgress({ stage: 'uploading', message: 'Subiendo consentimiento...' });

      try {
        const result = await executeWithRetry(() =>
          executeUploadWoundCareConsent({
            file,
            episodeContext,
            actor: buildActor(currentUser, role),
            hospitalId: getActiveHospitalId(),
          })
        );

        if (result.status === 'success') {
          setProgress({ stage: 'done', message: 'Consentimiento guardado correctamente.' });
          return { success: true, data: result.data };
        }

        const errorMsg =
          result.issues[0]?.userSafeMessage ||
          result.issues[0]?.message ||
          'Error al subir el consentimiento.';
        setProgress({ stage: 'error', message: errorMsg });
        return { success: false, error: errorMsg };
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error inesperado.';
        setProgress({ stage: 'error', message: msg });
        return { success: false, error: msg };
      } finally {
        setIsUploading(false);
      }
    },
    [currentUser, role, executeWithRetry]
  );

  const deletePhoto = useCallback(
    async (
      photoId: string,
      storagePath: string,
      thumbnailStoragePath: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!currentUser) {
        return { success: false, error: 'Debe iniciar sesión.' };
      }

      try {
        const result = await executeDeleteWoundCarePhoto(
          photoId,
          storagePath,
          thumbnailStoragePath,
          buildActor(currentUser, role)
        );

        if (result.status === 'success') {
          return { success: true };
        }

        return {
          success: false,
          error:
            result.issues[0]?.userSafeMessage ||
            result.issues[0]?.message ||
            'Error al eliminar la fotografía.',
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Error inesperado.',
        };
      }
    },
    [currentUser, role]
  );

  return {
    uploadPhoto,
    uploadConsent,
    deletePhoto,
    cancelPendingRetries,
    progress,
    isUploading,
  };
};
