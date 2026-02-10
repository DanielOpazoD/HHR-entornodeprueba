import React, { useState, useEffect } from 'react';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { isDatabaseInFallbackMode, resetLocalDatabase } from '@/services/storage/indexedDBService';

/**
 * StorageStatusBadge
 * 
 * Persistent warning shown only when IndexedDB fails and the system
 * is operating in memory-only mode (data loss risk on reload).
 */
const StorageStatusBadge: React.FC = () => {
    const [isFallback, setIsFallback] = useState(() => isDatabaseInFallbackMode());
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {

        // We could also set up an interval or event listener if Dexie supports it
        const interval = setInterval(() => {
            const currentStatus = isDatabaseInFallbackMode();
            if (currentStatus !== isFallback) {
                setIsFallback(currentStatus);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [isFallback]);

    if (!isFallback || !isVisible) return null;

    return (
        <div className="fixed bottom-4 left-4 z-[9999] animate-bounce-subtle">
            <div className="bg-amber-50 border border-amber-200 shadow-lg rounded-lg p-3 max-w-sm flex items-start gap-3">
                <div className="bg-amber-100 p-2 rounded-full">
                    <AlertTriangle className="text-amber-600 w-5 h-5" />
                </div>
                <div className="flex-1">
                    <h4 className="text-amber-900 font-bold text-sm flex items-center gap-2">
                        Resiliencia de Almacenamiento
                        <span className="bg-amber-200 text-amber-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-black">Activa</span>
                    </h4>
                    <p className="text-amber-800 text-xs mt-1 leading-relaxed">
                        El navegador bloqueó la base de datos local. <strong>Los cambios se perderán al cerrar la pestaña</strong> si no hay conexión a internet.
                    </p>
                    <div className="mt-2 flex gap-2">
                        <button
                            onClick={() => window.location.reload()}
                            className="text-[10px] bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded flex items-center gap-1 transition-colors"
                        >
                            <RefreshCw className="w-3 h-3" /> Reintentar
                        </button>
                        <button
                            onClick={resetLocalDatabase}
                            className="text-[10px] bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                        >
                            <Database className="w-3 h-3" /> Limpieza Dura
                        </button>
                        <button
                            onClick={() => setIsVisible(false)}
                            className="text-[10px] text-amber-500 hover:text-amber-700 font-medium ml-auto"
                        >
                            Ignorar
                        </button>
                    </div>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes bounce-subtle {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-4px); }
                }
                .animate-bounce-subtle {
                    animation: bounce-subtle 3s infinite ease-in-out;
                }
            `}} />
        </div>
    );
};

export default StorageStatusBadge;
