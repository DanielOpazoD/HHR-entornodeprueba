/**
 * PatientHistoryModal
 * 
 * Displays a timeline of all bed movements for a patient.
 * Shows admissions, internal moves, discharges, and transfers.
 */

import React, { useState, useEffect } from 'react';
import { Clock, Loader2, MapPin, LogOut, Ambulance, ArrowRight, Home } from 'lucide-react';
import clsx from 'clsx';
import { BaseModal } from '../shared/BaseModal';
import { getPatientMovementHistory, PatientHistoryResult, MovementType } from '../../services/patient/patientHistoryService';

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
            icon={<Clock size={20} />}
            size="lg"
            variant="white"
            headerIconColor="text-blue-600"
        >
            <div className="space-y-6">
                {/* Patient Info Header */}
                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold shrink-0">
                        {patientName ? patientName.charAt(0) : 'P'}
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800">{patientName || history?.patientName || 'Paciente'}</h4>
                        <p className="text-xs text-slate-500 font-mono">{patientRut}</p>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <Loader2 size={32} className="animate-spin mb-3 text-blue-500" />
                        <span className="text-sm font-medium">Buscando historial clínico...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400 bg-slate-50 rounded-xl border border-slate-100 border-dashed">
                        <Clock size={32} className="mb-3 opacity-50" />
                        <span className="text-sm">{error}</span>
                    </div>
                ) : history ? (
                    <>
                        {/* Summary Stats */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                                <span className="text-xs text-blue-600 uppercase font-bold tracking-wider block mb-1">Días Totales</span>
                                <span className="text-2xl font-bold text-slate-700">{history.totalDays}</span>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider block mb-1">Período</span>
                                <span className="text-sm font-medium text-slate-700 block mt-1">
                                    {formatDate(history.firstSeen)}
                                    <br />
                                    <span className="text-slate-400 text-xs">hasta</span> {formatDate(history.lastSeen)}
                                </span>
                            </div>
                        </div>

                        {/* Timeline */}
                        <div className="relative pl-2 pt-2">
                            {/* Vertical line connection */}
                            <div className="absolute left-[27px] top-6 bottom-6 w-0.5 bg-slate-200" />

                            <div className="space-y-6 relative">
                                {history.movements.map((movement, index) => {
                                    const config = movementConfig[movement.type] || movementConfig.stay;
                                    return (
                                        <div key={index} className="flex items-start gap-4 relaltive group">
                                            {/* Icon Marker */}
                                            <div className={clsx(
                                                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 z-10 shadow-sm border transaction-all group-hover:scale-110",
                                                config.bgColor,
                                                config.color,
                                                "border-white ring-4 ring-white"
                                            )}>
                                                {config.icon}
                                            </div>

                                            {/* Content Card */}
                                            <div className="flex-1 bg-white border border-slate-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className={clsx("text-[10px] font-black uppercase tracking-widest py-0.5 px-2 rounded-full", config.bgColor, config.color)}>
                                                        {config.label}
                                                    </span>
                                                    {movement.time && (
                                                        <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                                                            <Clock size={10} />
                                                            {movement.time}
                                                        </span>
                                                    )}
                                                </div>

                                                <h5 className="font-bold text-slate-800 text-sm mb-0.5">
                                                    {movement.bedName}
                                                    <span className="ml-2 text-xs font-normal text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                        {movement.bedType}
                                                    </span>
                                                </h5>

                                                <div className="text-xs text-slate-500 mb-2">
                                                    {formatDate(movement.date)}
                                                </div>

                                                {movement.details && (
                                                    <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 italic">
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
