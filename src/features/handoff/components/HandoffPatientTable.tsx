import React, { useState } from 'react';
import { BedDefinition, DailyRecord, PatientData, ClinicalEvent } from '@/types';
import { HandoffRow } from './HandoffRow';
import { Maximize2, Minimize2 } from 'lucide-react';

interface HandoffPatientTableProps {
    visibleBeds: BedDefinition[];
    record: DailyRecord;
    noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift' | 'medicalHandoffNote';
    onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
    tableHeaderClass: string;
    readOnly: boolean;
    isMedical: boolean;
    hasAnyPatients: boolean;
    shouldShowPatient: (bedId: string) => boolean;
    // Clinical Events callbacks
    onClinicalEventAdd?: (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
    onClinicalEventUpdate?: (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => void;
    onClinicalEventDelete?: (bedId: string, eventId: string) => void;
}

export const HandoffPatientTable: React.FC<HandoffPatientTableProps> = ({
    visibleBeds,
    record,
    noteField,
    onNoteChange,
    tableHeaderClass,
    readOnly,
    isMedical,
    hasAnyPatients,
    shouldShowPatient,
    onClinicalEventAdd,
    onClinicalEventUpdate,
    onClinicalEventDelete
}) => {
    const [allEventsExpanded, setAllEventsExpanded] = useState(false);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none print:rounded-none print:overflow-visible">
            <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left border-collapse print:[&_th]:p-1 print:[&_td]:p-1 print:[&_th]:text-[10px] print:[&_td]:text-[10px]">
                    <thead>
                        <tr className={tableHeaderClass}>
                            <th className="p-2 border-r border-slate-200 w-16 print:w-[35px] print:text-[10px] print:p-1">Cama</th>
                            <th className="p-2 border-r border-slate-200 w-44 print:w-[20%] print:text-[10px] print:p-1" title="Nombre, RUT, Edad, Fecha de Ingreso">Paciente</th>
                            <th className="p-2 border-r border-slate-200 w-[260px] print:w-[30%] print:text-[10px] print:p-1">
                                <div className="flex items-center justify-between">
                                    <span>Diagnóstico</span>
                                    {!isMedical && (
                                        <button
                                            onClick={() => setAllEventsExpanded(!allEventsExpanded)}
                                            className="p-1 hover:bg-black/5 rounded transition-colors print:hidden flex items-center justify-center"
                                            title={allEventsExpanded ? "Colapsar todos los eventos" : "Expandir todos los eventos"}
                                        >
                                            {allEventsExpanded ? (
                                                <Minimize2 size={12} className="opacity-70" />
                                            ) : (
                                                <Maximize2 size={12} className="opacity-70" />
                                            )}
                                        </button>
                                    )}
                                </div>
                            </th>
                            {!isMedical && (
                                <th className="p-2 border-r border-slate-200 w-28 print:w-[50px] print:text-[10px] print:p-1" title="Dispositivos médicos invasivos">DMI</th>
                            )}
                            <th className="p-2 print:w-[35%] print:min-w-0 print:text-[10px] print:p-1">Observaciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleBeds.map(bed => {
                            const patient = record.beds[bed.id];

                            // Safety check: if bed data is missing in record, show as empty
                            if (!patient) {
                                return (
                                    <HandoffRow
                                        key={bed.id}
                                        bedName={bed.name}
                                        bedType={bed.type}
                                        patient={{ isBlocked: false } as PatientData}
                                        reportDate={record.date}
                                        noteField={noteField}
                                        onNoteChange={(val) => onNoteChange(bed.id, val, false)}
                                        readOnly={readOnly}
                                        isMedical={isMedical}
                                    />
                                );
                            }

                            // Check if patient should be shown in current shift
                            const showPatient = patient.isBlocked ||
                                !patient.patientName ||
                                shouldShowPatient(bed.id);

                            // If patient should be hidden, render empty bed row
                            if (!showPatient) {
                                return (
                                    <HandoffRow
                                        key={bed.id}
                                        bedName={bed.name}
                                        bedType={bed.type}
                                        patient={{ isBlocked: false } as PatientData}
                                        reportDate={record.date}
                                        noteField={noteField}
                                        onNoteChange={(val) => onNoteChange(bed.id, val, false)}
                                        readOnly={readOnly}
                                        isMedical={isMedical}
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
                                        isMedical={isMedical}
                                        forcedExpand={allEventsExpanded}
                                        // Clinical Events handlers - only for nursing handoff
                                        onClinicalEventAdd={onClinicalEventAdd ? (event) => onClinicalEventAdd(bed.id, event) : undefined}
                                        onClinicalEventUpdate={onClinicalEventUpdate ? (eventId, data) => onClinicalEventUpdate(bed.id, eventId, data) : undefined}
                                        onClinicalEventDelete={onClinicalEventDelete ? (eventId) => onClinicalEventDelete(bed.id, eventId) : undefined}
                                    />

                                    {patient.clinicalCrib && patient.clinicalCrib.patientName && (
                                        <HandoffRow
                                            bedName={bed.name}
                                            bedType="Cuna"
                                            patient={patient.clinicalCrib}
                                            reportDate={record.date}
                                            isSubRow={true}
                                            noteField={noteField}
                                            onNoteChange={(val) => onNoteChange(bed.id, val, true)}
                                            readOnly={readOnly}
                                            isMedical={isMedical}
                                            forcedExpand={allEventsExpanded}
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {/* If no occupied beds found */}
                        {!hasAnyPatients && (
                            <tr>
                                <td colSpan={isMedical ? 4 : 5} className="p-8 text-center text-slate-400 italic text-sm">
                                    No hay pacientes registrados en este turno.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
