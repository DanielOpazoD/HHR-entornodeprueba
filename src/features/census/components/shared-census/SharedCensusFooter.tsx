import React from 'react';
import { Clock } from 'lucide-react';

export const SharedCensusFooter: React.FC = () => (
  <footer className="mt-12 pt-8 border-t border-slate-100 text-center text-slate-400">
    <div className="flex items-center justify-center gap-4 mb-4">
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-300">
        <Clock size={14} />
        Histórico Estratégico
      </div>
    </div>
    <p className="text-[10px] max-w-lg mx-auto leading-relaxed font-medium">
      Este sistema contiene información sensible protegida por la Ley 19.628 de Protección de la
      Vida Privada. Todas las acciones de acceso y descarga son registradas con fines de auditoría
      institucional.
    </p>
  </footer>
);
