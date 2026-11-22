import { useWarmDailyRecordSavePath } from '@/hooks/useWarmDailyRecordSavePath';
import React from 'react';
import { FlaskConical } from 'lucide-react';
import { AppContent } from '@/components/layout/AppContent';
import { AppRouter } from '@/app-shell/routing/AppRouter';
import type { AppRouterShellState } from '@/app-shell/routing/appRouterController';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { CensusEmailConfigModal, GlobalPatientSearchModal } from '@/views/LazyViews';
import { CensusProvider } from '@/context/CensusContext';
import type { AuthContextType } from '@/context/AuthContext';
import type { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { DeferredSystemHealthReporter } from '@/app-shell/runtime/DeferredSystemHealthReporter';
import { HandoffExtensionConnection } from './HandoffExtensionConnection';
import { useAuthenticatedAppRuntime } from '@/app-shell/runtime/useAuthenticatedAppRuntime';
import type { CensusQuickActionPatient } from '@/shared/contracts/censusQuickActionPatient';
import type { DateStripRadiologyViewer } from '@/components/layout/date-strip/dateStripRadiologyViewer';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';
import { markPerf } from '@/shared/runtime/perfAudit';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';
import { ClinicalLibraryToolbarFallback } from '@/components/layout/date-strip/CensusToolbarLoadingActions';

const LaboratoryQuickAction = lazyWithRetry(() =>
  import('@/features/laboratory/quick-action').then(module => ({
    default: module.LaboratoryQuickAction,
  }))
);

const ClinicalLibraryQuickAction = lazyWithRetry(() =>
  import('@/features/clinical-library/quick-action').then(module => ({
    default: module.ClinicalLibraryQuickAction,
  }))
);

const RadiologyViewerModal: DateStripRadiologyViewer = lazyWithRetry(() =>
  import('@/features/radiology/components/RadiologyViewerModal').then(module => ({
    default: module.RadiologyViewerModal,
  }))
);

const LaboratoryQuickActionFallback = () => (
  <button
    type="button"
    disabled
    aria-disabled="true"
    tabIndex={-1}
    className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-emerald-200 bg-emerald-50 text-emerald-700 opacity-50`}
    title="Laboratorio / Exámenes Syslab (cargando...)"
  >
    <FlaskConical size={13} />
    <span className="hidden sm:inline">Lab</span>
  </button>
);

const AUTHENTICATED_OVERLAY_VIEWS = {
  CensusEmailConfigModal,
  GlobalPatientSearchModal,
};

const renderAuthenticatedModuleRouter = (ui: UseUIStateReturn, shell: AppRouterShellState) => (
  <AppRouter ui={ui} shell={shell} />
);

interface AuthenticatedAppShellProps {
  auth: AuthContextType;
  dateNav: UseDateNavigationReturn;
}

export const AuthenticatedAppShell = ({ auth, dateNav }: AuthenticatedAppShellProps) => {
  useWarmDailyRecordSavePath();
  const { censusContextValue, ui } = useAuthenticatedAppRuntime({ auth, dateNav });
  React.useEffect(() => {
    markPerf('auth-shell:mounted');
  }, []);

  const renderFeatureQuickActions = React.useCallback(
    (patients: CensusQuickActionPatient[]) => (
      <>
        <React.Suspense fallback={<LaboratoryQuickActionFallback />}>
          <LaboratoryQuickAction patients={patients} />
        </React.Suspense>
      </>
    ),
    []
  );

  const renderCensusTrailingActions = React.useCallback(
    (patients: CensusQuickActionPatient[]) => (
      <React.Suspense fallback={<ClinicalLibraryToolbarFallback />}>
        <ClinicalLibraryQuickAction patients={patients} />
      </React.Suspense>
    ),
    []
  );

  return (
    <CensusProvider value={censusContextValue}>
      <DeferredSystemHealthReporter />
      <HandoffExtensionConnection auth={auth} />
      <AppContent
        ui={ui}
        renderModuleRouter={renderAuthenticatedModuleRouter}
        overlayViews={AUTHENTICATED_OVERLAY_VIEWS}
        renderFeatureQuickActions={renderFeatureQuickActions}
        radiologyViewer={RadiologyViewerModal}
        renderCensusTrailingActions={renderCensusTrailingActions}
      />
    </CensusProvider>
  );
};
