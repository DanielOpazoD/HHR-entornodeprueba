import React from 'react';
import { FlaskConical, FolderOpen } from 'lucide-react';
import { AppContent } from '@/components/layout/AppContent';
import { CensusProvider } from '@/context/CensusContext';
import type { AuthContextType } from '@/context/AuthContext';
import { type AppAuthenticatedDateNavigation } from '@/app-shell/bootstrap/useAppBootstrapState';
import { DeferredSystemHealthReporter } from '@/app-shell/runtime/DeferredSystemHealthReporter';
import { useAuthenticatedAppRuntime } from '@/app-shell/runtime/useAuthenticatedAppRuntime';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { markPerf } from '@/shared/runtime/perfAudit';
import {
  DATE_STRIP_QUICK_ACTION_BASE_CLASS,
  DATE_STRIP_TRAILING_ACTION_BASE_CLASS,
} from '@/shared/ui/dateStripQuickActionStyles';

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

// Misma geometría que el botón real para que la barra de fechas no salte al cargar el chunk.
const ClinicalLibraryToolbarFallback = () => (
  <button
    type="button"
    disabled
    aria-disabled="true"
    tabIndex={-1}
    className={`${DATE_STRIP_TRAILING_ACTION_BASE_CLASS} text-slate-400`}
    aria-label="Documentos"
    title="Documentos y herramientas clínicas (cargando...)"
  >
    <FolderOpen size={15} />
    <span className="hidden md:inline">Documentos</span>
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
      <>
        <React.Suspense fallback={<LaboratoryQuickActionFallback />}>
          <LaboratoryQuickAction patients={patients} />
        </React.Suspense>
      </>
    ),
    []
  );

  const renderCensusTrailingActions = React.useCallback(
    () => (
      <React.Suspense fallback={<ClinicalLibraryToolbarFallback />}>
        <ClinicalLibraryQuickAction />
      </React.Suspense>
    ),
    []
  );

  return (
    <CensusProvider value={censusContextValue}>
      <DeferredSystemHealthReporter />
      <AppContent
        ui={ui}
        renderFeatureQuickActions={renderFeatureQuickActions}
        renderCensusTrailingActions={renderCensusTrailingActions}
      />
    </CensusProvider>
  );
};
