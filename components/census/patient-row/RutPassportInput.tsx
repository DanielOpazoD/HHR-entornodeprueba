import React from 'react';
import clsx from 'clsx';
import { DebouncedInput } from '../../ui/DebouncedInput';
import { usePatientAutocomplete } from '../../../hooks/usePatientAutocomplete';
import { PatientData } from '../../../types'; // Import generic to map
import { MasterPatient } from '../../../types';

interface RutPassportInputProps {
    value: string;
    documentType: string;
    isSubRow?: boolean;
    isEmpty?: boolean;
    hasName?: boolean;
    onChange: (value: string) => void;
    onToggleType?: () => void;
    readOnly?: boolean;
    hasError?: boolean;
    onAutofill?: (data: Partial<PatientData>) => void;
}

export const RutPassportInput: React.FC<RutPassportInputProps> = ({
    value,
    documentType,
    isSubRow = false,
    isEmpty = false,
    hasName = false,
    onChange,
    onToggleType,
    readOnly = false,
    hasError = false,
    onAutofill
}) => {
    // 1. Hook for autocomplete suggestions (Only active for RUT type)
    const { suggestion, isLoading } = usePatientAutocomplete(documentType === 'RUT' ? value : '');

    const handleAutofill = () => {
        if (!suggestion || !onAutofill) return;

        // Map MasterPatient to PatientData
        const partialData: Partial<PatientData> = {
            patientName: suggestion.fullName,
            birthDate: suggestion.birthDate,
            // Cast insurance if it matches allowed values, otherwise ignore or set default
            insurance: ['Fonasa', 'Isapre', 'Particular'].includes(suggestion.forecast || '')
                ? (suggestion.forecast as any)
                : undefined,
            // IDENTITY PROTECTION: When autofilling a new identity, clear clinical data
            // to prevent data leakage from previous patient.
            cie10Code: undefined,
            cie10Description: undefined,
            pathology: '',
            clinicalEvents: [] as any,
            cudyr: undefined,
            deviceDetails: {},
            devices: []
        };

        onAutofill(partialData);
    };

    // Show empty state for main row when no patient
    if (isEmpty && !isSubRow) {
        return (
            <td className="p-1 border-r border-slate-200 w-32">
                <div className="w-full p-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">-</div>
            </td>
        );
    }

    return (
        <td className="p-1 border-r border-slate-200 w-32 relative group/rut">
            <div className="relative">
                <DebouncedInput
                    type="text"
                    className={clsx(
                        "w-full p-0.5 h-9 border rounded focus:ring-2 focus:outline-none text-xs pr-6 transition-all",
                        isSubRow && "h-8",
                        documentType === 'Pasaporte'
                            ? (hasError ? "border-red-400 bg-red-50/50" : "border-slate-300 bg-white")
                            : (hasError ? "border-red-400 bg-red-50/50" : "border-slate-300"),
                        hasError ? "focus:ring-red-200 focus:border-red-500" : "focus:ring-medical-500 focus:border-medical-500",
                        // Highlight if suggestion available
                        suggestion && !hasName && "ring-2 ring-blue-200 border-blue-400"
                    )}
                    placeholder={documentType === 'Pasaporte' ? 'N° Pasaporte' : (hasName ? '' : '12.345.678-9')}
                    value={value || ''}
                    disabled={readOnly}
                    onChange={(val) => {
                        onChange(val);
                    }}
                />

                {/* Autocomplete Indicator / Action */}
                {suggestion && !readOnly && !isSubRow && (
                    <button
                        onClick={handleAutofill}
                        className={clsx(
                            "absolute right-7 top-1/2 -translate-y-1/2 transition-all p-0.5 rounded-full bg-blue-50 hover:bg-blue-100 border border-blue-200",
                            hasName ? "opacity-0 group-hover/rut:opacity-100" : "opacity-100 animate-pulse"
                        )}
                        title={`Cargar datos de: ${suggestion.fullName}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    </button>
                )}

                {/* Loading Indicator */}
                {isLoading && (
                    <div className="absolute right-7 top-1/2 -translate-y-1/2">
                        <div className="w-3 h-3 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
                    </div>
                )}

                {/* Passport indicator - only shows when in passport mode */}
                {documentType === 'Pasaporte' && (
                    <span
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] font-bold cursor-pointer"
                        title="Modo Pasaporte - Click para cambiar a RUT"
                        onClick={!isSubRow && onToggleType && !readOnly ? onToggleType : undefined}
                    >
                        PAS
                    </span>
                )}

                {/* Discrete toggle on hover - only for RUT mode */}
                {documentType !== 'Pasaporte' && !isSubRow && onToggleType && !readOnly && (
                    <button
                        onClick={onToggleType}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-300 hover:text-amber-500 opacity-0 group-hover/rut:opacity-100 transition-opacity"
                        title="Cambiar a Pasaporte"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                            <circle cx="12" cy="10" r="3" />
                            <path d="M7 17a5 5 0 0 1 10 0" />
                        </svg>
                    </button>
                )}
            </div>
        </td>
    );
};
