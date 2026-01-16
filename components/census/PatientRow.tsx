import React, { useState, useCallback } from 'react';
import { BedDefinition, PatientData, DeviceDetails } from '../../types';
import { AlertCircle, GitBranch, User, FileText } from 'lucide-react';
import clsx from 'clsx';
import { useDailyRecordContext } from '../../context/DailyRecordContext';
import { useConfirmDialog } from '../../context/UIContext';
import { DemographicsModal } from '../modals/DemographicsModal';
import { ExamRequestModal } from '../modals/ExamRequestModal';

// Sub-components
import { PatientActionMenu } from './patient-row/PatientActionMenu';
import { PatientBedConfig } from './patient-row/PatientBedConfig';
import { PatientInputCells } from './patient-row/PatientInputCells';

interface PatientRowProps {
    bed: BedDefinition;
    data: PatientData;
    currentDateString: string;
    onAction: (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer', bedId: string) => void;
    onViewHistory?: (rut: string, name: string) => void;
    showCribControls: boolean;
    readOnly?: boolean;
    actionMenuAlign?: 'top' | 'bottom';
}

const PatientRowComponent: React.FC<PatientRowProps> = ({ bed, data, currentDateString, onAction, onViewHistory, showCribControls, readOnly = false, actionMenuAlign = 'top' }) => {
    const { updatePatient, updatePatientMultiple, updateClinicalCrib, updateClinicalCribMultiple } = useDailyRecordContext();
    const { confirm, alert } = useConfirmDialog();
    const isBlocked = data.isBlocked;
    const [showDemographics, setShowDemographics] = useState(false);
    const [showCribDemographics, setShowCribDemographics] = useState(false);
    const [showExamRequest, setShowExamRequest] = useState(false);
    const [showCribExamRequest, setShowCribExamRequest] = useState(false);

    // Defaults
    const isCunaMode = data.bedMode === 'Cuna';
    const hasCompanion = data.hasCompanionCrib || false;
    const hasClinicalCrib = !!(data.clinicalCrib && data.clinicalCrib.bedMode);

    // Check if bed is empty (no patient name)
    const isEmpty = !data.patientName;

    // --- Handlers for Main Patient ---
    const handleTextChange = useCallback((field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        updatePatient(bed.id, field, e.target.value);
    }, [updatePatient, bed.id]);

    const handleCheckboxChange = useCallback((field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        updatePatient(bed.id, field, e.target.checked);
    }, [updatePatient, bed.id]);

    const handleDevicesChange = useCallback((newDevices: string[]) => {
        updatePatient(bed.id, 'devices', newDevices);
    }, [updatePatient, bed.id]);

    const handleDeviceDetailsChange = useCallback((details: DeviceDetails) => {
        updatePatient(bed.id, 'deviceDetails', details);
    }, [updatePatient, bed.id]);

    /**
     * Save demographics with atomic update (all fields in one save operation)
     * This fixes the bug where only the last field was saved due to React's async state updates.
     */
    const handleDemographicsSave = useCallback((updatedFields: Partial<PatientData>) => {
        updatePatientMultiple(bed.id, updatedFields);
    }, [updatePatientMultiple, bed.id]);

    const toggleDocumentType = useCallback(() => {
        const newType = data.documentType === 'Pasaporte' ? 'RUT' : 'Pasaporte';
        updatePatient(bed.id, 'documentType', newType);
    }, [updatePatient, bed.id, data.documentType]);

    const handleDeliveryRouteChange = useCallback((route: 'Vaginal' | 'Cesárea' | undefined, date: string | undefined) => {
        updatePatientMultiple(bed.id, { deliveryRoute: route, deliveryDate: date });
    }, [updatePatientMultiple, bed.id]);

    // --- Handlers for Clinical Crib (Sub-Patient) ---
    const handleCribTextChange = useCallback((field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        updateClinicalCrib(bed.id, field, e.target.value);
    }, [updateClinicalCrib, bed.id]);

    const handleCribCheckboxChange = useCallback((field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        updateClinicalCrib(bed.id, field, e.target.checked);
    }, [updateClinicalCrib, bed.id]);

    const handleCribDevicesChange = useCallback((newDevices: string[]) => {
        updateClinicalCrib(bed.id, 'devices', newDevices);
    }, [updateClinicalCrib, bed.id]);

    const handleCribDeviceDetailsChange = useCallback((details: DeviceDetails) => {
        updateClinicalCrib(bed.id, 'deviceDetails', details);
    }, [updateClinicalCrib, bed.id]);

    /**
     * Save crib demographics with atomic update
     */
    const handleCribDemographicsSave = useCallback((updatedFields: Partial<PatientData>) => {
        updateClinicalCribMultiple(bed.id, updatedFields);
    }, [updateClinicalCribMultiple, bed.id]);

    // --- Toggles ---
    const toggleBedMode = useCallback(async () => {
        if (!isCunaMode && hasCompanion) {
            const confirmed = await confirm({
                title: 'Cambiar a modo Cuna',
                message: "El 'Modo Cuna clínica' (Paciente principal) no suele ser compatible con 'RN Sano' (Acompañante). ¿Desea desactivar RN Sano y continuar?",
                confirmText: 'Sí, continuar',
                cancelText: 'Cancelar',
                variant: 'warning'
            });
            if (!confirmed) return;
            updatePatient(bed.id, 'hasCompanionCrib', false);
        }
        updatePatient(bed.id, 'bedMode', isCunaMode ? 'Cama' : 'Cuna');
    }, [isCunaMode, hasCompanion, confirm, updatePatient, bed.id]);

    const toggleCompanionCrib = useCallback(async () => {
        if (isCunaMode) {
            await alert("No se puede agregar 'RN Sano' si la cama principal está en 'Modo Cuna clínica'. Use el modo Cama para la madre.", "Acción no permitida");
            return;
        }

        if (!hasCompanion && hasClinicalCrib) {
            const confirmed = await confirm({
                title: 'Agregar RN Sano',
                message: "Al agregar Cuna RN Sano, se eliminará la Cuna Clínica adicional actual. ¿Confirmar?",
                confirmText: 'Sí, agregar',
                cancelText: 'Cancelar',
                variant: 'warning'
            });
            if (confirmed) {
                updateClinicalCrib(bed.id, 'remove');
                updatePatient(bed.id, 'hasCompanionCrib', true);
            }
            return;
        }

        updatePatient(bed.id, 'hasCompanionCrib', !hasCompanion);
    }, [isCunaMode, hasCompanion, hasClinicalCrib, alert, confirm, updateClinicalCrib, updatePatient, bed.id]);

    const toggleClinicalCrib = useCallback(() => {
        if (hasClinicalCrib) {
            updateClinicalCrib(bed.id, 'remove');
        } else {
            updateClinicalCrib(bed.id, 'create');
        }
    }, [hasClinicalCrib, updateClinicalCrib, bed.id]);

    const handleAction = useCallback((action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer') => {
        onAction(action, bed.id);
    }, [onAction, bed.id]);

    return (
        <>
            {/* MAIN ROW */}
            <tr className={clsx(
                "group/row relative border-b border-slate-100 transition-all duration-200 ease-in-out",
                "hover:bg-slate-50 hover:shadow-sm hover:z-10",
                isBlocked ? "bg-slate-50/50" : "bg-white",
                "text-[12px] leading-tight"
            )}>
                {/* Action Menu */}
                <td className="p-0 text-center border-r border-slate-200 relative w-10 print:hidden">
                    <PatientActionMenu
                        isBlocked={!!isBlocked}
                        onAction={handleAction}
                        onViewDemographics={() => setShowDemographics(true)}
                        onViewExamRequest={!!data.patientName ? () => setShowExamRequest(true) : undefined}
                        hasPatient={!!data.patientName}
                        readOnly={readOnly}
                        align={actionMenuAlign}
                    />
                </td>

                {/* Bed Name & Configuration */}
                <PatientBedConfig
                    bed={bed}
                    data={data}
                    currentDateString={currentDateString}
                    isBlocked={!!isBlocked}
                    showCribControls={showCribControls}
                    hasCompanion={hasCompanion}
                    hasClinicalCrib={hasClinicalCrib}
                    isCunaMode={isCunaMode}
                    onToggleMode={toggleBedMode}
                    onToggleCompanion={toggleCompanionCrib}
                    onToggleClinicalCrib={toggleClinicalCrib}
                    onTextChange={handleTextChange}
                    onUpdateClinicalCrib={(action) => updateClinicalCrib(bed.id, action)}
                    onShowCribDemographics={() => setShowCribDemographics(true)}
                    readOnly={readOnly}
                />

                {/* Bed Type */}
                <td className="p-0 border-r border-slate-100 text-center w-16">
                    <span className={clsx(
                        "text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border block tracking-tighter",
                        bed.type === 'UTI'
                            ? "bg-purple-50 text-purple-600 border-purple-100"
                            : "bg-blue-50 text-blue-600 border-blue-100"
                    )}>
                        {bed.type}
                    </span>
                </td>

                {/* Data Cells - Always render PatientInputCells to preserve focus */}
                {isBlocked ? (
                    <td colSpan={10} className="p-1 bg-slate-50/50 text-center">
                        <div className="text-slate-400 text-sm flex items-center justify-center gap-2 italic">
                            <AlertCircle size={14} className="text-red-300/60" />
                            <span>Cama Bloqueada</span>
                            {data.blockedReason && <span className="text-xs opacity-70">({data.blockedReason})</span>}
                        </div>
                    </td>
                ) : (
                    <PatientInputCells
                        data={data}
                        currentDateString={currentDateString}
                        isEmpty={isEmpty}
                        onChange={{
                            text: handleTextChange,
                            check: handleCheckboxChange,
                            devices: handleDevicesChange,
                            deviceDetails: handleDeviceDetailsChange,
                            toggleDocType: toggleDocumentType,
                            deliveryRoute: handleDeliveryRouteChange,
                            multiple: handleDemographicsSave
                        }}
                        onDemo={() => setShowDemographics(true)}
                        readOnly={readOnly}
                    />
                )}
            </tr>

            {/* CLINICAL CRIB SUB-ROW (If Active) */}
            {data.clinicalCrib && !isBlocked && (
                <tr className="hover:bg-slate-50 transition-colors border-b border-slate-200 text-[13px] leading-tight">
                    <td className="border-r border-slate-200 text-center p-0">
                        {/* Empty cell to align with action menu column */}
                    </td>
                    <td className="p-0 text-right border-r border-slate-200 align-middle">
                        <div className="flex justify-center items-center h-full">
                            <button
                                onClick={() => setShowCribDemographics(true)}
                                className="p-1 rounded-full bg-purple-100 hover:bg-purple-200 text-purple-600 transition-colors"
                                title="Datos demográficos"
                            >
                                <User size={14} />
                            </button>
                            <button
                                onClick={() => setShowCribExamRequest(true)}
                                className="p-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                                title="Solicitud de exámenes"
                            >
                                <FileText size={14} />
                            </button>
                        </div>
                    </td>
                    <td className="p-0 border-r border-slate-200 text-center">
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full border block bg-purple-100 text-purple-700 border-purple-200">
                            CUNA
                        </span>
                    </td>
                    <PatientInputCells
                        data={data.clinicalCrib}
                        currentDateString={currentDateString}
                        isSubRow={true}
                        onChange={{
                            text: handleCribTextChange,
                            check: handleCribCheckboxChange,
                            devices: handleCribDevicesChange,
                            deviceDetails: handleCribDeviceDetailsChange,
                            multiple: handleCribDemographicsSave // Reuse the multiple update logic for crib
                        }}
                        onDemo={() => setShowCribDemographics(true)}
                        readOnly={readOnly}
                    />
                </tr>
            )}

            {/* Modals */}
            <DemographicsModal
                isOpen={showDemographics}
                onClose={() => setShowDemographics(false)}
                data={data}
                onSave={handleDemographicsSave}
                bedId={bed.id}
                recordDate={currentDateString}
            />

            {data.clinicalCrib && (
                <DemographicsModal
                    isOpen={showCribDemographics}
                    onClose={() => setShowCribDemographics(false)}
                    data={data.clinicalCrib}
                    onSave={handleCribDemographicsSave}
                    bedId={`${bed.id}-cuna`}
                    recordDate={currentDateString}
                />
            )}

            {/* Exam Request Modals */}
            <ExamRequestModal
                isOpen={showExamRequest}
                onClose={() => setShowExamRequest(false)}
                patient={data}
            />

            {data.clinicalCrib && (
                <ExamRequestModal
                    isOpen={showCribExamRequest}
                    onClose={() => setShowCribExamRequest(false)}
                    patient={data.clinicalCrib}
                />
            )}
        </>
    );
};

// Export memoized version to prevent unnecessary re-renders
export const PatientRow = React.memo(PatientRowComponent);
