import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp,
    getDocs,
    writeBatch
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { Bookmark, BookmarkInput } from '@/types/bookmarks';
import {
    COLLECTIONS,
    HOSPITAL_COLLECTIONS,
    getActiveHospitalId
} from '@/constants/firestorePaths';

const getBookmarksCollection = () => collection(
    db,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.BOOKMARKS
);

/**
 * Subscribe to bookmarks list in real-time
 */
export const subscribeToBookmarks = (onUpdate: (bookmarks: Bookmark[]) => void) => {
    const q = query(getBookmarksCollection(), orderBy('order', 'asc'));

    return onSnapshot(q, (snapshot) => {
        const bookmarks = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Bookmark));
        onUpdate(bookmarks);
    }, (error) => {
        console.error('Error subscribing to bookmarks:', error);
    });
};

/**
 * Add a new bookmark
 */
export const addBookmark = async (input: BookmarkInput, currentCount: number) => {
    const data = {
        ...input,
        order: currentCount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return await addDoc(getBookmarksCollection(), data);
};

/**
 * Update an existing bookmark
 */
export const updateBookmark = async (id: string, updates: Partial<Bookmark>) => {
    const docRef = doc(getBookmarksCollection(), id);
    return await updateDoc(docRef, {
        ...updates,
        updatedAt: new Date().toISOString()
    });
};

/**
 * Delete a bookmark
 */
export const deleteBookmark = async (id: string) => {
    const docRef = doc(getBookmarksCollection(), id);
    return await deleteDoc(docRef);
};

/**
 * Export all bookmarks as JSON
 */
export const exportBookmarksToJson = async () => {
    const q = query(getBookmarksCollection(), orderBy('order', 'asc'));
    const snapshot = await getDocs(q);
    const bookmarks = snapshot.docs.map(doc => {
        const data = doc.data();
        // Remove internal IDs for a clean export
        return {
            name: data.name,
            url: data.url,
            icon: data.icon,
            notes: data.notes,
            order: data.order
        };
    });

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bookmarks, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `marcadores_hospital_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
};

/**
 * Import bookmarks from JSON
 */
export const importBookmarksFromJson = async (jsonContent: string) => {
    try {
        const items = JSON.parse(jsonContent);
        if (!Array.isArray(items)) throw new Error('Formato inválido');

        const batch = writeBatch(db);
        const colRef = getBookmarksCollection();

        // Note: This adds to existing ones. If we want to replace, we should delete first.
        items.forEach((item, index) => {
            const newDocRef = doc(colRef);
            batch.set(newDocRef, {
                name: item.name || 'Sin nombre',
                url: item.url || '#',
                icon: item.icon || '🔗',
                notes: item.notes || '',
                order: item.order ?? 99,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        });

        await batch.commit();
        return true;
    } catch (error) {
        console.error('Error importing bookmarks:', error);
        throw error;
    }
};

/**
 * Reorder multiple bookmarks in a single transaction
 */
export const reorderBookmarks = async (bookmarks: Bookmark[]) => {
    try {
        const batch = writeBatch(db);
        const colRef = getBookmarksCollection();

        bookmarks.forEach((bookmark, index) => {
            const docRef = doc(colRef, bookmark.id);
            batch.update(docRef, {
                order: index,
                updatedAt: new Date().toISOString()
            });
        });

        await batch.commit();
        return true;
    } catch (error) {
        console.error('Error reordering bookmarks:', error);
        throw error;
    }
};

// ============================================================================
// Bookmark Bar Preferences (saved per hospital)
// ============================================================================

export interface BookmarkBarPreferences {
    alignment: 'left' | 'center' | 'right' | 'custom';
    customOffset: number;
}

const getPreferencesDocRef = () => doc(
    db,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.BOOKMARKS,
    '_preferences'
);

/**
 * Subscribe to bookmark bar preferences in real-time
 */
export const subscribeToBookmarkPreferences = (
    onUpdate: (prefs: BookmarkBarPreferences) => void
) => {
    const docRef = getPreferencesDocRef();

    return onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            onUpdate({
                alignment: data.alignment || 'left',
                customOffset: data.customOffset ?? 50
            });
        } else {
            // Default preferences
            onUpdate({ alignment: 'left', customOffset: 50 });
        }
    }, (error) => {
        console.error('Error subscribing to bookmark preferences:', error);
        // Fallback to defaults on error
        onUpdate({ alignment: 'left', customOffset: 50 });
    });
};

/**
 * Save bookmark bar preferences to Firestore
 */
export const saveBookmarkPreferences = async (prefs: BookmarkBarPreferences) => {
    try {
        const docRef = getPreferencesDocRef();
        const { setDoc } = await import('firebase/firestore');
        await setDoc(docRef, {
            alignment: prefs.alignment,
            customOffset: prefs.customOffset,
            updatedAt: new Date().toISOString()
        }, { merge: true });
    } catch (error) {
        console.error('Error saving bookmark preferences:', error);
        throw error;
    }
};
