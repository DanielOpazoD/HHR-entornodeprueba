import React from 'react';
import clsx from 'clsx';
import { DailyRecord, Statistics } from '@/types';
import { NurseSelector, TensSelector } from './';
import { BedSummaryCard, CribSummaryCard, MovementSummaryCard } from '@/components/layout/SummaryCard';

interface CensusStaffHeaderProps {
    record: DailyRecord;
    nursesList: string[];
    tensList: string[];
    onUpdateNurse: (shift: 'day' | 'night', index: number, value: string) => void;
    onUpdateTens: (shift: 'day' | 'night', index: number, value: string) => void;
    readOnly?: boolean;
    stats: Statistics | null;
}

export const CensusStaffHeader: React.FC<CensusStaffHeaderProps> = ({
    record,
    nursesList,
    tensList,
    onUpdateNurse,
    onUpdateTens,
    readOnly = false,
    stats
}) => {
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
                onUpdateNurse={onUpdateNurse}
                className={readOnly ? "pointer-events-none opacity-80" : ""}
            />
            <TensSelector
                tensDayShift={safeTensDayShift}
                tensNightShift={safeTensNightShift}
                tensList={tensList}
                onUpdateTens={onUpdateTens}
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
