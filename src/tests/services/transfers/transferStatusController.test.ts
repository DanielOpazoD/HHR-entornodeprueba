// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TRANSFER_STATUSES,
  CLOSED_TRANSFER_STATUSES,
  isActiveTransferStatus,
  isClosedTransferStatus,
  isFinalizedTransferStatus,
  isTransferredTransferStatus,
  normalizeLegacyTransferStatus,
} from '@/services/transfers/transferStatusController';

describe('transferStatusController', () => {
  it('normalizes legacy sent status to received', () => {
    expect(normalizeLegacyTransferStatus('SENT')).toBe('RECEIVED');
    expect(normalizeLegacyTransferStatus(undefined)).toBe('REQUESTED');
  });

  it('exposes active and closed status helpers consistently', () => {
    expect(ACTIVE_TRANSFER_STATUSES).toContain('REQUESTED');
    expect(ACTIVE_TRANSFER_STATUSES).toContain('ACCEPTED_WITH_CAPACITY');
    expect(ACTIVE_TRANSFER_STATUSES).toContain('ACCEPTED_WAITING_CAPACITY');
    expect(CLOSED_TRANSFER_STATUSES).toContain('TRANSFERRED');
    expect(isActiveTransferStatus('ACCEPTED')).toBe(true);
    expect(isActiveTransferStatus('ACCEPTED_WITH_CAPACITY')).toBe(true);
    expect(isClosedTransferStatus('CANCELLED')).toBe(true);
    expect(isFinalizedTransferStatus('REJECTED')).toBe(true);
    expect(isTransferredTransferStatus('TRANSFERRED')).toBe(true);
  });
});
