/**
 * Lazy resolver of Firebase Storage download URLs for prescription
 * images. Used by the visor to render thumbnails/full images without
 * baking the storage SDK into UI components.
 */

import { defaultStorageRuntime } from '@/services/firebase-runtime/storageRuntime';
import type { StorageRuntime } from '@/services/firebase-runtime/storageRuntime';

interface PrescriptionStorageImageServiceDeps {
  storageRuntime?: Pick<StorageRuntime, 'getStorage'>;
}

const buildResolver =
  (storageRuntime: Pick<StorageRuntime, 'getStorage'> = defaultStorageRuntime) =>
  async (storagePath: string): Promise<string> => {
    if (!storagePath) {
      throw new Error('La ruta de Storage de la receta está vacía.');
    }
    const [{ ref, getDownloadURL }, storage] = await Promise.all([
      import('firebase/storage'),
      storageRuntime.getStorage(),
    ]);
    return getDownloadURL(ref(storage, storagePath));
  };

export const createPrescriptionStorageImageService = (
  deps: PrescriptionStorageImageServiceDeps = {}
) => ({
  resolveDownloadUrl: buildResolver(deps.storageRuntime),
});

export const resolvePrescriptionImageDownloadUrl =
  createPrescriptionStorageImageService().resolveDownloadUrl;
