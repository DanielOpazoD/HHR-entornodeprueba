import { Timestamp } from 'firebase/firestore';
import type { StatusChange, TransferRequest } from '@/types/transferRequestTypes';
import {
  normalizeHistoryStatusFrom,
  normalizeLegacyTransferStatus,
  pickLatestOpenTransferRequest,
} from '@/services/transfers/transferStatusController';
import { isSameTransferOperationalMonth } from '@/shared/transfers/transferOperationalPeriod';

export type TransferFirestoreDoc = Record<string, unknown>;

const normalizeFirestoreDate = (value: unknown): string => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return String(value || '');
};

const normalizeRequestDate = (value: unknown): string => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString().split('T')[0];
  }

  return String(value || '');
};

export const transferDocToEntity = (
  docData: TransferFirestoreDoc,
  docId: string
): TransferRequest => {
  const status = normalizeLegacyTransferStatus(docData.status as string | undefined);

  return {
    ...(docData as unknown as TransferRequest),
    id: docId,
    status,
    statusHistory: ((docData.statusHistory as StatusChange[]) || []).map(history => ({
      ...history,
      from: normalizeHistoryStatusFrom(history.from as string | null | undefined),
      to: normalizeLegacyTransferStatus(history.to as string | undefined),
    })),
    requestDate: normalizeRequestDate(docData.requestDate),
    createdAt: normalizeFirestoreDate(docData.createdAt),
    updatedAt: normalizeFirestoreDate(docData.updatedAt),
  };
};

export const querySnapshotToTransfers = (querySnapshot: {
  docs: Array<{ id: string; data: () => TransferFirestoreDoc }>;
}): TransferRequest[] =>
  querySnapshot.docs.map(snapshot => transferDocToEntity(snapshot.data(), snapshot.id));

export const pickLatestOpenTransferFromSnapshot = (querySnapshot: {
  docs: Array<{ id: string; data: () => TransferFirestoreDoc }>;
}): TransferRequest | null =>
  pickLatestOpenTransferRequest(querySnapshotToTransfers(querySnapshot));

export const pickLatestOpenTransferFromSnapshotForMonth = (
  querySnapshot: { docs: Array<{ id: string; data: () => TransferFirestoreDoc }> },
  referenceDate: string
): TransferRequest | null =>
  pickLatestOpenTransferRequest(
    querySnapshotToTransfers(querySnapshot).filter(transfer =>
      isSameTransferOperationalMonth(transfer.requestDate, referenceDate)
    )
  );
