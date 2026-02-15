import React from 'react';
import { Baby, LogOut, User, Users } from 'lucide-react';
import { getTimeRoundedToStep } from '@/utils';
import { BaseModal } from '@/components/shared/BaseModal';
import {
    DISCHARGE_TYPES,
    DISCHARGE_TYPE_OTHER,
    DEFAULT_DISCHARGE_TYPE,
    DischargeStatus,
    DischargeType
} from '@/constants';
import { validateDischargeExecutionInput } from '@/features/census/validation/censusActionValidation';
import clsx from 'clsx';

export type DischargeTarget = 'mother' | 'baby' | 'both';
export type DischargeTypeUnion = DischargeType;

export interface DischargeModalProps {
    isOpen: boolean;
    isEditing: boolean;
    status: DischargeStatus;

    // Props for Mother + Baby selection
    hasClinicalCrib?: boolean;
    clinicalCribName?: string;
    clinicalCribStatus?: DischargeStatus;
    onClinicalCribStatusChange?: (s: DischargeStatus) => void;

    // Discharge target (when clinical crib present)
    dischargeTarget?: DischargeTarget;
    onDischargeTargetChange?: (target: DischargeTarget) => void;

    // Initial Data for Editing
    initialType?: string;
    initialOtherDetails?: string;
    initialTime?: string;

    onStatusChange: (s: DischargeStatus) => void;
    onClose: () => void;
    onConfirm: (data: {
        status: DischargeStatus,
        type?: string,
        typeOther?: string,
        time: string,
        dischargeTarget?: DischargeTarget
    }) => void;
}

