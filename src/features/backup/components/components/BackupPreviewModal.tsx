import React from 'react';
import { User, FileText, Search } from 'lucide-react';
import { BackupFile, BACKUP_TYPE_CONFIG, SHIFT_TYPE_CONFIG } from '@/types/backup';
import { BaseModal, ModalSection } from '@/components/shared/BaseModal';

interface BackupPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    file: BackupFile | null;
    isLoading: boolean;
}

export const BackupPreviewModal: React.FC<BackupPreviewModalProps> = ({
    isOpen,
    onClose,
    file,
    isLoading
}) => {
    const typeConfig = file ? BACKUP_TYPE_CONFIG[file.type] : null;
    const shiftConfig = file?.shiftType ? SHIFT_TYPE_CONFIG[file.shiftType] : null;

    const formatDateTime = (isoStr: string) => {
        const date = new Date(isoStr);
        return date.toLocaleString('es-CL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={file?.title || 'Cargando...'}
            icon={<FileText size={18} />}
            size="full"
            variant="white"
            headerIconColor="text-medical-600"
        >
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-medical-600 mb-4"></div>
                    <p className="text-slate-500 font-bold">Cargando archivo histórico...</p>
                </div>
            ) : file ? (
                <div className="space-y-6">
                    {/* Metadata Header */}
                    <div className="flex flex-wrap items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <span className="bg-slate-100 px-2 py-1 rounded-md">{typeConfig?.label}</span>
                        {shiftConfig && <span className="bg-slate-100 px-2 py-1 rounded-md">{shiftConfig.label}</span>}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Fecha Registro</p>
                            <p className="text-sm font-bold text-slate-700">{file.date}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Auditado en</p>
                            <p className="text-sm font-bold text-emerald-600">{formatDateTime(file.createdAt)}</p>
                        </div>
                        {file.metadata.deliveryStaff && (
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Entrega</p>
                                <p className="text-[11px] font-bold text-slate-700 truncate">{file.metadata.deliveryStaff}</p>
                            </div>
                        )}
                        {file.metadata.receivingStaff && (
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Recibe</p>
                                <p className="text-[11px] font-bold text-slate-700 truncate">{file.metadata.receivingStaff}</p>
                            </div>
                        )}
                    </div>

                    {/* Content Preview */}
                    <ModalSection
                        title="Contenido del Respaldo (JSON)"
                        icon={<Search size={16} />}
                        description="Vista técnica del objeto de datos preservado en este punto de restauración."
                        variant="info"
                    >
                        <div className="bg-slate-900 rounded-xl p-4 overflow-hidden border border-slate-800">
                            <pre className="text-[11px] text-emerald-400/90 font-mono whitespace-pre-wrap max-h-96 overflow-y-auto custom-scrollbar">
                                {JSON.stringify(file.content, null, 2)}
                            </pre>
                        </div>
                    </ModalSection>

                    {/* Ownership info */}
                    <div className="flex items-center gap-2 p-3 bg-blue-50/50 rounded-xl border border-blue-100/50">
                        <User size={16} className="text-blue-600" />
                        <div>
                            <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest leading-none mb-1">Autor de Respaldo</p>
                            <p className="text-[11px] font-bold text-slate-700">
                                {file.createdBy.name} <span className="font-normal text-slate-400">&lt;{file.createdBy.email}&gt;</span>
                            </p>
                        </div>
                    </div>
                </div>
            ) : null}
        </BaseModal>
    );
};
