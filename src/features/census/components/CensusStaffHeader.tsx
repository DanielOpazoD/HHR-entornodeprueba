import React from 'react';
import { Statistics } from '@/types';
import { NurseSelector } from './NurseSelector';
import { TensSelector } from './TensSelector';
import { BedSummaryCard, CribSummaryCard, MovementSummaryCard } from '@/components/layout/SummaryCard';
import { useDailyRecordActions, useDailyRecordStaff, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useStaffContext } from '@/context/StaffContext';

interface CensusStaffHeaderProps {
    readOnly?: boolean;
    stats: Statistics | null;
}

/**
 * CensusStaffHeader
 * Displays staff selectors (Nurse/TENS) and summary statistics.
 * Optimized to consume fragmented context.
 */
export const CensusStaffHeader: React.FC<CensusStaffHeaderProps> = ({
    readOnly = false,
    stats
}) => {
    const {
        nursesDayShift,
        nursesNightShift,
        tensDayShift,
        tensNightShift
    } = useDailyRecordStaff();
    const { discharges, transfers, cma } = useDailyRecordMovements();
    const { updateNurse, updateTens } = useDailyRecordActions();
    const { nursesList, tensList } = useStaffContext();

    // Safe arrays with defaults
    const safeNursesDayShift = nursesDayShift || [];
    const safeNursesNightShift = nursesNightShift || [];
    const safeTensDayShift = tensDayShift || [];
    const safeTensNightShift = tensNightShift || [];

    return (
        <div className="flex justify-center items-stretch gap-3 flex-wrap animate-fade-in px-4">
            {/* Staff Selectors */}
            <NurseSelector
                nursesDayShift={safeNursesDayShift}
                nursesNightShift={safeNursesNightShift}
                nursesList={nursesList}
                onUpdateNurse={updateNurse}
                className={readOnly ? "pointer-events-none opacity-80" : ""}
            />

            <TensSelector
                tensDayShift={safeTensDayShift}
                tensNightShift={safeTensNightShift}
                tensList={tensList}
                onUpdateTens={updateTens}
                className={readOnly ? "pointer-events-none opacity-80" : ""}
            />

            {/* Stats Summary Cards */}
            {stats && (
                <>
                    <BedSummaryCard stats={stats} />
                    <CribSummaryCard stats={stats} />
                    <MovementSummaryCard
                        discharges={discharges || []}
                        transfers={transfers || []}
                        cmaCount={cma?.length || 0}
                    />
                </>
            )}
        </div>
    );
};
