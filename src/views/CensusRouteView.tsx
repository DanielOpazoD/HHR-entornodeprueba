import React, { type ComponentProps, useMemo } from 'react';
import { CensusView } from '@/features/census/census-view';
import type { CensusMedicalHandoffActionContext } from '@/features/census/contracts/censusMedicalHandoffAction';
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

const CensusMedicalHandoffSpreadsheetAction: React.FC<CensusMedicalHandoffActionContext> = ({
  record,
  visibleBeds,
  professionalsCatalog,
}) => {
  const rows = useMemo(
    () => buildMedicalHandoffSpreadsheetRows(record, visibleBeds, professionalsCatalog),
    [professionalsCatalog, record, visibleBeds]
  );

  return <MedicalHandoffSpreadsheetAction date={record.date} rows={rows} />;
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
        ? context => <CensusMedicalHandoffSpreadsheetAction {...context} />
        : undefined
    }
  />
);
