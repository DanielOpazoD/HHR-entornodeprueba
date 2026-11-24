import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { Timestamp } from 'firebase/firestore';
import type { StatusChange, TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';
import { isSameTransferOperationalMonth } from '@/shared/transfers/transferOperationalPeriod';

export type TransferFirestoreDoc = Record<string, unknown>;

export const CLOSED_TRANSFER_STATUSES: readonly TransferStatus[] = [
  'TRANSFERRED',
  'CANCELLED',
  'REJECTED',
  'NO_RESPONSE',
] as const;

export const isClosedTransferStatus = (status: TransferStatus): boolean =>
  CLOSED_TRANSFER_STATUSES.includes(status);

export const normalizeLegacyTransferStatus = (
  rawStatus: string | null | undefined
): TransferStatus => {
  if (rawStatus === 'SENT') {
    return 'RECEIVED';
  }
  if (rawStatus === 'ACCEPTED_WITH_BED') {
    return 'ACCEPTED_WITH_CAPACITY';
  }
  if (rawStatus === 'ACCEPTED_WAITING_BED') {
    return 'ACCEPTED_WAITING_CAPACITY';
  }

  return (rawStatus || 'REQUESTED') as TransferStatus;
};

export const normalizeHistoryStatusFrom = (
  rawStatus: string | null | undefined
): TransferStatus | null => {
  if (rawStatus === null || rawStatus === undefined) {
    return null;
  }

  return normalizeLegacyTransferStatus(rawStatus);
};

export const pickLatestOpenTransferRequest = (
  transfers: TransferRequest[]
): TransferRequest | null =>
  [...transfers]
    .filter(transfer => !transfer.archived && !isClosedTransferStatus(transfer.status))
    .sort((a, b) => {
      const aTimestamp = a.updatedAt || a.createdAt || '';
      const bTimestamp = b.updatedAt || b.createdAt || '';
      return bTimestamp.localeCompare(aTimestamp);
    })[0] || null;

const normalizeFirestoreDate = (value: unknown): string => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return String(value || '');
};

const normalizeRequestDate = (value: unknown): string => {
  if (value instanceof Timestamp) {
    return getClinicalCalendarDateISO(value.toDate());
  }

  return String(value || '');
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

export const transferDocToEntity = (
  docData: TransferFirestoreDoc,
  docId: string
): TransferRequest => {
  const status = normalizeLegacyTransferStatus(docData.status as string | undefined);
  const raw = docData as TransferFirestoreDoc & Partial<TransferRequest>;

  return {
    ...raw,
    id: docId,
    patientId: readString(raw.patientId),
    bedId: readString(raw.bedId),
    patientSnapshot: raw.patientSnapshot as TransferRequest['patientSnapshot'],
    destinationHospital: readString(raw.destinationHospital),
    transferReason: readString(raw.transferReason),
    requestingDoctor: readString(raw.requestingDoctor),
    customFields: (raw.customFields as Record<string, string>) || {},
    createdBy: readString(raw.createdBy),
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
