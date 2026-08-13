/**
 * AppRouter
 * Handles module-based routing within the application.
 * Extracted from App.tsx to reduce component size.
 */

import React, { Suspense } from 'react';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { ViewLoader } from '@/components/ui/ViewLoader';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import type { ModuleType } from '@/constants/navigationConfig';
import {
  type AppRouterShellState,
  canRenderSimpleModuleRoute,
  resolveAllowAdminCopyOverride,
  resolveAppRouterContext,
  resolveCoreModuleRoute,
  resolveModuleReadOnly,
  resolveSimpleModuleRoute,
  SIGNATURE_ROUTE_DEFINITION,
} from '@/components/app-router/appRouterController';

interface AppRouterProps {
  /** Global UI state */
  ui: UseUIStateReturn;
  /** Route state derived by the authenticated shell boundary */
  shell: AppRouterShellState;
}

/**
 * Routes to the appropriate view based on currentModule.
 * Wraps all views with ErrorBoundary and Suspense for lazy loading.
 */
export const AppRouter: React.FC<AppRouterProps> = ({ ui, shell }) => {
  const {
    selectedDay,
    selectedMonth,
    currentDateString,
    role,
    isSignatureMode,
    showBedManagerModal,
    onCloseBedManagerModal,
    onOpenCensusDate,
  } = shell;
  const currentModule = ui.currentModule;
  const { censusAccessProfile, visibleModules, e2eEditableOverride } =
    resolveAppRouterContext(role);
  const resolveReadOnly = (module: ModuleType) =>
    resolveModuleReadOnly({
      role,
      module,
      e2eEditableOverride,
    });
  const allowAdminCopyOverride = resolveAllowAdminCopyOverride(role);
  const coreRoute = resolveCoreModuleRoute(currentModule);
  const simpleRoute = resolveSimpleModuleRoute(currentModule);

  return (
    <GlobalErrorBoundary>
      <Suspense fallback={<ViewLoader />}>
        {isSignatureMode ? (
          <SectionErrorBoundary sectionName={SIGNATURE_ROUTE_DEFINITION.sectionName}>
            {SIGNATURE_ROUTE_DEFINITION.render({
              ui,
              selectedDay,
              selectedMonth,
              currentDateString,
              showBedManagerModal,
              onCloseBedManagerModal,
              onOpenCensusDate,
              resolveReadOnly,
              allowAdminCopyOverride,
              censusAccessProfile,
              canOpenMedicalHandoff: visibleModules.includes('MEDICAL_HANDOFF'),
            })}
          </SectionErrorBoundary>
        ) : (
          <>
            {coreRoute && (
              <SectionErrorBoundary sectionName={coreRoute.sectionName}>
                {coreRoute.render({
                  ui,
                  selectedDay,
                  selectedMonth,
                  currentDateString,
                  showBedManagerModal,
                  onCloseBedManagerModal,
                  onOpenCensusDate,
                  resolveReadOnly,
                  allowAdminCopyOverride,
                  censusAccessProfile,
                  canOpenMedicalHandoff: visibleModules.includes('MEDICAL_HANDOFF'),
                })}
              </SectionErrorBoundary>
            )}
            {simpleRoute &&
              canRenderSimpleModuleRoute({
                currentModule,
                route: simpleRoute,
                role,
                visibleModules,
              }) && (
                <SectionErrorBoundary sectionName={simpleRoute.sectionName}>
                  {simpleRoute.render()}
                </SectionErrorBoundary>
              )}
          </>
        )}
      </Suspense>
    </GlobalErrorBoundary>
  );
};
