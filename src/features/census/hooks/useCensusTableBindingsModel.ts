import { useMemo } from 'react';

import { buildCensusTableLayoutBindings } from '@/features/census/controllers/censusTableLayoutController';
import { useClinicalDocumentPresenceByBed } from '@/features/census/hooks/useClinicalDocumentPresenceByBed';
import { useCensusTableViewModel } from '@/features/census/hooks/useCensusTableViewModel';
import { canReadClinicalDocuments } from '@/application/clinical-documents/clinicalDocumentAccessPolicy';
import { useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { useDeferredCensusEnhancement } from '@/features/census/hooks/useDeferredCensusEnhancement';

interface UseCensusTableBindingsModelParams {
  currentDateString: string;
  readOnly?: boolean;
  accessProfile?: CensusAccessProfile;
}

/**
 * Builds a set of RUTs that were discharged on this census day.
 * Used to detect same-day readmissions for the new-admission badge.
 */
const buildDischargedRuts = (
  discharges: Array<{ rut?: string }> | undefined
): ReadonlySet<string> => {
  if (!discharges || discharges.length === 0) return new Set();
  const ruts = new Set<string>();
  for (const d of discharges) {
    if (d.rut) ruts.add(d.rut);
  }
  return ruts;
};

export const useCensusTableBindingsModel = ({
  currentDateString,
  readOnly = false,
  accessProfile = 'default',
}: UseCensusTableBindingsModelParams) => {
  const { remoteSyncStatus } = useAuth();
  const tableViewModel = useCensusTableViewModel({ currentDateString });
  const canReadClinical = canReadClinicalDocuments(tableViewModel.role);
  const canResolveClinicalDocumentPresence = useDeferredCensusEnhancement(
    Boolean(tableViewModel.beds) && canReadClinical && remoteSyncStatus === 'ready'
  );
  const clinicalDocumentPresence = useClinicalDocumentPresenceByBed({
    unifiedRows: tableViewModel.unifiedRows,
    currentDateString,
    enabled: canResolveClinicalDocumentPresence,
  }) ?? {
    byBedId: {},
    infoByBedId: {},
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `?? {}` produces a stable reference across renders when byBedId is defined; memoizing it here would only add ceremony
  const clinicalDocumentPresenceByBedId = clinicalDocumentPresence.byBedId ?? {};

  const movements = useDailyRecordMovements();
  const dischargedRuts = useMemo(
    () => buildDischargedRuts(movements?.discharges),
    [movements?.discharges]
  );

  const bindings = useMemo(() => {
    if (!tableViewModel.beds) {
      return null;
    }

    return buildCensusTableLayoutBindings({
      currentDateString,
      readOnly,
      columns: tableViewModel.columns,
      isEditMode: tableViewModel.isEditMode,
      canDeleteRecord: tableViewModel.canDeleteRecord,
      resetDayDeniedMessage: tableViewModel.resetDayDeniedMessage,
      onClearAll: tableViewModel.handleClearAll,
      diagnosisMode: tableViewModel.diagnosisMode,
      accessProfile,
      onToggleDiagnosisMode: tableViewModel.toggleDiagnosisMode,
      onResizeColumn: tableViewModel.handleColumnResize,
      unifiedRows: tableViewModel.unifiedRows,
      bedTypes: tableViewModel.bedTypes,
      role: tableViewModel.role,
      clinicalDocumentPresenceByBedId,
      dischargedRuts,
      onAction: tableViewModel.handleRowAction,
      onActivateEmptyBed: tableViewModel.activateEmptyBed,
      totalWidth: tableViewModel.totalWidth,
    });
  }, [
    clinicalDocumentPresenceByBedId,
    currentDateString,
    dischargedRuts,
    readOnly,
    accessProfile,
    tableViewModel.activateEmptyBed,
    tableViewModel.bedTypes,
    tableViewModel.beds,
    tableViewModel.canDeleteRecord,
    tableViewModel.columns,
    tableViewModel.diagnosisMode,
    tableViewModel.handleClearAll,
    tableViewModel.handleColumnResize,
    tableViewModel.handleRowAction,
    tableViewModel.isEditMode,
    tableViewModel.unifiedRows,
    tableViewModel.resetDayDeniedMessage,
    tableViewModel.role,
    tableViewModel.toggleDiagnosisMode,
    tableViewModel.totalWidth,
  ]);

  return {
    isReady: Boolean(tableViewModel.beds) && Boolean(bindings),
    bindings,
    clinicalDocumentInfoByBedId: clinicalDocumentPresence.infoByBedId ?? {},
  };
};
