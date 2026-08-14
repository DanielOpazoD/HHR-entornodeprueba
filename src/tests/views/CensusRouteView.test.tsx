import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CensusRouteView } from '@/views/CensusRouteView';

const routeState = vi.hoisted(() => ({
  censusProps: null as Record<string, unknown> | null,
}));

vi.mock('@/features/census/census-view', () => ({
  CensusView: (props: Record<string, unknown>) => {
    routeState.censusProps = props;
    return <div data-testid="census-route-view" />;
  },
}));

vi.mock('@/features/handoff/medical-handoff-spreadsheet', () => ({
  buildMedicalHandoffSpreadsheetRows: vi.fn(() => [{ stableKey: 'episode:1' }]),
  MedicalHandoffSpreadsheetAction: ({ date, rows }: { date: string; rows: unknown[] }) => (
    <button type="button" data-testid="handoff-action" data-date={date} data-rows={rows.length} />
  ),
}));

describe('CensusRouteView', () => {
  it('injects the spreadsheet action when medical handoff access is allowed', () => {
    render(
      <CensusRouteView
        selectedDay={15}
        selectedMonth={2}
        currentDateString="2026-02-15"
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
        canOpenMedicalHandoffSpreadsheet={true}
      />
    );

    expect(screen.getByTestId('census-route-view')).toBeInTheDocument();
    const renderAction = routeState.censusProps?.renderMedicalHandoffAction;
    expect(renderAction).toEqual(expect.any(Function));

    const action = render(
      (renderAction as (context: Record<string, unknown>) => React.ReactNode)({
        record: { date: '2026-02-15', beds: {} },
        visibleBeds: [],
        professionalsCatalog: [],
      }) as React.ReactElement
    );
    expect(action.getByTestId('handoff-action')).toHaveAttribute('data-date', '2026-02-15');
    expect(action.getByTestId('handoff-action')).toHaveAttribute('data-rows', '1');
  });

  it('does not inject the action without access', () => {
    render(
      <CensusRouteView
        selectedDay={15}
        selectedMonth={2}
        currentDateString="2026-02-15"
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
      />
    );

    expect(routeState.censusProps?.renderMedicalHandoffAction).toBeUndefined();
  });
});
