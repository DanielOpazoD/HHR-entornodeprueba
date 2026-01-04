/**
 * Statistics Tab Component
 * Shows aggregated statistics of patient hospitalizations
 */

import React from 'react';
import { Activity, Calendar } from 'lucide-react';
import { PatientHistory } from '../../../services/patient/patientHistoryService';

interface StatsTabProps {
    history: PatientHistory;
}

export const StatsTab: React.FC<StatsTabProps> = ({ history }) => {
    const avgStay = history.totalHospitalizations > 0
        ? Math.round(history.totalDaysHospitalized / history.totalHospitalizations)
        : 0;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-teal-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-teal-600">{history.totalHospitalizations}</p>
                    <p className="text-xs text-gray-600 mt-1">Hospitalizaciones</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-emerald-600">{history.totalDaysHospitalized}</p>
                    <p className="text-xs text-gray-600 mt-1">Días totales</p>
                </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                    <Activity size={16} className="text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Promedio de estadía</span>
                </div>
                <p className="text-2xl font-bold text-gray-800">{avgStay} días</p>
            </div>

            {history.pastHospitalizations.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Calendar size={16} className="text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">Última hospitalización</span>
                    </div>
                    <p className="text-sm text-gray-800">
                        {new Date(history.pastHospitalizations[0].admissionDate).toLocaleDateString('es-CL', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                        })}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                        {history.pastHospitalizations[0].diagnosis}
                    </p>
                </div>
            )}
        </div>
    );
};
