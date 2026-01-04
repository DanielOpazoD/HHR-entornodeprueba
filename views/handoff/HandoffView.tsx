import React, { useMemo, useState, useCallback } from 'react';
import { useDailyRecordContext } from '../../context/DailyRecordContext';
import { useStaffContext } from '../../context/StaffContext';
import { BEDS } from '../../constants';
import { MessageSquare, Stethoscope, Share2, Send, Printer } from 'lucide-react';
import clsx from 'clsx';
import { getShiftSchedule } from '../../utils/dateUtils';

// Sub-components
import { HandoffRow } from './HandoffRow';
import { HandoffChecklistDay } from './HandoffChecklistDay';
import { HandoffChecklistNight } from './HandoffChecklistNight';
import { HandoffNovedades } from './HandoffNovedades';
import { HandoffStaffSelector } from './HandoffStaffSelector';
import { HandoffCudyrPrint } from './HandoffCudyrPrint';
import { HandoffPrintHeader } from './HandoffPrintHeader';
import { HandoffShiftSelector } from './HandoffShiftSelector';
import { MedicalHandoffHeader } from './MedicalHandoffHeader';
import { MovementsSummary } from './MovementsSummary';
import { SaveBackupButton } from '../../components/handoff/SaveBackupButton';

import { useNotification } from '@/context/UIContext';
import { useHandoffLogic } from '@/hooks';
import { useAuditContext } from '../../context/AuditContext';
import { getAttributedAuthors } from '../../services/admin/attributionService';
import { useEffect } from 'react';
import { useUIState, UseUIStateReturn } from '@/hooks/useUIState';

interface HandoffViewProps {
    type?: 'nursing' | 'medical';
    readOnly?: boolean;
    ui?: UseUIStateReturn;
}

