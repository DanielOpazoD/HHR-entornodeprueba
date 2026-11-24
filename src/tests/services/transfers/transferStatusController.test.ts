// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  CLOSED_TRANSFER_STATUSES,
  isClosedTransferStatus,
  normalizeHistoryStatusFrom,
  normalizeLegacyTransferStatus,
  pickLatestOpenTransferRequest,
} from '@/services/transfers/transferSerializationController';
import type { TransferRequest } from '@/types/transferRequestTypes';

const request = (overrides: Partial<TransferRequest>): TransferRequest =>
  ({ id: 'transfer', status: 'REQUESTED', ...overrides }) as TransferRequest;

describe('transferStatusController', () => {
  it('normalizes legacy sent status to received', () => {
    expect(normalizeLegacyTransferStatus('SENT')).toBe('RECEIVED');
    expect(normalizeLegacyTransferStatus(undefined)).toBe('REQUESTED');
  });

  it('exposes closed status helpers consistently', () => {
    expect(CLOSED_TRANSFER_STATUSES).toContain('TRANSFERRED');
    expect(isClosedTransferStatus('CANCELLED')).toBe(true);
    expect(isClosedTransferStatus('REJECTED')).toBe(true);
  });

  it('reads every legacy status as its current name and keeps current ones', () => {
    expect(normalizeLegacyTransferStatus('ACCEPTED_WITH_BED')).toBe('ACCEPTED_WITH_CAPACITY');
    expect(normalizeLegacyTransferStatus('ACCEPTED_WAITING_BED')).toBe('ACCEPTED_WAITING_CAPACITY');
    expect(normalizeLegacyTransferStatus('TRANSFERRED')).toBe('TRANSFERRED');
    expect(normalizeLegacyTransferStatus(null)).toBe('REQUESTED');
    expect(normalizeLegacyTransferStatus('')).toBe('REQUESTED');
  });

  it('keeps a missing previous history status missing instead of inventing one', () => {
    expect(normalizeHistoryStatusFrom(null)).toBeNull();
    expect(normalizeHistoryStatusFrom(undefined)).toBeNull();
    expect(normalizeHistoryStatusFrom('SENT')).toBe('RECEIVED');
    expect(normalizeHistoryStatusFrom('ACCEPTED')).toBe('ACCEPTED');
  });

  it('separates open from closed statuses', () => {
    expect(isClosedTransferStatus('REQUESTED')).toBe(false);
    expect(isClosedTransferStatus('RECEIVED')).toBe(false);
  });

  it('picks the most recently touched open request, never an archived or closed one', () => {
    const transfers = [
      request({ id: 'closed', status: 'TRANSFERRED', updatedAt: '2026-11-17T12:00:00Z' }),
      request({ id: 'archived', archived: true, updatedAt: '2026-11-17T11:00:00Z' }),
      request({ id: 'older', updatedAt: '2026-11-15T10:00:00Z' }),
      request({ id: 'created-only', updatedAt: undefined, createdAt: '2026-11-16T10:00:00Z' }),
      request({ id: 'undated', updatedAt: undefined, createdAt: undefined }),
    ];

    expect(pickLatestOpenTransferRequest(transfers)?.id).toBe('created-only');
    expect(pickLatestOpenTransferRequest(transfers.slice(0, 2))).toBeNull();
    expect(pickLatestOpenTransferRequest([])).toBeNull();
  });
});
