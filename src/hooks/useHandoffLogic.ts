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
import { MedicalHandoffAuditActor, PatientData } from '@/hooks/contracts/patientHookContracts';
import { getShiftSchedule } from '@/utils/clinicalDayUtils';
import { useAuditContext } from '@/context/AuditContext';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useAuth } from '@/context';
import {
  useDailyRecordBedActions,
  useDailyRecordHandoffActions,
} from '@/context/useDailyRecordScopedActions';

// ========== SUB-HOOKS ==========
import { useHandoffVisibility, NursingShift } from './useHandoffVisibility';
import { useHandoffStaff } from './useHandoffStaff';
import { useHandoffCommunication } from './useHandoffCommunication';
import { useMedicalHandoffHandlers } from './useMedicalHandoffHandlers';
import { useNursingHandoffHandlers } from './useNursingHandoffHandlers';
import { useClinicalEventHandlers } from './useClinicalEventHandlers';
import { buildHandoffLogicViewState } from '@/hooks/controllers/handoffLogicViewStateController';

interface UseHandoffLogicParams {
  type: 'nursing' | 'medical';
  selectedShift: NursingShift;
  setSelectedShift: (s: NursingShift) => void;
  onSuccess: (message: string, description?: string) => void;
}

type MedicalPatientFields = Pick<
  PatientData,
  'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'
>;

export const useHandoffLogic = ({
  type,
  selectedShift,
  setSelectedShift,
  onSuccess,
}: UseHandoffLogicParams) => {
  const { record } = useDailyRecordData();
  const { updatePatient, updatePatientMultiple, updateClinicalCrib, updateClinicalCribMultiple } =
    useDailyRecordBedActions();
  const { sendMedicalHandoff, ensureMedicalHandoffSignatureLink } = useDailyRecordHandoffActions();
  const { currentUser, role } = useAuth();

  const isMedical = type === 'medical';

  // ========== SUB-HOOKS INVOCATION ==========
  const visibility = useHandoffVisibility(record, selectedShift);
  const staff = useHandoffStaff(record, selectedShift);
  const comms = useHandoffCommunication(
    record,
    visibility.visibleBeds,
    sendMedicalHandoff,
    ensureMedicalHandoffSignatureLink,
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
  const medicalAuditActor = useMemo<MedicalHandoffAuditActor | null>(() => {
    if (!currentUser?.uid || !currentUser.email) return null;
    return {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName || currentUser.email,
      role,
    };
  }, [currentUser, role]);

  const persistMedicalFields = useCallback(
    async (bedId: string, fields: MedicalPatientFields, isNested: boolean) => {
      if (isNested) {
        await updateClinicalCribMultiple(bedId, fields, record?.beds[bedId]?.clinicalCrib);
        return;
      }
      await updatePatientMultiple(bedId, fields, record?.beds[bedId]);
    },
    [record, updateClinicalCribMultiple, updatePatientMultiple]
  );

  const nursingHandlers = useNursingHandoffHandlers({
    isMedical,
    selectedShift,
    record,
    updatePatient,
    updatePatientMultiple,
    updateClinicalCrib,
    updateClinicalCribMultiple,
    logDebouncedEvent,
  });
  const clinicalEventHandlers = useClinicalEventHandlers({
    record,
    updatePatient,
    logDebouncedEvent,
    onSuccess,
  });

  const medicalHandlers = useMedicalHandoffHandlers({
    isMedical,
    record,
    role,
    medicalAuditActor,
    persistMedicalFields,
    logDebouncedEvent,
  });

  const handleNursingNoteChange = useCallback(
    (bedId: string, value: string, isNested: boolean = false) =>
      isMedical
        ? medicalHandlers.handleMedicalPrimaryNoteChange(bedId, value, isNested)
        : nursingHandlers.handleNursingNoteChange(bedId, value, isNested),
    [isMedical, medicalHandlers, nursingHandlers]
  );

  const formatPrintDate = useCallback(() => {
    if (!record) return '';
    const [year, month, day] = record.date.split('-');
    return `${day}-${month}-${year}`;
  }, [record]);

  const handoffLogicViewState = buildHandoffLogicViewState({
    isMedical,
    visibleBeds: visibility.visibleBeds,
    hasAnyPatients: visibility.hasAnyPatients,
    noteField,
    deliversList: staff.deliversList,
    receivesList: staff.receivesList,
    tensList: staff.tensList,
  });

  return {
    // Shared State
    selectedShift,
    setSelectedShift,

    // Comm State
    whatsappSending: comms.whatsappSending,
    whatsappSent: comms.whatsappSent,

    // Computed
    ...handoffLogicViewState,
    schedule,

    // Handlers
    shouldShowPatient: visibility.shouldShowPatient,
    handleNursingNoteChange,
    handleMedicalPrimaryEntryCreate: medicalHandlers.handleMedicalPrimaryEntryCreate,
    handleMedicalEntryAdd: medicalHandlers.handleMedicalEntryAdd,
    handleMedicalEntryDelete: medicalHandlers.handleMedicalEntryDelete,
    handleMedicalEntryNoteChange: medicalHandlers.handleMedicalEntryNoteChange,
    handleMedicalEntrySpecialtyChange: medicalHandlers.handleMedicalEntrySpecialtyChange,
    handleMedicalRefreshAsCurrent: medicalHandlers.handleMedicalRefreshAsCurrent,
    handleShareLink: comms.handleShareLink,
    handleSendWhatsApp: comms.handleSendWhatsApp,
    handleSendWhatsAppManual: comms.handleSendWhatsAppManual,
    formatPrintDate,

    // Clinical Events
    handleClinicalEventAdd: clinicalEventHandlers.handleClinicalEventAdd,
    handleClinicalEventUpdate: clinicalEventHandlers.handleClinicalEventUpdate,
    handleClinicalEventDelete: clinicalEventHandlers.handleClinicalEventDelete,
  };
};
