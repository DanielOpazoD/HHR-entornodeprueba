/**
 * Wound Care Storage Service
 *
 * Firebase Storage operations for wound care photos and consent documents.
 */

import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { defaultBackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import type { BackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import {
  resolveBackupStorage,
  createBackupMutationResultFromError,
  type BackupStorageMutationResult,
} from '@/services/backup/backupStorageRuntimeSupport';
import { assertStorageAvailable } from '@/services/backup/storageAvailability';
import { createScopedLogger } from '@/services/utils/loggerScope';

// ============================================================================
// Types
// ============================================================================

interface WoundCareStorageService {
  uploadPhoto: (
    blob: Blob,
    path: string,
    metadata: Record<string, string>
  ) => Promise<BackupStorageMutationResult<string>>;
  uploadConsent: (
    blob: Blob,
    path: string,
    metadata: Record<string, string>
  ) => Promise<BackupStorageMutationResult<string>>;
  uploadThumbnail: (blob: Blob, path: string) => Promise<BackupStorageMutationResult<string>>;
  deleteFile: (storagePath: string) => Promise<BackupStorageMutationResult>;
  getDownloadUrl: (storagePath: string) => Promise<string>;
}

// ============================================================================
// Helpers
// ============================================================================

const resolveContentType = (metadata: Record<string, string>): string =>
  metadata.contentType || 'application/octet-stream';

const woundCareStorageLogger = createScopedLogger('WoundCareStorage');

// ============================================================================
// Factory
// ============================================================================

export const createWoundCareStorageService = (
  runtime: BackupStorageRuntime = defaultBackupStorageRuntime
): WoundCareStorageService => {
  const uploadBlob = async (
    blob: Blob,
    path: string,
    customMetadata: Record<string, string>
  ): Promise<BackupStorageMutationResult<string>> => {
    try {
      const storage = await resolveBackupStorage(runtime);
      assertStorageAvailable(storage, 'WoundCareStorage', 'upload');

      const storageRef = ref(storage, path);
      const user = runtime.auth.currentUser;

      const fullMetadata = {
        contentType: resolveContentType(customMetadata),
        customMetadata: {
          ...customMetadata,
          uploadedBy: user?.email || 'unknown',
          uploadedAt: new Date().toISOString(),
        },
      };

      await uploadBytes(storageRef, blob, fullMetadata);
      const downloadUrl = await getDownloadURL(storageRef);

      return { status: 'success', data: downloadUrl };
    } catch (error) {
      return createBackupMutationResultFromError<string>(error);
    }
  };

  return {
    uploadPhoto: (blob, path, metadata) =>
      uploadBlob(blob, path, { contentType: 'image/webp', ...metadata }),

    uploadConsent: (blob, path, metadata) => uploadBlob(blob, path, metadata),

    uploadThumbnail: (blob, path) => uploadBlob(blob, path, { contentType: 'image/webp' }),

    deleteFile: async storagePath => {
      try {
        const storage = await resolveBackupStorage(runtime);
        assertStorageAvailable(storage, 'WoundCareStorage', 'delete');
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
        return { status: 'success', data: null };
      } catch (error) {
        return createBackupMutationResultFromError(error);
      }
    },

    getDownloadUrl: async storagePath => {
      try {
        const storage = await resolveBackupStorage(runtime);
        assertStorageAvailable(storage, 'WoundCareStorage', 'getDownloadUrl');
        const storageRef = ref(storage, storagePath);
        return await getDownloadURL(storageRef);
      } catch (error) {
        woundCareStorageLogger.error('Error getting download URL', error);
        throw error;
      }
    },
  };
};

export const woundCareStorageService = createWoundCareStorageService();
