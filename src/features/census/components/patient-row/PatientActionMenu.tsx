import React, { useMemo, useState } from 'react';
import { MoreHorizontal, User, History, FileText } from 'lucide-react';
import clsx from 'clsx';
import { MedicalButton } from '@/components/ui/base/MedicalButton';
import {
    CLINICAL_ACTIONS,
    getVisibleUtilityActions,
    PatientRowAction
} from '@/features/census/components/patient-row/patientActionMenuConfig';
import type { PatientActionMenuCallbacks, RowMenuAlign } from './patientRowContracts';

interface PatientActionMenuProps extends PatientActionMenuCallbacks {
    isBlocked: boolean;
    readOnly?: boolean;
    align?: RowMenuAlign;
}

export const PatientActionMenu: React.FC<PatientActionMenuProps> = ({
    isBlocked,
    onAction,
    onViewDemographics,
    onViewExamRequest,
    onViewHistory,
    readOnly = false,
    align = 'top'
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const utilityActions = useMemo(() => getVisibleUtilityActions(isBlocked), [isBlocked]);

    const toggleMenu = () => setShowMenu(!showMenu);

    const handleMenuAction = (action: PatientRowAction) => {
        onAction(action);
        setShowMenu(false);
    };

    return (
        <div className="flex flex-col items-center gap-1 relative">
            {!isBlocked && !readOnly && (
                <div className="flex items-center gap-0.5">
                    <MedicalButton
                        onClick={onViewDemographics}
                        variant="ghost"
                        size="xs"
                        className="text-medical-500 hover:text-medical-700"
                        title="Datos del Paciente"
                        icon={<User size={14} />}
                    />
                </div>
            )}
            {!readOnly && (
                <MedicalButton
                    onClick={toggleMenu}
                    variant="secondary"
                    size="xs"
                    className="p-1 rounded-full text-slate-500"
                    title="Acciones"
                    icon={<MoreHorizontal size={14} />}
                />
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
                        <div className="grid grid-cols-3 gap-1 p-2 bg-slate-50 border-b border-slate-100">
                            {utilityActions.map(({ action, icon: Icon, label, title, iconClassName }) => (
                                <button
                                    key={action}
                                    onClick={() => handleMenuAction(action)}
                                    className={`flex flex-col items-center justify-center p-2 rounded hover:bg-white hover:shadow-sm text-slate-500 transition-all group ${iconClassName}`}
                                    title={title}
                                >
                                    <Icon size={18} className="mb-1 group-hover:scale-110 transition-transform" />
                                    <span className="text-[10px] font-medium">{label}</span>
                                </button>
                            ))}
                        </div>

                        {/* 3. Primary Clinical Actions */}
                        {!isBlocked && (
                            <div className="py-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-1 block">
                                    Gestión Clínica
                                </span>
                                {CLINICAL_ACTIONS.map(({ action, icon: Icon, label, iconClassName }) => (
                                    <button
                                        key={action}
                                        onClick={() => handleMenuAction(action)}
                                        className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-3 text-slate-700 group"
                                    >
                                        <Icon size={16} className={`${iconClassName} group-hover:translate-x-0.5 transition-transform`} />
                                        <span className="text-sm">{label}</span>
                                    </button>
                                ))}
                                {onViewExamRequest && (
                                    <>
                                        <div className="h-px bg-slate-100 mx-3 my-1"></div>
                                        <button
                                            onClick={() => {
                                                onViewExamRequest();
                                                setShowMenu(false);
                                            }}
                                            className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-3 text-slate-700 group"
                                        >
                                            <FileText size={16} className="text-slate-400 group-hover:text-medical-600 transition-colors" />
                                            <span className="text-sm">Solicitud Exámenes</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
