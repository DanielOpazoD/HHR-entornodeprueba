/**
 * Backup Files Service
 * Handles CRUD operations for backup files in Firestore
 * 
 * Business rules:
 * - Maximum 2 backups per day (1 day shift, 1 night shift)
 * - Re-saving overwrites the existing backup for that day+shift
 */

import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    where,
    limit,
    Timestamp,
    QueryDocumentSnapshot,
    DocumentSnapshot,
    DocumentData
} from 'firebase/firestore';
import { db, auth } from '../../firebaseConfig';
import {
    BackupFile,
    BackupFilePreview,
    BackupFilters,
    BackupFileType
} from '../../types/backup';
import { COLLECTIONS, getActiveHospitalId } from '../../constants/firestorePaths';

// ============= Collection Reference =============

const getBackupCollection = () => collection(
    db,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    'backupFiles'
);

// ============= Helper Functions =============

/**
 * Generate a deterministic ID for a backup based on date and shift
 * This ensures only one backup per day+shift exists
 */
const generateBackupId = (date: string, shiftType: 'day' | 'night'): string => {
    return `${date}_${shiftType}`;
};

/**
 * Get current user info for audit trail
 */
const getCurrentUserInfo = () => {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Usuario no autenticado');
    }
    return {
        uid: user.uid,
        email: user.email || 'unknown',
        name: user.displayName || user.email || 'Usuario'
    };
};

/**
 * Convert Firestore document to BackupFilePreview
 */
const docToPreview = (docSnap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>): BackupFilePreview => {
    const data = docSnap.data();
    if (!data) {
        throw new Error('Document data is undefined');
    }
    return {
        id: docSnap.id,
        type: data.type,
        shiftType: data.shiftType,
        date: data.date,
        title: data.title,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt?.toString(),
        createdBy: data.createdBy,
        metadata: data.metadata
    };
};

/**
 * Convert Firestore document to full BackupFile
 */
const docToBackupFile = (docSnap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>): BackupFile => {
    const data = docSnap.data();
    if (!data) {
        throw new Error('Document data is undefined');
    }
    return {
        ...docToPreview(docSnap),
        content: data.content
    };
};

// ============= CRUD Operations =============

/**
 * Save or update a nursing handoff backup
 * Uses deterministic ID so re-saving overwrites existing backup
 */
export const saveNursingHandoffBackup = async (
    date: string,
    shiftType: 'day' | 'night',
    deliveryStaff: string,
    receivingStaff: string,
    content: Record<string, unknown>
): Promise<string> => {
    const userInfo = getCurrentUserInfo();
    const backupId = generateBackupId(date, shiftType);

    const patientCount = content.beds
        ? Object.values(content.beds as Record<string, any>).filter(b => b?.patientName).length
        : 0;

    const backupData = {
        type: 'NURSING_HANDOFF' as BackupFileType,
        shiftType,
        date,
        title: `Entrega ${shiftType === 'day' ? 'Turno Largo' : 'Turno Noche'} - ${formatDateForTitle(date)}`,
        createdAt: Timestamp.now(),
        createdBy: userInfo,
        metadata: {
            deliveryStaff,
            receivingStaff,
            patientCount,
            shiftType
        },
        content
    };

    const docRef = doc(getBackupCollection(), backupId);
    await setDoc(docRef, backupData);

    // console.info(`✅ Backup saved/updated: ${backupId}`);
    return backupId;
};

/**
 * Check if a backup exists for a given date and shift
 */
export const checkBackupExists = async (date: string, shiftType: 'day' | 'night'): Promise<boolean> => {
    const backupId = generateBackupId(date, shiftType);
    const docRef = doc(getBackupCollection(), backupId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists();
};

/**
 * Get backup for a specific date and shift
 */
export const getBackupByDateShift = async (date: string, shiftType: 'day' | 'night'): Promise<BackupFile | null> => {
    const backupId = generateBackupId(date, shiftType);
    const docRef = doc(getBackupCollection(), backupId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        return null;
    }

    return docToBackupFile(docSnap);
};

/**
 * Get a single backup file by ID (with full content)
 */
export const getBackupFile = async (id: string): Promise<BackupFile | null> => {
    const docRef = doc(getBackupCollection(), id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        return null;
    }

    return docToBackupFile(docSnap);
};

/**
 * List backup files (without content, for performance)
 */
export const listBackupFiles = async (
    filters?: BackupFilters,
    maxResults: number = 100
): Promise<BackupFilePreview[]> => {
    let q = query(
        getBackupCollection(),
        orderBy('date', 'desc'),
        limit(maxResults)
    );

    // Apply filters
    if (filters?.type) {
        q = query(q, where('type', '==', filters.type));
    }
    if (filters?.shiftType) {
        q = query(q, where('shiftType', '==', filters.shiftType));
    }

    const snapshot = await getDocs(q);
    const files = snapshot.docs.map(docToPreview);

    // Client-side search filter (Firestore doesn't support text search)
    if (filters?.searchQuery) {
        const search = filters.searchQuery.toLowerCase();
        return files.filter(f =>
            f.title.toLowerCase().includes(search) ||
            f.metadata.deliveryStaff?.toLowerCase().includes(search) ||
            f.metadata.receivingStaff?.toLowerCase().includes(search) ||
            f.date.includes(search)
        );
    }

    return files;
};

/**
 * Delete a backup file (admin only)
 */
export const deleteBackupFile = async (id: string): Promise<void> => {
    const docRef = doc(getBackupCollection(), id);
    await deleteDoc(docRef);
    // console.info(`🗑️ Backup deleted: ${id}`);
};

// ============= Helpers =============

/**
 * Format date for display in title
 */
const formatDateForTitle = (dateStr: string): string => {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};
