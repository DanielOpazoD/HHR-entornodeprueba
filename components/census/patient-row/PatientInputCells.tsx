import React from 'react';
import { PatientData, DeviceDetails, Specialty } from '../../../types';
import { SPECIALTY_OPTIONS, STATUS_OPTIONS } from '../../../constants';
import clsx from 'clsx';
import { ArrowRight, Baby, AlertCircle } from 'lucide-react';
import { DeviceSelector } from '../../DeviceSelector';
import { DebouncedInput } from '../../ui/DebouncedInput';
import { RutPassportInput } from './RutPassportInput';
import { PatientInputSchema } from '../../../schemas/inputSchemas';
import { DeliveryRoutePopover } from './DeliveryRoutePopover';
import { TerminologySuggestor } from '../../shared/TerminologySuggestor';

interface PatientInputCellsProps {
    data: PatientData;
    currentDateString: string;
    isSubRow?: boolean;
    isEmpty?: boolean;
    onChange: {
        text: (field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
        check: (field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement>) => void;
        devices: (newDevices: string[]) => void;
        deviceDetails: (details: DeviceDetails) => void;
        toggleDocType?: () => void;
        deliveryRoute?: (route: 'Vaginal' | 'Cesárea' | undefined, date: string | undefined) => void;
        multiple?: (fields: Partial<PatientData>) => void;
    };
    onDemo: () => void;
    readOnly?: boolean;
}

export const PatientInputCells: React.FC<PatientInputCellsProps> = ({
    data,
    currentDateString,
    isSubRow = false,
    isEmpty = false,
    onChange,
    onDemo,
    readOnly = false
}) => {

    const [showAdmissionTime, setShowAdmissionTime] = React.useState(false);

    // Memoize devices and deviceDetails to prevent unnecessary re-renders
    // These must be defined outside conditional rendering to follow hook rules
    const memoizedDevices = React.useMemo(() => data.devices || [], [data.devices]);
    const memoizedDeviceDetails = React.useMemo(() => data.deviceDetails || {}, [data.deviceDetails]);

    // Helper for text fields - adapts debounced handler to original event-based API
    const handleDebouncedText = (field: keyof PatientData) => (value: string) => {
        // Create synthetic event-like object to match existing handler signature
        const syntheticEvent = { target: { value } } as React.ChangeEvent<HTMLInputElement>;
        onChange.text(field)(syntheticEvent);
    };

    const handleText = (field: keyof PatientData) => onChange.text(field);
    const handleCheck = (field: keyof PatientData) => onChange.check(field);

    if (isEmpty && !isSubRow) {
        // Special render for completely empty cells if needed
    }

    return (
        <>
            {/* Name */}
            <td className="py-0.5 px-1 border-r border-slate-200 w-[110px]">
                <div className="relative">
                    {isSubRow && <div className="absolute left-[-15px] top-2 text-slate-300"><ArrowRight size={14} /></div>}
                    <DebouncedInput
                        type="text"
                        className={clsx(
                            "w-full p-0.5 h-7  border rounded transition-all duration-200 focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 focus:outline-none text-[13px] font-medium",
                            isSubRow ? "border-pink-100 bg-white text-xs h-6" : "border-slate-200 bg-white",
                            !PatientInputSchema.pick({ patientName: true }).safeParse({ patientName: data.patientName }).success && data.patientName && "border-red-400 focus:border-red-500 focus:ring-red-100"
                        )}
                        placeholder={isSubRow ? "Nombre RN / Niño" : (isEmpty ? "" : "Nombre Paciente")}
                        value={data.patientName || ''}
                        onChange={handleDebouncedText('patientName')}
                        disabled={readOnly}
                    />
                    {isSubRow && <span className="absolute right-2 top-2 text-pink-400 pointer-events-none"><Baby size={12} /></span>}
                </div>
            </td>

            {/* RUT / PASSPORT */}
            <RutPassportInput
                value={data.rut || ''}
                documentType={data.documentType || 'RUT'}
                isSubRow={isSubRow}
                isEmpty={isEmpty}
                hasName={!!data.patientName && !isEmpty}
                onChange={handleDebouncedText('rut')}
                onToggleType={onChange.toggleDocType}
                readOnly={readOnly}
                hasError={!PatientInputSchema.pick({ rut: true }).safeParse({ rut: data.rut }).success && !!data.rut}
            />

            {/* AGE */}
            <td className="py-0.5 px-1 border-r border-slate-200 w-14 relative">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <input
                        type="text"
                        className={clsx(
                            "w-full h-7 px-1 border border-slate-200 bg-slate-50 text-slate-600 rounded text-center cursor-pointer font-bold text-xs transition-all",
                            isSubRow && "h-6",
                            !PatientInputSchema.pick({ age: true }).safeParse({ age: data.age }).success && data.age && "border-red-400 bg-red-50 text-red-700"
                        )}
                        placeholder="Edad"
                        value={data.age || ''}
                        readOnly
                        onClick={onDemo}
                    />
                )}
            </td>

