import React from 'react';
import { useDailyRecordMovementActions } from '@/context/DailyRecordContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { CheckCircle } from 'lucide-react';
import { DISCHARGES_TABLE_HEADERS } from '@/features/census/controllers/censusDischargesTableController';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';
import { CensusMovementSection } from '@/features/census/components/CensusMovementSection';
import { DischargeRow } from '@/features/census/components/DischargeRow';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import { useMovementSectionModel } from '@/features/census/hooks/useMovementSectionModel';

// Interface for props removed as data comes from context

export const DischargesSection: React.FC = () => {
  const { recordDate, discharges } = useCensusMovementData();
  const { undoDischarge, deleteDischarge } = useDailyRecordMovementActions();
  const { handleEditDischarge } = useCensusActionCommands();
  const sectionModel = useMovementSectionModel({
    items: discharges,
    undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
    undoErrorTitle: 'No se pudo deshacer alta',
    onUndo: undoDischarge,
    deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
    deleteErrorTitle: 'No se pudo eliminar alta',
    onDelete: deleteDischarge,
  });

  return (
    <CensusMovementSection
      model={sectionModel}
      title="Altas"
      emptyMessage="No hay altas registradas para este día."
      icon={<CheckCircle size={18} />}
      iconClassName="bg-green-50 text-green-600"
      headers={DISCHARGES_TABLE_HEADERS}
      getItemKey={item => item.id}
      renderRow={item => (
        <DischargeRow
          item={item}
          recordDate={recordDate}
          onUndo={sectionModel.handleUndo}
          onEdit={handleEditDischarge}
          onDelete={sectionModel.handleDelete}
        />
      )}
    ></CensusMovementSection>
  );
};
