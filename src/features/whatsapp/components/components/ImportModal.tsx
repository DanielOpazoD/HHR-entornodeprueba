import React from 'react';
import { Upload, X, RefreshCw } from 'lucide-react';

interface ImportModalProps {
    message: string;
    setMessage: (msg: string) => void;
    onImport: () => void;
    onClose: () => void;
    importing: boolean;
    error: string | null;
}

export const ImportModal: React.FC<ImportModalProps> = ({
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
                        aria-label="Cerrar"
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
