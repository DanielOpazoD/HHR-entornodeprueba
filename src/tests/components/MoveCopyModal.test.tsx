import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MoveCopyModal } from '@/components/modals/actions/MoveCopyModal';
import type { DailyRecord } from '@/types';
import { DataFactory } from '@/tests/factories/DataFactory';

const mockedUseDailyRecordContext = vi.fn();
const mockedGetForDate = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordContext: () => mockedUseDailyRecordContext(),
}));

vi.mock('@/services/repositories/DailyRecordRepository', () => ({
  DailyRecordRepository: {
    getForDate: (...args: unknown[]) => mockedGetForDate(...args),
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>(res => {
    resolve = res;
  });

  if (!resolve) {
    throw new Error('Deferred resolver was not initialized');
  }

  return { promise, resolve };
};

describe('MoveCopyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseDailyRecordContext.mockReturnValue({
      record: {
        date: '2026-02-13',
        activeExtraBeds: [],
        beds: {},
      },
    });
    mockedGetForDate.mockResolvedValue(null);
  });

  it('resolves ayer/hoy/manana against the current record date', async () => {
    render(
      <MoveCopyModal
        isOpen={true}
        type="copy"
        sourceBedId="R1"
        targetBedId={null}
        onClose={vi.fn()}
        onSetTarget={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Mañana/i }));

    await waitFor(() => {
      expect(mockedGetForDate).toHaveBeenCalledWith('2026-02-14');
    });
  });

  it('ignores stale async availability responses when user changes date quickly', async () => {
    const firstRequest = createDeferred<DailyRecord | null>();
    const secondRequest = createDeferred<DailyRecord | null>();
    const occupiedTargetRecord = DataFactory.createMockDailyRecord('2026-02-14');
    occupiedTargetRecord.beds.R2 = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente R2',
    });
    const staleTargetRecord = DataFactory.createMockDailyRecord('2026-02-12');

    mockedGetForDate
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    render(
      <MoveCopyModal
        isOpen={true}
        type="copy"
        sourceBedId="R1"
        targetBedId={null}
        onClose={vi.fn()}
        onSetTarget={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Ayer/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mañana/i }));

    // Resolve latest request first with occupied R2
    secondRequest.resolve(occupiedTargetRecord);

    await waitFor(() => {
      expect(screen.getByText('Ocupada')).toBeInTheDocument();
    });

    // Resolve stale request after latest; UI should keep latest occupancy
    firstRequest.resolve(staleTargetRecord);

    await waitFor(() => {
      expect(screen.getByText('Ocupada')).toBeInTheDocument();
    });
  });
});
