import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';

type LazyBypassProps = Record<string, unknown>;

// Shared state accessible from both vi.mock factory and test code.
const { _lazyPending, _lazyResolved } = vi.hoisted(() => ({
  _lazyPending: [] as Promise<void>[],
  _lazyResolved: new Map<symbol, React.ComponentType<LazyBypassProps>>(),
}));

// Bypass React.lazy so lazy-loaded components render synchronously in tests.
// vi.mock'd dynamic imports resolve as micro-tasks.  We collect all pending
// resolutions and flush them in a beforeAll so every LazyBypass wrapper has
// its component available before the first render().
vi.mock('@/utils/lazyWithRetry', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    lazyWithRetry: (factory: () => Promise<{ default: React.ComponentType<LazyBypassProps> }>) => {
      const key = Symbol();
      const p = factory().then((m: { default: React.ComponentType<LazyBypassProps> }) => {
        _lazyResolved.set(key, m.default);
      });
      _lazyPending.push(p);
      return React.forwardRef(function LazyBypass(
        props: LazyBypassProps,
        ref: React.ForwardedRef<unknown>
      ) {
        const Comp = _lazyResolved.get(key) ?? null;
        return Comp ? React.createElement(Comp, { ...props, ref }) : null;
      });
    },
  };
});

import { AppContentChrome } from '@/components/layout/app-content/AppContentChrome';

const mockDateStrip = vi.fn();
const mockNavbar = vi.fn();

vi.mock('@/components/layout/Navbar', () => ({
  Navbar: (props: unknown) => {
    mockNavbar(props);
    return <div data-testid="navbar">Navbar</div>;
  },
}));

vi.mock('@/components/layout/DateStrip', () => ({
  DateStrip: (props: unknown) => {
    mockDateStrip(props);
    return <div data-testid="datestrip">DateStrip</div>;
  },
}));

vi.mock('@/components/bookmarks/BookmarkBar', () => ({
  BookmarkBar: () => <div data-testid="bookmark-bar">BookmarkBar</div>,
}));

vi.mock('@/components/AppRouter', () => ({
  AppRouter: (props: unknown) => (
    <div
      data-testid="app-router"
      data-has-open-date={String(
        Boolean((props as { shell?: { onOpenCensusDate?: unknown } }).shell?.onOpenCensusDate)
      )}
    >
      AppRouter
    </div>
  ),
}));

vi.mock('@/features/census/components/global-search/GlobalPatientSearchModal', () => ({
  GlobalPatientSearchModal: () => <div data-testid="patient-search-modal">PatientSearchModal</div>,
}));

// Flush lazy component resolutions before any test renders.
beforeAll(() => Promise.all(_lazyPending));

describe('AppContentChrome', () => {
  const ui = {
    currentModule: 'CENSUS',
    setCurrentModule: vi.fn(),
    censusViewMode: 'REGISTER',
    setCensusViewMode: vi.fn(),
    bedManagerModal: { isOpen: false, open: vi.fn(), close: vi.fn() },
    settingsModal: { isOpen: false, open: vi.fn(), close: vi.fn() },
    patientSearchModal: { isOpen: false, open: vi.fn(), close: vi.fn(), toggle: vi.fn() },
    showPrintButton: true,
    showBookmarksBar: true,
    setShowBookmarksBar: vi.fn(),
    isTestAgentRunning: false,
    setIsTestAgentRunning: vi.fn(),
    selectedShift: 'day',
    setSelectedShift: vi.fn(),
  } as const;

  const runtime = {
    auth: {
      currentUser: { email: 'admin@hospital.cl' },
      role: 'admin',
      signOut: vi.fn(),
      isFirebaseConnected: true,
    },
    dateNav: {
      isSignatureMode: false,
      currentDateString: '2026-03-27',
      selectedYear: 2026,
      setSelectedYear: vi.fn(),
      selectedMonth: 2,
      setSelectedMonth: vi.fn(),
      selectedDay: 27,
      setSelectedDay: vi.fn(),
      daysInMonth: 31,
      existingDaysInMonth: [1, 4],
      navigateDays: vi.fn(),
    },
    censusEmail: {
      setShowEmailConfig: vi.fn(),
      sendEmail: vi.fn(),
      status: 'idle',
      error: null,
    },
    fileOps: { handleExportCSV: vi.fn(), handleImportJSON: vi.fn() },
    syncStatus: 'idle',
    lastSyncTime: null,
    exportManager: {
      handleExportPDF: vi.fn(),
      handleBackupExcel: vi.fn(),
      handleBackupHandoff: vi.fn(),
      isArchived: false,
      isBackingUp: false,
    },
    canUseCensusExports: true,
    handleExportExcel: vi.fn(),
    censusAccessProfile: 'full',
  } as const;

  it('renders chrome in normal mode', () => {
    render(
      <AppContentChrome ui={ui as never} runtime={runtime as never} onOpenCensusDate={vi.fn()} />
    );

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('datestrip')).toBeInTheDocument();
    expect(screen.getByTestId('bookmark-bar')).toBeInTheDocument();
    expect(screen.getByTestId('app-router')).toBeInTheDocument();
    expect(screen.getByTestId('app-router')).toHaveAttribute('data-has-open-date', 'true');
  });

  it('hides navigation chrome in signature mode', () => {
    render(
      <AppContentChrome
        ui={ui as never}
        runtime={
          {
            ...runtime,
            dateNav: { ...runtime.dateNav, isSignatureMode: true },
          } as never
        }
        onOpenCensusDate={vi.fn()}
      />
    );

    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
  });

  it('keeps census export actions only on allowed census views', () => {
    const { rerender } = render(
      <AppContentChrome ui={ui as never} runtime={runtime as never} onOpenCensusDate={vi.fn()} />
    );

    expect(mockDateStrip).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onOpenBedManager: expect.any(Function),
        onExportExcel: expect.any(Function),
        onConfigureEmail: expect.any(Function),
      })
    );

    rerender(
      <AppContentChrome
        ui={
          {
            ...ui,
            currentModule: 'CUDYR',
          } as never
        }
        runtime={runtime as never}
        onOpenCensusDate={vi.fn()}
      />
    );

    expect(mockDateStrip).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onOpenBedManager: undefined,
        onExportExcel: undefined,
        onConfigureEmail: undefined,
      })
    );
  });

  it('mounts the census trailing actions only in the daily census module', () => {
    const renderCensusTrailingActions = vi.fn(() => <span>Documentos</span>);
    const readTrailing = () =>
      (mockDateStrip.mock.lastCall?.[0] as { trailingActions?: React.ReactNode }).trailingActions;

    const { rerender } = render(
      <AppContentChrome
        ui={ui as never}
        runtime={runtime as never}
        onOpenCensusDate={vi.fn()}
        renderCensusTrailingActions={renderCensusTrailingActions}
      />
    );
    expect(renderCensusTrailingActions).toHaveBeenCalledTimes(1);
    expect(readTrailing()).toBeTruthy();

    rerender(
      <AppContentChrome
        ui={{ ...ui, currentModule: 'NURSING_HANDOFF' } as never}
        runtime={runtime as never}
        onOpenCensusDate={vi.fn()}
        renderCensusTrailingActions={renderCensusTrailingActions}
      />
    );
    expect(renderCensusTrailingActions).toHaveBeenCalledTimes(1);
    expect(readTrailing()).toBeUndefined();
  });
});
