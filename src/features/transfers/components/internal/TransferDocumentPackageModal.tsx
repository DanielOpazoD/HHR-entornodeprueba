import React, { useState } from 'react';
import { FileText, Download, Edit3, CheckCircle2, Loader2 } from 'lucide-react';
import { HospitalConfig, GeneratedDocument, TransferPatientData } from '@/types/transferDocuments';
import {
  uploadToTransferFolder,
  makeFilePubliclyEditable,
} from '@/services/google/googleDriveService';
import { isGoogleDriveEditingConfigured } from '@/services/google/googleDriveAuth';
import clsx from 'clsx';
import { BaseModal } from '@/components/shared/BaseModal';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { createScopedLogger } from '@/services/utils/loggerScope';

interface TransferDocumentPackageModalProps {
  isOpen: boolean;
  onClose: () => void;
  hospital: HospitalConfig;
  patientData: TransferPatientData;
  documents: GeneratedDocument[];
  onEdit?: (doc: GeneratedDocument) => void;
}

const transferDocumentPackageLogger = createScopedLogger('TransferDocumentPackageModal');

export const TransferDocumentPackageModal: React.FC<TransferDocumentPackageModalProps> = ({
  isOpen,
  onClose,
  hospital,
  patientData,
  documents,
}) => {
  const [isUploading, setIsUploading] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const isCloudEditingConfigured = isGoogleDriveEditingConfigured();
  const { confirm } = useConfirmDialog();
  const { success, info, warning } = useNotification();

  const handleEdit = async (doc: GeneratedDocument) => {
    if (!isCloudEditingConfigured) {
      info(
        'Edición en nube no disponible',
        'Descarga el archivo para editarlo localmente. La edición en nube aún no está habilitada en este entorno.'
      );
      return;
    }

    setIsUploading(doc.templateId);
    try {
      const result = await uploadToTransferFolder(doc.blob, doc.fileName, {
        patientName: patientData.patientName,
        patientRut: patientData.rut,
      });
      await makeFilePubliclyEditable(result.fileId);
      defaultBrowserWindowRuntime.open(result.webViewLink, '_blank');
    } catch (error: unknown) {
      transferDocumentPackageLogger.error('Error editing transfer document in cloud', error);
      const err = error as Error;
      const msg = err.message || 'Error al conectar con Google Drive';
      if (msg.includes('configured')) {
        warning(
          'Edición online no configurada',
          'Falta el Client ID de Google. Descarga el archivo para editarlo localmente.'
        );
      } else {
        warning('No se pudo editar en la nube', msg);
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
      size="5xl"
      variant="white"
      scrollableBody={false}
      bodyClassName="p-4 space-y-4"
    >
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            onClick={async () => {
              const shouldContinue = await confirm({
                title: 'Guardar todos los documentos',
                message:
                  'Se abrirá un selector para elegir la carpeta de destino. Luego el navegador puede pedir una autorización adicional para guardar los archivos ahí.',
                confirmText: 'Continuar',
                cancelText: 'Cancelar',
                variant: 'info',
              });

              if (!shouldContinue) {
                return;
              }

              setIsDownloadingAll(true);
              try {
                const { downloadAllDocuments } =
                  await import('@/services/transfers/documentGeneratorService');
                const result = await downloadAllDocuments(documents);
                if (result === 'directory') {
                  success(
                    'Documentos guardados',
                    `${documents.length} archivo(s) guardados en la carpeta seleccionada.`
                  );
                }
                if (result === 'zip') {
                  info(
                    'Descarga como ZIP',
                    'Tu navegador no permite elegir una carpeta para varios archivos. Se descargó un ZIP con todos los documentos.'
                  );
                }
                if (result === 'cancelled') {
                  warning('Guardado cancelado', 'No se guardaron los documentos.');
                }
              } finally {
                setIsDownloadingAll(false);
              }
            }}
            disabled={!!isUploading || isDownloadingAll || documents.length === 0}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all',
              !!isUploading || isDownloadingAll || documents.length === 0
                ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-95'
            )}
          >
            {isDownloadingAll ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            {isDownloadingAll ? 'PREPARANDO ARCHIVOS...' : 'DESCARGAR TODO'}
          </button>
        </div>

        <div className="grid gap-2.5">
          {documents.map(doc => (
            <div
              key={doc.templateId}
              className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center justify-between gap-3 group hover:bg-white hover:border-blue-200 transition-all hover:shadow-sm"
            >
              <div className="flex items-center gap-4 shrink min-w-0">
                <div
                  className={clsx(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm',
                    doc.mimeType.includes('spreadsheet')
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-blue-50 text-blue-600'
                  )}
                >
                  <FileText size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 truncate text-[15px] leading-tight">
                    {doc.fileName}
                  </h3>
                  <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest mt-0.5 truncate">
                    {doc.templateId.replace(/-/g, ' ')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleEdit(doc)}
                  disabled={!!isUploading || isDownloadingAll || !isCloudEditingConfigured}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border min-w-[108px] justify-center',
                    isUploading === doc.templateId
                      ? 'bg-blue-50 text-blue-400 border-blue-50'
                      : !isCloudEditingConfigured
                        ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                        : 'text-blue-600 border-blue-100 hover:bg-blue-600 hover:text-white hover:border-blue-600 shadow-sm shadow-blue-500/5'
                  )}
                  title={
                    isCloudEditingConfigured
                      ? 'Subir a Google Drive para edición online'
                      : 'La edición en nube aún no está configurada en este entorno'
                  }
                >
                  {isUploading === doc.templateId ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Edit3 size={14} />
                  )}
                  {isUploading === doc.templateId
                    ? 'SUBIENDO...'
                    : isCloudEditingConfigured
                      ? 'EDITAR CLOUD'
                      : 'CLOUD NO DISP.'}
                </button>
                <button
                  onClick={async () => {
                    const { downloadDocument } =
                      await import('@/services/transfers/documentGeneratorService');
                    const result = await downloadDocument(doc);
                    if (result === 'saved') {
                      success('Documento guardado', doc.fileName);
                    }
                    if (result === 'cancelled') {
                      info('Guardado cancelado', 'No se descargó el documento.');
                    }
                  }}
                  disabled={!!isUploading || isDownloadingAll}
                  className={clsx(
                    'flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white rounded-xl transition-all shadow-lg shadow-slate-200',
                    !!isUploading || isDownloadingAll
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-black active:scale-95'
                  )}
                >
                  <Download size={14} />
                  DESCARGAR
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-7 py-2 bg-slate-100 text-slate-500 font-black text-[11px] uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-all active:scale-95"
          >
            Finalizar Proceso
          </button>
        </div>
      </div>
    </BaseModal>
  );
};

export default TransferDocumentPackageModal;
