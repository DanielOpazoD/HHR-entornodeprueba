import React from 'react';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { PatientRow } from '@/features/census/components/PatientRow';
import { CensusEmptyBedsDividerRow } from '@/features/census/components/CensusEmptyBedsDividerRow';
import {
  resolvePatientRowMenuAlign,
  shouldRenderEmptyBedsDivider,
} from '@/features/census/controllers/censusTableBodyController';
import type { CensusTableBodyProps } from '@/features/census/types/censusTableComponentContracts';

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
