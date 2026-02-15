import { doc, getDoc } from 'firebase/firestore';

import { getLegacyDb } from './legacyFirebaseCore';
import { LEGACY_NURSES_DOC_PATHS, LEGACY_TENS_DOC_PATHS } from './legacyFirebasePaths';

const getCatalogFromPaths = async (paths: string[]): Promise<string[]> => {
  const db = getLegacyDb();
  if (!db) return [];

  for (const path of paths) {
    try {
      const docRef = doc(db, path);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) continue;
      const data = docSnap.data();
      const list = (data.list as string[]) || [];
      if (list.length > 0) {
        return list;
      }
    } catch {
      // Continue with next candidate path.
    }
  }

  return [];
};

export const getLegacyNurseCatalog = async (): Promise<string[]> =>
  getCatalogFromPaths(LEGACY_NURSES_DOC_PATHS);

export const getLegacyTensCatalog = async (): Promise<string[]> =>
  getCatalogFromPaths(LEGACY_TENS_DOC_PATHS);
