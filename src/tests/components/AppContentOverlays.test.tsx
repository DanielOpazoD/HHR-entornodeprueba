import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import {
  createShellCensusEmailMock,
  createShellModalMock,
  createShellReminderCenterMock,
  createShellRuntimeMock,
  createShellUiMock,
  flushLazyBypassComponents,
} from './appContentTestUtils';

vi.mock('@/utils/lazyWithRetry', async () => {
  const { createLazyWithRetryBypass } = await import('./appContentTestUtils');
  return createLazyWithRetryBypass();
});

import { AppContentOverlays } from '@/components/layout/app-content/AppContentOverlays';
import { useReminderCenter } from '@/hooks/useReminders';

vi.mock('@/components/reminders/ReminderModal', () => ({
  ReminderModal: () => <div data-testid="reminder-modal">ReminderModal</div>,
}));

vi.mock('@/components/debug/TestAgent', () => ({
  TestAgent: () => <div data-testid="test-agent">TestAgent</div>,
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

const overlayViews = {
  CensusEmailConfigModal: () => <div data-testid="email-modal">EmailModal</div>,
  GlobalPatientSearchModal: () => <div data-testid="patient-search-modal">PatientSearchModal</div>,
};

beforeAll(flushLazyBypassComponents);

describe('AppContentOverlays', () => {
  const buildUi = (overrides?: Parameters<typeof createShellUiMock>[0]) =>
    createShellUiMock({ isTestAgentRunning: true, ...overrides });

  const buildRuntime = (showEmailConfig = true) =>
    createShellRuntimeMock({
      censusEmail: createShellCensusEmailMock({ showEmailConfig }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useReminderCenter).mockReturnValue(createShellReminderCenterMock({ isOpen: false }));
  });

  it('mounts active shell overlays and global status components', () => {
    render(
      <AppContentOverlays ui={buildUi()} runtime={buildRuntime()} overlayViews={overlayViews} />
    );

    expect(screen.queryByTestId('reminder-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('test-agent')).toBeInTheDocument();
    expect(screen.queryByTestId('patient-search-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('pin-lock')).toBeInTheDocument();
    expect(screen.getByTestId('storage-badge')).toBeInTheDocument();
    expect(screen.getByTestId('email-modal')).toBeInTheDocument();
  });

  it('loads the reminder modal only when the reminder center is open', () => {
    vi.mocked(useReminderCenter).mockReturnValue(createShellReminderCenterMock({ isOpen: true }));

    render(
      <AppContentOverlays ui={buildUi()} runtime={buildRuntime()} overlayViews={overlayViews} />
    );

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
  });

  it('loads the test agent only while it is running', () => {
    render(
      <AppContentOverlays
        ui={buildUi({ isTestAgentRunning: false })}
        runtime={buildRuntime()}
        overlayViews={overlayViews}
      />
    );

    expect(screen.queryByTestId('test-agent')).not.toBeInTheDocument();
  });

  it('mounts patient search only when the modal is open', () => {
    render(
      <AppContentOverlays
        ui={buildUi({ patientSearchModal: createShellModalMock({ isOpen: true }) })}
        runtime={buildRuntime()}
        overlayViews={overlayViews}
      />
    );

    expect(screen.getByTestId('patient-search-modal')).toBeInTheDocument();
  });

  it('hides the census email config modal when the flag is disabled', () => {
    render(
      <AppContentOverlays
        ui={buildUi()}
        runtime={buildRuntime(false)}
        overlayViews={overlayViews}
      />
    );

    expect(screen.queryByTestId('email-modal')).not.toBeInTheDocument();
  });

  it('opens patient search with the global Ctrl/Cmd+K shortcut', () => {
    const ui = buildUi();
    render(<AppContentOverlays ui={ui} runtime={buildRuntime()} overlayViews={overlayViews} />);

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

    expect(ui.patientSearchModal.toggle).toHaveBeenCalledTimes(1);
  });
});
