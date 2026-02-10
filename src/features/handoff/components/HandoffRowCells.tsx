import React from 'react';
import { PatientData, PatientStatus, ClinicalEvent } from '@/types';
import { Baby, ChevronDown, Clock } from 'lucide-react';
import clsx from 'clsx';
import { formatDateDDMMYYYY } from '@/services/dataService';
import { ClinicalEventsPanel } from './ClinicalEventsPanel';
import { calculateDeviceDays } from '@/components/device-selector/DeviceDateConfigModal';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';

import { MedicalBadge, MedicalBadgeVariant } from '@/components/ui/base/MedicalBadge';

// ============================================================================
// HandoffBedCell
// ============================================================================

interface HandoffBedCellProps {
    bedName: string;
    isSubRow: boolean;
    daysHospitalized: number | null;
}

export const HandoffBedCell: React.FC<HandoffBedCellProps> = ({ bedName, isSubRow, daysHospitalized }) => (
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
);

// ============================================================================
// HandoffPatientCell
// ============================================================================

interface HandoffPatientCellProps {
    patient: PatientData;
    isSubRow?: boolean;
}

export const HandoffPatientCell: React.FC<HandoffPatientCellProps> = ({ patient, isSubRow }) => (
    <td className="p-2 border-r border-slate-200 min-w-[150px] align-middle print:min-w-0 print:w-auto print:text-[10px] print:p-1">
        <div className="font-medium text-slate-800 flex flex-col gap-0.5 leading-snug print:leading-none">
            <div className="flex items-center gap-1 flex-wrap">
                {isSubRow && <Baby size={14} className="text-pink-400 print:hidden" />}
                {isSubRow && <span className="hidden print:inline text-[8px] text-pink-600 font-bold">(RN)</span>}
                <span className="font-bold text-slate-900">{patient.patientName}</span>
            </div>
            <div className="font-mono text-[10px] text-slate-500 leading-none mt-1">
                {patient.rut}
            </div>
            {patient.age && (
                <div className="text-slate-400 font-normal text-[10px] print:text-[8px] mt-0.5">
                    ({patient.age})
                </div>
            )}
            {patient.admissionDate && (
                <div className="text-slate-400 font-bold text-[9px] mt-0.5">
                    FI: {formatDateDDMMYYYY(patient.admissionDate)}
                </div>
            )}
        </div>
    </td>
);

// ============================================================================
// HandoffDiagnosisCell
// ============================================================================

interface HandoffDiagnosisCellProps {
    patient: PatientData;
    isMedical: boolean;
    isSubRow: boolean;
    showEvents: boolean;
    setShowEvents: (val: boolean) => void;
    hasEvents: boolean;
    isFieldReadOnly: boolean;
    onClinicalEventAdd?: (event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
    onClinicalEventUpdate?: (eventId: string, data: Partial<ClinicalEvent>) => void;
    onClinicalEventDelete?: (eventId: string) => void;
}

export const HandoffDiagnosisCell: React.FC<HandoffDiagnosisCellProps> = ({
    patient,
    isMedical,
    isSubRow,
    showEvents,
    setShowEvents,
    hasEvents,
    isFieldReadOnly,
    onClinicalEventAdd,
    onClinicalEventUpdate,
    onClinicalEventDelete
}) => {
    const statusVariant: MedicalBadgeVariant =
        patient.status === PatientStatus.GRAVE ? 'red' :
            patient.status === PatientStatus.DE_CUIDADO ? 'orange' : 'green';

    return (
        <td className="p-1.5 border-r border-slate-200 w-[260px] text-slate-700 align-top relative print:w-20 print:text-[10px] print:leading-tight print:p-1">
            <div className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-0">
                    <div className="font-medium leading-tight flex-1 pr-6">
                        {patient.pathology}
                    </div>
                    {!isMedical && !isSubRow && (onClinicalEventAdd || hasEvents) && (
                        <button
                            onClick={() => setShowEvents(!showEvents)}
                            className={clsx(
                                "absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded transition-all print:hidden",
                                hasEvents
                                    ? "text-medical-600 bg-medical-50/80 hover:bg-medical-100 shadow-sm border border-medical-100"
                                    : "text-slate-400 hover:text-slate-600 border border-transparent"
                            )}
                            title={showEvents ? "Ocultar eventos" : "Ver eventos clínicos"}
                        >
                            <ChevronDown
                                size={10}
                                className={clsx("transition-transform", showEvents && "rotate-180")}
                            />
                        </button>
                    )}
                </div>

                {!showEvents && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-200 flex justify-start">
                        <MedicalBadge variant={statusVariant} className="text-center">
                            {patient.status}
                        </MedicalBadge>
                    </div>
                )}

                {showEvents && !isMedical && onClinicalEventAdd && onClinicalEventUpdate && onClinicalEventDelete && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <ClinicalEventsPanel
                            events={patient.clinicalEvents || []}
                            onAdd={onClinicalEventAdd}
                            onUpdate={onClinicalEventUpdate}
                            onDelete={onClinicalEventDelete}
                            readOnly={isFieldReadOnly}
                        />
                    </div>
                )}
            </div>
        </td>
    );
};

// ============================================================================
// HandoffDevicesCell
// ============================================================================

interface HandoffDevicesCellProps {
    patient: PatientData;
    reportDate: string;
}

export const HandoffDevicesCell: React.FC<HandoffDevicesCellProps> = ({ patient, reportDate }) => (
    <td className="p-2 border-r border-slate-200 w-28 text-xs align-middle print:w-auto print:text-[9px] print:p-1">
        <div className="flex flex-wrap gap-1">
            {patient.devices.length > 0 ? patient.devices.map(d => {
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
                    <MedicalBadge key={d} variant="slate" pill={false}>
                        {d}
                        {deviceDays !== null && deviceDays > 0 && (
                            <span className="font-bold ml-0.5">({deviceDays}d)</span>
                        )}
                    </MedicalBadge>
                );
            }) : <span className="text-slate-400 print:text-[9px]">-</span>}
        </div>
    </td>
);

// ============================================================================
// HandoffObservationsCell
// ============================================================================

interface HandoffObservationsCellProps {
    noteValue: string;
    onNoteChange: (val: string) => void;
    isFieldReadOnly: boolean;
}

export const HandoffObservationsCell: React.FC<HandoffObservationsCellProps> = ({
    noteValue,
    onNoteChange,
    isFieldReadOnly
}) => (
    <td className="p-2 w-full min-w-[300px] align-top print:w-auto print:min-w-0 print:text-[8px] print:p-0.5">
        {isFieldReadOnly ? (
            <div className="whitespace-pre-wrap break-words text-sm text-slate-800 p-2 min-h-[50px] print:min-h-0 print:p-0 print:text-[8px] print:leading-tight">
                {noteValue || <span className="text-slate-400 italic">Sin observaciones</span>}
            </div>
        ) : (
            <>
                <div className="print:hidden">
                    <DebouncedTextarea
                        value={noteValue}
                        onChangeValue={onNoteChange}
                        className="w-full p-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 focus:outline-none bg-white"
                        minRows={2}
                        debounceMs={1500}
                    />
                </div>
                <div className="hidden print:block w-full whitespace-pre-wrap break-words text-slate-800 print:text-[8px] print:leading-tight">
                    {noteValue}
                </div>
            </>
        )}
    </td>
);
