import React from 'react';
import { DailyRecord } from '@/types';
import { HandoffStaffSelector } from './HandoffStaffSelector';
import { HandoffChecklistDay } from './HandoffChecklistDay';
import { HandoffChecklistNight } from './HandoffChecklistNight';
import { SaveBackupButton } from '@/components/handoff/SaveBackupButton';

interface HandoffChecklistSectionProps {
    isMedical: boolean;
    selectedShift: 'day' | 'night';
    record: DailyRecord;
    deliversList: string[];
    receivesList: string[];
    tensList: string[];
    nursesList: string[];
    readOnly: boolean;
    schedule: any;
    onUpdateStaff: (shift: 'day' | 'night', type: 'delivers' | 'receives' | 'tens', list: string[]) => void;
    onUpdateChecklist: (shift: 'day' | 'night', field: string, value: boolean | string) => void;
}

export const HandoffChecklistSection: React.FC<HandoffChecklistSectionProps> = ({
    isMedical,
    selectedShift,
    record,
    deliversList,
    receivesList,
    tensList,
    nursesList,
    readOnly,
    schedule,
    onUpdateStaff,
    onUpdateChecklist
}) => {
    if (isMedical) return null;

    return (
        <div className="bg-white rounded-lg border border-slate-200 p-2 print:hidden">
            {/* Staff Selectors - Compact horizontal layout */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 items-center mb-2 pb-2 border-b border-slate-100">
                <HandoffStaffSelector
                    label="Entrega"
                    type="delivers"
                    bgClass=""
                    selectedNurses={deliversList}
                    availableNurses={nursesList}
                    onUpdate={(list) => onUpdateStaff(selectedShift, 'delivers', list)}
                    readOnly={readOnly}
                    compact
                />
                <HandoffStaffSelector
                    label="Recibe"
                    type="receives"
                    bgClass=""
                    selectedNurses={receivesList}
                    availableNurses={nursesList}
                    onUpdate={(list) => onUpdateStaff(selectedShift, 'receives', list)}
                    readOnly={readOnly}
                    compact
                />

                {/* Spacer to push buttons to the right */}
                <div className="flex-1" />

                {/* CUDYR Button */}
                <button
                    onClick={() => window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'CUDYR' }))}
                    className="px-3 py-1 text-xs font-bold border-2 border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors whitespace-nowrap cursor-pointer"
                    title="Ver Categorización CUDYR"
                >
                    CUDYR
                </button>

                {/* Save Backup Button */}
                {!readOnly && (
                    <SaveBackupButton
                        date={record.date}
                        shiftType={selectedShift}
                        deliveryStaff={deliversList[0] || ''}
                        receivingStaff={receivesList[0] || ''}
                        record={record}
                        schedule={schedule}
                    />
                )}
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
