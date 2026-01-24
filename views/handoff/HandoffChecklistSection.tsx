import React from 'react';
import { DailyRecord } from '@/types';
import { HandoffStaffSelector } from './HandoffStaffSelector';
import { HandoffStaffDisplay } from './HandoffStaffDisplay';
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
    tensList: _tensList,
    nursesList,
    readOnly,
    schedule,
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

                {/* Spacer to push buttons to the right */}
                <div className="flex-1" />

                {/* CUDYR Button - Night Shift Only */}
                {selectedShift === 'night' && (
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'CUDYR' }))}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
                        title="Ver Categorización CUDYR"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 3v18h18" />
                            <path d="M18 17V9" />
                            <path d="M13 17V5" />
                            <path d="M8 17v-3" />
                        </svg>
                        CUDYR
                    </button>
                )}

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
