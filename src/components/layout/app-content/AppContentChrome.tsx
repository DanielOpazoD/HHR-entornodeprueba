import { CensusConflictMenuFallback } from '@/components/layout/date-strip/CensusToolbarLoadingActions';
import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { DateStrip } from '@/components/layout/DateStrip';
import { CensusStaleDayBanner } from '@/components/layout/app-content/CensusStaleDayBanner';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { Search, BarChart3 } from 'lucide-react';
import { CensusToolbarMenuTargetContext } from '@/context/CensusToolbarMenuTargetContext';
import { CensusOptionsMenu } from '@/components/layout/date-strip/CensusOptionsMenu';
import { isSpecialistCensusAccessProfile } from '@/shared/access/censusAccessProfile';
import {
  canAccessAppModuleRoute,
  canManageClinicalConflictCenter,
} from '@/shared/access/operationalAccessPolicy';

const CensusConflictQuickAction = lazyWithRetry(() =>
  import('@/components/clinical-conflicts/CensusConflictQuickAction').then(module => ({
    default: module.CensusConflictQuickAction,
  }))
);
const CensusQuickActions = lazyWithRetry(() =>
  import('@/components/layout/date-strip/DateStripQuickActions').then(module => ({
    default: module.DateStripQuickActions,
  }))
);

const BookmarkBar = lazyWithRetry(() =>
  import('@/components/bookmarks/BookmarkBar').then(m => ({ default: m.BookmarkBar }))
);
import {
  shouldRenderBookmarkBar,
  shouldRenderDateStrip,
} from '@/components/layout/app-content/appContentVisibilityController';
import {
  buildAppRouterShellState,
  buildDateStripProps,
  buildNavbarProps,
  buildCensusQuickActionPatients,
} from '@/components/layout/app-content/appContentChromeController';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { AppRouterShellState } from '@/app-shell/routing/appRouterController';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import type { CensusQuickActionPatient } from '@/shared/contracts/censusQuickActionPatient';
import type { DateStripRadiologyViewer } from '@/components/layout/date-strip/dateStripRadiologyViewer';

export interface AppContentChromeProps {
  ui: UseUIStateReturn;
  runtime: AppContentRuntime;
  onOpenCensusDate?: (date: string) => void;
  renderModuleRouter?: (ui: UseUIStateReturn, shell: AppRouterShellState) => React.ReactNode;
  renderFeatureQuickActions?: (patients: CensusQuickActionPatient[]) => React.ReactNode;
  radiologyViewer?: DateStripRadiologyViewer;
  renderCensusTrailingActions?: (patients: CensusQuickActionPatient[]) => React.ReactNode;
}

export const AppContentChrome: React.FC<AppContentChromeProps> = ({
  ui,
  runtime,
  onOpenCensusDate,
  renderModuleRouter,
  renderFeatureQuickActions,
  radiologyViewer,
  renderCensusTrailingActions,
}) => {
  const { auth } = runtime;
  const [handoffTarget, setHandoffTarget] = React.useState<HTMLDivElement | null>(null);

  const censusQuickActionPatients = React.useMemo<CensusQuickActionPatient[]>(() => {
    return buildCensusQuickActionPatients(runtime.record);
  }, [runtime.record]);
  const dateStripProps = buildDateStripProps({
    ui,
    runtime,
    censusQuickActionPatients,
    renderFeatureQuickActions,
    radiologyViewer,
  });
  const navbarProps = buildNavbarProps({ ui, runtime });
  const appRouterShellState = buildAppRouterShellState({ ui, runtime, onOpenCensusDate });

  const showDateStrip = shouldRenderDateStrip({
    currentModule: ui.currentModule,
    censusViewMode: ui.censusViewMode,
  });

  return (
    <>
      <Navbar {...navbarProps} />

      <div className="census-operational-chrome contents">
        {showDateStrip && (
          <DateStrip
            {...dateStripProps}
            hideQuickActions={ui.currentModule === 'CENSUS'}
            trailingActions={
              ui.currentModule === 'CENSUS' ? (
                <>
                  {renderCensusTrailingActions?.(censusQuickActionPatients)}
                  <CensusOptionsMenu>
                    {dateStripProps.onOpenPatientSearch && (
                      <button
                        type="button"
                        data-census-menu-action
                        onClick={dateStripProps.onOpenPatientSearch}
                        title="Buscar paciente (Ctrl+K)"
                        className="flex items-center gap-2 rounded-md text-slate-600"
                      >
                        <Search size={14} />
                        Buscar paciente
                      </button>
                    )}
                    <React.Suspense
                      fallback={<span className="text-xs text-slate-500">Cargando opciones…</span>}
                    >
                      <CensusQuickActions
                        menuLayout
                        hideClinicalQuickActions
                        onOpenBedManager={
                          isSpecialistCensusAccessProfile(dateStripProps.accessProfile ?? 'default')
                            ? undefined
                            : dateStripProps.onOpenBedManager
                        }
                      />
                    </React.Suspense>
                    {canAccessAppModuleRoute({ role: auth.role, module: 'CUDYR' }) && (
                      <button
                        type="button"
                        data-census-menu-action
                        // The census stays until CUDYR is ready; a fallback shown first would make
                        // React hold the view back 300 ms.
                        onClick={() => React.startTransition(() => ui.setCurrentModule('CUDYR'))}
                        className="flex items-center gap-2 rounded-md text-teal-800"
                      >
                        <BarChart3 size={14} />
                        CUDYR · control diario
                      </button>
                    )}
                    {canManageClinicalConflictCenter(auth.role) && (
                      <React.Suspense fallback={<CensusConflictMenuFallback />}>
                        <CensusConflictQuickAction />
                      </React.Suspense>
                    )}
                    <div ref={setHandoffTarget} />
                  </CensusOptionsMenu>
                </>
              ) : undefined
            }
          />
        )}

        {showDateStrip &&
          ui.currentModule === 'CENSUS' &&
          dateStripProps.clinicalToday &&
          dateStripProps.goToClinicalToday && (
            <CensusStaleDayBanner
              currentDateString={dateStripProps.currentDateString}
              clinicalToday={dateStripProps.clinicalToday}
              onGoToToday={dateStripProps.goToClinicalToday}
            />
          )}

        {shouldRenderBookmarkBar({
          currentModule: ui.currentModule,
          censusViewMode: ui.censusViewMode,
          showBookmarksBar: ui.showBookmarksBar,
          role: auth.role,
        }) && (
          <React.Suspense fallback={null}>
            <BookmarkBar />
          </React.Suspense>
        )}
      </div>
      <main className="max-w-screen-2xl mx-auto px-4 pt-4 pb-20 flex-1 w-full print:p-0 print:pb-0 print:max-w-none">
        <CensusToolbarMenuTargetContext.Provider value={handoffTarget}>
          {renderModuleRouter?.(ui, appRouterShellState)}
        </CensusToolbarMenuTargetContext.Provider>
      </main>
    </>
  );
};
