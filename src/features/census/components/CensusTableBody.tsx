import React from 'react';
import type {
  BedTypesById,
  DiagnosisMode,
  OccupiedBedRow,
} from '@/features/census/types/censusTableTypes';
import type { BedDefinition, PatientData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { PatientRow } from '@/features/census/components/PatientRow';
import { CensusEmptyBedsDividerRow } from '@/features/census/components/CensusEmptyBedsDividerRow';
import {
  resolvePatientRowMenuAlign,
  shouldRenderEmptyBedsDivider,
} from '@/features/census/controllers/censusTableBodyController';

export interface CensusTableBodyProps {
  occupiedRows: OccupiedBedRow[];
  emptyBeds: BedDefinition[];
  currentDateString: string;
  readOnly: boolean;
  diagnosisMode: DiagnosisMode;
  bedTypes: BedTypesById;
  onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
  onActivateEmptyBed: (bedId: string) => void;
}

export const CensusTableBody: React.FC<CensusTableBodyProps> = ({
  occupiedRows,
  emptyBeds,
  currentDateString,
  readOnly,
  diagnosisMode,
  bedTypes,
  onAction,
  onActivateEmptyBed,
}) => {
  const showEmptyBedsDivider = shouldRenderEmptyBedsDivider(emptyBeds.length);

  return (
    <tbody>
      {occupiedRows.map((row, index) => (
        <PatientRow
          key={row.id}
          bed={row.bed}
          data={row.data}
          currentDateString={currentDateString}
          onAction={onAction}
          readOnly={readOnly}
          actionMenuAlign={resolvePatientRowMenuAlign(index, occupiedRows.length)}
          diagnosisMode={diagnosisMode}
          isSubRow={row.isSubRow}
          bedType={bedTypes[row.bed.id]}
        />
      ))}

      {showEmptyBedsDivider ? (
        <CensusEmptyBedsDividerRow emptyBedsCount={emptyBeds.length} />
      ) : null}

      {emptyBeds.map(bed => (
        <EmptyBedRow
          key={bed.id}
          bed={bed}
          readOnly={readOnly}
          onClick={() => onActivateEmptyBed(bed.id)}
        />
      ))}
    </tbody>
  );
};