export const HandoffView: React.FC<HandoffViewProps> = ({ type = 'nursing', readOnly = false, ui: propUi }) => {
    const {
        record,
        updatePatient,
        updatePatientMultiple,
        updateClinicalCrib,
        updateClinicalCribMultiple,
        updateHandoffChecklist,
        updateHandoffNovedades,
        updateHandoffStaff,
        updateMedicalHandoffDoctor,
        markMedicalHandoffAsSent,
        sendMedicalHandoff
    } = useDailyRecordContext();
    const { nursesList } = useStaffContext();
    const { success } = useNotification();
    const { logEvent } = useAuditContext();

    // Use prop UI state (shared) or local UI state (if direct mount)
    const localUi = useUIState();
    const ui = propUi || localUi;

    const {
        selectedShift,
        setSelectedShift,
        isMedical,
        visibleBeds,
        hasAnyPatients,
        schedule,
        noteField,
        deliversList,
        receivesList,
        tensList,
        shouldShowPatient,
        handleNursingNoteChange,
        handleShareLink,
        handleSendWhatsAppManual,
        formatPrintDate,
    } = useHandoffLogic({
        record,
        type,
        selectedShift: ui.selectedShift,
        setSelectedShift: ui.setSelectedShift,
        updatePatient,
        updatePatientMultiple,
        updateClinicalCrib,
        updateClinicalCribMultiple,
        sendMedicalHandoff,
        onSuccess: success,
    });

    // MINSAL Traceability: Log when clinical data is viewed
    const { userId } = useAuditContext();
    useEffect(() => {
        if (record && record.date) {
            // Attribution logic for shared accounts (MINSAL requirement)
            const authors = getAttributedAuthors(userId, record, isMedical ? undefined : (selectedShift as 'day' | 'night'));

            logEvent(
                isMedical ? 'VIEW_MEDICAL_HANDOFF' : 'VIEW_NURSING_HANDOFF',
                'dailyRecord',
                record.date,
                {
                    view: isMedical ? 'medical_handoff' : 'nursing_handoff',
                    shift: selectedShift
                },
                undefined,
                record.date,
                authors
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record?.date, type, selectedShift, isMedical, userId]); // Only log when essential state changes

    // Update document title for PDF export filename
    useEffect(() => {
        if (!record?.date) return;

        const [year, month, day] = record.date.split('-');
        const formattedDate = `${day}-${month}-${year}`;

        if (isMedical) {
            document.title = `Entrega Medico ${formattedDate}`;
        } else {
            const prefix = selectedShift === 'day' ? 'TL' : 'TN';
            document.title = `${prefix} ${formattedDate}`;
        }

        // Cleanup: Reset title when unmounting
        return () => {
            document.title = 'Hospital Hanga Roa';
        };
    }, [record?.date, selectedShift, isMedical]);


    const title = isMedical
        ? 'Entrega Turno Médicos'
        : `Entrega Turno Enfermería - ${selectedShift === 'day' ? 'Día' : 'Noche'} `;
    const Icon = isMedical ? Stethoscope : MessageSquare;
    const headerColor = isMedical ? 'text-sky-600' : 'text-medical-600';
    const tableHeaderClass = isMedical
        ? "bg-sky-100 text-sky-900 text-xs uppercase tracking-wider font-semibold border-b border-sky-100"
        : selectedShift === 'day'
            ? "bg-medical-50 text-medical-900 text-xs uppercase tracking-wider font-semibold border-b border-medical-100"
            : "bg-slate-100 text-slate-800 text-xs uppercase tracking-wider font-semibold border-b border-slate-200";

    if (!record) {
        return <div className="p-8 text-center text-slate-500 font-sans">Seleccione una fecha para ver la Entrega de Turno.</div>;
    }

    return (
        <div className="space-y-3 print:space-y-2 animate-fade-in pb-20 font-sans max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 print:max-w-none print:w-full print:px-0 print:pb-0">
            {/* Print-only Header */}
            <HandoffPrintHeader
                title={title}
                dateString={formatPrintDate()}
                Icon={Icon}
                isMedical={isMedical}
                schedule={schedule}
                selectedShift={selectedShift}
                deliversList={deliversList}
                receivesList={receivesList}
                tensList={tensList}
            />

            {/* Main Header (Visible) with integrated Shift Switcher */}
            <header className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center gap-3 print:hidden">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 rounded-lg">
                        <Icon size={24} className={headerColor} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">
                            {isMedical ? 'Entrega de Turno' : 'Entrega de Turno Enfermería'}
                        </h2>
                    </div>
                </div>

                <div className="flex-1" />

                <div className="flex items-center gap-2">
                    {/* Shift Switcher - Only Nursing */}
                    {!isMedical && (
                        <div className="flex bg-slate-100 p-1 rounded-lg">
                            <button
                                onClick={() => setSelectedShift('day')}
                                className={clsx(
                                    "p-1.5 rounded-md text-sm font-medium transition-colors",
                                    selectedShift === 'day' ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                )}
                            >
                                Turno Largo
                            </button>
                            <button
                                onClick={() => setSelectedShift('night')}
                                className={clsx(
                                    "p-1.5 rounded-md text-sm font-medium transition-colors",
                                    selectedShift === 'night' ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                )}
                            >
                                Turno Noche
                            </button>
                        </div>
                    )}
                </div>

                {/* Medical Action Buttons */}
                {isMedical && !readOnly && (
                    <div className="flex items-center gap-2 md:ml-auto">
                        <button
                            onClick={handleSendWhatsAppManual}
                            disabled={!!record.medicalSignature}
                            className={clsx(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                                record.medicalSignature
                                    ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                                    : "bg-green-500 text-white hover:bg-green-600"
                            )}
                            title="Enviar entrega por WhatsApp (Manual)"
                            aria-label="Enviar entrega por WhatsApp (Manual)"
                        >
                            <Send size={14} aria-hidden="true" /> Enviar por WhatsApp
                        </button>
                        <button
                            onClick={handleShareLink}
                            className="flex items-center gap-2 px-3 py-1.5 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200 transition-colors text-xs font-bold"
                            title="Generar link para firma del médico"
                            aria-label="Generar link para firma del médico"
                        >
                            <Share2 size={14} aria-hidden="true" />
                        </button>
                    </div>
                )}
            </header>

            {/* Medical Handoff Header (Doctor to Doctor) */}
            {isMedical && (
                <MedicalHandoffHeader
                    record={record}
                    visibleBeds={visibleBeds}
                    readOnly={readOnly}
                    updateMedicalHandoffDoctor={updateMedicalHandoffDoctor}
                    markMedicalHandoffAsSent={markMedicalHandoffAsSent}
                />
            )}

            {/* Compact Staff & Checklist Section (Monitor view) */}
            {
                !isMedical && (
                    <div className="bg-white rounded-lg border border-slate-200 p-2 print:hidden">
                        {/* Staff Selectors - Compact horizontal layout */}
                        <div className="flex flex-wrap gap-x-6 gap-y-2 items-center mb-2 pb-2 border-b border-slate-100">
                            <HandoffStaffSelector
                                label="Entrega"
                                type="delivers"
                                bgClass=""
                                selectedNurses={deliversList}
                                availableNurses={nursesList}
                                onUpdate={(list) => updateHandoffStaff(selectedShift, 'delivers', list)}
                                readOnly={readOnly}
                                compact
                            />
                            <HandoffStaffSelector
                                label="Recibe"
                                type="receives"
                                bgClass=""
                                selectedNurses={receivesList}
                                availableNurses={nursesList}
                                onUpdate={(list) => updateHandoffStaff(selectedShift, 'receives', list)}
                                readOnly={readOnly}
                                compact
                            />

                            {/* Spacer to push CUDYR button to the right */}
                            <div className="flex-1" />

                            {/* CUDYR Button */}
                            <button
                                onClick={() => window.dispatchEvent(new CustomEvent('navigate-module', { detail: 'CUDYR' }))}
                                className="px-3 py-1 text-xs font-bold border-2 border-indigo-500 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors whitespace-nowrap"
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
                                    onUpdate={(field, val) => updateHandoffChecklist('day', field, val)}
                                    readOnly={readOnly}
                                />
                            ) : (
                                <HandoffChecklistNight
                                    data={record.handoffNightChecklist}
                                    onUpdate={(field, val) => updateHandoffChecklist('night', field, val)}
                                    readOnly={readOnly}
                                />
                            )}
                        </div>
                    </div>
                )
            }

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none print:rounded-none print:overflow-visible">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse print:table-fixed print:[&_th]:p-1 print:[&_td]:p-1 print:[&_th]:text-[10px] print:[&_td]:text-[10px]">
                        <thead>
                            <tr className={tableHeaderClass}>
                                <th className="p-2 border-r border-slate-200 text-center w-20 print:w-[35px] print:text-[10px] print:p-1">Cama</th>
                                <th className="p-2 border-r border-slate-200 min-w-[150px] print:w-[15%] print:text-[10px] print:p-1">Nombre Paciente</th>
                                <th className="p-2 border-r border-slate-200 w-36 print:hidden">RUT</th>
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

                                // Check if patient should be shown in current shift
                                // If no patient name and not blocked, show empty bed
                                // If patient is blocked, always show
                                // Otherwise, apply shift filter
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
                                            patient={{ isBlocked: false } as any}
                                            reportDate={record.date}
                                            noteField={noteField}
                                            onNoteChange={(val) => handleNursingNoteChange(bed.id, val, false)}
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
                                            onNoteChange={(val) => handleNursingNoteChange(bed.id, val, false)}
                                            readOnly={readOnly}
                                        />

                                        {patient.clinicalCrib && patient.clinicalCrib.patientName && (
                                            <HandoffRow
                                                bedName={bed.name}
                                                bedType="Cuna"
                                                patient={patient.clinicalCrib}
                                                reportDate={record.date}
                                                isSubRow={true}
                                                noteField={noteField}
                                                onNoteChange={(val) => handleNursingNoteChange(bed.id, val, true)}
                                                readOnly={readOnly}
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

            <div className="hidden print:block print:h-4" aria-hidden="true" />{/* Print-only spacer */}

            {/* Additional Sections for Nursing Handoff (Altas, Traslados, CMA) */}
            {!isMedical && <MovementsSummary record={record} selectedShift={selectedShift} />}

            {/* Novedades Section */}
            {
                !isMedical && (
                    <HandoffNovedades
                        value={
                            selectedShift === 'day'
                                ? (record.handoffNovedadesDayShift || '')
                                : (record.handoffNovedadesNightShift || record.handoffNovedadesDayShift || '')
                        }
                        onChange={(val) => updateHandoffNovedades(selectedShift, val)}
                    />
                )
            }

            {/* Novedades Section - Medical */}
            {
                isMedical && (
                    <HandoffNovedades
                        value={record.medicalHandoffNovedades || ''}
                        onChange={(val) => updateHandoffNovedades('medical', val)}
                    />
                )
            }

            {/* CUDYR - Night Nursing Print Only */}
            {
                !isMedical && selectedShift === 'night' && (
                    <div className="print:break-before-page">
                        <HandoffCudyrPrint />
                    </div>
                )
            }
        </div >
    );
};
