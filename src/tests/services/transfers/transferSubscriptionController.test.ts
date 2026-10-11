// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildTransferSubscriptionErrorMessage,
  createInitialTransferSubscriptionState,
  mergeSubscribedTransfers,
} from '@/services/transfers/transferSubscriptionController';

describe('transferSubscriptionController', () => {
  it('creates empty initial state', () => {
    expect(createInitialTransferSubscriptionState()).toEqual({
      activeTransfers: [],
      historyTransfers: [],
    });
  });

  it('merges active and history transfers without duplicating ids', () => {
    const merged = mergeSubscribedTransfers({
      activeTransfers: [
        {
          id: 'TR-1',
          requestDate: '2026-03-10',
          updatedAt: '2026-03-10T10:00:00.000Z',
        } as never,
      ],
      historyTransfers: [
        {
          id: 'TR-1',
          requestDate: '2026-03-10',
          updatedAt: '2026-03-10T09:00:00.000Z',
        } as never,
        {
          id: 'TR-2',
          requestDate: '2026-03-09',
          updatedAt: '2026-03-09T09:00:00.000Z',
        } as never,
      ],
    });

    expect(merged.map(transfer => transfer.id)).toEqual(['TR-1', 'TR-2']);
  });

  it('builds readable subscription errors', () => {
    expect(buildTransferSubscriptionErrorMessage('active', new Error('boom'))).toContain(
      'traslados activos'
    );
    expect(buildTransferSubscriptionErrorMessage('history', new Error('boom'))).toContain(
      'historial de traslados'
    );
  });
});
