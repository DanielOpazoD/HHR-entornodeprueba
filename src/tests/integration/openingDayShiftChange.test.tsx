import { act, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { markRecentAuthenticatedSessionHint } from '@/services/auth/authStorageHints';

/*
 * A page opened just before a shift change keeps the day it opened on: the header painted before
 * sign-in and the census that loads after it read the same day, even when the clock crosses the
 * rollover while the app is still starting (W21-DATE2). Moving to another day afterwards stays
 * the user's action ("Hoy" or the date strip).
 */
const startup = vi.hoisted(() => ({ gate: Promise.withResolvers<{ status: string }>() }));
const reads = vi.hoisted(() => [] as string[]);

vi.mock('@/app-shell/bootstrap/bootstrapAppRuntime', () => ({
  reconcileBootstrapRuntime: () => startup.gate.promise,
  resolveFirebaseBootstrapRuntime: async () => ({ status: 'ready' }),
}));
const auth = vi.hoisted(() => ({
  sessionState: { status: 'authorized' },
  isAuthenticated: true,
  isLoading: false,
  currentUser: { uid: 'synthetic-opening-day' },
  remoteSyncState: { mode: 'local_only' },
  remoteSyncStatus: 'disabled',
  authRuntime: {},
}));
vi.mock('@/context/AuthContext', async importOriginal => ({
  ...(await importOriginal<object>()),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => auth,
}));
vi.mock('@/components/layout/AuthSessionOverlays', () => ({ AuthSessionOverlays: () => null }));
vi.mock('@/components/ui/FunctionsRecovery', () => ({ FunctionsRecovery: () => null }));
vi.mock('@/context/AuditContext', async importOriginal => ({
  ...(await importOriginal<object>()),
  AuditProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/shared/VersionMismatchOverlay', () => ({
  VersionMismatchOverlay: () => null,
}));
vi.mock('@/app-shell/bootstrap/useVersionCheck', () => ({ useVersionCheck: () => {} }));
vi.mock('@/hooks/useStorageMigration', () => ({ useStorageMigration: () => {} }));
vi.mock('@/hooks/useStalenessGuard', () => ({ useStalenessGuard: () => {} }));
vi.mock('@/hooks/useWarmDailyRecordSavePath', () => ({ useWarmDailyRecordSavePath: () => {} }));
vi.mock('@/app-shell/runtime/DeferredSystemHealthReporter', () => ({
  DeferredSystemHealthReporter: () => null,
}));
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }));
vi.mock('@/components/layout/AppContent', () => ({
  AppContent: () => <div>Registro abierto</div>,
}));
vi.mock('@/hooks/useStaleDayEditGuard', () => ({ useStaleDayEditGuard: () => async () => true }));
vi.mock('@/hooks/useExistingDaysQuery', () => ({ useExistingDaysQuery: () => ({ data: [] }) }));
vi.mock('@/features/census/email/hooks/useCensusEmail', () => ({ useCensusEmail: () => ({}) }));
vi.mock('@/hooks/useFileOperations', () => ({ useFileOperations: () => ({}) }));
vi.mock('@/hooks/useDailyRecord', () => ({
  useDailyRecord: (date: string) => {
    reads.push(date);
    return { record: undefined, refresh: () => {} };
  },
}));

afterEach(() => {
  vi.useRealTimers();
  reads.length = 0;
  vi.resetModules();
});

it.each([
  // Friday 20 November 2026, Rapa Nui (UTC-5): the business-day shift starts at 08:00.
  ['/census', '2026-11-20T12:59:59Z', '2026-11-20T13:00:00Z', 19],
  ['/census?date=2026-02-30', '2026-11-20T12:59:59Z', '2026-11-20T13:00:00Z', 19],
  // Saturday 21 November: the weekend shift starts at 09:00.
  ['/census', '2026-11-21T13:59:59Z', '2026-11-21T14:00:00Z', 20],
  // Midnight inside the night shift: still the 19th on both sides.
  ['/census', '2026-11-20T04:59:59Z', '2026-11-20T05:00:00Z', 19],
  ['/census?date=2024-02-29', '2026-11-20T12:59:59Z', '2026-11-20T13:00:00Z', 29],
])(
  'opening %s at %s and starting at %s shows and loads the same day',
  async (route, openedAt, startedAt, day) => {
    const expectedDay = day === 29 ? '2024-02-29' : `2026-11-${day}`;
    startup.gate = Promise.withResolvers();
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, '', route);
    markRecentAuthenticatedSessionHint();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(openedAt));
    await act(async () => {
      await import('@/index');
    });
    const header = document.querySelector<HTMLButtonElement>(
      '.hhr-toolbar-day[aria-pressed="true"]'
    );
    expect(header?.title).toContain(`${day} de`);

    vi.setSystemTime(new Date(startedAt));
    await act(async () => {
      startup.gate.resolve({ status: 'ready' });
    });
    await waitFor(() => expect(reads.length).toBeGreaterThan(0), { timeout: 10_000 });

    expect([...new Set(reads)]).toEqual([expectedDay]);
    // The URL is written by an effect after the render that asks for the day: wait for it.
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get('date')).toBe(expectedDay)
    );
  }
);
