/**
 * History Tab Component
 * Shows timeline of past hospitalizations
 */

import React from 'react';
import { Clock } from 'lucide-react';
import { PatientHistory } from '../../../services/patient/patientHistoryService';

interface HistoryTabProps {
    history: PatientHistory;
    formatDate: (dateStr: string) => string;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ history, formatDate }) => {
    const pastHospitalizations = history.pastHospitalizations;

    if (pastHospitalizations.length === 0) {
        return (
            <div className="text-center py-8 text-gray-500">
                <Clock size={48} className="mx-auto mb-2 opacity-30" />
                <p>No hay hospitalizaciones previas registradas</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <p className="text-sm text-gray-500 mb-4">
                {pastHospitalizations.length} hospitalización(es) previa(s)
            </p>

            <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>

                {pastHospitalizations.map((hosp, index) => (
                    <div key={index} className="relative pl-10 pb-4">
                        {/* Timeline dot */}
                        <div className="absolute left-2.5 w-3 h-3 bg-teal-500 rounded-full border-2 border-white shadow"></div>

                        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-teal-700">
                                    {formatDate(hosp.admissionDate)}
                                </span>
                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                    {hosp.daysStayed} días
                                </span>
                            </div>
                            <p className="text-sm text-gray-800">{hosp.diagnosis || 'Sin diagnóstico registrado'}</p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                                <span>Cama: {hosp.bedId.replace('BED_', '')}</span>
                                <span>•</span>
                                <span>{hosp.service}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
