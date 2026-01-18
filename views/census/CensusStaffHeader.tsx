import React from 'react';
import { Statistics } from '@/types';
import { NurseSelector, TensSelector } from './';
import { BedSummaryCard, CribSummaryCard, MovementSummaryCard } from '@/components/layout/SummaryCard';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
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
    const { record } = useDailyRecordData();
    const { updateNurse, updateTens } = useDailyRecordActions();
    const { nursesList, tensList } = useStaffContext();

    if (!record) return null;

    // Safe arrays with defaults
    const safeNursesDayShift = record.nursesDayShift || [];
    const safeNursesNightShift = record.nursesNightShift || [];
    const safeTensDayShift = record.tensDayShift || [];
    const safeTensNightShift = record.tensNightShift || [];

    return (
        <div className="flex justify-center items-stretch gap-3 flex-wrap animate-fade-in px-4">
            {/* Staff Selectors and Stats flattened for equal height */}
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
                        discharges={record.discharges || []}
                        transfers={record.transfers || []}
                        cmaCount={record.cma?.length || 0}
                    />
                </>
            )}
        </div>
    );
};
