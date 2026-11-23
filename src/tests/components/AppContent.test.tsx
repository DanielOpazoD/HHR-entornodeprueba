import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import {
  createShellAuthMock,
  createShellCensusContextMock,
  createShellDateNavMock,
  createShellExportManagerMock,
  createShellReminderCenterMock,
  createShellUiMock,
  flushLazyBypassComponents,
} from './appContentTestUtils';

vi.mock('@/components/ui/lazyWithRetry', async () => {
  const { createLazyWithRetryBypass } = await import('./appContentTestUtils');
  return createLazyWithRetryBypass();
});

import { AppContent } from '@/components/layout/AppContent';
import { useCensusContext } from '@/context/CensusContext';
import { useAuth } from '@/context/AuthContext';
import { useExportManager } from '@/hooks/useExportManager';

export const mockDateStrip = vi.fn();
export const mockNavbar = vi.fn();

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

vi.mock('@/components/debug/TestAgent', () => ({
  TestAgent: () => <div data-testid="test-agent">TestAgent</div>,
}));

vi.mock('@/components/bookmarks/BookmarkBar', () => ({
  BookmarkBar: () => <div data-testid="bookmark-bar">BookmarkBar</div>,
}));

vi.mock('@/components/layout/StorageStatusBadge', () => ({
  default: () => <div data-testid="storage-badge">StorageStatusBadge</div>,
}));

vi.mock('@/components/security/PinLockScreen', () => ({
  PinLockScreen: () => <div data-testid="pin-lock">PinLockScreen</div>,
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: null }),
  useDailyRecordSync: () => ({
    syncStatus: 'idle',
    hasSaveException: false,
    lastSyncTime: null,
  }),
}));

vi.mock('@/context/ReminderCenterContext', () => ({
  ReminderCenterProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="reminder-provider">{children}</div>
  ),
}));

vi.mock('@/components/layout/app-content/reminderCenterProviderLoader', () => ({
  loadReminderCenterProvider: () => new Promise(() => {}),
}));

vi.mock('@/hooks/useReminders', () => ({
  useReminderCenter: () => createShellReminderCenterMock(),
}));

vi.mock('@/components/reminders/ReminderModal', () => ({
  ReminderModal: () => <div data-testid="reminder-modal">ReminderModal</div>,
}));

