import React from 'react';
import { Scissors } from 'lucide-react';

import {
  useDailyRecordBedActions,
  useDailyRecordMovementActions,
} from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { CMA_TABLE_HEADERS } from '@/features/census/controllers/censusCmaTableController';
import { CensusMovementSection } from '@/features/census/components/CensusMovementSection';
import { CmaSectionRow } from '@/features/census/components/CmaSectionRow';
import { useCmaSectionModel } from '@/features/census/hooks/useCmaSectionModel';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';

export const CMASection: React.FC = () => {
  const { cma } = useCensusMovementData();
  const { deleteCMA, updateCMA } = useDailyRecordMovementActions();
  const { updatePatientMultiple } = useDailyRecordBedActions();
  const { confirm } = useConfirmDialog();
  const { error: notifyError } = useNotification();
  const sectionModel = useCmaSectionModel({
    cma,
    confirm,
    notifyError,
    updateCMA,
    updatePatientMultiple,
    deleteCMA,
  });

  return (
    <CensusMovementSection
      model={sectionModel}
      title="Hospitalización Diurna"
      subtitle="CMA / PMA"
      emptyMessage="No hay registros de Hospitalización Diurna para hoy."
      icon={<Scissors size={18} />}
      iconClassName="bg-medical-50 text-medical-600"
      headers={CMA_TABLE_HEADERS}
      rootClassName="print:break-inside-avoid"
      tableClassName="w-full text-sm text-left"
      bodyClassName="divide-y divide-slate-100"
      getItemKey={item => item.id}
      renderRow={item => (
        <CmaSectionRow
          item={item}
          onUpdate={sectionModel.handleUpdate}
          onUndo={sectionModel.handleUndo}
          onDelete={sectionModel.handleDelete}
        />
      )}
    ></CensusMovementSection>
  );
};
