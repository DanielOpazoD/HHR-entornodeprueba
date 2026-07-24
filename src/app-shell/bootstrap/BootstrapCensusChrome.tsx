import React from 'react';
import { Loader2 } from 'lucide-react';
import { DateStrip } from '@/components/layout/DateStrip';
import { Navbar } from '@/components/layout/Navbar';
import { ViewLoader } from '@/components/ui/ViewLoader';
import { AuthContext, type AuthContextType, type UserRole } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import type { ModuleType } from '@/constants/navigationConfig';
import { CensusOperationalStateBanner, resolveCensusOperationalState } from '@/features/census';
import {
  resolveModuleFromPathname,
  shouldShowPrintButtonForModule,
} from '@/hooks/controllers/appStateNavigationController';
import { shouldRenderDateStrip } from '@/components/layout/app-content/appContentVisibilityController';
import { broadcastLogout } from '@/services/auth/authBroadcastChannel';
import { markRecentManualLogout } from '@/services/auth/authLogoutState';
import { signOut as firebaseSessionSignOut } from '@/services/auth/authSession';
import {
  clearPersistedFirebaseAuthState,
  clearRecentAuthenticatedSessionHint,
} from '@/services/auth/authStorageHints';
import { clearSessionScopedClientState } from '@/services/storage/sessionScopedStorageService';

const FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
const DEFAULT_BOOTSTRAP_ROLE: UserRole = 'admin';

const noop = () => {};
const noopAsync = async () => {};

/**
 * Real logout for the bootstrap chrome. This shell is visually identical to
 * the authenticated app while the runtime rehydrates, so the logout control
 * must work here too (it used to be a noop, which read as "logout is broken").
 */
let bootstrapLogoutInFlight = false;

const runBootstrapManualLogout = async (): Promise<void> => {
  if (bootstrapLogoutInFlight) return;
  bootstrapLogoutInFlight = true;
  try {
    // Inside the try on purpose: a storage write can throw (private browsing
    // quota, blocked storage), and the user must still leave the shell.
    markRecentManualLogout();
    clearRecentAuthenticatedSessionHint();
    broadcastLogout('manual');
  } catch {
    // Best-effort: storage or broadcast failures must not block logout.
  }

  try {
    // Match the normal logout contract: close Firebase and remove sensitive
    // owner-scoped clinical state before another person uses this browser.
    await Promise.allSettled([firebaseSessionSignOut(), clearSessionScopedClientState('manual')]);
  } finally {
    clearPersistedFirebaseAuthState();
    window.location.replace('/');
    bootstrapLogoutInFlight = false;
  }
};

const BootstrapLogoutOverlay: React.FC = () => (
  <div
    data-testid="bootstrap-logout-overlay"
    role="status"
    aria-live="polite"
    className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 backdrop-blur-sm"
  >
    <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-slate-900/90 px-6 py-4 shadow-2xl">
      <Loader2 size={20} className="animate-spin text-sky-300" />
      <span className="text-sm font-semibold text-white">Cerrando sesión…</span>
    </div>
  </div>
);
const noopSetNumber: React.Dispatch<React.SetStateAction<number>> = () => {};
const noopImportJson: React.ChangeEventHandler<HTMLInputElement> = () => {};
const BOOTSTRAP_CENSUS_VIEW_MODE = 'REGISTER' as const;
const BOOTSTRAP_CENSUS_OPERATIONAL_STATE = resolveCensusOperationalState({
  branch: 'register',
  bootstrapPhase: 'remote_record_bootstrapping',
  syncStatus: 'idle',
  hasRecord: false,
  isAuthenticated: true,
});

const normalizeStorageUser = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const user = value as {
    uid?: unknown;
    email?: unknown;
    displayName?: unknown;
  };

  if (typeof user.uid !== 'string' || user.uid.trim().length === 0) {
    return null;
  }

  return {
    uid: user.uid,
    email: typeof user.email === 'string' ? user.email : null,
    displayName: typeof user.displayName === 'string' ? user.displayName : null,
  };
};

const readPersistedFirebaseAuthUser = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const storages = [window.localStorage, window.sessionStorage];

  for (const storage of storages) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(FIREBASE_AUTH_STORAGE_PREFIX)) {
          continue;
        }

        const parsed = normalizeStorageUser(JSON.parse(storage.getItem(key) ?? 'null'));
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // Ignore malformed storage entries and keep probing.
    }
  }

  return null;
};

const resolveBootstrapDate = () => {
  const today = new Date();
  const fallback = {
    selectedYear: today.getFullYear(),
    selectedMonth: today.getMonth(),
    selectedDay: today.getDate(),
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  const rawDate = new URLSearchParams(window.location.search).get('date');
  if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return fallback;
  }

  const [year, month, day] = rawDate.split('-').map(Number);
  if (!year || !month || !day) {
    return fallback;
  }

  return {
    selectedYear: year,
    selectedMonth: month - 1,
    selectedDay: day,
  };
};

const resolveDaysInMonth = (year: number, monthIndex: number) =>
  new Date(year, monthIndex + 1, 0).getDate();

const resolveBootstrapModule = (): ModuleType => {
  if (typeof window === 'undefined') {
    return 'CENSUS';
  }

  return resolveModuleFromPathname(window.location.pathname) ?? 'CENSUS';
};

