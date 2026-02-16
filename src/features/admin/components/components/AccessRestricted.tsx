import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

export const AccessRestricted: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center p-20 text-slate-500 text-center">
      <ShieldAlert size={64} className="text-rose-400 mb-6" />
      <h2 className="text-2xl font-black text-slate-800">Acceso Restringido</h2>
      <p className="mt-2 max-w-sm">
        Tu cuenta actual no tiene privilegios de Escritura en el nodo de configuración global.
      </p>
      <button
        onClick={defaultBrowserWindowRuntime.reload}
        className="mt-8 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100 active:scale-95 transition-all"
      >
        Forzar Re-Sincronización
      </button>
    </div>
  );
};
