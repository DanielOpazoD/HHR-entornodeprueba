import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyDayPrompt } from '@/features/census/components/EmptyDayPrompt';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';

vi.mock('@/features/census/components/CensusEmptyMoa', () => ({
  CensusEmptyMoa: () => <span data-testid="census-empty-moa" />,
}));

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordEvent: vi.fn() },
}));
vi.mock('@/features/rayen-import/public', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import/public')>()),
  RayenDayBootstrapButton: ({
    historical,
    disabled,
    onCreateBlank,
    onReady,
    copySourceDate,
    onCopyPrevious,
  }: {
    historical?: boolean;
    disabled?: boolean;
    onCreateBlank: () => Promise<boolean>;
    onReady: () => void;
    copySourceDate?: string;
    onCopyPrevious?: () => Promise<boolean>;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (copySourceDate) void onCopyPrevious?.().then(copied => copied && onReady());
        else void onCreateBlank().then(onReady);
      }}
    >
      {copySourceDate
        ? `Copiar pacientes del ${Number(copySourceDate.slice(-2))}`
        : historical
          ? 'Reconstruir desde Eloísa'
          : 'Crear desde Eloísa'}
    </button>
  ),
}));

const renderPrompt = (
  date: string,
  options: {
    source?: 'remote_missing' | 'sync_pending' | 'local_cache_empty' | 'date_mismatch';
    onCreateDay?: (...args: unknown[]) => Promise<boolean>;
    onReady?: () => void;
    readOnly?: boolean;
    previousRecordDate?: string;
  } = {}
) =>
  render(
    <EmptyDayPrompt
      selectedDay={Number(date.slice(-2))}
      selectedMonth={Number(date.slice(5, 7)) - 1}
      currentDateString={date}
      previousRecordAvailable={true}
      previousRecordDate={options.previousRecordDate ?? '2026-09-22'}
      onCreateDay={options.onCreateDay ?? vi.fn().mockResolvedValue(true)}
      onRayenBootstrapReady={options.onReady ?? vi.fn()}
      readOnly={options.readOnly}
      emptyStateDiagnostic={
        options.source
          ? {
              source: options.source,
              message: 'Diagnóstico técnico que no corresponde mostrar a enfermería.',
            }
          : undefined
      }
    />
  );

describe('EmptyDayPrompt · una acción para iniciar desde Eloísa', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows one creation action and starts the reviewed import without copying yesterday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T17:00:00Z'));
    const onCreateDay = vi.fn().mockResolvedValue(true);
    const onReady = vi.fn();
    renderPrompt('2026-09-24', { source: 'remote_missing', onCreateDay, onReady });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/Firebase|copia local/i)).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await Promise.resolve();
    });
    expect(onCreateDay).toHaveBeenCalledWith(false);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('copies the adjacent census before starting the Eloísa import', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T17:00:00Z'));
    const onCreateDay = vi.fn().mockResolvedValue(true);
    const onReady = vi.fn();
    renderPrompt('2026-09-24', {
      source: 'remote_missing',
      previousRecordDate: '2026-09-23',
      onCreateDay,
      onReady,
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar pacientes del 23' }));
    });
    expect(onCreateDay).toHaveBeenCalledWith(true, '2026-09-23');
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('keeps the copy action visible but disabled before the 08:00 unlock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
    const onCreateDay = vi.fn().mockResolvedValue(true);
    renderPrompt('2026-09-24', {
      source: 'remote_missing',
      previousRecordDate: '2026-09-23',
      onCreateDay,
    });
    const button = screen.getByRole('button', { name: 'Copiar pacientes del 23' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCreateDay).not.toHaveBeenCalled();
    act(() => {
      vi.setSystemTime(new Date('2026-09-24T11:00:00Z'));
      vi.advanceTimersByTime(60_000);
    });
    expect(button).toBeEnabled();
  });

  it('copies only the adjacent prior date for a confirmed empty historical day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T17:00:00Z'));
    const onCreateDay = vi.fn().mockResolvedValue(true);
    renderPrompt('2026-09-20', {
      onCreateDay,
      source: 'date_mismatch',
      previousRecordDate: '2026-09-19',
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar pacientes del 19' }));
    });
    expect(onCreateDay).toHaveBeenCalledWith(true, '2026-09-19');
  });

  it('changes from current capture to historical reconstruction when an open tab ages', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T17:00:00Z'));
    renderPrompt('2026-09-24', { source: 'remote_missing' });
    expect(screen.getByRole('button', { name: 'Crear desde Eloísa' })).toBeInTheDocument();
    vi.setSystemTime(new Date('2026-10-04T17:00:00Z'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('button', { name: 'Reconstruir desde Eloísa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear desde Eloísa' })).not.toBeInTheDocument();
  });

  it('does not create an empty day while the remote check is pending or unavailable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T17:00:00Z'));
    const pending = renderPrompt('2026-09-24', { source: 'sync_pending' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Comprobando si ya existe/i)).toBeInTheDocument();
    pending.unmount();
    renderPrompt('2026-09-24', { source: 'local_cache_empty' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Revisa tu conexión/i)).toBeInTheDocument();
  });

  it('offers an older historical bootstrap while rejecting future dates and guest actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T17:00:00Z'));
    const old = renderPrompt('2026-09-15', { source: 'date_mismatch' });
    expect(screen.getByRole('button', { name: 'Reconstruir desde Eloísa' })).toBeInTheDocument();
    old.unmount();
    const future = renderPrompt('2026-09-25', {
      source: 'date_mismatch',
      previousRecordDate: '2026-09-24',
    });
    expect(screen.getByRole('button')).toBeDisabled();
    future.unmount();
    renderPrompt('2026-09-24', { source: 'remote_missing', readOnly: true });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retains the diagnostic source in telemetry without showing technical detail', () => {
    renderPrompt('2026-09-24', { source: 'remote_missing' });
    expect(screen.queryByText(/Diagnóstico técnico/i)).not.toBeInTheDocument();
    expect(dailyRecordObservability.recordEvent).toHaveBeenCalledWith(
      'census_empty_state_visible',
      'degraded',
      expect.objectContaining({
        context: { source: 'remote_missing' },
      })
    );
  });
});
