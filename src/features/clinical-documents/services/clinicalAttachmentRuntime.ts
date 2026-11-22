import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';

import {
  defaultFirebaseConfigRuntimeAdapter,
  type FirebaseConfigRuntimeAdapter,
} from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

export interface ClinicalAttachmentStorageRuntime {
  getStorage: () => Promise<FirebaseStorage>;
  ref: typeof ref;
  uploadBytes: typeof uploadBytes;
  getDownloadURL: typeof getDownloadURL;
  deleteObject: typeof deleteObject;
  listAll: typeof listAll;
}

export const createClinicalAttachmentStorageRuntime = (
  adapter: FirebaseConfigRuntimeAdapter = defaultFirebaseConfigRuntimeAdapter
): ClinicalAttachmentStorageRuntime => ({
  getStorage: () => adapter.getStorage(),
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
});

export const defaultClinicalAttachmentStorageRuntime = createClinicalAttachmentStorageRuntime();
