import React from 'react';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { AnalyticsView } from '@/views/analytics/AnalyticsView';
import { useCensusLogic } from '@/hooks/useCensusLogic';
import { useTableConfig } from '@/context/TableConfigContext';
import {
    CensusActionsProvider,
    EmptyDayPrompt,
    CensusTable,
    DischargesSection,
    TransfersSection,
    CMASection,
    CensusModals,
    CensusStaffHeader
} from './index';

type ViewMode = 'REGISTER' | 'ANALYTICS';

interface CensusViewProps {
    viewMode: ViewMode;
    selectedDay: number;
    selectedMonth: number;
    currentDateString: string;
    onOpenBedManager: () => void;
    showBedManagerModal: boolean;
    onCloseBedManagerModal: () => void;
    readOnly?: boolean;
}

const CensusViewContent: React.FC<CensusViewProps> = ({
    viewMode,
    selectedDay,
    selectedMonth,
    currentDateString,
    showBedManagerModal,
    onCloseBedManagerModal,
    readOnly = false
}) => {
    // Custom Hook handles all logic, state, and context connections
    const {
        record,
        stats,
        previousRecordAvailable,
        previousRecordDate,
        availableDates,
        createDay,
        resetDay,
        updateNurse,
        updateTens,
        undoDischarge,
        deleteDischarge,
        undoTransfer,
        deleteTransfer,
        nursesList,
        tensList
    } = useCensusLogic(currentDateString);

    // Get page margin from table config
    const { config } = useTableConfig();
    const marginStyle = { padding: `0 ${config.pageMargin}px` };

    // ========== VIEW MODE: ANALYTICS ==========
    if (viewMode === 'ANALYTICS') {
        return (
            <SectionErrorBoundary sectionName="Estadísticas">
                <AnalyticsView />
            </SectionErrorBoundary>
        );
    }

    // ========== VIEW MODE: REGISTER ==========
    if (!record) {
        return (
            <EmptyDayPrompt
                selectedDay={selectedDay}
                selectedMonth={selectedMonth}
                previousRecordAvailable={previousRecordAvailable}
                previousRecordDate={previousRecordDate}
                availableDates={availableDates}
                onCreateDay={createDay}
            />
        );
    }

    return (
        <CensusActionsProvider>
            <div className="hidden print:flex flex-col items-center text-center mb-4 text-slate-900">
                <h1 className="text-2xl font-bold uppercase leading-tight">Censo diario de servicios hospitalizados - Hospital Hanga Roa</h1>
                <p className="text-sm font-semibold mt-1">Fecha: {new Date(record.date).toLocaleDateString('es-CL')}</p>
            </div>
            <div className="space-y-6" style={marginStyle}>
                {/* 1. Header Row: Staff Selectors + Stats */}
                <CensusStaffHeader
                    record={record}
                    nursesList={nursesList}
                    tensList={tensList}
                    onUpdateNurse={updateNurse}
                    onUpdateTens={updateTens}
                    readOnly={readOnly}
                    stats={stats}
                />

                {/* 2. Active Patients Table */}
                <SectionErrorBoundary sectionName="Tabla de Pacientes" fallbackHeight="400px">
                    <CensusTable
                        record={record}
                        currentDateString={currentDateString}
                        onResetDay={resetDay}
                        readOnly={readOnly}
                    />
                </SectionErrorBoundary>

                {/* 3. Discharges Section */}
                <SectionErrorBoundary sectionName="Altas del Día" fallbackHeight="100px">
                    <DischargesSection
                        discharges={record.discharges || []}
                        onUndoDischarge={undoDischarge}
                        onDeleteDischarge={deleteDischarge}
                    />
                </SectionErrorBoundary>

                {/* 4. Traslados Section */}
                <SectionErrorBoundary sectionName="Traslados del Día" fallbackHeight="100px">
                    <TransfersSection
                        transfers={record.transfers || []}
                        onUndoTransfer={undoTransfer}
                        onDeleteTransfer={deleteTransfer}
                    />
                </SectionErrorBoundary>

                {/* 5. CMA Section */}
                <SectionErrorBoundary sectionName="Cirugía Mayor Ambulatoria" fallbackHeight="100px">
                    <CMASection />
                </SectionErrorBoundary>

                {/* 6. Modals (Only if not read only) */}
                {!readOnly && (
                    <CensusModals
                        showBedManagerModal={showBedManagerModal}
                        onCloseBedManagerModal={onCloseBedManagerModal}
                    />
                )}
            </div>
        </CensusActionsProvider>
    );
};

// Exported component
export const CensusView: React.FC<CensusViewProps> = CensusViewContent;
