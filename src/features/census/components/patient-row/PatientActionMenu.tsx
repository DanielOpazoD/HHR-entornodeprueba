import React, { useState } from 'react';
import { MoreHorizontal, Trash2, Copy, ArrowRightLeft, LogOut, Ambulance, User, History, Scissors } from 'lucide-react';
import clsx from 'clsx';

interface PatientActionMenuProps {
    isBlocked: boolean;
    onAction: (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer' | 'cma') => void;
    onViewDemographics: () => void;
    onViewHistory?: () => void;
    readOnly?: boolean;
    align?: 'top' | 'bottom';
}

export const PatientActionMenu: React.FC<PatientActionMenuProps> = ({
    isBlocked,
    onAction,
    onViewDemographics,
    onViewHistory,
    readOnly = false,
    align = 'top'
}) => {
    const [showMenu, setShowMenu] = useState(false);

    const toggleMenu = () => setShowMenu(!showMenu);

    const handleMenuAction = (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer' | 'cma') => {
        onAction(action);
        setShowMenu(false);
    };

    return (
        <div className="flex flex-col items-center gap-1 relative">
            {!isBlocked && !readOnly && (
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={onViewDemographics}
                        className="p-1 rounded-full text-medical-500 hover:text-medical-700 hover:bg-medical-50 transition-colors"
                        title="Datos del Paciente"
                    >
                        <User size={16} />
                    </button>
                </div>
            )}
            {!readOnly && (
                <button
                    onClick={toggleMenu}
                    className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
                    title="Acciones"
                >
                    <MoreHorizontal size={16} />
                </button>
            )}

            {showMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)}></div>
                    <div className={clsx(
                        "absolute left-10 z-50 bg-white shadow-xl rounded-xl border border-slate-200 w-64 text-left overflow-hidden animate-fade-in print:hidden",
                        align === 'top' ? "top-0" : "bottom-0"
                    )}>
                        {/* 1. History (if available) - Top Prominence */}
                        {onViewHistory && (
                            <button
                                onClick={() => {
                                    onViewHistory();
                                    setShowMenu(false);
                                }}
                                className="w-full text-left px-4 py-2.5 hover:bg-purple-50 flex items-center gap-3 text-slate-700 border-b border-slate-100"
                            >
                                <div className="p-1 bg-purple-100 rounded text-purple-600">
                                    <History size={14} />
                                </div>
                                <span className="font-medium text-sm">Ver Historial</span>
                            </button>
                        )}

                        {/* 2. Utility Grid (Clean, Copy, Move) */}
                        <div className="grid grid-cols-2 gap-1 p-2 bg-slate-50 border-b border-slate-100">
                            <button
                                onClick={() => handleMenuAction('clear')}
                                className="flex flex-col items-center justify-center p-2 rounded hover:bg-white hover:shadow-sm hover:text-red-600 text-slate-500 transition-all group"
                                title="Borrar datos"
                            >
                                <Trash2 size={18} className="mb-1 group-hover:scale-110 transition-transform" />
                                <span className="text-[10px] font-medium">Limpiar</span>
                            </button>

                            {!isBlocked && (
                                <>
                                    <button
                                        onClick={() => handleMenuAction('copy')}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-white hover:shadow-sm hover:text-blue-600 text-slate-500 transition-all group"
                                        title="Copiar a otro día"
                                    >
                                        <Copy size={18} className="mb-1 group-hover:scale-110 transition-transform" />
                                        <span className="text-[10px] font-medium">Copiar</span>
                                    </button>

                                    <button
                                        onClick={() => handleMenuAction('move')}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-white hover:shadow-sm hover:text-amber-600 text-slate-500 transition-all group"
                                        title="Mover de cama"
                                    >
                                        <ArrowRightLeft size={18} className="mb-1 group-hover:scale-110 transition-transform" />
                                        <span className="text-[10px] font-medium">Mover</span>
                                    </button>
                                </>
                            )}
                        </div>

                        {/* 3. Primary Clinical Actions */}
                        {!isBlocked && (
                            <div className="py-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 block">
                                    Gestión Clínica
                                </span>
                                <button onClick={() => handleMenuAction('discharge')} className="w-full text-left px-4 py-2 hover:bg-green-50 flex items-center gap-3 text-slate-700 group">
                                    <LogOut size={16} className="text-green-600 group-hover:translate-x-0.5 transition-transform" />
                                    <span className="text-sm">Dar de Alta</span>
                                </button>
                                <button onClick={() => handleMenuAction('transfer')} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-3 text-slate-700 group">
                                    <Ambulance size={16} className="text-blue-600 group-hover:translate-x-0.5 transition-transform" />
                                    <span className="text-sm">Trasladar</span>
                                </button>
                                <button onClick={() => handleMenuAction('cma')} className="w-full text-left px-4 py-2 hover:bg-orange-50 flex items-center gap-3 text-slate-700 group">
                                    <Scissors size={16} className="text-orange-600 group-hover:translate-x-0.5 transition-transform" />
                                    <span className="text-sm">Egreso CMA</span>
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
