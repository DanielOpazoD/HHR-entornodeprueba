/**
 * AppRouter
 * Handles module-based routing within the application.
 * Extracted from App.tsx to reduce component size.
 */

import React, { Suspense } from 'react';
import { ErrorBoundary } from '@/components';
import { ViewLoader } from '@/components/ui/ViewLoader';
import { canEditModule } from '@/utils/permissions';
import { UserRole } from '@/hooks/useAuthState';

// Lazy-loaded views
import {
    CensusView,
    CudyrView,
    HandoffView,
    AuditView,
    MedicalSignatureView,
    WhatsAppIntegrationView,
    ErrorDashboard
} from '@/views/LazyViews';

export type AppModule = 'CENSUS' | 'CUDYR' | 'NURSING_HANDOFF' | 'MEDICAL_HANDOFF' | 'AUDIT' | 'WHATSAPP' | 'ERRORS';
export type CensusViewMode = 'REGISTER' | 'ANALYTICS';

interface AppRouterProps {
    /** Current active module */
    currentModule: AppModule;
    /** Census sub-view mode */
    censusViewMode: CensusViewMode;
    /** Selected day for census */
    selectedDay: number;
    /** Selected month for census */
    selectedMonth: number;
    /** Current date string (YYYY-MM-DD) */
    currentDateString: string;
    /** User's role for permissions */
    role: UserRole;
    /** Whether in signature collection mode */
    isSignatureMode: boolean;
    /** Callback to open bed manager modal */
    onOpenBedManager: () => void;
    /** Whether bed manager modal is open */
    showBedManagerModal: boolean;
    /** Callback to close bed manager modal */
    onCloseBedManagerModal: () => void;
}

/**
 * Routes to the appropriate view based on currentModule.
 * Wraps all views with ErrorBoundary and Suspense for lazy loading.
 */
export const AppRouter: React.FC<AppRouterProps> = ({
    currentModule,
    censusViewMode,
    selectedDay,
    selectedMonth,
    currentDateString,
    role,
    isSignatureMode,
    onOpenBedManager,
    showBedManagerModal,
    onCloseBedManagerModal
}) => {
    return (
        <ErrorBoundary>
            <Suspense fallback={<ViewLoader />}>
                {isSignatureMode ? (
                    <MedicalSignatureView />
                ) : (
                    <>
                        {currentModule === 'CENSUS' && (
                            <CensusView
                                viewMode={censusViewMode}
                                selectedDay={selectedDay}
                                selectedMonth={selectedMonth}
                                currentDateString={currentDateString}
                                onOpenBedManager={onOpenBedManager}
                                showBedManagerModal={showBedManagerModal}
                                onCloseBedManagerModal={onCloseBedManagerModal}
                                readOnly={!canEditModule(role, 'CENSUS')}
                            />
                        )}
                        {currentModule === 'CUDYR' && <CudyrView readOnly={!canEditModule(role, 'CUDYR')} />}
                        {currentModule === 'NURSING_HANDOFF' && <HandoffView type="nursing" readOnly={!canEditModule(role, 'NURSING_HANDOFF')} />}
                        {currentModule === 'MEDICAL_HANDOFF' && <HandoffView type="medical" readOnly={!canEditModule(role, 'MEDICAL_HANDOFF')} />}
                        {currentModule === 'AUDIT' && <AuditView />}
                        {currentModule === 'WHATSAPP' && <WhatsAppIntegrationView />}
                        {currentModule === 'ERRORS' && <ErrorDashboard />}
                    </>
                )}
            </Suspense>
        </ErrorBoundary>
    );
};
