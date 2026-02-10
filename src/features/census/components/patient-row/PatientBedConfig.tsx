import React from 'react';
import { BedDefinition, PatientData } from '@/types';
import { Baby, Clock, Plus } from 'lucide-react';
import clsx from 'clsx';

/**
 * Calculate days since admission (reused from HandoffRow)
 */
const calculateHospitalizedDays = (admissionDate?: string, currentDate?: string): number | null => {
    if (!admissionDate || !currentDate) return null;
    // Append T12:00:00 to ensure local time noon, avoiding timezone shifts affecting the day
    const start = new Date(`${admissionDate}T12:00:00`);
    const end = new Date(`${currentDate}T12:00:00`);
    const diff = end.getTime() - start.getTime();
    // Use Math.round to handle potential DST offsets (23h or 25h days)
    const days = Math.round(diff / (1000 * 3600 * 24));
    return days >= 0 ? days : 0;
};

interface PatientBedConfigProps {
    bed: BedDefinition;
    data: PatientData;
    currentDateString: string;
    isBlocked: boolean;
    hasCompanion: boolean;
    hasClinicalCrib: boolean;
    isCunaMode: boolean;
    onToggleMode: () => void;
    onToggleCompanion: () => void;
    onToggleClinicalCrib: () => void;
    onTextChange: (field: keyof PatientData) => (e: React.ChangeEvent<HTMLInputElement>) => void;
    onUpdateClinicalCrib: (action: 'remove') => void;
    onShowCribDemographics: () => void;
    readOnly?: boolean;
    align?: 'top' | 'bottom';
}

