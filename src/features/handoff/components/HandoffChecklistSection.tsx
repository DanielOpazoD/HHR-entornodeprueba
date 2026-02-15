import React from 'react';
import { DailyRecord } from '@/types';
import { HandoffStaffSelector } from './HandoffStaffSelector';
import { HandoffStaffDisplay } from './HandoffStaffDisplay';
import { HandoffChecklistDay } from './HandoffChecklistDay';
import { HandoffChecklistNight } from './HandoffChecklistNight';

interface HandoffChecklistSectionProps {
    isMedical: boolean;
    selectedShift: 'day' | 'night';
    record: DailyRecord;
    deliversList: string[];
    receivesList: string[];
    nursesList: string[];
    readOnly: boolean;
    onUpdateStaff: (shift: 'day' | 'night', type: 'delivers' | 'receives' | 'tens', list: string[]) => void;
    onUpdateChecklist: (shift: 'day' | 'night', field: string, value: boolean | string) => void;
}

export const HandoffChecklistSection: React.FC<HandoffChecklistSectionProps> = ({
    isMedical,
    selectedShift,
    record,
    deliversList,
    receivesList,
    nursesList,
    readOnly,
    onUpdateStaff,
    onUpdateChecklist
}) => {
    if (isMedical) return null;

    // Recibe is editable ONLY on night shift as long as not read-only
    // On day shift (Turno Largo), receiving nurses are automatically pulled from the Census (same day Night shift)
    const isReceivesEditable = !readOnly && selectedShift === 'night';

    return (
        <div className="bg-white rounded-lg border border-slate-200 p-2 print:hidden">
            {/* Staff Selectors - Compact horizontal layout */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 items-center mb-2 pb-2 border-b border-slate-100">
                {/* Entrega - Always read-only (inherited from census) */}
                <HandoffStaffDisplay
                    label="Entrega"
                    type="delivers"
                    nurses={deliversList}
                    compact
                />

                {/* Recibe - Editable ONLY on night shift */}
                {isReceivesEditable ? (
                    <HandoffStaffSelector
                        label="Recibe"
                        type="receives"
                        bgClass=""
                        selectedNurses={receivesList}
                        availableNurses={nursesList}
                        onUpdate={(list) => onUpdateStaff(selectedShift, 'receives', list)}
                        readOnly={false}
                        compact
                    />
                ) : (
                    <HandoffStaffDisplay
                        label="Recibe"
                        type="receives"
                        nurses={receivesList}
                        compact
                    />
                )}

                {/* Spacer to push toggle to the right if needed */}
                <div className="flex-1" />
            </div>

            {/* Checklist - inline with minimal styling */}
            <div>
                {selectedShift === 'day' ? (
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
