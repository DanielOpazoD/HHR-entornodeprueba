import React from 'react';
import { LucideIcon } from 'lucide-react';

interface HandoffPrintHeaderProps {
    title: string;
    dateString: string;
    Icon: LucideIcon;
    schedule?: {
        dayStart: string;
        dayEnd: string;
        nightStart: string;
        nightEnd: string;
    };
    selectedShift?: 'day' | 'night';
    isMedical: boolean;
    deliversList?: string[];
    receivesList?: string[];
    tensList?: string[];
}

export const HandoffPrintHeader: React.FC<HandoffPrintHeaderProps> = ({
    title,
    dateString,
    Icon: _Icon,
    schedule,
    selectedShift,
    isMedical,
    deliversList = [],
    receivesList = [],
    tensList = []
}) => {
    return (
        <div className="hidden print:block mb-4 pb-4 border-b-2 border-slate-800">
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-start gap-4">
                    <img
                        src="/images/logos/logo_HHR.png"
                        alt="Logo HHR"
                        className="w-12 h-12 print:w-10 print:h-10 object-contain shadow-sm border border-slate-100 p-1 print:p-0 print:border-0 print:shadow-none"
                    />
                    <div>
                        <h1 className="text-2xl print:text-lg font-bold text-slate-900 uppercase tracking-tight">
                            {title}
                        </h1>
                        <p className="text-sm text-slate-600 font-medium mt-1 uppercase tracking-wide print:text-xs">
                            Servicio Hospitalizados Hanga Roa
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-xl print:text-base font-bold text-slate-900">{dateString}</div>
                    {!isMedical && schedule && (
                        <div className="text-sm text-slate-600 uppercase print:text-xs">
                            {selectedShift === 'day'
                                ? `Turno Largo (${schedule.dayStart} - ${schedule.dayEnd})`
                                : `Turno Noche (${schedule.nightStart} - ${schedule.nightEnd})`
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* Print: Show Responsible Nurses & TENS */}
            {!isMedical && (
                <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-4 text-xs border-t border-slate-300 pt-3">
                    <div className="min-w-0">
                        <span className="block font-bold text-slate-900 uppercase text-[9px] mb-0.5">Enfermero(a) Entrega:</span>
                        <div className="text-slate-800 text-[10px] break-words">
                            {deliversList.length > 0 ? deliversList.filter(Boolean).join(', ') : <span className="italic text-slate-400">Sin especificar</span>}
                        </div>
                    </div>
                    <div className="min-w-0">
                        <span className="block font-bold text-slate-900 uppercase text-[9px] mb-0.5">Enfermero(a) Recibe:</span>
                        <div className="text-slate-800 text-[10px] break-words">
                            {receivesList.length > 0 ? receivesList.filter(Boolean).join(', ') : <span className="italic text-slate-400">Sin especificar</span>}
                        </div>
                    </div>
                    <div className="min-w-0 border-l border-slate-100 pl-4">
                        <span className="block font-bold text-slate-900 uppercase text-[9px] mb-0.5">TENS de Turno:</span>
                        <div className="text-slate-800 text-[10px] break-words font-medium">
                            {tensList.length > 0 ? tensList.filter(Boolean).join(', ') : <span className="italic text-slate-400">Sin registro</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
