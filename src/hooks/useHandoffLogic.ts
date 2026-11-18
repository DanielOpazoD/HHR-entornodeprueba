/**
 * useHandoffLogic Hook
 * Extracted from HandoffView.tsx for better separation of concerns.
 * Handles nursing handoff state management and note sync.
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

import { DEFAULT_SHIFT_SCHEDULE, getShiftSchedule } from '@/utils/clinicalDayUtils';
import { useAuditContext } from '@/context/AuditContext';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useDailyRecordBedActions } from '@/context/useDailyRecordScopedActions';

// ========== SUB-HOOKS ==========
import { useHandoffVisibility } from './useHandoffVisibility';
import type { ShiftType } from '@/types/domain/shift';
import { useHandoffStaff } from './useHandoffStaff';
import { useNursingHandoffHandlers } from './useNursingHandoffHandlers';
import { useClinicalEventHandlers } from './useClinicalEventHandlers';
import { buildHandoffLogicViewState } from '@/hooks/controllers/handoffLogicViewStateController';

interface UseHandoffLogicParams {
  selectedShift: ShiftType;
  setSelectedShift: (s: ShiftType) => void;
  onSuccess: (message: string, description?: string) => void;
}

export const useHandoffLogic = ({
  selectedShift,
  setSelectedShift,
  onSuccess,
}: UseHandoffLogicParams) => {
  const { record } = useDailyRecordData();
  const { updatePatient, updatePatientMultiple, updateClinicalCrib, updateClinicalCribMultiple } =
    useDailyRecordBedActions();

  // ========== SUB-HOOKS INVOCATION ==========
  const visibility = useHandoffVisibility(record, selectedShift);
  const staff = useHandoffStaff(record, selectedShift);

  // ========== MEMOS ==========

  const schedule = useMemo(() => {
    if (!record) return DEFAULT_SHIFT_SCHEDULE;
    return getShiftSchedule(record.date);
  }, [record]);

  const noteField =
    selectedShift === 'day' ? ('handoffNoteDayShift' as const) : ('handoffNoteNightShift' as const);

  // ========== HANDLERS ==========
  const { logDebouncedEvent } = useAuditContext();
  const nursingHandlers = useNursingHandoffHandlers({
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

  const formatPrintDate = useCallback(() => {
    if (!record) return '';
    const [year, month, day] = record.date.split('-');
    return `${day}-${month}-${year}`;
  }, [record]);

  const handoffLogicViewState = buildHandoffLogicViewState({
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

    // Computed
    ...handoffLogicViewState,
    schedule,

    // Handlers
    shouldShowPatient: visibility.shouldShowPatient,
    handleNursingNoteChange: nursingHandlers.handleNursingNoteChange,
    formatPrintDate,

    // Clinical Events
    handleClinicalEventAdd: clinicalEventHandlers.handleClinicalEventAdd,
    handleClinicalEventUpdate: clinicalEventHandlers.handleClinicalEventUpdate,
    handleClinicalEventDelete: clinicalEventHandlers.handleClinicalEventDelete,
  };
};
