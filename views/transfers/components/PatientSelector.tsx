/**
 * Patient Selector Component
 * Dropdown to select a hospitalized patient for transfer request
 */

import React from 'react';

interface Patient {
    id: string;
    name: string;
    bedId: string;
    diagnosis: string;
}

interface PatientSelectorProps {
    patients: Patient[];
    selectedPatientId: string;
    onChange: (patientId: string) => void;
    disabled?: boolean;
}

export const PatientSelector: React.FC<PatientSelectorProps> = ({
    patients,
    selectedPatientId,
    onChange,
    disabled = false
}) => {
    if (patients.length === 0) {
        return (
            <div className="text-sm text-gray-500 italic p-2 bg-gray-50 rounded">
                No hay pacientes hospitalizados disponibles
            </div>
        );
    }

    return (
        <select
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
            value={selectedPatientId}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
        >
            <option value="">Seleccionar paciente...</option>
            {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                    Cama {patient.bedId.replace('BED_', '')} - {patient.name} ({patient.diagnosis})
                </option>
            ))}
        </select>
    );
};
