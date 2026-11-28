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

    const isDayChecklist = activeChecklistShift === 'day';

    return (
      <div className="handoff-header min-w-0 bg-white rounded-xl border border-slate-200/80 px-3 py-2 print:hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {/* Band 1: Shift switcher + staff on one compact row on desktop */}
        <div className="handoff-top-bar flex min-w-0 flex-col gap-2 pb-2 border-b border-slate-100 lg:flex-row lg:items-center lg:gap-3">
          {showShiftSwitcher && setSelectedShift && (
            <HandoffShiftSwitcher
              selectedShift={selectedShift}
              setSelectedShift={setSelectedShift}
            />
          )}

          <div className="handoff-staff grid min-w-0 flex-1 grid-cols-1 items-center gap-x-4 gap-y-1.5 sm:grid-cols-2">
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
        </div>

        {/* Band 2: Shared crash cart review + shift checklist */}
        <div
          className={
            isDayChecklist
              ? 'handoff-checklist-bar handoff-checklist-bar--day flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 pt-2'
              : 'handoff-checklist-bar handoff-checklist-bar--night flex min-w-0 flex-col gap-1.5 pt-2'
          }
        >
          <HandoffSharedChecklist
            key={record.date}
            data={record.handoffSharedChecklist}
            onUpdate={handleUpdateSharedChecklist}
            readOnly={readOnly}
            inline={isDayChecklist}
          />
          {isDayChecklist && (
            <span
              className="hidden h-4 w-px shrink-0 bg-slate-200/80 lg:block"
              aria-hidden="true"
            />
          )}
          {isDayChecklist ? (
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
