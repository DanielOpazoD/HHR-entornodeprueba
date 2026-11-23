import React from 'react';
import { UseUIStateReturn } from '@/hooks/useUIState';
import { AppContentChrome } from '@/components/layout/app-content/AppContentChrome';
import { useAppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import { useAppContentShellEffects } from '@/components/layout/app-content/useAppContentShellEffects';
import { buildOpenCensusDateHandler } from '@/components/layout/app-content/appContentCensusDateController';
import type { ModuleType } from '@/constants/navigationConfig';
import {
  loadReminderCenterProvider,
  type ReminderCenterProviderComponent,
} from '@/components/layout/app-content/reminderCenterProviderLoader';

const resolveModuleTheme = (mod: ModuleType): 'census' | 'nursing-handoff' =>
  mod === 'NURSING_HANDOFF' || mod === 'CUDYR' ? 'nursing-handoff' : 'census';
import type { CensusQuickActionPatient } from '@/shared/contracts/censusQuickActionPatient';
import type { DateStripRadiologyViewer } from '@/components/layout/date-strip/dateStripRadiologyViewer';
import type { AppRouterShellState } from '@/app-shell/routing/appRouterController';
import type { AppContentOverlayViews } from '@/components/layout/app-content/AppContentOverlays';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';
import {
  ReminderCenterContext,
  unavailableReminderCenterValue,
  useReminderCenter,
  type ReminderCenterContextValue,
} from '@/context/reminderCenterContextContract';

const AppContentOverlays = lazyWithRetry(() =>
  import('@/components/layout/app-content/AppContentOverlays').then(module => ({
    default: module.AppContentOverlays,
  }))
);

interface AppContentProps {
  ui: UseUIStateReturn;
  renderModuleRouter?: (ui: UseUIStateReturn, shell: AppRouterShellState) => React.ReactNode;
  overlayViews?: AppContentOverlayViews;
  renderFeatureQuickActions?: (patients: CensusQuickActionPatient[]) => React.ReactNode;
  radiologyViewer?: DateStripRadiologyViewer;
  /** Acciones visibles al extremo derecho de la barra de fechas del censo (p. ej. «Documentos»). */
  renderCensusTrailingActions?: (patients: CensusQuickActionPatient[]) => React.ReactNode;
}

// Publish the deferred runtime through a provider that is present from the first
// render. Inserting the loaded provider around the chrome remounts the census.
const ReminderCenterValueBridge = ({
  onChange,
}: {
  onChange: (value: ReminderCenterContextValue) => void;
}) => {
  const value = useReminderCenter();
  React.useEffect(() => onChange(value), [value, onChange]);
  return null;
};

const DeferredReminderCenterProvider: ReminderCenterProviderComponent = ({ children }) => {
  const [Provider, setProvider] = React.useState<ReminderCenterProviderComponent | null>(null);

  const [value, setValue] = React.useState(unavailableReminderCenterValue);

  React.useEffect(() => {
    let mounted = true;
    void loadReminderCenterProvider()
      .then(provider => {
        if (mounted) setProvider(() => provider);
      })
      .catch(() => {
        // Optional reminders must not interrupt the authenticated clinical shell.
        if (mounted) setValue({ ...unavailableReminderCenterValue, loading: false });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <ReminderCenterContext.Provider value={value}>
      {Provider ? (
        <Provider>
          <ReminderCenterValueBridge onChange={setValue} />
        </Provider>
      ) : null}
      {children}
    </ReminderCenterContext.Provider>
  );
};

export const AppContent: React.FC<AppContentProps> = ({
  ui,
  renderModuleRouter,
  overlayViews,
  renderFeatureQuickActions,
  radiologyViewer,
  renderCensusTrailingActions,
}) => {
  const runtime = useAppContentRuntime({ ui });
  const { auth, dateNav } = runtime;

  const openCensusDate = React.useMemo(
    () =>
      buildOpenCensusDateHandler({
        setCurrentModule: ui.setCurrentModule,
        setCensusViewMode: ui.setCensusViewMode,
        setSelectedYear: dateNav.setSelectedYear,
        setSelectedMonth: dateNav.setSelectedMonth,
        setSelectedDay: dateNav.setSelectedDay,
      }),
    [
      dateNav.setSelectedDay,
      dateNav.setSelectedMonth,
      dateNav.setSelectedYear,
      ui.setCensusViewMode,
      ui.setCurrentModule,
    ]
  );

  useAppContentShellEffects({
    role: auth.role,
    currentModule: ui.currentModule,
    setCurrentModule: ui.setCurrentModule,
    setSelectedShift: ui.setSelectedShift,
  });

  return (
    <DeferredReminderCenterProvider>
      <div
        data-module={resolveModuleTheme(ui.currentModule)}
        className="min-h-screen bg-slate-100 font-sans flex flex-col print:bg-white print:p-0"
      >
        <AppContentChrome
          ui={ui}
          runtime={runtime}
          onOpenCensusDate={openCensusDate}
          renderModuleRouter={renderModuleRouter}
          renderFeatureQuickActions={renderFeatureQuickActions}
          radiologyViewer={radiologyViewer}
          renderCensusTrailingActions={renderCensusTrailingActions}
        />
        <React.Suspense fallback={null}>
          <AppContentOverlays
            ui={ui}
            runtime={runtime}
            onOpenCensusDate={openCensusDate}
            overlayViews={overlayViews}
          />
        </React.Suspense>
      </div>
    </DeferredReminderCenterProvider>
  );
};
