import React from 'react';
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

const FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
const DEFAULT_BOOTSTRAP_ROLE: UserRole = 'admin';

const noop = () => {};
const noopAsync = async () => {};
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
  persistedUser: ReturnType<typeof readPersistedFirebaseAuthUser>
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
    signOut: noopAsync,
  };
};

export const BootstrapRouteChrome: React.FC = () => {
  const [bootstrapDate] = React.useState(resolveBootstrapDate);
  const [bootstrapModule] = React.useState(resolveBootstrapModule);
  const [persistedUser] = React.useState(readPersistedFirebaseAuthUser);
  const authValue = React.useMemo(
    () => buildBootstrapAuthContextValue(persistedUser),
    [persistedUser]
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
          <Navbar
            currentModule={bootstrapModule}
            setModule={noop}
            censusViewMode={BOOTSTRAP_CENSUS_VIEW_MODE}
            setCensusViewMode={noop}
            onOpenBedManager={noop}
            onExportCSV={noop}
            onImportJSON={noopImportJson}
            userEmail={userEmail}
            onLogout={noop}
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
