import React, { useEffect, useState, useCallback } from 'react';
import {
    Navbar,
    DateStrip,
    SettingsModal,
    TestAgent,
    SyncWatcher,
    DemoModePanel
} from '@/components';
import { AppRouter } from '@/components/AppRouter';
import { AppProviders } from '@/components/AppProviders';
import { generateCensusMasterExcel, getMonthRecordsFromFirestore } from '@/services';
import { buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import { uploadCensus, checkCensusExists } from '@/services/backup/censusStorageService';
import { CensusEmailConfigModal } from '@/components/census/CensusEmailConfigModal';

import { useAuth } from '@/context/AuthContext';
import { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { UseUIStateReturn } from '@/hooks/useUIState';
import { DailyRecordContextType } from '@/hooks/useDailyRecord';
import { UseCensusEmailReturn } from '@/hooks/useCensusEmail';
import { UseFileOperationsReturn } from '@/hooks/useFileOperations';
import { UseNurseSignatureReturn } from '@/hooks/useNurseSignature';
import { useSharedCensusMode } from '@/hooks/useSharedCensusMode';

interface AppContentProps {
    dateNav: UseDateNavigationReturn & {
        isSignatureMode: boolean;
        existingDaysInMonth: number[];
    };
    ui: UseUIStateReturn;
    dailyRecordHook: DailyRecordContextType;
    censusEmail: UseCensusEmailReturn;
    fileOps: UseFileOperationsReturn;
    nurseSignature: UseNurseSignatureReturn;
    sharedCensus: ReturnType<typeof useSharedCensusMode>;
}

export const AppContent: React.FC<AppContentProps> = ({
    dateNav,
    ui,
    dailyRecordHook,
    censusEmail,
    fileOps,
    nurseSignature,
    sharedCensus
}) => {
    const auth = useAuth();
    const { record, syncStatus, lastSyncTime } = dailyRecordHook;
    const { isSignatureMode, currentDateString } = dateNav;

    // Track if current date's census is already archived
    const [isArchived, setIsArchived] = useState(false);

    // Check archive status when date changes
    useEffect(() => {
        if (currentDateString && ui.currentModule === 'CENSUS') {
            checkCensusExists(currentDateString)
                .then(exists => setIsArchived(exists))
                .catch(() => setIsArchived(false));
        }
    }, [currentDateString, ui.currentModule]);

    // Listen for navigate-module events (e.g., from CUDYR button in Handoff)
    useEffect(() => {
        const handleNavigateModule = (event: Event) => {
            const customEvent = event as CustomEvent<string>;
            if (customEvent.detail) {
                ui.setCurrentModule(customEvent.detail as any);
            }
        };

        window.addEventListener('navigate-module', handleNavigateModule);
        return () => window.removeEventListener('navigate-module', handleNavigateModule);
    }, [ui]);

    return (
        <AppProviders dailyRecordHook={dailyRecordHook} userId={auth.user?.uid || 'anon'}>
            <div className="min-h-screen bg-slate-100 font-sans flex flex-col print:bg-white print:p-0">
                {/* Navigation */}
                {!isSignatureMode && (
                    <Navbar
                        currentModule={ui.currentModule}
                        setModule={ui.setCurrentModule}
                        censusViewMode={ui.censusViewMode}
                        setCensusViewMode={ui.setCensusViewMode}
                        onOpenBedManager={ui.bedManagerModal.open}
                        onExportJSON={fileOps.handleExportJSON}
                        onExportCSV={fileOps.handleExportCSV}
                        onImportJSON={fileOps.handleImportJSON}
                        onOpenSettings={ui.settingsModal.open}
                        userEmail={auth.user?.email}
                        onLogout={auth.signOut}
                        isFirebaseConnected={auth.isFirebaseConnected}
                        isSharedMode={sharedCensus.isSharedCensusMode}
                    />
                )}

                {/* Date Strip */}
                {ui.currentModule === 'CENSUS' && ui.censusViewMode === 'REGISTER' && !isSignatureMode && !sharedCensus.isSharedCensusMode && (
                    <DateStrip
                        selectedYear={dateNav.selectedYear} setSelectedYear={dateNav.setSelectedYear}
                        selectedMonth={dateNav.selectedMonth} setSelectedMonth={dateNav.setSelectedMonth}
                        selectedDay={dateNav.selectedDay} setSelectedDay={dateNav.setSelectedDay}
                        currentDateString={currentDateString}
                        daysInMonth={dateNav.daysInMonth}
                        existingDaysInMonth={dateNav.existingDaysInMonth}
                        onPrintPDF={ui.showPrintButton ? () => window.print() : undefined}
                        onExportPDF={ui.showPrintButton ? () => {
                            // Use the globally selected shift (from useAppState)
                            const shift = ui.selectedShift;

                            // Import dynamically to avoid loading jsPDF on main bundle if possible
                            import('@/services/pdf/handoffPdfGenerator').then(({ generateHandoffPdf }) => {
                                if (record) {
                                    generateHandoffPdf(record, false, shift, { dayStart: '08:00', dayEnd: '20:00', nightStart: '20:00', nightEnd: '08:00' });
                                }
                            });
                        } : undefined}
                        onOpenBedManager={ui.currentModule === 'CENSUS' ? ui.bedManagerModal.open : undefined}
                        onExportExcel={ui.currentModule === 'CENSUS'
                            ? () => generateCensusMasterExcel(dateNav.selectedYear, dateNav.selectedMonth, dateNav.selectedDay)
                            : undefined}
                        onConfigureEmail={ui.currentModule === 'CENSUS' ? () => censusEmail.setShowEmailConfig(true) : undefined}
                        onSendEmail={ui.currentModule === 'CENSUS' ? censusEmail.sendEmail : undefined}
                        onGenerateShareLink={ui.currentModule === 'CENSUS' ? () => censusEmail.sendEmailWithLink('viewer') : undefined}
                        onCopyShareLink={ui.currentModule === 'CENSUS' ? () => censusEmail.copyShareLink('viewer') : undefined}
                        onBackupExcel={ui.currentModule === 'CENSUS' ? async () => {
                            // Build Excel and upload to Firebase Storage
                            const monthRecords = await getMonthRecordsFromFirestore(dateNav.selectedYear, dateNav.selectedMonth);
                            const limitDate = `${dateNav.selectedYear}-${String(dateNav.selectedMonth + 1).padStart(2, '0')}-${String(dateNav.selectedDay).padStart(2, '0')}`;

                            let filteredRecords = monthRecords
                                .filter(r => r.date <= limitDate)
                                .sort((a, b) => a.date.localeCompare(b.date));

                            // Include current record if not in the list
                            if (record && !filteredRecords.some(r => r.date === currentDateString)) {
                                filteredRecords.push(record);
                                filteredRecords.sort((a, b) => a.date.localeCompare(b.date));
                            }

                            if (filteredRecords.length === 0) {
                                alert('No hay registros para archivar.');
                                return;
                            }

                            const workbook = buildCensusMasterWorkbook(filteredRecords);
                            const buffer = await workbook.xlsx.writeBuffer();
                            const blob = new Blob([buffer], {
                                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                            });

                            await uploadCensus(blob, currentDateString);
                            setIsArchived(true); // Update state immediately
                            alert(`✅ Excel archivado correctamente para ${currentDateString}`);
                        } : undefined}
                        isArchived={ui.currentModule === 'CENSUS' ? isArchived : undefined}


                        emailStatus={censusEmail.status}
                        emailErrorMessage={censusEmail.error}
                        syncStatus={syncStatus}
                        lastSyncTime={lastSyncTime}
                    />
                )}

                {/* Main Content */}
                <main className="max-w-screen-2xl mx-auto px-4 pt-4 pb-20 flex-1 w-full print:p-0 print:pb-0 print:max-w-none">
                    <AppRouter
                        ui={ui}
                        currentModule={ui.currentModule}
                        censusViewMode={ui.censusViewMode}
                        selectedDay={dateNav.selectedDay}
                        selectedMonth={dateNav.selectedMonth}
                        currentDateString={currentDateString}
                        role={auth.role}
                        isSignatureMode={isSignatureMode}
                        onOpenBedManager={ui.bedManagerModal.open}
                        showBedManagerModal={ui.bedManagerModal.isOpen}
                        onCloseBedManagerModal={ui.bedManagerModal.close}
                        sharedCensus={sharedCensus}
                    />
                </main>

                {/* Global Modals */}
                <SettingsModal
                    isOpen={ui.settingsModal.isOpen}
                    onClose={ui.settingsModal.close}
                    onGenerateDemo={ui.demoModal.open}
                    onRunTest={() => ui.setIsTestAgentRunning(true)}
                    canDownloadPassport={auth.canDownloadPassport}
                    onDownloadPassport={auth.handleDownloadPassport}
                    isOfflineMode={auth.isOfflineMode}
                />

                <CensusEmailConfigModal
                    isOpen={censusEmail.showEmailConfig}
                    onClose={() => censusEmail.setShowEmailConfig(false)}
                    recipients={censusEmail.recipients}
                    onRecipientsChange={censusEmail.setRecipients}
                    message={censusEmail.message}
                    onMessageChange={censusEmail.onMessageChange}
                    onResetMessage={censusEmail.onResetMessage}
                    date={currentDateString}
                    nursesSignature={nurseSignature}
                    isAdminUser={censusEmail.isAdminUser}
                    testModeEnabled={censusEmail.testModeEnabled}
                    onTestModeChange={censusEmail.setTestModeEnabled}
                    testRecipient={censusEmail.testRecipient}
                    onTestRecipientChange={censusEmail.setTestRecipient}
                />

                {!sharedCensus.isSharedCensusMode && (
                    <TestAgent
                        isRunning={ui.isTestAgentRunning}
                        onComplete={() => ui.setIsTestAgentRunning(false)}
                        currentRecord={record}
                    />
                )}

                {!sharedCensus.isSharedCensusMode && (
                    <>
                        <SyncWatcher />
                        <DemoModePanel isOpen={ui.demoModal.isOpen} onClose={ui.demoModal.close} />
                    </>
                )}
            </div>
        </AppProviders>
    );
};
