import React from 'react';
import {
    Users,
    Calendar,
    RefreshCw,
    Clock,
    AlertCircle,
    Plus,
    Search
} from 'lucide-react';
import { useShiftPanel } from '@/hooks/useShiftPanel';
import { StaffCard } from './components/StaffCard';
import { ImportModal } from './components/ImportModal';

export const ShiftPanelView: React.FC = () => {
    const {
        shift,
        loading,
        showOriginal,
        showImportModal,
        setShowImportModal,
        importMessage,
        setImportMessage,
        importing,
        importError,
        fetching,
        fetchResult,
        handleImport,
        handleFetchFromGroup,
        toggleViewMode
    } = useShiftPanel();

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    if (!shift) {
        return (
            <EmptyShiftView
                fetching={fetching}
                fetchResult={fetchResult}
                onFetch={handleFetchFromGroup}
                onOpenImport={() => setShowImportModal(true)}
                showImportModal={showImportModal}
                importProps={{
                    message: importMessage,
                    setMessage: setImportMessage,
                    onImport: handleImport,
                    onClose: () => setShowImportModal(false),
                    importing,
                    error: importError
                }}
            />
        );
    }

    const hasStaff = shift.staff && shift.staff.length > 0;
    const hasOriginalMessage = !!shift.originalMessage;

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
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

            {/* View Selection Toggle */}
            {hasOriginalMessage && (
                <div className="flex gap-2">
                    <button
                        onClick={() => toggleViewMode('parsed')}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${!showOriginal
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        Vista Parseada {hasStaff && `(${shift.staff.length})`}
                    </button>
                    <button
                        onClick={() => toggleViewMode('original')}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${showOriginal
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                    >
                        Mensaje Original
                    </button>
                </div>
            )}

            {/* Content Display */}
            <div className="animate-in fade-in duration-300">
                {showOriginal || !hasStaff ? (
                    <div className="bg-gray-50 border rounded-lg p-4">
                        {!hasStaff && !showOriginal && (
                            <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded mb-3 inline-block">
                                ⚠️ No se pudieron parsear los contactos automáticamente
                            </div>
                        )}
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                            {shift.originalMessage || 'No hay mensaje original disponible'}
                        </pre>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {shift.staff.map((member, index) => (
                            <StaffCard key={index} member={member} />
                        ))}
                    </div>
                )}
            </div>

            {/* Global Modals */}
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
};

/**
 * Sub-component for empty states
 */
interface FetchResultType {
    success?: boolean;
    message?: string;
    error?: string;
}

interface ImportPropsType {
    message: string;
    setMessage: (msg: string) => void;
    onImport: () => void;
    onClose: () => void;
    importing: boolean;
    error: string | null;
}

const EmptyShiftView: React.FC<{
    fetching: boolean;
    fetchResult: FetchResultType | null;
    onFetch: () => void;
    onOpenImport: () => void;
    showImportModal: boolean;
    importProps: ImportPropsType;
}> = ({ fetching, fetchResult, onFetch, onOpenImport, showImportModal, importProps }) => (
    <div className="space-y-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
            <h3 className="font-medium text-yellow-800 mb-2">No hay turno vigente</h3>
            <p className="text-sm text-yellow-600 mb-4">
                No se ha recibido información de turnos de pabellón esta semana.
            </p>

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
                    onClick={onFetch}
                    disabled={fetching}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                    {fetching ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                        <Search className="w-4 h-4" />
                    )}
                    {fetching ? 'Buscando...' : 'Buscar en Grupo de WhatsApp'}
                </button>
                <button
                    onClick={onOpenImport}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                    <Plus className="w-4 h-4" />
                    Importar Manualmente
                </button>
            </div>
        </div>

        {showImportModal && <ImportModal {...importProps} />}
    </div>
);

export default ShiftPanelView;
