import React from 'react';
import { PatientDatabaseManager } from './components/PatientDatabaseManager';
import { Database } from 'lucide-react';

export const PatientMasterView: React.FC = () => {
    return (
        <div className="max-w-[1400px] mx-auto p-6 animate-fade-in font-sans pb-24">
            <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 shadow-sm">
                    <Database size={24} />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight">
                        Índice Maestro de Pacientes
                    </h1>
                    <p className="text-slate-500 font-medium">
                        Gestión centralizada del catálogo de pacientes y sincronización histórica.
                    </p>
                </div>
            </div>

            <PatientDatabaseManager />
        </div>
    );
};
