import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import {
  createShellRuntimeMock,
  createShellUiMock,
  flushLazyBypassComponents,
} from './appContentTestUtils';

vi.mock('@/components/ui/lazyWithRetry', async () => {
  const { createLazyWithRetryBypass } = await import('./appContentTestUtils');
  return createLazyWithRetryBypass();
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

vi.mock('@/components/clinical-conflicts/CensusConflictQuickAction', () => ({
  CensusConflictQuickAction: () => <button data-census-menu-action>Conflictos HHR</button>,
}));

vi.mock('@/features/census/components/global-search/GlobalPatientSearchModal', () => ({
  GlobalPatientSearchModal: () => <div data-testid="patient-search-modal">PatientSearchModal</div>,
}));

beforeAll(flushLazyBypassComponents);

describe('AppContentChrome', () => {
  const ui = createShellUiMock();
  const runtime = createShellRuntimeMock();

  it('keeps the admin conflict entry inside the options menu only', () => {
    render(<AppContentChrome ui={ui} runtime={runtime} />);
    const trailing = (mockDateStrip.mock.lastCall?.[0] as { trailingActions?: React.ReactNode })
      .trailingActions;
    render(<>{trailing}</>);
    expect(screen.queryByRole('button', { name: 'Conflictos HHR' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones del censo' }));
    const menu = screen.getByRole('group', { name: 'Opciones del censo' });
    expect(within(menu).getByRole('button', { name: 'Conflictos HHR' })).toBeVisible();
    fireEvent.click(within(menu).getByRole('button', { name: 'Conflictos HHR' }));
    expect(menu).not.toBeVisible();
  });

  it('renders chrome in normal mode', () => {
    render(
      <AppContentChrome
        ui={ui}
        runtime={runtime}
        onOpenCensusDate={vi.fn()}
        renderModuleRouter={(_ui, shell) => (
          <div
            data-testid="app-router"
            data-has-open-date={String(Boolean(shell.onOpenCensusDate))}
          >
            AppRouter
          </div>
        )}
      />
    );

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('datestrip')).toBeInTheDocument();
    expect(screen.getByTestId('bookmark-bar')).toBeInTheDocument();
    expect(screen.getByTestId('app-router')).toBeInTheDocument();
    expect(screen.getByTestId('app-router')).toHaveAttribute('data-has-open-date', 'true');
  });

  it('keeps census export actions only on allowed census views', () => {
    const { rerender } = render(
      <AppContentChrome ui={ui} runtime={runtime} onOpenCensusDate={vi.fn()} />
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
        ui={createShellUiMock({ currentModule: 'CUDYR' })}
        runtime={runtime}
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
        ui={ui}
        runtime={runtime}
        onOpenCensusDate={vi.fn()}
        renderCensusTrailingActions={renderCensusTrailingActions}
      />
    );
    expect(renderCensusTrailingActions).toHaveBeenCalledTimes(1);
    expect(renderCensusTrailingActions).toHaveBeenCalledWith(expect.any(Array));
    expect(readTrailing()).toBeTruthy();

    rerender(
      <AppContentChrome
        ui={createShellUiMock({ currentModule: 'NURSING_HANDOFF' })}
        runtime={runtime}
        onOpenCensusDate={vi.fn()}
        renderCensusTrailingActions={renderCensusTrailingActions}
      />
    );
    expect(renderCensusTrailingActions).toHaveBeenCalledTimes(1);
    expect(readTrailing()).toBeUndefined();
  });

  it('keeps MMRAD and Laboratorio out of the census options menu', () => {
    const renderFeatureQuickActions = vi.fn(() => <button type="button">Laboratorio</button>);
    render(
      <AppContentChrome
        ui={ui}
        runtime={runtime}
        onOpenCensusDate={vi.fn()}
        renderFeatureQuickActions={renderFeatureQuickActions}
      />
    );
    const trailing = (mockDateStrip.mock.lastCall?.[0] as { trailingActions?: React.ReactNode })
      .trailingActions;
    render(<>{trailing}</>);

    fireEvent.click(screen.getByRole('button', { name: 'Más opciones del censo' }));
    const menu = screen.getByRole('group', { name: 'Opciones del censo' });
    expect(within(menu).getByText('Camas')).toBeInTheDocument();
    expect(within(menu).queryByText('MMRAD')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Laboratorio')).not.toBeInTheDocument();
    expect(within(menu).queryByTitle('Lab (cargando...)')).not.toBeInTheDocument();
    expect(renderFeatureQuickActions).not.toHaveBeenCalled();
  });
});
