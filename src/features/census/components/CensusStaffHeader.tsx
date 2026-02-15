import React from 'react';
import { Statistics } from '@/types';
import { NurseSelector } from './NurseSelector';
import { TensSelector } from './TensSelector';
import { CombinedSummaryCard } from '@/components/layout/SummaryCard';
import {
  useDailyRecordActions,
  useDailyRecordStaff,
  useDailyRecordMovements,
} from '@/context/DailyRecordContext';
import { useStaffContext } from '@/context/StaffContext';
import {
  resolveMovementSummaryState,
  resolveStaffSelectorsClassName,
  resolveStaffSelectorsState,
} from '@/features/census/controllers/censusStaffHeaderController';

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
  stats,
}) => {
  const staffData = useDailyRecordStaff();
  const movementsData = useDailyRecordMovements();

  const { updateNurse, updateTens } = useDailyRecordActions();
  const { nursesList, tensList } = useStaffContext();
  const staffSelectorsState = resolveStaffSelectorsState(staffData);
  const movementSummaryState = resolveMovementSummaryState(movementsData);
  const selectorsClassName = resolveStaffSelectorsClassName(readOnly);

  return (
    <div className="flex justify-center items-stretch gap-3 flex-wrap animate-fade-in px-4">
      {/* Staff Selectors */}
      <NurseSelector
        nursesDayShift={staffSelectorsState.nursesDayShift}
        nursesNightShift={staffSelectorsState.nursesNightShift}
        nursesList={nursesList}
        onUpdateNurse={updateNurse}
        className={selectorsClassName}
      />

      <TensSelector
        tensDayShift={staffSelectorsState.tensDayShift}
        tensNightShift={staffSelectorsState.tensNightShift}
        tensList={tensList}
        onUpdateTens={updateTens}
        className={selectorsClassName}
      />

      {/* Combined Stats Summary Card */}
      {stats && (
        <CombinedSummaryCard
          stats={stats}
          discharges={movementSummaryState.discharges}
          transfers={movementSummaryState.transfers}
          cmaCount={movementSummaryState.cmaCount}
        />
      )}
    </div>
  );
};
