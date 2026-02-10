import React, { useEffect } from 'react';
import {
    Navbar,
    DateStrip,
    SettingsModal,
    TestAgent,
    SyncWatcher,
    DemoModePanel,
    BookmarkBar,
    StorageStatusBadge,
    ModuleType
} from '@/components';
import { PinLockScreen } from '@/components/security/PinLockScreen';
import { AppRouter } from '@/components/AppRouter';
import { AppProviders } from '@/components/AppProviders';
import { generateCensusMasterExcel } from '@/services';
import { CensusEmailConfigModal } from '@/features/census/components/CensusEmailConfigModal';

import { useAuth } from '@/context/AuthContext';
import { UseUIStateReturn } from '@/hooks/useUIState';
import { useCensusContext } from '@/context/CensusContext';
import { useExportManager } from '@/hooks/useExportManager';

interface AppContentProps {
    ui: UseUIStateReturn;
}

export const AppContent: React.FC<AppContentProps> = ({ ui }) => {
    // 1. Consume Domain Context
    const {
        dailyRecord: dailyRecordHook,
        dateNav,
        censusEmail,
        fileOps,
        nurseSignature,
        sharedCensus
    } = useCensusContext();

    const auth = useAuth();
    const { record, syncStatus, lastSyncTime } = dailyRecordHook;
    const { isSignatureMode, currentDateString } = dateNav;

    // Export Manager Hook
    const exportManager = useExportManager({
        currentDateString,
        selectedYear: dateNav.selectedYear,
        selectedMonth: dateNav.selectedMonth,
        selectedDay: dateNav.selectedDay,
        record,
        currentModule: ui.currentModule,
        selectedShift: ui.selectedShift
    });

    // Listen for navigate-module events
    useEffect(() => {
        const handleNavigateModule = (event: Event) => {
            const customEvent = event as CustomEvent<string>;
            if (customEvent.detail) {
                ui.setCurrentModule(customEvent.detail as ModuleType); // Type assertion to ModuleType
            }
        };

        window.addEventListener('navigate-module', handleNavigateModule);
        return () => window.removeEventListener('navigate-module', handleNavigateModule);
    }, [ui]);

    // Listen for set-shift events
    useEffect(() => {
        const handleSetShift = (event: Event) => {
            const customEvent = event as CustomEvent<'day' | 'night'>;
            if (customEvent.detail) {
                ui.setSelectedShift(customEvent.detail);
            }
        };

        window.addEventListener('set-shift', handleSetShift);
        return () => window.removeEventListener('set-shift', handleSetShift);
    }, [ui]);

    return (
        <AppProviders dailyRecordHook={dailyRecordHook}>
            <div className="min-h-screen bg-slate-100 font-sans flex flex-col print:bg-white print:p-0">
                {/* Navigation */}
                {!isSignatureMode && (
                    <Navbar
                        currentModule={ui.currentModule}
                        setModule={ui.setCurrentModule}
                        censusViewMode={ui.censusViewMode}
                        setCensusViewMode={ui.setCensusViewMode}
                        onOpenBedManager={ui.bedManagerModal.open}
                        onExportCSV={fileOps.handleExportCSV}
                        onImportJSON={fileOps.handleImportJSON}
                        onOpenSettings={ui.settingsModal.open}
                        userEmail={auth.user?.email}
                        onLogout={auth.signOut}
                        isFirebaseConnected={auth.isFirebaseConnected}
                        isSharedMode={sharedCensus.isSharedCensusMode}
                    />
                )}

                {/* Date Strip - Hide in Analytics mode */}
                {((ui.currentModule === 'CENSUS' && ui.censusViewMode === 'REGISTER') ||
                    ui.currentModule === 'CUDYR' ||
                    ui.currentModule === 'NURSING_HANDOFF' ||
                    ui.currentModule === 'MEDICAL_HANDOFF')
                    && !isSignatureMode && !sharedCensus.isSharedCensusMode && (
                        <DateStrip
                            selectedYear={dateNav.selectedYear} setSelectedYear={dateNav.setSelectedYear}
                            selectedMonth={dateNav.selectedMonth} setSelectedMonth={dateNav.setSelectedMonth}
                            selectedDay={dateNav.selectedDay} setSelectedDay={dateNav.setSelectedDay}
                            currentDateString={currentDateString}
                            daysInMonth={dateNav.daysInMonth}
                            existingDaysInMonth={dateNav.existingDaysInMonth}
                            onExportPDF={ui.showPrintButton ? exportManager.handleExportPDF : undefined}
                            onOpenBedManager={ui.currentModule === 'CENSUS' ? ui.bedManagerModal.open : undefined}
                            onExportExcel={
                                ui.currentModule === 'CENSUS'
                                    ? () => generateCensusMasterExcel(dateNav.selectedYear, dateNav.selectedMonth, dateNav.selectedDay)
                                    : undefined
                            }
                            onConfigureEmail={ui.currentModule === 'CENSUS' ? () => censusEmail.setShowEmailConfig(true) : undefined}
                            onSendEmail={ui.currentModule === 'CENSUS' ? async () => {
                                await exportManager.handleBackupExcel();
                                await censusEmail.sendEmail();
                            } : undefined}
                            onCopyShareLink={ui.currentModule === 'CENSUS' ? () => censusEmail.copyShareLink('viewer') : undefined}
                            onBackupExcel={ui.currentModule === 'CENSUS' ? exportManager.handleBackupExcel : undefined}
                            isArchived={exportManager.isArchived}
                            isBackingUp={exportManager.isBackingUp}
                            currentModule={ui.currentModule}


                            emailStatus={censusEmail.status}
                            emailErrorMessage={censusEmail.error}
                            syncStatus={syncStatus}
                            lastSyncTime={lastSyncTime}

                            onToggleBookmarks={() => ui.setShowBookmarksBar(!ui.showBookmarksBar)}
                            showBookmarks={ui.showBookmarksBar}
                            role={auth.role}
                            localViewMode={ui.censusLocalViewMode}
                            setLocalViewMode={ui.setCensusLocalViewMode}
                            onBackupPDF={exportManager.handleBackupHandoff}
                            navigateDays={dateNav.navigateDays}
                        />
                    )}

                {/* Favorites Bookmark Bar - Hide in Analytics mode */}
                {!isSignatureMode && !sharedCensus.isSharedCensusMode &&
                    ui.showBookmarksBar &&
                    ui.currentModule === 'CENSUS' &&
                    ui.censusViewMode === 'REGISTER' &&
                    (auth.role === 'admin' || auth.role === 'nurse_hospital') && (
                        <BookmarkBar />
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

                <PinLockScreen />
                <StorageStatusBadge />
            </div>
        </AppProviders>
    );
};
