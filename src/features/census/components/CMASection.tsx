import React from 'react';
import { Scissors } from 'lucide-react';

import {
  useDailyRecordBedActions,
  useDailyRecordMovementActions,
} from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { CMA_TABLE_HEADERS } from '@/features/census/controllers/censusCmaTableController';
import { CensusMovementSectionLayout } from '@/features/census/components/CensusMovementSectionLayout';
import { CmaSectionRow } from '@/features/census/components/CmaSectionRow';
import { resolveCmaSectionState } from '@/features/census/controllers/censusCmaSectionController';
import { useCmaSectionActions } from '@/features/census/hooks/useCmaSectionActions';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';

export const CMASection: React.FC = () => {
  const { cma } = useCensusMovementData();
  const { deleteCMA, updateCMA } = useDailyRecordMovementActions();
  const { updatePatientMultiple } = useDailyRecordBedActions();
  const { confirm } = useConfirmDialog();
  const { error: notifyError } = useNotification();
  const sectionState = resolveCmaSectionState(cma);
  const { handleUpdate, handleUndo, handleDelete } = useCmaSectionActions({
    confirm,
    notifyError,
    updateCMA,
    updatePatientMultiple,
    deleteCMA,
  });

  if (!sectionState.isRenderable) return null;

  return (
    <CensusMovementSectionLayout
      title="Hospitalización Diurna"
      subtitle="CMA / PMA"
      emptyMessage="No hay registros de Hospitalización Diurna para hoy."
      icon={<Scissors size={18} />}
      iconClassName="bg-medical-50 text-medical-600"
      isEmpty={sectionState.isEmpty}
      headers={CMA_TABLE_HEADERS}
      rootClassName="print:break-inside-avoid"
      tableClassName="w-full text-sm text-left"
      bodyClassName="divide-y divide-slate-100"
    >
      {sectionState.cma.map(item => (
        <CmaSectionRow
          key={item.id}
          item={item}
          onUpdate={handleUpdate}
          onUndo={handleUndo}
          onDelete={handleDelete}
        />
      ))}
    </CensusMovementSectionLayout>
  );
};
