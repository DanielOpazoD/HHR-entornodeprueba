import React, { useState } from 'react';
import { X, FileText, Download, Edit3, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { HospitalConfig, GeneratedDocument, TransferPatientData } from '@/types/transferDocuments';
import { downloadDocument } from '@/services/transfers/documentGeneratorService';
import { uploadToTransferFolder, makeFilePubliclyEditable } from '@/services/google/googleDriveService';
import clsx from 'clsx';

interface TransferDocumentPackageModalProps {
    isOpen: boolean;
    onClose: () => void;
    hospital: HospitalConfig;
    patientData: TransferPatientData;
    documents: GeneratedDocument[];
    onEdit?: (doc: GeneratedDocument) => void;
}

export const TransferDocumentPackageModal: React.FC<TransferDocumentPackageModalProps> = ({
    isOpen,
    onClose,
    hospital,
    patientData,
    documents
}) => {
    const [isUploading, setIsUploading] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleEdit = async (doc: GeneratedDocument) => {
        setIsUploading(doc.templateId);
        try {
            // Upload to organized folder structure: Traslados HHR / Año / Mes / Paciente
            const result = await uploadToTransferFolder(doc.blob, doc.fileName, {
                patientName: patientData.patientName,
                patientRut: patientData.rut
            });
            // console.info(`[Transfers] File uploaded to: ${result.folderPath}`);

            // Optional: make it editable by anyone with link if corporate account allows it
            await makeFilePubliclyEditable(result.fileId);
            window.open(result.webViewLink, '_blank');
        } catch (error: any) {
            console.error('Error editing document:', error);
            const msg = error.message || 'Error al conectar con Google Drive';
            if (msg.includes('configured')) {
                alert('La edición online no está configurada aún (falta Client ID). Por favor, descarga el archivo para editarlo localmente.');
            } else {
                alert(msg);
            }
        } finally {
            setIsUploading(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-md p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <CheckCircle2 className="text-green-600" size={20} />
                            Documentos Listos
                        </h2>
                        <p className="text-slate-500 text-xs">
                            {hospital.name} • {patientData.patientName}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full hover:bg-slate-200 transition-colors"
                    >
                        <X size={18} className="text-slate-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 bg-slate-50/30">
                    <div className="grid gap-3">
                        {documents.map((doc) => (
                            <div
                                key={doc.templateId}
                                className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow"
                            >
                                <div className="flex items-center gap-3 shrink min-w-0">
                                    <div className={clsx(
                                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                                        doc.mimeType.includes('spreadsheet') ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"
                                    )}>
                                        <FileText size={20} />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-semibold text-slate-800 truncate text-sm">
                                            {doc.fileName}
                                        </h3>
                                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5 truncate">
                                            {doc.templateId.replace(/-/g, ' ')}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        onClick={() => handleEdit(doc)}
                                        disabled={!!isUploading}
                                        className={clsx(
                                            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border border-transparent min-w-[100px] justify-center",
                                            isUploading === doc.templateId
                                                ? "bg-blue-50 text-blue-400 cursor-not-allowed"
                                                : "text-blue-600 hover:bg-blue-50 hover:border-blue-100"
                                        )}
                                    >
                                        {isUploading === doc.templateId ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Edit3 size={14} />
                                        )}
                                        {isUploading === doc.templateId ? 'Subiendo...' : 'Editar'}
                                    </button>
                                    <button
                                        onClick={() => downloadDocument(doc)}
                                        disabled={!!isUploading}
                                        className={clsx(
                                            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg transition-colors shadow-sm",
                                            isUploading ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-900"
                                        )}
                                    >
                                        <Download size={14} />
                                        Descargar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Info Box */}
                    <div className="mt-6 p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex gap-2">
                        <AlertCircle className="text-blue-600 shrink-0" size={16} />
                        <div className="text-[11px] text-blue-800">
                            <p className="font-semibold">Sugerencia de Edición</p>
                            <p className="mt-0.5 opacity-90">
                                Al pulsar &quot;Editar&quot;, el documento se abrirá en Google Drive. Cualquier cambio que realices se guardará automáticamente en la nube.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
                    >
                        Finalizar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TransferDocumentPackageModal;
