/**
 * MedicalHandoffHeader Component
 * 
 * Displays the medical handoff header with doctor signature information
 * and bed statistics for the medical shift handoff view.
 */

import React from 'react';
import { CheckCircle, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import type { DailyRecord } from '@/types';
import type { BedDefinition } from '@/types';
import { useConfirmDialog } from '@/context/UIContext';

interface MedicalHandoffHeaderProps {
    record: DailyRecord;
    visibleBeds: BedDefinition[];
    readOnly: boolean;
    updateMedicalHandoffDoctor: (name: string) => void;
    markMedicalHandoffAsSent: (doctorName: string) => void;
}

export const MedicalHandoffHeader: React.FC<MedicalHandoffHeaderProps> = ({
    record,
    visibleBeds,
    readOnly,
    updateMedicalHandoffDoctor,
    markMedicalHandoffAsSent
}) => {
    const { confirm: showConfirm, alert: showAlert } = useConfirmDialog();

    const handleSign = async () => {
        const doctorName = record.medicalHandoffDoctor?.trim();
        if (!doctorName) {
            showAlert('Debe escribir su nombre para firmar la entrega.', 'Falta nombre');
            return;
        }

        const confirmed = await showConfirm({
            title: 'Confirmar Firma de Entrega',
            message: `¿Estás seguro de que deseas firmar la entrega como "${doctorName}"?\nEsta acción quedará registrada con la hora actual.`,
            confirmText: 'Firmar ahora',
            cancelText: 'Cancelar',
            variant: 'info'
        });

        if (confirmed) {
            markMedicalHandoffAsSent(doctorName);
        }
    };

    // Calculate bed statistics
    const totalBeds = visibleBeds.length;
    const occupiedBeds = visibleBeds.filter(b => record.beds[b.id]?.patientName).length;
    const freeBeds = visibleBeds.filter(b => !record.beds[b.id]?.patientName && !record.beds[b.id]?.isBlocked).length;
    const blockedBeds = visibleBeds.filter(b => record.beds[b.id]?.isBlocked).length;

    return (
        <div className="mb-4 bg-white p-3 rounded-lg border border-blue-100 shadow-sm print:shadow-none print:border-none print:p-0 print:mb-2">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 print:flex-row print:items-start print:gap-6">

                {/* LEFT: Deliver / Receive Info */}
                <div className="flex flex-col gap-4 flex-1">
                    <div className="flex flex-col sm:flex-row gap-4 print:gap-6">
                        {/* Delivers */}
                        <div className="flex-1 min-w-[200px] max-w-xs">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 print:text-[9px] print:text-black">Entregado por (Dr.):</label>
                            {!readOnly ? (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder=""
                                        value={record.medicalHandoffDoctor || ''}
                                        onChange={(e) => updateMedicalHandoffDoctor(e.target.value)}
                                        className="flex-1 p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none print:hidden text-sm"
                                    />
                                    {!record.medicalHandoffSentAt && !record.medicalSignature && (
                                        <button
                                            onClick={handleSign}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs font-bold whitespace-nowrap print:hidden"
                                            title="Firmar entrega de turno"
                                        >
                                            <ShieldCheck size={14} />
                                            Firmar
                                        </button>
                                    )}
                                </div>
                            ) : null}
                            <div className={clsx("text-sm font-medium text-slate-800 print:text-[11px]", !readOnly && "hidden print:block")}>
                                {record.medicalHandoffDoctor || <span className="text-slate-400 italic">No especificado</span>}
                            </div>

                            {/* Sent Timestamp (Signature of Sender) */}
                            {record.medicalHandoffSentAt && (
                                <div className="mt-1 flex items-center gap-1.5 text-xs text-blue-600">
                                    <ShieldCheck size={12} />
                                    <span className="font-medium">Entregado y firmado: {new Date(record.medicalHandoffSentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            )}
                        </div>

                        {/* Receives */}
                        <div className="flex-1 min-w-[200px] max-w-xs sm:ml-8 md:ml-12 lg:ml-16">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 print:text-[9px] print:text-black">Recibido por (Dr.):</label>
                            {record.medicalSignature ? (
                                <div>
                                    <div className="font-bold text-green-700 text-sm print:text-[11px]">{record.medicalSignature.doctorName}</div>
                                    <div className="text-xs text-green-600 flex items-center gap-1">
                                        <CheckCircle size={12} />
                                        Firmado {new Date(record.medicalSignature.signedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-slate-400 italic flex items-center gap-2 text-sm print:text-[11px]">
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300 print:w-1 print:h-1"></div>
                                    Pendiente de firma
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT: Bed Stats (Compact 2-column grid) */}
                <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 min-w-[160px] print:min-w-[120px] print:border text-[10px] print:text-[9px] self-start print:p-1.5">
                    <h3 className="font-bold text-slate-700 uppercase border-b border-slate-200 pb-0.5 mb-1 text-center text-[9px] print:text-[8px]">Resumen Camas</h3>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-600">Totales:</span>
                            <span className="font-bold text-slate-800 text-xs print:text-[10px]">{totalBeds}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-600">Ocupadas:</span>
                            <span className="font-bold text-blue-600 text-xs print:text-[10px]">{occupiedBeds}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-600">Libres:</span>
                            <span className="font-bold text-green-600 text-xs print:text-[10px]">{freeBeds}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">Bloqueadas:</span>
                            <span className="font-bold text-slate-400 text-xs print:text-[10px]">{blockedBeds}</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default MedicalHandoffHeader;