export const DischargeModal: React.FC<DischargeModalProps> = ({
    isOpen, isEditing, status, onStatusChange, onClose, onConfirm,
    hasClinicalCrib, clinicalCribName, clinicalCribStatus, onClinicalCribStatusChange,
    dischargeTarget = 'both', onDischargeTargetChange,
    initialType, initialOtherDetails, initialTime
}) => {
    const [dischargeType, setDischargeType] = React.useState<DischargeTypeUnion>((initialType as DischargeTypeUnion) || DEFAULT_DISCHARGE_TYPE);
    const [otherDetails, setOtherDetails] = React.useState(initialOtherDetails || '');
    const [dischargeTime, setDischargeTime] = React.useState('');
    const [errors, setErrors] = React.useState<{ time?: string, other?: string }>({});
    const [localTarget, setLocalTarget] = React.useState<DischargeTarget>(dischargeTarget);

    // Reset state when modal opens or initial props change
    React.useEffect(() => {
        if (isOpen) {
            setDischargeType((initialType as DischargeTypeUnion) || DEFAULT_DISCHARGE_TYPE);
            setOtherDetails(initialOtherDetails || '');
            const nowTime = getTimeRoundedToStep();
            setDischargeTime(initialTime || nowTime);
            setLocalTarget(dischargeTarget);
        }
    }, [isOpen, initialType, initialOtherDetails, initialTime, dischargeTarget]);

    const handleTargetChange = (target: DischargeTarget) => {
        setLocalTarget(target);
        onDischargeTargetChange?.(target);
    };

    const handleConfirm = () => {
        const newErrors: { time?: string, other?: string } = {};
        const validationErrors = validateDischargeExecutionInput({
            status,
            type: status === 'Vivo' ? dischargeType : undefined,
            typeOther: otherDetails,
            time: dischargeTime
        });
        validationErrors.forEach(validationError => {
            if (validationError.field === 'time') {
                newErrors.time = validationError.message;
            }
            if (validationError.field === 'typeOther') {
                newErrors.other = validationError.message;
            }
        });

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        onConfirm({
            status,
            type: status === 'Vivo' ? dischargeType : undefined,
            typeOther: (status === 'Vivo' && dischargeType === DISCHARGE_TYPE_OTHER) ? otherDetails : undefined,
            time: dischargeTime,
            dischargeTarget: hasClinicalCrib ? localTarget : undefined
        });
    };

    // Determine which status sections to show based on target
    const showMotherStatus = localTarget === 'mother' || localTarget === 'both';
    const showBabyStatus = (localTarget === 'baby' || localTarget === 'both') && hasClinicalCrib;

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={isEditing ? 'Editar Alta Médica' : 'Confirmar Alta Médica'}
            icon={<LogOut size={16} />}
            size="md"
            headerIconColor="text-emerald-600"
            variant="white"
        >
            <div className="space-y-5">
                {/* Target Selection - Only when clinical crib is present and not editing */}
                {!isEditing && hasClinicalCrib && onDischargeTargetChange && (
                    <div className="space-y-2">
                        <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                            ¿A quién dar de alta?
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                type="button"
                                onClick={() => handleTargetChange('mother')}
                                className={clsx(
                                    "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all",
                                    localTarget === 'mother'
                                        ? "border-pink-400 bg-pink-50 text-pink-700"
                                        : "border-slate-200 hover:border-slate-300 text-slate-500"
                                )}
                            >
                                <User size={20} />
                                <span className="text-[10px] font-bold">Solo Madre</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleTargetChange('baby')}
                                className={clsx(
                                    "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all",
                                    localTarget === 'baby'
                                        ? "border-purple-400 bg-purple-50 text-purple-700"
                                        : "border-slate-200 hover:border-slate-300 text-slate-500"
                                )}
                            >
                                <Baby size={20} />
                                <span className="text-[10px] font-bold">Solo RN</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleTargetChange('both')}
                                className={clsx(
                                    "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all",
                                    localTarget === 'both'
                                        ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                        : "border-slate-200 hover:border-slate-300 text-slate-500"
                                )}
                            >
                                <Users size={20} />
                                <span className="text-[10px] font-bold">Ambos</span>
                            </button>
                        </div>
                        {localTarget === 'mother' && (
                            <p className="text-[10px] text-pink-600 bg-pink-50 px-2 py-1 rounded-lg">
                                El RN pasará a ser el paciente principal de esta cama.
                            </p>
                        )}
                        {localTarget === 'baby' && (
                            <p className="text-[10px] text-purple-600 bg-purple-50 px-2 py-1 rounded-lg">
                                La madre permanecerá en la cama. La cuna clínica se eliminará.
                            </p>
                        )}
                    </div>
                )}

                {/* Main Patient Section */}
                {showMotherStatus && (
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                Estado {localTarget === 'both' ? 'Madre / Paciente' : 'Paciente'}
                            </label>
                            <div className="flex gap-6 pl-1">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio" name="status" value="Vivo"
                                        checked={status === 'Vivo'}
                                        onChange={() => onStatusChange('Vivo')}
                                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500/20"
                                    />
                                    <span className={clsx("text-sm transition-colors", status === 'Vivo' ? "font-bold text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>Vivo</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio" name="status" value="Fallecido"
                                        checked={status === 'Fallecido'}
                                        onChange={() => onStatusChange('Fallecido')}
                                        className="w-4 h-4 text-red-600 focus:ring-red-500/20"
                                    />
                                    <span className={clsx("text-sm transition-colors", status === 'Fallecido' ? "font-bold text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>Fallecido</span>
                                </label>
                            </div>
                        </div>

                        {/* Discharge Sub-Types (Only if Alive) */}
                        {status === 'Vivo' && (
                            <div className="space-y-2.5 pt-2 border-l-2 border-emerald-50 pl-4 animate-fade-in">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Tipo de Alta</label>
                                <div className="space-y-2">
                                    {DISCHARGE_TYPES.map((item) => (
                                        <label key={item} className="flex items-center gap-2 cursor-pointer group">
                                            <input
                                                type="radio"
                                                name="dischargeType"
                                                checked={dischargeType === item}
                                                onChange={() => setDischargeType(item)}
                                                className="w-4 h-4 text-emerald-600 focus:ring-emerald-500/20"
                                            />
                                            <span className={clsx("text-sm transition-colors", dischargeType === item ? "font-medium text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>
                                                {item === 'Domicilio (Habitual)' ? 'Alta a domicilio (Habitual)' : item}
                                            </span>
                                        </label>
                                    ))}
                                </div>

                                {dischargeType === DISCHARGE_TYPE_OTHER && (
                                    <div className="pt-1 animate-fade-in">
                                        <input
                                            type="text"
                                            placeholder="Especifique motivo..."
                                            value={otherDetails}
                                            onChange={(e) => { setOtherDetails(e.target.value); setErrors(prev => ({ ...prev, other: undefined })); }}
                                            className={clsx(
                                                "w-full text-sm p-2 bg-slate-50 border rounded-lg focus:ring-2 focus:outline-none transition-all",
                                                errors.other ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500"
                                            )}
                                            autoFocus
                                        />
                                        {errors.other && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{errors.other}</p>}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Discharge Time */}
                        <div className="space-y-1.5 pt-2">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Hora de Alta</label>
                            <div className="max-w-[120px]">
                                <input
                                    type="time"
                                    className={clsx(
                                        "w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all",
                                        errors.time ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500"
                                    )}
                                    step={300}
                                    value={dischargeTime}
                                    onChange={(e) => { setDischargeTime(e.target.value); setErrors(prev => ({ ...prev, time: undefined })); }}
                                />
                            </div>
                            {errors.time && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{errors.time}</p>}
                        </div>
                    </div>
                )}

                {/* Baby-only status selection */}
                {localTarget === 'baby' && !showMotherStatus && hasClinicalCrib && onClinicalCribStatusChange && (
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                Estado RN ({clinicalCribName || 'Recién Nacido'})
                            </label>
                            <div className="flex gap-6 pl-1">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio" name="cribStatus" value="Vivo"
                                        checked={clinicalCribStatus === 'Vivo'}
                                        onChange={() => onClinicalCribStatusChange('Vivo')}
                                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500/20"
                                    />
                                    <span className={clsx("text-sm transition-colors", clinicalCribStatus === 'Vivo' ? "font-bold text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>Vivo</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio" name="cribStatus" value="Fallecido"
                                        checked={clinicalCribStatus === 'Fallecido'}
                                        onChange={() => onClinicalCribStatusChange('Fallecido')}
                                        className="w-4 h-4 text-red-600 focus:ring-red-500/20"
                                    />
                                    <span className={clsx("text-sm transition-colors", clinicalCribStatus === 'Fallecido' ? "font-bold text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>Fallecido</span>
                                </label>
                            </div>
                        </div>

                        {/* Discharge Time for baby-only */}
                        <div className="space-y-1.5 pt-2">
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Hora de Alta</label>
                            <div className="max-w-[120px]">
                                <input
                                    type="time"
                                    className={clsx(
                                        "w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all",
                                        errors.time ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500"
                                    )}
                                    step={300}
                                    value={dischargeTime}
                                    onChange={(e) => { setDischargeTime(e.target.value); setErrors(prev => ({ ...prev, time: undefined })); }}
                                />
                            </div>
                            {errors.time && <p className="text-[9px] text-red-500 font-medium mt-1 pl-1">{errors.time}</p>}
                        </div>
                    </div>
                )}

                {/* Clinical Crib Patient (Baby) - Only when discharging both */}
                {!isEditing && showBabyStatus && localTarget === 'both' && onClinicalCribStatusChange && (
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                        <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                            Estado Recién Nacido ({clinicalCribName || 'RN'})
                        </label>
                        <div className="flex gap-6 pl-1">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="radio" name="cribStatus" value="Vivo"
                                    checked={clinicalCribStatus === 'Vivo'}
                                    onChange={() => onClinicalCribStatusChange('Vivo')}
                                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500/20"
                                />
                                <span className={clsx("text-sm transition-colors", clinicalCribStatus === 'Vivo' ? "font-bold text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>Vivo</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="radio" name="cribStatus" value="Fallecido"
                                    checked={clinicalCribStatus === 'Fallecido'}
                                    onChange={() => onClinicalCribStatusChange('Fallecido')}
                                    className="w-4 h-4 text-red-600 focus:ring-red-500/20"
                                />
                                <span className={clsx("text-sm transition-colors", clinicalCribStatus === 'Fallecido' ? "font-bold text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>Fallecido</span>
                            </label>
                        </div>
                    </div>
                )}

                {/* Footer Actions */}
                <div className="pt-6 flex justify-end items-center gap-4">
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 text-sm font-semibold transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-md shadow-emerald-600/10 hover:bg-emerald-700 transition-all transform active:scale-95"
                    >
                        {isEditing ? 'Guardar Cambios' : 'Confirmar Alta'}
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
