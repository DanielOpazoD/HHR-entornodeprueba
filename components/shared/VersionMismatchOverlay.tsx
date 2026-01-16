import React from 'react';
import { RefreshCw, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useVersion } from '../../context/VersionContext';

/**
 * Blocking overlay for version mismatch detection.
 * Prevents data corruption by stopping interactions when the app is outdated.
 */
export const VersionMismatchOverlay: React.FC = () => {
    const { isOutdated, appVersion, remoteVersion, forceUpdate } = useVersion();

    if (!isOutdated) return null;

    return (
        <div className="fixed inset-0 z-[10000] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4 overflow-hidden">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-red-200 overflow-hidden animate-scale-in">
                {/* Header */}
                <div className="bg-red-600 p-6 flex flex-col items-center text-white text-center">
                    <div className="bg-white/20 p-3 rounded-full mb-4">
                        <ShieldAlert size={48} className="text-white" />
                    </div>
                    <h2 className="text-2xl font-bold">¡Actualización Obligatoria!</h2>
                </div>

                {/* Content */}
                <div className="p-8 text-center">
                    <div className="flex justify-center gap-2 mb-6">
                        <div className="px-3 py-1 bg-slate-100 rounded text-xs font-mono text-slate-500 border border-slate-200">
                            App: v{appVersion}
                        </div>
                        <AlertTriangle size={16} className="text-amber-500 mt-0.5" />
                        <div className="px-3 py-1 bg-amber-50 rounded text-xs font-mono text-amber-700 border border-amber-100 font-bold">
                            Nube: v{remoteVersion}
                        </div>
                    </div>

                    <p className="text-slate-600 mb-6 leading-relaxed">
                        Se ha detectado una nueva versión de la base de datos en la nube.
                        Para prevenir la pérdida o corrupción de datos clínicos, la aplicación se ha bloqueado preventivamente.
                    </p>

                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-8 text-left">
                        <p className="text-blue-800 text-xs font-medium mb-1 flex items-center gap-2">
                            <RefreshCw size={14} className="animate-spin-slow" />
                            ¿Cómo solucionarlo?
                        </p>
                        <p className="text-blue-700 text-[11px] leading-snug">
                            Haz clic en el botón de abajo para recargar la aplicación y obtener la versión más reciente.
                        </p>
                    </div>

                    <button
                        onClick={forceUpdate}
                        className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-all transform active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
                    >
                        <RefreshCw size={20} />
                        Actualizar Aplicación Ahora
                    </button>

                    <p className="mt-4 text-[10px] text-slate-400">
                        Hospital Hanga Roa - Sistema de Protección de Datos
                    </p>
                </div>
            </div>
        </div>
    );
};
