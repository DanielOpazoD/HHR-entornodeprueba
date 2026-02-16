/**
 * useHandoffLogic Hook
 * Extracted from HandoffView.tsx for better separation of concerns.
 * Handles handoff state management, note sync, and WhatsApp integration.
 *
 * ## CRITICAL DESIGN PHILOSOPHY
 *
 * **Census is the Single Source of Truth for Staff**
 *
 * The staff lists displayed in the Handoff view (`deliversList`, `receivesList`, `tensList`)
 * are derived DIRECTLY from the Census Daily data:
 * - `nursesDayShift` / `nursesNightShift` → Nurses delivering/receiving
 * - `tensDayShift` / `tensNightShift` → TENS on duty
 *
 * This design ensures:
 * 1. No synchronization issues between Census and Handoff views
 * 2. Staff changes in Census immediately reflect in Handoff
 * 3. No duplicate data storage that could become inconsistent
 *
 * **DO NOT** create separate handoff-specific staff lists (e.g., `handoffDayDelivers`).
 * Any such fields should be considered deprecated.
 *
 * @see useNurseManagement - Manages staff updates in the Census
 * @see useTensManagement - Manages TENS updates in the Census
 */

import { useCallback, useMemo } from 'react';
import { ClinicalEvent } from '@/types';
import { getShiftSchedule } from '@/utils/dateUtils';
import { useAuditContext } from '@/context/AuditContext';
import {
  useDailyRecordData,
  useDailyRecordBedActions,
  useDailyRecordHandoffActions,
} from '@/context/DailyRecordContext';

// ========== SUB-HOOKS ==========
import { useHandoffVisibility, NursingShift } from './useHandoffVisibility';
import { useHandoffStaff } from './useHandoffStaff';
import { useHandoffCommunication } from './useHandoffCommunication';

interface UseHandoffLogicParams {
  type: 'nursing' | 'medical';
  selectedShift: NursingShift;
  setSelectedShift: (s: NursingShift) => void;
  onSuccess: (message: string, description?: string) => void;
}

