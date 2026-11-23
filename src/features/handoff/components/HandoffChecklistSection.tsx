import React, { useCallback } from 'react';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import { HandoffStaffSelector } from './HandoffStaffSelector';
import { HandoffStaffDisplay } from './HandoffStaffDisplay';
import { HandoffSharedChecklist } from './HandoffSharedChecklist';
import { HandoffChecklistDay } from './HandoffChecklistDay';
import { HandoffChecklistNight } from './HandoffChecklistNight';
import { HandoffShiftSwitcher } from './HandoffShiftSwitcher';
import { buildHandoffChecklistSectionViewModel } from '@/features/handoff/controllers/handoffViewController';

interface HandoffChecklistSectionProps {
  selectedShift: 'day' | 'night';
  setSelectedShift?: (shift: 'day' | 'night') => void;
  record: HandoffDailyRecordContract;
  deliversList: string[];
  receivesList: string[];
  nursesList: string[];
  readOnly: boolean;
  onUpdateReceives: (shift: 'day' | 'night', list: string[]) => void;
  onUpdateChecklist: (
    shift: 'day' | 'night' | 'shared',
    field: string,
    value: boolean | string
  ) => void;
}

const areChecklistSectionPropsEqual = (
  prev: HandoffChecklistSectionProps,
  next: HandoffChecklistSectionProps
): boolean =>
  prev.selectedShift === next.selectedShift &&
  prev.setSelectedShift === next.setSelectedShift &&
  prev.deliversList === next.deliversList &&
  prev.receivesList === next.receivesList &&
  prev.nursesList === next.nursesList &&
  prev.readOnly === next.readOnly &&
  prev.onUpdateReceives === next.onUpdateReceives &&
  prev.onUpdateChecklist === next.onUpdateChecklist &&
  prev.record.date === next.record.date &&
  prev.record.handoffSharedChecklist === next.record.handoffSharedChecklist &&
  prev.record.handoffDayChecklist === next.record.handoffDayChecklist &&
  prev.record.handoffNightChecklist === next.record.handoffNightChecklist;

export const HandoffChecklistSection: React.FC<HandoffChecklistSectionProps> = React.memo(
  function HandoffChecklistSection({
    selectedShift,
    setSelectedShift,
    record,
    deliversList,
    receivesList,
    nursesList,
    readOnly,
    onUpdateReceives,
    onUpdateChecklist,
  }) {
    const checklistSectionViewModel = buildHandoffChecklistSectionViewModel({
      selectedShift,
      readOnly,
      hasShiftSwitcher: Boolean(setSelectedShift),
    });
    const { showShiftSwitcher, isReceivesEditable, activeChecklistShift } =
      checklistSectionViewModel;

    const handleUpdateReceives = useCallback(
      (list: string[]) => onUpdateReceives(selectedShift, list),
      [onUpdateReceives, selectedShift]
    );
    const handleUpdateSharedChecklist = useCallback(
      (field: string, value: boolean | string) => onUpdateChecklist('shared', field, value),
      [onUpdateChecklist]
    );
    const handleUpdateDayChecklist = useCallback(
      (field: string, val: boolean | string) => onUpdateChecklist('day', field, val),
      [onUpdateChecklist]
    );
    const handleUpdateNightChecklist = useCallback(
      (field: string, val: boolean | string) => onUpdateChecklist('night', field, val),
      [onUpdateChecklist]
    );

    return (
      <div className="handoff-header min-w-0 bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-4 print:hidden shadow-sm ring-1 ring-black/[0.02]">
        {/* Row 1: Shift tabs */}
        <div className="flex min-w-0 items-center gap-2 mb-3 pb-3 border-b border-slate-100">
          {showShiftSwitcher && setSelectedShift && (
            <HandoffShiftSwitcher
              selectedShift={selectedShift}
              setSelectedShift={setSelectedShift}
            />
          )}
        </div>

        {/* Row 2: Staff names — min-h ensures consistent height between day/night shifts */}
        <div className="handoff-staff grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2 items-center mb-3 pb-3 border-b border-slate-100 min-h-[32px]">
          <HandoffStaffDisplay label="Entrega" type="delivers" nurses={deliversList} compact />

          {isReceivesEditable ? (
            <HandoffStaffSelector
              label="Recibe"
              type="receives"
              bgClass=""
              selectedNurses={receivesList}
              availableNurses={nursesList}
              onUpdate={handleUpdateReceives}
              readOnly={false}
              compact
            />
          ) : (
            <HandoffStaffDisplay label="Recibe" type="receives" nurses={receivesList} compact />
          )}
        </div>

        {/* Row 3: Checklist — min-h ensures consistent height between day/night */}
        <HandoffSharedChecklist
          key={record.date}
          data={record.handoffSharedChecklist}
          onUpdate={handleUpdateSharedChecklist}
          readOnly={readOnly}
        />
        <div className="min-h-[28px]">
          {activeChecklistShift === 'day' ? (
            <HandoffChecklistDay
              data={record.handoffDayChecklist}
              onUpdate={handleUpdateDayChecklist}
              readOnly={readOnly}
            />
          ) : (
            <HandoffChecklistNight
              data={record.handoffNightChecklist}
              onUpdate={handleUpdateNightChecklist}
              readOnly={readOnly}
            />
          )}
        </div>
      </div>
    );
  },
  areChecklistSectionPropsEqual
);
