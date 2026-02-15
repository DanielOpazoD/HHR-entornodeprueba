import React from 'react';
import { Search } from 'lucide-react';

interface SharedCensusHeaderProps {
  accessDisplayName: string;
  searchTerm: string;
  onSearchTermChange: (nextValue: string) => void;
}

export const SharedCensusHeader: React.FC<SharedCensusHeaderProps> = ({
  accessDisplayName,
  searchTerm,
  onSearchTermChange,
}) => (
  <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
    <div>
      <h1 className="text-2xl font-black text-slate-900 tracking-tight">
        Archivos de Censo Diario
      </h1>
      <p className="text-slate-500 text-sm font-medium">
        Bienvenido, <span className="text-slate-800 font-bold">{accessDisplayName}</span>
        <span className="mx-2 text-slate-300">|</span>
        <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
          Acceso Compartido
        </span>
      </p>
    </div>

    <div className="relative group">
      <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-medical-600 transition-colors">
        <Search size={18} />
      </div>
      <input
        type="text"
        placeholder="Buscar por fecha..."
        className="pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl w-full md:w-80 shadow-sm focus:ring-4 focus:ring-medical-500/10 focus:border-medical-500 outline-none transition-all font-medium"
        value={searchTerm}
        onChange={event => onSearchTermChange(event.target.value)}
      />
    </div>
  </header>
);
