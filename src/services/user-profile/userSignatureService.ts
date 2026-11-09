import type { FirebaseStorage } from 'firebase/storage';
import { defaultStorageRuntime } from '@/services/firebase-runtime/storageRuntime';

/**
 * The signature image each person prints on their own requests. Only its owner may read it
 * (storage.rules), so it is read with the signed-in SDK as a blob: a download URL would be a
 * bearer link anyone holding it could open. Nothing is cached in the browser: the computer is
 * shared, and the next person must never see it.
 */
export const USER_SIGNATURE_MAX_BYTES = 500 * 1024;
export const USER_SIGNATURE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const buildUserSignatureStoragePath = (uid: string): string =>
  `user-signatures/${uid}/signature`;

/** Why the file cannot be the signature, in words for the user; null when it can. */
export const describeUserSignatureFileProblem = (file: Pick<File, 'type' | 'size'>) => {
  if (!(USER_SIGNATURE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return 'La firma debe ser una imagen PNG, JPG o WEBP.';
  }
  if (file.size > USER_SIGNATURE_MAX_BYTES) {
    return 'La imagen de la firma supera el límite de 500 KB.';
  }
  return null;
};

type SignatureStorageModule = Pick<
  typeof import('firebase/storage'),
  'deleteObject' | 'getBlob' | 'ref' | 'uploadBytes'
>;

export interface UserSignatureStorageRuntime {
  getStorage: () => Promise<FirebaseStorage>;
  loadStorageModule: () => Promise<SignatureStorageModule>;
}

const defaultSignatureStorageRuntime: UserSignatureStorageRuntime = {
  getStorage: defaultStorageRuntime.getStorage,
  loadStorageModule: () => import('firebase/storage'),
};

const isObjectNotFound = (error: unknown): boolean =>
  String((error as { code?: string })?.code || '').includes('object-not-found');

export const createUserSignatureService = (
  runtime: UserSignatureStorageRuntime = defaultSignatureStorageRuntime
) => {
  const signatureRef = async (uid: string) => {
    if (!uid) throw new Error('No se pudo identificar al usuario actual.');
    const [storage, storageModule] = await Promise.all([
      runtime.getStorage(),
      runtime.loadStorageModule(),
    ]);
    return { storageModule, ref: storageModule.ref(storage, buildUserSignatureStoragePath(uid)) };
  };

  return {
    /** The owner's signature, or null when they have none. A failed read throws. */
    async load(uid: string): Promise<Blob | null> {
      const { storageModule, ref } = await signatureRef(uid);
      try {
        return await storageModule.getBlob(ref);
      } catch (error) {
        if (isObjectNotFound(error)) return null;
        throw error;
      }
    },

    async save(uid: string, file: File): Promise<void> {
      const problem = describeUserSignatureFileProblem(file);
      if (problem) throw new Error(problem);
      const { storageModule, ref } = await signatureRef(uid);
      await storageModule.uploadBytes(ref, file, {
        contentType: file.type,
        // Keeps the image out of the shared computer's HTTP cache.
        cacheControl: 'private, no-store',
      });
    },

    async remove(uid: string): Promise<void> {
      const { storageModule, ref } = await signatureRef(uid);
      try {
        await storageModule.deleteObject(ref);
      } catch (error) {
        if (!isObjectNotFound(error)) throw error;
      }
    },
  };
};

export type UserSignatureService = ReturnType<typeof createUserSignatureService>;

export const userSignatureService = createUserSignatureService();
