/**
 * PatientHistoryModal
 * 
 * Displays a timeline of all bed movements for a patient.
 * Shows admissions, internal moves, discharges, and transfers.
 */

import React, { useState, useEffect } from 'react';
import { Clock, Loader2, MapPin, LogOut, Ambulance, ArrowRight, Home } from 'lucide-react';
import clsx from 'clsx';
import { BaseModal } from '@/components/shared/BaseModal';
import { getPatientMovementHistory, PatientHistoryResult, MovementType } from '@/services/patient/patientHistoryService';

interface PatientHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    patientRut: string;
    patientName?: string;
}

// Movement type styling
const movementConfig: Record<MovementType, {
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    label: string
}> = {
    admission: {
        icon: <Home size={16} />,
        color: 'text-green-600',
        bgColor: 'bg-green-100',
        label: 'Ingreso'
    },
    stay: {
        icon: <MapPin size={16} />,
        color: 'text-slate-500',
        bgColor: 'bg-slate-100',
        label: 'Estadía'
    },
    internal_move: {
        icon: <ArrowRight size={16} />,
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        label: 'Movimiento interno'
    },
    discharge: {
        icon: <LogOut size={16} />,
        color: 'text-amber-600',
        bgColor: 'bg-amber-100',
        label: 'Alta'
    },
    transfer: {
        icon: <Ambulance size={16} />,
        color: 'text-purple-600',
        bgColor: 'bg-purple-100',
        label: 'Traslado'
    }
};

export const PatientHistoryModal: React.FC<PatientHistoryModalProps> = ({
    isOpen,
    onClose,
    patientRut,
    patientName
}) => {
    const [history, setHistory] = useState<PatientHistoryResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && patientRut) {
            const loadData = async () => {
                setIsLoading(true);
                setError(null);
                setHistory(null);

                try {
                    const result = await getPatientMovementHistory(patientRut);
                    if (result) {
                        setHistory(result);
                    } else {
                        setError('No se encontró historial para este paciente.');
                    }
                } catch (err) {
                    console.error('Error fetching patient history:', err);
                    setError('Error al cargar el historial.');
                } finally {
                    setIsLoading(false);
                }
            };

            loadData();
        }
    }, [isOpen, patientRut]);

    // Format helper
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T12:00:00');
        return date.toLocaleDateString('es-CL', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Historial de Movimientos"
            icon={<Clock size={16} />}
            size="md"
            variant="white"
            headerIconColor="text-blue-600"
        >
            <div className="space-y-4">
                {/* Patient Info Header - Compact */}
                <div className="flex items-center gap-2 p-3 bg-slate-50/80 rounded-lg border border-slate-100">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold shrink-0 text-sm">
                        {patientName ? patientName.charAt(0) : 'P'}
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800 text-sm leading-tight">{patientName || history?.patientName || 'Paciente'}</h4>
                        <p className="text-[10px] text-slate-500 font-mono leading-tight">{patientRut}</p>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                        <Loader2 size={24} className="animate-spin mb-2 text-blue-500" />
                        <span className="text-xs font-medium">Buscando historial clínico...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-slate-100 border-dashed">
                        <Clock size={24} className="mb-2 opacity-50" />
                        <span className="text-xs">{error}</span>
                    </div>
                ) : history ? (
                    <>
                        {/* Summary Stats - More compact grid */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-blue-50/30 rounded-lg border border-blue-100/50 flex items-center justify-between">
                                <span className="text-[10px] text-blue-600 uppercase font-black tracking-widest">Días Totales</span>
                                <span className="text-xl font-black text-slate-700">{history.totalDays}</span>
                            </div>
                            <div className="p-3 bg-slate-50/50 rounded-lg border border-slate-100 flex items-center justify-between">
                                <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Ingreso</span>
                                <div className="text-right">
                                    <span className="text-[10px] font-bold text-slate-600 block">
                                        {formatDate(history.firstSeen)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Timeline - Compact */}
                        <div className="relative pl-0.5">
                            {/* Vertical line connection */}
                            <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-slate-100" />

                            <div className="space-y-3 relative">
                                {history.movements.map((movement, index) => {
                                    const config = movementConfig[movement.type] || movementConfig.stay;
                                    return (
                                        <div key={index} className="flex items-start gap-3 relative group">
                                            {/* Icon Marker - Smaller */}
                                            <div className={clsx(
                                                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 z-10 shadow-sm border transition-all",
                                                config.bgColor,
                                                config.color,
                                                "border-white ring-2 ring-white"
                                            )}>
                                                {React.isValidElement(config.icon)
                                                    ? React.cloneElement(config.icon as React.ReactElement<{ size?: number }>, { size: 14 })
                                                    : config.icon}
                                            </div>

                                            {/* Content Card - Minimalist */}
                                            <div className="flex-1 bg-white border border-slate-100 rounded-lg p-3 shadow-none hover:border-slate-200 transition-colors">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className={clsx("text-[9px] font-black uppercase tracking-widest py-0.5 px-2 rounded-md", config.bgColor, config.color)}>
                                                        {config.label}
                                                    </span>
                                                    {movement.time && (
                                                        <span className="text-[9px] text-slate-400 font-bold flex items-center gap-1">
                                                            <Clock size={8} />
                                                            {movement.time}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-baseline gap-2">
                                                    <h5 className="font-bold text-slate-800 text-xs">
                                                        {movement.bedName}
                                                    </h5>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase">
                                                        {movement.bedType}
                                                    </span>
                                                </div>

                                                <div className="text-[10px] text-slate-500 mb-1">
                                                    {formatDate(movement.date)}
                                                </div>

                                                {movement.details && (
                                                    <div className="mt-1.5 text-[10px] text-slate-500 bg-slate-50 p-1.5 rounded border border-slate-100 italic leading-snug">
                                                        &quot;{movement.details}&quot;
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </BaseModal>
    );
};