export const useHandoffLogic = ({
  type,
  selectedShift,
  setSelectedShift,
  onSuccess,
}: UseHandoffLogicParams) => {
  const { record } = useDailyRecordData();
  const { updatePatient, updatePatientMultiple, updateClinicalCrib, updateClinicalCribMultiple } =
    useDailyRecordBedActions();
  const { sendMedicalHandoff } = useDailyRecordHandoffActions();

  const isMedical = type === 'medical';

  // ========== SUB-HOOKS INVOCATION ==========
  const visibility = useHandoffVisibility(record, selectedShift);
  const staff = useHandoffStaff(record, selectedShift);
  const comms = useHandoffCommunication(
    record,
    visibility.visibleBeds,
    sendMedicalHandoff,
    onSuccess
  );

  // ========== MEMOS ==========

  const schedule = useMemo(() => {
    if (!record)
      return {
        dayStart: '08:00',
        dayEnd: '20:00',
        nightStart: '20:00',
        nightEnd: '08:00',
        description: '',
      };
    return getShiftSchedule(record.date);
  }, [record]);

  const noteField = useMemo(() => {
    if (!record || isMedical) return 'medicalHandoffNote' as const;
    return selectedShift === 'day'
      ? ('handoffNoteDayShift' as const)
      : ('handoffNoteNightShift' as const);
  }, [record, isMedical, selectedShift]);

  // ========== HANDLERS ==========
  const { logDebouncedEvent } = useAuditContext();

  /**
   * CLINICAL EVENTS HANDLERS
   */
  const handleClinicalEventAdd = useCallback(
    (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => {
      if (!record || isMedical) return;
      const patient = record.beds[bedId];
      if (!patient) return;

      const newEvent: ClinicalEvent = {
        ...event,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };

      const currentEvents = patient.clinicalEvents || [];
      updatePatient(bedId, 'clinicalEvents', [...currentEvents, newEvent]);

      // Log audit event
      logDebouncedEvent(
        'CLINICAL_EVENT_ADDED',
        'patient',
        bedId,
        { event: event.name },
        bedId,
        record.date,
        undefined,
        10000
      );

      onSuccess('Evento agregado', `Se ha registrado el evento: ${event.name}`);
    },
    [record, isMedical, updatePatient, logDebouncedEvent, onSuccess]
  );

  const handleClinicalEventUpdate = useCallback(
    (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => {
      if (!record || isMedical) return;
      const patient = record.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      const updatedEvents = patient.clinicalEvents.map(e =>
        e.id === eventId ? { ...e, ...data } : e
      );

      updatePatient(bedId, 'clinicalEvents', updatedEvents);
    },
    [record, isMedical, updatePatient]
  );

  const handleClinicalEventDelete = useCallback(
    (bedId: string, eventId: string) => {
      if (!record || isMedical) return;
      const patient = record.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      const eventToDelete = patient.clinicalEvents.find(e => e.id === eventId);
      const updatedEvents = patient.clinicalEvents.filter(e => e.id !== eventId);

      updatePatient(bedId, 'clinicalEvents', updatedEvents);

      // Log audit event
      if (eventToDelete) {
        logDebouncedEvent(
          'CLINICAL_EVENT_DELETED',
          'patient',
          bedId,
          { event: eventToDelete.name },
          bedId,
          record.date,
          undefined,
          10000
        );
      }
    },
    [record, isMedical, updatePatient, logDebouncedEvent]
  );

  const handleNursingNoteChange = useCallback(
    async (bedId: string, value: string, isNested: boolean = false) => {
      const bed = record?.beds[bedId];
      const oldNote = isMedical
        ? isNested
          ? bed?.clinicalCrib?.medicalHandoffNote
          : bed?.medicalHandoffNote
        : selectedShift === 'day'
          ? isNested
            ? bed?.clinicalCrib?.handoffNoteDayShift
            : bed?.handoffNoteDayShift
          : isNested
            ? bed?.clinicalCrib?.handoffNoteNightShift
            : bed?.handoffNoteNightShift;

      const NOTE_DEBOUNCE_MS = 30 * 1000;

      if (isMedical) {
        if (isNested) {
          await updateClinicalCrib(bedId, 'medicalHandoffNote', value);
          const p = record?.beds[bedId].clinicalCrib;
          if (p) {
            logDebouncedEvent(
              'MEDICAL_HANDOFF_MODIFIED',
              'patient',
              bedId,
              {
                patientName: p.patientName || 'Cuna',
                note: value,
                changes: { medicalHandoffNote: { old: oldNote || '', new: value } },
              },
              p.rut,
              record?.date,
              undefined,
              NOTE_DEBOUNCE_MS
            );
          }
        } else {
          updatePatient(bedId, 'medicalHandoffNote', value);
          const p = record?.beds[bedId];
          if (p) {
            logDebouncedEvent(
              'MEDICAL_HANDOFF_MODIFIED',
              'patient',
              bedId,
              {
                patientName: p.patientName || 'ANONYMOUS',
                note: value,
                changes: { medicalHandoffNote: { old: oldNote || '', new: value } },
              },
              p.rut,
              record?.date,
              undefined,
              NOTE_DEBOUNCE_MS
            );
          }
        }
      } else {
        const noteKey = selectedShift === 'day' ? 'handoffNoteDayShift' : 'handoffNoteNightShift';

        if (selectedShift === 'day') {
          if (isNested) {
            updateClinicalCribMultiple(bedId, {
              handoffNoteDayShift: value,
              handoffNoteNightShift: value,
            });
            const p = record?.beds[bedId].clinicalCrib;
            if (p) {
              logDebouncedEvent(
                'NURSE_HANDOFF_MODIFIED',
                'patient',
                bedId,
                {
                  patientName: p.patientName || 'Cuna',
                  shift: 'day',
                  note: value,
                  changes: { [noteKey]: { old: oldNote || '', new: value } },
                },
                p.rut,
                record?.date,
                undefined,
                NOTE_DEBOUNCE_MS
              );
            }
          } else {
            updatePatientMultiple(bedId, {
              handoffNoteDayShift: value,
              handoffNoteNightShift: value,
            });
            const p = record?.beds[bedId];
            if (p) {
              logDebouncedEvent(
                'NURSE_HANDOFF_MODIFIED',
                'patient',
                bedId,
                {
                  patientName: p.patientName || 'ANONYMOUS',
                  shift: 'day',
                  note: value,
                  changes: { [noteKey]: { old: oldNote || '', new: value } },
                },
                p.rut,
                record?.date,
                undefined,
                NOTE_DEBOUNCE_MS
              );
            }
          }
        } else {
          if (isNested) {
            updateClinicalCrib(bedId, 'handoffNoteNightShift', value);
            const p = record?.beds[bedId].clinicalCrib;
            if (p) {
              logDebouncedEvent(
                'NURSE_HANDOFF_MODIFIED',
                'patient',
                bedId,
                {
                  patientName: p.patientName || 'Cuna',
                  shift: 'night',
                  note: value,
                  changes: { [noteKey]: { old: oldNote || '', new: value } },
                },
                p.rut,
                record?.date,
                undefined,
                NOTE_DEBOUNCE_MS
              );
            }
          } else {
            updatePatient(bedId, 'handoffNoteNightShift', value);
            const p = record?.beds[bedId];
            if (p) {
              logDebouncedEvent(
                'NURSE_HANDOFF_MODIFIED',
                'patient',
                bedId,
                {
                  patientName: p.patientName || 'ANONYMOUS',
                  shift: 'night',
                  note: value,
                  changes: { [noteKey]: { old: oldNote || '', new: value } },
                },
                p.rut,
                record?.date,
                undefined,
                NOTE_DEBOUNCE_MS
              );
            }
          }
        }
      }
    },
    [
      isMedical,
      selectedShift,
      record,
      updatePatient,
      updatePatientMultiple,
      updateClinicalCrib,
      updateClinicalCribMultiple,
      logDebouncedEvent,
    ]
  );

  const formatPrintDate = useCallback(() => {
    if (!record) return '';
    const [year, month, day] = record.date.split('-');
    return `${day}-${month}-${year}`;
  }, [record]);

  return {
    // Shared State
    selectedShift,
    setSelectedShift,

    // Comm State
    whatsappSending: comms.whatsappSending,
    whatsappSent: comms.whatsappSent,

    // Computed
    isMedical,
    visibleBeds: visibility.visibleBeds,
    hasAnyPatients: visibility.hasAnyPatients,
    schedule,
    noteField,
    deliversList: staff.deliversList,
    receivesList: staff.receivesList,
    tensList: staff.tensList,

    // Handlers
    shouldShowPatient: visibility.shouldShowPatient,
    handleNursingNoteChange,
    handleShareLink: comms.handleShareLink,
    handleSendWhatsApp: comms.handleSendWhatsApp,
    handleSendWhatsAppManual: comms.handleSendWhatsAppManual,
    formatPrintDate,

    // Clinical Events
    handleClinicalEventAdd,
    handleClinicalEventUpdate,
    handleClinicalEventDelete,
  };
};
