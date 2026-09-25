import React, { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
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
// The Rayen import machinery is only needed once the operator uses it, so the census
// table no longer downloads it just to render the toolbar.
const RayenImportButton = lazy(() =>
  import('@/features/rayen-import').then(module => ({ default: module.RayenImportButton }))
);
const SpecialtyRoundEntry = lazy(() =>
  import('./specialty-round/SpecialtyRoundEntry').then(module => ({
    default: module.SpecialtyRoundEntry,
  }))
);

// Keep the Eloísa card in place while its heavier synchronization module loads.
// This shell has no controls or connection claim until the extension has been checked.
const RayenOperationsLoadingCard = () => (
  <div
    className="flex h-full min-h-20 w-full items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    role="status"
    aria-busy="true"
    aria-label="Cargando panel de Eloísa"
    data-testid="rayen-operations-loading"
  >
    <img src="/images/logos/rayen-mark.png" alt="" className="size-8 shrink-0 object-contain" />
    <div className="min-w-0">
      <p className="text-[13px] font-semibold leading-tight text-slate-800">Eloísa</p>
      <p className="text-[10px] leading-tight text-slate-500">Cargando controles…</p>
    </div>
  </div>
);
import { useCensusToolbarMenuTarget } from '@/shared/ui/CensusToolbarMenuTargetContext';
import { CensusAttentionBar } from './CensusAttentionBar';
import type { CensusAttentionFilter } from '@/features/census/controllers/rowAcuityController';
import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { RenderCensusMedicalHandoffAction } from '@/features/census/contracts/censusMedicalHandoffAction';

interface CensusStaffHeaderProps {
  selectedDate?: string;
  readOnly?: boolean;
  stats: Statistics | null;
  accessProfile?: CensusAccessProfile;
  attentionFilter?: CensusAttentionFilter;
  onAttentionFilterChange?: (filter: CensusAttentionFilter) => void;
  visibleBeds?: readonly BedDefinition[];
  renderMedicalHandoffAction?: RenderCensusMedicalHandoffAction;
  rayenBootstrapRequestId?: number;
  onRayenBootstrapHandled?: () => void;
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
  visibleBeds = [],
  renderMedicalHandoffAction,
  rayenBootstrapRequestId,
  onRayenBootstrapHandled,
}) => {
  const dailyRecordData = useDailyRecordData();
  const handoffTarget = useCensusToolbarMenuTarget();
  const beds = useDailyRecordBeds();
  const staffData = useDailyRecordStaff();
  const movementsData = useDailyRecordMovements();

  const { updateNurse, updateTens, updateDetailedStaffing } = useDailyRecordStaffActions();
  const { nursesList, tensList, professionalsCatalog = [] } = useStaffContext();
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
    // animate-fade-in crea un stacking context propio (z auto), así que los
    // popovers de la barra (monitor Eloísa, chip de pendientes) quedaban
    // DEBAJO de la tabla aunque la barra suba a z-70. La elevación es
    // CONDICIONAL (has-[[data-overlay-open]], atributo que la barra publica
    // solo con un popover abierto): un z estático aquí tapaba los menús del
    // toolbar y de la primera fila que solapan el header (cazado por e2e).
    <div className="flex w-full flex-col items-center gap-2 animate-fade-in has-[[data-overlay-open]]:relative has-[[data-overlay-open]]:z-40">
      <div className="flex w-full flex-col items-stretch gap-2">
        <div
          className="census-toolbar flex flex-wrap items-stretch justify-center gap-2 xl:flex-nowrap"
          data-testid="census-staff-and-sync"
        >
          {/* Staff Selectors */}
          {!readModel.specialistAccess && (
            <NurseSelector
              nursesDayShift={readModel.staffSelectorsState.nursesDayShift}
              nursesNightShift={readModel.staffSelectorsState.nursesNightShift}
              nursesList={nursesList}
              onUpdateNurse={updateNurse}
              shiftIndicators={readModel.staffIndicatorsState.nurseIndicators}
              onOpenDetailedStaffing={readOnly ? undefined : () => setActiveDetailedRole('nurse')}
              className={`self-stretch ${readModel.selectorsClassName}`}
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
              className={`self-stretch ${readModel.selectorsClassName}`}
            />
          )}

          {!readOnly && !readModel.specialistAccess && (
            <div className="w-60 max-w-full shrink-0 self-stretch">
              <Suspense fallback={<RayenOperationsLoadingCard />}>
                <RayenImportButton
                  selectedDate={selectedDate}
                  autoStartRequestId={rayenBootstrapRequestId}
                  onAutoStartHandled={onRayenBootstrapHandled}
                />
              </Suspense>
            </div>
          )}

          {/* Combined Stats Summary Card */}
          <div className="census-toolbar-summary flex min-w-0 shrink-0 items-stretch justify-center gap-2">
            {readModel.showSummary && stats && (
              <CombinedSummaryCard
                stats={stats}
                discharges={readModel.movementSummaryState.discharges}
                transfers={readModel.movementSummaryState.transfers}
                cmaCount={readModel.movementSummaryState.cmaCount}
                newAdmissions={readModel.movementSummaryState.admissionsCount}
              />
            )}
            <div className="census-toolbar-quick-actions flex items-center gap-2 border-l border-slate-200 pl-2">
              <CensusAttentionBar
                beds={beds ?? {}}
                censusIsoDay={dailyRecordData.record?.date ?? ''}
                activeFilter={attentionFilter}
                onFilterChange={onAttentionFilterChange}
              />
              {dailyRecordData.record?.date && (
                <Suspense fallback={null}>
                  <SpecialtyRoundEntry
                    date={dailyRecordData.record.date}
                    disabled={Boolean(readOnly)}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </div>

      {handoffTarget && renderMedicalHandoffAction && dailyRecordData.record
        ? createPortal(
            renderMedicalHandoffAction({
              record: dailyRecordData.record,
              visibleBeds,
              professionalsCatalog,
            }),
            handoffTarget
          )
        : null}

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
