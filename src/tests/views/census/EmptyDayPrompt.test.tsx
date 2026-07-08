import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyDayPrompt } from '@/features/census/components/EmptyDayPrompt';
import { dailyRecordObservability } from '@/services/repositories/dailyRecordOperationalTelemetry';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: {
    recordEvent: vi.fn(),
  },
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
});
