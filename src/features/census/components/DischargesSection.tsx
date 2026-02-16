import React from 'react';
import { useDailyRecordMovementActions } from '@/context/DailyRecordContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { CheckCircle } from 'lucide-react';
import { DISCHARGES_TABLE_HEADERS } from '@/features/census/controllers/censusDischargesTableController';
import { resolveDischargesSectionState } from '@/features/census/controllers/censusDischargesSectionController';
import {
  DISCHARGE_DELETE_CONFIRM_DIALOG,
  DISCHARGE_UNDO_CONFIRM_DIALOG,
} from '@/features/census/controllers/censusMovementActionConfirmController';
import { CensusMovementSectionLayout } from '@/features/census/components/CensusMovementSectionLayout';
import { DischargeRow } from '@/features/census/components/DischargeRow';
import { useMovementSectionActions } from '@/features/census/hooks/useMovementSectionActions';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';

// Interface for props removed as data comes from context

export const DischargesSection: React.FC = () => {
  const { recordDate, discharges } = useCensusMovementData();
  const { undoDischarge, deleteDischarge } = useDailyRecordMovementActions();
  const { handleEditDischarge } = useCensusActionCommands();
  const { handleUndo, handleDelete } = useMovementSectionActions({
    undoDialog: DISCHARGE_UNDO_CONFIRM_DIALOG,
    undoErrorTitle: 'No se pudo deshacer alta',
    onUndo: undoDischarge,
    deleteDialog: DISCHARGE_DELETE_CONFIRM_DIALOG,
    deleteErrorTitle: 'No se pudo eliminar alta',
    onDelete: deleteDischarge,
  });
  const sectionState = resolveDischargesSectionState(discharges);

  if (!sectionState.isRenderable) return null;

  return (
    <CensusMovementSectionLayout
      title="Altas"
      emptyMessage="No hay altas registradas para este día."
      icon={<CheckCircle size={18} />}
      iconClassName="bg-green-50 text-green-600"
      isEmpty={sectionState.isEmpty}
      headers={DISCHARGES_TABLE_HEADERS}
    >
      {sectionState.discharges.map(item => (
        <DischargeRow
          key={item.id}
          item={item}
          recordDate={recordDate}
          onUndo={handleUndo}
          onEdit={handleEditDischarge}
          onDelete={handleDelete}
        />
      ))}
    </CensusMovementSectionLayout>
  );
};
