import React, { useState, useCallback } from 'react';
import { BedDefinition, PatientData, DeviceDetails, DeviceInstance, BedType } from '@/types';
import { AlertCircle, User, RefreshCcw } from 'lucide-react';
import clsx from 'clsx';
import { useDailyRecordActions } from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';
import { DemographicsModal } from '@/components/modals/DemographicsModal';
import { ExamRequestModal } from '@/components/modals/ExamRequestModal';
import { PatientHistoryModal } from '@/components/modals/PatientHistoryModal';
import { DiagnosisMode } from '@/features/census/components/CensusTable';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';
import { isIntensiveBedType } from '@/utils/bedTypeUtils';

// Sub-components
import { PatientActionMenu } from './patient-row/PatientActionMenu';
import { PatientBedConfig } from './patient-row/PatientBedConfig';
import { PatientInputCells } from './patient-row/PatientInputCells';

interface PatientRowProps {
    bed: BedDefinition;
    data: PatientData;
    currentDateString: string;
    onAction: (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer' | 'cma', bedId: string, patient: PatientData) => void;
    onViewHistory?: (rut: string, name: string) => void;
    showCribControls?: boolean; // Keep as optional if still used in CensusTable but unused here
    readOnly?: boolean;
    actionMenuAlign?: 'top' | 'bottom';
    diagnosisMode?: DiagnosisMode;
    isSubRow?: boolean;
    bedType: BedType;
    style?: React.CSSProperties;
}

const PatientRowComponent: React.FC<PatientRowProps> = ({
    bed,
    data,
    currentDateString,
    onAction,
    readOnly = false,
    actionMenuAlign = 'top',
    diagnosisMode = 'free',
    isSubRow = false,
    bedType,
    style
}) => {
    const { updatePatient, updatePatientMultiple, updateClinicalCrib, updateClinicalCribMultiple, toggleBedType } = useDailyRecordActions();
    const { confirm, alert } = useConfirmDialog();

    const [showDemographics, setShowDemographics] = useState(false);
    const [showExamRequest, setShowExamRequest] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

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

    const handleDeviceHistoryChange = useCallback((history: DeviceInstance[]) => {
        updatePatient(bed.id, 'deviceInstanceHistory', history);
    }, [updatePatient, bed.id]);

    const handleDemographicsSave = useCallback((updatedFields: Partial<PatientData>) => {
        updatePatientMultiple(bed.id, updatedFields);
    }, [updatePatientMultiple, bed.id]);

    const toggleDocumentType = useCallback(() => {
        const newType = data?.documentType === 'Pasaporte' ? 'RUT' : 'Pasaporte';
        updatePatient(bed.id, 'documentType', newType);
    }, [updatePatient, bed.id, data?.documentType]);

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

    const handleCribDeviceHistoryChange = useCallback((history: DeviceInstance[]) => {
        updateClinicalCrib(bed.id, 'deviceInstanceHistory', history);
    }, [updateClinicalCrib, bed.id]);

    const handleCribDemographicsSave = useCallback((updatedFields: Partial<PatientData>) => {
        updateClinicalCribMultiple(bed.id, updatedFields);
    }, [updateClinicalCribMultiple, bed.id]);

    // --- Actions ---
    // Note: We'll use local values derived from data if data exists
    const isCunaMode = data?.bedMode === 'Cuna';
    const hasCompanion = data?.hasCompanionCrib || false;
    const hasClinicalCrib = !!(data?.clinicalCrib && data?.clinicalCrib.bedMode);

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
        updatePatient(bed.id, 'hasCompanionCrib', !hasCompanion);
    }, [isCunaMode, hasCompanion, alert, updatePatient, bed.id]);

    const toggleClinicalCrib = useCallback(() => {
        if (hasClinicalCrib) {
            updateClinicalCrib(bed.id, 'remove');
        } else {
            updateClinicalCrib(bed.id, 'create');
        }
    }, [hasClinicalCrib, updateClinicalCrib, bed.id]);

    const handleAction = useCallback((action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer' | 'cma') => {
        onAction(action, bed.id, data);
    }, [onAction, bed.id, data]);

    // EARLY RETURN ONLY AFTER ALL HOOKS
    if (!data) return null;

    // Defaults (safe to use now)
    const isBlocked = data.isBlocked || false;
    const isEmpty = !data.patientName;

    return (
        <>
            {isSubRow ? (
                <tr
                    className="hover:bg-slate-50 transition-colors border-b border-slate-200 text-[13px] leading-tight"
                    style={style}
                    data-testid="patient-row"
                >
                    <td className="border-r border-slate-200 text-center p-0 w-10">
                        {/* Action Column Spacer */}
                    </td>
                    <td className="p-0 text-right border-r border-slate-200 align-middle group/crib-config">
                        <div className="flex justify-center items-center h-full gap-1">
                            {!readOnly && (
                                <button
                                    onClick={() => setShowDemographics(true)}
                                    className="p-0.5 rounded bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                                    title="Datos demográficos"
                                >
                                    <User size={12} />
                                </button>
                            )}
                        </div>
                    </td>
                    <td className="p-0 border-r border-slate-200 text-center w-16">
                        <MedicalBadge
                            variant="purple"
                            className="w-10 justify-center mx-auto"
                        >
                            CUNA
                        </MedicalBadge>
                    </td>
                    <PatientInputCells
                        data={data}
                        currentDateString={currentDateString}
                        isSubRow={true}
                        onChange={{
                            text: handleCribTextChange,
                            check: handleCribCheckboxChange,
                            devices: handleCribDevicesChange,
                            deviceDetails: handleCribDeviceDetailsChange,
                            deviceHistory: handleCribDeviceHistoryChange,
                            multiple: handleCribDemographicsSave
                        }}
                        onDemo={() => setShowDemographics(true)}
                        readOnly={readOnly}
                    />
                </tr>
            ) : (
                <tr
                    className={clsx(
                        "group/row relative border-b border-slate-100 transition-all duration-200 ease-in-out",
                        "hover:bg-slate-50 hover:shadow-sm hover:z-10",
                        isBlocked ? "bg-slate-50/50" : "bg-white",
                        "text-[12px] leading-tight",
                        // Animate when row is freshly created (patientName is just whitespace)
                        data.patientName?.trim() === '' && "animate-slide-fade-in"
                    )}
                    style={style}
                    data-testid="patient-row"
                    data-bed-id={bed.id}
                >
                    <td className="p-0 text-center border-r border-slate-200 relative w-10 print:hidden">
                        <PatientActionMenu
                            isBlocked={!!isBlocked}
                            onAction={handleAction}
                            onViewDemographics={() => setShowDemographics(true)}
                            onViewExamRequest={data.patientName ? () => setShowExamRequest(true) : undefined}
                            onViewHistory={data.rut ? () => setShowHistory(true) : undefined}
                            readOnly={readOnly}
                            align={actionMenuAlign}
                        />
                    </td>

                    <PatientBedConfig
                        bed={bed}
                        data={data}
                        currentDateString={currentDateString}
                        isBlocked={!!isBlocked}
                        hasCompanion={hasCompanion}
                        hasClinicalCrib={hasClinicalCrib}
                        isCunaMode={isCunaMode}
                        onToggleMode={toggleBedMode}
                        onToggleCompanion={toggleCompanionCrib}
                        onToggleClinicalCrib={toggleClinicalCrib}
                        onTextChange={handleTextChange}
                        onUpdateClinicalCrib={(action) => updateClinicalCrib(bed.id, action)}
                        onShowCribDemographics={() => { }} // Not used in main row anymore as Cuna has its own row
                        readOnly={readOnly}
                        align={actionMenuAlign}
                    />

                    <td className="p-0 border-r border-slate-100 text-center w-16 relative group/tipo-cell">
                        <div className="flex flex-col items-center gap-1 py-1">
                            <MedicalBadge
                                variant={isIntensiveBedType(bedType) ? 'pink' : 'blue'}
                                className="w-10 justify-center mx-auto"
                            >
                                {bedType}
                            </MedicalBadge>
                        </div>
                        {!readOnly && !isEmpty && bed.id.startsWith('R') && (
                            <button
                                onClick={() => toggleBedType(bed.id)}
                                className="absolute top-0.5 right-0.5 p-0.5 rounded-full text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover/tipo-cell:opacity-100"
                                title="Cambiar nivel de cuidado (UCI/UTI)"
                            >
                                <RefreshCcw size={10} className="animate-hover-spin" />
                            </button>
                        )}
                    </td>

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
                                deviceHistory: handleDeviceHistoryChange,
                                toggleDocType: toggleDocumentType,
                                deliveryRoute: handleDeliveryRouteChange,
                                multiple: handleDemographicsSave
                            }}
                            onDemo={() => setShowDemographics(true)}
                            readOnly={readOnly}
                            diagnosisMode={diagnosisMode}
                        />
                    )}
                </tr>
            )}

            {/* Common Modals */}
            <DemographicsModal
                isOpen={showDemographics}
                onClose={() => setShowDemographics(false)}
                data={data}
                onSave={isSubRow ? handleCribDemographicsSave : handleDemographicsSave}
                bedId={isSubRow ? `${bed.id}-cuna` : bed.id}
                recordDate={currentDateString}
            />

            {showExamRequest && (
                <ExamRequestModal
                    key={`exam-request-${bed.id}-${showExamRequest}`}
                    isOpen={showExamRequest}
                    onClose={() => setShowExamRequest(false)}
                    patient={data}
                />
            )}

            <PatientHistoryModal
                isOpen={showHistory}
                onClose={() => setShowHistory(false)}
                patientRut={data.rut || ''}
                patientName={data.patientName}
            />
        </>
    );
};

export const PatientRow = React.memo(PatientRowComponent);
