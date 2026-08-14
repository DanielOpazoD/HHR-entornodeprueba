import React, { type ComponentProps } from 'react';
import { CensusView } from '@/features/census/census-view';
import {
  buildMedicalHandoffSpreadsheetRows,
  MedicalHandoffSpreadsheetAction,
} from '@/features/handoff/medical-handoff-spreadsheet';

type CensusRouteViewProps = Omit<
  ComponentProps<typeof CensusView>,
  'renderMedicalHandoffAction'
> & {
  canOpenMedicalHandoffSpreadsheet?: boolean;
};

/** Composes cross-feature actions at the route boundary, outside the census feature. */
export const CensusRouteView: React.FC<CensusRouteViewProps> = ({
  canOpenMedicalHandoffSpreadsheet = false,
  ...censusProps
}) => (
  <CensusView
    {...censusProps}
    renderMedicalHandoffAction={
      canOpenMedicalHandoffSpreadsheet
        ? ({ record, visibleBeds, professionalsCatalog }) => (
            <MedicalHandoffSpreadsheetAction
              date={record.date}
              rows={buildMedicalHandoffSpreadsheetRows(record, visibleBeds, professionalsCatalog)}
            />
          )
        : undefined
    }
  />
);
