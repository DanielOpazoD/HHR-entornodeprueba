import React from 'react';
import { AlertCircle, FileSpreadsheet, Loader2 } from 'lucide-react';

export const SharedCensusDeniedState: React.FC<{ error: string | null }> = ({ error }) => (
  <div className="max-w-4xl mx-auto mt-20 p-8 bg-white rounded-3xl shadow-xl border border-red-100 text-center animate-in fade-in duration-500">
    <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 text-red-500">
      <AlertCircle size={40} />
    </div>
    <h2 className="text-2xl font-black text-slate-800 mb-4 tracking-tight">Acceso Denegado</h2>
    <p className="text-slate-600 mb-8 max-w-md mx-auto font-medium">
      {error || 'No tienes una invitación válida o tu sesión ha expirado.'}
    </p>
    <div className="text-sm text-slate-400 font-medium">
      Contacta al administrador para solicitar un nuevo link.
    </div>
  </div>
);

export const SharedCensusLoadingState: React.FC = () => (
  <div className="max-w-4xl mx-auto mt-20 flex flex-col items-center justify-center p-12 bg-white rounded-3xl shadow-md border border-slate-100">
    <Loader2 className="w-12 h-12 text-medical-600 animate-spin mb-4" />
    <p className="text-slate-600 font-bold tracking-tight">Cargando censo compartido...</p>
  </div>
);

export const SharedCensusLoadErrorState: React.FC<{ loadError: string }> = ({ loadError }) => (
  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center text-amber-800">
    <AlertCircle className="mx-auto mb-2" size={32} />
    <p className="font-bold">{loadError}</p>
  </div>
);

export const SharedCensusEmptyState: React.FC<{ hasSearchTerm: boolean }> = ({ hasSearchTerm }) => (
  <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-16 text-center">
    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
      <FileSpreadsheet size={32} />
    </div>
    <h3 className="text-lg font-bold text-slate-700">No se encontraron archivos</h3>
    <p className="text-slate-500 text-sm mt-1 font-medium">
      {hasSearchTerm ? 'Prueba con otra búsqueda.' : 'No hay censos registrados.'}
    </p>
  </div>
);
