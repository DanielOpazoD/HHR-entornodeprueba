import React from 'react';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import { HandoffStaffSelector } from './HandoffStaffSelector';
import { HandoffStaffDisplay } from './HandoffStaffDisplay';
import { HandoffSharedChecklist } from './HandoffSharedChecklist';
import { HandoffChecklistDay } from './HandoffChecklistDay';
import { HandoffChecklistNight } from './HandoffChecklistNight';
import { HandoffShiftSwitcher } from './HandoffShiftSwitcher';
import { buildHandoffChecklistSectionViewModel } from '@/features/handoff/controllers/handoffViewController';

interface HandoffChecklistSectionProps {
  isMedical: boolean;
  selectedShift: 'day' | 'night';
  setSelectedShift?: (shift: 'day' | 'night') => void;
  record: DailyRecord;
  deliversList: string[];
  receivesList: string[];
  nursesList: string[];
  readOnly: boolean;
  onUpdateStaff: (
    shift: 'day' | 'night',
    type: 'delivers' | 'receives' | 'tens',
    list: string[]
  ) => void;
  onUpdateChecklist: (
    shift: 'day' | 'night' | 'shared',
    field: string,
    value: boolean | string
  ) => void;
  /** Optional action rendered at the right of the shift tabs row (e.g. CUDYR button) */
  extraAction?: React.ReactNode;
}

export const HandoffChecklistSection: React.FC<HandoffChecklistSectionProps> = ({
  isMedical,
  selectedShift,
  setSelectedShift,
  record,
  deliversList,
  receivesList,
  nursesList,
  readOnly,
  onUpdateStaff,
  onUpdateChecklist,
  extraAction,
}) => {
  const checklistSectionViewModel = buildHandoffChecklistSectionViewModel({
    isMedical,
    selectedShift,
    readOnly,
    hasShiftSwitcher: Boolean(setSelectedShift),
  });
  const { shouldRender, showShiftSwitcher, isReceivesEditable, activeChecklistShift } =
    checklistSectionViewModel;

  if (!shouldRender) return null;

  return (
    <div className="handoff-header min-w-0 bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-4 print:hidden shadow-sm ring-1 ring-black/[0.02]">
      {/* Row 1: Shift tabs + CUDYR action (same line) */}
      <div className="flex min-w-0 items-center gap-2 mb-3 pb-3 border-b border-slate-100">
        {showShiftSwitcher && setSelectedShift && (
          <HandoffShiftSwitcher selectedShift={selectedShift} setSelectedShift={setSelectedShift} />
        )}
        {extraAction && <div className="ml-auto shrink-0">{extraAction}</div>}
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
            onUpdate={list => onUpdateStaff(selectedShift, 'receives', list)}
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
        onUpdate={(field, value) => onUpdateChecklist('shared', field, value)}
        readOnly={readOnly}
      />
      <div className="min-h-[28px]">
        {activeChecklistShift === 'day' ? (
          <HandoffChecklistDay
            data={record.handoffDayChecklist}
            onUpdate={(field, val) => onUpdateChecklist('day', field, val)}
            readOnly={readOnly}
          />
        ) : (
          <HandoffChecklistNight
            data={record.handoffNightChecklist}
            onUpdate={(field, val) => onUpdateChecklist('night', field, val)}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
};
