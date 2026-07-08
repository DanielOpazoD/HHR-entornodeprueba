import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextType } from '@/context';
import type { FirestoreSyncState } from '@/services/repositories/repositoryConfig';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';

const {
  mockUseAppState,
  mockUseCensusEmail,
  mockUseDailyRecord,
  mockUseExistingDaysQuery,
  mockUseFileOperations,
  mockResolveShiftNurseSignature,
} = vi.hoisted(() => ({
  mockUseAppState: vi.fn(),
  mockUseCensusEmail: vi.fn(),
  mockUseDailyRecord: vi.fn(),
  mockUseExistingDaysQuery: vi.fn(),
  mockUseFileOperations: vi.fn(),
  mockResolveShiftNurseSignature: vi.fn(),
}));

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => mockUseAppState(),
}));

vi.mock('@/hooks/useCensusEmail', () => ({
  useCensusEmail: (...args: unknown[]) => mockUseCensusEmail(...args),
}));

vi.mock('@/hooks/useDailyRecord', () => ({
  useDailyRecord: (...args: unknown[]) => mockUseDailyRecord(...args),
}));

vi.mock('@/hooks/useExistingDaysQuery', () => ({
  useExistingDaysQuery: (...args: unknown[]) => mockUseExistingDaysQuery(...args),
}));

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: (...args: unknown[]) => mockUseFileOperations(...args),
}));

vi.mock('@/services/staff/dailyRecordStaffing', () => ({
  resolveShiftNurseSignature: (...args: unknown[]) => mockResolveShiftNurseSignature(...args),
}));

// Provider-dependent; the runtime builds it inside UI + audit providers. Stub it so
// the hook can render without those providers in this unit test.
vi.mock('@/hooks/useStaleDayEditGuard', () => ({
  useStaleDayEditGuard: () => async () => true,
}));

import {
  buildAuthenticatedAppRuntime,
  buildAuthenticatedCensusContextValue,
  resolveExistingDaysInMonth,
  useAuthenticatedAppRuntime,
} from '@/app-shell/runtime/useAuthenticatedAppRuntime';

const createAuthorizedUser = (): AuthUser => ({
  uid: 'user-1',
  email: 'admin@hospital.cl',
  displayName: 'Admin User',
  role: 'admin',
});

const createAuthState = (overrides: Partial<AuthContextType> = {}): AuthContextType => {
  const authorizedUser = createAuthorizedUser();
  const sessionState: AuthSessionState = { status: 'authorized', user: authorizedUser };
  const remoteSyncState: FirestoreSyncState = { mode: 'enabled', reason: 'ready' };

  return {
    sessionState,
    authRuntime: {} as never,
    currentUser: authorizedUser,
    authorizedUser,
    user: authorizedUser,
    role: 'admin',
    isLoading: false,
    isAuthenticated: true,
    isAuthorizedSession: true,
    isAnonymousSignature: false,
    isUnauthorized: false,
    isEditor: true,
    isViewer: false,
    isFirebaseConnected: true,
    remoteSyncStatus: 'ready',
    remoteSyncState,
    signOut: vi.fn(),
    ...overrides,
  };
};

const createDateNavigation = (overrides: Record<string, unknown> = {}) => ({
  selectedYear: 2026,
  setSelectedYear: vi.fn(),
  selectedMonth: 2,
  setSelectedMonth: vi.fn(),
  selectedDay: 27,
  setSelectedDay: vi.fn(),
  daysInMonth: 31,
  currentDateString: '2026-03-27',
  navigateDays: vi.fn(),
  isSignatureMode: false,
  ...overrides,
});

