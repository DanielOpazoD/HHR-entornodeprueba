/**
 * Shift Panel View
 * 
 * Displays current weekly shift from WhatsApp parser
 */

import React, { useState, useEffect } from 'react';
import {
    Users,
    Phone,
    MessageCircle,
    Calendar,
    RefreshCw,
    Clock,
    AlertCircle,
    Plus,
    X,
    Upload,
    Search
} from 'lucide-react';
import { subscribeToCurrentShift, saveManualShift, fetchShiftsFromGroup } from '@/services/integrations/whatsapp/whatsappService';
import type { WeeklyShift, ShiftStaffMember } from '@/types';

export const ShiftPanelView: React.FC = () => {
    const [shift, setShift] = useState<WeeklyShift | null>(null);
    const [loading, setLoading] = useState(true);
    const [showOriginal, setShowOriginal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importMessage, setImportMessage] = useState('');
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState('');

    // State for fetching from WhatsApp group
    const [fetching, setFetching] = useState(false);
    const [fetchResult, setFetchResult] = useState<{ success?: boolean; message?: string; error?: string } | null>(null);

    useEffect(() => {
        const unsubscribe = subscribeToCurrentShift((data) => {
            setShift(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleImport = async () => {
        if (!importMessage.trim()) {
            setImportError('Por favor, pega el mensaje de turno');
            return;
        }

        setImporting(true);
        setImportError('');

        const result = await saveManualShift(importMessage);

        if (result.success) {
            setShowImportModal(false);
            setImportMessage('');
        } else {
            setImportError(result.error || 'Error al importar el mensaje');
        }

        setImporting(false);
    };

    const handleFetchFromGroup = async () => {
        setFetching(true);
        setFetchResult(null);

        const result = await fetchShiftsFromGroup();
        setFetchResult(result);
        setFetching(false);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    if (!shift) {
        return (
            <div className="space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                    <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
                    <h3 className="font-medium text-yellow-800 mb-2">No hay turno vigente</h3>
                    <p className="text-sm text-yellow-600 mb-4">
                        No se ha recibido información de turnos de pabellón esta semana.
                    </p>

                    {/* Fetch result message */}
                    {fetchResult && (
                        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${fetchResult.success
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                            }`}>
                            {fetchResult.success ? '✅ ' : '⚠️ '}
                            {fetchResult.message || fetchResult.error}
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                            onClick={handleFetchFromGroup}
                            disabled={fetching}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                            {fetching ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <Search className="w-4 h-4" />
                            )}
                            {fetching ? 'Buscando...' : 'Buscar en Grupo de WhatsApp'}
                        </button>
                        <button
                            onClick={() => setShowImportModal(true)}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Importar Manualmente
                        </button>
                    </div>
                </div>

                {/* Import Modal */}
                {showImportModal && (
                    <ImportModal
                        message={importMessage}
                        setMessage={setImportMessage}
                        onImport={handleImport}
                        onClose={() => setShowImportModal(false)}
                        importing={importing}
                        error={importError}
                    />
                )}
            </div>
        );
    }


    const hasStaff = shift.staff && shift.staff.length > 0;
    const hasOriginalMessage = !!shift.originalMessage;

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        // Handle YYYY-MM-DD
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            return `${day}-${month}-${year}`;
        }
        return dateStr;
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Users className="w-6 h-6 text-blue-500" />
                    <h2 className="text-xl font-semibold">Turno Pabellón</h2>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Calendar className="w-4 h-4" />
                    {formatDate(shift.startDate)} - {formatDate(shift.endDate)}
                </div>
            </div>

            {/* Source info */}
            <div className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Actualizado: {new Date(shift.parsedAt).toLocaleString('es-CL')}
                {shift.source === 'whatsapp' && (
                    <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                        WhatsApp
                    </span>
                )}
            </div>

            {/* Toggle between parsed and original */}
            {hasOriginalMessage && (
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowOriginal(false)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${!showOriginal
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        Vista Parseada {hasStaff && `(${shift.staff.length})`}
                    </button>
                    <button
                        onClick={() => setShowOriginal(true)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${showOriginal
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        Mensaje Original
                    </button>
                </div>
            )}

            {/* Content */}
            {showOriginal || !hasStaff ? (
                /* Show original message */
                <div className="bg-gray-50 border rounded-lg p-4">
                    {!hasStaff && !showOriginal && (
                        <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded mb-3 inline-block">
                            ⚠️ No se pudieron parsear los contactos automáticamente
                        </div>
                    )}
                    <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
                        {shift.originalMessage || 'No hay mensaje original disponible'}
                    </pre>
                </div>
            ) : (
                /* Staff Grid */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {shift.staff.map((member, index) => (
                        <StaffCard key={index} member={member} />
                    ))}
                </div>
            )}
        </div>
    );
};


/**
 * Individual staff card
 */
const StaffCard: React.FC<{ member: ShiftStaffMember }> = ({ member }) => {
    const handleCall = () => {
        window.open(`tel:${member.phone}`, '_self');
    };

    const handleWhatsApp = () => {
        window.open(member.whatsappUrl, '_blank');
    };

    return (
        <div className="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
            {/* Role */}
            <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">
                {member.role}
            </div>

            {/* Name */}
            <div className="font-semibold text-gray-900 mb-2">
                {member.name}
            </div>

            {/* Phone */}
            <div className="text-sm text-gray-600 mb-3">
                📱 {member.phone}
            </div>

            {/* Notes */}
            {member.notes && (
                <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded mb-3">
                    ⏰ {member.notes}
                </div>
            )}

            {/* Replacement */}
            {member.replacement && (
                <div className="border-t pt-2 mt-2">
                    <div className="text-xs text-gray-500 mb-1">Luego:</div>
                    <div className="text-sm font-medium">{member.replacement.name}</div>
                    <div className="text-xs text-gray-600">{member.replacement.phone}</div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 mt-3">
                <button
                    onClick={handleCall}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm"
                >
                    <Phone className="w-4 h-4" />
                    Llamar
                </button>
                <button
                    onClick={handleWhatsApp}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors text-sm"
                >
                    <MessageCircle className="w-4 h-4" />
                    WhatsApp
                </button>
            </div>
        </div>
    );
};

/**
 * Modal for importing a shift message manually
 */
interface ImportModalProps {
    message: string;
    setMessage: (msg: string) => void;
    onImport: () => void;
    onClose: () => void;
    importing: boolean;
    error: string;
}

const ImportModal: React.FC<ImportModalProps> = ({
    message,
    setMessage,
    onImport,
    onClose,
    importing,
    error
}) => {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        <Upload className="w-5 h-5 text-blue-500" />
                        <h2 className="text-lg font-semibold">Importar Turno de Pabellón</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4">
                    <p className="text-sm text-gray-600">
                        Copia y pega el mensaje de turno de pabellón desde WhatsApp.
                        El sistema extraerá las fechas automáticamente.
                    </p>

                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={`Ejemplo:

Estimados, buenos días

Envío Turno pabellón del 08/12/2025 hasta el 15/12/2025

-E.U Catalina Hidalgo: +56 9 6607 5214
-Cirujana: Dra. Macarena Villareal +56 9 7946 7057
...`}
                        className="w-full h-64 p-3 border rounded-lg text-sm font-mono resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />

                    {error && (
                        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                            ⚠️ {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        disabled={importing}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onImport}
                        disabled={importing || !message.trim()}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {importing ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Importando...
                            </>
                        ) : (
                            <>
                                <Upload className="w-4 h-4" />
                                Importar Turno
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShiftPanelView;

