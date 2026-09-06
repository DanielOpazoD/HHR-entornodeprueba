import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { DateStrip } from '@/components/layout/DateStrip';
import { CensusStaleDayBanner } from '@/components/layout/app-content/CensusStaleDayBanner';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { AppRouter } from '@/components/AppRouter';
import { Search } from 'lucide-react';
import { CensusToolbarMenuTargetContext } from '@/shared/ui/CensusToolbarMenuTargetContext';
import { CensusOptionsMenu } from '@/components/layout/date-strip/CensusOptionsMenu';
import { isSpecialistCensusAccessProfile } from '@/shared/access/censusAccessProfile';

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
  buildMedicalIndicationsPatientOptions,
} from '@/components/layout/app-content/appContentChromeController';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { AppContentRuntime } from '@/components/layout/app-content/useAppContentRuntime';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';

export interface AppContentChromeProps {
  ui: UseUIStateReturn;
  runtime: AppContentRuntime;
  onOpenCensusDate?: (date: string) => void;
  renderFeatureQuickActions?: (patients: MedicalIndicationsPatientOption[]) => React.ReactNode;
}

export const AppContentChrome: React.FC<AppContentChromeProps> = ({
  ui,
  runtime,
  onOpenCensusDate,
  renderFeatureQuickActions,
}) => {
  const { auth, dateNav } = runtime;
  const { isSignatureMode } = dateNav;
  const [handoffTarget, setHandoffTarget] = React.useState<HTMLDivElement | null>(null);

  const medicalIndicationsPatients = React.useMemo<MedicalIndicationsPatientOption[]>(() => {
    return buildMedicalIndicationsPatientOptions(runtime.record);
  }, [runtime.record]);
  const dateStripProps = buildDateStripProps({
    ui,
    runtime,
    medicalIndicationsPatients,
    renderFeatureQuickActions,
  });
  const navbarProps = buildNavbarProps({ ui, runtime });
  const appRouterShellState = buildAppRouterShellState({ ui, runtime, onOpenCensusDate });

  const showDateStrip = shouldRenderDateStrip({
    currentModule: ui.currentModule,
    censusViewMode: ui.censusViewMode,
    isSignatureMode,
  });

  return (
    <>
      {!isSignatureMode && <Navbar {...navbarProps} />}

      {showDateStrip && (
        <DateStrip
          {...dateStripProps}
          hideQuickActions={ui.currentModule === 'CENSUS'}
          trailingActions={
            ui.currentModule === 'CENSUS' ? (
              <>
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
                      onOpenBedManager={
                        isSpecialistCensusAccessProfile(dateStripProps.accessProfile ?? 'default')
                          ? undefined
                          : dateStripProps.onOpenBedManager
                      }
                      medicalIndicationsPatients={medicalIndicationsPatients}
                      renderFeatureQuickActions={renderFeatureQuickActions}
                    />
                  </React.Suspense>
                  <div ref={setHandoffTarget} />
                </CensusOptionsMenu>
                {auth.role === 'admin' && (
                  <React.Suspense fallback={null}>
                    <CensusConflictQuickAction />
                  </React.Suspense>
                )}
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
        isSignatureMode,
        showBookmarksBar: ui.showBookmarksBar,
        role: auth.role,
      }) && (
        <React.Suspense fallback={null}>
          <BookmarkBar />
        </React.Suspense>
      )}

      <main className="max-w-screen-2xl mx-auto px-4 pt-4 pb-20 flex-1 w-full print:p-0 print:pb-0 print:max-w-none">
        <CensusToolbarMenuTargetContext.Provider value={handoffTarget}>
          <AppRouter ui={ui} shell={appRouterShellState} />
        </CensusToolbarMenuTargetContext.Provider>
      </main>
    </>
  );
};