describe('useAuthenticatedAppRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockUseDailyRecord.mockReturnValue({
      record: { date: '2026-03-27', beds: {} },
      refresh: vi.fn(),
    });
    mockUseExistingDaysQuery.mockReturnValue({ data: [1, 4, 8] });
    mockResolveShiftNurseSignature.mockReturnValue('Night Nurse');
    mockUseCensusEmail.mockReturnValue({ sendEmail: vi.fn(), status: 'idle' });
    mockUseFileOperations.mockReturnValue({ handleExportJSON: vi.fn() });
    mockUseAppState.mockReturnValue({ currentModule: 'CENSUS' });
  });

  it('builds the authenticated runtime and preserves the current wiring inputs', () => {
    const auth = createAuthState();
    const dateNav = createDateNavigation();

    const { result } = renderHook(() => useAuthenticatedAppRuntime({ auth, dateNav }));

    expect(mockUseDailyRecord).toHaveBeenCalledWith(
      '2026-03-27',
      false,
      'ready',
      expect.any(Function)
    );
    expect(mockUseExistingDaysQuery).toHaveBeenCalledWith(2026, 2, { enabled: true });
    expect(mockResolveShiftNurseSignature).toHaveBeenCalledWith(
      mockUseDailyRecord.mock.results[0]?.value.record,
      'night'
    );
    expect(mockUseCensusEmail).toHaveBeenCalledWith({
      record: mockUseDailyRecord.mock.results[0]?.value.record,
      currentDateString: '2026-03-27',
      nurseSignature: 'Night Nurse',
      selectedYear: 2026,
      selectedMonth: 2,
      selectedDay: 27,
      user: auth.currentUser,
      role: auth.role,
      enabled: true,
    });
    expect(mockUseFileOperations).toHaveBeenCalledWith(
      mockUseDailyRecord.mock.results[0]?.value.record,
      mockUseDailyRecord.mock.results[0]?.value.refresh
    );
    expect(result.current.existingDaysInMonth).toEqual([1, 4, 8]);
    expect(result.current.nurseSignature).toBe('Night Nurse');
    expect(result.current.censusContextValue.dateNav.existingDaysInMonth).toEqual([1, 4, 8]);
    expect(result.current.censusContextValue.nurseSignature).toBe('Night Nurse');
  });

  it('defaults existing days to an empty list when the query has not resolved yet', () => {
    mockUseExistingDaysQuery.mockReturnValue({ data: undefined });

    const { result } = renderHook(() =>
      useAuthenticatedAppRuntime({
        auth: createAuthState(),
        dateNav: createDateNavigation(),
      })
    );

    expect(result.current.existingDaysInMonth).toEqual([]);
    expect(result.current.censusContextValue.dateNav.existingDaysInMonth).toEqual([]);
  });

  it('disables census-only runtime extras outside the census module', () => {
    mockUseAppState.mockReturnValue({ currentModule: 'NURSING_HANDOFF' });

    renderHook(() =>
      useAuthenticatedAppRuntime({
        auth: createAuthState(),
        dateNav: createDateNavigation(),
      })
    );

    expect(mockUseExistingDaysQuery).toHaveBeenCalledWith(2026, 2, { enabled: false });
    expect(mockUseCensusEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      })
    );
  });

  it('resolveExistingDaysInMonth returns a stable empty list fallback', () => {
    expect(resolveExistingDaysInMonth(undefined)).toEqual([]);
    expect(resolveExistingDaysInMonth([2, 5])).toEqual([2, 5]);
  });

  it('buildAuthenticatedCensusContextValue wires the census context without hook execution', () => {
    const dailyRecordHook = {
      record: { date: '2026-03-27', beds: {} },
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof mockUseDailyRecord>;
    const dateNav = createDateNavigation();
    const fileOps = { handleExportJSON: vi.fn() } as ReturnType<typeof mockUseFileOperations>;
    const censusEmail = { sendEmail: vi.fn(), status: 'idle' } as ReturnType<
      typeof mockUseCensusEmail
    >;

    const goToClinicalToday = vi.fn();
    const result = buildAuthenticatedCensusContextValue({
      dailyRecordHook,
      dateNav,
      existingDaysInMonth: [1, 4, 8],
      clinicalToday: '2026-03-27',
      goToClinicalToday,
      fileOps,
      censusEmail,
      nurseSignature: 'Night Nurse',
    });

    expect(result.dailyRecord).toBe(dailyRecordHook);
    expect(result.dateNav.existingDaysInMonth).toEqual([1, 4, 8]);
    expect(result.dateNav.clinicalToday).toBe('2026-03-27');
    expect(result.dateNav.goToClinicalToday).toBe(goToClinicalToday);
    expect(result.fileOps).toBe(fileOps);
    expect(result.censusEmail).toBe(censusEmail);
    expect(result.nurseSignature).toBe('Night Nurse');
  });

  it('buildAuthenticatedAppRuntime keeps the runtime payload aligned with the context payload', () => {
    const dailyRecordHook = {
      record: { date: '2026-03-27', beds: {} },
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof mockUseDailyRecord>;
    const dateNav = createDateNavigation();
    const fileOps = { handleExportJSON: vi.fn() } as ReturnType<typeof mockUseFileOperations>;
    const censusEmail = { sendEmail: vi.fn(), status: 'idle' } as ReturnType<
      typeof mockUseCensusEmail
    >;
    const ui = { currentModule: 'CENSUS' } as ReturnType<typeof mockUseAppState>;

    const result = buildAuthenticatedAppRuntime({
      dailyRecordHook,
      dateNav,
      existingDaysInMonth: [3, 9],
      clinicalToday: '2026-03-27',
      goToClinicalToday: vi.fn(),
      fileOps,
      censusEmail,
      nurseSignature: 'Night Nurse',
      ui,
    });

    expect(result.existingDaysInMonth).toEqual([3, 9]);
    expect(result.ui).toBe(ui);
    expect(result.censusContextValue.dateNav.existingDaysInMonth).toEqual([3, 9]);
    expect(result.censusContextValue.nurseSignature).toBe('Night Nurse');
    expect(result.censusContextValue.fileOps).toBe(fileOps);
  });
});
