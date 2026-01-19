import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { PatientData } from '../../types';
import { ADMISSION_ORIGIN_OPTIONS } from '../../constants';
import { BaseModal, ModalSection } from '../shared/BaseModal';
import { PatientInputSchema } from '../../schemas/inputSchemas';
import clsx from 'clsx';

// Type aliases from PatientData for type-safe casting
type BiologicalSex = 'Masculino' | 'Femenino' | 'Indeterminado';
type Insurance = 'Fonasa' | 'Isapre' | 'Particular';
type AdmissionOrigin = 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
type Origin = 'Residente' | 'Turista Nacional' | 'Turista Extranjero';

interface DemographicsModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: PatientData;
    onSave: (updatedFields: Partial<PatientData>) => void;
    bedId: string;
    recordDate: string;
}

import { logPatientView } from '../../services/admin/auditService';

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
            icon={<User size={16} />}
            size="md"
            headerIconColor="text-blue-600"
            variant="white"
        >
            <div className="space-y-6">
                {/* Patient Header Summary - Minimalist */}
                <div className="pb-4 border-b border-slate-100">
                    <p className="text-lg font-display font-bold text-slate-900 leading-tight">
                        {data.patientName || "Paciente Nuevo / Por definir"}
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                        {data.rut || "RUT No especificado"}
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Section 1: Demographic Info */}
                    <ModalSection
                        title="Información Básica"
                        variant="default"
                    >
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Fecha de Nacimiento</label>
                                <input
                                    type="date"
                                    className={clsx(
                                        "w-full p-2 bg-slate-50 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-all",
                                        error ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                    )}
                                    value={localData.birthDate}
                                    onChange={(e) => {
                                        setLocalData({ ...localData, birthDate: e.target.value });
                                        setError(null);
                                    }}
                                />
                                {error ? (
                                    <p className="text-[9px] text-red-500 mt-1 font-medium pl-1">{error}</p>
                                ) : localData.birthDate && (
                                    <p className="text-[10px] text-emerald-600 mt-1 font-semibold pl-1">
                                        Edad: {calculateFormattedAge(localData.birthDate)}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Previsión</label>
                                <select
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                                    value={localData.insurance}
                                    onChange={(e) => setLocalData({ ...localData, insurance: e.target.value as Insurance })}
                                >
                                    <option value="Fonasa">Fonasa</option>
                                    <option value="Isapre">Isapre</option>
                                    <option value="Particular">Particular</option>
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Sexo Biológico</label>
                                <div className="flex flex-col gap-1.5 pl-1">
                                    {['Masculino', 'Femenino', 'Indeterminado'].map((sex) => (
                                        <label key={sex} className="flex items-center gap-2 cursor-pointer group">
                                            <input
                                                type="radio"
                                                name="biologicalSex"
                                                checked={localData.biologicalSex === sex}
                                                onChange={() => setLocalData({ ...localData, biologicalSex: sex as BiologicalSex })}
                                                className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500/20"
                                            />
                                            <span className={clsx("text-xs transition-colors", localData.biologicalSex === sex ? "font-bold text-slate-900" : "text-slate-500 group-hover:text-slate-700")}>
                                                {sex}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </ModalSection>

                    {/* Section 2: Origin & Permanence */}
                    <ModalSection
                        title="Origen y Permanencia"
                        variant="info"
                    >
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Origen del Ingreso</label>
                                <div className="space-y-2">
                                    <select
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                                        value={localData.admissionOrigin}
                                        onChange={(e) => setLocalData({ ...localData, admissionOrigin: e.target.value as AdmissionOrigin })}
                                    >
                                        <option value="">-- Seleccionar --</option>
                                        {ADMISSION_ORIGIN_OPTIONS.map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                    {localData.admissionOrigin === 'Otro' && (
                                        <input
                                            type="text"
                                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all mt-1 shadow-sm"
                                            placeholder="Especifique origen..."
                                            value={localData.admissionOriginDetails}
                                            onChange={(e) => setLocalData({ ...localData, admissionOriginDetails: e.target.value })}
                                            autoFocus
                                        />
                                    )}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">Condición de Permanencia</label>
                                <select
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none transition-all cursor-pointer"
                                    value={localData.origin}
                                    onChange={(e) => setLocalData({ ...localData, origin: e.target.value as Origin })}
                                >
                                    <option value="Residente">Residente</option>
                                    <option value="Turista Nacional">Turista Nacional</option>
                                    <option value="Turista Extranjero">Turista Extranjero</option>
                                </select>
                            </div>

                            <div className="pt-2">
                                <label className="flex items-center gap-2 cursor-pointer group p-1">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500/30"
                                        checked={localData.isRapanui}
                                        onChange={(e) => setLocalData({ ...localData, isRapanui: e.target.checked })}
                                    />
                                    <span className="text-xs text-slate-600 font-semibold group-hover:text-slate-800 transition-colors">
                                        Pertenencia Rapanui
                                    </span>
                                </label>
                            </div>
                        </div>
                    </ModalSection>
                </div>

                {/* Footer Actions - Standard Clean Style */}
                <div className="pt-6 border-t border-slate-100 flex justify-end items-center gap-4">
                    <button
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-700 text-sm font-semibold transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-md shadow-blue-600/10 hover:bg-blue-700 transition-all transform active:scale-95"
                    >
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
