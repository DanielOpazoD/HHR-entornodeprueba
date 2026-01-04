/**
 * Current Hospitalization Tab Component
 * Shows details of the patient's current hospitalization
 */

import React from 'react';
import { User } from 'lucide-react';
import { PatientHistory } from '../../../services/patient/patientHistoryService';

interface CurrentTabProps {
    history: PatientHistory;
    formatDate: (dateStr: string) => string;
}

export const CurrentTab: React.FC<CurrentTabProps> = ({ history, formatDate }) => {
    const current = history.currentHospitalization;

    if (!current) {
        return (
            <div className="text-center py-8 text-gray-500">
                <User size={48} className="mx-auto mb-2 opacity-30" />
                <p>Paciente no hospitalizado actualmente</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium text-green-700">Hospitalizado actualmente</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <span className="text-gray-500">Cama:</span>
                        <p className="font-medium">{current.bedLabel}</p>
                    </div>
                    <div>
                        <span className="text-gray-500">Servicio:</span>
                        <p className="font-medium">{current.service}</p>
                    </div>
                    <div className="col-span-2">
                        <span className="text-gray-500">Diagnóstico:</span>
                        <p className="font-medium">{current.diagnosis || 'No especificado'}</p>
                    </div>
                    <div className="col-span-2">
                        <span className="text-gray-500">Fecha de ingreso:</span>
                        <p className="font-medium">{formatDate(current.admissionDate)}</p>
                    </div>
                </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Información del Paciente</h4>
                <div className="text-sm space-y-1">
                    <p><span className="text-gray-500">Nombre:</span> {history.name}</p>
                    <p><span className="text-gray-500">RUT:</span> {history.rut}</p>
                </div>
            </div>
        </div>
    );
};
