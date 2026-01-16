import React, { useState } from 'react';
import { MoreHorizontal, Trash2, Copy, ArrowRightLeft, LogOut, Ambulance, User, FileText } from 'lucide-react';
import clsx from 'clsx';

interface PatientActionMenuProps {
    isBlocked: boolean;
    onAction: (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer') => void;
    onViewDemographics: () => void;
    onViewExamRequest?: () => void;
    readOnly?: boolean;
    align?: 'top' | 'bottom';
    hasPatient?: boolean;
}

export const PatientActionMenu: React.FC<PatientActionMenuProps> = ({
    isBlocked,
    onAction,
    onViewDemographics,
    onViewExamRequest,
    readOnly = false,
    align = 'top',
    hasPatient = false
}) => {
    const [showMenu, setShowMenu] = useState(false);

    const toggleMenu = () => setShowMenu(!showMenu);

    const handleMenuAction = (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer') => {
        onAction(action);
        setShowMenu(false);
    };

    return (
        <div className="flex flex-col items-center gap-1 relative">
            {!isBlocked && (
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
                        "absolute left-10 z-50 bg-white shadow-lg rounded-2xl border border-slate-200 w-48 text-left py-2 animate-fade-in print:hidden",
                        align === 'top' ? "top-0" : "bottom-0"
                    )}>
                        <button onClick={() => handleMenuAction('clear')} className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2">
                            <Trash2 size={14} /> Limpiar Datos
                        </button>
                        {!isBlocked && (
                            <>
                                <div className="h-px bg-slate-100 my-1"></div>
                                <button onClick={() => handleMenuAction('copy')} className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                    <Copy size={14} /> Copiar a...
                                </button>
                                <button onClick={() => handleMenuAction('move')} className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700">
                                    <ArrowRightLeft size={14} /> Mover a...
                                </button>
                                <div className="h-px bg-slate-100 my-1"></div>
                                <button onClick={() => handleMenuAction('discharge')} className="w-full text-left px-4 py-2 hover:bg-green-50 flex items-center gap-2 text-green-700 font-medium">
                                    <LogOut size={14} /> Dar de Alta
                                </button>
                                <button onClick={() => handleMenuAction('transfer')} className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-center gap-2 text-blue-700 font-medium">
                                    <Ambulance size={14} /> Trasladar
                                </button>
                                {onViewExamRequest && (
                                    <>
                                        <div className="h-px bg-slate-100 my-1"></div>
                                        <button
                                            onClick={() => {
                                                onViewExamRequest();
                                                setShowMenu(false);
                                            }}
                                            className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium"
                                        >
                                            <FileText size={14} className="text-medical-500" /> Solicitud de Exámenes
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