            {/* DIAGNOSTICO */}
            <td className="py-0.5 px-1 border-r border-slate-200 w-[140px]">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <div className="relative">
                        <TerminologySuggestor
                            className={clsx(
                                "border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-[13px] h-7",
                                !PatientInputSchema.pick({ pathology: true }).safeParse({ pathology: data.pathology }).success && data.pathology
                                    ? "border-red-400 focus:ring-red-200 focus:border-red-500"
                                    : "border-slate-200 focus:ring-medical-500/20 focus:border-medical-500",
                                isSubRow && "text-xs h-6",
                                data.specialty === 'Ginecobstetricia' && "pr-8" // Slightly more room for the icons shift
                            )}
                            placeholder="Diagnóstico"
                            value={data.pathology || ''}
                            iconOffset={data.specialty === 'Ginecobstetricia'}
                            onChange={(text, concept) => {
                                if (concept && onChange.multiple) {
                                    onChange.multiple({
                                        pathology: text,
                                        cie10Code: concept.code, // CIE-10 is now the primary code
                                        snomedCode: undefined    // No longer using SNOMED
                                    });
                                } else {
                                    handleDebouncedText('pathology')(text);
                                }
                            }}
                            disabled={readOnly}
                        />
                        {/* Delivery Route icon for Ginecobstetricia - inside the input */}
                        {data.specialty === 'Ginecobstetricia' && onChange.deliveryRoute && (
                            <div className="absolute right-0.5 top-1/2 -translate-y-1/2 z-10">
                                <DeliveryRoutePopover
                                    deliveryRoute={data.deliveryRoute}
                                    deliveryDate={data.deliveryDate}
                                    onSave={onChange.deliveryRoute}
                                    disabled={readOnly}
                                />
                            </div>
                        )}
                    </div>
                )}
            </td>

            {/* Specialty */}
            <td className="py-0.5 px-1 border-r border-slate-200 w-28">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <select
                        className={clsx(
                            "w-full p-0.5 h-7  border border-slate-200 rounded transition-all duration-200 focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 focus:outline-none text-xs bg-white cursor-pointer",
                            isSubRow && "h-6"
                        )}
                        value={data.specialty || ''}
                        onChange={handleText('specialty')}
                        disabled={readOnly}
                    >
                        <option value="">-- Esp --</option>
                        {SPECIALTY_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                )}
            </td>

            {/* Status - CRITICAL FIELD */}
            <td className="py-0.5 px-1 border-r border-slate-200 w-24">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <div className="relative">
                        <select
                            className={clsx(
                                "w-full p-0.5 h-7 border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-xs font-bold uppercase tracking-tighter cursor-pointer",
                                // Critical field warning when empty but has patient
                                !data.status && data.patientName && "border-red-400 border-2 bg-red-50 focus:ring-red-200 focus:border-red-500",
                                // Normal status colors
                                data.status === 'Grave' ? "text-red-600 bg-red-50/50 border-slate-200 focus:ring-medical-500/20 focus:border-medical-500" :
                                    data.status === 'De cuidado' ? "text-orange-600 bg-orange-50/50 border-slate-200 focus:ring-medical-500/20 focus:border-medical-500" :
                                        data.status ? "text-emerald-700 bg-emerald-50/30 border-slate-200 focus:ring-medical-500/20 focus:border-medical-500" :
                                            "border-slate-200 focus:ring-medical-500/20 focus:border-medical-500",
                                isSubRow && "h-6"
                            )}
                            value={data.status || ''}
                            onChange={handleText('status')}
                            disabled={readOnly}
                            title={!data.status && data.patientName ? "Campo crítico requerido para entrega" : undefined}
                        >
                            <option value="">-- Est --</option>
                            {STATUS_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                        {/* Critical field warning icon */}
                        {!data.status && data.patientName && (
                            <div className="absolute -right-1 -top-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center" title="Campo crítico vacío">
                                <AlertCircle size={8} className="text-white" />
                            </div>
                        )}
                    </div>
                )}
            </td>

            {/* Admission - CRITICAL FIELD */}
            <td className="py-0.5 px-1 border-r border-slate-200 w-28">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <div
                        className="w-full relative"
                        onFocusCapture={() => setShowAdmissionTime(true)}
                        onBlur={(event) => {
                            const next = event.relatedTarget as HTMLElement | null;
                            if (next && event.currentTarget.contains(next)) return;
                            setShowAdmissionTime(false);
                        }}
                    >
                        <DebouncedInput
                            type="date"
                            max={new Date().toISOString().split('T')[0]} // Impossible to have future admission
                            className={clsx(
                                "w-full p-0.5 h-7 border rounded focus:ring-2 focus:outline-none text-xs",
                                // Critical field warning when empty but has patient
                                !data.admissionDate && data.patientName ? "border-red-400 border-2 bg-red-50 focus:ring-red-200 focus:border-red-500" : "border-slate-300 focus:ring-medical-500",
                                isSubRow && "h-6"
                            )}
                            value={data.admissionDate || ''}
                            onChange={handleDebouncedText('admissionDate')}
                            onClick={() => setShowAdmissionTime(true)}
                            disabled={readOnly}
                            title={!data.admissionDate && data.patientName ? "Campo crítico requerido para entrega" : undefined}
                        />
                        {/* Critical field warning icon */}
                        {!data.admissionDate && data.patientName && (
                            <div className="absolute -right-1 -top-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center z-20" title="Campo crítico vacío">
                                <AlertCircle size={8} className="text-white" />
                            </div>
                        )}
                        {showAdmissionTime && (
                            <DebouncedInput
                                type="time"
                                step={300}
                                className="w-24 p-0.5 h-7 border border-slate-300 rounded focus:ring-2 focus:ring-medical-500 focus:outline-none text-xs absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-white shadow-lg z-30"
                                value={data.admissionTime || ''}
                                onChange={handleDebouncedText('admissionTime')}
                                disabled={readOnly}
                            />
                        )}
                    </div>
                )}
            </td>

            {/* Devices */}
            <td className="py-0.5 px-1 border-r border-slate-200 w-32 relative">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <DeviceSelector
                        devices={memoizedDevices}
                        deviceDetails={memoizedDeviceDetails}
                        onChange={onChange.devices}
                        onDetailsChange={onChange.deviceDetails}
                        currentDate={currentDateString}
                        disabled={readOnly || false}
                    />
                )}
            </td>

            <td className="p-0.5 border-r border-slate-200 text-center w-10">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <input type="checkbox" checked={data.surgicalComplication || false} onChange={handleCheck('surgicalComplication')} className="w-4 h-4 text-red-600 rounded" title="Comp. Qx" disabled={readOnly} />
                )}
            </td>

            <td className="p-0.5 text-center w-10">
                {isEmpty && !isSubRow ? (
                    <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
                ) : (
                    <input type="checkbox" checked={data.isUPC || false} onChange={handleCheck('isUPC')} className="w-4 h-4 text-purple-600 rounded" title="UPC" disabled={readOnly} />
                )}
            </td>
        </>
    );
};
