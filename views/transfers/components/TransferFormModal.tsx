/**
 * Transfer Form Modal Component
 * Modal for creating and editing transfer requests
 */

import React, { useState, useEffect } from 'react';
import { TransferRequest, TransferFormData } from '../../../types/transfers';
import { DESTINATION_HOSPITALS, MEDICAL_SPECIALTIES, TRANSFER_REASONS } from '../../../constants/transferConstants';
import { PatientSelector } from './PatientSelector';

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
    const [transferReason, setTransferReason] = useState(transfer?.transferReason || '');
    const [requiredSpecialty, setRequiredSpecialty] = useState(transfer?.requiredSpecialty || '');
    const [requestingDoctor, setRequestingDoctor] = useState(transfer?.requestingDoctor || '');
    const [observations, setObservations] = useState(transfer?.observations || '');
    const [isSaving, setIsSaving] = useState(false);

    // Find selected patient
    const selectedPatient = patients.find(p => p.id === selectedPatientId);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedPatientId || !destinationHospital || !transferReason || !requestingDoctor) {
            alert('Por favor complete todos los campos requeridos');
            return;
        }

        setIsSaving(true);
        try {
            await onSave({
                patientId: selectedPatientId,
                bedId: selectedPatientId,
                destinationHospital,
                transferReason,
                requiredSpecialty,
                requestingDoctor,
                observations
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-800">
                        {isEditing ? 'Editar Solicitud de Traslado' : 'Nueva Solicitud de Traslado'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                        disabled={isSaving}
                    >
                        ✕
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Patient Selection (only for new) */}
                    {!isEditing && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Paciente Hospitalizado *
                            </label>
                            <PatientSelector
                                patients={patients}
                                selectedPatientId={selectedPatientId}
                                onChange={setSelectedPatientId}
                                disabled={isSaving}
                            />
                        </div>
                    )}

                    {/* Patient Info (read-only when editing) */}
                    {isEditing && transfer && (
                        <div className="bg-gray-50 p-3 rounded-lg">
                            <h3 className="text-sm font-medium text-gray-500 mb-2">Datos del Paciente</h3>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div><span className="text-gray-500">Nombre:</span> {transfer.patientSnapshot.name}</div>
                                <div><span className="text-gray-500">RUT:</span> {transfer.patientSnapshot.rut}</div>
                                <div><span className="text-gray-500">Cama:</span> {transfer.bedId.replace('BED_', '')}</div>
                                <div><span className="text-gray-500">Diagnóstico:</span> {transfer.patientSnapshot.diagnosis}</div>
                            </div>
                        </div>
                    )}

                    {/* Selected Patient Preview (for new) */}
                    {!isEditing && selectedPatient && (
                        <div className="bg-blue-50 p-3 rounded-lg text-sm">
                            <p><strong>Paciente seleccionado:</strong> {selectedPatient.name}</p>
                            <p className="text-gray-600">Cama {selectedPatient.bedId.replace('BED_', '')} - {selectedPatient.diagnosis}</p>
                        </div>
                    )}

                    {/* Hospital Destination */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Hospital Destino *
                        </label>
                        <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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

                    {/* Transfer Reason */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Motivo del Traslado *
                        </label>
                        <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={transferReason}
                            onChange={(e) => setTransferReason(e.target.value)}
                            disabled={isSaving}
                        >
                            <option value="">Seleccionar motivo...</option>
                            {TRANSFER_REASONS.map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>

                    {/* Required Specialty */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Especialidad Requerida
                        </label>
                        <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={requiredSpecialty}
                            onChange={(e) => setRequiredSpecialty(e.target.value)}
                            disabled={isSaving}
                        >
                            <option value="">Seleccionar especialidad...</option>
                            {MEDICAL_SPECIALTIES.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>

                    {/* Requesting Doctor */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Médico Solicitante *
                        </label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Nombre del médico"
                            value={requestingDoctor}
                            onChange={(e) => setRequestingDoctor(e.target.value)}
                            disabled={isSaving}
                        />
                    </div>

                    {/* Observations */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Observaciones
                        </label>
                        <textarea
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            rows={3}
                            placeholder="Observaciones adicionales..."
                            value={observations}
                            onChange={(e) => setObservations(e.target.value)}
                            disabled={isSaving}
                        />
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 pt-4 border-t">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                            disabled={isSaving}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            disabled={isSaving || (!isEditing && !selectedPatientId)}
                        >
                            {isSaving ? 'Guardando...' : (isEditing ? 'Guardar Cambios' : 'Crear Solicitud')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
