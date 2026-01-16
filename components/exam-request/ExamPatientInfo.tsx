/**
 * ExamPatientInfo Component
 * Displays patient information section in the laboratory request form.
 */

import React from 'react';
import { PatientData } from '@/types';
import { formatDateDDMMYYYY } from '@/services/dataService';

interface ExamPatientInfoProps {
    patient: PatientData;
}

export const ExamPatientInfo: React.FC<ExamPatientInfoProps> = ({ patient }) => {
    return (
        <div className="border border-slate-400 p-1 mb-1">
            <div className="grid grid-cols-12 gap-x-2 border-b border-slate-200 pb-1 mb-1">
                <div className="col-span-10 flex gap-2">
                    <span className="text-[9px] font-black text-slate-900 uppercase whitespace-nowrap">NOMBRES Y APELLIDOS:</span>
                    <div className="text-[17px] font-black text-slate-900 border-b border-slate-900 flex-1 h-6 px-1 uppercase leading-none">{patient.patientName}</div>
                </div>
                <div className="col-span-2 flex gap-1">
                    <span className="text-[9px] font-black text-slate-900 uppercase">FICHA:</span>
                    <div className="border-b border-slate-900 flex-1 h-6"></div>
                </div>
            </div>
            <div className="grid grid-cols-12 gap-x-4 border-b border-slate-200 pb-1 mb-1">
                <div className="col-span-4 flex gap-2">
                    <span className="text-[9px] font-black text-slate-900 uppercase">RUT:</span>
                    <div className="text-[17px] font-black text-slate-900 border-b border-slate-900 flex-1 h-6 px-1 uppercase leading-none">{patient.rut}</div>
                </div>
                <div className="col-span-5 flex gap-2">
                    <span className="text-[9px] font-black text-slate-900 uppercase">FECHA DE NACIMIENTO:</span>
                    <div className="text-[17px] font-black text-slate-900 border-b border-slate-900 flex-1 h-6 px-1 uppercase leading-none">{patient.birthDate ? formatDateDDMMYYYY(patient.birthDate) : '-'}</div>
                </div>
                <div className="col-span-3 flex gap-2">
                    <span className="text-[9px] font-black text-slate-900 uppercase">FECHA:</span>
                    <div className="text-[17px] font-black text-slate-900 border-b border-slate-900 flex-1 h-6 px-1 uppercase leading-none">{formatDateDDMMYYYY(new Date().toISOString().split('T')[0])}</div>
                </div>
            </div>
            <div className="flex gap-2">
                <span className="text-[9px] font-black text-slate-900 uppercase">DIAGNOSTICO:</span>
                <div className="text-[17px] font-black text-slate-900 border-b border-slate-900 flex-1 h-6 px-1 whitespace-nowrap overflow-hidden uppercase leading-none">{patient.pathology}</div>
            </div>
        </div>
    );
};
