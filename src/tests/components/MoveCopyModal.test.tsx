import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MoveCopyModal } from '@/features/census/components/movements/MoveCopyModal';
import * as moveCopyModalController from '@/features/census/components/movements/moveCopyModalController';

const mockedUseDailyRecordData = vi.fn();
const mockedGetForDateWithMeta = vi.fn();

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => mockedUseDailyRecordData(),
}));

vi.mock('@/context/RepositoryContext', () => ({
  useRepositories: () => ({
    dailyRecord: {
      getForDateWithMeta: (...args: unknown[]) => mockedGetForDateWithMeta(...args),
    },
  }),
}));

describe('MoveCopyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseDailyRecordData.mockReturnValue({
      record: {
        date: '2026-02-13',
        activeExtraBeds: [],
        beds: {},
      },
    });
    mockedGetForDateWithMeta.mockResolvedValue({
      record: null,
      serverConfirmed: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      expect(mockedGetForDateWithMeta).toHaveBeenCalledWith('2026-02-14', true);
    });
  });

  it('shows inline retry notice, hides Libre beds, and disables confirm when availability fetch fails online', async () => {
    mockedGetForDateWithMeta.mockRejectedValueOnce(new Error('fetch failed'));

    render(
      <MoveCopyModal
        isOpen={true}
        type="copy"
        sourceBedId="R1"
        targetBedId="R2"
        onClose={vi.fn()}
        onSetTarget={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Mañana/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /No se pudo verificar la disponibilidad de este día/i
      );
    });
    expect(screen.queryAllByRole('button', { name: /Libre/i })).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Confirmar Copia/i })).toBeDisabled();

    // Retry recovers and renders verified availability.
    mockedGetForDateWithMeta.mockResolvedValueOnce({
      record: {
        date: '2026-02-14',
        activeExtraBeds: [],
        beds: { R2: { patientName: 'Paciente ocupado' } },
      },
      serverConfirmed: true,
    });
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /R2.*Ocupada/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /R1.*Libre/i })).toBeEnabled();
    });
  });

  it('treats an unconfirmed null read (serverConfirmed: false) as unavailable while online (SAVE-01)', async () => {
    mockedGetForDateWithMeta.mockResolvedValue({
      record: null,
      serverConfirmed: false,
      consistencyState: 'unavailable',
    });

    render(
      <MoveCopyModal
        isOpen={true}
        type="copy"
        sourceBedId="R1"
        targetBedId="R2"
        onClose={vi.fn()}
        onSetTarget={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Mañana/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /No se pudo verificar la disponibilidad de este día/i
      );
    });
    expect(screen.queryAllByRole('button', { name: /Libre/i })).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Confirmar Copia/i })).toBeDisabled();
  });

  it('treats a superseded null read (publication: superseded) as unavailable online (SAVE-01)', async () => {
    mockedGetForDateWithMeta.mockResolvedValue({
      record: null,
      serverConfirmed: true,
      publication: 'superseded',
    });

    render(
      <MoveCopyModal
        isOpen={true}
        type="copy"
        sourceBedId="R1"
        targetBedId="R2"
        onClose={vi.fn()}
        onSetTarget={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Mañana/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /No se pudo verificar la disponibilidad de este día/i
      );
    });
    expect(screen.queryAllByRole('button', { name: /Libre/i })).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Confirmar Copia/i })).toBeDisabled();
  });

  it('keeps offline copy available with Sin verificar labels and blocks confirmation if connectivity returns', async () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mockedGetForDateWithMeta.mockResolvedValue({
      record: null,
      serverConfirmed: false,
      consistencyState: 'unavailable',
    });
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

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /No se pudo verificar la disponibilidad de este día/i
      );
    });
    expect(screen.queryAllByRole('button', { name: /Libre/i })).toHaveLength(0);
    expect(screen.getByRole('button', { name: /R2.*Sin verificar/i })).toBeEnabled();
    const confirmButton = screen.getByRole('button', { name: /Confirmar Copia/i });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledWith('2026-02-14');

    // When connectivity returns while the modal is open, the unverified grid is replaced by the retry gate.
    onLineSpy.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryAllByRole('button', { name: /Sin verificar|Libre/i })).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /No se pudo verificar la disponibilidad de este día/i
    );
    expect(screen.getByRole('button', { name: /Confirmar Copia/i })).toBeDisabled();
  });

  it('announces destination availability checks without changing the modal layout', async () => {
    let resolveTargetRecord: (value: { record: null; serverConfirmed: boolean }) => void = () => {};
    mockedGetForDateWithMeta.mockReturnValue(
      new Promise(resolve => {
        resolveTargetRecord = resolve;
      })
    );

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

    expect(screen.getByRole('status')).toHaveTextContent(/verificando disponibilidad/i);

    resolveTargetRecord({ record: null, serverConfirmed: true });

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /R1.*Libre/i })).toBeEnabled();
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

  it('updates bed list immediately when switching destination date to avoid stale options', async () => {
    mockedGetForDateWithMeta.mockImplementation(async (date: string) => {
      if (date === '2026-02-14') {
        return {
          record: {
            date,
            activeExtraBeds: [],
            beds: {},
          },
          serverConfirmed: true,
        };
      }
      return { record: null, serverConfirmed: true };
    });

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

    // Same-day copy hides source bed option.
    expect(screen.queryByRole('button', { name: /\bR1\b/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mañana/i }));

    await waitFor(() => {
      expect(mockedGetForDateWithMeta).toHaveBeenCalledWith('2026-02-14', true);
      // Cross-date copy should include source bed without requiring remount.
      expect(screen.getByRole('button', { name: /\bR1\b/i })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimiento/i }));

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

  it('refreshes same-day occupancy and blocks confirmation when the selected bed becomes occupied', () => {
    const onConfirm = vi.fn();
    const props = {
      isOpen: true,
      type: 'move' as const,
      sourceBedId: 'R1',
      targetBedId: 'R2',
      onClose: vi.fn(),
      onSetTarget: vi.fn(),
      onConfirm,
    };
    const view = render(<MoveCopyModal {...props} />);
    expect(screen.getByRole('button', { name: /R2.*Libre/i })).toBeEnabled();
    mockedUseDailyRecordData.mockReturnValue({
      record: {
        date: '2026-02-13',
        activeExtraBeds: [],
        beds: { R2: { patientName: 'Synthetic patient' } },
      },
    });
    view.rerender(<MoveCopyModal {...props} />);
    expect(screen.getByRole('button', { name: /R2.*Ocupada/i })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: /Confirmar Movimiento/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    mockedUseDailyRecordData.mockReturnValue({
      record: { date: '2026-02-13', activeExtraBeds: [], beds: {} },
    });
    view.rerender(<MoveCopyModal {...props} />);
    expect(screen.getByRole('button', { name: /R2.*Libre/i })).toBeEnabled();
    expect(confirm).toBeEnabled();
    expect(mockedGetForDateWithMeta).not.toHaveBeenCalled();
  });

  it('skips computing bed options on record updates while the modal is closed', () => {
    const resolveOptionsSpy = vi.spyOn(moveCopyModalController, 'resolveMoveCopyBedOptions');
    const baseProps = {
      isOpen: false,
      type: 'move' as const,
      sourceBedId: 'R1',
      targetBedId: null,
      onClose: vi.fn(),
      onSetTarget: vi.fn(),
      onConfirm: vi.fn(),
    };

    const view = render(<MoveCopyModal {...baseProps} />);

    mockedUseDailyRecordData.mockReturnValue({
      record: {
        date: '2026-02-13',
        activeExtraBeds: [],
        beds: { R2: { patientName: 'Paciente sintético' } },
      },
    });
    view.rerender(<MoveCopyModal {...baseProps} />);

    expect(resolveOptionsSpy).not.toHaveBeenCalled();

    view.rerender(<MoveCopyModal {...baseProps} isOpen={true} />);

    expect(resolveOptionsSpy).toHaveBeenCalledTimes(1);
    resolveOptionsSpy.mockRestore();
  });
});
