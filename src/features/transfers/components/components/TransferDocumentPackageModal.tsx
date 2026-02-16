import React, { useState } from 'react';
import { FileText, Download, Edit3, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { HospitalConfig, GeneratedDocument, TransferPatientData } from '@/types/transferDocuments';
import { downloadDocument } from '@/services/transfers/documentGeneratorService';
import {
  uploadToTransferFolder,
  makeFilePubliclyEditable,
} from '@/services/google/googleDriveService';
import clsx from 'clsx';
import { BaseModal, ModalSection } from '@/components/shared/BaseModal';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

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
  documents,
}) => {
  const [isUploading, setIsUploading] = useState<string | null>(null);

  const handleEdit = async (doc: GeneratedDocument) => {
    setIsUploading(doc.templateId);
    try {
      const result = await uploadToTransferFolder(doc.blob, doc.fileName, {
        patientName: patientData.patientName,
        patientRut: patientData.rut,
      });
      await makeFilePubliclyEditable(result.fileId);
      defaultBrowserWindowRuntime.open(result.webViewLink, '_blank');
    } catch (error: unknown) {
      console.error('Error editing document:', error);
      const err = error as Error;
      const msg = err.message || 'Error al conectar con Google Drive';
      if (msg.includes('configured')) {
        defaultBrowserWindowRuntime.alert(
          'La edición online no está configurada aún (falta Client ID). Por favor, descarga el archivo para editarlo localmente.'
        );
      } else {
        defaultBrowserWindowRuntime.alert(msg);
      }
    } finally {
      setIsUploading(null);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div>
          <h2 className="text-base font-bold text-slate-800 leading-tight">Documentos Generados</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            {hospital.name} • {patientData.patientName}
          </p>
        </div>
      }
      icon={<CheckCircle2 size={18} className="text-emerald-600" />}
      size="full"
      variant="white"
    >
      <div className="space-y-6">
        <div className="grid gap-3">
          {documents.map(doc => (
            <div
              key={doc.templateId}
              className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-center justify-between group hover:bg-white hover:border-blue-200 transition-all hover:shadow-sm"
            >
              <div className="flex items-center gap-4 shrink min-w-0">
                <div
                  className={clsx(
                    'w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm',
                    doc.mimeType.includes('spreadsheet')
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-blue-50 text-blue-600'
                  )}
                >
                  <FileText size={24} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 truncate text-sm">{doc.fileName}</h3>
                  <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest mt-1 truncate">
                    {doc.templateId.replace(/-/g, ' ')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleEdit(doc)}
                  disabled={!!isUploading}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border min-w-[120px] justify-center',
                    isUploading === doc.templateId
                      ? 'bg-blue-50 text-blue-400 border-blue-50'
                      : 'text-blue-600 border-blue-100 hover:bg-blue-600 hover:text-white hover:border-blue-600 shadow-sm shadow-blue-500/5'
                  )}
                >
                  {isUploading === doc.templateId ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Edit3 size={14} />
                  )}
                  {isUploading === doc.templateId ? 'SUBIENDO...' : 'EDITAR CLOUD'}
                </button>
                <button
                  onClick={() => downloadDocument(doc)}
                  disabled={!!isUploading}
                  className={clsx(
                    'flex items-center gap-2 px-5 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white rounded-xl transition-all shadow-lg shadow-slate-200',
                    isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black active:scale-95'
                  )}
                >
                  <Download size={14} />
                  DESCARGAR
                </button>
              </div>
            </div>
          ))}
        </div>

        <ModalSection
          title="Información de Edición"
          icon={<AlertCircle size={16} />}
          variant="info"
          description="El botón 'Editar Cloud' sube el documento a Google Drive para edición colaborativa en tiempo real. Los cambios se guardan automáticamente en la nube."
        >
          <div className="flex items-center gap-2 text-[10px] font-bold text-blue-600/70 uppercase tracking-widest bg-blue-50/50 p-2 rounded-lg border border-blue-100/50">
            <CheckCircle2 size={12} />
            Sincronización segura con Google Workspace
          </div>
        </ModalSection>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-all active:scale-95"
          >
            Finalizar Proceso
          </button>
        </div>
      </div>
    </BaseModal>
  );
};

export default TransferDocumentPackageModal;
