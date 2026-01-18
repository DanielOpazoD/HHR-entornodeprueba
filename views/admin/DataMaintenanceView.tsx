import React from 'react';
import { DataMaintenancePanel } from './components/DataMaintenancePanel';
import { Database } from 'lucide-react';
import { useCensusContext } from '@/context/CensusContext';

export const DataMaintenanceView: React.FC = () => {
    const { fileOps } = useCensusContext();

    return (
        <div className="max-w-[1200px] mx-auto p-4 animate-fade-in font-sans pb-16">
            <div className="bg-emerald-900 rounded-2xl p-5 mb-6 text-white relative overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none" />
                <div className="relative z-10 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
                        <Database size={24} className="text-emerald-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight leading-none mb-1">Mantenimiento y Respaldos</h1>
                        <p className="text-[11px] text-emerald-200/60 font-medium">Gestión de integridad y seguridad de datos</p>
                    </div>
                </div>
            </div>

            <DataMaintenancePanel
                onDailyExport={fileOps.handleExportJSON}
                onDailyImport={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.json';
                    input.onchange = (e) => fileOps.handleImportJSON(e as any);
                    input.click();
                }}
            />
        </div>
    );
};
