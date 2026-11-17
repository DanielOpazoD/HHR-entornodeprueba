import { doc, getDoc, Timestamp } from 'firebase/firestore';

import type { StatusChange, TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';
import {
  getTransferHistoryCollection,
  getTransfersCollection,
} from '@/services/transfers/transferFirestoreCollections';
import { runWithFirestoreRuntime } from '@/services/storage/firestore/firestoreRuntimeSupport';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

export type CreateTransferRequestData = Omit<
  TransferRequest,
  'id' | 'createdAt' | 'updatedAt' | 'statusHistory'
>;

export const generateTransferId = (): string =>
  `TR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const buildStatusChange = (
  from: TransferStatus | null,
  to: TransferStatus,
  userId: string,
  notes?: string
): StatusChange => ({
  from,
  to,
  timestamp: new Date().toISOString(),
  userId,
  notes,
});

export const buildTransferRequestRecord = (
  data: CreateTransferRequestData,
  id: string
): TransferRequest => {
  const now = new Date().toISOString();

  return {
    ...data,
    id,
    status: 'REQUESTED',
    statusHistory: [buildStatusChange(null, 'REQUESTED', data.createdBy)],
    createdAt: now,
    updatedAt: now,
  };
};

const createTransferDocumentRef = (runtime: FirestoreServiceRuntimePort, id: string) =>
  doc(getTransfersCollection(runtime), id);

export const readTransferRequestOrThrow = async (
  runtime: FirestoreServiceRuntimePort,
  id: string
): Promise<{ docRef: ReturnType<typeof createTransferDocumentRef>; transfer: TransferRequest }> =>
  runWithFirestoreRuntime(runtime, async () => {
    const docRef = createTransferDocumentRef(runtime, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error(`Transfer request ${id} not found`);
    }

    return {
      docRef,
      transfer: docSnap.data() as TransferRequest,
    };
  });

export const buildCompletedTransferRecord = (
  transfer: TransferRequest,
  userId: string
): Omit<TransferRequest, 'updatedAt'> & { updatedAt: ReturnType<typeof Timestamp.now> } => ({
  ...transfer,
  status: 'TRANSFERRED',
  statusHistory: [
    ...(transfer.statusHistory || []),
    buildStatusChange(transfer.status, 'TRANSFERRED', userId),
  ],
  updatedAt: Timestamp.now(),
});

export const createTransferHistoryDocumentRef = (
  runtime: FirestoreServiceRuntimePort,
  id: string
) => doc(getTransferHistoryCollection(runtime), id);
