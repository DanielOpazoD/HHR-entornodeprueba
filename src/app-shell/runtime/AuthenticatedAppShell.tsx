import React from 'react';
import { FlaskConical } from 'lucide-react';
import { AppContent } from '@/components/layout/AppContent';
import { CensusProvider } from '@/context/CensusContext';
import type { AuthContextType } from '@/context/AuthContext';
import { type AppAuthenticatedDateNavigation } from '@/app-shell/bootstrap/useAppBootstrapState';
import { DeferredSystemHealthReporter } from '@/app-shell/runtime/DeferredSystemHealthReporter';
import { useAuthenticatedAppRuntime } from '@/app-shell/runtime/useAuthenticatedAppRuntime';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { markPerf } from '@/shared/runtime/perfAudit';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';

const LaboratoryQuickAction = lazyWithRetry(() =>
  import('@/features/laboratory').then(module => ({
    default: module.LaboratoryQuickAction,
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

interface AuthenticatedAppShellProps {
  auth: AuthContextType;
  dateNav: AppAuthenticatedDateNavigation;
}

export const AuthenticatedAppShell = ({ auth, dateNav }: AuthenticatedAppShellProps) => {
  const { censusContextValue, ui } = useAuthenticatedAppRuntime({ auth, dateNav });
  React.useEffect(() => {
    markPerf('auth-shell:mounted');
  }, []);

  const renderFeatureQuickActions = React.useCallback(
    (patients: MedicalIndicationsPatientOption[]) => (
      <React.Suspense fallback={<LaboratoryQuickActionFallback />}>
        <LaboratoryQuickAction patients={patients} />
      </React.Suspense>
    ),
    []
  );

  return (
    <CensusProvider value={censusContextValue}>
      <DeferredSystemHealthReporter />
      <AppContent ui={ui} renderFeatureQuickActions={renderFeatureQuickActions} />
    </CensusProvider>
  );
};
