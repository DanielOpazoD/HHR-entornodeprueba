import React, { useState, useEffect } from 'react';
import { PatientData, ClinicalEvent } from '@/types';
import { AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { calculateHospitalizedDays } from '@/utils/dateUtils';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import {
    HandoffBedCell,
    HandoffPatientCell,
    HandoffDiagnosisCell,
    HandoffDevicesCell,
    HandoffObservationsCell
} from './HandoffRowCells';

// ============================================================================
// HandoffRow Component
// ============================================================================

interface HandoffRowProps {
    bedName: string;
    bedType?: string; // Kept for compatibility if needed elsewhere
    patient: PatientData;
    reportDate: string;
    isSubRow?: boolean;
    noteField: keyof PatientData; // Dynamic field
    onNoteChange: (val: string) => void;
    readOnly?: boolean;
    isMedical?: boolean;
    forcedExpand?: boolean;
    // Clinical Events handlers
    onClinicalEventAdd?: (event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
    onClinicalEventUpdate?: (eventId: string, data: Partial<ClinicalEvent>) => void;
    onClinicalEventDelete?: (eventId: string) => void;
}

export const HandoffRow: React.FC<HandoffRowProps> = ({
    bedName,
    patient,
    reportDate,
    isSubRow = false,
    noteField,
    onNoteChange,
    readOnly = false,
    isMedical = false,
    forcedExpand = false,
    onClinicalEventAdd,
    onClinicalEventUpdate,
    onClinicalEventDelete
}) => {
    const { stabilityRules } = useDailyRecordData();
    const [showEvents, setShowEvents] = useState(false);

    // Sync with global expansion
    useEffect(() => {
        setShowEvents(forcedExpand);
    }, [forcedExpand]);

    const hasEvents = (patient.clinicalEvents?.length || 0) > 0;

    // If bed is blocked (and not a sub-row), show blocked status
    if (!isSubRow && patient.isBlocked) {
        return (
            <tr className="bg-slate-50 border-b border-slate-200 text-sm print:last:border-b-0 print:text-[10px]">
                <td className="p-2 font-semibold text-slate-700 text-center align-middle border-r border-slate-200 print:p-1">{bedName}</td>
                <td colSpan={4} className="p-2 text-slate-600 align-middle print:p-1 print:whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 print:gap-1">
                        <AlertCircle size={14} className="text-slate-500 print:hidden" />
                        <span className="font-medium">BLOQUEADA:</span> {patient.blockedReason || 'Sin motivo'}
                    </span>
                </td>
            </tr>
        );
    }

    const isEmpty = !patient.patientName;
    if (isEmpty) return null;

    const daysHospitalized = calculateHospitalizedDays(patient.admissionDate, reportDate);
    const noteValue = (patient[noteField] as string) || '';
    const isFieldReadOnly = readOnly || !stabilityRules.canEditField(noteField as string);

    return (
        <tr className={clsx(
            "border-b border-slate-200 hover:bg-slate-50 transition-colors text-sm print:last:border-b-0",
            isSubRow ? "bg-pink-50/40 print:!bg-white" : "bg-white"
        )}>
            <HandoffBedCell
                bedName={bedName}
                isSubRow={isSubRow}
                daysHospitalized={daysHospitalized}
            />

            <HandoffPatientCell
                patient={patient}
                isSubRow={isSubRow}
            />

            <HandoffDiagnosisCell
                patient={patient}
                isMedical={isMedical}
                isSubRow={isSubRow}
                showEvents={showEvents}
                setShowEvents={setShowEvents}
                hasEvents={hasEvents}
                isFieldReadOnly={isFieldReadOnly}
                onClinicalEventAdd={onClinicalEventAdd}
                onClinicalEventUpdate={onClinicalEventUpdate}
                onClinicalEventDelete={onClinicalEventDelete}
            />

            {/* DMI column only shown in nursing handoff */}
            {!isMedical && (
                <HandoffDevicesCell
                    patient={patient}
                    reportDate={reportDate}
                />
            )}

            <HandoffObservationsCell
                noteValue={noteValue}
                onNoteChange={onNoteChange}
                isFieldReadOnly={isFieldReadOnly}
            />
        </tr>
    );
};
