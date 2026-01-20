import React, { useState } from 'react';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { HandoffView } from '@/views/handoff/HandoffView';
import { PenTool, CheckCircle } from 'lucide-react';

export const MedicalSignatureView: React.FC = () => {
    const { record } = useDailyRecordData();
    const { updateMedicalSignature } = useDailyRecordActions();
    const [doctorName, setDoctorName] = useState('');
    const [isSignedLocal, setIsSignedLocal] = useState(false);

    // If record is loading or null
    if (!record) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                <p className="text-slate-500">Cargando entrega de turno...</p>
            </div>
        );
    }

    // Check if already signed
    const existingSignature = record.medicalSignature;
    const isSigned = !!existingSignature || isSignedLocal;
    const signatureData = existingSignature || { doctorName, signedAt: new Date().toISOString() };

    const handleSign = async () => {
        if (!doctorName.trim()) return;
        try {
            await updateMedicalSignature(doctorName);
            setIsSignedLocal(true);
        } catch (error) {
            console.error('Error signing handoff:', error);
            alert('Error al firmar la entrega. Por favor intente nuevamente.');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-32">
            {/* Read Only View */}
            <div className="pointer-events-none select-none">
                <HandoffView type="medical" readOnly={true} />
            </div>

            {/* Signature Footer */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] p-6 z-50 print:hidden">
                <div className="max-w-3xl mx-auto">
                    {isSigned ? (
                        <div className="flex items-center gap-3 bg-green-50 p-3 rounded-lg border border-green-200">
                            <div className="bg-green-100 p-1.5 rounded-full text-green-600">
                                <CheckCircle size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-green-800">Entrega Recibida y Firmada</h3>
                                <p className="text-green-700 text-xs">
                                    Firmado por <strong>{signatureData.doctorName}</strong> el {new Date(signatureData.signedAt).toLocaleString()}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <PenTool className="text-purple-600" />
                                Recepción de Turno Médico
                            </h3>

                            <div className="flex flex-col sm:flex-row gap-4">
                                <input
                                    type="text"
                                    placeholder="Nombre y Apellido del Médico"
                                    value={doctorName}
                                    onChange={(e) => setDoctorName(e.target.value)}
                                    className="flex-1 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none text-lg"
                                />
                                <button
                                    onClick={handleSign}
                                    disabled={!doctorName.trim()}
                                    className="bg-purple-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-lg shadow-md whitespace-nowrap"
                                >
                                    Firmar y Recibir
                                </button>
                            </div>
                            <p className="text-sm text-slate-500 mt-2">
                                Al firmar, certifica que ha leído y recibido la entrega de turno conforme.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
