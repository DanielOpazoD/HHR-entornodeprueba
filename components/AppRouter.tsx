/**
 * AppRouter
 * Handles module-based routing within the application.
 * Extracted from App.tsx to reduce component size.
 */

import React, { Suspense } from 'react';
import { GlobalErrorBoundary, SectionErrorBoundary } from '@/components';
import { ViewLoader } from '@/components/ui/ViewLoader';
import { canEditModule } from '@/utils/permissions';
import { UserRole } from '@/hooks/useAuthState';
import { UseUIStateReturn } from '@/hooks/useUIState';

// Lazy-loaded views
import {
    CensusView,
    CudyrView,
    HandoffView,
    AuditView,
    MedicalSignatureView,
    WhatsAppIntegrationView,
    SystemDiagnosticsView,
    TransferManagementView,
    BackupFilesView,
    SharedCensusView,
    PatientMasterView,
    DataMaintenanceView
} from '@/views/LazyViews';
import { useSharedCensusMode } from '@/hooks/useSharedCensusMode';

export type AppModule = 'CENSUS' | 'CUDYR' | 'NURSING_HANDOFF' | 'MEDICAL_HANDOFF' | 'AUDIT' | 'WHATSAPP' | 'TRANSFER_MANAGEMENT' | 'BACKUP_FILES' | 'PATIENT_MASTER_INDEX' | 'DATA_MAINTENANCE' | 'DIAGNOSTICS';
export type CensusViewMode = 'REGISTER' | 'ANALYTICS';

interface AppRouterProps {
    /** Global UI state */
    ui: UseUIStateReturn;
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
    /** Shared census mode state */
    sharedCensus: ReturnType<typeof useSharedCensusMode>;
}

/**
 * Routes to the appropriate view based on currentModule.
 * Wraps all views with ErrorBoundary and Suspense for lazy loading.
 */
export const AppRouter: React.FC<AppRouterProps> = ({
    ui,
    currentModule,
    censusViewMode,
    selectedDay,
    selectedMonth,
    currentDateString,
    role,
    isSignatureMode,
    onOpenBedManager,
    showBedManagerModal,
    onCloseBedManagerModal,
    sharedCensus
}) => {
    return (
        <GlobalErrorBoundary>
            <Suspense fallback={<ViewLoader />}>
                {isSignatureMode ? (
                    <SectionErrorBoundary sectionName="Firma Médica">
                        <MedicalSignatureView />
                    </SectionErrorBoundary>
                ) : sharedCensus.isSharedCensusMode ? (
                    <SectionErrorBoundary sectionName="Censo Compartido">
                        <SharedCensusView accessUser={sharedCensus.accessUser} error={sharedCensus.error} />
                    </SectionErrorBoundary>
                ) : (
                    <>
                        {currentModule === 'CENSUS' && (
                            <SectionErrorBoundary sectionName="Censo">
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
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'CUDYR' && (
                            <SectionErrorBoundary sectionName="CUDYR">
                                <CudyrView readOnly={!canEditModule(role, 'CUDYR')} />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'NURSING_HANDOFF' && (
                            <SectionErrorBoundary sectionName="Entrega Enfermería">
                                <HandoffView ui={ui} type="nursing" readOnly={!canEditModule(role, 'NURSING_HANDOFF')} />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'MEDICAL_HANDOFF' && (
                            <SectionErrorBoundary sectionName="Entrega Médica">
                                <HandoffView ui={ui} type="medical" readOnly={!canEditModule(role, 'MEDICAL_HANDOFF')} />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'AUDIT' && (
                            <SectionErrorBoundary sectionName="Auditoría">
                                <AuditView />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'WHATSAPP' && (
                            <SectionErrorBoundary sectionName="Integración WhatsApp">
                                <WhatsAppIntegrationView />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'DIAGNOSTICS' && role === 'admin' && (
                            <SectionErrorBoundary sectionName="Diagnóstico del Sistema">
                                <SystemDiagnosticsView />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'TRANSFER_MANAGEMENT' && (
                            <SectionErrorBoundary sectionName="Traslados">
                                <TransferManagementView />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'BACKUP_FILES' && (
                            <SectionErrorBoundary sectionName="Respaldos">
                                <BackupFilesView backupType="handoff" />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'PATIENT_MASTER_INDEX' && role === 'admin' && (
                            <SectionErrorBoundary sectionName="Base de Pacientes">
                                <PatientMasterView />
                            </SectionErrorBoundary>
                        )}
                        {currentModule === 'DATA_MAINTENANCE' && role === 'admin' && (
                            <SectionErrorBoundary sectionName="Mantenimiento de Datos">
                                <DataMaintenanceView />
                            </SectionErrorBoundary>
                        )}
                    </>
                )}
            </Suspense>
        </GlobalErrorBoundary>
    );
};
