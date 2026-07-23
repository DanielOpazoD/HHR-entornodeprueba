import React from 'react';
import { CheckCircle } from 'lucide-react';
import { DISCHARGES_TABLE_HEADERS } from '@/features/census/controllers/censusDischargesTableController';
import { CensusMovementSection } from '@/features/census/components/CensusMovementSection';
import { DischargeRow } from '@/features/census/components/DischargeRow';
import { useDischargesSectionModel } from '@/features/census/hooks/useDischargesSectionModel';

// Interface for props removed as data comes from context

export const DischargesSection: React.FC = () => {
  const {
    recordDate,
    sectionModel,
    handleEditDischarge,
    handleConvertDischargeToCma,
    handleConvertDischargeToTransfer,
  } = useDischargesSectionModel();

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
          onConvertToCma={handleConvertDischargeToCma}
          onConvertToTransfer={handleConvertDischargeToTransfer}
        />
      )}
    />
  );
};