const buildBootstrapAuthContextValue = (
  persistedUser: ReturnType<typeof readPersistedFirebaseAuthUser>,
  signOut: AuthContextType['signOut'] = runBootstrapManualLogout
): AuthContextType => {
  const currentUser =
    persistedUser ??
    ({
      uid: 'bootstrap-user',
      email: 'bootstrap@hospital.cl',
      displayName: 'Bootstrap User',
      role: DEFAULT_BOOTSTRAP_ROLE,
    } satisfies NonNullable<AuthContextType['currentUser']>);

  return {
    sessionState: {
      status: 'authorized',
      user: {
        ...currentUser,
        role: DEFAULT_BOOTSTRAP_ROLE,
      },
    },
    authRuntime: {
      sessionStatus: 'authorized',
      authLoading: false,
      isFirebaseConnected: true,
      isOnline: true,
      bootstrapPending: true,
      pendingAgeMs: 0,
      budgetProfile: 'default',
      timeoutMs: 15_000,
      runtimeState: 'recoverable',
      issues: [],
    },
    currentUser: {
      ...currentUser,
      role: DEFAULT_BOOTSTRAP_ROLE,
    },
    authorizedUser: {
      ...currentUser,
      role: DEFAULT_BOOTSTRAP_ROLE,
    },
    user: {
      ...currentUser,
      role: DEFAULT_BOOTSTRAP_ROLE,
    },
    role: DEFAULT_BOOTSTRAP_ROLE,
    isLoading: true,
    isAuthenticated: true,
    isAuthorizedSession: true,
    isAnonymousSignature: false,
    isUnauthorized: false,
    isEditor: true,
    isViewer: false,
    isFirebaseConnected: true,
    remoteSyncStatus: 'ready',
    remoteSyncState: {
      mode: 'enabled',
      reason: 'ready',
    },
    signOut,
  };
};

export const BootstrapRouteChrome: React.FC = () => {
  const [bootstrapDate] = React.useState(resolveBootstrapDate);
  const [bootstrapModule] = React.useState(resolveBootstrapModule);
  const [persistedUser] = React.useState(readPersistedFirebaseAuthUser);
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const handleManualLogout = React.useCallback(async () => {
    setIsLoggingOut(true);
    await runBootstrapManualLogout();
  }, []);
  const authValue = React.useMemo(
    () => buildBootstrapAuthContextValue(persistedUser, handleManualLogout),
    [persistedUser, handleManualLogout]
  );
  const userEmail = persistedUser?.email ?? authValue.currentUser?.email ?? null;
  const daysInMonth = React.useMemo(
    () => resolveDaysInMonth(bootstrapDate.selectedYear, bootstrapDate.selectedMonth),
    [bootstrapDate.selectedMonth, bootstrapDate.selectedYear]
  );
  const currentDateString = `${bootstrapDate.selectedYear}-${String(bootstrapDate.selectedMonth + 1).padStart(2, '0')}-${String(bootstrapDate.selectedDay).padStart(2, '0')}`;
  const renderDateStrip = shouldRenderDateStrip({
    currentModule: bootstrapModule,
    censusViewMode: BOOTSTRAP_CENSUS_VIEW_MODE,
    isSignatureMode: false,
  });
  const canUseCensusChromeActions = bootstrapModule === 'CENSUS';
  const canUseHandoffPrintActions = shouldShowPrintButtonForModule(bootstrapModule);

  return (
    <UIProvider>
      <AuthContext.Provider value={authValue}>
        <div className="min-h-screen bg-slate-100 font-sans flex flex-col print:bg-white print:p-0">
          {isLoggingOut && <BootstrapLogoutOverlay />}
          <Navbar
            currentModule={bootstrapModule}
            setModule={noop}
            censusViewMode={BOOTSTRAP_CENSUS_VIEW_MODE}
            setCensusViewMode={noop}
            onOpenBedManager={noop}
            onExportCSV={noop}
            onImportJSON={noopImportJson}
            userEmail={userEmail}
            onLogout={() => {
              void handleManualLogout();
            }}
            isFirebaseConnected
            hideRuntimeIndicators
          />
          {renderDateStrip && (
            <DateStrip
              selectedYear={bootstrapDate.selectedYear}
              setSelectedYear={noopSetNumber}
              selectedMonth={bootstrapDate.selectedMonth}
              setSelectedMonth={noopSetNumber}
              selectedDay={bootstrapDate.selectedDay}
              setSelectedDay={noopSetNumber}
              currentDateString={currentDateString}
              daysInMonth={daysInMonth}
              existingDaysInMonth={[]}
              navigateDays={noop}
              onExportPDF={canUseHandoffPrintActions ? noop : undefined}
              onExportExcel={canUseCensusChromeActions ? noop : undefined}
              onBackupExcel={canUseCensusChromeActions ? noopAsync : undefined}
              onBackupPDF={canUseHandoffPrintActions ? noopAsync : undefined}
              onConfigureEmail={canUseCensusChromeActions ? noop : undefined}
              onSendEmail={canUseCensusChromeActions ? noop : undefined}
              emailStatus="idle"
              isBackingUp={false}
              currentModule={bootstrapModule}
              onOpenBedManager={bootstrapModule === 'CENSUS' ? noop : undefined}
              onOpenPatientSearch={noop}
              onToggleBookmarks={bootstrapModule === 'CENSUS' ? noop : undefined}
              showBookmarks={false}
              role={DEFAULT_BOOTSTRAP_ROLE}
            />
          )}
          <main className="max-w-screen-2xl mx-auto px-4 pt-4 pb-20 flex-1 w-full print:p-0 print:pb-0 print:max-w-none">
            {bootstrapModule === 'CENSUS' ? (
              <CensusOperationalStateBanner state={BOOTSTRAP_CENSUS_OPERATIONAL_STATE} />
            ) : (
              <ViewLoader />
            )}
          </main>
        </div>
      </AuthContext.Provider>
    </UIProvider>
  );
};

export const BootstrapCensusChrome = BootstrapRouteChrome;
