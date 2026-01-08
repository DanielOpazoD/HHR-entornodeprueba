/**
 * Transfer Form Modal Component
 * Modal for creating and editing transfer requests
 * Simplified version: removes medical requester, observations, and transfer reason
 */

import React, { useState } from 'react';
import { TransferRequest, TransferFormData } from '@/types/transfers';
import { DESTINATION_HOSPITALS, MEDICAL_SPECIALTIES } from '@/constants/transferConstants';
import { PatientSelector } from './PatientSelector';
import { X } from 'lucide-react';

interface Patient {
    id: string;
    name: string;
    bedId: string;
    diagnosis: string;
}

interface TransferFormModalProps {
    transfer: TransferRequest | null;
    patients: Patient[];
    onClose: () => void;
    onSave: (data: TransferFormData) => Promise<void>;
}

export const TransferFormModal: React.FC<TransferFormModalProps> = ({
    transfer,
    patients,
    onClose,
    onSave
}) => {
    const isEditing = transfer !== null;

    // Form state
    const [selectedPatientId, setSelectedPatientId] = useState(transfer?.bedId || '');
    const [destinationHospital, setDestinationHospital] = useState(transfer?.destinationHospital || '');
    const [requiredSpecialty, setRequiredSpecialty] = useState(transfer?.requiredSpecialty || '');
    const [isSaving, setIsSaving] = useState(false);

    // Find selected patient
    const selectedPatient = patients.find(p => p.id === selectedPatientId);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedPatientId || !destinationHospital) {
            alert('Por favor complete todos los campos requeridos');
            return;
        }

        setIsSaving(true);
        try {
            await onSave({
                patientId: selectedPatientId,
                bedId: selectedPatientId,
                destinationHospital,
                transferReason: 'Derivación a especialidad', // System default
                requiredSpecialty,
                requestingDoctor: '', // Manual entry per user request
                observations: ''
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">
                            {isEditing ? 'Editar Traslado' : 'Nueva Solicitud'}
                        </h2>
                        <p className="text-slate-500 text-sm mt-0.5">
                            Gestión de derivación hospitalaria
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-all"
                        disabled={isSaving}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Patient Selection (only for new) */}
                    {!isEditing ? (
                        <div className="space-y-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                                Paciente Hospitalizado
                            </label>
                            <PatientSelector
                                patients={patients}
                                selectedPatientId={selectedPatientId}
                                onChange={setSelectedPatientId}
                                disabled={isSaving}
                            />
                            {selectedPatient && (
                                <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
                                    <p className="font-bold">{selectedPatient.name}</p>
                                    <p className="opacity-80">Cama {selectedPatient.bedId.replace('BED_', '')} • {selectedPatient.diagnosis}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Paciente Seleccionado</h3>
                            <div className="space-y-1">
                                <p className="text-sm font-bold text-slate-800">{transfer.patientSnapshot.name}</p>
                                <p className="text-xs text-slate-500">{transfer.patientSnapshot.rut} • Cama {transfer.bedId.replace('BED_', '')}</p>
                            </div>
                        </div>
                    )}

                    {/* Hospital Destination */}
                    <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Hospital Destino *
                        </label>
                        <select
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                            value={destinationHospital}
                            onChange={(e) => setDestinationHospital(e.target.value)}
                            disabled={isSaving}
                        >
                            <option value="">Seleccionar hospital...</option>
                            {DESTINATION_HOSPITALS.map(h => (
                                <option key={h.id} value={h.name}>{h.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Required Specialty */}
                    <div className="space-y-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Especialidad Requerida
                        </label>
                        <select
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                            value={requiredSpecialty}
                            onChange={(e) => setRequiredSpecialty(e.target.value)}
                            disabled={isSaving}
                        >
                            <option value="">Opcional: Seleccionar especialidad...</option>
                            {MEDICAL_SPECIALTIES.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2.5 text-slate-600 font-semibold text-sm hover:bg-slate-50 rounded-xl transition-all"
                            disabled={isSaving}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="px-8 py-2.5 bg-slate-900 text-white font-bold text-sm rounded-xl hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-900/10"
                            disabled={isSaving || (!isEditing && !selectedPatientId) || !destinationHospital}
                        >
                            {isSaving ? 'Guardando...' : (isEditing ? 'Guardar Cambios' : 'Crear Traslado')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
