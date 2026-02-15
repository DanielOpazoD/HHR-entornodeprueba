import React from 'react';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { AnalyticsView } from '@/features/analytics/components/AnalyticsView';
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
    localViewMode?: 'TABLE' | '3D';
}

// Lazy load 3D component
const HospitalFloorMap = React.lazy(() => import('./3d/HospitalFloorMap'));

// Import icons and constants
import { Loader2 } from 'lucide-react';
import { BEDS } from '@/constants';
import { buildVisibleBeds } from '@/features/census/controllers/censusTableViewController';
import { executeCensusMigrationBootstrapController } from '@/features/census/controllers/censusMigrationBootstrapController';

const CensusViewContent: React.FC<CensusViewProps> = ({
    viewMode: initialViewMode, // mapped but unused for internal toggle, we use local state for table/3d switch
    selectedDay,
    selectedMonth,
    currentDateString,
    showBedManagerModal,
    onCloseBedManagerModal,
    readOnly = false,
    localViewMode = 'TABLE'
}) => {
    // Custom Hook handles all logic, state, and context connections
    const {
        beds,
        staff,
        previousRecordAvailable,
        previousRecordDate,
        availableDates,
        createDay,
        stats
    } = useCensusLogic(currentDateString);

    // Get page margin from table config
    const { config } = useTableConfig();
    const marginStyle = { padding: `0 ${config.pageMargin}px` };

    // Compute visible beds for 3D map
    const visibleBeds = React.useMemo(() => {
        if (!beds) return [];
        const activeExtras = staff?.activeExtraBeds || [];
        return buildVisibleBeds({
            allBeds: BEDS,
            activeExtraBeds: activeExtras
        });
    }, [beds, staff?.activeExtraBeds]);

    // ========== MIGRATION LOGIC ==========
    React.useEffect(() => {
        const result = executeCensusMigrationBootstrapController({
            getItem: (key) => localStorage.getItem(key),
            setItem: (key, value) => localStorage.setItem(key, value)
        });

        if (!result.ok) {
            console.error('[Migration] Failed:', result.error.message);
        }
    }, []);

    // ========== VIEW MODE: ANALYTICS ==========
    if (initialViewMode === 'ANALYTICS') {
        return (
            <SectionErrorBoundary sectionName="Estadísticas">
                <AnalyticsView />
            </SectionErrorBoundary>
        );
    }

    // ========== VIEW MODE: REGISTER ==========
    if (!beds) {
        return (
            <EmptyDayPrompt
                selectedDay={selectedDay}
                selectedMonth={selectedMonth}
                previousRecordAvailable={previousRecordAvailable}
                previousRecordDate={previousRecordDate}
                availableDates={availableDates}
                onCreateDay={createDay}
                readOnly={readOnly}
            />
        );
    }

    return (
        <CensusActionsProvider>
            <div className="hidden print:flex flex-col items-center text-center mb-4 text-slate-900">
                <h1 className="text-2xl font-bold uppercase leading-tight">Censo diario de servicios hospitalizados - Hospital Hanga Roa</h1>
                <p className="text-sm font-semibold mt-1">Fecha: {new Date(currentDateString).toLocaleDateString('es-CL')}</p>
            </div>

            <div className="space-y-6" style={marginStyle}>

                {/* 1. Header Row: Staff Selectors + Stats */}
                <CensusStaffHeader
                    readOnly={readOnly}
                    stats={stats}
                />

                {/* 2. Main Content (Table or 3D) */}
                {localViewMode === 'TABLE' ? (
                    <SectionErrorBoundary sectionName="Tabla de Pacientes" fallbackHeight="400px">
                        <CensusTable
                            currentDateString={currentDateString}
                            readOnly={readOnly}
                        />
                    </SectionErrorBoundary>
                ) : (
                    <div className="animate-fade-in">
                        <React.Suspense fallback={
                            <div className="h-[500px] w-full bg-slate-50 rounded-xl flex flex-col items-center justify-center border border-slate-200">
                                <Loader2 className="animate-spin text-indigo-500 mb-2" size={32} />
                                <p className="text-slate-500 font-medium text-sm">Cargando entorno 3D...</p>
                            </div>
                        }>
                            <HospitalFloorMap
                                beds={visibleBeds}
                                patients={beds}
                            />
                        </React.Suspense>
                    </div>
                )}

                {/* 3. Discharges Section */}
                <SectionErrorBoundary sectionName="Altas del Día" fallbackHeight="100px">
                    <DischargesSection />
                </SectionErrorBoundary>

                {/* 4. Traslados Section */}
                <SectionErrorBoundary sectionName="Traslados del Día" fallbackHeight="100px">
                    <TransfersSection />
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
