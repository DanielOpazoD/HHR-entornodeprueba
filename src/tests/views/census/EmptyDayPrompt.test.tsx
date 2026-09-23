import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyDayPrompt } from '@/features/census/components/EmptyDayPrompt';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: {
    recordEvent: vi.fn(),
  },
}));

vi.mock('@/features/rayen-import/public', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import/public')>()),
  RayenDayBootstrapButton: ({
    historical,
    onCreateBlank,
    onReady,
  }: {
    historical?: boolean;
    onCreateBlank: () => Promise<void>;
    onReady: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        void onCreateBlank().then(onReady);
      }}
    >
      {historical ? 'Reconstruir desde Eloísa' : 'Crear desde Eloísa'}
    </button>
  ),
}));

describe('EmptyDayPrompt', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('disables copy button and shows countdown before 08:00 for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 7, 30, 0));

    render(
      <EmptyDayPrompt
        selectedDay={3}
        selectedMonth={2}
        currentDateString="2026-03-03"
        previousRecordAvailable={true}
        previousRecordDate="2026-03-02"
        availableDates={['2026-03-02', '2026-03-01']}
        onCreateDay={() => undefined}
      />
    );

    expect(screen.getByTestId('copy-previous-btn')).toBeDisabled();
    expect(screen.getByText('Disponible hoy desde las 8:00 hrs.')).toBeInTheDocument();
    expect(screen.getByText('Se habilita en 00:30:00')).toBeInTheDocument();
  });

  it('offers today as a reviewed Eloisa bootstrap without copying the previous census', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T14:00:00.000Z')); // 09:00 in Rapa Nui
    const onCreateDay = vi.fn().mockResolvedValue(undefined);
    const onRayenBootstrapReady = vi.fn();

    render(
      <EmptyDayPrompt
        selectedDay={3}
        selectedMonth={2}
        currentDateString="2026-03-03"
        previousRecordAvailable={true}
        previousRecordDate="2026-03-02"
        onCreateDay={onCreateDay}
        onRayenBootstrapReady={onRayenBootstrapReady}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crear desde Eloísa' }));
      await Promise.resolve();
    });
    expect(onRayenBootstrapReady).toHaveBeenCalledTimes(1);
    expect(onCreateDay).toHaveBeenCalledWith(false);
  });

  it('shows an admin override button while the visual countdown remains locked', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 7, 30, 0));

    render(
      <EmptyDayPrompt
        selectedDay={3}
        selectedMonth={2}
        currentDateString="2026-03-03"
        previousRecordAvailable={true}
        previousRecordDate="2026-03-02"
        availableDates={['2026-03-02']}
        onCreateDay={() => undefined}
        allowAdminCopyOverride={true}
      />
    );

    expect(screen.getByTestId('copy-previous-btn')).toBeDisabled();
    expect(screen.getByTestId('admin-copy-override-btn')).toBeInTheDocument();
    expect(screen.getByText('Se habilita en 00:30:00')).toBeInTheDocument();
  });

  it('offers evidence-based bootstrap for a missing historical day within seven days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T17:00:00.000Z')); // 11:00 in Rapa Nui
    const onCreateDay = vi.fn().mockResolvedValue(undefined);
    const onRayenBootstrapReady = vi.fn();

    render(
      <EmptyDayPrompt
        selectedDay={19}
        selectedMonth={8}
        currentDateString="2026-09-19"
        previousRecordAvailable={false}
        onCreateDay={onCreateDay}
        onRayenBootstrapReady={onRayenBootstrapReady}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reconstruir desde Eloísa' }));
      await Promise.resolve();
    });
    expect(onCreateDay).toHaveBeenCalledWith(false);
    expect(onRayenBootstrapReady).toHaveBeenCalledTimes(1);
  });

  it('does not offer Eloísa bootstrap outside the supported seven-day window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T17:00:00.000Z'));

    render(
      <EmptyDayPrompt
        selectedDay={15}
        selectedMonth={8}
        currentDateString="2026-09-15"
        previousRecordAvailable={false}
        onCreateDay={() => undefined}
        onRayenBootstrapReady={() => undefined}
      />
    );

    expect(screen.queryByRole('button', { name: /desde Eloísa/i })).not.toBeInTheDocument();
  });

  it('keeps copy button enabled for days that are not today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 7, 30, 0));

    render(
      <EmptyDayPrompt
        selectedDay={2}
        selectedMonth={2}
        currentDateString="2026-03-02"
        previousRecordAvailable={true}
        previousRecordDate="2026-03-01"
        availableDates={['2026-03-01']}
        onCreateDay={() => undefined}
      />
    );

    expect(screen.getByTestId('copy-previous-btn')).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Crear desde Eloísa' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Se habilita en/)).not.toBeInTheDocument();
  });

  it('keeps tomorrow locked with a 24-hour countdown after today starts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 8, 0, 0));

    render(
      <EmptyDayPrompt
        selectedDay={4}
        selectedMonth={2}
        currentDateString="2026-03-04"
        previousRecordAvailable={true}
        previousRecordDate="2026-03-03"
        availableDates={['2026-03-03']}
        onCreateDay={() => undefined}
      />
    );

    expect(screen.getByTestId('copy-previous-btn')).toBeDisabled();
    expect(screen.getByText('Disponible desde el 4 de Marzo a las 8:00 hrs.')).toBeInTheDocument();
    expect(screen.getByText('Se habilita en 24:00:00')).toBeInTheDocument();
  });

  it('shows the empty-state diagnostic and records its telemetry source', () => {
    render(
      <EmptyDayPrompt
        selectedDay={10}
        selectedMonth={4}
        currentDateString="2026-05-10"
        previousRecordAvailable={false}
        onCreateDay={() => undefined}
        emptyStateDiagnostic={{
          source: 'remote_missing',
          message:
            'Firebase y la copia local no tienen registro para esta fecha. Crea el dia solo si corresponde iniciar un censo nuevo.',
        }}
      />
    );

    expect(
      screen.getByText(/Firebase y la copia local no tienen registro para esta fecha/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId('empty-day-diagnostic-message')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('empty-day-diagnostic-message')).toHaveAttribute(
      'aria-live',
      'polite'
    );
    expect(screen.getByTestId('empty-day-diagnostic-source')).toHaveTextContent(
      'Firebase/local confirmado'
    );
    expect(screen.getByTestId('empty-day-diagnostic-source')).toHaveAttribute(
      'data-source',
      'remote_missing'
    );
    expect(dailyRecordObservability.recordEvent).toHaveBeenCalledWith(
      'census_empty_state_visible',
      'degraded',
      expect.objectContaining({
        date: '2026-05-10',
        context: expect.objectContaining({
          source: 'remote_missing',
        }),
      })
    );
  });

  // Before the handoff, both the active clinical day and the new calendar day can be synchronized.
  describe('dual current-day window for the Eloisa bootstrap', () => {
    const ELOISA_BUTTON = 'Crear desde Eloísa';

    const renderPrompt = (currentDateString: string, selectedDay: number) =>
      render(
        <EmptyDayPrompt
          selectedDay={selectedDay}
          selectedMonth={8}
          currentDateString={currentDateString}
          previousRecordAvailable={false}
          onCreateDay={() => undefined}
          onRayenBootstrapReady={() => undefined}
        />
      );

    it('offers Sept 9 during the reported Santiago/Rapa Nui pre-handoff gap', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-10T12:33:35.000Z')); // 09:33 Santiago, 07:33 Rapa Nui

      renderPrompt('2026-09-09', 9);

      expect(screen.getByRole('button', { name: ELOISA_BUTTON })).toBeInTheDocument();
    });

    it('offers Sept 10 during the reported Santiago/Rapa Nui pre-handoff gap', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-10T12:33:35.000Z')); // 09:33 Santiago, 07:33 Rapa Nui

      renderPrompt('2026-09-10', 10);

      expect(screen.getByRole('button', { name: ELOISA_BUTTON })).toBeInTheDocument();
    });

    it('keeps the previous day eligible as historical when a weekday crosses 08:00', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-10T12:59:00.000Z')); // 07:59 in Rapa Nui

      const sept9 = renderPrompt('2026-09-09', 9);
      const sept10 = renderPrompt('2026-09-10', 10);

      expect(
        within(sept9.container).queryByRole('button', { name: ELOISA_BUTTON })
      ).toBeInTheDocument();
      expect(
        within(sept10.container).queryByRole('button', { name: ELOISA_BUTTON })
      ).toBeInTheDocument();

      // Crossing 08:00 changes the previous day from current to supported historical.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(
        within(sept9.container).queryByRole('button', { name: 'Reconstruir desde Eloísa' })
      ).toBeInTheDocument();
      expect(
        within(sept10.container).queryByRole('button', { name: ELOISA_BUTTON })
      ).toBeInTheDocument();
    });
  });
});
