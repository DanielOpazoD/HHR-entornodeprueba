import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MoveCopyModal } from '@/components/modals/actions/MoveCopyModal';

const mockedUseDailyRecordContext = vi.fn();
const mockedGetForDate = vi.fn();
const mockedNotifyError = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordContext: () => mockedUseDailyRecordContext(),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    error: mockedNotifyError,
  }),
}));

vi.mock('@/services/RepositoryContext', () => ({
  useRepositories: () => ({
    dailyRecord: {
      getForDate: (...args: unknown[]) => mockedGetForDate(...args),
    },
  }),
}));

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

  it('notifies when target availability fetch fails', async () => {
    mockedGetForDate.mockRejectedValue(new Error('fetch failed'));

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
      expect(mockedNotifyError).toHaveBeenCalledWith(
        'No se pudo cargar disponibilidad',
        expect.stringContaining('fetch failed')
      );
    });
  });

  it('does not reset target bed when selecting the same date option', async () => {
    const onSetTarget = vi.fn();

    render(
      <MoveCopyModal
        isOpen={true}
        type="copy"
        sourceBedId="R1"
        targetBedId={null}
        onClose={vi.fn()}
        onSetTarget={onSetTarget}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Hoy/i }));

    await waitFor(() => {
      expect(onSetTarget).not.toHaveBeenCalled();
    });
  });

  it('confirms move without sending target date payload', async () => {
    const onConfirm = vi.fn();

    render(
      <MoveCopyModal
        isOpen={true}
        type="move"
        sourceBedId="R1"
        targetBedId="R2"
        onClose={vi.fn()}
        onSetTarget={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Confirmar Traslado/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(undefined);
    });
  });

  it('confirms copy sending selected target date', async () => {
    const onConfirm = vi.fn();

    render(
      <MoveCopyModal
        isOpen={true}
        type="copy"
        sourceBedId="R1"
        targetBedId="R2"
        onClose={vi.fn()}
        onSetTarget={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Mañana/i }));
    const confirmButton = screen.getByRole('button', { name: /Confirmar Copia/i });

    await waitFor(() => {
      expect(confirmButton).toBeEnabled();
    });

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('2026-02-14');
    });
  });
});
