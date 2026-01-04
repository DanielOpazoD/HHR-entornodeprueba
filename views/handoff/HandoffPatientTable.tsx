/**
 * HandoffPatientTable Component
 * 
 * Renders the main patient table for nursing and medical handoff views.
 * Supports shift-based patient filtering via shouldShowPatient callback.
 */

import React from 'react';
import { BedDefinition, DailyRecord } from '../../types';
import { HandoffRow } from './HandoffRow';

interface HandoffPatientTableProps {
    visibleBeds: BedDefinition[];
    record: DailyRecord;
    noteField: keyof DailyRecord['beds'][string];
    onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
    tableHeaderClass: string;
    readOnly: boolean;
    /**
     * Optional function to determine if a patient should be shown in the current shift.
     * If not provided, all patients are shown.
     * 
     * @param bedId - The bed ID to check
     * @returns true if patient should be displayed, false to hide
     */
    shouldShowPatient?: (bedId: string) => boolean;
}

export const HandoffPatientTable: React.FC<HandoffPatientTableProps> = ({
    visibleBeds,
    record,
    noteField,
    onNoteChange,
    tableHeaderClass,
    readOnly,
    shouldShowPatient
}) => {
    return (
        <div className="overflow-x-auto shadow-lg rounded-xl border border-slate-200 bg-white print:shadow-none print:border print:border-slate-400 font-sans">
            <table className="w-full border-collapse table-fixed min-w-[900px] print:min-w-0 font-sans">
                <thead>
                    <tr className={tableHeaderClass}>
                        <th className="p-3 text-left w-24 print:p-2 print:w-20 print:text-xs">Cama</th>
                        <th className="p-3 text-left w-56 print:p-2 print:text-xs">Paciente</th>
                        <th className="p-3 text-left w-36 print:p-2 print:w-28 print:text-xs">Diagnóstico</th>
                        <th className="p-3 text-left print:p-2 print:text-xs">Nota de Entrega</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-slate-300">
                    {visibleBeds.map((bed) => {
                        const patient = record.beds[bed.id];

                        // Check if this patient should be shown in the current shift
                        // If shouldShowPatient is not provided, show all patients
                        // If bed is blocked, always show it
                        const showMainPatient = patient.isBlocked ||
                            !shouldShowPatient ||
                            shouldShowPatient(bed.id);

                        // For clinical crib, check if main patient is visible first
                        const showClinicalCrib = patient.clinicalCrib?.patientName && showMainPatient;

                        // If patient should be hidden and bed is not blocked, render empty row
                        if (!showMainPatient && !patient.isBlocked) {
                            return (
                                <HandoffRow
                                    key={bed.id}
                                    bedName={bed.name}
                                    bedType={bed.type}
                                    patient={{ isBlocked: false } as any}
                                    reportDate={record.date}
                                    noteField={noteField}
                                    onNoteChange={(val) => onNoteChange(bed.id, val, false)}
                                    readOnly={readOnly}
                                />
                            );
                        }

                        return (
                            <React.Fragment key={bed.id}>
                                <HandoffRow
                                    bedName={bed.name}
                                    bedType={bed.type}
                                    patient={patient}
                                    reportDate={record.date}
                                    noteField={noteField}
                                    onNoteChange={(val) => onNoteChange(bed.id, val, false)}
                                    readOnly={readOnly}
                                />
                                {/* Clinical Crib Sub-Row */}
                                {showClinicalCrib && (
                                    <HandoffRow
                                        bedName={bed.name}
                                        bedType="Cuna"
                                        patient={patient.clinicalCrib}
                                        reportDate={record.date}
                                        isSubRow={true}
                                        noteField={noteField}
                                        onNoteChange={(val) => onNoteChange(bed.id, val, true)}
                                        readOnly={readOnly}
                                    />
                                )}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