vi.mock('@/context/CensusContext', () => ({
  useCensusContext: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock('@/hooks/useExportManager', () => ({
  useExportManager: vi.fn(),
}));

beforeAll(flushLazyBypassComponents);

describe('AppContent', () => {
  const mockUI = createShellUiMock();
  const mockCensusContext = createShellCensusContextMock({
    dateNav: createShellDateNavMock({
      currentDateString: '2024-01-01',
      selectedYear: 2024,
      selectedMonth: 1,
      selectedDay: 1,
      existingDaysInMonth: [],
    }),
  });
  const mockAuth = createShellAuthMock({
    currentUser: {
      uid: 'synthetic-uid',
      email: 'test@test.com',
      displayName: 'Test Admin',
      role: 'admin',
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCensusContext).mockReturnValue(mockCensusContext);
    vi.mocked(useAuth).mockReturnValue(mockAuth);
    vi.mocked(useExportManager).mockReturnValue(createShellExportManagerMock());
  });

  it('renders basic layout in normal mode', () => {
    render(
      <AppContent
        ui={mockUI}
        renderModuleRouter={() => <div data-testid="app-router">AppRouter</div>}
      />
    );

    expect(screen.getByTestId('navbar')).toBeInTheDocument();
    expect(screen.getByTestId('datestrip')).toBeInTheDocument();
    expect(screen.getByTestId('bookmark-bar')).toBeInTheDocument();
    expect(screen.getByTestId('app-router')).toBeInTheDocument();
    expect(screen.getByTestId('storage-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('reminder-modal')).not.toBeInTheDocument();
  });

  it('hides DateStrip in the standalone statistics module', () => {
    render(<AppContent ui={{ ...mockUI, currentModule: 'ANALYTICS' }} />);
    expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
  });

  it('hides BookmarkBar for non-privileged roles', () => {
    vi.mocked(useAuth).mockReturnValue(createShellAuthMock({ role: 'doctor_urgency' }));
    render(<AppContent ui={mockUI} />);
    expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
  });

  it('hides BookmarkBar when disabled in UI state', () => {
    render(<AppContent ui={{ ...mockUI, showBookmarksBar: false }} />);
    expect(screen.queryByTestId('bookmark-bar')).not.toBeInTheDocument();
  });

  it('passes specialist census accessProfile to DateStrip', () => {
    vi.mocked(useAuth).mockReturnValue(createShellAuthMock({ role: 'doctor_specialist' }));

    render(<AppContent ui={{ ...mockUI, currentModule: 'CENSUS' }} />);

    expect(mockDateStrip).toHaveBeenCalledWith(
      expect.objectContaining({
        accessProfile: 'specialist',
      })
    );
  });

  it('does not allow doctor_specialist to trigger archive verification checks on census entry', () => {
    vi.mocked(useAuth).mockReturnValue(createShellAuthMock({ role: 'doctor_specialist' }));

    render(<AppContent ui={{ ...mockUI, currentModule: 'CENSUS' }} />);

    expect(useExportManager).toHaveBeenCalledWith(
      expect.objectContaining({
        canVerifyArchiveStatus: false,
      })
    );
  });

  it('sanitizes invalid persisted modules for doctor_specialist', () => {
    vi.mocked(useAuth).mockReturnValue(createShellAuthMock({ role: 'doctor_specialist' }));

    render(<AppContent ui={{ ...mockUI, currentModule: 'AUDIT' }} />);

    expect(mockUI.setCurrentModule).toHaveBeenCalledWith('CENSUS');
  });

  it('hides DateStrip for non-clinical modules', () => {
    render(<AppContent ui={{ ...mockUI, currentModule: 'DIAGNOSTICS' }} />);
    expect(screen.queryByTestId('datestrip')).not.toBeInTheDocument();
  });

  it('responds to navigate-module window event', () => {
    render(<AppContent ui={mockUI} />);

    act(() => {
      window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'CUDYR' }));
    });

    expect(mockUI.setCurrentModule).toHaveBeenCalledWith('CUDYR');
  });

  it('responds to set-shift window event', () => {
    render(<AppContent ui={mockUI} />);

    act(() => {
      window.dispatchEvent(new CustomEvent('set-shift', { detail: 'night' }));
    });

    expect(mockUI.setSelectedShift).toHaveBeenCalledWith('night');
  });

  it('handles DateStrip clinical actions correctly', () => {
    vi.mocked(useExportManager).mockReturnValue(createShellExportManagerMock());

    const { unmount } = render(<AppContent ui={{ ...mockUI, currentModule: 'CENSUS' }} />);
    expect(mockDateStrip).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onOpenBedManager: expect.any(Function),
        onExportExcel: expect.any(Function),
        onConfigureEmail: expect.any(Function),
      })
    );
    unmount();

    render(<AppContent ui={{ ...mockUI, currentModule: 'CUDYR' }} />);
    expect(mockDateStrip).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onOpenBedManager: undefined,
        onExportExcel: undefined,
        onConfigureEmail: undefined,
      })
    );
  });

  it('shows and hides global modals/panels based on UI state', async () => {
    const uiWithModals = { ...mockUI, isTestAgentRunning: true };

    const { rerender } = render(<AppContent ui={uiWithModals} />);
    await act(flushLazyBypassComponents);
    rerender(<AppContent ui={uiWithModals} />);
    await act(flushLazyBypassComponents);
    rerender(<AppContent ui={uiWithModals} />);

    expect(screen.queryByTestId('reminder-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('test-agent')).toBeInTheDocument();
    expect(screen.getByTestId('storage-badge')).toBeInTheDocument();
    expect(screen.getByTestId('pin-lock')).toBeInTheDocument();
  });
});
