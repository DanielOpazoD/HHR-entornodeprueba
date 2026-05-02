import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { CensusTableHeader } from '@/features/census/components/CensusTableHeader';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { useCensusTableBindingsModel } from '@/features/census/hooks/useCensusTableBindingsModel';
import { DragDropConfirmation } from '@/features/census/drag-drop/DragDropConfirmation';
import { useCensusTableDragDrop } from '@/features/census/drag-drop/useCensusTableDragDrop';
import { useDailyRecordBeds } from '@/context/DailyRecordContext';
import { useDailyRecordBedActions } from '@/context/useDailyRecordScopedActions';
import { ViewLoader } from '@/components/ui/ViewLoader';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { hasMeaningfulPatientIdentity } from '@/features/census/controllers/patientIdentityController';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
export type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

const LazyDemographicsModal = lazy(() =>
  import('@/components/modals/DemographicsModal').then(module => ({
    default: module.DemographicsModal,
  }))
);

interface CensusTableProps {
  currentDateString: string;
  readOnly?: boolean;
  accessProfile?: CensusAccessProfile;
}

export const CensusTable: React.FC<CensusTableProps> = ({
  currentDateString,
  readOnly = false,
  accessProfile = 'default',
}) => {
  const [activeEmptyBedId, setActiveEmptyBedId] = useState<string | null>(null);
  const { isReady, bindings, clinicalDocumentInfoByBedId } = useCensusTableBindingsModel({
    currentDateString,
    readOnly,
    accessProfile,
  });

  const { moveOrCopyPatient, updatePatientMultiple } = useDailyRecordBedActions();
  const beds = useDailyRecordBeds();

  const handleMoveToBed = useCallback(
    (sourceBedId: string, targetBedId: string) => {
      moveOrCopyPatient('move', sourceBedId, targetBedId);
    },
    [moveOrCopyPatient]
  );

  const dragDrop = useCensusTableDragDrop(handleMoveToBed, beds ?? {});

  const emptyBedData = useMemo(
    () => (activeEmptyBedId ? createEmptyPatient(activeEmptyBedId) : null),
    [activeEmptyBedId]
  );

  const closeEmptyBedDemographics = useCallback(() => {
    setActiveEmptyBedId(null);
  }, []);

  const openEmptyBedDemographics = useCallback((bedId: string) => {
    setActiveEmptyBedId(bedId);
  }, []);

  const saveEmptyBedDemographics = useCallback(
    (updatedFields: Partial<PatientData>) => {
      if (!activeEmptyBedId) {
        return;
      }

      if (!hasMeaningfulPatientIdentity(updatedFields)) {
        closeEmptyBedDemographics();
        return;
      }

      updatePatientMultiple(activeEmptyBedId, updatedFields);
      closeEmptyBedDemographics();
    },
    [activeEmptyBedId, closeEmptyBedDemographics, updatePatientMultiple]
  );

  if (!isReady || !bindings) return <ViewLoader />;

  const { headerProps, bodyProps, tableStyle } = bindings;

  return (
    <div className="card print:border-none print:shadow-none !overflow-visible">
      <div className="relative overflow-visible">
        <table
          data-testid="census-table"
          className="text-left border-collapse print:text-xs relative text-[12px] leading-tight table-fixed"
          style={tableStyle}
        >
          <CensusTableHeader {...headerProps} />
          <CensusTableBody
            {...bodyProps}
            onActivateEmptyBed={openEmptyBedDemographics}
            dragDrop={readOnly ? undefined : dragDrop}
            clinicalDocumentInfoByBedId={clinicalDocumentInfoByBedId}
          />
        </table>
      </div>

      {dragDrop.state.pendingMove && (
        <DragDropConfirmation
          move={dragDrop.state.pendingMove}
          onConfirm={dragDrop.confirmationHandlers.onConfirm}
          onCancel={dragDrop.confirmationHandlers.onCancel}
        />
      )}

      {activeEmptyBedId && emptyBedData ? (
        <Suspense fallback={null}>
          <LazyDemographicsModal
            isOpen
            onClose={closeEmptyBedDemographics}
            onCancel={closeEmptyBedDemographics}
            onEmptySave={closeEmptyBedDemographics}
            data={emptyBedData}
            onSave={saveEmptyBedDemographics}
            bedId={activeEmptyBedId}
            recordDate={currentDateString}
            requiresCompleteDemographics
          />
        </Suspense>
      ) : null}
    </div>
  );
};
