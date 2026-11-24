/**
 * Everything the nursing handoff screen reads and does, in one hook.
 *
 * The staff lists (`deliversList`, `receivesList`, `tensList`) come straight from the census
 * staffing of the day, so a staff change in the census shows here at once. Do not add
 * handoff-only staff lists.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { BEDS } from '@/constants/beds';
import { useAuditContext } from '@/context/AuditContext';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import {
  useDailyRecordBedActions,
  useDailyRecordHandoffActions,
} from '@/context/useDailyRecordScopedActions';
import { useStaffContext } from '@/context/StaffContext';
import { useNotification } from '@/context/UIContext';
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { resolveHandoffShiftStaff } from '@/services/staff/dailyRecordStaffing';
import { resolveHandoffDocumentTitleLabel } from '@/shared/handoff/handoffPresentation';
import type { BedDefinition } from '@/types/domain/beds';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import { DEFAULT_SHIFT_SCHEDULE, getShiftSchedule } from '@/utils/clinicalDayUtils';
import {
  appendClinicalEvent,
  buildAddedClinicalEvent,
  buildClinicalEventAuditPayload,
  buildClinicalEventSuccessFeedback,
  buildNursingNoteChange,
  getVisibleHandoffBeds,
  removeClinicalEventFromList,
  resolveHandoffAuditDescriptor,
  resolveHandoffTableHeaderClass,
  resolveHandoffTitle,
  resolveNursingNoteField,
  shouldShowHandoffPatient,
  updateClinicalEventList,
} from '@/features/handoff/controllers/handoffViewController';
import type { HandoffClinicalEventActions } from '../components/handoffRowContracts';

const EMPTY_BEDS: BedDefinition[] = [];
const EMPTY_STRING_ARRAY: string[] = [];

interface UseHandoffViewScreenModelParams {
  readOnly?: boolean;
  ui: UseUIStateReturn;
}

export const useHandoffViewScreenModel = ({
  readOnly = false,
  ui,
}: UseHandoffViewScreenModelParams) => {
  const { selectedShift, setSelectedShift } = ui;
  const { record } = useDailyRecordData();
  const { updatePatient, updatePatientMultiple, updateClinicalCribMultiple } =
    useDailyRecordBedActions();
  const { updateHandoffChecklist, updateHandoffNovedades, updateHandoffReceives } =
    useDailyRecordHandoffActions();
  const { nursesList } = useStaffContext();
  const { success } = useNotification();
  const { logViewEvent, logDebouncedEvent, userId } = useAuditContext();
  const logViewEventRef = useRef(logViewEvent);
  const recordRef = useRef(record);

  useLayoutEffect(() => {
    logViewEventRef.current = logViewEvent;
    recordRef.current = record;
  }, [logViewEvent, record]);

  const hasRecord = Boolean(record);
  const recordDate = record?.date;
  const recordBeds = record?.beds;
  const activeExtraBeds = record?.activeExtraBeds;
  const rawTensList = selectedShift === 'day' ? record?.tensDayShift : record?.tensNightShift;

  // ========== READ ==========
  const schedule = useMemo(
    () => (recordDate ? getShiftSchedule(recordDate) : DEFAULT_SHIFT_SCHEDULE),
    [recordDate]
  );
  const visibleBeds = useMemo(
    () =>
      hasRecord
        ? getVisibleHandoffBeds({ activeExtraBeds: activeExtraBeds ?? EMPTY_STRING_ARRAY }, BEDS)
        : EMPTY_BEDS,
    [hasRecord, activeExtraBeds]
  );
  const shouldShowPatient = useCallback(
    (bedId: string): boolean =>
      recordDate && recordBeds
        ? shouldShowHandoffPatient({ date: recordDate, beds: recordBeds }, bedId, selectedShift)
        : false,
    [recordDate, recordBeds, selectedShift]
  );
  const hasAnyPatients = useMemo(
    () => visibleBeds.some(bed => shouldShowPatient(bed.id)),
    [visibleBeds, shouldShowPatient]
  );
  const resolvedShiftStaff = resolveHandoffShiftStaff(record, selectedShift);
  const deliversKey = resolvedShiftStaff.delivers.join('\0');
  const receivesKey = resolvedShiftStaff.receives.join('\0');
  const deliversList = useMemo(
    () => (deliversKey ? deliversKey.split('\0') : EMPTY_STRING_ARRAY),
    [deliversKey]
  );
  const receivesList = useMemo(
    () => (receivesKey ? receivesKey.split('\0') : EMPTY_STRING_ARRAY),
    [receivesKey]
  );
  const tensList = useMemo(() => rawTensList || EMPTY_STRING_ARRAY, [rawTensList]);
  const auditDescriptor = useMemo(
    () => resolveHandoffAuditDescriptor(selectedShift),
    [selectedShift]
  );
  const documentTitle = resolveHandoffDocumentTitleLabel({ selectedShift, recordDate });

  // ========== EFFECTS ==========
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
    if (!documentTitle) {
      return;
    }

    document.title = documentTitle;
    return () => void (document.title = 'Hospital Hanga Roa');
  }, [documentTitle]);

  // ========== NURSING NOTE ==========
  const handleNursingNoteChange = useCallback(
    (bedId: string, value: string, isNested: boolean = false) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;

      const bed = currentRecord.beds[bedId];
      const patient = isNested ? bed?.clinicalCrib : bed;
      const { noteKey, fields, oldNote } = buildNursingNoteChange({
        selectedShift,
        patient,
        value,
      });

      void (isNested ? updateClinicalCribMultiple : updatePatientMultiple)(bedId, fields);

      if (!patient) return;

      logDebouncedEvent(
        'NURSE_HANDOFF_MODIFIED',
        'patient',
        bedId,
        {
          patientName: patient.patientName || (isNested ? 'Cuna' : 'ANONYMOUS'),
          shift: selectedShift,
          note: value,
          changes: { [noteKey]: { old: oldNote, new: value } },
        },
        patient.rut,
        currentRecord.date,
        undefined,
        30000
      );
    },
    [logDebouncedEvent, selectedShift, updateClinicalCribMultiple, updatePatientMultiple]
  );

  // ========== CLINICAL EVENTS ==========
  const handleClinicalEventAdd = useCallback(
    (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const patient = currentRecord.beds[bedId];
      if (!patient) return;

      const newEvent = buildAddedClinicalEvent(
        event,
        () => crypto.randomUUID(),
        () => new Date().toISOString()
      );
      const auditPayload = buildClinicalEventAuditPayload(
        'CLINICAL_EVENT_ADDED',
        bedId,
        event.name,
        currentRecord.date
      );
      const successFeedback = buildClinicalEventSuccessFeedback(event.name);

      updatePatient(bedId, 'clinicalEvents', appendClinicalEvent(patient, newEvent));

      logDebouncedEvent(
        auditPayload.action,
        auditPayload.entityType,
        auditPayload.entityId,
        auditPayload.details,
        auditPayload.patientRut,
        auditPayload.recordDate,
        auditPayload.authors,
        auditPayload.waitMs
      );

      success(successFeedback.title, successFeedback.description);
    },
    [logDebouncedEvent, success, updatePatient]
  );

  const handleClinicalEventUpdate = useCallback(
    (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const patient = currentRecord.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      updatePatient(bedId, 'clinicalEvents', updateClinicalEventList(patient, eventId, data));
    },
    [updatePatient]
  );

  const handleClinicalEventDelete = useCallback(
    (bedId: string, eventId: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const patient = currentRecord.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      const { nextEvents, deletedEvent } = removeClinicalEventFromList(patient, eventId);
      updatePatient(bedId, 'clinicalEvents', nextEvents);

      if (deletedEvent) {
        const auditPayload = buildClinicalEventAuditPayload(
          'CLINICAL_EVENT_DELETED',
          bedId,
          deletedEvent.name,
          currentRecord.date
        );
        logDebouncedEvent(
          auditPayload.action,
          auditPayload.entityType,
          auditPayload.entityId,
          auditPayload.details,
          auditPayload.patientRut,
          auditPayload.recordDate,
          auditPayload.authors,
          auditPayload.waitMs
        );
      }
    },
    [logDebouncedEvent, updatePatient]
  );

  // Who may open this screen and edit it is decided once, by the router's access predicate
  // (`readOnly`); a read-only screen offers no clinical event actions.
  const clinicalEventActions: HandoffClinicalEventActions = useMemo(
    () =>
      readOnly
        ? {}
        : {
            onAdd: handleClinicalEventAdd,
            onUpdate: handleClinicalEventUpdate,
            onDelete: handleClinicalEventDelete,
          },
    [readOnly, handleClinicalEventAdd, handleClinicalEventDelete, handleClinicalEventUpdate]
  );

  const formatPrintDate = useCallback(() => {
    if (!recordDate) return '';
    const [year, month, day] = recordDate.split('-');
    return `${day}-${month}-${year}`;
  }, [recordDate]);

  return {
    record,
    title: resolveHandoffTitle(selectedShift),
    readOnly,
    nursesList,
    schedule,
    noteField: resolveNursingNoteField(selectedShift),
    deliversList,
    receivesList,
    tensList,
    hasAnyPatients,
    visibleBeds,
    selectedShift,
    setSelectedShift,
    clinicalEventActions,
    formatPrintDate,
    shouldShowPatient,
    handleNursingNoteChange,
    updateHandoffChecklist,
    updateHandoffNovedades,
    updateHandoffReceives,
    tableHeaderClass: resolveHandoffTableHeaderClass(selectedShift),
  };
};
