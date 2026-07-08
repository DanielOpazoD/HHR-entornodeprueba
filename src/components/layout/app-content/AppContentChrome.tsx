import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { DateStrip } from '@/components/layout/DateStrip';
import { CensusStaleDayBanner } from '@/components/layout/app-content/CensusStaleDayBanner';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { AppRouter } from '@/components/AppRouter';

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

      {showDateStrip && <DateStrip {...dateStripProps} />}

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
        <AppRouter ui={ui} shell={appRouterShellState} />
      </main>
    </>
  );
};
