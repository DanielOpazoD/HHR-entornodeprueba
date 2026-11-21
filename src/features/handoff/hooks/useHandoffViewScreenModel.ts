import { useEffect, useMemo, useRef } from 'react';

import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordHandoffActions } from '@/context/useDailyRecordScopedActions';
import { useStaffContext } from '@/context/StaffContext';
import { useNotification } from '@/context/UIContext';
import { useAuditContext } from '@/context/AuditContext';
import { useAuth } from '@/context';
import { useHandoffLogic } from '@/hooks';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { buildHandoffClinicalEventActions } from '@/features/handoff/controllers/handoffViewBindingsController';
import { buildHandoffScreenShellModel } from '@/features/handoff/controllers/handoffViewController';
import type { HandoffClinicalEventActions } from '../components/handoffRowContracts';

interface UseHandoffViewScreenModelParams {
  readOnly?: boolean;
  ui: UseUIStateReturn;
}

export const useHandoffViewScreenModel = ({
  readOnly = false,
  ui,
}: UseHandoffViewScreenModelParams) => {
  const { record } = useDailyRecordData();
  const { updateHandoffChecklist, updateHandoffNovedades, updateHandoffReceives } =
    useDailyRecordHandoffActions();
  const { nursesList } = useStaffContext();
  const { success } = useNotification();
  const { logViewEvent, userId } = useAuditContext();
  const { role } = useAuth();
  const logViewEventRef = useRef(logViewEvent);
  const recordRef = useRef(record);

  useEffect(() => void (logViewEventRef.current = logViewEvent), [logViewEvent]);
  useEffect(() => void (recordRef.current = record), [record]);

  const handoffLogic = useHandoffLogic({
    selectedShift: ui.selectedShift,
    setSelectedShift: ui.setSelectedShift,
    onSuccess: success,
  });

  const {
    selectedShift,
    visibleBeds,
    hasAnyPatients,
    schedule,
    noteField,
    deliversList,
    receivesList,
    tensList,
    shouldShowPatient,
    handleNursingNoteChange,
    formatPrintDate,
    handleClinicalEventAdd,
    handleClinicalEventUpdate,
    handleClinicalEventDelete,
  } = handoffLogic;

  const recordDate = record?.date;
  const handoffScreenShell = useMemo(
    () =>
      buildHandoffScreenShellModel({
        selectedShift,
        role,
        readOnly,
        recordDate,
      }),
    [readOnly, recordDate, role, selectedShift]
  );
  const { screenFrame, auditDescriptor, canEditClinicalEvents } = handoffScreenShell;

  useEffect(() => {
    if (!recordDate) {
      return;
    }

    const currentRecord = recordRef.current;
    if (!currentRecord) {
      return;
    }

    const authors = getAttributedAuthors(userId, currentRecord, selectedShift);

    logViewEventRef.current(
      auditDescriptor.action,
      'dailyRecord',
      recordDate,
      auditDescriptor.details,
      undefined,
      recordDate,
      authors
    );
  }, [auditDescriptor, recordDate, selectedShift, userId]);

  useEffect(() => {
    const nextTitle = screenFrame.documentTitle;
    if (!nextTitle) {
      return;
    }

    document.title = nextTitle;
    return () => void (document.title = 'Hospital Hanga Roa');
  }, [screenFrame.documentTitle]);

  const clinicalEventActions: HandoffClinicalEventActions = useMemo(
    () =>
      buildHandoffClinicalEventActions({
        canEditClinicalEvents,
        onAdd: handleClinicalEventAdd,
        onUpdate: handleClinicalEventUpdate,
        onDelete: handleClinicalEventDelete,
      }),
    [
      canEditClinicalEvents,
      handleClinicalEventAdd,
      handleClinicalEventDelete,
      handleClinicalEventUpdate,
    ]
  );

  return {
    ui,
    record,
    title: screenFrame.title,
    readOnly: screenFrame.effectiveReadOnly,
    nursesList,
    schedule,
    noteField,
    deliversList,
    receivesList,
    tensList,
    hasAnyPatients,
    visibleBeds,
    selectedShift,
    setSelectedShift: ui.setSelectedShift,
    clinicalEventActions,
    formatPrintDate,
    shouldShowPatient,
    handleNursingNoteChange,
    updateHandoffChecklist,
    updateHandoffNovedades,
    updateHandoffReceives,
    tableHeaderClass: screenFrame.tableHeaderClass,
    Icon: screenFrame.Icon,
  };
};
