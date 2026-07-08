import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BootstrapRouteChrome } from '@/app-shell/bootstrap/BootstrapCensusChrome';

const mockNavbar = vi.fn();
const mockDateStrip = vi.fn();

vi.mock('@/context/AuthContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return {
    ...actual,
  };
});

vi.mock('@/components/layout/Navbar', () => ({
  Navbar: (props: Record<string, unknown>) => {
    mockNavbar(props);
    return <div data-testid="bootstrap-navbar">{String(props.currentModule)}</div>;
  },
}));

vi.mock('@/components/layout/DateStrip', () => ({
  DateStrip: (props: Record<string, unknown>) => {
    mockDateStrip(props);
    return <div data-testid="bootstrap-date-strip">{String(props.currentModule)}</div>;
  },
}));

vi.mock('@/components/ui/ViewLoader', () => ({
  ViewLoader: () => <div data-testid="view-loader">Loading</div>,
}));

describe('BootstrapRouteChrome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('renders census chrome and preserves the route date when bootstrapping census', () => {
    window.history.replaceState({}, '', '/census?date=2026-04-22');

    render(<BootstrapRouteChrome />);

    expect(screen.getByTestId('bootstrap-navbar')).toHaveTextContent('CENSUS');
    expect(screen.getByTestId('bootstrap-date-strip')).toHaveTextContent('CENSUS');
    expect(mockNavbar).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'CENSUS',
        censusViewMode: 'REGISTER',
        hideRuntimeIndicators: true,
      })
    );
    expect(mockDateStrip).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'CENSUS',
        selectedYear: 2026,
        selectedMonth: 3,
        selectedDay: 22,
      })
    );
    expect(screen.queryByTestId('census-operational-state-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('view-loader')).not.toBeInTheDocument();
  });

  it('renders the nursing handoff chrome for nursing-handoff refreshes', () => {
    window.history.replaceState({}, '', '/nursing-handoff');

    render(<BootstrapRouteChrome />);

    expect(screen.getByTestId('bootstrap-navbar')).toHaveTextContent('NURSING_HANDOFF');
    expect(screen.getByTestId('bootstrap-date-strip')).toHaveTextContent('NURSING_HANDOFF');
    expect(mockNavbar).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'NURSING_HANDOFF',
      })
    );
    expect(mockDateStrip).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'NURSING_HANDOFF',
        onExportPDF: expect.any(Function),
      })
    );
    expect(screen.getByTestId('view-loader')).toBeInTheDocument();
  });

  it('keeps transfer-management on its own navbar without forcing a date strip', () => {
    window.history.replaceState({}, '', '/transfer-management');

    render(<BootstrapRouteChrome />);

    expect(screen.getByTestId('bootstrap-navbar')).toHaveTextContent('TRANSFER_MANAGEMENT');
    expect(screen.queryByTestId('bootstrap-date-strip')).not.toBeInTheDocument();
    expect(mockNavbar).toHaveBeenCalledWith(
      expect.objectContaining({
        currentModule: 'TRANSFER_MANAGEMENT',
      })
    );
    expect(mockDateStrip).not.toHaveBeenCalled();
    expect(screen.getByTestId('view-loader')).toBeInTheDocument();
  });
});
