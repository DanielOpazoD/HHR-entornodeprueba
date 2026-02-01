import React, { useState, useEffect } from 'react';
import { Copy, Move, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { BEDS } from '@/constants';
import { useDailyRecordContext } from '@/context/DailyRecordContext';
import { BaseModal } from '@/components/shared/BaseModal';
import { DailyRecordRepository } from '@/services/repositories/DailyRecordRepository';
import { DailyRecord } from '@/types';

export interface MoveCopyModalProps {
    isOpen: boolean;
    type: 'move' | 'copy' | null;
    sourceBedId: string | null;
    targetBedId: string | null;
    onClose: () => void;
    onSetTarget: (id: string) => void;
    onConfirm: (targetDate?: string) => void;
}

export const MoveCopyModal: React.FC<MoveCopyModalProps> = ({
    isOpen, type, sourceBedId, targetBedId, onClose, onSetTarget, onConfirm
}) => {
    const { record: currentRecord } = useDailyRecordContext();
    const [targetRecord, setTargetRecord] = useState<DailyRecord | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    // Initial State Setup
    useEffect(() => {
        if (isOpen && currentRecord) {
            setSelectedDate(currentRecord.date);
            setTargetRecord(currentRecord);
        }
    }, [isOpen, currentRecord]);

    // Fetch Target Record when Date Changes
    useEffect(() => {
        const fetchTarget = async () => {
            if (!selectedDate || selectedDate === currentRecord?.date) {
                setTargetRecord(currentRecord);
                return;
            }

            setIsLoading(true);
            try {
                const fetched = await DailyRecordRepository.getForDate(selectedDate);
                // If it doesn't exist (e.g. tomorrow), we simulate an empty record map based on BEDS
                // actually getForDate returns null if not found.
                // If null, it means empty day => all beds free
                setTargetRecord(fetched);
            } catch (error) {
                console.error('Failed to fetch target record', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTarget();
    }, [selectedDate, currentRecord]);

    if (!type || !currentRecord) return null;

    // Only show standard beds or active extra beds (using current config as baseline, or target?)
    // If copying to future, we assume same bed configuration for simplicity unless we fetch that day's config.
    // Let's use targetRecord's extras if available, else current.
    const activeExtras = targetRecord?.activeExtraBeds || currentRecord.activeExtraBeds || [];
    const visibleBeds = BEDS.filter(b => !b.isExtra || activeExtras.includes(b.id));
    const sourceBedName = BEDS.find(b => b.id === sourceBedId)?.name || '';

    // Date Options
    const dateOptions = [
        { label: 'Ayer', offset: -1, color: 'text-slate-600 bg-slate-50 border-slate-200' },
        { label: 'Hoy', offset: 0, color: 'text-blue-600 bg-blue-50 border-blue-100' },
        { label: 'Mañana', offset: 1, color: 'text-emerald-600 bg-emerald-50 border-emerald-100' }
    ];

    const handleDateSelect = (offset: number) => {
        const date = new Date(); // Today
        // Check if we are viewing a past record? Assuming "Hoy" means "Today relative to real time" 
        // OR "Same date as current view"? 
        // User request "ayer, hoy, mañana". 
        // Let's assume relative to REAL TIME for simplicity, or relative to View Date?
        // "La fecha del censo donde desea copiarse". 
        // Usually "Today" = Current System Date.
        date.setDate(date.getDate() + offset);
        const dateStr = date.toISOString().split('T')[0];
        setSelectedDate(dateStr);
        // Reset target bed since availability changes
        onSetTarget('');
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={type === 'move' ? 'Mover Paciente' : 'Copiar Paciente'}
            icon={type === 'move' ? <Move size={18} /> : <Copy size={18} />}
            size="lg"
            headerIconColor="text-medical-600"
            variant="white"
        >
            <div className="space-y-4">
                {/* Date Selection (Only for Copy) */}
                {type === 'copy' && (
                    <div className="space-y-1 pb-3 border-b border-slate-50">
                        <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2">
                            Fecha de Destino
                        </label>
                        <div className="flex gap-2">
                            {dateOptions.map((opt) => {
                                const d = new Date();
                                d.setDate(d.getDate() + opt.offset);
                                const dStr = d.toISOString().split('T')[0];
                                const isSelected = selectedDate === dStr;

                                return (
                                    <button
                                        key={opt.label}
                                        onClick={() => handleDateSelect(opt.offset)}
                                        className={clsx(
                                            "flex-1 py-2 px-3 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-2",
                                            isSelected
                                                ? "bg-medical-600 text-white border-medical-600 shadow-sm"
                                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                        )}
                                    >
                                        <Calendar size={14} className={isSelected ? "opacity-100" : "opacity-50"} />
                                        <span>{opt.label}</span>
                                        <span className={clsx("text-[10px]", isSelected ? "opacity-80" : "opacity-50")}>
                                            {d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="space-y-1">
                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                        Cama de Destino
                    </label>
                    <p className="text-[11px] text-slate-500 mb-2 ml-1">
                        Desde <span className="font-bold text-slate-700">{sourceBedName}</span> hacia:
                    </p>

                    <div className="grid grid-cols-3 gap-1.5 max-h-[50vh] overflow-y-auto pr-1">
                        {isLoading ? (
                            <div className="col-span-3 py-8 text-center text-slate-400 text-xs">
                                Verificando disponibilidad...
                            </div>
                        ) : visibleBeds.filter(b => b.id !== sourceBedId).map(bed => {
                            // Check occupancy in TARGET record (or null if future date not init)
                            // If targetRecord is null (e.g. tomorrow not created), bed is FREE.
                            const isOccupied = targetRecord?.beds?.[bed.id]?.patientName;
                            const isSelected = targetBedId === bed.id;

                            // Allow selection only if free? Or warn? Usually free only.
                            // If move, must be free. If copy, usually free to avoid overwrite.
                            const isDisabled = !!isOccupied;

                            return (
                                <button
                                    key={bed.id}
                                    onClick={() => !isDisabled && onSetTarget(bed.id)}
                                    disabled={isDisabled}
                                    className={clsx(
                                        "p-2 rounded-lg border text-left transition-all h-[52px] flex flex-col justify-between group",
                                        isSelected
                                            ? "bg-medical-50 border-medical-500 ring-1 ring-medical-500 shadow-sm"
                                            : isDisabled
                                                ? "bg-slate-50 border-slate-100 opacity-60 cursor-not-allowed"
                                                : "bg-slate-50 border-slate-200 hover:border-medical-300 hover:bg-white"
                                    )}
                                >
                                    <div className="flex justify-between items-center w-full">
                                        <p className={clsx("font-bold text-[11px] truncate", isSelected ? "text-medical-800" : "text-slate-700")}>
                                            {bed.name}
                                        </p>
                                        <div className={clsx(
                                            "w-1.5 h-1.5 rounded-full shrink-0",
                                            isOccupied ? "bg-amber-400" : "bg-emerald-400"
                                        )} />
                                    </div>
                                    <p className={clsx(
                                        "text-[8px] uppercase tracking-wider font-semibold",
                                        isSelected ? "text-medical-600" : "text-slate-400"
                                    )}>
                                        {isOccupied ? 'Ocupada' : 'Libre'}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="pt-4 flex justify-end items-center gap-3 border-t border-slate-50">
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 text-xs font-semibold transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        disabled={!targetBedId || isLoading}
                        onClick={() => onConfirm(selectedDate)}
                        className="px-5 py-2 bg-medical-600 text-white rounded-lg text-xs font-bold shadow-md shadow-medical-600/10 hover:bg-medical-700 transition-all transform active:scale-95 disabled:opacity-50 disabled:transform-none"
                    >
                        Confirmar {type === 'move' ? 'Traslado' : 'Copia'}
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
