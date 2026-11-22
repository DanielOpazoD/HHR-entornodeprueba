/**
 * Everything the nursing handoff screen reads and does, in one hook.
 *
 * The staff lists (`deliversList`, `receivesList`, `tensList`) come straight from the census
 * staffing of the day, so a staff change in the census shows here at once. Do not add
 * handoff-only staff lists.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';

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
import {
  buildClinicalEventAuditPayload,
  buildClinicalEventSuccessFeedback,
} from '@/features/handoff/controllers/clinicalEventFeedbackController';
import {
  appendClinicalEvent,
  buildAddedClinicalEvent,
  removeClinicalEventFromList,
  updateClinicalEventList,
} from '@/features/handoff/controllers/clinicalEventMutationController';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { resolveHandoffShiftStaff } from '@/services/staff/dailyRecordStaffing';
import { resolveHandoffDocumentTitleLabel } from '@/shared/handoff/handoffPresentation';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import { DEFAULT_SHIFT_SCHEDULE, getShiftSchedule } from '@/utils/clinicalDayUtils';
import {
  buildNursingNoteChange,
  getVisibleHandoffBeds,
  resolveHandoffAuditDescriptor,
  resolveHandoffTableHeaderClass,
  resolveHandoffTitle,
  resolveNursingNoteField,
  shouldShowHandoffPatient,
} from '@/features/handoff/controllers/handoffViewController';
import type { HandoffClinicalEventActions } from '../components/handoffRowContracts';

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

  useEffect(() => void (logViewEventRef.current = logViewEvent), [logViewEvent]);
  useEffect(() => void (recordRef.current = record), [record]);

  const recordDate = record?.date;

  // ========== READ ==========
  const schedule = useMemo(
    () => (recordDate ? getShiftSchedule(recordDate) : DEFAULT_SHIFT_SCHEDULE),
    [recordDate]
  );
  const visibleBeds = useMemo(() => getVisibleHandoffBeds(record, BEDS), [record]);
  const shouldShowPatient = useCallback(
    (bedId: string): boolean => shouldShowHandoffPatient(record, bedId, selectedShift),
    [record, selectedShift]
  );
  const hasAnyPatients = useMemo(
    () => visibleBeds.some(bed => shouldShowPatient(bed.id)),
    [visibleBeds, shouldShowPatient]
  );
  const { delivers: deliversList, receives: receivesList } = useMemo(
    () => resolveHandoffShiftStaff(record, selectedShift),
    [record, selectedShift]
  );
  const tensList = useMemo(
    () => (selectedShift === 'day' ? record?.tensDayShift : record?.tensNightShift) || [],
    [record, selectedShift]
  );
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
      if (!record) return;

      const bed = record.beds[bedId];
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
        record.date,
        undefined,
        30000
      );
    },
    [logDebouncedEvent, record, selectedShift, updateClinicalCribMultiple, updatePatientMultiple]
  );

  // ========== CLINICAL EVENTS ==========
  const handleClinicalEventAdd = useCallback(
    (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => {
      if (!record) return;
      const patient = record.beds[bedId];
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
        record.date
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
    [logDebouncedEvent, record, success, updatePatient]
  );

  const handleClinicalEventUpdate = useCallback(
    (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => {
      if (!record) return;
      const patient = record.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      updatePatient(bedId, 'clinicalEvents', updateClinicalEventList(patient, eventId, data));
    },
    [record, updatePatient]
  );

  const handleClinicalEventDelete = useCallback(
    (bedId: string, eventId: string) => {
      if (!record) return;
      const patient = record.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      const { nextEvents, deletedEvent } = removeClinicalEventFromList(patient, eventId);
      updatePatient(bedId, 'clinicalEvents', nextEvents);

      if (deletedEvent) {
        const auditPayload = buildClinicalEventAuditPayload(
          'CLINICAL_EVENT_DELETED',
          bedId,
          deletedEvent.name,
          record.date
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
    [logDebouncedEvent, record, updatePatient]
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
