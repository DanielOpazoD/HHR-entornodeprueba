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

vi.mock('@/features/rayen-import/public', () => ({
  RayenDayBootstrapButton: ({
    onCreateBlank,
    onReady,
  }: {
    onCreateBlank: () => Promise<void>;
    onReady: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        void onCreateBlank().then(onReady);
      }}
    >
      Crear desde Eloísa
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
    vi.setSystemTime(new Date(2026, 2, 3, 9, 0, 0));
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

  // The Eloisa bootstrap must follow the clinical day (08:00 business / 09:00 weekend
  // rollover) that the census calendar renders, not the raw calendar date. 2026-09-09 is a
  // Wednesday and 2026-09-10 a Thursday, so both roll over at 08:00.
  describe('clinical day alignment for the Eloisa bootstrap', () => {
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

    it('offers the active clinical day (Sept 9) at 00:30 on Sept 10', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 10, 0, 30, 0));

      renderPrompt('2026-09-09', 9);

      expect(screen.getByRole('button', { name: ELOISA_BUTTON })).toBeInTheDocument();
    });

    it('hides the bootstrap for the raw calendar date (Sept 10) before the 08:00 rollover', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 10, 0, 30, 0));

      renderPrompt('2026-09-10', 10);

      expect(screen.queryByRole('button', { name: ELOISA_BUTTON })).not.toBeInTheDocument();
    });

    it('switches to the next clinical day when a weekday crosses 08:00', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 10, 7, 59, 0));

      const sept9 = renderPrompt('2026-09-09', 9);
      const sept10 = renderPrompt('2026-09-10', 10);

      expect(
        within(sept9.container).queryByRole('button', { name: ELOISA_BUTTON })
      ).toBeInTheDocument();
      expect(
        within(sept10.container).queryByRole('button', { name: ELOISA_BUTTON })
      ).not.toBeInTheDocument();

      // Crossing 08:00 lets the reactive hook poll pick up the new clinical day.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(
        within(sept9.container).queryByRole('button', { name: ELOISA_BUTTON })
      ).not.toBeInTheDocument();
      expect(
        within(sept10.container).queryByRole('button', { name: ELOISA_BUTTON })
      ).toBeInTheDocument();
    });
  });
});
