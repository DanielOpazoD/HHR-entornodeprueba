import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { AppContent } from '@/components/layout/AppContent';
import {
  ReminderCenterContext,
  unavailableReminderCenterValue,
  useReminderCenter,
} from '@/context/reminderCenterContextContract';

let rejectReminderProvider: (reason: Error) => void;
let resolveReminderProvider: (provider: React.FC<{ children: React.ReactNode }>) => void;
const mockChromeMount = vi.fn();
const mockChromeUnmount = vi.fn();
const StartupChromeProbe = () => {
  const [draft, setDraft] = React.useState('');
  const reminders = useReminderCenter();
  React.useEffect(() => {
    mockChromeMount();
    return () => {
      mockChromeUnmount();
    };
  }, []);
  return (
    <div data-testid="app-content-chrome">
      <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={reminders.openCenter}>Open reminders</button>
      <span data-testid="reminder-open">{String(reminders.isOpen)}</span>
      <span data-testid="reminder-count">{reminders.unreadCount}</span>
    </div>
  );
};
const LoadedReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const value = React.useMemo(
    () => ({
      ...unavailableReminderCenterValue,
      loading: false,
      isAvailable: true,
      unreadCount: 3,
      isOpen,
      openCenter: () => setIsOpen(true),
    }),
    [isOpen]
  );
  return <ReminderCenterContext.Provider value={value}>{children}</ReminderCenterContext.Provider>;
};

const mockUseAppContentRuntime = vi.fn();
const mockUseAppContentShellEffects = vi.fn();
const mockBuildOpenCensusDateHandler = vi.fn();
const mockResolveModuleTheme = vi.fn();
const mockAppContentOverlays = vi.fn();
const mockAppContentChrome = vi.fn();

vi.mock('@/components/AppProviders', () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/context/ReminderCenterContext', () => ({
  ReminderCenterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/app-content/reminderCenterProviderLoader', () => ({
  loadReminderCenterProvider: () =>
    new Promise((resolve, reject) => {
      rejectReminderProvider = reject;
      resolveReminderProvider = resolve;
    }),
}));

vi.mock('@/components/layout/app-content/useAppContentRuntime', () => ({
  useAppContentRuntime: (...args: unknown[]) => mockUseAppContentRuntime(...args),
}));

vi.mock('@/components/layout/app-content/useAppContentShellEffects', () => ({
  useAppContentShellEffects: (...args: unknown[]) => mockUseAppContentShellEffects(...args),
}));

vi.mock('@/components/layout/app-content/appContentCensusDateController', () => ({
  buildOpenCensusDateHandler: (...args: unknown[]) => mockBuildOpenCensusDateHandler(...args),
}));

vi.mock('@/components/layout/app-content/moduleThemeController', () => ({
  resolveModuleTheme: (...args: unknown[]) => mockResolveModuleTheme(...args),
}));

vi.mock('@/components/layout/app-content/AppContentChrome', () => ({
  AppContentChrome: (props: unknown) => {
    mockAppContentChrome(props);
    return <StartupChromeProbe />;
  },
}));

vi.mock('@/components/layout/app-content/AppContentOverlays', () => ({
  AppContentOverlays: (props: unknown) => {
    mockAppContentOverlays(props);
    return <div data-testid="app-content-overlays" />;
  },
}));

describe('AppContent entrypoint wiring', () => {
  const ui = {
    currentModule: 'CENSUS',
    setCurrentModule: vi.fn(),
    censusViewMode: 'REGISTER',
    setCensusViewMode: vi.fn(),
    setSelectedShift: vi.fn(),
  };

  const dateNav = {
    isSignatureMode: false,
    setSelectedYear: vi.fn(),
    setSelectedMonth: vi.fn(),
    setSelectedDay: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildOpenCensusDateHandler.mockImplementation(
      ({
        setCurrentModule,
        setCensusViewMode,
        setSelectedYear,
        setSelectedMonth,
        setSelectedDay,
      }: {
        setCurrentModule: (module: string) => void;
        setCensusViewMode: (mode: string) => void;
        setSelectedYear: (year: number) => void;
        setSelectedMonth: (month: number) => void;
        setSelectedDay: (day: number) => void;
      }) =>
        (isoDate: string) => {
          if (isoDate !== '2026-04-19') {
            return;
          }

          setCurrentModule('CENSUS');
          setCensusViewMode('REGISTER');
          setSelectedYear(2026);
          setSelectedMonth(4);
          setSelectedDay(19);
        }
    );
    mockUseAppContentRuntime.mockReturnValue({
      auth: { role: 'admin' },
      dailyRecordHook: {},
      dateNav,
    });
    mockResolveModuleTheme.mockReturnValue('census');
  });

  it('preserves the mounted chrome and draft when deferred reminders become available', async () => {
    render(<AppContent ui={ui as never} />);
    const input = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.change(input, { target: { value: 'unsaved selection' } });
    await act(async () => resolveReminderProvider(LoadedReminderProvider));
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
    expect(input).toHaveValue('unsaved selection');
    expect(mockChromeMount).toHaveBeenCalledTimes(1);
    expect(mockChromeUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId('reminder-count')).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: 'Open reminders' }));
    expect(screen.getByTestId('reminder-open')).toHaveTextContent('true');
  });

  it('keeps the chrome usable if the optional reminder module fails', async () => {
    render(<AppContent ui={ui as never} />);
    const input = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.change(input, { target: { value: 'keep' } });
    await act(async () => rejectReminderProvider(new Error('chunk unavailable')));
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
    expect(input).toHaveValue('keep');
    expect(mockChromeMount).toHaveBeenCalledTimes(1);
    expect(mockChromeUnmount).not.toHaveBeenCalled();
  });

  it('does not navigate the census date when the selection cannot be resolved', async () => {
    render(<AppContent ui={ui as never} />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    const overlaysProps = mockAppContentOverlays.mock.calls[0][0] as {
      onOpenCensusDate: (isoDate: string) => void;
    };
    overlaysProps.onOpenCensusDate('not-a-date');

    expect(ui.setCurrentModule).not.toHaveBeenCalled();
    expect(ui.setCensusViewMode).not.toHaveBeenCalled();
    expect(dateNav.setSelectedYear).not.toHaveBeenCalled();
    expect(dateNav.setSelectedMonth).not.toHaveBeenCalled();
    expect(dateNav.setSelectedDay).not.toHaveBeenCalled();
  });

  it('navigates the census date through the resolved selection', async () => {
    render(<AppContent ui={ui as never} />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    const overlaysProps = mockAppContentOverlays.mock.calls[0][0] as {
      onOpenCensusDate: (isoDate: string) => void;
    };
    overlaysProps.onOpenCensusDate('2026-04-19');

    expect(ui.setCurrentModule).toHaveBeenCalledWith('CENSUS');
    expect(ui.setCensusViewMode).toHaveBeenCalledWith('REGISTER');
    expect(dateNav.setSelectedYear).toHaveBeenCalledWith(2026);
    expect(dateNav.setSelectedMonth).toHaveBeenCalledWith(4);
    expect(dateNav.setSelectedDay).toHaveBeenCalledWith(19);
  });

  it('shares the same census date handler between chrome and overlays', async () => {
    render(<AppContent ui={ui as never} />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    const chromeProps = mockAppContentChrome.mock.calls[0][0] as {
      onOpenCensusDate: (isoDate: string) => void;
    };
    const overlaysProps = mockAppContentOverlays.mock.calls[0][0] as {
      onOpenCensusDate: (isoDate: string) => void;
    };

    expect(chromeProps.onOpenCensusDate).toBe(overlaysProps.onOpenCensusDate);
  });
});
