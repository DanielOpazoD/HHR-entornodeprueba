import React, { useState } from 'react';
import { Baby, Share2 } from 'lucide-react';
import {
    EVACUATION_METHODS,
    EVACUATION_METHOD_COMMERCIAL,
    EVACUATION_METHOD_OTHER,
    RECEIVING_CENTERS,
    RECEIVING_CENTER_EXTRASYSTEM,
    RECEIVING_CENTER_OTHER,
    TRANSFER_ESCORT_OPTIONS,
    DEFAULT_TRANSFER_ESCORT,
    isTransferEscortOption,
    EvacuationMethod,
    ReceivingCenter
} from '@/constants';
import { getTimeRoundedToStep } from '@/utils';
import { BaseModal } from '@/components/shared/BaseModal';
import { validateTransferExecutionInput } from '@/features/census/validation/censusActionValidation';
import clsx from 'clsx';

export type TransferUpdateField =
    | 'evacuationMethod'
    | 'evacuationMethodOther'
    | 'receivingCenter'
    | 'receivingCenterOther'
    | 'transferEscort';

export interface TransferModalProps {
    isOpen: boolean;
    isEditing: boolean;
    evacuationMethod: EvacuationMethod;
    evacuationMethodOther: string;
    receivingCenter: ReceivingCenter;
    receivingCenterOther: string;
    transferEscort: string;
    initialTime?: string;

    // New props for Mother + Baby
    hasClinicalCrib?: boolean;
    clinicalCribName?: string;

