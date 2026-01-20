/**
 * Backup Preview Modal Component
 * Shows the full content of a backup file
 */

import React from 'react';
import { X, User, FileText } from 'lucide-react';
import { BackupFile, BACKUP_TYPE_CONFIG, SHIFT_TYPE_CONFIG } from '@/types/backup';

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
    if (!isOpen) return null;

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
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/30 z-40"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="fixed inset-4 md:inset-10 bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-teal-600 to-medical-600 text-white">
                    <div className="flex items-center gap-3">
                        <FileText size={24} />
                        <div>
                            <h2 className="text-lg font-bold">
                                {file?.title || 'Cargando...'}
                            </h2>
                            {file && (
                                <p className="text-sm opacity-90">
                                    {typeConfig?.label} {shiftConfig && `• ${shiftConfig.label}`}
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading && (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center text-gray-500">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div>
                                <p>Cargando archivo...</p>
                            </div>
                        </div>
                    )}

                    {file && !isLoading && (
                        <div className="space-y-6">
                            {/* Metadata */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-slate-50 rounded-lg p-3">
                                    <p className="text-xs text-slate-500">Fecha del registro</p>
                                    <p className="font-medium">{file.date}</p>
                                </div>
                                <div className="bg-slate-50 rounded-lg p-3">
                                    <p className="text-xs text-slate-500">Guardado</p>
                                    <p className="font-medium text-sm">{formatDateTime(file.createdAt)}</p>
                                </div>
                                {file.metadata.deliveryStaff && (
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <p className="text-xs text-slate-500">Entrega</p>
                                        <p className="font-medium text-sm">{file.metadata.deliveryStaff}</p>
                                    </div>
                                )}
                                {file.metadata.receivingStaff && (
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <p className="text-xs text-slate-500">Recibe</p>
                                        <p className="font-medium text-sm">{file.metadata.receivingStaff}</p>
                                    </div>
                                )}
                            </div>

                            {/* Content Preview */}
                            <div className="border border-slate-200 rounded-lg">
                                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                                    <h3 className="font-medium text-slate-700">Contenido del Respaldo</h3>
                                </div>
                                <div className="p-4 max-h-96 overflow-y-auto">
                                    <pre className="text-xs text-slate-600 whitespace-pre-wrap">
                                        {JSON.stringify(file.content, null, 2)}
                                    </pre>
                                </div>
                            </div>

                            {/* Created by */}
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <User size={14} />
                                <span>
                                    Guardado por: {file.createdBy.name} ({file.createdBy.email})
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
