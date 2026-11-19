import type { TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';

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
