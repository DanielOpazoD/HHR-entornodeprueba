/**
 * Transfer Service
 * Handles Firestore operations for transfer requests
 */

import {
    collection,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    orderBy,
    onSnapshot,
    Timestamp
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { TransferRequest, TransferStatus, StatusChange } from '../../types/transfers';
import { QuestionnaireResponse } from '../../types/transferDocuments';
import { getActiveHospitalId, COLLECTIONS } from '../../constants/firestorePaths';

// Collection paths
const getTransfersCollection = () => collection(
    db,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    'transferRequests'
);

const getTransferHistoryCollection = () => collection(
    db,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    'transferHistory'
);

/**
 * Generate a unique ID for new transfer requests
 */
const generateTransferId = (): string => {
    return `TR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Convert Firestore document to TransferRequest
 */
const docToTransfer = (docData: Record<string, unknown>, docId: string): TransferRequest => {
    // Normalize status for backward compatibility
    let status = docData.status as TransferStatus;
    if (status === 'RECEIVED' as any) status = 'SENT';

    return {
        ...(docData as unknown as TransferRequest),
        id: docId,
        status,
        statusHistory: (docData.statusHistory as any[])?.map(h => ({
            ...h,
            from: h.from === 'RECEIVED' ? 'SENT' : h.from,
            to: h.to === 'RECEIVED' ? 'SENT' : h.to
        })) || [],
        requestDate: docData.requestDate instanceof Timestamp
            ? docData.requestDate.toDate().toISOString().split('T')[0]
            : (docData.requestDate as string),
        createdAt: docData.createdAt instanceof Timestamp
            ? docData.createdAt.toDate().toISOString()
            : (docData.createdAt as string),
        updatedAt: docData.updatedAt instanceof Timestamp
            ? docData.updatedAt.toDate().toISOString()
            : (docData.updatedAt as string)
    };
};

/**
 * Create a new transfer request
 */
export const createTransferRequest = async (
    data: Omit<TransferRequest, 'id' | 'createdAt' | 'updatedAt' | 'statusHistory'>
): Promise<TransferRequest> => {
    const id = generateTransferId();
    const now = new Date().toISOString();

    const transfer: TransferRequest = {
        ...data,
        id,
        status: 'REQUESTED',
        statusHistory: [{
            from: null,
            to: 'REQUESTED',
            timestamp: now,
            userId: data.createdBy
        }],
        createdAt: now,
        updatedAt: now
    };

    const docRef = doc(getTransfersCollection(), id);
    await setDoc(docRef, {
        ...transfer,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });

    console.log('✅ Transfer request created:', id);
    return transfer;
};

/**
 * Update an existing transfer request
 */
export const updateTransferRequest = async (
    id: string,
    data: Partial<TransferRequest>
): Promise<void> => {
    const docRef = doc(getTransfersCollection(), id);
    await setDoc(docRef, {
        ...data,
        updatedAt: Timestamp.now()
    }, { merge: true });

    console.log('✅ Transfer request updated:', id);
};

/**
 * Change the status of a transfer request
 */
export const changeTransferStatus = async (
    id: string,
    newStatus: TransferStatus,
    userId: string,
    notes?: string
): Promise<void> => {
    const docRef = doc(getTransfersCollection(), id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        throw new Error(`Transfer request ${id} not found`);
    }

    const current = docSnap.data() as TransferRequest;
    const statusChange: StatusChange = {
        from: current.status,
        to: newStatus,
        timestamp: new Date().toISOString(),
        userId,
        notes
    };

    await setDoc(docRef, {
        status: newStatus,
        statusHistory: [...(current.statusHistory || []), statusChange],
        updatedAt: Timestamp.now()
    }, { merge: true });

    console.log(`✅ Transfer ${id} status changed: ${current.status} → ${newStatus}`);
};

/**
 * Mark a transfer as completed and move to history
 */
export const completeTransfer = async (
    id: string,
    userId: string
): Promise<void> => {
    const docRef = doc(getTransfersCollection(), id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        throw new Error(`Transfer request ${id} not found`);
    }

    const transfer = docSnap.data() as TransferRequest;

    // Add final status change
    const statusChange: StatusChange = {
        from: transfer.status,
        to: 'TRANSFERRED',
        timestamp: new Date().toISOString(),
        userId
    };

    const completedTransfer = {
        ...transfer,
        status: 'TRANSFERRED' as TransferStatus,
        statusHistory: [...(transfer.statusHistory || []), statusChange],
        updatedAt: Timestamp.now()
    };

    // Move to history collection
    const historyRef = doc(getTransferHistoryCollection(), id);
    await setDoc(historyRef, completedTransfer);

    // Delete from active collection
    await deleteDoc(docRef);

    console.log(`✅ Transfer ${id} completed and archived`);
};

/**
 * Get all active transfer requests
 */
export const getActiveTransfers = async (): Promise<TransferRequest[]> => {
    const q = query(
        getTransfersCollection(),
        where('status', '!=', 'TRANSFERRED'),
        orderBy('status'),
        orderBy('requestDate', 'desc')
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => docToTransfer(doc.data(), doc.id));
};

/**
 * Subscribe to active transfer requests (real-time)
 * Shows all active transfers + TRANSFERRED/CANCELLED from today
 */
export const subscribeToTransfers = (
    callback: (transfers: TransferRequest[]) => void
): (() => void) => {
    const q = query(
        getTransfersCollection(),
        orderBy('requestDate', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
        const today = new Date().toISOString().split('T')[0];
        const transfers = snapshot.docs
            .map(doc => docToTransfer(doc.data(), doc.id))
            .filter(t => {
                // Always show active transfers
                if (t.status !== 'TRANSFERRED' && t.status !== 'CANCELLED') {
                    return true;
                }
                // Show TRANSFERRED/CANCELLED only if completed today
                const lastChange = t.statusHistory[t.statusHistory.length - 1];
                if (lastChange) {
                    const changeDate = lastChange.timestamp.split('T')[0];
                    return changeDate === today;
                }
                return false;
            });
        callback(transfers);
    }, (error) => {
        console.error('❌ Error subscribing to transfers:', error);
        callback([]);
    });
};

/**
 * Get a single transfer request by ID
 */
export const getTransferById = async (id: string): Promise<TransferRequest | null> => {
    const docRef = doc(getTransfersCollection(), id);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docToTransfer(docSnap.data(), id);
    }
    return null;
};

/**
 * Delete a transfer request (admin only)
 */
export const deleteTransferRequest = async (id: string): Promise<void> => {
    const docRef = doc(getTransfersCollection(), id);
    await deleteDoc(docRef);
    console.log('🗑️ Transfer request deleted:', id);
};

/**
 * Delete a specific status history entry (for correcting mistakes)
 * Never allows deleting the first entry (creation)
 */
export const deleteStatusHistoryEntry = async (
    id: string,
    historyIndex: number
): Promise<void> => {
    const docRef = doc(getTransfersCollection(), id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        throw new Error(`Transfer request ${id} not found`);
    }

    const current = docSnap.data() as TransferRequest;
    const history = current.statusHistory || [];

    // Never delete the first entry
    if (historyIndex === 0 || historyIndex >= history.length) {
        throw new Error('Cannot delete this history entry');
    }

    // Remove the entry and update status to the previous entry's "to" value
    const newHistory = history.filter((_, idx) => idx !== historyIndex);
    const newStatus = newHistory[newHistory.length - 1]?.to || 'REQUESTED';

    await setDoc(docRef, {
        status: newStatus,
        statusHistory: newHistory,
        updatedAt: Timestamp.now()
    }, { merge: true });

    console.log(`✅ Transfer ${id} history entry ${historyIndex} deleted, status reverted to ${newStatus}`);
};
