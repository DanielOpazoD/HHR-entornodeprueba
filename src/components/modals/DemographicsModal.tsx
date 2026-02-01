import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { PatientData } from '@/types';
import { ADMISSION_ORIGIN_OPTIONS } from '@/constants';
import { BaseModal } from '@/components/shared/BaseModal';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import clsx from 'clsx';

// Type aliases from PatientData for type-safe casting
type BiologicalSex = 'Masculino' | 'Femenino' | 'Indeterminado';
type Insurance = 'Fonasa' | 'Isapre' | 'Particular';
type AdmissionOrigin = 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
type Origin = 'Residente' | 'Turista Nacional' | 'Turista Extranjero';

export type DemographicSubset = Pick<PatientData, 'patientName' | 'rut' | 'age' | 'birthDate' | 'insurance' | 'admissionOrigin' | 'admissionOriginDetails' | 'origin' | 'isRapanui' | 'biologicalSex'>;

interface DemographicsModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: DemographicSubset;
    onSave: (updatedFields: Partial<PatientData>) => void;
    bedId: string;
    recordDate: string;
}

import { logPatientView } from '@/services/admin/auditService';

export const DemographicsModal: React.FC<DemographicsModalProps> = ({ isOpen, onClose, data, onSave, bedId, recordDate }) => {
    const [localData, setLocalData] = useState({
        birthDate: data.birthDate || '',
        insurance: data.insurance || 'Fonasa',
        admissionOrigin: data.admissionOrigin || '',
        admissionOriginDetails: data.admissionOriginDetails || '',
        origin: data.origin || 'Residente',
        isRapanui: data.isRapanui || false,
        biologicalSex: data.biologicalSex || 'Indeterminado'
    });
    const [error, setError] = useState<string | null>(null);

    // Sync when data changes and log view for MINSAL traceability
    // Sync state with props (State derivation pattern)
    const [prevData, setPrevData] = useState(data);
    if (data !== prevData) {
        setLocalData({
            birthDate: data.birthDate || '',
            insurance: data.insurance || 'Fonasa',
            admissionOrigin: data.admissionOrigin || '',
            admissionOriginDetails: data.admissionOriginDetails || '',
            origin: data.origin || 'Residente',
            isRapanui: data.isRapanui || false,
            biologicalSex: data.biologicalSex || 'Indeterminado'
        });
        setPrevData(data);
    }

    // Log view for MINSAL traceability (Side effect remains in useEffect)
    useEffect(() => {
        if (isOpen && data.patientName) {
            logPatientView(bedId, data.patientName, data.rut, recordDate);
        }
    }, [isOpen, data.patientName, data.rut, bedId, recordDate]);

    const calculateFormattedAge = (dob: string) => {
        if (!dob) return '';
        const birth = new Date(dob);
        const today = new Date();

        const diffTime = today.getTime() - birth.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return '';

        if (diffDays < 30) {
            return `${diffDays}d`;
        }

        let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
        if (today.getDate() < birth.getDate()) {
            months--;
        }

        if (months <= 24) {
            return `${months}m`;
        }

        const years = Math.floor(months / 12);
        return `${years}a`;
    };

    const handleSave = () => {
        // Validate birthDate if present
        if (localData.birthDate) {
            const result = PatientInputSchema.pick({ birthDate: true }).safeParse({ birthDate: localData.birthDate });
            if (!result.success) {
                setError(result.error.issues[0].message);
                return;
            }
        }

        const age = localData.birthDate ? calculateFormattedAge(localData.birthDate) : data.age;

        onSave({
            birthDate: localData.birthDate,
            insurance: localData.insurance as Insurance,
            admissionOrigin: localData.admissionOrigin as AdmissionOrigin,
            admissionOriginDetails: localData.admissionOriginDetails,
            origin: localData.origin as Origin,
            isRapanui: localData.isRapanui,
            biologicalSex: localData.biologicalSex as BiologicalSex,
            age: age
        });
        onClose();
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Datos Demográficos"
            icon={<User size={18} />}
            size="lg"
            headerIconColor="text-blue-600"
            variant="white"
        >
            <div className="space-y-6">
                {/* Patient Header Summary - Modern & Clean */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100/60">
                    <div>
                        <p className="text-lg font-display font-black text-slate-900 leading-tight tracking-tight">
                            {data.patientName || "Paciente Nuevo"}
                        </p>
                        <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                            {data.rut || "RUT No especificado"}
                        </p>
                    </div>
                    {data.age && (
                        <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold border border-blue-100">
                            {data.age}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* LEFT COLUMN: Personal Info */}
                    <div className="space-y-5">
                        <h4 className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider pb-2 border-b border-slate-100">
                            <User size={14} className="text-blue-500" />
                            Información Personal
                        </h4>

                        <div className="space-y-4">
                            {/* DOB */}
                            <div className="space-y-1.5">
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">Fecha de Nacimiento</label>
                                <input
                                    type="date"
                                    className={clsx(
                                        "w-full px-3 py-2 bg-slate-50 border rounded-lg text-sm transition-all shadow-sm",
                                        "focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:scale-[1.01] ease-out duration-200",
                                        error ? "border-red-300 focus:border-red-400" : "border-transparent focus:border-blue-500"
                                    )}
                                    value={localData.birthDate}
                                    onChange={(e) => {
                                        setLocalData({ ...localData, birthDate: e.target.value });
                                        setError(null);
                                    }}
                                />
                                {error && <p className="text-[10px] text-red-500 font-bold ml-1">{error}</p>}
                                {!error && localData.birthDate && calculateFormattedAge(localData.birthDate) && (
                                    <p className="text-[10px] text-emerald-600 font-bold ml-1">
                                        Edad calculada: {calculateFormattedAge(localData.birthDate)}
                                    </p>
                                )}
                            </div>

                            {/* Insurance */}
                            <div className="space-y-1.5">
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">Previsión</label>
                                <div className="relative">
                                    <select
                                        className="w-full px-3 py-2 bg-slate-50 border border-transparent rounded-lg text-sm text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none appearance-none cursor-pointer shadow-sm transition-all"
                                        value={localData.insurance}
                                        onChange={(e) => setLocalData({ ...localData, insurance: e.target.value as Insurance })}
                                    >
                                        <option value="Fonasa">Fonasa</option>
                                        <option value="Isapre">Isapre</option>
                                        <option value="Particular">Particular</option>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            {/* Sex */}
                            <div className="space-y-2">
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">Sexo Biológico</label>
                                <div className="flex gap-2">
                                    {['Masculino', 'Femenino', 'Indeterminado'].map((sex) => (
                                        <label
                                            key={sex}
                                            className={clsx(
                                                "cursor-pointer px-3 py-2 rounded-lg text-xs font-bold transition-all border select-none flex-1 text-center",
                                                localData.biologicalSex === sex
                                                    ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm"
                                                    : "bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="biologicalSex"
                                                className="sr-only"
                                                checked={localData.biologicalSex === sex}
                                                onChange={() => setLocalData({ ...localData, biologicalSex: sex as BiologicalSex })}
                                            />
                                            {sex === 'Masculino' ? 'M' : sex === 'Femenino' ? 'F' : '?'}
                                            <span className="hidden sm:inline sm:ml-1 text-[10px] font-normal opacity-80">
                                                {sex === 'Indeterminado' ? '' : sex.slice(1)}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Origin */}
                    <div className="space-y-5">
                        <h4 className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider pb-2 border-b border-slate-100">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Origen y Estadía
                        </h4>

                        <div className="space-y-4">
                            {/* Admission Origin */}
                            <div className="space-y-1.5">
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">Origen del Ingreso</label>
                                <div className="space-y-2">
                                    <div className="relative">
                                        <select
                                            className="w-full px-3 py-2 bg-slate-50 border border-transparent rounded-lg text-sm text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none appearance-none cursor-pointer shadow-sm transition-all"
                                            value={localData.admissionOrigin}
                                            onChange={(e) => setLocalData({ ...localData, admissionOrigin: e.target.value as AdmissionOrigin })}
                                        >
                                            <option value="">-- Seleccionar --</option>
                                            {ADMISSION_ORIGIN_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </div>
                                    </div>

                                    {localData.admissionOrigin === 'Otro' && (
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all shadow-inner"
                                            placeholder="Especifique origen..."
                                            value={localData.admissionOriginDetails}
                                            onChange={(e) => setLocalData({ ...localData, admissionOriginDetails: e.target.value })}
                                            autoFocus
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Residence Condition */}
                            <div className="space-y-1.5">
                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide ml-1">Condición</label>
                                <div className="relative">
                                    <select
                                        className="w-full px-3 py-2 bg-slate-50 border border-transparent rounded-lg text-sm text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none appearance-none cursor-pointer shadow-sm transition-all"
                                        value={localData.origin}
                                        onChange={(e) => setLocalData({ ...localData, origin: e.target.value as Origin })}
                                    >
                                        <option value="Residente">Residente</option>
                                        <option value="Turista Nacional">Turista Nacional</option>
                                        <option value="Turista Extranjero">Turista Extranjero</option>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            {/* Rapanui Checkbox - Modern Card */}
                            <div className="pt-2">
                                <label className={clsx(
                                    "flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer select-none",
                                    localData.isRapanui
                                        ? "bg-amber-50 border-amber-200 shadow-sm"
                                        : "bg-white border-slate-200 hover:bg-slate-50"
                                )}>
                                    <div className={clsx(
                                        "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                                        localData.isRapanui ? "bg-amber-500 border-amber-600" : "bg-white border-slate-300"
                                    )}>
                                        {localData.isRapanui && <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                                        <input
                                            type="checkbox"
                                            className="sr-only"
                                            checked={localData.isRapanui}
                                            onChange={(e) => setLocalData({ ...localData, isRapanui: e.target.checked })}
                                        />
                                    </div>
                                    <div>
                                        <span className={clsx("text-sm font-bold block", localData.isRapanui ? "text-amber-900" : "text-slate-700")}>
                                            Pertenencia Rapanui
                                        </span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions - Modern & Clean */}
                <div className="pt-6 mt-2 flex justify-end items-center gap-4">
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 text-sm font-bold transition-colors px-2"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-500/30 hover:bg-blue-700 hover:shadow-blue-500/40 hover:-translate-y-0.5 transition-all active:scale-95 active:translate-y-0 flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
