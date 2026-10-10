import React, { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import type { Statistics } from '@/types/domain/statistics';
import { NurseSelector } from './NurseSelector';
import { TensSelector } from './TensSelector';
import { BaseModal } from '@/components/shared/BaseModal';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
const StaffShiftDetailsModal = lazyWithRetry(() =>
  import('./StaffShiftDetailsModal').then(module => ({ default: module.StaffShiftDetailsModal }))
);
import { CensusSummarySwitcher } from './CensusSummarySwitcher';
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
  import('@/features/rayen-import/RayenImportButton').then(module => ({
    default: module.RayenImportButton,
  }))
);
import { RayenOperationsLoadingCard } from './RayenOperationsLoadingCard';
import { useCensusToolbarMenuTarget } from '@/shared/ui/CensusToolbarMenuTargetContext';
import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { RenderCensusMedicalHandoffAction } from '@/features/census/contracts/censusMedicalHandoffAction';

interface CensusStaffHeaderProps {
  selectedDate?: string;
  readOnly?: boolean;
  stats: Statistics | null;
  accessProfile?: CensusAccessProfile;
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
  const [activeDetail, setActiveDetail] = React.useState<{
    role: DetailedStaffingRole;
    date: string;
  } | null>(null);
  const recordDate = dailyRecordData.record?.date;
  const openDetail = (role: DetailedStaffingRole) => {
    if (recordDate && canEditDetail) setActiveDetail({ role, date: recordDate });
  };
  const closeDetail = () => setActiveDetail(null);
  const readModel = buildCensusStaffHeaderReadModel({
    readOnly,
    stats,
    accessProfile,
    beds,
    recordDate: dailyRecordData.record?.date,
    staffData,
    movementsData,
  });
  const canEditDetail = !readOnly && !readModel.specialistAccess;
  React.useEffect(() => {
    // Discard the edit intent when its date or edit access changes.
    setActiveDetail(previous => (canEditDetail && previous?.date === recordDate ? previous : null));
  }, [canEditDetail, recordDate]);

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
              onOpenDetailedStaffing={readOnly ? undefined : () => openDetail('nurse')}
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
              onOpenDetailedStaffing={readOnly ? undefined : () => openDetail('tens')}
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
              <CensusSummarySwitcher
                date={recordDate ?? selectedDate ?? ''}
                stats={stats}
                discharges={readModel.movementSummaryState.discharges}
                transfers={readModel.movementSummaryState.transfers}
                cmaCount={readModel.movementSummaryState.cmaCount}
                newAdmissions={readModel.movementSummaryState.admissionsCount}
              />
            )}
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

      {canEditDetail &&
        activeDetail &&
        activeDetail.date === recordDate &&
        readModel.staffDetailsState && (
          <Suspense
            fallback={
              <BaseModal
                isOpen
                onClose={closeDetail}
                title={`Configuración detallada ${activeDetail.role === 'nurse' ? 'Enfermería' : 'TENS'}`}
                size="3xl"
                variant="white"
              >
                <p role="status">Cargando dotación…</p>
              </BaseModal>
            }
          >
            <StaffShiftDetailsModal
              isOpen={true}
              onClose={closeDetail}
              role={activeDetail.role}
              initialShift="day"
              recordDate={activeDetail.date}
              detail={readModel.staffDetailsState}
              nursesList={nursesList}
              tensList={tensList}
              onSave={updateDetailedStaffing}
            />
          </Suspense>
        )}
    </div>
  );
};
