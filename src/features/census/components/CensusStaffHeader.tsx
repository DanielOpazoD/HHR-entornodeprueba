import React from 'react';
import type { Statistics } from '@/types/domain/statistics';
import { NurseSelector } from './NurseSelector';
import { TensSelector } from './TensSelector';
import { StaffShiftDetailsModal } from './StaffShiftDetailsModal';
import { CombinedSummaryCard } from '@/components/layout/SummaryCard';
import {
  useDailyRecordData,
  useDailyRecordBeds,
  useDailyRecordStaff,
  useDailyRecordMovements,
} from '@/context/DailyRecordContext';
import { useDailyRecordStaffActions } from '@/context/useDailyRecordScopedActions';
import { useStaffContext } from '@/context/StaffContext';
import { buildCensusStaffHeaderReadModel } from '@/application/census/censusStaffHeaderReadModel';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { DetailedStaffingRole } from '@/types/domain/dailyRecordStaffingDetails';
import { RayenImportButton } from '@/features/rayen-import';
import { CensusAttentionBar } from './CensusAttentionBar';
import type { CensusAttentionFilter } from '@/features/census/controllers/rowAcuityController';
import { ClipboardList } from 'lucide-react';

interface CensusStaffHeaderProps {
  selectedDate?: string;
  readOnly?: boolean;
  stats: Statistics | null;
  accessProfile?: CensusAccessProfile;
  attentionFilter?: CensusAttentionFilter;
  onAttentionFilterChange?: (filter: CensusAttentionFilter) => void;
  onOpenMedicalHandoff?: () => void;
}

/**
 * CensusStaffHeader
 * Displays staff selectors (Nurse/TENS) and summary statistics.
 * Optimized to consume fragmented context.
 */
export const CensusStaffHeader: React.FC<CensusStaffHeaderProps> = ({
  selectedDate,
  readOnly = false,
  stats,
  accessProfile = 'default',
  attentionFilter = 'all',
  onAttentionFilterChange,
  onOpenMedicalHandoff,
}) => {
  const dailyRecordData = useDailyRecordData();
  const beds = useDailyRecordBeds();
  const staffData = useDailyRecordStaff();
  const movementsData = useDailyRecordMovements();

  const { updateNurse, updateTens, updateDetailedStaffing } = useDailyRecordStaffActions();
  const { nursesList, tensList } = useStaffContext();
  const [activeDetailedRole, setActiveDetailedRole] = React.useState<DetailedStaffingRole | null>(
    null
  );
  const readModel = buildCensusStaffHeaderReadModel({
    readOnly,
    stats,
    accessProfile,
    beds,
    recordDate: dailyRecordData.record?.date,
    staffData,
    movementsData,
  });

  return (
    <div className="flex w-full flex-col items-center gap-2 animate-fade-in">
      <div className="flex w-fit max-w-full flex-col items-stretch gap-2">
        <div className="flex flex-wrap items-start justify-center gap-3">
          {/* Staff Selectors */}
          {!readModel.specialistAccess && (
            <NurseSelector
              nursesDayShift={readModel.staffSelectorsState.nursesDayShift}
              nursesNightShift={readModel.staffSelectorsState.nursesNightShift}
              nursesList={nursesList}
              onUpdateNurse={updateNurse}
              shiftIndicators={readModel.staffIndicatorsState.nurseIndicators}
              onOpenDetailedStaffing={readOnly ? undefined : () => setActiveDetailedRole('nurse')}
              className={readModel.selectorsClassName}
            />
          )}

          {!readModel.specialistAccess && (
            <TensSelector
              tensDayShift={readModel.staffSelectorsState.tensDayShift}
              tensNightShift={readModel.staffSelectorsState.tensNightShift}
              tensList={tensList}
              onUpdateTens={updateTens}
              shiftIndicators={readModel.staffIndicatorsState.tensIndicators}
              onOpenDetailedStaffing={readOnly ? undefined : () => setActiveDetailedRole('tens')}
              className={readModel.selectorsClassName}
            />
          )}

          {/* Combined Stats Summary Card */}
          {readModel.showSummary && stats && (
            <CombinedSummaryCard
              stats={stats}
              discharges={readModel.movementSummaryState.discharges}
              transfers={readModel.movementSummaryState.transfers}
              cmaCount={readModel.movementSummaryState.cmaCount}
              newAdmissions={readModel.movementSummaryState.admissionsCount}
            />
          )}
        </div>

        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!readOnly && !readModel.specialistAccess && (
            <div className="min-w-0 flex-1 lg:min-w-[760px]">
              <RayenImportButton selectedDate={selectedDate} />
            </div>
          )}

          <CensusAttentionBar
            beds={beds ?? {}}
            censusIsoDay={dailyRecordData.record?.date ?? ''}
            activeFilter={attentionFilter}
            onFilterChange={onAttentionFilterChange}
          />

          {onOpenMedicalHandoff ? (
            <button
              type="button"
              onClick={onOpenMedicalHandoff}
              aria-label="Abrir entrega médica del día"
              title="Abrir entrega médica y generar su planilla"
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
            >
              <ClipboardList size={13} strokeWidth={2.2} aria-hidden="true" />
              Entrega médica
            </button>
          ) : null}
        </div>
      </div>

      {activeDetailedRole && dailyRecordData.record?.date && readModel.staffDetailsState && (
        <StaffShiftDetailsModal
          isOpen={true}
          onClose={() => setActiveDetailedRole(null)}
          role={activeDetailedRole}
          initialShift="day"
          recordDate={dailyRecordData.record.date}
          detail={readModel.staffDetailsState}
          nursesList={nursesList}
          tensList={tensList}
          onSave={updateDetailedStaffing}
        />
      )}
    </div>
  );
};