export const PatientBedConfig: React.FC<PatientBedConfigProps> = ({
    bed,
    data,
    currentDateString,
    isBlocked,
    hasCompanion,
    hasClinicalCrib,
    isCunaMode,
    onToggleMode,
    onToggleCompanion,
    onToggleClinicalCrib,
    onTextChange,
    onUpdateClinicalCrib,
    onShowCribDemographics,
    readOnly = false,
    align = 'top'
}) => {
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    const daysHospitalized = calculateHospitalizedDays(data.admissionDate, currentDateString);
    const hasPatient = !!data.patientName;

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsMenuOpen(false);
            }
        };

        if (isMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMenuOpen]);

    return (
        <td className="p-[2px] border-r border-slate-200 text-center w-24 relative">
            <div className="flex flex-col items-center gap-0.5">
                {/* BED NAME */}
                <div className="font-display font-bold text-lg text-slate-800 flex items-center gap-1.5 leading-none tracking-tight">
                    {bed.name}
                    {isCunaMode && <Baby size={16} className="text-pink-500 drop-shadow-sm" />}
                </div>

                {/* Days Hospitalized Counter */}
                {!isBlocked && hasPatient && daysHospitalized !== null && (
                    <div
                        className="flex items-center gap-0.5 text-slate-500"
                        title={`${daysHospitalized} días hospitalizado`}
                    >
                        <Clock size={10} className="text-slate-400" />
                        <span className="text-[10px] font-semibold">{daysHospitalized}d</span>
                    </div>
                )}

                {/* Static Indicators (Persistent information) */}
                {!isBlocked && (
                    <div className="flex gap-1 mt-1">
                        {isCunaMode && <span className="text-[8px] bg-pink-100 text-pink-700 font-bold px-1 rounded-sm border border-pink-200">CUNA</span>}
                        {hasCompanion && <span className="text-[8px] bg-emerald-100 text-emerald-700 font-bold px-1 rounded-sm border border-emerald-200" title="RN Sano">RN</span>}
                        {hasClinicalCrib && <span className="text-[8px] bg-slate-100 text-slate-600 font-bold px-1 rounded-sm border border-slate-200" title="Cuna Clínica">+CC</span>}
                    </div>
                )}
            </div>

            {/* FLOATING CONFIG MENU (Top Right) */}
            {!isBlocked && !readOnly && (
                <div className="absolute top-0 right-0 p-0.5 z-20" ref={menuRef}>
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className={clsx(
                            "p-0.5 rounded shadow-sm border transition-all duration-200",
                            isMenuOpen
                                ? "bg-slate-800 border-slate-900 text-white"
                                : "opacity-0 group-hover/row:opacity-100 bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        )}
                        title="Configuración de cama"
                    >
                        <Plus size={8} strokeWidth={4} />
                    </button>

                    {/* Dropdown content */}
                    {isMenuOpen && (
                        <div className={clsx(
                            "absolute left-0 w-56 bg-white rounded-lg shadow-2xl border border-slate-200 overflow-hidden animate-scale-in",
                            align === 'top' ? "top-full mt-1" : "bottom-full mb-1"
                        )}>
                            <div className="p-1.5 flex flex-col gap-1">
                                <div className="px-2 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 mb-0.5 flex justify-between items-center">
                                    <span>Opciones</span>
                                    <span>⚙️</span>
                                </div>

                                {/* Mode Toggle - DYNAMIC TEXT AS REQUESTED */}
                                <button
                                    onClick={() => onToggleMode()}
                                    className={clsx(
                                        "text-[10px] font-bold uppercase tracking-tight px-2 py-2.5 rounded-md flex items-center justify-between transition-all w-full group/item",
                                        isCunaMode
                                            ? "bg-pink-50 text-pink-700 hover:bg-pink-100"
                                            : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">{isCunaMode ? "🛏️" : "👶"}</span>
                                        <span className="text-left leading-none">
                                            {isCunaMode ? "Cambiar a Cama" : "Cambiar a Cuna Clínica"}
                                        </span>
                                    </div>
                                    <div className={clsx("w-1.5 h-1.5 rounded-full transition-all", isCunaMode ? "bg-pink-500 scale-125 shadow-[0_0_8px_rgba(236,72,153,0.5)]" : "bg-slate-300")} />
                                </button>

                                {/* Companion Toggle */}
                                <button
                                    onClick={onToggleCompanion}
                                    className={clsx(
                                        "text-[10px] font-bold uppercase tracking-tight px-2 py-2.5 rounded-md flex items-center justify-between transition-all w-full group/item",
                                        hasCompanion
                                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                            : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">🤱</span>
                                        <span>RN Sano</span>
                                    </div>
                                    <div className={clsx("w-1.5 h-1.5 rounded-full transition-all", hasCompanion ? "bg-emerald-500 scale-125 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-300")} />
                                </button>

                                {/* Clinical Crib Toggle */}
                                {!isCunaMode && (
                                    <button
                                        onClick={onToggleClinicalCrib}
                                        className={clsx(
                                            "text-[10px] font-bold uppercase tracking-tight px-2 py-2.5 rounded-md flex items-center justify-between transition-all w-full group/item",
                                            hasClinicalCrib
                                                ? "bg-purple-50 text-purple-700 hover:bg-purple-100"
                                                : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">➕</span>
                                            <span>Agregar Cuna Clínica</span>
                                        </div>
                                        <div className={clsx("w-1.5 h-1.5 rounded-full transition-all", hasClinicalCrib ? "bg-purple-500 scale-125 shadow-[0_0_8px_rgba(168,85,247,0.5)]" : "bg-slate-300")} />
                                    </button>
                                )}

                                {/* Clinical Crib Actions */}
                                {hasClinicalCrib && (
                                    <div className="flex gap-1 mt-1 border-t border-slate-100 pt-1.5 px-0.5">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onShowCribDemographics();
                                            }}
                                            className="flex-1 bg-purple-50 hover:bg-purple-100 text-purple-600 py-2 rounded-md transition-all flex items-center justify-center gap-1.5 border border-purple-100"
                                            title="Editar Cuna"
                                        >
                                            <span className="text-xs">📝</span>
                                            <span className="text-[9px] font-black uppercase tracking-tighter">DATOS</span>
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onUpdateClinicalCrib('remove');
                                            }}
                                            className="flex-shrink-0 bg-red-50 hover:bg-red-100 text-red-500 p-2 rounded-md transition-all border border-red-100"
                                            title="Eliminar Cuna"
                                        >
                                            <span className="text-xs">🗑️</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Extra beds allow editing location */}
            {bed.isExtra && (
                <input
                    type="text"
                    placeholder="Ubicación"
                    className="w-full text-[10px] p-1 mt-1.5 border border-amber-200 rounded text-center bg-amber-50/50 text-amber-900 placeholder:text-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 focus:outline-none transition-all duration-200"
                    value={data.location || ''}
                    onChange={onTextChange('location')}
                    disabled={readOnly}
                />
            )}
        </td>
    );
};

