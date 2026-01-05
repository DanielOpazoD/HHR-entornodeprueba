import React from 'react';
import { BedDefinition, DailyRecord, PatientData } from '@/types';
import { HandoffRow } from './HandoffRow';

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
    shouldShowPatient
}) => {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none print:rounded-none print:overflow-visible">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse print:table-fixed print:[&_th]:p-1 print:[&_td]:p-1 print:[&_th]:text-[10px] print:[&_td]:text-[10px]">
                    <thead>
                        <tr className={tableHeaderClass}>
                            <th className="p-2 border-r border-slate-200 text-center w-20 print:w-[35px] print:text-[10px] print:p-1">Cama</th>
                            <th className="p-2 border-r border-slate-200 min-w-[150px] print:w-[15%] print:text-[10px] print:p-1">Nombre Paciente</th>
                            {!isMedical && <th className="p-2 border-r border-slate-200 w-36 print:hidden">RUT</th>}
                            <th className="p-2 border-r border-slate-200 w-64 print:w-[20%] print:text-[10px] print:p-1">Diagnóstico</th>
                            <th className="p-2 border-r border-slate-200 w-20 print:w-[45px] print:text-[10px] print:p-1">Estado</th>
                            <th className="p-2 border-r border-slate-200 w-28 text-center print:hidden">F. Ingreso</th>
                            <th className="p-2 border-r border-slate-200 w-20 print:w-[50px] print:text-[10px] print:p-1" title="Dispositivos médicos invasivos">DMI</th>
                            <th className="p-2 min-w-[300px] print:w-[45%] print:min-w-0 print:text-[10px] print:p-1">Observaciones</th>
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
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })}

                        {/* If no occupied beds found */}
                        {!hasAnyPatients && (
                            <tr>
                                <td colSpan={10} className="p-8 text-center text-slate-400 italic text-sm">
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
