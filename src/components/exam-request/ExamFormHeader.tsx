/**
 * ExamFormHeader Component
 * Renders the institutional header for the laboratory request form.
 */

import React from 'react';

export const ExamFormHeader: React.FC = () => {
    return (
        <div className="flex justify-between items-center mb-0.5 border-b-2 border-slate-900 pb-0.5">
            <div className="flex gap-2 items-center">
                <img src="/images/logos/logo_HHR.png" alt="Logo HHR" className="h-14 w-auto object-contain" />
                <div className="flex flex-col">
                    <span className="text-[12px] font-black leading-none uppercase text-slate-900">Hospital Hanga Roa</span>
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">Unidad de Laboratorio</span>
                </div>
            </div>
            <h1 className="text-xl font-black tracking-tight text-slate-900 leading-none">Solicitud de Exámenes de Laboratorio Policlínico</h1>
            <div className="flex gap-2 items-center">
                <div className="flex flex-col items-end">
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter text-right">Red Salud Oriente</span>
                </div>
                <img src="/images/logos/logo_SSMO.jpg" alt="Logo SSMO" className="h-10 w-auto object-contain" />
            </div>
        </div>
    );
};
