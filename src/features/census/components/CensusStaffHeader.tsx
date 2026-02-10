import React from 'react';
import { Statistics } from '@/types';
import { NurseSelector } from './NurseSelector';
import { TensSelector } from './TensSelector';
// import { OnDutyProfessionalsCard } from './OnDutyProfessionalsCard';
import { CombinedSummaryCard } from '@/components/layout/SummaryCard';
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
    const staffData = useDailyRecordStaff();
    const movementsData = useDailyRecordMovements();

    const nursesDayShift = staffData?.nursesDayShift;
    const nursesNightShift = staffData?.nursesNightShift;
    const tensDayShift = staffData?.tensDayShift;
    const tensNightShift = staffData?.tensNightShift;

    const discharges = movementsData?.discharges;
    const transfers = movementsData?.transfers;
    const cma = movementsData?.cma;

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

            {/* Combined Stats Summary Card */}
            {stats && (
                <CombinedSummaryCard
                    stats={stats}
                    discharges={discharges || []}
                    transfers={transfers || []}
                    cmaCount={cma?.length || 0}
                />
            )}

            {/* On-Duty Professionals Card (Hidden temporarily) */}
            {/* <OnDutyProfessionalsCard readOnly={readOnly} /> */}
        </div>
    );
};
