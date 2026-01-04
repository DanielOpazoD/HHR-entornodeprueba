import React, { useRef, useEffect, useCallback } from 'react';
import { PatientData, PatientStatus } from '@/types';
import { Baby, AlertCircle, Clock } from 'lucide-react';
import clsx from 'clsx';
import { formatDateDDMMYYYY } from '@/services/dataService';
import { calculateDeviceDays } from '@/components/device-selector/DeviceDateConfigModal';

// ============================================================================
// Utilities
// ============================================================================

/**
 * Calculate days since admission
 * Inclusion: The admission day counts as Day 1.
 */
export const calculateHospitalizedDays = (admissionDate?: string, currentDate?: string): number | null => {
    if (!admissionDate || !currentDate) return null;
    const start = new Date(admissionDate);
    const end = new Date(currentDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diff = end.getTime() - start.getTime();
    const days = Math.floor(diff / (1000 * 3600 * 24));
    const totalDays = days + 1;
    return totalDays >= 1 ? totalDays : 1;
};

import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';

// ============================================================================
// HandoffRow Component
// ============================================================================

interface HandoffRowProps {
    bedName: string;
    bedType: string;
    patient: PatientData;
    reportDate: string;
    isSubRow?: boolean;
    noteField: keyof PatientData; // Dynamic field
    onNoteChange: (val: string) => void;
    readOnly?: boolean;
}

export const HandoffRow: React.FC<HandoffRowProps> = ({
    bedName,
    bedType,
    patient,
    reportDate,
    isSubRow = false,
    noteField,
    onNoteChange,
    readOnly = false
}) => {
    // If bed is blocked (and not a sub-row), show blocked status
    if (!isSubRow && patient.isBlocked) {
        return (
            <tr className="bg-slate-50 border-b border-slate-200 text-sm print:last:border-b-0 print:text-[10px]">
                <td className="p-2 font-semibold text-slate-700 text-center align-middle border-r border-slate-200 print:p-1">{bedName}</td>
                <td colSpan={7} className="p-2 text-slate-600 align-middle print:p-1 print:whitespace-nowrap">
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

    return (
        <tr className={clsx(
            "border-b border-slate-200 hover:bg-slate-50 transition-colors text-sm print:last:border-b-0",
            isSubRow ? "bg-pink-50/40 print:!bg-white" : "bg-white"
        )}>
            {/* Cama + Días Hosp - Vertically Centered */}
            <td className="p-2 border-r border-slate-200 text-center w-20 align-middle print:w-auto print:text-[10px] print:p-1">
                <div className="font-bold text-slate-700 text-base print:text-[10px] flex flex-col items-center">
                    <span>{!isSubRow && bedName}</span>
                    {!isSubRow && daysHospitalized !== null && (
                        <span className="hidden print:inline font-normal text-[9px] text-slate-500 leading-none mt-0.5">({daysHospitalized}d)</span>
                    )}
                </div>
                {!isSubRow && daysHospitalized !== null && (
                    <div className="flex flex-col items-center justify-center mt-1 text-slate-500 print:hidden" title="Días Hospitalizado">
                        <Clock size={12} className="print:hidden" />
                        <span className="text-[10px] font-bold">{daysHospitalized}d</span>
                    </div>
                )}
            </td>

            {/* Nombre + Edad */}
            <td className="p-2 border-r border-slate-200 min-w-[150px] align-middle print:min-w-0 print:w-auto print:text-[10px] print:p-1">
                <div className="font-medium text-slate-800 flex flex-col gap-0.5 leading-snug print:leading-none">
                    <div className="flex items-center gap-1 flex-wrap">
                        {isSubRow && <Baby size={14} className="text-pink-400 print:hidden" />}
                        {isSubRow && <span className="hidden print:inline text-[8px] text-pink-600 font-bold">(RN)</span>}
                        <span>{patient.patientName}</span>
                    </div>
                    {/* Print: RUT below name */}
                    <div className="hidden print:block font-mono text-[8px] text-slate-500 leading-none mt-0.5">
                        {patient.rut}
                    </div>
                    {/* Age (Always shown if present, adjusted for print) */}
                    {patient.age && (
                        <span className="text-slate-400 font-normal text-xs print:text-[8px] leading-none">({patient.age})</span>
                    )}
                </div>
            </td>

            {/* RUT */}
            {/* RUT - Hidden in Print */}
            <td className="p-2 border-r border-slate-200 w-36 text-xs text-slate-600 align-middle whitespace-nowrap print:hidden">
                {patient.rut}
            </td>

            {/* Diagnóstico */}
            <td className="p-2 border-r border-slate-200 w-64 text-slate-700 align-middle print:w-20 print:text-[10px] print:leading-tight print:p-1">
                <div className="font-medium leading-tight">
                    {patient.pathology}
                </div>
                {/* Print: Admission Date below Diagnosis */}
                <div className="hidden print:block text-[8px] text-slate-500 mt-1 leading-none">
                    FI: {formatDateDDMMYYYY(patient.admissionDate)}
                </div>
            </td>

            {/* Estado */}
            <td className="p-2 border-r border-slate-200 w-20 align-middle print:text-[9px] print:p-1">
                <span className={clsx(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap block text-center print:whitespace-normal print:text-[8px] print:px-1 print:py-0 print:leading-tight print:rounded-none print:border print:bg-transparent",
                    patient.status === PatientStatus.GRAVE ? "bg-red-100 text-red-700 border-red-200" :
                        patient.status === PatientStatus.DE_CUIDADO ? "bg-orange-100 text-orange-700 border-orange-200" :
                            "bg-green-100 text-green-700 border-green-200"
                )}>
                    {patient.status}
                </span>
            </td>

            {/* Fecha Ingreso */}
            {/* F. Ingreso - Hidden in Print */}
            <td className="p-2 border-r border-slate-200 w-28 text-center text-xs text-slate-600 align-middle print:hidden">
                {formatDateDDMMYYYY(patient.admissionDate)}
            </td>

            {/* Dispositivos with days like census */}
            <td className="p-2 border-r border-slate-200 w-20 text-xs align-middle print:w-auto print:text-[9px] print:p-1">
                <div className="flex flex-wrap gap-1">
                    {patient.devices.length > 0 ? patient.devices.map(d => {
                        // Get days for device from deviceDetails if available
                        let deviceDays: number | null = null;
                        const details = patient.deviceDetails;
                        if (details) {
                            const deviceKey = d as keyof typeof details;
                            const deviceInfo = details[deviceKey];
                            if (deviceInfo?.installationDate) {
                                deviceDays = calculateDeviceDays(deviceInfo.installationDate, reportDate);
                            }
                        }
                        return (
                            <span key={d} className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 text-[10px] flex items-center gap-0.5 print:text-[9px] print:bg-transparent print:border-none print:p-0">
                                {d}
                                {deviceDays !== null && deviceDays > 0 && (
                                    <span className="font-bold text-slate-500">({deviceDays}d)</span>
                                )}
                            </span>
                        );
                    }) : <span className="text-slate-400 print:text-[9px]">-</span>}
                </div>
            </td>

            {/* Observaciones */}
            <td className="p-2 w-full min-w-[300px] align-top print:w-auto print:min-w-0 print:text-[8px] print:p-0.5">
                {readOnly ? (
                    <div className="whitespace-pre-wrap break-words text-sm text-slate-800 p-2 min-h-[50px] print:min-h-0 print:p-0 print:text-[8px] print:leading-tight">
                        {noteValue || <span className="text-slate-400 italic">Sin observaciones</span>}
                    </div>
                ) : (
                    <>
                        {/* Screen: Editable Textarea */}
                        <div className="print:hidden">
                            <DebouncedTextarea
                                value={noteValue}
                                onChangeValue={onNoteChange}
                                className="w-full p-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 focus:outline-none bg-white"
                                minRows={2}
                                debounceMs={1500}
                            />
                        </div>
                        {/* Print: Read-only Div (Ensures full expansion) */}
                        <div className="hidden print:block w-full whitespace-pre-wrap break-words text-slate-800 print:text-[8px] print:leading-tight">
                            {noteValue}
                        </div>
                    </>
                )}
            </td>
        </tr>
    );
};
