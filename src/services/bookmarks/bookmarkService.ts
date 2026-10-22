import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Bookmark, BookmarkInput } from '@/types/bookmarks';
import { bookmarkLogger } from '@/services/bookmarks/bookmarkLoggers';
import { COLLECTIONS, HOSPITAL_COLLECTIONS, getActiveHospitalId } from '@/constants/firestorePaths';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import { getTodayISO } from '@/utils/dateCoreUtils';

export interface BookmarkBarPreferences {
  alignment: 'left' | 'center' | 'right' | 'custom';
  customOffset: number;
}

export const createBookmarkService = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => {
  const getBookmarksCollection = () =>
    collection(
      runtime.getDb(),
      COLLECTIONS.HOSPITALS,
      getActiveHospitalId(),
      HOSPITAL_COLLECTIONS.BOOKMARKS
    );

  const getPreferencesDocRef = () =>
    doc(
      runtime.getDb(),
      COLLECTIONS.HOSPITALS,
      getActiveHospitalId(),
      HOSPITAL_COLLECTIONS.BOOKMARKS,
      '_preferences'
    );

  const subscribeToBookmarks = (onUpdate: (bookmarks: Bookmark[]) => void) => {
    const bookmarksQuery = query(getBookmarksCollection(), orderBy('order', 'asc'));

    return onSnapshot(
      bookmarksQuery,
      snapshot => {
        const bookmarks = snapshot.docs.map(
          currentDoc =>
            ({
              id: currentDoc.id,
              ...currentDoc.data(),
            }) as Bookmark
        );
        onUpdate(bookmarks);
      },
      error => {
        bookmarkLogger.error('Error subscribing to bookmarks', error);
      }
    );
  };

  const addBookmark = async (input: BookmarkInput, currentCount: number) => {
    const data = {
      ...input,
      order: currentCount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      return await addDoc(getBookmarksCollection(), data);
    } catch (error) {
      bookmarkLogger.error('Error adding bookmark', error);
      throw error;
    }
  };

  const updateBookmark = async (id: string, updates: Partial<Bookmark>) => {
    const docRef = doc(getBookmarksCollection(), id);
    try {
      return await updateDoc(docRef, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      bookmarkLogger.error('Error updating bookmark', { id, error });
      throw error;
    }
  };

  const deleteBookmark = async (id: string) => {
    const docRef = doc(getBookmarksCollection(), id);
    try {
      return await deleteDoc(docRef);
    } catch (error) {
      bookmarkLogger.error('Error deleting bookmark', { id, error });
      throw error;
    }
  };

  const exportBookmarksToJson = async () => {
    try {
      const bookmarksQuery = query(getBookmarksCollection(), orderBy('order', 'asc'));
      const snapshot = await getDocs(bookmarksQuery);
      const bookmarks = snapshot.docs.map(currentDoc => {
        const data = currentDoc.data();
        return {
          name: data.name,
          url: data.url,
          icon: data.icon,
          notes: data.notes,
          order: data.order,
        };
      });

      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(bookmarks, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', dataStr);
      downloadAnchorNode.setAttribute('download', `marcadores_hospital_${getTodayISO()}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    } catch (error) {
      bookmarkLogger.error('Error exporting bookmarks to JSON', error);
      throw error;
    }
  };

  const importBookmarksFromJson = async (jsonContent: string) => {
    try {
      const items = JSON.parse(jsonContent);
      if (!Array.isArray(items)) throw new Error('Formato inválido');

      const batch = writeBatch(runtime.getDb());
      const colRef = getBookmarksCollection();

      items.forEach(item => {
        const newDocRef = doc(colRef);
        batch.set(newDocRef, {
          name: item.name || 'Sin nombre',
          url: item.url || '#',
          icon: item.icon || '🔗',
          notes: item.notes || '',
          order: item.order ?? 99,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      });

      await batch.commit();
      return true;
    } catch (error) {
      bookmarkLogger.error('Error importing bookmarks', error);
      throw error;
    }
  };

  const reorderBookmarks = async (bookmarks: Bookmark[]) => {
    try {
      const batch = writeBatch(runtime.getDb());
      const colRef = getBookmarksCollection();

      bookmarks.forEach((bookmark, index) => {
        const docRef = doc(colRef, bookmark.id);
        batch.update(docRef, {
          order: index,
          updatedAt: new Date().toISOString(),
        });
      });

      await batch.commit();
      return true;
    } catch (error) {
      bookmarkLogger.error('Error reordering bookmarks', error);
      throw error;
    }
  };

  const subscribeToBookmarkPreferences = (onUpdate: (prefs: BookmarkBarPreferences) => void) => {
    const docRef = getPreferencesDocRef();

    return onSnapshot(
      docRef,
      snapshot => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          onUpdate({
            alignment: data.alignment || 'left',
            customOffset: data.customOffset ?? 50,
          });
        } else {
          onUpdate({ alignment: 'left', customOffset: 50 });
        }
      },
      error => {
        bookmarkLogger.error('Error subscribing to bookmark preferences', error);
        onUpdate({ alignment: 'left', customOffset: 50 });
      }
    );
  };

  const saveBookmarkPreferences = async (prefs: BookmarkBarPreferences) => {
    try {
      const docRef = getPreferencesDocRef();
      const { setDoc } = await import('firebase/firestore');
      await setDoc(
        docRef,
        {
          alignment: prefs.alignment,
          customOffset: prefs.customOffset,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (error) {
      bookmarkLogger.error('Error saving bookmark preferences', error);
      throw error;
    }
  };

  return {
    subscribeToBookmarks,
    addBookmark,
    updateBookmark,
    deleteBookmark,
    exportBookmarksToJson,
    importBookmarksFromJson,
    reorderBookmarks,
    subscribeToBookmarkPreferences,
    saveBookmarkPreferences,
  };
};

const defaultBookmarkService = createBookmarkService();

export const subscribeToBookmarks = defaultBookmarkService.subscribeToBookmarks;
export const addBookmark = defaultBookmarkService.addBookmark;
export const updateBookmark = defaultBookmarkService.updateBookmark;
export const deleteBookmark = defaultBookmarkService.deleteBookmark;
export const exportBookmarksToJson = defaultBookmarkService.exportBookmarksToJson;
export const importBookmarksFromJson = defaultBookmarkService.importBookmarksFromJson;
export const reorderBookmarks = defaultBookmarkService.reorderBookmarks;
export const subscribeToBookmarkPreferences = defaultBookmarkService.subscribeToBookmarkPreferences;
export const saveBookmarkPreferences = defaultBookmarkService.saveBookmarkPreferences;
