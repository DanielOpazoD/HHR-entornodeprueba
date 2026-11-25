import { useMemo } from 'react';

import { buildCensusTableLayoutBindings } from '@/features/census/controllers/censusTableLayoutController';
import {
  useClinicalDocumentPresenceByBed,
  type ClinicalDocumentPresenceResult,
} from '@/features/census/hooks/useClinicalDocumentPresenceByBed';
import { useCensusTableRuntime } from '@/features/census/hooks/useCensusTableRuntime';
import { canReadClinicalDocuments } from '@/shared/access/clinicalDocumentAccessPolicy';
import { useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import { useDeferredCensusEnhancement } from '@/features/census/hooks/useDeferredCensusEnhancement';

interface UseCensusTableBindingsModelParams {
  currentDateString: string;
  readOnly?: boolean;
  clinicalEditingDisabled?: boolean;
  accessProfile?: CensusAccessProfile;
}

const EMPTY_DISCHARGED_RUTS: ReadonlySet<string> = new Set();
const EMPTY_PRESENCE_BY_BED: ClinicalDocumentPresenceResult['byBedId'] = {};
const EMPTY_INFO_BY_BED: ClinicalDocumentPresenceResult['infoByBedId'] = {};
const EMPTY_CLINICAL_DOCUMENT_PRESENCE: ClinicalDocumentPresenceResult = {
  byBedId: EMPTY_PRESENCE_BY_BED,
  infoByBedId: EMPTY_INFO_BY_BED,
};

/**
 * Builds a set of RUTs that were discharged on this census day.
 * Used to detect same-day readmissions for the new-admission badge.
 */
const buildDischargedRuts = (
  discharges: Array<{ rut?: string }> | undefined
): ReadonlySet<string> => {
  if (!discharges || discharges.length === 0) return EMPTY_DISCHARGED_RUTS;
  const ruts = new Set<string>();
  for (const d of discharges) {
    if (d.rut) ruts.add(d.rut);
  }
  return ruts;
};

export const useCensusTableBindingsModel = ({
  currentDateString,
  readOnly = false,
  clinicalEditingDisabled = false,
  accessProfile = 'default',
}: UseCensusTableBindingsModelParams) => {
  const { remoteSyncStatus } = useAuth();
  const tableViewModel = useCensusTableRuntime({ currentDateString });
  const canReadClinical = canReadClinicalDocuments(tableViewModel.role);
  const canResolveClinicalDocumentPresence = useDeferredCensusEnhancement(
    Boolean(tableViewModel.beds) && canReadClinical && remoteSyncStatus === 'ready'
  );
  const clinicalDocumentPresence =
    useClinicalDocumentPresenceByBed({
      unifiedRows: tableViewModel.unifiedRows,
      currentDateString,
      enabled: canResolveClinicalDocumentPresence,
    }) ?? EMPTY_CLINICAL_DOCUMENT_PRESENCE;
  const clinicalDocumentPresenceByBedId = clinicalDocumentPresence.byBedId ?? EMPTY_PRESENCE_BY_BED;

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
      clinicalEditingDisabled,
      columns: tableViewModel.columns,
      isEditMode: tableViewModel.isEditMode,
      canDeleteRecord: tableViewModel.canDeleteRecord,
      resetDayDeniedMessage: tableViewModel.resetDayDeniedMessage,
      onClearAll: tableViewModel.handleClearAll,
      accessProfile,
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
    clinicalEditingDisabled,
    dischargedRuts,
    readOnly,
    accessProfile,
    tableViewModel.activateEmptyBed,
    tableViewModel.bedTypes,
    tableViewModel.beds,
    tableViewModel.canDeleteRecord,
    tableViewModel.columns,
    tableViewModel.handleClearAll,
    tableViewModel.handleColumnResize,
    tableViewModel.handleRowAction,
    tableViewModel.isEditMode,
    tableViewModel.unifiedRows,
    tableViewModel.resetDayDeniedMessage,
    tableViewModel.role,
    tableViewModel.totalWidth,
  ]);

  return {
    isReady: Boolean(tableViewModel.beds) && Boolean(bindings),
    bindings,
    clinicalDocumentInfoByBedId: clinicalDocumentPresence.infoByBedId ?? EMPTY_INFO_BY_BED,
  };
};
