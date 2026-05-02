import { describe, expect, it } from 'vitest';
import {
  collectTransferAvailableYears,
  isTransferVisibleInSelectedPeriod,
  parseTransferDate,
} from '@/features/transfers/components/controllers/transferPeriodSelection';
import type { TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';

const buildTransfer = (overrides: Partial<TransferRequest> = {}): TransferRequest =>
  ({
    id: 'TR-1',
    requestDate: '2026-03-10',
    status: 'REQUESTED',
    statusHistory: [],
    ...overrides,
  }) as TransferRequest;

describe('transferPeriodSelection', () => {
  it('parses dates and resolves period visibility consistently', () => {
    expect(parseTransferDate('2026-03-10')).toBeInstanceOf(Date);
    expect(parseTransferDate('')).toBeNull();

    const selectedPeriodStart = new Date('2026-03-01T00:00:00.000Z');
    const selectedPeriodEnd = new Date('2026-03-31T23:59:59.999Z');
    const closedStatuses = new Set<TransferStatus>(['TRANSFERRED']);

    expect(
      isTransferVisibleInSelectedPeriod({
        transfer: buildTransfer({ requestDate: '2026-02-15', status: 'REQUESTED' }),
        selectedPeriodStart,
        selectedPeriodEnd,
        closedStatuses,
      })
    ).toBe(false);

    expect(
      isTransferVisibleInSelectedPeriod({
        transfer: buildTransfer({ requestDate: '2026-03-15', status: 'REQUESTED' }),
        selectedPeriodStart,
        selectedPeriodEnd,
        closedStatuses,
      })
    ).toBe(true);

    expect(
      isTransferVisibleInSelectedPeriod({
        transfer: buildTransfer({
          requestDate: '2026-01-10',
          status: 'TRANSFERRED',
          statusHistory: [{ timestamp: '2026-03-02T10:00:00.000Z' }] as never,
        }),
        selectedPeriodStart,
        selectedPeriodEnd,
        closedStatuses,
      })
    ).toBe(true);
  });

  it('collects available years from requests and status history', () => {
    const years = collectTransferAvailableYears({
      currentYear: 2026,
      transfers: [
        buildTransfer({ requestDate: '2025-01-10' }),
        buildTransfer({
          requestDate: '2026-01-10',
          statusHistory: [{ timestamp: '2024-12-31T23:59:59.000Z' }] as never,
        }),
      ],
    });

    expect(years).toEqual([2026, 2025, 2024]);
  });
});
