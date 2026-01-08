/**
 * App.tsx - Main Application Component
 * 
 * Orchestrates authentication, routing, and global state.
 * Extracted components: AppProviders, AppRouter
 */

import React from 'react';
import { useDailyRecord, useDateNavigation, useFileOperations, useExistingDaysQuery, useCensusEmail, useSignatureMode, useSharedCensusMode, useAppState, useVersionCheck } from '@/hooks';
import { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { useAuth, AuthContextType } from '@/context/AuthContext';
import { useStorageMigration } from '@/hooks/useStorageMigration';
import { Navbar, DateStrip, SettingsModal, TestAgent, SyncWatcher, DemoModePanel, LoginPage } from '@/components';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import { generateCensusMasterExcel } from '@/services';
import { CensusEmailConfigModal } from '@/components/census/CensusEmailConfigModal';
import { AppProviders } from '@/components/AppProviders';
import { AppRouter } from '@/components/AppRouter';
import { AuditProvider } from '@/context';
import { AppContent } from '@/components/layout/AppContent';
import { CensusProvider, CensusContextType } from '@/context/CensusContext';

// ============================================================================
// Sync Effect - Keeps repository in sync with Firebase connection status
// ============================================================================
const useSyncFirestoreStatus = (isFirebaseConnected: boolean) => {
  React.useEffect(() => {
    import('@/services/repositories/DailyRecordRepository').then(({ setFirestoreEnabled }) => {
      setFirestoreEnabled(isFirebaseConnected);
    });
  }, [isFirebaseConnected]);
};

// ============================================================================
// Nurse Signature - Derives signature from record
// ============================================================================
const useNurseSignature = (record: ReturnType<typeof useDailyRecord>['record']) => {
  return React.useMemo(() => {
    if (!record) return '';
    const nightShift = record.nursesNightShift?.filter(n => n && n.trim()) || [];
    if (nightShift.length > 0) return nightShift.join(' / ');
    return (record.nurses?.filter(n => n && n.trim()) || []).join(' / ');
  }, [record]);
};

// ============================================================================
// Main App Component
// ============================================================================
function App() {
  // Storage migration (runs once on startup)
  useStorageMigration();

  // Version check (auto-refresh on new deployments)
  useVersionCheck();

  // Auth state
  const auth = useAuth();
  useSyncFirestoreStatus(auth.isFirebaseConnected);

  // Date navigation
  const dateNav = useDateNavigation();

  const { isSignatureMode, currentDateString } = useSignatureMode(dateNav.currentDateString, auth.user, auth.isLoading);
  const sharedCensus = useSharedCensusMode();

  // Loading state
  if (auth.isLoading || (sharedCensus.isSharedCensusMode && sharedCensus.isLoading)) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="animate-pulse text-medical-600 text-xl font-bold">Cargando...</div>
      </div>
    );
  }

  // Auth required for main app (NOT shared census mode)
  if (!auth.user && !isSignatureMode && !sharedCensus.isSharedCensusMode) {
    return <LoginPage onLoginSuccess={() => { }} />;
  }

  // If in shared census mode and user needs to login, show login page
  // This is a SEPARATE login flow from the main app
  if (sharedCensus.isSharedCensusMode && sharedCensus.needsLogin) {
    return <LoginPage onLoginSuccess={() => { }} isSharedCensusMode={true} />;
  }

  return (
    <AuditProvider userId={auth.user?.uid || 'anon'}>
      <AppInner
        auth={auth}
        dateNav={{ ...dateNav, isSignatureMode, currentDateString }}
        sharedCensus={sharedCensus}
      />
    </AuditProvider>
  );
}

/**
 * Inner component to handle hook instantiation AFTER providers are balanced
 */
interface AppInnerProps {
  auth: AuthContextType;
  dateNav: UseDateNavigationReturn & { isSignatureMode: boolean; currentDateString: string };
  sharedCensus: ReturnType<typeof useSharedCensusMode>;
}

function AppInner({ auth, dateNav, sharedCensus }: AppInnerProps) {
  const dailyRecordHook = useDailyRecord(dateNav.currentDateString, auth.isOfflineMode, auth.isFirebaseConnected);
  const { record } = dailyRecordHook;

  const { data: existingDaysInMonth = [] } = useExistingDaysQuery(dateNav.selectedYear, dateNav.selectedMonth);
  const nurseSignature = useNurseSignature(record);

  const censusEmail = useCensusEmail({
    record, currentDateString: dateNav.currentDateString, nurseSignature,
    selectedYear: dateNav.selectedYear,
    selectedMonth: dateNav.selectedMonth,
    selectedDay: dateNav.selectedDay,
    user: auth.user, role: auth.role,
  });

  const fileOps = useFileOperations(record, dailyRecordHook.refresh);
  const ui = useAppState();

  // Construct Domain Context Value
  const censusContextValue: CensusContextType = {
    dailyRecord: dailyRecordHook,
    dateNav: {
      ...dateNav,
      existingDaysInMonth: existingDaysInMonth || [],
    },
    fileOps,
    censusEmail,
    nurseSignature,
    sharedCensus
  };

  return (
    <CensusProvider value={censusContextValue}>
      <AppContent ui={ui} />
    </CensusProvider>
  );
}

// Wrap with Global Error Boundary
const AppWithErrorBoundary = () => {
  return (
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  );
};

export default AppWithErrorBoundary;