    onUpdate: (field: TransferUpdateField, value: string) => void;
    onClose: () => void;
    onConfirm: (data: { time: string }) => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
    isOpen, isEditing, evacuationMethod, evacuationMethodOther, receivingCenter, receivingCenterOther, transferEscort, onUpdate, onClose, onConfirm,
    hasClinicalCrib, clinicalCribName, initialTime
}) => {
    const [transferTime, setTransferTime] = useState('');
    const [errors, setErrors] = useState<{ time?: string, otherCenter?: string, otherEvacuation?: string }>({});

    React.useEffect(() => {
        if (isOpen) {
            const nowTime = getTimeRoundedToStep();
            setTransferTime(initialTime || nowTime);
        }
    }, [isOpen, initialTime]);

    const handleEscortChange = (val: string) => {
        if (val === 'Otro') {
            onUpdate('transferEscort', '');
        } else {
            onUpdate('transferEscort', val);
        }
    };

    const handleEvacuationChange = (val: string) => {
        onUpdate('evacuationMethod', val);
        if (val === EVACUATION_METHOD_COMMERCIAL) {
            onUpdate('transferEscort', DEFAULT_TRANSFER_ESCORT);
        }
        if (val !== EVACUATION_METHOD_OTHER) {
            onUpdate('evacuationMethodOther', '');
        }
    };

    const isPredefined = isTransferEscortOption(transferEscort);

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Editar Traslado' : 'Confirmar Traslado'}
            icon={<Share2 size={16} />}
            size="md"
            headerIconColor="text-blue-600"
            variant="white"
        >
            <div className="space-y-5">
                {/* Baby Notice - Minimalist */}
                {!isEditing && hasClinicalCrib && (
                    <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex items-start gap-2 animate-fade-in mb-2">
                        <Baby className="text-blue-500 mt-0.5 shrink-0" size={14} />
                        <div className="space-y-0.5">
                            <p className="text-[9px] font-bold text-blue-900 uppercase tracking-tight">Cuna Clínica Detectada</p>
                            <p className="text-[10px] text-blue-800/80 leading-tight">
                                Se generará un traslado adicional para {clinicalCribName || 'RN'}.
                            </p>
                        </div>
                    </div>
                )}

                {/* Section: Evacuation Details - Minimalist */}
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Medio de Evacuación</label>
                            <select
                                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                                value={evacuationMethod}
                                onChange={(e) => handleEvacuationChange(e.target.value)}
                            >
                                {EVACUATION_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>

                        {evacuationMethod === EVACUATION_METHOD_OTHER && (
                            <div className="animate-fade-in space-y-1.5 border-l-2 border-blue-50 pl-4">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Especifique Método</label>
                                <input
                                    type="text"
                                    className={clsx(
                                        "w-full p-2 bg-white border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all",
                                        errors.otherEvacuation ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                    )}
                                    value={evacuationMethodOther}
                                    onChange={(e) => { onUpdate('evacuationMethodOther', e.target.value); setErrors(prev => ({ ...prev, otherEvacuation: undefined })); }}
                                    placeholder="Nombre del método..."
                                    autoFocus
                                />
                                {errors.otherEvacuation && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{errors.otherEvacuation}</p>}
                            </div>
                        )}

                        {evacuationMethod === EVACUATION_METHOD_COMMERCIAL && (
                            <div className="space-y-1.5 pt-1 animate-fade-in border-l-2 border-blue-50 pl-4">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Acompañante Vuelo Comercial</label>
                                <div className="space-y-2">
                                    <select
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all cursor-pointer"
                                        value={isPredefined ? transferEscort : 'Otro'}
                                        onChange={(e) => handleEscortChange(e.target.value)}
                                    >
                                        {TRANSFER_ESCORT_OPTIONS.map(escort => (
                                            <option key={escort} value={escort}>{escort}</option>
                                        ))}
                                        <option value="Otro">Otro / Mixto</option>
                                    </select>
                                    {!isPredefined && (
                                        <input
                                            type="text"
                                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all shadow-sm h-9"
                                            placeholder="Especifique..."
                                            value={transferEscort}
                                            onChange={(e) => onUpdate('transferEscort', e.target.value)}
                                            autoFocus
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Centro que Recibe</label>
                            <select
                                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                                value={receivingCenter}
                                onChange={(e) => onUpdate('receivingCenter', e.target.value)}
                            >
                                {RECEIVING_CENTERS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>

                        {/* Conditional Rendering for Other Center */}
                        {(receivingCenter === RECEIVING_CENTER_OTHER || receivingCenter === RECEIVING_CENTER_EXTRASYSTEM) && (
                            <div className="animate-fade-in space-y-1.5 border-l-2 border-blue-50 pl-4">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Especifique Centro</label>
                                <input
                                    type="text"
                                    className={clsx(
                                        "w-full p-2 bg-white border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all",
                                        errors.otherCenter ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                    )}
                                    value={receivingCenterOther}
                                    onChange={(e) => { onUpdate('receivingCenterOther', e.target.value); setErrors(prev => ({ ...prev, otherCenter: undefined })); }}
                                    placeholder="Nombre del centro..."
                                    autoFocus
                                />
                                {errors.otherCenter && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{errors.otherCenter}</p>}
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Hora de Traslado</label>
                            <div className="max-w-[120px]">
                                <input
                                    type="time"
                                    className={clsx(
                                        "w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all",
                                        errors.time ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                    )}
                                    step={300}
                                    value={transferTime}
                                    onChange={(e) => { setTransferTime(e.target.value); setErrors(prev => ({ ...prev, time: undefined })); }}
                                />
                            </div>
                            {errors.time && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{errors.time}</p>}
                        </div>
                    </div>
                </div>

                {/* Footer Actions - Standard Clean Style */}
                <div className="pt-6 flex justify-end items-center gap-4">
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 text-sm font-semibold transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => {
                            const newErrors: Record<string, string | undefined> = {};
                            const validationErrors = validateTransferExecutionInput({
                                evacuationMethod,
                                evacuationMethodOther,
                                receivingCenter,
                                receivingCenterOther,
                                transferEscort,
                                time: transferTime
                            });
                            validationErrors.forEach(validationError => {
                                if (validationError.field === 'time') {
                                    newErrors.time = validationError.message;
                                }
                                if (validationError.field === 'receivingCenterOther') {
                                    newErrors.otherCenter = validationError.message;
                                }
                                if (validationError.field === 'evacuationMethodOther') {
                                    newErrors.otherEvacuation = validationError.message;
                                }
                            });

                            if (Object.keys(newErrors).length > 0) {
                                setErrors(newErrors);
                                return;
                            }

                            onConfirm({ time: transferTime });
                        }}
                        className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-md shadow-blue-600/10 hover:bg-blue-700 transition-all transform active:scale-95"
                    >
                        {isEditing ? 'Guardar Cambios' : 'Confirmar Traslado'}
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
