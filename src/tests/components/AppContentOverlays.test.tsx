import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

type LazyBypassProps = Record<string, unknown>;

// Shared state accessible from both vi.mock factory and test code.
const { _lazyPending, _lazyResolved } = vi.hoisted(() => ({
  _lazyPending: [] as Promise<void>[],
  _lazyResolved: new Map<symbol, React.ComponentType<LazyBypassProps>>(),
}));

// Bypass React.lazy so lazy-loaded components render synchronously in tests.
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

import { AppContentOverlays } from '@/components/layout/app-content/AppContentOverlays';
import { useReminderCenter } from '@/hooks/useReminders';

vi.mock('@/components/reminders/ReminderModal', () => ({
  ReminderModal: () => <div data-testid="reminder-modal">ReminderModal</div>,
}));

vi.mock('@/components/debug/TestAgent', () => ({
  TestAgent: () => <div data-testid="test-agent">TestAgent</div>,
}));

vi.mock('@/components/shared/SyncWatcher', () => ({
  SyncWatcher: () => <div data-testid="sync-watcher">SyncWatcher</div>,
}));

vi.mock('@/components/security/PinLockScreen', () => ({
  PinLockScreen: () => <div data-testid="pin-lock">PinLockScreen</div>,
}));

vi.mock('@/components/layout/StorageStatusBadge', () => ({
  default: () => <div data-testid="storage-badge">StorageStatusBadge</div>,
}));

vi.mock('@/hooks/useReminders', () => ({
  useReminderCenter: vi.fn(),
}));

vi.mock('@/views/LazyViews', () => ({
  CensusEmailConfigModal: () => <div data-testid="email-modal">EmailModal</div>,
}));

vi.mock('@/features/census/public-components', () => ({
  GlobalPatientSearchModal: () => <div data-testid="patient-search-modal">PatientSearchModal</div>,
  CensusView: () => <div data-testid="census-view">CensusView</div>,
  CensusEmailConfigModal: () => <div data-testid="email-modal">EmailModal</div>,
}));

// Flush lazy component resolutions before any test renders.
beforeAll(() => Promise.all(_lazyPending));

describe('AppContentOverlays', () => {
  const ui = {
    settingsModal: { isOpen: true, open: vi.fn(), close: vi.fn() },
    patientSearchModal: { isOpen: false, open: vi.fn(), close: vi.fn(), toggle: vi.fn() },
    isTestAgentRunning: true,
    setIsTestAgentRunning: vi.fn(),
  } as const;

  const runtime = {
    censusEmail: {
      showEmailConfig: true,
      setShowEmailConfig: vi.fn(),
      recipients: [],
      setRecipients: vi.fn(),
      recipientLists: [],
      activeRecipientListId: null,
      setActiveRecipientListId: vi.fn(),
      createRecipientList: vi.fn(),
      renameActiveRecipientList: vi.fn(),
      deleteRecipientList: vi.fn(),
      recipientsSource: 'local',
      isRecipientsSyncing: false,
      recipientsSyncError: null,
      message: '',
      onMessageChange: vi.fn(),
      onResetMessage: vi.fn(),
      isAdminUser: true,
      testModeEnabled: false,
      setTestModeEnabled: vi.fn(),
      testRecipient: '',
      setTestRecipient: vi.fn(),
    },
    dateNav: {
      currentDateString: '2026-03-27',
    },
    nurseSignature: 'Night Nurse',
    record: { date: '2026-03-27' },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useReminderCenter).mockReturnValue({ isOpen: false } as never);
  });

  it('mounts active shell overlays and global status components', () => {
    render(<AppContentOverlays ui={ui as never} runtime={runtime as never} />);

    expect(screen.queryByTestId('reminder-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('test-agent')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-search-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('sync-watcher')).toBeInTheDocument();
    expect(screen.getByTestId('pin-lock')).toBeInTheDocument();
    expect(screen.getByTestId('storage-badge')).toBeInTheDocument();
    expect(screen.getByTestId('email-modal')).toBeInTheDocument();
  });

  it('loads the reminder modal only when the reminder center is open', () => {
    vi.mocked(useReminderCenter).mockReturnValue({ isOpen: true } as never);

    render(<AppContentOverlays ui={ui as never} runtime={runtime as never} />);

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
  });

  it('loads the test agent only while it is running', () => {
    render(
      <AppContentOverlays
        ui={
          {
            ...ui,
            isTestAgentRunning: false,
          } as never
        }
        runtime={runtime as never}
      />
    );

    expect(screen.queryByTestId('test-agent')).not.toBeInTheDocument();
  });

  it('mounts patient search only when the modal is open', () => {
    render(
      <AppContentOverlays
        ui={
          {
            ...ui,
            patientSearchModal: { ...ui.patientSearchModal, isOpen: true },
          } as never
        }
        runtime={runtime as never}
      />
    );

    expect(screen.getByTestId('patient-search-modal')).toBeInTheDocument();
  });

  it('hides the census email config modal when the flag is disabled', () => {
    render(
      <AppContentOverlays
        ui={ui as never}
        runtime={
          {
            ...runtime,
            censusEmail: { ...runtime.censusEmail, showEmailConfig: false },
          } as never
        }
      />
    );

    expect(screen.queryByTestId('email-modal')).not.toBeInTheDocument();
  });

  it('opens patient search with the global Ctrl/Cmd+K shortcut', () => {
    render(<AppContentOverlays ui={ui as never} runtime={runtime as never} />);

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

    expect(ui.patientSearchModal.toggle).toHaveBeenCalledTimes(1);
  });
});
