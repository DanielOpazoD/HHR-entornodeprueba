/**
 * ViewLoader
 * Loading fallback component for lazy-loaded views
 */
import React from 'react';

export const ViewLoader: React.FC = () => (
    <div className="flex items-center justify-center min-h-[400px] py-20">
        <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 border-4 border-medical-200 border-t-medical-600 rounded-full animate-spin" />
            <span className="text-slate-500 text-sm font-medium">Cargando módulo...</span>
        </div>
    </div>
);
